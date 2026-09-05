---
title: 'Day 26 · 数值格式：fp32/tf32/fp16/bf16/fp8/int8/int4 各占几位、差在哪'
description: '前面四周所有的「× 2 字节」都默认了 fp16。今天把这 16 个位拆开看：几位给符号、几位给指数、几位给尾数，换一种分法就是另一个格式。然后回答两个实际问题：为什么 T4 跑 bf16 会出事，以及把权重压到 8 位、4 位之后 decode 上限从 150 tok/s 变成多少。'
pubDate: 2026-09-24
regime: memory
tags: ['fp16', 'bf16', 'fp8', 'int8', 'quantization', 'numerics', 'aiinfra-365']
series: 'aiinfra-365'
day: 26
lang: 'zh'
---

## 今天要解决的问题

从 Day 2 算权重 13.5 GB 开始,每一次算显存我都写「参数量 × 2 字节」,这个 2 字节就是 fp16。当时只记了一条规则:fp16 是 16 位,16 ÷ 8 = 2 字节。今天把这 16 位打开看里面是什么,因为有三件事只靠「2 字节」这条规则答不了:

1. 路线图 W2 那张坑表里有一行「T4 是 Turing,不支持 bf16,报错或极慢降级」。fp16 和 bf16 都是 16 位,都是 2 字节,凭什么一个支持一个不支持?差在哪里?
2. Day 25 三张卡对比表最后两行「支持 bf16 / 支持 fp8」是分代的。一个数值格式为什么会和硬件代数绑定?
3. Day 5 说量化能直接换来 decode 速度,因为读的字节少了。那 int8 和 int4 到底怎么用 8 位、4 位表示原来 16 位的数,丢掉的是什么,decode 上限具体变成多少?

今天结束时要能画出七种格式的位分配图,说出每种的范围和精度差几个量级,并且用 Day 5 的带宽算式把 7B 模型在 fp16、int8、int4 下的 decode 上限各算一遍。

先说清楚今天不讲什么:不讲量化算法怎么选 scale、怎么处理 outlier,那是 M2 W7 跑 GPTQ 和 AWQ 时的事。今天只讲格式本身,也就是「一个数在内存里长什么样」。

## 一个浮点数的三段

计算机里存一个带小数的数,用的是科学计数法。十进制里 6.74 × 10⁹ 分三部分:正负号、6.74 这个有效数字、指数 9。二进制浮点数一样,一串位切成三段:

- **符号位**(sign):1 位,0 正 1 负。
- **指数位**(exponent):决定这个数大概有多大,也就是小数点在哪。位数越多,能表示的范围越宽。
- **尾数位**(mantissa,也叫 fraction 或 significand):决定有效数字有几位。位数越多,相邻两个能表示的数之间隔得越近,也就是精度越高。

任何一种浮点格式,就是「总共几位,怎么分给这三段」。分法不同,范围和精度就不同。范围靠指数,精度靠尾数,**总位数固定的时候这两样是此消彼长的**,这一句是今天所有内容的核心。

先看最熟的 fp32:1 + 8 + 23 = 32 位。8 位指数,能表示的最大数约 3.4 × 10³⁸,最小的正规数约 1.2 × 10⁻³⁸;23 位尾数,相邻两个数的相对间距是 2⁻²³ ≈ 1.2 × 10⁻⁷,大约 7 位十进制有效数字。深度学习之外的科学计算基本都用它,训练早期也全用它。

<figure>
<svg viewBox="0 0 640 420" role="img" aria-label="七种数值格式的位分配:fp32、tf32、fp16、bf16、fp8 e4m3、fp8 e5m2、int8,每格一位,分符号、指数、尾数三种颜色">
  <g font-family="var(--font-mono)" font-size="11">
    <text x="20" y="22" fill="var(--ink-faint)">每格 1 位。</text>
    <rect x="96" y="12" width="12" height="12" fill="var(--ink)"/><text x="112" y="22" fill="var(--ink-soft)">符号</text>
    <rect x="160" y="12" width="12" height="12" fill="var(--compute)"/><text x="176" y="22" fill="var(--ink-soft)">指数(管范围)</text>
    <rect x="290" y="12" width="12" height="12" fill="var(--mem)"/><text x="306" y="22" fill="var(--ink-soft)">尾数(管精度)</text>
    <rect x="420" y="12" width="12" height="12" fill="none" stroke="var(--rule)" stroke-dasharray="2 2"/><text x="436" y="22" fill="var(--ink-soft)">tf32 里不用的位</text>
  </g>
  <!-- fp32 -->
  <text x="20" y="58" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">fp32</text>
  <text x="20" y="72" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">1+8+23</text>
  <rect x="90" y="46" width="16" height="22" fill="var(--ink)"/>
  <rect x="106" y="46" width="128" height="22" fill="var(--compute)"/>
  <rect x="234" y="46" width="368" height="22" fill="var(--mem)"/>
  <text x="140" y="62" font-family="var(--font-mono)" font-size="10" fill="var(--paper-raised)">8 位指数</text>
  <text x="380" y="62" font-family="var(--font-mono)" font-size="10" fill="var(--paper-raised)">23 位尾数 · 相对精度 1.2e-7</text>
  <!-- tf32 -->
  <text x="20" y="108" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">tf32</text>
  <text x="20" y="122" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">1+8+10</text>
  <rect x="90" y="96" width="16" height="22" fill="var(--ink)"/>
  <rect x="106" y="96" width="128" height="22" fill="var(--compute)"/>
  <rect x="234" y="96" width="160" height="22" fill="var(--mem)"/>
  <rect x="394" y="96" width="208" height="22" fill="none" stroke="var(--rule)" stroke-dasharray="3 2"/>
  <text x="140" y="112" font-family="var(--font-mono)" font-size="10" fill="var(--paper-raised)">8 位指数</text>
  <text x="250" y="112" font-family="var(--font-mono)" font-size="10" fill="var(--paper-raised)">10 位尾数</text>
  <text x="404" y="112" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">存还是 32 位,tensor core 只看前 19 位</text>
  <!-- fp16 -->
  <text x="20" y="158" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">fp16</text>
  <text x="20" y="172" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">1+5+10</text>
  <rect x="90" y="146" width="16" height="22" fill="var(--ink)"/>
  <rect x="106" y="146" width="80" height="22" fill="var(--compute)"/>
  <rect x="186" y="146" width="160" height="22" fill="var(--mem)"/>
  <text x="112" y="162" font-family="var(--font-mono)" font-size="10" fill="var(--paper-raised)">5 位 · 最大 65504</text>
  <text x="196" y="162" font-family="var(--font-mono)" font-size="10" fill="var(--paper-raised)">10 位 · 精度 9.8e-4</text>
  <!-- bf16 -->
  <text x="20" y="208" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">bf16</text>
  <text x="20" y="222" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">1+8+7</text>
  <rect x="90" y="196" width="16" height="22" fill="var(--ink)"/>
  <rect x="106" y="196" width="128" height="22" fill="var(--compute)"/>
  <rect x="234" y="196" width="112" height="22" fill="var(--mem)"/>
  <text x="112" y="212" font-family="var(--font-mono)" font-size="10" fill="var(--paper-raised)">8 位 · 范围同 fp32</text>
  <text x="240" y="212" font-family="var(--font-mono)" font-size="10" fill="var(--paper-raised)">7 位 · 7.8e-3</text>
  <line x1="350" y1="150" x2="350" y2="222" stroke="var(--rule)" stroke-dasharray="3 3"/>
  <text x="358" y="190" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">两个都是 16 位 = 2 字节,</text>
  <text x="358" y="204" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">只是 3 位从尾数挪给了指数</text>
  <!-- fp8 e4m3 -->
  <text x="20" y="258" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">fp8 e4m3</text>
  <text x="20" y="272" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">1+4+3</text>
  <rect x="90" y="246" width="16" height="22" fill="var(--ink)"/>
  <rect x="106" y="246" width="64" height="22" fill="var(--compute)"/>
  <rect x="170" y="246" width="48" height="22" fill="var(--mem)"/>
  <text x="226" y="262" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">最大 448 · 精度 0.125 · 权重和激活用</text>
  <!-- fp8 e5m2 -->
  <text x="20" y="308" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">fp8 e5m2</text>
  <text x="20" y="322" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">1+5+2</text>
  <rect x="90" y="296" width="16" height="22" fill="var(--ink)"/>
  <rect x="106" y="296" width="80" height="22" fill="var(--compute)"/>
  <rect x="186" y="296" width="32" height="22" fill="var(--mem)"/>
  <text x="226" y="312" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">最大 57344 · 精度 0.25 · 梯度用</text>
  <!-- int8 -->
  <text x="20" y="358" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">int8</text>
  <text x="20" y="372" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">1+7,无指数</text>
  <rect x="90" y="346" width="16" height="22" fill="var(--ink)"/>
  <rect x="106" y="346" width="112" height="22" fill="var(--mem)" fill-opacity="0.55"/>
  <text x="226" y="362" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">-128 到 127 的整数 · 等间距 · 靠外置 scale 还原</text>
  <!-- int4 -->
  <text x="20" y="400" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">int4</text>
  <text x="20" y="414" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">1+3</text>
  <rect x="90" y="388" width="16" height="22" fill="var(--ink)"/>
  <rect x="106" y="388" width="48" height="22" fill="var(--mem)" fill-opacity="0.55"/>
  <text x="226" y="404" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">-8 到 7 · 只有 16 个值 · 两个数塞一个字节</text>
</svg>
<figcaption>七种格式的位分配,每格一位,同一比例。琥珀色越长范围越宽,靛蓝色越长精度越高。fp16 和 bf16 总长一样,差别只是那 3 位在哪一段。int8、int4 没有指数段,所有格子都是等间距整数。</figcaption>
</figure>

## fp16 和 bf16:同样 16 位,分法不同

fp16(IEEE half precision):1 + 5 + 10。5 位指数只能表示到 2¹⁵ 量级,最大值 65504;最小正规数 2⁻¹⁴ ≈ 6.1 × 10⁻⁵,再往下靠非正规数(subnormal)勉强撑到 6 × 10⁻⁸。10 位尾数,相对精度 2⁻¹⁰ ≈ 9.8 × 10⁻⁴,大约 3 位十进制有效数字。

bf16(brain floating point,Google 为 TPU 设计):1 + 8 + 7。指数位和 fp32 一样是 8 位,所以范围和 fp32 完全相同,最大 3.4 × 10³⁸。代价是尾数只剩 7 位,相对精度 2⁻⁷ ≈ 7.8 × 10⁻³,大约 2 到 3 位有效数字,比 fp16 粗 8 倍。

两个格式放在一起就是那句核心:**总位数固定,范围和精度此消彼长**。bf16 把 3 位从尾数挪给指数,换来了和 fp32 一样宽的范围,付出的是精度粗 8 倍。

为什么深度学习偏爱 bf16?因为训练时最怕的不是精度粗,是**溢出**。梯度、激活、loss 这些量的动态范围很大,一个 attention 分数在 softmax 之前上万很常见,fp16 的 65504 一撞就变成 inf,inf 一进 loss 整个训练就 NaN 了。用 fp16 训练要靠 loss scaling(把 loss 先乘一个大数再算梯度,算完再除回去)来把小梯度抬进 fp16 的表示范围,这是 2017 年混合精度训练那篇论文的核心技巧,工程上多一层麻烦。bf16 范围和 fp32 一样,不需要 loss scaling,精度粗一点神经网络不太在乎,因为权重更新本身就是带噪声的。

推理侧的区别小一些。权重训完了,数值范围已知,fp16 通常也装得下,所以 Llama-2 的官方权重是 fp16,很多模型两种都发。但如果一个模型是用 bf16 训的,直接转成 fp16 有可能出现个别权重或激活超出 65504,HuggingFace 上不少模型卡会写「建议用 bf16 加载」就是这个原因。

一个容易忽略的细节:bf16 从 fp32 转换非常便宜,**直接截掉低 16 位**就行,因为符号位和指数位完全对齐。fp32 转 fp16 则要重新计算指数偏移、处理溢出和非正规数,是真正的格式转换。

## 为什么 T4 跑 bf16 会出事

现在能回答开头第一个问题了。

tensor core 是一块专用电路,它能吃什么格式的输入、吐什么格式的输出,是造芯片时就定死的。Turing(T4)那一代的 tensor core 支持 fp16 和 int8、int4,电路里没有 bf16 的乘法器和加法器。Ampere(A100)那一代加了 bf16 和 tf32。Hopper(H100)加了 fp8。Blackwell 又加了 fp4。

| 格式 | Turing · T4 | Ampere · A100 | Hopper · H100 |
| --- | --- | --- | --- |
| fp16 tensor core | 是 | 是 | 是 |
| bf16 tensor core | **否** | 是 | 是 |
| tf32 tensor core | 否 | 是 | 是 |
| int8 tensor core | 是 | 是 | 是 |
| int4 tensor core | 是 | 是 | 否(去掉了) |
| fp8 tensor core | 否 | 否 | 是 |

在 T4 上把模型用 bf16 加载会发生什么,分两种情况。一种是 PyTorch 直接报不支持,常见于某些 cuBLAS 的 GEMM 路径。另一种更隐蔽:PyTorch 为了兼容,在没有硬件支持的卡上用 fp32 CUDA core 模拟 bf16 运算,能跑,但走的是 Day 25 那条 8.1 TFLOP/s 的低屋顶而不是 65 TFLOP/s 的 tensor core 屋顶,慢好几倍,而且不报任何错。W2 测出来的数字会莫名其妙地比理论下限差一个量级,查半天才发现是 dtype 的问题。

判断方法一行代码:

```python
import torch
torch.cuda.is_bf16_supported()   # T4 上返回 False,A100 上返回 True
torch.cuda.get_device_capability()  # T4 是 (7, 5),A100 是 (8, 0),H100 是 (9, 0)
```

compute capability 8.0 以上才有 bf16 tensor core。所以 W2 的规则是:**在 T4 上一律 `torch_dtype=torch.float16`**,遇到模型卡说「建议 bf16」的,先用 fp16 试,输出乱了再想办法。

这就是「格式支持是分代硬件的事」的全部含义:格式不是软件层面的设置,是芯片里有没有那块电路。

## tf32:一个折中

tf32(TensorFloat-32)是 Ampere 引入的,1 + 8 + 10,共 19 位。它的用法有点特别:数据在内存里**还是按 fp32 存**,占 32 位,只是送进 tensor core 算矩阵乘时,硬件只看前 19 位,尾数后 13 位直接丢掉。所以它有 fp32 的范围、fp16 的精度,不省显存,也不省带宽,只是让 fp32 的矩阵乘能走 tensor core 快起来。

A100 上 tf32 tensor core 峰值 156 TFLOP/s,是 fp16 的一半、fp32 CUDA core 的 8 倍。PyTorch 里默认对卷积开、对矩阵乘关,开关是:

```python
torch.backends.cuda.matmul.allow_tf32 = True   # 或 torch.set_float32_matmul_precision('high')
```

Day 14 测算力时如果用 fp32 张量做 matmul,这个开关的状态决定了测到的是 19.5 还是 156,两个都不是 312。这是那天说「fp32 是另一个数」的具体来源。tf32 对今天的推理路线影响不大,记住它存在、记住它不省字节就够了。

## fp8:两种分法给两种用途

fp8 只有 8 位,Hopper 引入,有两种分法,各有用途:

**e4m3**:1 + 4 + 3。4 位指数,最大 448,最小正规数 2⁻⁶ ≈ 0.016。3 位尾数,相对精度 2⁻³ = 0.125,也就是相邻两个数差 12.5%。范围窄但精度相对好一点,给权重和激活用,因为这两样的数值范围可以事先量出来并用 scale 压进 ±448。

**e5m2**:1 + 5 + 2。指数和 fp16 一样 5 位,最大 57344,范围宽。尾数只有 2 位,精度 0.25,相邻两个数差 25%。给梯度用,因为反向传播时梯度的动态范围很大,宁要范围不要精度。

fp8 做推理时权重占的字节和 int8 一样是 1 字节,但它是浮点,大数和小数之间的相对精度是均匀的,不需要像 int8 那样每组配一个 scale 来对付分布不均。代价是只有 H100 及以后的 tensor core 支持,A100 上没有。这是 2022 年 NVIDIA、Arm、Intel 联合提出的格式,论文在参考资料里。

## int8 和 int4:没有指数,靠外置的 scale

整数格式和浮点格式是两种完全不同的思路。int8 就是 -128 到 127 这 256 个整数,int4 是 -8 到 7 这 16 个整数,**格子之间等间距,没有指数段**。用它们表示权重的做法是量化(quantization):

1. 拿一组权重(比如一行,或一组 128 个),找出绝对值最大的那个,记作 max。
2. 算一个缩放系数 scale = max ÷ 127(int8)或 max ÷ 7(int4)。
3. 每个权重除以 scale,四舍五入到整数,存起来。
4. 用的时候乘回 scale 还原成浮点数。

存的是整数,外加每组一个 fp16 的 scale。一组 128 个权重配一个 scale 的话,int4 每个权重实际占 4 位加 16 ÷ 128 = 0.125 位,约 4.1 位,这就是量化模型说「4.x bit」的来源。有的方案还存一个零点(zero point)让不对称的分布也能用满 16 个格子,再多几分之一位。

这个方案的精度损失来自两处。一是四舍五入本身,int4 只有 16 个格子,原来 fp16 里几千个不同的值挤进 16 个格子,大部分信息丢了。二是 outlier:一组里只要有一个特别大的数,scale 就被它撑大,其他正常大小的数全被压成 0 或 1 两个格子。LLM 的激活里恰好有系统性的 outlier 通道,这是 2022 年 LLM.int8 那篇论文发现的,后来的 GPTQ、AWQ 各自用不同办法绕这个坑,M2 W7 再讲。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="范围与精度对比:浮点格式在数轴上格子疏密不均,越大越疏;整数格式等间距;并标出各格式最大值">
  <text x="20" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">同一段数轴(0 到 max),看格子怎么分布</text>
  <!-- floating: fp8 e4m3 illustration: dense near 0, sparse far -->
  <text x="20" y="58" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">浮点(以 fp8 e4m3 为例)</text>
  <line x1="200" y1="56" x2="600" y2="56" stroke="var(--rule)"/>
  <g stroke="var(--compute)" stroke-width="1.5">
    <line x1="200" y1="50" x2="200" y2="62"/><line x1="203" y1="50" x2="203" y2="62"/><line x1="206" y1="50" x2="206" y2="62"/><line x1="209" y1="50" x2="209" y2="62"/><line x1="212" y1="50" x2="212" y2="62"/><line x1="216" y1="50" x2="216" y2="62"/><line x1="220" y1="50" x2="220" y2="62"/><line x1="225" y1="50" x2="225" y2="62"/><line x1="231" y1="50" x2="231" y2="62"/><line x1="238" y1="50" x2="238" y2="62"/><line x1="247" y1="50" x2="247" y2="62"/><line x1="258" y1="50" x2="258" y2="62"/><line x1="272" y1="50" x2="272" y2="62"/><line x1="290" y1="50" x2="290" y2="62"/><line x1="312" y1="50" x2="312" y2="62"/><line x1="340" y1="50" x2="340" y2="62"/><line x1="375" y1="50" x2="375" y2="62"/><line x1="420" y1="50" x2="420" y2="62"/><line x1="475" y1="50" x2="475" y2="62"/><line x1="540" y1="50" x2="540" y2="62"/><line x1="600" y1="50" x2="600" y2="62"/>
  </g>
  <text x="200" y="80" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">0 附近很密</text>
  <text x="500" y="80" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">越大越疏 · 相对精度恒定</text>
  <!-- integer int4 -->
  <text x="20" y="118" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">整数(以 int4 正半轴为例)</text>
  <line x1="200" y1="116" x2="600" y2="116" stroke="var(--rule)"/>
  <g stroke="var(--mem)" stroke-width="1.5">
    <line x1="200" y1="110" x2="200" y2="122"/><line x1="257" y1="110" x2="257" y2="122"/><line x1="314" y1="110" x2="314" y2="122"/><line x1="371" y1="110" x2="371" y2="122"/><line x1="428" y1="110" x2="428" y2="122"/><line x1="485" y1="110" x2="485" y2="122"/><line x1="542" y1="110" x2="542" y2="122"/><line x1="600" y1="110" x2="600" y2="122"/>
  </g>
  <text x="200" y="140" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">0</text>
  <text x="590" y="140" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">7 × scale</text>
  <text x="300" y="140" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">等间距 · 8 个格子 · scale 由这组里最大的数决定</text>
  <!-- max values bar (log scale) -->
  <text x="20" y="180" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">各格式最大值(对数轴)</text>
  <line x1="200" y1="200" x2="600" y2="200" stroke="var(--rule)"/>
  <g font-family="var(--font-mono)" font-size="10">
    <circle cx="228" cy="200" r="4" fill="var(--mem)"/><text x="214" y="222" fill="var(--ink-soft)">int4 · 7</text>
    <circle cx="262" cy="200" r="4" fill="var(--mem)"/><text x="244" y="238" fill="var(--ink-soft)">int8 · 127</text>
    <circle cx="276" cy="200" r="4" fill="var(--compute)"/><text x="270" y="190" fill="var(--ink-soft)">e4m3 · 448</text>
    <circle cx="328" cy="200" r="4" fill="var(--compute)"/><text x="316" y="222" fill="var(--ink-soft)">fp16 · 65504</text>
    <circle cx="326" cy="200" r="4" fill="none" stroke="var(--compute)"/><text x="330" y="238" fill="var(--ink-soft)">e5m2 · 57344</text>
    <circle cx="590" cy="200" r="4" fill="var(--compute)"/><text x="500" y="190" fill="var(--ink-soft)">fp32 = bf16 · 3.4e38</text>
  </g>
</svg>
<figcaption>上两条数轴是同一段 0 到 max:浮点格子在 0 附近密、往大处越来越疏,相对精度恒定;整数格子等间距,一组里一个特别大的数就把 scale 撑大,其他数被挤进最左边几个格子。下面是各格式最大值,bf16 和 fp32 重合在最右边,fp16 和 e5m2 挤在中间,这就是「范围靠指数」。</figcaption>
</figure>

## 把 Day 5 的算式用新格式重算一遍

现在回到推理。Day 5 的 decode 下限公式是:

```
每步最短时间 = 权重字节数 ÷ 显存带宽
```

权重字节数 = 参数量 × 每个参数的字节数。改变格式,改的就是后面那个乘数。Llama-2-7B、6.74B 参数、A100 2039 GB/s:

| 格式 | 每参数字节 | 权重总量 | 每步最短时间 | decode 上限(batch 1) | 相对 fp16 |
| --- | --- | --- | --- | --- | --- |
| fp32 | 4 | 27.0 GB | 13.2 ms | 76 tok/s | 0.5× |
| fp16 / bf16 | 2 | 13.5 GB | 6.6 ms | 151 tok/s | 1× |
| fp8 / int8 | 1 | 6.7 GB | 3.3 ms | 302 tok/s | 2× |
| int4(不计 scale) | 0.5 | 3.4 GB | 1.65 ms | 605 tok/s | 4× |
| int4 + 每 128 个一组 fp16 scale | 0.516 | 3.5 GB | 1.7 ms | 586 tok/s | 3.9× |

算式就一条,以 int8 为例:6.74e9 × 1 B = 6.74 GB;6.74 GB ÷ 2039 GB/s = 3.3 ms;1 ÷ 3.3 ms ≈ 302 tok/s。int4 那行多算了 scale:每 128 个权重配一个 2 字节的 scale,每个权重多出 2 ÷ 128 = 0.0156 字节,所以是 0.516 字节。

这张表说明量化在 roofline 上挪的是什么。回到 Day 5 那张图:decode batch 1 的算术强度是 1 FLOP/byte,在斜线的最左边。量化到 int8 后,每个参数搬 1 字节做 2 FLOP,算术强度变成 2;int4 变成 4。**点沿着斜线往右上挪了,离 ridge point 153 还是很远,但同一条斜线上高一点的位置对应的可达算力就高一倍、两倍**。这就是「量化 = 省字节 = decode 提速」的全部机制,不涉及任何算力上的改变。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="7B 模型在不同格式下的权重体积和 decode 上限对比条形图">
  <text x="20" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">Llama-2-7B · A100 2039 GB/s · batch 1 · 理论上限</text>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="20" y="62" fill="var(--ink)">fp32</text>
    <rect x="80" y="48" width="400" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="90" y="63" fill="var(--mem)">27.0 GB</text>
    <text x="490" y="63" fill="var(--ink-soft)">76 tok/s</text>
    <text x="20" y="102" fill="var(--ink)">fp16</text>
    <rect x="80" y="88" width="200" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="90" y="103" fill="var(--mem)">13.5 GB</text>
    <text x="290" y="103" fill="var(--ink-soft)">151 tok/s ← Day 5 的那个 150</text>
    <text x="20" y="142" fill="var(--ink)">int8</text>
    <rect x="80" y="128" width="100" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="90" y="143" fill="var(--mem)">6.7 GB</text>
    <text x="190" y="143" fill="var(--ink-soft)">302 tok/s</text>
    <text x="20" y="182" fill="var(--ink)">int4</text>
    <rect x="80" y="168" width="52" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="90" y="183" fill="var(--mem)">3.5</text>
    <text x="142" y="183" fill="var(--ink-soft)">586 tok/s(含 g128 scale)</text>
  </g>
  <line x1="80" y1="40" x2="80" y2="200" stroke="var(--rule)"/>
  <text x="20" y="232" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">条长 = 每步要从 HBM 搬的字节。搬得少,步就短,tok/s 就高。算力一个字都没提。</text>
</svg>
<figcaption>同一个模型、同一张卡,只改权重格式。条形长度是 decode 每步必须搬的字节数,右边是由它直接除出来的上限。这张图里没有任何算力数字,因为 decode 的瓶颈不在算。</figcaption>
</figure>

三个附带的结论,都能从这张表读出来:

**量化对 prefill 没有这种收益。**prefill 是 compute-bound,时间花在算不在搬,权重搬得再少也不影响算的时间。而且 int4 权重进 tensor core 之前要先乘 scale 还原成 fp16(这叫反量化,dequantize),这一步是额外的计算。所以量化模型的 prefill 有时反而比 fp16 慢一点。这是 Day 5 那句「先问帮的是 prefill 还是 decode」的又一个例子。

**加 batch 会吃掉量化的收益。**batch 加到 32 时算术强度到了 32(fp16),int4 的话是 128,已经接近 ridge point 153。再往上加,瓶颈转到算力,而反量化的额外计算这时候开始碍事。所以量化的最佳场景是低 batch 的 decode,高吞吐服务里收益会缩水。M2 W7 测量化三角时,要在不同 batch 下各测一遍。

**KV cache 也能量化。**上表只动了权重。Day 5 算过 batch 32 × 2048 时 KV cache 32 GB 比权重还大,把 KV cache 从 fp16 压到 fp8 或 int8 能直接省一半显存,也就能装下更多请求。vLLM 有 `--kv-cache-dtype fp8` 这个选项,M3 读源码时会遇到。

## 精度损失怎么衡量

格式压得越狠,丢的信息越多。丢多少算可以接受,今天只讲衡量的方法,不下结论。

第一种是**perplexity**(困惑度),在一段固定文本上算模型对每个 token 的平均「意外程度」,数值越低越好。fp16 是基线,int8 通常几乎不变,int4 涨零点几到一两个百分点。它便宜、可复现,是论文里的标准指标。

第二种是**真实任务的准确率**,比如一组数学题、代码题、多选题,量化前后各跑一遍看分数。它贵,但更接近实际使用。

路线图 M3 那条「精度要用真实任务测,不能只看 perplexity」的原因是:perplexity 是平均值,量化损伤往往集中在少数难 token 上,平均值看不出来,但恰恰是那些 token 决定一道推理题答对还是答错。W7 做量化三角的时候,两种都要测。

顺手记一个表,以后对照:

| 格式 | 相对精度(相邻数间距) | 大致十进制有效位 |
| --- | --- | --- |
| fp32 | 2⁻²³ ≈ 1.2 × 10⁻⁷ | 7 |
| tf32 / fp16 | 2⁻¹⁰ ≈ 9.8 × 10⁻⁴ | 3 |
| bf16 | 2⁻⁷ ≈ 7.8 × 10⁻³ | 2 到 3 |
| fp8 e4m3 | 2⁻³ = 0.125 | 1 |
| fp8 e5m2 | 2⁻² = 0.25 | 不到 1 |
| int8(每组一 scale) | 组内 max ÷ 127 | 取决于分布 |
| int4(每组一 scale) | 组内 max ÷ 7 | 取决于分布 |

## 在 Colab 上把这些格式摸一遍

不需要 GPU 也能做的练习,T4 上一样跑。目的是把「几位、多大、多细」从表格变成手感。

```python
import torch

# 1. 每种格式的极值和相邻间距(epsilon)
for dt in [torch.float32, torch.float16, torch.bfloat16]:
    fi = torch.finfo(dt)
    print(f"{str(dt):16s} bits={fi.bits:2d} max={fi.max:.3e} min_normal={fi.tiny:.3e} eps={fi.eps:.3e}")
# 预期:fp16 max 6.550e+04,bf16 max 3.389e+38 和 fp32 一样;eps 分别约 1.2e-7 / 9.8e-4 / 7.8e-3

# 2. fp16 溢出、bf16 不溢出
x = torch.tensor(70000.0)
print(x.to(torch.float16))    # 预期 inf
print(x.to(torch.bfloat16))   # 预期 69632.(精度粗了,但没溢出)

# 3. 精度差别:同一个数三种格式各是多少
v = torch.tensor(3.14159265)
print(v.half().item(), v.bfloat16().item(), v.item())
# 预期 3.140625 / 3.140625 / 3.1415927,注意 bf16 的 7 位尾数在这个量级上正好和 fp16 撞到同一个格子

# 4. 这张卡支持什么
print(torch.cuda.get_device_name(), torch.cuda.get_device_capability(), torch.cuda.is_bf16_supported())
# T4 预期:(7, 5) False;A100:(8, 0) True

# 5. 手工做一次 int8 对称量化,看误差
w = torch.randn(128) * 0.02          # 模拟一组权重
scale = w.abs().max() / 127
q = torch.round(w / scale).clamp(-128, 127).to(torch.int8)
w_hat = q.float() * scale
print("int8 相对误差:", ((w_hat - w).abs().mean() / w.abs().mean()).item())
# 预期在 0.5% 到 1% 量级

# 6. 同一组做 int4,再往里塞一个 outlier 看误差怎么炸
def quant_err(w, qmax):
    scale = w.abs().max() / qmax
    w_hat = torch.round(w / scale).clamp(-qmax - 1, qmax) * scale
    return ((w_hat - w).abs().mean() / w.abs().mean()).item()
print("int4:", quant_err(w, 7))
w_out = w.clone(); w_out[0] = 0.5      # 一个比别人大 25 倍的 outlier
print("int4 + outlier:", quant_err(w_out, 7))
# 预期:int4 误差在百分之几,加了 outlier 后跳到几十个百分点,因为 scale 被撑大,正常权重全挤进 0 和 ±1
```

跑完把实际数字填进这张表,以后翻回来对照:

| 项 | 预期 | 实测(留空) |
| --- | --- | --- |
| fp16 max | 65504 | |
| bf16 max | 3.39e38 | |
| fp16 eps | 9.77e-4 | |
| bf16 eps | 7.81e-3 | |
| 70000 转 fp16 | inf | |
| 这张卡的 compute capability | T4 (7,5) | |
| is_bf16_supported | T4 False | |
| int8 相对误差 | ~0.5–1% | |
| int4 相对误差 | ~几 % | |
| int4 + outlier 相对误差 | 几十 % | |

第 6 步是今天最值得停下来看的一个数。它用二十行代码演示了 LLM.int8、GPTQ、AWQ 三篇论文共同要解决的问题:一个 outlier 就能毁掉一组的量化精度。W7 再遇到「per-channel」「group size」「activation-aware」这些词,全是冲着这一个数来的。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 符号位 / 指数位 / 尾数位 | 浮点数的三段。符号管正负,指数管数量级也就是范围,尾数管有效数字也就是精度 |
| fp32 | 1+8+23 位,IEEE 单精度,范围 3.4e38,7 位有效数字 |
| fp16 | 1+5+10 位,IEEE 半精度,最大 65504,3 位有效数字。Llama-2 官方权重的格式 |
| bf16 | 1+8+7 位,范围同 fp32、精度比 fp16 粗 8 倍,训练主流。Ampere 起有硬件支持 |
| tf32 | 1+8+10 位,存 32 位算 19 位,只在 tensor core 内部用,让 fp32 矩阵乘走 tensor core |
| fp8 e4m3 / e5m2 | 两种 8 位浮点,e4m3 范围窄精度好给权重激活,e5m2 范围宽精度差给梯度。Hopper 起支持 |
| int8 / int4 | 8 位、4 位有符号整数,等间距,靠外置 scale 还原,是量化的存储格式 |
| 非正规数(subnormal) | 指数用到最小值后靠尾数继续表示更小的数,精度逐渐变差,fp16 里从 6.1e-5 到 6e-8 那段 |
| eps(machine epsilon) | 1 和比 1 大的下一个可表示数之差,等于 2 的负尾数位数次方,衡量相对精度 |
| 溢出 / 下溢 | 数超过格式的最大值变成 inf / 小于最小值变成 0 |
| loss scaling | fp16 训练时把 loss 乘一个大数再反传,让小梯度不下溢,算完再除回去 |
| 混合精度 | 前向反向用 fp16 或 bf16,权重主副本和优化器状态留 fp32 |
| 量化(quantization) | 把浮点权重映射到低位整数存储,用时乘 scale 还原 |
| scale / zero point | 量化的缩放系数和零点偏移,每组权重各配一份,通常 fp16 |
| group size | 多少个权重共用一个 scale,常见 128。越小精度越好、额外字节越多 |
| 反量化(dequantize) | 用时把整数乘 scale 还原成浮点,是量化模型 prefill 变慢的原因 |
| outlier | 一组数里显著偏大的少数值,会把 scale 撑大、挤压其他数的精度 |
| perplexity | 困惑度,模型在固定文本上平均「意外程度」的指数,量化精度的廉价指标 |
| compute capability | NVIDIA 给每代架构的版本号,T4 7.5、A100 8.0、H100 9.0,决定支持哪些格式 |

## 常见误区

**以为 fp16 和 bf16 只是名字不同、可以随便换。**它们范围差 33 个数量级(65504 对 3.4e38),精度差 8 倍。用 bf16 训的模型转 fp16 可能溢出成 inf,用 fp16 的模型转 bf16 会损失精度。加载时看模型卡写的是哪种,T4 上没得选只能 fp16,那就要留意输出有没有异常。

**在 T4 上用 bf16 加载模型,以为「能跑就是支持」。**PyTorch 可能在没有硬件支持时用 fp32 模拟,不报错但走 8.1 TFLOP/s 的低屋顶,慢好几倍。测出来的数字会毫无道理地差,先查 `torch.cuda.is_bf16_supported()`。

**认为量化提速是因为「整数运算比浮点快」。**不是。decode 的提速全部来自字节变少、搬得快,和运算类型无关;实际上 int4 权重用之前还要反量化成 fp16 再进 tensor core,算得更多而不是更少。这也是量化对 compute-bound 的 prefill 没帮助甚至有害的原因。

**看到「4-bit 模型」就按 0.5 字节算显存。**每组权重要配一个 fp16 的 scale,有的还带 zero point,实际每权重 4.1 到 4.5 位。算显存时按 0.55 到 0.6 字节估更保险,加上 KV cache 和框架开销照 Day 5 的四项一起算。

**用 perplexity 一个数判断量化「没损失」。**perplexity 是全文平均,量化损伤集中在少数难 token 上,平均值看不出来。要在真实任务上再测一遍,尤其是需要多步推理的任务。

**把 tf32 当成一种省显存的格式。**tf32 在内存里还是 32 位,不省字节不省带宽,它只是让 fp32 矩阵乘能走 tensor core。它影响的是 Day 14 测 fp32 算力时的数字,不影响任何显存估算。

## 参考资料

### 论文

- Micikevicius 等,《Mixed Precision Training》,2017。fp16 训练和 loss scaling 的原始出处,读第 3 节就够。https://arxiv.org/abs/1710.03740
- Micikevicius 等,《FP8 Formats for Deep Learning》,2022。e4m3 和 e5m2 两种分法为什么这样分、各给谁用。https://arxiv.org/abs/2209.05433
- Dettmers 等,《LLM.int8(): 8-bit Matrix Multiplication for Transformers at Scale》,2022。发现 LLM 激活里的系统性 outlier,今天练习第 6 步的理论版。https://arxiv.org/abs/2208.07339
- Frantar 等,《GPTQ: Accurate Post-Training Quantization for Generative Pre-trained Transformers》,2022。M2 W7 要跑的两种量化之一,现在只读摘要。https://arxiv.org/abs/2210.17323
- Lin 等,《AWQ: Activation-aware Weight Quantization for LLM Compression and Acceleration》,2023。另一种,同样只读摘要,看它和 GPTQ 对 outlier 的处理思路有什么不同。https://arxiv.org/abs/2306.00978

### 文档与文章

- Google Cloud,《BFloat16: The secret to high performance on Cloud TPUs》。bf16 的设计动机,为什么保留 8 位指数。https://cloud.google.com/blog/products/ai-machine-learning/bfloat16-the-secret-to-high-performance-on-cloud-tpus
- Wikipedia,bfloat16 floating-point format。位分配、极值、和 fp16 的逐项对比表,查数字用。https://en.wikipedia.org/wiki/Bfloat16_floating-point_format
- PyTorch 文档,Numerical accuracy。tf32 开关、bf16 支持判断、不同 dtype 下 matmul 精度行为的官方说明。https://pytorch.org/docs/stable/notes/numerical_accuracy.html
- NVIDIA Ampere Architecture Whitepaper。第 3 章列出每代 tensor core 支持的格式和各格式的峰值算力,今天那张「哪代支持什么」的表的出处。https://images.nvidia.com/aem-dam/en-zz/Solutions/data-center/nvidia-ampere-architecture-whitepaper.pdf
- HuggingFace Transformers 文档,Quantization overview。目前主流量化方案(GPTQ、AWQ、bitsandbytes 等)的一页对比,W7 选方案前看。https://huggingface.co/docs/transformers/main/en/quantization/overview
- ZOMI酱《AI 系统》开源课 · 数据单位:比特位。中文,讲 int8/fp16/bf16/tf32 在 AI 芯片里各自的作用。https://github.com/Infrasys-AI/AISystem/blob/main/02Hardware/01Foundation/06BitWidth.md
- float.exposed。一个网页,点任意一位看浮点数怎么变,fp16、bf16、fp32 都能切,建立手感最快的工具。https://float.exposed/

### 视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1WT411k724&autoplay=0&high_quality=1" title="int8/fp16/bf16/tf32在AI芯片中什么作用?【AI芯片】AI计算体系06" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>ZOMI酱 · 《int8/fp16/bf16/tf32在AI芯片中什么作用?【AI芯片】AI计算体系06》· 约 13 分钟。全看。位分配、范围精度取舍、为什么 AI 芯片要同时支持这么多种,和今天的内容一一对应,而且是中文。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/bbkcEiUjehk" title="How Floating-Point Numbers Are Represented" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Spanning Tree · 《How Floating-Point Numbers Are Represented》。十几分钟把符号、指数、尾数三段讲透,包括为什么格子在大数处变疏。如果「相对精度恒定」这句还没画面,看这个。</figcaption>
</figure>

- Computerphile,《Floating Point Numbers》,YouTube PZRI1IfStY0。更口语化的版本,讲 0.1 + 0.2 为什么不等于 0.3,顺带把浮点的本质说清楚。
- The ML Tech Lead,《What are Float32, Float16 and BFloat16 Data Types?》,YouTube 7q1Gh1KOlzw。专门对比三种格式在深度学习里的取舍,十分钟。

## 自测

合上笔记做。第 5 题算不出来,今天就算没过。

1. fp16 和 bf16 都是 16 位,位怎么分的?各自的最大值和相对精度是多少?为什么训练更爱 bf16?

<details><summary>答案</summary>

fp16:1 + 5 + 10,最大 65504,相对精度 2⁻¹⁰ ≈ 1e-3。bf16:1 + 8 + 7,最大 3.4e38(和 fp32 一样),相对精度 2⁻⁷ ≈ 8e-3。

训练最怕溢出:attention 分数、梯度、loss 的动态范围大,fp16 的 65504 一撞就是 inf,然后 NaN。bf16 范围和 fp32 一样不用 loss scaling;精度粗 8 倍神经网络不敏感。另外 fp32 转 bf16 只要截掉低 16 位,极便宜。

</details>

2. 在 T4 上用 `torch_dtype=torch.bfloat16` 加载模型会发生什么?怎么在跑之前就知道?

<details><summary>答案</summary>

Turing 的 tensor core 没有 bf16 电路。要么某些 cuBLAS 路径直接报错,要么 PyTorch 用 fp32 CUDA core 模拟,能跑但走 8.1 TFLOP/s 的低屋顶而不是 65 TFLOP/s 的 tensor core,慢好几倍且不报错。

提前查:`torch.cuda.is_bf16_supported()` 返回 False,或 `torch.cuda.get_device_capability()` 返回 (7, 5),小于 8.0 就没有 bf16 tensor core。T4 上一律用 fp16。

</details>

3. tf32 是几位?它省显存吗?它影响 Day 14 测算力的哪个数?

<details><summary>答案</summary>

1 + 8 + 10 = 19 位,但在内存里仍按 32 位存,tensor core 计算时只读前 19 位。不省显存也不省带宽,只是让 fp32 矩阵乘能走 tensor core。

Day 14 用 fp32 张量测 matmul 时,`allow_tf32` 关着测到的是 19.5 TFLOP/s(CUDA core),开着是 156 TFLOP/s(tf32 tensor core),两个都不是 fp16 的 312。

</details>

4. int8 量化怎么用 256 个整数表示一组 fp16 权重?一个 outlier 为什么能毁掉整组的精度?

<details><summary>答案</summary>

找出这组权重的绝对值最大值 max,scale = max ÷ 127,每个权重除以 scale 后四舍五入到 -128 到 127 之间的整数存起来,用时乘回 scale。

格子是等间距的,间距 = scale。一个 outlier 把 max 撑大 25 倍,scale 就大 25 倍,间距也大 25 倍,原本正常大小的权重全部落进 0、±1 这两三个格子里,信息几乎全丢。练习第 6 步的误差从几个百分点跳到几十个百分点就是这个。

</details>

5. Llama-2-7B(6.74B 参数)在 A100(2039 GB/s)上,权重分别为 fp16、int8、int4(每 128 个一组 fp16 scale)时,decode batch 1 的理论上限各是多少?量化挪的是 roofline 上的什么?

<details><summary>答案</summary>

fp16:6.74e9 × 2 B = 13.5 GB,÷ 2039 GB/s = 6.6 ms,约 151 tok/s。
int8:6.74 GB,3.3 ms,约 302 tok/s。
int4 + g128 scale:每权重 0.5 + 2/128 ≈ 0.516 B,共 3.48 GB,1.7 ms,约 586 tok/s。

挪的是算术强度:每参数字节从 2 变 1 变 0.5,FLOP 不变还是 2,强度从 1 变 2 变 4,点沿着 HBM 那条斜线往右上挪,可达算力成倍增加。算力屋顶一点没动。

</details>

6. 量化对 prefill 有同样的加速吗?batch 开大以后量化的收益怎么变?

<details><summary>答案</summary>

没有。prefill 是 compute-bound,时间花在算不在搬,权重字节少了不影响;而且 int4 权重进 tensor core 前要反量化成 fp16,多了一步计算,prefill 可能反而慢一点。

batch 加大时算术强度本身就在涨(fp16 batch 32 是 32,int4 是 128),接近 ridge point 153 后瓶颈转向算力,反量化的额外计算开始碍事,量化收益缩水。量化最适合低 batch 的 decode。

</details>

## 明天预告

Day 27 讲 CUDA 执行模型:一个 kernel 怎么被切成 grid、block、thread,warp 为什么是 32 个线程一起动,stream 是什么,以及一次 kernel launch 到底要花几微秒。Day 11 在 timeline 上看到的那些 gap,和 Day 25 里 SM 的 warp scheduler,明天会接到一起:为什么 decode 一步要发几十个小 kernel,为什么这件事在 batch 1 时特别伤,以及 CUDA graph 是怎么把它们一次打包发出去的。这也是 M5 学 Triton 前必须有的那张地图,Triton 隐藏的正是 thread 这一层。
