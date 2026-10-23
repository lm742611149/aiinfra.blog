---
title: 'Day 15 · 字符串(一):索引、切片和 f-string'
description: '字符串里每个字符都有编号,从 0 数,也能从 -1 倒着数;切片 s[a:b] 是左闭右开,越界不报错;f-string 相当于 JS 的模板字符串,还能用 :.2f、:, 这些小语法排版金额。最后用一张工单行练习截出工单号、客户号,并把 Day 14 的退款脚本改成打印 299.00 元。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 15
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 14](/blog/agent-zero/day-014-bool-none/) 学了布尔值、`None` 和类型转换,最后写了 `part01/ask_amount.py`:从键盘读单价和扣款次数,转成整数分,算出该退多少。那个脚本留了两个难看的地方。一个是输入 `299元` 就崩,报 `ValueError: could not convert string to float: '299元'`;另一个是打印金额只能写成 `应退: 299 元 0 分`,元和分是拆开拼的,看着像草稿。

今天先解决第二个,再把第一个问题的前半截铺好。金额要排成 `299.00 元`,得会 f-string;「299元」里的那个「元」要去掉,得先知道字符串是怎么被一个字一个字编号的,才能「取出其中一段」。这两件事合起来就是今天的内容:索引和切片,加上 f-string。去掉「元」的现成方法明天学,今天先用切片理解原理。

## 今天要解决的问题

学完今天,你应该能:

1. 说出字符串里每个字符的编号规则(从 0 开始、可以用负数从末尾数),用 `s[0]`、`s[-1]` 取单个字符,看到 `IndexError: string index out of range` 知道是编号超出了长度。
2. 用 `s[a:b]` 截出一段,说清「左闭右开」是什么意思,会省略起点或终点、会用负数,知道切片越界不报错而索引越界会报错。
3. 用 f-string 把变量和表达式填进文字里,会用 `:.2f`、`:,`、`:>8`、`:03d` 这几个常用格式,说出它和 JS 模板字符串的区别。
4. 写出 `part01/ticket_card.py`:从一行工单文本里截出工单号、类别、客户号,排成一行摘要;并把 `ask_amount.py` 的输出改成 `应退:39.98 元` 这样。

预计用时:2.5 小时。字符串和索引 40 分钟,切片 50 分钟,f-string 40 分钟,剩下做练习。

前置:[Day 7](/blog/agent-zero/day-007-terminal-4/)(单引号和双引号怎么选)、[Day 9](/blog/agent-zero/day-009-editor-setup/)(`TypeError`、看报错)、[Day 12](/blog/agent-zero/day-012-numbers/)(整数分、`//` 和 `%`)、[Day 14](/blog/agent-zero/day-014-bool-none/)(`ask_amount.py`、类型转换)。今天不调任何 API,花费 0 元。

学法提示:先对照文章逐行敲一遍(代码自己敲,不复制粘贴)并跑通;第二天合上文章,把 `ticket_card.py` 默写出来;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚我是在哪跑的

输出是我 2026-10-23 在 2019 款 Intel MacBook Pro(macOS 14、zsh)上用演示家目录真跑的,家目录显示成 `/Users/你`,`~/agent-zero-lab` 接着 Day 14 的状态(装过 Day 10 的 `rich`),`uv run python` 是 3.12.13。今天的脚本都放在 `part01/`,在仓库根目录用 `uv run python part01/文件名.py` 运行。

和 Day 14 一样,要从键盘读输入的脚本,我用管道喂输入才能把输出原样记下来。下面贴的是你在终端里敲的时候会看到的样子:提示文字后面跟着你敲的字。

## 字符串是一串编号的字符

### 引号、长度和类型

Day 7 你已经用过字符串:引号括起来的一段文字。今天换个角度看它:Python 把字符串看成**一排字符,每个字符有一个编号**。先用最熟悉的那张工单把基本性质过一遍。新建 `part01/str_basics.py`:

```python
# agent-zero-lab/part01/str_basics.py
ticket = "T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次"
print(ticket)
print(type(ticket))
print(len(ticket))
print(len("计费"), len("abc"), len(""))

note = '客户说:"我被扣了两次"'
print(note)

multi = """第一行
第二行"""
print(multi)
print(len(multi))
```

<div class="line-notes">

- `ticket = "T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次"` Day 5 那张 T001,整行当成一个字符串存进 `ticket`。双引号单引号都行,Python 里没有区别,和 JS 一样。
- `print(type(ticket))` 看类型。
- `print(len(ticket))` `len()` 是 Python 内置函数,返回字符串里有几个字符,相当于 JS 的 `ticket.length`。注意写法不同:Python 是把字符串**放进**括号里的函数,不是点出来的属性。
- `print(len("计费"), len("abc"), len(""))` 一个汉字、一个字母、一个空格各算一个字符。空字符串长度 0。
- `note = '客户说:"我被扣了两次"'` 字符串里面要出现双引号,外面就用单引号包。里面外面用不同的引号,就不用转义。
- `multi = """第一行` 三个引号开头,可以直接换行,一直到下一个三个引号才结束。写长提示词时会天天用到。
- `print(len(multi))` 第一行 3 个字、换行符 1 个、第二行 3 个字,共 7。换行本身也是一个字符。

</div>

```text
$ cd ~/agent-zero-lab
$ uv run python part01/str_basics.py
T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次
<class 'str'>
39
2 3 0
客户说:"我被扣了两次"
第一行
第二行
7
```

<div class="line-notes">

- `T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次` 原样打印。
- `<class 'str'>` 类型是 `str`,string 的缩写。
- `39` 整行 39 个字符。数一遍:`T001` 四个、空格一个、`计费` 两个、空格、`C023` 四个、空格,后面是描述。别手数,让 `len` 数,但要知道它数的是字符不是字节(Day 16 会专门讲这个区别)。
- `2 3 0` 「计费」2 个,「abc」3 个,空串 0 个。
- `客户说:"我被扣了两次"` 里面的双引号原样打印出来。
- `第一行` / `第二行` 三引号字符串里的换行,`print` 时真的换了行。
- `7` 说明换行符确实占一个字符。

</div>

在 JS 里 `"计费".length` 也是 2,看起来一样。但 JS 的 `length` 数的是 UTF-16 码元,遇到 emoji 会多算,Python 的 `len` 数的是真正的字符:

```text
$ node -e '
console.log("abc".length);
console.log("计费".length);
console.log("😀".length);
'
3
2
2
```

<div class="line-notes">

- `console.log("abc".length);` 三个字母,3。
- `console.log("计费".length);` 两个汉字,2,和 Python 的 `len("计费")` 一样。
- `console.log("😀".length);` 一个 emoji,JS 说 2。我同样在 Python 里跑了 `len("😀")`,得到 1。差别来自 JS 内部用两个 16 位单元存这个 emoji。平时处理中文不会碰到,处理带 emoji 的用户留言时要记得有这么回事。

</div>

### 字符串不能原地改

JS 里字符串也是不能改的,但 JS 对你的态度很温和:给它赋值,它假装没听见,也不报错。Python 不一样,它会直接报错:

```text
$ node -e '
let s = "abc";
s[0] = "X";
console.log(s);
'
abc
```

<div class="line-notes">

- `let s = "abc";` 字符串变量。
- `s[0] = "X";` 想把第一个字符改成 X。JS 默认模式下这一句什么都不做,也不报错。
- `console.log(s);` 打印 `abc`,没改成功。你以为改了,其实没有。Python 宁可当场报错,也不让你带着错误的想法继续往下写。

</div>

新建 `part01/str_immutable.py`,故意试一下:

```python
# agent-zero-lab/part01/str_immutable.py
ticket = "T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次"
ticket[0] = "X"
```

```text
$ uv run python part01/str_immutable.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/str_immutable.py", line 3, in <module>
    ticket[0] = "X"
    ~~~~~~^^^
TypeError: 'str' object does not support item assignment
```

<div class="line-notes">

- `ticket[0] = "X"` 想把第一个字符 T 换成 X。方括号里的 `0` 就是编号,下一节讲。
- `~~~~~~^^^` 波浪线和尖号是 Python 3.12 画出来的指示,指向出事的位置,就是 `ticket[0]` 这一段。
- `TypeError: 'str' object does not support item assignment` 字符串对象不支持「按编号赋值」。意思是这个字符串**造好以后就不能改**,想要不一样的,只能造一个新字符串。这个性质叫「不可变」。后面几乎所有字符串方法都是返回新字符串,原来的纹丝不动,明天会反复看到这一点。

</div>

basedpyright 在 Zed 里还没跑就给这一行画了红线(`"__setitem__" method not defined on type ...`),说的是同一件事。

## 索引:按编号取一个字符

### 从 0 数,也可以从末尾数

字符串里每个字符有两个编号:从左往右是 0、1、2……,从右往左是 -1、-2、-3……。下面这张图是工单行前 12 个字符。上面一排是正着数的编号,下面一排是倒着数的:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="字符串 T001 计费 C023 的前 12 个字符,上方标正向编号 0 到 11,下方标负向编号 -12 到 -1,下方用括号标出三个切片 0 到 4、5 到 7、8 到 12">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="13" text-anchor="middle">
<text x="14" y="30" fill="var(--ink-faint)" text-anchor="start">正着数</text>
<g fill="var(--ink-soft)">
<text x="52" y="58">0</text><text x="102" y="58">1</text><text x="152" y="58">2</text><text x="202" y="58">3</text><text x="252" y="58">4</text><text x="302" y="58">5</text><text x="352" y="58">6</text><text x="402" y="58">7</text><text x="452" y="58">8</text><text x="502" y="58">9</text><text x="552" y="58">10</text><text x="602" y="58">11</text>
</g>
<g stroke="var(--mem)" fill="var(--mem-wash)">
<rect x="28" y="68" width="48" height="40" rx="4"/><rect x="78" y="68" width="48" height="40" rx="4"/><rect x="128" y="68" width="48" height="40" rx="4"/><rect x="178" y="68" width="48" height="40" rx="4"/>
</g>
<rect x="228" y="68" width="48" height="40" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
<g stroke="var(--compute)" fill="var(--compute-wash)">
<rect x="278" y="68" width="48" height="40" rx="4"/><rect x="328" y="68" width="48" height="40" rx="4"/>
</g>
<rect x="378" y="68" width="48" height="40" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
<g stroke="var(--mem)" fill="var(--mem-wash)">
<rect x="428" y="68" width="48" height="40" rx="4"/><rect x="478" y="68" width="48" height="40" rx="4"/><rect x="528" y="68" width="48" height="40" rx="4"/><rect x="578" y="68" width="48" height="40" rx="4"/>
</g>
<g fill="var(--ink)" font-size="16">
<text x="52" y="94">T</text><text x="102" y="94">0</text><text x="152" y="94">0</text><text x="202" y="94">1</text><text x="252" y="94">·</text><text x="302" y="94">计</text><text x="352" y="94">费</text><text x="402" y="94">·</text><text x="452" y="94">C</text><text x="502" y="94">0</text><text x="552" y="94">2</text><text x="602" y="94">3</text>
</g>
<g fill="var(--ink-soft)">
<text x="52" y="128">-12</text><text x="102" y="128">-11</text><text x="152" y="128">-10</text><text x="202" y="128">-9</text><text x="252" y="128">-8</text><text x="302" y="128">-7</text><text x="352" y="128">-6</text><text x="402" y="128">-5</text><text x="452" y="128">-4</text><text x="502" y="128">-3</text><text x="552" y="128">-2</text><text x="602" y="128">-1</text>
</g>
<text x="14" y="150" fill="var(--ink-faint)" text-anchor="start">倒着数</text>
<g stroke="var(--ink-soft)" fill="none">
<path d="M28 166 v8 h198 v-8"/><path d="M278 166 v8 h98 v-8"/><path d="M428 166 v8 h198 v-8"/>
</g>
<g fill="var(--ink)" text-anchor="middle">
<text x="127" y="194">s[0:4]</text><text x="327" y="194">s[5:7]</text><text x="527" y="194">s[8:12]</text>
</g>
<g fill="var(--ink-soft)" font-size="12">
<text x="127" y="214">T001</text><text x="327" y="214">计费</text><text x="527" y="214">C023</text>
</g>
<text x="14" y="240" fill="var(--ink-faint)" text-anchor="start" font-size="11">·表示空格。切片的终点那个编号对应的字符不在结果里</text>
</g>
</svg>
<figcaption>每个字符两个编号。切片 s[0:4] 取 0、1、2、3 号,不含 4 号,所以刚好是 T001。</figcaption>
</figure>

### 用 [] 取单个字符

新建 `part01/index_demo.py`:

```python
# agent-zero-lab/part01/index_demo.py
ticket = "T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次"
print(ticket[0])
print(ticket[1])
print(ticket[5])
print(ticket[-1])
print(ticket[-2])
print(ticket[len(ticket) - 1])
```

<div class="line-notes">

- `print(ticket[0])` 取 0 号字符。方括号里写编号,这个写法和 JS 的 `ticket[0]` 一样。
- `print(ticket[1])` 1 号。
- `print(ticket[5])` 5 号,是中文的「计」,一个汉字就是一个字符。
- `print(ticket[-1])` 负数从末尾数,-1 是最后一个字符。
- `print(ticket[-2])` 倒数第二个。
- `print(ticket[len(ticket) - 1])` 不用负数的老写法:总长度 39 减 1,取 38 号,也是最后一个字符。JS 里取最后一个字符就是这么写的(`s[s.length - 1]`);Python 的 `-1` 省掉了这层计算。

</div>

```text
$ uv run python part01/index_demo.py
T
0
计
次
两
次
```

<div class="line-notes">

- `T` 0 号。
- `0` 1 号是数字 0,不是字母 O。T001 里 T 后面跟的是三个数字。
- `计` 5 号。
- `次` `-1` 号,工单最后一个字。
- `两` `-2` 号。
- `次` 第三种写法,和第一种得到同一个字。

</div>

和 JS 对照一下。JS 里 `-1` 不能这样用,新版有个 `.at(-1)` 专门干这事:

```text
$ node -e '
const t = "T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次";
console.log(t[0]);
console.log(t.at(-1));
console.log(t[100]);
console.log(t.slice(0, 4));
console.log(t.slice(-5));
console.log(t.slice(100, 200) === "");
'
T
次
undefined
T001
被扣了两次
true
```

<div class="line-notes">

- `const t = "T001` 同一张工单,JS 里用 `const` 声明变量。
- `console.log(t[0]);` 取第一个字符,得 `T`,和 Python 一样。
- `console.log(t.at(-1));` JS 2022 年加的方法,负数从末尾数,得 `次`。老写法 `t[t.length - 1]` 啰嗦,所以后来补了这个。
- `console.log(t[100]);` 超出长度,JS 不报错,给你 `undefined`。这是 JS 和 Python 最容易吵起来的地方,下面马上演示 Python 怎么处理。
- `console.log(t.slice(0, 4));` 得 `T001`,和 Python 的 `ticket[0:4]` 完全一样,下一节讲。
- `console.log(t.slice(-5));` 得 `被扣了两次`,对应 Python 的 `ticket[-5:]`。
- `console.log(t.slice(100, 200) === "");` 截一段不存在的区域,得到空字符串,所以是 `true`。这一点两边也一样。
- `T` / `次` 输出的前两行,就是 `t[0]` 和 `t.at(-1)` 的结果。
- `undefined` 越界的 `t[100]`。

</div>

### 越界会报错:IndexError

JS 越界给 `undefined`,然后你的程序在下一行用到它时才炸,炸的位置离原因很远。Python 当场就报错。新建 `part01/index_error.py`:

```python
# agent-zero-lab/part01/index_error.py
ticket = "T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次"
print(len(ticket))
print(ticket[len(ticket)])
```

<div class="line-notes">

- `print(len(ticket))` 先打印长度 39,心里有数。
- `print(ticket[len(ticket)])` 取 39 号。可编号是从 0 开始的,有 39 个字符的字符串,最后一个编号是 38,39 号根本不存在。这是所有语言里最经典的错误:差一(off-by-one)。

</div>

```text
$ uv run python part01/index_error.py
39
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/index_error.py", line 4, in <module>
    print(ticket[len(ticket)])
          ~~~~~~^^^^^^^^^^^^^
IndexError: string index out of range
```

<div class="line-notes">

- `39` 长度。
- `~~~~~~^^^` 指示条标出的是整个 `ticket[len(ticket)]`。
- `IndexError: string index out of range` 编号超出范围。`IndexError` 这个名字就是「索引错误」。记住规律:**长度为 n 的字符串,合法的编号是 0 到 n-1,以及 -n 到 -1。**

</div>

最后一个字符取 `ticket[-1]` 就不会差一。Agent 代码里经常要「取模型回复的最后一个字」「看最后一条消息」,负数索引用得极多。

## 切片:截出一段

### s[a:b],左闭右开

取一段用 `s[起点:终点]`。规则只有一条:**包含起点,不包含终点**,数学上叫左闭右开,写作 [起点, 终点)。图里那三个括号就是它的样子:`s[0:4]` 取 0、1、2、3 号,4 号不要,所以是 `T001`;`s[5:7]` 取 5、6 号,是「计费」;`s[8:12]` 取 8 到 11 号,是 `C023`。

为什么要这样设计?有两个好处:`s[a:b]` 的长度正好是 `b - a`(4 - 0 = 4 个字符);而且 `s[:4] + s[4:]` 正好等于整个 `s`,两段接在一起没有重叠也没有缝隙。JS 的 `slice(a, b)` 是同样的规则,你已经习惯了。

新建 `part01/slice_demo.py`:

```python
# agent-zero-lab/part01/slice_demo.py
ticket = "T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次"
print(ticket[0:4])
print(ticket[5:7])
print(ticket[8:12])
print(ticket[13:])
print(ticket[:4])
print(ticket[-5:])
print(ticket[:-5])
print(ticket[100:200] == "")
print(ticket[::2])
print("abc"[::-1])
```

<div class="line-notes">

- `print(ticket[0:4])` 0 号到 3 号。
- `print(ticket[5:7])` 5、6 号,「计费」。
- `print(ticket[8:12])` 8 到 11 号,客户号。
- `print(ticket[13:])` 省掉终点,表示「一直到最后」。13 号是描述的第一个字「1」(`10月3日`的 1)。
- `print(ticket[:4])` 省掉起点,表示「从头开始」,等于 `ticket[0:4]`。
- `print(ticket[-5:])` 起点是负数:从倒数第 5 个字符开始,到末尾。倒数第 5 个是「被」(34 号)。
- `print(ticket[:-5])` 终点是负数:从头开始,到倒数第 5 个之前。也就是把最后 5 个字砍掉。
- `print(ticket[100:200] == "")` 起点终点都超出长度,不报错,得到空字符串 `""`,所以比较结果是 `True`。
- `print(ticket[::2])` 多了第三个数:步长。每隔一个取一个,0、2、4、6……号。
- `print("abc"[::-1])` 步长 -1,从后往前取,字符串倒过来。

</div>

```text
$ uv run python part01/slice_demo.py
T001
计费
C023
10月3日和10月5日各扣了一次299元,被扣了两次
T001
被扣了两次
T001 计费 C023 10月3日和10月5日各扣了一次299元,
True
T0 费C2 03和05各了次9元被了次
cba
```

<div class="line-notes">

- `T001` 工单号。
- `计费` 类别。
- `C023` 客户号。
- `10月3日和10月5日各扣了一次299元,被扣了两次` 从 13 号到结尾的描述。
- `T001` 和第一行一样。
- `被扣了两次` 最后五个字。
- `T001 计费 C023 10月3日和10月5日各扣了一次299元,` 去掉最后五个字,末尾留着那个逗号。`[:-5]` 和 `[-5:]` 刚好把字符串切成两半。
- `True` 越界切片是空字符串。
- `T0 费C2 03和05各了次9元被了次` 隔一个取一个:T、0、空格、费、C、2、空格、0、3……(0 号 T,2 号 0,4 号空格,6 号费,8 号 C,10 号 2,12 号空格,14 号 0,16 号 3)。
- `cba` 倒着读。

</div>

### 索引越界报错,切片越界不报错

两者放在一起对比,是今天最值得记住的一个区别:

| 写法 | 越界时 | 例子(长度 39) |
| --- | --- | --- |
| `s[i]` 取一个 | `IndexError` | `ticket[39]` 报错 |
| `s[a:b]` 取一段 | 悄悄截到边界,最多得 `""` | `ticket[100:200]` 得 `""` |

切片的宽容有好有坏。好处是「取前 10 个字」可以放心写 `s[:10]`,字符串不够 10 个字也不会炸;坏处是写错了也没人告诉你,得到一个空字符串,下游才出怪事。所以写切片以后,**要打印一下结果看看是不是你想要的那一段**。

### 用切片截工单行:工作量最大的一步

现在做第一个有用的东西:把一行工单文本拆成工单号、类别、客户号和描述。新建 `part01/ticket_card.py`:

```python
# agent-zero-lab/part01/ticket_card.py
line_a = "T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次"
line_b = "T005 登录 C031 Forgot password email never arrived"

line = line_a
ticket_id = line[0:4]
category = line[5:7]
customer = line[8:12]
desc = line[13:]
print(f"工单 {ticket_id} | 类别 {category} | 客户 {customer}")
print(f"描述:{desc}")
print(f"描述前 10 个字:{desc[:10]}...")

line = line_b
print(f"{line[0:4]} | {line[5:7]} | {line[8:12]}")
```

<div class="line-notes">

- `line_a = "T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次"` Day 5 里的 T001,存成变量。
- `line_b = "T005 登录 C031 Forgot password email never arrived"` T005,英文工单,字段位置一样。
- `line = line_a` 先处理 `line_a`。这里换个变量名,后面切的都是 `line`,换一张工单只改这一行。
- `ticket_id = line[0:4]` 0 到 3 号,`T001`。
- `category = line[5:7]` 5、6 号,`计费`。第 4 号是空格,跳过了。
- `customer = line[8:12]` 8 到 11 号,`C023`。
- `desc = line[13:]` 13 号到结尾。这里的 `desc` 是 description(描述)的缩写。
- `print(f"工单 {ticket_id} | 类别 {category} | 客户 {customer}")` 第一次用 f-string:字符串前面加个 `f`,花括号里的变量名换成它的值。下一节详细讲,这里先看效果。
- `print(f"描述:{desc}")` 描述整段打印。
- `print(f"描述前 10 个字:{desc[:10]}...")` 花括号里可以直接放表达式,这里是 `desc[:10]` 切片。字符串不够 10 个字也没事。
- `line = line_b` 换成 T005,同样的下标。
- `print(f"{line[0:4]} | {line[5:7]} | {line[8:12]}")` 花括号里放切片,不用先存变量。

</div>

```text
$ uv run python part01/ticket_card.py
工单 T001 | 类别 计费 | 客户 C023
描述:10月3日和10月5日各扣了一次299元,被扣了两次
描述前 10 个字:10月3日和10月5...
T005 | 登录 | C031
```

<div class="line-notes">

- `工单 T001 | 类别 计费 | 客户 C023` 三段都对。
- `描述:10月3日和10月5日各扣了一次299元,被扣了两次` 13 号以后。
- `描述前 10 个字:10月3日和10月5...` 前 10 个字符:`1`、`0`、`月`、`3`、`日`、`和`、`1`、`0`、`月`、`5`,正好 10 个。注意「10」是两个字符,不是一个数字,切片眼里只有字符。
- `T005 | 登录 | C031` 英文工单也截对了,因为前面三段格式一样。

</div>

这个方法有一个很脆弱的前提:**每个字段的位置和长度是固定的**。让我把工单号写成 T1000,四位数字,看会怎么样:

```python
# agent-zero-lab/part01/ticket_card_bad.py
line = "T1000 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次"
print(f"工单 {line[0:4]} | 类别 {line[5:7]} | 客户 {line[8:12]}")
```

<div class="line-notes">

- `line = "T1000 计费 C023` 工单号变成 5 位,后面所有字符的编号都往后挪了 1:空格在 5 号,「计」在 6 号,`C023` 在 9 到 12 号。
- `print(f"工单 {line[0:4]} | 类别 {line[5:7]} | 客户 {line[8:12]}")` 切片的数字还是 `ticket_card.py` 里那组,没跟着改。

</div>

```text
$ uv run python part01/ticket_card_bad.py
工单 T100 | 类别  计 | 客户  C02
```

<div class="line-notes">

- `工单 T100 | 类别  计 | 客户  C02` 三处都错了。`[0:4]` 只截到 `T100`,少了最后一个 0;`[5:7]` 现在取到「空格加计」,类别前面多了个空格,「费」丢了;`[8:12]` 取到「空格 C02」,少了 3。

</div>

没有报错,也没有警告,三个字段全错了。这是按固定位置切片的通病:数据格式一变,它不会告诉你,只会给你一个错的结果。明天学 `split()`,按空格切开,不管工单号几位都对。今天先明白切片的原理和它的边界:它适合格式写死、长度已知的东西,比如日期 `2026-10-23` 的前 4 个字符是年份;不适合格式会变的东西。

## f-string:把变量填进文字里

### 为什么不用 + 号拼

Day 14 里的 `print("应退:", refund_fen // 100, "元", ...)` 是用逗号分开传多个值给 `print`。要把变量拼进一个字符串里,老办法是用 `+`,但 `+` 只能连接字符串,数字要先 `str()`。新建 `part01/fstring_demo.py`:

```python
# agent-zero-lab/part01/fstring_demo.py
customer = "C023"
price_fen = 29900
times = 2

old_way = "客户 " + customer + " 被扣了 " + str(times) + " 次"
print(old_way)

print(f"客户 {customer} 被扣了 {times} 次")
print(f"应退 {price_fen * (times - 1) / 100} 元")
print(f"应退 {price_fen * (times - 1) / 100:.2f} 元")
print(f"含税 {price_fen * 113 // 100:,} 分")
print(f"工单 T{7:03d}")
print(f"{customer=}")
print(f"{{customer}} 是花括号,{customer} 才是变量")
print("没有 f 就不会替换 {customer}")
```

<div class="line-notes">

- `customer = "C023"` 客户号字符串。
- `price_fen = 29900` Day 12 的整数分,299 元。
- `times = 2` 扣了两次,一个整数。
- `old_way = "客户 " + customer + " 被扣了 " + str(times) + " 次"` 老办法:`+` 拼接,`times` 是整数,必须用 `str(times)` 转成字符串,否则报 `TypeError`。写一长句话要数着引号和加号,很容易漏空格。
- `print(old_way)` 打印拼好的结果。
- `print(f"客户 {customer} 被扣了 {times} 次")` f-string:字符串前面紧贴着加一个 `f`,里面用 `{}` 括起来的部分会被算出值再填进去。`{times}` 是整数也不用 `str()`,f-string 会自动转。
- `print(f"应退 {price_fen * (times - 1) / 100} 元")` 花括号里可以放任意表达式:29900 × (2 - 1) = 29900,除以 100 得 299.0。这里用 `/`(Day 12 讲过,结果永远是 float),所以显示 `299.0`。
- `print(f"应退 {price_fen * (times - 1) / 100:.2f} 元")` 在表达式后面加冒号和 `.2f`,意思是「按小数点后两位的浮点数显示」,得 `299.00`。冒号后面这一小段叫格式说明。
- `print(f"含税 {price_fen * 113 // 100:,} 分")` 冒号后面只写一个逗号,意思是整数部分每三位加一个千位分隔逗号。29900 × 113 // 100 = 33787。
- `print(f"工单 T{7:03d}")` `03d` 的意思是:`d` 是整数,`3` 是至少占 3 位,`0` 表示不够的补 0。7 变成 `007`。
- `print(f"{customer=}")` 变量名后面加个等号,打印出 `变量名=值`。调试时特别方便,不用再写 `print("customer", customer)`。
- `print(f"{{customer}} 是花括号,{customer} 才是变量")` 想让输出里出现花括号本身,要写成双层 `{{` 和 `}}`。同一行的 `{customer}` 仍然被替换成值。
- `print("没有 f 就不会替换 {customer}")` 忘了写前面的 `f`,花括号会原样打印出来。这是最常见的错误,没有任何报错。

</div>

```text
$ uv run python part01/fstring_demo.py
客户 C023 被扣了 2 次
客户 C023 被扣了 2 次
应退 299.0 元
应退 299.00 元
含税 33,787 分
工单 T007
customer='C023'
{customer} 是花括号,C023 才是变量
没有 f 就不会替换 {customer}
```

<div class="line-notes">

- 第一行和第二行 老办法和 f-string 得到同样的句子,f-string 读起来就是那句话本身。
- `应退 299.0 元` 没写格式,浮点数按默认样子显示,金额只有一位小数很难看。
- `应退 299.00 元` 加了 `:.2f`,固定两位。
- `含税 33,787 分` 三位分隔。
- `工单 T007` 补零。
- `customer='C023'` 名字、等号、值,字符串还带着引号,一眼能看出它是字符串。
- `{customer} 是花括号,C023 才是变量` 双层花括号输出一对花括号,单层的被替换。
- `没有 f 就不会替换 {customer}` 最后一行没替换。

</div>

对应的 JS 是模板字符串,用反引号和 `${}`:

```text
$ node -e '
const c = "C023";
const n = 2;
console.log(`客户 ${c} 被扣了 ${n} 次,应退 ${(29900 * (n - 1) / 100).toFixed(2)} 元`);
'
客户 C023 被扣了 2 次,应退 299.00 元
```

<div class="line-notes">

- `const c = "C023";` 客户号。
- `const n = 2;` 扣款次数。
- `console.log(` 模板字符串用反引号开头,变量写成 `${c}`。Python 用 `f"..."` 开头,变量写成 `{c}`,少一个美元符号。
- `客户 C023 被扣了 2 次,应退 299.00 元` JS 里要保留两位小数得调用方法 `.toFixed(2)`,Python 是在花括号里写 `:.2f`。输出和 Python 版一模一样。

</div>

JS 模板字符串里单行多行都能用反引号,Python 的 f-string 和三引号字符串配合:`f"""..."""` 就是多行的 f-string。

### 格式说明:冒号后面那一小段

冒号后面的东西叫**格式说明**,有一套固定的顺序。画成一张图:

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="f-string 格式说明 {amount:>16,.2f} 的拆解:冒号后依次是对齐方向 >、宽度 16、千位分隔 逗号、小数位数 .2f">
<rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="13">
<text x="20" y="34" fill="var(--ink-faint)">f"[{amount:&gt;16,.2f}]"</text>
<rect x="20" y="52" width="86" height="34" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
<text x="30" y="74" fill="var(--ink)">{amount</text>
<rect x="116" y="52" width="40" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="130" y="74" fill="var(--ink)">&gt;</text>
<rect x="166" y="52" width="46" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="178" y="74" fill="var(--ink)">16</text>
<rect x="222" y="52" width="40" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="238" y="74" fill="var(--ink)">,</text>
<rect x="272" y="52" width="60" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="284" y="74" fill="var(--ink)">.2f</text>
<text x="342" y="74" fill="var(--ink)">}</text>
<text x="20" y="116" fill="var(--ink-soft)">冒号前:要显示的值或表达式</text>
<text x="20" y="140" fill="var(--ink-soft)">&gt; 右对齐(&lt; 左,^ 居中) · 16 总共占 16 格</text>
<text x="20" y="164" fill="var(--ink-soft)">, 千位逗号 · .2f 浮点数保留两位小数</text>
<text x="20" y="194" fill="var(--ink-faint)">顺序固定:对齐 宽度 千位 .精度 类型。不需要的可以整段省掉</text>
</g>
</svg>
<figcaption>格式说明从左到右依次是:对齐、宽度、千位分隔、精度、类型,前面的省掉不影响后面的。</figcaption>
</figure>

新建 `part01/fstring_spec.py`,把一个带小数的金额按不同格式打一遍:

```python
# agent-zero-lab/part01/fstring_spec.py
amount = 1234567.891
rate = 0.13

print(f"[{amount}]")
print(f"[{amount:.2f}]")
print(f"[{amount:,.2f}]")
print(f"[{amount:>16,.2f}]")
print(f"[{rate:.0%}]")
print(f"[{3:.2f}]")
```

<div class="line-notes">

- `amount = 1234567.891` 一个有三位小数的大金额。
- `rate = 0.13` 税率,Day 12 的 13%,这次当小数用。
- `print(f"[{amount}]")` 什么格式都不写,原样显示。方括号是我加的,为了看清左右有没有空格。
- `print(f"[{amount:.2f}]")` 保留两位小数,四舍五入,第三位 1 舍掉。
- `print(f"[{amount:,.2f}]")` 逗号放在 `.2f` 前面,同时要千位分隔和两位小数。
- `print(f"[{amount:>16,.2f}]")` 再加 `>16`:总宽度 16 格,右对齐,不够的在左边补空格。
- `print(f"[{rate:.0%}]")` `%` 类型:把 0.13 乘 100 再加百分号,`.0` 表示不要小数。
- `print(f"[{3:.2f}]")` 整数也可以用 `.2f`,Python 自动当浮点数处理。

</div>

```text
$ uv run python part01/fstring_spec.py
[1234567.891]
[1234567.89]
[1,234,567.89]
[    1,234,567.89]
[13%]
[3.00]
```

<div class="line-notes">

- `[1234567.891]` 原样。
- `[1234567.89]` 第三位小数 1 被舍掉。
- `[1,234,567.89]` 千位逗号加上了。
- `[    1,234,567.89]` 宽度 16,数字本身占 12 格(含逗号和小数点),左边补 4 个空格。
- `[13%]` 0.13 变成 13%。
- `[3.00]` 整数 3 按两位小数显示。

</div>

再来一个只会发生一次的真实报错:把 `input()` 读来的字符串直接放进 `:.2f`。这是 Day 14 那个「读进来是字符串」的坑换了一个面孔出现:

```python
# agent-zero-lab/part01/fstring_str_error.py
price_text = "299"
print(f"单价 {price_text:.2f} 元")
```

<div class="line-notes">

- `price_text = "299"` 变量名带 `_text`,表示还是字符串(Day 14 的习惯)。
- `print(f"单价 {price_text:.2f} 元")` 对字符串用 `.2f`。

</div>

```text
$ uv run python part01/fstring_str_error.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/fstring_str_error.py", line 3, in <module>
    print(f"单价 {price_text:.2f} 元")
                 ^^^^^^^^^^^^^^^^
ValueError: Unknown format code 'f' for object of type 'str'
```

<div class="line-notes">

- `ValueError: Unknown format code 'f' for object of type 'str'` `f` 这个格式码只能用在数字上,字符串不认。修法:`float(price_text)` 转完再格式化。

</div>

### 对齐:中文会把空格算歪

`>8`、`<8` 这些对齐是按**字符个数**补空格的,可是汉字在终端里占两格宽,英文字母占一格。把中英文混在一列里,就对不齐。新建 `part01/fstring_align.py`:

```python
# agent-zero-lab/part01/fstring_align.py
print(f"[{'T001':<8}]")
print(f"[{'T001':>8}]")
print(f"[{'T001':^8}]")
print(f"[{'T001':*^8}]")
print(f"[{42:>8}]")
print(f"[{42:08}]")
print()
print(f"{'基础版':<8}|{49:>5}")
print(f"{'Starter':<8}|{468:>5}")
```

<div class="line-notes">

- `print(f"[{'T001':<8}]")` 注意花括号里面用单引号,外面的 f-string 用双引号,两种引号不冲突。`<8` 左对齐、占 8 格,右边补 4 个空格。
- `print(f"[{'T001':>8}]")` 右对齐,左边补空格。
- `print(f"[{'T001':^8}]")` 居中,左右各补 2 个。
- `print(f"[{'T001':*^8}]")` 对齐符前面可以放一个填充字符,这里用 `*` 代替空格。
- `print(f"[{42:>8}]")` 数字默认右对齐,所以对数字来说 `>` 可以省略。
- `print(f"[{42:08}]")` 宽度前面写 0,表示用 0 补齐,常用来做编号。
- `print(f"{'基础版':<8}|{49:>5}")` 「基础版」是 3 个字符,补 5 个空格到 8 个字符。
- `print(f"{'Starter':<8}|{468:>5}")` `Starter` 7 个字符,补 1 个空格。

</div>

```text
$ uv run python part01/fstring_align.py
[T001    ]
[    T001]
[  T001  ]
[**T001**]
[      42]
[00000042]

基础版     |   49
Starter |  468
```

<div class="line-notes">

- `[T001    ]` 4 个空格,总共 8 格。
- `[    T001]` 空格在左。
- `[  T001  ]` 居中。
- `[**T001**]` 星号当填充。
- `[      42]` 6 个空格加 `42`。
- `[00000042]` 前面补 0。
- `基础版     |   49` 和下一行对比。在等宽字体的终端里,「基础版」每个字占两格,所以这行比下一行的竖线靠右了 2 格。
- `Starter |  468` 竖线没对上。字符数是对齐的(都补到 8 个字符),显示宽度是歪的。

</div>

要排中文表格,别用手工空格对齐。Day 10 装过的 `rich` 会按显示宽度算,新建 `part01/align_rich.py`:

```python
# agent-zero-lab/part01/align_rich.py
from rich.console import Console
from rich.table import Table

table = Table()
table.add_column("套餐")
table.add_column("月付", justify="right")
table.add_row("基础版", "49")
table.add_row("Starter", "468")
Console().print(table)
```

<div class="line-notes">

- `from rich.console import Console` / `from rich.table import Table` 导入 Day 10 用过的表格工具。
- `table = Table()` 新建一张表。
- `table.add_column("月付", justify="right")` 加一列并要求右对齐,数字列习惯右对齐。
- `table.add_row("基础版", "49")` 加一行,内容都用字符串。
- `Console().print(table)` 打印。

</div>

```text
$ uv run python part01/align_rich.py
┏━━━━━━━━━┳━━━━━━┓
┃ 套餐    ┃ 月付 ┃
┡━━━━━━━━━╇━━━━━━┩
│ 基础版  │   49 │
│ Starter │  468 │
└─────────┴──────┘
```

<div class="line-notes">

- `│ 基础版  │   49 │` 「基础版」后面补了两个空格,`Starter` 后面没补,右边框和数字列都是齐的:`rich` 知道汉字占两格。

</div>

## 把今天的东西用到 ask_amount.py 上

Day 14 的 `ask_amount.py` 最后三行拼得很笨。这是 Day 14 建的文件,今天只改最后几行输出,前面读输入和转换的部分不动:

```python
# agent-zero-lab/part01/ask_amount.py
price_text = input("单价(元,可带小数):")
times_text = input("被扣了几次:")

price_fen = round(float(price_text) * 100)
times = int(times_text)

refund_fen = price_fen * (times - 1)
print(f"单价:{price_fen} 分({price_fen / 100:.2f} 元)")
print("需要退款:", times > 1)
print(f"应退:{refund_fen / 100:.2f} 元")
```

<div class="line-notes">

- `price_text = input("单价(元,可带小数):")` 没改。
- `times_text = input("被扣了几次:")` 没改。
- `price_fen = round(float(price_text) * 100)` 没改,仍然用整数分计算。
- `times = int(times_text)` 没改。
- `refund_fen = price_fen * (times - 1)` 没改。
- `print(f"单价:{price_fen} 分({price_fen / 100:.2f} 元)")` 单价同时打印分和元。这里 `price_fen / 100` 是浮点数除法,只用来显示,计算金额时一直用整数分,不会累积误差。
- `print("需要退款:", times > 1)` 没改。
- `print(f"应退:{refund_fen / 100:.2f} 元")` 一行搞定,替换掉原来的 `refund_fen // 100, "元", refund_fen % 100, "分"`。

</div>

19.99 元扣了 3 次、299 元扣了 2 次:

```text
$ uv run python part01/ask_amount.py
单价(元,可带小数):19.99
被扣了几次:3
单价:1999 分(19.99 元)
需要退款: True
应退:39.98 元
$ uv run python part01/ask_amount.py
单价(元,可带小数):299
被扣了几次:2
单价:29900 分(299.00 元)
需要退款: True
应退:299.00 元
```

<div class="line-notes">

- `单价:1999 分(19.99 元)` 19.99 乘 100 再 `round` 得 1999;1999 除以 100 显示成 `19.99`。
- `应退:39.98 元` 1999 × 2 = 3998 分,除以 100 得 39.98,`.2f` 两位。
- `单价:29900 分(299.00 元)` 整数 299 也显示成 `299.00`,金额看着统一。
- `应退:299.00 元` 和 Day 13 速算卡的答案一致,格式更像样了。

</div>

输入 `299元` 的老毛病还在:

```text
$ uv run python part01/ask_amount.py
单价(元,可带小数):299元
被扣了几次:2
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ask_amount.py", line 5, in <module>
    price_fen = round(float(price_text) * 100)
                      ^^^^^^^^^^^^^^^^^
ValueError: could not convert string to float: '299元'
```

这个今天不修。用切片能做出来(`price_text[:-1]` 去掉最后一个字符),但前提是你知道最后一个字符一定是「元」,用户要是没写「元」,切掉的就是个数字。靠位置猜内容不是好办法,明天学的 `removesuffix` 和 `replace` 才是正解。

写完检查一遍:

```text
$ uv run ruff check part01/index_demo.py part01/slice_demo.py part01/ticket_card.py part01/fstring_demo.py part01/fstring_spec.py part01/fstring_align.py part01/align_rich.py part01/ask_amount.py
All checks passed!
```

<div class="line-notes">

- `All checks passed!` 八个正常文件都通过。`str_immutable.py`、`index_error.py`、`ticket_card_bad.py`、`fstring_str_error.py` 是故意写错的,不在检查范围里。basedpyright 对 `str_immutable.py` 会报 `__setitem__` 那条,就是上面说的红线。

</div>

| 今天的零件 | 在 `ticket_card.py` / `ask_amount.py` 里是哪一步 |
| --- | --- |
| `len()` | 知道字符串有几个字符,合法编号是 0 到 n-1 |
| 正向编号和负向编号 | `[0:4]` 从头数,`[-5:]` 从尾数 |
| 切片 `[a:b]` 左闭右开 | `line[0:4]`、`line[5:7]`、`line[8:12]` |
| 省略起点或终点 | `line[13:]`、`desc[:10]` |
| 切片越界不报错 | `desc[:10]` 描述不够 10 个字也不炸 |
| f-string 基本用法 | `print(f"工单 {ticket_id} | ...")` |
| `:.2f` 两位小数 | `print(f"应退:{refund_fen / 100:.2f} 元")` |
| 固定位置切片的脆弱 | T1000 那个例子,明天用 `split()` |

## 动手练习

### 练习 1:先猜,再跑

下面这个脚本,先在纸上写出每一行 `print` 会输出什么,再跑。题目里的字符串是 T007,写在 `part01/ex1_guess.py` 里:

```python
# agent-zero-lab/part01/ex1_guess.py
s = "T007 功能 C015 希望发票抬头能改成英文"
print(s[0])
print(s[-1])
print(s[5:7])
print(s[8:])
print(s[-4:])
print(s[:4] + s[8:12])
print(len(s[13:]))
```

<details><summary>参考答案</summary>

先数编号:`T007 功能 C015 希望发票抬头能改成英文`,0 到 3 号是 `T007`,4 号空格,5、6 号「功能」,7 号空格,8 到 11 号 `C015`,12 号空格,13 号起是「希望发票抬头能改成英文」。

```text
$ uv run python part01/ex1_guess.py
T
文
功能
C015 希望发票抬头能改成英文
改成英文
T007C015
11
```

<div class="line-notes">

- `T` `s[0]` 第一个字符。
- `文` `s[-1]` 最后一个字,「英文」的「文」。
- `功能` `s[5:7]` 5、6 号。
- `C015 希望发票抬头能改成英文` `s[8:]` 从 8 号到结尾,包括中间的空格。
- `改成英文` `s[-4:]` 最后 4 个字符。
- `T007C015` `s[:4] + s[8:12]`:两段切片用 `+` 接起来,中间的类别和空格没有了。字符串相加得到新字符串,Day 14 里 `"2" * 3` 那个坑的同类。
- `11` `s[13:]` 是「希望发票抬头能改成英文」,数一遍:希、望、发、票、抬、头、能、改、成、英、文,11 个字。

</div>

如果有哪一行猜错,回到上面那张图,把编号一个一个标出来再数。差一是最常见的错:`s[5:7]` 有人猜成 3 个字,实际是 7 - 5 = 2 个。

</details>

### 练习 2:截出工单号,算下一张

Day 5 追加的最后一张工单是 `T009 计费 C031 续费后发票没有发到邮箱`。写 `part01/ex2_next_id.py`:从这行文字里截出数字部分(`009`),转成整数,加 1,再用 f-string 补零排回 `T010` 这样的格式。打印三行:最后一张的编号、下一张的编号、下一张的完整开头。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex2_next_id.py
last = "T009 计费 C031 续费后发票没有发到邮箱"

number = int(last[1:4])
next_number = number + 1
next_id = f"T{next_number:03d}"

print(f"最后一张是 {last[:4]},编号 {number}")
print(f"下一张的编号:{next_id}")
print(f"下一张的完整开头:{next_id} 计费 C042")
```

<div class="line-notes">

- `last = "T009 计费 C031 续费后发票没有发到邮箱"` Day 5 追加的那张工单。
- `number = int(last[1:4])` 从里往外读:`last[1:4]` 取 1、2、3 号,是 `"009"`(字符串);`int("009")` 把它转成整数 9。Day 14 的内容:`int()` 认前导的 0。
- `next_number = number + 1` 整数才能加,9 + 1 得 10。
- `next_id = f"T{next_number:03d}"` 前面的 `T` 原样,`{next_number:03d}` 把 10 补成三位 `010`,所以是 `T010`。
- `print(f"最后一张是 {last[:4]},编号 {number}")` 花括号里放切片 `last[:4]`,得 `T009`;`{number}` 是整数 9。
- `print(f"下一张的编号:{next_id}")` 打印 `T010`。
- `print(f"下一张的完整开头:{next_id} 计费 C042")` 拼出下一张工单的开头,假设它是 C042 的计费工单。

</div>

```text
$ uv run python part01/ex2_next_id.py
最后一张是 T009,编号 9
下一张的编号:T010
下一张的完整开头:T010 计费 C042
```

<div class="line-notes">

- `最后一张是 T009,编号 9` 切出 `T009`,编号 `009` 转成了整数 9,前导零没了。
- `下一张的编号:T010` 9 + 1 = 10,补零成三位。
- `下一张的完整开头:T010 计费 C042` 拼接结果。

</div>

这里的 `[1:4]` 又是固定位置。现实里工单到 T1000 就是四位数,`[1:4]` 会截成 `100`,和上面 `ticket_card_bad.py` 一样悄悄出错。所以真正的系统不会靠切片管编号,编号由数据库自动生成,明天学了 `split()` 和 `removeprefix()` 后你会有更稳的办法。

</details>

### 练习 3:把报价单排整齐

Day 13 的团队 5 席位年付报价,金额都是整数分:月付 4900 分/席位/月,年付 46800 分/席位/年,税率 13%。写 `part01/ex3_quote.py`,打印一张对齐的报价单:标题一行,下面五行依次是年付、月付(按 12 个月算)、省了多少、税额、含税合计,所有金额用 `元`,带千位逗号、两位小数,数字右对齐。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex3_quote.py
seats = 5
price_month_fen = 4900
price_year_fen = 46800

pay_yearly_fen = price_year_fen * seats
pay_monthly_fen = price_month_fen * 12 * seats
tax_fen = pay_yearly_fen * 13 // 100
total_fen = pay_yearly_fen + tax_fen

print(f"团队 {seats} 席位 年付报价单")
print(f"  年付   {pay_yearly_fen / 100:>10,.2f} 元")
print(f"  月付   {pay_monthly_fen / 100:>10,.2f} 元")
print(f"  省     {(pay_monthly_fen - pay_yearly_fen) / 100:>10,.2f} 元")
print(f"  税 13% {tax_fen / 100:>10,.2f} 元")
print(f"  含税   {total_fen / 100:>10,.2f} 元")
```

<div class="line-notes">

- `seats = 5` 席位数。
- `price_month_fen = 4900` 月付单价 49 元,用分。
- `price_year_fen = 46800` 年付单价 468 元。
- `pay_yearly_fen = price_year_fen * seats` 年付总额 234000 分。
- `pay_monthly_fen = price_month_fen * 12 * seats` 月付一年总额:4900 × 12 × 5 = 294000 分。
- `tax_fen = pay_yearly_fen * 13 // 100` 税额。先乘 13 再整除 100(Day 12 的顺序,避免浮点误差):234000 × 13 = 3042000,整除 100 得 30420 分。
- `total_fen = pay_yearly_fen + tax_fen` 含税合计 264420 分。
- `print(f"团队 {seats} 席位 年付报价单")` 标题。
- `print(f"  年付   {pay_yearly_fen / 100:>10,.2f} 元")` 数字部分 `>10,.2f`:占 10 格、右对齐、千位逗号、两位小数。234000 / 100 = 2340.0,显示 `2,340.00`,前面补 2 个空格。
- `print(f"  月付   {pay_monthly_fen / 100:>10,.2f} 元")` 2940.00。
- `print(f"  省     {(pay_monthly_fen - pay_yearly_fen) / 100:>10,.2f} 元")` 花括号里可以放带括号的算式:(294000 - 234000) / 100 = 600。
- `print(f"  税 13% {tax_fen / 100:>10,.2f} 元")` 304.20。花括号外面的 `13%` 是普通文字,百分号在 f-string 的花括号外没有特殊含义。
- `print(f"  含税   {total_fen / 100:>10,.2f} 元")` 2644.20。

</div>

```text
$ uv run python part01/ex3_quote.py
团队 5 席位 年付报价单
  年付     2,340.00 元
  月付     2,940.00 元
  省         600.00 元
  税 13%     304.20 元
  含税     2,644.20 元
```

<div class="line-notes">

- `团队 5 席位 年付报价单` 标题。
- `  年付     2,340.00 元` 和 Day 13 速算卡的 2340 元一致。
- `  月付     2,940.00 元` 月付一年 49 × 12 × 5 = 2940。
- `  省         600.00 元` 和 Day 13 里「比月付省 600 元」一致。
- `  税 13%     304.20 元` 234000 分 × 13% = 30420 分 = 304.20 元。
- `  含税     2,644.20 元` 和 Day 13 的 `2644 元 20 分` 一致,小数点后两位,同一列的小数点对齐。

</div>

标签那几个字(年付、月付)我特意用空格补齐,因为每行标签都是两个汉字加空格,宽度恰好一样。如果标签长短不一,就会像上面 `基础版` 和 `Starter` 那样歪,那时请用 rich 的表格。

</details>

### 练习 4:找三个错

下面的 `part01/ex4_bug.py` 有三处错误,它们的症状各不相同:一行打印出来的东西不对但没报错,一行会报错,还有一个藏在切片里。先看代码,预测第一次运行的结果,再运行,再逐个修好:

```python
# agent-zero-lab/part01/ex4_bug.py
line = "T003 计费 C015 想把月付改成年付,差价怎么算"
ticket_id = line[0:3]
customer = line[8:12]
print("工单 {ticket_id} 的客户是 {customer}")
last_char = line[len(line)]
print(f"最后一个字:{last_char}")
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex4_bug.py
工单 {ticket_id} 的客户是 {customer}
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex4_bug.py", line 6, in <module>
    last_char = line[len(line)]
                ~~~~^^^^^^^^^^^
IndexError: string index out of range
```

<div class="line-notes">

- `工单 {ticket_id} 的客户是 {customer}` 第一个错:这行字符串前面没有 `f`,花括号原样打印。没有任何报错,最危险的一种。
- `ex4_bug.py", line 6` 第二个错出在第 6 行,取最后一个字。
- `last_char = line[len(line)]` 报错指示的那一行:`len(line)` 是 27,最后一个编号是 26,`line[27]` 超界了。
- `IndexError: string index out of range` 差一。

</div>

还有第三个错藏在第 3 行,它既不报错也不会让输出看起来奇怪,只是少了东西:`ticket_id = line[0:3]` 得到的是 `T00`,不是 `T003`,终点少写了 1。只有修好第一个错以后,打印出 `工单 T00 的客户是 C015`,才看得出来。

修好的 `part01/ex4_fixed.py`:

```python
# agent-zero-lab/part01/ex4_fixed.py
line = "T003 计费 C015 想把月付改成年付,差价怎么算"
ticket_id = line[0:4]
customer = line[8:12]
print(f"工单 {ticket_id} 的客户是 {customer}")
last_char = line[-1]
print(f"最后一个字:{last_char}")
```

<div class="line-notes">

- `ticket_id = line[0:4]` 终点从 3 改成 4:要取 0、1、2、3 号四个字符,左闭右开,终点得写 4。
- `customer = line[8:12]` 没问题,8 到 11 号是 `C015`。
- `print(f"工单 {ticket_id} 的客户是 {customer}")` 补上 `f`,变量被替换成了 `T003` 和 `C015`。
- `last_char = line[-1]` 最后一个字符用 `-1`,不用算长度,不会差一。

</div>

```text
$ uv run python part01/ex4_fixed.py
工单 T003 的客户是 C015
最后一个字:算
```

<div class="line-notes">

- `工单 T003 的客户是 C015` 三处都对。
- `最后一个字:算` 「差价怎么算」的最后一个字。

</div>

三个错的共同点是 Python 都「不太管」:缺了 `f` 不报错、切片短了不报错,只有索引越界会报错。写完拿到结果,要对一遍,看看是不是你想要的。

</details>

练习的验收标准:`str_basics.py`、`index_demo.py`、`slice_demo.py`、`ticket_card.py`、`fstring_demo.py`、`fstring_spec.py`、`ask_amount.py` 和四道练习都能跑,输出和文中一致;能不看文章说出 `s[a:b]` 取哪几号字符、`s[-1]` 是什么、为什么 `ticket[39]` 报错而 `ticket[100:200]` 不报错;能默写 `ticket_card.py`;能用 `:.2f`、`:,`、`:03d` 各写一个例子。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 字符串(str) | 一串字符,Python 里用引号括起来,类型叫 `str`;对应 JS 的 string |
| 字符 | 字符串里的一个单位,一个字母、一个汉字、一个空格、一个换行都算一个 |
| `len()` | 内置函数,返回字符串(以及后面学的列表)的长度。JS 里是 `.length` 属性 |
| 索引(index) | 字符的编号,从 0 开始;`s[0]` 取第一个。负数从末尾数,`s[-1]` 是最后一个 |
| 切片(slice) | 用 `s[a:b]` 截取一段,返回新字符串;对应 JS 的 `slice(a, b)` |
| 左闭右开 | 区间包含起点、不包含终点,写作 [a, b);`s[0:4]` 取 0、1、2、3 号 |
| 步长(step) | 切片的第三个数,`s[::2]` 隔一个取一个,`s[::-1]` 倒过来 |
| 不可变(immutable) | 造好就不能改。字符串不能 `s[0] = "X"`,要改只能造新的 |
| `IndexError` | 索引超出范围时的错误,`string index out of range` |
| 差一错误(off-by-one) | 编号或终点偏了 1 的错,最常见于从 0 开始数和切片的终点 |
| 三引号字符串 | 用 `"""` 括起来的字符串,可以直接换行,常用来写长提示词 |
| f-string | 前面加 `f` 的字符串,花括号里的变量或表达式会被算出来填进去;对应 JS 的模板字符串 |
| 格式说明 | f-string 花括号里冒号后面的部分,如 `:.2f`、`:,`、`:>8`、`:03d` |
| `rich` | Day 10 装的终端美化库,中文表格靠它按显示宽度对齐 |

## 常见误区

**以为编号从 1 开始。** `s[1]` 是第二个字符。第一个是 `s[0]`。长度为 n 的字符串,最后一个编号是 n-1,不是 n。

**切片的终点那个字符也想要。** `s[0:4]` 不含 4 号。想要 4 个字符,终点就是起点加 4。

**把切片当索引,以为越界会报错。** `s[100:200]` 不报错,得 `""`。出现「怎么是空的」,先想是不是切片越界了。

**忘了 f-string 前面的 `f`。** `"{customer}"` 会原样打印花括号,没有任何报错。排查时看输出里有没有出现没被替换的 `{xxx}`。

**对字符串用 `:.2f`。** 报 `ValueError: Unknown format code 'f' for object of type 'str'`。从 `input()` 读来的是字符串,先 `float()` 再格式化。

**用手工空格对齐中文。** 汉字占两格宽,空格按字符数补,对不齐。要排表格用 `rich`。

**拿 `/` 算金额再格式化,以为这就精确了。** `:.2f` 只是显示时四舍五入,真正的计算要用整数分。`refund_fen / 100` 只用在最后打印的一刻。

**用固定位置切片处理会变的格式。** 工单号一变长,所有字段一起错位,还不报错。明天会学更稳的 `split()`。

**以为 `ticket[0] = "X"` 能改字符串。** TypeError。字符串不可变,所有「改」都是造新字符串。

## 学习资料

### 文档与文章

- [Python 教程 · 数字、文本](https://docs.python.org/zh-cn/3.12/tutorial/introduction.html#text):中文,官方教程里讲字符串的那一节:引号、三引号、索引、切片、`len()`。切片那几个例子配了一张画着正向和反向编号的小图,和今天的图是一个意思,读一遍官方的说法。
- [格式化字符串字面值(f-string)](https://docs.python.org/zh-cn/3.12/reference/lexical_analysis.html#f-strings):中文,f-string 的正式语法。今天用到的 `=`、`{{`、`:` 都在里面,读开头几段即可,后面的语法细节不用管。
- [格式规格迷你语言](https://docs.python.org/zh-cn/3.12/library/string.html#format-specification-mini-language):中文,`:>8`、`:,`、`:.2f`、`:03d` 所有写法的正式说明,今天那张图的完整版。当字典查。
- [PEP 498 · Literal String Interpolation](https://peps.python.org/pep-0498/):英文,2015 年提出 f-string 的提案,开头的「Rationale」讲了为什么要在 `%` 和 `.format()` 之外再加一个。读开头两段就够。
- [MDN · String.prototype.slice()](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/String/slice):中文,JS 的 `slice`。看它负数参数的规则,和 Python 的切片是同一套。
- [MDN · 模板字符串](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Template_literals):中文,JS 的反引号和 `${}`,和 f-string 对照。
- [Real Python · Python's F-String for String Interpolation and Formatting](https://realpython.com/python-f-strings/):英文,对爬虫返回 403,需要浏览器打开。f-string 的详细教程,例子很多。读前半部分就足够今天用。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Fa4y1W7CG&autoplay=0&high_quality=1" title="【选集】Python3.9入门教程 之 字符串切片操作" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AniPython · 【选集】Python3.9入门教程 之 字符串切片操作 · 10 分钟,2020 年,播放 5 万。专讲切片,正向、反向、步长都有现场演示,讲得很慢。视频里的编辑器和我们不同,看切片规则。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV18x4y1b7kf&autoplay=0&high_quality=1" title="2-5四分钟搞懂python的f-string" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员陈雷雷 · 2-5四分钟搞懂python的f-string · 4 分钟,2024 年。短,只讲 f-string 的基本写法和 `:.2f` 这类格式,看完马上能用。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/k9TUPpGqYTo" title="Python Tutorial for Beginners 2: Strings - Working with Textual Data" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial for Beginners 2: Strings · 英文,可开自动字幕。讲字符串的索引、切片、常用方法和 f-string。录得比较早,里面格式化字符串用的是 `.format()`,对照今天学的 f-string 看就行;索引和切片的部分和今天一致,方法部分留到明天再看更合适。</figcaption>
</figure>

### 书籍

- Eric Matthes《Python Crash Course》第 3 版,No Starch Press,2023(中译《Python编程:从入门到实践》)。第 2 章「Variables and Simple Data Types」里有字符串和 f-string 的内容,第一遍只读这一节。
- Allen B. Downey《Think Python》第 3 版,O'Reilly,2024,[免费在线版](https://allendowney.github.io/ThinkPython/)。第 8 章 Strings and Regular Expressions 的前半章讲 `len`、索引、切片、不可变,例子很清楚;后半章的正则表达式现在不用看。

### 开源项目与代码

- [satwikkansal/wtfpython](https://github.com/satwikkansal/wtfpython):Day 12 推荐过。搜 `String` 相关的几节,有字符串驻留(`is` 和 `==` 的区别)这类反直觉例子,看懂了说明你对字符串的理解到位;看不懂的先跳过。
- [Asabeneh/30-Days-Of-Python](https://github.com/Asabeneh/30-Days-Of-Python):英文,「Day 4 Strings」一章,每个知识点配一两行例子和练习,可以对照今天的内容再做一遍。

## 自测

1. `s = "云簿CloudLedger"`。`len(s)`、`s[0]`、`s[-1]`、`s[2:7]` 各是什么?

<details><summary>答案</summary>

「云簿」2 个字,`CloudLedger` 11 个字母,共 13 个字符,所以 `len(s)` 是 13。`s[0]` 是「云」。`s[-1]` 是最后一个字母 `r`。`s[2:7]` 取 2 到 6 号,即 `Cloud`。

</details>

2. `s[a:b]` 为什么设计成不包含终点?写出它带来的两个好处。

<details><summary>答案</summary>

一是长度直接等于 `b - a`,`s[0:4]` 是 4 个字符。二是 `s[:n] + s[n:]` 正好等于整个字符串,两段不重叠也没缝,按任意位置拆开再拼回去都对得上。

</details>

3. 为什么 `ticket[39]`(`ticket` 长度 39)报 `IndexError`,而 `ticket[39:]` 和 `ticket[100:200]` 不报错?

<details><summary>答案</summary>

索引要取具体的一个字符,39 号不存在,没东西可取,只能报错。切片取的是一段区间,和字符串存在的部分求交集就行,交集为空就返回 `""`,没有哪个动作是「取不到」的。

</details>

4. 下面的 f-string 各有什么毛病?`f"应退 {refund_fen / 100:.2f 元}"`、`"应退 {refund_fen} 分"`、`f"单价 {input('单价:'):.2f}"`。

<details><summary>答案</summary>

第一个把「元」写进了花括号里,`.2f 元` 不是合法的格式说明,会报 `ValueError: Invalid format specifier`。「元」应该写在花括号外面。第二个忘了开头的 `f`,花括号原样打印,不报错。第三个对 `input()` 返回的字符串用 `.2f`,报 `ValueError: Unknown format code 'f' for object of type 'str'`,要先 `float(input(...))`。

</details>

5. 面试题:你要把一段很长的客服对话塞进模型的提示词,为了不超长,同事写了 `history[:2000]` 把前 2000 个字符留下。这样截有什么隐患?

<details><summary>答案</summary>

至少三个。第一,模型限制的是 token 数不是字符数,2000 个字符的中文和 2000 个字符的英文占的 token 不一样(这门课 Day 107 起会实测),按字符数截只是粗略估计。第二,切片不管内容,可能正好把一个 JSON、一句话、一个英文单词切在中间,模型看到半截结构会困惑,甚至学着输出半截。第三,保留「前 2000 个字符」通常是把最新的信息丢了(对话越新越重要),而切片取的是开头。更稳的做法:按 token 数计算、在消息或句子边界截断、优先保留最新的轮次。

</details>

## 明天预告

Day 16 · 字符串(二):常用方法、中文和编码。今天你看到了两个让人别扭的地方:固定位置切片遇到工单号变长就全错;`299元` 里的「元」切不干净。明天学字符串自己带的方法:`strip` 去空白、`split` 按分隔符拆开、`replace` 替换、`removesuffix` 去掉结尾,这样 `ask_amount.py` 就能同时认 `299元`、` 299 `、`1,234,567` 了。同时讲清楚「中文在计算机里到底是怎么存的」:UTF-8 编码、一个汉字占 3 个字节,以及为什么 `len("计费")` 是 2,而 `"计费".encode()` 的长度是 6。
