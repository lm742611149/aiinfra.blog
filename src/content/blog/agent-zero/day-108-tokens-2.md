---
title: 'Day 108 · Token(二):动手数 token,中文为什么费 token'
description: '装上 tokenizers 和 tiktoken,用 DeepSeek 和 OpenAI 两代真实分词器去切工单原文:一个汉字平均 0.62 个 token、一个英文字符 0.22 个、订单号被切成碎片。同一个意思的中英文,在不同分词器下谁更贵,答案并不一样。'
pubDate: 2026-10-22
regime: none
tags: ['llm-basics', 'tokenizer', 'python', 'agent-zero']
series: 'agent-zero'
day: 108
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 107](/blog/agent-zero/day-107-tokens-1/) 讲了分词器干的两件事:把文字切成 token,再把 token 换成编号。我们用 40 行 Python 在 7 句工单上训练了一个迷你 BPE,看到「发票」「重复扣款」因为出现得多被合成了整块,「退票」这种没见过的词被切成单字。最后下载了 DeepSeek 官方的 `tokenizer.json`,从里面读出词表 128,000 项、合并规则 127,741 条。

但昨天只是「看」了词表,还没真正用它去切一句话。查「发票」的编号还碰了一个 `KeyError`。今天装上专门的分词器库,把真实的工单文本切开,一个个数清楚。数 token 是做 Agent 最基本的算账能力:成本、窗口、截断,全建立在这个数字上。

## 今天要解决的问题

学完今天,你应该能做到:

1. 用 `tokenizers` 库加载 DeepSeek 分词器,数出任意一段文本的 token 数,并打印出每个 token 对应原文的哪一段。
2. 说出 DeepSeek 分词器下中文、英文、订单号各自「每字符多少 token」的实测值,并和官方文档的经验比例对照。
3. 用 `tiktoken` 数同一段文字在 OpenAI 两代分词器下的 token 数,解释为什么「中文费 token」这句话要看是哪家的分词器。
4. 用 token 数估算一个真实场景的成本,写出算式。

预计用时:2 到 2.5 小时。前置:[Day 107](/blog/agent-zero/day-107-tokens-1/) 下载好的 `data/deepseek_v4_tokenizer/`、[Day 10](/blog/agent-zero/day-010-uv-1/) 的 `uv add`、[Day 37](/blog/agent-zero/day-037-pathlib/) 的 pathlib、[Day 39](/blog/agent-zero/day-039-json/) 的 JSON。

学法提示:先对照文章把每个脚本逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,把 `count_tokens.py` 默写出来,包括打印每个 token 对应原文的那一行;然后做动手练习,做不出来再展开参考答案,看完关掉,自己重写一遍。

## 装上分词器库

昨天的 `tokenizer.json` 用 `json` 模块能读,但「按合并规则把一句话切开」这件事自己写太慢,也容易和官方实现对不上(真实分词器在合并之前还有一步「预切分」,比如数字最多三个一组,昨天的常见误区里提过)。所以直接用 Hugging Face 的 `tokenizers` 库,它就是 `tokenizer.json` 这个格式的官方读取器,核心用 Rust 写的,切一整本书也只要几秒。

在 `agent-zero-lab` 目录下:

```bash
cd agent-zero-lab
uv add tokenizers
```

`uv add` 相当于 `npm install xxx`,会把依赖写进 `pyproject.toml`(≈ `package.json`)并装进 `.venv`(≈ `node_modules`)。2026 年 10 月查 PyPI,`tokenizers` 最新版是 0.23.3(10 月 9 日发布),有 Intel Mac 和 Apple 芯片的预编译包,不需要装 Rust。装完 `pyproject.toml` 的 `dependencies` 里会多一行 `"tokenizers>=0.23.3"`。

DeepSeek 压缩包里的 `deepseek_tokenizer.py` 示例用的是 `transformers` 库,那个库很大(会连带装一堆机器学习依赖),只为了数 token 不值得。`tokenizers` 是 `transformers` 底层用的同一个分词引擎,单独装就够了。

## 第一次数 token

新建 `part02/count_tokens.py`,三段样本和后面 Day 122 讲 API 用量时会再用到的完全一样:

```python
# agent-zero-lab/part02/count_tokens.py
from tokenizers import Tokenizer

tok = Tokenizer.from_file("data/deepseek_v4_tokenizer/tokenizer.json")

SAMPLES = {
    "中文": "我的发票被重复扣款了，请帮我查一下是怎么回事，谢谢。",
    "英文": "I was charged twice for my invoice. Could you check what happened? Thanks.",
    "编号": "INV-2026-004417 INV-2026-004418 INV-2026-004419",
}

for name, text in SAMPLES.items():
    enc = tok.encode(text, add_special_tokens=False)
    n = len(enc.ids)
    print(f"{name}: {len(text)} 个字符, {n} 个 token, 每字符 {n / len(text):.2f}")
    pieces = [text[start:end] for start, end in enc.offsets]
    print("  ", " | ".join(pieces))
```

<div class="line-notes">

- `from tokenizers import Tokenizer` 从刚装的库里导入 `Tokenizer` 类。
- `tok = Tokenizer.from_file("data/deepseek_v4_tokenizer/tokenizer.json")` 读昨天下载的那个 JSON,建出一个分词器对象。相对路径,所以要在 `agent-zero-lab` 目录下运行。
- `SAMPLES = {` 名字 → 文本 的字典。`len()` 数的是字符数,实测:中文那句 26 个字符(全角逗号句号各算 1 个),英文 74 个,编号 47 个。
- `for name, text in SAMPLES.items():` `.items()` 每次给出一个 `(名字, 文本)` 元组,解包成两个变量([Day 24](/blog/agent-zero/day-024-dicts/))。第一轮 `name="中文"`。
- `enc = tok.encode(text, add_special_tokens=False)` 编码。返回的不是一个简单的列表,而是一个 `Encoding` 对象,里面有 `ids`(编号)、`tokens`(词表里的写法)、`offsets`(每个 token 对应原文的位置)等字段。`add_special_tokens=False` 表示别在开头自动加「句子开始」之类的特殊 token,我们只数文本本身。
- `n = len(enc.ids)` token 数就是编号列表的长度。三轮实跑:16、16、22。
- `print(f"{name}: {len(text)} 个字符, {n} 个 token, 每字符 {n / len(text):.2f}")` `:.2f` 保留两位小数。中文 `16 / 26 = 0.615…` 显示成 `0.62`。
- `pieces = [text[start:end] for start, end in enc.offsets]` `offsets` 是一串 `(起点, 终点)`,比如中文第一个 token 是 `(0, 2)`,第二个是 `(2, 4)`。用切片 `text[0:2]` 取出原文「我的」。为什么不直接打印 `enc.tokens`?因为昨天说过,中文 token 在词表里是 `åıĳç¥¨` 那样的字节写法,`offsets` 能直接映射回人看得懂的原文。
- `print("  ", " | ".join(pieces))` 用竖线把切块连起来。

</div>

```bash
uv run part02/count_tokens.py
```

实跑输出:

```text
中文: 26 个字符, 16 个 token, 每字符 0.62
   我的 | 发票 | 被 | 重复 | 扣 | 款 | 了 | ， | 请 | 帮我 | 查 | 一下 | 是怎么回事 | ， | 谢谢 | 。
英文: 74 个字符, 16 个 token, 每字符 0.22
   I |  was |  charged |  twice |  for |  my |  invoice | . |  Could |  you |  check |  what |  happened | ? |  Thanks | .
编号: 47 个字符, 22 个 token, 每字符 0.47
   IN | V | - | 202 | 6 | - | 004 | 417 |  INV | - | 202 | 6 | - | 004 | 418 |  INV | - | 202 | 6 | - | 004 | 419
```

三行结果各有看头,一行一行说。

**中文那行。** 26 个字符切成 16 块。「我的」「发票」「帮我」「一下」「谢谢」都是两个字一块,「是怎么回事」五个字一块,「被」「扣」「款」「了」各自单独。「重复扣款」昨天在玩具里是一整块,在真实分词器里是「重复」「扣」「款」三块,因为真实语料是整个互联网的中文,「扣款」这个组合不够常见,没进词表。平均每字 0.62 个 token。

**英文那行。** 74 个字符也只有 16 块,几乎一个单词一块,而且单词前面的空格是和单词粘在一起的(` was`、` charged`),昨天说的 `Ġ` 就是这个空格。平均每字符 0.22 个 token,也就是 4 到 5 个字母一个 token。

**编号那行最值得记住。** 第一个 `INV` 被切成 `IN` 和 `V`,后面两个 ` INV` 带着前面的空格却是一整块,同一个字符串因为前面有没有空格,切法就不一样。年份 `2026` 被切成 `202` 和 `6`,`004417` 被切成 `004` 和 `417`:这个分词器的预切分规则是**数字最多三个一组**,所以所有长数字都会被三位三位地剁开。47 个字符用了 22 个 token,每字符 0.47,比英文贵一倍多。

这就是昨天说「长编号容易抄错」的直接证据。模型输出 `INV-2026-004417` 要连续猜对 8 个 token,其中 `004` 和 `417` 这种数字块,训练语料里出现在各种上下文中,没有任何语义可言,猜错一个就是抄错一位。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="同一句工单在 DeepSeek 分词器下的真实切分,中文常用词是整块,编号三位一组">
<rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink-faint)">DeepSeek 分词器实切(count_tokens.py 输出)</text>
<g fill="var(--mem-wash)" stroke="var(--mem)">
<rect x="20" y="40" width="40" height="26" rx="3"/><rect x="64" y="40" width="40" height="26" rx="3"/><rect x="108" y="40" width="26" height="26" rx="3"/><rect x="138" y="40" width="40" height="26" rx="3"/><rect x="182" y="40" width="26" height="26" rx="3"/><rect x="212" y="40" width="26" height="26" rx="3"/><rect x="242" y="40" width="26" height="26" rx="3"/>
</g>
<g fill="var(--ink)" text-anchor="middle">
<text x="40" y="58">我的</text><text x="84" y="58">发票</text><text x="121" y="58">被</text><text x="158" y="58">重复</text><text x="195" y="58">扣</text><text x="225" y="58">款</text><text x="255" y="58">了</text>
</g>
<text x="285" y="58" fill="var(--ink-soft)">10 个字 → 7 个 token</text>
<g fill="var(--compute-wash)" stroke="var(--compute)">
<rect x="20" y="96" width="30" height="26" rx="3"/><rect x="54" y="96" width="22" height="26" rx="3"/><rect x="80" y="96" width="22" height="26" rx="3"/><rect x="106" y="96" width="38" height="26" rx="3"/><rect x="148" y="96" width="22" height="26" rx="3"/><rect x="174" y="96" width="22" height="26" rx="3"/><rect x="200" y="96" width="38" height="26" rx="3"/><rect x="242" y="96" width="38" height="26" rx="3"/>
</g>
<g fill="var(--ink)" text-anchor="middle">
<text x="35" y="114">IN</text><text x="65" y="114">V</text><text x="91" y="114">-</text><text x="125" y="114">202</text><text x="159" y="114">6</text><text x="185" y="114">-</text><text x="219" y="114">004</text><text x="261" y="114">417</text>
</g>
<text x="295" y="114" fill="var(--ink-soft)">15 个字符 → 8 个 token</text>
<text x="20" y="150" fill="var(--ink-faint)">蓝 = 中文常用词基本一到两个字一块</text>
<text x="20" y="170" fill="var(--ink-faint)">琥珀 = 编号被剁碎,数字三位一组:2026 → 202 + 6</text>
</g>
</svg>
<figcaption>「我的发票被重复扣款了」和订单号 INV-2026-004417 在 DeepSeek 分词器下的真实切分,数字来自实跑。</figcaption>
</figure>

## 先踩一个坑:换个目录就找不到文件

这里很容易踩坑。假如你习惯先 `cd` 进脚本所在的文件夹再运行:

```bash
cd part02
uv run count_tokens.py
```

实跑报错:

```text
Traceback (most recent call last):
  File "~/agent-zero-lab/part02/count_tokens.py", line 4, in <module>
    tok = Tokenizer.from_file("data/deepseek_v4_tokenizer/tokenizer.json")
          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
Exception: No such file or directory (os error 2)
```

和昨天 `FileNotFoundError` 是同一个原因:相对路径是相对「当前所在目录」算的,现在你在 `part02` 里,它就去找 `part02/data/...`,当然没有。这个报错长得有点怪,是 `Exception` 而不是 `FileNotFoundError`,结尾还带个 `(os error 2)`,因为 `tokenizers` 的核心是 Rust 写的,报错信息是从 Rust 那边原样转过来的。`os error 2` 在任何语言里都是「没有这个文件或目录」。

两种修法。简单的:回到 `agent-zero-lab` 目录下运行,这门课所有脚本都约定从仓库根目录跑([Day 33](/blog/agent-zero/day-033-packages/) 讲过这个约定)。稳的:路径从脚本文件自己的位置算起,不管在哪运行都能找到。新建 `part02/count_tokens_anywhere.py` 演示第二种:

```python
# agent-zero-lab/part02/count_tokens_anywhere.py
from pathlib import Path

from tokenizers import Tokenizer

LAB = Path(__file__).resolve().parent.parent
tok = Tokenizer.from_file(str(LAB / "data/deepseek_v4_tokenizer/tokenizer.json"))

print("LAB =", LAB.name)
print(len(tok.encode("我的发票被重复扣款了", add_special_tokens=False).ids))
```

<div class="line-notes">

- `LAB = Path(__file__).resolve().parent.parent` `__file__` 是当前脚本自己的路径,相当于 Node 里的 `__filename`。`.resolve()` 变成绝对路径,`.parent` 是所在目录 `part02`,再 `.parent` 就是 `agent-zero-lab`。
- `tok = Tokenizer.from_file(str(LAB / "data/deepseek_v4_tokenizer/tokenizer.json"))` pathlib 用 `/` 拼路径。`from_file` 要的是字符串,所以外面包一层 `str()`;直接传 `Path` 对象,类型检查器会画红线。
- `print("LAB =", LAB.name)` `.name` 是路径最后一段,实跑是 `agent-zero-lab`。
- `print(len(tok.encode("我的发票被重复扣款了", add_special_tokens=False).ids))` 实跑 `7`,和上面图里的 7 块对得上。

</div>

```bash
cd part02
uv run count_tokens_anywhere.py
```

```text
LAB = agent-zero-lab
7
```

在 `part02` 里运行也找到了。后面的课里,需要读数据文件的脚本默认还是从根目录跑,写法用第一种,短。

## 和官方的经验比例对一对

DeepSeek 文档的 [Token 用量计算](https://api-docs.deepseek.com/zh-cn/quick_start/token_usage) 页面给了一个经验比例:1 个英文字符约 0.3 个 token,1 个中文字符约 0.6 个 token(2026 年 10 月查到)。我们实测中文 0.62,和文档几乎一样;英文 0.22,比文档的 0.3 还少,因为这句英文全是 was、for、my 这种常用短词,一个词就是一个 token,换成满是专业术语的英文,比例会往 0.3 靠。编号 0.47,文档没提,但你已经知道原因了。

这个比例用来**估算**很方便。一张 800 字的中文工单,大约 800 × 0.6 = 480 个 token,心算就能出来。但它只是平均数,不同内容偏差很大,动手练习第 2 题会让你拿一张掺了数字和编号的工单去比一比估算和实数差多少。真正算账的时候,要么用分词器数,要么看 API 返回的 `usage`。

## 换一家分词器:同一句话,块数不一样

昨天说过,每家模型的分词器是自己训的。现在拿 OpenAI 的分词器来对比。OpenAI 的分词器库叫 `tiktoken`:

```bash
uv add tiktoken
```

2026 年 10 月查 PyPI,`tiktoken` 最新版是 0.14.0。它里面有好几套编码,我们比两套:`cl100k_base` 是 GPT-4、GPT-3.5 那一代用的,词表大约 10 万;`o200k_base` 是 GPT-4o 之后用的,词表大约 20 万。用 `tiktoken.encoding_name_for_model` 查,`gpt-4o`、`gpt-4.1`、`o3`、`gpt-5` 对应的都是 `o200k_base`。注意 `tiktoken` 第一次用某套编码时会联网下载编码文件,之后存在本地缓存里;如果第一次运行卡住或者报连接错误,就是这一步下载没成功,换个网络再试。

新建 `part02/compare_tokenizers.py`:

```python
# agent-zero-lab/part02/compare_tokenizers.py
import tiktoken
from tokenizers import Tokenizer

deepseek = Tokenizer.from_file("data/deepseek_v4_tokenizer/tokenizer.json")
gpt4 = tiktoken.get_encoding("cl100k_base")
gpt4o = tiktoken.get_encoding("o200k_base")

SAMPLES = [
    "我的发票被重复扣款了，请帮我查一下是怎么回事，谢谢。",
    "I was charged twice for my invoice. Could you check what happened? Thanks.",
    "INV-2026-004417 INV-2026-004418 INV-2026-004419",
]

print(f"{'字符':>4} {'DeepSeek':>8} {'cl100k':>6} {'o200k':>6}  开头")
for text in SAMPLES:
    a = len(deepseek.encode(text, add_special_tokens=False).ids)
    b = len(gpt4.encode(text))
    c = len(gpt4o.encode(text))
    print(f"{len(text):>4} {a:>8} {b:>6} {c:>6}  {text[:12]}")

ids = gpt4.encode("被重复扣款")
print("cl100k 切「被重复扣款」:", ids, [gpt4.decode([i]) for i in ids])
```

<div class="line-notes">

- `import tiktoken` OpenAI 的分词器库。它和 `tokenizers` 是两家各自的实现,接口长得不一样。
- `gpt4 = tiktoken.get_encoding("cl100k_base")` 按名字拿到一套编码。第一次运行会联网下载,之后读本地缓存。
- `print(f"{'字符':>4} {'DeepSeek':>8} {'cl100k':>6} {'o200k':>6}  开头")` 打表头。`:>4` 是右对齐占 4 格,和下面数据行的格式一致,列才能对齐。
- `a = len(deepseek.encode(text, add_special_tokens=False).ids)` DeepSeek 的数法,和上一个脚本一样。
- `b = len(gpt4.encode(text))` `tiktoken` 的 `encode` 直接返回编号列表(`list[int]`),不像 `tokenizers` 返回一个对象,所以不用 `.ids`。
- `print(f"{len(text):>4} {a:>8} {b:>6} {c:>6}  {text[:12]}")` 每行:字符数、三家各自的 token 数、文本前 12 个字符。实跑三行:中文 `26 16 30 18`,英文 `74 16 16 16`,编号 `47 22 21 21`。
- `ids = gpt4.encode("被重复扣款")` 单独看 cl100k 怎么切这五个字。
- `print("cl100k 切「被重复扣款」:", ids, [gpt4.decode([i]) for i in ids])` 把每个编号单独解码回文字。实跑:`[87743, 104, 30358, 59464, 15355, 96, 69253]` 和 `['�', '�', '重', '复', '�', '�', '款']`。五个字用了 7 个 token,「被」和「扣」各被拆成两块,单独一块解码不出完整的字,显示成 `�`。

</div>

```bash
uv run part02/compare_tokenizers.py
```

实跑输出:

```text
  字符 DeepSeek cl100k  o200k  开头
  26       16     30     18  我的发票被重复扣款了，请
  74       16     16     16  I was charge
  47       22     21     21  INV-2026-004
cl100k 切「被重复扣款」: [87743, 104, 30358, 59464, 15355, 96, 69253] ['�', '�', '重', '复', '�', '�', '款']
```

英文那行三家都是 16,几乎没差别:三家的语料里英文都多,常用单词都成了整块。编号那行也差不多,21 或 22,都被切碎了。差别全在中文:DeepSeek 16、o200k 18、cl100k 30。

cl100k 那一行最能说明问题。「被」「扣」这种很常用的汉字,在 GPT-4 那一代的词表里连一个整块都没有,只能拆成字节。昨天说过一个汉字 3 个字节,这里拆成了 2 块(实测前一块 2 个字节、后一块 1 个字节),每块单独解码都是半个字,所以打印出来是 `�`。cl100k 的训练语料里中文太少,很多汉字没攒够出现次数,合并规则轮不到它们。到了 o200k,OpenAI 把词表扩到 20 万,中文好了很多,但还是比 DeepSeek 多两个。

## 同一个意思,中文到底贵不贵

上面比的是「同一句中文在三家分别多少 token」。还有一个更实际的问题:同一个意思,用中文说和用英文说,哪个 token 更少?因为一个英文字符只要 0.22 个 token,而一个汉字要 0.62 个,很多人就得出「中文贵三倍」的结论。这是把「每字符」和「每个意思」搞混了:表达同一个意思,中文用的字符数比英文少得多。

拿三句工单的中英对照来实测。新建 `part02/zh_en_ratio.py`:

```python
# agent-zero-lab/part02/zh_en_ratio.py
import tiktoken
from tokenizers import Tokenizer

ds = Tokenizer.from_file("data/deepseek_v4_tokenizer/tokenizer.json")
cl = tiktoken.get_encoding("cl100k_base")
o2 = tiktoken.get_encoding("o200k_base")

PAIRS = [
    ("请帮我把发票抬头改成公司全称。", "Please change the invoice title to our full company name."),
    ("我上个月的账单金额不对，多扣了三十块钱。", "My bill last month was wrong. I was overcharged by thirty yuan."),
    ("退款申请提交三天了还没到账，什么时候能退？", "I submitted a refund request three days ago and still haven't received it. When will it arrive?"),
]


def count(name: str, text: str) -> int:
    if name == "DeepSeek":
        return len(ds.encode(text, add_special_tokens=False).ids)
    if name == "cl100k":
        return len(cl.encode(text))
    return len(o2.encode(text))


for name in ["DeepSeek", "cl100k", "o200k"]:
    zh = sum(count(name, z) for z, _ in PAIRS)
    en = sum(count(name, e) for _, e in PAIRS)
    print(f"{name:>8}: 中文 {zh:>2} token, 英文 {en:>2} token, 中/英 = {zh / en:.2f}")
```

<div class="line-notes">

- `PAIRS = [` 三组「中文, 英文」元组,意思一一对应。中文分别是 15、20、21 个字,英文是 57、63、95 个字符。
- `def count(name: str, text: str) -> int:` 按分词器名字选数法。两个库接口不同,包成一个函数,下面的循环就不用管区别。
- `if name == "DeepSeek":` 前两个分支命中就 `return`,函数立刻结束;都没命中,走到最后一行就是 o200k。
- `for name in ["DeepSeek", "cl100k", "o200k"]:` 三家各算一遍。
- `zh = sum(count(name, z) for z, _ in PAIRS)` `for z, _ in PAIRS` 把每个元组解包,`_` 表示英文这半我们这里用不上。`sum(... for ...)` 是生成器表达式求和,和列表推导式长得像,只是没有方括号,不先建列表。DeepSeek 实跑三句中文是 10、13、13,合计 36。
- `en = sum(count(name, e) for _, e in PAIRS)` 同理算英文,DeepSeek 三句是 11、15、20,合计 46。
- `print(f"{name:>8}: 中文 {zh:>2} token, 英文 {en:>2} token, 中/英 = {zh / en:.2f}")` 中/英 小于 1 表示中文更省。实跑:DeepSeek `0.78`,cl100k `1.35`,o200k `1.02`。

</div>

```bash
uv run part02/zh_en_ratio.py
```

实跑输出:

```text
DeepSeek: 中文 36 token, 英文 46 token, 中/英 = 0.78
  cl100k: 中文 62 token, 英文 46 token, 中/英 = 1.35
   o200k: 中文 46 token, 英文 45 token, 中/英 = 1.02
```

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="三组同义中英句子在三种分词器下的 token 总数对比">
<rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-faint)">三组同义句合计 token(zh_en_ratio.py 实跑,1 token = 6px)</text>
<text x="20" y="62" fill="var(--ink)">DeepSeek</text>
<rect x="110" y="48" width="216" height="14" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="334" y="60" fill="var(--ink-soft)">中 36</text>
<rect x="110" y="64" width="276" height="14" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="394" y="76" fill="var(--ink-soft)">英 46 → 中/英 0.78</text>
<text x="20" y="112" fill="var(--ink)">cl100k</text>
<rect x="110" y="98" width="372" height="14" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="490" y="110" fill="var(--ink-soft)">中 62</text>
<rect x="110" y="114" width="276" height="14" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="394" y="126" fill="var(--ink-soft)">英 46 → 中/英 1.35</text>
<text x="20" y="162" fill="var(--ink)">o200k</text>
<rect x="110" y="148" width="276" height="14" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="394" y="160" fill="var(--ink-soft)">中 46</text>
<rect x="110" y="164" width="270" height="14" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="394" y="176" fill="var(--ink-soft)">英 45 → 中/英 1.02</text>
<text x="20" y="200" fill="var(--ink-faint)">蓝 = 中文　琥珀 = 英文。英文三家几乎一样长,差别全在中文那条。</text>
</g>
</svg>
<figcaption>同一个意思,中文贵不贵取决于分词器:DeepSeek 下中文反而省 22%,GPT-4 时代的 cl100k 下中文贵 35%,GPT-4o 之后的 o200k 基本持平。</figcaption>
</figure>

所以「中文为什么费 token」的完整回答是这样的。**按字数算**,中文确实每个字都比英文字母贵(0.62 对 0.22),按字数估成本的人会被吓到,也会算错。**按意思算**,要看分词器:语料里中文多的分词器(DeepSeek 这类国产模型),中文和英文差不多甚至更省;语料里中文少的老分词器(GPT-4 的 cl100k),很多汉字要拆成字节,同样的意思中文贵三分之一以上。这里只有三句话,样本很小,比例换一批文本会有波动,但方向是稳定的,你可以在练习里多加几句自己验证。

对做 Agent 的你,结论很实用:选模型时,如果用户主要说中文,同样的单价下,分词器对中文友好的模型实际更便宜;做成本预算时,按你选的那个模型的分词器数,别拿别家的比例套。

## 和 API 账单对得上吗

最后一个疑问:我们本地数出来的数,和 API 实际收费的数一样吗?这一步要调 API,而这门课在 [Day 120](/blog/agent-zero/day-120-api-register/) 才注册 API、拿 key,所以**这段你现在不用跑**,看我的实跑结果就行,Day 122 讲 `usage` 字段时你会自己再验一遍。

我用 DeepSeek API(模型 `deepseek-flash`)把上面三段样本各发了一次,只让它输出 1 个 token,然后读返回的 `usage.prompt_tokens`(本次请求输入了多少 token)。结果是:

| 样本 | 本地分词器数 | API 返回的 prompt_tokens |
| --- | --- | --- |
| 字母 a | 1 | 5 |
| 中文那句 | 16 | 20 |
| 英文那句 | 16 | 20 |
| 编号那串 | 22 | 26 |

每一行都正好差 4。这 4 个 token 是每次请求的消息格式开销:模型的输入不只有你的文字,还有「这是用户说的话」这样的角色标记和分隔符,它们也是 token,也要收钱。去掉这个固定开销,本地数和 API 数**一个都不差**。这说明两件事:DeepSeek 公开的这个分词器文件,就是 `deepseek-flash` 线上实际在用的;以及你可以完全离线地、不花一分钱地算出一段文本要多少 token。这几次调用一共输入 71 个 token、输出 4 个,按 2026 年 10 月 `deepseek-flash` 高峰价(输入 2 元、输出 8 元每百万 token)算,花费 71 × 2 ÷ 1,000,000 + 4 × 8 ÷ 1,000,000 ≈ 0.00017 元。

多条消息时开销不是简单的「每条 4 个」,明天会看到实测数字。

## 动手练习

**练习 1:先猜再数。** 下面 7 个字符串,先在纸上猜它们在 DeepSeek 分词器下各是几个 token,再写脚本数,打印出切块:`"2026"`、`"1000000"`、`"1,000,000"`、`"發票"`(繁体)、`"饕餮"`、`"😀"`、`"こんにちは"`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/guess_tokens.py
from tokenizers import Tokenizer

tok = Tokenizer.from_file("data/deepseek_v4_tokenizer/tokenizer.json")

for text in ["2026", "1000000", "1,000,000", "發票", "饕餮", "😀", "こんにちは"]:
    enc = tok.encode(text, add_special_tokens=False)
    pieces = [text[s:e] for s, e in enc.offsets]
    print(f"{text!r}: {len(enc.ids)} 个 token {pieces}")
```

<div class="line-notes">

- `for text in ["2026", "1000000", "1,000,000", "發票", "饕餮", "😀", "こんにちは"]:` 数字、带逗号的数字、繁体、生僻字、emoji、日文假名,各挑一个。
- `pieces = [text[s:e] for s, e in enc.offsets]` 和 `count_tokens.py` 同样的写法。注意:如果一个字被拆成了两个字节级 token,两个 token 的 offsets 都指向这同一个字,所以这个字会打印两遍。
- `print(f"{text!r}: {len(enc.ids)} 个 token {pieces}")` 实跑结果见下面。

</div>

```bash
uv run part02/guess_tokens.py
```

```text
'2026': 2 个 token ['202', '6']
'1000000': 3 个 token ['100', '000', '0']
'1,000,000': 5 个 token ['1', ',', '000', ',', '000']
'發票': 2 个 token ['發', '票']
'饕餮': 4 个 token ['饕', '饕', '餮', '餮']
'😀': 2 个 token ['😀', '😀']
'こんにちは': 5 个 token ['こ', 'ん', 'に', 'ち', 'は']
```

数字都是从左往右三位一组:`1000000` 是 `100|000|0`,不是我们习惯的 `1|000|000`;加了千分位逗号反而更费(5 个)。繁体「發票」比简体「发票」多一个 token,简体「发票」是一整块,繁体的组合在语料里少。「饕餮」每个字都被拆成两个字节级 token,显示成同一个字出现两次,这就是昨天说的「生僻字最差拆成字节」。emoji 同理。日文假名一个一个单独切,DeepSeek 的语料里日文显然没有中文多。

</details>

**练习 2:经验比例准不准。** 下面这张工单掺了数字、金额和订单号。先按「每个字符 0.6 个 token」估算,再用分词器实数,算出估算误差。

工单原文:「你好，我是杭州一家小餐馆的老板，用你们的云簿记账已经两年了。这个月 10 月 3 日自动续费扣了 1,188 元，可是 10 月 5 日又扣了一次，订单号分别是 INV-2026-004417 和 INV-2026-004502。我在 App 里找不到申请退款的入口，客服电话也一直占线，麻烦尽快处理，谢谢！」

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/estimate_vs_count.py
from tokenizers import Tokenizer

tok = Tokenizer.from_file("data/deepseek_v4_tokenizer/tokenizer.json")

TICKET = (
    "你好，我是杭州一家小餐馆的老板，用你们的云簿记账已经两年了。"
    "这个月 10 月 3 日自动续费扣了 1,188 元，可是 10 月 5 日又扣了一次，"
    "订单号分别是 INV-2026-004417 和 INV-2026-004502。"
    "我在 App 里找不到申请退款的入口，客服电话也一直占线，麻烦尽快处理，谢谢！"
)

guess = round(len(TICKET) * 0.6)
real = len(tok.encode(TICKET, add_special_tokens=False).ids)
print(f"{len(TICKET)} 个字符, 按 0.6 估 {guess} token, 实数 {real} token, 误差 {(guess - real) / real:+.0%}")
```

<div class="line-notes">

- `TICKET = (` 括号里几个字符串字面量挨着写,Python 会自动把它们拼成一个字符串,用来把长文本拆成几行写。JS 里没有这个语法,你得用 `+` 或模板字符串。
- `guess = round(len(TICKET) * 0.6)` 154 个字符 × 0.6 = 92.4,`round` 四舍五入成 92。
- `real = len(tok.encode(TICKET, add_special_tokens=False).ids)` 实数 97。
- `误差 {(guess - real) / real:+.0%}` `:+.0%` 表示按百分比显示、不留小数、正数也带 `+` 号。`(92 - 97) / 97 = -0.0515…`,显示成 `-5%`。

</div>

```bash
uv run part02/estimate_vs_count.py
```

```text
154 个字符, 按 0.6 估 92 token, 实数 97 token, 误差 -5%
```

估少了 5%。这张工单里有一部分是数字和订单号,它们每字符 0.47 左右,比中文的 0.6 低,但空格、英文单词和数字三位一组的切法又让总数往上走,最后估算低了一点。做预算时 5% 的误差可以接受;要精确,就数。

</details>

**练习 3:JSON 也费 token。** Agent 调用工具后,工具结果通常是 JSON,要原样塞回给模型看。下面这张发票,分别用「带缩进」「紧凑」「默认转义中文」三种方式 `json.dumps`,数各自多少 token。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/json_tokens.py
import json

from tokenizers import Tokenizer

tok = Tokenizer.from_file("data/deepseek_v4_tokenizer/tokenizer.json")

invoice = {
    "invoice_id": "INV-2026-004417",
    "customer": "杭州小馆餐饮有限公司",
    "amount": 1188.00,
    "status": "paid",
    "charged_at": "2026-10-03T08:15:00Z",
}

pretty = json.dumps(invoice, ensure_ascii=False, indent=2)
compact = json.dumps(invoice, ensure_ascii=False, separators=(",", ":"))
escaped = json.dumps(invoice, separators=(",", ":"))

for name, text in [("缩进版", pretty), ("紧凑版", compact), ("中文转义版", escaped)]:
    n = len(tok.encode(text, add_special_tokens=False).ids)
    print(f"{name}: {len(text)} 字符, {n} token")
print(escaped[40:90])
```

<div class="line-notes">

- `invoice = {` 一张发票,有编号、中文客户名、金额、状态、时间。
- `pretty = json.dumps(invoice, ensure_ascii=False, indent=2)` 带两格缩进,相当于 JS 的 `JSON.stringify(obj, null, 2)`。`ensure_ascii=False` 表示中文原样输出。
- `compact = json.dumps(invoice, ensure_ascii=False, separators=(",", ":"))` 去掉逗号和冒号后面的空格,最紧凑,和 JS 的 `JSON.stringify(obj)` 一样。
- `escaped = json.dumps(invoice, separators=(",", ":"))` 不写 `ensure_ascii`,默认是 `True`,中文会被转成 `杭` 这样的转义序列。这是 Python 和 JS 的一个差别:JS 的 `JSON.stringify` 默认不转义中文。
- `print(f"{name}: {len(text)} 字符, {n} token")` 实跑:缩进版 145 字符 65 token,紧凑版 124 字符 49 token,中文转义版 174 字符 79 token。
- `print(escaped[40:90])` 看一眼转义后的样子:`r":"杭州小馆餐饮有\u96`。

</div>

```bash
uv run part02/json_tokens.py
```

```text
缩进版: 145 字符, 65 token
紧凑版: 124 字符, 49 token
中文转义版: 174 字符, 79 token
r":"杭州小馆餐饮有\u96
```

同一张发票,最省的 49 个,最费的 79 个,差了 60%。缩进和换行每个都是 token;`杭` 这种转义序列对分词器来说就是一串普通字母数字,一个汉字变成六个字符,切得非常碎,模型读起来也更费劲。后面写工具时,工具结果用 `ensure_ascii=False` 加紧凑格式返回,是最便宜的一个优化。

</details>

**练习 4:算一笔账。** 假设云簿每天收 1 万张练习 2 那样的工单(每张 97 个 token),每张只把工单原文发给 `deepseek-flash` 一次。按 2026 年 10 月的价格(未命中缓存的输入:高峰 2 元每百万 token,空闲 1 元),每天、每月各花多少?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ticket_cost.py
TOKENS_PER_TICKET = 97
TICKETS_PER_DAY = 10_000
PEAK, OFF_PEAK = 2.0, 1.0

for label, price in [("高峰", PEAK), ("空闲", OFF_PEAK)]:
    daily = TOKENS_PER_TICKET * TICKETS_PER_DAY / 1_000_000 * price
    print(f"{label}: 每天 ¥{daily:.2f}, 每月(30 天) ¥{daily * 30:.1f}")
```

<div class="line-notes">

- `TOKENS_PER_TICKET = 97` 用练习 2 的实数,不用估算值。
- `TICKETS_PER_DAY = 10_000` 数字里的下划线只是为了好读,等于 10000。JS 里也能这么写:`10_000`。
- `PEAK, OFF_PEAK = 2.0, 1.0` 一行给两个变量赋值,其实是元组解包。
- `daily = TOKENS_PER_TICKET * TICKETS_PER_DAY / 1_000_000 * price` 97 × 10000 = 970,000 token,÷ 1,000,000 = 0.97 百万 token,× 2 元 = 1.94 元。
- `print(f"{label}: 每天 ¥{daily:.2f}, 每月(30 天) ¥{daily * 30:.1f}")` 实跑:高峰每天 ¥1.94、每月 ¥58.2;空闲每天 ¥0.97、每月 ¥29.1。

</div>

```bash
uv run part02/ticket_cost.py
```

```text
高峰: 每天 ¥1.94, 每月(30 天) ¥58.2
空闲: 每天 ¥0.97, 每月(30 天) ¥29.1
```

只发一次工单原文,一个月几十块钱。真实的客服 Agent 每张工单要调模型好几次,每次还带着系统提示词、工具说明、检索到的帮助文章和前面的对话,输入会是这个数字的几十倍,明天讲上下文窗口时就会看到它怎么涨上去。价格以 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) 为准,用之前再核一次。

</details>

**验收标准:** `count_tokens.py`、`compare_tokenizers.py`、`zh_en_ratio.py` 三个脚本跑出和文章一致的数字;能说出 DeepSeek 分词器下中文、英文、编号每字符大约多少 token;能用自己的话回答「中文费不费 token」,并且答案里提到分词器;能写出练习 4 的成本算式。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| tokenizers | Hugging Face 的分词器库,读 `tokenizer.json` 格式,核心用 Rust 写,很快。本课用它加载 DeepSeek 分词器 |
| tiktoken | OpenAI 的分词器库,内置 `cl100k_base`、`o200k_base` 等编码 |
| Encoding 对象 | `tokenizers` 编码后的结果,带 `ids`(编号)、`tokens`(词表写法)、`offsets`(对应原文位置) |
| offsets | 每个 token 在原文里的起止位置,形如 `(0, 2)`,用切片能取回原文 |
| cl100k_base | GPT-4、GPT-3.5 那一代的编码,词表约 10 万,对中文不友好 |
| o200k_base | GPT-4o 之后的编码,词表约 20 万,中文好了很多 |
| 预切分(pre-tokenization) | 合并之前先按规则粗切一刀,比如 DeepSeek 把数字三位一组、汉字和字母分开 |
| 格式开销 | 每次请求里角色标记、分隔符等占用的 token,单条消息时 DeepSeek 实测是 4 个 |
| prompt_tokens | API 返回的 `usage` 里「本次输入多少 token」的字段,Day 122 详讲 |
| `__file__` | 当前脚本文件自己的路径,相当于 Node 的 `__filename` |

## 常见误区

**按字数估成本。** 计费按 token,中文每字 0.62、英文每字符 0.22、编号每字符 0.47,三者差好几倍。估算可以用经验比例,预算和报价要用分词器数出来的真实数字。

**拿 OpenAI 的分词器数 DeepSeek 的 token。** 网上很多「token 计算器」默认用的是 OpenAI 的编码。同一句中文,cl100k 数出 30 个,DeepSeek 实际只收 16 个,差将近一倍。用谁的模型,就用谁的分词器。

**以为本地数的和 API 收的一样多。** 文本部分一样,但每次请求还有格式开销,单条消息 DeepSeek 是 4 个,多条消息更多。估一次请求的总输入,要把系统提示词、每条消息的开销都算进去。

**`cd` 进 `part02` 再运行,结果 `Exception: No such file or directory (os error 2)`。** 相对路径是相对当前目录算的。从 `agent-zero-lab` 根目录运行,或者用 `Path(__file__)` 从脚本位置算路径。

**为了数 token 装 `transformers`。** DeepSeek 示例代码用的是 `transformers`,它会拉一大堆机器学习依赖,在老 Intel Mac 上装起来又慢又占空间。只数 token 的话,`tokenizers` 一个包就够了,结果完全一样。

**工具结果用 Python 默认的 `json.dumps` 返回。** 默认 `ensure_ascii=True` 会把中文转成 `\uXXXX`,练习 3 实测同一张发票多花 60% 的 token。返回给模型的 JSON 记得加 `ensure_ascii=False`。

## 学习资料

### 文档与文章

- [DeepSeek:Token 用量计算](https://api-docs.deepseek.com/zh-cn/quick_start/token_usage):经验比例 0.3 / 0.6 和分词器下载都在这页,今天的实测就是在验证它。5 分钟。
- [DeepSeek:模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):练习 4 用的价格。注意高峰和空闲两档,以及缓存命中价,缓存后面会专门讲。
- [Hugging Face tokenizers 快速上手](https://huggingface.co/docs/tokenizers/quicktour):`Tokenizer.from_file`、`encode`、`offsets` 的官方说明,英文,看「Using the tokenizer」那一段就够。15 分钟。
- [tiktokenizer](https://tiktokenizer.vercel.app/):在线输入文字,彩色显示每个 token,能选 cl100k、o200k 等编码。把今天三段样本贴进去,和脚本结果对照。
- [The Tokenizer Playground](https://huggingface.co/spaces/Xenova/the-tokenizer-playground):Hugging Face 上的在线分词器对比,能选 Llama、Qwen 等开源模型的分词器,看看别家怎么切中文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1smXUYSEGi&autoplay=0&high_quality=1" title="大模型token究竟是啥?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>通俗解释 · 大模型token究竟是啥? · 不到 5 分钟,开始写代码之前先看,把「token 和字不是一回事」再过一遍。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1AYdiYpE65&autoplay=0&high_quality=1" title="【分词:中文分词】BPE字节级分词算法实现汉字表达!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI扫地曾 · 【分词:中文分词】BPE字节级分词算法实现汉字表达! · 10 分钟,讲汉字怎么在字节级 BPE 里被表示,看完就明白 cl100k 为什么把「被」切成两个 `�`。</figcaption>
</figure>

- 请叫我AXin《大语言模型LLM基础之Tokenizer完全介绍》(BV1Fc411C7sz,56 分钟):从分词器的历史讲到 BPE、WordPiece、SentencePiece 的区别,想再往下挖的人看。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/7xTGNNLPyMI" title="Deep Dive into LLMs like ChatGPT" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Andrej Karpathy · Deep Dive into LLMs like ChatGPT · 3.5 小时,今天只看「tokenization」那一章(7:47 到 14:27),他会在 tiktokenizer 网站上现场演示同一句话怎么被切。B 站有中字搬运 BV16cNEeXEer。</figcaption>
</figure>

### 书籍

- 《图解大模型:生成式 AI 原理与实战》(Jay Alammar、Maarten Grootendorst 著,人民邮电出版社,2025;英文原版《Hands-On Large Language Models》,O'Reilly,2024):第 2 章有一节专门拿同一段文本去比较多个真实模型的分词器(包括 GPT-4 和几个开源模型),和今天的 `compare_tokenizers.py` 是同一个实验,可以看看更多分词器的结果。

### 开源项目与代码

- [openai/tiktoken](https://github.com/openai/tiktoken):README 里有各编码对应哪些模型的说明。
- [huggingface/tokenizers](https://github.com/huggingface/tokenizers):今天用的库,README 有 Python 用法。

## 自测

1. DeepSeek 分词器下,`INV-2026-004417` 被切成了哪几块?为什么 `2026` 不是一整块?

<details><summary>答案</summary>

切成 `IN`、`V`、`-`、`202`、`6`、`-`、`004`、`417` 共 8 块。DeepSeek 分词器在合并之前有一步预切分,数字最多三个一组,所以 `2026` 一定会被切成 `202` 和 `6`,不可能是一整块。前面没有空格的 `INV` 还被切成了 `IN` 和 `V`,带空格的 ` INV` 才是整块。

</details>

2. 有人说「中文比英文贵三倍,因为一个汉字 0.6 个 token,一个英文字母才 0.2 个」。这句话错在哪?

<details><summary>答案</summary>

把「每字符」当成了「每个意思」。表达同一个意思,中文的字数比英文字母数少得多。实测三组同义句,DeepSeek 下中文 36 个 token、英文 46 个,中文反而省;只有在中文语料少的分词器(比如 cl100k)下,中文才明显更贵,也只贵 35%,不是三倍。

</details>

3. 你用网上一个 token 计算器数了一段中文提示词,得到 300 个 token,于是按这个数给 DeepSeek 的调用做预算。可能有什么问题?

<details><summary>答案</summary>

很多在线计算器默认用 OpenAI 的编码,和 DeepSeek 的分词器不一样,中文差别尤其大(实测同一句 cl100k 30 个、DeepSeek 16 个)。另外每次请求还有格式开销,系统提示词、多条消息都会额外占 token。应该用 DeepSeek 自己的分词器数,并加上开销,或者直接看 API 返回的 usage。

</details>

4. 本地用分词器数出一句话是 16 个 token,API 返回 `prompt_tokens=20`。多出来的 4 个是什么?

<details><summary>答案</summary>

消息格式的开销:角色标记、分隔符等,模型的输入里不只有你的文字。单条消息时 DeepSeek 实测固定多 4 个,去掉这部分,本地数和 API 数完全一致。

</details>

5. 面试题:你在做一个面向中文用户的客服 Agent,老板问「同样单价的两个模型,为什么实际账单差了三成?」你会从哪几个方向排查?

<details><summary>答案</summary>

第一,分词器不同:同样的中文,不同模型切出的 token 数可能差 30% 到一倍,单价一样不代表单次成本一样,要用各自的分词器数同一批真实工单。第二,输入的组成:系统提示词、工具说明、工具结果的 JSON 格式(缩进、中文转义)都会放大 token 数。第三,输出长度和思考模式:有的模型回答更啰嗦,或者默认开了思考,输出 token 更贵。第四,缓存命中率不同,缓存价差别很大。排查办法是拿同一批请求,对比两边 usage 里的输入、输出、缓存命中三个数。

</details>

## 明天预告

Day 109 · 上下文窗口:模型能看到的全部世界。今天学会了数 token,明天就拿这个能力去量「窗口」:DeepSeek 的 1M 窗口到底能装下几本书(《西游记》整本 64 万个 token),装不下时 API 报什么错,多轮对话越聊越长时怎么把最早的消息丢掉又不丢掉系统提示词。还会讲为什么窗口大不等于都能用好。
