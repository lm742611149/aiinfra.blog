---
title: 'Day 213 · 向量是什么:先从二维说起'
description: '把「意思像不像」变成「离得近不近」的第一步:向量就是一串有顺序的数字。今天在纸上和终端里画几个二维点,手算两点之间的距离,再用手工编的四维向量给 CloudLedger 的客服问题找最近的帮助文章。'
pubDate: 2026-10-22
regime: none
tags: ['vector', 'distance', 'rag', 'python', 'agent-zero']
series: 'agent-zero'
day: 213
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 212](/blog/agent-zero/day-212-why-vectors/) 我们拿 CloudLedger 帮助中心的几篇文章做了一回关键词搜索,结果很难看:客户问「买错了能把钱要回来吗」,《退款政策》那篇一个字都对不上,`grep` 返回空。人一眼就知道这两句话说的是一件事,程序却只会逐字比对。

那天结尾留了一个方向:如果能把每段文字变成一个「位置」,意思相近的文字位置也相近,那么「找相关文章」就变成「找离问题最近的那个点」。今天先把「位置」这件事本身弄懂。它在数学里叫向量,我们从最简单的二维开始,不碰任何模型,也不花一分钱。

## 今天要解决的问题

学完今天,你应该能做到下面四件事,每一件都能自己验证:

1. 用自己的话说清楚向量是什么:一串有顺序的数字,可以看成平面上的一个点,也可以看成从原点出发的一个箭头;能说出一个向量的维度是几。
2. 在 Python 里用元组表示向量,取出某一维,在终端里把几个二维点画出来。
3. 不用电脑手算两个点之间的距离(勾股定理那套),再写一个 `distance` 函数和标准库 `math.dist` 对上账。
4. 用手工编的四维向量,给两个客服问题各找出离它最近的帮助文章,并说出「只看距离」会在哪里出问题(这是 Day 215 余弦相似度要解决的)。

预计用时 2 小时:前 40 分钟在纸上画点、手算,剩下的时间写 5 个小脚本和做练习。前置:[Day 22](/blog/agent-zero/day-022-tuples-unpack/) 元组和解包、[Day 24](/blog/agent-zero/day-024-dicts/) 字典和 `.items()`、[Day 28](/blog/agent-zero/day-028-functions-1/) 函数、[Day 212](/blog/agent-zero/day-212-why-vectors/) 关键词搜索为什么不够。

学法还是老规矩:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `distance` 函数和 `nearest.py` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 从「意思」到「位置」:一张手工摆的词地图

先离开电脑,拿一张纸。画一个横轴,写上「像动物」,画一个竖轴,写上「像交通工具」,两根轴都从 0 到 1。

现在给几个词找位置。「猫」非常像动物,一点都不像交通工具,我们放在往右 0.9、往上 0.1 的地方。「狗」也差不多,放在 0.85 和 0.15。「汽车」反过来,几乎不像动物,非常像交通工具,放在 0.05 和 0.95。「马」有意思,它是动物,但古代人骑着它赶路,所以两边都沾一点,放在 0.7 和 0.5。

这几个数是我拍脑袋定的,没有任何模型参与。但你看纸上的样子:猫和狗挤在右下角,汽车孤零零在左上角,马在中间偏右。只要位置摆得合理,「意思像不像」就变成了「在纸上离得近不近」,而后者是计算机最擅长算的东西之一。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="二维平面上猫、狗、马、汽车四个词的位置,猫和狗挨得很近,汽车在另一头">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<line x1="80" y1="260" x2="600" y2="260" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="80" y1="260" x2="80" y2="30" stroke="var(--rule)" stroke-width="1.5"/>
<text x="600" y="282" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)" text-anchor="end">像动物 →</text>
<text x="88" y="38" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">↑ 像交通工具</text>
<text x="70" y="276" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">0</text>
<line x1="80" y1="260" x2="548" y2="237" stroke="var(--mem)" stroke-width="2"/>
<line x1="80" y1="260" x2="522" y2="226" stroke="var(--mem)" stroke-width="2"/>
<line x1="80" y1="260" x2="444" y2="145" stroke="var(--ink-faint)" stroke-width="1.5" stroke-dasharray="4 3"/>
<line x1="80" y1="260" x2="106" y2="41" stroke="var(--compute)" stroke-width="2"/>
<circle cx="548" cy="237" r="5" fill="var(--mem)"/>
<circle cx="522" cy="226" r="5" fill="var(--mem)"/>
<circle cx="444" cy="145" r="5" fill="var(--ink-soft)"/>
<circle cx="106" cy="41" r="5" fill="var(--compute)"/>
<text x="556" y="252" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">猫 (0.9, 0.1)</text>
<text x="470" y="214" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">狗 (0.85, 0.15)</text>
<text x="452" y="140" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">马 (0.7, 0.5)</text>
<text x="116" y="46" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">汽车 (0.05, 0.95)</text>
<text x="200" y="200" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">每个词既是一个点,也是一根从原点出发的箭头</text>
</svg>
<figcaption>手工摆的二维「词地图」。点的位置就是两个数字;从原点画一根线到这个点,就是同一个向量的箭头画法。</figcaption>
</figure>

真正的 embedding 模型(Day 217 会调一个)做的事情本质上一样,只是有两点不同。第一,它不是 2 个数,而是几百到几千个数;第二,每个数代表什么不是人定的,是模型在海量文本上训练出来的,你没法指着第 387 个数说「这代表退款」。但「意思近,位置近」这个结论是一样的。所以今天先在二维里把直觉练熟,高维只是同样的算法多做几次加法。

## 向量就是一串有顺序的数字

刚才纸上每个词对应的那两个数,写在一起就是一个**向量**(vector)。`(0.9, 0.1)` 是猫的向量,`(0.05, 0.95)` 是汽车的向量。

从前端的角度看,向量就是一个只装数字的数组,`[0.9, 0.1]`。它有两种画法,你会在不同资料里看到:画成一个点(在哪儿),或者画成从原点出发指向那个点的箭头(往哪个方向、走多远)。两种画法是同一个东西,今天算距离时把它当点看,Day 215 算余弦时把它当箭头看。

向量里数字的个数叫**维度**(dimension)。`(0.9, 0.1)` 是二维向量,`(1, 2, 2)` 是三维,bge-m3 模型给一句话输出的向量是 1024 维,也就是 1024 个数。

有一点前端同学一开始容易忽略:向量的顺序是有意义的。`(0.9, 0.1)` 和 `(0.1, 0.9)` 是两个完全不同的向量,前者是「很像动物」,后者是「很像交通工具」。这和 JS 的对象不一样,对象 `{animal: 0.9, vehicle: 0.1}` 的键换个顺序没关系,向量没有键,全靠位置说话。所以拿两个向量比较之前,必须保证它们的每一维代表同一件事,这一点后面会变成一条硬规矩:**同一个模型出来的向量才能互相比**。

在 Python 里,我们先用元组(tuple)装向量。[Day 22](/blog/agent-zero/day-022-tuples-unpack/) 讲过,元组像一个不能改的数组,`(0.9, 0.1)` 建好以后不能 `append` 也不能改某一项,正适合表示「一个固定的位置」。在 `agent-zero-lab` 根目录下新建 `part04/vec_basics.py`(`part04/` 目录 Day 212 已经建好;没有的话先 `mkdir part04`):

```python
# agent-zero-lab/part04/vec_basics.py
cat = (0.9, 0.1)
dog = (0.85, 0.15)
car = (0.05, 0.95)

print("猫的向量:", cat)
print("维度:", len(cat))
print("第 0 维(像动物):", cat[0])
print("第 1 维(像交通工具):", cat[1])

swapped = (cat[1], cat[0])
print("把两维对调:", swapped, "和猫相等吗?", swapped == cat)

words = {"猫": cat, "狗": dog, "汽车": car}
for name, (x, y) in words.items():
    print(f"{name}: 往右 {x},往上 {y}")
```

<div class="line-notes">

- `# agent-zero-lab/part04/vec_basics.py` 第一行注释写完整路径,告诉你这个文件放哪。今天所有脚本都在 `part04/` 下,都从 `agent-zero-lab` 根目录运行。
- `cat = (0.9, 0.1)` 一个二维向量,用元组装。相当于 JS 的 `const cat = [0.9, 0.1]`,只是 Python 元组建好就不能改。两个数分别是「像动物」0.9 和「像交通工具」0.1。
- `dog = (0.85, 0.15)` 狗的位置,和猫只差 0.05,纸上几乎挨着。
- `car = (0.05, 0.95)` 汽车在另一头。
- `print("维度:", len(cat))` 维度就是数字的个数,`len` 相当于 JS 的 `.length`。这里输出 `2`。
- `cat[0]` 取第 0 维,下标从 0 开始,和 JS 一样。输出 `0.9`。
- `cat[1]` 取第 1 维,输出 `0.1`。
- `swapped = (cat[1], cat[0])` 把两维对调,得到 `(0.1, 0.9)`。数字还是那两个,意思完全变了。
- `swapped == cat` 元组用 `==` 比较时逐位比,`(0.1, 0.9)` 和 `(0.9, 0.1)` 第 0 位就不同,所以是 `False`。顺序有意义,就体现在这里。
- `words = {"猫": cat, "狗": dog, "汽车": car}` 一个字典,键是词,值是它的向量。后面找最近邻都用这种「名字 → 向量」的结构。
- `for name, (x, y) in words.items():` `.items()` 每次给出一个 `(键, 值)`,值本身又是一个二元组,所以写成 `name, (x, y)` 一次解包两层。相当于 JS 的 `for (const [name, [x, y]] of Object.entries(words))`。第一轮 `name` 是 `"猫"`,`x` 是 `0.9`,`y` 是 `0.1`。
- `print(f"{name}: 往右 {x},往上 {y}")` f-string 相当于 JS 模板字符串,第一轮打印 `猫: 往右 0.9,往上 0.1`。

</div>

在 `agent-zero-lab` 目录下运行:

```bash
cd agent-zero-lab
uv run python part04/vec_basics.py
```

我这边的真实输出:

```text
猫的向量: (0.9, 0.1)
维度: 2
第 0 维(像动物): 0.9
第 1 维(像交通工具): 0.1
把两维对调: (0.1, 0.9) 和猫相等吗? False
猫: 往右 0.9,往上 0.1
狗: 往右 0.85,往上 0.15
汽车: 往右 0.05,往上 0.95
```

这一步只有一个新东西:**向量 = 有顺序的一串数**,维度 = 有几个数。其余都是前面学过的元组、字典和 f-string。

## 在终端里把点画出来

纸上画过一遍了,再让程序画一遍。不装任何画图库,就用字符拼一个 11×11 的格子,每个点在哪个格子里,就把那一格换成词的第一个字。这么做的好处是你能看清「数字 → 格子坐标」这个换算,画图库会把它藏起来。

新建 `part04/plot_points.py`:

```python
# agent-zero-lab/part04/plot_points.py
words = {
    "猫": (0.9, 0.1),
    "狗": (0.85, 0.15),
    "马": (0.7, 0.5),
    "汽车": (0.05, 0.95),
}

SIZE = 11
grid = [["." for _ in range(SIZE)] for _ in range(SIZE)]

for name, (x, y) in words.items():
    col = round(x * (SIZE - 1))
    row = SIZE - 1 - round(y * (SIZE - 1))
    grid[row][col] = name[0]
    print(f"{name} ({x}, {y}) -> 第 {row} 行第 {col} 列")

print()
for line in grid:
    print(" ".join(line))
```

<div class="line-notes">

- `words = {` 四个词和它们的二维向量,数字和上面的图一致。
- `SIZE = 11` 格子是 11 行 11 列。为什么是 11 不是 10:坐标从 0 到 1,我们想让 0、0.1、0.2……1.0 这 11 个刻度各占一格。
- `grid = [["." for _ in range(SIZE)] for _ in range(SIZE)]` 两层列表推导式([Day 23](/blog/agent-zero/day-023-comprehensions/)),造出 11 个列表,每个列表里 11 个 `"."`。相当于 JS 的 `Array.from({length: 11}, () => Array(11).fill("."))`。`_` 表示这个循环变量用不到。
- `for name, (x, y) in words.items():` 和上一个脚本一样两层解包。
- `col = round(x * (SIZE - 1))` 横坐标换成第几列。猫的 `x` 是 0.9,`0.9 × 10 = 9.0`,四舍五入得 9。狗是 `0.85 × 10 = 8.5`,`round(8.5)` 得 **8** 不是 9,因为 Python 的 `round` 遇到正好 .5 时取偶数(银行家舍入),和 JS 的 `Math.round(8.5)` 得 9 不一样。这里差一格无所谓,算钱的时候要当心。
- `row = SIZE - 1 - round(y * (SIZE - 1))` 纵坐标要倒过来:屏幕上第 0 行在最上面,而数学里 y 越大越靠上。猫的 `y` 是 0.1,`round(1.0)` 是 1,`10 - 1 = 9`,在第 9 行,也就是倒数第二行。汽车的 `y` 是 0.95,`0.95 × 10` 在浮点数里算出来是 9.5,`round` 得 10,`10 - 10 = 0`,在最上面一行。
- `grid[row][col] = name[0]` 把那一格换成词的第一个字。「汽车」只放得下一个字,所以放「汽」。
- `print(f"{name} ({x}, {y}) -> 第 {row} 行第 {col} 列")` 把换算结果打出来,方便你对账。
- `for line in grid:` 一行一行打印格子。
- `print(" ".join(line))` 把这一行的 11 个字符用空格连起来,相当于 JS 的 `line.join(" ")`。

</div>

```bash
uv run python part04/plot_points.py
```

真实输出:

```text
猫 (0.9, 0.1) -> 第 9 行第 9 列
狗 (0.85, 0.15) -> 第 8 行第 8 列
马 (0.7, 0.5) -> 第 5 行第 7 列
汽车 (0.05, 0.95) -> 第 0 行第 0 列

汽 . . . . . . . . . .
. . . . . . . . . . .
. . . . . . . . . . .
. . . . . . . . . . .
. . . . . . . . . . .
. . . . . . . 马 . . .
. . . . . . . . . . .
. . . . . . . . . . .
. . . . . . . . 狗 . .
. . . . . . . . . 猫 .
. . . . . . . . . . .
```

图有点歪,这是因为汉字在终端里占两个英文字符宽,它所在那一行后面的点会被往右挤一格。不影响我们看大局:猫狗挨着在右下,汽车在左上角,马在中间。

如果你更习惯在浏览器里看,练习 3 会让你用 Python 拼一个 SVG 文件出来,双击就能在浏览器里打开,前端同学会觉得很亲切。

## 两点之间的距离:还是那个勾股定理

「挨得近」得变成一个数,程序才能比较。最常用的就是你初中学过的直线距离:两个点之间拉一根直线,量它有多长。数学上叫**欧氏距离**(Euclidean distance),也常写作 L2 距离。

先手算一个最经典的。点 A 在 `(0, 0)`,点 B 在 `(3, 4)`。从 A 到 B,横着走了 3,竖着走了 4,这两段和 AB 那根线正好围成一个直角三角形,AB 是斜边。勾股定理说斜边的平方等于两条直角边的平方和,所以距离是 `√(3² + 4²) = √(9 + 16) = √25 = 5`。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="用勾股定理算两点距离:横向差3,纵向差4,斜边距离5">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<line x1="100" y1="220" x2="340" y2="220" stroke="var(--compute)" stroke-width="2"/>
<line x1="340" y1="220" x2="340" y2="40" stroke="var(--compute)" stroke-width="2"/>
<line x1="100" y1="220" x2="340" y2="40" stroke="var(--mem)" stroke-width="2.5"/>
<rect x="328" y="208" width="12" height="12" fill="none" stroke="var(--ink-faint)"/>
<circle cx="100" cy="220" r="5" fill="var(--ink)"/>
<circle cx="340" cy="40" r="5" fill="var(--ink)"/>
<text x="70" y="244" fill="var(--ink)">A (0, 0)</text>
<text x="350" y="40" fill="var(--ink)">B (3, 4)</text>
<text x="200" y="240" fill="var(--compute)">横向差 3 - 0 = 3</text>
<text x="350" y="135" fill="var(--compute)">纵向差 4 - 0 = 4</text>
<text x="150" y="118" fill="var(--mem)">距离 = √(3² + 4²) = 5</text>
<text x="440" y="190" fill="var(--ink-soft)">N 维也一样:</text>
<text x="440" y="208" fill="var(--ink-soft)">每一维差一下、平方,</text>
<text x="440" y="226" fill="var(--ink-soft)">全加起来再开根号</text>
</g>
</svg>
<figcaption>欧氏距离就是勾股定理。三维多一条「前后差」,1024 维就多 1022 条,做法不变。</figcaption>
</figure>

把这个做法写成一句话:**每一维相减,平方,全部加起来,最后开平方根**。为什么要平方?因为差可能是负数(往左走了 0.3 就是 -0.3),平方以后都变成正的,不会互相抵消。

再手算一组今天的数据,猫 `(0.9, 0.1)` 和汽车 `(0.05, 0.95)`:

- 第 0 维差:0.9 - 0.05 = 0.85,平方是 0.7225
- 第 1 维差:0.1 - 0.95 = -0.85,平方也是 0.7225
- 加起来 1.445,开根号约等于 1.2021

猫和狗呢?两维的差分别是 0.05 和 -0.05,平方各是 0.0025,加起来 0.005,开根号约 0.0707。1.2 对 0.07,差了十几倍,「猫离狗近、离汽车远」变成了能比大小的数字。

现在写成代码。新建 `part04/distance.py`,自己写一个 `distance` 函数,再用 Python 标准库自带的 `math.dist` 对一下账:

```python
# agent-zero-lab/part04/distance.py
import math


def distance(a: tuple[float, ...], b: tuple[float, ...]) -> float:
    total = 0.0
    for x, y in zip(a, b, strict=True):
        diff = x - y
        total += diff * diff
    return math.sqrt(total)


print("3-4-5 三角形:", distance((0, 0), (3, 4)))

cat = (0.9, 0.1)
dog = (0.85, 0.15)
horse = (0.7, 0.5)
car = (0.05, 0.95)

print("猫-狗:", round(distance(cat, dog), 4))
print("猫-马:", round(distance(cat, horse), 4))
print("猫-汽车:", round(distance(cat, car), 4))
print("标准库 math.dist 猫-汽车:", round(math.dist(cat, car), 4))
```

<div class="line-notes">

- `import math` Python 自带的数学模块,不用 `uv add`。相当于 JS 里全局的 `Math` 对象,只是 Python 要先 import。
- `def distance(a: tuple[float, ...], b: tuple[float, ...]) -> float:` 类型标注 `tuple[float, ...]` 的意思是「任意长度、每一项都是 float 的元组」,`...` 就是「长度不限」([Day 46](/blog/agent-zero/day-046-type-hints-2/) 讲过容器类型)。这样二维、四维的向量都能传进来。相当于 TS 的 `(a: number[], b: number[]) => number`。
- `total = 0.0` 平方和从 0 开始累加。
- `for x, y in zip(a, b, strict=True):` `zip` 是今天新见到的内置函数:把两个序列「拉链」一样对齐,每次各取一个。`zip((0.9, 0.1), (0.05, 0.95))` 依次给出 `(0.9, 0.05)` 和 `(0.1, 0.95)`。`strict=True` 表示两边长度不一样就报错,不加的话会悄悄按短的那个截断,下一节会故意演示这个坑。
- `diff = x - y` 这一维的差。猫和汽车第一轮是 `0.9 - 0.05 = 0.85`,第二轮是 `0.1 - 0.95 = -0.85`。
- `total += diff * diff` 平方以后加进总数。两轮各加 0.7225,`total` 最后是 1.445。用 `diff * diff` 而不是 `diff ** 2`,两种都行,乘法读起来更直白。
- `return math.sqrt(total)` 开平方根,`math.sqrt(1.445)` 约等于 1.2021。相当于 JS 的 `Math.sqrt`。
- `distance((0, 0), (3, 4))` 先拿 3-4-5 三角形验一下函数写没写对,应该正好得到 `5.0`。
- `round(distance(cat, dog), 4)` 保留 4 位小数打印,不然会看到一长串 `0.07071067811865474`。
- `round(distance(cat, horse), 4)` 猫和马:差是 0.2 和 -0.4,平方和 0.2,开根号 0.4472。
- `math.dist(cat, car)` 标准库自带的欧氏距离,Python 3.8 起就有。自己写一遍是为了看清它在做什么,真用的时候直接用它就行。

</div>

```bash
uv run python part04/distance.py
```

真实输出:

```text
3-4-5 三角形: 5.0
猫-狗: 0.0707
猫-马: 0.4472
猫-汽车: 1.2021
标准库 math.dist 猫-汽车: 1.2021
```

手算的 1.2021 和 0.0707 都对上了,自己写的函数和标准库也一致。到这里,第二个新概念**距离**也有了:一个数,越小越近。

## 故意踩一次坑:维度对不上

前面说过,两个向量要比较,每一维得代表同一件事。最基本的前提是两边维度相同。现实里维度对不上的情况比你想的多,比如索引用的是 1024 维的模型,查询时不小心换成了 1536 维的模型。看看 Python 在这种时候会怎样。

新建 `part04/dim_mismatch.py`:

```python
# agent-zero-lab/part04/dim_mismatch.py
import math

a = (0.9, 0.1, 0.3)
b = (0.85, 0.15)

pairs = list(zip(a, b))
print("不加 strict 的 zip:", pairs)

try:
    list(zip(a, b, strict=True))
except ValueError as e:
    print("加了 strict:", e)

try:
    math.dist(a, b)
except ValueError as e:
    print("math.dist:", e)
```

<div class="line-notes">

- `a = (0.9, 0.1, 0.3)` 一个三维向量。
- `b = (0.85, 0.15)` 一个二维向量,故意少一维。
- `pairs = list(zip(a, b))` 不加 `strict`。`zip` 返回的是一个惰性对象(和 [Day 99](/blog/agent-zero/day-099-generators/) 的生成器类似),用 `list()` 把它展开成列表才能打印。
- `try:` [Day 35](/blog/agent-zero/day-035-exceptions-1/) 学的异常捕获,我们预料下面会报错,先接住它再打印报错原文。
- `list(zip(a, b, strict=True))` 加了 `strict`,长度不一致会抛 `ValueError`。
- `except ValueError as e:` 接住异常,`e` 就是那个异常对象,`print` 它会打出报错信息。
- `math.dist(a, b)` 标准库的距离函数自己会检查维度。

</div>

```bash
uv run python part04/dim_mismatch.py
```

真实输出:

```text
不加 strict 的 zip: [(0.9, 0.85), (0.1, 0.15)]
加了 strict: zip() argument 2 is shorter than argument 1
math.dist: both points must have the same number of dimensions
```

第一行最危险。不加 `strict` 的 `zip` 一声不吭地把 `a` 的第三维 0.3 扔掉了,只配了两对。如果你的 `distance` 函数里用的是这种 `zip`,算出来的距离是个看起来完全正常的数字,但它是错的,而且不会有任何报错提醒你。这就是为什么上面的 `distance` 一定要写 `strict=True`。

如果你不用 `try` 直接调 `math.dist((1, 2, 3), (1, 2))`,终端里看到的是完整的 traceback:

```text
Traceback (most recent call last):
  File "<string>", line 1, in <module>
ValueError: both points must have the same number of dimensions
```

读法和 Day 35 一样,看最后一行:异常类型 `ValueError`,原因是「两个点的维度必须相同」。以后在向量库里看到类似 `expected 1024 dimensions, not 1536` 的报错,就是同一件事。

## 从二维到四维:给客服问题找最近的文章

二维只是为了能画出来。算距离的公式对几维都一样,所以我们直接跳到四维,回到 CloudLedger 的场景。

假设(还是我手工编的)每段文字用四个数描述:和钱有关的程度、和发票有关的程度、和账号登录有关的程度、带不带情绪。三篇帮助文章和两个客户问题的向量如下:

| 文字 | 钱 | 发票 | 登录 | 情绪 |
| --- | --- | --- | --- | --- |
| 《退款政策》 | 0.9 | 0.2 | 0.0 | 0.1 |
| 《开发票指南》 | 0.3 | 0.9 | 0.0 | 0.0 |
| 《重置密码》 | 0.0 | 0.0 | 0.9 | 0.1 |
| 问:买错了能把钱要回来吗 | 0.8 | 0.1 | 0.0 | 0.4 |
| 问:登不上去了气死 | 0.0 | 0.0 | 0.8 | 0.9 |

注意「买错了能把钱要回来吗」这句话里一个「退款」都没有,Day 212 的 `grep` 对它束手无策。但只要它的向量被摆在「钱」这一维很高的位置,它就会离《退款政策》很近。这正是向量检索的核心想法,只不过今天这些数是我编的,Day 217 起由 embedding 模型来给。

新建 `part04/nearest.py`:

```python
# agent-zero-lab/part04/nearest.py
import math

# 四个维度:[和钱有关, 和发票有关, 和账号登录有关, 带不带情绪]
articles = {
    "退款政策": (0.9, 0.2, 0.0, 0.1),
    "开发票指南": (0.3, 0.9, 0.0, 0.0),
    "重置密码": (0.0, 0.0, 0.9, 0.1),
}

questions = {
    "买错了能把钱要回来吗": (0.8, 0.1, 0.0, 0.4),
    "登不上去了气死": (0.0, 0.0, 0.8, 0.9),
}

for q_text, q_vec in questions.items():
    print(f"问题:{q_text} {q_vec}")
    scored = [(math.dist(q_vec, a_vec), title) for title, a_vec in articles.items()]
    scored.sort()
    for d, title in scored:
        print(f"  {d:.4f}  {title}")
    print("  最近的是:", scored[0][1])
```

<div class="line-notes">

- `# 四个维度:` 写清每一维的含义。真实 embedding 没有这行注释可写,因为没人知道每一维代表什么。
- `articles = {` 三篇帮助文章,键是标题,值是四维向量。
- `questions = {` 两个客户问题,结构一样。
- `for q_text, q_vec in questions.items():` 外层循环每次处理一个问题。第一轮 `q_text` 是 `"买错了能把钱要回来吗"`,`q_vec` 是 `(0.8, 0.1, 0.0, 0.4)`。
- `scored = [(math.dist(q_vec, a_vec), title) for title, a_vec in articles.items()]` 列表推导式:对每篇文章算一次距离,得到 `(距离, 标题)` 的列表。第一轮算出来是 `[(0.3317, "退款政策"), (1.0247, "开发票指南"), (1.2450, "重置密码")]`(小数是四舍五入后的)。把距离放在元组第一位是有意的,下一行排序就靠它。
- `scored.sort()` 元组排序先比第一位,也就是先比距离,从小到大。相当于 JS 的 `scored.sort((p, q) => p[0] - q[0])`。这里本来就是这个顺序,第二个问题会被重排。
- `for d, title in scored:` 逐个打印。
- `print(f"  {d:.4f}  {title}")` `:.4f` 是 f-string 的格式说明,表示保留 4 位小数,相当于 JS 的 `d.toFixed(4)`。
- `print("  最近的是:", scored[0][1])` 排序后第 0 个就是最近的,`[1]` 取出它的标题。

</div>

```bash
uv run python part04/nearest.py
```

真实输出:

```text
问题:买错了能把钱要回来吗 (0.8, 0.1, 0.0, 0.4)
  0.3317  退款政策
  1.0247  开发票指南
  1.2450  重置密码
  最近的是: 退款政策
问题:登不上去了气死 (0.0, 0.0, 0.8, 0.9)
  0.8062  重置密码
  1.4595  退款政策
  1.5330  开发票指南
  最近的是: 重置密码
```

两个问题都找对了文章。拿第一行手算核一下:问题和《退款政策》四维的差是 -0.1、-0.1、0、0.3,平方是 0.01、0.01、0、0.09,加起来 0.11,`√0.11 ≈ 0.3317`,对上了。

这就是 RAG 里「检索」那一步最朴素的样子:问题变成向量,文章变成向量,挨个算距离,取最近的。后面 pgvector、HNSW 那些东西,本质上都是在让「挨个算」变快。

## 只看距离,会在哪里栽跟头

再看一眼第二个问题。「登不上去了气死」找到了《重置密码》,但距离是 0.8062,比第一个问题的 0.3317 大了一倍多。原因在「情绪」那一维:问题是 0.9,文章只有 0.1,光这一维就贡献了 0.64 的平方差。客户的火气和他要找的内容没关系,却把距离拉大了。

这还算小事,更麻烦的是长度。我们回到二维,做一个对比。新建 `part04/length_problem.py`:

```python
# agent-zero-lab/part04/length_problem.py
import math

refund_short = (0.9, 0.1)
refund_long = (1.8, 0.2)
invoice = (0.5, 0.6)

print("短退款的长度:", round(math.hypot(*refund_short), 4))
print("长退款的长度:", round(math.hypot(*refund_long), 4))
print("短退款-长退款 距离:", round(math.dist(refund_short, refund_long), 4))
print("短退款-发票   距离:", round(math.dist(refund_short, invoice), 4))
```

<div class="line-notes">

- `refund_short = (0.9, 0.1)` 想象成一句很短的退款问题,横轴「钱」、纵轴「发票」。
- `refund_long = (1.8, 0.2)` 每一维都正好是上面的 2 倍。想象成一篇讲同一件事、但写得更长更啰嗦的退款文章(有些打分方式是按词出现次数累加的,文章越长数越大)。箭头方向和短的完全一样,只是长了一倍。
- `invoice = (0.5, 0.6)` 一个偏发票的点。
- `math.hypot(*refund_short)` 向量的**长度**,也就是箭头从原点到点的距离,等于和 `(0, 0)` 的欧氏距离。`*` 把元组拆成两个参数传进去,相当于 JS 的展开运算符 `Math.hypot(...refundShort)`。`√(0.81 + 0.01) ≈ 0.9055`。
- `math.hypot(*refund_long)` 长的那根箭头,长度正好翻倍,1.8111。
- `math.dist(refund_short, refund_long)` 两个「讲同一件事」的向量之间的距离。
- `math.dist(refund_short, invoice)` 退款和发票之间的距离。

</div>

```bash
uv run python part04/length_problem.py
```

真实输出:

```text
短退款的长度: 0.9055
长退款的长度: 1.8111
短退款-长退款 距离: 0.9055
短退款-发票   距离: 0.6403
```

看最后两行。按距离算,短的退款问题离「发票」0.6403,离「讲同一件事的长退款文章」反而有 0.9055。如果只按距离排序,检索会先把发票文章捞上来,这显然不对。

问题出在哪?两根退款箭头**方向完全一样**,只是长度不同,而欧氏距离把长度差也算了进去。我们真正在意的是「方向像不像」(讲的是不是一件事),而不是「箭头长不长」。专门只看方向、不看长度的度量,就是 [Day 215](/blog/agent-zero/day-215-cosine/) 的余弦相似度。在那之前,Day 214 先学 numpy,因为 1024 维的向量用 `for` 循环一维一维地算,太慢了。

这里先透露一句:现代 embedding 模型大多会把输出的向量长度统一成 1,这种情况下欧氏距离和余弦给出的排序是一致的。但你没法保证每个服务都这么做,所以 Day 215 我们会自己动手把长度统一一遍。

## 动手练习

**练习 1:手算(不许用电脑)。** 算出下面三组点之间的距离:① `(1, 1)` 和 `(4, 5)`;② `(1, 2, 3)` 和 `(3, 4, 4)`;③ `(0.9, 0.1)` 和 `(0.7, 0.5)`(猫和马,和上面的输出对一下)。

<details><summary>参考答案</summary>

① 两维的差是 3 和 4,`√(9 + 16) = √25 = 5`。又是一个 3-4-5 三角形,只是整体挪了个位置,说明距离只和「差」有关,和点在哪儿无关。

② 三维的差是 2、2、1,`√(4 + 4 + 1) = √9 = 3`。

③ 差是 0.2 和 -0.4,`√(0.04 + 0.16) = √0.2 ≈ 0.4472`,和 `distance.py` 输出的「猫-马: 0.4472」一致。

</details>

**练习 2:加两个词。** 在词地图里加上「老虎」`(0.95, 0.05)` 和「自行车」`(0.1, 0.8)`,先在纸上猜每个词最近的三个邻居,再写 `part04/ex_animals.py` 验证。

<details><summary>参考答案</summary>

我的猜测:老虎最近的是猫、狗,然后是马;自行车最近的是汽车,然后是马。

```python
# agent-zero-lab/part04/ex_animals.py
import math

words = {
    "猫": (0.9, 0.1),
    "狗": (0.85, 0.15),
    "马": (0.7, 0.5),
    "汽车": (0.05, 0.95),
    "老虎": (0.95, 0.05),
    "自行车": (0.1, 0.8),
}

for target in ["老虎", "自行车"]:
    others = [(math.dist(words[target], vec), name) for name, vec in words.items() if name != target]
    others.sort()
    print(target, "最近的三个:", [(name, round(d, 4)) for d, name in others[:3]])
```

<div class="line-notes">

- `words = {` 原来四个词加上新的两个,一共六个。
- `for target in ["老虎", "自行车"]:` 只给这两个新词找邻居。
- `others = [(math.dist(words[target], vec), name) for name, vec in words.items() if name != target]` 对除自己以外的每个词算距离。`if name != target` 是推导式里的过滤条件,不然自己和自己距离是 0,永远排第一。老虎这一轮会算 5 个距离。
- `others.sort()` 按距离从小到大排。
- `others[:3]` 切片取前三个([Day 15](/blog/agent-zero/day-015-strings-1/) 讲过切片),再用推导式把每个元组换成 `(名字, 保留 4 位的距离)`,名字放前面读起来顺。

</div>

```bash
uv run python part04/ex_animals.py
```

真实输出:

```text
老虎 最近的三个: [('猫', 0.0707), ('狗', 0.1414), ('马', 0.5148)]
自行车 最近的三个: [('汽车', 0.1581), ('马', 0.6708), ('狗', 0.9925)]
```

和猜测一致。老虎离猫 0.0707,正好和猫狗之间的距离一样,因为老虎到猫、猫到狗都是两维各差 0.05。

</details>

**练习 3:画成 SVG,在浏览器里看。** 写 `part04/to_svg.py`,把四个词画成一个 400×400 的 SVG 文件 `part04/points.svg`,每个词一个圆点加文字,然后用浏览器打开它。提示:SVG 的 y 轴也是往下增长的,和终端格子一样要倒过来。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/to_svg.py
from pathlib import Path

words = {
    "猫": (0.9, 0.1),
    "狗": (0.85, 0.15),
    "马": (0.7, 0.5),
    "汽车": (0.05, 0.95),
}

W = 400
parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{W}">']
parts.append(f'<rect width="{W}" height="{W}" fill="white" stroke="gray"/>')
for name, (x, y) in words.items():
    cx = round(x * W)
    cy = round((1 - y) * W)
    parts.append(f'<circle cx="{cx}" cy="{cy}" r="5" fill="steelblue"/>')
    parts.append(f'<text x="{cx + 8}" y="{cy - 8}" font-size="14">{name}</text>')
parts.append("</svg>")

out = Path("part04/points.svg")
out.write_text("\n".join(parts), encoding="utf-8")
print("写好了:", out, "共", len(parts), "行")
```

<div class="line-notes">

- `from pathlib import Path` [Day 37](/blog/agent-zero/day-037-pathlib/) 学的路径对象。
- `W = 400` 画布宽高都是 400 像素。
- `parts = [f'<svg xmlns=` 用一个列表攒每一行 SVG 文本,最后再拼起来。外面用单引号,里面的属性就能直接写双引号。
- `parts.append(f'<rect` 一个白底灰边的矩形当背景。
- `cx = round(x * W)` 0 到 1 的坐标乘 400 换成像素。猫是 `0.9 × 400 = 360`。
- `cy = round((1 - y) * W)` y 倒过来。猫的 y 是 0.1,`(1 - 0.1) × 400 = 360`,在靠下的位置。汽车是 `(1 - 0.95) × 400 = 20`,在顶上。
- `parts.append(f'<circle` 每个词一个半径 5 的点。
- `parts.append(f'<text x="{cx + 8}" y="{cy - 8}"` 文字放在点的右上方一点,避免压住圆点。
- `out.write_text("\n".join(parts), encoding="utf-8")` 用换行把所有片段连起来写进文件。一定写 `encoding="utf-8"`,不然中文在某些系统上会乱码。
- `print("写好了:", out, "共", len(parts), "行")` 1 行开头 + 1 行背景 + 4 个词 × 2 行 + 1 行结尾,一共 11 行。

</div>

```bash
uv run python part04/to_svg.py
open part04/points.svg
```

真实输出,以及文件开头几行:

```text
写好了: part04/points.svg 共 11 行
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
<rect width="400" height="400" fill="white" stroke="gray"/>
<circle cx="360" cy="360" r="5" fill="steelblue"/>
<text x="368" y="352" font-size="14">猫</text>
<circle cx="340" cy="340" r="5" fill="steelblue"/>
<text x="348" y="332" font-size="14">狗</text>
```

`open` 是 macOS 的命令,会用默认浏览器打开 SVG。你会看到猫狗两个点在右下角几乎贴在一起,汽车在左上角。

</details>

**练习 4:写一个 top-k 函数。** 把 `nearest.py` 里「算距离、排序、取第一个」的逻辑抽成函数 `nearest_k(query, items, k)`,返回最近的 k 个 `(标题, 距离)`。用问题「发票抬头写错了想重开」测试,它的向量你自己定。另外试一下 k 比文章数还大会怎样。

<details><summary>参考答案</summary>

我给「发票抬头写错了想重开」定的向量是 `(0.2, 0.8, 0.0, 0.3)`:和钱有一点关系,主要是发票,有点情绪。

```python
# agent-zero-lab/part04/ex_top_k.py
import math

Vec = tuple[float, ...]


def nearest_k(query: Vec, items: dict[str, Vec], k: int) -> list[tuple[str, float]]:
    scored = [(name, math.dist(query, vec)) for name, vec in items.items()]
    scored.sort(key=lambda pair: pair[1])
    return scored[:k]


articles: dict[str, Vec] = {
    "退款政策": (0.9, 0.2, 0.0, 0.1),
    "开发票指南": (0.3, 0.9, 0.0, 0.0),
    "重置密码": (0.0, 0.0, 0.9, 0.1),
}

print(nearest_k((0.2, 0.8, 0.0, 0.3), articles, 2))
print(nearest_k((0.2, 0.8, 0.0, 0.3), articles, 10))
```

<div class="line-notes">

- `Vec = tuple[float, ...]` 给类型起个别名,相当于 TS 的 `type Vec = number[]`,后面签名短一些。
- `def nearest_k(query: Vec, items: dict[str, Vec], k: int) -> list[tuple[str, float]]:` 返回值是「标题、距离」二元组的列表。
- `scored = [(name, math.dist(query, vec)) for name, vec in items.items()]` 这次把标题放前面、距离放后面,读结果更顺,代价是排序要指定按哪一位排。
- `scored.sort(key=lambda pair: pair[1])` `key` 告诉 `sort` 按每个元组的第 1 位(距离)排。`lambda` 是 [Day 30](/blog/agent-zero/day-030-functions-3/) 学的小匿名函数,相当于 JS 的 `pair => pair[1]`。
- `return scored[:k]` 取前 k 个。k 比列表长时,切片不会报错,只是把全部给你。
- `print(nearest_k((0.2, 0.8, 0.0, 0.3), articles, 2))` 取最近的 2 篇。
- `print(nearest_k((0.2, 0.8, 0.0, 0.3), articles, 10))` k=10 而只有 3 篇文章,看看会不会出错。

</div>

```bash
uv run python part04/ex_top_k.py
```

真实输出:

```text
[('开发票指南', 0.33166247903553997), ('退款政策', 0.9433981132056604)]
[('开发票指南', 0.33166247903553997), ('退款政策', 0.9433981132056604), ('重置密码', 1.2369316876852983)]
```

《开发票指南》排第一,距离 0.3317。k=10 没有报错,三篇全部返回。这个「切片越界不报错」的特性在写 RAG 时很方便,知识库里只有 2 篇文章时 `top_k=5` 也不会崩。

</details>

**练习 5(观察题):把情绪那一维去掉。** 在 `nearest.py` 里把每个向量的第四维删掉(变成三维),再跑一次,看「登不上去了气死」到《重置密码》的距离怎么变。

<details><summary>参考答案</summary>

改法:把每个元组的最后一个数删掉,比如 `"重置密码": (0.0, 0.0, 0.9)`,`"登不上去了气死": (0.0, 0.0, 0.8)`。三篇文章和两个问题都要删,少删一个,`math.dist` 就会报上面那个 `both points must have the same number of dimensions`。

我把改好的版本另存成 `part04/ex_no_emotion.py`(内容就是 `nearest.py` 删掉每个向量的最后一个数,注释改成三个维度),跑 `uv run python part04/ex_no_emotion.py`,真实输出:

```text
问题:买错了能把钱要回来吗 (0.8, 0.1, 0.0)
  0.1414  退款政策
  0.9434  开发票指南
  1.2083  重置密码
  最近的是: 退款政策
问题:登不上去了气死 (0.0, 0.0, 0.8)
  0.1000  重置密码
  1.2207  退款政策
  1.2410  开发票指南
  最近的是: 重置密码
```

手算核一下:问题 `(0.0, 0.0, 0.8)` 到《重置密码》`(0.0, 0.0, 0.9)` 只剩第三维差 0.1,距离就是 0.1。从 0.8062 降到 0.1,说明原来大半的距离都是火气贡献的。第一个问题也从 0.3317 降到 0.1414,它原来也带着 0.4 的情绪。

我第一次改的时候用 `sed` 批量删,漏改了两行,结果直接报 `ValueError: both points must have the same number of dimensions`,正好又踩了一遍维度不一致的坑。这也提醒你:向量里每一维都会参与距离计算,一些和检索无关的信息(语气、长度、格式)混进来会干扰排序。真实模型的每一维我们没法这样手工删,所以后面要靠更好的模型和 Day 215 的余弦来缓解。

</details>

**验收标准:** 练习 1 三题手算都对;`distance.py` 输出和本文一致;能不看文章写出 `distance` 函数,并说清楚为什么要 `strict=True`;能用一句话解释 `length_problem.py` 最后两行为什么「不对劲」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 向量(vector) | 一串有顺序的数字,如 `(0.9, 0.1)`。可以画成一个点,也可以画成从原点出发的箭头 |
| 维度(dimension) | 向量里数字的个数。`(0.9, 0.1)` 是二维,bge-m3 的输出是 1024 维 |
| 欧氏距离(Euclidean distance / L2) | 两点之间的直线距离:每一维相减、平方、求和、开根号。越小越近 |
| 向量的长度(范数,norm) | 箭头从原点到点有多长,等于这个点和原点的欧氏距离。`(3, 4)` 的长度是 5 |
| 最近邻(nearest neighbor) | 一堆点里离查询点距离最小的那个;取前 k 个就叫 top-k 或 k 近邻 |
| `zip` | Python 内置函数,把两个序列按位置一对一配起来;加 `strict=True` 时长度不同会报错 |
| `math.dist` | Python 标准库的欧氏距离函数,维度不同时抛 `ValueError` |
| `math.hypot` | 标准库函数,算一个向量的长度(到原点的距离) |
| 银行家舍入 | Python `round` 对正好 .5 的数取偶数:`round(8.5)` 是 8,`round(9.5)` 是 10 |
| embedding(嵌入) | 由模型把一段文字变成一个向量,意思近的文字向量也近。今天的向量是手工编的,Day 217 起由模型生成 |

## 常见误区

**以为向量的每一维都有人能看懂的含义。** 今天的「像动物」「和钱有关」是为了教学手工定的。真实 embedding 的每一维都是训练出来的,单独拿出来没有含义,只有整体的位置关系有意义。面试时如果说「第几维代表情绪」会被追问到答不上来。

**拿两个不同来源的向量直接比。** 维度相同也不行。A 模型的第 0 维和 B 模型的第 0 维代表的东西毫无关系,就像拿「像动物」去比「和发票有关」。索引和查询必须用同一个模型,换模型就要把所有文档重新算一遍。

**手写 `zip` 不加 `strict=True`。** 维度对不上时 `zip` 默认悄悄截断,算出一个看起来正常的错数字,上面 `dim_mismatch.py` 第一行就是现场。自己写向量运算的循环,一律加上;或者直接用会检查维度的 `math.dist`。

**以为距离近就是讲同一件事。** `length_problem.py` 演示了反例:方向一样、长度不同的两个向量,距离可能比一个不相关的向量还大。距离把「长度」和「方向」混在一起算了,这是 Day 215 改用余弦的原因。

**看到距离 0.8 就说「不相关」。** 距离的大小只在同一批向量里比较才有意义。`nearest.py` 里 0.8062 已经是「登不上去了气死」能找到的最近的文章了。绝对数值换一组数据、换一个模型就完全不同,看排序,别看绝对值。

**用 Python 的 `round` 当 JS 的 `Math.round`。** `round(8.5)` 得 8,`Math.round(8.5)` 得 9。画格子时差一格无所谓,算钱的时候会出事,金额要用 [Day 12](/blog/agent-zero/day-012-numbers/) 提过的整数「分」来算。

## 学习资料

### 文档与文章

- [Python 文档 · math 模块(中文)](https://docs.python.org/zh-cn/3.12/library/math.html):找到 `math.dist`、`math.hypot`、`math.sqrt` 三个函数,各看一眼示例,5 分钟。
- [Python 文档 · 内置函数 zip(中文)](https://docs.python.org/zh-cn/3.12/library/functions.html#zip):看 `strict` 参数那一段,里面也举了长度不同时的例子。
- [维基百科 · 欧几里得距离(中文)](https://zh.wikipedia.org/wiki/%E6%AC%A7%E5%87%A0%E9%87%8C%E5%BE%97%E8%B7%9D%E7%A6%BB):只看开头的定义和二维、三维的公式,和今天手算的对上就行,后面的推广可以跳过。
- [Google 机器学习速成课 · Embeddings](https://developers.google.com/machine-learning/crash-course/embeddings):Google 官方的入门章节,有交互图,看「把东西摆进一个空间里、相似的靠近」那部分,和今天的词地图是同一个想法。
- [Jay Alammar · The Illustrated Word2vec](https://jalammar.github.io/illustrated-word2vec/):英文,图特别多。只看开头用「性格测试分数」把人表示成向量、再比谁和谁像的那一段,和今天手工编四维向量的思路一模一样。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ys411472E&p=2&autoplay=0&high_quality=1" title="【官方双语/合集】线性代数的本质 - 01 - 向量究竟是什么?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>3Blue1Brown · 【官方双语/合集】线性代数的本质 · 第 2P「01 - 向量究竟是什么?」,10 分钟。讲了「物理学生的箭头、计算机学生的一串数、数学家的抽象」三种看法,今天只要前两种。后面的分 P 现在不用看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1DX9EBMEec&autoplay=0&high_quality=1" title="【数学】一杯奶茶教会你什么是向量 | 算法的数学基础01" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>过拟合青年 · 【数学】一杯奶茶教会你什么是向量 | 算法的数学基础01 · 9 分钟,用奶茶的甜度、冰度这类特征把东西变成向量,和今天手工给文章打四个分数是一回事,适合 0 基础先看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/fNk_zzaMoSs" title="Vectors | Chapter 1, Essence of linear algebra" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>3Blue1Brown · Vectors | Chapter 1, Essence of linear algebra · 上面 B 站第 2P 的英文原版,B 站打不开时看这个。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/gQddtTdmG_8" title="Vectoring Words (Word Embeddings) - Computerphile" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Computerphile · Vectoring Words (Word Embeddings) · 17 分钟,研究者对着纸讲词向量怎么来的。今天看前 8 分钟,知道「词变成空间里的点」这件事不是我们编的玩具就够了。</figcaption>
</figure>

### 书籍

- 平冈和幸、堀玄《程序员的数学 3:线性代数》(卢晓南译,人民邮电出版社,2016):第 1 章讲向量,图多、例子偏编程,只看向量那几节就够,矩阵部分以后用到再说。
- Marc Peter Deisenroth、A. Aldo Faisal、Cheng Soon Ong《Mathematics for Machine Learning》(Cambridge University Press,2020),作者在 [mml-book.github.io](https://mml-book.github.io/) 免费放出 PDF。英文、偏教材,今天只翻第 3 章开头讲「范数」和「距离」的两三页,当作对照,看不懂不要紧。

### 开源项目与代码

- [HandsOnLLM/Hands-On-Large-Language-Models](https://github.com/HandsOnLLM/Hands-On-Large-Language-Models):《图解大模型》的配套 notebook,第 2 章有把词向量画在平面上的代码,Day 217 用真模型时可以回来对照。今天只需要知道它在那儿。

## 自测

**1. 向量 `(0.3, 0.7, 0.0)` 是几维的?它和 `(0.7, 0.3, 0.0)` 是同一个向量吗?为什么?**

<details><summary>答案</summary>

三维,因为有三个数。不是同一个向量:向量靠位置区分每一维的含义,前两维对调以后意思就变了。就像今天的猫 `(0.9, 0.1)` 对调成 `(0.1, 0.9)` 就从「很像动物」变成了「很像交通工具」。

</details>

**2. 手算 `(2, 3)` 和 `(5, 7)` 之间的欧氏距离。**

<details><summary>答案</summary>

两维的差是 3 和 4,`√(9 + 16) = 5`。

</details>

**3. 下面这个函数有什么隐患?举一个它会算错但不报错的输入。**

```python
def dist(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5
```

<details><summary>答案</summary>

`zip` 没加 `strict=True`,维度不同时会悄悄截断。比如 `dist((0, 0, 9), (0, 0))` 返回 `0.0`,第三维的 9 被扔掉了,看起来两个点完全重合。改成 `zip(a, b, strict=True)` 或直接用 `math.dist`,都会抛 `ValueError`。

</details>

**4. 为什么 `refund_short = (0.9, 0.1)` 和 `refund_long = (1.8, 0.2)` 讲的是同一件事,距离却比它和 `invoice = (0.5, 0.6)` 还远?**

<details><summary>答案</summary>

两根箭头方向完全一样,只是长的那根长了一倍。欧氏距离把长度差也算进去了,短退款到长退款的距离 0.9055 全部来自长度差;而发票那个点虽然方向偏了,但离得不远,距离 0.6403。检索在意的是方向(讲没讲同一件事),所以需要一个只看方向的度量,也就是 Day 215 的余弦相似度。

</details>

**5. 面试题:「我们的知识库索引是用模型 A 建的,现在想换成更便宜的模型 B,只把查询改成用 B 生成向量可以吗?」你怎么回答?**

<details><summary>答案</summary>

不可以。不同模型的向量空间不一样,每一维代表的东西毫无对应关系,就算维度恰好相同也不能直接比,检索结果会接近随机,而且不会报错。维度不同的话更直接,向量库会报维度不匹配。正确做法是用模型 B 把所有文档重新生成向量、重建索引,切换期间可以新旧两套索引并行,等新索引建完、在评测集上验证过召回质量再切流量。

</details>

## 明天预告

明天是 [Day 214 · numpy 够用版:数组、点积和范数](/blog/agent-zero/day-214-numpy-basics/)。今天的 `distance` 用 `for` 循环一维一维地算,四维无所谓,可 bge-m3 一个向量就是 1024 维,一个知识库有几千段文字,纯 Python 循环会慢到你能感觉出来。numpy 是 Python 里做这类数字运算的标准工具,一行代码就能对整串数字做加减乘除。明天我们把今天的 `distance` 用 numpy 重写一遍,顺便认识 Day 215 余弦相似度要用到的两个零件:点积和范数。
