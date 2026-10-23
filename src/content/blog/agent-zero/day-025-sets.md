---
title: 'Day 25 · 集合:去重和集合运算'
description: '集合是一堆不重复、没有顺序的东西,相当于 JS 的 Set。今天学会一行去重,用 add、discard 增删,知道空集合要写 set() 而不是 {},并用 &、|、- 找出两批工单哪些重复、哪些是新增、哪些消失了。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 25
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 24](/blog/agent-zero/day-024-dicts/) 学了字典:`ticket["amount"]` 用名字找值,`.get("customer", "未知")` 避开 `KeyError`,`.items()` 同时拿到键和值,`counts[k] = counts.get(k, 0) + 1` 按类别计数。最后的 `ticket_dicts.py` 里有一个 `by_id` 字典,键是工单号,用 `"T999" in by_id` 判断有没有这张工单。

这里有一个细节:`by_id` 的值是整张工单,但 `"T999" in by_id` 只看键,值根本没用上。很多时候你想问的只是「有没有」:这个客户号出现过吗?这张工单在昨天的导出里有吗?不需要数量,不需要对应的值。只留键、不要值的容器,就是今天的集合(set)。它还能一行去掉重复,并且能直接做「两批数据的交集、并集、差集」。

## 今天要解决的问题

学完今天,你应该能:

1. 写出集合 `{"退款", "计费"}` 和 `set(["C023", "C007", "C023"])`,说清它的三个特点:不重复、没有顺序、不能按位置取;用 `add`、`discard`、`remove` 增删,认得三个报错:`AttributeError: 'dict' object has no attribute 'add'`(把空集合写成了 `{}`)、`KeyError`(`remove` 删不存在的东西)、`TypeError: 'set' object is not subscriptable`(想用 `s[0]`)。
2. 用 `set(列表)` 去重,知道结果的顺序**每次运行都可能不同**,所以打印前要 `sorted(...)`;需要保持原来的顺序时用 `list(dict.fromkeys(列表))`。
3. 会用 `&`(交集)、`|`(并集)、`-`(差集)、`^`(对称差)回答「两批数据里哪些相同、哪些不同」,并分清 `A - B` 和 `B - A` 不是同一个结果。
4. 写出 `part01/batch_diff.py`:拿昨天和今天两份工单导出,找出新增的、消失的、两天都在的,以及今天导出里重复的工单号,再找出同时提过退款和登录问题的客户。

预计用时:2.5 小时。集合基础和去重 50 分钟,集合运算 40 分钟,小项目 30 分钟,剩下做练习。

前置:[Day 21](/blog/agent-zero/day-021-lists/)(列表、`sorted`)、[Day 22](/blog/agent-zero/day-022-tuples-unpack/)(元组)、[Day 23](/blog/agent-zero/day-023-comprehensions/)(列表推导式)、[Day 24](/blog/agent-zero/day-024-dicts/)(字典、`in` 判键、计数句式)。今天不调任何 API,花费 0 元。

学法提示:先对照文章逐行敲一遍(代码自己敲,不复制粘贴)并跑通;第二天合上文章,把 `batch_diff.py` 默写出来,默写时先用三个字写出每一行要回答的问题(新增?消失?重复?);然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚我是在哪跑的

输出是我 2026-10-23 在 2019 款 Intel MacBook Pro(macOS 14、zsh)上用演示家目录真跑的,家目录显示成 `/Users/你`,`~/agent-zero-lab` 接着 Day 24 的状态,`uv run python` 是 3.12.13,Ruff 是 0.17.2,basedpyright 是 standard 档。今天的脚本都放在 `part01/`,在仓库根目录用 `uv run python part01/文件名.py` 运行,不读键盘输入。

## 先看 JS 的 Set

JS 的 `Set` 你多半用过:数组去重 `[...new Set(arr)]`。先在 Node 里看一遍,今天的 Python 写法和它们一一对应:

```text
$ node -e '
const customers = ["C023", "C007", "C023", "C015", "C007"];
const unique = new Set(customers);
console.log(unique, unique.size);
console.log([...unique]);
unique.add("C042");
unique.add("C042");
console.log(unique.has("C042"), unique.delete("C999"));

const a = new Set(["T301", "T302", "T303"]);
const b = new Set(["T302", "T303", "T304"]);
console.log(a.intersection(b));
console.log(a.union(b));
console.log(a.difference(b));
console.log([...a].filter((x) => b.has(x)));
'
Set(3) { 'C023', 'C007', 'C015' } 3
[ 'C023', 'C007', 'C015' ]
true false
Set(2) { 'T302', 'T303' }
Set(4) { 'T301', 'T302', 'T303', 'T304' }
Set(1) { 'T301' }
[ 'T302', 'T303' ]
```

<div class="line-notes">

- `const customers = ["C023", "C007", "C023", "C015", "C007"];` 五个客户号,有重复。
- `const unique = new Set(customers);` 用数组造一个 `Set`,重复的自动去掉。
- `console.log(unique, unique.size);` 输出 `Set(3) { 'C023', 'C007', 'C015' } 3`。JS 的 `Set` 记着放入的顺序,个数用 `.size`(Python 用 `len`)。
- `console.log([...unique]);` 展开成数组,JS 里「数组去重」的经典一行。
- `unique.add("C042");` 加一个。
- `unique.add("C042");` 再加同一个:没有效果,不报错。Python 也是这样。
- `console.log(unique.has("C042"), unique.delete("C999"));` `has` 问在不在,得到 `true`;`delete` 删一个不存在的,不报错,只是返回 `false`。Python 里对应的是 `discard`,而 `remove` 会报错。
- `const a = new Set(["T301", "T302", "T303"]);` 昨天的三张工单。
- `const b = new Set(["T302", "T303", "T304"]);` 今天的三张工单。
- `console.log(a.intersection(b));` 交集:两边都有的 `T302`、`T303`。这些 `intersection`、`union`、`difference` 方法是 JS 比较新的写法(Node 22 以后、近两年的浏览器才有),你的项目里如果浏览器要兼容旧版本,别直接用。
- `console.log(a.union(b));` 并集:四张。
- `console.log(a.difference(b));` 差集:`a` 里有、`b` 里没有的 `T301`。
- `console.log([...a].filter((x) => b.has(x)));` 老写法,没有 `intersection` 的年代前端都这样手写:先展开成数组,再用 `filter` 加 `has` 筛交集。Python 不用这么麻烦,有直接的运算符。

</div>

| 想做的事 | JS | Python |
| --- | --- | --- |
| 建 | `new Set(arr)` | `set(列表)` 或 `{"a", "b"}` |
| 空的 | `new Set()` | `set()`(**不是** `{}`) |
| 个数 | `s.size` | `len(s)` |
| 加 | `s.add(x)` | `s.add(x)` |
| 删(不存在不报错) | `s.delete(x)` | `s.discard(x)` |
| 删(不存在报错) | 没有 | `s.remove(x)` |
| 在不在 | `s.has(x)` | `x in s` |
| 数组去重 | `[...new Set(arr)]` | `list(set(列表))`,但顺序可能变 |
| 交集 | `a.intersection(b)` | `a & b` |
| 并集 | `a.union(b)` | `a \| b` |
| 差集 | `a.difference(b)` | `a - b` |

有一个重要的差别:JS 的 `Set` 记着你放进去的顺序,遍历出来就是那个顺序;**Python 的集合不保证顺序**,而且同一段代码每次运行出来的顺序都可能不一样。后面会亲眼看到。

## 集合:一堆不重复的东西

### 建一个集合,一行去重

新建 `part01/set_basic.py`:

```python
# agent-zero-lab/part01/set_basic.py
customers = ["C023", "C007", "C023", "C015", "C007", "C023"]
print(customers, len(customers))

unique = set(customers)
print(sorted(unique), len(unique))

tags = {"退款", "计费", "登录"}
print(sorted(tags), len(tags))

print("C007" in unique, "C999" in unique)

unique.add("C042")
unique.add("C042")
print(sorted(unique), len(unique))

unique.discard("C007")
unique.discard("C999")
print(sorted(unique))

unique.remove("C015")
print(sorted(unique))

print(type(unique), type({}), type(set()))
empty = set()
print(len(empty), bool(empty))
```

<div class="line-notes">

- `customers = ["C023", "C007", "C023", "C015", "C007", "C023"]` 六张工单的客户号,有重复:`C023` 三次,`C007` 两次,`C015` 一次。
- `print(customers, len(customers))` 列表原样 6 项。
- `unique = set(customers)` `set(...)` 把一个列表(或任何「一串东西」)变成集合,重复的自动去掉。
- `print(sorted(unique), len(unique))` 为什么要 `sorted`?因为直接打印集合顺序不固定(下面马上演示)。`sorted` 把它排成一个列表(Day 21):`['C007', 'C015', 'C023']`,3 个不同的客户。
- `tags = {"退款", "计费", "登录"}` 另一种建法:花括号里直接写元素,**只有值、没有冒号**,和字典的花括号长得像,区别就在有没有冒号。
- `print(sorted(tags), len(tags))` 3 个标签,中文按码点排序(Day 21):`['登录', '计费', '退款']`。
- `print("C007" in unique, "C999" in unique)` `in` 问元素在不在:`True False`。
- `unique.add("C042")` `add` 加一个新元素。
- `unique.add("C042")` 再加同一个:没有效果,也不报错,因为集合里已经有了。
- `print(sorted(unique), len(unique))` 现在 4 个:`C007`、`C015`、`C023`、`C042`,没有因为加了两次变成 5 个。
- `unique.discard("C007")` `discard` 删一个元素。
- `unique.discard("C999")` 删一个**不存在**的元素:不报错,什么都不发生。
- `print(sorted(unique))` 少了 `C007`:`['C015', 'C023', 'C042']`。
- `unique.remove("C015")` `remove` 也是删,区别在下一小节:它要求元素必须存在。这次 `C015` 在,所以没问题。
- `print(sorted(unique))` 剩 `['C023', 'C042']`。
- `print(type(unique), type({}), type(set()))` 三个类型:`set`、`dict`、`set`。注意第二个:**空花括号 `{}` 是字典**,不是集合。
- `empty = set()` 空集合只能这样写,`set()` 不带参数。
- `print(len(empty), bool(empty))` 长度 0,当条件用是假,和空列表、空字典一样。

</div>

```text
$ cd ~/agent-zero-lab
$ uv run python part01/set_basic.py
['C023', 'C007', 'C023', 'C015', 'C007', 'C023'] 6
['C007', 'C015', 'C023'] 3
['登录', '计费', '退款'] 3
True False
['C007', 'C015', 'C023', 'C042'] 4
['C015', 'C023', 'C042']
['C023', 'C042']
<class 'set'> <class 'dict'> <class 'set'>
0 False
```

<div class="line-notes">

- `['C023', 'C007', 'C023', 'C015', 'C007', 'C023'] 6` 原来的列表,6 项。
- `['C007', 'C015', 'C023'] 3` 去重后 3 个,排序后输出。
- `['登录', '计费', '退款'] 3` 三个标签。
- `True False` `C007` 在,`C999` 不在。
- `['C007', 'C015', 'C023', 'C042'] 4` 加了 `C042`,加两次也只算一个。
- `['C015', 'C023', 'C042']` `discard` 掉 `C007`;`discard` 不存在的 `C999` 没有任何影响。
- `['C023', 'C042']` `remove` 掉 `C015`。
- `<class 'set'> <class 'dict'> <class 'set'>` `{}` 是 `dict`。
- `0 False` 空集合。

</div>

画个图,看 `set(...)` 把六个客户号变成什么:

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="左边是六格的列表 C023 C007 C023 C015 C007 C023,经过 set 之后变成右边三个不重复的元素 C023 C007 C015,没有顺序编号;重复的三个被合并了">
<rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-soft)">列表 customers:6 项,有顺序,有重复</text>
<rect x="20" y="40" width="80" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="34" y="62" fill="var(--ink)">C023</text>
<rect x="106" y="40" width="80" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="120" y="62" fill="var(--ink)">C007</text>
<rect x="192" y="40" width="80" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
<text x="206" y="62" fill="var(--ink-faint)">C023</text>
<rect x="278" y="40" width="80" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="292" y="62" fill="var(--ink)">C015</text>
<rect x="364" y="40" width="80" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
<text x="378" y="62" fill="var(--ink-faint)">C007</text>
<rect x="450" y="40" width="80" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
<text x="464" y="62" fill="var(--ink-faint)">C023</text>
<text x="20" y="96" fill="var(--ink-faint)">虚线框是重复出现的,会被合并掉</text>
<line x1="320" y1="104" x2="320" y2="132" stroke="var(--ink-faint)"/>
<text x="332" y="124" fill="var(--ink-soft)">set(customers)</text>
<text x="20" y="152" fill="var(--ink-soft)">集合 unique:3 个,没有编号,没有重复</text>
<rect x="20" y="164" width="80" height="34" rx="17" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="34" y="186" fill="var(--ink)">C023</text>
<rect x="116" y="164" width="80" height="34" rx="17" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="130" y="186" fill="var(--ink)">C007</text>
<rect x="212" y="164" width="80" height="34" rx="17" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="226" y="186" fill="var(--ink)">C015</text>
<text x="320" y="186" fill="var(--ink-soft)">只能问「在不在」,不能问「第几个」</text>
</g>
</svg>
<figcaption>集合像一个口袋:每样东西最多放一份,放进去就没有编号了。重复的 C023 和 C007 被合并。</figcaption>
</figure>

### 空集合要写 set(),不是 {}

这是 JS 程序员的又一个坑:你想建一个空集合,顺手写了 `{}`。新建 `part01/set_empty_trap.py`:

```python
# agent-zero-lab/part01/set_empty_trap.py
seen = {}
print(type(seen))
seen.add("C023")
print(seen)
```

<div class="line-notes">

- `seen = {}` 想要一个空集合,用来记「见过哪些客户」。
- `print(type(seen))` 打印类型,先看看它到底是什么。
- `seen.add("C023")` 往里加。
- `print(seen)` 走不到这里。

</div>

```text
$ uv run python part01/set_empty_trap.py
<class 'dict'>
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/set_empty_trap.py", line 4, in <module>
    seen.add("C023")
    ^^^^^^^^
AttributeError: 'dict' object has no attribute 'add'
```

<div class="line-notes">

- `<class 'dict'>` `{}` 是**空字典**,Python 里花括号里没有东西时默认是字典(因为字典比集合出现得早)。
- `File "/Users/你/agent-zero-lab/part01/set_empty_trap.py", line 4, in <module>` 第 4 行出错。
- `seen.add("C023")` 出错的那行。
- `AttributeError: 'dict' object has no attribute 'add'` 字典没有 `add` 方法。读这条报错的关键是引号里的 `'dict'`:它告诉你手里的东西是字典,不是你以为的集合。

</div>

basedpyright 在编辑器里对这行也有红线:`Cannot access attribute "add" for class "dict[Unknown, Unknown]"`。改成 `seen = set()` 就好了。

### remove 和 discard:删不存在的东西会怎样

新建 `part01/set_remove_error.py`:

```python
# agent-zero-lab/part01/set_remove_error.py
open_ids = {"T301", "T302", "T303"}
open_ids.remove("T302")
print(sorted(open_ids))
open_ids.remove("T999")
print("走不到这里")
```

<div class="line-notes">

- `open_ids = {"T301", "T302", "T303"}` 三张还没处理的工单。
- `open_ids.remove("T302")` `T302` 在集合里,正常删掉。
- `print(sorted(open_ids))` 剩 `['T301', 'T303']`。
- `open_ids.remove("T999")` `T999` 根本不在,`remove` 报错。
- `print("走不到这里")` 前一行已经崩了。

</div>

```text
$ uv run python part01/set_remove_error.py
['T301', 'T303']
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/set_remove_error.py", line 5, in <module>
    open_ids.remove("T999")
    ~~~~~~~~~~~~~~~^^^^^^^^
KeyError: 'T999'
```

<div class="line-notes">

- `['T301', 'T303']` 第一次 `remove` 正常。
- `File "/Users/你/agent-zero-lab/part01/set_remove_error.py", line 5, in <module>` 第 5 行。
- `open_ids.remove("T999")` 出错的那行。
- `KeyError: 'T999'` 和字典取不存在的键是同一个错误名,后面是「找不到的那个元素」。

</div>

怎么选,和 Day 24 的方括号对 `.get()` 一模一样:**确定它一定在**就用 `remove`,不在说明程序有 bug,崩得越早越好;**可能不在、不在也无所谓**就用 `discard`。

### 没有顺序:不能按位置取,打印顺序每次不同

集合没有「第几个」,所以不能 `s[0]`。新建 `part01/set_index_error.py`:

```python
# agent-zero-lab/part01/set_index_error.py
customers = ["C023", "C007", "C023"]
unique = set(customers)
print(unique[0])
```

<div class="line-notes">

- `customers = ["C023", "C007", "C023"]` 三个客户号。
- `unique = set(customers)` 去重成集合,两个元素。
- `print(unique[0])` 想取「第一个」。集合不支持用下标取。

</div>

```text
$ uv run python part01/set_index_error.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/set_index_error.py", line 4, in <module>
    print(unique[0])
          ~~~~~~^^^
TypeError: 'set' object is not subscriptable
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/set_index_error.py", line 4, in <module>` 第 4 行。
- `print(unique[0])` 出错的那行。
- `TypeError: 'set' object is not subscriptable` 「subscriptable」是「能用方括号取」的意思。集合不能。需要按位置取,就先 `sorted(unique)` 或 `list(unique)` 变成列表再取(但要知道 `list(unique)` 的顺序不固定)。

</div>

「没有顺序」到底是什么意思?同一个脚本跑两次看看。新建 `part01/set_order.py`:

```python
# agent-zero-lab/part01/set_order.py
categories = ["计费", "登录", "计费", "功能", "账号", "登录"]
print(set(categories))
print(sorted(set(categories)))
print(list(dict.fromkeys(categories)))
```

<div class="line-notes">

- `categories = ["计费", "登录", "计费", "功能", "账号", "登录"]` 六个类别,有重复:去重后是 4 个。
- `print(set(categories))` **直接**打印集合,不排序。
- `print(sorted(set(categories)))` 先去重再排序,得到一个排好序的列表。
- `print(list(dict.fromkeys(categories)))` 保持原来顺序的去重:`dict.fromkeys(列表)` 用列表里的每一项当键造一个字典,重复的键自动合并,而字典记着第一次出现的顺序(Day 24);再 `list(...)` 取出所有键。这是 Python 里最常用的「保序去重」。

</div>

连跑两次,中间什么都没改:

```text
$ uv run python part01/set_order.py
{'功能', '登录', '账号', '计费'}
['功能', '登录', '计费', '账号']
['计费', '登录', '功能', '账号']
$ uv run python part01/set_order.py
{'登录', '账号', '功能', '计费'}
['功能', '登录', '计费', '账号']
['计费', '登录', '功能', '账号']
```

<div class="line-notes">

- `{'功能', '登录', '账号', '计费'}` 第一次运行,直接打印的集合顺序是「功能、登录、账号、计费」。
- `['功能', '登录', '计费', '账号']` 第一次的 `sorted`:按码点排,是固定的。
- `['计费', '登录', '功能', '账号']` `dict.fromkeys` 的顺序是**原列表第一次出现的顺序**:计费、登录、功能、账号,每次都一样。
- `{'登录', '账号', '功能', '计费'}` 第二次运行,**同样的代码**,集合的顺序变成了「登录、账号、功能、计费」。
- `['功能', '登录', '计费', '账号']` `sorted` 两次相同。
- `['计费', '登录', '功能', '账号']` `dict.fromkeys` 两次相同。

</div>

原因是 Python 每次启动都会给字符串的「哈希值」加一个随机数(为了防攻击),集合是靠哈希值决定元素放在哪的,所以字符串集合的打印顺序每次不同。数字集合碰巧看起来总是排好序的,也**不能依赖**。结论只有一条:**要把集合的内容给别人看或者写进文件,先 `sorted(...)`;要保持原顺序去重,用 `list(dict.fromkeys(...))`。** 你在自己机器上跑出来的顺序和我文章里的不一样是正常的,这也是我文章里的集合输出几乎都带 `sorted` 的原因。

### 只能放「不会变」的东西

集合和字典的键一样,元素必须是不可变的(可哈希,Day 24)。新建 `part01/set_unhashable.py`:

```python
# agent-zero-lab/part01/set_unhashable.py
pairs = {("T301", "C023"), ("T302", "C007"), ("T301", "C023")}
print(len(pairs), ("T302", "C007") in pairs)

bad = {["T301", "C023"]}
print(bad)
```

<div class="line-notes">

- `pairs = {("T301", "C023"), ("T302", "C007"), ("T301", "C023")}` 元素是**元组**,每个元组是一对「工单号加客户号」。第一个和第三个相同,会被合并。
- `print(len(pairs), ("T302", "C007") in pairs)` 输出 `2 True`:去重后两个,并且那一对在集合里。
- `bad = {["T301", "C023"]}` 把一个**列表**放进集合。
- `print(bad)` 走不到这里。

</div>

```text
$ uv run python part01/set_unhashable.py
2 True
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/set_unhashable.py", line 5, in <module>
    bad = {["T301", "C023"]}
          ^^^^^^^^^^^^^^^^^^
TypeError: cannot use 'list' as a set element (unhashable type: 'list')
```

<div class="line-notes">

- `2 True` 元组可以放,重复的被合并。
- `File "/Users/你/agent-zero-lab/part01/set_unhashable.py", line 5, in <module>` 第 5 行。
- `bad = {["T301", "C023"]}` 出错的那行。
- `TypeError: cannot use 'list' as a set element (unhashable type: 'list')` 和 Day 24 的字典键同一个原因:列表能改,不能当集合元素。字典同样不行。想放一对一对的东西,放元组。

</div>

### 为什么要用集合:`in` 快得多

你可能会想:只是问「在不在」,列表 `in` 也行,干嘛换集合?数据少的时候没差别,数据多了差得离谱。新建 `part01/set_speed.py`,造 10 万个工单号,分别放进列表和集合,各查 200 次「根本不存在」的工单号(最坏情况:列表要从头比到尾):

```python
# agent-zero-lab/part01/set_speed.py
import time

ids = [f"T{n}" for n in range(100_000)]
id_set = set(ids)
targets = [f"T{n}" for n in range(100_000, 100_200)]

start = time.perf_counter()
hits_list = [t for t in targets if t in ids]
list_seconds = time.perf_counter() - start

start = time.perf_counter()
hits_set = [t for t in targets if t in id_set]
set_seconds = time.perf_counter() - start

print(len(ids), len(id_set), len(targets))
print(hits_list, hits_set)
print(f"列表查 200 次: {list_seconds:.4f} 秒")
print(f"集合查 200 次: {set_seconds:.6f} 秒")
print(f"大约快 {list_seconds / set_seconds:.0f} 倍")
```

<div class="line-notes">

- `import time` 标准库的时间模块,Day 19 用过它的 `sleep` 和 `monotonic`;今天用 `perf_counter`,专门用来量很短的时间。
- `ids = [f"T{n}" for n in range(100_000)]` 用推导式(Day 23)造 10 万个工单号 `T0`、`T1` ……`T99999`。数字里的下划线只是为了好读,`100_000` 就是十万。
- `id_set = set(ids)` 同样的 10 万个放进集合。
- `targets = [f"T{n}" for n in range(100_000, 100_200)]` 200 个**不在** `ids` 里的工单号(从 `T100000` 到 `T100199`),列表查它们每次都要比完 10 万个才知道没有。
- `start = time.perf_counter()` 记下开始时间。
- `hits_list = [t for t in targets if t in ids]` 在**列表**里查:200 次,每次从头比。
- `list_seconds = time.perf_counter() - start` 结束时间减开始时间,就是花了几秒。
- `start = time.perf_counter()` 重新计时。
- `hits_set = [t for t in targets if t in id_set]` 在**集合**里查:同样 200 次。
- `set_seconds = time.perf_counter() - start` 花了几秒。
- `print(len(ids), len(id_set), len(targets))` 确认数据量:10 万、10 万、200。
- `print(hits_list, hits_set)` 两个都应该是空列表(200 个都不在),确认两种写法答案一样。
- `print(f"列表查 200 次: {list_seconds:.4f} 秒")` `:.4f` 保留 4 位小数(Day 15)。
- `print(f"集合查 200 次: {set_seconds:.6f} 秒")` 集合太快了,保留 6 位小数才看得见。
- `print(f"大约快 {list_seconds / set_seconds:.0f} 倍")` 两个时间相除,`.0f` 不要小数。

</div>

```text
$ uv run python part01/set_speed.py
100000 100000 200
[] []
列表查 200 次: 0.9919 秒
集合查 200 次: 0.000090 秒
大约快 11058 倍
```

<div class="line-notes">

- `100000 100000 200` 数据量。
- `[] []` 两种写法都没找到,答案一致。
- `列表查 200 次: 0.9919 秒` 在我这台 2019 款笔记本上,列表查 200 次花了约 1 秒。
- `集合查 200 次: 0.000090 秒` 集合查 200 次约 0.00009 秒,也就是 90 微秒。
- `大约快 11058 倍` 两个数相除。你自己跑的数字会不一样,机器忙不忙、后台开了什么都会影响,但量级差不多:**差了好几个数量级**。

</div>

原因简单说:列表找东西要一个一个比,10 万个就比 10 万次;集合靠哈希值直接算出元素该在哪,几乎不管里面有多少个。所以凡是「在一大批东西里反复问有没有」,先把那一大批变成集合再问。Day 24 字典的 `in` 也是同样的原理。

## 集合运算:回答「两批数据哪里不同」

集合真正的用处是**两批数据做对比**。四种运算,先看图:

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="两个相交的圆,左圆是 refund 集合,右圆是 login 集合;左圆独有的区域是 refund 减 login,重叠区域是交集,右圆独有是 login 减 refund;并集是整个两个圆合在一起,对称差是两个圆去掉重叠">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<circle cx="230" cy="120" r="80" fill="var(--mem-wash)" stroke="var(--mem)"/>
<circle cx="340" cy="120" r="80" fill="var(--compute-wash)" stroke="var(--compute)" fill-opacity="0.7"/>
<text x="150" y="36" fill="var(--ink-soft)">refund(提过退款)</text>
<text x="330" y="36" fill="var(--ink-soft)">login(提过登录问题)</text>
<text x="170" y="112" fill="var(--ink)">C015</text>
<text x="170" y="132" fill="var(--ink)">C023</text>
<text x="268" y="112" fill="var(--ink)">C031</text>
<text x="268" y="132" fill="var(--ink)">C042</text>
<text x="366" y="112" fill="var(--ink)">C007</text>
<text x="366" y="132" fill="var(--ink)">C050</text>
<text x="20" y="228" fill="var(--ink)">只在左边 refund - login = C015 C023</text>
<text x="20" y="248" fill="var(--ink)">重叠 refund &amp; login = C031 C042</text>
<text x="360" y="228" fill="var(--ink)">只在右边 login - refund = C007 C050</text>
<text x="360" y="248" fill="var(--ink)">全部 refund | login = 六个</text>
<text x="450" y="112" fill="var(--ink-soft)">^ 是左右独有的合起来</text>
<text x="450" y="132" fill="var(--ink-soft)">= 四个(去掉重叠)</text>
</g>
</svg>
<figcaption>两个集合像两个相交的圆。重叠的是交集 &amp;,整个是并集 |,只在一边的是差集 -,两边各自独有的合起来是对称差 ^。</figcaption>
</figure>

新建 `part01/set_ops.py`:

```python
# agent-zero-lab/part01/set_ops.py
refund = {"C015", "C023", "C031", "C042"}
login = {"C007", "C031", "C042", "C050"}

print("两边都有 &:", sorted(refund & login))
print("至少一边有 |:", sorted(refund | login))
print("只在退款 -:", sorted(refund - login))
print("只在登录 -:", sorted(login - refund))
print("只在一边 ^:", sorted(refund ^ login))

print(sorted(refund.intersection(login)))
print(sorted(refund.union(login)))
print(sorted(refund.difference(login)))

vip = {"C023", "C031"}
print(vip <= refund, vip <= login, refund.isdisjoint({"C999"}))
print(refund == {"C042", "C031", "C023", "C015"})
```

<div class="line-notes">

- `refund = {"C015", "C023", "C031", "C042"}` 提过退款的四个客户。
- `login = {"C007", "C031", "C042", "C050"}` 提过登录问题的四个客户。`C031` 和 `C042` 两边都出现了。
- `print("两边都有 &:", sorted(refund & login))` **交集** `&`:两个集合里都有的元素。结果是 `['C031', 'C042']`。
- `print("至少一边有 |:", sorted(refund | login))` **并集** `|`:合在一起,重复的只算一份。6 个客户,`C031` 和 `C042` 没有算两遍。
- `print("只在退款 -:", sorted(refund - login))` **差集** `-`:`refund` 里有、`login` 里没有。`['C015', 'C023']`。
- `print("只在登录 -:", sorted(login - refund))` 反过来:`login` 里有、`refund` 里没有,`['C007', 'C050']`。**`A - B` 和 `B - A` 不一样**,这是差集最容易写反的地方。
- `print("只在一边 ^:", sorted(refund ^ login))` **对称差** `^`:只在其中一个集合里的,即两个差集加起来。4 个客户:`C007`、`C015`、`C023`、`C050`。
- `print(sorted(refund.intersection(login)))` 方法写法 `.intersection(...)`,和 `&` 一样。
- `print(sorted(refund.union(login)))` `.union(...)` 同 `|`。
- `print(sorted(refund.difference(login)))` `.difference(...)` 同 `-`。方法的好处是括号里可以放**列表**而不必先转成集合,运算符两边必须都是集合。
- `vip = {"C023", "C031"}` 两个重要客户。
- `print(vip <= refund, vip <= login, refund.isdisjoint({"C999"}))` `A <= B` 问「A 是不是 B 的子集」(A 的所有元素都在 B 里):`vip` 的两个客户都在 `refund` 里,`True`;`C023` 不在 `login` 里,`False`。`isdisjoint` 问「两个集合有没有共同元素」,和 `{"C999"}` 没有共同元素,`True`。
- `print(refund == {"C042", "C031", "C023", "C015"})` 两个集合相等,只看元素,**不看顺序**:`True`。

</div>

```text
$ uv run python part01/set_ops.py
两边都有 &: ['C031', 'C042']
至少一边有 |: ['C007', 'C015', 'C023', 'C031', 'C042', 'C050']
只在退款 -: ['C015', 'C023']
只在登录 -: ['C007', 'C050']
只在一边 ^: ['C007', 'C015', 'C023', 'C050']
['C031', 'C042']
['C007', 'C015', 'C023', 'C031', 'C042', 'C050']
['C015', 'C023']
True False True
True
```

<div class="line-notes">

- `两边都有 &: ['C031', 'C042']` 交集。
- `至少一边有 |: ['C007', 'C015', 'C023', 'C031', 'C042', 'C050']` 并集,6 个。
- `只在退款 -: ['C015', 'C023']` `refund - login`。
- `只在登录 -: ['C007', 'C050']` `login - refund`,和上一行不同。
- `只在一边 ^: ['C007', 'C015', 'C023', 'C050']` 上面两行合起来。
- `['C031', 'C042']` `.intersection` 和 `&` 一样。
- `['C007', 'C015', 'C023', 'C031', 'C042', 'C050']` `.union` 和 `|` 一样。
- `['C015', 'C023']` `.difference` 和 `-` 一样。
- `True False True` 子集和不相交的三个判断。
- `True` 顺序不同的集合相等。

</div>

### 集合推导式:花括号版的推导式

Day 23 的列表推导式把方括号换成花括号,就得到**集合推导式**:`{表达式 for 名字 in 一批 if 条件}`,造出来的直接是集合,重复自动合并。小项目里会用到,先单独看一遍。新建 `part01/set_comp.py`:

```python
# agent-zero-lab/part01/set_comp.py
lines = [
    "T301 计费 C023 29900",
    "T302 登录 C007 0",
    "T303 计费 C015 46800",
    "T306 计费 C023 4900",
]

as_list = [line.split()[2] for line in lines]
as_set = {line.split()[2] for line in lines}
print(as_list)
print(sorted(as_set))
print(type(as_set), len(as_list), len(as_set))

long_ones = {line.split()[0] for line in lines if int(line.split()[3]) > 10000}
print(sorted(long_ones))
```

<div class="line-notes">

- `lines = [` 四行简化的工单:`工单号 类别 客户号 金额`。
- `"T301 计费 C023 29900",` 客户 C023。
- `"T306 计费 C023 4900",` 又是 C023。
- `as_list = [line.split()[2] for line in lines]` 列表推导式:每行拆开取第 3 段(下标 2)客户号。四个,`C023` 出现两次。
- `as_set = {line.split()[2] for line in lines}` **花括号**:同样的写法,造出来的是集合,`C023` 只留一份。注意要和字典区分:字典推导式的花括号里表达式是 `键: 值`,有冒号;这里没有冒号。
- `print(as_list)` `['C023', 'C007', 'C015', 'C023']`。
- `print(sorted(as_set))` `['C007', 'C015', 'C023']`。
- `print(type(as_set), len(as_list), len(as_set))` 类型是 `set`;列表 4 项,集合 3 项。
- `long_ones = {line.split()[0] for line in lines if int(line.split()[3]) > 10000}` 带 `if` 的集合推导式:金额(第 4 段,先 `int(...)` 转成整数)大于 10000 分的工单号。
- `print(sorted(long_ones))` 只有 T301(29900)和 T303(46800)。

</div>

```text
$ uv run python part01/set_comp.py
['C023', 'C007', 'C015', 'C023']
['C007', 'C015', 'C023']
<class 'set'> 4 3
['T301', 'T303']
```

<div class="line-notes">

- `['C023', 'C007', 'C015', 'C023']` 列表版,重复保留。
- `['C007', 'C015', 'C023']` 集合版,去重后排序输出。
- `<class 'set'> 4 3` 类型是 `set`;4 项变成 3 项。
- `['T301', 'T303']` 金额大于 10000 分的两张。

</div>

## 小项目:对比昨天和今天的工单导出

场景:客服系统每天导出一份工单。你想回答:

1. 今天比昨天**新增**了哪些工单?
2. 昨天有、今天**消失**了的是哪些?
3. 两天**都在**的?
4. 今天这份导出里有没有**重复**的行(同一张工单导出了两次)?
5. 今天新出现的客户、今天没再来的客户;同时提过退款和登录问题的客户。

新建 `part01/batch_diff.py`:

```python
# agent-zero-lab/part01/batch_diff.py
FIELDS = ["id", "category", "customer", "amount", "desc"]

yesterday_lines = [
    "T301 计费 C023 29900 8月2日重复扣款,请退款",
    "T302 登录 C007 0 验证码收不到",
    "T303 计费 C015 46800 年付多扣了,要求退款",
    "T304 功能 C031 0 导出PDF乱码",
    "T306 计费 C042 4900 发票金额对不上,多收了49元",
]
today_lines = [
    "T302 登录 C007 0 验证码收不到",
    "T303 计费 C015 46800 年付多扣了,要求退款",
    "T303 计费 C015 46800 年付多扣了,要求退款",
    "T304 功能 C031 0 导出PDF乱码",
    "T307 登录 C031 0 Forgot password",
    "T308 计费 C031 29900 Refund request: charged twice",
    "T310 计费 C023 59800 扣了两次,共598元,申请退款",
    "T311 计费 C050 4900 想要发票PDF",
]


yesterday = [dict(zip(FIELDS, line.split(maxsplit=4))) for line in yesterday_lines]
today = [dict(zip(FIELDS, line.split(maxsplit=4))) for line in today_lines]

yesterday_ids = {t["id"] for t in yesterday}
today_ids = {t["id"] for t in today}
print(f"昨天 {len(yesterday)} 行,{len(yesterday_ids)} 个不同工单号")
print(f"今天 {len(today)} 行,{len(today_ids)} 个不同工单号")

seen = {}
for t in today:
    seen[t["id"]] = seen.get(t["id"], 0) + 1
repeated = [ticket_id for ticket_id, n in seen.items() if n > 1]
print("今天导出里重复的工单号:", repeated)

print("新增:", sorted(today_ids - yesterday_ids))
print("消失:", sorted(yesterday_ids - today_ids))
print("两天都在:", sorted(today_ids & yesterday_ids))

yesterday_customers = {t["customer"] for t in yesterday}
today_customers = {t["customer"] for t in today}
print("今天新出现的客户:", sorted(today_customers - yesterday_customers))
print("今天没再来的客户:", sorted(yesterday_customers - today_customers))

refund_rows = [t for t in today if "退款" in t["desc"] or "refund" in t["desc"].lower()]
login_rows = [t for t in today if t["category"] == "登录"]
refund_customers = {t["customer"] for t in refund_rows}
login_customers = {t["customer"] for t in login_rows}
print("提过退款的客户:", sorted(refund_customers))
print("提过登录问题的客户:", sorted(login_customers))
print("两种都提过:", sorted(refund_customers & login_customers))
print("只提退款没提登录:", sorted(refund_customers - login_customers))
```

<div class="line-notes">

- `FIELDS = ["id", "category", "customer", "amount", "desc"]` 字段名,和 Day 24 一样。
- `yesterday_lines = [` 昨天的导出,5 行,每行一张工单。
- `"T301 计费 C023 29900 8月2日重复扣款,请退款",` 昨天有,今天没有的第一张。
- `"T306 计费 C042 4900 发票金额对不上,多收了49元",` 昨天有,今天没有的第二张,客户 C042 只在昨天出现过。
- `today_lines = [` 今天的导出,8 行。
- `"T303 计费 C015 46800 年付多扣了,要求退款",` 这一行在今天的导出里出现了**两次**,代表同一张工单被导出了两遍。
- `"T307 登录 C031 0 Forgot password",` 今天新增的登录工单,客户是 C031。
- `"T311 计费 C050 4900 想要发票PDF",` 今天新增的工单,C050 是个今天才第一次出现的客户。
- `yesterday = [dict(zip(FIELDS, line.split(maxsplit=4))) for line in yesterday_lines]` 一行把每行文字拆成字典(Day 24 的 `dict(zip(...))` 放进推导式里):`yesterday` 是一个列表,里面 5 个字典。
- `today = [dict(zip(FIELDS, line.split(maxsplit=4))) for line in today_lines]` 今天的,8 个字典。
- `yesterday_ids = {t["id"] for t in yesterday}` 集合推导式:昨天所有工单号去重后的集合,5 个。
- `today_ids = {t["id"] for t in today}` 今天的工单号集合:8 行里 `T303` 出现两次,去重后 7 个。
- `print(f"昨天 {len(yesterday)} 行,{len(yesterday_ids)} 个不同工单号")` 对比行数和不同工单号数:5 行 5 个。
- `print(f"今天 {len(today)} 行,{len(today_ids)} 个不同工单号")` 8 行 7 个,差的那一行就是重复导出的。
- `seen = {}` 想知道**哪些**工单号重复,不能只看集合了,要数每个工单号出现几次:用 Day 24 的计数句式。
- `for t in today:` 遍历今天的每张工单。
- `seen[t["id"]] = seen.get(t["id"], 0) + 1` 计数句式,键是工单号。
- `repeated = [ticket_id for ticket_id, n in seen.items() if n > 1]` 推导式加解包:出现次数大于 1 的工单号。
- `print("今天导出里重复的工单号:", repeated)` 只有 `T303`。
- `print("新增:", sorted(today_ids - yesterday_ids))` 差集:今天有、昨天没有。**今天减昨天**才是新增。
- `print("消失:", sorted(yesterday_ids - today_ids))` 差集反过来:昨天有、今天没有。
- `print("两天都在:", sorted(today_ids & yesterday_ids))` 交集。
- `yesterday_customers = {t["customer"] for t in yesterday}` 昨天出现过的客户集合。
- `today_customers = {t["customer"] for t in today}` 今天的。
- `print("今天新出现的客户:", sorted(today_customers - yesterday_customers))` 今天有、昨天没有的客户。
- `print("今天没再来的客户:", sorted(yesterday_customers - today_customers))` 反过来。
- `refund_rows = [t for t in today if "退款" in t["desc"] or "refund" in t["desc"].lower()]` 今天的退款相关工单(Day 23 的筛选)。
- `login_rows = [t for t in today if t["category"] == "登录"]` 今天类别是「登录」的工单。
- `refund_customers = {t["customer"] for t in refund_rows}` 提过退款的客户集合。
- `login_customers = {t["customer"] for t in login_rows}` 提过登录问题的客户集合。
- `print("提过退款的客户:", sorted(refund_customers))` 三个客户。
- `print("提过登录问题的客户:", sorted(login_customers))` 两个客户。
- `print("两种都提过:", sorted(refund_customers & login_customers))` 交集:两个问题都有的客户。
- `print("只提退款没提登录:", sorted(refund_customers - login_customers))` 差集:只有退款的。

</div>

```text
$ uv run python part01/batch_diff.py
昨天 5 行,5 个不同工单号
今天 8 行,7 个不同工单号
今天导出里重复的工单号: ['T303']
新增: ['T307', 'T308', 'T310', 'T311']
消失: ['T301', 'T306']
两天都在: ['T302', 'T303', 'T304']
今天新出现的客户: ['C050']
今天没再来的客户: ['C042']
提过退款的客户: ['C015', 'C023', 'C031']
提过登录问题的客户: ['C007', 'C031']
两种都提过: ['C031']
只提退款没提登录: ['C015', 'C023']
```

<div class="line-notes">

- `昨天 5 行,5 个不同工单号` 昨天没有重复。
- `今天 8 行,7 个不同工单号` 今天少了一个不同工单号:有一行是重复的。
- `今天导出里重复的工单号: ['T303']` 重复的是 `T303`,计数字典告诉你**是哪个**,集合只告诉你「有重复」。
- `新增: ['T307', 'T308', 'T310', 'T311']` 今天有、昨天没有。
- `消失: ['T301', 'T306']` 昨天有、今天没有。
- `两天都在: ['T302', 'T303', 'T304']` 交集。昨天 5 张,2 张消失,剩 3 张还在;今天 7 张,4 张新增,剩 3 张是旧的,三个数对得上。
- `今天新出现的客户: ['C050']` 只有 C050 是新客户。
- `今天没再来的客户: ['C042']` C042 昨天提过 T306,今天没有工单了。
- `提过退款的客户: ['C015', 'C023', 'C031']` T303(C015)、T310(C023)、T308(C031)。
- `提过登录问题的客户: ['C007', 'C031']` T302(C007)、T307(C031)。
- `两种都提过: ['C031']` C031 既提过退款(T308)又提过登录问题(T307),要重点关注。
- `只提退款没提登录: ['C015', 'C023']` 差集。

</div>

整个脚本里有两种东西搭配着用:**集合回答「有没有」和「两批有什么不同」,字典回答「各出现几次」。** 判断集合和列表的分工有一个简单办法:如果问题里出现了「有几次」「第几个」「按什么顺序」,用列表或字典;如果只问「有没有」「哪些是共同的/新增的」,用集合。

basedpyright 在 standard 档对今天的正常脚本零报错。故意写错的三个文件会有红线:`set_empty_trap.py`(`add` 对字典)、`set_index_error.py`(集合不能用下标)、`set_unhashable.py`(`Set entry must be hashable`)。

## 动手练习

### 练习 1:去重客户号

下面是七张工单的客户号。写 `part01/ex25_1_dedupe.py`,依次做:

1. 打印原来有几项、去重后有几个不同的客户;
2. 打印排好序的不重复客户列表;
3. 打印**保持原来出现顺序**的不重复客户列表;
4. 往集合里加 `"C050"` 两次,打印现在有几个客户;
5. 判断 `"C007"` 和 `"C999"` 在不在;
6. 删掉 `"C007"` 和 `"C999"`(其中一个本来就不在,不能报错),打印排好序的结果。

```python
raw_ids = ["C023", "C007", "C023", "C015", "C007", "C023", "C042"]
```

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex25_1_dedupe.py
raw_ids = ["C023", "C007", "C023", "C015", "C007", "C023", "C042"]

unique = set(raw_ids)
print(len(raw_ids), len(unique))

print(sorted(unique))

in_order = list(dict.fromkeys(raw_ids))
print(in_order)

unique.add("C050")
unique.add("C050")
print(len(unique))

print("C007" in unique, "C999" in unique)

unique.discard("C007")
unique.discard("C999")
print(sorted(unique))
```

<div class="line-notes">

- `raw_ids = ["C023", "C007", "C023", "C015", "C007", "C023", "C042"]` 七项:`C023` 三次、`C007` 两次、`C015` 和 `C042` 各一次,不同的有 4 个。
- `unique = set(raw_ids)` 去重成集合。
- `print(len(raw_ids), len(unique))` 第 1 步:7 项,4 个不同。
- `print(sorted(unique))` 第 2 步:`sorted` 把集合排成列表。
- `in_order = list(dict.fromkeys(raw_ids))` 第 3 步:保序去重。字典记着键第一次出现的位置,所以顺序是 `C023`、`C007`、`C015`、`C042`。
- `print(in_order)` 打印保序结果。
- `unique.add("C050")` 第 4 步:第一次加,集合变成 5 个。
- `unique.add("C050")` 第二次加同一个,没有变化。
- `print(len(unique))` 5,不是 6。
- `print("C007" in unique, "C999" in unique)` 第 5 步:`in` 对集合是按哈希找,很快;`True False`。
- `unique.discard("C007")` 第 6 步:`discard` 删存在的元素。
- `unique.discard("C999")` `discard` 删不存在的元素,不报错。如果这里用 `remove`,会 `KeyError: 'C999'`。
- `print(sorted(unique))` 剩 `C015`、`C023`、`C042`、`C050`。

</div>

```text
$ uv run python part01/ex25_1_dedupe.py
7 4
['C007', 'C015', 'C023', 'C042']
['C023', 'C007', 'C015', 'C042']
5
True False
['C015', 'C023', 'C042', 'C050']
```

<div class="line-notes">

- `7 4` 7 项,4 个不同。
- `['C007', 'C015', 'C023', 'C042']` 排好序。
- `['C023', 'C007', 'C015', 'C042']` 保序去重,顺序和 `raw_ids` 里第一次出现的顺序一致。
- `5` 加了两次 `C050` 只算一个。
- `True False` 在 / 不在。
- `['C015', 'C023', 'C042', 'C050']` 删掉 `C007` 之后。

</div>

</details>

### 练习 2:先猜,再跑

不要先运行。下面的七行输出分别是什么?先写下答案再核对。重点看第 3 行(`b - a` 和 `a - b` 的区别)、第 5 行(顺序不同的集合算不算相等)和第 7 行(去重后的长度)。

```python
# agent-zero-lab/part01/ex25_2_guess.py
a = {1, 2, 3, 4}
b = {3, 4, 5}

print(sorted(a & b))
print(sorted(a | b))
print(sorted(a - b), sorted(b - a))
print(sorted(a ^ b))
print({1, 2} == {2, 1}, {1, 2} < {1, 2, 3}, {1, 2} <= {1, 2})
print(sorted(set("hello")), len("hello"), len(set("hello")))
words = ["计费", "登录", "计费"]
print(len(words), len(set(words)), set(words) == {"登录", "计费"})
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex25_2_guess.py
[3, 4]
[1, 2, 3, 4, 5]
[1, 2] [5]
[1, 2, 5]
True True True
['e', 'h', 'l', 'o'] 5 4
3 2 True
```

<div class="line-notes">

- `[3, 4]` 第 1 行:`a & b`,两边都有的是 3 和 4。
- `[1, 2, 3, 4, 5]` 第 2 行:`a | b`,合并后 5 个,3 和 4 只算一份。
- `[1, 2] [5]` 第 3 行:`a - b` 是只在 `a` 里的 1、2;`b - a` 是只在 `b` 里的 5。两个差集一般不一样。
- `[1, 2, 5]` 第 4 行:`a ^ b`,只在一边的:1、2、5(3 和 4 在两边都有,所以被去掉)。
- `True True True` 第 5 行:`{1, 2} == {2, 1}` 集合相等不看顺序;`{1, 2} < {1, 2, 3}` 是「真子集」(是子集而且不相等),`True`;`{1, 2} <= {1, 2}` 是「子集」(允许相等),`True`。
- `['e', 'h', 'l', 'o'] 5 4` 第 6 行:`set("hello")` 把字符串拆成一个个字符再去重,`l` 出现两次只留一个,`sorted` 之后是 4 个字符;`len("hello")` 是 5,`len(set("hello"))` 是 4。
- `3 2 True` 第 7 行:`words` 有 3 项,去重后 2 项,`set(words) == {"登录", "计费"}` 为 `True`。

</div>

</details>

### 练习 3:找出两个错

下面两段代码,第一段会崩,第二段不崩但结果是错的。运行它们,说出病因和改法。

```python
# agent-zero-lab/part01/ex25_3_bug.py
seen = {}
for customer in ["C023", "C007", "C023"]:
    seen.add(customer)
print(len(seen))
```

```python
# agent-zero-lab/part01/ex25_3_bug_b.py
yesterday = {"T301", "T302", "T303"}
today = {"T302", "T303", "T304", "T305"}

new_tickets = yesterday - today
print("今天新增:", sorted(new_tickets))
print("共", len(new_tickets), "张")
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex25_3_bug.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex25_3_bug.py", line 4, in <module>
    seen.add(customer)
    ^^^^^^^^
AttributeError: 'dict' object has no attribute 'add'
$ uv run python part01/ex25_3_bug_b.py
今天新增: ['T301']
共 1 张
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/ex25_3_bug.py", line 4, in <module>` 第一段崩在第 4 行。
- `seen.add(customer)` 崩的那一行。
- `AttributeError: 'dict' object has no attribute 'add'` 病因是第 2 行 `seen = {}` 建出来的是**字典**。空集合要写 `set()`。编辑器同样画了红线。
- `今天新增: ['T301']` 第二段**没有报错**,但答案是错的:`T301` 是昨天有、今天已经消失的工单,不是新增的。
- `共 1 张` 真正的新增是 `T304` 和 `T305` 两张。病因:差集的方向写反了。`yesterday - today` 是「昨天有、今天没有」;想要「今天有、昨天没有」要写 `today - yesterday`。

</div>

改完的版本 `part01/ex25_3_fixed.py`:

```python
# agent-zero-lab/part01/ex25_3_fixed.py
seen = set()
for customer in ["C023", "C007", "C023"]:
    seen.add(customer)
print(len(seen), sorted(seen))

yesterday = {"T301", "T302", "T303"}
today = {"T302", "T303", "T304", "T305"}

new_tickets = today - yesterday
gone_tickets = yesterday - today
print("今天新增:", sorted(new_tickets), "共", len(new_tickets), "张")
print("今天消失:", sorted(gone_tickets))
```

<div class="line-notes">

- `seen = set()` 空集合用 `set()`。
- `for customer in ["C023", "C007", "C023"]:` 三个客户号,有重复。
- `seen.add(customer)` 加进集合,重复的自动忽略。
- `print(len(seen), sorted(seen))` 2 个不同客户。
- `yesterday = {"T301", "T302", "T303"}` 昨天的工单。
- `today = {"T302", "T303", "T304", "T305"}` 今天的工单。
- `new_tickets = today - yesterday` 新增 = 今天有、昨天没有:`today - yesterday`。
- `gone_tickets = yesterday - today` 消失 = 昨天有、今天没有:`yesterday - today`。
- `print("今天新增:", sorted(new_tickets), "共", len(new_tickets), "张")` 两张:`T304`、`T305`。
- `print("今天消失:", sorted(gone_tickets))` 一张:`T301`。

</div>

```text
$ uv run python part01/ex25_3_fixed.py
2 ['C007', 'C023']
今天新增: ['T304', 'T305'] 共 2 张
今天消失: ['T301']
```

<div class="line-notes">

- `2 ['C007', 'C023']` 去重后两个客户。
- `今天新增: ['T304', 'T305'] 共 2 张` 方向对了。
- `今天消失: ['T301']` 刚才误当作「新增」的那张,其实是消失的。

</div>

差集写反这种错最难发现,因为它**不报错、结果看着也像那么回事**。我的习惯是给集合起能读出方向的名字,并在 `print` 里把「A 减 B」的意思写出来;需要时拿一两个具体的小例子心算一遍。

</details>

### 练习 4:找两批工单的重复

两个系统各导出了一批工单号(有些工单在同一批里出现了不止一次)。写 `part01/ex25_4_two_batches.py`,打印:

1. 每批多少行、多少张不同工单;
2. 两批都有的、只在 A 的、只在 B 的;
3. 合并后一共多少张不同工单;
4. 每一批**内部**重复的工单号以及重复了几次;
5. 合并两批并去重,保持首次出现的顺序。

```python
batch_a = ["T401", "T402", "T403", "T402", "T405", "T406", "T403", "T402"]
batch_b = ["T403", "T404", "T405", "T407", "T404"]
```

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex25_4_two_batches.py
batch_a = ["T401", "T402", "T403", "T402", "T405", "T406", "T403", "T402"]
batch_b = ["T403", "T404", "T405", "T407", "T404"]

ids_a = set(batch_a)
ids_b = set(batch_b)
print(f"A 共 {len(batch_a)} 行,不同工单 {len(ids_a)} 张")
print(f"B 共 {len(batch_b)} 行,不同工单 {len(ids_b)} 张")

print("两批都有:", sorted(ids_a & ids_b))
print("只在 A:", sorted(ids_a - ids_b))
print("只在 B:", sorted(ids_b - ids_a))
print("合并后不同工单:", len(ids_a | ids_b), "张")

for name, batch in [("A", batch_a), ("B", batch_b)]:
    counts = {}
    for ticket_id in batch:
        counts[ticket_id] = counts.get(ticket_id, 0) + 1
    repeated = [(ticket_id, n) for ticket_id, n in counts.items() if n > 1]
    print(f"批次 {name} 内部重复:", repeated)

merged = list(dict.fromkeys(batch_a + batch_b))
print("合并去重并保持首次出现的顺序:", merged)
```

<div class="line-notes">

- `batch_a = ["T401", "T402", "T403", "T402", "T405", "T406", "T403", "T402"]` A 批 8 行:`T402` 三次、`T403` 两次。
- `batch_b = ["T403", "T404", "T405", "T407", "T404"]` B 批 5 行:`T404` 两次。
- `ids_a = set(batch_a)` A 的不同工单,5 个。
- `ids_b = set(batch_b)` B 的不同工单,4 个。
- `print(f"A 共 {len(batch_a)} 行,不同工单 {len(ids_a)} 张")` 第 1 步:8 行 5 张。
- `print(f"B 共 {len(batch_b)} 行,不同工单 {len(ids_b)} 张")` 5 行 4 张。
- `print("两批都有:", sorted(ids_a & ids_b))` 第 2 步:交集,`T403` 和 `T405`。
- `print("只在 A:", sorted(ids_a - ids_b))` A 减 B:`T401`、`T402`、`T406`。
- `print("只在 B:", sorted(ids_b - ids_a))` B 减 A:`T404`、`T407`。
- `print("合并后不同工单:", len(ids_a | ids_b), "张")` 第 3 步:并集有 7 张。验算:5 + 4 - 2(交集)= 7。
- `for name, batch in [("A", batch_a), ("B", batch_b)]:` 第 4 步:两批要做同样的事,把「名字加批次」配成元组放进一个列表里,一个循环处理两批,每圈解包成 `name` 和 `batch`。
- `counts = {}` 每批各自从空字典开始数。
- `for ticket_id in batch:` 遍历这一批的每个工单号。
- `counts[ticket_id] = counts.get(ticket_id, 0) + 1` 计数句式。
- `repeated = [(ticket_id, n) for ticket_id, n in counts.items() if n > 1]` 出现不止一次的,保留 `(工单号, 次数)` 二元组。
- `print(f"批次 {name} 内部重复:", repeated)` 打印 A 和 B 各自的重复情况。
- `merged = list(dict.fromkeys(batch_a + batch_b))` 第 5 步:两个列表先用 `+` 接成一个(Day 21),再保序去重。
- `print("合并去重并保持首次出现的顺序:", merged)` 打印。

</div>

```text
$ uv run python part01/ex25_4_two_batches.py
A 共 8 行,不同工单 5 张
B 共 5 行,不同工单 4 张
两批都有: ['T403', 'T405']
只在 A: ['T401', 'T402', 'T406']
只在 B: ['T404', 'T407']
合并后不同工单: 7 张
批次 A 内部重复: [('T402', 3), ('T403', 2)]
批次 B 内部重复: [('T404', 2)]
合并去重并保持首次出现的顺序: ['T401', 'T402', 'T403', 'T405', 'T406', 'T404', 'T407']
```

<div class="line-notes">

- `A 共 8 行,不同工单 5 张` A 批。
- `B 共 5 行,不同工单 4 张` B 批。
- `两批都有: ['T403', 'T405']` 交集。
- `只在 A: ['T401', 'T402', 'T406']` A 独有。
- `只在 B: ['T404', 'T407']` B 独有。
- `合并后不同工单: 7 张` 5 + 4 - 2。
- `批次 A 内部重复: [('T402', 3), ('T403', 2)]` A 里 `T402` 出现 3 次,`T403` 出现 2 次。
- `批次 B 内部重复: [('T404', 2)]` B 里 `T404` 出现 2 次。
- `合并去重并保持首次出现的顺序: ['T401', 'T402', 'T403', 'T405', 'T406', 'T404', 'T407']` 先是 A 里的顺序,再接上 B 里新出现的 `T404`、`T407`。

</div>

</details>

**验收标准:** 四道题的脚本都跑通;练习 2 先自己写出七行答案再核对;练习 3 说得出为什么第二段不报错却是错的;练习 4 的输出里所有数字能自己对上(5 + 4 - 2 = 7)。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 集合(set) | 一堆不重复、没有顺序的东西,写成 `{"a", "b"}` 或 `set(列表)`。相当于 JS 的 `Set` |
| 去重 | 去掉重复的项。`set(列表)` 一步做到,但顺序会丢 |
| `set()` | 造空集合的唯一写法。`{}` 是空字典 |
| `.add(x)` | 加一个元素,已经有了就什么都不发生 |
| `.discard(x)` | 删一个元素,不存在也不报错 |
| `.remove(x)` | 删一个元素,不存在会 `KeyError` |
| 交集 `&` | 两个集合里都有的元素,也叫 intersection |
| 并集 `\|` | 合在一起,重复的只算一份,也叫 union |
| 差集 `-` | `A - B` 是只在 A 里、不在 B 里的元素,也叫 difference;`A - B` 和 `B - A` 不一样 |
| 对称差 `^` | 只在其中一个集合里的元素,即两个差集合起来 |
| 子集 `<=` | `A <= B` 表示 A 的所有元素都在 B 里 |
| `.isdisjoint(B)` | 问两个集合有没有共同元素,没有就是 `True` |
| 集合推导式 | `{表达式 for 名字 in 一批 if 条件}`,造出来的是集合 |
| `dict.fromkeys(列表)` | 用列表的每一项当键造一个字典。外面套 `list(...)` 就是保序去重 |
| 可哈希(hashable) | Day 24 讲过:能放进集合、能当字典键的东西。列表、字典不行 |
| `AttributeError` | 对象没有你调用的方法或属性,例如字典没有 `add` |
| `TypeError: 'set' object is not subscriptable` | 对集合用了方括号下标,集合没有顺序 |
| `perf_counter` | `time` 模块里量很短时间的函数,用两次相减得到耗时 |

## 常见误区

**用 `{}` 当空集合。** `{}` 是空字典,调用 `.add` 会 `AttributeError: 'dict' object has no attribute 'add'`。空集合写 `set()`。

**以为集合的顺序是固定的。** 字符串集合每次运行的顺序都可能不同。打印、写文件、给别人看之前先 `sorted(...)`。

**用 `set()` 去重之后还指望顺序没变。** 要保持原来的顺序,用 `list(dict.fromkeys(列表))`。

**`A - B` 写成了 `B - A`。** 不报错,只是答案错了。把「谁减谁」读出声:新增 = 今天减昨天。

**对集合用 `s[0]`。** `TypeError: 'set' object is not subscriptable`。需要位置就先变成列表。

**往集合里放列表或字典。** `TypeError: cannot use 'list' as a set element (unhashable type: 'list')`。放元组。

**只想问「在不在」却在大列表里反复 `in`。** 数据一多就慢得离谱(10 万个元素、查 200 次差出一万倍)。先转成集合再查。

**`remove` 和 `discard` 混着用。** 要求元素必须存在用 `remove`,不存在也行用 `discard`。别图省事全用 `discard`,那会掩盖你本该发现的数据问题。

**拿集合数「出现几次」。** 集合会把重复的合并掉,数不了次数。要次数用 Day 24 的计数字典。

## 学习资料

### 文档与文章

- [Python 教程 · 集合](https://docs.python.org/zh-cn/3.12/tutorial/datastructures.html#sets):中文,官方教程里集合一节,很短,例子里就有去重和 `&`、`|`、`-`、`^`。
- [Python 标准库 · 集合类型 set 与 frozenset](https://docs.python.org/zh-cn/3.12/library/stdtypes.html#set-types-set-frozenset):中文,集合所有方法和运算符的正式说明,当手册查。
- [MDN · Set](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Set):中文,JS 一侧对照。今天开头 Node 里的 `intersection`、`union`、`difference` 在 [MDN 英文页](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set/intersection)有说明,中文页暂时没有。
- [Real Python · Sets in Python](https://realpython.com/python-sets/):英文,讲得全,有图;对爬虫返回 403,需要用浏览器打开。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1A82RB5E2X&autoplay=0&high_quality=1" title="5分钟学编程 · Python篇 #38｜集合（Set）：去重、集合运算与常用方法" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>猫小申 · 5分钟学编程 · Python篇 #38｜集合(Set):去重、集合运算与常用方法 · 9 分钟,2025 年底的新视频,去重和交并差一次过完,和今天的顺序一致。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Ly4y1275P&autoplay=0&high_quality=1" title="Python基础语法：集合" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>周周学Python · Python基础语法:集合 · 10 分钟,和 Day 23 推荐的是同一位 UP 主,语速慢,适合第一次看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/r3R3h5ly_8g" title="Python Tutorial: Sets - Set Methods and Operations to Solve Common Problems" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial: Sets - Set Methods and Operations to Solve Common Problems · 英文,专讲集合:空集合为什么是 `set()`、去重、交并差,和今天几乎一一对应。</figcaption>
</figure>

### 书籍

- Luciano Ramalho《Fluent Python》第 2 版,O'Reilly,2022。第 3 章「Dictionaries and Sets」,讲集合的内部原理和为什么 `in` 那么快,比今天讲得深,先读集合运算那几页;中文版第 2 版出版情况我没核实,按英文书名找。
- Eric Matthes《Python Crash Course》第 3 版,No Starch Press,2023(中译《Python编程:从入门到实践》)。第 6 章讲字典遍历时顺带用 `set()` 给值去重,那一小段和今天开头的去重对得上;入门书对集合讲得普遍很少,官方教程更全。

### 开源项目与代码

- [Asabeneh/30-Days-Of-Python · Day 7 Sets](https://github.com/Asabeneh/30-Days-Of-Python/tree/master/07_Day_Sets):英文,每个集合方法一两行例子,后面有一批练习。
- [jackfrued/Python-100-Days · 12.常用数据结构之集合](https://github.com/jackfrued/Python-100-Days/blob/master/Day01-20/12.常用数据结构之集合.md):中文,集合的创建、运算、方法,例子偏生活化。

## 自测

1. `{"a": 1}` 和 `{"a"}` 一个是字典一个是集合,怎么区分?空集合怎么写?

<details><summary>答案</summary>

有冒号(键值对)的是字典,只有值的是集合。空集合只能写 `set()`,`{}` 是空字典。

</details>

2. `len(set([1, 1, 2, 2, 3]))` 是多少?为什么不建议直接 `print(set(["计费", "登录"]))` 给别人看?

<details><summary>答案</summary>

是 3。集合不保证顺序,字符串集合每次运行的打印顺序都可能不同。要展示就先 `sorted(...)`。

</details>

3. `a = {1, 2, 3}`,`b = {3, 4}`,算出 `a & b`、`a | b`、`a - b`、`b - a`、`a ^ b`。

<details><summary>答案</summary>

`a & b` 是 `{3}`;`a | b` 是 `{1, 2, 3, 4}`;`a - b` 是 `{1, 2}`;`b - a` 是 `{4}`;`a ^ b` 是 `{1, 2, 4}`。

</details>

4. `remove` 和 `discard` 有什么区别?

<details><summary>答案</summary>

元素不存在时,`remove` 抛 `KeyError`,`discard` 什么都不做。确定它在就用 `remove`,让 bug 尽早暴露;不在也无所谓就用 `discard`。

</details>

5. **面试题**:怎么给一个列表去重并保持原来的顺序?`list(set(x))` 为什么不行?

<details><summary>答案</summary>

`list(dict.fromkeys(x))`。字典记着键第一次出现的顺序(Python 3.7 起是语言保证),重复的键自动合并。`list(set(x))` 虽然也去了重,但集合不保证顺序,字符串的集合每次运行的顺序都可能不同。

</details>

6. 想在 10 万个工单号里反复问「这个号在不在」,为什么要先把列表变成集合?

<details><summary>答案</summary>

列表的 `in` 要从头一个一个比,最坏比 10 万次;集合靠哈希值直接定位,基本不受元素个数影响。今天实测 200 次不存在的查询,列表约 0.99 秒,集合约 0.00009 秒。

</details>

## 明天预告

Day 26 · 嵌套数据:列表套字典,读懂一份 JSON 长什么样。今天和昨天用的字典都很「平」:`{"id": "T301", "amount": "29900"}`,一层。你在 DevTools 的 Network 里看到的接口返回不是这样的:一张工单里还有客户信息(一个字典),还有一串聊天记录(一个列表,每一项又是字典)。明天学怎么一层一层往里取:`tickets[0]["customer"]["name"]`,怎么用字典推导式一行造出「工单号 → 工单」的查找表,以及怎么遍历一份嵌套 JSON 把它的结构摸清楚。学完你就能读懂 Agent 里模型返回的那些 JSON 了。
