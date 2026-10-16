---
title: 'Day 9 · 把 TTFT 和 TPOT 分开测，再和 W1 的理论下限对账'
description: '一次 generate 的耗时里藏着两个性格完全不同的数：首 token 时间和后续每 token 时间。今天把它们拆开，各自算出理论下限，然后用一个比值回答 W1 那张表能不能信。'
pubDate: 2026-09-05
regime: memory
tags: ['ttft', 'tpot', 'latency', 'colab', 't4', 'aiinfra-365']
series: 'aiinfra-365'
day: 9
lang: 'zh'
---

## 今天要解决的问题

Day 7 在 Colab 的 T4 上把 TinyLlama-1.1B 跑通了,Day 8 把计时改对了:前后都 `torch.cuda.synchronize()`,warmup 三次,取中位数。现在手里有一个数:生成 64 个 token 大约要多少毫秒。

这个数没法直接和 W1 的理论对账。因为一次 `generate` 里其实发生了两件性格完全相反的事:先把整段 prompt 一口气算完(prefill),再一个一个往外吐 token(decode)。Day 5 算过,这两件事一个卡算力、一个卡带宽,落在 roofline 的两边。把它们的时间加在一起除以 token 数,得到的是一个谁也不代表的平均值。

所以今天做三件事:

1. 把总耗时拆成两个数:**TTFT**(首 token 时间)和 **TPOT**(后续每 token 时间)。
2. 给这两个数各算一个理论下限。TPOT 的下限就是 Day 5 那个除法,换成 T4 和 TinyLlama 的数重算一遍。
3. 算一个比值:**实测 TPOT ÷ 理论下限**。这个比值是整周真正的产出,也是后面一年所有优化工作的基线。

和 Day 7、8 一样,今天的实测数字要等自己跑出来填进表里。文中出现的「预期」都会给算式或依据,不会替真实数据说话。

## 一次 generate 里到底发生了什么

先把时间线画出来。输入一段 200 个 token 的 prompt,让模型生成 64 个新 token:

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="一次 generate 的时间线:左侧一大块 prefill,右侧一串等宽的 decode 小块">
<rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)"/>
<text x="20" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">时间 →</text>
<line x1="20" y1="120" x2="620" y2="120" stroke="var(--rule)" stroke-width="1"/>
<rect x="20" y="70" width="150" height="50" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1.5"/>
<text x="95" y="91" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">prefill</text>
<text x="95" y="108" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">200 个 token 一起算</text>
<g fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1.2">
<rect x="180" y="80" width="20" height="40"/><rect x="204" y="80" width="20" height="40"/><rect x="228" y="80" width="20" height="40"/><rect x="252" y="80" width="20" height="40"/><rect x="276" y="80" width="20" height="40"/><rect x="300" y="80" width="20" height="40"/><rect x="324" y="80" width="20" height="40"/><rect x="348" y="80" width="20" height="40"/><rect x="372" y="80" width="20" height="40"/><rect x="396" y="80" width="20" height="40"/><rect x="420" y="80" width="20" height="40"/><rect x="444" y="80" width="20" height="40"/>
</g>
<text x="480" y="105" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">… decode,一步一个 token</text>
<line x1="20" y1="140" x2="180" y2="140" stroke="var(--compute)" stroke-width="1.5"/>
<line x1="20" y1="135" x2="20" y2="145" stroke="var(--compute)" stroke-width="1.5"/>
<line x1="180" y1="135" x2="180" y2="145" stroke="var(--compute)" stroke-width="1.5"/>
<text x="100" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">TTFT</text>
<line x1="204" y1="140" x2="228" y2="140" stroke="var(--mem)" stroke-width="1.5"/>
<line x1="204" y1="135" x2="204" y2="145" stroke="var(--mem)" stroke-width="1.5"/>
<line x1="228" y1="135" x2="228" y2="145" stroke="var(--mem)" stroke-width="1.5"/>
<text x="216" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">TPOT</text>
<text x="20" y="192" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">总耗时 = TTFT + (N − 1) × TPOT,N 是生成的 token 数</text>
</svg>
<figcaption>一次 generate 的时间线。左边那一大块是 prefill:200 个 prompt token 一起过一遍模型,产出第一个新 token。右边每个小块是一步 decode:只算一个 token,但每步都要把全部权重搬一遍。</figcaption>
</figure>

**TTFT**,time to first token,是从发出请求到第一个新 token 出来的时间。它几乎等于 prefill 的时间:整段 prompt 过一遍 22 层,算出最后一个位置的 logits,采样出第一个 token。

**TPOT**,time per output token,是第一个 token 之后每多生成一个 token 的平均时间。它就是一步 decode 的时间:拿上一个 token 过一遍 22 层,查 KV cache 里存好的前文,产出下一个 token。

两者的关系:

```
总耗时 = TTFT + (N − 1) × TPOT
```

N 是生成的 token 数。N = 64 时,TPOT 那一项是 63 步,TTFT 只有一次。所以生成越长,总耗时越被 TPOT 主导;prompt 越长,TTFT 越占比重。一个只看总耗时的 benchmark,换个 prompt 长度或换个 N,数字就没法比。这是要把它们拆开的第一个理由。

第二个理由是 Day 5 讲过的:它们卡在不同的地方。prefill 卡算力,decode 卡带宽。优化手段完全不同,混在一起就不知道该往哪边用力。

## 先算 TPOT 的理论下限

这一步是 Day 5 的除法,换成 T4 和 TinyLlama 的数字重算一遍。

TinyLlama-1.1B 的权重是 1.1B 个数字,fp16 每个 2 字节:

```
1.1e9 × 2 bytes = 2.2e9 bytes ≈ 2.2 GB
```

T4 的显存带宽标称 320 GB/s。每步 decode 至少要把权重从头到尾搬一遍:

```
2.2 GB ÷ 320 GB/s ≈ 0.0069 s ≈ 6.9 ms
```

倒过来,每秒最多 1 ÷ 0.0069 ≈ 145 个 token。

这是 batch 1 时一步 decode 的物理下限,任何软件优化都不能突破,因为它是搬运时间不是计算时间。对比 Day 5 算的 A100 跑 7B:13.5 GB ÷ 2039 GB/s ≈ 6.6 ms。两个数很接近不是巧合:TinyLlama 比 7B 小 6 倍,T4 的带宽比 A100 慢 6.4 倍,正好抵消。这也说明「小模型在便宜卡上」和「大模型在贵卡上」的 decode 速度可以差不多,决定速度的是「权重字节 ÷ 带宽」这一个比值,不是模型多大或卡多贵。

那算力这边呢?一步 decode 的运算量是 2 × 参数量 = 2 × 1.1e9 ≈ 2.2 GFLOP。T4 的 fp16 tensor core 峰值 65 TFLOP/s:

```
2.2e9 ÷ 65e12 ≈ 0.034 ms
```

搬要 6.9 ms,算只要 0.034 ms,差两百倍。算力那 0.034 ms 完全藏在搬运时间里,可以当零。TPOT 的理论下限就是 6.9 ms,只由带宽和权重字节数决定。

### KV cache 那份搬运要不要算

decode 每步除了搬权重,还要读 KV cache:前面所有 token 的 k 和 v。这份要不要算进下限?

TinyLlama 用了 GQA,Day 4 讲过:k、v 的头数不是 32 而是 4,每个头 64 维,所以 k、v 向量各是 4 × 64 = 256 长,不是 d = 2048。每 token 每层存 k 和 v 两份:

```
2 × 256 × 2 bytes = 1 KB
```

22 层就是 22 KB,严格算是 22.5 KB。prompt 200 个 token 加生成到第 64 个,KV cache 总共约 264 × 22.5 KB ≈ 6 MB。和 2.2 GB 的权重比是千分之三,不影响下限。

什么时候它会变得重要?序列长到 KV cache 和权重一个量级的时候。2.2 GB ÷ 22.5 KB ≈ 98,000 个 token。TinyLlama 的上下文窗口只有 2048,远远到不了。所以在这个实验里,**TPOT 的下限就是搬权重的时间,KV cache 可以忽略**。这也解释了一个容易想歪的地方:GQA 把 KV cache 压小了 8 倍(从 32 个头到 4 个头),但对 batch 1 短序列的 TPOT 几乎没有影响,因为 TPOT 的大头一直是权重。GQA 省的是显存,它的收益在 batch 开大、序列拉长的时候才兑现,那是 M2 的事。

## 再算 TTFT 的理论下限

prefill 是把 200 个 token 一起算。运算量是 2 × 参数量 × token 数:

```
2 × 1.1e9 × 200 = 4.4e11 FLOP = 440 GFLOP
```

T4 峰值 65 TFLOP/s,全速要:

```
440e9 ÷ 65e12 ≈ 6.8 ms
```

同时权重也要搬一遍,6.9 ms。这两件事在 GPU 里是重叠的,不是串行相加,所以下限取两者中较大的那个,约 7 ms。

有意思的地方来了。算术强度 = FLOP ÷ 字节。prefill 200 个 token,每搬一个 fp16 参数(2 字节)要做 2 × 200 = 400 次运算,强度 = 200 FLOP/byte。T4 的 ridge point 是 65e12 ÷ 320e9 ≈ 203。**200 个 token 的 prefill 正好压在 T4 的 ridge point 上**,算力和带宽同时忙满。prompt 再长一点就 compute-bound,再短一点就 memory-bound。

这和 Day 5 说的「prefill 天然 compute-bound」不矛盾。那句话的前提是 prompt 有几千个 token。prompt 只有几十个 token 时,prefill 和 decode 一样卡带宽。所以判断哪一侧不能死记结论,要算强度和 ridge point 比。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="T4 的 roofline:横轴算术强度对数刻度,decode 落在 1,prefill 200 token 落在 ridge point 203 附近,2000 token 落在屋顶上">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<line x1="70" y1="240" x2="600" y2="240" stroke="var(--ink-faint)" stroke-width="1.2"/>
<line x1="70" y1="240" x2="70" y2="40" stroke="var(--ink-faint)" stroke-width="1.2"/>
<path d="M70 240 L400 70" fill="none" stroke="var(--mem)" stroke-width="2.5"/>
<path d="M400 70 L600 70" fill="none" stroke="var(--compute)" stroke-width="2.5"/>
<path d="M70 240 L400 70 L400 240 Z" fill="var(--mem-wash)" opacity="0.6"/>
<path d="M400 240 L400 70 L600 70 L600 240 Z" fill="var(--compute-wash)" opacity="0.6"/>
<circle cx="400" cy="70" r="4.5" fill="var(--paper-raised)" stroke="var(--ink)" stroke-width="2"/>
<text x="408" y="60" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">ridge ≈ 203</text>
<circle cx="120" cy="214" r="5" fill="var(--mem)"/>
<text x="130" y="210" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">decode batch 1</text>
<text x="130" y="224" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">强度 1,可达 0.32 TFLOP/s</text>
<circle cx="398" cy="72" r="5" fill="var(--compute)"/>
<text x="290" y="100" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">prefill 200 tok</text>
<text x="290" y="114" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">强度 200,正好压线</text>
<circle cx="520" cy="70" r="5" fill="var(--compute)"/>
<text x="480" y="95" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">prefill 2000 tok</text>
<text x="480" y="109" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">强度 2000,封顶 65</text>
<text x="70" y="262" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">1</text>
<text x="230" y="262" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">10</text>
<text x="390" y="262" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">203</text>
<text x="590" y="262" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">10⁴</text>
<text x="330" y="284" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">算术强度 FLOP/byte(对数)</text>
<text x="66" y="74" text-anchor="end" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">65 T</text>
<text x="66" y="242" text-anchor="end" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">0.3 T</text>
<text x="20" y="30" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">可达算力 FLOP/s(对数)</text>
</svg>
<figcaption>T4 上 TinyLlama 的三个点。decode batch 1 强度 1,在斜线最底部;200 token 的 prefill 强度 200,正好在 ridge point 203 上;2000 token 的 prefill 强度 2000,稳稳在屋顶。同一个模型,prompt 长度不同,落点就不同。</figcaption>
</figure>

TTFT 的下限还要加一样东西:采样。prefill 算完最后一个位置的 logits(32000 个数),要做 softmax 和采样或 argmax,再把 token 拷回 CPU。这些是零头,微秒级,但它们在 TTFT 里和在每步 TPOT 里都出现一次。

所以 200 token prompt 的 TTFT 理论下限约 7 ms,和 TPOT 的 6.9 ms 差不多。实测 TTFT 会明显大于 TPOT,原因不在下限,在实际达到的效率:prefill 是几个大矩阵乘,能吃到 T4 算力的一部分;但 T4 上 fp16 矩阵乘的实际效率大概只有峰值的六七成(W3 会亲手测),加上 attention 在 200 个 token 上要算 200 × 200 的相似度矩阵,在 T4 上没有 FlashAttention 可用,走的是普通 softmax 路径,这一段效率更低。所以 TTFT 实测落在 15 到 40 ms 都算正常,不要拿 7 ms 去要求它。

## 怎么把两个数分开测

三种方法,精度递增,代码量也递增。

### 方法一:两次 generate 相减

最简单。先只生成 1 个 token,那次的耗时就是 TTFT;再生成 N 个 token,总耗时减去 TTFT 除以 N − 1 就是 TPOT。

```python
# Colab,接着 Day 8 的 model / tokenizer / inputs 往下写
import torch, statistics

def timed(fn, repeat=10):
    """warmup 3 次后测 repeat 次,返回中位数毫秒。"""
    for _ in range(3):
        fn()
    torch.cuda.synchronize()
    times = []
    for _ in range(repeat):
        start = torch.cuda.Event(enable_timing=True)
        end = torch.cuda.Event(enable_timing=True)
        start.record()
        fn()
        end.record()
        torch.cuda.synchronize()
        times.append(start.elapsed_time(end))
    return statistics.median(times)

gen = lambda n: model.generate(**inputs, max_new_tokens=n, do_sample=False,
                               pad_token_id=tokenizer.eos_token_id)

N = 64
ttft_ms  = timed(lambda: gen(1))
total_ms = timed(lambda: gen(N))
tpot_ms  = (total_ms - ttft_ms) / (N - 1)

print(f"prompt tokens : {inputs['input_ids'].shape[1]}")
print(f"TTFT          : {ttft_ms:.1f} ms")
print(f"TPOT          : {tpot_ms:.2f} ms  ({1000/tpot_ms:.0f} tok/s)")
```

两点说明。`do_sample=False` 是贪心解码,去掉采样的随机性,保证每次生成的 token 一样,时间才可比。`max_new_tokens=1` 那次其实包含了 `generate` 自身的准备工作(建 cache、处理 stopping criteria),这部分会被算进 TTFT,让它稍微偏大,但每步 decode 也有类似的框架开销,所以 TPOT 这边算出来是公平的。

### 方法二:streamer 给每个 token 打时间戳

transformers 提供 `TextIteratorStreamer`,`generate` 在另一个线程里跑,主线程每收到一个 token 就记一次时间。这样能看到每一步的时间,不只是平均值。

```python
from transformers import TextIteratorStreamer
from threading import Thread
import time

streamer = TextIteratorStreamer(tokenizer, skip_prompt=True)
kwargs = dict(**inputs, max_new_tokens=64, do_sample=False,
              streamer=streamer, pad_token_id=tokenizer.eos_token_id)

torch.cuda.synchronize()
t0 = time.perf_counter()
Thread(target=model.generate, kwargs=kwargs).start()

stamps = []
for _ in streamer:                 # 每来一个 token 就迭代一次
    stamps.append(time.perf_counter() - t0)

ttft = stamps[0] * 1000
steps = [(b - a) * 1000 for a, b in zip(stamps, stamps[1:])]
print(f"TTFT {ttft:.1f} ms, TPOT median {statistics.median(steps):.2f} ms")
print("前 8 步:", [f"{s:.1f}" for s in steps[:8]])
```

注意这里用的是 `time.perf_counter`,不是 CUDA event。因为 streamer 收到 token 的时刻就是 token 已经拷回 CPU 的时刻,这本身就是一个同步点,不需要额外 sync。它测到的是「用户能看到这个 token」的时间,比方法一多算了 token 解码成文字的开销,更接近真实服务的体验。但它只能看每步的总时间,分不清 GPU 花了多少、CPU 花了多少,那是 Day 10 profiler 的活。

streamer 的好处是能看到时间序列。前几步会不会偏慢?中间有没有突然一步特别长(Colab 上偶尔有,CPU 被别的东西抢了)?这些平均值里看不出来。

### 方法三:手写 decode 循环,每步单独计时

绕开 `generate`,自己写循环:prefill 一次,然后每步用上一步的 token 和 KV cache 算下一个。这是最精确的测法,因为每步的边界都在自己手里,也是 Day 10 抓 profiler 要用的形式。

```python
@torch.no_grad()
def manual_decode(model, input_ids, n_new=64):
    start = torch.cuda.Event(enable_timing=True); end = torch.cuda.Event(enable_timing=True)

    # prefill:整段 prompt 一起算
    start.record()
    out = model(input_ids=input_ids, use_cache=True)
    next_tok = out.logits[:, -1].argmax(-1, keepdim=True)
    end.record(); torch.cuda.synchronize()
    ttft = start.elapsed_time(end)

    past = out.past_key_values
    step_ms = []
    for _ in range(n_new - 1):
        start.record()
        out = model(input_ids=next_tok, past_key_values=past, use_cache=True)
        next_tok = out.logits[:, -1].argmax(-1, keepdim=True)
        past = out.past_key_values
        end.record(); torch.cuda.synchronize()
        step_ms.append(start.elapsed_time(end))
    return ttft, step_ms

for _ in range(3):                       # warmup
    manual_decode(model, inputs["input_ids"], 8)

ttft, steps = manual_decode(model, inputs["input_ids"], 64)
print(f"TTFT {ttft:.1f} ms")
print(f"TPOT median {statistics.median(steps):.2f} ms, "
      f"min {min(steps):.2f}, max {max(steps):.2f}")
```

这个版本每步都 sync 一次,sync 本身有几十微秒的开销,会让 TPOT 略偏大。但它换来的是每一步的干净数据,而且和 `generate` 内部做的事几乎一样(`generate` 本质上就是这个循环加上采样和停止条件)。三种方法测出来的 TPOT 应该在同一个范围内,差个 10% 到 20% 正常;差一倍就要回头查是不是哪一个漏了 sync 或者没 warmup。

## 整周真正的产出:一个比值

三个数都有了之后,算这个:

```
比值 = 实测 TPOT ÷ 理论下限(6.9 ms)
```

W2 路线图说过,这一周真正的产出不是「学会用 profiler」,是这个比值。它回答的问题是:**W1 那张纸上算的表,能不能拿来预测真实机器**。

比值落在不同区间,说的是不同的事:

| 比值 | 意思 | 下一步 |
| --- | --- | --- |
| 1.0–1.5 | 几乎打到带宽上限。HF eager 模式在 T4 上不太可能做到,如果测出来是这个数,先怀疑计时漏了 sync | 复查 Day 8 的三条 |
| 1.5–3 | memory-bound 的判断成立,GPU 大部分时间确实在搬权重,剩下的是 kernel 效率和少量框架开销 | W1 的表可以信,后面拿它做估算 |
| 3–6 | 有一块明显的时间不在搬权重上。1B 模型在 T4 上每步只有 6.9 ms 的 GPU 活,但 HF 的 Python 循环每步要发几十到上百个 kernel,CPU 端的开销开始和 GPU 时间一个量级 | Day 11 在 timeline 上找 gap |
| > 6 | overhead 主导。GPU 大部分时间在等 CPU 发指令,这时候瓶颈已经不是带宽,Day 1 三分法里的第三种 | 缩小 gap 的两条路,Day 11 讲 |

对 TinyLlama 这种小模型,比值偏大是正常的,甚至是预期的。原因是模型越小,每步 GPU 的活越少,但每步要发的 kernel 数量不变(22 层,每层十几个 kernel),固定的 CPU 开销占比就越高。同样的 HF 代码换成 7B 模型在 A100 上跑,每步 GPU 活是 6.6 ms 但 kernel 数量差不多,比值反而会更接近 1.5 到 3。**比值大不一定是卡慢,可能是活太少**。这是今天最容易得出错误结论的地方。

写下我在跑之前的预期,以后对照:Colab 的 CPU 不快,HF eager 每步 decode 大概会在 15 到 30 ms 之间,比值在 2 到 4。这个预期的依据是每步几十个 kernel、每个 launch 5 到 10 微秒的量级,再加 Python 层的逻辑,总 CPU 开销大约 5 到 15 ms,和 6.9 ms 的 GPU 时间相加。如果实测比这个还大,先查 Day 8 的三条(sync、warmup、中位数),再去 Day 11。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="三根横条对比:理论下限 6.9 ms、算力时间 0.03 ms、预期实测 15 到 30 ms 由 GPU 段和 CPU 开销段拼成">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
<text x="20" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">一步 decode 的时间从哪来(T4 · TinyLlama-1.1B · batch 1)</text>
<text x="20" y="66" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">算力需要</text>
<rect x="150" y="54" width="2" height="18" fill="var(--compute)"/>
<text x="160" y="68" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">0.034 ms(2.2 GFLOP ÷ 65 TFLOP/s)</text>
<text x="20" y="106" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">搬权重需要</text>
<rect x="150" y="94" width="110" height="18" fill="var(--mem)"/>
<text x="268" y="108" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">6.9 ms(2.2 GB ÷ 320 GB/s)= 理论下限</text>
<text x="20" y="146" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">预期实测</text>
<rect x="150" y="134" width="110" height="18" fill="var(--mem)"/>
<rect x="260" y="134" width="40" height="18" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1"/>
<rect x="300" y="134" width="180" height="18" fill="var(--rule)"/>
<text x="488" y="148" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">15–30 ms,比值 2–4</text>
<text x="150" y="176" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">搬权重</text>
<text x="262" y="176" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">kernel 效率损失</text>
<text x="360" y="176" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">CPU 发 kernel、Python 逻辑(gap)</text>
<text x="20" y="212" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">第三行是跑之前写下的预期,不是实测。实测填进下面的记录表。</text>
</svg>
<figcaption>一步 decode 的时间账。算力那一条细到几乎看不见,搬权重那一条是物理下限,预期实测比下限多出来的部分主要是 CPU 端开销。比值就是第三条和第二条的长度比。</figcaption>
</figure>

## 记录表

跑完填这张表。三种方法都测,互相校验。

| 项 | 值 | 备注 |
| --- | --- | --- |
| 卡型号(`nvidia-smi`) | | Colab 可能换卡,每次记 |
| 模型 / dtype | TinyLlama-1.1B / fp16 | |
| prompt token 数 | | `inputs['input_ids'].shape[1]` |
| 生成 token 数 N | 64 | |
| TTFT,方法一 | ms | 两次 generate 相减 |
| TTFT,方法三 | ms | 手写循环 |
| TPOT 中位数,方法一 | ms | |
| TPOT 中位数,方法二 | ms | streamer |
| TPOT 中位数,方法三 | ms | 手写循环 |
| TPOT min / max,方法三 | ms | 看抖动 |
| 理论下限 | 6.9 ms | 2.2 GB ÷ 320 GB/s |
| **比值 = TPOT ÷ 6.9** | | 整周的产出 |
| tok/s = 1000 ÷ TPOT | | 对比上限 145 |
| TTFT ÷ TPOT | | 预期 2 到 5 倍 |

最后一行是个副产品。TTFT 和 TPOT 的理论下限差不多都是 7 ms,实测 TTFT 却会明显大于 TPOT。这个倍数说的是「prefill 那几个大矩阵乘和 attention 在 T4 上的效率有多低」,W3 会专门测。

## 顺手算三个变化

有了公式,几个常见问题不用跑就能回答。

**prompt 从 200 变到 2000,哪个数变?** TPOT 几乎不变:权重还是 2.2 GB,KV cache 从 4.5 MB 涨到 45 MB,仍然是权重的 2%。TTFT 大约涨 10 倍:运算量线性涨到 4.4 TFLOP,68 ms 起,而且 attention 的 n² 项从 200² 涨到 2000²,涨 100 倍,这部分在 T4 上没有 FlashAttention 兜底,实测涨幅可能超过 10 倍。

**换成 Qwen2.5-0.5B,TPOT 下限是多少?** 0.5B × 2 bytes ≈ 1 GB,1 ÷ 320 ≈ 3.1 ms。模型减半,下限减半。但 kernel 数量差不多(24 层),CPU 开销不变,所以实测 TPOT 不会减半,比值会更大。这是「模型越小比值越大」的一个现成检验,有空可以跑一下。

**同一个 TinyLlama 搬到 A100 上呢?** 2.2 GB ÷ 2039 GB/s ≈ 1.1 ms。下限缩 6 倍,但如果 CPU 开销还是 10 ms 量级,实测 TPOT 大概只从 20 ms 降到 12 ms,比值飙到 10 以上。换更快的卡对 overhead-bound 的程序几乎没用,这是 Day 1 三分法的直接推论,Day 11 会在 timeline 上看到它。

## batch 从 1 变到 8,两个数各怎么动

W3 的 Day 16 要把 batch 从 1 扫到 128,今天先用公式预演一下 batch 8,知道该期待什么形状。

把同一段 200 token 的 prompt 复制 8 份一起送进去。decode 每步搬的权重还是 2.2 GB,只搬一次,8 个序列共用;算力从 2.2 GFLOP 变成 17.6 GFLOP,在 T4 上要 0.27 ms,仍然远小于 6.9 ms 的搬运时间。KV cache 读取涨 8 倍,到 48 MB,仍是权重的 2%。所以 **TPOT 的下限几乎不变,还是 6.9 ms**,但这一步产出了 8 个 token,吞吐上限从 145 变成 1160 tok/s。这就是 Day 5 讲的「加 batch 几乎不加时间」在 T4 上的具体数字。

TTFT 就不一样了。prefill 的运算量是 2 × 1.1e9 × 200 × 8 = 3.5 TFLOP,T4 全速要 54 ms,比 batch 1 的 6.8 ms 多 8 倍。prefill 本来就压在 ridge point 上,batch 一开,强度变成 1600,彻底进入 compute-bound,时间随 batch 线性涨。所以 **batch 让 TPOT 免费、让 TTFT 按倍数付钱**。推理服务里「首字慢、后面快」的体感,一半来自这里。

顺手一算就知道 batch 加到多大 TPOT 才开始涨:算的时间追上搬的时间,即 0.034 ms × batch = 6.9 ms,batch ≈ 203。正好是 T4 的 ridge point,和 Day 5 在 A100 上算出 153 是同一件事。但 Day 16 实测时转折点大概率会早于 203,原因有三个,那天再拆:显存装不下那么大的 batch、kernel 在小 batch 下效率不足、CPU 开销在 GPU 时间变长后占比变化。今天只要记住预期形状:**TPOT 在 batch 1 到几十之间几乎是平的,TTFT 从第一步就线性涨**。

代码上,batch 8 只是把 `inputs` 换成 8 份一样的 prompt:

```python
prompts = [prompt] * 8
inputs8 = tokenizer(prompts, return_tensors="pt", padding=True).to("cuda")
ttft8, steps8 = manual_decode(model, inputs8["input_ids"], 64)
print(f"batch 8: TTFT {ttft8:.1f} ms, TPOT {statistics.median(steps8):.2f} ms, "
      f"吞吐 {8 * 1000 / statistics.median(steps8):.0f} tok/s")
```

同一段 prompt 复制 8 份是为了让 8 个序列长度一致,不用处理 padding 和 attention mask 的差异。真实服务里请求长短不一,那正是 M2 的 continuous batching 要解决的事,今天不碰。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| TTFT | time to first token,从请求发出到第一个新 token 出来的时间,约等于 prefill 时间加一次采样 |
| TPOT | time per output token,首 token 之后平均每多生成一个 token 的时间,等于一步 decode 的时间 |
| ITL | inter-token latency,和 TPOT 同义,有的 benchmark 用这个词 |
| 端到端延迟 | 从请求到最后一个 token,= TTFT + (N − 1) × TPOT |
| 吞吐 | 每秒生成的 token 数,batch 1 时 = 1000 ÷ TPOT(ms) |
| prefill | 把整段 prompt 一次过完模型,产出第一个 token 和整段的 KV cache |
| decode | 每步只算一个新 token,查 KV cache 拿前文 |
| 贪心解码 | `do_sample=False`,每步取概率最大的 token,结果确定,时间可比 |
| streamer | transformers 里 `generate` 每产出一个 token 就往外推的机制,`TextIteratorStreamer` 是可迭代的版本 |
| `past_key_values` | HF 里 KV cache 的名字,手写 decode 循环时每步传进去再接回来 |
| CUDA event | GPU 时间线上的标记,`record()` 打点,`elapsed_time()` 算两点之间的 GPU 时间 |
| GQA | grouped-query attention,多个 q 头共享一组 k、v 头。TinyLlama 是 32 个 q 头共享 4 个 KV 头 |
| ridge point | 卡的算力 ÷ 带宽。T4 是 65e12 ÷ 320e9 ≈ 203 FLOP/byte |

## 常见误区

**拿总耗时除以 token 数当 TPOT**。这样算出来的数包含了 TTFT 那一大块,N 越小被拉得越高。N = 8 时 TTFT 占比可能有一半,算出来的「平均每 token」比真 TPOT 大 50%,换个 N 数字就变。TTFT 和 TPOT 必须分开报。

**看到比值是 3 就说「T4 带宽只用了三分之一」**。比值大的原因可能是 GPU 在等 CPU,不是带宽没用满。带宽利用率要看 GPU 真正在跑 kernel 的那段时间里搬了多少字节,而不是整步的墙钟时间。Day 10 的 profiler 能把这两段拆开。

**以为 GQA 会让 decode 明显变快**。batch 1、序列 2048 以内,KV cache 是权重的 2% 以下,把它压小 8 倍对 TPOT 的影响不到 2%。GQA 的收益是显存,是让 batch 能开更大,间接提高吞吐,不是直接降低单步延迟。

**把 prefill 一律当 compute-bound**。prompt 短的时候不是。T4 上 200 个 token 正好压在 ridge point 上,几十个 token 的 prompt 和 decode 一样卡带宽。要不要算强度,取决于 prompt 长度乘 2 和 ridge point 谁大。

**streamer 测出的 TPOT 和 CUDA event 测出的差 20% 就慌**。streamer 多算了 token 解码成文字、线程切换、Python 迭代的时间,它测的是用户体感。两种方法量的东西不完全一样,差 10% 到 20% 是正常的;差一倍才是有一边测错了。

**忘了 Colab 会换卡**。今天分到 T4,明天可能是别的。所有理论下限都按 320 GB/s 算,如果卡换了,下限要重算,不然比值毫无意义。每次跑之前 `nvidia-smi` 先记卡型号。

## 参考资料

文章

- Transformer Inference Arithmetic,Kipply。把 prefill、decode、KV cache 的算式全算了一遍,今天的下限算法和它同一个口径,拿来对账。https://kipp.ly/transformer-inference-arithmetic/
- Mastering LLM Techniques: Inference Optimization,NVIDIA 技术博客。TTFT/TPOT 的定义、prefill 与 decode 为什么性格不同,官方口径。https://developer.nvidia.com/blog/mastering-llm-techniques-inference-optimization/
- LLM Inference Performance Engineering: Best Practices,Databricks。讲怎么正确 benchmark 推理延迟,TTFT、TPOT、吞吐三者的取舍。https://www.databricks.com/blog/llm-inference-performance-engineering-best-practices
- Making Deep Learning Go Brrrr From First Principles,Horace He。比值大于 6 的那种情况,回去重读 overhead 那一节。https://horace.io/brrr_intro.html

文档与代码

- TinyLlama 模型卡与仓库。22 层、d 2048、4 个 KV 头这些数的出处,算下限前先核对 config。https://huggingface.co/TinyLlama/TinyLlama-1.1B-Chat-v1.0 、 https://github.com/jzhang38/TinyLlama
- transformers 文档,Generation utilities。`TextIteratorStreamer` 和 `generate` 的参数。https://huggingface.co/docs/transformers/main/en/internal/generation_utils
- transformers 文档,Text generation。`do_sample`、`max_new_tokens`、`pad_token_id` 这些参数的说明。https://huggingface.co/docs/transformers/main/en/main_classes/text_generation
- NVIDIA T4 产品页与规格表。320 GB/s、65 TFLOP/s fp16 的出处。https://www.nvidia.com/en-us/data-center/tesla-t4/

视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/-uSWCo11x0Q" title="Prefill vs Decode" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>SambaNova · Prefill vs Decode。几分钟讲清两个阶段为什么一个吃算力一个吃带宽,配今天第一张图看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/3SBUCJzogj4" title="AI Optimization Lecture 01 - Prefill vs Decode - Mastering LLM Techniques from NVIDIA" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Faradawn Yang · AI Optimization Lecture 01 - Prefill vs Decode。逐段讲上面那篇 NVIDIA 博客,适合读完文章再听一遍。</figcaption>
</figure>

## 自测

合上笔记做。

1. TinyLlama-1.1B fp16 在 T4 上,batch 1 的 TPOT 理论下限是多少?写出算式。为什么算力那部分可以忽略?

<details><summary>答案</summary>

权重 1.1e9 × 2 bytes = 2.2 GB,除以带宽 320 GB/s ≈ 6.9 ms,约 145 tok/s。算力需要 2 × 1.1e9 = 2.2 GFLOP,除以 65 TFLOP/s ≈ 0.034 ms,是搬运时间的两百分之一,完全藏在搬运时间里。

</details>

2. 为什么 TTFT 和 TPOT 必须分开测?说出两个理由。

<details><summary>答案</summary>

一,它们卡在不同地方:prefill 卡算力,decode 卡带宽,合在一起的平均值谁也不代表,不知道该往哪边优化。二,总耗时 = TTFT + (N − 1) × TPOT,换 prompt 长度或换 N 数字就变,分开报才能跨实验比较。

</details>

3. 200 个 token 的 prompt 在 T4 上做 prefill,算术强度是多少?落在 roofline 哪一侧?

<details><summary>答案</summary>

每个参数搬 2 字节,做 2 × 200 = 400 次运算,强度 200 FLOP/byte。T4 的 ridge point 是 65e12 ÷ 320e9 ≈ 203,200 正好压在线上,算力和带宽同时忙满。prompt 更长就 compute-bound,更短就 memory-bound。

</details>

4. 实测 TPOT 是理论下限的 4 倍,能不能说「带宽只用了 25%」?为什么?

<details><summary>答案</summary>

不能。比值大可能是 GPU 在等 CPU 发 kernel(overhead),不是搬运本身慢。带宽利用率要看 GPU 真正跑 kernel 那段时间里搬了多少字节。小模型每步 GPU 活少但 kernel 数量不减,CPU 开销占比天然高,比值大不一定是卡慢。要拆开 GPU 时间和 CPU 时间得用 profiler。

</details>

5. TinyLlama 用 GQA 把 KV cache 压小了 8 倍,这对 batch 1、序列 2048 以内的 TPOT 有多大影响?

<details><summary>答案</summary>

几乎没有。每 token KV cache 22.5 KB,2048 个 token 才 46 MB,是 2.2 GB 权重的 2%。压小 8 倍省下的不到 2%。GQA 的收益是显存,让 batch 能开更大、序列能更长,收益在 M2 的 batching 实验里才兑现。

</details>

6. 同一段代码、同一个 TinyLlama,从 T4 换到 A100,TPOT 下限变多少?实测大概会怎样?

<details><summary>答案</summary>

下限从 6.9 ms 变成 2.2 GB ÷ 2039 GB/s ≈ 1.1 ms,缩 6 倍。但如果每步 CPU 开销仍是 10 ms 量级,实测只会从大约 20 ms 降到 12 ms 左右,比值从 3 变成 10 以上。换快卡对 overhead-bound 的程序帮助很小,这是三分法的直接推论。

</details>

## 明天预告

Day 10 用 `torch.profiler` 抓一次 generate,导出 chrome trace,在 Perfetto 里打开。目标是把今天那个比值拆开:一步 decode 的 20 多毫秒里,GPU 真正在跑 kernel 的有多少毫秒,是哪几个 kernel,各自对应模型的哪一部分。验收标准是列出 top 5 耗时 kernel,并说出每个是在算注意力、算 FFN、还是在做 layernorm。
