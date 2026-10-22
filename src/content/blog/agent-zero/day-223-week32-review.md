---
title: 'Day 223 · 第 32 周复习:RAG 与上下文(Day 217–222)'
description: '这一周从 DeepSeek 没有 embedding 接口开始,配好 bge-m3、写出 common/embed.py,读相似度矩阵、找反例、算成本,拆出 RAG 的两条流水线,最后造好 20 篇帮助中心。今天默写 embed() 和查询线的检索四行,再做一个小项目:不切块,把 20 篇整篇编码去检索,看「重复扣款」这个问题为什么排错,给明天的切块攒证据。'
pubDate: 2026-10-22
regime: none
tags: ['review', 'rag', 'embedding', 'bge-m3', 'agent-zero']
series: 'agent-zero'
day: 223
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 222](/blog/agent-zero/day-222-kb-data/) 用 `part04/make_kb.py` 造出了 CloudLedger 帮助中心的 20 篇 Markdown 文章,放在 `data/kb/`。每篇是「frontmatter(`id`、`title`、`category`)+ 一级标题 + 若干 `##` 小节」三层,20 篇一共 42 个小节。那天还写了 `part04/kb_check.py` 检查格式,踩了三个坑:全角冒号、在子目录里运行把文件写到了别处、import 一个没有 main guard 的脚本。

这一周的六课,前四课在练「找」的那把尺子(embedding 和余弦),后两课在搭「找」的架子(两条流水线和正式数据)。明天就要开始切块了,今天停下来把这把尺子和这个架子对一遍,然后用尺子去量一次架子上的 20 篇,看看不切块会怎样。

## 今天要解决的问题

学完今天,你应该能做到:

1. 合上文章默写出 `common/embed.py` 里的 `embed()`:分批、按 `index` 排序、记 token、归一化,并用一个检查脚本证明它的形状、长度和空文本处理都对。
2. 默写出 Day 221 查询线的检索四行(编码问题、矩阵乘、排序、取 top-k),说出每一行的输入输出形状。
3. 跑通小项目 `part04/w32_whole.py`:20 篇文章**整篇**编码,6 个问题检索,读懂为什么「重复扣款多久能退回来」会把 kb-004 排在 kb-002 前面。
4. 不看笔记说出本周至少六个坑,每个说出症状(报错还是不报错)和修法。

预计用时 3 小时:知识地图和一句话回顾 20 分钟,两段默写 50 分钟,小项目 50 分钟,剩下做练习和自测。前置:[Day 217](/blog/agent-zero/day-217-embed-service/) 到 [Day 222](/blog/agent-zero/day-222-kb-data/) 全部,特别是 Day 217 的 `common/embed.py` 和 Day 222 的 `data/kb/`、`part04/kb_check.py`(带 main guard 的版本)。

今天的 embedding 全部走硅基流动的 `BAAI/bge-m3`,免费,不调大模型,API 花费 0 元。正文加练习一共发了二十来次 embedding 请求,合计约 6000 个 token,就算按付费的 Qwen3-Embedding-8B 每百万 0.28 元算,也只有 6000 ÷ 1,000,000 × 0.28 ≈ 0.0017 元。

学法和平时一样:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章把 `embed()` 和 `w32_whole.py` 再写一遍;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="第 32 周知识地图:上排是 embedding 这把尺子的四课,下排是 RAG 架子的两课,中间是今天的小项目">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink)">尺子:embedding 怎么量、哪里不准、多少钱</text>
<rect x="20" y="36" width="140" height="58" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="57" fill="var(--ink)">Day 217</text>
<text x="30" y="76" fill="var(--ink-soft)" font-size="11">embed.py,bge-m3</text>
<rect x="175" y="36" width="140" height="58" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="185" y="57" fill="var(--ink)">Day 218</text>
<text x="185" y="76" fill="var(--ink-soft)" font-size="11">矩阵:看排序</text>
<rect x="330" y="36" width="140" height="58" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="340" y="57" fill="var(--ink)">Day 219</text>
<text x="340" y="76" fill="var(--ink-soft)" font-size="11">否定句、错误码</text>
<rect x="485" y="36" width="140" height="58" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="495" y="57" fill="var(--ink)">Day 220</text>
<text x="495" y="76" fill="var(--ink-soft)" font-size="11">4 KB/向量,榜单</text>
<line x1="160" y1="65" x2="175" y2="65" stroke="var(--ink-faint)" marker-end="url(#m223)"/>
<line x1="315" y1="65" x2="330" y2="65" stroke="var(--ink-faint)" marker-end="url(#m223)"/>
<line x1="470" y1="65" x2="485" y2="65" stroke="var(--ink-faint)" marker-end="url(#m223)"/>
<text x="20" y="130" fill="var(--ink)">架子:RAG 的两条线和正式数据</text>
<rect x="20" y="142" width="295" height="58" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="30" y="163" fill="var(--ink)">Day 221 两条流水线</text>
<text x="30" y="182" fill="var(--ink-soft)" font-size="11">索引线离线跑,查询线每问都跑</text>
<rect x="330" y="142" width="295" height="58" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="340" y="163" fill="var(--ink)">Day 222 data/kb/</text>
<text x="340" y="182" fill="var(--ink-soft)" font-size="11">20 篇,frontmatter + 42 个小节</text>
<line x1="315" y1="171" x2="330" y2="171" stroke="var(--ink-faint)" marker-end="url(#m223)"/>
<rect x="120" y="236" width="400" height="58" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="132" y="257" fill="var(--ink)">今天 w32_whole.py:整篇编码 → 6 问检索</text>
<text x="132" y="276" fill="var(--ink-soft)" font-size="11">5/6 命中,错的那题指向明天的切块</text>
<line x1="90" y1="94" x2="200" y2="236" stroke="var(--ink-faint)" marker-end="url(#m223)"/>
<line x1="477" y1="200" x2="420" y2="236" stroke="var(--ink-faint)" marker-end="url(#m223)"/>
<text x="20" y="318" fill="var(--ink-soft)" font-size="11">Day 224:按 ## 切成 42 块,同一道题再量一次</text>
<defs><marker id="m223" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--ink-faint)"/></marker></defs>
</g>
</svg>
<figcaption>上排四课是同一把尺子的使用说明:怎么调、怎么读数、哪里会量错、量一次多少钱。下排两课搭了 RAG 的架子:Day 221 定了两条流水线的分工,Day 222 给索引线准备了原料。今天的小项目用上排的尺子量下排的原料。</figcaption>
</figure>

## 本周每天一句话

- [Day 217 · 选 embedding 服务,写 embed 函数](/blog/agent-zero/day-217-embed-service/):DeepSeek 没有 embedding 接口(调了是 404),另配一组 `EMB_*` 用硅基流动免费的 bge-m3;一次发一批比一条一条快十倍以上;建索引和查询必须用同一个模型,混用不报错,分数却接近随机。
- [Day 218 · 实验:一张相似度矩阵](/blog/agent-zero/day-218-sim-matrix/):`vecs @ vecs.T` 一行得到 N×N 矩阵,对角线是 1、左右对称、每一行就是「拿这一句去搜其他句」;真实分数挤在 0.3 以上的窄区间里,所以看排序,别看阈值。
- [Day 219 · embedding 的两个短板:否定句和错误码](/blog/agent-zero/day-219-embed-limits/):「支持」和「不支持」余弦 0.906;问 E1042 时措辞更像的 E1043 文章能以 0.799 对 0.651 反超;用一行正则做精确匹配能补上编号这块短板。
- [Day 220 · 维度、存储、花多少钱,怎么挑模型](/blog/agent-zero/day-220-embed-cost/):1024 维 float32 一个向量 4096 字节;1 万篇文章建一次索引最贵也就 12 元,真正花钱的是把资料塞给大模型;榜单第一在自己的 6 道题上不一定第一。
- [Day 221 · RAG 为什么存在:两条流水线](/blog/agent-zero/day-221-why-rag/):模型不知道私有资料,资料多了又塞不下;索引线(读、编码、存)文档变了才跑,查询线(编码问题、top-k、拼 prompt、回答)每问都跑;资料改了不重建索引,系统照样答旧内容还带出处。
- [Day 222 · 造一份数据:CloudLedger 帮助中心](/blog/agent-zero/day-222-kb-data/):20 篇 Markdown,frontmatter 的 `id` 管引用、`category` 管过滤、`title` 后面拼到块前面;`##` 小节一节只讲一件事;入索引前先跑格式检查。

哪一句想不起对应的代码,先回那一天扫一眼再往下做。

## 默写一:common/embed.py 的 embed()

这是整个第四部分用得最多的一个函数,值得能闭着眼写出来。先合上 Day 217,在一张纸上写出 `embed(texts)` 的函数体,要求:空列表直接返回形状正确的空数组;按 `EMB_BATCH` 分批;每批先清洗(空文本报错);按响应里的 `index` 排序;累计 `usage`;最后按行归一化。

写完对照下面的标准答案(就是 Day 217 那一版,一字未改):

```python
# agent-zero-lab/common/embed.py(只看 embed 这一段)
def embed(texts: list[str]) -> np.ndarray:
    """把 N 条文本变成 (N, EMB_DIM) 的数组,每行都归一化成长度 1。"""
    if not texts:
        return np.zeros((0, EMB_DIM), dtype=np.float32)
    vectors: list[list[float]] = []
    for start in range(0, len(texts), EMB_BATCH):
        batch = [_clean(t) for t in texts[start : start + EMB_BATCH]]
        resp = _client.embeddings.create(model=EMB_MODEL, input=batch)
        usage["requests"] += 1
        if resp.usage:
            usage["tokens"] += resp.usage.total_tokens
        vectors.extend(d.embedding for d in sorted(resp.data, key=lambda d: d.index))
    arr = np.asarray(vectors, dtype=np.float32)
    return arr / np.linalg.norm(arr, axis=1, keepdims=True)
```

<div class="line-notes">

- `if not texts:` 空列表直接返回 `(0, 1024)` 的空数组,不发请求。形状对,调用方后面做 `vecs @ q` 也不会出错。
- `for start in range(0, len(texts), EMB_BATCH):` `range(0, 12, 10)` 产出 0、10,也就是两批。相当于 JS 里 `for (let start = 0; start < n; start += 10)`。
- `batch = [_clean(t) for t in texts[start : start + EMB_BATCH]]` 第一批取第 0 到 9 条,第二批取 10、11。`_clean` 把多余空白合并,清洗后是空字符串就抛 `ValueError`(Day 217 实测过服务端对空文本不报错,还返回一个和谁都有点像的向量)。
- `resp = _client.embeddings.create(model=EMB_MODEL, input=batch)` 一次请求,`input` 是一个字符串列表。
- `usage["requests"] += 1` 模块级的计数器,今天的小项目会打印它。
- `vectors.extend(d.embedding for d in sorted(resp.data, key=lambda d: d.index))` 按 `index` 排好再追加。协议没保证返回顺序和输入顺序一致,不排的话第 3 条的向量可能被当成第 5 条的。
- `arr = np.asarray(vectors, dtype=np.float32)` 转成 numpy 数组,指定 float32(Day 220:用 float64 存储会翻倍,精度对检索没用)。
- `return arr / np.linalg.norm(arr, axis=1, keepdims=True)` 每一行除以自己的长度。`axis=1` 是按行算,`keepdims=True` 让结果是 `(N, 1)` 而不是 `(N,)`,才能和 `(N, 1024)` 广播相除(Day 214、215)。

</div>

光对照还不够,写一个检查脚本让它自己证明。新建 `part04/w32_embed_check.py`:

```python
# agent-zero-lab/part04/w32_embed_check.py
import numpy as np

from common.embed import EMB_BATCH, embed, usage

texts = [f"第 {i} 条:年付套餐怎么退款" for i in range(12)]
vecs = embed(texts)
print("形状", vecs.shape, "类型", vecs.dtype, "批大小", EMB_BATCH, "请求", usage["requests"], "次")
print("每行长度都是 1:", bool(np.allclose(np.linalg.norm(vecs, axis=1), 1.0)))
print("第 0 条和第 11 条余弦", round(float(vecs[0] @ vecs[11]), 3))
print("空列表:", embed([]).shape)
try:
    embed(["退款", "   "])
except ValueError as e:
    print("空文本:", e)
```

<div class="line-notes">

- `texts = [f"第 {i} 条:年付套餐怎么退款" for i in range(12)]` 故意造 12 条,比 `EMB_BATCH=10` 多两条,逼它分两批。
- `vecs = embed(texts)` 一次调用,内部发两次请求。
- `print("形状", vecs.shape` 实测 `(12, 1024)`、`float32`、批大小 10、请求 2 次。
- `np.allclose(np.linalg.norm(vecs, axis=1), 1.0)` 每一行的长度都约等于 1。`allclose` 允许极小的浮点误差,不能用 `==`(Day 217 的坑)。外面套 `bool()` 是把 numpy 的布尔值转成普通的 `True`,打印出来干净。
- `round(float(vecs[0] @ vecs[11]), 3)` 第 0 条和第 11 条只差一个数字,余弦 0.954。如果分批后顺序乱了,这个值不会变,所以它不能证明顺序;顺序靠代码里的 `sorted(... d.index)` 保证。
- `embed([]).shape` 空列表,不发请求,得到 `(0, 1024)`。
- `embed(["退款", "   "])` 第二条全是空格,清洗后为空,应该报错。

</div>

```bash
cd /Users/你/agent-zero-lab
uv run python -m part04.w32_embed_check
```

真实输出:

```text
形状 (12, 1024) 类型 float32 批大小 10 请求 2 次
每行长度都是 1: True
第 0 条和第 11 条余弦 0.954
空列表: (0, 1024)
空文本: 空文本不能送去 embedding(检查一下是不是读到了空段落)
```

五行全对,说明你默写的版本(或者 Day 217 的原版)行为正确。如果你默写时漏了 `keepdims=True`,第一行就会变成一个报错:`operands could not be broadcast together with shapes (12,1024) (12,)`。

## 默写二:查询线的检索四行

Day 221 的 `toy_query.py` 里,真正做「找」的是这四行。合上文章写出来,并在每行旁边写上形状:

```python
# Day 221 toy_query.py 的检索四行
scores = vecs @ embed_one(question)
top = np.argsort(-scores)[:TOP_K]
for i in top:
    print(f"检索到 [{meta['ids'][i]}] {scores[i]:.4f}")
```

<div class="line-notes">

- `scores = vecs @ embed_one(question)` `vecs` 是 `(N, 1024)`,`embed_one` 返回 `(1024,)`,矩阵乘向量得到 `(N,)`:每篇一个分数。因为两边都归一化过,点积就是余弦(Day 215)。
- `top = np.argsort(-scores)[:TOP_K]` `argsort` 返回「从小到大排好后,每个位置原来的下标」;加负号变成从大到小。取前 `TOP_K` 个,得到行号,比如 `[0, 1]`。
- `for i in top:` 行号不是文章编号,要靠 `meta["ids"][i]` 换回去。向量第 i 行和 `ids[i]` 一一对应,这个对应关系是索引线建立的,查询线只能信它。
- `print(f"检索到 [{meta['ids'][i]}] {scores[i]:.4f}")` 先打印检索到了什么,再看回答。这是本周最值得养成的习惯。

</div>

这四行今天的小项目会原样用到,只是多算一个「正确答案排第几」。

## 小项目:不切块,整篇检索

Day 221 的玩具索引每篇只有一两句话。现在我们有了 20 篇真文章,最自然的第一步是:**每篇整篇算一个向量**。这样做行不行?别猜,量一次。

我准备了 6 个问题,每个都写下它应该检索到的那篇文章。这就是一个最小的「检索评估集」(第四部分后面 [Day 257](/blog/agent-zero/day-257-rag-eval-3/) 会正式建 30 条)。新建 `part04/w32_whole.py`:

```python
# agent-zero-lab/part04/w32_whole.py
"""第 32 周小项目:不切块,把 20 篇帮助中心文章整篇编码,看检索能不能找对文章。"""
from pathlib import Path

import numpy as np

from common.embed import EMB_MODEL, embed, embed_one, usage
from part04.kb_check import read_meta

QUESTIONS = [
    ("月付套餐能退款吗", "kb-002"),
    ("重复扣款多久能退回来", "kb-002"),
    ("发票抬头开错了怎么办", "kb-007"),
    ("E1042 怎么解决", "kb-010"),
    ("E2017 怎么办", "kb-012"),
    ("接口返回 429 是什么意思", "kb-019"),
]


def load_articles() -> tuple[list[str], list[str]]:
    ids, texts = [], []
    for path in sorted(Path("data/kb").glob("*.md")):
        raw = path.read_text(encoding="utf-8")
        ids.append(read_meta(raw)["id"])
        texts.append(raw.split("---", 2)[2].strip())
    return ids, texts


def main() -> None:
    ids, texts = load_articles()
    vecs = embed(texts)
    print(f"模型 {EMB_MODEL},索引 {vecs.shape},{vecs.nbytes} 字节,"
          f"{usage['requests']} 次请求 {usage['tokens']} token")

    hits = 0
    for question, expected in QUESTIONS:
        scores = vecs @ embed_one(question)
        order = np.argsort(-scores)
        rank = [ids[i] for i in order].index(expected) + 1
        hits += rank == 1
        top3 = "  ".join(f"{ids[i]} {scores[i]:.3f}" for i in order[:3])
        mark = "✓" if rank == 1 else f"✗ 第{rank}名"
        print(f"{mark:<6} {question:<14} 应为 {expected} | {top3}")
    print(f"top-1 命中 {hits}/{len(QUESTIONS)}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from common.embed import EMB_MODEL, embed, embed_one, usage` Day 217 的模块,四样东西都用上。
- `from part04.kb_check import read_meta` Day 222 的函数。前提是 `kb_check.py` 已经改成带 main guard 的版本,否则一 import 就会把检查跑一遍然后退出(Day 222 的坑三)。
- `QUESTIONS = [` 6 个 `(问题, 应该检索到的编号)`。问题用客户的说法,不照抄文章里的字。
- `("重复扣款多久能退回来", "kb-002"),` 答案在 kb-002《退款政策》的第三个小节「重复扣款」。
- `("E1042 怎么解决", "kb-010"),` Day 219 的老对手,看整篇检索时它还会不会被 E1043 抢走。
- `("接口返回 429 是什么意思", "kb-019"),` 429 只出现在 kb-019 的正文里,标题是「开放 API」。
- `def load_articles() -> tuple[list[str], list[str]]:` 返回两个等长的列表:编号和正文。
- `for path in sorted(Path("data/kb").glob("*.md")):` 按文件名排序,第 i 篇的编号和第 i 行向量对得上。
- `ids.append(read_meta(raw)["id"])` 编号从 frontmatter 读,不从文件名读。Day 222 的检查保证了两者一致。
- `texts.append(raw.split("---", 2)[2].strip())` 只要正文。`split("---", 2)` 最多切两刀,得到 `["", frontmatter, 正文]`,取第 2 段。frontmatter 里的 `id: kb-002`、`category: 退款` 对检索没有帮助,不送去编码。
- `vecs = embed(texts)` 20 篇,`EMB_BATCH=10`,两次请求。
- `{vecs.nbytes} 字节` `nbytes` 是数组占的字节数:20 × 1024 × 4 = 81920,和 Day 220 的算法一致。
- `{usage['requests']} 次请求 {usage['tokens']} token` 实测 2 次、2056 个 token。20 篇正文一共 3026 个字符(Day 222 的 4070 去掉 frontmatter 和首尾空白),2056 ÷ 3026 ≈ 0.68 个 token 一个字,落在 Day 220 测的 0.7 到 0.9 的下沿,因为正文里有不少英文字母和数字。
- `hits = 0` top-1 命中的题数。
- `scores = vecs @ embed_one(question)` 默写二的第一行。
- `order = np.argsort(-scores)` 默写二的第二行,这次不截断,保留全部 20 个名次。
- `rank = [ids[i] for i in order].index(expected) + 1` 把行号换成编号,排成从高到低的编号列表,再找正确答案在第几位。`+ 1` 是因为名次从 1 开始,下标从 0 开始。
- `hits += rank == 1` `rank == 1` 是布尔值,Python 里 `True` 加到整数上当 1 用。JS 里 `hits += (rank === 1)` 也能跑,但 TS 会报类型错误;Python 的类型检查器允许这么写。
- `top3 = "  ".join(f"{ids[i]} {scores[i]:.3f}" for i in order[:3])` 前三名的编号和分数拼成一行。
- `mark = "✓" if rank == 1 else f"✗ 第{rank}名"` 三元表达式,相当于 JS 的 `rank === 1 ? "✓" : ...`,只是 Python 把条件写在中间。
- `print(f"top-1 命中 {hits}/{len(QUESTIONS)}")` 最后的成绩。

</div>

```bash
uv run python -m part04.w32_whole
```

真实输出:

```text
模型 BAAI/bge-m3,索引 (20, 1024),81920 字节,2 次请求 2056 token
✓      月付套餐能退款吗       应为 kb-002 | kb-002 0.784  kb-003 0.651  kb-008 0.635
✗ 第2名  重复扣款多久能退回来     应为 kb-002 | kb-004 0.739  kb-002 0.722  kb-003 0.641
✓      发票抬头开错了怎么办     应为 kb-007 | kb-007 0.783  kb-006 0.583  kb-012 0.576
✓      E1042 怎么解决     应为 kb-010 | kb-010 0.631  kb-011 0.554  kb-013 0.551
✓      E2017 怎么办      应为 kb-012 | kb-012 0.573  kb-013 0.518  kb-007 0.498
✓      接口返回 429 是什么意思 应为 kb-019 | kb-019 0.555  kb-013 0.520  kb-010 0.486
top-1 命中 5/6
```

(中文的列没对齐,原因 Day 222 练习 1 讲过:`:<14` 按字符数补空格,一个汉字在终端里占两格。)

5 道对了,有两点值得说。

E1042 这次排第一,领先 E1043 0.077。Day 219 那次是被 E1043 反超的,区别在于那天的两篇文章是特意写成「措辞更像问题」的反例,而今天是真文章,kb-010 正文里有「YYYY-MM-DD」「Excel 把日期转成了 2026/10/1」这些和导入失败强相关的内容。别据此认为错误码的问题解决了:四篇错误码文章的分数挤在 0.55 上下,0.07 的领先并不稳,练习 3 会看到它们彼此有多像。

错的那道才是今天的重点。「重复扣款多久能退回来」,答案就在 kb-002 的「重复扣款」小节里,写得清清楚楚:「3 个工作日内原路退回」。可 kb-004《自动续费与扣款规则》以 0.739 对 0.722 排在了前面。为什么?

kb-004 整篇都在讲扣款:什么时候扣、扣失败了重试几次、宽限期多久。它和「扣款」这个词全篇都对得上。kb-002 有四个小节,年付退款、月付退款、重复扣款、审批到账,「重复扣款」只是其中一节。整篇算一个向量,这个向量是四个话题的「平均」,每个话题都只沾一点。问题只问其中一个话题,得分就被另外三节稀释了。

这就是 Day 220 和 Day 221 都提到过的那个现象:**文章越长、话题越多,它的向量越平均,越难被某个具体问题命中**。在 top-3 的设定下 kb-002 还排在第二,模型也许还能答对;但知识库一大,这样被稀释的文章就会掉出 top-k。

能不能验证「是稀释,不是别的原因」?可以。把 kb-002 拆成四个小节分别编码,和同一个问题比一比。这就是练习 2,结果我先剧透一半:「重复扣款」那一节单独拿出来,分数比整篇高了一截,超过了 kb-004。明天的切块,就是把这个手动拆分变成一个正式的函数。

## 本周错题与坑清单

| 坑 | 症状 | 报错吗 | 修法 | 出处 |
| --- | --- | --- | --- | --- |
| 用 DeepSeek 的 key 调 embedding | 404 | 报错 | 另配 `EMB_*`,用有 embedding 接口的厂商 | Day 217 |
| 一条一条调 embedding | 20 条要 2 秒多 | 不报错 | 一次发一批,按 `EMB_BATCH` 切 | Day 217 |
| 用 `==` 比两次的向量 | 断言偶尔失败 | 报错(测试里) | 用余弦或 `np.allclose` | Day 217 |
| 空文本送去编码 | 返回一个和谁都 0.55 相似的向量 | 不报错 | 在 `_clean` 里拦住 | Day 217 |
| 换了模型没重建索引 | 检索结果近乎随机 | 不报错 | 索引里存模型名,查询前核对 | Day 217、221 |
| 给余弦定固定阈值 | 换个模型阈值全失效 | 不报错 | 看排序;阈值要在标注数据上按模型定 | Day 218 |
| 拿相似度判断「意思一样」 | 「支持」和「不支持」0.906 被当成重复 | 不报错 | 相似度只做检索,判断交给模型或规则 | Day 219 |
| 错误码只靠向量找 | E1042 检索到 E1043 | 不报错 | 加一路精确匹配,先 `upper()` | Day 219 |
| 用 float64 存向量 | 存储翻倍 | 不报错 | `.astype(np.float32)` | Day 220 |
| 只看榜单选模型 | 在自己的数据上输给免费模型 | 不报错 | 在自己的题上比,读模型卡 | Day 220 |
| 改了资料没重建索引 | 答旧政策还带出处 | 不报错 | 文档更新触发索引线;存指纹核对 | Day 221 |
| 全角冒号混进 frontmatter | 字段丢失,后面 `KeyError` | 晚报错 | 入索引前跑 `kb_check.py` | Day 222 |
| 在子目录里运行 | 文件写到 `part04/data/kb/` | 不报错 | 根目录 + `-m` | Day 222 |
| import 没有 main guard 的脚本 | 别人的检查跑了一遍,程序提前退出 | 不报错 | `if __name__ == "__main__":` | Day 222 |
| 整篇编码 | 多话题文章被稀释,排错 | 不报错 | 切块(明天) | 今天 |

数一下「报错吗」那一列:15 个坑里只有 3 个会报错。这就是做 RAG 最难受的地方,也是 Day 216 复习时那句话的延续:大部分错误不报错,只会让答案悄悄变差。所以本周反复练的「先打印检索到了什么」「留一个小评估集」比任何一个技巧都重要。

## 动手练习

**练习 1:把整篇索引存成文件。** 仿照 Day 221 的 `toy_index.py`,把小项目里 20 篇的向量存到 `part04/w32_index/vectors.npy`,编号和模型名存到 `meta.json`。先算出 `vectors.npy` 应该多大,再用 `ls -l` 验证。

<details><summary>参考答案</summary>

先算:20 × 1024 × 4 = 81920 字节,加上 Day 220 说的 128 字节文件头,应该是 82048 字节。

新建 `part04/ex_w32_index.py`:

```python
# agent-zero-lab/part04/ex_w32_index.py
import json
from pathlib import Path

import numpy as np

from common.embed import EMB_MODEL, embed
from part04.w32_whole import load_articles

OUT = Path("part04/w32_index")
OUT.mkdir(exist_ok=True)

ids, texts = load_articles()
vecs = embed(texts)
np.save(OUT / "vectors.npy", vecs)
meta = {"model": EMB_MODEL, "ids": ids}
(OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
print(vecs.dtype, vecs.shape, "→", OUT)
```

<div class="line-notes">

- `from part04.w32_whole import load_articles` 复用小项目的加载函数。`w32_whole.py` 有 main guard,import 时不会把 6 道题再跑一遍。
- `OUT = Path("part04/w32_index")` 和 Day 221 的 `part04/toy_index` 并排。
- `vecs = embed(texts)` 两次请求。
- `meta = {"model": EMB_MODEL, "ids": ids}` 存模型名,查询时核对(Day 217 的铁律);存编号,行号换编号靠它。这次不存原文,原文就在 `data/kb/` 里,需要时按编号去读。
- `print(vecs.dtype, vecs.shape, "→", OUT)` 确认是 float32。

</div>

```bash
uv run python -m part04.ex_w32_index
ls -l part04/w32_index | awk '{print $5, $9}'
```

`awk '{print $5, $9}'` 只打印 `ls -l` 的第 5 列(大小)和第 9 列(文件名),省得看权限那一大串。真实输出:

```text
float32 (20, 1024) → part04/w32_index
 
323 meta.json
82048 vectors.npy
```

第二行那个空行是 `ls -l` 第一行 `total 176` 被 awk 取第 5、9 列后剩下的空白,不用管。82048 字节,和算的一样。

</details>

**练习 2:把 kb-002 拆成小节,再问一次「重复扣款」。** 只用本周以前学过的字符串方法(不用正则),把 kb-002 的正文按 `\n## ` 拆成小节,分别编码,和「重复扣款多久能退回来」算余弦,和整篇的分数放在一起比。

<details><summary>参考答案</summary>

新建 `part04/ex_w32_sections.py`:

```python
# agent-zero-lab/part04/ex_w32_sections.py
from common.embed import embed, embed_one
from part04.w32_whole import load_articles

ids, texts = load_articles()
doc = texts[ids.index("kb-002")]
parts = doc.split("\n## ")[1:]
names = [p.split("\n", 1)[0] for p in parts]

q = embed_one("重复扣款多久能退回来")
whole = embed([doc])[0]
print(f"整篇 kb-002       {whole @ q:.3f}")
for name, vec in zip(names, embed(parts)):
    print(f"  小节「{name}」 {vec @ q:.3f}")
```

<div class="line-notes">

- `doc = texts[ids.index("kb-002")]` 按编号取出 kb-002 的正文。`list.index` 返回第一个等于它的位置,这里是 1。
- `parts = doc.split("\n## ")[1:]` 在每个「换行 + `## `」处切开。正文以 `# 退款政策` 开头,第 0 段就是这个一级标题,`[1:]` 扔掉它,剩下 4 段,每段以小节标题开头,比如 `"重复扣款\n同一笔订阅被重复扣款的,……"`。用 `"\n## "` 而不是 `"## "`,是为了只在行首切,不会误切正文中间出现的 `## `。明天会换成正则来做同一件事。
- `names = [p.split("\n", 1)[0] for p in parts]` 每段第一行就是小节标题:`["年付套餐", "月付套餐", "重复扣款", "审批与到账"]`。
- `q = embed_one("重复扣款多久能退回来")` 问题向量。
- `whole = embed([doc])[0]` 整篇再编码一次,作为对照。
- `for name, vec in zip(names, embed(parts)):` 4 段一次编码,`zip` 把标题和向量一对一配起来,相当于 JS 里按下标同时遍历两个数组。
- `print(f"  小节「{name}」 {vec @ q:.3f}")` 每个小节和问题的余弦。

</div>

```bash
uv run python -m part04.ex_w32_sections
```

真实输出:

```text
整篇 kb-002       0.723
  小节「年付套餐」 0.668
  小节「月付套餐」 0.632
  小节「重复扣款」 0.820
  小节「审批与到账」 0.727
```

整篇 0.723(和小项目里的 0.722 只差服务端抖动),「重复扣款」那一节单独拿出来是 0.820,比 kb-004 整篇的 0.739 高出 0.08,检索时会稳稳排第一。另外三节的分数都比它低,说明整篇的 0.723 确实是被它们拉下来的。这就是明天切块的全部理由,今天你已经亲手量出来了。

</details>

**练习 3:四篇错误码文章彼此有多像?** 用 Day 218 的方法,给 kb-010 到 kb-013 四篇错误码文章再加上 kb-002 做对照,整篇编码,算一张 5×5 相似度矩阵,并打印非对角线上的最高和最低分。

<details><summary>参考答案</summary>

新建 `part04/ex_w32_matrix.py`:

```python
# agent-zero-lab/part04/ex_w32_matrix.py
import numpy as np

from common.embed import embed
from part04.w32_whole import load_articles

ids, texts = load_articles()
pick = ["kb-010", "kb-011", "kb-012", "kb-013", "kb-002"]
vecs = embed([texts[ids.index(i)] for i in pick])
sim = vecs @ vecs.T

print("        " + "  ".join(pick))
for i, row in enumerate(sim):
    print(pick[i], "  ".join(f"{x:6.3f}" for x in row))
off = sim[~np.eye(len(pick), dtype=bool)]
print("非对角线最高", round(float(off.max()), 3), "最低", round(float(off.min()), 3))
```

<div class="line-notes">

- `pick = ["kb-010", "kb-011", "kb-012", "kb-013", "kb-002"]` 四篇错误码加一篇退款政策当对照。
- `vecs = embed([texts[ids.index(i)] for i in pick])` 按 `pick` 的顺序取正文,得到 `(5, 1024)`。
- `sim = vecs @ vecs.T` Day 218 的一行矩阵:`(5, 1024) @ (1024, 5)` 得到 `(5, 5)`。
- `print("        " + "  ".join(pick))` 表头。
- `for i, row in enumerate(sim):` 逐行打印,`enumerate` 同时给下标和这一行(Day 18)。
- `off = sim[~np.eye(len(pick), dtype=bool)]` 取出所有非对角线的格子。`np.eye(5, dtype=bool)` 是对角线为 `True`、其余为 `False` 的 5×5 表;`~` 把它取反,变成对角线 `False`、其余 `True`;用一张布尔表去索引数组,得到所有 `True` 位置的值,一共 20 个。这叫**布尔索引**,相当于 JS 里 `arr.filter((_, i) => mask[i])`,只是 numpy 一步做完。
- `round(float(off.max()), 3)` 非对角线的最高分。因为矩阵对称,每一对会出现两次,不影响最大最小值。

</div>

```bash
uv run python -m part04.ex_w32_matrix
```

真实输出:

```text
        kb-010  kb-011  kb-012  kb-013  kb-002
kb-010  1.000   0.676   0.689   0.689   0.482
kb-011  0.676   1.000   0.637   0.569   0.404
kb-012  0.689   0.637   1.000   0.710   0.515
kb-013  0.689   0.569   0.710   1.000   0.608
kb-002  0.482   0.404   0.515   0.608   1.000
非对角线最高 0.71 最低 0.404
```

四篇错误码文章两两之间在 0.57 到 0.71,比它们和 kb-002 高得多,说明它们在向量空间里挤成了一团:格式一样(「原因」「解决办法」)、句式一样(「EXXXX 表示……」)。这就是为什么小项目里四篇的检索分数都挤在 0.5 到 0.63 之间。kb-013(支付失败)和 kb-002(退款政策)有 0.608,两篇都在讲钱和支付,这个「意外高分」是合理的。按 Day 218 的读法,一张表里先看对角线(全是 1.000,说明归一化没问题)、再看对称,然后才看读数。

</details>

**练习 4(开放题):给小项目加两道你自己的题。** 选 Day 222 考点表里任意两个考点,各写一道客户口吻的问题和它应该检索到的编号,加进 `QUESTIONS` 重跑,记录命中情况,并用今天学到的「稀释」解释错的那道(如果有)。

<details><summary>参考答案</summary>

示范解法。我选了「仅限企业版」和「90 天 vs 30 天」两个考点,在 `QUESTIONS` 末尾加两行:

```python
    ("专业版可以开增值税专用发票吗", "kb-006"),
    ("发票开出来一个月了还能改抬头吗", "kb-007"),
```

我把改过的文件另存成 `part04/ex_w32_more.py` 跑,最后三行是(前 6 题的名次和上面一样,分数第三位有服务端抖动,比如 0.784 变成 0.785):

```bash
uv run python -m part04.ex_w32_more | tail -3
```

```text
✓      专业版可以开增值税专用发票吗 应为 kb-006 | kb-006 0.705  kb-007 0.595  kb-020 0.536
✓      发票开出来一个月了还能改抬头吗 应为 kb-007 | kb-007 0.765  kb-006 0.594  kb-005 0.521
top-1 命中 7/8
```

两道新题都对了。kb-006 和 kb-007 都是短文章(2 节和 1 节),话题单一,不容易被稀释,所以整篇编码也能找对。注意「专业版能不能开专票」这题,检索对了只是第一步:kb-006 原文是「仅限企业版,或年付的专业版」,月付专业版不行,这个条件要靠生成那一步读原文分辨,检索只负责把这篇送到模型面前。

</details>

**验收标准:** `w32_embed_check.py` 五行输出全对;能不看文章写出 `embed()` 和检索四行;`w32_whole.py` 跑出 5/6,能用「稀释」解释错的那道;练习 2 量出「重复扣款」小节比整篇高;能说出坑清单里至少六个坑的症状和修法,并指出其中哪几个会报错。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 检索评估集 | 一组「问题 + 应该检索到的文档」,用来量检索找得准不准。今天的 `QUESTIONS` 就是最小的一份 |
| top-1 命中 | 正确答案排在第一名的比例,今天是 5/6 |
| 名次(rank) | 正确答案在检索结果里排第几,1 表示第一 |
| 整篇编码 | 不切块,一篇文章算一个向量 |
| 稀释 | 一篇文章话题越多,它的向量越像各话题的平均,和其中任何一个具体问题的相似度都被拉低 |
| `ndarray.nbytes` | 数组占用的字节数,`(20, 1024)` 的 float32 是 81920 |
| 布尔索引 | 用一张同形状的 True/False 表去取数组里的值,`sim[mask]` |
| `np.eye(n)` | n×n 的单位矩阵,对角线是 1(或 True),其余是 0 |

## 常见误区

**以为复习就是重看一遍。** 重看只会让你觉得「都懂了」。合上文章写 `embed()`,十有八九会漏掉 `sorted(... d.index)` 或 `keepdims=True`;漏掉 `keepdims` 会马上报 `operands could not be broadcast together`,漏掉排序则不报错,所以更要靠默写记住。

**看到 5/6 就觉得整篇编码够用了。** 6 道题太少,而且错的那道恰好是最典型的多话题文章。知识库大了,被稀释的文章会掉出 top-k,而你看到的只是模型说「资料里没有」。

**以为 E1042 这次排对了,错误码问题就没了。** 领先只有 0.077,四篇错误码文章两两相似度到 0.71。真实文章的措辞一变,名次就可能翻。精确匹配那一路(Day 219)不能省。

**把 frontmatter 一起送去编码。** `id: kb-002`、`category: 退款` 这几行对语义没帮助,还会让所有文章都多出几行一模一样的格式文字,彼此更像。元数据存起来用于引用和过滤,正文才送去编码。

**评估集的问题照抄文章原文。** 那样考的是「抄得像不像」,不是检索。今天的问题都用客户口吻,比如「多久能退回来」而不是「3 个工作日内原路退回」。

## 学习资料

### 文档与文章

- [Anthropic · Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval):Day 221 读过开头。今天读它说「传统 RAG 把文档切成小块」那一段,正好接明天的切块。
- [Pinecone · Chunking Strategies for LLM Applications](https://www.pinecone.io/learn/chunking-strategies/):明天的预习材料,今天只读开头讲「为什么要切」的部分,对照今天量出的稀释现象。
- [Python 文档 · 内置类型(str 的方法)](https://docs.python.org/zh-cn/3.12/library/stdtypes.html):本周用到的 `split`、`partition`、`splitlines`、`startswith` 都在「字符串的方法」一节,中文版。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1JLN2z4EZQ&autoplay=0&high_quality=1" title="RAG 工作机制详解——一个高质量知识库背后的技术全流程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>马克的技术工作坊 · RAG 工作机制详解——一个高质量知识库背后的技术全流程 · 17 分钟,播放 40 多万。从切块、embedding 到检索把全流程过一遍,正好用来复习本周并预习下周。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV11zf6YyEnT&autoplay=0&high_quality=1" title="20分钟速成 RAG & 向量数据库核心概念 【小白学AI系列 -1 】" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Jim大表哥2025 · 20分钟速成 RAG &amp; 向量数据库核心概念 · 20 分钟。面向新手,把向量、相似度、向量库几个概念串起来,适合检查本周的概念有没有漏。</figcaption>
</figure>

### 其他经典视频

今天这组不需要。本周每一天的学习资料里已经推荐过英文视频,复习时回去挑一个没看完的看完。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)。第 6 章「RAG and Agents」讲检索的部分,读到「chunking strategy」之前停下,明天再接着读。

### 开源项目与代码

- [datawhalechina/all-in-rag](https://github.com/datawhalechina/all-in-rag):对照它前两章的代码,看看它的 embedding 封装和我们的 `common/embed.py` 有什么不同。

## 自测

**1. `embed()` 里为什么要 `sorted(resp.data, key=lambda d: d.index)`?不排会怎样?**

<details><summary>答案</summary>

协议没保证响应里 `data` 的顺序和输入顺序一致,每条结果带着 `index` 字段表示它对应第几条输入。不排序的话,一旦服务端打乱顺序,第 3 条文本的向量会被存成第 5 条的,检索时张冠李戴,而且完全不报错。

</details>

**2. `vecs` 是 `(20, 1024)`,`embed_one(q)` 是 `(1024,)`,`vecs @ embed_one(q)` 是什么形状?每个数是什么意思?**

<details><summary>答案</summary>

`(20,)`。第 i 个数是第 i 篇文章和问题的点积;两边都归一化过,所以就是余弦相似度。

</details>

**3. 今天小项目里「重复扣款多久能退回来」为什么排错了?你怎么证明你的解释?**

<details><summary>答案</summary>

kb-002 有四个话题,整篇的向量是四个话题的平均,和只问其中一个话题的问题相似度被稀释(0.722);kb-004 整篇都在讲扣款,得分 0.739 反而更高。证明方法是练习 2:把 kb-002 拆成小节分别编码,「重复扣款」那一节和问题的余弦是 0.820,明显高于整篇和 kb-004,其他三节都更低,说明整篇分数是被它们拉低的。

</details>

**4. 本周的坑里,哪几个会报错?为什么说「不报错的坑」更危险?**

<details><summary>答案</summary>

会报错的:用 DeepSeek 调 embedding(404)、用 `==` 比向量(测试断言失败)、frontmatter 全角冒号(后面 `KeyError`,还是晚报的)。其余都不报错:换模型没重建、改资料没重建、错误码被近似的抢走、整篇编码被稀释、在子目录里运行……不报错的坑只会让答案悄悄变差,用户看到的是一个有理有据但错误的回答,只有靠打印检索结果和评估集才能发现。

</details>

**5. 面试题:「你怎么快速判断一个 RAG 系统的检索有没有问题?」**

<details><summary>答案</summary>

先建一个小评估集,哪怕只有十几条:每条是客户口吻的问题加上应该检索到的文档编号,问题别照抄原文,要覆盖已知的难点(长得像的编号、多话题文章、否定条件)。然后跑检索,看正确答案的名次,算 top-1 和 top-k 命中率。错的那几道逐条看:打印 top-3 和分数,判断是被近似文档抢走(加精确匹配或 rerank)、是长文档被稀释(切块)、还是索引过期或模型不一致(查元数据里的模型名和指纹)。我会举今天的例子:整篇编码时「重复扣款」被 kb-004 抢了第一,拆成小节后对应小节 0.820 稳居第一,这就是用评估集定位到「该切块」的过程。

</details>

## 明天预告

明天是 [Day 224 · 切块:为什么切、怎么切](/blog/agent-zero/day-224-chunking/)。今天量出了整篇编码的毛病:多话题的文章被稀释,练习 2 用 `split("\n## ")` 手动拆了一篇就把分数从 0.723 拉到 0.820。明天把这个手动操作变成正式的 `part04/chunking.py`:按 `##` 标题切、每块开头拼上「文章标题 > 小节标题」、太长的小节再按长度切并留重叠,20 篇切出 42 块,后天建索引直接用。
