---
title: 'Day 22 · 元组和解包'
description: '元组(tuple)是建好就不能改的「一小组固定的值」,解包是把它一次拆给几个名字,相当于 JS 的解构赋值。今天学会 (a, b) 的写法和 (5,) 的坑,用解包一行拆开一条工单,再看懂 enumerate、zip、divmod 其实都在返回元组。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 22
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 21](/blog/agent-zero/day-021-lists/) 学了列表:`append` 加、`pop` 取、`remove` 删、`sort` 排,记住了三个坑:`append`/`sort` 返回 `None` 不能接,`b = a` 只是多一个名字,遍历时不能删。最后的小项目把工单存成 `[金额, 工单号]` 的小列表,放进大列表里排序。

那个 `[金额, 工单号]` 其实有点别扭:它是「一对」固定的东西,金额永远在第 0 位、工单号永远在第 1 位,不会再加第三项,也不该有人去改它。用能增能删能改的列表装它,有点大材小用,还容易被不小心改坏。Python 为这种「一小组位置固定的值」准备了专门的类型,叫元组。今天学元组,以及和它配套的解包。

## 今天要解决的问题

学完今天,你应该能:

1. 写出元组 `(29900, "T201")`,说清它和列表的区别:建好之后不能改,改它会报 `TypeError: 'tuple' object does not support item assignment`;知道单项元组要写成 `(5,)`,`(5)` 只是括号里的一个数。
2. 用解包把列表或元组一次拆给几个名字:`ticket_id, human, customer, desc = line.split(maxsplit=3)`;会用 `a, b = b, a` 交换,会用 `*rest` 收剩下的,会用 `_` 表示「这一项我不要」;认得两个报错 `not enough values to unpack` 和 `too many values to unpack`。
3. 认出 `enumerate`、`zip`、`divmod`、`str.partition` 返回的都是元组,明白 `for no, line in enumerate(...)` 里的逗号就是解包;会用 `zip` 把两个列表按位置配成对。
4. 写出 `part01/ticket_pairs.py`:把一批带坏行的工单拆成元组记录,按客户归拢打印。

预计用时:2.5 小时。元组和不可变 40 分钟,解包 50 分钟,enumerate/zip/divmod 30 分钟,小项目和练习 40 分钟。

前置:[Day 14](/blog/agent-zero/day-014-bool-none/)(`None`、`is None`)、[Day 16](/blog/agent-zero/day-016-strings-2/)(`split(maxsplit=...)`)、[Day 18](/blog/agent-zero/day-018-for-range/)(`enumerate`)、[Day 21](/blog/agent-zero/day-021-lists/)(列表、`sort`、排序时列表和列表怎么比)。今天不调任何 API,花费 0 元。

学法提示:先对照文章逐行敲一遍(代码自己敲,不复制粘贴)并跑通;第二天合上文章,把 `ticket_pairs.py` 默写出来,故意去掉 `len(parts) != 4` 那道关卡,看是哪一行崩、报什么错;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚我是在哪跑的

输出是我 2026-10-23 在 2019 款 Intel MacBook Pro(macOS 14、zsh)上用演示家目录真跑的,家目录显示成 `/Users/你`,`~/agent-zero-lab` 接着 Day 21 的状态,`uv run python` 是 3.12.13,Ruff 是 0.17.2,basedpyright 是 standard 档。今天的脚本都放在 `part01/`,在仓库根目录用 `uv run python part01/文件名.py` 运行,不读键盘输入。

## 先看 JS 的解构

你写 React 时每天都在用解构。先跑一遍 JS,看今天要学的所有写法在 JS 里长什么样:

```text
$ node -e '
const [id, human, customer] = "T001 计费 C023".split(" ");
console.log(id, human, customer);
const [first, ...rest] = ["T001", "T002", "T003", "T004"];
console.log(first, rest);
let x = 1, y = 2;
[x, y] = [y, x];
console.log(x, y);
for (const [i, name] of ["a", "b"].entries()) console.log(i, name);
const t = Object.freeze(["T001", 299]);
t[0] = "X";
console.log(t);
'
T001 计费 C023
T001 [ 'T002', 'T003', 'T004' ]
2 1
0 a
1 b
[ 'T001', 299 ]
```

<div class="line-notes">

- `const [id, human, customer] = "T001 计费 C023".split(" ");` 数组解构:把拆出来的三项依次给三个名字。
- `console.log(id, human, customer);` 输出 `T001 计费 C023`。
- `const [first, ...rest] = ["T001", "T002", "T003", "T004"];` 剩余元素:`first` 拿第一项,`rest` 收剩下的,是一个新数组。
- `console.log(first, rest);` 输出 `T001 [ 'T002', 'T003', 'T004' ]`。
- `let x = 1, y = 2;` 两个变量。
- `[x, y] = [y, x];` 不用临时变量交换。
- `console.log(x, y);` 输出 `2 1`。
- `for (const [i, name] of ["a", "b"].entries()) console.log(i, name);` 遍历时解构,`entries()` 每次给 `[下标, 值]` 一对。输出 `0 a`、`1 b`。这就是 Day 18 的 `enumerate` 在 JS 里的样子。
- `const t = Object.freeze(["T001", 299]);` `Object.freeze` 把数组冻住,不让改。
- `t[0] = "X";` 想改第 0 项。注意:JS 的非严格模式下**这一行悄悄失败,不报错**。
- `console.log(t);` 输出还是 `[ 'T001', 299 ]`,没被改。Python 的元组在这里不一样:改它会**直接报错**。

</div>

Python 的写法几乎一样,只是不用写 `const` 和方括号,逗号就够了:

| 想做的事 | JS | Python |
| --- | --- | --- |
| 拆成几个名字 | `const [a, b] = arr` | `a, b = arr` |
| 收剩下的 | `const [first, ...rest] = arr` | `first, *rest = arr`,星号加在**收集的那个**名字前 |
| 交换 | `[x, y] = [y, x]` | `x, y = y, x` |
| 遍历时拆 | `for (const [i, v] of arr.entries())` | `for i, v in enumerate(arr)` |
| 不要某一项 | `const [, b] = arr`(留空) | `_, b = arr`,用 `_` 当名字 |
| 建一个冻结的小组 | `Object.freeze([a, b])`,改了也不报错 | `(a, b)`,元组,改了会报错 |

JS 里没有「天生不能改的数组」,Python 有,这就是元组。

## 元组:建好就不能改的一小组值

### 怎么写,怎么取

新建 `part01/tuple_basics.py`:

```python
# agent-zero-lab/part01/tuple_basics.py
pair = (29900, "T201")
print(pair, type(pair))

same = 29900, "T201"
print(same == pair)

print(pair[0], pair[-1], len(pair))
print(pair[0:1])
print("T201" in pair)

not_tuple = (5)  # fmt: skip
one = (5,)
empty = ()
print(type(not_tuple), type(one), type(empty))
print(one, len(one))

ids = ["T001", "T002"]
print(tuple(ids))
print(list(pair))
```

<div class="line-notes">

- `pair = (29900, "T201")` 用圆括号写,里面用逗号隔开,和列表的方括号对应。这一对是「金额分、工单号」,和昨天 `[29900, 'T201']` 的内容一样,只是换了类型。
- `print(pair, type(pair))` 输出 `(29900, 'T201') <class 'tuple'>`。`print` 元组时也用圆括号。
- `same = 29900, "T201"` **其实圆括号不是必须的**,真正造出元组的是逗号。不加括号照样是元组。
- `print(same == pair)` `True`:两个元组内容一样,`==` 就是真。
- `print(pair[0], pair[-1], len(pair))` 下标、负下标、`len` 和列表、字符串一样:`29900 T201 2`。
- `print(pair[0:1])` 切片也能用,结果**还是元组**:`(29900,)`。
- `print("T201" in pair)` `in` 也能用:`True`。
- `not_tuple = (5)  # fmt: skip` 这是个坑:`(5)` **不是元组**,括号只是数学里的括号,等于 `5`。末尾的 `# fmt: skip` 是告诉 Ruff 的格式化工具「这一行别动」,不然它会把这对「多余」的括号直接删掉,我们就看不到坑了。
- `one = (5,)` **单项元组必须在最后加一个逗号**,逗号才是造元组的东西。
- `empty = ()` 空元组,只有一对括号,不需要逗号。
- `print(type(not_tuple), type(one), type(empty))` 输出 `<class 'int'> <class 'tuple'> <class 'tuple'>`:`(5)` 是整数,另外两个是元组。
- `print(one, len(one))` 输出 `(5,) 1`:Python 打印单项元组时也带着那个逗号,提醒你它是元组。
- `ids = ["T001", "T002"]` 一个普通列表。
- `print(tuple(ids))` `tuple(...)` 把列表转成元组:`('T001', 'T002')`。
- `print(list(pair))` 反过来,`list(...)` 把元组转成列表:`[29900, 'T201']`。

</div>

```text
$ cd ~/agent-zero-lab
$ uv run python part01/tuple_basics.py
(29900, 'T201') <class 'tuple'>
True
29900 T201 2
(29900,)
True
<class 'int'> <class 'tuple'> <class 'tuple'>
(5,) 1
('T001', 'T002')
[29900, 'T201']
```

<div class="line-notes">

- `(29900, 'T201') <class 'tuple'>` 类型确实是 tuple。
- `True` 有没有圆括号都一样。
- `29900 T201 2` 第 0 项、最后一项、个数。
- `(29900,)` 切片的结果是只有一项的元组,所以带逗号。
- `True` `"T201"` 在里面。
- `<class 'int'> <class 'tuple'> <class 'tuple'>` `(5)` 是 int,`(5,)` 和 `()` 是 tuple。
- `(5,) 1` 单项元组,长度是 1。
- `('T001', 'T002')` 列表变元组。
- `[29900, 'T201']` 元组变列表。

</div>

**`(5)` 和 `(5,)` 的区别是今天要记住的第一个坑。** 它不会马上报错,而是悄悄给你一个整数,在后面某个意想不到的地方才出问题。练习 3 会让你亲眼看一次。

### 改不了

和列表最大的区别就是这个。新建 `part01/tuple_assign_error.py`(故意写错):

```python
# agent-zero-lab/part01/tuple_assign_error.py
pair = (29900, "T201")
pair[0] = 49900
```

<div class="line-notes">

- `pair = (29900, "T201")` 一个元组。
- `pair[0] = 49900` 想把金额改掉。

</div>

```text
$ uv run python part01/tuple_assign_error.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/tuple_assign_error.py", line 3, in <module>
    pair[0] = 49900
    ~~~~^^^
TypeError: 'tuple' object does not support item assignment
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/tuple_assign_error.py", line 3, in <module>` 第 3 行。
- `pair[0] = 49900` 崩的那行,下面的 `~~~~^^^` 指着 `pair[0]`。
- `TypeError: 'tuple' object does not support item assignment` 读法:元组对象不支持「按下标赋值」。和 Day 15 字符串 `s[0] = "X"` 是同一个意思,只是 `'str'` 换成了 `'tuple'`。编辑器也会提前画红线:`"__setitem__" method not defined on type "tuple[...]"`。

</div>

元组也没有 `append`、`remove`、`sort` 这些「改自己」的方法。想要「改过的版本」,只能造一个新的:`pair = (49900, pair[1])`,新元组替换旧元组。

那为什么不全用列表呢?因为「不能改」本身就是功能:

1. **防止改坏。** 一对固定的东西,谁都改不了,不用担心某个角落把金额偷偷改了(Day 21 的 `b = a` 别名问题在元组上不会发生)。
2. **表达意图。** 看到 `(金额, 工单号)` 就知道这是「固定的一对」;看到 `[...]` 就知道这是「一批,可能会增减」。
3. **能当字典的键。** Day 24 学字典时你会看到:元组可以当键,列表不行,原因就是它不能改。

经验选法:**同类东西的一批、数量会变,用列表;不同东西的一小组、位置固定,用元组。** 比如「一批工单号」是列表,「一张工单的(金额, 工单号)」是元组。

### 不可变到哪一层

「不能改」有个边界,和 Day 21 讲 `.copy()` 只拷最外层是同一个道理。新建 `part01/tuple_shallow.py`:

```python
# agent-zero-lab/part01/tuple_shallow.py
row = (["T001"], 299)
print(row)

row[0].append("T002")
print(row)

row[0] = ["T009"]
```

<div class="line-notes">

- `row = (["T001"], 299)` 元组的第 0 项是一个**列表**,第 1 项是整数。
- `print(row)` 输出 `(['T001'], 299)`。
- `row[0].append("T002")` 这一行**不是**在改元组:它是取出元组的第 0 项(那个列表),然后改**那个列表**。元组还是同样的两项,只是第 0 项指向的列表自己变长了。
- `print(row)` 输出 `(['T001', 'T002'], 299)`,真的改成功了。
- `row[0] = ["T009"]` 这一行才是想**换掉**元组的第 0 项,元组不允许。

</div>

```text
$ uv run python part01/tuple_shallow.py
(['T001'], 299)
(['T001', 'T002'], 299)
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/tuple_shallow.py", line 8, in <module>
    row[0] = ["T009"]
    ~~~^^^
TypeError: 'tuple' object does not support item assignment
```

<div class="line-notes">

- `(['T001'], 299)` 起点。
- `(['T001', 'T002'], 299)` 元组里的列表被改了,元组本身(「第 0 项是哪个对象」)没变。
- `File "/Users/你/agent-zero-lab/part01/tuple_shallow.py", line 8, in <module>` 最后一行崩了,第 8 行。
- `TypeError: 'tuple' object does not support item assignment` 想换掉元组里的某一项,不行。

</div>

所以元组的「不可变」指的是**它装着哪几个对象不能换**,不是说里面装的东西一定也不能变。元组里放数字、字符串、别的元组,就是彻底不可变的;放了列表,列表自己还是能改。写代码时尽量别这么混着放。

## 解包:一行拆给几个名字

### 最常见的用法

解包的意思是:右边是「一小组东西」,左边写几个名字,Python 按顺序一对一地分过去。新建 `part01/unpack_basic.py`:

```python
# agent-zero-lab/part01/unpack_basic.py
line = "T001 计费 C023 8月2日重复扣款299元"
ticket_id, human, customer, desc = line.split(maxsplit=3)
print(ticket_id)
print(human)
print(customer)
print(desc)

pair = (29900, "T201")
fen, tid = pair
print(fen, tid)

a = "计费"
b = "登录"
a, b = b, a
print(a, b)

ids = ["T001", "T002", "T003", "T004"]
first, *rest = ids
print(first, rest)

head, *middle, tail = ids
print(head, middle, tail)

_, kind, _, _ = line.split(maxsplit=3)
print(kind)
```

<div class="line-notes">

- `line = "T001 计费 C023 8月2日重复扣款299元"` 一行工单文本,四段。
- `ticket_id, human, customer, desc = line.split(maxsplit=3)` 右边 `split(maxsplit=3)` 返回有四项的列表 `['T001', '计费', 'C023', '8月2日重复扣款299元']`;左边四个名字,**按顺序**一人一个。以前写 `parts = line.split(...)`、`ticket_id = parts[0]`、`human = parts[1]` 要四五行,现在一行,而且名字替代了 `parts[0]` 这种没有含义的下标。
- `print(ticket_id)` `T001`。
- `print(human)` `计费`。
- `print(customer)` `C023`。
- `print(desc)` `8月2日重复扣款299元`。
- `pair = (29900, "T201")` 一个元组。
- `fen, tid = pair` 同样能解包元组。`fen` 是 29900,`tid` 是 `"T201"`。
- `print(fen, tid)` `29900 T201`。
- `a = "计费"` 两个变量。
- `b = "登录"` 同上。
- `a, b = b, a` **交换**。右边先算出一个元组 `("登录", "计费")`,再解包给左边,所以不需要临时变量。JS 的 `[x, y] = [y, x]` 是同一回事。
- `print(a, b)` 输出 `登录 计费`,已经换过来了。
- `ids = ["T001", "T002", "T003", "T004"]` 四项的列表。
- `first, *rest = ids` 星号加在 `rest` 前面:`first` 拿第一项,`rest` **收剩下所有的**,收到的永远是一个列表。
- `print(first, rest)` `T001 ['T002', 'T003', 'T004']`。
- `head, *middle, tail = ids` 星号名字可以在中间:头一个给 `head`,最后一个给 `tail`,中间的收进 `middle`。
- `print(head, middle, tail)` `T001 ['T002', 'T003'] T004`。
- `_, kind, _, _ = line.split(maxsplit=3)` 只想要第二项「计费」,其他三项不要:习惯上用 `_` 当名字,表示「这一项我不用」。`_` 就是一个普通的名字,可以重复出现,只是约定俗成。
- `print(kind)` `计费`。

</div>

```text
$ uv run python part01/unpack_basic.py
T001
计费
C023
8月2日重复扣款299元
29900 T201
登录 计费
T001 ['T002', 'T003', 'T004']
T001 ['T002', 'T003'] T004
计费
```

<div class="line-notes">

- `T001` 第一段。
- `计费` 第二段。
- `C023` 第三段。
- `8月2日重复扣款299元` 第四段,是完整的描述,因为 `maxsplit=3` 让最后一段不再被拆(Day 16)。
- `29900 T201` 元组解包。
- `登录 计费` 交换之后。
- `T001 ['T002', 'T003', 'T004']` `first` 是字符串,`rest` 是列表。
- `T001 ['T002', 'T003'] T004` 头、中间、尾。
- `计费` `_, kind, _, _` 取到的第二项。

</div>

画出来是这样,右边这一组东西按位置一一分给左边的名字:

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="解包:line.split 得到四项的列表 T001 计费 C023 描述,按位置依次赋给 ticket_id human customer desc 四个名字">
<rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink-soft)">line.split(maxsplit=3)  右边:一组四项</text>
<rect x="20" y="40" width="130" height="34" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="62" fill="var(--ink)">'T001'</text>
<rect x="160" y="40" width="130" height="34" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="172" y="62" fill="var(--ink)">'计费'</text>
<rect x="300" y="40" width="130" height="34" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="312" y="62" fill="var(--ink)">'C023'</text>
<rect x="440" y="40" width="180" height="34" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="452" y="62" fill="var(--ink)">'8月2日重复扣款299元'</text>
<line x1="85" y1="74" x2="85" y2="118" stroke="var(--ink-soft)"/>
<polygon points="80,112 85,120 90,112" fill="var(--ink-soft)"/>
<line x1="225" y1="74" x2="225" y2="118" stroke="var(--ink-soft)"/>
<polygon points="220,112 225,120 230,112" fill="var(--ink-soft)"/>
<line x1="365" y1="74" x2="365" y2="118" stroke="var(--ink-soft)"/>
<polygon points="360,112 365,120 370,112" fill="var(--ink-soft)"/>
<line x1="530" y1="74" x2="530" y2="118" stroke="var(--ink-soft)"/>
<polygon points="525,112 530,120 535,112" fill="var(--ink-soft)"/>
<rect x="20" y="122" width="130" height="34" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="32" y="144" fill="var(--ink)">ticket_id</text>
<rect x="160" y="122" width="130" height="34" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="172" y="144" fill="var(--ink)">human</text>
<rect x="300" y="122" width="130" height="34" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="312" y="144" fill="var(--ink)">customer</text>
<rect x="440" y="122" width="180" height="34" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="452" y="144" fill="var(--ink)">desc</text>
<text x="20" y="184" fill="var(--ink-soft)">左边:四个名字。个数必须对得上,多了少了都是 ValueError</text>
</g>
</svg>
<figcaption>解包按位置一一对应:第 0 项给第 0 个名字,第 1 项给第 1 个名字。名字替代了 parts[0]、parts[1] 这样没有含义的下标。</figcaption>
</figure>

### 个数对不上就报错

「按位置一一对应」有个硬要求:左边名字的个数要等于右边的项数(用了星号名字的除外)。多了、少了都会报错。回想 Day 20 的 `daily_report.py`,里面有一行残缺的工单 `"T105 计费"`,只有两段。如果没有 `len(parts) < 4` 那道关卡,直接解包会怎样?新建 `part01/unpack_error_few.py`:

```python
# agent-zero-lab/part01/unpack_error_few.py
line = "T009 计费"
ticket_id, human, customer, desc = line.split(maxsplit=3)
print(ticket_id)
```

<div class="line-notes">

- `line = "T009 计费"` 一条残缺工单,只有两段。
- `ticket_id, human, customer, desc = line.split(maxsplit=3)` 右边只有两项,左边要四个名字。
- `print(ticket_id)` 走不到这里。

</div>

```text
$ uv run python part01/unpack_error_few.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/unpack_error_few.py", line 3, in <module>
    ticket_id, human, customer, desc = line.split(maxsplit=3)
    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
ValueError: not enough values to unpack (expected 4, got 2)
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/unpack_error_few.py", line 3, in <module>` 第 3 行。
- `ticket_id, human, customer, desc = line.split(maxsplit=3)` 崩的那行,下面一排 `^^^^` 标出整个赋值语句。
- `ValueError: not enough values to unpack (expected 4, got 2)` 读法:值不够拆,**期望 4 个,实际只有 2 个**。括号里的两个数字直接告诉你病因。

</div>

反过来,名字太少。`part01/unpack_error_many.py`:

```python
# agent-zero-lab/part01/unpack_error_many.py
line = "T001 计费 C023"
ticket_id, human = line.split()
print(ticket_id)
```

<div class="line-notes">

- `line = "T001 计费 C023"` 三段。
- `ticket_id, human = line.split()` 右边 3 项,左边只有两个名字。
- `print(ticket_id)` 走不到。

</div>

```text
$ uv run python part01/unpack_error_many.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/unpack_error_many.py", line 3, in <module>
    ticket_id, human = line.split()
    ^^^^^^^^^^^^^^^^
ValueError: too many values to unpack (expected 2)
```

<div class="line-notes">

- `ticket_id, human = line.split()` 崩的那行。
- `ValueError: too many values to unpack (expected 2)` 值太多,期望 2 个。**这条报错没有写「实际几个」**,所以别指望从数字里反推,回去看右边到底是几项。

</div>

这两条报错都和 Day 20 的「段数不够」同一种病:**输入是外面来的,你不能假设它一定是四段。** 解包之前先 `len(parts) != 4` 检查一次,是同样的前置校验(Day 17)。后面的 `ticket_pairs.py` 就是这么写的。

## 你其实一直在用解包

### enumerate 给出的就是元组

Day 18 你写了 `for no, line in enumerate(tickets, start=1):`,当时只说「同时给编号和内容」。现在能说清楚了:`enumerate` 每一轮给出的是一个**二元元组** `(编号, 内容)`,`for` 后面的 `no, line` 就是在解包。新建 `part01/enumerate_tuple.py`:

```python
# agent-zero-lab/part01/enumerate_tuple.py
ids = ["T001", "T002", "T003"]

for item in enumerate(ids, start=1):
    print(item, type(item))

print(list(enumerate(ids, start=1)))

for no, ticket_id in enumerate(ids, start=1):
    print(no, ticket_id)
```

<div class="line-notes">

- `ids = ["T001", "T002", "T003"]` 三个工单号。
- `for item in enumerate(ids, start=1):` 只用**一个名字** `item` 接,不解包。
- `print(item, type(item))` 每轮打印这个东西和它的类型。
- `print(list(enumerate(ids, start=1)))` 把整个 `enumerate` 一次摊开成列表,看全貌。
- `for no, ticket_id in enumerate(ids, start=1):` 这是你熟悉的写法:两个名字,解包。
- `print(no, ticket_id)` 打印编号和工单号。

</div>

```text
$ uv run python part01/enumerate_tuple.py
(1, 'T001') <class 'tuple'>
(2, 'T002') <class 'tuple'>
(3, 'T003') <class 'tuple'>
[(1, 'T001'), (2, 'T002'), (3, 'T003')]
1 T001
2 T002
3 T003
```

<div class="line-notes">

- `(1, 'T001') <class 'tuple'>` 第 1 轮 `item` 是元组 `(1, 'T001')`。
- `(2, 'T002') <class 'tuple'>` 第 2 轮。
- `(3, 'T003') <class 'tuple'>` 第 3 轮。
- `[(1, 'T001'), (2, 'T002'), (3, 'T003')]` 摊开的全貌:一个列表,里面每项是 `(编号, 工单号)` 元组。
- `1 T001` 用两个名字解包,拿到的是同样的东西。
- `2 T002` 第二轮。
- `3 T003` 第三轮。

</div>

### zip:把两个列表按位置配成对

昨天的小项目里,金额和工单号是一对对放在一起的。如果它们本来在两个并排的列表里呢?`zip` 把它们按位置缝起来,每一对是一个元组。新建 `part01/zip_demo.py`:

```python
# agent-zero-lab/part01/zip_demo.py
ids = ["T201", "T203", "T204"]
fens = [29900, 46800, 4900]

print(list(zip(ids, fens)))
for ticket_id, fen in zip(ids, fens):
    print(f"{ticket_id} {fen // 100} 元")

short = [29900, 46800]
print(list(zip(ids, short)))
print(list(zip(ids, short, strict=False)))
```

<div class="line-notes">

- `ids = ["T201", "T203", "T204"]` 三个工单号。
- `fens = [29900, 46800, 4900]` 三个金额,位置和工单号一一对应:`T201` 对 29900,`T203` 对 46800。
- `print(list(zip(ids, fens)))` `zip` 本身和 `range`、`enumerate` 一样是个「延迟」的东西,套上 `list` 才看得到:`[('T201', 29900), ('T203', 46800), ('T204', 4900)]`,每一对是元组。
- `for ticket_id, fen in zip(ids, fens):` 遍历时直接解包成两个名字,同时走两个列表。
- `print(f"{ticket_id} {fen // 100} 元")` 打印 `T201 299 元`。
- `short = [29900, 46800]` 一个**短一截**的金额列表,只有两项。
- `print(list(zip(ids, short)))` 长度不一样时,`zip` **默默按最短的来**,第三个工单号 `T204` 被悄悄丢掉。
- `print(list(zip(ids, short, strict=False)))` `strict=False` 就是默认行为,明确写出来:结果和上一行一样。

</div>

```text
$ uv run python part01/zip_demo.py
[('T201', 29900), ('T203', 46800), ('T204', 4900)]
T201 299 元
T203 468 元
T204 49 元
[('T201', 29900), ('T203', 46800)]
[('T201', 29900), ('T203', 46800)]
```

<div class="line-notes">

- `[('T201', 29900), ('T203', 46800), ('T204', 4900)]` 三对。
- `T201 299 元` 第一对。
- `T203 468 元` 第二对。
- `T204 49 元` 第三对。
- `[('T201', 29900), ('T203', 46800)]` 金额列表只有两项,结果只有两对,`T204` 不见了,**没有任何提示**。
- `[('T201', 29900), ('T203', 46800)]` `strict=False` 和默认一样。

</div>

「悄悄丢数据」是个危险的默认。想让它长度不一致时直接报错,加 `strict=True`。`part01/zip_strict_error.py`:

```python
# agent-zero-lab/part01/zip_strict_error.py
ids = ["T201", "T203", "T204"]
short = [29900, 46800]
for ticket_id, fen in zip(ids, short, strict=True):
    print(ticket_id, fen)
```

<div class="line-notes">

- `ids = ["T201", "T203", "T204"]` 三项。
- `short = [29900, 46800]` 两项。
- `for ticket_id, fen in zip(ids, short, strict=True):` `strict=True` 要求两边必须一样长。
- `print(ticket_id, fen)` 前两对能正常打印。

</div>

```text
$ uv run python part01/zip_strict_error.py
T201 29900
T203 46800
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/zip_strict_error.py", line 4, in <module>
    for ticket_id, fen in zip(ids, short, strict=True):
                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
ValueError: zip() argument 2 is shorter than argument 1
```

<div class="line-notes">

- `T201 29900` 第一对。
- `T203 46800` 第二对。
- `ValueError: zip() argument 2 is shorter than argument 1` 轮到第三对时发现第二个列表没了,报错:第二个参数比第一个短。前两对已经处理过,**错是在中途才发现的**。`strict=True` 在 Python 3.10 才有,你的 3.12 没问题。

</div>

### 返回两个值的函数,其实返回的是元组

很多内置函数「一次给你两三样东西」,它们返回的都是元组。新建 `part01/tuple_returns.py`:

```python
# agent-zero-lab/part01/tuple_returns.py
result = divmod(59800, 3)
print(result, type(result))
each, left = divmod(59800, 3)
print("每月", each, "分,多出", left, "分")

left_part, sep, right_part = "plan=annual".partition("=")
print(left_part, sep, right_part)
print("no equals".partition("="))


def min_max(values):
    return min(values), max(values)


answer = min_max([29900, 4900, 59800])
print(answer, type(answer))
lo, hi = min_max([29900, 4900, 59800])
print("最小", lo, "最大", hi)
```

<div class="line-notes">

- `result = divmod(59800, 3)` `divmod(a, b)` 一次给出「商和余数」,等于 `(a // b, a % b)`(Day 12)。59800 分除以 3。
- `print(result, type(result))` 输出 `(19933, 1) <class 'tuple'>`:商 19933,余 1,是一个元组。
- `each, left = divmod(59800, 3)` 直接解包:`each` 是 19933,`left` 是 1。
- `print("每月", each, "分,多出", left, "分")` 把一笔 598 元分成三期,每期 19933 分,还多 1 分(练习 4 就用它)。
- `left_part, sep, right_part = "plan=annual".partition("=")` `partition` 是字符串的方法(Day 16 没讲):按**第一个**分隔符把字符串切成「前面、分隔符本身、后面」三段,返回三项元组,所以能直接解包。
- `print(left_part, sep, right_part)` 输出 `plan = annual`,三个值之间自动加了空格。
- `print("no equals".partition("="))` 字符串里没有分隔符时,不报错,给 `('no equals', '', '')`:原字符串加两个空串。比 `split` 更好用的地方是,不管有没有分隔符,**永远是三项**,解包永远不会个数不对。
- `def min_max(values):` 这是函数的写法,Day 28 才系统学,今天只要把这三行当作「会返回两个值的东西」抄下来用。`def` 后面是函数名,括号里是它接收的东西 `values`,冒号和缩进之后是函数体。
- `return min(values), max(values)` `return` 后面用逗号隔开两个值,**其实就是返回一个元组** `(最小, 最大)`,没有任何特殊语法。
- `answer = min_max([29900, 4900, 59800])` 调用它,不解包,拿到的就是元组。
- `print(answer, type(answer))` 输出 `(4900, 59800) <class 'tuple'>`。
- `lo, hi = min_max([29900, 4900, 59800])` 调用时直接解包。
- `print("最小", lo, "最大", hi)` `最小 4900 最大 59800`。

</div>

```text
$ uv run python part01/tuple_returns.py
(19933, 1) <class 'tuple'>
每月 19933 分,多出 1 分
plan = annual
('no equals', '', '')
(4900, 59800) <class 'tuple'>
最小 4900 最大 59800
```

<div class="line-notes">

- `(19933, 1) <class 'tuple'>` `divmod` 的结果。
- `每月 19933 分,多出 1 分` 解包之后的两个名字。
- `plan = annual` 三段:`plan`、`=`、`annual`。
- `('no equals', '', '')` 没有分隔符时的结果,依然是三项。
- `(4900, 59800) <class 'tuple'>` 自己写的函数返回的也是元组。
- `最小 4900 最大 59800` 解包后的两个名字。

</div>

「函数返回多个值」在 Python 里没有特殊机制,就是「返回一个元组,调用的地方顺手解包」。Agent 代码里这种写法非常多,比如「返回(回答, 花了多少钱)」「返回(是否成功, 错误信息)」。

## 回到排序:用元组装一对

回头看昨天的 `rows.append([fen, ticket_id])`,换成元组更合适。新建 `part01/pairs_sort.py`:

```python
# agent-zero-lab/part01/pairs_sort.py
pairs = [
    (29900, "T201"),
    (46800, "T203"),
    (4900, "T204"),
    (59800, "T206"),
    (29900, "T208"),
]

pairs.sort(reverse=True)
print(pairs)

top_fen, top_id = max(pairs)
print("最大的一张:", top_id, top_fen // 100, "元")

for rank, (fen, ticket_id) in enumerate(pairs, start=1):
    print(f"{rank}. {ticket_id} {fen // 100:>4} 元")

pairs.append((100, "T210"))
print(len(pairs), pairs[-1])
```

<div class="line-notes">

- `pairs = [` 一个列表,里面每项是 `(金额分, 工单号)` 的元组。数据和昨天 `ticket_amounts.py` 抠出来的一样:T201 和 T208 都是 29900。
- `(29900, "T201"),` 第一对,**圆括号**。
- `(46800, "T203"),` 第二对。
- `(4900, "T204"),` 第三对。
- `(59800, "T206"),` 第四对。
- `(29900, "T208"),` 第五对,和 T201 金额相同。
- `pairs.sort(reverse=True)` 昨天说过,列表按「先第一项、再第二项」比较;**元组比较规则一模一样**。倒序排好。
- `print(pairs)` 五个元组,从大到小。
- `top_fen, top_id = max(pairs)` `max` 能直接吃元组列表,按同样的规则比,返回**金额最大**的那一对;左边直接解包成两个名字。
- `print("最大的一张:", top_id, top_fen // 100, "元")` 打印 `T206 598 元`。
- `for rank, (fen, ticket_id) in enumerate(pairs, start=1):` **两层解包**:`enumerate` 给 `(名次, (金额, 工单号))`,左边 `rank, (fen, ticket_id)` 的括号对应里面那一层,一次拆成三个名字。
- `print(f"{rank}. {ticket_id} {fen // 100:>4} 元")` 和昨天一样的格式,`:>4` 右对齐占 4 格。
- `pairs.append((100, "T210"))` 列表还是可以增加项的:加进一个新元组。**注意是两层括号**:外面是 `append(...)` 的括号,里面是元组的括号。写成 `append(100, "T210")` 会报错,因为 `append` 只收一个东西。
- `print(len(pairs), pairs[-1])` 现在 6 个,最后一个是 `(100, 'T210')`。

</div>

```text
$ uv run python part01/pairs_sort.py
[(59800, 'T206'), (46800, 'T203'), (29900, 'T208'), (29900, 'T201'), (4900, 'T204')]
最大的一张: T206 598 元
1. T206  598 元
2. T203  468 元
3. T208  299 元
4. T201  299 元
5. T204   49 元
6 (100, 'T210')
```

<div class="line-notes">

- `[(59800, 'T206'), (46800, 'T203'), (29900, 'T208'), (29900, 'T201'), (4900, 'T204')]` 和昨天的排序结果一样,只是方括号换成了圆括号。金额并列的 `T208`、`T201`,按第二项倒序,`T208` 在前。
- `最大的一张: T206 598 元` `max` 的结果。
- `1. T206  598 元` 第一名。
- `2. T203  468 元` 第二名。
- `3. T208  299 元` 第三名。
- `4. T201  299 元` 第四名。
- `5. T204   49 元` 第五名。
- `6 (100, 'T210')` 加了一对之后共 6 个,最后一个是新的。

</div>

basedpyright 对这几个脚本没有意见。唯一要提的一处是:如果你在代码里直接比较两个**混合类型**的元组字面量,比如 `(29900, "T208") > (29900, "T201")`,编辑器会报红线 `Operator ">" not supported`,尽管运行时没问题(我写 `tuple_basics.py` 时撞到过,后来改成了通过 `sort`/`sorted` 间接看比较结果)。这是类型检查器对「里面是 int 又是 str 的元组」比较的一个保守判断,不是你写错了。

## 小项目:一行拆开一条工单

把今天的东西用在一个小任务上。场景:一批原始工单,里面混着残缺行和空行。要求:每行先检查是不是正好四段,不是的记进 `bad`(带上行号),是的就用解包拆成四个名字,存成 `(客户号, 工单号, 类别, 描述)` 的元组放进 `records`;最后打印好坏各几个,并把工单**按客户归拢**打印出来。新建 `part01/ticket_pairs.py`:

```python
# agent-zero-lab/part01/ticket_pairs.py
raw_lines = [
    "T201 计费 C023 8月2日重复扣款299元",
    "T202 登录 C007 验证码收不到",
    "T203 计费 C015 年付多扣了468元,要求退款",
    "T209 计费",
    "T204 计费 C042 发票金额对不上,多收了49元",
    "",
    "T205 功能 C031 导出PDF乱码",
    "T206 计费 C023 扣了两次,共598元",
    "T207 计费 C007 想把月付改成年付",
    "T208 计费 C031 退款299元到账了吗",
]

records = []
bad = []
for no, raw in enumerate(raw_lines, start=1):
    parts = raw.split(maxsplit=3)
    if len(parts) != 4:
        bad.append((no, raw))
        continue
    ticket_id, human, customer, desc = parts
    records.append((customer, ticket_id, human, desc))

print(f"好行 {len(records)} 张,坏行 {len(bad)} 行")
for no, raw in bad:
    print(f"  第 {no} 行不是四段:「{raw}」")

records.sort()

print()
print("按客户归拢:")
prev_customer = None
for customer, ticket_id, human, desc in records:
    if customer != prev_customer:
        print(f"{customer}:")
        prev_customer = customer
    print(f"    {ticket_id} {human} {desc}")
```

<div class="line-notes">

- `raw_lines = [` 10 行原始文本。第 4 行 `"T209 计费"` 只有两段,第 6 行是空串,都是坏行。工单号故意没按顺序(T209 夹在 T203 和 T204 之间)。
- `records = []` 装好的元组记录。
- `bad = []` 装坏行,每项是一个 `(行号, 原文)` 的元组。
- `for no, raw in enumerate(raw_lines, start=1):` `enumerate` 的元组被 `no, raw` 解包,`no` 是行号 1 到 10。
- `parts = raw.split(maxsplit=3)` 先拆成列表,不急着解包。空串 `"".split(maxsplit=3)` 得到空列表 `[]`。
- `if len(parts) != 4:` 前置校验:不是正好四项,就**不能**解包。`!=` 是「不等于」。第 4 行 `parts` 有 2 项,第 6 行有 0 项。
- `bad.append((no, raw))` 双层括号:加进去的是一个 `(行号, 原文)` 的元组。
- `continue` 这一行处理完了,回到 `for` 开头(Day 19)。
- `ticket_id, human, customer, desc = parts` 能走到这里,`parts` 一定是四项,放心解包。比如第 1 行得到 `ticket_id = "T201"`、`human = "计费"`、`customer = "C023"`、`desc = "8月2日重复扣款299元"`。
- `records.append((customer, ticket_id, human, desc))` **把客户号放在元组最前面**,为的是马上按它排序:元组按第一项先比。放进去的还是一个元组(双层括号)。
- `print(f"好行 {len(records)} 张,坏行 {len(bad)} 行")` 好行 8 张、坏行 2 行。
- `for no, raw in bad:` 遍历 `bad`,每项是 `(行号, 原文)` 的元组,**直接解包**。
- `print(f"  第 {no} 行不是四段:「{raw}」")` 空行会显示成 `「」`。
- `records.sort()` 不带参数的 `sort()` 对元组列表按「第一项客户号,相同再看第二项工单号」排序,同一个客户的工单会连在一起,而且组内按工单号排。
- `print()` 空一行。
- `print("按客户归拢:")` 小标题。
- `prev_customer = None` 记住「上一个客户号」,开始时没有上一个,用 `None`(Day 14)。
- `for customer, ticket_id, human, desc in records:` 遍历排好序的 `records`,每项四元组直接解包成四个名字。
- `if customer != prev_customer:` 和上一个客户号不一样,说明换了一个客户。第一轮时 `prev_customer` 是 `None`,`"C007" != None` 为真,所以第一个客户也会触发。
- `print(f"{customer}:")` 打印客户号作标题。
- `prev_customer = customer` 更新「上一个」。**漏掉这一行,每条工单都会重新打印标题**。
- `print(f"    {ticket_id} {human} {desc}")` 前面四个空格缩进,打印这个客户名下的工单。

</div>

```text
$ uv run python part01/ticket_pairs.py
好行 8 张,坏行 2 行
  第 4 行不是四段:「T209 计费」
  第 6 行不是四段:「」

按客户归拢:
C007:
    T202 登录 验证码收不到
    T207 计费 想把月付改成年付
C015:
    T203 计费 年付多扣了468元,要求退款
C023:
    T201 计费 8月2日重复扣款299元
    T206 计费 扣了两次,共598元
C031:
    T205 功能 导出PDF乱码
    T208 计费 退款299元到账了吗
C042:
    T204 计费 发票金额对不上,多收了49元
```

<div class="line-notes">

- `好行 8 张,坏行 2 行` 10 行里 8 好 2 坏。
- `  第 4 行不是四段:「T209 计费」` 第一条坏行,原文只有两段。
- `  第 6 行不是四段:「」` 第二条坏行,空串。
- `C007:` 客户 C007 排第一(字符串「C007」最小),名下两张。
- `    T202 登录 验证码收不到` C007 的第一张,工单号 T202 小于 T207。
- `    T207 计费 想把月付改成年付` C007 的第二张。
- `C015:` 换客户,`customer != prev_customer` 为真。
- `    T203 计费 年付多扣了468元,要求退款` C015 只有一张。
- `C023:` 第三个客户。
- `    T201 计费 8月2日重复扣款299元` C023 的第一张。
- `    T206 计费 扣了两次,共598元` C023 的第二张,两张都是计费,重复扣款加多扣。
- `C031:` 第四个客户。
- `    T205 功能 导出PDF乱码` C031 的第一张。
- `    T208 计费 退款299元到账了吗` C031 的第二张。
- `C042:` 最后一个客户。
- `    T204 计费 发票金额对不上,多收了49元` C042 的唯一一张。

</div>

这个「先排序、再遍历、遇到变化就换标题」的写法,是没有字典时按组整理数据的标准办法。[Day 24](/blog/agent-zero/day-024-dicts/) 学了字典,你会看到更直接的写法。

## 动手练习

### 练习 1:交换、轮转和收尾

写 `part01/ex22_1_rotate.py`:(1) `a, b, c = "T001", "T002", "T003"`,打印三个;(2) 只交换 `a` 和 `b`,不用临时变量,再打印;(3) 在此基础上让三个值整体轮转一格:`a` 拿到原来 `b` 的,`b` 拿到原来 `c` 的,`c` 拿到原来 `a` 的,一行写完;(4) 对 `ids = ["T301", "T302", "T303", "T304", "T305", "T306"]` 用一行解包同时取队头、队尾和中间的全部;(5) 再用一行只取最后两张。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex22_1_rotate.py
a, b, c = "T001", "T002", "T003"
print("开始:", a, b, c)

a, b = b, a
print("交换 a、b:", a, b, c)

a, b, c = b, c, a
print("轮转一格:", a, b, c)

ids = ["T301", "T302", "T303", "T304", "T305", "T306"]
head, *middle, tail = ids
print("队头", head, "队尾", tail, "中间", middle)

*_, last_two_a, last_two_b = ids
print("最后两张:", last_two_a, last_two_b)
```

<div class="line-notes">

- `a, b, c = "T001", "T002", "T003"` 右边没有括号也是元组,左边三个名字解包。
- `print("开始:", a, b, c)` `T001 T002 T003`。
- `a, b = b, a` 交换:右边先算出元组 `("T002", "T001")`,再分给 `a`、`b`。
- `print("交换 a、b:", a, b, c)` 现在 `a` 是 T002,`b` 是 T001,`c` 没动,仍是 T003。
- `a, b, c = b, c, a` 轮转:右边是 `(T001, T003, T002)`(取的都是**交换后**的值:`b` 是 T001,`c` 是 T003,`a` 是 T002),分给 `a`、`b`、`c`。**右边整个算完才开始赋值**,所以不会出现「`a` 先被改了、后面的 `a` 拿到新值」的问题。
- `print("轮转一格:", a, b, c)` `a` 是 T001,`b` 是 T003,`c` 是 T002。
- `ids = ["T301", "T302", "T303", "T304", "T305", "T306"]` 六张。
- `head, *middle, tail = ids` 头、尾各一个,中间全进 `middle`。
- `print("队头", head, "队尾", tail, "中间", middle)` `middle` 是 `['T302', 'T303', 'T304', 'T305']`。
- `*_, last_two_a, last_two_b = ids` 星号名字放最前面,前面的全部收进 `_`(不要),后两项分别给两个名字。`*_` 是「收集起来然后丢掉」的习惯写法。
- `print("最后两张:", last_two_a, last_two_b)` `T305 T306`。

</div>

```text
$ uv run python part01/ex22_1_rotate.py
开始: T001 T002 T003
交换 a、b: T002 T001 T003
轮转一格: T001 T003 T002
队头 T301 队尾 T306 中间 ['T302', 'T303', 'T304', 'T305']
最后两张: T305 T306
```

<div class="line-notes">

- `开始: T001 T002 T003` 起点。
- `交换 a、b: T002 T001 T003` `a`、`b` 换了位置。
- `轮转一格: T001 T003 T002` 注意起点是上一行的结果,所以不是 T002 T003 T001。
- `队头 T301 队尾 T306 中间 ['T302', 'T303', 'T304', 'T305']` 头、尾、中间。
- `最后两张: T305 T306` 最后两项。

</div>

</details>

### 练习 2:先猜,再跑

不要先运行。下面这段代码的五行输出分别是什么?先写下答案再核对。提示:想想哪一行里的括号根本不是元组、哪一行的元组「改」了。

```python
# agent-zero-lab/part01/ex22_2_guess.py
t = (["T001"], 2)
t[0].append("T002")
x = (5)  # fmt: skip
y = (5,)
z = 1, 2
w = z + (3,)

print(t)
print(type(x), type(y))
print(z, w)
print(sorted([(10, "a"), (2, "a")]), sorted([("10", "a"), ("2", "a")]))
print(len(()), len((1,)), len((1, 2, 3)))
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex22_2_guess.py
(['T001', 'T002'], 2)
<class 'int'> <class 'tuple'>
(1, 2) (1, 2, 3)
[(2, 'a'), (10, 'a')] [('10', 'a'), ('2', 'a')]
0 1 3
```

<div class="line-notes">

- `(['T001', 'T002'], 2)` `t[0].append("T002")` 改的是元组里的**列表**,元组允许,所以第 0 项那个列表变长了。
- `<class 'int'> <class 'tuple'>` `x = (5)` 是整数,`y = (5,)` 才是元组。
- `(1, 2) (1, 2, 3)` `z` 是 `(1, 2)`,没有括号也是元组;`z + (3,)` 把两个元组拼成一个**新**元组 `(1, 2, 3)`,`z` 自己不变。注意 `(3,)` 的逗号不能省,`z + (3)` 会报 `TypeError`,因为元组不能和整数相加。
- `[(2, 'a'), (10, 'a')] [('10', 'a'), ('2', 'a')]` 第一个列表是按**数值**排的,2 在 10 前面;第二个是按**字符串**排的,`'10'` 的第一个字符 `1` 小于 `'2'` 的 `2`,所以 `'10'` 在前。元组按位置依次比较,每一项用自己的比较规则。
- `0 1 3` `()` 的长度是 0,`(1,)` 是 1,`(1, 2, 3)` 是 3。

</div>

</details>

### 练习 3:找出两个错

下面两段代码各有一个问题,一个会崩,一个不崩但行为不对。运行它们,说出病因和改法。

```python
# agent-zero-lab/part01/ex22_3_bug.py
line = "T001 计费 C023 8月2日重复扣款299元"
ticket_id, human, customer = line.split()
print(ticket_id, human, customer)
```

```python
# agent-zero-lab/part01/ex22_3_bug_b.py
ids = ("T001")  # fmt: skip
for ticket_id in ids:
    print("处理", ticket_id)
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex22_3_bug.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex22_3_bug.py", line 3, in <module>
    ticket_id, human, customer = line.split()
    ^^^^^^^^^^^^^^^^^^^^^^^^^^
ValueError: too many values to unpack (expected 3)
$ uv run python part01/ex22_3_bug_b.py
处理 T
处理 0
处理 0
处理 1
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/ex22_3_bug.py", line 3, in <module>` 第一段崩在第 3 行。
- `ticket_id, human, customer = line.split()` 崩的那行。`split()` 不带参数,把整行按空白拆开:`T001`、`计费`、`C023`、`8月2日重复扣款299元`,**4 项**,左边只有 3 个名字。
- `ValueError: too many values to unpack (expected 3)` 值太多,期望 3 个。改法:左边补一个名字 `desc`,并且用 `split(maxsplit=3)`,因为描述里可能还有空格(Day 16),不加 `maxsplit` 的话描述里一有空格就会又变成五项。
- `处理 T` 第二段没报错,但处理的不是工单号 `T001`,而是它的每个**字符**。
- `处理 0` 第二个字符。
- `处理 0` 第三个字符。
- `处理 1` 第四个字符。病因:`("T001")` 不是元组,只是加了括号的字符串 `"T001"`,`for` 遍历字符串就是一个字符一个字符(Day 18)。改法:`ids = ("T001",)`,加上逗号。**这种错不报错,只是行为不对,最难发现。**

</div>

改完的版本 `part01/ex22_3_fixed.py`:

```python
# agent-zero-lab/part01/ex22_3_fixed.py
line = "T001 计费 C023 8月2日重复扣款299元"
ticket_id, human, customer, desc = line.split(maxsplit=3)
print(ticket_id, human, customer)

ids = ("T001",)
for ticket_id in ids:
    print("处理", ticket_id)
```

<div class="line-notes">

- `line = "T001 计费 C023 8月2日重复扣款299元"` 同一行文本。
- `ticket_id, human, customer, desc = line.split(maxsplit=3)` 名字补成四个,`maxsplit=3` 保证至多四项。
- `print(ticket_id, human, customer)` 只打印前三个。`desc` 虽然没用到,但它得有,否则个数对不上;不想要的话也可以写成 `_`。
- `ids = ("T001",)` 单项元组,**逗号不能少**。
- `for ticket_id in ids:` 遍历这个只有一项的元组。
- `print("处理", ticket_id)` 只会打印一次。

</div>

```text
$ uv run python part01/ex22_3_fixed.py
T001 计费 C023
处理 T001
```

<div class="line-notes">

- `T001 计费 C023` 解包成功。
- `处理 T001` 整个工单号一次,不是一个个字符。

</div>

</details>

### 练习 4:把一笔钱分成几期

一笔 598 元的年费想分 3 期付,一笔 100 元的想分 7 期付,单位用分。除不尽的零头不能丢也不能多:把余数的「分」一分一分地加到前面几期上,每期最多多 1 分。写 `part01/ex22_4_split_fee.py`:对每组 `(总额, 期数)`,用 `divmod` 算出每期基数和余数,生成 `[(第几期, 金额分), ...]` 的方案,打印方案,并检查各期加起来等于总额。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex22_4_split_fee.py
cases = ((59800, 3), (10000, 7))

for total, months in cases:
    each, left = divmod(total, months)
    plan = []
    for month in range(1, months + 1):
        fen = each + (1 if month <= left else 0)
        plan.append((month, fen))

    print(f"总额 {total} 分,分 {months} 期:每期 {each} 分,余 {left} 分")
    print("  方案:", plan)

    paid = 0
    for _, fen in plan:
        paid += fen
    print("  合计", paid, "分,和原数一致:", paid == total)
```

<div class="line-notes">

- `cases = ((59800, 3), (10000, 7))` 一个元组,里面两个元组:每个是 `(总额分, 期数)`。这里全都不会变,所以用元组而不是列表。
- `for total, months in cases:` 遍历 `cases`,每轮把 `(总额, 期数)` 解包成两个名字。第 1 轮 `total` 是 59800,`months` 是 3。
- `each, left = divmod(total, months)` 商和余数一次解包:59800 除以 3 是 `each = 19933`、`left = 1`;10000 除以 7 是 `each = 1428`、`left = 4`。
- `plan = []` 装这一组的方案。每轮外层循环都重新建一个空的,不会混进上一组。
- `for month in range(1, months + 1):` 第几期,从 1 数到 `months`(Day 18:终点不含,所以 `+ 1`)。
- `fen = each + (1 if month <= left else 0)` 前 `left` 期各多 1 分:用 Day 17 的条件表达式,`month <= left` 为真就加 1,否则加 0。3 期时只有第 1 期 `1 <= 1` 成立。
- `plan.append((month, fen))` 加进去一个 `(期数, 金额)` 的元组。
- `print(f"总额 {total} 分,分 {months} 期:每期 {each} 分,余 {left} 分")` 标题行,把总额、期数、基数和余数一次说清。
- `print("  方案:", plan)` 打印整个方案。
- `paid = 0` 累加器。
- `for _, fen in plan:` 遍历方案,每项解包:第一个名字用 `_`,因为这里不需要期数。
- `paid += fen` 把每期金额累加。
- `print("  合计", paid, "分,和原数一致:", paid == total)` 检查:`paid == total` 为 `True` 才对。**凡是「拆分」的东西,最后一定要加回去核一遍。**

</div>

```text
$ uv run python part01/ex22_4_split_fee.py
总额 59800 分,分 3 期:每期 19933 分,余 1 分
  方案: [(1, 19934), (2, 19933), (3, 19933)]
  合计 59800 分,和原数一致: True
总额 10000 分,分 7 期:每期 1428 分,余 4 分
  方案: [(1, 1429), (2, 1429), (3, 1429), (4, 1429), (5, 1428), (6, 1428), (7, 1428)]
  合计 10000 分,和原数一致: True
```

<div class="line-notes">

- `总额 59800 分,分 3 期:每期 19933 分,余 1 分` 第一组:59800 = 19933 × 3 + 1。
- `  方案: [(1, 19934), (2, 19933), (3, 19933)]` 只有第 1 期多 1 分。
- `  合计 59800 分,和原数一致: True` 19934 + 19933 + 19933 = 59800。
- `总额 10000 分,分 7 期:每期 1428 分,余 4 分` 第二组:10000 = 1428 × 7 + 4。
- `  方案: [(1, 1429), (2, 1429), (3, 1429), (4, 1429), (5, 1428), (6, 1428), (7, 1428)]` 前 4 期各多 1 分,后 3 期是基数。
- `  合计 10000 分,和原数一致: True` 1429 × 4 + 1428 × 3 = 5716 + 4284 = 10000。

</div>

如果直接用 `total / months` 做浮点除法,就会得到 19933.33……,分不清零头。Day 12 讲过的「金额用整数分」加上 `divmod`,才能让每一分都有去处。

</details>

**验收标准**:`ticket_pairs.py` 能默写出来,去掉 `len(parts) != 4` 能说出是哪一行崩、报什么错;能说清 `(5)` 和 `(5,)` 的区别;能不看文章说出 `enumerate`、`zip`、`divmod` 各返回什么;4 道练习都做对,Ruff 通过。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 元组(tuple) | 用圆括号(其实是逗号)写的一小组值,建好之后不能改,例如 `(29900, "T201")` |
| 不可变(immutable) | 建好之后不能原地修改。数字、字符串、元组都是,列表不是 |
| 单项元组 | 只有一项的元组,必须写成 `(5,)`;`(5)` 只是括号里的一个数 |
| 解包(unpacking) | 把一小组值按位置分给几个名字,例如 `a, b = pair`,相当于 JS 的解构赋值 |
| 打包(packing) | 反过来,把几个值用逗号放到一起得到元组,例如 `pair = 1, 2` |
| 星号解包 | `first, *rest = items`,带星号的名字收集「剩下的」,收到的是列表 |
| `_`(下划线名字) | 约定俗成的「这一项我不要」,本质是个普通变量名 |
| `ValueError: not enough values to unpack` | 右边的项比左边的名字少 |
| `ValueError: too many values to unpack` | 右边的项比左边的名字多 |
| `zip` | 把几个列表按位置缝成一对对的元组,遇到最短的就停 |
| `strict=True` | `zip` 的参数,要求几个列表一样长,否则报 `ValueError` |
| `divmod(a, b)` | 一次返回商和余数,等于 `(a // b, a % b)` |
| `str.partition(分隔符)` | 按第一个分隔符把字符串切成「前、分隔符、后」三项元组,永远是三项 |
| 条件表达式 | `值1 if 条件 else 值2`,Day 17 的 `ternary.py` 讲过 |
| 前置校验 | 解包前先检查个数,Day 17 起反复用的思路 |

## 常见误区

**以为圆括号就是元组。** 造元组的是逗号。`(5)` 是整数 5;单项元组要写 `(5,)`。`ids = ("T001")` 会让 `for` 一个字符一个字符地遍历,不报错,最难发现。

**想改元组里的某一项。** `pair[0] = x` 报 `TypeError: 'tuple' object does not support item assignment`。要新版本就造新元组,或者一开始就该用列表。

**以为元组里的东西一定不会变。** 元组里放了列表,列表还是能 `append`。别在元组里放可变的东西。

**解包个数对不上。** `not enough values to unpack` 或 `too many values to unpack`。外面来的数据先 `len(...)` 检查一次,再解包;或者用 `partition`、星号名字这类「个数永远固定」的写法。

**星号名字写了两个。** `a, *b, *c = items` 不允许:`SyntaxError: multiple starred expressions in assignment`。一次解包最多一个星号。

**`zip` 悄悄丢数据。** 两个列表长度不一样时,多出来的部分默默消失。重要数据加 `strict=True`,让它当场报错。

**`append` 一个元组时少写一层括号。** `pairs.append(100, "T210")` 会报错,`append` 只收一个东西,要写 `pairs.append((100, "T210"))`。

**每轮都忘了更新「上一个」。** 按组打印那种「遇到变化就换标题」的写法,漏了 `prev_customer = customer` 就会每一行都打印标题。

**用 `_` 当有用的变量名。** `_` 表示「我不用它」,别用它存后面还要读的东西,不然读代码的人会被误导。

## 学习资料

### 文档与文章

- [Python 教程 · 元组和序列](https://docs.python.org/zh-cn/3.12/tutorial/datastructures.html#tuples-and-sequences):中文,官方教程里元组和「序列解包」的一节,有 `()`、`(5,)` 的写法和解包例子,很短。
- [Python 标准库 · 元组 tuple](https://docs.python.org/zh-cn/3.12/library/stdtypes.html#tuple):中文,元组的正式参考,什么时候该用元组也在里面。
- [Python 语言参考 · 赋值语句](https://docs.python.org/zh-cn/3.12/reference/simple_stmts.html#assignment-statements):中文,解包规则的精确说明,包括星号目标。内容偏正式,不用一次读完,遇到不懂的解包写法再来查。
- [内置函数 · zip](https://docs.python.org/zh-cn/3.12/library/functions.html#zip)、[divmod](https://docs.python.org/zh-cn/3.12/library/functions.html#divmod)、[enumerate](https://docs.python.org/zh-cn/3.12/library/functions.html#enumerate):中文,三个返回元组的内置函数,`zip` 里有 `strict` 的说明。
- [MDN · 解构赋值](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Operators/Destructuring_assignment):中文,JS 一侧对照,Python 的解包是它的近亲。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Mv411e7HN&autoplay=0&high_quality=1" title="Python基础语法：元组" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>周周学Python · Python基础语法:元组 · 10 分钟,元组的写法、不可变、和列表的对比,对应今天的前半部分。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV14N411K7Ya&autoplay=0&high_quality=1" title="Python元组拆包" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Python很简单 · Python元组拆包 · 4 分钟,专讲解包,看完对照 `unpack_basic.py` 一遍。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1QJ4m1b7tE&autoplay=0&high_quality=1" title="【Python摸鱼读物】*：别只把它当乘号，还能打包和解包" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Hucci写代码 · 【Python摸鱼读物】*:别只把它当乘号,还能打包和解包 · 8 分钟,星号解包讲得细;视频里还讲到 `**` 和函数参数,那部分现在跳过,Day 28 以后再看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/W8KRzm-HUcc" title="Python Tutorial for Beginners 4: Lists, Tuples, and Sets" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial for Beginners 4: Lists, Tuples, and Sets · 英文,昨天看了列表那段,今天看元组那段(不可变、和列表的取舍),集合留到 Day 25。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/VESPAxGehg4" title="Learn How to Use UNPACKING in Python in Just 8 Minutes! | #15" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Coding with David · Learn How to Use UNPACKING in Python in Just 8 Minutes! · 英文,8 分钟讲清解包、星号和交换,例子很小。</figcaption>
</figure>

### 书籍

- Eric Matthes《Python Crash Course》第 3 版,No Starch Press,2023(中译《Python编程:从入门到实践》)。第 4 章「Working with Lists」末尾有「Tuples」一节,讲元组为什么用圆括号、为什么不能改。
- Allen B. Downey《Think Python》第 3 版,O'Reilly,2024,[第 11 章 Tuples](https://allendowney.github.io/ThinkPython/chap11.html) 免费在线读,元组、元组赋值(就是解包)、作为返回值和 `zip` 都有。
- Luciano Ramalho《Fluent Python》第 2 版,O'Reilly,2022。第 2 章「An Array of Sequences」里「Tuples Are Not Just Immutable Lists」和「Unpacking sequences and iterables」两节,讲得比课里深,以后想再理解元组可以回来读,今天不用。

### 开源项目与代码

- [Asabeneh/30-Days-Of-Python · Day 6 Tuples](https://github.com/Asabeneh/30-Days-Of-Python/tree/master/06_Day_Tuples):英文,元组的创建、取值、切片、转换和一批练习。
- [jackfrued/Python-100-Days · 10.常用数据结构之元组](https://github.com/jackfrued/Python-100-Days/blob/master/Day01-20/10.常用数据结构之元组.md):中文,元组的创建、运算、打包和解包,以及「为什么有了列表还需要元组」的几条理由。

## 自测

1. `x = ("T001")` 和 `x = ("T001",)` 有什么区别?`for c in x:` 各打印什么?

<details><summary>答案</summary>

前者是字符串 `"T001"`(括号只是括号),后者是只有一项的元组。`for c in x:` 前者打印 `T`、`0`、`0`、`1` 四个字符,后者打印一次 `T001`。

</details>

2. 下面哪一行会报错?报什么?

```python
pair = (29900, "T201")
pair[1] = "T999"
a, b = pair
a, b, c = pair
```

<details><summary>答案</summary>

第 2 行报 `TypeError: 'tuple' object does not support item assignment`;第 3 行正常,`a` 是 29900、`b` 是 `"T201"`;第 4 行报 `ValueError: not enough values to unpack (expected 3, got 2)`。注意脚本在第 2 行就停了,后两行不会跑到,这里是分别说明。

</details>

3. 怎样一行把 `["T001", "T002", "T003", "T004"]` 拆成「第一个」和「剩下的」?怎样不用临时变量交换 `a`、`b`?

<details><summary>答案</summary>

`first, *rest = ids`,`first` 是 `"T001"`,`rest` 是 `["T002", "T003", "T004"]`。交换:`a, b = b, a`。

</details>

4. `for no, line in enumerate(lines, start=1):` 里,`enumerate` 每一轮给出的是什么?这个逗号在做什么?

<details><summary>答案</summary>

每轮给出一个二元元组 `(编号, 内容)`,比如 `(1, 'T001')`。`for` 后面的逗号让 Python 把它**解包**,第一项给 `no`,第二项给 `line`。

</details>

5. **面试题**:Python 里列表和元组的区别是什么?什么时候该用元组?

<details><summary>答案</summary>

列表可变、元组不可变;列表通常放同类的一批、数量会变,元组放不同类的一小组、位置固定。元组不能改,所以更安全,也能当字典的键(列表不行)。「不可变」是浅的:元组里放的列表仍能被修改。函数一次返回多个值,返回的就是元组。

</details>

6. `list(zip(["T1", "T2", "T3"], [100, 200]))` 的结果是什么?怎样让它在长度不一样时报错?

<details><summary>答案</summary>

`[('T1', 100), ('T2', 200)]`,`T3` 被悄悄丢掉。给 `zip` 加 `strict=True`,长度不一致就报 `ValueError: zip() argument 2 is shorter than argument 1`。

</details>

## 明天预告

Day 23 · 列表推导式。今天的 `ticket_pairs.py` 和昨天的 `ticket_amounts.py` 里,有一种写法反复出现:先造一个空列表,`for` 遍历一批,`if` 筛一下,把要的 `append` 进去,比如 `kept = []` 加三四行。明天学把这四五行压成一行:`[t for t in tickets if "退款" in t]`,相当于 JS 里 `tickets.filter(...)` 加 `map(...)`。学完你就能一行筛出所有退款工单。
