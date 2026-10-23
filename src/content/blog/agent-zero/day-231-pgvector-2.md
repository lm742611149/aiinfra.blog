---
title: 'Day 231 · pgvector(二):写入和增量更新'
description: '把 Day 229 建好的 kb_chunks 变成能日常维护的知识库。用 sha256 内容指纹判断哪一块变了,用 INSERT ... ON CONFLICT 写成"有就改、没有就加",整批写入包进事务,拼成 sync_chunks 和 pg_sync.py:第一次 42 块全算,第二次 0 块,改一个字只算 1 块。再解决两个真实的坑:插入一个小节后块编号整体后移,以及只改分类却被指纹漏掉。'
pubDate: 2026-10-23
regime: none
tags: ['pgvector', 'postgres', 'upsert', 'content-hash', 'agent-zero']
series: 'agent-zero'
day: 231
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 230](/blog/agent-zero/day-230-week33-review/) 默写了切块和检索的核心代码,又做了一个小项目:把 Day 225 的 `index/` 里的 42 块原样 `INSERT` 进 `kb_chunks`,读回来和 `.npy`、`chunks.json` 逐行对账,行数、编号、正文、向量、分类统计全部一致,最后清空了表。那次搬运很"傻":不管库里有什么,42 行一股脑插进去,第二遍跑会撞主键。

今天把"搬运"升级成真正能日常使用的同步程序:库里已经有的、没变的块不碰,改过的块重写,新增的块加上,文章删了的块也跟着删。关键是只给**变了的块**重新算 embedding。这就是[Day 224](/blog/agent-zero/day-224-chunking/)和[Day 221](/blog/agent-zero/day-221-why-rag/)里先后预告过的"增量更新"。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清为什么知识库要做增量更新,并用 `hashlib.sha256` 给每一块算**内容指纹**,拿它判断"这块变没变"。能说出指纹的三个性质:内容一样指纹一定一样,改一个字指纹全变,长度固定 64 个字符。
2. 会写 `INSERT ... ON CONFLICT (id) DO UPDATE`(upsert):行不存在就插入,存在就更新;知道 `EXCLUDED` 指什么;会用 `with conn.transaction():` 让一批写入要么全成功、要么全回滚。
3. 写出 `pg_store.sync_chunks()` 和 `part04/pg_sync.py`,实测第一次同步算 42 块,第二次 0 块,改一个字只算 1 块,删一篇文章 `deleted` 是 2。
4. 复现并修好两个真实的坑:在文章中间插入一个小节后,按编号比较会多算 2 块(借用库里已有的向量,降到只算 1 块);只比指纹会漏掉"正文没变、分类变了"的情况(把四个元数据也一起比)。

预计用时 3 小时:为什么要增量和内容指纹 35 分钟,对账、upsert 和事务 55 分钟,拼 `sync_chunks` 并跑四种场景 40 分钟,编号漂移和借用向量 30 分钟,剩下做练习。前置:[Day 229](/blog/agent-zero/day-229-pgvector-1/) 的 `part04/pg_store.py`(`connect`、`init_schema`、`kb_chunks` 九列)、[Day 230](/blog/agent-zero/day-230-week33-review/) 清空后的空表,[Day 224](/blog/agent-zero/day-224-chunking/) 的 `part04/chunking.py`(`Chunk`、`chunk_article`、`load_chunks`)和 `data/kb/` 的 20 篇文章,[Day 225](/blog/agent-zero/day-225-numpy-index/) 的 `index/` 和 `load_index()`,[Day 217](/blog/agent-zero/day-217-embed-service/) 的 `common/embed.py`,[Day 91](/blog/agent-zero/day-091-sql-6/) 的事务,[Day 221](/blog/agent-zero/day-221-why-rag/) 用过的 `hashlib`。

今天会调 embedding 接口,用 `.env` 里的 bge-m3(硅基流动上免费)。我实跑一整天,算上练习,一共约 1.2 万个 token,就算全按收费的 Qwen3-Embedding-8B(每百万 token 0.28 元,Day 220 查的价格)算,也只有 12,000 ÷ 1,000,000 × 0.28 ≈ 0.003 元。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `sync_chunks()` 的主体(读旧指纹、挑出 `todo`、upsert、删多余的);做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 为什么不每次全部重来

先看一下 Day 225 的做法:`build_index.py` 每次都把所有块重新算一遍 embedding。我在这台 2019 款 MacBook 上给 42 块算 embedding,5 次请求(`EMB_BATCH=10`,每批最多 10 段)共 0.76 秒,2219 个 token,平均每块约 53 个 token。小到根本没感觉。

放大看一看。真实的客服知识库,按几万篇文章切块算 5 万块,每块按 400 个 token(300 到 800 字的块差不多这个量级)估计,一次全量重算是 5 万 × 400 = 2000 万 token。用免费的 bge-m3 不花钱,但要发 5 万 ÷ 10 = 5000 次请求,按我测到的每次约 0.15 秒也是 12 分钟,还会碰到接口的限速;换成收费的 Qwen3-Embedding-8B,一次 20,000,000 ÷ 1,000,000 × 0.28 = 5.6 元,如果每天夜里全量重建,一个月 168 元。这些数字都是估算,但方向很清楚:运营一天改两三篇文章,几万块里有几块真的变了,全量重算等于 99.99% 的活是白干。

还有一件更重要但不花钱的事:全量重建的那几分钟里,库是什么状态?先清空再灌,期间用户问问题会查到空;边灌边查,会查到半新半旧。数据库里"只改变了的那几行,而且一批写入要么全成要么全不成",这两点正好是它擅长的。

所以今天要回答两个问题:**怎么知道哪些块变了**,以及**怎么把变了的块写进去**。第一个问题靠内容指纹,第二个靠 upsert 加事务。

## 第一步:给每一块算一个指纹

怎么判断一块"变没变"?最直白的办法是把库里存的正文和现在切出来的正文逐字比较。`kb_chunks` 里确实存着 `content`,这办法能用。但每次同步都得把所有块的正文从数据库拉回来,5 万块每块 1 KB 就是 50 MB,而且比较一长串文字没有"一个短标签"好用。更常见的做法是给正文算一个**指纹**(哈希,hash):用一个固定的算法把任意长度的文字压成一串固定长度的字符,存起来,下次只比指纹。

前端对这个东西很熟:Webpack 打包出来的 `main.3f2a1c.js`,文件名里那串字符就是文件内容的哈希,内容一变文件名就变,浏览器缓存因此知道要重新下载。Node 里是 `crypto.createHash("sha256").update(text).digest("hex")`,[Day 221](/blog/agent-zero/day-221-why-rag/) 我们已经在 Python 里用过它。

新建 `part04/hash_demo.py`,先摸清指纹的三个性质:

```python
# agent-zero-lab/part04/hash_demo.py
import hashlib

from part04.chunking import load_chunks


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


a = "同一笔订阅被重复扣款的,核实后全额退还重复的那一笔,3 个工作日内原路退回。"
b = a.replace("3 个", "5 个")
print("原文  ", sha(a))
print("改一个字", sha(b))
print("再算一遍", sha(a) == sha(a), " 长度:", len(sha(a)))

chunks = load_chunks()
hashes = [sha(c.text) for c in chunks]
print("42 块的指纹各不相同吗:", len(set(hashes)) == len(chunks))
print(chunks[0].id, hashes[0][:12], "…")
```

<div class="line-notes">

- `import hashlib` 标准库,里面有 sha256、md5 等各种哈希算法,不用装。
- `def sha(text: str) -> str:` 给一段文字算指纹,入参和返回值都是字符串。
- `return hashlib.sha256(text.encode("utf-8")).hexdigest()` 从里往外读:`text.encode("utf-8")` 先把字符串变成字节,因为哈希算法只能处理字节(Node 里相当于 `new TextEncoder().encode(text)`);`hashlib.sha256(...)` 算出哈希对象;`.hexdigest()` 把结果转成十六进制字符串。sha256 的结果是 256 个二进制位,每 4 位写成一个十六进制字符,所以固定是 64 个字符。
- `a = "同一笔订阅被重复扣款的,核实后全额退还重复的那一笔,3 个工作日内原路退回。"` 就是 kb-002「重复扣款」那一节的一句话,下面拿它做实验。
- `b = a.replace("3 个", "5 个")` 只把「3 个工作日」改成「5 个工作日」,一个数字的区别。
- `print("原文  ", sha(a))` 实测 `6ff66fdedccc6c58c80603801bd4c5b1f047135dbf20f9151c0b1df7a094c62b`。
- `print("改一个字", sha(b))` 实测 `bddc5f0c406e276bb97ee63c269b022e3224b41472a1f5ac89857999b567ceb2`。两串从第一个字符就不一样,看不出「只差一个字」的任何痕迹。
- `print("再算一遍", sha(a) == sha(a), " 长度:", len(sha(a)))` 同一段文字再算一次,指纹完全相同(`True`),长度 64。
- `chunks = load_chunks()` Day 224 的函数,切出 42 块。
- `hashes = [sha(c.text) for c in chunks]` 给每一块的 `text`(带「标题 > 小节」前缀的那段)各算一个指纹,得到 42 个字符串的列表。
- `print("42 块的指纹各不相同吗:", len(set(hashes)) == len(chunks))` `set` 去重后还是 42 个,所以是 `True`:42 块的正文各不相同,指纹也各不相同。
- `print(chunks[0].id, hashes[0][:12], "…")` 第 0 块 `kb-001#1` 的指纹前 12 位是 `5eb411589be2`,只打前 12 位,够肉眼区分。

</div>

```bash
cd /Users/你/agent-zero-lab
uv run python -m part04.hash_demo
```

我的输出:

```text
原文   6ff66fdedccc6c58c80603801bd4c5b1f047135dbf20f9151c0b1df7a094c62b
改一个字 bddc5f0c406e276bb97ee63c269b022e3224b41472a1f5ac89857999b567ceb2
再算一遍 True  长度: 64
42 块的指纹各不相同吗: True
kb-001#1 5eb411589be2 …
```

三个性质都看到了:同一段文字永远算出同一个指纹;改一个数字,指纹变得面目全非;长度永远是 64。有了它,判断"变没变"就变成比较两个 64 字符的字符串。

有人会担心:两段不同的文字算出相同的指纹怎么办?理论上可能,这叫**碰撞**。sha256 的指纹有 2 的 256 次方种,要碰撞到一次,全世界的电脑算到宇宙终结也不够,所以工程上当它不会发生。早年常用的 md5、sha1 已经被人造出过碰撞,安全场合不再用,今天我们只拿它做"变没变"的判断,用 sha256 是图个省心。

把它放进 `pg_store.py`。打开 Day 229 写的 `part04/pg_store.py`,文件开头加一行 `import hashlib`,在 `init_schema` 后面加上 `sha()`:

```python
# agent-zero-lab/part04/pg_store.py(新增:顶部多一行 import,sha() 放在 init_schema 后面)
import hashlib


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
```

<div class="line-notes">

- `import hashlib` 和 `import os` 一起放在文件开头的标准库那一组里。
- `def sha(text: str) -> str:` 和 `hash_demo.py` 里是同一个函数,搬到这里以后,同步程序和后面的练习都能 `from part04.pg_store import sha`。

</div>

## 第二步:把块分成三堆

有了指纹,同步要做的第一件事是**对账**:拿"库里上次同步完的样子"和"现在切出来的样子"比,把块分成三堆。

- 库里没有这个编号,或者编号有但指纹对不上,是**新增或改过的**,要写入。
- 库里有、指纹也对得上,是**没变的**,不用管。
- 库里有这个编号、但现在切不出这个编号了,是**多出来的**(文章删了或者小节删了),要从库里删掉。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="对账示意图:左列是库里的编号和指纹,右列是现在切出来的编号和指纹,四行分别对应没变、改过、新增、已删除四种情况,右侧标出处理方式">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink)">库里(上次同步完)</text>
<text x="250" y="26" fill="var(--ink)">现在切出来的</text>
<text x="470" y="26" fill="var(--ink)">怎么处理</text>
<rect x="20" y="40" width="190" height="34" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="32" y="62" fill="var(--ink-soft)">kb-002#2  指纹 a1</text>
<rect x="250" y="40" width="190" height="34" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="262" y="62" fill="var(--ink-soft)">kb-002#2  指纹 a1</text>
<text x="470" y="62" fill="var(--ink-soft)">不动,不算 embedding</text>
<rect x="20" y="92" width="190" height="34" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="32" y="114" fill="var(--ink-soft)">kb-002#3  指纹 b1</text>
<rect x="250" y="92" width="190" height="34" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="262" y="114" fill="var(--ink)">kb-002#3  指纹 b2</text>
<text x="470" y="114" fill="var(--ink)">改过 → 重算并覆盖</text>
<rect x="20" y="144" width="190" height="34" rx="5" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="32" y="166" fill="var(--ink-faint)">(库里没有)</text>
<rect x="250" y="144" width="190" height="34" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="262" y="166" fill="var(--ink)">kb-005#1  指纹 c1</text>
<text x="470" y="166" fill="var(--ink)">新增 → 重算并插入</text>
<rect x="20" y="196" width="190" height="34" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="218" fill="var(--ink)">kb-999#1  指纹 d1</text>
<rect x="250" y="196" width="190" height="34" rx="5" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="262" y="218" fill="var(--ink-faint)">(现在没有了)</text>
<text x="470" y="218" fill="var(--ink)">多出来 → 从库里删</text>
<line x1="210" y1="57" x2="250" y2="57" stroke="var(--ink-faint)"/>
<line x1="210" y1="109" x2="250" y2="109" stroke="var(--ink-faint)"/>
<line x1="440" y1="57" x2="466" y2="57" stroke="var(--ink-faint)"/>
<line x1="440" y1="109" x2="466" y2="109" stroke="var(--ink-faint)"/>
<line x1="440" y1="161" x2="466" y2="161" stroke="var(--ink-faint)"/>
<line x1="210" y1="213" x2="466" y2="213" stroke="var(--ink-faint)" stroke-dasharray="2 3"/>
<text x="20" y="266" fill="var(--ink-soft)" font-size="11">只有琥珀色的两行要调 embedding 接口;蓝色那行只删不算。</text>
<text x="20" y="286" fill="var(--ink-soft)" font-size="11">比的是 64 字符的指纹,不是整段正文。</text>
</g>
</svg>
<figcaption>对账的四种情况。左边是库里每块的编号和上次存下的指纹,中间是这次切出来的,右边是处理方式。琥珀色是要调 embedding 接口的块,蓝色是要删的块。</figcaption>
</figure>

先不碰数据库,用纯 Python 演示这个分堆。新建 `part04/diff_demo.py`:

```python
# agent-zero-lab/part04/diff_demo.py
from part04.chunking import load_chunks
from part04.pg_store import sha

chunks = load_chunks()

# 假装这是库里「上次同步完」的样子:块编号 → 指纹
existing = {c.id: sha(c.text) for c in chunks}
existing["kb-002#3"] = sha("旧版正文")           # 这一块后来被改过
del existing["kb-005#1"]                        # 这一块上次还没有,是新增的
existing["kb-999#1"] = sha("已经删掉的文章")      # 这一块上次有,现在没了

todo = [c for c in chunks if existing.get(c.id) != sha(c.text)]
gone = set(existing) - {c.id for c in chunks}

print("现在共", len(chunks), "块,库里共", len(existing), "块")
print("要写入:", [c.id for c in todo])
print("要删除:", gone)
```

<div class="line-notes">

- `from part04.pg_store import sha` 用刚才放进 `pg_store.py` 的 `sha()`。
- `chunks = load_chunks()` 现在切出来的 42 块。
- `existing = {c.id: sha(c.text) for c in chunks}` 字典推导式:块编号 → 指纹。这里假装它就是"库里上次同步完的样子",实际同步时这个字典是从数据库读出来的。刚造出来时和现在完全一致。
- `existing["kb-002#3"] = sha("旧版正文")` 把 kb-002#3 的指纹换成另一段文字的指纹,模拟"这块在上次同步以后被人改过"。
- `del existing["kb-005#1"]` 从"库里"删掉 kb-005#1,模拟"这块上次同步的时候还没有,是新增的"。
- `existing["kb-999#1"] = sha("已经删掉的文章")` 往"库里"加一个现在切不出来的编号,模拟"文章删了,块还留在库里"。
- `todo = [c for c in chunks if existing.get(c.id) != sha(c.text)]` 列表推导式加过滤,挑出要写入的块。`existing.get(c.id)` 是字典的安全取值:键不存在时返回 `None` 而不是报 `KeyError`。代入 kb-002#3:库里的指纹是"旧版正文"的,和现在的不相等,选中;代入 kb-005#1:`.get` 返回 `None`,`None` 和任何字符串都不相等,选中;代入 kb-001#1:相等,不选。
- `gone = set(existing) - {c.id for c in chunks}` `set(existing)` 取字典所有的键(编号);减去现在有的编号,剩下"库里有、现在没有"的。这里是 `{'kb-999#1'}`。
- `print("现在共", len(chunks), "块,库里共", len(existing), "块")` 现在 42 块;库里是 42 − 1(删了 kb-005#1)+ 1(多了 kb-999#1)= 42 块。
- `print("要写入:", [c.id for c in todo])` 实测 `['kb-002#3', 'kb-005#1']`。
- `print("要删除:", gone)` 实测 `{'kb-999#1'}`。

</div>

```bash
uv run python -m part04.diff_demo
```

```text
现在共 42 块,库里共 42 块
要写入: ['kb-002#3', 'kb-005#1']
要删除: {'kb-999#1'}
```

和图里一样:一块改过,一块新增,一块多出来。两堆写入、一堆删除,剩下的 40 块没人理它,也就不会去调接口。

## 第三步:写入用 upsert

对账出来要写的块,怎么写?直觉是 `INSERT`。但上面分出来的"改过的"那堆,编号已经在库里了,再 `INSERT` 会撞主键。故意试一下,新建 `part04/pg_dup.py`:

```python
# agent-zero-lab/part04/pg_dup.py
from part04.build_index import load_index
from part04.pg_store import connect, init_schema, sha

chunks, vectors = load_index()
c, v = chunks[1], vectors[1]
INSERT = (
    "INSERT INTO kb_chunks (id, doc_id, title, category, section, content, content_hash, embedding)"
    " VALUES (%s, %s, %s, %s, %s, %s, %s, %s)"
)
row = (c.id, c.doc_id, c.title, c.category, c.section, c.text, sha(c.text), v)

with connect() as conn:
    init_schema(conn)
    conn.execute("DELETE FROM kb_chunks")
    conn.execute(INSERT, row)
    print("第一次 INSERT:成功,表里", conn.execute("SELECT count(*) FROM kb_chunks").fetchone(), "行")
    conn.execute(INSERT, row)
    print("第二次 INSERT:这行不会打印")
```

<div class="line-notes">

- `chunks, vectors = load_index()` Day 225 的函数。这里只是要几块现成的向量来演示,不调 embedding 接口。
- `c, v = chunks[1], vectors[1]` 第 1 块是 `kb-001#2`(「套餐与价格 > 怎么选」),连同它的 1024 维向量。
- `INSERT = (` 括号里两个字符串相邻,Python 自动拼成一个。八列对应八个 `%s`,`updated_at` 不写,用默认的 `now()`。
- `row = (c.id, c.doc_id, c.title, c.category, c.section, c.text, sha(c.text), v)` 八个值,顺序和上面八列一一对上;`c.text` 进 `content` 列,`sha(c.text)` 进 `content_hash`。
- `conn.execute("DELETE FROM kb_chunks")` 先清空,保证第一次插入一定成功。
- `conn.execute(INSERT, row)` 第一次插入,成功。
- `print("第一次 INSERT:成功,表里",` 实测 `(1,)`。
- `conn.execute(INSERT, row)` 同一行再插一次,主键 `kb-001#2` 已经存在。

</div>

```bash
uv run python -m part04.pg_dup
```

```text
第一次 INSERT:成功,表里 (1,) 行
Traceback (most recent call last):
  ……
psycopg.errors.UniqueViolation: duplicate key value violates unique constraint "kb_chunks_pkey"
DETAIL:  Key (id)=(kb-001#2) already exists.
```

(中间那一大段 traceback 我省略了,只留下最后两行,最要紧的信息就在这两行里。)

`UniqueViolation`,违反唯一约束。要绕开,有三种办法:先 `SELECT` 看有没有、有就 `UPDATE` 没有就 `INSERT`;先 `DELETE` 再 `INSERT`;或者让数据库自己判断。前两种要来回两趟,而且两个同步程序同时跑时可能在"看过没有"和"插入"之间被对方抢先,结果还是撞主键。第三种是 Postgres 的 **upsert**:`INSERT` 后面加 `ON CONFLICT`,告诉它"撞了主键怎么办"。(upsert 是 update 加 insert 的合成词。Java 里的 MyBatis `insertOrUpdate`、Mongo 的 `upsert: true` 是一回事。)

新建 `part04/pg_upsert.py`,用同一行数据写两次,第二次改一点正文:

```python
# agent-zero-lab/part04/pg_upsert.py
import time

from part04.build_index import load_index
from part04.pg_store import connect, init_schema, sha

UPSERT = """
INSERT INTO kb_chunks (id, doc_id, title, category, section, content, content_hash, embedding)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (id) DO UPDATE SET
    doc_id = EXCLUDED.doc_id, title = EXCLUDED.title, category = EXCLUDED.category,
    section = EXCLUDED.section, content = EXCLUDED.content,
    content_hash = EXCLUDED.content_hash, embedding = EXCLUDED.embedding,
    updated_at = now()
"""

chunks, vectors = load_index()
c, v = chunks[1], vectors[1]
new_text = c.text.replace("专业版", "专业版(Pro)")
rows = [
    (c.id, c.doc_id, c.title, c.category, c.section, c.text, sha(c.text), v),
    (c.id, c.doc_id, c.title, c.category, c.section, new_text, sha(new_text), v),
]

with connect() as conn:
    init_schema(conn)
    conn.execute("DELETE FROM kb_chunks")
    for i, row in enumerate(rows, 1):
        conn.execute(UPSERT, row)
        r = conn.execute(
            "SELECT count(*), max(content_hash), max(updated_at::time(0)) FROM kb_chunks"
        ).fetchone()
        assert r is not None
        print(f"第 {i} 次 upsert 后:行数 {r[0]},指纹 {r[1][:8]},updated_at {r[2]}")
        time.sleep(2)
    last = conn.execute("SELECT content FROM kb_chunks").fetchone()
    assert last is not None
    print(last[0][:60])
```

<div class="line-notes">

- `import time` 为了在两次写入之间停 2 秒,让 `updated_at` 的变化肉眼看得出来。
- `UPSERT = """` 和 `pg_dup.py` 里同样的八列、八个 `%s`,多了下面的 `ON CONFLICT` 部分。
- `ON CONFLICT (id) DO UPDATE SET` 括号里写"按哪一列判断冲突",必须是有唯一约束的列,这里是主键 `id`。意思是:要插入的这行,如果 `id` 已经存在,就不要报错,改成对那一行做 `UPDATE`。
- `doc_id = EXCLUDED.doc_id, title = EXCLUDED.title, category = EXCLUDED.category,` `EXCLUDED` 是一个特殊的名字,指"这次想插入、但因为冲突没插进去的那一行"。`doc_id = EXCLUDED.doc_id` 就是把库里旧行的 `doc_id` 改成新的。
- `section = EXCLUDED.section, content = EXCLUDED.content,` 同上,正文换成新的。
- `content_hash = EXCLUDED.content_hash, embedding = EXCLUDED.embedding,` 指纹和向量也换成新的。正文变了向量必须一起变,不然会出现"新正文配旧向量",检索结果和读到的内容对不上。
- `updated_at = now()` `updated_at` 的默认值只在插入时生效,更新时不会自动变,所以要手动写一句。
- `new_text = c.text.replace("专业版", "专业版(Pro)")` kb-001#2 的正文里「选专业版」那句,加个括号,造出"改过的正文"。
- `rows = [` 两行数据:第一行是原文,第二行是改后的正文。注意两行的 `c.id` 相同,都是 `kb-001#2`。为了不调接口,向量两次都用 `v`,所以这个演示里"新正文配旧向量",只用来看 upsert 的行为,真实同步不能这样做。
- `conn.execute("DELETE FROM kb_chunks")` 每次实验从空表开始。
- `for i, row in enumerate(rows, 1):` `enumerate(rows, 1)` 同时给出序号(从 1 开始)和元素,相当于 JS 的 `rows.forEach((row, i) => ...)`。
- `conn.execute(UPSERT, row)` 第一次:`id` 不存在,走插入;第二次:`id` 已经存在,走更新,不报错。
- `"SELECT count(*), max(content_hash), max(updated_at::time(0)) FROM kb_chunks"` 一次问三个数:行数;指纹(只有一行,`max` 就是它本身);更新时间。`::time(0)` 把时间戳转成"时:分:秒"、去掉小数,方便看。
- `assert r is not None` `fetchone()` 可能返回 `None`,断言告诉类型检查器这里一定有行。
- `print(f"第 {i} 次 upsert 后:行数 {r[0]},指纹 {r[1][:8]},updated_at {r[2]}")` 实测第 1 次行数 1,指纹 `4749d857`;第 2 次行数还是 1,指纹变成 `a94da8f0`。
- `time.sleep(2)` 停 2 秒,所以两次的 `updated_at` 差 2 秒。
- `last = conn.execute("SELECT content FROM kb_chunks").fetchone()` 读出现在这一行的正文。
- `print(last[0][:60])` 实测里面确实是「选专业版(Pro)」:正文被改过的版本覆盖了。

</div>

```bash
uv run python -m part04.pg_upsert
```

```text
第 1 次 upsert 后:行数 1,指纹 4749d857,updated_at 11:18:52
第 2 次 upsert 后:行数 1,指纹 a94da8f0,updated_at 11:18:54
套餐与价格 > 怎么选
个人记账用免费版就够了。小团队或者需要多个账本的,选专业版(Pro)。需要对接自己系统、或者成员
```

行数一直是 1,指纹变了,更新时间晚了 2 秒,正文是新的。同一句 SQL,第一次插入、第二次更新,调用方不用关心是哪种情况。

`ON CONFLICT (id)` 有个前提:`id` 这一列必须有唯一约束。不满足时报错很直白,我在一张没有主键的临时表上试了一下:

```text
ERROR:  there is no unique or exclusion constraint matching the ON CONFLICT specification
```

意思是"找不到能判断冲突的唯一约束"。`kb_chunks` 的 `id` 是主键,自带唯一约束,所以今天没事。

## 第四步:一批写入包进事务

同步一次可能要写几十上百行。写到一半出了错,会怎样?新建 `part04/pg_tx.py`,故意让第 3 行写不进去(向量只有 3 维):

```python
# agent-zero-lab/part04/pg_tx.py
import numpy as np
import psycopg

from part04.build_index import load_index
from part04.pg_store import connect, init_schema, sha

INSERT = (
    "INSERT INTO kb_chunks (id, doc_id, title, category, section, content, content_hash, embedding)"
    " VALUES (%s, %s, %s, %s, %s, %s, %s, %s)"
)
chunks, vectors = load_index()
rows = [(c.id, c.doc_id, c.title, c.category, c.section, c.text, sha(c.text), v) for c, v in zip(chunks[:3], vectors[:3])]
# 把第 3 行的向量换成 3 维的,让它必然写不进去
rows[2] = rows[2][:7] + (np.array([0.1, 0.2, 0.3], dtype=np.float32),)


def count(conn: psycopg.Connection) -> int:
    row = conn.execute("SELECT count(*) FROM kb_chunks").fetchone()
    return row[0] if row else 0


with connect() as conn:
    init_schema(conn)
    conn.execute("DELETE FROM kb_chunks")
    try:
        for r in rows:
            conn.execute(INSERT, r)
    except psycopg.Error as e:
        print("没包事务:", type(e).__name__, e, "| 表里留下", count(conn), "行")

    conn.execute("DELETE FROM kb_chunks")
    try:
        with conn.transaction():
            for r in rows:
                conn.execute(INSERT, r)
    except psycopg.Error as e:
        print("包了事务:", type(e).__name__, e, "| 表里留下", count(conn), "行")
```

<div class="line-notes">

- `import numpy as np` 要用它造一个 3 维的假向量。
- `import psycopg` 这次要用 `psycopg.Error`(psycopg 所有错误的父类)和类型标注。
- `rows = [(c.id, c.doc_id, c.title, c.category, c.section, c.text, sha(c.text), v) for c, v in zip(chunks[:3], vectors[:3])]` 取前 3 块和它们的向量,各拼成一个八元组。`zip` 把两个列表一一配对,相当于 JS 里 `chunks.map((c, i) => [c, vectors[i]])`。
- `rows[2] = rows[2][:7] + (np.array([0.1, 0.2, 0.3], dtype=np.float32),)` 元组不能改,所以取前 7 项(到 `sha(c.text)` 为止),再接上一个只有 1 项的新元组,换掉最后的向量。逗号不能省,不写逗号它就不是元组,而是一个被括号包着的数组。这样第 3 行的向量是 3 维的。
- `def count(conn: psycopg.Connection) -> int:` 数表里现在有几行的小函数,后面调两次。
- `row = conn.execute("SELECT count(*) FROM kb_chunks").fetchone()` 数行数,`fetchone()` 可能是 `None`,下一行处理。
- `return row[0] if row else 0` 有结果就取第 0 项,没有就当 0。
- `for r in rows:` 第一种写法:每行各自 `execute`,不包事务。`connect()` 用了 `autocommit=True`,每条语句执行完立刻生效,所以前两行已经落库了。
- `except psycopg.Error as e:` 第 3 行因为向量维度不对抛 `DataException`,它是 `psycopg.Error` 的子类。
- `print("没包事务:", type(e).__name__, e, "| 表里留下", count(conn), "行")` 实测 `DataException expected 1024 dimensions, not 3`,表里留下 2 行。
- `conn.execute("DELETE FROM kb_chunks")` 清空,准备第二种写法。
- `with conn.transaction():` 第二种写法:在 `with` 块里的所有语句属于同一个事务。进入时 psycopg 发 `BEGIN`;块正常结束发 `COMMIT`;块里抛了异常,发 `ROLLBACK`,然后把异常继续往外抛。
- `print("包了事务:"` 同样的错误,但表里留下 0 行:前两行写成功了又被撤销了。

</div>

```bash
uv run python -m part04.pg_tx
```

```text
没包事务: DataException expected 1024 dimensions, not 3 | 表里留下 2 行
包了事务: DataException expected 1024 dimensions, not 3 | 表里留下 0 行
```

没包事务,库里留下"前两行新、第三行以后没写"的半成品;包了事务,出错就整批撤销,库还是同步之前的样子。事务的 commit 和 rollback 在 [Day 91](/blog/agent-zero/day-091-sql-6/)(SQLite)和 [Day 228](/blog/agent-zero/day-228-postgres-basics/) 见过,这里换了一种更省事的写法:`connect()` 返回的是自动提交的连接,需要"一批一起成功"的地方,单独套一个 `with conn.transaction():`,不用自己写 `BEGIN` 和 `COMMIT`。

对知识库来说这点很要紧。半成品意味着用户这时候提问,检索到的有的是新版、有的是旧版;更糟的是同步程序崩了以后没人知道库停在哪一步。有了事务,库只有"同步前"和"同步后"两种状态。

## 第五步:拼成 sync_chunks 和 pg_sync.py

零件齐了:指纹、对账、upsert、事务。现在把它们拼成一个函数,放进 `pg_store.py`。先把文件开头的 import 区补全,新增的是 `Callable`、`numpy`、`Chunk` 三个,`hashlib` 刚才已经加过:

```python
# agent-zero-lab/part04/pg_store.py(开头的 import 区,改完是这样)
import hashlib
import os
from collections.abc import Callable

import numpy as np
import psycopg
from dotenv import load_dotenv
from pgvector.psycopg import register_vector
from psycopg import sql

from part04.chunking import Chunk
```

<div class="line-notes">

- `from collections.abc import Callable` 给"函数类型"做标注用的。下面 `embed_fn` 这个参数是一个函数,要用它告诉类型检查器"这个函数收一个字符串列表、返回一个数组"。
- `import numpy as np` 只用在类型标注里,`embed_fn` 的返回值是 numpy 数组。
- `from part04.chunking import Chunk` Day 224 的 `Chunk`,标注 `chunks` 参数的元素类型。`pg_store.py` 因此依赖了 `chunking.py`,方向是"存储层认识块的形状",反过来不行,不然两个文件互相 import 会报循环引用。

</div>

再把 `pg_upsert.py` 里那一大段 `UPSERT = """..."""` 原样复制到 `pg_store.py` 里,放在 `SCHEMA` 的后面、`connect()` 的前面,别的一个字不改。最后在 `sha()` 后面,`if __name__ == "__main__":` 前面,写同步函数:

```python
# agent-zero-lab/part04/pg_store.py(新增,放在 sha() 后面)
def sync_chunks(
    conn: psycopg.Connection,
    chunks: list[Chunk],
    embed_fn: Callable[[list[str]], np.ndarray],
) -> dict[str, int]:
    """把切好的块同步进库:新增和改过的才算 embedding 并写入,库里多出来的删掉。"""
    existing: dict[str, str] = dict(conn.execute("SELECT id, content_hash FROM kb_chunks").fetchall())
    todo = [c for c in chunks if existing.get(c.id) != sha(c.text)]
    vectors = embed_fn([c.text for c in todo]) if todo else []
    gone = set(existing) - {c.id for c in chunks}
    with conn.transaction():
        for c, v in zip(todo, vectors):
            conn.execute(UPSERT, (c.id, c.doc_id, c.title, c.category, c.section, c.text, sha(c.text), v))
        if gone:
            conn.execute("DELETE FROM kb_chunks WHERE id = ANY(%s)", (list(gone),))
    return {"total": len(chunks), "embedded": len(todo), "deleted": len(gone)}
```

<div class="line-notes">

- `def sync_chunks(` 三个参数各占一行:连接、切好的块、"算 embedding 的函数"。
- `embed_fn: Callable[[list[str]], np.ndarray],` 把算 embedding 的函数当参数传进来,而不是在函数里直接 `import embed`。好处有两个:测试时能换成不调接口的假函数(练习 4 和后面的实验都在用),以后换模型或换服务只改调用的地方。相当于 JS 里把 `fetch` 当参数注入。
- `) -> dict[str, int]:` 返回一个字典:统计各种数字,实测形如 `{'total': 42, 'embedded': 42, 'deleted': 0}`。
- `existing: dict[str, str] = dict(conn.execute("SELECT id, content_hash FROM kb_chunks").fetchall())` `fetchall()` 返回二元组的列表 `[('kb-001#1', '5eb4…'), ('kb-001#2', '4749…'), …]`,`dict()` 把它直接变成 `{编号: 指纹}`。第一次同步时表是空的,`existing = {}`;第二次是 42 项。前面的 `: dict[str, str]` 是给类型检查器看的标注。
- `todo = [c for c in chunks if existing.get(c.id) != sha(c.text)]` 和 `diff_demo.py` 一样的挑选。第一次运行 `existing` 为空,`.get` 全是 `None`,42 块全进 `todo`;第二次指纹全部对得上,`todo = []`。
- `vectors = embed_fn([c.text for c in todo]) if todo else []` 条件表达式,相当于 JS 的 `todo.length ? embed(...) : []`。`todo` 是空列表时直接得 `[]`,**连接口都不调**,第二次同步因此一个 token 都不花。`embed_fn` 自己按 `EMB_BATCH` 分批,这里不用管。
- `gone = set(existing) - {c.id for c in chunks}` 库里有、现在没有的编号。
- `with conn.transaction():` 下面的写入和删除属于同一个事务。注意算 embedding 放在事务**外面**:调接口可能要几十秒,不要让一个事务一直开着占用数据库。
- `for c, v in zip(todo, vectors):` 把每个要写的块和它的向量配对。`vectors` 是 `(len(todo), 1024)` 的数组,按行遍历,`v` 是形状 `(1024,)` 的一行。
- `conn.execute(UPSERT, (c.id, c.doc_id, c.title, c.category, c.section, c.text, sha(c.text), v))` 代入第一块:`('kb-001#1', 'kb-001', '套餐与价格', '套餐与计费', '三种套餐', '套餐与价格 > 三种套餐\nCloudLedger 提供免费版……', '5eb411589be2…', 1024 维数组)`。存进 `content` 的是带「标题 > 小节」前缀的那段,也就是送去算 embedding 的同一段文字。
- `if gone:` 没有要删的就跳过,不发空删除。
- `conn.execute("DELETE FROM kb_chunks WHERE id = ANY(%s)", (list(gone),))` `= ANY(数组)` 是"等于数组里的任何一个",一条 SQL 删多行,相当于 `WHERE id IN (...)`,但数组只占一个参数位。psycopg 把 Python 列表自动转成 Postgres 数组。参数写成 `(list(gone),)`,末尾的逗号不能省,否则不是元组。
- `return {"total": len(chunks), "embedded": len(todo), "deleted": len(gone)}` 三个数:现在共几块,这次算了几块 embedding,删了几块。

</div>

再写同步脚本。新建 `part04/pg_sync.py`:

```python
# agent-zero-lab/part04/pg_sync.py
"""离线流水线的数据库版:切块 → 只给变化的块算 embedding → 写进 kb_chunks。"""
from common.embed import embed, usage
from part04.chunking import load_chunks
from part04.pg_store import connect, init_schema, sync_chunks

if __name__ == "__main__":
    with connect() as conn:
        init_schema(conn)
        result = sync_chunks(conn, load_chunks(), embed)
        print(result)
        print(f"embedding {usage['requests']} 次请求,{usage['tokens']} token")
        row = conn.execute("SELECT count(*) FROM kb_chunks").fetchone()
        print("库里现在有", row[0] if row else 0, "块")
```

<div class="line-notes">

- `from common.embed import embed, usage` `embed` 是 Day 217 写的函数,`usage` 是那个模块级字典,记着这个进程里调了几次接口、用了多少 token。
- `from part04.pg_store import connect, init_schema, sync_chunks` 今天写的 `sync_chunks` 和 Day 229 的两个函数。
- `if __name__ == "__main__":` 直接运行时才执行,被别的文件 `import` 时不会。
- `with connect() as conn:` 连上库。`with` 块结束时连接自动关闭。
- `init_schema(conn)` 表已经有就跳过(幂等),保证在一个全新的库上也能跑。
- `result = sync_chunks(conn, load_chunks(), embed)` 注意最后一个参数是 `embed` 本身,没有括号:把函数交给 `sync_chunks`,由它决定调不调、调几次。`load_chunks()` 切出 42 块。
- `print(result)` 打印统计字典。
- `print(f"embedding {usage['requests']} 次请求,{usage['tokens']} token")` 实测第一次是 5 次请求、2219 token,第二次是 0 和 0。f-string 外层用双引号,里面取字典的键就得用单引号。
- `row = conn.execute("SELECT count(*) FROM kb_chunks").fetchone()` 数一下库里现在有多少行。
- `print("库里现在有", row[0] if row else 0, "块")` `row` 是 `None` 时当 0。

</div>

连跑两次:

```bash
uv run python -m part04.pg_sync
uv run python -m part04.pg_sync
```

```text
{'total': 42, 'embedded': 42, 'deleted': 0}
embedding 5 次请求,2219 token
库里现在有 42 块
{'total': 42, 'embedded': 0, 'deleted': 0}
embedding 0 次请求,0 token
库里现在有 42 块
```

第一次 42 块全算,2219 token;第二次一块都不算,一次请求都没发。表里还是 42 行,没有重复,因为用的是 upsert。

### 改一个字、删一篇文章

现在模拟运营的两种日常操作。第一种:把退款政策里重复扣款那句的「3 个工作日内原路退回」改成「5 个工作日」。`data/kb/` 是 `make_kb.py` 生成的(Day 222 的规矩,不手改生成的文件),所以改生成器再重新生成。文章里有两处"3 个工作日",我只改重复扣款这一处,用 sed 精确匹配:

```bash
sed -i '' 's/重复的那一笔,3 个工作日内原路退回/重复的那一笔,5 个工作日内原路退回/' part04/make_kb.py
uv run python -m part04.make_kb
uv run python -m part04.pg_sync
```

(`sed -i ''` 是 macOS 的写法,GNU sed 不要那两个单引号。)

```text
写入 20 篇到 data/kb
{'total': 42, 'embedded': 1, 'deleted': 0}
embedding 1 次请求,40 token
库里现在有 42 块
```

42 块里只算了 1 块,40 个 token。用 psql 看看是哪一块被更新了,`updated_at` 最新的前三行:

```bash
psql -d agentzero -c "select id, left(content_hash,8) h, updated_at::time(0) from kb_chunks order by updated_at desc limit 3"
```

```text
    id    |    h     | updated_at
----------+----------+------------
 kb-002#3 | fa50640e | 11:17:07
 kb-002#1 | 35408fb0 | 11:16:46
 kb-001#2 | 4749d857 | 11:16:46
```

`kb-002#3`(重复扣款那一节)的更新时间是 11:17:07,比其他行晚了 21 秒,指纹也换了;别的行停在第一次同步的那一秒。数据库里每一行"最后一次被碰是什么时候"一目了然,这就是 `updated_at` 的用处。

把 sed 反过来改回去,再同步一次:

```bash
sed -i '' 's/重复的那一笔,5 个工作日内原路退回/重复的那一笔,3 个工作日内原路退回/' part04/make_kb.py
uv run python -m part04.make_kb
uv run python -m part04.pg_sync | head -1
```

```text
写入 20 篇到 data/kb
{'total': 42, 'embedded': 1, 'deleted': 0}
```

改回去也要算 1 块,因为库里这一行存的已经是"5 个工作日"版本的指纹,旧版的向量没留着。

第二种操作:删掉整篇 kb-020(两块)。

```bash
rm data/kb/kb-020.md
uv run python -m part04.pg_sync | head -1
psql -d agentzero -Atc "select count(*) from kb_chunks where doc_id = 'kb-020'"
uv run python -m part04.make_kb
uv run python -m part04.pg_sync | head -1
```

```text
{'total': 40, 'embedded': 0, 'deleted': 2}
0
写入 20 篇到 data/kb
{'total': 42, 'embedded': 2, 'deleted': 0}
```

现在切出 40 块,库里 42 块,多出来的 2 块(kb-020#1 和 kb-020#2)被删掉了,没有调 embedding。随后 `make_kb` 把文章重新生成,同步又把这两块算回来。四种场景:全新(算 42)、没变(算 0)、改一个字(算 1)、删文章(算 0 删 2),全都对得上。

## 第六步:插入一个小节,编号后移,多算了两块

[Day 224](/blog/agent-zero/day-224-chunking/) 的练习 3 埋过一个伏笔:块编号用序号,在文章中间插一个小节,后面所有块的编号都往后挪一位。当时说"增量更新要按指纹判断,不能按编号",现在看看今天这个同步程序扛不扛得住。

新建 `part04/sync_drift.py`。它在一个临时目录里复制出 `data/kb/`,往 kb-002 里插入「退到哪里」一节,切块后同步:

```python
# agent-zero-lab/part04/sync_drift.py
import shutil
from pathlib import Path

import numpy as np

from common.embed import embed
from part04.chunking import chunk_article
from part04.pg_store import connect, sync_chunks

TMP = Path("part04/tmp_kb")
shutil.rmtree(TMP, ignore_errors=True)
shutil.copytree("data/kb", TMP)
f = TMP / "kb-002.md"
new_section = "## 退到哪里\n退款一律原路退回,不支持退到其他账户。\n\n## 重复扣款"
f.write_text(f.read_text(encoding="utf-8").replace("## 重复扣款", new_section), encoding="utf-8")
chunks = [c for p in sorted(TMP.glob("kb-*.md")) for c in chunk_article(p)]

sent: list[str] = []


def counting_embed(texts: list[str]) -> np.ndarray:
    sent.extend(texts)
    return embed(texts)


with connect() as conn:
    print(sync_chunks(conn, chunks, counting_embed))
print("送去算 embedding 的块:")
for t in sent:
    print("  ", t.split("\n")[0])
shutil.rmtree(TMP)
```

<div class="line-notes">

- `TMP = Path("part04/tmp_kb")` 改的是临时副本,不碰 `data/kb/`。
- `shutil.rmtree(TMP, ignore_errors=True)` 上一次没删干净的话先清掉;目录不存在时 `ignore_errors=True` 让它不报错。
- `shutil.copytree("data/kb", TMP)` 把整个 `data/kb/` 复制一份。
- `f = TMP / "kb-002.md"` 路径用 `/` 拼接,是 `pathlib` 的写法。
- `new_section = "## 退到哪里\n退款一律原路退回,不支持退到其他账户。\n\n## 重复扣款"` 新小节,末尾接回原来的 `## 重复扣款` 标题。
- `f.write_text(f.read_text(encoding="utf-8").replace("## 重复扣款", new_section), encoding="utf-8")` 读出整篇文章,把「## 重复扣款」换成"新小节 + 原标题",写回。结果是「月付套餐」后面多了一节。
- `chunks = [c for p in sorted(TMP.glob("kb-*.md")) for c in chunk_article(p)]` 双层推导式:外层按文件名排序遍历文章,内层遍历每篇的块,摊平成一个列表。相当于 JS 的 `files.flatMap(p => chunkArticle(p))`。`chunk_article` 是 Day 224 的函数,这里不用 `load_chunks()`,因为后者写死了读 `data/kb/`。
- `sent: list[str] = []` 一个列表,记下"这次送去算 embedding 的文字"。
- `def counting_embed(texts: list[str]) -> np.ndarray:` 包一层真正的 `embed`,先把收到的文字记下来,再原样调用。这是给函数加"监控"的最小写法。
- `sent.extend(texts)` 一次性把这批文字追加进列表。
- `return embed(texts)` 真正去调接口。
- `print(sync_chunks(conn, chunks, counting_embed))` 传的是包过的函数。库此刻是 42 块的正常状态,切出来 43 块。
- `print("  ", t.split("\n")[0])` 每段文字的第一行是「标题 > 小节」,够看出是哪一块。
- `shutil.rmtree(TMP)` 实验完删掉临时目录。

</div>

```bash
uv run python -m part04.sync_drift
```

```text
{'total': 43, 'embedded': 3, 'deleted': 0}
送去算 embedding 的块:
   退款政策 > 退到哪里
   退款政策 > 重复扣款
   退款政策 > 审批与到账
```

真正新增的只有「退到哪里」这一节,却算了三块。原因看图:

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="插入新小节前后 kb-002 的块编号对比:旧的第三块重复扣款变成新的第四块,旧的第四块审批与到账变成新的第五块,按编号比较会认为三块都变了,按指纹找才发现只有退到哪里是新内容">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink)">库里(插入前)</text>
<text x="400" y="26" fill="var(--ink)">现在切出来(插入后)</text>
<rect x="20" y="40" width="220" height="30" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="32" y="60" fill="var(--ink-soft)">#1  年付套餐</text>
<rect x="400" y="40" width="220" height="30" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="412" y="60" fill="var(--ink-soft)">#1  年付套餐</text>
<rect x="20" y="82" width="220" height="30" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="32" y="102" fill="var(--ink-soft)">#2  月付套餐</text>
<rect x="400" y="82" width="220" height="30" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="412" y="102" fill="var(--ink-soft)">#2  月付套餐</text>
<rect x="400" y="124" width="220" height="30" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="412" y="144" fill="var(--ink)">#3  退到哪里(新)</text>
<rect x="20" y="124" width="220" height="30" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="144" fill="var(--ink)">#3  重复扣款</text>
<rect x="20" y="166" width="220" height="30" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="186" fill="var(--ink)">#4  审批与到账</text>
<rect x="400" y="166" width="220" height="30" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="412" y="186" fill="var(--ink)">#4  重复扣款</text>
<rect x="400" y="208" width="220" height="30" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="412" y="228" fill="var(--ink)">#5  审批与到账</text>
<line x1="240" y1="139" x2="400" y2="181" stroke="var(--mem)" stroke-width="1.5"/>
<line x1="240" y1="181" x2="400" y2="223" stroke="var(--mem)" stroke-width="1.5"/>
<line x1="240" y1="55" x2="400" y2="55" stroke="var(--ink-faint)"/>
<line x1="240" y1="97" x2="400" y2="97" stroke="var(--ink-faint)"/>
<text x="20" y="266" fill="var(--ink-soft)" font-size="11">按编号比:#3、#4 的指纹都对不上,#5 库里没有,三块全算。</text>
<text x="20" y="286" fill="var(--ink-soft)">蓝色连线:这两块的正文其实没变,只是编号挪了位置,向量还能用。</text>
</g>
</svg>
<figcaption>插入一节以后,「重复扣款」从 #3 挪到 #4,「审批与到账」从 #4 挪到 #5。按编号比,这两块和库里同编号的内容对不上,被当成"改过"。蓝色连线是正文没变的块,琥珀色是真正新增的一块。</figcaption>
</figure>

按编号对账,库里 `kb-002#3` 存的是「重复扣款」,现在 `kb-002#3` 是「退到哪里」,指纹对不上,算作改过;`#4` 同理;`#5` 库里没有,算新增。可是「重复扣款」和「审批与到账」两段的正文一个字没变,它们的 embedding 就躺在库里,只是在别的编号下面。

修法是:**算 embedding 之前,先问一句"这段正文,库里别的行是不是已经算过了"**。指纹正好用来回答这个问题:拿要写的块的指纹,去库里按 `content_hash` 查,查到了就把那一行的向量借过来,查不到才真的调接口。

## 第七步:借用已有的向量,元数据一起比

借用向量之后,顺手补上另一个漏洞。现在的 `todo` 只比指纹,而指纹只管正文。如果运营改了一篇文章的**分类**,正文一个字没变,指纹不变,这个同步程序会认为"没变",库里的 `category` 就是旧的,按分类过滤时过滤错了。分类、文章编号、标题、小节这四个元数据也要一起比。

把 `sync_chunks` 整个换成下面这个版本,再加一个小函数 `row_key`:

```python
# agent-zero-lab/part04/pg_store.py(换掉上一版的 sync_chunks,row_key 放在它前面)
def row_key(c: Chunk) -> tuple[str, str, str, str, str]:
    """决定一行要不要重写的五项:正文指纹,加上四个元数据。"""
    return (sha(c.text), c.doc_id, c.title, c.category, c.section)


def sync_chunks(
    conn: psycopg.Connection,
    chunks: list[Chunk],
    embed_fn: Callable[[list[str]], np.ndarray],
) -> dict[str, int]:
    """把切好的块同步进库:没变的不动,变了的写入,正文库里已有向量的直接借用,没有的才算 embedding。"""
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

- `def row_key(c: Chunk) -> tuple[str, str, str, str, str]:` 把"一行里哪几项变了就要重写"集中在一个函数里。返回值是五个字符串的元组,元组可以直接用 `==` 和 `!=` 比较。
- `return (sha(c.text), c.doc_id, c.title, c.category, c.section)` 代入 `kb-001#1`:`('5eb411589be2…', 'kb-001', '套餐与价格', '套餐与计费', '三种套餐')`。正文用指纹代表,其余四项原样放进去。
- `existing = {` 这次从库里多读四列,拼成字典 `{编号: (指纹, doc_id, title, category, section)}`。
- `r[0]: tuple(r[1:])` `r` 是一行(六列),`r[0]` 是编号,`r[1:]` 是后五项,`tuple()` 把切片变成元组,和 `row_key` 返回的元组形状一致,才能比。
- `for r in conn.execute("SELECT id, content_hash, doc_id, title, category, section FROM kb_chunks")` 注意这次没有 `.fetchall()`:游标本身可以直接遍历,一行一行取出来。
- `todo = [c for c in chunks if existing.get(c.id) != row_key(c)]` 和上一版唯一的区别:比的是五项元组,不只是指纹。
- `wanted = list({sha(c.text) for c in todo})` 要写的块的指纹去重成列表,一会儿拿去库里问"这些正文你这儿有向量吗"。花括号加推导式是集合推导式,自动去重。
- `known = dict(` 开始查"库里已有的"。
- `"SELECT content_hash, embedding FROM kb_chunks WHERE content_hash = ANY(%s)", (wanted,)` 按指纹查出对应的向量。`= ANY(%s)` 和删除时是同一种写法。只查 `todo` 里用得上的那几条,不把整张表的向量拉出来。
- `).fetchall()` 返回 `[(指纹, Vector 对象), …]`,`dict()` 变成 `{指纹: 向量}`。读出来的向量是 pgvector 的 `Vector` 对象(Day 229),直接传回去写别的行也行。库里两行如果正文一样(指纹一样),字典里后一行覆盖前一行,向量本来就一样,无所谓。
- `fresh = {sha(c.text): c.text for c in todo if sha(c.text) not in known}` 字典推导式:要真正去算 embedding 的那些正文,键是指纹。`not in known` 过滤掉库里已经有向量的。用字典有个附带好处:两块正文一模一样时指纹相同,字典里只留一条,只算一次(练习 4)。
- `if fresh:` 一块都不用算时,连接口都不调。
- `known.update(zip(fresh, embed_fn(list(fresh.values()))))` 从里往外读:`fresh.values()` 是要算的正文,`embed_fn` 算出向量,按行和 `fresh` 的键(指纹)用 `zip` 配对,`update` 并进 `known`。从此 `known` 里有 `todo` 所需的全部向量,一部分是借来的,一部分是新算的。
- `gone = set(existing) - {c.id for c in chunks}` 不变。
- `with conn.transaction():` 不变。
- `for c in todo:` 这次不用 `zip`,直接遍历 `todo`,向量从 `known` 里按指纹取。
- `known[sha(c.text)]` 代入插入小节的场景:`kb-002#4`(重复扣款)取到的是原来 `kb-002#3` 那行的向量,`kb-002#3`(退到哪里)取到的是刚算出来的。
- `return {"total": len(chunks), "written": len(todo), "embedded": len(fresh), "deleted": len(gone)}` 多了一个 `written`:写了几行。`written` 和 `embedded` 现在是两回事,前者是"改了几行",后者是"花了几次 embedding"。

</div>

`pg_sync.py` 一个字不用改,它只是 `print(result)`。先跑一次正常同步,确认没变坏,再跑一次插入小节的实验:

```bash
uv run python -m part04.pg_sync | head -1
uv run python -m part04.sync_drift
uv run python -m part04.pg_sync | head -2
```

```text
{'total': 42, 'written': 0, 'embedded': 0, 'deleted': 0}
{'total': 43, 'written': 3, 'embedded': 1, 'deleted': 0}
送去算 embedding 的块:
   退款政策 > 退到哪里
{'total': 42, 'written': 2, 'embedded': 0, 'deleted': 1}
embedding 0 次请求,0 token
```

三行读法。第一行:库没变,`written` 和 `embedded` 都是 0。第二行:插入一节后写了 3 行(#3、#4、#5 的内容都变了),但只算了 1 块 embedding,送去的正是「退到哪里」。第三行:恢复原样时,`#3`、`#4` 写回原来的内容,`#5` 被删掉,**一块 embedding 都没算**,因为两段正文的向量就在库里。

分类改动能不能被发现?练习 2 会实跑。到此同步程序完成了,把零件对照表放在这里,默写时对着它想:

| 零件 | 是什么 | 在 `sync_chunks` 里的位置 |
| --- | --- | --- |
| `sha(text)` | 正文的 64 字符指纹 | `row_key` 和每一次 upsert 都用它 |
| `row_key(c)` | 指纹加四个元数据的元组 | `todo` 的判断依据 |
| `existing` | 库里每个编号当前的五项 | 对账的"左边" |
| `todo` | 新增或改过的块 | 要 upsert 的块 |
| `known` / `fresh` | 库里已有的向量 / 要新算的正文 | 借用与计算的分界 |
| `UPSERT` | `INSERT ... ON CONFLICT DO UPDATE` | 写入 |
| `gone` | 库里多出来的编号 | 删除 |
| `with conn.transaction()` | 一批写入一起成败 | 包住写入和删除 |

## 动手练习

**练习 1:借来的向量是对的吗?** 第七步让 `kb-002#4` 直接用了原来 `kb-002#3` 那行的向量。写一个脚本验证:插入小节同步后,把库里每一行的正文重新算一遍 embedding,和库里存的向量比余弦,看有没有哪一行对不上。最后恢复原样。

<details><summary>参考答案</summary>

先跑一次 `uv run python -m part04.pg_sync`,确认库是 42 块的正常状态。然后新建 `part04/ex_verify_reuse.py`:

```python
# agent-zero-lab/part04/ex_verify_reuse.py
import shutil
from pathlib import Path

import numpy as np

from common.embed import embed
from part04.chunking import chunk_article, load_chunks
from part04.pg_store import connect, sync_chunks

TMP = Path("part04/tmp_kb")
shutil.rmtree(TMP, ignore_errors=True)
shutil.copytree("data/kb", TMP)
f = TMP / "kb-002.md"
new_section = "## 退到哪里\n退款一律原路退回,不支持退到其他账户。\n\n## 重复扣款"
f.write_text(f.read_text(encoding="utf-8").replace("## 重复扣款", new_section), encoding="utf-8")
drifted = [c for p in sorted(TMP.glob("kb-*.md")) for c in chunk_article(p)]
shutil.rmtree(TMP)

with connect() as conn:
    print("插入小节后同步:", sync_chunks(conn, drifted, embed))
    rows = conn.execute("SELECT id, content, embedding FROM kb_chunks ORDER BY id").fetchall()
    stored = np.stack([r[2].to_numpy() for r in rows])
    fresh = embed([r[1] for r in rows])
    cos = (stored * fresh).sum(axis=1)
    worst = int(cos.argmin())
    print(f"{len(rows)} 行,库里的向量和现算的向量:最小余弦 {cos.min():.6f}(第 {rows[worst][0]} 行)")
    print("借用来的几行:", [(rows[i][0], round(float(cos[i]), 6)) for i in range(len(rows)) if rows[i][0] in ("kb-002#3", "kb-002#4", "kb-002#5")])
    print("改回去:", sync_chunks(conn, load_chunks(), embed))
```

<div class="line-notes">

- `drifted = [c for p in sorted(TMP.glob("kb-*.md")) for c in chunk_article(p)]` 前面几行和 `sync_drift.py` 一样:临时目录里插一节,切出 43 块。
- `shutil.rmtree(TMP)` 块已经切好,临时目录立刻删掉。
- `print("插入小节后同步:", sync_chunks(conn, drifted, embed))` 这次传真正的 `embed`,不再包计数函数。
- `rows = conn.execute("SELECT id, content, embedding FROM kb_chunks ORDER BY id").fetchall()` 读出 43 行的编号、正文、向量。`ORDER BY id` 让顺序固定。
- `stored = np.stack([r[2].to_numpy() for r in rows])` 每行向量是 `Vector` 对象,`.to_numpy()` 转数组(Day 229),`np.stack` 把 43 个 `(1024,)` 叠成 `(43, 1024)`。
- `fresh = embed([r[1] for r in rows])` 把库里存的 43 段正文**全部**重新算一遍 embedding。这是验证用的,日常同步不会这么干。
- `cos = (stored * fresh).sum(axis=1)` 两个矩阵逐元素相乘再按行求和,就是每一行的内积。`embed()` 出来的向量长度都是 1(Day 217),内积就是余弦。结果形状 `(43,)`。
- `worst = int(cos.argmin())` 余弦最小的那一行的下标。
- `print(f"{len(rows)} 行,库里的向量和现算的向量:最小余弦 {cos.min():.6f}(第 {rows[worst][0]} 行)")` 实测 43 行,最小余弦 0.999939,在 `kb-012#2`。
- `print("借用来的几行:", [(rows[i][0], round(float(cos[i]), 6)) for i in range(len(rows)) if rows[i][0] in ("kb-002#3", "kb-002#4", "kb-002#5")])` 把 kb-002 后三块单独拎出来看。
- `print("改回去:", sync_chunks(conn, load_chunks(), embed))` 恢复成 42 块。

</div>

```bash
uv run python -m part04.ex_verify_reuse
```

```text
插入小节后同步: {'total': 43, 'written': 3, 'embedded': 1, 'deleted': 0}
43 行,库里的向量和现算的向量:最小余弦 0.999939(第 kb-012#2 行)
借用来的几行: [('kb-002#3', 0.999944), ('kb-002#4', 1.0), ('kb-002#5', 1.0)]
改回去: {'total': 42, 'written': 2, 'embedded': 0, 'deleted': 1}
```

43 行全部在 0.9999 以上,借来的 `kb-002#4`、`kb-002#5` 是 1.0,新算的 `kb-002#3` 是 0.999944。注意最小的 0.999939 并不是借来的那几行,而是 `kb-012#2`,一段从来没动过的正文。原因是同一段文字两次请求算出的向量不是逐位相同:批次里搭配的别的文字不同、浮点运算顺序不同,会有万分之几的差别。所以以后判断"两个向量是不是同一份",不要用 `==`,要用余弦 ≥ 0.999 这种阈值。

</details>

**练习 2:只改分类。** 在内存里把 `chunks[0]`(kb-001#1)的 `category` 改成 `"价格"`,正文不动。先看"只比指纹"会选出几块,再用 `sync_chunks` 真同步一次,读出 kb-001 两块的分类,最后改回来。

<details><summary>参考答案</summary>

新建 `part04/ex_category.py`:

```python
# agent-zero-lab/part04/ex_category.py
from common.embed import embed, usage
from part04.chunking import load_chunks
from part04.pg_store import connect, sha, sync_chunks

chunks = load_chunks()
chunks[0].category = "价格"  # 假装运营把 kb-001 的分类从「套餐与计费」改成了「价格」

with connect() as conn:
    existing = dict(conn.execute("SELECT id, content_hash FROM kb_chunks").fetchall())
    only_hash = [c.id for c in chunks if existing.get(c.id) != sha(c.text)]
    print("只比指纹,会发现要写入的块:", only_hash)

    print("同步:", sync_chunks(conn, chunks, embed), " embedding 请求", usage["requests"], "次")
    print(conn.execute("SELECT id, category FROM kb_chunks WHERE doc_id = 'kb-001' ORDER BY id").fetchall())

    chunks[0].category = "套餐与计费"
    print("改回来:", sync_chunks(conn, chunks, embed))
```

<div class="line-notes">

- `chunks[0].category = "价格"` `Chunk` 是普通 dataclass,字段可以直接改。只改内存里的这一个对象,没碰 `data/kb/` 里的文件。
- `existing = dict(conn.execute("SELECT id, content_hash FROM kb_chunks").fetchall())` 第一版的读法,只读指纹。
- `only_hash = [c.id for c in chunks if existing.get(c.id) != sha(c.text)]` 第一版的判断。正文没变,指纹和库里一样,实测是空列表。
- `print("同步:", sync_chunks(conn, chunks, embed), " embedding 请求", usage["requests"], "次")` 第二版比五项元组,发现 `category` 变了,写入 1 行,不调接口。
- `print(conn.execute("SELECT id, category FROM kb_chunks WHERE doc_id = 'kb-001' ORDER BY id").fetchall())` 读出 kb-001 两块的分类。
- `chunks[0].category = "套餐与计费"` 改回来,再同步一次,又写 1 行。

</div>

```bash
uv run python -m part04.ex_category
```

```text
只比指纹,会发现要写入的块: []
同步: {'total': 42, 'written': 1, 'embedded': 0, 'deleted': 0}  embedding 请求 0 次
[('kb-001#1', '价格'), ('kb-001#2', '套餐与计费')]
改回来: {'total': 42, 'written': 1, 'embedded': 0, 'deleted': 0}
```

只比指纹是空的,那分类就永远不会更新,`WHERE category = '价格'` 查不到这块。五项元组版本写了 1 行、算了 0 块 embedding:改元数据只是一次 `UPDATE`,不花接口的钱。

</details>

**练习 3:换了 embedding 模型,同步会发现吗?** 用环境变量临时把 `EMB_MODEL` 换成同样是 1024 维的 `BAAI/bge-large-zh-v1.5`(Day 217 用过),跑一次 `pg_sync`。说说结果有什么问题,再改 `sha()` 修好它。

<details><summary>参考答案</summary>

```bash
EMB_MODEL=BAAI/bge-large-zh-v1.5 uv run python -m part04.pg_sync | head -1
```

```text
{'total': 42, 'written': 0, 'embedded': 0, 'deleted': 0}
```

什么都没发生,而且是安静地没发生。指纹只看正文,正文没变,同步程序认为一切正常。但如果后续的查询程序用的是新模型,查询向量来自新模型、库里的向量来自旧模型,[Day 217](/blog/agent-zero/day-217-embed-service/) 演示过这时候余弦只有 0.0251,接近随机。Day 225 的 `load_index()` 会拦住这件事,因为 `chunks.json` 里记了建索引的模型名;而 `kb_chunks` 表里没有"这行向量是哪个模型算的"这一列。

修法是把模型名也算进指纹:换了模型,所有指纹一起失效,下一次同步自然整库重算。改 `pg_store.py` 两处,一处是 import 区,在 `from part04.chunking import Chunk` 前面加一行,另一处是 `sha()`:

```python
# agent-zero-lab/part04/pg_store.py(改两处)
from common.embed import EMB_MODEL
from part04.chunking import Chunk


def sha(text: str) -> str:
    """指纹 = 模型名 + 正文。换了 embedding 模型,所有块的指纹都跟着变,会整库重算。"""
    return hashlib.sha256(f"{EMB_MODEL}\n{text}".encode("utf-8")).hexdigest()
```

<div class="line-notes">

- `from common.embed import EMB_MODEL` Day 217 的 `common/embed.py` 里从 `EMB_MODEL` 环境变量读出的模型名,实测是 `BAAI/bge-m3`。
- `return hashlib.sha256(f"{EMB_MODEL}\n{text}".encode("utf-8")).hexdigest()` 把模型名、换行、正文拼成一段再算指纹。换行是分隔符,避免模型名和正文首字拼在一起产生歧义。代入 kb-001#1 之后,指纹前 8 位就不再是 `5eb41158` 了。

</div>

四次同步,模型依次是 bge-m3、bge-large-zh、bge-large-zh、bge-m3:

```bash
for m in BAAI/bge-m3 BAAI/bge-large-zh-v1.5 BAAI/bge-large-zh-v1.5 BAAI/bge-m3; do
  echo "== $m"; EMB_MODEL=$m uv run python -m part04.pg_sync | head -1
done
```

```text
== BAAI/bge-m3
{'total': 42, 'written': 42, 'embedded': 42, 'deleted': 0}
== BAAI/bge-large-zh-v1.5
{'total': 42, 'written': 42, 'embedded': 42, 'deleted': 0}
== BAAI/bge-large-zh-v1.5
{'total': 42, 'written': 0, 'embedded': 0, 'deleted': 0}
== BAAI/bge-m3
{'total': 42, 'written': 42, 'embedded': 42, 'deleted': 0}
```

第一次是指纹算法本身变了,所有旧指纹作废,整库重算一次(以后各自稳定);第二次换模型,全量重算;第三次模型没换,0;第四次换回来,又是全量。表里每行只存一份向量,所以来回切模型每次都要重算,这是正常的。这个改动我留在 `pg_store.py` 里,后面几天的代码不依赖它,你不做这道题也不影响。

</details>

**练习 4:两块正文一模一样。** 造两篇正文相同的新文章(编号 kb-021、kb-022,同标题同小节),和原来的 42 块一起同步,看 `written` 和 `embedded` 各是几;再把它们去掉同步回来。

<details><summary>参考答案</summary>

新建 `part04/ex_dup_text.py`:

```python
# agent-zero-lab/part04/ex_dup_text.py
import shutil
from pathlib import Path

import numpy as np

from common.embed import embed
from part04.chunking import chunk_article, load_chunks
from part04.pg_store import connect, sync_chunks

TMP = Path("part04/tmp_kb")
shutil.rmtree(TMP, ignore_errors=True)
TMP.mkdir()
body = "## 新功能\n批量导入流水现在支持 CSV 和 XLSX 两种格式。\n"
for n in (21, 22):
    (TMP / f"kb-0{n}.md").write_text(
        f"---\nid: kb-0{n}\ntitle: 导入格式\ncategory: 数据导入导出\n---\n{body}", encoding="utf-8"
    )
extra = [c for p in sorted(TMP.glob("kb-*.md")) for c in chunk_article(p)]
shutil.rmtree(TMP)

sent: list[str] = []


def counting_embed(texts: list[str]) -> np.ndarray:
    sent.extend(texts)
    return embed(texts)


with connect() as conn:
    print("加两篇正文一样的:", sync_chunks(conn, load_chunks() + extra, counting_embed))
    print("送去算 embedding 的:", [t.split("\n")[0] for t in sent])
    print("删掉:", sync_chunks(conn, load_chunks(), counting_embed))
```

<div class="line-notes">

- `body = "## 新功能\n批量导入流水现在支持 CSV 和 XLSX 两种格式。\n"` 两篇文章共用的正文。
- `for n in (21, 22):` 生成 kb-021 和 kb-022 两个文件。
- `f"---\nid: kb-0{n}\ntitle: 导入格式\ncategory: 数据导入导出\n---\n{body}"` Day 222 约定的 frontmatter 加正文,`id` 不同,标题和小节相同,所以切出的块 `text`(带「标题 > 小节」前缀)完全一样。
- `extra = [c for p in sorted(TMP.glob("kb-*.md")) for c in chunk_article(p)]` 两篇各切出 1 块,共 2 块。
- `print("加两篇正文一样的:", sync_chunks(conn, load_chunks() + extra, counting_embed))` 原来 42 块加这 2 块,共 44。
- `print("送去算 embedding 的:", [t.split("\n")[0] for t in sent])` 看实际送出去的文字。
- `print("删掉:", sync_chunks(conn, load_chunks(), counting_embed))` 只传原来的 42 块,多出的两行被删。

</div>

```bash
uv run python -m part04.ex_dup_text
```

```text
加两篇正文一样的: {'total': 44, 'written': 2, 'embedded': 1, 'deleted': 0}
送去算 embedding 的: ['导入格式 > 新功能']
删掉: {'total': 42, 'written': 0, 'embedded': 0, 'deleted': 2}
```

写了 2 行,只算了 1 次 embedding:`fresh` 是以指纹为键的字典,两块正文指纹相同,只留一条。这就是"去重"。

</details>

验收标准:`uv run python -m part04.pg_sync` 连跑两次,第二次 `embedded` 是 0;改一个字只算 1 块;删一篇文章 `deleted` 等于它的块数;`sync_drift.py` 实验里 `embedded` 是 1;`ex_category.py` 里分类能更新而且不调接口;`uvx basedpyright part04/pg_store.py part04/pg_sync.py` 0 个 error;能不看文章说出"指纹的三个性质""为什么算 embedding 要放在事务外面""`EXCLUDED` 是什么"。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 增量更新 | 只处理变化的部分,没变的不动。知识库里指只给新增和改过的块重新算 embedding |
| 全量重建 | 不管变没变,所有块重新算一遍。Day 225 的 `build_index.py` 就是这样 |
| 指纹(哈希,hash) | 用固定算法把任意长度的内容压成固定长度的字符。内容一样指纹一样,改一点指纹全变 |
| sha256 | 一种哈希算法,结果 256 位,写成 64 个十六进制字符 |
| `hexdigest()` | `hashlib` 对象的方法,把哈希结果转成十六进制字符串 |
| 碰撞 | 两段不同内容算出相同指纹。sha256 实际上不会碰到 |
| upsert | update 加 insert:行不存在就插入,存在就更新。Postgres 写成 `INSERT ... ON CONFLICT ... DO UPDATE` |
| `ON CONFLICT (列)` | 指定按哪一列判断冲突,该列必须有唯一约束或主键 |
| `EXCLUDED` | upsert 里指"这次想插入但因冲突没插进去的那一行",用来取新值 |
| 事务(transaction) | 一批操作要么全部成功要么全部撤销([Day 91](/blog/agent-zero/day-091-sql-6/)) |
| `conn.transaction()` | psycopg 里开一个事务块,正常结束提交,抛异常回滚 |
| `= ANY(数组)` | 等于数组里任意一个值,一条 SQL 查或删多行 |
| 块编号漂移 | 用序号做编号时,在中间插入一节,后面所有块的编号都变了([Day 224](/blog/agent-zero/day-224-chunking/)) |
| 借用向量 | 要写的正文在库里别的行已经算过 embedding,直接拿来用,不再调接口 |

## 常见误区

**只比正文指纹,漏掉元数据。** 运营改了分类、正文没动,同步报告一切正常,库里的分类却是旧的。把 `doc_id`、`title`、`category`、`section` 和指纹一起比(练习 2)。

**按块编号判断变没变。** 序号编号在文章中间插一节后整体后移,本来没变的块被当成"改过"重算(第六步多算了 2 块)。靠指纹找已有的向量借用。

**换了 embedding 模型,同步却说 `embedded: 0`。** 指纹只看正文,模型变了它不知道,库里就是新旧模型的向量混在一起,没有任何报错(练习 3)。把模型名算进指纹。

**`ON CONFLICT` 写在没有唯一约束的列上。** 报 `there is no unique or exclusion constraint matching the ON CONFLICT specification`。冲突列要么是主键,要么建过唯一索引。

**upsert 更新时只改了正文,忘了改向量。** `DO UPDATE SET` 里要把 `content`、`content_hash`、`embedding` 一起列上,漏了 `embedding` 就是新正文配旧向量,检索结果和读到的内容对不上。`updated_at` 也要手动写 `now()`。

**把调接口放进事务里。** 调 embedding 接口可能要几十秒,事务一直开着占着数据库的资源。先算完向量,再开事务只做写入。

**拿 `==` 判断两个向量是不是同一份。** 同一段文字两次请求,余弦大约 0.9999 而不是 1(练习 1)。用阈值。

**两个同步程序同时跑。** 这一条我没有实测:`gone` 是各自读到的旧快照算出来的,理论上一个程序可能把另一个刚写的块当成多余的删掉。真要多进程同步,先用锁让同一时间只有一个在跑。今天的程序按单个进程用。

## 学习资料

### 文档与文章

- [PostgreSQL 文档 · INSERT](https://www.postgresql.org/docs/17/sql-insert.html):页面往下找 `ON CONFLICT Clause`,今天的 upsert 和 `EXCLUDED` 都在这一节,读 20 分钟。
- [psycopg 3 · 事务管理](https://www.psycopg.org/psycopg3/docs/basic/transactions.html):`conn.transaction()`、自动提交和嵌套事务的说明,看前半部分。
- [Python 文档 · hashlib](https://docs.python.org/3/library/hashlib.html):读开头的 `sha256` 例子和 `hexdigest()` 的说明。
- [pgvector 官方 README](https://github.com/pgvector/pgvector):搜 `Upsert vectors`,官方就是用 `ON CONFLICT (id) DO UPDATE SET embedding = EXCLUDED.embedding` 这句。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV188au6xEAo&autoplay=0&high_quality=1" title="SHA-256 哈希函数:改动一个比特,摘要会发生什么" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>青城玖柒 · SHA-256 哈希函数:改动一个比特,摘要会发生什么 · 5 分钟,对应今天第一步里「改一个字指纹全变」。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1PSivBYEiX&autoplay=0&high_quality=1" title="不知道RAG知识库文档怎么更新?5分钟带你吃透大厂都在用的RAG知识库文档更新方案" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>java架构师徐庶 · RAG 知识库文档怎么更新 · 5 分钟,讲的就是今天这套"按内容判断、只更新变化的块"的思路,看完对照 `sync_chunks`。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/b4b8ktEV4Bg" title="Hashing Algorithms and Security - Computerphile" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Computerphile · Hashing Algorithms and Security · 英文,约 10 分钟,哈希是什么、为什么改一点点输出就面目全非。</figcaption>
</figure>

### 书籍

- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly,2017)第 7 章讲事务,把回滚、隔离级别讲得很透,读完能理解为什么"一批写入一起成败"值钱。

### 开源项目与代码

- [pgvector/pgvector-python](https://github.com/pgvector/pgvector-python):今天用的 `register_vector` 就在这里,看它怎么把 `Vector` 对象和 psycopg 接起来。

## 自测

**1. 内容指纹有哪三个性质?为什么拿它判断"这块变没变"比逐字比较正文更方便?**

<details><summary>答案</summary>

内容一样指纹一定一样;改一个字指纹完全不同;长度固定(sha256 是 64 个字符)。比较两个 64 字符的字符串比比较一大段正文快,从库里读指纹也比读全部正文省传输;指纹还可以把模型名这类别的信息一起算进去(练习 3)。

</details>

**2. `INSERT ... ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content` 里,`EXCLUDED.content` 是什么?如果 `id` 列没有唯一约束会怎样?**

<details><summary>答案</summary>

`EXCLUDED` 是这次想插入、但因冲突没插进去的那一行,`EXCLUDED.content` 是它的新正文。`id` 没有唯一约束时报 `there is no unique or exclusion constraint matching the ON CONFLICT specification`。

</details>

**3. 为什么 `embed_fn(...)` 要放在 `with conn.transaction():` 外面?**

<details><summary>答案</summary>

调接口耗时不确定,可能几十秒。事务开着就占着数据库的连接和锁,别的操作要等。先把向量都算好,再开事务,事务里只剩快速的写入。

</details>

**4. 一篇文章中间插入一个新小节,按块编号对账会出什么问题?`sync_chunks` 是怎么避免多算的?**

<details><summary>答案</summary>

序号编号后移,后面的块在库里同编号下存的是别的内容,指纹对不上,被当成改过的重算(实测算了 3 块,其实只有 1 块是新内容)。`sync_chunks` 在算 embedding 之前,按指纹去库里查别的行有没有同样正文的向量,有就借用,只给查不到的正文算 embedding,实测降到 1 块。

</details>

**5. 面试题:知识库每天有几十篇文章被运营修改,你怎么设计向量库的更新?要考虑哪些情况?**

<details><summary>答案</summary>

给每个块存内容指纹,每次同步切块后和库里的指纹比,只给新增和改过的块算 embedding,用 upsert 写入;库里多出来的(文章被删)要删除,否则旧内容还会被召回;整批写入放进事务,避免查询读到半新半旧的状态;块编号要考虑稳定性,否则插入小节会触发大面积重算,可以用指纹复用已有向量;元数据(分类、权限)变化也要同步,即使正文没变;embedding 模型版本要进指纹或单独记录,换模型时整库重建;并发同步要加锁。

</details>

## 明天预告

明天是 [Day 232 · pgvector(三):把 RAG 接到数据库上](/blog/agent-zero/day-232-pgvector-3/)。今天库里有了 42 块带向量的数据,可以查了。明天在 `pg_store.py` 里加 `search()`:用 `<=>` 运算符写一条按余弦距离排序的 SQL,让检索从 numpy 矩阵乘法换成数据库查询,再接回 Day 226 的 `rag_numpy.py`,看数据库查出来的 top-4 和 numpy 的是不是一模一样。
