---
title: 'Day 4 · 一次前向多少 FLOPs，以及 KV cache 为什么每个 token 要 512 KB'
description: '把 Day 2 数出来的参数量变成两个能算的数：模型跑一遍要做多少次运算，以及 decode 时为了不重算而缓存下来的 k、v 占多少显存。算完会发现 batch 一大，缓存比权重本身还大。附六个模型的 KV cache 对照表和一段从 config.json 自动算账的代码。'
pubDate: 2026-09-02
regime: memory
tags: ['flops', 'kv-cache', 'decode', 'gqa', 'aiinfra-365']
series: 'aiinfra-365'
day: 4
lang: 'zh'
---

## 今天要解决的问题

Day 2 把 Llama-2-7B 的 6.74B 个参数一格一格数出来了，Day 3 搞清了 attention 里 q、k、v 各自在干什么。今天把这两样东西变成数字，回答两个问题：

1. 一个 token 从头到尾过一遍模型，GPU 要做多少次运算？
2. 生成第 100 个 token 的时候，前面 99 个 token 的东西哪些要留在显存里，留多大？

第一个问题的答案是 2N，第二个问题的答案是 512 KB。这两个数明天要用来算 decode 的物理上限，所以今天必须自己推出来，不能背。

推完之后还要做两件事：把公式推广到 GQA 模型（Llama-3、Mistral、Qwen 全是），再写一段代码，让它读任何一个模型的 config.json 就能吐出参数量、FLOPs 和 KV cache。以后换模型不用重算，只用重跑。

## FLOP 和 FLOPS 不是一回事

先把两个长得像的词分开。

FLOP 是 floating point operation，一次浮点运算，是个计数单位。做了 100 次乘法就是 100 FLOP。

FLOPS 是 floating point operations per second，每秒能做多少次，是个速度单位。A100 的 312 TFLOPS 说的是每秒 312 万亿次。

所以「这个模型一次前向要 27 TFLOP」是在说工作量，「这张卡有 312 TFLOPS」是在说干活速度，工作量除以速度才是时间。写的时候注意大小写和最后有没有 S，读别人文章时也要看清楚。

| 单位 | 是多少 | 例子 |
| --- | --- | --- |
| 1 MFLOP | 10⁶ 次 | 一个 token 过一个 4096 × 4096 的矩阵：33.5 MFLOP |
| 1 GFLOP | 10⁹ 次 | 一个 token 过整个 7B 模型：13.5 GFLOP |
| 1 TFLOP | 10¹² 次 | 2000 个 token 的 prefill：27 TFLOP |
| 1 PFLOP | 10¹⁵ 次 | 训练时一个 batch 的量级 |
| 312 TFLOPS | 每秒 3.12 × 10¹⁴ 次 | A100 的 BF16 峰值速度 |

时间 = 工作量 ÷ 速度。27 TFLOP ÷ 312 TFLOPS ≈ 0.087 秒。这个除法后面会做很多遍。

还有一个约定：一次乘法加一次加法算 2 FLOP。神经网络里几乎所有运算都是「乘一下，加到累加器上」，所以后面数的时候，每对乘加都记 2。有些资料把一对乘加记成 1 次 MAC（multiply-accumulate），那它们的数会是这里的一半，看到差一倍的数字先确认口径。

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

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="一个 token 过 Llama-2-7B 的路径，每个矩阵贡献 2 倍于自身参数量的 FLOP">
<text x="8" y="18" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">一个 token 的一次前向：每过一个矩阵，FLOP = 2 × 该矩阵的格子数</text>
<rect x="8" y="40" width="64" height="44" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="40" y="58" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">embedding</text>
<text x="40" y="74" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">查表 ≈ 0</text>
<line x1="72" y1="62" x2="92" y2="62" stroke="var(--ink-faint)" stroke-width="1.2"/>
<rect x="92" y="32" width="380" height="120" rx="4" fill="none" stroke="var(--mem)" stroke-dasharray="4 3"/>
<text x="100" y="48" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">一层，重复 32 次</text>
<rect x="104" y="60" width="160" height="76" rx="3" fill="var(--mem-wash)" stroke="var(--rule)"/>
<text x="184" y="78" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">attention</text>
<text x="184" y="96" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">W^q W^k W^v W^o</text>
<text x="184" y="112" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">4 × 4096² = 67.1M 格</text>
<text x="184" y="128" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">134 MFLOP</text>
<line x1="264" y1="98" x2="292" y2="98" stroke="var(--ink-faint)" stroke-width="1.2"/>
<rect x="292" y="60" width="168" height="76" rx="3" fill="var(--mem-wash)" stroke="var(--rule)"/>
<text x="376" y="78" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">FFN</text>
<text x="376" y="96" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">gate · up · down</text>
<text x="376" y="112" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">3 × 4096 × 11008 = 135M 格</text>
<text x="376" y="128" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">270 MFLOP</text>
<line x1="472" y1="62" x2="492" y2="62" stroke="var(--ink-faint)" stroke-width="1.2"/>
<rect x="492" y="40" width="72" height="44" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="528" y="58" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">lm_head</text>
<text x="528" y="74" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">262 MFLOP</text>
<line x1="8" y1="170" x2="632" y2="170" stroke="var(--rule)"/>
<text x="8" y="192" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">合计：(134 + 270) × 32 + 262 ≈ 13.2 GFLOP；加上 embedding 的 262M 参数按 2N 记就是 13.5 GFLOP</text>
</svg>
<figcaption>一个 token 走一遍模型，路过的每个矩阵都贡献「2 × 格子数」次运算。一层 405 MFLOP，32 层加 lm_head 约 13.2 GFLOP；粗算直接用 2N = 13.5 GFLOP，差的那 2% 是 embedding 查表，它其实不做乘法。</figcaption>
</figure>

把这张图的数字对一遍。一层里 attention 的四个方阵 4 × 4096 × 4096 = 67.1M 格，2 倍就是 134 MFLOP；FFN 三个矩阵 3 × 4096 × 11008 = 135.3M 格，270 MFLOP。一层合计 405 MFLOP，32 层 12.95 GFLOP，加 lm_head 的 32000 × 4096 = 131M 格、262 MFLOP，总共 13.2 GFLOP。跟 2N = 13.5 GFLOP 差的 0.26 GFLOP 就是 embedding 那 131M 参数，它是查表不是乘法，2N 把它多算了。这个差别 2%，粗算时忽略。

如果一次喂进去 T 个 token，每个 token 都要独立过一遍所有矩阵，所以：

**一次前向 ≈ 2 × N × T FLOP**

这条是整个 AI infra 里最常用的估算公式，训练时再乘 3（反向传播大约是前向的两倍），M9 会用到。

顺手说一下 embedding。查表严格说不是矢量乘矩阵，只是从 32000 行里挑一行出来，几乎不花运算。所以更精确的口径是 2 × (N − embedding 参数量)，但 embedding 只占 7B 的 2%，粗算时忽略没关系。

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

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="参数项 2Nn 与 attention 平方项 4Ln²d 随序列长度变化的对数坐标图，在约 25.7k token 处交叉">
<line x1="60" y1="180" x2="610" y2="180" stroke="var(--rule)"/>
<line x1="60" y1="30" x2="60" y2="180" stroke="var(--rule)"/>
<g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
<text x="60" y="196" text-anchor="middle">1k</text>
<text x="195" y="196" text-anchor="middle">4k</text>
<text x="330" y="196" text-anchor="middle">16k</text>
<text x="465" y="196" text-anchor="middle">64k</text>
<text x="600" y="196" text-anchor="middle">256k</text>
<text x="335" y="214" text-anchor="middle">序列长度 n（对数刻度）</text>
<text x="54" y="184" text-anchor="end">10¹¹</text>
<text x="54" y="134" text-anchor="end">10¹³</text>
<text x="54" y="84" text-anchor="end">10¹⁵</text>
<text x="54" y="34" text-anchor="end">10¹⁷</text>
<text x="14" y="22">FLOP</text>
</g>
<line x1="195" y1="180" x2="195" y2="30" stroke="var(--rule-soft)" stroke-dasharray="2 3"/>
<line x1="533" y1="180" x2="533" y2="30" stroke="var(--rule-soft)" stroke-dasharray="2 3"/>
<text x="533" y="26" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">128k</text>
<line x1="60" y1="126.5" x2="600" y2="66.3" stroke="var(--mem)" stroke-width="2.5"/>
<line x1="60" y1="161.5" x2="600" y2="41" stroke="var(--compute)" stroke-width="2.5"/>
<circle cx="374" cy="91.5" r="4.5" fill="var(--paper-raised)" stroke="var(--ink)" stroke-width="2"/>
<text x="384" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">交叉点 n ≈ 25.7k</text>
<text x="70" y="118" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">参数项 2·N·n（一次方）</text>
<text x="70" y="158" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">attention 项 4·L·n²·d（平方）</text>
<text x="200" y="240" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">4k：attention 只占参数项 8%</text>
<text x="420" y="240" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">128k：attention 是参数项的 5 倍</text>
</svg>
<figcaption>两条线都是对数坐标下的直线，斜率差一倍。平方项起点低但爬得快，在 25.7k token 附近追上参数项。日常 4k 到 8k 的上下文都在交叉点左边，参数项主导；到了 128k 已经反过来五倍。</figcaption>
</figure>

| 序列长 n | 参数项 2Nn | attention 项 4Ln²d | attention 占参数项的比例 |
| --- | --- | --- | --- |
| 2,048 | 27.6 TFLOP | 2.2 TFLOP | 8% |
| 8,192 | 110 TFLOP | 35 TFLOP | 32% |
| 32,768 | 442 TFLOP | 563 TFLOP | 127% |
| 131,072 | 1,767 TFLOP | 9,007 TFLOP | 510% |

所以「长上下文贵」不是玄学，是 n² 在表里往下走两行就翻了身。128k 上下文时 attention 的运算量是所有矩阵乘法的五倍，FlashAttention 这类东西就是冲着这一项来的，M5 会写它。

还有一个容易漏的角度：这个平方项在 prefill 和 decode 里长得不一样。prefill 是 n 个 q 对 n 个 k，所以是 n²。decode 每步只有 1 个新 q，它对前面 n 个 k 算相似度、混 n 个 v，一层是 4nd，32 层是 4Lnd，跟 n 是一次方关系。n = 2000 时 4 × 32 × 2000 × 4096 ≈ 1.05 GFLOP，跟 13.5 GFLOP 的参数项比是零头。所以 decode 阶段 attention 的运算量从来不是问题，问题在它要读的 KV cache 有多大，下面会算。

## prefill 和 decode 各花多少

Day 3 末尾提过，一次请求分两段。prefill 是一口气吃掉整个 prompt，decode 是之后一个一个吐 token。两段的运算量差得很远。

prefill 一个 2000 token 的 prompt：2 × 6.74e9 × 2000 ≈ 27 TFLOP。A100 满速 312 TFLOPS，理论上不到 0.1 秒。这一步是真的在算，几万亿次运算一口气做完。

decode 每生成一个 token：参数项 2 × 6.74e9 × 1 = 13.5 GFLOP，外加这个新 token 和前面所有 token 的 attention，4 × 32 × n × 4096 FLOP，n = 2000 时约 1 GFLOP。合计 14.5 GFLOP，是 prefill 的两千分之一。A100 做这点运算只要 0.05 毫秒。

<figure>
<svg viewBox="0 0 640 150" role="img" aria-label="prefill 2000 token 与 decode 一步的运算量对比，对数刻度">
<text x="8" y="18" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">同一个请求的两段，运算量差 1,860 倍（条长为对数刻度）</text>
<text x="8" y="52" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">prefill 2000 tok</text>
<rect x="130" y="38" width="443" height="20" rx="2" fill="var(--compute)"/>
<text x="580" y="53" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">27 TFLOP</text>
<text x="8" y="92" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">decode 一步</text>
<rect x="130" y="78" width="116" height="20" rx="2" fill="var(--mem)"/>
<text x="254" y="93" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">14.5 GFLOP</text>
<line x1="130" y1="110" x2="573" y2="110" stroke="var(--rule)"/>
<g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
<text x="130" y="124" text-anchor="middle">10⁹</text>
<text x="241" y="124" text-anchor="middle">10¹⁰</text>
<text x="352" y="124" text-anchor="middle">10¹¹</text>
<text x="462" y="124" text-anchor="middle">10¹²</text>
<text x="573" y="124" text-anchor="middle">10¹³</text>
</g>
<text x="8" y="144" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">A100 满速做完各需：prefill 87 ms，decode 一步 0.046 ms。但实测 decode 一步远不止 0.046 ms，原因在 Day 5。</text>
</svg>
<figcaption>prefill 是一次性的大活，decode 是几千次小活。按运算量算 decode 一步只要不到 0.05 毫秒，实际却慢一百多倍，说明 decode 的瓶颈根本不在运算量上。</figcaption>
</figure>

但实际 decode 一个 token 远不止 0.05 毫秒。这个差距是明天 roofline 的全部内容。今天先埋一句：decode 慢不是因为算得多，是因为每生成一个 token 都要把 13.5 GB 的权重从显存里完整读一遍。

## KV cache 到底缓存了什么

decode 阶段，模型正要生成第 100 个 token。这个 token 的 q 要去和前面 99 个 token 的 k 算相似度，再按结果混前面 99 个 token 的 v。那这 99 个 k 和 99 个 v 从哪来？

它们是前面 99 个 token 各自过 attention 层时算出来的。每个 token 的向量乘 W^k 得到它的 k，乘 W^v 得到它的 v。这两个东西**只和那个 token 自己有关**，第 37 个 token 的 k 在生成第 38 个、第 39 个、第 100 个 token 时都是同一个值。

于是有两个选择：

第一种，每一步都重算。生成第 100 个 token 时，把前 99 个 token 重新过一遍 W^k 和 W^v。生成第 101 个时，把前 100 个再过一遍。第 n 步要重算 n 个 token，总共 1 + 2 + ... + n，n² 量级的浪费。

第二种，第一次算出来就存下来。每个 token 的 k 和 v 算好后放在显存里，后面每一步直接拿来用。这就是 KV cache。

所以 KV cache 里存的是：**每一层、每一个已经处理过的 token，它的 k 向量和 v 向量**。注意是每一层，32 层各有自己的 W^k、W^v，算出来的 k、v 都不一样，都要各存一份。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/80bIUggRJf4" title="The KV Cache: Memory Usage in Transformers" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Efficient NLP · The KV Cache: Memory Usage in Transformers。八分钟，先复习 self-attention，再画出 cache 怎么一步步长，最后算显存占用。看完自己推一遍 512 KB，推不出来就再看一遍「Memory usage and example」那段。</figcaption>
</figure>

## 为什么不缓存 q

这个问题我第一次答的是「因为每次的 q 都不一样，所以不用存」。这个理由不够准，因为新 token 的 k 和 v 也是新的，每一步都有新的 k、v 产生，「不一样」不是 k、v 和 q 的区别。

真正的区别是**旧的会不会再被用到**。

第 50 个 token 的 k 和 v，在生成第 51、52、……、100 个 token 时每一步都被拿出来用。它们是被查的一方，后面所有 token 都要来查它。

第 50 个 token 的 q，只在生成第 50 个 token 那一步用过一次。它拿着自己去查前面 49 个 token 的 k，查完、混完 v、算出输出，这个 q 就再没有任何地方需要它了。第 51 个 token 有自己的 q，不会用第 50 个的。

一句话：k、v 是被查的，每步都被查，所以要存；q 是来查的，查完就没用，所以不存。用过即弃的东西没有缓存的价值。

这和 Day 3 讲的 q、k 不对称是同一件事的另一面。q 代表「我在找什么」，k 代表「我是什么」。「我是什么」对所有后来者都成立，「我在找什么」只对我自己这一步成立。

同样的道理也能回答「为什么不缓存 FFN 的输出」：某个 token 过完 FFN 的结果只是它自己下一层的输入，别的 token 永远不会来查它，所以用完即弃。整个 transformer 里唯一「被别人查」的东西就是 k 和 v。

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

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="左：一个 token 的 KV cache 由 32 层各 16 KB 叠成 512 KB；右：token 累积后 KV cache 总量与权重的对比">
<text x="8" y="18" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">一个 token 存什么</text>
<g>
<rect x="8" y="32" width="56" height="14" fill="var(--mem-wash)" stroke="var(--rule)"/><text x="36" y="43" text-anchor="middle" font-family="var(--font-mono)" font-size="8" fill="var(--ink)">k 8 KB</text>
<rect x="64" y="32" width="56" height="14" fill="var(--mem)" opacity="0.7" stroke="var(--rule)"/><text x="92" y="43" text-anchor="middle" font-family="var(--font-mono)" font-size="8" fill="var(--paper-raised)">v 8 KB</text>
<text x="128" y="43" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">第 1 层</text>
<rect x="8" y="48" width="56" height="14" fill="var(--mem-wash)" stroke="var(--rule)"/><rect x="64" y="48" width="56" height="14" fill="var(--mem)" opacity="0.7" stroke="var(--rule)"/><text x="128" y="59" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">第 2 层</text>
<rect x="8" y="64" width="56" height="14" fill="var(--mem-wash)" stroke="var(--rule)"/><rect x="64" y="64" width="56" height="14" fill="var(--mem)" opacity="0.7" stroke="var(--rule)"/><text x="128" y="75" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">第 3 层</text>
<text x="64" y="98" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">⋮</text>
<rect x="8" y="108" width="56" height="14" fill="var(--mem-wash)" stroke="var(--rule)"/><rect x="64" y="108" width="56" height="14" fill="var(--mem)" opacity="0.7" stroke="var(--rule)"/><text x="128" y="119" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">第 32 层</text>
</g>
<text x="8" y="146" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">32 层 × 16 KB = 512 KB / token</text>
<text x="8" y="164" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">k、v 各 4096 个 fp16 数字</text>
<line x1="230" y1="30" x2="230" y2="240" stroke="var(--rule)"/>
<text x="250" y="18" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">token 攒多了之后（fp16，Llama-2-7B）</text>
<g font-family="var(--font-mono)" font-size="10">
<text x="250" y="52" fill="var(--ink)">1 token</text>
<rect x="360" y="42" width="2" height="14" fill="var(--mem)"/>
<text x="370" y="53" fill="var(--ink-soft)">512 KB</text>
<text x="250" y="86" fill="var(--ink)">1 请求 × 2000 tok</text>
<rect x="360" y="76" width="8" height="14" fill="var(--mem)"/>
<text x="376" y="87" fill="var(--ink-soft)">1 GB</text>
<text x="250" y="120" fill="var(--ink)">权重（对照）</text>
<rect x="360" y="110" width="108" height="14" fill="var(--compute)"/>
<text x="476" y="121" fill="var(--ink-soft)">13.5 GB</text>
<text x="250" y="154" fill="var(--ink)">32 请求 × 2048 tok</text>
<rect x="360" y="144" width="256" height="14" fill="var(--mem)"/>
<text x="500" y="155" fill="var(--paper-raised)">32 GB = 权重 × 2.4</text>
<text x="250" y="188" fill="var(--ink)">13B 同场景</text>
<rect x="360" y="178" width="264" height="14" fill="var(--mem)" opacity="0.55"/>
<text x="470" y="189" fill="var(--ink)">50 GB（权重 26 GB）</text>
</g>
<text x="250" y="222" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">条长按 8 px/GB，13B 那条超出画幅被截断</text>
</svg>
<figcaption>左边是一个 token 的账：每层 k、v 各 8 KB，32 层叠成 512 KB。右边是攒起来之后的账：一个 token 不起眼，一个 2000 token 的请求就是 1 GB，batch 32 直接超过权重 2.4 倍。</figcaption>
</figure>

有一个要注意的地方。上面用 d = 4096 是因为 Llama-2-7B 的 k、v 和 q 一样宽。但很多新模型用 GQA（grouped-query attention），多个 q 头共享同一组 k、v 头。比如 Llama-2-70B 和 Llama-3 系列，q 有 32 或 64 个头，k、v 只有 8 个头。这时 k、v 向量的实际长度是 n_kv_heads × head_dim，不是 d。Llama-3-8B 是 8 × 128 = 1024，KV cache 每层只有 2 × 1024 × 2 = 4 KB，32 层 128 KB，比 Llama-2-7B 小四倍。GQA 存在的主要理由就是省这块显存。算之前先查模型配置里的 num_key_value_heads。

## 六个模型放一起算

公式有了，换模型只是换数。把常见的几个模型从 config.json 里抄出参数，一起算一遍，顺便看看 GQA 到底省了多少。

| 模型 | 层数 L | d | q 头数 | kv 头数 | head_dim | d_kv = kv 头 × head_dim | KV cache / token（fp16） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Llama-2-7B | 32 | 4096 | 32 | 32 | 128 | 4096 | 2 × 32 × 4096 × 2 = **512 KB** |
| Llama-2-13B | 40 | 5120 | 40 | 40 | 128 | 5120 | 2 × 40 × 5120 × 2 = **800 KB** |
| Llama-2-70B | 80 | 8192 | 64 | 8 | 128 | 1024 | 2 × 80 × 1024 × 2 = **320 KB** |
| Llama-3-8B | 32 | 4096 | 32 | 8 | 128 | 1024 | 2 × 32 × 1024 × 2 = **128 KB** |
| Mistral-7B | 32 | 4096 | 32 | 8 | 128 | 1024 | 2 × 32 × 1024 × 2 = **128 KB** |
| Qwen2.5-7B | 28 | 3584 | 28 | 4 | 128 | 512 | 2 × 28 × 512 × 2 = **56 KB** |
| TinyLlama-1.1B | 22 | 2048 | 32 | 4 | 64 | 256 | 2 × 22 × 256 × 2 = **22 KB** |

三个值得停一下的对比：

**70B 比 7B 的 KV cache 还小**。70B 有 80 层、d = 8192，按 MHA 算应该是 2 × 80 × 8192 × 2 = 2.5 MB 每 token，是 7B 的五倍。但它用了 8 个 kv 头，d_kv 只有 1024，算下来 320 KB，反而比 7B 的 512 KB 小。没有 GQA 的话，70B 在 batch 32 × 2048 时光 KV cache 就要 160 GB，两张 A100 都装不下它的缓存，更别说权重了。GQA 不是锦上添花，是 70B 能被部署的前提。

**同样叫 7B，KV cache 差九倍**。Llama-2-7B 512 KB，Qwen2.5-7B 56 KB。所以「7B 模型 KV cache 大概多少」这个问题没有答案，必须问具体哪个模型。以后看到任何 KV cache 数字先问 kv 头数。

**TinyLlama 是 W2 要在 Colab 上跑的模型**，22 KB 每 token。它 2000 token 的 prompt 只占 44 MB 缓存，权重 2.2 GB，缓存和权重比是 2%。这意味着 W2 在 T4 上测出来的 decode 时间几乎全是搬权重的时间，KV cache 的影响可以忽略，正好是个干净的实验对象。

## 从 config.json 自动算账

上面的表是手算的，手算的目的是确认自己懂。懂了之后就该让代码算。HuggingFace 上每个模型的 config.json 都有这几个字段，够算出参数量、每 token FLOPs 和 KV cache：

| config.json 字段 | 是什么 | Llama-2-7B 的值 |
| --- | --- | --- |
| num_hidden_layers | 层数 L | 32 |
| hidden_size | d | 4096 |
| num_attention_heads | q 头数 | 32 |
| num_key_value_heads | kv 头数，没有这个字段就等于 q 头数 | 32 |
| intermediate_size | FFN 中间宽度 | 11008 |
| vocab_size | 词表大小 | 32000 |
| torch_dtype | 权重精度 | float16 |

```python
def account(cfg, bytes_per_param=2):
    """读一个 HF config.json（dict），算出参数量、每 token 前向 FLOPs、每 token KV cache 字节数。
    只对 Llama 系结构（无 bias、SwiGLU 三矩阵 FFN、embedding 与 lm_head 不共享）精确。"""
    L  = cfg["num_hidden_layers"]
    d  = cfg["hidden_size"]
    ff = cfg["intermediate_size"]
    V  = cfg["vocab_size"]
    n_q  = cfg["num_attention_heads"]
    n_kv = cfg.get("num_key_value_heads", n_q)
    head_dim = d // n_q
    d_kv = n_kv * head_dim

    attn_params = 2 * d * d + 2 * d * d_kv        # W^q、W^o 是 d×d；W^k、W^v 是 d×d_kv
    ffn_params  = 3 * d * ff                       # gate、up、down
    params = L * (attn_params + ffn_params) + 2 * V * d   # 加 embedding 和 lm_head

    flops_per_token = 2 * params                   # 2N，忽略 attention 平方项
    kv_bytes_per_token = 2 * L * d_kv * bytes_per_param
    return params, flops_per_token, kv_bytes_per_token

llama2_7b = dict(num_hidden_layers=32, hidden_size=4096, intermediate_size=11008,
                 vocab_size=32000, num_attention_heads=32, num_key_value_heads=32)
llama3_8b = dict(num_hidden_layers=32, hidden_size=4096, intermediate_size=14336,
                 vocab_size=128256, num_attention_heads=32, num_key_value_heads=8)

for name, cfg in [("Llama-2-7B", llama2_7b), ("Llama-3-8B", llama3_8b)]:
    p, f, kv = account(cfg)
    print(f"{name}: {p/1e9:.2f}B 参数, {f/1e9:.1f} GFLOP/token, KV {kv/1024:.0f} KB/token")

# Llama-2-7B: 6.74B 参数, 13.5 GFLOP/token, KV 512 KB/token
# Llama-3-8B: 8.03B 参数, 16.1 GFLOP/token, KV 128 KB/token
```

第一行 6.74B 和 Day 2 手算的对上了，说明 Day 2 那套「一个矩阵多少格子」的数法和代码是同一件事。第二行 8.03B 是 Llama-3-8B 官方公布的参数量，也对上了。它比 Llama-2-7B 多出的 1.3B 参数有一半来自 128256 的大词表（embedding 加 lm_head 一共 1.05B），另一半来自更宽的 FFN（14336 对 11008），而 attention 部分因为 GQA 反而变小了。

这段代码的价值在于以后每换一个模型，先跑它，再动手做任何实验。M2 测 KV cache 开关、M3 调 vLLM 的 gpu_memory_utilization，第一步都是拿它算出「这个模型在这张卡上最多能同时服务多少 token」。

## 我犯过的一个错

第一次算 13B 的 KV cache 时，我写的是 2 × 40 × 13824 × 2。

13824 是 Llama-2-13B 的 FFN 中间宽度。它是错的，因为 KV cache 存的是 k 和 v，这两个向量的长度是 d = 5120。13824 只在 FFN 内部出现一下：向量从 5120 变宽到 13824，过个激活函数，再变回 5120。这个中间结果算完就扔，下一个 token 用不到它，所以**FFN 不产生任何需要缓存的东西**。

KV cache 公式里永远不会出现 FFN 宽度。看到自己往公式里代 11008 或 13824，就是想错了位置。

改过来：2 × 40 × 5120 × 2 = 819,200 字节 = 800 KB。13B 每个 token 800 KB。

这个错和 Day 2 那个「一个头的 q 答成 128 × 128」是同一类：把一个只在计算中途出现的形状，当成了要留下来的东西。判断一个量要不要留，只问一句话：下一个 token 还会用到它吗？会，就是 KV cache；不会，就是激活，用完即弃。

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
# Llama-2-70B, GQA, 8 kv heads x 128, 80 层
print(kv_cache_bytes(80, 1024, 32 * 2048) / GB)   # 20.0
```

这个对比是今天最该记住的结论：**batch 一大，KV cache 就超过权重，而且远超。**

反过来问一句也有用：一张 A100 80GB 跑 Llama-2-7B，权重 13.5 GB、框架留 1.5 GB，剩 65 GB 全给 KV cache，最多同时放多少个 token？65 GB ÷ 512 KB ≈ 133,000 个 token。按每个请求 2048 长算，最多 65 个请求同时在跑。这个数明天会和 ridge point 撞上：Day 5 会算出 batch 要开到 153 左右算力才忙满，但显存只装得下 65 个 2048 长的请求。KV cache 不只是「占显存」，它直接封住了 batching 能拉多高。

它直接推出后面两个月要学的东西。想提高吞吐就要加大 batch，加大 batch 就要给 KV cache 腾显存，显存是有限的，所以怎么精打细算地管 KV cache 成了推理引擎的核心问题。vLLM 的 PagedAttention 就是把 KV cache 像操作系统管内存那样分页管理，不再为每个请求预留 2048 个 token 的连续空间，而是按实际长度分块分配。vLLM 论文里说当时主流系统的 KV cache 有 60% 到 80% 是浪费掉的（预留了没用上、或者碎片塞不进），分页之后浪费降到 4% 以下，同样的显存能装两到四倍的请求。这一项改动让 vLLM 比当时的 HuggingFace 推理快了十几倍，靶子就是今天算的这个 32 GB。M3 读源码时会回到这里。

## 换精度之后这个数怎么变

公式最后那个 2 是 fp16 的字节数。KV cache 也可以量化，把它换成 1（fp8 或 int8）就是每 token 256 KB，同样 65 GB 能装 26 万个 token，请求数翻倍。vLLM 有 `kv_cache_dtype="fp8"` 这个开关，做的就是这件事。代价是精度，k、v 里存的是注意力要查的内容，压得太狠会让「查错人」的概率上升。这是 M2 W7 量化那周要测的三角之一。

权重量化改的是另一个数：Day 2 算的 13.5 GB 是参数量乘 2 字节，int8 就是 6.7 GB，int4 是 3.4 GB。它对 KV cache 大小没有任何影响，KV cache 的精度是独立设置的。所以「4-bit 量化模型」通常只说权重是 4-bit，KV cache 可能还是 fp16。看 benchmark 时两个精度要分开问。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| FLOP | floating point operation，一次浮点运算，计数单位。一次乘加记 2 FLOP |
| FLOPS | 每秒浮点运算次数，速度单位。A100 fp16/bf16 约 312 TFLOPS |
| GFLOP / TFLOP / PFLOP | 10⁹ / 10¹² / 10¹⁵ FLOP |
| MAC | multiply-accumulate，一次乘加。有些资料按 MAC 计数，数值是 FLOP 口径的一半 |
| 前向（forward） | 输入过一遍模型得到输出的过程，推理只有前向 |
| 2N 公式 | 一个 token 一次前向 ≈ 2 × 参数量 FLOP，来源是每个参数被乘一次加一次 |
| attention 平方项 | q 和 k 算相似度、权重混 v 这两步的运算量，prefill 时 ≈ 4 × L × n² × d，decode 每步 ≈ 4 × L × n × d，和参数无关 |
| prefill | 一次吃掉整个 prompt 的阶段，运算量大 |
| decode | 之后每次生成一个 token 的阶段，每步运算量小但要读全部权重 |
| KV cache | 每层、每个已处理 token 的 k 向量和 v 向量，存下来避免每步重算 |
| MHA | multi-head attention，k、v 头数等于 q 头数，k、v 长度 = d |
| GQA | grouped-query attention，多个 q 头共享一组 k、v 头，k、v 长度 = n_kv_heads × head_dim，KV cache 小很多 |
| MQA | multi-query attention，GQA 的极端情况，所有 q 头共享唯一一组 k、v，kv 头数 = 1 |
| d_kv | 每个 token 的 k（或 v）向量实际长度，= n_kv_heads × head_dim。MHA 下等于 d |
| config.json | HuggingFace 模型目录里描述结构的文件，层数、宽度、头数都在里面 |
| PagedAttention | vLLM 的 KV cache 分块管理方式，按需分配、不预留连续大块 |
| kv_cache_dtype | vLLM 里单独设置 KV cache 精度的参数，和权重精度独立 |

## 常见误区

**把 FLOP 和 FLOPS 混用**。一个是工作量一个是速度，除一下才是时间。

**以为 attention 是运算量大头**。4k 上下文里 attention 只占矩阵乘法的 8%，几万 token 以上才反超。短序列的优化重点不在 attention 的运算量上。

**把 prefill 的 n² 套到 decode 上**。decode 每步只有一个新 q，attention 运算量是 4Lnd，跟 n 是一次方。decode 阶段 attention 的问题不是算得多，是要读的 KV cache 多。

**把 FFN 宽度代进 KV cache 公式**。FFN 中间结果用完就扔，KV cache 里只有 k 和 v，长度是 d 或 n_kv_heads × head_dim。

**以为 KV cache 是「一个」缓存**。它是每层一份，32 层就是 32 份，公式里的 L 不能漏。

**拿 Llama-2 的 512 KB 去套所有 7B 模型**。GQA 模型的 KV cache 可以小到九分之一（Qwen2.5-7B 是 56 KB），先查 num_key_value_heads。

**以为模型越大 KV cache 一定越大**。Llama-2-70B 每 token 320 KB，比 7B 的 512 KB 小，因为 70B 用了 GQA。层数和宽度只是公式的一部分，kv 头数才是决定性的。

**把权重量化和 KV cache 量化混为一谈**。两个精度独立设置。「4-bit 模型」通常只是权重 4-bit，KV cache 可能还是 fp16。

**以为 decode 慢是因为算得多**。decode 每步只有 14 GFLOP，A100 做完不到 0.1 毫秒。慢在别处，Day 5 讲。

## 参考资料

文章

- Horace He，《Making Deep Learning Go Brrrr From First Principles》，https://horace.io/brrr_intro.html 。Day 1 读过的那篇，2N 和「算得少但慢」的直觉都从这里来。
- Kipply，《Transformer Inference Arithmetic》，https://kipp.ly/transformer-inference-arithmetic/ 。逐项算 FLOPs、KV cache、延迟的文章，今天的内容基本是它的中文重走，读它可以对答案。
- Lilian Weng，《Large Transformer Model Inference Optimization》，https://lilianweng.github.io/posts/2023-01-10-inference-optimization/ 。推理优化的全景综述，KV cache 和后面几周的量化、蒸馏都在里面。
- Google DeepMind，《How to Scale Your Model》推理章节，https://jax-ml.github.io/scaling-book/inference/ 。用 TPU 口径把 prefill、decode、KV cache 的账重新算了一遍，公式和本文一致，看它能确认这套算法不依赖具体硬件。
- NVIDIA，《GPU Performance Background User's Guide》，https://docs.nvidia.com/deeplearning/performance/dl-performance-gpu-background/index.html 。官方讲 FLOP、字节、算术强度怎么算的短文，Day 5 之前读一遍。

论文

- Kwon 等，《Efficient Memory Management for Large Language Model Serving with PagedAttention》，https://arxiv.org/abs/2309.06180 。vLLM 论文，第 2、3 节讲的就是今天算的「KV cache 比权重大、还碎片化」这个问题，60% 到 80% 浪费的数字出自这里。
- Ainslie 等，《GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints》，https://arxiv.org/abs/2305.13245 。GQA 原始论文，想知道为什么 k、v 头可以比 q 头少就看它。
- Dao 等，《FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness》，https://arxiv.org/abs/2205.14135 。冲着 attention 平方项来的那篇，M5 再细读，现在只看引言里它要解决什么。

视频

- Efficient NLP，《The KV Cache: Memory Usage in Transformers》，YouTube，已嵌在正文里。
- B 站上 KV cache 的讲解视频不少，按「KV cache 推理」关键词搜，挑一个带矩阵图示、时长十分钟以上的看。看完自己推 512 KB，推不出来就是没看懂。
- bbycroft 的 LLM 3D 可视化，https://bbycroft.net/llm 。能看到每一层的 k、v 矩阵尺寸，对着它数一遍今天的公式。

## 自测

合上笔记做。

**1. Llama-2-7B 一次前向处理 4096 个 token，大约多少 TFLOP？只算参数项。**

<details><summary>答案</summary>

2 × N × T = 2 × 6.74e9 × 4096 ≈ 55.2e12 ≈ 55 TFLOP。

</details>

**2. 为什么 attention 的 q·k 那一步不算在 2N 里？prefill 和 decode 时它分别和序列长度是什么关系？**

<details><summary>答案</summary>

2N 数的是「向量过参数矩阵」，每个参数一乘一加。q·k 是 token 和 token 之间的点积，没有参数参与，所以不在 2N 里。prefill 时 n 个 q 对 n 个 k，运算量 ≈ 4 × L × n² × d，和 n 的平方成正比；decode 每步只有 1 个新 q 对 n 个 k，≈ 4 × L × n × d，和 n 是一次方。

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

**7. Llama-2-70B 有 80 层、d = 8192、64 个 q 头、8 个 kv 头、head_dim 128。每 token 的 KV cache 是多少？如果它不用 GQA 会是多少？**

<details><summary>答案</summary>

用 GQA：d_kv = 8 × 128 = 1024，每 token = 2 × 80 × 1024 × 2 = 327,680 字节 = 320 KB，比 Llama-2-7B 的 512 KB 还小。不用 GQA：d_kv = d = 8192，每 token = 2 × 80 × 8192 × 2 = 2.5 MB，是 GQA 版的 8 倍（正好是 q 头数除以 kv 头数）。batch 32 × 2048 时 MHA 版要 160 GB 缓存，两张 A100 都装不下。

</details>

**8. 一张 A100 80GB 跑 Llama-2-7B fp16，框架预留 1.5 GB，剩下全给 KV cache，最多能同时放多少个 2048 长的请求？**

<details><summary>答案</summary>

80 − 13.5 − 1.5 = 65 GB。每个 2048 长的请求要 2048 × 512 KB = 1 GB。所以最多约 65 个请求。这个数比 Day 5 要算的「算力忙满需要 batch ≈ 153」小，说明显存会先于算力成为 batching 的天花板。

</details>

## 明天预告

今天算出了两个矛盾的数：decode 一步只要 14 GFLOP，A100 不到 0.1 毫秒就能算完；但每一步又要把 13.5 GB 权重从显存读一遍。

Day 5 讲显存花在哪、decode 为什么最快只有 150 token/s。先把显存四项（权重、KV cache、激活、框架开销）摆到一张表上，看 batch 32 × 2048 时谁占大头；再用显存带宽做一次除法，算出 decode 每秒最多生成多少个 token；最后引出算术强度和 roofline，以及整条路线最重要的一个数：A100 的 ridge point ≈ 153。那个数会告诉你为什么整个推理优化都绕不开 batching。
