---
title: 'Day 118 · 第 17 周复习:大模型与 API(Day 112–117)'
description: '这一周讲了 top_p 和 seed、训练三阶段、幻觉、思考模式、注意力、MoE 和 KV cache。今天把它们分成「怎么用」和「为什么」两条线画成一张图,逐天一句话回顾,默写 apply_top_p 和因果遮罩,再给 Day 113 的玩具模型做一次体检:top_p 降不了幻觉、种子能复现、多看一个词错误归零,顺便数一数它的注意力和 KV 计算次数。'
pubDate: 2026-10-22
regime: none
tags: ['llm-basics', 'review', 'python', 'agent-zero']
series: 'agent-zero'
day: 118
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 117](/blog/agent-zero/day-117-moe-kvcache/) 讲了两件事。MoE 把每层的前馈网络拆成很多个专家,路由器给每个 token 挑少数几个,所以 DeepSeek-V4-Flash 总共 284B 参数、每个 token 只用 13B:显存看总参数,速度看激活参数。KV cache 把前面 token 的 key 和 value 存起来复用,玩具里计算从 104,950 次降到 1,099 次、结果一字不差;厂商把它推到跨请求,同一段 4073 token 的系统提示词第二次命中 3840 个,输入费便宜 92%,而开头加一行时间就全部失效。

这一周的六天,前四天(Day 112–115)讲的是「模型用起来是什么样、怎么调」,后两天(Day 116–117)第一次打开模型内部。今天不讲新东西,把这两条线接起来,再用一个小项目把本周的零件拼一遍。

## 今天要解决的问题

学完今天,你应该能做到:

1. 不看文章,画出本周的知识地图:采样参数(top_p、seed)、训练三阶段、幻觉、思考、注意力、MoE、KV cache 各自在「一次调用」里的位置,并说出每一块是哪天讲的。
2. 默写 `apply_top_p`(Day 112)和带因果遮罩的 `masked_row`(Day 116),和原文件比对完全一致。
3. 写完 `week17_lab.py`:给 Day 113 的玩具模型做一次体检,用实跑结果回答三个问题:top_p 能不能降幻觉、种子能不能复现、一句话要算多少次注意力和 K/V。
4. 对着本周的坑清单,每一条都能说出现象和修法。

预计用时:3 小时左右(复习日,默写和小项目占大头)。前置:Day 112–117 全部,特别是 [Day 112](/blog/agent-zero/day-112-sampling-2/) 的 `top_p.py`、[Day 113](/blog/agent-zero/day-113-training/) 的 `toy_lm.py`、[Day 114](/blog/agent-zero/day-114-hallucination/) 的 `toy_hallucination.py` 和练习 1 的三元模型、[Day 116](/blog/agent-zero/day-116-attention/) 的 `causal_mask.py` 和 `attn_cost.py`。

学法提示:先不看文章,把知识地图在纸上画一遍再对照下面的图;小项目对照逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,把 `generate_top_p` 和 `checkup` 默写出来;动手练习做不出再展开参考答案,看完关掉,自己重写一遍。

## 本周知识地图

[Day 111](/blog/agent-zero/day-111-week16-review/) 那张图是一条流水线:文字 → token → 窗口 → 模型 → 概率表 → 采样 → 下一个 token。上周模型只是中间一个蓝色的黑盒子。这一周做了两件事:在黑盒子外面多认识了几个旋钮和现象,又把黑盒子打开看了一眼。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="第 17 周知识地图:模型内部有注意力、MoE 和 KV cache,模型从训练三阶段而来;模型外面是 top_p、seed 采样和思考模式,输出可能有幻觉">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink-soft)">「为什么」这条线:模型从哪来、里面是什么</text>
<rect x="20" y="36" width="170" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="105" y="58" text-anchor="middle" fill="var(--ink)">训练三阶段</text>
<text x="105" y="78" text-anchor="middle" fill="var(--ink-faint)">Day 113 预训练·SFT·RLHF</text>
<line x1="190" y1="66" x2="220" y2="66" stroke="var(--ink-soft)"/>
<rect x="220" y="36" width="400" height="104" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="236" y="56" fill="var(--ink)">模型内部(每层叠几十次)</text>
<rect x="236" y="66" width="170" height="30" rx="4" fill="none" stroke="var(--mem)"/>
<text x="321" y="86" text-anchor="middle" fill="var(--ink)">注意力 · 因果遮罩</text>
<rect x="420" y="66" width="185" height="30" rx="4" fill="none" stroke="var(--mem)"/>
<text x="512" y="86" text-anchor="middle" fill="var(--ink)">前馈网络 · MoE</text>
<text x="321" y="116" text-anchor="middle" fill="var(--ink-faint)">Day 116</text>
<text x="512" y="116" text-anchor="middle" fill="var(--ink-faint)">Day 117</text>
<text x="236" y="134" fill="var(--ink-faint)">K/V 存起来复用 = KV cache(Day 117)</text>
<line x1="420" y1="140" x2="420" y2="170" stroke="var(--ink-soft)"/>
<text x="20" y="166" fill="var(--ink-soft)">「怎么用」这条线:你调用时能控制和要提防的</text>
<rect x="20" y="178" width="140" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="90" y="200" text-anchor="middle" fill="var(--ink)">思考模式</text>
<text x="90" y="220" text-anchor="middle" fill="var(--ink-faint)">Day 115 草稿纸</text>
<rect x="175" y="178" width="140" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="245" y="200" text-anchor="middle" fill="var(--ink)">概率表</text>
<text x="245" y="220" text-anchor="middle" fill="var(--ink-faint)">Day 110 回顾</text>
<rect x="330" y="178" width="140" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="400" y="200" text-anchor="middle" fill="var(--ink)">top_p · seed</text>
<text x="400" y="220" text-anchor="middle" fill="var(--ink-faint)">Day 112 采样</text>
<rect x="485" y="178" width="135" height="56" rx="4" fill="none" stroke="var(--rule)"/>
<text x="552" y="200" text-anchor="middle" fill="var(--ink)">输出</text>
<text x="552" y="220" text-anchor="middle" fill="var(--ink-faint)">可能是幻觉 114</text>
<line x1="160" y1="206" x2="175" y2="206" stroke="var(--ink-soft)"/>
<line x1="315" y1="206" x2="330" y2="206" stroke="var(--ink-soft)"/>
<line x1="470" y1="206" x2="485" y2="206" stroke="var(--ink-soft)"/>
<text x="20" y="262" fill="var(--ink-faint)">幻觉的根在上面(训练只学「像」,Day 113–114),不在下面的采样参数</text>
<text x="20" y="284" fill="var(--ink-faint)">缓存命中、长 prompt 变慢这些账单上的现象,根在注意力和 KV cache(Day 116–117)</text>
</g>
</svg>
<figcaption>第 17 周的地图。蓝色是模型本身,琥珀色是你调用时能碰到的部分。这一周最重要的收获是知道每个现象该去哪一层找原因。</figcaption>
</figure>

图下面那两行灰字是这周最值得记住的一件事:**现象和原因经常不在同一层**。模型说错价格,你第一反应可能是去调温度或 top_p,可原因在训练目标上;账单上同样的提示词有时便宜有时贵,原因在 KV cache 和前缀是不是一模一样。今天的小项目会用实跑数据证明第一句。

## 本周每天一句话

- [Day 112](/blog/agent-zero/day-112-sampling-2/) · 采样(二):top_p 按累计概率砍掉长尾,seed 让本地随机能复现;但 DeepSeek 非思考模式下 top_p 被忽略,temperature=0 同一问题问 5 次出了 5 种答案,原因在服务端的批处理和浮点计算顺序。
- [Day 113](/blog/agent-zero/day-113-training/) · 训练:预训练是数语料学续写,所以 base 模型问一句会接着出题;SFT 教会它「轮到我回答了」;RLHF 按人的偏好挪概率,标注员喜欢什么它就变成什么。
- [Day 114](/blog/agent-zero/day-114-hallucination/) · 幻觉:模型学的是「像」不是「对」,只看前一个词的玩具三种价格各说错三分之二;缓解靠允许说不知道、多问几次看一致性、给资料并用代码核对引文。
- [Day 115](/blog/agent-zero/day-115-reasoning-models/) · 思考模式:回答前先写草稿,放在 `reasoning_content`,按输出 token 收钱;三道算账题关思考对 1 道、开思考全对、贵 13 倍;`max_tokens` 给少了 `content` 是空的,`finish_reason` 是 `length`。
- [Day 116](/blog/agent-zero/day-116-attention/) · 注意力:query 和 key 打分、softmax 变权重、按权重加 value;因果遮罩只许往前看,写成 `j < i` 会 `ZeroDivisionError`;打分次数随长度平方涨,实测 39 万 token 要 6 秒。
- [Day 117](/blog/agent-zero/day-117-moe-kvcache/) · MoE 和 KV cache:总参数决定显存、激活参数决定速度;前面 token 的 K/V 不会变,存起来复用;跨请求的前缀缓存命中价便宜 50 倍,前缀必须一字不差。

哪一句你读完没法接着讲两分钟,就回那一天重读正文,再做一遍那天的练习 1。

## 本周的几个关键数字

全是这一周实跑或从官方页面查到的:

| 数字 | 出处 | 用途 |
| --- | --- | --- |
| temperature=0 同题 5 次 5 种答案,第 38 个字开始分岔 | Day 112 实测 | 测试别断言整段原文 |
| top_p=0.1 仍出了只有 0.6% 概率的「金」 | Day 112 实测 | DeepSeek 非思考模式忽略 top_p |
| DeepSeek-V3 预训练 14.8 万亿 token | Day 113,技术报告 | 预训练规模的量级 |
| 玩具三种套餐价格各说错 66%–68% | Day 114 实测 | 幻觉来自「只看片段」 |
| 假书 5 次 4 次编同一个名字(一致率 80%) | Day 114 实测 | 一致性只能当筛子 |
| 关思考 1/3、开思考 3/3,贵 13 倍 | Day 115 实测 | 按步骤决定开不开思考 |
| 393 → 39,013 token 耗时 0.75 → 1.16 秒,399,013 token 6.01 秒 | Day 116 实测 | 长 prompt 变慢要实测 |
| V4-Flash 总 284B、激活 13B、256 专家选 6 个 | Day 117,模型说明页 | 总参数和激活参数 |
| Qwen3-8B 每 token KV cache 144 KB | Day 117 计算 | 估显存和并发 |
| 缓存命中 0.04 元、未命中 2 元每百万 token(高峰) | Day 117,价格页 | 算缓存能省多少 |

## 小项目:给玩具模型做一次体检

本周的小项目只用这一周学的东西,不调 API。对象是 Day 113 那个只看前一个词的 bigram 玩具,Day 114 已经知道它说错价格的比例是三分之二。今天给它做一次完整的体检,回答三个问题:

1. 用 Day 112 的 top_p 把长尾砍掉,它会不会少说错?
2. 用 Day 112 的种子,两次体检的结果能不能一模一样?
3. 生成一句话,按 Day 116 和 Day 117 的算法,注意力要打多少次分、K/V 有缓存和没缓存各算几次?

判卷用的是 Day 115 的思路:能被程序判对错的题,写一个判卷函数。新建 `part02/week17_lab.py`:

```python
# agent-zero-lab/part02/week17_lab.py
import random
from collections import Counter

from attn_cost import pairs
from top_p import apply_top_p
from toy_lm import PRETRAIN, next_dist, train

FACTS = {"专业版": "99", "基础版": "39", "企业版": "299"}
model = train(PRETRAIN)


def generate_top_p(prompt: str, rng: random.Random, p: float, max_new: int = 12) -> list[str]:
    toks = prompt.split()
    for _ in range(max_new):
        dist = next_dist(model, toks[-1])
        if not dist:
            toks.append("<不知道>")
            break
        dist = apply_top_p(dist, p)
        toks.append(rng.choices(list(dist.keys()), weights=list(dist.values()))[0])
        if toks[-1] == "。":
            break
    return toks


def price_ok(toks: list[str], plan: str) -> bool:
    return len(toks) > 3 and toks[3] == FACTS[plan]


def kv_counts(prompt_len: int, new: int) -> tuple[int, int]:
    no_cache = sum(prompt_len + j for j in range(new))
    with_cache = prompt_len + max(new - 1, 0)
    return no_cache, with_cache


def checkup(p: float, seed: int, n: int = 300) -> tuple[float, Counter[str], list[str]]:
    rng = random.Random(seed)
    wrong, said, first_ten = 0, Counter[str](), []
    for i in range(n):
        plan = list(FACTS)[i % 3]
        toks = generate_top_p(f"云簿 {plan} 每月", rng, p)
        said[toks[3]] += 1
        wrong += not price_ok(toks, plan)
        if i < 10:
            first_ten.append(" ".join(toks))
    return wrong / n, said, first_ten


if __name__ == "__main__":
    for p in (1.0, 0.5):
        rate, said, _ = checkup(p, seed=0)
        print(f"top_p={p}: 价格说错 {rate:.0%}, 说过的价格 {dict(said)}")
    a = checkup(1.0, seed=42)[2]
    b = checkup(1.0, seed=42)[2]
    print("同一个种子跑两次, 前 10 句一样吗?", a == b, "| 第一句:", a[0])
    toks = generate_top_p("云簿 专业版 每月", random.Random(1), 1.0)
    no_cache, with_cache = kv_counts(3, len(toks) - 3)
    print(f"「{' '.join(toks)}」: 注意力打分 {pairs(len(toks))} 次, K/V 没缓存 {no_cache} 次, 有缓存 {with_cache} 次")
```

<div class="line-notes">

- `from attn_cost import pairs` Day 116 的 `part02/attn_cost.py`,数 n 个 token 一层一个头要打几次分。
- `from top_p import apply_top_p` Day 112 的 `part02/top_p.py`,按累计概率砍长尾再归一。
- `from toy_lm import PRETRAIN, next_dist, train` Day 113 的 `part02/toy_lm.py`:6 行语料、数数训练、查概率表。
- `FACTS = {"专业版": "99", "基础版": "39", "企业版": "299"}` 标准答案,和 Day 114 `toy_hallucination.py` 里的一样。没有直接从那个文件导入,是因为它没有 main guard,一导入就会把那 1000 次生成跑一遍、打印三行。
- `model = train(PRETRAIN)` 训练出 bigram 模型。
- `def generate_top_p(prompt: str, rng: random.Random, p: float, max_new: int = 12) -> list[str]:` 和 Day 113 的 `generate` 几乎一样,多了一个 `p`,并且返回词列表而不是拼好的字符串,方便后面取第 4 个词。
- `dist = next_dist(model, toks[-1])` 只看最后一个词查概率表。「每月」得到 99、39、299 各 1/3。
- `toks.append("<不知道>")` 查不到下一个词时,不是悄悄停下,而是明确写一个「不知道」。这是 Day 114 第一招在玩具里的样子。bigram 模型在本项目里碰不到这种情况,练习 2 的三元模型会碰到。
- `dist = apply_top_p(dist, p)` 采样前先砍长尾。p=0.5 时,99(1/3)不够 0.5,再加 39 到 2/3,停,299 被砍掉。三个概率一样时谁排前面,看字典里的顺序。
- `toks.append(rng.choices(list(dist.keys()), weights=list(dist.values()))[0])` 按概率掷骰子(Day 110),用传进来的 `rng`,不碰全局随机数(Day 112 的坑)。
- `def price_ok(toks: list[str], plan: str) -> bool:` 判卷函数,Day 115 `is_correct` 的同类:第 4 个词(下标 3)是不是这个套餐的真价。`len(toks) > 3` 防止句子太短时取下标报 `IndexError`。
- `def kv_counts(prompt_len: int, new: int) -> tuple[int, int]:` 按 Day 117 `kv_toy.py` 的规则数 K/V 计算次数。
- `no_cache = sum(prompt_len + j for j in range(new))` 没缓存:生成第 j 个新词时,窗口里有 prompt_len + j 个 token,全部重算。
- `with_cache = prompt_len + max(new - 1, 0)` 有缓存:prompt 算一次,之后每步只算上一步新来的那一个,最后一个新词后面没有下一步,不用算。`max(..., 0)` 防止 new 为 0 时变成负数。
- `def checkup(p: float, seed: int, n: int = 300) -> tuple[float, Counter[str], list[str]]:` 体检:用给定的 top_p 和种子生成 n 句,返回错误率、说过哪些价格、前 10 句原文。
- `wrong, said, first_ten = 0, Counter[str](), []` 一行建三个变量。`Counter[str]()` 是带类型的空计数器,写成 `Counter()` 编辑器会推断不出里面放什么。
- `plan = list(FACTS)[i % 3]` 三个套餐轮流问,每个 100 次。`list(FACTS)` 是字典的键列表。
- `wrong += not price_ok(toks, plan)` 说错就加 1。`not True` 是 `False`,当 0 加。
- `a = checkup(1.0, seed=42)[2]` 取返回元组的第三项,前 10 句原文。同一个种子跑两次,比较两次的原文。
- `toks = generate_top_p("云簿 专业版 每月", random.Random(1), 1.0)` 单独生成一句,拿来数计算次数。

</div>

```bash
uv run part02/week17_lab.py
```

实跑输出:

```text
top_p=1.0: 价格说错 68%, 说过的价格 {'299': 100, '99': 103, '39': 97}
top_p=0.5: 价格说错 69%, 说过的价格 {'39': 145, '99': 155}
同一个种子跑两次, 前 10 句一样吗? True | 第一句: 云簿 专业版 每月 39 元 。
「云簿 专业版 每月 99 元 。」: 注意力打分 21 次, K/V 没缓存 12 次, 有缓存 5 次
```

一行一行读,每一行都对应本周的一个结论。

**第一行:68%,和 Day 114 一致。** 300 句里三种价格各说了约 100 次,模型根本分不清在问哪个套餐。这个数和 Day 114 `toy_hallucination.py` 的 66%–68% 对得上,换了种子和次数,结论不变。

**第二行:top_p=0.5,错误率不降反升到 69%。** 砍掉长尾之后,299 再也没出现过,模型只在 99 和 39 之间挑。问专业版和基础版时,它照样一半对一半错;问企业版时,它**一定**说错,因为正确答案 299 被砍掉了。这正是知识地图下面那行字:幻觉的根在概率表本身(模型只看「每月」一个词),不在怎么从表里挑。top_p、temperature 改的是「怎么挑」,救不了一张错的表。Day 114 说「温度调到 0 也照样编」,今天换成 top_p 再证明一次。

**第三行:同一个种子,两次体检的前 10 句一模一样。** 本地的随机数用 `random.Random(42)` 固定起点,完全能复现。这是 Day 112 的结论的一半;另一半是 API 上做不到,服务端的计算顺序不归你管。

**第四行:一句 6 个 token 的话。** 注意力打分 21 次,就是 Day 116 那张 6 × 6 下三角的格子数,1 + 2 + … + 6。K/V 没缓存时,生成「99」「元」「。」三个词,窗口分别是 3、4、5 个 token,一共 12 次;有缓存是 3 + 1 + 1 = 5 次。句子短,差得不多;Day 117 的 1000 个 token 加 100 步,差了 95 倍。

### 零件 → 小项目对照

| 本周学的零件 | 在 `week17_lab.py` 的哪里 |
| --- | --- |
| Day 112 top_p | `apply_top_p(dist, p)` |
| Day 112 种子与可复现 | `random.Random(seed)`、`a == b` |
| Day 113 预训练(数数) | `train(PRETRAIN)`、`next_dist` |
| Day 114 幻觉与「不知道」 | `wrong`、`"<不知道>"` |
| Day 115 程序判卷 | `price_ok` |
| Day 116 注意力的计算量 | `pairs(len(toks))` |
| Day 117 KV cache | `kv_counts` |

## 本周错题与坑清单

把这一周「常见误区」里最容易再犯的挑出来。复习时盖住右边两列,看左边能不能说出现象和修法。

| 坑 | 现象 | 修法 |
| --- | --- | --- |
| 在 DeepSeek 上调 top_p | 非思考模式下 top_p=0.1 仍出了「金」开头,不报错 | 先查厂商文档;DeepSeek 非思考模式忽略 top_p(Day 112) |
| temperature 和 top_p 一起调 | 两种顺序留下 6 个和 4 个候选 | 只调一个,另一个保持默认(Day 112) |
| 以为 temperature=0 每次一样 | 同题 5 次 5 种回答 | 测试断言结构和关键事实,不断言原文(Day 112) |
| 用全局 `random.seed` | 中间任何一次 `random.random()` 都打乱后面 | 用 `random.Random(种子)` 建自己的生成器(Day 112) |
| 以为微调能教会新知识 | SFT 后格式对了,内容照样乱 | 知识用资料送进上下文(RAG),微调改格式和习惯(Day 113) |
| 以为调低温度或 top_p 能防幻觉 | 今天实测 top_p=0.5 错误率 68% → 69% | 给资料、允许说不知道、用代码核对(Day 114) |
| `quote in source` 不判空 | `"" in POLICY` 是 True,空引文被放行 | 先判空再判包含(Day 114) |
| 开思考把 `max_tokens` 设小 | `content` 是 `''`,`finish_reason` 是 `length` | 开思考给足几千;先查 `finish_reason == "stop"`(Day 115) |
| 只看 `content` | 截断的「36.7」看着像正常答案 | 拿到回答先确认 `finish_reason`(Day 115) |
| 遮罩写成 `j < i` | `ZeroDivisionError: float division by zero` | 写 `j <= i`,自己必须能看自己(Day 116) |
| 把平方增长直接套到 API 耗时 | 393 → 39,013 token 只慢了 0.4 秒 | 趋势记住,数字实测(Day 116) |
| 看激活参数估显存 | 以为 V4-Flash 24 GB 卡能跑,实际权重 159.6 GB | 显存看总参数(Day 117) |
| 系统提示词开头放时间 | 缓存命中从 3840 变 0 | 不变的放前面,会变的放后面(Day 117) |
| 函数里改模块变量不写 `global` | `UnboundLocalError: cannot access local variable 'calls'…` | 加 `global calls`(Day 117) |

## 动手练习

**练习 1:默写 top_p 和因果遮罩。** 不看 Day 112 和 Day 116,在 `part02/review_week17.py` 里写出 `my_top_p(dist, p)` 和 `my_masked_row(i, n)`(所有分数都是 0,只管遮罩),再分别和 `top_p.py` 的 `apply_top_p`、`causal_mask.py` 的 `masked_row` 比对结果。测试用的概率表:`{"99": 0.5, "39": 0.3, "299": 0.15, "9": 0.05}`,p 取 0.5、0.8、0.9。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/review_week17.py
import math

from causal_mask import masked_row
from top_p import apply_top_p


def my_top_p(dist: dict[str, float], p: float) -> dict[str, float]:
    kept: dict[str, float] = {}
    running = 0.0
    for tok, prob in sorted(dist.items(), key=lambda kv: kv[1], reverse=True):
        kept[tok] = prob
        running += prob
        if running >= p:
            break
    total = sum(kept.values())
    return {tok: prob / total for tok, prob in kept.items()}


def my_masked_row(i: int, n: int) -> list[float]:
    exps = [math.exp(0.0) if j <= i else math.exp(-math.inf) for j in range(n)]
    total = sum(exps)
    return [e / total for e in exps]


dist = {"99": 0.5, "39": 0.3, "299": 0.15, "9": 0.05}
for p in (0.5, 0.8, 0.9):
    mine = my_top_p(dist, p)
    print(f"top_p={p}: {({t: round(v, 3) for t, v in mine.items()})}  和 Day 112 一样: {mine == apply_top_p(dist, p)}")
same = all(my_masked_row(i, 6) == masked_row(i, 6, causal=True) for i in range(6))
print("遮罩第 2 行:", [round(w, 2) for w in my_masked_row(2, 6)], " 6 行都和 Day 116 一样:", same)
```

<div class="line-notes">

- `from causal_mask import masked_row` Day 116 的原版,用来比对。它的打印在 main guard 下面,导入不会输出。
- `for tok, prob in sorted(dist.items(), key=lambda kv: kv[1], reverse=True):` 按概率从高到低走。
- `if running >= p:` 累计到 p 就停,注意是先把当前这个放进去再判断,所以至少会留一个。p=0.5 时第一个 99 就有 0.5,够了,只留它。
- `return {tok: prob / total for tok, prob in kept.items()}` 留下的重新归一。p=0.8 时留 99 和 39,0.5 ÷ 0.8 = 0.625。
- `exps = [math.exp(0.0) if j <= i else math.exp(-math.inf) for j in range(n)]` 把「分数全为 0」和「后面的改成负无穷」合成一行:能看的 `exp(0)` = 1,不能看的 `exp(-inf)` = 0。
- `mine == apply_top_p(dist, p)` 两个字典键和值都相等才是 True。这里能直接用 `==` 比小数,是因为两边做的是完全相同顺序的计算,结果按位相同;不同算法算出来的小数要用差值比(Day 116 练习 3)。
- `same = all(my_masked_row(i, 6) == masked_row(i, 6, causal=True) for i in range(6))` 6 行逐行比,全部相同才是 True。

</div>

```bash
uv run part02/review_week17.py
```

```text
top_p=0.5: {'99': 1.0}  和 Day 112 一样: True
top_p=0.8: {'99': 0.625, '39': 0.375}  和 Day 112 一样: True
top_p=0.9: {'99': 0.526, '39': 0.316, '299': 0.158}  和 Day 112 一样: True
遮罩第 2 行: [0.33, 0.33, 0.33, 0.0, 0.0, 0.0]  6 行都和 Day 116 一样: True
```

p=0.8 那行值得多看一眼:0.5 + 0.3 正好等于 0.8,`>=` 成立,只留两个。如果写成 `>`,就会多留一个 299。这种边界上的差别,和遮罩的 `<=` 对 `<` 是同一类坑。

</details>

**练习 2:三元模型的体检。** 不看 Day 114,在 `part02/week17_trigram.py` 里重新写出 `train2`(看前两个词),再写一个带 top_p 的 `generate2`,查不到时追加 `"<不知道>"`。复用 `week17_lab.py` 的 `FACTS` 和 `price_ok`,跑 300 句数说错几句,再问一次语料里没有的「旗舰版」。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/week17_trigram.py
import random
from collections import Counter, defaultdict

from top_p import apply_top_p
from toy_lm import PRETRAIN
from week17_lab import FACTS, price_ok


def train2(corpus: list[str]) -> dict[tuple[str, str], Counter[str]]:
    counts: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    for line in corpus:
        toks = line.split()
        for a, b, c in zip(toks, toks[1:], toks[2:]):
            counts[(a, b)][c] += 1
    return counts


tri = train2(PRETRAIN)


def generate2(prompt: str, rng: random.Random, p: float, max_new: int = 12) -> list[str]:
    toks = prompt.split()
    for _ in range(max_new):
        c = tri[(toks[-2], toks[-1])]
        if not c:
            toks.append("<不知道>")
            break
        total = sum(c.values())
        dist = apply_top_p({t: n / total for t, n in c.items()}, p)
        toks.append(rng.choices(list(dist.keys()), weights=list(dist.values()))[0])
        if toks[-1] == "。":
            break
    return toks


rng = random.Random(0)
wrong = 0
for i in range(300):
    plan = list(FACTS)[i % 3]
    wrong += not price_ok(generate2(f"云簿 {plan} 每月", rng, 1.0), plan)
print(f"三元模型 300 句价格说错 {wrong} 句")
print("问旗舰版:", " ".join(generate2("云簿 旗舰版 每月", rng, 1.0)))
```

<div class="line-notes">

- `from week17_lab import FACTS, price_ok` 小项目的标准答案和判卷函数。`week17_lab.py` 的体检放在 main guard 下面,导入时只会执行 `train(PRETRAIN)` 这种定义,不会打印。
- `for a, b, c in zip(toks, toks[1:], toks[2:]):` 三个列表错开一位配对,每次取相邻三个词。
- `counts[(a, b)][c] += 1` 键是两个词的元组。元组能当字典的键,列表不能(Day 114 讲过)。
- `c = tri[(toks[-2], toks[-1])]` 用最后两个词查表。「专业版 每月」后面只有 99。
- `toks.append("<不知道>")` 两个词的组合从没见过,明确说不知道。
- `dist = apply_top_p({t: n / total for t, n in c.items()}, p)` 次数先变概率,再按 top_p 砍尾。

</div>

```bash
uv run part02/week17_trigram.py
```

```text
三元模型 300 句价格说错 0 句
问旗舰版: 云簿 旗舰版 每月 <不知道>
```

多看一个词,300 句一句不错;问语料里没有的旗舰版,它说「不知道」,没有编一个价格。和小项目第二行对比:**降幻觉要改的是模型看到了什么(上下文),不是怎么采样**。真模型靠注意力看前面一大段(Day 116),所以不会像 bigram 这样乱串价格;但它面对旗舰版这种从没见过的东西时,不会像三元模型那样老实停下,而是总能接出点什么,所以还要在提示词里给它「不知道」这条路(Day 114)。

</details>

**练习 3:一个 20 步的 Agent,缓存能省多少。** 假设一个 Agent 有 4000 token 的系统提示词,跑 20 步,每步历史多 300 个 token,每步都把全部内容发一遍。按 `deepseek-flash` 高峰价(未命中 2 元、命中 0.04 元每百万 token),比较两种写法:只在末尾追加(假设上一步发过的内容这一步全部命中),和在系统提示词开头写「当前第 N 步」(永远不命中)。写 `part02/agent_cache_cost.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/agent_cache_cost.py
MISS, HIT = 2.0, 0.04  # deepseek-flash 高峰价,元/百万 token
SYSTEM, PER_STEP, STEPS = 4000, 300, 20


def run(cache_ok: bool) -> float:
    cost = 0.0
    prev_input = 0
    for step in range(1, STEPS + 1):
        inp = SYSTEM + PER_STEP * step
        hit = prev_input if cache_ok else 0
        cost += (hit * HIT + (inp - hit) * MISS) / 1_000_000
        prev_input = inp
    return cost


good, bad = run(True), run(False)
print(f"20 步一共输入 {sum(SYSTEM + PER_STEP * s for s in range(1, STEPS + 1)):,} 个 token")
print(f"只在末尾追加(能命中): {good:.4f} 元;开头放步数(全不命中): {bad:.4f} 元;差 {bad / good:.1f} 倍")
```

<div class="line-notes">

- `SYSTEM, PER_STEP, STEPS = 4000, 300, 20` 三个假设,和 Day 117 实验的系统提示词差不多长。
- `inp = SYSTEM + PER_STEP * step` 第 step 步的输入:第 1 步 4300,第 20 步 10,000。这就是 Day 116 练习 4 的「越聊越长」。
- `hit = prev_input if cache_ok else 0` 能命中时,上一步发过的全部内容这一步都命中。这是乐观的假设:Day 117 实测命中是按块算的(4073 里命中 3840),零头会落空。
- `cost += (hit * HIT + (inp - hit) * MISS) / 1_000_000` 命中的按 0.04 元,剩下的按 2 元。第 1 步没有上一步,全部按 2 元。
- `prev_input = inp` 记下这一步的长度,给下一步用。

</div>

```bash
uv run part02/agent_cache_cost.py
```

```text
20 步一共输入 143,000 个 token
只在末尾追加(能命中): 0.0253 元;开头放步数(全不命中): 0.2860 元;差 11.3 倍
```

同样 14.3 万个输入 token,只因为「当前第 N 步」放在了开头,一次任务从 2.5 分钱变成 2 毛 9,贵了 11 倍。一个每天跑一万次的 Agent,就是每天 250 元和 2860 元的差别。实际命中会比这个假设少一点,但量级不会变。这一周的四件事在这一个数里全用上了:token 计价(Day 108)、每步重发全部历史(Day 109)、长度越长越贵(Day 116)、前缀缓存只认一字不差的开头(Day 117)。

</details>

**练习 4:三分钟讲清一次调用。** 面试常见的开放题:「从用户输入一句话到模型返回回答,中间发生了什么?」只用 Day 106–117 学过的东西,写一段三分钟能讲完的回答,要提到 token、窗口、注意力和因果遮罩、前馈网络和 MoE、KV cache、采样、思考模式,以及哪一步会产生幻觉。写在 `part02/explain_one_call.md` 里,读出来计时。

<details><summary>参考答案</summary>

这是一个示范,不是标准答案,你的版本只要每一环都讲对、讲得出一个具体数字就行:

> 用户那句话先被分词器切成 token,DeepSeek 下中文每字约 0.6 个 token,系统提示词、历史和这句话拼在一起,必须装进 1M 的窗口。模型拿到这串 token 先做预填充:每个 token 一层层往上走,每一层先做注意力,用 query 和前面 token 的 key 打分、softmax 成权重、加权取 value,因果遮罩保证只看前面;再过前馈网络,DeepSeek 这种 MoE 模型只让路由器选中的 6 个专家参与,所以 284B 的模型每个 token 只算 13B。预填充算出的每层 key 和 value 存进 KV cache,如果这段开头和之前的请求一字不差,厂商还能跨请求复用,按 0.04 元而不是 2 元收钱。之后进入解码:每一步只算一个新 token,最后一层给出下一个 token 的概率表,按 temperature 和 top_p 采样挑一个接回去,一直到结束 token 或 max_tokens。开了思考的话,先生成的是 reasoning_content 那段草稿,也按输出 token 收钱,能提高算账类题的准确率。幻觉不发生在某一步,而是概率表本身的性质:训练只学「什么后面接什么」,遇到像真的但没见过的问题,表上最高的那个也可能是错的,调采样参数救不了,要靠给资料和用代码核对。

我自己读了一遍,大约 2 分 40 秒。讲的时候每一环带一个本周实测的数字(5 种回答、68%、13 倍、3840),比只讲概念有说服力得多。

</details>

**验收标准:** `week17_lab.py`、`review_week17.py`、`week17_trigram.py`、`agent_cache_cost.py` 跑通,输出和文章一致;知识地图能默画出来,并说出每一块对应哪天;能用小项目的第二行解释「为什么调 top_p 救不了幻觉」;坑清单每一条盖住右边能说出现象和修法;练习 4 能在三分钟内讲完。

## 名词解释

本周新词都在各天的表里,这里只列今天第一次出现、或者今天换了个角度用的:

| 名词 | 意思 |
| --- | --- |
| 体检(本课说法) | 用固定种子批量生成、用程序判卷,量出一个模型在某类问题上的错误率。第六部分的「评测」就是它的正式版 |
| 判卷函数 | 能用程序判断回答对不对的函数,如 Day 115 的 `is_correct`、今天的 `price_ok` |
| `Counter[str]()` | 带类型标注的空计数器,让编辑器知道里面的键是字符串 |
| 预填充 / 解码 | Day 117 引入:先把整段 prompt 算一遍填进 KV cache,再一个一个生成。练习 4 的回答按这两段讲 |

## 常见误区

**以为采样参数能修幻觉。** 今天实测 top_p=0.5 时错误率从 68% 变成 69%,企业版的正确答案 299 被直接砍掉。幻觉的根在概率表,改的是上下文,不是采样。

**复习只看不写。** 读一遍觉得都懂,合上文章写 `apply_top_p` 时才发现 `>=` 和 `>` 分不清。默写比重读有效得多,写错的地方就是你真正没懂的地方。

**把本周的数字当成永远成立。** top_p 被忽略、缓存按块命中、39 万 token 要 6 秒,这些都是 2026 年 10 月在 `deepseek-flash` 上量的。换厂商、换版本都要重测,复习时记住「怎么测」比记住数字更重要。

**以为「懂原理」就要会推公式。** 这一周的注意力、MoE、KV cache,面试能讲清三步、四个数的关系、为什么能缓存,再配一个实测数字,就够应对应用岗。公式留到真要自己部署和微调时(第十部分)再看。

**导入没有 main guard 的文件。** 想从 `toy_hallucination.py` 导入 `FACTS`,结果一导入就先跑完 3000 次生成、打印三行。今天的做法是把常量在自己文件里再写一份;更好的做法是给原文件加 `if __name__ == "__main__":`。

## 学习资料

### 文档与文章

- 这一周六篇的「学习资料」里各有一两篇必读,复习日不加新的,把没读完的补上:[Day 112](/blog/agent-zero/day-112-sampling-2/) 的 DeepSeek 参数文档、[Day 115](/blog/agent-zero/day-115-reasoning-models/) 的思考模式文档、[Day 116](/blog/agent-zero/day-116-attention/) 的《The Illustrated Transformer》、[Day 117](/blog/agent-zero/day-117-moe-kvcache/) 的 DeepSeek 上下文缓存文档。
- [Transformer Explainer](https://poloclub.github.io/transformer-explainer/):Day 116 推荐过。复习时再玩一次,这次把它的 temperature 滑块和注意力图一起看,正好把本周两条线接起来:里面的注意力决定概率表,外面的温度决定怎么从表里挑。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV16cNEeXEer&autoplay=0&high_quality=1" title="【1080P】安德烈·卡帕西：深入探索像ChatGPT这样的大语言模型｜Andrej Karpathy" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>KrillinAI俊希(搬运,中文字幕)· 安德烈·卡帕西:深入探索像 ChatGPT 这样的大语言模型 · 3 个半小时。这一周的内容(预训练、SFT、RLHF、幻觉、思考模型、Transformer 内部)他在这一个视频里按顺序全讲了一遍,是最好的复习材料。今天看前 1 小时(从数据到 Transformer),剩下的分两天看完。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1TZ421j7Ke&autoplay=0&high_quality=1" title="【官方双语】直观解释注意力机制，Transformer的核心 | 【深度学习第6章】" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>3Blue1Brown · 直观解释注意力机制(深度学习第 6 章)· 26 分钟。Day 116 看过的再看一遍,这次试着在他讲每一步时说出对应 `attn_qk.py` 和 `causal_mask.py` 的哪一行。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/zjkBMFhNj_g" title="[1hr Talk] Intro to Large Language Models" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Andrej Karpathy · [1hr Talk] Intro to Large Language Models · 英文,1 小时。比上面那个短,前 20 分钟把训练三阶段和幻觉讲得很干净,时间紧就看这个。</figcaption>
</figure>

### 书籍

- 《从零构建大模型》(Sebastian Raschka 著,覃立波、冯骁骋译,人民邮电出版社,2025 年):Day 116 推荐的那本。复习日读第 3 章的小结和第 5 章讲生成和 temperature 的那一节,正好覆盖本周的两条线。

### 开源项目与代码

- [karpathy/nanoGPT](https://github.com/karpathy/nanoGPT):复习时打开 `model.py`,依次找到本周学过的四样东西:`CausalSelfAttention` 里的遮罩(Day 116)、`generate` 里的 `logits / temperature` 和 `top_k`(Day 110、112)、`MLP` 类(前馈网络,Day 116–117 说的那一块)。它没有 MoE 也没有 KV cache,想想如果要加,该改哪里。

## 自测

1. 小项目里 top_p 从 1.0 降到 0.5,错误率从 68% 变成 69%。为什么没降?要降应该改什么?

<details><summary>答案</summary>

bigram 模型只看「每月」一个词,概率表里 99、39、299 各 1/3,它根本不知道在问哪个套餐。top_p 只决定从这张表里怎么挑,p=0.5 砍掉了 299,问企业版时反而一定说错。要降得改模型看到的东西:多看一个词的三元模型 300 句一句不错。对真模型,对应的是把资料放进上下文,而不是调采样参数。

</details>

2. 本地用 `random.Random(42)` 两次结果一样,为什么 API 上 temperature=0 加 seed 也不能保证一样?

<details><summary>答案</summary>

本地的随机数和计算全在你手里,起点固定,每一步按同样顺序算,结果就一样。API 上同一个请求会和别人的请求拼在一起批量算,批的大小和顺序每次不同,浮点数相加的顺序变了,概率表本身就会有微小差别(Day 112 实测连第一个 token 的概率表都在 3 种之间跳),seed 只能固定采样那一步,管不了概率表。

</details>

3. 用一句话分别说出 Day 113 的三个训练阶段、Day 115 的思考模式、Day 116 的因果遮罩、Day 117 的 KV cache 之间有什么联系。

<details><summary>答案</summary>

预训练让模型学会「根据前文接下一个 token」,因果遮罩保证它训练时只能看前文、不能抄答案;正因为每个 token 的 K/V 只取决于前文,所以能存成 KV cache 复用;思考模式是在这套「只能看前文」的规则下,先把中间结果写到前文里,让后面的 token 能用上。几件事都建立在「自回归、只看前面」这一个前提上。

</details>

4. 一个同事说:「我们用的是 30B-A3B 的模型,激活才 3B,一张 8 GB 的卡就够部署了。」他错在哪?

<details><summary>答案</summary>

激活参数决定每个 token 算多少,不决定显存。所有 128 个专家都要装在显存里,Qwen3-30B-A3B 的 BF16 权重文件是 61.1 GB,8 GB 连权重都放不下,还没算 KV cache。显存要按总参数估。

</details>

5. 面试题:「你的 Agent 上线后,账单比预估贵了 10 倍,但请求量没变。你会从哪几个方向查?」

<details><summary>答案</summary>

先看 `usage` 里三个数:输入、输出、缓存命中。输入涨了,查是不是历史没截断、每步把越来越长的历史全发(Day 109、116),或者检索塞进了太多资料。缓存命中掉了,查提示词开头有没有放进会变的东西(时间、请求 ID、步数),或者工具列表顺序每次不一样,实测开头加一行时间命中就从 3840 变 0,练习 3 算出差 11 倍(Day 117)。输出涨了,查是不是默认开着思考模式,三道短题开思考就贵 13 倍(Day 115),以及 `max_tokens` 和截断后的重试有没有在反复花钱。最后按步骤拆账,看是哪一步贵,再按「准确率达标前提下最便宜」逐步调整。

</details>

## 明天预告

Day 119 · 哪些模型能本地跑,自己训一个要做什么。这一周你已经知道 MoE 的显存看总参数、KV cache 每 token 要一百多 KB,明天正好用上:把开源模型的版图过一遍,算清楚一台没有独立显卡的笔记本能跑多大的模型,再说说「自己训一个」需要的数据、算力和钱,为 Day 120 注册 API、正式开始调用做最后的铺垫。
