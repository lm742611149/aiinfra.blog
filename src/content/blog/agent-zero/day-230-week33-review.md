---
title: 'Day 230 · 第 33 周复习:RAG 与上下文(Day 224–229)'
description: '这一周把 RAG 从切块走到了数据库:切 42 块、存 .npy、top-k 拼 prompt、引用对账、六句 SYSTEM 和拒答,最后装好 Postgres 和 pgvector。今天默写 chunk_article 和查询线的 search/build_messages,再做一个小项目:把 index/ 的 42 块原样搬进 kb_chunks,和 .npy 逐行对账,证明两种存法装的是同一份东西。'
pubDate: 2026-10-23
regime: none
tags: ['review', 'rag', 'pgvector', 'chunking', 'agent-zero']
series: 'agent-zero'
day: 230
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 229](/blog/agent-zero/day-229-pgvector-1/) 在 `agentzero` 库里执行了 `CREATE EXTENSION vector`,用一张 3 维的玩具表摸清了 `vector` 类型:维度写错直接拒、1024 维每个约 4104 字节、超过 2000 维建不了 HNSW 索引。又学了 `register_vector` 和读回来的 `Vector` 对象,最后写好 `part04/pg_store.py`,建出了空的 `kb_chunks` 表。

这一周的六课分成两段。前四课(224–227)把 RAG 的两条流水线从玩具变成正式版:索引线切块、编码、存文件,查询线检索、拼 prompt、带引用回答、该拒就拒。后两课(228–229)开始换存储,把「两个文件靠下标对齐」换成数据库里的一张表。下周 [Day 231](/blog/agent-zero/day-231-pgvector-2/) 就要往这张表里正式写数据了,今天停下来把两段对一遍,并且用一个小项目在两段之间搭一座桥。

## 今天要解决的问题

学完今天,你应该能做到:

1. 合上文章默写出 [Day 224](/blog/agent-zero/day-224-chunking/) 的 `split_long()` 和 `chunk_article()`,并用一个检查脚本证明:能挡住 `overlap >= max_chars`,20 篇切出 42 块,编号唯一,每块都带「标题 > 小节」前缀。
2. 默写出 [Day 226](/blog/agent-zero/day-226-retrieve-answer/) 查询线的 `search()` 和 `build_messages()`,说出每一步的输入输出形状,并用检查脚本跑出「重复扣款」那道题的 top-4。
3. 跑通小项目 `part04/w33_to_pg.py`:把 `index/` 里的 42 块原样写进 `kb_chunks`,读回来和 `.npy`、`chunks.json` 逐行对账,行数、编号、正文、向量、分类统计全部一致,然后清空表留给 Day 231。
4. 不看笔记说出本周至少八个坑,每个说出症状、报不报错、怎么修。

预计用时 3 小时:知识地图和一句话回顾 20 分钟,两段默写 60 分钟,小项目 50 分钟,剩下做练习和自测。前置:[Day 224](/blog/agent-zero/day-224-chunking/) 到 [Day 229](/blog/agent-zero/day-229-pgvector-1/) 全部,特别是 `part04/chunking.py`、`part04/build_index.py` 和已经建好的 `index/`、`part04/rag_numpy.py`、`part04/pg_store.py`,以及 `.env` 里的 `PG_DSN`。

今天不调大模型。查询线检查脚本和练习 3 各发了 1 次 embedding 请求,走硅基流动免费的 bge-m3;小项目的向量直接从 `index/vectors.npy` 读,不重新编码。API 花费 0 元。

学法和平时一样:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章把 `chunk_article()` 和 `w33_to_pg.py` 再写一遍;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 340" role="img" aria-label="第 33 周知识地图:上排是索引线和查询线的四课,下排是存储从文件换成数据库的两课,中间是今天的小项目,把 index 搬进 kb_chunks">
<rect x="0" y="0" width="640" height="340" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink)">RAG 两条线的正式版</text>
<rect x="20" y="36" width="140" height="60" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="57" fill="var(--ink)">Day 224 切块</text>
<text x="30" y="77" fill="var(--ink-soft)" font-size="11">按 ## 切,42 块</text>
<rect x="175" y="36" width="140" height="60" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="185" y="57" fill="var(--ink)">Day 225 建索引</text>
<text x="185" y="77" fill="var(--ink-soft)" font-size="11">.npy + chunks.json</text>
<rect x="330" y="36" width="140" height="60" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="340" y="57" fill="var(--ink)">Day 226 检索回答</text>
<text x="340" y="77" fill="var(--ink-soft)" font-size="11">top-k,引用对账</text>
<rect x="485" y="36" width="140" height="60" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="495" y="57" fill="var(--ink)">Day 227 prompt</text>
<text x="495" y="77" fill="var(--ink-soft)" font-size="11">六句 SYSTEM,拒答</text>
<line x1="160" y1="66" x2="175" y2="66" stroke="var(--ink-faint)" marker-end="url(#m230)"/>
<line x1="315" y1="66" x2="330" y2="66" stroke="var(--ink-faint)" marker-end="url(#m230)"/>
<line x1="470" y1="66" x2="485" y2="66" stroke="var(--ink-faint)" marker-end="url(#m230)"/>
<text x="20" y="122" fill="var(--ink-soft)" font-size="11">琥珀:索引线(文档变了才跑) 蓝:查询线(每问都跑)</text>
<text x="20" y="160" fill="var(--ink)">存储换成数据库</text>
<rect x="20" y="172" width="295" height="60" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="30" y="193" fill="var(--ink)">Day 228 Postgres</text>
<text x="30" y="213" fill="var(--ink-soft)" font-size="11">服务 vs 文件,psql,psycopg %s</text>
<rect x="330" y="172" width="295" height="60" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="340" y="193" fill="var(--ink)">Day 229 pgvector</text>
<text x="340" y="213" fill="var(--ink-soft)" font-size="11">扩展,vector(1024),kb_chunks</text>
<line x1="315" y1="202" x2="330" y2="202" stroke="var(--ink-faint)" marker-end="url(#m230)"/>
<rect x="120" y="262" width="400" height="56" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="132" y="284" fill="var(--ink)">今天 w33_to_pg.py:index/ → kb_chunks</text>
<text x="132" y="303" fill="var(--ink-soft)" font-size="11">42 行逐行对账,向量最大差 0.0</text>
<line x1="245" y1="96" x2="260" y2="262" stroke="var(--ink-faint)" marker-end="url(#m230)"/>
<line x1="477" y1="232" x2="420" y2="262" stroke="var(--ink-faint)" marker-end="url(#m230)"/>
<defs><marker id="m230" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--ink-faint)"/></marker></defs>
</g>
</svg>
<figcaption>上排四课把 Day 221 的两条流水线做成正式版,琥珀色是索引线,蓝色是查询线。下排两课把存储从「两个文件」换成「一张表」。今天的小项目把 Day 225 的产物原样搬进 Day 229 的表,证明换了存法没换内容。</figcaption>
</figure>

## 本周每天一句话

- [Day 224 · 切块:为什么切、怎么切](/blog/agent-zero/day-224-chunking/):整篇编码会把多话题的文章稀释掉;`re.split(r"^## ", body, flags=re.M)` 按小节切,忘了 `re.M` 一刀都切不到;每块开头拼「文章标题 > 小节标题」,kb-012「解决办法」从排第 4 变成排第 1;太长的小节按长度切并重叠,`overlap >= max_chars` 会死循环。
- [Day 225 · 建索引:向量存成 numpy 文件](/blog/agent-zero/day-225-numpy-index/):向量存 `.npy`(172 KB,读 0.23 毫秒),文字存 JSON;JSON 存向量要 953 KB、36 毫秒;`np.save` 自动补后缀而 `np.load` 不补;两个文件不是同一次建的,检索不报错却取错块。
- [Day 226 · 检索和回答:top-k 拼进 prompt](/blog/agent-zero/day-226-retrieve-answer/):一次矩阵乘法得 42 个分数,`argsort` 取前 k;每块包进 `<doc id=...>` 标签,资料在前问题在后;要求每句标 `[kb-002#1]`,再用 `check_citations()` 对账,模型发明了 `[kb-003#2#1]`,第一版正则还把它放过去了。
- [Day 227 · RAG 的 prompt 讲究,和什么时候不用 RAG](/blog/agent-zero/day-227-rag-prompt/):`SYSTEM` 补成六句,每句说得出来历;「只能原样照抄 id」把编造编号从 3/3 降到 0/3;拒答话术写死才能被程序认出;资料只有几万 token 时全塞加缓存一次 ¥0.0006,比 RAG 还省。
- [Day 228 · Postgres 入门:装 Postgres.app、psql 和建库](/blog/agent-zero/day-228-postgres-basics/):SQLite 是进程里的一个文件,Postgres 是监听 5432 的服务;`createdb`、`psql`、`\dt`、`\d`;psycopg 的占位符是 `%s`,`with` 块结束才提交,`numeric` 读出来是 `Decimal`。
- [Day 229 · pgvector(一):为什么选它,扩展和建表](/blog/agent-zero/day-229-pgvector-1/):扩展按库启用,先 `CREATE EXTENSION` 再建表、再 `register_vector`;`vector(1024)` 维度不对直接拒;维度用 `sql.Literal` 拼,不用 f-string;`kb_chunks` 九列三个索引。

哪一句想不起对应的代码,先回那一天扫一眼再往下做。

## 默写一:切块的两个函数

Day 224 的 `part04/chunking.py` 里,真正干活的是 `split_long()` 和 `chunk_article()`。先合上 Day 224,在纸上写出这两个函数,要求:`split_long` 开头挡住不合法的 `overlap`,短文本原样返回,长文本按 `max_chars` 切、相邻两块重叠 `overlap` 个字;`chunk_article` 用正则按 `## ` 切小节,第 0 段扔掉,每块编号是「文章 id#序号」,`text` 带「标题 > 小节」前缀。

写完对照标准答案(Day 224 那一版,一字未改):

```python
# agent-zero-lab/part04/chunking.py(只看这两个函数)
def split_long(text: str, max_chars: int, overlap: int) -> list[str]:
    if not 0 <= overlap < max_chars:
        raise ValueError(f"overlap 必须在 0 和 max_chars 之间,现在是 {overlap}/{max_chars}")
    if len(text) <= max_chars:
        return [text]
    pieces, start = [], 0
    while start < len(text):
        pieces.append(text[start : start + max_chars])
        if start + max_chars >= len(text):
            break
        start += max_chars - overlap
    return pieces


def chunk_article(path: Path, max_chars: int = 300, overlap: int = 50) -> list[Chunk]:
    meta, body = parse_article(path)
    parts = re.split(r"^## ", body, flags=re.M)
    chunks: list[Chunk] = []
    for part in parts[1:]:
        section, _, content = part.partition("\n")
        section = section.strip()
        for piece in split_long(content.strip(), max_chars, overlap):
            chunks.append(Chunk(
                id=f"{meta['id']}#{len(chunks) + 1}",
                doc_id=meta["id"],
                title=meta["title"],
                category=meta["category"],
                section=section,
                text=f"{meta['title']} > {section}\n{piece}",
            ))
    return chunks
```

<div class="line-notes">

- `if not 0 <= overlap < max_chars:` Python 的连续比较,相当于 JS 的 `0 <= overlap && overlap < maxChars`。`overlap` 等于 `max_chars` 时下面 `start` 每次加 0,永远出不了循环,所以开头就挡住。
- `if len(text) <= max_chars:` 不需要切的直接包成一个元素的列表返回,调用方统一按列表处理。
- `pieces, start = [], 0` 两个变量一起赋初值,元组解包(Day 22)。
- `pieces.append(text[start : start + max_chars])` 切片超出末尾不报错,只取到结尾。
- `if start + max_chars >= len(text):` 这一块已经到结尾,停下,否则最后会多出一块只有重叠部分的碎片。
- `start += max_chars - overlap` 每次往前走「块长减重叠」。`max_chars=4, overlap=1` 时每次走 3 个字。
- `parts = re.split(r"^## ", body, flags=re.M)` `re.M` 让 `^` 匹配每一行的开头,而不只是整段的开头。忘了它,整篇只有一段,切出 0 块。
- `for part in parts[1:]:` 第 0 段是第一个 `## ` 之前的内容(一级标题和导语),扔掉。
- `section, _, content = part.partition("\n")` 第一行是小节标题,剩下的是正文。`partition` 返回三元组,中间的分隔符用 `_` 丢掉。
- `id=f"{meta['id']}#{len(chunks) + 1}",` 编号是「这篇文章的第几块」,从 1 开始。
- `text=f"{meta['title']} > {section}\n{piece}",` 前缀让「解决办法」这种重名小节也知道自己属于哪篇文章。

</div>

光对照不够,写一个检查脚本让它自己证明。新建 `part04/w33_chunk_check.py`:

```python
# agent-zero-lab/part04/w33_chunk_check.py
from part04.chunking import load_chunks, split_long

print(split_long("一二三四五六七八九十", max_chars=4, overlap=1))
try:
    split_long("一二三四五", max_chars=4, overlap=4)
except ValueError as e:
    print("挡住了:", e)
chunks = load_chunks()
print("块数", len(chunks), " 篇数", len({c.doc_id for c in chunks}))
print("编号都唯一:", len({c.id for c in chunks}) == len(chunks))
print("每块都带前缀:", all(c.text.startswith(f"{c.title} > {c.section}\n") for c in chunks))
print("最长", max(len(c.text) for c in chunks), "字符;", chunks[3].id, repr(chunks[3].text[:24]))
```

<div class="line-notes">

- `print(split_long("一二三四五六七八九十", max_chars=4, overlap=1))` 十个字、每块 4 个、重叠 1 个,手算应该是「一二三四」「四五六七」「七八九十」。
- `split_long("一二三四五", max_chars=4, overlap=4)` 故意让重叠等于块长,应该被开头那行挡住,而不是卡死。
- `print("块数", len(chunks), " 篇数", len({c.doc_id for c in chunks}))` 集合推导式去重数文章数(Day 25 的集合)。预期 42 块、20 篇。
- `print("编号都唯一:", len({c.id for c in chunks}) == len(chunks))` 编号去重后数量不变,说明没有重复。Day 231 要拿编号当主键,重复的话写库会撞主键。
- `all(c.text.startswith(f"{c.title} > {c.section}\n") for c in chunks)` `all()` 相当于 JS 的 `every()`。
- `print("最长", max(len(c.text) for c in chunks), "字符;",` 看最长的块,再看第 4 块(下标 3)的开头。

</div>

```bash
cd /Users/你/agent-zero-lab
uv run python -m part04.w33_chunk_check
```

真实输出:

```text
['一二三四', '四五六七', '七八九十']
挡住了: overlap 必须在 0 和 max_chars 之间,现在是 4/4
块数 42  篇数 20
编号都唯一: True
每块都带前缀: True
最长 199 字符; kb-002#2 '退款政策 > 月付套餐\n月付套餐不支持中途退款。'
```

六行全对。顺便注意最长的块只有 199 个字符(含前缀),没有一个小节超过 300,所以 `split_long` 在我们的真实数据上其实从没切过第二刀,42 块正好是 42 个小节。这不是 bug:Day 222 造数据时每节就写得很短。它是给以后长文章准备的保险,今天第一行输出证明了它切得对。

## 默写二:查询线的 search 和 build_messages

Day 226 的 `part04/rag_numpy.py` 里,检索和拼 prompt 是这两个函数。合上文章写出来,在每行旁边写上数据的形状或样子:

```python
# agent-zero-lab/part04/rag_numpy.py(只看这两个函数)
def search(question: str, k: int = 4) -> list[tuple[Chunk, float]]:
    scores = VECTORS @ embed_one(question)
    top = np.argsort(-scores)[:k]
    return [(CHUNKS[i], float(scores[i])) for i in top]


def build_messages(question: str, chunks: list[Chunk]) -> list[dict]:
    docs = "\n\n".join(f'<doc id="{c.id}" title="{c.title}">\n{c.text}\n</doc>' for c in chunks)
    user = f"<资料>\n{docs}\n</资料>\n\n用户问题:{question}"
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]
```

<div class="line-notes">

- `scores = VECTORS @ embed_one(question)` `(42, 1024) @ (1024,)` 得到 `(42,)`,每块一个余弦分数。两边都归一化过,点积就是余弦。
- `top = np.argsort(-scores)[:k]` 负号让排序从大到小;忘了负号拿到的是最不像的 k 块,不报错。
- `return [(CHUNKS[i], float(scores[i])) for i in top]` 行号换回 `Chunk`。`float()` 把 numpy 的 float32 转成普通数,打印和 JSON 都干净。
- `docs = "\n\n".join(f'<doc id="{c.id}" title="{c.title}">\n{c.text}\n</doc>' for c in chunks)` 每块包进带 id 的标签,模型照着 id 标出处,我们拿同一份 id 当白名单对账。
- `user = f"<资料>\n{docs}\n</资料>\n\n用户问题:{question}"` 资料在前,问题在后。
- `return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]` 两条消息,`SYSTEM` 是 Day 227 改好的六句版。

</div>

检查脚本 `part04/w33_search_check.py`,不调大模型,只看检索和拼好的 prompt,顺手把 Day 226 那个编造的编号喂给对账函数:

```python
# agent-zero-lab/part04/w33_search_check.py
from common.embed import usage
from part04.rag_numpy import build_messages, check_citations, search

hits = search("重复扣款多久能退回来", k=4)
for c, s in hits:
    print(f"{s:.3f}  {c.id:<9} {c.title} > {c.section}")
msgs = build_messages("重复扣款多久能退回来", [c for c, _ in hits])
print([m["role"] for m in msgs], "user 消息", len(msgs[1]["content"]), "字符")
print(msgs[1]["content"][:60].replace("\n", "⏎"))
print(check_citations("全额退还 [kb-002#3]。到账看渠道 [kb-003#2#1]。", [c for c, _ in hits]))
print("embedding 请求", usage["requests"], "次")
```

<div class="line-notes">

- `from part04.rag_numpy import build_messages, check_citations, search` import 时 `rag_numpy` 会执行模块顶层的 `load_index()` 和 `LLMClient()`,只是建对象,不发请求。
- `hits = search("重复扣款多久能退回来", k=4)` Day 223 小项目里整篇检索排错的那道题,切块以后应该第一名就是 kb-002#3。
- `print(f"{s:.3f}  {c.id:<9} {c.title} > {c.section}")` `:<9` 是左对齐占 9 格,和 JS 的 `padEnd(9)` 一样。
- `print([m["role"] for m in msgs], "user 消息", len(msgs[1]["content"]), "字符")` 看消息结构和长度。
- `print(msgs[1]["content"][:60].replace("\n", "⏎"))` 前 60 个字,换行换成符号,一行能看完。
- `print(check_citations("全额退还 [kb-002#3]。到账看渠道 [kb-003#2#1]。", [c for c, _ in hits]))` 第一个出处合法,第二个是 Day 226 模型编出来的那种。
- `print("embedding 请求", usage["requests"], "次")` 只编码了问题,1 次。

</div>

```bash
uv run python -m part04.w33_search_check
```

```text
0.820  kb-002#3  退款政策 > 重复扣款
0.761  kb-004#2  自动续费与扣款规则 > 扣款失败
0.733  kb-002#4  退款政策 > 审批与到账
0.693  kb-004#1  自动续费与扣款规则 > 什么时候扣款
['system', 'user'] user 消息 485 字符
<资料>⏎<doc id="kb-002#3" title="退款政策">⏎退款政策 > 重复扣款⏎同一笔订阅被重复扣款
(['kb-002#3', 'kb-003#2#1'], ['kb-003#2#1'])
embedding 请求 1 次
```

第一名 kb-002#3,0.820。Day 223 整篇检索时这道题排错了,切块以后直接排第一,这是本周最直观的一个收获。对账函数返回两个列表:引用了哪些、哪些不在资料里,`kb-003#2#1` 被正确地揪出来了(Day 226 修过的那个正则)。

## 小项目:把 index/ 搬进 kb_chunks,逐行对账

Day 229 建好的 `kb_chunks` 还是空的。Day 231 会写一个正式的同步程序:切块、算指纹、只给变了的块算 embedding、写库。在那之前,我想先回答一个更简单的问题:**同样的 42 块,放进数据库以后还是同一份东西吗?** 正文一个字没变?向量一个数没变?分类没丢?

做法是最笨的那种:不重新切块、不重新编码,直接读 Day 225 的 `index/`,一行一行 INSERT 进去,再读回来和文件比。全部对得上,说明 `pg_store.py` 的表结构和 `register_vector` 的转换是可靠的;Day 231 出了问题,就可以排除这一层。新建 `part04/w33_to_pg.py`:

```python
# agent-zero-lab/part04/w33_to_pg.py
"""把 Day 225 的 index/ 原样搬进 kb_chunks,再和 .npy 逐行对账。不算 embedding。"""
from collections import Counter

import numpy as np

from part04.build_index import load_index
from part04.pg_store import connect, init_schema

chunks, vectors = load_index()
print(f"index/ 里:{len(chunks)} 块,向量 {vectors.shape}")

with connect() as conn:
    init_schema(conn)
    conn.execute("DELETE FROM kb_chunks")
    for c, v in zip(chunks, vectors):
        conn.execute(
            "INSERT INTO kb_chunks (id, doc_id, title, category, section, content, content_hash, embedding)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (c.id, c.doc_id, c.title, c.category, c.section, c.text, "-", v),
        )

    rows = conn.execute("SELECT id, content, embedding FROM kb_chunks").fetchall()
    in_db = {r[0]: (r[1], r[2].to_numpy()) for r in rows}
    print("库里行数:", len(in_db))
    print("编号一致:", set(in_db) == {c.id for c in chunks})
    text_ok = all(in_db[c.id][0] == c.text for c in chunks)
    diff = max(float(np.abs(in_db[c.id][1] - v).max()) for c, v in zip(chunks, vectors))
    print("正文一致:", text_ok, " 向量最大差:", diff)

    by_cat = conn.execute(
        "SELECT category, count(*) FROM kb_chunks GROUP BY category ORDER BY count(*) DESC, category"
    ).fetchall()
    print("SQL 分组:", by_cat)
    print("Python 数:", sorted(Counter(c.category for c in chunks).items(), key=lambda kv: (-kv[1], kv[0])))

    conn.execute("DELETE FROM kb_chunks")
    print("对完清空,留给 Day 231:", conn.execute("SELECT count(*) FROM kb_chunks").fetchone())
```

<div class="line-notes">

- `from collections import Counter` 标准库的计数器,`Counter(["a","b","a"])` 得到 `{'a': 2, 'b': 1}`,相当于 JS 里用 `reduce` 数次数。Day 24 按类别计数时手写过同样的逻辑。
- `chunks, vectors = load_index()` Day 225 的读索引函数,会核对模型名和行数。实测 42 块、`(42, 1024)`。
- `init_schema(conn)` 幂等建表,表已经在了就跳过。
- `conn.execute("DELETE FROM kb_chunks")` 先清空。小项目可能跑好几遍,不清的话第二遍 INSERT 会撞主键 `duplicate key value violates unique constraint "kb_chunks_pkey"`。
- `for c, v in zip(chunks, vectors):` 块和它那一行向量配对,这正是 Day 225 靠下标对齐的那层关系,今天把它固化进同一行。
- `(c.id, c.doc_id, c.title, c.category, c.section, c.text, "-", v),` `content_hash` 先填一个 `"-"` 占位,它是 `NOT NULL` 列,不能不填。真正的指纹 Day 231 再算。`v` 是 numpy 数组,`connect()` 注册过转换,直接传。
- `rows = conn.execute("SELECT id, content, embedding FROM kb_chunks").fetchall()` 读回全部 42 行。注意没写 `ORDER BY`:数据库**不保证**返回顺序,所以下一行按 id 建字典来对,而不是按位置一一比。
- `in_db = {r[0]: (r[1], r[2].to_numpy()) for r in rows}` 字典推导式,`{id: (正文, 向量数组)}`。`r[2]` 是 `Vector` 对象,`.to_numpy()` 转回数组(Day 229)。
- `print("编号一致:", set(in_db) == {c.id for c in chunks})` `set(字典)` 取所有 key,和文件里的编号集合比。实测 `True`。
- `text_ok = all(in_db[c.id][0] == c.text for c in chunks)` 每一块的正文逐字比。实测 `True`。
- `diff = max(float(np.abs(in_db[c.id][1] - v).max()) for c, v in zip(chunks, vectors))` 每块算「库里向量和文件向量逐元素差的绝对值的最大值」,再取 42 块里最大的。实测 `0.0`:float32 存进 `vector`、再读回 float32,一个比特都没变。
- `"SELECT category, count(*) FROM kb_chunks GROUP BY category ORDER BY count(*) DESC, category"` Day 88 的分组计数,按块数从多到少、同数按名字排。
- `print("Python 数:", sorted(Counter(c.category for c in chunks).items(), key=lambda kv: (-kv[1], kv[0])))` 用 Python 在文件这边数一遍,同样的排序规则,两边应该逐项相同。`key` 返回元组 `(-数量, 名字)`,负号让数量从大到小。
- `conn.execute("DELETE FROM kb_chunks")` 对完就清空。Day 231 的同步程序第一次运行时,应该面对一张空表,打印「42 块全部新算」。
- `print("对完清空,留给 Day 231:",` 实测 `(0,)`。

</div>

```bash
uv run python -m part04.w33_to_pg
```

真实输出:

```text
index/ 里:42 块,向量 (42, 1024)
库里行数: 42
编号一致: True
正文一致: True  向量最大差: 0.0
SQL 分组: [('套餐与计费', 10), ('错误码', 8), ('账号与安全', 6), ('退款', 6), ('数据导入导出', 4), ('发票', 3), ('团队与权限', 3), ('开发者', 2)]
Python 数: [('套餐与计费', 10), ('错误码', 8), ('账号与安全', 6), ('退款', 6), ('数据导入导出', 4), ('发票', 3), ('团队与权限', 3), ('开发者', 2)]
对完清空,留给 Day 231:(0,)
```

全部对上。整个脚本在我的老 Mac 上跑了 2.5 秒左右(`time` 命令测的,大部分是 Python 启动和 import numpy)。

做这个小项目时有两个地方值得停一下。

第一,对账一定要按**编号**对,不能按位置对。`SELECT` 不写 `ORDER BY` 时,数据库按它方便的顺序返回,刚插完时往往恰好是插入顺序,于是按位置比也能通过,但这只是碰巧。以后表里经历过更新和删除,顺序就会变。Day 225 的「两个文件靠下标对齐」本来就是我们想摆脱的东西,别在数据库这边又绕回去。

第二,这个脚本是「全量搬运」:每次清空、全部重写。42 块无所谓,真实的知识库几万篇、运营每天改几篇,这样做就太浪费了,而且清空和重写之间的那几秒,表是空的,查询会什么都查不到。Day 231 要做的增量更新,就是解决这两件事:只动改过的块,不清空整张表。`content_hash` 那一列今天填的 `"-"`,就是给它留的位置。

## 本周错题与坑清单

| 坑 | 症状 | 报错吗 | 修法 | 出处 |
| --- | --- | --- | --- | --- |
| 忘了 `re.M` | 每篇 0 块,`load_chunks()` 返回空列表 | 不报错 | `flags=re.M`;切完数块数 | Day 224 |
| 块不带标题前缀 | 重名小节(「解决办法」)排名掉到第 4 | 不报错 | 拼「标题 > 小节」 | Day 224 |
| `overlap >= max_chars` | 程序卡死,内存还在涨 | 不报错 | 函数开头 `if not 0 <= overlap < max_chars` | Day 224 |
| `glob` 不排序 | 块顺序每次可能不同 | 不报错 | `sorted(DATA.glob(...))` | Day 224 |
| `np.save` 自动补 `.npy` | 存的时候没写后缀,读的时候 `FileNotFoundError` | 报错 | 存和读都写全后缀 | Day 225 |
| 只重建了一个文件 | 0.820 的「重复扣款」取出「年付套餐」 | 不报错 | 两个文件一起写,读时核对行数 | Day 225 |
| `argsort` 忘了负号 | 拿到最不像的 k 块,模型说没找到 | 不报错 | `np.argsort(-scores)`,先打印检索结果 | Day 226 |
| 引用检查按形状找 | `[kb-003#2#1]` 被当成合法的 `kb-003#2` | 不报错 | 按方括号取整段,和白名单整体比 | Day 226 |
| 拒答话术不写死 | 模型拒了,程序认不出 | 不报错 | 话术写死,判定代码用同一字符串 | Day 227 |
| 拒答时还引资料 | 用户误读成「只支持支付宝」 | 不报错 | 拒答就一句话,不带出处 | Day 227 |
| SQL 字符串用双引号 | `column "pro" does not exist` | 报错 | 字符串一律单引号 | Day 228 |
| 占位符写成 `?` | `the query has 0 placeholders` | 报错 | psycopg 用 `%s` | Day 228 |
| 不用 `with` 也不 commit | 当时查得到,重连就没了 | 不报错 | `with psycopg.connect(...)` | Day 228 |
| 服务没开 | `Connection refused` | 报错 | 看菜单栏大象,`lsof` 查 5432 | Day 228 |
| 先建表后启用扩展 | `type "vector" does not exist` | 报错 | 建表 SQL 第一句 `CREATE EXTENSION` | Day 229 |
| 先注册后启用扩展 | `vector type not found in the database` | 报错 | `connect()` 里先启用再 `register_vector` | Day 229 |
| 以为读出来是数组 | `'Vector' object has no attribute 'dtype'` | 报错 | `.to_numpy()` | Day 229 |
| 按位置对账 | 今天碰巧过,改过数据后误报 | 不报错 | 按编号建字典再比 | 今天 |

数一下「报错吗」那一列:18 个坑里只有 7 个会报错,其中 6 个在数据库那两天;前四天的 10 个坑只有 `np.save` 补后缀那一个报错。这很能说明问题:numpy 加文件的方案几乎不替你检查任何东西,错了就安静地错;换成 Postgres 以后,类型、维度、主键、扩展这些都变成了硬约束,大量错误从「答案悄悄变差」变成了「当场报一行红字」。这也是我们换数据库的一个理由,虽然 Day 228 开头没把它列进去。

## 动手练习

**练习 1:在一个全新的库上跑 pg_store.py。** 不改代码,用环境变量临时把 `PG_DSN` 指向一个新建的空库 `agentzero_w33`,运行 `pg_store.py`,确认扩展被自动启用、表被建好,最后删掉这个库。说说为什么 `connect()` 里那句 `CREATE EXTENSION` 不能省。

<details><summary>参考答案</summary>

```bash
createdb agentzero_w33
PG_DSN=postgresql://minliu@localhost:5432/agentzero_w33 uv run python -m part04.pg_store
psql -d agentzero_w33 -c '\dx vector' -c '\dt'
dropdb agentzero_w33
```

<div class="line-notes">

- `createdb agentzero_w33` 新建一个什么都没有的库。
- `PG_DSN=postgresql://minliu@localhost:5432/agentzero_w33 uv run python -m part04.pg_store` 在命令前面写 `变量=值`,只对这一条命令生效。`load_dotenv()` 默认**不覆盖**已经存在的环境变量,所以这里的值优先于 `.env` 里的。把 `minliu` 换成你的用户名。
- `psql -d agentzero_w33 -c '\dx vector' -c '\dt'` `-c` 可以写多个,依次执行。
- `dropdb agentzero_w33` 用完删掉。

</div>

```text
拼好的那一行: embedding     vector(1024) NOT NULL,
kb_chunks 建好了,现在有 0 行
                           List of installed extensions
  Name  | Version | Schema |                     Description
--------+---------+--------+------------------------------------------------------
 vector | 0.8.6   | public | vector data type and ivfflat and hnsw access methods
(1 row)

          List of relations
 Schema |   Name    | Type  | Owner
--------+-----------+-------+--------
 public | kb_chunks | table | minliu
(1 row)
```

空库上一次跑通。`connect()` 在 `register_vector` 之前先执行 `CREATE EXTENSION IF NOT EXISTS vector`,所以新库不会报 `vector type not found`。删掉这一句,同样的命令在新库上就会在 `register_vector` 那里失败(Day 229 的踩坑)。测试时临时建库、部署到新环境,都是这个场景。

</details>

**练习 2:在 psql 里看看 kb-002。** 把小项目最后那句 `DELETE` 临时注释掉再跑一次,让 42 块留在表里。然后在 psql 里查出 kb-002 的所有块(编号、小节、正文字数),再按分类统计块数和平均字数。查完把表清空。

<details><summary>参考答案</summary>

注释掉 `w33_to_pg.py` 倒数第二句 `conn.execute("DELETE FROM kb_chunks")` 后重跑,然后:

```sql
SELECT id, section, length(content) AS 字数 FROM kb_chunks WHERE doc_id = 'kb-002' ORDER BY id;
SELECT category, count(*) AS 块数, round(avg(length(content))) AS 平均字数
FROM kb_chunks GROUP BY category ORDER BY 平均字数 DESC;
DELETE FROM kb_chunks;
```

<div class="line-notes">

- `SELECT id, section, length(content) AS 字数 FROM kb_chunks WHERE doc_id = 'kb-002' ORDER BY id;` `length()` 数字符数,中文一个字算 1。`doc_id` 就是为「按文章找块」留的列。
- `SELECT category, count(*) AS 块数, round(avg(length(content))) AS 平均字数` `avg` 求平均,`round` 四舍五入到整数。
- `FROM kb_chunks GROUP BY category ORDER BY 平均字数 DESC;` 按分类分组,平均字数从大到小。
- `DELETE FROM kb_chunks;` 清空,把空表留给 Day 231。记得把脚本里的那句注释改回来。

</div>

```text
    id    |  section   | 字数
----------+------------+------
 kb-002#1 | 年付套餐   |  133
 kb-002#2 | 月付套餐   |   52
 kb-002#3 | 重复扣款   |   50
 kb-002#4 | 审批与到账 |   74
(4 rows)

   category   | 块数 | 平均字数
--------------+------+----------
 发票         |    3 |       83
 退款         |    6 |       82
 错误码       |    8 |       78
 套餐与计费   |   10 |       76
 数据导入导出 |    4 |       72
 开发者       |    2 |       63
 账号与安全   |    6 |       63
 团队与权限   |    3 |       51
(8 rows)

DELETE 42
```

字数包括「退款政策 > 年付套餐」这样的前缀。这类问题以前要写 Python 循环,现在一句 SQL。Day 234 讲「只在退款类里找」时,`WHERE category = '退款'` 就是这么用的。

</details>

**练习 3:从库里读回向量做检索,结果和 .npy 一样吗?** 把 42 块写进 `kb_chunks`,`SELECT id, embedding` 读回来拼成矩阵,用 Day 226 的矩阵乘法和 `argsort` 检索「重复扣款多久能退回来」,和直接用 `index/vectors.npy` 检索的 top-4 比较。最后清空表。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_w33_pg_search.py
import numpy as np

from common.embed import embed_one
from part04.build_index import load_index
from part04.pg_store import connect, init_schema

chunks, vectors = load_index()
q = embed_one("重复扣款多久能退回来")
top_npy = [chunks[i].id for i in np.argsort(-(vectors @ q))[:4]]

with connect() as conn:
    init_schema(conn)
    for c, v in zip(chunks, vectors):
        conn.execute(
            "INSERT INTO kb_chunks (id, doc_id, title, category, section, content, content_hash, embedding)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (c.id, c.doc_id, c.title, c.category, c.section, c.text, "-", v),
        )
    rows = conn.execute("SELECT id, embedding FROM kb_chunks ORDER BY id").fetchall()
    conn.execute("DELETE FROM kb_chunks")

ids = [r[0] for r in rows]
matrix = np.stack([r[1].to_numpy() for r in rows])
scores = matrix @ q
top_db = [ids[i] for i in np.argsort(-scores)[:4]]
print("矩阵", matrix.shape, matrix.dtype)
print(".npy 版:", top_npy)
print("库里版:", top_db)
print("一样:", top_npy == top_db, " 第 1 名分数", round(float(scores.max()), 3))
```

<div class="line-notes">

- `q = embed_one("重复扣款多久能退回来")` 问题只编码一次,两边共用,保证比较公平。这是今天唯一的一次 embedding 请求之一。
- `top_npy = [chunks[i].id for i in np.argsort(-(vectors @ q))[:4]]` 文件版检索,就是 Day 226 的 `search` 拆开写。
- `rows = conn.execute("SELECT id, embedding FROM kb_chunks ORDER BY id").fetchall()` 这次写了 `ORDER BY id`,行顺序固定;下面 `ids` 和 `matrix` 用同一个顺序,下标对得上。
- `conn.execute("DELETE FROM kb_chunks")` 读完就清空,表留给 Day 231。
- `matrix = np.stack([r[1].to_numpy() for r in rows])` `np.stack` 把 42 个 `(1024,)` 数组摞成 `(42, 1024)` 的矩阵,相当于 Day 225 读 `.npy` 得到的那个东西,只是行顺序按 id 排。
- `top_db = [ids[i] for i in np.argsort(-scores)[:4]]` 行号换回编号时用的是 `ids`,不是 `chunks`:两边行顺序不一定相同。
- `print("一样:", top_npy == top_db,` 两个列表逐项相等才是 `True`。

</div>

```text
矩阵 (42, 1024) float32
.npy 版: ['kb-002#3', 'kb-004#2', 'kb-002#4', 'kb-004#1']
库里版: ['kb-002#3', 'kb-004#2', 'kb-002#4', 'kb-004#1']
一样: True  第 1 名分数 0.82
```

一模一样。这说明「存进数据库」这件事没有改变检索结果。当然,把整张表读回 Python 再做矩阵乘法,数据库只是当了个仓库,真正的检索应该在数据库里用 `<=>` 和索引来做,不必把几十万个向量搬出来。那是 Day 232 的内容。

</details>

**练习 4(开放题):默写六句 SYSTEM,用 difflib 自己批改。** 合上 Day 227,把六句 `SYSTEM` 默写进一个字符串,用标准库 `difflib` 和 `rag_numpy.py` 里的标准版逐行比较,打印差异。漏了哪句,就回 Day 227 看那句防的是哪个坑。

<details><summary>参考答案</summary>

示范一个故意默写不全的版本:

```python
# agent-zero-lab/part04/ex_w33_system_diff.py
import difflib

from part04.rag_numpy import SYSTEM

MINE = """你是云簿 CloudLedger 的客服助手。
只根据 <资料> 里的内容回答用户问题,不要用你自己的常识补充 CloudLedger 的规则。
每一个事实性的句子后面,用方括号标注出处,例如 [kb-002#1]。
如果资料里没有足够的信息回答,就说没找到,建议转人工客服。
回答用简洁的中文,先给结论,再给条件和步骤。"""

for line in difflib.unified_diff(SYSTEM.splitlines(), MINE.splitlines(), "标准", "我默写的", lineterm="", n=0):
    print(line)
```

<div class="line-notes">

- `import difflib` 标准库,比较两段文本的差异,`git diff` 的输出格式就是它能生成的那种。
- `from part04.rag_numpy import SYSTEM` 标准答案直接从代码里取,不用再抄一遍,也就不会抄错。
- `MINE = """你是云簿 CloudLedger 的客服助手。` 我的默写版:漏了「一句话用到多块资料就都标上」和整句「只能原样照抄 id」,拒答话术也没写死。
- `for line in difflib.unified_diff(SYSTEM.splitlines(), MINE.splitlines(), "标准", "我默写的", lineterm="", n=0):` 两边都按行切开再比。`lineterm=""` 让输出行末不再多加换行;`n=0` 表示不显示没变的上下文行,只看差异。
- `print(line)` `-` 开头是标准版有、我没写对的,`+` 开头是我写的。

</div>

```text
--- 标准
+++ 我默写的
@@ -3,3 +3,2 @@
-每一个事实性的句子后面,用方括号标注出处,例如 [kb-002#1]。一句话用到多块资料就都标上。
-出处只能原样照抄 <doc> 标签里的 id,不要在后面再加编号。
-如果资料里没有足够的信息回答,就直接说「帮助中心里没有找到这个问题的说明,建议转人工客服」,不要猜。
+每一个事实性的句子后面,用方括号标注出处,例如 [kb-002#1]。
+如果资料里没有足够的信息回答,就说没找到,建议转人工客服。
```

差异集中在第 3 到 5 句。漏掉的「只能原样照抄 id」正是 Day 227 实测把编造编号从 3/3 降到 0/3 的那一句;拒答话术写成了「就说没找到」,Day 227 的拒答测试会因此一道拒答都认不出。这两处都不会让程序报错,只会让测试分数掉下来,正好是这一周反复见到的那种错误。

</details>

验收标准:`w33_chunk_check.py`、`w33_search_check.py`、`w33_to_pg.py` 三个脚本输出和文中一致;跑完以后 `psql -d agentzero -c 'SELECT count(*) FROM kb_chunks'` 是 0;坑清单里至少八个能不看表说出症状和修法。

## 名词解释

本周新术语都已在当天的名词表里,这里只收今天新出现的几个,其余按天回查。

| 名词 | 意思 |
| --- | --- |
| 全量搬运 | 每次清空目标、把所有数据重写一遍。简单可靠,数据多了就慢且贵,清空期间目标是空的 |
| 增量更新 | 只写变了的部分。Day 231 用内容指纹实现 |
| 对账 | 把两份应该一样的数据逐项比较,找出不一致。今天比的是文件和数据库 |
| Counter | Python 标准库 `collections` 里的计数器,数列表里每个值出现几次 |
| np.stack | 把多个形状相同的数组摞成一个更高一维的数组,42 个 `(1024,)` 变成 `(42, 1024)` |
| difflib | Python 标准库,比较两段文本的差异,能输出和 `git diff` 一样的格式 |

## 常见误区

**按位置对账。** 刚插完数据时 `SELECT` 的顺序往往恰好是插入顺序,按位置比也能过,这是碰巧。要么写 `ORDER BY`,要么按编号建字典再比。

**以为数据库里的向量会变。** 今天实测向量最大差 `0.0`,float32 进、float32 出。检索结果不一样时,先查是不是用了不同的模型、不同的问题向量,或者行顺序和编号错配了。

**复习时只对着代码看。** 看懂和写得出是两回事。默写完一定跑检查脚本,让输出替你判卷,今天四个脚本都是这个用途。

**把小项目当成同步程序用。** `w33_to_pg.py` 每次清空重写,只是对账工具。Day 231 起往 `kb_chunks` 写数据一律走增量同步。

**忘了把表清空。** 练习 2 注释掉了 `DELETE`,如果忘了改回来,Day 231 第一次同步就不会是「42 块全部新算」,而是因为 `content_hash` 全是 `"-"` 而照样重算,输出和文章对不上,容易让人以为代码写错了。

**觉得不报错就没问题。** 本周 18 个坑里 11 个不报错,其中 9 个在 RAG 那四天。打印检索结果、留检查脚本、做小评估集,这些习惯比记住任何一个修法都重要。

## 学习资料

### 文档与文章

- [pgvector 官方 README](https://github.com/pgvector/pgvector):复习 Day 229 读过的 Getting Started 和 Storing,再往下预习 Querying 一节,那是 Day 232 的内容。
- [Pinecone · Chunking Strategies for LLM Applications](https://www.pinecone.io/learn/chunking-strategies/):Day 223 读过开头,今天读完全文,对照 Day 224 的「按标题切 + 按长度切」,看看还有哪些切法(语义切块等)以后可以试。
- [Anthropic · Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval):讲给每块补上下文前缀能把检索失败率降多少,和 Day 224 的「标题 > 小节」前缀是同一个思路的进阶版。
- [Python 文档 · difflib](https://docs.python.org/3/library/difflib.html):练习 4 用的模块,看 `unified_diff` 的参数说明。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1F1Yf6pE6v&p=6&autoplay=0&high_quality=1" title="【2026最新】B站最全最细Embedding与向量数据库全套教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Agent开发入门 · 【2026最新】B站最全最细Embedding与向量数据库全套教程 · 共 12 集。今天看第 6 集「向量数据库介绍」(9 分钟)复习这周为什么换数据库;第 1 集「从零理解 RAG 与核心组件」可以当本周知识地图的语音版。后面几集用的是 Chroma,和我们的 pgvector 思路相同、写法不同。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1KrNH6pEuS&autoplay=0&high_quality=1" title="RAG向量数据库怎么选?PgVector/Milvus/Qdrant 与中文 Embedding 对比" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>六六科技笔记 · RAG向量数据库怎么选?PgVector/Milvus/Qdrant 与中文 Embedding 对比 · 4 分钟,把 Day 229 的「为什么选 pgvector」再过一遍,为 Day 234 的选型做铺垫。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/T-D1OfcDW1M" title="What is Retrieval-Augmented Generation (RAG)?" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>IBM Technology · What is Retrieval-Augmented Generation (RAG)? · 英文,白板讲 RAG 为什么能减少胡编、为什么要带出处。复习 Day 226、227 的引用和拒答时看。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 6 章:Day 223 读到「chunking strategy」之前停下了,本周接着读完切块和检索那一段,对照自己切出的 42 块。

### 开源项目与代码

- [datawhalechina/all-in-rag](https://github.com/datawhalechina/all-in-rag):对照它讲切块和向量存储的章节,看它的切块参数、存储方案和我们这一周的选择有什么不同。
- [pgvector/pgvector-python](https://github.com/pgvector/pgvector-python):`register_vector` 的源码,Day 229 推荐过,复习时翻一下 `vector.py`,看 `to_numpy` 是怎么写的。

## 自测

**1. `chunk_article` 里如果把 `flags=re.M` 删掉,`load_chunks()` 会返回什么?为什么不报错?**

<details><summary>答案</summary>

返回空列表。没有 `re.M` 时 `^` 只匹配整段开头,而正文开头是一级标题不是 `## `,所以一刀都没切,`re.split` 返回只有一个元素的列表;`parts[1:]` 是空的,每篇 0 块。整个过程没有任何异常,只是数据变少了,所以切完要数块数。

</details>

**2. Day 225 的 `.npy + JSON` 和 Day 229 的 `kb_chunks` 表,各自靠什么保证「这块文字配这个向量」?**

<details><summary>答案</summary>

文件方案靠下标:`vectors.npy` 的第 i 行配 `chunks.json` 的第 i 块,两个文件必须由同一次构建写出,否则安静地错配(只能用行数检查挡住一部分)。表方案里文字和向量在同一行,天然绑在一起,按主键 `id` 取,不依赖顺序。

</details>

**3. 小项目里为什么要先 `DELETE` 再 INSERT?如果去掉这句,第二次运行会怎样?**

<details><summary>答案</summary>

`id` 是主键,第二次运行时 42 个编号都已经存在,第一条 INSERT 就会报 `duplicate key value violates unique constraint "kb_chunks_pkey"`。小项目是全量搬运,所以先清空;Day 231 的增量同步会用 upsert(有就更新、没有就插入)解决这个问题,而不是清空。

</details>

**4. 本周哪些坑会报错、哪些不会?这个分布说明了什么?**

<details><summary>答案</summary>

前四天(切块、存文件、检索、prompt)的坑基本都不报错:忘 `re.M`、只重建一个文件、`argsort` 忘负号、引用检查放过编造编号、拒答话术不固定,都只是让结果变差。后两天(Postgres、pgvector)的坑基本都报错:占位符、扩展顺序、维度不对、主键重复。说明数据库把很多约束变成了硬检查,而 RAG 本身的质量问题只能靠打印中间结果、检查脚本和评估集去发现。

</details>

**5. 面试题:你把一个 RAG 系统的存储从本地 numpy 文件迁移到 pgvector,怎么证明迁移没有改变检索质量?**

<details><summary>答案</summary>

分两层验证。数据层:迁移后逐行对账,按主键比较行数、编号集合、正文是否逐字相同、向量逐元素最大差(今天实测 0.0)、按分类的统计是否一致。行为层:拿一组固定的问题(最好是已有的评估集),问题向量只编码一次,分别在旧存储和新存储上检索,比较 top-k 是否相同(今天练习 3 完全一致)。还要注意新存储如果用了近似索引(HNSW),结果可能和精确检索有少量差异,这时要用召回率之类的指标量化差多少,而不是要求完全一致,这部分在 Day 233 和评估那几天会讲。

</details>

## 明天预告

明天是 [Day 231 · pgvector(二):写入和增量更新](/blog/agent-zero/day-231-pgvector-2/)。今天的小项目是「清空再全写」,明天换成正式做法:给每块算一个 sha256 内容指纹,和库里存的比,只给新增和改过的块算 embedding,用 upsert 写入,再删掉已经不存在的块。第二次同步应该一个 embedding 都不算。
