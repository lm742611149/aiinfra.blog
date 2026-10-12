---
title: 'Day 17 · 向量数据库:pgvector 上手、HNSW 索引与元数据过滤'
description: '把昨天的 numpy 索引搬进 Postgres。Docker 起 pgvector,建表、写入、用 SQL 做向量检索和按分类过滤,搞懂 HNSW 为什么快、为什么带过滤条件时会「少返回结果」,最后和 Milvus、Qdrant、Chroma、Elasticsearch 做一张取舍表。'
pubDate: 2026-10-12
regime: none
tags: ['pgvector', 'postgres', 'hnsw', 'vector-database', 'agent-60']
series: 'agent-60'
day: 17
lang: 'zh'
---

## 今天要解决的问题

昨天的 RAG 用两个文件当数据库:`vectors.npy` 和 `chunks.json`。42 个块,一次矩阵乘法毫秒级出结果,作为学习工具它完美。但如果你把它部署成客服系统,马上会碰到这些事:

- 运营改了一篇文章,你得把整个索引重建一遍,因为 numpy 数组没有「更新第 17 行」这种操作(其实有,但你还得自己管文件锁、并发、备份)。
- 产品说「这个问题只在退款类文章里找」,你得自己写过滤逻辑。
- 三台服务器同时跑客服 Agent,每台都要有一份索引文件,怎么同步?
- 知识库涨到 100 万块,每次查询都要把 4 GB 的矩阵和问题向量乘一遍。

这些问题数据库早就解决过了,所以我们需要向量数据库。今天用的是 pgvector:它不是一个独立的数据库,而是 Postgres 的一个扩展。装上之后,Postgres 多了一种叫 `vector` 的列类型和几个距离操作符,其余一切照旧:事务、索引、备份、权限、SQL。

今天结束时你应该能做到:

1. 用 Docker 起一个带 pgvector 的 Postgres,建好知识库表。
2. 把 Day 16 的块和向量写进去,支持增量更新(内容没变的块不重算 embedding)。
3. 用 SQL 写向量检索,并加上按分类过滤。
4. 讲清楚 HNSW 索引的原理、两个关键参数,以及「过滤后结果变少」是怎么回事。
5. 说出 pgvector、Milvus、Qdrant、Chroma、Elasticsearch 各自适合什么场景。

预计用时 4 小时。前置:Day 16 的 `chunking.py` 和 `build_index.py`;会一点 SQL(后端工程师应该没问题);电脑上装了 Docker。

## 为什么我推荐 pgvector

市面上的向量数据库有十几种,招聘 JD 里也常见 Milvus、Qdrant、Elasticsearch 这些名字。我在课程里选 pgvector,理由很实际:

你大概率已经会 Postgres 或 MySQL 了。pgvector 让你用已经会的 SQL 做向量检索,学习成本几乎只有「多了一种列类型」。而且 CloudLedger 的业务数据(客户、订阅、发票)本来就在关系库里,知识库也放在同一个 Postgres 里,一个 SQL 就能把「文章向量相似度」和「这个客户是哪个套餐」关联起来,少维护一套系统。运维上,备份、监控、权限、高可用,都复用现有的 Postgres 方案。

它的上限也足够高。几百万量级的向量,pgvector 配 HNSW 索引跑得很好。真到了上亿规模、需要分布式、需要 GPU 加速,再考虑 Milvus 这类专门的系统。大部分公司的知识库远没到那个量级。

当然,面试里被问到「为什么不用 Milvus」,你也要能讲出取舍,今天最后一节专门讲。

## 起一个 pgvector

```bash
docker run -d --name agent60-pg \
  -e POSTGRES_PASSWORD=agent60 \
  -e POSTGRES_DB=agent60 \
  -p 5432:5432 \
  -v agent60-pgdata:/var/lib/postgresql/data \
  pgvector/pgvector:0.8.7-pg17
```

几个参数说明一下。`pgvector/pgvector` 是 pgvector 官方维护的镜像,本质就是官方 Postgres 镜像加装了扩展。我 2026-10-12 在 [Docker Hub](https://hub.docker.com/r/pgvector/pgvector) 上看到最新的是 0.8.7,有 pg13 到 pg18 各个版本,课程用 pg17。标签写死版本号,别用 `latest`,不然哪天镜像更新了,你的环境悄悄变了。`-v agent60-pgdata:...` 是数据卷,容器删了数据还在。

国内拉 Docker Hub 镜像可能很慢甚至失败,这时候要给 Docker 配镜像加速器,或者走代理。这个坑太普遍了,如果卡住,不要在这里耗一下午,换个网络或者问问身边的人。

把连接串加到 `.env`:

```bash
# agent-60-lab/.env  新增
PG_DSN=postgresql://postgres:agent60@localhost:5432/agent60
```

装 Python 依赖:

```bash
uv add "psycopg[binary]" pgvector
```

`psycopg` 是 Postgres 官方推荐的 Python 驱动(第 3 版),`pgvector` 是 pgvector 官方的 Python 适配包,让 numpy 数组可以直接作为 SQL 参数传进去。

## 建表

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS kb_chunks (
    id            text PRIMARY KEY,          -- kb-002#1
    doc_id        text NOT NULL,             -- kb-002
    title         text NOT NULL,
    category      text NOT NULL,
    section       text NOT NULL,
    content       text NOT NULL,             -- 带标题前缀的正文,和送去 embedding 的一致
    content_hash  text NOT NULL,             -- 内容的 sha256,增量更新用
    embedding     vector(1024) NOT NULL,
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kb_chunks_category_idx ON kb_chunks (category);

CREATE INDEX IF NOT EXISTS kb_chunks_embedding_hnsw
    ON kb_chunks USING hnsw (embedding vector_cosine_ops);
```

`vector(1024)` 声明了维度,必须和 embedding 模型输出的维度一致,插入 1536 维的向量会直接报错。这个报错反而是好事,它帮你挡住了「索引和查询用了不同模型」的事故。

`USING hnsw (embedding vector_cosine_ops)` 建 HNSW 索引,`vector_cosine_ops` 表示这个索引是为余弦距离服务的。如果你查询时用的是 L2 距离(`<->`),这个索引就用不上。**索引的距离类型和查询的操作符必须对应**,这是 pgvector 最常见的「明明建了索引为什么还是慢」的原因。

`content_hash` 这一列是给增量更新用的,后面会讲。

关于维度,还有一个硬限制要知道:根据 [pgvector 文档](https://github.com/pgvector/pgvector),`vector` 类型的 HNSW 和 IVFFlat 索引最多支持 2000 维。如果你选了 2048 维的 embedding(比如百炼 text-embedding-v4 的最高档),建索引会失败。解决办法是用 `halfvec`(半精度,索引上限 4000 维),或者让 embedding 接口返回更低的维度。课程默认 1024 维,不会碰到。

## 写入和增量更新

```python
# agent-60-lab/w3/pg_store.py
"""知识库的 pgvector 存储:建表、增量写入、检索。"""
import hashlib
import os
from pathlib import Path

import numpy as np
import psycopg
from dotenv import load_dotenv
from pgvector.psycopg import register_vector

load_dotenv()
DSN = os.environ["PG_DSN"]
DIM = int(os.environ.get("EMB_DIM", "1024"))

SCHEMA = f"""
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS kb_chunks (
    id text PRIMARY KEY, doc_id text NOT NULL, title text NOT NULL,
    category text NOT NULL, section text NOT NULL, content text NOT NULL,
    content_hash text NOT NULL, embedding vector({DIM}) NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_chunks_category_idx ON kb_chunks (category);
CREATE INDEX IF NOT EXISTS kb_chunks_embedding_hnsw
    ON kb_chunks USING hnsw (embedding vector_cosine_ops);
"""


def connect() -> psycopg.Connection:
    conn = psycopg.connect(DSN, autocommit=True)
    conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
    register_vector(conn)  # 必须在扩展创建之后调用,否则找不到 vector 类型
    return conn


def init_schema(conn: psycopg.Connection) -> None:
    conn.execute(SCHEMA)


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sync_chunks(conn: psycopg.Connection, chunks: list, embed_fn) -> dict:
    """把切好的块同步进数据库:新增的和改过的才算 embedding,消失的删除。"""
    existing = dict(conn.execute("SELECT id, content_hash FROM kb_chunks").fetchall())
    todo = [c for c in chunks if existing.get(c.id) != sha(c.text)]
    if todo:
        vectors = embed_fn([c.text for c in todo])
        with conn.transaction():
            for c, v in zip(todo, vectors):
                conn.execute(
                    """
                    INSERT INTO kb_chunks (id, doc_id, title, category, section, content, content_hash, embedding)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        doc_id = EXCLUDED.doc_id, title = EXCLUDED.title, category = EXCLUDED.category,
                        section = EXCLUDED.section, content = EXCLUDED.content,
                        content_hash = EXCLUDED.content_hash, embedding = EXCLUDED.embedding,
                        updated_at = now()
                    """,
                    (c.id, c.doc_id, c.title, c.category, c.section, c.text, sha(c.text), v),
                )
    gone = set(existing) - {c.id for c in chunks}
    if gone:
        conn.execute("DELETE FROM kb_chunks WHERE id = ANY(%s)", (list(gone),))
    return {"total": len(chunks), "embedded": len(todo), "deleted": len(gone)}


def search(conn: psycopg.Connection, query_vec: np.ndarray, k: int = 4,
           categories: list[str] | None = None) -> list[dict]:
    sql = """
        SELECT id, doc_id, title, category, section, content,
               1 - (embedding <=> %(q)s) AS score
        FROM kb_chunks
        {where}
        ORDER BY embedding <=> %(q)s
        LIMIT %(k)s
    """
    params = {"q": query_vec, "k": k}
    where = ""
    if categories:
        where = "WHERE category = ANY(%(cats)s)"
        params["cats"] = categories
    rows = conn.execute(sql.format(where=where), params).fetchall()
    cols = ["id", "doc_id", "title", "category", "section", "content", "score"]
    return [dict(zip(cols, r)) for r in rows]
```

再写一个同步脚本:

```python
# agent-60-lab/w3/pg_sync.py
"""离线流水线的数据库版:切块 → 只给变化的块算 embedding → 写入 pgvector。"""
from chunking import load_chunks
from embed import embed
from pg_store import connect, init_schema, sync_chunks

if __name__ == "__main__":
    conn = connect()
    init_schema(conn)
    print(sync_chunks(conn, load_chunks(), embed))
```

```bash
uv run python w3/pg_sync.py
# 第一次:{'total': 42, 'embedded': 42, 'deleted': 0}
uv run python w3/pg_sync.py
# 第二次:{'total': 42, 'embedded': 0, 'deleted': 0}
```

第二次运行 `embedded` 是 0,因为内容哈希没变,一个 embedding 都没算。现在去 `make_helpcenter.py` 里把退款政策里重复扣款的「3 个工作日」改成「5 个工作日」,重新生成文章,再同步一次,你会看到 `embedded` 只有 1 或 2。这就是增量更新。

为什么要费这个劲?CloudLedger 只有 42 块,全量重算也就几秒钟。但真实的知识库几万篇文章,运营每天改几篇。全量重建一次可能要几十分钟、花几块到几十块钱,而且重建期间索引是旧的或者是空的。用内容哈希判断变化,是生产 RAG 系统最基本的工程素养,面试问「知识库怎么更新」时这是标准答案的一部分。

`ON CONFLICT (id) DO UPDATE` 是 Postgres 的 upsert 语法,有就更新,没有就插入,写 Java 的同学可以理解成 MyBatis 里的 `insertOrUpdate`。整批写入包在 `conn.transaction()` 里,中途失败会整体回滚,不会出现一半新一半旧的状态。

`ORDER BY embedding <=> %(q)s` 里的 `<=>` 是 pgvector 的余弦距离操作符,距离 = 1 - 余弦相似度,所以越小越近,`ORDER BY` 默认升序正好取最近的。`SELECT` 里的 `1 - (embedding <=> q)` 把距离换回相似度,方便和 Day 16 的 numpy 版本对比。另外两个操作符:`<->` 是 L2 距离,`<#>` 是负内积(取负是为了让 `ORDER BY` 升序仍然是最相似的在前,第一次看到这个负号我也懵了好一会儿)。

## 把 RAG 接到数据库上

改一下 Day 16 的检索,换成从数据库查:

```python
# agent-60-lab/w3/rag_pg.py
"""Day 16 的 RAG,检索换成 pgvector,支持按分类过滤。"""
import sys

from embed import embed_one
from llm import chat
from pg_store import connect
from pg_store import search as pg_search
from rag_numpy import SYSTEM

conn = connect()


def build_prompt(question: str, hits: list[dict]) -> list[dict]:
    docs = "\n\n".join(
        f'<doc id="{h["id"]}" title="{h["title"]}">\n{h["content"]}\n</doc>' for h in hits
    )
    return [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": f"<资料>\n{docs}\n</资料>\n\n用户问题:{question}"},
    ]


def answer(question: str, k: int = 4, categories: list[str] | None = None) -> str:
    hits = pg_search(conn, embed_one(question), k=k, categories=categories)
    for h in hits:
        print(f"  {h['score']:.3f}  {h['id']:<9} [{h['category']}] {h['title']} > {h['section']}")
    return chat(build_prompt(question, hits), temperature=0)


if __name__ == "__main__":
    q = " ".join(sys.argv[1:]) or "买错了能退钱吗"
    print("不过滤:")
    print(answer(q))
    print("\n只搜「退款」类:")
    print(answer(q, categories=["退款"]))
```

注意:`from rag_numpy import SYSTEM` 会顺带执行 `rag_numpy.py` 顶部读取 `index/` 文件的代码。如果你删了 `index/` 目录会报错。更干净的做法是把 `SYSTEM` 挪到单独的 `prompts.py`,这个重构留给你,Day 21 的完整版里我会这么做。

按分类过滤在客服场景非常有用。比如 W4 我们会先用一个小模型给工单分类,分出「退款」类,再只在退款相关的文章里检索,噪音少很多。还有一类常见的过滤是权限:企业内部知识库里,销售看不到财务文档,检索时要加 `WHERE department = ANY(用户可见部门)`。**权限过滤必须在检索时做,不能检索完再让大模型「别说出来」**,后者迟早会泄漏,Day 40 讲安全时还会强调。

## HNSW:为什么快,为什么会漏

先说为什么需要索引。没有索引时,数据库对每个查询要把问题向量和表里每一行算一次距离,这叫精确最近邻,也叫暴力搜索,和 Day 16 的 numpy 版本一样。100 万行就要算 100 万次 1024 维的点积,大约 10 亿次乘加,几百毫秒到秒级,而且每个查询都这样。

HNSW(Hierarchical Navigable Small World,分层可导航小世界图)的思路有点像坐地铁找地方。你要去一个陌生小区,不会一栋楼一栋楼地问,而是先坐地铁到大致区域,再换公交到附近,最后走路找到门牌。HNSW 把所有向量组织成多层的图:

- 最上层只有很少的点,点和点之间的连线跨度很大,像地铁。
- 越往下层,点越多,连线越短,像公交和步行。
- 最底层包含所有点。

查询时从最上层的入口点出发,贪心地往离目标更近的邻居走,走不动了就下一层继续,直到最底层找到最近的一批点。每层只看少数邻居,所以总共只需要算几百到几千次距离,而不是 100 万次。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="HNSW 三层图结构示意,查询从顶层入口逐层向下贪心靠近目标">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="40" fill="var(--ink-soft)">第 2 层</text>
<text x="20" y="130" fill="var(--ink-soft)">第 1 层</text>
<text x="20" y="225" fill="var(--ink-soft)">第 0 层</text>
<text x="20" y="242" fill="var(--ink-faint)" font-size="11">(全部点)</text>
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
<circle cx="470" cy="270" r="6" fill="none" stroke="var(--mem)" stroke-width="2"/>
<text x="482" y="275" fill="var(--mem)">查询向量 q</text>
<path d="M110 35 L420 35 L420 125 L540 125" fill="none" stroke="var(--mem)" stroke-width="2.5"/>
<path d="M540 125 L500 220" fill="none" stroke="var(--mem)" stroke-width="2.5" stroke-dasharray="5 3"/>
<path d="M420 125 L420 220" fill="none" stroke="var(--ink-faint)" stroke-width="1" stroke-dasharray="2 3"/>
<line x1="420" y1="35" x2="420" y2="125" stroke="var(--ink-faint)" stroke-dasharray="2 3"/>
<circle cx="500" cy="220" r="6" fill="var(--mem)"/>
<text x="330" y="160" fill="var(--ink-soft)" font-size="11">上层跨度大,先跳到大致区域</text>
<text x="200" y="262" fill="var(--ink-soft)" font-size="11">底层在附近细找,ef_search 决定候选名单多长</text>
</g>
</svg>
<figcaption>HNSW 的查询路径示意。蓝线是贪心下降的路线,最后在第 0 层的邻域里找到离 q 最近的点。它是近似搜索:路线走偏时会错过真正最近的那个点。</figcaption>
</figure>

代价是:它是近似最近邻(ANN,Approximate Nearest Neighbor)。贪心走法可能走进一个局部最优,错过真正最近的点。衡量这个损失的指标叫召回率(recall):HNSW 返回的 top-10 里,有几个是真正的 top-10。调得好的话通常能到 95% 以上。

两个参数决定了速度和召回的平衡,pgvector 的默认值写在文档里:

建索引时的 `m` 和 `ef_construction`。 `m` 是每个点在每层最多连几个邻居(默认 16),`ef_construction` 是建图时考察的候选数(默认 64)。越大,图质量越好,召回越高,但建索引越慢、占空间越大。

查询时的 `hnsw.ef_search`。 查询时维护的候选名单长度,默认 40。越大召回越高,查询越慢。它可以按会话或按事务设置:

```sql
SET hnsw.ef_search = 100;
```

一个容易忽略的推论:`ef_search` 默认 40,意味着 HNSW 一次最多给你 40 个候选。你写 `LIMIT 100`,实际可能只返回 40 行。要取更多,得把 `ef_search` 调到不小于 LIMIT。

另一种索引 IVFFlat 也值得知道一下:它先用 k-means 把所有向量聚成若干个簇(`lists` 参数),查询时只在离问题最近的几个簇(`ivfflat.probes`)里找。建得快、占空间小,但召回一般不如 HNSW,而且要求先有数据再建索引(否则聚类没东西可聚)。pgvector 文档对两者的比较是:HNSW 的速度和召回权衡更好,代价是建得慢、更占内存,而且空表也能建(不需要训练)。我的默认选择是 HNSW。

## 过滤的坑:为什么结果变少了

这是 pgvector 里我觉得最值得写进笔记的一个坑,很多人上线后才发现。

HNSW 索引是按向量建的,不知道 `category` 是什么。当你写:

```sql
SELECT ... FROM kb_chunks
WHERE category = '退款'
ORDER BY embedding <=> $1
LIMIT 5;
```

如果规划器选择走 HNSW 索引,执行过程是:先用索引找出 `ef_search`(默认 40)个最近的候选,然后再用 `WHERE` 过滤。假设退款类文章只占 10%,40 个候选里平均只有 4 个是退款类的,过滤完只剩 4 行,你要的是 5 行。如果退款类只占 1%,很可能一行都不剩。pgvector 文档里原话就举了这个例子:条件匹配 10% 的行时,默认 `ef_search` 40 平均只能匹配到 4 行。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="HNSW 先取 40 个候选再过滤,符合条件的只剩 4 个">
<rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="30" fill="var(--ink)">① HNSW 按向量取 ef_search = 40 个候选</text>
<g fill="var(--ink-faint)">
<rect x="20" y="45" width="12" height="12"/><rect x="36" y="45" width="12" height="12"/><rect x="52" y="45" width="12" height="12"/><rect x="68" y="45" width="12" height="12" fill="var(--compute)"/><rect x="84" y="45" width="12" height="12"/><rect x="100" y="45" width="12" height="12"/><rect x="116" y="45" width="12" height="12"/><rect x="132" y="45" width="12" height="12"/><rect x="148" y="45" width="12" height="12"/><rect x="164" y="45" width="12" height="12"/>
<rect x="180" y="45" width="12" height="12"/><rect x="196" y="45" width="12" height="12" fill="var(--compute)"/><rect x="212" y="45" width="12" height="12"/><rect x="228" y="45" width="12" height="12"/><rect x="244" y="45" width="12" height="12"/><rect x="260" y="45" width="12" height="12"/><rect x="276" y="45" width="12" height="12"/><rect x="292" y="45" width="12" height="12"/><rect x="308" y="45" width="12" height="12"/><rect x="324" y="45" width="12" height="12"/>
<rect x="340" y="45" width="12" height="12"/><rect x="356" y="45" width="12" height="12"/><rect x="372" y="45" width="12" height="12"/><rect x="388" y="45" width="12" height="12" fill="var(--compute)"/><rect x="404" y="45" width="12" height="12"/><rect x="420" y="45" width="12" height="12"/><rect x="436" y="45" width="12" height="12"/><rect x="452" y="45" width="12" height="12"/><rect x="468" y="45" width="12" height="12"/><rect x="484" y="45" width="12" height="12"/>
<rect x="500" y="45" width="12" height="12"/><rect x="516" y="45" width="12" height="12"/><rect x="532" y="45" width="12" height="12"/><rect x="548" y="45" width="12" height="12"/><rect x="564" y="45" width="12" height="12" fill="var(--compute)"/><rect x="580" y="45" width="12" height="12"/><rect x="596" y="45" width="12" height="12"/><rect x="612" y="45" width="12" height="12"/>
</g>
<text x="20" y="95" fill="var(--ink)">② 再按 WHERE category = '退款' 过滤(假设退款类占 10%)</text>
<rect x="20" y="110" width="12" height="12" fill="var(--compute)"/><rect x="36" y="110" width="12" height="12" fill="var(--compute)"/><rect x="52" y="110" width="12" height="12" fill="var(--compute)"/><rect x="68" y="110" width="12" height="12" fill="var(--compute)"/>
<text x="90" y="121" fill="var(--ink-soft)">只剩 4 个,而你 LIMIT 5</text>
<text x="20" y="160" fill="var(--mem)">解决:SET hnsw.iterative_scan = relaxed_order;(pgvector 0.8+)</text>
<text x="20" y="180" fill="var(--ink-soft)">不够就继续往下扫索引,直到凑够或达到上限</text>
<text x="20" y="200" fill="var(--ink-soft)">或者:调大 ef_search / 给高频过滤条件建部分索引 / 按分类分区</text>
</g>
</svg>
<figcaption>近似索引的过滤是「先取候选再过滤」。过滤条件越严格,剩下的越少。</figcaption>
</figure>

解决办法有几种,按我推荐的顺序:

1. 开启迭代扫描(pgvector 0.8.0 起支持)。候选不够时自动继续往下扫索引:

    ```sql
    SET hnsw.iterative_scan = relaxed_order;
    ```

    `relaxed_order` 允许结果顺序有轻微偏差,换取速度;要严格顺序用 `strict_order`。扫多少有上限,由 `hnsw.max_scan_tuples` 控制。

2. 调大 `ef_search`。 简单粗暴,代价是所有查询都变慢。
3. 给高频过滤条件建部分索引,比如 `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops) WHERE category = '退款'`。适合分类数少且固定的情况。
4. 按租户或分类分区。 多租户 SaaS 里很常见:每个客户只搜自己的知识库,按 `tenant_id` 分区,每个分区单独建索引。

在 CloudLedger 这 42 块上你是观察不到这个问题的。数据这么少,Postgres 规划器多半会直接选全表扫描,因为扫 42 行比走索引还快。这是对的,不是索引坏了。想亲眼看到,可以用 `EXPLAIN` 看执行计划,或者造几万行假数据(练习 4)。

## 选型:pgvector 和其他几家

面试必问,我按自己的理解整理成一张表。数字级别的说法都是大致量级,具体以各家官方文档和你的压测为准。

| 方案 | 本质 | 适合 | 不太适合 |
| --- | --- | --- | --- |
| pgvector | Postgres 扩展 | 已有 Postgres;百万到千万级;要和业务数据联查、要事务 | 上亿规模、要 GPU 加速 |
| Milvus | 专门的分布式向量数据库 | 上亿规模、高并发、团队有专人运维 | 小团队、数据量小(运维成本高) |
| Qdrant | 专门的向量数据库(Rust) | 过滤能力强、单机性能好、部署简单 | 需要复杂关系查询 |
| Chroma | 嵌入式/轻量向量库 | 原型、本地实验、教程 | 生产高并发 |
| Elasticsearch / OpenSearch | 搜索引擎加了向量检索 | 已有 ES、强依赖关键词检索和混合检索 | 只做纯向量检索(偏重) |
| FAISS | 向量检索库(不是数据库) | 离线批处理、研究、自己封装服务 | 需要增删改和持久化的在线服务 |

我的建议是:先用 pgvector,直到你有明确的证据(压测数据、规模预估)证明它扛不住。面试被问「为什么不用 Milvus」,好的回答是「我们的规模是 X 万块,pgvector 的 P95 延迟是 Y 毫秒,满足要求;同时知识库要和客户套餐表联查做权限过滤,放在同一个库里事务和权限都简单。如果规模涨到上亿,或者 QPS 超过单机能力,会考虑迁移,迁移的成本主要是重建索引」。有数字、有取舍、有退路。

## 动手练习

1. 起容器,跑 `pg_sync.py` 两次,确认第二次 `embedded` 为 0。修改一篇文章再同步,确认只重算了改动的块。
2. 用 `psql` 连进去看看:

    ```bash
    docker exec -it agent60-pg psql -U postgres -d agent60
    ```

    ```sql
    SELECT id, category, left(content, 30) FROM kb_chunks ORDER BY id LIMIT 10;
    SELECT category, count(*) FROM kb_chunks GROUP BY category;
    \d kb_chunks
    ```

3. 跑 `rag_pg.py`,对比「不过滤」和「只搜退款类」的检索结果。再试一个问题「发票开错了怎么办」,用 `categories=["退款"]` 过滤,看会发生什么(提示:过滤错了比不过滤更糟)。
4. (选做,体会过滤的坑)造 5 万行随机向量,10% 标成 `退款`,其余标成别的,然后对比开关 `hnsw.iterative_scan` 时 `LIMIT 20` 实际返回的行数:

    ```sql
    INSERT INTO kb_chunks (id, doc_id, title, category, section, content, content_hash, embedding)
    SELECT 'fake-' || i, 'fake', 'fake', CASE WHEN i % 10 = 0 THEN '退款' ELSE '其他' END,
           'fake', 'fake', 'fake',
           (SELECT array_agg(random())::vector(1024) FROM generate_series(1, 1024) WHERE i > 0)
    FROM generate_series(1, 50000) AS i;
    ```

    这条 SQL 在笔记本上要跑一两分钟,建 HNSW 索引也要一会儿。做完记得 `DELETE FROM kb_chunks WHERE doc_id = 'fake';` 清理。子查询里的 `WHERE i > 0` 是为了让它变成相关子查询,每行都重新生成随机向量,否则 Postgres 可能只算一次,5 万行全是同一个向量。

| 设置 | LIMIT 20 实际返回行数 | 耗时 |
| --- | --- | --- |
| 默认(不开迭代扫描) |  |  |
| `iterative_scan = relaxed_order` |  |  |
| `ef_search = 200` |  |  |

**验收标准:** 练习 1–3 完成;能用自己的话解释为什么「只搜退款类」时问发票问题会答不上来;能讲清楚 HNSW 过滤后结果变少的原因和至少两种解决办法。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 向量数据库 | 支持存储向量并按相似度检索的数据库 |
| pgvector | Postgres 的向量扩展,提供 vector 类型、距离操作符和 HNSW/IVFFlat 索引 |
| `<=>` / `<->` / `<#>` | pgvector 的余弦距离 / L2 距离 / 负内积操作符 |
| 精确最近邻(KNN) | 和每个向量都算一次距离,结果精确但慢 |
| 近似最近邻(ANN) | 用索引只算一部分距离,快但可能漏掉真正最近的点 |
| HNSW | 分层可导航小世界图,目前最常用的 ANN 索引 |
| ef_search | HNSW 查询时候选名单的长度,越大召回越高越慢 |
| m / ef_construction | HNSW 建图时的邻居数 / 候选数,影响图质量和建索引时间 |
| IVFFlat | 先聚类再在附近簇里搜的 ANN 索引 |
| 迭代扫描(iterative scan) | pgvector 0.8 起的功能,过滤后结果不够时继续扫索引 |
| upsert | 有则更新、无则插入,Postgres 用 `ON CONFLICT DO UPDATE` |
| halfvec | 半精度向量类型,省一半空间,索引上限 4000 维 |

## 常见误区

**建了索引但查询用错了操作符。** 索引是 `vector_cosine_ops`,查询写的是 `<->`,索引用不上,每次全表扫描。用 `EXPLAIN` 确认执行计划里有 `Index Scan using kb_chunks_embedding_hnsw`。

**以为 LIMIT 写多少就能返回多少。** 走 HNSW 时最多返回 `ef_search` 个候选,再经过 WHERE 过滤还会更少。

**数据少的时候看不到索引被使用就以为坏了。** 几十几百行,全表扫描本来就更快,规划器的选择是对的。

**每次更新都全量重建。** 用内容哈希判断变化,只重算变的部分。全量重建既慢又贵,而且重建期间服务质量会下降。

**用大模型来做权限控制。** 「检索出所有文档,让模型别说出没权限的内容」是不安全的。权限要在 SQL 的 WHERE 里做。

**一上来就选最复杂的方案。** 几万块的知识库上 Milvus 集群,运维成本远超收益。先用最简单的能满足需求的方案,有数据证明不够再升级。

## 学习资料

### 文档与文章

- [pgvector 官方 README](https://github.com/pgvector/pgvector):今天所有 SQL 的出处。重点读 HNSW、Filtering、Iterative Index Scans 三节,1 小时。这是我读过写得最清楚的数据库扩展文档之一。
- [pgvector-python](https://github.com/pgvector/pgvector-python):psycopg、SQLAlchemy、Django 等各种驱动的用法示例。
- [Pinecone · Hierarchical Navigable Small Worlds (HNSW)](https://www.pinecone.io/learn/series/faiss/hnsw/):图文并茂地讲 HNSW 原理,从跳表讲起,30 分钟。
- [HNSW 原论文](https://arxiv.org/abs/1603.09320):Malkov 和 Yashunin 2016 年的论文。不用细读,知道出处,看看图 1 就好。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Pk8M6rEhm&autoplay=0&high_quality=1" title="有了 PostgreSQL,为什么还要 pgvector?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>计算机大白话 · 有了 PostgreSQL,为什么还要 pgvector? · 4 分钟,适合开始前先建立直觉。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Xw411S7sh&autoplay=0&high_quality=1" title="PostgreSQL技术分享:pgvector的应用和原理" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>KunlunBase · PostgreSQL技术分享:pgvector的应用和原理 · 44 分钟的技术分享,讲了索引原理和使用场景。2023 年的视频,版本较老,迭代扫描等新功能以官方文档为准。</figcaption>
</figure>

- swanmsg《Pinecone、Milvus 与 PGVector向量数据库深度对比》(BV1V2LRzeECA,19 分钟):选型那一节的补充,面试前看一遍。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/77QH0Y2PYKg" title="Vector Database Search - Hierarchical Navigable Small Worlds (HNSW) Explained" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>DataMListic · Vector Database Search - Hierarchical Navigable Small Worlds (HNSW) Explained · 8 分钟动画,把分层图和贪心搜索讲得很清楚。</figcaption>
</figure>

- AssemblyAI《Vector Databases simply explained! (Embeddings & Indexes)》(YouTube ID `dN0lsF2cvm4`,4 分钟):向量数据库是什么的快速入门。
- Tiger Data《18 Months of Pgvector Learnings in 47 Minutes (Tutorial)》(YouTube ID `Ua6LDIOVN1s`):在生产环境用 pgvector 一年半的经验总结,想深入再看。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 6 章里讲检索算法和向量搜索的部分,对 ANN 各类算法有简洁的综述。
- 今天这组书籍不是重点,pgvector 的官方文档比任何书都新。

### 开源项目与代码

- [pgvector/pgvector](https://github.com/pgvector/pgvector) 和 [Docker 镜像](https://hub.docker.com/r/pgvector/pgvector):今天用的。
- [qdrant/qdrant](https://github.com/qdrant/qdrant)、[milvus-io/milvus](https://github.com/milvus-io/milvus)、[chroma-core/chroma](https://github.com/chroma-core/chroma):选型表里的另外三家,看看 README 里的快速开始,对比一下和 pgvector 的上手难度。

## 自测

**1. `<=>` 返回的是距离还是相似度?为什么 `ORDER BY embedding <=> q` 不用写 `DESC`?**

<details><summary>答案</summary>

是余弦距离,等于 1 减余弦相似度,越小越相似。所以默认升序就是最相似的在前,不需要 DESC。想要相似度就 `SELECT 1 - (embedding <=> q)`。

</details>

**2. 你写了 `LIMIT 100`,但 HNSW 查询只返回了 40 行,为什么?**

<details><summary>答案</summary>

HNSW 查询时最多维护 `hnsw.ef_search` 个候选,默认 40,所以最多返回 40 行。要取 100 行需要把 `ef_search` 设到至少 100,或开启迭代扫描。

</details>

**3. 带 `WHERE category = '退款'` 的向量查询结果少于预期,解释原因并给出两种解决办法。**

<details><summary>答案</summary>

HNSW 是先按向量取出 ef_search 个候选,再应用 WHERE 过滤,条件越严格剩下越少。办法:开启 `hnsw.iterative_scan`(pgvector 0.8+);调大 `ef_search`;对高频条件建部分索引;按分类或租户分区。

</details>

**4. 为什么用内容哈希来做增量更新?只比较 `updated_at` 时间戳行不行?**

<details><summary>答案</summary>

哈希直接反映「送去 embedding 的文本」有没有变,包括切块规则变化导致的变化。只看文章的更新时间,可能出现文章改了标点、块内容其实没变却重算,或者切块逻辑改了、文章没动却没重算的情况。哈希是对 embedding 输入的精确判断。时间戳可以作为辅助,快速筛出可能变化的文章。

</details>

**5. 用户反馈「只搜退款类」之后某些问题反而答不上来了,可能是什么原因?**

<details><summary>答案</summary>

过滤条件把答案所在的文档排除了。比如「退款前要先红冲发票」这条规则可能写在发票类文章里,或者问题本身被错分到了退款类。过滤是一把双刃剑:分类器错了,检索就一定错。常见做法是过滤只用在把握大的场景,或者过滤结果不足时回退到不过滤。

</details>

**6.(面试题)你们的知识库用 pgvector,现在有 300 万个块,P95 检索延迟从 30ms 涨到了 400ms,你会怎么排查?**

<details><summary>答案</summary>

先 `EXPLAIN ANALYZE` 看是否走了 HNSW 索引(操作符和索引的 ops 是否匹配、过滤条件是否让规划器放弃了索引)。再看索引是否能放进内存:HNSW 索引大小对比 `shared_buffers` 和机器内存,放不下会大量读盘。检查 `ef_search` 是否被调得过大、是否开了迭代扫描且过滤条件很严格导致扫描过多。检查写入是否频繁(大量更新删除会产生死元组,需要 VACUUM)。手段:扩内存、用 halfvec 或降维减小索引、按租户分区、给常用过滤建部分索引、读写分离把检索放到只读副本。能先说「EXPLAIN 看执行计划」和「索引是否在内存里」,就抓住了重点。

</details>

## 明天预告

Day 18 · 检索质量:混合检索、rerank、query 改写。到今天为止我们只用了向量检索,而 Day 15 就提过它对 E1042 这种错误码不敏感。明天加上 BM25 关键词检索(中文要先用 jieba 分词),用 RRF 把两路结果融合,再用 bge-reranker 做一次精排,最后试试让大模型改写用户的口语化问题。同一组问题,你会看到 top-1 的命中一步步变好。
