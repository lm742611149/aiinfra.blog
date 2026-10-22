---
title: 'Day 116 · Transformer 和注意力:面试够用版'
description: 'Day 113 的玩具只看前一个词,Day 114 多看一个词就不再说错价格。真模型是怎么同时看前面一大段的?用四个几十行的纯 Python 脚本把注意力拆开:打分、softmax 变权重、按权重把前文的信息混进来,再加一块「只许往前看」的因果遮罩。最后量一下长 prompt 为什么更慢:分数的次数随长度的平方涨。'
pubDate: 2026-10-22
regime: none
tags: ['llm-basics', 'transformer', 'python', 'agent-zero']
series: 'agent-zero'
day: 116
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 115](/blog/agent-zero/day-115-reasoning-models/) 讲了思考模式:模型回答前先写一段草稿,放在 `reasoning_content` 里,按输出 token 收钱。三道云簿算账题关思考对 1 道、开思考全对,原因是草稿里的中间结果(19 天、60 元)会接回输入,后面的计算能「看着」前面的结果做。

这三天我们反复撞上同一件事。[Day 113](/blog/agent-zero/day-113-training/) 的 bigram 玩具只看前一个词,所以说出「云簿 专业版 每月 39 元」这种张冠李戴的话;[Day 114](/blog/agent-zero/day-114-hallucination/) 练习 1 的三元模型多看一个词,1000 次全部答对 99 元;昨天模型把草稿写出来,后面就能用上。**看得越多、看得越准,答得越对。** 可是真模型面对的是几千、几十万个 token,它不可能像我们那样「把前面所有词拼成一个键去查表」,那样的组合永远查不到。它到底是怎么看前面那一大段的?今天讲注意力,不推公式,用几个能跑的小脚本把它拆开。

## 今天要解决的问题

学完今天,你应该能做到:

1. 用一句话说清注意力在干什么:每个 token 给前面每个 token 打一个相关度分数,用 softmax 变成权重,再按权重把前面 token 的信息混到自己身上。
2. 跑通四个脚本,能指出打分(query 和 key 对应位置相乘再相加)、softmax、按权重混合三步分别在哪一行。
3. 说清因果遮罩是什么、为什么生成模型必须有它,以及遮罩写错一位时会出现什么真实报错。
4. 解释为什么长 prompt 更贵、更慢:分数的次数大约随长度的平方增长;能看懂我实测的四组「输入长度和耗时」。

预计用时:2 小时左右。前置:[Day 110](/blog/agent-zero/day-110-sampling-1/) 的 softmax 和 `math.exp`、[Day 113](/blog/agent-zero/day-113-training/) 的 `toy_lm.py`(`train`、`next_dist`)、[Day 114](/blog/agent-zero/day-114-hallucination/) 练习 1 的三元模型、[Day 109](/blog/agent-zero/day-109-context-window/) 的上下文窗口。

学法提示:先对照文章把每个脚本逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,把 `softmax`、`match` 和 `masked_row` 三个函数默写出来;然后做动手练习,做不出来再展开参考答案,看完关掉,自己重写一遍。

## Transformer 是什么,先有个全貌

2017 年 Google 的研究者发了一篇论文[《Attention Is All You Need》](https://arxiv.org/abs/1706.03762),提出一种叫 **Transformer** 的模型结构。今天你用到的 DeepSeek、Qwen、GPT、Claude,几乎都是它的一个变体,叫 decoder-only Transformer(只有解码器的 Transformer,名字不用记,知道「生成模型用的那一种」就行)。

它的结构说白了是**同一种「层」叠几十次**。DeepSeek-V4-Flash 的公开配置文件里写的是 43 层(2026 年 10 月在 Hugging Face 上查的 `num_hidden_layers`)。每一层做两件事:

- **注意力**:每个 token 去看前面的 token,把相关的信息拿过来。今天只讲这一步。
- **前馈网络(FFN)**:每个 token 自己再消化一下,不看别人。明天讲 MoE 时会动的就是这一块。

文字先按 [Day 107](/blog/agent-zero/day-107-tokens-1/) 的办法切成 token,每个 token 变成一串数字(一个向量,你先把它想成「一个很长的数字数组」,JS 里的 `number[]`),一层一层往上传,每过一层,数字就被改写一次。最后一层的输出变成 Day 110 那张「下一个 token 的概率表」。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="Transformer 全貌:token 变成数字数组,经过几十层,每层先注意力再前馈网络,最后输出下一个 token 的概率表">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="190" width="150" height="40" rx="4" fill="none" stroke="var(--rule)"/>
<text x="95" y="215" text-anchor="middle" fill="var(--ink)">token → 数字数组</text>
<line x1="170" y1="210" x2="200" y2="210" stroke="var(--ink-soft)"/>
<rect x="200" y="150" width="250" height="80" rx="4" fill="none" stroke="var(--rule)"/>
<text x="215" y="168" fill="var(--ink-faint)">第 1 层</text>
<rect x="215" y="178" width="105" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="267" y="202" text-anchor="middle" fill="var(--ink)">注意力</text>
<line x1="320" y1="198" x2="335" y2="198" stroke="var(--ink-soft)"/>
<rect x="335" y="178" width="100" height="40" rx="4" fill="none" stroke="var(--rule)"/>
<text x="385" y="202" text-anchor="middle" fill="var(--ink)">前馈 FFN</text>
<line x1="325" y1="150" x2="325" y2="125" stroke="var(--ink-soft)"/>
<text x="340" y="140" fill="var(--ink-faint)">同样的层叠几十次(V4-Flash 43 层)</text>
<rect x="200" y="60" width="250" height="60" rx="4" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="325" y="95" text-anchor="middle" fill="var(--ink-soft)">第 2 层 …… 第 43 层</text>
<line x1="450" y1="90" x2="480" y2="90" stroke="var(--ink-soft)"/>
<rect x="480" y="60" width="140" height="60" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="550" y="85" text-anchor="middle" fill="var(--ink)">概率表</text>
<text x="550" y="105" text-anchor="middle" fill="var(--ink-soft)">Day 110</text>
<text x="20" y="30" fill="var(--ink-soft)">今天只讲蓝色那一格:每个 token 怎么看前面的 token</text>
</g>
</svg>
<figcaption>Transformer 的骨架。每一层里,注意力负责 token 之间交换信息,前馈网络负责每个 token 自己消化。今天拆注意力,明天拆前馈网络里的 MoE。</figcaption>
</figure>

## 注意力第一步:给前面每个词打分,再变成权重

读这句客服记录:「客户说发票开错了,它的金额少了 20 元」。你一眼就知道「它」指的是发票,不是客户。模型怎么知道?

处理到「它」这个位置时,模型给前面每个词打一个分数,分数表示「这个词和我现在要弄明白的事有多相关」。「发票」分数高,「客户」低一些,「了」「,」几乎为零。然后把分数变成一组加起来等于 1 的**权重**。变的方法你见过:Day 110 讲 temperature 时用的 **softmax**,每个分数取 `exp`,再除以总和。

先假设分数已经有了(分数从哪来,下一节讲),只演示「分数 → 权重」这一步。在 `agent-zero-lab` 目录下新建 `part02/attn_softmax.py`:

```python
# agent-zero-lab/part02/attn_softmax.py
import math

SCORES = {"客户": 1.0, "说": 0.0, "发票": 3.0, "开": 0.5, "错": 0.5, "了": 0.0, ",": 0.0}


def softmax(scores: dict[str, float]) -> dict[str, float]:
    exps = {tok: math.exp(s) for tok, s in scores.items()}
    total = sum(exps.values())
    return {tok: e / total for tok, e in exps.items()}


if __name__ == "__main__":
    weights = softmax(SCORES)
    for tok, w in sorted(weights.items(), key=lambda kv: kv[1], reverse=True):
        print(f"{tok}  分数 {SCORES[tok]:>4}  权重 {w:.3f}  {'#' * round(w * 40)}")
    print("权重加起来:", round(sum(weights.values()), 6))
```

<div class="line-notes">

- `import math` 要用 `math.exp`,Day 110 用过。
- `SCORES = {"客户": 1.0, "说": 0.0, "发票": 3.0,` 「它」对前面 7 个 token 的分数,是我手写的,为了演示。为了好读,我按词切,一个词当一个 token(和 Day 113 的玩具一样);真实分词器会把这句话切成别的样子。
- `def softmax(scores: dict[str, float]) -> dict[str, float]:` 输入「词 → 分数」,输出「词 → 权重」。和 Day 110 `apply_temperature` 的后半段是同一件事,只是这次没有温度。
- `exps = {tok: math.exp(s) for tok, s in scores.items()}` 字典推导式,每个分数取 e 的 s 次方。「发票」`exp(3.0)` = 20.09,「客户」`exp(1.0)` = 2.72,分数为 0 的都是 `exp(0)` = 1。`exp` 让所有数都变成正数,并且把差距放大。
- `total = sum(exps.values())` 20.09 + 2.72 + 1.65 + 1.65 + 1 + 1 + 1 = 29.1 左右(两个 0.5 各是 1.65)。
- `return {tok: e / total for tok, e in exps.items()}` 每个除以总和。「发票」20.09 ÷ 29.1 ≈ 0.690。
- `for tok, w in sorted(weights.items(), key=lambda kv: kv[1], reverse=True):` 按权重从大到小排。`kv` 是一个(词, 权重)元组,`kv[1]` 取权重,[Day 30](/blog/agent-zero/day-030-functions-3/) 讲过 `lambda`,相当于 JS 的 `entries.sort((a, b) => b[1] - a[1])`。
- `print(f"{tok}  分数 {SCORES[tok]:>4}  权重 {w:.3f}  {'#' * round(w * 40)}")` 最后那段用井号画一根小柱子:字符串乘整数就是重复几次,`"#" * 28` 是 28 个井号。JS 里是 `"#".repeat(28)`。
- `print("权重加起来:", round(sum(weights.values()), 6))` 检查一下权重总和是不是 1。

</div>

```bash
uv run part02/attn_softmax.py
```

实跑输出:

```text
发票  分数  3.0  权重 0.690  ############################
客户  分数  1.0  权重 0.093  ####
开  分数  0.5  权重 0.057  ##
错  分数  0.5  权重 0.057  ##
说  分数  0.0  权重 0.034  #
了  分数  0.0  权重 0.034  #
,  分数  0.0  权重 0.034  #
权重加起来: 1.0
```

「发票」拿到了 69% 的注意力。注意分数 3 对 1,只差 3 倍,权重却差了 7 倍多(0.690 对 0.093):`exp` 把差距放大了。这正是想要的效果,最相关的那个要明显胜出。还有一点:分数为 0 的「了」「,」权重也不是 0,而是 0.034。softmax 之后**每个词都会分到一点点**,注意力是「主要看谁」,不是「只看谁」。

你会发现这一步和 Day 110 一模一样。在 Day 110,softmax 把「下一个 token 的分数」变成概率表;在这里,softmax 把「前面每个 token 的相关度」变成权重。同一个工具,模型里到处在用。

## 注意力第二步:分数从哪来

分数不是手写的,是模型自己算的。算法很朴素:**每个 token 准备两样东西**。

- 一个 **query**(查询):「我现在在找什么样的信息」。「它」的 query 大概是「我在找一个东西,一个能有金额的东西」。
- 一个 **key**(键):「我是什么样的信息」。「发票」的 key 大概是「我是个东西」,「客户」的 key 是「我是个人」。

「它」的 query 和每个词的 key 比一比,越对得上,分数越高。「比一比」的具体做法是:query 和 key 都是同样长度的数字数组,**对应位置相乘,再全部加起来**。两个数组在同一个位置上都大,乘出来就大;一个大一个是 0,乘出来就是 0。这个操作叫**点积**,第四部分做向量检索时会正式讲,今天知道「对应位置相乘再相加」就够了。

真模型里 query 和 key 是几百个数字,每个位置代表什么没人说得清,都是训练出来的。我们的玩具只用 3 个数字,并且给每个位置一个能看懂的意思:[像东西, 像人, 像动作]。新建 `part02/attn_qk.py`:

```python
# agent-zero-lab/part02/attn_qk.py
from attn_softmax import softmax

# 每个词的 key:[像东西, 像人, 像动作]
KEYS = {
    "客户": [0.0, 1.0, 0.0],
    "说": [0.0, 0.0, 1.0],
    "发票": [1.0, 0.0, 0.0],
    "开": [0.0, 0.0, 1.0],
    "错": [0.0, 0.0, 0.5],
    "了": [0.0, 0.0, 0.0],
    ",": [0.0, 0.0, 0.0],
}
QUERY_IT = [3.0, 1.0, 0.5]  # 「它」在找:最好是个东西,是人也行,动作不太要


def match(q: list[float], k: list[float]) -> float:
    return sum(a * b for a, b in zip(q, k))


if __name__ == "__main__":
    scores = {tok: match(QUERY_IT, k) for tok, k in KEYS.items()}
    print("分数:", scores)
    weights = softmax(scores)
    print("权重:", {tok: round(w, 3) for tok, w in weights.items()})
```

<div class="line-notes">

- `from attn_softmax import softmax` 复用刚写的 `softmax`。能导入是因为 `attn_softmax.py` 的演示代码放在了 `if __name__ == "__main__":` 下面([Day 32](/blog/agent-zero/day-032-modules/)),导入时不会把那张柱状图打出来。
- `"客户": [0.0, 1.0, 0.0],` 客户的 key:不像东西,像人,不像动作。
- `"发票": [1.0, 0.0, 0.0],` 发票的 key:像东西。
- `"错": [0.0, 0.0, 0.5],` 「错」有一点动作的意思,给 0.5。这些数是我拍脑袋定的,真模型里是训练学出来的。
- `"了": [0.0, 0.0, 0.0],` 「了」「,」什么都不像,全是 0,和谁比分数都是 0。
- `QUERY_IT = [3.0, 1.0, 0.5]` 「它」的 query:第一个位置(像东西)要得最重,3;是人也凑合,1;动作 0.5。
- `def match(q: list[float], k: list[float]) -> float:` 打分函数。
- `return sum(a * b for a, b in zip(q, k))` `zip` 把两个数组按位置配对(Day 113 用过),每对相乘,再求和。「它」对「发票」:3 × 1 + 1 × 0 + 0.5 × 0 = 3.0;对「客户」:3 × 0 + 1 × 1 + 0.5 × 0 = 1.0;对「错」:0.5 × 0.5 = 0.25。JS 里是 `q.reduce((s, a, i) => s + a * k[i], 0)`。
- `scores = {tok: match(QUERY_IT, k) for tok, k in KEYS.items()}` 「它」和前面每个词都比一次。
- `weights = softmax(scores)` 分数变权重,就是上一节那一步。

</div>

```bash
uv run part02/attn_qk.py
```

实跑输出:

```text
分数: {'客户': 1.0, '说': 0.5, '发票': 3.0, '开': 0.5, '错': 0.25, '了': 0.0, ',': 0.0}
权重: {'客户': 0.093, '说': 0.056, '发票': 0.684, '开': 0.056, '错': 0.044, '了': 0.034, ',': 0.034}
```

分数是算出来的了:「发票」3.0 最高,和上一节手写的差不多,所以权重也还是「发票」0.684 一家独大。

这里有个关键点要想明白:**query 是「它」自己带的,key 是每个词自己带的**。所以同一个「发票」,被「它」看时分数高,被别的词(比如一个在找「人」的「他」)看时分数就低。谁看谁、看多重,不是固定的,取决于看的人在找什么。练习 1 会把 query 换成「他」,看权重怎么跑到「客户」那边去。

## 注意力第三步:按权重把信息混进来

有了权重,最后一步是把信息拿过来。每个词除了 query 和 key,还准备第三样东西:**value**(值),「如果有人看我,我交出去的信息是什么」。「它」这个位置的新内容 = 每个词的 value × 它的权重,全部加起来。

为什么 key 和 value 要分开?key 是用来「被找到」的标签,value 是「被找到之后交出去的内容」,两件事不一样。好比图书馆的书,书脊上的分类号是 key,书里的内容是 value。

新建 `part02/attn_mix.py`,value 也用 3 个能看懂的位置:[是票据, 带金额, 是人]:

```python
# agent-zero-lab/part02/attn_mix.py
from attn_qk import KEYS, QUERY_IT, match
from attn_softmax import softmax

# 每个词的 value:[是票据, 带金额, 是人]
VALUES = {
    "客户": [0.0, 0.0, 1.0],
    "说": [0.0, 0.0, 0.0],
    "发票": [1.0, 1.0, 0.0],
    "开": [0.0, 0.0, 0.0],
    "错": [0.0, 0.0, 0.0],
    "了": [0.0, 0.0, 0.0],
    ",": [0.0, 0.0, 0.0],
}

weights = softmax({tok: match(QUERY_IT, k) for tok, k in KEYS.items()})
mixed = [0.0, 0.0, 0.0]
for tok, w in weights.items():
    for i in range(3):
        mixed[i] += w * VALUES[tok][i]
print("「它」看完前文后的新内容 [是票据, 带金额, 是人]:", [round(x, 3) for x in mixed])
```

<div class="line-notes">

- `from attn_qk import KEYS, QUERY_IT, match` 复用上一步的 key、query 和打分函数。
- `"客户": [0.0, 0.0, 1.0],` 客户交出去的信息:是个人。
- `"发票": [1.0, 1.0, 0.0],` 发票交出去的信息:是票据,而且带金额。
- `weights = softmax({tok: match(QUERY_IT, k) for tok, k in KEYS.items()})` 前两步合成一行:打分,softmax。得到「发票」0.684、「客户」0.093……
- `mixed = [0.0, 0.0, 0.0]` 「它」的新内容,从 0 开始累加。
- `for tok, w in weights.items():` 每个词按自己的权重贡献一份。
- `mixed[i] += w * VALUES[tok][i]` 第 i 个位置加上「权重 × 这个词 value 的第 i 个数」。「发票」贡献 0.684 × [1, 1, 0] = [0.684, 0.684, 0];「客户」贡献 0.093 × [0, 0, 1] = [0, 0, 0.093];其余的 value 全是 0,贡献也是 0。
- `print("「它」看完前文后的新内容 [是票据, 带金额, 是人]:", [round(x, 3) for x in mixed])` 打印三个位置,保留三位小数。

</div>

```bash
uv run part02/attn_mix.py
```

实跑输出:

```text
「它」看完前文后的新内容 [是票据, 带金额, 是人]: [0.684, 0.684, 0.093]
```

「它」本来只是一个代词,什么信息都没有。看完前文之后,它身上有了 0.684 的「是票据」和 0.684 的「带金额」,还掺了一点点「是人」。下一个词要接「的 金额」时,模型手上就有依据了。

**这三步加起来就是注意力的全部骨架**:query 和 key 打分,softmax 变权重,按权重把 value 加起来。面试里那个吓人的公式 `softmax(QKᵀ/√d)·V`,说的就是这三步,只不过是把所有 token 一次性算完。公式里的 `√d` 是把分数缩小一点,防止分数太大时 softmax 变得过尖,练习 2 会看到分数放大 10 倍时会发生什么。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="注意力三步:「它」的 query 和前面每个词的 key 打分,softmax 变权重,按权重混合 value">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-soft)">处理「它」这个位置(数字是 attn_mix.py 的实跑结果)</text>
<path d="M480 150 Q340 50 200 150" fill="none" stroke="var(--mem)" stroke-width="5"/>
<path d="M480 150 Q290 20 100 150" fill="none" stroke="var(--rule)" stroke-width="1.5"/>
<path d="M480 150 Q390 90 300 150" fill="none" stroke="var(--rule)" stroke-width="1"/>
<path d="M480 150 Q440 110 400 150" fill="none" stroke="var(--rule)" stroke-width="1"/>
<text x="320" y="88" fill="var(--mem)">0.684</text>
<text x="160" y="72" fill="var(--ink-faint)">0.093</text>
<rect x="70" y="150" width="60" height="28" rx="4" fill="none" stroke="var(--rule)"/>
<text x="100" y="169" text-anchor="middle" fill="var(--ink)">客户</text>
<rect x="170" y="150" width="60" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="200" y="169" text-anchor="middle" fill="var(--ink)">发票</text>
<rect x="270" y="150" width="60" height="28" rx="4" fill="none" stroke="var(--rule)"/>
<text x="300" y="169" text-anchor="middle" fill="var(--ink)">开</text>
<rect x="370" y="150" width="60" height="28" rx="4" fill="none" stroke="var(--rule)"/>
<text x="400" y="169" text-anchor="middle" fill="var(--ink)">了</text>
<rect x="450" y="150" width="60" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="480" y="169" text-anchor="middle" fill="var(--ink)">它</text>
<text x="20" y="206" fill="var(--ink)">① query·key 打分 → ② softmax 变权重 → ③ 按权重加 value</text>
<text x="20" y="228" fill="var(--ink-faint)">「它」的新内容 = 0.684 × 发票的 value + 0.093 × 客户的 value + …… = [0.684, 0.684, 0.093]</text>
</g>
</svg>
<figcaption>线越粗权重越大。图里只画了几个词,实际上「它」对前面每个 token 都有一条线,只是大多数很细。</figcaption>
</figure>

### 面试还会追问的三个词

到这里注意力的直觉就讲完了。面试官常顺着往下问三个词,知道一句话就够,今天不展开:

**多头注意力(multi-head attention)。** 一层里不是只有一套 query/key/value,而是几十套同时算,每一套叫一个「头」。有的头盯「它指谁」,有的头盯语法,有的头盯数字。DeepSeek-V4-Flash 的配置里 `num_attention_heads` 是 64。相当于从 64 个角度同时看一遍。

**位置编码。** 注意力本身不管先后顺序。上面的 `match` 只看 query 和 key,不看这个词在第几个位置,所以把前面的词打乱,权重一点都不变(练习 3 实测)。可「客户说发票开错了」和「发票说客户开错了」意思完全不同,所以模型要另外把位置信息加进去。现在多数模型用的是 **RoPE**(旋转位置编码),上下文窗口能从几万拉到 [Day 109](/blog/agent-zero/day-109-context-window/) 讲的一百万,很大程度上就是在它上面做文章。

**知识存在哪。** 注意力负责 token 之间交换信息,而模型「记住」的事实(专业版 99 元、巴黎是法国首都),一般认为主要存在每层的前馈网络参数里。所以有一个很有用的直觉:**把资料放进上下文,让注意力去找,比指望模型记住靠谱**。Day 114 的第三招「给资料并引用原文」,第四部分的 RAG,都是在利用这一点。

## 只许往前看:因果遮罩

上面「它」只看了前面的词。这不是我们偷懒,而是生成模型的硬规定:**每个位置只能看它自己和它前面的 token,不能看后面的**。这个规定叫**因果遮罩**(causal mask)。「因果」的意思是:后面的事不能影响前面。

为什么要这个规定?先想生成的时候。模型是一个 token 一个 token 往外吐的([Day 106](/blog/agent-zero/day-106-next-token/)),生成第 5 个 token 时,第 6 个还不存在,本来就看不到。那训练时呢?训练是把一整段现成的文本一次塞进去,让每个位置同时猜它的下一个 token。这时后面的 token 是存在的,如果不挡住,第 3 个位置猜第 4 个 token 时,直接看一眼第 4 个就行了,这叫作弊。

我们用 Day 113 的玩具语料演示一下作弊会怎样。新建 `part02/peek_cheat.py`:

```python
# agent-zero-lab/part02/peek_cheat.py
from toy_lm import PRETRAIN, next_dist, train

model = train(PRETRAIN)


def honest_guess(toks: list[str], i: int) -> str:
    dist = next_dist(model, toks[i])
    return max(dist, key=lambda t: dist[t])


def cheat_guess(toks: list[str], i: int) -> str:
    return toks[i + 1]


for name, guess in (("只看前面", honest_guess), ("偷看后面", cheat_guess)):
    right = total = 0
    for line in PRETRAIN:
        toks = line.split()
        for i in range(len(toks) - 1):
            total += 1
            right += guess(toks, i) == toks[i + 1]
    print(f"{name}: 练习题猜对 {right}/{total}")

prompt = PRETRAIN[0].split()[:3]
print("只看前面, 生成时:", honest_guess(prompt, len(prompt) - 1))
print("偷看后面, 生成时:", cheat_guess(prompt, len(prompt) - 1))
```

<div class="line-notes">

- `from toy_lm import PRETRAIN, next_dist, train` 这是 Day 113 建的 `part02/toy_lm.py`:6 行云簿语料、数数训练的 `train`、给出概率表的 `next_dist`。
- `model = train(PRETRAIN)` 训练 bigram 模型,就是数「每个词后面跟过谁」。
- `def honest_guess(toks: list[str], i: int) -> str:` 老实的猜法:只看第 i 个词,查概率表。
- `return max(dist, key=lambda t: dist[t])` 选概率最大的那个词。打平时选字典里排在前面的(Day 110 讲过)。「每月」后面 99、39、299 各 1/3,选到 99。
- `def cheat_guess(toks: list[str], i: int) -> str:` 作弊的猜法:直接看第 i+1 个词,也就是答案本身。没有因果遮罩的模型在训练时就能这么干。
- `for name, guess in (("只看前面", honest_guess), ("偷看后面", cheat_guess)):` 函数也能放进元组里当值传来传去,和 JS 里把函数放进数组一样。
- `right = total = 0` 连等赋值,两个变量都设成 0。
- `for i in range(len(toks) - 1):` 每个位置都猜一次下一个词。最后一个位置后面没词了,不猜。
- `right += guess(toks, i) == toks[i + 1]` 猜对加 1。比较结果是布尔值,`True` 当 1 加(Day 115 用过)。
- `prompt = PRETRAIN[0].split()[:3]` 第一行的前三个词「云簿 专业版 每月」,模拟生成时的场景:后面的词还没生成出来。
- `print("偷看后面, 生成时:", cheat_guess(prompt, len(prompt) - 1))` 作弊的模型在生成时要去看第 4 个词。

</div>

```bash
uv run part02/peek_cheat.py
```

实跑输出:

```text
只看前面: 练习题猜对 26/34
偷看后面: 练习题猜对 34/34
只看前面, 生成时: 99
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part02/peek_cheat.py", line 27, in <module>
    print("偷看后面, 生成时:", cheat_guess(prompt, len(prompt) - 1))
                               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/你/agent-zero-lab/part02/peek_cheat.py", line 13, in cheat_guess
    return toks[i + 1]
           ~~~~^^^^^^^
IndexError: list index out of range
```

作弊的那个在练习题上 34 道全对,比老实的 26 道漂亮多了。可一到生成,它要的第 4 个词根本不存在,直接 `IndexError`。真模型不会报错,它会学成一个「只会抄答案、自己什么都不会」的废物,训练分数好看,用起来一塌糊涂。因果遮罩就是在训练时把后面的 token 挡住,逼模型只靠前面的东西猜,训练和使用时的条件才一致。

### 遮罩怎么实现:把分数改成负无穷

实现方法很巧:在 softmax 之前,把「不许看」的那些位置的分数改成**负无穷**。`exp(负无穷)` 等于 0,所以 softmax 之后它们的权重正好是 0,其余位置的权重照样加起来等于 1。

我们把一句 6 个词的话,每个位置对每个位置的权重都算出来,排成一张表。为了只看遮罩的效果,所有分数都先设成 0(大家一样相关)。新建 `part02/causal_mask.py`:

```python
# agent-zero-lab/part02/causal_mask.py
import math

TOKENS = ["客户", "说", "发票", "开", "错", "了"]


def masked_row(i: int, n: int, causal: bool) -> list[float]:
    scores = [0.0] * n
    if causal:
        scores = [s if j <= i else -math.inf for j, s in enumerate(scores)]
    exps = [math.exp(s) for s in scores]
    total = sum(exps)
    return [e / total for e in exps]


if __name__ == "__main__":
    print("math.exp(-inf) =", math.exp(-math.inf))
    for causal in (False, True):
        print("加因果遮罩" if causal else "不加遮罩")
        print("看 →     " + " ".join(f"{j:>5}" for j in range(len(TOKENS))))
        for i, tok in enumerate(TOKENS):
            row = masked_row(i, len(TOKENS), causal)
            print(f"{i} {tok}\t" + " ".join(f"{w:5.2f}" for w in row))
```

<div class="line-notes">

- `TOKENS = ["客户", "说", "发票", "开", "错", "了"]` 6 个 token,位置编号 0 到 5。
- `def masked_row(i: int, n: int, causal: bool) -> list[float]:` 算第 i 个位置对全部 n 个位置的权重,`causal` 决定加不加遮罩。
- `scores = [0.0] * n` 列表乘整数是重复,得到 6 个 0.0。和上面 `"#" * 28` 同一个道理。
- `scores = [s if j <= i else -math.inf for j, s in enumerate(scores)]` 遮罩就这一行:位置 j 在 i 前面或就是 i 自己(`j <= i`),分数不变;在 i 后面,改成负无穷。`math.inf` 是正无穷,相当于 JS 的 `Infinity`,加个负号就是 `-Infinity`。条件表达式 `A if 条件 else B` 相当于 JS 的 `条件 ? A : B`。第 2 行(i=2,「发票」)得到 `[0, 0, 0, -inf, -inf, -inf]`。
- `exps = [math.exp(s) for s in scores]` `exp(0)` = 1,`exp(-inf)` = 0。「发票」那行变成 `[1, 1, 1, 0, 0, 0]`。
- `return [e / total for e in exps]` 除以总和 3,得到 `[0.33, 0.33, 0.33, 0, 0, 0]`。
- `print("math.exp(-inf) =", math.exp(-math.inf))` 先单独确认一下负无穷取 exp 是 0。
- `for causal in (False, True):` 不加和加,各打一张表对比。
- `print(f"{i} {tok}\t" + " ".join(f"{w:5.2f}" for w in row))` 每行开头是位置编号和词,`\t` 是制表符,让后面的数字对齐;`:5.2f` 占 5 格、保留两位小数。

</div>

```bash
uv run part02/causal_mask.py
```

实跑输出:

```text
math.exp(-inf) = 0.0
不加遮罩
看 →         0     1     2     3     4     5
0 客户	 0.17  0.17  0.17  0.17  0.17  0.17
1 说	 0.17  0.17  0.17  0.17  0.17  0.17
2 发票	 0.17  0.17  0.17  0.17  0.17  0.17
3 开	 0.17  0.17  0.17  0.17  0.17  0.17
4 错	 0.17  0.17  0.17  0.17  0.17  0.17
5 了	 0.17  0.17  0.17  0.17  0.17  0.17
加因果遮罩
看 →         0     1     2     3     4     5
0 客户	 1.00  0.00  0.00  0.00  0.00  0.00
1 说	 0.50  0.50  0.00  0.00  0.00  0.00
2 发票	 0.33  0.33  0.33  0.00  0.00  0.00
3 开	 0.25  0.25  0.25  0.25  0.00  0.00
4 错	 0.20  0.20  0.20  0.20  0.20  0.00
5 了	 0.17  0.17  0.17  0.17  0.17  0.17
```

(表头的数字和下面不完全对齐,是制表符在不同终端里宽度不一样,不影响读。)

不加遮罩时每一行都是 6 个 0.17,第 0 行的「客户」已经在看第 4 列的「错」,也就是一个还没说出来的词。加了遮罩,表的右上半边全是 0,变成一个**下三角**:第 0 行只能看自己(1.00),第 1 行看两个(各 0.50),第 2 行看三个(各 0.33),一直到最后一行看全部 6 个。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="因果遮罩:6 乘 6 的权重表,右上半边被挡住为 0,只剩下三角">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-soft)">行 = 正在处理的位置,列 = 被看的位置</text>
<text x="128" y="52" text-anchor="middle" fill="var(--ink-faint)">0</text>
<text x="164" y="52" text-anchor="middle" fill="var(--ink-faint)">1</text>
<text x="200" y="52" text-anchor="middle" fill="var(--ink-faint)">2</text>
<text x="236" y="52" text-anchor="middle" fill="var(--ink-faint)">3</text>
<text x="272" y="52" text-anchor="middle" fill="var(--ink-faint)">4</text>
<text x="308" y="52" text-anchor="middle" fill="var(--ink-faint)">5</text>
<text x="100" y="80" text-anchor="end" fill="var(--ink)">0 客户</text>
<text x="100" y="112" text-anchor="end" fill="var(--ink)">1 说</text>
<text x="100" y="144" text-anchor="end" fill="var(--ink)">2 发票</text>
<text x="100" y="176" text-anchor="end" fill="var(--ink)">3 开</text>
<text x="100" y="208" text-anchor="end" fill="var(--ink)">4 错</text>
<text x="100" y="240" text-anchor="end" fill="var(--ink)">5 了</text>
<path d="M110 60 L146 60 L146 92 L182 92 L182 124 L218 124 L218 156 L254 156 L254 188 L290 188 L290 220 L326 220 L326 252 L110 252 Z" fill="var(--mem-wash)" stroke="var(--mem)"/>
<path d="M146 60 L326 60 L326 220 L290 220 L290 188 L254 188 L254 156 L218 156 L218 124 L182 124 L182 92 L146 92 Z" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="260" y="100" text-anchor="middle" fill="var(--ink-faint)">-inf → 权重 0</text>
<text x="160" y="210" text-anchor="middle" fill="var(--mem)">可以看</text>
<text x="360" y="90" fill="var(--ink)">第 2 行「发票」:</text>
<text x="360" y="110" fill="var(--ink-soft)">能看 客户、说、发票</text>
<text x="360" y="130" fill="var(--ink-soft)">看不到 开、错、了</text>
<text x="360" y="170" fill="var(--ink)">对角线(自己看自己)</text>
<text x="360" y="190" fill="var(--ink-soft)">必须留着,否则第 0 行</text>
<text x="360" y="210" fill="var(--ink-soft)">一个能看的都没有</text>
</g>
</svg>
<figcaption>加了因果遮罩的权重表是一个下三角。右上方的虚线区域在 softmax 之前被改成负无穷,权重变成 0。</figcaption>
</figure>

### 遮罩错一位:先踩一次坑

写遮罩时最容易错的是那个等号。`j <= i` 写成 `j < i`,意思就从「能看自己和前面」变成了「只能看前面,不能看自己」。看起来只差一点,我们故意错一次。把 `causal_mask.py` 复制一份叫 `part02/mask_off_by_one.py`,只改遮罩那一行:

```python
# agent-zero-lab/part02/mask_off_by_one.py(只列出改动的那一行,其余和 causal_mask.py 一样)
        scores = [s if j < i else -math.inf for j, s in enumerate(scores)]
```

<div class="line-notes">

- `scores = [s if j < i else -math.inf for j, s in enumerate(scores)]` 少了一个等号。第 0 行(i=0)时,没有任何 j 满足 `j < 0`,6 个分数全部变成负无穷。

</div>

```bash
uv run part02/mask_off_by_one.py
```

实跑输出(「不加遮罩」那张表正常打完,一到「加因果遮罩」的第 0 行就崩了):

```text
加因果遮罩
看 →         0     1     2     3     4     5
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part02/mask_off_by_one.py", line 22, in <module>
    row = masked_row(i, len(TOKENS), causal)
          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/你/agent-zero-lab/part02/mask_off_by_one.py", line 13, in masked_row
    return [e / total for e in exps]
            ~~^~~~~~~
ZeroDivisionError: float division by zero
```

第 0 行的 6 个分数全是负无穷,`exp` 之后全是 0,总和是 0,除以 0 就报错了。这也说明了为什么对角线必须留着:第一个 token 前面什么都没有,它唯一能看的就是自己。真实的深度学习框架里这个错不会报 `ZeroDivisionError`,而是悄悄算出一堆 `nan`(not a number,「不是一个数」),然后整个模型的输出都变成 `nan`,更难查。修法就是把 `<` 改回 `<=`。

## 越长越贵:分数要打多少次

现在你能解释一个工程上很实在的现象了:**为什么长 prompt 更贵、首个 token 来得更慢**。

每个 token 都要和它前面的每个 token(包括自己)打一次分。第 1 个 token 打 1 次,第 2 个打 2 次,……,第 n 个打 n 次。加起来是 1 + 2 + … + n = n × (n + 1) ÷ 2。n 翻一倍,这个数大约变成 4 倍,这就是常说的「注意力的计算量随长度的平方增长」。数一数,新建 `part02/attn_cost.py`:

```python
# agent-zero-lab/part02/attn_cost.py
def pairs(n: int) -> int:
    count = 0
    for i in range(n):
        count += i + 1
    return count


if __name__ == "__main__":
    for n in (6, 1_000, 2_000, 100_000):
        print(f"{n:>9,} 个 token -> 一层一个头要打 {pairs(n):>17,} 次分数")
    print(f"1,048,576 个 token -> {1_048_576 * (1_048_576 + 1) // 2:,} 次(直接用公式 n × (n + 1) ÷ 2)")
    print("长度翻倍, 次数变成:", round(pairs(2_000) / pairs(1_000), 2), "倍")
```

<div class="line-notes">

- `def pairs(n: int) -> int:` 数 n 个 token 一共要打几次分。故意用循环一个个加,和上面「第 i 个打 i 次」的说法一一对应。
- `count += i + 1` 第 i 个位置(从 0 数)要和前面 i 个加上自己,一共 i + 1 次打分。
- `for n in (6, 1_000, 2_000, 100_000):` 6 是 `causal_mask.py` 那张表的大小(数一数下三角的格子:1+2+3+4+5+6 = 21)。
- `print(f"{n:>9,} 个 token` `:>9,` 占 9 格、右对齐、千位加逗号。
- `print(f"1,048,576 个 token -> {1_048_576 * (1_048_576 + 1) // 2:,} 次` Day 109 的窗口上限,直接套公式。`//` 是整除,结果是整数。
- `print("长度翻倍, 次数变成:", round(pairs(2_000) / pairs(1_000), 2), "倍")` 2000 对 1000,看看是不是 4 倍。

</div>

```bash
uv run part02/attn_cost.py
```

实跑输出:

```text
        6 个 token -> 一层一个头要打                21 次分数
    1,000 个 token -> 一层一个头要打           500,500 次分数
    2,000 个 token -> 一层一个头要打         2,001,000 次分数
  100,000 个 token -> 一层一个头要打     5,000,050,000 次分数
1,048,576 个 token -> 549,756,338,176 次(直接用公式 n × (n + 1) ÷ 2)
长度翻倍, 次数变成: 4.0 倍
```

1000 个 token 是 50 万次,10 万个 token 是 50 亿次,长度涨了 100 倍,次数涨了 1 万倍。这还只是一层里的一个头,乘上 43 层、64 个头,再乘上每次打分本身是几百个数相乘相加。窗口拉满到一百万,一层一个头就是 5,497 亿次。

### 在真模型上量一量

理论上是平方,实际在 DeepSeek 上是什么样?我用同一句工单造了四个长度的 prompt,每次只让它回答「一共几张工单」,`max_tokens=10`,量从发请求到拿到回答的总耗时。这段要调 API,[Day 120](/blog/agent-zero/day-120-api-register/) 才注册拿 key,**这段你现在不用跑,看我的结果**:

```python
# agent-zero-lab/part02/long_prompt_latency.py
import os
import random
import time

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
rng = random.Random()

for lines in (20, 200, 2_000):
    tag = rng.randint(100_000, 999_999)
    body = "\n".join(f"工单 {tag}-{i}: 客户反映发票金额少了 {i % 50} 元。" for i in range(lines))
    start = time.perf_counter()
    resp = client.chat.completions.create(
        model="deepseek-flash",
        messages=[{"role": "user", "content": body + "\n一共几张工单?只输出数字。"}],
        max_tokens=10,
        extra_body={"thinking": {"type": "disabled"}},
    )
    elapsed = time.perf_counter() - start
    assert resp.usage is not None
    print(f"{lines:>5} 行 输入 {resp.usage.prompt_tokens:>6} token  耗时 {elapsed:.2f}s  回答 {resp.choices[0].message.content!r}")
```

<div class="line-notes">

- `rng = random.Random()` 不传种子,每次运行都不一样(Day 112)。这里要的就是「不一样」。
- `for lines in (20, 200, 2_000):` 三个长度,每个大约是上一个的 10 倍。
- `tag = rng.randint(100_000, 999_999)` 每次随机一个六位数编号塞进工单里。为什么?DeepSeek 会把见过的相同开头缓存起来,第二次就快很多、便宜很多(明天讲)。每次开头都不一样,才量得到「没缓存」时的真实耗时。
- `body = "\n".join(f"工单 {tag}-{i}: 客户反映发票金额少了 {i % 50} 元。" for i in range(lines))` 拼出 `lines` 行工单。`i % 50` 让金额在 0 到 49 之间变化。
- `max_tokens=10,` 回答只要一个数字,输出越少,耗时里「读输入」那部分占得越多。
- `extra_body={"thinking": {"type": "disabled"}},` 关思考,不然耗时里混进了思考的时间(Day 115)。
- `print(f"{lines:>5} 行 输入 {resp.usage.prompt_tokens:>6} token` 用 API 返回的 `prompt_tokens` 当输入长度,这是收钱的那个数。

</div>

我的实跑输出(2026 年 10 月 22 日晚上,空闲时段):

```text
   20 行 输入    393 token  耗时 0.75s  回答 '20'
  200 行 输入   3813 token  耗时 0.98s  回答 '200'
 2000 行 输入  39013 token  耗时 1.16s  回答 '2000'
```

我又把长度改成 `(20_000,)` 单独跑了一次:

```text
20000 行 输入 399013 token  耗时 6.01s  回答 '20000'
```

读这四行要小心,和「平方」对不上。393 到 39,013 个 token,长度涨了 100 倍,耗时只从 0.75 秒涨到 1.16 秒。原因是短的时候,耗时的大头是网络来回和排队,不是计算。到了 39 万个 token,计算才真正压过来,耗时跳到 6 秒。从 39,013 到 399,013,长度涨了 10 倍,耗时涨了约 5 倍,也不是 100 倍。

不是平方,是因为 DeepSeek 在注意力上做了大量优化。V4 的[模型说明](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash)里写,它用了一种混合的压缩稀疏注意力(CSA 和 HCA),在一百万 token 的场景下,V4-Pro 每个 token 的推理计算量只要上一代 V3.2 的 27%。「稀疏」的意思是不再让每个 token 和前面每个 token 都打分,而是先挑出一部分值得看的。这些优化具体怎么做的,第十部分讲自部署时再看,今天记住结论就行:**长度越长越慢的趋势是真的,但具体慢多少要实测,不能直接套平方**。

这四次调用一共输入 442,232 个 token,空闲时段未命中缓存的输入价是 1 元每百万 token(2026 年 10 月查的 [DeepSeek 价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)),花费约 442,232 × 1 ÷ 1,000,000 ≈ 0.44 元,输出 token 只有十几个,可以忽略。最后一次 39 万 token 一个人就花了 0.4 元,只为了数一个数。对 Agent 工程师来说,这就是「别把整个知识库塞进 prompt」最直接的理由。

## 这些和写 Agent 有什么关系

今天的内容不是让你去实现 Transformer,而是给你几条后面会反复用到的判断:

prompt 越长,首个 token 越慢、越贵,而且不是线性的。Agent 每走一步都把整段历史重新发一遍,历史越堆越长,第 20 步比第 1 步慢得多(练习 4 算一笔账)。所以后面要学截断、压缩和缓存。

注意力是「主要看谁」,不是「只看谁」。窗口里塞了一堆无关内容,每一份都会分走一点权重。这是 [Day 109](/blog/agent-zero/day-109-context-window/) 说的「窗口大不等于用得好」的一个直觉解释,第四部分讲上下文工程时会再碰到。

模型只能看到窗口里、位置在前面的东西。想让它用上某条规则,就要把规则放进上下文;想让它在回答时用上一个算好的中间结果,就要让这个结果先出现在前面,这就是 Day 115 的思考和思维链能起作用的原因。

## 动手练习

**练习 1:换一个代词。** 把句子想成「客户说发票开错了,他的电话打不通」。写 `part02/attn_who.py`,沿用 `attn_qk.py` 的 `KEYS` 和 `match`,给「他」设计一个 query,让权重最大的变成「客户」,打印最大的那个和全部权重。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/attn_who.py
from attn_qk import KEYS, match
from attn_softmax import softmax

QUERY_HE = [0.0, 3.0, 0.5]  # 「他」在找:最好是个人

weights = softmax({tok: match(QUERY_HE, k) for tok, k in KEYS.items()})
best = max(weights, key=lambda t: weights[t])
print("「他」最看重:", best, round(weights[best], 3))
print({tok: round(w, 3) for tok, w in weights.items()})
```

<div class="line-notes">

- `QUERY_HE = [0.0, 3.0, 0.5]` 「像人」那一格给 3,「像东西」给 0。key 一个都没改,只换了 query。
- `weights = softmax({tok: match(QUERY_HE, k) for tok, k in KEYS.items()})` 「他」对「客户」:0 × 0 + 3 × 1 + 0.5 × 0 = 3.0;对「发票」:0 × 1 = 0。
- `best = max(weights, key=lambda t: weights[t])` 对字典用 `max` 遍历的是键,`key=` 告诉它按权重比。

</div>

```bash
uv run part02/attn_who.py
```

```text
「他」最看重: 客户 0.726
{'客户': 0.726, '说': 0.06, '发票': 0.036, '开': 0.06, '错': 0.046, '了': 0.036, ',': 0.036}
```

同样一排词、同样的 key,换了 query,注意力就从「发票」(0.684)跑到了「客户」(0.726)。这就是「谁看谁、看多重取决于看的人在找什么」。真模型里每个 token 的 query 是训练学出来的,「它」和「他」学出来的 query 自然就不一样。

</details>

**练习 2:分数放大和缩小。** 写 `part02/attn_sharp.py`,把 `attn_softmax.py` 的 `SCORES` 每个都乘 0.1、1、10 再 softmax,打印「发票」「客户」「了」三个的权重。和 Day 110 的 temperature 对比一下,说说公式里那个「除以 √d」是在防什么。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/attn_sharp.py
from attn_softmax import SCORES, softmax

for scale in (0.1, 1, 10):
    weights = softmax({tok: s * scale for tok, s in SCORES.items()})
    print(f"分数 × {scale:<4} 发票 {weights['发票']:.3f}  客户 {weights['客户']:.3f}  了 {weights['了']:.3f}")
```

<div class="line-notes">

- `from attn_softmax import SCORES, softmax` 手写的那组分数和 softmax 函数。
- `weights = softmax({tok: s * scale for tok, s in SCORES.items()})` 每个分数乘同一个倍数。乘 10 时「发票」变成 30,「客户」变成 10。
- `print(f"分数 × {scale:<4}` `:<4` 占 4 格、左对齐。

</div>

```bash
uv run part02/attn_sharp.py
```

```text
分数 × 0.1  发票 0.179  客户 0.146  了 0.132
分数 × 1    发票 0.690  客户 0.093  了 0.034
分数 × 10   发票 1.000  客户 0.000  了 0.000
```

乘 0.1 时权重几乎平均,「发票」0.179 和「了」0.132 没差多少,等于什么都没看清;乘 10 时「发票」拿走全部,其他全是 0。这和 Day 110 的 temperature 是同一件事:分数乘一个大于 1 的数,相当于温度调低,分布变尖;乘一个小于 1 的数,相当于温度调高,分布变平。

真模型里 query 和 key 有一百多个数,对应位置相乘再相加,数字越多,加出来的分数通常越大,softmax 就会像「× 10」那一行一样变得极尖,只盯一个词,其余全部忽略,训练也会变得很难。除以 √d(d 是数组长度,比如 128 的平方根约 11.3)就是把分数拉回一个合适的范围,让它别那么尖。

</details>

**练习 3:打乱顺序。** 写 `part02/attn_shuffle.py`:把 `KEYS` 里的词随机打乱顺序,重新算「它」的权重,检查每个词的权重和打乱前是不是完全一样。这说明了什么?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/attn_shuffle.py
import random

from attn_qk import KEYS, QUERY_IT, match
from attn_softmax import softmax

items = list(KEYS.items())
random.Random(7).shuffle(items)
print("打乱后的顺序:", [tok for tok, _ in items])
before = softmax({tok: match(QUERY_IT, k) for tok, k in KEYS.items()})
after = softmax({tok: match(QUERY_IT, k) for tok, k in items})
print("每个词的权重都一样吗?", all(abs(before[t] - after[t]) < 1e-12 for t in KEYS))
```

<div class="line-notes">

- `items = list(KEYS.items())` 变成(词, key)元组的列表,列表才能打乱。
- `random.Random(7).shuffle(items)` 用种子 7 的随机数生成器原地打乱(Day 112 练习 3 讲过独立的生成器)。你跑出来的顺序和我一样。
- `after = softmax({tok: match(QUERY_IT, k) for tok, k in items})` 按打乱后的顺序重新算一遍。
- `print("每个词的权重都一样吗?", all(abs(before[t] - after[t]) < 1e-12 for t in KEYS))` `all(...)` 全部为真才是真,相当于 JS 的 `every`。小数不用 `==` 比,差距小于 1e-12(0.000000000001)就算一样。

</div>

```bash
uv run part02/attn_shuffle.py
```

```text
打乱后的顺序: ['了', ',', '错', '客户', '开', '说', '发票']
每个词的权重都一样吗? True
```

「了 , 错 客户 开 说 发票」已经不成句子了,可「它」给每个词的权重一点没变。注意力只看 query 和 key 对不对得上,根本不知道谁在前谁在后。所以真模型必须另外加上位置编码,把「我在第几个位置」也揉进每个 token 的数字里,模型才分得清「客户说发票开错了」和「发票说客户开错了」。

</details>

**练习 4:Agent 越聊越慢。** 假设一个客服 Agent 每轮对话往历史里加 500 个 token,每轮都把全部历史重新发给模型。写 `part02/chat_turns_cost.py`,复用 `attn_cost.py` 的 `pairs`,算第 1、10、20 轮各自要打多少次分、累计多少次,以及第 20 轮是第 1 轮的几倍。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/chat_turns_cost.py
from attn_cost import pairs

PER_TURN = 500
history = 0
total = 0
for turn in range(1, 21):
    history += PER_TURN
    total += pairs(history)
    if turn in (1, 10, 20):
        print(f"第 {turn:>2} 轮: 窗口 {history:>6,} token, 这一轮 {pairs(history):>12,} 次, 累计 {total:>14,} 次")
print("第 20 轮单轮是第 1 轮的", round(pairs(20 * PER_TURN) / pairs(PER_TURN)), "倍")
```

<div class="line-notes">

- `from attn_cost import pairs` 能直接导入,是因为 `attn_cost.py` 把打印放在了 main guard 下面。没放的话,一导入就会先把那 6 行打出来,我写的第一版就是这样。
- `history += PER_TURN` 每轮历史多 500 个 token。第 20 轮是 10,000 个。
- `total += pairs(history)` 每轮都要把整段历史重新算一遍注意力,累加起来。
- `if turn in (1, 10, 20):` 只打印三轮,`in` 检查元素在不在元组里,相当于 JS 的 `[1, 10, 20].includes(turn)`。

</div>

```bash
uv run part02/chat_turns_cost.py
```

```text
第  1 轮: 窗口    500 token, 这一轮      125,250 次, 累计        125,250 次
第 10 轮: 窗口  5,000 token, 这一轮   12,502,500 次, 累计     48,138,750 次
第 20 轮: 窗口 10,000 token, 这一轮   50,005,000 次, 累计    358,802,500 次
第 20 轮单轮是第 1 轮的 399 倍
```

历史只长了 20 倍,单轮的打分次数涨了 399 倍,20 轮累计 3.6 亿次。这里有个浪费你可能已经发现了:第 20 轮的前 9,500 个 token 和第 19 轮一模一样,却要从头再算一遍。能不能把算过的存起来?明天讲的 KV cache 就是干这个的。

</details>

**验收标准:** `attn_softmax.py`、`attn_qk.py`、`attn_mix.py`、`peek_cheat.py`、`causal_mask.py`、`attn_cost.py` 和四个练习脚本跑通,输出和文章一致(`peek_cheat.py` 和 `mask_off_by_one.py` 的报错也要一致);能指着代码说出打分、softmax、加权求和各在哪一行;能画出因果遮罩的下三角并解释为什么对角线要留;能说出为什么长 prompt 更慢更贵,以及为什么实测不是严格的平方。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Transformer | 2017 年《Attention Is All You Need》提出的模型结构,同一种层叠几十次,每层先注意力再前馈网络。现在的大模型几乎都基于它 |
| decoder-only | 只有「解码器」部分的 Transformer,生成模型用的就是这种,带因果遮罩 |
| 层(layer) | Transformer 里重复堆叠的单元。DeepSeek-V4-Flash 有 43 层 |
| 向量 | 一串数字,今天当成 JS 里的 `number[]` 就行。每个 token 在模型里就是一个向量 |
| 注意力(attention) | 每个 token 给前面的 token 打分、softmax 成权重、按权重混合它们的信息 |
| query / key / value | 每个 token 准备的三样东西:我在找什么 / 我是什么 / 被看时交出去什么 |
| 点积 | 两个等长数组对应位置相乘再相加,注意力用它给 query 和 key 打分。第四部分正式讲 |
| 因果遮罩(causal mask) | 每个位置只能看自己和前面的 token。实现是把后面位置的分数改成负无穷 |
| 多头注意力 | 一层里同时跑几十套 query/key/value,每套是一个「头」,从不同角度看 |
| 位置编码 / RoPE | 把「第几个位置」的信息加进 token 里,因为注意力本身不分先后。RoPE 是现在最常用的一种 |
| 前馈网络(FFN) | 每层里注意力之后的那一块,每个 token 自己消化信息,不看别人。一般认为事实性知识主要存在这里 |
| 稀疏注意力 | 不让每个 token 和前面所有 token 都打分,只挑一部分,用来降低长上下文的计算量 |
| `math.inf` | Python 的无穷大,相当于 JS 的 `Infinity`;`math.exp(-math.inf)` 是 0.0 |
| `nan` | not a number,「不是一个数」。深度学习里遮罩写错常常不报错,而是算出一堆 nan |

## 常见误区

**以为注意力只看最相关的那一个词。** softmax 之后每个词都会分到一点权重,实跑里分数为 0 的「了」也有 0.034。注意力是「主要看谁」。窗口里无关的东西越多,被分走的就越多。

**以为每个词的重要性是固定的。** 同一个「发票」,被「它」看时权重 0.684,被「他」看时只有 0.036。分数是 query 和 key 一起决定的,看的人在找什么,决定它看谁。

**因果遮罩写成 `j < i`。** 第一个位置一个能看的都没有,6 个分数全是负无穷,实跑报 `ZeroDivisionError: float division by zero`;在真实的框架里会变成一片 `nan`。要写 `j <= i`,自己必须能看自己。

**以为训练时也是一个一个 token 生成。** 训练是整段文本一次塞进去,每个位置同时猜下一个,所以必须用遮罩挡住后面。不挡的话,玩具实测练习题 34/34 全对,一到生成就 `IndexError`。

**把「平方增长」直接套到 API 耗时上。** 实测 393 到 39,013 个 token,耗时只从 0.75 秒到 1.16 秒,短 prompt 的耗时大头是网络和排队;而且 DeepSeek V4 用了稀疏注意力,不是每对都算。趋势要记住,数字要实测。

**以为模型知道词的先后顺序是注意力的功劳。** 打乱顺序后权重完全不变,顺序信息来自位置编码,不是注意力本身。

## 学习资料

### 文档与文章

- [Jay Alammar《The Illustrated Transformer》](https://jalammar.github.io/illustrated-transformer/):英文,图解 Transformer 最有名的一篇,网上有很多中文翻译(按标题搜「图解 Transformer」)。今天看到 Self-Attention 那一节,它画的 query/key/value 和今天的三步一模一样。30 分钟。
- [Transformer Explainer](https://poloclub.github.io/transformer-explainer/):佐治亚理工做的网页,在浏览器里跑一个真的 GPT-2 小模型,输入一句话,能点开每一层看注意力权重。今天玩 15 分钟,找到那张下三角的注意力图。
- [bbycroft.net/llm](https://bbycroft.net/llm):一个 3D 的大模型可视化,把一个小 GPT 每一步的数字都画出来了。看个大概就行,不用全懂。
- [Vaswani 等《Attention Is All You Need》](https://arxiv.org/abs/1706.03762):2017 年的原始论文,英文。今天只看图 1 和 3.2 节的那个公式,对照今天的三步认一认 Q、K、V。
- [DeepSeek-V4-Flash 模型说明](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash):今天引用的 43 层、64 个头、稀疏注意力省计算量的说法都在这页和它的 `config.json` 里。只看开头的介绍。
- [Hugging Face LLM Course:How do Transformers work?](https://huggingface.co/learn/llm-course/chapter1/4):Hugging Face 官方入门课的一节,讲 Transformer 全貌和注意力层,有中文版(页面右上角切换语言)。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1TZ421j7Ke&autoplay=0&high_quality=1" title="【官方双语】直观解释注意力机制，Transformer的核心 | 【深度学习第6章】" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>3Blue1Brown · 【官方双语】直观解释注意力机制,Transformer 的核心(深度学习第 6 章)· 26 分钟,官方中英双语。今天最推荐的一个,query、key、value 和遮罩都有动画,看完整集。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1r8nMz4EAj&p=1&autoplay=0&high_quality=1" title="李宏毅 | 自注意力机制和Transformer详细解析，目前最合适新手看的Transformer课程！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>李宏毅深度学习课堂(搬运)· 李宏毅自注意力机制和 Transformer 详细解析 · 中文。今天看第 1 P「自注意力机制(上)」28 分钟,用板书一步一步算 query、key 和权重,和今天的脚本是同一个过程。第 2 P 讲多头和位置编码,有空再看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV13z421U7cs&autoplay=0&high_quality=1" title="【官方双语】GPT是什么？直观解释Transformer | 深度学习第5章" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>3Blue1Brown · 【官方双语】GPT 是什么?直观解释 Transformer(深度学习第 5 章)· 27 分钟。如果第 6 章看得吃力,先看这一集建立全貌:token 变向量、一层层往上传、最后变成概率表。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/kCc8FmEb1nY" title="Let's build GPT: from scratch, in code, spelled out." loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Andrej Karpathy · Let's build GPT: from scratch, in code, spelled out · 英文,两小时。从零写一个小 GPT,中间有一段专门讲自注意力和下三角遮罩(他用 `tril` 造那个三角)。今天不用看完,收藏,等第四部分学了 numpy 再回来看。</figcaption>
</figure>

### 书籍

- 《从零构建大模型》(Sebastian Raschka 著,覃立波、冯骁骋译,人民邮电出版社,2025 年;英文原版《Build a Large Language Model (From Scratch)》,Manning,2024 年):第 3 章专讲注意力,从「不带可训练参数的简单注意力」写到因果遮罩和多头,和今天的顺序几乎一样。代码用 PyTorch,今天先读文字和图。

### 开源项目与代码

- [karpathy/nanoGPT](https://github.com/karpathy/nanoGPT):Day 110 让你在 `model.py` 里找过采样那几行。今天再打开 `model.py`,找到 `class CausalSelfAttention`,里面的 `masked_fill(..., float('-inf'))` 就是今天的遮罩那一行。
- [rasbt/LLMs-from-scratch](https://github.com/rasbt/LLMs-from-scratch):上面那本书的配套代码,`ch03` 目录是注意力那一章的笔记本。

## 自测

1. 用三步说清注意力在干什么。

<details><summary>答案</summary>

每个 token 用自己的 query 和前面每个 token 的 key 打分(对应位置相乘再相加);分数用 softmax 变成加起来为 1 的权重;按权重把前面每个 token 的 value 加起来,作为这个位置的新内容。实跑里「它」给「发票」0.684 的权重,新内容是 [0.684, 0.684, 0.093],带上了「是票据、带金额」的信息。

</details>

2. key 和 value 为什么要分开?

<details><summary>答案</summary>

key 是用来被找到的标签(「我是什么」),value 是被找到之后交出去的内容(「我能提供什么」),两者不是一回事。像图书馆的书,分类号用来找书,书的内容才是要拿走的东西。分开后,模型可以学成「靠某种特征被找到,但交出另一种信息」。

</details>

3. 什么是因果遮罩?训练时不加会怎样?写成 `j < i` 会怎样?

<details><summary>答案</summary>

每个位置只能看自己和前面的 token,实现是 softmax 前把后面位置的分数设成负无穷,权重变成 0,整张权重表是下三角。训练时整段文本一次塞进去,不加遮罩,每个位置能直接看到它要猜的那个 token,等于抄答案:玩具实测练习题全对,生成时却拿不到下一个词。写成 `j < i` 会把对角线也挡住,第一个位置一个能看的都没有,分数全是负无穷,exp 后总和为 0,实跑报 `ZeroDivisionError`,真实框架里会出 `nan`。

</details>

4. 输入从 1000 个 token 变成 2000 个,一层一个头的注意力打分次数变成几倍?为什么我实测 DeepSeek 时,393 到 39,013 个 token 耗时只多了 0.4 秒?

<details><summary>答案</summary>

n × (n + 1) ÷ 2,从 500,500 变成 2,001,000,约 4 倍。实测对不上平方,一是短 prompt 的耗时主要是网络来回和排队,计算只占一小部分;二是 DeepSeek V4 用了压缩稀疏注意力,不是每对 token 都算分。到 39.9 万 token 时计算才明显起来,耗时到了 6 秒。

</details>

5. 面试题:「讲讲 Transformer 里的注意力。为什么长上下文又慢又贵?工程上怎么应对?」

<details><summary>答案</summary>

Transformer 是同一种层叠几十次,每层先注意力、再前馈网络。注意力让每个 token 用 query 和前面 token 的 key 打分,softmax 成权重,再按权重加权求和它们的 value;生成模型加因果遮罩,只能看前面;多头从多个角度同时看;注意力本身不分顺序,靠 RoPE 这类位置编码补上。长上下文贵,是因为每个新 token 都要和前面所有 token 算分,总计算量随长度平方增长,首个 token 延迟变长,推理时要存的中间结果也随长度变多。工程上:控制 prompt 长度,只放相关资料(检索而不是全塞);对话历史截断或压缩;把不变的内容(系统提示词、工具说明)放在最前面,利用厂商的前缀缓存;模型侧有稀疏注意力等优化,但实际延迟要按自己的请求实测。

</details>

## 明天预告

Day 117 · MoE 和 KV cache。今天讲的是每层里的注意力,明天讲另外两件面试必问的事:一是每层里那块前馈网络,DeepSeek-V4-Flash 为什么总共 2840 亿参数、每个 token 却只用 130 亿(MoE,混合专家);二是练习 4 留下的那个浪费,第 20 轮把前 9,500 个 token 从头再算一遍,能不能把算过的 key 和 value 存起来(KV cache),以及它和 DeepSeek 账单上那个便宜 50 倍的「缓存命中价」是什么关系。
