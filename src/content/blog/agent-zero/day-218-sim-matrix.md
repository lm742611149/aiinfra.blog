---
title: 'Day 218 · 实验:一张相似度矩阵'
description: '用 Day 217 写的 embed 把六句 CloudLedger 客服的话两两比一遍,得到一张 6×6 的相似度矩阵。今天只学一件事:怎么读这张表。对角线、对称、按行找最像的一句、把 15 对排个队,再看真实分数挤在哪个区间,验证「看排序,别看阈值」。'
pubDate: 2026-10-22
regime: none
tags: ['embedding', 'similarity-matrix', 'numpy', 'rag', 'agent-zero']
series: 'agent-zero'
day: 218
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 217](/blog/agent-zero/day-217-embed-service/) 我们配好了硅基流动的 bge-m3,写出了 `common/embed.py`:`embed(texts)` 输入 N 条文本,按 10 条一批发请求,返回 `(N, 1024)` 的数组,每行长度都是 1。那天最后有一个数让人印象深刻:同一句话,bge-m3 和 bge-large-zh 两个模型给的向量余弦只有 0.015,所以建索引和查询必须用同一个模型。

一个向量单独看没有意义,有意义的是比较。今天把六句客服场景的话两两比一遍,一次算出 36 个余弦,排成一张 6×6 的表。这张表叫**相似度矩阵**,Day 215 的练习 3 用四个手工二维向量做过一张小的,今天换成真模型的 1024 维向量。今天不学新的 API,只学一件事:**怎么读这张表**。

## 今天要解决的问题

学完今天,你应该能做到:

1. 用 `vecs @ vecs.T` 一行算出 6 句话的相似度矩阵,说出 `(6, 1024) @ (1024, 6)` 为什么得到 `(6, 6)`,以及第 i 行第 j 列是什么意思。
2. 读懂矩阵的三个结构:对角线全是 1、左右对称、每一行就是「拿这一句去搜其余几句」的结果;会用 `np.argsort` 在每一行里找出最像的另一句。
3. 把 15 对句子按相似度排队,说出 bge-m3 在这组数据上「同话题」「有点像」「无关」大概各落在什么区间,并用实测数字解释为什么不能设一个固定阈值。
4. 能指出矩阵里一个出乎意料的高分,并给出一个合理的解释。

预计用时 2 小时:先猜后跑 20 分钟,四个脚本各 15 分钟,剩下做练习。前置:[Day 217](/blog/agent-zero/day-217-embed-service/) 的 `common/embed.py`(今天所有脚本都 import 它),[Day 215](/blog/agent-zero/day-215-cosine/) 的余弦、归一化和练习 3 的小矩阵,[Day 214](/blog/agent-zero/day-214-numpy-basics/) 的 `@` 和 `axis`。

今天所有调用都走硅基流动的 `BAAI/bge-m3`,免费;练习 3 换成 `BAAI/bge-large-zh-v1.5`,也免费。实跑花费 0 元。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `sim_matrix.py` 和 `sim_read.py` 里「每行找最像」那个循环;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先猜,再跑

做实验之前先写下预测,这是今天最重要的习惯。跑完再对答案,你才知道自己的直觉哪里准、哪里不准。

今天的六句话,编号 0 到 5:

| 编号 | 句子 | 它是什么 |
| --- | --- | --- |
| 0 | 年付套餐买错了能把钱要回来吗 | 客户口语化的退款问题 |
| 1 | 退款政策:年付套餐中途取消的,按剩余的整月数比例退款 | 帮助中心原文 |
| 2 | 怎么申请退款 | 很短的退款问题 |
| 3 | 发票抬头填错了怎么改 | 发票问题 |
| 4 | 导入银行流水时报错 E1042 | 错误码问题 |
| 5 | 今天北京天气不错 | 和客服无关 |

拿一张纸,回答三个问题:哪两句会最像?天气那句和谁最像?0 号和 3 号(退款和发票)会比 0 号和 4 号(退款和错误码)高还是低?

我自己的预测是:0 和 1 最像;天气跟谁都很低,低到 0.2 以下;0 和 3、0 和 4 差不多,都是「不同话题」。下面看哪条猜错了。

## 一行算出整张表

新建 `part04/sim_matrix.py`(在 `agent-zero-lab` 根目录下,`common/embed.py` 是 Day 217 建的):

```python
# agent-zero-lab/part04/sim_matrix.py
import numpy as np

from common.embed import embed, usage

SENTENCES = [
    "年付套餐买错了能把钱要回来吗",
    "退款政策:年付套餐中途取消的,按剩余的整月数比例退款",
    "怎么申请退款",
    "发票抬头填错了怎么改",
    "导入银行流水时报错 E1042",
    "今天北京天气不错",
]

vecs = embed(SENTENCES)
sim = vecs @ vecs.T

print("vecs.shape:", vecs.shape, " sim.shape:", sim.shape)
np.set_printoptions(precision=2, suppress=True)
print(sim)
print("请求次数:", usage["requests"], " token:", usage["tokens"])
```

<div class="line-notes">

- `from common.embed import embed, usage` Day 217 的模块。因为要 import `common`,必须在根目录用 `-m` 跑。
- `SENTENCES = [` 六句话,顺序就是上面表里的编号,后面矩阵的行号、列号都按这个编号对应。全大写是「这是常量,别改它」的约定。
- `vecs = embed(SENTENCES)` 6 条不到批大小 10,一次请求就够。实测形状 `(6, 1024)`,每行长度 1。
- `sim = vecs @ vecs.T` `.T` 是 Day 215 练习 3 学的转置,把 `(6, 1024)` 变成 `(1024, 6)`。`(6, 1024) @ (1024, 6)` 的规则是左边的列数要等于右边的行数(都是 1024),结果的形状取左边的行数和右边的列数,得到 `(6, 6)`。第 i 行第 j 列 = 第 i 个向量和第 j 个向量的点积;因为都归一化过,点积就是余弦。
- `print("vecs.shape:", vecs.shape, " sim.shape:", sim.shape)` 先确认形状,这是读任何矩阵代码的第一步。
- `np.set_printoptions(precision=2, suppress=True)` 让 numpy 打印时只保留 2 位小数,`suppress=True` 不用科学计数法(不会出现 `7.4e-01` 这种写法)。它只影响显示,`sim` 里存的值一点没变。
- `print(sim)` 打印整个矩阵。
- `print("请求次数:", usage["requests"]` 6 句话 1 次请求,76 个 token。

</div>

```bash
cd agent-zero-lab
uv run python -m part04.sim_matrix
```

真实输出:

```text
vecs.shape: (6, 1024)  sim.shape: (6, 6)
[[1.   0.74 0.69 0.63 0.52 0.37]
 [0.74 1.   0.69 0.51 0.43 0.39]
 [0.69 0.69 1.   0.59 0.53 0.41]
 [0.63 0.51 0.59 1.   0.55 0.39]
 [0.52 0.43 0.53 0.55 1.   0.33]
 [0.37 0.39 0.41 0.39 0.33 1.  ]]
请求次数: 1  token: 76
```

一次请求、76 个 token、0 元,得到 36 个数。先别急着找规律,下面一个结构一个结构地读。

<figure>
<svg viewBox="0 0 640 340" role="img" aria-label="6 乘 6 相似度矩阵的热力图,颜色越深越相似,对角线是 1">
<rect x="0" y="0" width="640" height="340" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="187" y="40" fill="var(--ink-soft)">0</text>
<text x="231" y="40" fill="var(--ink-soft)">1</text>
<text x="275" y="40" fill="var(--ink-soft)">2</text>
<text x="319" y="40" fill="var(--ink-soft)">3</text>
<text x="363" y="40" fill="var(--ink-soft)">4</text>
<text x="407" y="40" fill="var(--ink-soft)">5</text>
<text x="20" y="77" fill="var(--ink)">[0] 年付买错了</text>
<rect x="170" y="50" width="42" height="42" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="187" y="77" fill="var(--ink-faint)">1</text>
<rect x="214" y="50" width="42" height="42" fill="var(--mem)" fill-opacity="0.88"/>
<text x="221" y="77" fill="var(--paper-raised)">0.74</text>
<rect x="258" y="50" width="42" height="42" fill="var(--mem)" fill-opacity="0.78"/>
<text x="265" y="77" fill="var(--paper-raised)">0.69</text>
<rect x="302" y="50" width="42" height="42" fill="var(--mem)" fill-opacity="0.66"/>
<text x="309" y="77" fill="var(--paper-raised)">0.63</text>
<rect x="346" y="50" width="42" height="42" fill="var(--mem)" fill-opacity="0.44"/>
<text x="353" y="77" fill="var(--ink)">0.52</text>
<rect x="390" y="50" width="42" height="42" fill="var(--mem)" fill-opacity="0.14"/>
<text x="397" y="77" fill="var(--ink)">0.37</text>
<text x="20" y="121" fill="var(--ink)">[1] 退款政策原文</text>
<rect x="170" y="94" width="42" height="42" fill="var(--mem)" fill-opacity="0.88"/>
<text x="177" y="121" fill="var(--paper-raised)">0.74</text>
<rect x="214" y="94" width="42" height="42" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="231" y="121" fill="var(--ink-faint)">1</text>
<rect x="258" y="94" width="42" height="42" fill="var(--mem)" fill-opacity="0.78"/>
<text x="265" y="121" fill="var(--paper-raised)">0.69</text>
<rect x="302" y="94" width="42" height="42" fill="var(--mem)" fill-opacity="0.42"/>
<text x="309" y="121" fill="var(--ink)">0.51</text>
<rect x="346" y="94" width="42" height="42" fill="var(--mem)" fill-opacity="0.26"/>
<text x="353" y="121" fill="var(--ink)">0.43</text>
<rect x="390" y="94" width="42" height="42" fill="var(--mem)" fill-opacity="0.18"/>
<text x="397" y="121" fill="var(--ink)">0.39</text>
<text x="20" y="165" fill="var(--ink)">[2] 怎么申请退款</text>
<rect x="170" y="138" width="42" height="42" fill="var(--mem)" fill-opacity="0.78"/>
<text x="177" y="165" fill="var(--paper-raised)">0.69</text>
<rect x="214" y="138" width="42" height="42" fill="var(--mem)" fill-opacity="0.78"/>
<text x="221" y="165" fill="var(--paper-raised)">0.69</text>
<rect x="258" y="138" width="42" height="42" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="275" y="165" fill="var(--ink-faint)">1</text>
<rect x="302" y="138" width="42" height="42" fill="var(--mem)" fill-opacity="0.58"/>
<text x="309" y="165" fill="var(--paper-raised)">0.59</text>
<rect x="346" y="138" width="42" height="42" fill="var(--mem)" fill-opacity="0.46"/>
<text x="353" y="165" fill="var(--ink)">0.53</text>
<rect x="390" y="138" width="42" height="42" fill="var(--mem)" fill-opacity="0.22"/>
<text x="397" y="165" fill="var(--ink)">0.41</text>
<text x="20" y="209" fill="var(--ink)">[3] 发票抬头填错</text>
<rect x="170" y="182" width="42" height="42" fill="var(--mem)" fill-opacity="0.66"/>
<text x="177" y="209" fill="var(--paper-raised)">0.63</text>
<rect x="214" y="182" width="42" height="42" fill="var(--mem)" fill-opacity="0.42"/>
<text x="221" y="209" fill="var(--ink)">0.51</text>
<rect x="258" y="182" width="42" height="42" fill="var(--mem)" fill-opacity="0.58"/>
<text x="265" y="209" fill="var(--paper-raised)">0.59</text>
<rect x="302" y="182" width="42" height="42" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="319" y="209" fill="var(--ink-faint)">1</text>
<rect x="346" y="182" width="42" height="42" fill="var(--mem)" fill-opacity="0.5"/>
<text x="353" y="209" fill="var(--ink)">0.55</text>
<rect x="390" y="182" width="42" height="42" fill="var(--mem)" fill-opacity="0.18"/>
<text x="397" y="209" fill="var(--ink)">0.39</text>
<text x="20" y="253" fill="var(--ink)">[4] 报错 E1042</text>
<rect x="170" y="226" width="42" height="42" fill="var(--mem)" fill-opacity="0.44"/>
<text x="177" y="253" fill="var(--ink)">0.52</text>
<rect x="214" y="226" width="42" height="42" fill="var(--mem)" fill-opacity="0.26"/>
<text x="221" y="253" fill="var(--ink)">0.43</text>
<rect x="258" y="226" width="42" height="42" fill="var(--mem)" fill-opacity="0.46"/>
<text x="265" y="253" fill="var(--ink)">0.53</text>
<rect x="302" y="226" width="42" height="42" fill="var(--mem)" fill-opacity="0.5"/>
<text x="309" y="253" fill="var(--ink)">0.55</text>
<rect x="346" y="226" width="42" height="42" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="363" y="253" fill="var(--ink-faint)">1</text>
<rect x="390" y="226" width="42" height="42" fill="var(--mem)" fill-opacity="0.08"/>
<text x="397" y="253" fill="var(--ink)">0.33</text>
<text x="20" y="297" fill="var(--ink)">[5] 北京天气</text>
<rect x="170" y="270" width="42" height="42" fill="var(--mem)" fill-opacity="0.14"/>
<text x="177" y="297" fill="var(--ink)">0.37</text>
<rect x="214" y="270" width="42" height="42" fill="var(--mem)" fill-opacity="0.18"/>
<text x="221" y="297" fill="var(--ink)">0.39</text>
<rect x="258" y="270" width="42" height="42" fill="var(--mem)" fill-opacity="0.22"/>
<text x="265" y="297" fill="var(--ink)">0.41</text>
<rect x="302" y="270" width="42" height="42" fill="var(--mem)" fill-opacity="0.18"/>
<text x="309" y="297" fill="var(--ink)">0.39</text>
<rect x="346" y="270" width="42" height="42" fill="var(--mem)" fill-opacity="0.08"/>
<text x="353" y="297" fill="var(--ink)">0.33</text>
<rect x="390" y="270" width="42" height="42" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="407" y="297" fill="var(--ink-faint)">1</text>
<text x="456" y="70" fill="var(--ink)">怎么读</text>
<text x="456" y="96" fill="var(--ink-soft)" font-size="11">第 i 行第 j 列 =</text>
<text x="456" y="112" fill="var(--ink-soft)" font-size="11">第 i 句和第 j 句的余弦</text>
<text x="456" y="142" fill="var(--ink-soft)" font-size="11">对角线:自己和自己 = 1</text>
<text x="456" y="168" fill="var(--ink-soft)" font-size="11">左下 = 右上(对称)</text>
<text x="456" y="194" fill="var(--ink-soft)" font-size="11">左上角 0-1-2 一块最深:</text>
<text x="456" y="210" fill="var(--ink-soft)" font-size="11">三句退款互相最像</text>
<text x="456" y="236" fill="var(--ink-soft)" font-size="11">最下一行最浅:</text>
<text x="456" y="252" fill="var(--ink-soft)" font-size="11">天气跟谁都不像</text>
<text x="456" y="290" fill="var(--ink-faint)" font-size="11">颜色深浅按 0.3–0.8 映射</text>
</g>
</svg>
<figcaption>把上面打印的矩阵画成热力图。数字是真实输出(保留两位),颜色越深越相似。三句退款在左上角挤成一块,这种「块」是相似度矩阵里最值得找的东西:一块就是一个话题。</figcaption>
</figure>

## 读法一:对角线和对称

任何相似度矩阵,先看两个「必须成立」的结构,它们不成立就说明代码有 bug。

**对角线**是第 i 行第 i 列,每句话和自己比,夹角 0 度,余弦应该是 1。

**对称**是指第 i 行第 j 列等于第 j 行第 i 列。cos(0 号, 3 号) 和 cos(3 号, 0 号) 当然是同一个数,点积交换顺序不变。所以矩阵沿对角线折过来,左下和右上完全重合。

用代码确认一遍,顺便学怎么从矩阵里取一行、一列、一格。新建 `part04/sim_read.py`:

```python
# agent-zero-lab/part04/sim_read.py
import numpy as np

from common.embed import embed

SENTENCES = [
    "年付套餐买错了能把钱要回来吗",
    "退款政策:年付套餐中途取消的,按剩余的整月数比例退款",
    "怎么申请退款",
    "发票抬头填错了怎么改",
    "导入银行流水时报错 E1042",
    "今天北京天气不错",
]

vecs = embed(SENTENCES)
sim = vecs @ vecs.T

print("对角线:", np.diag(sim).round(4))
print("左右对称吗?", np.allclose(sim, sim.T, atol=1e-6))
print("第 0 行:", sim[0].round(4))
print("第 0 列:", sim[:, 0].round(4))
print("sim[0, 3] =", round(float(sim[0, 3]), 4), " sim[3, 0] =", round(float(sim[3, 0]), 4))

for i, s in enumerate(SENTENCES):
    order = np.argsort(-sim[i])
    j = next(k for k in order if k != i)
    print(f"[{i}] {s[:10]} 最像 [{j}] {SENTENCES[j][:10]}  ({sim[i, j]:.2f})")
```

<div class="line-notes">

- `SENTENCES = [` 和 `sim_matrix.py` 同样的六句话。复制而不是 import,原因 Day 215 说过:`sim_matrix.py` 顶层有 `print`,一 import 就会执行。
- `sim = vecs @ vecs.T` 同一个矩阵。注意这是第二次请求 embedding,Day 217 说过向量会有 0.001 级别的抖动,所以下面四位小数和上一个脚本打印的两位小数可能在第三、四位上略有出入。
- `np.diag(sim)` 取出对角线,得到 6 个数。`.round(4)` 保留 4 位小数。
- `np.allclose(sim, sim.T, atol=1e-6)` 矩阵和它的转置「几乎相等」就是对称。`atol=1e-6` 是允许的绝对误差 0.000001。为什么不用 `==`?因为 `float32` 做矩阵乘法时,算 `[0, 3]` 和算 `[3, 0]` 的加法顺序可能不同,最后一位可能差一点点。
- `sim[0]` 只写一个下标,取第 0 行,6 个数。相当于 JS 里二维数组的 `sim[0]`。
- `sim[:, 0]` 逗号前的 `:` 表示「所有行」,逗号后的 `0` 表示「第 0 列」,合起来是第 0 列的 6 个数。JS 没有这种写法,要 `sim.map(row => row[0])`。
- `sim[0, 3]` 第 0 行第 3 列,一个数。numpy 的二维下标写在一对方括号里,用逗号隔开,和 `sim[0][3]` 结果一样,但更快也更常见。
- `for i, s in enumerate(SENTENCES):` 逐行处理,`i` 是行号,`s` 是这一行对应的句子。
- `order = np.argsort(-sim[i])` `argsort` 返回「从小到大排序后,每个位置原来的下标」;取负号就变成从大到小。实测第 0 行排出来是 `[0, 1, 2, 3, 4, 5]`:自己排第一(1.0),然后依次是 1 号 0.74、2 号 0.69……
- `j = next(k for k in order if k != i)` 跳过自己,取排名最高的另一句。`next(...)` 取生成器的第一个元素,相当于 JS 的 `order.find(k => k !== i)`。第 0 行得到 `j=1`。
- `print(f"[{i}] {s[:10]} 最像 [{j}] {SENTENCES[j][:10]}  ({sim[i, j]:.2f})")` 句子太长,`[:10]` 只取前 10 个字。

</div>

```bash
uv run python -m part04.sim_read
```

真实输出:

```text
对角线: [1. 1. 1. 1. 1. 1.]
左右对称吗? True
第 0 行: [1.     0.7434 0.6878 0.6263 0.5239 0.3661]
第 0 列: [1.     0.7434 0.6878 0.6263 0.5239 0.3661]
sim[0, 3] = 0.6263  sim[3, 0] = 0.6263
[0] 年付套餐买错了能把钱 最像 [1] 退款政策:年付套餐中  (0.74)
[1] 退款政策:年付套餐中 最像 [0] 年付套餐买错了能把钱  (0.74)
[2] 怎么申请退款 最像 [0] 年付套餐买错了能把钱  (0.69)
[3] 发票抬头填错了怎么改 最像 [0] 年付套餐买错了能把钱  (0.63)
[4] 导入银行流水时报错  最像 [3] 发票抬头填错了怎么改  (0.55)
[5] 今天北京天气不错 最像 [2] 怎么申请退款  (0.41)
```

对角线全是 1,对称成立,第 0 行和第 0 列一模一样。这三行是「体检」,以后你写任何相似度矩阵的代码,先打印这三样。如果对角线不是 1,十有八九是忘了归一化;如果不对称,说明两边用的不是同一组向量。

## 读法二:每一行就是一次检索

后六行是今天最值得记住的读法。**矩阵的第 i 行,就是「拿第 i 句当问题,去搜其余五句」的分数**。`argsort` 从大到小一排,就是检索结果的排名。

这样看,第 0 行就是一个迷你 RAG 的检索:客户问「年付套餐买错了能把钱要回来吗」,排第一的是帮助中心原文(0.74),第二是「怎么申请退款」(0.69)。原文和问题几乎没有一个词重合,「买错了」「把钱要回来」对上了「中途取消」「退款」。Day 212 关键词搜索做不到的事,在这里第一次用真模型做到了。

第 2 行有个细节:「怎么申请退款」最像 0 号,分数 0.69;而它和 1 号的分数也是 0.69(第 2 行第 1 列)。两位小数打印出来一样,`argsort` 按完整精度排,0 号以极小的差距胜出。真实系统里,分数差在 0.01 以内的两个结果,排名基本可以看成随机的,Day 217 那 0.001 级别的抖动就可能让它们换位置。

第 3 行和第 4 行开始有意思了,下一节细说。第 5 行天气句最像「怎么申请退款」,但只有 0.41。它总得选一个,向量搜索永远会返回最像的那个,哪怕根本不像。Day 216 小项目里说过这件事,现在有了真实数字。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="相似度矩阵的一行对应一次检索:第0行从大到小排序就是问题0的检索结果">
<rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="30" fill="var(--ink)">sim[0] = 第 0 句去搜全部 6 句</text>
<rect x="20" y="44" width="80" height="30" fill="none" stroke="var(--rule)"/><text x="30" y="64" fill="var(--ink-faint)">[0] 1.00</text>
<rect x="104" y="44" width="80" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="114" y="64" fill="var(--ink)">[1] 0.74</text>
<rect x="188" y="44" width="80" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="198" y="64" fill="var(--ink)">[2] 0.69</text>
<rect x="272" y="44" width="80" height="30" fill="none" stroke="var(--ink-soft)"/><text x="282" y="64" fill="var(--ink)">[3] 0.63</text>
<rect x="356" y="44" width="80" height="30" fill="none" stroke="var(--ink-soft)"/><text x="366" y="64" fill="var(--ink)">[4] 0.52</text>
<rect x="440" y="44" width="80" height="30" fill="none" stroke="var(--ink-soft)"/><text x="450" y="64" fill="var(--ink)">[5] 0.37</text>
<text x="20" y="104" fill="var(--ink-soft)">np.argsort(-sim[0]) → [0, 1, 2, 3, 4, 5]</text>
<text x="20" y="128" fill="var(--ink-soft)">跳过自己(0) → 检索结果:1, 2, 3, 4, 5</text>
<line x1="20" y1="146" x2="620" y2="146" stroke="var(--rule)"/>
<text x="20" y="170" fill="var(--compute)">Day 226 的检索:一个问题 @ 几百段文档 = 矩阵的一行</text>
<text x="20" y="188" fill="var(--ink-faint)" font-size="11">今天是 6 句互相搜,所以每句既是问题又是文档</text>
</g>
</svg>
<figcaption>相似度矩阵是「每句都当一次问题」的检索结果汇总。以后真正的检索只算其中一行:问题向量和所有文档向量做点积,练习 4 就是这么写的。</figcaption>
</figure>

## 读法三:把 15 对排个队

36 个数里,对角线 6 个没用,剩下 30 个因为对称只有一半是独立的,也就是 15 对。把这 15 对从高到低排一遍,整体的分布就清楚了。新建 `part04/sim_pairs.py`:

```python
# agent-zero-lab/part04/sim_pairs.py
import numpy as np

from common.embed import embed

SENTENCES = [
    "年付套餐买错了能把钱要回来吗",
    "退款政策:年付套餐中途取消的,按剩余的整月数比例退款",
    "怎么申请退款",
    "发票抬头填错了怎么改",
    "导入银行流水时报错 E1042",
    "今天北京天气不错",
]

vecs = embed(SENTENCES)
sim = vecs @ vecs.T
n = len(SENTENCES)

pairs = []
for i in range(n):
    for j in range(i + 1, n):
        pairs.append((float(sim[i, j]), i, j))
pairs.sort(reverse=True)

print("一共", len(pairs), "对")
for score, i, j in pairs:
    print(f"  {score:.4f}  [{i}]-[{j}]")

off = np.array([p[0] for p in pairs])
print(f"非对角线:最小 {off.min():.4f}  最大 {off.max():.4f}  平均 {off.mean():.4f}")
print("大于 0.6 的有:", [(i, j) for s, i, j in pairs if s > 0.6])
```

<div class="line-notes">

- `n = len(SENTENCES)` 6。
- `pairs = []` 装 `(分数, i, j)` 三元组。
- `for i in range(n):` 外层走每一行。
- `for j in range(i + 1, n):` 内层只走对角线**右边**的列:i=0 时 j 是 1 到 5,i=1 时 j 是 2 到 5……这样每对只取一次,对角线也跳过了。一共 5 + 4 + 3 + 2 + 1 = 15 对。
- `pairs.append((float(sim[i, j]), i, j))` 分数放在元组的第一位,是为了下一行排序方便。`float()` 把 `np.float32` 转成普通小数。
- `pairs.sort(reverse=True)` 元组排序先比第一个元素,也就是分数;`reverse=True` 从大到小。分数相同时才比第二个元素,这里不会遇到。
- `for score, i, j in pairs:` 遍历时直接把三元组拆成三个变量,[Day 22](/blog/agent-zero/day-022-tuples-unpack/) 学的解包,相当于 JS 的 `for (const [score, i, j] of pairs)`。
- `off = np.array([p[0] for p in pairs])` 把 15 个分数单独拿出来变成数组,方便算最小、最大、平均。`off` 是 off-diagonal(非对角线)的缩写。
- `[(i, j) for s, i, j in pairs if s > 0.6]` 试一个阈值:大于 0.6 的算「相关」,看看会选出哪几对。

</div>

```bash
uv run python -m part04.sim_pairs
```

真实输出:

```text
一共 15 对
  0.7442  [0]-[1]
  0.6880  [0]-[2]
  0.6858  [1]-[2]
  0.6259  [0]-[3]
  0.5889  [2]-[3]
  0.5497  [3]-[4]
  0.5328  [2]-[4]
  0.5249  [0]-[4]
  0.5071  [1]-[3]
  0.4346  [1]-[4]
  0.4119  [2]-[5]
  0.3930  [3]-[5]
  0.3896  [1]-[5]
  0.3666  [0]-[5]
  0.3299  [4]-[5]
非对角线:最小 0.3299  最大 0.7442  平均 0.5182
大于 0.6 的有: [(0, 1), (0, 2), (1, 2), (0, 3)]
```

`[0]-[1]` 这次是 0.7442,上一个脚本是 0.7434,差在第四位,这就是 Day 217 说的服务端抖动,不影响任何排序结论。

把 15 对按话题分成三档,在这组数据上:

- 三句退款之间(0-1、0-2、1-2):0.69 到 0.74
- 客服语境、不同话题(退款、发票、错误码之间):0.43 到 0.63
- 和天气句:0.33 到 0.41

三档确实分开了,embedding 抓住了「意思」。但看看档和档之间的距离:最高一档的最低分 0.6858,和第二档的最高分 0.6259 只差 0.06。整张表的分数挤在 0.33 到 0.74 之间,一句完全无关的话也有 0.33,没有一对低于 0.3。理论上余弦能到 -1,真实句向量却几乎全挤在正数的一小段里。这就是 Day 215 结尾说的「真实 embedding 的余弦大多挤在一个窄区间里」。

最后一行是阈值实验。设「大于 0.6 算相关」,选出了四对,前三对是退款,第四对是 `(0, 3)`:退款问题和发票问题。阈值把一对不相关的放了进来。改成 0.65 能把它挡掉,但只是在这六句话上碰巧。练习 3 换个模型,你会看到这个数要整体往下挪。**同一个阈值,换一句话、换一个模型就失灵;排序则稳得多**,这就是「看排序,别看阈值」。

## 那个出乎意料的 0.63

回到开头的预测。我猜对了 0 和 1 最像,猜错了两处。

第一处,天气句没有低到 0.2 以下,最低也有 0.33。原因上一节说了,真实向量的余弦整体偏高。

第二处更有意思:0 ↔ 3 是 0.63,而 0 ↔ 4 只有 0.52。退款问题和发票问题,居然比和退款原文以外的任何句子都近,排在整张表第四。看这两句:

- 0:年付套餐**买错了**能把钱要回来吗
- 3:发票抬头**填错了**怎么改

话题不同,但句式和口吻几乎一样:都是「客户弄错了一样东西,问怎么补救」。embedding 学到的不只是话题,还有语气、句式、意图这些东西,它们全都揉在那 1024 个数里。对客服场景来说,这有时是好事(「我弄错了」类的问题聚在一起),有时是坏事(检索时发票文章跑到退款问题的前几名)。

这也是为什么我坚持先猜再跑。如果你不先写下「0-3 和 0-4 差不多」,看到输出时很可能一眼扫过去,觉得「嗯,数字都挺合理」,错过整张表里最有信息量的一格。读矩阵时专门找**和预测不一样的格子**,它们往往指向 embedding 的某个特性或者短板。明天 [Day 219](/blog/agent-zero/day-219-embed-limits/) 讲的两个短板(否定句、错误码),就是这么被发现的。

## 动手练习

**练习 1:在终端画一张热力图。** 不装任何画图库,用字符 ` ░▒▓█` 表示从低到高的相似度,把 6×6 矩阵画成一张字符热力图,对角线用 `··` 表示。颜色区间取 0.3 到 0.8。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_heatmap.py
from common.embed import embed

SENTENCES = [
    "年付套餐买错了能把钱要回来吗",
    "退款政策:年付套餐中途取消的,按剩余的整月数比例退款",
    "怎么申请退款",
    "发票抬头填错了怎么改",
    "导入银行流水时报错 E1042",
    "今天北京天气不错",
]
SHADES = " ░▒▓█"


def shade(x: float, lo: float = 0.3, hi: float = 0.8) -> str:
    if x >= 0.999:
        return "··"
    t = (x - lo) / (hi - lo)
    k = min(len(SHADES) - 1, max(0, int(t * len(SHADES))))
    return SHADES[k] * 2


vecs = embed(SENTENCES)
sim = vecs @ vecs.T
print("    " + "".join(f"{j:<2}" for j in range(len(SENTENCES))))
for i, row in enumerate(sim):
    print(f"[{i}] " + "".join(shade(float(x)) for x in row) + f"  {SENTENCES[i][:8]}")
```

<div class="line-notes">

- `SHADES = " ░▒▓█"` 五级,从空格(最浅)到实心块(最深)。字符串也能用下标取字符,`SHADES[4]` 是 `█`。
- `def shade(x: float, lo: float = 0.3, hi: float = 0.8) -> str:` 把一个分数变成两个字符。`lo`、`hi` 带默认值,相当于 JS 的 `function shade(x, lo = 0.3, hi = 0.8)`。
- `if x >= 0.999:` 对角线是 1,但 `float32` 可能算出 0.99999994,所以不用 `== 1`。
- `t = (x - lo) / (hi - lo)` 把 0.3–0.8 映射到 0–1。0.74 得 0.88,0.37 得 0.14。
- `k = min(len(SHADES) - 1, max(0, int(t * len(SHADES))))` 再映射到 0–4 的整数下标,`max`、`min` 把越界的值夹回来。0.88 × 5 = 4.4,取整 4,是 `█`;0.14 × 5 = 0.7,取整 0,是空格。
- `return SHADES[k] * 2` 每格两个字符,看起来接近正方形。字符串乘整数是重复。
- `"".join(f"{j:<2}" for j in range(len(SENTENCES)))` 表头 `0 1 2 3 4 5`,每个编号占 2 格。
- `for i, row in enumerate(sim):` 遍历二维数组,每次拿到一行。
- `"".join(shade(float(x)) for x in row)` 这一行的 6 格拼起来。

</div>

```bash
uv run python -m part04.ex_heatmap
```

真实输出:

```text
    0 1 2 3 4 5 
[0] ··██▓▓▓▓▒▒    年付套餐买错了能
[1] ██··▓▓▒▒░░    退款政策:年付套
[2] ▓▓▓▓··▒▒▒▒░░  怎么申请退款
[3] ▓▓▒▒▒▒··▒▒    发票抬头填错了怎
[4] ▒▒░░▒▒▒▒··    导入银行流水时报
[5]     ░░    ··  今天北京天气不错
```

左上角那块最深,最后一行和最后一列几乎是空的。用字符画矩阵在服务器上排查问题时很实用,不用装 matplotlib,也不用开图形界面。

</details>

**练习 2:加三句登录问题,找出新的「块」。** 在六句后面加上「忘记密码怎么办」「登不上去了气死」「账号被锁了怎么解锁」,算 9×9 矩阵,每行找最像的另一句。登录三句会不会自成一块?有没有哪句跑去和别的话题抱团?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_sim9.py
import numpy as np

from common.embed import embed

SENTENCES = [
    "年付套餐买错了能把钱要回来吗",
    "退款政策:年付套餐中途取消的,按剩余的整月数比例退款",
    "怎么申请退款",
    "发票抬头填错了怎么改",
    "导入银行流水时报错 E1042",
    "今天北京天气不错",
    "忘记密码怎么办",
    "登不上去了气死",
    "账号被锁了怎么解锁",
]

vecs = embed(SENTENCES)
sim = vecs @ vecs.T
np.set_printoptions(precision=2, suppress=True)
print(sim)
for i, s in enumerate(SENTENCES):
    order = np.argsort(-sim[i])
    j = next(k for k in order if k != i)
    print(f"[{i}] 最像 [{j}] ({sim[i, j]:.2f})  {s[:10]}")
```

<div class="line-notes">

- `"忘记密码怎么办",` 新加的三句编号 6、7、8。9 条还在批大小 10 以内,一次请求。
- `sim = vecs @ vecs.T` `(9, 1024) @ (1024, 9)` 得 `(9, 9)`。
- `for i, s in enumerate(SENTENCES):` 和 `sim_read.py` 一样的「每行找最像」循环。

</div>

```bash
uv run python -m part04.ex_sim9
```

真实输出:

```text
[[1.   0.74 0.69 0.63 0.52 0.37 0.58 0.52 0.53]
 [0.74 1.   0.69 0.51 0.43 0.39 0.5  0.42 0.46]
 [0.69 0.69 1.   0.59 0.53 0.41 0.65 0.54 0.62]
 [0.63 0.51 0.59 1.   0.55 0.39 0.53 0.55 0.51]
 [0.52 0.43 0.53 0.55 1.   0.33 0.51 0.52 0.52]
 [0.37 0.39 0.41 0.39 0.33 1.   0.43 0.44 0.43]
 [0.58 0.5  0.65 0.53 0.51 0.43 1.   0.63 0.78]
 [0.52 0.42 0.54 0.55 0.52 0.44 0.63 1.   0.61]
 [0.53 0.46 0.62 0.51 0.52 0.43 0.78 0.61 1.  ]]
[0] 最像 [1] (0.74)  年付套餐买错了能把钱
[1] 最像 [0] (0.74)  退款政策:年付套餐中
[2] 最像 [0] (0.69)  怎么申请退款
[3] 最像 [0] (0.63)  发票抬头填错了怎么改
[4] 最像 [3] (0.55)  导入银行流水时报错 
[5] 最像 [7] (0.44)  今天北京天气不错
[6] 最像 [8] (0.78)  忘记密码怎么办
[7] 最像 [6] (0.63)  登不上去了气死
[8] 最像 [6] (0.78)  账号被锁了怎么解锁
```

左上 6×6 和前面基本一样(第三位小数的差别是抖动)。右下角 6、7、8 自成一块:6 ↔ 8 是 0.78,比退款那块的最高分还高;登录三句每句最像的都是另一句登录。

两个值得注意的格子。第一,「怎么申请退款」和「忘记密码怎么办」是 0.65,比它和退款原文以外的大多数句子都高,原因和那个 0.63 一样:都是「怎么……」开头的短问句,句式像。第二,天气句最像的换成了「登不上去了气死」(0.44),大概是因为两句都是口语化的情绪表达。两个结论都是推测,模型不会告诉你它为什么这么打分,但「句式和语气也会算进相似度」这一点,在这张表里出现了两次。

</details>

**练习 3:换一个模型,阈值还灵吗?** 不改代码,用命令行把 `EMB_MODEL` 临时换成 `BAAI/bge-large-zh-v1.5`,重跑 `sim_pairs.py`。比较两个模型的分数区间和「大于 0.6」选出来的对数。

<details><summary>参考答案</summary>

Day 217 练习 2 用过同一招:命令行设的环境变量优先于 `.env`。

```bash
EMB_MODEL=BAAI/bge-large-zh-v1.5 uv run python -m part04.sim_pairs
```

真实输出:

```text
一共 15 对
  0.7212  [0]-[1]
  0.5678  [1]-[2]
  0.4900  [0]-[2]
  0.4734  [0]-[3]
  0.4636  [3]-[4]
  0.4419  [0]-[4]
  0.3962  [1]-[3]
  0.3924  [2]-[4]
  0.3907  [1]-[4]
  0.3770  [2]-[3]
  0.2623  [1]-[5]
  0.2331  [0]-[5]
  0.2160  [3]-[5]
  0.2009  [2]-[5]
  0.1530  [4]-[5]
非对角线:最小 0.1530  最大 0.7212  平均 0.3853
大于 0.6 的有: [(0, 1)]
```

两个模型并排比:

| | bge-m3 | bge-large-zh-v1.5 |
| --- | --- | --- |
| 最高分 0-1 | 0.7442 | 0.7212 |
| 平均 | 0.5182 | 0.3853 |
| 天气句区间 | 0.33–0.41 | 0.15–0.26 |
| 大于 0.6 的对数 | 4 | 1 |

bge-large-zh 整体分数低了一截,区间也拉得更开,天气句跌到 0.2 左右。同样的 0.6 阈值,在 bge-m3 上放进来四对(含一对误判),在 bge-large-zh 上只剩一对,连「怎么申请退款」和退款原文(0.5678)都被挡在外面。

但排序层面,两个模型高度一致:最像的都是 0-1,天气句的五对都垫底。分数换个模型就变,排序基本不变,这张表就是「看排序,别看阈值」最直接的证据。Day 217 讲过这两个模型的向量不能混用,这里两个模型各算各的,所以没问题。

</details>

**练习 4:只算矩阵的一行。** 真实检索不需要整张矩阵。准备四篇帮助文章,用 `embed` 编码,再用 `embed_one` 编码问题「钱能退吗」,算一行分数并从高到低打印。说出这和相似度矩阵是什么关系。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_query_row.py
import numpy as np

from common.embed import embed, embed_one

DOCS = [
    "退款政策:年付套餐中途取消的,按剩余的整月数比例退款",
    "开发票指南:在账单页点「申请发票」,抬头填错可以作废重开",
    "重置密码:在登录页点「忘记密码」,邮件 10 分钟内送达",
    "导入银行流水:支持 CSV,编码必须是 UTF-8",
]

doc_vecs = embed(DOCS)
q = embed_one("钱能退吗")
scores = doc_vecs @ q
print("doc_vecs.shape:", doc_vecs.shape, " q.shape:", q.shape, " scores.shape:", scores.shape)
for i in np.argsort(-scores):
    print(f"  {scores[i]:.4f}  {DOCS[i][:12]}")
```

<div class="line-notes">

- `doc_vecs = embed(DOCS)` 四篇文档,`(4, 1024)`。这一步相当于「建索引」。
- `q = embed_one("钱能退吗")` 问题,`(1024,)`。
- `scores = doc_vecs @ q` `(4, 1024) @ (1024,)` 得 `(4,)`:每篇文档和问题的点积,也就是余弦。这和 `sim = vecs @ vecs.T` 的区别只是右边从「所有向量」换成了「一个向量」。
- `for i in np.argsort(-scores):` 从高到低遍历下标。

</div>

```bash
uv run python -m part04.ex_query_row
```

真实输出:

```text
doc_vecs.shape: (4, 1024)  q.shape: (1024,)  scores.shape: (4,)
  0.7134  退款政策:年付套餐中途取
  0.5670  开发票指南:在账单页点「
  0.5297  重置密码:在登录页点「忘
  0.5019  导入银行流水:支持 CS
```

「钱能退吗」四个字,和《退款政策》0.7134,第一名和第二名差 0.15,很清楚。关系是:如果把问题也加进 `DOCS` 一起算相似度矩阵,问题那一行去掉对角线,就是这里的 `scores`。检索只需要这一行,所以只算一次 `(N, 1024) @ (1024,)`,而不是 `(N, N)` 的整张表。文档有 1 万篇时,整张表是 1 亿个数,一行只有 1 万个。Day 226 的 `rag_numpy.py` 用的就是这一行。

</details>

**验收标准:** 能不看文章写出 `vecs @ vecs.T` 并说出 `(6, 1024) @ (1024, 6)` 的形状规则;拿到任何一张相似度矩阵,先检查对角线和对称;能用 `argsort` 写出「每行找最像的另一句」;能用练习 3 那张对比表说明为什么固定阈值不可靠。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 相似度矩阵 | 一组向量两两之间的相似度排成的方阵,第 i 行第 j 列是第 i 个和第 j 个的余弦。Day 215 练习 3 首次出现 |
| 对角线 | 第 i 行第 i 列那一串格子,相似度矩阵里全是 1 |
| 对称矩阵 | 第 i 行第 j 列等于第 j 行第 i 列,沿对角线折叠能重合 |
| 矩阵乘法的形状规则 | `(a, b) @ (b, c)` 得 `(a, c)`,中间的 b 必须相等 |
| `np.diag` | 取出方阵的对角线 |
| `sim[:, j]` | 取第 j 列;`:` 表示「所有行」 |
| `np.argsort` | 返回排序后各位置原来的下标;取负号再排就是从大到小。Day 215 首次出现 |
| `np.set_printoptions` | 只改 numpy 的打印格式,不改数据 |
| 非对角线(off-diagonal) | 矩阵里除对角线以外的格子,真正有信息的部分 |
| 热力图(heatmap) | 用颜色深浅表示数值大小的矩阵图 |
| 阈值(threshold) | 「分数大于多少算相关」的那条线,换模型、换数据就要重调 |

## 常见误区

**拿到矩阵直接找规律,不先体检。** 对角线不是 1,说明向量没归一化;不对称,说明两边不是同一组向量。这两样先查,后面的读数才可信。

**以为余弦 0.3 就是「不相关」的意思。** bge-m3 上一句天气和客服问题也有 0.33,整张表没有一对低于 0.3。真实句向量的余弦挤在一个窄的正数区间里,每个模型的区间还不一样。

**用一组小数据调出阈值就上线。** 在六句话上 0.65 刚好能把误判挡掉,换一个模型,同样的话最高分都到不了 0.65 以上的就只剩一对。阈值要在足够多的标注数据上、针对具体模型去定,而且换模型必须重定。

**以为 embedding 只看话题。** 「买错了」和「填错了」、「怎么申请退款」和「忘记密码怎么办」都因为句式相近拿到了偏高的分数。语气、句式、意图都会算进相似度。

**两次运行的小数对不上就以为代码错了。** `0.7434` 和 `0.7442` 的差别来自服务端的浮点抖动(Day 217),排序结论不变。比较时看前两位、看排序,别盯着第四位。

**用 `sim[0][3]` 的写法遍历大矩阵。** 结果一样,但 numpy 的惯用写法是 `sim[0, 3]`,取整行整列用 `sim[0]`、`sim[:, 3]`。读别人的 numpy 代码时,`[:, j]` 出现的频率非常高,要一眼认出来。

## 学习资料

### 文档与文章

- [numpy.argsort](https://numpy.org/doc/stable/reference/generated/numpy.argsort.html):今天用它排每一行。看 Examples 里二维数组按 `axis` 排序的例子,练习 2 之后可以试试 `np.argsort(-sim, axis=1)` 一次排完所有行。
- [numpy.diag](https://numpy.org/doc/stable/reference/generated/numpy.diag.html):取对角线,也能反过来用一串数造一个对角矩阵,今天只用前者。
- [numpy.set_printoptions](https://numpy.org/doc/stable/reference/generated/numpy.set_printoptions.html):`precision`、`suppress` 两个参数,打印大矩阵时还会用到 `linewidth`。
- [维基百科 · 矩阵(中文)](https://zh.wikipedia.org/wiki/%E7%9F%A9%E9%98%B5):看「矩阵乘法」一节的定义和示意图,对照今天的形状规则。
- [Sentence Transformers 文档](https://www.sbert.net/):Python 里最常用的句向量库,首页的「Semantic Textual Similarity」示例做的就是今天这张矩阵,只是模型跑在本地。今天只看示例,不用装。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1tgSdBoEsL&autoplay=0&high_quality=1" title="【硬核】Embedding:AI 如何把万物变成向量" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>过拟合青年 · 【硬核】Embedding:AI 如何把万物变成向量 · 12 分钟。讲 embedding 背后的直觉,看完再回来看今天那张矩阵,会更理解为什么句式和语气也被编进了向量。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Sr826dExM&autoplay=0&high_quality=1" title="【RAG 必修】余弦相似度的维度灾难:为什么检索结果全挤在 0.9 附近" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>古希腊掌管代码的神 · 【RAG 必修】余弦相似度的维度灾难:为什么检索结果全挤在 0.9 附近 · 3 分钟。Day 215 推荐过,今天跑完矩阵正是回来看的时候。我们的数据挤在 0.33–0.74,不是 0.9,具体区间因模型而异,但「挤在一起」的现象是同一回事。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/sNa_uiqSlJo" title="Text Embeddings, Classification, and Semantic Search (w/ Python Code)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Shaw Talebi · Text Embeddings, Classification, and Semantic Search (w/ Python Code) · 英文。用 Python 演示 embedding 之后能做的几件事,语义搜索那段和今天练习 4 是同一个思路。</figcaption>
</figure>

### 书籍

- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly,2024),中文版《图解大模型:生成式AI原理与实践》(人民邮电出版社,2025)。第 8 章讲语义搜索,配套代码仓库在 [HandsOnLLM/Hands-On-Large-Language-Models](https://github.com/HandsOnLLM/Hands-On-Large-Language-Models),第 8 章的 notebook 可以对照着跑。
- 平冈和幸、堀玄《程序员的数学 3:线性代数》(卢晓南译,人民邮电出版社,2016)。讲矩阵乘法的那一章,对照今天的形状规则读。

### 开源项目与代码

- [FlagOpen/FlagEmbedding](https://github.com/FlagOpen/FlagEmbedding):bge 系列官方仓库,README 的用法示例里有一行 `embeddings_1 @ embeddings_2.T`,和今天的 `vecs @ vecs.T` 是同一件事。
- [matplotlib · 带标注的热力图示例](https://matplotlib.org/stable/gallery/images_contours_and_fields/image_annotated_heatmap.html):以后想把矩阵画成真正的图片,照这个示例改。今天用字符画就够了。

## 自测

**1. `vecs` 的形状是 `(9, 1024)`,`vecs @ vecs.T` 和 `vecs.T @ vecs` 的形状分别是什么?哪个是相似度矩阵?**

<details><summary>答案</summary>

`vecs @ vecs.T` 是 `(9, 1024) @ (1024, 9)`,得 `(9, 9)`,是 9 句话两两之间的相似度矩阵。`vecs.T @ vecs` 是 `(1024, 9) @ (9, 1024)`,得 `(1024, 1024)`,是维度和维度之间的关系,和今天的问题无关,而且大得多。

</details>

**2. 一张相似度矩阵的对角线是 `[1.0, 0.98, 1.0, 1.02, 1.0]`,可能是什么问题?**

<details><summary>答案</summary>

向量没有归一化,或者归一化只做了一部分。归一化后的向量和自己的点积必定是 1(最多有 `float32` 的极小误差,比如 0.99999994)。0.98、1.02 说明有些向量长度不是 1,这时候点积不等于余弦,整张表的排序都可能被长度带偏。检查 `embed` 最后那行按行归一化有没有执行,或者是不是有人绕过 `embed` 直接用了接口返回的原始向量。

</details>

**3. 为什么 `sim_pairs.py` 里内层循环写 `range(i + 1, n)` 而不是 `range(n)`?**

<details><summary>答案</summary>

相似度矩阵是对称的,`[i, j]` 和 `[j, i]` 是同一对,对角线又是自己和自己。从 `i + 1` 开始只取对角线右上方的那一半,每对只出现一次,6 句话得到 15 对。写成 `range(n)` 会得到 36 个,每对重复两次,还多了 6 个 1.0。

</details>

**4. 在 bge-m3 上,「年付套餐买错了能把钱要回来吗」和「发票抬头填错了怎么改」的余弦是 0.63,比它和错误码那句(0.52)高。你怎么解释?这对检索有什么影响?**

<details><summary>答案</summary>

两句话题不同,但句式和口吻几乎一样,都是「客户弄错了东西想补救」。embedding 把语气、句式、意图也编进了向量,所以它们被拉近了。对检索的影响是:问退款时,讲发票修改的文章可能排得比预期靠前,如果 top-k 取得大一点,它会混进给模型的资料里。应对办法不是调阈值,而是后面会学的 rerank(Day 238)和混合检索(Day 235–236),以及用检索评测集量出这类误召回到底有多少。

</details>

**5. 面试题:「你们的 RAG 系统设了相似度 > 0.75 才召回。业务方抱怨很多明明有答案的问题都回答『没找到』。你会怎么排查和改?」**

<details><summary>答案</summary>

先用数据确认原因,不要直接改数字。拿一批答案明确在知识库里的问题,把每个问题和它的正确文章的余弦算出来,看分布:如果大量落在 0.6 到 0.75 之间,就是阈值相对于这个 embedding 模型太高了。我在 bge-m3 上实测,一句口语化的退款问题和退款原文只有 0.74,换成 bge-large-zh 是 0.72,两个都过不了 0.75;同一组句子,两个模型的平均分差了 0.13。也要问一句最近是不是换过 embedding 模型,换模型而阈值没重调是这类问题最常见的起因。

改法:召回以 top-k 为主,先保证正确文章能进前几名;阈值只用来过滤明显无关的结果,用标注数据画出「相关」和「不相关」两组分数的分布,在两组之间选线,并记录这条线对应的模型。再往后,在 top-k 之后加 rerank,用 rerank 的分数而不是 embedding 余弦来决定「到底有没有答案」,rerank 模型的分数更适合做这种判断。

</details>

## 明天预告

明天是 [Day 219 · embedding 的两个短板:否定句和错误码](/blog/agent-zero/day-219-embed-limits/)。今天你看到 embedding 会把「买错了」和「填错了」拉近,明天看两个更麻烦的反例:「企业版支持按比例退款」和「企业版不支持按比例退款」意思相反,分数却高得吓人;客户问 E1042,向量检索却把 E1043 的文章排第一。两个反例都用今天这套读矩阵的方法去看,它们会告诉你为什么后面要学关键词检索和混合检索。
