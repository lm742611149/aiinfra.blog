---
title: 'Day 27 · CUDA 执行模型：kernel、grid、block、warp、stream 与 launch 开销'
description: '一个 kernel 是怎么被切成几千个 block 撒到 SM 上跑的，warp 为什么是 32，stream 为什么是有序队列，以及每次 launch 都要付的那笔固定税有多大。把 Day 11 在 timeline 上看到的 gap 追到它的物理来源，顺手给 M5 的 Triton 铺好路。'
pubDate: 2026-09-25
regime: none
tags: ['cuda', 'kernel', 'warp', 'stream', 'cuda-graph', 'triton', 'aiinfra-365']
series: 'aiinfra-365'
day: 27
lang: 'zh'
---

## 今天要解决的问题

Day 11 在 Perfetto 的 timeline 上看到了 gap：GPU 那一行是一段一段短短的色块，色块之间是空的。当时的解释是「CPU 在忙着发下一个 kernel，GPU 没活干」。这个解释是对的，但只说了一半。今天补另一半：一个 kernel 从被 Python 那行代码提交，到在 GPU 上跑完，中间到底经过了什么，为什么每一次都要付一笔固定成本，这笔成本多大，以及有哪两种办法把它省掉。

今天结束时要能回答四个问题：

1. 一个「给一百万个数各加一」的 kernel，在 GPU 上是被切成多少份、怎么分到 Day 25 讲的那些 SM 上去的？grid、block、thread 三个词各指哪一层？
2. warp 是什么，为什么是 32，为什么 block 的大小要取 32 的倍数？
3. stream 是什么，为什么同一个 stream 里的 kernel 一定按顺序跑，这和 Day 8 说的「CPU 提交是异步的」怎么放在一起理解？
4. 一次 kernel launch 的固定开销是几微秒量级，decode 一步要 launch 几百个 kernel，加起来和 Day 9 算的理论下限比是什么量级？

今天不写一行能跑在 GPU 上的 C 代码，只读。真正动手写 kernel 是 M5 的事。但读懂这一层之后，Triton 教程第一课里 `tl.program_id(0)` 那一行就不再是咒语了。

## 一个 kernel 是怎么被拆开跑的

先拿最简单的活：一个长度一百万的向量，每个元素加一。在 PyTorch 里就是一行：

```python
# Colab / 任何有 GPU 的机器
import torch
x = torch.empty(1_000_000, device="cuda")
y = x + 1          # 这一行背后 launch 了一个 kernel
```

`x + 1` 背后 launch 的那个 kernel，用 CUDA C 写出来长这样。今天只读不写，注意三个变量名就够：

```c
// 只读。这是 CUDA C，每个线程跑一遍这个函数体。
__global__ void add_one(const float* x, float* y, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;   // 我是全局第几个线程
    if (i < n) y[i] = x[i] + 1.0f;                   // 那我就管第 i 个元素
}

// 主机端这样发出去：4096 个 block，每个 block 256 个线程
add_one<<<4096, 256>>>(x, y, 1000000);
```

这段代码说的事情是：一百万个元素，交给一百万个线程（thread），一人管一个。一百万个线程不是散着扔给 GPU 的，先每 256 个打成一捆，叫一个 block；一百万除以 256 约等于 3907，向上取整开 4096 捆，这 4096 捆整体叫一个 grid。一次 launch 就是把一个 grid 交给 GPU。

三层的关系，从上往下：

| 层 | 是什么 | 这个例子里多大 | 谁决定 |
| --- | --- | --- | --- |
| grid | 一次 launch 的全部工作，由若干 block 组成 | 4096 个 block | 写 kernel 的人，按数据量算出来 |
| block | 一捆线程，整捆放到同一个 SM 上跑，捆内线程可以共享 shared memory、可以同步 | 256 个线程 | 写 kernel 的人，通常取 128、256、512 |
| thread | 最小的执行单位，跑一遍 kernel 函数体 | 1 个元素 | 由 block 大小和 grid 大小推出来 |

每个线程怎么知道自己该管哪个元素？靠三个内建变量：`blockIdx.x` 是我在第几个 block，`blockDim.x` 是每个 block 多少线程，`threadIdx.x` 是我在 block 里排第几。三者拼出全局编号 `i`。最后一个 block 会多出 96 个线程没元素可管，所以要 `if (i < n)`。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="grid、block、warp、thread 四层的包含关系，以及 block 被整捆分到 SM 上">
  <text x="12" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一次 launch = 一个 grid</text>
  <rect x="12" y="32" width="616" height="118" fill="none" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
  <text x="20" y="48" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">grid：4096 个 block</text>
  <g>
    <rect x="24" y="58" width="132" height="80" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="30" y="72" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">block 0 · 256 线程</text>
    <rect x="30" y="80" width="120" height="10" fill="var(--mem)" opacity="0.9"/>
    <rect x="30" y="93" width="120" height="10" fill="var(--mem)" opacity="0.7"/>
    <rect x="30" y="106" width="120" height="10" fill="var(--mem)" opacity="0.5"/>
    <text x="30" y="130" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">… 8 个 warp</text>
  </g>
  <g>
    <rect x="168" y="58" width="132" height="80" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="174" y="72" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">block 1</text>
    <rect x="174" y="80" width="120" height="10" fill="var(--mem)" opacity="0.9"/>
    <rect x="174" y="93" width="120" height="10" fill="var(--mem)" opacity="0.7"/>
    <rect x="174" y="106" width="120" height="10" fill="var(--mem)" opacity="0.5"/>
  </g>
  <g>
    <rect x="312" y="58" width="132" height="80" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="318" y="72" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">block 2</text>
    <rect x="318" y="80" width="120" height="10" fill="var(--mem)" opacity="0.9"/>
    <rect x="318" y="93" width="120" height="10" fill="var(--mem)" opacity="0.7"/>
    <rect x="318" y="106" width="120" height="10" fill="var(--mem)" opacity="0.5"/>
  </g>
  <text x="462" y="102" font-family="var(--font-mono)" font-size="14" fill="var(--ink-faint)">…  block 4095</text>
  <g stroke="var(--ink-faint)" stroke-width="1" fill="none">
    <path d="M90 150 L90 178 L80 170 M90 178 L100 170"/>
    <path d="M234 150 L234 178 L224 170 M234 178 L244 170"/>
    <path d="M378 150 L378 178 L368 170 M378 178 L388 170"/>
  </g>
  <text x="12" y="200" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">GPU：block 整捆落到某一个 SM 上（A100 有 108 个 SM，T4 有 40 个）</text>
  <g>
    <rect x="24" y="210" width="132" height="70" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="30" y="226" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">SM 0</text>
    <rect x="30" y="234" width="56" height="38" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="34" y="256" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">blk 0</text>
    <rect x="92" y="234" width="56" height="38" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="96" y="256" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">blk 108</text>
  </g>
  <g>
    <rect x="168" y="210" width="132" height="70" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="174" y="226" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">SM 1</text>
    <rect x="174" y="234" width="56" height="38" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="178" y="256" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">blk 1</text>
    <rect x="236" y="234" width="56" height="38" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="240" y="256" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">blk 109</text>
  </g>
  <g>
    <rect x="312" y="210" width="132" height="70" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="318" y="226" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">SM 2</text>
    <rect x="318" y="234" width="56" height="38" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="322" y="256" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">blk 2</text>
    <rect x="380" y="234" width="56" height="38" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="384" y="256" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">blk 110</text>
  </g>
  <text x="462" y="250" font-family="var(--font-mono)" font-size="14" fill="var(--ink-faint)">…  SM 107</text>
  <text x="12" y="296" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">block 内每 32 个线程 = 一个 warp（图中一条横条）；一个 block 256 线程 = 8 个 warp</text>
</svg>
<figcaption>一次 launch 交出去一个 grid。grid 里的 block 被硬件调度器整捆撒到各个 SM 上，一个 SM 同时能装好几个 block；block 内部每 32 个线程组成一个 warp，warp 才是 SM 真正调度的单位。</figcaption>
</figure>

block 是被「整捆」放到一个 SM 上的，这一点决定了很多事。同一个 block 里的线程在同一个 SM 上，所以它们能用那个 SM 的 shared memory 互相传数据，能用 `__syncthreads()` 等大家都到齐。不同 block 之间没有这些，因为它们可能在不同的 SM 上，甚至不在同一时刻跑。4096 个 block 撒到 108 个 SM 上，每个 SM 平均要轮着接 38 个 block，先来的先跑，跑完腾出位置给后面的。所以 grid 的大小可以远远超过 SM 的数量，硬件自己排队，这是 CUDA 能在 40 个 SM 的 T4 和 108 个 SM 的 A100 上跑同一份代码不用改的原因。

这里可以把 Day 25 的 SM 和今天的 block 接上：SM 是硬件，是一块物理的计算单元；block 是软件，是一捆逻辑上的线程。写 kernel 的人只管切 block，不管哪个 block 去哪个 SM，那是硬件调度器的事。

## warp：32 个线程一起迈步

block 还不是 SM 真正调度的单位。SM 拿到一个 256 线程的 block 之后，把它切成 8 份，每份 32 个线程，叫一个 warp。SM 里的调度器一次挑一个 warp，给它发一条指令，这 32 个线程**同时执行同一条指令**，各自处理自己的数据。这种模式叫 SIMT，single instruction multiple threads，一条指令多个线程。

为什么是 32？这是 NVIDIA 硬件设计定下来的数，从最早的 CUDA 架构到现在的 Hopper 都是 32，没有变过。可以把它当成一个常量记住，就像 fp16 是 2 字节一样。

32 这个数在写代码时的直接后果有两条。

**block 大小取 32 的倍数**。如果开一个 100 线程的 block，SM 还是按 32 一组切，切成 4 个 warp，最后一个 warp 只有 4 个线程干活，另外 28 个位置空着，但调度器发指令时这个 warp 还是占一个完整的调度名额。128、256、512 都是 32 的倍数，所以常见的 block 大小是这几个。

**同一个 warp 里最好别走不同的分支**。kernel 里写了 `if (x[i] > 0) ... else ...`，一个 warp 里 20 个线程走 if、12 个走 else，硬件的做法是先让 20 个跑 if 分支（另 12 个原地等），再让 12 个跑 else 分支（那 20 个等），两段时间加起来。这叫 warp divergence，分支发散。对 `if (i < n)` 这种只有最后一个 warp 才会遇到的边界判断无所谓，对每个元素都可能走不同路的逻辑就要小心。M5 写 kernel 时会真的撞上这件事，今天只要知道这个词。

一个 SM 上能同时驻留多少 warp 也有上限，A100 是 64 个 warp，也就是 2048 个线程。实际能驻留多少还受寄存器和 shared memory 用量限制，因为每个线程的寄存器、每个 block 的 shared memory 都从 SM 那份固定资源里分。驻留的 warp 数除以上限，叫 occupancy，占用率。它为什么重要：一个 warp 发了一条读显存的指令，要等几百个时钟周期数据才回来，这段时间调度器就切到别的 warp 去发指令。驻留的 warp 越多，越容易找到一个「数据已经到了、可以继续算」的 warp，SM 就越不容易空转。这和 Day 5 的带宽账是两回事：occupancy 说的是 SM 内部有没有活干，roofline 说的是整卡的字节和 FLOP 配比，两个都得够。

## stream：GPU 上的有序队列

现在换到 CPU 这一侧看。Day 8 讲过 CUDA 是异步的：Python 那行 `y = x + 1` 执行完的时候，GPU 很可能还没开始算，CPU 只是把「算这个」这条命令放进了一个队列就往下走了。今天给这个队列一个名字：stream。

stream 有两条规则：

1. **同一个 stream 里的操作严格按提交顺序执行**，前一个 kernel 没跑完，后一个不会开始。
2. **不同 stream 之间没有顺序保证**，硬件有资源就可以并发跑。

PyTorch 默认把所有操作都放进一个叫 default stream 的队列。所以平时写的 PyTorch 代码，几百个 kernel 排成一列，一个接一个地在 GPU 上跑，CPU 在前面不停地往队列尾部塞新的。`torch.cuda.synchronize()` 做的事就是 CPU 停下来，等队列清空。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="CPU 提交线程和 GPU stream 执行的两条时间线，展示异步提交、顺序执行和 gap">
  <text x="12" y="20" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">时间 →</text>
  <line x1="90" y1="14" x2="628" y2="14" stroke="var(--rule)"/>
  <text x="12" y="62" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">CPU 线程</text>
  <text x="12" y="76" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">(Python + launch)</text>
  <g>
    <rect x="90" y="46" width="70" height="26" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="96" y="63" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">发 K1</text>
    <rect x="164" y="46" width="70" height="26" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="170" y="63" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">发 K2</text>
    <rect x="238" y="46" width="70" height="26" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="244" y="63" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">发 K3</text>
    <rect x="312" y="46" width="70" height="26" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="318" y="63" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">发 K4</text>
    <rect x="386" y="46" width="130" height="26" fill="var(--paper-raised)" stroke="var(--ink-faint)" stroke-dasharray="3 2"/>
    <text x="392" y="63" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">synchronize() 等待</text>
  </g>
  <g stroke="var(--ink-faint)" stroke-width="1" fill="none" stroke-dasharray="2 2">
    <line x1="160" y1="72" x2="160" y2="130"/>
    <line x1="234" y1="72" x2="234" y2="130"/>
    <line x1="308" y1="72" x2="308" y2="130"/>
    <line x1="382" y1="72" x2="382" y2="130"/>
  </g>
  <text x="12" y="150" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">GPU stream</text>
  <text x="12" y="164" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">(按顺序执行)</text>
  <g>
    <rect x="160" y="134" width="40" height="26" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="168" y="151" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">K1</text>
    <rect x="234" y="134" width="40" height="26" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="242" y="151" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">K2</text>
    <rect x="308" y="134" width="40" height="26" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="316" y="151" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">K3</text>
    <rect x="382" y="134" width="40" height="26" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="390" y="151" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">K4</text>
  </g>
  <g fill="var(--ink-faint)" font-family="var(--font-mono)" font-size="10">
    <text x="203" y="178">gap</text>
    <text x="277" y="178">gap</text>
    <text x="351" y="178">gap</text>
  </g>
  <g stroke="var(--ink-faint)" fill="none">
    <path d="M200 166 L232 166" stroke-dasharray="2 2"/>
    <path d="M274 166 L306 166" stroke-dasharray="2 2"/>
    <path d="M348 166 L380 166" stroke-dasharray="2 2"/>
  </g>
  <text x="12" y="212" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">每个 kernel 本身只跑一小会儿（K 块很短），但 CPU 发一个 kernel 要花更长时间（发 K 块更宽），</text>
  <text x="12" y="230" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">于是 GPU 算完 K1 时 K2 还没到，只能空等。这就是 Day 11 看到的 gap：GPU 的节奏被 CPU 的提交速度卡住了。</text>
</svg>
<figcaption>上面一行是 CPU 线程在做的事，下面一行是 GPU 上 default stream 里实际执行的 kernel。CPU 一提交完就走，不等 GPU；GPU 按提交顺序一个一个跑。当每个 kernel 都很小、跑得比 CPU 提交还快时，GPU 就在等，缝隙就是 gap。</figcaption>
</figure>

这张图把 Day 8 和 Day 11 两件事放在了同一个框架里。Day 8 的教训「不 synchronize 计时全是假的」，对应的是 CPU 那一行走完了、GPU 那一行还没走完，你在 CPU 上停表只停了上面那一行。Day 11 的 gap，对应的是下面那一行里 kernel 之间的空白，原因是上面那一行发得不够快。

多个 stream 是什么用的？两个互不依赖的操作，放进两个 stream，GPU 可以同时跑；最常见的用法是一边算一边从 CPU 往 GPU 拷下一批数据。PyTorch 里用 `torch.cuda.Stream()` 创建，用 `with torch.cuda.stream(s):` 把操作放进去。推理引擎里会用到，比如 vLLM 用单独的 stream 做 KV cache 在 CPU 和 GPU 之间的搬运。今天知道它存在就够，M7 写引擎时再用。

## launch 开销：每个 kernel 都要付的固定税

现在到今天最重要的一个数。CPU 提交一个 kernel 到 GPU，不是免费的：要走 CUDA 驱动、要把 kernel 参数打包、要通知 GPU 的命令处理器。这段时间和 kernel 本身干多少活无关，一百万个元素加一和一个元素加一，launch 的固定成本一样。

这个成本多大？裸 CUDA 的 launch 大约几微秒。经过 PyTorch 的话还要再加上 Python 解释、op 分派（dispatcher 判断这是哪种 tensor、走哪个实现）、内存分配器这些层，一个简单 op 从 Python 到 GPU 开始跑，加起来通常在 10 微秒上下的量级。这个数字随 CPU 快慢、PyTorch 版本、op 种类浮动，所以要自己测：

```python
# Colab。测的是「一个几乎不干活的 op，从 Python 发出去平均要多久」
import torch, time

x = torch.ones(1, device="cuda")     # 1 个元素，算的时间可以忽略
for _ in range(100):                  # warmup，Day 7 的规矩
    x.add_(1)
torch.cuda.synchronize()

N = 2000
t0 = time.perf_counter()
for _ in range(N):
    x.add_(1)                         # 每次一个 kernel launch
torch.cuda.synchronize()              # Day 8 的规矩：等队列清空再停表
per_launch_us = (time.perf_counter() - t0) / N * 1e6
print(f"每次 launch 约 {per_launch_us:.1f} µs")

# 对照：同样 2000 次加法，但合成一个大 kernel
big = torch.ones(2000, device="cuda")
torch.cuda.synchronize(); t0 = time.perf_counter()
big.add_(1)
torch.cuda.synchronize()
print(f"一个 kernel 加 2000 个元素约 {(time.perf_counter() - t0) * 1e6:.1f} µs")
```

预期结果：第一个数在 5 到 20 微秒之间（Colab 的 CPU 偏慢，可能靠上限），第二个数就是一次 launch 的时间，因为 2000 个元素对 GPU 来说和 1 个元素没区别。两个数一比，就能看出「2000 个小 kernel」和「1 个大 kernel」差了三个数量级。把跑出来的数填到这里：

| 测项 | 预期 | 实测（T4，Colab） | 日期 |
| --- | --- | --- | --- |
| 单次 launch（1 元素 add_） | 5–20 µs | | |
| 单个 kernel 加 2000 元素 | ≈ 单次 launch | | |
| 单个 kernel 加 1 亿元素 | 由带宽决定：8e8 B ÷ 320 GB/s ≈ 2.5 ms | | |

第三行是故意加的：一亿个 fp32 元素读一遍写一遍是 8 亿字节，T4 上按 Day 13 的带宽算要 2.5 毫秒，这时候 launch 那十几微秒就是零头了。**kernel 够大，launch 开销可以忽略；kernel 很小，launch 开销就是全部。**

### 把这个数带回 decode

decode 一步要 launch 多少个 kernel？按 TinyLlama 数：22 层，每一层里有 RMSNorm、q/k/v 三个投影（有时合成一个）、rotary 位置编码、attention、o 投影、残差加、第二个 RMSNorm、FFN 的 gate 和 up 两个投影、SiLU、逐元素乘、down 投影、再一个残差加。粗数一层 15 到 20 个 op，有些 op 内部还会拆成多个 kernel。所以一步 decode 大约 300 到 450 次 launch，加上开头的 embedding 和结尾的 lm_head、采样，取 400 这个整数。

```
400 次 launch × 10 µs ≈ 4 ms
```

Day 9 算过 TinyLlama 在 T4 上 batch 1 的理论下限是 6.9 毫秒，那是把 2.2 GB 权重搬一遍的时间。现在多了一笔和搬运无关的 4 毫秒纯开销。两个数是同一量级。这就解释了 Day 9 里那句话：如果实测 TPOT 是理论下限的 1.5 到 3 倍，多出来的那部分很大一块就是这里。而且 launch 开销**不随 batch 变**，batch 1 发 400 个 kernel，batch 32 还是发 400 个，只是每个 kernel 干的活多了 32 倍。所以 batch 越大，这 4 毫秒在总时间里的占比越小，这就是 Day 11 说「加大 batch 后 gap 占比下降」的原因。

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="batch 1 与 batch 32 时一步 decode 的时间构成对比：launch 开销固定，GPU 有效工作随 batch 增长">
  <text x="12" y="20" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一步 decode 的时间构成（TinyLlama · T4 · 示意，按算式画，不是实测）</text>
  <text x="12" y="62" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">batch 1</text>
  <rect x="90" y="46" width="160" height="24" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="96" y="63" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">launch 开销 ≈ 4 ms</text>
  <rect x="250" y="46" width="276" height="24" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="256" y="63" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">搬权重 6.9 ms（GPU 有效工作）</text>
  <text x="532" y="63" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">≈ 11 ms</text>
  <text x="12" y="112" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">batch 32</text>
  <rect x="90" y="96" width="160" height="24" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="96" y="113" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">launch 开销 ≈ 4 ms</text>
  <rect x="250" y="96" width="290" height="24" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="256" y="113" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">搬权重 6.9 ms + 多算 32 倍的 FLOP（仍藏在搬运里）</text>
  <text x="546" y="113" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">≈ 11 ms</text>
  <text x="12" y="150" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">两行总时长几乎一样，但 batch 32 那一行产出了 32 个 token。</text>
  <text x="12" y="168" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">琥珀色那段是固定税：kernel 数量不变，它就不变。缩短它只有两条路：</text>
  <text x="12" y="186" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">① 少发 kernel（fusion、CUDA graph）  ② 让每次 launch 干更多活（batching）</text>
  <text x="12" y="204" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">注：launch 开销和 GPU 执行有部分重叠，实际总时长小于两段简单相加；图按最坏情况画。</text>
</svg>
<figcaption>launch 开销（琥珀）是每步固定的，搬权重的时间（靛蓝）也是固定的，所以 batch 从 1 到 32 一步的时间几乎不变，吞吐涨 32 倍。要缩短琥珀那一段，只能少发 kernel 或者让每个 kernel 干更多活。</figcaption>
</figure>

图下面那条注释要认真看：CPU 提交和 GPU 执行是流水线，CPU 发第 2 个 kernel 的时候 GPU 在跑第 1 个，所以两段时间有重叠，不是简单相加。只有当 GPU 跑得比 CPU 发得快时，GPU 才会等，才出现 gap。decode batch 1 时每个 kernel 都很小，GPU 确实跑得比 CPU 发得快，所以图上按最坏情况画不算离谱。到底重叠多少，Day 10 的 profiler 能看到，这里只建立量级感。

## CUDA graph：把几百次 launch 录成一次

减少 launch 的第一个办法是 CUDA graph。思路很直接：decode 每一步发的那 400 个 kernel，顺序、参数、形状全都一样，只是输入数据不同。既然每步都一样，那就录一遍，之后每步直接回放整张图，CPU 只需要发一次「回放」命令，400 次 launch 的开销变成 1 次。

限制也直接：录下来的东西是死的。tensor 的形状和地址都被固定住了，所以每一步的输入必须写进同一块显存、形状不能变，中间不能有「根据 GPU 上的结果决定 CPU 下一步做什么」的同步判断。decode 恰好满足：每步输入一个 token，形状固定，只要 batch 大小不变就能用同一张图。这就是 vLLM 对 decode 阶段默认开 CUDA graph 的原因：它会在启动时对若干个 batch 大小（1、2、4、8……）各录一张图，运行时按实际 batch 挑最接近的那张回放。

PyTorch 里手动用法长这样，今天只读：

```python
# 只读。手动 CUDA graph 的最小骨架。
import torch

static_x = torch.zeros(32, 2048, device="cuda")   # 输入必须是固定的那块显存
g = torch.cuda.CUDAGraph()

s = torch.cuda.Stream()                           # 录制要在非默认 stream 上做
s.wait_stream(torch.cuda.current_stream())
with torch.cuda.stream(s):
    for _ in range(3):                            # 先 warmup，让内存分配器稳定
        y = model(static_x)
torch.cuda.current_stream().wait_stream(s)

with torch.cuda.graph(g):                         # 录制：这一遍不真正执行，只记下 kernel 序列
    static_y = model(static_x)

# 之后每一步：把新数据拷进 static_x，回放整张图
static_x.copy_(next_input)
g.replay()                                        # 一次 launch，代替里面几百次
```

更省事的路是 `torch.compile(model, mode="reduce-overhead")`，它会自动把能录的部分录成 CUDA graph。这个 mode 的名字就叫 reduce overhead，说的正是今天这件事。

第二个办法是 fusion，融合：把几个连着的小 kernel 合成一个。RMSNorm 后面接一个矩阵乘，SiLU 后面接一个逐元素乘，原本各自是一个 kernel，中间结果写回显存再读出来；合成一个 kernel 之后不仅少了 launch，中间结果也不用落显存了，字节数也省了。这一条同时帮 overhead-bound 和 memory-bound，是 M5 到 M6 整整两个月的主题。`torch.compile` 默认 mode 做的主要就是 fusion。

## 为什么 Triton 只让你写 block

最后把话题接到 M5。上面那段 CUDA C 里，写 kernel 的人要亲自管到 thread 这一层：算 `i`，判 `i < n`，一个线程一个元素。矩阵乘、softmax 这类 kernel 里，还要管哪些线程去搬哪块数据进 shared memory、什么时候 `__syncthreads()`、怎么避免 warp divergence。这是 CUDA 难学的地方，不是概念多，是要同时盯住的层次太多。

Triton 砍掉了最底下那一层。Triton 里一个「program」对应一个 block，程序员只描述**一个 block 要处理哪一块数据**，块内怎么分给线程、怎么用 shared memory、怎么排 warp，编译器管。同样的向量加一，Triton 长这样：

```python
# 只读。M5 第一课会真正跑它。
import triton
import triton.language as tl

@triton.jit
def add_one_kernel(x_ptr, y_ptr, n, BLOCK: tl.constexpr):
    pid = tl.program_id(0)                       # 我是第几个 block（对应 blockIdx.x）
    offs = pid * BLOCK + tl.arange(0, BLOCK)     # 这个 block 管的一段下标，整段一起写
    mask = offs < n                              # 对应 if (i < n)
    x = tl.load(x_ptr + offs, mask=mask)         # 整块一起读
    tl.store(y_ptr + offs, x + 1.0, mask=mask)   # 整块一起写

# launch：grid 里有 ceil(n / BLOCK) 个 program
grid = (triton.cdiv(n, 1024),)
add_one_kernel[grid](x, y, n, BLOCK=1024)
```

对照 CUDA C 那段：`tl.program_id(0)` 就是 `blockIdx.x`；`tl.arange(0, BLOCK)` 一次给出整个 block 的下标，不再有 `threadIdx.x`；`mask` 就是 `if (i < n)`。没有 thread，没有 warp，没有 `__syncthreads()`。今天讲的 grid、block 两层在 Triton 里原样保留，thread、warp 两层被藏起来了。这就是路线图里说「从 Triton 入手，不要一上来啃裸 CUDA」的具体含义：少管两层，但对上面两层的理解一点不能少。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| kernel | 在 GPU 上跑的一个函数，一次 launch 跑一个。PyTorch 的一个 op 通常对应一到几个 kernel |
| launch | CPU 把一个 kernel 及其参数提交给 GPU 的动作，有固定开销，几微秒到十几微秒量级 |
| thread | GPU 上最小的执行单位，跑一遍 kernel 函数体，通常管一个或几个元素 |
| block | 一捆线程（常见 128/256/512 个），整捆放到同一个 SM 上，捆内可共享 shared memory、可同步 |
| grid | 一次 launch 的全部 block，大小按数据量算出来，可以远大于 SM 数 |
| warp | 32 个线程一组，SM 调度的真正单位，同一时刻执行同一条指令 |
| SIMT | single instruction multiple threads，一条指令让 warp 里 32 个线程各自对自己的数据执行 |
| warp divergence | 同一个 warp 里的线程走了不同分支，硬件串行执行各分支，时间相加 |
| occupancy | SM 上实际驻留的 warp 数占上限的比例，越高越容易掩盖显存访问延迟 |
| `__syncthreads()` | block 内所有线程在此等齐再继续，只能用于同一个 block |
| shared memory | 一个 SM 上的片上小内存，同一个 block 的线程共享，比 HBM 快一个量级以上 |
| stream | GPU 上的有序命令队列，同一 stream 内按提交顺序执行，不同 stream 可并发 |
| default stream | PyTorch 默认使用的 stream，不指定时所有 op 都排进它 |
| CUDA graph | 把一串 kernel 的 launch 序列录下来，之后一次 replay 整串，省掉每个 kernel 的 launch 开销 |
| fusion | 把多个连续小 kernel 合成一个，同时省 launch 次数和中间结果的显存读写 |
| `torch.compile(mode="reduce-overhead")` | 让 PyTorch 自动用 CUDA graph 降低 launch 开销的编译模式 |
| Triton program | Triton 里的执行单位，对应一个 block；程序员不写 thread 层 |

## 常见误区

**把 grid 大小和 SM 数量画等号。** 以为 A100 有 108 个 SM 所以 grid 最多开 108 个 block。实际上 grid 可以开几万个 block，硬件调度器排队分发，一个 SM 跑完一个 block 再接下一个。grid 大小只看数据量，不看卡。

**以为 launch 开销会随 batch 变大。** launch 是按 kernel 个数收费的，一步 decode 发 400 个 kernel，batch 1 和 batch 32 都是 400 次。变的是每个 kernel 干的活。所以 batch 越大，launch 开销占比越小，这是 batching 帮 overhead-bound 的机制，和它帮 memory-bound 的机制（Day 5，同一份权重服务更多 token）是两回事，只是碰巧都靠 batch 变大。

**把 gap 全归因于 launch。** Day 11 看到的 gap 里，launch 是一部分，Python 解释、PyTorch dispatcher、内存分配、CPU 端的采样逻辑都在里面。CUDA graph 能省掉 launch 和 dispatcher 那部分，省不掉你自己写在 Python 里的 CPU 逻辑。要分清哪部分是哪个，还得回 profiler 看 CPU 线程那一行。

**以为 CUDA graph 是万能加速器。** 它只解决 launch 开销。一个本来就 memory-bound 的大 kernel，录进 graph 一点不会变快。而且它要求形状固定，prefill 阶段每个请求 prompt 长度不同，很难录；这就是 vLLM 只对 decode 开 graph 的原因。

**block 大小随手写。** 100、200、1000 这种不是 32 倍数的 block 会浪费最后一个 warp 的调度名额。M5 写 kernel 时 block 大小从 128、256、512、1024 里挑，别自创。

## 参考资料

### 文章

- CUDA Refresher: The CUDA Programming Model，NVIDIA 技术博客。grid、block、thread 三层最短的官方讲法，配图和本文第一张图对应。https://developer.nvidia.com/blog/cuda-refresher-cuda-programming-model/
- Getting Started with CUDA Graphs，NVIDIA 技术博客。CUDA graph 解决什么、限制在哪，本文那一节的出处。https://developer.nvidia.com/blog/cuda-graphs/
- Accelerating PyTorch with CUDA Graphs，PyTorch 官方博客。PyTorch 里 CUDA graph 的用法和收益数据。https://pytorch.org/blog/accelerating-pytorch-with-cuda-graphs/
- Making Deep Learning Go Brrrr From First Principles，Horace He。overhead 那一节今天算是补完了物理来源。https://horace.io/brrr_intro.html
- GPU Performance Background User's Guide，NVIDIA 深度学习性能文档。讲 SM、warp、occupancy 和 roofline 怎么放在一起，Day 25 和今天的官方版。https://docs.nvidia.com/deeplearning/performance/dl-performance-gpu-background/index.html

### 文档

- CUDA C++ Programming Guide，第 2 章 Programming Model。thread hierarchy、memory hierarchy 的权威定义，只读第 2 章。https://docs.nvidia.com/cuda/cuda-c-programming-guide/
- PyTorch CUDA semantics。stream、异步执行、`torch.cuda.synchronize` 的官方说明，Day 8 和今天的 stream 一节都以它为准。https://docs.pytorch.org/docs/stable/notes/cuda.html
- `torch.cuda.CUDAGraph` API 文档。https://docs.pytorch.org/docs/stable/generated/torch.cuda.CUDAGraph.html
- Triton 官方文档与 tutorials。M5 第一课的教材，今天只看首页的那段 add kernel。https://triton-lang.org/main/index.html
- GPU MODE lectures 仓库。下面两个视频的讲义和代码都在这里。https://github.com/gpu-mode/lectures

### 视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/NQ-0D5Ti2dc" title="Lecture 2 Ch1-3 PMPP book" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>GPU MODE · Lecture 2 Ch1-3 PMPP book。跟着 PMPP 前三章讲 grid/block/thread 和第一个 kernel，本文第一节的视频版。全长约一小时，先看前 40 分钟。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/4sgKnKbR-WE" title="Lecture 3: Getting Started With CUDA for Python Programmers" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>GPU MODE · Lecture 3: Getting Started With CUDA for Python Programmers（Jeremy Howard）。从 Python 出发一步步写到 CUDA，对只会 PyTorch 的人最友好。看到他把 Python 循环改成 kernel 那一段就够。</figcaption>
</figure>

## 自测

合上笔记做。

1. 一百万个元素、block 256，grid 开多大？最后一个 block 里有多少线程没活干？`blockIdx.x`、`blockDim.x`、`threadIdx.x` 怎么拼出全局下标？

<details><summary>答案</summary>

grid = ceil(1,000,000 ÷ 256) = 3907 个 block（例子里为了凑整开了 4096，都可以）。3907 × 256 = 1,000,192，多出 192 个线程没元素可管，所以要 `if (i < n)`。全局下标 i = blockIdx.x × blockDim.x + threadIdx.x。

</details>

2. warp 是多少个线程？为什么 block 大小要取 32 的倍数？什么是 warp divergence？

<details><summary>答案</summary>

32 个，是硬件常量。SM 按 32 一组切 warp，block 不是 32 的倍数时最后一个 warp 有空位但仍占一个调度名额，白浪费。warp divergence 是同一 warp 内线程走了不同分支，硬件把各分支串行执行、时间相加。

</details>

3. 同一个 stream 里两个 kernel 的执行顺序有保证吗？不同 stream 呢？这和「CUDA 是异步的」矛盾吗？

<details><summary>答案</summary>

同一 stream 严格按提交顺序执行；不同 stream 之间没有顺序保证，可并发。不矛盾：「异步」说的是 CPU 提交完就走、不等 GPU；「有序」说的是 GPU 那边队列内部按顺序消化。两件事发生在两条不同的时间线上。

</details>

4. 一次 kernel launch 大约多少微秒？decode 一步约 400 个 kernel，这笔开销和 TinyLlama 在 T4 上 6.9 ms 的理论下限比是什么关系？为什么加大 batch 能降低它的占比？

<details><summary>答案</summary>

裸 CUDA 几微秒，经 PyTorch 约 10 µs 量级。400 × 10 µs ≈ 4 ms，和 6.9 ms 同一量级，是实测 TPOT 高于理论下限的主要来源之一。launch 按 kernel 个数收费，batch 1 和 batch 32 都是 400 次，所以 batch 越大这 4 ms 在总时间里占比越小。

</details>

5. CUDA graph 解决什么问题？它对 decode 好用、对 prefill 不好用，原因是什么？

<details><summary>答案</summary>

把一串 kernel 的 launch 序列录一遍、之后一次 replay，把几百次 launch 变成一次，专治 launch 开销。要求形状和显存地址固定。decode 每步输入一个 token、形状固定，能录；prefill 每个请求 prompt 长度不同，形状不固定，难录。所以 vLLM 只对 decode 开 graph。

</details>

6. 今天讲的四层（grid / block / warp / thread）里，Triton 让你写哪几层？为什么路线图说从 Triton 入手？

<details><summary>答案</summary>

只写 grid 和 block 两层：`tl.program_id` 对应 blockIdx，`tl.arange(0, BLOCK)` 一次描述整个 block 的下标。thread 和 warp 层由编译器管，没有 threadIdx、没有 `__syncthreads()`。少管两层所以入门快，但对上面两层的理解不能少。

</details>

## 明天预告

Day 28 讲怎么读一张 GPU 规格表。A100 的宣传页上写着 624 TFLOPS，Day 5 用的却是 312，差的那一倍是什么；同样叫 A100 80GB，SXM 版带宽 2039 GB/s，PCIe 版 1935 GB/s，ridge point 一个 153 一个 161；NVLink 600 GB/s 和 PCIe 64 GB/s 差十倍，这个差别到 M9 多卡训练时会变成什么。最后把小时价换算成每一百万 token 多少美元，看 batching 在账单上是什么杠杆。
