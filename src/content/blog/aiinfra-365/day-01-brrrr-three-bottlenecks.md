---
title: 'Day 1 · 让深度学习 Brrrr：三种瓶颈怎么判定'
description: '读 Horace He 的 Brrrr。一段代码跑得慢，只可能卡在三个地方：算力、显存带宽、调度开销。今天学的是怎么判断卡在哪一个，判错了后面所有优化都是白干。'
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

先把标题里那个词说清楚。"brrrr" 是拟声词，机器全速运转的声音。它来自 2020 年的一个梗，"money printer go brrr"，美联储印钞机开到最大的画面。Horace 拿它来指 GPU 全速跑起来的状态。所以文章标题的意思是：从第一性原理出发，怎么让 GPU 真正跑满。反过来说，大部分时候你的 GPU 并没有在 brrrr，它在等。等什么，就是今天要搞清楚的。

## 先补一个概念：GPU 到底在做什么

我是前端出身，之前对 GPU 的理解就是"算得快的芯片"。读这篇之前需要先建一个最小的模型，不然后面工厂比喻接不上。

GPU 干的活可以拆成两件：把数据从显存搬到计算单元，以及在计算单元里做算术。这两件事是分开的硬件、分开的速度。

显存，正式名字叫 HBM（High Bandwidth Memory），是 GPU 板子上的大容量存储。A100 80GB 里那个 80GB 就是它。模型的权重、中间结果都放在这里。它有两个指标，容易混：

- 容量：能放多少东西。80 GB。
- 带宽：每秒能搬多少东西进出。A100 SXM 是 2039 GB/s。

容量决定你能不能把模型装进去，带宽决定装进去之后每秒能读多快。前者是仓库的面积，后者是仓库门口那条路每秒能过多少辆车。这两个数在后面天天用，今天只要记住它们不是一回事。

计算单元这边，指标是 FLOP/s，每秒能做多少次浮点运算。A100 的 BF16 峰值是 312 TFLOP/s，也就是每秒三百一十二万亿次乘法或加法。这个数看着吓人，但它是"如果数据源源不断喂进来"的前提下能达到的上限。数据喂不上，它就闲着。

Horace 的比喻是这样的：算力是工厂，显存是仓库，显存带宽是仓库和工厂之间运货的卡车。工厂再大，卡车运不过来原料，工人就站着等。仓库再大，也不影响运货速度。这个比喻要一直记着，三种瓶颈全靠它区分。

## 三种瓶颈

任何一段 GPU 代码的耗时，都可以归到三个桶里。三个桶不是并列的，是"哪个最长哪个决定总时间"。

### Compute-bound：工厂满负荷

定义：计算单元一直有活干，时间花在算术本身。

这是最理想的状态，你的 GPU 真的在 brrrr。判定方法是算实际达到的 FLOP/s，跟峰值比。如果接近峰值，就是 compute-bound。典型症状是：换更快的卡（算力更高）能直接提速，减少数据搬运却没什么用。

能做的优化：换精度（fp32 变 fp16 变 int8，每种精度算力上限不同，tensor core 对低精度快得多）、换算法减少运算次数、上更强的硬件。注意，这一类优化在真实的推理场景里反而最少用到，因为大部分推理代码根本没到这一步。

### Memory-bandwidth-bound：卡车运不过来

定义：计算单元在等数据。时间花在从显存搬数据到计算单元的路上，算术本身很快就做完了。

判定方法是算这段代码搬了多少字节、做了多少运算，两者一比。如果每搬一个字节只做很少的运算，工厂大部分时间在等卡车。典型症状：把数据量减半，时间几乎减半；但是把运算量加倍，时间几乎不变。后面这个症状非常反直觉，但它就是推理里最常见的状态。

能做的优化：少搬数据。具体手段是算子融合（下面讲）、量化（权重从 2 字节变 1 字节，搬的量减半）、增大 batch（一次搬进来的权重给更多 token 用）。

### Overhead-bound：连卡车都没发出去

定义：GPU 在等 CPU。时间花在 Python 解释器、PyTorch 的调度逻辑、把一个个 kernel 发射到 GPU 上的固定开销上。GPU 既没在算也没在搬，它在空转等指令。

判定方法是看 GPU 的时间线上有没有空隙。如果 kernel 和 kernel 之间有大段空白，就是 overhead。典型症状：把 batch size 加大十倍，总时间几乎不变，因为每个 kernel 本身很快，时间都花在发射它们上了；数据量再小也快不了。

能做的优化：减少 kernel 数量（算子融合又出现了）、用 CUDA graphs 把一串 kernel 录下来一次性发射、用 torch.compile 让编译器把 Python 层面的调度去掉。

三个桶对应三种完全不同的药。这就是为什么判定要放在优化之前。

## matmul 和 pointwise：两种算子，两种性格

要用上面的框架判断一段代码，得知道代码里的操作各自是什么性格。深度学习里的操作大致两类。

第一类是 matmul，矩阵乘法。两个矩阵相乘，结果矩阵里每一个数字，都是第一个矩阵的一行和第二个矩阵的一列逐个相乘再相加得来的。一个 N×N 的矩阵乘 N×N 的矩阵，要做大约 2N³ 次运算，但只需要读 2N² 个数字。运算量比数据量多了一个 N 倍。N 一大，工厂有大量活可以干，卡车运一趟够工厂忙很久。所以 matmul 天生偏 compute-bound，前提是矩阵够大。

transformer 里的主体就是 matmul：token 向量乘权重矩阵，一层里七次，后面 Day 2 会一个个数。

第二类是 pointwise，逐元素操作。ReLU、加法、乘一个常数、cos、softmax 里的 exp，都是这一类。特点是每读一个数字，做一次运算，写回一个数字。数据量和运算量一比一。卡车运一个原料，工厂加工一下就没事了，然后等下一个。所以 pointwise 操作几乎永远是 memory-bandwidth-bound，它的时间完全由搬了多少字节决定，跟做什么运算无关。

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

推广一下：一连串 pointwise 操作，融合成一个 kernel，搬运量等于一次。这是 torch.compile、Triton、XLA 这些工具在做的最主要的事之一。它对 overhead-bound 也有帮助，因为 kernel 数量少了，发射次数就少了，一箭双雕。

顺便把 kernel 这个词说清楚。kernel 是在 GPU 上跑的一个函数，一次发射就是让 GPU 执行一遍这个函数。PyTorch 里你写的每一个操作，底下基本对应一次或多次 kernel 发射。

## 显存层次：仓库其实有好几级

前面说"显存到计算单元"好像只有一段路，实际上 GPU 内部有一个存储层次，越靠近计算单元越快越小：

- 寄存器：在计算单元里面，最快，每个线程只有一点点。
- SRAM（shared memory / L1 / L2 cache）：在芯片上，快，A100 的 L2 是 40 MB 量级。
- HBM：板子上的大显存，80 GB，带宽 2039 GB/s。

从 HBM 读一次的代价比从 SRAM 读贵一个数量级以上。算子融合省的，就是 HBM 这一层的往返。FlashAttention 快的核心原理也是这个：把 attention 的中间结果留在 SRAM 里不落 HBM。今天只要知道有这个层次，Day 5 和 W5 之后会具体量化。

## Overhead：GPU 是异步的

第三种瓶颈需要单独理解一个机制。

CPU 上的 Python 代码往 GPU 发一个 kernel，不是发完等它算完再发下一个。它是把 kernel 丢进一个队列就立刻返回，继续跑下一行 Python。GPU 从队列里按顺序取 kernel 执行。这叫异步执行。

好处是 CPU 可以提前把很多 kernel 排好队，GPU 一个接一个不停地干。坏处是，如果每个 kernel 在 GPU 上只要几微秒就算完，而 CPU 那边 Python 解释器、PyTorch 的类型检查、形状推断、分配内存这一套走下来要几十微秒才能发出下一个，队列就空了，GPU 停下来等。这时候 GPU 的利用率很低，而且不管你怎么优化 kernel 本身都没用，瓶颈在 CPU。

判定的直观办法就是看时间线（profiler 的 trace）。GPU 那一行如果是密密麻麻连成一片，说明它一直在干活；如果是一段一段的小块中间大段空白，就是 overhead-bound。W2 会真正上手看这个。

Batch size 小的时候特别容易掉进这个坑：每个 kernel 处理的数据少，算得极快，CPU 根本来不及喂。这也是为什么小模型、小 batch 的推理，光用 PyTorch eager 模式跑经常慢得离谱，加个 torch.compile 或者 CUDA graphs 能快好几倍，而模型和算法一个字没改。

## 怎么判定：三个实操方法

读完文章，我给自己整理了三条判定路径，从便宜到贵：

第一条，算算术强度（arithmetic intensity）。就是这段代码做的运算次数除以它搬的字节数，单位 FLOP/byte。这个数低，说明每搬一个字节只做很少运算，偏 memory-bound；这个数高，偏 compute-bound。每张卡有一个临界值，算力除以带宽，A100 大约是 153 FLOP/byte，高于它才算得上 compute-bound。这条纸上就能算，Day 5 会把 7B 模型的 decode 阶段算出来，结果会让人意外。

第二条，看 profiler。torch.profiler 或者 nsys 抓一段 trace，看 GPU 时间线是不是连续的，哪个 kernel 占的时间最多。连续但慢，是前两种；断断续续，是 overhead。这是 W2 的内容。

第三条，做实验。改 batch size，看延迟怎么变。batch 翻倍延迟几乎不变，说明不是 compute-bound，要么在等显存要么在等 CPU；batch 翻倍延迟也翻倍，是 compute-bound。改数据精度，fp32 换 fp16，如果快了一倍左右，说明是在搬数据上花时间。这条最粗糙，但零成本。

## 验收题：为什么增大 batch size 有时几乎不增加延迟

这是 D1 的验收题，能答出来才算过。我用今天的框架答一遍。

推理的时候，模型每生成一个 token，都要把全部权重从显存搬到计算单元用一遍。7B 模型 fp16 的权重是 13.5 GB，这是一趟固定的搬运成本，不管你这一步在给一个请求算还是给三十二个请求算。

batch = 1 时，搬一趟 13.5 GB，只服务了一个 token。计算单元拿到这些权重做的运算很少，一乘一加，很快就做完了，然后等下一批权重运过来。这是典型的 memory-bandwidth-bound，工厂在等卡车。

batch = 32 时，权重还是搬一趟 13.5 GB，但这一趟运过来的权重被三十二个 token 一起用了。运算量是原来的三十二倍，可是计算单元本来就闲着，三十二倍的活它也能在等下一趟卡车的时间里干完。所以总时间几乎没变，多出来的三十一个 token 是搭便车的。

换成一句话：只要还在 memory-bound 这一侧，搬运是固定成本，多算是免费的。加大 batch 就是在往 compute-bound 那一侧走，走到临界点之前延迟几乎不涨，吞吐白涨。

Day 5 会用具体数字把这件事算出来：搬一趟要多少毫秒，算一个 token 要多少毫秒，batch 加到多大两者持平。那个数是整个 W1 最重要的一个数。

## 名词解释

| 术语 | 一句话解释 |
| --- | --- |
| FLOP | 一次浮点运算（一次乘法或一次加法），是运算量的单位 |
| FLOP/s（常写 FLOPS） | 每秒多少次浮点运算，是算力的单位；TFLOP/s 是每秒万亿次 |
| HBM | GPU 板载的高带宽显存，容量大、离计算单元远，A100 是 80 GB |
| 显存带宽 | HBM 每秒能读写多少字节，A100 SXM 是 2039 GB/s；和容量是两个独立的指标 |
| SRAM | 芯片上的高速小容量存储（shared memory、L1/L2 cache），比 HBM 快一个数量级以上 |
| matmul | 矩阵乘法，运算量随矩阵尺寸三次方增长而数据量只是二次方，所以大矩阵偏 compute-bound |
| pointwise | 逐元素操作（ReLU、加法、cos 等），每个数读一次算一次写一次，几乎永远 memory-bound |
| kernel | 在 GPU 上执行的一个函数；PyTorch 每个操作底下对应一次或多次 kernel 发射 |
| kernel launch | CPU 把一个 kernel 丢进 GPU 队列的动作，有固定的微秒级开销 |
| 算子融合 | 把多个连续操作合成一个 kernel，中间结果不落显存，减少搬运次数和发射次数 |
| overhead | 不算不搬的时间：Python 解释、PyTorch 调度、kernel 发射；GPU 在等 CPU |
| 算术强度 | 运算次数 ÷ 搬运字节数，单位 FLOP/byte，判定 memory-bound 还是 compute-bound 的核心指标 |
| compute-bound | 时间花在算术上，计算单元满负荷 |
| memory-bandwidth-bound | 时间花在搬数据上，计算单元在等 |
| overhead-bound | 时间花在等 CPU 发指令上，GPU 空转 |

## 常见误区

GPU 利用率高不等于跑得快。nvidia-smi 里那个百分比只表示"有 kernel 在 GPU 上跑"，一个 memory-bound 的 kernel 把利用率顶到 100%，计算单元可能只用了 1%。

显存够大不等于快。80 GB 是容量，跟每秒能搬多少无关。同样 80 GB 的两张卡，带宽差一倍，memory-bound 的推理速度就差一倍。

算得少不等于快。`x.cos().cos()` 比 `x.cos()` 慢两倍多，不是因为多算了两次 cos，是因为多搬了两趟。优化的目标经常不是减少运算，是减少搬运。

小模型不等于容易跑满。小模型每个 kernel 算得快，更容易掉进 overhead-bound，GPU 大部分时间在等 Python。

三种瓶颈不是三选一的标签贴在整个程序上。一个程序里 matmul 部分可能 compute-bound，softmax 部分 memory-bound，中间夹着 overhead。要按 kernel 看。

## 参考资料

### 文章

- Horace He，《Making Deep Learning Go Brrrr From First Principles》，https://horace.io/brrr_intro.html 。今天的全部内容都来自这一篇，建议逐段读，读不懂的句子单独查。
- Williams, Waterman, Patterson，《Roofline: An Insightful Visual Performance Model for Multicore Architectures》，2009。算术强度和 ridge point 这套方法的原始论文，按标题搜索。

### 视频

- GPU MODE 系列讲座，课件和录像索引在 https://github.com/gpu-mode/lectures 。前几讲是 profiling 和 PyTorch 性能基础，跟今天的内容对应，W2 之后会用到。

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

**4. matmul 为什么偏 compute-bound，pointwise 为什么偏 memory-bound？用运算量和数据量的比来解释。**

<details><summary>答案</summary>

N×N 矩阵相乘做约 2N³ 次运算，只读 2N² 个数，运算量是数据量的 N 倍量级，矩阵越大每个字节能配的运算越多，容易把计算单元喂满。pointwise 每读一个数做一次运算，比值固定是一比一左右，无论数据多大都在等搬运。

</details>

**5. 一个小模型用 PyTorch eager 跑推理，GPU 利用率只有 20%，加了 torch.compile 之后快了三倍。发生了什么？**

<details><summary>答案</summary>

原来是 overhead-bound：每个 kernel 算得很快，CPU 那边 Python 和 PyTorch 调度来不及发下一个，GPU 大部分时间空转等指令。torch.compile 做了两件事，把多个 pointwise 操作融合成更少的 kernel，减少了发射次数；并且把 Python 层的调度逻辑编译掉，CPU 发指令变快了。模型和算法都没变，只是 GPU 不再等 CPU。

</details>

**6. 用工厂比喻各说一句：三种瓶颈分别是什么画面？**

<details><summary>答案</summary>

compute-bound：工厂满负荷运转，卡车在门口排队等卸货。memory-bandwidth-bound：工人站着等，卡车在路上还没到。overhead-bound：卡车停在仓库里没发车，调度员还在填单子。

</details>

## 明天预告

Day 2 打开 transformer 的零件图：一个 7B 模型到底是由哪几张矩阵组成的，每张多大，怎么把它们加起来对账到 6.74B 个参数，再算出 fp16 下要占 13.5 GB 显存。今天说的"搬一趟权重"的那个 13.5 GB，明天亲手算出来。
