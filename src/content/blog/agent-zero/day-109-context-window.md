---
title: 'Day 109 · 上下文窗口:模型能看到的全部世界'
description: '窗口是一次调用里输入加输出能装下的 token 上限。今天用分词器量出《西游记》整本 64 万个 token,故意超窗口拿到 API 的真实报错,再写一个丢掉最早消息、保住系统提示词的截断函数,最后讲为什么 1M 窗口不等于 1M 都能用好。'
pubDate: 2026-10-22
regime: none
tags: ['llm-basics', 'context-window', 'python', 'agent-zero']
series: 'agent-zero'
day: 109
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 108](/blog/agent-zero/day-108-tokens-2/) 装上了 `tokenizers` 和 `tiktoken`,用 DeepSeek 的真实分词器数出中文每字 0.62 个 token、英文每字符 0.22 个、订单号每字符 0.47 个;还对比了三家分词器,发现「中文费 token」要看是谁的分词器。最后看到本地数出来的数和 API 返回的 `prompt_tokens` 只差 4 个固定的格式开销。

会数 token 了,就能拿它量一样更要紧的东西:模型一次最多能看多少 token。这个上限就是上下文窗口。它决定了你能给模型塞多少资料、一段对话能聊多久、Agent 能跑多少步。今天把它量清楚,并写出第一个「装不下怎么办」的处理函数。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清楚上下文窗口是什么,为什么输入和输出要共用它,以及为什么模型「没有记忆」。
2. 用分词器算出一本书要多少 token、占 DeepSeek 1M 窗口的多少,并看懂超出窗口时 API 返回的报错。
3. 写一个截断函数:对话太长时从最早的消息开始丢,但系统提示词永远保留。
4. 说出「窗口大不等于都能用好」的三个原因,并能在面试里讲清楚。

预计用时:2.5 小时左右。前置:[Day 106](/blog/agent-zero/day-106-next-token/) 的自回归生成、[Day 108](/blog/agent-zero/day-108-tokens-2/) 的 `count_tokens.py` 和 DeepSeek 分词器、[Day 21](/blog/agent-zero/day-021-lists/) 的列表操作。

学法提示:先对照文章把每个脚本逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,把 `trim_history.py` 里的 `trim` 函数默写出来;然后做动手练习,做不出来再展开参考答案,看完关掉,自己重写一遍。

## 窗口是什么

先用前端的经验打个比方。你调一个后端接口,请求体有大小限制,超过了网关直接回你 413。上下文窗口就是大模型接口的「请求体上限」,只不过单位是 token,而且有一个特别之处:**模型的回答也要算在这个上限里**。

为什么输出也要占窗口?回想 [Day 106](/blog/agent-zero/day-106-next-token/) 的自回归:模型每生成一个 token,就把它接到输入末尾,再算下一个。生成到第 500 个 token 时,模型眼前是「你的全部输入 + 它已经写出的 499 个 token」。所以窗口要装下的是输入加上整个输出过程。你调 API 时设的 `max_tokens`(最多输出多少 token,Day 121 详讲)也要从窗口里预留出来。

2026 年 10 月查 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing),`deepseek-flash` 和 `deepseek-v4-pro` 的上下文长度都是 1M,最大输出 384K。1M 不是一百万整,下面那个真实报错会告诉你,它是 1,048,576,也就是 2 的 20 次方。顺手对比一下 [Claude 的模型概览](https://platform.claude.com/docs/en/about-claude/models/overview),当前四个模型也都是 1M 窗口,最大输出 128K。一两年前主流还是 128K,现在 1M 已经是旗舰模型的标配。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="一次调用的上下文窗口里装着系统提示词、历史消息、本轮提问和预留给输出的空间">
<rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink-faint)">一次调用 = 一个窗口(DeepSeek: 1,048,576 token)</text>
<rect x="20" y="44" width="600" height="44" rx="4" fill="none" stroke="var(--ink-soft)"/>
<rect x="22" y="46" width="70" height="40" fill="var(--mem-wash)"/>
<text x="57" y="70" text-anchor="middle" fill="var(--ink)">system</text>
<rect x="94" y="46" width="250" height="40" fill="var(--compute-wash)"/>
<text x="219" y="70" text-anchor="middle" fill="var(--ink)">历史消息(每轮重发)</text>
<rect x="346" y="46" width="90" height="40" fill="var(--mem-wash)"/>
<text x="391" y="70" text-anchor="middle" fill="var(--ink)">本轮提问</text>
<rect x="438" y="46" width="180" height="40" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="528" y="70" text-anchor="middle" fill="var(--ink-soft)">预留给输出</text>
<line x1="22" y1="104" x2="436" y2="104" stroke="var(--ink-soft)"/>
<text x="229" y="122" text-anchor="middle" fill="var(--ink-soft)">输入:prompt_tokens</text>
<line x1="438" y1="104" x2="618" y2="104" stroke="var(--ink-soft)"/>
<text x="528" y="122" text-anchor="middle" fill="var(--ink-soft)">输出:≤ max_tokens</text>
<text x="20" y="160" fill="var(--ink-faint)">输入 + max_tokens 超过窗口 → API 直接返回 400,一个 token 都不生成</text>
<text x="20" y="182" fill="var(--ink-faint)">窗口外的内容,对这次调用的模型来说不存在</text>
</g>
</svg>
<figcaption>窗口里装的东西。历史消息每一轮都要重新发一遍,所以它是窗口里涨得最快的那一段。</figcaption>
</figure>

## 模型没有记忆,窗口就是全部

这是今天最重要的一句话,也是很多人用了一年 ChatGPT 都没意识到的事:**模型本身不记得你之前说过什么。**

API 是无状态的,和你熟悉的 REST 接口一样,每次请求都是独立的,服务端不替你保存对话。你在聊天界面里和它聊了 20 轮,第 21 轮它还「记得」你第 1 轮说的名字,是因为聊天程序在第 21 次调用时,把前 20 轮的全部消息又打包发了一遍。前端同学可以这样想:就像一个没有 session 的后端,前端每次请求都把整个 Redux store 序列化塞进请求体。

由此直接推出两件事。第一,对话越长,每一轮发出去的 token 越多,窗口迟早会满。第二,一旦为了不超窗口而把某条早期消息删掉,模型就**真的不知道**那条消息里的内容了,不是「记得模糊」,是完全不存在。后面写截断函数时你会亲眼看到这个后果。

## 一本书要多少 token

「1M token」到底是多大?换成具体的东西量一量。古登堡计划(Project Gutenberg)有大量版权已过期的书,可以免费下载纯文本。我们下三本:英文的《爱丽丝漫游奇境》《傲慢与偏见》,中文的《西游记》(古登堡上的是繁体版)。在 `agent-zero-lab` 目录下:

```bash
mkdir -p data/books
curl -L -o data/books/pg11.txt https://www.gutenberg.org/cache/epub/11/pg11.txt
curl -L -o data/books/pg1342.txt https://www.gutenberg.org/cache/epub/1342/pg1342.txt
curl -L -o data/books/pg23962.txt https://www.gutenberg.org/cache/epub/23962/pg23962.txt
ls -l data/books
```

下载下来分别约 170 KB、770 KB、2.2 MB。我这台机器访问 `www.gutenberg.org` 时 curl 报了 TLS 证书校验失败(这是我所在网络环境的问题,不是网站的问题),把域名换成镜像 `gutenberg.pglaf.org` 就下好了,路径不变,比如 `https://gutenberg.pglaf.org/cache/epub/11/pg11.txt`。你遇到下载失败也可以这么换。

古登堡的文本开头和结尾有一段英文版权说明,用 `*** START OF THE PROJECT GUTENBERG EBOOK ...` 和 `*** END OF ...` 两行标出正文范围。我们只数正文。新建 `part02/book_tokens.py`:

```python
# agent-zero-lab/part02/book_tokens.py
from pathlib import Path

from tokenizers import Tokenizer

tok = Tokenizer.from_file("data/deepseek_v4_tokenizer/tokenizer.json")
WINDOW = 1_000_000
PRICE_PER_M = 2.0

BOOKS = {
    "爱丽丝漫游奇境": "data/books/pg11.txt",
    "傲慢与偏见": "data/books/pg1342.txt",
    "西游记": "data/books/pg23962.txt",
}


def body(text: str) -> str:
    start = text.find("*** START")
    end = text.find("*** END")
    start = text.find("\n", start) + 1
    return text[start:end]


for name, file in BOOKS.items():
    text = body(Path(file).read_text(encoding="utf-8"))
    n = len(tok.encode(text, add_special_tokens=False).ids)
    print(
        f"{name}: {len(text):,} 字符, {n:,} token, "
        f"每字符 {n / len(text):.2f}, 占 1M 窗口 {n / WINDOW:.1%}, "
        f"整本发一次 ¥{n / 1_000_000 * PRICE_PER_M:.2f}"
    )
```

<div class="line-notes">

- `tok = Tokenizer.from_file("data/deepseek_v4_tokenizer/tokenizer.json")` 和 Day 108 一样的 DeepSeek 分词器。
- `WINDOW = 1_000_000` 先按「一百万」粗算,下一节会看到精确值是 1,048,576。
- `PRICE_PER_M = 2.0` `deepseek-flash` 高峰时段、未命中缓存的输入价,2 元每百万 token(2026 年 10 月)。
- `BOOKS = {` 书名 → 文件路径。
- `def body(text: str) -> str:` 只取正文,去掉古登堡的版权头尾。
- `start = text.find("*** START")` `.find` 返回子串第一次出现的位置,找不到返回 `-1`,相当于 JS 的 `indexOf`。《西游记》文件里这一行在第 26 行。
- `end = text.find("*** END")` 结尾标记的位置,《西游记》在第 27156 行。
- `start = text.find("\n", start) + 1` 从 START 那一行往后找第一个换行,`+1` 跳到下一行开头,这样 START 那一整行也不算进正文。
- `return text[start:end]` 切片取出中间的正文。
- `text = body(Path(file).read_text(encoding="utf-8"))` 读整本书。2.2 MB 的文件一次读进内存完全没问题。
- `n = len(tok.encode(text, add_special_tokens=False).ids)` 整本书一次编码。三本书加起来在我的 2019 款 Intel MacBook 上跑了大约 10 秒,大部分时间花在《西游记》上。
- `f"{name}: {len(text):,} 字符, {n:,} token, "` `:,` 表示加千分位逗号,`639105` 显示成 `639,105`。几行 f-string 挨着写会自动拼成一个字符串(Day 108 练习 2 讲过)。
- `f"每字符 {n / len(text):.2f}, 占 1M 窗口 {n / WINDOW:.1%}, "` `:.1%` 是乘以 100、保留一位小数、加百分号。
- `f"整本发一次 ¥{n / 1_000_000 * PRICE_PER_M:.2f}"` 把整本书当输入发一次的费用。《西游记》:639,105 ÷ 1,000,000 × 2 = 1.278 元,显示 `¥1.28`。

</div>

```bash
uv run part02/book_tokens.py
```

实跑输出:

```text
爱丽丝漫游奇境: 144,604 字符, 37,915 token, 每字符 0.26, 占 1M 窗口 3.8%, 整本发一次 ¥0.08
傲慢与偏见: 728,750 字符, 171,814 token, 每字符 0.24, 占 1M 窗口 17.2%, 整本发一次 ¥0.34
西游记: 758,186 字符, 639,105 token, 每字符 0.84, 占 1M 窗口 63.9%, 整本发一次 ¥1.28
```

一本《爱丽丝》不到 4 万个 token,1M 窗口能放二十多本。一本《傲慢与偏见》17 万个,能放五六本。《西游记》一本就是 64 万个,占掉六成多的窗口。

《西游记》每字 0.84 个 token,比 Day 108 测的现代中文 0.62 高不少。原因有两个:古登堡这版是繁体字,Day 108 练习 1 看到过繁体「發票」比简体「发票」多一个 token,繁体在 DeepSeek 的训练语料里比简体少;另外它是明代白话加大量诗词,很多词组在现代语料里不常见,合不成整块。所以「一个汉字 0.6 个 token」这个经验值只对现代简体中文大致成立。

换个角度看这几个数字:**一个 1M 窗口,大约能装下一本半《西游记》,或者五六本普通长篇英文小说**。这比大多数人想象的大得多,也是为什么现在有人会说「把整个知识库塞进去就行,不用做检索了」。这句话哪里有问题,本课最后一节讲。

## 装不下会怎样

把《西游记》的文件内容重复两遍,当成一条消息发给 API,输入肯定超过 1M。这一步要调 API,而这门课在 [Day 120](/blog/agent-zero/day-120-api-register/) 才注册拿 key,**这段你现在不用跑**,看我的实跑结果:我用 `deepseek-flash`、`max_tokens=1` 发了这个请求,openai SDK 抛出的异常原文是:

```text
BadRequestError Error code: 400 - {'error': {'message': "This model's maximum context length is 1048576 tokens. However, you requested 1286645 tokens (1286644 in the messages, 1 in the completion). Please reduce the length of the messages or completion. (request_id: 4fc9802a-5f1e-479d-ae99-13e368755bcc)", 'type': 'invalid_request_error', 'param': None, 'code': 'invalid_request_error'}}
```

逐段读一下这条报错,以后你会经常见到它的各种变体:

- `Error code: 400` 是 HTTP 状态码,[Day 60](/blog/agent-zero/day-060-http-2/) 学过,4 开头表示「你的请求有问题」,不是服务器坏了。重试没用,必须改请求。
- `maximum context length is 1048576 tokens` 窗口精确值是 1,048,576。
- `you requested 1286645 tokens (1286644 in the messages, 1 in the completion)` 它把你要的总量拆成了两部分:消息里的输入 1,286,644 个,加上你允许的输出 1 个(就是 `max_tokens=1`)。这正说明了上面那句「输出也占窗口」。
- `Please reduce the length of the messages or completion` 解决办法只有两个:输入少放点,或者 `max_tokens` 设小点。

有意思的是 1,286,644 这个数。我用本地分词器数了一下「整个文件内容重复两遍」(这次没去掉版权头尾),得到 1,286,640,再加上 Day 108 测出来的单条消息格式开销 4,正好 1,286,644,一个都不差。也就是说,**不用真的发请求,本地就能提前算出会不会超窗口**。这就是下一节截断函数的基础。

另外,这种被拒的请求不收钱。我在请求前后各查了一次 DeepSeek 账户余额,都是 49.23 元,没有变化。

## 截断:装不下就得丢东西

真实场景里,最先撑爆窗口的通常不是一本书,而是越聊越长的对话和 Agent 一步步累积的工具结果。最朴素的处理办法叫**截断(truncation)**:超出预算时,从最早的消息开始丢,直到装得下为止。

为了在几十个 token 的小例子里就能看到截断发生,我们把窗口假装成只有 120 个 token,其中留 40 个给输出,输入预算就是 80 个。规则和真实场景一模一样,只是数字小。

每条消息的 token 数怎么算?Day 108 测过,单条消息有 4 个格式开销。多条消息时实际开销是多少,我用 API 实测了一下(这段你同样不用跑):把下面这段对话的前 1、2、3、6 条分别发出去,API 返回的输入 token 是 26、49、66、99;只数文字内容是 22、44、58、86;也就是说格式开销分别是 4、5、8、13,平均每条两三个,不是固定的 4。所以下面的代码里每条按 4 个算,这是**故意往多了算**:估多了顶多浪费一点窗口,估少了请求就会被 400 拒掉。

新建 `part02/trim_history.py`:

```python
# agent-zero-lab/part02/trim_history.py
from tokenizers import Tokenizer

tok = Tokenizer.from_file("data/deepseek_v4_tokenizer/tokenizer.json")
WINDOW = 120
RESERVED_FOR_OUTPUT = 40
PER_MESSAGE = 4


def count(msg: dict[str, str]) -> int:
    return len(tok.encode(msg["content"], add_special_tokens=False).ids) + PER_MESSAGE


def total(messages: list[dict[str, str]]) -> int:
    return sum(count(m) for m in messages)


def trim(messages: list[dict[str, str]], budget: int) -> list[dict[str, str]]:
    system, rest = messages[0], messages[1:]
    while rest and count(system) + total(rest) > budget:
        dropped = rest.pop(0)
        print(f"  丢掉最早的一条 {dropped['role']}: {dropped['content'][:12]}…")
    return [system, *rest]


history = [
    {"role": "system", "content": "你是云簿 CloudLedger 的客服,只回答账单和发票问题,不要编造政策。"},
    {"role": "user", "content": "你好,我叫王小明,我的发票 INV-2026-004417 被重复扣款了。"},
    {"role": "assistant", "content": "收到,我先帮您查一下这张发票的扣款记录。"},
    {"role": "user", "content": "好的,另外发票抬头能不能改成公司名?"},
    {"role": "assistant", "content": "可以,请在设置里修改抬头后重新开具。"},
    {"role": "user", "content": "那重复扣的钱什么时候退?"},
]

for i in range(1, len(history) + 1):
    print(f"前 {i} 条: {total(history[:i])} token")

budget = WINDOW - RESERVED_FOR_OUTPUT
print(f"输入预算 = {WINDOW} - {RESERVED_FOR_OUTPUT} = {budget}")
kept = trim(list(history), budget)
print(f"裁剪后 {len(kept)} 条, {total(kept)} token")
for m in kept:
    print(" ", m["role"], m["content"][:20])
```

<div class="line-notes">

- `WINDOW = 120` 假装窗口只有 120 个 token,方便演示。真实值是 1,048,576。
- `RESERVED_FOR_OUTPUT = 40` 给回答预留 40 个,相当于调用时设 `max_tokens=40`。
- `PER_MESSAGE = 4` 每条消息的格式开销,故意按偏多的 4 算,原因见上面正文。
- `def count(msg: dict[str, str]) -> int:` 一条消息的 token 数 = 内容的 token 数 + 开销。消息是 `{"role": ..., "content": ...}` 这样的字典,Day 121 讲 API 请求时会逐字段讲这个格式,今天知道 `role` 是谁说的、`content` 是说了什么就够了。
- `def total(messages: list[dict[str, str]]) -> int:` 一组消息的总数,就是每条的和。
- `system, rest = messages[0], messages[1:]` 第 0 条是系统提示词(`role` 为 `system`,告诉模型它是谁、要守什么规矩),单独拿出来;剩下的是可以丢的对话。
- `while rest and count(system) + total(rest) > budget:` 只要还有可丢的消息、并且总数超预算,就继续丢。`rest and ...` 先判断列表非空,空列表在 Python 里是假值,和 JS 不一样(JS 里 `[]` 是真值),[Day 14](/blog/agent-zero/day-014-bool-none/) 讲过。
- `dropped = rest.pop(0)` 删掉并返回列表第一个元素,相当于 JS 的 `rest.shift()`。最早的消息在最前面,所以丢的是最早的。
- `print(f"  丢掉最早的一条 {dropped['role']}: {dropped['content'][:12]}…")` 打印丢了谁,只显示前 12 个字。f-string 外面用双引号,里面取字典键就要用单引号,否则引号会提前结束字符串(Python 3.12 起其实允许混用,但这样写更不容易看花眼)。
- `return [system, *rest]` 把系统提示词放回最前面。`*rest` 是展开,相当于 JS 的 `[system, ...rest]`。
- `history = [` 一段 6 条的客服对话:系统提示词、用户报问题(带名字和发票号)、客服回应、用户问抬头、客服回答、用户追问退款。
- `for i in range(1, len(history) + 1):` 看对话每多一条,总数涨到多少。`history[:i]` 是前 i 条。实跑:26、52、70、84、99、110。
- `budget = WINDOW - RESERVED_FOR_OUTPUT` 输入预算 120 - 40 = 80。6 条一共 110,超了 30。
- `kept = trim(list(history), budget)` 传 `list(history)` 是复制一份再传进去,因为 `trim` 里的 `pop` 会改动列表;不复制的话,原来的 `history` 也会被改掉(列表是按引用传的,和 JS 的数组一样)。严格说 `trim` 里 `messages[1:]` 已经复制过一次了,这里多复制一次是习惯,防止以后改函数时忘了。
- `print(f"裁剪后 {len(kept)} 条, {total(kept)} token")` 实跑:丢了 2 条,剩 4 条 66 个 token,在 80 以内。
- `for m in kept:` 打印留下来的每条消息的角色和开头。

</div>

```bash
uv run part02/trim_history.py
```

实跑输出:

```text
前 1 条: 26 token
前 2 条: 52 token
前 3 条: 70 token
前 4 条: 84 token
前 5 条: 99 token
前 6 条: 110 token
输入预算 = 120 - 40 = 80
  丢掉最早的一条 user: 你好,我叫王小明,我的发…
  丢掉最早的一条 assistant: 收到,我先帮您查一下这张…
裁剪后 4 条, 66 token
  system 你是云簿 CloudLedger 的客服
  user 好的,另外发票抬头能不能改成公司名?
  assistant 可以,请在设置里修改抬头后重新开具。
  user 那重复扣的钱什么时候退?
```

截断成功了,66 个 token 装进了 80 的预算。但仔细看留下来的 4 条:用户最后问「那重复扣的钱什么时候退?」,而「我叫王小明」「发票 INV-2026-004417 被重复扣款」这条消息已经被丢掉了。模型现在收到的对话里,根本没有提到是哪张发票。它要么反问用户「请问是哪张发票?」(用户会觉得这客服没记性),要么更糟,自己编一个发票号去查。

这就是上面说的「窗口外的内容对模型来说不存在」。朴素截断最先丢掉的,往往恰恰是对话开头最关键的信息:用户是谁、问题是什么。动手练习第 2 题会改进这个函数,把关键消息「钉住」不丢。更好的做法(把早期对话压缩成摘要、把关键事实存到外部记忆里)在第四部分讲上下文工程时专门讲。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="截断前后对比:系统提示词保留,最早的两条对话被丢掉,发票号随之消失">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-faint)">截断前 110 token(预算 80)</text>
<rect x="20" y="36" width="52" height="30" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="46" y="56" text-anchor="middle" fill="var(--ink)">sys 26</text>
<rect x="76" y="36" width="52" height="30" rx="3" fill="none" stroke="var(--compute)" stroke-dasharray="4 3"/><text x="102" y="56" text-anchor="middle" fill="var(--ink-soft)">u 26</text>
<rect x="132" y="36" width="36" height="30" rx="3" fill="none" stroke="var(--compute)" stroke-dasharray="4 3"/><text x="150" y="56" text-anchor="middle" fill="var(--ink-soft)">a 18</text>
<rect x="172" y="36" width="28" height="30" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="186" y="56" text-anchor="middle" fill="var(--ink)">u14</text>
<rect x="204" y="36" width="30" height="30" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="219" y="56" text-anchor="middle" fill="var(--ink)">a15</text>
<rect x="238" y="36" width="22" height="30" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="249" y="56" text-anchor="middle" fill="var(--ink)">u</text>
<text x="280" y="56" fill="var(--ink-soft)">虚线 = 被丢掉的两条</text>
<text x="76" y="88" fill="var(--ink-faint)">↑ 王小明 / INV-2026-004417 在这条里</text>
<text x="20" y="130" fill="var(--ink-faint)">截断后 66 token</text>
<rect x="20" y="140" width="52" height="30" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="46" y="160" text-anchor="middle" fill="var(--ink)">sys 26</text>
<rect x="76" y="140" width="28" height="30" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="90" y="160" text-anchor="middle" fill="var(--ink)">u14</text>
<rect x="108" y="140" width="30" height="30" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="123" y="160" text-anchor="middle" fill="var(--ink)">a15</text>
<rect x="142" y="140" width="22" height="30" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="153" y="160" text-anchor="middle" fill="var(--ink)">u</text>
<text x="190" y="160" fill="var(--ink-soft)">「那重复扣的钱什么时候退?」— 退哪张?</text>
<text x="20" y="206" fill="var(--ink-faint)">蓝 = 系统提示词,永远保留　琥珀 = 对话消息,从最早的开始丢</text>
</g>
</svg>
<figcaption>trim_history.py 截断前后。数字是每条消息按「内容 token + 4」算出的实跑值;最后一条 11 个 token,框太小没标数字。</figcaption>
</figure>

### 再踩一个坑:用切片截断,把系统提示词也丢了

写截断时,很多人第一反应是「只保留最后 N 条」,一行切片搞定。看看会发生什么,新建 `part02/naive_trim.py`:

```python
# agent-zero-lab/part02/naive_trim.py
history = [
    {"role": "system", "content": "你是云簿 CloudLedger 的客服,只回答账单和发票问题,不要编造政策。"},
    {"role": "user", "content": "你好,我叫王小明,我的发票 INV-2026-004417 被重复扣款了。"},
    {"role": "assistant", "content": "收到,我先帮您查一下这张发票的扣款记录。"},
    {"role": "user", "content": "好的,另外发票抬头能不能改成公司名?"},
    {"role": "assistant", "content": "可以,请在设置里修改抬头后重新开具。"},
    {"role": "user", "content": "那重复扣的钱什么时候退?"},
]

kept = history[-4:]
print([m["role"] for m in kept])
print("system 还在吗?", any(m["role"] == "system" for m in kept))
```

<div class="line-notes">

- `history = [` 和上一个脚本同样的 6 条。
- `kept = history[-4:]` 负数下标从末尾数,`[-4:]` 是最后 4 条。相当于 JS 的 `history.slice(-4)`。
- `print([m["role"] for m in kept])` 实跑:`['assistant', 'user', 'assistant', 'user']`。
- `print("system 还在吗?", any(m["role"] == "system" for m in kept))` `any(...)` 只要有一个为真就返回 `True`,相当于 JS 的 `kept.some(m => m.role === "system")`。实跑:`False`。

</div>

```bash
uv run part02/naive_trim.py
```

```text
['assistant', 'user', 'assistant', 'user']
system 还在吗? False
```

系统提示词没了。这个 bug 不会报任何错,程序照常运行,API 照常返回,只是模型从这一轮开始不再知道自己是云簿的客服、不再记得「不要编造政策」。用户问一句「你们支持退款到支付宝吗」,它可能就照着常识编一套政策出来。而且这种问题只在对话足够长时才出现,短对话测试全部正常,上线以后才冒出来。所以截断函数第一条规则:**系统提示词单独拿出来,永远不参与截断**。

## 窗口大不等于都能用好

现在 1M 窗口能装下一本半《西游记》,那是不是可以什么都往里塞,不用再操心截断和检索了?不行,原因有三个。

**第一,越长越贵,而且每一轮都要付。** 窗口里的每个 token 都按输入价收费。上面算过,《西游记》整本发一次 1.28 元。如果你把它当成「知识库」放在对话开头,用户每问一句,这 64 万个 token 都要重新发一遍、重新收一遍钱,聊 10 轮就是 12.8 元。普通对话也一样:历史消息每轮重发,对话越长,每轮的成本越高,总成本涨得比轮数快得多,练习 3 会算给你看。缓存能便宜很多(DeepSeek 缓存命中价是未命中的五十分之一),但那是后面的课。

**第二,越长越慢。** 模型要先把整个输入「读」一遍才能开始输出第一个字。输入从几千个 token 变成几十万个,用户等待第一个字出现的时间会明显变长。这个延迟在 Day 122 之后可以用 API 实测,今天先记住结论。

**第三,也是最反直觉的:塞得越多,模型越容易看漏。** 2023 年斯坦福等机构的论文 [《Lost in the Middle: How Language Models Use Long Contexts》](https://arxiv.org/abs/2307.03172)(Nelson F. Liu 等)做了一个实验:在一长串文档里只有一篇包含答案,改变这篇文档的位置,看模型答对的比例。结论是,答案在开头或结尾时模型答得最好,**在中间时明显变差**,即使是专门号称支持长上下文的模型也一样。这个现象后来就被叫作「lost in the middle」。

2025 年 7 月,向量数据库公司 Chroma 发布了技术报告 [《Context Rot: How Increasing Input Tokens Impacts LLM Performance》](https://research.trychroma.com/context-rot),测了包括 GPT-4.1、Claude 4、Gemini 2.5、Qwen3 在内的 18 个模型。他们刻意用非常简单的任务(比如在长文本里找一句话、照抄一串重复的词),只改变输入长度,发现**输入越长,模型表现越不可靠,而且下降的方式并不均匀**。报告里说,大家常用的「大海捞针」(Needle in a Haystack)测试只考字面匹配,所以很多模型能拿满分,但换成需要理解语义的找法,或者在文本里加几句相似的干扰内容,表现就掉下来。他们给这个现象起了个名字叫 context rot,中文常译「上下文腐烂」。

这些研究里的模型和 2026 年的不完全一样,新模型在长上下文上一直在进步,但「窗口能装下」和「窗口里的东西都能用好」是两回事,这个结论到今天仍然成立。我没有在 DeepSeek 上复现这些实验,上面的结论都来自这两篇报告,属于二手资料。

对写 Agent 的你,这三条合起来就是一句话:**上下文窗口是稀缺资源,要精挑细选地往里放**。只放这一步真正需要的内容:相关的那几篇帮助文章,而不是整个知识库;最近几轮对话加上关键事实,而不是全部历史;工具结果里有用的字段,而不是整个 JSON。这件事有个专门的名字叫「上下文工程」,第四部分会花很多天讲。

## 动手练习

**练习 1:到底能放几本。** 用今天实测的三本书 token 数(37,915、171,814、639,105)和精确窗口 1,048,576,分别算出:给输出留 8,000 个 token 时,每本书最多能放几本;如果把 `max_tokens` 设成最大输出 384K(按 384,000 算),又能放几本?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/fit_books.py
WINDOW = 1_048_576
BOOKS = {"爱丽丝漫游奇境": 37_915, "傲慢与偏见": 171_814, "西游记": 639_105}

for max_tokens in (8_000, 384_000):
    room = WINDOW - max_tokens
    print(f"留 {max_tokens:,} 给输出, 输入最多 {room:,}")
    for name, n in BOOKS.items():
        print(f"  {name}: 能放 {room // n} 本, 放一本后还剩 {room - n:,}")
```

<div class="line-notes">

- `WINDOW = 1_048_576` 用 API 报错里给的精确值。
- `BOOKS = {"爱丽丝漫游奇境": 37_915, "傲慢与偏见": 171_814, "西游记": 639_105}` 直接用 `book_tokens.py` 的实跑结果,不用再编码一遍。
- `for max_tokens in (8_000, 384_000):` 两种输出预留。8000 是一个比较常见的长回答上限;384,000 是 DeepSeek 文档写的最大输出 384K,这里按 384,000 粗算。
- `room = WINDOW - max_tokens` 留给输入的空间。实跑:1,040,576 和 664,576。
- `print(f"  {name}: 能放 {room // n} 本, 放一本后还剩 {room - n:,}")` `//` 是整除,只要整数部分,相当于 JS 的 `Math.floor(a / b)`(正数时)。

</div>

```bash
uv run part02/fit_books.py
```

```text
留 8,000 给输出, 输入最多 1,040,576
  爱丽丝漫游奇境: 能放 27 本, 放一本后还剩 1,002,661
  傲慢与偏见: 能放 6 本, 放一本后还剩 868,762
  西游记: 能放 1 本, 放一本后还剩 401,471
留 384,000 给输出, 输入最多 664,576
  爱丽丝漫游奇境: 能放 17 本, 放一本后还剩 626,661
  傲慢与偏见: 能放 3 本, 放一本后还剩 492,762
  西游记: 能放 1 本, 放一本后还剩 25,471
```

`max_tokens` 设到最大,输入空间直接少了 37 万个 token,《西游记》只剩 2.5 万的余量。所以 `max_tokens` 不要无脑设成最大值,按任务需要设,省下来的都是输入空间。

</details>

**练习 2:把关键消息钉住。** 改写 `trim`,让它接受一个参数 `pinned`:前 `pinned` 条消息永远保留(系统提示词和用户的第一条消息),只从后面的消息里丢最早的。用同样的 6 条对话、预算 80、`pinned=2` 跑一遍,看留下了什么、丢了什么。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/trim_pinned.py
from tokenizers import Tokenizer

tok = Tokenizer.from_file("data/deepseek_v4_tokenizer/tokenizer.json")
PER_MESSAGE = 4


def count(msg: dict[str, str]) -> int:
    return len(tok.encode(msg["content"], add_special_tokens=False).ids) + PER_MESSAGE


def trim_pinned(messages: list[dict[str, str]], budget: int, pinned: int) -> list[dict[str, str]]:
    head, rest = messages[:pinned], messages[pinned:]
    while rest and sum(count(m) for m in head + rest) > budget:
        rest.pop(0)
    return head + rest


history = [
    {"role": "system", "content": "你是云簿 CloudLedger 的客服,只回答账单和发票问题,不要编造政策。"},
    {"role": "user", "content": "你好,我叫王小明,我的发票 INV-2026-004417 被重复扣款了。"},
    {"role": "assistant", "content": "收到,我先帮您查一下这张发票的扣款记录。"},
    {"role": "user", "content": "好的,另外发票抬头能不能改成公司名?"},
    {"role": "assistant", "content": "可以,请在设置里修改抬头后重新开具。"},
    {"role": "user", "content": "那重复扣的钱什么时候退?"},
]

kept = trim_pinned(list(history), 80, pinned=2)
print(len(kept), "条,", sum(count(m) for m in kept), "token")
for m in kept:
    print(" ", m["role"], m["content"][:22])
```

<div class="line-notes">

- `def trim_pinned(messages: list[dict[str, str]], budget: int, pinned: int) -> list[dict[str, str]]:` 多了一个 `pinned` 参数,表示前几条不许丢。
- `head, rest = messages[:pinned], messages[pinned:]` `pinned=2` 时,`head` 是系统提示词和「我叫王小明…」那条,`rest` 是后面 4 条。
- `while rest and sum(count(m) for m in head + rest) > budget:` `head + rest` 是两个列表拼接,相当于 JS 的 `[...head, ...rest]`。钉住的两条是 26 + 26 = 52 个 token,后面 4 条是 18、14、15、11。
- `rest.pop(0)` 从可丢的部分里丢最早的。第一轮丢掉 18 个 token 的「收到,我先帮您查一下…」,总数从 110 降到 92;第二轮丢掉 14 个 token 的「另外发票抬头…」,降到 78,在 80 以内,停。
- `return head + rest` 钉住的放前面,剩下的接在后面,顺序不乱。
- `kept = trim_pinned(list(history), 80, pinned=2)` `pinned=2` 是关键字参数写法([Day 29](/blog/agent-zero/day-029-functions-2/)),读代码的人一眼就知道 2 是什么意思。
- `print(len(kept), "条,", sum(count(m) for m in kept), "token")` 实跑:`4 条, 78 token`。

</div>

```bash
uv run part02/trim_pinned.py
```

```text
4 条, 78 token
  system 你是云簿 CloudLedger 的客服,只
  user 你好,我叫王小明,我的发票 INV-2026
  assistant 可以,请在设置里修改抬头后重新开具。
  user 那重复扣的钱什么时候退?
```

这次王小明和发票号都留住了,模型看到最后一问时知道「退的是 INV-2026-004417 被重复扣的那笔」。代价是中间关于抬头的那一问被丢了,而客服的回答「可以,请在设置里修改抬头」还在,前面没了问题,这条回答显得没头没尾。成对丢消息(一问一答一起丢)会更干净,你可以自己试着改。钉住消息也不是万能的:钉得越多,能留给最近对话的空间越少。

</details>

**练习 3:每轮重发,账单怎么涨。** 假设系统提示词 26 个 token,每一轮对话(用户一句加客服一句)增加 40 个 token,每一轮调用都要把系统提示词和全部历史重新发一遍。算出第 1、2、5、10、20 轮这一次调用发多少 token,以及 20 轮累计一共发了多少,按 2 元每百万 token 算总价;再算一万个这样的对话要多少钱。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/resend_cost.py
SYSTEM = 26
PER_TURN = 40
PRICE_PER_M = 2.0

total_sent = 0
for turn in range(1, 21):
    this_call = SYSTEM + PER_TURN * turn
    total_sent += this_call
    if turn in (1, 2, 5, 10, 20):
        print(f"第 {turn:>2} 轮: 这次发 {this_call:>4} token, 累计发了 {total_sent:>5} token")

print(f"20 轮累计 ¥{total_sent / 1_000_000 * PRICE_PER_M:.4f}, 一万个这样的对话 ¥{total_sent * 10_000 / 1_000_000 * PRICE_PER_M:.0f}")
```

<div class="line-notes">

- `SYSTEM = 26` 用 `trim_history.py` 里系统提示词的实测值。
- `PER_TURN = 40` 假设值:`trim_history.py` 里一问一答大约 30 到 40 个 token,取 40。
- `this_call = SYSTEM + PER_TURN * turn` 第 n 轮发出去的是系统提示词加上到这一轮为止的 n 轮对话。第 1 轮 26 + 40 = 66,第 20 轮 26 + 800 = 826。这里把本轮新问题也粗略算进了这 40 里。
- `total_sent += this_call` 累计每一轮发出去的量。
- `if turn in (1, 2, 5, 10, 20):` 只打印几个有代表性的轮次。`in` 判断元素在不在元组里,相当于 JS 的 `[1, 2, 5, 10, 20].includes(turn)`。
- `print(f"20 轮累计 ¥{total_sent / 1_000_000 * PRICE_PER_M:.4f}` 实跑累计 8,920 个 token,8920 ÷ 1,000,000 × 2 = 0.01784 元;一万个对话约 178 元。

</div>

```bash
uv run part02/resend_cost.py
```

```text
第  1 轮: 这次发   66 token, 累计发了    66 token
第  2 轮: 这次发  106 token, 累计发了   172 token
第  5 轮: 这次发  226 token, 累计发了   730 token
第 10 轮: 这次发  426 token, 累计发了  2460 token
第 20 轮: 这次发  826 token, 累计发了  8920 token
20 轮累计 ¥0.0178, 一万个这样的对话 ¥178
```

对话长度是 20 轮,只是 10 轮的 2 倍,累计发送量却是 8920 ÷ 2460 ≈ 3.6 倍。每一轮都在为前面所有的轮次再付一次钱,轮数翻倍,总成本差不多翻四倍(数学上这叫平方增长)。真实的客服 Agent 每轮还要带工具说明和检索结果,单轮动辄几千上万个 token,这个平方增长会非常快地变成真金白银。这就是为什么长对话要截断或者压缩,而不是靠「窗口够大」硬扛。

</details>

**练习 4:再量一本。** 从古登堡下载《红楼梦》(编号 24264,也是繁体版),加进 `book_tokens.py` 的 `BOOKS` 里(另存为 `part02/book_tokens_more.py`),跑出它的 token 数,判断《西游记》和《红楼梦》能不能一起塞进一个窗口。

<details><summary>参考答案</summary>

```bash
curl -L -o data/books/pg24264.txt https://www.gutenberg.org/cache/epub/24264/pg24264.txt
```

下载失败就把域名换成 `gutenberg.pglaf.org`。然后在 `BOOKS` 字典里加一行:

```python
# agent-zero-lab/part02/book_tokens_more.py(只列出改动的部分,其余和 book_tokens.py 一样)
BOOKS = {
    "爱丽丝漫游奇境": "data/books/pg11.txt",
    "傲慢与偏见": "data/books/pg1342.txt",
    "西游记": "data/books/pg23962.txt",
    "红楼梦": "data/books/pg24264.txt",
}
```

<div class="line-notes">

- `"红楼梦": "data/books/pg24264.txt",` 新加的一行,别忘了行尾逗号。

</div>

```bash
uv run part02/book_tokens_more.py
```

```text
爱丽丝漫游奇境: 144,604 字符, 37,915 token, 每字符 0.26, 占 1M 窗口 3.8%, 整本发一次 ¥0.08
傲慢与偏见: 728,750 字符, 171,814 token, 每字符 0.24, 占 1M 窗口 17.2%, 整本发一次 ¥0.34
西游记: 758,186 字符, 639,105 token, 每字符 0.84, 占 1M 窗口 63.9%, 整本发一次 ¥1.28
红楼梦: 906,099 字符, 716,697 token, 每字符 0.79, 占 1M 窗口 71.7%, 整本发一次 ¥1.43
```

《红楼梦》71.7 万个 token。两本加起来 639,105 + 716,697 = 1,355,802,远超 1,048,576,一个窗口装不下,哪怕 `max_tokens` 设成 1 也不行。如果真有「同时对比两本书」的需求,就得分段处理或者先检索出相关的章节,这正是第四部分 RAG 要解决的事。

</details>

**验收标准:** `book_tokens.py`、`trim_history.py`、`naive_trim.py` 跑出和文章一致的结果;能说出 DeepSeek 窗口的精确值和最大输出;能读懂那条 400 报错里的每个数字;`trim` 函数能默写出来,并能说清楚为什么系统提示词要单独拿出来;能讲出「窗口大不等于用得好」的三个原因。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 上下文窗口(context window) | 一次调用里输入加输出能容纳的最大 token 数。DeepSeek 是 1,048,576,Claude 当前模型是 1M |
| 最大输出 | 一次调用最多能生成多少 token。DeepSeek 写的是 384K,Claude 当前模型是 128K |
| max_tokens | 调 API 时设的「这次最多输出多少 token」,会从窗口里预留出来,Day 121 详讲 |
| 无状态(stateless) | 服务端不保存上一次请求的任何信息,每次请求都要带上需要的全部内容 |
| 系统提示词(system prompt) | `role` 为 `system` 的那条消息,规定模型的身份和规矩,截断时必须保留 |
| 截断(truncation) | 内容超出预算时丢掉一部分,最常见的是从最早的消息开始丢 |
| 古登堡计划(Project Gutenberg) | 提供版权过期图书免费下载的网站,今天的三本书来自这里 |
| 400 Bad Request | HTTP 状态码,表示请求本身有问题,比如超出窗口;重试没用,要改请求 |
| lost in the middle | 2023 年的研究发现:相关信息放在长输入的中间时,模型最容易用不好 |
| 上下文腐烂(context rot) | Chroma 2025 年的报告提出:输入越长,模型表现越不可靠 |
| 大海捞针(Needle in a Haystack) | 在长文本里藏一句话让模型找出来的测试,只考字面匹配,偏简单 |

## 常见误区

**以为模型记得之前的对话。** API 是无状态的,模型「记得」只是因为程序把历史又发了一遍。被截断丢掉的消息,模型就真的不知道了。

**以为窗口只限制输入。** 输入加 `max_tokens` 一起不能超过窗口。实测报错里写得很清楚:`1286644 in the messages, 1 in the completion`。`max_tokens` 设得越大,能放的输入越少。

**用 `history[-N:]` 截断。** 实测会把系统提示词一起切掉(`system 还在吗? False`),而且不报任何错,长对话上线后才出问题。系统提示词要单独拿出来。

**估每条消息的开销时往少了算。** 估少了,本地以为装得下,发出去被 400 拒掉。实测多条消息时每条开销两三个 token,代码里按 4 算,宁可多留点余量。

**以为窗口 1M,就把整个知识库塞进去。** 每轮都按全部输入收费,越长越慢,模型还会看漏中间的内容。窗口是要精打细算的资源,不是越满越好。

**拿古典繁体文本的比例估现代中文。** 《西游记》繁体版每字 0.84 个 token,现代简体工单是 0.62。估算要用和你的真实数据相似的文本去测。

## 学习资料

### 文档与文章

- [DeepSeek:模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):上下文长度 1M、最大输出 384K 和价格都在这一页。5 分钟。
- [Claude 模型概览](https://platform.claude.com/docs/en/about-claude/models/overview):看一下另一家旗舰模型的窗口和最大输出,和 DeepSeek 对照。
- [Chroma《Context Rot》技术报告](https://research.trychroma.com/context-rot):英文,图很多,今天先看开头摘要和「Needle in a Haystack Extension」那一节的图,30 分钟。
- [Liu 等《Lost in the Middle》](https://arxiv.org/abs/2307.03172):论文本身偏学术,看摘要和第一张图(答案位置和准确率的 U 形曲线)就够了。
- [Anthropic:Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents):Anthropic 工程博客讲为什么要把上下文当成有限资源来管理,第四部分会精读,今天先读开头两节,建立印象。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1cuMJztEcL&autoplay=0&high_quality=1" title="AI根本无记忆!一条视频搞懂 大模型上下文窗口!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>清华姜学长 · AI根本无记忆!一条视频搞懂 大模型上下文窗口! · 10 分钟,正好对应正文「模型没有记忆,窗口就是全部」那一节,先看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1itxvz3ES6&autoplay=0&high_quality=1" title="“腐烂”与“污染”:剖析Agent性能下降的根本原因与具体症状——langchain《context engineering》②" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>慢学AI · “腐烂”与“污染”:剖析Agent性能下降的根本原因与具体症状 · 5 分钟,讲上下文太长、混进无关内容时 Agent 会出哪些毛病,对应正文最后一节。</figcaption>
</figure>

- 古希腊掌管代码的神《【长上下文】Lost in the Middle 详解:答案放中间为什么就找不到了?兼谈 RAG 重排》(BV1hi826FEwT,3 分半):把那篇论文的结论讲成大白话。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/hxMG1rXWgY4" title="The Limits of Long Context Models with Kelly Hong" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Jason Liu · The Limits of Long Context Models with Kelly Hong · Kelly Hong 是 Chroma《Context Rot》报告的第一作者,在这期里讲实验怎么设计、结果怎么读。英文,今天看前 20 分钟。</figcaption>
</figure>

### 书籍

- 《AI Engineering: Building Applications with Foundation Models》(Chip Huyen 著,O'Reilly,2025,目前只查到英文原版):第 5 章「Prompt Engineering」里有一节讲上下文长度和上下文效率,引用了大海捞针和 lost in the middle 的结果,站在应用工程师的角度讲怎么用窗口。

### 开源项目与代码

- [gkamradt/LLMTest_NeedleInAHaystack](https://github.com/gkamradt/LLMTest_NeedleInAHaystack):最早流行的「大海捞针」测试代码,看 README 里的热力图就能明白这个测试在测什么。
- [NVIDIA/RULER](https://github.com/NVIDIA/RULER):比大海捞针更难的长上下文测试集,了解一下「模型声称的窗口」和「真正好用的长度」怎么区分。

## 自测

1. 为什么模型的输出也要占上下文窗口?

<details><summary>答案</summary>

因为生成是自回归的:每生成一个 token 就接到输入末尾再算下一个,生成到后面时,模型眼前是「全部输入 + 已经生成的内容」。所以窗口要同时装下输入和整个输出,`max_tokens` 要从窗口里预留。

</details>

2. 用户和客服 Agent 聊了 30 轮,第 31 轮问「我一开始说的那个订单号是多少?」,Agent 答不上来。最可能的原因是什么?

<details><summary>答案</summary>

最早那条包含订单号的消息被截断丢掉了。模型没有记忆,它只能看到这次请求里发过去的内容,丢掉的消息对它来说完全不存在。改进办法是把关键信息钉住不丢,或者把早期对话压缩成摘要、把订单号这类关键事实单独存下来每轮带上。

</details>

3. API 返回 `you requested 1286645 tokens (1286644 in the messages, 1 in the completion)`,最大窗口 1048576。你有哪两种改法?哪种对这个例子没用?

<details><summary>答案</summary>

一是减少输入(消息里的内容),二是减小 `max_tokens`(completion 部分)。这个例子里 `max_tokens` 已经是 1 了,超出的 23 万多个全在输入里,只能减输入。

</details>

4. 有人写截断时用 `messages[-10:]` 只保留最后 10 条。这样写有什么问题?

<details><summary>答案</summary>

系统提示词在第 0 条,对话一长就会被切掉,而且不报任何错,模型从此不再遵守系统提示词里的身份和规矩。正确做法是把系统提示词单独拿出来,只对后面的对话做截断。另外按条数截断也不准,一条消息可能几个 token,也可能几万个,应该按 token 数截断。

</details>

5. 面试题:「现在模型都有 1M 上下文了,为什么还需要 RAG 和上下文工程?把所有资料都塞进去不行吗?」

<details><summary>答案</summary>

要点四个。成本:每次调用都按全部输入收费,对话每轮重发,资料越多越贵,而且多轮下来是平方增长。延迟:输入越长,首个 token 出来越慢。效果:研究(Lost in the Middle、Chroma 的 Context Rot)发现输入越长模型越容易看漏,放在中间的信息尤其容易用不好,能装下不等于能用好。规模和权限:真实知识库往往远超 1M、而且经常更新,不同用户能看的资料也不同,检索时可以按权限过滤。所以更好的做法是每一步只把真正相关的少量内容放进窗口。可以补一句:资料很小而且固定时,直接全放进去再配合缓存,也是合理的简化。

</details>

## 明天预告

Day 110 · 采样(一):概率分布和 temperature。这三天我们一直在讲模型「看到」什么:token、词表、窗口。明天回到模型「输出」的那一端:Day 106 说过模型每一步给出的是一个概率分布,那最后挑哪个 token 是怎么决定的?temperature 这个参数调的就是这件事,明天先把它的直觉建立起来。
