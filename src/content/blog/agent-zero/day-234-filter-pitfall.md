---
title: 'Day 234 · 过滤的坑和向量库选型'
description: '在 Day 233 那张 2 万行的表上加一列分类,复现"加了 WHERE 结果变少":退款占 10% 时 LIMIT 10 只返回约 4 行,占 1% 时只返回不到 1 行。再实测迭代扫描、调大 ef_search、部分索引三种补救各自的行数、召回率和耗时,最后用实测的表和索引大小估算容量,把 pgvector 和 Milvus、Qdrant、Chroma、Elasticsearch、FAISS 放在一张选型表里。'
pubDate: 2026-10-23
regime: none
tags: ['pgvector', 'filter', 'hnsw', 'vector-db', 'agent-zero']
series: 'agent-zero'
day: 234
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 233](/blog/agent-zero/day-233-hnsw/) 做了两件事:用 20 行 numpy 在二维图上"走路",看清 HNSW 为什么快、为什么会漏(候选名单 `ef` 太短就漏);再造了一张 2 万行、1024 维的 `ann_demo` 表,建 HNSW 索引,实测单次查询从两百多毫秒降到几毫秒,召回率随 `ef_search` 升高。最后留了一句:索引是先在图上取候选再返回的,如果这时候再加一个 `WHERE category = '退款'`,是先过滤还是后过滤?

今天回答这个问题。答案不太讨喜:pgvector 的 HNSW 是**后过滤**,先取 40 个候选,再用 `WHERE` 筛。这个坑在 42 行的小表上永远碰不到,等数据多到规划器愿意走索引的那天才会出现,而且不报错,只是结果悄悄变少。今天先把它复现出来,量一量三种补救,最后顺手回答另一个必问的问题:为什么用 pgvector,什么时候该换别家。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清**先过滤**和**后过滤**的区别,算得出"候选 40 个、符合条件占 10%,平均能剩几个",并在 `ann_demo` 表上亲手复现 `LIMIT 10` 只返回 4 行。
2. 看懂 `EXPLAIN` 里 `Filter:` 和 `Rows Removed by Filter:` 两行,判断一条带 `WHERE` 的向量查询走的是哪条路,知道为什么刚开始"复现不了"是正常的。
3. 实测并选择补救办法:迭代扫描(`hnsw.iterative_scan`)、调大 `ef_search`、部分索引,说出各自的代价。
4. 用 `capacity.py` 估算 N 条向量占多少表空间和索引空间;面试被问"为什么用 pgvector 不用 Milvus"时,给出带数字、有取舍、有退路的回答。

预计用时 3 小时:复现和原理 50 分钟,量三种过滤比例和三种补救 60 分钟,容量和选型 30 分钟,剩下做练习。前置:[Day 233](/blog/agent-zero/day-233-hnsw/) 的 `ann_demo` 表和 HNSW 索引(`make_ann_demo.py` 造表、`CREATE INDEX ann_demo_hnsw` 建索引),[Day 232](/blog/agent-zero/day-232-pgvector-3/) 的 `pg_store.search()`,[Day 89](/blog/agent-zero/day-089-sql-5/) 的 `EXPLAIN`。

今天不调任何模型接口,花费 0 元。如果你的 `ann_demo` 表已经被删掉了,先回 Day 233 把表造好、索引建好(索引要等几分钟),再接着做。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `filter_pitfall.py` 里"先精确、再走索引、数返回行数和重合数"的主体;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先看现象:加一个 WHERE,结果变少了

`ann_demo` 现在只有 `id` 和 `embedding` 两列,没有能过滤的东西。先给它加一列 `category`,让一部分行是「退款」,一部分是「发票」,其余是「其他」。比例是故意定的:退款占 10%,发票占 1%,错误码占 0.1%(只有 20 行)。分类按 `id` 取余数分配,和向量没有任何关系,这一点后面会用到。新建 `part04/make_filter_demo.py`:

```python
# agent-zero-lab/part04/make_filter_demo.py
"""给 Day 233 的 ann_demo 表加一列 category:退款占 10%,发票占 1%,错误码占 0.1%,其余是「其他」。"""
from part04.pg_store import connect

with connect() as conn:
    conn.execute("ALTER TABLE ann_demo ADD COLUMN IF NOT EXISTS category text")
    conn.execute("""
        UPDATE ann_demo SET category = CASE
            WHEN id % 10 = 0 THEN '退款'
            WHEN id % 100 = 1 THEN '发票'
            WHEN id % 1000 = 2 THEN '错误码'
            ELSE '其他' END
    """)
    conn.execute("VACUUM ANALYZE ann_demo")  # UPDATE 留下一堆旧版本的行,先清掉再统计
    for cat, n in conn.execute("SELECT category, count(*) FROM ann_demo GROUP BY 1 ORDER BY 2 DESC"):
        print(f"{cat:<4} {n:>6} 行  {n / 20000:.1%}")
```

<div class="line-notes">

- `from part04.pg_store import connect` Day 229 起用的连接函数。它读 `.env` 里的 `PG_DSN`,连上 `agentzero` 库(你自己的库名可能不同),开了自动提交,注册了 `vector` 类型。
- `with connect() as conn:` 用完自动关连接。
- `conn.execute("ALTER TABLE ann_demo ADD COLUMN IF NOT EXISTS category text")` 给表加一列,类型是 `text`。`IF NOT EXISTS` 让脚本重复跑不报错。加完以后 2 万行这一列都是空(`NULL`)。
- `UPDATE ann_demo SET category = CASE` `UPDATE` 改已有的行,没写 `WHERE` 就是改全部 2 万行。`CASE ... END` 是 SQL 里的"if/else if",相当于 JS 的一串三元表达式。
- `WHEN id % 10 = 0 THEN '退款'` `%` 是取余数。`id` 是 0、10、20、30……时余数为 0,每 10 行有 1 行,正好 10%,共 2000 行。
- `WHEN id % 100 = 1 THEN '发票'` `id` 是 1、101、201……每 100 行 1 行,共 200 行。注意 `id = 1` 满足这一条而不是上一条(1 除以 10 余 1),所以前面用 `id = 1` 当查询的那行,它自己是「发票」。
- `WHEN id % 1000 = 2 THEN '错误码'` `id` 是 2、1002、2002……共 20 行。三个条件互不重叠,`CASE` 从上往下找到第一个成立的就停。
- `ELSE '其他' END` 剩下的 17780 行。
- `conn.execute("VACUUM ANALYZE ann_demo")` `UPDATE` 在 Postgres 里不是原地修改,而是写一个新版本的行、把旧版本标记成"死行"。2 万行全改了一遍,表里就躺着 2 万个死行,索引里还留着它们的指针。`VACUUM` 负责清理,`ANALYZE` 更新统计信息(规划器靠它估算"退款占多少")。不清理的话,同一个查询在不同时间返回的行数会有差异,这是我第一次跑时亲眼看到的,下面"我踩的坑"会提到。
- `for cat, n in conn.execute("SELECT category, count(*) FROM ann_demo GROUP BY 1 ORDER BY 2 DESC"):` Day 88 的 `GROUP BY`,`GROUP BY 1` 表示按第 1 个输出列分组,`ORDER BY 2 DESC` 按第 2 列(个数)从大到小。`conn.execute(...)` 返回的游标可以直接放在 `for` 里,每次拿到一行,解包成 `cat` 和 `n`。
- `print(f"{cat:<4} {n:>6} 行  {n / 20000:.1%}")` `:<4` 左对齐占 4 格,`:>6` 右对齐占 6 格,`.1%` 把小数转成带一位小数的百分比,比如 `2000 / 20000 = 0.1` 打印成 `10.0%`。

</div>

```bash
cd /Users/你/agent-zero-lab
uv run python -m part04.make_filter_demo
```

```text
其他    17780 行  88.9%
退款     2000 行  10.0%
发票      200 行  1.0%
错误码      20 行  0.1%
```

先用最朴素的办法试一次:拿 `id = 1` 那一行的向量当问题,搜"退款"类里最近的 10 行。在 psql 里(`psql -d agentzero`,换成你自己的库名):

```sql
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id FROM ann_demo
WHERE category = '退款'
ORDER BY embedding <=> (SELECT embedding FROM ann_demo WHERE id = 1)
LIMIT 10;
```

```text
 Limit (actual rows=10 loops=1)
   InitPlan 1
     ->  Index Scan using ann_demo_pkey on ann_demo ann_demo_1 (actual rows=1 loops=1)
           Index Cond: (id = 1)
   ->  Sort (actual rows=10 loops=1)
         Sort Key: ((ann_demo.embedding <=> (InitPlan 1).col1))
         Sort Method: top-N heapsort  Memory: 25kB
         ->  Seq Scan on ann_demo (actual rows=2000 loops=1)
               Filter: (category = '退款'::text)
               Rows Removed by Filter: 18000
 Planning Time: 2.347 ms
 Execution Time: 62.892 ms
```

返回了 10 行,一切正常。再看计划:`Seq Scan`,把 2 万行从头到尾扫了一遍,`Filter` 筛出 2000 行退款类,`Rows Removed by Filter: 18000` 是被筛掉的,最后在 2000 行里排序取 10 个。**HNSW 索引一点没用上**。规划器算了一笔账:这张表才 2 万行,`WHERE` 又能先砍掉九成,直接扫比走索引划算。这个选择是对的,结果还是精确的,不会少。

所以如果你照着别人的文章写了一条带 `WHERE` 的查询,在测试库里看到一切正常,恰恰什么都说明不了:数据一多(或者统计信息变了)规划器改走索引的那天,结果才会变。我们没有那么多数据,只能让它"改走索引"这一步提前发生。`SET enable_seqscan = off` 的意思是把顺序扫描的成本调到极高,规划器手里只剩索引一条路(Day 233 练习里用过):

```sql
SET enable_seqscan = off;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id FROM ann_demo
WHERE category = '退款'
ORDER BY embedding <=> (SELECT embedding FROM ann_demo WHERE id = 1)
LIMIT 10;
```

```text
 Limit (actual rows=4 loops=1)
   InitPlan 1
     ->  Index Scan using ann_demo_pkey on ann_demo ann_demo_1 (actual rows=1 loops=1)
           Index Cond: (id = 1)
   ->  Index Scan using ann_demo_hnsw on ann_demo (actual rows=4 loops=1)
         Order By: (embedding <=> (InitPlan 1).col1)
         Filter: (category = '退款'::text)
         Rows Removed by Filter: 36
 Planning Time: 1.784 ms
 Execution Time: 4.360 ms
```

要 10 行,只给了 **4 行**。`Rows Removed by Filter: 36` 把整件事讲完了:索引一共交出 40 行候选(正好是默认的 `ef_search = 40`),`WHERE` 筛掉 36 行,剩 4 行。没有错误,没有警告,`LIMIT 10` 就当没写。

退款占 10%,40 行候选里平均有 40 × 10% = 4 行是退款。这个算式和实测对上了,pgvector 的 README 里也是用同样的例子解释这个现象的(条件匹配 10% 的行时,默认 `ef_search` 平均只能匹配 4 行)。换成发票(占 1%),算式给出 40 × 1% = 0.4 行:

```sql
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id FROM ann_demo
WHERE category = '发票'
ORDER BY embedding <=> (SELECT embedding FROM ann_demo WHERE id = 1)
LIMIT 10;
```

```text
 Limit (actual rows=2 loops=1)
   ...
   ->  Index Scan using ann_demo_hnsw on ann_demo (actual rows=2 loops=1)
         Order By: (embedding <=> (InitPlan 1).col1)
         Filter: (category = '发票'::text)
         Rows Removed by Filter: 38
```

这条只返回了 2 行(我省略了和主角无关的子查询几行)。0.4 是平均数,这次碰巧多了一点:`id = 1` 这行自己就是「发票」,又正好是问题向量本身,一定排在候选第一位,所以至少有 1 行。换别的问题向量,你会看到 0 或 1 行。

## 为什么:先取候选,后过滤

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="两种过滤顺序对比:后过滤先由 HNSW 取 40 个候选,再按 WHERE 筛,只剩 4 个;先过滤则先筛出所有退款类的行,再在其中找最近的 10 个">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink)">后过滤(pgvector 的 HNSW 索引):</text>
<text x="20" y="46" fill="var(--ink-soft)" font-size="11">① 索引按向量取 ef_search = 40 个候选</text>
<g fill="var(--ink-faint)">
<rect x="20" y="56" width="12" height="12"/><rect x="36" y="56" width="12" height="12"/><rect x="52" y="56" width="12" height="12"/><rect x="68" y="56" width="12" height="12" fill="var(--compute)"/><rect x="84" y="56" width="12" height="12"/><rect x="100" y="56" width="12" height="12"/><rect x="116" y="56" width="12" height="12"/><rect x="132" y="56" width="12" height="12"/><rect x="148" y="56" width="12" height="12"/><rect x="164" y="56" width="12" height="12"/>
<rect x="180" y="56" width="12" height="12"/><rect x="196" y="56" width="12" height="12" fill="var(--compute)"/><rect x="212" y="56" width="12" height="12"/><rect x="228" y="56" width="12" height="12"/><rect x="244" y="56" width="12" height="12"/><rect x="260" y="56" width="12" height="12"/><rect x="276" y="56" width="12" height="12"/><rect x="292" y="56" width="12" height="12"/><rect x="308" y="56" width="12" height="12"/><rect x="324" y="56" width="12" height="12"/>
<rect x="340" y="56" width="12" height="12"/><rect x="356" y="56" width="12" height="12"/><rect x="372" y="56" width="12" height="12"/><rect x="388" y="56" width="12" height="12" fill="var(--compute)"/><rect x="404" y="56" width="12" height="12"/><rect x="420" y="56" width="12" height="12"/><rect x="436" y="56" width="12" height="12"/><rect x="452" y="56" width="12" height="12"/><rect x="468" y="56" width="12" height="12"/><rect x="484" y="56" width="12" height="12"/>
<rect x="500" y="56" width="12" height="12"/><rect x="516" y="56" width="12" height="12"/><rect x="532" y="56" width="12" height="12"/><rect x="548" y="56" width="12" height="12"/><rect x="564" y="56" width="12" height="12" fill="var(--compute)"/><rect x="580" y="56" width="12" height="12"/><rect x="596" y="56" width="12" height="12"/><rect x="612" y="56" width="12" height="12"/>
</g>
<text x="20" y="92" fill="var(--ink-soft)" font-size="11">② 再用 WHERE category = '退款' 筛(琥珀色是退款类,占 10%)</text>
<rect x="20" y="102" width="12" height="12" fill="var(--compute)"/><rect x="36" y="102" width="12" height="12" fill="var(--compute)"/><rect x="52" y="102" width="12" height="12" fill="var(--compute)"/><rect x="68" y="102" width="12" height="12" fill="var(--compute)"/>
<text x="90" y="112" fill="var(--ink)">只剩 4 行,LIMIT 10 也要不到 10 行</text>
<line x1="20" y1="134" x2="620" y2="134" stroke="var(--rule)"/>
<text x="20" y="158" fill="var(--ink)">先过滤(B-tree 先把退款类 2000 行找出来):</text>
<text x="20" y="178" fill="var(--ink-soft)" font-size="11">① 按 category 的普通索引,取出所有退款类的行</text>
<text x="20" y="196" fill="var(--ink-soft)" font-size="11">② 在这 2000 行里算距离、排序,取最近的 10 行(精确,不会少)</text>
<text x="20" y="226" fill="var(--mem)" font-size="11">代价:符合条件的行很多时,要算的距离也很多</text>
</g>
</svg>
<figcaption>两种顺序。后过滤快,但能剩下的行数要看"候选里恰好有多少符合条件";先过滤一定凑得够数,但只能对符合条件的那部分行做精确计算。HNSW 图本身不知道 category 是什么,所以天然是后过滤。</figcaption>
</figure>

两种顺序的名字:**先过滤**(pre-filter),先按条件筛出一批行,再在这批行里找最近的;**后过滤**(post-filter),先按向量找最近的一批候选,再按条件筛。

HNSW 索引是只按向量建的图,图上的每个点知道自己的向量和邻居,不知道自己属于哪个分类。查询时它没法"只在退款类的点里走路",只能先走完,交出 `ef_search` 个最近的点,再由 Postgres 在外面套一层 `Filter`。所以对它来说后过滤是唯一的选择。

后过滤的结局取决于两个数:候选有多少个(`ef_search`),符合条件的行占多大比例(选择度)。剩下的行数大约是两者的乘积。比例大的过滤(退款 10%)是"变少";比例小的(发票 1%、错误码 0.1%)基本是"没有"。它还有一个更隐蔽的版本,下面练习 3 会做:如果过滤条件和问题**在向量空间里方向不同**(比如问退款的问题,却要求只搜"错误码"类),最近的 40 个点几乎全是退款类,筛完一个都不剩,哪怕"错误码"类里明明有 3691 行。

## 量一量:三种过滤比例,五种设置

一条查询说明不了问题,要量一批。思路和 Day 233 的召回率实验一样:取 50 个问题向量,对每个问题先做一遍**精确查询**(关掉索引扫描,顺序扫描加排序,答案一定对)当标准答案,再强制走 HNSW 索引,数两件事:一共返回几行(目标是 10),返回的行里有几行和精确答案重合(召回率)。设置有五种:默认、`ef_search` 调到 200、调到 1000、开迭代扫描的两种模式(下一节讲)。新建 `part04/filter_pitfall.py`:

```python
# agent-zero-lab/part04/filter_pitfall.py
"""带 WHERE 的向量查询:同样 LIMIT 10,不同过滤比例、不同设置,到底返回几行、漏了多少。"""
import time

import numpy as np

from part04.pg_store import connect

SQL = "SELECT id FROM ann_demo WHERE category = %s ORDER BY embedding <=> %s LIMIT 10"
BASE = {"hnsw.ef_search": "40", "hnsw.iterative_scan": "off", "hnsw.max_scan_tuples": "20000"}
SETTINGS = {
    "默认": {},
    "ef_search=200": {"hnsw.ef_search": "200"},
    "ef_search=1000": {"hnsw.ef_search": "1000"},
    "relaxed_order": {"hnsw.iterative_scan": "relaxed_order"},
    "strict_order": {"hnsw.iterative_scan": "strict_order"},
}

conn = connect()
conn.prepare_threshold = None  # 关掉自动预编译:同一条 SQL 跑到第 6 次会被缓存计划,中途改设置就不生效了
rng = np.random.default_rng(1)
ids = [int(i) for i in rng.choice(20000, 50, replace=False)]
rows = conn.execute("SELECT id, embedding FROM ann_demo WHERE id = ANY(%s)", (ids,)).fetchall()
queries = [r[1] for r in rows]


def apply(gucs: dict[str, str]) -> None:
    for name, value in {**BASE, **gucs}.items():
        conn.execute("SELECT set_config(%s, %s, false)", (name, value))


def exact(cat: str, q: np.ndarray) -> list[int]:
    conn.execute("SET enable_indexscan = off")  # 不许用索引:Seq Scan + 排序,答案一定是精确的
    conn.execute("SET enable_seqscan = on")
    return [r[0] for r in conn.execute(SQL, (cat, q))]


def via_index(cat: str, q: np.ndarray) -> list[int]:
    conn.execute("SET enable_indexscan = on")
    conn.execute("SET enable_seqscan = off")  # 逼规划器走 HNSW,模拟「数据一大它自己就会选索引」
    return [r[0] for r in conn.execute(SQL, (cat, q))]


print(f"{'过滤':<5}{'设置':<16}{'平均返回行数':>10}{'召回率':>9}{'平均毫秒':>9}")
for cat, share in [("退款", "10%"), ("发票", "1%"), ("错误码", "0.1%")]:
    truth = [exact(cat, q) for q in queries]
    for name, gucs in SETTINGS.items():
        apply(gucs)
        got_rows, hit, ms = 0, 0, 0.0
        for q, t in zip(queries, truth):
            t0 = time.perf_counter()
            got = via_index(cat, q)
            ms += (time.perf_counter() - t0) * 1000
            got_rows += len(got)
            hit += len(set(got) & set(t))
        n = len(queries)
        print(f"{cat}{share:<4}{name:<16}{got_rows / n:>10.1f}{hit / (10 * n):>9.2f}{ms / n:>9.1f}")
```

<div class="line-notes">

- `import time` 标准库,用来量每次查询的耗时。
- `import numpy as np` 只用来抽样和标注向量的类型。
- `SQL = "SELECT id FROM ann_demo WHERE category = %s ORDER BY embedding <=> %s LIMIT 10"` 要测的那条查询。两个 `%s` 是 psycopg 的占位符,第一个填分类,第二个填问题向量,值通过元组传进去,不拼进字符串。
- `BASE = {"hnsw.ef_search": "40", "hnsw.iterative_scan": "off", "hnsw.max_scan_tuples": "20000"}` 三个设置的"出厂值"。每一轮实验先回到出厂值,再叠加这一轮要改的,这样上一轮的设置不会漏到下一轮。值写成字符串,因为后面用 `set_config` 传。
- `SETTINGS = {` 五种设置,键是打印用的名字,值是"相对出厂值要改的部分"。
- `"默认": {},` 空字典,什么都不改。
- `"ef_search=200": {"hnsw.ef_search": "200"},` 候选名单放宽到 200。
- `"ef_search=1000": {"hnsw.ef_search": "1000"},` 1000 是 pgvector 允许的最大值,下面会看到超过它的报错。
- `"relaxed_order": {"hnsw.iterative_scan": "relaxed_order"},` 迭代扫描,允许结果顺序有一点点偏差。
- `"strict_order": {"hnsw.iterative_scan": "strict_order"},` 迭代扫描,严格按距离排序。
- `conn = connect()` 整个脚本共用一条连接。`SET` 是对连接生效的,换连接设置就没了,所以必须用同一条。
- `conn.prepare_threshold = None` 关掉自动预编译。psycopg 默认对同一条 SQL 执行第 5 次之后,会让数据库把它"预编译"并缓存执行计划,之后每次直接复用。我第一次没写这一行,结果见后面的"我踩的坑"。
- `rng = np.random.default_rng(1)` 种子固定为 1,每个人抽到同样的 50 行。
- `ids = [int(i) for i in rng.choice(20000, 50, replace=False)]` 从 0 到 19999 里不放回地抽 50 个编号,`int(i)` 把 numpy 整数转成 Python 整数(psycopg 不认 numpy 整数)。
- `rows = conn.execute("SELECT id, embedding FROM ann_demo WHERE id = ANY(%s)", (ids,)).fetchall()` `= ANY(列表)` 是"等于列表里任何一个",一次取回 50 行,每行是 `(id, 向量)`。
- `queries = [r[1] for r in rows]` 只留向量。这 50 个向量既是问题,也是表里的行,所以每个问题自己就是自己的最近邻。
- `def apply(gucs: dict[str, str]) -> None:` 把一组设置应用到当前连接。GUC 是 Postgres 里"运行时参数"的叫法(Grand Unified Configuration)。
- `for name, value in {**BASE, **gucs}.items():` `{**a, **b}` 把两个字典合并,后面的覆盖前面的。代入"relaxed_order":`BASE` 是三项,`gucs` 是 `{"hnsw.iterative_scan": "relaxed_order"}`,合并后 `ef_search` 仍是 `"40"`,`iterative_scan` 变成 `"relaxed_order"`。
- `conn.execute("SELECT set_config(%s, %s, false)", (name, value))` `set_config(名字, 值, 是否只限本事务)` 是 `SET` 的函数版,好处是名字和值可以当参数传,`SET` 命令做不到。第三个参数 `false` 表示整个会话有效。
- `def exact(cat: str, q: np.ndarray) -> list[int]:` 精确答案。
- `conn.execute("SET enable_indexscan = off")` 禁用索引扫描,向量索引用不上了。
- `conn.execute("SET enable_seqscan = on")` 顺序扫描打开(下面 `via_index` 会把它关掉,这里要恢复)。
- `return [r[0] for r in conn.execute(SQL, (cat, q))]` 精确的 top-10 编号。
- `def via_index(cat: str, q: np.ndarray) -> list[int]:` 强制走索引的答案。
- `conn.execute("SET enable_seqscan = off")` 关掉顺序扫描,规划器只剩 HNSW 一条路,模拟"数据多到规划器自己会选索引"的那一天。
- `print(f"{'过滤':<5}` 表头。
- `for cat, share in [("退款", "10%"), ("发票", "1%"), ("错误码", "0.1%")]:` 外层循环三种过滤比例,`share` 只用来打印。
- `truth = [exact(cat, q) for q in queries]` 50 个问题各自的精确 top-10,一个列表套 50 个小列表。
- `for name, gucs in SETTINGS.items():` 内层循环五种设置。
- `apply(gucs)` 应用这一轮的设置。
- `got_rows, hit, ms = 0, 0, 0.0` 三个累加器:一共返回多少行,一共多少行和精确答案重合,一共花多少毫秒。
- `for q, t in zip(queries, truth):` 同时遍历问题和它的标准答案。
- `t0 = time.perf_counter()` 到下一个 `ms +=` 之间是查询耗时。
- `got = via_index(cat, q)` 走索引查一次。
- `got_rows += len(got)` 返回了几行。比如退款默认设置下,第一个问题返回 5 行,这里加 5。
- `hit += len(set(got) & set(t))` 两个集合取交集(Day 25),交集的大小是"返回的行里有几行是对的"。
- `n = len(queries)` 50。
- `print(f"{cat}{share:<4}{name:<16}{got_rows / n:>10.1f}{hit / (10 * n):>9.2f}{ms / n:>9.1f}")` 平均返回行数 = 总行数 / 50;召回率 = 重合行数 / (10 × 50),因为每个问题标准答案有 10 行;平均毫秒 = 总耗时 / 50。

</div>

```bash
uv run python -m part04.filter_pitfall
```

```text
过滤   设置                  平均返回行数      召回率     平均毫秒
退款10% 默认                     4.2     0.42      6.7
退款10% ef_search=200         10.0     1.00      4.7
退款10% ef_search=1000        10.0     1.00     11.1
退款10% relaxed_order         10.0     0.98      3.0
退款10% strict_order          10.0     0.98      2.6
发票1%  默认                     0.5     0.04      2.0
发票1%  ef_search=200          2.0     0.20      2.7
发票1%  ef_search=1000         9.1     0.91      9.2
发票1%  relaxed_order         10.0     0.98      9.4
发票1%  strict_order          10.0     0.91      9.6
错误码0.1%默认                     0.1     0.01      2.2
错误码0.1%ef_search=200          0.3     0.03      2.7
错误码0.1%ef_search=1000         1.1     0.11      8.7
错误码0.1%relaxed_order         10.0     1.00     78.9
错误码0.1%strict_order          10.0     0.91     80.4
```

先对一下算式,实测和"候选数 × 比例"几乎一样。默认 `ef_search = 40`:退款 40 × 10% = 4,实测 4.2;发票 40 × 1% = 0.4,实测 0.5;错误码 40 × 0.1% = 0.04,实测 0.1。把 `ef_search` 调到 200:退款能拿到 20 行,够了,所以 10.0;发票是 200 × 1% = 2,实测 2.0;调到 1000 是 1000 × 1% = 10,实测 9.1(差一点点,因为 HNSW 本身有漏)。**`ef_search` 乘以过滤比例,就是你能拿到的行数**,这个心算在做容量规划时很好用。

再看几件事。第一,过滤得越严,问题越大,而且一旦比例低到 1% 以下,调 `ef_search` 就基本没用了:错误码占 0.1%,开到最大值 1000 也只有 1.1 行。第二,迭代扫描(`relaxed_order`、`strict_order`)三种比例下都能拿满 10 行,召回率 0.91 到 1.00。第三,代价写在最后一列:错误码那一行,迭代扫描平均要 79 毫秒,是默认的 30 多倍。因为符合条件的行太少,它只能一轮一轮往下找,找到第 10 行时已经翻过了很大一片图。

这张表里召回率没到 1.00(0.98、0.91)不是迭代扫描的毛病,是 HNSW 本身的近似,和 Day 233 的默认 0.97 同一个来源。至于 `strict_order` 比 `relaxed_order` 召回略低,几十个问题的样本上有这个量级的波动是正常的,不要从一次实验里读出规律。

### 我踩的坑:同一条 SQL 跑了六次,设置就不生效了

上面的表是第三次跑出来的结果。头两次我没写 `conn.prepare_threshold = None` 那一行,发票和错误码两种比例下的"默认"设置都显示平均返回 10.0 行、召回率 1.00,和我在 psql 里亲眼看到的"2 行"完全矛盾。我花了半个小时才想明白。

原因是 psycopg 的自动预编译。同一条 SQL 文本执行到第 6 次时,psycopg 让 Postgres 把它"预编译"成一份长期有效的计划缓存。我的脚本先用 `exact()` 跑了 50 次这条 SQL(那时 `enable_indexscan = off`,计划是顺序扫描),预编译发生在这个阶段;之后 `via_index()` 改了 `enable_seqscan`,但缓存的计划还在,Postgres 照旧用那份顺序扫描的计划,算出来的当然是精确答案。设置改了,计划没跟着变。

排查的办法是 `EXPLAIN` 同一条语句,发现计划变回了 `Seq Scan`。如果你以后写类似的"改设置、比较结果"的实验代码,记住这一条:要么像今天这样关掉自动预编译,要么每次换设置都用不同的连接。生产代码一般不改这些设置,影响不大,但做实验时它能让你得出完全错误的结论。

## 补救一:迭代扫描

迭代扫描(iterative index scan)是 pgvector 0.8.0 加的功能。索引先取一批候选,过滤后发现不够 `LIMIT` 要的数,就**接着往下扫索引**,再取一批,直到凑够或者碰到上限。用法就是一个设置:

```sql
SET hnsw.iterative_scan = relaxed_order;
```

它有三个值:`off`(默认,不迭代)、`relaxed_order`、`strict_order`。两种模式的区别是返回结果的顺序:`strict_order` 保证严格按距离从近到远,`relaxed_order` 允许有轻微的乱序,换来更高的召回率和更快的速度。我手头的 pgvector 版本是 0.8.6,GitHub README 上最新是 0.8.7(2026 年 10 月查到)。如果你写成 `on`,会得到真实的报错:

```text
ERROR:  invalid value for parameter "hnsw.iterative_scan": "on"
HINT:  Available values: off, relaxed_order, strict_order.
```

两个相关的上限也要知道。`hnsw.max_scan_tuples`(默认 20000)是一次查询最多翻看多少条索引元组,扫到这个数还没凑够就停,返回有多少给多少。`hnsw.scan_mem_multiplier`(默认 1)是迭代扫描最多用多少内存,按 `work_mem` 的倍数算。过滤得很严、符合条件的行极少时,这两个上限会先到,结果仍然可能不够数。

同一个发票查询,打开迭代扫描之后再 `EXPLAIN`(同样 `SET enable_seqscan = off`):

```text
 Limit (actual rows=10 loops=1)
   ...
   ->  Index Scan using ann_demo_hnsw on ann_demo (actual rows=10 loops=1)
         Order By: (embedding <=> (InitPlan 1).col1)
         Filter: (category = '发票'::text)
         Rows Removed by Filter: 637
 Planning Time: 0.064 ms
 Execution Time: 6.780 ms
```

10 行拿满了。`Rows Removed by Filter: 637` 是代价:为了找到 10 行发票,它翻了 647 行,筛掉 637 行。和之前的"取 40 行、筛掉 38 行"比,多翻了十几倍。

怎么选 `relaxed_order` 还是 `strict_order`:RAG 里检索结果马上要交给模型,top-5 里第 2 名和第 3 名顺序对调,几乎没有影响,我默认用 `relaxed_order`。需要严格有序(比如分页、"相似度最高的一条")才用 `strict_order`。

注意迭代扫描也是 `SET` 出来的会话设置,Day 233 说过的"连接池里设置会泄漏"一样适用,用 `SET LOCAL` 加事务更稳妥。

## 补救二:调大 ef_search

`ef_search` 调大的办法上面的表已经量过了:比例 10% 的时候,调到 200 就够,而且比迭代扫描还快(4.7 毫秒对 3 到 4 毫秒,基本一样);比例 1% 要 1000,耗时 9 毫秒;比例 0.1% 即使最大值也不行。最大值是 1000,超过会报错:

```text
ERROR:  1001 is outside the valid range for parameter "hnsw.ef_search" (1 .. 1000)
```

它的特点是简单,但是**所有**查询都变慢(包括不带过滤的),因为候选名单是全局的设置。如果你的系统里只有少数查询带严格过滤,更合适的做法是只给那几条查询单独 `SET LOCAL hnsw.ef_search = 200`,别改全局。

## 补救三:部分索引和普通索引

前两种办法都是"让 HNSW 多找一点"。还有一类办法是"别让 HNSW 去过滤"。

**部分索引**(partial index)是只给满足某个条件的行建索引:`CREATE INDEX ... WHERE category = '退款'`。这样退款类的 2000 行有自己的一张 HNSW 图,查询写了同样的 `WHERE category = '退款'`,规划器就会选它。图里全是退款类的点,没有"筛掉"这一步,自然拿得满数。

**普通索引**是给 `category` 列建一个 B-tree。Day 233 之前你可能已经见过它:`CREATE INDEX ... ON ann_demo (category)`。它让规划器多了一条路:先用 B-tree 把符合条件的行找出来(先过滤),再在里面精确排序。符合条件的行不太多时,规划器会选这条路,结果是精确的。

新建 `part04/filter_fixes.py`,把两种办法都量一遍:

```python
# agent-zero-lab/part04/filter_fixes.py
"""另外两种补救:给过滤条件建部分索引(partial index);给 category 建普通索引,看规划器怎么选。"""
import time

import numpy as np

from part04.pg_store import connect

conn = connect()
conn.prepare_threshold = None
rng = np.random.default_rng(1)
ids = [int(i) for i in rng.choice(20000, 50, replace=False)]
queries = [r[1] for r in conn.execute("SELECT id, embedding FROM ann_demo WHERE id = ANY(%s)", (ids,))]
SQL = "SELECT id FROM ann_demo WHERE category = '{cat}' ORDER BY embedding <=> %s LIMIT 10"


def measure(cat: str) -> tuple[float, float, float]:
    """返回 (平均返回行数, 召回率, 平均毫秒),标准答案来自不用索引的精确查询。"""
    rows, hit, ms = 0, 0, 0.0
    for q in queries:
        conn.execute("SET enable_indexscan = off; SET enable_bitmapscan = off; SET enable_seqscan = on")
        truth = {r[0] for r in conn.execute(SQL.format(cat=cat), (q,))}
        conn.execute("RESET enable_indexscan; RESET enable_bitmapscan; SET enable_seqscan = off")
        t0 = time.perf_counter()
        got = {r[0] for r in conn.execute(SQL.format(cat=cat), (q,))}
        ms += (time.perf_counter() - t0) * 1000
        rows += len(got)
        hit += len(got & truth)
    n = len(queries)
    return rows / n, hit / (10 * n), ms / n


print("--- 补救一:部分索引(只给 category 等于某个值的行建 HNSW)")
for cat in ["退款", "发票"]:
    t0 = time.perf_counter()
    conn.execute(
        f"CREATE INDEX ann_demo_{'refund' if cat == '退款' else 'invoice'}_hnsw ON ann_demo "
        f"USING hnsw (embedding vector_cosine_ops) WHERE category = '{cat}'"
    )
    build = time.perf_counter() - t0
    rows, recall, ms = measure(cat)
    print(f"{cat}:建索引 {build:.1f} 秒,平均返回 {rows:.1f} 行,召回率 {recall:.2f},平均 {ms:.1f} 毫秒")
for name, size in conn.execute(
    "SELECT indexrelname, pg_size_pretty(pg_relation_size(indexrelid)) FROM pg_stat_user_indexes "
    "WHERE relname = 'ann_demo' ORDER BY 1"
):
    print(f"  {name:<24}{size}")

print("--- 补救二:给 category 建普通索引(B-tree),不再强制走向量索引,看规划器自己怎么选")
conn.execute("DROP INDEX ann_demo_refund_hnsw; DROP INDEX ann_demo_invoice_hnsw")
conn.execute("CREATE INDEX ann_demo_category_idx ON ann_demo (category)")
conn.execute("ANALYZE ann_demo; RESET enable_seqscan")
for cat in ["退款", "发票", "错误码"]:
    plan = conn.execute("EXPLAIN " + SQL.format(cat=cat), (queries[0],)).fetchall()
    nodes = [ln[0].strip() for ln in plan if "Order By" not in ln[0]]
    print(f"{cat}:", " | ".join(n.split("  (cost")[0] for n in nodes if "->" in n or "Limit" in n))
conn.execute("DROP INDEX ann_demo_category_idx")
```

<div class="line-notes">

- `import time` 量建索引的耗时和查询耗时。
- `conn = connect()` 同样一条连接用到底。
- `conn.prepare_threshold = None` 同上,关掉自动预编译,否则中间改设置会被缓存的计划盖掉。
- `rng = np.random.default_rng(1)` 和 `filter_pitfall.py` 完全一样的种子,抽到同样的 50 个问题,两张表的数字才能比。
- `queries = [r[1] for r in conn.execute("SELECT id, embedding FROM ann_demo WHERE id = ANY(%s)"` 这次直接把取回的行放进列表推导式(Day 23)里,只留向量。
- `SQL = "SELECT id FROM ann_demo WHERE category = '{cat}' ORDER BY embedding <=> %s LIMIT 10"` 注意这次分类是写在 SQL 文本里的字面量,用 Python 的 `.format` 填,不是 `%s` 占位符。原因是部分索引的条件 `WHERE category = '退款'` 要和查询里的条件**逐字对上**,规划器才会用它。这里的 `cat` 来自代码里写死的两个值,没有任何用户输入;处理用户输入时千万不要这样拼 SQL(Day 232 的 `sql.Literal` 才是正确做法)。
- `def measure(cat: str) -> tuple[float, float, float]:` 返回三个数。`tuple[float, float, float]` 是返回值类型标注(Day 45)。
- `rows, hit, ms = 0, 0, 0.0` 三个累加器,同 `filter_pitfall.py`。
- `for q in queries:` 对每个问题各量一次。
- `conn.execute("SET enable_indexscan = off; SET enable_bitmapscan = off; SET enable_seqscan = on")` 一次发三条语句(用分号隔开)。这三条把所有索引路径关掉,只剩顺序扫描加排序,答案一定精确。`enable_bitmapscan` 也要关,因为后面有 B-tree 索引时,规划器可能走"位图扫描",虽然也是精确的,但这里要的是不依赖任何索引的标准答案。
- `truth = {r[0] for r in conn.execute(SQL.format(cat=cat), (q,))}` 集合推导式,和列表推导式一样,换成花括号。`SQL.format(cat=cat)` 把 `{cat}` 换成 `退款` 或 `发票`。
- `conn.execute("RESET enable_indexscan; RESET enable_bitmapscan; SET enable_seqscan = off")` 把前两个恢复成默认(开),再把顺序扫描关掉,逼规划器走索引。
- `t0 = time.perf_counter()` 开始计时。
- `got = {r[0] for r in conn.execute(SQL.format(cat=cat), (q,))}` 走索引的答案。
- `hit += len(got & truth)` 集合交集的大小。
- `return rows / n, hit / (10 * n), ms / n` 平均返回行数、召回率、平均毫秒。
- `for cat in ["退款", "发票"]:` 分别给两种分类建部分索引。
- `f"CREATE INDEX ann_demo_{'refund' if cat == '退款' else 'invoice'}_hnsw ON ann_demo "` 索引名:退款对应 `ann_demo_refund_hnsw`,发票对应 `ann_demo_invoice_hnsw`。f 字符串里嵌了一个三元表达式,Python 的三元写法是 `A if 条件 else B`,相当于 JS 的 `条件 ? A : B`。
- `f"USING hnsw (embedding vector_cosine_ops) WHERE category = '{cat}'"` 和 Day 229 的建索引语句相比,只多了最后的 `WHERE`。
- `build = time.perf_counter() - t0` 建这个部分索引花的秒数。
- `rows, recall, ms = measure(cat)` 量这种分类。
- `for name, size in conn.execute(` 括号里的查询是下面两行字符串:`SELECT indexrelname, pg_size_pretty(pg_relation_size(indexrelid)) FROM pg_stat_user_indexes WHERE relname = 'ann_demo' ORDER BY 1`。`pg_stat_user_indexes` 是 Postgres 内置的索引统计视图,每个索引一行;`indexrelname` 是索引名,`indexrelid` 用来算大小。这一步看三个 HNSW 索引各占多大。
- `conn.execute("DROP INDEX ann_demo_refund_hnsw; DROP INDEX ann_demo_invoice_hnsw")` 部分索引量完删掉,为的是下面单独看 B-tree 的作用。
- `conn.execute("CREATE INDEX ann_demo_category_idx ON ann_demo (category)")` 给 `category` 列建 B-tree 普通索引。不写 `USING` 默认就是 B-tree。
- `conn.execute("ANALYZE ann_demo; RESET enable_seqscan")` 重新统计,并且这次**不再**强制关掉顺序扫描,让规划器自由选。
- `plan = conn.execute("EXPLAIN " + SQL.format(cat=cat), (queries[0],)).fetchall()` 只 `EXPLAIN` 不执行(没有 `ANALYZE`),取执行计划的文字。
- `nodes = [ln[0].strip() for ln in plan if "Order By" not in ln[0]]` 计划里 `Order By:` 那一行会把 1024 个数字的问题向量整个打出来,过滤掉。
- `print(f"{cat}:", " | ".join(n.split("  (cost")[0] for n in nodes if "->" in n or "Limit" in n))` 每行去掉 `(cost=...)` 之后的部分,只留节点名,用 `|` 连起来。
- `conn.execute("DROP INDEX ann_demo_category_idx")` 清理,不让这个 B-tree 留着影响下面的实验。

</div>

```bash
uv run python -m part04.filter_fixes
```

```text
--- 补救一:部分索引(只给 category 等于某个值的行建 HNSW)
退款:建索引 4.4 秒,平均返回 10.0 行,召回率 1.00,平均 1.8 毫秒
发票:建索引 0.3 秒,平均返回 10.0 行,召回率 1.00,平均 2.1 毫秒
  ann_demo_hnsw           157 MB
  ann_demo_invoice_hnsw   1608 kB
  ann_demo_pkey           912 kB
  ann_demo_refund_hnsw    16 MB
--- 补救二:给 category 建普通索引(B-tree),不再强制走向量索引,看规划器自己怎么选
退款: Limit | ->  Sort | ->  Bitmap Heap Scan on ann_demo | ->  Bitmap Index Scan on ann_demo_category_idx
发票: Limit | ->  Sort | ->  Index Scan using ann_demo_category_idx on ann_demo
错误码: Limit | ->  Sort | ->  Index Scan using ann_demo_category_idx on ann_demo
```

部分索引干净利落:两种分类都拿满 10 行,召回率 1.00,而且比"带过滤的大索引"更快(1.8 毫秒),因为图里只有 2000 个点或者 200 个点。代价是每多一个分类值就要多一个索引:退款的索引占 16 MB(2000 个点,每点约 8 KB,和 Day 233 的 156 MB / 20000 行吻合),发票的 1.6 MB。所以它只适合"分类值很少、很固定、查询里天天按它过滤"的场景,比如一个客服知识库里"退款"就是最常被单独搜的那一类。

普通索引那三行,规划器自己的选择:退款走 `Bitmap Heap Scan`(用 B-tree 把 2000 行找出来),发票和错误码走 `Index Scan using ann_demo_category_idx`,三种都**根本没用 HNSW**,是 B-tree 找出符合条件的行,再 `Sort` 精确排序。所以你给过滤列建了普通索引以后,这个坑反而"消失"了,规划器认为先过滤更划算,结果是精确的,也不会少。这和 Day 233 里"小表上走不到索引"是同一个原因:规划器是按成本选路的。坑出现的条件是:过滤列没有索引、或者符合条件的行太多(比如占 30% 以上)、数据又大到全表扫描不划算,这时规划器才会走 HNSW 再过滤。

**分区**(partition)是第四种办法:把大表按分类拆成几张物理上独立的小表,每张表各建自己的 HNSW 索引,查询带 `WHERE category = ...` 时 Postgres 只去对应那张表。多租户系统("每个客户只能搜自己的知识库")常用它,按 `tenant_id` 分区。pgvector 的 README 也建议:按很多不同的值过滤,考虑分区;只按少数几个值过滤,考虑部分索引。分区我今天没有实跑,只在这里讲思路。

四种办法放在一起:

| 办法 | 返回行数 | 代价 | 适合 |
| --- | --- | --- | --- |
| 迭代扫描 | 拿满(够数时) | 过滤越严越慢(0.1% 时 79 毫秒) | 过滤条件五花八门,不想为每种建索引 |
| 调大 `ef_search` | 看比例,0.1% 时不行 | 所有查询都变慢 | 过滤比例在 1% 以上,条件固定 |
| 部分索引 | 拿满 | 每个值一个索引,占空间,要维护 | 只有几个固定的热门分类 |
| 普通索引(B-tree) | 拿满且精确 | 符合条件的行多时,要算很多距离 | 过滤很严(符合条件的行少) |
| 分区 | 拿满 | 建表和维护更复杂 | 按租户、按很多不同的值过滤 |

我自己的顺序:先给过滤列建 B-tree(最便宜,过滤严的时候自动解决);过滤不太严、又常用的,开 `relaxed_order`;分类固定而且特别热的,上部分索引;租户隔离走分区。别一上来就把 `ef_search` 全局调大。

## 选型:先算账,再比较

面试一定会问:"为什么用 pgvector,不用 Milvus?" 好回答要有数字。我们刚好有一组实测的数字:2 万行、1024 维,表 107 MB,HNSW 索引 156 MB(Day 233 实测)。把它们除以行数,得到每行的表空间和索引空间,再乘以不同规模。新建 `part04/capacity.py`:

```python
# agent-zero-lab/part04/capacity.py
"""估算:N 条向量放进 pgvector,表和索引大概占多少空间。系数来自 Day 233 在 2 万行上的实测。"""

DIM = 1024
# Day 233 实测:2 万行 1024 维,表 107 MB,HNSW 索引 156 MB
TABLE_PER_ROW = 107 * 1024 * 1024 / 20000
INDEX_PER_ROW = 156 * 1024 * 1024 / 20000
RAW_PER_ROW = DIM * 4 + 8  # 每个 float32 占 4 字节,另加 8 字节头(Day 229 算的 4104)


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.0f} {unit}" if unit in ("B", "KB") else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


print(f"每行:纯向量 {RAW_PER_ROW} 字节,表实测 {TABLE_PER_ROW:.0f} 字节,索引实测 {INDEX_PER_ROW:.0f} 字节")
print(f"{'向量条数':>12}{'纯向量':>10}{'表':>10}{'HNSW 索引':>12}{'表+索引':>10}")
for n in [20_000, 1_000_000, 10_000_000, 100_000_000]:
    raw, table, index = n * RAW_PER_ROW, n * TABLE_PER_ROW, n * INDEX_PER_ROW
    print(f"{n:>12,}{human(raw):>10}{human(table):>10}{human(index):>12}{human(table + index):>10}")
```

<div class="line-notes">

- `DIM = 1024` 向量维度,bge-m3 是 1024 维。
- `TABLE_PER_ROW = 107 * 1024 * 1024 / 20000` Day 233 实测表 107 MB,换成字节再除以 2 万行,每行约 5610 字节。比纯向量(4104 字节)大,多出来的是行头、主键索引和别的列。
- `INDEX_PER_ROW = 156 * 1024 * 1024 / 20000` HNSW 索引 156 MB 除以 2 万行,每行约 8179 字节,比向量本身的 4104 字节大一倍,因为图里还存着每个点的邻居列表。
- `RAW_PER_ROW = DIM * 4 + 8` 每个 float32 占 4 个字节,1024 个就是 4096,加上 8 字节的头,4104。Day 229 就是这样算的。
- `def human(n: float) -> str:` 把字节数转成人能读的单位。
- `for unit in ("B", "KB", "MB", "GB", "TB"):` 从小到大试每个单位。
- `if n < 1024:` 小于 1024 就用当前单位。例如 `n` 是 3.8 × 1024³ 字节,前三轮每轮除以 1024,到 GB 这一轮时 `n` 是 3.8,小于 1024,返回 `3.8 GB`。
- `return f"{n:.0f} {unit}" if unit in ("B", "KB") else f"{n:.1f} {unit}"` B 和 KB 取整,MB 以上保留一位小数。
- `n /= 1024` 不够就除以 1024,换下一个单位。
- `return f"{n:.1f} PB"` 万一超过 TB,兜底。
- `print(f"每行:纯向量 {RAW_PER_ROW} 字节,` 打印三个每行系数。
- `for n in [20_000, 1_000_000, 10_000_000, 100_000_000]:` 数字里的下划线只是方便读,`20_000` 就是 20000。四种规模:2 万(今天的表)、100 万、1000 万、1 亿。
- `raw, table, index = n * RAW_PER_ROW, n * TABLE_PER_ROW, n * INDEX_PER_ROW` 三项都是"行数 × 每行字节数"。
- `print(f"{n:>12,}{human(raw):>10}` `:>12,` 右对齐占 12 格,并且加千位分隔符。

</div>

```bash
uv run python -m part04.capacity
```

```text
每行:纯向量 4104 字节,表实测 5610 字节,索引实测 8179 字节
        向量条数       纯向量         表     HNSW 索引      表+索引
      20,000   78.3 MB  107.0 MB    156.0 MB  263.0 MB
   1,000,000    3.8 GB    5.2 GB      7.6 GB   12.8 GB
  10,000,000   38.2 GB   52.2 GB     76.2 GB  128.4 GB
 100,000,000  382.2 GB  522.5 GB    761.7 GB    1.3 TB
```

这是线性外推,真实情况会有出入(数据分布、`m` 参数、TOAST 都会影响),但数量级够用了。对比两个现实的问题:

- 一个中小企业的客服知识库,几万块到几十万块,总共几个 GB。`pgvector` 绰绰有余,而且和订阅、工单、客户权限这些业务表放在同一个库里,联查、事务、备份、权限都是现成的。
- 到了 1000 万条,表加索引 128 GB,想要查询快,索引最好整个放进内存(Day 233 说的),就需要一台内存很大的机器,这时候专门的向量数据库(分片、量化、磁盘索引)才开始有明显优势。到 1 亿条 1.3 TB,单机 Postgres 已经不是一个轻松的选择。

内存紧张还有一个办法,是降低向量的精度。pgvector 有 `halfvec` 类型,每个数占 2 字节而不是 4 字节。练习 4 会实测:同样的 2 万行,`halfvec` 索引只占 52 MB,是 `vector` 索引(157 MB)的三分之一,召回率没有掉。

### 选型表

下表按我自己的理解整理,每个产品的特点来自它们的官方文档或官方博客(2026 年 10 月查到,Milvus 部分官方文档页没抓下来,部署形态来自 Zilliz 博客等二手文章,标注在表里)。**规模上的说法只是量级,具体以你自己的压测为准**。

| 方案 | 本质 | 过滤怎么做 | 适合 | 不太适合 |
| --- | --- | --- | --- | --- |
| pgvector | Postgres 扩展 | 后过滤 + 迭代扫描,或走 B-tree/部分索引/分区 | 已经有 Postgres;百万到千万级;要和业务数据联查、要事务 | 上亿规模、需要分布式或磁盘索引 |
| Milvus | 专门的分布式向量数据库,有 Lite、Standalone、Distributed 三种形态(二手来源) | 内置标量过滤 | 上亿规模、高并发、有专人运维(分布式要 Kubernetes) | 小团队、数据量小(运维成本太高) |
| Qdrant | 专门的向量数据库(Rust) | 给过滤字段建 payload 索引,HNSW 图里为同值的点额外加边,查询时自己选策略(官方文档) | 过滤条件复杂、单机性能、部署简单 | 需要复杂的关系查询 |
| Chroma | 轻量向量库,Python 里 `PersistentClient` 落本地磁盘,也有 client-server 和云版(官方文档) | 元数据过滤 | 原型、本地实验、教程 | 高并发生产 |
| Elasticsearch / OpenSearch | 搜索引擎,加了向量检索 | 同一个引擎里做过滤、关键词、向量 | 已经有 ES;强依赖关键词检索和混合检索(RRF 是内置的,Day 236 讲) | 只做纯向量检索(偏重) |
| FAISS | Meta 的向量检索**库**,不是数据库 | 自己写 | 离线批处理、研究、自己封装服务 | 要增删改和持久化的线上服务 |

Qdrant 那一行值得多说一句,因为它正好是今天这个坑的"另一种解法":官方文档说,过滤字段要在**灌数据之前**建 payload 索引,这样 HNSW 图建出来时会给"同一个值的点"之间额外加边,过滤查询在图上也走得通;如果数据已经灌进去了再建 payload 索引,要重建 HNSW 才有效。Qdrant 的博客里给过一组 100 万点的测试:不加这些额外的边建索引 116 秒,加了要 507 到 652 秒。专门的向量库是在图的结构里解决过滤问题,代价是建图更慢;pgvector 让你用 SQL 的几种办法绕开。这是两种思路,不是谁对谁错。

我的建议是:先用 pgvector,直到你有明确的证据(压测数据、规模预估)证明它扛不住。被问"为什么不用 Milvus"时,好回答大概是:

> 我们的规模是 X 万块,按 `capacity.py` 的估算,表加索引大约 Y GB,可以放进一台机器的内存;pgvector 的 P95 延迟实测 Z 毫秒,满足要求。知识库要和客户套餐表联查做权限过滤,放在同一个库里事务和权限都简单。过滤方面,常用的分类建了部分索引,其余开了 `relaxed_order` 迭代扫描,实测拿得满数。如果规模涨到上亿,或者 QPS 超过单机能力,会迁移,迁移的主要成本是重建索引和改查询层。

有数字、有取舍、有退路。X、Y、Z 要换成你自己量出来的,今天的表只是帮你练手。

## 动手练习

**练习 1:`ef_search` 要调到多少,退款类才能稳定拿满 10 行?** 在 `ann_demo` 上,退款占 10%,默认 `ef_search = 40` 时平均只有 4.2 行。试 40、60、80、100、150、200,每档数一数 50 个问题里有多少个拿满了 10 行。

<details><summary>参考答案</summary>

新建 `part04/ex_ef_find.py`:

```python
# agent-zero-lab/part04/ex_ef_find.py
"""练习 1:退款占 10% 时,ef_search 调到多少,LIMIT 10 才能稳定拿满 10 行?"""
import numpy as np

from part04.pg_store import connect

SQL = "SELECT id FROM ann_demo WHERE category = '退款' ORDER BY embedding <=> %s LIMIT 10"
conn = connect()
conn.prepare_threshold = None
rng = np.random.default_rng(1)
ids = [int(i) for i in rng.choice(20000, 50, replace=False)]
queries = [r[1] for r in conn.execute("SELECT id, embedding FROM ann_demo WHERE id = ANY(%s)", (ids,))]
conn.execute("SET enable_seqscan = off")

print(f"{'ef_search':>10}{'平均返回行数':>12}{'拿满 10 行的查询数':>20}")
for ef in [40, 60, 80, 100, 150, 200]:
    conn.execute("SELECT set_config('hnsw.ef_search', %s, false)", (str(ef),))
    counts = [len(conn.execute(SQL, (q,)).fetchall()) for q in queries]
    print(f"{ef:>10}{sum(counts) / len(counts):>12.1f}{sum(c == 10 for c in counts):>16}/{len(counts)}")
```

<div class="line-notes">

- `SQL = "SELECT id FROM ann_demo WHERE category = '退款' ORDER BY embedding <=> %s LIMIT 10"` 只测退款,分类直接写在 SQL 里,只剩问题向量一个占位符。
- `conn.prepare_threshold = None` 关掉自动预编译,原因同 `filter_pitfall.py`:下面要反复改 `ef_search`。
- `queries = [r[1] for r in conn.execute(` 同样种子抽的 50 个问题向量,和前面的表是同一批。
- `conn.execute("SET enable_seqscan = off")` 强制走索引。
- `for ef in [40, 60, 80, 100, 150, 200]:` 六档。
- `conn.execute("SELECT set_config('hnsw.ef_search', %s, false)", (str(ef),))` 把 `ef_search` 设成这一档的值。`str(ef)` 因为 `set_config` 的值参数是文本。
- `counts = [len(conn.execute(SQL, (q,)).fetchall()) for q in queries]` 每个问题返回几行,得到一个 50 个数的列表。
- `print(f"{ef:>10}{sum(counts) / len(counts):>12.1f}{sum(c == 10 for c in counts):>16}/{len(counts)}")` 平均返回行数,以及"恰好 10 行"的个数。`sum(c == 10 for c in counts)` 里每个 `c == 10` 是 `True` 或 `False`,`sum` 把 `True` 当 1 相加。

</div>

```bash
uv run python -m part04.ex_ef_find
```

```text
 ef_search      平均返回行数      拿满 10 行的查询数
        40         4.2               0/50
        60         6.4               7/50
        80         7.7              16/50
       100         9.0              31/50
       150         9.8              47/50
       200        10.0              50/50
```

要稳定拿满 10 行,得调到 200,是比例 10% 对应的理论值(10 ÷ 10% = 100)的两倍。因为候选里符合条件的行数是随机波动的,平均 10 行,有的问题就是 7 行、有的 13 行,想让**每个**问题都够数,要给足余量。`ef_search = 100` 平均已经 9.0 行,但只有 31/50 的问题拿满。这里的教训是:平均数够了不等于每个查询都够。

</details>

**练习 2:`kb_chunks` 上分类选错了会怎样?** 问"发票开错了怎么办",分别不过滤、只搜「发票」类、只搜「退款」类,看前 4 名。注意这次不调大模型,只检索。

<details><summary>参考答案</summary>

新建 `part04/ex_wrong_category.py`:

```python
# agent-zero-lab/part04/ex_wrong_category.py
"""练习 2:kb_chunks 上,分类过滤选错了会怎样。只做检索,不调大模型。"""
from common.embed import embed_one
from part04.pg_store import connect, search

Q = "发票开错了怎么办"
with connect() as conn:
    v = embed_one(Q)
    for label, cats in [("不过滤", None), ("只搜 发票", ["发票"]), ("只搜 退款(选错了)", ["退款"])]:
        print(f"{label}:")
        for c, s in search(conn, v, k=4, categories=cats):
            print(f"   {s:.3f}  {c.id:<9}[{c.category}] {c.title} > {c.section}")
```

<div class="line-notes">

- `from part04.pg_store import connect, search` Day 232 写的 `search(conn, query_vec, k, categories)`,返回 `(块, 相似度)` 的列表。
- `v = embed_one(Q)` 问题向量只算一次,三种过滤共用。
- `for label, cats in [("不过滤", None), ("只搜 发票", ["发票"]), ("只搜 退款(选错了)", ["退款"])]:` 三种情况,`None` 表示不过滤。
- `for c, s in search(conn, v, k=4, categories=cats):` 每次最多取 4 块,`c` 是块,`s` 是相似度。
- `print(f"   {s:.3f}  {c.id:<9}[{c.category}] {c.title} > {c.section}")` 相似度、块编号、分类、标题和小节。

</div>

```bash
uv run python -m part04.ex_wrong_category
```

```text
不过滤:
   0.741  kb-007#1 [发票] 修改发票抬头 > 开错了怎么办
   0.669  kb-012#2 [错误码] 错误码 E2017:发票识别失败 > 解决办法
   0.659  kb-003#2 [退款] 如何申请退款 > 已经开了发票怎么办
   0.634  kb-006#2 [发票] 发票类型与开具 > 怎么申请
只搜 发票:
   0.741  kb-007#1 [发票] 修改发票抬头 > 开错了怎么办
   0.634  kb-006#2 [发票] 发票类型与开具 > 怎么申请
   0.592  kb-006#1 [发票] 发票类型与开具 > 可以开哪种发票
只搜 退款(选错了):
   0.659  kb-003#2 [退款] 如何申请退款 > 已经开了发票怎么办
   0.516  kb-002#3 [退款] 退款政策 > 重复扣款
   0.488  kb-002#1 [退款] 退款政策 > 年付套餐
   0.472  kb-003#1 [退款] 如何申请退款 > 操作步骤
```

两个现象。一,「只搜发票」只返回了 3 行,不是 4 行。这不是前面的坑:`kb_chunks` 只有 42 行,走的是顺序扫描加精确排序,发票这个分类一共只有 3 块(kb-006 两块、kb-007 一块),要 4 行也没有。过滤后的候选池本来就小于 `k`,这种情况是正常的。二,「只搜退款」(选错了分类)返回了 4 行,但最相关的 kb-007#1 被挡在外面,最高分只有 0.659,第 2 名起分数断崖式下降(0.516、0.488)。排在后面的几块和问题几乎无关,模型拿到它们还是会老老实实去回答,可能答出一个似是而非的结论。**过滤比不过滤更危险**,尤其是分类是由另一个模型猜出来的时候。

</details>

**练习 3:过滤条件和问题方向不同时会怎样?** 到现在为止分类是按 `id` 取余分配的,和向量毫无关系。真实数据里分类和语义是相关的:「退款」类的文章,向量本来就聚在一起。给每一行打上"它所属簇的真实分类"(`ann_demo` 的每一行是某个真实块加噪声造的,那个块的分类就是它的分类),拿 6 个退款类块的向量当问题,分别过滤「退款」「错误码」「账号与安全」。

<details><summary>参考答案</summary>

新建 `part04/ex_correlated.py`:

```python
# agent-zero-lab/part04/ex_correlated.py
"""过滤条件和问题「同一个方向」vs「不同方向」:给每一行打上它所属簇的分类,再带 WHERE 查。"""
import time

import numpy as np

from part04.build_index import load_index
from part04.pg_store import connect

chunks, base = load_index()
rng = np.random.default_rng(7)  # 和 make_ann_demo.py 同一个种子:前 20000 个随机整数就是每行的中心编号
centers = rng.integers(0, len(base), 20000)
cats = [chunks[i].category for i in centers]

conn = connect()
conn.prepare_threshold = None
conn.execute("ALTER TABLE ann_demo ADD COLUMN IF NOT EXISTS kb_cat text")
with conn.cursor() as cur:
    cur.execute("CREATE TEMP TABLE tmp_cat (id int, kb_cat text)")
    with cur.copy("COPY tmp_cat (id, kb_cat) FROM STDIN") as cp:
        for i, c in enumerate(cats):
            cp.write_row((i, c))
    cur.execute("UPDATE ann_demo a SET kb_cat = t.kb_cat FROM tmp_cat t WHERE a.id = t.id")
conn.execute("VACUUM ANALYZE ann_demo")
for cat, n in conn.execute("SELECT kb_cat, count(*) FROM ann_demo GROUP BY 1 ORDER BY 2 DESC"):
    print(f"{cat:<8}{n:>6} 行 ({n / 200:.1f}%)")

SQL = "SELECT id FROM ann_demo WHERE kb_cat = %s ORDER BY embedding <=> %s LIMIT 10"
refund_qs = [base[i] for i, c in enumerate(chunks) if c.category == "退款"]  # 6 个退款类问题(块向量当问题)
conn.execute("SET enable_seqscan = off")  # 逼规划器走 HNSW
print(f"\n{'过滤':<8}{'设置':<14}{'平均返回行数':>10}{'平均毫秒':>9}   (6 个「退款」方向的问题)")
for cat in ["退款", "错误码", "账号与安全"]:
    for name, it in [("默认", "off"), ("relaxed_order", "relaxed_order")]:
        conn.execute("SELECT set_config('hnsw.iterative_scan', %s, false)", (it,))
        rows, ms = 0, 0.0
        for q in refund_qs:
            t0 = time.perf_counter()
            rows += len(conn.execute(SQL, (cat, q)).fetchall())
            ms += (time.perf_counter() - t0) * 1000
        print(f"{cat:<8}{name:<14}{rows / len(refund_qs):>10.1f}{ms / len(refund_qs):>9.1f}")
```

<div class="line-notes">

- `chunks, base = load_index()` Day 225 的 `index/`:42 个真实块和它们的 42 个向量(`base` 形状 `(42, 1024)`)。
- `rng = np.random.default_rng(7)` 和 Day 233 的 `make_ann_demo.py` **同一个种子**。
- `centers = rng.integers(0, len(base), 20000)` 重放 `make_ann_demo.py` 里"给每行随机挑一个中心"的那一步。因为种子相同、调用顺序相同(在 `make_ann_demo.py` 里它是第一次使用 `rng`),得到的 2 万个编号和当时造表时的完全一致,第 `i` 个数就是第 `i` 行用的是哪个真实块。
- `cats = [chunks[i].category for i in centers]` 把"块编号"换成"块的分类"。第 0 行是 3 号块的话,它的分类就是第 3 块的分类。
- `conn.execute("ALTER TABLE ann_demo ADD COLUMN IF NOT EXISTS kb_cat text")` 再加一列 `kb_cat`,和上面随机的 `category` 并存。
- `cur.execute("CREATE TEMP TABLE tmp_cat (id int, kb_cat text)")` 临时表,连接断开自动消失。
- `with cur.copy("COPY tmp_cat (id, kb_cat) FROM STDIN") as cp:` Day 233 用过的 `COPY` 批量写入。
- `cp.write_row((i, c))` 写入 `(行号, 分类)`,2 万行。
- `cur.execute("UPDATE ann_demo a SET kb_cat = t.kb_cat FROM tmp_cat t WHERE a.id = t.id")` 用临时表更新主表:`UPDATE ... FROM` 把两张表按 `id` 对上,一次改完 2 万行,比循环 2 万次 `UPDATE` 快得多。
- `conn.execute("VACUUM ANALYZE ann_demo")` 同样要清理死行。
- `for cat, n in conn.execute("SELECT kb_cat, count(*) FROM` 看各分类各有多少行,真实分类的分布是不均匀的,套餐与计费 24%,开发者只有 4.9%。
- `SQL = "SELECT id FROM ann_demo WHERE kb_cat = %s ORDER BY embedding <=> %s LIMIT 10"` 这次过滤 `kb_cat` 列。
- `refund_qs = [base[i] for i, c in enumerate(chunks) if c.category == "退款"]` 6 个退款类的块向量,当问题用。`enumerate` 同时给下标和元素。
- `conn.execute("SET enable_seqscan = off")` 强制走索引。
- `for cat in ["退款", "错误码", "账号与安全"]:` 三种过滤,第一种和问题同方向,后两种不同。
- `for name, it in [("默认", "off"), ("relaxed_order", "relaxed_order")]:` 两种设置。
- `conn.execute("SELECT set_config('hnsw.iterative_scan', %s, false)", (it,))` 切换迭代扫描。
- `rows += len(conn.execute(SQL, (cat, q)).fetchall())` 累加返回行数,6 个问题平均。

</div>

```bash
uv run python -m part04.ex_correlated
```

```text
套餐与计费     4805 行 (24.0%)
错误码       3691 行 (18.5%)
退款        2893 行 (14.5%)
账号与安全     2868 行 (14.3%)
数据导入导出    1918 行 (9.6%)
团队与权限     1432 行 (7.2%)
发票        1415 行 (7.1%)
开发者        978 行 (4.9%)

过滤      设置                平均返回行数     平均毫秒   (6 个「退款」方向的问题)
退款      默认                  10.0      6.9
退款      relaxed_order       10.0      1.9
错误码     默认                   0.0      1.8
错误码     relaxed_order       10.0     84.3
账号与安全   默认                   0.0      1.6
账号与安全   relaxed_order       10.0     18.0
```

三种过滤的候选池都不小(「错误码」有 3691 行,18.5%),但结果天差地别。过滤「退款」(和问题同方向)时,40 个候选几乎全是退款类,筛完还是 10 行。过滤「错误码」或「账号与安全」时,问题在退款的区域里,最近的 40 个点全是退款簇的点,筛完一行不剩,平均 **0.0 行**。同样的 18.5% 比例,上面随机分配时能拿到 4 行,这里一行都拿不到。所以"比例 × 候选数"只是**随机分布**下的估算,真实数据里过滤条件和问题越"不相干",实际情况越糟。迭代扫描能救回来,但是要一路扫过整个退款簇才走到错误码簇,错误码那一行 84 毫秒。

这个现象的现实版本是:用户在"退款"版块里提问,系统按用户当前所在的版块做了分类过滤,搜出来全空,用户却在别的版块问了一个退款问题。

</details>

**练习 4:`halfvec` 能省多少空间?** 用 `halfvec` 给 `ann_demo` 建一个索引,对比它和 `vector` 索引的大小,再量召回率。

<details><summary>参考答案</summary>

`halfvec` 是 pgvector 0.7 起支持的类型,每个数占 2 字节(半精度浮点,float16)。不改表的列类型,只在索引里用:`CREATE INDEX ... USING hnsw ((embedding::halfvec(1024)) halfvec_cosine_ops)`。新建 `part04/ex_halfvec.py`:

```python
# agent-zero-lab/part04/ex_halfvec.py
"""用 halfvec(每个数 2 字节)给 ann_demo 建一个索引:占多大、召回率掉多少。"""
import time

import numpy as np

from part04.pg_store import connect

conn = connect()
conn.prepare_threshold = None
conn.execute("SET maintenance_work_mem = '512MB'")
conn.execute("DROP INDEX IF EXISTS ann_demo_half")
t0 = time.perf_counter()
conn.execute("CREATE INDEX ann_demo_half ON ann_demo USING hnsw ((embedding::halfvec(1024)) halfvec_cosine_ops)")
print(f"建索引 {time.perf_counter() - t0:.1f} 秒")
for name in ["ann_demo_hnsw", "ann_demo_half"]:
    row = conn.execute("SELECT pg_size_pretty(pg_relation_size(%s::regclass))", (name,)).fetchone()
    print(f"{name:<15}{row[0] if row else '?'}")

rng = np.random.default_rng(1)
ids = [int(i) for i in rng.choice(20000, 50, replace=False)]
queries = [r[1] for r in conn.execute("SELECT id, embedding FROM ann_demo WHERE id = ANY(%s)", (ids,))]
EXACT = "SELECT id FROM ann_demo ORDER BY embedding <=> %s LIMIT 10"
HALF = "SELECT id FROM ann_demo ORDER BY embedding::halfvec(1024) <=> %s::halfvec(1024) LIMIT 10"
hit, ms = 0, 0.0
for q in queries:
    conn.execute("SET enable_indexscan = off")  # 精确答案:不走任何索引,float32 全表算
    truth = {r[0] for r in conn.execute(EXACT, (q,))}
    conn.execute("RESET enable_indexscan")
    t0 = time.perf_counter()
    got = {r[0] for r in conn.execute(HALF, (q,))}
    ms += (time.perf_counter() - t0) * 1000
    hit += len(got & truth)
print(f"halfvec 索引召回率 {hit / (10 * len(queries)):.2f},平均 {ms / len(queries):.1f} 毫秒")
conn.execute("DROP INDEX ann_demo_half")
```

<div class="line-notes">

- `conn.execute("SET maintenance_work_mem = '512MB'")` 建索引前给 512 MB 内存,Day 233 说过默认 64 MB 装不下图会慢很多。**这意味着下面的建索引时间不能和 Day 233 的 169 秒直接比**,那次用的是默认内存。
- `conn.execute("DROP INDEX IF EXISTS ann_demo_half")` 重复运行时先删。
- `"CREATE INDEX ann_demo_half ON ann_demo USING hnsw ((embedding::halfvec(1024)) halfvec_cosine_ops)"` 对表达式建索引:`embedding::halfvec(1024)` 把每行的 `vector` 转成 `halfvec`(`::` 是类型转换),索引里存的是转换后的半精度向量。表达式要用括号包起来。运算符类换成 `halfvec_cosine_ops`。
- `for name in ["ann_demo_hnsw", "ann_demo_half"]:` 比较两个索引的大小。
- `conn.execute("SELECT pg_size_pretty(pg_relation_size(%s::regclass))", (name,))` `%s::regclass` 把索引名当成"关系对象"传给 `pg_relation_size`。
- `HALF = "SELECT id FROM ann_demo ORDER BY embedding::halfvec(1024) <=> %s::halfvec(1024) LIMIT 10"` 查询里的表达式必须和建索引时**逐字一致**(两边都要转 `halfvec(1024)`),否则索引用不上,这是 Day 233 "`ORDER BY` 写成表达式不走索引"的另一面:索引建在表达式上,查询就必须写同一个表达式。
- `conn.execute("SET enable_indexscan = off")` 标准答案用原始的 `float32` 向量做精确排序,不走任何索引。
- `got = {r[0] for r in conn.execute(HALF, (q,))}` `halfvec` 索引的答案。
- `print(f"halfvec 索引召回率` 50 个问题平均。
- `conn.execute("DROP INDEX ann_demo_half")` 做完删掉。

</div>

```bash
uv run python -m part04.ex_halfvec
```

```text
建索引 20.3 秒
ann_demo_hnsw  157 MB
ann_demo_half  52 MB
halfvec 索引召回率 1.00,平均 18.9 毫秒
```

索引从 157 MB 降到 52 MB,正好三分之一。召回率 1.00,在这批 50 个问题上没有掉。平均耗时 18.9 毫秒偏高,是因为这一批查询里有些前几次访问要把索引页读进内存,而且每个问题都要把 1024 个数字传给数据库,我没有进一步拆开测。你自己的数据上召回率会不同,要用真实数据重新量。

半精度会损失一点点精度:float16 只有大约 3 位有效数字,对于相似度排序这个用途,通常够用,但极端相近的两条结果的排序可能对调。

</details>

**练习 5(开放题):三个场景选型。** 为下面三个场景各选一个方案,写出理由、数字和退路。(a) 一个 5 人团队的内部知识库问答,3 万个块,已经有 Postgres。(b) 一个 SaaS 的"所有客户各自的文档库",1 万个客户,每家 5 千块,查询必须只搜自己家的。(c) 一个电商的商品语义搜索,5 千万商品,每秒 2000 次查询,需要按价格、品类、库存过滤。

<details><summary>参考答案</summary>

示范解法。用 `capacity.py` 的系数估算。

(a) **pgvector**。3 万块,表加索引大约 3 万 × (5610 + 8179) ≈ 395 MB,一台普通机器的内存放得下,延迟几毫秒。已经有 Postgres,不需要新增组件,备份和权限都是现成的。过滤:块数这么少,规划器会走顺序扫描,结果是精确的,不会碰到后过滤的坑。退路:将来涨到几百万块再评估;迁移成本是重建索引。

(b) **pgvector,按客户分区**(或者每个客户一个部分索引,但 1 万个客户太多,分区更合适)。总共 5000 万块,表加索引约 5000 万 × 13789 字节 ≈ 640 GB,是不小的体量,但按客户分区后,每次查询只碰一个分区(5 千块,大约 65 MB),又快又不会有后过滤的坑,这是多租户的典型解法。需要注意 1 万个分区本身的管理成本(Postgres 分区数过万会拖慢规划),必要时按客户哈希分成几百个分区,再在分区里加 `customer_id` 过滤。如果规模继续涨,考虑 Qdrant,它对"按租户过滤"有专门的优化(官方文档里有多租户的建议)。我没有实测这个场景。

(c) **专门的向量数据库(Milvus 或 Qdrant)**。5000 万商品,线性外推表加索引约 5000 万 × 13789 字节 ≈ 640 GB,每秒 2000 次查询,还要同时按价格、品类、库存过滤(过滤字段多、组合多,部分索引和分区都不现实)。pgvector 单机放不下、也撑不住这个 QPS,过滤要靠迭代扫描一路翻,延迟不可控。Qdrant 的 payload 索引加过滤感知的 HNSW,或者 Milvus 的分布式部署,更对口。这时选型的主要成本是运维(分片、副本、监控)。我没有实测这个场景,只是按今天的数字推断。

三个答案的共同点是:先算数据量和内存,再看过滤方式,最后才谈产品。

</details>

验收标准:`make_filter_demo.py` 打印出 10% / 1% / 0.1% 三种分类;psql 里 `SET enable_seqscan = off` 后,退款查询 `LIMIT 10` 只返回约 4 行,`EXPLAIN` 里有 `Filter` 和 `Rows Removed by Filter: 36`;`filter_pitfall.py` 的表里,默认设置下退款约 4 行、错误码接近 0 行,迭代扫描后都是 10 行;`filter_fixes.py` 里部分索引两种分类都拿满 10 行;`capacity.py` 打印出四种规模的估算;能不看文章讲清"先过滤和后过滤""四种补救各自的代价",并回答"为什么用 pgvector 不用 Milvus"。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 先过滤(pre-filter) | 先按条件筛出符合的行,再在这些行里找最近的。结果一定够数,但要对所有符合条件的行做计算 |
| 后过滤(post-filter) | 先按向量取最近的一批候选,再按条件筛。快,但剩下的行数不可控。pgvector 的 HNSW 就是这种 |
| 选择度 | `WHERE` 条件匹配的行占全表的比例。匹配 10% 的行,选择度就是 10% |
| 迭代扫描 | 候选不够数时接着往下扫索引,直到凑够或达到上限。pgvector 0.8.0 起,`hnsw.iterative_scan` |
| `relaxed_order` / `strict_order` | 迭代扫描的两种模式:允许结果顺序有轻微偏差(召回高、快),或严格按距离排序 |
| `hnsw.max_scan_tuples` | 迭代扫描最多翻看多少条索引元组,默认 20000,到了就停 |
| 部分索引(partial index) | 只给满足某个 `WHERE` 条件的行建的索引,条件要和查询里写的逐字对上才会被用 |
| B-tree | Postgres 默认的普通索引类型,擅长等值和范围查询,`CREATE INDEX ... ON t (col)` 建出来的就是 |
| 分区(partition) | 把一张大表按某个列的值拆成几张物理上独立的小表,每张各自建索引 |
| `Rows Removed by Filter` | `EXPLAIN ANALYZE` 里的一行,表示扫描过程中被 `WHERE` 筛掉了多少行 |
| GUC | Postgres 运行时参数的统称,`SET` 或 `set_config` 修改的都是它,比如 `hnsw.ef_search` |
| 预编译语句(prepared statement) | 把 SQL 的解析和计划提前做好并缓存,以后只传参数。psycopg 对同一条 SQL 执行第 6 次起自动启用 |
| `halfvec` | pgvector 的半精度向量类型,每个数占 2 字节,索引大小约是 `vector` 的三分之一 |
| 载荷索引(payload index) | Qdrant 里给元数据字段建的索引,用来加速过滤,也会让 HNSW 图在同值的点之间多连边 |

## 常见误区

**在测试库里看到带 `WHERE` 的查询一切正常,就以为没问题。** 小表上规划器会走顺序扫描,结果是精确的。今天一开始的 `EXPLAIN` 就是这样,`Seq Scan` 加 `Sort`,10 行拿满。坑出现的条件是数据大到规划器改走 HNSW 索引,所以要在接近真实规模的数据上、用 `EXPLAIN` 确认走了哪条路。

**以为 `LIMIT 10` 一定返回 10 行。** 后过滤时它只是"最多 10 行"。代码里应该检查返回行数,不够时有明确的处理(重试、放宽条件、告诉用户),不能默认拿到的就是全部相关结果。

**以为调大 `ef_search` 能解决一切。** 比例 10% 够用,1% 要开到 1000,0.1% 即使开到上限 1000 也只有 1.1 行。比例越低越要用别的办法。

**迭代扫描开了就不管了。** 过滤很严时它能拿满数,但耗时从 2 毫秒涨到 79 毫秒。要量一量你的慢查询有没有超出预算,必要时配合 `hnsw.max_scan_tuples` 设一个上限。

**把过滤用的分类当成可信输入。** 分类是模型猜出来的话,猜错了过滤比不过滤更糟(练习 2)。检索结果为空或分数断崖时,应该回退到不过滤再试一次。

**部分索引的 `WHERE` 和查询的 `WHERE` 不一致。** 索引建的是 `category = '退款'`,查询写的是 `category IN ('退款')` 或者别的等价形式,规划器可能认不出来。写完用 `EXPLAIN` 确认用了那个索引。

**实验里改了设置,结果却没变。** psycopg 自动预编译让第 6 次起的执行用上了缓存的计划。做实验时 `conn.prepare_threshold = None`。

**选型只看"谁更快"。** 官方基准数字换一份数据就不一样。真正决定性的是数据量、过滤方式、要不要联查业务表、有没有人运维。先估算容量(`capacity.py`),再谈产品。

**拿 `UPDATE` 改完大批数据不 `VACUUM`。** 死行留在表和索引里,同一个查询在清理前后返回的行数可能不同(我第一次跑 `filter_pitfall.py` 就遇到了),调 `ANALYZE` 之前也先清一遍。

## 学习资料

### 文档与文章

- [pgvector 官方 README · Filtering](https://github.com/pgvector/pgvector#filtering):今天的核心文档。"With approximate indexes, filtering is applied after the index is scanned." 这一节讲了部分索引、分区、迭代扫描(`hnsw.iterative_scan`、`hnsw.max_scan_tuples`、`hnsw.scan_mem_multiplier`),照着今天的实验对一遍。
- [Qdrant · Indexing(含 payload index)](https://qdrant.tech/documentation/manage-data/indexing/):专门的向量库怎么解决过滤:payload 索引、给 HNSW 加额外的边、查询规划器在几种策略之间选择。和 pgvector 对照着读,体会两种思路。
- [Qdrant · A Complete Guide to Filtering in Vector Search](https://qdrant.tech/articles/vector-search-filtering/):英文,把先过滤、后过滤、过滤感知的 HNSW 各自的利弊讲得很清楚,配图多。
- [Chroma · Clients](https://docs.trychroma.com/docs/run-chroma/clients):看 `PersistentClient`、`HttpClient`、`CloudClient` 三种用法,对应选型表里"原型到生产"的路径。
- [Elastic · Reciprocal rank fusion](https://www.elastic.co/guide/en/elasticsearch/reference/current/rrf.html):选型表里 ES 那行的出处,下周的混合检索会用到同样的东西。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1zi1vByEjg&autoplay=0&high_quality=1" title="Milvus、Qdrant、Weaviate、Pinecone、FAISS、Chroma向量数据库对比" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小天老师的AI大课堂 · Milvus、Qdrant、Weaviate、Pinecone、FAISS、Chroma向量数据库对比 · 约 8 分钟,把今天选型表里的几家一口气过一遍,看的时候留意每家说的"适合规模"。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV12g4X68EtS&autoplay=0&high_quality=1" title="Qdrant向量数据库的概述与HNSW图载荷过滤分析" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>迷迷之音ooo · Qdrant向量数据库的概述与HNSW图载荷过滤分析 · 约 21 分钟,讲 Qdrant 怎么在 HNSW 图里处理载荷(payload)过滤,和今天"后过滤的坑"对着看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/fn9dc2_Da28" title="How Vector Search Really Works: HNSW, Filters & Qdrant | Vectors in Depth" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Ishwar AIML · How Vector Search Really Works: HNSW, Filters & Qdrant · 英文,讲 HNSW 加过滤的各种做法,我只用 oEmbed 确认了标题和作者,没有逐分钟看完。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)里讲检索系统的章节,有对向量数据库和各类检索方式的概述,可以读完今天的选型表再看一遍,把名词对上号。

### 开源项目与代码

- [pgvector/pgvector](https://github.com/pgvector/pgvector):读 README 的 `Filtering`、`Iterative Index Scans` 和 `Half-Precision Vectors` 三节,今天的实验都能在里面找到对应的说明。
- [qdrant/qdrant](https://github.com/qdrant/qdrant):Rust 写的向量数据库,想看过滤感知的 HNSW 怎么实现,可以从文档目录里的 indexing 一节顺着找代码。
- [milvus-io/milvus](https://github.com/milvus-io/milvus):分布式向量数据库,看 README 里的架构图就能理解为什么它的运维比 pgvector 重。

## 自测

**1. 后过滤是什么意思?为什么 HNSW 索引只能后过滤?**

<details><summary>答案</summary>

先按向量从索引里取最近的一批候选(默认 `ef_search = 40` 个),再按 `WHERE` 把不符合的筛掉。HNSW 是只按向量建的图,图上的点不知道自己属于哪个分类,没法"只在某一类的点里走路",所以只能先取、后筛。

</details>

**2. 表里退款类占 10%,`ef_search = 40`,`LIMIT 10`,平均返回几行?占 1% 呢?怎么让占 10% 的情况稳定拿满 10 行?**

<details><summary>答案</summary>

平均约 40 × 10% = 4 行(实测 4.2);占 1% 时 40 × 1% = 0.4 行(实测 0.5)。让 10% 的情况稳定拿满:调大 `ef_search`(实测 200 才 50/50 个问题都拿满,100 只有 31/50),或者开迭代扫描 `relaxed_order`,或者给 `category` 建 B-tree 让规划器先过滤,或者给「退款」建部分索引。

</details>

**3. 为什么刚开始在 `ann_demo` 上跑带 `WHERE` 的查询,10 行拿得满,`EXPLAIN` 里却没有 HNSW?**

<details><summary>答案</summary>

2 万行的表,`WHERE` 又能先砍掉九成,规划器按成本估算认为顺序扫描加排序比走 HNSW 索引划算,选了 `Seq Scan`,结果是精确的。要复现坑,得 `SET enable_seqscan = off` 逼它走索引。这也说明在小库里测不出这个坑,要在接近真实规模的数据上用 `EXPLAIN` 确认走了哪条路。

</details>

**4. 迭代扫描的 `relaxed_order` 和 `strict_order` 有什么区别?迭代扫描有没有代价?**

<details><summary>答案</summary>

`strict_order` 保证结果严格按距离从近到远,`relaxed_order` 允许有轻微乱序,换更高的召回和更快的速度。代价:过滤越严,为了凑够行数要往下翻的索引越多,今天实测错误码(0.1%)平均 79 毫秒,是默认的 30 多倍;并且 `hnsw.max_scan_tuples`(默认 20000)是上限,到了就停,仍可能不够数。

</details>

**5. 面试题:为什么选 pgvector 而不是 Milvus?什么时候你会改主意?**

<details><summary>答案</summary>

按规模和需求说。示范:我们的知识库是几十万块,按每块约 14 KB(表加 HNSW 索引,实测系数)估算几个 GB,单机内存放得下,pgvector 实测延迟满足要求;知识库要和订阅、客户权限表联查,同库有事务和统一权限,运维上也不多一套组件。过滤我们用 B-tree 加迭代扫描解决,热门分类可以上部分索引。改主意的条件是:数据量涨到上亿、或 QPS 超过单机能力、或过滤条件复杂到难以用 SQL 手段兜住,这时评估 Qdrant 或 Milvus;迁移主要成本是重建索引和改查询层。重点是有估算、有实测、有退路,而不是背"谁更快"。

</details>

**6. 为什么在实验里改了 `hnsw.iterative_scan` 却发现结果没变?**

<details><summary>答案</summary>

很可能是 psycopg 的自动预编译:同一条 SQL 执行到第 6 次时,计划被缓存,之后改设置,缓存的计划照旧被用。做实验时设置 `conn.prepare_threshold = None`,或者每次换设置用新连接,并用 `EXPLAIN` 确认计划确实变了。

</details>

## 明天预告

明天是 [Day 235 · BM25:老派但好用的关键词检索](/blog/agent-zero/day-235-bm25/)。向量检索懂意思,但对错误码、型号这种"必须一字不差"的词不灵:我在 `kb_chunks` 上问"导入时报 E2017",向量检索把三块"导入导出"相关的排在前面,真正讲 E2017 的那块排到了第 7 名。明天写一个只数词的 BM25 检索,让 E2017 排回第 1 名。
