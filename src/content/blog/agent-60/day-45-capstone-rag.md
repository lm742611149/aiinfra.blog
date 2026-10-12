---
title: 'Day 45 · 知识库模块:导入、切块、混合检索、引用'
description: '把 W3 的 RAG 代码产品化:按小标题切块并带上下文前缀、按内容 hash 增量导入 pgvector、向量 + BM25 用 RRF 融合、可选 rerank、引用编号检查和渲染。最后跑一份只评检索的基线:纯 BM25 在 31 条种子查询上 recall@5 是 0.935,漏掉的两条正好说明为什么还需要向量。'
pubDate: 2026-10-12
regime: none
tags: ['capstone', 'rag', 'hybrid-search', 'bm25', 'pgvector', 'citation', 'supportpilot', 'agent-60']
series: 'agent-60'
day: 45
lang: 'zh'
---

## 今天要解决的问题

W3 你写过一个能跑的 RAG:切块、向量化、检索、拼 prompt。能跑和能上线之间差了好几件事,今天补齐:

1. 知识库会更新。改了一篇文章,不能把 62 篇全部重新向量化,要能**增量导入**,而且导入一半失败不能留下半篇。
2. 客户会写报错码、套餐名、"专票"这种字面词。纯向量检索对这类词不敏感,要加**关键词检索**,两路结果用 RRF 融合。
3. 回复里要标出处,出处要能**检查**(有没有编造编号)、能**渲染**成客户点得开的链接。
4. 检索好不好要有**数字**。今天跑出第一份检索基线,以后每改一次检索都对比。

今天结束时,`make kb` 能把帮助中心导入数据库;给一句客户的话,能返回 5 段带编号的资料;`evals/retrieval_eval.py` 能打印三种检索方式的 recall@5 和 MRR。

预计用时 4–5 小时。前置:Day 15–19(embedding、RAG、pgvector、混合检索、RAG 评估),Day 44 的数据。需要 `EMB_API_KEY`,62 篇文章切出来 150 块,向量化一次的费用不到一分钱。

## 切块:按小标题切,再给每块戴个"帽子"

帮助中心文章很短,结构规整:一个标题,几个小标题,每节一两段。这种文章最自然的切法就是按 `##` 小标题切,一节一块。只有某一节特别长时,才按句子滑窗再切。

```python
# supportpilot/src/supportpilot/kb/chunker.py
import hashlib
import re
from dataclasses import dataclass


@dataclass
class Doc:
    id: str
    title: str
    category: str
    url_path: str
    updated_at: str
    body: str  # 去掉 frontmatter 后的 markdown

    @property
    def content_hash(self) -> str:
        return hashlib.sha256((self.title + self.body).encode("utf-8")).hexdigest()[:16]


@dataclass
class Chunk:
    doc_id: str
    index: int
    heading: str
    text: str  # 原文片段,给模型看、给人看
    embed_text: str  # 送去向量化的文本:带上标题和小标题,检索更准


def parse_markdown(raw: str) -> Doc:
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", raw, re.S)
    if not m:
        raise ValueError("缺少 frontmatter")
    meta = dict(line.split(": ", 1) for line in m.group(1).splitlines() if ": " in line)
    return Doc(id=meta["id"], title=meta["title"], category=meta["category"], url_path=meta["url_path"],
               updated_at=meta["updated_at"], body=m.group(2).strip())


def chunk_doc(doc: Doc, max_chars: int = 400, overlap: int = 60) -> list[Chunk]:
    """先按 ## 小标题切,一节太长再按句子滑窗切。帮助中心文章短,大部分一节就是一块。"""
    sections = re.split(r"^## +", doc.body, flags=re.M)
    chunks: list[Chunk] = []
    for sec in sections[1:]:  # sections[0] 是 "# 标题",跳过
        heading, _, text = sec.partition("\n")
        text = text.strip()
        for piece in _window(text, max_chars, overlap):
            chunks.append(Chunk(doc_id=doc.id, index=len(chunks), heading=heading.strip(), text=piece,
                                embed_text=f"{doc.title} / {heading.strip()}\n{piece}"))
    return chunks


def _window(text: str, max_chars: int, overlap: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    sents = re.split(r"(?<=[。!?;\n])", text)
    out: list[str] = []
    cur = ""
    for s in sents:
        if len(cur) + len(s) > max_chars and cur:
            out.append(cur)
            cur = cur[-overlap:]  # 带一点上一块的尾巴,防止一句话被切断后两边都看不懂
        cur += s
    if cur.strip():
        out.append(cur)
    return out
```

这里有两个字段值得多看一眼:`text` 和 `embed_text`。

`text` 是原文,给模型看,也给人看。`embed_text` 是拿去向量化的,前面加了"标题 / 小标题"。为什么要加?看一个例子:退款政策总览里有一节叫"月付",正文只有一句"月付订阅不支持退款,可以关闭自动续费"。单独拿这一句去向量化,它和"关闭自动续费怎么操作"那篇文章的向量会挨得很近。加上"退款政策总览 / 月付"这个前缀,向量里就带上了"这是在讲退款"的信息。

这是 Anthropic 那篇 Contextual Retrieval 文章的简化版。原文的做法是让模型给每块生成一段上下文描述再拼上去,效果更好但要为每块调一次模型。我们的文章结构清楚,标题本身就是很好的上下文,直接拼标题,零成本。

切块参数 `max_chars=400, overlap=60` 是按我们的文章定的:62 篇文章切完 150 块,最长的一块 178 个字,实际上没有一节触发滑窗。参数留着是给以后长文章用的。别照抄别人的"512 token、重叠 50"这种数字,先看你自己的文档长什么样。我的做法是切完打印一下块数和最大长度,心里有数就行。

## 向量化和增量导入

```python
# supportpilot/src/supportpilot/kb/embed.py
from openai import OpenAI

from ..config import Settings, get_settings


class Embedder:
    def __init__(self, settings: Settings | None = None):
        self.s = settings or get_settings()
        self.client = OpenAI(base_url=self.s.emb_base_url, api_key=self.s.emb_api_key, max_retries=3)

    def embed(self, texts: list[str], batch: int = 32) -> list[list[float]]:
        out: list[list[float]] = []
        for i in range(0, len(texts), batch):
            resp = self.client.embeddings.create(model=self.s.emb_model, input=texts[i:i + batch])
            out.extend(d.embedding for d in sorted(resp.data, key=lambda d: d.index))
        if out and len(out[0]) != self.s.emb_dim:
            raise ValueError(f"embedding 维度 {len(out[0])} 和 EMB_DIM={self.s.emb_dim} 不一致,改配置并重建表")
        return out
```

两个细节。返回结果按 `d.index` 排序,因为接口文档并不保证返回顺序和输入顺序一致,大多数时候一致,但"大多数时候"在数据管道里就是隐患。第二,检查维度,和 Day 44 表结构里写死的 `vector(1024)` 对上,不对立刻报错。

```python
# supportpilot/scripts/ingest_kb.py
"""增量导入帮助中心:内容 hash 没变的文章跳过;变了的整篇删掉旧块重建;库里有、目录里没了的文章删除。"""

from pathlib import Path

from supportpilot.db import session
from supportpilot.kb.chunker import chunk_doc, parse_markdown
from supportpilot.kb.embed import Embedder

KB_DIR = Path(__file__).resolve().parent.parent / "data" / "kb"


def main() -> None:
    docs = [parse_markdown(p.read_text(encoding="utf-8")) for p in sorted(KB_DIR.glob("*.md"))]
    emb = Embedder()
    added = updated = skipped = 0
    with session() as conn:
        existing = {r["id"]: r["content_hash"] for r in conn.execute("SELECT id, content_hash FROM kb.docs")}
        for doc in docs:
            if existing.get(doc.id) == doc.content_hash:
                skipped += 1
                continue
            chunks = chunk_doc(doc)
            vectors = emb.embed([c.embed_text for c in chunks])
            with conn.transaction():  # 一篇文章的删旧 + 写新放一个事务,中途失败不会留下半篇
                conn.execute("DELETE FROM kb.docs WHERE id = %s", (doc.id,))  # chunks 级联删除
                conn.execute(
                    "INSERT INTO kb.docs (id, title, category, url_path, updated_at, content_hash, content) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    (doc.id, doc.title, doc.category, doc.url_path, doc.updated_at, doc.content_hash, doc.body))
                with conn.cursor() as cur:
                    cur.executemany(
                        "INSERT INTO kb.chunks (doc_id, chunk_index, heading, content, embedding) "
                        "VALUES (%s, %s, %s, %s, %s)",
                        [(c.doc_id, c.index, c.heading, c.text, v) for c, v in zip(chunks, vectors, strict=True)])
            if doc.id in existing:
                updated += 1
            else:
                added += 1
        gone = set(existing) - {d.id for d in docs}
        for doc_id in gone:
            conn.execute("DELETE FROM kb.docs WHERE id = %s", (doc_id,))
    print(f"added={added} updated={updated} skipped={skipped} deleted={len(gone)}")


if __name__ == "__main__":
    main()
```

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="知识库增量导入流程">
<g font-family="var(--font-mono)" font-size="11">
<rect x="10" y="70" width="100" height="50" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="60" y="92" text-anchor="middle" fill="var(--ink)">data/kb/*.md</text>
<text x="60" y="108" text-anchor="middle" fill="var(--ink-soft)">62 篇</text>
<rect x="140" y="70" width="110" height="50" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="195" y="92" text-anchor="middle" fill="var(--ink)">算 content_hash</text>
<text x="195" y="108" text-anchor="middle" fill="var(--ink-soft)">和库里比</text>
<rect x="290" y="20" width="120" height="40" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="350" y="44" text-anchor="middle" fill="var(--ink-soft)">没变 → 跳过</text>
<rect x="290" y="80" width="120" height="50" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="350" y="102" text-anchor="middle" fill="var(--ink)">切块 + embedding</text>
<text x="350" y="118" text-anchor="middle" fill="var(--ink-soft)">只处理变了的</text>
<rect x="440" y="80" width="190" height="50" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="535" y="100" text-anchor="middle" fill="var(--ink)">一个事务里:</text>
<text x="535" y="118" text-anchor="middle" fill="var(--ink-soft)">删旧文档(块级联) + 写新</text>
<rect x="290" y="150" width="120" height="40" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="350" y="174" text-anchor="middle" fill="var(--ink-soft)">目录里没了 → 删</text>
</g>
<g stroke="var(--ink-faint)" stroke-width="1.3">
<line x1="110" y1="95" x2="138" y2="95"/><line x1="250" y1="85" x2="288" y2="42"/>
<line x1="250" y1="95" x2="288" y2="105"/><line x1="250" y1="108" x2="288" y2="168"/>
<line x1="410" y1="105" x2="438" y2="105"/>
</g>
</svg>
<figcaption>增量导入:内容 hash 没变的文章直接跳过;变了的整篇删掉旧块再写新块,放在一个事务里,中途失败不会留下半篇。</figcaption>
</figure>

为什么"变了就整篇重建",而不是只更新变了的那几块?因为改一个小标题,后面所有块的 `chunk_index` 都可能错位,逐块比对写起来复杂又容易错。帮助中心一篇文章就几块,整篇重建的成本可以忽略。如果你的文档是几百页的 PDF,那就值得做块级的 diff,但别一开始就上。

删除用了外键 `ON DELETE CASCADE`,删文档时它的块自动跟着删,不用写两条 DELETE。

跑一次:

```bash
cd scripts && uv run python gen_kb.py && cd ..
uv run python scripts/ingest_kb.py
# 第一次:added=62 updated=0 skipped=0 deleted=0
uv run python scripts/ingest_kb.py
# 第二次:added=0 updated=0 skipped=62 deleted=0
```

第二次全部跳过,说明增量逻辑是对的。你可以手动改一篇文章再跑,应该看到 `updated=1`。

## 混合检索:两路召回,按名次融合

```python
# supportpilot/src/supportpilot/kb/retriever.py
"""混合检索:向量(pgvector)+ 关键词(BM25),用 RRF 融合,可选 rerank。"""

from dataclasses import dataclass, field

import httpx
import jieba
from rank_bm25 import BM25Okapi

from ..config import Settings, get_settings
from .embed import Embedder

jieba.setLogLevel(60)  # 关掉 jieba 首次加载词典时的日志


@dataclass
class Hit:
    chunk_id: int
    doc_id: str
    title: str
    heading: str
    text: str
    url_path: str
    category: str
    score: float = 0.0
    via: list[str] = field(default_factory=list)  # 被哪路召回的:vector / bm25,调试用


def tokenize(text: str) -> list[str]:
    return [t.lower() for t in jieba.lcut(text) if t.strip() and t not in ",。、:;!?()「」 "]


def rrf(rankings: list[list[int]], k: int = 60) -> dict[int, float]:
    """Reciprocal Rank Fusion:每一路里排第 r 名得 1/(k+r) 分,累加。只看名次,不看原始分数。"""
    scores: dict[int, float] = {}
    for ranking in rankings:
        for r, cid in enumerate(ranking, start=1):
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (k + r)
    return scores


class Reranker:
    """调用 /rerank 接口(硅基流动、Jina、Cohere 都是这个形状)。字段以你用的厂商文档为准。"""

    def __init__(self, s: Settings):
        self.s = s

    def rerank(self, query: str, docs: list[str], top_n: int) -> list[tuple[int, float]]:
        r = httpx.post(f"{self.s.rerank_base_url}/rerank", timeout=30,
                       headers={"Authorization": f"Bearer {self.s.rerank_api_key}"},
                       json={"model": self.s.rerank_model, "query": query, "documents": docs, "top_n": top_n})
        r.raise_for_status()
        return [(x["index"], x["relevance_score"]) for x in r.json()["results"]]


class HybridRetriever:
    def __init__(self, conn, embedder: Embedder | None = None, settings: Settings | None = None):
        self.conn = conn
        self.s = settings or get_settings()
        self.embedder = embedder or Embedder(self.s)
        self.reranker = Reranker(self.s) if self.s.rerank_enabled else None
        self._rows: dict[int, dict] = {}
        self._bm25: BM25Okapi | None = None
        self._ids: list[int] = []

    def _load(self) -> None:
        """BM25 索引放内存:几百个块,启动时建一次,不到一秒。知识库重新导入后调 refresh()。"""
        rows = self.conn.execute(
            "SELECT c.id, c.doc_id, c.heading, c.content, d.title, d.url_path, d.category "
            "FROM kb.chunks c JOIN kb.docs d ON d.id = c.doc_id ORDER BY c.id").fetchall()
        self._rows = {r["id"]: r for r in rows}
        self._ids = [r["id"] for r in rows]
        self._bm25 = BM25Okapi([tokenize(f'{r["title"]} {r["heading"]} {r["content"]}') for r in rows])

    def refresh(self) -> None:
        self._bm25 = None

    def vector_search(self, query: str, k: int) -> list[int]:
        vec = self.embedder.embed([query])[0]
        rows = self.conn.execute(
            "SELECT id FROM kb.chunks ORDER BY embedding <=> %s::vector LIMIT %s", (vec, k)).fetchall()
        return [r["id"] for r in rows]

    def bm25_search(self, query: str, k: int) -> list[int]:
        if self._bm25 is None:
            self._load()
        scores = self._bm25.get_scores(tokenize(query))
        ranked = sorted(zip(self._ids, scores, strict=True), key=lambda x: x[1], reverse=True)
        return [cid for cid, sc in ranked[:k] if sc > 0]

    def search(self, query: str, k: int | None = None, pool: int = 20) -> list[Hit]:
        k = k or self.s.retrieve_k
        if self._bm25 is None:
            self._load()
        vec_ids = self.vector_search(query, pool)
        kw_ids = self.bm25_search(query, pool)
        fused = rrf([vec_ids, kw_ids])
        ranked = sorted(fused, key=fused.get, reverse=True)[: max(pool, k)]
        hits = [self._hit(cid, fused[cid], vec_ids, kw_ids) for cid in ranked]
        if self.reranker and hits:
            order = self.reranker.rerank(query, [f"{h.title} / {h.heading}\n{h.text}" for h in hits], top_n=k)
            hits = [hits[i] for i, _ in order]
            for h, (_, sc) in zip(hits, order, strict=True):
                h.score = sc
        return hits[:k]

    def _hit(self, cid: int, score: float, vec_ids: list[int], kw_ids: list[int]) -> Hit:
        r = self._rows[cid]
        via = [name for name, ids in (("vector", vec_ids), ("bm25", kw_ids)) if cid in ids]
        return Hit(chunk_id=cid, doc_id=r["doc_id"], title=r["title"], heading=r["heading"], text=r["content"],
                   url_path=r["url_path"], category=r["category"], score=score, via=via)
```

### 为什么要两路

纯向量检索擅长"意思相近、说法不同":客户写"扣了两次",文章写"重复扣款",向量能把它们拉到一起。但它不擅长"一串必须字面相同的符号":`E3001` 和 `E3002` 在向量空间里几乎挨着,模型分不太清。关键词检索(BM25)正好反过来:字面一样就命中,换个说法就抓瞎。两路一起上,互相补位。

BM25 是什么,Day 18 讲过,这里只提一句它的直觉:一个词在这篇文档里出现得越多、在所有文档里越少见,这篇文档对这个词的得分越高。"E3001"只出现在一两篇文章里,一旦客户提到它,那一两篇的分数会远高于别的。

### 中文要先分词

BM25 是按"词"算的,英文按空格分就行,中文得先分词。我用 jieba,`tokenize` 顺手把标点和空白去掉、英文转小写。看看分出来是什么样:

```text
"银行流水同步失败 提示E3001"   → ['银行', '流水', '同步', '失败', '提示', 'e3001']
"我买了年付专业版一周了想退款" → ['我', '买', '了', '年付', '专业版', '一周', '了', '想', '退款']
```

`e3001` 作为一个整体保留下来了,这正是我们要的。"了""我"这种虚词也被留着,BM25 会因为它们太常见而自动给很低的权重,不用专门维护停用词表。

jieba 在 Python 3.12 下 import 时会打几条 `SyntaxWarning: invalid escape sequence`,是 jieba 源码里正则写法老旧,不影响使用,可以忽略。

### BM25 索引为什么放内存

150 块文本,建 BM25 索引不到一秒,内存占用可以忽略。放内存的代价是知识库更新后要调 `refresh()` 重建。Postgres 自带全文检索,但中文分词要装 zhparser 之类的扩展,部署麻烦得多。等你的知识库到了几十万块,再考虑 Elasticsearch 或者 Postgres 的中文分词扩展。这又是一个"先用简单的,够用就行"的选择。

### RRF:只看名次,不看分数

两路结果怎么合?最直接的想法是把分数加起来,但向量的余弦距离在 0 到 2 之间,BM25 分数可能是 0 到 30,量纲完全不同,直接加等于让 BM25 说了算。归一化也不靠谱,BM25 分数的分布每个查询都不一样。

RRF(Reciprocal Rank Fusion)绕开了这个问题:不看分数,只看名次。在某一路里排第 r 名,就得 1/(60 + r) 分,两路的得分加起来。手算一个例子:

```text
向量检索排名:[A, B, C]      BM25 排名:[C, A, D]
A: 1/(60+1) + 1/(60+2) = 0.01639 + 0.01613 = 0.03252
C: 1/(60+3) + 1/(60+1) = 0.01587 + 0.01639 = 0.03227
B: 1/(60+2)            = 0.01613
D:            1/(60+3) = 0.01587
最终:A > C > B > D
```

两路都排前面的 A 和 C 胜出,只在一路出现的 B 和 D 靠后。常数 60 是原论文的经验值,作用是让第 1 名和第 2 名的差距不要太悬殊。你可以把测试里 `rrf([[1, 2, 3], [3, 1, 9]])` 的结果对照着算一遍。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="混合检索查询流程">
<g font-family="var(--font-mono)" font-size="11">
<rect x="10" y="90" width="90" height="44" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="55" y="116" text-anchor="middle" fill="var(--ink)">客户的话</text>
<rect x="130" y="30" width="130" height="50" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="195" y="52" text-anchor="middle" fill="var(--ink)">向量检索 top20</text>
<text x="195" y="70" text-anchor="middle" fill="var(--ink-soft)">pgvector &lt;=&gt;</text>
<rect x="130" y="145" width="130" height="50" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="195" y="167" text-anchor="middle" fill="var(--ink)">BM25 top20</text>
<text x="195" y="185" text-anchor="middle" fill="var(--ink-soft)">jieba 分词 · 内存</text>
<rect x="290" y="90" width="100" height="44" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="340" y="110" text-anchor="middle" fill="var(--ink)">RRF 融合</text>
<text x="340" y="126" text-anchor="middle" fill="var(--ink-soft)">1/(60+名次)</text>
<rect x="420" y="90" width="90" height="44" rx="5" fill="var(--paper-raised)" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="465" y="110" text-anchor="middle" fill="var(--ink)">rerank</text>
<text x="465" y="126" text-anchor="middle" fill="var(--ink-soft)">可选</text>
<rect x="540" y="90" width="90" height="44" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="585" y="110" text-anchor="middle" fill="var(--ink)">top5</text>
<text x="585" y="126" text-anchor="middle" fill="var(--ink-soft)">带 KB 编号</text>
</g>
<g stroke="var(--ink-faint)" stroke-width="1.3">
<line x1="100" y1="105" x2="128" y2="58"/><line x1="100" y1="118" x2="128" y2="168"/>
<line x1="260" y1="58" x2="288" y2="105"/><line x1="260" y1="168" x2="288" y2="120"/>
<line x1="390" y1="112" x2="418" y2="112"/><line x1="510" y1="112" x2="538" y2="112"/>
</g>
</svg>
<figcaption>一次检索:两路各取 20 个候选,按名次融合,可选再用 rerank 模型精排,最后取前 5 段。每段带着文档编号,后面引用要用。</figcaption>
</figure>

### rerank:可选,先别开

rerank 模型(比如 bge-reranker-v2-m3)和 embedding 模型的区别:embedding 是把问题和文档分别变成向量再比距离,快,但问题和文档"没见过面";rerank 是把问题和每段文档拼在一起送进模型打分,慢,但判断准得多。所以通常先用便宜的方法召回 20 段,再用 rerank 精排出 5 段。

`Reranker` 类调的是 `/rerank` 接口,硅基流动、Jina、Cohere 都是这个形状(请求里 model、query、documents、top_n,返回 results 里每条有 index 和 relevance_score),字段以你用的厂商文档为准。配置里 `RERANK_ENABLED` 默认关。原因是我想让你先拿到没有 rerank 的基线,再打开对比,看它到底值不值多花的那次调用和几百毫秒延迟。有论文发现 rerank 后只取很少几段,反而会漏掉相关内容,所以别默认它一定有用,让评测说话。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Fs421T7Xm&autoplay=0&high_quality=1" title="【进阶RAG】带你深入了解Rerank模型的原理与使用" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>果粒奶优有果粒 · 【进阶 RAG】带你深入了解 Rerank 模型的原理与使用 · 18 分钟,前半段讲 cross-encoder 和 bi-encoder 的区别,看懂为什么 rerank 准但慢。</figcaption>
</figure>

## 引用:编号要能查、能渲染

```python
# supportpilot/src/supportpilot/kb/cite.py
import re

from .retriever import Hit

CITE_RE = re.compile(r"\[(KB-[a-z]+-\d{3})\]")


def build_context(hits: list[Hit]) -> str:
    """把检索结果拼成给模型看的资料块。每段前面是可引用的编号。"""
    if not hits:
        return "(知识库里没有找到相关资料)"
    return "\n\n".join(f"[{h.doc_id}] {h.title} / {h.heading}\n{h.text}" for h in hits)


def extract_citations(text: str) -> list[str]:
    return list(dict.fromkeys(CITE_RE.findall(text)))  # 去重并保持顺序


def check_citations(text: str, hits: list[Hit]) -> tuple[list[str], list[str]]:
    """返回 (合法引用, 编造的引用)。编造 = 引用了不在本次检索结果里的编号。"""
    allowed = {h.doc_id for h in hits}
    cited = extract_citations(text)
    return [c for c in cited if c in allowed], [c for c in cited if c not in allowed]


def render_sources(text: str, hits: list[Hit], base_url: str = "https://help.cloudledger.example") -> str:
    """发给客户之前,把文中的 [KB-xxx] 换成 [1] [2],文末附链接。"""
    order: dict[str, int] = {}
    by_id = {h.doc_id: h for h in hits}

    def sub(m: re.Match) -> str:
        doc_id = m.group(1)
        if doc_id not in by_id:
            return ""
        order.setdefault(doc_id, len(order) + 1)
        return f"[{order[doc_id]}]"

    body = CITE_RE.sub(sub, text)
    if not order:
        return body
    refs = "\n".join(f"[{n}] {by_id[d].title} {base_url}{by_id[d].url_path}" for d, n in order.items())
    return f"{body}\n\n参考文章:\n{refs}"
```

三个函数,对应引用的三个阶段:

`build_context` 把检索结果拼成给模型看的资料块,每段前面是 `[KB-refund-002]` 这样的编号。Day 47 的起草提示词会要求模型"用到资料的句子在句末标注编号,只能用资料里出现过的编号"。

`check_citations` 检查模型有没有编造编号。模型偶尔会写出 `[KB-refund-009]` 这种看起来很像但根本不存在的编号,尤其是资料里有 `KB-refund-001`、`KB-refund-002` 时,它会"推理"出还有 003、004。编造的引用比不引用更糟,客户点进去是 404,或者更糟,点进去是一篇不相关的文章。质检节点会用这个函数,有编造就打回重写。

`render_sources` 在发给客户之前把内部编号换成 `[1] [2]`,文末附上文章标题和链接。客户不需要知道 `KB-refund-002` 是什么,内部编号留在系统里给评测和审计用。

## 检索基线:先拿到数字

评测集要到 Day 50 才建,但检索可以先评。我从 Day 50 的评测场景里给每个"需要查资料"的场景挑了一种问法,一共 31 条,放在 `evals/datasets/retrieval_seed.jsonl`,每条写着问题和"答对需要的文章编号"(任意一篇在前 5 就算命中):

```json
{"query": "开发票 怎么开发票?在哪里申请?", "kb_docs": ["KB-invoice-001"]}
{"query": "专票 我们公司要增值税专用发票,怎么开?", "kb_docs": ["KB-invoice-002", "KB-invoice-001"]}
{"query": "发票开错了 发票抬头写错了一个字,能重开吗?", "kb_docs": ["KB-invoice-003"]}
```

完整的 31 条你可以照着 Day 50 的场景表自己写,也可以等 Day 50 的 `build_dataset.py` 生成后用里面的数据。

```python
# supportpilot/evals/retrieval_eval.py
"""只评检索,不调大模型(只花 embedding 的钱,100 条不到 1 分钱)。
用评测集里每条用例的 kb_docs 当标准答案:前 k 个结果里出现任意一篇就算命中。

uv run python -m evals.retrieval_eval                                   # 默认用 retrieval_seed,k=5
uv run python -m evals.retrieval_eval evals/datasets/tickets_v1.jsonl   # Day 50 之后换成完整评测集
"""

import json
import sys
from pathlib import Path

from supportpilot.db import connect
from supportpilot.kb.retriever import HybridRetriever, rrf

DEFAULT = Path(__file__).resolve().parent / "datasets" / "retrieval_seed.jsonl"


def load(path: Path) -> list[dict]:
    """两种格式都认:retrieval_seed 的 {query, kb_docs},以及 Day 50 评测集的完整用例。"""
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        c = json.loads(line)
        if "query" in c:
            out.append({"id": c["query"][:20], "query": c["query"], "want": set(c["kb_docs"])})
        elif c["expect"]["kb_docs"]:
            out.append({"id": c["id"], "query": f"{c['ticket']['subject']} {c['ticket']['body']}",
                        "want": set(c["expect"]["kb_docs"])})
    return out


def main(path: Path = DEFAULT, k: int = 5) -> None:
    cases = load(path)
    r = HybridRetriever(connect())
    r._load()
    hits = {"vector": 0, "bm25": 0, "hybrid": 0}
    rr = {"vector": 0.0, "bm25": 0.0, "hybrid": 0.0}
    misses = []
    for c in cases:
        q = c["query"]
        vec = r.vector_search(q, 20)
        kw = r.bm25_search(q, 20)
        fused = rrf([vec, kw])
        ranked = {"vector": vec, "bm25": kw, "hybrid": sorted(fused, key=fused.get, reverse=True)}
        want = c["want"]
        for name, ids in ranked.items():
            docs = [r._rows[i]["doc_id"] for i in ids]
            first = next((n for n, d in enumerate(docs, start=1) if d in want), None)
            if first and first <= k:
                hits[name] += 1
            if first:
                rr[name] += 1 / first
            if name == "hybrid" and not (first and first <= k):
                misses.append((c["id"], docs[:k]))
    n = len(cases)
    for name in hits:
        print(f"{name:7s} recall@{k}={hits[name] / n:.3f}  MRR={rr[name] / n:.3f}")
    print(f"\n混合检索没命中的 {len(misses)} 条:")
    for cid, docs in misses:
        print(f"  {cid}: {docs}")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT)
```

两个指标。recall@5:前 5 个结果里有没有正确文章,有就算命中,命中的比例。MRR(平均倒数排名):第一个正确结果排第几名,取倒数再平均,排第 1 得 1 分,排第 2 得 0.5 分,没找到得 0 分。recall 看"找没找到",MRR 看"排得靠不靠前"。对 RAG 来说 recall 更要紧,因为 5 段资料都会给模型看,排第 1 还是第 3 影响不大;但 MRR 低说明前面塞了不相关的东西,会干扰模型。

BM25 这一路不需要调任何 API,我在本机直接用同样的切块和分词跑了一遍,这是真实结果:

| 检索方式 | 数据 | recall@5 | MRR |
| --- | --- | --- | --- |
| 纯 BM25 | 31 条种子查询 | 0.935 | 0.818 |
| 纯 BM25 | 86 条(Day 50 评测集里需要查资料的全部用例) | 0.919 | 0.786 |
| 纯向量 | 31 条种子查询 | (你跑出来填) | |
| 混合 RRF | 31 条种子查询 | (你跑出来填) | |
| 混合 RRF + rerank | 31 条种子查询 | (你跑出来填) | |

纯 BM25 在 31 条里漏了两条,看看漏的是什么:

```text
漏 1:"能退吗 我上周买的年付,如果不想用了能退吗?先问问"
      想要 KB-refund-002 / 001,BM25 前 5:billing-002, refund-004, invoice-005, refund-003, refund-003
漏 2:"扣了两次 这个月被扣了两次 39 元,请退一笔"
      想要 KB-billing-004(被重复扣款怎么办),BM25 前 5:plans-001, refund-003, invoice-003, plans-002, billing-009
```

第二条最典型:客户说"扣了两次",文章标题是"被重复扣款怎么办",正文写的是"重复扣款"。两边没有一个词重合,BM25 无能为力。这正是向量检索该补上的地方。你跑出纯向量的结果后,应该能看到它找到了 billing-004。

第一条更微妙。"能退吗"加上"年付",BM25 找到了 refund-003(年付超过 14 天怎么退)和 refund-004(月付能退吗),这两篇都在讲退款,但"上周买的"这个时间信息指向的是 14 天无理由那篇。这种需要理解"上周 = 14 天内"的,纯关键词做不到,向量也不一定做得到。Day 47 的 act 节点会去查账单、算天数,所以检索漏了也不致命,但它说明了一件事:检索不是孤立的,整个系统里有别的环节可以兜底。

另外注意 BM25 结果里 `refund-003` 出现了两次。同一篇文章的两个块都进了前 5,等于浪费了一个位置。要不要按文档去重(每篇最多一块),是个可以用评测回答的问题,留给你做练习。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/e668bTot45w" title="Systematically Improving RAG applications" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Jason Liu · Systematically Improving RAG applications · 他的核心主张是先建检索评测、按问题类型分桶看失败,再决定改什么。今天的基线就是这个思路的第一步,看前 20 分钟。</figcaption>
</figure>

## 上线以后:知识库是要有人养的

检索代码写完不等于知识库就好了。真实项目里,检索质量出问题,一半以上的原因不在算法,在内容。

最常见的是文章过期。价格调了、规则改了,帮助中心没人更新,Agent 就会理直气壮地引用旧规则。`kb.docs` 表里有 `updated_at` 字段,就是给这种情况留的:你可以在检索时把超过一年没更新的文章降权,或者至少在评测报告里统计"引用了多少篇超过半年没更新的文章",交给内容负责人去处理。

第二种是文章互相矛盾。两篇文章对同一条规则说法不同,模型会挑一篇用,今天挑这篇明天挑那篇。我们的事实源设计从根上避免了这个问题,真实项目里只能靠定期巡检:让模型两两比对同一主题的文章,标出可能冲突的地方,再让人确认。

第三种是缺内容。客户老问一个问题,帮助中心根本没写。这种问题检索评测发现不了(因为评测集里也没有),要从线上数据里看:哪些工单检索结果的最高分都很低,哪些工单最后被转了人工。把这些问题整理出来交给内容团队补文章,补完 `ingest_kb.py` 一跑就生效。这是 Day 52 可观测要做的事情之一。

做 FDE 或者企业落地的工程师,经常要花不少时间推动这些事。技术上它们都不难,难在要说服业务方配合。

## 动手练习

**步骤 1:导入知识库。**

```bash
make kb          # 生成文章 + 导入,第一次会调 embedding API
uv run python scripts/ingest_kb.py   # 再跑一次,确认 skipped=62
```

**步骤 2:手动试几次检索。**

```python
# 在 uv run python 里
from supportpilot.db import connect
from supportpilot.kb.retriever import HybridRetriever
from supportpilot.kb.cite import build_context

r = HybridRetriever(connect())
hits = r.search("银行流水同步失败 提示E3001")
for h in hits:
    print(h.doc_id, h.heading, round(h.score, 4), h.via)
print(build_context(hits[:2]))
```

看 `via` 字段:有的结果两路都召回了(`['vector', 'bm25']`),有的只有一路。两路都有的通常排在前面,这就是 RRF 的效果。

**步骤 3:跑检索基线,填上面那张表。**

```bash
uv run python -m evals.retrieval_eval
```

把纯向量和混合的数字填进表里。然后在 `.env` 里打开 `RERANK_ENABLED=true`(需要硅基流动的 key),改一下 `retrieval_eval.py` 让混合结果走一遍 `r.search()`(它会调 rerank),再跑一次,填最后一行。

**步骤 4:改一篇文章,验证增量导入。** 打开 `scripts/kb_facts.py`,给"如何申请发票"加一句话,重新 `gen_kb.py` 和 `ingest_kb.py`,应该是 `updated=1 skipped=61`。

**步骤 5:跑测试。**

```python
# supportpilot/tests/test_kb.py
from pathlib import Path

from supportpilot.kb.chunker import chunk_doc, parse_markdown
from supportpilot.kb.cite import check_citations, render_sources
from supportpilot.kb.retriever import Hit, rrf

KB = Path(__file__).resolve().parent.parent / "data" / "kb"


def test_every_article_parses_and_chunks():
    files = sorted(KB.glob("*.md"))
    assert len(files) >= 60
    for p in files:
        chunks = chunk_doc(parse_markdown(p.read_text(encoding="utf-8")))
        assert chunks and all(len(c.text) <= 460 for c in chunks)
        assert all(c.embed_text.startswith(chunks[0].embed_text.split(" / ")[0]) for c in chunks)


def test_rrf_prefers_items_ranked_by_both():
    s = rrf([[1, 2, 3], [3, 1, 9]])
    assert max(s, key=s.get) in (1, 3) and s[3] > s[2]


def test_citations():
    hits = [Hit(1, "KB-refund-002", "年付 14 天无理由退款", "条件", "…", "/help/refund/002", "refund")]
    ok, fake = check_citations("可以退 [KB-refund-002],另见 [KB-refund-009]", hits)
    assert ok == ["KB-refund-002"] and fake == ["KB-refund-009"]
    out = render_sources("可以全额退款 [KB-refund-002]。", hits)
    assert "[1]" in out and "/help/refund/002" in out and "KB-" not in out.split("参考文章")[0]
```

```bash
make test
```

**练习(选做):按文档去重。** 在 `search()` 里加一个参数 `max_per_doc=1`,每篇文档最多保留一块,看 recall@5 是升是降。我的预期是对短文章的帮助中心会小幅提升,因为腾出的位置能放别的候选文章;但对需要同一篇文章多个小节才能回答的问题(比如"降级什么时候生效、会不会退钱")可能变差。用数字验证这个预期。

**验收标准:** 第二次导入全部跳过;检索基线表里纯向量和混合两行填上了真实数字;混合检索的 recall@5 不低于纯 BM25 的 0.935(如果低了,先检查 embedding 维度和 `embed_text` 拼接);`make test` 全绿。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 切块 chunking | 把长文档切成适合检索的小段 |
| 上下文前缀 | 向量化前给每块拼上标题和小标题,让短块带上主题信息 |
| 增量导入 | 只处理内容变化的文档,用 hash 判断是否变化 |
| BM25 | 经典的关键词检索打分算法,看词频和词的稀有程度 |
| 混合检索 | 向量检索和关键词检索同时召回,再融合 |
| RRF | Reciprocal Rank Fusion,按名次倒数融合多路检索结果 |
| rerank | 把问题和候选文档一起送进模型逐对打分,精排 |
| recall@k | 前 k 个结果里包含正确答案的比例 |
| MRR | 第一个正确结果名次的倒数的平均值 |
| 引用渲染 | 把内部编号换成客户可见的序号和链接 |

## 常见误区

**照抄别人的切块参数。** "512 token 加 50 重叠"是别人在别人的文档上调出来的。先看自己的文档结构,结构清晰的按标题切往往比固定长度好得多。

**两路检索的分数直接相加。** 量纲不同,加起来等于一路说了算。用 RRF 或者至少做归一化,而 RRF 更简单稳定。

**以为加了 rerank 一定更好。** rerank 多一次调用、多几百毫秒延迟、多一份费用,在知识库小而规整时提升可能很小。开不开,看评测数字。

**允许模型自由引用。** 不检查的引用迟早会出现编造编号。编号格式要固定,能用正则检查,质检时必查。

**检索没有基线就开始调。** 改了切块、换了模型、加了 rerank,到底是变好还是变坏?没有基线,所有优化都是凭感觉。

## 学习资料

### 文档与文章

- [Anthropic · Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval):今天"上下文前缀"的出处。重点看他们的实验数据:上下文 embedding、上下文 BM25、rerank 分别带来多少提升,30 分钟。
- [Jason Liu · Systematically Improving Your RAG](https://jxnl.co/writing/2024/05/22/systematically-improving-your-rag/):检索评测、合成问题、按主题分桶分析失败,和今天的基线思路一致,40 分钟。
- [pgvector 文档](https://github.com/pgvector/pgvector):查询语法和 HNSW 参数(`ef_search`),15 分钟。
- [rank_bm25](https://github.com/dorianbrown/rank_bm25):README 很短,看 `BM25Okapi` 的用法,5 分钟。
- [BAAI/bge-m3 模型卡](https://huggingface.co/BAAI/bge-m3) 和 [BAAI/bge-reranker-v2-m3 模型卡](https://huggingface.co/BAAI/bge-reranker-v2-m3):看支持的语言、最大长度和推荐用法,15 分钟。
- [硅基流动文档](https://docs.siliconflow.cn/):embedding 和 rerank 接口的参数和当前价格,以官网为准。

### B 站视频

- 上面嵌的《【进阶 RAG】带你深入了解 Rerank 模型的原理与使用》。
- Coggle数据科学《动手学 RAG:Part6 文本多路召回与重排序》(BV12H4y157og,12 分钟):多路召回加重排的完整流程,和我们的结构一样,下面嵌了。
- AI开发者-就爱瞎鼓捣《ReRank 与 Embedding 模型的区别?如何选择 ReRank 模型?》(BV1r1421R77Y,7 分钟):如果 rerank 那段没太懂,这个更短更直白。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV12H4y157og&autoplay=0&high_quality=1" title="动手学RAG:Part6 文本多路召回与重排序" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Coggle数据科学 · 动手学 RAG:Part6 文本多路召回与重排序 · 12 分钟,看多路召回后怎么合并和重排。</figcaption>
</figure>

### 其他经典视频

- 上面嵌的 Jason Liu《Systematically Improving RAG applications》。

### 书籍

- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly,2024)第 8 章 Semantic Search and Retrieval-Augmented Generation:图解稠密检索、rerank 和 RAG 评估,配图非常清楚,约 1.5 小时。中文版书名《图解大模型:生成式 AI 原理与实践》,2025 年 5 月出版。
- Chip Huyen《AI Engineering》第 6 章 RAG and Agents 的 RAG 部分:检索算法比较(词法 vs 语义)、切块策略、查询改写,约 1 小时。

### 开源项目与代码

- [explodinggradients/ragas](https://github.com/explodinggradients/ragas):RAG 评估框架,今天不用,但看一眼它的检索指标定义(context recall、context precision),和我们的 recall@k 对比。
- [dorianbrown/rank_bm25](https://github.com/dorianbrown/rank_bm25):源码只有几百行,想弄懂 BM25 公式可以直接读。

## 自测

**1. `embed_text` 为什么要拼上"标题 / 小标题"?举一个不拼会出问题的例子。**

<details><summary>答案</summary>

短块单独向量化会丢失主题信息。比如"退款政策总览"里"月付"那一节只有"月付订阅不支持退款,可以关闭自动续费",不拼标题的话,它的向量会和"如何关闭自动续费"那篇很接近,检索"关闭自动续费"时可能被错误召回;拼上"退款政策总览 / 月付"后,向量带上了"退款"的语义。

</details>

**2. 向量检索排名 [A, B, C],BM25 排名 [B, D, A],用 RRF(k=60)算最终顺序。**

<details><summary>答案</summary>

A = 1/61 + 1/63 ≈ 0.01639 + 0.01587 = 0.03226;B = 1/62 + 1/61 ≈ 0.01613 + 0.01639 = 0.03252;C = 1/63 ≈ 0.01587;D = 1/62 ≈ 0.01613。顺序 B > A > D > C。

</details>

**3. 客户写"扣了两次",文章写"重复扣款",哪一路检索能找到?为什么?**

<details><summary>答案</summary>

向量检索。两句话没有共同的词,BM25 得分为零;但语义相近,embedding 向量距离近。这是我们基线里 BM25 真实漏掉的一条。

</details>

**4. 增量导入时,为什么一篇文章变了就整篇重建,而不是只改变了的块?**

<details><summary>答案</summary>

文章结构一变(比如加了一个小标题),后面块的编号会错位,逐块比对和更新逻辑复杂、容易出错;帮助中心文章只有几块,整篇重建成本可以忽略。删旧写新放在一个事务里,保证不会出现半篇。

</details>

**5. 「面试题」你的 RAG 为什么用混合检索?怎么证明它比纯向量好?**

<details><summary>答案</summary>

客服场景有大量必须字面匹配的内容(报错码 E3001、套餐名、"专票"这类术语),纯向量对它们不敏感;同时客户的口语化表达("扣了两次")又需要语义匹配。用两路召回、RRF 按名次融合。证明靠检索基线:用带标准答案的查询集分别测纯 BM25、纯向量、混合的 recall@5 和 MRR,并逐条看失败案例。我的数据里纯 BM25 recall@5 是 0.935,漏掉的正是语义改写类问题。

</details>

**6. 「面试题」模型在回复里引用了一个不存在的文档编号,你的系统怎么发现和处理?**

<details><summary>答案</summary>

编号格式固定为 `KB-分类-三位数字`,用正则提取回复中所有编号,和本次检索结果的编号集合比对,不在集合里的就是编造。质检节点发现编造会把草稿打回重写,并把问题写进重写提示;重写一次还不过就转人工。发给客户前再把内部编号渲染成序号和链接,编造的编号在渲染时会被去掉。

</details>

## 明天预告

Day 46 · 业务工具:订单/账单 MCP server 与退款审批。把查客户、查订阅、查账单、判断退款资格、创建退款申请写成业务函数,退款规则写死在代码里并用 7 个剧情客户做单元测试;按权限分级注册给模型;对接企业系统:审批通知推到飞书/钉钉/企业微信群,加一个只读、带 SQL 校验和行级隔离的 text-to-SQL 查询工具;最后把同一套函数包成 MCP server,在 Claude Desktop 里查账单。
