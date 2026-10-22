---
title: 'Day 214 · numpy 够用版:数组、点积和范数'
description: '为 embedding 打基础,只学 numpy 里马上要用的那一小块:ndarray 是什么、为什么一行代码能对整串数字做运算、点积和范数怎么算。最后实测 2000 个 1024 维向量,for 循环和 numpy 差了多少倍。'
pubDate: 2026-10-22
regime: none
tags: ['numpy', 'vector', 'python', 'agent-zero']
series: 'agent-zero'
day: 214
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 213](/blog/agent-zero/day-213-vectors-2d/) 我们把「意思像不像」换成了「离得近不近」:向量是一串有顺序的数字,两个向量之间的欧氏距离是「每一维相减、平方、求和、开根号」。我们手写了 `distance` 函数,还用手工编的四维向量给「买错了能把钱要回来吗」找到了《退款政策》。

那一课结尾留了两个尾巴。一个是速度:`distance` 用 `for` 循环一维一维地加,四维没问题,可真实的 embedding 是 1024 维,知识库有几千段。另一个是 `length_problem.py` 暴露的毛病,距离把「长度」也算进去了,Day 215 要用余弦相似度来解决,而余弦需要两个零件:点积和范数。今天用 numpy 把这两件事一起准备好。

## 今天要解决的问题

学完今天,你应该能做到:

1. 用 `uv add numpy` 装好 numpy,建一个 `ndarray`,说出它的 `shape` 和 `dtype` 是什么意思,和 Python 列表有什么区别。
2. 理解「向量化运算」:`a + b`、`a * 2`、`a * b` 在 numpy 里是逐位算的,而同样的写法放在列表上意思完全不同。能说出为什么 numpy 比 `for` 循环快。
3. 手算并用 numpy 验算点积(`a @ b`)和范数(`np.linalg.norm(a)`),用 numpy 一行写出 Day 213 的欧氏距离。
4. 把几篇文章的向量叠成一张二维表,一次算出问题和每一篇的距离,用 `argmin` 找出最近的那篇。

预计用时 2.5 小时。前置:[Day 213](/blog/agent-zero/day-213-vectors-2d/) 向量和距离、[Day 10](/blog/agent-zero/day-010-uv-1/) uv 的 `add` 和 `run`、[Day 21](/blog/agent-zero/day-021-lists/) 列表、[Day 23](/blog/agent-zero/day-023-comprehensions/) 列表推导式。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `np_dot_norm.py` 和 `np_table.py`;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

今天只讲 numpy 里够我们做向量检索的那一小块。numpy 本身很大,切片花样、广播规则、随机数、线性代数全家桶,以后用到哪个再讲哪个。网上 numpy 教程动辄十几个小时,那是给做数据分析的人准备的,我们不需要。

## 装 numpy,认识 ndarray

numpy 是一个第三方包,和前端装 lodash 一样要先装。在 `agent-zero-lab` 根目录运行:

```bash
cd agent-zero-lab
uv add numpy
```

我这边装上的是 `numpy==2.5.4`(2026 年 10 月 22 日查 PyPI,这是最新版,2026 年 10 月 10 日发布,要求 Python ≥ 3.12)。装完 `pyproject.toml` 的 `dependencies` 里会多一行 `"numpy>=2.5.4"`,和 `npm install` 往 `package.json` 里写依赖是一回事。

numpy 的核心是一个叫 **ndarray** 的类型(n-dimensional array,n 维数组)。你可以先把它理解成「只装同一种数字、长度固定的数组」。和 Python 列表比,它有两个关键区别:里面每个元素类型相同(通常都是 64 位小数),以及它在内存里是一整块连续的数字,不是一堆指向各个对象的指针。第二点就是它快的原因,后面实测。

前端里最接近的东西是 `Float64Array`。`new Float64Array([0.9, 0.1])` 也是「一整块连续内存、每个元素都是 64 位浮点数」,和普通的 `[0.9, 0.1]` 不一样。如果你用过 WebGL 或者处理过音频数据,应该见过它。

新建 `part04/np_first.py`:

```python
# agent-zero-lab/part04/np_first.py
import numpy as np

cat = np.array([0.9, 0.1])
print("cat =", cat)
print("类型:", type(cat))
print("形状 shape:", cat.shape)
print("几维数组 ndim:", cat.ndim)
print("元素类型 dtype:", cat.dtype)
print("第 0 个:", cat[0])

counts = np.array([3, 4])
print("counts 的 dtype:", counts.dtype)

back = cat.tolist()
print("转回列表:", back, type(back))
```

<div class="line-notes">

- `import numpy as np` 导入 numpy 并起个短名字 `np`。这是全世界统一的写法,你在任何资料里看到的 `np.` 都是它。相当于 JS 的 `import * as np from "numpy"`。
- `cat = np.array([0.9, 0.1])` 把一个 Python 列表转成 ndarray。Day 213 的猫向量,现在是 numpy 数组了。
- `print("cat =", cat)` 打印出来是 `[0.9 0.1]`,**中间没有逗号**,这是一眼认出 ndarray 的办法。列表打印是 `[0.9, 0.1]`。
- `type(cat)` 输出 `<class 'numpy.ndarray'>`。
- `cat.shape` 形状,一个元组,写着每个方向上有几个元素。一维数组的 shape 是 `(2,)`,意思是「一个方向,2 个元素」。那个逗号不能少,因为 `(2)` 在 Python 里就是数字 2,`(2,)` 才是只有一个元素的元组。
- `cat.ndim` 数组有几个方向(几个「轴」)。注意这和 Day 213 说的「向量的维度」不是一回事:`cat` 是一个**二维向量**(2 个数),但它是一个**一维数组**(只有一排)。这个叫法很容易搞混,下面专门说。
- `cat.dtype` 元素类型,`float64` 就是 64 位浮点数,和 JS 的 `number` 精度一样。
- `cat[0]` 下标取值和列表一样,输出 `0.9`。
- `counts = np.array([3, 4])` 全是整数的列表转成数组,numpy 会自动选整数类型。
- `counts.dtype` 输出 `int64`。整数数组有个坑,在下面「故意踩坑」一节演示。
- `back = cat.tolist()` 转回普通 Python 列表。以后把向量存进 JSON 文件、传给不认识 numpy 的库时会用到。
- `print("转回列表:", back, type(back))` 输出 `[0.9, 0.1] <class 'list'>`,逗号又回来了。

</div>

```bash
uv run python part04/np_first.py
```

真实输出:

```text
cat = [0.9 0.1]
类型: <class 'numpy.ndarray'>
形状 shape: (2,)
几维数组 ndim: 1
元素类型 dtype: float64
第 0 个: 0.9
counts 的 dtype: int64
转回列表: [0.9, 0.1] <class 'list'>
```

关于那个容易混的「维」。说「1024 维向量」时,指的是向量里有 1024 个数;说「一维数组」「二维数组」时,指的是数组有几个方向:一维是一排,二维是一张表(有行有列)。一个 1024 维的向量存成 numpy 就是 shape 为 `(1024,)` 的一维数组;3000 个这样的向量叠在一起,是 shape 为 `(3000, 1024)` 的二维数组。以后看到 shape,先读括号里有几个数(几个方向),再读每个数是多少(每个方向多长),就不会乱。

## 向量化运算:一行代码对整串数字做运算

这一节是今天第二个新概念。先看一个前端同学最容易栽的坑:同样写 `a + b`,列表和 numpy 数组的意思完全不同。

新建 `part04/np_vs_list.py`:

```python
# agent-zero-lab/part04/np_vs_list.py
import numpy as np

la = [1.0, 2.0, 3.0]
lb = [10.0, 20.0, 30.0]
print("列表 + 列表:", la + lb)
print("列表 * 2:", la * 2)

a = np.array(la)
b = np.array(lb)
print("数组 + 数组:", a + b)
print("数组 - 数组:", b - a)
print("数组 * 2:", a * 2)
print("数组 * 数组:", a * b)
print("数组 ** 2:", a**2)
print("求和 sum:", (a * b).sum())

manual = [x + y for x, y in zip(la, lb, strict=True)]
print("列表推导式手写相加:", manual)
```

<div class="line-notes">

- `la = [1.0, 2.0, 3.0]` 两个普通列表,各三个数。
- `la + lb` 列表的 `+` 是**拼接**,得到六个元素的长列表,相当于 JS 的 `[...la, ...lb]`。JS 里 `[1,2] + [3,4]` 更离谱,会变成字符串 `"1,23,4"`。
- `la * 2` 列表乘整数是**重复**,`[1.0, 2.0, 3.0, 1.0, 2.0, 3.0]`。
- `a = np.array(la)` 转成 numpy 数组。
- `a + b` numpy 的 `+` 是**逐位相加**:第 0 位 1+10,第 1 位 2+20,第 2 位 3+30,得 `[11. 22. 33.]`。数字后面那个点表示它是小数。
- `b - a` 逐位相减,`[9. 18. 27.]`。Day 213 的距离公式第一步「每一维相减」,在 numpy 里就是这一个减号。
- `a * 2` 每一位都乘 2,`[2. 4. 6.]`。数组和一个单独的数做运算时,这个数会作用到每一位上。
- `a * b` 逐位相乘,1×10、2×20、3×30,得 `[10. 40. 90.]`。注意它**不是**点积,结果还是三个数。
- `a**2` 每一位平方,`[1. 4. 9.]`。
- `(a * b).sum()` 逐位相乘以后再把三个数加起来,10+40+90=140。「逐位乘再求和」就是点积,下一节专门讲。
- `manual = [x + y for x, y in zip(la, lb, strict=True)]` 用 Day 213 学的 `zip` 加列表推导式手写逐位相加,结果和 `a + b` 一样,只是要自己写循环。

</div>

```bash
uv run python part04/np_vs_list.py
```

真实输出:

```text
列表 + 列表: [1.0, 2.0, 3.0, 10.0, 20.0, 30.0]
列表 * 2: [1.0, 2.0, 3.0, 1.0, 2.0, 3.0]
数组 + 数组: [11. 22. 33.]
数组 - 数组: [ 9. 18. 27.]
数组 * 2: [2. 4. 6.]
数组 * 数组: [10. 40. 90.]
数组 ** 2: [1. 4. 9.]
求和 sum: 140.0
列表推导式手写相加: [11.0, 22.0, 33.0]
```

像 `a + b`、`a * 2` 这样,写的是一个运算,实际作用到数组每一个元素上,叫**向量化运算**(vectorized operation)。从 JS 的角度,`a + b` 大致等于 `a.map((x, i) => x + b[i])`,只是你不用写那个 `map`。

它为什么快?你写的循环在 Python 解释器里一圈一圈地跑,每一圈都要检查 `x` 是什么类型、找加法该怎么做、新建一个结果对象,开销远大于加法本身。numpy 把整块连续内存交给底层用 C 写好的循环,类型早就确定了,一口气算完,中间不回到 Python。打个比方,`for` 循环是收银员一件一件扫码,每扫一件还要问一遍「这是什么」;numpy 是整箱过秤。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="Python 列表的 for 循环每个元素都要回到解释器处理,numpy 把一整块连续内存交给底层 C 循环一次算完">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink)">Python 列表 + for 循环</text>
<rect x="20" y="40" width="50" height="26" fill="none" stroke="var(--rule)"/>
<rect x="80" y="40" width="50" height="26" fill="none" stroke="var(--rule)"/>
<rect x="140" y="40" width="50" height="26" fill="none" stroke="var(--rule)"/>
<text x="28" y="58" fill="var(--ink-soft)">指针</text>
<text x="88" y="58" fill="var(--ink-soft)">指针</text>
<text x="148" y="58" fill="var(--ink-soft)">指针</text>
<line x1="45" y1="66" x2="45" y2="96" stroke="var(--ink-faint)"/>
<line x1="105" y1="66" x2="120" y2="96" stroke="var(--ink-faint)"/>
<line x1="165" y1="66" x2="200" y2="96" stroke="var(--ink-faint)"/>
<circle cx="45" cy="104" r="9" fill="none" stroke="var(--compute)"/>
<circle cx="120" cy="104" r="9" fill="none" stroke="var(--compute)"/>
<circle cx="200" cy="104" r="9" fill="none" stroke="var(--compute)"/>
<text x="30" y="138" fill="var(--ink-soft)">每个数是一个独立对象,散在内存各处</text>
<text x="30" y="158" fill="var(--compute)">每一圈:查类型 → 找加法 → 新建结果对象</text>
<line x1="330" y1="20" x2="330" y2="230" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="350" y="28" fill="var(--ink)">numpy ndarray</text>
<rect x="350" y="40" width="270" height="26" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="360" y="58" fill="var(--ink)">1.0 | 2.0 | 3.0 | ... 一整块 float64</text>
<line x1="485" y1="66" x2="485" y2="96" stroke="var(--mem)" stroke-width="2"/>
<rect x="400" y="96" width="170" height="26" fill="none" stroke="var(--mem)"/>
<text x="412" y="114" fill="var(--mem)">底层 C 循环一次跑完</text>
<text x="350" y="158" fill="var(--ink-soft)">类型提前定好,不回 Python 解释器</text>
<text x="20" y="210" fill="var(--ink)">实测:2000 个 1024 维向量各算一次点积,for 循环 98–378 ms,numpy 1.3–1.4 ms</text>
</g>
</svg>
<figcaption>numpy 快不是因为加法本身更快,而是省掉了每个元素都回到 Python 解释器的开销。底部数字是本文 np_speed.py 在 2019 款 Intel MacBook Pro 上跑三次的范围。</figcaption>
</figure>

## 点积:逐位相乘再加起来

**点积**(dot product)是两个同样长的向量对应位置相乘,再全部加起来,结果是一个数。上一节的 `(a * b).sum()` 就是点积。为什么单独给它起名字?因为它太常用了:Day 215 的余弦相似度分子就是点积,向量库里的「内积」检索就是点积,神经网络里绝大部分计算也都是点积。

先手算一次。`a = (1, 2, 2)`,`b = (2, 1, 2)`:

- 对应位置相乘:1×2 = 2,2×1 = 2,2×2 = 4
- 加起来:2 + 2 + 4 = 8

所以 `a · b = 8`。

## 范数:向量有多长

**范数**(norm)在今天就是向量的长度,Day 213 用 `math.hypot` 算过,箭头从原点到点有多长。公式是每一位平方、加起来、开根号。你会发现它和点积是一家人:向量和**自己**做点积,就是每一位平方再求和,所以长度 = √(a · a)。

手算 `a = (1, 2, 2)` 的长度:1 + 4 + 4 = 9,√9 = 3。

还有一个顺手的推论:两点之间的欧氏距离,就是它俩**差向量的长度**。`cat - car` 先逐位相减得到一个新向量,再求它的长度,和 Day 213 手写的 `distance` 是一回事。

范数其实有好几种,这里说的「平方和开根号」叫 L2 范数,numpy 默认算的就是它。Day 213 说欧氏距离也叫 L2 距离,名字就是从这来的。其他范数我们用不到,知道有这个说法就行。

新建 `part04/np_dot_norm.py`,把这两个零件都用 numpy 算一遍:

```python
# agent-zero-lab/part04/np_dot_norm.py
import numpy as np

a = np.array([1.0, 2.0, 2.0])
b = np.array([2.0, 1.0, 2.0])

print("逐位相乘:", a * b)
print("点积(相乘再求和):", (a * b).sum())
print("点积 np.dot:", np.dot(a, b))
print("点积 @ 运算符:", a @ b)

print("a 的长度 sqrt(a @ a):", np.sqrt(a @ a))
print("a 的长度 np.linalg.norm:", np.linalg.norm(a))

cat = np.array([0.9, 0.1])
car = np.array([0.05, 0.95])
print("猫-汽车 距离:", round(float(np.linalg.norm(cat - car)), 4))
```

<div class="line-notes">

- `a = np.array([1.0, 2.0, 2.0])` 和上面手算用的是同一组数。
- `a * b` 逐位相乘,`[2. 2. 4.]`,还是三个数。
- `(a * b).sum()` 再加起来,8.0。这是点积最直白的写法。
- `np.dot(a, b)` numpy 专门的点积函数,也是 8.0。
- `a @ b` `@` 是 Python 专门给矩阵乘法留的运算符,两个一维数组用 `@` 就是点积。三种写法结果一样,我推荐 `@`,最短,而且在下面二维的情况下照样能用。JS 里没有这个运算符。
- `np.sqrt(a @ a)` 自己和自己点积是 1+4+4=9,开根号 3.0。`np.sqrt` 和 `math.sqrt` 一样,只是它也能接受数组,对每一位开方。
- `np.linalg.norm(a)` numpy 现成的范数函数,`linalg` 是 linear algebra(线性代数)的缩写。也是 3.0。
- `cat = np.array([0.9, 0.1])` Day 213 的猫和汽车。
- `np.linalg.norm(cat - car)` 从里往外读:`cat - car` 逐位相减得差向量 `[0.85, -0.85]`;`np.linalg.norm` 求这个差向量的长度,就是两点距离,`√(0.7225 + 0.7225) ≈ 1.2021`,和 Day 213 手算的一样;`np.linalg.norm` 返回的是 numpy 自己的小数类型 `np.float64`,所以先 `float()` 转成普通 Python 小数再 `round(..., 4)`,原因在后面的坑里讲。

</div>

```bash
uv run python part04/np_dot_norm.py
```

真实输出:

```text
逐位相乘: [2. 2. 4.]
点积(相乘再求和): 8.0
点积 np.dot: 8.0
点积 @ 运算符: 8.0
a 的长度 sqrt(a @ a): 3.0
a 的长度 np.linalg.norm: 3.0
猫-汽车 距离: 1.2021
```

8 和 3 跟手算一致,猫和汽车的距离也和 Day 213 对上了。记住这两个数,明天的余弦相似度就是拿点积 8 去除以两个长度 3 × 3。

## 故意踩坑:三个 numpy 新手必遇的问题

新建 `part04/np_pitfalls.py`,把三个坑一次踩完:

```python
# agent-zero-lab/part04/np_pitfalls.py
import numpy as np

a = np.array([1.0, 2.0, 3.0])
b = np.array([1.0, 2.0])
try:
    print(a + b)
except ValueError as e:
    print("形状不同:", e)

ints = np.array([1, 2, 3])
ints[0] = 0.5
print("整数数组塞进 0.5:", ints)

scores = [np.float64(0.3317), np.float64(1.0247)]
print("列表里的 numpy 数字:", scores)
print("转成 Python float:", [float(s) for s in scores])
```

<div class="line-notes">

- `a = np.array([1.0, 2.0, 3.0])` 三个数。
- `b = np.array([1.0, 2.0])` 两个数,故意对不上。
- `print(a + b)` 逐位相加要求两边一样长。Day 213 的 `zip` 不加 `strict` 会悄悄截断,numpy 在这点上更严格,直接报错。
- `except ValueError as e:` 接住报错,打印原文。
- `ints = np.array([1, 2, 3])` dtype 是 `int64`,上面 `np_first.py` 见过。
- `ints[0] = 0.5` 往整数数组里塞小数。numpy 数组的类型在建好时就定死了,0.5 会被**截掉小数部分**变成 0,而且不报错。JS 的 `Int32Array` 也是这样:`const t = new Int32Array(3); t[0] = 0.5` 之后 `t[0]` 是 0。
- `print("整数数组塞进 0.5:", ints)` 输出 `[0 2 3]`,0.5 不见了。
- `scores = [np.float64(0.3317), np.float64(1.0247)]` 模拟一个常见场景:从 numpy 数组里取出几个分数放进普通列表。
- `print("列表里的 numpy 数字:", scores)` numpy 2 开始,列表里的 numpy 数字打印成 `np.float64(0.3317)` 这种样子,第一次看到会以为出错了。其实值没问题,只是显示方式。
- `[float(s) for s in scores]` 逐个转成普通 Python `float`,打印就干净了。往 JSON 里写分数时也必须这样转,`json.dumps` 对 `np.float32` 会报 `Object of type float32 is not JSON serializable`(`np.float64` 碰巧能过,因为它是 `float` 的子类,但别指望这个)。

</div>

```bash
uv run python part04/np_pitfalls.py
```

真实输出:

```text
形状不同: operands could not be broadcast together with shapes (3,) (2,) 
整数数组塞进 0.5: [0 2 3]
列表里的 numpy 数字: [np.float64(0.3317), np.float64(1.0247)]
转成 Python float: [0.3317, 1.0247]
```

第一条报错读法:operands 是「参与运算的两个数组」,broadcast 是 numpy 把两个形状对齐的规则(今天只碰到「数组和单个数」以及下面「表和一行」两种情况,别的以后再说),后面告诉你两个形状分别是 `(3,)` 和 `(2,)`,对不上。

用 `@` 做点积时维度不对,报错更长一些。我在终端里直接跑了一行 `uv run python -c "import numpy as np; np.array([1.0,2.0,3.0]) @ np.array([1.0,2.0])"`,真实报错:

```text
Traceback (most recent call last):
  File "<string>", line 1, in <module>
ValueError: matmul: Input operand 1 has a mismatch in its core dimension 0, with gufunc signature (n?,k),(k,m?)->(n?,m?) (size 2 is different from 3)
```

前面一长串是给数学家看的,只看最后括号里那句:`size 2 is different from 3`,一边 2 个数一边 3 个数。以后在 RAG 代码里看到这条,十有八九是查询向量和文档向量出自不同模型。

整数数组那个坑在我们的场景里不常见,因为 embedding 永远是小数。但如果你用 `np.array([0, 0, 0])` 先建一个「全零」数组再往里填分数,就会中招。要建全零的小数数组,用 `np.zeros(3)`,它默认是 `float64`。

## 实测:for 循环和 numpy 差多少

说 numpy 快,得拿数字说话。我们造 2000 个 1024 维的随机向量(相当于一个两千段的知识库,用 bge-m3 那么宽的向量),再造一个查询向量,让每个文档向量都和查询算一次点积,分别用纯 Python 循环和 numpy 计时。

随机数是今天第一次出现,它不是今天的重点,只用来造数据:`rng.random((2000, 1024))` 生成一张 2000 行、1024 列的表,每格是 0 到 1 之间的随机小数。给了固定的种子 42,所以你跑出来的随机数和我的一模一样。

新建 `part04/np_speed.py`:

```python
# agent-zero-lab/part04/np_speed.py
import time

import numpy as np

DIM = 1024
N = 2000

rng = np.random.default_rng(42)
docs = rng.random((N, DIM))
query = rng.random(DIM)

docs_list = docs.tolist()
query_list = query.tolist()


def loop_dot(u: list[float], v: list[float]) -> float:
    total = 0.0
    for x, y in zip(u, v, strict=True):
        total += x * y
    return total


start = time.perf_counter()
loop_scores = [loop_dot(query_list, row) for row in docs_list]
loop_seconds = time.perf_counter() - start

start = time.perf_counter()
np_scores = docs @ query
np_seconds = time.perf_counter() - start

print(f"{N} 个 {DIM} 维向量,各和 query 算一次点积")
print(f"for 循环: {loop_seconds * 1000:.1f} ms")
print(f"numpy:    {np_seconds * 1000:.1f} ms")
print(f"快了约 {loop_seconds / np_seconds:.0f} 倍")
print("两边结果最大差:", float(np.max(np.abs(np.array(loop_scores) - np_scores))))
print("点积最大的是第", int(np.argmax(np_scores)), "个")
```

<div class="line-notes">

- `import time` 标准库的计时模块。
- `DIM = 1024` 每个向量 1024 维,和 bge-m3 一样。
- `N = 2000` 2000 个文档向量。
- `rng = np.random.default_rng(42)` 建一个随机数生成器,种子 42。种子相同,每次生成的随机数就相同,实验可以复现。
- `docs = rng.random((N, DIM))` 一张 `(2000, 1024)` 的二维数组,一行是一个文档向量,一共 2048000 个随机数。
- `query = rng.random(DIM)` 一个 shape 为 `(1024,)` 的查询向量。
- `docs_list = docs.tolist()` 转成普通的「列表套列表」,给纯 Python 版本用,保证两边算的是同一批数。
- `def loop_dot(u: list[float], v: list[float]) -> float:` 纯 Python 的点积:逐位乘、累加。
- `total += x * y` 这一行会被执行 2000 × 1024 = 2048000 次。
- `start = time.perf_counter()` 记下开始时间。`perf_counter` 是专门用来计时的高精度时钟,相当于浏览器里的 `performance.now()`,只是单位是秒。
- `loop_scores = [loop_dot(query_list, row) for row in docs_list]` 对每一行算一次点积,得到 2000 个分数。
- `loop_seconds = time.perf_counter() - start` 结束时间减开始时间,就是耗时(秒)。
- `np_scores = docs @ query` 就这一行。一张 `(2000, 1024)` 的表 `@` 一个 `(1024,)` 的向量,意思是「表的每一行都和这个向量做点积」,结果是 shape `(2000,)` 的数组,2000 个分数。下一节在小表上手算一遍你就明白了。
- `print(f"for 循环: {loop_seconds * 1000:.1f} ms")` 秒乘 1000 换成毫秒,保留一位小数。
- `loop_seconds / np_seconds` 两个耗时相除,看快多少倍。
- `np.max(np.abs(np.array(loop_scores) - np_scores))` 两边的 2000 个分数逐位相减、取绝对值、找最大的那个,用来确认两种算法结果一致。
- `np.argmax(np_scores)` `argmax` 返回最大值所在的**下标**,不是最大值本身。这里是第 828 个文档和 query 的点积最大。`int()` 把 numpy 整数转成普通 `int`。

</div>

```bash
uv run python part04/np_speed.py
```

我在 2019 款 13 寸 Intel MacBook Pro 上连跑三次,其中一次的真实输出:

```text
2000 个 1024 维向量,各和 query 算一次点积
for 循环: 196.4 ms
numpy:    1.4 ms
快了约 138 倍
两边结果最大差: 7.389644451905042e-13
点积最大的是第 828 个
```

三次里 for 循环分别是 196.4、377.7、282.8 毫秒,numpy 是 1.4、1.4、1.3 毫秒,倍数在 138 到 273 之间。之前写这段代码的一个早期版本时也跑过三次,for 循环那次是 98–153 毫秒。for 循环的耗时波动很大,因为它受电脑当时忙不忙影响;numpy 那边稳稳在 1.3–1.4 毫秒。你的电脑数字会不一样,但两三个数量级的差距不会变。

两边结果最大差是 `7.4e-13`,也就是 0.00000000000074,这是浮点数加法顺序不同造成的正常误差(Day 12 讲过 `0.1 + 0.2` 不等于 0.3),可以认为完全一致。

200 毫秒听起来不多,但这只是一次查询、两千段文档。知识库到两万段就是两秒,每个用户提问都要等。练习 5 你会亲自把 N 改成 20000 看看。

## 把几篇文章叠成一张表

上一节的 `docs @ query` 是一张表和一个向量相乘。我们拿 Day 213 的三篇帮助文章做一张小表,手算一遍你就知道它做了什么。

新建 `part04/np_table.py`:

```python
# agent-zero-lab/part04/np_table.py
import numpy as np

titles = ["退款政策", "开发票指南", "重置密码"]
articles = np.array([
    [0.9, 0.2, 0.0, 0.1],
    [0.3, 0.9, 0.0, 0.0],
    [0.0, 0.0, 0.9, 0.1],
])
query = np.array([0.8, 0.1, 0.0, 0.4])

print("articles.shape:", articles.shape)
print("第 1 行:", articles[1])
print("第 1 行第 0 列:", articles[1, 0])

print("每篇和问题的点积:", articles @ query)
print("每篇的长度:", np.linalg.norm(articles, axis=1))

dists = np.linalg.norm(articles - query, axis=1)
print("每篇到问题的距离:", dists.round(4))
best = int(np.argmin(dists))
print("最近的是:", titles[best])
```

<div class="line-notes">

- `titles = ["退款政策", "开发票指南", "重置密码"]` 标题单独放一个列表,顺序和下面表的行一一对应。numpy 数组只装数字,文字要另外存。
- `articles = np.array([` 列表套列表转成二维数组,每一行是一篇文章的四维向量(钱、发票、登录、情绪),数字和 Day 213 的 `nearest.py` 完全一样。
- `query = np.array([0.8, 0.1, 0.0, 0.4])` 「买错了能把钱要回来吗」的向量。
- `articles.shape` 输出 `(3, 4)`:3 行 4 列,3 篇文章、每篇 4 维。
- `articles[1]` 取第 1 行(从 0 数),也就是《开发票指南》的向量 `[0.3 0.9 0.  0. ]`。`0.` 就是 0.0。
- `articles[1, 0]` 第 1 行第 0 列,0.3。numpy 用一个方括号里写逗号的方式取二维的格子,相当于列表的 `articles[1][0]`。
- `articles @ query` 表的每一行都和 `query` 做点积。第 0 行:0.9×0.8 + 0.2×0.1 + 0×0 + 0.1×0.4 = 0.72 + 0.02 + 0 + 0.04 = 0.78。第 1 行:0.24 + 0.09 + 0 + 0 = 0.33。第 2 行:0 + 0 + 0 + 0.04 = 0.04。结果 `[0.78 0.33 0.04]`。
- `np.linalg.norm(articles, axis=1)` `axis=1` 表示「沿着每一行的方向算」,每行各出一个长度。不写 `axis` 的话,numpy 会把整张表 12 个数当成一个向量算出一个数,这不是我们要的。第 0 行 `√(0.81 + 0.04 + 0 + 0.01) = √0.86 ≈ 0.9274`。
- `dists = np.linalg.norm(articles - query, axis=1)` 先看括号里的 `articles - query`:一张 `(3, 4)` 的表减一个 `(4,)` 的向量,numpy 会把 `query` 依次减到每一行上(这就是前面报错里提到的 broadcast 规则在起作用,今天只用这一种情况),得到三行差向量。再 `norm(..., axis=1)` 求每行差向量的长度,也就是每篇文章到问题的距离。这一行代替了 Day 213 里的整个 `for` 循环加 `math.dist`。
- `dists.round(4)` 数组的 `round` 方法,每一位保留 4 位小数。
- `np.argmin(dists)` 和 `argmax` 相反,返回最小值的下标。距离最小的是第 0 个。
- `titles[best]` 拿下标回 `titles` 里查标题。

</div>

```bash
uv run python part04/np_table.py
```

真实输出:

```text
articles.shape: (3, 4)
第 1 行: [0.3 0.9 0.  0. ]
第 1 行第 0 列: 0.3
每篇和问题的点积: [0.78 0.33 0.04]
每篇的长度: [0.92736185 0.9486833  0.90553851]
每篇到问题的距离: [0.3317 1.0247 1.245 ]
最近的是: 退款政策
```

三个距离 0.3317、1.0247、1.245 和 Day 213 的 `nearest.py` 一模一样,只是这次没写一行循环。点积那一行也值得看一眼:0.78、0.33、0.04,点积越大的越相关,排序和距离正好相反(距离越小越相关)。明天你会看到,把点积再除以两个长度,就得到了余弦相似度。

这里也是今天两个概念合起来的样子:ndarray 负责把一堆向量存成一张表,向量化运算负责对整张表一次算完。Day 225 建索引时,整个知识库的向量就是这样一张 `(段数, 1024)` 的大表,存进一个 `.npy` 文件。

## 动手练习

**练习 1:先猜再跑。** 不运行,先在纸上写出下面五行各打印什么,再新建 `part04/ex_predict.py` 跑一遍对答案。

```python
print([1, 2] * 3)
print(np.array([1, 2]) * 3)
print([1, 2] + [3, 4])
print(np.array([1, 2]) + np.array([3, 4]))
print(np.array([1, 2]) * np.array([3, 4]))
```

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_predict.py
import numpy as np

print([1, 2] * 3)
print(np.array([1, 2]) * 3)
print([1, 2] + [3, 4])
print(np.array([1, 2]) + np.array([3, 4]))
print(np.array([1, 2]) * np.array([3, 4]))
```

<div class="line-notes">

- `print([1, 2] * 3)` 列表乘整数是重复三遍。
- `print(np.array([1, 2]) * 3)` 数组乘一个数是每一位乘 3。
- `print([1, 2] + [3, 4])` 列表相加是拼接。
- `print(np.array([1, 2]) + np.array([3, 4]))` 数组相加是逐位相加,1+3、2+4。
- `print(np.array([1, 2]) * np.array([3, 4]))` 数组相乘是逐位相乘,1×3、2×4,不是点积。

</div>

```bash
uv run python part04/ex_predict.py
```

真实输出:

```text
[1, 2, 1, 2, 1, 2]
[3 6]
[1, 2, 3, 4]
[4 6]
[3 8]
```

注意第二、四、五行没有逗号也没有小数点,因为 `np.array([1, 2])` 的 dtype 是 `int64`。

</details>

**练习 2:用 numpy 重写 Day 213 的 `distance`。** 写 `np_distance(a, b)`,不许用 `np.linalg.norm`,只用减法、乘法、`.sum()` 和 `np.sqrt`;形状不同时抛 `ValueError` 并说清两边的形状。用猫、狗、汽车测试,和 `math.dist`、`np.linalg.norm` 对账。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_np_distance.py
import math

import numpy as np


def np_distance(a: np.ndarray, b: np.ndarray) -> float:
    if a.shape != b.shape:
        raise ValueError(f"形状不同: {a.shape} 和 {b.shape}")
    diff = a - b
    return float(np.sqrt((diff * diff).sum()))


cat = np.array([0.9, 0.1])
dog = np.array([0.85, 0.15])
car = np.array([0.05, 0.95])

print("猫-狗:", round(np_distance(cat, dog), 4))
print("猫-汽车:", round(np_distance(cat, car), 4))
print("对账 math.dist:", round(math.dist(cat.tolist(), car.tolist()), 4))
print("对账 norm:", round(float(np.linalg.norm(cat - car)), 4))

try:
    np_distance(cat, np.array([0.9, 0.1, 0.3]))
except ValueError as e:
    print("报错:", e)
```

<div class="line-notes">

- `def np_distance(a: np.ndarray, b: np.ndarray) -> float:` 参数类型写 `np.ndarray`,编辑器就知道它们有 `.shape`、`.sum()` 这些属性。
- `if a.shape != b.shape:` 自己先检查形状。numpy 本身也会报错,但自己写的报错信息更好读,别人一看就知道是向量维度问题。
- `raise ValueError(f"形状不同: {a.shape} 和 {b.shape}")` [Day 36](/blog/agent-zero/day-036-exceptions-2/) 学的主动抛异常。
- `diff = a - b` 逐位相减。猫和汽车得 `[0.85, -0.85]`。
- `return float(np.sqrt((diff * diff).sum()))` 逐位平方、求和得 1.445、开根号得 1.2021,最后转成普通 `float`。对照 Day 213 的 `for` 循环版,四行循环变成了一行。
- `math.dist(cat.tolist(), car.tolist())` 标准库版本,先转回列表再传。
- `np_distance(cat, np.array([0.9, 0.1, 0.3]))` 故意传一个三维的,看自己写的报错。

</div>

```bash
uv run python part04/ex_np_distance.py
```

真实输出:

```text
猫-狗: 0.0707
猫-汽车: 1.2021
对账 math.dist: 1.2021
对账 norm: 1.2021
报错: 形状不同: (2,) 和 (3,)
```

三种算法完全一致。

</details>

**练习 3:手算点积和范数。** `u = (3, 0, 4)`,`v = (1, 2, 2)`。手算 `u · v`、`|u|`、`|v|`,再算 `|2u|`(u 每一位乘 2 以后的长度)。然后用 numpy 验算。

<details><summary>参考答案</summary>

手算:`u · v = 3×1 + 0×2 + 4×2 = 3 + 0 + 8 = 11`;`|u| = √(9 + 0 + 16) = 5`;`|v| = √(1 + 4 + 4) = 3`;`2u = (6, 0, 8)`,`|2u| = √(36 + 64) = 10`,正好是 `|u|` 的两倍。向量乘几倍,长度就变几倍,方向不变,这一点明天很关键。

```python
# agent-zero-lab/part04/ex_dot_hand.py
import numpy as np

u = np.array([3.0, 0.0, 4.0])
v = np.array([1.0, 2.0, 2.0])
print("u @ v =", u @ v)
print("|u| =", np.linalg.norm(u))
print("|v| =", np.linalg.norm(v))
print("|2u| =", np.linalg.norm(2 * u))
```

<div class="line-notes">

- `u = np.array([3.0, 0.0, 4.0])` 写成小数,dtype 就是 `float64`。
- `u @ v` 点积,应为 11。
- `np.linalg.norm(u)` u 的长度,应为 5。
- `np.linalg.norm(v)` v 的长度,应为 3。
- `np.linalg.norm(2 * u)` 先把 u 每位乘 2 得 `[6. 0. 8.]`,再求长度,应为 10。

</div>

```bash
uv run python part04/ex_dot_hand.py
```

真实输出:

```text
u @ v = 11.0
|u| = 5.0
|v| = 3.0
|2u| = 10.0
```

</details>

**练习 4:取前两名。** 把 `np_table.py` 的问题换成「发票抬头写错了想重开」,向量用 `(0.2, 0.8, 0.0, 0.3)`(和 Day 213 练习 4 一样),打印最近的两篇和各自距离。提示:`np.argsort` 返回「从小到大排好序的下标」。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_top2.py
import numpy as np

titles = ["退款政策", "开发票指南", "重置密码"]
articles = np.array([
    [0.9, 0.2, 0.0, 0.1],
    [0.3, 0.9, 0.0, 0.0],
    [0.0, 0.0, 0.9, 0.1],
])
query = np.array([0.2, 0.8, 0.0, 0.3])

dists = np.linalg.norm(articles - query, axis=1)
order = np.argsort(dists)
print("距离:", dists.round(4))
print("从近到远的下标:", order)
for i in order[:2]:
    print(f"  {titles[i]}  {dists[i]:.4f}")
```

<div class="line-notes">

- `query = np.array([0.2, 0.8, 0.0, 0.3])` 发票问题的向量。
- `dists = np.linalg.norm(articles - query, axis=1)` 一次算出三篇的距离。
- `order = np.argsort(dists)` 距离是 `[0.9434, 0.3317, 1.2369]`,最小的在下标 1、其次下标 0、最大下标 2,所以 `order` 是 `[1 0 2]`。相当于 JS 里先 `indices.sort((i, j) => dists[i] - dists[j])`。
- `for i in order[:2]:` 只取前两个下标。
- `print(f"  {titles[i]}  {dists[i]:.4f}")` 用下标同时去查标题和距离。

</div>

```bash
uv run python part04/ex_top2.py
```

真实输出:

```text
距离: [0.9434 0.3317 1.2369]
从近到远的下标: [1 0 2]
  开发票指南  0.3317
  退款政策  0.9434
```

和 Day 213 练习 4 的 `nearest_k` 结果一模一样:0.3317 和 0.9434。这就是 Day 226 做 top-k 检索时的写法。

</details>

**练习 5(观察题):知识库变大十倍。** 把 `np_speed.py` 另存为 `part04/ex_speed_20k.py`,只改一行 `N = 20000`,跑一次。for 循环和 numpy 各花了多久?

<details><summary>参考答案</summary>

```bash
sed -e 's/^N = 2000/N = 20000/' part04/np_speed.py > part04/ex_speed_20k.py
uv run python part04/ex_speed_20k.py
```

`sed` 那一行是 [Day 5](/blog/agent-zero/day-005-terminal-3/) 那种「命令 + 重定向」的写法:把 `N = 2000` 换成 `N = 20000`,结果写进新文件。不想用 `sed` 就复制文件后手改那一行。

我这边的真实输出:

```text
20000 个 1024 维向量,各和 query 算一次点积
for 循环: 2903.7 ms
numpy:    11.1 ms
快了约 262 倍
两边结果最大差: 8.526512829121202e-13
点积最大的是第 16278 个
```

for 循环要将近 3 秒,numpy 只要 11 毫秒。用户每问一句都要等 3 秒,还没算调模型的时间,这在产品里是不能接受的。numpy 的 11 毫秒对两万段文档已经够用,再往上到几十万、几百万段,就要靠 Day 217 之后的向量库和 HNSW 索引了。

</details>

**验收标准:** 练习 1 五行全部猜对;能说清 `cat.shape` 为什么是 `(2,)`、`articles.shape` 为什么是 `(3, 4)`;能不看文章写出 `a @ b` 和 `np.linalg.norm(a)` 并手算验证;`np_speed.py` 在你电脑上跑出两边结果最大差在 `1e-12` 量级以下。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| numpy | Python 做数字运算的标准第三方库,`import numpy as np` |
| ndarray | numpy 的数组类型,元素类型相同、内存连续。类似 JS 的 `Float64Array` |
| shape(形状) | 数组每个方向有几个元素,一个元组。1024 维向量是 `(1024,)`,3 篇 4 维文章是 `(3, 4)` |
| ndim | 数组有几个方向(轴)。一排是 1,一张表是 2。和「向量的维度」不是一回事 |
| dtype | 数组元素的类型,如 `float64`、`int64`,建好就固定 |
| 向量化运算 | 写一个运算,作用到数组每一个元素上,如 `a + b`、`a * 2`,由底层 C 循环完成 |
| 点积(dot product) | 两个等长向量对应位相乘再求和,得一个数。`a @ b` 或 `np.dot(a, b)` |
| 范数(norm) | 这里指 L2 范数,即向量长度:平方和开根号。`np.linalg.norm(a)` |
| `@` | Python 的矩阵乘法运算符。一维 `@` 一维是点积;二维表 `@` 一维向量是每一行和它做点积 |
| `axis=1` | 「沿每一行算」,每行出一个结果 |
| `argmin` / `argmax` / `argsort` | 返回最小值的下标、最大值的下标、从小到大排序后的下标 |
| broadcast(广播) | numpy 对齐两个不同形状数组的规则。今天只用到「数组和单个数」「表和一行向量」两种 |

## 常见误区

**以为 `a * b` 就是点积。** numpy 里 `a * b` 是逐位相乘,结果还是一个数组。点积要再 `.sum()`,或者直接写 `a @ b`。我第一次写余弦时就是少了 `.sum()`,得到一个数组,后面除法照样能算,最后出来一个数组形状的「相似度」,半天没看出问题。

**把列表当数组用。** 列表的 `+` 是拼接,`* 2` 是重复,和 numpy 完全不同。从 `json.load` 读回来的向量是普通列表,忘了 `np.array(...)` 就直接做加减,不会报错,只会得到奇怪的结果。

**搞混「1024 维向量」和「一维数组」。** 一个 1024 维的向量就是一个 shape 为 `(1024,)` 的一维数组。看 shape 比听口头说法可靠。

**用 `np.array([0, 0, 0])` 建一个准备装小数的数组。** 它是整数数组,塞进去的小数会被截断而且不报错,`np_pitfalls.py` 里的 0.5 变 0 就是现场。用 `np.zeros(3)` 或者写成 `[0.0, 0.0, 0.0]`。

**对二维表求范数忘了 `axis=1`。** `np.linalg.norm(articles)` 会把整张表当成一个长向量,返回一个数而不是每篇一个长度。结果形状不对时先打印 `.shape` 看一眼。

**把 numpy 数字直接塞进 JSON。** `np.float32` 会让 `json.dumps` 报 `not JSON serializable`,`np.float64` 打印出来又带着 `np.float64(...)` 外壳。存文件、回给前端之前,先 `float()` 或 `.tolist()`。

**测速只跑一次就下结论。** `np_speed.py` 三次里 for 循环的耗时从 196 到 378 毫秒不等。性能数字至少跑三次,写范围,不要只挑最好看的那次。

## 学习资料

### 文档与文章

- [NumPy: the absolute basics for beginners](https://numpy.org/doc/stable/user/absolute_beginners.html):官方的入门页,英文但很浅。今天只看「What is an array?」「How to create a basic array」「Basic array operations」三小节,半小时。
- [NumPy quickstart](https://numpy.org/doc/stable/user/quickstart.html):官方快速上手,看「The Basics」和「Basic Operations」,里面有 `*` 和 `@` 的区别示例,和今天讲的完全对得上。
- [numpy.linalg.norm 文档](https://numpy.org/doc/stable/reference/generated/numpy.linalg.norm.html):看 `axis` 参数的说明和页面底部的例子,明白「不写 axis」和「axis=1」的差别。
- [numpy.matmul 文档](https://numpy.org/doc/stable/reference/generated/numpy.matmul.html):`@` 对应的函数。只看开头「一维和二维时分别怎么算」那几条。
- [Broadcasting](https://numpy.org/doc/stable/user/basics.broadcasting.html):今天不要求看懂,先收藏。等你哪天看到 `could not be broadcast together` 不知道为什么时再来。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Wy4y1h7ii&autoplay=0&high_quality=1" title="一个10分钟的numpy入门教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Ross-Ning · 一个10分钟的numpy入门教程 · 9 分钟,建数组、shape、逐位运算、点积一口气过一遍,节奏快,适合做完今天的脚本后当复习看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Ex411L7oT&p=3&autoplay=0&high_quality=1" title="【莫烦Python】Numpy & Pandas (数据处理教程) - 2.1 numpy 属性" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>莫烦Python · 【莫烦Python】Numpy & Pandas (数据处理教程) · 只看第 3–6P(2.1 numpy 属性、2.2 创建 array、2.3 和 2.4 基础运算),合计约 45 分钟。视频是 2017 年的,但这几集讲的东西 numpy 2 没变;第 7P 以后和 pandas 部分今天跳过。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/QUT1VHiLmmI" title="Python NumPy Tutorial for Beginners" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>freeCodeCamp.org · Python NumPy Tutorial for Beginners · Keith Galli 讲的一小时入门,开头几分钟专门讲「为什么 numpy 比列表快」(连续内存、固定类型),和今天那张图是一个意思,看到「Basic Mathematics」那段为止就够了。</figcaption>
</figure>

### 书籍

- Wes McKinney《Python for Data Analysis》第 3 版(O'Reilly,2022),作者把全书免费放在 [wesmckinney.com/book](https://wesmckinney.com/book/)。第 4 章「NumPy Basics: Arrays and Vectorized Computation」的前两节,正好就是今天的 ndarray 和向量化运算。中文版《利用 Python 进行数据分析(原书第 2 版)》(徐敬一译,机械工业出版社,2018)对应的也是第 4 章,版本旧一点但这部分内容没变。
- Jake VanderPlas《Python Data Science Handbook》(O'Reilly),第 1 版全文免费在 [jakevdp.github.io/PythonDataScienceHandbook](https://jakevdp.github.io/PythonDataScienceHandbook/)。第 2 章「Introduction to NumPy」里「Computation on NumPy Arrays: Universal Functions」一节,开头就是一个「循环慢在哪里」的实测,和今天的 `np_speed.py` 思路一样。

### 开源项目与代码

- [numpy/numpy](https://github.com/numpy/numpy):源码仓库。不用读源码,看一眼 README 和语言比例(大量 C 代码)就明白「底层 C 循环」不是一句空话。
- [rougier/numpy-100](https://github.com/rougier/numpy-100):100 道 numpy 练习题,从易到难。前 20 题里挑和「建数组、逐位运算、点积、范数」有关的做几道就够,后面的题和我们无关。

## 自测

**1. `np.array([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]])` 的 shape 是多少?它可以理解成几个几维的向量?**

<details><summary>答案</summary>

shape 是 `(3, 2)`:3 行 2 列,可以理解成 3 个二维向量叠在一起。它的 `ndim` 是 2(一张表),但每个向量是二维的(2 个数)。

</details>

**2. `a = np.array([1.0, 2.0, 3.0])`、`b = np.array([4.0, 5.0, 6.0])`,`a * b` 和 `a @ b` 分别是什么?**

<details><summary>答案</summary>

`a * b` 是逐位相乘的数组 `[4. 10. 18.]`;`a @ b` 是点积,4 + 10 + 18 = 32.0,一个数。

</details>

**3. 手算 `(2, 3, 6)` 的长度。**

<details><summary>答案</summary>

4 + 9 + 36 = 49,√49 = 7。

</details>

**4. 为什么 numpy 算 2000 个 1024 维向量的点积比 Python `for` 循环快一两百倍?说两点原因。**

<details><summary>答案</summary>

第一,ndarray 里的数字类型相同、在内存里连续排放,底层 C 循环可以直接一个接一个读,不用像列表那样顺着指针找到每个散落的数字对象。第二,`for` 循环每一圈都要回到 Python 解释器查类型、找运算、创建结果对象,numpy 把整个循环交给编译好的 C 代码一次跑完,这部分开销被省掉了。加法本身并没有变快。

</details>

**5. 面试题:「检索服务上线后 P95 延迟很高,排查发现相似度是用 Python 列表循环算的。你怎么改?改完还慢怎么办?」**

<details><summary>答案</summary>

先把所有文档向量一次性载入成一个 `(段数, 维度)` 的 numpy 数组常驻内存,查询时用一次 `docs @ query`(向量提前归一化的话就是余弦)加 `argsort` 或 `argpartition` 取 top-k,不在请求里做 Python 循环,也不在每次请求里重新读文件或重新转数组。按今天的实测,两千段从一两百毫秒降到一两毫秒。如果文档量继续涨到几十万、上百万,暴力计算本身也会变慢、内存也吃紧,就换成带近似最近邻索引的向量库(比如 pgvector 的 HNSW),用一点召回率换速度。改之前改之后都要用同一批查询压测、看 P95,而不是只跑一次。

</details>

## 明天预告

明天是 [Day 215 · 余弦相似度:手算一遍](/blog/agent-zero/day-215-cosine/)。今天的两个零件已经备好:`(1, 2, 2)` 和 `(2, 1, 2)` 的点积是 8,两者长度都是 3。余弦相似度就是 8 ÷ (3 × 3)。明天先在纸上把它手算熟,再用 numpy 验算,并且解决 Day 213 留下的那个「长退款文章反而离得远」的问题,顺带学会把向量长度统一成 1 的「归一化」。
