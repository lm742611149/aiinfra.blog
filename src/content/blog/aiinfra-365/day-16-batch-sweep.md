---
title: 'Day 16 · batch 从 1 扫到 128：吞吐曲线在哪里离开斜线'
description: '把 batch 开到 1、4、16、64、128，测 decode 每步时间，算吞吐，标到 Day 15 的 roofline 上。W1 预测 batch 到 ridge 附近才碰屋顶，今天要看这条曲线实际在哪弯、为什么弯——弯的原因不是 FLOP 追上了带宽，是 KV cache 的字节跟着 batch 一起涨。'
pubDate: 2026-09-05
regime: memory
tags: ['batching', 'throughput', 'kv-cache', 't4', 'roofline', 'aiinfra-365']
series: 'aiinfra-365'
day: 16
lang: 'zh'
---

## 今天要解决的问题

Day 5 用一次除法得出一个预测:decode 时权重只搬一遍,batch 从 1 加到几十,每步时间几乎不变,吞吐白涨;一直加到算术强度等于 ridge point,算力才成为瓶颈。A100 上这个数是 153,T4 上按标称是 203。W1 的那张表把这条结论叫「整周最重要的一个数」。

今天检验它。在 Colab 的 T4 上,TinyLlama-1.1B,batch 取 1、4、16、64、128 五个点,每个点测 decode 一步的时间,算出吞吐,画成曲线,再标到 Day 15 那张 roofline 上。做完要能回答:

1. 曲线是什么形状。哪一段是「加 batch 免费」,从哪个 batch 开始不再免费。
2. 转折点是不是在 203 附近。如果远早于 203,是什么先到了。
3. 为什么会这样,能不能事先算出来。

第三问是今天的重点。W1 的预测漏了一项,今天要把它补上,补上之后会得到一个比「batch ≈ 153」更有用的结论。

口径和前几天一样:T4 标称 320 GB/s、65 TFLOP/s;实测值用 Day 15 的示例,带宽 270 GB/s、算力 50 TFLOP/s、ridge 185;TinyLlama fp16 权重 2.2 GB,KV cache 每 token 22.5 KB(22 层 × 2 × 4 个 KV 头 × 64 × 2 字节)。所有「测出来」的数字今天还是预期区间,真实数字填进文末的记录表。

## W1 的预测漏了什么

Day 5 的推理是这样的:decode 一步搬 2N 字节权重,做 2N × b 次运算,算术强度 AI = 2Nb ÷ 2N = b。所以 AI 随 batch 线性涨,b = 203 时碰到 T4 的屋顶。

这个推理假设「一步搬的字节只有权重」。Day 4 算过另一样东西:KV cache。decode 每一步,每个序列都要把自己前面所有 token 的 k 和 v 读一遍,才能算 attention。这部分字节是

```
KV 字节 = b × n × (每 token KV 大小)
        = b × n × 22.5 KB          TinyLlama
```

n 是当前上下文长度。batch 1、n = 256 时是 5.8 MB,跟 2.2 GB 的权重比可以忽略,Day 5 忽略它没错。但它乘了一个 b。batch 128、n = 256 时是 737 MB,权重的三分之一;n = 2048 时是 5.9 GB,是权重的 2.7 倍。

所以一步搬的字节是

```
字节(b) = 2N + b × n × kv
FLOP(b) = 2N × b
AI(b)   = 2Nb ÷ (2N + b × n × kv)
```

把 b 除到分母里:

```
AI(b) = 2N ÷ (2N/b + n × kv)
```

b 无穷大时 2N/b 趋于零,AI 趋于一个上限:

```
AI_max = 2N ÷ (n × kv) = 权重字节 ÷ (上下文长度 × 每 token KV 字节)
```

这是今天最重要的一个式子。它说:**不管 batch 开多大,算术强度有个天花板,天花板等于权重字节除以一个序列的 KV cache 字节。**batching 摊薄的是权重,摊不薄 KV cache,因为每个序列的 KV 是它自己的,别人用不上。

代进数字:

| 模型 | 权重 | 每 token KV | n = 256 时 AI_max | n = 2048 时 AI_max | ridge |
| --- | --- | --- | --- | --- | --- |
| TinyLlama-1.1B(GQA,4 个 KV 头) | 2.2 GB | 22.5 KB | 382 | 48 | T4 实测约 185 |
| Llama-2-7B(MHA,32 个 KV 头) | 13.5 GB | 512 KB | 103 | 12.9 | A100 约 153 |

TinyLlama 在 256 的上下文下天花板 382,高于 ridge,理论上 batch 够大能碰到屋顶;2048 的上下文下天花板只有 48,连 ridge 的三分之一都不到,再大的 batch 也永远 memory-bound。Llama-2-7B 更狠:2048 上下文下 AI 最多 12.9,离 153 差一个数量级,这就是「7B 模型做长上下文推理时 GPU 算力永远用不满」的定量版本,也是为什么 M2 要花整整一周在 KV cache 上、为什么 GQA 和 KV cache 量化这两件事那么受重视:它们不是在省显存,是在抬这个天花板。

碰到屋顶需要的 batch 也能反解出来。令 AI(b) = ridge:

```
b* = ridge × 2N ÷ (2N − ridge × n × kv)
```

TinyLlama、n = 256、ridge 185:b* = 185 × 2.2e9 ÷ (2.2e9 − 185 × 5.76e6) ≈ 185 × 2.2e9 ÷ 1.13e9 ≈ **360**。不是 185,是 360,因为分母被 KV 吃掉了一半。今天扫到 128 就停,所以按理论今天根本碰不到屋顶,曲线只会看到「开始弯」,看不到「压平」。这本身就是结论之一。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="decode 一步搬的字节:权重固定 2.2 GB,KV cache 随 batch 和上下文长度一起涨,n=2048、batch 128 时 KV 是权重的 2.7 倍">
<text x="20" y="22" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">一步 decode 搬的字节 = 权重(固定)+ KV cache(随 b × n 涨),条长 ∝ 字节,59 px = 1 GB</text>
<g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
<text x="20" y="52">n=256  b=1</text><rect x="130" y="40" width="130" height="14" fill="var(--mem)"/><rect x="260" y="40" width="1" height="14" fill="var(--ink-faint)"/><text x="268" y="52" fill="var(--ink-soft)">2.21 GB,KV 0.3%</text>
<text x="20" y="76">n=256  b=16</text><rect x="130" y="64" width="130" height="14" fill="var(--mem)"/><rect x="260" y="64" width="5" height="14" fill="var(--ink-faint)"/><text x="272" y="76" fill="var(--ink-soft)">2.29 GB,KV 4%</text>
<text x="20" y="100">n=256  b=128</text><rect x="130" y="88" width="130" height="14" fill="var(--mem)"/><rect x="260" y="88" width="44" height="14" fill="var(--ink-faint)"/><text x="311" y="100" fill="var(--ink-soft)">2.94 GB,KV 25%</text>
<line x1="20" y1="118" x2="620" y2="118" stroke="var(--rule-soft)"/>
<text x="20" y="144">n=2048 b=1</text><rect x="130" y="132" width="130" height="14" fill="var(--mem)"/><rect x="260" y="132" width="3" height="14" fill="var(--ink-faint)"/><text x="270" y="144" fill="var(--ink-soft)">2.25 GB,KV 2%</text>
<text x="20" y="168">n=2048 b=16</text><rect x="130" y="156" width="130" height="14" fill="var(--mem)"/><rect x="260" y="156" width="44" height="14" fill="var(--ink-faint)"/><text x="311" y="168" fill="var(--ink-soft)">2.94 GB,KV 25%</text>
<text x="20" y="192">n=2048 b=64</text><rect x="130" y="180" width="130" height="14" fill="var(--mem)"/><rect x="260" y="180" width="174" height="14" fill="var(--ink-faint)"/><text x="441" y="192" fill="var(--ink-soft)">5.15 GB,KV 57%</text>
<text x="20" y="216">n=2048 b=128</text><rect x="130" y="204" width="130" height="14" fill="var(--mem)"/><rect x="260" y="204" width="348" height="14" fill="var(--ink-faint)"/><text x="130" y="238" fill="var(--ink-soft)">8.10 GB,KV 73%,是权重的 2.7 倍</text>
</g>
<rect x="470" y="34" width="12" height="10" fill="var(--mem)"/><text x="488" y="43" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">权重 2.2 GB</text>
<rect x="470" y="50" width="12" height="10" fill="var(--ink-faint)"/><text x="488" y="59" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">KV cache</text>
</svg>
<figcaption>权重那一段永远是 130 像素,batching 就是让这一段被更多 token 分摊。KV 那一段每个序列各自付,batch 翻倍它就翻倍。上下文一长,它就反过来成了大头。</figcaption>
</figure>

## 预测曲线长什么样

有了字节和 FLOP 的式子,每一步的时间就是 Day 15 的 roofline 公式加一个 overhead:

```
t(b) = max( 字节(b) ÷ B ,  FLOP(b) ÷ P ) + t_overhead
吞吐(b) = b ÷ t(b)          单位 token/s
```

t_overhead 是 Day 11 看到的 gap 加 Python 开销,每步基本固定,和 batch 关系不大。Day 9 的示例 TPOT 是 15 ms、下限 6.9 ms,差的 8 ms 就当 overhead 的示例值。

用实测示例(B = 270 GB/s,P = 50 TFLOP/s,overhead 8 ms)算五个 batch 的预测:

| batch | 字节(n=256) | 搬运时间 | 计算时间 | 每步时间 | 吞吐 tok/s | 若完全线性 | AI(b) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2.21 GB | 8.2 ms | 0.04 ms | 16.2 ms | 62 | 62 | 1.0 |
| 4 | 2.22 GB | 8.2 ms | 0.18 ms | 16.2 ms | 246 | 248 | 4.0 |
| 16 | 2.29 GB | 8.5 ms | 0.70 ms | 16.5 ms | 970 | 992 | 15 |
| 64 | 2.57 GB | 9.5 ms | 2.8 ms | 17.5 ms | 3,650 | 3,970 | 55 |
| 128 | 2.94 GB | 10.9 ms | 5.6 ms | 18.9 ms | 6,780 | 7,940 | 96 |

几件事一眼能看出来。

计算时间在 batch 128 时也只有 5.6 ms,还没追上 10.9 ms 的搬运时间。整条曲线从头到尾都是 memory-bound,和 AI(128) = 96 < 185 说的是一回事。

每步时间从 16.2 ms 涨到 18.9 ms,只涨了 17%,吞吐涨了 109 倍。这就是「加 batch 几乎免费」在 T4 上的实际版本。

但 128 那一行的吞吐比完全线性少了 15%,64 那行少 8%,16 那行少 2%。这个缺口全部来自 KV 字节,不是来自 FLOP。它从 batch 16 开始能看见,64 开始明显。**曲线离开斜线的地方,是 KV 字节开始和权重字节可比的地方,不是算力追上带宽的地方。**

上下文换成 2048 再算一遍,缺口大得多:

| batch | 字节(n=2048) | 每步时间 | 吞吐 tok/s | 若完全线性 | 差 | AI(b) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 2.25 GB | 16.3 ms | 61 | 61 | 0% | 1.0 |
| 4 | 2.38 GB | 16.8 ms | 238 | 245 | 3% | 3.7 |
| 16 | 2.94 GB | 18.9 ms | 848 | 980 | 13% | 12 |
| 64 | 5.15 GB | 27.1 ms | 2,360 | 3,920 | 40% | 27 |
| 128 | 8.10 GB | 38.0 ms | 3,370 | 7,840 | 57% | 35 |

同样的卡、同样的模型,只是 prompt 长了八倍,batch 128 的吞吐从 6,780 掉到 3,370,一半没了。AI 最高只到 35,天花板 48 已经能看见。所以「batch 开到多少合适」这个问题没有和上下文长度无关的答案,这是 M2 W6 读 vLLM scheduler 时会反复碰到的事:调度器算的不是 batch 数,是 KV 字节。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="吞吐随 batch 的预测曲线:n=256 时几乎贴着线性参考线到 128 才略微弯,n=2048 时从 16 开始明显弯">
<g stroke="var(--rule-soft)" stroke-width="1">
<line x1="80" y1="250" x2="560" y2="250"/><line x1="80" y1="206" x2="560" y2="206"/><line x1="80" y1="162" x2="560" y2="162"/><line x1="80" y1="118" x2="560" y2="118"/><line x1="80" y1="74" x2="560" y2="74"/><line x1="80" y1="30" x2="560" y2="30"/>
</g>
<g stroke="var(--rule)" stroke-width="1.5"><line x1="80" y1="250" x2="560" y2="250"/><line x1="80" y1="250" x2="80" y2="30"/></g>
<g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
<text x="80" y="266" text-anchor="middle">1</text><text x="200" y="266" text-anchor="middle">4</text><text x="320" y="266" text-anchor="middle">16</text><text x="440" y="266" text-anchor="middle">64</text><text x="500" y="266" text-anchor="middle">128</text>
<text x="72" y="254" text-anchor="end">32</text><text x="72" y="210" text-anchor="end">100</text><text x="72" y="166" text-anchor="end">316</text><text x="72" y="122" text-anchor="end">1k</text><text x="72" y="78" text-anchor="end">3.2k</text><text x="72" y="34" text-anchor="end">10k</text>
<text x="560" y="286" text-anchor="end">batch(log2)</text><text x="12" y="20">吞吐 tok/s(log)</text>
</g>
<line x1="80" y1="224.5" x2="500" y2="39" stroke="var(--ink-faint)" stroke-width="1.5" stroke-dasharray="5 4"/>
<text x="505" y="36" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">完全线性</text>
<polyline points="80,224.5 200,171.7 320,119 440,68.5 500,45" fill="none" stroke="var(--mem)" stroke-width="2.5"/>
<g fill="var(--mem)"><circle cx="80" cy="224.5" r="4"/><circle cx="200" cy="171.7" r="4"/><circle cx="320" cy="119" r="4"/><circle cx="440" cy="68.5" r="4"/><circle cx="500" cy="45" r="4"/></g>
<text x="508" y="52" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">n=256</text>
<text x="508" y="65" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">6,780(−15%)</text>
<polyline points="80,225 200,172.8 320,124 440,85 500,71.6" fill="none" stroke="var(--mem)" stroke-width="2" stroke-dasharray="2 3"/>
<g fill="var(--paper-raised)" stroke="var(--mem)" stroke-width="2"><circle cx="200" cy="172.8" r="4"/><circle cx="320" cy="124" r="4"/><circle cx="440" cy="85" r="4"/><circle cx="500" cy="71.6" r="4"/></g>
<text x="508" y="78" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">n=2048</text>
<text x="508" y="91" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">3,370(−57%)</text>
<path d="M330 150 L322 128" stroke="var(--ink)" stroke-width="1" fill="none"/>
<text x="250" y="165" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">n=2048 从这里开始离开斜线</text>
</svg>
<figcaption>预测曲线,不是实测。实心线是 256 上下文,几乎贴着线性参考线到 128 才差 15%;空心虚线是 2048 上下文,batch 16 就能看出弯,128 时只剩线性的 43%。两条线弯的地方都远早于 ridge,弯的原因都是 KV 字节。</figcaption>
</figure>

## 转折早于 ridge 的三个原因

上面算的是理想模型。真机上曲线弯得会比预测更早一点,原因有三类,按重要性排。

**第一,KV cache 的字节。**刚算过了。这是最主要的原因,而且是可以事先算出来的。判断方法:把实测的每步时间乘实测带宽,得到「等效搬了多少字节」,减去权重字节,剩下的和 b × n × kv 对一下,对得上就是它。

**第二,显存装不下。**这一条在 T4 跑 TinyLlama 时不会碰到:batch 128、上下文 2048 的 KV 是 5.9 GB,加权重 8.1 GB,16 GB 装得下。但换成 Llama-2-7B 在 A100 80GB 上,batch 128 × 2048 的 KV 是 128 × 2048 × 512 KB = 128 GB,权重 13.5 GB,加起来远超 80 GB。也就是说 7B 模型在 A100 上根本开不到 batch 128,曲线在显存爆掉的地方直接断掉,不是弯。Day 5 那张饼图里 KV cache 占 67% 就是在说这个。这一条决定了实际服务里 batch 的上限往往是显存给的,不是 ridge 给的,这也是 vLLM 的 PagedAttention 要解决的问题。

**第三,kernel 效率。**attention kernel 的时间不只和字节有关,还和它怎么被切成 tile、b 和 n 是不是 tile 大小的整数倍有关。batch 大了之后 attention kernel 的形状变了,效率可能变好也可能变差。另外 HF 的 `generate` 在 batch 大时 Python 侧的采样、mask 拼接也会多花一点时间。这一类没法事先算,只能测出来之后和第一类对账,对不上的部分归到这里。

还有一件相反方向的事要提前知道:曲线最左端,batch 1 到 4 那一段,吞吐几乎完全线性,比预测的还线性。因为这一段每步时间被 overhead 主导,8 ms 的 overhead 加 8 ms 的搬运,batch 加到 4 两项都几乎不变。这一段「免费」不是 roofline 给的,是 overhead 给的:反正 GPU 一半时间在等 CPU,多带几个 token 一起等也不多花时间。这和 Day 11 说的「加大 batch 后 gap 占比降」是同一件事的两面。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="一步 decode 的时间分解,batch 1 和 batch 128 对比:overhead 固定 8 ms,搬权重固定 8.2 ms,KV 从 0 涨到 2.7 ms,计算时间藏在搬运时间之下">
<text x="20" y="22" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">一步 decode 的时间从哪来(示例值,24 px = 1 ms,n=256)</text>
<g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
<text x="20" y="62">batch 1</text>
<rect x="100" y="48" width="192" height="20" fill="var(--ink-faint)"/><text x="196" y="62" text-anchor="middle" fill="var(--paper-raised)">overhead 8</text>
<rect x="292" y="48" width="196" height="20" fill="var(--mem)"/><text x="390" y="62" text-anchor="middle" fill="var(--paper-raised)">搬权重 8.2</text>
<rect x="488" y="48" width="1" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="496" y="62" fill="var(--ink-soft)">= 16.2 ms</text>
<rect x="292" y="72" width="1" height="6" fill="var(--compute)"/><text x="300" y="80" font-size="10" fill="var(--compute)">计算 0.04 ms,藏在搬运下面</text>
<text x="20" y="126">batch 128</text>
<rect x="100" y="112" width="192" height="20" fill="var(--ink-faint)"/><text x="196" y="126" text-anchor="middle" fill="var(--paper-raised)">overhead 8</text>
<rect x="292" y="112" width="196" height="20" fill="var(--mem)"/><text x="390" y="126" text-anchor="middle" fill="var(--paper-raised)">搬权重 8.2</text>
<rect x="488" y="112" width="65" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="520" y="126" text-anchor="middle" fill="var(--mem)">KV 2.7</text>
<text x="560" y="126" fill="var(--ink-soft)">= 18.9 ms</text>
<rect x="292" y="136" width="135" height="6" fill="var(--compute)"/><text x="434" y="143" font-size="10" fill="var(--compute)">计算 5.6 ms,仍藏在搬运下面</text>
<text x="20" y="190" fill="var(--ink-soft)">batch ×128,每步时间 ×1.17,吞吐 ×109。多出来的 2.7 ms 全是 KV 字节。</text>
<text x="20" y="210" fill="var(--ink-soft)">计算时间要涨到 10.9 ms 才成为瓶颈,对应 batch ≈ 250,今天扫不到。</text>
</g>
</svg>
<figcaption>每步时间是三段之和,只有 KV 那段随 batch 变。计算时间用细条画在下面,因为它和搬运是并行的,谁长谁算数,现在还是搬运长。</figcaption>
</figure>

## 怎么测:代码

测这条曲线有几个坑,先把测法说清楚,再给代码。

**只测 decode 段,不测 prefill。**prefill 是 compute-bound,时间随 prompt 长度涨,混进来会把曲线搅乱。做法是先手动跑一次 prefill 拿到 KV cache,然后自己写循环一步一步 decode,每步计时。不用 `generate`,它把两段混在一起,而且大 batch 时它内部的采样逻辑也占时间。

**所有序列用同一个 prompt,复制 b 份。**这样不需要 padding,不需要处理 attention mask 里的 0,也不会有「长短不齐导致的浪费」这个额外变量。等长请求是 W1 到 W3 的简化假设,不等长是 M2 W6 的主题。

**计时要 `synchronize`,要 warmup,取中位数。**Day 8 的规矩。每个 batch 先跑 10 步不计时,再跑 40 步,取中位数。

**记峰值显存。**`torch.cuda.max_memory_allocated()` 每个 batch 重置一次,这是「第二个原因」的实测数据。

**OOM 要接住。**batch 128 在 T4 上应该装得下,但如果上下文调大了可能装不下,`try/except torch.cuda.OutOfMemoryError` 记一行 OOM 继续跑下一个,不要整个脚本死掉。

```python
# batch_sweep.py —— 在 Colab T4 上跑,只测 decode 段
# !pip install -q transformers accelerate  (Colab 里先装)
import time, statistics, json
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM

MODEL = "TinyLlama/TinyLlama-1.1B-Chat-v1.0"
BATCHES = [1, 4, 16, 64, 128]
PROMPT_LEN = 128        # prompt token 数;换 2048 看第二条曲线
WARMUP, STEPS = 10, 40  # 每个 batch 先跑 10 步不计时,再测 40 步

tok = AutoTokenizer.from_pretrained(MODEL)
model = AutoModelForCausalLM.from_pretrained(
    MODEL, torch_dtype=torch.float16, device_map="cuda"
).eval()
print(torch.cuda.get_device_name(0))          # Day 7 的规矩:先记卡型

# 造一个恰好 PROMPT_LEN 个 token 的 prompt,所有序列一样,免 padding
base = tok("The quick brown fox jumps over the lazy dog. " * 100,
           return_tensors="pt").input_ids[:, :PROMPT_LEN]
weight_bytes = sum(p.numel() * p.element_size() for p in model.parameters())
print(f"权重 {weight_bytes/1e9:.2f} GB")

results = []
for b in BATCHES:
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()
    try:
        ids = base.repeat(b, 1).cuda()
        with torch.no_grad():
            # ---- prefill:一次算完 prompt,拿到 KV cache ----
            out = model(input_ids=ids, use_cache=True)
            past = out.past_key_values
            nxt = out.logits[:, -1].argmax(-1, keepdim=True)   # greedy

            # ---- decode:一步一个 token,每步计时 ----
            times = []
            for step in range(WARMUP + STEPS):
                torch.cuda.synchronize()
                t0 = time.perf_counter()
                out = model(input_ids=nxt, past_key_values=past, use_cache=True)
                past = out.past_key_values
                nxt = out.logits[:, -1].argmax(-1, keepdim=True)
                torch.cuda.synchronize()
                if step >= WARMUP:
                    times.append(time.perf_counter() - t0)

        step_ms = statistics.median(times) * 1e3
        peak_gb = torch.cuda.max_memory_allocated() / 1e9
        ctx = PROMPT_LEN + WARMUP + STEPS // 2                  # 计时段中点的上下文长度
        row = dict(batch=b, step_ms=round(step_ms, 2),
                   tok_per_s=round(b / step_ms * 1e3),
                   peak_gb=round(peak_gb, 2), ctx=ctx)
        print(row)
        results.append(row)
        del ids, out, past, nxt
    except torch.cuda.OutOfMemoryError:
        print(dict(batch=b, oom=True))
        results.append(dict(batch=b, oom=True))
        torch.cuda.empty_cache()

json.dump(results, open("sweep.json", "w"), indent=1)
```

几处说明。

`base.repeat(b, 1)` 把同一个 prompt 复制 b 份。因为完全一样,greedy 出来的 token 每个序列也一样,这没关系,我们测的是时间不是内容。

prefill 那一次 `model(...)` 不计时。它的时间是 TTFT 的主体,Day 9 测过,今天不管。

decode 循环里每步只喂一个 token(`nxt` 形状是 `[b, 1]`),加上 `past_key_values`,模型就知道前面的上下文在 cache 里。这就是 Day 4 讲的 KV cache 在代码里的样子。新版 transformers 里 `past_key_values` 是一个 `DynamicCache` 对象,直接传回去就行。

`ctx` 记的是计时段中点的上下文长度,因为 decode 过程中 n 每步加 1,40 步里 KV 字节在慢慢涨,取中点当代表值。PROMPT_LEN = 128、中点约 158,和上面预测表用的 256 差一点,自己对账时用实际的 ctx 重算预测值。

想看第二条曲线,把 `PROMPT_LEN` 改成 2048。注意 prefill 时 attention 的中间量在 eager 实现下是 b × 32 头 × n × n × 2 字节,batch 128、n 2048 是 34 GB,T4 装不下。新版 transformers 默认用 `sdpa`,不会物化这个矩阵,能过;如果报 OOM,检查 `model.config._attn_implementation` 是不是 `sdpa`,或者 prefill 分几批做。

### 画图

```python
# plot_sweep.py —— 把 sweep.json 画成吞吐曲线 + 预测曲线
import json, numpy as np, matplotlib.pyplot as plt

rows = [r for r in json.load(open("sweep.json")) if "oom" not in r]
b = np.array([r["batch"] for r in rows]); thr = np.array([r["tok_per_s"] for r in rows])

# ---- 预测模型参数:换成 Day 13/14 的实测值和 Day 9 推出的 overhead ----
B, P = 270e9, 50e12                 # 实测带宽、实测算力(示例)
OVH = 8e-3                          # 每步固定 overhead 秒(示例,= Day 9 TPOT − 下限)
W, KV, N = 2.2e9, 22.5e3, 1.1e9     # 权重字节、每 token KV 字节、参数量
n = rows[0]["ctx"]

bb = np.logspace(0, np.log2(256), 60, base=2)
t_pred = np.maximum((W + bb * n * KV) / B, 2 * N * bb / P) + OVH
plt.figure(figsize=(7, 5))
plt.loglog(bb, bb / t_pred, "-", color="#2b53d8", lw=2, label="预测:权重 + KV 字节 + overhead")
plt.loglog(bb, bb * thr[0], "--", color="0.6", label="完全线性(以 batch 1 为准)")
plt.loglog(b, thr, "o", color="#b26a12", ms=8, label="实测")
for x, y, r in zip(b, thr, rows):
    plt.annotate(f"{y}\n{r['peak_gb']} GB", (x, y), textcoords="offset points",
                 xytext=(6, -22), fontsize=8)
plt.xlabel("batch"); plt.ylabel("吞吐 token/s"); plt.title(f"T4 · TinyLlama · ctx≈{n}")
plt.grid(True, which="both", alpha=0.25); plt.legend(); plt.tight_layout()
plt.savefig("sweep.png", dpi=160)
```

三条线画在一起:虚线是「如果完全线性」,实线是今天的预测模型,点是实测。实测点应该落在实线附近。落在实线下面太多,是第三个原因(kernel 效率);落在实线上面,说明 overhead 估大了,去 Day 11 的 timeline 里重新量 gap。

### 标到 roofline 上

每个 batch 也是 Day 15 那张图上的一个点。横坐标 AI(b) = 2Nb ÷ (2N + b × n × kv),纵坐标 = 2Nb ÷ 每步时间。把五个点加进 Day 15 脚本的 `POINTS` 里:

```python
for r in rows:
    bts = W + r["batch"] * r["ctx"] * KV
    POINTS.append((f"decode b={r['batch']}", 2 * N * r["batch"], bts, r["step_ms"] / 1e3))
```

五个点会沿着斜线下方排成一串,从 AI ≈ 1 往右走到 AI ≈ 90,一直在斜线下面同一个相对高度,因为 overhead 那段距离不随 batch 变。没有一个点靠近 ridge。这就是今天的结论画成图的样子。

## 记录表

| batch | 每步时间 ms | 吞吐 tok/s | 若线性 | 差 | 峰值显存 GB | 预测每步 ms | 实测 ÷ 预测 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | ______ | ______ | ______ | 0% | ______ | ______ | ______ |
| 4 | ______ | ______ | ______ | ______ | ______ | ______ | ______ |
| 16 | ______ | ______ | ______ | ______ | ______ | ______ | ______ |
| 64 | ______ | ______ | ______ | ______ | ______ | ______ | ______ |
| 128 | ______ | ______ | ______ | ______ | ______ | ______ | ______ |

预测那列用文中的模型算,参数用 Day 13、14 的实测值和 Day 9 推出的 overhead。最后一列在 0.9 到 1.3 之间说明模型对了;偏离更多,先查上下文长度用的对不对,再查 kernel 效率。

另外两个数也记下:实测的 batch 1 到 128 每步时间涨了 ______ %(预测 17%);曲线开始离开线性(差超过 5%)的第一个 batch 是 ______(预测 n=256 时是 64,n=2048 时是 16)。

## 这一天改写了什么

W1 的结论是「batch 到 153 才碰屋顶」。今天之后这句话要改成三句:

一,batching 摊薄的只有权重,KV cache 每个序列自己付。算术强度的天花板是权重字节除以一个序列的 KV 字节,和 batch 无关。

二,长上下文下这个天花板可能低于 ridge。Llama-2-7B 在 2048 上下文下是 12.9,永远 memory-bound。这时候能做的不是加 batch,是减 KV 字节:GQA、KV cache 量化、或者别把用不上的上下文留在 cache 里。

三,实际服务里 batch 的上限多半是显存给的,不是 ridge 给的。7B 在 A100 上开不到 128。

这三句是 M2 全部内容的提纲。W5 测 KV cache 开关,W5+ 学 GQA 和 MoE,W6 读 continuous batching 和 vLLM 的 scheduler,W7 量化。每一样都是在这张图上挪那个天花板,或者在显存限制下多塞几个序列。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| batch sweep | 把 batch 从小到大扫一遍,每个点测一次,看曲线形状 |
| 吞吐 | throughput,每秒生成多少 token,= batch ÷ 每步时间 |
| 每步时间 | decode 生成一个 token(所有序列各一个)的墙钟时间。batch 1 时就是 TPOT |
| 线性参考线 | 假设每步时间不随 batch 变,吞吐 = batch × batch 1 的吞吐。曲线和它的差就是「不再免费」的部分 |
| AI(b) | batch 为 b 时的算术强度,2Nb ÷ (2N + b·n·kv),不是简单的 b |
| AI_max | b 无穷大时 AI 的极限,= 权重字节 ÷ (上下文长度 × 每 token KV 字节)。batching 收益的天花板 |
| b* | 让 AI(b) 等于 ridge 的 batch,理论上碰到屋顶需要的 batch。TinyLlama n=256 时约 360 |
| 上下文长度 n | 当前序列里已经有的 token 数,prompt 加已生成的。decode 每步加 1 |
| GQA | grouped-query attention,多个 q 头共享一组 k、v 头。TinyLlama 32 个 q 头共享 4 个 KV 头,KV cache 缩 8 倍,AI_max 抬 8 倍 |
| `past_key_values` | transformers 里 KV cache 的载体,新版是 `DynamicCache` 对象,每步传回去就接着用 |
| greedy | 每步取概率最大的 token,不采样。测性能时用它,结果确定 |
| `max_memory_allocated` | PyTorch 记录的峰值显存,`reset_peak_memory_stats` 清零后重新记 |
| `sdpa` | scaled_dot_product_attention,PyTorch 内置的 attention 实现,不物化 n × n 的分数矩阵 |

## 常见误区

**以为 AI = batch。**这是 W1 的近似,KV 小的时候成立。KV 字节乘了 b,所以 AI(b) 是有上限的分式,不是直线。上下文越长上限越低。

**看到曲线弯了就说「算力到瓶颈了」。**T4 上 TinyLlama batch 128 的计算时间是搬运时间的一半,离瓶颈还远。弯是 KV 字节造成的,判断方法是把每步时间乘带宽算等效字节,和 2N + b·n·kv 对账。

**测吞吐时把 prefill 算进去。**prefill 时间随 prompt 长度线性涨,是另一个 regime。混进去以后曲线形状和 prompt 长度绑死,没法解释。只测 decode 段。

**用不同长度的 prompt 组 batch。**padding 引入浪费,attention mask 引入额外 kernel,曲线里多了一个变量。等长是今天的简化,不等长是 M2 W6 的题。

**忘了记峰值显存。**曲线断在哪、能不能再往上开一档,是显存说了算。不记这个数,「为什么只扫到 128」就答不出来。

**把 T4 上的转折点当通用结论。**T4 的 ridge 是 185 左右,A100 是 153,H100 更高;TinyLlama 是 GQA,7B 是 MHA,KV 大小差 20 多倍。换卡换模型,b* 和 AI_max 全变,只有那两个式子不变。

## 参考资料

文章

- Transformer Inference Arithmetic,Kipply。第 4、5 节把 batch、KV cache、算术强度的关系推了一遍,包括「KV cache 读取让 attention 部分的强度不随 batch 涨」这一点,和今天的 AI_max 是同一件事。https://kipp.ly/transformer-inference-arithmetic/
- LLM Inference Performance Engineering: Best Practices,Databricks。有实测的吞吐 vs batch 曲线和延迟 vs 吞吐权衡,可以拿今天的预测形状去对。https://www.databricks.com/blog/llm-inference-performance-engineering-best-practices
- How continuous batching enables 23x throughput in LLM inference,Anyscale。静态 batching 为什么浪费、continuous batching 怎么补上,M2 W6 的预读。今天等长请求的简化在这篇里被打破。https://www.anyscale.com/blog/continuous-batching-llm-inference
- vLLM: Easy, Fast, and Cheap LLM Serving with PagedAttention,vLLM 博客。「显存装不下」那一条的解法。https://blog.vllm.ai/2023/06/20/vllm.html
- Making Deep Learning Go Brrrr From First Principles,Horace He。今天曲线最左端那段「overhead 给的免费」就是它讲的第三种瓶颈。https://horace.io/brrr_intro.html

文档或代码

- TinyLlama-1.1B-Chat-v1.0 模型卡,配置里能查到 22 层、4 个 KV 头、5632 中间宽度。https://huggingface.co/TinyLlama/TinyLlama-1.1B-Chat-v1.0
- transformers 文档 LLM inference optimization,讲 KV cache、静态 cache、`torch.compile` 在 generate 里怎么用。https://huggingface.co/docs/transformers/main/en/llm_optims
- `torch.cuda.Event` 文档,Day 8 的另一种计时法。https://pytorch.org/docs/stable/generated/torch.cuda.Event.html

视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/7Ccz5yNAMoA" title="Continuous Batching: Why Your GPU Sits Idle" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Ahmad Hassan · Continuous Batching: Why Your GPU Sits Idle。从今天的静态等长 batch 出发,讲为什么真实请求不等长时 GPU 会空,是 M2 W6 的引子。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/DNrIu_EZz5k" title="LLM Inference Engines: vLLM, KV Cache, Paged attention and Continuous Batching." loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>The Cef Experience · LLM Inference Engines: vLLM, KV Cache, Paged attention and Continuous Batching。把今天的三个原因(KV 字节、显存装不下、等长假设)在一个推理引擎里串起来讲,先看个全貌,细节 M3 再读源码。</figcaption>
</figure>

## 自测

合上笔记做。

1. 写出 batch 为 b、上下文为 n 时 decode 一步的字节数和 FLOP 数,以及算术强度 AI(b)。b 无穷大时 AI 趋于什么?

<details><summary>答案</summary>

字节 = 2N + b × n × kv,FLOP = 2Nb,AI(b) = 2Nb ÷ (2N + b·n·kv)。b 无穷大时 AI 趋于 2N ÷ (n·kv),即权重字节除以一个序列的 KV cache 字节。这是 batching 能拉到的算术强度上限。

</details>

2. Llama-2-7B 在 2048 上下文下 AI_max 是多少?这意味着什么?

<details><summary>答案</summary>

13.5 GB ÷ (2048 × 512 KB) ≈ 12.9。A100 的 ridge 是 153,所以不管 batch 多大都永远 memory-bound,加 batch 拉不到屋顶。能做的是减 KV 字节:GQA、KV cache 量化、缩短留在 cache 里的上下文。

</details>

3. T4 上 TinyLlama、n = 256 的曲线,预测在 batch 128 时比线性少 15%。这 15% 来自哪里?算力占了多少?

<details><summary>答案</summary>

全部来自 KV cache 字节:batch 128 时 KV 是 737 MB,让每步搬运时间从 8.2 ms 涨到 10.9 ms。算力一点没占,因为计算时间 5.6 ms 还藏在搬运时间下面,没成为瓶颈。

</details>

4. 为什么曲线最左端 batch 1 到 4 那段比 roofline 预测的还线性?

<details><summary>答案</summary>

因为这段每步时间被固定的 overhead(GPU 等 CPU 发 kernel)主导,示例里 8 ms overhead 加 8 ms 搬运,batch 加到 4 两项都不变。多带几个 token 一起等不多花时间。这是 overhead-bound 给的免费,不是带宽给的。

</details>

5. 为什么只测 decode 段、只用等长 prompt?

<details><summary>答案</summary>

prefill 是 compute-bound、时间随 prompt 长度涨,混进来曲线形状就和 prompt 长度绑死。不等长 prompt 要 padding 和 mask,引入浪费和额外 kernel。今天要看的只有一个变量 batch,其他全固定;不等长是 M2 W6 的题。

</details>

6. Llama-2-7B 在 A100 80GB 上能开到 batch 128、上下文 2048 吗?算一下。

<details><summary>答案</summary>

不能。KV cache = 128 × 2048 × 512 KB = 128 GB,加权重 13.5 GB 远超 80 GB。80 GB 减权重和杂项剩约 64 GB,除以每序列 2048 × 512 KB = 1 GB,大约只能开 60 个序列。实际服务里 batch 上限是显存给的,不是 ridge 给的。

</details>

## 明天预告

Day 17 把 W3 这几天的数字摆到一起:标称 320 GB/s 和 65 TFLOP/s,实测各是几成,差的那几成去了哪(时钟降频、功耗墙、tile 利用率、搬运和计算不完全重叠)。然后回答路线图 W3 的最后一问:什么样的 kernel 能打到实测的算力上限,什么样的永远打不到。答案会把 Day 15 那张 kernel 表分成两堆,大 GEMM 一堆,elementwise、softmax、layernorm 一堆,后面那堆就是 M5 要 fusion 的对象。顺便讲一个训练圈常用的数:MFU。
