---
title: 'Day 2 · Transformer 零件图：把 Llama-2-7B 的 6.74B 参数一个矩阵一个矩阵数出来'
description: '不靠任何公式表，只用「矩阵形状 = 输入长度 × 输出长度」一条规律，把 Llama-2-7B 的 6.74B 参数从头数到尾，再算出它在 fp16 下占多少显存。同一套算法顺手对账 13B、Llama-3-8B 和 TinyLlama-1.1B。'
pubDate: 2026-08-31
regime: none
tags: ['transformer', 'parameters', 'llama', 'aiinfra-365']
series: 'aiinfra-365'
day: 2
lang: 'zh'
---

## 今天要解决的问题

昨天读完 Brrrr，知道了 GPU 上的时间要么花在算、要么花在搬、要么花在等。但「搬多少字节」「算多少次」这两个数从哪来？从模型的参数量来。所以今天只做一件事：把 Llama-2-7B 的参数量自己数出来，对上官方那个 6.74B，再乘 2 字节得到它的显存占用。

这件事听起来像查表，其实不是。数出来之后我发现，所谓「7B 模型」里的每一个数字都能追溯到某一个具体的矩阵，而且换一个模型（比如 13B）照着同样的路走一遍就行。以后看任何模型的 config.json，都能在纸上把它拆开。

今天结束时要能做到三件事：

1. 看到一个矩阵，不背尺寸，只问「进来多长、出去多长」就能写出它的形状和格子数。
2. 从 Llama-2-7B 的五个配置数字出发，一步一步算到 6,738,415,616，和官方 6.74B 对上。
3. 用同一套算法对账另外三个模型：Llama-2-13B、Llama-3-8B（带 GQA）、TinyLlama-1.1B（W2 要在 Colab 上跑的那个）。

写这篇的时候我把自己算错的两处也记下来了，放在文末的错题本里。错的地方比对的地方更值得回头看。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/wjZofJX0v4M" title="Transformers, the tech behind LLMs | Deep Learning Chapter 5" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>3Blue1Brown · Transformers, the tech behind LLMs | Deep Learning Chapter 5 · 27 分钟。今天只看前半段：embedding 表怎么把 token 变成向量、最后一步 unembedding（就是本文的 lm_head）怎么变回 32000 个分数。attention 那段留到 Day 3。</figcaption>
</figure>

## 参数是什么：矩阵里的数字

先把词说清楚。一个模型「有 7B 个参数」，意思是它里面存了 70 亿个数字。这些数字不是散着放的，它们排成一张一张的表，每张表就是一个矩阵。

一个 3 行 × 2 列的矩阵长这样：

```
[ w1  w2 ]
[ w3  w4 ]
[ w5  w6 ]
```

6 个格子，6 个数字，6 个参数。任何矩阵的参数量都是**行数 × 列数**，没有别的算法。

这些数字还有另一个名字叫**权重**（weight），W 这个字母就是从这里来的。两个词指同一个东西，区别只在语境：数格子的时候叫参数，讲它在干活的时候叫权重。「权」的意思是，输入向量乘上它时，每个数字决定输入的某一部分被放大还是压小。训练结束后这些数字就固定了，模型文件下载下来那十几个 GB，装的就是它们。

## 向量和矩阵不是一回事：全文最重要的一条规律

这一节我卡了两次，所以单独写。

**向量**是一排数字，只有一个属性：长度。`[a b c]` 是一个长度为 3 的向量。它没有行也没有列，不要问它「几行几列」。

**矩阵**是一张表，有行有列。上面那个 3 × 2 的表就是矩阵。

模型里发生的最基本动作是「一个向量乘一个矩阵，得到另一个向量」。把它展开写一次：

```
向量          矩阵            结果
[a b c]  ×  [ w1  w2 ]  =  [ a·w1 + b·w3 + c·w5 ,  a·w2 + b·w4 + c·w6 ]
            [ w3  w4 ]
            [ w5  w6 ]
```

看结果是怎么来的：结果的第一个数字，是向量和矩阵**第一列**逐个相乘再加起来；结果的第二个数字，是向量和矩阵**第二列**逐个相乘再加起来。矩阵有 2 列，结果就有 2 个数字。矩阵之所以有 3 行，是因为向量有 3 个数字，一一对应才能乘。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="一个长 3 的向量乘一个 3×2 的矩阵得到一个长 2 的向量，行数对应输入长度，列数对应输出长度">
<text x="20" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">输入向量（长 3）</text>
<rect x="20" y="40" width="34" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="54" y="40" width="34" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="88" y="40" width="34" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="37" y="62" font-family="var(--font-mono)" font-size="13" fill="var(--ink)" text-anchor="middle">a</text>
<text x="71" y="62" font-family="var(--font-mono)" font-size="13" fill="var(--ink)" text-anchor="middle">b</text>
<text x="105" y="62" font-family="var(--font-mono)" font-size="13" fill="var(--ink)" text-anchor="middle">c</text>
<text x="150" y="62" font-family="var(--font-mono)" font-size="16" fill="var(--ink-soft)">×</text>
<text x="190" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">矩阵 3 行 × 2 列</text>
<rect x="190" y="40" width="44" height="34" fill="var(--paper-raised)" stroke="var(--rule)"/>
<rect x="234" y="40" width="44" height="34" fill="var(--paper-raised)" stroke="var(--rule)"/>
<rect x="190" y="74" width="44" height="34" fill="var(--paper-raised)" stroke="var(--rule)"/>
<rect x="234" y="74" width="44" height="34" fill="var(--paper-raised)" stroke="var(--rule)"/>
<rect x="190" y="108" width="44" height="34" fill="var(--paper-raised)" stroke="var(--rule)"/>
<rect x="234" y="108" width="44" height="34" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="212" y="62" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">w1</text>
<text x="256" y="62" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">w2</text>
<text x="212" y="96" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">w3</text>
<text x="256" y="96" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">w4</text>
<text x="212" y="130" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">w5</text>
<text x="256" y="130" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">w6</text>
<path d="M300 91 L340 91" stroke="var(--ink-soft)" stroke-width="1.5" marker-end="url(#arr2)"/>
<defs><marker id="arr2" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="var(--ink-soft)"/></marker></defs>
<text x="360" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">输出向量（长 2）</text>
<rect x="360" y="74" width="120" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="480" y="74" width="120" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="420" y="96" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">a·w1+b·w3+c·w5</text>
<text x="540" y="96" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">a·w2+b·w4+c·w6</text>
<path d="M140 160 L140 175 L190 175" stroke="var(--rule)" fill="none"/>
<path d="M170 46 Q 160 91 170 136" stroke="var(--mem)" fill="none" stroke-width="1.5"/>
<text x="20" y="180" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">行数 3 = 输入长度</text>
<path d="M190 155 L278 155" stroke="var(--compute)" stroke-width="1.5"/>
<text x="290" y="180" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">列数 2 = 输出长度</text>
<text x="20" y="222" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">结果的第 j 个数 = 输入向量 与 矩阵第 j 列 逐个相乘再相加</text>
<text x="20" y="240" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">参数量 = 3 × 2 = 6 个格子</text>
</svg>
<figcaption>整篇文章只用这一张图里的规律：矩阵的行数被输入向量的长度锁死，列数决定输出向量的长度。看到任何矩阵，先画「进来多长 → 出去多长」的箭头，形状自然出来。</figcaption>
</figure>

于是得到一条规律，后面所有的计算都靠它：

> **矩阵的形状 = 输入长度 × 输出长度。行数必须等于进来的向量有多长，列数决定出去的向量有多长。**

这条规律的用法是反过来用的。看到一个矩阵，不要去背它的尺寸，问两个问题：它吃进来的向量多长？它吐出去的向量多长？答案就是它的形状。

举一个马上会用到的例子。Llama-2-7B 里一个 token 的向量长 4096。一个注意力头要把它变成一个长 128 的 q 向量。那么负责这件事的矩阵，进 4096、出 128，形状就是 4096 × 128，格子数 4096 × 128 = 524,288。

我第一次答这道题的时候说的是 128 × 128。错在哪：128 × 128 的矩阵只能吃长 128 的输入，但 token 向量长 4096，塞不进去。行数必须等于输入长度，这条一旦忘了，后面算什么都是错的。

顺手把这条规律在代码里验一遍，本机终端装个 numpy 就能跑，不需要 GPU：

```python
import numpy as np

x = np.array([1.0, 2.0, 3.0])          # 输入向量，长 3
W = np.arange(6, dtype=float).reshape(3, 2)   # 3 行 2 列，参数量 6
y = x @ W                               # @ 就是「向量乘矩阵」
print(W.shape, "->", y.shape, y)        # (3, 2) -> (2,)  [16. 22.]

W_bad = np.zeros((2, 2))
try:
    x @ W_bad                           # 2×2 的矩阵吃不下长 3 的向量
except ValueError as e:
    print("shape error:", e)
```

第二段故意报错。报的那行错就是我答 128 × 128 时犯的错，只是 numpy 把它说出来了：矩阵的行数和输入长度对不上，乘法根本做不了。

## token 和 BPE：模型看到的不是字，是编号

模型不直接读文字。文字先被切成一个个 token，每个 token 是一个编号。Llama-2 的词表有 32000 个 token，也就是模型只认识 32000 种「片段」。

切分的算法叫 BPE（Byte Pair Encoding）。它的原理是统计：在训练语料里，哪两个相邻的字节对出现得最多，就把它们合并成一个新 token，反复做，直到词表凑够 32000 个。所以常见的英文单词往往自己就是一个 token，罕见的词会被拆成几段。

几个由此推出的现象，以后会反复碰到：

- 中文更费 token。BPE 的合并是按语料统计的，Llama-2 的语料以英文为主，中文字符很多都要拆成两三个字节级 token。同样一段话，中文花的 token 数常常是英文的一倍以上。这直接影响 KV cache 大小和推理成本。
- 数字被切碎。「12345」不一定是一个 token，可能是「123」「45」或者按位切开。所以模型算数不稳，一部分原因是它根本没有「看到」一个完整的数。
- 「strawberry 里有几个 r」这种题模型容易答错，因为它看到的是 「straw」「berry」两三个 token 的编号，不是 10 个字母。它得先从编号里「回忆」出拼写，再数，中间多了一步。

想亲眼看一次切分，装 transformers 之后在本机 CPU 上就能跑，不用下载权重，只下载几百 KB 的 tokenizer 文件：

```python
from transformers import AutoTokenizer

tok = AutoTokenizer.from_pretrained("TinyLlama/TinyLlama-1.1B-Chat-v1.0")  # 和 Llama-2 同一个 32000 词表
for s in ["strawberry", "12345", "我吃了一个苹果", "I ate an apple"]:
    ids = tok.encode(s, add_special_tokens=False)
    print(f"{s!r:22} {len(ids):2d} tokens  {tok.convert_ids_to_tokens(ids)}")
```

跑出来能看到英文那句大约 4 个 token，中文那句要 8 到 10 个，数字被切成两三段。数字本身不重要，重要的是「token 数不等于字数」这件事从此是亲眼见过的。

今天只需要记住：输入进模型的是一串 token 编号，输出也是 token 编号，词表大小 32000 是后面数参数时要用到的一个数。

## 模型骨架：三段

Llama-2-7B 从头到尾是三段：

```
token 编号
   ↓
embedding 表     把编号变成一个长 4096 的向量
   ↓
32 层，每层 = attention + FFN     向量进、向量出，长度始终 4096
   ↓
lm_head          把长 4096 的向量变成 32000 个分数，每个 token 一个
   ↓
下一个 token 的概率
```

**embedding** 是一张查找表。32000 个 token 每个对应一行，一行 4096 个数字，就是这个 token 的「向量表示」。查表的过程就是拿编号去取那一行。

**中间 32 层**每一层做同样的事：接进一个长 4096 的向量，做一次注意力、做一次 FFN，吐出一个长 4096 的向量交给下一层。32 层结构完全相同，参数各自独立。

**lm_head** 是最后一步：把长 4096 的向量变回「32000 个 token 各自的分数」，分数最高的那个就是模型预测的下一个 token。

d = 4096 这个数贯穿全程，叫 hidden size 或 d_model，是这个模型的「向量宽度」。

## 五个数字从哪来：读 config.json

上面用到的 32000、4096、32、11008 这些数不是背的，全部在模型仓库根目录的 `config.json` 里。Llama-2-7B 的那份文件去掉无关字段后长这样：

```json
{
  "hidden_size": 4096,
  "intermediate_size": 11008,
  "num_hidden_layers": 32,
  "num_attention_heads": 32,
  "num_key_value_heads": 32,
  "vocab_size": 32000,
  "tie_word_embeddings": false,
  "torch_dtype": "float16"
}
```

七个字段和本文的对应关系：

| 字段 | 值 | 本文里叫什么 | 用在哪 |
| --- | --- | --- | --- |
| `hidden_size` | 4096 | d | 所有矩阵的行数或列数 |
| `intermediate_size` | 11008 | FFN 中间宽度 | 只在 FFN 三个矩阵里 |
| `num_hidden_layers` | 32 | 层数 L | 一层参数乘几次 |
| `num_attention_heads` | 32 | q 的头数 | head_dim = 4096 ÷ 32 = 128 |
| `num_key_value_heads` | 32 | k、v 的头数 | 等于 q 头数就是普通多头，小于就是 GQA |
| `vocab_size` | 32000 | 词表大小 | embedding 和 lm_head 的行数或列数 |
| `tie_word_embeddings` | false | 是否共用词表 | false 就要算两张表 |

`num_key_value_heads` 这一行今天先记住它存在。Llama-2-7B 里它等于 32，和 q 头数一样，所以 W^k、W^v 和 W^q 一样宽。文末对账 Llama-3-8B 时它是 8，形状就变了。

## 词表两头：embedding 和 lm_head

现在开始数。先数最简单的两张表。

embedding 表：32000 行，每行 4096 个数。格子数 = 32000 × 4096 = 131,072,000，约 1.31 亿，记作 131M。

lm_head：用刚学的规律，它进 4096、出 32000，形状 4096 × 32000，格子数同样是 131M。

两张表合计 262M。这就是「词表两头」的全部参数。

（有些模型让 lm_head 和 embedding 共用同一张表，叫 weight tying，那样就只算一次。Llama-2 没有共用，所以算两次。）

## 一层里的注意力：4 个方阵

每一层的注意力部分有 4 个矩阵：W^q、W^k、W^v、W^o。今天不讲它们各自干什么，那是明天的内容。今天只数格子。

先看整层的形状。每个 token 的向量长 4096 进来，W^q 把它变成一个长 4096 的 q，W^k 变成长 4096 的 k，W^v 变成长 4096 的 v。进 4096 出 4096，所以这三个矩阵都是 4096 × 4096 的正方形。W^o 是注意力的最后一步，也是进 4096 出 4096，同样是 4096 × 4096。

一个 4096 × 4096 的矩阵有 4096 × 4096 = 16,777,216 个格子，约 16.8M。四个就是 67.1M。

这里有一个容易起疑的地方：明明说有 32 个头，每个头有自己的一套 W^q、W^k、W^v，怎么一层只算 4 个矩阵？

答案是：分头不增加参数，只是把大矩阵切成竖条。

一个头的 W^q 进 4096、出 128（4096 ÷ 32 = 128，叫 head_dim），形状 4096 × 128。32 个头的 W^q 并排放在一起：行数还是 4096，列数变成 32 × 128 = 4096。合起来正好是那个 4096 × 4096 的方阵。换句话说，「32 个 4096 × 128 的矩阵」和「1 个 4096 × 4096 的矩阵」是同一批数字的两种看法。实现里就是存一个大矩阵，算的时候按 128 列一段切开用。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="一层的 W^q 是 4096×4096 方阵，按列切成 32 条 4096×128 的竖条，每条是一个头">
<text x="20" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">整层 W^q：4096 行 × 4096 列 = 16.8M 个格子</text>
<rect x="20" y="40" width="384" height="150" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
<rect x="20" y="40" width="12" height="150" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="32" y="40" width="12" height="150" fill="var(--paper-raised)" stroke="var(--rule)"/>
<rect x="44" y="40" width="12" height="150" fill="var(--paper-raised)" stroke="var(--rule)"/>
<rect x="56" y="40" width="12" height="150" fill="var(--paper-raised)" stroke="var(--rule)"/>
<rect x="68" y="40" width="12" height="150" fill="var(--paper-raised)" stroke="var(--rule)"/>
<rect x="80" y="40" width="12" height="150" fill="var(--paper-raised)" stroke="var(--rule)"/>
<rect x="92" y="40" width="12" height="150" fill="var(--paper-raised)" stroke="var(--rule)"/>
<rect x="104" y="40" width="12" height="150" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="130" y="120" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">… 共 32 条，每条 128 列 …</text>
<rect x="380" y="40" width="24" height="150" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="26" y="205" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">头 1</text>
<text x="370" y="205" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">头 32</text>
<path d="M8 40 L8 190" stroke="var(--ink-soft)" stroke-width="1.5"/>
<text x="10" y="120" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" transform="rotate(-90 10 120)" text-anchor="middle">4096 行 = 输入 x 的长度</text>
<text x="430" y="60" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一个头的 W^q</text>
<text x="430" y="80" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">进 4096，出 128</text>
<text x="430" y="98" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">形状 4096 × 128</text>
<text x="430" y="116" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">格子 524,288</text>
<text x="430" y="150" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">32 条并排</text>
<text x="430" y="170" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">列数 32 × 128 = 4096</text>
<text x="430" y="188" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">格子数不变</text>
<text x="20" y="225" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">W^k、W^v 同样切法；W^o 不切，整块 4096 × 4096</text>
</svg>
<figcaption>「32 个头」不是 32 份参数，是同一个 4096 × 4096 矩阵的 32 条竖条。实现里存的就是一个大矩阵，算的时候按 128 列一段取用。</figcaption>
</figure>

拼接（concat）说的是反过来的事：32 个头各算出一个长 128 的输出向量，把它们首尾接起来，正好 32 × 128 = 4096，长度回到 4096。拼接只是摆在一起，32 个头之间还没有交流过，所以再乘一个 W^o 把它们混合一次。W^o 存在的理由就这一个。

所以一层注意力：4 × 16.8M = **67.1M**。

## 一层里的 FFN：3 个矩阵

注意力之后接 FFN（feed-forward network）。它做的事是把 4096 长的向量先变宽再变回来，中间的宽度是 11008。

Llama-2 的 FFN 用的是一种叫 SwiGLU 的结构，有 3 个矩阵：

- 两个「变宽」的：进 4096，出 11008，形状 4096 × 11008。为什么是两个？一个算内容，一个算「开关」，两者逐元素相乘。现在不用深究机制，记住是两个同形状的矩阵。
- 一个「变回来」的：进 11008，出 4096，形状 11008 × 4096。

三个矩阵的格子数都是 4096 × 11008 = 45,088,768，约 45.1M。三个合计 **135.3M**。

11008 这个数是模型设计者定的，大约是 4096 的 2.7 倍，没有推导，去 config.json 里查 `intermediate_size` 就有。换模型的时候这个数会变。

到这里一层的 7 个矩阵全部有了形状，画成一张零件图：

<figure>
<svg viewBox="0 0 640 400" role="img" aria-label="Llama-2-7B 一层的七个矩阵：注意力四个 4096×4096，FFN 两个 4096×11008 和一个 11008×4096">
<text x="20" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">一层 = 注意力 + FFN，向量长度进 4096 出 4096</text>
<rect x="20" y="40" width="600" height="150" fill="var(--paper-raised)" stroke="var(--rule)" rx="4"/>
<text x="32" y="60" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">注意力：4 个方阵，4 × 16.8M = 67.1M</text>
<rect x="40" y="80" width="80" height="80" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="80" y="115" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">W^q</text>
<text x="80" y="132" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">4096×4096</text>
<rect x="150" y="80" width="80" height="80" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="190" y="115" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">W^k</text>
<text x="190" y="132" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">4096×4096</text>
<rect x="260" y="80" width="80" height="80" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="300" y="115" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">W^v</text>
<text x="300" y="132" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">4096×4096</text>
<rect x="370" y="80" width="80" height="80" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="410" y="115" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">W^o</text>
<text x="410" y="132" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">4096×4096</text>
<text x="470" y="105" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">每个 16,777,216</text>
<text x="470" y="123" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">进 4096 出 4096</text>
<text x="470" y="141" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">只和 d 有关</text>
<rect x="20" y="210" width="600" height="165" fill="var(--paper-raised)" stroke="var(--rule)" rx="4"/>
<text x="32" y="230" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">FFN（SwiGLU）：3 个长方阵，3 × 45.1M = 135.3M</text>
<rect x="40" y="250" width="60" height="110" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="70" y="300" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">gate</text>
<text x="70" y="318" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">4096×11008</text>
<rect x="120" y="250" width="60" height="110" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="150" y="300" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">up</text>
<text x="150" y="318" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">4096×11008</text>
<rect x="200" y="275" width="110" height="60" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="255" y="300" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">down</text>
<text x="255" y="318" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">11008×4096</text>
<text x="340" y="270" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">gate、up：进 4096 出 11008（变宽）</text>
<text x="340" y="290" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">down：进 11008 出 4096（变回）</text>
<text x="340" y="310" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">每个 45,088,768 个格子</text>
<text x="340" y="330" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">11008 只在这三个矩阵里出现</text>
<text x="340" y="350" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">一层合计 202.4M；FFN 占 2/3</text>
<text x="20" y="393" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">另有 2 个 RMSNorm 各 4096 个数，不到一层的万分之一，忽略</text>
</svg>
<figcaption>Llama-2-7B 一层的七个矩阵和形状。长方形的宽高按形状比例画，能直观看到 FFN 三个矩阵每个都比注意力的方阵大将近三倍，一层里三分之二的参数在 FFN。</figcaption>
</figure>

图里有一个后面会一直用到的事实：一层的参数 2/3 在 FFN，1/3 在注意力。这不是 Llama 独有的，几乎所有 dense transformer 都是 FFN 占大头。所以 M2 学 MoE（混合专家）时会看到它改的是 FFN 而不是注意力，因为那里才是参数最多、最值得省的地方。

## 组装：6.74B 从哪来

零件齐了，组装只有三步：

一层 = 注意力 + FFN = 67.1M + 135.3M = **202.4M**

32 层 = 202.4M × 32 = **6,476.8M ≈ 6.48B**

总参数 = 32 层 + 词表两头 = 6.48B + 0.26B = **6.74B**

Meta 公布的 Llama-2-7B 参数量是 6.74B。对上了。

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="Llama-2-7B 参数量的构成条：32 层注意力 2.15B、32 层 FFN 4.33B、词表两头 0.26B，合计 6.74B">
<text x="20" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">6.74B 由谁构成（条长按参数量比例）</text>
<rect x="20" y="40" width="191" height="44" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="211" y="40" width="385" height="44" fill="var(--compute-wash)" stroke="var(--compute)"/>
<rect x="596" y="40" width="24" height="44" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
<text x="115" y="58" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">32 层注意力</text>
<text x="115" y="75" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">32 × 67.1M = 2.15B（32%）</text>
<text x="403" y="58" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">32 层 FFN</text>
<text x="403" y="75" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">32 × 135.3M = 4.33B（64%）</text>
<text x="608" y="100" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="end">词表两头 0.26B（4%）</text>
<text x="20" y="135" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一层 202.4M × 32 = 6.48B</text>
<text x="20" y="155" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">+ embedding 131M + lm_head 131M = 0.26B</text>
<text x="20" y="175" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">= 6,738,415,616 ≈ 6.74B</text>
<text x="20" y="200" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">× 2 字节（fp16）= 13.48 GB 显存，这条就是 Day 5 里「搬一遍权重要 6.6 ms」的分子</text>
</svg>
<figcaption>6.74B 的构成。词表两头只占 4%，剩下 96% 在 32 层里，其中 FFN 又占了三分之二。以后听到「7B 模型」，脑子里应该出现的是这根条，不是一个数。</figcaption>
</figure>

用代码写一遍，以后换模型直接改前几行：

```python
vocab    = 32000
d        = 4096
ffn      = 11008
n_layers = 32

embed_and_head = 2 * vocab * d           # 262,144,000
attn_per_layer = 4 * d * d               #  67,108,864
ffn_per_layer  = 3 * d * ffn             # 135,266,304
per_layer      = attn_per_layer + ffn_per_layer
total          = n_layers * per_layer + embed_and_head

print(f"{total:,}")          # 6,738,415,616
print(f"{total/1e9:.2f}B")   # 6.74B
```

有两样东西被我忽略了，说一句免得以后疑惑。每层还有两个 RMSNorm，各 4096 个数，32 层加起来才 26 万，连零头都不到。Llama-2 的所有矩阵都没有 bias 项，所以不用加。忽略之后误差在万分之几，对账没有影响。

## 同一套算法对账三个别的模型

算法对不对，换三个模型验一遍就知道。三个模型各有一个新情况：13B 只是数字变大；Llama-3-8B 引入 GQA，k、v 矩阵变窄；TinyLlama-1.1B 是 W2 要在 Colab 上真跑的模型，也带 GQA，而且数字小到能心算。

先把三个模型的 config.json 摆在一起：

| 字段 | Llama-2-7B | Llama-2-13B | Llama-3-8B | TinyLlama-1.1B |
| --- | --- | --- | --- | --- |
| `hidden_size` d | 4096 | 5120 | 4096 | 2048 |
| `intermediate_size` | 11008 | 13824 | 14336 | 5632 |
| `num_hidden_layers` | 32 | 40 | 32 | 22 |
| `num_attention_heads` | 32 | 40 | 32 | 32 |
| `num_key_value_heads` | 32 | 40 | **8** | **4** |
| head_dim = d ÷ q 头数 | 128 | 128 | 128 | 64 |
| `vocab_size` | 32000 | 32000 | 128256 | 32000 |
| 官方参数量 | 6.74B | 13.0B | 8.03B | 1.1B |

### Llama-2-13B：只是数字变大

词表两头：2 × 32000 × 5120 = 327.7M。一层注意力：4 × 5120² = 104.9M。一层 FFN：3 × 5120 × 13824 = 212.3M。一层 317.2M，40 层 12.69B，加两头 **13.02B**。fp16 显存 26.0 GB。对上官方的 13.0B。这题是我做过的原题，完整算式放在自测第 5 题里。

### Llama-3-8B：GQA 把 W^k、W^v 变窄

`num_key_value_heads` = 8，q 头数 32。意思是 32 个 q 头共用 8 组 k、v，每 4 个 q 头看同一组 k、v。这叫 GQA（grouped-query attention）。它对参数量的影响只有一处：W^k、W^v 的输出不再是 32 × 128 = 4096，而是 8 × 128 = 1024。

用形状规律一个一个写：

| 矩阵 | 进 | 出 | 形状 | 格子数 |
| --- | --- | --- | --- | --- |
| W^q | 4096 | 32 × 128 = 4096 | 4096 × 4096 | 16.78M |
| W^k | 4096 | 8 × 128 = 1024 | 4096 × 1024 | 4.19M |
| W^v | 4096 | 8 × 128 = 1024 | 4096 × 1024 | 4.19M |
| W^o | 4096 | 4096 | 4096 × 4096 | 16.78M |
| 注意力合计 | | | | 41.94M |
| gate、up、down | | | 各 4096 × 14336 | 3 × 58.72M = 176.16M |
| 一层合计 | | | | 218.10M |

32 层：218.10M × 32 = 6,979.3M。词表两头：Llama-3 词表扩到了 128256，2 × 128256 × 4096 = 1,050.7M，比 Llama-2 的 262M 大四倍，因为词表大了四倍。总计 6.98B + 1.05B = **8.03B**。官方公布 8.03B，对上了。

两个值得停一下的地方。第一，Llama-3-8B 和 Llama-2-7B 的 d、层数、头数完全一样，多出来的 1.3B 参数几乎全是词表两头（+0.79B）和更宽的 FFN（14336 对 11008，+0.5B），注意力反而因为 GQA 少了 0.8B。第二，GQA 省的参数不多（一层省 25M，占一层的 11%），它真正省的是 KV cache，Day 4 会算：k、v 向量变成 1024 长，每 token 的缓存直接缩到四分之一。

### TinyLlama-1.1B：W2 要跑的那个

这个模型的所有数都小一号，正好练心算。d = 2048，32 个 q 头所以 head_dim = 64，4 个 kv 头所以 k、v 输出 4 × 64 = 256。

- 词表两头：2 × 32000 × 2048 = 131.07M
- 一层注意力：W^q 2048 × 2048 = 4.19M，W^o 同 4.19M，W^k 2048 × 256 = 0.52M，W^v 同 0.52M，合计 9.44M
- 一层 FFN：3 × 2048 × 5632 = 34.60M
- 一层合计 44.04M，22 层 968.9M
- 总计 968.9M + 131.1M = **1.100B**

fp16 权重 1.1B × 2 = 2.2 GB。这个 2.2 GB 是 W2 在 Colab T4 上算 decode 理论下限的分子：2.2 GB ÷ 320 GB/s ≈ 6.9 ms。今天先把它算出来放着，Day 9 直接用。

也能看出为什么 W2 选它而不是 7B：T4 只有 16 GB 显存，7B fp16 的 13.5 GB 权重放进去之后只剩 2.5 GB，再减框架开销 1 到 2 GB，KV cache 几乎没地方放，稍长一点的 prompt 就 OOM。1.1B 模型 2.2 GB 权重，剩下十几 GB 随便用。

### 通用版代码

把 GQA 考虑进去，一个函数吃 config.json 就能算任何 Llama 系模型。本机终端就能跑，`AutoConfig` 只下载几 KB 的配置文件，不下载权重：

```python
from transformers import AutoConfig

def count_params(cfg):
    d, ffn, L = cfg.hidden_size, cfg.intermediate_size, cfg.num_hidden_layers
    n_q  = cfg.num_attention_heads
    n_kv = getattr(cfg, "num_key_value_heads", n_q)   # 没这个字段就是普通多头
    head_dim = d // n_q

    wq = wo = d * d
    wk = wv = d * (n_kv * head_dim)        # GQA 只改这两个
    attn = wq + wk + wv + wo
    ffn3 = 3 * d * ffn
    norms = 2 * d                          # 两个 RMSNorm，凑个整
    per_layer = attn + ffn3 + norms

    heads = cfg.vocab_size * d
    if not getattr(cfg, "tie_word_embeddings", False):
        heads *= 2                         # embedding + lm_head 两张表
    return L * per_layer + heads + d       # 最后还有一个 final norm

for name in ["TinyLlama/TinyLlama-1.1B-Chat-v1.0",
             "NousResearch/Llama-2-7b-hf",           # Llama-2 的公开镜像，不用申请许可
             "NousResearch/Llama-2-13b-hf",
             "NousResearch/Meta-Llama-3-8B"]:
    cfg = AutoConfig.from_pretrained(name)
    n = count_params(cfg)
    print(f"{name:42} {n/1e9:.3f}B  fp16 {n*2/1e9:.1f} GB")
```

预期输出四行：1.100B、6.738B、13.016B、8.030B。数字和上面手算的一致才算过。如果哪一行对不上，先查那个模型的 `num_key_value_heads` 和 `tie_word_embeddings`，十有八九是这两个字段。

## 显存：参数量乘字节数

参数量数出来之后，显存占用就是一步乘法。

每个参数用什么精度存，决定它占几个字节。fp16 是 16 位，16 ÷ 8 = 2 字节。所以：

6.74B × 2 字节 = 13.48 × 10⁹ 字节 ≈ **13.5 GB**

这就是「7B 模型 fp16 要 13.5 GB 显存」的来源。它是权重那一项，不含 KV cache 和激活，那些后面几天再算。

顺着这个逻辑，量化就一句话能说清：让每个参数用更少的字节。

| 精度 | 每个参数占几位 | 几字节 | Llama-2-7B 权重 | TinyLlama-1.1B 权重 |
| --- | --- | --- | --- | --- |
| fp32 | 32 | 4 | 27.0 GB | 4.4 GB |
| fp16 / bf16 | 16 | 2 | 13.5 GB | 2.2 GB |
| int8 | 8 | 1 | 6.7 GB | 1.1 GB |
| int4 | 4 | 0.5 | 3.4 GB | 0.55 GB |

字节数减半，搬运时间减半，这就是量化能直接换速度的原因，Day 5 算 decode 上限时会回到这个点。fp16 和 bf16 都是 16 位所以占用一样，差别在位怎么分配，Day 26 单独讲；现在只要知道 Colab 的 T4 不支持 bf16，W2 要用 fp16。

一个单位上的坑。上面算的 13.48 GB 用的是 10⁹，也就是 1 GB = 1,000,000,000 字节。但 nvidia-smi 和大多数系统工具显示的是 MiB 和 GiB，用的是 1024：1 GiB = 1,073,741,824 字节。13.48 × 10⁹ ÷ 1,073,741,824 ≈ 12.55 GiB。所以模型加载进显存，nvidia-smi 显示 12,850 MiB 左右是正常的，不是少了什么。写文章时说 GB 用 10⁹，读工具输出时记得它是 1024 制，两边差 7% 左右。

换算写成一行代码，以后看 nvidia-smi 直接套：

```python
gb  = 6.74e9 * 2 / 1e9          # 13.48 GB（10⁹ 制）
gib = 6.74e9 * 2 / 2**30        # 12.55 GiB（1024 制，nvidia-smi 用这个）
mib = 6.74e9 * 2 / 2**20        # 12,855 MiB
```

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 参数 / parameter | 模型里存的数字，全部排在矩阵里；参数量 = 所有矩阵的格子数之和 |
| 权重 / weight | 参数的另一个名字，强调它在计算中给输入「加权」；W 是 weight 首字母 |
| 向量 / vector | 一排数字，只有长度 |
| 矩阵 / matrix | 一张表，有行有列；形状 = 输入长度 × 输出长度 |
| token | 文本被切成的片段，模型的最小输入单位，用编号表示 |
| BPE | Byte Pair Encoding，通过反复合并高频字节对来建词表的算法 |
| 词表 / vocab | 模型认识的全部 token，Llama-2 是 32000 个，Llama-3 是 128256 个 |
| config.json | 模型仓库里的配置文件，数参数需要的全部数字都在里面 |
| embedding | 32000 × 4096 的查找表，把 token 编号变成向量 |
| lm_head | 4096 × 32000 的矩阵，把最后一层的向量变成 32000 个分数 |
| weight tying | embedding 和 lm_head 共用一张表，`tie_word_embeddings: true`；Llama 不共用 |
| d / hidden size / d_model | token 向量的长度，Llama-2-7B 是 4096 |
| head_dim | 一个注意力头的向量长度，= d ÷ q 头数 = 128 |
| W^q W^k W^v W^o | 一层注意力的四个矩阵，普通多头下各 4096 × 4096 |
| GQA | grouped-query attention，多个 q 头共用一组 k、v 头；W^k、W^v 输出变成 n_kv_heads × head_dim |
| `num_key_value_heads` | config.json 里 k、v 的头数；等于 q 头数是普通多头，小于就是 GQA |
| 拼接 / concat | 把 32 个头各长 128 的输出首尾接成一个长 4096 的向量 |
| FFN | feed-forward network，每层注意力之后的部分，把向量变宽再变回来 |
| intermediate_size | FFN 中间层的宽度，Llama-2-7B 是 11008 |
| SwiGLU | Llama 用的 FFN 结构，三个矩阵：gate、up 变宽，down 变回 |
| RMSNorm | 每层两个的归一化，各只有 d 个参数，数参数时可忽略 |
| fp16 / bf16 | 两种 16 位浮点，每个参数 2 字节；T4 不支持 bf16 |
| 量化 / quantization | 用更少的位存每个参数，int8 是 1 字节，int4 是半字节 |
| GB vs GiB | 10⁹ 字节 vs 2³⁰ 字节，差约 7%；nvidia-smi 显示的是 MiB |

## 常见误区

**把「32 个头」理解成参数变 32 倍。** 不是。32 个头是把 4096 × 4096 的矩阵切成 32 条 4096 × 128 的竖条，总格子数不变。

**把 head_dim 128 当成一个头的矩阵尺寸。** 128 是一个头输出向量的长度，是个向量长度。一个头的矩阵是 4096 × 128，进 4096 出 128。

**把 FFN 的中间宽度 11008 用到注意力里。** 11008 只出现在 FFN 的三个矩阵里。注意力的四个矩阵、embedding、lm_head、还有明天要讲的 KV cache，都只跟 d = 4096 有关。

**以为「7B」是精确数。** 它是四舍五入的营销数字，真实是 6.74B。算显存的时候用 6.74，不用 7，差出来的 0.5 GB 在 24 GB 的卡上有时候就是能不能装下的区别。

**看到 GQA 模型还按 4 × d² 算注意力。** Llama-3、Llama-2-70B、TinyLlama 的 `num_key_value_heads` 都小于 q 头数，W^k、W^v 只有 d × (n_kv × head_dim)。忘了这条 Llama-3-8B 会多算 0.8B。数参数前先看这个字段。

**忘了词表大小会变。** Llama-3 的词表从 32000 扩到 128256，词表两头从 0.26B 涨到 1.05B。同样是「8B」，词表两头的占比从 4% 变成 13%。

**用 1024 制算 GB 却和用 10⁹ 制的资料比对。** 两边都没错，只是单位不同。看到数字对不上，先查这一条。

## 参考资料

文章

- Jay Alammar, *The Illustrated GPT-2*。https://jalammar.github.io/illustrated-gpt2/ 。图解 transformer 每一步的数据流，读完能画出骨架图。
- 3Blue1Brown, *But what is a GPT? Visual intro to transformers*。https://www.3blue1brown.com/lessons/gpt 。文章版和视频版都在这个页面，讲 embedding 和 lm_head 最直观。
- Touvron et al., *Llama 2: Open Foundation and Fine-Tuned Chat Models*。https://arxiv.org/abs/2307.09288 。附表里有 7B/13B/70B 各自的层数、d、头数，是本文数字的来源。
- Ainslie et al., *GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints*。https://arxiv.org/abs/2305.13245 。GQA 的原始论文，只看第 2 节的图就够，能看懂 32 个 q 头怎么分组共用 8 组 k、v。
- Hugging Face Transformers 文档，Llama 2 页面。https://huggingface.co/docs/transformers/main/en/model_doc/llama2 。`LlamaConfig` 一节把 config.json 每个字段的含义列全了。

文档或代码

- `meta-llama/Llama-2-7b-hf` 的仓库页。https://huggingface.co/meta-llama/Llama-2-7b-hf 。`config.json` 里 `hidden_size`、`intermediate_size`、`num_hidden_layers`、`num_attention_heads`、`num_key_value_heads`、`vocab_size` 就是数参数需要的全部输入。需要登录并接受许可才能看文件；不想申请就用 `NousResearch/Llama-2-7b-hf` 镜像，配置一样。
- `TinyLlama/TinyLlama-1.1B-Chat-v1.0` 的 config.json。https://huggingface.co/TinyLlama/TinyLlama-1.1B-Chat-v1.0/blob/main/config.json 。W2 要跑的模型，对着它把 1.1B 再算一遍。
- `meta-llama/Meta-Llama-3-8B` 仓库页。https://huggingface.co/meta-llama/Meta-Llama-3-8B 。看 `num_key_value_heads: 8` 和 `vocab_size: 128256` 两个字段就够。
- Meta 官方 Llama 参考实现 `llama/model.py`。https://github.com/meta-llama/llama/blob/main/llama/model.py 。不到 500 行，`Attention.__init__` 里四个 `Linear` 的 in/out 尺寸、`FeedForward` 里三个 `Linear`，就是本文那 7 个矩阵的代码版。

视频 / 交互

- Brendan Bycroft, *LLM Visualization*。https://bbycroft.net/llm 。3D 可视化，每个矩阵的尺寸都标在上面，可以逐步点进去看向量怎么变成向量。对「矩阵形状 = 输入 × 输出」这条规律最对症。
- 3Blue1Brown, *Transformers, the tech behind LLMs | Deep Learning Chapter 5*。已嵌在文章开头，YouTube ID `wjZofJX0v4M`。
- Andrej Karpathy, *Let's build GPT: from scratch, in code, spelled out*。https://karpathy.ai/zero-to-hero.html 。手写 GPT，每个 `nn.Linear(in, out)` 的两个参数就是本文说的「进多长、出多长」，看代码比看图更能把形状规律钉死。Day 3 会再回来看它 attention 那段。

## 自测

合上笔记做。前四题是概念题，第五题是今天的大题，第六、七题是对账题。

**1. 一个矩阵进来的向量长 5120，出去的向量长 640，它是几行几列？有多少个参数？**

<details><summary>答案</summary>

5120 行 × 640 列。行数等于输入长度，列数等于输出长度。参数量 5120 × 640 = 3,276,800，约 3.28M。

</details>

**2. Llama-2-7B 一个注意力头的 W^k 是几行几列？32 个头的 W^k 合起来是几行几列？为什么合起来参数没有变多？**

<details><summary>答案</summary>

一个头的 W^k：进 4096、出 128，形状 4096 × 128。32 个头并排：行数不变 4096，列数 32 × 128 = 4096，形状 4096 × 4096。参数没变多是因为分头只是把一个 4096 × 4096 的矩阵按列切成 32 条，每条 128 列，总格子数一样。

</details>

**3. 一个模型用了 weight tying（embedding 和 lm_head 共用一张表），词表 32000、d 4096，词表两头一共多少参数？**

<details><summary>答案</summary>

只算一次：32000 × 4096 = 131M。Llama-2 没有共用，所以正文里算的是 262M。

</details>

**4. 同一个 7B 模型，fp16 权重 13.5 GB。改成 int4 之后权重多少 GB？nvidia-smi 里大约显示多少 MiB？**

<details><summary>答案</summary>

int4 每个参数 0.5 字节，6.74B × 0.5 = 3.37 GB。换成 MiB：3.37 × 10⁹ ÷ 1,048,576 ≈ 3,214 MiB。实际会略多一点，因为量化通常要额外存每组的缩放系数。

</details>

**5. 大题：Llama-2-13B，40 层、d = 5120、FFN 中间宽度 13824、词表 32000。数出总参数量，并算 fp16 显存。每一步写算式。**

<details><summary>答案</summary>

词表两头：2 × 32000 × 5120 = 327,680,000 ≈ 327.68M

一层注意力：4 × 5120 × 5120 = 104,857,600 ≈ 104.9M

一层 FFN：3 × 5120 × 13824 = 212,336,640 ≈ 212.3M

一层合计：104.9M + 212.3M = 317.2M

40 层：317.2M × 40 = 12,687.8M ≈ 12.69B

总参数：12.69B + 0.33B = **13.02B**

fp16 显存：13.02B × 2 字节 = **26.0 GB**（约 24.3 GiB）

对照 Meta 公布的 13B 参数量 13.0B，对上了。

注意 13824 只出现在 FFN 那一行。注意力的四个矩阵只用 5120。

</details>

**6. 在第 5 题的基础上，把 Llama-2-70B 的输入换进去：80 层、d = 8192、FFN 28672、词表 32000。但 70B 用了 GQA，K 和 V 只有 8 个头（head_dim 128）。W^k 和 W^v 各是几行几列？（Q 和 O 仍是 64 头。）**

<details><summary>答案</summary>

W^q 和 W^o：进 8192 出 8192，各 8192 × 8192。

W^k 和 W^v：进 8192，出 8 × 128 = 1024，各 8192 × 1024。这就是 GQA 省参数的地方，K/V 矩阵只有原来的 1/8。

这题不要求算总数，只要能把「进多少出多少」写对就说明规律用会了。完整对账的话还要考虑 70B 的 FFN 数字和 RMSNorm，留到后面需要时再做。

</details>

**7. TinyLlama-1.1B：22 层、d = 2048、32 个 q 头、4 个 kv 头、FFN 5632、词表 32000。一层注意力多少参数？总参数多少？fp16 权重几 GB？在 T4（320 GB/s）上 decode 一个 token 的理论下限是几毫秒？**

<details><summary>答案</summary>

head_dim = 2048 ÷ 32 = 64，k、v 输出 4 × 64 = 256。

一层注意力：W^q 2048 × 2048 = 4.19M，W^o 同，W^k 2048 × 256 = 0.52M，W^v 同，合计 9.44M。

一层 FFN：3 × 2048 × 5632 = 34.60M。一层 44.04M，22 层 968.9M。

词表两头：2 × 32000 × 2048 = 131.07M。总计 **1.100B**。

fp16 权重 2.2 GB。理论下限 2.2 GB ÷ 320 GB/s ≈ 6.9 ms，约 145 token/s。这个数 Day 9 在 Colab 上实测时要拿来对账。

</details>

## 错题本

这两个错误是我算 13B 那道题时真犯的，记在这里。

**错误一：KV cache 的公式里用了 13824。** 算 13B 每 token 的 KV cache 时我写了 2 × 40 × 13824 × 2。错在把 FFN 的中间宽度当成了 d。k 和 v 是注意力里的向量，长度是 d = 5120，跟 FFN 没关系。FFN 变宽到 13824 只是层内部的中间步骤，算完就丢，不留下任何要缓存的东西。以后看到 13824 这种数字，先问它属于哪个零件，只有 FFN 的三个矩阵用它。

**错误二：一个头的 q 向量长度答成 128 × 128，W^v 也答成 128 × 128。** 两个错误是同一个根：把向量和矩阵混了。q 是向量，长度 128，就一个数，没有「×」。W^v 是矩阵，形状看它进什么出什么：进 4096 的 token 向量、出 128 的 v 向量，所以是 4096 × 128。128 × 128 的矩阵只能吃长 128 的输入，token 向量根本进不去。纠正的方法就是那条规律：不背尺寸，问输入多长、输出多长。

这两个错误的共同点是，我在没有想清楚「这个矩阵吃什么吐什么」的情况下就开始凑数字。以后碰到任何矩阵，先画一个箭头：进来多长 → 出去多长。画不出来就不要算。

## 明天预告

今天只数了注意力四个矩阵的格子，没有说它们在干什么。明天 Day 3 讲 self-attention 的机制：q、k、v 各自的角色，为什么 q 和 k 不对称，「混的是 v 的内容而不是关系」是什么意思，多头为什么要分头再拼接。学完之后 Day 4 再回来看 KV cache 为什么只存 k 和 v 不存 q，那时候今天数的这些矩阵就都有了名字。
