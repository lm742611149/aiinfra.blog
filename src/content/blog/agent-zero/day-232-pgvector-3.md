---
title: 'Day 232 · pgvector(三):把 RAG 接到数据库上'
description: '先在 psql 里用 <=>、<->、<#> 三个运算符查最近的块,再在 pg_store.py 里写 search():一条 ORDER BY embedding <=> 查询,返回和 numpy 版一样形状的 (块, 相似度)。实测 10 道题 top-4 编号和 numpy 版完全一致,接回 Day 226 的 RAG 后回答也一致。顺手踩三个坑:查询向量维度不对、categories 传空列表被当成不过滤、SET 语句不能用 %s 要用 sql.Literal。'
pubDate: 2026-10-23
regime: none
tags: ['pgvector', 'postgres', 'rag', 'vector-search', 'agent-zero']
series: 'agent-zero'
day: 232
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 231](/blog/agent-zero/day-231-pgvector-2/) 写好了 `sync_chunks()` 和 `part04/pg_sync.py`:用 sha256 内容指纹判断哪块变了,`INSERT ... ON CONFLICT` 写入,整批包进事务;第一次同步 42 块全算,第二次 0 块,改一个字只算 1 块,插入一个小节借用库里已有的向量。现在 `kb_chunks` 里躺着 42 行带向量的块。

数据进去了,今天让它出来:在 `pg_store.py` 里加 `search()`,用一条 SQL 找出离问题最近的 k 块,再把 Day 226 的 `rag_numpy.py` 里那一步"矩阵乘法加 argsort"换成数据库查询。RAG 查询线的其余部分(拼 prompt、调模型、核对引用)一个字不动,这正是检查"换存储"有没有换对的好办法。

## 今天要解决的问题

学完今天,你应该能做到:

1. 看懂并写出向量检索的 SQL:`ORDER BY embedding <=> 问题向量 LIMIT k`,说出 `<=>`、`<->`、`<#>` 三个运算符各自是什么距离、返回值怎么换算成相似度。
2. 写出 `pg_store.search(conn, query_vec, k, categories)`,返回和 Day 226 的 `rag_numpy.search` 同样形状的 `list[tuple[Chunk, float]]`;用 `sql.SQL` 拼出可选的 `WHERE` 子句,而不是 f-string。
3. 用实测证明数据库版和 numpy 版结果一致:10 道题的 top-4 编号 10/10 相同,分数差在千分之几以内;接回 RAG 后拒答测试仍是 10/10。
4. 避开三个坑:查询向量维度不对的报错、`categories=[]` 被当成"不过滤"(权限场景下是事故)、`SET hnsw.ef_search = %s` 的语法错误和 `sql.Literal` 的正解。

预计用时 2.5 小时:SQL 运算符 35 分钟,写 `search()` 和三个坑 50 分钟,对比 numpy 和接回 RAG 40 分钟,剩下做练习。前置:[Day 231](/blog/agent-zero/day-231-pgvector-2/) 同步好的 `kb_chunks`(42 行)和 `pg_store.py`,[Day 226](/blog/agent-zero/day-226-retrieve-answer/) 的 `part04/rag_numpy.py`(`build_messages`、`check_citations`、`client`),[Day 227](/blog/agent-zero/day-227-rag-prompt/) 的六句 `SYSTEM` 和 `part04/refusal_test.py`,[Day 225](/blog/agent-zero/day-225-numpy-index/) 的 `index/`,[Day 215](/blog/agent-zero/day-215-cosine/) 的余弦距离,[Day 87](/blog/agent-zero/day-087-sql-3/) 的 JOIN。

今天要调 embedding 接口(bge-m3 免费)和 DeepSeek 对话接口。实跑花费:对话部分 rag_pg 两次(0.0037 + 0.0027)加练习 3 的 10 道题(0.0065),合计约 0.013 元;embedding 免费。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `search()` 里那条 SQL 和 `where` 的拼法;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 第一步:先在 psql 里查一次

不用写 Python,先在 psql 里感受 pgvector 怎么查。问题向量要从 embedding 接口来,psql 里调不了,所以今天先用一个变通:拿库里已有的一行当"问题",问"哪几块和 `kb-003#1`(如何申请退款 > 操作步骤)最像"。

```bash
psql -d agentzero
```

```sql
SELECT k.id, k.section,
       k.embedding <=> q.e AS cos_dist,
       k.embedding <-> q.e AS l2,
       k.embedding <#> q.e AS neg_ip
FROM kb_chunks k, (SELECT embedding AS e FROM kb_chunks WHERE id = 'kb-003#1') q
ORDER BY k.embedding <=> q.e
LIMIT 4;
```

<div class="line-notes">

- `SELECT k.id, k.section,` 要看的列。`k.` 是下面给 `kb_chunks` 起的别名,`k.id` 就是 `kb_chunks.id`。
- `k.embedding <=> q.e AS cos_dist,` `<=>` 是**余弦距离**:1 减去余弦相似度,越小越像,0 表示方向完全一致([Day 215](/blog/agent-zero/day-215-cosine/) 见过,Day 229 练习 3 预览过)。`q.e` 是下面那个子查询里的问题向量。
- `k.embedding <-> q.e AS l2,` `<->` 是 **L2 距离**(欧氏距离),就是两个点之间的直线距离。
- `k.embedding <#> q.e AS neg_ip` `<#>` 是**负的内积**。名字里的负号是故意的:Postgres 的 `ORDER BY` 默认从小到大排,内积越大越像,取负以后"越小越像"三个运算符才统一。
- `FROM kb_chunks k, (SELECT embedding AS e FROM kb_chunks WHERE id = 'kb-003#1') q` 逗号连接两张"表":左边是 `kb_chunks` 的每一行,右边是一个只有 1 行的子查询 `q`(它的唯一一行是 kb-003#1 的向量)。一对多的连接下,每一行 `k` 都和这唯一的一行 `q` 配成对,相当于给每一行带上了"问题向量"。[Day 87](/blog/agent-zero/day-087-sql-3/) 学过 JOIN,这是它的逗号写法。
- `ORDER BY k.embedding <=> q.e` 按余弦距离从小到大排序。
- `LIMIT 4;` 只取最近的 4 行。

</div>

```text
    id    |  section   |      cos_dist       |         l2         |       neg_ip
----------+------------+---------------------+--------------------+---------------------
 kb-003#1 | 操作步骤   |                   0 |                  0 | -0.9999986290931702
 kb-002#4 | 审批与到账 | 0.18329080489573768 | 0.6054609236672861 | -0.8167086839675903
 kb-017#1 | 注销流程   | 0.21167373831119973 | 0.6506519193696174 | -0.7883261442184448
 kb-002#3 | 重复扣款   |  0.2177766251556179 | 0.6599651037368611 | -0.7822231650352478
(4 rows)
```

第一行是它自己,距离 0。其余三行和 Day 218 画过的相似度矩阵里"退款相关的块互相靠近"的感觉一致,不过其中混进了一个 `kb-017#1`(注销流程),这是 embedding 的真实水平,不是 bug。

三列数字之间有固定关系,可以拿第二行验算。向量长度都是 1(Day 217 的 `embed()` 归一化过)的话,余弦距离 d = 1 − cos,L2 距离的平方是 2 − 2cos = 2d,内积就是 cos。代入第二行:2 × 0.18329 = 0.36658,开方得 0.6055,和 `l2` 列的 0.60546 吻合;`neg_ip` = −(1 − 0.18329) = −0.81671,也吻合。所以对**长度都是 1 的向量**,三个运算符排出来的名次永远一样,只是数字的刻度不同。把另外两个运算符各排一次验证:

```sql
SELECT id FROM kb_chunks, (SELECT embedding AS e FROM kb_chunks WHERE id = 'kb-003#1') q ORDER BY embedding <-> q.e LIMIT 4;
SELECT id FROM kb_chunks, (SELECT embedding AS e FROM kb_chunks WHERE id = 'kb-003#1') q ORDER BY embedding <#> q.e LIMIT 4;
```

两条都返回同样的四个编号 `kb-003#1`、`kb-002#4`、`kb-017#1`、`kb-002#3`,顺序也一样。我们课程从头到尾用余弦距离,因为它不要求向量长度为 1 也成立,最保险。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="向量检索 SQL 的结构:SELECT 里带出距离,FROM 指定表,ORDER BY 距离运算符排序,LIMIT 取前 k 个,右侧标注每一部分对应 numpy 版的哪一步">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="20" width="330" height="40" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="32" y="45" fill="var(--ink)">SELECT ..., embedding &lt;=&gt; q AS distance</text>
<rect x="20" y="76" width="330" height="40" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="32" y="101" fill="var(--ink)">FROM kb_chunks  [WHERE category = ANY(..)]</text>
<rect x="20" y="132" width="330" height="40" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="32" y="157" fill="var(--ink)">ORDER BY embedding &lt;=&gt; q</text>
<rect x="20" y="188" width="330" height="40" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="32" y="213" fill="var(--ink)">LIMIT k</text>
<text x="390" y="45" fill="var(--ink-soft)">每行算一个距离</text>
<text x="390" y="62" fill="var(--ink-faint)" font-size="11">≈ scores = VECTORS @ q</text>
<text x="390" y="101" fill="var(--ink-soft)">先按分类过滤(可选)</text>
<text x="390" y="157" fill="var(--ink-soft)">按距离从小到大排</text>
<text x="390" y="174" fill="var(--ink-faint)" font-size="11">≈ np.argsort(-scores)</text>
<text x="390" y="213" fill="var(--ink-soft)">只留前 k 行</text>
<text x="390" y="230" fill="var(--ink-faint)" font-size="11">≈ [:k]</text>
</g>
</svg>
<figcaption>一条向量检索 SQL 的四个部分,右边是它在 Day 226 的 numpy 版里对应的那一步。琥珀色两行是真正让它变成"最近邻查询"的部分:ORDER BY 里的距离运算符决定谁近,LIMIT 决定留几个。</figcaption>
</figure>

### 一个顺序陷阱:别按"相似度"升序排

库里存的是距离,我们想看相似度,最直觉的写法是把相似度算出来再排序。试一次:

```sql
SELECT k.id, 1 - (k.embedding <=> q.e) AS score
FROM kb_chunks k, (SELECT embedding AS e FROM kb_chunks WHERE id = 'kb-003#1') q
ORDER BY score LIMIT 3;
```

```text
    id    |        score
----------+---------------------
 kb-011#1 | 0.39194799441792516
 kb-018#1 | 0.40564804228665396
 kb-014#1 |  0.4395945164158518
(3 rows)
```

返回的是**最不像**的三块。`ORDER BY score` 默认升序,分数小的在前面,正好反了。加上 `DESC` 就对了(`ORDER BY score DESC`,第一行 1、第二行 0.8167),但更要紧的是后天讲 HNSW 索引时会看到:**要让索引起作用,`ORDER BY` 后面必须直接写距离运算符**(`embedding <=> q`),写成 `1 - (...)` 这样的表达式,索引就用不上了。所以 `search()` 里排序用距离、`SELECT` 里再换算成相似度,这是有原因的。

## 第二步:写 pg_store.search()

回到 Python。目标是让 `search()` 和 Day 226 的 `rag_numpy.search()` 长得一样:收一个问题向量和 `k`,返回 `[(Chunk, 相似度), ...]`。这样 `build_messages()`、`check_citations()` 这些后面的函数一个字不用改。打开 `part04/pg_store.py`,在 `sync_chunks` 的后面、`if __name__ == "__main__":` 的前面,加上:

```python
# agent-zero-lab/part04/pg_store.py(新增,放在 sync_chunks 后面)
def search(
    conn: psycopg.Connection,
    query_vec: np.ndarray,
    k: int = 4,
    categories: list[str] | None = None,
) -> list[tuple[Chunk, float]]:
    """按余弦距离取最近的 k 块,返回 (块, 相似度),和 rag_numpy.search 的返回形状一样。"""
    where = sql.SQL("WHERE category = ANY(%(cats)s)") if categories else sql.SQL("")
    query = sql.SQL("""
        SELECT id, doc_id, title, category, section, content, embedding <=> %(q)s AS distance
        FROM kb_chunks
        {where}
        ORDER BY embedding <=> %(q)s
        LIMIT %(k)s
    """).format(where=where)
    rows = conn.execute(query, {"q": query_vec, "k": k, "cats": categories}).fetchall()
    return [
        (Chunk(id=r[0], doc_id=r[1], title=r[2], category=r[3], section=r[4], text=r[5]), 1 - r[6])
        for r in rows
    ]
```

<div class="line-notes">

- `def search(` 四个参数各占一行。
- `query_vec: np.ndarray,` 问题向量,形状 `(1024,)`,就是 `embed_one(question)` 返回的东西。
- `categories: list[str] | None = None,` 可选的分类列表。`None` 表示不过滤。
- `) -> list[tuple[Chunk, float]]:` 和 Day 226 的 `search` 一样,返回"块加分数"的二元组列表。
- `where = sql.SQL("WHERE category = ANY(%(cats)s)") if categories else sql.SQL("")` 条件表达式:有分类就用 `WHERE category = ANY(...)`(`= ANY(数组)` 是 Day 231 删除时用过的"等于数组中任意一个"),没有就是空字符串。关键是两边都是 `sql.SQL(...)` 对象,不是普通字符串。
- `query = sql.SQL("""` 整条查询。
- `SELECT id, doc_id, title, category, section, content, embedding <=> %(q)s AS distance` 取出 `Chunk` 需要的六列(`content` 对应 `Chunk.text`)加一个距离。`%(q)s` 是**带名字的参数**,值在后面的字典里按名字找,问题向量因此只需要传一次,SQL 里出现两次。
- `{where}` 这是 `sql.SQL` 的占位符,下面 `.format(where=where)` 会把它换成刚才的 `WHERE` 子句或空串。
- `ORDER BY embedding <=> %(q)s` 按距离升序,最近的排最前,不需要 `DESC`。
- `LIMIT %(k)s` 取前 k 行。`LIMIT` 的值也可以用参数传。
- `""").format(where=where)` 把 `{where}` 换成真正的片段。因为 `where` 是 `sql.SQL` 对象,这是类型检查器认可的拼法;如果写成 `"...{where}...".format(where="WHERE ...")` 或者 f-string,basedpyright 会报 `LiteralString` 的错(Day 229 见过)。
- `rows = conn.execute(query, {"q": query_vec, "k": k, "cats": categories}).fetchall()` 参数字典里放了三项。没有分类过滤时 SQL 里没有 `%(cats)s`,字典里多出来的键 psycopg 会忽略。代入第一次实测:`k=4`,返回 4 行,每行 7 个值。
- `return [` 开始构造返回值。
- `(Chunk(id=r[0], doc_id=r[1], title=r[2], category=r[3], section=r[4], text=r[5]), 1 - r[6])` 每一行变成一个二元组:前面把前六列装成 `Chunk`(`r[5]` 是 `content`,放进 `text` 字段),后面 `1 - r[6]` 把距离换成相似度。代入实测第一行:`(Chunk(id='kb-003#1', ..., section='操作步骤', ...), 0.652)`。
- `for r in rows` 对每一行做这件事。

</div>

写一个小脚本跑一下,同样的问题不过滤、再只搜「退款」类。新建 `part04/pg_search_first.py`:

```python
# agent-zero-lab/part04/pg_search_first.py
from common.embed import embed_one
from part04.pg_store import connect, search

question = "买错了能退钱吗"
with connect() as conn:
    print("不过滤:")
    for c, s in search(conn, embed_one(question), k=4):
        print(f"  {s:.3f}  {c.id:<9} [{c.category}] {c.title} > {c.section}")
    print("只搜「退款」类:")
    for c, s in search(conn, embed_one(question), k=4, categories=["退款"]):
        print(f"  {s:.3f}  {c.id:<9} [{c.category}] {c.title} > {c.section}")
```

<div class="line-notes">

- `from common.embed import embed_one` Day 217 的单条文本编码,返回形状 `(1024,)` 的 float32 数组。
- `question = "买错了能退钱吗"` 和 Day 226 用过的同一类问题。
- `with connect() as conn:` 连上库,`connect()` 里已经注册过 `register_vector`,numpy 数组能直接当参数传。
- `for c, s in search(conn, embed_one(question), k=4):` 二元组直接拆成块 `c` 和分数 `s`。
- `print(f"  {s:.3f}  {c.id:<9} [{c.category}] {c.title} > {c.section}")` `:.3f` 保留三位小数,`:<9` 左对齐占 9 格,让编号列对齐。
- `for c, s in search(conn, embed_one(question), k=4, categories=["退款"]):` 第二次加上分类过滤。

</div>

```bash
uv run python -m part04.pg_search_first
```

```text
不过滤:
  0.652  kb-003#1  [退款] 如何申请退款 > 操作步骤
  0.648  kb-002#3  [退款] 退款政策 > 重复扣款
  0.643  kb-002#1  [退款] 退款政策 > 年付套餐
  0.638  kb-008#2  [套餐与计费] 优惠码使用规则 > 退款时怎么算
只搜「退款」类:
  0.651  kb-003#1  [退款] 如何申请退款 > 操作步骤
  0.648  kb-002#3  [退款] 退款政策 > 重复扣款
  0.643  kb-002#1  [退款] 退款政策 > 年付套餐
  0.625  kb-002#4  [退款] 退款政策 > 审批与到账
```

前三名相同,第四名在不过滤时是分类为「套餐与计费」的优惠码那一块,过滤以后换成了退款分类里的 `kb-002#4`。注意两次的 `kb-003#1` 分数是 0.652 和 0.651:两次都重新调了一次 embedding 接口,同一句话的向量有万分之几的浮动(Day 231 练习 1 量过),所以第三位小数偶尔会抖。

### 坑一:查询向量维度不对

故意传一个 3 维的向量:

```bash
uv run python -c "
import numpy as np
from part04.pg_store import connect, search
with connect() as conn:
    search(conn, np.zeros(3, dtype=np.float32))
" 2>&1 | tail -1
```

```text
psycopg.errors.DataException: different vector dimensions 1024 and 3
```

和写入时的 `expected 1024 dimensions, not 3` 是同一道保险:查询向量的维度必须和列一致,否则数据库直接拒绝。如果你用 `numpy` 方案,查询向量和索引向量维度不一致时报的是一个看不懂的形状错误(Day 217 说过),pgvector 里报得很直白。

### 坑二:categories=[] 被当成"不过滤"

`search()` 里 `if categories` 这个判断,对 `None` 和空列表 `[]` 都是"假"。看看传 `[]` 会怎样,新建 `part04/pg_empty.py`:

```python
# agent-zero-lab/part04/pg_empty.py
from common.embed import embed_one
from part04.pg_store import connect, search

v = embed_one("买错了能退钱吗")
with connect() as conn:
    for cats in (None, ["退款"], ["不存在"], []):
        print(f"categories={cats!r:<12}", [c.id for c, _ in search(conn, v, 4, cats)])
```

<div class="line-notes">

- `v = embed_one("买错了能退钱吗")` 算一次问题向量,四次查询共用,排除接口浮动的干扰。
- `for cats in (None, ["退款"], ["不存在"], []):` 四种传法:不过滤、按存在的分类、按不存在的分类、传空列表。
- `print(f"categories={cats!r:<12}", [c.id for c, _ in search(conn, v, 4, cats)])` `!r` 用 `repr` 打印,这样 `None` 和 `[]` 能看出区别;`:<12` 左对齐 12 格。后面是返回的 4 个编号,不要分数用 `_` 丢掉。

</div>

```bash
uv run python -m part04.pg_empty
```

```text
categories=None         ['kb-003#1', 'kb-002#3', 'kb-002#1', 'kb-008#2']
categories=['退款']       ['kb-003#1', 'kb-002#3', 'kb-002#1', 'kb-002#4']
categories=['不存在']      []
categories=[]           ['kb-003#1', 'kb-002#3', 'kb-002#1', 'kb-008#2']
```

传一个不存在的分类得到空列表,这是对的;传 `[]` 却和不过滤一模一样,返回了全库的结果。在今天这个小例子里无伤大雅,但想想这个参数以后的用途:Day 234 会讲按用户权限过滤,`categories` 会是"这个用户有权看的分类"。一个什么权限都没有的用户,列表是 `[]`,理应什么都查不到,结果却能查到所有文章,这就是权限泄漏。

修法是把判断从"真假"改成"是不是 `None`":

```python
# agent-zero-lab/part04/pg_store.py(search 里改一行)
    where = sql.SQL("WHERE category = ANY(%(cats)s)") if categories is not None else sql.SQL("")
```

<div class="line-notes">

- `where = sql.SQL("WHERE category = ANY(%(cats)s)") if categories is not None else sql.SQL("")` 只有明确传了 `None` 才不过滤。传 `[]` 时 `ANY('{}')` 匹配不到任何行,结果是空。

</div>

再跑一次 `pg_empty.py`,最后一行变成:

```text
categories=[]           []
```

Python 里"空"的判断是个老坑:`if x:` 把 `None`、`[]`、`""`、`0` 都当假([Day 14](/blog/agent-zero/day-014-bool-none/) 附近讲过真值)。当"没传"和"传了但是空"含义不同时,一定要用 `is None` 明确区分。

## 第三步:和 numpy 版对账

数据库版的结果到底对不对?最稳妥的办法是用同一个问题向量,同时跑 numpy 版和数据库版,逐题对比。新建 `part04/pg_vs_numpy.py`,问题用 Day 227 拒答测试的那 10 道:

```python
# agent-zero-lab/part04/pg_vs_numpy.py
import numpy as np

from common.embed import embed_one
from part04.build_index import load_index
from part04.pg_store import connect, search

QUESTIONS = [
    "年付专业版用到第 3 个月想退,能退多少",
    "导入流水提示 E1042 怎么办",
    "专业版最多几个人",
    "月付的专业版能开增值税专用发票吗",
    "免费版能用开放 API 吗",
    "你们支持微信支付吗",
    "有没有手机 App 可以记账",
    "账本能直接导到金蝶里吗",
    "企业版专属客服的电话是多少",
    "发票可以邮寄纸质版吗",
]
chunks, vectors = load_index()
same = 0
worst = 0.0
with connect() as conn:
    for q in QUESTIONS:
        v = embed_one(q)
        scores = vectors @ v
        top = np.argsort(-scores)[:4]
        np_ids = [chunks[i].id for i in top]
        pg = search(conn, v, k=4)
        pg_ids = [c.id for c, _ in pg]
        diff = max(abs(float(scores[i]) - s) for i, (_, s) in zip(top, pg))
        worst = max(worst, diff)
        same += np_ids == pg_ids
        print(f"{'一致' if np_ids == pg_ids else '不同'}  {q:<18} {pg_ids}  分数最大差 {diff:.6f}")
print(f"top-4 编号完全一致:{same}/{len(QUESTIONS)};分数差最大 {worst:.6f}")
```

<div class="line-notes">

- `QUESTIONS = [` 10 道题,前 5 道帮助中心里有答案,后 5 道没有。和 Day 227 的 `CASES` 同一批,这里只要问题文字。
- `chunks, vectors = load_index()` Day 225 的 `index/`:42 块和 `(42, 1024)` 的向量矩阵,是 numpy 版的数据来源。
- `same = 0` 计数:top-4 编号完全一致的题数。
- `worst = 0.0` 记录所有题里分数差的最大值。
- `v = embed_one(q)` **只算一次**问题向量,numpy 和数据库两边共用,保证比较的是"检索"本身,不掺入接口浮动。
- `scores = vectors @ v` numpy 版:42 个分数,Day 226 的矩阵乘法。
- `top = np.argsort(-scores)[:4]` 分数从大到小的前 4 个下标。
- `np_ids = [chunks[i].id for i in top]` 换成块编号。
- `pg = search(conn, v, k=4)` 数据库版,返回 4 个 `(Chunk, 分数)`。
- `pg_ids = [c.id for c, _ in pg]` 取出编号。
- `diff = max(abs(float(scores[i]) - s) for i, (_, s) in zip(top, pg))` 把两边同名次的分数配对,求差的绝对值,取 4 个里最大的。`zip(top, pg)` 同时遍历下标和数据库结果,`(_, s)` 把二元组里不要的块丢掉。
- `same += np_ids == pg_ids` 两个列表相等就加 1(布尔值当整数用)。注意比较的是列表,**顺序也要一样**。
- `print(f"{'一致' if np_ids == pg_ids else '不同'}  {q:<18} {pg_ids}  分数最大差 {diff:.6f}")` 每题一行。
- `print(f"top-4 编号完全一致:{same}/{len(QUESTIONS)};分数差最大 {worst:.6f}")` 汇总。

</div>

```bash
uv run python -m part04.pg_vs_numpy
```

```text
一致  年付专业版用到第 3 个月想退,能退多少 ['kb-002#1', 'kb-002#2', 'kb-018#2', 'kb-003#1']  分数最大差 0.000293
一致  导入流水提示 E1042 怎么办   ['kb-010#2', 'kb-010#1', 'kb-011#2', 'kb-012#2']  分数最大差 0.000279
一致  专业版最多几个人           ['kb-015#2', 'kb-001#2', 'kb-014#2', 'kb-020#1']  分数最大差 0.000245
一致  月付的专业版能开增值税专用发票吗   ['kb-006#1', 'kb-003#2', 'kb-001#2', 'kb-002#1']  分数最大差 0.000580
一致  免费版能用开放 API 吗      ['kb-019#1', 'kb-019#2', 'kb-001#2', 'kb-014#2']  分数最大差 0.000815
一致  你们支持微信支付吗          ['kb-016#1', 'kb-002#4', 'kb-020#1', 'kb-013#2']  分数最大差 0.000243
一致  有没有手机 App 可以记账     ['kb-001#2', 'kb-020#1', 'kb-020#2', 'kb-001#1']  分数最大差 0.001355
一致  账本能直接导到金蝶里吗        ['kb-005#2', 'kb-001#2', 'kb-009#1', 'kb-001#1']  分数最大差 0.000931
一致  企业版专属客服的电话是多少      ['kb-001#2', 'kb-018#2', 'kb-015#2', 'kb-014#2']  分数最大差 0.000485
一致  发票可以邮寄纸质版吗         ['kb-006#1', 'kb-006#2', 'kb-003#2', 'kb-012#2']  分数最大差 0.000525
top-4 编号完全一致:10/10;分数差最大 0.001355

10 道题 top-4 的编号和**顺序**完全一致。分数差最大的一题 0.001355,在第三位小数。这点差异不是 SQL 和矩阵乘法算法不同造成的,两边的向量根本不是同一批:`index/vectors.npy` 是 Day 225 建的,`kb_chunks` 里的向量是今天之前跑 `pg_sync` 时重新调接口算出来的,同一段文字两次请求的向量本来就有万分之几的浮动。真正要看的是**名次**,而 top-4 名次 10/10 一样。

两者底层的计算也不同:numpy 版是把 42 个向量全算一遍(暴力检索),数据库版现在也是,因为表只有 42 行,Postgres 的规划器根本不会去用 HNSW 索引(练习 4 会看 `EXPLAIN` 的结果,Day 233 解释原因)。所以今天的"一致"是两个精确算法的一致,等加上近似索引以后还能不能一致,是明天的问题。

### 数据库版更快吗?

不会。新建 `part04/pg_speed.py` 量一下:

```python
# agent-zero-lab/part04/pg_speed.py
import time

import numpy as np

from common.embed import embed_one
from part04.build_index import load_index
from part04.pg_store import connect, search

chunks, vectors = load_index()
v = embed_one("买错了能退钱吗")
N = 300

t0 = time.perf_counter()
for _ in range(N):
    top = np.argsort(-(vectors @ v))[:4]
numpy_ms = (time.perf_counter() - t0) / N * 1000

with connect() as conn:
    t0 = time.perf_counter()
    for _ in range(N):
        hits = search(conn, v, 4)
    pg_ms = (time.perf_counter() - t0) / N * 1000

print(f"numpy 暴力检索 {numpy_ms:.3f} 毫秒/次,pgvector {pg_ms:.3f} 毫秒/次(各跑 {N} 次取平均)")
```

<div class="line-notes">

- `N = 300` 每种方式各跑 300 次取平均,单次太快,测不准。
- `t0 = time.perf_counter()` 高精度计时器,返回秒数,`perf_counter` 专门用来量一小段代码的耗时,相当于 JS 的 `performance.now()`。
- `top = np.argsort(-(vectors @ v))[:4]` numpy 版检索的全部工作:一次 `(42, 1024) @ (1024,)` 矩阵乘法,取反后排序,取前 4 个。
- `numpy_ms = (time.perf_counter() - t0) / N * 1000` 总耗时除以次数得到每次的秒数,乘 1000 换成毫秒。
- `hits = search(conn, v, 4)` 数据库版:包含把参数发给数据库、数据库算、结果传回来、拼 `Chunk` 对象的全部时间。
- `print(f"numpy 暴力检索 {numpy_ms:.3f} 毫秒/次,pgvector {pg_ms:.3f} 毫秒/次(各跑 {N} 次取平均)")` 输出两个数。

</div>

```bash
uv run python -m part04.pg_speed
```

```text
numpy 暴力检索 0.035 毫秒/次,pgvector 1.383 毫秒/次(各跑 300 次取平均)
```

numpy 约 0.035 毫秒,数据库约 1.4 毫秒,慢了几十倍。(这台机器上同时还有别的程序在跑,我连测两次是 0.031/1.214 和 0.035/1.383,数字会随负载抖,量级不会变。)原因很好懂:42 个向量在内存里乘一下几乎不花时间,而数据库版要走一趟本机网络、发请求、解析 SQL、把结果装成 Python 对象。

所以别把"换成数据库"当成性能优化。42 块的时候数据库纯粹是多花时间。它的价值在 Day 229 说过的那些:一份数据多个进程共用、按行更新、事务、按分类过滤、规模变大以后有索引兜底。1 毫秒对一次要等大模型几秒的问答来说,没有任何影响。

## 第四步:接回 RAG

现在把 Day 226 的查询线接上。检索换成 `search()`,拼 prompt、调模型、核对引用全部复用 `rag_numpy.py` 里已有的函数。新建 `part04/rag_pg.py`:

```python
# agent-zero-lab/part04/rag_pg.py
"""Day 226 的 RAG,检索换成 pgvector,支持按分类过滤。"""
import sys

from common.embed import embed_one
from part04 import rag_numpy
from part04.pg_store import connect, search

conn = connect()


def answer(question: str, k: int = 4, categories: list[str] | None = None) -> str:
    hits = search(conn, embed_one(question), k, categories)
    for c, s in hits:
        print(f"  {s:.3f}  {c.id:<9} [{c.category}] {c.title} > {c.section}")
    chunks = [c for c, _ in hits]
    r = rag_numpy.client.chat(rag_numpy.build_messages(question, chunks), temperature=0)
    cited, unknown = rag_numpy.check_citations(r.content, chunks)
    print(f"  引用了 {cited},不在资料里的 {unknown}")
    return r.content


if __name__ == "__main__":
    q = " ".join(sys.argv[1:]) or "买错了能退钱吗"
    print(f"问:{q}\n不过滤:")
    print("答:" + answer(q))
    print("\n只搜「退款」类:")
    print("答:" + answer(q, categories=["退款"]))
    print("---", rag_numpy.client.ledger)
```

<div class="line-notes">

- `from part04 import rag_numpy` 拿到 Day 226/227 那个模块,后面用它的 `client`、`build_messages`、`check_citations`。`SYSTEM` 也在里面,是 Day 227 的六句版,`build_messages` 每次调用时才读它,所以自动用的是六句版。副作用见代码块下面。
- `from part04.pg_store import connect, search` 今天写的 `search`。
- `conn = connect()` 写在模块顶层:整个进程只连一次数据库,`answer()` 调几次都用同一条连接。
- `def answer(question: str, k: int = 4, categories: list[str] | None = None) -> str:` 和 Day 226 的 `answer` 参数相比,多了一个可选的 `categories`。
- `hits = search(conn, embed_one(question), k, categories)` 整个文件里唯一和 Day 226 不同的一行:检索从 `rag_numpy.search(question, k)` 换成了数据库。
- `for c, s in hits:` 打印每块的分数、编号、分类、标题和小节。
- `chunks = [c for c, _ in hits]` 丢掉分数只留块,`build_messages` 只要块。
- `r = rag_numpy.client.chat(rag_numpy.build_messages(question, chunks), temperature=0)` 拼 prompt、调 DeepSeek。`temperature=0` 让回答尽量稳定,方便对比过滤前后。
- `cited, unknown = rag_numpy.check_citations(r.content, chunks)` Day 226 的引用对账:回答里引用了哪些编号,有没有不在这次给的资料里的。
- `print(f"  引用了 {cited},不在资料里的 {unknown}")` 实测两次都是 `unknown = []`,没有编造的出处。
- `q = " ".join(sys.argv[1:]) or "买错了能退钱吗"` 命令行参数拼成问题,不给就用默认问题。
- `print("答:" + answer(q))` 不过滤。
- `print("答:" + answer(q, categories=["退款"]))` 只搜「退款」分类。
- `print("---", rag_numpy.client.ledger)` 两次调用的总花费。

</div>

```bash
uv run python -m part04.rag_pg
```

```text
问:买错了能退钱吗
不过滤:
  0.651  kb-003#1  [退款] 如何申请退款 > 操作步骤
  0.648  kb-002#3  [退款] 退款政策 > 重复扣款
  0.643  kb-002#1  [退款] 退款政策 > 年付套餐
  0.637  kb-008#2  [套餐与计费] 优惠码使用规则 > 退款时怎么算
  引用了 ['kb-003#1', 'kb-002#1', 'kb-002#3', 'kb-008#2'],不在资料里的 []
答:可以申请退款,但具体能退多少要看你的套餐类型和支付情况。

**操作步骤**:进入「设置 → 订阅 → 申请退款」,选择退款原因并提交,客服主管会在 1 个工作日内审批 [kb-003#1]。
……(后面列出年付、重复扣款、优惠码三种情况,每条带出处)

只搜「退款」类:
  0.651  kb-003#1  [退款] 如何申请退款 > 操作步骤
  0.648  kb-002#3  [退款] 退款政策 > 重复扣款
  0.643  kb-002#1  [退款] 退款政策 > 年付套餐
  0.625  kb-002#4  [退款] 退款政策 > 审批与到账
  引用了 ['kb-002#3', 'kb-002#1', 'kb-003#1', 'kb-002#4'],不在资料里的 []
答:帮助中心里没有找到"买错"这类退款原因的说明,建议转人工客服。

如果属于以下已说明的情形,可以按对应规则处理:
……(后面列出重复扣款、年付取消两种情形,并给出申请方式)
--- 2 次调用 | 输入 879 / 输出 368 tokens | 约 ¥0.0037
```

(完整回答比较长,我用省略号截短了,检索那几行和引用对账是原样。)用上一步的办法对账过,检索和 numpy 版是一致的,引用也都对得上。过滤以后第四块换成了退款分类里的 `kb-002#4`,回答也从"列出优惠码的情形"变成了"先说没找到'买错'这个原因,再列出两种能退的情形"。同一个问题,过滤让回答更窄、更贴题。

注意 `from part04 import rag_numpy` 有个副作用:`rag_numpy.py` 开头有一句 `CHUNKS, VECTORS = load_index()`,所以 `import` 它就会去读 `index/`。数据库版的 `rag_pg.py` 明明已经不需要 `index/` 了,却还依赖它,如果你把 `index/` 目录删了,`rag_pg.py` 一启动就报 `FileNotFoundError`。这是 Day 226 的文件把"查询线的通用部分"和"numpy 检索"放在了一起的代价。更干净的做法是把 `SYSTEM`、`build_messages`、`check_citations` 拆到单独的文件里,后面哪一天需要时再做,今天先忍着。

### 没有退步吗?拒答测试再跑一遍

换了检索,Day 227 的拒答测试还能 10/10 吗?练习 3 就是做这件事。

## 第五步:不能用 %s 的地方

最后一个今天会遇到的坑,明天要用:有些 SQL 语句不接受参数占位符。Day 233 要在查询前设置 HNSW 的 `ef_search`,写法是 `SET hnsw.ef_search = 100`。很自然地会想写成 `SET hnsw.ef_search = %s` 再传 100。试一下,新建 `part04/pg_set_param.py`:

```python
# agent-zero-lab/part04/pg_set_param.py
from psycopg import sql

from part04.pg_store import connect

with connect() as conn:
    try:
        conn.execute("SET hnsw.ef_search = %s", (100,))
    except Exception as e:
        print("用 %s:", type(e).__name__, e)
    conn.execute(sql.SQL("SET hnsw.ef_search = {}").format(sql.Literal(100)))
    print("用 sql.Literal:", conn.execute("SHOW hnsw.ef_search").fetchone())
```

<div class="line-notes">

- `conn.execute("SET hnsw.ef_search = %s", (100,))` 想把 100 作为参数传。
- `except Exception as e:` 这里直接捕获所有异常,只是为了把错误打印出来看。
- `print("用 %s:", type(e).__name__, e)` 实测 `SyntaxError syntax error at or near "$1"`,后面跟出错位置。
- `conn.execute(sql.SQL("SET hnsw.ef_search = {}").format(sql.Literal(100)))` 用 Day 229 的办法:`sql.Literal(100)` 在 Python 这边把整数变成 SQL 字面量 `100`,拼进语句里再整句发给数据库。
- `print("用 sql.Literal:", conn.execute("SHOW hnsw.ef_search").fetchone())` `SHOW` 查看当前设置,实测 `('100',)`。

</div>

```bash
uv run python -m part04.pg_set_param
```

```text
用 %s: SyntaxError syntax error at or near "$1"
LINE 1: SET hnsw.ef_search = $1
                             ^
用 sql.Literal: ('100',)
```

`%s` 在 psycopg 里的实现是把值留给数据库,语句里变成 `$1`。`SELECT`、`INSERT` 这类语句数据库支持把值和语句分开;`SET`、`CREATE TABLE` 这类配置和建表语句不支持,看到 `$1` 就报语法错误。Day 229 的 `vector(1024)` 是建表语句,今天的 `SET` 是配置语句,都只能把值在 Python 这边拼进去,这就是 `sql.Literal` 的用武之地。

## 小结

今天只多了一个函数 `search()`,但它换掉的是 RAG 查询线里最核心的一步:

<figure>
<svg viewBox="0 0 640 240" role="img" aria-label="RAG 查询线对比:上排是 Day 226 的 numpy 版,问题经过 embed_one 后用矩阵乘法在内存里找 top-k;下排是今天的数据库版,同一个问题向量发给 Postgres,用 ORDER BY 距离 LIMIT k 查到同样形状的结果;两排的后半段拼 prompt、调模型、核对引用完全相同">
<rect x="0" y="0" width="640" height="240" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="22" fill="var(--ink-soft)">Day 226  numpy 版</text>
<rect x="20" y="32" width="100" height="36" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="32" y="55" fill="var(--ink)">embed_one</text>
<rect x="150" y="32" width="180" height="36" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="162" y="55" fill="var(--ink)">VECTORS @ q → top-k</text>
<rect x="360" y="32" width="260" height="36" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="372" y="55" fill="var(--ink)">build_messages → chat → 对账</text>
<line x1="120" y1="50" x2="150" y2="50" stroke="var(--ink-faint)"/>
<line x1="330" y1="50" x2="360" y2="50" stroke="var(--ink-faint)"/>
<text x="20" y="112" fill="var(--ink-soft)">今天  数据库版</text>
<rect x="20" y="122" width="100" height="36" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="32" y="145" fill="var(--ink)">embed_one</text>
<rect x="150" y="122" width="180" height="36" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="162" y="145" fill="var(--ink)">SQL ORDER BY &lt;=&gt; LIMIT</text>
<rect x="360" y="122" width="260" height="36" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="372" y="145" fill="var(--ink)">build_messages → chat → 对账</text>
<line x1="120" y1="140" x2="150" y2="140" stroke="var(--ink-faint)"/>
<line x1="330" y1="140" x2="360" y2="140" stroke="var(--ink-faint)"/>
<text x="20" y="200" fill="var(--ink-soft)" font-size="11">换掉的只有中间一格;两边都返回 list[(Chunk, 相似度)],后面一格不用改。</text>
<text x="20" y="220" fill="var(--ink-faint)" font-size="11">琥珀色是数据库(外部系统)那一侧,蓝色是进程内存里的计算。</text>
</g>
</svg>
<figcaption>换存储只换中间一格。因为 search 的返回形状和 Day 226 一致,拼 prompt、调模型、核对引用都没改。这也是为什么要先把 search 的接口设计成一样。</figcaption>
</figure>

零件对照表,默写时对着它想:

| 零件 | 作用 | 对应 Day 226 的 |
| --- | --- | --- |
| `embedding <=> %(q)s` | 每行到问题向量的余弦距离 | `VECTORS @ q` 的反面(1 − 相似度) |
| `ORDER BY ... LIMIT k` | 排序取前 k | `np.argsort(-scores)[:k]` |
| `sql.SQL(...)` 拼 `where` | 可选的分类过滤,类型检查器认可 | (numpy 版没有) |
| `categories is not None` | 区分"不过滤"和"过滤到空" | (numpy 版没有) |
| `1 - r[6]` | 距离换回相似度 | 直接是 `scores[i]` |
| `Chunk(...)` | 把一行装成块对象 | `CHUNKS[i]` |

## 动手练习

**练习 1:换一个距离运算符。** 把 `<=>` 换成 `<->`(L2)和 `<#>`(负内积),三种距离各查一次"和 `kb-003#1` 最近的 4 块",比较名次。再试着传一个不在白名单里的 `metric`,看会怎样。运算符不能用 `%s` 传,请用 `sql.SQL` 配一个写死的字典来选。

<details><summary>参考答案</summary>

新建 `part04/ex_metric.py`:

```python
# agent-zero-lab/part04/ex_metric.py
from typing import LiteralString

import psycopg
from psycopg import sql

from part04.pg_store import connect

OPS: dict[str, LiteralString] = {"cosine": "<=>", "l2": "<->", "ip": "<#>"}


def nearest(conn: psycopg.Connection, anchor_id: str, metric: str, k: int = 4) -> list[tuple[str, float]]:
    op = sql.SQL(OPS[metric])
    query = sql.SQL("""
        SELECT k.id, k.embedding {op} q.e AS distance
        FROM kb_chunks k, (SELECT embedding AS e FROM kb_chunks WHERE id = %s) q
        ORDER BY k.embedding {op} q.e
        LIMIT %s
    """).format(op=op)
    return [(r[0], r[1]) for r in conn.execute(query, (anchor_id, k)).fetchall()]


with connect() as conn:
    for metric in OPS:
        rows = nearest(conn, "kb-003#1", metric)
        print(f"{metric:<7}", [(i, round(d, 4)) for i, d in rows])
    try:
        nearest(conn, "kb-003#1", "cosine; DROP TABLE kb_chunks")
    except KeyError as e:
        print("不在白名单里的 metric:", type(e).__name__, e)
```

<div class="line-notes">

- `from typing import LiteralString` 标注"写死在代码里的字符串字面量"类型,3.11 起有。
- `OPS: dict[str, LiteralString] = {"cosine": "<=>", "l2": "<->", "ip": "<#>"}` 白名单字典:名字 → 运算符文本。值标成 `LiteralString`,类型检查器才认可它能传给 `sql.SQL`;不标的话,`sql.SQL(OPS[metric])` 会报 `str` 不能赋给 `LiteralString`。
- `def nearest(conn: psycopg.Connection, anchor_id: str, metric: str, k: int = 4)` 给定一个"锚点"块的编号,查它的近邻。
- `op = sql.SQL(OPS[metric])` 从字典里取运算符。`metric` 不在字典里就抛 `KeyError`,根本走不到拼 SQL 那一步。
- `SELECT k.id, k.embedding {op} q.e AS distance` `{op}` 占位符,下面 `.format(op=op)` 换成真正的运算符。
- `ORDER BY k.embedding {op} q.e` 排序里的运算符必须和 `SELECT` 里一致,所以用同一个占位符。
- `LIMIT %s` 和 `WHERE id = %s` 是值,照旧用 `%s` 参数传:`(anchor_id, k)` 对应出现的先后顺序。
- `return [(r[0], r[1]) for r in conn.execute(query, (anchor_id, k)).fetchall()]` 返回 `(编号, 距离)` 列表。
- `for metric in OPS:` 遍历字典的键,三种距离各查一次。
- `print(f"{metric:<7}", [(i, round(d, 4)) for i, d in rows])` 距离保留 4 位小数。
- `nearest(conn, "kb-003#1", "cosine; DROP TABLE kb_chunks")` 一个带恶意的 `metric`。字典里没有这个键,直接 `KeyError`。

</div>

```bash
uv run python -m part04.ex_metric
```

```text
cosine  [('kb-003#1', 0.0), ('kb-002#4', 0.1833), ('kb-017#1', 0.2117), ('kb-002#3', 0.2178)]
l2      [('kb-003#1', 0.0), ('kb-002#4', 0.6055), ('kb-017#1', 0.6507), ('kb-002#3', 0.66)]
ip      [('kb-003#1', -1.0), ('kb-002#4', -0.8167), ('kb-017#1', -0.7883), ('kb-002#3', -0.7822)]
不在白名单里的 metric: KeyError 'cosine; DROP TABLE kb_chunks'
```

三种运算符的名次一样,数字不一样:余弦 0.1833,L2 0.6055(= √(2 × 0.1833)),负内积 −0.8167,和正文验算的一致。不在白名单里的字符串在字典那一步就被挡下了。这就是"不能用参数的位置,从白名单里选"的写法:用户给的只是一个名字,真正拼进 SQL 的永远是代码里写死的那几个字。

</details>

**练习 2:能不能用相似度阈值当拒答?** 很多人会想:最高分太低就别调大模型了,直接说"没找到"。用 Day 227 的 10 道题加 4 道"资料里有答案但问得很短"的题,把阈值定在 0.70,看判对几个。

<details><summary>参考答案</summary>

新建 `part04/ex_threshold.py`:

```python
# agent-zero-lab/part04/ex_threshold.py
from common.embed import embed_one
from part04.pg_store import connect, search
from part04.refusal_test import CASES

# 再加四道"资料里有答案、但问得很短"的题
SHORT = [("能开发票吗", "答"), ("成员权限", "答"), ("E1042", "答"), ("几个账本", "答")]

THRESHOLD = 0.70

with connect() as conn:
    wrong = 0
    for question, expect in CASES + SHORT:
        chunk, score = search(conn, embed_one(question), 1)[0]
        got = "答" if score >= THRESHOLD else "拒"
        wrong += got != expect
        print(f"{'✓' if got == expect else '✗'} 该{expect} 最高分 {score:.3f} {chunk.id:<9} {question}")
    print(f"阈值 {THRESHOLD}:判错 {wrong}/{len(CASES + SHORT)}")
```

<div class="line-notes">

- `from part04.refusal_test import CASES` Day 227 的 10 道题,每项是 `(问题, "答"或"拒")`。
- `SHORT = [("能开发票吗", "答"), ("成员权限", "答"), ("E1042", "答"), ("几个账本", "答")]` 四道资料里有答案、但问得很短的题:发票在 kb-006,成员权限在 kb-015,E1042 在 kb-010,账本个数在 kb-001。短问题的 embedding 信息少,和正文的相似度往往偏低。
- `THRESHOLD = 0.70` 一个拍脑袋的阈值,最高分不到它就拒答。
- `chunk, score = search(conn, embed_one(question), 1)[0]` 只取最高分的那一块,`[0]` 取列表第一项再拆成块和分数。
- `got = "答" if score >= THRESHOLD else "拒"` 只看分数,不调大模型。
- `wrong += got != expect` 判错就加 1。
- `print(f"{'✓' if got == expect else '✗'} 该{expect} 最高分 {score:.3f} {chunk.id:<9} {question}")` 每题一行。

</div>

```bash
uv run python -m part04.ex_threshold
```

```text
✓ 该答 最高分 0.839 kb-002#1  年付专业版用到第 3 个月想退,能退多少
✓ 该答 最高分 0.727 kb-010#2  导入流水提示 E1042 怎么办
✓ 该答 最高分 0.728 kb-015#2  专业版最多几个人
✓ 该答 最高分 0.738 kb-006#1  月付的专业版能开增值税专用发票吗
✓ 该答 最高分 0.715 kb-019#1  免费版能用开放 API 吗
✓ 该拒 最高分 0.595 kb-016#1  你们支持微信支付吗
✓ 该拒 最高分 0.611 kb-001#2  有没有手机 App 可以记账
✓ 该拒 最高分 0.538 kb-005#2  账本能直接导到金蝶里吗
✓ 该拒 最高分 0.571 kb-001#2  企业版专属客服的电话是多少
✓ 该拒 最高分 0.674 kb-006#1  发票可以邮寄纸质版吗
✗ 该答 最高分 0.671 kb-006#2  能开发票吗
✗ 该答 最高分 0.635 kb-015#2  成员权限
✗ 该答 最高分 0.534 kb-010#1  E1042
✗ 该答 最高分 0.641 kb-001#2  几个账本
阈值 0.7:判错 4/14
```

前 10 道在 0.70 上判得完全正确:该答的最低 0.715,该拒的最高 0.674,中间只隔着 0.04。看起来可以用。但加上 4 道短问题,全军覆没:它们的检索结果都对(top-1 都是对的文章),分数却只有 0.53 到 0.67,全被误拒。短问题和长段正文的相似度天然偏低,问题长度一变,同一条阈值就不再成立。

结论是:相似度分数可以当参考(比如日志里记下最高分,方便事后排查),但不适合拿一个固定数字去直接决定拒不拒答。靠 Day 227 的办法,让模型看过资料后自己判断「资料够不够」,更稳。

</details>

**练习 3:拒答测试在数据库版上还能 10/10 吗?** 复用 Day 227 的 `refusal_test.CASES` 和 `REFUSED`,把检索换成 `pg_store.search`,其余不变,跑一遍。

<details><summary>参考答案</summary>

新建 `part04/ex_refusal_pg.py`:

```python
# agent-zero-lab/part04/ex_refusal_pg.py
from common.embed import embed_one
from part04.pg_store import connect, search
from part04.rag_numpy import build_messages, check_citations, client
from part04.refusal_test import CASES, REFUSED

right = 0
with connect() as conn:
    for question, expect in CASES:
        chunks = [c for c, _ in search(conn, embed_one(question), 4)]
        reply = client.chat(build_messages(question, chunks), temperature=0).content
        got = "拒" if REFUSED.search(reply) else "答"
        _, unknown = check_citations(reply, chunks)
        right += got == expect
        print(f"{'✓' if got == expect else '✗'} 该{expect} 实际{got}  {question:<18} {reply[:30]!r}{'  坏引用' + str(unknown) if unknown else ''}")
print(f"对 {right}/{len(CASES)}", "---", client.ledger)
```

<div class="line-notes">

- `from part04.rag_numpy import build_messages, check_citations, client` 复用的三样:拼消息、引用对账、模型客户端(带花费账本)。
- `from part04.refusal_test import CASES, REFUSED` Day 227 的题目和"这是不是拒答"的正则。`refusal_test.py` 有 main guard,`import` 它不会把 10 道题跑一遍。
- `chunks = [c for c, _ in search(conn, embed_one(question), 4)]` 和 Day 227 的 `run()` 唯一的不同:检索从 `rag_numpy.search(question, 4)` 换成数据库。
- `reply = client.chat(build_messages(question, chunks), temperature=0).content` 调模型,用的是 `rag_numpy.SYSTEM` 里的六句版。
- `got = "拒" if REFUSED.search(reply) else "答"` 同 Day 227。
- `right += got == expect` 判对加 1。
- `print(f"对 {right}/{len(CASES)}", "---", client.ledger)` 总分和这 10 次调用的花费。

</div>

```bash
uv run python -m part04.ex_refusal_pg
```

```text
✓ 该答 实际答  年付专业版用到第 3 个月想退,能退多少 '年付专业版在第 3 个月中途取消,按剩余整月数比例退款:前 '
✓ 该答 实际答  导入流水提示 E1042 怎么办   'E1042 表示文件的列名和模板不匹配,或者日期列的格式不是'
✓ 该答 实际答  专业版最多几个人           '专业版最多 3 名成员。[kb-015#2]'
✓ 该答 实际答  月付的专业版能开增值税专用发票吗   '不能。增值税专用发票仅限企业版,或年付的专业版 [kb-00'
✓ 该答 实际答  免费版能用开放 API 吗      '不能。开放 API 仅对企业版开放 [kb-019#1]。'
✓ 该拒 实际拒  你们支持微信支付吗          '帮助中心里没有找到这个问题的说明,建议转人工客服。'
✓ 该拒 实际拒  有没有手机 App 可以记账     '帮助中心里没有找到这个问题的说明,建议转人工客服。'
✓ 该拒 实际拒  账本能直接导到金蝶里吗        '帮助中心里没有找到这个问题的说明,建议转人工客服。'
✓ 该拒 实际拒  企业版专属客服的电话是多少      '帮助中心里没有找到这个问题的说明,建议转人工客服。'
✓ 该拒 实际拒  发票可以邮寄纸质版吗         '帮助中心里没有找到这个问题的说明,建议转人工客服。'
对 10/10 --- 10 次调用 | 输入 4307 / 输出 332 tokens | 约 ¥0.0065
```

10/10,和 numpy 版一样。这道题的意义不在分数,而在**回归**:换了一层基础设施以后,把原来的测试原样再跑一遍,没退步才敢放心。这 10 次调用花了约 0.0065 元(`deepseek-flash` 的价格,Day 227 查过)。

</details>

**练习 4:42 行的表,数据库用不用 HNSW 索引?** `kb_chunks` 上有 Day 229 建的 HNSW 索引。用 `EXPLAIN` 看看对"找 kb-003#1 的近邻"这条查询,Postgres 打算怎么执行。

<details><summary>参考答案</summary>

```bash
psql -d agentzero -c "EXPLAIN SELECT id FROM kb_chunks ORDER BY embedding <=> (SELECT embedding FROM kb_chunks WHERE id='kb-003#1') LIMIT 4;"
```

<div class="line-notes">

- `EXPLAIN SELECT id FROM kb_chunks` 在任何查询前加 `EXPLAIN`,数据库不执行它,只打印"我打算怎么执行"(执行计划),[Day 89](/blog/agent-zero/day-089-sql-5/) 学过。后半句 `ORDER BY embedding <=> (SELECT embedding FROM kb_chunks WHERE id='kb-003#1') LIMIT 4` 把"问题向量"换成一个子查询,这样不用手写 1024 个数;`LIMIT 4` 取前 4 行。整条命令写在一行里,用 `psql -c` 传给数据库。

</div>

```text
                                  QUERY PLAN
------------------------------------------------------------------------------
 Limit  (cost=15.68..15.69 rows=4 width=17)
   InitPlan 1
     ->  Seq Scan on kb_chunks kb_chunks_1  (cost=0.00..7.53 rows=1 width=18)
           Filter: (id = 'kb-003#1'::text)
   ->  Sort  (cost=8.16..8.26 rows=42 width=17)
         Sort Key: ((kb_chunks.embedding <=> (InitPlan 1).col1))
         ->  Seq Scan on kb_chunks  (cost=0.00..7.53 rows=42 width=17)
(7 rows)
```

计划里全是 `Seq Scan`(顺序扫描,逐行看)加 `Sort`(排序),没有一处出现 `kb_chunks_embedding_hnsw`。42 行的表,逐行扫比走索引还快,规划器很清楚这一点,所以今天所有的查询都是**精确**的暴力检索,这也是为什么 numpy 版和数据库版能 10/10 一致。索引什么时候会被用上、用上以后结果为什么可能变,是 [Day 233](/blog/agent-zero/day-233-hnsw/) 的内容。

</details>

验收标准:`psql` 里能写出带 `<=>` 的 `ORDER BY ... LIMIT` 查询;`uv run python -m part04.pg_search_first` 不过滤和过滤各打印 4 行;`pg_vs_numpy.py` 输出 `top-4 编号完全一致:10/10`;`pg_empty.py` 最后一行是 `[]`;`uvx basedpyright part04/pg_store.py part04/rag_pg.py` 0 个 error;能不看文章说出"三个运算符的区别""为什么 ORDER BY 里不能写 `1 - 距离`""为什么 `categories=[]` 要和 `None` 区分"。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 最近邻查询 | 给一个向量,找库里离它最近的 k 个。SQL 写法是 `ORDER BY 距离 LIMIT k` |
| `<=>` | pgvector 的余弦距离运算符,值 = 1 − 余弦相似度,越小越像 |
| `<->` | L2 距离(欧氏距离),两点间的直线距离 |
| `<#>` | 负内积。取负号是为了让"越小越像"对三个运算符都成立 |
| 运算符 | SQL 里像 `+`、`=` 一样的符号。pgvector 额外定义了上面三个 |
| 带名字的参数 | `%(q)s` 的写法,值放在字典里按名字对应,同一个值能在 SQL 里用多次 |
| `sql.SQL` | psycopg 里表示"一段可信 SQL"的类型,能用 `.format` 拼接片段,不能直接用普通字符串 |
| `sql.Literal` | 把一个 Python 值按 SQL 规矩转成字面量,用在不能用 `%s` 的位置 |
| `LiteralString` | 类型标注:代码里直接写出来的字符串,不是运行时拼的。psycopg 的类型检查靠它拦 SQL 注入 |
| 白名单 | 只允许事先列好的几个选项,不在里面的一律拒绝 |
| 执行计划 | 数据库对一条查询打算怎么执行,用 `EXPLAIN` 查看 |
| Seq Scan | 顺序扫描,逐行检查整张表 |
| 回归测试 | 改了某处以后,把原来的测试再跑一遍,确认没退步 |

## 常见误区

**以为换成数据库就更快。** 42 块的时候,数据库每次约 1.4 毫秒,numpy 约 0.035 毫秒。数据库的价值是共享、更新、过滤、规模,不是小数据上的速度。

**`ORDER BY` 按"相似度"升序。** 返回最不像的几块。排序要用距离升序,或者相似度加 `DESC`;而且为了让索引能用,`ORDER BY` 后面应当直接写距离运算符。

**用 `if categories` 判断"要不要过滤"。** 空列表也是假,权限为空的用户会查到全库。用 `is not None`。

**运算符、表名用 f-string 拼进 SQL。** 类型检查会报错,换到用户输入就是 SQL 注入。从代码里写死的白名单字典里选,再用 `sql.SQL` 拼。

**`SET` 语句用 `%s` 传参。** 报 `syntax error at or near "$1"`。配置语句和建表语句都不支持参数,值要用 `sql.Literal` 在 Python 这边拼。

**拿固定的相似度阈值决定拒答。** 长问题和短问题的分数范围不同,同一个阈值在 10 道题上全对,加了 4 道短问题就错 4 道(练习 2)。

**拿"分数完全相等"验证两边一致。** 向量是两次接口调用算出来的,分数有千分之几的浮动。比名次,不比小数点后第四位。

**以为 `rag_pg.py` 已经不依赖 `index/` 了。** 它 `import rag_numpy`,而后者在导入时读 `index/`,目录删了就报错。查询线的通用部分要拆出来才能真正脱钩。

## 学习资料

### 文档与文章

- [pgvector 官方 README](https://github.com/pgvector/pgvector):搜 `Querying` 和 `Distances` 两节,今天的三个运算符和 `ORDER BY ... LIMIT` 都在这里,20 分钟。
- [psycopg 3 · 向量化参数与 SQL 拼接](https://www.psycopg.org/psycopg3/docs/api/sql.html):`sql.SQL`、`Literal`、`Identifier`、`format` 的说明和例子,复习 Day 229。
- [psycopg 3 · 传参](https://www.psycopg.org/psycopg3/docs/basic/params.html):`%s` 和 `%(name)s` 两种写法,以及为什么有些语句不能用参数(看 `Server-side binding` 一节)。
- [PostgreSQL 文档 · EXPLAIN](https://www.postgresql.org/docs/17/sql-explain.html):练习 4 用到,先看开头的描述和 `Examples`。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1c6G7zAEmk&autoplay=0&high_quality=1" title="PostgreSQL 上的向量搜索实践——高策" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IvorySQL · PostgreSQL 上的向量搜索实践——高策 · 约 17 分钟,从 PostgreSQL 内核贡献者的角度讲向量检索怎么在 Postgres 里落地,对照今天的 SQL 看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/j1QcPSLj7u0" title="PGVector: Turn PostgreSQL Into A Vector Database" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>NeuralNine · PGVector: Turn PostgreSQL Into A Vector Database · 英文,从建表到相似度查询的完整演示,可以和今天的 psql 部分对照着看。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 6 章讲 RAG 和检索,里面对"向量搜索是近似的还是精确的"有简明的说明,明天读 HNSW 之前先看一遍。

### 开源项目与代码

- [pgvector/pgvector-python](https://github.com/pgvector/pgvector-python):README 里有 psycopg 3 的完整例子,包括今天的 `ORDER BY embedding <=> %s` 写法。

## 自测

**1. `<=>`、`<->`、`<#>` 分别是什么距离?对长度为 1 的向量,三者排出来的名次一样吗?**

<details><summary>答案</summary>

余弦距离、L2(欧氏)距离、负内积。长度都是 1 时,L2 距离的平方等于 2 倍的余弦距离,内积等于余弦相似度,三者都是"单调关系",名次一样,数字刻度不同。

</details>

**2. 下面这条 SQL 会返回最像还是最不像的 3 行?要怎么改?**

```sql
SELECT id, 1 - (embedding <=> '[0.1, 0.2, 0.3]') AS score FROM t ORDER BY score LIMIT 3;
```

<details><summary>答案</summary>

最不像的 3 行,`ORDER BY score` 默认升序,分数小的在前。改成 `ORDER BY score DESC`,或者直接 `ORDER BY embedding <=> '[...]'`(后者在有 HNSW 索引时才能用上索引)。

</details>

**3. `search(conn, v, 4, categories=[])` 应该返回什么?如果实现里写的是 `if categories:`,会出什么事?**

<details><summary>答案</summary>

应该返回空列表,因为"允许查看的分类为空"意味着什么都不能看。`if categories:` 把 `[]` 当成"没有过滤条件",返回全库的 top-4,没有权限的用户也能查到所有内容。要用 `is not None` 区分"没传"和"传了空的"。

</details>

**4. 为什么 `SET hnsw.ef_search = %s` 会报 `syntax error at or near "$1"`?怎么写才对?**

<details><summary>答案</summary>

psycopg 的 `%s` 是服务端绑定,值留给数据库,语句里变成 `$1`。`SET` 这类配置语句不支持绑定参数。要用 `sql.SQL("SET hnsw.ef_search = {}").format(sql.Literal(100))`,在 Python 这边把值转成安全的字面量再整句发过去。

</details>

**5. 面试题:你把 RAG 的检索从内存里的 numpy 换成了 pgvector,怎么证明没有引入问题?**

<details><summary>答案</summary>

分三层。第一层是检索本身:同一批问题、同一个问题向量,同时跑旧实现和新实现,对比 top-k 的编号和顺序(分数只做参考,因为向量来自不同次的接口调用,有千分之几的浮动)。第二层是端到端:把原来的回归测试集(比如拒答测试、引用对账)原样在新实现上再跑一遍,看分数有没有退步,同时看花费和延迟。第三层是边界:查询维度错误、过滤条件为空、k 大于总行数这些边界行为是否符合预期,尤其是权限相关的过滤。数据规模变大以后还要对比精确检索和索引检索的召回率,这是近似索引带来的新风险。

</details>

## 明天预告

明天是 [Day 233 · HNSW:为什么快,为什么会漏](/blog/agent-zero/day-233-hnsw/)。今天的表只有 42 行,`EXPLAIN` 里一点索引的影子都没有,所有结果都是精确的。明天造一张 2 万行的大表,真正用上 HNSW:看它比逐行扫快多少、用 `ef_search` 调召回率,并亲眼看到它为什么会"漏"。
