---
title: 'Day 18 · W3 复习：自己的 roofline、五道验收题、错题本'
description: '把测带宽、测算力、画 roofline、扫 batch、对比标称这五天压成一页笔记：每一步的公式、预期区间和坑放在一起。合上笔记做路线图 W3 的五道验收题，再把这周最容易测错的地方一条条摊开。屋顶从这周起是自己测的，不是抄的。'
pubDate: 2026-09-16
regime: memory
tags: ['review', 'roofline', 'benchmark', 'week-3', 'aiinfra-365']
series: 'aiinfra-365'
day: 18
lang: 'zh'
---

## 这一周解决了什么

W3 只干了一件事:戳破标称值。

W1 用 A100 的 312 TFLOP/s 和 2039 GB/s 算出 ridge point 153,W2 用 T4 的 65 TFLOP/s 和 320 GB/s 算出 TinyLlama 的 decode 下限 6.9 ms。这四个数全是规格表上抄的,是「每个时钟周期每根线都在传有效数据、每个 tensor core 每周期都在做满载乘加」的理想值。真实的卡永远到不了,差多少要自己测。测出来之后,roofline 那两条线才是自己这张卡的,以后每一次优化「离屋顶还有多远」才算得清。

五天的顺序是有意的:先测斜线(带宽),再测横线(算力),然后用两个实测值把图重画一遍,接着把 batch 从 1 扫到 128 看曲线在哪离开斜线,最后回头把标称和实测的差逐项归因,顺手把 transformer 里每种 kernel 都标到图上。做完这五天,W1 那句「batch ≈ 153 才 compute-bound」被改写成了三句更准的话,而 W1 的算法本身一条都没推翻。

写这篇的时候 Day 13 到 Day 16 的实测数字还没跑出来,所以这一页笔记里凡是「实测」的地方仍然是预期区间,文末的记录表等真值。这不影响复习的重点:重点是流程和公式,数字是往里填的。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="W3 五天的实测流程:测带宽、测算力、画 roofline、扫 batch、归因对比,箭头串起五步及各自产出">
  <defs>
    <marker id="d18arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="var(--ink-faint)"/>
    </marker>
  </defs>
  <text x="10" y="18" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">W3 · 从两个标称值到一张自己的 roofline</text>

  <rect x="10" y="40" width="118" height="62" rx="4" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1.5"/>
  <text x="69" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">Day 13</text>
  <text x="69" y="76" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">y = x + 1</text>
  <text x="69" y="91" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">实测带宽 B</text>

  <rect x="10" y="126" width="118" height="62" rx="4" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1.5"/>
  <text x="69" y="146" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">Day 14</text>
  <text x="69" y="162" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">4096² matmul</text>
  <text x="69" y="177" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">实测算力 P</text>

  <line x1="128" y1="71" x2="176" y2="105" stroke="var(--ink-faint)" stroke-width="1.2" marker-end="url(#d18arr)"/>
  <line x1="128" y1="157" x2="176" y2="123" stroke="var(--ink-faint)" stroke-width="1.2" marker-end="url(#d18arr)"/>

  <rect x="180" y="83" width="130" height="62" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)" stroke-width="1.5"/>
  <text x="245" y="103" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">Day 15</text>
  <text x="245" y="119" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">min(P, B × AI)</text>
  <text x="245" y="134" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">实测 ridge = P ÷ B</text>

  <line x1="310" y1="114" x2="356" y2="114" stroke="var(--ink-faint)" stroke-width="1.2" marker-end="url(#d18arr)"/>

  <rect x="360" y="83" width="130" height="62" rx="4" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1.5"/>
  <text x="425" y="103" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">Day 16</text>
  <text x="425" y="119" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">batch 1 → 128</text>
  <text x="425" y="134" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">AI(b) 有天花板</text>

  <line x1="490" y1="114" x2="536" y2="114" stroke="var(--ink-faint)" stroke-width="1.2" marker-end="url(#d18arr)"/>

  <rect x="540" y="83" width="92" height="62" rx="4" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1.5"/>
  <text x="586" y="103" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">Day 17</text>
  <text x="586" y="119" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">归因 + MFU</text>
  <text x="586" y="134" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">谁能碰屋顶</text>

  <text x="10" y="222" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">每一步只测一个时间,其余全是算出来的:</text>
  <text x="10" y="240" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">带宽 = 字节(读+写) ÷ 时间     算力 = 2MNK ÷ 时间     AI = FLOP ÷ 字节     点 = (AI, FLOP ÷ 时间)</text>
  <text x="10" y="266" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">三条不变的规矩:预分配、warmup 后再计时、Event 或 synchronize 计时取中位数。</text>
  <text x="10" y="284" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">规矩来自 Day 7 和 Day 8,这周每天都在用。</text>
</svg>
<figcaption>W3 的五天是一条流水线:两个实测值进,一张 roofline 出,再拿这张图去检验 W1 的预测、解释 W2 的比值。中间没有任何一步需要新的测量工具,只有 Event 计时和一个除法。</figcaption>
</figure>

## 一页笔记

以下口径:Colab 免费卡 T4(标称 fp16 tensor core 65 TFLOP/s、320 GB/s、ridge 203、L2 4 MB、70 W),模型 TinyLlama-1.1B fp16(权重 2.2 GB、KV cache 每 token 22.5 KB)。对照卡 A100 80GB SXM(312 TFLOP/s、2039 GB/s、ridge 153)。

### 标称值是怎么来的

两个标称值都是硬件参数乘出来的,不是测的。

```
带宽 = 总线位宽 ÷ 8 × 每 pin 数据速率
  T4:   256 bit ÷ 8 × 10 Gbps      = 320 GB/s
  A100: 5120 bit ÷ 8 × 3.19 Gbps   ≈ 2039 GB/s

算力 = SM 数 × 每 SM tensor core 数 × 每 TC 每周期 FMA × 2 × boost 时钟
  T4:   40 × 8 × 64 × 2 × 1.59 GHz    ≈ 65 TFLOP/s
  A100: 108 × 4 × 256 × 2 × 1.41 GHz  ≈ 312 TFLOP/s
```

每一个因子都是「所有单元每个周期都在干活」的理想值。实测时缩水的就是这些因子:时钟被功耗墙压下来,SM 被 wave quantization 空出来,总线周期被刷新和行切换占掉。

### Day 13:测带宽

| 项 | 内容 |
| --- | --- |
| 测什么 | 逐元素加法 `torch.add(x, 1, out=y)`,只搬不算 |
| 字节 | **读 x + 写 y = 2 × 元素数 × 每元素字节** |
| 时间 | `torch.cuda.Event` 前后打点,或 `synchronize` 后 `perf_counter`,20 次取中位数 |
| 张量大小 | 远大于 L2(T4 4 MB、A100 40 MB),几百 MB 起;小张量测到的是 L2 带宽,数字会超过标称 |
| 预期 | 标称的 **75%–90%**,T4 约 240–290 GB/s |
| 达不到的原因 | DRAM 刷新、行切换、读写方向切换、ECC、功耗墙降频 |
| 对照 | 换 fp32 结果不变(带宽按字节);纯读略高;跳着读(`x[::2]`)掉一半 |

### Day 14:测算力

| 项 | 内容 |
| --- | --- |
| 测什么 | 方阵 `torch.matmul(a, b, out=c)`,fp16 |
| FLOP | **2MNK**,方阵 2N³;N = 4096 是 137 GFLOP |
| 多大才打满 | 方阵强度 = N ÷ 3 FLOP/byte,要过 ridge:T4 N > 609,A100 N > 459;再要填满 SM,实际 **4096 起**,8192 更稳 |
| 比哪个标称 | fp16 输入比 tensor core 的 65;fp32 输入比 CUDA core 的 8.1;A100 fp32 开 `allow_tf32` 后比 156;**A100 的 624 是稀疏值,dense 用 312** |
| 预期 | 标称的 **70%–90%**,T4 约 45–58 TFLOP/s;T4 功耗墙紧,偏低正常 |
| 达不到的原因 | boost 1.59 GHz 压到 1.2–1.4 GHz(主因)、wave quantization、prologue/epilogue 搬运不重叠 |
| 确认走了 tensor core | profiler 里 kernel 名带 `s1688gemm`(Turing)、`s16816gemm` 或 `tensorop`(Ampere) |

### Day 15:画自己的 roofline

画一个点只要四个数:卡的 B 和 P(实测),workload 的 FLOP 和字节(算出来),外加一个实测时间。

```
AI        = FLOP ÷ 字节          横坐标
实际算力   = FLOP ÷ 时间          纵坐标
可达算力   = min(P, B × AI)      这个 AI 下的屋顶
实测 ridge = P ÷ B               T4 预期 170–200,标称 203
```

三个常用 workload 的 AI:decode batch 1 ≈ 1(2N ÷ 2N,和模型大小无关);方阵 matmul = N ÷ 3;`y = x + 1` = 0.25。

一个点有三段距离:点到斜线的垂直距离是 overhead 加 kernel 效率,加 batch 治不了;沿斜线到 ridge 的距离是算术强度不够,靠 batching 和量化;横线本身是卡的极限,换卡才动。每学一个新优化,先在图上找它缩的是哪一段。

### Day 16:batch 扫描

W1 说 AI = batch,这只在 KV cache 可忽略时成立。补上 KV 字节之后:

```
字节(b) = 2N + b × n × kv
FLOP(b) = 2N × b
AI(b)   = 2Nb ÷ (2N + b·n·kv)
AI_max  = 2N ÷ (n × kv) = 权重字节 ÷ 一个序列的 KV 字节      b → ∞ 时的天花板
b*      = ridge × 2N ÷ (2N − ridge × n × kv)                碰屋顶需要的 batch
```

| 模型 | n = 256 时 AI_max | n = 2048 时 AI_max | 结论 |
| --- | --- | --- | --- |
| TinyLlama-1.1B(GQA,4 KV 头) | 382 | 48 | 短上下文够得到 T4 的 ridge,长上下文永远够不到 |
| Llama-2-7B(MHA,32 KV 头) | 103 | 12.9 | 2048 上下文下离 A100 的 153 差一个数量级,永远 memory-bound |

曲线预期形状:batch 1 到 4 几乎完全线性(每步时间被 overhead 主导),16 起开始看得见缺口,64 起明显,128 时比线性少 15%(n = 256)或 57%(n = 2048)。**曲线离开斜线的地方,是 KV 字节和权重字节可比的地方,不是算力追上带宽的地方**。转折早于 ridge 的三个原因,按重要性:KV cache 字节、显存装不下、kernel 效率。

### Day 17:归因与 MFU

| 项 | 标称 | 预期实测 | 缩水在哪 |
| --- | --- | --- | --- |
| T4 fp16 算力 | 65 TFLOP/s | 45–55 | 时钟为主 |
| T4 带宽 | 320 GB/s | 240–290 | 刷新、行切换、读写切换 |
| T4 ridge | 203 | 170–210 | 分子分母同缩,比值变化不大 |
| A100 bf16 算力 | 312 TFLOP/s | 265–290 | TDP 400 W 余量大 |
| A100 带宽 | 2039 GB/s | 1500–1850 | |
| A100 ridge | 153 | 150–175 | |

MFU = 模型按公式需要的 FLOP ÷ 耗时 ÷ 标称峰值。训练 40%–60% 算好;decode batch 1 只有 0.65%,不是代码差,是 AI = 1 离 ridge 两个数量级,斜线段上 MFU ≈ AI ÷ ridge。报数字用 MFU 不用 HFU,分母用标称(可比),另注实测屋顶(诚实)。

哪些 kernel 能碰到屋顶:大矩阵乘(强度 N ÷ 3,4096 方阵 1365)、prefill 线性层(≈ 序列长度级)、FlashAttention 式 prefill attention(几千)。永远碰不到:elementwise add(0.17)、SiLU/RMSNorm/softmax(0.6–1)、decode 线性层 batch 1 和 decode attention(恒为 1)、embedding(0)。后一组的时间 = 字节 ÷ 带宽,和算力无关,唯一治法是 fusion 减字节。

<figure>
<svg viewBox="0 0 640 360" role="img" aria-label="标称与实测两条 roofline 叠在一起的 log-log 示意图,标出 decode batch 1、batch 128、方阵 matmul 三个点,以及 ridge 从 203 挪到 185">
  <line x1="60" y1="300" x2="610" y2="300" stroke="var(--rule)" stroke-width="1.5"/>
  <line x1="60" y1="300" x2="60" y2="40" stroke="var(--rule)" stroke-width="1.5"/>
  <text x="335" y="336" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">算术强度 FLOP/byte(log)</text>
  <text x="18" y="170" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)" transform="rotate(-90 18 170)">可达算力 FLOP/s(log)</text>

  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
    <text x="100" y="316" text-anchor="middle">1</text>
    <text x="220" y="316" text-anchor="middle">10</text>
    <text x="340" y="316" text-anchor="middle">100</text>
    <text x="460" y="316" text-anchor="middle">1000</text>
    <text x="580" y="316" text-anchor="middle">10⁴</text>
  </g>

  <!-- 标称屋顶:斜线 320e9*AI, 横线 65e12; ridge 203 -->
  <path d="M60 322 L376 80 L610 80" fill="none" stroke="var(--ink-faint)" stroke-width="1.5" stroke-dasharray="6 4"/>
  <!-- 实测屋顶:斜线 270e9*AI, 横线 50e12; ridge 185 -->
  <path d="M60 331 L371 94 L610 94" fill="none" stroke="var(--mem)" stroke-width="2.5"/>
  <path d="M371 94 L610 94" fill="none" stroke="var(--compute)" stroke-width="2.5"/>

  <line x1="376" y1="80" x2="376" y2="300" stroke="var(--ink-faint)" stroke-width="1" stroke-dasharray="2 3"/>
  <line x1="371" y1="94" x2="371" y2="300" stroke="var(--mem)" stroke-width="1" stroke-dasharray="2 3"/>
  <text x="392" y="292" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">标称 ridge 203</text>
  <text x="392" y="278" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">实测 ridge 185</text>

  <text x="430" y="70" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">标称 65 TFLOP/s</text>
  <text x="430" y="110" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">实测约 50 TFLOP/s</text>

  <!-- decode b=1: AI=1 → x=100; achieved 147 GFLOP/s vs roof 270 GFLOP/s → below slope -->
  <circle cx="100" cy="316" r="5" fill="var(--mem)"/>
  <text x="110" y="313" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">decode b=1(屋顶的 ~54%)</text>
  <!-- decode b=128: AI≈96 → x≈337 -->
  <circle cx="337" cy="140" r="5" fill="var(--mem)"/>
  <text x="200" y="128" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">decode b=128,AI ≈ 96</text>
  <!-- matmul 4096: AI=1365 → x≈477, on roof -->
  <circle cx="477" cy="100" r="5" fill="var(--compute)"/>
  <text x="440" y="132" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">matmul 4096²,AI 1365</text>

  <text x="70" y="240" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">斜线下方那段距离 = overhead + kernel 效率</text>
  <text x="70" y="256" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">沿斜线往右 = 算术强度(batching、量化)</text>
  <text x="70" y="60" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">虚线到实线之间那条缝 = 卡本身到不了的部分</text>
</svg>
<figcaption>同一张 T4 的两条屋顶:虚线用标称值(65 TFLOP/s、320 GB/s),实线用示例实测值(50 TFLOP/s、270 GB/s)。两条线只在 ridge 附近会改变判断;decode 那个点离 ridge 两个数量级,用哪条线都是 memory-bound。点到实线的距离才是自己能挤的空间。</figcaption>
</figure>

## 五道验收题

路线图 W3 的五道题,合上笔记答。前两题和第四题在数字出来之前只能答预期和判断方法,记录表填完再回来核对。

### 第一题:你的卡实测带宽是标称的百分之多少?

预期 75% 到 90%,T4 约 240 到 290 GB/s。测法是几百 MB 的 fp16 张量做 `y = x + 1`,字节按读加写算,Event 计时 20 次取中位数。判断数字对不对有三个检查:换 fp32 再测结果应该几乎不变;1 MiB 的小张量应该高于标称(那是 L2);profiler 报的 kernel 时间和 Event 的中位数差 5% 以内。

真值:______ GB/s,占标称 ______ %(Day 13 记录表)。

### 第二题:实测算力是标称的百分之多少?为什么达不到 100%?

预期 70% 到 90%,T4 约 45 到 58 TFLOP/s,用 4096 或 8192 的 fp16 方阵测。达不到的原因按大小排:功耗墙把 boost 时钟 1.59 GHz 压到 1.2 到 1.4 GHz,屋顶直接按比例掉 12% 到 25%;tile 数不是 SM 数整数倍,最后一波部分 SM 空转;每个 tile 开头搬数据、结尾写结果的阶段和计算不重叠。T4 只有 70 W,第一项占大头,这也是它比 400 W 的 A100 打得更不满的原因。

真值:______ TFLOP/s,占标称 ______ %,当时 `clocks.sm` ______ GHz(Day 14 记录表)。

### 第三题:实测 ridge point 和标称算出的差多少?做优化判断该用哪个?

实测 ridge = 实测 P ÷ 实测 B。算力和带宽都缩水,但比例接近,所以比值一般只差 10% 到 20%,T4 预期 170 到 200 对标称 203。用哪个分场景:纸上估算、换卡换模型快速比较,用标称,误差不影响「差两个数量级」这种判断,W1 那套算法照用;给自己的实测点定位、判断还剩多少可挖,用实测屋顶,到了实测屋顶的 90% 就该停,剩下是功耗墙;给别人报数,MFU 按标称算保证可比,另注实测屋顶。

改变判断的只有 AI 落在两个 ridge 之间的 workload,那一带只能用实测线。

真值:实测 ridge ______(Day 15 记录表)。

### 第四题:batch 1 到 128 的吞吐曲线是什么形状?转折在哪?为什么在那里?

形状是先近似线性爬升,然后逐渐弯下去,在 128 以内看不到压平。T4 上 TinyLlama、上下文 256 的预测:1 到 4 几乎完全线性,16 开始有 2% 缺口,64 时 8%,128 时 15%;每步时间从 16 ms 只涨到 19 ms,吞吐涨 109 倍。上下文换成 2048,128 时缺口 57%,吞吐一半没了。

转折的原因不是算力追上带宽。batch 128 时计算时间 5.6 ms 还藏在 10.9 ms 的搬运时间下面,AI 只有 96,离 185 还远。转折来自 KV cache 的字节:权重只搬一遍被 b 摊薄,但每个序列自己的 KV 每步都要读一遍,这部分字节乘了 b。所以 AI(b) 不是直线而是有上限的分式,上限 AI_max = 权重字节 ÷ 一个序列的 KV 字节。TinyLlama 在 n = 256 时是 382,碰屋顶要 batch 360 而不是 185;n = 2048 时上限 48,永远碰不到。

三个可能让真机曲线弯得比预测更早的原因:KV 字节(可以事先算)、显存装不下(7B 在 A100 上开不到 128)、attention kernel 在大 batch 下的 tile 效率(只能测完对账)。

真值:曲线开始离开线性超过 5% 的第一个 batch ______,128 时每步时间比 batch 1 多 ______ %(Day 16 记录表)。

### 第五题:什么样的 kernel 能打到你测出的算力上限?什么样的永远打不到?

能打到的:算术强度远高于 ridge 的。大矩阵乘(方阵 N ÷ 3,4096 时 1365)、prefill 阶段的线性层(M 是几千个 token,强度约等于序列长度)、不物化分数矩阵的 prefill attention(FlashAttention,几千)。它们的优化方向是提高算力利用率:走 tensor core、维度对齐、压 wave quantization。

永远打不到的:强度比 ridge 低两个数量级的。elementwise 加法 0.17、SiLU 和 RMSNorm 和 softmax 0.6 到 1、embedding 0、decode 的每一个线性层在 batch 小的时候约等于 batch、decode 的 attention 恒等于 1 且和序列长度无关。它们的时间 = 字节 ÷ 带宽,换一张算力翻倍的卡一点不会变快。治法只有减字节,也就是 fusion:silu 和 mul 两个 kernel 搬 5 个张量,融成一个只搬 3 个,时间少 40%,launch 也少一次。这就是 M5 要写 fused kernel 的全部理由。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="五道验收题分别考 W3 哪一天:第一题 Day 13,第二题 Day 14,第三题 Day 15 和 17,第四题 Day 16,第五题 Day 17 和 15">
  <text x="10" y="18" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">五道验收题 → 各考哪一天(实线主考点,虚线前置)</text>
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
    <text x="10" y="60">Q1 带宽占标称几成</text>
    <text x="10" y="100">Q2 算力占几成、为什么</text>
    <text x="10" y="140">Q3 实测 ridge、用哪个</text>
    <text x="10" y="180">Q4 batch 曲线与转折</text>
    <text x="10" y="220">Q5 谁能打到屋顶</text>
  </g>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="420" y="44" width="80" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="460" y="61" text-anchor="middle" fill="var(--ink)">Day 13</text>
    <rect x="420" y="84" width="80" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="460" y="101" text-anchor="middle" fill="var(--ink)">Day 14</text>
    <rect x="420" y="124" width="80" height="24" rx="3" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="460" y="141" text-anchor="middle" fill="var(--ink)">Day 15</text>
    <rect x="420" y="164" width="80" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="460" y="181" text-anchor="middle" fill="var(--ink)">Day 16</text>
    <rect x="420" y="204" width="80" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="460" y="221" text-anchor="middle" fill="var(--ink)">Day 17</text>
  </g>
  <g stroke="var(--ink)" stroke-width="1.5" fill="none">
    <line x1="230" y1="56" x2="420" y2="56"/>
    <line x1="230" y1="96" x2="420" y2="96"/>
    <line x1="230" y1="136" x2="420" y2="136"/>
    <line x1="230" y1="176" x2="420" y2="176"/>
    <line x1="230" y1="216" x2="420" y2="216"/>
  </g>
  <g stroke="var(--ink-faint)" stroke-width="1" stroke-dasharray="3 3" fill="none">
    <line x1="230" y1="136" x2="420" y2="212"/>
    <line x1="230" y1="216" x2="420" y2="140"/>
    <line x1="230" y1="176" x2="420" y2="140"/>
    <line x1="230" y1="96" x2="420" y2="212"/>
  </g>
</svg>
<figcaption>每道验收题都有一天是主考点。第三题和第五题跨两天:ridge 在 Day 15 算出来、在 Day 17 归因;「谁能打到屋顶」的强度算法在 Day 15,分堆结论在 Day 17。</figcaption>
</figure>

## 错题本

这周的错和 W1 不同。W1 错在概念(向量和矩阵分不清),W3 错在测量,每一条都是「数字看着像对的,其实测错了东西」。测量的错比概念的错更危险,因为它不报错,只给一个错误的数。

**错误一:字节只算读没算写,带宽少一半。**

`y = x + 1` 搬的是 x 的字节加 y 的字节。直觉上「我处理了一个 x 那么大的张量」,于是只除 x 的大小,测出来正好是真值的一半,还会误以为这张卡只有标称的 40%。

为什么会错:把「处理了多大的数据」和「搬了多少字节」混成一件事。带宽是总线上过了多少字节,写回去的也要过总线。

规律:算字节时把每个张量的读和写分开列出来再加。matmul 也一样,读 A、读 B、写 C,三项。以后在 roofline 上标点,字节漏一半,AI 高一倍,点往右偏一格,判断跟着错。

**错误二:张量太小,测到的是 L2 不是显存。**

1 MiB 的张量测出 900 GB/s,超过标称近三倍。这不是卡好,是 x 和 y 加起来 2 MiB 塞进了 T4 的 4 MB L2,warmup 之后数据根本不碰显存。

为什么会错:不知道 L2 有多大,也不知道「超过标称」是个红旗。

规律:看到比标称还高的数字,第一反应是测到了缓存。张量至少取 L2 的十倍以上,`torch.cuda.get_device_properties(0).L2_cache_size` 能查。这条反过来也有用:M5 写 kernel 时,让数据留在 L2 或 shared memory 里就是提速的手段之一。

**错误三:拿 fp32 的实测去比 fp16 的标称。**

fp32 方阵测出 7 TFLOP/s,一比 65 只有 11%,以为驱动或者卡有问题。其实 fp32 走 CUDA core,T4 标称是 8.1,7 是打到了 86%。

为什么会错:规格表上算力写了好几个数,没先弄清每个数对应哪种精度、哪种单元。

规律:实测什么精度就比什么精度的标称。fp16 输入比 tensor core 的 65;fp32 比 CUDA core 的 8.1;A100 上 fp32 开了 `allow_tf32` 比 156 不比 19.5,开关状态要记进表里。A100 的 624 是 2:4 稀疏,dense 用 312,拿 624 做分母连 ridge 都会算成 306。

**错误四:矩阵太小,测的是带宽或者 launch 开销,不是算力。**

N = 512 的 fp16 方阵测出标称的 20%,以为 cuBLAS 不行。其实 512 方阵的强度 N ÷ 3 = 171,低于 T4 的 ridge 203,它本来就是 memory-bound 的;而且输出只切出十几个 tile,填不满 40 个 SM;N = 256 时算 33 MFLOP 只要半微秒,launch 开销都比它长。

为什么会错:把「matmul 是 compute-bound 的代表」记成了「matmul 天生 compute-bound」。

规律:只有大矩阵乘才 compute-bound,方阵至少 4096。这条和 decode 接上:decode 的线性层是 1 × 4096 乘 4096 × 4096,M = 1,强度 1,它就是一个小到极致的 matmul,所以 memory-bound。

**错误五:没 synchronize,测的是提交时间。**

用 `time.time()` 包一行 `torch.add`,测出几微秒,算出带宽几万 GB/s。这是 Day 8 的坑换个地方再出现:测的是 CPU 把命令扔进队列的时间,GPU 还没开始干活。

规律:Event 计时,或者 `perf_counter` 前后都 `synchronize`,二选一必须有。这条到 M8 都不会变。

**错误六:把标称当地板,以为 75% 是测法有问题。**

带宽 80%、算力 75%,想再往上挤。其实刷新、行切换、读写切换、功耗墙降频、wave quantization 这些是物理和结构决定的,不是代码能消掉的。

规律:标称是屋顶不是地板。到了实测屋顶的 90% 就该停,剩下的时间去看别的 kernel。这条在 M5 写 kernel 时很要紧,不然会在功耗墙上耗几天。

**错误七:以为 AI = batch,曲线弯了就说算力到瓶颈了。**

Day 16 之前我一直用 W1 的近似:decode 的算术强度等于 batch。看到曲线在 batch 64 开始弯,第一反应是「算力开始不够了」。其实 batch 128 时计算时间 5.6 ms 还藏在搬运时间 10.9 ms 下面,弯是 KV cache 字节造成的。

为什么会错:W1 的推导假设一步只搬权重,KV 字节在 batch 1 时确实可以忽略,但它乘了 b。

规律:AI(b) = 2Nb ÷ (2N + b·n·kv),有天花板 AI_max = 权重字节 ÷ 一个序列的 KV 字节。判断曲线为什么弯,把每步时间乘带宽算等效字节,减去权重,和 b × n × kv 对账。这条是 M2 整个月的提纲。

七条里有四条(一、二、四、五)是同一个根子:**测出来的时间到底对应什么字节、什么 FLOP、什么单元,没先想清楚就除了**。测量这件事,除法之前的那一步才是难的。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="七条错题按根源分成三堆:字节和 FLOP 算错、分母选错、计时方法错,每堆标出对应的错题编号和治法">
  <text x="10" y="18" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">W3 错题按根源分堆</text>

  <rect x="10" y="36" width="196" height="170" rx="4" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1.5"/>
  <text x="108" y="58" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">除法之前的账没算对</text>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">
    <text x="22" y="84">① 字节漏了写</text>
    <text x="22" y="102">② 张量太小测到 L2</text>
    <text x="22" y="120">④ 矩阵太小测到带宽</text>
    <text x="22" y="138">⑦ AI 漏了 KV 字节</text>
  </g>
  <text x="22" y="170" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">治法:先写出每个张量的</text>
  <text x="22" y="186" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">读/写字节和 FLOP,再除</text>

  <rect x="222" y="36" width="196" height="170" rx="4" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1.5"/>
  <text x="320" y="58" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">分母选错</text>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">
    <text x="234" y="84">③ fp32 实测比 fp16 标称</text>
    <text x="234" y="102">③ 624 稀疏值当 dense</text>
    <text x="234" y="120">⑥ 标称当地板</text>
  </g>
  <text x="234" y="170" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">治法:测什么精度比什么</text>
  <text x="234" y="186" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">标称;到实测屋顶 90% 停</text>

  <rect x="434" y="36" width="196" height="170" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)" stroke-width="1.5"/>
  <text x="532" y="58" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">计时方法错</text>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">
    <text x="446" y="84">⑤ 没 synchronize</text>
    <text x="446" y="102">没 warmup(Day 7)</text>
    <text x="446" y="120">取平均不取中位数</text>
    <text x="446" y="138">没预分配输出</text>
  </g>
  <text x="446" y="170" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">治法:Event 计时、warmup 3 次</text>
  <text x="446" y="186" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">20 次中位数、out= 预分配</text>
</svg>
<figcaption>七条错题只有三个根源。左边那堆最多,也最隐蔽,因为代码不会报错,只会给一个看起来合理的数。以后每次测量,先把中间那一列「字节 / FLOP / 比哪个标称」写在纸上,再跑代码。</figcaption>
</figure>

## 学习方法反思

W3 和 W1、W2 的性质又不一样。W1 是纸笔推导,W2 是学会用工具,W3 是第一次要对自己测出来的数字负责。三条教训:

第一,每个数字出来之前先写预期。Day 13 到 Day 16 每篇都有「预期区间」和「留空记录表」,这不是因为没跑出来才这么写,是应该一直这么写。有预期,数字落在区间外才知道要去查;没预期,任何数字看着都像对的。

第二,数字出来之后先查测法再查硬件。带宽比标称高,查 L2;算力只有 11%,查比的是哪个标称;带宽几万 GB/s,查 synchronize。这周所有「异常」数字的原因都在测法里,没有一个在硬件里。

第三,实测值是用来修正判断的,不是用来推翻算法的。W1 那套「参数 × 字节 ÷ 带宽」到今天一条没改,改的只是分母的数值和 AI 的一个补充项。这说明 W1 那两周纸笔没白花:算法对了,数字随时能换。

## 换卡换模型的练习

W1 复习时做过一次「换卡换模型重算」,W3 的算法也该这么练一遍。不用 GPU,只要规格表。

**换成 A100 80GB SXM 跑 Llama-2-7B。**

标称 ridge 153。测带宽用几 GB 的张量(L2 是 40 MB,几百 MB 也够但取大一点更稳),预期 1500 到 1850 GB/s。测算力方阵用 8192 或 16384,fp16 或 bf16 都走 tensor core 比 312,预期 265 到 290 TFLOP/s;fp32 记得看 `allow_tf32`,开了比 156。实测 ridge 预期 150 到 175。

decode batch 1 的 AI 还是 1。KV cache 每 token 512 KB,上下文 2048 时 AI_max = 13.5 GB ÷ (2048 × 512 KB) ≈ 12.9,离 153 差一个数量级,batch 扫到显存爆掉之前曲线都不会压平,而显存在 batch 60 左右就爆了(80 GB 减权重 13.5 和杂项,剩约 64 GB,每序列 1 GB)。这张卡上 7B 的 batching 收益天花板是显存给的。

**换成 H100 SXM 跑 Llama-3-8B。**

H100 SXM 标称 bf16 dense 约 989 TFLOP/s、HBM3 约 3350 GB/s,ridge ≈ 295,比 A100 高一倍,因为算力涨了三倍多而带宽只涨 1.6 倍。这意味着同一个 workload 在 H100 上更容易 memory-bound,decode 要更大的 batch 才碰屋顶。

Llama-3-8B 用 GQA,8 个 KV 头 × 128 = 1024,KV cache 每 token 2 × 32 × 1024 × 2 = 128 KB,是 Llama-2-7B 的四分之一。权重 8.03B × 2 ≈ 16 GB。上下文 2048 时 AI_max = 16 GB ÷ (2048 × 128 KB) ≈ 61。比 7B 的 12.9 高近五倍,但仍低于 295,长上下文下还是碰不到屋顶。GQA 抬高了天花板,H100 又把屋顶抬得更高,两边一比,decode 在新卡上反而离屋顶更远。这就是为什么 H100 时代 FP8 和 KV cache 量化被推得那么急:屋顶抬高之后,唯一能跟上的办法是减字节。

这两道练习的答案都可以只用规格表和四个公式算出来。算完填这张表:

| 卡 × 模型 | 标称 ridge | 权重 | KV/token | n = 2048 时 AI_max | 碰得到屋顶吗 | batch 上限由谁给 |
| --- | --- | --- | --- | --- | --- | --- |
| T4 × TinyLlama-1.1B | 203 | 2.2 GB | 22.5 KB | 48 | 不能 | AI_max |
| A100 × Llama-2-7B | 153 | 13.5 GB | 512 KB | 12.9 | 不能 | 显存(约 60 个序列) |
| H100 × Llama-3-8B | 295 | 16 GB | 128 KB | 61 | 不能 | AI_max |
| ______ × ______ | | | | | | |

## 自测:换模型换卡

1. 一张卡标称 fp16 1000 TFLOP/s、带宽 4000 GB/s,实测各打到 85% 和 80%。标称 ridge 和实测 ridge 各是多少?这个差距在什么情况下会改变判断?

<details><summary>答案</summary>

标称 ridge = 1000e12 ÷ 4000e9 = 250。实测 = 850e12 ÷ 3200e9 ≈ 266。算力缩得比带宽少,ridge 反而往右挪了 6%。只有 AI 落在 250 到 266 之间的 workload 判断会翻;decode(AI 约 1)和大 matmul(AI 上千)不受影响。

</details>

2. 在 A100 上测带宽,用 1 GiB 的 fp16 张量,`y = x + 1` 一次 1.2 ms。实测带宽多少?如果只算了读会得到什么数?

<details><summary>答案</summary>

字节 = 2 × 1 GiB ≈ 2.15 GB,÷ 1.2 ms ≈ 1790 GB/s,占 2039 的 88%。只算读会得到 895 GB/s、44%,会误以为这张卡带宽只有一半。

</details>

3. 一个 Llama-2-13B(权重 26 GB、KV 800 KB/token)在 A100 上跑上下文 4096,AI_max 是多少?batching 能把它拉到 compute-bound 吗?

<details><summary>答案</summary>

AI_max = 26 GB ÷ (4096 × 800 KB) = 26e9 ÷ 3.28e9 ≈ 7.9。远低于 153,不能。而且一个序列的 KV 就 3.3 GB,80 GB 减权重 26 剩约 50 GB,只能装 15 个序列,显存先到。能做的是减 KV 字节(KV cache 量化)或换 GQA 模型。

</details>

4. 某 kernel 在 T4 上实测 48 TFLOP/s,T4 实测屋顶 52 TFLOP/s。它是标称的几成、实测屋顶的几成?下一步该优化它吗?

<details><summary>答案</summary>

标称的 48 ÷ 65 ≈ 74%,实测屋顶的 48 ÷ 52 ≈ 92%。已经到实测屋顶九成以上,剩下的是功耗墙和 wave quantization,不该再挤,该去看其他 kernel。报数时 MFU 写 74%(按标称),注明实测屋顶 52。

</details>

5. RMSNorm 在 profiler 里每次 8 µs,按字节算下限只有 0.04 µs。这个 kernel 在 roofline 上该怎么看?怎么治?

<details><summary>答案</summary>

它的时间 99% 是 launch 开销,不在 roofline 上,是 Day 1 三分法里的 overhead-bound,不是带宽没用好。把它的 AI 标上去点会远低于斜线,但那不说明带宽问题。治法是不单独 launch:融进前后 kernel(fusion)或者 CUDA graph 把整步的 launch 一次发完。

</details>

6. 为什么 W3 每篇都要先写「预期区间」再跑代码?举一个这周如果不写预期就会被漏掉的错。

<details><summary>答案</summary>

因为测量的错不报错,只给一个看起来合理的数。有预期才知道哪个数要查。例子:1 MiB 张量测出 900 GB/s,如果没有「应该是 240 到 290」的预期,会以为卡很好;有预期就知道去查 L2。或者 fp32 测出 7 TFLOP/s,没预期会以为只有 11%,有预期(比 8.1)就知道是 86%。

</details>

## 全周名词总表

按出现顺序,每条一两句。

- **标称值 / nominal**:规格表上的峰值,硬件参数乘出来的理想上限。带宽 = 总线位宽 ÷ 8 × 数据速率;算力 = SM 数 × 单元数 × 每周期 FMA × 2 × boost 时钟。
- **实测屋顶**:用自己测出的带宽 B 和算力 P 画的两条线。判断实测点用它,纸上估算用标称。
- **L2 cache**:全卡共享的片上缓存,T4 4 MB、A100 40 MB。张量小于它测到的是 L2 带宽,数字会超过标称。
- **torch.cuda.Event**:GPU 侧计时,`record()` 在流里打时间戳,`elapsed_time()` 算间隔。和前后 `synchronize` 二选一。
- **2MNK**:M × K 乘 K × N 的 FLOP 数,每个输出格子 K 次乘加。方阵 2N³。
- **tensor core / CUDA core**:tensor core 做小块矩阵乘,fp16/bf16/tf32/int8 的峰值按它算;CUDA core 做标量运算,fp32 峰值按它算。T4 两者差 8 倍。
- **dense / sparse 峰值**:A100 的 312 对 624。624 要 2:4 结构化稀疏,普通模型比 dense。
- **tf32**:Ampere 起的格式,fp32 输入走 tensor core,尾数 10 位。PyTorch 由 `allow_tf32` 控制,T4 没有。
- **tile / wave quantization**:矩阵乘被切成的块,块数不是 SM 数整数倍时最后一波部分 SM 空转。
- **boost / sustained 时钟**:规格表按 boost 算峰值,功耗墙下持续运行只有 sustained,T4 从 1.59 掉到 1.2 到 1.4 GHz。
- **算术强度 AI**:FLOP ÷ 从 HBM 搬的字节,roofline 横坐标。decode batch 1 ≈ 1,方阵 matmul = N ÷ 3,elementwise 0.17 到 1。
- **可达算力**:min(P, B × AI),给定 AI 下屋顶的高度。
- **三段距离**:点到斜线(overhead + kernel 效率)、沿斜线到 ridge(算术强度)、横线本身(卡的极限)。
- **AI(b) / AI_max / b\***:补上 KV 字节后的算术强度、b 无穷大时的天花板、碰屋顶需要的 batch。
- **MFU / HFU**:模型按公式需要的 FLOP ÷ 耗时 ÷ 标称峰值;HFU 分子换成硬件实际执行的 FLOP,总是更好看。报 MFU。
- **fusion**:把几个 memory-bound 的 kernel 合成一个,中间结果不落 HBM。字节少了时间就少,launch 也少。
- **prologue / epilogue**:kernel 开头搬数据、结尾写结果的阶段,和计算不重叠,矩阵小时占比大。

## 全周参考资料汇总

这周反复用到的,按用途归类。

测法与公式

- CUDA C++ Best Practices Guide,「Memory Optimizations」一章,理论带宽与实测带宽的算法。https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/index.html
- NVIDIA《Matrix Multiplication Background User's Guide》,GEMM 的算术强度、tile、wave quantization,Day 14 和 Day 17 的出处。https://docs.nvidia.com/deeplearning/performance/dl-performance-matrix-multiplication/index.html
- NVIDIA《GPU Performance Background User's Guide》,memory-bound 与 math-bound 的官方定义和每种层的归类。https://docs.nvidia.com/deeplearning/performance/dl-performance-gpu-background/index.html
- PyTorch CUDA semantics,异步执行、`synchronize`、`allow_tf32`。https://docs.pytorch.org/docs/stable/notes/cuda.html

规格出处

- NVIDIA Tesla T4 产品页,65 TFLOP/s、320 GB/s、70 W、40 SM。https://www.nvidia.com/en-us/data-center/tesla-t4/
- NVIDIA A100 Datasheet(PDF),312 dense / 624 sparse、2039 GB/s、108 SM、L2 40 MB、400 W。https://www.nvidia.com/content/dam/en-zz/Solutions/Data-Center/a100/pdf/nvidia-a100-datasheet-us-nvidia-1758950-r4-web.pdf

对账

- Kipply,Transformer Inference Arithmetic,batch、KV cache 与算术强度的关系,Day 16 的 AI_max 在它第 4、5 节有同样的推导。https://kipp.ly/transformer-inference-arithmetic/
- Databricks,LLM Inference Performance Engineering: Best Practices,有实测的吞吐对 batch 曲线,拿 Day 16 的预测形状去对。https://www.databricks.com/blog/llm-inference-performance-engineering-best-practices
- PaLM 论文附录 B,MFU 与 HFU 的定义。https://arxiv.org/abs/2204.02311
- Horace He,Making Deep Learning Go Brrrr,三分法,这周每个「点在斜线下方」的解释都回到它。https://horace.io/brrr_intro.html

工具

- Nsight Compute Profiling Guide 的 Roofline Charts 一节,官方工具怎么自动画同一张图,M5 会用。https://docs.nvidia.com/nsight-compute/ProfilingGuide/index.html
- GPU MODE lectures 仓库,Lecture 4、8 的代码。https://github.com/gpu-mode/lectures

视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/lTmYrKwjSOU" title="Lecture 4 Compute and Memory Basics" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>GPU MODE ·《Lecture 4 Compute and Memory Basics》· W3 的理论底。看它讲存储层次、带宽和算力的关系、为什么小 kernel 打不满,对着这周的五道验收题一条条核。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/3H_HUfytgfE" title="The Roofline Model: Why Your GPU Never Hits Peak TFLOPS" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Empiric ·《The Roofline Model: Why Your GPU Never Hits Peak TFLOPS》· 标题就是这周的结论。短,适合复习时看一遍,重点听它怎么解释「点在斜线下方」和「屋顶到不了」是两件事。</figcaption>
</figure>

## 记录表:真值回填

Day 13 到 Day 16 的实测跑完后,把真值填进这里,这一页就从「预期」变成「事实」。

| 项 | 标称 | 预期 | 实测 | 占标称 |
| --- | --- | --- | --- | --- |
| 带宽(256 MiB+ 张量) | 320 GB/s | 240–290 | ______ | ______ % |
| fp16 算力(4096 方阵) | 65 TFLOP/s | 45–58 | ______ | ______ % |
| fp32 算力(4096 方阵) | 8.1 TFLOP/s | 6–7 | ______ | ______ % |
| 实测 ridge | 203 | 170–200 | ______ | |
| 跑 matmul 时 `clocks.sm` | 1.59 GHz | 1.2–1.4 | ______ | |
| decode b=1 TPOT(Day 9) | 6.9 ms 下限 | 10–20 ms | ______ | 屋顶的 ______ % |
| batch 128 每步时间比 b=1 多 | | ≈ 17%(n≈160) | ______ % | |
| 曲线离开线性 >5% 的第一个 batch | | 64(n=256) | ______ | |
| 卡型 / 日期 / 驱动 | | | ______ | |

填完看两件事:实测 ridge 落在 170 到 200 之间,W1 的 153 和 203 那些判断不用改;decode 点在实测屋顶的 40% 到 70% 之间,W2 的比值可以信。两条都成立,M1 前三周的纸和实测就对上了。

## 下周预告:W4

W4 一行 GPU 代码都不写,全是工程杂务。但这周决定了全年会不会因为忘关机超预算,预算失控在这条路上只有这一个原因。W3 用的是 Colab 免费 T4,从 W4 起要开始租卡,规矩得在花钱之前立好。

| Day | 要做的事 | 验收 |
| --- | --- | --- |
| Day 19 · 第一次租 GPU:RunPod / Vast 开 spot 实例,SSH 进去看 nvidia-smi | 两家对比,只充 $10–20 不绑自动续费,选卡、开机、SSH、读懂 `nvidia-smi` 每一列 | 弄清 spot 和 on-demand 的差价与抢占风险 |
| Day 20 · 实例销毁后什么会丢:代码、数据、模型权重各放哪 | 容器盘、network volume、对象存储三种放法的取舍;network volume 关机仍计费 | 一棵决策树,每类文件知道去哪 |
| Day 21 · bootstrap 脚本:从零到能跑代码 5 分钟 | 装依赖、拉代码、写 token、预热模型下载,幂等 | 从零到能跑代码 < 5 分钟,全自动 |
| Day 22 · 三层自动销毁:脚本末尾关机、空闲检测、余额上限 | 三层各防一种失败方式 | 故意跑完一个任务,看实例自己消失 |
| Day 23 · 成本看板:每次实验的 GPU 时长和花费一眼可查 | CSV 记录,启动/销毁脚本自动追加,一段 Python 汇总 | 能立刻回答「这个月花了多少、花在哪个实验上」 |
| Day 24 · W4 复习:一条命令起环境的完整清单、五道验收题、错题本 | 环境 checklist | 路线图 W4 五道题全对 |

W3 那些留空的记录表,也是 W4 租到卡之后要顺手填的。租的如果是 A100,Day 13 到 Day 16 的脚本一个数字都不用改,只换 `NOMINAL_GBPS` 和 `NOMINAL_TFLOPS` 表里的查找项,跑一遍就有第二张卡的 roofline。两张卡放在一起比,W3 的算法才算真的练熟了。
