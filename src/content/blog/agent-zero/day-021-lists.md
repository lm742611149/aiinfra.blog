---
title: 'Day 21 · 列表:增删改查和排序'
description: 'list 就是 Python 的 Array,但有几处和 JS 不一样:append 返回 None、sort 原地改、b = a 不是复制。今天学会建列表、加、删、改、查、排序,并把一批工单按金额从高到低排出来。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 21
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 20](/blog/agent-zero/day-020-week03-review/) 是第 3 周的复习:默写了三段核心代码,做了 `daily_report.py` 工单日报,把这周撞过的报错整理成表,还用 5 张没见过的工单量出了分类规则的真实准确率。

这一周里列表其实已经出现过很多次。`line.split()` 的结果是列表,`for` 遍历的是列表,`tickets = [...]` 是列表,`raw_lines` 也是列表。但那些都是「拿来用」:取一下 `parts[3]`,遍历一遍就完事。今天正式学它:怎么往里加东西、往外拿东西、改其中一项、找一项、把整个列表排好序。学完你就能把日报里「金额合计」那种一个个累加的写法,换成一份可以排序、可以取前三名的清单。

## 今天要解决的问题

学完今天,你应该能:

1. 对照 JS 数组说清列表的写法和差别:`append`≈`push`、`pop()`≈`pop`、`pop(0)`≈`shift`,会用 `insert`、`extend`、`remove`、`del`、`clear`、`index`、`count`、`in`、`sum`、`min`、`max`,并认得三个常见报错:`IndexError`、`ValueError: list.remove(x): x not in list`、`AttributeError: 'NoneType' object has no attribute 'append'`。
2. 说清 `b = a` 不是复制:两个名字指向同一个列表,改一个另一个也变;会用 `.copy()` 或切片 `[:]` 得到真正的副本;知道遍历一个列表时不能往里删东西。
3. 区分 `list.sort()`(原地改、返回 `None`)和 `sorted(list)`(返回新列表),会用 `reverse=True` 从大到小,会用 `key=len` 这类「按什么排」的参数,知道中文是按码点排而不是按拼音排。
4. 写出 `part01/ticket_amounts.py`:一批工单抠出金额,存成 `[金额, 工单号]` 的列表,从高到低排序、取前三名、算合计;再看懂 `part01/agent_queue.py`:Agent 的任务队列和对话历史,本质就是一个列表。

预计用时:2.5 小时。对照 JS 和增删改 50 分钟,`b = a` 和遍历时删除 30 分钟,排序 30 分钟,小项目和队列 30 分钟,剩下做练习。

前置:[Day 15](/blog/agent-zero/day-015-strings-1/)(下标、负下标、切片,列表用同一套规则)、[Day 16](/blog/agent-zero/day-016-strings-2/)(`split`、`join`、`in`)、[Day 18](/blog/agent-zero/day-018-for-range/)(`for`、`range`、`enumerate`)、[Day 19](/blog/agent-zero/day-019-while-break/)(`while`、`break`、`MAX_STEPS`)。今天不调任何 API,花费 0 元。

学法提示:先对照文章逐行敲一遍(代码自己敲,不复制粘贴)并跑通;第二天合上文章,把 `ticket_amounts.py` 默写出来,看排序结果和文章是否一样;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚我是在哪跑的

输出是我 2026-10-23 在 2019 款 Intel MacBook Pro(macOS 14、zsh)上用演示家目录真跑的,家目录显示成 `/Users/你`,`~/agent-zero-lab` 接着 Day 20 的状态,`uv run python` 是 3.12.13,Ruff 是 0.17.2,basedpyright 是 standard 档。今天的脚本都放在 `part01/`,在仓库根目录用 `uv run python part01/文件名.py` 运行,不读键盘输入。JS 的对照用 `node -e` 跑,Node 你本来就有。

## 列表和 JS 数组:先对照

先用 JS 把今天要讲的几件事过一遍。你对这些很熟,重点看最后三行输出:

```text
$ node -e '
const ids = ["T001", "T002", "T003"];
ids.push("T004");
console.log(ids.length, ids[0], ids.at(-1), ids.slice(1, 3));
console.log(ids.pop(), ids.shift(), ids);
console.log(ids.indexOf("T003"), ids.indexOf("T999"), ids.includes("T003"));
const amounts = [29900, 4900, 59800, 46800, 100, 9];
console.log(amounts.sort());
console.log(amounts.sort((a, b) => a - b));
const r = amounts.sort((a, b) => b - a);
console.log(r === amounts);
'
4 T001 T004 [ 'T002', 'T003' ]
T004 T001 [ 'T002', 'T003' ]
1 -1 true
[ 100, 29900, 46800, 4900, 59800, 9 ]
[ 9, 100, 4900, 29900, 46800, 59800 ]
true
```

<div class="line-notes">

- `const ids = ["T001", "T002", "T003"];` 一个有三项的数组。
- `ids.push("T004");` 往末尾加一项,现在有 4 项。
- `console.log(ids.length, ids[0], ids.at(-1), ids.slice(1, 3));` 长度、第一项、最后一项、切片。打印出 `4 T001 T004 [ 'T002', 'T003' ]`:`slice(1, 3)` 取下标 1 和 2,左闭右开,和 Python 的切片规则一样(Day 15)。
- `console.log(ids.pop(), ids.shift(), ids);` `pop()` 拿走并返回最后一项 `T004`,`shift()` 拿走并返回第一项 `T001`,数组剩下 `[ 'T002', 'T003' ]`。
- `console.log(ids.indexOf("T003"), ids.indexOf("T999"), ids.includes("T003"));` `indexOf` 找不到返回 `-1`,不报错;`includes` 返回布尔。输出 `1 -1 true`。
- `const amounts = [29900, 4900, 59800, 46800, 100, 9];` 六个金额(单位分)。
- `console.log(amounts.sort());` **不带参数的 `sort` 把数字当字符串排**,所以 `100` 排在 `29900` 前面,`9` 排在最后:`[ 100, 29900, 46800, 4900, 59800, 9 ]`。这是 JS 的老坑。
- `console.log(amounts.sort((a, b) => a - b));` 传一个比较函数才是按数值升序:`[ 9, 100, 4900, 29900, 46800, 59800 ]`。
- `const r = amounts.sort((a, b) => b - a);` 再倒序排一次。
- `console.log(r === amounts);` 输出 `true`:JS 的 `sort` 原地改数组,**同时把这个数组本身返回**,所以 `r` 和 `amounts` 是同一个。记住这一行,Python 在这里不一样。

</div>

Python 的列表(`list`)就是同一个东西,几乎一一对应:

| 想做的事 | JS | Python |
| --- | --- | --- |
| 建一个 | `["a", "b"]` | `["a", "b"]`,写法一样 |
| 个数 | `ids.length` | `len(ids)`,是函数不是属性 |
| 末尾加一项 | `ids.push(x)` | `ids.append(x)` |
| 取走末尾 | `ids.pop()` | `ids.pop()` |
| 取走开头 | `ids.shift()` | `ids.pop(0)` |
| 开头加一项 | `ids.unshift(x)` | `ids.insert(0, x)` |
| 最后一项 | `ids.at(-1)` | `ids[-1]`,直接写负下标(Day 15) |
| 切片 | `ids.slice(1, 3)` | `ids[1:3]` |
| 有没有 | `ids.includes(x)` | `x in ids`(Day 16) |
| 第几个 | `ids.indexOf(x)`,没有给 `-1` | `ids.index(x)`,没有就**报错** |
| 排序 | `arr.sort(...)`,原地改并返回自己 | `arr.sort()` 原地改、返回 `None`;`sorted(arr)` 返回新列表 |
| 拼两个 | `[...a, ...b]` 或 `a.concat(b)` | `a + b` |

最大的三处不同,今天都会碰到:`index` 找不到会报错而不是给 `-1`;`sort` 返回 `None`;还有 `b = a` 时 JS 和 Python 其实行为一样(都是共享),只是 Python 新手更容易在这里栽,后面单讲。

## 建列表、取、改

### 下标、切片和修改

新建 `part01/list_basics.py`:

```python
# agent-zero-lab/part01/list_basics.py
ids = ["T001", "T002", "T003", "T004"]

print(ids)
print(len(ids))
print(ids[0], ids[-1])
print(ids[1:3])
print("T003" in ids, "T009" in ids)

ids[0] = "T101"
print(ids)

mixed = ["T001", 299, True, None]
print(mixed)
print(type(ids), type(mixed[1]))
```

<div class="line-notes">

- `ids = ["T001", "T002", "T003", "T004"]` 四张工单号,下标 0 到 3。
- `print(ids)` 直接打印整个列表,Python 会带方括号和引号:`['T001', 'T002', 'T003', 'T004']`。注意是**单引号**,这是 `print` 展示列表的格式(Day 15 的 `repr`),不是你写错了。
- `print(len(ids))` 个数,输出 `4`。
- `print(ids[0], ids[-1])` 第一项和最后一项:`T001 T004`。`-1` 是倒数第一(Day 15),和字符串一样。
- `print(ids[1:3])` 切片,左闭右开,取下标 1、2,得到 `['T002', 'T003']`,**结果还是一个列表**。
- `print("T003" in ids, "T009" in ids)` `in` 问「列表里有没有这一项」,`True False`。
- `ids[0] = "T101"` **直接给某个位置赋新值**。字符串做不到这一点(Day 15 的 `str_immutable.py`),列表可以,这叫「可变」。赋值后下标 0 的 `T001` 变成了 `T101`。
- `print(ids)` 输出 `['T101', 'T002', 'T003', 'T004']`,只有第一项变了。
- `mixed = ["T001", 299, True, None]` 一个列表里可以放不同类型,和 JS 数组一样。实战里大多数列表放同一类东西,混着放往往是设计有问题。
- `print(mixed)` 输出 `['T001', 299, True, None]`,`True`、`None` 原样显示,没有引号(Day 14)。
- `print(type(ids), type(mixed[1]))` `type()` 报出类型:列表是 `<class 'list'>`,`mixed[1]` 是 `<class 'int'>`。

</div>

```text
$ cd ~/agent-zero-lab
$ uv run python part01/list_basics.py
['T001', 'T002', 'T003', 'T004']
4
T001 T004
['T002', 'T003']
True False
['T101', 'T002', 'T003', 'T004']
['T001', 299, True, None]
<class 'list'> <class 'int'>
```

<div class="line-notes">

- `['T001', 'T002', 'T003', 'T004']` 原始列表。
- `4` `len(ids)`。
- `T001 T004` 第一项和最后一项。
- `['T002', 'T003']` 切片。
- `True False` `T003` 在,`T009` 不在。
- `['T101', 'T002', 'T003', 'T004']` 改过之后,下标 0 变成 `T101`。
- `['T001', 299, True, None]` 混合类型的列表。
- `<class 'list'> <class 'int'>` 两个类型。

</div>

下标越界会怎样?和字符串一样(Day 15),新建 `part01/list_index_error.py`:

```python
# agent-zero-lab/part01/list_index_error.py
ids = ["T001", "T002", "T003", "T004"]
print(ids[4])
```

<div class="line-notes">

- `ids = ["T001", "T002", "T003", "T004"]` 四项,合法下标是 0 到 3(以及 -1 到 -4)。
- `print(ids[4])` 下标 4 不存在。

</div>

```text
$ uv run python part01/list_index_error.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/list_index_error.py", line 3, in <module>
    print(ids[4])
          ~~~^^^
IndexError: list index out of range
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/list_index_error.py", line 3, in <module>` 出事的位置:第 3 行。
- `print(ids[4])` 出事的那行代码,下面的 `~~~^^^` 指着 `[4]`。
- `IndexError: list index out of range` 下标超出范围。和 Day 15 的 `string index out of range` 是同一类错,只是把 string 换成了 list。**注意:切片越界不报错,`ids[1:99]` 只会给你尽量多的内容;单个下标越界才报错**,这一点和字符串一样。

</div>

### 列表是怎么来的

你不一定要手写方括号。新建 `part01/list_make.py`,把几种常见的「造列表」方式放在一起:

```python
# agent-zero-lab/part01/list_make.py
line = "T001 计费 C023"
parts = line.split()
print(parts, type(parts))
print(list("T001"))
print(list(range(1, 6)))
print([0] * 3)
print(["T"] + ["001"])
print(" / ".join(parts))

empty = []
print(empty, len(empty), bool(empty), bool(parts))
```

<div class="line-notes">

- `line = "T001 计费 C023"` 一行工单文本,三段。
- `parts = line.split()` Day 16 学过:`split()` 不带参数按空白拆,**返回列表**。
- `print(parts, type(parts))` 输出 `['T001', '计费', 'C023'] <class 'list'>`,`split` 的结果就是列表,所以下标、切片、`len`、`for` 都能直接用。
- `print(list("T001"))` `list(...)` 能把「一批东西」转成列表。字符串是一批字符,得到 `['T', '0', '0', '1']`。
- `print(list(range(1, 6)))` Day 18 说 `range` 只是「一个范围」,套上 `list` 才看得到每一项:`[1, 2, 3, 4, 5]`,终点 6 不包含。
- `print([0] * 3)` 列表乘整数是**重复**:`[0, 0, 0]`。造一个「三个格子,先全填 0」的计数器很方便。
- `print(["T"] + ["001"])` 加号把两个列表拼成一个新列表:`['T', '001']`。
- `print(" / ".join(parts))` `join` 是 `split` 的反操作(Day 16):把列表里的字符串用 ` / ` 连起来,`T001 / 计费 / C023`。注意 `join` 是字符串的方法,不是列表的方法,这和 JS 的 `parts.join(" / ")` 顺序是反的。
- `empty = []` 空列表,没有任何东西。
- `print(empty, len(empty), bool(empty), bool(parts))` 空列表长度是 0,`bool([])` 是 `False`,有内容的列表是 `True`(Day 14 的真值)。后面 `while queue:` 就靠这一点。

</div>

```text
$ uv run python part01/list_make.py
['T001', '计费', 'C023'] <class 'list'>
['T', '0', '0', '1']
[1, 2, 3, 4, 5]
[0, 0, 0]
['T', '001']
T001 / 计费 / C023
[] 0 False True
```

<div class="line-notes">

- `['T001', '计费', 'C023'] <class 'list'>` `split` 的结果确实是 list。
- `['T', '0', '0', '1']` 字符串拆成了一个个字符。
- `[1, 2, 3, 4, 5]` `range(1, 6)` 展开。
- `[0, 0, 0]` 重复三次。
- `['T', '001']` 拼接。
- `T001 / 计费 / C023` `join` 的结果是一个字符串,不是列表。
- `[] 0 False True` 空列表:内容是空、长度 0、当布尔是 `False`;非空列表当布尔是 `True`。

</div>

## 往里加东西

### append、insert、extend 和加号

新建 `part01/list_add.py`:

```python
# agent-zero-lab/part01/list_add.py
ids = ["T001", "T002"]

ids.append("T003")
print("append 后:", ids)

ids.insert(0, "T000")
print("insert 到开头:", ids)

ids.extend(["T004", "T005"])
print("extend 后:", ids)

more = ids + ["T006"]
print("加号拼出新列表:", more)
print("原来的 ids 没变:", ids)

ids.append(["T007", "T008"])
print("append 一个列表:", ids)
print("长度:", len(ids))
```

<div class="line-notes">

- `ids = ["T001", "T002"]` 从两项开始。
- `ids.append("T003")` **加到末尾**,原地修改 `ids`,不产生新列表,也没有返回值要接。
- `print("append 后:", ids)` `['T001', 'T002', 'T003']`。
- `ids.insert(0, "T000")` `insert(位置, 内容)`:插到下标 0,原来的项整体往后挪一格。`['T000', 'T001', 'T002', 'T003']`。
- `print("insert 到开头:", ids)` 打印验证。开头插入要挪动后面所有项,项数很多时比 `append` 慢,但几十几百项感觉不出来。
- `ids.extend(["T004", "T005"])` `extend` 的参数是**一批东西**,把它们**一项一项**接到末尾:一次加了两项。
- `print("extend 后:", ids)` 现在有 6 项,`T000` 到 `T005`。
- `more = ids + ["T006"]` 加号拼接,**产生新列表**赋给 `more`,`ids` 不动。
- `print("加号拼出新列表:", more)` `more` 有 7 项。
- `print("原来的 ids 没变:", ids)` `ids` 还是 6 项。
- `ids.append(["T007", "T008"])` 用 `append` 加一个列表,会把这个列表**整个当成一项**放进去。
- `print("append 一个列表:", ids)` 输出末尾是 `['T007', 'T008']`,带着方括号,是列表里套了一个列表。
- `print("长度:", len(ids))` 是 7,不是 8:6 项加上「一个列表」这一项。

</div>

```text
$ uv run python part01/list_add.py
append 后: ['T001', 'T002', 'T003']
insert 到开头: ['T000', 'T001', 'T002', 'T003']
extend 后: ['T000', 'T001', 'T002', 'T003', 'T004', 'T005']
加号拼出新列表: ['T000', 'T001', 'T002', 'T003', 'T004', 'T005', 'T006']
原来的 ids 没变: ['T000', 'T001', 'T002', 'T003', 'T004', 'T005']
append 一个列表: ['T000', 'T001', 'T002', 'T003', 'T004', 'T005', ['T007', 'T008']]
长度: 7
```

<div class="line-notes">

- `append 后: ['T001', 'T002', 'T003']` 末尾多了 `T003`。
- `insert 到开头: ['T000', 'T001', 'T002', 'T003']` `T000` 在最前,其他项后移。
- `extend 后: ['T000', 'T001', 'T002', 'T003', 'T004', 'T005']` 一次接了两项,每项独立。
- `加号拼出新列表: ['T000', 'T001', 'T002', 'T003', 'T004', 'T005', 'T006']` `more` 比 `ids` 多一个 `T006`。
- `原来的 ids 没变: ['T000', 'T001', 'T002', 'T003', 'T004', 'T005']` `ids` 里没有 `T006`。
- `append 一个列表: ['T000', 'T001', 'T002', 'T003', 'T004', 'T005', ['T007', 'T008']]` 最后一项是个列表。
- `长度: 7` 6 + 1。

</div>

`append` 和 `extend` 的区别用一句话记:**`append` 加一项,`extend` 加一批**。JS 里对应的是 `push(x)` 和 `push(...xs)`。

编辑器里 `ids.append(["T007", "T008"])` 这一行会有红线:basedpyright 报 `Argument of type "list[str]" cannot be assigned to parameter "object" of type "str"`。它从列表一开始装的全是字符串,推断出这是「字符串列表」,你却想塞进去一个列表。这一次是故意写错来演示,运行并不会失败;以后看到这种红线,多半是你把 `append` 和 `extend` 用反了。

### append 返回 None

初学者最常踩的一个坑:以为 `append` 像字符串方法一样返回一个新东西。回想 Day 16:字符串的 `strip()`、`replace()` 都**返回新字符串**,原来的不变。列表的 `append` 正相反:它**直接改原来的列表,返回 `None`**。新建 `part01/append_none.py`(故意写错):

```python
# agent-zero-lab/part01/append_none.py
ids = ["T001", "T002"]
ids = ids.append("T003")
print(ids)
ids.append("T004")
```

<div class="line-notes">

- `ids = ["T001", "T002"]` 一个正常的列表。
- `ids = ids.append("T003")` 这一行有两件事:先执行 `ids.append("T003")`,列表里确实加上了 `T003`;然后把 `append` 的**返回值**赋给 `ids`,而 `append` 返回的是 `None`。`ids` 这个名字从此指向 `None`,那个有三项的列表没人认领了。
- `print(ids)` 打印 `None`。
- `ids.append("T004")` 再对 `ids` 调 `append`,但 `ids` 现在是 `None`。

</div>

```text
$ uv run python part01/append_none.py
None
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/append_none.py", line 5, in <module>
    ids.append("T004")
    ^^^^^^^^^^
AttributeError: 'NoneType' object has no attribute 'append'
```

<div class="line-notes">

- `None` 第 4 行 `print(ids)` 的输出,先看到了异常的苗头。
- `File "/Users/你/agent-zero-lab/part01/append_none.py", line 5, in <module>` 崩在第 5 行。
- `ids.append("T004")` 崩的那行,下面的 `^^^^^^^^^^` 指着 `ids.append`。
- `AttributeError: 'NoneType' object has no attribute 'append'` 读法:`NoneType`(`None` 的类型)的对象没有 `append` 这个属性。看到 `'NoneType' object has no attribute ...` 就回头找:哪个变量被赋成了 `None`?九成是某个「原地修改」的方法的返回值被你赋给了变量。

</div>

编辑器会提前提醒你:`ids.append("T004")` 那一行有红线,`Cannot access attribute "append" for class "None"`,不用等运行。

修法是什么都不接:直接写 `ids.append("T003")` 一行,不要 `ids = `。**凡是原地修改列表的方法(`append`、`insert`、`extend`、`remove`、`sort`、`reverse`、`clear`)都返回 `None`,别接。**

## 往外拿东西

### pop、remove、del、clear

新建 `part01/list_remove.py`:

```python
# agent-zero-lab/part01/list_remove.py
ids = ["T001", "T002", "T003", "T004", "T005", "T006"]

last = ids.pop()
print("pop() 取走:", last, "剩下:", ids)

first = ids.pop(0)
print("pop(0) 取走:", first, "剩下:", ids)

ids.remove("T004")
print("remove('T004') 后:", ids)

del ids[1]
print("del ids[1] 后:", ids)

ids.clear()
print("clear 后:", ids, len(ids))
```

<div class="line-notes">

- `ids = ["T001", "T002", "T003", "T004", "T005", "T006"]` 六项。
- `last = ids.pop()` `pop()` 不带参数:**拿走最后一项并返回它**。`last` 得到 `"T006"`,`ids` 还剩五项。
- `print("pop() 取走:", last, "剩下:", ids)` 输出 `T006`,剩下 `T001` 到 `T005`。
- `first = ids.pop(0)` 带下标:拿走下标 0 的那一项并返回,`first` 是 `"T001"`,后面的项前移。
- `print("pop(0) 取走:", first, "剩下:", ids)` 剩下 `T002` 到 `T005`。
- `ids.remove("T004")` `remove(值)`:按**值**删,删第一个等于 `"T004"` 的项。没有返回值。
- `print("remove('T004') 后:", ids)` 剩下 `['T002', 'T003', 'T005']`。
- `del ids[1]` `del` 是语句不是方法,按**下标**删。此时下标 1 是 `"T003"`,删后剩 `['T002', 'T005']`。
- `print("del ids[1] 后:", ids)` 打印验证。
- `ids.clear()` 清空整个列表,但这个列表对象还在,只是变空了。
- `print("clear 后:", ids, len(ids))` 空列表 `[]`,长度 0。

</div>

```text
$ uv run python part01/list_remove.py
pop() 取走: T006 剩下: ['T001', 'T002', 'T003', 'T004', 'T005']
pop(0) 取走: T001 剩下: ['T002', 'T003', 'T004', 'T005']
remove('T004') 后: ['T002', 'T003', 'T005']
del ids[1] 后: ['T002', 'T005']
clear 后: [] 0
```

<div class="line-notes">

- `pop() 取走: T006 剩下: ['T001', 'T002', 'T003', 'T004', 'T005']` 末尾那项被拿走。
- `pop(0) 取走: T001 剩下: ['T002', 'T003', 'T004', 'T005']` 开头那项被拿走。
- `remove('T004') 后: ['T002', 'T003', 'T005']` 按值删掉了 `T004`。
- `del ids[1] 后: ['T002', 'T005']` 按下标 1 删掉了 `T003`。
- `clear 后: [] 0` 空了。

</div>

四种删法怎么选,看你手里有什么:

| 你知道的 | 用什么 | 删完还要这一项吗 |
| --- | --- | --- |
| 位置(最后一个、第一个) | `pop()` / `pop(0)` | 要,它返回被拿走的那一项 |
| 位置,不需要它 | `del ids[1]` | 不要 |
| 值 | `remove("T004")` | 不要,只删第一个匹配的 |
| 全删 | `clear()` | |

### 删不存在的东西

两个典型报错。`part01/list_remove_error.py`:

```python
# agent-zero-lab/part01/list_remove_error.py
ids = ["T001", "T002"]
ids.remove("T009")
```

<div class="line-notes">

- `ids = ["T001", "T002"]` 只有两项。
- `ids.remove("T009")` 要删的值不在列表里。

</div>

```text
$ uv run python part01/list_remove_error.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/list_remove_error.py", line 3, in <module>
    ids.remove("T009")
ValueError: list.remove(x): x not in list
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/list_remove_error.py", line 3, in <module>` 第 3 行。
- `ids.remove("T009")` 崩的那行。
- `ValueError: list.remove(x): x not in list` 读法:值错误,`remove` 想删的 `x` 不在列表里。**JS 的 `splice` 找不到就什么都不做,Python 的 `remove` 找不到会崩。**修法:先用 `in` 问一句,`if "T009" in ids: ids.remove("T009")`。

</div>

再一个,`part01/list_pop_empty.py`:

```python
# agent-zero-lab/part01/list_pop_empty.py
ids = []
ids.pop()
```

<div class="line-notes">

- `ids = []` 空列表。
- `ids.pop()` 想从空列表里拿一项。

</div>

```text
$ uv run python part01/list_pop_empty.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/list_pop_empty.py", line 3, in <module>
    ids.pop()
IndexError: pop from empty list
```

<div class="line-notes">

- `ids.pop()` 崩的那行。
- `IndexError: pop from empty list` 从空列表里 `pop`。JS 里 `[].pop()` 返回 `undefined` 不报错。Python 里要先确认列表不空:`if ids:`(Day 17),或者用 `while ids:` 循环,后面「Agent 里的列表」那一节就是这么用的。

</div>

### 遍历的时候别删

最阴险的坑不会报错,只会悄悄给你错的结果。场景:一批金额里有些是 0(没扣钱的工单),想把 0 都删掉。直觉写法 `part01/remove_in_loop.py`:

```python
# agent-zero-lab/part01/remove_in_loop.py
amounts = [0, 0, 299, 49]

for amount in amounts:
    print("看到", amount, "当前列表", amounts)
    if amount == 0:
        amounts.remove(amount)

print("结果:", amounts)
```

<div class="line-notes">

- `amounts = [0, 0, 299, 49]` 四项,前两项是 0,**连在一起**。
- `for amount in amounts:` 遍历这个列表。
- `print("看到", amount, "当前列表", amounts)` 每轮打印这一轮看到的值,和列表此刻的样子,看清楚发生了什么。
- `if amount == 0:` 是 0 吗?
- `amounts.remove(amount)` 从**正在遍历的这个列表**里删掉第一个 0。
- `print("结果:", amounts)` 循环结束后的列表。

</div>

```text
$ uv run python part01/remove_in_loop.py
看到 0 当前列表 [0, 0, 299, 49]
看到 299 当前列表 [0, 299, 49]
看到 49 当前列表 [0, 299, 49]
结果: [0, 299, 49]
```

<div class="line-notes">

- `看到 0 当前列表 [0, 0, 299, 49]` 第 1 轮,看的是下标 0 的项,是 0,于是 `remove(0)` 删掉下标 0 的那个 0,列表变成 `[0, 299, 49]`。
- `看到 299 当前列表 [0, 299, 49]` 第 2 轮。`for` 内部记着「下一个看下标 1」,可列表被删短了,**下标 1 现在是 299**。原来下标 1 的第二个 0 往前挪到了下标 0,`for` 已经走过下标 0,所以**那个 0 被跳过了**。
- `看到 49 当前列表 [0, 299, 49]` 第 3 轮看下标 2,是 49。
- `结果: [0, 299, 49]` 还剩一个 0,没删干净,也没有任何报错。

</div>

原因一句话:`for` 按下标一路往后走,你却在中间抽走了一项,后面的项整体前移,下一项就被错过了。两个稳妥的改法放在 `part01/remove_in_loop_fixed.py`:

```python
# agent-zero-lab/part01/remove_in_loop_fixed.py
amounts = [0, 0, 299, 49]

kept = []
for amount in amounts:
    if amount != 0:
        kept.append(amount)

print("原来的:", amounts)
print("留下的:", kept)

amounts_copy = amounts.copy()
for amount in amounts_copy:
    if amount == 0:
        amounts.remove(amount)
print("遍历副本删原件:", amounts)
```

<div class="line-notes">

- `amounts = [0, 0, 299, 49]` 同一份数据。
- `kept = []` 改法一:另开一个空列表,装「要留下的」。
- `for amount in amounts:` 遍历原列表,**不修改它**。
- `if amount != 0:` 不是 0 才留。
- `kept.append(amount)` 留下的加进新列表。
- `print("原来的:", amounts)` 原列表完好无损,`[0, 0, 299, 49]`。
- `print("留下的:", kept)` 新列表 `[299, 49]`。
- `amounts_copy = amounts.copy()` 改法二:先拷贝一份(下一节细讲),`amounts_copy` 是内容相同的另一个列表。
- `for amount in amounts_copy:` 遍历**副本**。
- `if amount == 0:` 副本里的值是 0 吗?
- `amounts.remove(amount)` 从**原列表**里删。副本不会因此变短,遍历不会错位。
- `print("遍历副本删原件:", amounts)` 原列表现在只剩 `[299, 49]`。

</div>

```text
$ uv run python part01/remove_in_loop_fixed.py
原来的: [0, 0, 299, 49]
留下的: [299, 49]
遍历副本删原件: [299, 49]
```

<div class="line-notes">

- `原来的: [0, 0, 299, 49]` 方法一没碰原列表。
- `留下的: [299, 49]` 两个 0 都没留下。
- `遍历副本删原件: [299, 49]` 方法二也得到同样的结果。

</div>

**经验法则:遍历谁,就别改谁。** 想筛选,优先用「另开一个新列表,把要的 `append` 进去」。后天的列表推导式([Day 23](/blog/agent-zero/day-023-comprehensions/))会把这种写法压成一行。

## 一个列表,两个名字

### b = a 不是复制

JS 里 `const b = a`(`a` 是数组)也是共享同一个数组,你应该踩过。先用 JS 复习一下:

```text
$ node -e '
const a = [1, 2];
const b = a;
b.push(3);
console.log(a, b, a === b);
const c = [...a];
console.log(c === a);
'
[ 1, 2, 3 ] [ 1, 2, 3 ] true
false
```

<div class="line-notes">

- `const a = [1, 2];` 一个数组。
- `const b = a;` `b` 和 `a` 是**同一个**数组的两个名字,不是拷贝。
- `b.push(3);` 通过 `b` 加一项。
- `console.log(a, b, a === b);` `a` 也变成了 `[ 1, 2, 3 ]`,`a === b` 是 `true`。
- `const c = [...a];` 展开运算符造了一份**新数组**。
- `console.log(c === a);` `false`:内容一样,但不是同一个。

</div>

Python 完全一样。`part01/list_alias.py`:

```python
# agent-zero-lab/part01/list_alias.py
a = ["T001", "T002"]
b = a
b.append("T003")
print("a =", a)
print("b =", b)
print("a is b:", a is b)

c = a.copy()
c.append("T004")
print("a =", a)
print("c =", c)
print("a is c:", a is c)
print("a == c:", a == c)
```

<div class="line-notes">

- `a = ["T001", "T002"]` 造一个列表,名字 `a` 指向它。
- `b = a` **没有造新列表**,只是让名字 `b` 也指向同一个列表。
- `b.append("T003")` 通过 `b` 加一项,改的是那一个共享的列表。
- `print("a =", a)` 通过 `a` 看,也有 `T003`。
- `print("b =", b)` 通过 `b` 看,当然有。
- `print("a is b:", a is b)` `is` 问「是不是同一个对象」,不是问「内容一样不一样」。`True`。
- `c = a.copy()` `.copy()` 造一个内容相同的**新列表**,`c` 指向它。写 `a[:]`(切片取全部)效果一样。
- `c.append("T004")` 只改 `c`。
- `print("a =", a)` `a` 没有 `T004`。
- `print("c =", c)` `c` 有 `T004`。
- `print("a is c:", a is c)` `False`,两个不同的对象。
- `print("a == c:", a == c)` `==` 比较内容。现在 `c` 多一项,所以 `False`;如果刚拷贝完还没改,`a == c` 是 `True` 而 `a is c` 是 `False`。

</div>

```text
$ uv run python part01/list_alias.py
a = ['T001', 'T002', 'T003']
b = ['T001', 'T002', 'T003']
a is b: True
a = ['T001', 'T002', 'T003']
c = ['T001', 'T002', 'T003', 'T004']
a is c: False
a == c: False
```

<div class="line-notes">

- `a = ['T001', 'T002', 'T003']` 虽然只对 `b` 调了 `append`,`a` 也有了 `T003`。
- `b = ['T001', 'T002', 'T003']` `b` 和 `a` 完全一样。
- `a is b: True` 同一个对象。
- `a = ['T001', 'T002', 'T003']` `c` 加了 `T004` 之后,`a` 不受影响。
- `c = ['T001', 'T002', 'T003', 'T004']` 只有 `c` 有 `T004`。
- `a is c: False` 拷贝出来的是另一个对象。
- `a == c: False` 内容也不同了。

</div>

画出来是这样,名字是贴在盒子上的标签,不是盒子本身:

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="b = a 时 a 和 b 两个名字指向同一个列表盒子,里面有 T001 T002 T003;c = a.copy() 时 c 指向另一个盒子,里面多一项 T004">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink-soft)">b = a  两个名字,一个列表</text>
<rect x="20" y="44" width="40" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="35" y="62" fill="var(--ink)">a</text>
<rect x="20" y="86" width="40" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="35" y="104" fill="var(--ink)">b</text>
<line x1="60" y1="57" x2="120" y2="80" stroke="var(--ink-soft)"/>
<line x1="60" y1="99" x2="120" y2="84" stroke="var(--ink-soft)"/>
<polygon points="114,75 122,81 112,85" fill="var(--ink-soft)"/>
<rect x="124" y="56" width="236" height="46" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="136" y="84" fill="var(--ink)">['T001','T002','T003']</text>
<text x="20" y="140" fill="var(--ink-soft)">c = a.copy()  复制出另一个盒子</text>
<rect x="20" y="156" width="40" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="35" y="174" fill="var(--ink)">c</text>
<line x1="60" y1="169" x2="120" y2="180" stroke="var(--ink-soft)"/>
<polygon points="112,174 122,180 110,182" fill="var(--ink-soft)"/>
<rect x="124" y="156" width="316" height="46" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="136" y="184" fill="var(--ink)">['T001','T002','T003','T004']</text>
<text x="380" y="84" fill="var(--ink-faint)">通过 a 或 b 改,另一个都看得到</text>
</g>
</svg>
<figcaption>名字是标签,列表是盒子。b = a 只是多贴一张标签,a 和 b 看到的永远是同一个盒子;copy() 才会再造一个盒子。</figcaption>
</figure>

为什么 Python 要这样设计?因为列表可能很大,每次赋值都复制一遍既慢又费内存。代价是你要自己分清「我要的是同一个」还是「我要的是一份拷贝」。Agent 代码里这个区别很要命:你把对话历史 `messages` 传给两个地方,一个地方往里加了一条,另一个地方悄悄也变了。

**`.copy()` 只复制最外面一层。** 列表里面如果还套着列表,里层的还是共享的。这个问题等到 [Day 26](/blog/agent-zero/day-026-nested-data/) 嵌套数据再讲(`copy.deepcopy`)。今天的列表里装的都是字符串和数字,`.copy()` 够用。

## 找和量

新建 `part01/list_search.py`:

```python
# agent-zero-lab/part01/list_search.py
cats = ["计费", "登录", "计费", "功能", "计费"]

print("计费 出现", cats.count("计费"), "次")
print("第一个 登录 在下标", cats.index("登录"))
print("从下标 1 往后找 计费:", cats.index("计费", 1))
print("有 退款 吗:", "退款" in cats)

amounts = [29900, 46800, 4900, 59800]
print("最小", min(amounts), "最大", max(amounts), "合计", sum(amounts))
print("有", len(amounts), "笔,平均", sum(amounts) // len(amounts), "分")
```

<div class="line-notes">

- `cats = ["计费", "登录", "计费", "功能", "计费"]` 五张工单的类别,「计费」出现了三次。
- `print("计费 出现", cats.count("计费"), "次")` `count(值)` 数一数出现几次:3。
- `print("第一个 登录 在下标", cats.index("登录"))` `index(值)` 返回**第一个**匹配项的下标:`"登录"` 在下标 1。
- `print("从下标 1 往后找 计费:", cats.index("计费", 1))` `index` 的第二个参数是「从哪里开始找」。从下标 1 往后找,跳过下标 0 的第一个「计费」,找到下标 2 的。
- `print("有 退款 吗:", "退款" in cats)` `in` 问有没有,不报错:`False`。
- `amounts = [29900, 46800, 4900, 59800]` 四个金额,单位分(Day 12:金额用整数分)。
- `print("最小", min(amounts), "最大", max(amounts), "合计", sum(amounts))` 三个内置函数,直接吃一个数字列表:最小 4900,最大 59800,合计 141400。
- `print("有", len(amounts), "笔,平均", sum(amounts) // len(amounts), "分")` 平均数 = 合计 `//` 个数。141400 除以 4 是 35350,整除正好。

</div>

```text
$ uv run python part01/list_search.py
计费 出现 3 次
第一个 登录 在下标 1
从下标 1 往后找 计费: 2
有 退款 吗: False
最小 4900 最大 59800 合计 141400
有 4 笔,平均 35350 分
```

<div class="line-notes">

- `计费 出现 3 次` 下标 0、2、4 各一个。
- `第一个 登录 在下标 1` 下标从 0 数起。
- `从下标 1 往后找 计费: 2` 不是 0。
- `有 退款 吗: False` `in` 没找到只是 `False`。
- `最小 4900 最大 59800 合计 141400` 4900 + 29900 + 46800 + 59800 = 141400。
- `有 4 笔,平均 35350 分` 也就是 353.5 元。用 `//` 会丢掉小数部分,这里恰好整除。

</div>

`index` 在找不到时报错,这是和 JS `indexOf` 返回 `-1` 最大的不同。`part01/list_index_missing.py`:

```python
# agent-zero-lab/part01/list_index_missing.py
cats = ["计费", "登录"]
print(cats.index("功能"))
```

<div class="line-notes">

- `cats = ["计费", "登录"]` 只有两项。
- `print(cats.index("功能"))` 要找的「功能」不在里面。

</div>

```text
$ uv run python part01/list_index_missing.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/list_index_missing.py", line 3, in <module>
    print(cats.index("功能"))
          ^^^^^^^^^^^^^^^^^^
ValueError: '功能' is not in list
```

<div class="line-notes">

- `print(cats.index("功能"))` 崩的那行。
- `ValueError: '功能' is not in list` 值错误:`'功能'` 不在列表里。和字符串的 `find`(找不到返回 `-1`,Day 16)是两种风格:`find` 温和,`index` 严格。列表只有 `index`,所以用之前先 `in` 一下,或者想想「找不到的时候我要怎么办」。

</div>

## 排序

### sort 和 sorted

排序是今天最重要的一块。新建 `part01/list_sort.py`:

```python
# agent-zero-lab/part01/list_sort.py
amounts = [29900, 4900, 59800, 46800]

result = amounts.sort()
print("sort() 返回:", result)
print("amounts 本身变了:", amounts)

nums = [29900, 4900, 59800, 46800]
ordered = sorted(nums)
print("sorted 新列表:", ordered)
print("nums 没变:", nums)
print("从大到小:", sorted(nums, reverse=True))

texts = ["10", "9", "100", "1"]
print("字符串排序:", sorted(texts))
as_int = []
for t in texts:
    as_int.append(int(t))
print("转成整数再排:", sorted(as_int))

cats = ["计费", "登录", "功能"]
print("中文排序:", sorted(cats))
print("码点:", [hex(ord(c[0])) for c in cats])

words = ["bb", "a", "ccc", "dd", "e"]
print("按长度:", sorted(words, key=len))
print("按长度倒序:", sorted(words, key=len, reverse=True))
```

<div class="line-notes">

- `amounts = [29900, 4900, 59800, 46800]` 四个金额,乱序。
- `result = amounts.sort()` `sort()` **原地**把 `amounts` 排好,然后返回 `None`,所以 `result` 是 `None`。
- `print("sort() 返回:", result)` 输出 `None`。和 JS 不一样,JS 的 `sort` 会把数组自己返回(上面 `r === amounts` 是 `true`)。
- `print("amounts 本身变了:", amounts)` `amounts` 已经是升序 `[4900, 29900, 46800, 59800]`。
- `nums = [29900, 4900, 59800, 46800]` 一份新的乱序数据。
- `ordered = sorted(nums)` `sorted(...)` 是**函数**,返回一个排好序的**新列表**,不动原来的。
- `print("sorted 新列表:", ordered)` 升序的新列表。
- `print("nums 没变:", nums)` `nums` 还是原来的乱序。
- `print("从大到小:", sorted(nums, reverse=True))` `reverse=True` 倒序。`reverse` 是**关键字参数**,必须写成 `reverse=True`,不能只写 `True`。
- `texts = ["10", "9", "100", "1"]` 四个字符串,内容是数字。
- `print("字符串排序:", sorted(texts))` 字符串是一个字符一个字符比的,`"1"` 比 `"10"` 短所以在前,`"10"` 和 `"100"` 前两位相同、`"10"` 短在前,`"9"` 的第一个字符 `9` 大于 `1`,所以排最后:`['1', '10', '100', '9']`。这和 JS 不带参数 `sort` 的老坑是同一回事。
- `as_int = []` 新开一个空列表,装转成整数的结果。
- `for t in texts:` 遍历字符串。
- `as_int.append(int(t))` 每个转成整数再加进去(Day 14 的 `int`)。
- `print("转成整数再排:", sorted(as_int))` 按数值排:`[1, 9, 10, 100]`。**排序前先把类型变对。**
- `cats = ["计费", "登录", "功能"]` 三个中文类别。
- `print("中文排序:", sorted(cats))` 结果是 `['功能', '登录', '计费']`。
- `print("码点:", [hex(ord(c[0])) for c in cats])` 把每个类别的第一个字的码点(Day 16)用十六进制打出来。这一行里方括号加 `for` 的写法是后天([Day 23](/blog/agent-zero/day-023-comprehensions/))才学的列表推导式,今天只看输出:「计费」是 `0x8ba1`,「登录」是 `0x767b`,「功能」是 `0x529f`。排序就是按这个数字从小到大,和拼音、笔画都没关系。
- `words = ["bb", "a", "ccc", "dd", "e"]` 五个长短不一的词。
- `print("按长度:", sorted(words, key=len))` `key=` 的意思是「**拿每一项的什么来比较**」。`key=len` 就是拿每项的长度比。注意写 `len`,**后面不加括号**:是把函数本身交给 `sorted`,让它自己去调。结果 `['a', 'e', 'bb', 'dd', 'ccc']`。
- `print("按长度倒序:", sorted(words, key=len, reverse=True))` 两个参数可以一起用:`['ccc', 'bb', 'dd', 'a', 'e']`。

</div>

```text
$ uv run python part01/list_sort.py
sort() 返回: None
amounts 本身变了: [4900, 29900, 46800, 59800]
sorted 新列表: [4900, 29900, 46800, 59800]
nums 没变: [29900, 4900, 59800, 46800]
从大到小: [59800, 46800, 29900, 4900]
字符串排序: ['1', '10', '100', '9']
转成整数再排: [1, 9, 10, 100]
中文排序: ['功能', '登录', '计费']
码点: ['0x8ba1', '0x767b', '0x529f']
按长度: ['a', 'e', 'bb', 'dd', 'ccc']
按长度倒序: ['ccc', 'bb', 'dd', 'a', 'e']
```

<div class="line-notes">

- `sort() 返回: None` 返回的是 `None`。
- `amounts 本身变了: [4900, 29900, 46800, 59800]` 原地变成升序。
- `sorted 新列表: [4900, 29900, 46800, 59800]` 新列表,升序。
- `nums 没变: [29900, 4900, 59800, 46800]` 原列表仍是乱序。
- `从大到小: [59800, 46800, 29900, 4900]` 降序。
- `字符串排序: ['1', '10', '100', '9']` 逐字符比较的结果。
- `转成整数再排: [1, 9, 10, 100]` 数值顺序。
- `中文排序: ['功能', '登录', '计费']` 按码点:`0x529f` < `0x767b` < `0x8ba1`。
- `码点: ['0x8ba1', '0x767b', '0x529f']` 注意这行的顺序是 `cats` 原来的顺序(计费、登录、功能),不是排序后的。
- `按长度: ['a', 'e', 'bb', 'dd', 'ccc']` 长度 1、1、2、2、3。
- `按长度倒序: ['ccc', 'bb', 'dd', 'a', 'e']` 注意 `a` 和 `e` 的先后:原来 `a` 在 `e` 前面,倒序之后 `a` 仍在 `e` 前面。

</div>

最后一行值得多看一眼:长度相同的两项(`bb` 和 `dd`、`a` 和 `e`),**排完之后保持原来的先后顺序**,即使 `reverse=True` 也一样。这叫排序的**稳定性**(stable)。它有用:你可以先按一个条件排,再按另一个条件排,第一次的顺序会在第二次的「并列」里保留下来。JS 现在的标准也保证 `sort` 稳定。

**要不要选 `sort()` 还是 `sorted()`?** 我的习惯:要保留原来的顺序,或者在 `print(...)` 里随手看一下,用 `sorted`;这个列表后面就一直用排好的了,用 `sort()`。不管哪个,别写 `x = x.sort()`。

### 混着类型排不了

JS 的 `sort` 什么都敢排(它把所有东西转成字符串比)。Python 不会替你猜。`part01/sort_mixed_error.py`:

```python
# agent-zero-lab/part01/sort_mixed_error.py
values = [29900, "4900", 59800]
values.sort()
```

<div class="line-notes">

- `values = [29900, "4900", 59800]` 第二项是字符串 `"4900"`,另外两项是整数。这种情况在数据是从文本里读出来时很常见:有的转了类型,有的没转。
- `values.sort()` 要比较 `29900` 和 `"4900"`,Python 不知道谁大。

</div>

```text
$ uv run python part01/sort_mixed_error.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/sort_mixed_error.py", line 3, in <module>
    values.sort()
TypeError: '<' not supported between instances of 'str' and 'int'
```

<div class="line-notes">

- `values.sort()` 崩的那行。
- `TypeError: '<' not supported between instances of 'str' and 'int'` 读法:字符串和整数之间没法用 `<`。**排序之前把整个列表转成同一种类型。**编辑器的 basedpyright 对这一条没有提前报红线,因为它看到的是「元素类型是 `int | str`」,觉得有可能比得了,所以这类错只有跑了才知道。

</div>

## 小项目:把工单按金额排出来

现在把今天学的零件拼起来。场景:客服组长想看这一批工单里,**金额最大的是哪几张**。数据沿用 Day 20 的写法,每行是「工单号 类别 客户号 描述」,描述里有的带「N元」,有的没有。

要求:从每行描述里抠出金额(Day 20 的 `amount_v2.py` 那套,先找「元」再往前退),存成 `[金额分, 工单号]` 的小列表,放进一个大列表 `rows`;没金额的工单号单独放另一个列表;最后从高到低排序,打印名次、前三名、合计,再用 `pop(0)` 取走最大的一张。新建 `part01/ticket_amounts.py`:

```python
# agent-zero-lab/part01/ticket_amounts.py
raw_lines = [
    "T201 计费 C023 8月2日重复扣款299元",
    "T202 登录 C007 验证码收不到",
    "T203 计费 C015 年付多扣了468元,要求退款",
    "T204 计费 C042 发票金额对不上,多收了49元",
    "T205 功能 C031 导出PDF乱码",
    "T206 计费 C023 扣了两次,共598元",
    "T207 计费 C007 想把月付改成年付",
    "T208 计费 C031 退款299元到账了吗",
]

rows = []
no_amount = []

for line in raw_lines:
    parts = line.split(maxsplit=3)
    ticket_id = parts[0]
    desc = parts[3]

    pos = desc.find("元")
    if pos == -1:
        no_amount.append(ticket_id)
        continue

    start = pos
    while start > 0 and desc[start - 1].isdigit():
        start -= 1
    if start == pos:
        no_amount.append(ticket_id)
        continue

    fen = int(desc[start:pos]) * 100
    rows.append([fen, ticket_id])

print("抠出金额的:", len(rows), "张,没有金额的:", no_amount)
print("排序前:", rows)

rows.sort(reverse=True)
print("排序后:", rows)

print()
print("按金额从高到低:")
for rank, row in enumerate(rows, start=1):
    fen = row[0]
    ticket_id = row[1]
    print(f"{rank}. {ticket_id} {fen // 100:>4} 元")

top3 = rows[:3]
print()
print("前三名:", top3)

fens = []
for row in rows:
    fens.append(row[0])
print(
    f"合计 {sum(fens) // 100} 元,最大 {max(fens) // 100} 元,最小 {min(fens) // 100} 元"
)

biggest = rows.pop(0)
print("取走最大的一张:", biggest, "还剩", len(rows), "张")
```

<div class="line-notes">

- `raw_lines = [` 8 行工单,工单号 T201 到 T208。5 张描述里有「N元」,3 张没有(登录、功能、「想把月付改成年付」)。其中 T201 和 T208 的金额**一样**,都是 299 元,故意的,为了看并列怎么排。
- `rows = []` 空列表,最后会装 5 个 `[金额分, 工单号]`。`rows` 是**列表里套列表**,每一项又是一个两项的列表。
- `no_amount = []` 另一个空列表,装没有金额的工单号。
- `for line in raw_lines:` 一行一行处理。
- `parts = line.split(maxsplit=3)` 最多拆成四段(Day 16),第四段是完整描述。比如第一行拆成 `['T201', '计费', 'C023', '8月2日重复扣款299元']`。
- `ticket_id = parts[0]` 工单号。
- `desc = parts[3]` 描述。
- `pos = desc.find("元")` 找「元」的下标(Day 16)。第一行里「元」的下标是 11(它前面有 11 个字符),`pos` 是 11;T202「验证码收不到」没有「元」,`pos` 是 `-1`。
- `if pos == -1:` 第一道关卡:没有「元」。
- `no_amount.append(ticket_id)` 记下这个工单号,今天的新东西:往列表里加。
- `continue` 这一张处理完了,回到 `for` 的开头(Day 19)。
- `start = pos` 从「元」的位置开始往前退。
- `while start > 0 and desc[start - 1].isdigit():` 前一个字符还是数字就继续退(Day 20 同款)。T201 里「元」前面是 `9`、`9`、`2`,退到「款」停。
- `start -= 1` 退一格。
- `if start == pos:` 第二道关卡:一格都没退,说明「元」前面不是数字。
- `no_amount.append(ticket_id)` 同样记下来。
- `continue` 跳过。
- `fen = int(desc[start:pos]) * 100` 能走到这里,`desc[start:pos]` 一定是纯数字,比如 `"299"`。转成整数再乘 100,换成分:`29900`(Day 12:金额用整数分)。
- `rows.append([fen, ticket_id])` 把 `[29900, "T201"]` 作为**一项**加进 `rows`。方括号是故意加的:加的是一个两项的小列表,不是 `extend`。**把金额放在前面、工单号放在后面是故意的**,马上要用。
- `print("抠出金额的:", len(rows), "张,没有金额的:", no_amount)` 5 张和 3 个工单号。
- `print("排序前:", rows)` 按原来出现的顺序。
- `rows.sort(reverse=True)` 原地、倒序。每一项是个列表,**列表和列表比较是「先比第一项;第一项相同再比第二项」**:`[29900, 'T208']` 和 `[29900, 'T201']` 第一项相同,就比 `'T208'` 和 `'T201'`,`'T208'` 大。
- `print("排序后:", rows)` 打印排好序的 `rows`。
- `print()` 空一行。
- `print("按金额从高到低:")` 小标题。
- `for rank, row in enumerate(rows, start=1):` Day 18 的 `enumerate`:`rank` 是名次 1 到 5,`row` 是 `[金额, 工单号]`。
- `fen = row[0]` 取小列表的第 0 项:金额。
- `ticket_id = row[1]` 取第 1 项:工单号。
- `print(f"{rank}. {ticket_id} {fen // 100:>4} 元")` `fen // 100` 换回元,`:>4` 右对齐占 4 格(Day 15),数字对得齐。
- `top3 = rows[:3]` 切片取前三项,`rows[:3]` 等于 `rows[0:3]`,结果是新列表。
- `print("前三名:", top3)` 打印前三名。
- `fens = []` 单独收一个「只有金额」的列表,给 `sum`、`max`、`min` 用,它们要吃数字列表。
- `fens.append(row[0])` 每行只取金额。
- `print(` 这条 `print` 太长,Ruff 的格式化把它拆成了三行:括号里一条 f-string,合计、最大、最小各取元为单位。
- `biggest = rows.pop(0)` 取走排第一的那一项,同时拿到它:`[59800, 'T206']`。
- `print("取走最大的一张:", biggest, "还剩", len(rows), "张")` `rows` 现在只剩 4 项。

</div>

```text
$ uv run python part01/ticket_amounts.py
抠出金额的: 5 张,没有金额的: ['T202', 'T205', 'T207']
排序前: [[29900, 'T201'], [46800, 'T203'], [4900, 'T204'], [59800, 'T206'], [29900, 'T208']]
排序后: [[59800, 'T206'], [46800, 'T203'], [29900, 'T208'], [29900, 'T201'], [4900, 'T204']]

按金额从高到低:
1. T206  598 元
2. T203  468 元
3. T208  299 元
4. T201  299 元
5. T204   49 元

前三名: [[59800, 'T206'], [46800, 'T203'], [29900, 'T208']]
合计 1713 元,最大 598 元,最小 49 元
取走最大的一张: [59800, 'T206'] 还剩 4 张
```

<div class="line-notes">

- `抠出金额的: 5 张,没有金额的: ['T202', 'T205', 'T207']` T202 登录、T205 导出 PDF、T207「想把月付改成年付」都没有「元」。
- `排序前: [[29900, 'T201'], [46800, 'T203'], [4900, 'T204'], [59800, 'T206'], [29900, 'T208']]` 按出现顺序,每项是 `[金额分, 工单号]`。
- `排序后: [[59800, 'T206'], [46800, 'T203'], [29900, 'T208'], [29900, 'T201'], [4900, 'T204']]` 金额从大到小。**两个 29900 里 `T208` 排在 `T201` 前面**:并列时按第二项倒序。
- `1. T206  598 元` 名次、工单号、金额(元)。`{fen // 100:>4}` 让「598」「468」「 49」的个位对齐。
- `2. T203  468 元` 第二名。
- `3. T208  299 元` 并列的第一个。
- `4. T201  299 元` 并列的第二个。
- `5. T204   49 元` 最后一名,前面补了三个空格。
- `前三名: [[59800, 'T206'], [46800, 'T203'], [29900, 'T208']]` 前三项。
- `合计 1713 元,最大 598 元,最小 49 元` 59800 + 46800 + 29900 + 29900 + 4900 = 171300 分,除以 100 是 1713 元。
- `取走最大的一张: [59800, 'T206'] 还剩 4 张` `pop(0)` 拿走并返回了第一项。

</div>

这里值得想一想:并列时「`T208` 在前、`T201` 在后」是不是你想要的?不一定。如果想「金额相同时先来的排前面」,就不能整个 `reverse=True`。解决办法要用到 `key=` 加一个自己写的小函数,函数在 [Day 28](/blog/agent-zero/day-028-functions-1/) 才学,所以今天先不处理。明天的元组会让这个 `[金额, 工单号]` 的写法更正式一点。

basedpyright 在 standard 档对这个脚本零报错。Ruff 一开始提示一处格式:最后那条 `print` 超过 88 个字符,让它重新格式化就好,文章里贴的已经是格式化之后的样子。

## Agent 里的列表

列表在 Agent 里随处可见,今天先看两种最基本的形状。

**第一种:只会往后加的清单。** 和大模型的对话,每一轮你发一条、它回一条,下一轮要把前面所有的都带上。程序里它就是一个 `messages` 列表,每来一条就 `append` 一条,从来不删(第二部分你会天天写它,[Day 135](/blog/agent-zero/day-135-llm-client-1/) 封装的 `Conversation` 里就是这样一个列表)。

**第二种:队列。** 「待办任务」一个个来,先来的先处理,处理时可能发现新任务要追加。这就是 `while` 加 `pop(0)` 加 `append`。新建 `part01/agent_queue.py`:

```python
# agent-zero-lab/part01/agent_queue.py
MAX_STEPS = 10

queue = ["T201", "T202", "T203"]
history = []
steps = 0

while queue and steps < MAX_STEPS:
    steps += 1
    ticket_id = queue.pop(0)
    history.append(f"处理 {ticket_id}")
    print(f"第 {steps} 步:取出 {ticket_id},队列还剩 {queue}")

    if ticket_id == "T203":
        queue.append("T203-查发票")
        history.append("T203 需要先查发票,追加一个子任务")

if queue:
    print(f"到了 {MAX_STEPS} 步上限,队列里还有 {queue}")
else:
    print(f"队列空了,共 {steps} 步")

print("--- 历史 ---")
for item in history:
    print(item)
```

<div class="line-notes">

- `MAX_STEPS = 10` Day 19 学的保险:最多跑 10 步,不管发生什么。
- `queue = ["T201", "T202", "T203"]` 待处理的三张工单。
- `history = []` 空的历史清单,只增不减。
- `steps = 0` 步数计数器。
- `while queue and steps < MAX_STEPS:` 两个条件都成立才继续:队列不空(`queue` 当布尔,空列表是 `False`,Day 14)**并且**步数没到上限(Day 17 的 `and`)。队列空了或者步数到了,循环就停。
- `steps += 1` 步数加 1,放在循环体最前面(Day 19 的习惯)。
- `ticket_id = queue.pop(0)` 取走队头并拿到它。第 1 步拿到 `"T201"`,队列剩 `['T202', 'T203']`。
- `history.append(f"处理 {ticket_id}")` 在历史里记一笔。
- `print(f"第 {steps} 步:取出 {ticket_id},队列还剩 {queue}")` 每步打印取出了谁、队列还剩谁。
- `if ticket_id == "T203":` 假设 T203 比较特殊:处理它的时候发现要先查发票。
- `queue.append("T203-查发票")` 往队尾追加一个子任务。
- `history.append("T203 需要先查发票,追加一个子任务")` 历史里记下来。
- `if queue:` 循环结束后看一眼:队列还有东西吗?
- `print(f"到了 {MAX_STEPS} 步上限,队列里还有 {queue}")` 非空,说明是被步数上限截停的,要把剩下的告诉你。**不要悄悄结束**(Day 19 的误区)。
- `else:` 队列是空的。
- `print(f"队列空了,共 {steps} 步")` 正常做完了。
- `print("--- 历史 ---")` 分隔。
- `for item in history:` 遍历历史,按加入的先后。
- `print(item)` 逐条打印。

</div>

```text
$ uv run python part01/agent_queue.py
第 1 步:取出 T201,队列还剩 ['T202', 'T203']
第 2 步:取出 T202,队列还剩 ['T203']
第 3 步:取出 T203,队列还剩 []
第 4 步:取出 T203-查发票,队列还剩 []
队列空了,共 4 步
--- 历史 ---
处理 T201
处理 T202
处理 T203
T203 需要先查发票,追加一个子任务
处理 T203-查发票
```

<div class="line-notes">

- `第 1 步:取出 T201,队列还剩 ['T202', 'T203']` `pop(0)` 拿走队头,后面的前移。
- `第 2 步:取出 T202,队列还剩 ['T203']` 第二个。
- `第 3 步:取出 T203,队列还剩 []` 拿走 T203,此刻队列是空的;但这一步里 `if ticket_id == "T203"` 成立,马上追加了一项。
- `第 4 步:取出 T203-查发票,队列还剩 []` 第 4 步又有东西了,说明第 3 步追加成功。取走之后队列再次是空的,下一轮 `while queue` 不成立。
- `队列空了,共 4 步` 正常结束。
- `处理 T201` 历史的第 1 条。
- `处理 T202` 第 2 条。
- `处理 T203` 第 3 条。
- `T203 需要先查发票,追加一个子任务` 第 4 条,是第 3 步里加的。
- `处理 T203-查发票` 第 5 条,历史比步数多一条,因为第 3 步写了两条。

</div>

把 `MAX_STEPS` 改成 3,看看保险有没有起作用。我用 `sed` 复制了一份 `agent_queue_cap.py`,只改了这一行:

```text
$ uv run python part01/agent_queue_cap.py
第 1 步:取出 T201,队列还剩 ['T202', 'T203']
第 2 步:取出 T202,队列还剩 ['T203']
第 3 步:取出 T203,队列还剩 []
到了 3 步上限,队列里还有 ['T203-查发票']
--- 历史 ---
处理 T201
处理 T202
处理 T203
T203 需要先查发票,追加一个子任务
```

<div class="line-notes">

- `第 1 步`、`第 2 步`、`第 3 步` 前三步和刚才一样。
- `到了 3 步上限,队列里还有 ['T203-查发票']` 第 3 步结束时,`steps` 是 3,条件 `steps < MAX_STEPS` 变成假,`while` 退出。队列里还躺着那个追加的子任务,`if queue:` 为真,所以提示「到了上限」,而不是假装做完了。
- `--- 历史 ---` 历史里只有三个工单加追加子任务的那一条,没有「处理 T203-查发票」,因为根本没轮到它。

</div>

真实的 Agent 循环([Day 166](/blog/agent-zero/day-166-agent-min/) 的 25 行最小版)和这个只差一件事:`pop(0)` 那一行换成「问一次大模型,看它想做什么」。队列、历史、上限三样东西不变。

basedpyright 在 standard 档只对前面标过的两处(`append_none.py` 的 `None`、`list_add.py` 的塞入列表)画了红线,其余零报错。**类型检查器看不出「遍历时删除」**,`remove_in_loop.py` 语法没毛病、类型没毛病,只是结果不对,这类问题只能靠你自己记住规则。

## 动手练习

### 练习 1:工单队列

写 `part01/ex21_1_queue.py`:从 `waiting = ["T301", "T302", "T303", "T304", "T305"]` 开始,依次做五件事,每做完一件打印一次列表:(1) 取走最先来的一张并说出它是谁;(2) `T303` 升级成加急单,把它挪到队头(先删掉再插到下标 0);(3) 新来一张 `T306` 排到队尾;(4) 再来 `T307`、`T308` 两张一起加到队尾;(5) 打印队头、队尾和一共几张。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex21_1_queue.py
waiting = ["T301", "T302", "T303", "T304", "T305"]
print("一开始:", waiting)

first = waiting.pop(0)
print("先处理", first, "剩下", waiting)

waiting.remove("T303")
waiting.insert(0, "T303")
print("T303 升级加急,插到队头:", waiting)

waiting.append("T306")
print("新来一张 T306 排到最后:", waiting)

waiting.extend(["T307", "T308"])
print("再来两张:", waiting, "共", len(waiting), "张")

print("队头是", waiting[0], ",队尾是", waiting[-1])
```

<div class="line-notes">

- `waiting = ["T301", "T302", "T303", "T304", "T305"]` 五张在排队。
- `print("一开始:", waiting)` 先看一眼起点。
- `first = waiting.pop(0)` 取走队头 `T301`,`first` 是它;剩 `T302` 到 `T305`。
- `print("先处理", first, "剩下", waiting)` 打印谁被取走、还剩谁。
- `waiting.remove("T303")` 按值把 `T303` 从队伍里拿掉(它原来在下标 1)。
- `waiting.insert(0, "T303")` 再插回下标 0,变成队头。**先删后插**是因为只插不删会出现两个 `T303`。
- `print("T303 升级加急,插到队头:", waiting)` 现在是 `['T303', 'T302', 'T304', 'T305']`。
- `waiting.append("T306")` 新来的排队尾。
- `print("新来一张 T306 排到最后:", waiting)` 打印。
- `waiting.extend(["T307", "T308"])` 一次来两张,用 `extend` 而不是 `append`(用 `append` 会得到一个嵌套列表)。
- `print("再来两张:", waiting, "共", len(waiting), "张")` 共 7 张。
- `print("队头是", waiting[0], ",队尾是", waiting[-1])` 下标 0 和 -1。

</div>

```text
$ uv run python part01/ex21_1_queue.py
一开始: ['T301', 'T302', 'T303', 'T304', 'T305']
先处理 T301 剩下 ['T302', 'T303', 'T304', 'T305']
T303 升级加急,插到队头: ['T303', 'T302', 'T304', 'T305']
新来一张 T306 排到最后: ['T303', 'T302', 'T304', 'T305', 'T306']
再来两张: ['T303', 'T302', 'T304', 'T305', 'T306', 'T307', 'T308'] 共 7 张
队头是 T303 ,队尾是 T308
```

<div class="line-notes">

- `一开始: ['T301', 'T302', 'T303', 'T304', 'T305']` 五张。
- `先处理 T301 剩下 ['T302', 'T303', 'T304', 'T305']` `pop(0)` 的效果。
- `T303 升级加急,插到队头: ['T303', 'T302', 'T304', 'T305']` `T303` 从第三位到了第一位,其余顺序不变。
- `新来一张 T306 排到最后: ['T303', 'T302', 'T304', 'T305', 'T306']` 末尾多一项。
- `再来两张: ['T303', 'T302', 'T304', 'T305', 'T306', 'T307', 'T308'] 共 7 张` 4 + 1 + 2 = 7。
- `队头是 T303 ,队尾是 T308` `print` 的多个参数之间自动加空格,所以逗号前面有个空格,不影响。

</div>

</details>

### 练习 2:先猜,再跑

不要先运行。下面这段代码,最后四行分别打印什么?先写下你的答案,再运行核对。提示:`b += [4]` 和 `d = d + [6]` 看起来差不多,结果却不一样。

```python
# agent-zero-lab/part01/ex21_2_guess.py
a = [1, 2, 3]
b = a
c = a[:]
d = a

b += [4]
c.append(5)
d = d + [6]

print("a =", a)
print("b =", b)
print("c =", c)
print("d =", d)
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex21_2_guess.py
a = [1, 2, 3, 4]
b = [1, 2, 3, 4]
c = [1, 2, 3, 5]
d = [1, 2, 3, 4, 6]
```

<div class="line-notes">

- `a = [1, 2, 3, 4]` `a` 里有 4,说明有人改了 `a` 指向的那个列表。是谁?`b += [4]`。
- `b = [1, 2, 3, 4]` `b` 和 `a` 是同一个列表,所以一样。
- `c = [1, 2, 3, 5]` `c = a[:]` 是副本,`c.append(5)` 只改副本。`c` 里没有 4,因为拷贝发生在 `b += [4]` 之前。
- `d = [1, 2, 3, 4, 6]` `d` 一开始也指向那个共享列表(此刻已经是 `[1, 2, 3, 4]`),`d + [6]` 造出一个**新列表**再赋给 `d`,`d` 改指新列表,`a` 不受影响,所以 `a` 里没有 6。

</div>

逐行追踪:

1. `a = [1, 2, 3]`:列表 X 建好,`a → X`。
2. `b = a`:`b → X`。
3. `c = a[:]`:切片造了新列表 Y,内容也是 `[1, 2, 3]`,`c → Y`。
4. `d = a`:`d → X`。现在 `a`、`b`、`d` 都指向 X。
5. `b += [4]`:对列表来说,`+=` 是**原地**加(等价于 `extend`),X 变成 `[1, 2, 3, 4]`,`b` 仍指向 X。**`+=` 不会造新列表**,这一点和 `b = b + [4]` 不同。
6. `c.append(5)`:Y 变成 `[1, 2, 3, 5]`。
7. `d = d + [6]`:`d + [6]` 先算出新列表 Z `[1, 2, 3, 4, 6]`,再让 `d → Z`。X 没被改动。

结论:**`+=` 原地改,`x = x + ...` 造新的**。只有一个名字指向它的时候看不出区别,有别名的时候天差地别。

</details>

### 练习 3:找出两个错

下面两段代码各有一个问题,一个会崩,一个不崩但结果是错的。不要先看答案,运行它们,说出病因和改法。

```python
# agent-zero-lab/part01/ex21_3_bug.py
ids = ["T303", "T301", "T302"]
sorted_ids = ids.sort()
for ticket_id in sorted_ids:
    print(ticket_id)
```

```python
# agent-zero-lab/part01/ex21_3_bug_b.py
tickets = ["T301 已解决", "T302 处理中", "T303 已解决", "T304 已解决"]
for t in tickets:
    if "已解决" in t:
        tickets.remove(t)
print(tickets)
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex21_3_bug.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex21_3_bug.py", line 4, in <module>
    for ticket_id in sorted_ids:
                     ^^^^^^^^^^
TypeError: 'NoneType' object is not iterable
$ uv run python part01/ex21_3_bug_b.py
['T302 处理中', 'T304 已解决']
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/ex21_3_bug.py", line 4, in <module>` 第一段崩在第 4 行。
- `for ticket_id in sorted_ids:` 崩的那行,下面的 `^^^^^^^^^^` 指着 `sorted_ids`。
- `TypeError: 'NoneType' object is not iterable` 读法:`None` 不能被 `for` 遍历。病因:`ids.sort()` 返回 `None`,`sorted_ids` 其实是 `None`。编辑器也提前画了红线(`"None" is not iterable`)。
- `['T302 处理中', 'T304 已解决']` 第二段不崩,但**还剩一张「已解决」的 `T304`**。病因和 `remove_in_loop.py` 一样:遍历时删,下标 0 的 `T301` 被删后,`T302` 前移到下标 0,而 `for` 下一步看下标 1,`T302` 被跳过(它本来就该留);下标 1 此刻是 `T303`,被删;`T304` 前移到下标 1,`for` 下一步看下标 2,已经没有了,**`T304` 根本没被检查**。

</div>

改法放在 `part01/ex21_3_fixed.py`:

```python
# agent-zero-lab/part01/ex21_3_fixed.py
ids = ["T303", "T301", "T302"]
ids.sort()
for ticket_id in ids:
    print(ticket_id)

tickets = ["T301 已解决", "T302 处理中", "T303 已解决", "T304 已解决"]
open_tickets = []
for t in tickets:
    if "已解决" not in t:
        open_tickets.append(t)
print(open_tickets)
```

<div class="line-notes">

- `ids = ["T303", "T301", "T302"]` 同样的数据。
- `ids.sort()` 单独一行,不接返回值。
- `for ticket_id in ids:` 遍历排好序的 `ids` 本身。
- `print(ticket_id)` 逐个打印,`T301`、`T302`、`T303`。
- `tickets = ["T301 已解决", "T302 处理中", "T303 已解决", "T304 已解决"]` 第二段的数据。
- `open_tickets = []` 另开一个空列表。
- `for t in tickets:` 遍历原列表,不改它。
- `if "已解决" not in t:` `not in` 是 `in` 的反面(Day 17):描述里没有「已解决」才留。
- `open_tickets.append(t)` 留下的加进新列表。
- `print(open_tickets)` 打印结果。

</div>

```text
$ uv run python part01/ex21_3_fixed.py
T301
T302
T303
['T302 处理中']
```

<div class="line-notes">

- `T301`、`T302`、`T303` 排序后的三个工单号,按字符串顺序。
- `['T302 处理中']` 三张「已解决」都没留下,只剩处理中的。

</div>

</details>

### 练习 4:前三名和中位数

写 `part01/ex21_4_top3.py`。有一批金额(分):`fens = [29900, 0, 46800, 4900, 0, 59800, 29900]`,其中 0 表示这张工单没有金额。要求:(1) 先把 0 去掉,**不能用「遍历时删除」**;(2) 从高到低排序,打印前三名;(3) 算中位数:项数是奇数就取最中间那一项,偶数就取中间两项的平均(整数除法 `//`);(4) 再加一张 50000 分的,重新排序再算一次,看中位数怎么变。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex21_4_top3.py
fens = [29900, 0, 46800, 4900, 0, 59800, 29900]

paid = []
for fen in fens:
    if fen > 0:
        paid.append(fen)

paid.sort(reverse=True)
print("有金额的", len(paid), "张,从高到低:", paid)
print("前三名:", paid[:3])

mid = len(paid) // 2
if len(paid) % 2 == 1:
    median = paid[mid]
else:
    median = (paid[mid - 1] + paid[mid]) // 2
print("中位数:", median, "分,也就是", median // 100, "元")

paid.append(50000)
paid.sort(reverse=True)
mid = len(paid) // 2
if len(paid) % 2 == 1:
    median = paid[mid]
else:
    median = (paid[mid - 1] + paid[mid]) // 2
print("多一张 500 元的,变成", len(paid), "张,中位数:", median, "分")
```

<div class="line-notes">

- `fens = [29900, 0, 46800, 4900, 0, 59800, 29900]` 七项,两个 0,两个 29900。
- `paid = []` 装有金额的。
- `for fen in fens:` 遍历原列表,不改它。
- `if fen > 0:` 大于 0 才留。
- `paid.append(fen)` 加进新列表。五项:`[29900, 46800, 4900, 59800, 29900]`。
- `paid.sort(reverse=True)` 原地倒序,变成 `[59800, 46800, 29900, 29900, 4900]`。
- `print("有金额的", len(paid), "张,从高到低:", paid)` 5 张。
- `print("前三名:", paid[:3])` 切片取前三,`[59800, 46800, 29900]`。
- `mid = len(paid) // 2` 中间位置:5 除以 2 取整是 2。
- `if len(paid) % 2 == 1:` 项数是奇数吗?5 除以 2 余 1,是。
- `median = paid[mid]` 奇数:取下标 2,是 29900。
- `else:` 项数是偶数。
- `median = (paid[mid - 1] + paid[mid]) // 2` 偶数:中间两项是下标 `mid - 1` 和 `mid`,取平均。
- `print("中位数:", median, "分,也就是", median // 100, "元")` 29900 分,299 元。
- `paid.append(50000)` 再加一张 500 元的,6 项。
- `paid.sort(reverse=True)` 重新排:`[59800, 50000, 46800, 29900, 29900, 4900]`。
- `mid = len(paid) // 2` 6 除以 2 是 3。
- `if len(paid) % 2 == 1:` 6 除以 2 余 0,不是奇数,走 `else`。
- `median = paid[mid]` 奇数分支,这次不会执行。
- `else:` 偶数分支。
- `median = (paid[mid - 1] + paid[mid]) // 2` `paid[2]` 是 46800,`paid[3]` 是 29900,和是 76700,整除 2 得 38350。
- `print("多一张 500 元的,变成", len(paid), "张,中位数:", median, "分")` 38350 分。

</div>

```text
$ uv run python part01/ex21_4_top3.py
有金额的 5 张,从高到低: [59800, 46800, 29900, 29900, 4900]
前三名: [59800, 46800, 29900]
中位数: 29900 分,也就是 299 元
多一张 500 元的,变成 6 张,中位数: 38350 分
```

<div class="line-notes">

- `有金额的 5 张,从高到低: [59800, 46800, 29900, 29900, 4900]` 两个 0 被去掉。
- `前三名: [59800, 46800, 29900]` 注意第三名是 29900,第四名也是 29900(并列),切片只取前三项。
- `中位数: 29900 分,也就是 299 元` 5 项取下标 2。
- `多一张 500 元的,变成 6 张,中位数: 38350 分` 偶数项,取下标 2 和 3 的平均。中位数比平均数更不怕极端值,这就是为什么统计「客单价」常用它。

</div>

中位数那段 `if`/`else` 我写了两遍,很啰嗦。等 [Day 28](/blog/agent-zero/day-028-functions-1/) 学了函数,会把它包成一个 `median(values)`,写一次用两次。

</details>

**验收标准**:`ticket_amounts.py` 能默写出来,排序结果与文中一致;能说出 `sort()` 和 `sorted()` 的区别、`b = a` 和 `b = a.copy()` 的区别;练习 2 能逐行说出每个名字指向哪个列表;4 道练习都做对,Ruff 通过。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 列表(list) | 用方括号写的、有顺序、能增删改的一串东西,相当于 JS 的 Array,例如 `["T001", "T002"]` |
| 元素 / 项(item) | 列表里的每一个东西。`ids[0]` 就是第 0 项 |
| 下标(index) | 项的编号,从 0 开始,`-1` 是最后一个(Day 15 讲过) |
| 可变(mutable) | 建好之后还能原地修改。列表可变,字符串不可变 |
| 原地修改(in place) | 直接改原来的那个列表,不产生新的。`append`、`sort`、`remove` 都是,它们返回 `None` |
| 别名(alias) | 同一个列表的第二个名字。`b = a` 之后 `a`、`b` 是别名 |
| `.copy()` | 造一份内容相同的新列表,只复制最外一层 |
| `is` | 问两个名字是不是指向同一个对象;`==` 问内容是否一样 |
| `append` / `extend` | 在末尾加一项 / 加一批。`append` 加列表会得到嵌套列表 |
| `insert(位置, 值)` | 插到指定下标,后面的项后移 |
| `pop` | 按位置拿走一项并返回它,不写位置就是最后一项 |
| `remove` | 按值删掉第一个匹配项,找不到报 `ValueError` |
| `sort()` / `sorted()` | 前者原地排序、返回 `None`;后者返回新的排好序的列表 |
| `reverse=True` | 排序的倒序参数,必须写成关键字参数 |
| `key=` | 排序的「按什么比」参数,例如 `key=len` 按长度比;传的是函数本身,不加括号 |
| 稳定排序(stable sort) | 比较结果相同的两项,排完后保持原来的先后顺序 |
| 队列(queue) | 先来先处理的清单,用 `append` 加、`pop(0)` 取 |
| `IndexError` | 下标超出范围,或者从空列表 `pop` |

## 常见误区

**以为 `append` 返回新列表。** 写成 `ids = ids.append(x)`,`ids` 变成 `None`,下一次用它就是 `'NoneType' object has no attribute ...`。所有原地修改列表的方法都返回 `None`,不要接。

**写 `x = x.sort()`。** 同上,`x` 变成 `None`。要么直接 `x.sort()`,要么 `x = sorted(x)`。

**以为 `b = a` 是复制。** 它只是多一个名字。要拷贝用 `a.copy()` 或 `a[:]`;而且这只拷最外层,里面套着的列表还是共享的(Day 26 再讲)。

**遍历时删除同一个列表。** 不报错,只是悄悄跳过一些项。另开一个新列表装要留的,或者遍历副本。

**用 `remove` 和 `index` 之前不检查有没有。** JS 的 `indexOf` 找不到给 `-1`,Python 的 `index` 和 `remove` 会崩。先 `in` 一下。

**把 `+=` 当成 `+`。** `b += [4]` 是原地加,有别名时会连带改了别人;`b = b + [4]` 才会造新列表。

**对一个混着字符串和数字的列表排序。** `TypeError: '<' not supported between instances of 'str' and 'int'`。排之前统一类型;从文本读来的数字尤其要先 `int()`。

**以为中文排序是按拼音。** 默认按 Unicode 码点,「功能」「登录」「计费」排成这个顺序纯属巧合。要按拼音排得借助第三方库,课里用不到。

**拿 `pop(0)` 当万能的队列。** 几十几百项没问题;上百万项时每次取队头都要把后面的全部前移,很慢。那时用标准库的 `collections.deque`,课程后面用到再讲。

## 学习资料

### 文档与文章

- [Python 教程 · 数据结构(列表)](https://docs.python.org/zh-cn/3.12/tutorial/datastructures.html):中文,官方教程第 5 章,「列表的更多特性」里 `append`、`extend`、`insert`、`remove`、`pop`、`index`、`count`、`sort`、`reverse`、`copy` 一个个列了方法和例子;后面的列表推导式后天要用。
- [Python 标准库 · 序列类型 list](https://docs.python.org/zh-cn/3.12/library/stdtypes.html#list):中文,列表的正式参考,每个方法的精确行为都在这里。
- [Python 排序指南(Sorting HOWTO)](https://docs.python.org/zh-cn/3.12/howto/sorting.html):中文,官方写的排序专题,`sort` 和 `sorted` 的区别、`key` 函数、稳定性都有,今天读前面两三节就够。
- [Python 设计和历史 FAQ · 为什么 list.sort() 不返回排序后的列表](https://docs.python.org/zh-cn/3.12/faq/design.html):中文,页面里有一条专门解释 `sort` 为什么返回 `None`:为了提醒你它是原地改的。
- [MDN · Array](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Array)、[Array.prototype.sort](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Array/sort):中文,JS 一侧对照,看 `sort` 默认按字符串排的说明。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1NX4y1K75G&autoplay=0&high_quality=1" title="Python基础语法：列表" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>周周学Python · Python基础语法:列表 · 25 分钟,从建列表、下标切片到增删改查的常用方法,速度偏快,看完再回来敲今天的脚本。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1sh4y1b7JB&autoplay=0&high_quality=1" title="sort和sorted的区别" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Python很简单 · sort和sorted的区别 · 5 分钟,专讲「原地改还是返回新列表」,对应今天的排序一节。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1xp4y1x7Wm&autoplay=0&high_quality=1" title="Python基础语法：可变类型数据与不可变类型数据" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>周周学Python · 可变类型数据与不可变类型数据 · 10 分钟,讲列表为什么「可变」、字符串和元组为什么不能改,对应 `b = a` 那一节;元组明天会学。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/W8KRzm-HUcc" title="Python Tutorial for Beginners 4: Lists, Tuples, and Sets" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial for Beginners 4: Lists, Tuples, and Sets · 英文,今天看前半(列表),后半的元组明天、集合 Day 25 再看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/D3JvDWO-BY4" title="Python Tutorial: Sorting Lists, Tuples, and Objects" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial: Sorting Lists, Tuples, and Objects · 英文,`sort`/`sorted`、`reverse`、`key` 讲得很清楚;后半的 `lambda` 等函数学完再回来看。</figcaption>
</figure>

### 书籍

- Eric Matthes《Python Crash Course》第 3 版,No Starch Press,2023(中译《Python编程:从入门到实践》)。第 3 章「Introducing Lists」和第 4 章「Working with Lists」,增删改、`sort`/`sorted`、`copy` 和「不要在遍历时改列表」都有。
- Al Sweigart《Automate the Boring Stuff with Python》第 2 版,No Starch Press,2019(中译《Python编程快速上手:让繁琐工作自动化》),[第 4 章 Lists](https://automatetheboringstuff.com/2e/chapter4/) 在作者网站免费读,用「猫的名字」的例子讲列表,口语化,还有「引用」一节专讲 `b = a`。
- Allen B. Downey《Think Python》第 3 版,O'Reilly,2024,[第 9 章 Lists](https://allendowney.github.io/ThinkPython/chap09.html) 免费在线读,列表的运算、切片、方法,以及「别名」和「列表作为参数」。

### 开源项目与代码

- [Asabeneh/30-Days-Of-Python · Day 5 Lists](https://github.com/Asabeneh/30-Days-Of-Python/tree/master/05_Day_Lists):英文,每个方法一两行例子,后面有一批练习。
- [jackfrued/Python-100-Days · 08.常用数据结构之列表-1](https://github.com/jackfrued/Python-100-Days/blob/master/Day01-20/08.常用数据结构之列表-1.md):中文,列表的创建、运算、元素访问和增删;[列表-2](https://github.com/jackfrued/Python-100-Days/blob/master/Day01-20/09.常用数据结构之列表-2.md) 讲排序和生成式,今天读第一篇就够。

## 自测

1. 下面这段代码最后会得到什么?哪里不对?

```python
ids = ["T003", "T001", "T002"]
ids = ids.sort()
print(ids)
```

<details><summary>答案</summary>

打印 `None`。`sort()` 原地排序并返回 `None`,再把它赋给 `ids`,列表就丢了。改成单独一行 `ids.sort()`,或者 `ids = sorted(ids)`。

</details>

2. `a = [1, 2]`、`b = a`、`b.append(3)`,这时 `a` 是什么?怎样让 `b` 成为独立的副本?

<details><summary>答案</summary>

`a` 也是 `[1, 2, 3]`,因为 `b` 和 `a` 是同一个列表的两个名字。用 `b = a.copy()` 或 `b = a[:]`,得到内容相同但互不影响的新列表。

</details>

3. `ids.append(["T007", "T008"])` 和 `ids.extend(["T007", "T008"])` 有什么区别?`len` 各增加多少?

<details><summary>答案</summary>

`append` 把整个列表当作一项放进去,`len` 增加 1,得到嵌套列表;`extend` 把里面的两项一项一项接到末尾,`len` 增加 2。

</details>

4. `sorted(["10", "9", "100", "1"])` 的结果是什么?为什么?怎样才能得到 `[1, 9, 10, 100]`?

<details><summary>答案</summary>

`['1', '10', '100', '9']`,字符串逐字符比较,`"9"` 的第一个字符比 `"1"` 大,所以排最后。先把每项转成整数 `int(t)` 再排序。

</details>

5. **面试题**:`list.sort()` 和 `sorted()` 有什么区别?什么叫排序是稳定的,稳定有什么用?

<details><summary>答案</summary>

`sort()` 是列表的方法,原地修改并返回 `None`;`sorted()` 是内置函数,接受任何可遍历的东西,返回新列表,原来的不变。稳定排序指比较结果相同的两项排序后保持原来的先后顺序。它让你可以「先按次要条件排,再按主要条件排」,主要条件并列的项仍保持次要条件的顺序。Python 的排序是稳定的。

</details>

6. 下面循环想删掉所有 `0`,结果对吗?为什么?

```python
amounts = [0, 0, 5]
for a in amounts:
    if a == 0:
        amounts.remove(a)
```

<details><summary>答案</summary>

不对,会剩下一个 `0`:`[0, 5]`。删第一个 0 后列表前移,`for` 的下一个位置正好跳过了第二个 0。要么另开新列表只放不是 0 的,要么遍历 `amounts.copy()`。

</details>

## 明天预告

Day 22 · 元组和解包。今天排序用的 `[金额, 工单号]` 这种「两项配一对」的小列表,其实有一个更合适的类型:元组(tuple)。它用圆括号写,建好就不能改,专门装「位置固定、各有各的意思」的几项。明天还会学一个让你省很多代码的写法:`ticket_id, human, customer, desc = line.split(maxsplit=3)`,一行把列表拆成四个名字,相当于 JS 的解构赋值。你其实每天都在用它:`for no, line in enumerate(...)` 里的逗号,就是解包。
