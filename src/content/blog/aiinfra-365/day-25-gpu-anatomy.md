---
title: 'Day 25 · GPU 解剖：SM、tensor core、寄存器/shared/L2/HBM 到底是什么'
description: '前四周一直在说「算力」和「带宽」，今天把这两个词拆开看里面的零件：算力是多少个 SM 里多少个 tensor core 每个时钟做多少次乘加，带宽是一座五层的存储金字塔里最底下那一层。312 TFLOP/s 和 2039 GB/s 这两个数，今天要能从零件表里亲手算出来。'
pubDate: 2026-09-05
regime: none
tags: ['gpu', 'hardware', 'sm', 'tensor-core', 'memory-hierarchy', 'aiinfra-365']
series: 'aiinfra-365'
day: 25
lang: 'zh'
---

## 今天要解决的问题

W1 到 W3 我把一张 GPU 当成两个数字用:算力 312 TFLOP/s,带宽 2039 GB/s。roofline 上只画了两条线,ridge point 153 就是它们的商。这两个数字够用来判断 decode 卡在哪,但有两件事它们答不了:

1. 312 TFLOP/s 是怎么来的?为什么 fp16 走 tensor core 是 312,fp32 只有 19.5,差 16 倍?Day 14 测算力时说「必须走 fp16 tensor core 才对得上标称值」,今天要知道为什么。
2. 2039 GB/s 说的是哪一层的带宽?Day 13 测带宽时提到「张量要远大于 L2」,说明 GPU 上不止一层存储。那到底有几层,各自多大、多快,差几个数量级?

这一天结束时要能做到三件事:看着 A100 的零件表(多少个 SM、每个 SM 多少个 tensor core、时钟多少)把 312 这个数**乘出来**;画出五层存储金字塔并标出每层的容量和带宽量级;说清楚 W3 那条 roofline 上的斜线为什么其实可以有三条。

数字口径不变:A100 80GB SXM、T4、外加 H100 SXM 做对照。所有规格数字来自 NVIDIA 官方页面和 Ampere 架构白皮书,参考资料里有链接。零件数字换代就变,**算法不变**,以后拿到任何一张新卡的规格表都能照这一套走一遍。

## 从外往里剥:一张卡长什么样

先不管细节,一张数据中心 GPU 拆开有四类东西:

- **计算部件**:很多个一模一样的「小处理器」,叫 SM(Streaming Multiprocessor)。A100 有 108 个,T4 有 40 个,H100 有 132 个。所有的算力都在 SM 里面,SM 之外没有任何东西会做乘加。
- **片上缓存**:L2 cache,所有 SM 共享。A100 是 40 MB,T4 是 4 MB,H100 是 50 MB。
- **显存**:HBM 或 GDDR,在 GPU 芯片旁边的独立颗粒上,通过很宽的总线连进来。A100 是 80 GB HBM2e,T4 是 16 GB GDDR6。**Day 5 说的「权重 13.5 GB 放在显存里」,放的就是这里。**
- **对外接口**:PCIe 连 CPU 和主板,NVLink 连别的 GPU。推理单卡时几乎不碰,M9 多卡训练时它是主角。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="A100 一张卡的四类部件:108 个 SM、共享 L2、HBM 显存、对外接口">
  <rect x="20" y="20" width="600" height="290" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="32" y="42" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">GPU 芯片(GA100,A100 启用其中 108 个 SM)</text>
  <g fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1">
    <rect x="40" y="56" width="34" height="26" rx="2"/><rect x="80" y="56" width="34" height="26" rx="2"/><rect x="120" y="56" width="34" height="26" rx="2"/><rect x="160" y="56" width="34" height="26" rx="2"/><rect x="200" y="56" width="34" height="26" rx="2"/><rect x="240" y="56" width="34" height="26" rx="2"/><rect x="280" y="56" width="34" height="26" rx="2"/><rect x="320" y="56" width="34" height="26" rx="2"/><rect x="360" y="56" width="34" height="26" rx="2"/><rect x="400" y="56" width="34" height="26" rx="2"/><rect x="440" y="56" width="34" height="26" rx="2"/><rect x="480" y="56" width="34" height="26" rx="2"/>
    <rect x="40" y="88" width="34" height="26" rx="2"/><rect x="80" y="88" width="34" height="26" rx="2"/><rect x="120" y="88" width="34" height="26" rx="2"/><rect x="160" y="88" width="34" height="26" rx="2"/><rect x="200" y="88" width="34" height="26" rx="2"/><rect x="240" y="88" width="34" height="26" rx="2"/><rect x="280" y="88" width="34" height="26" rx="2"/><rect x="320" y="88" width="34" height="26" rx="2"/><rect x="360" y="88" width="34" height="26" rx="2"/><rect x="400" y="88" width="34" height="26" rx="2"/><rect x="440" y="88" width="34" height="26" rx="2"/><rect x="480" y="88" width="34" height="26" rx="2"/>
    <rect x="40" y="120" width="34" height="26" rx="2"/><rect x="80" y="120" width="34" height="26" rx="2"/><rect x="120" y="120" width="34" height="26" rx="2"/><rect x="160" y="120" width="34" height="26" rx="2"/><rect x="200" y="120" width="34" height="26" rx="2"/><rect x="240" y="120" width="34" height="26" rx="2"/><rect x="280" y="120" width="34" height="26" rx="2"/><rect x="320" y="120" width="34" height="26" rx="2"/><rect x="360" y="120" width="34" height="26" rx="2"/><rect x="400" y="120" width="34" height="26" rx="2"/><rect x="440" y="120" width="34" height="26" rx="2"/><rect x="480" y="120" width="34" height="26" rx="2"/>
  </g>
  <text x="56" y="73" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">SM</text>
  <text x="530" y="90" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">… ×108</text>
  <text x="530" y="106" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">全部算力</text>
  <text x="530" y="122" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">都在这里</text>
  <rect x="40" y="166" width="474" height="40" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="52" y="191" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">L2 cache · 40 MB · 所有 SM 共享</text>
  <line x1="277" y1="206" x2="277" y2="236" stroke="var(--mem)" stroke-width="3"/>
  <text x="286" y="226" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">2039 GB/s</text>
  <rect x="40" y="236" width="474" height="44" rx="3" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1.5"/>
  <text x="52" y="263" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">HBM2e 显存 · 80 GB · 权重和 KV cache 住在这里</text>
  <rect x="530" y="166" width="78" height="114" rx="3" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
  <text x="540" y="200" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">PCIe 4.0</text>
  <text x="540" y="214" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">→ CPU</text>
  <text x="540" y="246" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">NVLink</text>
  <text x="540" y="260" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">→ 别的 GPU</text>
  <text x="32" y="300" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">琥珀 = 算东西的地方 · 靛蓝 = 存东西的地方 · roofline 的两条线各来自一种颜色</text>
</svg>
<figcaption>A100 的四类部件。琥珀色的 108 个 SM 决定 roofline 的横线(峰值算力),靛蓝色的 HBM 到芯片那根粗线决定斜线(2039 GB/s)。L2 夹在中间,是 Day 13 测带宽时要故意躲开的那一层。</figcaption>
</figure>

这张图上最重要的一个认识是:**算的地方和存的地方是分开的,中间那根线就是带宽**。Day 5 说「decode 每生成一个 token 要把 13.5 GB 权重从显存搬进计算单元一遍」,搬的路径就是图里 HBM 到 L2 到 SM 那两段。

## 一个 SM 里面有什么

108 个 SM 一模一样,所以看懂一个就够。A100 的一个 SM 里有这几样东西:

| 部件 | 数量(每 SM) | 干什么 |
| --- | --- | --- |
| FP32 CUDA core | 64 个 | 普通标量运算,一个时钟做一次 fp32 乘加。elementwise、softmax、layernorm 这类 kernel 走它 |
| INT32 单元 | 64 个 | 整数运算,算地址、循环计数 |
| FP64 单元 | 32 个 | 双精度,科学计算用,深度学习基本不碰 |
| 第三代 Tensor Core | 4 个 | 专做小块矩阵乘加,一个时钟做 256 次 fp16 乘加。所有的 GEMM 走它 |
| 寄存器文件 | 256 KB | 每个线程私有的变量住这里,最快的存储 |
| L1 数据缓存 / shared memory | 合计 192 KB(shared 最多配 164 KB) | 一个 block 内线程共享的暂存区,程序员可控 |
| Warp scheduler | 4 个 | 每个时钟挑一组 32 个线程(一个 warp)发指令 |

出处是 Ampere 架构白皮书第 3 章的 SM 结构图。T4(Turing 架构)的 SM 也是 64 个 FP32 core,但 tensor core 是第二代,每个 SM 有 8 个、每个每时钟只做 64 次乘加;shared memory 最多 64 KB。H100(Hopper)每 SM 128 个 FP32 core、4 个第四代 tensor core(每个每时钟 512 次 fp16 乘加),shared 最多 228 KB。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="A100 一个 SM 的内部:4 个子分区,每个含 16 个 FP32 core、1 个 tensor core、warp scheduler,共享 256 KB 寄存器和 192 KB L1/shared">
  <rect x="20" y="16" width="600" height="268" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="32" y="38" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">一个 SM(A100 有 108 个这样的)</text>
  <g>
    <rect x="34" y="52" width="136" height="130" rx="3" fill="none" stroke="var(--rule)"/>
    <text x="42" y="68" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">子分区 1</text>
    <rect x="42" y="76" width="120" height="16" rx="2" fill="var(--paper-raised)" stroke="var(--ink-faint)"/>
    <text x="48" y="88" font-family="var(--font-mono)" font-size="9" fill="var(--ink-soft)">warp scheduler</text>
    <rect x="42" y="98" width="120" height="30" rx="2" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="48" y="111" font-family="var(--font-mono)" font-size="9" fill="var(--compute)">16 × FP32 core</text>
    <text x="48" y="123" font-family="var(--font-mono)" font-size="9" fill="var(--compute)">16 × INT32 · 8 × FP64</text>
    <rect x="42" y="134" width="120" height="22" rx="2" fill="var(--compute)" />
    <text x="48" y="149" font-family="var(--font-mono)" font-size="9" fill="var(--paper-raised)">1 × Tensor Core</text>
    <rect x="42" y="162" width="120" height="14" rx="2" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="48" y="173" font-family="var(--font-mono)" font-size="9" fill="var(--mem)">64 KB 寄存器</text>
  </g>
  <g transform="translate(150,0)">
    <rect x="34" y="52" width="136" height="130" rx="3" fill="none" stroke="var(--rule)"/>
    <text x="42" y="68" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">子分区 2</text>
    <rect x="42" y="76" width="120" height="16" rx="2" fill="var(--paper-raised)" stroke="var(--ink-faint)"/>
    <text x="48" y="88" font-family="var(--font-mono)" font-size="9" fill="var(--ink-soft)">warp scheduler</text>
    <rect x="42" y="98" width="120" height="30" rx="2" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="48" y="111" font-family="var(--font-mono)" font-size="9" fill="var(--compute)">16 × FP32 core</text>
    <text x="48" y="123" font-family="var(--font-mono)" font-size="9" fill="var(--compute)">16 × INT32 · 8 × FP64</text>
    <rect x="42" y="134" width="120" height="22" rx="2" fill="var(--compute)" />
    <text x="48" y="149" font-family="var(--font-mono)" font-size="9" fill="var(--paper-raised)">1 × Tensor Core</text>
    <rect x="42" y="162" width="120" height="14" rx="2" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="48" y="173" font-family="var(--font-mono)" font-size="9" fill="var(--mem)">64 KB 寄存器</text>
  </g>
  <g transform="translate(300,0)">
    <rect x="34" y="52" width="136" height="130" rx="3" fill="none" stroke="var(--rule)"/>
    <text x="42" y="68" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">子分区 3</text>
    <rect x="42" y="76" width="120" height="16" rx="2" fill="var(--paper-raised)" stroke="var(--ink-faint)"/>
    <text x="48" y="88" font-family="var(--font-mono)" font-size="9" fill="var(--ink-soft)">warp scheduler</text>
    <rect x="42" y="98" width="120" height="30" rx="2" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="48" y="111" font-family="var(--font-mono)" font-size="9" fill="var(--compute)">16 × FP32 core</text>
    <text x="48" y="123" font-family="var(--font-mono)" font-size="9" fill="var(--compute)">16 × INT32 · 8 × FP64</text>
    <rect x="42" y="134" width="120" height="22" rx="2" fill="var(--compute)" />
    <text x="48" y="149" font-family="var(--font-mono)" font-size="9" fill="var(--paper-raised)">1 × Tensor Core</text>
    <rect x="42" y="162" width="120" height="14" rx="2" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="48" y="173" font-family="var(--font-mono)" font-size="9" fill="var(--mem)">64 KB 寄存器</text>
  </g>
  <g transform="translate(450,0)">
    <rect x="34" y="52" width="136" height="130" rx="3" fill="none" stroke="var(--rule)"/>
    <text x="42" y="68" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">子分区 4</text>
    <rect x="42" y="76" width="120" height="16" rx="2" fill="var(--paper-raised)" stroke="var(--ink-faint)"/>
    <text x="48" y="88" font-family="var(--font-mono)" font-size="9" fill="var(--ink-soft)">warp scheduler</text>
    <rect x="42" y="98" width="120" height="30" rx="2" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="48" y="111" font-family="var(--font-mono)" font-size="9" fill="var(--compute)">16 × FP32 core</text>
    <text x="48" y="123" font-family="var(--font-mono)" font-size="9" fill="var(--compute)">16 × INT32 · 8 × FP64</text>
    <rect x="42" y="134" width="120" height="22" rx="2" fill="var(--compute)" />
    <text x="48" y="149" font-family="var(--font-mono)" font-size="9" fill="var(--paper-raised)">1 × Tensor Core</text>
    <rect x="42" y="162" width="120" height="14" rx="2" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="48" y="173" font-family="var(--font-mono)" font-size="9" fill="var(--mem)">64 KB 寄存器</text>
  </g>
  <rect x="34" y="196" width="586" height="34" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="44" y="218" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">192 KB L1 数据缓存 / shared memory(shared 最多配 164 KB)· 四个子分区共享</text>
  <text x="34" y="256" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">合计:64 FP32 core · 4 Tensor Core · 256 KB 寄存器 · 每时钟 4 个 warp 各发一条指令</text>
  <text x="34" y="274" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">GEMM 走实心琥珀块(tensor core),elementwise / softmax / layernorm 走浅琥珀块(FP32 core)</text>
</svg>
<figcaption>A100 一个 SM 的内部,按 Ampere 白皮书的结构图简化。四个子分区各自独立发指令,tensor core 和 FP32 core 是两套不同的算力,峰值差 16 倍,这是 Day 14 那句「必须走 fp16 tensor core」的物理原因。</figcaption>
</figure>

看这张图要抓住一件事:**一个 SM 里有两套完全不同的算力**。64 个 FP32 core 做的是「一个数乘一个数再加一个数」,4 个 tensor core 做的是「一小块矩阵乘一小块矩阵再加一小块矩阵」。后者一个时钟能做的乘加次数是前者的 16 倍。Day 17 说 GEMM 能打到屋顶而 elementwise 永远打不到,除了算术强度低这个原因,还有一个:elementwise 根本不走 tensor core,它的屋顶是 19.5 TFLOP/s 那条,不是 312 那条。

## 把 312 TFLOP/s 乘出来

现在有了零件数,把峰值算力从零件表里乘出来。公式只有一条:

```
峰值 FLOP/s = SM 数 × 每 SM 每时钟的 FLOP × 时钟频率
```

每 SM 每时钟的 FLOP 又是「乘加单元数 × 每单元每时钟乘加次数 × 2」,乘 2 是因为一次乘加(FMA,fused multiply-add)算两次浮点运算,一乘一加。这个 2 就是 Day 4 里「每个参数贡献 2 FLOP」那个 2。

**A100 的 fp16 tensor core 算力**:

```
每 SM:4 个 tensor core × 256 次乘加/时钟 × 2 FLOP = 2048 FLOP/时钟
全卡:2048 × 108 个 SM = 221,184 FLOP/时钟
乘频率:221,184 × 1.41e9 Hz(boost 时钟 1410 MHz)= 3.12e14 FLOP/s = 312 TFLOP/s
```

对上了。规格表上那个 312 不是营销数字,是 4 × 256 × 2 × 108 × 1.41 GHz。

**A100 的 fp32 CUDA core 算力**:

```
每 SM:64 个 FP32 core × 1 次乘加/时钟 × 2 FLOP = 128 FLOP/时钟
全卡:128 × 108 × 1.41e9 = 1.95e13 = 19.5 TFLOP/s
```

也对上了。312 ÷ 19.5 = 16,就是「tensor core 每时钟 256 次乘加 × 4 个」比「FP32 core 每时钟 1 次 × 64 个」多的那 16 倍。

**T4 的 fp16 tensor core 算力**,换一组零件:40 个 SM、每 SM 8 个第二代 tensor core、每个每时钟 64 次乘加、boost 时钟 1590 MHz:

```
每 SM:8 × 64 × 2 = 1024 FLOP/时钟
全卡:1024 × 40 × 1.59e9 = 6.51e13 ≈ 65 TFLOP/s
```

规格表写 65,对上了。fp32:64 × 2 × 40 × 1.59e9 = 8.14e12 ≈ 8.1 TFLOP/s,也对上了。

这个练习的价值不在数字本身,而在于以后看到任何一张卡的「XXX TFLOPS」都能反问三件事:多少个 SM、每个 SM 每时钟多少次乘加、什么时钟。三个数一乘不等于标称值,那标称值里就掺了别的东西,Day 28 会讲最常见的那一种(sparse 翻倍)。

还有一个隐含的坑。上面用的是 boost 时钟 1410 MHz。GPU 满载时会因为功耗墙和温度降频,实际时钟可能只有 1200 到 1300 MHz。Day 14 说实测算力打到标称的 70 到 90%,降频是原因之一:时钟少 10%,峰值就少 10%,不是 kernel 写得不好。

## 存储金字塔:五层,每层差一个量级

现在看靛蓝色的部分。Day 13 只测了一层带宽(HBM 的 320 或 2039 GB/s),但 GPU 上的存储其实是一座金字塔,从 SM 里面的寄存器到卡外面的 PCIe,一共五层,**每往下一层,容量大一个量级,带宽小一个量级**。

| 层 | 在哪 | A100 容量 | A100 带宽量级 | 谁控制 |
| --- | --- | --- | --- | --- |
| 寄存器 | 每个 SM 内部,线程私有 | 256 KB/SM,全卡 27 MB | 几十 TB/s 以上 | 编译器 |
| shared memory / L1 | 每个 SM 内部,block 内共享 | 最多 164 KB/SM,全卡约 17 MB | 约 19 TB/s(108 × 128 B/时钟 × 1.41 GHz) | 程序员(shared)/ 硬件(L1) |
| L2 cache | 芯片上,所有 SM 共享 | 40 MB | 约 7 TB/s(5120 B/时钟 × 1.41 GHz) | 硬件 |
| HBM 显存 | 芯片旁边的颗粒 | 80 GB | 2039 GB/s | 程序员(cudaMalloc 就在这) |
| PCIe / NVLink | 卡外 | 主机内存 / 别的 GPU | PCIe 4.0 x16 约 32 GB/s 单向;NVLink 3 代 600 GB/s | 程序员 |

shared memory 和 L2 那两行的带宽是从白皮书里的「每时钟字节数」乘时钟算出来的,白皮书给的是 128 字节/时钟/SM 和 5120 字节/时钟(L2 读),不是官方直接标的 TB/s,所以写「约」。寄存器那行没有官方带宽数字,只能说量级:每个 SM 每时钟要给 64 个 FP32 core 各喂两个操作数,光这一项就是 512 字节/时钟/SM,比 shared 高 4 倍以上。

<figure>
<svg viewBox="0 0 640 360" role="img" aria-label="GPU 五层存储金字塔:寄存器、shared/L1、L2、HBM、PCIe/NVLink,自上而下容量变大、带宽变小">
  <text x="20" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">← 越靠上越小越快</text>
  <text x="470" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">越靠下越大越慢 →</text>
  <polygon points="270,40 370,40 400,90 240,90" fill="var(--mem)" />
  <text x="320" y="70" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--paper-raised)">寄存器 · 27 MB</text>
  <polygon points="240,94 400,94 430,144 210,144" fill="var(--mem)" fill-opacity="0.8" />
  <text x="320" y="124" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--paper-raised)">shared / L1 · ~17 MB</text>
  <polygon points="210,148 430,148 460,198 180,198" fill="var(--mem)" fill-opacity="0.6" />
  <text x="320" y="178" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--paper-raised)">L2 · 40 MB</text>
  <polygon points="180,202 460,202 490,252 150,252" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1.5"/>
  <text x="320" y="232" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">HBM 显存 · 80 GB · 权重 + KV cache</text>
  <polygon points="150,256 490,256 520,306 120,306" fill="var(--paper-raised)" stroke="var(--rule)" stroke-dasharray="4 3"/>
  <text x="320" y="286" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">PCIe → 主机内存 / NVLink → 别的 GPU</text>
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">
    <text x="20" y="70">带宽</text>
    <text x="20" y="124">≈ 19 TB/s</text>
    <text x="20" y="178">≈ 7 TB/s</text>
    <text x="20" y="232" fill="var(--mem)" font-weight="bold">2039 GB/s</text>
    <text x="20" y="286">32 / 600 GB/s</text>
  </g>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
    <text x="20" y="84">几十 TB/s+</text>
    <text x="500" y="70">编译器管</text>
    <text x="520" y="124">写 kernel 时管</text>
    <text x="540" y="178">硬件管</text>
    <text x="560" y="232">cudaMalloc</text>
    <text x="580" y="286">M9 主角</text>
  </g>
  <text x="20" y="340" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">Day 5 / Day 13 说的「带宽」全部指第四层那一根。上面三层放不下 13.5 GB 权重,所以 decode 每步必须从 HBM 搬。</text>
</svg>
<figcaption>五层存储金字塔。每往下一层带宽差 3 到 5 倍、容量差一到三个量级。decode 的权重 13.5 GB 只有第四层装得下,所以 roofline 的斜线用 HBM 带宽画。写 kernel 的全部技巧,归根结底是让数据尽量待在上三层。</figcaption>
</figure>

这张金字塔解释了 W1 到 W3 里三个当时只能死记的结论:

**为什么 Day 13 测带宽要用远大于 L2 的张量。**如果张量只有 20 MB,A100 的 40 MB L2 装得下,第二次读它就直接从 L2 拿,测出来是 7 TB/s 量级,是 HBM 带宽的三倍多,数字漂亮但错了。张量开到几百 MB 以上,L2 装不下,每次都得从 HBM 搬,测到的才是那条斜线。T4 的 L2 只有 4 MB,同样道理但阈值低得多。

**为什么权重每步都要搬。**13.5 GB 的权重,金字塔上面三层加起来不到 100 MB,连千分之一都装不下。所以不管 kernel 写得多好,decode 每生成一个 token 都要把整套权重从 HBM 拉一遍,这是 Day 5 那个 6.6 ms 下限的物理来源。上面三层再快也帮不上,因为东西不在那里。

**为什么 M5 要学 shared memory 和 tiling。**一个 GEMM 里,同一块数据会被用很多次(矩阵乘里每个元素参与 N 次乘加)。如果每次用都从 HBM 读,算术强度掉到 1 以下,变成 memory-bound。把要重复用的那一小块先搬到 shared memory(19 TB/s),再在里面反复用,对 HBM 来说就只读了一次。这就是 tiling,把数据从第四层搬到第二层重复利用,是所有高性能 kernel 的基本动作。路线图 W19 那句「global / shared / register 的带宽差几个数量级」,今天先把数量级记住,到时候直接用。

## roofline 其实有三条斜线

Day 5 画的 roofline 只有一条斜线,用 HBM 带宽 2039 GB/s。现在知道了上面还有 L2 和 shared 两层,每层都有自己的带宽,**每层带宽都能画一条斜线**。三条斜线斜率一样,只是往左上方平移:带宽越高,同样的算术强度能撑起越高的算力。

<figure>
<svg viewBox="0 0 640 340" role="img" aria-label="三条斜线的 roofline:HBM、L2、shared 各一条,横线是 312 TFLOP/s 峰值">
  <line x1="70" y1="290" x2="610" y2="290" stroke="var(--rule)" stroke-width="1.5"/>
  <line x1="70" y1="290" x2="70" y2="30" stroke="var(--rule)" stroke-width="1.5"/>
  <text x="330" y="322" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">算术强度 FLOP/byte(对数轴)</text>
  <text x="18" y="160" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)" transform="rotate(-90 18 160)">可达算力(对数轴)</text>
  <line x1="290" y1="60" x2="610" y2="60" stroke="var(--compute)" stroke-width="3"/>
  <text x="440" y="50" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">312 TFLOP/s · tensor core 屋顶</text>
  <line x1="290" y1="150" x2="610" y2="150" stroke="var(--compute)" stroke-width="1.5" stroke-dasharray="5 4"/>
  <text x="440" y="142" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">19.5 TFLOP/s · FP32 core 屋顶</text>
  <line x1="70" y1="290" x2="290" y2="60" stroke="var(--mem)" stroke-width="3"/>
  <text x="100" y="230" font-family="var(--font-mono)" font-size="11" fill="var(--mem)" transform="rotate(-46 100 230)">HBM 2039 GB/s</text>
  <line x1="70" y1="238" x2="240" y2="60" stroke="var(--mem)" stroke-width="1.5" stroke-opacity="0.7"/>
  <text x="96" y="176" font-family="var(--font-mono)" font-size="10" fill="var(--mem)" transform="rotate(-46 96 176)">L2 ≈ 7 TB/s</text>
  <line x1="70" y1="196" x2="200" y2="60" stroke="var(--mem)" stroke-width="1.5" stroke-opacity="0.45"/>
  <text x="90" y="128" font-family="var(--font-mono)" font-size="10" fill="var(--mem)" transform="rotate(-46 90 128)">shared ≈ 19 TB/s</text>
  <circle cx="290" cy="60" r="4.5" fill="var(--paper-raised)" stroke="var(--ink)" stroke-width="2"/>
  <text x="296" y="80" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">ridge 153(按 HBM)</text>
  <circle cx="92" cy="267" r="4.5" fill="var(--mem)"/>
  <text x="102" y="272" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">decode batch 1 · 强度 1</text>
  <text x="70" y="306" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">1</text>
  <text x="282" y="306" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">153</text>
</svg>
<figcaption>同一张卡的三条斜线。数据在 HBM 时走最下面那条,tiling 之后热数据在 shared 里走最上面那条,同样的算术强度能多撑一个量级的算力。FP32 core 那条虚线屋顶只有 tensor core 的十六分之一,elementwise 类 kernel 顶到它就到头了。</figcaption>
</figure>

这张图比 Day 5 那张多了三样东西,每样对应后面某个月要做的事:

- **多出的两条斜线**是 M5 写 kernel 时的目标:一个 GEMM kernel 好不好,看它能不能把数据从 HBM 那条线挪到 shared 那条线上算。挪成功了,同一个算术强度下可达算力就高一个量级。
- **多出的那条低屋顶**解释 Day 17 的结论:softmax、layernorm、激活函数这些 kernel 走 FP32 core,它们的屋顶是 19.5 不是 312。哪怕算术强度拉上去了,也只能顶到虚线。所以 fusion 的意义不只是省 launch,还包括把这些低屋顶的活揉进 GEMM 的读写间隙里。
- **decode batch 1 那个点还在最左下角**,不管画几条线都一样。这是硬件层面的确认:权重装不进上三层,decode 永远走 HBM 那条线,加 batch 是唯一把它往右推的办法。

## 三张卡摆在一起

把 A100、T4、H100 的零件表并排放,看代际之间什么在涨、涨多少。

| 项 | T4(Turing,2018) | A100 SXM 80GB(Ampere,2020) | H100 SXM(Hopper,2022) |
| --- | --- | --- | --- |
| SM 数 | 40 | 108 | 132 |
| FP32 core 总数 | 2560 | 6912 | 16896 |
| Tensor core | 320 个,第 2 代 | 432 个,第 3 代 | 528 个,第 4 代 |
| fp16 tensor 峰值(dense) | 65 TFLOP/s | 312 TFLOP/s | 989 TFLOP/s |
| fp32 峰值 | 8.1 TFLOP/s | 19.5 TFLOP/s | 67 TFLOP/s |
| 显存 | 16 GB GDDR6 | 80 GB HBM2e | 80 GB HBM3 |
| 显存带宽 | 320 GB/s | 2039 GB/s | 3350 GB/s |
| L2 | 4 MB | 40 MB | 50 MB |
| shared 每 SM 上限 | 64 KB | 164 KB | 228 KB |
| ridge point(fp16 ÷ 带宽) | ≈ 203 | ≈ 153 | ≈ 295 |
| 功耗 | 70 W | 400 W | 700 W |
| 支持 bf16 | 否 | 是 | 是 |
| 支持 fp8 | 否 | 否 | 是 |

几个值得停一下的地方:

**算力涨得比带宽快。**T4 到 H100,fp16 算力涨了 15 倍,带宽只涨了 10 倍;A100 到 H100,算力 3.2 倍,带宽 1.6 倍。所以 ridge point 从 153 涨到 295,同样的 decode workload 在 H100 上离屋顶更远,memory-bound 更严重。新卡不会自动解决 decode 的问题,反而把它放大了,这就是量化和 batching 越来越重要的硬件原因。

**T4 的 ridge point 比 A100 高。**203 比 153 大,不是因为 T4 算力强,是因为它的带宽弱得更厉害(320 对 2039,差 6.4 倍;算力 65 对 312,差 4.8 倍)。所以 W2、W3 在 T4 上测出来的「离屋顶多远」比 A100 上更远,拿 T4 数据外推 A100 时要记得这一点。

**H100 加了 fp8,去掉了 int4 tensor core。**数值格式是明天的主题,今天只记一件事:tensor core 支持哪些格式是分代的,T4 没有 bf16 这件事不是 bug,是 Turing 这一代硬件里没有那个电路。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| SM | Streaming Multiprocessor,GPU 里可独立调度的最小计算单元,里面有 CUDA core、tensor core、寄存器、shared memory。A100 有 108 个 |
| CUDA core | SM 里做标量浮点乘加的单元,一个时钟一次 FMA。A100 每 SM 64 个 FP32 core |
| Tensor Core | SM 里专做小块矩阵乘加的单元,一个时钟做几十到几百次乘加。fp16 GEMM 的峰值算力全靠它 |
| FMA | fused multiply-add,a × b + c 一步完成,算 2 FLOP |
| 寄存器文件 | register file,SM 内每个线程私有的最快存储,A100 每 SM 256 KB |
| shared memory | SM 内一个 block 的线程共享的可编程暂存区,和 L1 共用 192 KB,tiling 的主战场 |
| L1 cache | SM 内的硬件缓存,和 shared memory 分同一块 SRAM |
| L2 cache | 芯片上所有 SM 共享的缓存,A100 40 MB,测带宽时要用大于它的张量绕开 |
| HBM | High Bandwidth Memory,堆叠式显存,A100 用 HBM2e 80 GB 2039 GB/s。权重和 KV cache 的家 |
| GDDR6 | 消费卡和 T4 用的显存类型,带宽比 HBM 低一个量级 |
| boost 时钟 | GPU 在功耗允许时能跑到的最高频率,规格表峰值算力按它算。满载常降频 |
| warp scheduler | 每时钟从就绪的 warp 里挑一个发指令的部件,A100 每 SM 4 个(warp 本身 Day 27 讲) |
| tiling | 把大矩阵切成小块,先搬到 shared memory 再反复用,减少对 HBM 的访问 |
| NVLink | GPU 之间的直连总线,A100 上 600 GB/s,是 PCIe 的十几倍,M9 多卡时用 |
| GA100 / TU104 / GH100 | A100 / T4 / H100 的芯片代号。A100 用的 GA100 完整芯片有 128 个 SM,量产卡启用 108 个 |

## 常见误区

**把 CUDA core 数量当算力比较的依据。**A100 有 6912 个 CUDA core,H100 有 16896 个,比值 2.4;但 fp16 算力比值是 3.2,因为 tensor core 换代了,每个每时钟做的乘加翻倍。深度学习的算力看 tensor core 的代数和数量,CUDA core 数量只决定 fp32 elementwise 那条低屋顶。

**觉得 L2 越大带宽测出来越准。**反过来。L2 越大,越容易把测试张量整个吃进去,测出来的是 L2 带宽不是 HBM 带宽。A100 40 MB 的 L2 意味着测带宽时张量至少要几百 MB,T4 的 4 MB 门槛低但道理一样。Day 13 那条「张量要远大于 L2」,今天知道了为什么。

**认为 shared memory 是给程序员的「更快的显存」,想把权重放进去。**全卡 shared 加起来 17 MB,连一层 FFN 的权重(11008 × 4096 × 2 B ≈ 90 MB)都放不下。shared memory 的用法是放正在算的那一小块 tile,用完换下一块,不是放数据集。

**看到 boost 时钟就按它算峰值,然后责怪 kernel 达不到。**满载降频到 1200 到 1300 MHz 很常见,峰值直接少 10 到 15%。Day 14 实测算力和标称的差距里有一部分不是 kernel 的锅,是时钟的锅。看实测时钟用 `nvidia-smi --query-gpu=clocks.sm --format=csv`。

**把三张卡的 ridge point 当成「越高越好」。**ridge point 高说明算力相对带宽更富余,对 compute-bound 的 prefill 是好事,对 memory-bound 的 decode 意味着离屋顶更远、算力利用率更低。它是一个描述卡的性格的数,不是分数。

## 参考资料

### 文档

- NVIDIA Ampere Architecture Whitepaper(GA100)。今天所有 A100 的零件数字出处:第 3 章 SM 结构图、tensor core 每时钟乘加次数、L2 40 MB、shared 164 KB、128 B/时钟/SM 和 5120 B/时钟的带宽。https://images.nvidia.com/aem-dam/en-zz/Solutions/data-center/nvidia-ampere-architecture-whitepaper.pdf
- NVIDIA A100 产品页。312 TFLOP/s、2039 GB/s、80 GB、400 W 的官方标称。https://www.nvidia.com/en-us/data-center/a100/
- NVIDIA T4 datasheet。65 TFLOP/s fp16、320 GB/s、16 GB、70 W。https://www.nvidia.com/content/dam/en-zz/Solutions/Data-Center/tesla-t4/t4-tensor-core-datasheet-951643.pdf
- NVIDIA H100 产品页。989 TFLOP/s、3.35 TB/s、700 W。https://www.nvidia.com/en-us/data-center/h100/
- NVIDIA Ampere Architecture In-Depth(开发者博客)。白皮书的图文精简版,先读它再翻白皮书。https://developer.nvidia.com/blog/nvidia-ampere-architecture-in-depth/
- NVIDIA Deep Learning Performance Guide · GPU Performance Background。官方用一页讲完 SM、tensor core、存储层次和算术强度,和今天的内容一一对应。https://docs.nvidia.com/deeplearning/performance/dl-performance-gpu-background/index.html
- CUDA C++ Programming Guide · Hardware Implementation 一章。SM、warp、存储层次的权威定义。https://docs.nvidia.com/cuda/cuda-c-programming-guide/index.html
- TechPowerUp GPU 数据库,A100 SXM4 80 GB 和 Tesla T4 条目。SM 数、core 数、时钟、L2 的快速核对页,数字和官方一致。https://www.techpowerup.com/gpu-specs/a100-sxm4-80-gb.c3746 与 https://www.techpowerup.com/gpu-specs/tesla-t4.c3316

### 文章

- ZOMI酱《AI 系统》开源课 · GPU 工作原理(线程与缓存)。中文,和今天的存储金字塔对应。https://github.com/Infrasys-AI/AISystem/blob/main/02Hardware/03GPUBase/01Works.md
- ZOMI酱《AI 系统》开源课 · Tensor Core 基本原理(上)。中文,讲 tensor core 为什么一个时钟能做那么多次乘加。https://github.com/Infrasys-AI/AISystem/blob/main/02Hardware/04NVIDIA/01BasicTC.md
- Simon Boehm,《How to Optimize a CUDA Matmul Kernel for cuBLAS-like Performance》。一个 GEMM 从朴素版一步步用 tiling 和 shared memory 优化到接近 cuBLAS,今天讲的金字塔在这篇里全部变成代码。M5 精读,现在扫一眼图就好。https://siboehm.com/articles/22/CUDA-MMM
- Horace He,《Making Deep Learning Go Brrrr From First Principles》。Day 1 读过,今天再看它讲 memory bandwidth 那一节,会发现他画的「工厂和仓库」就是这座金字塔。https://horace.io/brrr_intro.html

### 视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Kk4y1Y7op&autoplay=0&high_quality=1" title="GPU硬件架构与CUDA如何对应?【AI芯片】GPU架构01" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>ZOMI酱 · 《GPU硬件架构与CUDA如何对应?【AI芯片】GPU架构01》· 约 18 分钟。全看。SM、CUDA core、warp、存储层次怎么和 CUDA 的编程概念对上,是今天这篇的中文视频版,明后两天讲 CUDA 执行模型时还会回头看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/SGhfUhlowB4" title="Lecture 8: CUDA Performance Checklist" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>GPU MODE · 《Lecture 8: CUDA Performance Checklist》· Mark Saroufim。看前 30 分钟讲 memory hierarchy 和 coalescing 的部分。它把今天的金字塔翻译成一张「性能检查清单」,M5 写 kernel 时要一条条对着过。</figcaption>
</figure>

- ZOMI酱,《深入GPU原理:线程和缓存关系【AI芯片】GPU原理01》,B 站 BV1bm4y1m7Ki,约 17 分钟。讲 GPU 为什么用「很多慢线程」而不是「几个快线程」来掩盖访存延迟,是今天没展开、Day 27 会讲的那一半。
- ZOMI酱,《NVIDIA英伟达Tensor Core基本原理(上)【AI芯片】GPU架构04》,B 站 BV1aL411a71w,约 11 分钟。tensor core 一个时钟做 4×4×4 矩阵乘的动画,看完「256 次乘加/时钟」就有画面了。
- Branch Education,《How do Graphics Cards Work? Exploring GPU Architecture》,YouTube h9Z4oGN89MU。3D 动画拆一张消费卡,从芯片到显存颗粒,适合建立实物感;讲的是游戏卡,数字和数据中心卡不同,看结构不看数字。

## 自测

合上笔记做。第 1 题算不出来,今天就算没过。

1. A100 有 108 个 SM,每个 SM 4 个第三代 tensor core,每个 tensor core 每时钟做 256 次 fp16 乘加,boost 时钟 1410 MHz。算出 fp16 峰值算力,并说出 fp32 CUDA core 的峰值为什么只有它的十六分之一。

<details><summary>答案</summary>

每 SM 每时钟:4 × 256 × 2 FLOP = 2048 FLOP。全卡每时钟:2048 × 108 = 221,184。乘时钟:221,184 × 1.41e9 ≈ 3.12e14 FLOP/s = 312 TFLOP/s。

fp32 走的是 64 个 CUDA core,每个每时钟 1 次乘加:64 × 2 × 108 × 1.41e9 ≈ 19.5 TFLOP/s。比值 312 ÷ 19.5 = 16,来源是 4 × 256 = 1024 次/时钟 对 64 次/时钟。两套单元是两种不同的电路,不是同一套东西的两种模式。

</details>

2. GPU 上从快到慢的五层存储分别是什么?A100 上各自的容量和带宽量级?权重 13.5 GB 能放进哪一层?

<details><summary>答案</summary>

寄存器(27 MB 全卡,几十 TB/s 以上)、shared memory / L1(约 17 MB,约 19 TB/s)、L2(40 MB,约 7 TB/s)、HBM(80 GB,2039 GB/s)、PCIe / NVLink(卡外,32 GB/s 单向 / 600 GB/s)。

13.5 GB 只有 HBM 装得下,上面三层加起来不到 100 MB。所以 decode 每步都从 HBM 搬权重,roofline 的斜线用 2039 GB/s 画。

</details>

3. Day 13 测带宽时为什么张量要远大于 L2?如果用一个 20 MB 的张量在 A100 上测,会测出什么数?

<details><summary>答案</summary>

A100 的 L2 有 40 MB,20 MB 的张量第一次从 HBM 读进来后就整个留在 L2 里,后续的读写都在 L2 完成,测出来的是 L2 带宽,量级约 7 TB/s,是 HBM 带宽的三倍多。数字漂亮但测的不是那条斜线。张量要开到几百 MB 以上,L2 装不下,每次都得回 HBM。

</details>

4. 为什么说同一张卡的 roofline 可以画三条斜线?写 kernel 时「把数据从一条线挪到另一条线」指的是什么操作?

<details><summary>答案</summary>

HBM、L2、shared memory 各有自己的带宽,每个带宽都能画一条「带宽 × 算术强度」的斜线,斜率相同,带宽越高越靠左上。数据从哪一层读,kernel 就受哪条线限制。

「挪线」就是 tiling:把要反复使用的一小块数据先从 HBM 搬到 shared memory,在里面重复用,对 HBM 只读一次。同样的算术强度下可达算力从 HBM 那条线跳到 shared 那条线,高一个量级。

</details>

5. T4 的 ridge point 是 203,比 A100 的 153 高。这说明 T4 比 A100 更适合 decode 吗?

<details><summary>答案</summary>

不是。ridge point = 算力 ÷ 带宽,T4 高是因为带宽相对算力弱得更多:带宽差 6.4 倍(320 对 2039),算力只差 4.8 倍(65 对 312)。对 decode 这种算术强度只有 1 的 workload,ridge point 越高意味着离屋顶越远、算力利用率越低。ridge point 描述的是卡的性格,不是好坏。

</details>

6. 一个 elementwise kernel(比如 SiLU 激活)把算术强度拉到了 200,超过了 A100 的 ridge point 153。它能达到 312 TFLOP/s 吗?

<details><summary>答案</summary>

不能。elementwise 运算走 FP32 CUDA core,不走 tensor core,它的屋顶是 19.5 TFLOP/s 那条虚线,不是 312。算术强度再高也只能顶到 19.5。这也是为什么这类 op 要和 GEMM fuse 在一起,让它们藏在 tensor core 的读写间隙里,而不是单独成为一个 kernel。

</details>

## 明天预告

Day 26 讲数值格式:fp32、tf32、fp16、bf16、fp8、int8、int4 各占几位,位怎么分给符号、指数、尾数,范围和精度各差多少。今天三张卡对比表里「T4 不支持 bf16、H100 加了 fp8」这两行,明天会知道为什么一个格式的支持是分代硬件的事。更重要的是把 Day 5 的带宽算式用新格式重算一遍:权重从 fp16 的 13.5 GB 压到 int8 的 6.7 GB、int4 的 3.4 GB,decode 上限从 150 tok/s 变成多少,量化到底在挪 roofline 上的哪个数。
