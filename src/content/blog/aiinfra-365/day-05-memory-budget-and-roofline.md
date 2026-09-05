---
title: 'Day 5 · 显存花在哪、decode 为什么最快只有 150 token/s：算术强度与 roofline'
description: '把 7B 模型推理时的显存拆成四项算清楚，再用一次除法算出 decode 的物理上限。最后引出整条路线最重要的一个数：ridge point ≈ 153。附五张卡的 ridge point 对照、量化和 KV cache 读取怎么改这张图。'
pubDate: 2026-09-04
regime: memory
tags: ['roofline', 'memory', 'decode', 'a100', 'aiinfra-365']
series: 'aiinfra-365'
day: 5
lang: 'zh'
---

## 今天要解决的问题

前几天把 Llama-2-7B 的账本算到了两个数：权重 13.5 GB，KV cache 每个 token 512 KB。这两个数是零件，今天要把它们装成两件事：

1. 一张 80 GB 的 A100 上，7B 模型做推理时，显存到底被谁占了。四项，每项多少，谁会先爆。
2. 生成一个 token 最快要多久。不是测出来的，是算出来的，而且算出来之后会发现一个反直觉的事实：GPU 大部分时间在等，不在算。

第二件事引出的那个数，叫 ridge point，是 W1 整周最重要的一个数。后面 M3 到 M8 做的所有优化，都是在它决定的那张图上挪位置。

数字口径先说死，免得来回换：模型 Llama-2-7B，32 层、d = 4096、参数 6.74B、fp16。卡是 A100 80GB SXM，BF16 峰值 312 TFLOP/s，HBM 带宽 2039 GB/s。换模型换卡时，重算一遍比记结论有用。今天最后会真的换四张卡重算一遍。

## 显存四项

推理时显存被四类东西占着。前两类前几天算过，后两类今天补上。

**权重**就是模型本身，6.74B 个数字每个 2 字节，13.5 GB。它的特点是固定、常驻。模型文件下载下来多大，进显存就多大，从服务启动到关闭一直在那里不动。batch 多大、序列多长，跟它无关。

**KV cache**是给每个正在处理的 token 存的 k 向量和 v 向量。每 token 512 KB 这个数是 2 × 32 层 × 4096 × 2 字节推出来的（前面那个 2 是 k 和 v 两份，后面那个 2 是 fp16）。它跟权重的性格完全相反：随 batch 和序列长度线性涨，请求一结束就释放。同一个模型，batch 1 和 batch 32 的 KV cache 差 32 倍。

**激活**是算每一层时中间冒出来的临时向量。token 向量乘 W^q 得到 q，乘 W^k 得到 k，FFN 里先变宽再变回来，中间那个 11008 长的向量，这些统称激活。它们的特点是用完就扔：算完这一层，下一层只需要这一层的输出，中间量全部释放。所以激活不像权重那样常驻，也不像 KV cache 那样越攒越多，它只占「当前正在算的这一层」那点地方。

推理时它有多大？最宽的一处就是 FFN 中间那个 11008 长的向量，一个 token 是 11008 × 2 字节 ≈ 22 KB。batch 32 × 2048 = 65536 个 token 同时算的话，65536 × 22 KB ≈ 1.4 GB。跟 KV cache 比是零头。所以推理时激活一般不用操心。训练时才是大头，因为反向传播要把每一层的激活全留着等梯度回来，那时候激活能吃掉几十 GB，那是 M9 的事，现在不管。

这里有个细节以后会用到：1.4 GB 是 prefill 阶段的数，因为 prefill 把 65536 个 token 一起过一层。decode 阶段一步只有 32 个新 token（每个请求一个），激活是 32 × 22 KB ≈ 0.7 MB，几乎为零。所以激活的峰值出现在 prefill，vLLM 里限制 prefill 一次最多处理多少 token 的参数（`max_num_batched_tokens`）管的就是这个峰值。

**框架开销**是跟模型无关的固定杂费：CUDA context 本身占的、PyTorch 显存池预留的、cuBLAS 算矩阵乘时用的 workspace。经验值 1 到 2 GB。它不用算，看 nvidia-smi 报的已用显存减去自己张量的总和，差的那块就是它。

## batch 32 × 2048 的那张饼

把四项填进 7B 模型、batch 32、每个序列 2048 token 的场景：

| 项 | 大小 | 占比 | 性格 |
| --- | --- | --- | --- |
| 权重 | 13.5 GB | 28% | 固定，常驻 |
| KV cache | 32 GB | 67% | 随 batch × 序列长涨，请求结束释放 |
| 激活 | ~1.4 GB | 3% | 当前层临时量，层算完就扔 |
| 框架开销 | ~1.5 GB | 3% | 固定杂费，与模型无关 |
| 合计 | ~48 GB | | 80 GB 的卡还剩 32 GB |

<figure>
<svg viewBox="0 0 640 190" role="img" aria-label="A100 80GB 上 Llama-2-7B 两种 batch 下的显存四项堆叠条">
<text x="8" y="18" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">80 GB 显存被谁占了（每 7 px = 1 GB）</text>
<text x="8" y="58" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">batch 32 × 2048</text>
<rect x="120" y="44" width="94.5" height="22" fill="var(--compute)"/>
<rect x="214.5" y="44" width="224" height="22" fill="var(--mem)"/>
<rect x="438.5" y="44" width="10" height="22" fill="var(--mem-wash)" stroke="var(--rule)"/>
<rect x="448.5" y="44" width="10.5" height="22" fill="var(--paper-raised)" stroke="var(--rule)"/>
<rect x="459" y="44" width="221" height="22" fill="none" stroke="var(--rule)" stroke-dasharray="3 3"/>
<text x="167" y="59" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--paper-raised)">权重 13.5</text>
<text x="326" y="59" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--paper-raised)">KV cache 32 GB</text>
<text x="540" y="59" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">空闲 ~32 GB</text>
<text x="8" y="112" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">batch 1 × 2048</text>
<rect x="120" y="98" width="94.5" height="22" fill="var(--compute)"/>
<rect x="214.5" y="98" width="7" height="22" fill="var(--mem)"/>
<rect x="221.5" y="98" width="10.5" height="22" fill="var(--paper-raised)" stroke="var(--rule)"/>
<rect x="232" y="98" width="448" height="22" fill="none" stroke="var(--rule)" stroke-dasharray="3 3"/>
<text x="167" y="113" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--paper-raised)">权重 13.5</text>
<text x="240" y="93" font-family="var(--font-mono)" font-size="9" fill="var(--mem)">KV 1 GB</text>
<text x="456" y="113" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">空闲 ~64 GB</text>
<g font-family="var(--font-mono)" font-size="10">
<rect x="120" y="146" width="10" height="10" fill="var(--compute)"/><text x="136" y="155" fill="var(--ink-soft)">权重（不随 batch 变）</text>
<rect x="290" y="146" width="10" height="10" fill="var(--mem)"/><text x="306" y="155" fill="var(--ink-soft)">KV cache（× batch）</text>
<rect x="440" y="146" width="10" height="10" fill="var(--mem-wash)" stroke="var(--rule)"/><text x="456" y="155" fill="var(--ink-soft)">激活</text>
<rect x="510" y="146" width="10" height="10" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="526" y="155" fill="var(--ink-soft)">框架 1.5</text>
</g>
<text x="8" y="182" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">画幅 640 px 只够画到 80 GB；两条里权重那段一样长，差的全是 KV cache。</text>
</svg>
<figcaption>同一个模型同一张卡，batch 从 1 到 32，权重那段一动不动，KV cache 从 1 GB 涨到 32 GB。「显存够不够」这个问题的答案几乎完全由 KV cache 决定。</figcaption>
</figure>

KV cache 那行是 65536 token × 512 KB = 32 GB，是权重的 2.4 倍。这就回答了路线图里那句「batch 一大，谁会超过谁」：KV cache 超过权重，而且远超。13B 模型同样场景更夸张：权重 26 GB，KV cache 65536 × 800 KB = 50 GB，两项加起来 76 GB，80 GB 的卡只剩 4 GB，再多几个请求就爆。这也是为什么推理服务里 batch 不能随便开大，以及 M3 读 vLLM 时 PagedAttention 要解决的那个问题。

顺手把一个检验题做掉：batch 从 32 降到 1，四项里哪些变、哪些不变？权重不变，框架开销不变，KV cache 缩 32 倍，激活缩 32 倍。这题看着简单，但能一口答出来说明四项的性格真记住了。

## 生成一个 token 最快要多久

现在换个角度看权重。decode 阶段每生成一个 token，模型要把 6.74B 个权重从头到尾用一遍。用一遍的意思是：这 13.5 GB 必须从显存（HBM）搬进计算单元一遍。搬运有速度限制，叫显存带宽，A100 是 2039 GB/s，每秒最多搬 2039 GB。

所以不管算得多快，光搬权重就要：

```
13.5 GB ÷ 2039 GB/s ≈ 0.0066 s ≈ 6.6 ms
```

倒过来，每秒最多生成 1 ÷ 0.0066 ≈ 150 个 token。

这个数是 batch = 1 时的物理上限。算力再强也突破不了，因为瓶颈不在算，在搬。这就是 Day 1 读 Brrrr 时那个 memory bandwidth bound，第一次变成了具体数字。

换 13B 试一下：权重 26 GB，2039 ÷ 26 ≈ 78 token/s。模型翻倍，上限减半，因为要搬的字节翻倍了。这条规律很干净：batch 1 的 decode 速度上限 = 带宽 ÷ 权重字节数，跟模型架构细节无关，只看权重多大。

为什么权重每步都要搬一遍、不能像 KV cache 那样留在计算单元旁边？因为计算单元旁边的存储太小。A100 每个 SM 有 192 KB 的片上存储，108 个 SM 加起来 20 MB，再加 40 MB 的 L2，全部片上存储 60 MB，13.5 GB 的权重是它的两百多倍。片上装不下，就只能每步从 HBM 重新搬。这是 GPU 结构决定的，Day 25 会把这个存储层次摊开讲。

## 为什么加 batch 几乎不加时间

这是 Day 1 那道验收题「为什么增大 batch size 有时几乎不增加延迟」，现在能用数字答。

batch = 1 时，搬一遍 13.5 GB 权重，只算了 1 个 token。算力这边做了多少活？每个参数一乘一加，2 × 6.74B ≈ 13.5 GFLOP。A100 每秒能算 312 TFLOP，13.5 GFLOP 只要：

```
13.5e9 ÷ 312e12 ≈ 0.043 ms
```

而搬权重要 6.6 ms。算力干活 0.04 毫秒，然后闲等 6.6 毫秒，利用率不到 1%。

batch = 32 时，权重还是只搬一遍，6.6 ms 不变。但这一遍权重对 32 个 token 都用上了，算力干活变成 32 × 0.04 ≈ 1.3 ms，仍然藏在 6.6 ms 的搬运时间里。结果：32 个 token 的总耗时和 1 个 token 几乎一样，吞吐白涨 32 倍。

<figure>
<svg viewBox="0 0 640 215" role="img" aria-label="decode 一步中搬权重与计算两段时间在 batch 1、32、153 下的对比时间线">
<text x="8" y="18" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">decode 一步的时间，A100 + 7B fp16（80 px = 1 ms）</text>
<g font-family="var(--font-mono)" font-size="11">
<text x="8" y="56" fill="var(--ink)">batch 1</text>
<rect x="90" y="42" width="528" height="18" fill="var(--mem)"/>
<text x="354" y="55" text-anchor="middle" fill="var(--paper-raised)">搬权重 13.5 GB → 6.6 ms</text>
<rect x="90" y="62" width="4" height="10" fill="var(--compute)"/>
<text x="100" y="71" font-size="10" fill="var(--compute)">算 0.04 ms（利用率 0.65%）</text>
<text x="8" y="112" fill="var(--ink)">batch 32</text>
<rect x="90" y="98" width="528" height="18" fill="var(--mem)"/>
<text x="354" y="111" text-anchor="middle" fill="var(--paper-raised)">搬权重 6.6 ms，一个字节不多</text>
<rect x="90" y="118" width="104" height="10" fill="var(--compute)"/>
<text x="200" y="127" font-size="10" fill="var(--compute)">算 1.3 ms，仍藏在搬运时间里 → 吞吐 × 32，延迟不变</text>
<text x="8" y="168" fill="var(--ink)">batch 153</text>
<rect x="90" y="154" width="528" height="18" fill="var(--mem)"/>
<text x="354" y="167" text-anchor="middle" fill="var(--paper-raised)">搬权重 6.6 ms</text>
<rect x="90" y="174" width="528" height="10" fill="var(--compute)"/>
<text x="90" y="200" font-size="10" fill="var(--compute)">算 6.6 ms，两边同时忙满。再加 batch，算的时间超过搬的时间，延迟开始线性涨</text>
</g>
</svg>
<figcaption>搬权重是每步的固定成本，batch 多少都只搬一遍。算力那条从 0.04 ms 长到 1.3 ms 都被藏在 6.6 ms 底下，直到 batch ≈ 153 两条一样长。这就是「加 batch 不加延迟」的全部原因，也是它的边界。</figcaption>
</figure>

搬运是固定成本，算力有大量空闲，多带几个 token 一起算是免费的。这就是那句话的全部原因。

那 batch 加到多大算力才开始不够用？也就是算的时间追上搬的时间：6.6 ÷ 0.04 ≈ 165。用精确数字算是 153。到这个 batch，算力和带宽同时忙满，再往上加 batch，搬运时间不变但算的时间开始超过它，延迟开始线性涨。

## 给这件事起个名字：算术强度

刚才的比法换个说法：搬 1 个字节能配多少次计算。这个比值叫算术强度（arithmetic intensity），单位 FLOP/byte。

decode batch 1 的算术强度：每个参数搬 2 字节（fp16），做 2 次计算（一乘一加），2 ÷ 2 = 1 FLOP/byte。注意参数量 N 在分子分母里约掉了，所以这个 1 跟模型大小无关，7B 是 1，70B 也是 1。

batch 32 呢？每个参数还是搬 2 字节，但对 32 个 token 各做一次乘加，2 × 32 = 64 FLOP，强度 64 ÷ 2 = 32。所以 decode 的算术强度基本就等于 batch 大小（fp16 下）。这个等式是今天最好用的一条捷径。

A100 这张卡自己也有一个比值：算力除以带宽。

```
312e12 FLOP/s ÷ 2039e9 byte/s ≈ 153 FLOP/byte
```

意思是每搬 1 个字节配 153 次计算，算力和带宽才正好同时忙满。这个数叫 ridge point。用 PCIe 版 A100 算（带宽 1935 GB/s）是 161，数字稍有差别，量级一样，说的是同一件事。

decode batch 1 的强度是 1，ridge point 是 153，差两个数量级。这两个数摆在一起，就是「decode 阶段 GPU 有 99% 的算力在等显存」这句话的来源。

## roofline 图

把上面的事画成图，就是 roofline。横轴是算术强度（对数刻度），纵轴是实际能达到的算力（也是对数刻度）。

<figure>
<svg viewBox="0 0 640 265" role="img" aria-label="A100 的 roofline 图：带宽斜线与算力横线在 ridge point 153 相交，标出 decode batch 1、batch 32 和 prefill 的位置">
<line x1="70" y1="200" x2="610" y2="200" stroke="var(--rule)"/>
<line x1="70" y1="30" x2="70" y2="200" stroke="var(--rule)"/>
<g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
<text x="70" y="216" text-anchor="middle">0.25</text>
<text x="147" y="216" text-anchor="middle">1</text>
<text x="224" y="216" text-anchor="middle">4</text>
<text x="301" y="216" text-anchor="middle">16</text>
<text x="378" y="216" text-anchor="middle">64</text>
<text x="456" y="216" text-anchor="middle">256</text>
<text x="533" y="216" text-anchor="middle">1024</text>
<text x="610" y="216" text-anchor="middle">4096</text>
<text x="340" y="234" text-anchor="middle">算术强度 FLOP/byte（对数刻度）</text>
<text x="64" y="204" text-anchor="end">0.1</text>
<text x="64" y="161" text-anchor="end">1</text>
<text x="64" y="119" text-anchor="end">10</text>
<text x="64" y="76" text-anchor="end">100</text>
<text x="64" y="34" text-anchor="end">1000</text>
<text x="8" y="22">TFLOP/s</text>
</g>
<path d="M70 200 L427 51.5 L610 51.5 L610 200 Z" fill="var(--compute-wash)" opacity="0.5"/>
<path d="M70 200 L427 51.5 L427 200 Z" fill="var(--mem-wash)" opacity="0.7"/>
<line x1="70" y1="170" x2="427" y2="51.5" stroke="var(--mem)" stroke-width="3" stroke-linecap="round"/>
<line x1="427" y1="51.5" x2="610" y2="51.5" stroke="var(--compute)" stroke-width="3" stroke-linecap="round"/>
<line x1="427" y1="51.5" x2="427" y2="200" stroke="var(--rule)" stroke-dasharray="3 3"/>
<circle cx="427" cy="51.5" r="5" fill="var(--paper-raised)" stroke="var(--ink)" stroke-width="2"/>
<text x="436" y="44" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">ridge point 153 · 312 TFLOP/s</text>
<circle cx="147" cy="144.3" r="5" fill="var(--mem)"/>
<text x="157" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">decode batch 1</text>
<text x="157" y="154" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">强度 1 → 2 TFLOP/s（0.65%）</text>
<circle cx="340" cy="80.4" r="5" fill="var(--mem)"/>
<text x="240" y="76" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">decode batch 32</text>
<text x="240" y="90" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">强度 32 → 65 TFLOP/s</text>
<circle cx="570" cy="51.5" r="5" fill="var(--compute)"/>
<text x="560" y="72" font-family="var(--font-mono)" font-size="11" fill="var(--compute)" text-anchor="end">prefill 2000 tok</text>
<text x="560" y="86" font-family="var(--font-mono)" font-size="10" fill="var(--compute)" text-anchor="end">强度 ~2000 → 封顶</text>
<text x="100" y="192" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">memory-bound：加 batch 有用</text>
<text x="440" y="192" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">compute-bound：加 batch 没用</text>
<text x="8" y="256" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">斜线 = 2039 GB/s × 强度；横线 = 312 TFLOP/s；A100 80GB SXM，7B fp16</text>
</svg>
<figcaption>斜线是带宽给的天花板，横线是算力给的天花板，实际能达到的是两者中低的那个。decode batch 1 贴在斜线最底端，batch 32 沿斜线爬了一段，prefill 直接顶在横线上。所有推理优化都是在这张图上挪点。</figcaption>
</figure>

图上只有两条线。斜线是带宽乘以强度：强度越高，同样的字节量能配的计算越多，可达算力就越高。横线是峰值算力，再高也上不去了。两条线的交点就是 ridge point。

判定只有一句话：你的算术强度低于 153，就落在斜线上，卡在带宽，加大 batch 有用；高于 153，就落在横线上，卡在算力，加 batch 没用了。

写成代码就是一个 min：

```python
PEAK_FLOPS = 312e12     # FLOP/s, A100 BF16
HBM_BW     = 2039e9     # byte/s, A100 80GB SXM
RIDGE      = PEAK_FLOPS / HBM_BW    # ≈ 153 FLOP/byte

def attainable(ai):
    """算术强度为 ai 时，理论上能达到的算力。"""
    return min(PEAK_FLOPS, HBM_BW * ai)

attainable(1)     # ≈ 2.0e12  → decode batch 1，只用了 0.65% 的算力
attainable(32)    # ≈ 6.5e13  → decode batch 32，21%
attainable(153)   # ≈ 3.12e14 → 正好碰到屋顶
attainable(2000)  # = 3.12e14 → 封顶，再高也是这个数
```

`attainable(1)` 算出来约 2 TFLOP/s，除以 312 TFLOP/s 是 0.65%。这就是那个「利用率不到 1%」。

想自己画一张，把上面的函数接上 matplotlib，两个 loglog 就够：

```python
import numpy as np
import matplotlib.pyplot as plt

ai = np.logspace(-2, 4, 200)                      # 0.01 到 10000 FLOP/byte
plt.loglog(ai, [attainable(x) / 1e12 for x in ai], label="A100 roofline")
for x, name in [(1, "decode b=1"), (32, "decode b=32"), (2000, "prefill 2k")]:
    plt.scatter(x, attainable(x) / 1e12)
    plt.annotate(name, (x, attainable(x) / 1e12))
plt.axvline(RIDGE, ls="--", lw=0.8)
plt.xlabel("arithmetic intensity (FLOP/byte)")
plt.ylabel("attainable TFLOP/s")
plt.show()
```

W3 的 Day 15 会把这段代码里的 312 和 2039 换成自己实测的数，再画一遍。今天先用标称值。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/VtkxhygfNsY" title="Roofline and NVIDIA Ampere GPU Architecture Analysis" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>NVIDIA Developer · Roofline and NVIDIA Ampere GPU Architecture Analysis。官方讲 A100 上的 roofline，前十几分钟讲模型本身，后面讲怎么用 Nsight Compute 把实测 kernel 标到图上。今天看前半段就够，后半段 W3 再回来。</figcaption>
</figure>

## prefill 和 decode 落在图的两边

同一个模型，两个阶段，在 roofline 上的位置完全不同。

prefill 是把整个 prompt 一次吃进去。prompt 有 2000 个 token 的话，权重搬一遍，对 2000 个 token 都做了计算，相当于 batch 2000，算术强度直接冲到 2000 附近，远超 153。所以 prefill 天然落在横线上，compute-bound，卡算力。

decode 是一次只生成一个 token，batch 1 强度就是 1，天然落在斜线上，memory-bound，卡带宽。

这个区别决定了优化手段完全不同。prefill 卡算力，优化靠提高算力利用率，FlashAttention 那类减少中间量读写让计算单元不空转的手段有用。decode 卡带宽，优化靠减少字节或者让每个字节干更多活：batching 把强度往 153 拉，量化把每个参数从 2 字节压到 1 字节甚至半字节，读的字节少了速度直接上来。

所以以后看到一个推理优化手段，第一个问题永远是：它是在帮 prefill 还是帮 decode，是在挪字节还是挪 FLOP。答不出这个问题，就还没理解那个手段。

## 量化怎么改这张图

Day 4 末尾提过权重量化只改字节数。把它放到今天的除法里看效果：

| 权重精度 | 权重大小 | 搬一遍要多久 | batch 1 上限 | 每参数强度 | 打到 ridge 需要 batch |
| --- | --- | --- | --- | --- | --- |
| fp16 | 13.5 GB | 6.6 ms | 150 tok/s | 2 FLOP ÷ 2 B = 1 | 153 |
| int8 | 6.7 GB | 3.3 ms | 300 tok/s | 2 ÷ 1 = 2 | 77 |
| int4 | 3.4 GB | 1.65 ms | 600 tok/s | 2 ÷ 0.5 = 4 | 38 |

两件事一起发生。第一，batch 1 的上限直接翻倍再翻倍，因为要搬的字节少了，这是量化最直观的收益。第二，每个字节配的计算变多了，同样的 batch 在 roofline 上的位置往右挪，只要 batch 38 就能碰到 A100 的屋顶。所以 int4 模型在大 batch 下反而可能变成 compute-bound，这时候再量化就没有速度收益了，只剩显存收益。这解释了为什么量化的 benchmark 总是 batch 1 时最好看、batch 大了收益缩水。

表里的 tok/s 都是上限，实际 int4 还要在计算前把权重解压回 fp16 做乘法，这一步有开销，实测会比表里的数低一截。M2 W7 测的就是这个差距。

## 长序列时另一笔要搬的账

上面所有除法都只算了搬权重。decode 每步其实还要搬一样东西：这个请求已经攒下的 KV cache。第 2000 步的 token 要和前面 2000 个 token 的 k、v 算 attention，这 2000 × 512 KB = 1 GB 也要从 HBM 读一遍。

batch 1 时，1 GB 对 13.5 GB 是 7%，多花 0.5 ms，不算大。但 batch 32、每个请求都在 2000 长度时，要读的 KV cache 是 32 GB，比权重的 13.5 GB 还多。这一步的搬运时间变成 (13.5 + 32) ÷ 2039 ≈ 22 ms，而不是 6.6 ms。

这就是为什么「加 batch 不加延迟」有一个隐藏条件：序列要短。序列一长，KV cache 的读取量随 batch 线性涨，它不像权重那样是固定成本。到那时 decode 的瓶颈从「搬权重」变成「搬 KV cache」，batching 的收益提前饱和，远在 batch 153 之前。W3 的 Day 16 做 batch 扫描时，如果转折点明显早于 ridge point，这是三个候选原因之一。

这也是 GQA 的第二个好处：Llama-3-8B 的 KV cache 是 Llama-2-7B 的四分之一，同样 batch 32 × 2000 只要读 8 GB，搬运时间 (16 + 8) ÷ 2039 ≈ 12 ms，比 Llama-2-7B 的 22 ms 快近一倍，尽管它的权重更大。

## 换四张卡重算一遍

数字只对 A100 SXM 成立，换卡就变。把常见的几张卡放一起算，看 ridge point 差多少：

| 卡 | fp16/bf16 峰值（dense） | 显存带宽 | ridge point | 显存 | 7B fp16 装得下？ | 7B decode batch 1 上限 |
| --- | --- | --- | --- | --- | --- | --- |
| T4（Colab 免费） | 65 TFLOP/s | 320 GB/s | 203 | 16 GB | 不行 | 不适用；TinyLlama 2.2 GB → 145 tok/s |
| RTX 4090 | 165 TFLOP/s | 1008 GB/s | 164 | 24 GB | 行，剩 10 GB 给 KV | 1008 ÷ 13.5 ≈ 75 tok/s |
| A100 80GB PCIe | 312 TFLOP/s | 1935 GB/s | 161 | 80 GB | 行 | 143 tok/s |
| A100 80GB SXM | 312 TFLOP/s | 2039 GB/s | 153 | 80 GB | 行 | 150 tok/s |
| H100 SXM | 989 TFLOP/s | 3350 GB/s | 295 | 80 GB | 行 | 248 tok/s |

几个观察：

**ridge point 都在 150 到 300 之间**。五张卡的算力差 15 倍，带宽差 10 倍，但比值只差两倍。这不是巧合，芯片设计时算力和带宽是配着长的。所以「decode batch 1 强度是 1，离 ridge 差两个数量级」这句话在所有现代 GPU 上都成立，不是 A100 的特例。

**H100 的 ridge point 更高，意思是它更难喂饱**。算力涨了 3.2 倍，带宽只涨 1.6 倍，同样 batch 32 的 decode 在 H100 上离屋顶更远。所以 H100 上 decode 的 batch 要开得更大才划算，这也是为什么 H100 的价值更多体现在 prefill 和训练这类 compute-bound 的活上。

**decode 上限只看带宽**。H100 比 A100 快 1.65 倍，正好是带宽之比 3350 ÷ 2039，跟算力涨了 3 倍没关系。买卡跑 decode 时，看带宽那一栏，不看 TFLOPS。

**T4 装不下 7B**。这是 W2 用 TinyLlama 的原因。T4 带宽 320 GB/s，TinyLlama 权重 2.2 GB，上限 145 tok/s，跟 A100 跑 7B 的 150 tok/s 意外地接近，因为模型小了六倍、带宽也慢了六倍。W2 在 Colab 上实测的 TPOT 要拿 6.9 ms 这个数来对账。

RTX 4090 那行的 165 TFLOP/s 是 fp16 累加的数，用 fp32 累加只有一半；标称页上还有个 330 是稀疏算力，都不能拿来算 ridge。Day 28 专门讲怎么读规格表，这里先记住：算 ridge 用 dense、非稀疏、和你实际用的累加精度对应的那个数。

## 这张表推出后面所有事

W1 整周算出来的东西，凑成一张表：

| 要算出的数 | 答案 | 怎么来的 |
| --- | --- | --- |
| 权重占用（fp16） | 13.5 GB（约 14 GB） | 6.74e9 × 2 bytes |
| KV cache / token | 512 KB | 2 × 32 层 × 4096 × 2 bytes |
| KV cache @ batch 32 × 2048 tok | 32 GB | 65536 × 512 KB，比权重还大 |
| decode 理论上限（batch 1） | ~150 tok/s | 13.5 GB ÷ 2039 GB/s ≈ 6.6 ms |
| 算术强度（batch 1） | 1 FLOP/byte | 2 FLOP ÷ 2 bytes |
| 算术强度（batch b，fp16） | ≈ b FLOP/byte | 2b FLOP ÷ 2 bytes |
| A100 ridge point | ~153 FLOP/byte | 312 TFLOP/s ÷ 2039 GB/s |
| 打到 compute-bound 需要 | batch ≈ 153 | 上面两行相除 |
| 显存能装的 2048 长请求数 | ≈ 65 | (80 − 13.5 − 1.5) GB ÷ 1 GB |

13.5 GB 和 14 GB 是同一个数的不同舍入：6.74 × 2 = 13.48，按 1000 进制凑整就说 14 GB。路线图里那张表写的 14 GB 和 145 tok/s，跟这里的 13.5 GB 和 150 tok/s 是同一件事。

最后两行摆在一起是今天最扎心的对照：算力要 batch 153 才忙满，显存只装得下 65 个 2048 长的请求。**在 A100 上跑 Llama-2-7B，长序列场景下永远到不了 compute-bound，显存先满了。**要么缩短序列，要么量化 KV cache，要么换 GQA 模型，要么像 vLLM 那样不给每个请求预留满 2048 而是按实际长度分配。这四条路后面都会走。

这张表为什么是整条路线的起点：batch = 1 时算术强度只有 1，ridge point 是 153，差两个数量级，decode 阶段的 GPU 有 99% 的算力在等显存，每生成一个 token 都要把 13.5 GB 权重完整读一遍。这一个事实推出了后面所有事：

- continuous batching 是吞吐的命门，因为它做的事就是把算术强度从 1 往 153 拉。
- 量化能直接换来速度，因为读的字节少了，同样带宽下搬完权重的时间缩短。
- KV cache 一大就爆显存，而爆显存就装不下更多请求，batch 上不去，强度就拉不上去。KV cache 是 batching 收益的天花板。

M3 到 M8 做的所有优化，读 vLLM 的 scheduler 和 block manager、写 Triton kernel、从零搭最小推理引擎，都是在这张图上挪位置。要么把点往右挪（提高强度），要么把屋顶抬高（换卡、换精度），没有第三种。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LuhJEEJQgUM" title="Lecture 1 How to profile CUDA kernels in PyTorch" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>GPU MODE · Lecture 1 How to profile CUDA kernels in PyTorch。今天算的全是纸上的数，这一讲教怎么用 torch.profiler 和 Nsight 在真机上看到它们。W2 的 Day 10 要照着做，今天先看一遍知道工具长什么样。</figcaption>
</figure>

## 名词解释

| 名词 | 意思 |
| --- | --- |
| HBM | High Bandwidth Memory，GPU 上的显存。A100 80GB 的 HBM2e 带宽 2039 GB/s，H100 的 HBM3 是 3350 GB/s |
| 显存带宽 | 每秒能从显存搬多少字节进计算单元。单位 GB/s |
| 峰值算力 | 计算单元全忙时每秒能做多少次浮点运算。A100 BF16 是 312 TFLOP/s（万亿次/秒） |
| dense / sparse 算力 | 规格表上常有两个算力数，大的那个是 2:4 结构化稀疏才能达到的，算 ridge 用 dense 那个 |
| FLOP | 一次浮点运算。一乘或一加各算一次，所以每个参数在前向里贡献 2 FLOP |
| 算术强度 | arithmetic intensity，每搬 1 字节做多少 FLOP。单位 FLOP/byte。decode 时 ≈ batch 大小（fp16） |
| ridge point | 卡的算力 ÷ 带宽，算术强度到这个值时算力和带宽同时忙满。A100 SXM ≈ 153，H100 ≈ 295 |
| roofline | 横轴算术强度、纵轴可达算力的图，斜线是带宽限制，横线是算力限制 |
| memory-bound | 算术强度低于 ridge point，时间花在搬数据上，算力闲着 |
| compute-bound | 算术强度高于 ridge point，时间花在算上，带宽有余量 |
| 激活 | activation，前向计算时每层产生的中间向量，推理时用完即弃，峰值在 prefill |
| 框架开销 | CUDA context、PyTorch 显存池、cuBLAS workspace 等与模型无关的固定占用 |
| prefill | 一次把整个 prompt 喂进模型的阶段，算术强度高，compute-bound |
| decode | 一次生成一个 token 的阶段，算术强度约等于 batch，memory-bound |
| 片上存储 | SM 里的寄存器、shared memory 和 L2，A100 全部加起来约 60 MB，装不下权重 |
| max_num_batched_tokens | vLLM 限制一次 prefill 最多处理多少 token 的参数，控制激活峰值 |

## 常见误区

**把 TFLOPS 当成能达到的速度**。312 TFLOP/s 是屋顶，不是地板。decode batch 1 实际只用到 2 TFLOP/s，剩下 310 在等数据。看到宣传页上的算力数字，先问一句：我的 workload 算术强度多少，够不够爬到屋顶。

**只看 nvidia-smi 的 GPU 利用率百分比**。那个 util 数字的定义是「过去一段时间里有没有 kernel 在跑」，有 kernel 在跑就算 100%，哪怕那个 kernel 99% 时间在等显存。它测的是「忙不忙」，不是「算力用了多少」。decode 阶段 util 显示 100% 同时算力利用率 0.65%，两个数字都是对的，测的不是一回事。真要看算力利用率得用 profiler 看 tensor core 的活跃周期。

**只算权重就说显存够**。13.5 GB 的模型放 24 GB 的卡上，看着绰绰有余，一开 batch 就 OOM。因为 KV cache 在 batch 32 × 2048 时是权重的 2.4 倍。算显存必须四项一起算，而且 KV cache 要按你实际要跑的 batch 和序列长度算，不是按 batch 1 算。

**把 prefill 和 decode 当成一回事优化**。它们在 roofline 上一个在横线一个在斜线，帮 decode 的手段（量化、batching）对 prefill 收益小，帮 prefill 的手段对 decode 也一样。看 benchmark 数字时先问测的是哪个阶段。

**以为「加 batch 不加延迟」没有条件**。它的前提是搬运量不随 batch 涨。序列一长，每步要读的 KV cache 随 batch 线性涨，到 batch 32 × 2000 时 KV cache 的读取量已经超过权重，延迟开始明显上升，远在 153 之前。

**用规格表上最大的那个算力数算 ridge**。A100 的 624 和 4090 的 330 是稀疏算力，H100 的 1979 也是。算 ridge 用 dense 那个数，还要和实际用的精度对应。

**以为 H100 比 A100 快 3 倍所以 decode 也快 3 倍**。decode 上限只看带宽，H100 是 A100 的 1.65 倍，就快 1.65 倍。算力那 3 倍要在 prefill 和训练里才兑现。

## 参考资料

文章

- Making Deep Learning Go Brrrr From First Principles，Horace He。三种瓶颈的原始出处，Day 1 读过，今天的数字全是给它配的。https://horace.io/brrr_intro.html
- Transformer Inference Arithmetic，Kipply。把 KV cache、算术强度、prefill/decode 的账全部算了一遍，跟本文口径基本一致，读它可以对账。https://kipp.ly/transformer-inference-arithmetic/
- Large Transformer Model Inference Optimization，Lilian Weng。从显存和带宽出发讲推理优化的全景，Day 5 之后读正好。https://lilianweng.github.io/posts/2023-01-10-inference-optimization/
- How to Scale Your Model，Google DeepMind。第一章讲 roofline，推理章节把 batch 和算术强度的关系推得很细，虽然口径是 TPU，公式通用。https://jax-ml.github.io/scaling-book/
- GPU Performance Background User's Guide，NVIDIA。官方版的算术强度和 memory/math-bound 判定，短，读一遍对口径。https://docs.nvidia.com/deeplearning/performance/dl-performance-gpu-background/index.html
- NVIDIA A100 Tensor Core GPU Datasheet。312 TFLOP/s 和 2039 GB/s 的出处。https://www.nvidia.com/content/dam/en-zz/Solutions/Data-Center/a100/pdf/nvidia-a100-datasheet-us-nvidia-1758950-r4-web.pdf
- NVIDIA H100 产品页，989 TFLOP/s 和 3350 GB/s 的出处。https://www.nvidia.com/en-us/data-center/h100/
- Roofline: An Insightful Visual Performance Model for Multicore Architectures，Williams、Waterman、Patterson，2009。roofline 模型的原始论文，发在 Communications of the ACM，按标题搜索。
- Nsight Compute Profiling Guide，NVIDIA。里面有一节 Roofline Charts，讲工具怎么把实测 kernel 标到 roofline 上，W3 用。https://docs.nvidia.com/nsight-compute/ProfilingGuide/index.html

视频

- Roofline and NVIDIA Ampere GPU Architecture Analysis，NVIDIA Developer，YouTube，已嵌在正文里。
- GPU MODE Lecture 1: How to profile CUDA kernels in PyTorch。讲怎么用 profiler 看到今天纸上算的这些东西，W2 要用。已嵌在正文里，讲义仓库 https://github.com/gpu-mode/lectures 。

## 自测

合上笔记做。答不出来的那题回去重读对应那节。

1. 7B fp16 模型、batch 32、序列 2048，在 A100 80GB 上显存分四项各多少、占比多少？

<details><summary>答案</summary>

权重 13.5 GB（28%），KV cache 32 GB（67%），激活约 1.4 GB（3%），框架开销约 1.5 GB（3%）。合计约 48 GB。KV cache 是权重的 2.4 倍。

</details>

2. 13B 模型（权重 26 GB）在 A100 上 batch 1 的 decode 速度上限是多少？这个上限由什么决定？

<details><summary>答案</summary>

2039 GB/s ÷ 26 GB ≈ 78 token/s。由显存带宽和权重字节数决定，跟算力无关。每生成一个 token 必须把全部权重从 HBM 搬一遍，搬完的时间就是下限。模型翻倍上限减半。

</details>

3. 为什么 batch 从 1 加到 32，一步 decode 的时间几乎不变？什么时候开始变？

<details><summary>答案</summary>

搬权重要 6.6 ms，是固定成本，batch 多少都只搬一遍。batch 1 算力只干 0.04 ms 就闲着，batch 32 算 1.3 ms 仍藏在 6.6 ms 里。到 batch ≈ 153 时算的时间追上搬的时间，再往上加延迟开始线性涨。另一个让它提前变的因素是长序列下 KV cache 的读取量随 batch 涨。

</details>

4. decode batch 1 的算术强度是多少？batch 32 呢？为什么和模型大小无关？

<details><summary>答案</summary>

batch 1 是 1 FLOP/byte：每个参数搬 2 字节（fp16）做 2 FLOP（一乘一加）。batch 32 是 32：同样 2 字节做 2 × 32 FLOP。参数量 N 在分子分母约掉，所以 7B 和 70B 都一样。fp16 下 decode 的算术强度 ≈ batch 大小。

</details>

5. prefill 和 decode 分别落在 roofline 哪一侧？为什么不同？各自的优化方向是什么？

<details><summary>答案</summary>

prefill 在横线上，compute-bound，因为一次处理几千个 token 相当于 batch 几千，算术强度远超 153。decode 在斜线上，memory-bound，因为一次一个 token 强度只有 1。prefill 优化靠提高算力利用率（如 FlashAttention）；decode 优化靠 batching 拉强度、量化减字节。

</details>

6. 一张卡 nvidia-smi 显示 GPU 利用率 100%，能说明算力用满了吗？

<details><summary>答案</summary>

不能。那个 util 只表示时间窗口内有 kernel 在跑，一个 99% 时间在等显存的 kernel 也算 100%。decode 阶段 util 100% 和算力利用率 0.65% 同时成立。要看算力利用率得用 profiler 看 tensor core 活跃度。

</details>

7. 把 7B 权重量化到 int4，batch 1 的 decode 上限变成多少？打到 compute-bound 需要的 batch 变成多少？为什么大 batch 下量化的速度收益会缩水？

<details><summary>答案</summary>

权重 3.4 GB，搬一遍 1.65 ms，上限约 600 tok/s。每参数强度变成 2 FLOP ÷ 0.5 byte = 4，所以 batch 38 就碰到 153 的 ridge。batch 超过 38 之后已经是 compute-bound，瓶颈在算力，再减字节也不会更快，只剩显存收益。

</details>

8. H100 的 fp16 算力是 A100 的 3.2 倍，7B 模型 decode batch 1 在 H100 上比 A100 快多少倍？为什么？

<details><summary>答案</summary>

约 1.65 倍，等于带宽之比 3350 ÷ 2039。decode batch 1 是 memory-bound，上限由带宽决定，算力多 3 倍用不上。H100 的 ridge point 295 比 A100 的 153 更高，反而更难喂饱。

</details>

## 明天预告

Day 6 是 W1 的收口：把这一周从「参数是矩阵里的数字」到「ridge point 153」串成一页笔记，做路线图里那五道验收题，再整理一本错题本，把这周答错的地方（13824 错当 KV cache 的维度、一个头的 q 答成 128 × 128）记下来，看以后还会不会在同一个地方摔。最后把 Llama-2-13B 的三题从头到尾重算一遍留底。
