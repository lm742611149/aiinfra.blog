---
title: 'Day 6 · W1 复习：一页笔记、五道验收题、错题本与 13B 全解'
description: '把第一周所有公式和数字压成一页,合上笔记做完五道验收题,再把这周犯过的错一条条摊开。算不出数字就是没过,跟读了几篇文章没关系。'
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

视频与交互:

- bbycroft.net/llm。3D 可视化,能看到每个矩阵的实际尺寸。向量 vs 矩阵那两道错题,在这个页面上盯着看五分钟就不会再错。
- 3Blue1Brown,《But what is a GPT?》https://www.3blue1brown.com/lessons/gpt 和《Attention in transformers, visually explained》https://www.3blue1brown.com/lessons/attention 。
- 李宏毅,《Self-attention(上)》《Self-attention(下)》,按标题搜。q/k 不对称、多头拼接过 W^o 是从这两讲学的。
- Andrej Karpathy,Neural Networks: Zero to Hero,https://karpathy.ai/zero-to-hero.html 。主线课,先看《Let's build GPT》。
- Stanford CS336 (2025) 播放列表,YouTube playlist ID `PLoROMvodv4rOY23Y0BoGoBGgQ1zmU_MT_`。深度课,和 M1 到 M10 一一对应,先看 1-3、5-8、10 讲。
- ZOMI 酱,《AIInfra》开源课,https://infrasys-ai.github.io/aiinfra-docs/ 。中文补充,按模块 0 → 6 → 5 → 4 看,1/2/3/7 先跳。B 站视频在他的空间按章节名搜。
- GPU MODE lectures,YouTube 频道 GPU MODE。M5 开始看。

## 下周预告:W2

W2 的性质和 W1 完全相反。W1 是纸笔,W2 是第一次真上手。目标是把 W1 的手算和实测对上。

要做的事:在 Colab 上跑通一个小模型的推理,用 `torch.profiler` 抓 trace,看懂 timeline,指出哪个 op 最耗时、为什么。然后拿实测的每 token 时间和 W1 算的理论上限比,看差多少、差在哪。

路线图提前说了坑几乎全在环境和 CUDA 异步上,跟深度学习没关系:GPU 上的操作是异步的,不 `torch.cuda.synchronize()` 计时全是假的;第一次跑要 warmup,不然测到的是编译和缓存填充;Colab 免费卡的带宽和 A100 差好几倍,理论上限要按实际那张卡重算。

W1 一行代码没写,W2 开始写。
