---
title: 'Day 18 · for 循环和 range'
description: 'Python 只有一种 for:`for x in 一批东西`,对应 JS 的 for...of 而不是 for...in;用 range 生成数字、用累加器算月付和年付哪个划算、用 enumerate 同时拿编号和内容,最后把 10 张工单一口气分完,亲眼看到规则在没见过的第 10 张上翻车。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 18
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 17](/blog/agent-zero/day-017-if-else/) 学了 `if`、`elif`、`else` 和 `and`、`or`、`not`,用关键词给工单分了类:`classify.py` 在 Day 5 的 9 张工单上对了 6 张,我看着答案补了几个词,`classify2.py` 变成 9/9,同时提醒你这叫过拟合,拿一张没见过的工单它不一定对。

可是那 9 张的成绩是怎么得出来的?我在终端里用 shell 循环一张一张喂输入,再自己数对错。每分一张工单就要敲一次 `uv run python part01/classify2.py`,这不是程序该有的样子。今天学 Python 的 `for`:把同一段代码对一批东西各跑一遍。学完,10 张工单一次分完,自己算对了几张。

## 今天要解决的问题

学完今天,你应该能:

1. 写出 `for 变量 in 一批东西:`,说清它对应 JS 的 `for...of` 而不是 `for...in`;知道缩进的那几行每一轮都会跑一遍,变量每一轮被重新贴上下一个值。
2. 用 `range` 生成数字:说出 `range(5)`、`range(1, 6)`、`range(0, 10, 3)`、`range(5, 0, -1)` 各得到什么,知道终点不包含。
3. 用「累加器」(循环外先设 0,循环里 `+=`)算总数;用 `enumerate` 同时拿到编号和内容;知道循环变量在循环结束后还活着,而一次都没跑的循环会留下一个没定义的变量。
4. 写出 `part01/batch_classify.py`:10 张工单一次分完,打印每张的对错和总成绩,并解释为什么第 10 张错了。

预计用时:2.5 小时。for 和 range 60 分钟,enumerate 和嵌套 30 分钟,拼起来 40 分钟,剩下做练习。

前置:[Day 12](/blog/agent-zero/day-012-numbers/)(变量、`+=`)、[Day 14](/blog/agent-zero/day-014-bool-none/)(`None`、`is None`)、[Day 15](/blog/agent-zero/day-015-strings-1/)(索引、切片、f-string 对齐)、[Day 16](/blog/agent-zero/day-016-strings-2/)(`split`)、[Day 17](/blog/agent-zero/day-017-if-else/)(`if`/`elif`、`classify2.py` 的规则)。今天不调任何 API,花费 0 元。

学法提示:先对照文章逐行敲一遍(代码自己敲,不复制粘贴)并跑通;第二天合上文章,把 `batch_classify.py` 默写出来并跑通;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚我是在哪跑的

输出是我 2026-10-23 在 2019 款 Intel MacBook Pro(macOS 14、zsh)上用演示家目录真跑的,家目录显示成 `/Users/你`,`~/agent-zero-lab` 接着 Day 17 的状态,`uv run python` 是 3.12.13,Ruff 是 0.17.2,编辑器里的 basedpyright 是 1.40.2。今天的脚本都放在 `part01/`,在仓库根目录用 `uv run python part01/文件名.py` 运行。今天的脚本基本不读键盘输入,输出就是你终端里看到的样子。

## for:让同一段代码跑一批

### 先看 JS 的 for 有几种

你在 JS 里写循环,大概是这四种之一。我把它们放在一起跑一遍:

```text
$ node -e '
const customers = ["C023", "C007", "C015"];
for (let i = 0; i < customers.length; i++) console.log("下标写法", i, customers[i]);
for (const c of customers) console.log("for...of", c);
for (const k in customers) console.log("for...in", k, typeof k);
customers.forEach((c, i) => console.log("forEach", i, c));
'
下标写法 0 C023
下标写法 1 C007
下标写法 2 C015
for...of C023
for...of C007
for...of C015
for...in 0 string
for...in 1 string
for...in 2 string
forEach 0 C023
forEach 1 C007
forEach 2 C015
```

<div class="line-notes">

- `const customers = ["C023", "C007", "C015"];` 一个数组,三个客户号。
- `for (let i = 0; i < customers.length; i++)` 经典的三段式:声明下标、判断条件、下标加一。要自己管 `i`。
- `for (const c of customers)` `for...of`:一个一个拿出元素,不要下标。
- `for (const k in customers)` `for...in`:拿出来的是**键**。数组的键是字符串 `"0"`、`"1"`、`"2"`,不是元素。
- `customers.forEach((c, i) =>` 回调写法,元素和下标都给你。
- `下标写法 0 C023` 第一种写法的输出,下标加元素。
- `for...of C023` 第二种拿到元素本身。
- `for...in 0 string` 第三种拿到的是 `"0"`,`typeof` 是 `string`。JS 老手都踩过这个坑。
- `forEach 0 C023` 第四种和第一种结果一样。

</div>

Python **只有一种** `for`,写法是 `for 变量 in 一批东西:`,行为等同于 JS 的 `for...of`:一个一个拿出元素,不管下标。下面的对照要背熟,尤其是最后一行:

| 想做的事 | JS | Python |
| --- | --- | --- |
| 一个一个拿元素 | `for (const c of customers) { }` | `for c in customers:` |
| 要下标 | `for (let i = 0; i < n; i++) { }` | `for i in range(n):`(见后文) |
| 元素和下标都要 | `customers.forEach((c, i) => { })` | `for i, c in enumerate(customers):` |
| 循环体的边界 | 花括号 | 冒号加缩进(Day 17) |
| 关键字 `in` 的意思 | `for...in` 拿**键**,`for...of` 拿**值** | `in` 拿**值**,没有 `of` |

所以 JS 的 `for...in` 和 Python 的 `in` 长得一样,行为相反。第一次写 Python 循环时,脑子里把 `in` 读成 JS 的 `of`。

### 最小的 for

新建 `part01/for_basic.py`:

```python
# agent-zero-lab/part01/for_basic.py
customers = ["C023", "C007", "C015"]

for c in customers:
    print("正在处理客户", c)
print("循环结束")
```

<div class="line-notes">

- `customers = ["C023", "C007", "C015"]` 方括号括起来的一串东西叫列表(list),相当于 JS 的数组,[Day 21](/blog/agent-zero/day-021-lists/) 才细讲。今天只需要把它当成「一批东西」,用 `for` 一个一个取。
- `for c in customers:` 读法:对 `customers` 里的每一个东西,依次把它叫作 `c`,然后执行下面缩进的代码。末尾的冒号和下一行的缩进和 Day 17 的 `if` 一模一样。
- `print("正在处理客户", c)` 缩进了 4 格,属于循环体。第一轮 `c` 是 `"C023"`,第二轮 `"C007"`,第三轮 `"C015"`,所以这行跑三遍。
- `print("循环结束")` 回到最左边,不属于循环体。三轮都跑完才执行一次。

</div>

```text
$ cd ~/agent-zero-lab
$ uv run python part01/for_basic.py
正在处理客户 C023
正在处理客户 C007
正在处理客户 C015
循环结束
```

<div class="line-notes">

- `$ uv run python part01/for_basic.py` 在仓库根目录运行。
- `正在处理客户 C023` 第 1 轮,`c` 被贴上 `"C023"`。
- `正在处理客户 C007` 第 2 轮,同一个名字 `c` 换贴了 `"C007"`。
- `正在处理客户 C015` 第 3 轮。
- `循环结束` 列表里没有下一个了,循环退出,继续往下执行缩进之外的那一行。

</div>

这个过程画出来是下面这样。注意变量 `c` 只有一个,每一轮是被**重新贴上**下一个值,就像 Day 12 说的变量是标签:

<figure>
<svg viewBox="0 0 640 262" role="img" aria-label="for_basic.py 的执行过程:第 1 轮 c 指向 C023 并打印,第 2 轮 c 指向 C007 并打印,第 3 轮 c 指向 C015 并打印,第 4 次想取下一个时列表已空,循环结束,执行 print 循环结束">
<rect x="0" y="0" width="640" height="262" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="90" y="26" fill="var(--ink-faint)">customers</text>
<text x="335" y="26" fill="var(--ink-faint)">变量 c</text>
<text x="490" y="26" fill="var(--ink-faint)">屏幕上多一行</text>
<text x="20" y="62" fill="var(--ink-soft)">第 1 轮</text>
<rect x="90" y="40" width="52" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="150" y="40" width="52" height="30" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
<rect x="210" y="40" width="52" height="30" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
<text x="98" y="60" fill="var(--ink)">C023</text>
<text x="158" y="60" fill="var(--ink-faint)">C007</text>
<text x="218" y="60" fill="var(--ink-faint)">C015</text>
<line x1="275" y1="55" x2="325" y2="55" stroke="var(--ink-soft)"/>
<polygon points="325,50 333,55 325,60" fill="var(--ink-soft)"/>
<rect x="335" y="40" width="110" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="345" y="60" fill="var(--ink)">c = "C023"</text>
<line x1="450" y1="55" x2="480" y2="55" stroke="var(--ink-soft)"/>
<polygon points="480,50 488,55 480,60" fill="var(--ink-soft)"/>
<text x="492" y="60" fill="var(--ink)">正在处理客户 C023</text>
<text x="20" y="122" fill="var(--ink-soft)">第 2 轮</text>
<rect x="90" y="100" width="52" height="30" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
<rect x="150" y="100" width="52" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="210" y="100" width="52" height="30" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
<text x="98" y="120" fill="var(--ink-faint)">C023</text>
<text x="158" y="120" fill="var(--ink)">C007</text>
<text x="218" y="120" fill="var(--ink-faint)">C015</text>
<line x1="275" y1="115" x2="325" y2="115" stroke="var(--ink-soft)"/>
<polygon points="325,110 333,115 325,120" fill="var(--ink-soft)"/>
<rect x="335" y="100" width="110" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="345" y="120" fill="var(--ink)">c = "C007"</text>
<line x1="450" y1="115" x2="480" y2="115" stroke="var(--ink-soft)"/>
<polygon points="480,110 488,115 480,120" fill="var(--ink-soft)"/>
<text x="492" y="120" fill="var(--ink)">正在处理客户 C007</text>
<text x="20" y="182" fill="var(--ink-soft)">第 3 轮</text>
<rect x="90" y="160" width="52" height="30" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
<rect x="150" y="160" width="52" height="30" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
<rect x="210" y="160" width="52" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="98" y="180" fill="var(--ink-faint)">C023</text>
<text x="158" y="180" fill="var(--ink-faint)">C007</text>
<text x="218" y="180" fill="var(--ink)">C015</text>
<line x1="275" y1="175" x2="325" y2="175" stroke="var(--ink-soft)"/>
<polygon points="325,170 333,175 325,180" fill="var(--ink-soft)"/>
<rect x="335" y="160" width="110" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="345" y="180" fill="var(--ink)">c = "C015"</text>
<line x1="450" y1="175" x2="480" y2="175" stroke="var(--ink-soft)"/>
<polygon points="480,170 488,175 480,180" fill="var(--ink-soft)"/>
<text x="492" y="180" fill="var(--ink)">正在处理客户 C015</text>
<line x1="20" y1="212" x2="620" y2="212" stroke="var(--rule)"/>
<text x="20" y="236" fill="var(--ink)">第 4 次想取下一个:列表空了 → 退出循环 → 执行 print("循环结束")</text>
<text x="20" y="254" fill="var(--ink-faint)">c 最后停在 "C015",没有被删掉</text>
</g>
</svg>
<figcaption>for_basic.py 的三轮:蓝色格子是这一轮取出的元素,琥珀色的 c 每轮被重新贴上它。</figcaption>
</figure>

### 字符串也是「一批东西」

`for` 后面的「一批东西」不只是列表。字符串就是一串字符,`for` 一次拿出一个字符。新建 `part01/for_chars.py`,统计工单号加客户号里有几个数字字符:

```python
# agent-zero-lab/part01/for_chars.py
ticket_id = "T001"

for ch in ticket_id:
    print(repr(ch), ch.isdigit())

digits = 0
for ch in "T001 计费 C023":
    if ch.isdigit():
        digits += 1
print("数字字符一共", digits, "个")
```

<div class="line-notes">

- `ticket_id = "T001"` 工单号,四个字符。
- `for ch in ticket_id:` 一次拿一个字符。第一轮 `ch` 是 `"T"`,第二轮 `"0"`,第三轮 `"0"`,第四轮 `"1"`。
- `print(repr(ch), ch.isdigit())` `repr()` 把值连引号一起打印,看得出这是个字符串而不是数字。`isdigit()` 是 Day 17 的字符串方法,问「是不是数字字符」。
- `digits = 0` **循环开始之前**先把计数器设成 0。下面会解释为什么必须放在外面。
- `for ch in "T001 计费 C023":` 直接对一个字符串字面量循环,共 12 个字符(含两个空格和两个汉字)。
- `if ch.isdigit():` 每个字符都问一遍,是数字就进分支。
- `digits += 1` 是数字就加 1。`+=` 是 Day 12 学的「在原来的值上加」。
- `print("数字字符一共", digits, "个")` 回到最左边,循环全部结束后才打印一次。

</div>

```text
$ uv run python part01/for_chars.py
'T' False
'0' True
'0' True
'1' True
数字字符一共 6 个
```

<div class="line-notes">

- `'T' False` `T` 不是数字字符。
- `'0' True` 第 2 个字符,是数字。
- `'0' True` 第 3 个字符。
- `'1' True` 第 4 个字符。
- `数字字符一共 6 个` `"T001 计费 C023"` 里的字符依次是 T、0、0、1、空格、计、费、空格、C、0、2、3,数字有 0、0、1、0、2、3 共 6 个。汉字和空格的 `isdigit()` 都是 `False`。

</div>

`digits` 在整个过程中的变化是:0 → 1 → 2 → 3 → 4 → 5 → 6。这是后面会反复用到的「累加器」写法:循环外设初值,循环里累加,循环后读结果。

### 缩进少了会怎样

和 Day 17 的 `if` 一样,`for` 后面的代码如果没缩进,Python 一行都不会跑。新建 `part01/for_indent_error.py`(故意写错):

```python
# agent-zero-lab/part01/for_indent_error.py
for c in ["C023", "C007"]:
print("正在处理客户", c)
```

<div class="line-notes">

- `for c in ["C023", "C007"]:` 这里直接把列表写在 `in` 后面,不用先起名字。
- `print("正在处理客户", c)` 这一行忘了缩进。

</div>

```text
$ uv run python part01/for_indent_error.py
  File "/Users/你/agent-zero-lab/part01/for_indent_error.py", line 3
    print("正在处理客户", c)
    ^^^^^
IndentationError: expected an indented block after 'for' statement on line 2
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/for_indent_error.py", line 3` 出错的是第 3 行,就是那行没缩进的 `print`。
- `^^^^^` 指示条标出 `print`,它本该在 `for` 下面缩进 4 格。
- `IndentationError: expected an indented block after 'for' statement on line 2` 读法:第 2 行的 `for` 后面应该有一个缩进的块。记得 Day 17 的 `after 'if' statement` 吗?只是把 `if` 换成了 `for`。

</div>

## range:生成一串数字

### range 是一张配方

很多时候你要的「一批东西」不是现成的,而是「1 到 10」「重复 5 次」这种数字。JS 里要写三段式,或者拼 `Array.from`:

```text
$ node -e '
console.log(Array.from({ length: 5 }, (_, i) => i));
console.log(Array.from({ length: 5 }, (_, i) => i + 1));
console.log([...Array(5).keys()]);
'
[ 0, 1, 2, 3, 4 ]
[ 1, 2, 3, 4, 5 ]
[ 0, 1, 2, 3, 4 ]
```

<div class="line-notes">

- `Array.from({ length: 5 }, (_, i) => i)` 造一个长度 5 的数组,每个位置用回调算出值。JS 没有内置的 range,要这样绕一下。
- `(_, i) => i + 1` 想从 1 开始,要自己加 1。
- `[...Array(5).keys()]` 另一种常见的拼法。
- `[ 0, 1, 2, 3, 4 ]` 前三个的结果。
- `[ 1, 2, 3, 4, 5 ]` 从 1 开始的。
- `[ 0, 1, 2, 3, 4 ]` 第三种拼法,结果和第一种一样。

</div>

Python 有一个内置函数 `range`,专门干这个。新建 `part01/range_demo.py`:

```python
# agent-zero-lab/part01/range_demo.py
print(range(5))
print(list(range(5)))
print(list(range(1, 6)))
print(list(range(0, 10, 3)))
print(list(range(5, 0, -1)))
print(list(range(3, 3)))
print(len(range(1, 13)))
print(10 in range(1, 13), 13 in range(1, 13))
```

<div class="line-notes">

- `print(range(5))` 先看 `range(5)` 本身是什么。
- `print(list(range(5)))` `list()` 把它「展开」成真的列表。`list()` 是 Day 21 的内容,这里当作「把配方做成实物」。
- `print(list(range(1, 6)))` 两个参数:起点 1、终点 6。
- `print(list(range(0, 10, 3)))` 三个参数:起点 0、终点 10、步长 3。
- `print(list(range(5, 0, -1)))` 步长是负数,从大往小数。
- `print(list(range(3, 3)))` 起点等于终点。
- `print(len(range(1, 13)))` 对 `range` 也能用 `len`。
- `print(10 in range(1, 13), 13 in range(1, 13))` `in` 判断某个数在不在里面。

</div>

```text
$ uv run python part01/range_demo.py
range(0, 5)
[0, 1, 2, 3, 4]
[1, 2, 3, 4, 5]
[0, 3, 6, 9]
[5, 4, 3, 2, 1]
[]
12
True False
```

<div class="line-notes">

- `range(0, 5)` `print(range(5))` 打印出来不是一串数字,而是 `range(0, 5)`:起点 0、终点 5。`range` 是一张「配方」,只记着起点终点步长,不会提前把所有数字造出来。
- `[0, 1, 2, 3, 4]` 展开后是 5 个数,从 0 开始,**不含 5**。
- `[1, 2, 3, 4, 5]` `range(1, 6)` 得 1 到 5,不含 6。想要「1 到 5」,终点写 6。
- `[0, 3, 6, 9]` 步长 3:0、3、6、9,下一个是 12,超过了终点 10,停。
- `[5, 4, 3, 2, 1]` 倒着数,终点 0 不含。
- `[]` 起点等于终点,一个数都没有,是空的。
- `12` `range(1, 13)` 从 1 到 12,共 12 个。
- `True False` 10 在 1 到 12 里,13 不在。

</div>

三条规则记住就够用:

- **起点包含,终点不包含。** 和 Day 15 的切片 `s[0:4]` 是同一个规则,都是「左闭右开」。好处是 `range(a, b)` 的个数恰好是 `b - a`:`range(1, 13)` 就是 12 个。
- 只写一个参数时,它是终点,起点默认 0:`range(5)` 等于 `range(0, 5)`。
- 第三个参数是步长,默认 1,可以是负数。

下面这张图把 `range(1, 6)` 和 `range(0, 10, 3)` 放在数轴上。实心圆是会被取出来的,空心圆是终点,取不到:

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="数轴上 0 到 10:range(1, 6) 取出 1 2 3 4 5,6 是空心圆不取;range(0, 10, 3) 取出 0 3 6 9,10 是空心圆不取">
<rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="40" y="34" fill="var(--ink)">range(1, 6)</text>
<line x1="40" y1="62" x2="600" y2="62" stroke="var(--rule)"/>
<circle cx="96" cy="62" r="9" fill="var(--mem)"/>
<circle cx="152" cy="62" r="9" fill="var(--mem)"/>
<circle cx="208" cy="62" r="9" fill="var(--mem)"/>
<circle cx="264" cy="62" r="9" fill="var(--mem)"/>
<circle cx="320" cy="62" r="9" fill="var(--mem)"/>
<circle cx="376" cy="62" r="9" fill="var(--paper)" stroke="var(--ink-soft)" stroke-dasharray="3 2"/>
<text x="396" y="66" fill="var(--ink-soft)">6 是终点,取不到</text>
<text x="40" y="104" fill="var(--ink)">range(0, 10, 3)</text>
<line x1="40" y1="132" x2="600" y2="132" stroke="var(--rule)"/>
<circle cx="40" cy="132" r="9" fill="var(--compute)"/>
<circle cx="208" cy="132" r="9" fill="var(--compute)"/>
<circle cx="376" cy="132" r="9" fill="var(--compute)"/>
<circle cx="544" cy="132" r="9" fill="var(--compute)"/>
<circle cx="600" cy="132" r="9" fill="var(--paper)" stroke="var(--ink-soft)" stroke-dasharray="3 2"/>
<text x="396" y="104" fill="var(--ink-soft)">每次加 3:0 3 6 9,下一个 12 越界</text>
<text x="36" y="168" fill="var(--ink-faint)">0</text>
<text x="92" y="168" fill="var(--ink-faint)">1</text>
<text x="148" y="168" fill="var(--ink-faint)">2</text>
<text x="204" y="168" fill="var(--ink-faint)">3</text>
<text x="260" y="168" fill="var(--ink-faint)">4</text>
<text x="316" y="168" fill="var(--ink-faint)">5</text>
<text x="372" y="168" fill="var(--ink-faint)">6</text>
<text x="428" y="168" fill="var(--ink-faint)">7</text>
<text x="484" y="168" fill="var(--ink-faint)">8</text>
<text x="540" y="168" fill="var(--ink-faint)">9</text>
<text x="590" y="168" fill="var(--ink-faint)">10</text>
<text x="40" y="196" fill="var(--ink-faint)">起点包含,终点不包含,和 Day 15 的切片是同一条规则</text>
</g>
</svg>
<figcaption>两个 range 在数轴上的样子。实心圆会被取出来,虚线空心圆是终点,取不到。</figcaption>
</figure>

### range 只收整数

`range` 的参数必须是整数。新建 `part01/range_float.py`,故意传一个小数:

```python
# agent-zero-lab/part01/range_float.py
for i in range(2.5):
    print(i)
```

<div class="line-notes">

- `for i in range(2.5):` 2.5 不是整数。「重复两次半」没有意义,Python 直接拒绝。

</div>

```text
$ uv run python part01/range_float.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/range_float.py", line 2, in <module>
    for i in range(2.5):
             ^^^^^^^^^^
TypeError: 'float' object cannot be interpreted as an integer
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/range_float.py", line 2, in <module>` 出错在第 2 行。
- `^^^^^^^^^^` 指示条标出整个 `range(2.5)`。
- `TypeError: 'float' object cannot be interpreted as an integer` 读法:浮点数不能当整数用。这个错在实战里常见的来源是 `range(total / 2)`:`/` 总是得到小数(Day 12),要用 `//`。编辑器里的 basedpyright 也会在这一行给红线(`reportArgumentType`),不用等运行。

</div>

### 用 range 重复做一件事

新建 `part01/range_loop.py`。客户被重复扣款,扣 1 到 5 次,各多扣了多少钱(每次 299 元):

```python
# agent-zero-lab/part01/range_loop.py
price = 299

for times in range(1, 6):
    extra = price * (times - 1)
    print(f"被扣 {times} 次,多扣了 {extra} 元")
```

<div class="line-notes">

- `price = 299` 每次扣 299 元。
- `for times in range(1, 6):` `times` 依次是 1、2、3、4、5。终点写 6,因为终点取不到。
- `extra = price * (times - 1)` 扣了 `times` 次,其中第一次是正常的,多扣的是 `times - 1` 次。第 3 轮:`299 * (3 - 1)` 是 598。
- `print(f"被扣 {times} 次,多扣了 {extra} 元")` f-string 把两个变量填进去。

</div>

```text
$ uv run python part01/range_loop.py
被扣 1 次,多扣了 0 元
被扣 2 次,多扣了 299 元
被扣 3 次,多扣了 598 元
被扣 4 次,多扣了 897 元
被扣 5 次,多扣了 1196 元
```

<div class="line-notes">

- `被扣 1 次,多扣了 0 元` 第 1 轮 `times = 1`,`299 * 0` 是 0。
- `被扣 2 次,多扣了 299 元` 第 2 轮 `299 * 1`。
- `被扣 3 次,多扣了 598 元` 第 3 轮 `299 * 2`。
- `被扣 4 次,多扣了 897 元` 第 4 轮 `299 * 3`。
- `被扣 5 次,多扣了 1196 元` 第 5 轮 `299 * 4`,`range(1, 6)` 到这里取完,没有第 6 轮。

</div>

### 累加器:循环外设 0,循环里 +=

前面 `for_chars.py` 里的 `digits` 就是累加器。再写一个更像业务的:云簿 CloudLedger 月付 49 元、年付 468 元(Day 12 的数字),一直月付到第几个月起会比年付贵?新建 `part01/sum_loop.py`:

```python
# agent-zero-lab/part01/sum_loop.py
monthly_fen = 4900
yearly_fen = 46800

paid_fen = 0
for month in range(1, 13):
    paid_fen += monthly_fen
    if paid_fen > yearly_fen:
        print(f"第 {month:2} 个月:累计 {paid_fen / 100:7.2f} 元,已经比年付 468 元贵了")
    else:
        print(f"第 {month:2} 个月:累计 {paid_fen / 100:7.2f} 元")
print(f"月付 12 个月一共 {paid_fen / 100:.2f} 元,年付 {yearly_fen / 100:.2f} 元")
```

<div class="line-notes">

- `monthly_fen = 4900` 月付 49 元,换成分(Day 12:钱用整数分算)。
- `yearly_fen = 46800` 年付 468 元。
- `paid_fen = 0` 累加器,**放在循环外面**,表示「一分钱都还没付」。
- `for month in range(1, 13):` `month` 是 1 到 12,十二个月。
- `paid_fen += monthly_fen` 等价于 `paid_fen = paid_fen + monthly_fen`。第 1 轮:0 + 4900 = 4900;第 2 轮:4900 + 4900 = 9800;第 10 轮:44100 + 4900 = 49000。
- `if paid_fen > yearly_fen:` 累计超过 46800 分了吗?第 9 轮累计 44100,不超;第 10 轮 49000,超了。
- `print(f"第 {month:2} 个月:累计 {paid_fen / 100:7.2f} 元,已经比年付 468 元贵了")` `{month:2}` 是宽度 2 的整数,`{... :7.2f}` 是宽度 7、两位小数(Day 15 的格式说明),这样每行对得齐。`/ 100` 只用在显示的这一刻。
- `else:` 没超的月份。
- `print(f"第 {month:2} 个月:累计 {paid_fen / 100:7.2f} 元")` 只打印累计。
- `print(f"月付 12 个月一共 {paid_fen / 100:.2f} 元,年付 {yearly_fen / 100:.2f} 元")` 缩进回到最左边,循环全部结束才打印,这时 `paid_fen` 是 12 个月的总和 58800 分。

</div>

```text
$ uv run python part01/sum_loop.py
第  1 个月:累计   49.00 元
第  2 个月:累计   98.00 元
第  3 个月:累计  147.00 元
第  4 个月:累计  196.00 元
第  5 个月:累计  245.00 元
第  6 个月:累计  294.00 元
第  7 个月:累计  343.00 元
第  8 个月:累计  392.00 元
第  9 个月:累计  441.00 元
第 10 个月:累计  490.00 元,已经比年付 468 元贵了
第 11 个月:累计  539.00 元,已经比年付 468 元贵了
第 12 个月:累计  588.00 元,已经比年付 468 元贵了
月付 12 个月一共 588.00 元,年付 468.00 元
```

<div class="line-notes">

- `第  1 个月:累计   49.00 元` 第一个月,宽度 2 的 `1` 前面补了一个空格,金额前面补空格对齐。
- `第  9 个月:累计  441.00 元` 到第 9 个月累计 441 元,还没超过年付的 468 元。
- `第 10 个月:累计  490.00 元,已经比年付 468 元贵了` 第 10 个月累计 490 元,首次超过。之后每个月都带这句话。
- `月付 12 个月一共 588.00 元,年付 468.00 元` 全部累加完,12 × 49 = 588,比年付多 120 元,和 Day 12 的结论一致。

</div>

三个要点连起来就是累加器写法:**初值在循环外**(`paid_fen = 0`)、**更新在循环里**(`+=`)、**结果在循环后读**。如果把 `paid_fen = 0` 写进循环里,每一轮都会把它清零,最后只剩最后一轮的值。这是下面练习 3 要找的错之一。

## 循环变量的两个特点

### 循环结束后,变量还留着

新建 `part01/loop_var_after.py`:

```python
# agent-zero-lab/part01/loop_var_after.py
for c in ["C023", "C007", "C015"]:
    print("处理", c)

print("循环结束后,c 还是", c)

for i in range(3):
    print("轮到 i =", i)
    i = 10
    print("  我在循环里把 i 改成了", i)
```

<div class="line-notes">

- `for c in ["C023", "C007", "C015"]:` 三个客户号。
- `print("处理", c)` 每轮打印。
- `print("循环结束后,c 还是", c)` 循环外面还能用 `c`。JS 里用 `let`/`const` 声明的循环变量,出了循环就没了;Python 没有这个规则,`c` 就是一个普通变量,停在最后一次被贴上的值。
- `for i in range(3):` 第二个循环,`i` 是 0、1、2。
- `print("轮到 i =", i)` 看每一轮开头 `i` 是多少。
- `i = 10` 在循环体里把 `i` 改成 10。
- `print("  我在循环里把 i 改成了", i)` 确认当前这一轮里,它确实是 10。

</div>

```text
$ uv run python part01/loop_var_after.py
处理 C023
处理 C007
处理 C015
循环结束后,c 还是 C015
轮到 i = 0
  我在循环里把 i 改成了 10
轮到 i = 1
  我在循环里把 i 改成了 10
轮到 i = 2
  我在循环里把 i 改成了 10
```

<div class="line-notes">

- `处理 C023` 第一个循环,三轮。
- `循环结束后,c 还是 C015` 最后一轮把 `c` 贴成 `"C015"`,循环完它没有被收走。
- `轮到 i = 0` 第二个循环第 1 轮开头,`i` 是 0。
- `我在循环里把 i 改成了 10` 这一轮里改成 10。
- `轮到 i = 1` 第 2 轮开头 `i` 又是 1,上一轮改成 10 没有任何影响。
- `轮到 i = 2` 第 3 轮同理。

</div>

第二个现象值得多看一眼:**每一轮开头,Python 都是重新从 `range` 里取下一个值贴到 `i` 上**,你在循环体里把 `i` 改成多少,都不影响下一轮拿到什么。想「提前跳到第 7 轮」是办不到的。后面几天要用到的 `break` 和 `continue`(Day 19)才是改变循环流程的办法。

### 一次都没跑的循环,变量没定义

如果「一批东西」是空的,循环体一次都不会执行。这时循环变量根本没被贴上任何值,循环后再用它就会出事。新建 `part01/loop_empty.py`:

```python
# agent-zero-lab/part01/loop_empty.py
new_tickets = []

for t in new_tickets:
    print("处理", t)

print("最后处理的是", t)
```

<div class="line-notes">

- `new_tickets = []` 空列表,今天新来的工单还没有。
- `for t in new_tickets:` 没有任何元素可取,循环体一次也不跑。
- `print("处理", t)` 这一行从来没有执行过。
- `print("最后处理的是", t)` 循环后面想看「最后处理的是哪张」。`t` 从来没被创建过。

</div>

```text
$ uv run python part01/loop_empty.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/loop_empty.py", line 7, in <module>
    print("最后处理的是", t)
                          ^
NameError: name 't' is not defined
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/loop_empty.py", line 7, in <module>` 出错在第 7 行。
- `NameError: name 't' is not defined` `t` 没有被定义。和 Day 12 的变量名拼错同一种报错,但原因不同:名字没拼错,而是循环一次也没跑。

</div>

编辑器里这一行会有红线:basedpyright 报 `"t" is possibly unbound`(`t` 可能没有绑定值),意思是它看出来某些情况下 `t` 不存在。**看到 `possibly unbound` 不要忽略**,它提醒的就是「循环可能一次都没跑」。修法一般是在循环前先给初值,比如 `last = None`,循环里写 `last = t`,循环后用 `if last is not None:` 判断(Day 14 的 `is None`)。

## enumerate:拿到编号和内容

### 老办法和新办法

很多时候不光要内容,还要知道这是第几个。JS 里 `forEach` 的回调第二个参数就是下标。Python 里新手容易想到用 `range(len(...))`,但更好的是 `enumerate`。新建 `part01/enumerate_demo.py`:

```python
# agent-zero-lab/part01/enumerate_demo.py
tickets = [
    "T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次",
    "T002 登录 C007 手机验证码收不到",
    "T003 计费 C015 想把月付改成年付,差价怎么算",
]

print("--- 老办法:range(len(...)) ---")
for i in range(len(tickets)):
    print(i, tickets[i][:4])

print("--- enumerate ---")
for i, line in enumerate(tickets):
    print(i, line[:4])

print("--- 从 1 开始编号 ---")
for no, line in enumerate(tickets, start=1):
    print(f"第 {no} 张:{line[:4]}")

print("--- enumerate 到底吐出什么 ---")
print(list(enumerate(["a", "b"])))
```

<div class="line-notes">

- `tickets = [` 三张工单,每个元素是一个字符串。方括号里可以换行,每行末尾一个逗号。
- `"T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次",` 工单一,以下两行同理。
- `for i in range(len(tickets)):` 老办法:`len(tickets)` 是 3,`range(3)` 是 0、1、2,`i` 当下标用。
- `print(i, tickets[i][:4])` `tickets[i]` 是第 `i` 张工单,`[:4]` 是 Day 15 的切片,取前 4 个字符,也就是 `T001`、`T002`、`T003`。
- `for i, line in enumerate(tickets):` 新办法:`enumerate(tickets)` 每轮同时给出编号和内容,写在 `for` 后面用逗号隔开的两个名字里接。
- `print(i, line[:4])` 直接用 `line`,不用 `tickets[i]` 再取一次。
- `for no, line in enumerate(tickets, start=1):` `start=1` 让编号从 1 开始。`start=1` 是关键字参数(Day 16 见过 `maxsplit=3`)。
- `print(f"第 {no} 张:{line[:4]}")` 给人看的编号用 `no`,从 1 开始更自然。
- `print(list(enumerate(["a", "b"])))` 看看 `enumerate` 到底每轮给出什么。

</div>

```text
$ uv run python part01/enumerate_demo.py
--- 老办法:range(len(...)) ---
0 T001
1 T002
2 T003
--- enumerate ---
0 T001
1 T002
2 T003
--- 从 1 开始编号 ---
第 1 张:T001
第 2 张:T002
第 3 张:T003
--- enumerate 到底吐出什么 ---
[(0, 'a'), (1, 'b')]
```

<div class="line-notes">

- `--- 老办法:range(len(...)) ---` 第一段的标题。
- `0 T001` 老办法:编号 0,内容 T001。
- `--- enumerate ---` 第二段。
- `1 T002` enumerate 的结果和老办法一模一样,代码少了 `tickets[i]` 这一步。
- `--- 从 1 开始编号 ---` 第三段。
- `第 1 张:T001` `start=1` 之后编号从 1 开始。
- `第 3 张:T003` 最后一张是第 3 张,不是第 2 张。
- `--- enumerate 到底吐出什么 ---` 第四段。
- `[(0, 'a'), (1, 'b')]` 每一项是一对括号括起来的两个值:`(0, 'a')`、`(1, 'b')`。这种括号括起来的一对叫元组(tuple),[Day 22](/blog/agent-zero/day-022-tuples-unpack/) 细讲。

</div>

`for i, line in enumerate(...)` 里那个逗号做的事叫**解包**:每轮拿到一个 `(0, 'T001...')` 这样的二元组,左边两个名字依次接住里面的两个值,相当于 JS 的解构赋值。写法对照:

```text
$ node -e '
const tickets = ["T001", "T002", "T003"];
for (const [i, t] of tickets.entries()) console.log(i, t);
console.log([...tickets.entries()]);
'
0 T001
1 T002
2 T003
[ [ 0, 'T001' ], [ 1, 'T002' ], [ 2, 'T003' ] ]
```

<div class="line-notes">

- `const tickets = ["T001", "T002", "T003"];` 三个工单号。
- `for (const [i, t] of tickets.entries())` 数组的 `entries()` 每轮给出 `[下标, 值]`,左边用方括号解构。Python 的 `enumerate` 就是它。
- `console.log([...tickets.entries()]);` 把所有项展开看一眼。
- `0 T001` 第一轮 `i = 0`,`t = "T001"`。
- `[ [ 0, 'T001' ], [ 1, 'T002' ], [ 2, 'T003' ] ]` 和 Python 的 `[(0, 'a'), (1, 'b')]` 一个形状,只是括号不同。

</div>

什么时候用哪个:只要内容,`for line in tickets`;要内容也要编号,`enumerate`;确实只需要数字本身(重复 N 次、1 到 12 个月),才用 `range`。**`range(len(x))` 再 `x[i]` 是从 C 和 Java 带过来的写法**,Python 里一般认为它不地道,有 `enumerate` 就用 `enumerate`。

## 循环里套循环

循环体里可以再放一个 `for`,里层每一轮外层都要重新来一遍。新建 `part01/nested_loop.py`,算 1 到 3 个席位、前 1 到 2 个月的月付累计:

```python
# agent-zero-lab/part01/nested_loop.py
for seats in range(1, 4):
    print(f"== {seats} 个席位 ==")
    for month in range(1, 3):
        fen = 4900 * seats * month
        print(f"  前 {month} 个月月付累计 {fen / 100:.2f} 元")
```

<div class="line-notes">

- `for seats in range(1, 4):` 外层:席位数 1、2、3。
- `print(f"== {seats} 个席位 ==")` 外层每一轮开头打印一个小标题,缩进 4 格,只属于外层。
- `for month in range(1, 3):` 里层:月数 1、2。它缩进 4 格,放在外层的循环体里。
- `fen = 4900 * seats * month` 缩进 8 格,是里层的循环体。席位数乘月数乘 4900 分。
- `print(f"  前 {month} 个月月付累计 {fen / 100:.2f} 元")` 同样 8 格缩进,打印前面空两格表示它属于上面那个标题。

</div>

```text
$ uv run python part01/nested_loop.py
== 1 个席位 ==
  前 1 个月月付累计 49.00 元
  前 2 个月月付累计 98.00 元
== 2 个席位 ==
  前 1 个月月付累计 98.00 元
  前 2 个月月付累计 196.00 元
== 3 个席位 ==
  前 1 个月月付累计 147.00 元
  前 2 个月月付累计 294.00 元
```

<div class="line-notes">

- `== 1 个席位 ==` 外层第 1 轮,`seats = 1`。
- `前 1 个月月付累计 49.00 元` 里层第 1 轮:4900 × 1 × 1 = 4900 分。
- `前 2 个月月付累计 98.00 元` 里层第 2 轮,4900 × 1 × 2。
- `== 2 个席位 ==` 里层跑完两轮,外层才进入第 2 轮。
- `前 1 个月月付累计 98.00 元` 里层又从 `month = 1` 重新开始(4900 × 2 × 1)。
- `== 3 个席位 ==` 外层第 3 轮。
- `前 2 个月月付累计 294.00 元` 最后一行:4900 × 3 × 2 = 29400 分。

</div>

总共打印了 3 个标题和 6 行金额:外层 3 轮,每轮里层 2 轮,3 × 2 = 6。**嵌套循环的总次数是各层相乘**,所以别随手套三层,10 × 1000 × 1000 就是一千万次。

## 拼起来:10 张工单一次分完

Day 17 的 `classify2.py` 要手敲一张一张测。现在用循环让它自己分完整批,再和人工标注对照,自己数对了几张。先把 Day 5 的 9 张工单放进列表,然后补上一张我今天新造的、规则调试时没见过的:`T010 计费 C042 我想要一份发票的PDF版本`(Day 17 末尾我预言过:这句话会被 `pdf` 拦成功能)。新建 `part01/batch_classify.py`:

```python
# agent-zero-lab/part01/batch_classify.py
tickets = [
    "T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次",
    "T002 登录 C007 手机验证码收不到",
    "T003 计费 C015 想把月付改成年付,差价怎么算",
    "T004 功能 C023 导出发票PDF时中文显示成方框",
    "T005 登录 C031 Forgot password email never arrived",
    "T006 计费 C007 Refund request for duplicate charge",
    "T007 功能 C015 希望发票抬头能改成英文",
    "T008 计费 C042 发票金额和订单金额对不上",
    "T009 计费 C031 续费后发票没有发到邮箱",
    "T010 计费 C042 我想要一份发票的PDF版本",
]

correct = 0
for no, line in enumerate(tickets, start=1):
    parts = line.split(maxsplit=3)
    ticket_id = parts[0]
    human = parts[1]
    text = parts[3].lower()

    if "导出" in text or "抬头" in text or "pdf" in text or "方框" in text:
        category = "功能"
    elif (
        "扣" in text
        or "退款" in text
        or "发票" in text
        or "金额" in text
        or "月付" in text
        or "年付" in text
        or "refund" in text
        or "charge" in text
    ):
        category = "计费"
    elif "登录" in text or "验证码" in text or "密码" in text or "password" in text:
        category = "登录"
    else:
        category = "功能"

    if category == human:
        correct += 1
        mark = "对"
    else:
        mark = "错"
    print(f"{no:2}. {ticket_id} 人工={human} 规则={category} {mark}")

print(f"规则分对了 {correct}/{len(tickets)}")
```

<div class="line-notes">

- `tickets = [` 10 张工单放在一个列表里,每一项是 Day 5 里 `tickets.txt` 的一行:工单号、人工类别、客户号、描述。
- `"T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次",` 第一张,以下每行一张,直到 T010。
- `"T010 计费 C042 我想要一份发票的PDF版本",` 新造的第 10 张。人工类别是计费:用户要的是一份发票,和 T004「导出发票 PDF 时中文显示成方框」是两回事。
- `correct = 0` 累加器:「规则分对了几张」,循环外设 0。
- `for no, line in enumerate(tickets, start=1):` 一张一张取,`no` 是 1 到 10 的序号,`line` 是整行字符串。
- `parts = line.split(maxsplit=3)` Day 16 的拆法:最多拆成 4 段,第 4 段保留完整描述。T001 拆出 `["T001", "计费", "C023", "10月3日...被扣了两次"]`。
- `ticket_id = parts[0]` 第 1 段,工单号。
- `human = parts[1]` 第 2 段,人工标注的类别,当作标准答案。
- `text = parts[3].lower()` 第 4 段描述转小写,`PDF` 变成 `pdf`(Day 16)。
- `if "导出" in text or "抬头" in text or "pdf" in text or "方框" in text:` 这一整个 if/elif/else 链是 Day 17 `classify2.py` 的规则,原样搬进循环体,每张工单各过一遍。
- `category = "功能"` 命中功能词。
- `elif (` 计费类的词,括号换行写。
- `or "发票" in text` 其中一个关键词。
- `category = "计费"` 命中计费词。
- `elif "登录" in text or "验证码" in text or "密码" in text or "password" in text:` 登录类。
- `category = "登录"` 命中登录词。
- `else:` 都没命中。
- `category = "功能"` 默认功能。
- `if category == human:` 规则的结果和人工答案一样吗?这一行和上面的 if/elif 链缩进一样,都在 `for` 的循环体里,是并列的两件事:先分类,再对答案。
- `correct += 1` 一样就把累加器加 1。
- `mark = "对"` 记下「对」。
- `mark = "错"` 记下「错」。
- `print(f"{no:2}. {ticket_id} 人工={human} 规则={category} {mark}")` 每张打印一行,`{no:2}` 让 1 到 9 前面补一个空格,和 10 对齐。
- `print(f"规则分对了 {correct}/{len(tickets)}")` 缩进回到最左边,循环全部跑完后打印总成绩。`len(tickets)` 是 10。

</div>

```text
$ uv run python part01/batch_classify.py
 1. T001 人工=计费 规则=计费 对
 2. T002 人工=登录 规则=登录 对
 3. T003 人工=计费 规则=计费 对
 4. T004 人工=功能 规则=功能 对
 5. T005 人工=登录 规则=登录 对
 6. T006 人工=计费 规则=计费 对
 7. T007 人工=功能 规则=功能 对
 8. T008 人工=计费 规则=计费 对
 9. T009 人工=计费 规则=计费 对
10. T010 人工=计费 规则=功能 错
规则分对了 9/10
```

<div class="line-notes">

- ` 1. T001 人工=计费 规则=计费 对` 第 1 张,「扣」命中计费。
- ` 4. T004 人工=功能 规则=功能 对` T004 在 Day 17 里被「发票」抢先错判过,现在「导出」「pdf」在最前面先拦住,对了。
- ` 9. T009 人工=计费 规则=计费 对` 第 9 张,最后一张老工单。
- `10. T010 人工=计费 规则=功能 错` 第 10 张,错了。它的文本是「我想要一份发票的pdf版本」,第一条 `if` 里的 `"pdf" in text` 成立,直接归功能,后面的计费规则根本没机会看。
- `规则分对了 9/10` `correct` 在 T001 到 T009 各加了一次,T010 没加,最后是 9,总数是 10。

</div>

Day 17 里「9/9」是我看着答案补关键词调出来的,第 10 张是它没见过的。这一张翻车,正是前面说的过拟合:规则在调试时见过的数据上全对,碰到新数据就露馅。

我想让这件事更清楚,所以再写一个 `part01/batch_compare.py`,把 Day 17 的第一版规则和第二版规则**放在同一个循环里**,各用一个计数器,只打印和人工不一致的工单:

```python
# agent-zero-lab/part01/batch_compare.py
tickets = [
    "T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次",
    "T002 登录 C007 手机验证码收不到",
    "T003 计费 C015 想把月付改成年付,差价怎么算",
    "T004 功能 C023 导出发票PDF时中文显示成方框",
    "T005 登录 C031 Forgot password email never arrived",
    "T006 计费 C007 Refund request for duplicate charge",
    "T007 功能 C015 希望发票抬头能改成英文",
    "T008 计费 C042 发票金额和订单金额对不上",
    "T009 计费 C031 续费后发票没有发到邮箱",
    "T010 计费 C042 我想要一份发票的PDF版本",
]

ok1 = 0
ok2 = 0
for line in tickets:
    parts = line.split(maxsplit=3)
    ticket_id = parts[0]
    human = parts[1]
    text = parts[3].lower()

    # 第一版规则:Day 17 的 classify.py
    if (
        "扣" in text
        or "退款" in text
        or "发票" in text
        or "金额" in text
        or "refund" in text
        or "charge" in text
    ):
        cat1 = "计费"
    elif "登录" in text or "验证码" in text or "密码" in text or "password" in text:
        cat1 = "登录"
    else:
        cat1 = "功能"

    # 第二版规则:Day 17 的 classify2.py
    if "导出" in text or "抬头" in text or "pdf" in text or "方框" in text:
        cat2 = "功能"
    elif (
        "扣" in text
        or "退款" in text
        or "发票" in text
        or "金额" in text
        or "月付" in text
        or "年付" in text
        or "refund" in text
        or "charge" in text
    ):
        cat2 = "计费"
    elif "登录" in text or "验证码" in text or "密码" in text or "password" in text:
        cat2 = "登录"
    else:
        cat2 = "功能"

    if cat1 == human:
        ok1 += 1
    if cat2 == human:
        ok2 += 1
    if cat1 != human or cat2 != human:
        print(f"{ticket_id} 人工={human} 第一版={cat1} 第二版={cat2}")

print(f"第一版 {ok1}/{len(tickets)},第二版 {ok2}/{len(tickets)}")
```

<div class="line-notes">

- `tickets = [` 同样的 10 张工单。
- `"T010 计费 C042 我想要一份发票的PDF版本",` 末尾第 10 张。
- `ok1 = 0` 第一版的累加器。
- `ok2 = 0` 第二版的累加器。两个计数器一左一右各数各的。
- `for line in tickets:` 这次不要编号,直接取元素。
- `parts = line.split(maxsplit=3)` 同上。
- `ticket_id = parts[0]` 工单号。
- `human = parts[1]` 人工类别。
- `text = parts[3].lower()` 描述转小写。
- `# 第一版规则:Day 17 的 classify.py` 注释,用 `#` 开头,Python 不执行。
- `cat1 = "计费"` 第一版的计费结果存进 `cat1`。
- `cat1 = "登录"` 第一版的登录。
- `cat1 = "功能"` 第一版的默认结果。
- `# 第二版规则:Day 17 的 classify2.py` 第二版规则的开头。
- `cat2 = "功能"` 第二版先判功能词。
- `cat2 = "计费"` 第二版的计费。
- `cat2 = "登录"` 第二版的登录。
- `cat2 = "功能"` 第二版的默认结果。
- `if cat1 == human:` 第一版对了吗?
- `ok1 += 1` 对了就让 `ok1` 加 1。
- `if cat2 == human:` 第二版对了吗?
- `ok2 += 1` 对了就让 `ok2` 加 1。
- `if cat1 != human or cat2 != human:` 只要有一版和人工不一致就打印这一张。`!=` 是「不等于」(Day 14),`or` 是 Day 17 的「或者」。
- `print(f"{ticket_id} 人工={human} 第一版={cat1} 第二版={cat2}")` 打印不一致的那几张。
- `print(f"第一版 {ok1}/{len(tickets)},第二版 {ok2}/{len(tickets)}")` 缩进回到最左边,循环结束后打印两个成绩。

</div>

```text
$ uv run python part01/batch_compare.py
T003 人工=计费 第一版=功能 第二版=计费
T004 人工=功能 第一版=计费 第二版=功能
T007 人工=功能 第一版=计费 第二版=功能
T010 人工=计费 第一版=计费 第二版=功能
第一版 7/10,第二版 9/10
```

<div class="line-notes">

- `T003 人工=计费 第一版=功能 第二版=计费` T003「月付改年付」:第一版没有这两个词,掉进默认的功能;第二版补了「月付」「年付」,对了。
- `T004 人工=功能 第一版=计费 第二版=功能` T004:第一版被「发票」抢先,第二版靠最前面的功能词拦住。
- `T007 人工=功能 第一版=计费 第二版=功能` T007「发票抬头」同理。
- `T010 人工=计费 第一版=计费 第二版=功能` 第 10 张是第二版**反而**错、第一版反而对的唯一一张。第二版为了修 T004 把 `pdf` 放到了最前面,这一刀砍到了 T010。
- `第一版 7/10,第二版 9/10` 第一版只对了 7 张(T003、T004、T007 三张错);第二版 9 张。

</div>

这个结果比单看 9/10 有意思。第二版在 10 张上的成绩更好(9/10 比 7/10),可是它赢的那三张(T003、T004、T007)恰恰是我看着答案调的,它输的 T010 是没见过的。如果只在老的 9 张上比较,你得到的是 9/9 对 6/9,以为二版全面碾压;加上一张没见过的,才看出二版有一个新弱点。这就是为什么要留一批**不参与调规则的数据**专门用来打分,Day 341 起的评测部分会把它做成正规流程,今天你先记住:「9/9」不等于「准」。

写完检查一遍:

```text
$ uv run ruff check part01/for_basic.py part01/for_chars.py part01/range_demo.py part01/range_loop.py part01/sum_loop.py part01/loop_var_after.py part01/enumerate_demo.py part01/nested_loop.py part01/batch_classify.py part01/batch_compare.py
All checks passed!
$ uv run ruff format --check part01/for_basic.py part01/for_chars.py part01/range_demo.py part01/range_loop.py part01/sum_loop.py part01/loop_var_after.py part01/enumerate_demo.py part01/nested_loop.py part01/batch_classify.py part01/batch_compare.py
10 files already formatted
```

<div class="line-notes">

- `All checks passed!` 十个正常的脚本都通过。`for_indent_error.py` 是故意写错的,Ruff 会说 `invalid-syntax`;`range_float.py` 和 `loop_empty.py` 也是故意的,前者运行时报 `TypeError`,后者运行时报 `NameError`。
- `10 files already formatted` 格式化检查也过了。

</div>

basedpyright 在编辑器里对 `loop_empty.py` 画红线(`"t" is possibly unbound`),对 `range_float.py` 画红线(`float` 不能当 `range` 的参数),其余零报错。

| 今天的零件 | 在 `batch_classify.py` 里是哪一步 |
| --- | --- |
| `for x in 一批东西:` | `for no, line in enumerate(tickets, start=1):` 一张一张取工单 |
| 缩进决定哪些行属于循环体 | if/elif 链、`print` 缩进在 for 下面;最后的总成绩缩进回左边 |
| 累加器:循环外设 0,循环里 `+=` | `correct = 0` 加 `correct += 1` |
| `enumerate(..., start=1)` | 给每张工单一个从 1 开始的序号 |
| 循环体里再放 if/elif/else | 每张工单各走一遍 Day 17 的规则 |
| 循环后读累加器 | `print(f"规则分对了 {correct}/{len(tickets)}")` |
| 循环不负责「对不对」 | 10 张全跑完 9/10,第 10 张错是规则的问题,不是循环的问题 |

## 动手练习

### 练习 1:统计每个类别有几张

写 `part01/ex18_1_count.py`:用今天的 10 张工单(列表可以从 `batch_classify.py` 里复制),用一个循环数出人工类别里计费、登录、功能各有几张,最后打印「计费 6 张 / 登录 2 张 / 功能 2 张,共 10 张」这样的一行,再打印计费占百分之几(整数,先乘后整除)。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex18_1_count.py
tickets = [
    "T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次",
    "T002 登录 C007 手机验证码收不到",
    "T003 计费 C015 想把月付改成年付,差价怎么算",
    "T004 功能 C023 导出发票PDF时中文显示成方框",
    "T005 登录 C031 Forgot password email never arrived",
    "T006 计费 C007 Refund request for duplicate charge",
    "T007 功能 C015 希望发票抬头能改成英文",
    "T008 计费 C042 发票金额和订单金额对不上",
    "T009 计费 C031 续费后发票没有发到邮箱",
    "T010 计费 C042 我想要一份发票的PDF版本",
]

billing = 0
login = 0
feature = 0
for line in tickets:
    category = line.split()[1]
    if category == "计费":
        billing += 1
    elif category == "登录":
        login += 1
    else:
        feature += 1

total = billing + login + feature
print(f"计费 {billing} 张 / 登录 {login} 张 / 功能 {feature} 张,共 {total} 张")
print(f"计费占 {billing * 100 // total}%")
```

<div class="line-notes">

- `tickets = [` 同样 10 张工单,以下省略的每行一张,和 `batch_classify.py` 里一样。
- `"T010 计费 C042 我想要一份发票的PDF版本",` 最后一张。
- `billing = 0` 三个累加器各管一个类别,全部在循环**外面**设 0。
- `login = 0` 登录的计数器。
- `feature = 0` 功能的计数器。
- `for line in tickets:` 一张一张取。
- `category = line.split()[1]` `line.split()` 不带参数,按任意空白拆成列表,`[1]` 取第 2 段,也就是人工类别。这是把 Day 16 的 `split` 和 Day 15 的索引连着用。对 T001 来说拆出的第 2 段是 `"计费"`。
- `if category == "计费":` 是计费就走这一支。
- `billing += 1` 计费计数器加 1。
- `elif category == "登录":` 登录。
- `login += 1` 登录计数器加 1。
- `else:` 剩下的就是功能。
- `feature += 1` 功能计数器加 1。
- `total = billing + login + feature` 循环结束后,三个相加。也可以直接用 `len(tickets)`,这里故意加一遍,可以当自检。
- `print(f"计费 {billing} 张 / 登录 {login} 张 / 功能 {feature} 张,共 {total} 张")` 一行打印全部。
- `print(f"计费占 {billing * 100 // total}%")` 先乘 100 再整除(Day 12 的整数算法):6 × 100 // 10 = 60。

</div>

```text
$ uv run python part01/ex18_1_count.py
计费 6 张 / 登录 2 张 / 功能 2 张,共 10 张
计费占 60%
```

<div class="line-notes">

- `计费 6 张 / 登录 2 张 / 功能 2 张,共 10 张` T001、T003、T006、T008、T009、T010 是计费共 6 张;T002、T005 登录 2 张;T004、T007 功能 2 张。6 + 2 + 2 = 10,和 `len(tickets)` 对得上。
- `计费占 60%` 6 × 100 // 10 = 60。

</div>

这是 Agent 工程里每天会写的一种代码:遍历一批记录,按某个字段分组计数。到 [Day 24](/blog/agent-zero/day-024-dicts/)(字典)你会发现三个计数器可以变成一个 `counts[category] += 1`,不用写 if/elif。

</details>

### 练习 2:先猜,再跑

下面的 `part01/ex18_2_guess.py` 一共会输出 7 行(中间那个 `for` 会打印两行)。先在纸上写出每一行输出,再跑。

```python
# agent-zero-lab/part01/ex18_2_guess.py
print(list(range(10, 0, -3)))
print(list(range(1, 1)))
print(list(range(0, 5, 2)))

n = 0
for i in range(4):
    n += i
print(n, i)

for no, ch in enumerate("计费", start=5):
    print(no, ch)

total = 0
for x in range(3):
    for y in range(2):
        total += 1
print(total)
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex18_2_guess.py
[10, 7, 4, 1]
[]
[0, 2, 4]
6 3
5 计
6 费
6
```

<div class="line-notes">

- `[10, 7, 4, 1]` `range(10, 0, -3)`:从 10 开始每次减 3:10、7、4、1;下一个 -2 已经越过了终点 0,停。
- `[]` `range(1, 1)` 起点等于终点,一个也没有。
- `[0, 2, 4]` `range(0, 5, 2)`:0、2、4;下一个 6 超过 5,停。
- `6 3` 循环里 `n` 依次是 0 + 0、0 + 1、1 + 2、3 + 3,最后 6。`i` 是最后一轮的 3,循环结束后还活着。
- `5 计` `enumerate("计费", start=5)` 第 1 轮编号 5,字符 `计`。
- `6 费` 第 2 轮编号 6,字符 `费`。
- `6` 两层循环 3 × 2 = 6 次 `total += 1`。

</div>

编辑器会在 `print(n, i)` 这一行给 `"i" is possibly unbound` 的红线:`range(4)` 在这里一定非空,所以实际不会出事,但类型检查器不知道,它只看到「循环可能一次都不跑」。

猜错的话,最容易错的是第一行(负步长要看终点怎么停)和第四行(`i` 最后停在 3,不是 4)。把每一轮写在纸上,别心算。

</details>

### 练习 3:找出两个错

`part01/ex18_3_bug.py` 想把四笔退款金额加起来,应该得到 299 + 299 + 49 + 468 = 1115 元。它有两个错。先跑一遍,再只改其中一个错看看,最后两个都改。

```python
# agent-zero-lab/part01/ex18_3_bug.py
amounts = [299, 299, 49, 468]

for i in range(1, len(amounts)):
    total = 0
    total += amounts[i]
print("退款合计", total, "元,应该是 1115 元")
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex18_3_bug.py
退款合计 468 元,应该是 1115 元
```

<div class="line-notes">

- `退款合计 468 元,应该是 1115 元` 只剩最后一笔 468。

</div>

两个错:

1. `range(1, len(amounts))` 从 1 开始,跳过了下标 0 的第一笔 299。下标从 0 开始(Day 15),`range(len(amounts))` 才是 0、1、2、3。
2. `total = 0` 写在循环**里面**,每一轮都清零,最后只剩最后一轮加进去的那一笔。这就是累加器必须放在循环外的原因。

只修其中一个,结果仍然是错的,而且错得不一样:

```python
# agent-zero-lab/part01/ex18_3_bug_a.py
amounts = [299, 299, 49, 468]

for i in range(len(amounts)):
    total = 0
    total += amounts[i]
print("只改了错 1,退款合计", total, "元")
```

<div class="line-notes">

- `amounts = [299, 299, 49, 468]` 四笔金额。
- `for i in range(len(amounts)):` 改对了第一个错,下标 0 到 3 都取到。
- `total = 0` 第二个错还在:每轮清零。
- `total += amounts[i]` 清零后只加这一轮的那一笔。
- `print("只改了错 1,退款合计", total, "元")` 循环后读到的是最后一轮的值。

</div>

```python
# agent-zero-lab/part01/ex18_3_bug_b.py
amounts = [299, 299, 49, 468]

total = 0
for i in range(1, len(amounts)):
    total += amounts[i]
print("只改了错 2,退款合计", total, "元")
```

<div class="line-notes">

- `amounts = [299, 299, 49, 468]` 同样四笔。
- `total = 0` 改对了第二个错,累加器在循环外。
- `for i in range(1, len(amounts)):` 第一个错还在:下标从 1 开始。
- `total += amounts[i]` 累加下标 1、2、3 三笔:299 + 49 + 468。
- `print("只改了错 2,退款合计", total, "元")` 少了下标 0 那一笔。

</div>

```text
$ uv run python part01/ex18_3_bug_a.py
只改了错 1,退款合计 468 元
$ uv run python part01/ex18_3_bug_b.py
只改了错 2,退款合计 816 元
```

<div class="line-notes">

- `只改了错 1,退款合计 468 元` 还是 468:只改下标,累加器照样清零。
- `只改了错 2,退款合计 816 元` 816 = 299 + 49 + 468,比正确答案少了第一笔的 299。

</div>

两个都改对,并且改用更直接的写法 `for amount in amounts`,不再用下标,`part01/ex18_3_fixed.py`:

```python
# agent-zero-lab/part01/ex18_3_fixed.py
amounts = [299, 299, 49, 468]

total = 0
for amount in amounts:
    total += amount
print("退款合计", total, "元")
```

<div class="line-notes">

- `amounts = [299, 299, 49, 468]` 四笔金额。
- `total = 0` 累加器在循环外面。
- `for amount in amounts:` 直接取元素,不碰下标,也就不会出现「从几开始」的问题。
- `total += amount` 每一轮把这一笔加进去。
- `print("退款合计", total, "元")` 循环全部结束后读结果。

</div>

```text
$ uv run python part01/ex18_3_fixed.py
退款合计 1115 元
```

<div class="line-notes">

- `退款合计 1115 元` 299 + 299 + 49 + 468 = 1115,和预期一致。

</div>

教训有两条。第一,**能直接 `for x in 列表` 就不要自己管下标**,下标是一半以上循环 bug 的来源。第二,和 Day 17 的练习 3 一样,两个错会互相遮掩,每修一个都要重新跑一遍看结果。另外,编辑器对 `ex18_3_bug.py` 和 `ex18_3_bug_a.py` 的 `print` 那一行都画了 `"total" is possibly unbound` 红线,它是在提醒:循环可能一次都没跑,`total` 就不存在。这次红线其实指出了真正的毛病所在:`total` 的初值不该放在循环里。

</details>

### 练习 4:哪一档折扣让人「多买反而少付」

Day 17 练习 4 的席位折扣最后提到过:19 席位应付 8,002.80 元,20 席位应付 7,956 元,多买一个席位反而便宜。写 `part01/ex18_4_discount_scan.py`,用循环把席位数 1 到 30 都算一遍(折扣规则同 Day 17:不到 5 席位没折扣,5 到 9 席位 5%,10 到 19 席位 10%,20 席位及以上 15%;年付每席位 46800 分),找出所有「比上一档席位应付更少」的地方并打印。提示:用一个变量 `prev_pay_fen` 记住上一轮的应付金额,第一轮它还没有值,先设成 `None`(Day 14)。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex18_4_discount_scan.py
price_year_fen = 46800
prev_pay_fen = None

for seats in range(1, 31):
    if seats >= 20:
        discount = 15
    elif seats >= 10:
        discount = 10
    elif seats >= 5:
        discount = 5
    else:
        discount = 0

    total_fen = price_year_fen * seats
    pay_fen = total_fen - total_fen * discount // 100

    if prev_pay_fen is not None and pay_fen < prev_pay_fen:
        print(
            f"{seats - 1} 席位应付 {prev_pay_fen / 100:,.2f} 元,{seats} 席位反而只要 {pay_fen / 100:,.2f} 元"
        )
    prev_pay_fen = pay_fen
```

<div class="line-notes">

- `price_year_fen = 46800` 年付单价 468 元,换成分。
- `prev_pay_fen = None` 「上一轮的应付金额」。第一轮之前没有上一轮,所以是 `None`,不是 0:0 会让第一轮被误当成「比上一轮便宜」。
- `for seats in range(1, 31):` 席位数 1 到 30,终点写 31 才包含 30。
- `if seats >= 20:` 从大到小判断折扣档,同 Day 17。
- `discount = 15` 20 席位及以上优惠 15%。
- `elif seats >= 10:` 10 到 19。
- `discount = 10` 优惠 10%。
- `elif seats >= 5:` 5 到 9。
- `discount = 5` 优惠 5%。
- `else:` 不到 5 席位。
- `discount = 0` 没折扣。
- `total_fen = price_year_fen * seats` 原价,单位分。
- `pay_fen = total_fen - total_fen * discount // 100` 应付 = 原价 − 优惠。优惠用「先乘后整除」,整数分没有浮点误差(Day 12)。
- `if prev_pay_fen is not None and pay_fen < prev_pay_fen:` 两个条件缺一不可:不是第一轮,并且这一轮比上一轮便宜。`and` 的短路(Day 17)保证第一轮 `prev_pay_fen` 是 `None` 时,右边的比较不会执行,避免 `None` 和数字比较报 `TypeError`。
- `print(` ruff 格式化后,过长的 f-string 单独占一行。
- `f"{seats - 1} 席位应付 {prev_pay_fen / 100:,.2f} 元,{seats} 席位反而只要 {pay_fen / 100:,.2f} 元"` 打印「少一个席位」和「多一个席位」的两个应付金额。
- `prev_pay_fen = pay_fen` **放在 if 的外面、循环体的最后一行**:不管这轮有没有打印,都要把这轮的应付记成「上一轮」,给下一轮用。要是缩进放进了 if 里面,只有出现便宜的那一轮才更新,之后的比较全是错的。

</div>

```text
$ uv run python part01/ex18_4_discount_scan.py
19 席位应付 8,002.80 元,20 席位反而只要 7,956.00 元
```

<div class="line-notes">

- `19 席位应付 8,002.80 元,20 席位反而只要 7,956.00 元` 30 个席位里只有这一处。5 席位(2,223.00 元)比 4 席位(1,872.00 元)贵,10 席位(4,212.00 元)比 9 席位(4,001.40 元)贵,因为 5% 和 10% 的折扣都没大到抵消多买一个席位的价格。反常出在 19 到 20:多买一个席位,原价多 468 元,可是折扣从 10% 跳到 15%,优惠金额从 889.20 元涨到 1,404.00 元,多出 514.80 元,比多付的 468 元还多 46.80 元,总价就掉下来了。

</div>

循环帮你做了 Day 17 里「靠一两个例子心算」的事:30 个情况全算一遍,只在一处冒出反常。真实的价目表规则,很多这种「边界附近的怪事」都是用这种遍历扫出来的,而不是靠想。

</details>

练习的验收标准:`for_basic.py`、`for_chars.py`、`range_demo.py`、`range_loop.py`、`sum_loop.py`、`loop_var_after.py`、`loop_empty.py`、`enumerate_demo.py`、`nested_loop.py`、`batch_classify.py`、`batch_compare.py` 和四道练习都能跑,输出和文中一致;能不看文章说出 Python 的 `in` 对应 JS 的 `of`、`range(1, 6)` 和 `range(0, 10, 3)` 各是什么、累加器为什么必须放在循环外面、循环结束后循环变量还活着;能默写 `batch_classify.py` 里的循环结构(不用默写那条长长的 if/elif 链,写成 `category = "?"` 占位也行);能解释为什么 `batch_classify.py` 的 9/10 比 Day 17 的 9/9 更可信。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 循环(loop) | 让同一段代码重复执行很多次。`for` 和 Day 19 的 `while` 是两种 |
| `for` 循环 | `for 变量 in 一批东西:`,对每一个元素执行一遍缩进的代码,对应 JS 的 `for...of` |
| 可迭代对象(iterable) | 能被 `for` 一个一个取出元素的东西,如列表、字符串、`range`,今天不用背,只要知道 `for ... in` 后面接的就是它 |
| 循环体 | `for` 下面缩进的那几行,每一轮都会执行 |
| 一轮(iteration) | 循环体执行一遍。10 张工单就是 10 轮 |
| 循环变量 | `for` 和 `in` 之间的那个名字,每一轮被重新贴上下一个元素,循环结束后还保留最后一个值 |
| `range` | 生成一串整数的内置函数,`range(起点, 终点, 步长)`,起点包含、终点不包含 |
| 步长(step) | `range` 的第三个参数,每次加多少,可以是负数 |
| 左闭右开 | 包含起点、不包含终点的区间写法,切片和 `range` 都是 |
| 列表(list) | 方括号括起来的一串东西,对应 JS 的数组,Day 21 细讲 |
| 累加器 | 循环外设初值(通常 0)、循环里更新(`+=`)、循环后读结果的变量,如 `correct`、`paid_fen` |
| `+=` | 在原来的值上加,`x += 1` 等于 `x = x + 1` |
| `enumerate` | 内置函数,让 `for` 每一轮同时拿到编号和元素,`start=1` 可以改起始编号 |
| 元组(tuple) | 括号括起来的一对或几个值,如 `(0, 'a')`;`enumerate` 每轮给的就是这种,Day 22 细讲 |
| 解包 | `for i, line in ...` 里把一个二元组的两个值分别装进两个名字,相当于 JS 的解构赋值 |
| 嵌套循环 | 循环体里再放一个循环,总次数是各层相乘 |
| `NameError` | 用了一个没有定义的名字;一次都没跑的循环后面用循环变量就会出这个错 |
| `possibly unbound` | basedpyright 的提示:这个变量在某些路径上可能没有值 |

## 常见误区

**把 Python 的 `in` 当 JS 的 `in`。** JS 的 `for (k in arr)` 拿到的是键(字符串 `"0"`、`"1"`),Python 的 `for x in arr` 拿到的是元素。写 Python 时把它读成 `of`。

**`range(1, 5)` 以为包含 5。** 终点不包含,得到的是 1、2、3、4。要 1 到 5,写 `range(1, 6)`。

**`range` 里放小数。** `TypeError: 'float' object cannot be interpreted as an integer`。`/` 的结果永远是小数,需要整数个数时用 `//`。

**累加器的初值写进了循环里。** 每一轮都被清零,最后只剩最后一轮的值,而且不报错。初值永远放在 `for` 前面。

**从 0 还是从 1 搞混。** 下标从 0 开始,序号从 1 开始更自然。需要序号用 `enumerate(..., start=1)`,别手写 `i + 1`。

**用 `range(len(x))` 再 `x[i]` 取元素。** 能用,但绕。只要元素就 `for item in x`,要编号就 `enumerate`。

**以为循环变量出了循环就没了。** Python 里它还活着,停在最后一个值;但如果循环一次都没跑,它根本不存在,后面用就是 `NameError`。

**在循环体里改循环变量,想影响下一轮。** 不会影响,下一轮开头 Python 重新给它赋值。想提前结束或跳过,要用 Day 19 的 `break` 和 `continue`。

**以为 for 循环里的缩进随便写。** 缩进少一格,语句就被移出循环,变成只执行一次;多一格可能变成嵌套。`print` 总结行缩进错了,会看到它被打印了十遍。

**拿「9/9」当成「规则准」。** 一批数据调规则,在同一批上打分,当然高。今天新加的第 10 张就是证明:一加新数据成绩立刻变成 9/10,而且错的是最新改动砍到的那一张。

## 学习资料

### 文档与文章

- [Python 教程 · for 语句](https://docs.python.org/zh-cn/3.12/tutorial/controlflow.html#for-statements):中文,官方教程里 `for` 的一小节,有一个很有名的提醒:不要在遍历时改动正在遍历的列表。
- [Python 教程 · range() 函数](https://docs.python.org/zh-cn/3.12/tutorial/controlflow.html#the-range-function):中文,`range` 的几种写法和「它是一个可迭代对象,不是列表」。
- [Python 标准库 · range 类型](https://docs.python.org/zh-cn/3.12/library/stdtypes.html#ranges):中文,`range` 支持 `len`、`in`、切片等操作,以及为什么大范围的 `range` 不占内存。
- [Python 标准库 · enumerate()](https://docs.python.org/zh-cn/3.12/library/functions.html#enumerate):中文,`enumerate` 的定义和 `start` 参数。
- [Python 语言参考 · for 语句](https://docs.python.org/zh-cn/3.12/reference/compound_stmts.html#the-for-statement):中文,`for` 的正式语法,今天看到「循环变量在循环后保留」那一句的出处就够了。
- [MDN · for...of](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Statements/for...of):中文,JS 里和 Python `for` 同一个行为的写法。
- [MDN · for...in](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Statements/for...in):中文,JS 里「拿键」的那个,对比 Python 的 `in` 看清区别。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1LaCjBmEPy&autoplay=0&high_quality=1" title="5分钟学编程 · Python篇 #15｜for循环：让代码自动重复执行" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>猫小申 · 5分钟学编程 · Python篇 #15｜for循环:让代码自动重复执行 · 6 分钟,2025 年 11 月。标题就是今天前半部分的主题,时间短,先看这个当热身。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1BGZpYjEnP&autoplay=0&high_quality=1" title="Python新手必学：循环遍历与range函数精讲" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>水哥澎湃 · Python新手必学:循环遍历与range函数精讲 · 31 分钟,2025 年 3 月。标题说的是循环遍历和 `range` 两块,时间长一些,今天的 `range` 一节卡住了就来看这个。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/6iF8Xb7Z3wQ" title="Python Tutorial for Beginners 7: Loops and Iterations - For/While Loops" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial for Beginners 7: Loops and Iterations · 英文,可开自动字幕。整集讲循环,包括 `for`、`range`、`break`、`continue` 和 `while`,今天看 `for` 和 `range` 的部分,`while` 留给明天。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/KWgYha0clzw" title="Learn Python for loops in 5 minutes! 🔁" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Bro Code · Learn Python for loops in 5 minutes! · 英文,5 分钟。标题就是 5 分钟学 `for`,节奏快,适合学完今天后快速过一遍巩固。</figcaption>
</figure>

### 书籍

- Eric Matthes《Python Crash Course》第 3 版,No Starch Press,2023(中译《Python编程:从入门到实践》)。第 4 章「Working with Lists」讲 `for` 循环、`range()` 和遍历,缩进的错误例子很典型,配套练习也适合今天。
- Allen B. Downey《Think Python》第 3 版,O'Reilly,2024,[免费在线版](https://allendowney.github.io/ThinkPython/)。第 7 章「Iteration and Search」讲 `for`、`while` 和用循环做搜索,今天只读 `for` 的那几节。

### 开源项目与代码

- [Asabeneh/30-Days-Of-Python](https://github.com/Asabeneh/30-Days-Of-Python/tree/master/10_Day_Loops):英文,「Day 10 Loops」,`for`、`range`、嵌套循环和一批练习,和今天的顺序接近。
- [jackfrued/Python-100-Days](https://github.com/jackfrued/Python-100-Days/blob/master/Day01-20/06.循环结构.md):中文,《06.循环结构》一篇,依次讲 `for-in`、`while`、`break` 和 `continue`、嵌套循环,最后有判断素数、最大公约数、猜数字三个例子。今天读 `for-in` 和嵌套循环两节。

## 自测

1. 下面这段代码会打印什么?`range(2, 9, 3)` 里的 9 为什么没出现?

```python
for n in range(2, 9, 3):
    print(n)
```

<details><summary>答案</summary>

2、5、8,各占一行。从 2 开始每次加 3:2、5、8,下一个是 11,超过终点 9,停。9 本身是终点,终点不包含,所以即使步长刚好能踩到 9 也不会取出来。

</details>

2. JS 里 `for (const k in ["C023", "C007"])` 和 Python 里 `for k in ["C023", "C007"]` 的 `k` 分别是什么?

<details><summary>答案</summary>

JS 里的 `k` 是键 `"0"` 和 `"1"`(字符串);Python 里的 `k` 是元素本身 `"C023"` 和 `"C007"`。Python 的 `for x in 列表` 对应的是 JS 的 `for (const x of 数组)`。要键(下标)就用 `enumerate`。

</details>

3. 下面这段想算 3 张工单金额合计,哪里有问题?

```python
for amount in [100, 200, 300]:
    total = 0
    total += amount
print(total)
```

<details><summary>答案</summary>

`total = 0` 在循环里面,每一轮都被清零,最后 `total` 是 300,而不是 600。要把它挪到 `for` 前面。编辑器还会提示 `"total" is possibly unbound`,因为在它看来,列表有可能是空的。

</details>

4. `new_tickets = []`,然后 `for t in new_tickets: print(t)`,最后一行 `print(t)`,会发生什么?怎么避免?

<details><summary>答案</summary>

最后一行报 `NameError: name 't' is not defined`,因为循环体一次也没跑,`t` 从来没被创建。避免:循环前先给初值,比如 `last = None`,循环里写 `last = t`,循环后先判断 `if last is not None:` 再用;或者先用 `if not new_tickets:` 处理空列表的情况。

</details>

5. `for i, line in enumerate(tickets, start=1)` 里,`i, line` 这一对名字是怎么拿到值的?`start=1` 影响的是什么?

<details><summary>答案</summary>

`enumerate` 每轮给出一个二元组,如 `(1, "T001 ...")`,`for` 把它解包,第一个值装进 `i`,第二个装进 `line`(相当于 JS 的解构赋值)。`start=1` 只改变编号的起点,不改变元素:第一张工单还是 `tickets[0]`,只是它的编号是 1。

</details>

6. 面试题:大模型一次回复里带了 3 个工具调用(比如查客户、查发票、查订阅),你准备用循环逐个执行,把结果收集起来。用今天的知识,这里至少有哪三件事要想清楚?

<details><summary>答案</summary>

第一,累加器(或结果列表)放在循环外面,每轮把这一个工具调用的结果追加进去,别在循环里重新初始化,否则只剩最后一个。第二,模型也可能一个工具调用都没返回,这时循环体一次不跑,循环后不要直接用循环变量(会 `NameError`),要先判断有没有。第三,要把每个结果和它对应的调用编号(工具调用 ID)对上,用 `enumerate` 或在结果里带上 ID,不能靠「第几个」去猜。另外,其中一个工具调用失败时,是让整批停下还是记录失败继续跑,也要有明确的规则,这个话题 [Day 162](/blog/agent-zero/day-162-parallel-tools/) 的并行工具调用和 [Day 35](/blog/agent-zero/day-035-exceptions-1/) 的异常处理会展开。

</details>

## 明天预告

Day 19 · while、break 和 continue。`for` 适合「这一批每个都处理」,次数从列表长度就知道。但有很多事次数事先不知道:用户输入不合法就再问一遍,最多问 3 次;调接口失败了就重试,最多重试 3 次;Agent 一直调用工具直到模型说「不用了」。这类「直到某个条件满足才停」的循环叫 `while`。明天学它,再学 `break`(提前跳出)和 `continue`(跳过这一轮),并用它们写出第一个带重试的循环。
