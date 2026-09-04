---
title: 'Day 4 · 一次前向多少 FLOPs，以及 KV cache 为什么每个 token 要 512 KB'
description: '把 Day 2 数出来的参数量变成两个能算的数：模型跑一遍要做多少次运算，以及 decode 时为了不重算而缓存下来的 k、v 占多少显存。算完会发现 batch 一大，缓存比权重本身还大。'
pubDate: 2026-09-02
regime: memory
tags: ['flops', 'kv-cache', 'decode', 'aiinfra-365']
series: 'aiinfra-365'
day: 4
lang: 'zh'
---

## 今天要解决的问题

Day 2 把 Llama-2-7B 的 6.74B 个参数一格一格数出来了，Day 3 搞清了 attention 里 q、k、v 各自在干什么。今天把这两样东西变成数字，回答两个问题：

1. 一个 token 从头到尾过一遍模型，GPU 要做多少次运算？
2. 生成第 100 个 token 的时候，前面 99 个 token 的东西哪些要留在显存里，留多大？

第一个问题的答案是 2N，第二个问题的答案是 512 KB。这两个数明天要用来算 decode 的物理上限，所以今天必须自己推出来，不能背。

## FLOP 和 FLOPS 不是一回事

先把两个长得像的词分开。

FLOP 是 floating point operation，一次浮点运算，是个计数单位。做了 100 次乘法就是 100 FLOP。

FLOPS 是 floating point operations per second，每秒能做多少次，是个速度单位。A100 的 312 TFLOPS 说的是每秒 312 万亿次。

所以「这个模型一次前向要 27 TFLOP」是在说工作量，「这张卡有 312 TFLOPS」是在说干活速度，工作量除以速度才是时间。写的时候注意大小写和最后有没有 S，读别人文章时也要看清楚。

还有一个约定：一次乘法加一次加法算 2 FLOP。神经网络里几乎所有运算都是「乘一下，加到累加器上」，所以后面数的时候，每对乘加都记 2。

## 2N 是从哪来的

Day 2 那个 3 行 2 列的小例子再拿出来。向量长 3，矩阵 3×2：

```
[a b c]  ×  [w1 w2]   =  [a·w1 + b·w3 + c·w5 ,  a·w2 + b·w4 + c·w6]
            [w3 w4]
            [w5 w6]
```

数一下运算次数。结果第一个数字：3 次乘法，2 次加法。第二个数字同样 3 次乘、2 次加。合计 6 次乘、4 次加。

注意 6 次乘法正好对应矩阵的 6 个格子，每个格子 w1 到 w6 恰好被乘了一次。加法少了 2 次是因为每列的第一项不需要加，但矩阵一大这点差别就没了，工程上直接按「每个格子一乘一加」记，也就是每个参数 2 FLOP。

矩阵里的格子就是参数。所以一个向量过一个矩阵，运算量 ≈ 2 × 这个矩阵的参数量。

一个 token 过整个模型，就是依次过 embedding、32 层里的所有矩阵、lm_head。每个矩阵都被用一次，每个参数贡献 2 FLOP，加起来就是：

**一个 token 一次前向 ≈ 2 × N FLOP**，N 是总参数量。

7B 代进去：2 × 6.74e9 = 13.48e9 ≈ 13.5 GFLOP。一个 token 135 亿次运算。

如果一次喂进去 T 个 token，每个 token 都要独立过一遍所有矩阵，所以：

**一次前向 ≈ 2 × N × T FLOP**

这条是整个 AI infra 里最常用的估算公式，训练时再乘 3（反向传播大约是前向的两倍），M9 会用到。

顺手说一下 embedding。查表严格说不是矩阵乘法，只是从 32000 行里挑一行出来，几乎不花运算。所以更精确的口径是 2 × (N − embedding 参数量)，但 embedding 只占 7B 的 2%，粗算时忽略没关系。

## attention 里那一项和参数无关

上面的 2N 有一个漏洞。它只数了「向量过矩阵」，但 Day 3 讲过 attention 里还有一步：每个 token 的 q 要和前面所有 token 的 k 算相似度，再按相似度把所有 v 加权混合。这一步没有参数参与，是 token 和 token 之间的运算，所以 2N 里没算进去。

数一下它有多大。序列长 n，d = 4096。

第一步 q 和 k 算相似度。n 个 q，每个要和 n 个 k 各做一次点积，一次点积是 d 长度的乘加，2d FLOP。总共 n × n × 2d = 2n²d。

第二步用相似度加权 v。得到 n×n 的权重表之后，每个 token 的输出是 n 个 v 向量的加权和，每个 v 长 d，也是 2d 一次。总共又是 2n²d。

一层合计 4n²d，32 层就是 4 × L × n² × d。有些文章只算其中一步写成 2Ln²d，量级上差一倍，看到不同数字先确认口径。下面统一用 4Ln²d。

这一项是 n 的平方，参数那项是 n 的一次方。序列短的时候平方项小，序列长了它会追上来。什么时候追上？令两项相等：

2 × N × n = 4 × L × n² × d
n = N / (2 × L × d) = 6.74e9 / (2 × 32 × 4096) ≈ 25,700

按 2Ln²d 的口径算是 51,400。不管哪个口径，结论一样：**几万 token 以上平方项才开始和参数项平起平坐**。常见的 4k、8k 上下文里，参数那项占绝对主导。

| 序列长 n | 参数项 2Nn | attention 项 4Ln²d | attention 占参数项的比例 |
| --- | --- | --- | --- |
| 2,048 | 27.6 TFLOP | 2.2 TFLOP | 8% |
| 8,192 | 110 TFLOP | 35 TFLOP | 32% |
| 32,768 | 442 TFLOP | 563 TFLOP | 127% |
| 131,072 | 1,767 TFLOP | 9,007 TFLOP | 510% |

所以「长上下文贵」不是玄学，是 n² 在表里往下走两行就翻了身。128k 上下文时 attention 的运算量是所有矩阵乘法的五倍，FlashAttention 这类东西就是冲着这一项来的，M5 会写它。

## prefill 和 decode 各花多少

Day 3 末尾提过，一次请求分两段。prefill 是一口气吃掉整个 prompt，decode 是之后一个一个吐 token。两段的运算量差得很远。

prefill 一个 2000 token 的 prompt：2 × 6.74e9 × 2000 ≈ 27 TFLOP。A100 满速 312 TFLOPS，理论上不到 0.1 秒。这一步是真的在算，几万亿次运算一口气做完。

decode 每生成一个 token：参数项 2 × 6.74e9 × 1 = 13.5 GFLOP，外加这个新 token 和前面所有 token 的 attention，4 × 32 × n × 4096 FLOP，n = 2000 时约 1 GFLOP。合计 14.5 GFLOP，是 prefill 的两千分之一。A100 做这点运算只要 0.05 毫秒。

但实际 decode 一个 token 远不止 0.05 毫秒。这个差距是明天 roofline 的全部内容。今天先埋一句：decode 慢不是因为算得多，是因为每生成一个 token 都要把 13.5 GB 的权重从显存里完整读一遍。

## KV cache 到底缓存了什么

decode 阶段，模型正要生成第 100 个 token。这个 token 的 q 要去和前面 99 个 token 的 k 算相似度，再按结果混前面 99 个 token 的 v。那这 99 个 k 和 99 个 v 从哪来？

它们是前面 99 个 token 各自过 attention 层时算出来的。每个 token 的向量乘 W^k 得到它的 k，乘 W^v 得到它的 v。这两个东西**只和那个 token 自己有关**，第 37 个 token 的 k 在生成第 38 个、第 39 个、第 100 个 token 时都是同一个值。

于是有两个选择：

第一种，每一步都重算。生成第 100 个 token 时，把前 99 个 token 重新过一遍 W^k 和 W^v。生成第 101 个时，把前 100 个再过一遍。第 n 步要重算 n 个 token，总共 1 + 2 + ... + n，n² 量级的浪费。

第二种，第一次算出来就存下来。每个 token 的 k 和 v 算好后放在显存里，后面每一步直接拿来用。这就是 KV cache。

所以 KV cache 里存的是：**每一层、每一个已经处理过的 token，它的 k 向量和 v 向量**。注意是每一层，32 层各有自己的 W^k、W^v，算出来的 k、v 都不一样，都要各存一份。

## 为什么不缓存 q

这个问题我第一次答的是「因为每次的 q 都不一样，所以不用存」。这个理由不够准，因为新 token 的 k 和 v 也是新的，每一步都有新的 k、v 产生，「不一样」不是 k、v 和 q 的区别。

真正的区别是**旧的会不会再被用到**。

第 50 个 token 的 k 和 v，在生成第 51、52、……、100 个 token 时每一步都被拿出来用。它们是被查的一方，后面所有 token 都要来查它。

第 50 个 token 的 q，只在生成第 50 个 token 那一步用过一次。它拿着自己去查前面 49 个 token 的 k，查完、混完 v、算出输出，这个 q 就再没有任何地方需要它了。第 51 个 token 有自己的 q，不会用第 50 个的。

一句话：k、v 是被查的，每步都被查，所以要存；q 是来查的，查完就没用，所以不存。用过即弃的东西没有缓存的价值。

这和 Day 3 讲的 q、k 不对称是同一件事的另一面。q 代表「我在找什么」，k 代表「我是什么」。「我是什么」对所有后来者都成立，「我在找什么」只对我自己这一步成立。

## 每个 token 的 KV cache 有多大

现在能算了。用 Day 2 的方法，一步一步。

一个 token 在一层里要存的东西：一个 k 向量，一个 v 向量。k 的长度是 d = 4096，v 也是 4096。所以一层要存 2 × 4096 = 8192 个数字。

fp16 每个数字 2 字节。一层就是 8192 × 2 = 16,384 字节 = 16 KB。

32 层每层都要存，16 KB × 32 = 512 KB。

**Llama-2-7B，fp16，每个 token 的 KV cache = 512 KB，正好半个 MB。**

公式写全：

```
KV cache per token = 2 × L × d × bytes_per_param
                   = 2 × 32 × 4096 × 2
                   = 524,288 bytes = 512 KB
```

第一个 2 是 k 和 v 两份，最后的 2 是 fp16 的字节数，中间是层数乘隐藏维度。

有一个要注意的地方。上面用 d = 4096 是因为 Llama-2-7B 的 k、v 和 q 一样宽。但很多新模型用 GQA（grouped-query attention），多个 q 头共享同一组 k、v 头。比如 Llama-2-70B 和 Llama-3 系列，q 有 32 或 64 个头，k、v 只有 8 个头。这时 k、v 向量的实际长度是 n_kv_heads × head_dim，不是 d。Llama-3-8B 是 8 × 128 = 1024，KV cache 每层只有 2 × 1024 × 2 = 4 KB，32 层 128 KB，比 Llama-2-7B 小四倍。GQA 存在的主要理由就是省这块显存。算之前先查模型配置里的 num_key_value_heads。

## 我犯过的一个错

第一次算 13B 的 KV cache 时，我写的是 2 × 40 × 13824 × 2。

13824 是 Llama-2-13B 的 FFN 中间宽度。它是错的，因为 KV cache 存的是 k 和 v，这两个向量的长度是 d = 5120。13824 只在 FFN 内部出现一下：向量从 5120 变宽到 13824，过个激活函数，再变回 5120。这个中间结果算完就扔，下一个 token 用不到它，所以**FFN 不产生任何需要缓存的东西**。

KV cache 公式里永远不会出现 FFN 宽度。看到自己往公式里代 11008 或 13824，就是想错了位置。

改过来：2 × 40 × 5120 × 2 = 819,200 字节 = 800 KB。13B 每个 token 800 KB。

## 这个数有多大

512 KB 一个 token，听着不多。乘上实际的请求规模看看。

一个请求，prompt 2000 个 token。2000 × 512 KB = 1,024,000 KB ≈ 1 GB。一个请求还没开始生成，光缓存 prompt 就占 1 GB。

推理服务不会一次只跑一个请求。假设 batch 32，每个序列最长 2048 个 token。所有请求的缓存要同时留在显存里，总 token 数 32 × 2048 = 65,536。乘 512 KB = 32 GB。

权重多大？13.5 GB。**KV cache 是权重的 2.4 倍。**

换成 13B 更夸张。800 KB × 65,536 = 50 GB，权重 26 GB，加起来 76 GB。一张 80 GB 的 A100 装完这两样只剩 4 GB 给激活和框架，再多几个请求就爆显存。

```python
def kv_cache_bytes(n_layers, d_kv, n_tokens, bytes_per_param=2):
    """d_kv: 每个 token 的 k 向量长度。MHA 模型等于 d，GQA 模型等于 n_kv_heads * head_dim。"""
    return 2 * n_layers * d_kv * bytes_per_param * n_tokens

GB = 1024 ** 3

# Llama-2-7B, batch 32 x 2048
print(kv_cache_bytes(32, 4096, 32 * 2048) / GB)   # 32.0
# Llama-2-13B
print(kv_cache_bytes(40, 5120, 32 * 2048) / GB)   # 50.0
# Llama-3-8B, GQA, 8 kv heads x 128
print(kv_cache_bytes(32, 1024, 32 * 2048) / GB)   # 8.0
```

这个对比是今天最该记住的结论：**batch 一大，KV cache 就超过权重，而且远超。**

它直接推出后面两个月要学的东西。想提高吞吐就要加大 batch，加大 batch 就要给 KV cache 腾显存，显存是有限的，所以怎么精打细算地管 KV cache 成了推理引擎的核心问题。vLLM 的 PagedAttention 就是把 KV cache 像操作系统管内存那样分页管理，不再为每个请求预留 2048 个 token 的连续空间，而是按实际长度分块分配。这一项改动让 vLLM 比当时的 HuggingFace 推理快了十几倍，靶子就是今天算的这个 32 GB。M3 读源码时会回到这里。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| FLOP | floating point operation，一次浮点运算，计数单位。一次乘加记 2 FLOP |
| FLOPS | 每秒浮点运算次数，速度单位。A100 fp16/bf16 约 312 TFLOPS |
| GFLOP / TFLOP | 10⁹ / 10¹² FLOP |
| 前向（forward） | 输入过一遍模型得到输出的过程，推理只有前向 |
| 2N 公式 | 一个 token 一次前向 ≈ 2 × 参数量 FLOP，来源是每个参数被乘一次加一次 |
| attention 平方项 | q 和 k 算相似度、权重混 v 这两步的运算量，≈ 4 × L × n² × d，和参数无关，和序列长度平方成正比 |
| prefill | 一次吃掉整个 prompt 的阶段，运算量大 |
| decode | 之后每次生成一个 token 的阶段，每步运算量小但要读全部权重 |
| KV cache | 每层、每个已处理 token 的 k 向量和 v 向量，存下来避免每步重算 |
| MHA | multi-head attention，k、v 头数等于 q 头数，k、v 长度 = d |
| GQA | grouped-query attention，多个 q 头共享一组 k、v 头，k、v 长度 = n_kv_heads × head_dim，KV cache 小很多 |
| PagedAttention | vLLM 的 KV cache 分块管理方式，按需分配、不预留连续大块 |

## 常见误区

把 FLOP 和 FLOPS 混用。一个是工作量一个是速度，除一下才是时间。

以为 attention 是运算量大头。4k 上下文里 attention 只占矩阵乘法的 8%，几万 token 以上才反超。短序列的优化重点不在 attention 的运算量上。

把 FFN 宽度代进 KV cache 公式。FFN 中间结果用完就扔，KV cache 里只有 k 和 v，长度是 d 或 n_kv_heads × head_dim。

以为 KV cache 是「一个」缓存。它是每层一份，32 层就是 32 份，公式里的 L 不能漏。

拿 Llama-2 的 512 KB 去套所有 7B 模型。GQA 模型的 KV cache 可以小到四分之一，先查 num_key_value_heads。

以为 decode 慢是因为算得多。decode 每步只有 14 GFLOP，A100 做完不到 0.1 毫秒。慢在别处，明天讲。

## 参考资料

文章

- Horace He，《Making Deep Learning Go Brrrr From First Principles》，https://horace.io/brrr_intro.html 。Day 1 读过的那篇，2N 和「算得少但慢」的直觉都从这里来。
- Kipply，《Transformer Inference Arithmetic》，https://kipp.ly/transformer-inference-arithmetic/ 。逐项算 FLOPs、KV cache、延迟的文章，今天的内容基本是它的中文重走，读它可以对答案。
- Lilian Weng，《Large Transformer Model Inference Optimization》，https://lilianweng.github.io/posts/2023-01-10-inference-optimization/ 。推理优化的全景综述，KV cache 和后面几周的量化、蒸馏都在里面。
- Kwon 等，《Efficient Memory Management for Large Language Model Serving with PagedAttention》，arXiv 2309.06180。vLLM 论文，第 2、3 节讲的就是今天算的「KV cache 比权重大、还碎片化」这个问题。
- Ainslie 等，《GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints》，arXiv 2305.13245。GQA 原始论文，想知道为什么 k、v 头可以比 q 头少就看它。

视频

- B 站上 KV cache 的讲解视频不少，按「KV cache」关键词搜，挑一个带矩阵图示的看。看完自己推 512 KB，推不出来就是没看懂。
- bbycroft 的 LLM 3D 可视化，https://bbycroft.net/llm 。能看到每一层的 k、v 矩阵尺寸，对着它数一遍今天的公式。

## 自测

合上笔记做。

**1. Llama-2-7B 一次前向处理 4096 个 token，大约多少 TFLOP？只算参数项。**

<details><summary>答案</summary>

2 × N × T = 2 × 6.74e9 × 4096 ≈ 55.2e12 ≈ 55 TFLOP。

</details>

**2. 为什么 attention 的 q·k 那一步不算在 2N 里？它的运算量和什么成正比？**

<details><summary>答案</summary>

2N 数的是「向量过参数矩阵」，每个参数一乘一加。q·k 是 token 和 token 之间的点积，没有参数参与，所以不在 2N 里。它的运算量 ≈ 4 × L × n² × d（两步各 2n²d），和序列长度 n 的平方成正比，和参数量无关。

</details>

**3. 为什么缓存 k 和 v 却不缓存 q？「每次的 q 都不一样」这个理由为什么不够？**

<details><summary>答案</summary>

不够是因为新 token 的 k、v 也是新的，「不一样」不是区别。真正的区别是旧的会不会再被用到。第 50 个 token 的 k、v 在生成第 51 到第 n 个 token 时每一步都被查，所以要存；第 50 个 token 的 q 只在生成第 50 个 token 那一步用过一次，之后永不需要，用过即弃，没有缓存的价值。

</details>

**4. Llama-2-13B（40 层，d = 5120，FFN 13824），fp16，每个 token 的 KV cache 多少 KB？写出算式。**

<details><summary>答案</summary>

2 × 40 × 5120 × 2 = 819,200 字节 = 800 KB。

注意用 5120 不是 13824。FFN 宽度不会出现在 KV cache 公式里。

</details>

**5. 13B 模型，batch 32，每个序列 2048 token，KV cache 总共多少 GB？和 26 GB 的权重比谁大？**

<details><summary>答案</summary>

总 token 数 32 × 2048 = 65,536。乘 800 KB = 52,428,800 KB = 50 GB。是权重的近 2 倍。加上权重 76 GB，80 GB 的 A100 只剩 4 GB。

</details>

**6. Llama-3-8B 用 GQA，32 层，8 个 kv 头，head_dim 128。每个 token 的 KV cache 是 Llama-2-7B 的几分之一？**

<details><summary>答案</summary>

k、v 长度 = 8 × 128 = 1024。每 token = 2 × 32 × 1024 × 2 = 131,072 字节 = 128 KB。Llama-2-7B 是 512 KB，所以是四分之一。

</details>

## 明天预告

今天算出了两个矛盾的数：decode 一步只要 14 GFLOP，A100 不到 0.1 毫秒就能算完；但每一步又要把 13.5 GB 权重从显存读一遍。明天把显存四项（权重、KV cache、激活、框架开销）摆到一张表上，然后用显存带宽算出 decode 每秒最多生成多少个 token。那个数会告诉你为什么整个推理优化都绕不开 batching。
