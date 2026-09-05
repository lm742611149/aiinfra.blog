---
title: 'Day 15 · 用实测值画自己的 roofline，算实测 ridge point'
description: '把 Day 13 测出的带宽、Day 14 测出的算力换掉标称值，用 matplotlib 画出自己这张卡的 roofline，再把 Day 9 的 TPOT 换算成图上的一个点。屋顶从此是自己测出来的，不是宣传页上抄来的。'
pubDate: 2026-09-13
regime: memory
tags: ['roofline', 'matplotlib', 't4', 'arithmetic-intensity', 'aiinfra-365']
series: 'aiinfra-365'
day: 15
lang: 'zh'
---

## 今天要解决的问题

Day 5 画过一张 roofline,横轴算术强度、纵轴可达算力,斜线是带宽、横线是算力,交点叫 ridge point。那张图上的两条线用的是 A100 的标称值:312 TFLOP/s 和 2039 GB/s。Day 13 和 Day 14 做的事就是戳破标称值:copy 大张量测出来的带宽到不了 320 GB/s,大方阵 matmul 也打不满 65 TFLOP/s。

所以今天要把那张图重画一遍,用的是自己这张卡实测出来的两个数。做完要能回答三件事:

1. 我这张 T4 的实测 roofline 长什么样,实测 ridge point 是多少,和标称算出来的 203 差多少。
2. Day 9 测出来的 TPOT,换算成图上的一个点是在哪。这个点离斜线多远,离屋顶多远,两段距离分别代表什么。
3. 以后拿到任何一段代码或一个 kernel,怎么算出它的算术强度,把它标到这张图上。

这一篇的产出是一个 Python 脚本和一张图。脚本的所有输入都是参数,换卡、换模型、换实测值,改几个数重跑就行。

数字口径先说死。卡是 Colab 免费给的 T4:标称 fp16 tensor core 65 TFLOP/s,标称带宽 320 GB/s,标称 ridge point 65e12 ÷ 320e9 ≈ 203 FLOP/byte。模型是 TinyLlama-1.1B,fp16 权重约 2.2 GB。Day 13 和 Day 14 的实测值我还没填进去,下面用到实测值的地方一律写「预期区间」和「示例」,等真实数字出来再替换。

## 为什么屋顶要用实测值

标称值不是假的,是「在最理想条件下能达到的上限」。带宽的标称是内存控制器的理论吞吐,算力的标称是所有 tensor core 每个时钟都在做满载乘加、时钟锁在 boost 频率。真实运行时有四件事把它拉下来:

- 时钟频率。T4 是 70 W 功耗墙的卡,大 matmul 跑满几秒钟就会降频,实测算力跟着降。
- 数据搬运和计算不能完全重叠。矩阵乘的每个 tile 要先从显存搬进 shared memory 再算,首尾总有空档。
- tile 利用率。矩阵尺寸不是 tile 大小的整数倍时,边上的 tile 只有一部分在干活。
- 带宽的测法本身。copy 一个张量要读一遍写一遍,两次都走 HBM,控制器在读写之间切换有代价。

Day 13 和 Day 14 已经给了预期区间:实测带宽通常是标称的 75% 到 90%,实测 matmul 算力通常是 70% 到 90%。这两个折扣不一样,所以 ridge point 也会变。举个示例:如果实测带宽是 270 GB/s(84%),实测算力是 50 TFLOP/s(77%),那实测 ridge point 就是 50e12 ÷ 270e9 ≈ 185,不是 203。

差 10% 到 20% 看着不多,但 roofline 的用法是拿它做判断:一个 workload 的算术强度落在 ridge 左边还是右边,决定了下一步是去减字节还是去减 FLOP。算术强度在 180 到 200 之间的 workload,用标称屋顶判是 memory-bound,用实测屋顶判是 compute-bound,两个方向的优化手段完全不同。边界附近的判断,只能用实测的线。

还有一个更实际的理由。以后每做一次优化,都要回答「离屋顶还有多远」。屋顶是标称值的话,永远有一段追不上的距离,那段距离里有多少是自己的问题、多少是卡本身到不了,分不清。屋顶换成实测值,剩下的距离全是自己的。

## 一张 roofline 需要的四个数

画这张图只需要四个数,两个是卡的,两个是 workload 的。

卡的两个数,Day 13 和 Day 14 已经测出来了:

| 数 | 标称(T4) | 实测(Day 13 / Day 14 填) | 预期区间 |
| --- | --- | --- | --- |
| 显存带宽 B | 320 GB/s | ______ GB/s | 240–290 GB/s(75%–90%) |
| fp16 峰值算力 P | 65 TFLOP/s | ______ TFLOP/s | 45–58 TFLOP/s(70%–90%) |
| ridge point P ÷ B | 203 FLOP/byte | ______ FLOP/byte | 170–200 |

workload 的两个数,是「这段代码做了多少 FLOP」和「这段代码搬了多少字节」。两个数相除就是算术强度,FLOP 除以时间就是实际达到的算力。这两个数不是测出来的,是算出来的,测出来的只有时间。

所以画一个点的流程是:算 FLOP,算字节,测时间,然后

```
算术强度 AI   = FLOP ÷ 字节            单位 FLOP/byte,决定横坐标
实际算力      = FLOP ÷ 时间            单位 FLOP/s,决定纵坐标
可达算力      = min(P, B × AI)         这个 AI 下屋顶的高度
```

第三行就是 Day 5 写过的那个 min,只是 P 和 B 换成了实测值。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="画 roofline 的数据流:Day 13 实测带宽和 Day 14 实测算力决定两条线,Day 9 的 TPOT 加上算出来的 FLOP 和字节决定一个点">
<rect x="20" y="30" width="150" height="54" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="95" y="52" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Day 13</text>
<text x="95" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">实测带宽 B</text>
<rect x="20" y="104" width="150" height="54" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="95" y="126" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Day 14</text>
<text x="95" y="146" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">实测算力 P</text>
<rect x="20" y="178" width="150" height="40" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="95" y="196" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Day 9</text>
<text x="95" y="211" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">实测 TPOT</text>
<path d="M170 57 L250 57" stroke="var(--rule)" stroke-width="1.5"/>
<path d="M170 131 L250 131" stroke="var(--rule)" stroke-width="1.5"/>
<path d="M170 198 L250 198" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="250" y="30" width="160" height="54" rx="4" fill="var(--paper-raised)" stroke="var(--mem)"/>
<text x="330" y="52" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">斜线 y = B × AI</text>
<text x="330" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">memory 屋顶</text>
<rect x="250" y="104" width="160" height="54" rx="4" fill="var(--paper-raised)" stroke="var(--compute)"/>
<text x="330" y="126" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">横线 y = P</text>
<text x="330" y="146" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">compute 屋顶</text>
<rect x="250" y="178" width="160" height="40" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="330" y="193" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">AI = FLOP ÷ 字节</text>
<text x="330" y="209" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">算力 = FLOP ÷ TPOT</text>
<path d="M410 57 L470 110" stroke="var(--rule)" stroke-width="1.5"/>
<path d="M410 131 L470 124" stroke="var(--rule)" stroke-width="1.5"/>
<path d="M410 198 L470 140" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="470" y="86" width="150" height="76" rx="4" fill="var(--paper-raised)" stroke="var(--ink)"/>
<text x="545" y="112" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">roofline 图</text>
<text x="545" y="132" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">两条线 + 若干点</text>
<text x="545" y="150" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">ridge = P ÷ B</text>
</svg>
<figcaption>W3 前两天测的是卡,W2 测的是 workload。今天把三个来源拼成一张图:卡决定屋顶的形状,workload 决定点落在哪。</figcaption>
</figure>

## 算术强度怎么算:三个例子

算术强度是横坐标,算错了点就标错了位置。用三个以后会反复遇到的 workload 把算法走一遍。

**例一,decode 一步,batch 1。**Day 5 算过。每个参数搬 2 字节(fp16),做 2 次运算(一乘一加)。

```
FLOP  = 2 × N            N 是参数量
字节  = 2 × N            权重每个 2 字节,全部读一遍
AI    = 2N ÷ 2N = 1 FLOP/byte
```

N 约掉了,所以 TinyLlama 是 1,Llama-2-7B 也是 1。严格说 decode 一步还要读 KV cache,TinyLlama 每个 token 22.5 KB,上下文 500 个 token 时是 11 MB,跟 2.2 GB 的权重比可以忽略,AI 还是约等于 1。

**例二,方阵 matmul,N × N 乘 N × N,fp16。**Day 14 测算力用的就是它。

```
FLOP  = 2 × N × N × N = 2N³          每个输出元素 N 次乘加
字节  = 读 A + 读 B + 写 C = 3 × N² × 2 = 6N²
AI    = 2N³ ÷ 6N² = N ÷ 3
```

N = 4096 时 AI ≈ 1365,是 ridge point 203 的六七倍,稳稳落在横线上,compute-bound。这就是为什么 Day 14 用大方阵测算力:AI 够高,测到的时间全是算的时间,搬运藏在里面。N = 256 时 AI 只有 85,低于 203,这时 matmul 是 memory-bound 的,测出来的「算力」其实是带宽换算出来的,数字会很难看。Day 14 说矩阵太小打不满,根子在这里。

**例三,逐元素加法,`y = x + 1`,fp16。**Day 13 测带宽用的。

```
FLOP  = n                 每个元素加一次
字节  = 读 x + 写 y = 2n × 2 = 4n
AI    = n ÷ 4n = 0.25 FLOP/byte
```

如果是 `z = x + y`,读两个写一个,字节是 6n,AI 是 1/6 ≈ 0.17。不管哪个写法,AI 都远低于 1,这类 op 永远在斜线上,时间完全由字节数决定。这也是为什么 Day 13 用它测带宽:它没有任何算力成分,测到的时间就是搬运时间。

三个例子放一张表:

| workload | FLOP | 字节 | AI(FLOP/byte) | 在 T4 上落在哪 |
| --- | --- | --- | --- | --- |
| decode 一步,batch 1 | 2N | 2N | ≈ 1 | 斜线,memory-bound |
| decode 一步,batch b | 2Nb | 2N + KV | ≈ b(KV 小时) | b < 203 在斜线上 |
| matmul 4096³ fp16 | 2 × 4096³ ≈ 137 GFLOP | 6 × 4096² × … ≈ 100 MB | ≈ 1365 | 横线,compute-bound |
| matmul 256³ fp16 | 33.5 MFLOP | 393 KB | ≈ 85 | 斜线,memory-bound |
| `y = x + 1` | n | 4n | 0.25 | 斜线最左端 |

第二行是 Day 16 要扫的东西:batch 加大,权重还是只搬一遍,FLOP 翻 b 倍,AI 约等于 b。理论上 b 到 203 才碰屋顶,明天会看到实际曲线比这个早弯,而且弯的原因不是 FLOP。

## 把 Day 9 的 TPOT 变成图上的一个点

现在把 W2 的实测接进来。Day 9 测了 TinyLlama 在 T4 上 batch 1 的 TPOT,理论下限是 2.2 GB ÷ 320 GB/s ≈ 6.9 ms。实测值我用一个示例数代替:假设 TPOT 是 15 ms,是理论下限的 2.2 倍,落在 Day 9 说的「1.5 到 3 倍」区间里。

这一步的 FLOP 和字节:

```
FLOP  = 2 × 1.1e9 = 2.2 GFLOP
字节  = 2.2 GB(权重)+ 约 0.01 GB(KV cache)≈ 2.2 GB
AI    = 2.2e9 ÷ 2.2e9 ≈ 1 FLOP/byte
```

横坐标是 1。纵坐标是实际达到的算力:

```
实际算力 = 2.2e9 FLOP ÷ 0.015 s ≈ 147 GFLOP/s = 0.147 TFLOP/s
```

而 AI = 1 时屋顶的高度,用标称带宽是 320e9 × 1 = 320 GFLOP/s,用实测带宽(示例 270 GB/s)是 270 GFLOP/s。所以这个点在斜线下方,实际算力是实测屋顶的 147 ÷ 270 ≈ 54%。

54% 这个数怎么读:它说的是「在 AI = 1 这个位置,带宽只用出了一半多」。剩下的 46% 去哪了?Day 11 看过 timeline 上的 gap,decode 一步由几十个小 kernel 组成,kernel 之间 GPU 在等 CPU 发下一个,这段时间既没搬也没算。另一部分是 kernel 自身的效率,比如 attention kernel 在 batch 1、序列短的时候 tile 填不满。所以点到斜线的垂直距离,就是 overhead 加 kernel 效率损失。这两样都不是「算术强度不够」的问题,靠加 batch 解决不了,得靠减 launch 次数(CUDA graph、fusion)或者换更好的 kernel。

再把 Day 14 的 matmul 也标上去:N = 4096,AI ≈ 1365,实际算力就是 Day 14 测出来的数(示例 50 TFLOP/s),点会落在横线上或紧贴横线下面。它和 decode 那个点一左一右,一个在斜线下面一个在横线上,把「同一张卡、两种 workload、两种命运」画在了同一张图上。

<figure>
<svg viewBox="0 0 640 310" role="img" aria-label="T4 的 roofline 示意:虚线是标称屋顶,实线是实测屋顶,decode batch 1 的点在斜线下方,matmul 4096 的点贴着横线">
<g stroke="var(--rule-soft)" stroke-width="1">
<line x1="60" y1="260" x2="600" y2="260"/><line x1="60" y1="202" x2="600" y2="202"/><line x1="60" y1="145" x2="600" y2="145"/><line x1="60" y1="87" x2="600" y2="87"/><line x1="60" y1="30" x2="600" y2="30"/>
<line x1="168" y1="30" x2="168" y2="260"/><line x1="276" y1="30" x2="276" y2="260"/><line x1="384" y1="30" x2="384" y2="260"/><line x1="492" y1="30" x2="492" y2="260"/>
</g>
<g stroke="var(--rule)" stroke-width="1.5"><line x1="60" y1="260" x2="600" y2="260"/><line x1="60" y1="260" x2="60" y2="30"/></g>
<g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
<text x="60" y="276" text-anchor="middle">0.1</text><text x="168" y="276" text-anchor="middle">1</text><text x="276" y="276" text-anchor="middle">10</text><text x="384" y="276" text-anchor="middle">100</text><text x="492" y="276" text-anchor="middle">1k</text><text x="600" y="276" text-anchor="middle">10k</text>
<text x="52" y="264" text-anchor="end">1e10</text><text x="52" y="206" text-anchor="end">1e11</text><text x="52" y="149" text-anchor="end">1e12</text><text x="52" y="91" text-anchor="end">1e13</text><text x="52" y="34" text-anchor="end">1e14</text>
<text x="600" y="296" text-anchor="end">算术强度 FLOP/byte(对数)</text>
<text x="12" y="20">FLOP/s</text>
</g>
<path d="M60 231 L417 41 L600 41" fill="none" stroke="var(--ink-faint)" stroke-width="1.5" stroke-dasharray="5 4"/>
<path d="M60 235 L413 47" fill="none" stroke="var(--mem)" stroke-width="2.5" stroke-linecap="round"/>
<path d="M413 47 L600 47" fill="none" stroke="var(--compute)" stroke-width="2.5" stroke-linecap="round"/>
<circle cx="413" cy="47" r="4" fill="var(--paper-raised)" stroke="var(--ink)" stroke-width="2"/>
<text x="413" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">实测 ridge ≈185</text>
<text x="440" y="34" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">标称 ridge 203</text>
<line x1="168" y1="178" x2="168" y2="193" stroke="var(--ink-faint)" stroke-width="1" stroke-dasharray="2 2"/>
<circle cx="168" cy="193" r="5" fill="var(--mem)"/>
<text x="178" y="198" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">decode b=1,AI≈1</text>
<text x="178" y="212" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">0.15 TFLOP/s,屋顶的 54%</text>
<circle cx="507" cy="50" r="5" fill="var(--compute)"/>
<text x="507" y="80" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">matmul 4096³</text>
<text x="507" y="94" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">AI≈1365</text>
<circle cx="84" cy="222" r="4" fill="var(--mem)" opacity="0.6"/>
<text x="92" y="240" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">x+y,AI≈0.17</text>
<text x="230" y="120" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">memory-bound</text>
<text x="470" y="130" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">compute-bound</text>
</svg>
<figcaption>示意图,坐标按示例值(实测带宽 270 GB/s、实测算力 50 TFLOP/s)摆放。虚线是标称屋顶,实线是实测屋顶,两者之间的缝就是卡本身到不了的部分。decode 的点悬在斜线下面,那段空隙是 overhead 和 kernel 效率,不是带宽不够。</figcaption>
</figure>

## 完整代码

下面的脚本在 Colab 或本机都能跑,不需要 GPU,它只画图。所有数字都在最上面的参数区,实测值出来后改那几行就行。

```python
# roofline.py —— 用实测值画自己的 roofline
# 在 Colab 里直接跑,或本机 pip install matplotlib numpy 后跑
import numpy as np
import matplotlib.pyplot as plt

# ---------- 参数区:只改这里 ----------
CARD = "T4"
NOMINAL_BW    = 320e9    # byte/s,标称带宽
NOMINAL_FLOPS = 65e12    # FLOP/s,标称 fp16 tensor core 算力
MEASURED_BW    = 270e9   # ← 换成 Day 13 实测值(示例 270 GB/s)
MEASURED_FLOPS = 50e12   # ← 换成 Day 14 实测值(示例 50 TFLOP/s)

# 要标的点:(名字, FLOP, 字节, 耗时秒)。时间是实测,FLOP 和字节是算出来的
POINTS = [
    # decode 一步 batch 1,TinyLlama fp16。TPOT 用 Day 9 的实测值替换 0.015
    ("decode b=1", 2 * 1.1e9, 2.2e9, 0.015),
    # matmul 4096³ fp16。耗时用 Day 14 实测值替换(示例:137 GFLOP ÷ 50 TFLOP/s)
    ("matmul 4096", 2 * 4096**3, 6 * 4096**2, 2 * 4096**3 / 50e12),
    # y = x + 1,1 亿个 fp16。耗时用 Day 13 实测值替换(示例:400 MB ÷ 270 GB/s)
    ("x + 1", 1e8, 4e8, 4e8 / 270e9),
]
# ----------------------------------------

def attainable(ai, bw, peak):
    """算术强度 ai 下的可达算力:两条线取低的那条。"""
    return np.minimum(peak, bw * ai)

ai = np.logspace(-1.5, 4.5, 400)               # 横轴 0.03 → 30000 FLOP/byte
ridge_nominal  = NOMINAL_FLOPS / NOMINAL_BW
ridge_measured = MEASURED_FLOPS / MEASURED_BW

fig, ax = plt.subplots(figsize=(8, 5.5))
ax.loglog(ai, attainable(ai, NOMINAL_BW, NOMINAL_FLOPS),
          "--", color="0.55", lw=1.5,
          label=f"标称屋顶  ridge={ridge_nominal:.0f}")
ax.loglog(ai, attainable(ai, MEASURED_BW, MEASURED_FLOPS),
          "-", color="#2b53d8", lw=2.5,
          label=f"实测屋顶  ridge={ridge_measured:.0f}")
ax.axvline(ridge_measured, color="0.75", lw=1, ls=":")

for name, flop, byte, sec in POINTS:
    x = flop / byte                 # 算术强度
    y = flop / sec                  # 实际达到的算力
    roof = attainable(x, MEASURED_BW, MEASURED_FLOPS)
    pct = 100 * y / roof
    ax.plot(x, y, "o", ms=8, color="#b26a12" if x > ridge_measured else "#2b53d8")
    ax.annotate(f"{name}\nAI={x:.2g}  {y/1e12:.3g} TFLOP/s\n屋顶的 {pct:.0f}%",
                (x, y), textcoords="offset points", xytext=(8, -34), fontsize=8)

ax.set_xlabel("算术强度  FLOP / byte")
ax.set_ylabel("可达算力  FLOP / s")
ax.set_title(f"{CARD} roofline:标称 vs 实测")
ax.set_ylim(1e10, 2e14)
ax.grid(True, which="both", alpha=0.25)
ax.legend(loc="lower right")
plt.tight_layout()
plt.savefig(f"roofline_{CARD}.png", dpi=160)
print(f"标称 ridge = {ridge_nominal:.1f}   实测 ridge = {ridge_measured:.1f}")
for name, flop, byte, sec in POINTS:
    x, y = flop / byte, flop / sec
    print(f"{name:>12}  AI={x:8.2f}  达到 {y/1e12:6.3f} TFLOP/s  "
          f"= 实测屋顶的 {100*y/attainable(x, MEASURED_BW, MEASURED_FLOPS):5.1f}%")
```

几处值得说的地方:

`np.logspace` 是因为两根轴都是对数刻度。算术强度从 0.1 跨到 10000,算力从 1e10 跨到 1e14,线性轴上画不下,而且 roofline 的斜线在对数轴上才是直线。

`attainable` 用的是 `np.minimum` 而不是 Python 的 `min`,因为传进去的 `ai` 是一整个数组。这个函数和 Day 5 那个 `attainable(ai)` 是同一个东西,只是 P 和 B 变成了参数。

点的颜色按它落在 ridge 左边还是右边分,左边靛蓝右边琥珀,和这个站点的颜色约定一致:靛蓝是 memory-bound,琥珀是 compute-bound。

`POINTS` 里每个点写四个数,时间是唯一实测的那个。FLOP 和字节要自己算,算法就是上一节的三个例子。以后加新的点,先把这两个数算对再填。

`ridge_measured` 那条竖虚线是整张图的分界线。它左边所有点的优化方向是「减字节或提强度」,右边所有点的方向是「提算力利用率」。

## 读图:一个点的三段距离

图画出来之后,每个点都有三段距离可以读。用 decode batch 1 那个点说。

**第一段,点到斜线的垂直距离。**点在 AI = 1,斜线在这里的高度是 B × 1 = 实测带宽。点比斜线低,说明连实测带宽都没用满。这段距离的成因只有两类:overhead(GPU 在等 CPU,Day 11 在 timeline 上看到的 gap)和 kernel 效率(kernel 在跑但没跑满带宽)。这两类都和算术强度无关,加 batch 不会让这段距离消失。缩小它的办法是 CUDA graph、`torch.compile`、更好的 kernel,这些是 M5 之后的事,现在只需要知道这段距离存在、有多大。

**第二段,沿斜线往右到 ridge point 的距离。**从 AI = 1 到 AI ≈ 185,差两个数量级。这是「算术强度不够」的部分,靠 batching 拉。斜线上每往右一格,可达算力就高一格,Day 5 说的「加 batch 几乎不加时间」就是沿这条线往上爬。

**第三段,横线的高度,也就是屋顶本身。**这是卡的物理极限,想再高只能换卡、换精度(fp8)、或者用 sparse。M1 到 M8 都不碰这一段。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="一个点的三段距离:点到斜线是 overhead 和 kernel 效率,沿斜线到 ridge 是算术强度不够,横线是卡的极限">
<g stroke="var(--rule)" stroke-width="1.5"><line x1="60" y1="250" x2="600" y2="250"/><line x1="60" y1="250" x2="60" y2="30"/></g>
<path d="M60 236 L400 60" fill="none" stroke="var(--mem)" stroke-width="2.5" stroke-linecap="round"/>
<path d="M400 60 L600 60" fill="none" stroke="var(--compute)" stroke-width="2.5" stroke-linecap="round"/>
<circle cx="400" cy="60" r="4.5" fill="var(--paper-raised)" stroke="var(--ink)" stroke-width="2"/>
<text x="400" y="48" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">ridge point</text>
<circle cx="170" cy="222" r="6" fill="var(--mem)"/>
<text x="130" y="244" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">decode b=1</text>
<line x1="170" y1="222" x2="170" y2="180" stroke="var(--ink)" stroke-width="1.5" marker-end="url(#a1)"/>
<text x="180" y="196" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">① 点→斜线</text>
<text x="180" y="210" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">overhead + kernel 效率</text>
<text x="180" y="223" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">加 batch 治不了</text>
<path d="M190 168 L385 68" fill="none" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#a1)"/>
<text x="235" y="118" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">② 沿斜线→ridge</text>
<text x="235" y="132" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">算术强度不够</text>
<text x="235" y="145" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">batching 把点往右推</text>
<line x1="520" y1="250" x2="520" y2="66" stroke="var(--compute)" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#a2)"/>
<text x="530" y="150" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">③ 屋顶</text>
<text x="530" y="164" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">卡的极限</text>
<text x="530" y="177" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">换卡/换精度</text>
<defs>
<marker id="a1" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink)"/></marker>
<marker id="a2" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="var(--compute)"/></marker>
</defs>
<text x="600" y="272" text-anchor="end" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">算术强度 →</text>
<text x="12" y="22" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">算力 ↑</text>
</svg>
<figcaption>三段距离对应三类手段。以后看到任何一个优化技巧,先问它缩的是哪一段:CUDA graph 和 fusion 缩①,batching 缩②,换 H100 抬③。</figcaption>
</figure>

这三段距离就是整条路线的地图。M2 的 batching 和 KV cache 在缩第二段,M2 W7 的量化是在把点往右挪(字节变少,同样 FLOP 下 AI 变高),M5 的 Triton kernel 和 fusion 在缩第一段。每学一个新东西,回到这张图上找它缩的是哪一段,找不到就说明还没理解它。

## 把 Day 10 的 top 5 kernel 也标上去

上面标的三个点都是「整段代码」级别的。roofline 更常见的用法是标单个 kernel,Day 10 从 profiler 里抓出来的那几个最耗时的 kernel,每一个都能算出自己的 AI。算法一样:FLOP 除以字节。TinyLlama 的形状已知(d = 2048,4 个 KV 头 × 64 = 256,FFN 中间 5632,词表 32000),decode batch 1 时每层各 kernel 的账是:

| kernel(对应部件) | FLOP | 字节(权重为主) | AI | 字节 ÷ 270 GB/s | 和 launch 开销比 |
| --- | --- | --- | --- | --- | --- |
| q_proj,2048 × 2048 | 8.4 M | 8.4 MB | ≈ 1 | 31 µs | 搬运主导 |
| k_proj / v_proj,2048 × 256 | 1.0 M | 1.0 MB | ≈ 1 | 3.9 µs | 和 launch 同量级 |
| gate_proj / up_proj,2048 × 5632 | 23 M | 23 MB | ≈ 1 | 85 µs | 搬运主导 |
| down_proj,5632 × 2048 | 23 M | 23 MB | ≈ 1 | 85 µs | 搬运主导 |
| attention(上下文 500) | ≈ 2 M | ≈ 0.5 MB(读 K、V) | ≈ 4 | 1.9 µs | launch 主导 |
| RMSNorm,2048 维 | ≈ 8 K | 12 KB | ≈ 0.7 | 0.04 µs | 完全是 launch |
| SiLU × up,5632 维 | ≈ 17 K | 34 KB | ≈ 0.5 | 0.13 µs | 完全是 launch |
| lm_head,2048 × 32000(每步一次) | 131 M | 131 MB | ≈ 1 | 485 µs | 搬运主导 |

几个读法。

所有线性层的 AI 都是 1,和整段 decode 一样,因为它们就是「一个向量过一个矩阵」,矩阵每个元素搬 2 字节做 2 FLOP。它们的时间下限由字节决定,gate、up、down 三个 FFN 矩阵加起来 69 MB,占一层 101 MB 权重的三分之二,所以 Day 10 的 top 5 里 FFN 的 gemm 一定排在前面。

RMSNorm 和 SiLU 这类逐元素 kernel,字节只有几十 KB,按带宽算 0.04 到 0.13 微秒就该结束,但一次 kernel launch 本身要 5 到 10 微秒。也就是说这些 kernel 的时间里 99% 是 launch 开销,它们根本不在 roofline 上,是 Day 1 三分法里的第三类 overhead-bound。把它们的 AI 算出来标到图上没有意义,点会远远低于斜线,低的原因不是带宽没用好,是 kernel 太小了。这类 kernel 唯一的治法是不单独 launch,和前后的 kernel 合并,这就是 fusion,M5 的主题。

把一层的 kernel 数一遍:两次 RMSNorm、q/k/v/o 四个 gemm、rotary 几个小 op、一次 attention、两次残差加、gate/up/down 三个 gemm、一次 SiLU、一次乘。大约 15 到 25 个 kernel,22 层就是 330 到 550 次 launch,加上 lm_head 和采样。按每次 5 到 10 微秒算,一步 decode 光 launch 就要 2 到 5 毫秒。Day 9 示例里 TPOT 15 ms 减去搬权重的 6.9 ms 剩 8 ms,这 8 ms 里有一半左右可以用 launch 开销解释,剩下的是 Python 层的 generate 逻辑和 kernel 自身效率。这是第一次把「点到斜线的距离」拆成了有数字的几块。

所以 Day 10 的 top 5 表可以加两列变成 roofline 表:

```python
# 把 profiler 的 kernel 表变成 roofline 上的点
# flop 和 byte 按上面的形状手算,cuda_time 从 key_averages() 里读
kernels = [
    # (名字, FLOP, 字节, profiler 里的 CUDA 时间 s)
    ("gate/up gemm", 23e6, 23e6, None),   # ← 填 Day 10 的实测
    ("down gemm",    23e6, 23e6, None),
    ("q_proj gemm",  8.4e6, 8.4e6, None),
    ("lm_head gemm", 131e6, 131e6, None),
    ("rmsnorm",      8e3, 12e3, None),
]
for name, flop, byte, sec in kernels:
    if sec is None:
        continue
    ai = flop / byte
    achieved = flop / sec
    roof = min(MEASURED_FLOPS, MEASURED_BW * ai)
    floor = byte / MEASURED_BW           # 只按带宽算的时间下限
    print(f"{name:>14} AI={ai:5.2f} 屋顶 {100*achieved/roof:5.1f}%  "
          f"实测 {sec*1e6:7.1f} µs  带宽下限 {floor*1e6:7.2f} µs")
```

最后一列「实测 vs 带宽下限」比屋顶百分比更直观:gemm 类应该在下限的 1.2 到 2 倍,超过 3 倍说明 kernel 有问题;RMSNorm 类实测会是下限的一百倍以上,那不是问题,是 launch 开销,把它记下来等 M5 处理。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="一层 decode 的 kernel 按字节排:三个 FFN 矩阵占大头,逐元素 kernel 字节小到看不见但每个都要一次 launch">
<text x="20" y="22" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">TinyLlama 一层 decode,每个 kernel 搬的字节(权重为主),条长 ∝ 字节</text>
<g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
<text x="20" y="52">gate_proj</text><rect x="120" y="40" width="230" height="16" fill="var(--mem)"/><text x="358" y="52" fill="var(--ink-soft)">23 MB · 85 µs</text>
<text x="20" y="76">up_proj</text><rect x="120" y="64" width="230" height="16" fill="var(--mem)"/><text x="358" y="76" fill="var(--ink-soft)">23 MB · 85 µs</text>
<text x="20" y="100">down_proj</text><rect x="120" y="88" width="230" height="16" fill="var(--mem)"/><text x="358" y="100" fill="var(--ink-soft)">23 MB · 85 µs</text>
<text x="20" y="124">q_proj</text><rect x="120" y="112" width="84" height="16" fill="var(--mem)"/><text x="212" y="124" fill="var(--ink-soft)">8.4 MB · 31 µs</text>
<text x="20" y="148">o_proj</text><rect x="120" y="136" width="84" height="16" fill="var(--mem)"/><text x="212" y="148" fill="var(--ink-soft)">8.4 MB · 31 µs</text>
<text x="20" y="172">k/v_proj</text><rect x="120" y="160" width="10" height="16" fill="var(--mem)"/><text x="138" y="172" fill="var(--ink-soft)">1 MB · 4 µs ≈ 一次 launch</text>
<text x="20" y="196">attention</text><rect x="120" y="184" width="5" height="16" fill="var(--mem)"/><text x="138" y="196" fill="var(--ink-soft)">0.5 MB · 2 µs,launch 主导</text>
<text x="20" y="220">rmsnorm ×2</text><rect x="120" y="208" width="2" height="16" fill="var(--ink-faint)"/><text x="138" y="220" fill="var(--ink-soft)">12 KB · 0.04 µs,时间 100% 是 launch</text>
<text x="20" y="244">silu·mul, add</text><rect x="120" y="232" width="2" height="16" fill="var(--ink-faint)"/><text x="138" y="244" fill="var(--ink-soft)">几十 KB,同上 → M5 fusion 的对象</text>
</g>
</svg>
<figcaption>时间按实测带宽 270 GB/s 的示例值换算。三个 FFN 矩阵占一层字节的三分之二;右下角那几个 kernel 字节可以忽略,但每个都要付一次 5 到 10 µs 的 launch,22 层攒起来就是 Day 11 看到的 gap。</figcaption>
</figure>

## 标称线和实测线之间的缝

图上虚线和实线之间有一条窄缝,这条缝是卡本身到不了的部分。Day 17 会专门讲为什么到不了,今天只记一件事:做判断永远用实线。

用示例数字说明这条缝有多大影响。标称 ridge 203,实测 ridge 185,差 9%。如果 Day 16 扫 batch 时发现曲线在 batch 180 左右开始压平,用标称线看是「还没到 ridge 就弯了,一定有别的瓶颈」,用实测线看是「正好碰到屋顶,符合预期」。同一条曲线两种解读,只有实测线的解读是对的。

反过来,在 AI 远低于 ridge 的区域(比如 decode batch 1 的 AI = 1),两条线差的只是带宽那 15% 的折扣,判断不受影响,memory-bound 就是 memory-bound。所以实测值最要紧的地方是 ridge 附近,离得远的地方用标称估一估也够。这也是为什么 Day 5 用标称值算出来的那张表到今天依然成立:它说的全是离 ridge 两个数量级的事。

## 记录表

实测值出来后填这张表,填完把参数区改掉重跑脚本。

| 项 | 标称 | 实测 | 实测 ÷ 标称 | 来源 |
| --- | --- | --- | --- | --- |
| 带宽 B(GB/s) | 320 | ______ | ______ % | Day 13 |
| fp16 算力 P(TFLOP/s) | 65 | ______ | ______ % | Day 14 |
| ridge point(FLOP/byte) | 203 | ______ | ______ % | P ÷ B |
| decode b=1 TPOT(ms) | 6.9(下限) | ______ | ______ 倍 | Day 9 |
| decode b=1 实际算力(GFLOP/s) | 320(斜线) | ______ | 屋顶的 ______ % | 2.2e9 ÷ TPOT |
| matmul 4096 实际算力(TFLOP/s) | 65 | ______ | 屋顶的 ______ % | Day 14 |

最后一列「屋顶的百分比」用实测屋顶算,不用标称。decode 那行的预期在 40% 到 70% 之间:TPOT 是下限的 1.5 到 3 倍,倒过来就是屋顶的 33% 到 67%,再加上实测带宽本来就比标称低,比值会往上飘一点。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 算术强度(AI) | arithmetic intensity,一段代码做的 FLOP 除以它搬的字节,单位 FLOP/byte。roofline 的横坐标 |
| 可达算力 | attainable performance,给定 AI 下屋顶的高度,= min(P, B × AI) |
| 实际算力 | achieved performance,FLOP 除以实测时间,点的纵坐标 |
| ridge point | P ÷ B,斜线和横线的交点。T4 标称 203,实测预期 170 到 200 |
| 标称值 | 厂商规格表上的峰值,理想条件下的上限。带宽是控制器理论吞吐,算力是全部 tensor core 满载 |
| 实测屋顶 | 用 Day 13、Day 14 测出来的 B 和 P 画的两条线 |
| overhead | GPU 空转等 CPU 发 kernel 的时间,Day 11 timeline 上的 gap。表现为点在斜线下方 |
| kernel 效率 | 一个 kernel 在跑的时候实际用了带宽或算力的几成。也表现为点在斜线或横线下方 |
| tile | matmul 被切成的小块,每块搬进 shared memory 算完再写回。矩阵边缘的 tile 填不满就浪费 |
| log-log 轴 | 两根轴都取对数。roofline 的斜线只在这种轴上是直线 |
| `np.logspace(a, b, n)` | 生成从 10^a 到 10^b 的 n 个对数均匀点,画对数轴曲线用 |
| `np.minimum` | 逐元素取小,和 Python 内建 `min` 不同,能作用在整个数组上 |

## 常见误区

**用标称值判断 ridge 附近的 workload。**AI 在 170 到 210 之间的东西,标称线说 memory-bound,实测线可能说 compute-bound。这一带的判断只能用实测线。离 ridge 远的地方无所谓。

**把点到斜线的距离当成「算术强度不够」。**AI 已经确定了横坐标,点比斜线低是因为 overhead 和 kernel 效率,不是因为 AI 低。加 batch 是往右挪,不是往上抬。这两个方向的手段完全不同,搞混了会用 batching 去治 overhead,白忙。

**算字节时漏了写。**`y = x + 1` 读 2n 字节写 2n 字节,共 4n,不是 2n。matmul 的输出 C 也要写回。漏了写,字节少算一半,AI 高估一倍,点往右偏一格。

**算 FLOP 时忘了乘 2。**一次乘加是 2 FLOP。matmul 是 2MNK 不是 MNK,decode 是 2N 不是 N。这个 2 在算 AI 时不会约掉(字节里没有它),漏了 AI 就低一半。

**拿 fp32 的标称算力画 fp16 的屋顶。**T4 fp32 是 8.1 TFLOP/s,fp16 tensor core 是 65。屋顶的高度差 8 倍,ridge 差 8 倍。Day 14 说过,画图前先确认测的是哪种精度。

**把「屋顶的 54%」当成坏消息。**batch 1 的 decode 能到实测带宽的一半以上,对 HF transformers 的默认 generate 来说是正常水平。这个百分比的用处是当基线:以后每次优化回来看它有没有变大。

## 参考资料

文章

- Roofline: An Insightful Visual Performance Model for Multicore Architectures,Williams、Waterman、Patterson,2009。roofline 的原始论文,第 2 节讲怎么画、第 4 节讲怎么在图上加「天花板」表示各种未优化的损失。按标题搜索。
- Making Deep Learning Go Brrrr From First Principles,Horace He。Day 1 读过,今天画的图就是它三分法的几何版本:斜线下方的距离是 overhead,斜线是 memory,横线是 compute。https://horace.io/brrr_intro.html
- Transformer Inference Arithmetic,Kipply。第三节把 decode 的算术强度、batch 和 ridge 的关系算了一遍,可以拿来对账。https://kipp.ly/transformer-inference-arithmetic/
- Matrix Multiplication Background User's Guide,NVIDIA。讲 matmul 的算术强度怎么随矩阵尺寸变化、为什么小矩阵是 memory-bound,以及 tile 量化损失。https://docs.nvidia.com/deeplearning/performance/dl-performance-matrix-multiplication/index.html
- NVIDIA T4 Tensor Core GPU 产品页,65 TFLOP/s 和 320 GB/s 的出处。https://www.nvidia.com/en-us/data-center/tesla-t4/

文档或代码

- matplotlib `pyplot.loglog` 文档。https://matplotlib.org/stable/api/_as_gen/matplotlib.pyplot.loglog.html
- Nsight Compute Profiling Guide,里面有一节 Roofline Charts,讲 NVIDIA 官方工具怎么自动画同一张图。M5 用 Nsight 时会回来看。https://docs.nvidia.com/nsight-compute/ProfilingGuide/index.html

视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/7EJjdDLK4cg" title="LLM Inference Lecture: Roofline Analysis for GPU (arithmetic intensity, compute and memory bound)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Faradawn Yang · LLM Inference Lecture: Roofline Analysis for GPU (arithmetic intensity, compute and memory bound)。对着 LLM 推理讲算术强度和两种 bound,和今天算 decode 那个点的过程是同一件事,适合画完图再看一遍对答案。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/3H_HUfytgfE" title="The Roofline Model: Why Your GPU Never Hits Peak TFLOPS" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Empiric · The Roofline Model: Why Your GPU Never Hits Peak TFLOPS。标题就是今天的主题:标称峰值为什么永远达不到,以及 roofline 怎么把「达不到」拆成几段。</figcaption>
</figure>

## 自测

合上笔记做。

1. 画一张 roofline 需要哪四个数?哪几个是测出来的,哪几个是算出来的?

<details><summary>答案</summary>

卡的两个数:带宽 B、峰值算力 P,这两个是实测的(Day 13、Day 14)。workload 的两个数:FLOP 和字节,这两个是算出来的,不是测的。workload 唯一实测的是时间,用来算纵坐标(FLOP ÷ 时间)。

</details>

2. 方阵 matmul N × N 的算术强度是多少?N = 4096 和 N = 256 分别落在 T4 roofline 的哪一侧?

<details><summary>答案</summary>

AI = 2N³ ÷ 6N² = N ÷ 3。N = 4096 时约 1365,远高于 ridge 203,在横线上,compute-bound。N = 256 时约 85,低于 203,在斜线上,memory-bound。所以测算力必须用大矩阵。

</details>

3. decode batch 1 的点为什么在斜线下方而不是斜线上?这段距离用什么手段缩小?

<details><summary>答案</summary>

因为连实测带宽都没用满:一部分时间 GPU 在等 CPU 发 kernel(overhead,timeline 上的 gap),一部分时间 kernel 在跑但没跑满带宽(kernel 效率)。这两样和算术强度无关,加 batch 治不了。要靠 CUDA graph、`torch.compile` 这类减 launch 次数的手段,或者更好的 kernel。

</details>

4. 标称 ridge 203、实测 ridge 185,这个差别在什么情况下会改变判断,什么情况下不会?

<details><summary>答案</summary>

AI 落在两个 ridge 之间(185 到 203)的 workload,标称线判 memory-bound、实测线判 compute-bound,判断会翻。AI 离 ridge 很远的(比如 decode batch 1 的 AI = 1,或 matmul 4096 的 1365),两条线给的结论一样,不受影响。所以实测值最要紧的地方是 ridge 附近。

</details>

5. TPOT 是 15 ms、模型 1.1B 参数,这个点的横纵坐标各是多少?它是实测屋顶(带宽 270 GB/s)的百分之几?

<details><summary>答案</summary>

横坐标 AI = 2 × 1.1e9 ÷ 2.2e9 ≈ 1。纵坐标 = 2.2e9 ÷ 0.015 ≈ 147 GFLOP/s。AI = 1 处屋顶高度 = 270e9 × 1 = 270 GFLOP/s,所以是 147 ÷ 270 ≈ 54%。

</details>

6. 量化(fp16 → int4)在这张图上是把点往哪个方向挪?为什么?

<details><summary>答案</summary>

往右挪。量化不改 FLOP(还是 2N),但权重字节从 2N 变成 0.5N,AI 从 1 变成 4。同样的斜线上,AI 高四倍可达算力就高四倍,也就是 decode 一步的时间缩到四分之一。它挪的是第二段距离(算术强度),不是第一段。

</details>

## 明天预告

Day 16 把 batch 从 1 扫到 128:1、4、16、64、128 五个点,每个测 decode 每步时间,算吞吐,标到今天这张图上。W1 预测 batch 到 ridge 附近才碰屋顶,明天会看到实际曲线比那早弯,而且弯的原因不是 FLOP 追上了带宽,是 KV cache 的字节随 batch 一起涨,算术强度不再等于 batch。这是对 W1 那个预测的检验,也是第一次在自己的数据上看到「KV cache 是 batching 收益的天花板」。
