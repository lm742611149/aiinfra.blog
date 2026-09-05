---
title: 'Day 13 · 实测显存带宽：一次 copy 能搬多快'
description: 'W3 开工。标称 320 GB/s 是纸面数字，今天用一次最简单的逐元素加法，把 T4 真正能搬多快测出来，再把这个实测值装回 Day 5 的 decode 下限公式里。顺手踩清三个坑：字节只算读没算写、张量小到落进 L2、没 synchronize。'
pubDate: 2026-09-11
regime: memory
tags: ['bandwidth', 'benchmark', 'hbm', 'colab', 'aiinfra-365']
series: 'aiinfra-365'
day: 13
lang: 'zh'
---

## 今天要解决的问题

W1 把 Llama-2-7B 的账算到了「decode batch 1 上限 ≈ 150 token/s」,用的分母是 A100 的 2039 GB/s。W2 在 Colab 的 T4 上把 TinyLlama 的 TPOT 测了出来,和理论下限 6.9 ms 对账,那个 6.9 ms 的分母是 T4 的 320 GB/s。

这两个分母都是**厂商标称值**。标称值的意思是:总线宽度乘上时钟频率,一个字节都不浪费时理论上能达到的数。真实的 GPU 永远达不到,差多少要自己测。W3 整周只干这一件事:戳破标称值,把自己这张卡的真实屋顶测出来。今天先测屋顶的斜线那条边,显存带宽。

今天结束时要能回答三个问题:

1. 我这张卡实测能搬多快,是标称的百分之几。
2. 为什么达不到 100%,差的那部分去了哪里。
3. 测这个数的时候,最容易把数字测错的三个地方在哪。

数字口径沿用整个系列:Colab 免费卡 T4,GDDR6 16 GB,标称带宽 320 GB/s;对照卡 A100 80GB SXM,HBM2e,标称 2039 GB/s。换卡就换分母,方法不变。

## 标称 320 GB/s 是怎么算出来的

先把这个数拆开,知道它从哪来,才知道它为什么达不到。

显存带宽 = 总线位宽 × 每根线每秒传的比特数 ÷ 8。

T4 用的是 GDDR6,总线 256 bit,数据速率 10 Gbps(每根线每秒 10 × 10⁹ 个比特):

```
256 bit × 10e9 bit/s ÷ 8 bit/byte = 320e9 byte/s = 320 GB/s
```

A100 80GB SXM 用的是 HBM2e,总线宽得多,5120 bit,数据速率约 3.19 Gbps:

```
5120 bit × 3.19e9 bit/s ÷ 8 ≈ 2039e9 byte/s ≈ 2039 GB/s
```

两张卡带宽差 6.4 倍,差距几乎全来自总线宽度:5120 对 256,20 倍宽,时钟反而慢三倍。这就是 HBM 的思路,把显存芯片堆叠起来贴在 GPU 旁边,用极宽的总线换带宽,而不是靠高频。

这个算式里每一项都是「理想值」。它假设每个时钟周期每根线都在传有用数据。真实情况不是这样,原因下面说。但先记住一件事:**标称带宽是一个物理上限,不是一个典型值**。它是屋顶,不是地板,跟 Day 5 说 312 TFLOP/s 是屋顶一个道理。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="GPU 存储层次:寄存器、shared memory 与 L1、L2、HBM/GDDR、PCIe,带宽逐级下降">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<text x="20" y="26" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">离计算单元越远,带宽越低,容量越大(T4 / A100 量级)</text>
<rect x="60" y="44" width="180" height="34" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1"/>
<text x="150" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">寄存器 ~ 数十 TB/s</text>
<text x="255" y="66" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">每个 SM 256 KB,算的时候数据就在这里</text>
<rect x="60" y="92" width="240" height="34" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1"/>
<text x="180" y="114" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">shared / L1 ~ 10+ TB/s</text>
<text x="315" y="114" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">每个 SM 几十到一百多 KB</text>
<rect x="60" y="140" width="300" height="34" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1"/>
<text x="210" y="162" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">L2 ~ 数 TB/s</text>
<text x="375" y="162" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">T4 4 MB / A100 40 MB,全卡共享</text>
<rect x="60" y="188" width="360" height="34" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="2"/>
<text x="240" y="210" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">显存 GDDR6 320 GB/s / HBM2e 2039 GB/s</text>
<text x="435" y="210" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">16 GB / 80 GB,权重住这里</text>
<rect x="60" y="236" width="420" height="34" fill="none" stroke="var(--rule)" stroke-width="1" stroke-dasharray="4 3"/>
<text x="270" y="258" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">PCIe 4.0 x16 ~ 32 GB/s 单向</text>
<text x="495" y="258" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">连 CPU 内存</text>
<line x1="30" y1="44" x2="30" y2="270" stroke="var(--rule)" stroke-width="1"/>
<text x="24" y="60" text-anchor="end" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">近</text>
<text x="24" y="266" text-anchor="end" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">远</text>
<text x="20" y="292" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">今天测的是第四层:显存到计算单元这一段</text>
</svg>
<figcaption>GPU 的存储是分层的。Day 5 里 roofline 斜线的斜率、今天要测的「带宽」,指的都是最下面那层显存到芯片的速度。上面几层快得多但装不下权重,所以 decode 每一步都得从显存那层把 13.5 GB 搬上来。</figcaption>
</figure>

## 测法:一次逐元素加法

测带宽不需要模型,也不需要 profiler。原理是找一个几乎不算东西、只搬数据的操作,测它花的时间,用搬的字节数除一下。

最合适的操作是逐元素加法 `y = x + 1`:读一遍 x,写一遍 y,中间的计算量是每个元素一次加法,忽略不计。Day 1 的三分法里这就是标准的 memory-bandwidth-bound 操作,时间全花在搬上,所以「字节 ÷ 时间」测出来就是带宽。

三件事必须做对,少一件数字就是错的:

**字节要算读加写**。x 被读一遍,y 被写一遍,搬的字节是 `2 × 元素个数 × 每元素字节数`。只算 x 的大小,测出来的带宽会正好少一半。这是我预判自己最可能犯的错,因为直觉上「我处理了一个 x 那么大的张量」。

**张量要远大于 L2**。上面那张层次图里,L2 是全卡共享的缓存,T4 是 4 MB,A100 是 40 MB。如果 x 和 y 加起来能塞进 L2,第二次以后的运算根本不碰显存,直接从 L2 读,测出来的数会**高于标称带宽**。看到比标称还高的数字不是卡好,是测到了 L2。张量至少要几百 MB,让 L2 完全不够用。

**要 synchronize**。Day 8 讲过,CUDA 的操作是异步的,`torch.add` 返回时 GPU 可能还没开始干活。计时用 `torch.cuda.Event`,或者在 `time.perf_counter()` 前后都加 `torch.cuda.synchronize()`。

下面是完整的代码,在 Colab 上开 GPU 运行时直接跑:

```python
# 在 Colab 上跑:运行时 → 更改运行时类型 → T4 GPU
import torch, statistics

assert torch.cuda.is_available()
dev = torch.device("cuda")
props = torch.cuda.get_device_properties(0)
print(props.name, f"{props.total_memory / 2**30:.1f} GiB", f"L2 {props.L2_cache_size / 2**20:.0f} MiB")

# 标称带宽表,单位 GB/s,来自各卡的 NVIDIA 官方规格页
NOMINAL_GBPS = {
    "Tesla T4": 320,
    "NVIDIA A100-SXM4-80GB": 2039,
    "NVIDIA A100-PCIE-40GB": 1555,
    "NVIDIA L4": 300,
    "NVIDIA GeForce RTX 4090": 1008,
}

def measure_bw(n_bytes_per_tensor, dtype=torch.float16, iters=20):
    """对一个 n_bytes 大的张量做 y = x + 1,返回实测 GB/s(读 + 写)。"""
    elem = torch.tensor([], dtype=dtype).element_size()
    n = n_bytes_per_tensor // elem
    x = torch.randn(n, dtype=dtype, device=dev)
    y = torch.empty_like(x)            # 预分配,避免把 malloc 时间算进去

    for _ in range(3):                 # warmup:第一次跑含 kernel 加载,不能计
        torch.add(x, 1, out=y)
    torch.cuda.synchronize()

    times = []
    for _ in range(iters):
        start = torch.cuda.Event(enable_timing=True)
        end = torch.cuda.Event(enable_timing=True)
        start.record()
        torch.add(x, 1, out=y)
        end.record()
        torch.cuda.synchronize()       # 等 GPU 真的做完
        times.append(start.elapsed_time(end) / 1e3)   # ms → s

    t = statistics.median(times)       # 取中位数,不取平均,抗抖动
    moved = 2 * x.numel() * x.element_size()          # 读 x + 写 y
    return moved / t / 1e9

nominal = NOMINAL_GBPS.get(props.name)
print(f"{'tensor size':>12} {'GB/s':>8} {'% of nominal':>13}")
for mb in [1, 4, 16, 64, 256, 1024]:
    bw = measure_bw(mb * 2**20)
    pct = f"{bw / nominal * 100:5.1f}%" if nominal else "n/a"
    print(f"{mb:>9} MiB {bw:8.1f} {pct:>13}")
```

程序会打印一列张量大小和对应的实测带宽。读结果的时候看两段:

- 1 MiB、4 MiB 这几行,两个张量加起来还塞得进 T4 的 4 MB L2,或者接近能塞进去,数字会偏高甚至超过 320。**这几行不是显存带宽,忽略**。
- 64 MiB 以上,L2 彻底不够用了,数字会稳定在一个平台上。**平台的值才是这张卡的实测显存带宽**。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="实测带宽随张量大小变化的示意曲线:小张量落在 L2 里数字虚高,大张量稳定在低于标称的平台">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<line x1="70" y1="250" x2="610" y2="250" stroke="var(--ink-soft)" stroke-width="1.2"/>
<line x1="70" y1="250" x2="70" y2="30" stroke="var(--ink-soft)" stroke-width="1.2"/>
<text x="340" y="285" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">张量大小(对数刻度)→</text>
<text x="20" y="40" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">GB/s</text>
<line x1="70" y1="120" x2="610" y2="120" stroke="var(--ink-faint)" stroke-width="1" stroke-dasharray="5 4"/>
<text x="606" y="114" text-anchor="end" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">标称 320</text>
<rect x="70" y="30" width="140" height="220" fill="var(--compute-wash)" opacity="0.6"/>
<text x="140" y="52" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">落在 L2 里</text>
<text x="140" y="67" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">数字虚高,不算</text>
<rect x="330" y="30" width="280" height="220" fill="var(--mem-wash)" opacity="0.6"/>
<text x="470" y="52" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">真正的显存带宽平台</text>
<path d="M 90 60 L 130 66 L 180 78 L 230 130 L 280 152 L 330 158 L 400 160 L 480 161 L 600 161" fill="none" stroke="var(--mem)" stroke-width="2.5"/>
<circle cx="90" cy="60" r="3.5" fill="var(--mem)"/>
<circle cx="130" cy="66" r="3.5" fill="var(--mem)"/>
<circle cx="180" cy="78" r="3.5" fill="var(--mem)"/>
<circle cx="230" cy="130" r="3.5" fill="var(--mem)"/>
<circle cx="280" cy="152" r="3.5" fill="var(--mem)"/>
<circle cx="330" cy="158" r="3.5" fill="var(--mem)"/>
<circle cx="400" cy="160" r="3.5" fill="var(--mem)"/>
<circle cx="480" cy="161" r="3.5" fill="var(--mem)"/>
<circle cx="600" cy="161" r="3.5" fill="var(--mem)"/>
<text x="90" y="268" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">1 MiB</text>
<text x="230" y="268" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">16 MiB</text>
<text x="400" y="268" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">256 MiB</text>
<text x="600" y="268" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">1 GiB</text>
<text x="470" y="185" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">预期 75–90% 标称</text>
<text x="215" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">L2 装不下的转折</text>
</svg>
<figcaption>示意曲线,不是实测。左边小张量塞在 L2 里,数字可能超过标称;张量一大,曲线掉下来稳在一个平台,那个平台才是这张卡真正的显存带宽。</figcaption>
</figure>

## 结果记录表

今天写这篇的时候还没在 T4 上跑过上面的代码,所以下面这张表留空,跑完填。预期区间是根据 STREAM 类基准和 NVIDIA 文档给的经验值:**大张量逐元素操作一般能达到标称带宽的 75% 到 90%**,消费级 GDDR 卡偏低一些,HBM 卡偏高一些。填的时候如果落在这个区间外,先查是不是三个坑之一,不是的话再想别的解释。

| 张量大小 | 实测 GB/s | 占标称 % | 备注 |
| --- | --- | --- | --- |
| 1 MiB | | | 预期 > 100%,L2 命中,不算 |
| 4 MiB | | | 预期偏高,接近 L2 边界 |
| 16 MiB | | | 转折区 |
| 64 MiB | | | 开始进入平台 |
| 256 MiB | | | 平台,预期 75–90% |
| 1 GiB | | | 平台,预期 75–90% |
| 卡型号(nvidia-smi) | | | 每次都记,Colab 会换卡 |
| 日期 / 驱动版本 | | | |

再补一个对照:换 dtype 再跑一遍。把 `dtype=torch.float32` 传进去,元素数减半,字节数不变,测出来的 GB/s 应该几乎一样。带宽是按字节算的,和数据是什么类型无关。如果 fp32 和 fp16 的 GB/s 差得多,说明代码里字节数没按 `element_size()` 算,而是按元素数算了。

## 为什么达不到 100%

标称值是「每个时钟周期每根线都传有用数据」。真实显存有几笔固定开支,每一笔都从这 100% 里扣:

**刷新**。DRAM 靠电容存电,电会漏,要定期给每一行重新充电。刷新期间那块存储不能读写。GDDR 和 HBM 都有这笔开销,大约吃掉几个百分点。

**行切换**。DRAM 按行组织,读一个新行之前要先把当前行关掉、新行打开,这几十纳秒总线在等。访问越跳跃,切换越多。逐元素加法是顺序访问,切换最少,所以这个测法本来就是对显存最友好的,测出来是**上限里的上限**;真实模型里 attention 那类跳着读 KV cache 的访问模式会更差。

**读写切换**。总线从读模式切到写模式要空几个周期。`y = x + 1` 一边读一边写,切换不可避免。纯读的操作(比如只做 reduction 求和)能测出略高一点的数,但 decode 也是读权重写激活,读写混合更接近真实。

**协议与纠错**。地址、命令、ECC 校验都占总线时间。数据中心卡开 ECC 会再扣一点,T4 默认开。

**功耗与降频**。T4 的功耗墙是 70 W,持续满负荷时显存和核心时钟可能往下掉。Colab 的机房温度、同一台机器上其他任务都影响。这一条是 Colab 上数字前后不一致的主要原因,所以要多跑几次取中位数,并且每次都记卡型和当时的时钟:

```python
# 看当前时钟和功耗,判断有没有降频
!nvidia-smi --query-gpu=name,clocks.mem,clocks.max.mem,clocks.sm,clocks.max.sm,power.draw,power.limit --format=csv
```

把这几笔加起来,75% 到 90% 就是合理的落点。**这不是测法不好,是物理上就到不了 100%**。以后做 roofline 判断,斜线用实测值画,不用标称值,否则会一直追一个不存在的屋顶。这是 Day 15 要做的事。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="标称带宽被刷新、行切换、读写切换、协议开销和降频逐项扣减后剩下实测带宽的条形示意">
<rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)"/>
<text x="20" y="26" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">标称 100% 是怎么被扣成实测的(比例示意,不是精确值)</text>
<rect x="60" y="50" width="540" height="30" fill="none" stroke="var(--ink-soft)" stroke-width="1.2"/>
<text x="330" y="70" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">标称:总线位宽 × 数据速率 ÷ 8 = 100%</text>
<rect x="60" y="100" width="440" height="30" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1.5"/>
<text x="280" y="120" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">实测平台:预期 75–90%</text>
<rect x="500" y="100" width="100" height="30" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1"/>
<text x="550" y="120" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">扣掉的</text>
<line x1="500" y1="130" x2="500" y2="150" stroke="var(--compute)" stroke-width="1"/>
<text x="70" y="168" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">扣的项:DRAM 刷新 · 行切换等待 · 读写方向切换 · 地址/命令/ECC 占用总线 · 功耗墙降频</text>
<text x="70" y="192" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">顺序访问的逐元素加法已经是最友好的模式;attention 跳着读 KV cache 会再低一截</text>
</svg>
<figcaption>标称是理想总线利用率,实测是扣掉物理开销之后剩下的。扣的项没有一项是代码能优化掉的,所以 roofline 的斜线应该用实测值画。</figcaption>
</figure>

## 三个顺手能做的对照实验

主实验跑完还有余力的话,下面三个对照各花五分钟,每个都能把一条上面说的道理变成自己看到的数字。

**对照一:纯读**。把操作换成 `x.sum()`,只读不写,字节数只算 x 一份。预期比读写混合略高几个百分点,因为省掉了读写方向切换。如果反而低很多,那是 reduction 的 kernel 自己效率不够,不是带宽的事,这时候换 `torch.max(x)` 再看一次。

```python
def measure_read_only(n_bytes, dtype=torch.float16, iters=20):
    n = n_bytes // torch.tensor([], dtype=dtype).element_size()
    x = torch.randn(n, dtype=dtype, device=dev)
    for _ in range(3):
        x.sum()
    torch.cuda.synchronize()
    times = []
    for _ in range(iters):
        s, e = torch.cuda.Event(enable_timing=True), torch.cuda.Event(enable_timing=True)
        s.record(); x.sum(); e.record(); torch.cuda.synchronize()
        times.append(s.elapsed_time(e) / 1e3)
    return x.numel() * x.element_size() / statistics.median(times) / 1e9   # 只读一份

print("read-only GB/s:", round(measure_read_only(256 * 2**20), 1))
```

**对照二:跳着读**。`y = x[::2] + 1`,每隔一个元素取一个。搬的有效字节少了一半,但显存是按整块传的,跳着读时每传一块只有一半有用。预期有效带宽掉到主实验的一半左右。这就是「行切换和访问模式」那条的实物版:同样的硬件,访问模式一变,能用的带宽就变。attention 读 KV cache、embedding 按 token id 查表,都是这种跳着读。

**对照三:让 profiler 给计时作证**。Day 10 学的 `torch.profiler` 拿来包一次 `torch.add`,看两件事:kernel 名字大概是 `vectorized_elementwise_kernel` 之类,说明它确实是一个逐元素 kernel;profiler 报的 CUDA 时间应该和 Event 测的中位数对得上,差 5% 以内。对不上就是计时代码有问题,先修计时再信带宽。

```python
from torch.profiler import profile, ProfilerActivity
x = torch.randn(256 * 2**20 // 2, dtype=torch.float16, device=dev)
y = torch.empty_like(x)
torch.add(x, 1, out=y); torch.cuda.synchronize()
with profile(activities=[ProfilerActivity.CUDA]) as prof:
    torch.add(x, 1, out=y)
    torch.cuda.synchronize()
print(prof.key_averages().table(sort_by="cuda_time_total", row_limit=5))
```

三个对照做完,「带宽」这个词在我脑子里就不再是规格表上的一个数,而是三个层次:标称是总线的物理极限,顺序读写的实测是软件能用到的上限,跳着读的实测是真实模型里常见的水平。

## 把实测值装回 Day 5 的公式

Day 5 的公式是:decode batch 1 的每步时间下限 = 权重字节数 ÷ 显存带宽。当时分母用的是标称值。今天有了实测值,算式改成:

```
TinyLlama-1.1B fp16 权重 ≈ 2.2 GB
标称下限:2.2 GB ÷ 320 GB/s ≈ 6.9 ms   → 145 token/s
实测下限:2.2 GB ÷ (320 × 实测占比) GB/s
  若实测 80%:2.2 ÷ 256 ≈ 8.6 ms         → 116 token/s
  若实测 90%:2.2 ÷ 288 ≈ 7.6 ms         → 131 token/s
```

Day 9 算过一个比值:实测 TPOT ÷ 理论下限。当时分母是标称下限 6.9 ms。换成实测下限后,这个比值会变小,因为分母变大了。比值变小的部分不是优化来的,是原来把屋顶画高了。**这就是为什么要用实测值**:用标称值算,永远有一块「差距」是你怎么优化都消不掉的,那块差距不是软件问题,是屋顶本来就没那么高。

7B 在 A100 上同样重算一遍:2039 GB/s 若实测 85% 是 1733 GB/s,13.5 GB ÷ 1733 ≈ 7.8 ms,上限从 150 token/s 掉到 128 token/s。以后看到别人说「7B 在 A100 上 decode 跑到 130 token/s」,就知道这已经基本贴着实测屋顶了,不是还有一倍空间。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 显存带宽 | 显存到 GPU 芯片每秒能搬的字节数,单位 GB/s。roofline 斜线的斜率 |
| 标称带宽 | 总线位宽 × 数据速率 ÷ 8 算出来的理论上限,厂商规格表上的数 |
| GDDR6 | T4、RTX 系列用的显存,窄总线高频率。T4 是 256 bit × 10 Gbps = 320 GB/s |
| HBM2e | A100 用的堆叠显存,极宽总线低频率。5120 bit × 3.19 Gbps ≈ 2039 GB/s |
| L2 cache | 全卡共享的片上缓存,T4 4 MB、A100 40 MB。数据在 L2 里时不走显存,测带宽要避开它 |
| STREAM | 1990 年代起的经典内存带宽基准,做 copy/scale/add/triad 四种逐元素操作。今天的测法是它的 GPU 版 |
| 逐元素操作 | elementwise,每个输出只依赖同位置的输入,如加法、乘法、激活函数。几乎不算只搬,天然 memory-bound |
| torch.cuda.Event | CUDA 事件,`record()` 在 GPU 流里打时间戳,`elapsed_time()` 算两个戳的间隔,是 GPU 侧的准确计时法 |
| 中位数 | 多次测量取中间那个值,一个偶然的抖动不会像平均值那样把结果拉偏 |
| ECC | 纠错码,数据中心卡默认开,占一点总线和容量 |
| 功耗墙 | power limit,T4 是 70 W。到了就降时钟,带宽和算力一起掉 |

## 常见误区

**只算读没算写,带宽少一半**。`y = x + 1` 搬的是 x 的字节加 y 的字节。我第一反应是「处理了一个 x」,只除 x 的大小,得到的数正好是真实值的一半,还会误以为这张卡只有标称的 40%。写代码时字节数那一行要有一个明确的 `2 ×`,并且注释写清是读加写。

**张量太小,测的是 L2 不是显存**。看到超过标称的数字,不是运气好,是数据在 L2 里打转。T4 的 L2 只有 4 MB,x 和 y 加起来超过 4 MB 才开始碰显存,要彻底避开缓存效应得几百 MB 起。`torch.cuda.get_device_properties(0).L2_cache_size` 能直接查 L2 多大,张量至少取它的十倍以上。

**用 `time.time()` 直接包住一行 `torch.add`,忘了 synchronize**。测出来是 CPU 把命令扔进队列的时间,几微秒,算出来带宽几万 GB/s。这是 Day 8 的坑在换个地方再出现。Event 计时或前后都 sync,二选一必须有。

**把 `x.clone()` 当测法,却没预分配**。clone 每次都要分配新显存,PyTorch 的缓存分配器第一次会真去要内存,时间混进去了。用 `out=` 参数写进预分配好的 y,或者 `y.copy_(x)`,让每次循环只做搬运这一件事。

**测一次就信**。Colab 的 T4 会因为温度和功耗降频,同一段代码前后差 10% 很正常。跑 20 次取中位数,记下当时的 `clocks.mem` 和 `power.draw`,数字才有可比性。

**认为标称达不到是测法有问题**。75% 到 90% 是物理开销决定的,刷新、行切换、读写切换、协议都不是代码能消掉的。追到 100% 是追一个不存在的屋顶。

## 参考资料

文章

- NVIDIA Tesla T4 产品页与规格表,320 GB/s、16 GB GDDR6、70 W 的出处。https://www.nvidia.com/en-us/data-center/tesla-t4/
- NVIDIA A100 产品页,2039 GB/s(SXM 80GB)与 1555 GB/s(PCIe 40GB)的出处。https://www.nvidia.com/en-us/data-center/a100/
- NVIDIA A100 Datasheet(PDF),带宽、算力、L2 40 MB 等参数一页看全。https://www.nvidia.com/content/dam/en-zz/Solutions/Data-Center/a100/pdf/nvidia-a100-datasheet-us-nvidia-1758950-r4-web.pdf
- NVIDIA Turing Architecture Whitepaper(PDF),T4 所属架构,L2 4 MB、256-bit GDDR6 的出处。https://images.nvidia.com/aem-dam/en-zz/Solutions/design-visualization/technologies/turing-architecture/NVIDIA-Turing-Architecture-Whitepaper.pdf
- NVIDIA《GPU Performance Background》,深度学习性能文档的第一篇,讲 GPU 执行模型和为什么 memory-bound 的 op 只能看带宽。https://docs.nvidia.com/deeplearning/performance/dl-performance-gpu-background/index.html
- CUDA C++ Best Practices Guide,「Memory Optimizations」一章讲理论带宽与实测带宽的计算方式,今天的公式就是它的 PyTorch 版。https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/index.html
- STREAM benchmark 官网,经典内存带宽基准的定义与各平台结果。https://www.cs.virginia.edu/stream/
- Horace He,Making Deep Learning Go Brrrr,memory-bandwidth-bound 那节是今天测法的理论依据。https://horace.io/brrr_intro.html
- PyTorch 文档:`torch.cuda.Event`,GPU 侧计时的用法。https://docs.pytorch.org/docs/stable/generated/torch.cuda.Event.html
- PyTorch 文档:CUDA semantics,异步执行与 synchronize 的说明。https://docs.pytorch.org/docs/stable/notes/cuda.html

视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Q1Y-vkXqCKM" title="GPU Memory Hierarchy Explained: Registers, Shared Memory, L2, HBM, and PCIe (Visual) | M2L2" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Parallel Routines · GPU Memory Hierarchy Explained: Registers, Shared Memory, L2, HBM, and PCIe (Visual)。十几分钟把上面那张层次图讲活,重点看 L2 和 HBM 那两段,理解为什么小张量会「测到 L2」。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/SGhfUhlowB4" title="Lecture 8: CUDA Performance Checklist" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>GPU MODE · Lecture 8: CUDA Performance Checklist(Mark Saroufim)。前半段讲 SRAM 与 DRAM、内存延迟、coalescing,是「为什么达不到标称」那节的展开版。后半段的 occupancy 到 M5 再看。</figcaption>
</figure>

## 自测

合上笔记做。

1. T4 标称 320 GB/s 是怎么算出来的?A100 SXM 的 2039 GB/s 和它差在哪一项上?

<details><summary>答案</summary>

带宽 = 总线位宽 × 每线数据速率 ÷ 8。T4:256 bit × 10 Gbps ÷ 8 = 320 GB/s。A100:5120 bit × 3.19 Gbps ÷ 8 ≈ 2039 GB/s。差距主要在总线宽度,5120 对 256 是 20 倍,时钟反而慢三倍,这是 HBM 用堆叠换宽总线的思路。

</details>

2. 用 `y = x + 1` 测带宽,x 是 256 MiB 的 fp16 张量,一次耗时 1.8 ms,实测带宽是多少?占标称几成?

<details><summary>答案</summary>

搬的字节是读 x 加写 y,2 × 256 MiB = 512 MiB ≈ 537 MB。537 MB ÷ 1.8 ms ≈ 298 GB/s,占 320 的 93%。如果只算了 x 会得到 149 GB/s、47%,少一半。

</details>

3. 跑出来 1 MiB 张量的带宽是 900 GB/s,超过标称近三倍,说明什么?

<details><summary>答案</summary>

x 和 y 加起来 2 MiB,塞得进 T4 的 4 MB L2,warmup 之后数据一直在 L2 里,测的是 L2 带宽不是显存带宽。这行数据忽略,看几百 MB 以上的平台值。

</details>

4. 说出至少三个让实测带宽达不到标称的物理原因。哪一个在 Colab 上最容易让前后数字不一致?

<details><summary>答案</summary>

DRAM 刷新、行切换等待、读写方向切换、地址/命令/ECC 占总线、功耗墙降频。Colab 上前后不一致主要是降频,T4 功耗墙 70 W,温度和功耗一到就掉时钟,所以要多次取中位数并记录当时的 clocks.mem 和 power.draw。

</details>

5. 换成 fp32 再测,GB/s 应该变还是不变?为什么?如果变了很多说明什么?

<details><summary>答案</summary>

几乎不变。带宽按字节算,fp32 元素数减半、每元素字节翻倍,总字节一样。如果差很多,大概率是代码按元素数而不是 `element_size()` 算字节了。

</details>

6. 实测带宽是标称的 80%,TinyLlama 在 T4 上的 decode 理论下限从多少变成多少?Day 9 那个「实测 ÷ 理论」比值会怎么变,变的那部分是优化来的吗?

<details><summary>答案</summary>

标称下限 2.2 GB ÷ 320 GB/s ≈ 6.9 ms;实测下限 2.2 ÷ 256 ≈ 8.6 ms,上限从 145 token/s 降到 116 token/s。比值的分母变大所以比值变小,但那不是优化,是原来的屋顶画高了。以后判断差距要用实测屋顶。

</details>

## 明天预告

Day 14 测屋顶的另一条边:峰值算力。方法是让 GPU 做一件纯算不怎么搬的事,大方阵矩阵乘法,FLOPs = 2MNK,除以时间就是实测 TFLOP/s。坑比今天多:矩阵不够大打不满、fp32 的标称是另一个数、fp16 要真走 tensor core 才对得上 65 TFLOPS。明天还会算一个数:方阵多大时 matmul 才从 memory-bound 跨到 compute-bound。答案和 ridge point 有关。
