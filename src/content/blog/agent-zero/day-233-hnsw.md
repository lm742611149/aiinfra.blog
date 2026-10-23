---
title: 'Day 233 · HNSW:为什么快,为什么会漏'
description: '用 20 行 numpy 在一张二维近邻图上"走路",看贪心只走一条路只找对 31%,把候选名单放宽到 10 个就到 97%。再在 2 万行、1024 维的表上真建 HNSW 索引:建了 169 秒、占 156 MB,单次查询从约 200 毫秒降到几毫秒,召回率随 ef_search 从 0.75 升到 0.999。还会亲眼看到三个坑:ORDER BY 写成表达式就不走索引,LIMIT 超过 ef_search 只返回 40 行,内存不够建索引慢很多。'
pubDate: 2026-10-23
regime: none
tags: ['pgvector', 'hnsw', 'ann', 'vector-index', 'agent-zero']
series: 'agent-zero'
day: 233
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 232](/blog/agent-zero/day-232-pgvector-3/) 在 `pg_store.py` 里写了 `search()`:一条 `ORDER BY embedding <=> 问题向量 LIMIT k` 的 SQL,返回和 numpy 版同样形状的结果,10 道题 top-4 编号 10/10 一致,接回 RAG 后拒答测试仍是 10/10。练习 4 里看了 `EXPLAIN`:42 行的表,计划里全是顺序扫描,Day 229 建的 HNSW 索引根本没被用上。

那今天的问题自然就来了:这个索引什么时候才有用?它到底是怎么让查询变快的?快的代价是什么?课程里一直叫它"近似"检索,近似在哪里?今天先用一个能跑的小模拟搞懂思路,再造一张 2 万行的表,把索引真的建起来,用数字回答这几个问题。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清**精确最近邻**和**近似最近邻**(ANN)的区别,算得出暴力检索一次要多少次乘加,说出索引用"可能漏掉一点"换"快很多"。
2. 看懂 HNSW 的思路:点和点之间连成图,查询时从入口出发一路贪心靠近;用 `graph_toy.py` 实测一条路走到底只找对 31%,候选名单放宽到 10 个就到 97%,而且只算了 107 次距离(暴力要 3000 次)。
3. 在 2 万行的表上建 HNSW 索引,用 `EXPLAIN ANALYZE` 看出走了索引,量出建索引的时间、占的空间和查询提速;用 `hnsw_recall.py` 量出召回率随 `ef_search` 的变化。
4. 避开三个坑:`ORDER BY` 写成表达式(`1 - (embedding <=> q)`)索引不起作用,`LIMIT` 比 `ef_search` 大时只返回 `ef_search` 那么多行,建索引时内存不够会慢很多。

预计用时 3 小时:近似检索和模拟 50 分钟,造表和建索引 40 分钟,`EXPLAIN` 和召回率实验 50 分钟,剩下做练习。前置:[Day 232](/blog/agent-zero/day-232-pgvector-3/) 的 `pg_store.search()` 和 `SET ... sql.Literal`,[Day 229](/blog/agent-zero/day-229-pgvector-1/) 建好的 `kb_chunks` 和 HNSW 索引,[Day 225](/blog/agent-zero/day-225-numpy-index/) 的 `index/`(造表用它的 42 个真实向量),[Day 214](/blog/agent-zero/day-214-numpy-basics/) 附近的 numpy 基础,[Day 89](/blog/agent-zero/day-089-sql-5/) 的索引和 `EXPLAIN`。

今天不调任何模型接口,花费 0 元。造表和建索引会让这台电脑忙几分钟,风扇会响,这是正常的。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `graph_toy.py` 里的 `walk()` 的主体和 `SET hnsw.ef_search` 的写法;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 为什么需要索引:一次查询要算多少次

先算一笔账。Day 226 的 numpy 检索,是把问题向量和 42 个块向量各做一次点积。一次点积是 1024 次乘法加 1024 次加法。表里有 N 行,一次查询就是 N × 1024 次乘加,这叫**暴力检索**(brute force),也叫**精确最近邻**:不放过任何一行,保证找到真正最近的。

| 行数 N | 一次查询的乘加次数(N × 1024) |
| --- | --- |
| 42(今天之前) | 43,008 |
| 20,000(今天造的表) | 20,480,000 |
| 1,000,000 | 1,024,000,000(约 10 亿) |

42 行时一次零点零几毫秒,2 万行时我实测是每次约 150 到 200 毫秒(下面会看到),100 万行至少是它的 50 倍,也就是几秒到十几秒。一个客服问答系统要的是几十毫秒。矩阵乘法再优化十倍也追不上数据量的增长,必须换思路:**不看所有的点,只看有希望的那一小部分**。

代价是,"有希望"这个判断可能错,可能漏掉真正最近的那个。这种用一点准确性换大量速度的方法叫**近似最近邻**(ANN,Approximate Nearest Neighbor)。衡量漏了多少的指标叫**召回率**(recall):近似方法返回的 top-10 里,有几个是精确方法返回的 top-10。召回率 0.97 的意思是,平均 10 个里有 9.7 个是对的。

## 第一步:在一张图上走路

HNSW(Hierarchical Navigable Small World,分层可导航小世界图)是现在向量索引里最常用的一种。它的名字很长,核心思想只有一句:**把所有点连成一张图,每个点只和附近的少数点相连;查询时从某个入口点出发,每一步走向离问题更近的邻居,走不动了就停。**

用一个比喻。你到一个陌生城市找一家小店,不会一条街一条街地问,而是问路:路人告诉你"往那个方向走",走到附近再问下一个人,越问越近。每个人只知道自己周围的情况,但一路问下去就能到。图里每个点就是一个"路人",它的邻居列表就是它知道的"附近的人"。

不过有个问题:每个人只指一个最近的方向,可能把你带进死胡同。说"走不动了"的那个点,可能只是一个局部最近,并不是整个城市里最近的。下面用能跑的代码看清这件事。新建 `part04/graph_toy.py`,用 3000 个二维点(二维好画好想,原理和 1024 维一样):

```python
# agent-zero-lab/part04/graph_toy.py
"""近邻图上的"贪心走路":3000 个二维点,每个点连最近的 5 个邻居,从固定入口出发往问题点靠。"""
import heapq

import numpy as np

rng = np.random.default_rng(0)
N, K_LINKS = 3000, 5
points = rng.random((N, 2))

# 建图:每个点连最近的 5 个点,再把边变成双向的
d2 = ((points[:, None, :] - points[None, :, :]) ** 2).sum(axis=2)
nearest = np.argsort(d2, axis=1)[:, 1 : K_LINKS + 1]
graph: list[set[int]] = [set() for _ in range(N)]
for u in range(N):
    for v in nearest[u]:
        graph[u].add(int(v))
        graph[int(v)].add(u)
print("平均每个点连", round(sum(len(g) for g in graph) / N, 1), "条边")

ENTRY = 0  # 固定入口点,每次都从它出发


def walk(q: np.ndarray, ef: int) -> tuple[int, int]:
    """从入口出发在图上找离 q 最近的点。ef 是候选名单长度。返回 (找到的点, 算过几次距离)。"""

    def dist(i: int) -> float:
        return float(((points[i] - q) ** 2).sum())

    visited = {ENTRY}
    todo = [(dist(ENTRY), ENTRY)]  # 待展开的点,最近的先出来
    best = [(-dist(ENTRY), ENTRY)]  # 目前最好的 ef 个,堆顶是其中最差的
    while todo:
        d, u = heapq.heappop(todo)
        if len(best) >= ef and d > -best[0][0]:
            break  # 待展开的最近的点,也比名单里最差的还远,不用再走了
        for v in graph[u]:
            if v in visited:
                continue
            visited.add(v)
            dv = dist(v)
            if len(best) < ef or dv < -best[0][0]:
                heapq.heappush(todo, (dv, v))
                heapq.heappush(best, (-dv, v))
                if len(best) > ef:
                    heapq.heappop(best)
    return max(best)[1], len(visited)


queries = rng.random((500, 2))
truth = [int(((points - q) ** 2).sum(axis=1).argmin()) for q in queries]
print(f"暴力检索每次要算 {N} 次距离")
for ef in (1, 2, 5, 10, 20, 50):
    hits, calc = 0, 0
    for q, t in zip(queries, truth):
        found, n = walk(q, ef)
        hits += found == t
        calc += n
    print(f"ef={ef:<3} 找对 {hits}/500 = {hits / 500:.0%}  平均算距离 {calc / 500:.0f} 次")
```

<div class="line-notes">

- `import heapq` Python 标准库的堆(优先队列):随时能取出最小的一个。后面用它管理"待展开的点"。
- `rng = np.random.default_rng(0)` 带种子的随机数生成器,种子固定,每个人跑出来的数字一样。
- `N, K_LINKS = 3000, 5` 3000 个点,每个点连最近的 5 个。
- `points = rng.random((N, 2))` 形状 `(3000, 2)` 的数组,每行是 0 到 1 之间的一个二维坐标。
- `d2 = ((points[:, None, :] - points[None, :, :]) ** 2).sum(axis=2)` 算出任意两点之间距离的平方,得到 `(3000, 3000)` 的矩阵。`points[:, None, :]` 和 `points[None, :, :]` 是 numpy 的"广播"(Day 214),让 3000 个点和 3000 个点两两相减。这一步 3000 × 3000 要几秒,只在建图时做一次。
- `nearest = np.argsort(d2, axis=1)[:, 1 : K_LINKS + 1]` 每一行按距离从小到大排下标,取第 1 到第 5 个。为什么从 1 开始:第 0 个是点自己,距离是 0。
- `graph: list[set[int]] = [set() for _ in range(N)]` 邻接表:`graph[u]` 是点 `u` 所有邻居的集合。
- `graph[u].add(int(v))` 把 `u` 连向它最近的 5 个点。
- `graph[int(v)].add(u)` 再反过来连一条。"我把你当邻居,你也把我当邻居",边变成双向的,这样每个点平均连 6 条边。
- `print("平均每个点连", round(sum(len(g) for g in graph) / N, 1), "条边")` 实测 6.0。
- `ENTRY = 0` 固定从 0 号点出发,不管问题在哪。这会让"走路"变得吃力,真实 HNSW 靠上面几层解决它。
- `def walk(q: np.ndarray, ef: int) -> tuple[int, int]:` 核心函数。`q` 是问题点,`ef` 是**候选名单的长度**(后面会反复提到它),返回"找到的点"和"一共算过几次距离"。
- `def dist(i: int) -> float:` 点 `i` 到问题点的距离平方。用平方就够了,不用开根号,大小关系不变。
- `visited = {ENTRY}` 走过的点,不重复算。
- `todo = [(dist(ENTRY), ENTRY)]` "待展开"的点,堆里按距离排,最近的最先出来。开始只有入口。
- `best = [(-dist(ENTRY), ENTRY)]` "目前找到的最好的 ef 个点"。存的是**负距离**:Python 的堆只能取最小,负数让"最远的"排在堆顶,方便随时把最差的踢出去。
- `d, u = heapq.heappop(todo)` 取出待展开的点里最近的一个 `u`。
- `if len(best) >= ef and d > -best[0][0]:` 名单已满,并且这个最近的待展开点,都比名单里最差的还远。那继续往下走不可能再改善名单了,停。`-best[0][0]` 是把堆顶的负距离换回正的。
- `for v in graph[u]:` 看 `u` 的每个邻居。
- `if v in visited:` 走过就跳过(下一行 `continue`)。
- `visited.add(v)` 记下,同时下一行算距离,这一次计入"算过的距离"。
- `if len(best) < ef or dv < -best[0][0]:` 名单还没满,或者这个邻居比名单里最差的好,就收下。
- `heapq.heappush(todo, (dv, v))` 它成为新的待展开点。
- `heapq.heappush(best, (-dv, v))` 同时进名单。
- `if len(best) > ef:` 名单超长了,下一行 `heapq.heappop(best)` 踢掉堆顶,也就是最差的一个。
- `return max(best)[1], len(visited)` 名单里存的是负距离,`max` 取负距离最大的,也就是距离最小的,它的下标就是找到的点。`len(visited)` 是算过的距离次数。
- `queries = rng.random((500, 2))` 500 个随机问题点。
- `truth = [int(((points - q) ** 2).sum(axis=1).argmin()) for q in queries]` 用暴力检索算出每个问题点真正最近的点,当标准答案。
- `for ef in (1, 2, 5, 10, 20, 50):` 换不同长度的候选名单。`ef=1` 是最纯粹的贪心:名单里只留一个最好的。
- `hits += found == t` 找到的和标准答案一致,命中数加 1。
- `print(f"ef={ef:<3} 找对 {hits}/500 = {hits / 500:.0%}  平均算距离 {calc / 500:.0f} 次")` 命中率和平均算了几次距离。

</div>

```bash
cd /Users/你/agent-zero-lab
uv run python -m part04.graph_toy
```

```text
平均每个点连 6.0 条边
暴力检索每次要算 3000 次距离
ef=1   找对 156/500 = 31%  平均算距离 60 次
ef=2   找对 252/500 = 50%  平均算距离 71 次
ef=5   找对 364/500 = 73%  平均算距离 88 次
ef=10  找对 483/500 = 97%  平均算距离 107 次
ef=20  找对 496/500 = 99%  平均算距离 118 次
ef=50  找对 500/500 = 100%  平均算距离 149 次
```

三件事。第一,`ef=1`,纯贪心,只算了 60 次距离(暴力要 3000 次),但只找对了 31%,有七成的查询被带进了"局部最近"的死胡同。这就是 HNSW"漏"的来源。第二,把候选名单放宽到 10 个(每一步不只盯着一个最好的点,而是同时保留 10 个),命中率到了 97%,平均算 107 次距离,是暴力的 3.6%。第三,继续放宽,命中率逼近 100%,代价是多算几十次。**名单越长,走得越稳,也越慢**,这就是下面的参数 `ef_search`:名字里的 ef 就是这里的 `ef`(exploration factor,探索的广度)。

需要说明:这个模拟只有一层图、入口固定,比真实的 HNSW 简单。真实 HNSW 为了不用从一个固定入口"一步一步爬到目标区域",做了两件事。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="HNSW 分层结构示意:顶层点最少、连线跨度最大,往下每层点越来越多、连线越来越短,第 0 层包含所有点。查询从顶层入口出发,每层贪心走到离问题最近的点,再下到下一层继续,最后在第 0 层的邻域里找到答案">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="40" fill="var(--ink-soft)">第 2 层</text>
<text x="20" y="130" fill="var(--ink-soft)">第 1 层</text>
<text x="20" y="225" fill="var(--ink-soft)">第 0 层</text>
<text x="20" y="242" fill="var(--ink-faint)" font-size="11">(所有点)</text>
<line x1="110" y1="35" x2="420" y2="35" stroke="var(--rule)"/>
<circle cx="110" cy="35" r="6" fill="var(--compute)"/>
<circle cx="420" cy="35" r="5" fill="var(--ink-soft)"/>
<text x="96" y="20" fill="var(--compute)" font-size="11">入口</text>
<line x1="110" y1="125" x2="250" y2="125" stroke="var(--rule)"/>
<line x1="250" y1="125" x2="420" y2="125" stroke="var(--rule)"/>
<line x1="420" y1="125" x2="540" y2="125" stroke="var(--rule)"/>
<circle cx="110" cy="125" r="5" fill="var(--ink-soft)"/>
<circle cx="250" cy="125" r="5" fill="var(--ink-soft)"/>
<circle cx="420" cy="125" r="5" fill="var(--ink-soft)"/>
<circle cx="540" cy="125" r="5" fill="var(--ink-soft)"/>
<g fill="var(--ink-faint)">
<circle cx="110" cy="220" r="4"/><circle cx="160" cy="220" r="4"/><circle cx="205" cy="220" r="4"/><circle cx="250" cy="220" r="4"/><circle cx="300" cy="220" r="4"/><circle cx="345" cy="220" r="4"/><circle cx="390" cy="220" r="4"/><circle cx="420" cy="220" r="4"/><circle cx="500" cy="220" r="4"/><circle cx="540" cy="220" r="4"/><circle cx="590" cy="220" r="4"/>
</g>
<line x1="110" y1="220" x2="590" y2="220" stroke="var(--rule)"/>
<path d="M110 35 L420 35 L420 125 L540 125" fill="none" stroke="var(--mem)" stroke-width="2.5"/>
<path d="M540 125 L500 220" fill="none" stroke="var(--mem)" stroke-width="2.5" stroke-dasharray="5 3"/>
<line x1="420" y1="35" x2="420" y2="125" stroke="var(--ink-faint)" stroke-dasharray="2 3"/>
<circle cx="500" cy="220" r="6" fill="var(--mem)"/>
<circle cx="470" cy="270" r="6" fill="none" stroke="var(--mem)" stroke-width="2"/>
<text x="482" y="275" fill="var(--mem)">问题向量 q</text>
<text x="300" y="160" fill="var(--ink-soft)" font-size="11">上层连线跨度大:先跳到大致区域</text>
<text x="140" y="262" fill="var(--ink-soft)" font-size="11">最底层邻居近,在附近细找(候选名单长度 = ef_search)</text>
</g>
</svg>
<figcaption>分层的 HNSW。上层只留很少的点,连线跨得远,像地铁;往下点越来越多、连线越来越短,像公交和步行;最底层是全部点。查询从顶层入口出发,每一层都走到离问题最近的点,再带着它下到下一层。蓝线是走过的路,最后在第 0 层的小范围里细找。</figcaption>
</figure>

第一件事是**分层**:每个点随机决定自己"住几层",绝大多数点只在最底层,极少数点还出现在上面几层,层越高点越少。上层的连线跨度大,像地铁,先快速跳到大致正确的区域,再往下换成公交、步行细找。第二件事是**每一层只保留限量的邻居**(参数 `m`),图不会变成一团乱麻。建图时每插入一个点,也要走一遍上面的查询,找到它该连的邻居,候选名单长度用 `ef_construction` 控制。三个参数先记名字:

| 参数 | 什么时候用 | 意思 | pgvector 默认值 |
| --- | --- | --- | --- |
| `m` | 建索引 | 每个点在每层最多连几个邻居 | 16 |
| `ef_construction` | 建索引 | 建图时每个点找邻居用的候选名单长度 | 64 |
| `ef_search` | 每次查询 | 查询时的候选名单长度,就是模拟里的 `ef` | 40 |

前两个定了图的质量,建好就改不了,要改只能重建;`ef_search` 每次查询都能换。默认值是 pgvector 文档写的,我也在这个版本(0.8.6)里用 `SHOW` 看过 `ef_search` 是 40。

## 第二步:造一张 2 万行的表

42 行的表看不出索引的作用,造一张大的。我们没有 2 万块真实文章,只有 42 个真实向量,所以用一个办法造"像真的"的数据:每一行取这 42 个真实向量中随机的一个当中心,加上一个随机方向的噪声,再归一化。这样向量分成 42 个大致的"簇",簇内部有随机的散布,和真实的 embedding 数据有点像(真实数据也是成簇的),但**这是合成数据**,召回率这类数字换成你自己的真实数据一定会不同。新建 `part04/make_ann_demo.py`:

```python
# agent-zero-lab/part04/make_ann_demo.py
"""造一张 2 万行、1024 维的实验表 ann_demo:以 42 块真实向量为中心,加随机噪声。不建索引。"""
import time

import numpy as np

from part04.build_index import load_index
from part04.pg_store import connect

N = 20000
NOISE = 0.9

_, base_vectors = load_index()
rng = np.random.default_rng(7)
centers = base_vectors[rng.integers(0, len(base_vectors), N)]
noise = rng.normal(size=(N, 1024)).astype(np.float32)
noise /= np.linalg.norm(noise, axis=1, keepdims=True)
X = centers + NOISE * noise
X /= np.linalg.norm(X, axis=1, keepdims=True)
print("造出", X.shape, X.dtype, "每行长度", float(np.linalg.norm(X[0])))

with connect() as conn:
    conn.execute("DROP TABLE IF EXISTS ann_demo")
    conn.execute("CREATE TABLE ann_demo (id int PRIMARY KEY, embedding vector(1024) NOT NULL)")
    t0 = time.perf_counter()
    with conn.cursor() as cur, cur.copy("COPY ann_demo (id, embedding) FROM STDIN") as cp:
        for i in range(N):
            cp.write_row((i, X[i]))
    print(f"COPY 写入 {N} 行,用了 {time.perf_counter() - t0:.1f} 秒")
    row = conn.execute("SELECT count(*), pg_size_pretty(pg_table_size('ann_demo')) FROM ann_demo").fetchone()
    print("表里", row)
```

<div class="line-notes">

- `N = 20000` 行数。再大这台 2019 款 MacBook 建索引要等太久。
- `NOISE = 0.9` 噪声的比例:中心向量长度是 1,噪声方向的长度是 0.9,各占一半左右。噪声越大,簇越散,近邻越难分。
- `_, base_vectors = load_index()` 读 `index/` 里的 42 个真实向量,块本身不要,用 `_` 丢掉。
- `rng = np.random.default_rng(7)` 种子 7,每个人造出来的表一样。
- `centers = base_vectors[rng.integers(0, len(base_vectors), N)]` `rng.integers(0, 42, 20000)` 生成 2 万个 0 到 41 的随机整数,拿它们去取行(numpy 的"花式索引",Day 214),得到形状 `(20000, 1024)` 的矩阵,每行是随机选的一个中心。
- `noise = rng.normal(size=(N, 1024)).astype(np.float32)` 标准正态分布的随机数,形状同上,转成 float32 和 embedding 一致。
- `noise /= np.linalg.norm(noise, axis=1, keepdims=True)` 每行除以自己的长度,变成长度 1 的随机方向。
- `X = centers + NOISE * noise` 中心加上 0.9 倍的噪声。
- `X /= np.linalg.norm(X, axis=1, keepdims=True)` 再归一化,每行长度回到 1。实测打印 `每行长度 0.9999999403953552`。
- `conn.execute("DROP TABLE IF EXISTS ann_demo")` 重复运行时先删旧表。
- `conn.execute("CREATE TABLE ann_demo (id int PRIMARY KEY, embedding vector(1024) NOT NULL)")` 只有两列,不建 HNSW 索引,索引下一步单独建,好量时间。
- `with conn.cursor() as cur, cur.copy("COPY ann_demo (id, embedding) FROM STDIN") as cp:` `COPY` 是 Postgres 的批量写入命令,比一行一行 `INSERT` 快得多。psycopg 的 `cur.copy(...)` 打开一个写入通道,往里 `write_row` 就行。一个 `with` 里同时开两个资源,用逗号隔开。
- `cp.write_row((i, X[i]))` 写一行:编号和向量。向量是 numpy 数组,`register_vector` 注册过,能直接写。
- `print(f"COPY 写入 {N} 行,用了 {time.perf_counter() - t0:.1f} 秒")` 实测 24.9 秒。
- `row = conn.execute("SELECT count(*), pg_size_pretty(pg_table_size('ann_demo')) FROM ann_demo").fetchone()` 数行数,并用 `pg_table_size` 看表占多少空间。

</div>

```bash
uv run python -m part04.make_ann_demo
```

```text
造出 (20000, 1024) float32 每行长度 0.9999999403953552
COPY 写入 20000 行,用了 24.9 秒
表里 (20000, '107 MB')
```

2 万行占 107 MB,和 Day 229 算的"每个向量 4104 字节"对得上:20000 × 4104 ≈ 82 MB,加上行头、主键索引和 Postgres 把大值单独存放(TOAST)的开销,107 MB 合理。

## 第三步:建 HNSW 索引

现在表里没有向量索引。先量一下"没有索引"的查询要多久,再建索引。在 psql 里开计时,`\timing on`,然后建:

```bash
psql -d agentzero
```

```sql
\timing on
CREATE INDEX ann_demo_hnsw ON ann_demo USING hnsw (embedding vector_cosine_ops);
SELECT pg_size_pretty(pg_relation_size('ann_demo_hnsw'));
```

<div class="line-notes">

- `\timing on` psql 的元命令,以后每条语句执行完都会打印耗时。
- `CREATE INDEX ann_demo_hnsw ON ann_demo USING hnsw (embedding vector_cosine_ops);` 建 HNSW 索引。`ann_demo_hnsw` 是索引的名字;`USING hnsw` 选索引类型;`(embedding vector_cosine_ops)` 对 `embedding` 这一列、按**余弦距离**建。`vector_cosine_ops` 要和查询里用的运算符匹配:用 `<=>` 查就要建余弦的,用 `<->` 查要建 `vector_l2_ops` 的,不匹配时索引不会被用上。Day 229 的 `kb_chunks` 索引就是这么写的。
- `SELECT pg_size_pretty(pg_relation_size('ann_demo_hnsw'));` 看索引文件有多大。

</div>

```text
NOTICE:  hnsw graph no longer fits into maintenance_work_mem after 13929 tuples
DETAIL:  Building will take significantly more time.
HINT:  Increase maintenance_work_mem to speed up builds.
CREATE INDEX
Time: 169209.182 ms (02:49.209)
 pg_size_pretty
----------------
 156 MB
(1 row)
```

三个信息。建了 169 秒,将近 3 分钟。索引占 156 MB,比表本身(107 MB)还大。中间有一条 NOTICE:建到第 13929 行时,图已经装不进 `maintenance_work_mem` 了,"建索引会慢很多"。这个设置是建索引能用的内存,我这里是默认的 64 MB(`SHOW maintenance_work_mem` 看到的),HNSW 的图要整个放在内存里建,放不下就只能边建边写盘,慢得多。练习 3 会把它调到 512 MB 重建,对比时间。

为什么索引比表还大?表里存的是向量本身(107 MB),索引里除了每个点的向量副本,还有图的邻居列表(每个点每层最多 `m` 个邻居,底层最多 2 × `m` 个)。向量副本是主要部分。**所以向量索引很占空间:几乎是把数据再存一遍。** 规划容量时要把这个算进去。

还有一点要知道:建索引会长时间占用资源。生产环境在线的大表上建索引,要用 `CREATE INDEX CONCURRENTLY`(不阻塞写入,但更慢),或者在低峰期操作。这里只是实验表,不用管。

## 第四步:EXPLAIN,它用上索引了吗

用 `EXPLAIN ANALYZE`(真的执行一遍,并给出实际耗时)比较三种情况。第一条是正常查询;第二条把 `ORDER BY` 写成 `1 - 距离`;第三条关掉索引扫描。`COSTS OFF, TIMING OFF` 去掉我们不关心的估算和逐步计时,输出更干净:

```sql
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id FROM ann_demo
ORDER BY embedding <=> (SELECT embedding FROM ann_demo WHERE id = 1) LIMIT 10;

EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id FROM ann_demo
ORDER BY 1 - (embedding <=> (SELECT embedding FROM ann_demo WHERE id = 1)) DESC LIMIT 10;

SET enable_indexscan = off;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id FROM ann_demo
ORDER BY embedding <=> (SELECT embedding FROM ann_demo WHERE id = 1) LIMIT 10;
```

<div class="line-notes">

- `EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)` `ANALYZE` 真的执行并给出实际行数和总耗时;`COSTS OFF` 不打印规划器的成本估算;`TIMING OFF` 不打印每一步的耗时,只留最后的 `Execution Time`。
- `ORDER BY embedding <=> (SELECT embedding FROM ann_demo WHERE id = 1) LIMIT 10;` 问题向量取表里 `id = 1` 的那一行,省得手写 1024 个数。第一条是"标准写法",排序用的是距离运算符。
- `ORDER BY 1 - (embedding <=>` 第二条把距离换算成相似度再降序,结果在数学上等价,写法不同。
- `SET enable_indexscan = off;` 第三条之前,告诉规划器"不许用索引扫描"。这个设置只对当前会话有效,实验用来拿精确答案和对比速度。

</div>

```text
 Limit (actual rows=10 loops=1)
   InitPlan 1
     ->  Index Scan using ann_demo_pkey on ann_demo ann_demo_1 (actual rows=1 loops=1)
           Index Cond: (id = 1)
   ->  Index Scan using ann_demo_hnsw on ann_demo (actual rows=10 loops=1)
         Order By: (embedding <=> (InitPlan 1).col1)
 Planning Time: 2.018 ms
 Execution Time: 5.209 ms
```

第一条(标准写法)走的是 `Index Scan using ann_demo_hnsw`,总共 5.2 毫秒。

```text
   ->  Sort (actual rows=10 loops=1)
         Sort Key: (('1'::double precision - (ann_demo.embedding <=> (InitPlan 1).col1))) DESC
         Sort Method: top-N heapsort  Memory: 25kB
         ->  Seq Scan on ann_demo (actual rows=20000 loops=1)
 Planning Time: 0.162 ms
 Execution Time: 333.085 ms
```

第二条(`1 - 距离`)退化成 `Seq Scan`:读了全部 20000 行再排序,333 毫秒。数学上等价,但规划器只认"`ORDER BY` 后面直接是距离运算符"这一个形状,别的写法都当成普通表达式,不会交给 HNSW 索引处理。这就是 Day 232 提到的坑,现在有了数字:慢了 60 多倍,而且**不报任何错**,查询结果还是对的,你只会发现"怎么这么慢"。

```text
   ->  Sort (actual rows=10 loops=1)
         Sort Key: ((ann_demo.embedding <=> (InitPlan 1).col1))
         Sort Method: top-N heapsort  Memory: 25kB
         ->  Seq Scan on ann_demo (actual rows=20000 loops=1)
 Planning Time: 0.107 ms
 Execution Time: 242.870 ms
```

第三条(关掉索引)同样是 `Seq Scan` 加 `Sort`,243 毫秒。这是"没有索引时"的真实水平。(我省略了每段输出里和主角无关的子查询那几行。)3 种情况放在一起:索引 5.2 毫秒,没索引 243 毫秒,写错 333 毫秒。

## 第五步:快多少,漏多少

只看一次查询不够,索引是近似的,要知道它漏多少。做法是拿**同一批查询**,先关掉索引拿精确的 top-10(标准答案),再开着索引、换不同的 `ef_search`,算召回率:`|索引返回的 ∩ 精确的| ÷ 10`,取 100 条查询的平均。新建 `part04/hnsw_recall.py`:

```python
# agent-zero-lab/part04/hnsw_recall.py
"""同一批查询:先关掉索引拿精确答案,再开着索引、换不同的 ef_search,看召回率和耗时。"""
import time

import numpy as np
import psycopg
from psycopg import sql

from part04.build_index import load_index
from part04.pg_store import connect

K = 10
NQ = 100
QUERY = "SELECT id FROM ann_demo ORDER BY embedding <=> %s LIMIT %s"


def make_queries() -> np.ndarray:
    """100 条查询向量:以真实向量为中心加噪声。种子 11,和造表时的 7 不同,所以不在表里。"""
    _, base_vectors = load_index()
    rng = np.random.default_rng(11)
    noise = rng.normal(size=(NQ, 1024)).astype(np.float32) / np.sqrt(1024)
    queries = base_vectors[rng.integers(0, len(base_vectors), NQ)] + 0.9 * noise
    return queries / np.linalg.norm(queries, axis=1, keepdims=True)


def run_all(conn: psycopg.Connection, queries: np.ndarray) -> tuple[list[list[int]], float]:
    """把每条查询各跑一遍,返回每条的 top-10 编号和平均耗时(毫秒)。"""
    out: list[list[int]] = []
    t0 = time.perf_counter()
    for q in queries:
        out.append([r[0] for r in conn.execute(QUERY, (q, K)).fetchall()])
    return out, (time.perf_counter() - t0) / len(queries) * 1000


def recall_table(conn: psycopg.Connection, efs: tuple[int, ...]) -> None:
    queries = make_queries()
    conn.execute("SET enable_indexscan = off")  # 不让它走索引,逼出精确答案
    truth, exact_ms = run_all(conn, queries)
    print(f"精确(不用索引):每条 {exact_ms:.1f} 毫秒")

    conn.execute("SET enable_indexscan = on")
    run_all(conn, queries)  # 先空跑一遍预热:第一次读索引要从磁盘加载,会拖慢第一个数字
    for ef in efs:
        conn.execute(sql.SQL("SET hnsw.ef_search = {}").format(sql.Literal(ef)))
        found, ms = run_all(conn, queries)
        recall = np.mean([len(set(a) & set(b)) / K for a, b in zip(found, truth)])
        print(f"ef_search={ef:<4} 召回率 {recall:.3f}  每条 {ms:.1f} 毫秒  比精确快 {exact_ms / ms:.0f} 倍")


if __name__ == "__main__":
    with connect() as conn:
        recall_table(conn, (10, 20, 40, 100, 200, 400))
```

<div class="line-notes">

- `K = 10` 每次取前 10 个。
- `NQ = 100` 100 条查询。
- `QUERY = "SELECT id FROM ann_demo ORDER BY embedding <=> %s LIMIT %s"` 标准写法的查询,只取 id。问题向量和 `LIMIT` 都用 `%s` 传。
- `def make_queries() -> np.ndarray:` 造 100 条查询向量。
- `rng = np.random.default_rng(11)` 种子是 11,而造表用的是 7,所以这 100 条查询向量**不在表里**。如果查询就是表里的某一行,第一名永远是它自己,不公平。
- `noise = rng.normal(size=(NQ, 1024)).astype(np.float32) / np.sqrt(1024)` 随机噪声。除以 `√1024 = 32`,让每个噪声向量的长度大约是 1(1024 个标准正态数的平方和约是 1024)。
- `queries = base_vectors[rng.integers(0, len(base_vectors), NQ)] + 0.9 * noise` 和造表同样的配方:真实向量加 0.9 倍噪声。
- `return queries / np.linalg.norm(queries, axis=1, keepdims=True)` 归一化。
- `def run_all(conn: psycopg.Connection, queries: np.ndarray) -> tuple[list[list[int]], float]:` 把每条查询各跑一遍,返回每条的 top-10 编号列表和平均耗时。
- `out.append([r[0] for r in conn.execute(QUERY, (q, K)).fetchall()])` 取出这一条查询返回的 10 个 `id`。
- `return out, (time.perf_counter() - t0) / len(queries) * 1000` 总耗时除以条数,乘 1000 换成毫秒。
- `def recall_table(conn: psycopg.Connection, efs: tuple[int, ...]) -> None:` 把整个实验包成函数,后面练习要复用。`tuple[int, ...]` 表示"任意长度的整数元组"。
- `conn.execute("SET enable_indexscan = off")` 先关掉索引,跑出标准答案 `truth`。
- `truth, exact_ms = run_all(conn, queries)` 标准答案和精确检索的平均耗时。
- `conn.execute("SET enable_indexscan = on")` 再把索引打开。
- `run_all(conn, queries)  # 先空跑一遍预热` 第一次读索引要从磁盘加载进内存,会拖慢第一个数字;空跑一遍把它读热,下面的耗时才可比。返回值不要,所以没接。
- `for ef in efs:` 逐个试 `ef_search`。
- `conn.execute(sql.SQL("SET hnsw.ef_search = {}").format(sql.Literal(ef)))` Day 232 的 `sql.Literal`:`SET` 不能用 `%s`,把整数在 Python 这边拼进去。
- `recall = np.mean([len(set(a) & set(b)) / K for a, b in zip(found, truth)])` 每条查询:索引返回的和标准答案的**集合交集**有几个,除以 10;再对 100 条取平均。`&` 是集合的交集运算。注意只比"集合",不比顺序,召回率关心的是找没找到,不是排名。
- `print(f"ef_search={ef:<4} 召回率 {recall:.3f}  每条 {ms:.1f} 毫秒  比精确快 {exact_ms / ms:.0f} 倍")` 一行输出。

</div>

```bash
uv run python -m part04.hnsw_recall
```

```text
精确(不用索引):每条 147.4 毫秒
ef_search=10   召回率 0.751  每条 1.5 毫秒  比精确快 99 倍
ef_search=20   召回率 0.896  每条 1.7 毫秒  比精确快 89 倍
ef_search=40   召回率 0.973  每条 2.2 毫秒  比精确快 68 倍
ef_search=100  召回率 0.999  每条 2.6 毫秒  比精确快 57 倍
ef_search=200  召回率 0.999  每条 3.5 毫秒  比精确快 42 倍
ef_search=400  召回率 0.999  每条 3.1 毫秒  比精确快 47 倍
```

(这台电脑上同时还有别的程序在跑,耗时那一列会抖,我连跑几次精确检索在 147 到 202 毫秒之间,所以"快多少倍"只看量级;召回率相对稳定。)

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="召回率随 ef_search 变化的折线图:ef_search 为 10、20、40、100 时召回率分别约为 0.751、0.896、0.973、0.999,之后持平;默认 ef_search 是 40">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<line x1="70" y1="20" x2="70" y2="210" stroke="var(--rule)"/>
<line x1="70" y1="210" x2="610" y2="210" stroke="var(--rule)"/>
<text x="20" y="30" fill="var(--ink-soft)" font-size="11">召回率</text>
<text x="34" y="54" fill="var(--ink-faint)" font-size="11">1.0</text>
<text x="34" y="132" fill="var(--ink-faint)" font-size="11">0.8</text>
<text x="34" y="210" fill="var(--ink-faint)" font-size="11">0.6</text>
<line x1="70" y1="50" x2="610" y2="50" stroke="var(--rule)" stroke-dasharray="2 4"/>
<polyline points="110,152 190,102 270,67 370,52 490,52 590,52" fill="none" stroke="var(--mem)" stroke-width="2.5"/>
<circle cx="110" cy="152" r="5" fill="var(--mem)"/>
<circle cx="190" cy="102" r="5" fill="var(--mem)"/>
<circle cx="270" cy="67" r="6" fill="var(--compute)"/>
<circle cx="370" cy="52" r="5" fill="var(--mem)"/>
<circle cx="490" cy="52" r="5" fill="var(--mem)"/>
<circle cx="590" cy="52" r="5" fill="var(--mem)"/>
<text x="96" y="176" fill="var(--ink-soft)" font-size="11">0.751</text>
<text x="176" y="126" fill="var(--ink-soft)" font-size="11">0.896</text>
<text x="226" y="94" fill="var(--ink)" font-size="11">0.973(默认)</text>
<text x="352" y="76" fill="var(--ink-soft)" font-size="11">0.999</text>
<text x="100" y="230" fill="var(--ink-soft)">10</text>
<text x="180" y="230" fill="var(--ink-soft)">20</text>
<text x="260" y="230" fill="var(--ink-soft)">40</text>
<text x="360" y="230" fill="var(--ink-soft)">100</text>
<text x="480" y="230" fill="var(--ink-soft)">200</text>
<text x="580" y="230" fill="var(--ink-soft)">400</text>
<text x="300" y="250" fill="var(--ink-soft)" font-size="11">ef_search</text>
</g>
</svg>
<figcaption>召回率随 ef_search 的变化(横轴是等间距的名义刻度,不是线性比例)。琥珀色点是 pgvector 默认的 40。前面涨得快,过了 100 就贴着 1.0,继续加大只是白白多花时间。</figcaption>
</figure>

读这张表的方法:每一行是"用多大的候选名单,换来多少召回,花多少时间"。`ef_search=10` 召回只有 0.751,四分之一的真近邻被漏掉;默认的 40 是 0.973,漏 2.7%;到 100 就是 0.999。再往上加,召回已经没得涨,时间反而没降。和 `graph_toy.py` 的趋势是同一条曲线:名单越长越稳,一开始涨得快,后面边际收益递减。

这里要认真提醒一点:这张表是**合成数据**上的结果。真实知识库的向量分布不一样,同样的 `ef_search=40`,召回率可能高也可能低。生产上选 `ef_search` 的做法是:用自己的数据、自己的一批典型查询,像今天这样量出召回率和耗时,再选一个"召回够用、延迟能接受"的点。别抄别人的数字。

## 第六步:LIMIT 比 ef_search 大会怎样

`ef_search` 是候选名单的长度,而名单只有 40 个,你却要 `LIMIT 100`,会怎样?新建 `part04/hnsw_limit.py`:

```python
# agent-zero-lab/part04/hnsw_limit.py
"""LIMIT 比 ef_search 大会怎样。"""
import numpy as np
import psycopg
from psycopg import sql

from part04.build_index import load_index
from part04.pg_store import connect

_, base_vectors = load_index()
q = base_vectors[3].copy()
q /= np.linalg.norm(q)


def count(conn: psycopg.Connection, limit: int) -> int:
    return len(conn.execute("SELECT id FROM ann_demo ORDER BY embedding <=> %s LIMIT %s", (q, limit)).fetchall())


with connect() as conn:
    for limit in (10, 40, 41, 100):
        print(f"LIMIT {limit:<4} 实际返回 {count(conn, limit)} 行")
    row = conn.execute("SHOW hnsw.ef_search").fetchone()
    assert row is not None
    print("(默认的 ef_search =", row[0] + ")")

    conn.execute(sql.SQL("SET hnsw.ef_search = {}").format(sql.Literal(200)))
    print("ef_search 改成 200 以后,LIMIT 100 返回", count(conn, 100), "行")

    conn.execute("SET hnsw.ef_search = 40")
    conn.execute("SET hnsw.iterative_scan = relaxed_order")
    print("ef_search=40 + iterative_scan=relaxed_order,LIMIT 100 返回", count(conn, 100), "行")
```

<div class="line-notes">

- `q = base_vectors[3].copy()` 拿第 3 个真实向量当问题。`.copy()` 复制一份,下一行才能原地修改而不影响 `base_vectors`。
- `q /= np.linalg.norm(q)` 归一化(这个向量本来就接近 1,保险起见)。
- `def count(conn: psycopg.Connection, limit: int) -> int:` 返回"这样查实际拿到几行"。
- `return len(conn.execute("SELECT id FROM ann_demo ORDER BY embedding <=> %s LIMIT %s", (q, limit)).fetchall())` 标准写法的查询,只数行数。
- `for limit in (10, 40, 41, 100):` 四个不同的 `LIMIT`。
- `print(f"LIMIT {limit:<4} 实际返回 {count(conn, limit)} 行")` 实测 10、40、40、40:`LIMIT 41` 和 `LIMIT 100` 都只返回 40 行。
- `row = conn.execute("SHOW hnsw.ef_search").fetchone()` 把当前会话的 `ef_search` 查出来看。注意这一句放在查询之后:刚连上数据库时直接 `SHOW hnsw.ef_search` 会报 `unrecognized configuration parameter`,因为 pgvector 的代码要等第一次真的用到索引时才加载进来。
- `assert row is not None` `SHOW` 一定有结果,告诉类型检查器。
- `print("(默认的 ef_search =", row[0] + ")")` 实测 40。
- `conn.execute(sql.SQL("SET hnsw.ef_search = {}").format(sql.Literal(200)))` 改成 200。
- `print("ef_search 改成 200 以后,LIMIT 100 返回", count(conn, 100), "行")` 实测 100 行。
- `conn.execute("SET hnsw.ef_search = 40")` 改回 40,后面一行要单独看另一个设置的效果。
- `conn.execute("SET hnsw.iterative_scan = relaxed_order")` pgvector 0.8.0 加的"迭代扫描":候选名单耗尽但还不够数时,索引自己继续往下找,直到凑够。默认是 `off`。
- `print("ef_search=40 + iterative_scan=relaxed_order,LIMIT 100 返回", count(conn, 100), "行")` 实测 100 行。

</div>

```bash
uv run python -m part04.hnsw_limit
```

```text
LIMIT 10   实际返回 10 行
LIMIT 40   实际返回 40 行
LIMIT 41   实际返回 40 行
LIMIT 100  实际返回 40 行
(默认的 ef_search = 40)
ef_search 改成 200 以后,LIMIT 100 返回 100 行
ef_search=40 + iterative_scan=relaxed_order,LIMIT 100 返回 100 行
```

`LIMIT 100` 只返回 40 行,**不报错也不警告**。索引的候选名单就 40 个,多要也没有。如果你的代码写的是"取 100 条候选再去重排",实际只拿到 40 条,检索质量悄悄变差。两个解法:把 `ef_search` 调到不小于 `LIMIT`;或者打开迭代扫描 `hnsw.iterative_scan`。迭代扫描在明天的过滤问题里会重点用到,因为带 `WHERE` 过滤的查询更容易出现"候选不够"。

这里顺带解释一下 [Day 232](/blog/agent-zero/day-232-pgvector-3/) 里 `SET` 不能用 `%s`:`SET hnsw.ef_search = 100` 是配置语句,必须用 `sql.Literal` 拼。

## 小结:选一个"够用"的点

HNSW 是一个用空间和一点准确性换速度的结构。今天实测的合成数据上:建索引 169 秒(内存吃紧时),占 156 MB;换来单次查询从 150 到 240 毫秒降到几毫秒(几十倍);默认参数召回 0.973。三个旋钮的分工:

| 旋钮 | 调大以后 | 什么时候动 |
| --- | --- | --- |
| `m` | 图更密,召回高,索引大,建得慢 | 建索引前,召回怎么调都上不去时 |
| `ef_construction` | 图质量高,召回高,建得慢 | 建索引前,同上 |
| `ef_search` | 召回高,单次查询慢 | 每次查询都能调,先动它 |

先用默认值,用自己的数据量一遍召回率,不够再调 `ef_search`,还不够再重建索引调 `m` 和 `ef_construction`。另一种索引 IVFFlat 先把向量聚成若干簇,查询只看最近的几个簇;它建得快、占空间小,召回一般不如 HNSW,而且要先有数据才能建,课程里不用。

## 动手练习

**练习 1:42 行的小表,强制走索引会怎样?** Day 232 的 `EXPLAIN` 里 `kb_chunks` 没用索引。用 `SET enable_seqscan = off` 逼规划器只能走索引,拿 5 道题对比"走索引"和"精确"的 top-10,看有没有漏。

<details><summary>参考答案</summary>

新建 `part04/ex_small_index.py`:

```python
# agent-zero-lab/part04/ex_small_index.py
from common.embed import embed_one
from part04.pg_store import connect

QUESTIONS = ["年付专业版用到第 3 个月想退,能退多少", "导入流水提示 E1042 怎么办", "企业版专属客服的电话是多少", "发票可以邮寄纸质版吗", "买错了能退钱吗"]
SQL = "SELECT id FROM kb_chunks ORDER BY embedding <=> %s LIMIT 10"

with connect() as conn:
    same = 0
    for q in QUESTIONS:
        v = embed_one(q)
        conn.execute("SET enable_indexscan = off")
        exact = [r[0] for r in conn.execute(SQL, (v,)).fetchall()]
        conn.execute("SET enable_indexscan = on")
        conn.execute("SET enable_seqscan = off")  # 逼规划器只能走索引
        approx = [r[0] for r in conn.execute(SQL, (v,)).fetchall()]
        conn.execute("SET enable_seqscan = on")
        same += exact == approx
        print(f"{'一致' if exact == approx else '不同'}  {q}  重合 {len(set(exact) & set(approx))}/10")
    conn.execute("SET enable_seqscan = off")
    plan = conn.execute("EXPLAIN SELECT id FROM kb_chunks ORDER BY embedding <=> %s LIMIT 10", (embed_one(QUESTIONS[0]),)).fetchall()
    text = "\n".join(r[0] for r in plan)
    print("关掉顺序扫描后,计划里用到了 HNSW 索引:", "kb_chunks_embedding_hnsw" in text)
    print(f"{same}/{len(QUESTIONS)} 题与精确完全一致")
```

<div class="line-notes">

- `SQL = "SELECT id FROM kb_chunks ORDER BY embedding <=> %s LIMIT 10"` 标准写法的查询,取 top-10。42 行里取 10 行,将近四分之一。
- `v = embed_one(q)` 每道题只算一次问题向量,精确和索引两边共用。
- `conn.execute("SET enable_indexscan = off")` 关掉索引扫描。
- `exact = [r[0] for r in conn.execute(SQL, (v,)).fetchall()]` 精确的 top-10。
- `conn.execute("SET enable_indexscan = on")` 再打开。
- `conn.execute("SET enable_seqscan = off")` 关掉顺序扫描。这样规划器手里只剩索引一条路。注意不是"禁止",只是把顺序扫描的成本调到极高,实在没别的路才会走。
- `approx = [r[0] for r in conn.execute(SQL, (v,)).fetchall()]` 走 HNSW 索引的 top-10。
- `conn.execute("SET enable_seqscan = on")` 恢复,别影响后面的查询。
- `same += exact == approx` 两个列表完全相等(内容和顺序都一样)才算一致。
- `print(f"{'一致' if exact == approx else '不同'}  {q}  重合 {len(set(exact) & set(approx))}/10")` 同时打印集合重合数。
- `text = "\n".join(r[0] for r in plan)` `EXPLAIN` 的结果是很多行,每行一个字符串,拼成一段文本,下一行检查里面有没有索引名。
- `print("关掉顺序扫描后,计划里用到了 HNSW 索引:", "kb_chunks_embedding_hnsw" in text)` 确认这次真的走了索引。

</div>

```bash
uv run python -m part04.ex_small_index
```

```text
一致  年付专业版用到第 3 个月想退,能退多少  重合 10/10
一致  导入流水提示 E1042 怎么办  重合 10/10
一致  企业版专属客服的电话是多少  重合 10/10
一致  发票可以邮寄纸质版吗  重合 10/10
一致  买错了能退钱吗  重合 10/10
关掉顺序扫描后,计划里用到了 HNSW 索引: True
5/5 题与精确完全一致
```

走了索引,5 道题 top-10 和精确完全一样。原因可以想到:42 个点的图太小,候选名单(默认 40)几乎覆盖了整张图,等于把所有点都看了一遍。HNSW 的"漏"是规模和维度带来的,图小的时候它和暴力检索没有区别。这也说明另一件事:在 42 行的表上测不出 HNSW 的问题,要用大一点的数据才有意义。

</details>

**练习 2:图连得太稀或太密会怎样?** 把 `graph_toy.py` 里的 `K_LINKS` 分别改成 2 和 10,看命中率和算距离的次数,解释为什么。

<details><summary>参考答案</summary>

不用改原文件,用 `sed` 生成临时副本跑:

```bash
for k in 2 10; do
  sed "s/N, K_LINKS = 3000, 5/N, K_LINKS = 3000, $k/" part04/graph_toy.py > part04/graph_toy_k$k.py
  echo "== K=$k"; uv run python -m part04.graph_toy_k$k; rm part04/graph_toy_k$k.py
done
```

<div class="line-notes">

- `for k in 2 10; do` shell 的循环,依次取 2 和 10。
- `sed "s/N, K_LINKS = 3000, 5/N, K_LINKS = 3000, $k/" part04/graph_toy.py > part04/graph_toy_k$k.py` 把原文件里的 `N, K_LINKS = 3000, 5` 换成 `N, K_LINKS = 3000, 2`(或 10),输出到一个新文件。双引号让 `$k` 被 shell 替换成数字。
- `echo "== K=$k"; uv run python -m part04.graph_toy_k$k; rm part04/graph_toy_k$k.py` 先打印标题,再运行副本,最后删掉它。

</div>

```text
== K=2
平均每个点连 2.6 条边
暴力检索每次要算 3000 次距离
ef=1   找对 2/500 = 0%  平均算距离 5 次
ef=2   找对 2/500 = 0%  平均算距离 6 次
ef=5   找对 2/500 = 0%  平均算距离 9 次
ef=10  找对 2/500 = 0%  平均算距离 14 次
ef=20  找对 2/500 = 0%  平均算距离 18 次
ef=50  找对 2/500 = 0%  平均算距离 18 次
== K=10
平均每个点连 11.5 条边
暴力检索每次要算 3000 次距离
ef=1   找对 482/500 = 96%  平均算距离 119 次
ef=2   找对 490/500 = 98%  平均算距离 121 次
ef=5   找对 495/500 = 99%  平均算距离 125 次
ef=10  找对 500/500 = 100%  平均算距离 133 次
ef=20  找对 500/500 = 100%  平均算距离 145 次
ef=50  找对 500/500 = 100%  平均算距离 179 次
```

K=2 时命中率是 0%,不管名单多长都一样,而且平均只算了 5 到 18 次距离,明显是"走不出去":每个点只连最近的 2 个,图碎成很多互不相通的小块,从入口 0 号点出发只能走进自己那一小块(最多 18 个点),块外的点根本到不了。`ef` 再大也没用,因为名单里本来就没有别的点。K=10 时图密,单是贪心(`ef=1`)就有 96%,但每个点要看的邻居多了,同样 `ef=1` 要算 119 次距离,而 K=5 只要 60 次。

对应 HNSW 的 `m`:`m` 太小,图连不通,召回上不去(练习 3 里 `m=8` 就是更稀的图,召回明显低);`m` 大,图更稳,但索引更大、每一步看的邻居更多、建得更慢。

</details>

**练习 3:内存和参数对建索引的影响。** 把 `maintenance_work_mem` 设成 512 MB,分别用默认的 `m=16, ef_construction=64` 和 `m=8, ef_construction=32` 重建索引,比较建索引时间、大小和召回率。

<details><summary>参考答案</summary>

新建 `part04/ex_hnsw_build.py`(它复用上面 `hnsw_recall.py` 里的 `recall_table`):

```python
# agent-zero-lab/part04/ex_hnsw_build.py
import time
from typing import LiteralString

from psycopg import sql

from part04.hnsw_recall import recall_table
from part04.pg_store import connect

CONFIGS: list[tuple[str, LiteralString]] = [
    ("默认 m=16, ef_construction=64", ""),
    ("m=8, ef_construction=32", "WITH (m = 8, ef_construction = 32)"),
]

with connect() as conn:
    conn.execute("SET maintenance_work_mem = '512MB'")  # 内存给够,图放得下,两种配置公平对比
    for name, with_clause in CONFIGS:
        conn.execute("DROP INDEX IF EXISTS ann_demo_hnsw")
        t0 = time.perf_counter()
        conn.execute(
            sql.SQL("CREATE INDEX ann_demo_hnsw ON ann_demo USING hnsw (embedding vector_cosine_ops) {w}").format(
                w=sql.SQL(with_clause)
            )
        )
        seconds = time.perf_counter() - t0
        size = conn.execute("SELECT pg_size_pretty(pg_relation_size('ann_demo_hnsw'))").fetchone()
        assert size is not None
        print(f"\n{name}:建索引 {seconds:.0f} 秒,索引 {size[0]}")
        recall_table(conn, (40, 100))
```

<div class="line-notes">

- `from typing import LiteralString` 给配置列表标注"写死的字符串",下面要用它拼 SQL。
- `CONFIGS: list[tuple[str, LiteralString]] = [` 两组配置:显示名和 `WITH` 子句。默认配置的子句是空字符串。
- `("m=8, ef_construction=32", "WITH (m = 8, ef_construction = 32)"),` 更稀、更省的参数。
- `conn.execute("SET maintenance_work_mem = '512MB'")` 建索引能用的内存提到 512 MB,两次重建都用它,对比才公平。这个值不能用 `%s` 传,这里是写死的字符串。
- `conn.execute("DROP INDEX IF EXISTS ann_demo_hnsw")` 删掉旧索引。
- `sql.SQL("CREATE INDEX ann_demo_hnsw` 整句用 `sql.SQL` 把 `WITH` 子句拼进去。如果这里图省事用 f-string,basedpyright 会报 `str` 不能赋给 `Template`(Day 229 的坑),所以老老实实走 `sql.SQL`。
- `seconds = time.perf_counter() - t0` 建索引耗时。
- `recall_table(conn, (40, 100))` 复用 `hnsw_recall.py` 里的函数,在 `ef_search` 为 40 和 100 时量召回率。

</div>

```bash
uv run python -m part04.ex_hnsw_build
```

```text
默认 m=16, ef_construction=64:建索引 45 秒,索引 156 MB
精确(不用索引):每条 180.2 毫秒
ef_search=40   召回率 0.966  每条 2.4 毫秒  比精确快 75 倍
ef_search=100  召回率 0.990  每条 2.7 毫秒  比精确快 68 倍

m=8, ef_construction=32:建索引 27 秒,索引 156 MB
精确(不用索引):每条 189.6 毫秒
ef_search=40   召回率 0.817  每条 2.5 毫秒  比精确快 74 倍
ef_search=100  召回率 0.926  每条 3.5 毫秒  比精确快 55 倍
```

三个发现。一,同样的默认参数,内存从 64 MB 加到 512 MB,建索引从 169 秒降到 45 秒,快了近 4 倍;正文里那条 `NOTICE` 说"图放不下内存会慢很多",就是这个意思。二,`m=8, ef_construction=32` 建得更快(27 秒),但召回率明显更低:`ef_search=40` 时从 0.966 掉到 0.817,`ef_search=100` 也只有 0.926。图太稀,查询时容易走进死胡同,和练习 2 的 K=2 同一个道理,只是没那么极端。三,两个索引都是 156 MB,这个规模下索引大小主要由向量本身决定,邻居列表占的部分小。我没有深究为什么 `m` 减半大小也没变,只能说实测如此。

还有一个细节:同样是默认参数,这次重建的 `ef_search=40` 召回率是 0.966,正文那个是 0.973。HNSW 每次建出来的图并不完全一样,层数是随机分配的,所以重建以后召回率会有零点几个百分点的浮动。这意味着"召回率"是索引的一个性质,换了索引要重新量。

做完练习,索引现在是 `m=8` 的版本,如果想接着做别的实验,把它重建成默认值:`DROP INDEX ann_demo_hnsw;` 再 `CREATE INDEX ann_demo_hnsw ON ann_demo USING hnsw (embedding vector_cosine_ops);`。

</details>

**练习 4:让 `ef_search` 只对一次查询生效。** `SET hnsw.ef_search = 200` 会一直影响当前连接上之后所有的查询,忘了改回来很容易出问题。用 `SET LOCAL` 加事务,让它只在一个事务里有效。

<details><summary>参考答案</summary>

新建 `part04/ex_set_local.py`:

```python
# agent-zero-lab/part04/ex_set_local.py
import psycopg
from psycopg import sql

from part04.build_index import load_index
from part04.pg_store import connect

_, base_vectors = load_index()
q = base_vectors[3]


def count(conn: psycopg.Connection, limit: int) -> int:
    return len(conn.execute("SELECT id FROM ann_demo ORDER BY embedding <=> %s LIMIT %s", (q, limit)).fetchall())


def ef(conn: psycopg.Connection) -> str:
    row = conn.execute("SHOW hnsw.ef_search").fetchone()
    assert row is not None
    return row[0]


with connect() as conn:
    count(conn, 1)  # 先用一次索引,把 pgvector 的代码加载进这个会话
    print("开始:ef_search =", ef(conn), " LIMIT 100 返回", count(conn, 100), "行")
    with conn.transaction():
        conn.execute(sql.SQL("SET LOCAL hnsw.ef_search = {}").format(sql.Literal(200)))
        print("事务里:ef_search =", ef(conn), " LIMIT 100 返回", count(conn, 100), "行")
    print("事务后:ef_search =", ef(conn), " LIMIT 100 返回", count(conn, 100), "行")
```

<div class="line-notes">

- `def ef(conn: psycopg.Connection) -> str:` 读出当前会话的 `ef_search`。
- `count(conn, 1)  # 先用一次索引,把 pgvector 的代码加载进这个会话` 刚连上就 `SHOW hnsw.ef_search` 会报 `unrecognized configuration parameter`(上面 `hnsw_limit.py` 的注释讲过),先随便查一次让它加载。
- `print("开始:ef_search =", ef(conn), " LIMIT 100 返回", count(conn, 100), "行")` 实测 40 和 40 行。
- `with conn.transaction():` 开一个事务(Day 231)。
- `conn.execute(sql.SQL("SET LOCAL hnsw.ef_search = {}").format(sql.Literal(200)))` `SET LOCAL`:这个设置**只在当前事务里有效**,事务结束(提交或回滚)自动恢复。
- `print("事务里:ef_search =", ef(conn), " LIMIT 100 返回", count(conn, 100), "行")` 事务里是 200,返回 100 行。
- `print("事务后:ef_search =", ef(conn), " LIMIT 100 返回", count(conn, 100), "行")` 事务结束,自动回到 40,返回 40 行。

</div>

```bash
uv run python -m part04.ex_set_local
```

```text
开始:ef_search = 40  LIMIT 100 返回 40 行
事务里:ef_search = 200  LIMIT 100 返回 100 行
事务后:ef_search = 40  LIMIT 100 返回 40 行
```

`SET LOCAL` 加事务是推荐的写法:需要大名单的那一次查询单独设置,用完自动恢复,不会污染同一个连接上的其他查询。连接池里的连接会被不同请求复用,这一点更重要:一个请求把 `ef_search` 改成 200 忘了恢复,下一个用到这条连接的请求就悄悄变慢了(这一点是我从连接复用的原理推出来的,今天没有专门去复现)。

</details>

验收标准:`graph_toy.py` 输出 `ef=1` 命中率约 31%、`ef=10` 约 97%;`ann_demo` 表有 20000 行、HNSW 索引建成;`EXPLAIN` 里标准写法显示 `Index Scan using ann_demo_hnsw`,`1 - 距离` 写法显示 `Seq Scan`;`hnsw_recall.py` 能打印出召回率随 `ef_search` 上升;`hnsw_limit.py` 里 `LIMIT 100` 只返回 40 行;能不看文章说出"精确和近似最近邻的区别""`m`、`ef_construction`、`ef_search` 各管什么""为什么 `ORDER BY` 不能写表达式"。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 暴力检索(精确最近邻) | 把问题和每一行都算一遍距离,保证找到真正最近的。N 行就是 N 次 |
| 近似最近邻(ANN) | 不看所有的点,用索引只看有希望的一部分,换来速度,可能漏掉真近邻 |
| 召回率(recall) | 近似方法返回的 top-k 里,有几个是精确方法的 top-k。0.97 表示平均每 10 个有 9.7 个对 |
| HNSW | 分层可导航小世界图。点连成图,查询从顶层入口出发逐层贪心靠近 |
| 贪心 | 每一步都走向当前看起来最好的方向,不回头。快,但可能困在局部最优 |
| 局部最优 | 周围的点都不比它好,但它不是全局最好的点,贪心走路会卡在这里 |
| `m` | HNSW 建索引参数:每个点每层最多连几个邻居,默认 16 |
| `ef_construction` | 建索引时每个点找邻居用的候选名单长度,默认 64 |
| `ef_search` | 查询时的候选名单长度,默认 40,越大召回越高、越慢 |
| `maintenance_work_mem` | Postgres 建索引等维护操作能用的内存,默认 64 MB;HNSW 图放不下就慢很多 |
| `SET LOCAL` | 只在当前事务内生效的设置,事务结束自动恢复 |
| 迭代扫描(iterative scan) | pgvector 0.8.0 起的功能:候选不够数时索引自己继续往下找。`hnsw.iterative_scan`,默认关 |
| Seq Scan / Index Scan | `EXPLAIN` 里的顺序扫描(逐行)和索引扫描 |
| IVFFlat | 另一种向量索引:先聚类成簇,查询只看最近的几个簇。建得快,召回一般不如 HNSW |

## 常见误区

**以为索引返回的就是精确答案。** HNSW 是近似的,召回率默认 ef_search=40 时在我们的合成数据上是 0.97,不是 1。在自己的数据上量过才知道。

**在小表上测索引。** 42 行时 HNSW 的结果和精确完全一样(练习 1),什么问题都测不出来。要在接近真实规模的数据上测召回和延迟。

**`ORDER BY` 写成表达式。** `ORDER BY 1 - (embedding <=> q) DESC` 数学上等价,但规划器不会用索引,实测 333 毫秒对 5 毫秒,而且不报错。排序直接写距离运算符。

**`LIMIT` 比 `ef_search` 大。** 默认 `ef_search=40`,`LIMIT 100` 实际只返回 40 行,没有任何提示。调大 `ef_search`,或者开迭代扫描。

**运算符类和查询运算符不匹配。** 索引用 `vector_cosine_ops` 建,查询却用 `<->`(L2),索引用不上,退回顺序扫描。索引怎么建的,查询就得用对应的运算符。

**建索引时内存不够还不知道。** 看到 `NOTICE: hnsw graph no longer fits into maintenance_work_mem` 说明建得会很慢,调大 `maintenance_work_mem` 再重建(今天从 169 秒降到 45 秒)。别把它设得超过机器的内存。

**以为召回率是常数。** 换一批数据、换一个索引(重建以后图也不同)、换 `ef_search`,召回率都会变。上线前用自己的数据量,换索引后重新量。

**连接池里 `SET` 不恢复。** `SET hnsw.ef_search` 会留在这条连接上,被后面的请求继承。需要时用 `SET LOCAL` 加事务。

**刚连上就 `SHOW hnsw.ef_search`。** 报 `unrecognized configuration parameter`,因为 pgvector 的代码要等第一次用到才加载。先 `SET` 一次或者先查一次。

## 学习资料

### 文档与文章

- [pgvector 官方 README · HNSW](https://github.com/pgvector/pgvector#hnsw):读 `Index Options`、`Query Options`、`Index Build Time` 和 `Iterative Index Scans`,今天的参数默认值、`maintenance_work_mem` 的提示都在这里。
- [Pinecone · Hierarchical Navigable Small Worlds (HNSW)](https://www.pinecone.io/learn/series/faiss/hnsw/):英文,配了很多图的 HNSW 讲解,从跳表讲到分层图,读完能把今天的分层示意图和代码对上。
- [HNSW 原论文(Malkov & Yashunin)](https://arxiv.org/abs/1603.09320):《Efficient and robust approximate nearest neighbor search using Hierarchical Navigable Small World graphs》,不用通读,看图 1 和第 4 节的搜索算法,对照 `graph_toy.py` 的 `walk()`。
- [PostgreSQL 文档 · CREATE INDEX](https://www.postgresql.org/docs/17/sql-createindex.html):看 `CONCURRENTLY` 一节,理解为什么线上大表建索引要小心。
- [ANN-Benchmarks](https://ann-benchmarks.com/):各种近似最近邻算法的公开评测,横轴是召回率、纵轴是每秒查询数,看 HNSW 在图的什么位置。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ap421d7Hf&autoplay=0&high_quality=1" title="向量数据库相似性搜索算法:ANN、IVF、HNSW" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>ZOMI酱 · 向量数据库相似性搜索算法:ANN、IVF、HNSW · 约 14 分钟,把暴力检索、IVF、HNSW 放在一起讲,对应今天的第一、二步。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1hzYW6zE3o&autoplay=0&high_quality=1" title="HNSW到底为什么快?从分层图到M、efSearch,一次讲透向量检索" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小芽编程工坊 · HNSW到底为什么快?从分层图到M、efSearch · 约 29 分钟,专讲分层图和 m、ef_search 两个参数,和今天的参数表对照着看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Ua6LDIOVN1s" title="18 Months of Pgvector Learnings in 47 Minutes (Tutorial)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Tiger Data · 18 Months of Pgvector Learnings in 47 Minutes · 英文,47 分钟,生产里用 pgvector 的经验,建索引、调参、过滤都有,明天过滤那一课之前可以先看相关的一段。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 6 章讲检索时对近似最近邻和几类索引(含 HNSW、IVF)各有一段概述,适合读完今天的实验后看一遍,把名词对上号。

### 开源项目与代码

- [nmslib/hnswlib](https://github.com/nmslib/hnswlib):HNSW 论文作者之一参与的 C++ 实现,带 Python 绑定,代码量小,适合对照论文读。
- [pgvector/pgvector 的 hnswbuild.c](https://github.com/pgvector/pgvector/blob/master/src/hnswbuild.c):pgvector 建 HNSW 索引的代码,里面能找到今天那条 `maintenance_work_mem` 的提示是怎么触发的。

## 自测

**1. 暴力检索一次查询在 100 万行、1024 维的表上要做多少次乘加?为什么不能靠"写得更快"解决?**

<details><summary>答案</summary>

100 万 × 1024 = 10.24 亿次。优化实现最多快几倍到十几倍,而数据量涨十倍查询时间就涨十倍,线性增长追不上。要靠近似索引把"每次要看的点"从 N 降到几百几千。

</details>

**2. `ef_search` 是什么?把它从 40 改到 10 会发生什么?为什么?**

<details><summary>答案</summary>

查询时候选名单的长度,每一步会同时保留这么多个最好的点。改小以后查询更快、召回更低:实测 ef_search=10 召回率 0.751,40 是 0.973。名单短,走路更容易被带进局部最优,漏掉真近邻。

</details>

**3. 下面两条 SQL 数学上等价,为什么第二条很慢?**

```sql
SELECT id FROM t ORDER BY embedding <=> %s LIMIT 10;
SELECT id FROM t ORDER BY 1 - (embedding <=> %s) DESC LIMIT 10;
```

<details><summary>答案</summary>

规划器只在 `ORDER BY` 后面直接是距离运算符时才会使用 HNSW 索引。第二条把它包进了表达式,规划器当作普通表达式处理,退回顺序扫描加排序。实测 5.2 毫秒对 333 毫秒,而且两条都不报错。

</details>

**4. 为什么 `SELECT id FROM ann_demo ORDER BY embedding <=> q LIMIT 100` 只返回了 40 行?怎么办?**

<details><summary>答案</summary>

HNSW 查询的候选名单长度是 `ef_search`,默认 40,索引最多只能给出 40 个候选,`LIMIT 100` 也只拿得到 40 行,没有任何错误或警告。解决:把 `ef_search` 调到不小于 `LIMIT`,或者打开 `hnsw.iterative_scan`。只改一次查询的话用 `SET LOCAL` 放在事务里。

</details>

**5. 面试题:你的向量检索服务上线后延迟很高,你怎么排查?**

<details><summary>答案</summary>

先用 `EXPLAIN ANALYZE` 看这条查询到底有没有走向量索引:`ORDER BY` 是不是直接写了距离运算符、运算符和索引的 `vector_*_ops` 是不是匹配、表的统计信息是否正常、是不是带了让索引无法使用的过滤条件。走了索引再看参数:`ef_search` 是不是设得太大,`LIMIT` 是否过大。再看资源:索引是否在内存里(`shared_buffers` 和系统缓存是否装得下索引),建索引的 `maintenance_work_mem` 是否不足导致图质量或建构方式出问题。最后看召回:用一批典型查询对比精确检索,量召回率和延迟,在二者之间选点。只调延迟不看召回,可能把检索质量悄悄调坏。

</details>

## 明天预告

明天是 [Day 234 · 过滤的坑和向量库选型](/blog/agent-zero/day-234-filter-pitfall/)。今天看到索引是先在图上找候选、再返回的;如果这时候再加一个 `WHERE category = '退款'`,是先过滤还是后过滤?过滤得很严的时候会发生什么?明天用今天这张 2 万行的表复现"结果变少了",再看迭代扫描怎么补救,最后把 pgvector 和 Milvus、Qdrant 等放在一起做个选型表。
