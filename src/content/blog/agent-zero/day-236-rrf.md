---
title: 'Day 236 · RRF:把两路结果合起来'
description: '向量检索一份名次,BM25 一份名次,分数一个 0.5 左右、一个能到 20,不能直接相加。今天手算 RRF(每一路排第 r 名得 1/(60+r) 分),写出 10 行的 fusion.py,在 17 道标好答案的题上对比只向量、只 BM25、分数相加、RRF 四种做法,看到 RRF 把 E2017 从向量的第 7 名救到第 2 名,但也没有每题都赢;再拆开账本看 k=60 到底在管什么,试加权和三路融合。'
pubDate: 2026-10-23
regime: none
tags: ['rrf', 'hybrid-search', 'bm25', 'retrieval', 'agent-zero']
series: 'agent-zero'
day: 236
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 235](/blog/agent-zero/day-235-bm25/) 写了 `bm25_index.py`:jieba 分词加业务词典,停用词表,`BM25Index(chunks).search(query, k)` 返回 `(块, 分数)` 的列表。它把向量检索排在第 7 名的 E2017 拉回了第 1 名,但对"买错了能把钱要回来吗"一块都找不到,因为文档写的是"退款",字面上一个词都对不上。两路各有各的盲区,正好互补。

问题是,现在手里有两份排名,一份来自向量(分数是 0 到 1 的相似度),一份来自 BM25(分数是几到几十的原始分),用户只想看一份结果。今天就写这个"合并"的一步。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清为什么两路的**分数**不能直接相加,并写出一个只看**名次**的融合办法:RRF,每一路排第 `r` 名的块得 `1 / (k + r)` 分,各路相加。
2. 手算一个 RRF 例子,写出 `fusion.py` 里 10 行的 `rrf()`。
3. 在 17 道标好答案的题上,用名次和 MRR 比较"只向量、只 BM25、分数相加、RRF",会读这张表,包括看出 RRF **没有**每题都赢。
4. 拆开 RRF 的账,说出 `k = 60` 在管什么,并试一次加权和三路融合。

预计用时 2.5 小时:手算和 `fusion.py` 30 分钟,评测题和四种做法对比 60 分钟,拆账和 `k` 30 分钟,剩下做练习。前置:[Day 235](/blog/agent-zero/day-235-bm25/) 的 `bm25_index.py`,[Day 232](/blog/agent-zero/day-232-pgvector-3/) 的 `pg_store.search()`,[Day 24](/blog/agent-zero/day-024-dicts/) 的字典和 [Day 23](/blog/agent-zero/day-023-comprehensions/) 的推导式。

今天要用到 embedding 接口,17 个评测问题各算一次向量,按 Day 217 选的 bge-m3 免费,花费 0 元;`kb_chunks` 表里要有 42 块(Day 231 `sync_chunks` 灌进去的)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `fusion.py` 里的 `rrf()`,再默写 `first_rank()` 和 MRR 的算法;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先想一个最直接的办法,看它错在哪

两份结果各有一个分数,最直觉的合并办法是:同一块在两路里的分数加起来。拿"导入时报 E2017"这个问题,两路各自的前几名分数是:

- 向量检索:0.518、0.511、0.475……(余弦相似度,Day 235 的 `vector_blindspot.py` 打印过)
- BM25:3.88、3.68、2.88……(原始分,Day 235 的 `bm25_index.py` 打印过)

直接相加,BM25 那一项比向量那一项大了好几倍,最后的名次基本就是 BM25 的名次,向量等于白查。换个问题,BM25 第一名可能是 20.58(`年付专业版用到第 3 个月想退`),向量的 0.7 彻底被淹没;再换个问题,BM25 一块都找不到,全是向量说了算。**两种分数的量纲不一样,而且每个问题的分布都不一样,没法用一个固定比例混在一起。**

那把每一路先缩放到 0 到 1 再相加呢?(叫 min-max 归一化,每路里最高的分记 1,最低的记 0。)可以,今天的评测里我也做了这一种,叫"分数相加"。缺点是它依赖每路取多少条:前 20 名和前 5 名,最低分不同,缩放出来的数就不同,而且一个离群的高分会把别人都压扁。

RRF 的办法是干脆**不看分数,只看名次**。

## RRF:只看名次

RRF 是 Reciprocal Rank Fusion 的缩写,中文叫倒数排名融合。规则只有一条:每一路里排第 `r` 名的块,得 `1 / (k + r)` 分,`k` 是一个常数,通常取 60;一个块在几路里出现过,几路的得分加起来,就是它的最终得分。

手算一个例子。向量检索排名是 `[kb-011#1, kb-010#1, kb-009#2]`,BM25 排名是 `[kb-010#1, kb-010#2]`,取 `k = 60`:

- kb-010#1:向量第 2 名,得 1/62 = 0.01613;BM25 第 1 名,得 1/61 = 0.01639;合计 **0.0325**
- kb-011#1:只在向量里,第 1 名,得 1/61 = 0.0164
- kb-010#2:只在 BM25 里,第 2 名,得 1/62 = 0.0161
- kb-009#2:只在向量里,第 3 名,得 1/63 = 0.0159

kb-010#1 在两路里都排得靠前,融合后排第一。这是 RRF 的直觉:**被多路同时认可的,比只被一路高度认可的更可信**。`k = 60` 的作用是把分数压平:第 1 名得 1/61,第 10 名得 1/70,差距只有 15%,没有哪一路的第 1 名能一家独大;`k` 越小,头部的名次越重要,`k` 越大,越像是"出现了就行"。下面会实测。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="RRF 融合示意:向量检索前 7 名里 kb-012#1 排第 7、kb-010#2 排第 4;BM25 前 5 名里 kb-012#1 排第 1、kb-010#2 排第 2;RRF 把两路相加,kb-010#2 得 0.0318 排第一,kb-012#1 得 0.0313 排第二">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--mem)">向量检索(前 7 名)</text>
<text x="240" y="24" fill="var(--compute)">BM25(前 5 名)</text>
<text x="470" y="24" fill="var(--ink)">RRF 融合(k=60)</text>
<g>
<rect x="20" y="36" width="170" height="26" rx="3" fill="none" stroke="var(--rule)"/><text x="30" y="53" fill="var(--ink-soft)">1  kb-014#1</text>
<rect x="20" y="66" width="170" height="26" rx="3" fill="none" stroke="var(--rule)"/><text x="30" y="83" fill="var(--ink-soft)">2  kb-014#2</text>
<rect x="20" y="96" width="170" height="26" rx="3" fill="none" stroke="var(--rule)"/><text x="30" y="113" fill="var(--ink-soft)">3  kb-009#1</text>
<rect x="20" y="126" width="170" height="26" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="30" y="143" fill="var(--ink)">4  kb-010#2</text>
<rect x="20" y="156" width="170" height="26" rx="3" fill="none" stroke="var(--rule)"/><text x="30" y="173" fill="var(--ink-soft)">5  kb-009#2</text>
<text x="30" y="203" fill="var(--ink-faint)">6  ...</text>
<rect x="20" y="212" width="170" height="26" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="30" y="229" fill="var(--ink)">7  kb-012#1</text>
</g>
<g>
<rect x="240" y="36" width="170" height="26" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="250" y="53" fill="var(--ink)">1  kb-012#1</text>
<rect x="240" y="66" width="170" height="26" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="250" y="83" fill="var(--ink)">2  kb-010#2</text>
<rect x="240" y="96" width="170" height="26" rx="3" fill="none" stroke="var(--rule)"/><text x="250" y="113" fill="var(--ink-soft)">3  kb-012#2</text>
<rect x="240" y="126" width="170" height="26" rx="3" fill="none" stroke="var(--rule)"/><text x="250" y="143" fill="var(--ink-soft)">4  kb-009#2</text>
<rect x="240" y="156" width="170" height="26" rx="3" fill="none" stroke="var(--rule)"/><text x="250" y="173" fill="var(--ink-soft)">5  kb-009#1</text>
</g>
<g>
<rect x="470" y="36" width="150" height="40" rx="3" fill="none" stroke="var(--ink)"/><text x="480" y="53" fill="var(--ink)">1  kb-010#2</text><text x="480" y="69" fill="var(--ink-soft)" font-size="11">0.0156 + 0.0161</text>
<rect x="470" y="82" width="150" height="40" rx="3" fill="none" stroke="var(--ink)"/><text x="480" y="99" fill="var(--ink)">2  kb-012#1</text><text x="480" y="115" fill="var(--ink-soft)" font-size="11">0.0149 + 0.0164</text>
<rect x="470" y="128" width="150" height="40" rx="3" fill="none" stroke="var(--rule)"/><text x="480" y="145" fill="var(--ink-soft)">3  kb-009#1</text><text x="480" y="161" fill="var(--ink-faint)" font-size="11">0.0159 + 0.0154</text>
</g>
<path d="M190 225 L240 49" fill="none" stroke="var(--mem)" stroke-width="1.5"/>
<path d="M190 139 L240 79" fill="none" stroke="var(--mem)" stroke-width="1.5"/>
<line x1="410" y1="49" x2="470" y2="95" stroke="var(--ink-faint)"/>
<line x1="410" y1="79" x2="470" y2="55" stroke="var(--ink-faint)"/>
<text x="20" y="268" fill="var(--ink-soft)" font-size="11">问:导入时报 E2017。蓝线是同一块在两路里的位置。真正的答案 kb-012#1 向量第 7、BM25 第 1,融合后第 2。</text>
<text x="20" y="286" fill="var(--ink-soft)" font-size="11">第 1 名 kb-010#2(E1042,同样是导入类错误)在两路里都靠前,略高一点点。</text>
</g>
</svg>
<figcaption>RRF 对"导入时报 E2017"的融合,数字来自下面 `rrf_trace.py` 的实跑。两路各自靠前的块被抬高,只被一路认可的块被压下去。</figcaption>
</figure>

## 写成代码:fusion.py

RRF 的代码只有 10 行。新建 `part04/fusion.py`:

```python
# agent-zero-lab/part04/fusion.py
"""把几路检索的名次合成一份:RRF(Reciprocal Rank Fusion,倒数排名融合)。"""
from collections import defaultdict


def rrf(rankings: list[list[str]], k: int = 60) -> list[tuple[str, float]]:
    """每一路里排第 r 名的块得 1/(k+r) 分,各路相加,按总分从高到低返回。只看名次,不看原始分数。"""
    scores: dict[str, float] = defaultdict(float)
    for ranking in rankings:
        for rank, cid in enumerate(ranking, start=1):
            scores[cid] += 1.0 / (k + rank)
    return sorted(scores.items(), key=lambda kv: -kv[1])


if __name__ == "__main__":
    vector = ["kb-011#1", "kb-010#1", "kb-009#2"]
    keyword = ["kb-010#1", "kb-010#2"]
    for cid, s in rrf([vector, keyword]):
        print(f"{s:.4f}  {cid}")
```

<div class="line-notes">

- `from collections import defaultdict` `defaultdict` 是字典的一种,访问不存在的键时自动创建一个默认值,不会报 `KeyError`。Day 24 学的普通字典没有这个本事。
- `def rrf(rankings: list[list[str]], k: int = 60) -> list[tuple[str, float]]:` 输入是"几路排名":外层列表是各路,每一路是块编号的列表(已经排好序,第一个最好)。返回按得分从高到低排好的 `(块编号, 得分)`。
- `scores: dict[str, float] = defaultdict(float)` 键是块编号,值是累计得分。`defaultdict(float)` 的意思是"没见过的键,默认值是 `float()`,也就是 0.0"。所以下面可以直接 `+=`,不用先判断键在不在。TS 里要写 `scores[cid] = (scores[cid] ?? 0) + x`。
- `for ranking in rankings:` 逐路处理。
- `for rank, cid in enumerate(ranking, start=1):` `enumerate` 同时给出下标和元素;`start=1` 让下标从 1 开始,因为"名次"是从第 1 名数起的。代入向量那一路 `["kb-011#1", "kb-010#1", "kb-009#2"]`,依次得到 `(1, "kb-011#1")`、`(2, "kb-010#1")`、`(3, "kb-009#2")`。
- `scores[cid] += 1.0 / (k + rank)` 核心一行。向量第 2 名的 kb-010#1:`1.0 / (60 + 2) = 0.01613`;它在 BM25 里第 1 名,轮到 BM25 那一路时再加 `1.0 / (60 + 1) = 0.01639`,同一个键累加两次,合计 0.03252。**多路都出现的块自然得分高,这就是"多路认可"的来源。**
- `return sorted(scores.items(), key=lambda kv: -kv[1])` `scores.items()` 得到 `(键, 值)` 元组的序列;`kv[1]` 是得分,加负号就是从大到小排。`lambda kv: -kv[1]` 是个一次性的小函数,相当于 JS 的 `kv => -kv[1]`。
- `vector = ["kb-011#1", "kb-010#1", "kb-009#2"]` 脚本直接运行时的演示数据,就是上面手算用的。
- `keyword = ["kb-010#1", "kb-010#2"]` BM25 那一路,只有两块。
- `for cid, s in rrf([vector, keyword]):` 把两路放进外层列表交给 `rrf`。
- `print(f"{s:.4f}  {cid}")` 保留 4 位小数打印。

</div>

```bash
uv run python -m part04.fusion
```

```text
0.0325  kb-010#1
0.0164  kb-011#1
0.0161  kb-010#2
0.0159  kb-009#2
```

和手算的四个数一致。注意一件事:`rrf()` 对"块"一无所知,它只认字符串编号。这是故意的:它不用知道你的块是什么类型,几路都可以,明天要把它用在别的东西上也不用改。

写代码时常见两个笔误:返回类型写成 `tuple(str, float)`(类型标注里要用方括号 `tuple[str, float]`,圆括号在运行时就会报错);循环里变量叫 `rid`,下一行却用 `cid`,报 `NameError: name 'cid' is not defined`。

## 评测:17 道题,四种做法

光看一两个例子不够。要比较"只向量、只 BM25、分数相加、RRF",需要一组**标好正确答案**的问题。这组题就是一把尺子。我给 42 块知识库写了 17 个问题,每个问题对着原文标出"哪几块算对"。这里有一个取舍要先说:标答案是人的判断,有些问题有不止一块合理的答案,我标得比较严,比如"买错了能把钱要回来吗",我只把年付退款、月付退款、申请退款这三块算对,没把"重复扣款"那块(kb-002#3)算进去。所以向量检索把它排第 1 名时,在我的尺子上只算第 2 名。换一个人标,数字会不同,这很正常,重点是**同一把尺子量四种做法**。

用什么指标?两个,都很简单。**第一个正确块排第几名**(`first_rank`):它越靠前越好。**MRR**(Mean Reciprocal Rank,平均倒数名次):每个问题取"第一个正确块名次的倒数",第 1 名记 1,第 2 名记 0.5,第 7 名记 0.143,没找到记 0,再对所有问题求平均。1.0 是满分。

新建 `part04/hybrid_eval.py`:

```python
# agent-zero-lab/part04/hybrid_eval.py
"""17 个问题,每个标好「该找到哪几块」,比较:只用向量 / 只用 BM25 / 分数相加 / RRF。"""
from collections import defaultdict

from common.embed import embed_one
from part04.bm25_index import BM25Index
from part04.chunking import load_chunks
from part04.fusion import rrf
from part04.pg_store import connect, search

EVAL: list[tuple[str, set[str]]] = [
    ("E1043 是什么错误", {"kb-011#1", "kb-011#2"}),
    ("导入时报 E2017", {"kb-012#1", "kb-012#2"}),
    ("提示 E4029 怎么办", {"kb-019#2"}),
    ("支付失败 E3001 怎么处理", {"kb-013#1", "kb-013#2"}),
    ("买错了能把钱要回来吗", {"kb-002#1", "kb-002#2", "kb-003#1"}),
    ("年付专业版用到第 3 个月想退,能退多少", {"kb-002#1"}),
    ("发票抬头开错了怎么办", {"kb-007#1"}),
    ("专业版最多几个人", {"kb-015#2"}),
    ("扣款失败了会怎样", {"kb-004#2"}),
    ("旧手机号不用了怎么换绑", {"kb-016#2"}),
    ("企业版误删数据能找回吗", {"kb-018#2"}),
    ("每分钟请求太多被限流了", {"kb-019#2"}),
    ("Excel 另存为 CSV 后导入失败", {"kb-011#1", "kb-011#2"}),
    ("账号注销后数据多久删除", {"kb-017#2"}),
    ("增值税专用发票谁能开", {"kb-006#1"}),
    ("优惠码能和企业版一起用吗", {"kb-008#1"}),
    ("钱被扣了两次", {"kb-002#3"}),
]
TOP = 20  # 每一路各取前 20 名再融合
bm25 = BM25Index(load_chunks())


def first_rank(ids: list[str], gold: set[str]) -> int | None:
    """第一个正确块排第几(从 1 数);前 20 名里一个都没有就是 None。"""
    return next((i for i, cid in enumerate(ids, start=1) if cid in gold), None)


def score_sum(vec: list[tuple[str, float]], kw: list[tuple[str, float]]) -> list[str]:
    """反面教材:各自缩放到 0–1 再直接相加。"""
    total: dict[str, float] = defaultdict(float)
    for scored in (vec, kw):
        if not scored:
            continue
        lo, hi = min(s for _, s in scored), max(s for _, s in scored)
        for cid, s in scored:
            total[cid] += (s - lo) / (hi - lo) if hi > lo else 1.0
    return [cid for cid, _ in sorted(total.items(), key=lambda kv: -kv[1])]


def summarize(name: str, ranks: list[int | None]) -> None:
    hit3 = sum(r is not None and r <= 3 for r in ranks)
    mrr = sum(1 / r for r in ranks if r) / len(ranks)
    print(f"{name:<10} 前 3 名命中 {hit3:>2}/{len(ranks)}   MRR {mrr:.3f}")


if __name__ == "__main__":
    ranks: dict[str, list[int | None]] = {"向量": [], "BM25": [], "分数相加": [], "RRF": []}
    print("第一个正确块的名次(- 表示前 20 名里一个都没有)")
    print(f"{'向量':>4}{'BM25':>6}{'分数相加':>6}{'RRF':>5}  问题")
    with connect() as conn:
        for q, gold in EVAL:
            vec = [(c.id, s) for c, s in search(conn, embed_one(q), TOP)]
            kw = [(c.id, s) for c, s in bm25.search(q, TOP)]
            lists = {
                "向量": [cid for cid, _ in vec],
                "BM25": [cid for cid, _ in kw],
                "分数相加": score_sum(vec, kw),
                "RRF": [cid for cid, _ in rrf([[c for c, _ in vec], [c for c, _ in kw]])],
            }
            row = {name: first_rank(ids, gold) for name, ids in lists.items()}
            for name, r in row.items():
                ranks[name].append(r)
            cells = [f"{r if r else '-':>{w}}" for r, w in zip(row.values(), (4, 6, 8, 5))]
            print("".join(cells) + f"  {q}")
    print()
    for name, rs in ranks.items():
        summarize(name, rs)
```

<div class="line-notes">

- `from collections import defaultdict` 下面的 `score_sum` 要用。
- `from part04.bm25_index import BM25Index` Day 235 的 BM25 索引类。
- `from part04.fusion import rrf` 刚才写的。
- `EVAL: list[tuple[str, set[str]]] = [` 评测集。每一项是一个元组 `(问题, 正确块编号的集合)`。类型标注 `list[tuple[str, set[str]]]` 是"元组的列表,元组里是一个字符串和一个字符串集合"。
- `("E1043 是什么错误", {"kb-011#1", "kb-011#2"}),` 正确答案是 E1043 那篇的两块。花括号里只有值,是集合。
- `("导入时报 E2017", {"kb-012#1", "kb-012#2"}),` Day 235 的盲区问题。
- `("买错了能把钱要回来吗", {"kb-002#1", "kb-002#2", "kb-003#1"}),` 前面说过的取舍,三块算对。
- `("钱被扣了两次", {"kb-002#3"}),` 口语,和"重复扣款"没有一个共同词,BM25 会找不到。
- `TOP = 20` 每一路各取前 20 名交给融合。融合只需要名次,多取一些让靠后的块也有机会。
- `bm25 = BM25Index(load_chunks())` 脚本导入时就建好 BM25 索引,别的脚本 `from part04.hybrid_eval import bm25` 能复用。
- `def first_rank(ids: list[str], gold: set[str]) -> int | None:` 输入一路排好的块编号列表和正确集合,返回第一个正确块的名次。`int | None` 是"整数或者空"的类型标注(Day 46)。
- `return next((i for i, cid in enumerate(ids, start=1) if cid in gold), None)` 一个生成器表达式加 `next`:`enumerate(ids, start=1)` 给出 `(名次, 块编号)`,`if cid in gold` 保留正确的,`next(...)` 取第一个,取不到就返回第二个参数 `None`。代入"导入时报 E2017"的向量排名,`kb-012#1` 在第 7 位,返回 7。
- `def score_sum(vec: list[tuple[str, float]], kw: list[tuple[str, float]]) -> list[str]:` "反面教材":分数缩放后相加。输入两路 `(块编号, 分数)`,返回按总分排好的块编号。
- `total: dict[str, float] = defaultdict(float)` 同 `rrf()`。
- `for scored in (vec, kw):` 逐路处理。
- `if not scored:` 这一路是空的(BM25 一块都没找到)就跳过,下一行 `continue`。
- `lo, hi = min(s for _, s in scored), max(s for _, s in scored)` 这一路里最低分和最高分。
- `total[cid] += (s - lo) / (hi - lo) if hi > lo else 1.0` min-max 归一化:最高分变成 1,最低分变成 0。如果这一路只有一个分数(`hi == lo`),记 1.0,避免除以 0。
- `def summarize(name: str, ranks: list[int | None]) -> None:` 打印一种做法的两个汇总指标。
- `hit3 = sum(r is not None and r <= 3 for r in ranks)` 前 3 名里有正确块的问题数。
- `mrr = sum(1 / r for r in ranks if r) / len(ranks)` `if r` 排除 `None`(没找到的当 0 分,不在分子里,但分母仍然是全部问题数)。
- `ranks: dict[str, list[int | None]] = {"向量": [], "BM25": [], "分数相加": [], "RRF": []}` 四种做法各一个列表,逐题把名次填进去。
- `vec = [(c.id, s) for c, s in search(conn, embed_one(q), TOP)]` 向量一路:块换成编号,保留分数。`search` 是 Day 232 的。
- `kw = [(c.id, s) for c, s in bm25.search(q, TOP)]` BM25 一路。
- `lists = {` 四种做法各自的"最终排名"。
- `"RRF": [cid for cid, _ in rrf([[c for c, _ in vec], [c for c, _ in kw]])],` 内层 `[c for c, _ in vec]` 把 `(编号, 分数)` 里的分数扔掉,只留名次顺序,这就是"RRF 只看名次"在代码里的样子。
- `row = {name: first_rank(ids, gold) for name, ids in lists.items()}` 字典推导式:每种做法的第一个正确块名次。
- `cells = [f"{r if r else '-':>{w}}" for r, w in zip(row.values(), (4, 6, 8, 5))]` 把名次排成一行,`None` 显示成 `-`;`{w}` 嵌套在格式里指定列宽。
- `print("".join(cells) + f"  {q}")` 名次放前面、问题放最后,中文宽度不一样,放最后列就不会错位。

</div>

```bash
uv run python -m part04.hybrid_eval
```

(第一次导入 `jieba` 会有几行 `SyntaxWarning`,Day 235 讲过,忽略。)

```text
第一个正确块的名次(- 表示前 20 名里一个都没有)
  向量  BM25  分数相加  RRF  问题
   1     1       1    1  E1043 是什么错误
   7     1       2    2  导入时报 E2017
   1     1       1    1  提示 E4029 怎么办
   1     1       1    1  支付失败 E3001 怎么处理
   2     -       2    2  买错了能把钱要回来吗
   1     1       1    1  年付专业版用到第 3 个月想退,能退多少
   1     1       1    1  发票抬头开错了怎么办
   1     1       1    1  专业版最多几个人
   1     1       1    1  扣款失败了会怎样
   1     1       1    1  旧手机号不用了怎么换绑
   1     1       1    1  企业版误删数据能找回吗
   1     1       1    1  每分钟请求太多被限流了
   1     1       1    1  Excel 另存为 CSV 后导入失败
   1     1       1    1  账号注销后数据多久删除
   1     1       1    1  增值税专用发票谁能开
   1     1       1    1  优惠码能和企业版一起用吗
   1     -       1    1  钱被扣了两次

向量         前 3 名命中 16/17   MRR 0.920
BM25       前 3 名命中 15/17   MRR 0.882
分数相加       前 3 名命中 17/17   MRR 0.941
RRF        前 3 名命中 17/17   MRR 0.941
```

诚实地读这张表。**大部分问题(14/17)四种做法都排第 1 名**:42 块的小知识库、写得很规整的文章,不管哪一路都找得到,这组题其实偏容易。能分出高下的只有三个问题:

- "导入时报 E2017":向量第 7 名,BM25 第 1 名,RRF 第 2 名。融合把向量的"掉到第 7 名"补救成了第 2 名,但没有拿到 BM25 的第 1 名。
- "买错了能把钱要回来吗":向量第 2 名,BM25 一块都没找到(`-`),RRF 第 2 名,和向量一样。BM25 缺席时,RRF 退化成向量一路的名次,不会被拖累。
- "钱被扣了两次":BM25 找不到,向量第 1 名,RRF 第 1 名。同上。

汇总:只用向量,前 3 名命中 16/17,MRR 0.920;只用 BM25,命中 15/17,MRR 0.882;RRF 前 3 名命中 17/17,MRR 0.941。**RRF 是四种里最好的(并列),但领先幅度很小(MRR 0.941 对 0.920),因为这组题太容易。** 分数相加(min-max 之后)和 RRF 在这 17 题上完全平手,这一点我也没想到,说明在这么小的数据上它们的差别量不出来。

这个结果对你的启示是:**RRF 的价值是兜底。** 它不保证每个问题都拿第 1 名,但保证不会像只用一路那样掉到第 7 名或者干脆找不到:任何一路缺席都不会让结果变差,任何一路掉链子也有另一路拉着。要在你自己的数据上证明混合检索有用,需要更大、更难的评测集,这是后面评测部分的事,今天不展开。

## 拆开账本:E2017 为什么是第 2 名

RRF 没把正确答案推到第 1 名,是为什么?拆开看一看。新建 `part04/rrf_trace.py`:

```python
# agent-zero-lab/part04/rrf_trace.py
"""拆开看 RRF 的账:一个问题,融合后前 5 名,每一块在两路里各排第几、各贡献多少分。再换几个 k 看名次变不变。"""
from common.embed import embed_one
from part04.bm25_index import BM25Index
from part04.chunking import load_chunks
from part04.fusion import rrf
from part04.pg_store import connect, search

Q = "导入时报 E2017"
bm25 = BM25Index(load_chunks())
with connect() as conn:
    vec = [c.id for c, _ in search(conn, embed_one(Q), 20)]
kw = [c.id for c, _ in bm25.search(Q, 20)]
print(f"问:{Q}")
print(f"向量前 5:{vec[:5]}")
print(f"BM25 前 5:{kw[:5]}")

K = 60
print(f"\nk={K} 的融合结果(前 5):")
for cid, total in rrf([vec, kw], K)[:5]:
    rv = vec.index(cid) + 1 if cid in vec else None
    rk = kw.index(cid) + 1 if cid in kw else None
    part_v = f"{1 / (K + rv):.4f}" if rv else "  -  "
    part_k = f"{1 / (K + rk):.4f}" if rk else "  -  "
    print(f"  {total:.4f} = {part_v} + {part_k}   {cid:<9} 向量第 {rv or '-'} 名,BM25 第 {rk or '-'} 名")

print("\n换不同的 k,前 3 名是:")
for k in [1, 10, 60, 1000]:
    print(f"  k={k:<5}", [cid for cid, _ in rrf([vec, kw], k)[:3]])
```

<div class="line-notes">

- `Q = "导入时报 E2017"` 要拆账的问题。
- `bm25 = BM25Index(load_chunks())` 建 BM25 索引。
- `vec = [c.id for c, _ in search(conn, embed_one(Q), 20)]` 向量这一路,只留块编号,按名次顺序。
- `kw = [c.id for c, _ in bm25.search(Q, 20)]` BM25 这一路。
- `print(f"向量前 5:{vec[:5]}")` 先看两路各自的前 5 名。`vec[:5]` 是切片,取前 5 个。
- `K = 60` 常数 `k`,放在一个变量里,下面每行都用到。
- `for cid, total in rrf([vec, kw], K)[:5]:` 取融合结果的前 5 名。
- `rv = vec.index(cid) + 1 if cid in vec else None` `list.index(x)` 返回元素的下标(从 0 起),加 1 才是名次;不在这一路里就是 `None`。
- `part_v = f"{1 / (K + rv):.4f}" if rv else "  -  "` 这一路给它贡献的分数,没出现就写一个占位。
- `print(f"  {total:.4f} = {part_v} + {part_k}   {cid:<9} 向量第 {rv or '-'} 名,BM25 第 {rk or '-'} 名")` 总分拆成两项之和,并列出两个名次。
- `for k in [1, 10, 60, 1000]:` 换四个 `k` 看前 3 名变不变。
- `print(f"  k={k:<5}", [cid for cid, _ in rrf([vec, kw], k)[:3]])` 每个 `k` 下融合结果的前 3 名。

</div>

```bash
uv run python -W ignore -m part04.rrf_trace
```

```text
问:导入时报 E2017
向量前 5:['kb-014#1', 'kb-014#2', 'kb-009#1', 'kb-010#2', 'kb-009#2']
BM25 前 5:['kb-012#1', 'kb-010#2', 'kb-012#2', 'kb-009#2', 'kb-009#1']

k=60 的融合结果(前 5):
  0.0318 = 0.0156 + 0.0161   kb-010#2  向量第 4 名,BM25 第 2 名
  0.0313 = 0.0149 + 0.0164   kb-012#1  向量第 7 名,BM25 第 1 名
  0.0313 = 0.0159 + 0.0154   kb-009#1  向量第 3 名,BM25 第 5 名
  0.0310 = 0.0154 + 0.0156   kb-009#2  向量第 5 名,BM25 第 4 名
  0.0306 = 0.0147 + 0.0159   kb-012#2  向量第 8 名,BM25 第 3 名

换不同的 k,前 3 名是:
  k=1     ['kb-012#1', 'kb-010#2', 'kb-014#1']
  k=10    ['kb-010#2', 'kb-012#1', 'kb-009#1']
  k=60    ['kb-010#2', 'kb-012#1', 'kb-009#1']
  k=1000  ['kb-010#2', 'kb-012#1', 'kb-009#1']
```

账本一眼就看明白了。kb-010#2(E1042 的解决办法)在向量里第 4 名、BM25 里第 2 名,两路都不差,合计 0.0318;kb-012#1(真正的答案)向量第 7 名、BM25 第 1 名,合计 0.0313。**只差 0.0005**。在 `k = 60` 下,第 1 名和第 2 名的得分差(1/61 对 1/62)本来就小,一路的第 7 名(1/67)又比另一路的第 2 名(1/62)只低一点点,于是"两路都说还行"压过了"一路说最好、一路说一般"。

最底下一行是 `k` 的实验:`k = 1` 时,头部名次的权重大得多(第 1 名 1/2,第 2 名 1/3),BM25 的第 1 名 kb-012#1 一下子升到总排名第 1;`k` 到 10 就已经和 60 一样了。所以 `k` 越小,越偏向"某一路的第一名",`k` 越大越偏向"多路共识"。60 是论文里的经验值,不是什么定律,你的数据上可以量。练习 2 会在整套 17 题上扫一遍 `k`。

## RRF 的局限

RRF 来自 2009 年 Cormack、Clarke、Büttcher 在 SIGIR 会议上发表的论文《Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods》,结论是这个只用名次的简单方法,胜过当时很多复杂的融合方法。Elasticsearch、OpenSearch 等搜索引擎的混合检索都内置了它。不过它也有明显的局限,我们已经看到了几条:

1. **丢掉了分数里的信息。** BM25 第 1 名 3.88 和第 2 名 3.68 差得很小,第 1 名 8.04 和第 2 名 6.30 差得很大,RRF 一视同仁都是"第 1 对第 2"。Elastic 官方博客就把这一点列为 RRF 的限制,并另外提供了加权线性融合的 `linear` retriever,需要你自己调权重。
2. **不保证赢单路。** E2017 一题就是例子:BM25 单路是第 1 名,RRF 反而是第 2 名。
3. **没法用来拒答。** 融合后的分数(0.0318 这种)只是名次的函数,和"答案靠不靠谱"无关,不能设阈值。拒答还是得靠向量相似度或者后面的重排序。
4. **多路里有一路很差时会被拖累。** 练习 5 会看到:加了一路很弱的"只搜标题"的 BM25,17 题的结果反而变差。

## 动手练习

**练习 1:包成函数。** 把"向量检索一路、BM25 一路、RRF 融合"包成一个 `hybrid_search(conn, bm25, query, k)`,返回 `[(块, 分数)]`,形状和 `pg_store.search` 一样,这样后面的 RAG 代码把 `search` 换成它就行。用三个问题试一下。

<details><summary>参考答案</summary>

新建 `part04/ex_hybrid.py`:

```python
# agent-zero-lab/part04/ex_hybrid.py
"""练习 1:把「向量 + BM25 + RRF」包成一个函数,返回形状和 pg_store.search 一样:[(块, 分数)]。"""
import psycopg

from common.embed import embed_one
from part04.bm25_index import BM25Index
from part04.chunking import Chunk, load_chunks
from part04.fusion import rrf
from part04.pg_store import connect, search


def hybrid_search(
    conn: psycopg.Connection, bm25: BM25Index, query: str, k: int = 4, pool: int = 20
) -> list[tuple[Chunk, float]]:
    """两路各取前 pool 名,用 RRF 合并,返回前 k 块和它们的 RRF 分数。"""
    vec_hits = search(conn, embed_one(query), pool)
    kw_hits = bm25.search(query, pool)
    by_id = {c.id: c for c, _ in vec_hits + kw_hits}  # 块编号 -> 块,两路的块合在一起查
    fused = rrf([[c.id for c, _ in vec_hits], [c.id for c, _ in kw_hits]])
    return [(by_id[cid], score) for cid, score in fused[:k]]


if __name__ == "__main__":
    bm25 = BM25Index(load_chunks())
    with connect() as conn:
        for q in ["导入时报 E2017", "买错了能把钱要回来吗", "年付能不能退费"]:
            print(f"问:{q}")
            for c, s in hybrid_search(conn, bm25, q):
                print(f"   {s:.4f}  {c.id:<9}{c.title} > {c.section}")
```

<div class="line-notes">

- `import psycopg` 只为了写类型标注 `psycopg.Connection`。
- `def hybrid_search(` 参数写成多行(括号里换行),是 Python 里超过一行宽度时的常见写法。
- `conn: psycopg.Connection, bm25: BM25Index, query: str, k: int = 4, pool: int = 20` `pool` 是每一路各取多少条交给融合,默认 20;`k` 是最终返回几块。
- `) -> list[tuple[Chunk, float]]:` 返回类型和 Day 232 的 `search` 一致,调用方不用改。
- `vec_hits = search(conn, embed_one(query), pool)` 向量一路,返回 `[(块, 相似度), ...]`。
- `kw_hits = bm25.search(query, pool)` BM25 一路。
- `by_id = {c.id: c for c, _ in vec_hits + kw_hits}` 字典推导式:块编号到块对象的映射。两个列表用 `+` 拼起来,两路都出现的块会被覆盖一次,没关系,内容一样。这一步是因为 `rrf()` 只返回编号,融合完要把编号换回块。
- `fused = rrf([[c.id for c, _ in vec_hits], [c.id for c, _ in kw_hits]])` 两路各自只留编号交给 `rrf`。
- `return [(by_id[cid], score) for cid, score in fused[:k]]` 取前 `k` 名,编号换回块,配上 RRF 得分。
- `if __name__ == "__main__":` 直接运行时才执行下面的演示,被别的文件导入时不会执行。
- `for c, s in hybrid_search(conn, bm25, q):` 对三个问题各打印前 4 块。

</div>

```bash
uv run python -W ignore -m part04.ex_hybrid
```

```text
问:导入时报 E2017
   0.0318  kb-010#2 错误码 E1042:银行流水导入失败 > 解决办法
   0.0313  kb-012#1 错误码 E2017:发票识别失败 > 原因
   0.0313  kb-009#1 导入银行流水 > 支持的格式
   0.0310  kb-009#2 导入银行流水 > 模板字段
问:买错了能把钱要回来吗
   0.0164  kb-002#3 退款政策 > 重复扣款
   0.0161  kb-003#1 如何申请退款 > 操作步骤
   0.0159  kb-002#4 退款政策 > 审批与到账
   0.0156  kb-003#2 如何申请退款 > 已经开了发票怎么办
问:年付能不能退费
   0.0325  kb-002#1 退款政策 > 年付套餐
   0.0296  kb-006#1 发票类型与开具 > 可以开哪种发票
   0.0288  kb-001#1 套餐与价格 > 三种套餐
   0.0164  kb-008#1 优惠码使用规则 > 使用方法
```

第二个问题(BM25 一块都没有):融合分数是 0.0164、0.0161……正好是向量那一路的 1/61、1/62、1/63,RRF 完全退化成向量的名次。第三个问题,"年付能不能退费"向量检索第一名是 kb-002#1(年付套餐退款),BM25 因为「退费」对不上「退款」也靠「年付」命中了 kb-002#1,所以两路都认,得分 0.0325 排第一。注意:返回的分数是 RRF 分数(0.01 到 0.03 的量级),**不是**余弦相似度,不能再拿它去和"0.5 以下拒答"的阈值比。Day 240 会把这个函数的思路并进完整的检索流水线。

</details>

**练习 2:`k` 取多少好?** 在 17 道题上扫 `k` = 0、1、5、10、60、200、1000,看第一名就对的个数和 MRR。

<details><summary>参考答案</summary>

新建 `part04/ex_rrf_k.py`:

```python
# agent-zero-lab/part04/ex_rrf_k.py
"""练习 2:k 取不同的值,整套 17 个问题的 MRR 和「第一名就对」的个数怎么变。"""
from common.embed import embed_one
from part04.fusion import rrf
from part04.hybrid_eval import EVAL, TOP, bm25, first_rank
from part04.pg_store import connect, search

pairs = []
with connect() as conn:
    for q, gold in EVAL:
        vec = [c.id for c, _ in search(conn, embed_one(q), TOP)]
        kw = [c.id for c, _ in bm25.search(q, TOP)]
        pairs.append((vec, kw, gold))

print(f"{'k':>6}{'第一名就对':>12}{'MRR':>8}")
for k in [0, 1, 5, 10, 60, 200, 1000]:
    ranks = [first_rank([c for c, _ in rrf([v, w], k)], g) for v, w, g in pairs]
    top1 = sum(r == 1 for r in ranks)
    mrr = sum(1 / r for r in ranks if r) / len(ranks)
    print(f"{k:>6}{top1:>9}/{len(ranks)}{mrr:>8.3f}")
```

<div class="line-notes">

- `from part04.hybrid_eval import EVAL, TOP, bm25, first_rank` 复用评测集、每路取多少、BM25 索引和名次函数。
- `pairs = []` 先把 17 个问题两路的排名算好存起来,下面扫 `k` 时不用重复查数据库和调 embedding。
- `pairs.append((vec, kw, gold))` 每个问题存一个元组。
- `print(f"{'k':>6}{'第一名就对':>12}{'MRR':>8}")` 表头。
- `for k in [0, 1, 5, 10, 60, 200, 1000]:` 七个 `k`。`k = 0` 时第 1 名得 1/1,第 2 名得 1/2,头部权重最大。
- `ranks = [first_rank([c for c, _ in rrf([v, w], k)], g) for v, w, g in pairs]` 对每个问题用这个 `k` 融合,取第一个正确块的名次。
- `top1 = sum(r == 1 for r in ranks)` 第一名就对的个数。
- `mrr = sum(1 / r for r in ranks if r) / len(ranks)` 同前。

</div>

```bash
uv run python -W ignore -m part04.ex_rrf_k
```

```text
     k       第一名就对     MRR
     0       16/17   0.971
     1       16/17   0.971
     5       15/17   0.941
    10       15/17   0.941
    60       15/17   0.941
   200       15/17   0.941
  1000       15/17   0.941
```

`k` 取 0 或 1 时,头部名次权重大,E2017 那题 RRF 能排第 1(BM25 的第 1 名发力了),所以 16/17,MRR 0.971;`k` 从 5 往上全是 15/17,没有变化。一方面这印证了 `k` 的作用,另一方面也要小心:**17 题里只有 1 题受影响,0.971 对 0.941 不足以说明"`k` 应该取 1"**,样本太少,碰巧而已。我在自己的数据上不会因为这一次实验就改默认的 60,要有更大的评测集再决定。

</details>

**练习 3:直接把分数加起来行不行?** 不缩放,直接把向量相似度和 BM25 原始分相加;再假装 BM25 换了个实现,分数整体小了 10 倍和 100 倍。

<details><summary>参考答案</summary>

新建 `part04/ex_raw_sum.py`:

```python
# agent-zero-lab/part04/ex_raw_sum.py
"""练习 3:不缩放、直接把向量相似度和 BM25 分数相加;再假装 BM25 换了个实现、分数整体小了 100 倍。"""
from collections import defaultdict

from common.embed import embed_one
from part04.fusion import rrf
from part04.hybrid_eval import EVAL, TOP, bm25, first_rank
from part04.pg_store import connect, search

data = []
with connect() as conn:
    for q, gold in EVAL:
        vec = [(c.id, s) for c, s in search(conn, embed_one(q), TOP)]
        kw = [(c.id, s) for c, s in bm25.search(q, TOP)]
        data.append((vec, kw, gold))


def mrr(ranks: list[int | None]) -> float:
    return sum(1 / r for r in ranks if r) / len(ranks)


def raw_sum(vec: list[tuple[str, float]], kw: list[tuple[str, float]], scale: float) -> list[str]:
    total: dict[str, float] = defaultdict(float)
    for cid, s in vec:
        total[cid] += s
    for cid, s in kw:
        total[cid] += s * scale  # scale 模拟「换了个 BM25 实现,分数整体变小」
    return [cid for cid, _ in sorted(total.items(), key=lambda kv: -kv[1])]


print(f"{'BM25 分数乘':>12}{'直接相加 MRR':>14}{'RRF MRR':>10}")
for scale in [1, 0.1, 0.01]:
    raw = [first_rank(raw_sum(v, w, scale), g) for v, w, g in data]
    fused = [first_rank([c for c, _ in rrf([[c for c, _ in v], [c for c, _ in w]])], g) for v, w, g in data]
    print(f"{scale:>12}{mrr(raw):>14.3f}{mrr(fused):>10.3f}")
```

<div class="line-notes">

- `data = []` 先把 17 个问题两路的 `(块编号, 分数)` 列表都存下来。
- `def mrr(ranks: list[int | None]) -> float:` 小函数,同前面的 MRR 算法,这次单独拿出来复用。
- `def raw_sum(` 不做任何缩放的加分。`scale` 是给 BM25 分数乘的一个系数,模拟"换了个 BM25 实现,分数量级不同"。
- `for cid, s in vec:` 向量一路的分数照加。
- `total[cid] += s * scale` BM25 一路乘上 `scale` 再加。
- `for scale in [1, 0.1, 0.01]:` 三种量级:原样、小 10 倍、小 100 倍。
- `raw = [first_rank(raw_sum(v, w, scale), g) for v, w, g in data]` 直接相加的名次。
- `fused = [first_rank([c for c, _ in rrf(` RRF 的名次,不受 `scale` 影响,因为 RRF 只看名次。

</div>

```bash
uv run python -W ignore -m part04.ex_raw_sum
```

```text
    BM25 分数乘      直接相加 MRR   RRF MRR
           1         0.971     0.941
         0.1         0.941     0.941
        0.01         0.920     0.941
```

这个结果有点反直觉,所以我要讲清楚。原样直接相加(第一行)MRR 是 **0.971**,比 RRF 的 0.941 还高。原因是 BM25 的分数比向量大好几倍,直接相加等于"以 BM25 为主、向量为辅",而这组题里 BM25 在错误码上的判断刚好是对的,E2017 这一题直接相加排第 1 名,RRF 排第 2。所以"不能直接相加"并不是说直接相加一定效果差。

问题在后两行:BM25 分数小 10 倍,MRR 掉到 0.941(平手);小 100 倍,0.920(和只用向量一样,BM25 的声音完全被淹没)。而 RRF 在三种量级下都是 0.941,不受影响。真实的系统里,BM25 的分数会因为语料大小、查询长度、换一个库而漂移,**直接相加的结果依赖一个你没法控制的比例,RRF 不依赖**。这才是选 RRF 的原因,也是它的价值:不用调。

</details>

**练习 4:加权 RRF。** 给 BM25 一路更大的权重(每一项乘一个系数),试 1:1、2:1、1:2、1:3、1:10,看 MRR 变不变。

<details><summary>参考答案</summary>

新建 `part04/ex_rrf_weight.py`:

```python
# agent-zero-lab/part04/ex_rrf_weight.py
"""练习 4:加权 RRF。给某一路乘一个权重,17 个问题的结果怎么变。"""
from collections import defaultdict

from common.embed import embed_one
from part04.hybrid_eval import EVAL, TOP, bm25, first_rank
from part04.pg_store import connect, search


def weighted_rrf(rankings: list[list[str]], weights: list[float], k: int = 60) -> list[str]:
    scores: dict[str, float] = defaultdict(float)
    for ranking, w in zip(rankings, weights):
        for rank, cid in enumerate(ranking, start=1):
            scores[cid] += w / (k + rank)  # 比普通 RRF 多乘了这一路的权重
    return [cid for cid, _ in sorted(scores.items(), key=lambda kv: -kv[1])]


data = []
with connect() as conn:
    for q, gold in EVAL:
        vec = [c.id for c, _ in search(conn, embed_one(q), TOP)]
        kw = [c.id for c, _ in bm25.search(q, TOP)]
        data.append((q, vec, kw, gold))

print(f"{'向量:BM25':>10}{'第一名就对':>12}{'MRR':>8}")
for wv, wk in [(1, 1), (2, 1), (1, 2), (1, 3), (1, 10)]:
    ranks = [first_rank(weighted_rrf([v, w], [wv, wk]), g) for _, v, w, g in data]
    print(f"{wv:>6}:{wk:<3}{sum(r == 1 for r in ranks):>9}/{len(ranks)}{sum(1 / r for r in ranks if r) / len(ranks):>8.3f}")
```

<div class="line-notes">

- `def weighted_rrf(rankings: list[list[str]], weights: list[float], k: int = 60) -> list[str]:` 比 `fusion.py` 里的 `rrf` 多一个参数 `weights`,每一路一个权重。返回只要编号的排名。
- `for ranking, w in zip(rankings, weights):` `zip` 把两个列表按位置配对:第一路配第一个权重,第二路配第二个权重。
- `scores[cid] += w / (k + rank)` 和 `rrf` 唯一的区别:分子从 `1.0` 换成了这一路的权重 `w`。
- `data.append((q, vec, kw, gold))` 同样先把排名存起来。
- `for wv, wk in [(1, 1), (2, 1), (1, 2), (1, 3), (1, 10)]:` 向量和 BM25 的权重对。
- `ranks = [first_rank(weighted_rrf([v, w], [wv, wk]), g) for _, v, w, g in data]` 对每个问题用这组权重融合。`for _, v, w, g in data` 解包四项,`_` 是用不到的问题文字。

</div>

```bash
uv run python -W ignore -m part04.ex_rrf_weight
```

```text
   向量:BM25       第一名就对     MRR
     1:1         15/17   0.941
     2:1         15/17   0.926
     1:2         15/17   0.941
     1:3         16/17   0.971
     1:10        16/17   0.971
```

偏向 BM25(1:3 以上)MRR 到 0.971,偏向向量(2:1)掉到 0.926。**这是这套题的特点,不是规律**:题里有 4 个直接带错误码的问题,BM25 全对;只有"买错了…""钱被扣了两次"两个 BM25 完全找不到,只能靠向量。如果你的用户问的主要是口语,结论会反过来。权重要根据真实用户的问题分布调,调之前要有评测集,调完要在另一批题上验证,不要用同一批题调完又拿同一批题报成绩,那是自己骗自己。

</details>

**练习 5:加第三路。** 再加一路"只搜标题和小节名的 BM25",三路 RRF 比两路好吗?

<details><summary>参考答案</summary>

新建 `part04/ex_three_way.py`:

```python
# agent-zero-lab/part04/ex_three_way.py
"""练习 5:再加第三路「只搜标题和小节名的 BM25」,三路 RRF 比两路好吗?"""
from rank_bm25 import BM25Okapi

from common.embed import embed_one
from part04.bm25_index import tokenize
from part04.chunking import load_chunks
from part04.fusion import rrf
from part04.hybrid_eval import EVAL, TOP, bm25, first_rank
from part04.pg_store import connect, search

chunks = load_chunks()
title_bm25 = BM25Okapi([tokenize(f"{c.title} {c.section}") for c in chunks])


def title_search(query: str, k: int) -> list[str]:
    scores = title_bm25.get_scores(tokenize(query))
    order = sorted(range(len(chunks)), key=lambda i: -scores[i])[:k]
    return [chunks[i].id for i in order if scores[i] > 0]


two, three, only_title = [], [], []
with connect() as conn:
    for q, gold in EVAL:
        vec = [c.id for c, _ in search(conn, embed_one(q), TOP)]
        kw = [c.id for c, _ in bm25.search(q, TOP)]
        ti = title_search(q, TOP)
        two.append(first_rank([c for c, _ in rrf([vec, kw])], gold))
        three.append(first_rank([c for c, _ in rrf([vec, kw, ti])], gold))
        only_title.append(first_rank(ti, gold))
        if two[-1] != three[-1]:
            print(f"{q}:两路第 {two[-1]} 名,三路第 {three[-1]} 名")
for name, rs in [("只搜标题", only_title), ("向量+BM25", two), ("向量+BM25+标题", three)]:
    print(f"{name:<14}第一名就对 {sum(r == 1 for r in rs):>2}/{len(rs)}  MRR {sum(1 / r for r in rs if r) / len(rs):.3f}")
```

<div class="line-notes">

- `title_bm25 = BM25Okapi([tokenize(f"{c.title} {c.section}") for c in chunks])` 只用标题加小节名建的 BM25,每块的"文档"只有十来个词。
- `def title_search(query: str, k: int) -> list[str]:` 查询,返回块编号列表。
- `scores = title_bm25.get_scores(tokenize(query))` 对每块打分。
- `order = sorted(range(len(chunks)), key=lambda i: -scores[i])[:k]` 前 `k` 名的下标。
- `return [chunks[i].id for i in order if scores[i] > 0]` 换成编号,丢掉 0 分的。
- `two, three, only_title = [], [], []` 三个列表分别记录两路、三路、只搜标题的第一个正确块名次。
- `ti = title_search(q, TOP)` 第三路。
- `two.append(first_rank([c for c, _ in rrf([vec, kw])], gold))` 两路融合。
- `three.append(first_rank([c for c, _ in rrf([vec, kw, ti])], gold))` 三路融合,`rrf` 接受任意多路。
- `if two[-1] != three[-1]:` 两路和三路名次不同的问题,打印出来看。`two[-1]` 是列表最后一个元素。

</div>

```bash
uv run python -W ignore -m part04.ex_three_way
```

```text
导入时报 E2017:两路第 2 名,三路第 1 名
企业版误删数据能找回吗:两路第 1 名,三路第 3 名
Excel 另存为 CSV 后导入失败:两路第 1 名,三路第 10 名
只搜标题          第一名就对  7/17  MRR 0.490
向量+BM25       第一名就对 15/17  MRR 0.941
向量+BM25+标题    第一名就对 14/17  MRR 0.878
```

结果:第三路单独用很弱(第一名就对 7/17,MRR 0.490),加进来以后 MRR 从 0.941 掉到 0.878。E2017 那题因为标题里直接有 `E2017`,三路下升到了第 1 名,但另外两题被拉坏了:"Excel 另存为 CSV 后导入失败"原来第 1 名,三路后掉到第 10 名,因为标题里的"导入"把一堆导入类的块抬起来了,而"CSV"对应的 kb-011 标题里没有这个词。**RRF 对每一路是平等的,一路很弱时它没有办法知道,会被拖累。**加路之前要先单独评测这一路,加完要比较,不是路越多越好。

</details>

验收标准:`fusion.py` 打印出手算的四个数(0.0325、0.0164、0.0161、0.0159);`hybrid_eval.py` 能打印 17 题的名次表,汇总里 RRF 前 3 名命中 17/17、MRR 0.941;`rrf_trace.py` 里能看到 kb-010#2 和 kb-012#1 只差 0.0005 以及 `k = 1` 时排名翻转;能不看文章解释 RRF 为什么只看名次、`k` 管什么、什么情况下 RRF 不如单路,以及练习 3 里为什么直接相加有时分更高却不该用。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 混合检索(hybrid search) | 同时用向量检索和关键词检索,再把两路结果合成一份 |
| 融合(fusion) | 把几路排名合并成一份排名的那一步 |
| RRF | Reciprocal Rank Fusion,倒数排名融合。每一路排第 `r` 名得 `1/(k+r)` 分,各路相加。只看名次,不看原始分数 |
| `k`(RRF 里的常数) | 压平名次差距的常数,常取 60。越小越看重各路的头部名次,越大越像"多路共识" |
| 量纲 | 数字的度量范围和单位。余弦相似度在 0 到 1,BM25 分数可以到 20,不能直接相加 |
| min-max 归一化 | 把一组分数缩放到 0 到 1:最低分变 0,最高分变 1 |
| 评测集 | 一批问题,每个标好"哪几块是正确答案",用来给检索算法打分的尺子 |
| 名次(rank) | 第几名,从 1 开始数 |
| MRR | Mean Reciprocal Rank,平均倒数名次。每题取第一个正确答案名次的倒数(第 1 名记 1,第 2 名记 0.5),再对所有问题求平均,满分 1.0 |
| 召回率 | 应该找到的东西里找到了多少(Day 233 里用于近似索引,这里的 MRR 是另一个角度) |
| 加权 RRF | 给每一路的贡献乘一个权重,`w/(k+r)` |
| `defaultdict` | 访问不存在的键时自动创建默认值的字典,`defaultdict(float)` 的默认值是 0.0 |
| 退化 | 某一路缺席时,融合的结果等于另一路的名次,不会出错 |

## 常见误区

**把向量相似度和 BM25 分数直接相加。** 量纲不同,而且每个查询的分布不同。今天练习 3 里相加有时分更高,但结果取决于一个不可控的比例,BM25 换个实现就变了。

**以为 RRF 一定比单路好。** E2017 那题里 BM25 单路第 1 名,RRF 第 2 名。RRF 的价值是不让某一路的盲区变成整体的盲区,不是每题都赢。

**用融合后的分数设拒答阈值。** RRF 的分数只是名次的函数,0.0318 和答案对不对没有关系。

**路越多越好。** 练习 5 加了一路很弱的"只搜标题",MRR 从 0.941 掉到 0.878。每一路加进来之前都要先单独评测。

**拿同一批题调参数又拿同一批题报成绩。** 17 题里只有 1 题受 `k` 影响,换 `k` 带来的 0.03 的 MRR 差距,几乎完全是偶然。要在没参与调参的另一批题上验证。

**只取每路的前几条再融合。** 如果每一路只取 3 条,两路的重叠可能很少,RRF 没有"共识"可看。取 20 条左右(今天的 `TOP = 20`),融合完再截到最终需要的 k。

**忘了 `rrf()` 只返回编号。** 融合完要把编号换回块对象(练习 1 的 `by_id`),否则下游拿不到正文。

**评测集太容易就得出"混合检索没用"的结论。** 今天的 17 题 14 题四种做法都对,差别只在几题上。真实系统里评测集要包含错误码、口语、同义词、跨块问题这些难例,否则什么办法都看起来一样好。

## 学习资料

### 文档与文章

- [Elastic · Reciprocal rank fusion](https://www.elastic.co/guide/en/elasticsearch/reference/current/rrf.html):官方文档里的 RRF 一页,里面的 `rank_constant`(就是今天的 `k`)和 `rank_window_size`(就是今天每路取的条数)能和今天的代码一一对上。
- [Elastic Search Labs · Linear retriever for hybrid search](https://www.elastic.co/search-labs/blog/linear-retriever-hybrid-search):官方博客,讲 RRF 只看名次的局限,以及用加权的线性融合(`linear` retriever)怎么补,读它是为了知道行业里认可"RRF 不是万能的"。
- [OpenSearch · Hybrid search](https://opensearch.org/docs/latest/search-plugins/hybrid-search/):另一家搜索引擎怎么做混合检索,对比 Elastic 的做法。
- Cormack、Clarke、Büttcher,《Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods》(SIGIR 2009):RRF 的原始论文,ACM 数字图书馆的页面对爬虫返回 403,需要在浏览器里打开(搜论文标题即可)。论文很短,重点看 `k = 60` 是怎么来的。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1kndSB7Emx&autoplay=0&high_quality=1" title="混合检索(相似度+BM25)、RRF融合、Cross-Encoder精排序" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>_叶落秋白 · 混合检索(相似度+BM25)、RRF融合、Cross-Encoder精排序 · 约 3 分钟,短,把今天的三步和后天要学的精排放在一起过一遍,先看这个建立整体印象。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1qqpuzbELr&autoplay=0&high_quality=1" title="【小白教程】手把手教你实现RAG多路召回" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>写代码的阿咪 · 【小白教程】手把手教你实现RAG多路召回!向量检索+BM25+语义路由 · 约 17 分钟,带代码的多路召回演示,和今天的 `hybrid_search` 思路一致。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/XvKiTfd6Xvo" title="The Complete Guide to Hybrid Search in RAG (BM25 + Embeddings + Reranker)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Dave Ebbelaar · The Complete Guide to Hybrid Search in RAG (BM25 + Embeddings + Reranker) · 英文,把今天和后天(重排序)的内容连起来讲,我只验证了标题和作者,没有逐分钟看完。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/kT7nXO32L-Q" title="PostgreSQL Hybrid Search Course – Keyword (BM25) + Vector Retrieval" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>freeCodeCamp.org · PostgreSQL Hybrid Search Course – Keyword (BM25) + Vector Retrieval · 英文课程,正是在 Postgres 里同时做关键词和向量检索,和我们的技术栈对口,我只验证了标题和作者,时间较长,挑融合那一段看。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):检索系统那一章里讨论了混合检索和重排序,适合读完今天、明天(重排序)后连起来看。

### 开源项目与代码

- [pgvector/pgvector-python](https://github.com/pgvector/pgvector-python):pgvector 官方的 Python 库。仓库的 examples 里有"混合搜索"的示例,用 Postgres 自带全文检索加向量检索,再用 RRF 合并,可以对照今天的做法。
- [dorianbrown/rank_bm25](https://github.com/dorianbrown/rank_bm25):Day 235 的库。

## 自测

**1. 为什么向量相似度和 BM25 分数不能直接相加?**

<details><summary>答案</summary>

量纲不同(向量相似度在 0 到 1,BM25 原始分可以到十几二十),而且每个问题里两路分数的分布都不同。直接相加,谁的数大谁说了算,比例又不可控:BM25 实现一换、语料一变,比例就变了(练习 3 里 BM25 分数缩小 100 倍,MRR 就从 0.971 掉到 0.920)。

</details>

**2. 手算:向量检索排名 `[A, B, C]`,BM25 排名 `[B, D]`,`k = 60`,四个块的 RRF 得分各是多少?谁排第一?**

<details><summary>答案</summary>

A:只在向量,第 1 名,1/61 = 0.0164。B:向量第 2 名 1/62 = 0.0161,BM25 第 1 名 1/61 = 0.0164,合计 0.0325。C:向量第 3 名,1/63 = 0.0159。D:BM25 第 2 名,1/62 = 0.0161。B 排第一,因为两路都有。

</details>

**3. `k = 60` 在管什么?`k` 调小到 1 会怎样?**

<details><summary>答案</summary>

`k` 把名次的差距压平:`k` 大时第 1 名(1/61)和第 5 名(1/65)差得很少,"多路都出现"比"某一路排第一"更重要;`k` 小时头部名次权重大,某一路的第 1 名更容易冲到总排名第 1。E2017 那题里 `k = 1` 时 BM25 的第 1 名直接成了总第 1,`k = 10` 以上就是总第 2 名。

</details>

**4. 为什么说 RRF 的价值是"兜底",而不是"每题都赢"?**

<details><summary>答案</summary>

17 题里 14 题四种做法都对,能分出高下的只有 3 题:RRF 在 E2017 上排第 2(BM25 单路第 1,向量第 7),在两个 BM25 找不到的口语题上和向量名次一样。它从来没有掉到向量的第 7 名或者找不到,但也没拿到 BM25 的第 1 名。某一路缺席或者出错时,RRF 靠另一路兜住,这才是价值。

</details>

**5. 面试题:你要给知识库问答加混合检索,怎么证明它真的比单路好?融合用什么办法?**

<details><summary>答案</summary>

先做一个标好正确答案的评测集,包含错误码、口语、同义词、跨块问题,指标用前 k 名命中率和 MRR。分别量"只向量、只关键词、混合",如果混合没有明显提升,先怀疑评测集太容易。融合用 RRF:只看名次,不用调分数比例,对某一路缺席时自然退化;缺点是丢掉分数信息、不能设阈值、某一路很差会拖累整体,所以要单独评测每一路,必要时加权或用重排序。数字要诚实:我在 17 题上量到的是 MRR 0.920(向量)、0.882(BM25)、0.941(RRF),差距不大,因为题偏容易。

</details>

**6. 练习 5 里加了第三路"只搜标题的 BM25",为什么反而变差了?**

<details><summary>答案</summary>

这一路单独用就很弱(17 题第一名就对 7 个,MRR 0.490),RRF 对每一路是平等的,不会因为它弱就降低它的权重。"Excel 另存为 CSV 后导入失败"一题,标题里的"导入"把一堆导入类的块排到前面,又把真正的答案(标题里没有"CSV"的 kb-011)拖到第 10 名。加路之前先单独评测;弱的路要降权或者不加。

</details>

## 明天预告

明天是 [Day 237 · 第 34 周复习:RAG 与上下文(Day 231–236)](/blog/agent-zero/day-237-week34-review/),把这一周的 pgvector 写入和增量更新、SQL 检索、HNSW、过滤的坑、BM25 和 RRF 串成一张知识地图,做一个只用本周知识的小练习,整理错题。
