---
title: 'Day 11 · timeline 上的 gap:overhead-bound 的实物证据'
description: 'Day 1 读到的第三种瓶颈 overhead-bound，今天在 Perfetto 的 timeline 上亲眼看到它：GPU 那一行的空白。算清 decode 一步为什么有三百个小 kernel、CPU 为什么发不过来，再看加大 batch 时空白怎么缩，以及两种真正的治法。'
pubDate: 2026-09-09
regime: none
tags: ['profiler', 'overhead', 'cuda-graphs', 'torch-compile', 'perfetto', 'aiinfra-365']
series: 'aiinfra-365'
day: 11
lang: 'zh'
---

## 今天要解决的问题

Day 1 读 Brrrr 的时候,三种瓶颈里 compute-bound 和 memory-bound 都在 Day 5 变成了数字:ridge point 153,decode batch 1 算术强度 1。第三种 overhead-bound 一直是一句话:「GPU 在等 CPU 发指令」。今天把它变成一张能截图的东西。

具体要做到三件事:

1. 在 Day 10 抓的 trace 里,找到 GPU 那一行上 kernel 和 kernel 之间的空白,说出空白那一段 CPU 在干什么。
2. 算出这段空白占整个 decode 步的百分比,并解释为什么 TinyLlama 这种 1B 级模型在 HF transformers 的默认写法下,空白会这么多。
3. 把 batch 从 1 加到 32 再抓一次,看空白占比怎么变,并从原理上说清为什么会这样变。

最后回答路线图 W2 D4 的验收题:截图标出一个 gap,解释它是什么,以及有哪两种办法让它变小。

今天的数字口径沿用整周的:Colab 免费 T4,带宽 320 GB/s;模型 TinyLlama-1.1B,22 层、d = 2048、fp16 权重约 2.2 GB。所有「跑出来」的数字我现在都还没有真实实测,文中写的是按规格推出来的预期区间,文末有记录表等以后填。

## gap 是什么:GPU 那一行的空白

先把 Day 8 讲过的模型再画一次。CPU 和 GPU 是两个独立的执行者。CPU 跑 Python,每遇到一个算子(比如 `torch.matmul`)就走一遍 PyTorch 的 dispatcher,最后调 `cudaLaunchKernel` 把一个 kernel 丢进 GPU 的队列(stream)里,然后**不等结果**,立刻去处理下一行 Python。GPU 从队列里按顺序取 kernel 执行。

这个模型里有两个速度:CPU 往队列里放 kernel 的速度,和 GPU 从队列里消化 kernel 的速度。

- 如果 GPU 消化得慢、CPU 放得快,队列里总有存货,GPU 一个接一个不停,timeline 上 GPU 那一行是连续的色块。这时候瓶颈在 GPU 自己,要么算力要么带宽,就是前两种 bound。
- 如果 CPU 放得慢、GPU 消化得快,GPU 做完一个 kernel 发现队列空了,只能等。等的那段时间 timeline 上是空白。**这个空白就是 gap,它就是 overhead-bound 的实物。**

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="CPU 发射 kernel 与 GPU 执行的时间线,GPU 行上出现空白 gap">
<text x="10" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">时间 →</text>
<line x1="60" y1="30" x2="630" y2="30" stroke="var(--rule)" stroke-width="1"/>
<text x="10" y="72" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">CPU</text>
<g fill="var(--rule)" stroke="var(--ink-faint)" stroke-width="1">
<rect x="70" y="52" width="40" height="26"/>
<rect x="116" y="52" width="40" height="26"/>
<rect x="162" y="52" width="40" height="26"/>
<rect x="208" y="52" width="40" height="26"/>
<rect x="254" y="52" width="40" height="26"/>
<rect x="300" y="52" width="40" height="26"/>
<rect x="346" y="52" width="40" height="26"/>
<rect x="392" y="52" width="40" height="26"/>
<rect x="438" y="52" width="40" height="26"/>
<rect x="484" y="52" width="40" height="26"/>
<rect x="530" y="52" width="40" height="26"/>
</g>
<g font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">
<text x="90" y="69">发 k1</text><text x="136" y="69">发 k2</text><text x="182" y="69">发 k3</text><text x="228" y="69">发 k4</text><text x="274" y="69">发 k5</text><text x="320" y="69">发 k6</text><text x="366" y="69">发 k7</text><text x="412" y="69">发 k8</text><text x="458" y="69">发 k9</text><text x="504" y="69">发 k10</text><text x="550" y="69">发 k11</text>
</g>
<text x="70" y="98" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">每发一个 ≈ 30–50 µs:Python → dispatcher → cudaLaunchKernel</text>
<text x="10" y="152" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">GPU</text>
<g fill="var(--rule-soft)" stroke="var(--ink-faint)" stroke-width="1" stroke-dasharray="3 3">
<rect x="134" y="132" width="24" height="26"/>
<rect x="180" y="132" width="24" height="26"/>
<rect x="226" y="132" width="24" height="26"/>
<rect x="272" y="132" width="24" height="26"/>
<rect x="318" y="132" width="24" height="26"/>
<rect x="364" y="132" width="24" height="26"/>
<rect x="410" y="132" width="24" height="26"/>
<rect x="456" y="132" width="24" height="26"/>
<rect x="502" y="132" width="24" height="26"/>
<rect x="548" y="132" width="24" height="26"/>
</g>
<g fill="var(--mem)" stroke="var(--mem)" stroke-width="1">
<rect x="112" y="132" width="22" height="26"/>
<rect x="158" y="132" width="22" height="26"/>
<rect x="204" y="132" width="22" height="26"/>
<rect x="250" y="132" width="22" height="26"/>
<rect x="296" y="132" width="22" height="26"/>
<rect x="342" y="132" width="22" height="26"/>
<rect x="388" y="132" width="22" height="26"/>
<rect x="434" y="132" width="22" height="26"/>
<rect x="480" y="132" width="22" height="26"/>
<rect x="526" y="132" width="22" height="26"/>
<rect x="572" y="132" width="22" height="26"/>
</g>
<g font-family="var(--font-mono)" font-size="10" fill="var(--paper-raised)" text-anchor="middle">
<text x="123" y="149">k1</text><text x="169" y="149">k2</text><text x="215" y="149">k3</text><text x="261" y="149">k4</text><text x="307" y="149">k5</text><text x="353" y="149">k6</text><text x="399" y="149">k7</text><text x="445" y="149">k8</text><text x="491" y="149">k9</text><text x="537" y="149">k10</text><text x="583" y="149">k11</text>
</g>
<text x="146" y="176" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)" text-anchor="middle">gap</text>
<text x="70" y="198" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">实线块 = kernel 在跑(≈ 20 µs);虚线块 = GPU 空转等下一个 kernel。GPU 忙碌不到一半。</text>
</svg>
<figcaption>gap 出现的全部原因:CPU 发一个 kernel 要 30 到 50 µs,GPU 做完一个只要 20 µs。GPU 做完了,队列里还没有下一个,只能等。</figcaption>
</figure>

图里那些「发 kN」的灰块是 CPU 侧的成本。它包括三层:Python 解释器执行 `hidden = self.q_proj(hidden)` 这一行;PyTorch 的 dispatcher 根据 tensor 的 dtype、device 找到对应的 CUDA 实现,做形状检查、分配输出 tensor;最后调 CUDA driver 的 `cudaLaunchKernel`,把 kernel 排进 stream。这三层加起来在 HF transformers 的 eager 模式下一般是几十微秒一个算子。这是经验量级,不同 CPU、不同 PyTorch 版本差一倍很正常,但不会差到一个数量级。

而 GPU 侧一个 kernel 要多久,取决于它干多少活。这就是下一节要算的。

## decode 一步到底有多少个 kernel

Day 10 看 `key_averages()` 的时候,可能已经注意到一步 decode 里 kernel 数量多得离谱。这里把它数一遍,顺便算出每个 kernel 在 GPU 上大概要多久。

TinyLlama 一层的前向,按 HF 的 Llama 实现,大致会发出这些 kernel:

| 步骤 | 算子 | 参与的权重 | fp16 字节数 | batch 1 时 GPU 时间下限(÷ 320 GB/s) |
| --- | --- | --- | --- | --- |
| 输入 RMSNorm | rmsnorm(或 pow/mean/rsqrt/mul 拆成几个) | 2048 个缩放参数 | 4 KB | 几乎为零,只剩 kernel 固定开销 ≈ 3–5 µs |
| q 投影 | matmul | 2048 × 2048 | 8.4 MB | 26 µs |
| k 投影 | matmul | 2048 × 256(GQA,4 个 KV 头 × 64) | 1.0 MB | 3 µs |
| v 投影 | matmul | 2048 × 256 | 1.0 MB | 3 µs |
| 旋转位置编码 | 几个 elementwise | 无 | 0 | 固定开销 ≈ 3–5 µs,可能拆成 3–4 个 kernel |
| attention | sdpa 或 flash kernel | 无,读 KV cache | 序列 100 时约 2 MB | 5–10 µs |
| o 投影 | matmul | 2048 × 2048 | 8.4 MB | 26 µs |
| 残差加 | add | 无 | 0 | 固定开销 |
| 后 RMSNorm | rmsnorm | 4 KB | 4 KB | 固定开销 |
| gate 投影 | matmul | 2048 × 5632 | 23 MB | 72 µs |
| up 投影 | matmul | 2048 × 5632 | 23 MB | 72 µs |
| SiLU 和逐元素乘 | silu、mul | 无 | 0 | 固定开销,1–2 个 kernel |
| down 投影 | matmul | 5632 × 2048 | 23 MB | 72 µs |
| 残差加 | add | 无 | 0 | 固定开销 |

一层大约 14 到 18 个 kernel,取决于 RMSNorm 和旋转编码有没有被融合。其中 7 个矩阵乘法是真在搬权重,加起来 88 MB,按 320 GB/s 算是 275 µs。剩下的 elementwise kernel 每个只处理 2048 或 5632 个数,数据量是 KB 级,GPU 实际干活的时间不到 1 µs,但一个 kernel 从被调度到结束有固定的几微秒开销,所以每个还是要占 3 到 5 µs。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="TinyLlama 一层 decode 的 kernel 分解条,再乘以 22 层">
<text x="10" y="20" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一层 decode(batch 1)发出的 kernel,按 GPU 时间下限画宽</text>
<g stroke="var(--paper-raised)" stroke-width="1">
<rect x="40" y="36" width="10" height="30" fill="var(--rule)"/>
<rect x="50" y="36" width="52" height="30" fill="var(--mem)"/>
<rect x="102" y="36" width="8" height="30" fill="var(--mem)"/>
<rect x="110" y="36" width="8" height="30" fill="var(--mem)"/>
<rect x="118" y="36" width="10" height="30" fill="var(--rule)"/>
<rect x="128" y="36" width="10" height="30" fill="var(--rule)"/>
<rect x="138" y="36" width="10" height="30" fill="var(--rule)"/>
<rect x="148" y="36" width="16" height="30" fill="var(--ink-soft)"/>
<rect x="164" y="36" width="52" height="30" fill="var(--mem)"/>
<rect x="216" y="36" width="10" height="30" fill="var(--rule)"/>
<rect x="226" y="36" width="10" height="30" fill="var(--rule)"/>
<rect x="236" y="36" width="144" height="30" fill="var(--mem)"/>
<rect x="380" y="36" width="144" height="30" fill="var(--mem)"/>
<rect x="524" y="36" width="10" height="30" fill="var(--rule)"/>
<rect x="534" y="36" width="10" height="30" fill="var(--rule)"/>
</g>
<rect x="544" y="36" width="60" height="30" fill="var(--mem)" opacity="0.35"/>
<text x="574" y="56" font-family="var(--font-mono)" font-size="10" fill="var(--ink)" text-anchor="middle">down…</text>
<g font-family="var(--font-mono)" font-size="9" fill="var(--paper-raised)" text-anchor="middle">
<text x="76" y="55">q</text><text x="190" y="55">o</text><text x="308" y="55">gate 72 µs</text><text x="452" y="55">up 72 µs</text>
</g>
<g font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">
<text x="40" y="84">norm</text><text x="102" y="84">k v</text><text x="118" y="96">rotary ×3</text><text x="148" y="84">attn</text><text x="216" y="84">add norm</text><text x="524" y="84">silu·mul</text>
</g>
<g font-family="var(--font-mono)" font-size="11">
<rect x="40" y="116" width="14" height="12" fill="var(--mem)"/><text x="60" y="126" fill="var(--ink-soft)">矩阵乘:搬权重,时间 = 字节 ÷ 带宽</text>
<rect x="40" y="136" width="14" height="12" fill="var(--rule)"/><text x="60" y="146" fill="var(--ink-soft)">elementwise / norm:数据几 KB,只剩 3–5 µs 固定开销</text>
<rect x="40" y="156" width="14" height="12" fill="var(--ink-soft)"/><text x="60" y="166" fill="var(--ink-soft)">attention:读 KV cache,序列短时很小</text>
</g>
<text x="40" y="196" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">× 22 层 ≈ 300–400 个 kernel + embedding + lm_head(131 MB,0.4 ms)+ 采样</text>
<text x="40" y="216" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">GPU 侧合计下限 ≈ 6.9 ms(权重 2.2 GB ÷ 320 GB/s)+ 300 × 4 µs 固定开销 ≈ 8 ms</text>
</svg>
<figcaption>一层里真正搬数据的是七个矩阵乘,其余十来个 kernel 各只干几 KB 的活。乘 22 层,一步 decode 有三四百个 kernel,GPU 侧合计约 8 ms。</figcaption>
</figure>

乘 22 层,再加 embedding 查表、最后的 lm_head(2048 × 32000 = 131 MB,0.4 ms)和采样,一步 decode 大约发 **300 到 400 个 kernel**,GPU 侧的时间合计约 8 ms:权重搬运 6.9 ms 是主体,再加三四百个小 kernel 各几微秒的固定开销。

现在把 CPU 侧放进来。300 到 400 个 kernel,每个在 CPU 侧要 30 到 50 µs 才能发出去,合计:

```
350 个 × 40 µs ≈ 14 ms
```

CPU 发完一步要 14 ms,GPU 做完一步只要 8 ms。**CPU 比 GPU 慢,GPU 必然有空等的时候。** 这就是为什么 HF transformers 用默认写法跑 TinyLlama,每步时间会落在 CPU 的 14 ms 附近而不是 GPU 的 8 ms 附近,换算成吞吐是 70 tok/s 上下,而不是理论下限的 145 tok/s。Day 9 那个「实测 TPOT ÷ 理论下限」的比值,在这套预期里大约是 2。这个 2 倍差距,主要不是带宽没用满,是 GPU 在等。

这几个数都是估算:每个算子几十微秒的 CPU 成本是经验值,Colab 分到的 CPU 很弱,可能更慢。但结构性的结论不依赖精确数字:**只要单个 kernel 的 GPU 时间和 CPU 发射时间在同一量级,gap 就会出现;kernel 越小、越多,gap 越大。** 1B 级模型在 T4 上正好撞在这个区间里。

## 在 Perfetto 里找 gap

打开 Day 10 导出的 `trace_batch1.json`,在 ui.perfetto.dev 里加载。找 gap 的步骤:

1. **找到 GPU 的那一行**。trace 里名字通常带 `stream 7` 或 `GPU 0`,是那一行色块最密的轨道。CPU 侧的 Python 线程在上面,名字是 `python` 加线程号。
2. **放大到一层的范围**。用 W 键放大,S 键缩小,A/D 左右移。目标是屏幕上能看到大约 15 到 20 个 kernel,也就是一层的量。
3. **看 kernel 之间**。matmul 的色块明显比别的宽,两个 matmul 之间夹着一串窄条(elementwise),窄条和窄条之间如果是背景色,那就是 gap。
4. **量它**。在 GPU 行上按住鼠标从一个 kernel 的右边缘拖到下一个 kernel 的左边缘,底部会显示选区时长。gap 通常是 10 到 40 µs 级。
5. **看同一时刻 CPU 在干什么**。把视线垂直往上移到 Python 线程那一行。gap 对应的时刻,CPU 行上一般是 `aten::linear` 或 `aten::silu` 这类算子块,里面套着 `cudaLaunchKernel`。也就是说,GPU 空着的时候,CPU 正在准备下一个 kernel。这就是「overhead」两个字的实物。
6. **点一个 kernel 块看 flow 箭头**。Perfetto 会画一条线从 CPU 侧的 `cudaLaunchKernel` 连到 GPU 侧对应的 kernel。顺着箭头看,能看到「发」和「跑」之间隔了多久。队列有存货时这条线是斜的(发了很久之后才跑),队列空了时这条线几乎垂直(一发就跑,GPU 一直在等)。

<!-- TODO: 截图 Perfetto 一层范围,GPU 行上标一个 gap 的选区,CPU 行上圈出同时刻的 aten::linear + cudaLaunchKernel -->

截图要拍的就是第 4 和第 5 步:GPU 行一段空白被选中并显示时长,正上方 CPU 行同一时刻的算子块。这一张图就是 W2 D4 的验收物。

## 把 gap 占比算成一个数

看图有直观,但验收要一个数字:整步里 GPU 忙了百分之几。trace 是 JSON,直接算。

```python
# Colab · 读 torch.profiler 导出的 chrome trace,算 GPU 忙碌比例
import json

def gpu_busy_ratio(trace_path):
    with open(trace_path) as f:
        events = json.load(f)["traceEvents"]
    # PyTorch profiler 给 GPU 上的事件打的 cat 是 kernel / gpu_memcpy / gpu_memset
    kernels = [e for e in events
               if e.get("ph") == "X" and e.get("cat") in ("kernel", "gpu_memcpy", "gpu_memset")]
    if not kernels:
        raise ValueError("trace 里没有 GPU 事件,检查 profile 的 activities 是否包含 CUDA")
    intervals = sorted((e["ts"], e["ts"] + e["dur"]) for e in kernels)
    # 多个 stream 并发时区间会重叠,先合并
    merged = []
    for s, t in intervals:
        if merged and s <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], t)
        else:
            merged.append([s, t])
    busy = sum(t - s for s, t in merged)          # 单位 µs
    wall = merged[-1][1] - merged[0][0]
    return busy / wall, busy / 1e3, wall / 1e3     # 比例, 忙碌 ms, 墙钟 ms

ratio, busy_ms, wall_ms = gpu_busy_ratio("trace_batch1.json")
print(f"GPU 忙碌 {busy_ms:.1f} ms / 墙钟 {wall_ms:.1f} ms = {ratio:.1%},gap 占 {1 - ratio:.1%}")
```

「墙钟」取的是第一个 kernel 开始到最后一个 kernel 结束,所以 profiler 启动、模型加载那些不会混进来。如果 trace 里包含了 prefill,prefill 那段 GPU 是满的,会把比例拉高;要只看 decode,可以在 `generate` 时把 `max_new_tokens` 设大一点(比如 64),让 decode 步数压过那一次 prefill,或者用 Day 10 讲的 `schedule` 跳过前几步。

按上一节的估算,batch 1 时预期 GPU 忙碌比例在 **50% 到 65%** 之间,也就是 gap 占三分之一到一半。这是估算,不是实测,真实数字填到文末的表里。

## 加大 batch,再看一次

现在做实验的第二半:同一段代码,batch 从 1 改到 32,再抓一次 trace,再算一次比例。

```python
# Colab · 在 Day 10 的加载代码之后。batch 1 / 8 / 32 各抓一份 trace
import time, torch
from torch.profiler import profile, ProfilerActivity

tok.pad_token = tok.eos_token

def run(batch, new_tokens=64, trace_name=None):
    prompts = ["The roofline model says that"] * batch
    inputs = tok(prompts, return_tensors="pt", padding=True).to("cuda")
    for _ in range(3):                                   # warmup,Day 7 的规矩
        model.generate(**inputs, max_new_tokens=8, do_sample=False)
    torch.cuda.synchronize()
    if trace_name:
        with profile(activities=[ProfilerActivity.CPU, ProfilerActivity.CUDA]) as prof:
            model.generate(**inputs, max_new_tokens=new_tokens, do_sample=False)
            torch.cuda.synchronize()
        prof.export_chrome_trace(trace_name)
    t0 = time.perf_counter()
    model.generate(**inputs, max_new_tokens=new_tokens, do_sample=False)
    torch.cuda.synchronize()                              # Day 8 的规矩
    return (time.perf_counter() - t0) / new_tokens * 1e3  # 每步约多少 ms

for b in (1, 8, 32):
    ms = run(b, trace_name=f"trace_batch{b}.json")
    ratio, busy, wall = gpu_busy_ratio(f"trace_batch{b}.json")
    print(f"batch {b:>2}: {ms:5.1f} ms/step  GPU 忙碌 {ratio:5.1%}  吞吐 ≈ {b / ms * 1e3:6.0f} tok/s")
```

预期会看到两件事同时发生。

**每步时间几乎不变,或只涨一点。** 这是 Day 5 讲过的:权重搬一遍是固定成本,batch 1 和 batch 32 都是 2.2 GB。变的只有 attention(读 32 份 KV cache)和 elementwise(处理 32 倍的数),这两类在 batch 32、短序列时仍然是小头。

**GPU 忙碌比例上升。** 原因不是 CPU 变快了,CPU 发 350 个 kernel 还是 14 ms 左右,batch 大小对 Python 和 dispatcher 的成本几乎没有影响。变的是 GPU 侧每个 kernel 的时间:matmul 不变(还是搬那些权重),但 elementwise 和 attention 从「几 KB 的活」变成「几百 KB 的活」,原本 3 到 5 µs 的固定开销块开始有实际计算填进去。GPU 侧总时间从 8 ms 往 10 到 12 ms 走,越接近 CPU 的 14 ms,gap 就越窄。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="batch 1 与 batch 32 的两条时间线对比:CPU 行相同,GPU 行在 batch 32 时色块变长,空白变少">
<text x="10" y="18" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">batch = 1</text>
<text x="10" y="50" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">CPU</text>
<g fill="var(--rule)" stroke="var(--ink-faint)" stroke-width="1">
<rect x="90" y="32" width="40" height="22"/><rect x="138" y="32" width="40" height="22"/><rect x="186" y="32" width="40" height="22"/><rect x="234" y="32" width="40" height="22"/><rect x="282" y="32" width="40" height="22"/><rect x="330" y="32" width="40" height="22"/><rect x="378" y="32" width="40" height="22"/><rect x="426" y="32" width="40" height="22"/><rect x="474" y="32" width="40" height="22"/><rect x="522" y="32" width="40" height="22"/>
</g>
<text x="10" y="94" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">GPU</text>
<g fill="var(--mem)">
<rect x="132" y="76" width="18" height="22"/><rect x="180" y="76" width="18" height="22"/><rect x="228" y="76" width="18" height="22"/><rect x="276" y="76" width="18" height="22"/><rect x="324" y="76" width="18" height="22"/><rect x="372" y="76" width="18" height="22"/><rect x="420" y="76" width="18" height="22"/><rect x="468" y="76" width="18" height="22"/><rect x="516" y="76" width="18" height="22"/><rect x="564" y="76" width="18" height="22"/>
</g>
<g fill="none" stroke="var(--ink-faint)" stroke-width="1" stroke-dasharray="3 3">
<rect x="150" y="76" width="30" height="22"/><rect x="198" y="76" width="30" height="22"/><rect x="246" y="76" width="30" height="22"/><rect x="294" y="76" width="30" height="22"/><rect x="342" y="76" width="30" height="22"/><rect x="390" y="76" width="30" height="22"/><rect x="438" y="76" width="30" height="22"/><rect x="486" y="76" width="30" height="22"/><rect x="534" y="76" width="30" height="22"/>
</g>
<text x="590" y="94" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">忙 ~40%</text>
<text x="90" y="118" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">虚线 = gap,GPU 等 CPU 发下一个 kernel;每步时间 ≈ CPU 发完的时间</text>
<line x1="10" y1="132" x2="630" y2="132" stroke="var(--rule)" stroke-width="1"/>
<text x="10" y="156" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">batch = 32</text>
<text x="10" y="188" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">CPU</text>
<g fill="var(--rule)" stroke="var(--ink-faint)" stroke-width="1">
<rect x="90" y="170" width="40" height="22"/><rect x="138" y="170" width="40" height="22"/><rect x="186" y="170" width="40" height="22"/><rect x="234" y="170" width="40" height="22"/><rect x="282" y="170" width="40" height="22"/><rect x="330" y="170" width="40" height="22"/><rect x="378" y="170" width="40" height="22"/><rect x="426" y="170" width="40" height="22"/><rect x="474" y="170" width="40" height="22"/><rect x="522" y="170" width="40" height="22"/>
</g>
<text x="10" y="232" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">GPU</text>
<g fill="var(--mem)">
<rect x="132" y="214" width="44" height="22"/><rect x="180" y="214" width="44" height="22"/><rect x="228" y="214" width="44" height="22"/><rect x="276" y="214" width="44" height="22"/><rect x="324" y="214" width="44" height="22"/><rect x="372" y="214" width="44" height="22"/><rect x="420" y="214" width="44" height="22"/><rect x="468" y="214" width="44" height="22"/><rect x="516" y="214" width="44" height="22"/><rect x="564" y="214" width="26" height="22"/>
</g>
<text x="596" y="232" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">忙 ~90%</text>
<text x="90" y="256" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">CPU 行一模一样;GPU 每个 kernel 变长,几乎接上。每步时间只略涨,吞吐涨 ~32 倍。</text>
</svg>
<figcaption>同一段代码,batch 1 和 batch 32。CPU 发 kernel 的成本不随 batch 变,GPU 每个 kernel 干的活变多了,把空白填掉。这就是「让每次 launch 干更多活」。</figcaption>
</figure>

图里两个百分比是示意,不是测出来的。预期的方向是确定的:batch 1 时 GPU 忙碌比例明显低于 batch 32。如果实测发现 batch 32 时比例还是很低、每步时间也没涨,那说明 CPU 侧比估算的更慢,gap 被 CPU 完全主导了,这本身也是一个有价值的发现,写进记录表。

再往上加 batch 会怎样?GPU 侧时间继续涨,某个 batch 之后超过 CPU 的 14 ms,gap 消失,瓶颈从 overhead 换成 GPU 自己。再往上就是 Day 5 讲的沿着 roofline 斜线爬,直到显存放不下 KV cache 或算术强度碰到 ridge point。W3 D4(Day 16)会把这条曲线完整扫一遍。

## 和 Day 1 的三分法接上

Day 1 记的 overhead-bound 判定方法是:**加大 batch 或数据量,总时间几乎不变。** 当时只是一句话,现在有了机制:时间不变是因为时间根本不是 GPU 决定的,是 CPU 发指令的速度决定的,GPU 干多干少都在等。gap 就是这个「等」的可视化。

三种 bound 在 timeline 上的样子也能分开了:

| 瓶颈 | GPU 行 | 加大 batch 后每步时间 | 治法 |
| --- | --- | --- | --- |
| overhead-bound | 色块之间有大量空白 | 几乎不变 | 减少 launch 次数,或让每次 launch 干更多活 |
| memory-bound | 色块连续,matmul 块占主体 | 几乎不变(权重搬一遍是固定成本) | 减少字节(量化)、提高算术强度(batching) |
| compute-bound | 色块连续 | 线性增长 | 提高算力利用率,或换卡 |

注意 overhead-bound 和 memory-bound 都有「加 batch 时间不变」的症状,光看时间分不开,**必须看 GPU 行有没有空白**。这就是为什么 W2 要学 profiler,而不是只靠 Day 8 的计时器。

## 两种让 gap 变小的办法

gap 的根源是 CPU 发一个 kernel 的成本和 GPU 做一个 kernel 的时间在同一量级。所以只有两条路:让 CPU 少发几次,或者让 GPU 每次多干点。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="三种执行方式的 GPU 行对比:eager 每个算子一次 launch、torch.compile 融合后 launch 变少、CUDA graph 一次 replay 全部 kernel 首尾相接">
<g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
<text x="10" y="40">eager</text>
<text x="10" y="54" fill="var(--ink-faint)" font-size="9">每 op 一次 launch</text>
<text x="10" y="112">torch.compile</text>
<text x="10" y="126" fill="var(--ink-faint)" font-size="9">elementwise 融合</text>
<text x="10" y="184">CUDA graph</text>
<text x="10" y="198" fill="var(--ink-faint)" font-size="9">一次 replay</text>
</g>
<g fill="var(--ink-faint)">
<rect x="150" y="18" width="3" height="8"/><rect x="194" y="18" width="3" height="8"/><rect x="238" y="18" width="3" height="8"/><rect x="282" y="18" width="3" height="8"/><rect x="326" y="18" width="3" height="8"/><rect x="370" y="18" width="3" height="8"/><rect x="414" y="18" width="3" height="8"/><rect x="458" y="18" width="3" height="8"/><rect x="502" y="18" width="3" height="8"/><rect x="546" y="18" width="3" height="8"/>
</g>
<text x="596" y="26" font-family="var(--font-mono)" font-size="9" fill="var(--ink-faint)">↑ CPU launch</text>
<g fill="var(--mem)">
<rect x="150" y="30" width="24" height="22"/><rect x="194" y="30" width="24" height="22"/><rect x="238" y="30" width="24" height="22"/><rect x="282" y="30" width="24" height="22"/><rect x="326" y="30" width="24" height="22"/><rect x="370" y="30" width="24" height="22"/><rect x="414" y="30" width="24" height="22"/><rect x="458" y="30" width="24" height="22"/><rect x="502" y="30" width="24" height="22"/><rect x="546" y="30" width="24" height="22"/>
</g>
<text x="578" y="46" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">10 launch</text>
<g fill="var(--ink-faint)">
<rect x="150" y="90" width="3" height="8"/><rect x="230" y="90" width="3" height="8"/><rect x="310" y="90" width="3" height="8"/><rect x="390" y="90" width="3" height="8"/><rect x="470" y="90" width="3" height="8"/>
</g>
<g fill="var(--mem)">
<rect x="150" y="102" width="48" height="22"/><rect x="230" y="102" width="48" height="22"/><rect x="310" y="102" width="48" height="22"/><rect x="390" y="102" width="48" height="22"/><rect x="470" y="102" width="48" height="22"/>
</g>
<text x="530" y="118" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">5 launch,块更宽</text>
<rect x="150" y="162" width="3" height="8" fill="var(--ink-faint)"/>
<g fill="var(--mem)" stroke="var(--paper-raised)" stroke-width="1">
<rect x="150" y="174" width="24" height="22"/><rect x="174" y="174" width="24" height="22"/><rect x="198" y="174" width="24" height="22"/><rect x="222" y="174" width="24" height="22"/><rect x="246" y="174" width="24" height="22"/><rect x="270" y="174" width="24" height="22"/><rect x="294" y="174" width="24" height="22"/><rect x="318" y="174" width="24" height="22"/><rect x="342" y="174" width="24" height="22"/><rect x="366" y="174" width="24" height="22"/>
</g>
<text x="400" y="190" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">1 launch,GPU 首尾相接,同样的活提前做完</text>
<line x1="150" y1="216" x2="570" y2="216" stroke="var(--rule)" stroke-width="1"/>
<text x="150" y="228" font-family="var(--font-mono)" font-size="9" fill="var(--ink-faint)">时间 →(三行同一比例,GPU 每块干的活相同)</text>
</svg>
<figcaption>同样的 GPU 工作量,三种发法。eager 每个算子发一次;编译器把相邻的 elementwise 融成一个 kernel,发的次数少一半;CUDA graph 把整步录下来,CPU 只发一次,GPU 自己按图执行。</figcaption>
</figure>

**办法一:减少 launch 次数。** 有两个层次。

第一层是 kernel fusion。一层里 RMSNorm、旋转编码、SiLU 和乘、残差加这些 elementwise 算子,每个都是读一遍向量、算一下、写回去,数据小到可以忽略,成本全在「发一次」上。把相邻的几个融成一个 kernel,发一次做完,launch 次数直接少一半以上。`torch.compile` 默认的 inductor 后端干的就是这件事,它会把 SiLU 和后面的乘融成一个,把残差加和 RMSNorm 融成一个。这也是 Day 17 会讲的、M5 写 Triton kernel 的主要动机之一:手写 fused kernel 就是手动做 fusion。

第二层是 CUDA graph。decode 每一步做的事情一模一样,只是输入的 token 不同。CUDA 允许把一步里的三四百次 launch **录下来**,存成一张图(graph),以后每步只发一条「replay 这张图」的指令,GPU 自己按图把三四百个 kernel 顺着跑完,中间不再需要 CPU 参与。CPU 侧的成本从 14 ms 变成几十微秒。这是推理引擎的标配:vLLM 在 decode 阶段默认用 CUDA graph,就是为了消掉这块 overhead。

在 HF transformers 里试 CUDA graph 需要两个条件:KV cache 的形状要固定(否则每步的内存地址都变,图录不下来),以及用 `torch.compile` 的 `reduce-overhead` 模式:

```python
# Colab · 在模型加载之后。第一次调用会编译,可能要几分钟;Colab 上版本不一,失败了就记录版本号跳过
model.generation_config.cache_implementation = "static"     # 固定形状的 KV cache
model.forward = torch.compile(model.forward, mode="reduce-overhead", fullgraph=True)

# 编译发生在第一次真正调用时,warmup 至少跑 2 次再计时
for _ in range(2):
    model.generate(**inputs, max_new_tokens=8, do_sample=False)
torch.cuda.synchronize()
```

`reduce-overhead` 就是 CUDA graph 模式的名字,名字本身就在说它治的是哪种 bound。编译成功后再跑一次 batch 1 的 profiler,预期 GPU 行的空白会大幅消失,每步时间从 CPU 主导的 14 ms 附近掉到 GPU 主导的 8 ms 附近。T4 是 Turing 架构(计算能力 7.5),Triton 支持 7.0 以上,所以编译在 T4 上能跑,但第一次编译要几分钟,而且 Colab 的 PyTorch 和 transformers 版本组合不一定兼容 static cache,失败了就把报错和版本号记下来,不是今天的重点。

**办法二:让每次 launch 干更多活。** 就是上一节做的加 batch。launch 次数不变,每个 kernel 处理 32 个 token 而不是 1 个,GPU 侧时间变长,把空白填掉。这也是为什么推理服务里 batching 一举两得:Day 5 讲它把算术强度从 1 往 153 拉,今天看到它同时把 gap 填掉。

两个办法不冲突。生产推理引擎两个都做:CUDA graph 消 CPU 开销,continuous batching 拉 GPU 利用率。这两件事加起来,是 vLLM 比 HF transformers 快好几倍的主要原因,M3 读源码时会一一对上。

## 一个容易搞混的点:util 100% 和 gap 可以同时成立

Day 5 的误区里写过 nvidia-smi 的 GPU util 不等于算力利用率。今天再加一层:util 也不等于「没有 gap」。

nvidia-smi 的采样周期是几百毫秒到一秒,它问的是「这段时间里有没有 kernel 在跑」。decode 一步 14 ms 里 GPU 忙 8 ms,任何一个采样窗口里都有 kernel 跑过,util 显示 100%。而 Perfetto 的 timeline 分辨率是微秒,能看到那 6 ms 的空白。两个工具说的都对,分辩率差了五个数量级。

所以判断 overhead-bound 不能看 nvidia-smi,要看 trace。这是 W2 学 profiler 最直接的回报。

## 记录表

这些都是今天算出来的预期,真实数字跑出来填右边。

| 项 | 预期(按规格估算) | 实测 | 差多少、为什么 |
| --- | --- | --- | --- |
| 一步 decode 的 kernel 数(batch 1) | 300–400 | | |
| GPU 侧总时间(batch 1) | ≈ 8 ms | | |
| 每步墙钟时间(batch 1) | 12–16 ms,CPU 主导 | | |
| GPU 忙碌比例(batch 1) | 50–65% | | |
| 每步墙钟时间(batch 32) | 比 batch 1 略涨 | | |
| GPU 忙碌比例(batch 32) | 明显高于 batch 1 | | |
| 单个 gap 的典型长度 | 10–40 µs | | |
| gap 对应的 CPU 侧算子 | aten::linear / aten::silu 等 + cudaLaunchKernel | | |
| reduce-overhead 编译后每步时间 | 接近 8 ms | | 编译失败则记版本号 |
| 卡型号、PyTorch 版本、transformers 版本 | | | |

## 名词解释

| 名词 | 意思 |
| --- | --- |
| gap | timeline 上 GPU 行两个 kernel 之间的空白,GPU 在等下一个 kernel 被发过来 |
| overhead-bound | 时间被 CPU 侧成本(Python、dispatcher、launch)决定,GPU 有空闲。Day 1 的第三种瓶颈 |
| kernel launch | CPU 通过 CUDA driver 把一个 kernel 排进 GPU 队列的动作,`cudaLaunchKernel`,本身要几微秒,加上 PyTorch 的层层调用是几十微秒 |
| dispatcher | PyTorch 里把 `torch.matmul` 这类调用按 dtype、device 路由到具体实现的那一层,每个算子都要走一遍 |
| stream | GPU 上的一个有序执行队列。默认所有 kernel 排在同一个 stream 里,按顺序执行 |
| kernel fusion | 把几个相邻的小 kernel 合成一个,发一次做完。`torch.compile` 自动做,Triton 手动做 |
| CUDA graph | 把一段 kernel 序列录下来存成图,以后一次 replay 全部执行,CPU 不再逐个发 |
| `torch.compile` reduce-overhead | 用 CUDA graph 的编译模式,专治 overhead-bound |
| static cache | 固定形状的 KV cache,CUDA graph 的前提,因为图里记的是内存地址 |
| flow 箭头 | Perfetto 里从 CPU 侧 launch 连到 GPU 侧 kernel 的线,看它能知道 kernel 发出后等了多久才跑 |
| GPU 忙碌比例 | kernel 总时长(合并重叠)÷ 第一个 kernel 开始到最后一个结束的墙钟时间 |
| eager 模式 | PyTorch 默认的逐行执行方式,每个算子立刻发一个 kernel |

## 常见误区

**看到 nvidia-smi util 100% 就觉得没有 overhead。** util 的采样窗口是几百毫秒,一步里只要有 kernel 跑过就算 100%。gap 是微秒级的东西,只有 trace 看得到。

**把「加 batch 时间不变」直接判成 memory-bound。** overhead-bound 也是这个症状。区别在 GPU 行有没有空白:有空白是 overhead,色块连续、matmul 占主体才是 memory-bound。两个能同时存在,先治 overhead 再看 memory,顺序反了会以为量化没效果。

**以为 gap 是 GPU 慢。** gap 那段 GPU 什么都没做,它在等。慢的是 CPU 那一侧的 Python 和 dispatcher。换更快的 GPU 对 gap 没有任何帮助,gap 还会变宽,因为 GPU 做得更快、等得更久。

**觉得小模型跑得快所以好优化。** 恰恰相反,模型越小、每个 kernel 越短,CPU 发射成本占比越高,越容易 overhead-bound。7B 模型在 A100 上每个 matmul 是几百微秒,CPU 的几十微秒藏得住;1B 模型在 T4 上藏不住。所以 W2 用 TinyLlama 看到的 gap 比例,换成 7B 会小很多,不能直接外推。

**只看 kernel 时长排名找瓶颈。** `key_averages()` 按 CUDA 时间排,排出来的全是 matmul。但如果整步一半时间是 gap,优化 matmul 最多省另外一半的一部分。先算忙碌比例,再决定看 kernel 还是看 CPU。

**把 profiler 自己的开销算进 gap。** profiler 记录每个事件也要 CPU 时间,会把 gap 放大。所以 Day 10 讲的 `schedule` 要用,并且拿 Day 8 不开 profiler 的计时结果做对照:如果开 profiler 的每步时间比不开的长很多,gap 占比要打折看。

## 参考资料

文章

- Making Deep Learning Go Brrrr From First Principles,Horace He。Overhead 那一节今天终于有了图对应,重读一遍。https://horace.io/brrr_intro.html
- CUDA Semantics,PyTorch 官方文档。异步执行、stream、为什么要 synchronize,Day 8 的出处,今天补 stream 那一段。https://pytorch.org/docs/stable/notes/cuda.html
- Accelerating PyTorch with CUDA Graphs,PyTorch 官方博客。CUDA graph 解决什么问题、录图和 replay 的机制,配图很清楚。https://pytorch.org/blog/accelerating-pytorch-with-cuda-graphs/
- Getting Started with CUDA Graphs,NVIDIA 技术博客。从 CUDA 层面讲 graph 的原理和 launch 开销的量级。https://developer.nvidia.com/blog/cuda-graphs/
- CUDAGraph Trees,PyTorch 文档。`torch.compile` 的 reduce-overhead 模式底下是什么,static cache 为什么是前提。https://pytorch.org/docs/stable/torch.compiler_cudagraph_trees.html
- GPU Performance Background,NVIDIA 深度学习性能指南。讲 GPU 执行模型和为什么小 kernel 效率低。https://docs.nvidia.com/deeplearning/performance/dl-performance-gpu-background/index.html
- PyTorch Profiler Recipe,官方教程。`key_averages`、`export_chrome_trace`、schedule 的用法。https://pytorch.org/tutorials/recipes/recipes/profiler_recipe.html
- Perfetto UI,看 trace 用的。https://ui.perfetto.dev

视频

- GPU MODE Lecture 1: How to profile CUDA kernels in PyTorch,Mark Saroufim。整节课就是今天和 Day 10 做的事,重点看用 profiler 找 launch overhead 和看 trace 那一段。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LuhJEEJQgUM" title="Lecture 1 How to profile CUDA kernels in PyTorch" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>GPU MODE · Lecture 1 How to profile CUDA kernels in PyTorch。前半段讲 torch.profiler 和 chrome trace 的读法,中段演示一个小 kernel 的 launch 开销如何盖过计算本身,正是今天的 gap。</figcaption>
</figure>

代码

- vLLM 的 CUDA graph 封装,看生产引擎怎么录图、怎么按 batch 大小分别录。https://github.com/vllm-project/vllm/blob/main/vllm/compilation/cuda_graph.py
- `torch.cuda.CUDAGraph` API 文档,手动录图的最小接口。https://pytorch.org/docs/stable/generated/torch.cuda.CUDAGraph.html
- GPU MODE lectures 仓库,Lecture 1 的 notebook 在里面。https://github.com/gpu-mode/lectures

## 自测

合上笔记做。

1. timeline 上的 gap 是什么?gap 那段时间 GPU 和 CPU 分别在干什么?

<details><summary>答案</summary>

gap 是 GPU 行上两个 kernel 之间的空白。那段时间 GPU 什么都没做,在等队列里出现下一个 kernel;CPU 正在跑 Python、走 dispatcher、调 cudaLaunchKernel 准备下一个 kernel。gap 是 overhead-bound 的直接证据。

</details>

2. TinyLlama 在 T4 上 decode 一步大约发多少个 kernel?为什么 CPU 会发不过来?

<details><summary>答案</summary>

一层 14 到 18 个,22 层加 embedding、lm_head、采样,约 300 到 400 个。每个 kernel CPU 侧要 30 到 50 µs 才能发出去,合计约 14 ms;而 GPU 侧权重搬运 6.9 ms 加小 kernel 固定开销约 8 ms。CPU 比 GPU 慢,GPU 必然等。

</details>

3. batch 从 1 加到 32,CPU 发 kernel 的时间变不变?GPU 忙碌比例为什么会上升?

<details><summary>答案</summary>

CPU 侧几乎不变,Python 和 dispatcher 的成本和 batch 大小无关。GPU 侧 matmul 不变(权重一样),但 elementwise 和 attention 处理的数据变成 32 倍,原来只剩固定开销的小 kernel 开始有真实计算,GPU 总时间变长,更接近 CPU 的时间,空白被填掉,忙碌比例上升。

</details>

4. overhead-bound 和 memory-bound 都有「加 batch 每步时间几乎不变」的症状,怎么分开?

<details><summary>答案</summary>

看 trace 里 GPU 行。有大量空白是 overhead-bound;色块连续、matmul 块占主体是 memory-bound。只靠计时器分不开,必须看 timeline。两者可以同时存在,先消 overhead 再看 memory。

</details>

5. 让 gap 变小的两种办法是什么?各举一个具体手段。

<details><summary>答案</summary>

一是减少 launch 次数:kernel fusion(`torch.compile` 把相邻 elementwise 融成一个)和 CUDA graph(整步录下来一次 replay,`torch.compile` 的 reduce-overhead 模式或 vLLM 默认的 decode 路径)。二是让每次 launch 干更多活:加大 batch,launch 次数不变但每个 kernel 处理更多 token,GPU 侧时间变长填掉空白。

</details>

6. 为什么换一张更快的 GPU 不能解决 gap,甚至会让 gap 更宽?

<details><summary>答案</summary>

gap 的长度由 CPU 发 kernel 的速度决定,和 GPU 无关。更快的 GPU 把每个 kernel 做得更快,等下一个 kernel 的时间反而更长,空白比例更高。治 overhead 要动 CPU 侧(减少 launch)或加大每次的工作量,不是换卡。

</details>

## 明天预告

Day 12 是 W2 的收口:W2 复习:理论 vs 实测对比报告、五道验收题、错题本。把这周的东西压成一页对比报告的模板:W1 算的理论下限、Day 9 的 TTFT 和 TPOT、比值、Day 10 的 top 5 kernel 各对应模型哪部分、今天的 gap 占比。然后合上笔记做路线图 W2 的五道验收题,再把这周的错记进错题本:计时不 synchronize、把 util 100% 当算力用满、T4 上写 bf16 报错、拿 kernel 排名当瓶颈却没先算忙碌比例。最后预告 W3:戳破标称值,自己测出这张卡真实的带宽和算力。
