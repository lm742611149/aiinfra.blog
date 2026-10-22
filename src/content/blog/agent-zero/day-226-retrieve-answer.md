---
title: 'Day 226 · 检索和回答:top-k 拼进 prompt'
description: '查询线的正式版 part04/rag_numpy.py:问题编码后和 (42, 1024) 的矩阵一乘,取分数最高的 k 块,每块包进带 id 的 <doc> 标签拼进 prompt,让大模型回答并在每句后面标出处,再用一个函数检查标的出处是不是真的在资料里。实跑中模型自己发明了 [kb-003#2#1] 这种不存在的编号,而我第一版的检查正则把它放过去了。'
pubDate: 2026-10-22
regime: none
tags: ['rag', 'retrieval', 'citation', 'prompt', 'agent-zero']
series: 'agent-zero'
day: 226
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 225](/blog/agent-zero/day-225-numpy-index/) 把 42 块编码成 `(42, 1024)` 的 float32 数组存进 `index/vectors.npy`,块的文字和元数据存进 `index/chunks.json`,又写了 `load_index()`:读回 42 个 `Chunk` 和矩阵,模型名或行数对不上就报错。练习里还看到,`kb-012#2` 和另外两篇错误码文章的「解决办法」彼此很像。

索引线到这里就完整了。今天回到查询线,把 [Day 221](/blog/agent-zero/day-221-why-rag/) 那个玩具 `toy_query.py` 换成正式版:从索引里找出最相关的几块,拼进 prompt,让模型照着回答,并且说清楚每句话出自哪一块。

## 今天要解决的问题

学完今天,你应该能做到:

1. 写出 `search(question, k)`:一次矩阵乘法得到 42 个分数,`np.argsort` 取前 k 个,返回 `(Chunk, 分数)` 列表;能看着分数表说出 k 取太小、太大各会怎样,并知道 top-k 永远返回 k 个,哪怕没有一块相关。
2. 写出 `build_messages(question, chunks)`:每块包进 `<doc id="kb-002#1" title="退款政策">` 标签,资料在前、问题在后,拼成 system + user 两条消息。
3. 让模型在每个事实句后面标 `[kb-002#1]` 这样的**引用**,并写 `check_citations()` 把回答里的引用抠出来,和这次实际给的块对一对,找出编出来的编号。
4. 拼出 `part04/rag_numpy.py`,命令行一句话问问题,看到检索结果、引用检查和带出处的回答。

预计用时 2.5 小时:看分数表选 k 30 分钟,拼 prompt 30 分钟,回答和引用检查 50 分钟,剩下做练习。前置:[Day 225](/blog/agent-zero/day-225-numpy-index/) 的 `part04/build_index.py`(`load_index`)和已经建好的 `index/`,[Day 224](/blog/agent-zero/day-224-chunking/) 的 `Chunk`,[Day 221](/blog/agent-zero/day-221-why-rag/) 的 `toy_query.py`,[Day 135](/blog/agent-zero/day-135-llm-client-1/) 起写的 `common/llm.py`(`LLMClient`),[Day 143](/blog/agent-zero/day-143-prompt-5/) 的「用标签分隔」,[Day 219](/blog/agent-zero/day-219-embed-limits/) 和 [Day 224](/blog/agent-zero/day-224-chunking/) 用过的 `re`。

实跑花费:embedding 是硅基流动免费的 bge-m3;大模型是 DeepSeek 的 `deepseek-flash`,`.env` 里 `LLM_PRICE=0.04,2,8`,是 2026 年 10 月在 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) 查到的高峰价(缓存命中 / 未命中输入 / 输出,元每百万 token;空闲时段减半)。一次回答输入三四百 token、输出六七十 token,约 373 × 2 / 10⁶ + 62 × 8 / 10⁶ ≈ ¥0.0012。正文加练习一共调了十几次,合计约 ¥0.02。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `search()` 和 `check_citations()`;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 查询线长什么样

先看全貌。Day 221 的玩具版已经有了骨架,今天每一步都换成正式的零件:

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="查询线:问题编码,和矩阵相乘得到 42 个分数,取 top-k 块拼进 prompt,大模型回答带引用,再检查引用">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<defs><marker id="m226" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--ink-faint)"/></marker></defs>
<rect x="20" y="30" width="150" height="44" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="95" y="50" fill="var(--ink)" text-anchor="middle">问题</text>
<text x="95" y="66" fill="var(--ink-soft)" text-anchor="middle" font-size="11">重复扣款多久能退</text>
<line x1="170" y1="52" x2="226" y2="52" stroke="var(--ink-faint)" marker-end="url(#m226)"/>
<rect x="230" y="30" width="180" height="44" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="50" fill="var(--ink)" text-anchor="middle">embed_one → (1024,)</text>
<text x="320" y="66" fill="var(--ink-soft)" text-anchor="middle" font-size="11">bge-m3,和建索引同一个</text>
<line x1="410" y1="52" x2="456" y2="52" stroke="var(--ink-faint)" marker-end="url(#m226)"/>
<rect x="460" y="30" width="160" height="44" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="540" y="50" fill="var(--ink)" text-anchor="middle">VECTORS @ q</text>
<text x="540" y="66" fill="var(--ink-soft)" text-anchor="middle" font-size="11">42 个分数</text>
<line x1="540" y1="74" x2="540" y2="112" stroke="var(--ink-faint)" marker-end="url(#m226)"/>
<rect x="420" y="116" width="200" height="44" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="520" y="136" fill="var(--ink)" text-anchor="middle">argsort 取前 k 个</text>
<text x="520" y="152" fill="var(--ink-soft)" text-anchor="middle" font-size="11">行号 → CHUNKS[i]</text>
<line x1="420" y1="138" x2="376" y2="138" stroke="var(--ink-faint)" marker-end="url(#m226)"/>
<rect x="150" y="116" width="222" height="44" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="261" y="136" fill="var(--ink)" text-anchor="middle">build_messages</text>
<text x="261" y="152" fill="var(--ink-soft)" text-anchor="middle" font-size="11">&lt;doc id="kb-002#3"&gt;…&lt;/doc&gt; + 问题</text>
<line x1="261" y1="160" x2="261" y2="196" stroke="var(--ink-faint)" marker-end="url(#m226)"/>
<rect x="150" y="200" width="222" height="44" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="261" y="220" fill="var(--ink)" text-anchor="middle">LLMClient.chat</text>
<text x="261" y="236" fill="var(--ink-soft)" text-anchor="middle" font-size="11">deepseek-flash,temperature=0</text>
<line x1="372" y1="222" x2="416" y2="222" stroke="var(--ink-faint)" marker-end="url(#m226)"/>
<rect x="420" y="200" width="200" height="44" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="520" y="220" fill="var(--ink)" text-anchor="middle">回答 …[kb-002#3]</text>
<text x="520" y="236" fill="var(--ink-soft)" text-anchor="middle" font-size="11">check_citations 对账</text>
<text x="20" y="282" fill="var(--ink-soft)" font-size="11">琥珀色 = 外部服务(embedding);蓝色 = 大模型。其余全在本机内存里,一次矩阵乘法加一次排序。</text>
</g>
</svg>
<figcaption>今天的 `rag_numpy.py` 就是这张图从左上走到右下。前三格是检索(retrieval),中间一格是拼 prompt(augmentation),最后两格是生成(generation)和对账。RAG 三个字母各占一段。</figcaption>
</figure>

## 第一步:top-k,先看一眼分数表

**top-k** 是「按分数从高到低,取前 k 个」。检索的结果就是 top-k 块,k 一般取 3 到 8。k 取多少不能拍脑袋,先把一个问题对全部 42 块的分数排出来看看。新建 `part04/topk_scores.py`:

```python
# agent-zero-lab/part04/topk_scores.py
import sys

import numpy as np

from common.embed import embed_one
from part04.build_index import load_index

chunks, vectors = load_index()
question = sys.argv[1]
scores = vectors @ embed_one(question)
order = np.argsort(-scores)

print("问题:", question)
for rank, i in enumerate(order[:8], start=1):
    c = chunks[i]
    print(f"{rank}. {scores[i]:.3f}  {c.id:<9} {c.title} > {c.section}")
print(f"……第 42 名 {scores[order[-1]]:.3f}  {chunks[order[-1]].id}")
```

<div class="line-notes">

- `from part04.build_index import load_index` Day 225 的读索引函数,不用再切块、不用再编码文章。
- `chunks, vectors = load_index()` 42 个 `Chunk` 和 `(42, 1024)` 的矩阵,第 i 行对应 `chunks[i]`。
- `question = sys.argv[1]` 命令行第一个参数(Day 221 讲过),问题有空格要加引号。
- `scores = vectors @ embed_one(question)` 问题编码成 `(1024,)`,`(42, 1024) @ (1024,)` 得到 `(42,)`:每块一个余弦相似度(都归一化过,点积就是余弦,Day 215)。
- `order = np.argsort(-scores)` `argsort` 返回「把数组排好序需要的下标顺序」,默认从小到大;对 `-scores` 排就是从大到小。返回的是**行号**,不是分数。
- `for rank, i in enumerate(order[:8], start=1):` 只看前 8 名。`enumerate(..., start=1)` 让名次从 1 开始数,相当于 JS `forEach((x, idx) => ...)` 里的 `idx + 1`。
- `c = chunks[i]` 用行号去块列表里取块,这一步靠的就是 Day 225 说的「按下标对齐」。
- `print(f"{rank}. {scores[i]:.3f}  {c.id:<9}` `:<9` 左对齐占 9 格,让编号一列对齐。
- `scores[order[-1]]` `order[-1]` 是最后一个,也就是分数最低的那一行。看看最高和最低差多少。

</div>

问三个问题,一个只靠一块就能答,一个跨两篇,一个帮助中心里根本没有:

```bash
cd /Users/你/agent-zero-lab
uv run python -m part04.topk_scores "年付专业版用到第 3 个月想退,能退多少"
uv run python -m part04.topk_scores "退款之前已经开了发票怎么办"
uv run python -m part04.topk_scores "你们支持微信支付吗"
```

真实输出:

```text
问题: 年付专业版用到第 3 个月想退,能退多少
1. 0.839  kb-002#1  退款政策 > 年付套餐
2. 0.663  kb-002#2  退款政策 > 月付套餐
3. 0.649  kb-018#2  数据安全与备份 > 备份
4. 0.639  kb-003#1  如何申请退款 > 操作步骤
5. 0.637  kb-005#2  升级与降级 > 降级
6. 0.626  kb-002#3  退款政策 > 重复扣款
7. 0.616  kb-001#1  套餐与价格 > 三种套餐
8. 0.614  kb-014#2  导出数据和报表 > 次数限制
……第 42 名 0.344  kb-018#1

问题: 退款之前已经开了发票怎么办
1. 0.795  kb-003#2  如何申请退款 > 已经开了发票怎么办
2. 0.669  kb-007#1  修改发票抬头 > 开错了怎么办
3. 0.663  kb-006#2  发票类型与开具 > 怎么申请
4. 0.647  kb-003#1  如何申请退款 > 操作步骤
5. 0.641  kb-002#3  退款政策 > 重复扣款
6. 0.630  kb-012#2  错误码 E2017:发票识别失败 > 解决办法
7. 0.629  kb-002#4  退款政策 > 审批与到账
8. 0.628  kb-008#2  优惠码使用规则 > 退款时怎么算
……第 42 名 0.364  kb-018#1

问题: 你们支持微信支付吗
1. 0.595  kb-016#1  账号安全与两步验证 > 两步验证
2. 0.550  kb-002#4  退款政策 > 审批与到账
3. 0.548  kb-020#1  多币种记账 > 支持范围
4. 0.538  kb-013#2  错误码 E3001:支付失败 > 解决办法
5. 0.535  kb-009#1  导入银行流水 > 支持的格式
6. 0.526  kb-001#2  套餐与价格 > 怎么选
7. 0.525  kb-001#1  套餐与价格 > 三种套餐
8. 0.517  kb-002#2  退款政策 > 月付套餐
……第 42 名 0.347  kb-018#1
```

三张表各说明一件事。

第一张,答案就在第 1 名,0.839,比第 2 名高出 0.18,一枝独秀。这种问题 k=1 就够,多给的几块是陪跑的:第 3 名「备份」和退款毫无关系,只因为它也提到了「企业版」「收费」。陪跑的块塞进 prompt,一来花钱,二来可能干扰模型。

第二张,第 1 名对,但「退款」这件事还有一半在第 4 名的「操作步骤」和第 7 名的「审批与到账」里,用户接下来很可能就问「那退款多久到账」。第 2 到第 8 名的分数挤在 0.63 到 0.67 之间,只差零点零几,谁排第几基本是运气。k 太小会漏掉有用的块。

第三张最该记住:帮助中心里根本没有「微信支付」,可检索照样返回了 8 块,第 1 名是「两步验证」。**top-k 永远返回 k 个**,它只负责排序,不负责判断「够不够相关」。分数低(0.595,比前两张的第 1 名低一大截)是一个信号,但没有一个固定的分界线能把「相关」和「不相关」干净地分开:第二张第 8 名 0.628 是不太相关的块,却比这里的第 1 名还高。所以资料不相关时怎么办,要交给 prompt 和模型,这是明天 Day 227 的拒答。

那 k 取多少?客服这种「一个问题通常靠一两节就能答」的场景,我从 k=4 起步:够装下「跨两篇」的情况,又不至于塞太多陪跑的。练习 1 会把同一个跨篇问题用 k=1、2、4、8 各跑一次,看回答和花费怎么变。真正定 k 要靠评估集,Day 255 起会量。

## 第二步:把 top-k 拼进 prompt

检索出来的块要交给模型。拼法有讲究,[Day 143](/blog/agent-zero/day-143-prompt-5/) 讲过用标签把不同性质的内容分开,今天用 `<doc>` 标签把每一块包起来,块的编号写在标签的属性上,模型要标出处时照抄它。整体结构是:system 消息里写规矩,user 消息里先放 `<资料>`,最后放问题。

这一步我直接写进正式的 `rag_numpy.py` 里,先用一个小脚本看拼出来的样子。`build_messages` 的代码下一节一起讲,这里先看效果。新建 `part04/prompt_preview.py`:

```python
# agent-zero-lab/part04/prompt_preview.py
from part04.rag_numpy import build_messages, search

question = "重复扣款多久能退回来"
hits = search(question, k=2)
messages = build_messages(question, [c for c, _ in hits])
for m in messages:
    print(f"===== {m['role']}({len(m['content'])} 字符)=====")
    print(m["content"])
```

<div class="line-notes">

- `from part04.rag_numpy import build_messages, search` 从下一节的 `rag_numpy.py` 里拿两个函数。import 它的时候,它顶上的 `load_index()` 和 `LLMClient()` 会先执行一遍,但这个脚本不调用模型,不花钱。
- `hits = search(question, k=2)` 只取 2 块,拼出来短一点好看。`hits` 是 `[(Chunk, 分数), ...]`。
- `[c for c, _ in hits]` 把 `(块, 分数)` 拆开,只要块。分数是给我们调试看的,不给模型。
- `for m in messages:` 两条消息,一条 system 一条 user。
- `len(m['content'])` 每条消息有多少个字符,心里有个数。

</div>

```bash
uv run python -m part04.prompt_preview
```

真实输出:

```text
===== system(79 字符)=====
你是云簿 CloudLedger 的客服助手。只根据 <资料> 里的内容回答用户问题。
每一个事实性的句子后面,用方括号标注出处,例如 [kb-002#1]。
===== user(279 字符)=====
<资料>
<doc id="kb-002#3" title="退款政策">
退款政策 > 重复扣款
同一笔订阅被重复扣款的,核实后全额退还重复的那一笔,3 个工作日内原路退回。
</doc>

<doc id="kb-004#2" title="自动续费与扣款规则">
自动续费与扣款规则 > 扣款失败
扣款失败后,系统每 24 小时重试一次,最多重试 3 次。到期后有 7 天宽限期,宽限期内所有功能正常。
宽限期结束仍未付款的,账户降为免费版。超出免费版额度的数据会保留 90 天,补缴后恢复。
</doc>
</资料>

用户问题:重复扣款多久能退回来
```

这就是模型真正看到的东西。RAG 里的「A」(augmented,增强)说的就是这一步:模型本身没变,只是我们在问题前面塞了几段资料。调 RAG 的时候,**先把拼好的 prompt 打出来看一遍**,很多问题一看就明白:检索拿错了块、块里缺了关键的一句、前缀把两个错误码搞混了,都写在这里。

注意第二块「扣款失败」和问题关系不大,只因为也讲扣款被拉了进来。模型要分得清哪块有用,标签和编号能帮它分。

## 第三步:回答,并要求标出处

**引用**(citation)是模型在回答里写明「这句话出自哪一块资料」。我们的写法是在每个事实句后面加 `[kb-002#1]`。它有两个用处。对用户,回答旁边可以挂一个「来源」链接,点开能核对原文,出了错也知道是哪篇文章写的;对我们,引用是排错的线索:用户投诉回答错了,一看引用就分得清是检索拿错了资料,还是资料对了模型理解错了。Day 255 做 RAG 评估时,正是按这两层分开判的。

光让模型标还不够,还要**检查**它标的对不对:标出来的编号必须是这次确实给它的那几块之一。模型完全可能写出一个看着像、其实不存在的编号。

新建正式版 `part04/rag_numpy.py`:

```python
# agent-zero-lab/part04/rag_numpy.py
"""查询线:问题 → 检索 top-k → 拼 prompt → 大模型回答,回答里带引用。"""
import re
import sys

import numpy as np

from common.embed import embed_one
from common.llm import LLMClient
from part04.build_index import load_index
from part04.chunking import Chunk

CHUNKS, VECTORS = load_index()
client = LLMClient()

SYSTEM = """你是云簿 CloudLedger 的客服助手。只根据 <资料> 里的内容回答用户问题。
每一个事实性的句子后面,用方括号标注出处,例如 [kb-002#1]。"""

CITE = re.compile(r"\[([^\[\]]+)\]")


def search(question: str, k: int = 4) -> list[tuple[Chunk, float]]:
    scores = VECTORS @ embed_one(question)
    top = np.argsort(-scores)[:k]
    return [(CHUNKS[i], float(scores[i])) for i in top]


def build_messages(question: str, chunks: list[Chunk]) -> list[dict]:
    docs = "\n\n".join(f'<doc id="{c.id}" title="{c.title}">\n{c.text}\n</doc>' for c in chunks)
    user = f"<资料>\n{docs}\n</资料>\n\n用户问题:{question}"
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]


def check_citations(reply: str, chunks: list[Chunk]) -> tuple[list[str], list[str]]:
    cited: list[str] = []
    for inside in CITE.findall(reply):
        for part in re.split(r"[,，、\s]+", inside):
            if part and part not in cited:
                cited.append(part)
    given = {c.id for c in chunks}
    return cited, [x for x in cited if x not in given]


def answer(question: str, k: int = 4) -> str:
    hits = search(question, k)
    for c, s in hits:
        print(f"  {s:.3f}  {c.id:<9} {c.title} > {c.section}")
    chunks = [c for c, _ in hits]
    r = client.chat(build_messages(question, chunks), temperature=0)
    cited, unknown = check_citations(r.content, chunks)
    print(f"  引用了 {cited},不在资料里的 {unknown}")
    return r.content


if __name__ == "__main__":
    q = " ".join(sys.argv[1:]) or "年付专业版用到第 3 个月想退,能退多少"
    print(f"问:{q}\n检索到:")
    print("答:" + answer(q))
    print("---", client.ledger)
```

<div class="line-notes">

- `from common.llm import LLMClient` Day 135 起写的封装,读 `.env` 的 `LLM_*`。我的配置是 `deepseek-flash`,`LLM_EXTRA_BODY` 关掉了思考模式。
- `from part04.chunking import Chunk` 只拿来做类型标注:`search` 返回的、`build_messages` 收的都是 `Chunk`。
- `CHUNKS, VECTORS = load_index()` 模块被 import 时执行一次,之后每次查询都直接用内存里的这两样,不再读文件。名字全大写表示「模块级的、加载完就不改的」,Python 没有 `const`,靠命名约定。
- `client = LLMClient()` 整个模块共用一个客户端,`client.ledger` 会把每次调用的 token 和花费累加起来。
- `SYSTEM = """你是云簿 CloudLedger 的客服助手。` 今天的第一版规矩只有两句:只根据资料答,每句标出处。明天 Day 227 会一句一句加,并说明每句是踩了什么坑才加的。
- `CITE = re.compile(r"\[([^\[\]]+)\]")` 匹配一对方括号和里面的全部内容。`\[`、`\]` 是方括号本身(在正则里 `[` 有特殊含义,要加反斜杠);中间的 `[^\[\]]+` 是「一个或多个不是方括号的字符」;外面一层圆括号是**分组**,`findall` 只返回分组里的东西,也就是方括号里面的文字。`re.compile` 把正则预先编译成对象,反复用时省一点时间,相当于 JS 里把 `/.../g` 存成一个常量。为什么要匹配整个方括号而不是直接匹配 `kb-002#1` 这种形状,下面「故意踩坑」一节演示。
- `def search(question: str, k: int = 4) -> list[tuple[Chunk, float]]:` 和 `topk_scores.py` 一样的三行,包成函数。下面用「年付专业版用到第 3 个月想退,能退多少」追踪。
- `scores = VECTORS @ embed_one(question)` `(42,)`,最高 0.839,最低 0.344。
- `top = np.argsort(-scores)[:k]` 前 4 个行号。`[:k]` 是切片,k=4 取 4 个。
- `return [(CHUNKS[i], float(scores[i])) for i in top]` 行号换成块,分数转成普通 `float`(numpy 的 float32 打印出来带一长串尾巴,也不能直接进 JSON)。实测返回 `kb-002#1` 0.839、`kb-002#2` 0.663、`kb-018#2` 0.649、`kb-003#1` 0.639。
- `def build_messages(question: str, chunks: list[Chunk]) -> list[dict]:` 收问题和块,返回两条消息。参数是块列表而不是 `(块, 分数)`,因为分数不归模型管,这样以后换了别的检索方式(Day 240 的四种模式)也能直接复用。
- `f'<doc id="{c.id}" title="{c.title}">\n{c.text}\n</doc>' for c in chunks` 外层用单引号,里面才能直接写双引号。`c.text` 开头已经带了 Day 224 的「标题 > 小节」前缀。外面的 `"\n\n".join(...)` 让块和块之间空一行,相当于 JS 的 `chunks.map(...).join("\n\n")`。
- `user = f"<资料>\n{docs}\n</资料>\n\n用户问题:{question}"` 资料在前,问题在最后。上一节实测 k=2 时 279 个字符。
- `return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]` 一问一答,没有历史。多轮对话里怎么带资料是 Day 262 上下文工程的事。
- `def check_citations(reply: str, chunks: list[Chunk]) -> tuple[list[str], list[str]]:` 返回两样:回答里引用了哪些编号(按出现顺序、去重),其中哪些不在这次给的资料里。
- `for inside in CITE.findall(reply):` 每对方括号里的文字。回答里写 `[kb-002#1]` 时 `inside` 是 `"kb-002#1"`。
- `for part in re.split(r"[,，、\s]+", inside):` 模型有时把两个出处写进一对括号,`[kb-002#1, kb-003#1]` 或 `[kb-002#1、kb-003#1]`。按半角逗号、全角逗号、顿号或空白切开,每段单独算一个。
- `if part and part not in cited:` 跳过切出来的空字符串;重复出现的编号只记一次。用列表而不是集合,是为了保留第一次出现的顺序,练习 2 列「来源」时要按这个顺序编号。
- `given = {c.id for c in chunks}` 集合推导式(Day 25),这次给模型的 4 个编号。
- `return cited, [x for x in cited if x not in given]` 第二个列表就是「模型编出来的出处」。理想情况它永远是空的。
- `r = client.chat(build_messages(question, chunks), temperature=0)` `temperature=0` 让回答尽量稳定([Day 112](/blog/agent-zero/day-112-sampling-2/) 说过它不保证每次一样)。`r` 是 `ChatResult`,正文在 `r.content`。
- `print(f"  引用了 {cited},不在资料里的 {unknown}")` 每次回答都打印对账结果,不正常的一眼能看到。
- `q = " ".join(sys.argv[1:]) or "年付专业版用到第 3 个月想退,能退多少"` 把命令行的所有参数用空格拼回一句话;一个参数都没给时 `" ".join([])` 是空字符串,`or` 换成默认问题。这样问题里有空格也不用加引号。
- `print("---", client.ledger)` `Ledger` 的 `__str__` 打印调用次数、token 和花费。

</div>

先跑默认问题:

```bash
uv run python -m part04.rag_numpy
```

真实输出:

```text
问:年付专业版用到第 3 个月想退,能退多少
检索到:
  0.839  kb-002#1  退款政策 > 年付套餐
  0.663  kb-002#2  退款政策 > 月付套餐
  0.649  kb-018#2  数据安全与备份 > 备份
  0.639  kb-003#1  如何申请退款 > 操作步骤
  引用了 ['kb-002#1'],不在资料里的 []
答:年付套餐(专业版和企业版)中途取消的,按剩余的整月数比例退款,已经使用的月份和当前所在的月份不退 [kb-002#1]。

以年付专业版 468 元、折合每月 39 元为例:在第 3 个月中途取消,前 2 个月加当月共 3 个月不退,退剩余 9 个月,即 351 元 [kb-002#1]。
--- 1 次调用 | 输入 373 / 输出 96 tokens | 约 ¥0.0015
```

答对了,351 元,两句话都标了 `[kb-002#1]`,对账干净。Day 221 玩具版答不出具体金额,是因为价格和退款规则在两篇文章里而 top-2 只找到一篇;正式版的块里自带「468 元,折合每月 39 元」的例子,一块就够。另外三块(月付、备份、操作步骤)模型都没用,也没被它们带偏。

再问跨篇的那个:

```bash
uv run python -m part04.rag_numpy 退款之前已经开了发票怎么办
```

真实输出:

```text
问:退款之前已经开了发票怎么办
检索到:
  0.795  kb-003#2  如何申请退款 > 已经开了发票怎么办
  0.669  kb-007#1  修改发票抬头 > 开错了怎么办
  0.663  kb-006#2  发票类型与开具 > 怎么申请
  0.647  kb-003#1  如何申请退款 > 操作步骤
  引用了 ['kb-003#2#1', 'kb-003#2#2'],不在资料里的 ['kb-003#2#1', 'kb-003#2#2']
答:如果订单已经开具发票，需要先申请发票红冲（作废），红冲完成后才能退款。[kb-003#2#1]

电子普通发票红冲一般当天完成；增值税专用发票需要你方配合退回或开具红字信息表。[kb-003#2#2]
--- 1 次调用 | 输入 373 / 输出 62 tokens | 约 ¥0.0010
```

内容是对的,出处却是编的。资料里只有 `kb-003#2`,模型想说得更精确一点,自己在后面加了 `#1`、`#2`,意思大概是「这一块的第 1 句、第 2 句」。`kb-003#2#1` 在 `chunks.json` 里根本不存在,前端要是拿它去查原文,一块也查不到。好在 `check_citations` 把两个都抓了出来。

这不是偶然:我用同样的 prompt 又跑了几次,每次都是 `#2#1`、`#2#2`。怎么在 prompt 里治它,是明天 Day 227 第一件事。今天先说另一件事:我第一版的检查根本没抓到它。

## 故意踩坑:引用检查自己也会骗人

我写的第一版 `check_citations` 用的正则是 `r"kb-\d{3}#\d+"`,意思是「`kb-` 加三位数字加 `#` 加数字」。看着很严谨,形状和我们的编号一模一样。上面那次回答,第一版的对账结果是:

```text
  引用了 ['kb-003#2'],不在资料里的 []
```

全部合法。问题出在正则只要求**找到**这个形状,不要求它是**完整的一个出处**。`[kb-003#2#1]` 里面恰好包含 `kb-003#2`,正则匹配到这一截就收工了,后面的 `#1` 被无声地丢掉。把这件事单独拿出来演示,新建 `part04/cite_naive.py`,回答直接用上面那次实跑的原文,不用再调模型:

```python
# agent-zero-lab/part04/cite_naive.py
import re

reply = "如果订单已经开具发票，需要先申请发票红冲（作废），红冲完成后才能退款。[kb-003#2#1]"
given = {"kb-003#2", "kb-007#1", "kb-006#2", "kb-003#1"}

naive = re.findall(r"kb-\d{3}#\d+", reply)
print("粗糙版找到:", naive, "都在资料里吗:", all(x in given for x in naive))

whole = re.findall(r"\[([^\[\]]+)\]", reply)
print("整个方括号:", whole, "都在资料里吗:", all(x in given for x in whole))
```

<div class="line-notes">

- `reply = "如果订单已经开具发票` 上面实跑回答的第一句,一字没改。
- `given = {"kb-003#2", "kb-007#1", "kb-006#2", "kb-003#1"}` 那次检索实际给模型的 4 块。
- `naive = re.findall(r"kb-\d{3}#\d+", reply)` `\d{3}` 是正好三位数字,`\d+` 是一位或多位数字。它在 `kb-003#2#1` 里找到了 `kb-003#2`,然后在剩下的 `#1]` 里找不到第二个,结束。
- `all(x in given for x in naive)` `all` 在每一项都为真时返回 `True`,相当于 JS 的 `arr.every(...)`。
- `whole = re.findall(r"\[([^\[\]]+)\]", reply)` 正式版的写法:先把方括号里的**整段**拿出来,再判断这一整段是不是一个合法编号。

</div>

```bash
uv run python -m part04.cite_naive
```

真实输出:

```text
粗糙版找到: ['kb-003#2'] 都在资料里吗: True
整个方括号: ['kb-003#2#1'] 都在资料里吗: False
```

粗糙版报告「都合法」,正式版报告「不合法」。检查代码本身写错了,比没有检查更糟:你会以为引用没问题,放心地去看别处。

教训有两条。一是**校验要按「整体」比,不要按「形状」找**:先确定边界(这里是一对方括号),把边界里的东西整个拿出来,再和白名单(这次给的块编号)逐个比。二是检查代码也要用坏数据测一遍:我是拿真实的坏回答喂给它才发现的。前端做表单校验也是一个道理,手机号正则不加 `^` 和 `$`,`abc13800138000xyz` 也能通过。

## 再问两个

一个是错误码,一个是资料里没有的:

```bash
uv run python -m part04.rag_numpy 导入流水提示 E1042 怎么办
uv run python -m part04.rag_numpy 你们支持微信支付吗
```

真实输出:

```text
问:导入流水提示 E1042 怎么办
检索到:
  0.727  kb-010#2  错误码 E1042:银行流水导入失败 > 解决办法
  0.714  kb-010#1  错误码 E1042:银行流水导入失败 > 原因
  0.578  kb-011#2  错误码 E1043:文件编码错误 > 解决办法
  0.571  kb-012#2  错误码 E2017:发票识别失败 > 解决办法
  引用了 ['kb-010#1', 'kb-010#2'],不在资料里的 []
答:E1042 表示文件的列名和模板不匹配，或者日期列的格式不是 YYYY-MM-DD；最常见的情况是 Excel 自动把日期转成了 2026/10/1 这种格式。[kb-010#1]

解决办法：下载最新的导入模板，把日期列的单元格格式设置为「文本」，重新填写日期后再导入。[kb-010#2]
--- 1 次调用 | 输入 345 / 输出 80 tokens | 约 ¥0.0013

问:你们支持微信支付吗
检索到:
  0.595  kb-016#1  账号安全与两步验证 > 两步验证
  0.550  kb-002#4  退款政策 > 审批与到账
  0.548  kb-020#1  多币种记账 > 支持范围
  0.538  kb-013#2  错误码 E3001:支付失败 > 解决办法
  引用了 ['kb-002#4', 'kb-013#2'],不在资料里的 []
答:资料中没有关于是否支持微信支付的信息。目前资料里只提到退款可原路退回支付宝或银行卡 [kb-002#4]，以及支付失败时可改用支付宝支付 [kb-013#2]，未涉及微信支付的支持情况。
--- 1 次调用 | 输入 286 / 输出 50 tokens | 约 ¥0.0010
```

E1042 那道,检索前两名正好是同一篇的「解决办法」和「原因」,E1043 排第三,Day 222 埋的「两个错误码只差一位」这次没踩中。模型两句话分别引了两块,对账干净。

微信支付那道,模型说了「资料中没有」,没编出「支持微信支付」。但它的说法是自己发挥的,下次可能换成「未找到相关说明」「无法回答」,程序很难稳定地认出「这是一次拒答」;它还顺手引用了两块讲支付宝的资料,用户看了可能以为「不支持微信,但支持支付宝付款」,而帮助中心并没说过支付宝能用来付款,只说了退款原路退回支付宝。今天的两句 prompt 管不到这些,明天专门处理。

## 动手练习

**练习 1:k 取 1、2、4、8 各跑一次。** 问一个跨两块的问题「退款之前开了发票要怎么处理?退款多久能到支付宝?」,对每个 k 打印输入 token、花费、回答里有没有「红冲」和「1 到 3 个工作日」、引用和对账结果。k=1 时把回答原文也打出来。

<details><summary>参考答案</summary>

新建 `part04/ex_k.py`:

```python
# agent-zero-lab/part04/ex_k.py
from part04.rag_numpy import build_messages, check_citations, client, search

question = "退款之前开了发票要怎么处理?退款多久能到支付宝?"
for k in [1, 2, 4, 8]:
    chunks = [c for c, _ in search(question, k)]
    r = client.chat(build_messages(question, chunks), temperature=0)
    cited, unknown = check_citations(r.content, chunks)
    print(f"k={k}  输入 {r.prompt_tokens:>3} token  ¥{r.cost:.4f}  红冲:{'红冲' in r.content}  "
          f"到账:{'1 到 3 个工作日' in r.content}  引用 {cited}  不在资料里 {unknown}")
    if k == 1:
        print("   k=1 的回答:", r.content.replace("\n", " "))
print("---", client.ledger)
```

<div class="line-notes">

- `from part04.rag_numpy import build_messages, check_citations, client, search` 连 `client` 也拿过来,这样最后的 `client.ledger` 能看到这 4 次的合计。
- `chunks = [c for c, _ in search(question, k)]` 每个 k 重新检索一次。检索结果的前几名是一样的,k 只决定取到第几名为止。
- `r.prompt_tokens:>3` 输入 token 数,右对齐占 3 格。同一行的 `'红冲' in r.content` 是字符串的「包含子串」,相当于 JS 的 `includes`。这是一个很粗的判断方法,够看出有没有答到这一半。
- `r.content.replace("\n", " ")` 回答里的换行换成空格,打印成一行。
- 一行太长时,两个 f-string 挨着写会自动拼成一个,Python 的老特性,相当于 JS 里用 `+` 连两个模板字符串。

</div>

```bash
uv run python -m part04.ex_k
```

真实输出:

```text
k=1  输入 139 token  ¥0.0007  红冲:False  到账:True  引用 ['kb-002#4']  不在资料里 []
   k=1 的回答: 关于发票的处理方式，<资料>中没有相关信息，我无法回答。  关于退款到账时间：所有退款都需要客服主管审批后执行，审批通过后原路退回，支付宝 1 到 3 个工作日到账 [kb-002#4]。
k=2  输入 215 token  ¥0.0011  红冲:True  到账:True  引用 ['kb-003#2', 'kb-002#4']  不在资料里 []
k=4  输入 374 token  ¥0.0011  红冲:True  到账:True  引用 ['kb-003#2', 'kb-002#4']  不在资料里 []
k=8  输入 658 token  ¥0.0010  红冲:True  到账:True  引用 ['kb-003#2#1', 'kb-002#4#1']  不在资料里 ['kb-003#2#1', 'kb-002#4#1']
--- 4 次调用 | 输入 1386 / 输出 303 tokens | 约 ¥0.0039
```

k=1 只拿到「审批与到账」,发票那一半老实说了没有,这是**检索漏了**,不是资料里真没有。k=2 和 k=4 两半都答到,引用也干净。k=8 输入翻了一倍多,答案没变好,反而又冒出了 `#1` 这种编出来的编号:资料一多,模型越想「精确到句」。花费这一列看着反直觉,k=8 最便宜,是因为前几次调用的开头一样,DeepSeek 的上下文缓存命中了一部分(缓存命中的输入价 0.04 元每百万 token,未命中 2 元,差 50 倍)。我的结论是这类问题 k=2 到 4 最合适,k=1 太冒险。

顺带看一眼检索排名:这个问题的第 1、2 名分数是 0.776 和 0.775,几乎并列,k=1 时谁进来全凭第三位小数。

</details>

**练习 2:把引用变成「来源」列表。** 回答之后,按引用出现的顺序,给每个出处编号,打印出文章标题、小节和正文前 40 个字,像网页回答下面那种「来源 [1] [2]」。编出来的编号要显示成「找不到这一块」。

<details><summary>参考答案</summary>

新建 `part04/ex_sources.py`:

```python
# agent-zero-lab/part04/ex_sources.py
from part04.rag_numpy import CHUNKS, build_messages, check_citations, client, search

BY_ID = {c.id: c for c in CHUNKS}

question = "导入流水提示 E1042 怎么办"
chunks = [c for c, _ in search(question, 4)]
reply = client.chat(build_messages(question, chunks), temperature=0).content
print(reply)

cited, unknown = check_citations(reply, chunks)
print("\n来源:")
for n, cid in enumerate(cited, start=1):
    if cid in BY_ID:
        c = BY_ID[cid]
        body = c.text.split("\n", 1)[1]
        print(f"[{n}] {cid}  {c.title} > {c.section}\n    {body[:40]}…")
    else:
        print(f"[{n}] {cid}  ⚠ 找不到这一块")
```

<div class="line-notes">

- `BY_ID = {c.id: c for c in CHUNKS}` 字典推导式:块编号 → 块,42 项。按编号查块时不用每次遍历列表,相当于 JS 里 `Object.fromEntries(chunks.map(c => [c.id, c]))`。
- `reply = client.chat(` 只要返回结果的 `.content`,也就是正文。
- `for n, cid in enumerate(cited, start=1):` 按引用第一次出现的顺序编号。`check_citations` 用列表而不是集合,就是为了这里的顺序。
- `if cid in BY_ID:` 字典的 `in` 判断键在不在。编出来的编号不在。
- `body = c.text.split("\n", 1)[1]` 去掉第一行的「标题 > 小节」前缀,只留正文(Day 224 练习 2 的写法)。
- `print(f"[{n}] {cid}  ⚠ 找不到这一块")` 真做界面时,这种出处不该渲染成链接。

</div>

```bash
uv run python -m part04.ex_sources
```

真实输出:

```text
E1042 表示文件的列名和模板不匹配，或者日期列的格式不是 YYYY-MM-DD；最常见的情况是 Excel 自动把日期转成了 2026/10/1 这种格式。[kb-010#1]

解决办法：下载最新的导入模板，把日期列的单元格格式设置为「文本」，重新填写日期后再导入。[kb-010#2]

来源:
[1] kb-010#1  错误码 E1042:银行流水导入失败 > 原因
    E1042 表示文件的列名和模板不匹配,或者日期列的格式不是 YYYY-MM-D…
[2] kb-010#2  错误码 E1042:银行流水导入失败 > 解决办法
    下载最新的导入模板,把日期列的单元格格式设置为「文本」,重新填写日期后再导入。…
```

这就是 Perplexity 那类产品「回答 + 来源卡片」的雏形。前端拿到 `cited` 列表和 `BY_ID`,就能在回答下面渲染两张卡片,点开看原文。用 `BY_ID` 查而不是只在这次的 `chunks` 里查,是因为原文展示要能显示任何一块;判断「合不合法」时才用这次给的 `chunks`,两件事别混。

</details>

**练习 3(观察题):不要求标出处会怎样?** 把 `SYSTEM` 里「每一个事实性的句子后面……」那句去掉,问「年付专业版用到第 3 个月想退,能退多少」,看回答里还有没有引用。不要改 `rag_numpy.py` 文件本身。

<details><summary>参考答案</summary>

新建 `part04/ex_no_cite.py`:

```python
# agent-zero-lab/part04/ex_no_cite.py
from part04 import rag_numpy
from part04.rag_numpy import build_messages, check_citations, client, search

rag_numpy.SYSTEM = "你是云簿 CloudLedger 的客服助手。只根据 <资料> 里的内容回答用户问题。"

question = "年付专业版用到第 3 个月想退,能退多少"
chunks = [c for c, _ in search(question, 4)]
reply = client.chat(build_messages(question, chunks), temperature=0).content
print(reply)
print("引用:", check_citations(reply, chunks)[0])
```

<div class="line-notes">

- `from part04 import rag_numpy` 把整个模块对象拿过来,下一行才能改它里面的变量。
- `rag_numpy.SYSTEM = "你是云簿 CloudLedger 的客服助手。只根据 <资料> 里的内容回答用户问题。"` 改的是**模块对象上的属性**。`build_messages` 每次被调用时才去读 `SYSTEM`,读到的就是新值。如果写成 `from part04.rag_numpy import SYSTEM` 再给 `SYSTEM` 赋值,改的只是你这个文件里的一个同名变量,`build_messages` 看不到。这个区别和 [Day 32](/blog/agent-zero/day-032-modules/) 讲的 `import` 是一回事。
- `check_citations(reply, chunks)[0]` 只看第一个返回值,引用了哪些。

</div>

```bash
uv run python -m part04.ex_no_cite
```

真实输出:

```text
根据退款政策,年付专业版 468 元,折合每月 39 元。在第 3 个月中途取消,前 2 个月加当月共 3 个月不退,退剩余 9 个月,即 **351 元**。

退款申请可进入「设置 → 订阅 → 申请退款」,选择退款原因并提交,客服主管会在 1 个工作日内审批。
引用: []
```

答案还是对的,还多给了申请路径,但一个出处都没标。模型不会主动标,你要它标、而且告诉它怎么标(方括号、照抄编号、举一个例子),它才标。没有引用的回答,用户核对不了,出了错你也分不清是检索的锅还是生成的锅。另外注意它加了 `**351 元**` 的 Markdown 加粗,如果你的界面不渲染 Markdown,用户会看到两对星号,这也是 prompt 里「回答格式」该写清楚的一条。

</details>

**练习 4:默写 `search` 和 `check_citations`。** 合上文章写出这两个函数,然后用下面三段回答测 `check_citations`,给的块是 `kb-002#1`、`kb-003#1`:`"可以退 [kb-002#1]。"`、`"可以退 [kb-002#1, kb-003#1]。"`、`"可以退 [kb-002#1#1]。"`。

<details><summary>参考答案</summary>

标准答案就是 `rag_numpy.py` 里的两个函数。测试可以直接在命令行跑,`Chunk` 用最少的字段手工建两个:

```bash
uv run python -c "
from part04.chunking import Chunk
from part04.rag_numpy import check_citations
cs = [Chunk('kb-002#1', 'kb-002', 't', 'c', 's', 'x'), Chunk('kb-003#1', 'kb-003', 't', 'c', 's', 'x')]
for r in ['可以退 [kb-002#1]。', '可以退 [kb-002#1, kb-003#1]。', '可以退 [kb-002#1#1]。']:
    print(check_citations(r, cs))
"
```

真实输出:

```text
(['kb-002#1'], [])
(['kb-002#1', 'kb-003#1'], [])
(['kb-002#1#1'], ['kb-002#1#1'])
```

第二段说明切分逗号那一步起作用了,第三段说明整段比较那一步起作用了。默写 `search` 最常见的错是 `np.argsort(scores)[:k]` 忘了负号,拿到的是**最不像**的 k 块;用 `topk_scores.py` 的输出对一下第 1 名是不是 0.839 的 `kb-002#1` 就能发现。`check_citations` 最常见的错是把 `cited` 写成集合,对账结果对,但练习 2 的来源编号顺序会乱。

`Chunk('kb-002#1', 'kb-002', 't', 'c', 's', 'x')` 是按位置传参,顺序就是 dataclass 里字段的定义顺序 `id, doc_id, title, category, section, text`。

</details>

**验收标准:** `topk_scores.py` 三个问题的第 1 名和本文一致或接近,能说出「微信支付」那张表说明了什么;`prompt_preview.py` 能打印出带 `<doc id=...>` 的完整 prompt;`rag_numpy.py` 能答出 351 元并带 `[kb-002#1]`;`cite_naive.py` 能复现「粗糙版说合法、正式版说不合法」;能解释 top-k 为什么永远返回 k 个、引用有哪两个用处。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| top-k | 按分数从高到低取前 k 个。检索返回 top-k 块,k 常取 3 到 8 |
| `np.argsort(a)` | 返回把 `a` 从小到大排好需要的下标顺序;`np.argsort(-a)` 是从大到小 |
| 检索 / 增强 / 生成 | RAG 的三段:找块、把块拼进 prompt、让模型照着答 |
| `<doc>` 标签 | 我们给每块资料包的一层标记,`id`、`title` 写在属性上,方便模型分清和照抄 |
| 引用(citation) | 回答里标明某句话出自哪块资料,如 `[kb-002#1]` |
| 引用检查 | 把回答里的出处抠出来,和这次实际给的块编号比,找出编出来的 |
| 编造的出处 | 模型写出的、不在资料里的编号,今天实测的是 `[kb-003#2#1]` |
| 正则分组 `( )` | 正则里用圆括号圈出的一段,`re.findall` 只返回分组里的内容 |
| `re.compile` | 把正则预编译成对象反复使用,相当于把 JS 的 `/.../` 存成常量 |

## 常见误区

**以为检索结果都相关。** top-k 永远返回 k 块。「你们支持微信支付吗」第 1 名是「两步验证」,0.595。分数低是信号,但没有固定的分界线,相关性要靠 prompt 让模型判断,再靠评估集验证。

**`argsort` 忘了负号。** `np.argsort(scores)[:k]` 拿到的是最不像的 k 块,程序不报错,模型会说资料里没有。检索结果先打印出来看第 1 名。

**k 越大越保险。** 实测 k=8 输入 658 token,是 k=2 的三倍,答案没变好,还冒出了编造的出处。k=1 又会漏掉跨块问题的一半。从 4 起步,用评估集定。

**只看回答不看 prompt。** 很多「模型答错了」其实是检索拿错了块。调 RAG 时先把拼好的 prompt 打出来,`prompt_preview.py` 这种脚本值得常备。

**引用检查按形状找。** `r"kb-\d{3}#\d+"` 在 `[kb-003#2#1]` 里找到 `kb-003#2` 就说合法。先按方括号拿整段,再和白名单整体比较。检查代码也要喂一次坏数据。

**不要求就指望模型标出处。** 练习 3 去掉那句,回答一个引用都没有。要它标、告诉它格式、给一个例子。

**引用合法就等于答对了。** 对账只证明出处是这次给的块之一,不证明那块真的支持这句话。「出处对得上、内容对不对」要等 Day 260 让模型当裁判来判。

## 学习资料

### 文档与文章

- [Pinecone · Retrieval-Augmented Generation](https://www.pinecone.io/learn/retrieval-augmented-generation/):把检索、增强、生成三段讲得很清楚的一篇入门长文,读讲「augmentation」怎么拼 prompt 的部分,对照今天的 `build_messages`。
- [NumPy 文档 · numpy.argsort](https://numpy.org/doc/stable/reference/generated/numpy.argsort.html):看示例里二维数组按行排序的写法,Day 218 的相似度矩阵也能这样一次取每行的 top-k。
- [Anthropic · Introducing Citations](https://claude.com/resources/articles/introducing-citations-api):Anthropic 把「回答带出处」做成了 API 的一个功能,模型返回的引用直接指向你给的文档里的具体句子。看它为什么要专门做这个功能:提示词让模型自己标,就会出现今天的 `#2#1`。
- [Lost in the Middle(论文)](https://arxiv.org/abs/2307.03172):资料放在长 prompt 中间时模型用得最差。读摘要和第一张图,k 很大时它就是你要担心的事。
- [Python 文档 · re](https://docs.python.org/zh-cn/3.12/library/re.html):查「分组」和 `re.findall` 有分组时返回什么那一段。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1wc3izUEUb&autoplay=0&high_quality=1" title="使用Python构建RAG系统 —— 用代码还原 RAG系统的每个细节" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>马克的技术工作坊 · 使用Python构建RAG系统 —— 用代码还原 RAG系统的每个细节 · 17 分钟。不用框架,从切块、编码、检索一路写到拼 prompt 调模型,和我们这四天做的事几乎一一对应,看完能把整条线串起来。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1KC8y62Exb&autoplay=0&high_quality=1" title="面试官追问:企业RAG如何实现答案附带文档来源、页码?元数据绑定 + 后置校验,规避假溯源完整回答思路" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>跟着扶安学AI · 面试官追问:企业RAG如何实现答案附带文档来源、页码? · 8 分钟。从面试角度讲引用:元数据跟着块走、回答后再校验出处,就是今天 `Chunk` 字段和 `check_citations` 的思路。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/wd7TZ4w1mSw" title="RAG From Scratch: Part 1 (Overview)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · RAG From Scratch: Part 1 (Overview) · 英文,几分钟。LangChain 工程师 Lance Martin 的系列第一集,讲 indexing、retrieval、generation 三段,和 Day 221 的两条流水线是同一张图。系列后面讲 query 改写、rerank,Day 238 起会用到。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/sVcwVQRHIc8" title="Learn RAG From Scratch – Python AI Tutorial from a LangChain Engineer" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>freeCodeCamp.org · Learn RAG From Scratch – Python AI Tutorial from a LangChain Engineer · 英文,两个多小时,是上面那个系列的合集版。今天只看开头 Overview、Indexing、Retrieval、Generation 四段。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)。第 6 章「RAG and Agents」讲 retrieval 的部分,今天读「检索出来的结果怎么交给模型」那几页。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly,2024),中文版《图解大模型:生成式AI原理与实践》(人民邮电出版社,2025)。第 8 章「Semantic Search and Retrieval-Augmented Generation」后半讲 RAG 和带引用的生成,有图。

### 开源项目与代码

- [langchain-ai/rag-from-scratch](https://github.com/langchain-ai/rag-from-scratch):上面视频的配套笔记本,第一本就是最小 RAG。对照看框架版的 retriever 和我们的 `search()` 有什么不同。
- [datawhalechina/all-in-rag](https://github.com/datawhalechina/all-in-rag):中文 RAG 教程,看它「生成集成」那一章里 prompt 模板怎么写,和今天的两句 `SYSTEM` 对比。

## 自测

**1. `np.argsort(-scores)[:4]` 返回的是什么?为什么前面有个负号?**

<details><summary>答案</summary>

返回分数最高的 4 个**行号**,不是分数本身。`argsort` 默认从小到大排,对 `-scores` 排就等于对 `scores` 从大到小排。漏了负号拿到的是最不像的 4 块,不报错。拿到行号以后要去 `CHUNKS[i]` 取块、去 `scores[i]` 取分数。

</details>

**2. 问「你们支持微信支付吗」,帮助中心里没有,检索会返回几块?说明了什么?**

<details><summary>答案</summary>

k=4 就返回 4 块,今天实测第 1 名是「两步验证」0.595。top-k 只排序不判断相关,永远凑满 k 个。分数比正常问题的第 1 名低,但没有一条固定的线能把相关和不相关分开(有的问题第 8 名都有 0.628)。所以 prompt 里要告诉模型资料可能不相关,没有就说没有,明天细讲。

</details>

**3. 为什么每块要包一层 `<doc id="..." title="...">`,而不是直接把正文一段段拼起来?**

<details><summary>答案</summary>

一是让模型分清哪里是资料、哪里是问题,以及一块在哪里结束、下一块从哪里开始(Day 143 的标签分隔)。二是把编号写在标签上,模型标出处时有现成的东西照抄,我们对账时也有白名单可比。`title` 让模型知道这一块出自哪篇文章,虽然块的 `text` 开头已经有「标题 > 小节」前缀,放在属性上更显眼。

</details>

**4. `check_citations` 为什么先匹配整个方括号再切分,而不是直接 `re.findall(r"kb-\d{3}#\d+", reply)`?**

<details><summary>答案</summary>

直接按形状找会在 `[kb-003#2#1]` 里找到 `kb-003#2`,把编造的出处当成合法的,今天实跑就发生了。先按方括号拿到完整的一段,再按逗号、顿号切开,每段整体和这次给的块编号比较,`kb-003#2#1` 不在白名单里就会被抓出来。

</details>

**5. 面试题:「你的 RAG 回答里的引用是怎么做的?怎么保证引用是对的?」**

<details><summary>答案</summary>

做法:每块资料在 prompt 里包进带唯一编号的标签,system 里要求每个事实句后面用方括号照抄编号,并给一个例子。回答回来以后做两层检查。第一层是格式和合法性:按方括号抽出出处,逐个和这次实际放进 prompt 的块编号比,不在里面的就是编造的,记日志,前端不渲染成链接;实测模型会自己加 `#1` 这种子编号,要在 prompt 里明确禁止。第二层是支持度:出处合法不代表那块真支持这句话,要在评估集上用 LLM 当裁判或人工抽查,判断「这句话能不能从这块推出来」。

再补一句为什么要引用:对用户可核对,对工程是排错线索,出问题时能分清是检索拿错了还是生成答错了。如果用的是 Anthropic 这类有原生 Citations 功能的 API,可以直接用,它返回的出处结构化地指向原文片段,比让模型在文本里写编号可靠。

</details>

## 明天预告

明天是 [Day 227 · RAG 的 prompt 讲究,和什么时候不用 RAG](/blog/agent-zero/day-227-rag-prompt/)。今天的两句 `SYSTEM` 留下了三个尾巴:模型发明 `[kb-003#2#1]`、资料里没有时说法五花八门、拒答时还顺手引一堆不相干的资料。明天把 `SYSTEM` 一句一句补全,用一组拒答测试量出改前改后的差别,最后讲哪些情况根本不该用 RAG。
