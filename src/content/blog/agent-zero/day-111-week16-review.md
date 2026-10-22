---
title: 'Day 111 · 第 16 周复习:大模型与 API(Day 105–110)'
description: '这一周从「模型只做一件事」走到 token、上下文窗口和采样。今天把它们画成一条流水线,逐天一句话回顾,再用一张手写的「下一个词概率表」拼一个会自回归、会按温度采样、会被 max_steps 截断的迷你生成器,最后把这周的坑过一遍。'
pubDate: 2026-10-22
regime: none
tags: ['llm-basics', 'review', 'python', 'agent-zero']
series: 'agent-zero'
day: 111
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 110](/blog/agent-zero/day-110-sampling-1/) 拿 DeepSeek 返回的一张真实概率表(「简」0.321、「轻」0.313……),用 `random.choices` 掷了一千次骰子,又亲手写了 `apply_temperature`:温度小于 1 概率表变尖,大于 1 变平,效果等于每个概率取 1/t 次方再归一。最后在 API 上看到,temperature=0 问 8 次也出了「轻账」「简账」两种答案。

这一周是第二部分「大模型与 API」的第一周,概念一个接一个,而且彼此咬得很紧:不懂 token 就算不清窗口,不懂自回归就想不明白采样为什么每一步都要做。今天不讲新东西,把它们串成一条线,再用一个小项目把这条线亲手跑一遍。

## 今天要解决的问题

学完今天,你应该能做到:

1. 不看文章,画出「文字 → token → 窗口 → 模型 → 概率表 → 采样 → 下一个 token」这条线,并说出每一段是哪一天讲的。
2. 默写出 `apply_temperature`、`sample`(Day 110)和 `trim`(Day 109)三个函数,跑出和原文一致的结果。
3. 写完 `mini_generator.py`:一个只用本周知识的玩具生成器,能自回归地生成客服回复、按温度采样、被步数上限截断,并用 DeepSeek 分词器数出回复的 token 数。
4. 对着本周的坑清单,每一条都能说出现象和修法。

预计用时:3 小时左右(复习日,默写和小项目占大头)。前置:Day 105–110 全部,特别是 [Day 108](/blog/agent-zero/day-108-tokens-2/) 的分词器、[Day 109](/blog/agent-zero/day-109-context-window/) 的 `trim_history.py`、[Day 110](/blog/agent-zero/day-110-sampling-1/) 的 `temperature_math.py` 和 `sampler.py`。

学法提示:先不看文章,把知识地图在纸上画一遍再对照下面的图;小项目对照逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,把 `generate` 函数默写出来;动手练习做不出再展开参考答案,看完关掉,自己重写一遍。

## 本周知识地图

这一周学的东西,其实就是**一次调用里一个 token 是怎么来的**。把它画成一条流水线:

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="本周知识地图:文字经分词变成 token,装进窗口送进模型,模型给出概率表,采样挑出下一个 token 接回输入">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="30" width="100" height="46" rx="4" fill="none" stroke="var(--rule)"/>
<text x="66" y="50" text-anchor="middle" fill="var(--ink)">文字</text>
<text x="66" y="67" text-anchor="middle" fill="var(--ink-faint)">发票被重复扣款</text>
<line x1="116" y1="53" x2="146" y2="53" stroke="var(--ink-soft)"/>
<rect x="146" y="30" width="110" height="46" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="201" y="50" text-anchor="middle" fill="var(--ink)">分词 → token</text>
<text x="201" y="67" text-anchor="middle" fill="var(--ink-faint)">Day 107 · 108</text>
<line x1="256" y1="53" x2="286" y2="53" stroke="var(--ink-soft)"/>
<rect x="286" y="30" width="130" height="46" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="351" y="50" text-anchor="middle" fill="var(--ink)">装进窗口?</text>
<text x="351" y="67" text-anchor="middle" fill="var(--ink-faint)">Day 109 · 1,048,576</text>
<line x1="416" y1="53" x2="446" y2="53" stroke="var(--ink-soft)"/>
<rect x="446" y="30" width="178" height="46" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="535" y="50" text-anchor="middle" fill="var(--ink)">模型:给出概率表</text>
<text x="535" y="67" text-anchor="middle" fill="var(--ink-faint)">Day 106 · 简 0.32 轻 0.31</text>
<line x1="535" y1="76" x2="535" y2="116" stroke="var(--ink-soft)"/>
<rect x="420" y="116" width="204" height="46" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="522" y="136" text-anchor="middle" fill="var(--ink)">采样:temperature</text>
<text x="522" y="153" text-anchor="middle" fill="var(--ink-faint)">Day 110 · 掷骰子</text>
<line x1="420" y1="139" x2="300" y2="139" stroke="var(--ink-soft)"/>
<rect x="170" y="116" width="130" height="46" rx="4" fill="none" stroke="var(--rule)"/>
<text x="235" y="136" text-anchor="middle" fill="var(--ink)">下一个 token</text>
<text x="235" y="153" text-anchor="middle" fill="var(--ink-faint)">结束?到上限?</text>
<line x1="235" y1="116" x2="235" y2="90" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<line x1="235" y1="90" x2="351" y2="90" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<line x1="351" y1="90" x2="351" y2="76" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<text x="16" y="136" fill="var(--ink-soft)">没结束 → 接回</text>
<text x="16" y="153" fill="var(--ink-soft)">输入末尾再来一遍</text>
<text x="16" y="200" fill="var(--ink-faint)">虚线 = 自回归(Day 106):每生成一个 token 都把它接回窗口,整条线再走一遍</text>
<text x="16" y="222" fill="var(--ink-faint)">token 数决定花多少钱(Day 108)和窗口还剩多少(Day 109)</text>
<text x="16" y="244" fill="var(--ink-faint)">蓝 = 模型本身;琥珀 = 模型之外、由你的代码或参数决定的部分</text>
</g>
</svg>
<figcaption>第 16 周的全部内容都在这条线上。除了蓝色那一格,其他每一格都是你写代码时能看见、能控制的。</figcaption>
</figure>

这张图里有一件事值得单独拎出来说:**模型本身只占一格**。分词是固定的规则,窗口是硬上限,采样是你传的参数决定的,停不停是你设的上限决定的。后面学 Agent,你写的代码几乎全在这几格琥珀色里做文章。

## 本周每天一句话

- [Day 105](/blog/agent-zero/day-105-part1-review/) · 第一部分总复习:把 106 天的编程地基做了一次 30 题自检,从这周起正式进入大模型。
- [Day 106](/blog/agent-zero/day-106-next-token/) · 大模型只做一件事:根据前面所有 token 算出下一个 token 的概率表,挑一个接到末尾,循环,这叫自回归生成。
- [Day 107](/blog/agent-zero/day-107-tokens-1/) · Token(一):模型看到的是 token 编号不是字,BPE 从字节起步、把最常挨着的两块反复合并;DeepSeek 词表有 12 万多项。
- [Day 108](/blog/agent-zero/day-108-tokens-2/) · Token(二):用 `tokenizers` 数出 DeepSeek 下中文每字 0.62 个 token、英文每字符 0.22 个,本地数的和 API 收的只差 4 个格式开销。
- [Day 109](/blog/agent-zero/day-109-context-window/) · 上下文窗口:输入加输出一共最多 1,048,576 个 token,模型没有记忆,超了回 400,装不下就要截断,而截断最先丢的往往是最关键的开头。
- [Day 110](/blog/agent-zero/day-110-sampling-1/) · 采样(一):输出哪个 token 是按概率掷骰子决定的,temperature 在掷之前把概率表压尖或拍平;temperature=0 是贪心,但服务端不保证每次一样。

如果哪一句你读完没法立刻接着往下讲两分钟,就回那一天把正文重读一遍,再做一遍那天的练习 1。

## 本周的几个关键数字

复习时把数字记住,面试和估算时都用得上。这些全是这一周实跑出来的:

| 数字 | 出处 | 用途 |
| --- | --- | --- |
| 中文每字约 0.62 个 token | Day 108,DeepSeek 分词器 | 估中文工单、文档的 token 数 |
| 英文每字符约 0.22 个 token | Day 108 | 估英文内容 |
| 单条消息格式开销 4 个 token | Day 108,和 API 对账 | 估一次请求的真实输入 |
| 窗口 1,048,576,最大输出 384K | Day 109,API 报错原文和定价页 | 判断装不装得下 |
| 繁体《西游记》639,105 个 token | Day 109 | 「1M 有多大」的直观参照 |
| 输入 2 元、输出 8 元每百万 token | Day 108,`deepseek-flash` 高峰价 | 算钱 |
| temperature 0 到 2,默认 1 | Day 110,DeepSeek 文档 | 调参范围 |

## 小项目:手写一个迷你生成器

本周的小项目只用这一周学的东西:自回归(Day 106)、数 token(Day 108)、输出上限(Day 109)、按温度采样(Day 110)。我们不调 API,而是**手写一张「下一个词」的概率表**,假装它就是模型,然后让它一个词一个词地生成客服回复。

真模型的概率表是根据前面全部内容算出来的;我们的玩具简化到极点,只看「上一个词」是什么。比如上一个词是「发票」,下一个词 50% 是「已经」、40% 是「正在」、10% 是「被」。这种只看前一个词的模型有个老名字叫 bigram 模型,在神经网络流行之前真的有人这么做语言模型。它很蠢,但正好把流水线上每一格都露出来了。

新建 `part02/mini_generator.py`:

```python
# agent-zero-lab/part02/mini_generator.py
from collections import Counter

from tokenizers import Tokenizer

from sampler import sample

tok = Tokenizer.from_file("data/deepseek_v4_tokenizer/tokenizer.json")

NEXT: dict[str, dict[str, float]] = {
    "<开始>": {"您好": 0.6, "你好": 0.3, "亲": 0.1},
    "您好": {",": 1.0},
    "你好": {",": 1.0},
    "亲": {",": 1.0},
    ",": {"发票": 0.5, "退款": 0.3, "账单": 0.2},
    "发票": {"已经": 0.5, "正在": 0.4, "被": 0.1},
    "退款": {"已经": 0.4, "正在": 0.6},
    "账单": {"已经": 0.5, "正在": 0.5},
    "已经": {"重新开具": 0.5, "处理好了": 0.4, "退回": 0.1},
    "正在": {"处理": 0.8, "核对": 0.2},
    "被": {"退回": 1.0},
    "重新开具": {"。": 1.0},
    "处理好了": {"。": 1.0},
    "退回": {"。": 1.0},
    "处理": {"。": 0.7, ",": 0.3},
    "核对": {"。": 0.6, ",": 0.4},
    "。": {"<结束>": 0.9, "您好": 0.1},
}


def generate(t: float, max_steps: int) -> tuple[str, str]:
    pieces: list[str] = []
    last = "<开始>"
    while len(pieces) < max_steps:
        nxt = sample(NEXT[last], t)
        if nxt == "<结束>":
            return "".join(pieces), "stop"
        pieces.append(nxt)
        last = nxt
    return "".join(pieces), "length"


if __name__ == "__main__":
    for t in (0, 1.0, 2.0):
        results = [generate(t, max_steps=8) for _ in range(200)]
        texts = Counter(text for text, _ in results)
        cut = sum(1 for _, reason in results if reason == "length")
        print(f"t={t}: {len(texts)} 种回复, 被 max_steps 截断 {cut} 次")
        for text, n in texts.most_common(2):
            ids = tok.encode(text, add_special_tokens=False).ids
            print(f"    {n:>3} 次  {text}  ({len(ids)} 个 DeepSeek token)")
        cut_texts = [text for text, reason in results if reason == "length"]
        if cut_texts:
            print(f"    截断的例子: {cut_texts[0]}")
```

<div class="line-notes">

- `from tokenizers import Tokenizer` Day 108 装的分词器库,用来数生成结果的真实 token 数。
- `from sampler import sample` 直接复用 Day 110 写的 `sample(dist, t)`:t=0 选最大的,否则先 `apply_temperature` 再掷骰子。这就是 Day 110 加 `if __name__ == "__main__":` 的回报。
- `tok = Tokenizer.from_file("data/deepseek_v4_tokenizer/tokenizer.json")` 和 Day 108、109 同一个文件。要在 `agent-zero-lab` 根目录运行,否则相对路径找不到(Day 108 的坑)。
- `NEXT: dict[str, dict[str, float]] = {` 嵌套字典([Day 26](/blog/agent-zero/day-026-nested-data/)):外层键是「上一个词」,值是一张概率表,和 Day 110 的 `next_token_dist.json` 形状一样。类型标注读作「字符串 → (字符串 → 小数)」。
- `"<开始>": {"您好": 0.6, "你好": 0.3, "亲": 0.1},` 生成的第一步。尖括号的「开始」「结束」是我们约定的特殊记号,真实模型里也有类似的特殊 token,Day 110 的 logprobs 里就出现过 `<｜end▁of▁sentence｜>`。
- `",": {"发票": 0.5, "退款": 0.3, "账单": 0.2},` 逗号后面说什么事。注意这一行和「处理」「核对」后面的逗号是同一个键,所以句子可以绕回来,这是故意设的「环」,用来演示停不下来的情况。
- `"。": {"<结束>": 0.9, "您好": 0.1},` 句号后 90% 结束,10% 又从「您好」开始说第二句。
- `def generate(t: float, max_steps: int) -> tuple[str, str]:` 返回两个值:生成的文本和停下的原因。`tuple[str, str]` 是[元组](/blog/agent-zero/day-022-tuples-unpack/)的类型标注。
- `pieces: list[str] = []` 已经生成的词。
- `last = "<开始>"` 当前的「上一个词」。真模型看的是窗口里的全部内容,我们只看这一个,这是玩具和真货最大的区别。
- `while len(pieces) < max_steps:` 步数上限,相当于 API 的 `max_tokens`(Day 109)。没有它,遇到环就可能一直生成下去。
- `nxt = sample(NEXT[last], t)` 查出「上一个词」对应的概率表,按温度采样一个。这一行就是流水线里「模型给概率表 → 采样」那两格。
- `if nxt == "<结束>":` 抽到结束记号就停,原因记作 `"stop"`,和 API 返回的 `finish_reason` 用的是同一个词(Day 122 讲)。
- `pieces.append(nxt)` 把新词接到末尾。
- `last = nxt` 下一步就以它为「上一个词」。这两行合起来就是自回归:输出变成下一步的输入。
- `return "".join(pieces), "length"` 循环正常结束说明到了上限还没抽到结束,原因记作 `"length"`,API 里被 `max_tokens` 截断时也是这个词。
- `results = [generate(t, max_steps=8) for _ in range(200)]` 每个温度生成 200 条回复,上限 8 步。
- `texts = Counter(text for text, _ in results)` 数每种回复出现几次。`for text, _ in results` 是边遍历边解包元组,停止原因用不上就写 `_`。
- `cut = sum(1 for _, reason in results if reason == "length")` 数一共被截断了几次。带 `if` 的生成器表达式,相当于 JS 的 `results.filter(([, r]) => r === "length").length`。
- `ids = tok.encode(text, add_special_tokens=False).ids` 用 DeepSeek 分词器数这条回复在真模型那里算几个 token。「您好,发票已经重新开具。」实跑 7 个。
- `cut_texts = [text for text, reason in results if reason == "length"]` 把被截断的回复挑出来,打印第一条看看长什么样。

</div>

```bash
uv run part02/mini_generator.py
```

实跑输出(t=1.0 和 t=2.0 两组每次都会不一样):

```text
t=0: 1 种回复, 被 max_steps 截断 0 次
    200 次  您好,发票已经重新开具。  (7 个 DeepSeek token)
t=1.0: 74 种回复, 被 max_steps 截断 36 次
     13 次  您好,发票已经处理好了。  (7 个 DeepSeek token)
     11 次  您好,账单正在处理。  (6 个 DeepSeek token)
    截断的例子: 您好,退款已经重新开具。您好,
t=2.0: 99 种回复, 被 max_steps 截断 75 次
     10 次  您好,发票被退回。  (6 个 DeepSeek token)
      9 次  您好,发票已经处理好了。  (7 个 DeepSeek token)
    截断的例子: 您好,账单已经重新开具。您好,
```

逐组读一下,每一行都对应本周的一个知识点:

**t=0 时 200 次一模一样。** 每一步都选最大的:开头「您好」(0.6)、逗号、「发票」(0.5)、「已经」(0.5)、「重新开具」(0.5)、句号、结束(0.9)。贪心解码在我们这个固定的概率表上是完全确定的。注意「已经」后面「重新开具」0.5 对「处理好了」0.4,如果这两个数改成 0.45 对 0.45,`max` 会选字典里排在前面的那个,这就是 Day 110 讲的「打平时谁赢取决于细节」。

**t=1.0 时有 74 种回复,t=2.0 时有 99 种。** 温度越高越分散,和 Day 110 在 API 上看到的趋势一样。t=2.0 时最常见的回复才出现 10 次,概率表已经被拍得很平了。

**截断次数从 0 涨到 36 再到 75。** 温度越高,越容易抽到「处理 → ,」「。→ 您好」这种绕回去的路,句子越写越长,撞到 8 步的上限。看截断的例子「您好,退款已经重新开具。您好,」:话说到一半就停了。真实 API 也一样,`max_tokens` 设小了,回复会被拦腰截断,`finish_reason` 是 `length`。Agent 拿到半截 JSON 去解析就会报错,这是后面会反复遇到的坑。

**「退款已经重新开具」是句病句。** 我们的玩具只看上一个词「已经」,它不知道前面说的是退款还是发票。真实模型能写出通顺的长文,恰恰是因为它每一步看的是整个窗口里的全部内容(Day 109)。窗口里没有的东西,它就不知道,这句病句就是一个最小的演示。

**token 数。** 「您好,发票已经重新开具。」12 个字符,DeepSeek 分词器数出来 7 个 token,和 Day 108 说的中文每字 0.6 个左右对得上(这里的逗号是半角,也占 token)。

### 零件 → 小项目对照

| 本周学的零件 | 在 `mini_generator.py` 的哪里 |
| --- | --- |
| Day 106 自回归 | `pieces.append(nxt)` 和 `last = nxt` |
| Day 107 特殊 token | `"<开始>"`、`"<结束>"` 两个记号 |
| Day 108 数 token | `tok.encode(text, add_special_tokens=False).ids` |
| Day 109 输出上限和截断 | `while len(pieces) < max_steps` 和返回的 `"length"` |
| Day 110 按温度采样 | `sample(NEXT[last], t)` |

## 本周错题与坑清单

把这一周每天「常见误区」里最容易再犯的挑出来,每条写现象和修法。复习时盖住右边一列,看左边能不能说出来。

| 坑 | 现象 | 修法 |
| --- | --- | --- |
| 以为一个汉字是一个 token | 「发票」两个字 1 个 token,「饕餮」两个字 4 个 | 用分词器数,不要按字数猜(Day 107) |
| 用 `vocab["发票"]` 查编号 | `KeyError: '发票'` | 字节级词表里汉字存成了映射后的字符,用分词器编码(Day 107) |
| `cd part02` 后运行 | `Exception: No such file or directory (os error 2)` | 从 `agent-zero-lab` 根目录运行(Day 108) |
| 拿 OpenAI 的分词器数 DeepSeek | 同一句 cl100k 数 30,DeepSeek 实收 16 | 用谁的模型就用谁的分词器(Day 108) |
| `json.dumps` 不加 `ensure_ascii=False` | 中文变 `\uXXXX`,同一张发票多花 60% 的 token | 返回给模型的 JSON 加 `ensure_ascii=False`(Day 108) |
| 以为模型记得之前的对话 | 截断后模型不知道发票号 | API 无状态,关键信息要钉住或单独带上(Day 109) |
| 用 `history[-N:]` 截断 | `system 还在吗? False`,不报错 | 系统提示词单独拿出来(Day 109) |
| 以为窗口只限制输入 | `1286644 in the messages, 1 in the completion` | 输入加 `max_tokens` 一起不能超窗口(Day 109) |
| 自己实现 temperature 不处理 0 | `ZeroDivisionError: float division by zero` | t=0 走「选最大的」分支(Day 110) |
| 以为 temperature=0 每次一样 | API t=0 问 8 次出了两种名字 | 只是尽量确定,测试和评测要允许波动(Day 110) |
| 传了 temperature 没效果 | DeepSeek 输出照样在变 | 默认开着思考模式,要关掉才生效(Day 110) |

## 动手练习

**练习 1:默写 temperature 和采样。** 不看 Day 110,在 `part02/review_sampler.py` 里写出 `apply_temperature(dist, t)` 和 `sample(dist, t)` 两个函数,然后读 `data/next_token_dist.json`,打印 t=0.5 时「简」「轻」「账」三个的概率,以及 t=0 时 `sample` 的结果。要和 Day 110 的 `temperature_math.py` 输出一致。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/review_sampler.py
import json
import math
import random
from pathlib import Path


def apply_temperature(dist: dict[str, float], t: float) -> dict[str, float]:
    scores = {tok: math.log(p) / t for tok, p in dist.items()}
    exps = {tok: math.exp(s) for tok, s in scores.items()}
    total = sum(exps.values())
    return {tok: e / total for tok, e in exps.items()}


def sample(dist: dict[str, float], t: float) -> str:
    if t == 0:
        return max(dist, key=lambda tok: dist[tok])
    new = apply_temperature(dist, t)
    return random.choices(list(new.keys()), weights=list(new.values()))[0]


dist: dict[str, float] = json.loads(Path("data/next_token_dist.json").read_text(encoding="utf-8"))
half = apply_temperature(dist, 0.5)
print({tok: round(half[tok], 3) for tok in ["简", "轻", "账"]})
print("t=0 选:", sample(dist, 0))
```

<div class="line-notes">

- `scores = {tok: math.log(p) / t for tok, p in dist.items()}` 取对数再除以温度。默写时最容易忘的是 `math.log`,直接拿概率除以温度是错的(练习 2 会演示)。
- `exps = {tok: math.exp(s) for tok, s in scores.items()}` 变回正数。
- `return {tok: e / total for tok, e in exps.items()}` 归一,这三行就是 softmax。
- `if t == 0:` 别忘了 0 的特殊处理,否则 `ZeroDivisionError`。
- `return max(dist, key=lambda tok: dist[tok])` 贪心,选概率最大的键。
- `print({tok: round(half[tok], 3) for tok in ["简", "轻", "账"]})` 实跑 `{'简': 0.415, '轻': 0.395, '账': 0.147}`,和 Day 110 表格 t=0.5 那一行一致。

</div>

```bash
uv run part02/review_sampler.py
```

```text
{'简': 0.415, '轻': 0.395, '账': 0.147}
t=0 选: 简
```

</details>

**练习 2:默写时最常见的错,故意犯一次。** 很多人默写 `apply_temperature` 时会写成「概率直接除以温度再归一」:`scores = {tok: p / t ...}`,然后不取 `exp` 直接归一。写一个 `wrong_temperature`,用 t=0.5 和 t=2.0 各算一遍,和正确版对比「简」的概率,看看错在哪。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/wrong_temperature.py
import json
from pathlib import Path

from temperature_math import apply_temperature


def wrong_temperature(dist: dict[str, float], t: float) -> dict[str, float]:
    scores = {tok: p / t for tok, p in dist.items()}
    total = sum(scores.values())
    return {tok: s / total for tok, s in scores.items()}


dist: dict[str, float] = json.loads(Path("data/next_token_dist.json").read_text(encoding="utf-8"))
for t in (0.5, 2.0):
    right = apply_temperature(dist, t)["简"]
    wrong = wrong_temperature(dist, t)["简"]
    print(f"t={t}: 正确 {right:.3f}  错误写法 {wrong:.3f}")
```

<div class="line-notes">

- `scores = {tok: p / t for tok, p in dist.items()}` 错误写法:每个概率都除以同一个数。
- `return {tok: s / total for tok, s in scores.items()}` 再归一。所有数同时除以 t 再除以总和,t 被约掉了,结果和原概率一模一样。
- `print(f"t={t}: 正确 {right:.3f}  错误写法 {wrong:.3f}")` 实跑两档温度的错误写法都是 0.323,温度完全没起作用。

</div>

```bash
uv run part02/wrong_temperature.py
```

```text
t=0.5: 正确 0.415  错误写法 0.323
t=2.0: 正确 0.235  错误写法 0.323
```

错误写法不管温度是多少,「简」都是 0.323,也就是原始概率重新归一。原因是「每个数除以同一个 t」只是整体缩放,归一时又除回去了。temperature 起作用,靠的是先 `log` 再 `exp`:除以 t 发生在指数上,等价于 1/t 次方,大小之间的差距才会被放大或缩小。这个 bug 不报错,数字看起来也很正常,只有和已知结果对比才发现得了,所以默写完一定要拿 Day 110 的表对一下。

</details>

**练习 3:默写截断函数。** 不看 Day 109,在 `part02/review_trim.py` 里写出 `count`、`total`、`trim` 三个函数(每条消息按内容 token 数 + 4 算),用 Day 109 那段 6 条的客服对话、预算 80 跑一遍,结果要是「裁剪后 4 条, 66 token」。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/review_trim.py
from tokenizers import Tokenizer

tok = Tokenizer.from_file("data/deepseek_v4_tokenizer/tokenizer.json")
PER_MESSAGE = 4


def count(msg: dict[str, str]) -> int:
    return len(tok.encode(msg["content"], add_special_tokens=False).ids) + PER_MESSAGE


def total(messages: list[dict[str, str]]) -> int:
    return sum(count(m) for m in messages)


def trim(messages: list[dict[str, str]], budget: int) -> list[dict[str, str]]:
    system, rest = messages[0], messages[1:]
    while rest and count(system) + total(rest) > budget:
        rest.pop(0)
    return [system, *rest]


history = [
    {"role": "system", "content": "你是云簿 CloudLedger 的客服,只回答账单和发票问题,不要编造政策。"},
    {"role": "user", "content": "你好,我叫王小明,我的发票 INV-2026-004417 被重复扣款了。"},
    {"role": "assistant", "content": "收到,我先帮您查一下这张发票的扣款记录。"},
    {"role": "user", "content": "好的,另外发票抬头能不能改成公司名?"},
    {"role": "assistant", "content": "可以,请在设置里修改抬头后重新开具。"},
    {"role": "user", "content": "那重复扣的钱什么时候退?"},
]

kept = trim(list(history), 80)
print(f"裁剪后 {len(kept)} 条, {total(kept)} token")
print([m["role"] for m in kept])
```

<div class="line-notes">

- `PER_MESSAGE = 4` 每条消息的格式开销,故意按偏多的 4 算(Day 109 实测多条时平均两三个)。
- `system, rest = messages[0], messages[1:]` 关键的一行:系统提示词单独拿出来,永不参与截断。
- `while rest and count(system) + total(rest) > budget:` 还有可丢的、并且超预算,就继续丢。
- `rest.pop(0)` 丢最早的一条,相当于 JS 的 `shift()`。
- `return [system, *rest]` 系统提示词放回最前面。
- `kept = trim(list(history), 80)` 预算 80,6 条一共 110,要丢 30 个以上。
- `print([m["role"] for m in kept])` 实跑 `['system', 'user', 'assistant', 'user']`,第一条还是 system。

</div>

```bash
uv run part02/review_trim.py
```

```text
裁剪后 4 条, 66 token
['system', 'user', 'assistant', 'user']
```

和 Day 109 的 `trim_history.py` 结果一致。

</details>

**练习 4:给迷你生成器算账。** 写 `part02/mini_generator_cost.py`:导入 `generate`,在 t=0、1.0、2.0 下各生成 200 条回复(`max_steps=8`),用 DeepSeek 分词器数每条的 token 数,打印平均值、最长值,以及按输出价 8 元每百万 token 算,一万条这样的回复要多少输出费。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/mini_generator_cost.py
from tokenizers import Tokenizer

from mini_generator import generate

tok = Tokenizer.from_file("data/deepseek_v4_tokenizer/tokenizer.json")
OUTPUT_PRICE_PER_M = 8.0

for t in (0, 1.0, 2.0):
    lengths = [len(tok.encode(generate(t, max_steps=8)[0], add_special_tokens=False).ids) for _ in range(200)]
    avg = sum(lengths) / len(lengths)
    cost = avg * 10_000 / 1_000_000 * OUTPUT_PRICE_PER_M
    print(f"t={t}: 平均 {avg:.2f} 个 token, 最长 {max(lengths)}, 一万条回复输出费 ¥{cost:.3f}")
```

<div class="line-notes">

- `from mini_generator import generate` 复用小项目里的函数。`mini_generator.py` 的打印都在 `if __name__ == "__main__":` 下面,导入时不会执行。
- `OUTPUT_PRICE_PER_M = 8.0` `deepseek-flash` 高峰时段输出价,8 元每百万 token(2026 年 10 月查 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing))。输出比输入贵 4 倍。
- `lengths = [len(tok.encode(generate(t, max_steps=8)[0], add_special_tokens=False).ids) for _ in range(200)]` 从里往外读:`generate(...)` 返回 `(文本, 原因)`,`[0]` 取文本,编码,数 id 的个数。一行挤了三件事,读不顺的话拆成三行也完全可以。
- `avg = sum(lengths) / len(lengths)` 平均 token 数。t=0 时每条都是 7。
- `cost = avg * 10_000 / 1_000_000 * OUTPUT_PRICE_PER_M` t=0:7 × 10,000 ÷ 1,000,000 × 8 = 0.56 元。

</div>

```bash
uv run part02/mini_generator_cost.py
```

```text
t=0: 平均 7.00 个 token, 最长 7, 一万条回复输出费 ¥0.560
t=1.0: 平均 6.92 个 token, 最长 9, 一万条回复输出费 ¥0.553
t=2.0: 平均 7.22 个 token, 最长 9, 一万条回复输出费 ¥0.578
```

三档温度的平均长度差别不大,因为 `max_steps=8` 把长的都截住了,最长也就 9 个 token。这正是 `max_tokens` 在真实 API 里的另一个作用:**给每次调用的输出费设上限**。没有上限时,温度高的那一档会更容易绕进环里越写越长。真实场景的回复是几百个 token,算法完全一样,把 7 换成你实测的平均长度就行。

</details>

**验收标准:** 不看文章画出知识地图并标对每一格的 Day;`review_sampler.py`、`review_trim.py` 默写出来且输出和文章一致;能解释练习 2 的错误写法为什么让温度失效;`mini_generator.py` 跑通,能对着输出讲出每一组结果对应本周哪个知识点;坑清单盖住右列能说出修法。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| bigram 模型 | 只根据「上一个词」决定下一个词概率的语言模型,今天小项目里的 `NEXT` 就是一个手写的 bigram 模型。真实大模型看的是整个窗口 |
| 特殊记号 / 特殊 token | 不对应普通文字、用来标记开始或结束等位置的记号,如今天的 `<开始>`、`<结束>`,DeepSeek 的 `<｜end▁of▁sentence｜>` |
| 停止原因(finish_reason) | 生成为什么停下:`stop` 是自己说完了,`length` 是撞到输出上限被截断,Day 122 讲 API 里的这个字段 |
| 知识地图 | 把一周学的概念画成一张图,看清它们之间的先后和依赖 |

本周其他术语(token、BPE、词表、上下文窗口、截断、logprob、softmax、temperature、贪心解码等)见各天的名词解释,这里不重复。

## 常见误区

**以为复习日就是把文章再读一遍。** 读的时候每句都觉得懂,合上文章写不出来。复习日的重点是默写和对答案,练习 2 那种「数字看起来正常但其实全错」的 bug,只有自己写一遍才会撞上。

**默写 temperature 时省掉 log 和 exp。** 实跑错误写法在 t=0.5 和 t=2.0 下「简」都是 0.323,温度完全失效,而且不报错。除以 t 必须发生在对数上。

**以为玩具生成器的病句是采样的问题。** 「退款已经重新开具」不是温度太高,是 bigram 模型只看上一个词,不知道前面说的是退款。真模型不出这种错,靠的是每一步都看整个窗口。

**忘了 `max_steps` / `max_tokens`。** 概率表里有环(「处理 → ,」),不设上限就可能一直生成。实跑 t=2.0 时 200 条里有 75 条撞到了上限。真实 API 里它同时是输出费的上限。

**在 `part02` 目录里运行小项目。** `Tokenizer.from_file("data/...")` 用的是相对路径,和 Day 108 的坑一样,会报找不到文件。在 `agent-zero-lab` 根目录 `uv run part02/mini_generator.py`。

## 学习资料

### 文档与文章

- 本周六篇正文就是最好的复习资料:[Day 106](/blog/agent-zero/day-106-next-token/)、[Day 107](/blog/agent-zero/day-107-tokens-1/)、[Day 108](/blog/agent-zero/day-108-tokens-2/)、[Day 109](/blog/agent-zero/day-109-context-window/)、[Day 110](/blog/agent-zero/day-110-sampling-1/)。只重读你默写卡住的那一节。
- [DeepSeek:模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):本周用到的窗口、最大输出、价格都在这一页,复习时对一下数字。
- [Hugging Face:How to generate text](https://huggingface.co/blog/how-to-generate):英文,从贪心到采样再到 top-k、top-p,一篇串起 Day 110 和明天的内容,今天读到 Sampling 那一节为止。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1cuMJztEcL&autoplay=0&high_quality=1" title="AI根本无记忆!一条视频搞懂 大模型上下文窗口!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>清华姜学长 · AI根本无记忆!一条视频搞懂 大模型上下文窗口! · 10 分钟。Day 109 推荐过,复习时再看一遍,重点听「每轮都要重新发」那一段,和今天小项目里「玩具只看上一个词」对照着想。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/zjkBMFhNj_g" title="[1hr Talk] Intro to Large Language Models" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Andrej Karpathy · [1hr Talk] Intro to Large Language Models · 英文(B 站有中文字幕搬运,按标题搜索)。一小时的大白话总览,开头一段讲「模型就是一个根据前文预测下一个词的函数」、一个词一个词往外生成,和本周的主线是同一件事。复习日从头听前 20 分钟就够,后面讲训练和安全的部分以后再看。</figcaption>
</figure>

### 书籍

- 《AI Engineering: Building Applications with Foundation Models》(Chip Huyen 著,O'Reilly,2025,目前只查到英文原版):第 2 章「Understanding Foundation Models」从训练数据、分词讲到采样,和本周的顺序几乎一样,适合读完本周再从头翻一遍。

### 开源项目与代码

- [karpathy/nanoGPT](https://github.com/karpathy/nanoGPT):Day 110 推荐看过 `generate` 函数。今天再看一眼它的循环:每一步取最后一个位置的 logits、除以 temperature、softmax、抽一个、拼到末尾、超长就从头截掉,本周五天的内容全在这十几行里。

## 自测

1. 按顺序说出一个 token 从「文字」到「被输出」要经过的几步,每步是哪一天讲的。

<details><summary>答案</summary>

文字经分词器切成 token(Day 107、108);检查输入加 `max_tokens` 装不装得下窗口(Day 109);模型根据窗口里的全部 token 算出下一个 token 的概率表(Day 106);按 temperature 变形后掷骰子选出一个(Day 110);把它接回输入末尾,没结束、没到上限就再来一遍(Day 106 的自回归)。

</details>

2. 小项目里 t=0 时 200 条回复一模一样,而 Day 110 在 API 上 t=0 问 8 次出了两种名字。为什么?

<details><summary>答案</summary>

小项目的概率表是写死的,每次完全一样,贪心解码在固定的表上必然确定。API 的概率表是服务端每次重新算出来的,有细微的数值差别;起名字时「简」和「轻」几乎打平,一点差别就能让第一名换人。

</details>

3. 有人把 `apply_temperature` 写成 `p / t` 再归一,测试时数字看起来都很正常。问题在哪?

<details><summary>答案</summary>

每个概率除以同一个 t,归一时又除回去了,结果就是原概率,温度完全不起作用。正确做法是对数除以 t 再 `exp`,等价于取 1/t 次方。

</details>

4. 小项目生成了「您好,退款已经重新开具。」这种病句,真实大模型为什么一般不会?

<details><summary>答案</summary>

玩具只看上一个词「已经」,不知道前面是退款还是发票。真实模型每一步都看整个窗口里的全部内容,前面说的是退款,它算出来的概率表里「重新开具」的概率就会很低。

</details>

5. 面试题:「`max_tokens` 这个参数有什么用?设大一点是不是总没坏处?」

<details><summary>答案</summary>

它是一次调用最多生成多少 token 的上限,有三个作用:防止模型停不下来;给每次调用的输出费设上限;它要从上下文窗口里预留出来,所以设得越大,能放的输入越少(Day 109 算过,设成 384K 输入空间只剩 66 万)。设太小也有坏处,回复会被拦腰截断,`finish_reason` 是 `length`,Agent 拿到半截 JSON 解析就会出错。所以按任务需要设,并且检查 `finish_reason`。

</details>

## 明天预告

Day 112 · 采样(二):top_p、seed 和可复现。Day 110 看到 temperature 调高时长尾会被抬起来,明天学专门砍掉长尾的 top_p;还会弄清楚 API 在 t=0 时为什么还会变,用 seed 能不能让它每次一样,以及在 DeepSeek 上这两个参数到底管不管用。
