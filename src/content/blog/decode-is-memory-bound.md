---
title: 'Decode is memory-bound, and the arithmetic says so before you profile'
description: 'One FLOP per byte. That single ratio explains why a batch-size-1 decode step uses under one percent of an A100, and why most "make it faster" instincts are aimed at the wrong resource.'
pubDate: 2026-08-15
regime: memory
tags: ['roofline', 'decode', 'a100']
---

There's a number you can work out on paper, before touching a profiler, that tells you which resource a kernel is actually waiting on. It's called **arithmetic intensity** — `AI = FLOP ÷ bytes moved through HBM`.

Every GPU has a threshold value of AI where it stops being starved for data and starts being limited by its own math units. Below that threshold, adding FLOPs is free and shaving bytes is everything. Above it, the reverse. Knowing which side you're on decides what you should even attempt.

## Where the roof is

Take an A100-80GB (PCIe), running BF16 on tensor cores, no sparsity:

| resource | figure |
| --- | --- |
| peak BF16 throughput | 312 TFLOP/s |
| HBM bandwidth | 1.935 TB/s |
| ridge point | 161 FLOP/byte |

That last row is just the ratio of the two:

```python
PEAK_FLOPS = 312e12    # FLOP/s
HBM_BW     = 1.935e12  # byte/s
RIDGE      = PEAK_FLOPS / HBM_BW   # 161.2 FLOP/byte

def attainable(ai):
    """Best-case throughput for a kernel at arithmetic intensity `ai`."""
    return min(PEAK_FLOPS, HBM_BW * ai)
```

A kernel has to do 161 FLOP for every byte it reads before the A100's compute units are even the constraint. That's a high bar. Read it as: this chip is dramatically better at multiplying than at fetching.

## Where decode actually lands

Now the generation step of an autoregressive model — one sequence, no batching.

To produce one token, the model reads every weight exactly once. For a BF16 model with `N` parameters that's `2N` bytes of traffic. The arithmetic done with those weights is one multiply and one add per parameter, so `2N` FLOP. Which gives:

`AI_decode = 2N FLOP ÷ 2N bytes = 1 FLOP/byte`

The parameter count cancels. It doesn't matter whether the model is 1B or 400B — batch-size-1 decode sits at **AI ≈ 1**, against a ridge point of 161. That's 0.6% of the intensity the hardware wants.

Which means the achievable throughput isn't a mystery to be profiled. It's a division:

`tokens/s ≤ HBM bandwidth ÷ bytes of weights`

For Llama-3-8B, at 8.03B parameters:

| precision | weights | ceiling | latency/token |
| --- | --- | --- | --- |
| BF16 | 16.1 GB | 120 tok/s | 8.3 ms |
| FP8 | 8.0 GB | 241 tok/s | 4.1 ms |
| INT4 | 4.0 GB | 482 tok/s | 2.1 ms |

At the BF16 line the GPU sustains 1.94 TFLOP/s out of 312 — **0.62% utilisation**, while saturating memory bandwidth. Nothing is broken. The chip is running flat out at the only thing it's being asked to do, which is move weights.

These are roofs, not measurements. They ignore KV cache traffic, kernel launch overhead, and the non-GEMM layers, so a real engine lands below them. But the gap between your measured number and this ceiling is the only "how much is left on the table" figure worth trusting.

## The one lever that moves AI

If AI is FLOP over bytes, and the bytes are fixed by model size, the only way up is to do more arithmetic per byte read. That's batching: read the weights once, use them for `B` sequences, and `AI_decode(B) ≈ B`.

So the ridge point has a batch size attached to it. On an A100, decode doesn't become compute-bound until roughly **B = 161**. Every sequence you add below that is close to free — you're getting work out of bandwidth you already paid for.

Close to free, not free, because the KV cache doesn't share. Each sequence reads its own, and that traffic scales with both `B` and context length. For Llama-3-8B — 32 layers, 8 KV heads under GQA, head dim 128 — one token of context costs:

`2 (K and V) × 8 heads × 128 dim × 2 bytes × 32 layers = 128 KiB`

At 8K context that's 1.07 GB per sequence, against 16.1 GB of weights. One sequence: KV is 6% of traffic, ignorable. Sixteen sequences at 8K: 17 GB of KV against 16 GB of weights — the cache now costs more than the model does. The batching win flattens out well before B = 161, and where it flattens depends on how long your contexts are.

That's the real shape of the problem. Not "decode is slow," but: *decode is bandwidth-limited, batching converts bandwidth into throughput, and KV cache traffic is what caps the conversion.*

## What this rules out

Working out the ratio first kills a whole class of plausible-sounding work:

- **Faster matmuls do nothing.** The tensor cores are idle over 99% of the time already. A kernel that's 2× more FLOP-efficient at AI = 1 finishes at exactly the same wall clock.
- **Reducing bytes always works.** Quantisation, GQA, MLA, weight-only compression — these aren't accuracy trades made for their own sake, they're direct multipliers on the ceiling. The precision table above is the whole argument for FP8.
- **Prefill is a different machine.** Processing a prompt touches every weight once for hundreds or thousands of tokens at a time, so AI lands in the hundreds, it's compute-bound, and everything above inverts. Any benchmark that averages prefill and decode together is measuring two unrelated regimes and reporting the mean.

## What I'm checking next

All of the above is a spec sheet and a division. The interesting part is where reality departs from it — my guess is that a naive HuggingFace `generate()` loop lands nowhere near 120 tok/s, and that the gap is kernel launch overhead and unfused elementwise work rather than anything to do with the roofline.

Next post: measuring it with Nsight Systems, and finding out how much of the gap I can actually name.
