---
title: 'Day 450 · 知识库(三):混合检索'
description: '在 SupportPilot 里把 pgvector 向量检索、jieba + BM25 关键词检索和 RRF 按名次合并接成 kb/retriever.py 的 search()。用 52 条问法实测:BM25 在字面问法(错误码、专有名词)上 12 条全对,向量在口语问法上 39/40,混合检索夹在中间,没有想象中全面领先。讲清为什么,并让内存里的 BM25 索引跟着库一起更新。'
pubDate: 2026-10-27
regime: none
tags: ['capstone', 'supportpilot', 'rag', 'hybrid-search', 'bm25', 'agent-zero']
series: 'agent-zero'
day: 450
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 449](/blog/agent-zero/day-449-kb-ingest/) 把 62 篇文章导进了 Postgres:`kb.docs` 62 行,`kb.chunks` 150 行,每块存着原文和 1024 维的向量。今天要把它们**找出来**。

检索你已经学过三样零件:[Day 229](/blog/agent-zero/day-229-pgvector-1/) 到 [Day 232](/blog/agent-zero/day-232-pgvector-3/) 的 pgvector 向量检索,[Day 235](/blog/agent-zero/day-235-bm25/) 的 jieba 分词加 BM25 关键词检索,[Day 236](/blog/agent-zero/day-236-rrf/) 的 RRF 按名次合并。那几天是在练习仓库的小语料(42 块)上单独练的。今天把它们接进 SupportPilot:检索的是库里那 150 块,返回的是带出处的 `Hit`,并且回答一个以前没认真回答过的问题:**混合检索到底比单用一路好多少?**

## 今天要解决的问题

今天的新东西有两个:在 Postgres 里直接做向量排序(`<=>` 运算符,不再把向量读进 numpy),和让**内存里的 BM25 索引跟着库一起更新**(库里的块变了,索引要知道)。学完你应该能:

1. 写出 `src/supportpilot/kb/retriever.py`,里面的 `search(conn, query, k, mode)` 能返回 5 块带编号、带出处、记着是哪一路找到的资料。
2. 用 52 条问法(40 条口语的、12 条字面词的)对比向量、关键词、混合三种做法,读懂数字:谁在哪一类问法上赢、赢在哪。
3. 解释为什么 `search()` 默认用混合检索,却不能说「混合检索更好」。

预计用时 3 小时。花费 ¥0:每次查询只做一次 embedding,bge-m3 免费。前置:[Day 449](/blog/agent-zero/day-449-kb-ingest/) 导入好的库、[Day 235](/blog/agent-zero/day-235-bm25/) 的 BM25 和 jieba、[Day 236](/blog/agent-zero/day-236-rrf/) 的 RRF、[Day 448](/blog/agent-zero/day-448-kb-chunk/) 的 `make_hat` 和 40 条问法。

学法照旧:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `rrf()` 和 `search()` 默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先从前端看:站内搜索有两个脑子

做过站内搜索的人应该知道,关键词搜索(Algolia、Elasticsearch)搜「E4002」又快又准,搜「被收了两次钱」就抓瞎,因为文章里写的是「重复扣款」。语义搜索(向量)正好反过来,听得懂人话,可是遇到「INV-202609-0001」这种没有语义的编号,就容易飘。所以很多搜索产品两个都用,各出一份排行榜,再合并。

合并的办法叫 RRF:不管两边的分数是怎么算的(BM25 的分数是 5.21、16.97,向量的相似度是 0.79,根本不是一个量纲),只看**名次**。每一路里排第 r 名的拿 1/(60 + r) 分,两路的分数加起来。两边都认可的块,自然排在前面。像两个评委各自排出名次,再按名次投票。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="混合检索:客户的话分两路,一路向量检索,一路 BM25 关键词检索,各取前 10,再用 RRF 按名次合并,取前 5 块返回">
<g font-family="var(--font-mono)" font-size="11">
<rect x="10" y="85" width="110" height="50" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="65" y="107" text-anchor="middle" fill="var(--ink)">客户的话</text>
<text x="65" y="123" text-anchor="middle" fill="var(--ink-soft)">月付能退钱吗</text>
<rect x="170" y="25" width="190" height="60" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="265" y="47" text-anchor="middle" fill="var(--ink)">向量:embedding + &lt;=&gt;</text>
<text x="265" y="65" text-anchor="middle" fill="var(--ink-soft)">在 Postgres 里排序,取前 10</text>
<rect x="170" y="145" width="190" height="60" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="265" y="167" text-anchor="middle" fill="var(--ink)">关键词:jieba + BM25</text>
<text x="265" y="185" text-anchor="middle" fill="var(--ink-soft)">在内存索引里排序,取前 10</text>
<rect x="410" y="85" width="100" height="50" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="460" y="107" text-anchor="middle" fill="var(--ink)">RRF</text>
<text x="460" y="123" text-anchor="middle" fill="var(--ink-soft)">按名次合并</text>
<rect x="545" y="85" width="85" height="50" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="587" y="107" text-anchor="middle" fill="var(--ink)">前 5 块</text>
<text x="587" y="123" text-anchor="middle" fill="var(--ink-soft)">Hit 列表</text>
</g>
<g stroke="var(--ink-faint)" stroke-width="1.3">
<line x1="120" y1="100" x2="168" y2="62"/><line x1="120" y1="120" x2="168" y2="170"/>
<line x1="360" y1="62" x2="408" y2="100"/><line x1="360" y1="175" x2="408" y2="122"/>
<line x1="510" y1="110" x2="543" y2="110"/>
</g>
</svg>
<figcaption>两路各自排名,RRF 只看名次不看分数。每个 Hit 都记着自己是被哪一路(或两路)找到的,方便以后排查。</figcaption>
</figure>

## 第一步:向量那一路,让数据库来排序

练习仓库里,检索是把所有向量读进内存,用 numpy 做矩阵乘法。现在向量已经在 Postgres 里了,可以让数据库自己排序:pgvector 提供了运算符 `<=>`,意思是**余弦距离**(1 减去余弦相似度),越小越像。新建 `scratch/v1_vector.py`:

```python
# supportpilot/scratch/v1_vector.py
from supportpilot.db import connect
from supportpilot.kb.embed import embed_one

q = embed_one("月付能退钱吗")
SQL = """
SELECT c.doc_id, c.chunk_index, c.heading, c.embedding <=> %s AS distance
FROM kb.chunks c
ORDER BY c.embedding <=> %s
LIMIT 4
"""
with connect() as conn:
    for row in conn.execute(SQL, (q, q)):
        print(
            row["doc_id"],
            row["chunk_index"],
            row["heading"],
            round(row["distance"], 4),
            round(1 - row["distance"], 4),
        )
```

<div class="line-notes">

- `q = embed_one("月付能退钱吗")` 把客户的话变成 1024 维的向量,用 Day 449 的模块。
- `SQL = """` 三引号字符串写多行 SQL。
- `SELECT c.doc_id, c.chunk_index, c.heading, c.embedding <=> %s AS distance` 取出文章编号、块序号、小标题,再算每一块和查询向量的余弦距离,起名 `distance`。第一个 `%s` 是占位符,下面传查询向量。
- `FROM kb.chunks c` 从块表里取,`c` 是表的别名,少打几个字。
- `ORDER BY c.embedding <=> %s` 按距离从小到大排。这里又出现一个 `%s`,所以下面参数元组里查询向量要传两次。
- `LIMIT 4` 只要前 4 行。
- `for row in conn.execute(SQL, (q, q)):` 查询向量传两次,对应两个 `%s`。`q` 是 numpy 数组,[Day 443](/blog/agent-zero/day-443-database/) 的 `register_vector` 让 psycopg 知道怎么把它变成 `vector` 类型。
- `print(` 一行一行打印查询结果,每行五样东西。
- `row["doc_id"],` 文章编号、块序号、小标题,分别是前三样。
- `round(row["distance"], 4),` 第四样:余弦距离,保留 4 位小数。
- `round(1 - row["distance"], 4),` 第五样:1 减距离,也就是我们习惯的相似度。
</div>

```bash
uv run python scratch/v1_vector.py
```

```text
KB-refund-004 0 规则 0.2111 0.7889
KB-plans-002 1 退款规则不同 0.2118 0.7882
KB-refund-001 3 月付 0.2188 0.7812
KB-refund-004 1 例外 0.236 0.764
```

「月付能退钱吗」最像的是 `KB-refund-004`(月付可以退款吗)的「规则」块,相似度 0.7889。紧跟着的是 `KB-plans-002`「退款规则不同」和 `KB-refund-001`「月付」,全是对的方向。注意前三名的分数很接近(0.7889、0.7882、0.7812),向量检索能找到「大概在讲这件事」的那几块,但名次之间拉不开差距。

## 第二步:关键词那一路,jieba 加 BM25

关键词检索的原理在 Day 235 讲过:把句子切成词,看哪块里出现了你问的词,出现得少的词(比如 `E4002`)比出现得多的词(「退款」)更值钱。这里直接复用那一套,只有两处不同:词典换成 SupportPilot 自己的业务词,索引不是读文件建的,而是从库里把 150 块读出来建。

新建 `scratch/k1_bm25.py`。注意它要用的 `tokenize` 和 `KeywordIndex` 在第四步才会写进 `retriever.py`,现在先对照读懂它在做什么,等第四步写完回来跑;下面的输出是我写完整个文件以后跑的:

```python
# supportpilot/scratch/k1_bm25.py
from supportpilot.db import connect
from supportpilot.kb.retriever import KeywordIndex, tokenize

for s in ["月付能退钱吗", "导入银行流水时报错 E3001", "INV-202609-0001 是什么格式", "企业版最少要买几个席位"]:
    print(tokenize(s))

with connect() as conn:
    idx = KeywordIndex(conn)
print(len(idx.hits), "块,平均每块", round(idx.bm25.avgdl, 1), "个词")
for h in idx.search("E4002 是什么意思", k=3):
    print(f"{h.score:6.2f}  {h.key:16} {h.title} > {h.heading}")
```

<div class="line-notes">

- `from supportpilot.kb.retriever import KeywordIndex, tokenize` 两个东西:切词函数,和关键词索引类。都在今天最后拼出的 `retriever.py` 里。
- `for s in ["月付能退钱吗", "导入银行流水时报错 E3001", "INV-202609-0001 是什么格式", "企业版最少要买几个席位"]:` 四句话,分别测业务词、错误码混中文、带编号的、业务词开头的。
- `print(tokenize(s))` 打印切词结果。
- `with connect() as conn:` 连库。
- `idx = KeywordIndex(conn)` 从库里读 150 块,建索引。
- `print(len(idx.hits), "块,平均每块", round(idx.bm25.avgdl, 1), "个词")` `avgdl` 是 `BM25Okapi` 记的「平均每块多少个词」。
- `for h in idx.search("E4002 是什么意思", k=3):` 查询。
- `print(f"{h.score:6.2f}  {h.key:16} {h.title} > {h.heading}")` 分数占 6 格保留 2 位小数,块编号占 16 格左对齐。
</div>

```bash
uv run python scratch/k1_bm25.py
```

```text
['月付', '退钱']
['导入', '银行', '流水', '时报', '错', 'e3001']
['inv', '202609', '0001', '格式']
['企业版', '最少', '买', '几个', '席位']
150 块,平均每块 20.5 个词
  5.21  KB-error-010#0   E4002 发票税号校验失败 > 报错含义
  4.50  KB-error-010#3   E4002 发票税号校验失败 > 仍未解决
  3.82  KB-error-010#1   E4002 发票税号校验失败 > 原因
```

四句话的切词:业务词被保住了(`月付`、`企业版`),错误码被切成一整个并转成小写(`e3001`,查询和索引都走同一个函数,所以大小写不影响),`INV-202609-0001` 被拆成 `inv`、`202609`、`0001` 三个词。「是什么」「吗」「能」这类虚词被停用词表丢掉了。`时报` 是 jieba 切错的(本意是「导入…时」加「报错」),`错` 也留了下来,算是这套分词的小毛病。我试过把它们加进停用词表,对结果没有影响,所以没加。

150 块,平均每块 20.5 个词。`E4002 是什么意思` 切成 `e4002` 和 `意思`,最高分 5.21 是 `KB-error-010`(E4002 发票税号校验失败)的「报错含义」块,因为它的帽子里就有 `E4002`:索引里的文本也是「帽子 + 原文」,和向量化的那份一样,这样标题里的词也能命中。

## 第三步:RRF,按名次合并

两边都有了。拿一条两边意见不一致的问法看一下:`INV-202609-0001 是什么格式`(账单号的格式)。新建 `scratch/f1_rrf.py`(同样要等第四步写完 `retriever.py` 才能跑,输出是我写完以后跑的):

```python
# supportpilot/scratch/f1_rrf.py
from supportpilot.db import connect
from supportpilot.kb.retriever import keyword_index, rrf, vector_search

q = "INV-202609-0001 是什么格式"
with connect() as conn:
    vec = [h.key for h in vector_search(conn, q, k=5)]
    kw = [h.key for h in keyword_index(conn).search(q, k=5)]
print("向量:", vec)
print("BM25:", kw)
for key, score in rrf([vec, kw])[:4]:
    print(f"{score:.4f}  {key}")
```

<div class="line-notes">

- `from supportpilot.kb.retriever import keyword_index, rrf, vector_search` 三个函数,第五步的 `retriever.py` 里都有。
- `vec = [h.key for h in vector_search(conn, q, k=5)]` 向量那一路前 5 名,只取每块的 `key`(「文章编号#块序号」),RRF 只认编号。
- `kw = [h.key for h in keyword_index(conn).search(q, k=5)]` 关键词那一路前 5 名。BM25 只返回分数大于 0 的,所以可能不足 5 条。
- `for key, score in rrf([vec, kw])[:4]:` 把两路排名放进列表交给 `rrf`,取合并后的前 4 名。
- `print(f"{score:.4f}  {key}")` 保留 4 位小数。
</div>

```bash
uv run python scratch/f1_rrf.py
```

```text
向量: ['KB-technical-001#0', 'KB-error-003#1', 'KB-billing-006#0', 'KB-error-003#2', 'KB-error-003#3']
BM25: ['KB-billing-006#0', 'KB-plans-008#1', 'KB-error-003#2']
0.0323  KB-billing-006#0
0.0315  KB-error-003#2
0.0164  KB-technical-001#0
0.0161  KB-error-003#1
```

向量那一路,第 1 名是 `KB-technical-001#0`(导入凭证和科目)。这明显飘了,账单号格式和导入模板有什么关系?正确的 `KB-billing-006#0`(在哪里查看账单)只排第 3。关键词那一路,`INV`、`202609`、`0001` 这几个词只有这一块里有,排第 1。RRF 合并之后:`KB-billing-006#0` 在向量里第 3 名(1/63 = 0.0159)、在关键词里第 1 名(1/61 = 0.0164),相加 0.0323,排到第一。向量的第 1 名 `KB-technical-001#0` 只有一路认可,1/61 = 0.0164,被挤到第 3。这就是混合检索想要的效果:一个没有语义的字面编号,被关键词那一路救回来了。

## 第四步:拼成 retriever.py

三个零件对应最终文件的这些部分:

| 零件 | 在 `retriever.py` 里的位置 |
| --- | --- |
| 第一步的向量 SQL | `VECTOR_SQL` 和 `vector_search()` |
| 第二步的切词和索引 | `BUSINESS_WORDS`、`STOPWORDS`、`tokenize()`、`KeywordIndex` |
| 第三步的 RRF | `rrf()`,和 [Day 236](/blog/agent-zero/day-236-rrf/) 的 `fusion.py` 同一个函数 |
| 索引跟着库更新 | `stamp()` 和 `keyword_index()`,第五步讲 |
| 对外的入口 | `search()` 和 `Hit` |

先装两个新依赖(Day 235 在练习仓库里装过同样的,这是 SupportPilot 自己的环境):

```bash
uv add jieba rank-bm25
```

新建 `src/supportpilot/kb/retriever.py`:

```python
# supportpilot/src/supportpilot/kb/retriever.py
"""混合检索:向量(pgvector)一路,关键词(BM25)一路,按名次用 RRF 合并。"""

import logging
import re
from collections import defaultdict
from dataclasses import dataclass, field, replace
from typing import Any, Literal

import jieba
import psycopg
from psycopg.rows import DictRow
from rank_bm25 import BM25Okapi

from .chunker import make_hat
from .embed import embed_one

jieba.setLogLevel(logging.WARNING)

# 业务词典:jieba 不认识这些词,不加会被切碎(「月付能退钱」会切成「月」「付能」「退钱」)
BUSINESS_WORDS = [
    "免费版", "标准版", "专业版", "企业版", "年付", "月付", "席位", "账套", "自动续费", "对公转账",
    "两步验证", "无理由", "红冲", "专用发票", "普通发票", "期末结账", "反结账", "多币种", "原路返回",
]  # fmt: skip
for _w in BUSINESS_WORDS:
    jieba.add_word(_w)

STOPWORDS = {
    "的", "了", "是", "吗", "呢", "啊", "吧", "在", "和", "与", "或", "我", "你", "我们", "你们",
    "怎么", "怎么办", "什么", "如何", "可以", "能", "还", "要", "就", "都", "也", "把", "被", "让", "会",
    "有", "没有", "一个", "时候", "报", "想", "啥", "怎么弄",
}  # fmt: skip
WORD = re.compile(r"\w+")  # 汉字、字母、数字、下划线;用来丢掉空格和标点

Mode = Literal["hybrid", "vector", "bm25"]

FETCH = 10  # 每一路先各取这么多条,再合并
RRF_K = 60

# 两条查询返回同样的列,所以能共用 row_to_hit
VECTOR_SQL = """
SELECT c.doc_id || '#' || c.chunk_index AS key, c.doc_id, d.title, c.heading, c.content AS text,
       d.url_path, 1 - (c.embedding <=> %s) AS score
FROM kb.chunks c JOIN kb.docs d ON d.id = c.doc_id
ORDER BY c.embedding <=> %s
LIMIT %s
"""
ALL_CHUNKS_SQL = """
SELECT c.doc_id || '#' || c.chunk_index AS key, c.doc_id, d.title, c.heading, c.content AS text,
       d.url_path, 0.0 AS score
FROM kb.chunks c JOIN kb.docs d ON d.id = c.doc_id
ORDER BY c.id
"""
STAMP_SQL = "SELECT count(*) AS n, coalesce(max(id), 0) AS newest FROM kb.chunks"


@dataclass
class Hit:
    key: str  # "KB-refund-004#0":文章编号 # 这一块的序号
    doc_id: str
    title: str
    heading: str
    text: str
    url_path: str
    score: float = 0.0
    via: list[str] = field(default_factory=list)  # 被哪一路找到的:vector / bm25


def row_to_hit(row: dict[str, Any]) -> Hit:
    return Hit(
        row["key"], row["doc_id"], row["title"], row["heading"], row["text"], row["url_path"], row["score"]
    )


def tokenize(text: str) -> list[str]:
    """切词 → 丢掉空格标点 → 丢掉停用词 → 转小写。建索引和查询都走这一个函数。"""
    return [t.lower() for t in jieba.lcut(text) if WORD.fullmatch(t) and t not in STOPWORDS]


def rrf(rankings: list[list[str]], k: int = RRF_K) -> list[tuple[str, float]]:
    """每一路里排第 r 名的得 1/(k+r) 分,各路相加,按总分从高到低。只看名次,不看原始分数。"""
    scores: dict[str, float] = defaultdict(float)
    for ranking in rankings:
        for rank, key in enumerate(ranking, start=1):
            scores[key] += 1.0 / (k + rank)
    return sorted(scores.items(), key=lambda kv: -kv[1])


def stamp(conn: psycopg.Connection[DictRow]) -> tuple[int, int]:
    """库里块的「版本号」:块数 + 最大编号。重新导入会重写块,编号一定变大。"""
    row = conn.execute(STAMP_SQL).fetchone()
    return (row["n"], row["newest"]) if row else (0, 0)


class KeywordIndex:
    """把库里所有块读进内存建 BM25 索引。知识库只有 150 块,建一次很快。"""

    def __init__(self, conn: psycopg.Connection[DictRow]) -> None:
        self.stamp = stamp(conn)  # 先记版本号再读数据:中间库变了,下次对不上就会重建
        self.hits = [row_to_hit(r) for r in conn.execute(ALL_CHUNKS_SQL).fetchall()]
        # 索引的文本和向量化的一样:帽子 + 原文,标题里的词也能命中
        self.bm25 = BM25Okapi([tokenize(f"{make_hat(h.title, h.heading)}\n{h.text}") for h in self.hits])

    def search(self, query: str, k: int = FETCH) -> list[Hit]:
        scores = self.bm25.get_scores(tokenize(query))
        order = sorted(range(len(scores)), key=lambda i: -scores[i])[:k]
        return [replace(self.hits[i], score=float(scores[i])) for i in order if scores[i] > 0]


_index: KeywordIndex | None = None


def keyword_index(conn: psycopg.Connection[DictRow]) -> KeywordIndex:
    """取关键词索引:库里的块变了(重新导入过)就重建,没变就复用。"""
    global _index
    if _index is None or _index.stamp != stamp(conn):
        _index = KeywordIndex(conn)
    return _index


def vector_search(conn: psycopg.Connection[DictRow], query: str, k: int = FETCH) -> list[Hit]:
    q = embed_one(query)
    return [row_to_hit(r) for r in conn.execute(VECTOR_SQL, (q, q, k)).fetchall()]


def search(conn: psycopg.Connection[DictRow], query: str, k: int = 5, mode: Mode = "hybrid") -> list[Hit]:
    """返回最相关的 k 块。mode 取 hybrid(默认)、vector、bm25;后两个只用来做对比实验。"""
    if mode == "vector":
        return vector_search(conn, query, k)
    if mode == "bm25":
        return keyword_index(conn).search(query, k)
    vec = vector_search(conn, query)
    kw = keyword_index(conn).search(query)
    by_key = {h.key: h for h in vec + kw}
    found_by = {"vector": {h.key for h in vec}, "bm25": {h.key for h in kw}}
    out: list[Hit] = []
    for key, score in rrf([[h.key for h in vec], [h.key for h in kw]])[:k]:
        via = [name for name, keys in found_by.items() if key in keys]
        out.append(replace(by_key[key], score=score, via=via))
    return out
```

<div class="line-notes">

- `import logging` 下面关掉 jieba 的日志要用。
- `from collections import defaultdict` [Day 236](/blog/agent-zero/day-236-rrf/) 的 `rrf()` 要用:访问不存在的键自动给默认值。
- `from dataclasses import dataclass, field, replace` `replace` 复制一个 dataclass 对象并改其中几个字段,下面会用。
- `from typing import Any, Literal` `Literal` 限定一个参数只能取几个固定的值([Day 47](/blog/agent-zero/day-047-type-hints-3/))。
- `from rank_bm25 import BM25Okapi` Day 235 的库。
- `from .chunker import make_hat` 索引里的文本要和向量化的文本用**同一个**帽子写法,所以直接导入 `make_hat`,不再自己拼一遍。
- `jieba.setLogLevel(logging.WARNING)` 关掉 jieba 第一次加载词典时打印的好几行日志。
- `BUSINESS_WORDS = [` 业务词典。这批词是对着 62 篇文章整理的:套餐名、`月付`/`年付`、`账套`、`席位` 这些。不加的话 jieba 会把「月付能退钱」切成「月」「付能」「退钱」。
- `]  # fmt: skip` 告诉 `ruff format` 别重排这个列表:一行放多个词,比每词一行好读。
- `for _w in BUSINESS_WORDS:` 逐个加进 jieba 的全局词典。`_w` 的下划线表示临时变量。
- `STOPWORDS = {` 停用词:问句里的虚词,「怎么」「吗」「的」这一类。花括号里只有值没有键,是集合(Day 25)。
- `WORD = re.compile(r"\w+")  # 汉字、字母、数字、下划线` 预编译一个正则,用来丢掉空格和标点。
- `Mode = Literal["hybrid", "vector", "bm25"]` 检索模式只有三种。传别的值,类型检查器会在编辑器里画红线。
- `FETCH = 10  # 每一路先各取这么多条,再合并` 每一路取前 10,不是前 5。取多一点,RRF 才有得合并;只取 5 条,两路可能一条重叠都没有。
- `RRF_K = 60` Day 236 讲过的常数,论文里的经验值。
- `VECTOR_SQL = """` 第一步的 SQL 扩成了完整版:`c.doc_id || '#' || c.chunk_index AS key` 里的 `||` 是 SQL 的字符串拼接,拼出「KB-refund-004#0」这种键。
- `d.url_path, 1 - (c.embedding <=> %s) AS score` 同时取文章的链接(引用要用)和相似度。
- `FROM kb.chunks c JOIN kb.docs d ON d.id = c.doc_id` 块表和文章表连起来,才能拿到标题和链接。
- `ORDER BY c.embedding <=> %s` 按距离排序,也就是按相似度从高到低。
- `LIMIT %s` 取多少条也用占位符传。
- `ALL_CHUNKS_SQL = """` 建关键词索引时,要把所有块读出来。列和上面一样,`0.0 AS score` 是占位,凑成同样的形状,这样能共用 `row_to_hit`。
- `STAMP_SQL = "SELECT count(*) AS n, coalesce(max(id), 0) AS newest FROM kb.chunks"` 块的「版本号」:总块数和最大编号。`coalesce(max(id), 0)` 在表是空的时候给 0 而不是 NULL。
- `class Hit:` 一条检索结果,是今天的主角,之后的引用(Day 451)、Agent 工具都拿它。
- `key: str  # "KB-refund-004#0"` 「文章编号#块序号」,一块的唯一编号。
- `url_path: str` 文章的帮助中心链接,回复里标出处用。
- `via: list[str] = field(default_factory=list)  # 被哪一路找到的` 默认值是空列表。可变的默认值不能直接写 `= []`([Day 29](/blog/agent-zero/day-029-functions-2/) 的坑),dataclass 要用 `field(default_factory=list)`。
- `def row_to_hit(row: dict[str, Any]) -> Hit:` 把一行查询结果变成 `Hit`。
- `def tokenize(text: str) -> list[str]:` 建索引和查询**都走这一个函数**,两边切法一致 BM25 才对得上。
- `return [t.lower() for t in jieba.lcut(text) if WORD.fullmatch(t) and t not in STOPWORDS]` 切词、去标点空格、去停用词、转小写。
- `def rrf(rankings: list[list[str]], k: int = RRF_K) -> list[tuple[str, float]]:` Day 236 的函数,原样搬来。
- `scores: dict[str, float] = defaultdict(float)` 没见过的键默认 0.0,可以直接 `+=`。
- `for rank, key in enumerate(ranking, start=1):` 名次从 1 开始数。
- `scores[key] += 1.0 / (k + rank)` 第 r 名得 1/(60 + r)。同一块在两路都出现就累加两次。
- `return sorted(scores.items(), key=lambda kv: -kv[1])` 按总分从高到低。
- `def stamp(conn: psycopg.Connection[DictRow]) -> tuple[int, int]:` 取版本号。
- `return (row["n"], row["newest"]) if row else (0, 0)` `fetchone()` 理论上可能返回 `None`,类型检查器要求处理。
- `class KeywordIndex:` 关键词索引:把库里的块读进内存,建 BM25。
- `self.stamp = stamp(conn)  # 先记版本号再读数据` 先记版本号,再读数据:读的过程中库要是变了,版本号会比数据旧,下一次检查发现对不上就重建,方向是安全的。反过来写就可能记下新版本号、用的却是旧数据,以后永远不重建。
- `self.hits = [row_to_hit(r) for r in conn.execute(ALL_CHUNKS_SQL).fetchall()]` 150 块全读进来。
- `self.bm25 = BM25Okapi([tokenize(f"{make_hat(h.title, h.heading)}\n{h.text}") for h in self.hits])` 每块的文本是「帽子 + 原文」,切词后交给 `BM25Okapi`。
- `def search(self, query: str, k: int = FETCH) -> list[Hit]:` 查询。
- `scores = self.bm25.get_scores(tokenize(query))` 一个长度 150 的数组,第 i 个数是第 i 块的分数。
- `order = sorted(range(len(scores)), key=lambda i: -scores[i])[:k]` 按分数从高到低排下标,取前 `k`。
- `return [replace(self.hits[i], score=float(scores[i])) for i in order if scores[i] > 0]` 复制一份 `Hit` 并把分数换成 BM25 分数。分数是 0 的丢掉,一个词都没对上的块不算命中。
- `_index: KeywordIndex | None = None` 模块级缓存:整个进程只建一份索引。
- `def keyword_index(conn: psycopg.Connection[DictRow]) -> KeywordIndex:` 取索引,缓存过期才重建。
- `global _index` 函数里要给模块级变量赋值,必须先声明 `global`,否则 Python 会当成新建了一个同名局部变量。
- `if _index is None or _index.stamp != stamp(conn):` 第一次,或者库里的版本号和索引建的时候不一样,就重建。每次查询多一条很轻的 `count(*)`。
- `def vector_search(conn: psycopg.Connection[DictRow], query: str, k: int = FETCH) -> list[Hit]:` 向量一路。
- `q = embed_one(query)` 客户的话变向量,每次查询一次 embedding 请求。
- `return [row_to_hit(r) for r in conn.execute(VECTOR_SQL, (q, q, k)).fetchall()]` 参数三个:查询向量两次(分数和排序各一次)加上 `k`。
- `def search(conn: psycopg.Connection[DictRow], query: str, k: int = 5, mode: Mode = "hybrid") -> list[Hit]:` 对外的入口。`k=5` 给模型 5 块,默认混合。
- `if mode == "vector":` 单走一路,只用于对比实验。
- `vec = vector_search(conn, query)` 混合模式:每路先取 `FETCH=10` 条。
- `by_key = {h.key: h for h in vec + kw}` `键 → Hit` 的字典,合并完要靠键找回完整的 `Hit`。
- `found_by = {"vector": {h.key for h in vec}, "bm25": {h.key for h in kw}}` 每一路各有哪些键,用集合,查询「某一块被哪一路找到」很快。
- `for key, score in rrf([[h.key for h in vec], [h.key for h in kw]])[:k]:` RRF 合并后取前 `k`。
- `via = [name for name, keys in found_by.items() if key in keys]` 这一块出现在哪几路里。
- `out.append(replace(by_key[key], score=score, via=via))` 复制 `Hit`,分数换成 RRF 分,记上 `via`。注意分数的含义换了:向量是相似度,BM25 是原始分,混合是 RRF 分,三种数不能互相比较。
</div>

先让 `search()` 对三条问法各用三种模式跑一遍,看看返回的 `Hit` 长什么样。新建 `scratch/r1.py`:

```python
# supportpilot/scratch/r1.py
from supportpilot.db import connect
from supportpilot.kb.retriever import search, tokenize

for q in ["月付能退钱吗", "导入银行流水时报错 E3001", "E4002 是什么意思"]:
    print(q, "→ 切成", tokenize(q))
    with connect() as conn:
        for mode in ("vector", "bm25", "hybrid"):
            hits = search(conn, q, k=3, mode=mode)
            print(f"  [{mode}]", [(h.key, round(h.score, 4)) for h in hits])
```

<div class="line-notes">

- `from supportpilot.kb.retriever import search, tokenize` 只用公开的两个函数。
- `for q in ["月付能退钱吗", "导入银行流水时报错 E3001", "E4002 是什么意思"]:` 三条问法:口语的、中文混错误码的、几乎只有错误码的。
- `print(q, "→ 切成", tokenize(q))` 先看关键词那一路看到了什么。
- `hits = search(conn, q, k=3, mode=mode)` 同一条问法,三种模式各取前 3。
- `print(f"  [{mode}]", [(h.key, round(h.score, 4)) for h in hits])` 只打印「块编号、分数」。
</div>

```bash
uv run python scratch/r1.py
```

```text
月付能退钱吗 → 切成 ['月付', '退钱']
  [vector] [('KB-refund-004#0', 0.7889), ('KB-plans-002#1', 0.7882), ('KB-refund-001#3', 0.7812)]
  [bm25] [('KB-plans-002#0', 4.0133), ('KB-refund-004#0', 3.8863), ('KB-plans-002#2', 3.8221)]
  [hybrid] [('KB-refund-004#0', 0.0325), ('KB-plans-002#1', 0.0315), ('KB-refund-001#3', 0.0315)]
导入银行流水时报错 E3001 → 切成 ['导入', '银行', '流水', '时报', '错', 'e3001']
  [vector] [('KB-error-005#3', 0.7528), ('KB-error-005#0', 0.75), ('KB-error-005#2', 0.6858)]
  [bm25] [('KB-error-005#0', 13.4546), ('KB-error-005#3', 11.6891), ('KB-error-005#1', 10.7223)]
  [hybrid] [('KB-error-005#3', 0.0325), ('KB-error-005#0', 0.0325), ('KB-error-005#1', 0.0315)]
E4002 是什么意思 → 切成 ['e4002', '意思']
  [vector] [('KB-error-010#0', 0.5025), ('KB-error-002#0', 0.4624), ('KB-error-006#0', 0.4458)]
  [bm25] [('KB-error-010#0', 5.2073), ('KB-error-010#3', 4.4991), ('KB-error-010#1', 3.8174)]
  [hybrid] [('KB-error-010#0', 0.0328), ('KB-error-010#3', 0.0313), ('KB-error-010#1', 0.0313)]
```

三条问法,三种模式。「月付能退钱吗」,向量和混合都把 `KB-refund-004#0` 放第一,BM25 却把 `KB-plans-002#0` 放第一,`KB-refund-004#0` 屈居第二。原因在切词那一行:`退钱` 这个词整个知识库里一次都没出现过(文章里写的是「退款」),BM25 实际只靠 `月付` 一个词在排,而 `KB-plans-002#0` 的帽子加原文里 `月付` 出现了 5 次。两条带错误码的,三种模式前几名几乎一样,因为向量检索对 `E3001`、`E4002` 并不陌生,bge-m3 在这个小知识库上处理得不错,我原来以为向量会在这类问法上翻车,事实没有。注意三种模式的分数量纲:向量是 0.79,BM25 是 4.01、13.45,混合是 0.0325。这些数字只能在同一种模式里比较。

## 第五步:索引怎么跟着库更新

`KeywordIndex` 把块读进了内存,这带来一个新问题:库里的块变了(Day 449 的导入重写了几篇文章),内存里的索引怎么知道?`keyword_index()` 里那个 `stamp` 就是答案:索引建的时候记下库的版本号,下一次取索引时再查一次版本号,不一样就重建。用 `scratch/s1_stamp.py` 看一遍这个过程:

```python
# supportpilot/scratch/s1_stamp.py
from pathlib import Path

from supportpilot.db import connect
from supportpilot.kb.chunker import load_articles
from supportpilot.kb.ingest import ingest
from supportpilot.kb.retriever import keyword_index, stamp

with connect() as conn:
    idx1 = keyword_index(conn)
    print("版本戳", stamp(conn), "| 再取一次是同一个对象:", keyword_index(conn) is idx1)

    conn.execute("DELETE FROM kb.docs WHERE id = 'KB-refund-005'")  # 模拟文章被删
    print("删掉一篇后", stamp(conn), "| 索引变了吗:", keyword_index(conn) is not idx1)
    idx2 = keyword_index(conn)

    ingest(conn, load_articles(Path("data/kb")))  # 重新导入,把它补回来
    print("重新导入后", stamp(conn), "| 索引变了吗:", keyword_index(conn) is not idx2)
```

<div class="line-notes">

- `idx1 = keyword_index(conn)` 第一次取:建索引并缓存。
- `print("版本戳", stamp(conn), "| 再取一次是同一个对象:", keyword_index(conn) is idx1)` `is` 判断是不是同一个对象(不是值相等)。库没变,第二次取应该直接返回缓存。
- `conn.execute("DELETE FROM kb.docs WHERE id = 'KB-refund-005'")  # 模拟文章被删` 删掉一篇文章,它的块级联删除,块数少了 1。
- `print("删掉一篇后", stamp(conn), "| 索引变了吗:", keyword_index(conn) is not idx1)` 版本号变了,取索引应该得到一个新对象。
- `idx2 = keyword_index(conn)` 记下重建后的新索引。
- `ingest(conn, load_articles(Path("data/kb")))  # 重新导入,把它补回来` 用 Day 449 的导入把被删的文章补回来,只会处理这一篇。
- `print("重新导入后", stamp(conn), "| 索引变了吗:", keyword_index(conn) is not idx2)` 版本号又变了,又重建。
</div>

```bash
uv run python scratch/s1_stamp.py
```

```text
版本戳 (150, 2190) | 再取一次是同一个对象: True
删掉一篇后 (149, 2190) | 索引变了吗: True
重新导入后 (150, 2326) | 索引变了吗: True
```

三行对应三种情况:没变,复用同一个对象(`True`);删掉一篇之后块数变成 149,索引重建;重新导入补回来,块数 150,又重建。第三行的「最大编号」从 2190 跳到了 2326,不是只多了一块:`bigserial` 的序号用掉了就不退回,我之前跑测试时回滚了很多次写入,每次回滚都白白消耗了序号。所以别指望块的编号是连续的,版本戳用的是「块数加最大编号」两个一起,单独一个都不够:删一篇再补一篇,块数可以不变,最大编号一定变大。

这个办法有边界:只在**单个进程**里管用。如果以后服务起了两个进程,各有各的内存索引,一个进程触发了导入,另一个进程下次检索时才会发现版本号对不上、跟着重建。我们只有一个进程,没问题。要是知识库有几十万块,每次重建都读全表就太慢了,到时候要换成数据库里的全文检索,或者独立的搜索引擎。


## 第六步:量一量,混合到底比单用一路好多少

要量,先要一批问法。Day 448 的 40 条是口语问法(「被收了两次钱」),拿来量语义这边够用,却偏袒向量,因为关键词检索本来就不擅长。我再加 12 条**字面词**问法:错误码(`E3004`、`E5002`)、专有名词(`SSO 单点登录`、`Commercial Invoice`)、接口里的字段(`Retry-After`、`HMAC-SHA256 签名`)、账单号格式。这类问法客服场景里很常见,而且是向量检索传统上的弱项。字面问法的标准答案怎么定?**凡是正文里出现这个词的文章都算对**,我用 `grep` 一篇篇查出来,所以「xlsx」有 4 篇算对,不是我随便挑的一篇。

把 Day 448 的 `scratch/queries.py` 复制成 `scripts/kb_queries.py`(以后的评测天也要用,所以挪到 `scripts/` 里),文件末尾追加下面 12 条:

```python
# supportpilot/scripts/kb_queries.py
# (客户的话, 算对的文章编号集合):文章级判定,一个问题可以有不止一篇算对
QUERIES: list[tuple[str, set[str]]] = [
    ("想把手机号换成新的", {"KB-account-002"}),
    ("怎么让别人的设备下线", {"KB-account-007"}),
    ("我想把账号永久删除", {"KB-account-006"}),
    ("怎么让它别再自动扣钱了", {"KB-billing-002"}),
    ("公司转账能付年费吗", {"KB-billing-005"}),
    ("老客户会跟着涨价吗", {"KB-billing-008"}),
    ("退了款发票怎么办", {"KB-invoice-004"}),
    ("外国公司想要发票", {"KB-invoice-005"}),
    ("年付比月付便宜多少", {"KB-plans-002", "KB-plans-001"}),
    ("免费版能连银行吗", {"KB-plans-006", "KB-technical-003"}),
    ("手机上和电脑上看到的数不一样", {"KB-technical-006"}),
    ("结账有一步没做完会怎样", {"KB-technical-005", "KB-error-007"}),
    ("怎么把数据导出来", {"KB-technical-002"}),
    ("能用 IE 打开吗", {"KB-technical-007"}),
    ("汇率多久更新一次", {"KB-technical-008"}),
    ("最多能建几个账套", {"KB-technical-004"}),
    ("收到 429 该怎么办", {"KB-api-002", "KB-error-011"}),
    ("Webhook 推送失败会重试吗", {"KB-api-004"}),
    ("密钥泄露了怎么办", {"KB-api-003"}),
    ("月付能退钱吗", {"KB-refund-004", "KB-refund-001"}),
    ("减少席位会退钱吗", {"KB-billing-007", "KB-plans-005"}),
    ("退款多久能到账", {"KB-refund-005"}),
    ("试用结束后会自动扣费吗", {"KB-plans-007"}),
    ("开两步验证要怎么弄", {"KB-account-005"}),
    ("开通 API 要什么套餐", {"KB-api-001"}),
    ("降级以后我的数据会没吗", {"KB-plans-004"}),
    ("升级要补多少钱", {"KB-plans-003"}),
    ("扣款失败几次会被取消", {"KB-billing-003"}),
    ("优惠券遇到退款怎么算", {"KB-billing-009"}),
    ("被收了两次钱", {"KB-billing-004"}),
    ("老手机号丢了怎么改绑定", {"KB-account-002"}),
    ("取消订阅后账套还在吗", {"KB-plans-008"}),
    ("企业版最少要买几个席位", {"KB-plans-005", "KB-plans-001"}),
    ("抬头跟营业执照对不上", {"KB-invoice-006"}),
    ("开错的发票能重开吗", {"KB-invoice-003"}),
    ("增值税专用发票和普通的有啥不同", {"KB-invoice-002"}),
    ("银行授权多久过期", {"KB-technical-003"}),
    ("反结账怎么操作", {"KB-technical-005"}),
    ("打印出来的凭证位置偏了", {"KB-technical-009"}),
    ("设备被陌生人登录过", {"KB-account-007"}),
    # 下面 12 条是字面词:错误码、专有名词、接口字段。算对的文章 = 正文里出现这个词的所有文章
    ("E3004 怎么处理", {"KB-error-008"}),
    ("E2002", {"KB-error-004", "KB-technical-001"}),
    ("报 E1002", {"KB-error-002"}),
    ("SSO 单点登录", {"KB-plans-001", "KB-plans-005"}),
    ("Retry-After", {"KB-api-002", "KB-error-011"}),
    ("HMAC-SHA256 签名", {"KB-api-004"}),
    ("INV-202609-0001 是什么格式", {"KB-billing-006"}),
    ("xlsx", {"KB-technical-002", "KB-technical-001", "KB-error-003", "KB-plans-008"}),
    ("Commercial Invoice", {"KB-invoice-005"}),
    ("Authorization Bearer", {"KB-api-001"}),
    ("红冲", {"KB-invoice-004", "KB-invoice-003"}),
    ("E5002", {"KB-error-012", "KB-api-003"}),
]
```

<div class="line-notes">

- `# (客户的话, 算对的文章编号集合):文章级判定` 数据格式沿用 Day 448:一个问法,一个标准答案集合。
- `QUERIES: list[tuple[str, set[str]]] = [` 共 52 条,前 40 条是口语的,后 12 条是字面的。
- `("想把手机号换成新的", {"KB-account-002"}),` 第一条口语问法。
- `# 下面 12 条是字面词:错误码、专有名词、接口字段。算对的文章 = 正文里出现这个词的所有文章` 字面问法的判定规则写在注释里,免得以后忘了。
- `("E3004 怎么处理", {"KB-error-008"}),` 只有一篇文章提到 E3004。
- `("E2002", {"KB-error-004", "KB-technical-001"}),` E2002 在报错码那篇和导入模板那篇都出现了,都算对。
- `("SSO 单点登录", {"KB-plans-001", "KB-plans-005"}),` 套餐对比和企业版与席位两篇都提到。
- `("INV-202609-0001 是什么格式", {"KB-billing-006"}),` 账单号格式只出现在「在哪里查看账单」。
- `("xlsx", {"KB-technical-002", "KB-technical-001", "KB-error-003", "KB-plans-008"}),` 4 篇文章里都出现了 `xlsx`,都算对。
- `("E5002", {"KB-error-012", "KB-api-003"}),` 最后一条,报错码和 API Key 管理两篇。
</div>

再写一个对照脚本 `scripts/compare_modes.py`:对每条问法、每种模式,算正确文章排第几,打印「第一名对几条」「前三名」「前五名」「前十名」,再按口语和字面两组分开数:

```python
# supportpilot/scripts/compare_modes.py
"""同一批问题,分别用 vector、bm25、hybrid 检索,看正确文章排第几。"""

import sys

import psycopg
from kb_queries import QUERIES
from psycopg.rows import DictRow

from supportpilot.db import connect
from supportpilot.kb.retriever import Mode, search

SEMANTIC = 40  # QUERIES 里前 40 条是口语问法,后面是字面词


def doc_rank(conn: psycopg.Connection[DictRow], query: str, gold: set[str], mode: Mode) -> int:
    docs: list[str] = []
    for h in search(conn, query, k=10, mode=mode):
        if h.doc_id not in docs:  # 同一篇文章的几块只算一次
            docs.append(h.doc_id)
    return next((r for r, d in enumerate(docs, 1) if d in gold), 99)


def main(show_misses: bool = True) -> None:
    with connect() as conn:
        modes: list[Mode] = ["vector", "bm25", "hybrid"]
        for mode in modes:
            ranks = [doc_rank(conn, q, gold, mode) for q, gold in QUERIES]
            n = len(ranks)
            top1 = sum(r == 1 for r in ranks)
            top3 = sum(r <= 3 for r in ranks)
            top5 = sum(r <= 5 for r in ranks)
            found = sum(r < 99 for r in ranks)
            mrr = sum(1 / r for r in ranks if r < 99) / n
            line = f"第一名 {top1}/{n}  前三名 {top3}/{n}  前五名 {top5}/{n}  前十名 {found}/{n}"
            print(f"{mode:7} {line}  MRR={mrr:.3f}")
            sem, lit = ranks[:SEMANTIC], ranks[SEMANTIC:]
            ok_sem, ok_lit = sum(r == 1 for r in sem), sum(r == 1 for r in lit)
            print(f"        口语 {ok_sem}/{len(sem)} 对  字面 {ok_lit}/{len(lit)} 对")
            if show_misses:
                for (q, _), r in zip(QUERIES, ranks, strict=True):
                    if r > 1:
                        print(f"          第 {r if r < 99 else '-'} 名:{q}")


if __name__ == "__main__":
    main(show_misses="--quiet" not in sys.argv)
```

<div class="line-notes">

- `from kb_queries import QUERIES` `scripts/` 在 `pyproject.toml` 的 `pythonpath` 里([Day 444](/blog/agent-zero/day-444-kb-generate/) 加的),脚本从仓库根目录运行时也能 `import kb_queries`(因为脚本所在目录自动在导入路径里)。
- `from supportpilot.kb.retriever import Mode, search` `Mode` 是类型别名,给下面的参数标类型。
- `SEMANTIC = 40  # QUERIES 里前 40 条是口语问法,后面是字面词` 分组的分界线。
- `def doc_rank(conn: psycopg.Connection[DictRow], query: str, gold: set[str], mode: Mode) -> int:` 返回正确文章的名次。
- `for h in search(conn, query, k=10, mode=mode):` 取前 10 块。
- `if h.doc_id not in docs:  # 同一篇文章的几块只算一次` 按**文章**判分:一篇文章的几块都排在前面,只算第一次出现。
- `return next((r for r, d in enumerate(docs, 1) if d in gold), 99)` 第一个属于标准答案的文章,它的名次就是结果;一个都没有就记 99。
- `modes: list[Mode] = ["vector", "bm25", "hybrid"]` 三种模式依次跑。
- `ranks = [doc_rank(conn, q, gold, mode) for q, gold in QUERIES]` 52 条问法各得一个名次。
- `top1 = sum(r == 1 for r in ranks)` 布尔值能当 0/1 相加,数一数排第一的有几条。
- `mrr = sum(1 / r for r in ranks if r < 99) / n` MRR(平均倒数排名):名次取倒数再平均,排第一得 1,排第二得 0.5,没找到得 0。
- `sem, lit = ranks[:SEMANTIC], ranks[SEMANTIC:]` 按前 40 条、后 12 条切成两组。
- `ok_sem, ok_lit = sum(r == 1 for r in sem), sum(r == 1 for r in lit)` 两组各自排第一的条数。
- `print(f"        口语 {ok_sem}/{len(sem)} 对  字面 {ok_lit}/{len(lit)} 对")` 分组的结果。
- `if show_misses:` 默认把没排第一的问法列出来,加 `--quiet` 就只看汇总。
- `print(f"          第 {r if r < 99 else '-'} 名:{q}")` 没找到的显示成 `-`。
</div>

```bash
uv run python scripts/compare_modes.py
```

```text
vector  第一名 49/52  前三名 52/52  前五名 52/52  前十名 52/52  MRR=0.968
        口语 39/40 对  字面 10/12 对
          第 2 名:公司转账能付年费吗
          第 2 名:SSO 单点登录
          第 3 名:INV-202609-0001 是什么格式
bm25    第一名 43/52  前三名 46/52  前五名 46/52  前十名 47/52  MRR=0.855
        口语 31/40 对  字面 12/12 对
          第 - 名:怎么让它别再自动扣钱了
          第 - 名:公司转账能付年费吗
          第 - 名:老客户会跟着涨价吗
          第 8 名:退了款发票怎么办
          第 - 名:手机上和电脑上看到的数不一样
          第 3 名:怎么把数据导出来
          第 2 名:月付能退钱吗
          第 2 名:降级以后我的数据会没吗
          第 - 名:被收了两次钱
hybrid  第一名 48/52  前三名 51/52  前五名 52/52  前十名 52/52  MRR=0.954
        口语 36/40 对  字面 12/12 对
          第 4 名:怎么让它别再自动扣钱了
          第 3 名:公司转账能付年费吗
          第 2 名:退了款发票怎么办
          第 2 名:怎么把数据导出来
```

数字整理成表(第一名对几条,括号里是前五名):

| | 口语 40 条 | 字面 12 条 | 合计 52 条 |
| --- | --- | --- | --- |
| 向量 | 39 | 10 | 49(前五 52) |
| BM25 | 31 | 12 | 43(前五 46) |
| 混合 | 36 | 12 | 48(前五 52) |

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="三种检索在口语问法和字面问法上排第一的条数:向量 39 和 10,BM25 31 和 12,混合 36 和 12">
<g font-family="var(--font-mono)" font-size="12">
<text x="10" y="22" fill="var(--ink-soft)">口语问法 40 条,排第一</text>
<text x="10" y="52" fill="var(--ink)">向量</text>
<rect x="70" y="38" width="390" height="20" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="470" y="53" fill="var(--ink-soft)">39</text>
<text x="10" y="82" fill="var(--ink)">BM25</text>
<rect x="70" y="68" width="310" height="20" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="390" y="83" fill="var(--ink-soft)">31</text>
<text x="10" y="112" fill="var(--ink)">混合</text>
<rect x="70" y="98" width="360" height="20" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="440" y="113" fill="var(--ink-soft)">36</text>
<text x="10" y="148" fill="var(--ink-soft)">字面问法 12 条,排第一</text>
<text x="10" y="178" fill="var(--ink)">向量</text>
<rect x="70" y="164" width="325" height="20" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="405" y="179" fill="var(--ink-soft)">10</text>
<text x="10" y="208" fill="var(--ink)">BM25 和混合</text>
<rect x="110" y="194" width="390" height="20" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="510" y="209" fill="var(--ink-soft)">12</text>
</g>
</svg>
<figcaption>口语问法的条长按 40 画,字面问法的条长按 12 画。向量擅长口语,关键词在字面词上一条不丢,混合夹在中间。</figcaption>
</figure>

先说结论,再看原因。**三种做法在这个知识库上的差距比我预期的小得多,而且混合检索没有全面领先。**

**BM25 在字面问法上 12 条全对,在口语问法上只对 31 条。** 没排第一的 9 条里有 5 条是前 10 名里完全找不到(`-`):「怎么让它别再自动扣钱了」「老客户会跟着涨价吗」「被收了两次钱」,问法里的词和文章里的词根本不重合。文章写的是「自动续费」「价格调整」「重复扣款」,客户说的是「自动扣钱」「涨价」「两次」。这是关键词检索的天性,Day 235 就讲过,今天只是在自己的数据上又看到一遍。

**向量在口语上 39/40,在字面上 10/12。** 失手的两条:`SSO 单点登录` 排第 2,`INV-202609-0001 是什么格式` 排第 3(第三步看过)。向量对编号的敏感度比我以为的好,12 条字面问法对了 10 条,但最难的那类(账单号)还是会飘。

**混合在口语上 36/40,字面 12/12。** 字面问法被关键词那一路救了回来,12 条全对;口语问法却从向量的 39 掉到 36,丢了 3 条。看那几条的细节(第二条问法 `怎么让它别再自动扣钱了`,在 `scratch/r2.py` 里):

```python
# supportpilot/scratch/r2.py
from supportpilot.db import connect
from supportpilot.kb.retriever import search, tokenize

q = "INV-202609-0001 是什么格式"
print("切成", tokenize(q))
with connect() as conn:
    for mode in ("vector", "bm25", "hybrid"):
        print(f"[{mode}]")
        for h in search(conn, q, k=3, mode=mode):
            print(f"  {h.score:8.4f}  {h.key:16} {h.title} / {h.heading}  via={h.via}")
q = "怎么让它别再自动扣钱了"
print("\n切成", tokenize(q))
with connect() as conn:
    for mode in ("vector", "bm25", "hybrid"):
        print(f"[{mode}]")
        for h in search(conn, q, k=4, mode=mode):
            print(f"  {h.score:8.4f}  {h.key:16} {h.title} / {h.heading}  via={h.via}")
```

<div class="line-notes">

- `q = "INV-202609-0001 是什么格式"` 第一条问法:账单号。
- `print("切成", tokenize(q))` 看关键词那一路切出了什么。
- `for mode in ("vector", "bm25", "hybrid"):` 三种模式。
- `for h in search(conn, q, k=3, mode=mode):` 前三块。
- `print(f"  {h.score:8.4f}  {h.key:16} {h.title} / {h.heading}  via={h.via}")` 分数、块编号、文章标题和小标题、`via`(只在混合模式下才会记录)。
- `q = "怎么让它别再自动扣钱了"` 第二条问法:口语。
- `print("\n切成", tokenize(q))` 它的切词结果是 `它`、`别`、`再`、`自动`、`扣钱`,里面 `它`、`别`、`再` 都是虚词。
</div>

```bash
uv run python scratch/r2.py
```

```text
切成 ['inv', '202609', '0001', '格式']
[vector]
    0.4761  KB-technical-001#0 导入凭证和科目 / 模板  via=[]
    0.4597  KB-error-003#1   E2001 导入文件格式不支持 / 原因  via=[]
    0.4374  KB-billing-006#0 在哪里查看账单 / 位置  via=[]
[bm25]
   16.9691  KB-billing-006#0 在哪里查看账单 / 位置  via=[]
    3.8646  KB-plans-008#1   取消订阅后数据还在吗 / 导出  via=[]
    3.2084  KB-error-003#2   E2001 导入文件格式不支持 / 处理步骤  via=[]
[hybrid]
    0.0323  KB-billing-006#0 在哪里查看账单 / 位置  via=['vector', 'bm25']
    0.0315  KB-error-003#2   E2001 导入文件格式不支持 / 处理步骤  via=['vector', 'bm25']
    0.0164  KB-technical-001#0 导入凭证和科目 / 模板  via=['vector']

切成 ['它', '别', '再', '自动', '扣钱']
[vector]
    0.7233  KB-billing-002#0 如何关闭自动续费 / 操作  via=[]
    0.6836  KB-billing-004#0 被重复扣款怎么办 / 自动退回  via=[]
    0.6805  KB-billing-002#1 如何关闭自动续费 / 注意  via=[]
    0.6652  KB-billing-004#1 被重复扣款怎么办 / 人工处理  via=[]
[bm25]
    5.6310  KB-invoice-004#0 退款后发票怎么处理 / 规则  via=[]
    3.6180  KB-technical-009#1 凭证打印排版 / 调整  via=[]
    3.4495  KB-plans-007#1   专业版免费试用规则 / 试用结束  via=[]
    3.2701  KB-error-011#2   E5001 API 请求过于频繁 / 处理步骤  via=[]
[hybrid]
    0.0311  KB-billing-004#0 被重复扣款怎么办 / 自动退回  via=['vector', 'bm25']
    0.0308  KB-billing-001#0 自动续费什么时候扣款 / 扣款时间  via=['vector', 'bm25']
    0.0303  KB-billing-003#0 扣款失败怎么办 / 自动重试  via=['vector', 'bm25']
    0.0290  KB-billing-003#2 扣款失败怎么办 / 取消  via=['vector', 'bm25']
```

第二条问法里,向量把正确的 `KB-billing-002`(如何关闭自动续费)的「操作」块放第一(0.7233)。关键词那一路却完全不靠谱:切出来的词是 `它`、`别`、`再`、`自动`、`扣钱`,文章里没有「扣钱」,「自动」到处都有,最高分落在 `KB-invoice-004`(退款后发票怎么处理),跟问题毫无关系。RRF 合并时,向量的第 1 名 `KB-billing-002#0` 只有一路认可,得分 1/61 = 0.0164。而 `KB-billing-004#0` 在向量里第 2、关键词里第 7,`KB-billing-001#0` 两路都是第 5,`KB-billing-003#0` 两路都是第 6(我另外把两路的前 10 名都打印出来核对过),它们分数加起来是 0.0311、0.0308、0.0303,反而超过了向量的第一名。正确的文章 `KB-billing-002` 在合并后的文章名次里掉到了第 4。

这就是 RRF 的脾气:**它偏爱「两路都说还行」的块,不偏爱「一路特别肯定」的块。** 对字面问法这是优点(两路一起认可的,基本不会错);对口语问法,当关键词那一路本身就在胡说的时候,它会拖累向量。

还有一个数要和它对照着看:**前五名**。向量 52/52,混合 52/52,BM25 46/52。Agent 拿到的不是第一名,是前 5 块,模型会把 5 块都读一遍。从这个角度看,混合和向量一样,正确文章总在前 5 名里;BM25 单用才会漏。第一名的差距(49 对 48)只有 1 条,我只有 52 条问法,这点差距不能当结论。

所以今天我对混合检索的结论是这样的:

- **没有证据说混合比向量单用好。** 49 对 48,在 52 条问法里是噪声。
- **有证据说混合能兜住字面问法。** 12 对 10,而且 BM25 那一路是靠 `E4002` 这种编号找到的,这类问法的绝对数量客服场景下不会少。
- 所以 `search()` 默认用混合,理由是**保险**:字面问法一条不丢,口语问法在前 5 名里不丢。付出的代价是第一名偶尔被拖累。保不保险,要等 Day 451 用更大的问法集、按前 5 名的召回率再量一遍才算数。

查询耗时(`scratch/r3.py`,运行三次,数字稳定):

```text
建关键词索引:150 块,65 毫秒
BM25 一次查询:0.5 毫秒
向量一次查询(含 embedding 请求):309 毫秒
混合一次查询:155 毫秒
```

建索引 65 毫秒(150 块),BM25 一次查询 0.5 毫秒,可以忽略。向量一次查询 300 多毫秒,混合一次 155 毫秒左右,混合反而更快,是因为向量那次是进程里的第一个请求,多出来的一半时间是建立 HTTPS 连接,后面的请求复用了连接。我的判断是:真实的检索耗时约 150 毫秒,几乎全是 embedding 那一次网络请求,数据库查询和 BM25 都是毫秒级。

## 第七步:给检索写测试

检索的测试分三层:纯函数(不连库)、连库但用假 embedding(查数据库的 SQL 对不对)、连真库用真 embedding(只放几条冒烟)。新建 `tests/test_retriever.py`:

```python
# supportpilot/tests/test_retriever.py
"""检索测试:纯函数不连库;连库的用假 embedding 造几篇小文章;最后一个用真知识库和真 embedding。"""

from pathlib import Path

import psycopg
import pytest
from helpers import fake_embed, make_article
from psycopg.rows import DictRow

from supportpilot.kb import retriever
from supportpilot.kb.chunker import load_articles
from supportpilot.kb.ingest import ingest
from supportpilot.kb.retriever import rrf, search, tokenize

KB_DIR = Path(__file__).resolve().parent.parent / "data" / "kb"


def test_tokenize_uses_business_words_and_drops_stopwords():
    assert tokenize("月付能退钱吗") == ["月付", "退钱"]
    assert tokenize("E4002 是什么意思") == ["e4002", "意思"]


def test_rrf_matches_hand_calculation():
    vector = ["a", "b", "c"]
    keyword = ["b", "d"]
    got = dict(rrf([vector, keyword]))
    assert got["b"] == pytest.approx(1 / 62 + 1 / 61)
    assert got["a"] == pytest.approx(1 / 61)
    assert [k for k, _ in rrf([vector, keyword])][0] == "b"  # 两路都有的排第一


@pytest.fixture
def small_kb(
    clean: psycopg.Connection[DictRow], monkeypatch: pytest.MonkeyPatch
) -> psycopg.Connection[DictRow]:
    """库里放三篇小文章,查询时 embed_one 也换成假的。"""
    arts = [
        make_article("KB-t-001", "月付退款", {"规则": "月付订阅不支持退款,关闭自动续费即可。"}),
        make_article("KB-t-002", "报错 E4002", {"处理步骤": "税号校验失败时,核对统一社会信用代码。"}),
        make_article("KB-t-003", "导出数据", {"操作": "在设置里选择账套,导出为 xlsx。"}),
    ]
    ingest(clean, arts, fake_embed)
    monkeypatch.setattr(retriever, "embed_one", lambda text: fake_embed([text])[0])
    monkeypatch.setattr(retriever, "_index", None)
    return clean


@pytest.mark.db
def test_vector_search_finds_the_chunk_with_identical_text(small_kb: psycopg.Connection[DictRow]):
    hits = search(small_kb, "导出数据 > 操作\n在设置里选择账套,导出为 xlsx。", k=3, mode="vector")
    assert hits[0].doc_id == "KB-t-003"
    assert hits[0].score == pytest.approx(1.0, abs=1e-4)


@pytest.mark.db
def test_bm25_finds_literal_code_and_ignores_non_matches(small_kb: psycopg.Connection[DictRow]):
    hits = search(small_kb, "E4002", mode="bm25")
    assert [h.doc_id for h in hits] == ["KB-t-002"]
    assert search(small_kb, "完全无关的词汇", mode="bm25") == []


@pytest.mark.db
def test_hybrid_records_which_path_found_each_hit(small_kb: psycopg.Connection[DictRow]):
    # 向量那一路用假 embedding,对这句话没有任何语义;关键词那一路能命中 E4002
    hits = search(small_kb, "E4002", k=3)
    top = next(h for h in hits if h.doc_id == "KB-t-002")
    assert "bm25" in top.via
    assert all(h.via for h in hits)


@pytest.mark.db
def test_keyword_index_rebuilds_after_reingest(small_kb: psycopg.Connection[DictRow]):
    assert search(small_kb, "Webhook", mode="bm25") == []
    new = make_article("KB-t-004", "Webhook 通知", {"事件": "支持凭证创建和账单支付两类 Webhook 事件。"})
    fillers = [
        make_article(f"KB-t-00{i}", f"别的文章{i}", {"节": f"和上面都没关系的内容{i}。"}) for i in (5, 6)
    ]
    # 语料只有 1、2 块时,BM25 算出的 IDF 是负数或 0,什么都搜不到,所以凑够 3 块再测
    ingest(small_kb, [new, *fillers], fake_embed)  # 同时会把前面三篇当作「已删除」清掉
    assert [h.doc_id for h in search(small_kb, "Webhook", mode="bm25")] == ["KB-t-004"]
    assert search(small_kb, "E4002", mode="bm25") == []


@pytest.mark.db
@pytest.mark.llm
def test_real_kb_smoke(conn: psycopg.Connection[DictRow]):
    """真库、真 embedding:几个典型问题,正确文章要在前 3 名。要先 make kb。"""
    n = conn.execute("SELECT count(*) AS n FROM kb.docs").fetchone()
    if not n or n["n"] != len(load_articles(KB_DIR)):
        pytest.skip("库里还没有完整的知识库,先 make kb")
    cases = {
        "月付能退钱吗": "KB-refund-004",
        "E4002 是什么意思": "KB-error-010",
        "INV-202609-0001 是什么格式": "KB-billing-006",
        "怎么让别人的设备下线": "KB-account-007",
    }
    for query, doc_id in cases.items():
        assert doc_id in [h.doc_id for h in search(conn, query, k=3)], query
```

<div class="line-notes">

- `from helpers import fake_embed, make_article` Day 449 的小工具。
- `from supportpilot.kb import retriever` 要改模块里的 `embed_one` 和 `_index`,所以导入整个模块。
- `def test_tokenize_uses_business_words_and_drops_stopwords():` 钉住分词:`月付`、`退钱` 保住,「能」「吗」去掉;错误码转小写。
- `def test_rrf_matches_hand_calculation():` 手算验证:`b` 在第一路第 2 名、第二路第 1 名,得 1/62 + 1/61;`a` 只在第一路第 1 名,得 1/61。`pytest.approx` 比较浮点数。
- `assert [k for k, _ in rrf([vector, keyword])][0] == "b"  # 两路都有的排第一` 两路都认可的排在前面。
- `@pytest.fixture` 夹具 `small_kb`:库里放三篇小文章。
- `ingest(clean, arts, fake_embed)` 用 Day 449 的 `ingest()` 和假 embedding 把文章写进库。
- `monkeypatch.setattr(retriever, "embed_one", lambda text: fake_embed([text])[0])` 查询时的 `embed_one` 也换成假的,否则测试要联网。
- `monkeypatch.setattr(retriever, "_index", None)` 清掉模块级缓存。不清的话,上一个测试建的索引会被下一个测试复用,测试之间互相串。
- `def test_vector_search_finds_the_chunk_with_identical_text` 用和某一块 `embed_text` 一模一样的文本去查,假 embedding 对同样的文本给同样的向量,所以这一块相似度应该是 1,排第一。
- `assert hits[0].score == pytest.approx(1.0, abs=1e-4)` 这条验证 SQL 的 `1 - (a <=> b)` 算对了。
- `def test_bm25_finds_literal_code_and_ignores_non_matches` 搜 `E4002` 只命中那一篇;搜一个根本不存在的词,返回空列表。
- `def test_hybrid_records_which_path_found_each_hit` 混合模式下 `via` 记着是哪一路。向量那一路用的是假 embedding,对 `E4002` 没有语义;但三块里每块至少被某一路找到了。
- `assert "bm25" in top.via` `KB-t-002` 是靠 BM25 找到的。
- `def test_keyword_index_rebuilds_after_reingest` 第五步的行为:重新导入之后,索引能搜到新文章、搜不到被删的文章。
- `fillers = [` 两篇凑数的无关文章。
- `# 语料只有 1、2 块时,BM25 算出的 IDF 是负数或 0,什么都搜不到,所以凑够 3 块再测` 这是我写这条测试时真实踩到的坑:一开始只导入了一篇新文章,搜 `Webhook` 返回空,把我吓了一跳。BM25 的 IDF 公式在语料极小时会算出 0 或负数,所有块的分数都不大于 0,而 `KeywordIndex.search` 会把不大于 0 的丢掉,所以返回空。生产里 150 块不会遇到,测试里造小语料要小心。
- `@pytest.mark.llm` 这条测试要联网调 embedding,标成 `llm`,`make test` 不跑。
- `if not n or n["n"] != len(load_articles(KB_DIR)):` 库里的文章数和目录里的不一致就跳过,提示先 `make kb`。
- `assert doc_id in [h.doc_id for h in search(conn, query, k=3)], query` 四条典型问法,正确文章必须在前 3 名里。`, query` 让断言失败时把是哪条问法打出来。
</div>

```bash
uv run pytest tests/test_retriever.py -v
```

```text
tests/test_retriever.py::test_tokenize_uses_business_words_and_drops_stopwords PASSED [ 14%]
tests/test_retriever.py::test_rrf_matches_hand_calculation PASSED        [ 28%]
tests/test_retriever.py::test_vector_search_finds_the_chunk_with_identical_text PASSED [ 42%]
tests/test_retriever.py::test_bm25_finds_literal_code_and_ignores_non_matches PASSED [ 57%]
tests/test_retriever.py::test_hybrid_records_which_path_found_each_hit PASSED [ 71%]
tests/test_retriever.py::test_keyword_index_rebuilds_after_reingest PASSED [ 85%]
tests/test_retriever.py::test_real_kb_smoke PASSED                       [100%]
============================== 7 passed in 3.52s ===============================
```

7 条全过。再确认整个仓库的单元测试层和全部测试:

```bash
uv run pytest -m "not db and not llm" -q
uv run pytest -q
```

```text
24 passed, 9 deselected in 2.64s
33 passed in 4.42s
```

(这是我实验仓库里的数字,你的仓库里有 Day 441 到 446 的其他测试,总数会比这个多。)

今天结束时仓库多了:

```text
src/supportpilot/kb/retriever.py   Hit、tokenize、rrf、KeywordIndex、vector_search、search
scripts/kb_queries.py              52 条带标准答案的问法
scripts/compare_modes.py           三种模式对照
tests/test_retriever.py
```


## 动手练习

**练习 1:给 RRF 加权重。** 现在 RRF 对两路一视同仁。试试让向量那一路的权重大一点(分数乘 2、乘 3),看 52 条问法上第一名对几条。然后换一批你没拿来挑权重的问法再试,权重还管用吗?

<details><summary>参考答案</summary>

新建 `scratch/ex_weight_lib.py`,把 `rrf` 改成可以给每一路一个权重:

```python
# supportpilot/scratch/ex_weight_lib.py
from collections import defaultdict


def weighted_rrf(rankings: list[list[str]], weights: list[float], k: int = 60) -> list[str]:
    scores: dict[str, float] = defaultdict(float)
    for ranking, w in zip(rankings, weights, strict=True):
        for rank, key in enumerate(ranking, start=1):
            scores[key] += w / (k + rank)
    return [key for key, _ in sorted(scores.items(), key=lambda kv: -kv[1])]
```

<div class="line-notes">

- `def weighted_rrf(rankings: list[list[str]], weights: list[float], k: int = 60) -> list[str]:` 比 `rrf` 多一个 `weights` 参数,每一路一个。返回值只留块编号,这里不需要分数。
- `for ranking, w in zip(rankings, weights, strict=True):` 把每一路的排名和它的权重配对。`strict=True` 防止两个列表长度不一致。
- `scores[key] += w / (k + rank)` 原来是 `1 / (k + rank)`,现在乘上这一路的权重。
- `return [key for key, _ in sorted(scores.items(), key=lambda kv: -kv[1])]` 按总分排,只返回编号。
</div>

`scratch/ex_weight.py` 先把两路的结果缓存起来(embedding 只调一次),再对每个权重重新合并:

```python
# supportpilot/scratch/ex_weight.py
"""练习:给 RRF 加权重。向量那一路权重 w,关键词那一路权重 1。"""

import sys

sys.path.insert(0, "scripts")
sys.path.insert(0, "scratch")
from ex_weight_lib import weighted_rrf  # noqa: E402
from kb_queries import QUERIES  # noqa: E402

from supportpilot.db import connect  # noqa: E402
from supportpilot.kb.retriever import keyword_index, vector_search  # noqa: E402

with connect() as conn:
    cache = [(vector_search(conn, q), keyword_index(conn).search(q), gold) for q, gold in QUERIES]
for w in (1, 1.5, 2, 3):
    ranks: list[int] = []
    for vec, kw, gold in cache:
        keys = weighted_rrf([[h.key for h in vec], [h.key for h in kw]], [w, 1])
        docs: list[str] = []
        for key in keys:
            d = key.split("#")[0]
            if d not in docs:
                docs.append(d)
        ranks.append(next((r for r, d in enumerate(docs, 1) if d in gold), 99))
    sem, lit = ranks[:40], ranks[40:]
    print(f"向量权重 {w}: 口语 {sum(r == 1 for r in sem)}/40  字面 {sum(r == 1 for r in lit)}/12")
```

<div class="line-notes">

- `sys.path.insert(0, "scripts")` 让脚本能 `import kb_queries`。`# noqa: E402` 告诉 ruff 导入没放在文件最前面是故意的。
- `cache = [(vector_search(conn, q), keyword_index(conn).search(q), gold) for q, gold in QUERIES]` 每条问法两路各查一次,存起来。后面换权重不用再调接口。
- `for w in (1, 1.5, 2, 3):` 向量那一路的权重,BM25 那一路固定是 1。`w = 1` 就是现在的 `rrf`。
- `keys = weighted_rrf([[h.key for h in vec], [h.key for h in kw]], [w, 1])` 合并。
- `d = key.split("#")[0]` 块编号 `KB-refund-004#0` 按 `#` 切开,取前面的文章编号。
- `sem, lit = ranks[:40], ranks[40:]` 口语和字面两组。
- `print(f"向量权重 {w}: 口语 {sum(r == 1 for r in sem)}/40  字面 {sum(r == 1 for r in lit)}/12")` 每个权重下两组各对几条。
</div>

```text
向量权重 1: 口语 36/40  字面 12/12
向量权重 1.5: 口语 36/40  字面 12/12
向量权重 2: 口语 38/40  字面 12/12
向量权重 3: 口语 38/40  字面 12/12
```

权重 1(就是现在的做法)口语 36/40,权重 2 或 3 变成 38/40,字面 12/12 不受影响。合计 50/52,比原来的 48 好,还略高于纯向量的 49。看起来加权是个好办法。可是**这个权重是我在这 52 条问法上挑出来的**,挑的人和评的人是同一批数据,难免偏乐观。换一批问法验证,这批是下面练习 4 里模型写的 62 条(`scratch/ex_weight2.py`,和上面几乎一样,只是读 `gen_queries.json`,标准答案只有一篇):

```text
向量权重 1: 第一名 40/62  前五名 60/62
向量权重 2: 第一名 40/62  前五名 60/62
向量权重 3: 第一名 42/62  前五名 60/62
向量权重 5: 第一名 43/62  前五名 60/62
```

在新的这批问法上,权重从 1 加到 5,第一名从 40 条升到 43 条,有帮助,但仍然追不上纯向量的 48 条(练习 4 的数字)。前五名一直是 60/62,不动。所以:加权有一点用,没有第一批数据显示的那么神;权重要不要调,得看你更在乎第一名还是前五名。我没有把权重写进 `search()`:证据不够硬,而且 Day 236 的 `rrf()` 签名我想保持原样。Day 451 有了正式基线再决定。

</details>

**练习 2:业务词典有没有用?** 把 `retriever.py` 里的业务词典拿掉(用一个没加过词的 jieba 分词器),关键词那一路会差多少?

<details><summary>参考答案</summary>

```python
# supportpilot/scratch/ex_dict.py
"""练习:不加业务词典,关键词那一路会差多少?"""

import sys

import jieba

sys.path.insert(0, "scripts")
from compare_modes import doc_rank  # noqa: E402
from kb_queries import QUERIES  # noqa: E402

from supportpilot.db import connect  # noqa: E402
from supportpilot.kb import retriever  # noqa: E402


def run(label: str) -> None:
    retriever._index = None  # 换了分词器,索引要重建
    with connect() as conn:
        ranks = [doc_rank(conn, q, gold, "bm25") for q, gold in QUERIES]
    n = len(ranks)
    print(f"{label}: 第一名对 {sum(r == 1 for r in ranks)}/{n}  前十名里有 {sum(r < 99 for r in ranks)}/{n}")


run("有业务词典")
retriever.jieba = jieba.Tokenizer()  # 一个干净的分词器:没加过任何业务词
print(retriever.tokenize("月付能退钱吗"), retriever.tokenize("企业版年付"))
run("没有业务词典")
```

<div class="line-notes">

- `import jieba` 要新建一个干净的分词器。
- `from compare_modes import doc_rank` 复用对照脚本里算名次的函数,`scripts/` 已经在导入路径里。
- `retriever._index = None  # 换了分词器,索引要重建` 模块级缓存清掉,不然会沿用旧索引。下划线开头的名字本来是「内部用」,测试和实验里偶尔这样碰一下。
- `ranks = [doc_rank(conn, q, gold, "bm25") for q, gold in QUERIES]` 只测 BM25 这一路。
- `retriever.jieba = jieba.Tokenizer()  # 一个干净的分词器` `jieba.Tokenizer()` 新建一个自己带词典副本的分词器,里面没有 `BUSINESS_WORDS`。把 `retriever` 模块里的 `jieba` 整个换成它,`tokenize()` 就改用它切词了。
- `print(retriever.tokenize("月付能退钱吗"), retriever.tokenize("企业版年付"))` 先看切词有什么不同。
</div>

```text
有业务词典: 第一名对 43/52  前十名里有 47/52
['月', '付能', '退钱'] ['企业', '版年付']
没有业务词典: 第一名对 43/52  前十名里有 48/52
```

切词确实变了:`月付能退钱吗` 变成 `['月', '付能', '退钱']`,`企业版年付` 变成 `['企业', '版年付']`,业务词被切碎。可是排名几乎没变:第一名都是 43 条,前十名 47 对 48(没有词典反而多找到 1 条)。**这批问法上,词典的作用小到被噪声盖住了。** 我没能查出确切原因。猜测是:块里的帽子和正文里同一个词会多次出现,即使被切碎,切碎的片段(`企业`、`月`)在文章里照样能匹配上,而且 52 条问法里依赖业务词的并不多。能确定的只有一点:不要想当然。我原来以为这是 BM25 能不能用的关键,实测差别没有显现。词典留着,因为加词典几乎没有成本,而且分词更干净对以后评测排查更友好;但我不会再说「业务词典很关键」,除非换一批问法量出差别。

</details>

**练习 3:关键词的索引里,帽子有用吗?** 现在 `KeywordIndex` 索引的文本是「帽子 + 原文」。如果只索引原文,BM25 会差多少?

<details><summary>参考答案</summary>

```python
# supportpilot/scratch/ex_nohat.py
"""练习:关键词那一路的索引文本里,帽子有没有用?"""

import sys

sys.path.insert(0, "scripts")
from compare_modes import SEMANTIC, doc_rank  # noqa: E402
from kb_queries import QUERIES  # noqa: E402

from supportpilot.db import connect  # noqa: E402
from supportpilot.kb import retriever  # noqa: E402


def run(label: str) -> None:
    retriever._index = None  # 换了索引文本,要重建
    with connect() as conn:
        ranks = [doc_rank(conn, q, gold, "bm25") for q, gold in QUERIES]
    sem, lit = ranks[:SEMANTIC], ranks[SEMANTIC:]
    print(f"{label}: 口语 {sum(r == 1 for r in sem)}/{len(sem)}  字面 {sum(r == 1 for r in lit)}/{len(lit)}")


run("索引带帽子")
retriever.make_hat = lambda title, heading: ""  # 索引里不放标题和小标题
run("索引不带帽子")
```

<div class="line-notes">

- `from compare_modes import SEMANTIC, doc_rank` 复用分组界线和算名次的函数。
- `retriever._index = None  # 换了索引文本,要重建` 缓存清掉。
- `sem, lit = ranks[:SEMANTIC], ranks[SEMANTIC:]` 口语和字面分开数。
- `retriever.make_hat = lambda title, heading: ""  # 索引里不放标题和小标题` `KeywordIndex` 建索引时调的是模块里的 `make_hat`,换成总是返回空串的函数,索引里就只剩原文了(`f"{make_hat(...)}\n{h.text}"` 前面多一个空行,切词时会被丢掉)。
</div>

```text
索引带帽子: 口语 31/40  字面 12/12
索引不带帽子: 口语 26/40  字面 12/12
```

口语问法从 31 条降到 26 条,字面问法 12/12 不变。**帽子对关键词检索也有用,而且作用和对向量一样:给孤零零的短块补上主题。** 字面问法(错误码、编号)本来在原文里就有,所以不依赖帽子。这也是为什么索引的文本要和向量化的文本用同一个 `make_hat()`,而不是各写各的。

</details>

**练习 4:换一批不是我写的问法。** 前面的 52 条问法都是我写的,而且写的时候看过文章,难免偏。让 `deepseek-flash` 扮演「没读过帮助文档的客户」,给每篇文章写一句口语问法(标准答案就是它依据的那一篇),用这 62 条把三种检索再比一遍。结论变了吗?(调模型 62 次,约 ¥0.02。)

<details><summary>参考答案</summary>

```python
# supportpilot/scratch/gen_queries.py
"""让模型扮演客户,给每篇文章写一句口语问法。问法归模型写,不归我写,少一点偏袒。"""

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from supportpilot.kb.chunker import Article, load_articles
from supportpilot.llm import LLMClient

PROMPT = """你是一家在线记账软件的普通用户,没读过任何帮助文档。
下面这篇帮助中心文章能回答你遇到的一个问题。请写出你会怎么向客服问这个问题。
要求:一句话,口语,不超过 25 个字;不要照抄文章标题里的词;只输出这句话。

<文章>
{body}
</文章>"""

llm = LLMClient()
articles = load_articles(Path("data/kb"))


def ask(a: Article) -> dict[str, str]:
    r = llm.chat([{"role": "user", "content": PROMPT.format(body=a.body)}], temperature=0.7, max_tokens=60)
    return {"query": r.content.strip().strip("「」\"'"), "doc_id": a.id}


with ThreadPoolExecutor(6) as pool:
    rows = list(pool.map(ask, articles))
Path("scratch/gen_queries.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
print(len(rows), "条", llm.ledger)
for r in rows[:6]:
    print(r["doc_id"], r["query"])
```

<div class="line-notes">

- `PROMPT = """你是一家在线记账软件的普通用户,没读过任何帮助文档。` 角色:扮演不懂行的客户。
- `要求:一句话,口语,不超过 25 个字;不要照抄文章标题里的词;只输出这句话。` 约束:避免模型把标题直接抄成问法。
- `articles = load_articles(Path("data/kb"))` 62 篇文章。
- `def ask(a: Article) -> dict[str, str]:` 给一篇文章要一句问法。
- `r = llm.chat([{"role": "user", "content": PROMPT.format(body=a.body)}], temperature=0.7, max_tokens=60)` `temperature=0.7` 让问法有点变化,最多 60 个 token。
- `return {"query": r.content.strip().strip("「」\"'"), "doc_id": a.id}` 去掉模型偶尔加的引号,配上文章编号。
- `rows = list(pool.map(ask, articles))` 6 个线程并发,按原来的顺序返回。
- `Path("scratch/gen_queries.json").write_text(` 存起来,以后重复评测不用重新生成。
</div>

```text
62 条 62 次调用 | 输入 9357 / 输出 658 tokens | 约 ¥0.0240
KB-account-001 登录时验证码一直没收到，咋办？
KB-account-002 旧手机号停用了，怎么换绑新号？
KB-account-003 登录密码忘了咋办？
KB-account-004 我怎么给同事开个只能看不能改的账号?
KB-account-005 换手机后登录要输的六位动态码在哪弄？
KB-account-006 我想销号，但提示有没付的账单，怎么办？
```

62 条,62 次调用,输入 9,357、输出 658 个 token,约 ¥0.024(9,357 × 2 + 658 × 8 = 23,978,除以一百万)。问法读起来确实像普通人说的话(「咋办」「啥时候」),标题里的词基本没出现。然后 `scratch/ex_gen.py` 把三种模式各跑一遍,混合模式下把没排第一的也列出来:

```python
# supportpilot/scratch/ex_gen.py
"""用模型写的 62 条问法,再比一次三种检索。标准答案只有它依据的那一篇,比前面严。"""

import json
import sys
from pathlib import Path

sys.path.insert(0, "scripts")
from compare_modes import doc_rank  # noqa: E402

from supportpilot.db import connect  # noqa: E402
from supportpilot.kb.retriever import Mode  # noqa: E402

rows = json.loads(Path("scratch/gen_queries.json").read_text(encoding="utf-8"))
modes: list[Mode] = ["vector", "bm25", "hybrid"]
with connect() as conn:
    for mode in modes:
        ranks = [doc_rank(conn, r["query"], {r["doc_id"]}, mode) for r in rows]
        n = len(ranks)
        top1, top5 = sum(x == 1 for x in ranks), sum(x <= 5 for x in ranks)
        print(f"{mode:7} 第一名 {top1}/{n}  前五名 {top5}/{n}")
        if mode == "hybrid":
            for r, x in zip(rows, ranks, strict=True):
                if x > 1:
                    print(f"    第 {x if x < 99 else '-'} 名 {r['doc_id']:16} {r['query']}")
```

<div class="line-notes">

- `rows = json.loads(Path("scratch/gen_queries.json").read_text(encoding="utf-8"))` 读上一步生成的 62 条。
- `ranks = [doc_rank(conn, r["query"], {r["doc_id"]}, mode) for r in rows]` 标准答案是只有一篇文章的集合。有些问法其实别的文章也能回答(「验证码」既在账号篇也在报错篇),只算依据的那一篇,是更严的判分。
- `top1, top5 = sum(x == 1 for x in ranks), sum(x <= 5 for x in ranks)` 第一名和前五名各几条。
- `if mode == "hybrid":` 只在混合模式下列出没排第一的,看它错在哪。
</div>

```text
vector  第一名 48/62  前五名 59/62
bm25    第一名 27/62  前五名 44/62
hybrid  第一名 40/62  前五名 60/62
    第 3 名 KB-account-001   登录时验证码一直没收到，咋办？
    第 2 名 KB-account-006   我想销号，但提示有没付的账单，怎么办？
    第 2 名 KB-api-001       免费版是不是不能用接口啊？
    第 - 名 KB-api-002       我记账时总提示请求太频繁被拒，咋回事？
    第 5 名 KB-api-004       我设置的通知如果没收到，会再发几次啊？
    第 3 名 KB-billing-001   续费的钱一般提前多久扣啊？
    第 5 名 KB-billing-002   我每个月被自动扣钱，在哪能关掉啊？
    第 4 名 KB-billing-005   我能用公司的账户打钱买这个吗？
    第 - 名 KB-billing-007   多买的人当天就扣钱，少买的为啥要等下个月？
    第 2 名 KB-error-012     我这提示E5002，是不是密钥过期了？
    第 4 名 KB-invoice-004   钱退了一部分，之前开的票还能用吗？
    第 2 名 KB-invoice-007   发票开好了，能换个邮箱收吗？
    第 3 名 KB-plans-001     最便宜那档能自动同步银行流水吗？
    第 2 名 KB-plans-002     买长期的和买短期的，哪个更划算、能退吗？
    第 2 名 KB-plans-008     我不续费了，之前记的账还能找回来吗？
    第 3 名 KB-refund-002    第一次买年费刚几天能全退吗？
    第 2 名 KB-refund-005    我退的钱啥时候能回来啊？
    第 3 名 KB-technical-001 我导入表格时提示E2002是咋回事？
    第 2 名 KB-technical-002 我咋把账本里的数据导出来啊？
    第 3 名 KB-technical-003 免费版能连银行自动记账吗？
    第 2 名 KB-technical-004 免费版能建几个账本啊？
    第 5 名 KB-technical-008 免费版能用外币记账吗？
```

这批问法上,**第一名:向量 48/62,混合 40/62,BM25 27/62**。前五名:向量 59,混合 60,BM25 44。结论比第六步更清楚:

- **混合的第一名比向量差了 8 条**,比第一批 52 条问法里的差距(1 条)大得多。原因是这批全是口语问法,正是 BM25 那一路最没用的类型,它加进来的是噪声。
- **前五名两者几乎一样**(60 对 59),正确文章总在前 5 块里。Agent 把 5 块都读一遍,所以对 SupportPilot 来说两者差不多。
- 标准答案严了(只算一篇),所以绝对数字比第一批低,不同批次之间的数不能直接比。

所以我对默认值的态度是**保守**的:SupportPilot 默认混合,是因为它给模型 5 块,前 5 名两者一样,混合额外多一层字面问法的保险;如果你的下游只取第一块(比如直接回答「是不是」),纯向量更好。这是一个可以换的开关(`mode=` 参数),不是信仰。Day 451 做正式检索基线时,会用第三批问法再量一遍。

顺便:列出来的混合没排第一的 22 条里,有些其实也答得上,比如「登录时验证码一直没收到」排第 3 的可能是报错码 E1001 那篇(验证码已过期),同样有用。严格的单篇标准答案会低估所有模式。

</details>

**验收标准:** `scripts/compare_modes.py` 能打出三种模式的汇总(你的数字和我的差 1 到 2 条属于正常);`pytest tests/test_retriever.py` 全绿;你能不看稿说出:RRF 为什么只看名次不看分数,以及为什么我不敢说混合一定比向量好。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 混合检索(hybrid search) | 同时用向量检索和关键词检索,把两份排名合并。 |
| 余弦距离 `<=>` | pgvector 的运算符,等于 1 减去余弦相似度,越小越像。`ORDER BY embedding <=> 查询向量` 就是按相似度从高到低排。 |
| BM25 | 关键词检索的打分公式:词在这块里出现得越多越高,在全部块里出现得越普遍越低,块越长打折。 |
| 倒数名次融合(RRF) | 每一路里排第 r 名得 1/(k+r) 分,各路加起来,按总分排。只看名次,不看原始分数。 |
| 召回(recall) | 正确答案有没有被找回来。「前五名里有」就是 top-5 召回。 |
| MRR | 平均倒数排名:正确答案名次的倒数的平均。排第一得 1,排第二得 0.5,没找到得 0。 |
| 字面问法 | 问法里的关键词本身就是答案线索,比如错误码、编号、专有名词。关键词检索擅长这类。 |
| 口语问法 | 客户用自己的话问,用词和文章不重合,比如「被收了两次钱」对「重复扣款」。向量检索擅长这类。 |
| 版本戳(stamp) | 一个能反映「库里的块有没有变」的小标记。这里是块数加最大编号。 |
| 假阳性/噪声 | 某一路为了凑数而返回的、其实不相关的结果。RRF 把两路混在一起,噪声也会混进去。 |

## 常见误区

**把混合检索当成一定更好的默认选项。** 很多教程这么讲,我也在 Day 236 讲过它的好处。今天在自己的数据上量了两次:第一批 52 条问法,混合比向量少 1 条;第二批 62 条模型写的口语问法,少 8 条。它的价值在字面问法的保险和前五名的召回,不是第一名的精度。要不要用,看你的问法分布和下游怎么用结果。

**直接比较不同模式的分数。** 向量的 0.79、BM25 的 5.21 和 16.97、RRF 的 0.0325,量纲完全不同。比较只能在同一种模式的同一次查询里做。`Hit.score` 在三种模式下含义不一样。

**拿自己写的问法下结论。** 我第一批 52 条问法是看着文章写的,带标题的帽子和这批问法天然合拍。换成模型扮演客户写的问法,结果就变了。评测集尽量让没看过答案的人(或者模型)来写。

**在测试里用太小的语料测 BM25。** 语料只有 1 或 2 块时,所有分数都不大于 0,什么都搜不到。这不是代码 bug,是公式的性质。造测试数据凑够 3 块以上。

**让索引和库脱节。** 把块读进内存建索引很方便,但库一变索引就是旧的。没有版本戳的话,重新导入以后关键词那一路还在搜旧文章,而向量那一路搜新的,两路对不上,排查起来很折磨。

**以为 `k=5` 就是每一路取 5 条。** 每一路先取 10 条(`FETCH = 10`),合并后才取前 5。每一路只取 5 条的话,两路可能一条重叠都没有,RRF 就没有「两路都认可」可言。

## 学习资料

### 文档与文章

- [Elastic · Reciprocal rank fusion](https://www.elastic.co/guide/en/elasticsearch/reference/current/rrf.html):官方文档里的 RRF 一页,里面的 `rank_constant`(就是今天的 `RRF_K`)和 `rank_window_size`(就是今天的 `FETCH`)能和代码一一对上。
- [Elastic Search Labs · Linear retriever for hybrid search](https://www.elastic.co/search-labs/blog/linear-retriever-hybrid-search):讲 RRF 只看名次的局限,以及加权的线性融合怎么补,对应练习 1。
- [OpenSearch · Hybrid search](https://opensearch.org/docs/latest/search-plugins/hybrid-search/):另一家搜索引擎怎么做混合检索,对比 Elastic 的做法。
- [rank_bm25 · GitHub](https://github.com/dorianbrown/rank_bm25):今天用的库,README 里有 `BM25Okapi` 的最小例子;想知道语料很小时 IDF 为什么会是 0 或负数,看 `BM25Okapi` 的源码。
- [jieba · GitHub](https://github.com/fxsjy/jieba):中文分词库,看「添加自定义词典」「调整词典」两节。
- [pgvector 官方 README](https://github.com/pgvector/pgvector):搜 `Distance`,看 `<->`、`<#>`、`<=>` 三个运算符各是什么距离。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1kndSB7Emx&autoplay=0&high_quality=1" title="混合检索(相似度+BM25)、RRF融合、Cross-Encoder精排序" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>_叶落秋白 · 混合检索(相似度+BM25)、RRF融合、Cross-Encoder精排序 · 约 3 分钟,短,把今天的三步和 Day 238 的精排放在一起过一遍,先看这个建立整体印象。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1qqpuzbELr&autoplay=0&high_quality=1" title="【小白教程】手把手教你实现RAG多路召回!向量检索+BM25+语义路由" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>写代码的阿咪 · 【小白教程】手把手教你实现RAG多路召回 · 约 17 分钟,带代码的多路召回演示,和今天的 `search()` 思路一致。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/XvKiTfd6Xvo" title="The Complete Guide to Hybrid Search in RAG (BM25 + Embeddings + Reranker)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Dave Ebbelaar · The Complete Guide to Hybrid Search in RAG (BM25 + Embeddings + Reranker) · 英文,把混合检索和重排序连起来讲。我只验证了标题和作者,没有逐分钟看完。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/kT7nXO32L-Q" title="PostgreSQL Hybrid Search Course – Keyword (BM25) + Vector Retrieval" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>freeCodeCamp.org · PostgreSQL Hybrid Search Course – Keyword (BM25) + Vector Retrieval · 英文课程,就是在 Postgres 里同时做关键词和向量检索,和我们的技术栈对口。我只验证了标题和作者,时间较长,挑融合那一段看。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):检索系统那一章里讨论了混合检索和重排序,适合读完今天后连起来看。
- Manning、Raghavan、Schütze《Introduction to Information Retrieval》(Cambridge University Press,2008):信息检索经典教材,作者网站有免费全文,第 6 章讲词权重和 TF-IDF,第 11 章讲概率模型和 BM25。按书名搜索即可。

### 开源项目与代码

- [pgvector/pgvector-python](https://github.com/pgvector/pgvector-python):仓库的 examples 里有「混合搜索」的示例,用 Postgres 自带全文检索加向量检索,再用 RRF 合并,对照今天的做法看。
- [dorianbrown/rank_bm25](https://github.com/dorianbrown/rank_bm25):今天用的库,代码只有一个文件,`BM25Okapi.get_scores` 里那个循环就是公式的实现。

## 自测

**1. RRF 为什么只看名次、不看原始分数?**

<details><summary>答案</summary>

两路的分数不是同一个量纲:向量相似度在 0 到 1 之间,BM25 分数可以是 5 也可以是 17,直接相加没有意义;换成归一化也要对分布做假设。名次是现成的、可比的,第 1 名就是第 1 名。代价是丢掉了「第 1 名比第 2 名强多少」这个信息,所以才有后来的加权融合。

</details>

**2. 为什么每一路先取 10 条,而不是只取最终要的 5 条?**

<details><summary>答案</summary>

只取 5 条的话,两路的前 5 名可能一条重叠都没有,那 RRF 里每一块都只有一路认可,没法体现「两路都认可的排前面」。多取一些(10 条),重叠的机会多,融合才有意义;最终再截成 5 条给模型。

</details>

**3. 今天的实测里,混合检索相对纯向量,到底赢在哪、输在哪?**

<details><summary>答案</summary>

赢在字面问法(错误码、编号、专有名词):混合 12/12,向量 10/12,BM25 那一路能把没语义的编号找回来。输在口语问法的第一名:第一批 52 条里混合 36/40 对向量 39/40,模型写的 62 条里混合第一名 40 对向量 48。原因是关键词那一路在口语问法上没有可用的词,返回的是噪声,而 RRF 偏爱「两路都沾边」的块,会把向量的第一名挤下去。前五名两者几乎一样(都是 52/52、60 对 59)。

</details>

**4. `KeywordIndex` 为什么要先记版本号再读数据,而不是反过来?**

<details><summary>答案</summary>

先记版本号再读:如果读数据的过程中库被改了,索引拿到的数据比版本号新或相等,下次发现版本号对不上就会重建,最坏是多重建一次。反过来,先读数据再记版本号:数据可能是旧的,版本号却是新的,以后一直对得上,索引永远不会重建,搜到的就是过期的内容。

</details>

**5. (面试题)你们的 RAG 为什么用混合检索?怎么证明它比单用向量检索更好?**

<details><summary>答案</summary>

理由是两路互补:向量处理口语改写(「被收了两次钱」对「重复扣款」),关键词处理字面词(错误码、编号、产品名),RRF 按名次合并不需要对齐分数。证明要靠评测:准备带标准答案的问法集,按问法类型分组(口语、字面)分别量第一名命中率和前 k 名召回,而不是只看总数。还要注意问法集不能只由做系统的人写;并且汇报时说清楚指标:混合通常保住前 k 名召回、对字面问法有保险,但第一名精度不一定提升,甚至可能下降。如果数据显示没有提升,诚实地说,并说明保留它的理由(兜底、成本低),而不是硬说更好。

</details>

**6. BM25 在只有 1 块或 2 块的小语料里搜不到任何东西,为什么?这说明了什么?**

<details><summary>答案</summary>

BM25 里每个词的 IDF 是「这个词在全部文档里有多稀有」。只有 1 块时,每个词都出现在 100% 的块里,IDF 为负;只有 2 块、一个词只在 1 块里时 IDF 恰好为 0。分数乘上 IDF,全部不大于 0,被「只保留分数大于 0」的过滤丢掉。这说明 BM25 的打分依赖语料的统计,小到一定程度,公式本身就不成立。测试里造小语料时要凑够几块。

</details>

## 明天预告

明天是 Day 451 · 知识库(四):引用和检索基线。今天的 `search()` 返回的 `Hit` 里已经有文章编号、标题和链接,明天用它们做两件事。一是引用:回复里每个事实后面标 `[1]`、`[2]`,并且写一个检查函数,抓出模型编造的编号,再把编号渲染成客户点得开的链接。二是把今天零散的对照整理成一份检索基线,固定下来以后每次改检索都对比。到时候今天那个「混合不一定更好」的结论会用更大的一批问法再检验一遍。
