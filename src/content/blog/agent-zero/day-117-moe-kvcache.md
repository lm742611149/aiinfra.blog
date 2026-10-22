---
title: 'Day 117 · MoE 和 KV cache:总参数、激活参数,为什么能缓存'
description: 'DeepSeek-V4-Flash 总共 2840 亿参数,每个 token 只用 130 亿,这是 MoE:每层的前馈网络拆成 256 个专家,路由器给每个 token 挑 6 个。KV cache 是另一件事:前面 token 的 key 和 value 不会变,存起来就不用每步重算,玩具实测从 104,950 次降到 1,099 次。最后在 DeepSeek 上看「缓存命中」:同一段 4073 token 的系统提示词第二次命中 3840 个,输入费便宜 92%。'
pubDate: 2026-10-22
regime: none
tags: ['llm-basics', 'transformer', 'python', 'agent-zero']
series: 'agent-zero'
day: 117
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 116](/blog/agent-zero/day-116-attention/) 把注意力拆成三步:每个 token 用自己的 query 和前面每个 token 的 key 打分,softmax 变成权重,再按权重把它们的 value 加起来;因果遮罩把后面的位置改成负无穷,每个位置只能看自己和前面。最后算了一笔账:分数的次数是 n × (n + 1) ÷ 2,长度翻倍,次数变 4 倍。

那一课的图里,每一层有两格:注意力和前馈网络。今天先讲第二格里的 **MoE**,它解释了为什么 DeepSeek 一个两千多亿参数的模型能卖得这么便宜。然后回到 Day 116 练习 4 留下的那个浪费:第 20 轮对话把前 9,500 个 token 从头再算一遍。能不能不算?能,这就是 **KV cache**,DeepSeek 账单上那个「缓存命中价」也是从它来的。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清 MoE 是什么:每层的前馈网络拆成很多个「专家」,路由器给每个 token 挑少数几个去算;分清**总参数**和**激活参数**,知道显存看前者、速度和单次计算量看后者。
2. 跑通一个 8 个专家的玩具路由器,看懂「挑前 k 个、再 softmax」两步,数出每个 token 只调用了几个专家。
3. 说清 KV cache 为什么成立(因果遮罩让前面 token 的 key 和 value 不会变),跑通一个玩具,看到有缓存和没缓存结果一样、计算次数差 95 倍;会算一个模型每个 token 的 KV cache 占多少显存。
4. 看懂我在 DeepSeek 上的缓存实验:`prompt_cache_hit_tokens` 是什么,为什么把时间戳放在提示词开头会让缓存全部失效。

预计用时:2.5 小时左右。前置:[Day 116](/blog/agent-zero/day-116-attention/) 的 `attn_qk.py`(`match`)、`attn_softmax.py`(`softmax`)和因果遮罩;[Day 108](/blog/agent-zero/day-108-tokens-2/) 的价格;[Day 112](/blog/agent-zero/day-112-sampling-2/) 的 `random.Random(种子)`。

学法提示:先对照文章把每个脚本逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,把 `route` 和 `generate`(带 `use_cache` 的那个)默写出来;然后做动手练习,做不出来再展开参考答案,看完关掉,自己重写一遍。

## MoE:参数很多,每次只用一小部分

### 先看一组真实的数

Day 116 说过,每一层里注意力之后是一块**前馈网络**(FFN),每个 token 进去自己「消化」一下,一般认为模型记住的事实大多存在这里。前馈网络是每层里参数最多的部分。

普通的模型(行话叫**稠密模型**,dense)里,每个 token 都要过完整的前馈网络,模型有多少参数,每个 token 就要用多少。**MoE**(Mixture of Experts,混合专家)改的就是这一块:把一个大前馈网络拆成很多个小前馈网络,每个叫一个**专家**(expert),再加一个很小的**路由器**(router)。每个 token 进来,路由器给所有专家打分,只挑分数最高的几个去算,其余的这一步完全不动。

先看真实模型的数。我在 2026 年 10 月查了 Hugging Face 上几个模型的说明页和 `config.json`:

| 模型 | 总参数 | 激活参数 | 专家 | 每个 token 选几个 |
| --- | --- | --- | --- | --- |
| Qwen3-8B | 8.2B | 8.2B | 没有(稠密) | 不适用 |
| Qwen3-30B-A3B | 30.5B | 3.3B | 128 | 8 |
| DeepSeek-V4-Flash | 284B | 13B | 256 个 + 1 个共享 | 6 |
| DeepSeek-V4-Pro | 1.6T | 49B | 384 个 + 1 个共享 | 6 |

B 是 billion,十亿;T 是 trillion,万亿。**激活参数**是「处理一个 token 时真正参与计算的参数」。Qwen3-30B-A3B 的名字就是这么来的:总共 30B,激活(Active)3B。

DeepSeek-V4-Flash 有一点要说明:`deepseek-flash` 这个 API 名字,2026 年 10 月的价格页写的背后版本是 DeepSeek-V4.1-Flash-1017,而上面 284B/13B 是 Hugging Face 上开源的 V4-Flash 的数。V4.1 的规模官方没单独写,我按同一档理解,但没法确认。

「共享专家」是 DeepSeek 的做法:除了路由器挑的 6 个,还有 1 个专家每个 token 都要过,负责大家都需要的通用知识。

### 动手:8 个专家的路由器

我们用 Day 116 的工具造一个玩具。8 个专家,每个用 4 个数描述它擅长什么:[计费, 票据, 技术, 闲聊];每个 token 进到这一层时,也用这 4 格表示它现在的内容。路由器给专家打分用的就是 Day 116 的 `match`:对应位置相乘再相加。新建 `part02/moe_router.py`:

```python
# agent-zero-lab/part02/moe_router.py
from attn_qk import match
from attn_softmax import softmax

# 8 个专家各自擅长什么:[计费, 票据, 技术, 闲聊]
EXPERTS = {
    "专家1·账单": [1.0, 0.3, 0.0, 0.0],
    "专家2·发票": [0.3, 1.0, 0.0, 0.0],
    "专家3·退款": [0.8, 0.2, 0.0, 0.1],
    "专家4·登录": [0.0, 0.0, 1.0, 0.0],
    "专家5·接口": [0.0, 0.0, 0.9, 0.0],
    "专家6·寒暄": [0.0, 0.0, 0.0, 1.0],
    "专家7·道歉": [0.1, 0.0, 0.0, 0.8],
    "专家8·杂项": [0.2, 0.2, 0.2, 0.2],
}
# 每个 token 进到这一层时的内容,也是这四格
TOKENS = {
    "发票": [0.4, 1.0, 0.0, 0.0],
    "扣款": [1.0, 0.1, 0.0, 0.0],
    "密码": [0.0, 0.0, 1.0, 0.0],
    "您好": [0.0, 0.0, 0.0, 1.0],
}
TOP_K = 2


def route(x: list[float], k: int) -> dict[str, float]:
    scores = {name: match(x, key) for name, key in EXPERTS.items()}
    top = sorted(scores, key=lambda n: scores[n], reverse=True)[:k]
    return softmax({name: scores[name] for name in top})


if __name__ == "__main__":
    for tok, x in TOKENS.items():
        chosen = route(x, TOP_K)
        print(tok, "->", {name: round(w, 3) for name, w in chosen.items()})
    print(f"每个 token 只算 {TOP_K}/{len(EXPERTS)} 个专家")
```

<div class="line-notes">

- `from attn_qk import match` Day 116 建的 `part02/attn_qk.py`,`match(q, k)` 是对应位置相乘再相加。
- `from attn_softmax import softmax` Day 116 建的 `part02/attn_softmax.py`,把「名字 → 分数」变成「名字 → 权重」。
- `EXPERTS = {` 8 个专家。真模型里专家擅长什么没人规定,是训练时自己分化出来的,也不一定能用人话说清楚;我起名字只是为了好读。
- `"专家8·杂项": [0.2, 0.2, 0.2, 0.2],` 什么都会一点、什么都不精的专家。
- `"发票": [0.4, 1.0, 0.0, 0.0],` 「发票」这个 token:票据味很重,带一点计费。
- `TOP_K = 2` 每个 token 选 2 个专家。DeepSeek-V4-Flash 是 6 个(从 256 个里选),Qwen3-30B-A3B 是 8 个(从 128 个里选)。
- `def route(x: list[float], k: int) -> dict[str, float]:` 路由器:输入 token 的内容,输出「被选中的专家 → 权重」。
- `scores = {name: match(x, key) for name, key in EXPERTS.items()}` 给 8 个专家都打分。「发票」对「专家2·发票」:0.4 × 0.3 + 1.0 × 1.0 = 1.12;对「专家1·账单」:0.4 × 1.0 + 1.0 × 0.3 = 0.7。
- `top = sorted(scores, key=lambda n: scores[n], reverse=True)[:k]` 按分数从高到低排专家名字,切片 `[:k]` 取前 k 个([Day 15](/blog/agent-zero/day-015-strings-1/) 讲过切片)。这一步叫 **top-k**。
- `return softmax({name: scores[name] for name in top})` 只对选中的 k 个做 softmax,权重加起来为 1。没选中的专家权重是 0,这一步根本不算。

</div>

```bash
uv run part02/moe_router.py
```

实跑输出:

```text
发票 -> {'专家2·发票': 0.603, '专家1·账单': 0.397}
扣款 -> {'专家1·账单': 0.552, '专家3·退款': 0.448}
密码 -> {'专家4·登录': 0.525, '专家5·接口': 0.475}
您好 -> {'专家6·寒暄': 0.55, '专家7·道歉': 0.45}
每个 token 只算 2/8 个专家
```

「发票」走发票和账单专家,「密码」走登录和接口专家,「您好」走寒暄和道歉专家。每个 token 只用了 8 个专家里的 2 个。

### 专家真的去算,并且数一数算了几次

路由器只是选人,选完还要让专家真的干活,再按权重把它们的结果加起来。这一步和 Day 116 的「按权重把 value 加起来」是同一个写法。我们让每个专家的「计算」简单到极点:把输入的 4 格各乘上自己擅长的那 4 个数(擅长的格子保留,不擅长的压成 0),并且每调用一次就记一笔。新建 `part02/moe_layer.py`:

```python
# agent-zero-lab/part02/moe_layer.py
from moe_router import EXPERTS, TOKENS, route

calls = 0


def run_expert(name: str, x: list[float]) -> list[float]:
    global calls
    calls += 1
    return [a * b for a, b in zip(x, EXPERTS[name])]


def moe(x: list[float], k: int) -> list[float]:
    out = [0.0] * len(x)
    for name, w in route(x, k).items():
        y = run_expert(name, x)
        out = [o + w * v for o, v in zip(out, y)]
    return out


for k in (2, len(EXPERTS)):
    calls = 0
    for tok, x in TOKENS.items():
        y = moe(x, k)
        if tok == "发票":
            print(f"k={k}: 发票 -> {[round(v, 3) for v in y]}")
    print(f"k={k}: 4 个 token 一共调用专家 {calls} 次")
```

<div class="line-notes">

- `from moe_router import EXPERTS, TOKENS, route` 刚写的路由器。它的演示代码在 main guard 下面,导入时不会打印。
- `calls = 0` 一个模块级的计数器,记专家一共被调用了几次。
- `global calls` 新语法。Python 里函数要**改**外面的变量,必须先用 `global` 声明一下,否则 `calls += 1` 会被当成新建一个局部变量,报 `UnboundLocalError`。JS 里函数可以直接改外层的 `let` 变量,不用声明。只读不改的话不需要 `global`。
- `return [a * b for a, b in zip(x, EXPERTS[name])]` 专家的「计算」:输入的每一格乘上专家对应的那一格。真专家是一个小前馈网络,有几千万个参数,我们用 4 次乘法代替。
- `def moe(x: list[float], k: int) -> list[float]:` 一个 MoE 层:路由、调用选中的专家、按权重合并。
- `for name, w in route(x, k).items():` 只遍历被选中的专家,没选中的连函数都不调用,这就是「其余专家这一步完全不动」。
- `out = [o + w * v for o, v in zip(out, y)]` 按权重累加专家的输出。「发票」:0.603 × 专家2 的结果 + 0.397 × 专家1 的结果。
- `for k in (2, len(EXPERTS)):` 先按 top-2 跑一遍,再把 k 设成 8(所有专家全算,等于一个稠密模型)对比。
- `calls = 0` 模块最外层直接赋值,不用 `global`。

</div>

```bash
uv run part02/moe_layer.py
```

实跑输出:

```text
k=2: 发票 -> [0.231, 0.722, 0.0, 0.0]
k=2: 4 个 token 一共调用专家 8 次
k=8: 发票 -> [0.153, 0.352, 0.0, 0.0]
k=8: 4 个 token 一共调用专家 32 次
```

top-2 时 4 个 token 一共调用了 8 次专家,全开是 32 次,**计算量是全开的四分之一**。这就是 MoE 省的地方。

k=8 那一行的输出和 k=2 不一样,而且「票据」那格从 0.722 降到了 0.352,被不相关的专家稀释了。这不是说「全开更准」,恰好相反:真模型是按 top-k 训练的,每个专家学的就是「被选中时该干什么」,全开反而会把不相关专家的输出也混进来。这里全开只是为了数计算次数做对照。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="MoE 层:路由器给发票这个 token 从 8 个专家里选 2 个,按权重合并输出;其余 6 个专家不参与计算">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="110" width="70" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="55" y="130" text-anchor="middle" fill="var(--ink)">发票</text>
<line x1="90" y1="125" x2="120" y2="125" stroke="var(--ink-soft)"/>
<rect x="120" y="105" width="80" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="160" y="130" text-anchor="middle" fill="var(--ink)">路由器</text>
<rect x="250" y="20" width="120" height="24" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="310" y="37" text-anchor="middle" fill="var(--ink)">专家1·账单</text>
<rect x="250" y="50" width="120" height="24" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="310" y="67" text-anchor="middle" fill="var(--ink)">专家2·发票</text>
<rect x="250" y="80" width="120" height="24" rx="4" fill="none" stroke="var(--rule)"/>
<text x="310" y="97" text-anchor="middle" fill="var(--ink-faint)">专家3·退款</text>
<rect x="250" y="110" width="120" height="24" rx="4" fill="none" stroke="var(--rule)"/>
<text x="310" y="127" text-anchor="middle" fill="var(--ink-faint)">专家4·登录</text>
<rect x="250" y="140" width="120" height="24" rx="4" fill="none" stroke="var(--rule)"/>
<text x="310" y="157" text-anchor="middle" fill="var(--ink-faint)">专家5·接口</text>
<rect x="250" y="170" width="120" height="24" rx="4" fill="none" stroke="var(--rule)"/>
<text x="310" y="187" text-anchor="middle" fill="var(--ink-faint)">专家6·寒暄</text>
<rect x="250" y="200" width="120" height="24" rx="4" fill="none" stroke="var(--rule)"/>
<text x="310" y="217" text-anchor="middle" fill="var(--ink-faint)">专家7·道歉</text>
<rect x="250" y="230" width="120" height="24" rx="4" fill="none" stroke="var(--rule)"/>
<text x="310" y="247" text-anchor="middle" fill="var(--ink-faint)">专家8·杂项</text>
<line x1="200" y1="120" x2="250" y2="32" stroke="var(--mem)" stroke-width="2"/>
<line x1="200" y1="125" x2="250" y2="62" stroke="var(--mem)" stroke-width="2"/>
<text x="205" y="62" fill="var(--mem)">0.397</text>
<text x="215" y="92" fill="var(--mem)">0.603</text>
<line x1="370" y1="32" x2="430" y2="90" stroke="var(--mem)"/>
<line x1="370" y1="62" x2="430" y2="95" stroke="var(--mem)"/>
<rect x="430" y="80" width="100" height="30" rx="4" fill="none" stroke="var(--rule)"/>
<text x="480" y="100" text-anchor="middle" fill="var(--ink)">加权合并</text>
<text x="400" y="150" fill="var(--ink-soft)">显存:8 个都要装着</text>
<text x="400" y="172" fill="var(--ink-soft)">计算:只算 2 个</text>
<text x="400" y="194" fill="var(--ink-faint)">下一个 token 可能</text>
<text x="400" y="212" fill="var(--ink-faint)">选中另外 2 个</text>
</g>
</svg>
<figcaption>`moe_router.py` 的实跑结果。灰色的 6 个专家这一步不参与计算,但下一个 token(比如「密码」)可能正好选中它们,所以它们必须一直待在显存里。</figcaption>
</figure>

### 总参数和激活参数,分别管什么

图右边那两行就是 MoE 最重要的一句话:**所有专家都要装在显存里,但每个 token 只算其中几个。** 路由器随时可能选中任何一个,所以一个都不能少。用真实的数算一下,新建 `part02/moe_params.py`:

```python
# agent-zero-lab/part02/moe_params.py
# (名字, 总参数 B, 激活参数 B, 权重文件 GB),2026 年 10 月从 Hugging Face 模型页查的
MODELS = [
    ("Qwen3-8B(稠密)", 8.2, 8.2, 16.4),
    ("Qwen3-30B-A3B", 30.5, 3.3, 61.1),
    ("DeepSeek-V4-Flash", 284, 13, 159.6),
    ("DeepSeek-V4-Pro", 1600, 49, 864.7),
]

for name, total, active, file_gb in MODELS:
    flops = 2 * active * 1e9
    print(f"{name}: 总 {total}B, 激活 {active}B, 占 {active / total:.1%}, "
          f"每个 token 约 {flops:.1e} 次运算, 权重文件 {file_gb} GB")

print("Qwen3-30B-A3B 按 BF16 每个参数 2 字节估:", 30.5 * 2, "GB")
```

<div class="line-notes">

- `MODELS = [` 每个模型一个元组。权重文件大小是我用 Hugging Face 的接口把模型仓库里所有 `.safetensors` 文件(存参数的文件)的大小加起来得到的。
- `("DeepSeek-V4-Flash", 284, 13, 159.6),` 284B 参数,文件只有 159.6 GB,因为它的专家参数用 FP4(每个参数半个字节)存,其余大多用 FP8(1 个字节),说明页里写了。
- `flops = 2 * active * 1e9` 一个常用的粗估:处理一个 token,每个激活参数大约做 2 次运算(一次乘、一次加)。`1e9` 是 10 的 9 次方,把「B」换成个数。这个估法没算注意力那部分,只用来比大小。
- `print(f"{name}: 总 {total}B, 激活 {active}B, 占 {active / total:.1%}, "` `:.1%` 把小数按百分比打印并保留一位小数,0.108 显示成 10.8%。字符串末尾没逗号,下一行的 f-string 会自动拼上(Day 115 用过这个写法)。
- `f"每个 token 约 {flops:.1e} 次运算, 权重文件 {file_gb} GB")` `:.1e` 是科学计数法,1.6e+10 就是 1.6 × 10¹⁰。
- `print("Qwen3-30B-A3B 按 BF16 每个参数 2 字节估:", 30.5 * 2, "GB")` 验算一下:BF16 是一种每个数占 2 个字节的格式,305 亿参数 × 2 字节 = 61 GB,和实际文件 61.1 GB 对得上。

</div>

```bash
uv run part02/moe_params.py
```

实跑输出:

```text
Qwen3-8B(稠密): 总 8.2B, 激活 8.2B, 占 100.0%, 每个 token 约 1.6e+10 次运算, 权重文件 16.4 GB
Qwen3-30B-A3B: 总 30.5B, 激活 3.3B, 占 10.8%, 每个 token 约 6.6e+09 次运算, 权重文件 61.1 GB
DeepSeek-V4-Flash: 总 284B, 激活 13B, 占 4.6%, 每个 token 约 2.6e+10 次运算, 权重文件 159.6 GB
DeepSeek-V4-Pro: 总 1600B, 激活 49B, 占 3.1%, 每个 token 约 9.8e+10 次运算, 权重文件 864.7 GB
Qwen3-30B-A3B 按 BF16 每个参数 2 字节估: 61.0 GB
```

对比前两行最能说明问题。Qwen3-30B-A3B 每个 token 的计算量(6.6e+09)还不到 Qwen3-8B(1.6e+10)的一半,可它的权重文件是 61.1 GB,快 4 倍大。也就是说:**算得比 8B 还快,占的内存却是 8B 的 4 倍**。这就是 MoE 的交易:用更多显存,换更快的速度和更低的单 token 成本,而效果通常更接近总参数那一档(专家多,能装下的知识多)。

对你的影响分两头:

**调 API 时,看激活参数。** DeepSeek-V4-Flash 每个 token 只用 13B 参数,激活比例 4.6%,所以它能跑得快、卖得便宜。Day 108 查的价格是输入每百万 token 2 元(高峰),这个价格背后就是 MoE。

**自己部署时,看总参数。** 想在自己机器上跑 V4-Flash,光权重就要 159.6 GB 的显存,这还没算下面要讲的 KV cache。很多人第一次算错就错在这:看到「激活 13B」,以为一张 24 GB 的卡就够了。V4-Pro 要 864.7 GB,只能上多卡服务器。哪些模型适合本地跑,[Day 119](/blog/agent-zero/day-119-local-models-intro/) 讲。

还有一个面试常问的点:DeepSeek-V4-Flash 选专家的比例是 6/256 = 2.3%,可激活参数占比是 4.6%,为什么不一样?因为每个 token 除了 6 个专家,还要过那个共享专家、每一层的注意力,以及把 token 变成向量的那张大表,这些部分是每次都用的。

## KV cache:算过的就别再算

### 先想清楚为什么能缓存

回到 Day 116 的注意力。生成第 1001 个 token 时,它的 query 要和前面 1000 个 token 的 key 打分,再按权重加它们的 value。生成第 1002 个时,又要和前面 1001 个 token 的 key、value 算一遍。

问题来了:前面那 1000 个 token 的 key 和 value,第二次算出来和第一次一样吗?

**一样。** 原因正是 Day 116 的因果遮罩:每个 token 只能看它自己和它前面的 token。第 5 个 token 的 key 和 value 只取决于第 1 到第 5 个 token,后面不管再生成多少个,都影响不到它。所以只要前面的 token 不变,它们的 key 和 value 就永远不变。那就没必要每一步重算,**算一次存起来,下一步直接拿来用**。存起来的这些 key 和 value,就叫 **KV cache**(K 是 key,V 是 value)。

为什么不缓存 query?因为每一步只有最新的那个 token 需要用 query 去「找」别人,前面 token 的 query 在它们自己那一步用完就没用了。

### 动手:有缓存和没缓存,算多少次

做一个玩具:1000 个词的 prompt,再往后生成 100 个词。每个词的 key 和 value 用 4 个随机数代替(种子是词本身,同一个词每次算出来都一样),每算一次 key/value 就记一笔。新建 `part02/kv_toy.py`:

```python
# agent-zero-lab/part02/kv_toy.py
import math
import random

kv_calls = 0


def make_kv(tok: str) -> tuple[list[float], list[float]]:
    global kv_calls
    kv_calls += 1
    rng = random.Random(tok)
    key = [rng.uniform(-1, 1) for _ in range(4)]
    value = [rng.uniform(-1, 1) for _ in range(4)]
    return key, value


def make_query(tok: str) -> list[float]:
    rng = random.Random("q" + tok)
    return [rng.uniform(-1, 1) for _ in range(4)]


def attend(query: list[float], kvs: list[tuple[list[float], list[float]]]) -> list[float]:
    scores = [sum(q * k for q, k in zip(query, key)) for key, _ in kvs]
    exps = [math.exp(s) for s in scores]
    total = sum(exps)
    out = [0.0] * 4
    for e, (_, value) in zip(exps, kvs):
        out = [o + e / total * v for o, v in zip(out, value)]
    return out


def generate(prompt: list[str], steps: int, use_cache: bool) -> list[float]:
    toks = list(prompt)
    cache: list[tuple[list[float], list[float]]] = []
    out: list[float] = []
    for step in range(steps):
        if use_cache:
            for tok in toks[len(cache):]:
                cache.append(make_kv(tok))
            kvs = cache
        else:
            kvs = [make_kv(tok) for tok in toks]
        query = make_query(toks[-1])
        out = attend(query, kvs)
        toks.append(f"新词{step}")
    return out


prompt = [f"词{i}" for i in range(1000)]
for use_cache in (False, True):
    kv_calls = 0
    last = generate(prompt, 100, use_cache)
    print(f"{'有' if use_cache else '没有'} KV cache: 算了 {kv_calls:>7,} 次 K/V, 最后一步输出 {[round(x, 4) for x in last]}")
```

<div class="line-notes">

- `kv_calls = 0` 计数器,记 key/value 一共算了几次。
- `def make_kv(tok: str) -> tuple[list[float], list[float]]:` 算一个 token 的 key 和 value,返回一个元组(key, value)。真模型里这一步是拿 token 的向量去乘两张很大的参数表,是实打实的计算;我们用随机数代替。
- `global kv_calls` 要改外面的计数器,先声明(上面 `moe_layer.py` 讲过)。
- `rng = random.Random(tok)` 用词本身当种子。种子可以是字符串,同一个字符串每次得到同样的随机数序列(Day 112)。所以「词5」的 key 和 value 不管算几次都一样,模拟「前面 token 的 K、V 不会变」。
- `key = [rng.uniform(-1, 1) for _ in range(4)]` `uniform(-1, 1)` 生成 -1 到 1 之间的随机小数,取 4 个当 key。真模型里是几千个数。
- `def make_query(tok: str) -> list[float]:` 最新 token 的 query。种子前面加个 `"q"`,让它和 key 不一样。它不计数,因为我们只关心 K/V 算了几次。
- `def attend(query: list[float], kvs: list[tuple[list[float], list[float]]]) -> list[float]:` Day 116 的注意力三步,写成一个函数:打分、softmax、按权重加 value。
- `scores = [sum(q * k for q, k in zip(query, key)) for key, _ in kvs]` 第一步:query 和每个 key 打分,也就是 `match`。`for key, _ in kvs` 只取元组里的 key,value 先不要。
- `out = [o + e / total * v for o, v in zip(out, value)]` 第二、三步合在一起:`e / total` 是 softmax 后的权重,乘上 value 累加。
- `def generate(prompt: list[str], steps: int, use_cache: bool) -> list[float]:` 生成 `steps` 步,`use_cache` 决定用不用缓存,返回最后一步注意力的输出,用来比较两种做法结果一不一样。
- `toks = list(prompt)` 复制一份 prompt,后面往里追加新词时不会改到外面那个列表。JS 里是 `[...prompt]`。
- `cache: list[tuple[list[float], list[float]]] = []` 缓存:按位置存每个 token 的(key, value)。第 i 项就是第 i 个 token 的。
- `for tok in toks[len(cache):]:` 有缓存时,只给**还没进缓存的**那些 token 算 K/V。`toks[len(cache):]` 是从缓存长度那个位置往后切。第一步缓存是空的,要算全部 1000 个;之后每一步只有上一步新加的那 1 个。
- `kvs = [make_kv(tok) for tok in toks]` 没有缓存时,每一步把窗口里所有 token 的 K/V 从头算一遍。
- `toks.append(f"新词{step}")` 假装生成了一个新词接到末尾。真模型这里是按概率表采样(Day 110),我们只关心计算次数,就直接编一个名字。
- `prompt = [f"词{i}" for i in range(1000)]` 1000 个词的 prompt:「词0」「词1」……「词999」。
- `print(f"{'有' if use_cache else '没有'} KV cache:` 条件表达式选「有」或「没有」(Day 116 讲过)。

</div>

```bash
uv run part02/kv_toy.py
```

实跑输出(纯 Python 循环,大约要 2 到 3 秒):

```text
没有 KV cache: 算了 104,950 次 K/V, 最后一步输出 [-0.0246, -0.0548, -0.0124, -0.0119]
有 KV cache: 算了   1,099 次 K/V, 最后一步输出 [-0.0246, -0.0548, -0.0124, -0.0119]
```

两行的输出**一模一样**,缓存没有改变任何结果。计算次数从 104,950 次降到 1,099 次,少了 95 倍多。

这两个数可以手算出来。没缓存:第 1 步算 1000 个,第 2 步 1001 个,……,第 100 步 1099 个,加起来是 1000 × 100 + (0 + 1 + … + 99) = 100,000 + 4,950 = 104,950。有缓存:第 1 步把 1000 个全算了,之后 99 步每步只算 1 个新的,1000 + 99 = 1,099(最后生成的那个「新词99」后面没有下一步了,不用算)。

这里顺便认识两个词,后面讲流式输出和自部署时会再见:模型拿到 prompt 后先把这 1000 个 token 的 K/V 一次性算完、填进缓存,这一段叫**预填充**(prefill);之后一个一个往外生成,每步只算一个新 token,这一段叫**解码**(decode)。Day 116 实测「39 万 token 的 prompt 要 6 秒」,那 6 秒主要就花在预填充上。

<figure>
<svg viewBox="0 0 640 240" role="img" aria-label="KV cache:生成新 token 时,前面 token 的 K 和 V 从缓存里读,只给新 token 算一次 K 和 V">
<rect x="0" y="0" width="640" height="240" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-soft)">没有缓存:每一步把整个窗口的 K/V 从头算</text>
<rect x="20" y="38" width="420" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="230" y="56" text-anchor="middle" fill="var(--ink)">第 1 步:算 1000 个</text>
<rect x="20" y="70" width="424" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="232" y="88" text-anchor="middle" fill="var(--ink)">第 2 步:又算 1001 个</text>
<text x="460" y="88" fill="var(--ink-faint)">…… 共 104,950 次</text>
<text x="20" y="130" fill="var(--ink-soft)">有缓存:算过的存起来,每步只算新来的那一个</text>
<rect x="20" y="142" width="420" height="26" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="230" y="160" text-anchor="middle" fill="var(--ink)">KV cache:1000 个 token 的 K、V(只算一次)</text>
<rect x="444" y="142" width="26" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="480" y="160" fill="var(--ink)">← 新 token 只算这 1 个</text>
<text x="20" y="196" fill="var(--ink-faint)">能缓存的前提:因果遮罩让前面 token 的 K、V 只取决于它和它之前的 token</text>
<text x="20" y="216" fill="var(--ink-faint)">代价:缓存要放在显存里,窗口越长占得越多 · 共 1,099 次</text>
</g>
</svg>
<figcaption>`kv_toy.py` 的两种做法。蓝色那一长条是从缓存里读的,琥珀色是真正要算的。缓存省掉的是重复计算,换来的是显存占用。</figcaption>
</figure>

### 缓存不是免费的:它占显存

KV cache 省了计算,代价是要把这些 key 和 value 存在显存里,而且**每个请求一份**,窗口越长占得越多。占多少?公式是:

每个 token 的 KV cache 字节数 = 2(K 和 V 各一份)× 层数 × KV 头数 × 每个头的长度 × 每个数的字节数

「KV 头数」要多说一句。Day 116 讲过一层里有几十个注意力头,可现在很多模型让好几个头**共用**同一套 key 和 value,只有 query 各自独立,这样 KV cache 就小几倍。这个做法叫 GQA(分组查询注意力),Qwen3-8B 的说明页写的是「32 个 Q 头、8 个 KV 头」,也就是每 4 个头共用一套 K/V。

用 Qwen3-8B 的真实配置(`config.json` 里 `num_hidden_layers` 36、`num_key_value_heads` 8、`head_dim` 128,BF16 每个数 2 字节)算一下。新建 `part02/kv_size.py`:

```python
# agent-zero-lab/part02/kv_size.py
LAYERS = 36
KV_HEADS = 8
HEAD_DIM = 128
BYTES = 2  # BF16,每个数 2 字节

per_token = 2 * LAYERS * KV_HEADS * HEAD_DIM * BYTES
print(f"Qwen3-8B 每个 token 的 KV cache: {per_token:,} 字节 = {per_token / 1024:.0f} KB")

for ctx in (2_000, 32_000):
    gb = per_token * ctx / 1e9
    print(f"一个 {ctx:,} token 的请求: {gb:.2f} GB")

GPU_GB, WEIGHTS_GB = 24, 16.4
free = GPU_GB - WEIGHTS_GB
for ctx in (2_000, 32_000):
    n = int(free * 1e9 // (per_token * ctx))
    print(f"24 GB 的卡放完权重剩 {free:.1f} GB, 每个请求 {ctx:,} token 时最多同时 {n} 个")
```

<div class="line-notes">

- `LAYERS = 36` Qwen3-8B 有 36 层,每一层都有自己的一份 K/V。
- `KV_HEADS = 8` 8 套 K/V(32 个 query 头分 8 组共用)。
- `HEAD_DIM = 128` 每个头的 key、value 各是 128 个数。
- `per_token = 2 * LAYERS * KV_HEADS * HEAD_DIM * BYTES` 2 × 36 × 8 × 128 × 2 = 147,456 字节。
- `print(f"Qwen3-8B 每个 token 的 KV cache: {per_token:,} 字节 = {per_token / 1024:.0f} KB")` 除以 1024 换成 KB,是 144 KB。
- `gb = per_token * ctx / 1e9` 乘上 token 数,再除以 10 亿换成 GB。为了和权重文件的 16.4 GB 用同一个单位,这里 1 GB 按 10 亿字节算。
- `GPU_GB, WEIGHTS_GB = 24, 16.4` 一张 24 GB 显存的卡(常见的消费级高端卡就是这个大小),和上面查到的 Qwen3-8B 权重文件 16.4 GB。一行给两个变量赋值是元组解包。
- `n = int(free * 1e9 // (per_token * ctx))` 剩下的显存能放几个这么长的请求。`//` 整除。这里没算模型运行时的其他开销,实际还会更少。

</div>

```bash
uv run part02/kv_size.py
```

实跑输出:

```text
Qwen3-8B 每个 token 的 KV cache: 147,456 字节 = 144 KB
一个 2,000 token 的请求: 0.29 GB
一个 32,000 token 的请求: 4.72 GB
24 GB 的卡放完权重剩 7.6 GB, 每个请求 2,000 token 时最多同时 25 个
24 GB 的卡放完权重剩 7.6 GB, 每个请求 32,000 token 时最多同时 1 个
```

每个 token 144 KB,看着不多,乘上上下文长度就吓人了:一个 32K token 的请求光 KV cache 就要 4.72 GB,24 GB 的卡放完权重只能同时服务 1 个这样的请求;换成 2K token 的短请求,能同时服务 25 个。

这就解释了一个你以后一定会碰到的现象:**厂商对长上下文要么加价,要么限并发**,因为长请求占着显存,同一张卡能同时服务的人就少了。DeepSeek-V4 在这上面下了很大功夫,说明页里写 V4-Pro 在一百万 token 时 KV cache 只要 V3.2 的 10%。自己部署时怎么精确地算显存账,第十部分 [Day 567](/blog/agent-zero/day-567-self-host-1/) 讲。

## 在 DeepSeek 上看缓存命中

上面说的 KV cache,是**一个请求内部**,生成每个新 token 时复用前面的结果。厂商还把这件事往前推了一步:**跨请求**复用。如果你这次请求的开头和之前某次请求的开头一模一样(比如每次都带同一段很长的系统提示词),那这段开头的 KV cache 上次已经算过了,存下来,这次直接用,预填充那部分就省了。

DeepSeek 把这个叫「上下文硬盘缓存」,默认对所有用户开启,不用改代码。省下来的算力它折成钱还给你:2026 年 10 月的[价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)上,`deepseek-flash` 输入缓存命中高峰 0.04 元每百万 token,未命中 2 元,**便宜 50 倍**(空闲时段两者都减半)。响应的 `usage` 里有两个 DeepSeek 自己加的字段:`prompt_cache_hit_tokens`(输入里命中缓存的 token 数)和 `prompt_cache_miss_tokens`(没命中的)。

我做了一个实验:一段大约 4000 token 的「云簿帮助中心」当系统提示词,连着问三个不同的问题;最后再问一次,但在系统提示词最前面加上当前时间。这段要调 API,[Day 120](/blog/agent-zero/day-120-api-register/) 才注册拿 key,**这段你现在不用跑,看我的结果**:

```python
# agent-zero-lab/part02/prompt_cache.py
import os
import random
import time

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])

run_id = random.Random().randint(100_000, 999_999)
HELP = f"云簿帮助中心(版本 {run_id})\n" + "\n".join(
    f"第 {i} 条:套餐 {i % 3} 的用户在第 {i} 天可以申请发票重开,金额按天折算。" for i in range(150)
)


def ask(system: str, question: str) -> None:
    start = time.perf_counter()
    resp = client.chat.completions.create(
        model="deepseek-flash",
        messages=[{"role": "system", "content": system}, {"role": "user", "content": question}],
        max_tokens=20,
        extra_body={"thinking": {"type": "disabled"}},
    )
    elapsed = time.perf_counter() - start
    u = resp.usage
    assert u is not None
    hit = getattr(u, "prompt_cache_hit_tokens", 0)
    miss = getattr(u, "prompt_cache_miss_tokens", 0)
    print(f"输入 {u.prompt_tokens:>5}  命中 {hit:>5}  未命中 {miss:>5}  {elapsed:.2f}s  {question}")


if __name__ == "__main__":
    ask(HELP, "第 7 条说了什么?")
    ask(HELP, "第 99 条说了什么?")
    ask(HELP, "第 120 条说了什么?")
    ask(f"当前时间 {time.time()}\n" + HELP, "第 7 条说了什么?")
```

<div class="line-notes">

- `run_id = random.Random().randint(100_000, 999_999)` 每次运行随机一个版本号放在帮助中心开头。这样每次运行的第一个请求都是「没见过的开头」,不会被我上一次运行留下的缓存干扰。
- `HELP = f"云簿帮助中心(版本 {run_id})\n" + "\n".join(` 150 条格式一样的规则拼成一大段,实测 4073 个 token(加上问题)。
- `def ask(system: str, question: str) -> None:` 发一次请求,打印 token 和缓存情况。`-> None` 表示不返回东西。
- `messages=[{"role": "system", "content": system}, {"role": "user", "content": question}],` 系统提示词在前,问题在后。缓存看的是**开头**,所以不变的东西要放前面。messages 的角色 [Day 129](/blog/agent-zero/day-129-messages/) 细讲。
- `max_tokens=20,` 回答很短就够,我们只看输入那边。
- `hit = getattr(u, "prompt_cache_hit_tokens", 0)` 这两个字段是 DeepSeek 加的,不在 openai SDK 的类型定义里,和 Day 115 的 `reasoning_content` 一样用 `getattr` 取,取不到给 0。
- `ask(f"当前时间 {time.time()}\n" + HELP, "第 7 条说了什么?")` 第四次:系统提示词内容一样,只是最前面多了一行时间。`time.time()` 是当前时间的秒数,每次都不一样,相当于 JS 的 `Date.now() / 1000`。

</div>

我的实跑输出(2026 年 10 月 22 日晚,空闲时段):

```text
输入  4073  命中     0  未命中  4073  1.35s  第 7 条说了什么?
输入  4073  命中  3840  未命中   233  0.65s  第 99 条说了什么?
输入  4073  命中  3840  未命中   233  0.61s  第 120 条说了什么?
输入  4084  命中     0  未命中  4084  1.07s  第 7 条说了什么?
```

第一次全部未命中,这段开头 DeepSeek 没见过。第二、三次问题不同,但开头那 3840 个 token 命中了缓存,只有 233 个没命中(问题本身,加上帮助中心结尾不够凑成一整块的零头)。3840 正好是 64 的 60 倍,我猜它是按固定大小的块存的,[DeepSeek 的缓存文档](https://api-docs.deepseek.com/zh-cn/guides/kv_cache)只说「以一定的 token 数量为间隔」切分,没写具体多少。

第四次最值得看:**系统提示词的内容一个字没改,只在最前面加了一行时间,缓存就全部失效了**。缓存只认「从第一个 token 开始,一模一样的前缀」。开头第一行变了,后面 4000 个 token 哪怕完全一样,也算不同的前缀。这是 Day 116 因果遮罩的直接后果:后面每个 token 的 K/V 都取决于它前面的所有 token,第一行变了,后面所有 token 的 K/V 都跟着变,存下来的旧结果自然不能用。

耗时上,命中的两次是 0.65 秒和 0.61 秒,未命中的是 1.35 秒和 1.07 秒,快了一些。不过 4000 token 的 prompt 本身算得就快,耗时里网络占大头,这个差距我在练习里重跑时并不稳定。省钱是确定的,省时间要看 prompt 有多长。

算一下这次的钱:命中 3840 × 2 = 7680 个 token,按空闲价 0.02 元每百万,约 0.00015 元;未命中 4073 + 233 + 233 + 4084 = 8623 个,按 1 元每百万,约 0.0086 元。如果全不命中,四次是 16,303 个 token,约 0.0163 元。一个每天跑上万次、每次都带同样系统提示词的客服 Agent,差别会非常大,练习 2 算一算。

DeepSeek 的文档还写了两条要记住的规矩:缓存是「尽力而为」,不保证 100% 命中;不用的缓存「一般为几个小时到几天」后自动清掉。怎么系统地设计 prompt 让缓存命中率高,[Day 397](/blog/agent-zero/day-397-prompt-caching/) 专门讲。

## 这些和写 Agent 有什么关系

**选模型时,分清「便宜」从哪来。** MoE 模型 API 便宜,是因为激活参数少;但想自己部署时,显存要按总参数准备。看到「30B-A3B」这种名字,两个数都要看。

**提示词的顺序影响钱。** 不变的放前面(系统提示词、工具说明、帮助文档),会变的放后面(用户问题、当前时间、工单号)。一个时间戳放错位置,实测缓存命中从 3840 掉到 0。

**Agent 每一步都把历史重新发一遍,这正是缓存最能帮忙的地方。** 第 20 步的前 19 步内容和第 19 步一模一样,只要你**只在末尾追加、不改前面**,这一大段就能命中缓存。反过来,如果你每一步都改前面的内容(比如在开头更新一个「当前步数」),就等于每步付全价。

## 动手练习

**练习 1:选几个专家。** 写 `part02/moe_topk.py`,用 `moe_router.py` 的 `route`,看「发票」在 k=1、2、3 时分别选中哪些专家、权重是多少。k=1 时权重为什么是 1.0?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/moe_topk.py
from moe_router import TOKENS, route

for k in (1, 2, 3):
    chosen = route(TOKENS["发票"], k)
    print(f"k={k}:", {name: round(w, 3) for name, w in chosen.items()})
```

<div class="line-notes">

- `from moe_router import TOKENS, route` 正文的路由器和四个 token。
- `chosen = route(TOKENS["发票"], k)` 「发票」的内容 [0.4, 1.0, 0.0, 0.0],换不同的 k 去路由。

</div>

```bash
uv run part02/moe_topk.py
```

```text
k=1: {'专家2·发票': 1.0}
k=2: {'专家2·发票': 0.603, '专家1·账单': 0.397}
k=3: {'专家2·发票': 0.453, '专家1·账单': 0.298, '专家3·退款': 0.249}
```

k=1 时只对一个专家做 softmax,`exp(s) / exp(s)` 就是 1,所有权重都给它。k 越大,权重分得越散,计算量也按 k 涨。真模型选几个是设计时定死的(V4-Flash 是 6),是在效果和速度之间取的折中。

</details>

**练习 2:缓存能省多少钱。** 用正文实测的数(不命中时输入 4073 个 token;命中时 3840 个命中、233 个未命中),按 `deepseek-flash` 高峰价(未命中 2 元、命中 0.04 元每百万 token),算每次、每天 1 万次、每月 30 天的输入花费。写 `part02/cache_saving.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/cache_saving.py
MISS, HIT = 2.0, 0.04  # deepseek-flash 高峰价,元/百万 token
PER_DAY = 10_000

no_cache = 4073 * MISS / 1_000_000
with_cache = (3840 * HIT + 233 * MISS) / 1_000_000
print(f"每次: 不命中 {no_cache:.6f} 元, 命中 {with_cache:.6f} 元, 便宜 {1 - with_cache / no_cache:.0%}")
print(f"每天 {PER_DAY:,} 次: {no_cache * PER_DAY:.2f} 元 对 {with_cache * PER_DAY:.2f} 元")
print(f"每月(30 天): {no_cache * PER_DAY * 30:.0f} 元 对 {with_cache * PER_DAY * 30:.0f} 元")
```

<div class="line-notes">

- `MISS, HIT = 2.0, 0.04` 两个单价,2026 年 10 月价格页的高峰价。
- `no_cache = 4073 * MISS / 1_000_000` 全部按未命中算:4073 × 2 ÷ 1,000,000 = 0.008146 元。
- `with_cache = (3840 * HIT + 233 * MISS) / 1_000_000` 命中部分按 0.04 元,未命中的 233 个按 2 元:(153.6 + 466) ÷ 1,000,000 = 0.00062 元。
- `便宜 {1 - with_cache / no_cache:.0%}` `:.0%` 按百分比打印、不留小数。

</div>

```bash
uv run part02/cache_saving.py
```

```text
每次: 不命中 0.008146 元, 命中 0.000620 元, 便宜 92%
每天 10,000 次: 81.46 元 对 6.20 元
每月(30 天): 2444 元 对 186 元
```

每月 2444 元对 186 元,只是因为系统提示词放在了前面并且没变。命中后剩下的花费里,大头反而是那 233 个未命中的 token(466 对 153.6),所以真要省,还要让会变的部分尽量短。这里只算了输入,输出不受缓存影响。

</details>

**练习 3:参数多的模型,KV cache 反而小?** 用 `config.json` 里的数,比较 Qwen3-8B(36 层、8 个 KV 头、每头 128)和 Qwen3-30B-A3B(48 层、4 个 KV 头、每头 128)每个 token 的 KV cache;再算一个假想情况:Qwen3-8B 如果不共享 KV 头(32 个 KV 头)。写 `part02/kv_size_compare.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/kv_size_compare.py
# (名字, 层数, KV 头数, 每个头的维度, 总参数 B),来自各自的 config.json
MODELS = [
    ("Qwen3-8B", 36, 8, 128, 8.2),
    ("Qwen3-30B-A3B", 48, 4, 128, 30.5),
    ("假如 Qwen3-8B 不共享 KV 头", 36, 32, 128, 8.2),
]


def kv_bytes_per_token(layers: int, kv_heads: int, head_dim: int, nbytes: int = 2) -> int:
    return 2 * layers * kv_heads * head_dim * nbytes


for name, layers, kv_heads, head_dim, total in MODELS:
    per = kv_bytes_per_token(layers, kv_heads, head_dim)
    print(f"{name}(总 {total}B): 每 token {per // 1024} KB, 32,000 token 要 {per * 32_000 / 1e9:.2f} GB")
```

<div class="line-notes">

- `("Qwen3-30B-A3B", 48, 4, 128, 30.5),` 层数更多(48),但 KV 头只有 4 个。
- `("假如 Qwen3-8B 不共享 KV 头", 36, 32, 128, 8.2),` 32 个 query 头各配一套 K/V,这是最原始的多头注意力。
- `def kv_bytes_per_token(layers: int, kv_heads: int, head_dim: int, nbytes: int = 2) -> int:` 正文的公式写成函数,`nbytes` 默认 2(BF16)。
- `print(f"{name}(总 {total}B): 每 token {per // 1024} KB,` `//` 整除得到整数 KB。

</div>

```bash
uv run part02/kv_size_compare.py
```

```text
Qwen3-8B(总 8.2B): 每 token 144 KB, 32,000 token 要 4.72 GB
Qwen3-30B-A3B(总 30.5B): 每 token 96 KB, 32,000 token 要 3.15 GB
假如 Qwen3-8B 不共享 KV 头(总 8.2B): 每 token 576 KB, 32,000 token 要 18.87 GB
```

总参数多将近 4 倍的 Qwen3-30B-A3B,每个 token 的 KV cache 反而比 8B 小三分之一。KV cache 只看注意力的配置(层数、KV 头数、每头多长),和专家有多少、总参数多大没关系,MoE 加的专家全在前馈网络里。最后一行说明了 GQA 的价值:不共享的话,32K 的请求要 18.87 GB,一张 24 GB 的卡放完权重连一个都装不下。

</details>

**练习 4:把时间戳挪到后面。** 正文第四次请求把时间放在系统提示词最前面,缓存全失效。写 `part02/cache_fix.py`:先把时间放开头连问两次,再把时间放末尾连问两次,看命中情况。这段要调 API,你现在只写代码,看我的结果。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/cache_fix.py
import time

from prompt_cache import HELP, ask

for q in ("第 7 条说了什么?", "第 8 条说了什么?"):
    ask(f"当前时间 {time.time()}\n" + HELP, q)
for q in ("第 7 条说了什么?", "第 8 条说了什么?"):
    ask(HELP + f"\n当前时间 {time.time()}", q)
```

<div class="line-notes">

- `from prompt_cache import HELP, ask` 能导入,是因为 `prompt_cache.py` 的四次请求放在了 main guard 下面。导入时 `HELP` 会重新生成一个新的版本号,所以这次运行的第一个请求一定是没见过的开头。
- `ask(f"当前时间 {time.time()}\n" + HELP, q)` 时间在最前面,每次都不一样。
- `ask(HELP + f"\n当前时间 {time.time()}", q)` 时间挪到最后,前面 4000 个 token 每次都一样。

</div>

我的实跑输出:

```text
输入  4085  命中     0  未命中  4085  0.76s  第 7 条说了什么?
输入  4085  命中     0  未命中  4085  0.74s  第 8 条说了什么?
输入  4083  命中     0  未命中  4083  0.85s  第 7 条说了什么?
输入  4083  命中  3840  未命中   243  1.13s  第 8 条说了什么?
```

时间在开头,两次都是 0 命中。时间挪到末尾后,第一次是新开头所以不命中,第二次命中 3840 个。注意这次命中的那一次反而更慢(1.13 秒),就是正文说的:4000 token 规模下耗时被网络波动盖住了,省时间不稳定,省钱是稳定的。实际写 Agent 时,时间这种信息最好放进用户消息里,而不是系统提示词。

</details>

**验收标准:** `moe_router.py`、`moe_layer.py`、`moe_params.py`、`kv_toy.py`、`kv_size.py` 和练习 1–3 跑通,输出和文章一致;能说出总参数和激活参数分别决定什么,并用 Qwen3-30B-A3B 和 Qwen3-8B 的对比举例;能用因果遮罩解释 KV cache 为什么不改变结果,能手算 104,950 和 1,099 这两个数;能说出 `prompt_cache_hit_tokens` 是什么,以及提示词里不变的东西为什么要放在最前面。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 稠密模型(dense) | 每个 token 都用到全部参数的模型,如 Qwen3-8B |
| MoE(混合专家) | 每层的前馈网络拆成很多个专家,每个 token 只走路由器选中的几个 |
| 专家(expert) | MoE 里的一个小前馈网络。V4-Flash 每层 256 个 |
| 路由器(router) | 给每个 token 给所有专家打分、挑前 k 个的小网络 |
| top-k | 按分数取前 k 个。V4-Flash 每个 token 选 6 个专家 |
| 共享专家 | DeepSeek 的做法:每个 token 都要过的那个专家,放通用知识 |
| 总参数 | 模型全部参数,决定要多少显存 |
| 激活参数 | 处理一个 token 时实际参与计算的参数,决定速度和单 token 成本 |
| BF16 / FP8 / FP4 | 存一个参数用的格式,分别占 2 字节、1 字节、半个字节 |
| KV cache | 把前面 token 每层的 key 和 value 存起来,生成新 token 时直接复用,不重算 |
| 预填充(prefill) | 先把整个 prompt 的 K/V 一次性算完填进缓存的阶段,长 prompt 的首 token 延迟主要在这 |
| 解码(decode) | 之后一个一个生成 token 的阶段,每步只算一个新 token |
| GQA(分组查询注意力) | 几个注意力头共用一套 K/V,KV cache 小几倍。Qwen3-8B 是 32 个 Q 头、8 个 KV 头 |
| 上下文缓存 / 前缀缓存 | 厂商跨请求复用相同开头的 KV cache,命中的部分按便宜得多的价格收 |
| `prompt_cache_hit_tokens` | DeepSeek `usage` 里输入命中缓存的 token 数;`prompt_cache_miss_tokens` 是没命中的 |
| `global` | Python 里函数要修改模块级变量时的声明,不写会报 `UnboundLocalError` |

## 常见误区

**看到「激活 13B」就以为显存只要 13B 的量。** 所有专家都要装在显存里,路由器随时可能选到任何一个。V4-Flash 的权重文件是 159.6 GB,Qwen3-30B-A3B 是 61.1 GB,比 Qwen3-8B 的 16.4 GB 大将近 4 倍。

**以为 MoE 的专家是按「领域」人工分好的。** 玩具里我给专家起了「账单」「发票」这种名字,真模型里专家怎么分工是训练时自己分化的,往往说不出人话意思,也不是一个专家管一个领域。

**以为 KV cache 会让结果变得不一样。** 实测有缓存和没缓存的输出一模一样,缓存只是不重算不会变的东西。能这样做的前提是因果遮罩。

**以为参数多的模型 KV cache 就大。** Qwen3-30B-A3B 总参数是 8B 的近 4 倍,每 token 的 KV cache 却是 96 KB 对 144 KB。KV cache 只看注意力的层数、KV 头数和每头长度。

**在系统提示词开头放时间、请求 ID 这类每次都变的东西。** 实测内容一字不改、只在开头加一行时间,缓存命中从 3840 变成 0。不变的放前面,会变的放后面。

**以为缓存命中一定更快。** 4000 token 的实验里,一次命中反而比未命中慢(1.13 秒对 0.85 秒)。prompt 不长时耗时主要是网络,省钱是稳定的,省时间要看长度。

**函数里改模块级计数器忘了 `global`。** 写 `calls += 1` 不加 `global calls`,运行时报 `UnboundLocalError: cannot access local variable 'calls' where it is not associated with a value`。

## 学习资料

### 文档与文章

- [DeepSeek API:上下文硬盘缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache):中文,今天实验用到的两个 `usage` 字段、「尽力而为」、缓存保留时间都在这页。10 分钟。
- [DeepSeek API:模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):缓存命中和未命中两个价格,以及 `deepseek-flash` 背后是哪个版本。
- [Maarten Grootendorst《A Visual Guide to Mixture of Experts (MoE)》](https://newsletter.maartengrootendorst.com/p/a-visual-guide-to-mixture-of-experts):英文,图非常多,路由器、top-k、负载均衡、共享专家都画出来了。今天看到「The Routing Mechanism」那一节。
- [Hugging Face 博客《Mixture of Experts Explained》](https://huggingface.co/blog/moe):英文,MoE 的历史和训练难点(比如专家「忙闲不均」),比今天讲得深,读前半就够。
- [DeepSeek-V4-Flash 模型说明](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash):284B/13B、FP4 专家、KV cache 只要 V3.2 的 10% 这些数都在这页。
- [Qwen3-30B-A3B 模型说明](https://huggingface.co/Qwen/Qwen3-30B-A3B):看开头那几行「Number of Parameters: 30.5B in total and 3.3B activated」「Number of Experts: 128」,对照今天的表。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Gj9ZYdE4N&autoplay=0&high_quality=1" title="MOE终于迎来可视化解读！傻瓜都能看懂MoE核心原理！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>ZOMI酱 · MOE 终于迎来可视化解读!傻瓜都能看懂 MoE 核心原理 · 30 分钟,中文。用动画讲专家、路由器和 top-k,后半段讲负载均衡,今天看前 15 分钟。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1fcaN6fENi&autoplay=0&high_quality=1" title="到底什么是KV Cache，为啥不是QKV Cache，一个动画彻底搞懂！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>轩辕的编程宇宙 · 到底什么是 KV Cache,为啥不是 QKV Cache · 13 分钟,2026 年 9 月。正好回答今天那个问题「为什么不缓存 query」,动画和 `kv_toy.py` 是同一个过程。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1CjH962EVb&autoplay=0&high_quality=1" title="Prompt Cache到底是啥，它和KV Cache是什么关系？一个动画彻底搞懂！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>轩辕的编程宇宙 · Prompt Cache 到底是啥,它和 KV Cache 是什么关系 · 10 分钟,2026 年 10 月。接着上一个看,讲跨请求的前缀缓存,和今天在 DeepSeek 上做的实验对得上。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/sOPDGQjFcuM" title="A Visual Guide to Mixture of Experts (MoE) in LLMs" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Maarten Grootendorst · A Visual Guide to Mixture of Experts (MoE) in LLMs · 英文。上面那篇图解文章的视频版,作者是《Hands-On Large Language Models》的作者之一。</figcaption>
</figure>

### 书籍

- 《从零构建大模型》(Sebastian Raschka 著,覃立波、冯骁骋译,人民邮电出版社,2025 年;英文原版 Manning,2024 年):Day 116 推荐过。书里的模型是稠密的,没有 MoE 也没有 KV cache;作者在配套仓库里另外补了这两部分(见下面开源项目),可以对照着读。

### 开源项目与代码

- [rasbt/LLMs-from-scratch](https://github.com/rasbt/LLMs-from-scratch):上面那本书的配套代码。`ch04/03_kv-cache` 是作者补的 KV cache 实现,README 里有一张加缓存前后每秒生成多少 token 的对比表;`ch04/04_gqa` 讲 GQA,`ch04/07_moe` 讲 MoE。代码是 PyTorch,今天只读 README。
- [vllm-project/vllm](https://github.com/vllm-project/vllm):最常用的开源推理引擎,它出名就是因为把 KV cache 管理得好(PagedAttention,像操作系统分页一样管显存)。第十部分讲自部署时会用它,今天看一眼 README 的介绍。
- [DeepSeekMoE 论文](https://arxiv.org/abs/2401.06066):DeepSeek 2024 年讲自己 MoE 设计的论文,「细粒度专家」(专家切得更小、选得更多)和「共享专家」两个想法就是从这里来的,V4 还在用。只读摘要和图 2。

## 自测

1. DeepSeek-V4-Flash 总参数 284B、激活 13B。这两个数分别决定什么?

<details><summary>答案</summary>

总参数决定要多少显存:所有专家都要装着,路由器随时可能选中任何一个,权重文件 159.6 GB。激活参数决定处理一个 token 实际算多少,也就是速度和单 token 成本,所以 API 能卖得便宜。效果一般更接近总参数那一档。

</details>

2. MoE 的路由器是怎么给一个 token 选专家的?

<details><summary>答案</summary>

给所有专家打分(玩具里是 token 内容和专家描述对应位置相乘再相加),按分数取前 k 个(top-k),只对这 k 个做 softmax 得到权重;选中的专家各自计算,输出按权重加起来;没选中的专家这一步不计算。V4-Flash 是从 256 个里选 6 个,另外还有 1 个每次都走的共享专家。

</details>

3. KV cache 缓存的是什么?为什么缓存了结果不会变?为什么不缓存 query?

<details><summary>答案</summary>

缓存的是前面每个 token 在每一层的 key 和 value。因为有因果遮罩,一个 token 的 K/V 只取决于它和它前面的 token,后面生成再多也不影响它,所以算一次存起来,之后复用,结果完全一样(玩具实测两种做法输出一致,计算从 104,950 次降到 1,099 次)。query 只有最新那个 token 需要拿去和别人打分,前面 token 的 query 用完就没用了,不用存。

</details>

4. 你在系统提示词第一行写了「当前时间:……」,发现 DeepSeek 账单上缓存命中几乎是 0。为什么?怎么改?

<details><summary>答案</summary>

前缀缓存只认从第一个 token 开始一模一样的开头。时间每次都变,第一行就不一样,后面所有 token 的 K/V 都跟着变,存下来的旧缓存用不上。实测加了这一行后命中从 3840 变成 0。改法:把每次都变的内容(时间、用户问题、请求 ID)放到后面,最好放进用户消息;不变的系统提示词、工具说明、文档放在最前面并保持一字不改。实测时间挪到末尾后,第二次命中 3840 个。

</details>

5. 面试题:「你们要自己部署一个模型服务客服 Agent,候选是一个 8B 稠密模型和一个 30B-A3B 的 MoE 模型。从显存、速度和并发三个角度比较一下。」

<details><summary>答案</summary>

显存:MoE 要装下全部 30B 参数,BF16 约 61 GB,8B 稠密模型约 16 GB,MoE 要多得多的卡。速度:MoE 每个 token 只激活约 3.3B,计算量不到 8B 的一半,单个请求生成得更快;效果通常也更接近 30B 那一档。并发:同时能服务多少请求主要看放完权重后剩下的显存够放多少份 KV cache;KV cache 只看注意力配置,Qwen3-30B-A3B 每 token 96 KB,比 8B 的 144 KB 还小,但它权重本身占得多,同样的卡剩下的反而少,所以要按具体显卡把「权重 + 每请求 KV cache × 并发数 × 平均长度」算一遍再定。如果卡紧张、请求短、并发高,8B 可能更合适;如果要效果并且有足够显存,MoE 更划算。上线前用真实请求压测吞吐和延迟。

</details>

## 明天预告

Day 118 · 第 17 周复习。这一周从 Day 112 的 top_p 和 seed 走到今天的 MoE 和 KV cache:模型怎么采样、怎么训练、为什么会编、为什么要思考、内部怎么看前文、为什么能缓存。明天把它们串成一张图,默写本周的核心函数,再拼一个只用本周知识的小项目。
