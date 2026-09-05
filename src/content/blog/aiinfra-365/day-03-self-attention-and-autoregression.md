---
title: 'Day 3 · Self-attention 到底在算什么：q、k、v、多头，以及模型怎么一个 token 一个 token 往外吐'
description: '把注意力机制拆到能手算的粒度：三个向量各干什么、权重怎么来的、加起来的到底是什么。用一个 3 token、head_dim 2 的例子把整张注意力矩阵算完，再接一段能跑的 numpy。顺带搞清模型为什么只能一个 token 一个 token 地生成，以及这件事怎么直接引出 prefill、decode 和 KV cache。'
pubDate: 2026-09-01
regime: none
tags: ['attention', 'transformer', 'decode', 'aiinfra-365']
series: 'aiinfra-365'
day: 3
lang: 'zh'
---

## 今天要解决的问题

Day 2 把一层 transformer 里的 7 个矩阵数清楚了：注意力 4 个方阵，FFN 3 个。但那只是数格子，格子里的数字拿来干什么，我当时是不知道的。今天要回答的就是这个：注意力那 4 个矩阵到底在算什么，为什么要 4 个，算出来的东西又是什么。

另一件事是模型怎么"说话"。我们平时看到 ChatGPT 一个字一个字往外蹦，那不是动画效果，是它真的只能一次算出一个 token。这件事和 attention 的计算方式绑在一起，搞懂了它，后面 prefill、decode、KV cache 这三个词就全都有了落脚点。

今天结束时要能做到：

1. 给三个 token 的 q、k、v 小向量，手算出整张 3 × 3 的注意力矩阵和每个 token 的输出。
2. 说清楚「权重」和「被加权的东西」分别是什么，q 为什么不用缓存。
3. 用 Llama-2-7B 的真实尺寸把一个头从输入到输出每一步的形状写出来，prefill 和 decode 各一遍。

写这篇的时候我已经看完了李宏毅的两个 self-attention 视频，做了三道检验题，答错了一道。错的那道会在下面重点写，因为错的地方才是真正没懂的地方。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Wv411h7kN&p=38&autoplay=0&high_quality=1" title="李宏毅 2021 - 自注意力机制 (Self-attention) (上)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>李宏毅 · 【機器學習2021】自注意力機制 (Self-attention) (上) · B 站合集「(强推)李宏毅2021/2022春机器学习课程」第 38 集，下集是第 39 集。上集讲 q、k、v 怎么从同一个输入变出来、相关性怎么算；下集讲多头和矩阵化。我就是看完这两集去做检验题的。YouTube 原版 ID `hYdO9CscNes`（上）、`gmsMY5kc-zw`（下）。</figcaption>
</figure>

## 语言模型只做一件事

先把最外层的事说清楚。一个语言模型，不管多大，输入是一串 token，输出是一个长度为词表大小的数组。Llama-2 的词表是 32000，所以输出就是 32000 个数字，每个数字对应一个 token，表示"下一个 token 是它的可能性有多大"。

这 32000 个数字刚出来的时候叫 logits，是原始分数，可以是负数，加起来也不等于 1。要变成概率，过一道 softmax：对每个数字取 e 的幂，再除以所有幂的总和。这样每个数都在 0 到 1 之间，加起来正好 1。

然后从这个概率分布里挑一个 token 出来。挑法有两种：直接选概率最大的，叫 greedy；或者按概率随机抽一个，概率大的更容易被抽到，但不是一定。

temperature 就是在 softmax 之前先把 logits 除以一个数 T。T 小于 1 时，分数之间的差距被拉大，最高的那个 softmax 之后更接近 1，输出更保守、更确定。T 大于 1 时差距被压小，各个 token 的概率更平均，输出更随机。T 趋近 0 就等于 greedy。所以"调低 temperature 让模型更稳定"这句话背后就是一个除法。

用三个 logits 走一遍就看清了。假设某一步词表里只有三个候选，logits 是 [2, 1, 0]：

| T | 除完的 logits | e 的幂 | 概率 |
| --- | --- | --- | --- |
| 1（不动） | [2, 1, 0] | [7.39, 2.72, 1.00] | [0.665, 0.245, 0.090] |
| 0.5（更确定） | [4, 2, 0] | [54.6, 7.39, 1.00] | [0.867, 0.117, 0.016] |
| 2（更随机） | [1, 0.5, 0] | [2.72, 1.65, 1.00] | [0.506, 0.307, 0.186] |

logits 本身一个没变，只是除了一个数，第一名的概率就在 0.51 到 0.87 之间来回。这就是 temperature 的全部。

选出一个 token 之后呢？把它接到输入串的末尾，整个再喂回模型一遍，再得 32000 个数字，再选一个，再接上去。这就是自回归，autoregressive。模型没有"写一句话"的能力，它只有"猜下一个字"的能力，一句话是猜了几十次拼出来的。

## 为什么需要 attention

Day 2 讲过 embedding：每个 token 查表得到一个 4096 长的向量。问题是这个向量是查表查出来的，同一个 token 不管出现在哪里，查出来都是同一个向量。"苹果"在"我吃了一个苹果"和"苹果发布了新手机"里是同一个向量。

但这两个"苹果"意思完全不同。要让模型区分，就得让"苹果"这个位置的向量去看一眼旁边的"吃"或者"发布"，把周围的信息混进自己的向量里。混完之后，两个"苹果"的向量就不一样了。

attention 就是这个"看一眼旁边、把信息混进来"的机制。每个 token 都要去看所有其他 token，决定看谁多一点、看谁少一点，然后按这个比例把别人的信息加到自己身上。一层做一次，32 层做 32 次，越往后每个位置的向量就越"知道"自己的上下文。

还有一个顺带的问题：查表得到的向量里也没有"我是第几个 token"这个信息，"我吃苹果"和"苹果吃我"查出来的三个向量一样，只是顺序不同，而 attention 本身对顺序不敏感。所以位置信息要另外塞进去。Llama 用的办法叫 RoPE（rotary position embedding）：在算 q 和 k 的时候，按 token 的位置把向量旋转一个角度，位置不同转的角度不同。它没有参数，所以 Day 2 数参数时不用管它；它改的只是 q 和 k 的数值，不改形状。今天知道有这么一步就够了。

## 三个向量：q、k、v

现在讲那 4 个矩阵里的前 3 个。每个 token 的向量 x（4096 长），分别乘三个矩阵：

- x × W^q 得到 q（query，来查的）
- x × W^k 得到 k（key，被查的标签）
- x × W^v 得到 v（value，被混合的内容）

一个类比：图书馆。你脑子里有个想找的东西，那是 q。书架上每本书的书脊上有标签，那是 k。你拿着 q 去和每本书的 k 比对，越像的越可能是你要的。比对完，你翻开书读的内容，是 v。标签只用来匹配，内容才是你带走的东西。

搜索引擎也是同一个结构：你输入的搜索词是 query，网页的标题和关键词是 key，点进去看到的正文是 value。搜索引擎用 query 匹配 key 来排序，你最后拿到手的是 value。

每个 token 同时是查书的人和书架上的书。它有自己的 q 去查别人，也有自己的 k 和 v 等着被别人查。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="一个头的注意力计算流程：三个 token 各自算出 q、k、v，token 3 的 q 和三个 k 点积、缩放、softmax 得到权重，再按权重把三个 v 加起来">
<text x="20" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">一个头，算 token 3 的输出</text>
<rect x="20" y="40" width="70" height="26" fill="var(--paper-raised)" stroke="var(--rule)"/>
<rect x="20" y="76" width="70" height="26" fill="var(--paper-raised)" stroke="var(--rule)"/>
<rect x="20" y="112" width="70" height="26" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="55" y="58" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">x1</text>
<text x="55" y="94" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">x2</text>
<text x="55" y="130" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">x3</text>
<text x="55" y="158" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)" text-anchor="middle">长 4096</text>
<path d="M90 89 L130 89" stroke="var(--ink-soft)" stroke-width="1.5"/>
<text x="110" y="82" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">×W</text>
<rect x="130" y="40" width="60" height="26" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="130" y="76" width="60" height="26" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="130" y="112" width="60" height="26" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="160" y="58" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">k1</text>
<text x="160" y="94" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">k2</text>
<text x="160" y="130" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">k3</text>
<rect x="200" y="40" width="60" height="26" fill="var(--compute-wash)" stroke="var(--compute)"/>
<rect x="200" y="76" width="60" height="26" fill="var(--compute-wash)" stroke="var(--compute)"/>
<rect x="200" y="112" width="60" height="26" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="230" y="58" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">v1</text>
<text x="230" y="94" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">v2</text>
<text x="230" y="130" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">v3</text>
<text x="160" y="158" font-family="var(--font-mono)" font-size="11" fill="var(--mem)" text-anchor="middle">被查的标签</text>
<text x="230" y="158" font-family="var(--font-mono)" font-size="11" fill="var(--compute)" text-anchor="middle">被混的内容</text>
<rect x="130" y="190" width="60" height="26" fill="var(--paper-raised)" stroke="var(--ink)" stroke-width="1.5"/>
<text x="160" y="208" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">q3</text>
<text x="160" y="232" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)" text-anchor="middle">来查的</text>
<path d="M190 203 L300 203" stroke="var(--ink-soft)" stroke-width="1.5"/>
<path d="M160 138 L160 190" stroke="var(--mem)" stroke-width="1" stroke-dasharray="3 3"/>
<rect x="300" y="40" width="120" height="176" fill="var(--paper-raised)" stroke="var(--rule)" rx="4"/>
<text x="360" y="62" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">q3·k1, q3·k2, q3·k3</text>
<text x="360" y="84" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">点积 → 3 个数</text>
<text x="360" y="112" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">÷ √head_dim</text>
<text x="360" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">softmax</text>
<text x="360" y="168" font-family="var(--font-mono)" font-size="11" fill="var(--mem)" text-anchor="middle">权重 w1 w2 w3</text>
<text x="360" y="186" font-family="var(--font-mono)" font-size="11" fill="var(--mem)" text-anchor="middle">加起来 = 1</text>
<path d="M420 128 L460 128" stroke="var(--ink-soft)" stroke-width="1.5"/>
<path d="M260 89 Q 440 89 470 128" stroke="var(--compute)" stroke-width="1" fill="none" stroke-dasharray="3 3"/>
<rect x="460" y="90" width="160" height="76" fill="var(--paper-raised)" stroke="var(--ink)" stroke-width="1.5" rx="4"/>
<text x="540" y="114" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">w1·v1 + w2·v2 + w3·v3</text>
<text x="540" y="136" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">= token 3 的输出</text>
<text x="540" y="154" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)" text-anchor="middle">长 head_dim</text>
<text x="20" y="270" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">q 和 k 只用来算权重（听谁的、听多少）</text>
<text x="20" y="292" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">v 才是被加进输出的内容（他们各自说了什么）</text>
<text x="20" y="314" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">输出里没有任何一个数是权重本身</text>
</svg>
<figcaption>一个头算一个 token 的注意力输出。蓝色是 k，只参与算权重；橙色是 v，才是真正被混进输出的内容。q 查完就没用了，这就是后面 KV cache 不存 q 的原因。</figcaption>
</figure>

## 一步一步算

先只看一个头，先只看一个 token 的输出是怎么来的。假设序列里有 3 个 token，编号 1、2、3，现在要算 token 3 的注意力输出。

第一步，token 3 的 q 分别和 token 1、2、3 的 k 做点积。点积就是两个向量对应位置相乘再全部加起来，结果是一个数。三个点积得到三个数，表示 token 3 和每个 token 的"相似度"或者说"相关度"。

第二步，每个数除以 √head_dim。Llama-2-7B 的 head_dim 是 128，√128 约等于 11.3。这一步是为了数值稳定：向量维度高的时候点积容易变得很大，softmax 之后会极端到接近 one-hot，除一下把它拉回合理范围。

第三步，三个数过 softmax，变成三个加起来等于 1 的权重。

第四步，用这三个权重分别乘 token 1、2、3 的 v 向量，然后把三个乘完的向量加起来。得到的这个向量就是 token 3 在这一层的注意力输出。

用小数字走一遍。假设 head_dim 是 2 而不是 128，这样每个向量只有两个数字。

三个 token 的 k：k1 = [1, 0]，k2 = [0, 1]，k3 = [1, 1]。
三个 token 的 v：v1 = [10, 0]，v2 = [0, 10]，v3 = [5, 5]。
token 3 的 q：q3 = [1, 0]。

点积：q3·k1 = 1×1 + 0×0 = 1；q3·k2 = 1×0 + 0×1 = 0；q3·k3 = 1×1 + 0×1 = 1。

除 √2 ≈ 1.41：得到约 0.71、0、0.71。

softmax：e^0.71 ≈ 2.03，e^0 = 1，e^0.71 ≈ 2.03，总和约 5.06。三个权重约 0.40、0.20、0.40。

加权求和 v：0.40×[10, 0] + 0.20×[0, 10] + 0.40×[5, 5] = [4, 0] + [0, 2] + [2, 2] = [6, 4]。

token 3 的注意力输出是 [6, 4]。它主要吸了 v1 和 v3 的内容，v2 只占了一点。为什么？因为 q3 和 k1、k3 更像，和 k2 不像。

这个例子有两个地方值得停一下，正好对应我检验里的两个点。

## 检验里的两个关键点

第一个：q 和 k 为什么要用两个不同的矩阵？既然都是从同一个 x 变出来的，用一个矩阵不就行了，让 x 直接和别人的 x 点积？

答案是：因为"A 看 B"和"B 看 A"的强度应该可以不一样。"苹果"看"吃"可能很重要，因为"吃"告诉它自己是水果不是公司。但"吃"看"苹果"可能没那么重要，"吃"的意思不太受宾语影响。如果 q 和 k 是同一个东西，那 A·B 和 B·A 一定相等，这种不对称就表达不出来。用两个不同的矩阵，q_A·k_B 和 q_B·k_A 就是两个独立的数，可以一大一小。

第二个，也是我答错的那个：加权求和的时候，加起来的到底是什么？

我当时的回答是"混的是各个 token 之间的关系"。错了。**注意力权重只决定比例，被加起来的是 v 向量。** 权重 0.40、0.20、0.40 是"关系"，它们告诉你 token 3 要从 token 1 拿 40%、从 token 2 拿 20%、从 token 3 自己拿 40%。但拿的是什么？拿的是 v1、v2、v3 这三个向量的内容。输出 [6, 4] 是三个 v 的加权平均，里面没有任何一个数字是"关系"本身。

换个说法：q 和 k 的点积算出来的是"我该听谁的、听多少"，v 是"他们各自说了什么"。最后进入输出的是"他们说的话"按"听多少"混合起来，不是"我该听谁的"这个信息本身。图书馆的类比里，你带走的是书里的内容，不是"哪本书跟我的需求匹配度 40%"这个数字。

这个错误看起来是措辞问题，但其实反映我当时没有把"权重"和"被加权的东西"分开。后面看 KV cache 的时候这个区分很关键：缓存的是 k 和 v，k 用来算权重，v 用来被加权，两个都要存，而 q 不用存。

## 因果掩码

上面的例子里 token 3 看了 token 1、2、3。但如果序列里还有 token 4、5，token 3 能看它们吗？

训练的时候不能。因为模型的任务是预测下一个 token，如果算 token 3 的输出时偷看了 token 4，那预测 token 4 就是作弊。所以要加一个规则：每个 token 只能看自己和自己前面的，后面的一律不看。

实现方式很粗暴：在算完点积之后、softmax 之前，把所有"后面的 token"对应的相似度直接设成负无穷。e 的负无穷次方是 0，softmax 之后这些位置的权重就是 0，等于没看。这个操作叫 causal mask，因果掩码。

在生成阶段这个规则自动满足，因为后面的 token 还没生成出来，根本不存在。

## 把整张注意力矩阵算完

上面只算了 token 3。把 token 1 和 token 2 也算出来，整张 3 × 3 的表就齐了。补上另外两个 q：q1 = [0, 1]，q2 = [1, 1]。

token 1 只能看自己（因果掩码把 k2、k3 挡掉了）。q1·k1 = 0，只有一个候选，softmax 之后权重就是 1。输出 = 1 × v1 = [10, 0]。第一个 token 的注意力输出永远等于它自己的 v，没有别人可看。

token 2 能看 token 1 和自己。q2·k1 = 1×1 + 1×0 = 1，q2·k2 = 1×0 + 1×1 = 1。两个一样大，除 √2 之后还是一样，softmax 各 0.5。输出 = 0.5 × [10, 0] + 0.5 × [0, 10] = [5, 5]。

token 3 上面算过：权重 [0.40, 0.20, 0.40]，输出 [6, 4]。

三行放在一起：

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="3×3 注意力权重矩阵，带因果掩码：第一行 1 0 0，第二行 0.5 0.5 0，第三行 0.40 0.20 0.40，右上角被掩码的三格为空">
<text x="20" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">注意力矩阵：行 = 谁在查（q），列 = 查谁（k），格子 = softmax 后的权重</text>
<text x="130" y="58" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)" text-anchor="middle">k1</text>
<text x="200" y="58" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)" text-anchor="middle">k2</text>
<text x="270" y="58" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)" text-anchor="middle">k3</text>
<text x="70" y="98" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)" text-anchor="middle">q1</text>
<text x="70" y="168" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)" text-anchor="middle">q2</text>
<text x="70" y="238" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)" text-anchor="middle">q3</text>
<rect x="95" y="70" width="70" height="60" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="165" y="70" width="70" height="60" fill="var(--paper-raised)" stroke="var(--rule)" stroke-dasharray="3 3"/>
<rect x="235" y="70" width="70" height="60" fill="var(--paper-raised)" stroke="var(--rule)" stroke-dasharray="3 3"/>
<rect x="95" y="140" width="70" height="60" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="165" y="140" width="70" height="60" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="235" y="140" width="70" height="60" fill="var(--paper-raised)" stroke="var(--rule)" stroke-dasharray="3 3"/>
<rect x="95" y="210" width="70" height="40" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="165" y="210" width="70" height="40" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="235" y="210" width="70" height="40" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="130" y="105" font-family="var(--font-mono)" font-size="13" fill="var(--ink)" text-anchor="middle">1.00</text>
<text x="200" y="105" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)" text-anchor="middle">-∞ → 0</text>
<text x="270" y="105" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)" text-anchor="middle">-∞ → 0</text>
<text x="130" y="175" font-family="var(--font-mono)" font-size="13" fill="var(--ink)" text-anchor="middle">0.50</text>
<text x="200" y="175" font-family="var(--font-mono)" font-size="13" fill="var(--ink)" text-anchor="middle">0.50</text>
<text x="270" y="175" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)" text-anchor="middle">-∞ → 0</text>
<text x="130" y="235" font-family="var(--font-mono)" font-size="13" fill="var(--ink)" text-anchor="middle">0.40</text>
<text x="200" y="235" font-family="var(--font-mono)" font-size="13" fill="var(--ink)" text-anchor="middle">0.20</text>
<text x="270" y="235" font-family="var(--font-mono)" font-size="13" fill="var(--ink)" text-anchor="middle">0.40</text>
<text x="340" y="98" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">输出 1 = 1.00·v1 = [10, 0]</text>
<text x="340" y="168" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">输出 2 = 0.5·v1 + 0.5·v2 = [5, 5]</text>
<text x="340" y="232" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">输出 3 = 0.4·v1 + 0.2·v2 + 0.4·v3 = [6, 4]</text>
<text x="340" y="130" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">每一行加起来 = 1</text>
<text x="340" y="200" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">虚线格 = 因果掩码，看不到后面的</text>
</svg>
<figcaption>三个 token 的完整注意力矩阵。右上三角被因果掩码设成负无穷，softmax 后权重为 0。每行的权重乘对应的 v 再加起来，就是那个 token 的输出。序列长 n 时这张表是 n × n。</figcaption>
</figure>

这张表就是所谓的注意力矩阵。看它有三个用处：每一行加起来等于 1，这是 softmax 保证的；右上角是空的，这是因果掩码；输出向量是这一行的权重去乘对应的 v 再加起来，权重本身不进输出。

把上面的手算翻成代码，本机装个 numpy 就能跑，和手算结果一位一位对：

```python
import numpy as np

K = np.array([[1, 0], [0, 1], [1, 1]], dtype=float)      # 3 个 token 的 k，每行一个
V = np.array([[10, 0], [0, 10], [5, 5]], dtype=float)    # 3 个 token 的 v
Q = np.array([[0, 1], [1, 1], [1, 0]], dtype=float)      # 3 个 token 的 q
head_dim = K.shape[1]

scores = Q @ K.T / np.sqrt(head_dim)                     # 3×3：第 i 行是 q_i 和所有 k 的点积
mask = np.triu(np.ones_like(scores), k=1).astype(bool)   # 右上三角 = 后面的 token
scores[mask] = -np.inf                                   # 因果掩码
weights = np.exp(scores) / np.exp(scores).sum(axis=1, keepdims=True)   # 逐行 softmax
out = weights @ V                                        # 3×2：每行是一个 token 的输出

np.set_printoptions(precision=2, suppress=True)
print(weights)   # [[1.   0.   0.  ] [0.5  0.5  0.  ] [0.4  0.2  0.4 ]]
print(out)       # [[10.  0. ] [ 5.  5. ] [ 6.  4. ]]
```

十行代码就是一个头的完整注意力，只是尺寸是 3 × 2 而不是 2000 × 128。真实模型里 `Q @ K.T` 那一行就是 n × n 的那张表，`weights @ V` 那一行就是"按权重混 v"。Day 4 算 FLOPs 时会数这两行各做了多少次乘加。

## 多头

到现在为止讲的都是"一个头"。Llama-2-7B 有 32 个头。

多头的意思是：上面那整套 q、k、v、点积、softmax、加权求和，并排做 32 遍。32 个头各有自己的一套 W^q、W^k、W^v，数值互不相同，所以每个头算出来的权重也不同。一个头可能学会盯着句子的主语，一个头盯着前一个词，一个头盯着标点。它们互不干涉，各自算出自己的输出。

每个头的输出比较短。总的 d 是 4096，32 个头平分，每个头只负责 128 个数字。所以每个头的 W^q 形状是 4096 行 × 128 列：吃 4096 长的 x，吐 128 长的 q。W^k、W^v 同样。

32 个头各算出一个 128 长的输出向量，把它们首尾接起来，正好 32 × 128 = 4096 个数字。这一步叫拼接，concatenate，就是字面意思。

拼接完的 4096 长向量再乘一个 4096 × 4096 的矩阵 W^o。为什么还要这一步？因为拼接只是把 32 个头的结果摆在一起，它们之间还没交流过。W^o 把它们混合一次，这一层注意力才算完。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="多头注意力：x 经 32 个头各自算出长 128 的输出，拼接成长 4096 的向量，再乘 W^o 得到长 4096 的最终输出">
<text x="20" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">32 个头 → 拼接 → W^o</text>
<rect x="20" y="120" width="60" height="30" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="50" y="140" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">x</text>
<text x="50" y="168" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)" text-anchor="middle">长 4096</text>
<path d="M80 135 L120 60" stroke="var(--rule)"/>
<path d="M80 135 L120 100" stroke="var(--rule)"/>
<path d="M80 135 L120 170" stroke="var(--rule)"/>
<path d="M80 135 L120 210" stroke="var(--rule)"/>
<rect x="120" y="46" width="130" height="28" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="120" y="86" width="130" height="28" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="185" y="140" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)" text-anchor="middle">…</text>
<rect x="120" y="156" width="130" height="28" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="120" y="196" width="130" height="28" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="185" y="65" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">头 1：W^q W^k W^v</text>
<text x="185" y="105" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">头 2：各 4096×128</text>
<text x="185" y="175" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">头 31</text>
<text x="185" y="215" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">头 32</text>
<path d="M250 60 L290 60" stroke="var(--ink-soft)"/>
<path d="M250 100 L290 100" stroke="var(--ink-soft)"/>
<path d="M250 170 L290 170" stroke="var(--ink-soft)"/>
<path d="M250 210 L290 210" stroke="var(--ink-soft)"/>
<rect x="290" y="50" width="40" height="20" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
<rect x="290" y="90" width="40" height="20" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
<rect x="290" y="160" width="40" height="20" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
<rect x="290" y="200" width="40" height="20" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
<text x="340" y="64" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">长 128</text>
<text x="340" y="104" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">长 128</text>
<text x="340" y="174" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">长 128</text>
<text x="340" y="214" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">长 128</text>
<path d="M330 60 L410 130" stroke="var(--rule)"/>
<path d="M330 100 L410 133" stroke="var(--rule)"/>
<path d="M330 170 L410 137" stroke="var(--rule)"/>
<path d="M330 210 L410 140" stroke="var(--rule)"/>
<rect x="410" y="120" width="12" height="30" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
<rect x="422" y="120" width="12" height="30" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
<rect x="434" y="120" width="12" height="30" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
<rect x="446" y="120" width="12" height="30" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
<rect x="458" y="120" width="12" height="30" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
<rect x="470" y="120" width="12" height="30" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
<text x="446" y="168" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">拼接 32 × 128</text>
<text x="446" y="184" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">= 长 4096</text>
<path d="M482 135 L520 135" stroke="var(--ink-soft)" stroke-width="1.5"/>
<text x="501" y="128" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">×W^o</text>
<rect x="520" y="120" width="100" height="30" fill="var(--paper-raised)" stroke="var(--ink)" stroke-width="1.5"/>
<text x="570" y="140" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">输出</text>
<text x="570" y="168" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)" text-anchor="middle">长 4096</text>
<text x="20" y="262" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">拼接只是把 32 段摆在一起，头和头之间没有交流</text>
<text x="20" y="284" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">W^o（4096 × 4096）负责把它们混合一次</text>
</svg>
<figcaption>32 个头各自独立算出一个长 128 的向量，拼成长 4096，再过 W^o。这就是 Day 2 那四个方阵中最后一个存在的全部理由。</figcaption>
</figure>

现在用 Day 2 的形状规律复核一下参数量。矩阵形状永远是"输入长度 × 输出长度"：

| 矩阵 | 输入 | 输出 | 形状 | 格子数 |
| --- | --- | --- | --- | --- |
| 一个头的 W^q | 4096 | 128 | 4096 × 128 | 524,288 |
| 32 个头的 W^q 并排 | 4096 | 32 × 128 = 4096 | 4096 × 4096 | 16.8M |
| W^k、W^v 同理 | 4096 | 4096 | 4096 × 4096 | 各 16.8M |
| W^o | 4096 | 4096 | 4096 × 4096 | 16.8M |

四个 4096 × 4096 的方阵，合计 67.1M，和 Day 2 数出来的一致。多头没有增加参数，只是把大矩阵切成 32 条竖条分别用。

写这段的时候我在"一个头的 q 有多长"这道题上答了 128 × 128。错。q 是向量，向量只有长度，没有行列，答案是 128。128 × 128 是一个矩阵的形状，而且一个头的 W^q 也不是 128 × 128，它是 4096 × 128，因为输入是 4096 长的 x。向量和矩阵分不清是我这周最大的地基问题，多写几遍：**向量是一排数，只有长度；矩阵是一张表，行数等于输入长度，列数等于输出长度。**

### GQA：多个 q 头共用一组 k、v

Day 2 对账 Llama-3-8B 时碰到了 `num_key_value_heads: 8`。放到今天的图里就好懂了：32 个 q 头照旧各有各的 W^q，但 k、v 只算 8 组。头 1 到头 4 共用第 1 组 k、v，头 5 到头 8 共用第 2 组，以此类推。每组 k、v 被 4 个 q 头查。

对计算的影响：每个 q 头还是拿自己的 q 去和 k 点积、按权重混 v，流程一个字不变，只是 4 个头查的是同一批 k、v。对参数的影响 Day 2 算过，W^k、W^v 从 4096 × 4096 缩到 4096 × 1024。真正省的是 Day 4 要算的 KV cache：要缓存的 k、v 向量从 4096 长变成 1024 长，缩到四分之一。Llama-2-70B、Llama-3 全系、TinyLlama 都是 GQA，以后看到 `num_key_value_heads` 小于 `num_attention_heads` 就知道是这个结构。

## 用 Llama-2-7B 的真实尺寸走一遍形状

小例子懂了，换成真实尺寸再过一遍，防止数字一大就慌。取一个头，prompt 有 n = 2000 个 token。

| 步骤 | 算什么 | 形状 |
| --- | --- | --- |
| 输入 | 2000 个 token 的向量堆成一张表 X | 2000 × 4096 |
| 三个投影 | X × W^q、X × W^k、X × W^v | 各 2000 × 4096 |
| 切出一个头 | 取第 h 头对应的 128 列 | Q_h、K_h、V_h 各 2000 × 128 |
| 相似度 | Q_h × K_hᵀ，除 √128 | 2000 × 2000 |
| 掩码 + softmax | 右上三角设 -∞，逐行归一 | 2000 × 2000 |
| 混 v | 权重 × V_h | 2000 × 128 |
| 32 个头拼接 | 并排放 | 2000 × 4096 |
| 混合 | × W^o | 2000 × 4096 |

每一行的形状都能用"输入长度 × 输出长度"和"几个 token 就几行"两条规则推出来，不用背。那张 2000 × 2000 的表就是注意力矩阵，400 万个格子，每个头一张，32 个头 32 张，每层都要算一遍。

再看生成第 2001 个 token 时同一个头的形状：

| 步骤 | 算什么 | 形状 |
| --- | --- | --- |
| 输入 | 只有新 token 一个向量 | 1 × 4096 |
| 三个投影 | 只算新 token 的 q、k、v | 各 1 × 4096，切一个头 1 × 128 |
| 相似度 | 新 q 和前面 2001 个 k（2000 个来自缓存 + 自己） | 1 × 2001 |
| softmax | 一行 | 1 × 2001 |
| 混 v | 权重 × 2001 个 v | 1 × 128 |

对比两张表：prefill 那张的 2000 行全部并行算，一次大矩阵乘法搞定；decode 这张只有一行，但那 2001 个 k 和 v 必须在手边。这就是下面要讲的两个阶段。

## 计算量随序列长度平方增长

回到"一步一步算"那节。序列有 3 个 token 时，token 3 的 q 要和 3 个 k 做点积。如果序列有 n 个 token，每个 token 的 q 都要和 n 个 k 做点积，n 个 token 就是 n × n 次点积。

这 n × n 个相似度排成一张表，就是所谓的注意力矩阵，n 行 n 列。序列长度翻倍，这张表的格子数翻四倍。

Day 2 讲过前向计算的主体是 2 × 参数量 × token 数，随 token 数线性增长。但 attention 里的这块 q·k 和权重×v 的计算，随 token 数平方增长。序列短的时候平方项不起眼，序列长到几千上万的时候它就开始主导。Day 4 会给出精确公式 2 × L × n² × d，并算出序列多长时平方项超过线性项。

这也是为什么"长上下文"是推理里一块单独的难题：不是参数变多了，是这张 n × n 的表变大了。

## 从 attention 推出 prefill 和 decode

现在把自回归和 attention 放在一起看。

用户输入一个 2000 token 的 prompt。模型第一步要对这 2000 个 token 全部算一遍 attention，每个 token 都要看它前面的所有 token。这 2000 个 token 是同时给的，可以并行算：2000 个 q 和 2000 个 k 做点积，一次矩阵乘法搞定。这个阶段叫 prefill。

prefill 算完，模型输出第 2001 个 token。然后进入自回归：把这个 token 接上去，再算下一个。

但注意，这时候前 2000 个 token 的 attention 不用重算，它们的输出在 prefill 时已经算完了。真正要算的只有新 token：它的 q 要和前面 2001 个 token 的 k 做点积，再按权重把 2001 个 v 加起来。所以每一步只处理一个 token，只有一个 q。这个阶段叫 decode。

decode 每一步只有一个新 token 进来，但它需要前面所有 token 的 k 和 v。这些 k 和 v 每一步都被用到，而且不会变，因为老 token 的向量和权重矩阵都没变。那何必每步重算？算一次存起来就行。存的这些 k 和 v 就是 KV cache。

反过来，老 token 的 q 要不要存？不要。token 50 的 q 只在生成 token 51 那一步用过，之后再也没人来查它。q 是"来查的"，查完就扔；k 和 v 是"被查的"，每步都被查。这就是为什么叫 KV cache 而不是 QKV cache。

<figure>
<svg viewBox="0 0 640 290" role="img" aria-label="prefill 和 decode 的时间线：prefill 一步并行处理 2000 个 token 并写入 KV cache，之后每个 decode 步只处理一个新 token，读全部缓存并追加一条">
<text x="20" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">时间 →</text>
<rect x="20" y="40" width="200" height="50" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="120" y="60" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">prefill</text>
<text x="120" y="78" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">2000 个 token 并行，一次算完</text>
<rect x="240" y="40" width="70" height="50" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="320" y="40" width="70" height="50" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="400" y="40" width="70" height="50" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="275" y="60" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">decode</text>
<text x="275" y="78" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">token 2001</text>
<text x="355" y="60" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">decode</text>
<text x="355" y="78" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">token 2002</text>
<text x="435" y="60" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">decode</text>
<text x="435" y="78" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">token 2003</text>
<text x="500" y="70" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">… 每步一个 token</text>
<text x="20" y="128" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">KV cache（每层存下所有 token 的 k、v）</text>
<rect x="20" y="140" width="200" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="120" y="156" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">写入 2000 条</text>
<rect x="240" y="140" width="200" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="440" y="140" width="10" height="22" fill="var(--mem)" stroke="var(--mem)"/>
<text x="340" y="156" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">读 2000 条，追加 1 条</text>
<rect x="240" y="172" width="210" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="450" y="172" width="10" height="22" fill="var(--mem)" stroke="var(--mem)"/>
<text x="345" y="188" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">读 2001 条，追加 1 条</text>
<rect x="240" y="204" width="220" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="460" y="204" width="10" height="22" fill="var(--mem)" stroke="var(--mem)"/>
<text x="350" y="220" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">读 2002 条，追加 1 条</text>
<text x="20" y="258" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">prefill：很多 q 同时算，大矩阵乘法，卡算力（Day 5）</text>
<text x="20" y="280" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">decode：一个 q，但要读全部 k、v 和全部权重，卡带宽（Day 5）</text>
</svg>
<figcaption>prefill 一步吃掉整个 prompt 并把 2000 个 token 的 k、v 写进缓存；之后每个 decode 步只算一个新 token 的 q、k、v，读一遍缓存，再把新的 k、v 追加进去。缓存里从头到尾没有 q。</figcaption>
</figure>

prefill 和 decode 这两个阶段，一个是很多 token 并行算，一个是一次一个 token 串行算，它们的性能特征完全不同。Day 5 会用 roofline 算出来：prefill 卡算力，decode 卡带宽。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/eMlx5fFNoYc" title="Attention in transformers, step-by-step | Deep Learning Chapter 6" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>3Blue1Brown · Attention in transformers, step-by-step | Deep Learning Chapter 6 · 26 分钟。把"看一眼旁边、把信息混进来"做成了动画，q、k 的点积和 v 的加权混合分开画，正好对应我答错的那道题。看完再回头看上面那张 3 × 3 的表。</figcaption>
</figure>

## 名词解释

| 名词 | 意思 |
| --- | --- |
| logits | 模型最后输出的原始分数，词表大小那么多个，还没变成概率 |
| softmax | 把一组数变成加起来等于 1 的概率：每个取 e 的幂，除以总和 |
| temperature | softmax 之前先把 logits 除以 T。T 小输出保守，T 大输出随机 |
| greedy | 每一步直接选概率最大的 token，等价于 T 趋近 0 |
| 自回归 autoregressive | 生成一个 token，接回输入，再生成下一个，循环 |
| RoPE | rotary position embedding，Llama 给 q、k 按位置旋转来注入位置信息，无参数 |
| q / query | 每个 token 拿去查别人的向量，x × W^q |
| k / key | 每个 token 等着被查的标签向量，x × W^k |
| v / value | 每个 token 被混合进别人输出的内容向量，x × W^v |
| 点积 | 两个向量对应位置相乘再加起来，得一个数；q·k 就是相似度 |
| head | 一套独立的 q/k/v 计算。Llama-2-7B 有 32 个 |
| head_dim | 每个头的 q/k/v 向量长度，4096 ÷ 32 = 128 |
| W^o | 多头拼接后再乘的 4096 × 4096 矩阵，把各头结果混合 |
| GQA | 多个 q 头共用一组 k、v；Llama-3-8B 是 32 个 q 头共用 8 组 |
| causal mask | 把"后面的 token"的相似度设成 -∞，softmax 后权重变 0 |
| 注意力矩阵 | n 个 q 和 n 个 k 的所有点积，n × n |
| prefill | 处理整个 prompt，所有 token 并行算 |
| decode | 每步只处理一个新 token，串行 |
| KV cache | 存下所有已处理 token 的 k 和 v，供后续 decode 使用 |

## 常见误区

**以为 attention 混的是"关系"。** 不是。权重是关系，被混的是 v 向量的内容。输出向量里没有权重本身。

**以为 q 和 k 用同一个矩阵就行。** 不行，那会强制 A 看 B 和 B 看 A 强度相等。

**以为多头增加了参数量。** 没有。32 个 4096 × 128 拼起来还是 4096 × 4096。

**把向量的长度写成矩阵形状。** 一个头的 q 是 128，不是 128 × 128。

**以为 decode 阶段每一步要重算全部 token 的 attention。** 不用，老 token 的 k、v 缓存着，只算新 token 的 q。

**以为 KV cache 里存了 q。** 没有，q 用完就扔。

**以为第一个 token 也在"看上下文"。** 因果掩码下 token 1 只能看自己，它的注意力输出就是它自己的 v。上下文是从第二个 token 才开始有的。

**把 GQA 理解成"少算几个头"。** q 头一个没少，32 个头照样各算各的权重、各混各的 v，只是 4 个头查同一组 k、v。省的是 k、v 的参数和缓存，不是计算流程。

## 参考资料

文章

- Jay Alammar《The Illustrated Transformer》 https://jalammar.github.io/illustrated-transformer/ ，图最多的一篇，q/k/v 的几何画得很清楚。
- 3Blue1Brown「Attention in transformers, visually explained」 https://www.3blue1brown.com/lessons/attention ，有配套视频（已嵌在正文里），把"看一眼旁边、混进来"这件事做成了动画。
- Vaswani et al.《Attention Is All You Need》 https://arxiv.org/abs/1706.03762 ，transformer 的原始论文。只看第 3.2 节和图 2，公式 softmax(QKᵀ/√d)V 就是本文那十行 numpy。
- Harvard NLP《The Annotated Transformer》 https://nlp.seas.harvard.edu/annotated-transformer/ ，把原论文逐段配上 PyTorch 代码，`attention()` 函数十来行，和本文 numpy 版一一对应。
- Ainslie et al.《GQA》 https://arxiv.org/abs/2305.13245 ，图 2 一眼看懂多个 q 头怎么共用一组 k、v。
- bbycroft.net/llm https://bbycroft.net/llm ，三维可视化的 GPT，能看到每个矩阵的实际尺寸和数据流。上面那张形状表可以对着它复核。

视频

- 李宏毅《機器學習 2021》自注意力機制 (Self-attention) 上、下两集。已嵌在正文开头（B 站合集 `BV1Wv411h7kN` 第 38、39 集）。YouTube 版 ID `hYdO9CscNes`、`gmsMY5kc-zw`。课程主页 https://speech.ee.ntu.edu.tw/~hylee/ml/2021-spring.php 有讲义 PDF。
- Andrej Karpathy「Let's build GPT: from scratch, in code, spelled out」，Zero to Hero 系列第 7 集，https://karpathy.ai/zero-to-hero.html ，YouTube ID `kCc8FmEb1nY`。用代码从零写一个 GPT，attention 那段（大约 55 分到 1 小时 20 分）可以对着上面的手算例子看。代码仓库 https://github.com/karpathy/nanoGPT 。

## 自测

合上笔记做。

1. 用自己的话说 q、k、v 三个向量各自的角色，哪个用来算权重，哪个被加权求和？

<details><summary>答案</summary>

q 是"来查的"，k 是"被查的标签"，两者点积算出权重。v 是"被混合的内容"，按权重加权求和得到输出。权重决定比例，v 决定内容。

</details>

2. 为什么 q 和 k 不能用同一个矩阵生成？

<details><summary>答案</summary>

用同一个矩阵，token A 对 B 的相似度和 B 对 A 的一定相等（点积对称）。但实际上 A 需要看 B 的程度和 B 需要看 A 的程度可以不同，两个矩阵才能表达这种不对称。

</details>

3. Llama-2-7B 一个头的 q 向量多长？一个头的 W^q 矩阵几行几列？整层 W^q 几行几列？

<details><summary>答案</summary>

q 长 128。一个头的 W^q 是 4096 × 128（输入 4096，输出 128）。32 个头并排，整层 W^q 是 4096 × 4096。

</details>

4. 序列长度从 1000 变成 4000，注意力矩阵的格子数变成几倍？

<details><summary>答案</summary>

16 倍。注意力矩阵是 n × n，n 变 4 倍，格子数变 16 倍。

</details>

5. decode 阶段为什么只需要缓存 k 和 v，不需要缓存 q？

<details><summary>答案</summary>

新 token 的 q 要和前面所有 token 的 k 算权重、再加权所有 token 的 v，所以老 token 的 k、v 每步都被用到，缓存能省重算。老 token 的 q 只在它自己被生成那一步用过一次，之后没人再查它，缓存没意义。

</details>

6. temperature 设成 0.1 和 2.0，输出有什么不同？背后是什么操作？

<details><summary>答案</summary>

T = 0.1 时 logits 被除以 0.1 等于放大 10 倍，softmax 后最高的那个接近 1，输出保守、几乎每次一样。T = 2.0 时 logits 缩小一半，各 token 概率更平均，输出更随机。操作就是 softmax 前的一个除法。

</details>

7. 手算题。k1 = [1, 0]，k2 = [0, 1]，v1 = [2, 0]，v2 = [0, 2]，来了第三个 token，k3 = [1, 0]，v3 = [4, 4]，它的 q3 = [0, 2]。不缩放、有因果掩码，token 3 的注意力输出是多少？

<details><summary>答案</summary>

点积：q3·k1 = 0，q3·k2 = 2，q3·k3 = 0。softmax：e⁰ = 1，e² ≈ 7.39，e⁰ = 1，总和 9.39，权重约 [0.107, 0.787, 0.107]。输出 = 0.107 × [2, 0] + 0.787 × [0, 2] + 0.107 × [4, 4] = [0.21 + 0 + 0.43, 0 + 1.57 + 0.43] ≈ [0.64, 2.00]。q3 和 k2 最像，所以输出主要是 v2 的内容。注意 k3 和 k1 一样，但 v3 和 v1 完全不同：标签相同不代表内容相同，这就是 k 和 v 要分开的原因。

</details>

## 明天预告

Day 4 讲两个数字怎么算出来：一次前向要多少 FLOPs，以及 KV cache 每个 token 要多少字节。前者是 2 × 参数量 × token 数，加上今天说的 n² 项；后者是 2 × 层数 × d × 2 字节。都能用今天和 Day 2 的东西推出来。
