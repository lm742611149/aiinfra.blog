---
title: 'Day 12 · W2 复习：理论 vs 实测对比报告、五道验收题、错题本'
description: '第一周算账，第二周对账。把 Day 7 到 Day 11 压成一页：计时怎么做才是真的、TTFT 和 TPOT 各自的下限、比值怎么读、profiler 里的 kernel 名怎么对回模型、gap 占比怎么算。然后合上笔记做路线图 W2 的五道验收题，把这周会犯的错一条条摊开。'
pubDate: 2026-09-10
regime: memory
tags: ['review', 'week-2', 'profiler', 'timing', 'aiinfra-365']
series: 'aiinfra-365'
day: 12
lang: 'zh'
---

## 这一周解决了什么

W1 结束时手里是一张纸:Llama-2-7B 在 A100 上 decode 每步 6.6 ms、150 tok/s、ridge point 153。全部是算出来的,没有一个数碰过真机器。W2 的任务是把这张纸和一台真机器放到一起,看它们对不对得上。

机器是 Colab 免费给的 T4,模型换成了 TinyLlama-1.1B。换模型换卡之后 W1 的算法原样重跑了一遍:权重 1.1e9 × 2 = 2.2 GB,带宽 320 GB/s,decode 每步下限 6.9 ms,约 145 tok/s。这是这周所有实测要去比的那根线。

然后五天做了五件事,每一件都是为「实测数字可信」加一道保险:

- **Day 7** 把模型跑起来,搞清第一次为什么慢好几倍,把 10 次运行的极差压到中位数的 10% 以内。不稳定的数字什么都对不了。
- **Day 8** 把计时改对。CPU 和 GPU 是两台机器,不 `synchronize()` 量到的是「派活的时间」不是「干完活的时间」。写出了以后一年都用的 `bench()`。
- **Day 9** 把一次 `generate` 拆成 TTFT 和 TPOT,给两者各算了下限,定义了整周真正的产出:**实测 TPOT ÷ 6.9 ms 这个比值**。
- **Day 10** 用 `torch.profiler` 把一步 decode 拆成三四百个 kernel,认全它们的名字,把 top 5 对回模型的哪个零件。`aten::linear` 每步 155 次,和 Day 2 数出的矩阵数正好对上。
- **Day 11** 在 Perfetto 的 GPU 行上找到空白,算出 gap 占比。Day 1 读到的第三种瓶颈 overhead-bound 第一次有了实物。

这周结束时我应该能做到一件 W1 做不到的事:拿到任何一段 PyTorch 推理代码,先测出一个可信的每步时间,再用 profiler 说出这段时间里 GPU 在跑什么、闲了多久、闲的时候 CPU 在干什么。这是 M3 到 M8 所有优化工作的前置技能,没有它,后面「吞吐提升几倍」的数字全是虚的。

和 W1 一样,数字本身不重要。TinyLlama 的 6.9 ms 换个模型就没了。重要的是这一周建立的四条规矩:**先 warmup、计时必 sync、TTFT 和 TPOT 分开报、看比例用 profiler 看绝对值用计时器**。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="W2 知识地图:从跑通 generate 到在 timeline 上看到 gap 的五步链路,以及最后落到三种瓶颈的判别">
<defs>
<marker id="d12arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
<path d="M0 0 L10 5 L0 10 z" fill="var(--ink-faint)"/>
</marker>
</defs>
<text x="10" y="18" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">W2 · 从「跑通」到「看懂」的五步</text>
<g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
<rect x="10" y="30" width="116" height="66" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="68" y="48" text-anchor="middle" font-weight="700">Day 7 跑通</text>
<text x="68" y="64" text-anchor="middle" fill="var(--ink-soft)">T4 + TinyLlama</text>
<text x="68" y="79" text-anchor="middle" fill="var(--ink-soft)">warmup,极差&lt;10%</text>
<text x="68" y="92" text-anchor="middle" font-size="10" fill="var(--ink-faint)">fp16 不用 bf16</text>
<rect x="136" y="30" width="116" height="66" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="194" y="48" text-anchor="middle" font-weight="700">Day 8 计时</text>
<text x="194" y="64" text-anchor="middle" fill="var(--ink-soft)">CPU/GPU 两台机器</text>
<text x="194" y="79" text-anchor="middle" fill="var(--ink-soft)">sync 或 Event</text>
<text x="194" y="92" text-anchor="middle" font-size="10" fill="var(--ink-faint)">bench():中位数</text>
<rect x="262" y="30" width="116" height="66" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="48" text-anchor="middle" font-weight="700">Day 9 对账</text>
<text x="320" y="64" text-anchor="middle" fill="var(--ink-soft)">TTFT ≠ TPOT</text>
<text x="320" y="79" text-anchor="middle" fill="var(--ink-soft)">下限 6.9 ms</text>
<text x="320" y="92" text-anchor="middle" font-size="10" font-weight="700" fill="var(--mem)">比值 = 实测 ÷ 6.9</text>
<rect x="388" y="30" width="116" height="66" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="446" y="48" text-anchor="middle" font-weight="700">Day 10 拆开</text>
<text x="446" y="64" text-anchor="middle" fill="var(--ink-soft)">profiler + Perfetto</text>
<text x="446" y="79" text-anchor="middle" fill="var(--ink-soft)">top 5 kernel</text>
<text x="446" y="92" text-anchor="middle" font-size="10" fill="var(--ink-faint)">linear 每步 155 次</text>
<rect x="514" y="30" width="116" height="66" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="572" y="48" text-anchor="middle" font-weight="700">Day 11 找空白</text>
<text x="572" y="64" text-anchor="middle" fill="var(--ink-soft)">GPU 行的 gap</text>
<text x="572" y="79" text-anchor="middle" fill="var(--ink-soft)">忙碌比例</text>
<text x="572" y="92" text-anchor="middle" font-size="10" fill="var(--ink-faint)">加 batch 再看一次</text>
</g>
<g stroke="var(--ink-faint)" stroke-width="1.2" fill="none" marker-end="url(#d12arr)">
<path d="M126 63 L134 63"/><path d="M252 63 L260 63"/><path d="M378 63 L386 63"/><path d="M504 63 L512 63"/>
</g>
<text x="10" y="134" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">落点 · 三种瓶颈在 timeline 上长什么样</text>
<g font-family="var(--font-mono)" font-size="11">
<rect x="10" y="146" width="196" height="120" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="108" y="166" text-anchor="middle" font-weight="700" fill="var(--ink)">overhead-bound</text>
<rect x="24" y="180" width="18" height="10" fill="var(--ink-soft)"/><rect x="56" y="180" width="14" height="10" fill="var(--ink-soft)"/><rect x="94" y="180" width="22" height="10" fill="var(--ink-soft)"/><rect x="138" y="180" width="12" height="10" fill="var(--ink-soft)"/><rect x="170" y="180" width="20" height="10" fill="var(--ink-soft)"/>
<text x="108" y="212" text-anchor="middle" fill="var(--ink-soft)">GPU 行大量空白</text>
<text x="108" y="228" text-anchor="middle" fill="var(--ink-soft)">加 batch 时间几乎不变</text>
<text x="108" y="250" text-anchor="middle" font-size="10" fill="var(--ink-faint)">治:少发 kernel / 每次多干活</text>
<rect x="222" y="146" width="196" height="120" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="166" text-anchor="middle" font-weight="700" fill="var(--ink)">memory-bound</text>
<rect x="236" y="180" width="60" height="10" fill="var(--mem)"/><rect x="298" y="180" width="8" height="10" fill="var(--mem)"/><rect x="308" y="180" width="60" height="10" fill="var(--mem)"/><rect x="370" y="180" width="8" height="10" fill="var(--mem)"/><rect x="380" y="180" width="24" height="10" fill="var(--mem)"/>
<text x="320" y="212" text-anchor="middle" fill="var(--ink-soft)">色块连续,gemm 占主体</text>
<text x="320" y="228" text-anchor="middle" fill="var(--ink-soft)">加 batch 时间几乎不变</text>
<text x="320" y="250" text-anchor="middle" font-size="10" fill="var(--ink-faint)">治:量化减字节 / batching 提强度</text>
<rect x="434" y="146" width="196" height="120" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="532" y="166" text-anchor="middle" font-weight="700" fill="var(--ink)">compute-bound</text>
<rect x="448" y="180" width="168" height="10" fill="var(--compute)"/>
<text x="532" y="212" text-anchor="middle" fill="var(--ink-soft)">色块连续,大 gemm</text>
<text x="532" y="228" text-anchor="middle" fill="var(--ink-soft)">加 batch 时间线性涨</text>
<text x="532" y="250" text-anchor="middle" font-size="10" fill="var(--ink-faint)">治:提算力利用率 / 换卡</text>
</g>
<text x="10" y="292" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">前两种「加 batch 时间不变」的症状一样,只靠计时器分不开,必须看 GPU 行有没有空白。这就是 W2 学 profiler 的全部理由。</text>
<text x="10" y="312" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">口径:Colab T4(320 GB/s,fp16 65 TFLOP/s,ridge 203)· TinyLlama-1.1B fp16 2.2 GB · decode 下限 6.9 ms。</text>
</svg>
<figcaption>五天的链路和它的落点。上面一行是工具和方法,每一步给下一步提供前提;下面一行是这些工具最终要回答的问题:这段代码卡在哪一种瓶颈。W1 只能区分后两种,W2 之后三种都能在图上认出来。</figcaption>
</figure>

## 一页笔记

以下全部以 Colab T4、TinyLlama-1.1B、fp16、HF transformers eager 模式为口径。

### 环境与口径

| 项 | 值 | 出处 |
| --- | --- | --- |
| 卡 | Tesla T4,Turing,16 GB GDDR6 | Day 7,每次开机 `nvidia-smi` 确认 |
| 显存带宽 | 320 GB/s | NVIDIA T4 规格页 |
| fp16 tensor core 算力 | 65 TFLOP/s | 同上 |
| ridge point | 65e12 ÷ 320e9 ≈ 203 FLOP/byte | Day 7 算 |
| bf16 | 不支持,只能 fp16 | Turing 没有 bf16 tensor core |
| 模型 | TinyLlama-1.1B,22 层,d 2048,32 q 头,4 KV 头,head_dim 64,FFN 5632 | config.json |
| 参数量 | 1.10B(embedding 65.5M + 22 × 44.0M + lm_head 65.5M) | Day 7 对账 |
| 权重字节 | 1.1e9 × 2 = 2.2 GB | |
| KV cache / token | 2 × 22 × (4 × 64) × 2 B = 22.5 KB | GQA,不是 d |
| decode 下限(batch 1) | 2.2 GB ÷ 320 GB/s ≈ 6.9 ms ≈ 145 tok/s | 整周的基准线 |
| 7B 为什么装不下 | 13.5 GB 权重 + 1.5 GB 框架 = 15 GB,T4 可用约 15 GB,KV cache 无处放 | Day 7 |

### 计时方法学:四条规矩

1. **先 warmup。** 第一次运行含 CUDA context 初始化、cuBLAS 挑 kernel、显存池首次分配、时钟升频,和模型无关。空跑 2 到 3 次再计时。
2. **计时必 sync。** CPU 提交 kernel 到 stream 后立刻返回,GPU 在后面执行。不 `torch.cuda.synchronize()`,`perf_counter` 量到的是提交时间,和真实执行时间没有固定关系。开始前也要 sync 一次,清掉队列里别人的尾巴。
3. **多次取中位数,报极差。** 中位数抗离群值;极差 ÷ 中位数 < 10% 是 Day 7 的验收口径。
4. **分清两种计时法。** 端到端延迟(TTFT、TPOT、一次 generate)用 synchronize + perf_counter,量的是用户感受的墙上时间;单个 kernel 或一小段纯 GPU 计算用 `torch.cuda.Event`,不含 CPU 提交等待。两者的差就是 overhead。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="计时方法学流程图:warmup、开始前同步、计时、结束后同步、重复取中位数,以及根据要测的东西选择 synchronize 法或 Event 法">
<defs>
<marker id="d12arr2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
<path d="M0 0 L10 5 L0 10 z" fill="var(--ink-faint)"/>
</marker>
</defs>
<g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
<rect x="10" y="20" width="96" height="44" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="58" y="38" text-anchor="middle">warmup ×3</text>
<text x="58" y="54" text-anchor="middle" font-size="10" fill="var(--ink-faint)">丢掉一次性开销</text>
<rect x="122" y="20" width="96" height="44" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="170" y="38" text-anchor="middle">synchronize()</text>
<text x="170" y="54" text-anchor="middle" font-size="10" fill="var(--ink-faint)">清空队列</text>
<rect x="234" y="20" width="96" height="44" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="282" y="38" text-anchor="middle">t0 · fn() · sync</text>
<text x="282" y="54" text-anchor="middle" font-size="10" fill="var(--ink-faint)">t1 − t0</text>
<rect x="346" y="20" width="96" height="44" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="394" y="38" text-anchor="middle">重复 ×10</text>
<text x="394" y="54" text-anchor="middle" font-size="10" fill="var(--ink-faint)">每次都 sync</text>
<rect x="458" y="20" width="172" height="44" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="544" y="38" text-anchor="middle">中位数 + 极差/中位数</text>
<text x="544" y="54" text-anchor="middle" font-size="10" fill="var(--ink-faint)">&lt; 10% 才算过</text>
</g>
<g stroke="var(--ink-faint)" stroke-width="1.2" fill="none" marker-end="url(#d12arr2)">
<path d="M106 42 L120 42"/><path d="M218 42 L232 42"/><path d="M330 42 L344 42"/><path d="M442 42 L456 42"/>
</g>
<text x="10" y="102" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">要测的是什么?</text>
<g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
<rect x="10" y="114" width="300" height="112" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="160" y="134" text-anchor="middle" font-weight="700">端到端延迟</text>
<text x="160" y="152" text-anchor="middle" fill="var(--ink-soft)">一次 generate · TTFT · TPOT</text>
<text x="160" y="172" text-anchor="middle">synchronize + perf_counter</text>
<text x="160" y="190" text-anchor="middle" font-size="10" fill="var(--ink-faint)">量墙上时间,含 Python、提交、排队空隙</text>
<text x="160" y="208" text-anchor="middle" font-size="10" fill="var(--ink-faint)">用户感受到的就是它</text>
<rect x="330" y="114" width="300" height="112" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="480" y="134" text-anchor="middle" font-weight="700">单个 kernel / 一段纯 GPU 计算</text>
<text x="480" y="152" text-anchor="middle" fill="var(--ink-soft)">Day 13 测带宽 · Day 14 测算力</text>
<text x="480" y="172" text-anchor="middle">torch.cuda.Event</text>
<text x="480" y="190" text-anchor="middle" font-size="10" fill="var(--ink-faint)">GPU 自己打时间戳,不含 CPU 提交等待</text>
<text x="480" y="208" text-anchor="middle" font-size="10" fill="var(--ink-faint)">两者之差 = overhead 的大小</text>
</g>
<text x="10" y="244" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">上面那一行不管选哪种都要做。Day 8 的 bench() 把两种都封进去了,use_event 一个开关切换。</text>
</svg>
<figcaption>Day 7 和 Day 8 合起来就是这张图。上面一行是任何计时都要走的流程,下面是按测量对象二选一。这张图以后每次写 benchmark 前看一眼,面试里「你的数字怎么保证可信」这道题答的也是它。</figcaption>
</figure>

`bench()` 的骨架,以后直接抄:

```python
import time, statistics, torch

def bench(fn, *args, warmup=3, iters=10, use_event=False, **kw):
    for _ in range(warmup):
        fn(*args, **kw)
    torch.cuda.synchronize()
    samples = []
    for _ in range(iters):
        if use_event:
            s = torch.cuda.Event(enable_timing=True); e = torch.cuda.Event(enable_timing=True)
            s.record(); fn(*args, **kw); e.record(); e.synchronize()
            samples.append(s.elapsed_time(e) / 1000)
        else:
            torch.cuda.synchronize(); t0 = time.perf_counter()
            fn(*args, **kw)
            torch.cuda.synchronize(); samples.append(time.perf_counter() - t0)
    med = statistics.median(samples)
    return med, (max(samples) - min(samples)) / med, samples
```

隐式同步的清单也要记住:`.item()`、`.cpu()`、`.numpy()`、`.tolist()`、`print(tensor)`、`if tensor > 0`。它们需要 GPU 的值,所以会偷偷等。计时代码里有它们,数字可能碰巧对;生产代码里有它们,GPU 队列被反复切断,出 gap。**计时要 sync,服务代码要少 sync,方向相反。**

### TTFT 与 TPOT

```
总耗时 = TTFT + (N − 1) × TPOT
```

| 量 | 是什么 | 阶段 | T4 + TinyLlama 的下限 | 怎么算 |
| --- | --- | --- | --- | --- |
| TTFT | 请求到第一个新 token | prefill,整段 prompt 一起过 | ≈ 7 ms(200 token prompt) | max(算力时间 6.8 ms,搬权重 6.9 ms) |
| TPOT | 之后每多一个 token | decode,一次一个 token | 6.9 ms | 2.2 GB ÷ 320 GB/s;算力 0.034 ms 可忽略 |

两个下限差不多,但实测 TTFT 会明显大于 TPOT,因为 prefill 里的大矩阵乘和 attention 在 T4 上效率不高。200 token 的 prefill 算术强度是 200,正好压在 T4 的 ridge point 203 上;prompt 更长才 compute-bound,更短和 decode 一样 memory-bound。「prefill 天然 compute-bound」这句话有前提,前提是 prompt 有几千个 token。

KV cache 在这个实验里可以忽略:22.5 KB × 264 token ≈ 6 MB,是权重的千分之三。GQA 把它压小 8 倍对 batch 1 短序列的 TPOT 几乎没影响,GQA 省的是显存,收益在 batch 开大、序列拉长时才兑现。

三种分开测的方法:两次 generate 相减(最简单);`TextIteratorStreamer` 每个 token 打时间戳(能看时间序列,测的是用户体感);手写 prefill + decode 循环每步 Event 计时(最精确,也是 profiler 要用的形式)。三种结果差 10% 到 20% 正常,差一倍就是有一边漏了 sync 或没 warmup。

### 整周的产出:一个比值

```
比值 = 实测 TPOT ÷ 6.9 ms
```

| 比值 | 意思 | 下一步 |
| --- | --- | --- |
| 1.0–1.5 | 几乎打到带宽上限。HF eager 在 T4 上不太可能,先怀疑漏 sync | 复查 Day 8 三条 |
| 1.5–3 | memory-bound 成立,GPU 大部分时间在搬权重 | W1 的表可以信 |
| 3–6 | 有一块时间不在搬权重上,CPU 开销和 GPU 时间一个量级 | Day 11 找 gap |
| > 6 | overhead 主导,GPU 大部分时间在等 CPU | 消 gap 的两条路 |

跑之前写下的预期:HF eager 每步 15 到 30 ms,比值 2 到 4。依据是每步三四百个 kernel、每个 CPU 侧 30 到 50 µs,合计约 14 ms,和 6.9 ms 的 GPU 时间相加再打折(部分重叠)。**比值大不一定是卡慢,可能是活太少**:模型越小,每步 GPU 活越少,但 kernel 数量不减,CPU 开销占比天然高。同样代码换 7B 在 A100 上跑,比值会更接近 1.5 到 3。

### profiler:看比例,不看绝对值

```python
from torch.profiler import profile, ProfilerActivity, schedule, tensorboard_trace_handler
with profile(activities=[ProfilerActivity.CPU, ProfilerActivity.CUDA],
             schedule=schedule(wait=1, warmup=2, active=3),
             on_trace_ready=tensorboard_trace_handler("./trace"),
             record_shapes=True, with_stack=False) as prof:
    for _ in range(6):                    # wait + warmup + active
        one_decode_step(); torch.cuda.synchronize()
        prof.step()                       # 忘了这行 trace 是空的
print(prof.key_averages().table(sort_by="cuda_time_total", row_limit=15))
```

读表的三对列:**Self 和 total**(自己 vs 含子算子);**CPU 和 CUDA**(算子在 CPU 行有数,kernel 在 CUDA 行有数,别混着比);**# of Calls**(除以 active 步数得每步次数,`aten::linear` 应该是 155,和 Day 2 对账)。

kernel 名对回模型:

| kernel 名(模式) | 对应模型部件 | 每步次数 | 预期 GPU 时间占比 |
| --- | --- | --- | --- |
| `turing_fp16_s1688gemm_…` / `gemv2T_kernel` / `cutlass_…` | 全部 `nn.Linear`:q/k/v/o、gate/up/down、lm_head | 155 | 60–80%,它们搬那 2.2 GB |
| `vectorized_elementwise_kernel` | add、mul、silu、pow、rsqrt、RoPE | 250+ | 10–20%,次数占一半以上 |
| `fmha_cutlassF_…` 或 `bmm` + `softmax` | attention 核心;T4 没有 flash,走 mem-efficient 或 math | 22 或 66 | 5–10% |
| `CatArrayBatchedCopy` / `copy_` | KV cache 追加(HF DynamicCache 用 `torch.cat`) | 44 | 3–6% |
| `reduce_kernel` | RMSNorm 里的 mean;eager 下 RMSNorm 没有自己的 kernel | 44 | 2–4% |

Perfetto 三层:ProfilerStep 框、python 线程行(CPU 算子,层层嵌套,几乎不断)、stream 行(GPU kernel,**会有缝**)。W/S 缩放,A/D 平移,拖选出汇总。

### gap:overhead-bound 的实物

gap 是 GPU 行两个 kernel 之间的空白。那段时间 GPU 在等,CPU 在跑 Python、走 dispatcher、调 `cudaLaunchKernel`。出现条件只有一个:**单个 kernel 的 GPU 时间和 CPU 发射时间在同一量级**。TinyLlama 在 T4 上正好撞在这个区间:一步三四百个 kernel,GPU 侧合计约 8 ms,CPU 侧发完约 14 ms。

```
GPU 忙碌比例 = kernel 总时长(合并重叠)÷(第一个 kernel 开始 → 最后一个结束)
```

batch 1 预期 50% 到 65%。batch 加到 32:CPU 发射成本不变,GPU 侧 elementwise 和 attention 从「几 KB 的活」变成有实际计算,总时间变长填掉空白,忙碌比例上升,每步时间几乎不涨。

两种治法:**减少 launch 次数**(kernel fusion:`torch.compile` 融相邻 elementwise;CUDA graph:整步录下来一次 replay,`torch.compile(mode="reduce-overhead")` 配 static cache,vLLM decode 默认用)和**让每次 launch 干更多活**(加 batch)。生产引擎两个都做。换更快的 GPU 对 gap 没帮助,gap 还会变宽。

nvidia-smi 的 util 采样窗口几百毫秒,一步里有 kernel 跑过就 100%;gap 是微秒级的,只有 trace 看得到。**util 100% 和 gap 占一半可以同时成立。**

### 一页对比报告模板

这周的交付物是这张表。左边是 W1 的方法算出来的,右边是真机器给的,最后一列写差在哪、为什么。全部实测列现在留空,跑完填。

| 项 | 理论 / 预期 | 实测 | 差多少、为什么 |
| --- | --- | --- | --- |
| 卡型、PyTorch 版本、transformers 版本 | T4 | | |
| 权重占用(`memory_allocated` 加载后) | 2.2 GB | | 差很多先怀疑 dtype |
| 10 次 generate 极差 / 中位数 | < 10% | | |
| TTFT(200 token prompt) | 下限 ≈ 7 ms,预期 15–40 ms | | prefill 效率 + attention 无 flash |
| TPOT 中位数 | 下限 6.9 ms,预期 15–30 ms | | |
| **比值 = TPOT ÷ 6.9** | 预期 2–4 | | 整周的产出 |
| tok/s | 上限 145 | | |
| TTFT ÷ TPOT | 预期 2–5 | | |
| `aten::linear` 每步次数 | 155 | | 和 Day 2 对账 |
| top 1 kernel / 占比 | gemm 类,60–80% | | |
| top 2 kernel / 占比 | elementwise,10–20% | | |
| top 3 kernel / 占比 | attention,5–10% | | |
| gemm 类每步 GPU 时间 | 略大于 6.9 ms | | 6.9 ÷ 它 = 矩阵乘带宽效率,W3 正式测 |
| kernel 数 / 步 | 300–400 | | |
| GPU 忙碌比例(batch 1) | 50–65% | | |
| GPU 忙碌比例(batch 32) | 明显高于 batch 1 | | |
| 单个 gap 典型长度 | 10–40 µs | | 对应 CPU 行的算子名一并记 |
| reduce-overhead 编译后 TPOT | 接近 8 ms | | 编译失败记版本号 |

这张表填完,W2 才算结束。它也是 M3 之后每次优化实验的报告格式:优化前一列、优化后一列、差在哪一列。

## 五道验收题

路线图 W2 的验收题,合上笔记答。答案基于 W1 的算法和这周的预期区间,实测数字以自己跑出来的为准。

**1. 为什么第一次 generate 比后续慢很多?至少说出两个原因。**

CUDA context 初始化:进程第一次碰 GPU 要加载驱动、建 context、初始化 cuBLAS 等库的句柄、向驱动申请显存池的第一批块,几百毫秒到秒级。kernel 挑选和缓存填充:每种矩阵形状第一次出现时 cuBLAS 要选实现,可能试跑几个候选,22 层十几种形状全要挑一遍,结果按形状缓存;PyTorch 显存池同样大小的块第二次起直接复用。第三个次要因素是 GPU 时钟从空闲低频升到满频需要几十毫秒。这三样都和模型无关,warmup 就是把它们从测量窗口里剔掉。

**2. 不加 `synchronize()` 测出来的时间,实际测到的是什么?**

CPU 把 kernel 指令塞进 stream 队列所花的时间,每个几微秒到几十微秒,和 kernel 里有多少活无关。它和 GPU 真实执行时间没有固定关系:decode 这种碎活,两者是同一量级,看着像真的;prefill 或大矩阵乘,差两三个数量级。一个 8192² 的 fp16 矩阵乘在 T4 上不 sync 测出 20 µs,算出 55,000 TFLOP/s,是标称 65 的八百多倍,这种荒谬的好发现,差 3 到 5 倍的才危险。

**3. 你的 TPOT 实测是理论下限的几倍?差距来自哪里?**

实测数字还没有,预期是 2 到 4 倍。差距的来源要拆成两块看:GPU 真正在跑 kernel 的那段时间里,矩阵乘的带宽效率大概是标称的 75% 到 90%(W3 测),这一块让 6.9 ms 变成 8 ms 左右;剩下的是 gap,GPU 在等 CPU 发下一个 kernel,一步三四百次 launch 的 CPU 成本约 14 ms,和 GPU 时间部分重叠后多出来几毫秒到十几毫秒。**比值大主要不是带宽没用满,是 GPU 在等**。要把两块分开只能用 profiler,算 GPU 忙碌比例。

**4. trace 里 top 3 耗时 kernel 分别对应模型的哪个部分?**

第一是 gemm / gemv 类矩阵乘 kernel(`turing_fp16_s1688gemm_…`、`gemv2T_kernel`、`cutlass_…`),对应全部 `nn.Linear`:每层 q/k/v/o 四个投影加 FFN 的 gate/up/down 三个,22 层 154 个,加 lm_head 一个,每步 155 次;它们搬那 2.2 GB 权重,预期占 GPU 时间 60% 到 80%。第二是 `vectorized_elementwise_kernel`,对应残差加、SiLU、gate × up 的乘、RMSNorm 拆出来的 pow / rsqrt / mul、RoPE 的 cos sin,每个几微秒但每步 250 次以上,预期占 10% 到 20%。第三是 attention 核心,T4 上没有 flash,走 mem-efficient 后端的 `fmha_cutlassF_…` 或 math 后端的 bmm + softmax + bmm,预期 5% 到 10%。

**5. timeline 上的 gap 说明什么?有哪两种办法让它变小?**

gap 说明 GPU 队列空了,GPU 在等 CPU 把下一个 kernel 发过来,时间被 CPU 侧的 Python、dispatcher、launch 成本决定,这就是 overhead-bound。两种办法:一是减少 launch 次数,kernel fusion 把相邻小算子融成一个(`torch.compile` 自动做,Triton 手动做),CUDA graph 把整步录下来一次 replay(`reduce-overhead` 模式或 vLLM 的 decode 路径);二是让每次 launch 干更多活,加大 batch,launch 次数不变但每个 kernel 处理更多 token,GPU 侧时间变长填掉空白。

## 加练:换成 7B 在 A100 上,预期怎么变

这周所有预期都是 T4 加 1.1B 的。把 W1 的口径 Llama-2-7B 加 A100 代进 W2 的每个公式,看哪些结论变、哪些不变。这是检验「学的是方法还是数字」。

| 项 | T4 + TinyLlama | A100 + Llama-2-7B | 怎么算 |
| --- | --- | --- | --- |
| 权重 | 2.2 GB | 13.5 GB | 参数 × 2 B |
| TPOT 下限 | 6.9 ms | 6.6 ms | 权重 ÷ 带宽,两者接近不是巧合:模型大 6 倍,带宽快 6.4 倍 |
| decode 算力时间 | 0.034 ms | 0.043 ms | 2N ÷ 峰值,都可忽略 |
| kernel 数 / 步 | 300–400 | 450–550 | 32 层 × 15 左右 + 头尾,比 22 层多一半 |
| CPU 发射成本 / 步 | ≈ 14 ms(Colab 弱 CPU) | ≈ 10–20 ms,看主机 CPU | 次数 × 30–50 µs |
| 单个 gemm 的 GPU 时间 | q 投影 26 µs,FFN 72 µs | q 投影 16 µs,FFN 88 µs | 字节 ÷ 带宽;7B 的 FFN 是 4096 × 11008 × 2 = 90 MB |
| gap 预期 | 明显,忙碌比例 50–65% | 仍然明显 | 单个 kernel 仍是几十微秒,和 CPU 发射同量级 |
| 200 token prefill 强度 | 200,压在 ridge 203 上 | 200,已过 ridge 153,compute-bound | 强度 = 2 × token 数 ÷ 2,与模型无关 |
| KV cache / token | 22.5 KB | 512 KB | 7B 是 MHA,k、v 长度是 d |
| KV cache 何时追上权重 | 98,000 token,不可能 | 26,000 token,长上下文会 | 权重 ÷ 每 token KV |

三个观察。第一,TPOT 下限几乎一样,但 A100 上 7B 的 gap 不会消失,因为 HF eager 每步的 kernel 数只多不少,每个 kernel 的时间仍是几十微秒,和 CPU 发射同量级。这解释了为什么 vLLM 在 A100 上也要用 CUDA graph。第二,prefill 的算术强度只看 token 数,和模型大小无关,所以 200 token 在 T4 上刚到 ridge、在 A100 上已经过了,同一个 prompt 长度在不同卡上落在不同侧。第三,7B 的 KV cache 在 26k token 时追上权重,那时候 decode 每步读的 KV 和权重一样多,TPOT 翻倍,这是 M2 长上下文那一周的伏笔,TinyLlama 上永远看不到。

再换 Qwen2.5-0.5B 在 T4 上:权重 1 GB,下限 3.1 ms,但 24 层的 kernel 数和 TinyLlama 差不多,CPU 成本不变,比值只会更大。**模型越小,比值越大,和卡无关。** 有空跑一下,是对这条规律最便宜的检验。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LuhJEEJQgUM" title="Lecture 1 How to profile CUDA kernels in PyTorch" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>GPU MODE ·《Lecture 1 How to profile CUDA kernels in PyTorch》· Mark Saroufim。W2 的 Day 8、10、11 都指向这一讲。复习时从头看一遍完整版:前 10 分钟不 sync 的计时有多离谱,中段 torch.profiler 和 trace 的读法,后段一个小 kernel 的 launch 开销如何盖过计算本身。这周做的事和它的顺序几乎一样,看完能检查自己漏了哪一段。</figcaption>
</figure>

## 错题本

这周还没有真实实测,所以错题本记的是「这周的内容里最容易在哪里摔」。每条写错在哪、为什么会错、纠正后的规律。以后真跑的时候摔在同一个地方,回来打勾。

**错误一:在 T4 上不指定 dtype 加载 TinyLlama。**

config.json 写的是 bfloat16,不指定就可能按 bf16 加载。T4 是 Turing,没有 bf16 tensor core,报错或退到极慢的路径,所有计时作废。为什么会错:习惯了「按模型自带的精度加载」,没意识到精度支持是硬件属性。规律:**加载前先查卡的架构,Ampere 之前只有 fp16**。加载后立刻看 `memory_allocated()`,2.2 GB 对、4.4 GB 是 fp32、报错是 bf16。

**错误二:把第一次运行的时间当成模型速度。**

第一次含 CUDA context、kernel 挑选、显存池首次分配,和模型无关。为什么会错:计时代码没错,数字也「像真的」,只是慢了几倍,容易解释成「T4 就是慢」。规律:**任何性能数字都先 warmup 再测**,以后不再提醒,默认已经做了。

**错误三:用平均数报延迟。**

偶尔一次被别的进程抢了 GPU,平均数被拉偏,中位数不会。为什么会错:平均数是默认反应。规律:**报延迟一律报中位数,顺带报极差或 P99**。产出物里「延迟 P99 下降多少」那一栏就是这么来的。

**错误四:代码正确所以不需要 sync;或者看到数字正常就觉得计时没问题。**

异步是设计不是 bug,代码完全正确时不 sync 的计时也是错的。而数字「正常」多半是别处有 `.item()` 或 `print` 偷偷 sync 了,换一段代码就不成立。为什么会错:异步这件事在 CPU 上写代码时是不可见的,没有任何报错。规律:**计时永远显式 sync,开始前一次、结束后一次,不靠偶然**。

**错误五:Event 和 synchronize 两个数直接比,说「Event 更准所以以它为准」。**

两者量的区间不同:Event 不含 start 之前 CPU 提交的等待,synchronize 含全部墙上时间。为什么会错:把「精度高」和「测的是同一个东西」混了。规律:**测什么决定用什么**,TPOT 用 synchronize 法,单 kernel 用 Event,差值是 overhead,本身就是信息。

**错误六:拿总耗时除以 token 数当 TPOT。**

这样算出来的数包含了 TTFT 那一大块,N 越小被拉得越高,N = 8 时可能偏大 50%。为什么会错:一次 generate 返回一个时间,最省事的就是除一下。规律:**TTFT 和 TPOT 必须分开报**,它们卡在不同地方,混在一起谁也不代表。

**错误七:比值是 3 就说「带宽只用了三分之一」。**

比值大可能是 GPU 在等 CPU,不是搬运本身慢。带宽利用率要看 GPU 真正跑 kernel 那段时间里搬了多少字节。为什么会错:比值的分母是带宽算出来的,直觉上就把差距全归给带宽。规律:**比值只说「离下限多远」,不说「差在哪」**;差在哪要用 profiler 拆 GPU 时间和 gap。

**错误八:以为 GQA 会让 decode 明显变快。**

batch 1、序列 2048 以内,KV cache 是权重的 2% 以下,压小 8 倍对 TPOT 影响不到 2%。为什么会错:看到「省 8 倍」就觉得一定快。规律:**先算被优化的那一项占总量多少**,占 2% 的东西优化到零也只快 2%。GQA 的收益是显存,在 batching 时才兑现。

**错误九:用了 schedule 却忘了 `prof.step()`,trace 是空的,以为 GPU 没跑。**

schedule 靠 `prof.step()` 推进阶段,漏了它永远停在 wait。为什么会错:profiler 没报错,只是什么都没记。规律:**用 schedule 必调 `prof.step()`,循环步数至少 wait + warmup + active**。

**错误十:把算子行的 CPU total 当 GPU 时间。**

`aten::linear` 的 CPU total 9.8 ms 是 CPU 从进入到返回的时间,含发 kernel 的开销;它的 Self CUDA 是 0,因为算子本身不在 GPU 上跑。为什么会错:表里数字最大的那列最显眼。规律:**GPU 时间只看 kernel 行的 Self CUDA;算子行看结构,kernel 行看时间**。

**错误十一:拿 profiler 的绝对时间当性能数字。**

profiler 让 CPU 每个算子多几微秒,一步几百个算子多出一两毫秒,`record_shapes`、`with_stack` 开得越多越慢。为什么会错:profiler 也报时间,看着和计时器一样。规律:**profiler 看比例和结构,计时器报绝对值**,两个数不一致是正常的。

**错误十二:只看 kernel 时长排名找瓶颈,没先算忙碌比例。**

按 CUDA 时间排,排出来全是 gemm。但如果整步一半时间是 gap,优化 gemm 最多省另外一半的一部分。为什么会错:profiler 表默认就是按时间排的,顺手就看排名。规律:**先算 GPU 忙碌比例,再决定看 kernel 还是看 CPU**。

**错误十三:util 100% 就觉得没有 overhead。**

util 的采样窗口几百毫秒,一步里有 kernel 跑过就算 100%;gap 是微秒级的。为什么会错:Day 5 已经记过 util 不等于算力利用率,这周又多一层,util 也不等于没有 gap。规律:**nvidia-smi 只能告诉你 GPU 有没有在用,判断三种 bound 都要看 trace**。

**错误十四:以为换更快的 GPU 能治 gap。**

gap 的长度由 CPU 发 kernel 的速度决定。更快的 GPU 把每个 kernel 做得更快,等得更久,空白比例更高。为什么会错:「慢就换卡」是最自然的反应。规律:**先判断是哪种 bound 再花钱**,overhead-bound 换卡是白花。

十四条里,一到五是计时方法学,六到八是读比值,九到十四是读 profiler。根子只有两个:**CPU 和 GPU 是两台机器**(异步、sync、gap、util、换卡都从这一条来);**看比例和看绝对值是两件事**(比值、profiler 开销、kernel 排名都从这一条来)。这两条记住,十四条错大半犯不了。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/dKZxUcuOb8A" title="PyTorch and CPU-GPU Synchronizations [PyCon DE & PyData 2026]" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>PyData ·《PyTorch and CPU-GPU Synchronizations》(PyCon DE &amp; PyData 2026)。错题本前五条和第十三、十四条的根子都是「两台机器」,这场演讲把哪些操作会隐式同步、怎么在 profiler 里看到同步点、为什么它们拖慢程序讲了一遍。复习时配着错误四和错误五看。</figcaption>
</figure>

## 学习方法反思

三条,和 W1 的不重复。

第一,**跑之前先写预期,跑完再对**。这周每篇都在实测列旁边写了预期区间和依据。这不是为了猜对,是为了让「差在哪」有一个可比的锚。没有预期的实测只是一个数,有预期的实测是一个问题。W3 测带宽和算力也这么做。

第二,**每个工具先问它量的是什么,再问它准不准**。计时器、Event、profiler、nvidia-smi 四样东西这周全用了,每一样都有人拿它测错东西。「准不准」是第二个问题,「量的是不是我要的那一段」是第一个。

第三,**对账是最好的检验**。`aten::linear` 每步 155 次和 Day 2 数出来的矩阵数对上,`memory_allocated` 的 2.2 GB 和 Day 7 算的权重对上,这两次对账比任何教程都让我相信自己看懂了。以后每学一个新工具,先找一个已知的数去对。

## 全周名词总表

按出现顺序,每条一两句。

- **Colab / T4**:Google 的免费 notebook 环境,免费版通常给 Tesla T4,16 GB、320 GB/s、fp16 65 TFLOP/s,Turing 架构,不支持 bf16。每次开机 `nvidia-smi` 记卡型。
- **GQA / num_key_value_heads**:多个 q 头共享一组 k、v 头。TinyLlama 是 32 个 q 头共享 4 个 KV 头,W^k、W^v 是 2048 × 256 而不是方阵,KV cache 按 kv 头数算。
- **CUDA context**:进程在 GPU 上的运行环境,第一次用 GPU 时创建,几百毫秒到秒级。
- **warmup**:正式计时前先跑几次,把 context、kernel 挑选、显存池、时钟升频做完。
- **贪心解码**:`do_sample=False`,每步取概率最大的 token,同输入必同输出,测性能时用它。
- **极差 / 中位数**:稳定性指标,Day 7 验收口径 < 10%。
- **异步执行 / stream**:CPU 提交后不等,GPU 按 stream 队列顺序执行。默认所有操作走同一条 stream。
- **kernel launch**:CPU 把一个 kernel 排进 stream 的动作,几微秒到几十微秒,和 kernel 里有多少活无关。
- **`torch.cuda.synchronize()`**:CPU 阻塞直到 GPU 所有活干完。计时前后各一次。
- **隐式同步**:`.item()`、`.cpu()`、`print(tensor)`、条件判断,因为需要值而自动等。
- **CUDA Event**:塞进 stream 的时间戳标记,GPU 执行到它时打戳;`elapsed_time` 是 GPU 侧耗时。
- **端到端延迟 / 墙上时间**:从 CPU 发起到结果可用的真实流逝时间,含 CPU、提交、GPU、排队空隙。
- **`torch.utils.benchmark.Timer`**:PyTorch 自带微基准工具,自动 warmup、sync、取中位数。
- **TTFT / TPOT / ITL**:首 token 时间(约等于 prefill)/ 之后每 token 时间(一步 decode)/ ITL 与 TPOT 同义。
- **prefill / decode**:整段 prompt 一次过 / 一次一个 token。总耗时 = TTFT + (N − 1) × TPOT。
- **streamer**:`TextIteratorStreamer`,`generate` 每产出一个 token 推出来,能给每个 token 打时间戳。
- **`past_key_values`**:HF 里 KV cache 的名字,手写 decode 循环时每步传进传出。
- **比值**:实测 TPOT ÷ 理论下限,整周的产出,全年优化的基线。
- **profiler / CUPTI / trace**:记录每个算子和 kernel 的工具 / 它底下的 NVIDIA 接口 / 输出的时间线 JSON。
- **Perfetto**:网页版 trace 查看器,`chrome://tracing` 的继任者。
- **算子(op)vs kernel**:CPU 上的一次 PyTorch 操作 / GPU 上跑的一段程序。一个算子发零到多个 kernel。
- **schedule / `prof.step()`**:profiler 的分阶段设置 wait、warmup、active / 推进阶段的调用,漏了 trace 为空。
- **Self / total,CPU / CUDA,# of Calls**:key_averages 表的三对列。
- **gemm / gemv / CUTLASS**:矩阵乘 kernel 的通称 / batch 1 时退化成的矩阵乘向量 / NVIDIA 开源矩阵乘模板库。
- **sdpa 三种后端**:flash(Ampere 起)/ mem-efficient(T4 走这个,`fmha_cutlassF`)/ math(bmm + softmax + bmm)。
- **elementwise**:逐元素运算,单个几微秒但每步 250 次以上。
- **eager 模式 / DynamicCache**:PyTorch 默认逐算子发 kernel / HF 默认 KV cache 实现,每步 `torch.cat`。
- **gap / GPU 忙碌比例**:GPU 行两个 kernel 之间的空白 / kernel 总时长 ÷ 首尾墙钟时间。
- **dispatcher**:PyTorch 把调用按 dtype、device 路由到实现的那一层,每个算子都走一遍。
- **kernel fusion / CUDA graph / reduce-overhead / static cache**:融相邻小 kernel / 整步录下来一次 replay / `torch.compile` 的 CUDA graph 模式 / 它的前提,固定形状的 KV cache。
- **flow 箭头**:Perfetto 里从 CPU 侧 launch 连到 GPU 侧 kernel 的线,斜说明队列有存货,近垂直说明 GPU 一直在等。

## 全周参考资料汇总

按用途分,每条一句话。

文章

- Horace He,《Making Deep Learning Go Brrrr From First Principles》。这周 overhead 那一节终于有了图对应,重读。https://horace.io/brrr_intro.html
- Kipply,《Transformer Inference Arithmetic》。TTFT、TPOT 下限的算法和本周同一口径,拿来对账。https://kipp.ly/transformer-inference-arithmetic/
- Databricks,《LLM Inference Performance Engineering: Best Practices》。怎么正确 benchmark 推理延迟,TTFT、TPOT、吞吐三者的取舍。https://www.databricks.com/blog/llm-inference-performance-engineering-best-practices
- PyTorch 官方博客,《Accelerating PyTorch with CUDA Graphs》。CUDA graph 解决什么、录图和 replay 的机制。https://pytorch.org/blog/accelerating-pytorch-with-cuda-graphs/

文档

- PyTorch,《CUDA semantics》。异步执行、stream、同步的原始出处。https://pytorch.org/docs/stable/notes/cuda.html
- PyTorch,`torch.cuda.Event`。record、synchronize、elapsed_time 三个方法。https://pytorch.org/docs/stable/generated/torch.cuda.Event.html
- PyTorch,《PyTorch Benchmark》recipe。`torch.utils.benchmark.Timer` 的用法。https://pytorch.org/tutorials/recipes/recipes/benchmark.html
- PyTorch,torch.profiler 文档与 Profiler recipe。`profile`、`schedule`、`key_averages`、`export_chrome_trace`。https://pytorch.org/docs/stable/profiler.html 、 https://pytorch.org/tutorials/recipes/recipes/profiler_recipe.html
- Perfetto UI。打开 trace 的地方。https://ui.perfetto.dev
- NVIDIA T4 产品页。320 GB/s、65 TFLOP/s 的出处。https://www.nvidia.com/en-us/data-center/tesla-t4/
- TinyLlama 模型卡。22 层、d 2048、4 个 KV 头这些数的出处。https://huggingface.co/TinyLlama/TinyLlama-1.1B-Chat-v1.0

视频

- GPU MODE,《Lecture 1 How to profile CUDA kernels in PyTorch》。已嵌在正文,W2 的主线视频。讲义仓库 https://github.com/gpu-mode/lectures
- PyData,《PyTorch and CPU-GPU Synchronizations》。已嵌在错题本,隐式同步与同步点的完整讨论。

## 自测

合上笔记做。这六题和上面五道验收题不重复,考的是这周更细的地方。

1. `bench()` 里 warmup 之后、正式循环之前那一次 `synchronize()` 是干什么的?去掉会怎样?

<details><summary>答案</summary>

清空 warmup 留在队列里的活,保证第一个正式样本不把 warmup 的尾巴算进去。去掉的话第一个样本偏大,极差随之变大,「极差 / 中位数 < 10%」可能过不了,而且原因很难查。

</details>

2. 200 个 token 的 prompt 在 T4 上做 prefill,算术强度多少?落在 roofline 哪一侧?同一个 prompt 换到 A100 上呢?

<details><summary>答案</summary>

每个参数搬 2 字节做 2 × 200 = 400 次运算,强度 200 FLOP/byte,和模型大小无关。T4 的 ridge point 是 203,正好压在线上;A100 是 153,已经过了 ridge,compute-bound。同一个 prompt 长度在不同卡上落在不同侧,所以「prefill 天然 compute-bound」必须先算强度再说。

</details>

3. TinyLlama 每步 decode 里 `aten::linear` 应该被调多少次?这个数怎么和 W1 对账?如果 key_averages 表里 # of Calls 是 465,说明什么?

<details><summary>答案</summary>

每层 q/k/v/o 四个投影加 FFN 的 gate/up/down 三个共 7 个,22 层 154 个,加 lm_head 一个,155 次。这和 Day 2 数矩阵的方法完全一致:一层 7 个矩阵。465 ÷ 3 = 155,说明 active 阶段记了 3 步,每步 155 次,trace 抓的是完整的一步 decode。

</details>

4. batch 从 1 加到 32,CPU 发 kernel 的总时间变不变?GPU 忙碌比例为什么上升?每步时间为什么几乎不涨?

<details><summary>答案</summary>

CPU 侧几乎不变,Python 和 dispatcher 的成本和 batch 无关。GPU 侧 gemm 不变(权重一样,只搬一遍),但 elementwise 和 attention 处理的数据变成 32 倍,原来只剩固定开销的小 kernel 开始有真实计算,GPU 总时间变长,更接近 CPU 的 14 ms,空白被填掉,忙碌比例上升。每步时间不涨是因为 GPU 时间变长的部分仍藏在 CPU 发射时间之下,或者说搬权重的固定成本没变。

</details>

5. 在 T4 的 trace 里看不到 `flash_fwd_kernel`,也看不到叫 RMSNorm 的 kernel,attention 和归一化是怎么跑的?

<details><summary>答案</summary>

T4 是 Turing,FlashAttention 2 需要 Ampere,sdpa 走 mem-efficient 后端(`fmha_cutlassF_…`)或 math 后端(bmm + softmax + bmm)。RMSNorm 在 eager 下是几行 PyTorch(pow、mean、rsqrt、mul),各发一个小 kernel,trace 里是四五个 elementwise 和 reduce 小块紧挨着,没有整体。开 `with_stack` 能在调用栈里看到 `LlamaRMSNorm.forward`。融成一个是 torch.compile 或专用库的事。

</details>

6. 一段代码加大 batch 后每步时间几乎不变。这能判定它是 memory-bound 吗?怎么确认?

<details><summary>答案</summary>

不能。overhead-bound 也是这个症状。确认要看 trace 里 GPU 行:有大量空白是 overhead-bound;色块连续、gemm 占主体才是 memory-bound。两者可以同时存在,先消 overhead(减少 launch 或加 batch)再看 memory(量化、batching),顺序反了会误以为量化没效果。

</details>

## 下周预告:W3

W2 拿到了「实测 ÷ 理论」的比值,但分母那个理论下限用的是厂商标称值:320 GB/s、65 TFLOP/s。标称值是理论峰值,实测永远达不到。用标称值建的 roofline 会让人追一个不存在的屋顶。W3 干一件事:**自己测出这张卡真实的那条线**。

| Day | 要做的事 | 验收 |
| --- | --- | --- |
| Day 13 · 实测显存带宽:一次 copy 能搬多快 | 对远大于 L2 的张量做 copy 或 add,按(读 + 写字节)÷ 耗时算 GB/s,张量大小从小扫到大看曲线 | 实测值 + 占标称的百分比 |
| Day 14 · 实测峰值算力:大方阵 matmul 能打到几成 | 方阵 matmul,FLOPs = 2N³,N 从 256 扫到 8192;fp16 走 tensor core 才对得上 65,fp32 是 8.1 另一个数 | 实测值 + 占标称的百分比,以及为什么达不到 |
| Day 15 · 用实测值画自己的 roofline,算实测 ridge point | 用 Day 13、14 的实测值替换标称值,matplotlib 画 log-log 图,把 Day 9 的 TPOT 换算成实际算力和强度标上去 | 一张自己的 roofline,实测 ridge point |
| Day 16 · batch 从 1 扫到 128:吞吐曲线在哪里离开斜线 | 1/4/16/64/128 各测 decode 每步时间,吞吐 = batch ÷ 每步时间,标到图上 | 五个点连成的曲线,能指出从哪个 batch 开始压平、为什么可能远早于 203 |
| Day 17 · 标称 vs 实测:哪些 kernel 能打到屋顶,哪些永远打不到 | 对比表:标称 / 实测 / 百分比 / 原因;大 gemm 能打满,elementwise、softmax、layernorm 强度不到 2 永远在斜线底部 | 说清什么样的 kernel 能到屋顶、什么样的永远到不了 |
| Day 18 · W3 复习:自己的 roofline、五道验收题、错题本 | 一页笔记、路线图 W3 五道验收题、错题本 | 五道全对 |

这周的工具全部是 W2 学的:Event 计时测单个 kernel(Day 8),warmup 和中位数(Day 7),profiler 看 kernel 名确认走了 tensor core(Day 10)。W2 的坑在 W3 会原样再出现一遍:矩阵太小打不满、拿 fp32 的实测对 fp16 的标称、字节只算读没算写、没 sync。

Day 16 那条曲线是对 W1 那个预测「打到 compute-bound 需要 batch ≈ 153(T4 上是 203)」的公开处刑。沿斜线爬升的那段是 memory-bound,曲线开始压平的地方就是这张卡的真实转折点。如果转折点远早于 203,说明有别的瓶颈先到了:显存装不下那么大的 batch、kernel 在小 batch 下效率不够、或者 attention 项随 batch × 序列涨上来了。这个发现比背住任何公式都值钱,因为它是自己机器上的事实。
