---
title: 'Day 215 · 余弦相似度:手算一遍'
description: '向量检索里最常用的相似度。先在纸上用点积除以两个长度手算一遍,再用纯 Python 和 numpy 各验算一次;解决 Day 213 留下的「长文章反而离得远」问题,学会把向量长度统一成 1 的归一化,并踩一次零向量的坑。'
pubDate: 2026-10-22
regime: none
tags: ['cosine-similarity', 'numpy', 'rag', 'agent-zero']
series: 'agent-zero'
day: 215
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 214](/blog/agent-zero/day-214-numpy-basics/) 我们装了 numpy,认识了 ndarray 和向量化运算,还备好了两个零件:点积 `a @ b`(逐位相乘再求和)和范数 `np.linalg.norm(a)`(向量的长度)。那天算出来 `(1, 2, 2)` 和 `(2, 1, 2)` 的点积是 8,两者的长度都是 3。

再往前一天,[Day 213](/blog/agent-zero/day-213-vectors-2d/) 的 `length_problem.py` 留了一个问题:一篇讲退款的长文章 `(1.8, 0.2)` 和一句讲退款的短问题 `(0.9, 0.1)` 方向完全一样,欧氏距离却比一个发票向量还远。今天把这两条线接上:用点积和长度算出**余弦相似度**,它只看方向、不看长度,正好治这个毛病。

## 今天要解决的问题

学完今天,你应该能做到:

1. 不用电脑,手算两个三维向量的余弦相似度,并说出结果在 -1 到 1 之间各代表什么(同向、垂直、反向)。
2. 用纯 Python 和 numpy 各写一个 `cosine` 函数,结果和手算对上;证明把向量放大 10 倍余弦不变。
3. 会**归一化**:把向量除以自己的长度,让长度变成 1。能说出为什么归一化之后余弦就等于点积,以及为什么向量库里存的大都是归一化后的向量。
4. 知道零向量会让余弦变成 `nan`,而 `nan` 会让 `argmax` 选错结果;会写一个遇到零向量就报错的安全版本。

预计用时 2.5 小时:手算和读视频 50 分钟,剩下写脚本和练习。前置:[Day 213](/blog/agent-zero/day-213-vectors-2d/) 向量和距离、[Day 214](/blog/agent-zero/day-214-numpy-basics/) numpy、点积和范数。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,在纸上手算 `cos(a, b)`,再默写 `cos_table.py`;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 余弦相似度:看两根箭头的夹角

Day 213 说过向量有两种画法,点和箭头。算距离时我们把它当点,今天把它当箭头。

两根从原点出发的箭头之间有一个夹角。夹角越小,两根箭头指的方向越接近,意思也就越像。直接比角度不方便,我们比夹角的**余弦**(cosine)。余弦是高中三角函数里的那个 cos,你只需要记住三个值:

- 夹角 0 度,两根箭头同向,cos 是 **1**
- 夹角 90 度,互相垂直,cos 是 **0**
- 夹角 180 度,方向完全相反,cos 是 **-1**

中间的角度落在中间的值:角度越小,余弦越接近 1。所以**余弦相似度**(cosine similarity)越大越像,范围是 -1 到 1。和距离正好反过来,距离是越小越像。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="余弦相似度与夹角的关系:同向为1,垂直为0,反向为-1">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="30" y="30" fill="var(--ink-soft)">只看两根箭头的夹角,不看箭头多长</text>
<line x1="60" y1="170" x2="170" y2="110" stroke="var(--mem)" stroke-width="2.5"/>
<line x1="60" y1="170" x2="190" y2="135" stroke="var(--mem)" stroke-width="2.5"/>
<text x="60" y="205" fill="var(--ink)">夹角约 27°</text>
<text x="60" y="222" fill="var(--mem)">cos(a, b) = 8/9 ≈ 0.889</text>
<line x1="290" y1="170" x2="400" y2="170" stroke="var(--mem)" stroke-width="2.5"/>
<line x1="290" y1="170" x2="290" y2="60" stroke="var(--compute)" stroke-width="2.5"/>
<rect x="290" y="158" width="12" height="12" fill="none" stroke="var(--ink-faint)"/>
<text x="290" y="205" fill="var(--ink)">垂直 90°</text>
<text x="290" y="222" fill="var(--ink-soft)">cos(a, c) = 0</text>
<line x1="530" y1="130" x2="610" y2="130" stroke="var(--mem)" stroke-width="2.5"/>
<line x1="530" y1="130" x2="450" y2="130" stroke="var(--compute)" stroke-width="2.5"/>
<circle cx="530" cy="130" r="3" fill="var(--ink)"/>
<text x="460" y="205" fill="var(--ink)">反向 180°</text>
<text x="460" y="222" fill="var(--compute)">cos(a, -a) = -1</text>
</g>
</svg>
<figcaption>三种典型夹角,标的数值就是下面 cos_hand.py 真实跑出来的。左边那两根就是今天手算的 a 和 b。</figcaption>
</figure>

可是 1024 维的空间里,夹角没法用量角器量。好在有一个公式,只要会点积和长度就能算出余弦:

```text
cos(a, b) = (a · b) / (|a| × |b|)

a · b = a1×b1 + a2×b2 + ... + an×bn     点积:对应位置相乘再加起来
|a|   = √(a1² + a2² + ... + an²)         长度:平方和开根号
```

分子是 Day 214 的点积,分母是两个长度相乘。这个公式为什么成立属于线性代数的内容,今天不推导,下面的「学习资料」里 3Blue1Brown 讲点积那一集有很好的几何解释。我们的做法是:先信它,手算几个例子,用代码验证它确实给出了 1、0、-1 这些该有的值。

## 先在纸上算一遍

拿出纸笔,三个三维向量:

```text
a = (1, 2, 2)
b = (2, 1, 2)
c = (-2, 1, 0)
```

**算 cos(a, b)。**

- 点积:1×2 + 2×1 + 2×2 = 2 + 2 + 4 = 8
- |a| = √(1 + 4 + 4) = √9 = 3
- |b| = √(4 + 1 + 4) = √9 = 3
- cos(a, b) = 8 / (3 × 3) = 8/9 ≈ 0.889

这三步里前两个数昨天已经用 numpy 算过,今天只多了最后一步除法。0.889 很接近 1,说明 a 和 b 方向很近。如果你好奇角度,反余弦算出来约 27 度。

**算 cos(a, c)。**

- 点积:1×(-2) + 2×1 + 2×0 = -2 + 2 + 0 = 0

分子是 0,不管分母是多少,结果都是 0。两个向量互相垂直,意思上「毫不相干」。

**把 a 放大 10 倍,变成 `(10, 20, 20)`,它和 b 的余弦变不变?**

- 点积:10×2 + 20×1 + 20×2 = 80
- |10a| = √(100 + 400 + 400) = √900 = 30
- cos = 80 / (30 × 3) = 80/90 = 8/9

还是 0.889。点积放大了 10 倍,分母里 |a| 也放大了 10 倍,一约就抵消了。**余弦只看方向,不看长度**,这就是它适合做文本检索的原因:一段长文和一句短问题,只要讲的是同一件事,方向就接近,长度不应该影响判断。

## 用纯 Python 验算

先不用 numpy,用 Day 213 学过的元组和 `zip`,把公式原样写一遍。这样你能确信 numpy 一行代码背后没有魔法。

新建 `part04/cos_hand.py`(在 `agent-zero-lab` 根目录下,和前两天的脚本放一起):

```python
# agent-zero-lab/part04/cos_hand.py
import math

Vec = tuple[float, ...]


def dot(u: Vec, v: Vec) -> float:
    return sum(x * y for x, y in zip(u, v, strict=True))


def length(u: Vec) -> float:
    return math.sqrt(dot(u, u))


def cosine(u: Vec, v: Vec) -> float:
    return dot(u, v) / (length(u) * length(v))


a = (1.0, 2.0, 2.0)
b = (2.0, 1.0, 2.0)
c = (-2.0, 1.0, 0.0)
big_a = (10.0, 20.0, 20.0)

print("a·b =", dot(a, b), " |a| =", length(a), " |b| =", length(b))
print("cos(a, b) =", cosine(a, b))
print("cos(a, c) =", cosine(a, c))
print("cos(10a, b) =", cosine(big_a, b))
print("cos(a, a) =", cosine(a, a))
print("cos(a, -a) =", cosine(a, (-1.0, -2.0, -2.0)))
```

<div class="line-notes">

- `Vec = tuple[float, ...]` 类型别名,Day 213 练习 4 用过,相当于 TS 的 `type Vec = number[]`。
- `def dot(u: Vec, v: Vec) -> float:` 点积。
- `return sum(x * y for x, y in zip(u, v, strict=True))` `zip` 把两个向量按位配对,每对相乘,`sum` 全加起来。括号里那个不带方括号的推导式叫生成器表达式([Day 99](/blog/agent-zero/day-099-generators/)),和列表推导式一样,只是不先建出一个列表。a 和 b 代进去是 2 + 2 + 4 = 8.0。`strict=True` 照旧,维度不同就报错。
- `def length(u: Vec) -> float:` 长度。
- `return math.sqrt(dot(u, u))` 自己和自己点积再开根号,这是 Day 214 的推论:长度 = √(a · a)。a 是 √9 = 3.0。
- `def cosine(u: Vec, v: Vec) -> float:` 余弦相似度。
- `return dot(u, v) / (length(u) * length(v))` 公式原样翻译:点积除以两个长度的乘积。a 和 b 是 8.0 / (3.0 × 3.0)。
- `c = (-2.0, 1.0, 0.0)` 和 a 垂直的那个向量。
- `big_a = (10.0, 20.0, 20.0)` a 放大 10 倍。
- `print("a·b ="` 先把三个零件打出来,和手算对账:8.0、3.0、3.0。
- `cosine(a, b)` 应为 8/9。
- `cosine(a, c)` 应为 0。
- `cosine(big_a, b)` 放大 10 倍后,应该还是 8/9。
- `cosine(a, a)` 自己和自己,夹角 0 度,应为 1。
- `cosine(a, (-1.0, -2.0, -2.0))` a 的反方向,夹角 180 度,应为 -1。

</div>

```bash
cd agent-zero-lab
uv run python part04/cos_hand.py
```

真实输出:

```text
a·b = 8.0  |a| = 3.0  |b| = 3.0
cos(a, b) = 0.8888888888888888
cos(a, c) = 0.0
cos(10a, b) = 0.8888888888888888
cos(a, a) = 1.0
cos(a, -a) = -1.0
```

五个结果都和预期一致。`0.8888888888888888` 就是 8/9,小数点后的 8 多到放不下,最后一位是浮点数的舍入。放大 10 倍后余弦一个数字都没变。

## 用 numpy 写,顺手解决 Day 213 的遗留问题

换成 numpy,`cosine` 只剩一行。我们直接拿它去算 Day 213 那三个让距离栽跟头的向量。

新建 `part04/cos_numpy.py`:

```python
# agent-zero-lab/part04/cos_numpy.py
import numpy as np


def cosine(u: np.ndarray, v: np.ndarray) -> float:
    return float(u @ v / (np.linalg.norm(u) * np.linalg.norm(v)))


refund_short = np.array([0.9, 0.1])
refund_long = np.array([1.8, 0.2])
invoice = np.array([0.5, 0.6])

print("距离 短退款-长退款:", round(float(np.linalg.norm(refund_short - refund_long)), 4))
print("距离 短退款-发票:  ", round(float(np.linalg.norm(refund_short - invoice)), 4))
print("余弦 短退款-长退款:", round(cosine(refund_short, refund_long), 4))
print("余弦 短退款-发票:  ", round(cosine(refund_short, invoice), 4))

angle = np.degrees(np.arccos(cosine(refund_short, invoice)))
print("短退款和发票的夹角:", round(float(angle), 1), "度")
```

<div class="line-notes">

- `def cosine(u: np.ndarray, v: np.ndarray) -> float:` numpy 版。
- `return float(u @ v / (np.linalg.norm(u) * np.linalg.norm(v)))` `u @ v` 是点积,两个 `norm` 是长度,和纯 Python 版的公式一模一样。外面套 `float()` 把 `np.float64` 转成普通小数(Day 214 讲过打印和 JSON 的坑)。
- `refund_short = np.array([0.9, 0.1])` Day 213 那句短的退款问题,横轴「钱」、纵轴「发票」。
- `refund_long = np.array([1.8, 0.2])` 讲同一件事的长文章,每一维都是两倍。
- `invoice = np.array([0.5, 0.6])` 偏发票的向量。
- `np.linalg.norm(refund_short - refund_long)` Day 214 学的:差向量的长度就是欧氏距离。先把 Day 213 的两个距离重算一遍,作为对照。
- `cosine(refund_short, refund_long)` 方向完全相同,应为 1。
- `cosine(refund_short, invoice)` 手算一下:点积 0.9×0.5 + 0.1×0.6 = 0.51;|短退款| = √0.82 ≈ 0.9055;|发票| = √0.61 ≈ 0.7810;0.51 / (0.9055 × 0.7810) ≈ 0.7211。
- `angle = np.degrees(np.arccos(` `np.arccos` 是反余弦,把余弦值变回角度,单位是弧度;`np.degrees` 再把弧度换成度。这两个函数只是为了让你看到角度,平时做检索用不到。

</div>

```bash
uv run python part04/cos_numpy.py
```

真实输出:

```text
距离 短退款-长退款: 0.9055
距离 短退款-发票:   0.6403
余弦 短退款-长退款: 1.0
余弦 短退款-发票:   0.7211
短退款和发票的夹角: 43.9 度
```

前两行是 Day 213 的老问题:按距离,发票(0.6403)比长退款文章(0.9055)更近。后两行换成余弦,长退款文章是 1.0(完全同向),发票只有 0.7211(夹角 44 度)。排序终于对了,问题解决。

## 归一化:先把所有箭头剪成一样长

余弦公式每算一次都要除以两个长度。检索的时候,一个问题要和几千段文档各算一次,每段文档的长度都要重新算一遍,有点浪费。能不能提前处理一下,让分母消失?

办法是**归一化**(normalize):把向量的每一位都除以它自己的长度。除完以后,向量方向不变,长度变成 1。这样的向量叫**单位向量**。如果两个向量都是单位向量,分母就是 1 × 1 = 1,余弦相似度就等于点积。

打个比方:每根箭头原来长短不一,归一化就是把它们全剪成 1 米长,只留方向。比方向的时候,直接看两根一米长的箭头头碰头的程度(点积)就够了。

<figure>
<svg viewBox="0 0 640 240" role="img" aria-label="归一化:把不同长度但同方向的向量除以各自长度,都变成长度为1的单位向量">
<rect x="0" y="0" width="640" height="240" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink)">归一化前</text>
<line x1="40" y1="200" x2="100" y2="80" stroke="var(--compute)" stroke-width="2"/>
<line x1="40" y1="200" x2="160" y2="40" stroke="var(--mem)" stroke-width="2"/>
<text x="104" y="80" fill="var(--compute)">a = (1, 2, 2)  长 3</text>
<text x="164" y="44" fill="var(--mem)">10a = (10, 20, 20)  长 30</text>
<text x="40" y="225" fill="var(--ink-soft)">方向一样,长短不同</text>
<text x="320" y="130" fill="var(--ink)">÷ 自己的长度 →</text>
<text x="430" y="28" fill="var(--ink)">归一化后</text>
<circle cx="470" cy="200" r="80" fill="none" stroke="var(--rule)" stroke-dasharray="3 3"/>
<line x1="470" y1="200" x2="518" y2="136" stroke="var(--mem)" stroke-width="3"/>
<text x="524" y="134" fill="var(--mem)">(0.333, 0.667, 0.667)</text>
<text x="400" y="225" fill="var(--ink-soft)">两个都变成同一根长度 1 的箭头</text>
</g>
</svg>
<figcaption>虚线圆的半径是 1,所有单位向量的箭头尖都落在它上面(高维里是一个「球面」)。a 和 10a 归一化以后完全重合,下面 normalize.py 会验证这一点。</figcaption>
</figure>

新建 `part04/normalize.py`:

```python
# agent-zero-lab/part04/normalize.py
import numpy as np

a = np.array([1.0, 2.0, 2.0])
b = np.array([2.0, 1.0, 2.0])
big_a = np.array([10.0, 20.0, 20.0])

a_unit = a / np.linalg.norm(a)
b_unit = b / np.linalg.norm(b)
big_unit = big_a / np.linalg.norm(big_a)

print("a 归一化后:", a_unit)
print("长度:", np.linalg.norm(a_unit))
print("10a 归一化后:", big_unit)
print("和 a_unit 一样吗?", np.allclose(a_unit, big_unit))

print("归一化后的点积:", a_unit @ b_unit)
print("原始余弦 8/9:  ", 8 / 9)

d = np.linalg.norm(a_unit - b_unit)
print("单位向量之间的距离:", d)
print("用 sqrt(2 - 2cos) 算:", np.sqrt(2 - 2 * (a_unit @ b_unit)))
```

<div class="line-notes">

- `a_unit = a / np.linalg.norm(a)` 归一化就这一行:向量除以自己的长度。a 的长度是 3,`[1, 2, 2] / 3` 得 `[0.333, 0.667, 0.667]`。数组除以一个数是 Day 214 的向量化运算,每一位都除。
- `b_unit = b / np.linalg.norm(b)` b 的长度也是 3,得 `[0.667, 0.333, 0.667]`。
- `big_unit = big_a / np.linalg.norm(big_a)` 10a 的长度是 30,`[10, 20, 20] / 30` 得到的也是 `[0.333, 0.667, 0.667]`。
- `np.linalg.norm(a_unit)` 归一化后的长度,应为 1。
- `np.allclose(a_unit, big_unit)` 判断两个数组是不是「几乎相等」。比较小数时不要用 `==`,Day 12 讲过 `0.1 + 0.2 != 0.3`,`allclose` 会容忍极小的误差。
- `a_unit @ b_unit` 两个单位向量的点积,应该正好等于余弦 8/9。
- `8 / 9` 直接算一个 8/9 放旁边对照。
- `d = np.linalg.norm(a_unit - b_unit)` 两个单位向量之间的欧氏距离。
- `np.sqrt(2 - 2 * (a_unit @ b_unit))` 一个关系式:对单位向量,距离² = 2 - 2 × 余弦。拿它算出来的距离应该和上一行一样。这条式子说明余弦越大,距离越小,两者的排序完全一致。

</div>

```bash
uv run python part04/normalize.py
```

真实输出:

```text
a 归一化后: [0.33333333 0.66666667 0.66666667]
长度: 1.0
10a 归一化后: [0.33333333 0.66666667 0.66666667]
和 a_unit 一样吗? True
归一化后的点积: 0.8888888888888888
原始余弦 8/9:   0.8888888888888888
单位向量之间的距离: 0.4714045207910317
用 sqrt(2 - 2cos) 算: 0.4714045207910318
```

几件事一次看清。a 和 10a 归一化后完全一样,长度信息被扔掉了,只剩方向。单位向量的点积就是余弦,不用再除。单位向量之间的欧氏距离和 `√(2 - 2cos)` 一致(最后一位的 7 和 8 是浮点误差),所以**对归一化后的向量,按余弦排序和按距离排序结果完全相同**。

那条关系式不用背。你可以把它当成「距离 = √(|a|² + |b|² - 2 a·b)」在 |a| = |b| = 1 时的特例,展开平方就能得到,有兴趣自己在纸上推一下。

这正好解释了你以后会在文档里看到的几件事:

- OpenAI 的 [Embeddings 指南](https://developers.openai.com/api/docs/guides/embeddings) FAQ 里原话是「OpenAI embeddings are normalized to length 1」,并说因此余弦可以只用点积算,余弦和欧氏距离会给出完全相同的排序。
- 向量库里存的几乎都是归一化以后的向量,检索时只算点积,省掉了分母。
- [pgvector](https://github.com/pgvector/pgvector) 提供了 `<->`(L2 距离)、`<#>`(负内积)、`<=>`(余弦距离)几个操作符。**余弦距离**就是 1 减余弦相似度,变成「越小越近」,方便数据库从小到大排序;`<#>` 返回负的内积也是同样的原因。Day 220 前后用 pgvector 时你会再见到它们。

不是所有 embedding 服务都保证返回归一化的向量。我的习惯是拿到向量后自己再归一化一次,多一行代码,换一个确定性。

## 故意踩坑:零向量

归一化要除以长度,长度是 0 会怎样?全是 0 的向量叫**零向量**,它是一个没有方向的点,和谁都谈不上夹角。真实场景里它比你想的常见:有的 embedding 服务遇到空字符串会返回全 0,有的自己写的特征打分对一段无关文字全给 0。

先看纯 Python。在终端里跑一行(用的是和 `cos_hand.py` 一样的公式,长度用 Day 213 的 `math.hypot` 算):

```bash
uv run python -c "import math; u=(1.0,2.0,2.0); v=(0.0,0.0,0.0); print(sum(x*y for x,y in zip(u,v))/(math.hypot(*u)*math.hypot(*v)))"
```

真实报错:

```text
Traceback (most recent call last):
  File "<string>", line 1, in <module>
ZeroDivisionError: float division by zero
```

Python 至少大声报错了。numpy 的表现更阴险,新建 `part04/cos_zero.py`:

```python
# agent-zero-lab/part04/cos_zero.py
import numpy as np

empty = np.array([0.0, 0.0, 0.0])
a = np.array([1.0, 2.0, 2.0])

score = a @ empty / (np.linalg.norm(a) * np.linalg.norm(empty))
print("numpy 算零向量的余弦:", score)
print("nan 和自己相等吗?", score == score)

scores = np.array([0.89, score, 0.35])
print("带 nan 的分数排序后的下标:", np.argsort(scores))
print("argmax 选出来的是:", np.argmax(scores))
```

<div class="line-notes">

- `empty = np.array([0.0, 0.0, 0.0])` 零向量,长度是 0。
- `score = a @ empty / (np.linalg.norm(a) * np.linalg.norm(empty))` 分子 0,分母 3 × 0 = 0,0 除以 0。numpy 不抛异常,只打一行 `RuntimeWarning`,然后返回 `nan`。
- `print("numpy 算零向量的余弦:", score)` 打印 `nan`,意思是 Not a Number,和 JS 的 `NaN` 是一个东西。
- `score == score` `nan` 和任何数比较都是 `False`,连和自己比也是。JS 里 `NaN === NaN` 同样是 `false`。
- `scores = np.array([0.89, score, 0.35])` 模拟检索时三篇文档的分数,中间那篇是零向量。
- `np.argsort(scores)` numpy 排序时把 `nan` 放在最后,从小到大排是 `[2 0 1]`。
- `np.argmax(scores)` 这是最要命的:`argmax` 遇到 `nan` 会把 `nan` 当成最大值,返回它的下标 1。你的检索系统会把那篇零向量文档当成「最相关」的返回给模型。

</div>

```bash
uv run python part04/cos_zero.py
```

真实输出(第一、二行是 numpy 打到终端的警告):

```text
/…/agent-zero-lab/part04/cos_zero.py:7: RuntimeWarning: invalid value encountered in scalar divide
  score = a @ empty / (np.linalg.norm(a) * np.linalg.norm(empty))
numpy 算零向量的余弦: nan
nan 和自己相等吗? False
带 nan 的分数排序后的下标: [2 0 1]
argmax 选出来的是: 1
```

警告第一行开头是脚本的完整路径,我把前面那段临时目录省略成了 `/…/`。读法:第 7 行做标量除法时遇到了无效值。它只是警告,程序照常往下跑,在服务器日志里很容易被忽略。

最后一行就是事故现场:分数 0.89 的那篇本该排第一,`argmax` 却选了 `nan` 那篇。如果你后面用 `argsort` 取 top-k 并且按从大到小取(`np.argsort(-scores)`),`nan` 的位置又会不同,行为取决于你怎么写,这是最难查的那种 bug。

修法有两层。入库前就拦住:文本为空不送去 embedding,向量长度为 0 不入库。算的时候再兜一层:归一化函数里检查长度,是 0 就明确报错。练习 2 你会写这个安全版。

## 回到 CloudLedger:余弦和距离并排比

最后把今天的东西用到 Day 213、214 的三篇帮助文章上。先把三篇文章一次全归一化,再让每个问题归一化后和整张表做点积,一行就得到三个余弦相似度。

新建 `part04/cos_table.py`:

```python
# agent-zero-lab/part04/cos_table.py
import numpy as np

titles = ["退款政策", "开发票指南", "重置密码"]
articles = np.array([
    [0.9, 0.2, 0.0, 0.1],
    [0.3, 0.9, 0.0, 0.0],
    [0.0, 0.0, 0.9, 0.1],
])
questions = {
    "买错了能把钱要回来吗": np.array([0.8, 0.1, 0.0, 0.4]),
    "登不上去了气死": np.array([0.0, 0.0, 0.8, 0.9]),
}

art_unit = articles / np.linalg.norm(articles, axis=1, keepdims=True)
print("归一化后每篇长度:", np.linalg.norm(art_unit, axis=1))

for text, q in questions.items():
    q_unit = q / np.linalg.norm(q)
    sims = art_unit @ q_unit
    dists = np.linalg.norm(articles - q, axis=1)
    print(f"问题:{text}")
    for i in np.argsort(-sims):
        print(f"  余弦 {sims[i]:.4f}  距离 {dists[i]:.4f}  {titles[i]}")
```

<div class="line-notes">

- `articles = np.array([` 和 Day 214 `np_table.py` 一样的 `(3, 4)` 表,四维是钱、发票、登录、情绪。
- `questions = {` 两个问题,值直接存成 numpy 数组。
- `art_unit = articles / np.linalg.norm(articles, axis=1, keepdims=True)` 先看右边的 `np.linalg.norm(...)`:Day 214 学过 `axis=1` 是每行算一个长度,得到 3 个数。`keepdims=True` 是新东西:让结果保持成 3 行 1 列的形状 `(3, 1)`,而不是 `(3,)`。这样下一步做除法时,numpy 才知道「第 0 行除以第 0 个长度,第 1 行除以第 1 个长度」。不加它,`(3, 4)` 除以 `(3,)` 会报 Day 214 见过的 `could not be broadcast together`。然后每一行除以自己的长度。第 0 行长度 0.9274,`[0.9, 0.2, 0.0, 0.1] / 0.9274` 约等于 `[0.9705, 0.2157, 0, 0.1078]`。
- `print("归一化后每篇长度:"` 验一下,应该三个都是 1。
- `q_unit = q / np.linalg.norm(q)` 问题也归一化。第一个问题长度是 √(0.64 + 0.01 + 0 + 0.16) = √0.81 = 0.9。
- `sims = art_unit @ q_unit` `(3, 4)` 的表 `@` 一个 `(4,)` 的向量,每行和它做点积,因为两边都是单位向量,这三个点积就是三个余弦。第 0 行手算:原始点积 0.78(Day 214 算过),除以 0.9274 × 0.9 = 0.8346,得 0.9346。
- `dists = np.linalg.norm(articles - q, axis=1)` 用**没归一化**的原始向量算欧氏距离,放在旁边对比。
- `np.argsort(-sims)` `argsort` 是从小到大排,余弦要从大到小,所以先取负号再排。相当于 JS 的 `.sort((i, j) => sims[j] - sims[i])`。
- `print(f"  余弦 {sims[i]:.4f}  距离 {dists[i]:.4f}  {titles[i]}")` 每篇一行,余弦和距离并排。

</div>

```bash
uv run python part04/cos_table.py
```

真实输出:

```text
归一化后每篇长度: [1. 1. 1.]
问题:买错了能把钱要回来吗
  余弦 0.9346  距离 0.3317  退款政策
  余弦 0.3865  距离 1.0247  开发票指南
  余弦 0.0491  距离 1.2450  重置密码
问题:登不上去了气死
  余弦 0.7428  距离 0.8062  重置密码
  余弦 0.0806  距离 1.4595  退款政策
  余弦 0.0000  距离 1.5330  开发票指南
```

两个问题的排序,余弦和距离这次是一致的,因为这几个手工向量长度都差不多(都在 0.9 左右)。区别在练习 4:把问题向量整体放大一倍(想象客户把同一句话重复说了两遍,某些按次数打分的方法会给出两倍大的数),余弦一位小数都不会变,距离却全变了。

还有一点值得看:「登不上去了气死」和《开发票指南》的余弦正好是 0。两个向量没有任何一维同时不为 0,点积是 0,也就是互相垂直。这和今天手算的 `cos(a, c) = 0` 是一回事。

最后说一个数值范围上的现实。理论上余弦在 -1 到 1 之间,但真实 embedding 模型输出的句子向量,彼此之间的余弦大多挤在一个比较窄的正数区间里,很少出现负数,所以「0.5 算不算相关」没有通用答案,换个模型阈值就得重调。这一点今天的手工向量体现不出来,[Day 218](/blog/agent-zero/day-218-sim-matrix/) 用真实的 bge-m3 向量做相似度矩阵时,你会看到自己的数据落在哪个区间。在那之前先记住结论:**看排序,别看绝对阈值**。

## 动手练习

**练习 1:手算(不许用电脑)。** `p = (3, 0, 4)`,`q = (0, 5, 0)`,`r = (6, 0, 8)`,`s = (-3, 0, -4)`。算 cos(p, q)、cos(p, r)、cos(p, s),再算 p 和 r 的欧氏距离。说说 r、s 和 p 各是什么关系。算完写个脚本验算。

<details><summary>参考答案</summary>

手算:

- p·q = 0 + 0 + 0 = 0,所以 cos(p, q) = 0,互相垂直。
- p·r = 18 + 0 + 32 = 50,|p| = √25 = 5,|r| = √100 = 10,cos = 50 / 50 = 1。r 是 p 放大两倍,方向相同。
- p·s = -9 + 0 - 16 = -25,|s| = 5,cos = -25 / 25 = -1。s 是 p 的反方向。
- p 和 r 的距离:差是 (-3, 0, -4),√(9 + 16) = 5。余弦说它俩「完全一样」,距离却是 5,又一次说明距离会被长度影响。

```python
# agent-zero-lab/part04/ex_cos_pqr.py
import numpy as np


def cosine(u: np.ndarray, v: np.ndarray) -> float:
    return float(u @ v / (np.linalg.norm(u) * np.linalg.norm(v)))


p = np.array([3.0, 0.0, 4.0])
q = np.array([0.0, 5.0, 0.0])
r = np.array([6.0, 0.0, 8.0])
s = np.array([-3.0, 0.0, -4.0])

print("cos(p, q) =", cosine(p, q))
print("cos(p, r) =", cosine(p, r))
print("cos(p, s) =", cosine(p, s))
print("dist(p, r) =", float(np.linalg.norm(p - r)))
```

<div class="line-notes">

- `def cosine(u: np.ndarray, v: np.ndarray) -> float:` 和 `cos_numpy.py` 里一样的函数。这里复制一份而不是 import,因为 `cos_numpy.py` 顶层有 `print`,一 import 就会执行。Day 32 讲过 `if __name__ == "__main__":` 可以解决这个问题,以后把这些函数收进 `common/` 模块时再整理。
- `p = np.array([3.0, 0.0, 4.0])` 长度 5 的向量。
- `cosine(p, q)` 点积 0,应为 0.0。
- `cosine(p, r)` 50 / (5 × 10),应为 1.0。
- `cosine(p, s)` -25 / (5 × 5),应为 -1.0。
- `np.linalg.norm(p - r)` 差向量 `(-3, 0, -4)` 的长度,应为 5.0。

</div>

```bash
uv run python part04/ex_cos_pqr.py
```

真实输出:

```text
cos(p, q) = 0.0
cos(p, r) = 1.0
cos(p, s) = -1.0
dist(p, r) = 5.0
```

</details>

**练习 2:写安全版的归一化和余弦。** 写 `normalize(v)`:长度为 0 时抛 `ValueError`,报错信息要能提示排查方向;再用它写 `cosine(u, v)`,内部先归一化再点积。分别用 `(3, 4)`、上面的 a 和 b、以及一个零向量测试。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_safe_normalize.py
import numpy as np


def normalize(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    if n == 0:
        raise ValueError("零向量没有方向,不能归一化(检查一下是不是空文本)")
    return v / n


def cosine(u: np.ndarray, v: np.ndarray) -> float:
    return float(normalize(u) @ normalize(v))


print(normalize(np.array([3.0, 4.0])))
print(round(cosine(np.array([1.0, 2.0, 2.0]), np.array([2.0, 1.0, 2.0])), 4))
try:
    cosine(np.array([1.0, 2.0, 2.0]), np.zeros(3))
except ValueError as e:
    print("报错:", e)
```

<div class="line-notes">

- `n = np.linalg.norm(v)` 先算长度。
- `if n == 0:` 长度为 0 就是零向量。这里用 `==` 比较是可以的,因为全 0 向量的长度精确地等于 0.0,不存在浮点误差。
- `raise ValueError("零向量没有方向,不能归一化(检查一下是不是空文本)")` 报错信息写上最可能的原因,半夜看日志的人会感谢你。
- `return v / n` 正常归一化。
- `return float(normalize(u) @ normalize(v))` 两个单位向量的点积就是余弦,不用再除。
- `normalize(np.array([3.0, 4.0]))` (3, 4) 的长度是 5,归一化后是 `[0.6 0.8]`。
- `cosine(np.array([1.0, 2.0, 2.0]), np.array([2.0, 1.0, 2.0]))` 应为 8/9 ≈ 0.8889。
- `np.zeros(3)` Day 214 提过,建一个三位全是 0.0 的小数数组。

</div>

```bash
uv run python part04/ex_safe_normalize.py
```

真实输出:

```text
[0.6 0.8]
0.8889
报错: 零向量没有方向,不能归一化(检查一下是不是空文本)
```

和 `cos_zero.py` 比,这次没有警告、没有 `nan`,而是一个说人话的异常,调用方必须处理。

</details>

**练习 3:四个词的相似度矩阵。** 把 Day 213 的猫、狗、马、汽车四个二维向量叠成一张 `(4, 2)` 的表,算出每两个词之间的余弦,排成一张 4×4 的表打印出来。提示:先把每行归一化得到 `unit`,然后 `unit @ unit.T`。`.T` 是**转置**,把表的行和列对调,`(4, 2)` 变成 `(2, 4)`;一张 `(4, 2)` 的表 `@` 一张 `(2, 4)` 的表,得到 `(4, 4)`,第 i 行第 j 列就是第 i 个词和第 j 个词的点积。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_sim_matrix.py
import numpy as np

names = ["猫", "狗", "马", "汽车"]
vecs = np.array([
    [0.9, 0.1],
    [0.85, 0.15],
    [0.7, 0.5],
    [0.05, 0.95],
])

unit = vecs / np.linalg.norm(vecs, axis=1, keepdims=True)
sim = unit @ unit.T
print("unit.shape:", unit.shape, " unit.T.shape:", unit.T.shape)
print("sim.shape:", sim.shape)
print("      " + "  ".join(f"{n:>4}" for n in names))
for name, row in zip(names, sim, strict=True):
    print(f"{name:>4}  " + "  ".join(f"{x:6.3f}" for x in row))
```

<div class="line-notes">

- `vecs = np.array([` 四个词的二维向量,和 Day 213 一样。
- `unit = vecs / np.linalg.norm(vecs, axis=1, keepdims=True)` 每行归一化,和 `cos_table.py` 同一招。
- `sim = unit @ unit.T` 所有词两两之间的点积,也就是两两之间的余弦,一次算完。这张表叫**相似度矩阵**,Day 218 会用真实 embedding 做一张大的。
- `unit.T.shape` 转置后从 `(4, 2)` 变成 `(2, 4)`。
- `"  ".join(f"{n:>4}" for n in names)` 表头。`:>4` 表示右对齐、占 4 格,相当于 JS 的 `padStart(4)`。汉字在终端里占两格宽,所以对得不是很齐,不影响读数。
- `for name, row in zip(names, sim, strict=True):` 遍历二维数组时每次拿到一行,和名字配对。
- `f"{x:6.3f}"` 每个数占 6 格、保留 3 位小数。

</div>

```bash
uv run python part04/ex_sim_matrix.py
```

真实输出:

```text
unit.shape: (4, 2)  unit.T.shape: (2, 4)
sim.shape: (4, 4)
         猫     狗     马    汽车
   猫   1.000   0.998   0.873   0.163
   狗   0.998   1.000   0.902   0.225
   马   0.873   0.902   1.000   0.623
  汽车   0.163   0.225   0.623   1.000
```

读法:对角线全是 1,每个词和自己同向;表左下和右上对称,cos(猫, 狗) 等于 cos(狗, 猫)。猫狗 0.998 几乎同向,猫和汽车 0.163 离得最远,马和谁都中等,跟 Day 213 画的图一致。注意这里没有负数,因为四个向量的两维都是正的,箭头全指向右上那个象限,夹角不会超过 90 度。

</details>

**练习 4(观察题):客户把话说了两遍。** 把「买错了能把钱要回来吗」的向量整体乘 2(`shout = calm * 2`),分别算它和三篇文章的余弦与距离,和原来的比较。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_shout.py
import numpy as np

titles = ["退款政策", "开发票指南", "重置密码"]
articles = np.array([
    [0.9, 0.2, 0.0, 0.1],
    [0.3, 0.9, 0.0, 0.0],
    [0.0, 0.0, 0.9, 0.1],
])
calm = np.array([0.8, 0.1, 0.0, 0.4])
shout = calm * 2

art_unit = articles / np.linalg.norm(articles, axis=1, keepdims=True)
for label, q in [("平静版", calm), ("翻倍版", shout)]:
    sims = art_unit @ (q / np.linalg.norm(q))
    dists = np.linalg.norm(articles - q, axis=1)
    print(label, "余弦:", sims.round(4), " 距离:", dists.round(4))
```

<div class="line-notes">

- `titles = [` 这个练习没用到标题,留着方便你自己加打印。
- `shout = calm * 2` 每一维乘 2,得 `[1.6, 0.2, 0.0, 0.8]`,方向不变,长度从 0.9 变成 1.8。
- `for label, q in [("平静版", calm), ("翻倍版", shout)]:` 用一个元组列表同时遍历两个版本。
- `sims = art_unit @ (q / np.linalg.norm(q))` 问题归一化后和整张表做点积。
- `dists = np.linalg.norm(articles - q, axis=1)` 原始向量的距离。

</div>

```bash
uv run python part04/ex_shout.py
```

真实输出:

```text
平静版 余弦: [0.9346 0.3865 0.0491]  距离: [0.3317 1.0247 1.245 ]
翻倍版 余弦: [0.9346 0.3865 0.0491]  距离: [0.9899 1.6793 1.9748]
```

余弦四位小数一个都没变,因为归一化把长度扔掉了。距离全部变大,和《退款政策》的距离从 0.33 变成 0.99。这一题里排序碰巧没变,但如果知识库里混着长短差很多的向量,只看距离就会像 Day 213 那样排错。

</details>

**验收标准:** 练习 1 四个数手算全对;能不看文章写出余弦公式,并说清分子、分母分别是 Day 214 的哪个零件;能解释为什么归一化以后余弦就等于点积;能说出 `np.argmax` 遇到 `nan` 会怎样,以及你打算在哪两个地方拦住零向量。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 余弦相似度(cosine similarity) | 两个向量夹角的余弦,等于点积除以两个长度的乘积。1 同向、0 垂直、-1 反向,只看方向不看长度 |
| 点积(dot product) | 对应位置相乘再求和。是余弦公式的分子;两个单位向量的点积就是余弦。Day 214 首次出现 |
| 归一化(normalize) | 把向量除以自己的长度,让长度变成 1,方向不变 |
| 单位向量(unit vector) | 长度为 1 的向量。所有单位向量的箭头尖都落在半径为 1 的圆(高维里是球面)上 |
| 余弦距离(cosine distance) | 1 减余弦相似度,越小越近。pgvector 的 `<=>` 就是它 |
| 内积(inner product) | 在我们的场景里就是点积的另一个叫法。pgvector 的 `<#>` 返回负内积 |
| 零向量 | 每一位都是 0 的向量,长度 0,没有方向,不能归一化 |
| `nan` | Not a Number,0 除以 0 之类无效运算的结果,和任何数比较都是 False。相当于 JS 的 `NaN` |
| `keepdims=True` | 让 `norm` 之类的函数在按行计算后保持二维形状 `(3, 1)`,方便下一步逐行相除 |
| 转置(`.T`) | 把表的行和列对调,`(4, 2)` 变 `(2, 4)` |
| 相似度矩阵 | 一组向量两两之间相似度排成的方阵,对角线全是 1,左右对称 |

## 常见误区

**把余弦相似度当成概率。** 0.8 不代表「80% 相关」,它只是一个夹角的余弦。不同 embedding 模型给出的分数分布差别很大,拿来排序可以,当绝对判断之前要先在自己的数据上校准。

**依赖一个固定阈值。** 「相似度大于 0.75 才算命中」这种规则,在一个模型上调好,换模型后可能一条都召回不了,或者什么都召回。先取前 k 个,阈值只作为辅助,并且每次换模型都要重新调。

**忘了归一化就直接拿点积当余弦。** 只有两个向量都是单位向量时,点积才等于余弦。如果服务返回的向量长度不是 1,直接点积排序会被长度带偏,和用距离犯的是同一个错。拿到向量自己归一化一次最省心。

**以为余弦和距离一定给出不同的结果。** 对归一化后的向量,两者排序完全一致,`normalize.py` 里的 `√(2 - 2cos)` 就是证明。所以向量库里选 `<=>` 还是 `<->`,对单位向量来说结果一样,区别只在数值是越大越近还是越小越近。

**没拦零向量。** 空文本、全是标点的文本、某些服务的异常返回,都可能产生全 0 向量。numpy 只给一行容易被忽略的 `RuntimeWarning`,然后 `nan` 会让 `argmax` 把这篇文档排到第一。入库时检查,计算时再检查。

**对二维表归一化忘了 `keepdims=True`。** `(3, 4)` 除以 `(3,)` 会报 `could not be broadcast together`。更隐蔽的情况是表恰好是方的,比如 `(4, 4)` 除以 `(4,)`,numpy 不报错,而是把每一**列**除以对应的数,结果全错。按行归一化就固定写 `axis=1, keepdims=True`。

## 学习资料

### 文档与文章

- [维基百科 · 余弦相似性(中文)](https://zh.wikipedia.org/wiki/%E4%BD%99%E5%BC%A6%E7%9B%B8%E4%BC%BC%E6%80%A7):看开头的定义和公式,以及「角距离」一节知道还有这个叫法就行。
- [OpenAI · Embeddings 指南](https://developers.openai.com/api/docs/guides/embeddings):直接拉到页面底部 FAQ 里「Which distance function should I use?」那一问,原文推荐余弦,并说明 OpenAI 的向量已经归一化到长度 1,所以余弦可以只用点积算、余弦和欧氏距离排序一致。今天学的结论在官方文档里的原话。
- [pgvector README](https://github.com/pgvector/pgvector):找到 Querying 一节的操作符列表:`<->` 是 L2 距离、`<#>` 是负内积、`<=>` 是余弦距离。README 里也解释了 `<#>` 为什么返回负数:Postgres 的索引只支持从小到大扫描。先混个眼熟。
- [numpy.allclose 文档](https://numpy.org/doc/stable/reference/generated/numpy.allclose.html):今天用来比较两个小数数组「几乎相等」,看一眼 `rtol`、`atol` 两个容差参数是什么意思。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1a44qzCEVS&autoplay=0&high_quality=1" title="快速理解:余弦相似度" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序猿DD · 快速理解:余弦相似度 · 4 分钟,讲余弦相似度在文本检索里怎么用,适合做完手算以后看一遍,确认自己理解的和别人讲的一致。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ys411472E&p=10&autoplay=0&high_quality=1" title="【官方双语/合集】线性代数的本质 - 07 - 点积与对偶性" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>3Blue1Brown · 【官方双语/合集】线性代数的本质 · 第 10P「07 - 点积与对偶性」,14 分钟。前 5 分钟讲点积的几何意义(投影),能帮你理解「点积 ÷ 两个长度」为什么就是夹角的余弦;后半段讲对偶性,今天可以不看。</figcaption>
</figure>

- Boujoy的日记《一条视频搞懂Embedding 向量空间和余弦相似度!》(BV1vfNk6hEvp,10 分钟):把 embedding 和余弦串在一起讲,正好衔接 Day 217。
- 古希腊掌管代码的神《【RAG 必修】余弦相似度的维度灾难:为什么检索结果全挤在 0.9 附近》(BV1Sr826dExM,3 分钟):讲的就是上面「看排序别看阈值」那件事,Day 218 跑完真实矩阵以后回来看更有体会。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/e9U0QAFbfLI" title="Cosine Similarity, Clearly Explained!!!" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>StatQuest with Josh Starmer · Cosine Similarity, Clearly Explained!!! · 用数电影台词里单词出现次数的例子讲余弦,其中「一句话重复两遍,余弦不变」那段和今天的练习 4 是同一件事。</figcaption>
</figure>

- 3Blue1Brown 英文原版《Dot products and duality | Chapter 9, Essence of linear algebra》(YouTube ID `LyGKycYT2v0`):B 站那集打不开时看这个。

### 书籍

- 平冈和幸、堀玄《程序员的数学 3:线性代数》(卢晓南译,人民邮电出版社,2016):找讲内积和长度的那几节,和今天的公式一一对照。
- Marc Peter Deisenroth、A. Aldo Faisal、Cheng Soon Ong《Mathematics for Machine Learning》(Cambridge University Press,2020),免费 PDF 在 [mml-book.github.io](https://mml-book.github.io/)。第 3 章「Analytic Geometry」里讲内积、长度、夹角的几节,给出了余弦公式的严格来历。想知道「为什么点积除以长度就是余弦」时再读。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly,2024),中文版《图解大模型:生成式AI原理与实践》(人民邮电出版社,2025)。第 2 章讲 embedding 时用到余弦相似度,Day 217 开始用真模型前读最合适。

### 开源项目与代码

- [pgvector/pgvector](https://github.com/pgvector/pgvector):以后存向量的 Postgres 扩展,今天只看 README 的操作符,Day 220 前后正式用。
- [FlagOpen/FlagEmbedding](https://github.com/FlagOpen/FlagEmbedding):bge 系列 embedding 模型的官方仓库。README 的用法示例里,模型输出的向量做了归一化,算相似度用的就是 `@`,读完今天的内容你应该能看懂那一行。

## 自测

**1. 手算 `u = (1, 0)` 和 `v = (1, 1)` 的余弦相似度。它们的夹角大约是多少度?**

<details><summary>答案</summary>

点积 1×1 + 0×1 = 1;|u| = 1,|v| = √2 ≈ 1.414;cos = 1 / 1.414 ≈ 0.707。夹角 45 度(v 是 x 轴和 y 轴正中间的那根对角线)。

</details>

**2. 向量 `(2, 0)` 归一化以后是什么?`(0.6, 0.8)` 需要归一化吗?**

<details><summary>答案</summary>

`(2, 0)` 长度是 2,除以 2 得 `(1, 0)`。`(0.6, 0.8)` 的长度是 √(0.36 + 0.64) = 1,已经是单位向量,归一化后不变。

</details>

**3. 为什么说「对归一化后的向量,按余弦排序和按欧氏距离排序结果一样」?**

<details><summary>答案</summary>

对两个单位向量,距离² = 2 - 2 × 余弦。余弦越大,距离越小,一一对应,所以两种排序完全相同(一个从大到小,一个从小到大)。`normalize.py` 里用 `√(2 - 2cos)` 算出的 0.4714 和直接算的距离一致。

</details>

**4. 下面代码想找出最相关的文档,为什么在有空文档时会出错?怎么改?**

```python
scores = docs @ query / (np.linalg.norm(docs, axis=1) * np.linalg.norm(query))
best = np.argmax(scores)
```

<details><summary>答案</summary>

空文档如果被编码成零向量,它那一行的长度是 0,分数就是 0/0 = `nan`。numpy 只打一个警告,而 `np.argmax` 会把 `nan` 当最大值返回,结果选中了那篇空文档。改法:入库前过滤空文本、拒绝长度为 0 的向量;算分时检查 `np.linalg.norm(docs, axis=1) == 0` 的行并排除,或者提前把所有向量归一化好(归一化函数里遇到零向量直接报错),查询时只算 `docs_unit @ query_unit`。

</details>

**5. 面试题:「我们用了一个 embedding 模型,召回时设置了相似度 > 0.8 才返回。换了一个新模型后,召回率掉到几乎为 0,但人工看新模型的排序其实不错。可能是什么原因?怎么做才稳?」**

<details><summary>答案</summary>

最可能的原因是两个模型的余弦分数分布不同:新模型的句向量之间相似度整体落在更低(或更窄)的区间,同样相关的两句话在旧模型上是 0.85,在新模型上可能只有 0.6,固定的 0.8 阈值把它们全挡掉了。相似度是夹角的余弦,不是概率,不同模型之间没有可比性。稳的做法是以 top-k 排序为主,阈值只作为兜底;每次换模型都用一套标注好的评测问题,画出新模型上相关和不相关样本的分数分布,重新选阈值;同时确认索引已经用新模型全量重建,而不是新模型的查询向量去比旧模型的文档向量。

</details>

## 明天预告

明天是 [Day 216 · 第 31 周复习:RAG 与上下文(Day 210–215)](/blog/agent-zero/day-216-week31-review/)。这一周前半段在学怎么用 Coding Agent 干活(AGENTS.md、hooks、无人值守),后半段从关键词搜索走到了向量、距离、numpy 和余弦。复习日会把这六天画成一张知识地图,把你这周踩过的坑(`zip` 截断、整数数组、`nan`、`keepdims`)列成一张错题单,再让你合上文章默写 `cos_table.py` 并跑通。复习完,Day 217 就开始调真正的 embedding 服务,把今天手工编的四个数换成模型给的 1024 个数。
