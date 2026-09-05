---
title: 'Day 14 · 实测峰值算力：大方阵 matmul 能打到几成'
description: '昨天测了斜线，今天测屋顶。用大方阵矩阵乘法把 T4 真正能算多快测出来：FLOPs = 2MNK 除以时间。坑比带宽多：矩阵不够大打不满、fp32 的标称是另一个数、fp16 要真走 tensor core 才对得上 65 TFLOPS、A100 的 624 是稀疏值。顺手算出方阵多大才跨过 ridge point。'
pubDate: 2026-09-12
regime: compute
tags: ['flops', 'matmul', 'tensor-core', 'benchmark', 'colab', 'aiinfra-365']
series: 'aiinfra-365'
day: 14
lang: 'zh'
---

## 今天要解决的问题

roofline 有两条线。昨天测了斜线的斜率,显存带宽;今天测横线的高度,峰值算力。方法和昨天对称:昨天找一个只搬不算的操作,今天找一个只算不怎么搬的操作。这个操作就是大方阵矩阵乘法。

今天结束时要能回答:

1. 我这张卡实测能算多快,是标称的百分之几。
2. 为什么矩阵小了打不满,多大才够。
3. fp16、fp32、tf32 三个「峰值」为什么是三个完全不同的数,测的时候在比哪一个。
4. 方阵边长多大时,矩阵乘法从 memory-bound 跨到 compute-bound。

口径:T4 标称 fp16 tensor core 65 TFLOP/s、fp32 8.1 TFLOP/s;A100 80GB SXM 标称 bf16/fp16 tensor core 312 TFLOP/s(dense)、tf32 156、fp32 19.5。ridge point 用昨天的记法:T4 约 203,A100 约 153。

## 矩阵乘法要算多少次:2MNK

一个 M×K 的矩阵 A 乘一个 K×N 的矩阵 B,得到 M×N 的 C。C 里每一个格子是 A 的一行和 B 的一列做点积:K 次乘法、K 次加法,2K 次浮点运算。C 一共 M×N 个格子,所以:

```
FLOPs(matmul) = 2 × M × N × K
```

方阵 M = N = K 的话就是 2N³。N = 4096 时是 2 × 4096³ ≈ 1.37 × 10¹¹ = 137 GFLOP。T4 的 65 TFLOP/s 全开要 2.1 ms;A100 的 312 TFLOP/s 全开要 0.44 ms。

这和 Day 4 的 2N(参数量)那条公式是同一件事。当时说「每个参数一乘一加,2 FLOP」,一层线性层就是一个 token 向量(1×d)乘权重矩阵(d×d),M = 1、N = K = d,2 × 1 × d × d = 2d²,正好是每个参数 2 FLOP。今天只是把 M 从 1 放大到几千。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="矩阵乘法 C = A × B 的示意:C 的一个格子由 A 的一行与 B 的一列做 K 次乘加得到,共 M×N 个格子">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
<rect x="40" y="70" width="150" height="120" fill="none" stroke="var(--ink-soft)" stroke-width="1.2"/>
<text x="115" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">A:M × K</text>
<rect x="40" y="110" width="150" height="16" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1"/>
<text x="115" y="205" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">K 列</text>
<text x="215" y="135" text-anchor="middle" font-family="var(--font-mono)" font-size="16" fill="var(--ink)">×</text>
<rect x="240" y="40" width="120" height="150" fill="none" stroke="var(--ink-soft)" stroke-width="1.2"/>
<text x="300" y="30" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">B:K × N</text>
<rect x="292" y="40" width="16" height="150" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1"/>
<text x="300" y="205" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">N 列</text>
<text x="385" y="135" text-anchor="middle" font-family="var(--font-mono)" font-size="16" fill="var(--ink)">=</text>
<rect x="410" y="70" width="120" height="120" fill="none" stroke="var(--ink-soft)" stroke-width="1.2"/>
<text x="470" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">C:M × N</text>
<rect x="462" y="110" width="16" height="16" fill="var(--compute)" stroke="var(--compute)" stroke-width="1"/>
<text x="470" y="205" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">M × N 个格子</text>
<text x="320" y="238" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一个格子 = K 次乘 + K 次加 = 2K FLOP;总计 2 × M × N × K</text>
</svg>
<figcaption>C 里每个格子是 A 的一行(高亮)和 B 的一列(高亮)的点积,K 次乘加。格子有 M×N 个,所以整个矩阵乘法是 2MNK 次浮点运算。方阵就是 2N³。</figcaption>
</figure>

## 三个「峰值」是三个数

T4 的规格表上算力写了好几个数,拿错一个,测出来的百分比就差八倍。

**fp32 8.1 TFLOP/s**:普通 CUDA core 做 32 位浮点乘加。T4 有 2560 个 CUDA core,每个每周期一次乘加(2 FLOP),boost 时钟 1.59 GHz:

```
2560 × 2 × 1.59e9 ≈ 8.1e12 FLOP/s
```

**fp16 tensor core 65 TFLOP/s**:tensor core 是专门做小块矩阵乘的单元,一次算一个 4×4×4 的小矩阵乘,64 次乘加。T4 有 40 个 SM,每个 SM 8 个 tensor core:

```
40 SM × 8 TC × 64 FMA × 2 FLOP × 1.59e9 ≈ 65e12 FLOP/s
```

两个数都能从硬件配置算出来,这说明它们是「所有单元每周期都在干活」的理想值,和昨天带宽的标称是一个性质。

**A100 的一串数**:fp32 19.5(6912 CUDA core × 2 × 1.41 GHz);tf32 tensor core 156;fp16/bf16 tensor core 312(108 SM × 4 TC × 256 FMA × 2 × 1.41 GHz ≈ 312e12);**还有一个 624,是稀疏算力**,前提是权重里每 4 个数有 2 个是零并且用了结构化稀疏格式。普通模型没这个前提,dense 的 312 才是能比的数。宣传页喜欢写 624,看到要自动除二。

所以测之前先定好比哪个:**fp16 输入的 matmul 比 tensor core 的标称,fp32 输入的比 CUDA core 的标称**。fp32 矩阵乘测出 7 TFLOP/s 是打到了 8.1 的 86%,不是 65 的 11%。

tf32 是 Ampere 起的一个折中:输入是 fp32 张量,tensor core 内部把尾数截到 10 位算,速度接近 fp16 tensor core 的一半。PyTorch 里 `torch.backends.cuda.matmul.allow_tf32` 控制 fp32 matmul 是否走这条路,默认关。T4 是 Turing,没有 tf32,这个开关不起作用;A100 上打开后 fp32 matmul 能从 19.5 跳到接近 156 的水平,测的时候一定要记录开关状态,否则同一段代码两张卡差十倍不知道为什么。

## 矩阵多大才打满

matmul 是 compute-bound 的代表,但只有矩阵足够大时才是。小矩阵打不满有三个原因,每一个都能用已学的东西解释。

**原因一:算术强度不够,还在斜线上**。matmul 要读 A、读 B、写 C,字节数是 2 × (MK + KN + MN)(fp16 每个数 2 字节)。方阵时:

```
算术强度 = 2N³ ÷ (2 × 3N²) = N / 3   FLOP/byte
```

Day 5 的判定:强度低于 ridge point 就是 memory-bound。T4 ridge ≈ 203,N / 3 > 203 要 N > 609;A100 ridge ≈ 153,要 N > 459。也就是说**方阵边长几百以下,矩阵乘法根本不是算力问题,是带宽问题**,再多的 tensor core 也在等数据。这个数很有用:decode 阶段 batch 1 的线性层是 1×4096 乘 4096×4096,M = 1,强度是 2MNK ÷ 2(MK + KN + MN) ≈ 2 × 4096² ÷ 2 × 4096² ≈ 1,正是 Day 5 算的那个 1。matmul 不是天生 compute-bound,是**大**矩阵乘才 compute-bound。

**原因二:填不满 40 个 SM**。cuBLAS 把 C 切成 tile(比如 128×128 一块),每块分给一个 SM 算。N = 512 时 C 只有 16 块,T4 有 40 个 SM,24 个闲着。N 要到几千,块数远多于 SM 数,才能每个 SM 都排满活。而且块数不是 SM 数的整数倍时最后一波会有「尾巴」,一部分 SM 提前干完等别人,这叫 wave quantization,是 N 稍微改一下性能跳一下的原因。

**原因三:launch 开销与固定成本**。一个 kernel 启动要几微秒,N = 256 的 matmul 只算 33 MFLOP,T4 满速 0.5 微秒就算完,启动开销比计算还长。这时测的是 overhead,Day 11 讨论过。

综合起来,方阵要 **4096 起**才能接近打满,8192 更稳。T4 上 8192 的 fp16 方阵三个矩阵共 3 × 8192² × 2 B = 384 MB,显存够。A100 上可以到 16384。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="实测算力随方阵边长 N 增大的示意曲线:N 小时受带宽与 SM 填充限制,N 到几千后接近标称的 70–90% 平台">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<line x1="70" y1="250" x2="610" y2="250" stroke="var(--ink-soft)" stroke-width="1.2"/>
<line x1="70" y1="250" x2="70" y2="30" stroke="var(--ink-soft)" stroke-width="1.2"/>
<text x="340" y="285" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">方阵边长 N(对数刻度)→</text>
<text x="20" y="40" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">TFLOP/s</text>
<line x1="70" y1="70" x2="610" y2="70" stroke="var(--ink-faint)" stroke-width="1" stroke-dasharray="5 4"/>
<text x="606" y="64" text-anchor="end" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">标称 65(fp16 tensor core)</text>
<rect x="70" y="30" width="170" height="220" fill="var(--mem-wash)" opacity="0.6"/>
<text x="155" y="52" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">N/3 &lt; ridge:memory-bound</text>
<text x="155" y="67" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">SM 也填不满</text>
<rect x="400" y="30" width="210" height="220" fill="var(--compute-wash)" opacity="0.6"/>
<text x="505" y="52" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">compute-bound 平台</text>
<text x="505" y="67" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">预期 70–90% 标称</text>
<path d="M 90 240 L 150 225 L 210 190 L 270 140 L 330 108 L 400 94 L 470 90 L 540 89 L 600 90" fill="none" stroke="var(--compute)" stroke-width="2.5"/>
<circle cx="90" cy="240" r="3.5" fill="var(--compute)"/>
<circle cx="150" cy="225" r="3.5" fill="var(--compute)"/>
<circle cx="210" cy="190" r="3.5" fill="var(--compute)"/>
<circle cx="270" cy="140" r="3.5" fill="var(--compute)"/>
<circle cx="330" cy="108" r="3.5" fill="var(--compute)"/>
<circle cx="400" cy="94" r="3.5" fill="var(--compute)"/>
<circle cx="470" cy="90" r="3.5" fill="var(--compute)"/>
<circle cx="540" cy="89" r="3.5" fill="var(--compute)"/>
<circle cx="600" cy="90" r="3.5" fill="var(--compute)"/>
<text x="90" y="268" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">256</text>
<text x="210" y="268" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">1024</text>
<text x="330" y="268" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">2048</text>
<text x="470" y="268" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">4096</text>
<text x="600" y="268" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">8192</text>
<line x1="240" y1="30" x2="240" y2="250" stroke="var(--ink-faint)" stroke-width="1" stroke-dasharray="2 3"/>
<text x="244" y="245" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">N ≈ 609,T4 的 3 × ridge</text>
</svg>
<figcaption>示意曲线,不是实测。左边小矩阵算术强度 N/3 还低于 ridge point,落在 roofline 斜线上;过了几百之后进入横线区,但要到几千才把 SM 填满、把 launch 开销摊薄,曲线才压到平台。</figcaption>
</figure>

## 测法:方阵 matmul 扫一遍

代码结构和昨天一样:预分配、warmup、Event 计时、中位数。多了一件事,同一组尺寸分别用 fp16 和 fp32 跑,各比各的标称。

```python
# 在 Colab 上跑:运行时 → 更改运行时类型 → T4 GPU
import torch, statistics

assert torch.cuda.is_available()
dev = torch.device("cuda")
name = torch.cuda.get_device_name(0)
print(name)

# 标称峰值,单位 TFLOP/s,dense。来自 NVIDIA 官方规格页
NOMINAL_TFLOPS = {
    "Tesla T4":              {"fp16_tc": 65,  "fp32": 8.1},
    "NVIDIA A100-SXM4-80GB": {"fp16_tc": 312, "fp32": 19.5, "tf32": 156},
    "NVIDIA L4":             {"fp16_tc": 121, "fp32": 30.3},
}
nominal = NOMINAL_TFLOPS.get(name, {})

# 记录 tf32 开关状态;T4 没有 tf32,这个开关不影响结果
print("allow_tf32 =", torch.backends.cuda.matmul.allow_tf32)

def measure_matmul_tflops(n, dtype, iters=20):
    """n×n 方阵乘法,返回实测 TFLOP/s。"""
    a = torch.randn(n, n, dtype=dtype, device=dev)
    b = torch.randn(n, n, dtype=dtype, device=dev)
    c = torch.empty(n, n, dtype=dtype, device=dev)   # 预分配输出

    for _ in range(3):                               # warmup:cuBLAS 第一次要选算法
        torch.matmul(a, b, out=c)
    torch.cuda.synchronize()

    times = []
    for _ in range(iters):
        s = torch.cuda.Event(enable_timing=True)
        e = torch.cuda.Event(enable_timing=True)
        s.record()
        torch.matmul(a, b, out=c)
        e.record()
        torch.cuda.synchronize()
        times.append(s.elapsed_time(e) / 1e3)        # 秒

    t = statistics.median(times)
    flops = 2 * n ** 3                                # 2MNK,方阵
    return flops / t / 1e12

for dtype, key in [(torch.float16, "fp16_tc"), (torch.float32, "fp32")]:
    peak = nominal.get(key)
    print(f"\n{dtype}  标称 {peak} TFLOP/s")
    print(f"{'N':>6} {'TFLOP/s':>9} {'% of nominal':>13} {'ms':>8}")
    for n in [256, 512, 1024, 2048, 4096, 8192]:
        if dtype == torch.float32 and n > 4096:
            continue                                  # fp32 8192 三个矩阵 768 MB,T4 上可以跑但慢,先跳过
        tf = measure_matmul_tflops(n, dtype)
        ms = 2 * n ** 3 / (tf * 1e12) * 1e3
        pct = f"{tf / peak * 100:5.1f}%" if peak else "n/a"
        print(f"{n:>6} {tf:9.1f} {pct:>13} {ms:8.3f}")
```

跑完看三件事:

- fp16 那张表从 256 到 8192,百分比应该一路爬升然后压平。**平台值就是这张卡的实测峰值算力**。
- fp32 那张表的百分比也会爬升压平,但比的是 8.1 不是 65。两张表的**绝对值**差七八倍是正常的,那是 tensor core 和 CUDA core 的差距,不是测错。
- 8192 的 fp16 一次大概两三毫秒,20 次加 warmup 不到一秒。如果一次要几十毫秒,先看 `nvidia-smi` 有没有降频,再看是不是 dtype 传错了。

## 从方阵到真实形状:prefill 和 decode 的 GEMM

方阵是测峰值用的,模型里没有方阵。真实的线性层形状是「token 数 × d」乘「d × d」或「d × 11008」。把 2MNK 和字节数的公式套上去,能把 Day 5 的结论从 GEMM 的角度重新推一遍。

一般形状的算术强度(fp16,2 字节):

```
强度 = 2MNK ÷ 2(MK + KN + MN) = MNK ÷ (MK + KN + MN)
```

**prefill**:一次喂 2048 个 token,过 Llama-2-7B 的一个 4096×4096 投影。M = 2048、K = N = 4096:

```
2048 × 4096 × 4096 ÷ (2048×4096 + 4096×4096 + 2048×4096)
= 2048 × 4096 ÷ (2048 + 4096 + 2048) = 1024 FLOP/byte
```

远超 153,牢牢在横线上。prefill 是 compute-bound,这是 Day 5 说过的,现在有了 GEMM 级别的算式。

**decode**:一次只有 batch 个 token,M = b,K = N = 4096。分母里 KN = 4096² 这一项(权重矩阵本身)占绝对主导,MK 和 MN 都只有 b × 4096,b 小时可以忽略:

```
强度 ≈ b × 4096 × 4096 ÷ 4096² = b
```

强度约等于 batch 大小。b = 1 时是 1,b = 153 时到 ridge point。这正是 Day 5 「batch ≈ 153 才 compute-bound」那个结论,当时是用「权重搬一遍、算力干活 b 次」推的,今天从 GEMM 的字节数直接得到同一个数。两条路推出同一个结果,这个数就可以放心用了。

| 形状(M × K · K × N) | 场景 | 强度 FLOP/byte | 在 A100 roofline 上 |
| --- | --- | --- | --- |
| 1 × 4096 · 4096 × 4096 | decode batch 1 | ≈ 1 | 斜线最底部 |
| 32 × 4096 · 4096 × 4096 | decode batch 32 | ≈ 32 | 斜线上,离 ridge 还差 5 倍 |
| 153 × 4096 · 4096 × 4096 | decode batch 153 | ≈ 153 | ridge point |
| 2048 × 4096 · 4096 × 4096 | prefill 2048 token | 1024 | 横线 |
| 2048 × 4096 · 4096 × 11008 | prefill 过 FFN 第一层 | ≈ 1200 | 横线 |
| 4096 × 4096 · 4096 × 4096 | 方阵基准 | 1365 | 横线,测峰值用这种 |

顺手做一个五分钟对照实验,把「强度 ≈ b」变成自己看到的数:固定 K = N = 2048(TinyLlama 的 d),把 M 从 1 扫到 512,看实测 TFLOP/s 怎么爬。M = 1 时应该只有峰值的零点几个百分点,M 每翻一倍 TFLOP/s 也接近翻倍,直到 M 过了 ridge 附近才压平。这就是 Day 16 batch 扫描要看到的曲线的 GEMM 版。

```python
K = N = 2048   # TinyLlama 的 d
b_mat = torch.randn(K, N, dtype=torch.float16, device=dev)       # 权重矩阵,常驻
print(f"{'M':>5} {'TFLOP/s':>9} {'强度≈':>6}")
for m in [1, 4, 16, 64, 256, 512]:
    a = torch.randn(m, K, dtype=torch.float16, device=dev)
    c = torch.empty(m, N, dtype=torch.float16, device=dev)
    for _ in range(3):
        torch.matmul(a, b_mat, out=c)
    torch.cuda.synchronize()
    times = []
    for _ in range(20):
        s, e = torch.cuda.Event(enable_timing=True), torch.cuda.Event(enable_timing=True)
        s.record(); torch.matmul(a, b_mat, out=c); e.record(); torch.cuda.synchronize()
        times.append(s.elapsed_time(e) / 1e3)
    tf = 2 * m * N * K / statistics.median(times) / 1e12
    ai = m * N * K / (m * K + K * N + m * N)
    print(f"{m:>5} {tf:9.2f} {ai:6.1f}")
```

## 顺手确认走了 tensor core

fp16 的 matmul 默认会走 tensor core,但「默认」不等于「一定」。形状没对齐(比如 M、N、K 不是 8 的倍数)、张量不连续、或者某些老版本的 PyTorch,cuBLAS 可能退回普通 kernel。确认的办法是看 kernel 名。用 Day 10 的 profiler 包一次 4096 方阵:

```python
from torch.profiler import profile, ProfilerActivity
a = torch.randn(4096, 4096, dtype=torch.float16, device=dev)
b = torch.randn(4096, 4096, dtype=torch.float16, device=dev)
torch.matmul(a, b); torch.cuda.synchronize()
with profile(activities=[ProfilerActivity.CUDA]) as prof:
    torch.matmul(a, b); torch.cuda.synchronize()
print(prof.key_averages().table(sort_by="cuda_time_total", row_limit=3))
```

T4 上 kernel 名里应该带 `turing_fp16_s1688gemm` 之类的字样,A100 上是 `ampere_fp16_s16816gemm` 或 `cutlass_..._tensorop_...`。名字里的 `s1688`、`s16816` 是 tensor core 指令的形状(16×8×8、16×8×16),看到它就是走了 tensor core。如果名字是 `sgemm`、`hgemm` 这种没有 tensorop 字样的,大概率退回了普通 kernel,那实测比 65 的百分比会低到个位数,这时候先检查形状对齐和 dtype,不是卡的问题。

## 结果记录表

写这篇时还没在 T4 上跑,表留空。预期依据:cuBLAS 在大方阵 fp16 上一般能到标称的 **70% 到 90%**,HBM 卡略偏高,T4 这种 70 W 功耗墙的卡持续跑大矩阵容易降频,偏低一些也正常。

| N | fp16 TFLOP/s | 占 65 % | fp32 TFLOP/s | 占 8.1 % | 备注 |
| --- | --- | --- | --- | --- | --- |
| 256 | | | | | 预期很低,launch 开销 + 强度不够 |
| 512 | | | | | N/3 = 171 < 203,仍 memory-bound |
| 1024 | | | | | 跨过 ridge,但 SM 填不满 |
| 2048 | | | | | 爬升 |
| 4096 | | | | | 接近平台 |
| 8192 | | | 跳过 | | 平台,预期 70–90% |
| 卡型 / 时钟 / 功耗 | | | | | `nvidia-smi --query-gpu=clocks.sm,power.draw --format=csv` |
| allow_tf32 | | | | | T4 上无影响,A100 上决定 fp32 走哪条路 |

再记一个交叉验证:fp16 N = 4096 时,实测毫秒数乘实测 TFLOP/s 应该等于 137 GFLOP,这是恒等式,对不上就是哪里算错。

## 为什么打不到 100%

和带宽一样,算力也有几笔物理和结构上的固定扣减:

**功耗墙与时钟**。65 TFLOP/s 按 boost 时钟 1.59 GHz 算,T4 在 70 W 下持续跑大矩阵基本稳不住 boost,时钟掉到 1.2 到 1.4 GHz 的话上限就掉到 49 到 57。这一条在 Colab 上是主因。A100 400 W 好得多,但也不是恒定 boost。

**tile 与 wave 的尾巴**。C 切成的块数不是 SM 数整数倍,最后一波有 SM 空转。N = 8192、tile 128×128 时是 4096 块,除以 40 个 SM 余 16,最后一波 40 个 SM 只有 16 个有活,103 波里浪费了大半波,损失不到 1%。矩阵越大这项越小。

**数据搬运没完全藏住**。tensor core 算的时候,下一块的数据要从 L2 和显存搬进 shared memory。cuBLAS 用流水线让搬和算重叠,但每块开头结尾总有没重叠上的部分。

**换算与规整**。fp16 输出要累加成 fp32 再转回来,epilogue 那几步不算在 2N³ 里但占时间。

所以 70% 到 90% 是正常落点。到 Day 15 画 roofline 时,横线用实测值,横线低了 ridge point 也会跟着左移,后面判断 batch 多大才 compute-bound 都要用移过的数。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="不同 op 在 roofline 上的位置:decode 线性层强度约 1 在斜线底部,小方阵 matmul 在斜线上,大方阵 matmul 贴近横线">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<line x1="70" y1="210" x2="610" y2="210" stroke="var(--ink-soft)" stroke-width="1.2"/>
<line x1="70" y1="210" x2="70" y2="30" stroke="var(--ink-soft)" stroke-width="1.2"/>
<text x="340" y="240" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">算术强度 FLOP/byte(对数)→</text>
<text x="20" y="40" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">可达算力</text>
<path d="M 70 210 L 350 60" fill="none" stroke="var(--mem)" stroke-width="2.5"/>
<path d="M 350 60 L 610 60" fill="none" stroke="var(--compute)" stroke-width="2.5"/>
<line x1="350" y1="60" x2="350" y2="210" stroke="var(--ink-faint)" stroke-width="1" stroke-dasharray="3 3"/>
<text x="350" y="226" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">ridge ≈ 203(T4)</text>
<circle cx="95" cy="197" r="5" fill="var(--mem)"/>
<text x="105" y="190" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">decode 线性层,强度 ≈ 1</text>
<circle cx="250" cy="114" r="5" fill="var(--mem)"/>
<text x="120" y="108" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">方阵 N=256,强度 85</text>
<circle cx="420" cy="60" r="5" fill="var(--compute)"/>
<text x="430" y="82" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">N=2048,强度 683:贴屋顶</text>
<circle cx="540" cy="60" r="5" fill="var(--compute)"/>
<text x="550" y="50" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">N=8192</text>
<text x="100" y="60" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">斜线:带宽 × 强度</text>
<text x="380" y="45" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">横线:峰值算力</text>
</svg>
<figcaption>同样是「矩阵乘法」,decode 的 1×4096 乘 4096×4096 强度只有 1,趴在斜线底部;方阵边长过了 3 × ridge 才爬上横线。今天测峰值必须用右边那种矩阵,Day 9 测的 TPOT 对应的是左边那个点。</figcaption>
</figure>

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 2MNK | M×K 乘 K×N 矩阵乘法的 FLOPs。每个输出格子 K 次乘加共 2K FLOP,M×N 个格子 |
| GEMM | General Matrix Multiply,矩阵乘法在 BLAS 库里的名字,cuBLAS/CUTLASS 的核心 kernel |
| CUDA core | 做普通标量浮点运算的单元,fp32 峰值按它算。T4 2560 个,A100 6912 个 |
| tensor core | 专门做小块矩阵乘加的单元,fp16/bf16/tf32/int8 的峰值按它算。T4 每 SM 8 个,A100 每 SM 4 个(但每个更宽) |
| SM | Streaming Multiprocessor,GPU 的基本计算单元,含 CUDA core、tensor core、寄存器和 shared memory。T4 40 个,A100 108 个 |
| dense / sparse 峰值 | dense 是普通矩阵的峰值;sparse(A100 的 624)要求 2:4 结构化稀疏,普通模型用不上。比较时用 dense |
| tf32 | Ampere 起的格式,fp32 输入、10 位尾数、走 tensor core。PyTorch 由 `allow_tf32` 控制。T4 没有 |
| cuBLAS | NVIDIA 的 BLAS 库,PyTorch 的 matmul 默认调它。第一次调用会选算法,所以要 warmup |
| tile | cuBLAS 把输出矩阵切成的小块,一块分给一个 SM 算 |
| wave quantization | 块数不是 SM 数整数倍时最后一波部分 SM 空转的损失 |
| boost 时钟 | 标称峰值按它算的最高时钟,功耗或温度一到就往下掉 |
| epilogue | GEMM 主循环之后的收尾:累加结果转精度、加 bias、写回 |

## 常见误区

**拿 fp32 的实测比 fp16 的标称**。fp32 matmul 在 T4 上最多 8.1 TFLOP/s,和 65 一比只有 12%,以为卡坏了或者驱动有问题。规格表上每种精度一个数,实测什么精度就比什么精度的标称。

**拿 A100 的 624 当峰值**。624 是 2:4 结构化稀疏,普通 dense 权重的峰值是 312。拿 624 做分母,再好的实测也只有 45%,ridge point 也会算成 306 而不是 153,后面所有「batch 多大才 compute-bound」的判断全部翻倍错。

**矩阵太小,测的是 launch 开销或者带宽**。N = 256 的 fp16 方阵强度只有 85,低于 T4 的 ridge 203,它就是 memory-bound 的;N = 512 强度 171,还是 memory-bound。打不满是物理规律,不是 cuBLAS 不行。方阵至少 4096。

**忘了 allow_tf32 的状态**。A100 上 fp32 matmul 开了 tf32 走 tensor core,关了走 CUDA core,速度差八倍,结果的精度也不同。T4 上这个开关没影响,但换到 A100 就会疑惑「为什么 fp32 突然快这么多」。测的时候把开关状态打印出来记进表里。

**没预分配输出,或者用 `a @ b` 让每次都分配**。第一次分配会真正向驱动要显存,后面缓存分配器接管了才快。用 `torch.matmul(a, b, out=c)`,循环里只做乘法这一件事。

**没 warmup,把 cuBLAS 选算法的时间算进去**。cuBLAS 第一次遇到一个新形状会试几种 kernel 挑最快的,那一次慢很多。warmup 三次再计时,和 Day 7、Day 8 的规矩一样。

## 参考资料

文章

- NVIDIA Tesla T4 产品页,65 TFLOP/s fp16 tensor core、8.1 TFLOP/s fp32、40 SM、2560 CUDA core 的出处。https://www.nvidia.com/en-us/data-center/tesla-t4/
- NVIDIA A100 Datasheet(PDF),312 dense / 624 sparse、tf32 156、fp32 19.5、108 SM 的出处,「结构化稀疏」的注脚也在这页。https://www.nvidia.com/content/dam/en-zz/Solutions/Data-Center/a100/pdf/nvidia-a100-datasheet-us-nvidia-1758950-r4-web.pdf
- NVIDIA Turing Architecture Whitepaper(PDF),T4 每 SM 8 个 tensor core、4×4×4 FMA 的出处。https://images.nvidia.com/aem-dam/en-zz/Solutions/design-visualization/technologies/turing-architecture/NVIDIA-Turing-Architecture-Whitepaper.pdf
- NVIDIA《Matrix Multiplication Background User's Guide》,讲 GEMM 的算术强度、tile、wave quantization,今天「矩阵多大才打满」那节的原始出处,必读。https://docs.nvidia.com/deeplearning/performance/dl-performance-matrix-multiplication/index.html
- NVIDIA《GPU Performance Background》,tensor core 与 CUDA core 的区别、峰值怎么算。https://docs.nvidia.com/deeplearning/performance/dl-performance-gpu-background/index.html
- Simon Boehm,How to Optimize a CUDA Matmul Kernel for cuBLAS-like Performance,从朴素写法一步步到 cuBLAS 九成性能,看它就知道 cuBLAS 那 70–90% 是怎么挣来的。M5 会再读。https://siboehm.com/articles/22/CUDA-MMM
- NVIDIA CUTLASS 仓库,开源的 GEMM 模板库,cuBLAS 之外看 tile 结构的地方。https://github.com/NVIDIA/cutlass
- Karl Rupp,CPU-GPU-MIC 历年峰值算力与带宽对比图,看各代卡的 ridge point 怎么随时间变。https://github.com/karlrupp/CPU-GPU-MIC-Comparison
- Wikipedia,Roofline model,横线纵线的正式定义。https://en.wikipedia.org/wiki/Roofline_model
- PyTorch 文档:CUDA semantics,tf32 开关 `torch.backends.cuda.matmul.allow_tf32` 的说明在这一页。https://docs.pytorch.org/docs/stable/notes/cuda.html

视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/yyR0ZoCeBO8" title="Tensor Cores in a Nutshell" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>NVIDIA Developer · Tensor Cores in a Nutshell。几分钟讲清 tensor core 一次算一小块矩阵、为什么 fp16 峰值比 fp32 高一个数量级。看完再回头看 65 与 8.1 那两个算式。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/hQ9GPnV0-50" title="Lecture 23: Tensor Cores" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>GPU MODE · Lecture 23: Tensor Cores。深一层:tensor core 的编程模型、tile 形状、为什么矩阵形状要对齐。今天只看前 20 分钟建立图像,M5 写 kernel 时再全看。</figcaption>
</figure>

## 自测

合上笔记做。

1. 一个 4096×4096 乘 4096×4096 的 fp16 矩阵乘是多少 FLOP?T4 全开要多久?A100 呢?

<details><summary>答案</summary>

2 × 4096³ ≈ 1.37 × 10¹¹ = 137 GFLOP。T4 65 TFLOP/s 要 2.1 ms;A100 312 TFLOP/s 要 0.44 ms。实测会比这慢,因为打不到 100%。

</details>

2. T4 的 65 TFLOP/s 和 8.1 TFLOP/s 分别是怎么从硬件配置算出来的?测 fp32 matmul 该比哪个?

<details><summary>答案</summary>

65:40 SM × 8 tensor core × 64 FMA × 2 FLOP × 1.59 GHz。8.1:2560 CUDA core × 2 FLOP × 1.59 GHz。fp32 matmul 走 CUDA core,比 8.1;fp16 走 tensor core,比 65。

</details>

3. 方阵 matmul 的算术强度是多少?T4 上边长多大才跨过 ridge point?这说明 matmul 天生 compute-bound 吗?

<details><summary>答案</summary>

2N³ ÷ (2 × 3N² 字节) = N / 3 FLOP/byte(fp16)。T4 ridge ≈ 203,N > 609 才跨过;A100 ridge ≈ 153,N > 459。不是天生的,小矩阵是 memory-bound,decode 的 M = 1 线性层强度只有 1。

</details>

4. A100 规格表上有 312 和 624 两个 fp16 数,该用哪个?用错会连带算错什么?

<details><summary>答案</summary>

用 312,dense。624 要求 2:4 结构化稀疏权重,普通模型没有。用 624 做分母,实测百分比会低一半,ridge point 会算成 306 而不是 153,「batch 多大才 compute-bound」的判断翻倍错。

</details>

5. N = 512 的 fp16 方阵测出来只有标称的 20%,说出至少两个原因,以及怎么验证是哪一个。

<details><summary>答案</summary>

一是强度 N/3 = 171 低于 T4 的 ridge 203,它是 memory-bound 的;二是 512×512 的输出只切出十几个 tile,填不满 40 个 SM;三是 launch 开销相对计算量不可忽略。验证:把 N 加到 4096 看是否爬到 70% 以上;用实测毫秒数对比昨天的带宽算一下它是不是在斜线上。

</details>

6. 在 A100 上把 `allow_tf32` 打开前后测 fp32 matmul,会看到什么?这两个数各自该比什么标称?

<details><summary>答案</summary>

关闭时走 CUDA core,上限 19.5 TFLOP/s;打开后走 tensor core 的 tf32 路径,上限 156,快约八倍,精度略降(尾数 10 位)。分别比 19.5 和 156。T4 没有 tf32,开关无效。

</details>

## 明天预告

Day 15 把这两天的实测值装进一张图。用 Day 13 的实测带宽当斜线斜率、今天的实测算力当横线高度,matplotlib 画出自己这张卡的 roofline,算出实测 ridge point,再把 Day 9 测的 TPOT 换算成算力和算术强度标上去。图画出来之后要回答一个问题:做优化判断时为什么用实测屋顶而不是标称屋顶,两者差的那块意味着什么。
