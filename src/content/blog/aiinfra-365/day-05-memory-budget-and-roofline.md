---
title: 'Day 5 · 显存花在哪、decode 为什么最快只有 150 token/s：算术强度与 roofline'
description: '把 7B 模型推理时的显存拆成四项算清楚，再用一次除法算出 decode 的物理上限。最后引出整条路线最重要的一个数：ridge point ≈ 153。'
pubDate: 2026-09-03
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

数字口径先说死，免得来回换：模型 Llama-2-7B，32 层、d = 4096、参数 6.74B、fp16。卡是 A100 80GB SXM，BF16 峰值 312 TFLOP/s，HBM 带宽 2039 GB/s。换模型换卡时，重算一遍比记结论有用。

## 显存四项

推理时显存被四类东西占着。前两类前几天算过，后两类今天补上。

**权重**就是模型本身，6.74B 个数字每个 2 字节，13.5 GB。它的特点是固定、常驻。模型文件下载下来多大，进显存就多大，从服务启动到关闭一直在那里不动。batch 多大、序列多长，跟它无关。

**KV cache**是给每个正在处理的 token 存的 k 向量和 v 向量。每 token 512 KB 这个数是 2 × 32 层 × 4096 × 2 字节推出来的（前面那个 2 是 k 和 v 两份，后面那个 2 是 fp16）。它跟权重的性格完全相反：随 batch 和序列长度线性涨，请求一结束就释放。同一个模型，batch 1 和 batch 32 的 KV cache 差 32 倍。

**激活**是算每一层时中间冒出来的临时向量。token 向量乘 W^q 得到 q，乘 W^k 得到 k，FFN 里先变宽再变回来，中间那个 11008 长的向量，这些统称激活。它们的特点是用完就扔：算完这一层，下一层只需要这一层的输出，中间量全部释放。所以激活不像权重那样常驻，也不像 KV cache 那样越攒越多，它只占「当前正在算的这一层」那点地方。

推理时它有多大？最宽的一处就是 FFN 中间那个 11008 长的向量，一个 token 是 11008 × 2 字节 ≈ 22 KB。batch 32 × 2048 = 65536 个 token 同时算的话，65536 × 22 KB ≈ 1.4 GB。跟 KV cache 比是零头。所以推理时激活一般不用操心。训练时才是大头，因为反向传播要把每一层的激活全留着等梯度回来，那时候激活能吃掉几十 GB，那是 M9 的事，现在不管。

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

## 为什么加 batch 几乎不加时间

这是 Day 1 那道验收题「为什么增大 batch size 有时几乎不增加延迟」，现在能用数字答。

batch = 1 时，搬一遍 13.5 GB 权重，只算了 1 个 token。算力这边做了多少活？每个参数一乘一加，2 × 6.74B ≈ 13.5 GFLOP。A100 每秒能算 312 TFLOP，13.5 GFLOP 只要：

```
13.5e9 ÷ 312e12 ≈ 0.043 ms
```

而搬权重要 6.6 ms。算力干活 0.04 毫秒，然后闲等 6.6 毫秒，利用率不到 1%。

batch = 32 时，权重还是只搬一遍，6.6 ms 不变。但这一遍权重对 32 个 token 都用上了，算力干活变成 32 × 0.04 ≈ 1.3 ms，仍然藏在 6.6 ms 的搬运时间里。结果：32 个 token 的总耗时和 1 个 token 几乎一样，吞吐白涨 32 倍。

搬运是固定成本，算力有大量空闲，多带几个 token 一起算是免费的。这就是那句话的全部原因。

那 batch 加到多大算力才开始不够用？也就是算的时间追上搬的时间：6.6 ÷ 0.04 ≈ 165。用精确数字算是 153。到这个 batch，算力和带宽同时忙满，再往上加 batch，搬运时间不变但算的时间开始超过它，延迟开始线性涨。

## 给这件事起个名字：算术强度

刚才的比法换个说法：搬 1 个字节能配多少次计算。这个比值叫算术强度（arithmetic intensity），单位 FLOP/byte。

decode batch 1 的算术强度：每个参数搬 2 字节（fp16），做 2 次计算（一乘一加），2 ÷ 2 = 1 FLOP/byte。注意参数量 N 在分子分母里约掉了，所以这个 1 跟模型大小无关，7B 是 1，70B 也是 1。

A100 这张卡自己也有一个比值：算力除以带宽。

```
312e12 FLOP/s ÷ 2039e9 byte/s ≈ 153 FLOP/byte
```

意思是每搬 1 个字节配 153 次计算，算力和带宽才正好同时忙满。这个数叫 ridge point。用 PCIe 版 A100 算（带宽 1935 GB/s）是 161，数字稍有差别，量级一样，说的是同一件事。

decode batch 1 的强度是 1，ridge point 是 153，差两个数量级。这两个数摆在一起，就是「decode 阶段 GPU 有 99% 的算力在等显存」这句话的来源。

## roofline 图

把上面的事画成图，就是 roofline。横轴是算术强度（对数刻度），纵轴是实际能达到的算力。

```
可达算力
   ^
   |                    ridge point
312|                   ●━━━━━━━━━━━━━━━━━━━━━  横线 = 峰值算力
   |                 ╱   compute-bound 区
   |               ╱     (卡算力，加 batch 没用)
   |             ╱
   |           ╱  斜线 = 带宽 × 强度
   |         ╱    memory-bound 区
   |       ╱      (卡带宽，加 batch 有用)
   |     ╱
   |   ╱
   | ╱
   +---●----------------●---------------------->  算术强度 FLOP/byte
      1               153
   decode           打到这里
   batch 1          才算满
```

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
attainable(153)   # ≈ 3.12e14 → 正好碰到屋顶
attainable(2000)  # = 3.12e14 → 封顶，再高也是这个数
```

`attainable(1)` 算出来约 2 TFLOP/s，除以 312 TFLOP/s 是 0.65%。这就是那个「利用率不到 1%」。

## prefill 和 decode 落在图的两边

同一个模型，两个阶段，在 roofline 上的位置完全不同。

prefill 是把整个 prompt 一次吃进去。prompt 有 2000 个 token 的话，权重搬一遍，对 2000 个 token 都做了计算，相当于 batch 2000，算术强度直接冲到 2000 附近，远超 153。所以 prefill 天然落在横线上，compute-bound，卡算力。

decode 是一次只生成一个 token，batch 1 强度就是 1，天然落在斜线上，memory-bound，卡带宽。

这个区别决定了优化手段完全不同。prefill 卡算力，优化靠提高算力利用率，FlashAttention 那类减少中间量读写让计算单元不空转的手段有用。decode 卡带宽，优化靠减少字节或者让每个字节干更多活：batching 把强度往 153 拉，量化把每个参数从 2 字节压到 1 字节甚至半字节，读的字节少了速度直接上来。

所以以后看到一个推理优化手段，第一个问题永远是：它是在帮 prefill 还是帮 decode，是在挪字节还是挪 FLOP。答不出这个问题，就还没理解那个手段。

## 这张表推出后面所有事

W1 整周算出来的东西，凑成一张表：

| 要算出的数 | 答案 | 怎么来的 |
| --- | --- | --- |
| 权重占用（fp16） | 13.5 GB（约 14 GB） | 6.74e9 × 2 bytes |
| KV cache / token | 512 KB | 2 × 32 层 × 4096 × 2 bytes |
| KV cache @ batch 32 × 2048 tok | 32 GB | 65536 × 512 KB，比权重还大 |
| decode 理论上限（batch 1） | ~150 tok/s | 13.5 GB ÷ 2039 GB/s ≈ 6.6 ms |
| 算术强度（batch 1） | 1 FLOP/byte | 2 FLOP ÷ 2 bytes |
| A100 ridge point | ~153 FLOP/byte | 312 TFLOP/s ÷ 2039 GB/s |
| 打到 compute-bound 需要 | batch ≈ 153 | 上面两行相除 |

13.5 GB 和 14 GB 是同一个数的不同舍入：6.74 × 2 = 13.48，按 1000 进制凑整就说 14 GB。路线图里那张表写的 14 GB 和 145 tok/s，跟这里的 13.5 GB 和 150 tok/s 是同一件事。

这张表为什么是整条路线的起点：batch = 1 时算术强度只有 1，ridge point 是 153，差两个数量级，decode 阶段的 GPU 有 99% 的算力在等显存，每生成一个 token 都要把 13.5 GB 权重完整读一遍。这一个事实推出了后面所有事：

- continuous batching 是吞吐的命门，因为它做的事就是把算术强度从 1 往 153 拉。
- 量化能直接换来速度，因为读的字节少了，同样带宽下搬完权重的时间缩短。
- KV cache 一大就爆显存，而爆显存就装不下更多请求，batch 上不去，强度就拉不上去。KV cache 是 batching 收益的天花板。

M3 到 M8 做的所有优化，读 vLLM 的 scheduler 和 block manager、写 Triton kernel、从零搭最小推理引擎，都是在这张图上挪位置。要么把点往右挪（提高强度），要么把屋顶抬高（换卡、换精度），没有第三种。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| HBM | High Bandwidth Memory，GPU 上的显存。A100 80GB 的 HBM2e 带宽 2039 GB/s |
| 显存带宽 | 每秒能从显存搬多少字节进计算单元。单位 GB/s |
| 峰值算力 | 计算单元全忙时每秒能做多少次浮点运算。A100 BF16 是 312 TFLOP/s（万亿次/秒） |
| FLOP | 一次浮点运算。一乘或一加各算一次，所以每个参数在前向里贡献 2 FLOP |
| 算术强度 | arithmetic intensity，每搬 1 字节做多少 FLOP。单位 FLOP/byte |
| ridge point | 卡的算力 ÷ 带宽，算术强度到这个值时算力和带宽同时忙满。A100 SXM ≈ 153 |
| roofline | 横轴算术强度、纵轴可达算力的图，斜线是带宽限制，横线是算力限制 |
| memory-bound | 算术强度低于 ridge point，时间花在搬数据上，算力闲着 |
| compute-bound | 算术强度高于 ridge point，时间花在算上，带宽有余量 |
| 激活 | activation，前向计算时每层产生的中间向量，推理时用完即弃 |
| 框架开销 | CUDA context、PyTorch 显存池、cuBLAS workspace 等与模型无关的固定占用 |
| prefill | 一次把整个 prompt 喂进模型的阶段，算术强度高，compute-bound |
| decode | 一次生成一个 token 的阶段，算术强度约 1，memory-bound |

## 常见误区

把 TFLOPS 当成能达到的速度。312 TFLOP/s 是屋顶，不是地板。decode batch 1 实际只用到 2 TFLOP/s，剩下 310 在等数据。看到宣传页上的算力数字，先问一句：我的 workload 算术强度多少，够不够爬到屋顶。

只看 nvidia-smi 的 GPU 利用率百分比。那个 util 数字的定义是「过去一段时间里有没有 kernel 在跑」，有 kernel 在跑就算 100%，哪怕那个 kernel 99% 时间在等显存。它测的是「忙不忙」，不是「算力用了多少」。decode 阶段 util 显示 100% 同时算力利用率 0.65%，两个数字都是对的，测的不是一回事。真要看算力利用率得用 profiler 看 tensor core 的活跃周期。

只算权重就说显存够。13.5 GB 的模型放 24 GB 的卡上，看着绰绰有余，一开 batch 就 OOM。因为 KV cache 在 batch 32 × 2048 时是权重的 2.4 倍。算显存必须四项一起算，而且 KV cache 要按你实际要跑的 batch 和序列长度算，不是按 batch 1 算。

把 prefill 和 decode 当成一回事优化。它们在 roofline 上一个在横线一个在斜线，帮 decode 的手段（量化、batching）对 prefill 收益小，帮 prefill 的手段对 decode 也一样。看 benchmark 数字时先问测的是哪个阶段。

## 参考资料

文章

- Making Deep Learning Go Brrrr From First Principles，Horace He。三种瓶颈的原始出处，Day 1 读过，今天的数字全是给它配的。https://horace.io/brrr_intro.html
- Transformer Inference Arithmetic，Kipply。把 KV cache、算术强度、prefill/decode 的账全部算了一遍，跟本文口径基本一致，读它可以对账。https://kipp.ly/transformer-inference-arithmetic/
- Large Transformer Model Inference Optimization，Lilian Weng。从显存和带宽出发讲推理优化的全景，Day 5 之后读正好。https://lilianweng.github.io/posts/2023-01-10-inference-optimization/
- NVIDIA A100 Tensor Core GPU Datasheet。312 TFLOP/s 和 2039 GB/s 的出处，按标题搜索 NVIDIA 官网。
- Roofline: An Insightful Visual Performance Model for Multicore Architectures，Williams、Waterman、Patterson，2009。roofline 模型的原始论文，按标题搜索。

视频

- GPU MODE Lecture 1: How to profile CUDA kernels in PyTorch。讲怎么用 profiler 看到今天纸上算的这些东西，W2 要用。讲义仓库 https://github.com/gpu-mode/lectures ，视频在 GPU MODE 的 YouTube 频道按标题找。

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

搬权重要 6.6 ms，是固定成本，batch 多少都只搬一遍。batch 1 算力只干 0.04 ms 就闲着，batch 32 算 1.3 ms 仍藏在 6.6 ms 里。到 batch ≈ 153 时算的时间追上搬的时间，再往上加延迟开始线性涨。

</details>

4. decode batch 1 的算术强度是多少？为什么和模型大小无关？

<details><summary>答案</summary>

1 FLOP/byte。每个参数搬 2 字节（fp16）做 2 FLOP（一乘一加），参数量 N 在分子分母约掉，所以 7B 和 70B 都是 1。

</details>

5. prefill 和 decode 分别落在 roofline 哪一侧？为什么不同？各自的优化方向是什么？

<details><summary>答案</summary>

prefill 在横线上，compute-bound，因为一次处理几千个 token 相当于 batch 几千，算术强度远超 153。decode 在斜线上，memory-bound，因为一次一个 token 强度只有 1。prefill 优化靠提高算力利用率（如 FlashAttention）；decode 优化靠 batching 拉强度、量化减字节。

</details>

6. 一张卡 nvidia-smi 显示 GPU 利用率 100%，能说明算力用满了吗？

<details><summary>答案</summary>

不能。那个 util 只表示时间窗口内有 kernel 在跑，一个 99% 时间在等显存的 kernel 也算 100%。decode 阶段 util 100% 和算力利用率 0.65% 同时成立。要看算力利用率得用 profiler 看 tensor core 活跃度。

</details>

## 明天预告

Day 6 是 W1 的收口：把这一周从「参数是矩阵里的数字」到「ridge point 153」串成一页笔记，做路线图里那五道验收题，再整理一本错题本，把这周答错的地方（13824 错当 KV cache 的维度、一个头的 q 答成 128 × 128）记下来，看以后还会不会在同一个地方摔。
