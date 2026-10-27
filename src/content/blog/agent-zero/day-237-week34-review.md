---
title: 'Day 237 · 第 34 周复习:RAG 与上下文(Day 231–236)'
description: '这一周把知识库从「能存」推到「能用」:指纹增量同步、SQL 向量检索、HNSW、过滤的坑、BM25 和 RRF。今天默写 sync_chunks 和 rrf,再做一个小项目:运营新增一篇文章,同步进库,看向量、过期的 BM25、重建的 BM25 各自找不找得到它。'
pubDate: 2026-10-27
regime: none
tags: ['review', 'rag', 'pgvector', 'bm25', 'agent-zero']
series: 'agent-zero'
day: 237
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 236](/blog/agent-zero/day-236-rrf/) 写了 `part04/fusion.py` 里 10 行的 `rrf()`:每一路排第 `r` 名的块得 `1 / (k + r)` 分,各路相加,只看名次不看分数。在 17 道标好答案的题上,RRF 和「分数相加」并列第一(MRR 0.941,只用向量是 0.920),但它没有每题都赢:「导入时报 E2017」BM25 单路排第 1,RRF 反而排第 2。

这一周的六课是一条线。前三课(231–233)让 `kb_chunks` 这张表能日常维护、能用 SQL 查、知道 HNSW 索引快在哪、漏在哪;第四课(234)讲带 `WHERE` 的向量查询为什么悄悄变少;后两课(235–236)补上关键词检索 BM25,再用 RRF 把两路合成一份。今天停下来把这条线对一遍,并且做一个小项目,把「同步」和「混合检索」这两头接在一起:数据库里的内容变了,BM25 那一路会不会跟着变。

## 今天要解决的问题

学完今天,你应该能做到:

1. 合上文章默写 [Day 231](/blog/agent-zero/day-231-pgvector-2/) 的 `sync_chunks()` 主体,并用检查脚本 `w34_sync_check.py` 跑出七种场景的 `written / embedded / deleted`,每一行都能解释为什么是这个数。
2. 默写 `rrf()`、`first_rank()` 和 MRR 的算法,用 `w34_rank_check.py` 重现「E2017 向量第 7、BM25 第 1、RRF 第 2」。
3. 跑通小项目 `part04/w34_new_doc.py`:新增一篇文章 → 同步(只算 2 块 embedding)→ 对比「只用向量」「向量 + 过期的 BM25」「向量 + 重建的 BM25」,说清为什么过期的那一路会把结果拖坏。
4. 不看笔记说出本周至少十个坑,每个说出症状、报不报错、怎么修。

预计用时 3.5 小时:知识地图和一句话回顾 25 分钟,两段默写 60 分钟,小项目 50 分钟,剩下做练习和自测。前置:[Day 231](/blog/agent-zero/day-231-pgvector-2/) 到 [Day 236](/blog/agent-zero/day-236-rrf/) 全部,特别是 `part04/pg_store.py`(`connect`、`init_schema`、`sync_chunks`、`search`)、`part04/bm25_index.py`、`part04/fusion.py`、`part04/hybrid_eval.py`,以及库里已经同步好的 42 块(跑一次 `uv run python -m part04.pg_sync`,输出 `written` 为 0 说明已经是最新)。

今天不调大模型。embedding 走硅基流动免费的 bge-m3,今天所有脚本加起来发了几十次请求,API 花费 0 元。本周的 pgvector 文档引用的版本是 0.8.6,Postgres 的库是 `agentzero`(下面的输出里我用的是自己的实验库,命令里换成你的库名)。

学法和平时一样:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章把 `sync_chunks()` 和 `w34_new_doc.py` 再写一遍;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="第 34 周知识地图:上面是写入线,文章切块后对指纹、upsert 进 kb_chunks;下面是查询线,问题同时走向量 SQL 和 BM25,再用 RRF 合并成 top-k">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="90" height="40" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="65" y="55" fill="var(--ink)" text-anchor="middle">data/kb</text>
<rect x="130" y="30" width="100" height="40" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="180" y="55" fill="var(--ink)" text-anchor="middle">切块 Day 224</text>
<rect x="250" y="30" width="130" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="315" y="48" fill="var(--ink)" text-anchor="middle">指纹对账</text>
<text x="315" y="63" fill="var(--ink-faint)" text-anchor="middle" font-size="11">sha + row_key 231</text>
<rect x="400" y="30" width="100" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="450" y="48" fill="var(--ink)" text-anchor="middle">upsert</text>
<text x="450" y="63" fill="var(--ink-faint)" text-anchor="middle" font-size="11">+ 事务 231</text>
<rect x="520" y="30" width="100" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="570" y="48" fill="var(--ink)" text-anchor="middle">kb_chunks</text>
<text x="570" y="63" fill="var(--ink-faint)" text-anchor="middle" font-size="11">HNSW 233</text>
<line x1="110" y1="50" x2="130" y2="50" stroke="var(--ink-faint)"/>
<line x1="230" y1="50" x2="250" y2="50" stroke="var(--ink-faint)"/>
<line x1="380" y1="50" x2="400" y2="50" stroke="var(--ink-faint)"/>
<line x1="500" y1="50" x2="520" y2="50" stroke="var(--ink-faint)"/>
<path d="M570 70 V110 H290 V150" fill="none" stroke="var(--ink-faint)"/>
<path d="M180 70 V245 H215" fill="none" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
<rect x="20" y="185" width="100" height="40" rx="4" fill="none" stroke="var(--ink)"/>
<text x="70" y="210" fill="var(--ink)" text-anchor="middle">用户问题</text>
<rect x="215" y="150" width="150" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="290" y="168" fill="var(--ink)" text-anchor="middle">向量 SQL &lt;=&gt;</text>
<text x="290" y="183" fill="var(--ink-faint)" text-anchor="middle" font-size="11">search + 过滤坑 232 234</text>
<rect x="215" y="225" width="150" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="290" y="243" fill="var(--ink)" text-anchor="middle">BM25(内存)</text>
<text x="290" y="258" fill="var(--ink-faint)" text-anchor="middle" font-size="11">jieba + 停用词 235</text>
<line x1="120" y1="200" x2="215" y2="172" stroke="var(--ink-faint)"/>
<line x1="120" y1="210" x2="215" y2="245" stroke="var(--ink-faint)"/>
<rect x="400" y="190" width="90" height="40" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="445" y="208" fill="var(--ink)" text-anchor="middle">RRF k=60</text>
<text x="445" y="223" fill="var(--ink-faint)" text-anchor="middle" font-size="11">只看名次 236</text>
<rect x="520" y="190" width="100" height="40" rx="4" fill="none" stroke="var(--ink)"/>
<text x="570" y="215" fill="var(--ink)" text-anchor="middle">top-k</text>
<line x1="365" y1="172" x2="400" y2="205" stroke="var(--ink-faint)"/>
<line x1="365" y1="245" x2="400" y2="218" stroke="var(--ink-faint)"/>
<line x1="490" y1="210" x2="520" y2="210" stroke="var(--ink-faint)"/>
<text x="20" y="290" fill="var(--ink-soft)" font-size="11">虚线:BM25 的原料来自切块,不自动跟着数据库走,今天的小项目就卡在这条线上</text>
</g>
</svg>
<figcaption>第 34 周一张图。实线是数据流向,虚线是 BM25 拿数据的路径:它在内存里自己建索引,数据库同步了它不知道。</figcaption>
</figure>

## 本周每天一句话

- [Day 231 · pgvector(二):写入和增量更新](/blog/agent-zero/day-231-pgvector-2/):`sha256` 给每块算 64 字符指纹,和库里比,只给新增和改过的算 embedding;`INSERT ... ON CONFLICT (id) DO UPDATE` 写成有就改没有就加;整批写入套 `with conn.transaction():`;第一次同步算 42 块,第二次 0 块,改一个字只算 1 块。插入一个小节会让后面的编号后移,靠指纹借用库里已有的向量,多算的块从 3 降到 1;只比正文指纹会漏掉改分类,所以 `row_key` 是指纹加四个元数据。
- [Day 232 · pgvector(三):把 RAG 接到数据库上](/blog/agent-zero/day-232-pgvector-3/):`<=>` 余弦距离、`<->` L2、`<#>` 负内积,向量长度为 1 时三者名次一样;`search()` 返回和 numpy 版同形状的 `[(Chunk, 相似度)]`,10 道题 top-4 编号 10/10 一致;42 块时数据库每次约 1.4 毫秒、numpy 约 0.035 毫秒,所以换数据库不是为了快;`if categories` 会把空列表当成不过滤,要用 `is not None`。
- [Day 233 · HNSW:为什么快,为什么会漏](/blog/agent-zero/day-233-hnsw/):近似最近邻用「可能漏一点」换「快很多」;二维玩具图上 `ef=1` 只找对 31%,`ef=10` 就到 97%;2 万行 1024 维的表,建索引 169 秒、占 156 MB(比表本身 107 MB 还大),查询从约 147 毫秒降到几毫秒;`ef_search=10/40/100` 的召回率是 0.751/0.973/0.999;`ORDER BY 1 - (...)` 会让索引失效,333 毫秒对 5 毫秒。
- [Day 234 · 过滤的坑和向量库选型](/blog/agent-zero/day-234-filter-pitfall/):HNSW 是后过滤,先取 `ef_search` 个候选再用 `WHERE` 筛,退款占 10% 时 `LIMIT 10` 平均只回 4.2 行,占 1% 只回 0.5 行;`ef_search` 乘以过滤比例就是能拿到的行数;迭代扫描 `relaxed_order` 能拿满,代价是最严的过滤从 1.7 毫秒涨到 72 毫秒;选型先用 `capacity.py` 算空间(表加索引每行约 13.4 KB)再谈产品。
- [Day 235 · BM25:老派但好用的关键词检索](/blog/agent-zero/day-235-bm25/):向量检索找不好必须一字不差的词,E2017 那块排第 7;BM25 只数词,看词频饱和、逆文档频率、长度归一化三条;中文要先用 `jieba` 分词,业务词要 `add_word`,停用词表漏了「时候」「报」会让「什么时候扣款」压过错误码;BM25 分数只在同一个查询内可比,不能设阈值。
- [Day 236 · RRF:把两路结果合起来](/blog/agent-zero/day-236-rrf/):两路分数量纲不同不能直接加;RRF 每路第 `r` 名得 `1/(k+r)`;17 题上 RRF 前 3 名命中 17/17,MRR 0.941 对向量 0.920,领先很小;E2017 融合后第 2 名(差 0.0005 没爬到第 1),`k` 越小越偏向某一路的第一名;RRF 的分数不能用来拒答。

哪一句想不起对应的代码,先回那一天扫一眼再往下做。

## 默写一:sync_chunks

Day 231 的 `sync_chunks()` 是这一周最「重」的一个函数,里面有五件事:读库里每块当前的五项、挑出 `todo`、借用库里已有的向量、只给真正没见过的正文算 embedding、事务里 upsert 加删除。先合上 Day 231,在纸上写出来。要求:返回的字典有 `total / written / embedded / deleted` 四项;`embed_fn` 必须放在事务外面;已经在库里出现过的正文要借向量,不能再算。

写完对照标准答案(Day 231 最后那一版,一字未改;`sha`、`row_key`、`UPSERT` 在同一个文件里,这里只放主体):

```python
# agent-zero-lab/part04/pg_store.py(只看 sync_chunks)
def sync_chunks(
    conn: psycopg.Connection,
    chunks: list[Chunk],
    embed_fn: Callable[[list[str]], np.ndarray],
) -> dict[str, int]:
    existing = {
        r[0]: tuple(r[1:])
        for r in conn.execute("SELECT id, content_hash, doc_id, title, category, section FROM kb_chunks")
    }
    todo = [c for c in chunks if existing.get(c.id) != row_key(c)]
    wanted = list({sha(c.text) for c in todo})
    known = dict(
        conn.execute(
            "SELECT content_hash, embedding FROM kb_chunks WHERE content_hash = ANY(%s)", (wanted,)
        ).fetchall()
    )
    fresh = {sha(c.text): c.text for c in todo if sha(c.text) not in known}
    if fresh:
        known.update(zip(fresh, embed_fn(list(fresh.values()))))
    gone = set(existing) - {c.id for c in chunks}
    with conn.transaction():
        for c in todo:
            conn.execute(
                UPSERT,
                (c.id, c.doc_id, c.title, c.category, c.section, c.text, sha(c.text), known[sha(c.text)]),
            )
        if gone:
            conn.execute("DELETE FROM kb_chunks WHERE id = ANY(%s)", (list(gone),))
    return {"total": len(chunks), "written": len(todo), "embedded": len(fresh), "deleted": len(gone)}
```

<div class="line-notes">

- `existing = {` 这一句从库里把每一行当前的五项读出来:编号做 key,`(content_hash, doc_id, title, category, section)` 这个元组做 value。42 块同步过后它是 42 项的字典;空表时是空字典,所以第一次同步所有块都进 `todo`。
- `todo = [c for c in chunks` 对账。`existing.get(c.id)` 库里没有这个编号时是 `None`,和任何元组都不相等,算新增;有但五项里任何一项不同,算改过。五项全同的块不进 `todo`,这就是第二次同步 `written` 为 0 的原因。
- `wanted = list({sha(c.text)` 把 `todo` 里所有块的指纹去重后收成列表,下一句拿它去库里查「这些正文有没有现成的向量」。用集合去重是因为两个不同编号的块可能正文相同。
- `known = dict(` 查库里 `content_hash` 在 `wanted` 里的行,得到 `{指纹: 向量}`。`ANY(%s)` 配一个 Python 列表就是 SQL 的 `IN (...)`。Day 231 插入小节那个实验里,`kb-002#4` 的新正文就是在这里借到了原来 `#3` 的向量。
- `fresh = {sha(c.text): c.text` 真正没见过的正文:指纹不在 `known` 里的。字典 key 是指纹,所以同一段正文只算一次。
- `known.update(zip(fresh,` 只有 `fresh` 非空才调接口(`if fresh:`),调用在事务外面。`zip(fresh, 向量数组)` 把每个指纹配上它的向量,并进 `known`。往后 `known[sha(c.text)]` 一定取得到。
- `gone = set(existing)` 库里有、这次切块里没有的编号,要删。
- `with conn.transaction():` 从这里开始写库。写入和删除要么一起成功要么一起回滚,库只有「同步前」「同步后」两个状态。
- `UPSERT,` 一个块一条语句。`UPSERT` 是 Day 231 放在 `pg_store.py` 里的那段 `INSERT ... ON CONFLICT (id) DO UPDATE`,八个参数顺序和列顺序对应,最后一个是向量。
- `return {"total"` 返回四个数。`written` 是 `todo` 的长度(写了几行),`embedded` 是 `fresh` 的长度(算了几块向量),两个数不一样的场景,下面的检查脚本里就有。

</div>

光对照不够,写一个检查脚本让它自己证明。新建 `part04/w34_sync_check.py`,它在内存里改块(不动 `data/kb/`),连着做七种场景:

```python
# agent-zero-lab/part04/w34_sync_check.py
"""默写 sync_chunks 之后的检查:七种场景,每种报 written / embedded / deleted。全部在内存里改块,不碰 data/kb/。"""
import numpy as np

from common.embed import embed
from part04.chunking import load_chunks
from part04.pg_store import connect, init_schema, sync_chunks

sent: list[str] = []


def counting_embed(texts: list[str]) -> np.ndarray:
    sent.extend(texts)
    return embed(texts)


def run(label: str, conn, chunks) -> None:
    sent.clear()
    r = sync_chunks(conn, chunks, counting_embed)
    print(f"{label:<22}{r}  送去算 embedding 的块数 {len(sent)}")


with connect() as conn:
    init_schema(conn)
    base = load_chunks()
    run("1 库已是最新", conn, base)

    changed = load_chunks()
    changed[5].text += "(补充一句)"
    run("2 改一块正文", conn, changed)
    run("3 把它改回去", conn, base)

    cat = load_chunks()
    cat[0].category = "价格"
    run("4 只改一块的分类", conn, cat)
    run("5 分类改回去", conn, base)

    run("6 少了最后两块", conn, base[:-2])
    run("7 最后两块补回来", conn, base)
    n = conn.execute("SELECT count(*) FROM kb_chunks").fetchone()
    print("库里现在", n[0] if n else 0, "块")
```

<div class="line-notes">

- `sent: list[str] = []` 一个模块级的空列表,专门记「这次到底有哪些正文被送去算 embedding」。`sync_chunks` 自己只返回个数,这里要看内容。
- `def counting_embed(` 包一层真的 `embed`:先把收到的正文记进 `sent`,再原样调 `embed`。`sync_chunks` 的第三个参数是函数,所以能这样塞进一个带记录的替身,这是 Day 231 把 `embed_fn` 做成参数的好处。
- `sent.clear()` 每个场景开始前清空,不然数字会累加。
- `base = load_chunks()` 这是 42 块的原样,场景 1、3、5、7 都用它当「正确状态」。
- `changed[5].text += ` 第 5 块(`kb-002#4`)的正文末尾加一句。`Chunk` 是普通 dataclass,字段可以直接改。
- `cat[0].category = "价格"` 只改第 0 块(`kb-001#1`)的分类,正文一个字不动。
- `base[:-2]` 去掉最后两块(`kb-020#1`、`kb-020#2`),模拟整篇文章被删。

</div>

```bash
cd /Users/你/agent-zero-lab
uv run python -m part04.w34_sync_check
```

真实输出:

```text
1 库已是最新               {'total': 42, 'written': 0, 'embedded': 0, 'deleted': 0}  送去算 embedding 的块数 0
2 改一块正文               {'total': 42, 'written': 1, 'embedded': 1, 'deleted': 0}  送去算 embedding 的块数 1
3 把它改回去               {'total': 42, 'written': 1, 'embedded': 1, 'deleted': 0}  送去算 embedding 的块数 1
4 只改一块的分类             {'total': 42, 'written': 1, 'embedded': 0, 'deleted': 0}  送去算 embedding 的块数 0
5 分类改回去               {'total': 42, 'written': 1, 'embedded': 0, 'deleted': 0}  送去算 embedding 的块数 0
6 少了最后两块              {'total': 40, 'written': 0, 'embedded': 0, 'deleted': 2}  送去算 embedding 的块数 0
7 最后两块补回来             {'total': 42, 'written': 2, 'embedded': 2, 'deleted': 0}  送去算 embedding 的块数 2
库里现在 42 块
```

七行里值得停下来想的是 3 和 4。场景 3 把正文改回去,还是要算 1 块:库里那一行已经被场景 2 覆盖成「补充了一句」的版本,原来的向量没留着,所以「改回去」对库来说也是一次新正文。场景 4、5 只动分类,`written` 是 1 而 `embedded` 是 0:改元数据是一次纯 `UPDATE`,正文指纹没变,向量直接从库里借来,不花接口的钱。场景 6 和 7 反过来:删除不调接口,补回来却要重新算,因为删掉的行向量也一起没了。`written` 和 `embedded` 不是同一个数,这个区别是 Day 231 第七步改出来的。

## 默写二:search 的 SQL、rrf 和 MRR

下半周的核心是三段代码:Day 232 `search()` 里那条 SQL、Day 236 的 `rrf()`、`first_rank()` 加 MRR。合上文章写出来。`search()` 要求:返回距离最近的 `k` 块,`ORDER BY` 后面直接写距离运算符,`categories` 为 `None` 时不过滤、为空列表时什么都查不到。`rrf()` 要求:只认字符串编号,不认块对象。MRR 要求:第一个正确块排第 1 名记 1,排第 2 名记 0.5,没找到记 0。

对照标准答案(`search` 是 Day 232 的最终版,`rrf` 是 Day 236 的,`first_rank` 来自 `hybrid_eval.py`):

```python
# agent-zero-lab/part04/pg_store.py(只看 search)
def search(
    conn: psycopg.Connection,
    query_vec: np.ndarray,
    k: int = 4,
    categories: list[str] | None = None,
) -> list[tuple[Chunk, float]]:
    where = sql.SQL("WHERE category = ANY(%(cats)s)") if categories is not None else sql.SQL("")
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

- `where = sql.SQL(` `categories is not None` 而不是 `if categories`:传 `[]` 时要进 `WHERE category = ANY('{}')`,什么都匹配不上,返回空列表;只有 `None` 才表示「没传」。Day 232 差点因为这一个词造成权限泄漏。
- `SELECT id, doc_id` 最后一列 `embedding <=> %(q)s AS distance` 是余弦距离,0 表示同一个方向,越大越不像。
- `ORDER BY embedding <=> %(q)s` 距离运算符直接写在 `ORDER BY` 后面,这样 HNSW 索引才可能被用上;写成 `1 - (embedding <=> q) DESC` 数学上等价,Day 233 实测会退成顺序扫描,333 毫秒对 5 毫秒。
- `LIMIT %(k)s` 注意后过滤的坑:索引只交出 `ef_search`(默认 40)个候选,`WHERE` 之后可能不够 `k` 行,Day 234 复现了「`LIMIT 10` 只回 4 行」。
- `1 - r[6]` 把距离换回相似度,返回形状和 Day 226 的 `rag_numpy.search` 一样,下游 `build_messages` 一个字不用改。

</div>

```python
# agent-zero-lab/part04/fusion.py
def rrf(rankings: list[list[str]], k: int = 60) -> list[tuple[str, float]]:
    scores: dict[str, float] = defaultdict(float)
    for ranking in rankings:
        for rank, cid in enumerate(ranking, start=1):
            scores[cid] += 1.0 / (k + rank)
    return sorted(scores.items(), key=lambda kv: -kv[1])


# agent-zero-lab/part04/hybrid_eval.py
def first_rank(ids: list[str], gold: set[str]) -> int | None:
    return next((i for i, cid in enumerate(ids, start=1) if cid in gold), None)

# MRR:每题取 first_rank 的倒数(没找到记 0),再对所有题求平均
# mrr = sum(1 / r for r in ranks if r) / len(ranks)
```

<div class="line-notes">

- `scores: dict[str, float]` `defaultdict(float)` 访问不存在的 key 时自动是 0.0,所以 `+=` 可以直接写,不用先判断有没有。
- `for ranking in rankings:` 外层循环是「几路」,今天两路,Day 236 练习 5 试过三路。`rrf` 一直不知道块是什么,只认字符串。
- `enumerate(ranking, start=1)` 名次从 1 开始数。第 1 名得 `1/(60+1)`,第 7 名得 `1/(60+7)`,差距只有 9% 左右,所以一路的第 7 名加另一路的第 2 名,可能压过另一路的第 1 名。
- `sorted(scores.items(),` 按总分从高到低。注意两块分数完全相等时顺序取决于字典插入顺序,E2017 那一题里 `kb-012#1` 和 `kb-009#1` 都是 0.0313(四舍五入后)。
- `next((i for i, cid` 生成器表达式加 `next`,找到第一个就停;一个也没有时返回第二个参数 `None`。
- `# mrr = sum(1 / r` 的 `if r` 同时挡掉 `None` 和 0:没找到的题不进求和,但分母仍然是全部题数,所以找不到会拉低 MRR。

</div>

检查脚本 `part04/w34_rank_check.py`:先用 Day 236 的手算例子核对 `rrf`,再手算一个 MRR,最后重现 E2017 那一题:

```python
# agent-zero-lab/part04/w34_rank_check.py
"""默写 search 的 SQL、rrf()、first_rank()/MRR 之后的检查。"""
from common.embed import embed_one
from part04.bm25_index import BM25Index
from part04.chunking import load_chunks
from part04.fusion import rrf
from part04.hybrid_eval import first_rank
from part04.pg_store import connect, search

# 1. rrf:Day 236 手算的例子
vector = ["kb-011#1", "kb-010#1", "kb-009#2"]
keyword = ["kb-010#1", "kb-010#2"]
print([(cid, round(s, 4)) for cid, s in rrf([vector, keyword])])

# 2. MRR 手算:名次 1、2、没找到、7
ranks = [1, 2, None, 7]
print("MRR", round(sum(1 / r for r in ranks if r) / len(ranks), 3))

# 3. E2017:向量、BM25、RRF 各排第几
Q, gold = "导入时报 E2017", {"kb-012#1", "kb-012#2"}
bm25 = BM25Index(load_chunks())
with connect() as conn:
    vec = [c.id for c, _ in search(conn, embed_one(Q), 20)]
kw = [c.id for c, _ in bm25.search(Q, 20)]
fused = [cid for cid, _ in rrf([vec, kw])]
print("向量", first_rank(vec, gold), " BM25", first_rank(kw, gold), " RRF", first_rank(fused, gold))
```

<div class="line-notes">

- `vector = ["kb-011#1",` 向量一路的名次:`kb-010#1` 排第 2。BM25 一路 `kb-010#1` 排第 1。两路都认它,所以总分最高。
- `print([(cid, round(s, 4))` 手算:`kb-010#1` = 1/62 + 1/61 = 0.01613 + 0.01639 = 0.0325;`kb-011#1` 只在向量里排第 1,1/61 = 0.0164。
- `ranks = [1, 2, None, 7]` 四道题:第一个正确块分别排第 1、第 2、没找到、第 7。
- `print("MRR"` 手算:(1 + 0.5 + 0 + 0.1429) ÷ 4 = 0.411。没找到那一题记 0 但仍占一个分母。
- `Q, gold = ` E2017 这题的正确答案是 `kb-012` 的两块。
- `bm25 = BM25Index(load_chunks())` BM25 一路要自己在内存里建索引,原料是 `load_chunks()` 切出来的块。注意这行,下面的小项目就是围着它转的。
- `vec = [c.id for c, _ in search(` 向量一路取前 20 名,只留编号;`kw` 同理取 BM25 前 20。两路各取 20,再交给 `rrf`。

</div>

```bash
uv run python -W ignore -m part04.w34_rank_check
```

```text
[('kb-010#1', 0.0325), ('kb-011#1', 0.0164), ('kb-010#2', 0.0161), ('kb-009#2', 0.0159)]
MRR 0.411
向量 7  BM25 1  RRF 2
```

三行都和 Day 235、236 对上了。`-W ignore` 是把 `jieba` 的 `SyntaxWarning` 压掉,Day 235 讲过。

## 小项目:新增一篇文章,看混合检索会不会跟着变

本周的两头,一头是同步(数据库永远是最新的),一头是混合检索(向量一路读数据库,BM25 一路在内存里)。有个问题 Day 236 没有碰:**数据库同步完了,BM25 那一路知道吗?**

答案不是。`BM25Index(load_chunks())` 在程序启动时把当时的块读进内存建好索引,之后数据库里发生什么,它一概不知道。向量那一路每次查询都去读库,永远是新的;BM25 那一路是启动那一刻的快照。两路不同步时会发生什么,用一个真实的场景演示:运营新增了一篇「错误码 E5001:导出超时」。

做法是:先建好一个 BM25(模拟服务已经启动)→ 在临时目录里复制出一份 `data/kb/`,加上新文章 → 用 `sync_chunks` 同步进库 → 用同一个问题「导出时报 E5001」比较三种检索 → 最后把库还原。新建 `part04/w34_new_doc.py`:

```python
# agent-zero-lab/part04/w34_new_doc.py
"""小项目:运营新增一篇文章,同步进库,看向量一路、过期的 BM25、重建的 BM25、RRF 各自找不找得到。"""
import shutil
from pathlib import Path

from common.embed import embed, embed_one, usage
from part04.bm25_index import BM25Index
from part04.chunking import Chunk, chunk_article, load_chunks
from part04.fusion import rrf
from part04.hybrid_eval import first_rank
from part04.pg_store import connect, init_schema, search, sync_chunks

TMP = Path("part04/tmp_kb")
NEW_DOC = """---
id: kb-021
title: 错误码 E5001:导出超时
category: 错误码
---

# 错误码 E5001:导出超时
## 原因
一次导出的流水超过 5 万条,或者同时有多个导出任务在排队,服务端 60 秒内没有生成完文件。

## 解决办法
把时间范围缩小到一个季度以内再导出,或者错开高峰时段。企业版可以用开放 API 分页导出。
"""
Q = "导出时报 E5001"
GOLD = {"kb-021#1", "kb-021#2"}


def chunks_from_db(conn) -> list[Chunk]:
    """从数据库里读回所有块,BM25 以库为准,不以文件为准。"""
    rows = conn.execute("SELECT id, doc_id, title, category, section, content FROM kb_chunks ORDER BY id").fetchall()
    return [Chunk(id=r[0], doc_id=r[1], title=r[2], category=r[3], section=r[4], text=r[5]) for r in rows]


def report(label: str, ids: list[str]) -> None:
    print(f"  {label:<22} 第一个正确块排第 {first_rank(ids, GOLD) or '-'} 名   前 3 名 {ids[:3]}")


with connect() as conn:
    init_schema(conn)
    stale_bm25 = BM25Index(load_chunks())  # 新文章进来之前建的,装在内存里
    print("新文章进来之前,BM25 建好了:", stale_bm25.bm25.corpus_size, "块")

    shutil.rmtree(TMP, ignore_errors=True)
    shutil.copytree("data/kb", TMP)
    (TMP / "kb-021.md").write_text(NEW_DOC, encoding="utf-8")
    new_chunks = [c for p in sorted(TMP.glob("kb-*.md")) for c in chunk_article(p)]

    before = usage["requests"]
    print("同步:", sync_chunks(conn, new_chunks, embed), " embedding 请求", usage["requests"] - before, "次")

    vec = [c.id for c, _ in search(conn, embed_one(Q), 20)]
    kw_stale = [c.id for c, _ in stale_bm25.search(Q, 20)]
    fresh_bm25 = BM25Index(chunks_from_db(conn))
    kw_fresh = [c.id for c, _ in fresh_bm25.search(Q, 20)]
    print(f"问:{Q}   (BM25 过期版找到 {len(kw_stale)} 块,重建版找到 {len(kw_fresh)} 块)")
    report("只用向量", vec)
    report("向量 + 过期 BM25", [cid for cid, _ in rrf([vec, kw_stale])])
    report("向量 + 重建的 BM25", [cid for cid, _ in rrf([vec, kw_fresh])])

    print("清理:", sync_chunks(conn, load_chunks(), embed))
    shutil.rmtree(TMP)
    n = conn.execute("SELECT count(*) FROM kb_chunks").fetchone()
    print("库里现在", n[0] if n else 0, "块")
```

<div class="line-notes">

- `TMP = Path("part04/tmp_kb")` 临时目录。新文章写在这里,不往 `data/kb/` 里放,所以实验结束后正式数据一个字没变。这个思路来自 Day 231 的 `sync_drift.py`。
- `NEW_DOC = """---` 一篇虚构的文章,格式和 `make_kb.py` 生成的一样:frontmatter 三项加两个小节。`E5001` 是知识库里没有的新错误码,所以不会和旧块混淆。
- `GOLD = {"kb-021#1", "kb-021#2"}` 正确答案是新文章切出来的两块(两个小节各一块)。
- `def chunks_from_db(conn)` 本项目的关键新函数:不读文件,从 `kb_chunks` 里把每一行读回来变成 `Chunk`。这样 BM25 看到的和向量那一路看到的是同一份数据。`ORDER BY id` 只是让顺序稳定,BM25 的分数和块的顺序无关。
- `Chunk(id=r[0], doc_id=r[1]` 字段按 `SELECT` 的列顺序一一对应;`content` 列存的是带「标题 > 小节」前缀的完整正文,正好是 `Chunk.text`。
- `first_rank(ids, GOLD) or '-'` 没找到时 `first_rank` 返回 `None`,`or '-'` 让它打印成横线;注意名次是 1 起算,不会是 0,所以 `or` 不会误伤。
- `stale_bm25 = BM25Index(load_chunks())` 这就是「服务已经启动」那一刻:此时库里和文件里都是 42 块。
- `shutil.copytree("data/kb", TMP)` 复制一份,再往里写 `kb-021.md`。
- `new_chunks = [c for p in sorted(TMP.glob` 对临时目录里每个文件调 `chunk_article`,得到 44 块(原来 42 块加新文章 2 块)。排序保证块的顺序稳定。
- `print("同步:", sync_chunks(` 同步 44 块。原来的 42 块指纹和元数据都没变,只有新增的 2 块要算 embedding,所以请求只有 1 次(2 条文本一批)。
- `fresh_bm25 = BM25Index(chunks_from_db(conn))` 同步之后从库里重新读出 44 块,重建 BM25。
- `rrf([vec, kw_stale])` 同一路向量,分别配过期和重建的 BM25 做融合。
- `print("清理:", sync_chunks(` 用原来的 42 块再同步一次:`kb-021` 的两块不在其中,被判定为多出来的,`deleted` 为 2,库还原。

</div>

```bash
uv run python -W ignore -m part04.w34_new_doc
```

真实输出:

```text
新文章进来之前,BM25 建好了: 42 块
同步: {'total': 44, 'written': 2, 'embedded': 2, 'deleted': 0}  embedding 请求 1 次
问:导出时报 E5001   (BM25 过期版找到 4 块,重建版找到 6 块)
  只用向量                   第一个正确块排第 1 名   前 3 名 ['kb-021#2', 'kb-021#1', 'kb-014#1']
  向量 + 过期 BM25           第一个正确块排第 4 名   前 3 名 ['kb-014#1', 'kb-014#2', 'kb-009#1']
  向量 + 重建的 BM25          第一个正确块排第 1 名   前 3 名 ['kb-021#2', 'kb-021#1', 'kb-014#1']
清理: {'total': 42, 'written': 0, 'embedded': 0, 'deleted': 2}
库里现在 42 块
```

读这张结果,有三件事。

第一,同步这一头没问题:44 块里只写了 2 块、算了 2 块、一次请求,和 Day 231 的账一致,清理时 `deleted` 是 2,库回到 42 块。

第二,**我原本以为向量一路会在这道题上翻车,结果没有**:只用向量,新文章两块直接排第 1、第 2。原因是问题里有「导出」两个字,文章标题里有「导出超时」,向量模型抓到了意思。E5001 这个编号本身它还是不认识的,只是这道题没用上这个短板。这提醒一件事:想证明某一路有用,题目得挑对,今天这道题证明不了 BM25 的价值,但它证明了另一件事。

第三,也是今天的重点:**「向量 + 过期 BM25」比只用向量更差,第一个正确块掉到了第 4 名。** 过期的 BM25 不认识 `kb-021`,它按「导出」「时报」去 42 块里找,交出 4 块(`kb-014#1`、`kb-014#2`、`kb-015#1`、`kb-009#1`,都是讲导出、导入的老块)。融合时 `kb-014#1` 在向量里排第 3、在 BM25 里排第 1,两路都认可,总分 1/63 + 1/61 = 0.0323;而新文章的第一块只被向量一路认可,排第 1 得 1/61 = 0.0164,差一半,被压到后面去了。Day 236 讲过「被多路同时认可的比只被一路高度认可的更可信」,这里这条规则反过来咬了人:BM25 那一路对新内容没有任何意见,不是「中立」,是在投反对票。重建以后,BM25 找到 6 块,其中有新文章的两块,融合结果回到第 1 名。

这个坑不报错,不告警,只是检索结果悄悄变差,和本周前面那几个「悄悄变少」的坑是一个性格。解决办法有两层。现在就能做的:`BM25Index` 不要自己拿文件当原料,从库里读(`chunks_from_db`),并且每次同步完成以后重建。一个更根本的办法是干脆别在内存里建 BM25,放到数据库里做(Postgres 自带的全文检索,或者 Elasticsearch),让两路读同一份数据,这是后面选型时要考虑的事,今天不展开。

另外要认清一个限制:这个项目里 BM25 是一次性重建的,42 块毫秒级的事。块数涨到几十万,每次同步都全量重建就要换思路了,这是 Day 252 之后讨论存储与成本时再碰的问题。

## 本周错题与坑清单

| 坑 | 症状 | 报错吗 | 修法 | 出处 |
| --- | --- | --- | --- | --- |
| 只比正文指纹 | 改了分类,同步报一切正常,库里分类是旧的 | 不报错 | 指纹加 `doc_id/title/category/section` 一起比(`row_key`) | Day 231 |
| 按块编号判断变没变 | 文章中间插一节,后面的块被当成改过重算 | 不报错 | 按指纹去库里借已有的向量 | Day 231 |
| 换了 embedding 模型却没算进指纹 | `embedded: 0`,库里新旧模型向量混着 | 不报错 | 指纹 = 模型名 + 正文 | Day 231 |
| `ON CONFLICT` 写在没有唯一约束的列上 | `there is no unique or exclusion constraint matching the ON CONFLICT specification` | 报错 | 冲突列用主键或建唯一索引 | Day 231 |
| 一批写入没包事务 | 出错后库里留下半成品 | 不报错 | `with conn.transaction():`,调接口放在事务外 | Day 231 |
| `ORDER BY` 按相似度升序 | 返回最不像的几块 | 不报错 | 距离升序,或相似度加 `DESC` | Day 232 |
| `if categories` 判断要不要过滤 | 空列表被当成不过滤,权限为空的用户查到全库 | 不报错 | `is not None` | Day 232 |
| `SET` 语句用 `%s` 传参 | `syntax error at or near "$1"` | 报错 | 值用 `sql.Literal` 在 Python 这边拼 | Day 232 |
| `ORDER BY 1 - (embedding <=> q)` | 索引用不上,333 毫秒对 5 毫秒 | 不报错 | `ORDER BY` 后面直接写距离运算符 | Day 233 |
| `LIMIT` 大于 `ef_search` | `LIMIT 100` 只回 40 行 | 不报错 | 调大 `ef_search` 或开迭代扫描 | Day 233 |
| 建 HNSW 索引内存不够 | `hnsw graph no longer fits into maintenance_work_mem`,建 169 秒 | 只有提示 | 调大 `maintenance_work_mem` 再建 | Day 233 |
| `SET hnsw.ef_search` 留在连接上 | 后面的请求继承了设置 | 不报错 | `SET LOCAL` 加事务 | Day 233 |
| 带 `WHERE` 的向量查询 | `LIMIT 10` 只回 4 行(占 10%)、0.5 行(占 1%) | 不报错 | `ef_search` 乘比例 ≥ k;迭代扫描;部分索引 | Day 234 |
| 实验里改了设置结果不变 | psycopg 同一 SQL 第 6 次起用缓存计划 | 不报错 | `conn.prepare_threshold = None` | Day 234 |
| 停用词表漏口语词 | 「什么时候扣款」压过错误码 | 不报错 | 用真实问题跑,补停用词 | Day 235 |
| `jieba` 不认识业务词 | 「企业版」切成「企业」「版年付」 | 不报错 | `jieba.add_word` | Day 235 |
| BM25 分数当阈值 | 不同问题第一名分数差好几倍 | 不报错 | 只在同一查询内比较,拒答另想办法 | Day 235 |
| 向量分数和 BM25 分数直接相加 | 名次基本等于 BM25 的名次 | 不报错 | RRF 只看名次 | Day 236 |
| 加了一路很弱的检索 | 三路融合的 MRR 反而掉了 | 不报错 | 每一路加进来前单独评测 | Day 236 |
| BM25 在内存里,库同步了它不知道 | 新文章被过期的 BM25 拖到第 4 名 | 不报错 | 从库里读块,同步后重建 | 今天 |

数一下「报错吗」那一列:20 个坑里只有 3 个会报错,另有 2 个只给提示。这个比例比上周还极端。向量和 BM25 的质量问题不会弹红字,只会让结果变差,所以这一周反复在做的事是同一件:每改一处,打印中间结果、数一数返回了几行、量一量名次,别指望程序替你喊停。

## 动手练习

**练习 1:BM25 从库里建和从文件建,结果一样吗?** 小项目里的 `chunks_from_db` 是新写的,先证明它没有改变 BM25 的行为:同一批 17 道题,用库里的块和用文件的块各建一个 `BM25Index`,比较前 20 名的编号和分数是否完全相同。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_w34_bm25_db.py
from part04.bm25_index import BM25Index
from part04.chunking import Chunk, load_chunks
from part04.hybrid_eval import EVAL
from part04.pg_store import connect

with connect() as conn:
    rows = conn.execute("SELECT id, doc_id, title, category, section, content FROM kb_chunks ORDER BY id").fetchall()
from_db = BM25Index([Chunk(*r) for r in rows])
from_files = BM25Index(load_chunks())

same = 0
for q, _ in EVAL:
    a = [(c.id, round(s, 6)) for c, s in from_db.search(q, 20)]
    b = [(c.id, round(s, 6)) for c, s in from_files.search(q, 20)]
    same += a == b
print("块顺序:", [c.id for c in from_db.chunks[:3]], "(库,按编号排)", [c.id for c in from_files.chunks[:3]], "(文件)")
print("17 题 BM25 前 20 名(编号和分数)完全一样:", same, "/", len(EVAL))
print("avgdl 库", round(from_db.bm25.avgdl, 4), " 文件", round(from_files.bm25.avgdl, 4))
```

<div class="line-notes">

- `Chunk(*r)` 这一行用库里读出的 42 块建出 `from_db`。`*r` 把一行元组展开成位置参数。这能成立是因为 `SELECT` 的列顺序(`id, doc_id, title, category, section, content`)和 `Chunk` 的字段顺序刚好一致,`content` 对应最后一个字段 `text`。顺序要是对不上,就会悄悄把标题塞进分类。
- `round(s, 6)` 分数是浮点数,比较前取 6 位小数,免得最后一位的浮点误差让 `==` 误报。
- `same += a == b` 布尔值能直接加,`True` 当 1。17 题里有几题完全一致。
- `from_db.bm25.avgdl` 平均每块的词数,两边应该一样,它是 BM25 长度归一化的基准。

</div>

```text
块顺序: ['kb-001#1', 'kb-001#2', 'kb-002#1'] (库,按编号排) ['kb-001#1', 'kb-001#2', 'kb-002#1'] (文件)
17 题 BM25 前 20 名(编号和分数)完全一样: 17 / 17
avgdl 库 26.9048  文件 26.9048
```

17/17 一致。BM25 的分数只取决于词频和文档频率,和块在列表里的顺序无关,所以按编号排还是按文件顺序排,结果一样。需要留意的是 `ORDER BY id` 按文本排序,`kb-010#1` 排在 `kb-009#2` 前面(字符串 `1` 小于 `9`),今天的数据每篇都不超过 3 块,没有 `#10` 这种编号;哪天有了,文本排序会把 `#10` 排在 `#2` 前面,不影响 BM25,但如果有代码依赖「块在文章里的先后」,就要另外排序。

</details>

**练习 2:混合检索加分类过滤。** Day 234 说向量一路过滤要小心,BM25 一路没有 `WHERE` 可用。写一个 `hybrid_filtered(conn, bm25, query, categories, k=4, pool=20)`:向量一路交给 `search` 的 `categories`,BM25 一路自己按分类筛,再用 RRF 合并。用「导入时报 E2017」试 `None`、`["错误码"]`、`["退款"]`、`[]` 四种。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_w34_filter.py
"""混合检索加分类过滤:向量一路交给 SQL,BM25 一路自己在结果里筛。"""
import psycopg

from common.embed import embed_one
from part04.bm25_index import BM25Index
from part04.chunking import Chunk, load_chunks
from part04.fusion import rrf
from part04.pg_store import connect, search


def hybrid_filtered(
    conn: psycopg.Connection, bm25: BM25Index, query: str, categories: list[str] | None, k: int = 4, pool: int = 20
) -> list[tuple[Chunk, float]]:
    vec_hits = search(conn, embed_one(query), pool, categories)
    # BM25 不会过滤:多取一些(全库 42 块,这里直接取全部),再按分类筛,最后截到 pool
    kw_hits = bm25.search(query, len(bm25.chunks))
    if categories is not None:
        kw_hits = [(c, s) for c, s in kw_hits if c.category in categories]
    kw_hits = kw_hits[:pool]
    by_id = {c.id: c for c, _ in vec_hits + kw_hits}
    fused = rrf([[c.id for c, _ in vec_hits], [c.id for c, _ in kw_hits]])
    return [(by_id[cid], s) for cid, s in fused[:k]]


bm25 = BM25Index(load_chunks())
with connect() as conn:
    for q, cats in [("导入时报 E2017", None), ("导入时报 E2017", ["错误码"]), ("导入时报 E2017", ["退款"]), ("导入时报 E2017", [])]:
        got = hybrid_filtered(conn, bm25, q, cats)
        print(f"categories={cats!r:<10}", [f"{c.id}[{c.category}]" for c, _ in got])
```

<div class="line-notes">

- `vec_hits = search(conn, embed_one(query), pool, categories)` 向量一路把过滤交给数据库。42 行的表规划器会走顺序扫描,所以这里不会遇到 Day 234 的「变少」;数据多了就要想起那一课。
- `kw_hits = bm25.search(query, len(bm25.chunks))` 先让 BM25 把所有有分的块都给出来(最多 42 块)。如果只取前 20 再筛分类,可能筛完一块不剩,这是后过滤的老毛病,BM25 这一路一样会有。
- `if categories is not None:` 和 `search` 里同样的判断,`[]` 要进筛选,筛完是空列表。
- `c.category in categories` 对 `["错误码"]` 保留分类为「错误码」的块,对 `[]` 一块都留不下。
- `by_id = {c.id: c for c, _ in vec_hits + kw_hits}` 两路的块合在一起建「编号到块」的字典,因为 `rrf` 只返回编号。`[]` 时两路都是空,字典也是空。
- `fused[:k]` 融合完再截到 `k` 块,返回形状和 `pg_store.search` 一样。

</div>

```text
categories=None       ['kb-010#2[错误码]', 'kb-012#1[错误码]', 'kb-009#1[数据导入导出]', 'kb-009#2[数据导入导出]']
categories=['错误码']    ['kb-010#2[错误码]', 'kb-012#1[错误码]', 'kb-010#1[错误码]', 'kb-012#2[错误码]']
categories=['退款']     ['kb-002#3[退款]', 'kb-002#2[退款]', 'kb-002#1[退款]', 'kb-003#1[退款]']
categories=[]         []
```

限定「错误码」后,两块真正讲 E2017 的(`kb-012#1`、`kb-012#2`)都进了前 4。限定「退款」时,和导入毫不相干的退款块也被端了出来,因为过滤之后候选池里只剩它们,「最像的」不等于「相关的」,这就是 Day 234 练习 2 说过的:分类选错了比不过滤更糟。传 `[]` 返回空列表,权限为空的用户什么都看不到,和 Day 232 修好的行为一致。

</details>

**练习 3:换 embedding 模型,同步会重算吗?** Day 231 把模型名算进了指纹。把环境变量 `EMB_MODEL` 临时换成同样 1024 维的 `BAAI/bge-large-zh-v1.5`,同步一次;再换回 `BAAI/bge-m3` 同步两次,看每次的 `embedded`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_w34_swap_model.py
from common.embed import EMB_MODEL, embed, usage
from part04.chunking import load_chunks
from part04.pg_store import connect, sync_chunks

with connect() as conn:
    r = sync_chunks(conn, load_chunks(), embed)
    row = conn.execute("SELECT vector_dims(embedding), count(*) FROM kb_chunks GROUP BY 1").fetchone()
print(f"模型 {EMB_MODEL}:{r}  库里向量维度/行数 {row}  embedding {usage['requests']} 次请求,{usage['tokens']} token")
```

<div class="line-notes">

- `from common.embed import EMB_MODEL, embed, usage` `EMB_MODEL` 在 `embed.py` 导入时从环境变量读进来,`pg_store.sha()` 里用的是同一个变量,所以换模型只需要换环境变量。
- `sync_chunks(conn, load_chunks(), embed)` 和平时的同步一模一样,一个字不用改。
- `vector_dims(embedding)` pgvector 的函数,返回向量的维度。`GROUP BY 1` 按第一列分组,所有行维度一样时只会有一行结果,混了不同维度会出现两行(但表的列是 `vector(1024)`,维度不同的向量本来就写不进去)。

</div>

```bash
EMB_MODEL=BAAI/bge-large-zh-v1.5 uv run python -m part04.ex_w34_swap_model
uv run python -m part04.ex_w34_swap_model
uv run python -m part04.ex_w34_swap_model
```

```text
模型 BAAI/bge-large-zh-v1.5:{'total': 42, 'written': 42, 'embedded': 42, 'deleted': 0}  库里向量维度/行数 (1024, 42)  embedding 5 次请求,2683 token
模型 BAAI/bge-m3:{'total': 42, 'written': 42, 'embedded': 42, 'deleted': 0}  库里向量维度/行数 (1024, 42)  embedding 5 次请求,2219 token
模型 BAAI/bge-m3:{'total': 42, 'written': 0, 'embedded': 0, 'deleted': 0}  库里向量维度/行数 (1024, 42)  embedding 0 次请求,0 token
```

换模型后 42 块全部重算,换回来又是 42 块,第三次才是 0。两个模型维度都是 1024,所以向量写得进去,如果指纹里没有模型名,第一次同步就会是 `embedded: 0`,库里躺着旧模型的向量,新问题却用新模型编码,距离全是乱的,而且不报错。分词器不同,同样 42 块的 token 数也不一样(bge-m3 是 2219,bge-large-zh 是 2683)。

</details>

**练习 4(开放题):17 题太容易了,补几道难题再比。** Day 236 说 17 题里 14 题四种做法都对,分不出高下。补 4 道口语、同义词的问题,自己对着原文标正确答案,用 `hybrid_eval.py` 里的函数比较向量、BM25、分数相加、RRF,看结论有没有变。

<details><summary>参考答案</summary>

示范题目和标注(我标得比较严,每题只标最该命中的块):

```python
# agent-zero-lab/part04/ex_w34_hard.py
from common.embed import embed_one
from part04.hybrid_eval import EVAL, TOP, bm25, first_rank, score_sum, summarize
from part04.fusion import rrf
from part04.pg_store import connect, search

HARD: list[tuple[str, set[str]]] = [
    ("刷卡没成功", {"kb-013#1", "kb-013#2"}),
    ("新来的同事怎么拉进团队", {"kb-015#3"}),
    ("账本里的日期是斜杠,系统不认", {"kb-010#1"}),
    ("不想用了,钱能拿回来一部分吗", {"kb-002#1"}),
]
ranks: dict[str, list[int | None]] = {"向量": [], "BM25": [], "分数相加": [], "RRF": []}
with connect() as conn:
    for q, gold in HARD:
        vec = [(c.id, s) for c, s in search(conn, embed_one(q), TOP)]
        kw = [(c.id, s) for c, s in bm25.search(q, TOP)]
        lists = {
            "向量": [c for c, _ in vec],
            "BM25": [c for c, _ in kw],
            "分数相加": score_sum(vec, kw),
            "RRF": [c for c, _ in rrf([[c for c, _ in vec], [c for c, _ in kw]])],
        }
        row = {n: first_rank(ids, gold) for n, ids in lists.items()}
        for n, r in row.items():
            ranks[n].append(r)
        print(" ".join(f"{n}={r or '-'}" for n, r in row.items()), " ", q)
print()
for n, rs in ranks.items():
    summarize(n, rs)
```

<div class="line-notes">

- `from part04.hybrid_eval import EVAL, TOP, bm25,` 直接复用 Day 236 的 `TOP = 20`、建好的 `bm25` 和 `first_rank / score_sum / summarize`,导入它不会重跑评测(那部分在 `if __name__ == "__main__":` 里)。`EVAL` 这里没用上,留着是方便你把两组题拼起来比。
- `HARD: list[tuple[str, set[str]]]` 每题一个问题加一个集合,集合里是算对的块编号。「刷卡没成功」两块都算对,因为一块讲原因、一块讲办法。
- `vec = [(c.id, s) for c, s in search(` 向量一路取前 20,保留分数(`score_sum` 要用)。
- `lists = {` 四种做法的排序结果,都只留编号。`rrf` 只吃名次,所以只传编号列表。
- `row = {n: first_rank(ids, gold)` 每种做法第一个正确块的名次,`None` 打印成 `-`。
- `summarize(n, rs)` 复用 Day 236 的汇总函数,打印前 3 名命中数和 MRR。

</div>

```text
向量=1 BM25=- 分数相加=1 RRF=1   刷卡没成功
向量=2 BM25=1 分数相加=2 RRF=2   新来的同事怎么拉进团队
向量=3 BM25=5 分数相加=4 RRF=3   账本里的日期是斜杠,系统不认
向量=1 BM25=- 分数相加=1 RRF=2   不想用了,钱能拿回来一部分吗

向量         前 3 名命中  4/4   MRR 0.708
BM25       前 3 名命中  1/4   MRR 0.300
分数相加       前 3 名命中  3/4   MRR 0.688
RRF        前 3 名命中  4/4   MRR 0.583
```

结论和 Day 236 不一样:这 4 道口语题上向量最好(0.708),BM25 最差(0.300),RRF 夹在中间(0.583),没有赢向量。原因很直观,口语题里的词和文档用词对不上(「刷卡」对「银行卡」,「拿回来」对「退款」),BM25 要么什么都找不到,要么把一个碰巧重合的词排到前面,RRF 不得不把它的意见也算进去。这不能证明 RRF 没用,4 道题太少,标注也是我一个人的判断(比如最后一题我只认年付退款这一块);它说明的是:**评测集里放什么类型的题,直接决定「混合检索有没有用」这个结论。** Day 236 的 17 题里错误码占 4 题,所以 BM25 显得有用;这 4 题全是口语,BM25 就显得拖后腿。真实系统要按真实用户的问法分布来配评测集,这是评测部分的事。

另外 RRF 在前两题都比 BM25 最好的名次差一点(「新来的同事」BM25 第 1 名,RRF 第 2 名)。想把这种题拉回来,下一课的重排序会派上用场。

</details>

验收标准:`w34_sync_check.py` 七行输出和文中一致;`w34_rank_check.py` 三行输出一致;`w34_new_doc.py` 的结果里「向量 + 过期 BM25」比「只用向量」更差,并且你能说出原因;跑完以后 `psql -d agentzero -c 'SELECT count(*) FROM kb_chunks'` 是 42;坑清单里至少十个能不看表说出症状和修法。

## 名词解释

本周新术语都已在当天的名词表里,这里只收今天新出现的几个,其余按天回查。

| 名词 | 意思 |
| --- | --- |
| 过期索引 | 在内存里建好之后,原始数据变了而索引没跟着重建。今天的 BM25 就是例子,查出来的结果是旧数据的样子 |
| 投反对票 | 今天的说法:融合时一路检索对新内容没有排名,不是「弃权」,在 RRF 里等于少拿一份分数,别的块靠两路认可超过它 |
| `Chunk(*r)` | `*` 把一行元组展开成位置参数。要求元组的顺序和类 `Chunk` 的字段顺序一致 |
| 默写 | 合上文章,凭记忆把核心代码写出来再对照。看懂和写得出是两回事 |
| 检查脚本 | 用一段很短的脚本把默写的代码跑出具体数字,让输出替你判卷 |

## 常见误区

**以为 BM25 那一路会自动跟着数据库走。** 它在内存里,是启动那一刻的快照。同步完数据库要重建它,否则新内容在这一路里是空白,融合时还会把新内容拖到后面。

**把「过期的一路」当成「弃权」。** RRF 里没排名就是少拿分,两路都认可的老块会压过只有一路认可的新块。

**默写时只写得出主干。** `sync_chunks` 里最容易漏的是「借用向量」那一步和「`embed_fn` 放事务外」,漏了不会报错,只会在某个场景下多算 embedding 或者长事务占着库。用 `w34_sync_check.py` 的七种场景判卷。

**拿一次实验得出规律。** 练习 4 的 4 道题只能说明口语题上 BM25 弱,不能说明「RRF 比向量差」。结论要写成「在这批题上」。

**只看 `written` 不看 `embedded`。** 改分类 `written` 是 1、`embedded` 是 0,改正文两个都是 1。两个数不一样才说明借用向量在起作用。

**忘了把库还原。** 小项目和练习 3 都改了库,最后要同步一次原始数据,确认是 42 块。下周往后的每一课都假设库里是 42 块。

## 学习资料

### 文档与文章

- [PostgreSQL 文档 · INSERT](https://www.postgresql.org/docs/17/sql-insert.html):复习 Day 231 的 `ON CONFLICT`,重新读 `EXCLUDED` 的说明,对照 `UPSERT` 那段 SQL。
- [pgvector 官方 README](https://github.com/pgvector/pgvector):本周六课的共同出处。今天复习时把 `Filtering` 和 `Iterative Index Scans` 两节再读一遍,对照 Day 234 实测的数字。
- [Elastic · Reciprocal rank fusion](https://www.elastic.co/guide/en/elasticsearch/reference/current/rrf.html):`rank_constant` 就是 `k`,`rank_window_size` 就是每路取多少条,和 `fusion.py` 对得上。
- [Elastic · Practical BM25 - Part 2](https://www.elastic.co/blog/practical-bm25-part-2-the-bm25-algorithm-and-its-variables):英文,用曲线讲 `k1` 和 `b` 对打分的影响,复习 Day 235 的三条规矩。
- [Python 文档 · hashlib](https://docs.python.org/3/library/hashlib.html):回看 `sha256` 和 `hexdigest()`。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1kndSB7Emx&autoplay=0&high_quality=1" title="混合检索(相似度+BM25)、RRF融合、Cross-Encoder精排序" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>_叶落秋白 · 混合检索(相似度+BM25)、RRF融合、Cross-Encoder精排序 · 约 3 分钟,把本周的 BM25 和 RRF 过一遍,最后一段的 Cross-Encoder 精排序就是明天 Day 238 的内容,先听个名字。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ap421d7Hf&autoplay=0&high_quality=1" title="向量数据库相似性搜索算法:ANN、IVF、HNSW" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>ZOMI酱 · 向量数据库相似性搜索算法:ANN、IVF、HNSW · 约 14 分钟,复习 Day 233,近似最近邻有哪几类做法。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/XvKiTfd6Xvo" title="The Complete Guide to Hybrid Search in RAG (BM25 + Embeddings + Reranker)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Dave Ebbelaar · The Complete Guide to Hybrid Search in RAG (BM25 + Embeddings + Reranker) · 英文,把本周的向量加 BM25 再加重排序串成一条线讲,看完能对上今天的知识地图,并预习明天。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):讲检索的章节里关键词检索、向量检索和混合的对比,本周六天的内容都能在这一章里找到概述,读完把名词对上号。

### 开源项目与代码

- [pgvector/pgvector-python](https://github.com/pgvector/pgvector-python):本周写的 `search` 用的就是它的 `register_vector`;仓库 examples 里有混合搜索的示例,把它的做法和我们的 `hybrid_search` 对照着看。
- [dorianbrown/rank_bm25](https://github.com/dorianbrown/rank_bm25):今天用的 BM25 库,一个文件,读一遍 `get_scores` 的循环。

## 自测

**1. 改一块的分类、正文不动,`sync_chunks` 返回的 `written` 和 `embedded` 各是多少?为什么?**

<details><summary>答案</summary>

`written` 是 1,`embedded` 是 0。`row_key` 里有四个元数据,分类变了所以这块进 `todo`、被 upsert 重写;但它的正文指纹没变,库里已经有这段正文的向量,直接借来,不调接口。只比正文指纹的话,这块根本不会进 `todo`,分类就永远不会更新。

</details>

**2. 为什么 `embed_fn(...)` 必须放在 `with conn.transaction():` 外面?**

<details><summary>答案</summary>

调接口耗时不确定,可能几十秒,事务一直开着占着数据库的连接和锁。先把向量都算好,再开事务,事务里只剩快速的写入和删除。

</details>

**3. `search()` 里为什么 `ORDER BY` 后面必须直接写 `embedding <=> %(q)s`,而不是 `ORDER BY 1 - (embedding <=> ...) DESC`?**

<details><summary>答案</summary>

规划器只认「`ORDER BY` 后面直接是距离运算符」这一个形状才会交给 HNSW 索引。写成表达式,索引用不上,退回顺序扫描加排序,Day 233 在 2 万行上实测 333 毫秒对 5 毫秒,而且结果是对的、不报错,只是慢。

</details>

**4. 向量检索带 `WHERE category = '退款'`(退款占 10%),`LIMIT 10` 为什么平均只返回 4 行?有哪几种补救?**

<details><summary>答案</summary>

HNSW 是后过滤:先取 `ef_search`(默认 40)个候选,再用 `WHERE` 筛,40 × 10% = 4 行。补救有三种:调大 `ef_search`(乘以比例要不小于 `k`,但比例低于 1% 就基本没用);开迭代扫描 `hnsw.iterative_scan = relaxed_order`(能拿满,最严的过滤耗时涨到几十毫秒);给常用的过滤条件建部分索引或者给分类列建 B-tree 让规划器先过滤。

</details>

**5. 面试题:你的混合检索线上,运营刚发布了一批新文章,有人说搜这些新文章的编号找不到了。你怎么排查?**

<details><summary>答案</summary>

先分清哪一路没找到:单独跑向量一路和 BM25 一路,看新文章的块在不在各自的结果里。向量一路每次都读数据库,同步没出错的话应该有;BM25 如果是服务启动时在内存里建的索引,就是过期的,新块没有分数。再确认:同步是不是真的成功了(`kb_chunks` 里有没有新块、`updated_at` 是不是新的)。还要提醒过期的 BM25 不只是「没找到」,融合时它给老块投的票会把新块压到后面,所以症状是「新文章排不上来」而不一定是「搜不到」。修法是 BM25 的原料以库为准、同步后重建(或者换成数据库内置的全文检索,让两路读同一份数据),并且把「新增一篇文章后两路都能搜到」加进同步的验收检查。

</details>

**6. RRF 融合以后,为什么不能用融合分数(比如 0.0318)判断要不要拒答?**

<details><summary>答案</summary>

RRF 的分数只是名次的函数,和答案靠不靠谱无关:哪怕两路都排得很差,只要名次靠前,分数也一样高。拒答要靠向量的相似度(同一个模型下有可比性)或者后面重排序给出的相关性分数,这是明天 Day 238 要看的。

</details>

## 明天预告

明天是 [Day 238 · Rerank:先粗筛再精排](/blog/agent-zero/day-238-rerank/)。今天的小项目和练习 4 都暴露了同一件事:RRF 只看名次,会把「两路都说还行」的块排在「一路说最好」的前面,E2017 那一题差 0.0005 没爬到第 1 名。明天引入一种完全不同的模型,把问题和每块拼在一起让它逐字对照打分,专门做 RRF 之后最后一步的精排。
