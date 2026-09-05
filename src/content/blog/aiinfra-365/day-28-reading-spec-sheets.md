---
title: 'Day 28 · 怎么读一张 GPU 规格表：dense 与 sparse、SXM 与 PCIe、NVLink 与 $/token'
description: 'A100 宣传页写 624 TFLOPS，Day 5 用的却是 312；同样叫 A100 80GB，SXM 和 PCIe 的带宽差 5%，ridge point 一个 153 一个 161；NVLink 和 PCIe 差十倍。把规格表上每个会骗人的数字过一遍，最后把小时价换算成每一百万 token 多少钱，看 batching 在账单上是多大的杠杆。'
pubDate: 2026-09-05
regime: compute
tags: ['spec-sheet', 'a100', 'h100', 't4', 'nvlink', 'cost', 'aiinfra-365']
series: 'aiinfra-365'
day: 28
lang: 'zh'
---

## 今天要解决的问题

W1 到 W3 用了好几个规格数字：A100 的 312 TFLOP/s 和 2039 GB/s，T4 的 65 TFLOP/s 和 320 GB/s。这些数当时是直接给的，今天回头看它们从哪来，以及规格表上和它们挨着的那些**更大**的数字为什么不能用。

一张 GPU 规格表上至少有四个地方会让人拿错数：

1. TFLOPS 后面带星号的那个数是另一个数的两倍，星号指的是「结构化稀疏」，推理时几乎用不上。
2. 同一个型号有 SXM 和 PCIe 两种封装，带宽、功耗、互联全不一样，规格表通常并排列出，很容易看串行。
3. TFLOPS 前面的精度标签：FP64、FP32、TF32、FP16、BF16、INT8、FP8，每行差一倍到几十倍，拿 FP32 的数去比 FP16 的实测就会觉得「怎么超过 100% 了」。
4. 显存容量和显存带宽是两个独立的数，80 GB 的卡不一定比 40 GB 的快，但 A100 恰好是。

今天结束时要能拿着任意一张卡的规格表，在两分钟内填出 Day 5 那张表需要的四个数：峰值算力（对的那个）、显存带宽（对的那个版本）、ridge point、decode 理论上限。最后加一步把小时价换成 $/1M token，因为面试里「你这个方案每百万 token 多少钱」是比 TFLOPS 更常被问的数。

数字口径不变：Llama-2-7B fp16 权重 13.5 GB，TinyLlama-1.1B fp16 权重 2.2 GB。今天所有规格数字都来自 NVIDIA 官方页面和数据手册，参考资料里给链接，我核对过。

## 先把一张表放在眼前

A100 80GB 的官方规格表大致是下面这个样子（按 NVIDIA 数据手册整理，顺序和原表一致，SXM 和 PCIe 并排）：

| 规格项 | A100 80GB PCIe | A100 80GB SXM |
| --- | --- | --- |
| FP64 | 9.7 TFLOPS | 9.7 TFLOPS |
| FP64 Tensor Core | 19.5 TFLOPS | 19.5 TFLOPS |
| FP32 | 19.5 TFLOPS | 19.5 TFLOPS |
| TF32 Tensor Core | 156 TFLOPS \| 312 TFLOPS* | 同左 |
| BFLOAT16 Tensor Core | 312 TFLOPS \| 624 TFLOPS* | 同左 |
| FP16 Tensor Core | 312 TFLOPS \| 624 TFLOPS* | 同左 |
| INT8 Tensor Core | 624 TOPS \| 1248 TOPS* | 同左 |
| GPU Memory | 80 GB HBM2e | 80 GB HBM2e |
| GPU Memory Bandwidth | 1,935 GB/s | 2,039 GB/s |
| Max Thermal Design Power | 300 W | 400 W |
| Interconnect | NVLink Bridge for 2 GPUs: 600 GB/s；PCIe Gen4: 64 GB/s | NVLink: 600 GB/s；PCIe Gen4: 64 GB/s |
| Form Factor | PCIe，双槽风冷或单槽液冷 | SXM |
| Multi-Instance GPU | 最多 7 个 MIG，每个 10 GB | 同左 |

表末尾有一行小字：`* With sparsity`。整张表最容易踩的坑就藏在这行小字里。

下面按四个陷阱逐个拆。

## 陷阱一：带星号的数字，dense 与 sparse

BF16 那一行写着 `312 TFLOPS | 624 TFLOPS*`。312 是 dense，稠密；624 是 sparse，稀疏，带星号。宣传页和新闻稿爱用 624，因为大。

624 的来历：Ampere 架构的 tensor core 支持一种叫 2:4 结构化稀疏的模式，权重矩阵每连续 4 个数里必须恰好有 2 个是零，硬件就可以跳过那两个零，同样时间做两倍的有效乘加。前提是**你的权重真的按这个模式剪过**，每 4 个里精确 2 个零，位置还要按硬件要求存。

一个正常训练出来的 Llama-2-7B，权重是稠密的，没有一个矩阵满足 2:4。要用上 624，得先做结构化剪枝，把一半参数硬剪成零，然后微调把精度找回来。这是一个单独的研究方向，生产推理里很少见。所以做推理估算，**一律用不带星号的 dense 数**。Day 5 用 312 就是这个原因。

T4 的规格表里没有这种星号，因为 Turing 架构的 tensor core 没有稀疏加速；T4 的 65 TFLOPS 就是 dense。H100 的规格表里星号又出现了，而且更夸张：

| 卡 | FP16/BF16 Tensor Core dense | 带星号 sparse | 星号是 dense 的几倍 |
| --- | --- | --- | --- |
| T4 | 65 TFLOPS | 无 | — |
| A100 | 312 TFLOPS | 624 TFLOPS | 2× |
| H100 SXM | 989 TFLOPS | 1,979 TFLOPS | 2× |
| H100 SXM，FP8 | 1,979 TFLOPS | 3,958 TFLOPS | 2× |

H100 宣传里常见的「4 PFLOPS」就是 FP8 sparse 那个 3958，离一个 BF16 dense 推理能用的 989 差了四倍。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="A100 与 H100 的 FP16 Tensor Core 算力，dense 和 sparse 对比条形图">
  <text x="12" y="20" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">FP16/BF16 Tensor Core 峰值算力（TFLOPS）：能用的是实心那条</text>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="12" y="62" fill="var(--ink)">T4</text>
    <rect x="120" y="50" width="16" height="16" fill="var(--compute)"/>
    <text x="142" y="63" fill="var(--ink-soft)">65 dense（Turing 无 sparsity）</text>

    <text x="12" y="108" fill="var(--ink)">A100</text>
    <rect x="120" y="96" width="79" height="16" fill="var(--compute)"/>
    <text x="205" y="109" fill="var(--ink-soft)">312 dense</text>
    <rect x="120" y="116" width="158" height="16" fill="var(--compute-wash)" stroke="var(--compute)" stroke-dasharray="3 2"/>
    <text x="284" y="129" fill="var(--ink-faint)">624 sparse*</text>

    <text x="12" y="174" fill="var(--ink)">H100 SXM</text>
    <rect x="120" y="162" width="250" height="16" fill="var(--compute)"/>
    <text x="376" y="175" fill="var(--ink-soft)">989 dense</text>
    <rect x="120" y="182" width="500" height="16" fill="var(--compute-wash)" stroke="var(--compute)" stroke-dasharray="3 2"/>
    <text x="376" y="195" fill="var(--ink-faint)">1,979 sparse*</text>
  </g>
  <line x1="120" y1="40" x2="120" y2="210" stroke="var(--rule)"/>
  <text x="12" y="238" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">比例尺：1 px ≈ 4 TFLOPS。虚线框 = 要求权重按 2:4 结构化稀疏剪过才能达到，普通 LLM 推理用不上。</text>
  <text x="12" y="254" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">出处：NVIDIA A100 / H100 / T4 官方规格页与数据手册。</text>
</svg>
<figcaption>实心条是 dense，做推理估算用它。虚线框是带星号的 sparse，整整两倍，但要权重先剪成 2:4 稀疏才存在。宣传页几乎只写虚线框那个数。</figcaption>
</figure>

## 陷阱二：同名不同卡，SXM 与 PCIe

同一张表里 A100 80GB 有两列。PCIe 版是插在主板 PCIe 插槽上的标准显卡形态；SXM 版是一块裸模组，直接焊在 NVIDIA 自己的 HGX 主板上，没法插进普通服务器。两者芯片一样，SM 数一样，tensor core 峰值算力一样，但有三处不同：

| 项 | PCIe | SXM | 差多少 |
| --- | --- | --- | --- |
| 显存带宽 | 1,935 GB/s | 2,039 GB/s | SXM 高 5% |
| 功耗上限 TDP | 300 W | 400 W | SXM 高 33% |
| 卡间互联 | NVLink 桥只能连 2 张，600 GB/s；其余走 PCIe 64 GB/s | 板上 NVLink 全连，600 GB/s | 拓扑不同 |

带宽差 5% 直接改 Day 5 的两个数。用 PCIe 版重算：

```
decode 下限：13.5 GB ÷ 1935 GB/s ≈ 6.98 ms   （SXM 是 6.62 ms）
ridge point：312e12 ÷ 1935e9 ≈ 161 FLOP/byte   （SXM 是 153）
```

这就是 Day 5 顺口提的那句「用 PCIe 版算是 161」。差别不大，但要知道自己在用哪个数，写报告时标清楚版本。

功耗差 100 W 影响的是**持续**性能。峰值算力两版一样，但 300 W 的 PCIe 版在持续高负载下更容易撞到功耗墙降频，Day 14 实测 matmul 时 PCIe 版能打到的百分比一般比 SXM 版低几个点。这也是 Day 17 说「标称达不到」的原因之一，功耗墙是物理的，规格表上不会写。

互联差异到 M9 多卡才要紧，下面单独讲。

H100 的两版差得更多，因为不只是功耗，显存类型都不一样：

| 项 | H100 PCIe | H100 SXM |
| --- | --- | --- |
| FP16 Tensor Core dense | 756 TFLOPS | 989 TFLOPS |
| 显存 | 80 GB HBM2e | 80 GB HBM3 |
| 显存带宽 | 2.0 TB/s | 3.35 TB/s |
| TDP | 300–350 W | 最高 700 W |
| NVLink | 600 GB/s | 900 GB/s |

H100 PCIe 的带宽 2.0 TB/s 和 A100 SXM 的 2039 GB/s 几乎一样，算力却高两倍多。按 ridge point 算：756e12 ÷ 2.0e12 ≈ 378，比 A100 的 153 高一倍多。意思是同样的 decode workload，在 H100 PCIe 上离 compute-bound 更远，需要更大的 batch 才能把算力用起来。**卡越新，ridge point 越高，memory-bound 的问题越严重，不是越轻。** 这条和直觉相反，是买卡、租卡时要记住的。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="A100 PCIe 与 SXM、H100 PCIe 与 SXM 的显存带宽对比条形图">
  <text x="12" y="20" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">显存带宽（GB/s）：同一个名字，两个数</text>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="12" y="56" fill="var(--ink)">T4 (GDDR6)</text>
    <rect x="130" y="44" width="48" height="16" fill="var(--mem)"/>
    <text x="184" y="57" fill="var(--ink-soft)">320</text>

    <text x="12" y="92" fill="var(--ink)">A100 PCIe</text>
    <rect x="130" y="80" width="290" height="16" fill="var(--mem)" opacity="0.6"/>
    <text x="426" y="93" fill="var(--ink-soft)">1,935 → ridge 161</text>
    <text x="12" y="116" fill="var(--ink)">A100 SXM</text>
    <rect x="130" y="104" width="306" height="16" fill="var(--mem)"/>
    <text x="442" y="117" fill="var(--ink-soft)">2,039 → ridge 153</text>

    <text x="12" y="156" fill="var(--ink)">H100 PCIe</text>
    <rect x="130" y="144" width="300" height="16" fill="var(--mem)" opacity="0.6"/>
    <text x="436" y="157" fill="var(--ink-soft)">2,000 → ridge 378</text>
    <text x="12" y="180" fill="var(--ink)">H100 SXM</text>
    <rect x="130" y="168" width="502" height="16" fill="var(--mem)"/>
    <text x="440" y="200" fill="var(--ink-soft)">3,350 → ridge 295</text>
  </g>
  <line x1="130" y1="36" x2="130" y2="212" stroke="var(--rule)"/>
  <text x="12" y="232" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">比例尺：1 px ≈ 6.7 GB/s。浅色 = PCIe，深色 = SXM。ridge = 该版本 FP16 dense 算力 ÷ 该版本带宽。</text>
  <text x="12" y="246" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">T4 的 ridge 是 65e12 ÷ 320e9 ≈ 203；卡越新 ridge 越高，decode 离屋顶越远。</text>
</svg>
<figcaption>同一个型号，SXM 版的带宽总比 PCIe 版高，H100 上差 68%。规格表并排列出两版，报告里必须写清用的是哪一版的数。</figcaption>
</figure>

## 陷阱三：TFLOPS 前面的精度标签

规格表上 TFLOPS 那几行，每一行前面都有一个精度名。A100 从 FP64 的 9.7 到 INT8 的 624，差 64 倍，全是同一张卡。拿错行的典型症状是 Day 14 实测 matmul 时「算出来 40 TFLOPS，超过标称的 19.5 了」，那是拿 fp16 tensor core 的实测去比了 FP32 的标称。

按 Day 26 讲的数值格式，把 A100 那几行对上号：

| 规格表行 | 用的是哪个格式 | 走不走 tensor core | A100 dense 值 | 什么时候是它 |
| --- | --- | --- | --- | --- |
| FP64 | 双精度浮点 | 否 | 9.7 TFLOPS | 科学计算，和 LLM 无关 |
| FP64 Tensor Core | 双精度 | 是 | 19.5 TFLOPS | 同上 |
| FP32 | 单精度，CUDA core | 否 | 19.5 TFLOPS | `torch.float32` 且关掉 TF32 时的 matmul |
| TF32 Tensor Core | Day 26 讲的 tf32，fp32 输入截尾数走 tensor core | 是 | 156 TFLOPS | `torch.float32` 且 `allow_tf32=True`（PyTorch 对 matmul 默认关，对卷积默认开） |
| BF16 / FP16 Tensor Core | 半精度 | 是 | 312 TFLOPS | 推理默认。**Day 5、Day 14 用的这行** |
| INT8 Tensor Core | 8 位整数 | 是 | 624 TOPS | 量化到 int8 的 matmul，M2 W7 会碰 |

两条实用规则：

- 做 LLM 推理估算，**看 FP16/BF16 Tensor Core 的 dense 值**，其他行先不看。
- Day 14 测算力时，tensor 的 dtype 决定了该对哪一行。`torch.float16` 对 312；`torch.float32` 默认对 19.5，开了 TF32 对 156。测出来「超标」，先查 dtype。

T4 上还有一个额外的坑：它的规格表有 FP16 65 TFLOPS 和 INT8 130 TOPS，但没有 BF16 那一行，因为 Turing 不支持 bf16（Day 7 踩过）。规格表没那一行，就是硬件没那个能力，不是漏写。

## 卡和卡之间：NVLink 与 PCIe

规格表里 Interconnect 那一行，今天之前一直跳过。M9 之前单卡够用，但这一行决定了 M9 多卡训练和 M3 W13 那次两卡 tensor parallel 实验的结果，先把量级建立起来。

两张卡之间传数据有两条路：走主板上的 PCIe 总线，或者走 NVIDIA 专有的 NVLink。

| 互联 | 带宽（双向合计） | 出处 |
| --- | --- | --- |
| PCIe Gen3 x16（T4 用的） | 32 GB/s | PCIe 规范 |
| PCIe Gen4 x16（A100 用的） | 64 GB/s | A100 规格表 |
| PCIe Gen5 x16（H100 用的） | 128 GB/s | H100 规格表 |
| NVLink 第三代（A100） | 600 GB/s | A100 规格表 |
| NVLink 第四代（H100） | 900 GB/s | H100 规格表 |

A100 上 NVLink 是 PCIe 的 600 ÷ 64 ≈ 9.4 倍。这个「差一个数量级」是记住它的方式。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="PCIe Gen4、Gen5 与 NVLink 3、4 的双向带宽对比，以及 HBM 带宽作参照">
  <text x="12" y="20" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">卡间互联带宽（GB/s，双向合计），最下一行放 HBM 做参照</text>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="12" y="54" fill="var(--ink)">PCIe 4 x16</text>
    <rect x="130" y="42" width="10" height="16" fill="var(--compute)"/>
    <text x="146" y="55" fill="var(--ink-soft)">64（A100 PCIe 之间只有这条路）</text>

    <text x="12" y="84" fill="var(--ink)">PCIe 5 x16</text>
    <rect x="130" y="72" width="19" height="16" fill="var(--compute)"/>
    <text x="155" y="85" fill="var(--ink-soft)">128</text>

    <text x="12" y="114" fill="var(--ink)">NVLink 3</text>
    <rect x="130" y="102" width="90" height="16" fill="var(--compute)"/>
    <text x="226" y="115" fill="var(--ink-soft)">600（A100 SXM）≈ 9.4 × PCIe 4</text>

    <text x="12" y="144" fill="var(--ink)">NVLink 4</text>
    <rect x="130" y="132" width="135" height="16" fill="var(--compute)"/>
    <text x="271" y="145" fill="var(--ink-soft)">900（H100 SXM）</text>

    <text x="12" y="184" fill="var(--ink)">HBM (A100 SXM)</text>
    <rect x="130" y="172" width="306" height="16" fill="var(--mem)"/>
    <text x="442" y="185" fill="var(--ink-soft)">2,039（卡内自己的显存）</text>
  </g>
  <line x1="130" y1="34" x2="130" y2="196" stroke="var(--rule)"/>
  <text x="12" y="216" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">比例尺：1 px ≈ 6.7 GB/s，与上一张图相同。卡间最快的 NVLink 也只有卡内 HBM 的 30%；PCIe 只有 3%。</text>
</svg>
<figcaption>把互联带宽和 HBM 画在同一比例尺上：NVLink 是 HBM 的三成，PCIe 是 HBM 的三个百分点。任何要在卡之间搬数据的方案，都是在用这两条细管子。</figcaption>
</figure>

为什么这个差别到 M9 会变成大事，用 Day 2 的形状算一笔。tensor parallel 把一层的矩阵按列切到两张卡上，每层算完要把两张卡的结果合起来（all-reduce）。7B 模型 d = 4096，batch 32 decode 时每层要合的向量是 32 × 4096 个 fp16，也就是 256 KB，一层两次（attention 后一次、FFN 后一次），32 层共 64 次，一步 decode 要在卡间搬约 16 MB。

```
走 NVLink：16 MB ÷ 600 GB/s ≈ 0.027 ms
走 PCIe 4： 16 MB ÷ 64 GB/s  ≈ 0.25 ms
```

对比 Day 5 算的单步 6.6 ms，NVLink 那 0.027 ms 可以忽略，PCIe 的 0.25 ms 是 4%，还能接受。但这只是 decode batch 32 的通信量；训练时每步要同步的是**全部梯度**，7B 模型 13.5 GB，走 PCIe 就是 13.5 ÷ 64 ≈ 0.21 秒，走 NVLink 是 0.023 秒。加上通信和计算之间能不能重叠，这就是 M9 W36 那条「实测 allreduce 带宽，算出通信占总时间多少」的来源。今天记住的只有一件事：**租多卡时看清楚卡之间是 NVLink 还是 PCIe**，租卡页面通常会标「NVLink」或者「SXM」，没标的默认是 PCIe。

## 陷阱四：容量与带宽是两个数

规格表上 GPU Memory 一行写容量，GPU Memory Bandwidth 另一行写带宽。它们是独立的，同一颗芯片配不同的 HBM 会得到不同的组合：

| 卡 | 容量 | 带宽 | 说明 |
| --- | --- | --- | --- |
| A100 40GB SXM | 40 GB HBM2 | 1,555 GB/s | 早期版本 |
| A100 80GB SXM | 80 GB HBM2e | 2,039 GB/s | 换了更快的 HBM2e，带宽也涨了 31% |
| H100 SXM | 80 GB HBM3 | 3,350 GB/s | |
| H200 SXM | 141 GB HBM3e | 4,800 GB/s | 和 H100 同一颗 GH100 芯片，只换了显存 |

对 decode 来说，容量决定「能不能装下、能开多大 batch」，带宽决定「一步多快」。A100 40GB 和 80GB 两个数都差，所以 80GB 版本的 decode 上限是 40GB 版本的 1.31 倍，不只是「装得更多」。H100 和 H200 算力完全一样，H200 只赢在显存，但对 memory-bound 的 decode 来说这恰恰是最值钱的那一项：同样的模型，H200 的单步时间是 H100 的 3350 ÷ 4800 ≈ 70%。

租卡时如果看到「A100 40GB」比「A100 80GB」便宜不少，先算一下：模型加 KV cache 装得下吗（Day 5 的四项账），装得下的话再看每小时价格除以带宽，看哪个每 GB/s 更便宜。

## 从小时价到 $/1M token

规格表读完，最后一步是把它接到账单上。租卡按小时计费，产出按 token 计数，中间的换算就是 Day 5 那条 decode 上限。

先说价格。云 GPU 的小时价变化很快，不同平台、spot 和 on-demand、社区机和数据中心机差好几倍。下面是 2026 年 9 月在 RunPod、Vast、Lambda 的价格页大致看到的区间，**写文时按页面核对，别把这张表当真数**：

| 卡 | 大致小时价（美元，spot 到 on-demand） | 备注 |
| --- | --- | --- |
| T4 16GB | 0.15–0.40 | Colab 免费给的就是它 |
| RTX 4090 24GB | 0.35–0.75 | 消费卡，无 NVLink，带宽 1,008 GB/s |
| A100 80GB | 1.2–2.0 | SXM 通常比 PCIe 贵一点 |
| H100 80GB SXM | 2.0–3.5 | |

然后是换算。A100 SXM 上 Llama-2-7B，Day 5 算出 batch 1 时 150 tok/s：

```
生成 1M token 要：1e6 ÷ 150 ≈ 6,667 s ≈ 1.85 h
按 $1.5/h：      1.85 × 1.5 ≈ $2.78 / 1M token
```

batch 32 时单步时间几乎不变（Day 5 已算，算力还藏在搬运时间里），吞吐是 32 × 150 = 4,800 tok/s：

```
1e6 ÷ 4,800 ≈ 208 s ≈ 0.058 h  →  0.058 × 1.5 ≈ $0.087 / 1M token
```

batch 拉到 ridge point 附近的 153，吞吐约 153 × 150 ≈ 23,000 tok/s（这已经是屋顶，再加 batch 每步开始变慢）：

```
1e6 ÷ 23,000 ≈ 43 s ≈ 0.012 h  →  0.012 × 1.5 ≈ $0.018 / 1M token
```

三个数摆一起：

| batch | 吞吐（tok/s） | $/1M token（按 $1.5/h） | 相对 batch 1 |
| --- | --- | --- | --- |
| 1 | 150 | 2.78 | 1× |
| 32 | 4,800 | 0.087 | 1/32 |
| 153（ridge） | ~23,000 | 0.018 | 1/153 |

**batching 在账单上是一百五十倍的杠杆。** 这就是 Day 0 那句「吞吐提升 3.2 倍、成本降 60%」的算法来源，也是为什么推理服务商的报价能到每百万 token 几美分，而自己 batch 1 跑同一个模型要几美元。前提是有足够多的并发请求把 batch 填满，这就把话题引到了 M2 W6 的 continuous batching。

同一套算式放到 Colab 的 T4 上：TinyLlama batch 1 理论 145 tok/s，按 $0.3/h：

```
1e6 ÷ 145 ≈ 6,897 s ≈ 1.92 h  →  1.92 × 0.3 ≈ $0.57 / 1M token
```

模型小了六倍、卡便宜了五倍，$/token 只便宜了五倍，因为 T4 的带宽也只有 A100 的六分之一。把 W2 实测的 TPOT 代进去（理论下限的 1.5–3 倍），真实的 $/token 还要再乘那个比值。这张表留着以后填：

| 场景 | 卡 | 小时价（实查） | 吞吐（实测 tok/s） | $/1M token |
| --- | --- | --- | --- | --- |
| TinyLlama batch 1 | T4 | | | |
| TinyLlama batch 32 | T4 | | | |
| 7B batch 1 | A100 | | | |
| 7B batch 32 | A100 | | | |

## 一张规格表的阅读清单

以后拿到任何一张卡的规格表，按这个顺序填：

1. **算力**：找 FP16 或 BF16 Tensor Core 那一行，取**不带星号**的 dense 值。看清是 SXM 还是 PCIe 列。
2. **带宽**：找 GPU Memory Bandwidth，取和第 1 步同一列的值。
3. **ridge point** = 第 1 步 ÷ 第 2 步。A100 SXM 153，PCIe 161，T4 203，H100 SXM 295。
4. **decode 上限** = 第 2 步 ÷ 模型权重字节数。这是 batch 1 的物理天花板。
5. **容量**：够不够装权重加 KV cache（Day 5 四项）。决定能开多大 batch。
6. **互联**：单卡忽略；多卡看 NVLink 还是 PCIe，差十倍。
7. **功耗**：只影响持续性能能打到标称的几成，Day 14、Day 17 实测时用来解释差距。
8. **价格**：小时价 ÷（吞吐 × 3600）× 1e6 = $/1M token。吞吐先用理论上限估，有实测换实测。

八步走完，Day 5 那张表就有了这张卡的版本。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| dense / sparse | 规格表上不带星号的算力是 dense，稠密矩阵能达到的峰值；带星号的 sparse 是 2:4 结构化稀疏下的两倍值，要权重先剪枝 |
| 2:4 structured sparsity | Ampere 起 tensor core 支持的稀疏模式，权重每 4 个连续元素恰有 2 个零，硬件跳过零得到两倍吞吐 |
| SXM | NVIDIA 数据中心 GPU 的模组封装，焊在 HGX 主板上，功耗上限高、带宽略高、NVLink 全连 |
| PCIe 版 | 插标准 PCIe 插槽的显卡形态，功耗上限低、带宽略低，卡间互联走 PCIe 或最多两卡 NVLink 桥 |
| TDP | Thermal Design Power，功耗上限。影响持续负载下会不会降频 |
| TF32 | 19 位浮点，fp32 输入截短尾数走 tensor core，A100 上 156 TFLOPS；PyTorch 对 matmul 默认关 |
| TOPS | tera operations per second，整数运算用 OPS 不用 FLOPS，INT8 那一行的单位 |
| NVLink | NVIDIA 专有的卡间高速互联，A100 600 GB/s，H100 900 GB/s |
| PCIe Gen4 x16 | 通用总线，64 GB/s 双向；A100 PCIe 版卡间默认走它 |
| all-reduce | 多卡把各自的部分结果求和再分发给所有卡的通信操作，tensor parallel 每层要做，训练每步要做 |
| HBM2 / HBM2e / HBM3 / HBM3e | 几代高带宽显存，A100 40GB 用 HBM2，A100 80GB 用 HBM2e，H100 用 HBM3，H200 用 HBM3e |
| MIG | Multi-Instance GPU，把一张 A100 切成最多 7 个独立小 GPU，各有自己的显存和 SM |
| $/1M token | 每生成一百万 token 的成本，= 小时价 ÷ (tok/s × 3600) × 1e6，推理服务最常用的成本口径 |

## 常见误区

**拿带星号的数做估算。** 624、1979、3958 这些数都要求 2:4 稀疏权重，正常训练出来的模型一个都不满足。看到规格表先找那行小字 `* with sparsity`，然后只看不带星号的列。

**把 SXM 和 PCIe 的数看串行。** 表格并排列出时很容易左边取一个右边取一个。A100 上算力两版相同、带宽不同，ridge point 一个 153 一个 161；H100 上算力和带宽都不同。报告里写「A100」不写版本，数字就没法核对。

**用 FP32 那一行去比 fp16 的实测。** 19.5 和 312 差 16 倍，实测 matmul 出来 200 TFLOPS 会以为「超标了十倍」。先看 tensor 的 dtype，再决定对哪一行。反过来，用 `torch.float32` 测出 19 TFLOPS 觉得「A100 怎么这么慢」，也是同一个错。

**以为新卡对 decode 一定更友好。** 卡越新 ridge point 越高（A100 153、H100 SXM 295、H100 PCIe 378），同样的 batch 在新卡上离屋顶更远，算力利用率更低。新卡的收益来自带宽涨了（单步更快）和算力涨了（prefill 更快），不是 decode 更接近 compute-bound。

**只看容量不看带宽，或者反过来。** A100 40GB 和 80GB 带宽差 31%，H100 和 H200 算力相同带宽差 43%。租卡前两个数都看，除以小时价比性价比。

**把云平台某一天的价格当常数。** spot 价格一天变几次，不同平台差两三倍。文章和报告里写价格要带日期和平台，最好直接写算式让读者自己代入。

## 参考资料

### 规格页与数据手册

- NVIDIA A100 Tensor Core GPU 产品页，规格表在页面下半部分，SXM 和 PCIe 并排。https://www.nvidia.com/en-us/data-center/a100/
- NVIDIA A100 80GB 数据手册 PDF，和本文第一张表逐行对应，含 `* with sparsity` 那行小字。https://www.nvidia.com/content/dam/en-zz/Solutions/Data-Center/a100/pdf/nvidia-a100-datasheet-us-nvidia-1758950-r4-web.pdf
- NVIDIA H100 Tensor Core GPU 产品页，SXM 与 PCIe 两版规格。https://www.nvidia.com/en-us/data-center/h100/
- NVIDIA T4 产品页，注意没有 BF16 那一行、没有 sparsity 星号。https://www.nvidia.com/en-us/data-center/tesla-t4/
- NVIDIA NVLink 产品页，各代 NVLink 的带宽。https://www.nvidia.com/en-us/data-center/nvlink/
- TechPowerUp GPU 数据库，A100 SXM4 80GB 页面。第三方整理的完整参数，含 SM 数、时钟、总线，核对官方页缺的字段用。https://www.techpowerup.com/gpu-specs/a100-sxm4-80-gb.c3746
- TechPowerUp，Tesla T4 页面。https://www.techpowerup.com/gpu-specs/tesla-t4.c3316

### 架构解读

- NVIDIA Ampere Architecture In-Depth，NVIDIA 技术博客。2:4 结构化稀疏那一节解释了星号背后的机制。https://developer.nvidia.com/blog/nvidia-ampere-architecture-in-depth/
- NVIDIA Hopper Architecture In-Depth，NVIDIA 技术博客。H100 的 FP8、NVLink 4、HBM3。https://developer.nvidia.com/blog/nvidia-hopper-architecture-in-depth/
- NVIDIA A100 Tensor Core GPU Architecture 白皮书 PDF，第三章讲 tensor core 和稀疏。https://images.nvidia.com/aem-dam/en-zz/Solutions/data-center/nvidia-ampere-architecture-whitepaper.pdf
- GPU Performance Background User's Guide，NVIDIA。规格数字和 roofline 怎么接起来。https://docs.nvidia.com/deeplearning/performance/dl-performance-gpu-background/index.html

### 价格页（变动快，每次用前重查）

- RunPod 价格页。https://www.runpod.io/pricing
- Vast.ai 价格页。https://vast.ai/pricing
- Lambda GPU Cloud 价格页。https://lambda.ai/service/gpu-cloud

### 视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/YvPM8VpQlwo" title="GPU Memory Bandwidth Explained: How to Read an H100 Spec Sheet" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>The Agentic Enterprise · GPU Memory Bandwidth Explained: How to Read an H100 Spec Sheet。拿 H100 的规格表逐行讲带宽和算力，和本文的阅读清单是同一个套路，看完对照着读一遍 A100 的表。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/6lm8zXvfjyc" title="Understanding NVIDIA NVLink" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>SoC &amp; FPGA · Understanding NVIDIA NVLink。NVLink 和 PCIe 的差别、各代带宽、拓扑怎么连。M9 之前只需要看到「差一个数量级」这个结论。</figcaption>
</figure>

## 自测

合上笔记做。

1. A100 规格表 BF16 一行写 `312 | 624*`，星号是什么意思？做 7B 推理估算该用哪个？为什么？

<details><summary>答案</summary>

星号是 with sparsity，指 2:4 结构化稀疏：权重每 4 个连续元素恰有 2 个零时硬件跳过零、吞吐翻倍。正常训练的模型权重是稠密的，不满足，所以用 312。

</details>

2. A100 80GB PCIe 和 SXM 的带宽各是多少？用 PCIe 版重算 7B 的 decode 下限和 ridge point。

<details><summary>答案</summary>

PCIe 1935 GB/s，SXM 2039 GB/s。PCIe：13.5 GB ÷ 1935 GB/s ≈ 6.98 ms；312e12 ÷ 1935e9 ≈ 161 FLOP/byte。SXM 是 6.62 ms 和 153。

</details>

3. 用 `torch.float32` 在 A100 上测大矩阵 matmul，得到约 19 TFLOPS；改成 `torch.float16` 后得到约 250 TFLOPS。各对应规格表哪一行？

<details><summary>答案</summary>

fp32 且 TF32 关闭时走 CUDA core，对 FP32 那行 19.5 TFLOPS；fp16 走 tensor core，对 FP16 Tensor Core dense 那行 312 TFLOPS，250 是达到了 80%。若开 `allow_tf32=True`，fp32 会对 TF32 那行 156。

</details>

4. NVLink 3 和 PCIe Gen4 x16 各多少 GB/s？7B 模型两卡 tensor parallel、batch 32 decode 一步要在卡间搬约 16 MB，两种互联各花多久，对比 6.6 ms 的单步时间占比多少？

<details><summary>答案</summary>

NVLink 3 是 600 GB/s，PCIe 4 x16 是 64 GB/s，差约 9.4 倍。16 MB ÷ 600 GB/s ≈ 0.027 ms（0.4%）；16 MB ÷ 64 GB/s ≈ 0.25 ms（约 4%）。decode 还能接受，训练时同步全部 13.5 GB 梯度就是 0.023 s 对 0.21 s 的差别。

</details>

5. H100 SXM 的 FP16 dense 算力和带宽各多少？ridge point 多少？它比 A100 高还是低，这对 decode 意味着什么？

<details><summary>答案</summary>

989 TFLOPS，3.35 TB/s，ridge ≈ 295，比 A100 的 153 高。意味着同样的 batch 在 H100 上离 compute-bound 更远、算力利用率更低；H100 对 decode 的收益来自带宽涨了 64% 让单步更快，不是更接近屋顶。

</details>

6. A100 按 $1.5/h 租，7B 模型 batch 1 和 batch 32 的 $/1M token 各多少？为什么差这么多？

<details><summary>答案</summary>

batch 1：150 tok/s，1e6 ÷ 150 ≈ 1.85 h，≈ $2.78。batch 32：4,800 tok/s，≈ 0.058 h，≈ $0.087。差 32 倍，因为 decode memory-bound，batch 32 时单步时间几乎不变（权重只搬一遍），吞吐直接乘 32，每 token 分摊的机时就除 32。

</details>

## 明天预告

Day 29 从规格表回到招聘页。2026 年 9 月查了一轮推理优化岗的 JD：猎聘榜单 39 条、牛客几条、清昴的招聘简章、一篇讲国内 AI Infra 岗位四象限的文章，还有 Baseten 的海外 JD。把这些 JD 里高频出现的要求列成表，对照路线图看哪里有缺口、要加哪几个勾（GQA/MoE、speculative decoding、SGLang、两卡 TP、裸 CUDA、K8s），顺手把薪资快照和四条必须正视的现实写下来，免得以后又乐观化。
