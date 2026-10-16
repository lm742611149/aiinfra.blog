---
title: 'Day 6 · W1 复习：一页笔记、五道验收题、错题本与 13B 全解'
description: '把第一周所有公式和数字压成一页，合上笔记做完五道验收题，再把这周犯过的错一条条摊开。算不出数字就是没过，跟读了几篇文章没关系。'
pubDate: 2026-09-04
regime: memory
tags: ['review', 'quiz', 'week-1', 'aiinfra-365']
series: 'aiinfra-365'
day: 6
lang: 'zh'
---

## 这一周解决了什么

W1 的目标只有一句话:能回答「一个 7B 模型推理的时候,显存和算力到底花在哪」。

三周前我连 transformer 里有几个矩阵都说不出来,唯一的基础是读了 Horace He 那篇 Brrrr。现在合上所有资料,我可以从 Llama-2-7B 的配置文件出发,一路算到 6.74B 参数、13.5 GB 权重、每个 token 512 KB 的 KV cache、batch 1 时每秒最多 150 个 token,并且说出为什么是这些数,以及 batch 开到 153 左右算力才开始成为瓶颈。

这些数字本身不重要,换一个模型换一张卡就全变了。重要的是算法:参数量藏在矩阵形状里,矩阵形状是「输入长度 × 输出长度」,显存是参数乘字节数,速度上限是带宽除以要搬的字节。这四条会一直用到 M12。

这篇是 W1 的收口。先把所有东西压成一页,然后做题,然后把错题摊开,最后把 13B 的练习从头到尾重算一遍留底。


<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="W1 知识地图:从模型配置一路推到 memory-bound 结论的三条链">
  <defs>
    <marker id="d6arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="var(--ink-faint)"/>
    </marker>
  </defs>
  <text x="10" y="18" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">链 1 · 权重多大、搬一遍多久</text>
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
    <rect x="10" y="28" width="110" height="58" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="65" y="47" text-anchor="middle">配置文件</text>
    <text x="65" y="63" text-anchor="middle" fill="var(--ink-soft)">L=32 d=4096</text>
    <text x="65" y="78" text-anchor="middle" fill="var(--ink-soft)">d_ff=11008 V=32k</text>
    <rect x="136" y="28" width="110" height="58" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="191" y="47" text-anchor="middle">矩阵形状</text>
    <text x="191" y="63" text-anchor="middle" fill="var(--ink-soft)">输入长 × 输出长</text>
    <text x="191" y="78" text-anchor="middle" fill="var(--ink-soft)">格子数 = 参数数</text>
    <rect x="262" y="28" width="110" height="58" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="317" y="47" text-anchor="middle">参数量</text>
    <text x="317" y="63" text-anchor="middle" fill="var(--ink-soft)">32×202.4M+0.26B</text>
    <text x="317" y="78" text-anchor="middle" font-weight="700">= 6.74B</text>
    <rect x="388" y="28" width="110" height="58" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="443" y="47" text-anchor="middle">权重字节</text>
    <text x="443" y="63" text-anchor="middle" fill="var(--ink-soft)">6.74B × 2 B</text>
    <text x="443" y="78" text-anchor="middle" font-weight="700" fill="var(--mem)">= 13.5 GB</text>
    <rect x="514" y="28" width="116" height="58" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="572" y="47" text-anchor="middle">搬一遍</text>
    <text x="572" y="63" text-anchor="middle" fill="var(--ink-soft)">÷ 2039 GB/s</text>
    <text x="572" y="78" text-anchor="middle" font-weight="700" font-size="10" fill="var(--mem)">6.6 ms ≈ 150 tok/s</text>
  </g>
  <g stroke="var(--ink-faint)" stroke-width="1.2" fill="none" marker-end="url(#d6arr)">
    <path d="M120 57 L134 57"/><path d="M246 57 L260 57"/><path d="M372 57 L386 57"/><path d="M498 57 L512 57"/>
  </g>

  <text x="10" y="122" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">链 2 · 每个字节配多少计算</text>
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
    <rect x="10" y="132" width="180" height="58" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="100" y="151" text-anchor="middle">每参数 2 FLOP,搬 2 B</text>
    <text x="100" y="167" text-anchor="middle" fill="var(--ink-soft)">N 在分子分母约掉</text>
    <text x="100" y="182" text-anchor="middle" font-weight="700">算术强度 = 1</text>
    <rect x="230" y="132" width="180" height="58" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="320" y="151" text-anchor="middle">卡的 ridge point</text>
    <text x="320" y="167" text-anchor="middle" fill="var(--ink-soft)">312 TFLOP/s ÷ 2039 GB/s</text>
    <text x="320" y="182" text-anchor="middle" font-weight="700" fill="var(--compute)">≈ 153 FLOP/byte</text>
    <rect x="450" y="132" width="180" height="58" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="540" y="151" text-anchor="middle">1 ≪ 153</text>
    <text x="540" y="167" text-anchor="middle" fill="var(--ink-soft)">算力利用率 0.65%</text>
    <text x="540" y="182" text-anchor="middle" font-weight="700" fill="var(--mem)">decode memory-bound</text>
  </g>
  <g stroke="var(--ink-faint)" stroke-width="1.2" fill="none" marker-end="url(#d6arr)">
    <path d="M190 161 L228 161"/><path d="M410 161 L448 161"/>
  </g>

  <text x="10" y="226" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">链 3 · batch 一大谁超过谁</text>
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
    <rect x="10" y="236" width="180" height="58" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="100" y="255" text-anchor="middle">只用 L 和 d</text>
    <text x="100" y="271" text-anchor="middle" fill="var(--ink-soft)">2 × 32 × 4096 × 2 B</text>
    <text x="100" y="286" text-anchor="middle" font-weight="700">KV 512 KB / token</text>
    <rect x="230" y="236" width="180" height="58" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="320" y="255" text-anchor="middle">batch 32 × 2048</text>
    <text x="320" y="271" text-anchor="middle" fill="var(--ink-soft)">65536 token × 512 KB</text>
    <text x="320" y="286" text-anchor="middle" font-weight="700">= 32 GB</text>
    <rect x="450" y="236" width="180" height="58" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="540" y="255" text-anchor="middle">32 GB &gt; 13.5 GB</text>
    <text x="540" y="271" text-anchor="middle" fill="var(--ink-soft)">缓存是权重的 2.4 倍</text>
    <text x="540" y="286" text-anchor="middle" font-weight="700" fill="var(--mem)">batch 的天花板</text>
  </g>
  <g stroke="var(--ink-faint)" stroke-width="1.2" fill="none" marker-end="url(#d6arr)">
    <path d="M190 265 L228 265"/><path d="M410 265 L448 265"/>
  </g>
  <text x="10" y="320" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">口径:Llama-2-7B fp16 · A100 80GB SXM。蓝 = 带宽侧的结论,琥珀 = 算力侧的数。</text>
</svg>
<figcaption>W1 的全部内容就是这三条链。每个箭头都是一步四则运算,任何一格答不上来就回那一天重读。链 1 和链 2 合在一起得出「decode 是 memory-bound」,链 3 得出「KV cache 决定 batch 能开多大」。</figcaption>
</figure>

## 一页笔记

以下全部以 Llama-2-7B、fp16、A100 80GB SXM 为口径。

模型配置:

| 符号 | 含义 | 7B 的值 |
| --- | --- | --- |
| L | 层数 | 32 |
| d | 隐藏维度 (hidden size) | 4096 |
| h | 注意力头数 | 32 |
| d_head | 每头维度 = d / h | 128 |
| d_ff | FFN 中间宽度 | 11008 |
| V | 词表大小 | 32000 |

硬件:

| 项 | A100 80GB SXM |
| --- | --- |
| BF16/FP16 峰值算力 | 312 TFLOP/s |
| HBM 显存带宽 | 2039 GB/s |
| ridge point = 算力 ÷ 带宽 | ≈ 153 FLOP/byte |

公式清单,八条:

1. 参数量 `N = 2·V·d + L·(4·d² + 3·d·d_ff)`。第一项是 embedding 和 lm_head 两张表,第二项是每层的 4 个注意力方阵加 3 个 FFN 矩阵。
2. 权重字节 `= N × 每个数的字节数`。fp16 是 2 字节,int8 是 1,int4 是 0.5。
3. 每个 token 的前向 FLOPs `≈ 2·N`。每个参数一次乘一次加。
4. attention 里和序列长度有关的额外项 `≈ 2·L·n²·d`,n 是序列长度。n 小时可以忽略,n 到几千以后开始追上 2N。
5. KV cache 每 token `= 2 × L × d × 2 字节`。第一个 2 是 k 和 v 两份,最后一个 2 是 fp16。
6. decode 速度上限(batch 1)`= 带宽 ÷ 权重字节`。
7. 算术强度 `= FLOP ÷ 搬运的字节`。decode batch 1 时 ≈ 1。
8. ridge point `= 峰值算力 ÷ 带宽`。算术强度低于它卡带宽,高于它卡算力。

上面第 1 条和第 5 条写的是 Llama-2 这种 k、v 头数等于 q 头数(MHA)的情况。很多新模型用 GQA,k、v 只有 n_kv 个头,这两条要改成通式,MHA 只是 n_kv = h 的特例:

- 一层注意力参数 `= 2·d² + 2·d·(n_kv·d_head)`。W^q 和 W^o 仍是 d × d,W^k 和 W^v 变成 d × (n_kv·d_head)。
- KV cache 每 token `= 2 × L × (n_kv·d_head) × 字节数`。

n_kv = h 时 n_kv·d_head = d,退回原来的式子。算任何新模型之前先去 config 里找 `num_key_value_heads`,这是 Day 4 就提过、下面加练二会真用一次的坑。

代入 7B 得到 W1 那张七行表:

| 要算出的数 | 答案 | 怎么来的 |
| --- | --- | --- |
| 权重占用 (fp16) | 13.5 GB | 6.74e9 × 2 bytes |
| KV cache / token | 512 KB | 2 × 32 × 4096 × 2 bytes |
| KV cache @ batch 32 × 2048 tok | 32 GB | 65536 × 512 KB,比权重还大 |
| decode 理论上限 (batch 1) | ~150 tok/s | 2039 GB/s ÷ 13.5 GB |
| 算术强度 (batch 1) | 1 FLOP/byte | 2 FLOP ÷ 2 bytes |
| A100 ridge point | ~153 FLOP/byte | 312 TFLOP/s ÷ 2039 GB/s |
| 打到 compute-bound 需要 | batch ≈ 153 | 整周最重要的一个数 |

显存四项,batch 32 × 2048 的场景:

| 项 | 大小 | 占比 | 随什么变 |
| --- | --- | --- | --- |
| 权重 | 13.5 GB | 28% | 只随模型和精度变,常驻 |
| KV cache | 32 GB | 67% | 随 batch × 序列长度线性涨,请求结束释放 |
| 激活 | ~1.4 GB | 3% | 随 batch 变,当前层算完就释放 |
| 框架开销 | ~1.5 GB | 3% | 基本固定,CUDA context + 显存池 |


<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="7B 与 13B 在 batch 32 × 2048 时四项显存占用的堆叠条,和 80 GB 上限线的对比">
  <text x="10" y="18" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">batch 32 × 2048 token · fp16 · 一格 = 6.5 px / GB</text>
  <g stroke="var(--rule-soft)" stroke-width="1">
    <line x1="100" y1="30" x2="100" y2="150"/><line x1="230" y1="30" x2="230" y2="150"/>
    <line x1="360" y1="30" x2="360" y2="150"/><line x1="490" y1="30" x2="490" y2="150"/>
  </g>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
    <text x="100" y="164" text-anchor="middle">0</text><text x="230" y="164" text-anchor="middle">20 GB</text>
    <text x="360" y="164" text-anchor="middle">40 GB</text><text x="490" y="164" text-anchor="middle">60 GB</text>
    <text x="620" y="164" text-anchor="middle">80 GB</text>
  </g>
  <line x1="620" y1="28" x2="620" y2="152" stroke="var(--compute)" stroke-width="1.5" stroke-dasharray="4 3"/>
  <text x="616" y="40" text-anchor="end" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">A100 80 GB 上限</text>

  <text x="90" y="72" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">7B</text>
  <rect x="100" y="56" width="87.75" height="24" fill="var(--mem)"/>
  <rect x="187.75" y="56" width="208" height="24" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1"/>
  <rect x="395.75" y="56" width="9.1" height="24" fill="var(--ink-faint)"/>
  <rect x="404.85" y="56" width="9.75" height="24" fill="var(--rule)"/>
  <text x="143" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--paper-raised)">13.5</text>
  <text x="291" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">KV 32 GB</text>
  <text x="422" y="72" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">合计 48.4 GB,还剩 31.6</text>

  <text x="90" y="122" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">13B</text>
  <rect x="100" y="106" width="169" height="24" fill="var(--mem)"/>
  <rect x="269" y="106" width="325" height="24" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1"/>
  <rect x="594" y="106" width="11.7" height="24" fill="var(--ink-faint)"/>
  <rect x="605.7" y="106" width="9.75" height="24" fill="var(--rule)"/>
  <text x="184" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--paper-raised)">26</text>
  <text x="431" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">KV 50 GB</text>
  <text x="431" y="145" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">合计 79.3 GB,离上限只差 0.7 GB</text>

  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">
    <rect x="100" y="184" width="12" height="10" fill="var(--mem)"/><text x="117" y="193">权重</text>
    <rect x="170" y="184" width="12" height="10" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="187" y="193">KV cache</text>
    <rect x="262" y="184" width="12" height="10" fill="var(--ink-faint)"/><text x="279" y="193">激活</text>
    <rect x="332" y="184" width="12" height="10" fill="var(--rule)"/><text x="349" y="193">框架开销</text>
  </g>
</svg>
<figcaption>同一个 batch 32 × 2048 的场景,7B 还剩 30 多 GB,13B 已经贴着 80 GB 的上限。两条里 KV cache 都是最长的一段:它不是权重的零头,是权重的两倍多。13B 的激活按 d_ff = 13824 算,65536 × 13824 × 2 B ≈ 1.8 GB。</figcaption>
</figure>

参数量对账过程,留一份免得下次又要重推:

| 部件 | 算式 | 参数 |
| --- | --- | --- |
| embedding | 32000 × 4096 | 131.1M |
| lm_head | 4096 × 32000 | 131.1M |
| 一层注意力 (W^q W^k W^v W^o) | 4 × 4096 × 4096 | 67.1M |
| 一层 FFN (gate, up, down) | 3 × 4096 × 11008 | 135.3M |
| 一层合计 | 67.1M + 135.3M | 202.4M |
| 32 层 | 202.4M × 32 | 6.48B |
| 总计 | 6.48B + 0.26B | 6.74B |

## 五道验收题

路线图上写的是「合上笔记,五道全对才算过」。下面是我合上笔记后写的答案,写完再对照上面的一页笔记核对过。每题先自己答,再展开。


<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="五道验收题分别落在 W1 哪几天的知识上">
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
    <rect x="10" y="14" width="300" height="34" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="20" y="35">Q1 · 显存四项各占多少</text>
    <rect x="10" y="60" width="300" height="34" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="20" y="81">Q2 · KV cache 会不会超过权重</text>
    <rect x="10" y="106" width="300" height="34" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="20" y="127">Q3 · 一个 token 最快多久,由什么决定</text>
    <rect x="10" y="152" width="300" height="34" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="20" y="173">Q4 · prefill / decode 各卡在哪</text>
    <rect x="10" y="198" width="300" height="34" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="20" y="219">Q5 · batching 涨吞吐不降延迟</text>
  </g>
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
    <rect x="460" y="14" width="170" height="34" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="470" y="35">Day 1 三种瓶颈</text>
    <rect x="460" y="60" width="170" height="34" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="470" y="81">Day 2 矩阵与参数量</text>
    <rect x="460" y="106" width="170" height="34" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="470" y="127">Day 3 注意力与自回归</text>
    <rect x="460" y="152" width="170" height="34" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="470" y="173">Day 4 FLOPs 与 KV cache</text>
    <rect x="460" y="198" width="170" height="34" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="470" y="219" fill="var(--mem)">Day 5 显存四项与 roofline</text>
  </g>
  <g stroke="var(--mem)" stroke-width="1.6" fill="none" opacity="0.9">
    <path d="M310 31 C 400 31, 400 215, 460 215"/>
    <path d="M310 77 C 400 77, 400 215, 460 215"/>
    <path d="M310 123 C 400 123, 400 215, 460 215"/>
    <path d="M310 169 C 400 169, 400 215, 460 215"/>
    <path d="M310 215 L 460 215"/>
  </g>
  <g stroke="var(--ink-faint)" stroke-width="1" fill="none" stroke-dasharray="3 3">
    <path d="M310 77 C 400 77, 400 169, 460 169"/>
    <path d="M310 123 C 400 123, 400 77, 460 77"/>
    <path d="M310 169 C 400 169, 400 123, 460 123"/>
    <path d="M310 215 C 400 215, 400 31, 460 31"/>
  </g>
  <text x="390" y="244" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">实线 = 主要考点,虚线 = 要用到的前置</text>
</svg>
<figcaption>五道题全部汇到 Day 5,但每一道都要拉一天的前置才能答完整:Q2 要 Day 4 的 KV cache 公式,Q3 要 Day 2 的参数到字节,Q4 要 Day 3 的 prefill 和 decode 区别,Q5 要 Day 1 的三种瓶颈。哪条虚线断了,就是哪天没学扎实。</figcaption>
</figure>

### 第一题:7B fp16 模型推理时显存怎么分配?给出各项的百分比

场景取 batch 32、每个序列 2048 token。

<details><summary>答案</summary>

四项:权重、KV cache、激活、框架开销。

权重是模型本身,6.74B 个参数 × 2 字节 = 13.5 GB。训练好就不变,推理时整块常驻显存。

KV cache 是每个 token 在每一层留下的 k 向量和 v 向量。每 token 2 × 32 层 × 4096 × 2 字节 = 512 KB。batch 32 × 2048 = 65536 个 token 同时在缓存里,65536 × 512 KB = 32 GB。

激活是算当前这一层时冒出来的临时向量,最宽的一处是 FFN 中间那个 11008 长的向量,每 token 11008 × 2 字节 ≈ 22 KB,65536 个 token ≈ 1.4 GB。算完这一层就释放,所以只占「当前正在算的层」那点地方。

框架开销是 CUDA context、PyTorch 显存池、cuBLAS 工作区,经验值 1 到 2 GB,取 1.5 GB。

总计约 48.4 GB,占比:权重 28%,KV cache 67%,激活 3%,框架 3%。

关键结论是 batch 一大 KV cache 就超过权重,而且是两倍多。batch 降到 1 时权重和框架开销不变,KV cache 和激活缩小 32 倍,权重就变成大头。

</details>

### 第二题:batch 32、seq 2048 时 KV cache 多大?会不会超过权重?超过多少?

<details><summary>答案</summary>

总 token 数 32 × 2048 = 65536。每 token 512 KB。

65536 × 512 KB = 33,554,432 KB = 32768 MB = 32 GB。

权重 13.5 GB。32 ÷ 13.5 ≈ 2.4,KV cache 是权重的 2.4 倍,多出 18.5 GB。

在 80 GB 的卡上,权重加缓存已经 45.5 GB,再加激活和框架开销剩不到 30 GB。batch 再翻一倍就装不下。这就是推理服务里 batch 不能随便开大的原因,也是 vLLM 用 PagedAttention 把 KV cache 按块管理的全部动机。

</details>

### 第三题:decode 生成一个 token 的理论最快时间是多少?这个下限由什么决定?

<details><summary>答案</summary>

decode 每生成一个 token,要把全部权重从显存搬进计算单元一遍。13.5 GB ÷ 2039 GB/s ≈ 6.6 ms。倒过来每秒最多约 150 个 token。

这个下限由**显存带宽**和**权重字节数**决定,和算力无关。算力这边做的活是 2 × 6.74B ≈ 13.5 GFLOP,在 312 TFLOP/s 上只要 0.04 ms,然后闲等 6.6 ms 搬运结束。算力利用率不到 1%。

所以缩短这个时间只有两条路:换带宽更高的卡,或者让权重字节变少(量化)。int8 权重减半,上限翻倍到 300 tok/s;int4 再翻倍。这是量化能直接换速度的原因,读的字节少了。

</details>

### 第四题:prefill 和 decode 分别是 compute-bound 还是 memory-bound?为什么不同?

<details><summary>答案</summary>

prefill 是 compute-bound,decode 是 memory-bound。

两个阶段搬的权重一样,都是把 13.5 GB 读一遍。差别在这一遍权重服务了多少个 token。

prefill 一次把整个 prompt 吃进去。prompt 2000 个 token,权重读一遍,算 2000 个 token 的 2N FLOPs。算术强度 ≈ 2000 FLOP/byte,远超 153 的 ridge point,所以卡在算力。

decode 每步只生成 1 个 token。权重读一遍只算 1 个 token,算术强度 ≈ 1,离 153 差两个数量级,卡在带宽。

同一个模型,两个阶段落在 roofline 图的两边,优化手段完全不同。prefill 要减少 FLOPs 或者用更快的 kernel,decode 要减少字节或者堆 batch。

</details>

### 第五题:为什么 continuous batching 能大幅提升吞吐,却几乎不改善单请求延迟?

<details><summary>答案</summary>

吞吐涨,是因为 batch 把算术强度拉高了。batch 1 时搬一遍权重服务 1 个 token,batch 32 时搬同一遍权重服务 32 个 token。搬运时间 6.6 ms 不变,算力干活从 0.04 ms 变成 1.3 ms,仍然藏在搬运时间里。结果 32 个 token 的总耗时和 1 个 token 几乎一样,每秒产出 token 数涨 32 倍。continuous batching 的作用是让 batch 一直保持满,请求随到随进,不用等一整批做完再进下一批。

单请求延迟不变,是因为每生成一个 token 仍然要等权重完整搬一遍。这 6.6 ms 是物理下限,不会因为旁边多了 31 个搭车的请求就变短。batch 只是让别人搭车,车速不变。实际上 batch 大了以后算力时间从 0.04 ms 涨到 1.3 ms,KV cache 读取也多了,单 token 延迟还会略增。

一句话:batch 提高的是每秒总产量,不是单个请求的速度。这个区别在 M3 测 vLLM 时会用数字验证。

</details>

五道题的答案都能自己写出来,每一步的数字都能说出怎么来的。W1 过了。

## 加练:Llama-2-13B 全解

这是学完 7B 后自己算的题,把每一步留下来。配置:L = 40,d = 5120,d_ff = 13824,V = 32000,fp16。

第一步,词表两头。两张表各 32000 × 5120。

`2 × 32000 × 5120 = 327,680,000 ≈ 327.68M`

第二步,一层注意力。4 个 5120 × 5120 的方阵。

`4 × 5120 × 5120 = 4 × 26,214,400 = 104,857,600 ≈ 104.9M`

第三步,一层 FFN。3 个 5120 × 13824 的矩阵。

`3 × 5120 × 13824 = 3 × 70,778,880 = 212,336,640 ≈ 212.3M`

第四步,一层合计。

`104.9M + 212.3M = 317.2M`

第五步,40 层。

`317.2M × 40 = 12,688M ≈ 12.69B`

第六步,总参数。

`12.69B + 0.328B = 13.02B`

对账成功,官方叫 13B。

第七步,权重显存。

`13.02B × 2 bytes = 26.04 GB ≈ 26 GB`

第八步,KV cache 每 token。注意这里用 d = 5120,不是 d_ff = 13824。

`2 × 40 × 5120 × 2 = 819,200 bytes = 800 KB`

第九步,batch 32 × 2048 的 KV cache。

`65536 × 800 KB = 52,428,800 KB = 51,200 MB = 50 GB`

权重 26 GB,KV cache 50 GB,缓存约为权重的 2 倍。在 80 GB 的卡上装完权重加缓存只剩 4 GB,再多几个请求就爆。

第十步,decode 上限。

`2039 GB/s ÷ 26 GB ≈ 78 tok/s`

模型参数翻倍,上限减半,因为要搬的字节翻倍了。


## 加练二:换卡换模型重算一遍(H100、Llama-3-8B)

W1 那张表的数字只对 7B 加 A100 成立。要检验是不是真学会了算法而不是背下了答案,最好的办法是换一组输入再算一遍。这里换两样:卡换成 H100 SXM,模型换成 Llama-3-8B。两样各带一个新坑。

### H100 换的是屋顶

H100 SXM 的规格表上两个数:HBM3 带宽 3350 GB/s,BF16 稠密算力 989 TFLOP/s。规格表上还有一个 1979 TFLOP/s,那是「with sparsity」的数,要求权重一半是零,普通推理用不上,做估算一律取稠密值。A100 同样有 312 和 624 两个数,W1 用的一直是 312。

带宽从 2039 涨到 3350,是 1.64 倍。算力从 312 涨到 989,是 3.17 倍。算力涨得比带宽多,所以 ridge point 往右挪了:

`989e12 ÷ 3350e9 ≈ 295 FLOP/byte`

这意味着同样的 decode,H100 上要开到 batch ≈ 295 才能把算力喂饱,比 A100 的 153 还难。卡越新,越 memory-bound,这是近几代 GPU 的共同趋势,也是为什么推理优化的重心一直在字节上。

7B 在 H100 上的 decode 上限:

`3350 GB/s ÷ 13.5 GB ≈ 248 tok/s`

从 150 到 248,和带宽的 1.64 倍完全一致,算力涨的那 3 倍在 batch 1 时一点没用上。

### Llama-3-8B 换的是模型,带 GQA 的坑

配置:L = 32,d = 4096,h = 32,d_head = 128,**n_kv = 8**,d_ff = 14336,V = 128256,fp16。和 7B 比,层数和 d 完全一样,变的是三处:词表翻了四倍、FFN 更宽、k 和 v 只有 8 个头。

第一步,词表两头。Llama-3 的 embedding 和 lm_head 不共享,两张表各 128256 × 4096。

`2 × 128256 × 4096 = 1,050,673,152 ≈ 1.05B`

光两张表就超过 10 亿,是 7B 那两张表(0.26B)的四倍。

第二步,一层注意力,用通式。W^q 和 W^o 仍是 4096 × 4096,W^k 和 W^v 是 4096 × (8 × 128) = 4096 × 1024。

`2 × 4096 × 4096 + 2 × 4096 × 1024 = 33,554,432 + 8,388,608 = 41,943,040 ≈ 41.9M`

7B 的一层注意力是 67.1M,GQA 把它砍掉了 37%。

第三步,一层 FFN。

`3 × 4096 × 14336 = 176,160,768 ≈ 176.2M`

第四步,一层合计。

`41.9M + 176.2M = 218.1M`

第五步,32 层。

`218.1M × 32 = 6,979M ≈ 6.98B`

第六步,总参数。

`6.98B + 1.05B = 8.03B`

对账成功,官方叫 8B。注意 7B 到 8B 多出来的 1.3B 参数,几乎全在词表两张表和更宽的 FFN 上,注意力反而少了。

第七步,权重显存。

`8.03B × 2 bytes = 16.06 GB ≈ 16 GB`

第八步,KV cache 每 token。这里就是坑:不能再写 d = 4096,要写 n_kv × d_head = 1024。

`2 × 32 × 1024 × 2 = 131,072 bytes = 128 KB`

7B 是 512 KB,8B 只有 128 KB,四分之一。这就是 GQA 存在的全部理由:参数只省了 6%,KV cache 省了 75%。

第九步,batch 32 × 2048 的 KV cache。

`65536 × 128 KB = 8 GB`

权重 16 GB,KV cache 8 GB。**缓存变成权重的一半,而不是 7B 那样的 2.4 倍**。同样的 80 GB 卡,7B 装完权重加缓存剩 34.5 GB,8B 剩 56 GB,能开的 batch 大得多。

第十步,decode 上限。

`A100:2039 ÷ 16.06 ≈ 127 tok/s`
`H100:3350 ÷ 16.06 ≈ 209 tok/s`

### 三个模型两张卡放在一起

| | Llama-2-7B | Llama-2-13B | Llama-3-8B |
| --- | --- | --- | --- |
| L / d / n_kv / d_ff / V | 32 / 4096 / 32 / 11008 / 32000 | 40 / 5120 / 40 / 13824 / 32000 | 32 / 4096 / **8** / 14336 / **128256** |
| 参数 | 6.74B | 13.02B | 8.03B |
| fp16 权重 | 13.5 GB | 26 GB | 16 GB |
| KV cache / token | 512 KB | 800 KB | **128 KB** |
| KV @ 32 × 2048 | 32 GB | 50 GB | 8 GB |
| KV ÷ 权重 | 2.4 | 1.9 | **0.5** |
| decode 上限 @ A100 | 150 tok/s | 78 tok/s | 127 tok/s |
| decode 上限 @ H100 | 248 tok/s | 129 tok/s | 209 tok/s |

| | A100 80GB SXM | H100 80GB SXM |
| --- | --- | --- |
| 带宽 | 2039 GB/s | 3350 GB/s(1.64×) |
| BF16 稠密算力 | 312 TFLOP/s | 989 TFLOP/s(3.17×) |
| ridge point | 153 | 295 |
| batch 1 decode 算力利用率(7B) | 0.65% | 1 ÷ 295 ≈ 0.34% |

看这两张表能得出三条 W1 单看 7B 得不出的规律:

1. decode 上限只看「带宽 ÷ 权重字节」,所以 8B 比 7B 慢(权重多 2.5 GB),和 GQA 无关,GQA 省的是显存不是 batch 1 的速度。
2. GQA 把「KV cache 是 batch 的天花板」这个问题缓解了四倍,同一张卡能同时服务更多请求,吞吐上限完全不一样。这是 Llama-3 之后几乎所有模型都用 GQA 的原因。
3. 卡越新 ridge point 越高,batch 1 的算力利用率反而越低。换卡不解决 memory-bound,只是把每个字节搬得更快。

规格数字的出处:A100 和 H100 的数取自 NVIDIA 官网数据表,Llama-3-8B 的配置取自 Hugging Face 上模型仓库的 `config.json`(`num_key_value_heads: 8`、`intermediate_size: 14336`、`vocab_size: 128256`)。仓库需要接受许可才能看到文件,页面本身公开。

## 自测:换模型换卡

这四题是加练二之后加的,专门考「算法是不是通用」。合上上面两张表再做。

**1. 一个模型 L = 48、d = 6144、n_kv = 8、d_head = 128,fp16。KV cache 每 token 多大?如果不知道有 GQA、直接用 d 算,会差几倍?**

<details><summary>答案</summary>

用通式:2 × 48 × (8 × 128) × 2 = 2 × 48 × 1024 × 2 = 196,608 bytes = 192 KB。

若错用 d = 6144:2 × 48 × 6144 × 2 = 1,179,648 bytes = 1152 KB。差 6 倍,正好是 h ÷ n_kv = 48 ÷ 8 的比值(d = h × d_head = 48 × 128 = 6144)。

</details>

**2. 同一个 7B 模型,从 A100 搬到 H100,batch 1 的 decode 上限涨多少倍?算力涨了 3.17 倍,为什么没体现出来?**

<details><summary>答案</summary>

涨 3350 ÷ 2039 ≈ 1.64 倍,从 150 到 248 tok/s。因为 batch 1 时算术强度只有 1,远低于两张卡的 ridge point,时间全花在搬权重上,上限只由带宽决定。算力再多也在等数据。

</details>

**3. H100 上要开到多大 batch,7B 的 decode 才开始卡算力?这个数比 A100 大还是小,为什么?**

<details><summary>答案</summary>

batch ≈ 295,即 H100 的 ridge point。比 A100 的 153 大,因为 H100 的算力涨幅(3.17×)大于带宽涨幅(1.64×),算力 ÷ 带宽变大了。卡越新越难喂饱,越依赖 batching。

</details>

**4. Llama-3-8B 比 Llama-2-7B 多了 1.3B 参数,多在哪?注意力部分是多了还是少了?**

<details><summary>答案</summary>

多在两处:词表从 32000 到 128256,embedding 和 lm_head 两张表从 0.26B 涨到 1.05B(+0.79B);FFN 中间宽度从 11008 到 14336,32 层合计多 3 × 4096 × 3328 × 32 ≈ 1.31B。注意力部分反而少了:GQA 让每层从 67.1M 降到 41.9M,32 层少 0.81B。三项相加约 +1.29B。

</details>

## 错题本

这周犯的错都在这里,每条写错在哪、为什么会错、纠正后应该记住什么规律。

**错误一:把 FFN 宽度 13824 代进 KV cache 公式。**

算 13B 的 KV cache 时我写了 `2 × 40 × 13824 × 2`。错在 KV cache 存的是 k 向量和 v 向量,它们的长度是 d = 5120。13824 是 FFN 中间层的宽度,FFN 只在层内部算一下就出结果,不产生任何需要跨步保留的东西。

为什么会错:看到题目给了 13824 这个数,觉得应该用上。这是拿数凑公式,不是从原理推。

规律:KV cache 公式里永远只有 L、d 和字节数。d_ff 只出现在参数量和激活里。

**错误二:一个头的 q 向量长度答成 128 × 128。**

问「d = 4096、32 个头,每个头的 q 向量有多长」,我答 128 × 128。q 是向量,向量只有一个长度,答案是 4096 ÷ 32 = 128。

为什么会错:向量和矩阵在脑子里没分开。看到「头」就想到矩阵形状,顺手写了个乘法。

规律:向量是一排数字,只有长度。矩阵是一张表,有行有列。问「多长」答一个数,问「几行几列」答两个数。

**错误三:一个头的 W^v 形状答成 128 × 128。**

紧接着上一题又错。一个头的 W^v 要把长 4096 的 token 向量变成长 128 的 v,所以是 4096 行 × 128 列。128 × 128 的矩阵只能吃长 128 的输入,token 向量塞不进去。

为什么会错:「输入长度 × 输出长度」这条规律听过但没落地,直到用 3 × 2 的小矩阵手算了一遍才明白行数为什么必须等于输入长度。

规律:矩阵形状永远是「输入长度 × 输出长度」。行数等于进来的向量长度,列数等于出去的向量长度。这条读 vLLM 源码看 tensor shape 时天天用。

**错误四:「为什么不缓存 q」答成「每次的 q 都不一样」。**

方向对但理由不准。每个新 token 的 k、v 也是新的,「不一样」不是区别。真正的区别是旧的会不会再被用到:生成第 100 个 token 时,它的 q 要和前面 99 个 token 的 k 算相似度、再按权重混前面 99 个 token 的 v,所以旧 token 的 k、v 每一步都被重新用到。而第 50 个 token 的 q 只在生成第 50 个 token 那一步用过一次,之后永远不需要。

规律:k、v 是「被查的」,每步都被查;q 是「来查的」,查完就没用了。用过就扔的东西没必要缓存。

**错误五:「attention 混合的是什么」答成关系。**

学 self-attention 时被问输出向量是什么东西的加权平均,我答「关系」。错了,q 和 k 算出来的相似度是权重,被这些权重加权混合的是各个 token 的 v 向量,也就是内容。相似度决定「听谁的多一点」,v 决定「听到的是什么」。

规律:attention 的输出 = Σ(相似度权重 × v)。权重来自 q·k,内容来自 v。

五条错误里有三条是同一个根子:向量和矩阵、长度和形状没分清。这是 W1 最大的收获,不是那些数字,是这条地基补上了。

向量和矩阵分不清这件事,最后是靠看别人一行行敲代码解决的。Karpathy 这一讲里 self-attention 那一段,`head_size`、`key = nn.Linear(n_embd, head_size)`、`wei = q @ k.transpose(-2, -1)`,每个 tensor 的形状都在注释里写着,配合 bbycroft 的 3D 图看,W1 错题一和错题三就不会再犯。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/kCc8FmEb1nY" title="Let's build GPT: from scratch, in code, spelled out." loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Andrej Karpathy ·《Let's build GPT: from scratch, in code, spelled out.》· 全长约 2 小时。W1 只需要看 self-attention 那一段(大约从第 56 分钟起,他从 version 1 的平均写到 version 4 的 q/k/v),盯着每个 Linear 的输入输出长度看,再看 multi-head 拼接和 projection 那几行。</figcaption>
</figure>

## 学习方法反思

这周有三条方法上的教训,比知识本身更值得记。

第一,整段看不懂时不要硬读,退到最小单元。「一层注意力 4 个方阵 = 67.1M」这一整段我打回说看不懂,拆到「一个矩阵里有多少个参数 = 行数 × 列数」才重新走通。后面每一步都是一个小问题、一个小答案,反而快。

第二,每一小块结尾问自己「哪一句没跟上」。不问的话会假装懂了往下走,走到 13B 那题就露馅。

第三,验收标准是算出数字,不是读完文章。W1 的产出物是那张七行表,每一行都能自己算出来才算过。「读了 Brrrr」「看了 bbycroft」这些不算进度。

## 全周名词总表

按出现顺序,每条一两句。

- **参数 / 权重 (parameter / weight)**:矩阵里的数字。数格子的时候叫参数,干活的时候叫权重,W 是 weight 的首字母。同一个东西。
- **fp16 / bf16 / int8 / int4**:每个数占的位数。16 位 = 2 字节,8 位 = 1 字节,4 位 = 0.5 字节。位数 ÷ 8 = 字节数。
- **量化 (quantization)**:把权重从 16 位压到 8 位或 4 位。字节少了,搬运快了,decode 上限直接翻倍。
- **token**:模型处理文本的最小单位。不是字也不是词,是 BPE 统计合并出来的片段。中文一个字常常一到两个 token,数字会被切碎。
- **BPE (byte pair encoding)**:构造词表的算法,反复把最常一起出现的相邻片段合并成一个新 token。
- **词表 (vocabulary, V)**:模型认识的所有 token 的集合。Llama-2 是 32000。
- **embedding**:V 行 d 列的表,每个 token 对应一行,那一行就是这个 token 的向量。
- **lm_head**:d × V 的表,把最后一层输出的 d 维向量变成 V 个 token 各自的分数。
- **隐藏维度 (hidden size, d / d_model)**:token 向量的长度,贯穿整个模型。7B 是 4096。
- **层 (layer, L)**:一层 = 一个 attention 加一个 FFN。7B 有 32 层,每层结构相同、参数不同。
- **self-attention**:让每个 token 看一眼前面所有 token,按相关程度把它们的内容混进自己的向量。
- **q / k / v (query / key / value)**:token 向量分别乘 W^q、W^k、W^v 得到的三个向量。q 是「来查的」,k 是「被查的」,v 是「被混合的内容」。
- **W^q / W^k / W^v / W^o**:一层注意力的 4 个矩阵,整层看都是 d × d 的方阵。
- **多头 (multi-head)**:把 attention 并排做 h 遍,每个头有自己的 W^q/W^k/W^v,各盯一种关系。每个头的向量长 d/h。
- **head_dim (d_head)**:每个头的 q、k、v 向量长度,= d ÷ h = 128。
- **拼接 (concatenation)**:h 个头各出一个 d_head 长的向量,首尾接成一条 d 长的向量。
- **W^o (output projection)**:拼接之后再乘一次的 d × d 矩阵,让各头的结果交流一次。
- **FFN (feed-forward network)**:attention 之后的部分,把向量先变宽到 d_ff 再变回 d。Llama 用 3 个矩阵(gate、up、down),叫 SwiGLU。
- **d_ff (intermediate size)**:FFN 中间宽度,7B 是 11008,13B 是 13824。只出现在参数量和激活里,不出现在 KV cache 里。
- **向量 vs 矩阵**:向量是一排数字,只有长度;矩阵是一张表,有行有列。矩阵形状 = 输入长度 × 输出长度。
- **FLOP / FLOPs**:一次浮点运算 / 运算次数。每个参数一乘一加 = 2 FLOP,所以每 token 前向 ≈ 2N。
- **TFLOP/s**:每秒万亿次浮点运算,算力单位。A100 BF16 是 312。
- **下一 token 预测 (next-token prediction)**:模型每步只做一件事,给出下一个 token 的概率分布。
- **自回归 (autoregressive)**:选出的 token 接到输入末尾,再预测下一个,循环到结束。
- **temperature**:采样时对概率分布的缩放,低了更确定,高了更随机。
- **prefill**:一次吃掉整个 prompt,算出所有 token 的 k、v 并填进缓存。compute-bound。
- **decode**:每步只生成一个 token。memory-bound。
- **KV cache**:所有已处理 token 在每一层的 k、v 向量。每 token 2·L·d·2 字节,随 batch × 序列长度线性涨。
- **激活 (activation)**:算当前层时的临时向量。推理时小,训练时是大头。
- **框架开销**:CUDA context、显存池、库工作区,1 到 2 GB。
- **显存带宽 (HBM bandwidth)**:每秒能从显存搬多少字节。A100 是 2039 GB/s。
- **compute-bound / memory-bound / overhead-bound**:Brrrr 的三种瓶颈。卡算力、卡带宽、卡 Python 和 kernel launch。
- **算术强度 (arithmetic intensity)**:FLOP ÷ 搬运的字节。decode batch 1 ≈ 1。
- **roofline**:横轴算术强度、纵轴可达算力的图,左边斜线是带宽上限,右边横线是算力上限。
- **ridge point**:斜线和横线的交点,= 峰值算力 ÷ 带宽。A100 约 153。
- **batching / continuous batching**:多个请求共用一遍权重搬运。continuous 指请求随到随进,不等整批。
- **PagedAttention**:vLLM 把 KV cache 切成固定大小的块按需分配,解决缓存碎片。M3 会读源码。

## 全周参考资料汇总

按这周实际用到的顺序排。链接只写我确定存在的,不确定的写标题按标题搜。

文章:

- Horace He,《Making Deep Learning Go Brrrr From First Principles》,https://horace.io/brrr_intro.html 。W1 的起点,三种瓶颈的出处,逐句读完的。
- Kipply,《Transformer Inference Arithmetic》,https://kipp.ly/transformer-inference-arithmetic/ 。KV cache 和 FLOPs 的推导比我这篇严谨,W1 做完再读一遍能对上。
- Jay Alammar,《The Illustrated Transformer》和《The Illustrated GPT-2》,按标题搜。看矩阵形状用。
- Lilian Weng,《Large Transformer Model Inference Optimization》,按标题搜。M2 开始读。
- vLLM 论文《Efficient Memory Management for Large Language Model Serving with PagedAttention》,arXiv 2309.06180。第二题的答案为什么重要,读它的引言就知道。
- Llama 2 论文《Llama 2: Open Foundation and Fine-Tuned Chat Models》,arXiv 2307.09288。模型配置表在附录。
- Meta,Llama-3-8B 模型仓库,https://huggingface.co/meta-llama/Meta-Llama-3-8B 。加练二的配置出处,`config.json` 里能看到 `num_key_value_heads: 8`,页面公开,文件要先接受许可。
- NVIDIA,A100 产品页 https://www.nvidia.com/en-us/data-center/a100/ 和 H100 产品页 https://www.nvidia.com/en-us/data-center/h100/ 。312 / 2039 和 989 / 3350 这四个数的出处,记得看稠密值不看 sparsity 值。
- Stanford CS336 课程主页 https://stanford-cs336.github.io/spring2025/ 和讲义仓库 https://github.com/stanford-cs336/spring2025-lectures 。每讲的代码和 PDF 都在这里。

视频与交互:

- bbycroft.net/llm。3D 可视化,能看到每个矩阵的实际尺寸。向量 vs 矩阵那两道错题,在这个页面上盯着看五分钟就不会再错。
- 3Blue1Brown,《But what is a GPT?》https://www.3blue1brown.com/lessons/gpt 和《Attention in transformers, visually explained》https://www.3blue1brown.com/lessons/attention 。
- 李宏毅,《Self-attention(上)》《Self-attention(下)》,按标题搜。q/k 不对称、多头拼接过 W^o 是从这两讲学的。
- Andrej Karpathy,Neural Networks: Zero to Hero,https://karpathy.ai/zero-to-hero.html 。主线课,先看《Let's build GPT》。
- Stanford CS336 (2025) 播放列表,YouTube playlist ID `PLoROMvodv4rOY23Y0BoGoBGgQ1zmU_MT_`,第 1 讲视频 ID `SQ3fZ1sAqXI`。深度课,和 M1 到 M10 一一对应,先看 1-3、5-8、10 讲。
- ZOMI 酱,《AIInfra》开源课,https://infrasys-ai.github.io/aiinfra-docs/ 。中文补充,按模块 0 → 6 → 5 → 4 看,1/2/3/7 先跳。B 站视频在他的空间按章节名搜。
- GPU MODE lectures,YouTube 频道 https://www.youtube.com/@GPUMODE ,讲义仓库 https://github.com/gpu-mode/lectures 。第 1 讲 profiler 那节 W2 就要用,其余 M5 开始看。


CS336 是 W1 之后的深度主线。第 1 讲前半是课程概览,后半讲 tokenizer,正好接 Day 2 的 BPE。他在概览里把「为什么要从零写一遍」讲得很直接:不自己算过资源账,就没法做设计决策。这句话和 W1 的规则是一回事。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/SQ3fZ1sAqXI" title="Stanford CS336 Language Modeling from Scratch | Spring 2025 | Lecture 1: Overview and Tokenization" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Stanford Online ·《Stanford CS336 Language Modeling from Scratch | Spring 2025 | Lecture 1: Overview and Tokenization》。打不开 YouTube 的话,B 站有全 17 讲的搬运,BV 号 BV1BDVU6zEkZ(中英字幕)和 BV18BbkzbEr9(英文字幕),P1 就是这一讲。</figcaption>
</figure>

## 下周预告:W2

W2 的性质和 W1 完全相反。W1 是纸笔,W2 是第一次真上手。目标是把 W1 的手算和实测对上,六天的安排已经定好:

| Day | 要做的事 | 验收 |
| --- | --- | --- |
| Day 7 · 第一次真上手:Colab 上跑通 TinyLlama 推理 | 开免费 T4,加载 TinyLlama-1.1B fp16 跑通 `generate`,弄清第一次为什么慢好几倍 | 连续 10 次运行延迟方差 < 10% |
| Day 8 · CUDA 是异步的:不 synchronize 的计时全是假的 | 搞懂 CPU 提交、GPU 排队的模型,用 `torch.cuda.synchronize()` 和 CUDA Event 两种方法计时 | 能说出不 sync 测到的到底是什么时间 |
| Day 9 · 把 TTFT 和 TPOT 分开测,再和 W1 的理论下限对账 | 首 token 和后续每 token 分开测,算 T4 上 TinyLlama 的理论下限,求实测 ÷ 理论的比值 | 一个比值,以及它落在 1.5–3 还是 10 说明什么 |
| Day 10 · torch.profiler 抓一次 generate,在 Perfetto 里看懂 timeline | 抓 trace 导出 chrome trace,在 Perfetto 里分清 CPU 行和 GPU 行 | 列出 top 5 耗时 kernel,说出各自对应模型哪部分 |
| Day 11 · timeline 上的 gap:overhead-bound 的实物证据 | 在 GPU 行上找空转的缝隙,加大 batch 再看一次 gap 占比怎么变 | 标出一个 gap 并解释它是什么、两种缩小办法 |
| Day 12 · W2 复习:理论 vs 实测对比报告、五道验收题、错题本 | 一页对比报告(理论下限、实测 TPOT、比值、top 5 kernel、gap 占比) | 路线图 W2 的五道题全对 |

这周真正的产出不是「学会用 profiler」,是 Day 9 那个比值:实测 TPOT 除以 W1 算法给出的理论下限。落在 1.5 到 3 倍之间,说明对 memory-bound 的判断是对的,W1 那张表可以信,后面八个月都能拿它做估算;差到 10 倍,说明有别的东西在拖,大概率是 overhead,Day 11 会在 timeline 上亲眼看到它。这个比值是全年调优工作的基线,以后每做一次优化都回来看它有没有向 1 靠近。

路线图提前说了坑几乎全在环境和 CUDA 异步上,跟深度学习没关系:GPU 上的操作是异步的,不 `torch.cuda.synchronize()` 计时全是假的;第一次跑要 warmup,不然测到的是编译和缓存填充;Colab 免费卡的带宽和 A100 差好几倍,理论上限要按实际那张卡重算。T4 的规格是 16 GB 显存、320 GB/s 带宽、fp16 65 TFLOP/s,ridge point 约 203,而且不支持 bf16。7B fp16 的 13.5 GB 权重在 16 GB 的卡上装不下,所以换 TinyLlama-1.1B,fp16 权重约 2.2 GB,decode 理论下限 2.2 ÷ 320 ≈ 6.9 ms,约 145 tok/s。这几个数 Day 7 开工前先算一遍,到时候有实测对照。

W1 一行代码没写,W2 开始写。
