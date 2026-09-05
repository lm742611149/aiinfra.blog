---
title: 'Day 17 · 标称 vs 实测：哪些 kernel 能打到屋顶，哪些永远打不到'
description: '把 Day 13、14 测出来的带宽和算力跟规格表并排放，算清标称值是怎么来的、实测为什么差那一截。再给每种 kernel 算一遍算术强度，标到 roofline 上：大矩阵乘能碰到屋顶，elementwise、softmax、norm 这些永远贴着斜线的底部，而这正是 M5 要写 fused kernel 的全部理由。'
pubDate: 2026-09-15
regime: compute
tags: ['roofline', 'mfu', 'gemm', 'fusion', 'tensor-core', 'aiinfra-365']
series: 'aiinfra-365'
day: 17
lang: 'zh'
---

## 今天要解决的问题

W3 前四天做的事是:测带宽(Day 13)、测算力(Day 14)、用实测值画自己的 roofline(Day 15)、扫 batch 看曲线什么时候离开斜线(Day 16)。每一天都产生了「实测比标称低一截」这个现象,但一直没停下来问为什么。今天把账算清楚:

1. 规格表上的 65 TFLOPS 和 320 GB/s 是怎么算出来的?用 SM 数、tensor core 数、时钟频率一路乘出来。知道来路才知道哪些因子在实际运行时会缩水。
2. 实测为什么打不到标称?带宽和算力各有各的原因,列出来,并估每一项大概吃掉几个百分点。
3. 什么样的 kernel 能碰到实测的屋顶,什么样的永远碰不到?给 transformer 里每种 op 算一遍算术强度,标到 roofline 上,这张图就是路线图 W3 D5 的验收物。

顺带引出一个后面反复会用的词:MFU,model FLOPs utilization。以及一个从今天开始一直到 M5 的伏笔:为什么那些永远碰不到屋顶的 kernel,治法叫 fusion。

口径还是 Colab T4 和 TinyLlama-1.1B,对照组是 A100 80GB SXM。Day 13、14 的实测数字我现在还没有真值,文中用「预期区间」代替,文末记录表留给真实数字。

## 标称值是怎么乘出来的

规格表上那个 TFLOPS 不是测的,是算的。算力峰值的公式:

```
峰值 FLOP/s = SM 数 × 每个 SM 每周期能做的 FLOP × 时钟频率
```

T4 的 fp16 tensor core 峰值,拆开是:

| 因子 | T4 | 出处 |
| --- | --- | --- |
| SM 数 | 40 | Turing TU104,规格表 |
| 每个 SM 的 tensor core 数 | 8 | Turing 架构 |
| 每个 tensor core 每周期的 fp16 FMA 数 | 64 | Turing 第二代 tensor core |
| 每个 FMA 算几个 FLOP | 2(一乘一加) | 定义 |
| boost 时钟 | 1.59 GHz | 规格表 |

乘起来:

```
40 × 8 × 64 × 2 × 1.59e9 ≈ 65.1e12 FLOP/s
```

就是规格表上的 65 TFLOPS。A100 同样的算法:108 个 SM,每个 SM 4 个第三代 tensor core,每个每周期 256 个 fp16 FMA,时钟 1.41 GHz:

```
108 × 4 × 256 × 2 × 1.41e9 ≈ 311.9e12 FLOP/s
```

就是 312 TFLOPS。这里有一个重要的观察:**tensor core 那一项只对 fp16/bf16 矩阵乘成立。** 走普通 CUDA core 的 fp32 运算,T4 每个 SM 每周期只有 64 个 fp32 FMA(不是 8 × 64 = 512),所以 fp32 峰值是 40 × 64 × 2 × 1.59e9 ≈ 8.1 TFLOPS,差了八倍。Day 14 强调「必须走 fp16 tensor core 才对得上标称」,根源就在这一行。

带宽的算法类似:

```
带宽 = 总线宽度(bit)÷ 8 × 每 pin 每秒传输次数
```

T4 是 GDDR6,256 bit 总线,每 pin 10 Gbps:256 ÷ 8 × 10e9 = 320 GB/s。A100 80GB 是 HBM2e,5120 bit 总线,每 pin 3.2 Gbps:5120 ÷ 8 × 3.2e9 ≈ 2048 GB/s,规格表取整写 2039。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="峰值算力的乘法链:SM 数乘每 SM 每周期 FLOP 乘时钟,以及实际运行时哪些因子缩水">
<text x="10" y="20" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">T4 fp16 tensor core 峰值 = 五个因子的乘积</text>
<g font-family="var(--font-mono)" font-size="11" text-anchor="middle">
<rect x="10" y="36" width="96" height="48" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="58" y="56" fill="var(--ink)">SM 数</text><text x="58" y="74" fill="var(--compute)">40</text>
<text x="118" y="66" fill="var(--ink-faint)" font-size="14">×</text>
<rect x="130" y="36" width="110" height="48" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="185" y="56" fill="var(--ink)">tensor core / SM</text><text x="185" y="74" fill="var(--compute)">8</text>
<text x="252" y="66" fill="var(--ink-faint)" font-size="14">×</text>
<rect x="264" y="36" width="110" height="48" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="319" y="56" fill="var(--ink)">FMA / 周期 / TC</text><text x="319" y="74" fill="var(--compute)">64</text>
<text x="386" y="66" fill="var(--ink-faint)" font-size="14">×</text>
<rect x="398" y="36" width="80" height="48" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="438" y="56" fill="var(--ink)">FLOP / FMA</text><text x="438" y="74" fill="var(--compute)">2</text>
<text x="490" y="66" fill="var(--ink-faint)" font-size="14">×</text>
<rect x="502" y="36" width="128" height="48" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="566" y="56" fill="var(--ink)">boost 时钟</text><text x="566" y="74" fill="var(--compute)">1.59 GHz</text>
</g>
<text x="320" y="110" font-family="var(--font-mono)" font-size="13" fill="var(--ink)" text-anchor="middle">= 65.1 TFLOPS(规格表)</text>
<line x1="10" y1="126" x2="630" y2="126" stroke="var(--rule)" stroke-width="1"/>
<text x="10" y="148" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">实际运行时会缩水的因子</text>
<g font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">
<text x="10" y="170">时钟:70 W 功耗墙下 sustained 时钟落到 1.2–1.4 GHz</text><text x="470" y="170" fill="var(--compute)">屋顶 −12% 到 −25%</text>
<text x="10" y="190">SM 数:tile 数不是 40 的整数倍,最后一波 SM 有的空着(wave quantization)</text><text x="470" y="190" fill="var(--compute)">−0% 到 −10%</text>
<text x="10" y="210">FMA / 周期:搬数据进 tensor core 的 prologue/epilogue 不算 FLOP,占掉周期</text><text x="470" y="210" fill="var(--compute)">−5% 到 −10%</text>
</g>
</svg>
<figcaption>标称是五个因子在最理想条件下的乘积。实际运行时时钟最先掉,其次是 SM 装不满和数据搬运占掉的周期。三项叠起来就是 Day 14 看到的那 10 到 30 个百分点。</figcaption>
</figure>

知道了来路,「实测打不到」就不再是一句抱怨,而是能逐项归因的东西。

## 算力为什么打不到:三个因子在缩水

**时钟。** 规格表写的 1.59 GHz 是 boost 时钟,是芯片凉、功耗有余量时能短暂冲到的频率。T4 的 TDP 只有 70 W,大矩阵乘一开始跑,功耗立刻顶到墙,驱动会把时钟往下压,持续运行时一般落在 1.2 到 1.4 GHz。这一项直接按比例砍屋顶:1.3 ÷ 1.59 ≈ 82%。Colab 的 T4 装在共享服务器里,散热条件未知,可能更差。A100 的 400 W TDP 余量大得多,时钟掉得少,这是 A100 实测能打到标称 85% 到 90% 而 T4 往往只有 70% 到 80% 的一个原因。可以在跑 matmul 的同时用 `nvidia-smi --query-gpu=clocks.sm,power.draw --format=csv -l 1` 看着,时钟和功耗的关系一眼就看出来。

**SM 装不满。** 一个大矩阵乘被切成很多 tile(比如 128 × 128 一块),每个 tile 分给一个 SM 算。tile 总数如果不是 SM 数的整数倍,最后一「波」只有部分 SM 有活,其余空转。这叫 wave quantization。4096 × 4096 的输出用 128 × 128 切是 1024 个 tile,T4 有 40 个 SM,1024 ÷ 40 = 25.6 波,最后那 0.6 波有 16 个 SM 闲着。矩阵越大这项越小;矩阵边长不是 tile 的整数倍还会多一层 tile quantization,边角上的 tile 只有一部分是有效数据。Day 14 建议矩阵用 4096 或 8192 这种 2 的幂,就是为了把这两项压到最小。

**数据进出的周期。** tensor core 要的数据先得从 HBM 搬到 shared memory、再搬到寄存器,算完再写回去。这些搬运和计算是流水线重叠的,但开头(prologue)和结尾(epilogue)重叠不了,矩阵越小这个头尾占比越大。这也是为什么 Day 14 那条「N 从 256 到 8192 算力爬升」的曲线要到几千才平:小矩阵头尾占比高,算力上不去。

三项叠起来,T4 的 fp16 大矩阵乘预期能打到标称的 **70% 到 85%**,也就是 45 到 55 TFLOPS。这是估算,Day 14 的真值填到记录表。

## 带宽为什么打不到:显存不是水管

带宽那 320 GB/s 是「每个 pin 每秒最多传这么多 bit」,前提是每个周期都在传有效数据。实际达不到有四个原因:

**刷新。** DRAM 的存储单元靠电容存电,会漏,必须周期性刷新。刷新期间那部分存储不能读写。占几个百分点。

**行切换。** DRAM 按行组织,读一个地址要先把整行「打开」到缓冲区,换到另一行要先关再开,中间有几十纳秒空档。连续地址读得快,跳着读就慢。Day 13 用连续大张量测,就是为了把这项压到最低;真实 workload 里 attention 读 KV cache 会跳,达不到这个数。

**读写方向切换。** 总线从读切到写要空几个周期。`y = x + 1` 这种一读一写的 kernel 天然在切,纯读的 kernel 会稍高一点。

**ECC。** T4 的 GDDR6 开了 ECC 会拿一部分带宽存校验位。Colab 的 T4 是否开 ECC 看 `nvidia-smi -q | grep -i ecc`。

四项叠起来,连续访问的带宽实测预期是标称的 **75% 到 90%**,T4 大约 240 到 290 GB/s,A100 大约 1500 到 1850 GB/s。Day 13 的真值填记录表。

## 对比表

把标称、预期实测、原因放到一张表里,Day 13、14 的真值出来后填第四列。

| 项 | 标称 | 预期实测 | 实测(待填) | 主要原因 |
| --- | --- | --- | --- | --- |
| T4 fp16 tensor core 算力 | 65 TFLOPS | 45–55 TFLOPS(70–85%) | | 功耗墙压时钟为主,wave quantization、头尾搬运次之 |
| T4 fp32 算力 | 8.1 TFLOPS | 6–7 TFLOPS | | 同上,但没有 tensor core 那一项 |
| T4 显存带宽 | 320 GB/s | 240–290 GB/s(75–90%) | | 刷新、行切换、读写切换、ECC |
| T4 ridge point | 203 | 用实测算力 ÷ 实测带宽,预期 170–210 | | 分子分母都缩,比值变化不大 |
| A100 bf16 算力 | 312 TFLOPS | 265–290 TFLOPS(85–93%) | | TDP 余量大,时钟掉得少 |
| A100 带宽 | 2039 GB/s | 1500–1850 GB/s(75–90%) | | HBM 效率略高于 GDDR |
| A100 ridge point | 153 | 预期 150–175 | | |

ridge point 那两行值得停一下。算力和带宽都打不到标称,但**比值变化不大**,因为两边缩水的比例接近。所以 Day 5 用标称算出的 153 和 Day 15 用实测算出的数,差距一般在 10% 到 20% 以内。这意味着 W1 那套纸上的判断大方向是对的,只是屋顶的绝对高度要往下调。Day 18 复习时这一条会写进 W3 验收题第三题的答案。

## MFU:给「打到几成」一个正式的名字

上面一直在说「打到标称的百分之几」,这个比值有正式名字:**MFU,model FLOPs utilization**。定义是:

```
MFU = 模型实际需要的 FLOP 数 ÷ 耗时 ÷ 硬件峰值 FLOP/s
```

分子是「这个模型按公式算需要做多少运算」,比如 Day 4 的 2N 每 token,不管框架实际多算了多少。这个词来自 PaLM 论文,他们报训练 MFU 46%。训练界的经验是 40% 到 60% 算好,能到 60% 以上的都是精心调过的。

推理这边数字难看得多。Day 5 算过 decode batch 1 的算力利用率是 0.65%,那就是 MFU 0.65%。它低不是因为代码差,是因为算术强度只有 1,离 ridge point 两个数量级,roofline 的斜线段上 MFU 就等于算术强度除以 ridge point。batch 32 时 MFU 涨到 20% 左右,batch 到 ridge point 附近才有可能接近上限。

MFU 有一个近亲 HFU(hardware FLOPs utilization),分子换成硬件实际执行的 FLOP 数,包括重算、padding 浪费的那些。HFU 总是大于等于 MFU。看别人报数字时先问是哪个:HFU 好看,MFU 才诚实。以后自己报数字一律报 MFU,分子用公式算,分母用**标称峰值**,这样和别人可比。要看自己离实测屋顶还有多远,再另外算一个「相对实测屋顶的比例」,两个数都写。

## 哪些 kernel 能碰到屋顶:给每种 op 算算术强度

现在到今天最重要的一节。Day 5 的 roofline 判定只说了一句话:算术强度低于 ridge point 就 memory-bound。当时只算了 decode 整体的强度是 1。今天把 transformer 里每一种 kernel 单独算一遍,看它们各自落在图的哪个位置。

算术强度 = FLOP 数 ÷ 从 HBM 搬的字节数。搬的字节数包括读输入和写输出,fp16 每个数 2 字节。

**矩阵乘 M × K 乘 K × N。** FLOP 是 2MNK。搬运是读两个输入、写一个输出:2(MK + KN + MN) 字节。

- 方阵 N = 4096:强度 = 2N³ ÷ (2 × 3N²) = N ÷ 3 ≈ 1365。T4 的 ridge 是 203,远超,compute-bound,这就是 Day 14 用它测峰值的原因。
- decode 的线性层,batch 1:M = 1,K = N = 2048,强度 = 2 × 2048 × 2048 ÷ (2 × (2048 + 2048² + 2048)) ≈ 1。memory-bound,就是 Day 5 那个 1。
- decode 的线性层,batch 32:M = 32,强度 ≈ 32 × 2048² ÷ (2048² + 2 × 32 × 2048) ≈ 31。还在斜线上,但往右挪了。batch 每翻一倍强度翻一倍,到 200 左右碰屋顶。这就是 Day 16 扫出来那条曲线的解释。

**elementwise 加法** `c = a + b`。每个元素 1 FLOP,读 2 个数写 1 个数,6 字节。强度 = 1 ÷ 6 ≈ 0.17。图上最左下角。

**SiLU** `x * sigmoid(x)`。每个元素约 4 到 5 个 FLOP(exp、加、除、乘),读 1 写 1 共 4 字节。强度约 1。

**RMSNorm。** 读一遍算平方和,再读一遍乘缩放写回:读 2 写 1 共 6 字节,每元素约 4 FLOP。强度约 0.7。如果实现只读一遍(先算平方和存在 shared memory 里),强度也就 1 左右。

**softmax。** 读一遍找最大值,读一遍算 exp 求和,读一遍除,写一遍。每元素约 5 FLOP,搬 8 字节。强度约 0.6。

**embedding 查表。** 0 FLOP,纯搬运。强度 0。

**attention,decode 阶段。** 一个新 token 的 q 和 n 个 k 算点积、n 个 v 加权求和,FLOP 约 4nd(Day 4 的口径)。要读 n 个 k 和 n 个 v,2 × n × d × 2 字节 = 4nd 字节。强度 = 4nd ÷ 4nd = 1。**和序列长度无关,永远是 1。** 这就是为什么 decode 阶段 KV cache 再大也不会变成 compute-bound,只会把带宽吃得更死。

**attention,prefill 阶段。** n 个 q 对 n 个 k,FLOP 约 4n²d。朴素实现要把 n × n 的分数矩阵写到 HBM 再读回来做 softmax,搬运 O(n²) 字节,强度 ≈ d 级别,也就是几百,勉强过 ridge。FlashAttention 不写分数矩阵,只搬 q、k、v 和输出,搬运 O(nd),强度 ≈ n 级别,几千,稳稳 compute-bound。这是 Day 12 提过的、FlashAttention 「省显存还提速」的机制,M5 会精读。

<figure>
<svg viewBox="0 0 640 320" role="img" aria-label="transformer 各种 kernel 在实测 roofline 上的位置:大矩阵乘和 FlashAttention 在屋顶,decode 线性层、attention、softmax、norm、elementwise 在斜线底部">
<line x1="70" y1="250" x2="600" y2="250" stroke="var(--rule)" stroke-width="1"/>
<line x1="70" y1="250" x2="70" y2="24" stroke="var(--rule)" stroke-width="1"/>
<g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)" text-anchor="middle">
<text x="70" y="266">0.1</text><text x="174" y="266">1</text><text x="278" y="266">10</text><text x="382" y="266">100</text><text x="486" y="266">1000</text><text x="590" y="266">10⁴</text>
</g>
<text x="335" y="284" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">算术强度 FLOP/byte(对数)</text>
<g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)" text-anchor="end">
<text x="64" y="253">0.01</text><text x="64" y="198">0.1</text><text x="64" y="143">1</text><text x="64" y="88">10</text><text x="64" y="33">100</text>
</g>
<text x="18" y="16" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">TFLOP/s</text>
<g stroke-dasharray="2 2">
<line x1="70" y1="250" x2="600" y2="250" stroke="none"/>
<line x1="70" y1="198" x2="600" y2="198" stroke="var(--rule-soft)"/><line x1="70" y1="143" x2="600" y2="143" stroke="var(--rule-soft)"/><line x1="70" y1="88" x2="600" y2="88" stroke="var(--rule-soft)"/><line x1="70" y1="33" x2="600" y2="33" stroke="var(--rule-soft)"/>
</g>
<polyline points="70,222 414,40 600,40" fill="none" stroke="var(--ink-faint)" stroke-width="1.5" stroke-dasharray="6 4"/>
<text x="470" y="34" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">标称屋顶 65 TFLOPS</text>
<polyline points="70,226 411,46" fill="none" stroke="var(--mem)" stroke-width="2.5"/>
<polyline points="411,46 600,46" fill="none" stroke="var(--compute)" stroke-width="2.5"/>
<text x="470" y="62" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">实测屋顶 ≈ 52 TFLOPS(示意)</text>
<circle cx="411" cy="46" r="4" fill="var(--paper-raised)" stroke="var(--ink)" stroke-width="1.5"/>
<text x="404" y="78" font-family="var(--font-mono)" font-size="10" fill="var(--ink)" text-anchor="end">ridge ≈ 190</text>
<g fill="var(--mem)">
<circle cx="198" cy="214" r="5"/>
<circle cx="174" cy="171" r="5"/>
<circle cx="166" cy="179" r="5"/>
<circle cx="182" cy="171" r="5"/>
<circle cx="329" cy="89" r="5"/>
</g>
<g fill="var(--compute)">
<circle cx="500" cy="46" r="5"/>
<circle cx="444" cy="46" r="5"/>
</g>
<g font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">
<text x="208" y="232">elementwise add ≈ 0.17</text>
<text x="192" y="150">decode 线性层 batch 1 / decode attention = 1</text>
<text x="192" y="164">SiLU ≈ 1 · RMSNorm ≈ 0.7 · softmax ≈ 0.6</text>
<text x="338" y="102">decode 线性层 batch 32 ≈ 31</text>
<text x="360" y="126" fill="var(--compute)">FlashAttention prefill,几千</text>
<text x="480" y="112" fill="var(--compute)">GEMM 4096² ≈ 1365</text>
<line x1="444" y1="52" x2="444" y2="116" stroke="var(--compute)" stroke-width="1" stroke-dasharray="2 2"/>
<line x1="500" y1="52" x2="500" y2="102" stroke="var(--compute)" stroke-width="1" stroke-dasharray="2 2"/>
</g>
<text x="76" y="300" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">T4 口径。斜线段:memory-bound,达到的算力 = 实测带宽 × 强度;平段:compute-bound。</text>
<text x="76" y="314" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">左下角那一团永远碰不到屋顶,它们的治法不是算得更快,是少搬几趟。</text>
</svg>
<figcaption>transformer 里所有 kernel 的位置。右上是能打到屋顶的两类:大矩阵乘和 FlashAttention 式的 prefill attention。左下那一团强度在 1 附近的,是 decode 的全部和所有 elementwise、norm、softmax,它们在斜线上,只能靠带宽。</figcaption>
</figure>

图上两团点是今天的全部结论:

**能碰到屋顶的**:大矩阵乘(prefill 的线性层、训练的线性层)、FlashAttention 式的 prefill attention。它们的强度是几百到几千,远超 ridge。优化它们的方向是提高算力利用率:走 tensor core、矩阵维度对齐到 8 或 64 的倍数、减少 wave quantization、调 tile 大小。这是 M5 后半段的内容。

**永远碰不到的**:decode 的全部(线性层 batch 小、attention 强度恒为 1),以及所有 elementwise、SiLU、norm、softmax、embedding。强度在 0.17 到 1 之间,离 ridge 两个数量级。它们的时间 = 搬的字节 ÷ 带宽,和算力完全无关。换一张算力翻倍、带宽不变的卡,它们一点都不会变快。

回答 W3 验收题第五题的话就是:**大矩阵乘能打到实测算力上限,elementwise 和 reduction 类的 kernel 永远打不到,因为它们的算术强度比 ridge point 低两个数量级,时间被带宽决定。**

## 为什么 fusion 是治左下角那一团的唯一办法

左下角那些 kernel 的时间是「搬的字节 ÷ 带宽」。带宽是硬件定的,改不了。能改的只有字节数。字节数怎么少?

看 TinyLlama FFN 里连着的三步:`gate` 的输出过 SiLU,再和 `up` 的输出逐元素相乘。eager 模式下是两个 kernel:

```
kernel 1  silu:  读 gate(b × 5632 × 2 字节)       写 tmp(同样大小)
kernel 2  mul:   读 tmp,读 up(各 b × 5632 × 2)    写 out(同样大小)
```

batch b = 32 时每个张量是 32 × 5632 × 2 ≈ 360 KB。两个 kernel 合计搬 2 + 3 = 5 个张量,1.8 MB。融合成一个 kernel:

```
fused:  读 gate,读 up(2 个张量)  算 silu(gate) × up  写 out(1 个张量)
```

搬 3 个张量,1.08 MB。少了 40%,时间也少 40%,因为时间就是字节。再往前推一步,把这个乘法融进 `down` 矩阵乘的输入读取里(prologue fusion),或把 SiLU 融进 `gate` 矩阵乘的输出写入里(epilogue fusion),中间张量根本不落到 HBM,字节数更少。

这就是 fusion 的全部原理:**memory-bound 的 kernel,每少写一次读一次中间结果,时间就按比例减少。** `torch.compile` 自动做其中简单的部分(相邻 elementwise 合并),Triton 让人手写更激进的部分(把 norm、激活融进矩阵乘的头尾),FlashAttention 是这个思路在 attention 上的极致版本(不写 n × n 的分数矩阵)。M5 写 fused layernorm 或 fused attention,做的就是把左下角那一团里的几个点合成一个、字节数减半的事。

顺带把 Day 11 接上:fusion 同时也减少 kernel 数量,launch 次数变少,gap 也跟着少。一个手段治两种 bound,这是它在推理引擎里无处不在的原因。

## 用哪条屋顶做判断

W3 一开始的问题是:标称值不可信,那以后判断一段代码是 memory-bound 还是 compute-bound,用哪条屋顶?

答案是分场景。

**纸上估算,用标称。** 换模型换卡时快速算 ridge point、估 decode 上限,标称够用,误差 10% 到 20% 不影响「差两个数量级」这种判断。Day 5 那套算法照用。

**给自己的实测数字定位,用实测屋顶。** 某个 kernel 实测跑到 40 TFLOPS,拿标称 65 比是 62%,拿实测屋顶 52 比是 77%。后者才是「还剩多少可挖」的真实答案。优化到接近实测屋顶就该停了,再挤是在和功耗墙较劲。

**给别人报数字,标称和实测都写。** MFU 按标称算(可比),再注一句实测屋顶是多少、离它多远(诚实)。

Day 15 画的那张图,以后每做一次优化就把新的点标上去,看它往哪个方向挪。这张图会一直用到 M8。

## 记录表

| 项 | 标称 | 预期 | 实测(Day 13/14 真值) | 与标称的比例 |
| --- | --- | --- | --- | --- |
| 带宽,连续读写 | 320 GB/s | 240–290 | | |
| fp16 tensor core 算力,4096 方阵 | 65 TFLOPS | 45–55 | | |
| fp16 算力,512 方阵 | 65 TFLOPS | 明显更低,头尾占比高 | | |
| fp32 算力,4096 方阵 | 8.1 TFLOPS | 6–7 | | |
| 跑 matmul 时的 sustained 时钟 | 1.59 GHz boost | 1.2–1.4 GHz | | `nvidia-smi --query-gpu=clocks.sm` |
| 跑 matmul 时的功耗 | 70 W TDP | 顶到 70 附近 | | `--query-gpu=power.draw` |
| 实测 ridge point | 203 | 170–210 | | |
| ECC 是否开启 | | | | `nvidia-smi -q` 里看 |
| Day 9 的 TPOT 换算成算力和 MFU | | MFU < 1% | | 2 × 1.1e9 FLOP ÷ TPOT ÷ 65e12 |

## 名词解释

| 名词 | 意思 |
| --- | --- |
| boost 时钟 | 芯片在功耗和温度有余量时能短暂达到的最高频率,规格表用它算峰值 |
| sustained 时钟 | 持续满负载时实际稳定在的频率,受功耗墙限制,T4 一般 1.2–1.4 GHz |
| TDP | 热设计功耗,芯片允许的持续功耗上限。T4 70 W,A100 400 W |
| tensor core | SM 里专做小块矩阵乘的单元,fp16/bf16 输入时每周期吞吐是普通 CUDA core 的几倍到几十倍 |
| FMA | fused multiply-add,一乘一加算一条指令,记 2 FLOP |
| tile | 大矩阵乘被切成的小块,一个 tile 分给一个 SM 的一组线程算 |
| wave quantization | tile 数不是 SM 数的整数倍,最后一波部分 SM 空转造成的损失 |
| tile quantization | 矩阵边长不是 tile 边长的整数倍,边角 tile 有无效计算造成的损失 |
| prologue / epilogue | kernel 开头把数据搬进来、结尾把结果写出去的阶段,和计算不重叠 |
| MFU | model FLOPs utilization,模型按公式需要的 FLOP ÷ 耗时 ÷ 标称峰值。训练 40–60% 算好,decode batch 1 不到 1% |
| HFU | hardware FLOPs utilization,分子换成硬件实际执行的 FLOP(含重算和 padding),总是 ≥ MFU |
| 算术强度 | 一个 kernel 的 FLOP ÷ 从 HBM 搬的字节数,决定它在 roofline 上的横坐标 |
| fusion | 把几个 kernel 合成一个,中间结果不落 HBM,减少搬运字节和 launch 次数 |
| epilogue fusion | 把矩阵乘之后的 elementwise 操作(激活、加偏置)融进矩阵乘写结果的阶段 |
| ECC | 显存纠错,开启时占用部分容量和带宽 |

## 常见误区

**用 fp32 的实测去比 fp16 的标称。** 65 TFLOPS 是 tensor core 的数,fp32 走 CUDA core 只有 8.1。拿 fp32 matmul 测出 7 TFLOPS 然后说「只打到标称 11%」,比错了分母。Day 14 的第一个坑。

**以为算力和带宽的缩水比例一样所以 ridge point 不变。** 大方向对,但不能省掉实测。T4 这种功耗墙很紧的卡,算力可能掉 25% 而带宽只掉 10%,ridge 就往左挪 15%。要用实测的两个数重新除一次。

**把 MFU 低当成代码有问题。** decode batch 1 的 MFU 不到 1% 是物理决定的,算术强度只有 1。这个数字低不代表有可优化空间,想让它高只能加 batch。看 MFU 之前先看算术强度落在斜线段还是平段。

**报 HFU 当 MFU。** 框架实际执行的 FLOP 里有重算(比如 FlashAttention 反向重算 softmax)和 padding 浪费,HFU 比 MFU 好看。报数字时说清分子怎么算的。

**觉得 elementwise 慢是因为算得慢。** 它们的时间全是搬字节的时间,算力多少都一样。看到 `aten::silu` 或 `aten::add` 占了不小的时间份额,第一反应应该是「能不能融掉」,不是「能不能算快点」。

**优化到接近标称还不停。** 实测屋顶才是能到的地方。某个 kernel 到了实测算力的 90%,剩下那 10% 是功耗墙和 wave quantization,继续挤是浪费时间。这时候该去看别的 kernel。

## 参考资料

文章

- Making Deep Learning Go Brrrr From First Principles,Horace He。今天给每种 op 算强度,就是把文章里 memory-bound 那一节的例子推广到整个 transformer。https://horace.io/brrr_intro.html
- Matrix Multiplication Background User's Guide,NVIDIA。tile、wave quantization、维度对齐对 tensor core 效率的影响,今天「算力为什么打不到」那一节的出处。https://docs.nvidia.com/deeplearning/performance/dl-performance-matrix-multiplication/index.html
- GPU Performance Background User's Guide,NVIDIA。算术强度、memory-bound 和 math-bound 的官方定义和每种层的归类。https://docs.nvidia.com/deeplearning/performance/dl-performance-gpu-background/index.html
- CUDA C++ Best Practices Guide,NVIDIA。带宽实测方法和理论带宽的计算方式在「Memory Optimizations」一章。https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/index.html
- PaLM: Scaling Language Modeling with Pathways,Chowdhery 等,2022。MFU 的定义和 HFU 的区别在附录 B。https://arxiv.org/abs/2204.02311
- FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness,Dao 等,2022。为什么不写 n × n 分数矩阵就能同时省显存和提速,今天 prefill attention 强度那一段的来源,M5 精读。https://arxiv.org/abs/2205.14135
- Transformer Inference Arithmetic,Kipply。每种 op 的字节和 FLOP 账本,可以和今天的表对账。https://kipp.ly/transformer-inference-arithmetic/
- NVIDIA A100 Tensor Core GPU Datasheet。312 TFLOPS、2039 GB/s、108 SM、400 W 的出处。https://www.nvidia.com/content/dam/en-zz/Solutions/Data-Center/a100/pdf/nvidia-a100-datasheet-us-nvidia-1758950-r4-web.pdf
- NVIDIA T4 产品页。65 TFLOPS、320 GB/s、70 W 的出处。https://www.nvidia.com/en-us/data-center/tesla-t4/

视频

- GPU MODE Lecture 4: Compute and Memory Basics。讲 GPU 存储层次、带宽和算力的关系、为什么小 kernel 打不满,正好是今天的理论底。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/lTmYrKwjSOU" title="Lecture 4 Compute and Memory Basics" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>GPU MODE · Lecture 4 Compute and Memory Basics。重点看讲 memory hierarchy 和 arithmetic intensity 的那一段,以及 SM、tensor core 怎么组成峰值算力。</figcaption>
</figure>

- GPU MODE Lecture 8: CUDA Performance Checklist。一张 checklist 过一遍所有让 kernel 打不到屋顶的原因,fusion、occupancy、tile 大小都在里面,M5 之前会再看一遍。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/SGhfUhlowB4" title="Lecture 8: CUDA Performance Checklist" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>GPU MODE · Lecture 8: CUDA Performance Checklist。今天只需要看前段讲 memory-bound kernel 和 fusion 的部分,后面 occupancy、bank conflict 留到 M5。</figcaption>
</figure>

代码

- GPU MODE lectures 仓库,Lecture 4 和 8 的代码。https://github.com/gpu-mode/lectures
- Stanford CS336 2025 课件仓库,第 2 讲的 FLOPs 和 MFU 计算 notebook 可以对照。https://github.com/stanford-cs336/spring2025-lectures

## 自测

合上笔记做。

1. T4 的 65 TFLOPS 是哪几个因子乘出来的?实际运行时哪个因子最先缩水?

<details><summary>答案</summary>

40 个 SM × 每 SM 8 个 tensor core × 每 tensor core 每周期 64 个 fp16 FMA × 2 FLOP/FMA × 1.59 GHz boost 时钟 ≈ 65.1 TFLOPS。最先缩水的是时钟:70 W 功耗墙下 sustained 时钟落到 1.2–1.4 GHz,屋顶按比例掉 12% 到 25%。其次是 wave quantization 和数据搬运的头尾。

</details>

2. 带宽为什么打不到标称?至少说三个原因。实测一般是标称的百分之多少?

<details><summary>答案</summary>

DRAM 刷新占周期、行切换有空档、读写方向切换有空周期、ECC 占带宽。连续访问的实测一般是标称的 75% 到 90%,跳着访问(如 attention 读 KV cache)更低。

</details>

3. 算力和带宽都打不到标称,实测 ridge point 和标称算出的差多少?做优化判断该用哪个?

<details><summary>答案</summary>

两边缩水比例接近,所以比值变化一般在 10% 到 20% 以内。纸上估算用标称够了;给自己的实测数字定位、判断还有多少可挖,用实测屋顶;给别人报 MFU 按标称算并注明实测屋顶。

</details>

4. MFU 是什么?decode batch 1 的 MFU 为什么不到 1%,这说明代码有问题吗?

<details><summary>答案</summary>

MFU = 模型按公式需要的 FLOP ÷ 耗时 ÷ 标称峰值。decode batch 1 算术强度只有 1,离 ridge point 两个数量级,在 roofline 斜线段上 MFU ≈ 强度 ÷ ridge,所以不到 1%。这是物理决定的,不是代码问题,想提高只能加 batch 拉强度。

</details>

5. 给出 transformer 里三种能碰到屋顶的 kernel 和三种永远碰不到的,各说出算术强度的量级。

<details><summary>答案</summary>

能碰到:大矩阵乘(4096 方阵约 1365)、prefill 的线性层(强度 ≈ 序列长度级别)、FlashAttention 式 prefill attention(几千)。碰不到:elementwise add(0.17)、SiLU/RMSNorm/softmax(0.6–1)、decode 线性层 batch 1 和 decode attention(恒为 1)、embedding(0)。ridge 是 150–200,后一组低两个数量级。

</details>

6. 为什么 fusion 能让 memory-bound 的 kernel 变快?用 SiLU 和乘法举例算字节。

<details><summary>答案</summary>

memory-bound kernel 的时间 = 搬的字节 ÷ 带宽,只能靠减字节。分开的 silu 和 mul 两个 kernel 搬 5 个张量(silu 读 1 写 1,mul 读 2 写 1);融成一个只搬 3 个(读 gate、up,写 out),中间结果不落 HBM。字节少 40%,时间少 40%,同时 launch 次数减半,gap 也少。

</details>

## 明天预告

Day 18 是 W3 的收口:W3 复习:自己的 roofline、五道验收题、错题本。把这周测带宽、测算力、画 roofline、扫 batch、对比标称的流程压成一页笔记,每一步的公式、预期区间和坑写在一起。然后合上笔记做路线图 W3 的五道验收题:实测带宽占标称几成、实测算力占几成为什么达不到、实测 ridge 和标称差多少该用哪个、batch 1 到 128 的曲线形状和转折点、什么 kernel 能打到上限什么永远打不到。错题本要记这周的:矩阵太小打不满、拿 fp32 比 fp16 标称、带宽只算读没算写、计时忘了 synchronize。最后预告 W4:一行 GPU 代码都不写,全是环境工程,但它决定全年会不会因为忘关机超预算。
