---
title: 'Day 1 · 让深度学习 Brrrr：三种瓶颈怎么判定'
description: '读 Horace He 的 Brrrr。一段代码跑得慢，只可能卡在三个地方：算力、显存带宽、调度开销。今天学的是怎么判断卡在哪一个，判错了后面所有优化都是白干。附判定流程图、三段式时间线和一个可以在 Colab 上跑的小实验。'
pubDate: 2026-08-30
regime: memory
tags: ['brrrr', 'roofline', 'aiinfra-365']
series: 'aiinfra-365'
day: 1
lang: 'zh'
---

## 今天要解决的问题

W1 的第一天，任务只有一件事：读完 Horace He 那篇《Making Deep Learning Go Brrrr From First Principles》，然后用自己的话写下来，一段深度学习代码跑得慢，到底可能卡在哪里。

这篇文章是整条路线的起点。后面要学的 KV cache、continuous batching、量化、Triton kernel，每一样都是在解这篇文章里说的三种瓶颈之一。如果不知道自己的代码卡在哪一种，调优就是瞎调，运气好了快一点，运气不好白忙一场，而且不知道为什么。

今天结束时要能做到三件事：

1. 说出三种瓶颈的定义、判定方法、典型症状、对应的药，四样一个都不能少。
2. 看到一个操作（矩阵乘、ReLU、softmax）能立刻说出它天生偏哪一种。
3. 回答路线图 D1 的验收题：为什么增大 batch size 有时几乎不增加延迟。

先把标题里那个词说清楚。"brrrr" 是拟声词，机器全速运转的声音。它来自 2020 年的一个梗，"money printer go brrr"，美联储印钞机开到最大的画面。Horace 拿它来指 GPU 全速跑起来的状态。所以文章标题的意思是：从第一性原理出发，怎么让 GPU 真正跑满。反过来说，大部分时候你的 GPU 并没有在 brrrr，它在等。等什么，就是今天要搞清楚的。

## 我是怎么读这篇文章的

这一节记的是过程，不是知识，但对以后复习有用。

这篇文章我不是一口气读完的，是逐句问完的。第一次读到 "brrrr" 不知道是什么，查了。读到 matmul 停下来，先搞清一个矩阵乘法到底做了多少次乘加。读到 pointwise 又停下来，确认 ReLU 是逐元素的意思。读到 "memory bandwidth" 时发现我把它和显存容量混成了一回事，回去补了一段 GPU 的最小模型（下一节就是补出来的东西）。然后 Compute、Bandwidth、Overhead 三节，每一节读完都合上文章，用自己的话复述一遍，复述不出来就再读一遍那一段。

整篇大概花了两个晚上，三个多小时。比「读一篇博客」慢十倍，但这是我第一次读完之后能把内容讲给别人听。以后读技术文章都按这个粒度：卡住的词单独查，每节读完复述，复述不出来不往下走。

## 先补一个概念：GPU 到底在做什么

我是前端出身，之前对 GPU 的理解就是"算得快的芯片"。读这篇之前需要先建一个最小的模型，不然后面工厂比喻接不上。

GPU 干的活可以拆成两件：把数据从显存搬到计算单元，以及在计算单元里做算术。这两件事是分开的硬件、分开的速度。

显存，正式名字叫 HBM（High Bandwidth Memory），是 GPU 板子上的大容量存储。A100 80GB 里那个 80GB 就是它。模型的权重、中间结果都放在这里。它有两个指标，容易混：

- 容量：能放多少东西。80 GB。
- 带宽：每秒能搬多少东西进出。A100 SXM 是 2039 GB/s。

容量决定你能不能把模型装进去，带宽决定装进去之后每秒能读多快。前者是仓库的面积，后者是仓库门口那条路每秒能过多少辆车。这两个数在后面天天用，今天只要记住它们不是一回事。

计算单元这边，指标是 FLOP/s，每秒能做多少次浮点运算。A100 的 BF16 峰值是 312 TFLOP/s，也就是每秒三百一十二万亿次乘法或加法。这个数看着吓人，但它是"如果数据源源不断喂进来"的前提下能达到的上限。数据喂不上，它就闲着。

把这几个数放在一张表里，顺手感受一下量级：

| A100 80GB SXM 的指标 | 数值 | 直观换算 |
| --- | --- | --- |
| 显存容量 | 80 GB | 能装下 fp16 的 7B 模型（13.5 GB）五个还有余 |
| 显存带宽 | 2039 GB/s | 把 80 GB 全读一遍要 39 ms；把 7B 权重读一遍要 6.6 ms |
| BF16 峰值算力 | 312 TFLOP/s | 6.6 ms 里能做约 2 万亿次运算，7B 模型算一个 token 只需要 135 亿次 |
| 算力 ÷ 带宽 | ≈ 153 FLOP/byte | 每搬 1 个字节要配 153 次运算，算力和带宽才同时忙满 |

最后一行那个 153 今天先记个脸，Day 5 会正式介绍它叫 ridge point。今天只需要看第三行：搬一遍权重的时间里，算力能做的运算是实际需要的一百五十倍左右。这个悬殊就是整篇文章的主题。

Horace 的比喻是这样的：算力是工厂，显存是仓库，显存带宽是仓库和工厂之间运货的卡车。工厂再大，卡车运不过来原料，工人就站着等。仓库再大，也不影响运货速度。这个比喻要一直记着，三种瓶颈全靠它区分。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="工厂、仓库、卡车的比喻：仓库是 HBM，卡车是显存带宽，工厂是计算单元">
<rect x="20" y="40" width="170" height="110" rx="6" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1.5"/>
<text x="105" y="70" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">仓库 · HBM</text>
<text x="105" y="94" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">容量 80 GB</text>
<text x="105" y="114" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">放权重、KV cache、激活</text>
<text x="105" y="136" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">面积 ≠ 门口的路宽</text>
<line x1="190" y1="95" x2="450" y2="95" stroke="var(--mem)" stroke-width="3" stroke-dasharray="10 6"/>
<polygon points="450,95 438,88 438,102" fill="var(--mem)"/>
<text x="320" y="80" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">卡车 · 显存带宽 2039 GB/s</text>
<text x="320" y="118" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">每秒最多运 2039 GB，运不完工厂就等</text>
<rect x="450" y="40" width="170" height="110" rx="6" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1.5"/>
<text x="535" y="70" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">工厂 · 计算单元</text>
<text x="535" y="94" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">312 TFLOP/s</text>
<text x="535" y="114" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">原料到了才有活干</text>
<text x="535" y="136" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">再大也得等卡车</text>
<text x="320" y="180" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">第三个角色没画：CPU 是调度员，负责给卡车发单子。单子发得慢，卡车根本不出门。</text>
</svg>
<figcaption>Horace He 的比喻画成图。三种瓶颈就是这张图上三个角色各自拖后腿的情况：工厂满了是 compute-bound，卡车运不过来是 memory-bandwidth-bound，调度员发单太慢是 overhead-bound。</figcaption>
</figure>

## 三种瓶颈

任何一段 GPU 代码的耗时，都可以归到三个桶里。三个桶不是并列的，是"哪个最长哪个决定总时间"。

### Compute-bound：工厂满负荷

定义：计算单元一直有活干，时间花在算术本身。

这是最理想的状态，你的 GPU 真的在 brrrr。判定方法是算实际达到的 FLOP/s，跟峰值比。如果接近峰值，就是 compute-bound。典型症状是：换更快的卡（算力更高）能直接提速，减少数据搬运却没什么用。

能做的优化：换精度（fp32 变 fp16 变 int8，每种精度算力上限不同，tensor core 对低精度快得多）、换算法减少运算次数、上更强的硬件。注意，这一类优化在真实的推理场景里反而最少用到，因为大部分推理代码根本没到这一步。

一个算例。4096 × 4096 的两个 fp16 矩阵相乘：运算量 2 × 4096³ ≈ 1374 亿次 FLOP，读两个矩阵写一个矩阵共 3 × 4096² × 2 字节 ≈ 100 MB。在 A100 上算要 1374e8 ÷ 312e12 ≈ 0.44 ms，搬要 100e6 ÷ 2039e9 ≈ 0.05 ms。算的时间是搬的九倍，工厂满负荷，卡车在门口排队。这就是 compute-bound 的样子。

### Memory-bandwidth-bound：卡车运不过来

定义：计算单元在等数据。时间花在从显存搬数据到计算单元的路上，算术本身很快就做完了。

判定方法是算这段代码搬了多少字节、做了多少运算，两者一比。如果每搬一个字节只做很少的运算，工厂大部分时间在等卡车。典型症状：把数据量减半，时间几乎减半；但是把运算量加倍，时间几乎不变。后面这个症状非常反直觉，但它就是推理里最常见的状态。

能做的优化：少搬数据。具体手段是算子融合（下面讲）、量化（权重从 2 字节变 1 字节，搬的量减半）、增大 batch（一次搬进来的权重给更多 token 用）。

算例换一个：对一个 1 GB 的 fp16 张量做 ReLU。5 亿个元素，每个做 1 次比较，运算量 5 亿 FLOP，A100 只要 5e8 ÷ 312e12 ≈ 0.0016 ms。但要读 1 GB 写 1 GB，2e9 ÷ 2039e9 ≈ 1 ms。搬的时间是算的六百倍。这个 kernel 跑起来 GPU 利用率显示 100%，实际算力用了不到 0.2%。这就是 memory-bandwidth-bound 的样子。

### Overhead-bound：连卡车都没发出去

定义：GPU 在等 CPU。时间花在 Python 解释器、PyTorch 的调度逻辑、把一个个 kernel 发射到 GPU 上的固定开销上。GPU 既没在算也没在搬，它在空转等指令。

判定方法是看 GPU 的时间线上有没有空隙。如果 kernel 和 kernel 之间有大段空白，就是 overhead。典型症状：把 batch size 加大十倍，总时间几乎不变，因为每个 kernel 本身很快，时间都花在发射它们上了；数据量再小也快不了。

能做的优化：减少 kernel 数量（算子融合又出现了）、用 CUDA graphs 把一串 kernel 录下来一次性发射、用 torch.compile 让编译器把 Python 层面的调度去掉。

数量级也给一个。发射一个 kernel 的固定开销在 5 到 10 微秒量级（这是公开资料里常见的数，W2 会自己测）。一个 32 层的 transformer 做一步 decode，每层大约十几个 kernel，整步三四百个 kernel，光发射就是 2 到 4 毫秒。而 Day 5 会算出 7B 模型 batch 1 时搬权重的时间是 6.6 ms。也就是说在 PyTorch eager 模式下，光是发射开销就可能占到一步 decode 的三分之一，这还没算 Python 本身的时间。这个估算是纸上算的，W2 在 profiler 里会看到真实比例。

三个桶对应三种完全不同的药。这就是为什么判定要放在优化之前。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="GPU 时间线示意，分三段：overhead-bound 段有大量空隙，memory-bound 段 kernel 长但算力闲，compute-bound 段算力满">
<text x="20" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">同一条 GPU 时间线上的三种状态（示意，不按真实比例）</text>
<text x="20" y="60" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">CPU</text>
<text x="20" y="110" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">GPU</text>
<line x1="60" y1="130" x2="620" y2="130" stroke="var(--rule)" stroke-width="1"/>
<rect x="60" y="48" width="14" height="16" fill="var(--ink-soft)"/>
<rect x="96" y="48" width="14" height="16" fill="var(--ink-soft)"/>
<rect x="132" y="48" width="14" height="16" fill="var(--ink-soft)"/>
<rect x="168" y="48" width="14" height="16" fill="var(--ink-soft)"/>
<rect x="204" y="48" width="14" height="16" fill="var(--ink-soft)"/>
<rect x="74" y="96" width="8" height="26" fill="var(--ink-soft)"/>
<rect x="110" y="96" width="8" height="26" fill="var(--ink-soft)"/>
<rect x="146" y="96" width="8" height="26" fill="var(--ink-soft)"/>
<rect x="182" y="96" width="8" height="26" fill="var(--ink-soft)"/>
<rect x="218" y="96" width="8" height="26" fill="var(--ink-soft)"/>
<text x="150" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">① overhead-bound</text>
<text x="150" y="178" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">kernel 几微秒就完</text>
<text x="150" y="194" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">GPU 大部分时间空白</text>
<text x="150" y="210" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">药：融合 / CUDA graphs / compile</text>
<rect x="250" y="48" width="14" height="16" fill="var(--ink-soft)"/>
<rect x="250" y="88" width="180" height="34" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1.5"/>
<rect x="250" y="88" width="180" height="6" fill="var(--mem)"/>
<text x="340" y="112" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">搬数据 ████████ 算 ▏</text>
<text x="340" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">② memory-bound</text>
<text x="340" y="178" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">kernel 很长，GPU 忙</text>
<text x="340" y="194" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">但算力只用了 1%</text>
<text x="340" y="210" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">药：少搬字节 / 加 batch / 量化</text>
<rect x="456" y="48" width="14" height="16" fill="var(--ink-soft)"/>
<rect x="456" y="88" width="160" height="34" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1.5"/>
<rect x="456" y="88" width="160" height="34" fill="var(--compute)" opacity="0.55"/>
<text x="536" y="112" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">算 ████████████</text>
<text x="536" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">③ compute-bound</text>
<text x="536" y="178" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">kernel 长，算力满</text>
<text x="536" y="194" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">这才是 brrrr</text>
<text x="536" y="210" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">药：低精度 / 换算法 / 换卡</text>
<text x="20" y="260" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">看图判定：先看 GPU 那一行有没有空白（①）；没有空白再问这个 kernel 是在搬还是在算（② 或 ③）。</text>
<text x="20" y="282" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">nvidia-smi 的「利用率」在 ② 和 ③ 都显示 100%，它区分不了这两种。</text>
<text x="20" y="312" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">深色小块 = CPU 发射 kernel；GPU 行的方块 = kernel 在执行。</text>
</svg>
<figcaption>三种瓶颈在 profiler 时间线上长什么样。W2 会在 Perfetto 里看到真实版本，今天先把这张示意图记住：有空白看 CPU，没空白看字节。</figcaption>
</figure>

## matmul 和 pointwise：两种算子，两种性格

要用上面的框架判断一段代码，得知道代码里的操作各自是什么性格。深度学习里的操作大致两类。

第一类是 matmul，矩阵乘法。两个矩阵相乘，结果矩阵里每一个数字，都是第一个矩阵的一行和第二个矩阵的一列逐个相乘再相加得来的。一个 N×N 的矩阵乘 N×N 的矩阵，要做大约 2N³ 次运算，但只需要读 2N² 个数字。运算量比数据量多了一个 N 倍。N 一大，工厂有大量活可以干，卡车运一趟够工厂忙很久。所以 matmul 天生偏 compute-bound，前提是矩阵够大。

transformer 里的主体就是 matmul：token 向量乘权重矩阵，一层里七次，后面 Day 2 会一个个数。

第二类是 pointwise，逐元素操作。ReLU、加法、乘一个常数、cos、softmax 里的 exp，都是这一类。特点是每读一个数字，做一次运算，写回一个数字。数据量和运算量一比一。卡车运一个原料，工厂加工一下就没事了，然后等下一个。所以 pointwise 操作几乎永远是 memory-bandwidth-bound，它的时间完全由搬了多少字节决定，跟做什么运算无关。

把「每搬一个字节做几次运算」这个比值算出来，两类算子的差距一目了然：

| 操作 | 运算量 | 搬运字节（fp16） | 每字节运算次数 | 对比 A100 的 153 |
| --- | --- | --- | --- | --- |
| N×N matmul，N = 256 | 2N³ ≈ 3.4e7 | 3N² × 2 ≈ 3.9e5 | ≈ 85 | 低于 153，矩阵太小，仍偏 memory-bound |
| N×N matmul，N = 4096 | 2N³ ≈ 1.4e11 | 3N² × 2 ≈ 1.0e8 | ≈ 1365 | 远高于 153，compute-bound |
| 向量 × 矩阵（decode 一个 token 过一层 4096×4096） | 2 × 4096² ≈ 3.4e7 | 4096² × 2 ≈ 3.4e7 | ≈ 1 | 差两个数量级，memory-bound |
| ReLU / cos 等 pointwise | 每元素 1 | 每元素读 2 写 2 = 4 | 0.25 | 永远 memory-bound |

第三行值得多看一眼：同一个 4096 × 4096 的权重矩阵，输入是 4096 个 token 的时候每字节能配 1365 次运算，输入是 1 个 token 的时候只能配 1 次。矩阵没变，变的是有多少行输入在共用这一趟搬运。这就是 prefill 和 decode 性格完全不同的根源，也是 batching 为什么有用的根源，Day 5 会把它算成一张图。

Horace 的例子我印象很深：在 GPU 上，`x.cos()` 和 `x.cos().cos().cos()` 的耗时几乎一样吗？答案是不一样，第二个几乎是第一个的三倍。不是因为 cos 算得慢，是因为每一个 `.cos()` 都要把整个 x 从显存读一遍、算完再写回去一遍。三次 cos 就是三趟往返。算术本身在这里的时间可以忽略。

## 算子融合：让卡车少跑几趟

上面这个例子直接引出算子融合（operator fusion）是什么，以及它为什么是深度学习编译器最核心的优化。

`x.cos().cos()` 不融合的执行方式：

1. 从显存读 x，算 cos，把结果 y 写回显存。
2. 从显存读 y，算 cos，把结果 z 写回显存。

两趟读、两趟写，四次搬运。

融合后：

1. 从显存读 x，算 cos，接着算 cos，把 z 写回显存。

一趟读、一趟写，两次搬运。中间那个 y 根本不落到显存，直接在计算单元的寄存器里传给下一步。数据搬运量减半，对于 memory-bandwidth-bound 的操作，时间就接近减半。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="算子融合前后的显存往返次数对比：不融合四次搬运，融合后两次">
<text x="20" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">x.cos().cos()：不融合 vs 融合</text>
<rect x="20" y="50" width="120" height="200" rx="6" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1.5"/>
<text x="80" y="76" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">HBM</text>
<text x="80" y="104" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">x</text>
<text x="80" y="150" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">y（中间结果）</text>
<text x="80" y="196" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">z</text>
<rect x="210" y="50" width="120" height="200" rx="6" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1.5"/>
<text x="270" y="76" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">计算单元</text>
<text x="270" y="118" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">cos</text>
<text x="270" y="182" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">cos</text>
<line x1="140" y1="100" x2="210" y2="112" stroke="var(--mem)" stroke-width="2"/>
<polygon points="210,112 199,113 202,105" fill="var(--mem)"/>
<line x1="210" y1="124" x2="140" y2="146" stroke="var(--mem)" stroke-width="2"/>
<polygon points="140,146 151,146 148,138" fill="var(--mem)"/>
<line x1="140" y1="154" x2="210" y2="176" stroke="var(--mem)" stroke-width="2"/>
<polygon points="210,176 199,177 202,169" fill="var(--mem)"/>
<line x1="210" y1="188" x2="140" y2="196" stroke="var(--mem)" stroke-width="2"/>
<polygon points="140,196 151,197 148,189" fill="var(--mem)"/>
<text x="175" y="270" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">4 次搬运（读 x、写 y、读 y、写 z）</text>
<rect x="370" y="50" width="120" height="200" rx="6" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1.5"/>
<text x="430" y="76" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">HBM</text>
<text x="430" y="104" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">x</text>
<text x="430" y="196" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">z</text>
<rect x="500" y="50" width="120" height="200" rx="6" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1.5"/>
<text x="560" y="76" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">计算单元</text>
<text x="560" y="130" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">cos</text>
<text x="560" y="150" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">↓ y 留在寄存器</text>
<text x="560" y="170" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">cos</text>
<line x1="490" y1="100" x2="500" y2="124" stroke="var(--mem)" stroke-width="2"/>
<polygon points="500,124 491,120 498,115" fill="var(--mem)"/>
<line x1="500" y1="176" x2="490" y2="196" stroke="var(--mem)" stroke-width="2"/>
<polygon points="490,196 492,186 499,191" fill="var(--mem)"/>
<text x="495" y="270" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">2 次搬运（读 x、写 z）</text>
</svg>
<figcaption>融合前后唯一的区别是中间结果 y 有没有落回显存。对 pointwise 这种 memory-bound 的操作，搬运次数减半，时间就接近减半。torch.compile、Triton 做的最主要的事之一就是这个。</figcaption>
</figure>

推广一下：一连串 pointwise 操作，融合成一个 kernel，搬运量等于一次。这是 torch.compile、Triton、XLA 这些工具在做的最主要的事之一。它对 overhead-bound 也有帮助，因为 kernel 数量少了，发射次数就少了，一箭双雕。

顺便把 kernel 这个词说清楚。kernel 是在 GPU 上跑的一个函数，一次发射就是让 GPU 执行一遍这个函数。PyTorch 里你写的每一个操作，底下基本对应一次或多次 kernel 发射。

transformer 里最典型的融合对象是 FFN 里那串东西：先乘一个矩阵变宽，过一个激活函数（SiLU），再和另一路逐元素相乘，最后乘矩阵变窄。中间的 SiLU 和逐元素乘都是 pointwise，不融合就要多两趟往返，而中间那个向量是 11008 长、比 4096 宽了近三倍，往返成本更高。Day 2 数矩阵的时候会再看到这一段。

## 显存层次：仓库其实有好几级

前面说"显存到计算单元"好像只有一段路，实际上 GPU 内部有一个存储层次，越靠近计算单元越快越小：

- 寄存器：在计算单元里面，最快，每个线程只有一点点。
- SRAM（shared memory / L1 / L2 cache）：在芯片上，快，A100 的 L2 是 40 MB 量级。
- HBM：板子上的大显存，80 GB，带宽 2039 GB/s。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="GPU 存储层次：寄存器、SRAM、HBM、主机内存，越往下容量越大带宽越低">
<rect x="250" y="30" width="140" height="36" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1.5"/>
<text x="320" y="53" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">寄存器</text>
<text x="410" y="53" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">每个 SM 256 KB · 最快</text>
<rect x="200" y="78" width="240" height="36" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1.5"/>
<text x="320" y="101" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">shared memory / L1</text>
<text x="460" y="101" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">每个 SM 192 KB · 十几 TB/s 量级</text>
<rect x="150" y="126" width="340" height="36" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1.5"/>
<text x="320" y="149" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">L2 cache</text>
<text x="510" y="149" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">40 MB · 几 TB/s</text>
<rect x="100" y="174" width="440" height="36" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="2.5"/>
<text x="320" y="197" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">HBM 显存</text>
<text x="560" y="197" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">80 GB · 2039 GB/s</text>
<rect x="50" y="222" width="540" height="30" fill="var(--paper-raised)" stroke="var(--rule)" stroke-width="1.5" stroke-dasharray="6 4"/>
<text x="320" y="242" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">主机内存（走 PCIe 4.0 x16，约 64 GB/s，慢 30 倍）</text>
<text x="20" y="53" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">小 · 快</text>
<text x="20" y="197" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">大 · 慢</text>
</svg>
<figcaption>A100 的存储层次。Brrrr 里说的「memory bandwidth」默认指最粗那条线：HBM 到芯片。算子融合省的就是这一层的往返；FlashAttention 快的核心也是把中间结果留在 SRAM 里不落 HBM。数字取自 NVIDIA 公开规格，SRAM 带宽是量级。</figcaption>
</figure>

从 HBM 读一次的代价比从 SRAM 读贵一个数量级以上。算子融合省的，就是 HBM 这一层的往返。FlashAttention 快的核心原理也是这个：把 attention 的中间结果留在 SRAM 里不落 HBM。今天只要知道有这个层次，Day 5 和 W5 之后会具体量化。

还有一层在图的最底下：主机内存。模型权重最初从硬盘读到主机内存，再通过 PCIe 拷进显存，这条路只有 64 GB/s 左右，比 HBM 慢三十倍。这就是为什么模型加载要几秒到几十秒，而加载完之后每个 token 只要几毫秒：加载走的是最慢的那条路，推理走的是 HBM。W4 算「重下 13.5 GB 权重要多久」时还会用到这个数。

## Overhead：GPU 是异步的

第三种瓶颈需要单独理解一个机制。

CPU 上的 Python 代码往 GPU 发一个 kernel，不是发完等它算完再发下一个。它是把 kernel 丢进一个队列就立刻返回，继续跑下一行 Python。GPU 从队列里按顺序取 kernel 执行。这叫异步执行。

好处是 CPU 可以提前把很多 kernel 排好队，GPU 一个接一个不停地干。坏处是，如果每个 kernel 在 GPU 上只要几微秒就算完，而 CPU 那边 Python 解释器、PyTorch 的类型检查、形状推断、分配内存这一套走下来要几十微秒才能发出下一个，队列就空了，GPU 停下来等。这时候 GPU 的利用率很低，而且不管你怎么优化 kernel 本身都没用，瓶颈在 CPU。

判定的直观办法就是看时间线（profiler 的 trace）。GPU 那一行如果是密密麻麻连成一片，说明它一直在干活；如果是一段一段的小块中间大段空白，就是 overhead-bound。W2 会真正上手看这个。

Batch size 小的时候特别容易掉进这个坑：每个 kernel 处理的数据少，算得极快，CPU 根本来不及喂。这也是为什么小模型、小 batch 的推理，光用 PyTorch eager 模式跑经常慢得离谱，加个 torch.compile 或者 CUDA graphs 能快好几倍，而模型和算法一个字没改。

异步还带来一个测量上的陷阱，W2 第二天会专门讲：因为 CPU 发完 kernel 就返回，如果在 Python 里用 `time.time()` 前后一夹来计时，测到的是「把 kernel 丢进队列的时间」，不是「GPU 算完的时间」，会快得离谱且完全错误。正确做法是计时前后调 `torch.cuda.synchronize()` 等 GPU 把队列清空。今天先记住有这个坑。

## 怎么判定：三个实操方法

读完文章，我给自己整理了三条判定路径，从便宜到贵：

第一条，算算术强度（arithmetic intensity）。就是这段代码做的运算次数除以它搬的字节数，单位 FLOP/byte。这个数低，说明每搬一个字节只做很少运算，偏 memory-bound；这个数高，偏 compute-bound。每张卡有一个临界值，算力除以带宽，A100 大约是 153 FLOP/byte，高于它才算得上 compute-bound。这条纸上就能算，Day 5 会把 7B 模型的 decode 阶段算出来，结果会让人意外。

第二条，看 profiler。torch.profiler 或者 nsys 抓一段 trace，看 GPU 时间线是不是连续的，哪个 kernel 占的时间最多。连续但慢，是前两种；断断续续，是 overhead。这是 W2 的内容。

第三条，做实验。改 batch size，看延迟怎么变。batch 翻倍延迟几乎不变，说明不是 compute-bound，要么在等显存要么在等 CPU；batch 翻倍延迟也翻倍，是 compute-bound。改数据精度，fp32 换 fp16，如果快了一倍左右，说明是在搬数据上花时间。这条最粗糙，但零成本。

<figure>
<svg viewBox="0 0 640 400" role="img" aria-label="三种瓶颈的判定流程图：先看时间线有没有空隙，再比算术强度和 ridge point">
<rect x="220" y="16" width="200" height="44" rx="6" fill="var(--paper-raised)" stroke="var(--ink)" stroke-width="1.5"/>
<text x="320" y="36" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">这段代码慢</text>
<text x="320" y="52" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">先抓一段 profiler trace</text>
<line x1="320" y1="60" x2="320" y2="90" stroke="var(--ink-soft)" stroke-width="1.5"/>
<polygon points="320,92 315,84 325,84" fill="var(--ink-soft)"/>
<rect x="190" y="92" width="260" height="44" rx="6" fill="var(--paper-raised)" stroke="var(--ink)" stroke-width="1.5"/>
<text x="320" y="112" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">GPU 时间线上有大段空白？</text>
<text x="320" y="128" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">或：batch ×10 时间几乎不变且 kernel 都极短</text>
<line x1="190" y1="114" x2="110" y2="114" stroke="var(--ink-soft)" stroke-width="1.5"/>
<line x1="110" y1="114" x2="110" y2="170" stroke="var(--ink-soft)" stroke-width="1.5"/>
<polygon points="110,172 105,164 115,164" fill="var(--ink-soft)"/>
<text x="150" y="108" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">是</text>
<rect x="30" y="172" width="160" height="70" rx="6" fill="var(--paper-raised)" stroke="var(--ink-soft)" stroke-width="2"/>
<text x="110" y="196" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">overhead-bound</text>
<text x="110" y="214" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">GPU 在等 CPU</text>
<text x="110" y="230" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">融合 · CUDA graphs · compile</text>
<line x1="320" y1="136" x2="320" y2="166" stroke="var(--ink-soft)" stroke-width="1.5"/>
<polygon points="320,168 315,160 325,160" fill="var(--ink-soft)"/>
<text x="340" y="156" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">否</text>
<rect x="190" y="168" width="260" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--ink)" stroke-width="1.5"/>
<text x="320" y="190" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">算术强度 = FLOP ÷ 字节</text>
<text x="320" y="208" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">和这张卡的 ridge point 比（A100 ≈ 153）</text>
<line x1="250" y1="224" x2="160" y2="300" stroke="var(--mem)" stroke-width="1.5"/>
<polygon points="158,302 160,292 167,299" fill="var(--mem)"/>
<text x="190" y="256" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">低于 153</text>
<line x1="390" y1="224" x2="480" y2="300" stroke="var(--compute)" stroke-width="1.5"/>
<polygon points="482,302 473,299 480,292" fill="var(--compute)"/>
<text x="450" y="256" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">高于 153</text>
<rect x="60" y="304" width="200" height="76" rx="6" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="2"/>
<text x="160" y="328" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">memory-bandwidth-bound</text>
<text x="160" y="346" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">症状：数据减半时间减半，运算加倍时间不变</text>
<text x="160" y="364" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">融合 · 量化 · 加 batch</text>
<rect x="380" y="304" width="200" height="76" rx="6" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="2"/>
<text x="480" y="328" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">compute-bound</text>
<text x="480" y="346" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">症状：换更快的卡直接提速</text>
<text x="480" y="364" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">低精度 · 换算法 · 换卡</text>
</svg>
<figcaption>判定顺序很重要：先排除 overhead，因为 overhead-bound 的时候算术强度根本不是问题，算它没意义。ridge point 那个 153 是 A100 的数，换卡要重算，Day 5 讲怎么算。</figcaption>
</figure>

三条路径合成一张表，以后对着查：

| 判定路径 | 成本 | 能区分什么 | 区分不了什么 | 在路线里哪天用 |
| --- | --- | --- | --- | --- |
| 算算术强度 | 零，纸笔 | memory-bound 还是 compute-bound | 看不到 overhead，纸上假设 GPU 一直有活 | Day 5 |
| 看 profiler 时间线 | 要跑起来，要会看 | 三种都能分，还能定位到具体 kernel | 需要环境，profiler 自身有开销 | W2 |
| 改 batch / 改精度做实验 | 低，改一个参数 | 是不是 compute-bound | memory 和 overhead 分不开 | W3 |

## 动手小练习：在 Colab 上看一眼 cos 的三趟往返

W1 说好零代码，但这个实验只有十行，而且是把今天最反直觉的那句话变成自己眼睛看到的数字。打开 Colab、选 GPU 运行时（免费 T4 就够），跑：

```python
import torch, time

x = torch.randn(256 * 1024 * 1024 // 2, device="cuda", dtype=torch.float16)  # 256 MB 的张量

def timeit(fn, n=20):
    for _ in range(3):                 # warmup：第一次会有 kernel 加载等一次性开销
        fn()
    torch.cuda.synchronize()           # 等 GPU 把队列里的活全干完再开始计时
    t0 = time.perf_counter()
    for _ in range(n):
        fn()
    torch.cuda.synchronize()           # 不加这一行，测到的是「发射」时间，不是「执行」时间
    return (time.perf_counter() - t0) / n * 1e3   # ms

t1 = timeit(lambda: x.cos())
t3 = timeit(lambda: x.cos().cos().cos())
print(f"cos x1: {t1:.3f} ms   cos x3: {t3:.3f} ms   ratio: {t3 / t1:.2f}")

# 融合版本：让 torch.compile 把三次 cos 合成一个 kernel
fused = torch.compile(lambda t: t.cos().cos().cos())
fused(x)                                # 第一次调用触发编译，会慢很多，不算
tf = timeit(lambda: fused(x))
print(f"fused x3: {tf:.3f} ms   vs eager x3: {t3:.3f} ms")
```

预期能看到什么（这是按带宽算的预期，不是我的实测，实测数字以后填到下面的表里）：256 MB 的张量读一遍写一遍是 512 MB，T4 带宽 320 GB/s，一次 cos 约 1.6 ms；三次 cos 约三倍；融合后回到接近一次的水平。如果第一行的比值明显小于 2，大概率是忘了 synchronize，或者张量太小被 L2 cache 吃掉了，把张量再放大四倍试试。

| 记录 | 我的实测（ms） | 按带宽算的预期（T4） |
| --- | --- | --- |
| `x.cos()` | | ≈ 1.6 |
| `x.cos().cos().cos()` eager | | ≈ 4.8 |
| 三次 cos，torch.compile 融合后 | | ≈ 1.6 到 2 |
| eager 三次 ÷ 一次 | | ≈ 3 |

这个实验做完，「算得少不等于快，搬得少才快」这句话就不再是文章里的一句话了。

## 验收题：为什么增大 batch size 有时几乎不增加延迟

这是 D1 的验收题，能答出来才算过。我用今天的框架答一遍。

推理的时候，模型每生成一个 token，都要把全部权重从显存搬到计算单元用一遍。7B 模型 fp16 的权重是 13.5 GB，这是一趟固定的搬运成本，不管你这一步在给一个请求算还是给三十二个请求算。

batch = 1 时，搬一趟 13.5 GB，只服务了一个 token。计算单元拿到这些权重做的运算很少，一乘一加，很快就做完了，然后等下一批权重运过来。这是典型的 memory-bandwidth-bound，工厂在等卡车。

batch = 32 时，权重还是搬一趟 13.5 GB，但这一趟运过来的权重被三十二个 token 一起用了。运算量是原来的三十二倍，可是计算单元本来就闲着，三十二倍的活它也能在等下一趟卡车的时间里干完。所以总时间几乎没变，多出来的三十一个 token 是搭便车的。

换成一句话：只要还在 memory-bound 这一侧，搬运是固定成本，多算是免费的。加大 batch 就是在往 compute-bound 那一侧走，走到临界点之前延迟几乎不涨，吞吐白涨。

「有时」两个字也要答到。什么时候加 batch 会增加延迟？两种情况。一是已经走到了 compute-bound 那一侧，工厂满了，再加活就得排队，延迟开始线性涨；二是 batch 大到 KV cache 装不进显存，那就不是慢的问题，是直接 OOM。所以这句话的完整版是：在 memory-bound 区间内、显存装得下的前提下，增大 batch 几乎不增加延迟。

Day 5 会用具体数字把这件事算出来：搬一趟要多少毫秒，算一个 token 要多少毫秒，batch 加到多大两者持平。那个数是整个 W1 最重要的一个数。

## 三种瓶颈在 transformer 推理里各自出现在哪

今天学的是通用框架，但这条路线只关心一种程序：transformer 推理。所以顺手把推理过程里的每一段对到三个桶里，后面几周每碰到一段就回来对一次，看当初的判断准不准。

| 推理里的这一段 | 在做什么 | 天生偏哪种 | 为什么 |
| --- | --- | --- | --- |
| prefill：把整段 prompt 一次喂进去 | 几千个 token 同时过每一层的矩阵 | compute-bound | 几千行输入共用一趟权重搬运，每字节配几千次运算，远超 153 |
| decode，batch 1：一次生成一个 token | 一个 token 过全部权重 | memory-bound | 一行输入独占一趟 13.5 GB 的搬运，每字节配 1 次运算 |
| decode，batch 32 | 32 个 token 共用一趟权重 | 仍是 memory-bound，但在往右走 | 每字节 32 次运算，还没到 153 |
| decode，小模型 + PyTorch eager | 每层十几个小 kernel，每个几微秒 | overhead-bound | kernel 太短，CPU 发不过来，GPU 时间线上全是缝 |
| attention 里 q 和 k 算相似度、加权 v（长上下文） | token 之间两两运算，和序列长度平方成正比 | 短序列时可忽略；几万 token 以上变成 compute-bound 的大头 | 运算量 n²，Day 4 会算什么时候追上参数项 |
| softmax、RMSNorm、SiLU、残差加 | 逐元素或逐行操作 | memory-bound | pointwise 性格，每字节不到 1 次运算，融合的主要对象 |
| 采样：从概率里挑下一个 token | 一堆小操作加 CPU 逻辑 | overhead-bound | 数据量极小，时间全在调度上 |
| 模型加载：权重从硬盘进显存 | 走 PCIe | 带宽受限，但受限的是 PCIe 不是 HBM | 64 GB/s，13.5 GB 要三秒多，和推理速度无关 |

看这张表能得出三个后面反复用的结论。第一，同一个模型在 prefill 和 decode 两个阶段落在完全不同的桶里，所以「这个模型 memory-bound 还是 compute-bound」这个问题本身不成立，要问的是「哪个阶段」。第二，推理里大部分时间花在 decode，decode 大部分情况是 memory-bound，所以推理优化的主战场是「少搬字节」和「让每趟搬运服务更多 token」，前者是量化，后者是 batching。第三，overhead-bound 不是理论上的边缘情况，小 batch 跑 eager 就会撞上，W2 在 Colab 上大概率第一眼看到的就是它。

## 三种瓶颈换成钱

这条路最后要交的是「成本降了多少」这种数字，所以把三个桶换算成钱再看一遍。

租一张 A100 一小时 1 到 2 美元，买的是它的全部算力和带宽。decode batch 1 时算力用了不到 1%，剩下 99% 的算力是付了钱没用上的。这不是浪费，是物理限制，但它意味着一件事：**同一张卡、同一份租金，从 batch 1 提到 batch 32，每小时产出的 token 数涨 32 倍，每个 token 的成本降到三十二分之一**，而延迟几乎没变。这是 batching 在成本上的全部意义，也是为什么产出物 01 的四个数字里有一个是「每百万 token 成本」。

量化的账也一样。权重从 2 字节压到 1 字节，搬运时间减半，同样租金下 token 产出翻倍。它的代价是精度，所以 W7 要测精度、速度、显存的三角，不能只报快了多少。

overhead 换成钱最难看：GPU 在等 CPU 的时候，租金照付，没有任何产出。所以 torch.compile 和 CUDA graphs 这类零成本的手段，在成本报告里往往是收益最大的第一步。

三个桶各自的药，加上对应的成本效果，合成一张表放在这里，后面写报告时照着填：

| 瓶颈 | 药 | 对成本的作用 | 路线里哪周碰 |
| --- | --- | --- | --- |
| memory-bound | 增大 batch（continuous batching） | 同租金下 token 产出线性涨，直到 ridge point | W6，M3 |
| memory-bound | 量化到 int8 / int4 | 搬运减半或减四分之三，产出翻倍以上，精度要单独测 | W7，M4 |
| memory-bound | 算子融合（FlashAttention、fused FFN） | 少几趟 HBM 往返，中间量不落显存 | M5 |
| compute-bound | 低精度 tensor core、换算法、换卡 | 提高单位时间运算量；prefill 阶段主要靶子 | M5，M7 |
| overhead-bound | torch.compile、CUDA graphs、减少 kernel 数 | 把付了钱没用的 GPU 空转时间收回来，通常零硬件成本 | W2 看到，M3 用上 |

## 名词解释

| 术语 | 一句话解释 |
| --- | --- |
| FLOP | 一次浮点运算（一次乘法或一次加法），是运算量的单位 |
| FLOP/s（常写 FLOPS） | 每秒多少次浮点运算，是算力的单位；TFLOP/s 是每秒万亿次 |
| HBM | GPU 板载的高带宽显存，容量大、离计算单元远，A100 是 80 GB |
| 显存带宽 | HBM 每秒能读写多少字节，A100 SXM 是 2039 GB/s；和容量是两个独立的指标 |
| SRAM | 芯片上的高速小容量存储（shared memory、L1/L2 cache），比 HBM 快一个数量级以上 |
| PCIe | 主机内存和显存之间的通道，4.0 x16 约 64 GB/s，比 HBM 慢三十倍，模型加载走这里 |
| SM | Streaming Multiprocessor，GPU 里的一个计算分区，A100 有 108 个，每个有自己的寄存器和 shared memory，Day 25 细讲 |
| tensor core | SM 里专做小块矩阵乘的单元，fp16/bf16 的 312 TFLOP/s 峰值靠它 |
| matmul | 矩阵乘法，运算量随矩阵尺寸三次方增长而数据量只是二次方，所以大矩阵偏 compute-bound |
| pointwise | 逐元素操作（ReLU、加法、cos 等），每个数读一次算一次写一次，几乎永远 memory-bound |
| kernel | 在 GPU 上执行的一个函数；PyTorch 每个操作底下对应一次或多次 kernel 发射 |
| kernel launch | CPU 把一个 kernel 丢进 GPU 队列的动作，有固定的微秒级开销 |
| 算子融合 | 把多个连续操作合成一个 kernel，中间结果不落显存，减少搬运次数和发射次数 |
| torch.compile | PyTorch 2 的编译入口，会自动做算子融合并去掉 Python 层调度，对 pointwise 串和小 batch 收益最大 |
| CUDA graphs | 把一串 kernel 的发射序列录下来，之后一次提交整串，把 launch 开销从 N 次压到 1 次 |
| overhead | 不算不搬的时间：Python 解释、PyTorch 调度、kernel 发射；GPU 在等 CPU |
| 异步执行 | CPU 把 kernel 丢进队列就返回，GPU 按序执行；计时必须 synchronize |
| 算术强度 | 运算次数 ÷ 搬运字节数，单位 FLOP/byte，判定 memory-bound 还是 compute-bound 的核心指标 |
| ridge point | 一张卡的算力 ÷ 带宽，算术强度到这个值算力和带宽同时忙满，A100 ≈ 153，Day 5 详讲 |
| compute-bound | 时间花在算术上，计算单元满负荷 |
| memory-bandwidth-bound | 时间花在搬数据上，计算单元在等 |
| overhead-bound | 时间花在等 CPU 发指令上，GPU 空转 |

## 常见误区

**GPU 利用率高不等于跑得快**。nvidia-smi 里那个百分比只表示"有 kernel 在 GPU 上跑"，一个 memory-bound 的 kernel 把利用率顶到 100%，计算单元可能只用了 1%。上面那个 1 GB ReLU 的算例就是：利用率 100%，算力用了 0.2%。

**显存够大不等于快**。80 GB 是容量，跟每秒能搬多少无关。同样 80 GB 的两张卡，带宽差一倍，memory-bound 的推理速度就差一倍。我第一次读 Brrrr 就是把这两个数混成了一个，回头补了一节才接得上。

**算得少不等于快**。`x.cos().cos()` 比 `x.cos()` 慢两倍多，不是因为多算了两次 cos，是因为多搬了两趟。优化的目标经常不是减少运算，是减少搬运。

**小模型不等于容易跑满**。小模型每个 kernel 算得快，更容易掉进 overhead-bound，GPU 大部分时间在等 Python。

**三种瓶颈不是三选一的标签贴在整个程序上**。一个程序里 matmul 部分可能 compute-bound，softmax 部分 memory-bound，中间夹着 overhead。要按 kernel 看。

**「matmul 是 compute-bound」有前提**。前提是矩阵够大，或者说有足够多行输入共用一趟权重搬运。decode 阶段一个 token 过一个 4096 × 4096 的矩阵，形状上是 matmul，性格上是 memory-bound，每字节只配 1 次运算。看到 matmul 先问一句：这一趟权重服务了多少行。

**用 `time.time()` 直接夹住 GPU 代码计时**。测到的是发射时间，能比真实时间快几个数量级。W2 第二天专门讲，今天的小练习里已经写对了。

## 参考资料

### 文章

- Horace He，《Making Deep Learning Go Brrrr From First Principles》，https://horace.io/brrr_intro.html 。今天的全部内容都来自这一篇，建议逐段读，读不懂的句子单独查。
- Williams, Waterman, Patterson，《Roofline: An Insightful Visual Performance Model for Multicore Architectures》，2009。算术强度和 ridge point 这套方法的原始论文，按标题搜索。
- PyTorch 团队，《Accelerating Generative AI with PyTorch II: GPT, Fast》，https://pytorch.org/blog/accelerating-generative-ai-2/ 。Horace 参与的博客，把今天三种瓶颈的药（compile、量化、speculative decoding）一个个加到纯 PyTorch 推理上，每步给数字。现在读一遍看不懂没关系，M2 结束再读会全懂。
- NVIDIA，《Getting Started with CUDA Graphs》，https://developer.nvidia.com/blog/cuda-graphs/ 。overhead-bound 那一味药的官方说明，前半部分讲 launch 开销为什么存在。
- PyTorch 文档，torch.compile 总览，https://docs.pytorch.org/docs/stable/torch.compiler.html 。小练习里那个 `torch.compile` 是什么、能做什么。

### 视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/139UPjoq7Kw" title="Horace He: Building Machine Learning Systems for a Trillion Trillion Floating Point Operations" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Horace He · Building Machine Learning Systems for a Trillion Trillion Floating Point Operations（Jane Street 演讲）。Brrrr 作者本人把文章讲成了一小时的报告，前半段就是三种瓶颈和工厂比喻，后半段讲 torch.compile 怎么对症下药。读完文章再看，很多句子会对上。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LuhJEEJQgUM" title="GPU MODE Lecture 1: How to profile CUDA kernels in PyTorch" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>GPU MODE · Lecture 1: How to profile CUDA kernels in PyTorch。今天说的「看时间线判定」在这一讲里第一次动手，主讲人用 torch.profiler 抓 trace、看 kernel。W2 的 Day 10 会照着做，现在先看前二十分钟感受一下 trace 长什么样。</figcaption>
</figure>

- GPU MODE 系列讲座的课件和录像索引在 https://github.com/gpu-mode/lectures 。前几讲是 profiling 和 PyTorch 性能基础，跟今天的内容对应。

## 自测

合上笔记再答。

**1. 一段代码把 batch size 从 8 加到 64，延迟从 10 ms 变成 11 ms。它最可能卡在哪种瓶颈？为什么排除另外两种？**

<details><summary>答案</summary>

不是 compute-bound。如果是，运算量涨八倍，延迟应该接近涨八倍。剩下 memory-bandwidth-bound 和 overhead-bound 两种可能，单凭这个实验区分不开，要看 profiler 的时间线：GPU 连续忙碌就是在等显存，断断续续就是在等 CPU。对推理里的大模型 decode 阶段，通常是前者。

</details>

**2. `x.cos()` 和 `x.cos().cos()` 在 GPU 上耗时差多少？原因是什么？算子融合之后会变成什么样？**

<details><summary>答案</summary>

差大约一倍，第二个是第一个的两倍左右。原因不是多算了一次 cos，是多了一趟显存往返：第一次的结果要写回显存，第二次再读出来。cos 是 pointwise 操作，时间由搬运决定。融合后两次 cos 在一个 kernel 里做完，中间结果留在寄存器，只有一趟读一趟写，耗时回到接近 `x.cos()` 一次的水平。

</details>

**3. 显存容量和显存带宽各自决定什么？举一个只跟容量有关、一个只跟带宽有关的现象。**

<details><summary>答案</summary>

容量决定能装下多大的模型和多少 KV cache，装不下就 OOM，这跟快慢无关。带宽决定每秒能把多少权重搬到计算单元，直接决定 memory-bound 阶段每个 token 的生成速度。OOM 是容量问题；decode 每秒只能出 150 个 token 是带宽问题。

</details>

**4. matmul 为什么偏 compute-bound，pointwise 为什么偏 memory-bound？用运算量和数据量的比来解释。这个结论对 decode 阶段的矩阵乘成立吗？**

<details><summary>答案</summary>

N×N 矩阵相乘做约 2N³ 次运算，只读 2N² 个数，运算量是数据量的 N 倍量级，矩阵越大每个字节能配的运算越多，容易把计算单元喂满。pointwise 每读一个数做一次运算，比值固定是一比一左右，无论数据多大都在等搬运。对 decode 不成立：一个 token 的向量乘 4096 × 4096 的矩阵，运算 2 × 4096² 次，搬 4096² × 2 字节，每字节只配 1 次运算，形状上是 matmul，性格上是 memory-bound。关键不是矩阵多大，是有多少行输入共用一趟搬运。

</details>

**5. 一个小模型用 PyTorch eager 跑推理，GPU 利用率只有 20%，加了 torch.compile 之后快了三倍。发生了什么？**

<details><summary>答案</summary>

原来是 overhead-bound：每个 kernel 算得很快，CPU 那边 Python 和 PyTorch 调度来不及发下一个，GPU 大部分时间空转等指令。torch.compile 做了两件事，把多个 pointwise 操作融合成更少的 kernel，减少了发射次数；并且把 Python 层的调度逻辑编译掉，CPU 发指令变快了。模型和算法都没变，只是 GPU 不再等 CPU。

</details>

**6. 对一个 1 GB 的 fp16 张量做 ReLU，A100 上算术要多久、搬运要多久？这个 kernel 跑的时候 nvidia-smi 显示多少利用率？**

<details><summary>答案</summary>

5 亿个元素各做 1 次比较，5e8 ÷ 312e12 ≈ 0.0016 ms。读 1 GB 写 1 GB，2e9 ÷ 2039e9 ≈ 1 ms。搬运是算术的六百倍，典型 memory-bound。nvidia-smi 会显示接近 100%，因为它只看有没有 kernel 在跑，不看算力用了多少；实际算力利用率不到 0.2%。

</details>

**7. 用工厂比喻各说一句：三种瓶颈分别是什么画面？**

<details><summary>答案</summary>

compute-bound：工厂满负荷运转，卡车在门口排队等卸货。memory-bandwidth-bound：工人站着等，卡车在路上还没到。overhead-bound：卡车停在仓库里没发车，调度员还在填单子。

</details>

## 明天预告

Day 2 打开 transformer 的零件图：一个 7B 模型到底是由哪几张矩阵组成的，每张多大，怎么把它们加起来对账到 6.74B 个参数，再算出 fp16 下要占 13.5 GB 显存。今天说的"搬一趟权重"的那个 13.5 GB，明天亲手算出来。
