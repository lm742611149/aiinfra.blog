---
title: 'Day 572 · 微调(三):LoRA 原理,Unsloth 在 Colab 上训练'
description: '全量微调一个 4B 模型要 60 GB 显存,LoRA 只训练旁边两个瘦矩阵。今天先用 numpy 手写一次 LoRA 的前向和训练,亲眼看 rank 怎么决定它能学多少;再从 config.json 数出 Qwen3-4B 挂 LoRA 后要训练多少参数,最后给出在 Colab 免费 T4 上用 Unsloth 训练分诊模型的完整笔记本。'
pubDate: 2026-10-22
regime: none
tags: ['fine-tuning', 'lora', 'qlora', 'unsloth', 'agent-zero']
series: 'agent-zero'
day: 572
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 571](/blog/agent-zero/day-571-finetune-tools/) 我们把一条工具调用样本按 Qwen3 的 chat template 渲染了出来,看清了模型实际学的是 `<|im_start|>assistant` 后面那段文字,工具结果被包在 user 轮里;又写了 `check_tool_sft.py` 把坏轨迹挑掉。再往前一天,[Day 570](/blog/agent-zero/day-570-finetune-1/) 造出了 `part10/out/triage_train.jsonl`(297 条)和 `triage_val.jsonl`(32 条)。数据齐了,今天真的要训练了。可一个 40 亿参数的模型,训练要的显存是推理的好几倍,免费的 Colab T4 只有 15 GB。今天先弄懂 LoRA 为什么能把这件事塞进一张小卡,再把训练笔记本写出来。

## 今天要解决的问题

学完今天你应该能做到:

1. 说清 **LoRA** 在干什么:冻结原来的权重,在旁边加两个瘦矩阵 A 和 B,只训练它们;能用 numpy 写出它的前向计算,解释为什么 B 要初始化成 0、A 不能也是 0。
2. 理解 **rank** 是 LoRA 的「容量」:用一个手写的训练循环,亲眼看到 rank 不够时 loss 降不下去、够了就降到 0;能从模型的 `config.json` 数出 Qwen3-4B 挂 LoRA 后要训练多少参数,算出全量微调、LoRA、QLoRA 各要多少显存。
3. 读懂一份在 Colab T4 上用 Unsloth 训练分诊 LoRA 的笔记本:每个单元做什么、`r`、`lora_alpha`、学习率、epoch 怎么定,训练前要检查哪两段打印。

预计用时 3 小时。前置:[Day 214](/blog/agent-zero/day-214-numpy-basics/)(numpy 够用版,矩阵乘法 `@`)、[Day 567](/blog/agent-zero/day-567-self-host-1/)(显存账)、[Day 568](/blog/agent-zero/day-568-self-host-2/)(Colab T4)、[Day 569](/blog/agent-zero/day-569-self-host-3/)(量化)、[Day 570](/blog/agent-zero/day-570-finetune-1/)(训练集、损失)、[Day 571](/blog/agent-zero/day-571-finetune-tools/)(chat template)。

今天本机部分不调 API、一分钱不花,只需要下载一个 727 字节的 `config.json`。最后的 Colab 训练需要 GPU,**我没有实跑**:写这篇的机器是 2019 款 Intel MacBook,没有 NVIDIA 显卡。笔记本代码照着 Unsloth 官方 Qwen3 (4B) Instruct 笔记本改的,每个单元都写清楚了来源和我改了哪里,你在 Colab 上跑出来的数字以你的为准。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`lora_forward.py` 的前向那一行和 `lora_train.py` 的 `train` 函数);做练习,做不出再展开参考答案,看完关掉重写一遍。

## 训练比推理多存了什么

[Day 567](/blog/agent-zero/day-567-self-host-1/) 算过推理的显存账:权重按 16 位存,每个参数 2 字节,4B 模型光权重就是 8 GB。训练要多存三样东西。

第一样是**梯度**(gradient)。[Day 570](/blog/agent-zero/day-570-finetune-1/) 讲过训练就是让损失变小,具体做法是:对每个参数算一个数,表示「这个参数往哪个方向挪一点,损失会变小,挪多少合适」。这个数就是梯度,每个参数一个,所以梯度和权重一样大。

第二样是**优化器状态**。光看当前这一步的梯度,方向会很抖。最常用的优化器 **Adam**(AdamW 是它加了权重衰减的版本)给每个参数记两个滑动平均:最近梯度的平均方向、最近梯度的平均大小,每个按 32 位存,一个参数就多 8 字节。

第三样是 **fp32 主权重**。混合精度训练时,权重的 16 位副本用来算,另有一份 32 位的用来累积每一步的小改动,否则太小的改动在 16 位里会被四舍五入掉。

加起来,全量微调每个参数大约 2 + 2 + 8 + 4 = 16 字节,再加上前向计算时要暂存的中间结果(激活值)。一会儿我们会算出来,Qwen3-4B 全量微调光这一部分就要接近 60 GB。前端打个比方:推理像在浏览器里跑一个打包好的生产版本,训练像同时开着 source map、热更新和 React DevTools,同一份代码要多占好几倍内存。

LoRA 的思路是:原来那 40 亿个参数一个都不动,不需要梯度也不需要优化器状态;只在旁边加一小撮新参数来训练,这一小撮才需要那 16 字节一份的全套账。

## 第一步:LoRA 的前向计算

模型里绝大多数参数都在一个个「线性层」里。线性层就是一个矩阵 W,形状是 d × k:输入一个 k 维向量 x,输出 W @ x,一个 d 维向量。`@` 是 numpy 的矩阵乘法([Day 214](/blog/agent-zero/day-214-numpy-basics/))。

全量微调是直接改 W。LoRA(Low-Rank Adaptation,低秩适配,微软 2021 年的论文)不改 W,在旁边加两个小矩阵:A 的形状是 r × k,B 的形状是 d × r。输出变成:

```text
W @ x  +  (alpha / r) * B @ (A @ x)
```

先看 `A @ x`:k 维的输入被 A 压成 r 维;再 `B @`:r 维又被展开回 d 维,加到原来的输出上。r 就是 **rank**(秩),通常取 8 到 64,比 d 和 k(几千)小得多,所以 A 和 B 都很「瘦」。`alpha` 是一个缩放系数,`alpha / r` 控制旁路的影响有多大,后面讲超参数时再说。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="LoRA 结构:冻结的原权重 W 旁边加两个瘦矩阵 A 和 B,两路相加">
<text x="30" y="120" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">x</text>
<text x="18" y="138" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">k 维</text>
<line x1="48" y1="115" x2="110" y2="70" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="48" y1="115" x2="110" y2="165" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="110" y="40" width="210" height="60" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="215" y="66" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">W(d × k)冻结</text>
<text x="215" y="85" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">原模型权重,不训练</text>
<rect x="110" y="140" width="90" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="155" y="163" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">A(r × k)</text>
<text x="155" y="182" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">随机小数</text>
<line x1="200" y1="168" x2="230" y2="168" stroke="var(--rule)" stroke-width="1.5"/>
<text x="215" y="160" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)" text-anchor="middle">r 维</text>
<rect x="230" y="140" width="90" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="275" y="163" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">B(d × r)</text>
<text x="275" y="182" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">初始全 0</text>
<line x1="320" y1="70" x2="390" y2="112" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="320" y1="168" x2="390" y2="120" stroke="var(--rule)" stroke-width="1.5"/>
<text x="352" y="168" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">× alpha/r</text>
<circle cx="402" cy="116" r="12" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="402" y="121" font-family="var(--font-mono)" font-size="13" fill="var(--ink)" text-anchor="middle">+</text>
<line x1="414" y1="116" x2="450" y2="116" stroke="var(--rule)" stroke-width="1.5"/>
<text x="458" y="100" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">输出(d 维)</text>
<text x="458" y="122" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">只有蓝色的 A、B 训练</text>
<text x="458" y="142" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">Qwen3-4B 上约占 0.8%</text>
<text x="458" y="162" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">B=0 → 一开始和原模型一样</text>
</svg>
<figcaption>LoRA 在冻结的 W 旁边走一条「先压到 r 维再展开」的旁路。蓝色是要训练的部分。B 初始为 0,训练第一步时旁路输出是 0,模型和原来完全一样。</figcaption>
</figure>

用一个 6 × 8 的小矩阵把这件事跑一遍。新建 `part10/lora_forward.py`:

```python
# agent-zero-lab/part10/lora_forward.py
"""LoRA 的前向计算:冻结的 W 旁边加 B @ A,看初始时输出和原模型是否一模一样。
用法:uv run python part10/lora_forward.py
"""
import numpy as np

rng = np.random.default_rng(0)
d, k, r, alpha = 6, 8, 2, 2          # 输出维度、输入维度、rank、缩放系数

W = rng.normal(size=(d, k))          # 原模型的权重,训练时冻结
A = rng.normal(size=(r, k)) * 0.01   # LoRA 的 A:随机小数
B = np.zeros((d, r))                 # LoRA 的 B:全 0
x = rng.normal(size=k)               # 一个输入向量

base = W @ x
lora = W @ x + (alpha / r) * (B @ (A @ x))
print("原模型输出:", base.round(3))
print("加 LoRA 后:", lora.round(3))
print("完全一样吗?", np.array_equal(base, lora))
print(f"W 有 {W.size} 个数,A+B 有 {A.size + B.size} 个数")

B[0, 0] = 1.0                        # 假装训练了一步,B 不再全是 0
print("B 动了以后:", (W @ x + (alpha / r) * (B @ (A @ x))).round(3))
```

<div class="line-notes">

- `rng = np.random.default_rng(0)` 带种子的随机数生成器,种子 0 固定,你跑出来的数和我一样。相当于 JS 里一个可以设种子的 `Math.random`(JS 原生做不到,要装库)。
- `d, k, r, alpha = 6, 8, 2, 2` 一次给四个变量赋值([Day 22](/blog/agent-zero/day-022-tuples-unpack/) 的解包)。真实模型里 d、k 是几千,这里用 6 和 8 方便看。
- `W = rng.normal(size=(d, k))` 6 行 8 列、服从正态分布的随机数,假装它是训练好的权重。
- `A = rng.normal(size=(r, k)) * 0.01` A 是 2 × 8,随机小数。乘 0.01 是让它一开始很小,不会扰乱太多。
- `B = np.zeros((d, r))` B 是 6 × 2,全是 0。这是 LoRA 论文规定的初始化方式。
- `x = rng.normal(size=k)` 一个 8 维的输入,假装是上一层传过来的向量。
- `base = W @ x` 原模型这一层的输出,6 个数。
- `lora = W @ x + (alpha / r) * (B @ (A @ x))` 从里往外读:`A @ x` 得到 2 个数,`B @` 把 2 个数展开成 6 个数,乘上 `alpha / r` = 2 / 2 = 1.0,再加到原输出上。因为 B 全是 0,`B @ (...)` 是 6 个 0。
- `print("完全一样吗?", np.array_equal(base, lora))` 逐个元素比较两个数组。输出 `True`:加了 LoRA 但还没训练时,模型行为和原来**一模一样**。这就是 B 初始化为 0 的目的,训练从原模型出发,不会一上来就被随机旁路搞乱。
- `print(f"W 有 {W.size} 个数,A+B 有 {A.size + B.size} 个数")` `.size` 是元素个数。W 有 6 × 8 = 48 个,A + B 有 2 × 8 + 6 × 2 = 28 个。这么小的矩阵看不出省多少,矩阵一大差距就出来了,第三步会用真实模型算。
- `B[0, 0] = 1.0` 手动改 B 的一个数,模拟训练了一步。
- `print("B 动了以后:", (W @ x + (alpha / r) * (B @ (A @ x))).round(3))` 第一个输出从 0.807 变成 0.787,其他不变。因为只改了 B 的第 0 行,只影响第 0 个输出。

</div>

```bash
cd agent-zero-lab
uv run python part10/lora_forward.py
```

```text
原模型输出: [ 0.807 -2.393 -0.956 -3.092  1.55   4.632]
加 LoRA 后: [ 0.807 -2.393 -0.956 -3.092  1.55   4.632]
完全一样吗? True
W 有 48 个数,A+B 有 28 个数
B 动了以后: [ 0.787 -2.393 -0.956 -3.092  1.55   4.632]
```

`B @ A` 合起来是一个 6 × 8 的矩阵,和 W 一样大,所以 LoRA 学到的其实就是「W 该改多少」,只不过这个改动被限制成了两个瘦矩阵的乘积。这种由一个 d × r 和一个 r × k 相乘得到的矩阵,秩最多是 r,所以叫**低秩**。秩可以粗略理解成「这个矩阵里有几个独立的方向」:秩是 2,说明这个 6 × 8 的改动只能沿 2 个方向变化。

LoRA 能成立,靠的是一个经验观察:在一个已经训练好的大模型上做微调,权重的改动本身就是低秩的,用很少几个方向就能描述大部分改动。LoRA 论文(Hu 等,2021)里对 GPT-3 做的实验显示,r 取 1 到 4 在不少任务上就已经和更大的 r 差不多(这是论文的结论,我没有复现)。下一步我们造一个「改动正好是秩 4」的小例子,看 r 不够和 r 够分别是什么样子。

## 第二步:手写一次 LoRA 训练

训练循环的骨架你在 [Day 570](/blog/agent-zero/day-570-finetune-1/) 已经听过:算预测、算损失、算梯度、沿梯度反方向挪一点,重复很多次。真实框架里梯度是自动算出来的(PyTorch 的 autograd),这里只有两个矩阵,我们直接写出梯度公式,不用管它怎么推出来的,知道「梯度 = 让损失变小该挪的方向」就够了。

任务是这样的:有一个冻结的 64 × 64 权重 W,和一个「标准答案」W + delta,delta 的秩是 4。给 512 个随机输入,目标输出是新权重下的结果。LoRA 只能训练 A 和 B,看它能不能学出这个 delta。新建 `part10/lora_train.py`:

```python
# agent-zero-lab/part10/lora_train.py
"""用 numpy 手写 LoRA 训练:目标是一个 rank 为 4 的权重变化,看不同 rank 能学到多好。
用法:uv run python part10/lora_train.py [学习率,默认 0.5]
"""
import sys

import numpy as np

d = k = 64
rng = np.random.default_rng(0)
W = rng.normal(size=(d, k)) / 8                                 # 冻结的原权重
delta = rng.normal(size=(d, 4)) @ rng.normal(size=(4, k)) / 8   # 「微调该学到的变化」,rank 4
X = rng.normal(size=(512, k))                                   # 512 个训练输入
Y = X @ (W + delta).T                                           # 标准答案:新权重下的输出
LR = float(sys.argv[1]) if len(sys.argv) > 1 else 0.5


def train(r: int, steps: int = 300, zero_a: bool = False, verbose: bool = False) -> float:
    g = np.random.default_rng(1)
    A = np.zeros((r, k)) if zero_a else g.normal(size=(r, k)) * 0.1
    B = np.zeros((d, r))
    loss = 0.0
    for step in range(steps):
        H = X @ A.T                          # (512, r) 输入先过 A,压到 r 维
        E = X @ W.T + H @ B.T - Y            # (512, d) 预测减答案,就是误差
        loss = float((E ** 2).mean())
        gB = 2 * E.T @ H / E.size            # 损失对 B 的梯度
        gA = 2 * B.T @ E.T @ X / E.size      # 损失对 A 的梯度
        B -= LR * gB
        A -= LR * gA
        if verbose and step in (0, 20, 50, 100):
            print(f"  第 {step:>3} 步 loss={loss:.4f}")
    return loss


print("r=4 的训练过程:")
train(4, verbose=True)
for r in (1, 2, 4, 8):
    print(f"r={r}  可训练参数 {r * (d + k):>5}  训练 300 步后 loss={train(r):.4f}")
print(f"全量微调要训练 {d * k} 个参数")
print("A 和 B 都初始化成 0:", round(train(4, zero_a=True), 4))
```

<div class="line-notes">

- `d = k = 64` 连等赋值,两个变量都是 64,和 JS 的 `d = k = 64` 一样。
- `W = rng.normal(size=(d, k)) / 8` 除以 8 是让数值小一点,训练更稳。
- `delta = rng.normal(size=(d, 4)) @ rng.normal(size=(4, k)) / 8` 一个 64 × 4 乘一个 4 × 64,得到 64 × 64 的矩阵,秩是 4。这就是「微调应该学到的改动」,我们故意让它是低秩的。
- `X = rng.normal(size=(512, k))` 512 行,每行是一个 64 维输入。一次把 512 个样本叠成一个矩阵一起算,和 Day 214 讲的「别写 for 循环,用矩阵一次算」是一回事。
- `Y = X @ (W + delta).T` `.T` 是转置(行列互换)。因为样本是按行放的,`X @ W.T` 等于对每一行 x 算 `W @ x`。Y 是 512 × 64 的标准答案。
- `LR = float(sys.argv[1]) if len(sys.argv) > 1 else 0.5` 学习率(learning rate):每一步沿梯度挪多远。命令行给了就用给的,没给就是 0.5。待会儿故意给一个大的看看会怎样。
- `def train(r: int, steps: int = 300, zero_a: bool = False, verbose: bool = False) -> float:` 用 rank r 训练 300 步,返回最后的 loss。`zero_a=True` 时把 A 也初始化成 0,用来演示一个坑。
- `A = np.zeros((r, k)) if zero_a else g.normal(size=(r, k)) * 0.1` 正常情况 A 是随机小数,B 是 0,和第一步一样。
- `H = X @ A.T` 每个输入先经过 A,从 64 维压成 r 维,H 是 512 × r。
- `E = X @ W.T + H @ B.T - Y` 当前的预测(原模型输出加 LoRA 旁路)减去标准答案,就是误差。一开始 B 是 0,旁路贡献为 0,误差全来自 delta。
- `loss = float((E ** 2).mean())` 误差平方的平均值,叫**均方误差**(MSE)。r=4 第 0 步算出来是 4.2323。这里是回归问题,所以损失用 MSE;语言模型的损失是交叉熵,形式不同,意思一样:越小越好。
- `gB = 2 * E.T @ H / E.size` MSE 对 B 的梯度。公式直接用就行:误差越大、H 越大,梯度越大。
- `gA = 2 * B.T @ E.T @ X / E.size` 对 A 的梯度。注意它前面乘着 `B.T`:**B 是 0 时,A 的梯度是 0**。所以第一步只有 B 在动,B 动起来以后 A 才开始动。
- `B -= LR * gB` 沿梯度的反方向挪一点。`-=` 和 JS 一样。这一行就是「训练」本身。
- `if verbose and step in (0, 20, 50, 100):` 只在这几步打印,看 loss 怎么往下走。
- `print(f"r={r}  可训练参数 {r * (d + k):>5}  训练 300 步后 loss={train(r):.4f}")` A 有 r × 64 个数,B 有 64 × r 个,合计 r × 128。`:>5` 右对齐占 5 格。
- `print("A 和 B 都初始化成 0:", round(train(4, zero_a=True), 4))` 演示坑:两个都是 0 会怎样。

</div>

```bash
uv run python part10/lora_train.py
```

```text
r=4 的训练过程:
  第   0 步 loss=4.2323
  第  20 步 loss=2.6817
  第  50 步 loss=0.3676
  第 100 步 loss=0.0005
r=1  可训练参数   128  训练 300 步后 loss=2.4448
r=2  可训练参数   256  训练 300 步后 loss=1.2731
r=4  可训练参数   512  训练 300 步后 loss=0.0000
r=8  可训练参数  1024  训练 300 步后 loss=0.0000
全量微调要训练 4096 个参数
A 和 B 都初始化成 0: 4.2323
```

这几行是今天最重要的输出,一行行看。

r=4 时,loss 从 4.23 一路降到 0.0005,第 300 步变成 0.0000(保留四位小数后是 0)。512 个参数学会了一个 4,096 个数的改动,因为这个改动本身只有 4 个方向。

r=1 和 r=2 停在 2.44 和 1.27,再训多少步也降不下去。不是没训好,是**容量不够**:秩 1 的旁路只能表达一个方向的改动,而答案有 4 个方向,它只能学到其中最主要的那一部分。r=8 和 r=4 一样都到了 0,多出来的容量没用上,白白多了一倍参数。这就是 rank 的含义:它决定 LoRA 最多能学多复杂的改动。真实任务里改动不会正好是秩 4,所以 rank 是一个要试的数,下面讲超参数时给起点。

最后一行是个坑:A 和 B 都初始化成 0,loss 一动不动,300 步后还是 4.2323。看上面 line-notes 里那两行梯度公式:A 的梯度前面乘着 B,B 的梯度乘着 `H = X @ A.T`,两个都是 0,两个梯度就都是 0,谁也动不了。所以 LoRA 规定一个随机、一个为 0:B 为 0 保证起点和原模型一样,A 随机保证训练能启动。你用 PEFT 或 Unsloth 时不需要自己初始化,但看到有人「为了干净」把两个都设成 0,就知道会出什么事。

### 故意踩一次坑:学习率太大

把学习率从 0.5 改成 5:

```bash
uv run python part10/lora_train.py 5
```

```text
.../agent-zero-lab/part10/lora_train.py:25: RuntimeWarning: overflow encountered in matmul
  E = X @ W.T + H @ B.T - Y            # (512, d) 预测减答案,就是误差
.../agent-zero-lab/part10/lora_train.py:28: RuntimeWarning: invalid value encountered in matmul
  gA = 2 * B.T @ E.T @ X / E.size      # 损失对 A 的梯度
.../agent-zero-lab/part10/lora_train.py:26: RuntimeWarning: overflow encountered in square
  loss = float((E ** 2).mean())
...
r=4 的训练过程:
  第   0 步 loss=4.2323
  第  20 步 loss=nan
  第  50 步 loss=nan
```

`overflow`(溢出)是数字大到浮点数装不下了,`nan` 是 Not a Number,和 JS 里的 `NaN` 是一个东西,一旦出现,后面所有计算都是 nan。原因是每一步挪得太远,越过了最低点,落到对面更高的地方,下一步梯度更大、挪得更远,来回震荡着越飞越高。

在真实训练里,这个现象长这样:训练日志里的 loss 先是正常的一两点几,突然变成几十、几百,然后变成 `nan`。看到 loss 变 nan,第一个怀疑对象就是学习率太大。我试了几个值:0.5、1、2 都能收敛,5 就炸了。能用的学习率是一个范围,不是一个精确的点,超过某个界限就突然不行了。

## 第三步:真实模型要训练多少参数

小例子看完了,算真实的。Qwen3-4B 每一层(一共 36 层)里有 7 个线性层:注意力部分的 `q_proj`、`k_proj`、`v_proj`、`o_proj`,和 MLP 部分(每层里那块最大的前馈网络)的 `gate_proj`、`up_proj`、`down_proj`。它们的形状全都能从模型仓库的 `config.json` 里推出来,和 Day 571 下 `tokenizer_config.json` 一样,从 ModelScope 下:

```bash
curl -sL https://modelscope.cn/models/Qwen/Qwen3-4B-Instruct-2507/resolve/master/config.json \
  -o part10/qwen3/config.json
cat part10/qwen3/config.json
```

文件 727 字节,我们要用的几个字段(2026 年 10 月下载):

```text
"head_dim": 128,
"hidden_size": 2560,
"intermediate_size": 9728,
"num_attention_heads": 32,
"num_hidden_layers": 36,
"num_key_value_heads": 8,
"tie_word_embeddings": true,
"vocab_size": 151936
```

`hidden_size` 是每个 token 在模型里的向量长度;`num_attention_heads` 乘 `head_dim` 是 q 的输出维度;`num_key_value_heads` 是 8 而不是 32,这是 GQA(多个 q 头共用一组 k、v,[Day 567](/blog/agent-zero/day-567-self-host-1/) 的 KV cache 账就跟这个数有关),所以 k、v 的输出只有 8 × 128 = 1024 维;`intermediate_size` 是 MLP 中间那层的宽度;`tie_word_embeddings` 为 true 表示输入的词表矩阵和输出的词表矩阵是同一份,只算一次。

新建 `part10/qwen3_params.py`:

```python
# agent-zero-lab/part10/qwen3_params.py
"""从 config.json 数出 Qwen3-4B 的参数量,再算 LoRA 挂到 7 个投影层上要训练多少参数。
用法:uv run python part10/qwen3_params.py part10/qwen3/config.json 16
"""
import json
import sys


def linear_shapes(cfg: dict) -> dict[str, tuple[int, int]]:
    h, hd = cfg["hidden_size"], cfg["head_dim"]
    q_out = cfg["num_attention_heads"] * hd
    kv_out = cfg["num_key_value_heads"] * hd
    inter = cfg["intermediate_size"]
    return {  # 名字: (输入维度 k, 输出维度 d)
        "q_proj": (h, q_out), "k_proj": (h, kv_out), "v_proj": (h, kv_out), "o_proj": (q_out, h),
        "gate_proj": (h, inter), "up_proj": (h, inter), "down_proj": (inter, h),
    }


def base_params(cfg: dict) -> int:
    per_layer = sum(k * d for k, d in linear_shapes(cfg).values())
    per_layer += 2 * cfg["hidden_size"] + 2 * cfg["head_dim"]       # 每层的 4 个 norm
    embed = cfg["vocab_size"] * cfg["hidden_size"]                   # 词表,输入输出共用一份
    return per_layer * cfg["num_hidden_layers"] + embed + cfg["hidden_size"]


def lora_params(cfg: dict, r: int) -> int:
    per_layer = sum(r * (k + d) for k, d in linear_shapes(cfg).values())
    return per_layer * cfg["num_hidden_layers"]


if __name__ == "__main__":
    cfg = json.load(open(sys.argv[1], encoding="utf-8"))
    r = int(sys.argv[2])
    for name, (k, d) in linear_shapes(cfg).items():
        print(f"{name:<10} {k:>5} → {d:<5} 原矩阵 {k * d:>11,}  LoRA {r * (k + d):>8,}  占 {r * (k + d) / (k * d):.2%}")
    base, lora = base_params(cfg), lora_params(cfg, r)
    print(f"基座参数 {base:,}")
    print(f"r={r} 的 LoRA 参数 {lora:,},占基座 {lora / base:.2%},合计 {base + lora:,}")
```

<div class="line-notes">

- `def linear_shapes(cfg: dict) -> dict[str, tuple[int, int]]:` 返回一个字典:层名 → (输入维度, 输出维度)。返回类型写成 `dict[str, tuple[int, int]]`,相当于 TS 的 `Record<string, [number, number]>`。
- `h, hd = cfg["hidden_size"], cfg["head_dim"]` 2560 和 128。
- `q_out = cfg["num_attention_heads"] * hd` 32 × 128 = 4096。
- `kv_out = cfg["num_key_value_heads"] * hd` 8 × 128 = 1024,GQA 让 k、v 小了 4 倍。
- `"q_proj": (h, q_out), "k_proj": (h, kv_out), "v_proj": (h, kv_out), "o_proj": (q_out, h),` 注意力的四个投影。o_proj 方向相反,把 4096 维的注意力结果投回 2560 维。
- `"gate_proj": (h, inter), "up_proj": (h, inter), "down_proj": (inter, h),` MLP 的三个投影:两个从 2560 升到 9728,一个从 9728 降回 2560。每个都比注意力的投影大一倍多。
- `per_layer = sum(k * d for k, d in linear_shapes(cfg).values())` 每层 7 个矩阵的元素个数加起来。`sum(... for ...)` 是生成器表达式,相当于 JS 的 `.map(...).reduce((a, b) => a + b)`。
- `per_layer += 2 * cfg["hidden_size"] + 2 * cfg["head_dim"]` 每层还有 4 个归一化层(norm),两个长 2560、两个长 128(Qwen3 给 q 和 k 单独加了 norm)。它们很小,但不算的话总数对不上。
- `embed = cfg["vocab_size"] * cfg["hidden_size"]` 词表矩阵:151,936 个 token,每个 2560 维,3.9 亿个参数。因为输入输出共用,只加一次。
- `return per_layer * cfg["num_hidden_layers"] + embed + cfg["hidden_size"]` 36 层 + 词表 + 最后一个 norm。
- `per_layer = sum(r * (k + d) for k, d in linear_shapes(cfg).values())` 每个线性层的 LoRA 是 A(r × k)加 B(d × r),合计 r × (k + d)。
- `print(f"{name:<10} {k:>5} → {d:<5} 原矩阵 {k * d:>11,}  LoRA {r * (k + d):>8,}  占 {r * (k + d) / (k * d):.2%}")` `:,` 加千分位逗号,`:.2%` 转成两位小数的百分比。
- `print(f"r={r} 的 LoRA 参数 {lora:,},占基座 {lora / base:.2%},合计 {base + lora:,}")` 最后一行和 Unsloth 训练开始时打印的那行对照着看。

</div>

```bash
uv run python part10/qwen3_params.py part10/qwen3/config.json 16
uv run python part10/qwen3_params.py part10/qwen3/config.json 32 | tail -2
```

```text
q_proj      2560 → 4096  原矩阵  10,485,760  LoRA  106,496  占 1.02%
k_proj      2560 → 1024  原矩阵   2,621,440  LoRA   57,344  占 2.19%
v_proj      2560 → 1024  原矩阵   2,621,440  LoRA   57,344  占 2.19%
o_proj      4096 → 2560  原矩阵  10,485,760  LoRA  106,496  占 1.02%
gate_proj   2560 → 9728  原矩阵  24,903,680  LoRA  196,608  占 0.79%
up_proj     2560 → 9728  原矩阵  24,903,680  LoRA  196,608  占 0.79%
down_proj   9728 → 2560  原矩阵  24,903,680  LoRA  196,608  占 0.79%
基座参数 4,022,468,096
r=16 的 LoRA 参数 33,030,144,占基座 0.82%,合计 4,055,498,240
基座参数 4,022,468,096
r=32 的 LoRA 参数 66,060,288,占基座 1.64%,合计 4,088,528,384
```

基座 40.2 亿参数,名字里的「4B」就是这么来的。r=16 时 LoRA 只有 3,303 万个参数,不到 1%;第一步那个 6 × 8 的小例子里 LoRA 比 W 还占一半多,矩阵变大以后比例就掉到了 1% 以下,因为 W 的大小是 k × d(相乘),LoRA 是 r × (k + d)(相加)。

我怎么知道这个数算对了?Unsloth 官方的 Qwen3 (4B) Instruct 笔记本用的是 r=32,它保存在 GitHub 上的运行输出里有这么一行(二手数据,是笔记本作者跑的,不是我):

```text
Trainable parameters = 66,060,288 of 4,088,528,384 (1.62% trained)
```

和我们 r=32 那行的两个数一个不差。1.62% 和我们的 1.64% 不一样,是因为它除的是合计,我们除的是基座。自己从 config 推一遍、再和框架打印的数对上,是理解模型结构最快的办法。

## 第四步:三种方式各要多少显存

有了参数量,把开头那笔账算出来。新建 `part10/ft_memory.py`,直接复用上一个文件里的两个函数:

```python
# agent-zero-lab/part10/ft_memory.py
"""粗算三种微调方式光「放下模型和优化器」要多少显存(不含激活值)。
用法:uv run python part10/ft_memory.py part10/qwen3/config.json 16
"""
import json
import sys

from qwen3_params import base_params, lora_params

GB = 1024 ** 3
cfg = json.load(open(sys.argv[1], encoding="utf-8"))
r = int(sys.argv[2])
n, n_lora = base_params(cfg), lora_params(cfg, r)
n_embed = cfg["vocab_size"] * cfg["hidden_size"]

full = n * (2 + 2 + 8 + 4)                       # 权重 + 梯度 + Adam 两份状态 + fp32 主权重
lora = n * 2 + n_lora * 16                       # 基座 bf16 只读,LoRA 部分按全量的账算
qlora = (n - n_embed) * 0.5 + n_embed * 2 + n_lora * 16   # 线性层 4 位,词表保留 16 位

for name, b in (("全量微调", full), ("LoRA(基座 16 位)", lora), ("QLoRA(基座 4 位)", qlora)):
    print(f"{name:<14} {b / GB:6.1f} GB   T4(约 15 GB)放得下吗:{'能' if b / GB < 15 else '不能'}")
```

<div class="line-notes">

- `from qwen3_params import base_params, lora_params` `qwen3_params.py` 把打印放在了 `if __name__ == "__main__":` 里,导入时只拿函数,不会打印那张表(Day 571 踩过的坑)。
- `GB = 1024 ** 3` `**` 是乘方,1 GB = 1024³ 字节。
- `n, n_lora = base_params(cfg), lora_params(cfg, r)` 4,022,468,096 和 33,030,144。
- `full = n * (2 + 2 + 8 + 4)` 开头那一节的账:16 位权重 2 字节、16 位梯度 2 字节、Adam 两个 32 位状态 8 字节、32 位主权重 4 字节。
- `lora = n * 2 + n_lora * 16` 基座只读,每参数 2 字节;LoRA 那 3,303 万个参数要训练,按全套 16 字节算。
- `qlora = (n - n_embed) * 0.5 + n_embed * 2 + n_lora * 16` **QLoRA** 把冻结的基座再量化成 4 位(半个字节),就是 [Day 569](/blog/agent-zero/day-569-self-host-3/) 亲手做过的那种量化。词表矩阵通常不量化,保留 16 位。量化用的缩放系数还会多占一点点,这里忽略。
- `print(f"{name:<14} {b / GB:6.1f} GB   T4(约 15 GB)放得下吗:{'能' if b / GB < 15 else '不能'}")` 15 GB 是 T4 的显存,Unsloth 在 Colab T4 上打印的可用显存是 14.741 GB。中文字符在终端里占两格,所以这一列对不太齐,不影响读数。

</div>

```bash
uv run python part10/ft_memory.py part10/qwen3/config.json 16
```

```text
全量微调             59.9 GB   T4(约 15 GB)放得下吗:不能
LoRA(基座 16 位)     8.0 GB   T4(约 15 GB)放得下吗:能
QLoRA(基座 4 位)     2.9 GB   T4(约 15 GB)放得下吗:能
```

全量微调 59.9 GB,一张 80 GB 的 A100 才放得下,还没算激活值。LoRA 把账砍到 8 GB,这 8 GB 几乎全是只读的基座,LoRA 自己连优化器状态才 0.5 GB。QLoRA 再把基座压到 4 位,只剩 2.9 GB。

LoRA 的 8 GB 看起来 T4 也放得下,为什么 Unsloth 在 T4 上默认还是用 4 位?因为这张表**没算激活值**。训练时前向的中间结果要留着给反向算梯度用,它和 batch 大小、序列长度成正比,序列一长能吃掉好几 GB。基座省下的 5 GB 就是留给激活值和更大 batch 的余地。另外 T4 这代卡不支持 bf16,只能用 fp16(Unsloth 会自动切),fp16 训练更容易溢出,这也是 4 位基座加 16 位 LoRA 这个组合在 T4 上更常见的原因之一。QLoRA 的代价是:训练稍慢一点,量化带来一点点精度损失。QLoRA 论文(Dettmers 等,2023)的结论是这点损失在他们测的任务上基本可以忽略,这是二手结论,你的任务要用 Day 574 的对比来验证。

## 第五步:在 Colab T4 上用 Unsloth 训练(没实跑)

**Unsloth** 是一个专门优化单卡微调的开源库,它重写了模型里几个最耗显存的计算,官方说法是比原版 Hugging Face 训练快一倍左右、显存省不少(这是 Unsloth 自己的宣传数字,我没有对照测过)。它维护了上百个 Colab 笔记本,点开就能在免费 T4 上跑。2026 年 10 月查到的版本:PyPI 上 unsloth 是 2026.10.7。

先说一句版本的事。Unsloth 官方笔记本第一格会**固定**一批依赖的版本,我 2026-10-22 下载的 Qwen3 (4B) Instruct 笔记本里写的是 `transformers==4.57.6`、`trl==0.22.2`,而 PyPI 上最新的 transformers 是 5.20.2、TRL 是 1.16.0。Unsloth 是靠「打补丁」改写这些库内部代码来提速的,换了版本补丁可能就对不上,所以**照着笔记本的版本装,别自作主张升级**。这和前端里某个插件只兼容某个大版本的 webpack 是一个道理。

下面的流程图是整个笔记本要做的事:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="Colab 上用 Unsloth 训练分诊 LoRA 的流程">
<rect x="10" y="20" width="140" height="48" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="80" y="41" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">上传 jsonl</text>
<text x="80" y="58" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">train 297 / val 32</text>
<rect x="170" y="20" width="140" height="48" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="240" y="41" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">加载 4 位基座</text>
<text x="240" y="58" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">load_in_4bit</text>
<rect x="330" y="20" width="140" height="48" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="400" y="41" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">挂 LoRA</text>
<text x="400" y="58" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">r=16,7 个投影</text>
<rect x="490" y="20" width="140" height="48" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="560" y="41" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">套 chat template</text>
<text x="560" y="58" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">检查 ①:打印文本</text>
<line x1="150" y1="44" x2="170" y2="44" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="310" y1="44" x2="330" y2="44" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="470" y1="44" x2="490" y2="44" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="560" y1="68" x2="560" y2="110" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="490" y="110" width="140" height="48" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="560" y="131" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">只对回答算损失</text>
<text x="560" y="148" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">检查 ②:打印标签</text>
<line x1="490" y1="134" x2="470" y2="134" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="330" y="110" width="140" height="48" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="400" y="131" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">训练 2 个 epoch</text>
<text x="400" y="148" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">看 train/val loss</text>
<line x1="330" y1="134" x2="310" y2="134" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="170" y="110" width="140" height="48" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="240" y="131" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">试答一张工单</text>
<text x="240" y="148" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">输出是不是 JSON</text>
<line x1="170" y1="134" x2="150" y2="134" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="10" y="110" width="140" height="48" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="80" y="131" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">保存适配器</text>
<text x="80" y="148" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">约 63 MB,下载</text>
<text x="20" y="200" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">两处检查都是「打印出来用眼睛看」:模板错了、遮罩错了,训练照样跑完、loss 照样下降,</text>
<text x="20" y="220" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">只有上线以后才发现模型答得莫名其妙。琥珀色两步是 Day 571 学的东西在训练里的落点。</text>
</svg>
<figcaption>笔记本的 8 个单元按这个顺序走。保存下来的只有 LoRA 的 A、B 矩阵,r=16 时 3,303 万个参数按 16 位存约 63 MB,基座不用存。</figcaption>
</figure>

准备工作:打开 [Unsloth 的 Qwen3 (4B) Instruct 笔记本](https://colab.research.google.com/github/unslothai/notebooks/blob/main/nb/Qwen3_(4B)-Instruct.ipynb),菜单「文件 → 在云端硬盘中保存一份副本」,在副本里改。「代码执行程序 → 更改运行时类型」选 T4 GPU。左边栏的文件夹图标里,把本机 `agent-zero-lab/part10/out/` 下的 `triage_train.jsonl` 和 `triage_val.jsonl` 拖进去,它们会出现在 `/content/` 下。免费档的 T4 不保证一定分得到,高峰期可能连不上,单次会话最长约 12 小时、闲置 90 分钟左右会断(Google 官方只说「动态限制」,具体数字来自第三方整理,以你账号里显示的为准)。

Colab 单元里以 `!` 开头的行是在执行终端命令,和你在本机终端敲 `pip install` 一样,`!` 告诉 Colab「这一行不是 Python」。

```python
# Colab 单元 1:安装(照抄 2026-10-22 下载的官方笔记本,版本号别改)
import os
if "COLAB_" not in "".join(os.environ.keys()):
    !pip install unsloth
else:
    !pip install sentencepiece protobuf "datasets==4.3.0" "huggingface_hub>=0.34.0" hf_transfer
    !pip install --no-deps unsloth_zoo bitsandbytes accelerate peft trl triton unsloth
    !unsloth install-kernels
    !pip install --no-deps --upgrade "torchao>=0.16.0"
!pip install transformers==4.57.6
!pip install --no-deps trl==0.22.2
```

<div class="line-notes">

- `if "COLAB_" not in "".join(os.environ.keys()):` 检查环境变量里有没有 `COLAB_` 开头的,用来判断是不是在 Colab 上。不在 Colab(比如你自己租的云 GPU)就走简单的一行安装。
- `!pip install --no-deps unsloth_zoo bitsandbytes accelerate peft trl triton unsloth` `--no-deps` 不自动装依赖,因为 Colab 已经预装了 PyTorch,自动装依赖可能把它换成不兼容的版本。bitsandbytes 管 4 位量化,peft 管 LoRA,trl 管训练循环。
- `!pip install transformers==4.57.6` 固定版本。这就是上面说的「照笔记本的版本装」。
- `!pip install --no-deps trl==0.22.2` TRL 的 0.22 和 1.x 参数名有变化,下面单元 5 的写法是按 0.22 来的。

</div>

```python
# Colab 单元 2:加载 4 位基座,挂 LoRA(改自官方笔记本:r 和 alpha 从 32 改成 16,max_seq_length 改成 1024)
from unsloth import FastLanguageModel

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="unsloth/Qwen3-4B-Instruct-2507",
    max_seq_length=1024,
    load_in_4bit=True,
)
model = FastLanguageModel.get_peft_model(
    model,
    r=16,
    lora_alpha=16,
    lora_dropout=0,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    use_gradient_checkpointing="unsloth",
    random_state=3407,
)
```

<div class="line-notes">

- `from unsloth import FastLanguageModel` 这一行要放在导入 transformers、trl 之前,Unsloth 要先打补丁。顺序反了它会打印警告,速度和显存优化可能不生效。
- `model_name="unsloth/Qwen3-4B-Instruct-2507",` 从 Hugging Face 下载。Colab 在海外,直连 Hugging Face 没问题,这一点和本机不一样。
- `max_seq_length=1024,` 一条样本最多多少 token。Day 570 练习 3 估过,我们一条分诊样本约 158 个 token,1024 绰绰有余。设得越大,激活值越占显存。工具调用样本要按 Day 571 说的把工具定义算进去,常常要 2048 以上。
- `load_in_4bit=True,` QLoRA:基座按 4 位加载,就是上一步表里的第三行。
- `model = FastLanguageModel.get_peft_model(` 给模型挂上 LoRA。PEFT(Parameter-Efficient Fine-Tuning,参数高效微调)是这一类方法的统称,LoRA 是其中最常用的一种。
- `r=16,` rank。第二步看到了 rank 是容量,分诊这种输出固定的小任务,16 是常用起点。
- `lora_alpha=16,` 缩放系数,旁路输出乘 `alpha / r` = 1。Unsloth 文档的建议是 alpha 等于 r 或 2 倍 r。
- `lora_dropout=0,` 训练时随机丢掉一部分旁路输出防过拟合,Unsloth 对 0 做了优化,先用 0。
- `target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],` 挂到第三步数过的那 7 个投影层。只挂注意力的四个会差很多,下面讲超参数时说原因。
- `use_gradient_checkpointing="unsloth",` 梯度检查点:前向时不留全部激活值,反向需要时重新算一遍,用时间换显存。
- `random_state=3407,` 随机种子,A 矩阵的随机初始化可复现。

</div>

```python
# Colab 单元 3:读数据,套 chat template,打印一条检查(检查 ①)
from datasets import load_dataset
from unsloth.chat_templates import get_chat_template

tokenizer = get_chat_template(tokenizer, chat_template="qwen3-instruct")
ds = load_dataset("json", data_files={"train": "/content/triage_train.jsonl",
                                      "val": "/content/triage_val.jsonl"})


def to_text(batch):
    return {"text": [tokenizer.apply_chat_template(m, tokenize=False, add_generation_prompt=False)
                     for m in batch["messages"]]}


ds = ds.map(to_text, batched=True, remove_columns=ds["train"].column_names)
print(ds)
print(ds["train"][0]["text"])
```

<div class="line-notes">

- `from datasets import load_dataset` Hugging Face 的 datasets 库,读 JSONL、CSV 都是一行。
- `tokenizer = get_chat_template(tokenizer, chat_template="qwen3-instruct")` 确保用的是 Qwen3 Instruct 的对话模板,也就是 Day 571 渲染过的那一份(`<|im_start|>` 那套)。
- `ds = load_dataset("json", data_files={"train": "/content/triage_train.jsonl",` 一次读两个文件,得到一个有 train 和 val 两部分的数据集。
- `def to_text(batch):` 每条样本的 messages 套模板变成一整段文字。`batched=True` 时一次传进来一批,`batch["messages"]` 是一个列表。
- `return {"text": [tokenizer.apply_chat_template(m, tokenize=False, add_generation_prompt=False)` `apply_chat_template` 就是 Day 571 我们用 Jinja2 手动做的那件事,`add_generation_prompt=False` 因为这是完整的训练样本。
- `ds = ds.map(to_text, batched=True, remove_columns=ds["train"].column_names)` 对每条跑一遍 `to_text`,并删掉原来的 `messages`、`source` 列,只留 `text`。相当于 JS 的 `arr.map(...)`。
- `print(ds["train"][0]["text"])` **检查 ①**:打印出来应该和 Day 571 `render_chat.py` 的输出一个格式,system、user、assistant 三段,每段 `<|im_start|>…<|im_end|>` 包着,assistant 里是那段 JSON。哪里不对就别往下跑。

</div>

```python
# Colab 单元 4:训练器(改自官方笔记本:加了验证集,max_steps 换成 num_train_epochs)
from trl import SFTConfig, SFTTrainer

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=ds["train"],
    eval_dataset=ds["val"],
    args=SFTConfig(
        dataset_text_field="text",
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        num_train_epochs=2,
        learning_rate=2e-4,
        warmup_steps=5,
        lr_scheduler_type="linear",
        weight_decay=0.01,
        logging_steps=5,
        eval_strategy="steps",
        eval_steps=10,
        optim="adamw_8bit",
        seed=3407,
        output_dir="outputs",
        report_to="none",
    ),
)
```

<div class="line-notes">

- `from trl import SFTConfig, SFTTrainer` TRL 是 Hugging Face 的训练库,SFTTrainer 就是 Day 570 讲的监督微调,训练循环(前向、损失、梯度、更新)全在里面,不用自己写第二步那样的 for 循环。
- `tokenizer=tokenizer,` 新版 TRL 这个参数改名叫 `processing_class`,Unsloth 打的补丁让旧写法继续能用,官方笔记本就这么写。
- `eval_dataset=ds["val"],` 官方笔记本这里是 None,我加上了 Day 570 切出来的 32 条验证集,训练中途会算验证集上的 loss。
- `per_device_train_batch_size=2,` 每次往卡里送 2 条。
- `gradient_accumulation_steps=4,` **梯度累积**:攒 4 次的梯度再更新一次参数,效果上等于一次喂 2 × 4 = 8 条,但显存只按 2 条占。显存不够时先把上一行调小、这一行调大。
- `num_train_epochs=2,` 整个训练集过 2 遍。297 条 ÷ 每步 8 条 ≈ 37 步一个 epoch,2 个 epoch 约 75 步。
- `learning_rate=2e-4,` 2 × 10⁻⁴ = 0.0002。比第二步的 0.5 小得多,因为真实模型的梯度量级和我们的玩具不一样,学习率没法跨任务照搬。2e-4 是 Unsloth 和大多数 LoRA 教程的起点。
- `warmup_steps=5,` 前 5 步学习率从 0 慢慢升到 2e-4,避免一开始梯度很乱时一步跨太大(第二步那个 nan)。
- `lr_scheduler_type="linear",` 预热之后学习率线性降到 0,越到后面挪得越小。
- `eval_strategy="steps",` 每隔一定步数算一次验证集 loss。
- `eval_steps=10,` 每 10 步算一次,75 步里会算 7 次左右,够画出验证曲线。
- `optim="adamw_8bit",` 8 位版的 AdamW,把优化器状态从 32 位压到 8 位,又省一截显存。
- `report_to="none",` 不往 Weights & Biases 之类的平台上报。

</div>

```python
# Colab 单元 5:只对 assistant 段算损失,打印遮罩检查(检查 ②)
from unsloth.chat_templates import train_on_responses_only

trainer = train_on_responses_only(
    trainer,
    instruction_part="<|im_start|>user\n",
    response_part="<|im_start|>assistant\n",
)
row = trainer.train_dataset[0]
print(tokenizer.decode(row["input_ids"]))
print("----- 参与算损失的部分 -----")
print(tokenizer.decode([t for t, lab in zip(row["input_ids"], row["labels"]) if lab != -100]))
```

<div class="line-notes">

- `trainer = train_on_responses_only(` Day 570 说过,只在 assistant 段上算损失。这个函数把 system 和 user 段的标签改成 -100,PyTorch 计算损失时会跳过标签为 -100 的 token。
- `instruction_part="<|im_start|>user\n",` 告诉它「用户段」从哪个标记开始。Day 571 渲染出来的文本里,user 段就是以这串开头,工具结果也在 user 段里,所以也会被遮掉。
- `response_part="<|im_start|>assistant\n",` 「回答段」从哪开始。官方笔记本没写这两个参数,让它自己猜;我写死,因为猜错了不会报错,只会悄悄遮错。
- `print(tokenizer.decode(row["input_ids"]))` 把第一条样本的 token 还原成文字,应该是完整的三段。
- `print(tokenizer.decode([t for t, lab in zip(row["input_ids"], row["labels"]) if lab != -100]))` **检查 ②**:只把标签不是 -100 的 token 还原出来。`zip` 把两个列表一对一配起来,相当于 JS 里按下标同时遍历两个数组。正确的结果应该只剩那段 JSON 和结尾的 `<|im_end|>`。如果打出来是空的,或者 system 说明也在里面,说明两个标记写错了。

</div>

```python
# Colab 单元 6:训练,记录时间和显存
import torch

torch.cuda.reset_peak_memory_stats()
stats = trainer.train()
print(f"训练用时 {stats.metrics['train_runtime']:.0f} 秒")
print(f"峰值显存 {torch.cuda.max_memory_reserved() / 1024 ** 3:.2f} GB")
```

<div class="line-notes">

- `torch.cuda.reset_peak_memory_stats()` 把显存峰值计数清零,下面读到的就是训练过程本身的峰值。
- `stats = trainer.train()` 开始训练。训练过程中 Colab 会刷出一张表,每 5 步一行 training loss,每 10 步一行 validation loss。
- `print(f"峰值显存 {torch.cuda.max_memory_reserved() / 1024 ** 3:.2f} GB")` 可以和第四步表里 QLoRA 那行的 2.9 GB 对照,多出来的就是激活值和框架开销。

</div>

```python
# Colab 单元 7:用一张训练集里没有的工单试答
FastLanguageModel.for_inference(model)
SYSTEM = ds["train"][0]["text"].split("<|im_start|>system\n")[1].split("<|im_end|>")[0]
messages = [{"role": "system", "content": SYSTEM},
            {"role": "user", "content": "主题:首页白了\n正文:登录后首页一片空白,F12 看到接口 500。"}]
text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
out = model.generate(**tokenizer(text, return_tensors="pt").to("cuda"), max_new_tokens=80, do_sample=False)
print(tokenizer.decode(out[0], skip_special_tokens=False).split("<|im_start|>assistant\n")[-1])
```

<div class="line-notes">

- `FastLanguageModel.for_inference(model)` 切到推理模式,Unsloth 会关掉训练才需要的东西,生成更快。
- `SYSTEM = ds["train"][0]["text"].split("<|im_start|>system\n")[1].split("<|im_end|>")[0]` 从训练文本里把 system 说明原样切出来。Day 570 强调过训练和推理的说明必须一字不差,这样取最保险。
- `{"role": "user", "content": "主题:首页白了\n正文:登录后首页一片空白,F12 看到接口 500。"}]` 格式和 `to_messages` 拼的一样:「主题:…\n正文:…」。
- `text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)` 推理时 `add_generation_prompt=True`,末尾加上 `<|im_start|>assistant`,等模型接着写(Day 571 第一步的第二段输出)。
- `out = model.generate(**tokenizer(text, return_tensors="pt").to("cuda"), max_new_tokens=80, do_sample=False)` `do_sample=False` 每步取概率最大的 token,相当于温度 0。`**` 把字典展开成关键字参数,相当于 JS 的展开运算符。
- `print(tokenizer.decode(out[0], skip_special_tokens=False).split("<|im_start|>assistant\n")[-1])` 只看 assistant 后面的部分。期望看到一行 JSON 加 `<|im_end|>`,没有多余的文字。

</div>

```python
# Colab 单元 8:只保存 LoRA 适配器,打包下载
model.save_pretrained("triage_lora")
tokenizer.save_pretrained("triage_lora")
!zip -r triage_lora.zip triage_lora
from google.colab import files
files.download("triage_lora.zip")
```

<div class="line-notes">

- `model.save_pretrained("triage_lora")` 对挂了 LoRA 的模型调用,只保存 A、B 矩阵和一个 `adapter_config.json`(记着 r、alpha、挂在哪些层、基座是谁),不保存基座。r=16 时 3,303 万个参数按 16 位存,约 33,030,144 × 2 ÷ 1024² ≈ 63 MB。
- `tokenizer.save_pretrained("triage_lora")` 把分词器和 chat template 一起存进去,部署时用同一份模板。
- `files.download("triage_lora.zip")` 触发浏览器下载。Colab 会话断了文件就没了,训完马上下。

</div>

这 8 个单元我都用 Python 的 `ast` 做过语法检查(去掉 `!` 开头的行),参数名对照的是官方笔记本和 Unsloth 文档。训练用时和峰值显存我给不出实测数字。能给的参考是官方笔记本里保存的运行记录(二手):它用 FineTome 数据集、每步 8 条、跑 60 步,在 T4 上用了 9 分 32 秒,前几步 training loss 在 1.2 到 1.7 之间跳。FineTome 的样本比我们的分诊样本长得多,我们 75 步应该更快,具体多少你跑出来记下来。

### 训练时看什么

训练开始后,Colab 会刷出一张表。看三样东西。

**training loss 往下走。** 一开始一点几,然后下降。分诊的回答是一段固定格式、只有二三十个 token 的 JSON,大部分 token(括号、字段名)非常好猜,所以 loss 会降得很低,零点零几都不奇怪。Unsloth 文档有一条经验「training loss 低于 0.2 多半是过拟合了」,那是对通用对话数据说的,在我们这种短的结构化输出上不适用,别被吓到。

**validation loss 跟着降,而且不回头。** 训练 loss 还在降、验证 loss 开始往上走,就是**过拟合**:模型在背训练集,不是在学规律。出现了就减少 epoch,或者回到 Day 570 补数据。

**loss 突然变大或变成 nan。** 就是第二步故意踩的那个坑,学习率太大。先把 2e-4 降到 1e-4 重来。

loss 只是训练过程的体温计,最后能不能用,看的是评测集上的准确率。这是 Day 574 的事:把适配器挂到 vLLM 上,和原版、和 DeepSeek 放在一起跑同一份评测集。

### 换个工具:LLaMA-Factory

如果你更想点界面,**LLaMA-Factory** 是国内用得很多的微调框架,`llamafactory-cli webui` 起一个网页,选模型、选数据、填 r 和学习率就能训。它读我们的 messages 格式要在 `data/dataset_info.json` 里登记一下(`formatting` 写 `sharegpt`,把 `role_tag`、`content_tag` 指到 `role`、`content`),模板选 `qwen3_nothink`。两个工具训出来的都是标准的 PEFT 格式 LoRA,Day 574 的部署方式一样。我没有实跑 LLaMA-Factory,配置细节以它仓库里 `examples/train_lora/` 下的示例为准。

## 几个数怎么定

LoRA 的超参数不多,下面是起点,不是答案,定了以后用评测结果调。

**r(rank)**:16 或 32 起步。第二步看到了,rank 太小学不全,太大浪费、还更容易过拟合。分诊这种输出空间很小的任务,16 够了;工具调用、要学一种写作风格这种更复杂的,可以试 32、64。

**lora_alpha**:等于 r 或 2 倍 r。旁路的输出乘的是 `alpha / r`,所以如果你把 r 从 16 改成 32 而 alpha 不动,旁路的影响就被减半了,等于偷偷改了学习率。改 r 时 alpha 跟着改。

**学习率**:2e-4 起步。Thinking Machines 在 2025 年 9 月发的《LoRA Without Regret》(John Schulman 等)做了大量对照实验,结论之一是 LoRA 的最佳学习率稳定在全量微调最佳学习率的 10 倍左右。全量微调常用 1e-5 到 2e-5,乘 10 就是 1e-4 到 2e-4。

**挂在哪些层**:全部 7 个投影。同一篇文章的实验里,只挂注意力层的 LoRA 明显比只挂 MLP 层的差;第三步的表也能看出原因,MLP 的三个矩阵比注意力的大一倍多,模型的大部分参数在那里。

**epoch**:1 到 3。我们只有 297 条,2 个 epoch 起步。

**batch**:每步实际喂 8 到 16 条。《LoRA Without Regret》还发现 LoRA 比全量微调更怕大 batch,所以别为了快把 batch 开得很大。

这些结论来自那篇文章和 Unsloth 文档,不是我实测的。真正可信的是你自己的评测集:改一个数,重训,重测,和上一版比。

### 零件和大代码的对照

| 零件 | 在哪学的 | Colab 笔记本里的位置 |
| --- | --- | --- |
| W 冻结 + 旁路 B @ A | `lora_forward.py` | 单元 2 `get_peft_model` |
| B 为 0、A 随机 | `lora_train.py` 最后一行 | PEFT 自动做,不用写 |
| rank 是容量 | `lora_train.py` 四个 r | 单元 2 `r=16` |
| 学习率太大会 nan | 故意踩的坑 | 单元 4 `learning_rate`、`warmup_steps` |
| 7 个投影层的形状 | `qwen3_params.py` | 单元 2 `target_modules` |
| 4 位基座省显存 | `ft_memory.py`、Day 569 | 单元 2 `load_in_4bit` |
| chat template | Day 571 | 单元 3、检查 ① |
| 只对 assistant 算损失 | Day 570、Day 571 | 单元 5、检查 ② |

## 动手练习

1. **rank 和目标对不上**:把 `lora_train.py` 里 delta 的秩从 4 改成 8(两处 `4` 都改),再用 r = 4、8、16 各训一次,预测结果再跑。

<details><summary>参考答案</summary>

用 `sed` 复制一份并改两处:delta 那一行换成秩 8,末尾的循环换成 `(4, 8, 16)`:

```bash
sed -e 's#delta = rng.normal(size=(d, 4)) @ rng.normal(size=(4, k)) / 8   \# 「微调该学到的变化」,rank 4#delta = rng.normal(size=(d, 8)) @ rng.normal(size=(8, k)) / 8   \# rank 8#' \
    -e 's/for r in (1, 2, 4, 8):/for r in (4, 8, 16):/' part10/lora_train.py > part10/lora_train_rank8.py
grep -n "delta =\|for r in" part10/lora_train_rank8.py
uv run python part10/lora_train_rank8.py
```

```text
12:delta = rng.normal(size=(d, 8)) @ rng.normal(size=(8, k)) / 8   # rank 8
38:for r in (4, 8, 16):
r=4 的训练过程:
  第   0 步 loss=7.5162
  第  20 步 loss=5.6997
  第  50 步 loss=2.6974
  第 100 步 loss=2.2106
r=4  可训练参数   512  训练 300 步后 loss=2.1698
r=8  可训练参数  1024  训练 300 步后 loss=0.0000
r=16  可训练参数  2048  训练 300 步后 loss=0.0000
全量微调要训练 4096 个参数
A 和 B 都初始化成 0: 7.5162
```

`sed -e` 可以连写多条替换;第一条用 `#` 当分隔符,因为要替换的内容里有 `/`。`grep -n` 确认两处都改到了,打印行号。

目标的秩变成 8 以后,r=4 卡在 2.17 下不去了,r=8 才降到 0。起点 loss 也从 4.23 变成了 7.52,因为 delta 更大了,一开始的误差更大。这就是「容量不够」的样子:loss 很快停在一个平台上,再训也没用。在真实训练里看到验证 loss 早早就平了、准确率上不去,可以试着把 r 翻倍。

</details>

2. **只挂注意力层省多少**:改 `qwen3_params.py`,算一下 r=16 时只挂 `q_proj`、`k_proj`、`v_proj`、`o_proj` 四个层要训练多少参数,和挂全部 7 个比。

<details><summary>参考答案</summary>

不用改文件,在命令行里导入函数,把形状字典过滤一下:

```bash
uv run python - <<'PY'
import json, sys
sys.path.insert(0, 'part10')
from qwen3_params import linear_shapes
cfg = json.load(open('part10/qwen3/config.json'))
shapes = linear_shapes(cfg)
attn = sum(16 * (k + d) for n, (k, d) in shapes.items() if n.endswith(('q_proj', 'k_proj', 'v_proj', 'o_proj')))
mlp = sum(16 * (k + d) for n, (k, d) in shapes.items() if n in ('gate_proj', 'up_proj', 'down_proj'))
L = cfg['num_hidden_layers']
print(f"只挂注意力 {attn * L:,}  只挂 MLP {mlp * L:,}  全挂 {(attn + mlp) * L:,}")
PY
```

```text
只挂注意力 11,796,480  只挂 MLP 21,233,664  全挂 33,030,144
```

只挂注意力省了大约三分之二的参数,LoRA 文件从 63 MB 降到 22 MB 左右。但《LoRA Without Regret》的实验里,只挂注意力效果明显更差,省下的这点显存不值。`n.endswith((...))` 可以传一个元组,任意一个后缀匹配就为真。这道题想让你看到:MLP 的 LoRA 参数是注意力的近两倍,因为 MLP 的矩阵本来就大。

</details>

3. **算一下训练步数**:写一个小函数,输入样本数、每卡 batch、梯度累积、epoch,算出总共更新多少步、每个 epoch 多少步,并算出 `eval_steps=10` 时会评估几次。用我们的 297 条和单元 4 的配置跑。

<details><summary>参考答案</summary>

新建 `part10/train_steps.py`:

```python
# agent-zero-lab/part10/train_steps.py
"""训练前先算:一共更新多少步,验证集评估几次,预热占多少。"""
import math


def plan(n: int, batch: int, accum: int, epochs: int, eval_steps: int, warmup: int) -> None:
    per_epoch = math.ceil(n / (batch * accum))
    total = per_epoch * epochs
    print(f"每步实际 {batch * accum} 条,每个 epoch {per_epoch} 步,共 {total} 步")
    print(f"每 {eval_steps} 步评估一次,共 {total // eval_steps} 次;预热 {warmup} 步占 {warmup / total:.0%}")


plan(297, 2, 4, 2, 10, 5)
plan(297, 2, 8, 3, 10, 5)
```

<div class="line-notes">

- `per_epoch = math.ceil(n / (batch * accum))` 一个 epoch 要更新几次:297 ÷ 8 = 37.1,向上取整得 38。`math.ceil` 相当于 JS 的 `Math.ceil`。不同版本的 transformers 对最后不满一批的处理略有不同,差一步是正常的。
- `print(f"每 {eval_steps} 步评估一次,共 {total // eval_steps} 次;预热 {warmup} 步占 {warmup / total:.0%}")` `//` 整除。Unsloth 文档建议预热占总步数的 5% 到 10%。

</div>

```bash
uv run python part10/train_steps.py
```

```text
每步实际 8 条,每个 epoch 38 步,共 76 步
每 10 步评估一次,共 7 次;预热 5 步占 7%
每步实际 16 条,每个 epoch 19 步,共 57 步
每 10 步评估一次,共 5 次;预热 5 步占 9%
```

第一组就是单元 4 的配置,76 步、评估 7 次,预热 7% 在建议范围里。第二组换成 Unsloth 文档推荐的「2 × 8」和 3 个 epoch,步数反而变少了,因为每步喂的条数翻了倍。数据只有几百条时,步数本来就少,一次评估的间隔别设得太大,否则验证曲线只有两三个点,看不出趋势。

</details>

4. **显存不够了怎么办**(开放题):你把工具调用样本拿去训练,`max_seq_length` 改成了 4096,单元 6 一跑就报 CUDA out of memory。按代价从小到大,列出你会依次尝试的调整。

<details><summary>参考答案</summary>

示范解法,按「不影响效果的先试」排:

① 把 `per_device_train_batch_size` 从 2 降到 1,同时把 `gradient_accumulation_steps` 从 4 升到 8,每步实际喂的条数不变,激活值减半。② 确认 `use_gradient_checkpointing="unsloth"` 开着。③ 查样本长度分布,如果只有极少数样本超过 2048,把这几条拆短或丢掉,`max_seq_length` 回到 2048。④ 确认 `load_in_4bit=True`、`optim="adamw_8bit"`。⑤ 最后才动 r(比如 32 降到 16),因为这会影响模型能学多少。

能验证的部分是第 ① 条的账:激活值和每次送进卡的条数成正比,条数减半,这部分显存大约减半;`ft_memory.py` 算的那部分(基座和 LoRA)不变。我没有 GPU,没法贴 OOM 前后的实测显存,你在 Colab 上可以用单元 6 打印的峰值显存对比两种配置。

</details>

验收标准:`lora_forward.py` 输出 `完全一样吗? True`;`lora_train.py` 的四个 r 和本文数字一致,`5` 作为参数时出现 nan;`qwen3_params.py` 在 r=32 时算出 66,060,288 和 4,088,528,384,和 Unsloth 笔记本打印的一致;你能对着 Colab 笔记本说出每个单元做什么,以及两处检查各在查什么。本机部分花费 0 元;Colab 免费档也不花钱。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 全量微调 | 训练时更新模型的全部参数。Qwen3-4B 光权重和优化器就要约 60 GB |
| 梯度 | 每个参数一个数,表示往哪个方向挪、挪多少能让损失变小 |
| Adam / AdamW | 最常用的优化器,给每个参数记两个滑动平均,每参数多占 8 字节 |
| 学习率 | 每一步沿梯度挪多远。今天 0.5 能收敛,5 变成 nan |
| LoRA | 冻结原权重,在旁边加 B @ A 两个瘦矩阵只训练它们 |
| rank(秩,r) | A 和 B 中间那个维度,决定 LoRA 能学多复杂的改动。目标秩 4 时 r=1 卡在 2.44 |
| 低秩 | 矩阵只有少数几个独立方向。d × r 乘 r × k 的结果秩最多是 r |
| lora_alpha | 缩放系数,旁路输出乘 alpha / r。通常等于 r 或 2r |
| PEFT | 参数高效微调,只训练一小部分参数的方法统称;也是 Hugging Face 一个库的名字 |
| QLoRA | 基座量化成 4 位存,LoRA 仍用 16 位训练。我们算出 2.9 GB |
| 激活值 | 前向计算的中间结果,反向算梯度要用,和 batch、序列长度成正比 |
| 梯度检查点 | 不保存全部激活值,需要时重算,用时间换显存 |
| 梯度累积 | 攒几次梯度再更新一次,用小 batch 的显存达到大 batch 的效果 |
| 均方误差(MSE) | 误差平方的平均,今天玩具训练用的损失 |
| nan | Not a Number,数值溢出以后的结果,和 JS 的 NaN 一样 |
| 过拟合 | 训练 loss 还在降、验证 loss 开始升,模型在背训练集 |
| 适配器(adapter) | 训练完保存下来的 LoRA 权重和配置,r=16 约 63 MB |
| Unsloth | 优化单卡微调速度和显存的开源库,有大量 Colab 笔记本 |
| epoch | 整个训练集过一遍。我们 2 个 epoch 约 76 步 |

## 常见误区

**以为 LoRA 比全量微调「弱」所以不想用。** 《LoRA Without Regret》的实验结论是,只要 rank 不成为容量瓶颈、挂到全部层、学习率给对,LoRA 在中小数据集上和全量微调差不多。分诊这种几百条数据的任务,LoRA 就是首选。

**A 和 B 都初始化成 0。** 今天的实验里 loss 300 步一动不动。两个梯度互相乘着对方,同时为 0 就谁也启动不了。用框架时别去改它的默认初始化。

**改了 r 不改 lora_alpha。** 旁路乘的是 alpha / r,r 翻倍 alpha 不动,等于把 LoRA 的学习率减半了,然后得出「r 越大效果越差」的错误结论。

**看到 nan 就怀疑数据。** 先怀疑学习率。今天 0.5 正常,5 就在第 20 步变成了 nan。真实训练里先降学习率、加预热,还不行再查数据里有没有异常长的样本。

**不看检查 ① 和检查 ② 就开训。** 模板错了、遮罩错了,训练不会报错,loss 照样下降,只有上线后模型答非所问你才发现。两段打印各花你 10 秒钟。

**随手升级 Unsloth 笔记本里的依赖。** 笔记本固定了 transformers 4.57.6 和 TRL 0.22.2,Unsloth 的补丁是按这些版本写的。换成最新版可能直接报错,也可能不报错但优化失效。

**拿 training loss 判断模型好不好。** 分诊的回答又短又固定,loss 会降得很低,这不说明分类口径学对了。最后只认评测集上的准确率,而且要和原版、和 API 基线放在一起比。

**Colab 训完不马上下载。** 会话一断,`/content/` 下的东西全没了,适配器要重训。训完第一件事是 `files.download`,或者推到 Hugging Face 的私有仓库。

## 学习资料

### 文档与文章

- [LoRA: Low-Rank Adaptation of Large Language Models](https://arxiv.org/abs/2106.09685):Hu 等 2021 年的原论文,读摘要和第 4 节(方法,图 1 就是今天那张结构图),20 分钟。
- [QLoRA: Efficient Finetuning of Quantized LLMs](https://arxiv.org/abs/2305.14314):4 位基座加 16 位 LoRA 的那篇,读摘要和第 1 节。
- [Thinking Machines · LoRA Without Regret](https://thinkingmachines.ai/blog/lora/):今天「几个数怎么定」那一节的主要来源,图很多,英文,先看每节开头的结论。
- [Unsloth · LoRA Hyperparameters Guide](https://unsloth.ai/docs/get-started/fine-tuning-llms-guide/lora-hyperparameters-guide):r、alpha、学习率、epoch、过拟合迹象的经验值,和单元 2、单元 4 对照着读。
- [Hugging Face PEFT · LoRA 概念说明](https://huggingface.co/docs/peft/main/en/conceptual_guides/lora):LoRA 在 PEFT 库里的参数说明,`target_modules`、`lora_alpha` 各是什么。
- [TRL · SFTTrainer](https://huggingface.co/docs/trl/main/en/sft_trainer):SFTTrainer 的参数和「只对回答算损失」的说明。注意这是最新版文档,参数名可能和笔记本固定的 0.22.2 有出入。
- [Sebastian Raschka · Practical Tips for Finetuning LLMs Using LoRA](https://magazine.sebastianraschka.com/p/practical-tips-for-finetuning-llms):作者跑了几百次 LoRA 实验后的经验总结,r 和 alpha 怎么搭、QLoRA 省多少,2023 年的文章,工具旧了,结论大多还成立。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1waZ2YDEcp&autoplay=0&high_quality=1" title="【LoRA微调】从原理到调参,7 个问题彻底理解LoRA,不懂线性代数也没问题" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>费曼学徒冬瓜 · 【LoRA微调】从原理到调参,7 个问题彻底理解LoRA,不懂线性代数也没问题 · 约 18 分钟,低秩、rank、alpha 都用大白话讲,适合看完第一、二步以后复习。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1TTbFegELr&autoplay=0&high_quality=1" title="微调技术大比拼:全量微调与LoRA、QLoRA实测对比!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI开发者-就爱瞎鼓捣 · 微调技术大比拼:全量微调与LoRA、QLoRA实测对比! · 约 9 分钟,实测三种方式的显存和速度,正好补上今天第四步我没法实测的那部分。</figcaption>
</figure>

- 费曼学徒冬瓜 · [【微调08-终】一口气说完调参技巧,解读loss曲线](https://www.bilibili.com/video/BV1z9FpzyENu):约 22 分钟,用 LLaMA-Factory 讲训练和验证 loss 曲线怎么看,对应「训练时看什么」那一节。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/t509sv5MT0w" title="LoRA explained (and a bit about precision and quantization)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>DeepFindr · LoRA explained (and a bit about precision and quantization) · 讲 LoRA 的矩阵分解,顺带讲了 16 位、4 位精度和 QLoRA,和今天第一、四步对应。英文。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/oZSxMNEYDjQ" title="Fine-Tune a 4B LLM on a FREE GPU (Unsloth LoRA Tutorial)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LocalLayer · Fine-Tune a 4B LLM on a FREE GPU (Unsloth LoRA Tutorial) · 在免费 GPU 上用 Unsloth 训练一个 4B 模型的完整录屏,我没法给你看真实的训练界面,看这个补上。</figcaption>
</figure>

### 书籍

- Sebastian Raschka《Build a Large Language Model (From Scratch)》(Manning, 2024),中文版《从零构建大模型》(人民邮电出版社,2025):附录 E 用 PyTorch 从零实现 LoRA,是今天 `lora_train.py` 的 PyTorch 版,读完能把手写梯度换成自动求导。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly, 2024),中文版《图解大模型:生成式AI原理与实战》(人民邮电出版社,2025):第 12 章讲生成模型微调,有 LoRA 和 QLoRA 的图解。

### 开源项目与代码

- [unslothai/notebooks](https://github.com/unslothai/notebooks):Unsloth 全部官方笔记本,今天改的是 `nb/Qwen3_(4B)-Instruct.ipynb`,工具调用训练看 `nb/Qwen3_(4B)-Tool_Calling.ipynb`。
- [unslothai/unsloth](https://github.com/unslothai/unsloth):Unsloth 本体。
- [huggingface/peft](https://github.com/huggingface/peft):LoRA 的标准实现,`src/peft/tuners/lora/layer.py` 里能找到和 `lora_forward.py` 一样的那一行前向。
- [microsoft/LoRA](https://github.com/microsoft/LoRA):论文作者的原始代码。
- [hiyouga/LLaMA-Factory](https://github.com/hiyouga/LLaMA-Factory):带网页界面的微调框架,`examples/train_lora/` 下有 Qwen3 的 LoRA 配置示例。

## 自测

1. LoRA 为什么要把 B 初始化成 0、A 初始化成随机数?两个都是 0 会怎样?

<details><summary>答案</summary>

B 为 0,训练开始时旁路输出 B @ A @ x 是 0,模型和原模型完全一样,训练从一个已知能用的起点出发。A 随机,是因为 A 的梯度要乘 B、B 的梯度要乘 A @ x,两个都是 0 时两个梯度都是 0,谁也动不了。今天 `lora_train.py` 的最后一行,两个都是 0 时 loss 300 步一直是 4.2323。

</details>

2. Qwen3-4B 挂 r=16 的 LoRA 到 7 个投影层,要训练多少参数?大约怎么估?

<details><summary>答案</summary>

33,030,144 个,约占基座的 0.82%。每个线性层的 LoRA 参数是 r × (输入维度 + 输出维度),每层 7 个加起来是 16 × 57,344 = 917,504,乘 36 层。粗估的话记住「r=16 时大约 1% 上下」就行。

</details>

3. 训练日志里 loss 前 10 步在 1.2 左右,第 15 步突然变成 38,第 20 步变成 nan。最可能是什么问题?先怎么改?

<details><summary>答案</summary>

学习率太大,每步挪过了头,越震越大,最后数值溢出。先把学习率降一半(比如 2e-4 降到 1e-4),确认有预热步;还不行再查数据里有没有异常长或异常的样本。

</details>

4. 训练 loss 一路降到 0.02,验证 loss 从第 30 步开始上升。说明什么?怎么办?

<details><summary>答案</summary>

过拟合了:模型在记训练集,不是在学规律。减少 epoch(在验证 loss 最低的那一步附近停),或者加数据、加一点 lora_dropout 或 weight_decay。最终以评测集上的准确率为准,单看 training loss 低没有意义。

</details>

5. (面试题)面试官问:「你在一张 16 GB 的卡上微调过 4B 模型吗?怎么塞下的?」请回答。

<details><summary>答案</summary>

全量微调每个参数要权重、梯度、两份 Adam 状态和 fp32 主权重,约 16 字节,4B 模型光这些就约 60 GB,放不下。我用 QLoRA:基座量化成 4 位冻结,约 2.5 GB;只在 7 个投影层上挂 r=16 的 LoRA,3,300 万参数,连优化器状态约 0.5 GB;再用 8 位 AdamW、梯度检查点,按序列长度控制 batch,用梯度累积凑到每步 8 到 16 条。训练前打印套模板后的文本和遮罩后的标签,确认只对回答算损失;训练中看验证 loss 防过拟合;最后挂到 vLLM 上用同一份评测集和原版、API 基线对比,而不是看 loss 下结论。

</details>

## 明天预告

Day 573 · 第 82 周复习:进阶(Day 567–572)。这一周从「什么时候值得自部署」一路走到了在 Colab 上训练 LoRA:显存账、vLLM 上线、压测和量化、造训练集、工具调用数据、LoRA。明天把这六天串成一张图,做一个只用本周知识的小项目:一个「微调前体检」脚本,输入模型的 config 和训练集,一次打印显存、LoRA 参数量、泄漏检查和训练步数。
