---
title: 'Day 449 · 知识库(二):向量化和增量导入'
description: '把 embedding 写成 SupportPilot 里的正式模块,再写 ingest():一篇文章一个事务,指纹没变就跳过,变了只重做这一篇,目录里没了就从库里删。跑出新增、跳过、更新、删除四种情况的真实输出,当场抓出「改了帽子写法旧向量却被跳过」的坑,把指纹改成算在真正写进库的东西上。'
pubDate: 2026-10-27
regime: none
tags: ['capstone', 'supportpilot', 'rag', 'pgvector', 'embedding', 'agent-zero']
series: 'agent-zero'
day: 449
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 448](/blog/agent-zero/day-448-kb-chunk/) 写了 `kb/chunker.py`:62 篇帮助中心文章切成 150 块,每块有原文 `text`,还有一份送去向量化的 `embed_text`(原文前面戴一顶「文章标题 > 小标题」的帽子)。40 条问法的对照里,戴帽子比不戴多对 5 条。不过那些块都还在内存里,脚本一结束就没了。

今天让它们住进数据库:先把 embedding 写成项目里的正式模块,再写导入脚本,把 150 块连同向量写进 [Day 443](/blog/agent-zero/day-443-database/) 建好的 `kb.docs` 和 `kb.chunks`。这个脚本以后每次知识库改动都要跑,所以重点不在「写进去」,在「增量」:没改的文章别重做,改了的只做那一篇,做到一半出错不能留下半篇。

## 今天要解决的问题

今天的新东西是两个:**内容指纹**(判断一篇文章变没变),和**一篇一个事务**(写库要么整篇成功,要么库保持原样)。学完你应该能:

1. 写出 `src/supportpilot/kb/embed.py`,接口和 [Day 217](/blog/agent-zero/day-217-embed-service/) 的 `common/embed.py` 一样,并说出两处不同。
2. 写出 `kb/ingest.py` 和 `scripts/ingest_kb.py`,跑出新增、跳过、更新、删除四种情况的真实计数,以及第一次全量导入的请求数、token 数和用时。
3. 说清为什么指纹只算正文不够,会让「改了帽子的写法」这类改动被悄悄跳过;并把指纹改对。

预计用时 3 小时。花费:¥0(硅基流动的 bge-m3 免费,整个知识库一遍只有 6,222 个 token)。前置:[Day 217](/blog/agent-zero/day-217-embed-service/) 的 embedding、[Day 231](/blog/agent-zero/day-231-pgvector-2/) 的指纹和事务、[Day 91](/blog/agent-zero/day-091-sql-6/) 的事务、[Day 443](/blog/agent-zero/day-443-database/) 的 `db.py` 和表、[Day 448](/blog/agent-zero/day-448-kb-chunk/) 的 `chunker.py`、[Day 73](/blog/agent-zero/day-073-pytest-3/) 的 fixture 和 [Day 74](/blog/agent-zero/day-074-pytest-4/) 的 monkeypatch。

学法照旧:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `ingest()` 和 `write_article()` 默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先从前端看:这就是构建缓存

Vite、webpack 有一套缓存:一个模块的内容没变,就不重新编译;变了才编。判断「变没变」的办法不是看文件的修改时间,而是算内容的哈希。今天的导入就是同一个思路:文章没改,就不重新切块、不重新调 embedding,调接口是要时间的(62 次请求花了 8 到 12 秒),知识库越大越慢。

事务就像一次部署:新版本的所有文件要么全部上线,要么回滚到上一版,不会出现「页面是新的、脚本是旧的」的半截状态。一篇文章在库里是 1 行 `kb.docs` 加几行 `kb.chunks`,更新它要先删旧的再写新的,中间任何一步失败,都不能留下一篇只有一半块的文章。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="增量导入流程:读目录里的文章,切块并算指纹,和库里的指纹比,没变就跳过,变了就向量化再在一个事务里删旧写新,库里有目录里没有的就删除">
<g font-family="var(--font-mono)" font-size="11">
<rect x="10" y="90" width="100" height="50" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="60" y="112" text-anchor="middle" fill="var(--ink)">data/kb/*.md</text>
<text x="60" y="128" text-anchor="middle" fill="var(--ink-soft)">62 篇</text>
<rect x="140" y="90" width="110" height="50" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="195" y="112" text-anchor="middle" fill="var(--ink)">切块 + 算指纹</text>
<text x="195" y="128" text-anchor="middle" fill="var(--ink-soft)">和库里的比</text>
<rect x="290" y="20" width="130" height="40" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="355" y="45" text-anchor="middle" fill="var(--ink-soft)">一样 → 跳过</text>
<rect x="290" y="90" width="130" height="50" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="355" y="112" text-anchor="middle" fill="var(--ink)">不一样 → embedding</text>
<text x="355" y="128" text-anchor="middle" fill="var(--ink-soft)">先调接口,再碰库</text>
<rect x="455" y="90" width="175" height="50" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="542" y="112" text-anchor="middle" fill="var(--ink)">一个事务:删旧 + 写新</text>
<text x="542" y="128" text-anchor="middle" fill="var(--ink-soft)">失败就整篇回滚</text>
<rect x="290" y="180" width="130" height="40" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="355" y="205" text-anchor="middle" fill="var(--ink-soft)">目录里没了 → 删</text>
</g>
<g stroke="var(--ink-faint)" stroke-width="1.3">
<line x1="110" y1="115" x2="138" y2="115"/><line x1="250" y1="100" x2="288" y2="45"/>
<line x1="250" y1="115" x2="288" y2="115"/><line x1="250" y1="130" x2="288" y2="200"/>
<line x1="420" y1="115" x2="453" y2="115"/>
</g>
</svg>
<figcaption>embedding 在事务外面做。网络请求慢又可能失败,放进事务里会让数据库连接一直占着;先把向量拿到手,再进事务,事务里只剩几条很快的 SQL。</figcaption>
</figure>

## 第一步:把 embedding 写成项目里的模块

Day 448 的对照实验里,embedding 是在脚本里现写了一个十几行的 `embed()`。现在把它正式写进项目。接口你在 Day 217 见过:`embed(texts)` 一批文本变成 `(N, 1024)` 的数组,`embed_one(text)` 处理单条,`cosine(a, b)` 算相似度,`usage` 字典记账。**名字、参数、返回值全部沿用**,以后第四部分学的东西搬过来,`from ... import embed` 的写法不变。新建 `src/supportpilot/kb/embed.py`:

```python
# supportpilot/src/supportpilot/kb/embed.py
"""embedding 封装。接口和练习仓库 Day 217 的 common/embed.py 一样:embed、embed_one、cosine、usage。"""

from functools import lru_cache

import numpy as np
from openai import OpenAI

from ..config import get_settings

BATCH = 10  # 硅基流动 bge-m3 一次最多送 10 条以内最稳,和 Day 217 一致

usage = {"requests": 0, "tokens": 0}


@lru_cache
def _client() -> OpenAI:
    s = get_settings()
    return OpenAI(base_url=s.emb_base_url, api_key=s.emb_api_key.get_secret_value(), max_retries=3)


def _clean(text: str) -> str:
    cleaned = " ".join(text.split())
    if not cleaned:
        raise ValueError("空文本不能送去 embedding(检查一下是不是读到了空段落)")
    return cleaned


def embed(texts: list[str]) -> np.ndarray:
    """N 条文本 → (N, emb_dim) 的数组,每行长度为 1。"""
    s = get_settings()
    if not texts:
        return np.zeros((0, s.emb_dim), dtype=np.float32)
    rows: list[list[float]] = []
    for start in range(0, len(texts), BATCH):
        batch = [_clean(t) for t in texts[start : start + BATCH]]
        resp = _client().embeddings.create(model=s.emb_model, input=batch)
        usage["requests"] += 1
        if resp.usage:
            usage["tokens"] += resp.usage.total_tokens
        rows.extend(d.embedding for d in sorted(resp.data, key=lambda d: d.index))
    arr = np.asarray(rows, dtype=np.float32)
    if arr.shape[1] != s.emb_dim:
        raise ValueError(f"embedding 维度是 {arr.shape[1]},配置 EMB_DIM 是 {s.emb_dim},两边要一致")
    return arr / np.linalg.norm(arr, axis=1, keepdims=True)


def embed_one(text: str) -> np.ndarray:
    return embed([text])[0]


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)))
```

<div class="line-notes">

- `from functools import lru_cache` [Day 442](/blog/agent-zero/day-442-config/) 的 `get_settings()` 用过的装饰器:把函数第一次调用的结果缓存起来,以后直接返回。
- `from ..config import get_settings` 两个点是相对导入:从 `kb` 往上一层的 `supportpilot` 包里拿 `config`。
- `BATCH = 10` 一次送 10 条。练习仓库的版本从 `.env` 读 `EMB_BATCH`,SupportPilot 的 `Settings` 没有这一项,所以写成常量。
- `usage = {"requests": 0, "tokens": 0}` 记账用的字典,理由和 Day 217 一样:函数里改字典的值不需要 `global` 声明。
- `@lru_cache` 加在 `_client()` 上,是和 Day 217 的第一处不同。
- `def _client() -> OpenAI:` Day 217 在模块一被 import 时就建好客户端,这就要求 import 它的时候 `.env` 里必须有 key。SupportPilot 的测试里要 import 很多模块,不应该因为没配 key 就连 import 都失败。所以改成**第一次真的要调接口时才建**,之后复用。
- `return OpenAI(base_url=s.emb_base_url, api_key=s.emb_api_key.get_secret_value(), max_retries=3)` 地址和密钥取自 `Settings`;`max_retries=3` 让 SDK 遇到 429、5xx 自己退避重试 3 次([Day 127](/blog/agent-zero/day-127-retry-backoff/))。
- `def _clean(text: str) -> str:` 和 Day 217 一样:空白折叠成一个空格,全空白直接报错。
- `cleaned = " ".join(text.split())` 注意这一行会把 `embed_text` 里帽子和原文之间的换行变成一个空格,对向量没有影响。
- `raise ValueError("空文本不能送去 embedding(检查一下是不是读到了空段落)")` 空文本在服务端会得到一个看起来正常的向量,所以必须在发请求之前拦住。
- `def embed(texts: list[str]) -> np.ndarray:` 输入 N 条文本,输出 `(N, emb_dim)`。
- `s = get_settings()` 取配置。
- `if not texts:` 空列表直接返回,不发请求。
- `return np.zeros((0, s.emb_dim), dtype=np.float32)` 0 行 1024 列的空数组,形状是对的,调用方不用特判。
- `for start in range(0, len(texts), BATCH):` 分批。150 块是 15 批,一篇文章 2 到 4 块就是 1 批。
- `batch = [_clean(t) for t in texts[start : start + BATCH]]` 每条先过 `_clean`。
- `resp = _client().embeddings.create(model=s.emb_model, input=batch)` 一批一次请求。
- `usage["requests"] += 1` 请求数加一。
- `if resp.usage:` 有的服务不返回 usage,避免 `None.total_tokens`。
- `rows.extend(d.embedding for d in sorted(resp.data, key=lambda d: d.index))` 按 `index` 排回输入顺序再追加。接口文档不保证返回顺序一定和输入一致。
- `arr = np.asarray(rows, dtype=np.float32)` 变成 `float32` 数组。
- `if arr.shape[1] != s.emb_dim:` 这是和 Day 217 的第二处不同:**回来的维度和配置不一致就报错**。[Day 443](/blog/agent-zero/day-443-database/) 练习 4 里推过,换 embedding 模型要同时改配置、表结构并重新导入,漏一处就在这里炸出来,而不是等到插入数据库时才报晦涩的维度错误。
- `return arr / np.linalg.norm(arr, axis=1, keepdims=True)` 每行除以自己的长度。bge-m3 返回的本来就是长度 1,除一下是保险。
- `def embed_one(text: str) -> np.ndarray:` 单条快捷方式。
- `return embed([text])[0]` 包成一条的列表,取第 0 行,形状 `(1024,)`。
- `def cosine(a: np.ndarray, b: np.ndarray) -> float:` Day 215 的公式,留着给后面的天用。
</div>

新建 `scratch/e1.py` 试一下:

```python
# supportpilot/scratch/e1.py
import numpy as np

from supportpilot.kb.embed import cosine, embed, embed_one, usage

v = embed(["月付可以退款吗", "月付可以退款吗 > 规则", "导入银行流水时报错 E3001"])
print(v.shape, v.dtype, np.linalg.norm(v, axis=1).round(3))
print(usage)
q = embed_one("月付能退钱吗")
print(q.shape, round(cosine(q, v[0]), 4), round(cosine(q, v[2]), 4))
print(embed([]).shape)
try:
    embed(["退款", "   "])
except ValueError as e:
    print("ValueError:", e)
```

<div class="line-notes">

- `v = embed(["月付可以退款吗", "月付可以退款吗 > 规则", "导入银行流水时报错 E3001"])` 三条文本,第二条是「月付可以退款吗」戴了小标题的样子,第三条是不相干的。
- `print(v.shape, v.dtype, np.linalg.norm(v, axis=1).round(3))` 形状 `(3, 1024)`、类型 `float32`、每行长度四舍五入到 3 位都是 1。
- `print(usage)` 3 条一批,1 次请求,34 个 token。
- `q = embed_one("月付能退钱吗")` 单条。
- `print(q.shape, round(cosine(q, v[0]), 4), round(cosine(q, v[2]), 4))` 「月付能退钱吗」和第 0 条余弦 0.9786,和不相干的第 2 条只有 0.5165。
- `print(embed([]).shape)` 空列表:`(0, 1024)`,没有发请求。
- `embed(["退款", "   "])` 第二条全是空白,在发请求之前就会报错。
</div>

```bash
uv run python scratch/e1.py
```

```text
(3, 1024) float32 [1. 1. 1.]
{'requests': 1, 'tokens': 34}
(1024,) 0.9786 0.5165
(0, 1024)
ValueError: 空文本不能送去 embedding(检查一下是不是读到了空段落)
```

形状、长度、记账都对,相似的两句话余弦 0.9786,无关的 0.5165。然后故意把配置改错一次,验证维度检查真的会拦。临时在命令行里把 `EMB_DIM` 设成 768(环境变量优先于 `.env`),再跑:

```bash
EMB_DIM=768 uv run python scratch/e1.py 2>&1 | tail -4
```

```text
        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/你/supportpilot/src/supportpilot/kb/embed.py", line 44, in embed
    raise ValueError(f"embedding 维度是 {arr.shape[1]},配置 EMB_DIM 是 {s.emb_dim},两边要一致")
ValueError: embedding 维度是 1024,配置 EMB_DIM 是 768,两边要一致
```

报错说得很清楚:服务端返回 1024 维,配置说 768,两边要一致。

和 Day 217 的对照:

| | Day 217 `common/embed.py` | 今天 `kb/embed.py` |
| --- | --- | --- |
| 配置从哪来 | `os.environ`,模块一导入就读 | `Settings`(Day 442) |
| 客户端什么时候建 | 模块一导入就建 | 第一次调接口时才建,之后复用 |
| 批大小 | `.env` 里的 `EMB_BATCH` | 常量 `BATCH = 10` |
| 维度 | 不检查 | 和 `EMB_DIM` 对不上就报错 |
| `embed` / `embed_one` / `cosine` / `usage` | 有 | 有,一样 |
| 空文本、按 `index` 排序、归一化 | 有 | 有,一样 |

## 第二步:先手工写一篇进库

在写导入脚本之前,先用最笨的办法把一篇文章写进去,看清楚「写一篇」要做哪几步。新建 `scratch/w1_one.py`:

```python
# supportpilot/scratch/w1_one.py
from pathlib import Path

from supportpilot.db import connect
from supportpilot.kb.chunker import chunk_article, load_articles
from supportpilot.kb.embed import embed

art = next(a for a in load_articles(Path("data/kb")) if a.id == "KB-refund-002")
chunks = chunk_article(art)
vectors = embed([c.embed_text for c in chunks])
print(vectors.shape)

with connect() as conn:
    with conn.transaction():
        conn.execute("DELETE FROM kb.docs WHERE id = %s", (art.id,))
        conn.execute(
            "INSERT INTO kb.docs (id, title, category, url_path, updated_at, content_hash, content) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (art.id, art.title, art.category, art.url_path, art.updated_at, "手写", art.body),
        )
        for c, v in zip(chunks, vectors, strict=True):
            conn.execute(
                "INSERT INTO kb.chunks (doc_id, chunk_index, heading, content, embedding) "
                "VALUES (%s, %s, %s, %s, %s)",
                (c.doc_id, c.index, c.heading, c.text, v),
            )
    rows = conn.execute(
        "SELECT doc_id, chunk_index, heading, left(content, 14) AS head, vector_dims(embedding) AS dims "
        "FROM kb.chunks WHERE doc_id = %s ORDER BY chunk_index",
        (art.id,),
    ).fetchall()
    for r in rows:
        print(r)
```

<div class="line-notes">

- `art = next(a for a in load_articles(Path("data/kb")) if a.id == "KB-refund-002")` 读 62 篇,挑出编号 `KB-refund-002` 的那一篇。`next(生成器)` 取第一个满足条件的;找不到会抛 `StopIteration`。
- `chunks = chunk_article(art)` Day 448 的切块,这篇切出 2 块(「条件」「不适用」)。
- `vectors = embed([c.embed_text for c in chunks])` 送去向量化的是 `embed_text`(带帽子),不是 `text`。
- `print(vectors.shape)` `(2, 1024)`。
- `with connect() as conn:` [Day 443](/blog/agent-zero/day-443-database/) 的连接函数。连接是 autocommit 的:每条 SQL 自己提交。
- `with conn.transaction():` 打开一个事务:里面的几条 SQL 一起成败。
- `conn.execute("DELETE FROM kb.docs WHERE id = %s", (art.id,))` 先把旧的删掉。外键是 `ON DELETE CASCADE`,这篇文章的旧块会跟着自动删。第一次导入时没有旧的,删 0 行,不报错。
- `"INSERT INTO kb.docs (id, title, category, url_path, updated_at, content_hash, content) "` 文章表一行。`%s` 是 psycopg 的占位符,值放在后面的元组里,由驱动转义。`content_hash` 这里先随便写一个「手写」,第三步才用真的指纹。
- `for c, v in zip(chunks, vectors, strict=True):` 一块配一个向量。`strict=True` 让两个列表长度不一样时直接报错,防止块和向量错位。
- `(c.doc_id, c.index, c.heading, c.text, v),` 存的是 `c.text`,不是 `embed_text`:库里存不带帽子的原文。`v` 是一行 numpy 数组,`register_vector`(Day 443)让它能直接写进 `vector` 列。
- `"SELECT doc_id, chunk_index, heading, left(content, 14) AS head, vector_dims(embedding) AS dims "` `left(content, 14)` 取前 14 个字,`vector_dims(embedding)` 是 pgvector 的函数,返回向量的维数。
- `for r in rows:` 每行是一个字典(`dict_row`),直接打印。
</div>

先清空表再跑(`psql` 在 [Day 228](/blog/agent-zero/day-228-postgres-basics/) 用过;下面的库名 `supportpilot` 是 Day 443 建的,以你 `.env` 里的 `DATABASE_URL` 为准):

```bash
psql supportpilot -qc "DELETE FROM kb.docs"
uv run python scratch/w1_one.py
```

```text
(2, 1024)
{'doc_id': 'KB-refund-002', 'chunk_index': 0, 'heading': '条件', 'head': '首次购买的年付订阅,从付款日', 'dims': 1024}
{'doc_id': 'KB-refund-002', 'chunk_index': 1, 'heading': '不适用', 'head': '续费订单、企业版合同订单不适', 'dims': 1024}
```

两块都写进去了,向量是 1024 维,存的是原文。一篇文章的完整写法就是这几步:删旧、写文章表、写块表,三步放在一个事务里。导入脚本只是把这几步对每一篇文章重复,再加上「要不要写」的判断。

## 第三步:ingest()

判断「要不要写」靠**内容指纹**:给一篇文章算一个短字符串,内容变了它就变。库里的 `kb.docs.content_hash` 那一列存的就是它。导入时算出新指纹,和库里的比,一样就跳过。新建 `src/supportpilot/kb/ingest.py`。这是**我写的第一版**,指纹先用最直觉的办法:标题加正文的 SHA-256。

```python
# supportpilot/src/supportpilot/kb/ingest.py
"""把帮助中心文章切块、向量化、写进 kb.docs 和 kb.chunks。内容没变的文章跳过。"""

import hashlib
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
import psycopg
from psycopg.rows import DictRow

from ..config import get_settings
from .chunker import Article, Chunk, chunk_article
from .embed import embed

EmbedFn = Callable[[list[str]], np.ndarray]


@dataclass
class Report:
    added: int = 0
    updated: int = 0
    skipped: int = 0
    deleted: int = 0
    chunks: int = 0  # 这次真正写进库的块数

    def __str__(self) -> str:
        return (
            f"added={self.added} updated={self.updated} skipped={self.skipped} "
            f"deleted={self.deleted} chunks_written={self.chunks}"
        )


def fingerprint(article: Article, chunks: list[Chunk], model: str) -> str:
    """指纹:这个值变了,就说明这篇文章要重新导入。"""
    return hashlib.sha256(f"{article.title}\n{article.body}".encode()).hexdigest()[:16]


def write_article(
    conn: psycopg.Connection[DictRow], article: Article, chunks: list[Chunk], vectors: np.ndarray, fp: str
) -> None:
    """删掉旧的、写进新的,放在一个事务里:要么全成,要么库保持原样。"""
    with conn.transaction():
        conn.execute("DELETE FROM kb.docs WHERE id = %s", (article.id,))  # 它的块跟着级联删除
        conn.execute(
            "INSERT INTO kb.docs (id, title, category, url_path, updated_at, content_hash, content) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (
                article.id,
                article.title,
                article.category,
                article.url_path,
                article.updated_at,
                fp,
                article.body,
            ),
        )
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO kb.chunks (doc_id, chunk_index, heading, content, embedding) "
                "VALUES (%s, %s, %s, %s, %s)",
                [(c.doc_id, c.index, c.heading, c.text, v) for c, v in zip(chunks, vectors, strict=True)],
            )


def ingest(conn: psycopg.Connection[DictRow], articles: list[Article], embed_fn: EmbedFn = embed) -> Report:
    s = get_settings()
    report = Report()
    existing = {r["id"]: r["content_hash"] for r in conn.execute("SELECT id, content_hash FROM kb.docs")}
    for article in articles:
        chunks = chunk_article(article)
        fp = fingerprint(article, chunks, s.emb_model)
        if existing.get(article.id) == fp:
            report.skipped += 1
            continue
        vectors = embed_fn([c.embed_text for c in chunks])
        if vectors.shape != (len(chunks), s.emb_dim):
            raise ValueError(f"{article.id}:向量形状 {vectors.shape},应该是 {(len(chunks), s.emb_dim)}")
        write_article(conn, article, chunks, vectors, fp)
        report.chunks += len(chunks)
        if article.id in existing:
            report.updated += 1
        else:
            report.added += 1
    for doc_id in set(existing) - {a.id for a in articles}:
        conn.execute("DELETE FROM kb.docs WHERE id = %s", (doc_id,))
        report.deleted += 1
    return report
```

<div class="line-notes">

- `import hashlib` 算 SHA-256 用,[Day 231](/blog/agent-zero/day-231-pgvector-2/) 用过。
- `from collections.abc import Callable` 下面要给「embedding 函数」写类型。
- `from ..config import get_settings` 要读 embedding 模型名和维度。
- `from .chunker import Article, Chunk, chunk_article` 同一个包里的 `chunker.py`,一个点。
- `from .embed import embed` 今天第一步写的函数。
- `EmbedFn = Callable[[list[str]], np.ndarray]` 一个类型别名:「接收文本列表、返回数组的函数」。下面 `ingest()` 的参数用它,默认是真的 `embed`,测试里换成不联网的假函数。
- `class Report:` 一次导入的结果:新增、更新、跳过、删除几篇,以及写进库的块数。
- `chunks: int = 0  # 这次真正写进库的块数` 跳过的文章不算,所以第二次导入是 0。
- `def __str__(self) -> str:` `print(report)` 时显示的样子,下面的输出就是它。
- `def fingerprint(article: Article, chunks: list[Chunk], model: str) -> str:` 签名里预留了 `chunks` 和 `model`,第一版用不上,第五步才用。
- `return hashlib.sha256(f"{article.title}\n{article.body}".encode()).hexdigest()[:16]` 标题和正文拼起来,`.encode()` 变成字节,算 SHA-256,取前 16 个十六进制字符。改标题或改正文它都会变,只改 `updated_at` 它不会变。
- `def write_article(` 第二步那几行 SQL 的正式版。
- `with conn.transaction():` 事务块。里面任何一句抛异常,整个块回滚,`DELETE` 也撤销。
- `conn.execute("DELETE FROM kb.docs WHERE id = %s", (article.id,))  # 它的块跟着级联删除` 旧文章和旧块。
- `"VALUES (%s, %s, %s, %s, %s, %s, %s)",` 七个占位符对应七个列。
- `fp,` 指纹存进 `content_hash`。
- `with conn.cursor() as cur:` 要用游标才有 `executemany`。
- `cur.executemany(` 一条 SQL 配多组参数,这篇文章的所有块一次写完。
- `[(c.doc_id, c.index, c.heading, c.text, v) for c, v in zip(chunks, vectors, strict=True)],` 一块一个元组,和第二步一样。
- `def ingest(conn: psycopg.Connection[DictRow], articles: list[Article], embed_fn: EmbedFn = embed) -> Report:` 主函数。把连接和文章列表传进来,而不是自己去读目录、自己去连库:这样测试能直接塞几篇假文章。
- `s = get_settings()` 取配置。
- `existing = {r["id"]: r["content_hash"] for r in conn.execute("SELECT id, content_hash FROM kb.docs")}` 库里已有文章的 `{编号: 指纹}`,一次查完。第一次导入时是空字典。
- `for article in articles:` 逐篇处理。
- `chunks = chunk_article(article)` 切块是本地计算,很快,所以每次都切,用来算指纹。
- `if existing.get(article.id) == fp:` 库里没有这篇时 `.get()` 返回 `None`,和任何指纹都不相等,所以新文章不会被当成「没变」。
- `report.skipped += 1` 跳过的计数加一。
- `continue` 直接处理下一篇,不调 embedding。
- `vectors = embed_fn([c.embed_text for c in chunks])` 只有真要写的文章才调接口,而且在事务**外面**。
- `if vectors.shape != (len(chunks), s.emb_dim):` 写之前再核对一遍形状。[Day 443](/blog/agent-zero/day-443-database/) 的结论:导入脚本里最好也检查向量长度,不对就拒绝写入。
- `write_article(conn, article, chunks, vectors, fp)` 进入事务写库。
- `if article.id in existing:` 区分「更新」和「新增」,只影响计数。
- `for doc_id in set(existing) - {a.id for a in articles}:` 集合相减([Day 25](/blog/agent-zero/day-025-sets/)):库里有、目录里已经没有的文章编号。
- `conn.execute("DELETE FROM kb.docs WHERE id = %s", (doc_id,))` 删掉,块级联跟着删。
- `return report` 把结果交给调用方。
</div>

再写一个命令行入口 `scripts/ingest_kb.py`,读目录、连库、调 `ingest()`、打印结果和 embedding 用量:

```python
# supportpilot/scripts/ingest_kb.py
"""增量导入帮助中心:python scripts/ingest_kb.py"""

import time
from pathlib import Path

from supportpilot.db import connect
from supportpilot.kb.chunker import load_articles
from supportpilot.kb.embed import usage
from supportpilot.kb.ingest import ingest

KB_DIR = Path(__file__).resolve().parent.parent / "data" / "kb"


def main() -> None:
    t0 = time.perf_counter()
    with connect() as conn:
        report = ingest(conn, load_articles(KB_DIR))
    secs = time.perf_counter() - t0
    print(report)
    print(f"embedding 请求 {usage['requests']} 次,{usage['tokens']} token,用时 {secs:.1f} 秒")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `KB_DIR = Path(__file__).resolve().parent.parent / "data" / "kb"` 和 `chunk_report.py` 一样的定位方法。
- `t0 = time.perf_counter()` 计时起点。`perf_counter` 比 `time.time()` 精度高,专门用来量时间差。
- `with connect() as conn:` 连库,块结束自动关。
- `report = ingest(conn, load_articles(KB_DIR))` 读 62 篇交给 `ingest`。
- `secs = time.perf_counter() - t0` 总用时。
- `print(report)` 调的是 `Report.__str__`。
- `print(f"embedding 请求 {usage['requests']} 次,{usage['tokens']} token,用时 {secs:.1f} 秒")` `usage` 是 `embed.py` 里那个字典,这一次运行里调了几次接口、花了多少 token 都在里面。
</div>

先跑第一次。库里现在只有第二步手写进去的那一篇 `KB-refund-002`(指纹是「手写」),其余都没有:

```bash
uv run python scripts/ingest_kb.py
```

```text
added=61 updated=1 skipped=0 deleted=0 chunks_written=150
embedding 请求 62 次,6222 token,用时 8.6 秒
```

61 篇新增、1 篇更新。更新的就是手写的那篇:它的指纹是「手写」,和算出来的不一样,所以被当作「变过」重写了一遍。一共 150 块写进库,62 次请求(一篇文章一次),共 6,222 个 token,`bge-m3` 免费,所以 ¥0,用了 8.6 秒。

再跑一次:

```bash
uv run python scripts/ingest_kb.py
```

```text
added=0 updated=0 skipped=62 deleted=0 chunks_written=0
embedding 请求 0 次,0 token,用时 0.1 秒
```

全部跳过,没有调接口。接着改一篇文章:往 `data/kb/KB-invoice-001.md` 末尾加一句话(这是做实验,正式的做法是改 `kb_facts.py` 再 `make kb`),再跑:

```bash
printf '\n客户成功团队可在工作日 24 小时内处理。\n' >> data/kb/KB-invoice-001.md
uv run python scripts/ingest_kb.py
```

```text
added=0 updated=1 skipped=61 deleted=0 chunks_written=3
embedding 请求 1 次,119 token,用时 0.5 秒
```

只更新了这一篇,3 块重写,1 次请求 119 个 token。其余 61 篇都没动。再把这个文件挪走(挪到仓库外面,比如 `mv data/kb/KB-invoice-001.md ~/kb-backup.md`),再跑:

```text
added=0 updated=0 skipped=61 deleted=1 chunks_written=0
embedding 请求 0 次,0 token,用时 0.1 秒
```

库里有、目录里没有的文章被删掉了(1 篇,它的块级联跟着删)。最后用 `scripts/gen_kb.py` 重新生成一遍(会把被删的和被改过的都恢复成事实源里的样子),再跑:

```text
added=1 updated=0 skipped=61 deleted=0 chunks_written=3
embedding 请求 1 次,106 token,用时 0.4 秒
```

被删的那篇又加回来了,3 块。新增、更新、跳过、删除四种情况都走过了。

## 第四步:中途出错会怎样

`write_article` 里用了事务,到底有没有用?别信,弄坏一次看。`scratch/i2.py` 故意把第二块的向量弄成 `NaN`(pgvector 不收 NaN),然后写一篇有 2 块的文章。先带事务写,再**去掉事务**用同样三步写一次,对比出错后库的状态:

```python
# supportpilot/scratch/i2.py
from pathlib import Path

import numpy as np
import psycopg
from psycopg.rows import DictRow

from supportpilot.db import connect
from supportpilot.kb.chunker import chunk_article, load_articles
from supportpilot.kb.embed import embed
from supportpilot.kb.ingest import write_article

art = next(a for a in load_articles(Path("data/kb")) if a.id == "KB-refund-002")
chunks = chunk_article(art)
bad = embed([c.embed_text for c in chunks])
bad[1, :] = np.nan  # 第二块的向量坏掉


def state(conn: psycopg.Connection[DictRow], label: str) -> None:
    row = conn.execute(
        "SELECT d.content_hash AS h, (SELECT count(*) FROM kb.chunks WHERE doc_id = d.id) AS n "
        "FROM kb.docs d WHERE d.id = %s",
        (art.id,),
    ).fetchone()
    print(f"{label}: {row}")


with connect() as conn:
    state(conn, "写之前")
    try:
        write_article(conn, art, chunks, bad, "new-hash")
    except psycopg.Error as e:
        print(type(e).__name__, str(e).splitlines()[0])
    state(conn, "有事务,出错后")

    # 去掉事务再来一次:同样的三步,一步一步各自提交
    try:
        conn.execute("DELETE FROM kb.docs WHERE id = %s", (art.id,))
        conn.execute(
            "INSERT INTO kb.docs VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (art.id, art.title, art.category, art.url_path, art.updated_at, "new-hash", art.body),
        )
        for c, v in zip(chunks, bad, strict=True):
            conn.execute(
                "INSERT INTO kb.chunks (doc_id, chunk_index, heading, content, embedding) "
                "VALUES (%s, %s, %s, %s, %s)",
                (c.doc_id, c.index, c.heading, c.text, v),
            )
    except psycopg.Error as e:
        print(type(e).__name__, str(e).splitlines()[0])
    state(conn, "没有事务,出错后")
```

<div class="line-notes">

- `import numpy as np` 要用 `np.nan`。
- `art = next(a for a in load_articles(Path("data/kb")) if a.id == "KB-refund-002")` 挑一篇 2 块的文章。
- `bad = embed([c.embed_text for c in chunks])` 先正常算出两块的向量。
- `bad[1, :] = np.nan  # 第二块的向量坏掉` 把第 1 行(第二块)的所有数改成 `NaN`。第一块的向量是好的。
- `def state(conn: psycopg.Connection[DictRow], label: str) -> None:` 查一下这篇文章在库里的指纹和块数,带上标签打印。
- `"SELECT d.content_hash AS h, (SELECT count(*) FROM kb.chunks WHERE doc_id = d.id) AS n "` 子查询数这篇文章有几块。
- `state(conn, "写之前")` 先看一眼出事前的样子。
- `write_article(conn, art, chunks, bad, "new-hash")` 用带事务的正式函数写,指纹传一个假的 `new-hash`,方便一眼看出有没有写进去。
- `except psycopg.Error as e:` 捕获数据库驱动的所有错误。
- `print(type(e).__name__, str(e).splitlines()[0])` 打印异常类名和报错第一行。
- `state(conn, "有事务,出错后")` 出错后再看一眼。
- `conn.execute("DELETE FROM kb.docs WHERE id = %s", (art.id,))` 下面是去掉事务的版本:同样三步,但连接是 autocommit 的,每条语句自己提交。
- `"INSERT INTO kb.docs VALUES (%s, %s, %s, %s, %s, %s, %s)",` 文章表写进去。
- `for c, v in zip(chunks, bad, strict=True):` 逐块写,第二块会失败。
- `state(conn, "没有事务,出错后")` 看没有事务时库变成什么样。
</div>

```bash
uv run python scratch/i2.py
```

```text
写之前: {'h': '824da0fa1020a83d', 'n': 2}
DataException NaN not allowed in vector
有事务,出错后: {'h': '824da0fa1020a83d', 'n': 2}
DataException NaN not allowed in vector
没有事务,出错后: {'h': 'new-hash', 'n': 1}
```

带事务:报错之后,指纹还是原来的 `824da0fa1020a83d`,还是 2 块,好像什么都没发生。去掉事务:指纹变成了 `new-hash`,块只有 1 块,**库里留下了一篇只有一半内容的文章**,而且指纹显示它「已经是最新的」,下一次导入会把它当成没变而跳过,这篇文章从此就缺一块,没人知道。事务防的就是这个。

顺手看一下怎么修复:再跑一次 `ingest_kb.py`,指纹 `new-hash` 和真实指纹对不上,这篇会被当成「变过」重写:

```text
added=0 updated=1 skipped=61 deleted=0 chunks_written=2
embedding 请求 1 次,96 token,用时 0.4 秒
```

这也说明了另一个设计:embedding 调用放在事务**外面**。如果放在事务里面,网络慢一点,数据库连接和锁就被占着等,别的查询都得排队。先拿到向量再进事务,事务里只有几条毫秒级的 SQL。

还有一个边界要知道:**事务只管一篇文章,不管整批**。第 30 篇的 embedding 请求失败、整个脚本中断时,前 29 篇已经写完了,不会回滚。这是有意的:重跑一次,前 29 篇指纹没变直接跳过,只补后面的。练习 4 把这一点写成测试。

## 第五步:一个很隐蔽的坑,指纹算错了

现在知识库导入好了,看起来一切正常。可是有一类改动,我这个指纹抓不住。Day 448 的帽子是 `文章标题 > 小标题`。假如一个月后你觉得帽子里应该再加上产品名,把 `make_hat()` 改成 `云簿帮助中心 > 标题 > 小标题`,然后重新导入。文章的标题和正文一个字都没变,指纹也就没变。会发生什么?

`scratch/i3.py` 用一行把 `make_hat` 换成新写法(不用真的去改 `chunker.py`),然后导入,最后拿库里存的向量和「用新帽子重新算的向量」比一比:

```python
# supportpilot/scratch/i3.py
"""改帽子的写法,再导入一次:库里的向量会不会跟着更新?"""

from pathlib import Path

from supportpilot.db import connect
from supportpilot.kb import chunker
from supportpilot.kb.chunker import chunk_article, load_articles
from supportpilot.kb.embed import cosine, embed_one
from supportpilot.kb.ingest import ingest

chunker.make_hat = lambda title, heading: f"云簿帮助中心 > {title} > {heading}"  # 新写法:前面多一截

articles = load_articles(Path("data/kb"))
with connect() as conn:
    print(ingest(conn, articles))
    art = next(a for a in articles if a.id == "KB-refund-004")
    c = chunk_article(art)[0]
    print(repr(c.embed_text))
    row = conn.execute(
        "SELECT embedding FROM kb.chunks WHERE doc_id = %s AND chunk_index = 0", (art.id,)
    ).fetchone()
    assert row is not None
    stored = row["embedding"].to_numpy()  # 读出来是 pgvector 的 Vector 对象,转成 numpy
    old_text = f"{c.title} > {c.heading}\n{c.text}"  # 导入时用的老写法
    print("对照:库里的向量 vs 老写法重新算的 =", round(cosine(stored, embed_one(old_text)), 4))
    print("库里的向量 vs 新写法算的 =", round(cosine(stored, embed_one(c.embed_text)), 4))
```

<div class="line-notes">

- `from supportpilot.kb import chunker` 导入整个模块,下一行要改它里面的名字。
- `chunker.make_hat = lambda title, heading: f"云簿帮助中心 > {title} > {heading}"  # 新写法:前面多一截` 把模块里的 `make_hat` 换成新写法。`Chunk.hat` 每次调用时才去模块里找 `make_hat`,所以这一行就生效了,不用改文件。相当于 JS 里给模块的导出重新赋值。
- `articles = load_articles(Path("data/kb"))` 读 62 篇。
- `print(ingest(conn, articles))` 正常导入,打印计数。
- `art = next(a for a in articles if a.id == "KB-refund-004")` 挑「月付可以退款吗」那篇,看它的第一块。
- `print(repr(c.embed_text))` 新写法的 `embed_text`,前面多了「云簿帮助中心 > 」。
- `"SELECT embedding FROM kb.chunks WHERE doc_id = %s AND chunk_index = 0", (art.id,)` 取库里这一块的向量。
- `stored = row["embedding"].to_numpy()` 从库里读出来是 pgvector 的 `Vector` 对象,`to_numpy()` 转成 numpy 数组,才能做点积。
- `old_text = f"{c.title} > {c.heading}\n{c.text}"  # 导入时用的老写法` 老写法的文本,是 Day 448 的 `embed_text`。
- `print("对照:库里的向量 vs 老写法重新算的 =", round(cosine(stored, embed_one(old_text)), 4))` 对照组:如果库里存的真是老写法算的向量,重新算一次应该几乎相同。
- `print("库里的向量 vs 新写法算的 =", round(cosine(stored, embed_one(c.embed_text)), 4))` 如果库里已经更新成新写法,这个值应该接近 1。
</div>

```bash
uv run python scratch/i3.py
```

```text
added=0 updated=0 skipped=62 deleted=0 chunks_written=0
'云簿帮助中心 > 月付可以退款吗 > 规则\n月付订阅不支持退款。如果不想继续使用,关闭自动续费即可,当期结束后不再扣款。'
对照:库里的向量 vs 老写法重新算的 = 1.0
库里的向量 vs 新写法算的 = 0.9551
```

`skipped=62`:62 篇全部被跳过,一块都没重新向量化。对照组是 1.0,说明库里确实还是老写法算的向量;新写法算的向量和库里的只有 0.9551 的相似度,不是 1。**库里的向量和代码现在认定的写法已经对不上了,但是没有任何报错、没有任何提示。** 这种错最难查:以后检索质量悄悄变差,没人想到是三周前改了帽子。

病根是指纹只管「文章的原文」,而库里真正存的东西还取决于:帽子怎么写、怎么切块、用的哪个 embedding 模型。这些变了,向量就该重算,指纹却不知道。修法是让指纹覆盖**所有会影响写进库的东西**:embedding 模型名、文章的元数据、每一块送去向量化的文本(它已经包含了帽子和切块的结果)。`fingerprint()` 改成这样:

```python
def fingerprint(article: Article, chunks: list[Chunk], model: str) -> str:
    """指纹:凡是会写进库的东西(元数据、每块送去向量化的文本、embedding 模型名)变了,它就变。"""
    parts = [model, article.id, article.title, article.category, article.url_path, article.updated_at]
    parts += [c.embed_text for c in chunks]
    return hashlib.sha256("\x1f".join(parts).encode()).hexdigest()[:16]
```

<div class="line-notes">

- `def fingerprint(article: Article, chunks: list[Chunk], model: str) -> str:` 签名没变,第一版就预留了 `chunks` 和 `model`。
- `parts = [model, article.id, article.title, article.category, article.url_path, article.updated_at]` 先放模型名和文章的所有元数据。模型换了、`url_path` 改了,都该重写。
- `parts += [c.embed_text for c in chunks]` 再放每一块送去向量化的文本。切块规则、帽子写法、正文,任何一个变了,`embed_text` 就变。
- `return hashlib.sha256("\x1f".join(parts).encode()).hexdigest()[:16]` 用 `\x1f`(ASCII 的「单元分隔符」,正文里几乎不会出现)把各项连起来再算哈希。直接拼在一起会有歧义:`"ab" + "c"` 和 `"a" + "bc"` 拼出来一样。
</div>

(`ingest.py` 里只换这个函数,别的不动。)换好以后,把库恢复成 Day 448 的写法再测一遍:先重复上面的 `i3.py`(新写法),再用真正的 `chunker.py`(老写法)导入:

```bash
uv run python scratch/i3.py
uv run python scripts/ingest_kb.py
uv run python scripts/ingest_kb.py
```

```text
added=0 updated=62 skipped=0 deleted=0 chunks_written=150
'云簿帮助中心 > 月付可以退款吗 > 规则\n月付订阅不支持退款。如果不想继续使用,关闭自动续费即可,当期结束后不再扣款。'
对照:库里的向量 vs 老写法重新算的 = 0.955
库里的向量 vs 新写法算的 = 0.9999
added=0 updated=62 skipped=0 deleted=0 chunks_written=150
embedding 请求 62 次,6222 token,用时 12.1 秒
added=0 updated=0 skipped=62 deleted=0 chunks_written=0
embedding 请求 0 次,0 token,用时 0.1 秒
```

这次 `i3.py` 导入时 `updated=62`:帽子一变,62 篇全部重新向量化,库里的向量和新写法的相似度 0.9999,和老写法的 0.955。然后用真正的 `chunker.py`(老写法)再导入一次,又是 `updated=62`,换回来也要重做;再跑一次才是 `skipped=62`。这是对的:库里存什么,完全由当前代码决定。

这个代价要知道:**任何一处会改变 `embed_text` 的改动,都会触发全量重导入**,150 块要 8 到 12 秒,免费所以不心疼;如果换成付费的 embedding 服务,改帽子之前先算一下要花多少钱。

## 第六步:接进 Makefile 和 README

最后把导入接进 [Day 446](/blog/agent-zero/day-446-makefile-readme/) 的命令。那天说过 `make kb` 在导入做完后会再加一条,现在加上。`Makefile` 里 `kb` 那一段改成:

```makefile
kb:         ## 生成帮助中心文章、检查,并增量导入数据库
	uv run python scripts/gen_kb.py
	uv run python scripts/check_kb.py
	uv run python scripts/ingest_kb.py
data: init seed kb  ## 建表 + 造业务数据 + 生成并导入帮助中心
```

(缩进是 Tab。)README 里两处同步改:命令表里 `make kb` 那一行改成「生成帮助中心文章到 `data/kb/`、检查,再增量导入数据库(要 `EMB_API_KEY`,bge-m3 免费;没改的文章会跳过)」,快速开始里 `make data` 那行注释改成「建表、造业务数据、生成帮助中心文章并向量化导入」。Day 446 写的 `tests/test_docs.py` 会检查 Makefile 的每个命令都有说明、README 的表里都有,所以改漏了它会红。跑一遍 `make kb`:

```bash
make kb
```

```text
uv run python scripts/gen_kb.py
wrote 62 articles to /Users/你/supportpilot/data/kb
uv run python scripts/check_kb.py
检查 62 篇文章: 通过
uv run python scripts/ingest_kb.py
added=0 updated=0 skipped=62 deleted=0 chunks_written=0
embedding 请求 0 次,0 token,用时 0.1 秒
```

注意一件事:`gen_kb.py` 每次都**把 62 个文件全部重写一遍**(所以所有文件的修改时间都变了),可是 `ingest_kb.py` 全部跳过,一次接口都没调。指纹看的是内容,不是修改时间,这正是用内容哈希而不是 mtime 的原因。


## 第七步:给 embed 和 ingest 写测试

这两个模块的测试有一个共同点:**不能真的联网调 embedding**,否则 `make test` 就要联网、要 key,还慢。办法是用假的顶替:`embed()` 的测试用一个假客户端,`ingest()` 的测试传一个假的 `embed_fn`(参数就是为这个预留的)。先建两个公用的小工具。`tests/helpers.py`:

```python
# supportpilot/tests/helpers.py
"""几个测试文件共用的小工具:假 embedding、造文章。"""

import hashlib

import numpy as np

from supportpilot.config import get_settings
from supportpilot.kb.chunker import Article

DIM = get_settings().emb_dim


def fake_embed(texts: list[str]) -> np.ndarray:
    """每段文本一个固定的随机向量:同样的文本永远得到同样的向量,不同的文本几乎正交。"""
    seeds = [int(hashlib.md5(t.encode()).hexdigest()[:8], 16) for t in texts]  # 用文本的 md5 当随机种子
    rows = [np.random.default_rng(seed).normal(size=DIM) for seed in seeds]
    arr = np.asarray(rows, dtype=np.float32)
    return arr / np.linalg.norm(arr, axis=1, keepdims=True)


def make_article(doc_id: str, title: str, sections: dict[str, str]) -> Article:
    body = f"# {title}\n\n" + "\n\n".join(f"## {h}\n\n{t}" for h, t in sections.items())
    return Article(doc_id, title, "test", f"/help/test/{doc_id}", "2026-09-15", body)


def make(doc_id: str, extra: str = "") -> Article:
    """一篇两节的小文章。extra 追加在第一节末尾,用来模拟「改了一句话」。"""
    return make_article(
        doc_id, f"标题 {doc_id}", {"第一节": f"第一节的内容。{extra}", "第二节": "第二节的内容。"}
    )
```

<div class="line-notes">

- `import hashlib` 下面用 md5 给文本算随机种子。
- `DIM = get_settings().emb_dim` 向量维数取配置里的 1024,假向量要和表里的 `vector(1024)` 一样长。
- `def fake_embed(texts: list[str]) -> np.ndarray:` 假的 embedding 函数,形状和真的一样:`(N, 1024)`、每行长度 1。
- `seeds = [int(hashlib.md5(t.encode()).hexdigest()[:8], 16) for t in texts]  # 用文本的 md5 当随机种子` 同一段文本永远得到同一个种子,取 md5 的前 8 个十六进制字符转成整数。
- `rows = [np.random.default_rng(seed).normal(size=DIM) for seed in seeds]` 每个种子生成一个 1024 维的随机向量。随机向量彼此几乎正交,所以「相似度排序」在测试里没有语义,只用来测流程。
- `return arr / np.linalg.norm(arr, axis=1, keepdims=True)` 归一化。
- `def make_article(doc_id: str, title: str, sections: dict[str, str]) -> Article:` 造一篇文章,小节用字典传:`{小标题: 正文}`。
- `body = f"# {title}\n\n" + "\n\n".join(f"## {h}\n\n{t}" for h, t in sections.items())` 拼成和真文章同样格式的 markdown 正文。
- `def make(doc_id: str, extra: str = "") -> Article:` 一篇固定的两节小文章。`extra` 追加在第一节末尾,用来模拟「改了一句话」。
</div>

`tests/conftest.py` 末尾追加一个夹具(`conn` 夹具是 [Day 446](/blog/agent-zero/day-446-makefile-readme/) 写的,这里用它):

```python
@pytest.fixture
def clean(conn: psycopg.Connection[DictRow]) -> Iterator[psycopg.Connection[DictRow]]:
    """在一个最后必回滚的事务里清空知识库表:测试里随便写,出来之后库还是原样。"""
    with conn.transaction(force_rollback=True):
        conn.execute("DELETE FROM kb.docs")
        yield conn
```

<div class="line-notes">

- `@pytest.fixture` 夹具,测试函数的参数里写 `clean`,pytest 自动调用。
- `def clean(conn: psycopg.Connection[DictRow]) -> Iterator[psycopg.Connection[DictRow]]:` 它自己又用了 `conn` 夹具,夹具可以套夹具。
- `with conn.transaction(force_rollback=True):` 开一个事务,并且**不管里面成功还是失败,出来时一律回滚**。
- `conn.execute("DELETE FROM kb.docs")` 在这个事务里把知识库表清空。块表跟着级联清空。这只在事务里生效,出来就撤销了。
- `yield conn` 把连接交给测试。测试里 `ingest()` 的 `conn.transaction()` 会变成**嵌套事务**(savepoint):里面失败只回滚到 savepoint,外面这层仍然保留到测试结束再整体回滚。
</div>

(`conftest.py` 顶部要补一行 `from collections.abc import Iterator`。)这样测试可以放心写库、清库,测完库里的 62 篇文章原封不动。`embed()` 的测试 `tests/test_embed.py`:

```python
# supportpilot/tests/test_embed.py
"""embed() 的单元测试:用假客户端,不联网、不花钱。"""

from types import SimpleNamespace

import numpy as np
import pytest

from supportpilot.kb import embed as emb


class FakeEmbeddings:
    def __init__(self, dim: int) -> None:
        self.dim = dim
        self.batches: list[list[str]] = []

    def create(self, model: str, input: list[str]) -> SimpleNamespace:
        self.batches.append(input)
        data = [
            SimpleNamespace(index=i, embedding=[float(len(t)), 1.0] + [0.0] * (self.dim - 2))
            for i, t in enumerate(input)
        ]
        data.reverse()  # 故意倒着返回,考验 embed() 有没有按 index 排回来
        return SimpleNamespace(data=data, usage=SimpleNamespace(total_tokens=len(input) * 3))


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> FakeEmbeddings:
    dim = emb.get_settings().emb_dim
    f = FakeEmbeddings(dim)
    monkeypatch.setattr(emb, "_client", lambda: SimpleNamespace(embeddings=f))
    monkeypatch.setitem(emb.usage, "requests", 0)
    monkeypatch.setitem(emb.usage, "tokens", 0)
    return f


def test_batches_and_order(fake: FakeEmbeddings):
    texts = ["一" * n for n in range(1, 26)]  # 25 条,长度各不相同
    out = emb.embed(texts)
    assert out.shape == (25, emb.get_settings().emb_dim)
    assert [len(b) for b in fake.batches] == [10, 10, 5]
    assert emb.usage == {"requests": 3, "tokens": 75}
    # 第 0 行对应第 0 条文本:长度越长,第一个分量占比越大
    assert out[0, 0] < out[24, 0]


def test_rows_are_normalized(fake: FakeEmbeddings):
    out = emb.embed(["退款", "发票"])
    assert np.allclose(np.linalg.norm(out, axis=1), 1.0)


def test_empty_list_makes_no_request(fake: FakeEmbeddings):
    assert emb.embed([]).shape == (0, emb.get_settings().emb_dim)
    assert fake.batches == []


def test_blank_text_is_rejected_before_any_request(fake: FakeEmbeddings):
    with pytest.raises(ValueError, match="空文本"):
        emb.embed(["退款", "  \n "])
    assert fake.batches == []


def test_wrong_dimension_is_rejected(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(emb, "_client", lambda: SimpleNamespace(embeddings=FakeEmbeddings(8)))
    with pytest.raises(ValueError, match="EMB_DIM"):
        emb.embed(["退款"])
```

<div class="line-notes">

- `from types import SimpleNamespace` 随手造一个有任意属性的对象,不用定义类。相当于 JS 里写 `{ data: [...], usage: {...} }`。
- `from supportpilot.kb import embed as emb` 导入模块本身,后面要改它里面的 `_client`。
- `class FakeEmbeddings:` 假的 `client.embeddings`:只实现 `create` 这一个方法。
- `self.batches: list[list[str]] = []` 记下每次请求收到的文本,测试用来数请求。
- `def create(self, model: str, input: list[str]) -> SimpleNamespace:` 参数名叫 `input` 是为了和真接口的关键字参数对上。
- `embedding=[float(len(t)), 1.0] + [0.0] * (self.dim - 2)` 假向量:前两个数是「文本长度」和 1,其余补 0。这样不同长度的文本向量不同,第一个分量随长度增大。
- `data.reverse()  # 故意倒着返回,考验 embed() 有没有按 index 排回来` 真服务偶尔也不按顺序,假的就故意倒着给。
- `usage=SimpleNamespace(total_tokens=len(input) * 3)` 假的用量:一条文本 3 个 token。
- `def fake(monkeypatch: pytest.MonkeyPatch) -> FakeEmbeddings:` 夹具。`monkeypatch` 是 pytest 自带的,测试结束后自动还原所有改动([Day 74](/blog/agent-zero/day-074-pytest-4/))。
- `monkeypatch.setattr(emb, "_client", lambda: SimpleNamespace(embeddings=f))` 把 `_client()` 换成一个返回假客户端的函数。因为 `embed()` 每次调用 `_client()`,所以立刻生效。这就是第一步把客户端写成函数的好处。
- `monkeypatch.setitem(emb.usage, "requests", 0)` 把记账字典清零,测试结束自动还原,免得测试之间串账。
- `texts = ["一" * n for n in range(1, 26)]  # 25 条,长度各不相同` 25 条文本。
- `assert [len(b) for b in fake.batches] == [10, 10, 5]` 25 条按 10 条一批:10、10、5。
- `assert emb.usage == {"requests": 3, "tokens": 75}` 3 次请求,25 条乘 3 个 token。
- `assert out[0, 0] < out[24, 0]` 第 0 行对应最短的文本、第 24 行对应最长的,说明按 `index` 排回来了。
- `assert np.allclose(np.linalg.norm(out, axis=1), 1.0)` `allclose` 判断两个数组近似相等,浮点数不能用 `==`。
- `assert fake.batches == []` 空列表和全空白文本,都不应该发出任何请求。
- `monkeypatch.setattr(emb, "_client", lambda: SimpleNamespace(embeddings=FakeEmbeddings(8)))` 这次假服务返回 8 维向量,但配置是 1024,应该被维度检查拦住。
</div>

`ingest()` 的测试 `tests/test_ingest.py`:

```python
# supportpilot/tests/test_ingest.py
"""ingest() 的测试:用假 embedding(不联网),连真库,但每个测试都在会回滚的事务里,不动库里的真数据。"""

from dataclasses import replace

import numpy as np
import psycopg
import pytest
from helpers import fake_embed, make
from psycopg.rows import DictRow

from supportpilot.kb import chunker
from supportpilot.kb.chunker import chunk_article
from supportpilot.kb.ingest import fingerprint, ingest, write_article


def n_docs(conn: psycopg.Connection[DictRow]) -> int:
    row = conn.execute("SELECT count(*) AS n FROM kb.docs").fetchone()
    return row["n"] if row else -1


def n_chunks(conn: psycopg.Connection[DictRow]) -> int:
    row = conn.execute("SELECT count(*) AS n FROM kb.chunks").fetchone()
    return row["n"] if row else -1


def test_fingerprint_tracks_everything_that_is_stored():
    a = make("KB-t-001")
    base = fingerprint(a, chunk_article(a), "m")
    assert fingerprint(a, chunk_article(a), "m") == base
    assert fingerprint(a, chunk_article(a), "other-model") != base
    assert fingerprint(replace(a, url_path="/moved"), chunk_article(a), "m") != base
    b = make("KB-t-001", "多一句。")
    assert fingerprint(b, chunk_article(b), "m") != base


def test_fingerprint_changes_when_hat_recipe_changes(monkeypatch: pytest.MonkeyPatch):
    a = make("KB-t-001")
    before = fingerprint(a, chunk_article(a), "m")
    monkeypatch.setattr(chunker, "make_hat", lambda title, heading: f"新帽子 {title} {heading}")
    assert fingerprint(a, chunk_article(a), "m") != before


@pytest.mark.db
def test_add_skip_update_delete(clean: psycopg.Connection[DictRow]):
    a, b = make("KB-t-001"), make("KB-t-002")
    r1 = ingest(clean, [a, b], fake_embed)
    assert (r1.added, r1.updated, r1.skipped, r1.deleted, r1.chunks) == (2, 0, 0, 0, 4)
    r2 = ingest(clean, [a, b], fake_embed)
    assert (r2.added, r2.updated, r2.skipped, r2.chunks) == (0, 0, 2, 0)
    r3 = ingest(clean, [make("KB-t-001", "改了。"), b], fake_embed)
    assert (r3.updated, r3.skipped, r3.chunks) == (1, 1, 2)
    r4 = ingest(clean, [b], fake_embed)
    assert (r4.deleted, r4.skipped) == (1, 1)
    assert n_docs(clean) == 1
    assert n_chunks(clean) == 2  # 删掉文章,它的块跟着级联删除


@pytest.mark.db
def test_recipe_change_triggers_reingest(clean: psycopg.Connection[DictRow], monkeypatch: pytest.MonkeyPatch):
    a = make("KB-t-001")
    ingest(clean, [a], fake_embed)
    monkeypatch.setattr(chunker, "make_hat", lambda title, heading: f"新帽子 {title} {heading}")
    assert ingest(clean, [a], fake_embed).updated == 1


@pytest.mark.db
def test_wrong_vector_shape_writes_nothing(clean: psycopg.Connection[DictRow]):
    def short(texts: list[str]) -> np.ndarray:
        return np.zeros((len(texts), 8), dtype=np.float32)

    with pytest.raises(ValueError, match="向量形状"):
        ingest(clean, [make("KB-t-001")], short)
    assert n_docs(clean) == 0


@pytest.mark.db
def test_failed_write_keeps_the_old_version(clean: psycopg.Connection[DictRow]):
    a = make("KB-t-001")
    ingest(clean, [a], fake_embed)
    chunks = chunk_article(a)
    bad = fake_embed([c.embed_text for c in chunks])
    bad[1, :] = np.nan  # pgvector 不收 NaN,第二块插入时报错
    with pytest.raises(psycopg.errors.DataException):
        write_article(clean, a, chunks, bad, "new")
    row = clean.execute("SELECT content_hash FROM kb.docs WHERE id = 'KB-t-001'").fetchone()
    assert row is not None and row["content_hash"] != "new"
    assert n_chunks(clean) == 2
```

<div class="line-notes">

- `from helpers import fake_embed, make` `helpers.py` 和测试文件在同一个目录里,pytest 会把 `tests/` 加进导入路径,所以能直接 `import helpers`。
- `def n_docs(conn: psycopg.Connection[DictRow]) -> int:` 数一下库里有几篇文章的小工具。`row["n"] if row else -1` 是因为 `fetchone()` 可能返回 `None`,类型检查器要求处理。
- `def n_chunks(` 同理,数块。
- `def test_fingerprint_tracks_everything_that_is_stored():` 纯函数测试,不连库。五个断言覆盖:同样的输入同样的指纹、换模型名变、换 `url_path` 变、正文多一句变。
- `assert fingerprint(replace(a, url_path="/moved"), chunk_article(a), "m") != base` `dataclasses.replace` 复制一个对象并改一个字段。
- `def test_fingerprint_changes_when_hat_recipe_changes(monkeypatch: pytest.MonkeyPatch):` 第五步那个坑的回归测试:把 `make_hat` 换成别的写法,指纹必须变。
- `monkeypatch.setattr(chunker, "make_hat", lambda title, heading: f"新帽子 {title} {heading}")` 和 `i3.py` 里手动改一样,只是测试结束会自动还原。
- `@pytest.mark.db` 标记「要连数据库」,[Day 446](/blog/agent-zero/day-446-makefile-readme/) 的 `make test` 会排除它,`make test-all` 才跑。
- `def test_add_skip_update_delete(clean: psycopg.Connection[DictRow]):` 用 `clean` 夹具:库是空的、测完回滚。
- `r1 = ingest(clean, [a, b], fake_embed)` 两篇新文章:新增 2、写入 4 块(每篇 2 节)。
- `r3 = ingest(clean, [make("KB-t-001", "改了。"), b], fake_embed)` 第一篇改了一句话:更新 1、跳过 1、写 2 块。
- `r4 = ingest(clean, [b], fake_embed)` 目录里只剩 b:删除 1,跳过 1。
- `assert n_chunks(clean) == 2  # 删掉文章,它的块跟着级联删除` 块也只剩 b 的 2 块。
- `def test_wrong_vector_shape_writes_nothing(clean: psycopg.Connection[DictRow]):` 假的 embed 返回 8 维,应该报 `ValueError`,库里一篇都不能有。
- `with pytest.raises(ValueError, match="向量形状"):` 期望的异常和信息里的关键词。
- `bad[1, :] = np.nan  # pgvector 不收 NaN,第二块插入时报错` 和 `i2.py` 一样的办法,测事务。
- `with pytest.raises(psycopg.errors.DataException):` 期望驱动抛数据异常。
- `assert row is not None and row["content_hash"] != "new"` 指纹没变成 `new`,说明旧版本还在。
- `assert n_chunks(clean) == 2` 块数还是原来的 2。
</div>

```bash
uv run pytest tests/test_embed.py tests/test_ingest.py -q
```

```text
...........                                                              [100%]
11 passed in 1.01s
```

11 条全过。这些测试一次联网都没有,一次真 embedding 都没调(`ingest` 的真实运行已经在前面手工跑过了)。再确认测试没有弄脏真库,数一下:

```bash
psql supportpilot -c "SELECT count(*) AS docs, (SELECT count(*) FROM kb.chunks) AS chunks FROM kb.docs"
```

```text
 docs | chunks 
------+--------
   62 |    150
(1 row)
```

还是 62 篇、150 块。回滚夹具起作用了。今天结束时仓库多了:

```text
src/supportpilot/kb/embed.py       embed、embed_one、cosine、usage
src/supportpilot/kb/ingest.py      ingest、write_article、fingerprint、Report
scripts/ingest_kb.py               命令行入口
tests/helpers.py  tests/test_embed.py  tests/test_ingest.py   conftest.py 里多了 clean 夹具
Makefile / README.md               make kb 多了一步
```

## 动手练习

**练习 1:看看库里存了什么。** 用 `psql` 查三件事:每个分类各有多少块;库里最长的 3 块是哪几块;库里一共多少篇文章、多少块。

<details><summary>参考答案</summary>

```bash
psql supportpilot -c "SELECT d.category, count(*) AS chunks FROM kb.chunks c JOIN kb.docs d ON d.id = c.doc_id GROUP BY 1 ORDER BY 2 DESC"
```

```text
 category  | chunks 
-----------+--------
 error     |     48
 plans     |     21
 billing   |     19
 technical |     17
 refund    |     14
 account   |     13
 invoice   |     10
 api       |      8
(8 rows)
```

`JOIN` 把块表和文章表按 `doc_id = id` 连起来,才能拿到分类;`GROUP BY 1` 按第一列(分类)分组,`count(*)` 数每组多少行,`ORDER BY 2 DESC` 按第二列从大到小排。报错码(`error`)那 12 篇文章每篇 4 节,48 块,占了近三分之一,所以第六步检查「同名小标题」时那么多块撞名。

```bash
psql supportpilot -c "SELECT doc_id, chunk_index, heading, length(content) AS chars FROM kb.chunks ORDER BY length(content) DESC LIMIT 3"
```

```text
    doc_id     | chunk_index | heading  | chars 
---------------+-------------+----------+-------
 KB-plans-001  |           1 | 功能差异 |   178
 KB-plans-001  |           0 | 价格     |   126
 KB-refund-003 |           0 | 计算方法 |    93
(3 rows)
```

最长的一块 178 个字,和 Day 448 `chunk_report` 里的最长数字对得上。最后一条:

```text
 docs | chunks 
------+--------
   62 |    150
(1 row)
```

`62 | 150`,这两个数就是今天的验收数字。

</details>

**练习 2:一次把所有文本凑在一起发。** 现在 `ingest()` 是一篇文章发一次 embedding 请求(62 次)。试试把所有要写的文章的文本凑成一个大列表,一次调 `embed()`(它内部还是 10 条一批),再按篇分回去写库。请求数和用时怎么变?

<details><summary>参考答案</summary>

```python
# supportpilot/scratch/ex_batch.py
"""把所有要向量化的文本凑在一起发,看请求数和用时。"""

import time
from pathlib import Path

from supportpilot.db import connect
from supportpilot.kb.chunker import chunk_article, load_articles
from supportpilot.kb.embed import embed, usage
from supportpilot.kb.ingest import fingerprint, write_article

articles = load_articles(Path("data/kb"))
t0 = time.perf_counter()
with connect() as conn:
    conn.execute("DELETE FROM kb.docs")  # 清空,当成第一次导入
    pending = [(a, chunk_article(a)) for a in articles]
    texts = [c.embed_text for _, chunks in pending for c in chunks]
    vectors = embed(texts)  # 150 条一次凑齐,内部还是 10 条一批
    start = 0
    for a, chunks in pending:
        vecs = vectors[start : start + len(chunks)]
        write_article(conn, a, chunks, vecs, fingerprint(a, chunks, "BAAI/bge-m3"))
        start += len(chunks)
secs = time.perf_counter() - t0
print(f"{len(texts)} 块,请求 {usage['requests']} 次,{usage['tokens']} token,用时 {secs:.1f} 秒")
```

<div class="line-notes">

- `conn.execute("DELETE FROM kb.docs")  # 清空,当成第一次导入` 先清库,保证所有文章都要重新写。
- `pending = [(a, chunk_article(a)) for a in articles]` 先把每篇文章切好块,保存成 `(文章, 块列表)`。
- `texts = [c.embed_text for _, chunks in pending for c in chunks]` 所有文章的所有块,连成一个 150 条的长列表。`_` 表示这里用不上文章本身。
- `vectors = embed(texts)  # 150 条一次凑齐,内部还是 10 条一批` 一次调用,返回 `(150, 1024)`。
- `vecs = vectors[start : start + len(chunks)]` 按这篇文章有几块,从大数组里切出属于它的那几行。`start` 是这篇文章第一块在大列表里的位置。
- `write_article(conn, a, chunks, vecs, fingerprint(a, chunks, "BAAI/bge-m3"))` 每篇还是一个事务。模型名在这个实验里写死了,正式代码要读配置。
- `start += len(chunks)` 往后挪到下一篇的起点。
</div>

```text
150 块,请求 15 次,6222 token,用时 3.3 秒
```

请求数从 62 降到 15,用时从 8 到 12 秒降到 3.3 秒,token 数不变(6,222)。快在哪儿:请求次数少了,网络往返的等待就少了。代价是:要在内存里同时攥着所有文章的块和向量(150 块无所谓,十万块要分段),而且一旦中途 embedding 失败,**整批都没有向量,一篇都写不了**,而一篇一调的做法里,前面的文章已经写完了。所以这是个取舍,不是谁一定更好。我们的知识库小、embedding 免费,没必要这么改。要是改成付费服务,或者知识库增长到上万篇,这个改法才值得,到时候也要加上分段(比如每 100 篇一批)。

(这个脚本跑完以后,`ingest_kb.py` 再跑是 `skipped=62`,因为它写的指纹和 `ingest()` 算的是同一个函数。)

</details>

**练习 3:只改 `updated_at`。** 把 `scripts/gen_kb.py` 里的 `UPDATED = "2026-09-15"` 临时改成 `"2026-10-01"`,跑 `make kb`。文章的标题和正文一个字没变,会发生什么?这对吗?

<details><summary>参考答案</summary>

```bash
sed -i '' 's/UPDATED = "2026-09-15"/UPDATED = "2026-10-01"/' scripts/gen_kb.py   # macOS 的 sed;Linux 去掉 ''
make kb
```

```text
uv run python scripts/gen_kb.py
wrote 62 articles to /Users/你/supportpilot/data/kb
uv run python scripts/check_kb.py
检查 62 篇文章: 通过
uv run python scripts/ingest_kb.py
added=0 updated=62 skipped=0 deleted=0 chunks_written=150
embedding 请求 62 次,6222 token,用时 8.8 秒
```

`updated=62`:62 篇全部被判定为变过,150 块全部重新向量化,请求 62 次。标题和正文没变,向量其实一模一样,白花了 8 秒。原因是第五步的指纹把 `updated_at` 也算进去了:库里 `kb.docs.updated_at` 那一列要跟着文章走,如果指纹不管它,日期改了库里不更新,就成了另一种「悄悄对不上」。

这对不对?在我们这里无所谓:免费、8 秒。换成付费 embedding 或者大知识库,就值得拆开:再存一个「向量指纹」(只算模型名和每块 `embed_text`),只改元数据时只更新 `kb.docs` 那一行,不动块和向量。需要多一列或者多一张表,多一个分支,所以我没有现在就做,等真的疼了再说。改回去:

```bash
sed -i '' 's/UPDATED = "2026-10-01"/UPDATED = "2026-09-15"/' scripts/gen_kb.py
make kb
```

```text
uv run python scripts/gen_kb.py
wrote 62 articles to /Users/你/supportpilot/data/kb
uv run python scripts/check_kb.py
检查 62 篇文章: 通过
uv run python scripts/ingest_kb.py
added=0 updated=62 skipped=0 deleted=0 chunks_written=150
embedding 请求 62 次,6222 token,用时 8.6 秒
```

改回去又是 `updated=62`:日期又变了一次。这也说明指纹确实只看内容,不管「这是不是回到了以前的样子」。

</details>

**练习 4:中途失败,重跑能补上吗?** 写一条测试:三篇文章,第三篇的 embedding 请求「失败」(抛 `RuntimeError`),验证前两篇仍然写进库,然后重跑一次,只补第三篇。

<details><summary>参考答案</summary>

加进 `tests/test_ingest.py`:

```python
@pytest.mark.db
def test_failure_midway_keeps_finished_articles(clean: psycopg.Connection[DictRow]):
    arts = [make("KB-t-001"), make("KB-t-002"), make("KB-t-003")]

    def flaky(texts: list[str]) -> np.ndarray:
        if "KB-t-003" in texts[0]:  # 第三篇的 embedding 请求「失败」
            raise RuntimeError("embedding 服务 503")
        return fake_embed(texts)

    with pytest.raises(RuntimeError, match="503"):
        ingest(clean, arts, flaky)
    assert n_docs(clean) == 2  # 前两篇已经写完,不会因为第三篇失败而回滚
    report = ingest(clean, arts, fake_embed)  # 重跑:前两篇指纹没变直接跳过,只补第三篇
    assert (report.added, report.skipped) == (1, 2)
```

<div class="line-notes">

- `arts = [make("KB-t-001"), make("KB-t-002"), make("KB-t-003")]` 三篇文章,编号不同,内容各有「标题 KB-t-00X」。
- `def flaky(texts: list[str]) -> np.ndarray:` 一个会出问题的 embedding 函数。
- `if "KB-t-003" in texts[0]:  # 第三篇的 embedding 请求「失败」` 靠文本里带的编号判断是不是第三篇(每篇的帽子里有标题)。
- `raise RuntimeError("embedding 服务 503")` 模拟服务端 503。
- `return fake_embed(texts)` 其余正常返回。
- `with pytest.raises(RuntimeError, match="503"):` 期望整个 `ingest()` 抛出这个异常。
- `assert n_docs(clean) == 2  # 前两篇已经写完,不会因为第三篇失败而回滚` 一篇一个事务,前两篇早已提交(在 `clean` 这层事务里表现为 savepoint 已释放),不受第三篇失败影响。
- `report = ingest(clean, arts, fake_embed)  # 重跑` 用正常的函数再导入一次。
- `assert (report.added, report.skipped) == (1, 2)` 前两篇指纹没变,跳过;第三篇是新增。
</div>

```text
.......                                                                  [100%]
7 passed in 1.09s
```

7 条全过(6 条原有的加这 1 条)。这条测试把第四步末尾那段话变成了会报警的东西:以后谁要是把导入改成「整批一个事务」,这条会红,他得先想清楚两种做法的取舍。

</details>

**验收标准:** `psql` 里 `kb.docs` 62 行、`kb.chunks` 150 行;第二次 `ingest_kb.py` 打印 `skipped=62` 且请求数为 0;`uv run pytest tests/test_embed.py tests/test_ingest.py -q` 全绿;你能不看稿解释:指纹里为什么要有 `embed_text` 和模型名,以及 embedding 为什么放在事务外面。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 增量导入 | 只处理变了的文章,没变的跳过。例:第二次跑 `ingest_kb.py` 是 `skipped=62`。 |
| 内容指纹 | 把一篇文章(及它会被怎样处理)压成一个短字符串,内容变了它就变。我们取 SHA-256 的前 16 个字符。 |
| 事务(transaction) | 一组 SQL 要么全部成功,要么全部撤销。`with conn.transaction():` 里出了异常,里面做过的写入全部回滚。 |
| 回滚(rollback) | 事务失败时把库恢复到事务开始前的样子。 |
| savepoint | 嵌套事务的存档点:内层事务失败只回滚到这个点,外层继续。测试夹具里的 `clean` 靠它让 `ingest()` 里的事务和外层的回滚共存。 |
| 级联删除(`ON DELETE CASCADE`) | 删掉一行时,引用它的行自动一起删。删一篇文章,它的块跟着没了。 |
| 懒创建 | 对象不在导入时建,等第一次要用才建。`_client()` 就是这样,好处是没配 key 也能 import。 |
| 假对象(fake) | 测试里顶替真东西的简化替身。`fake_embed` 顶替联网的 embedding,`FakeEmbeddings` 顶替 SDK 的客户端。 |
| `monkeypatch` | pytest 自带的夹具,临时替换某个对象或字典项,测试结束自动还原。 |
| `usage` | `embed.py` 里的记账字典,记这个进程里一共发了几次请求、用了多少 token。 |

## 常见误区

**指纹只算正文。** 我第一版就是这么写的,而且前四种情况都跑得好好的。它的毛病在第五步才暴露:只要改动不体现在文章正文里(帽子写法、切块参数、embedding 模型),库里的向量就悄悄过期了。指纹要覆盖「所有会影响写进库的东西」。

**用文件修改时间(mtime)判断变没变。** `gen_kb.py` 每次都会重写 62 个文件,mtime 全变了,可内容一个字没动。用 mtime 会让每次导入都重做一遍,用内容哈希就不会。反过来,有人 `touch` 一个文件也不该触发重导。

**在事务里调 embedding。** 事务里每多等一秒,数据库连接就多占一秒,持有的行锁也不释放。先拿到向量,再开事务,事务里只做几条毫秒级的 SQL。

**把一篇一个事务当成「整批一个事务」。** 不是:第 30 篇失败,前 29 篇已经提交了。好处是重跑能接着来;坏处是中途失败后库里是「部分更新」的状态。要不要整批原子,取决于你能不能容忍这种中间状态,这里能,因为每篇文章自己是完整的。

**测试直接写真库。** 导入测试要写表、要删表,不套回滚事务,一跑测试就把你辛苦导好的 62 篇文章清空了。`clean` 夹具的 `force_rollback=True` 就是干这个的。

**以为 `ingest()` 能防并发。** 我没有加锁,两个人同时跑 `make kb` 会交错执行,可能互相覆盖对方刚写的文章,每篇各自的事务是完整的,但最终库里是谁的版本不确定。我没有实测并发,只是指出这里没有防护;目前一个人在本机跑,不需要。

## 学习资料

### 文档与文章

- [硅基流动 · 创建嵌入请求](https://docs.siliconflow.cn/docs/api/embeddings-post):今天调的接口的官方文档,看各模型的最大 token 数和 `dimensions` 参数。
- [BAAI/bge-m3 模型卡](https://huggingface.co/BAAI/bge-m3):模型作者写的说明,看开头它支持的语言、长度和三种检索方式(我们只用稠密向量这一种)。
- [psycopg 3 · 事务管理](https://www.psycopg.org/psycopg3/docs/basic/transactions.html):`conn.transaction()`、`force_rollback`、嵌套事务(savepoint)都在这一页,今天测试夹具用的就是它。
- [pgvector 官方 README](https://github.com/pgvector/pgvector):看 `Upsert vectors`、`Distance` 和 HNSW 索引几节。
- [Python 文档 · hashlib](https://docs.python.org/3/library/hashlib.html):读开头 `sha256` 的例子和 `hexdigest()`。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1PSivBYEiX&autoplay=0&high_quality=1" title="不知道RAG知识库文档怎么更新?5分钟带你吃透大厂都在用的RAG知识库文档更新方案" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>java架构师徐庶 · RAG 知识库文档怎么更新 · 5 分钟,讲的就是今天这套「按内容判断、只更新变化的部分」的思路,看完对照 `ingest()`。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1oNv8BPE2m&autoplay=0&high_quality=1" title="15分钟弄懂Token和Embedding -- 详解LLM与RAG的数据处理机制" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>隔壁的程序员老王 · 15分钟弄懂Token和Embedding · 15 分钟。把 token 和 embedding 放在一条线上讲,对应今天「按 token 计费、输出一串向量」。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/OATCgQtNX2o" title="Text embeddings & semantic search" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hugging Face · Text embeddings & semantic search · 英文。Hugging Face 课程里的一集,讲句子怎么变成向量、再拿向量做语义搜索。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/b4b8ktEV4Bg" title="Hashing Algorithms and Security - Computerphile" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Computerphile · Hashing Algorithms and Security · 英文,约 10 分钟,哈希是什么、为什么改一点点输出就面目全非,对应今天的内容指纹。</figcaption>
</figure>

### 书籍

- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly,2017)第 7 章讲事务,把回滚、隔离级别讲得很透,读完能理解为什么「一批写入一起成败」值钱。
- Chip Huyen《AI Engineering》(O'Reilly,2025)。第 6 章「RAG and Agents」讲检索增强,里面有 embedding 检索和索引更新的内容。

### 开源项目与代码

- [pgvector/pgvector-python](https://github.com/pgvector/pgvector-python):今天用的 `register_vector` 就在这里,看它怎么让 numpy 数组直接当 `vector` 参数传给 psycopg。
- [pgvector/pgvector](https://github.com/pgvector/pgvector):扩展本身,README 里有各种距离运算符和索引的说明。

## 自测

**1. 为什么指纹要算 `embed_text` 和模型名,只算正文不行?**

<details><summary>答案</summary>

库里存的向量由「帽子的写法、切块规则、embedding 模型、正文」共同决定。只算正文,这些别的东西变了指纹不变,导入会把文章跳过,库里的向量悄悄过期,检索质量下降却没有任何报错。`embed_text` 已经包含了帽子和切块的结果,再加上模型名,就覆盖了所有会影响向量的因素。

</details>

**2. embedding 请求为什么放在事务外面?**

<details><summary>答案</summary>

网络请求慢、可能失败、可能重试。放在事务里,数据库连接和写入的锁在这段时间一直占着,别的查询要排队等。先拿到向量,再开事务,事务里只做几条毫秒级的 SQL,持有锁的时间极短,失败也不影响库。

</details>

**3. 一篇一个事务和整批一个事务,各有什么优缺点?今天为什么选前者?**

<details><summary>答案</summary>

一篇一个事务:中途失败,前面写完的保留,重跑只补剩下的;缺点是中途失败时库处于「一部分已更新」的状态。整批一个事务:要么全成要么全不成,库里永远是一致的整体;缺点是一篇失败就全部回滚,而且事务很长,占连接和锁的时间久。我们的每篇文章自己是完整的,「部分更新」可以接受,重跑能接着做,所以选一篇一个事务。

</details>

**4. `fake_embed` 返回的是随机向量,为什么还能拿来测 `ingest()`?哪些东西它测不了?**

<details><summary>答案</summary>

`ingest()` 要测的是流程:增删改跳过的计数对不对、事务有没有生效、级联删除有没有发生、形状检查有没有拦住。这些和向量里的数值没关系,只要形状对就行。它测不了「向量有没有语义」,比如搜索结果排序对不对,那要用真的 embedding,放在 `llm` 标记的测试里。

</details>

**5. (面试题)知识库的文章每天都在更新,怎么做到向量库跟着更新又不每次全量重建?换了 embedding 模型怎么办?**

<details><summary>答案</summary>

给每篇文档(或每块)存一个内容指纹,导入时比较:没变就跳过,变了只重做这一篇(旧块删掉、新块写入放在一个事务里),源头已经没了的就删除。指纹要覆盖所有会影响向量的因素,包括切块规则和 embedding 模型名,这样换模型会自动触发全量重做。换模型还要注意:新旧模型的向量不能混在同一个索引里比较,维度不同还得改表结构;要么在旁边建一张新表、全部重做完再切换流量,要么停机重建。

</details>

**6. 导入脚本跑到一半,电脑断电了。重新跑会发生什么?**

<details><summary>答案</summary>

正在写的那一篇的事务没有提交,数据库会自动回滚,库里不会有半篇文章。前面已经提交的文章保留,指纹没变,重跑时被跳过;断电时正在处理的和后面没处理的,指纹对不上或根本不存在,重跑时会被补写。所以重跑一次就恢复完整,不需要手工清理。

</details>

## 明天预告

明天是 Day 450 · 知识库(三):混合检索。今天把 150 块连同向量存进了 `kb.chunks`,明天从库里把它们找出来:向量那一路用 pgvector 的 `<=>` 排序,关键词那一路用 BM25,两路的结果按名次用 RRF 合起来。我会拿今天的 40 条问法再加 12 条错误码、专有名词一类的字面问法,量一量混合检索到底比纯向量好多少。说在前面:我实测的结果和我原来预期的不一样。
