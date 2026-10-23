---
title: 'Day 23 · 列表推导式'
description: '把「先建空列表、for 遍历、if 筛选、append 加入」这四五行压成一行:[表达式 for 名字 in 一批 if 条件]。相当于 JS 的 map 加 filter。今天学会读、写、拆它,知道 if 放前面还是后面,并用它一行筛出所有退款工单。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 23
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 22](/blog/agent-zero/day-022-tuples-unpack/) 学了元组和解包:元组建好不能改,`(5,)` 要带逗号,`ticket_id, human, customer, desc = parts` 一行拆开一条工单,`enumerate`、`zip`、`divmod` 返回的都是元组。最后的 `ticket_pairs.py` 里,你先造空列表,再 `for` 遍历,再 `if` 检查,再 `append`。

这个套路这几天已经写了十几遍:Day 21 的 `kept = []`、Day 22 的 `records = []`、Day 20 的 `daily_report.py`。它们的形状几乎一样,只是「遍历什么、筛什么、放什么」不同。Python 为这个高频套路准备了一个紧凑写法,叫列表推导式(list comprehension)。今天学它。

## 今天要解决的问题

学完今天,你应该能:

1. 看到 `[y * 100 for y in yuan]` 能说出它等价的 `for` 循环是什么样,反过来也能把「建空列表加 `for` 加 `append`」的三行改写成一行。
2. 会加筛选:`[t for t in tickets if "退款" in t]`;分清 `if` 放在**后面**(筛掉一些项)和 `if ... else ...` 放在**前面**(每一项都留,只是换个值),认得 `SyntaxError: invalid syntax` 是因为把 `else` 放到了后面。
3. 知道推导式里的变量不会泄漏到外面(和 `for` 不同),知道别在推导式里调 `print` 做事,知道什么时候不该用推导式。
4. 写出 `part01/refund_report.py`:把一批带坏行的工单用几行推导式清洗、过滤、转换,一步步筛出退款工单并算合计,并和 `for` 版结果核对一致。

预计用时:2.5 小时。读懂推导式 40 分钟,筛选和 `if`/`else` 位置 40 分钟,小项目 40 分钟,剩下做练习。

前置:[Day 16](/blog/agent-zero/day-016-strings-2/)(`split`、`strip`、`isdigit`、`NFKC`)、[Day 17](/blog/agent-zero/day-017-if-else/)(`if`、条件表达式 `A if 条件 else B`)、[Day 18](/blog/agent-zero/day-018-for-range/)(`for`、`enumerate`)、[Day 21](/blog/agent-zero/day-021-lists/)(列表、`append`、`sorted`)、[Day 22](/blog/agent-zero/day-022-tuples-unpack/)(元组、解包)。今天不调任何 API,花费 0 元。

学法提示:先对照文章逐行敲一遍(代码自己敲,不复制粘贴)并跑通;第二天合上文章,把 `refund_report.py` 默写出来,每写一行推导式,先在纸上写出它等价的 `for` 版;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚我是在哪跑的

输出是我 2026-10-23 在 2019 款 Intel MacBook Pro(macOS 14、zsh)上用演示家目录真跑的,家目录显示成 `/Users/你`,`~/agent-zero-lab` 接着 Day 22 的状态,`uv run python` 是 3.12.13,Ruff 是 0.17.2,basedpyright 是 standard 档。今天的脚本都放在 `part01/`,在仓库根目录用 `uv run python part01/文件名.py` 运行,不读键盘输入。

## 先看 JS 的 filter 和 map

你写 React 时经常这样处理数据:先 `filter` 筛,再 `map` 变形。看一遍:

```text
$ node -e '
const tickets = [
  "T201 计费 C023 8月2日重复扣款299元",
  "T202 登录 C007 验证码收不到",
  "T203 计费 C015 年付多扣了468元,要求退款",
  "T208 计费 C031 退款299元到账了吗",
];
const refunds = tickets.filter((t) => t.includes("退款"));
console.log(refunds.length);
const ids = refunds.map((t) => t.split(" ")[0]);
console.log(ids);
const both = tickets.filter((t) => t.includes("退款")).map((t) => t.split(" ")[0]);
console.log(both);
const sized = [299, 468, 49].map((y) => y * 100);
console.log(sized);
'
2
[ 'T203', 'T208' ]
[ 'T203', 'T208' ]
[ 29900, 46800, 4900 ]
```

<div class="line-notes">

- `const tickets = [` 四张工单,和 Day 21、22 用的是同一批里的几张。
- `"T203 计费 C015 年付多扣了468元,要求退款",` 描述里有「退款」。
- `"T208 计费 C031 退款299元到账了吗",` 也有「退款」。
- `const refunds = tickets.filter((t) => t.includes("退款"));` `filter` 把返回真的留下,返回假的丢掉,得到一个新数组。四张里只有 T203 和 T208 满足。
- `console.log(refunds.length);` 输出 `2`。
- `const ids = refunds.map((t) => t.split(" ")[0]);` `map` 把每一项变成另一个东西:这里是取出工单号。
- `console.log(ids);` 输出 `[ 'T203', 'T208' ]`。
- `const both = tickets.filter((t) => t.includes("退款")).map((t) => t.split(" ")[0]);` 先筛再变,链式写成一行。
- `console.log(both);` 结果一样:`[ 'T203', 'T208' ]`。
- `const sized = [299, 468, 49].map((y) => y * 100);` 单独用 `map`:元转分。
- `console.log(sized);` 输出 `[ 29900, 46800, 4900 ]`。

</div>

Python 的列表推导式把这两步压进一对方括号,**顺序和 JS 反过来**:先说「每一项变成什么」,再说「从哪里来」,最后说「筛什么」:

| 想做的事 | JS | Python |
| --- | --- | --- |
| 每项变一变 | `arr.map(y => y * 100)` | `[y * 100 for y in arr]` |
| 只留满足条件的 | `arr.filter(t => t.includes("退款"))` | `[t for t in arr if "退款" in t]` |
| 先筛再变 | `arr.filter(...).map(...)` | `[t.split()[0] for t in arr if "退款" in t]` |

Python 里也有叫 `map` 和 `filter` 的内置函数,但几乎没人在日常代码里用,大家都写推导式。

## map 那一半:每一项变一变

### 先写一遍 for,再改成一行

新建 `part01/comp_basic.py`:

```python
# agent-zero-lab/part01/comp_basic.py
yuan = [299, 468, 49]

fens_loop = []
for y in yuan:
    fens_loop.append(y * 100)
print("循环版:", fens_loop)

fens = [y * 100 for y in yuan]
print("推导式:", fens)
print("两个一样吗:", fens == fens_loop)

lengths = [len(s) for s in ["T001", "计费", "C023"]]
print(lengths)

squares = [n * n for n in range(1, 6)]
print(squares)

copy_of = [y for y in yuan]
print(copy_of, copy_of is yuan, copy_of == yuan)
```

<div class="line-notes">

- `yuan = [299, 468, 49]` 三个以元为单位的金额。
- `fens_loop = []` 老写法:先建一个空列表。
- `for y in yuan:` 遍历三个金额。
- `fens_loop.append(y * 100)` 每个乘 100,换成分,加进新列表。三行才做完这件事。
- `print("循环版:", fens_loop)` 输出 `[29900, 46800, 4900]`。
- `fens = [y * 100 for y in yuan]` **同样的事一行写完**。方括号里面从左往右读:「`y * 100`,对 `yuan` 里的每个 `y`」。
- `print("推导式:", fens)` 输出一样。
- `print("两个一样吗:", fens == fens_loop)` `True`,内容完全一样。
- `lengths = [len(s) for s in ["T001", "计费", "C023"]]` 变成长度。每个字符串的 `len`:4、2、4。
- `print(lengths)` 输出 `[4, 2, 4]`。
- `squares = [n * n for n in range(1, 6)]` 数据源可以是 `range`(Day 18),不一定是列表。`range(1, 6)` 是 1 到 5。
- `print(squares)` 输出 `[1, 4, 9, 16, 25]`。
- `copy_of = [y for y in yuan]` 前面的表达式什么都不变,原样放回去:得到的是一个**新列表**,内容和 `yuan` 一样。这就是一种 `.copy()`。
- `print(copy_of, copy_of is yuan, copy_of == yuan)` 输出 `[299, 468, 49] False True`:内容相等,但不是同一个对象(Day 21 的 `is` 和 `==`)。

</div>

```text
$ cd ~/agent-zero-lab
$ uv run python part01/comp_basic.py
循环版: [29900, 46800, 4900]
推导式: [29900, 46800, 4900]
两个一样吗: True
[4, 2, 4]
[1, 4, 9, 16, 25]
[299, 468, 49] False True
```

<div class="line-notes">

- `循环版: [29900, 46800, 4900]` 三行的结果。
- `推导式: [29900, 46800, 4900]` 一行的结果。
- `两个一样吗: True` 逐项比较,完全相同。
- `[4, 2, 4]` 三个字符串的长度。
- `[1, 4, 9, 16, 25]` 1 到 5 的平方。
- `[299, 468, 49] False True` 新列表,内容等于原列表但不是原列表。

</div>

怎么读一个推导式?**从 `for` 开始读**,最后再回头看最前面那个表达式。`[y * 100 for y in yuan]` 的执行过程是:

1. `for y in yuan`:`y` 依次取 299、468、49。
2. 每取一个,算前面的表达式 `y * 100`:29900、46800、4900。
3. 算出来的结果依次放进一个新列表。

画成图,三块和老写法里的三行一一对应:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="列表推导式的结构:方括号里依次是表达式、for 名字 in 数据、可选的 if 条件;对应 for 循环写法里的 append 的参数、for 行、if 行;执行顺序是先 for,再 if,再表达式">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-soft)">一行推导式</text>
<text x="30" y="58" fill="var(--ink)" font-size="15">[</text>
<rect x="44" y="40" width="150" height="30" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="54" y="60" fill="var(--ink)">t.split()[0]</text>
<rect x="206" y="40" width="126" height="30" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="216" y="60" fill="var(--ink)">for t in tickets</text>
<rect x="344" y="40" width="190" height="30" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="354" y="60" fill="var(--ink)">if "退款" in t</text>
<text x="544" y="58" fill="var(--ink)" font-size="15">]</text>
<text x="44" y="94" fill="var(--ink-soft)">③ 放进新列表的值</text>
<text x="206" y="94" fill="var(--ink-soft)">① 先取每一项</text>
<text x="344" y="94" fill="var(--ink-soft)">② 再看要不要留</text>
<text x="20" y="130" fill="var(--ink-soft)">等价的 for 写法</text>
<text x="30" y="156" fill="var(--ink)">ids = []</text>
<text x="30" y="178" fill="var(--ink)">for t in tickets:</text>
<text x="30" y="200" fill="var(--ink)">    if "退款" in t:</text>
<text x="30" y="222" fill="var(--ink)">        ids.append(t.split()[0])</text>
<line x1="230" y1="174" x2="330" y2="174" stroke="var(--ink-faint)"/>
<text x="340" y="178" fill="var(--ink-faint)">① for 行</text>
<line x1="230" y1="196" x2="330" y2="196" stroke="var(--ink-faint)"/>
<text x="340" y="200" fill="var(--ink-faint)">② if 行</text>
<line x1="270" y1="218" x2="330" y2="218" stroke="var(--ink-faint)"/>
<text x="340" y="222" fill="var(--ink-faint)">③ append 的括号里</text>
</g>
</svg>
<figcaption>推导式的三块:表达式写在最前面,但它是最后才算的;读的时候先看 for,再看 if,最后回头看前面那个表达式。</figcaption>
</figure>

## filter 那一半:加一个 if

### 筛出退款工单

新建 `part01/comp_filter.py`:

```python
# agent-zero-lab/part01/comp_filter.py
tickets = [
    "T201 计费 C023 8月2日重复扣款299元",
    "T202 登录 C007 验证码收不到",
    "T203 计费 C015 年付多扣了468元,要求退款",
    "T204 计费 C042 发票金额对不上,多收了49元",
    "T205 功能 C031 导出PDF乱码",
    "T208 计费 C031 退款299元到账了吗",
    "T211 计费 C050 Refund request for duplicate charge",
]

refunds_loop = []
for t in tickets:
    if "退款" in t or "refund" in t.lower():
        refunds_loop.append(t)
print("循环版:", len(refunds_loop), "张")

refunds = [t for t in tickets if "退款" in t or "refund" in t.lower()]
print("推导式:", len(refunds), "张,一样吗:", refunds == refunds_loop)

ids = [t.split()[0] for t in refunds]
print("工单号:", ids)

ids_one_line = [t.split()[0] for t in tickets if "退款" in t or "refund" in t.lower()]
print("一步到位:", ids_one_line == ids)

nothing = [t for t in tickets if "发货" in t]
print("没有命中:", nothing, len(nothing))
```

<div class="line-notes">

- `tickets = [` 七张工单:有只说「退款」的,有英文的 `Refund`,有和退款无关的。
- `"T203 计费 C015 年付多扣了468元,要求退款",` 中文「退款」。
- `"T208 计费 C031 退款299元到账了吗",` 中文「退款」,开头就是。
- `"T211 计费 C050 Refund request for duplicate charge",` 英文 `Refund`,大写开头,要靠 `lower()` 才能匹配 `refund`(Day 16)。
- `refunds_loop = []` 老写法的空列表。
- `for t in tickets:` 遍历。
- `if "退款" in t or "refund" in t.lower():` 中文退款或英文 refund(转小写后找)。`or` 的两边各是一个完整的 `in` 判断(Day 17 的 `or_bug.py` 讲过别写成 `"a" or "b" in t`)。
- `refunds_loop.append(t)` 命中的留下。
- `print("循环版:", len(refunds_loop), "张")` 3 张。
- `refunds = [t for t in tickets if "退款" in t or "refund" in t.lower()]` 推导式:前面的表达式就是 `t` 本身(原样留下),`for` 之后接 `if`。`if` 后面可以写任何会得到真假的东西,`or`、`and` 都行。
- `print("推导式:", len(refunds), "张,一样吗:", refunds == refunds_loop)` 张数一样,内容也一样,`True`。
- `ids = [t.split()[0] for t in refunds]` 第二步:从筛出来的工单里取工单号,`t.split()[0]` 是第一段(Day 16 的 `split`)。这里没有 `if`,只有变形。
- `print("工单号:", ids)` `['T203', 'T208', 'T211']`。
- `ids_one_line = [t.split()[0] for t in tickets if "退款" in t or "refund" in t.lower()]` 一步到位:变形和筛选在同一个推导式里。
- `print("一步到位:", ids_one_line == ids)` 和两步法结果一样:`True`。
- `nothing = [t for t in tickets if "发货" in t]` 一张都不满足时会怎样?
- `print("没有命中:", nothing, len(nothing))` 得到空列表 `[] 0`,**不会报错**。空列表在后面 `if refunds:` 里当假用(Day 21)。

</div>

```text
$ uv run python part01/comp_filter.py
循环版: 3 张
推导式: 3 张,一样吗: True
工单号: ['T203', 'T208', 'T211']
一步到位: True
没有命中: [] 0
```

<div class="line-notes">

- `循环版: 3 张` T203、T208、T211。T201 虽然提到「重复扣款」,但没有「退款」两个字,所以不在里面。
- `推导式: 3 张,一样吗: True` 两种写法完全等价。
- `工单号: ['T203', 'T208', 'T211']` 变形之后的三个工单号。
- `一步到位: True` 一次推导式的结果和两步法一样。
- `没有命中: [] 0` 空列表,长度 0。

</div>

## if 放哪里:过滤和替换不是一回事

推导式里有两种带 `if` 的写法,位置不同,意思完全不同,是今天最容易出错的地方。新建 `part01/comp_ifelse.py`:

```python
# agent-zero-lab/part01/comp_ifelse.py
fens = [29900, 0, 46800, 4900, 0, 59800]

paid = [fen for fen in fens if fen > 0]
print("过滤(if 在后面):", paid)

filled = [fen if fen > 0 else -1 for fen in fens]
print("替换(if else 在前面):", filled)

labels = ["大额" if fen >= 30000 else "小额" for fen in fens if fen > 0]
print("两个一起用:", labels)
```

<div class="line-notes">

- `fens = [29900, 0, 46800, 4900, 0, 59800]` 六个金额,有两个是 0(没有金额的工单)。
- `paid = [fen for fen in fens if fen > 0]` **`if` 在最后,没有 `else`**:这是**过滤**,条件不成立的那一项**直接丢掉**。结果有 4 项。
- `print("过滤(if 在后面):", paid)` `[29900, 46800, 4900, 59800]`,两个 0 没了。
- `filled = [fen if fen > 0 else -1 for fen in fens]` **`if ... else ...` 在最前面**:这是 Day 17 的条件表达式 `A if 条件 else B`,放在「每一项变成什么」的位置。**每一项都保留**,只是 0 被换成 -1。结果仍有 6 项。
- `print("替换(if else 在前面):", filled)` `[29900, -1, 46800, 4900, -1, 59800]`。
- `labels = ["大额" if fen >= 30000 else "小额" for fen in fens if fen > 0]` 两种可以一起用:先过滤(最后的 `if fen > 0` 丢掉两个 0),再对剩下的四项做替换(前面的 `if ... else`,三万分以上叫「大额」)。
- `print("两个一起用:", labels)` `['小额', '大额', '小额', '大额']`:29900 小额、46800 大额、4900 小额、59800 大额。

</div>

```text
$ uv run python part01/comp_ifelse.py
过滤(if 在后面): [29900, 46800, 4900, 59800]
替换(if else 在前面): [29900, -1, 46800, 4900, -1, 59800]
两个一起用: ['小额', '大额', '小额', '大额']
```

<div class="line-notes">

- `过滤(if 在后面): [29900, 46800, 4900, 59800]` 少了两项。
- `替换(if else 在前面): [29900, -1, 46800, 4900, -1, 59800]` 项数不变,只是 0 变成了 -1。
- `两个一起用: ['小额', '大额', '小额', '大额']` 四项:先过滤掉 0,再标注大小。

</div>

记法:**`if` 单独出现在末尾,是在「筛」,项数会变少;`if ... else` 出现在开头,是在「选值」,项数不变**。想一想「`else` 后面是什么」就能区分:没有 `else` 就一定是在末尾筛。

如果你把 `else` 放到后面会怎样?新建 `part01/comp_else_error.py`(故意写错):

```python
# agent-zero-lab/part01/comp_else_error.py
fens = [29900, 0, 46800]
result = [fen for fen in fens if fen > 0 else -1]
print(result)
```

<div class="line-notes">

- `fens = [29900, 0, 46800]` 三个金额。
- `result = [fen for fen in fens if fen > 0 else -1]` 想「大于 0 的留下,否则用 -1」,所以把 `else` 接在末尾的 `if` 后面。这个写法 Python 不认。
- `print(result)` 走不到。

</div>

```text
$ uv run python part01/comp_else_error.py
  File "/Users/你/agent-zero-lab/part01/comp_else_error.py", line 3
    result = [fen for fen in fens if fen > 0 else -1]
                                             ^^^^
SyntaxError: invalid syntax
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/comp_else_error.py", line 3` 出错的位置,第 3 行。注意这一次没有 `Traceback`,也没有 `in <module>`:语法错误是在**程序开始跑之前**就被发现的,整个文件一行都没执行。
- `result = [fen for fen in fens if fen > 0 else -1]` 出错的那行。
- `^^^^` 这一排插入符指在 `else` 的位置。
- `SyntaxError: invalid syntax` 语法错误。这条报错很含糊,不会告诉你「`else` 不能放这里」。看到推导式里的 `SyntaxError`,先检查 `else`:有 `else` 就把整个 `A if 条件 else B` 挪到最前面。

</div>

正确写法是 `[fen if fen > 0 else -1 for fen in fens]`,和 `comp_ifelse.py` 里的 `filled` 一样。编辑器里这一行有红线(basedpyright 报 `"[" was not closed`,Ruff 报 `invalid-syntax`),不用等运行。

## 推导式里的名字不外漏

Day 18 讲过:`for` 循环结束后,循环变量还活着。推导式不一样。新建 `part01/comp_scope.py`:

```python
# agent-zero-lab/part01/comp_scope.py
ids = ["T001", "T002", "T003"]

for item in ids:
    pass
print("for 之后 item 还在:", item)

upper = [name.lower() for name in ids]
print(upper)
print(name)
```

<div class="line-notes">

- `ids = ["T001", "T002", "T003"]` 三个工单号。
- `for item in ids:` 普通 `for` 循环。
- `pass` `pass` 是「什么都不做」的占位语句,因为 `for` 的缩进块里不能是空的。
- `print("for 之后 item 还在:", item)` 循环结束后 `item` 还是最后一项 `T003`(Day 18 的 `loop_var_after.py`)。
- `upper = [name.lower() for name in ids]` 推导式,名字叫 `name`。
- `print(upper)` `['t001', 't002', 't003']`。
- `print(name)` 想在推导式外面用 `name`。

</div>

```text
$ uv run python part01/comp_scope.py
for 之后 item 还在: T003
['t001', 't002', 't003']
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/comp_scope.py", line 10, in <module>
    print(name)
          ^^^^
NameError: name 'name' is not defined
```

<div class="line-notes">

- `for 之后 item 还在: T003` `for` 的循环变量留在外面。
- `['t001', 't002', 't003']` 推导式本身正常。
- `File "/Users/你/agent-zero-lab/part01/comp_scope.py", line 10, in <module>` 崩在第 10 行。
- `print(name)` 崩的那行。
- `NameError: name 'name' is not defined` 推导式里的 `name` 只在方括号里面活着,出来就没了。读法:名字 `'name'` 没有定义。好处是:你随手在推导式里取的名字(`t`、`y`、`fen`)不会污染外面同名的变量。编辑器也提前画了红线 `"name" is not defined`,另外还有一条 `"item" is possibly unbound`,是因为 `for` 有可能一次都不跑(Day 18)。

</div>

## 推导式是用来造列表的,别在里面做事

有人觉得推导式「很酷」,开始往里塞各种东西,比如打印。`part01/comp_print_none.py`:

```python
# agent-zero-lab/part01/comp_print_none.py
ids = ["T001", "T002"]

result = [print("处理", i) for i in ids]
print(result)
```

<div class="line-notes">

- `ids = ["T001", "T002"]` 两个工单号。
- `result = [print("处理", i) for i in ids]` 前面的表达式是 `print(...)`:每轮真的会打印一行,然后 `print` 返回 `None`,推导式把这个 `None` 放进新列表。
- `print(result)` 看看 `result` 是什么。

</div>

```text
$ uv run python part01/comp_print_none.py
处理 T001
处理 T002
[None, None]
```

<div class="line-notes">

- `处理 T001` 第一轮 `print` 的输出。
- `处理 T002` 第二轮。
- `[None, None]` 新列表里装的是两个 `None`:`print` 的返回值。你造了一个没人要的列表。

</div>

**推导式的目的是得到一个新列表。要「做事」(打印、写文件、调接口),用普通 `for`。** 判断标准:如果你不需要那个结果列表,就不该用推导式。

## 和解包一起用

Day 22 的元组解包可以直接用在推导式的 `for` 后面。新建 `part01/comp_unpack.py`:

```python
# agent-zero-lab/part01/comp_unpack.py
pairs = [(29900, "T201"), (46800, "T203"), (4900, "T204"), (59800, "T206")]

fens = [fen for fen, _ in pairs]
print(fens)

ids = [ticket_id for _, ticket_id in pairs]
print(ids)

big = [ticket_id for fen, ticket_id in pairs if fen >= 30000]
print("三百元以上:", big)

rank = [(i, ticket_id) for i, (_, ticket_id) in enumerate(pairs, start=1)]
print(rank)

top_two = sorted(pairs, reverse=True)[:2]
print(top_two)
total = sum([fen for fen, _ in pairs])
print("合计", total // 100, "元,共", len(pairs), "张")
```

<div class="line-notes">

- `pairs = [(29900, "T201"), (46800, "T203"), (4900, "T204"), (59800, "T206")]` 四个 `(金额分, 工单号)` 元组,和 Day 22 的 `pairs_sort.py` 同一种数据。
- `fens = [fen for fen, _ in pairs]` `for` 后面解包成两个名字,`_` 表示第二项不要。前面只取 `fen`。结果是 `[29900, 46800, 4900, 59800]`。
- `print(fens)` 打印。
- `ids = [ticket_id for _, ticket_id in pairs]` 反过来,只要工单号。
- `print(ids)` `['T201', 'T203', 'T204', 'T206']`。
- `big = [ticket_id for fen, ticket_id in pairs if fen >= 30000]` 解包、筛选、取值一起:金额不小于 30000 分(300 元)的工单号。
- `print("三百元以上:", big)` `['T203', 'T206']`。
- `rank = [(i, ticket_id) for i, (_, ticket_id) in enumerate(pairs, start=1)]` 和 `enumerate` 的两层解包一起用(Day 22),前面也是一个元组表达式 `(i, ticket_id)`。
- `print(rank)` `[(1, 'T201'), (2, 'T203'), (3, 'T204'), (4, 'T206')]`。
- `top_two = sorted(pairs, reverse=True)[:2]` 先排序再切前两项,这里没用推导式,因为 `sorted` 已经返回新列表了。
- `print(top_two)` `[(59800, 'T206'), (46800, 'T203')]`。
- `total = sum([fen for fen, _ in pairs])` 先用推导式取出所有金额,再交给 `sum`。
- `print("合计", total // 100, "元,共", len(pairs), "张")` `合计 1414 元,共 4 张`。29900 + 46800 + 4900 + 59800 = 141400 分。

</div>

```text
$ uv run python part01/comp_unpack.py
[29900, 46800, 4900, 59800]
['T201', 'T203', 'T204', 'T206']
三百元以上: ['T203', 'T206']
[(1, 'T201'), (2, 'T203'), (3, 'T204'), (4, 'T206')]
[(59800, 'T206'), (46800, 'T203')]
合计 1414 元,共 4 张
```

<div class="line-notes">

- `[29900, 46800, 4900, 59800]` 四个金额。
- `['T201', 'T203', 'T204', 'T206']` 四个工单号。
- `三百元以上: ['T203', 'T206']` T203 是 46800,T206 是 59800;T201 的 29900 差一点不到 300 元。
- `[(1, 'T201'), (2, 'T203'), (3, 'T204'), (4, 'T206')]` 编号配工单号。
- `[(59800, 'T206'), (46800, 'T203')]` 前两名。
- `合计 1414 元,共 4 张` 合计和张数。

</div>

## 什么时候不要写成推导式

推导式短,但**不是越短越好**。下面几种情况,请回到普通 `for`:

1. **一行超过 80 个字符,或者要折成三四行才看得懂。** 折成多行的推导式(Ruff 格式化出来的那种)已经不比 `for` 好读了。
2. **逻辑要分好几步,中间还要用到中间结果。** 比如「先算一个数,再用它判断,再用它变形」,用 `for` 加几个临时变量清楚得多。
3. **要做事,不要结果。** 刚才的 `print` 例子。
4. **要中途 `break`。** 推导式没有 `break` 和 `continue`。
5. **嵌套超过两层。** `for` 里面还能再加 `for`(`[(a, b) for a in xs for b in ys]`),但嵌套推导式读起来很费劲,今天先不用,等你有一定经验再回来。

一个自测标准:写完一个推导式,过一分钟再读它。如果还得一个字一个字地解析,拆回 `for`。

另外,去掉方括号、直接把 `for` 表达式放进函数括号,比如 `sum(fen for fen, _ in pairs)`,是另一种东西(生成器表达式),下一阶段学「生成器」时再讲。字典推导式和集合推导式在 [Day 24](/blog/agent-zero/day-024-dicts/)、[Day 26](/blog/agent-zero/day-026-nested-data/) 讲,读法和今天一样,只是括号换成花括号。

## 小项目:退款工单报表

把今天学的东西用在一个小任务上。场景:客服系统升级了,导出的工单每行多了一列「金额(分)」,格式是 `工单号 类别 客户号 金额 描述`。组长想要一份「退款相关工单」的报表。要求:

1. 先用 `NFKC` 清洗(Day 16),去掉空行;
2. 坏行丢掉:段数不是 5 段,或者金额不是纯数字;
3. 描述里有「退款」或 `refund` 的算退款相关;
4. 取出 `(金额, 工单号)` 对,按金额从高到低排;
5. 打印好坏行数、退款张数和合计、前三名工单号。

先写**不用推导式**的版本,当作「标准答案」。新建 `part01/refund_report_loop.py`:

```python
# agent-zero-lab/part01/refund_report_loop.py
import unicodedata

raw_lines = [
    "T301 计费 C023 29900 8月2日重复扣款,请退款",
    "  T302 登录 C007 0 验证码收不到 ",
    "",
    "T303 计费 C015 46800 年付多扣了,要求退款",
    "T304 功能 C031 0 导出PDF乱码",
    "T305 计费 C042",
    "Ｔ306 计费 C042 4900 发票金额对不上,多收了49元",
    "T307 登录 C007 0 Forgot password",
    "T308 计费 C031 29900 Refund request: charged twice",
    "T309 计费 C023 abc 金额字段坏了,要退款",
    "T310 计费 C023 59800 扣了两次,共598元,申请退款",
    "   ",
    "T311 计费 C015 4900 想要发票PDF",
]

cleaned = []
for raw in raw_lines:
    line = unicodedata.normalize("NFKC", raw).strip()
    if line:
        cleaned.append(line)

good = []
for line in cleaned:
    parts = line.split(maxsplit=4)
    if len(parts) == 5 and parts[3].isdigit():
        good.append(parts)

pairs = []
for parts in good:
    desc = parts[4]
    if "退款" in desc or "refund" in desc.lower():
        pairs.append((int(parts[3]), parts[0]))

pairs.sort(reverse=True)
total = 0
for fen, _ in pairs:
    total += fen

print(
    f"清洗后 {len(cleaned)} 行,可用 {len(good)} 张,坏行 {len(cleaned) - len(good)} 行"
)
print(f"退款相关 {len(pairs)} 张,合计 {total // 100} 元")
print("金额从高到低:", pairs)
```

<div class="line-notes">

- `import unicodedata` 标准库的 Unicode 模块,Day 16 用来把全角转半角。
- `raw_lines = [` 13 行原始文本。第 3、12 行是空的,第 5 行(`T305 计费 C042`)只有三段,第 9 行(`T309`)金额是 `abc`,第 7 行 `Ｔ306` 的 T 是全角字符。
- `"T301 计费 C023 29900 8月2日重复扣款,请退款",` 退款相关,金额 29900 分。
- `"T303 计费 C015 46800 年付多扣了,要求退款",` 退款相关,46800 分。
- `"T308 计费 C031 29900 Refund request: charged twice",` 英文 `Refund`,29900 分。
- `"T310 计费 C023 59800 扣了两次,共598元,申请退款",` 退款相关,59800 分。
- `cleaned = []` 第一个空列表:装清洗后的非空行。
- `for raw in raw_lines:` 遍历原始行。
- `line = unicodedata.normalize("NFKC", raw).strip()` 全角变半角、去两头空白。`Ｔ306` 变成 `T306`,`"  T302 ..."` 去掉前后空格。
- `if line:` 空串当假(Day 14):只有非空的才留。
- `cleaned.append(line)` 留下。13 行里两行空的(第 3、12 行),剩 11 行。
- `good = []` 第二个空列表:装拆好的、合格的行。
- `for line in cleaned:` 遍历清洗后的行。
- `parts = line.split(maxsplit=4)` 最多拆成五段,第五段是完整描述。
- `if len(parts) == 5 and parts[3].isdigit():` 两道关卡一起检查:正好五段,**并且**第四段(金额)是纯数字。`and` 有短路(Day 17):先检查段数,段数不够时根本不会去取 `parts[3]`,不会 `IndexError`。
- `good.append(parts)` 合格的行,存拆好的列表。T305(三段)和 T309(`abc`)在这里被拦下,`good` 有 9 张。
- `pairs = []` 第三个空列表:装 `(金额, 工单号)`。
- `for parts in good:` 遍历合格的。
- `desc = parts[4]` 描述是第五段。
- `if "退款" in desc or "refund" in desc.lower():` 退款相关。
- `pairs.append((int(parts[3]), parts[0]))` 加进去一个元组:金额**转成整数**,工单号。注意双层括号。
- `pairs.sort(reverse=True)` 从高到低排。金额并列(T308 和 T301 都是 29900)的按工单号倒序。
- `total = 0` 累加器。
- `for fen, _ in pairs:` 解包,只要金额。
- `total += fen` 累加。
- `print(` 这一行被 Ruff 格式化成了三行:括号里是一个 f-string,算「清洗后几行、可用几张、坏行几行」,坏行数是 `len(cleaned) - len(good)`。
- `print(f"退款相关 {len(pairs)} 张,合计 {total // 100} 元")` 4 张,合计 166400 分除以 100。
- `print("金额从高到低:", pairs)` 打印排好序的元组列表。

</div>

```text
$ uv run python part01/refund_report_loop.py
清洗后 11 行,可用 9 张,坏行 2 行
退款相关 4 张,合计 1664 元
金额从高到低: [(59800, 'T310'), (46800, 'T303'), (29900, 'T308'), (29900, 'T301')]
```

<div class="line-notes">

- `清洗后 11 行,可用 9 张,坏行 2 行` 13 行去掉两个空行是 11 行;T305 和 T309 是坏行,所以可用 9 张。
- `退款相关 4 张,合计 1664 元` T301、T303、T308、T310 共 4 张:29900 + 46800 + 29900 + 59800 = 166400 分。
- `金额从高到低: [(59800, 'T310'), (46800, 'T303'), (29900, 'T308'), (29900, 'T301')]` 最高 T310,并列的两张 T308 排在 T301 前面。

</div>

这个版本用了三个空列表、三个 `for`。现在**一步步**把它换成推导式。每一步的口诀都一样:**空列表那行、`for` 那行、`if` 那行、`append` 的括号里**,各自搬到方括号的对应位置。新建 `part01/refund_report.py`:

```python
# agent-zero-lab/part01/refund_report.py
import unicodedata

raw_lines = [
    "T301 计费 C023 29900 8月2日重复扣款,请退款",
    "  T302 登录 C007 0 验证码收不到 ",
    "",
    "T303 计费 C015 46800 年付多扣了,要求退款",
    "T304 功能 C031 0 导出PDF乱码",
    "T305 计费 C042",
    "Ｔ306 计费 C042 4900 发票金额对不上,多收了49元",
    "T307 登录 C007 0 Forgot password",
    "T308 计费 C031 29900 Refund request: charged twice",
    "T309 计费 C023 abc 金额字段坏了,要退款",
    "T310 计费 C023 59800 扣了两次,共598元,申请退款",
    "   ",
    "T311 计费 C015 4900 想要发票PDF",
]

cleaned = [unicodedata.normalize("NFKC", raw).strip() for raw in raw_lines]
cleaned = [line for line in cleaned if line]
rows = [line.split(maxsplit=4) for line in cleaned]
good = [p for p in rows if len(p) == 5 and p[3].isdigit()]
refunds = [p for p in good if "退款" in p[4] or "refund" in p[4].lower()]
pairs = [(int(p[3]), p[0]) for p in refunds]
pairs.sort(reverse=True)

print(f"清洗后 {len(cleaned)} 行,可用 {len(good)} 张,坏行 {len(rows) - len(good)} 行")
total = sum([fen for fen, _ in pairs])
print(f"退款相关 {len(pairs)} 张,合计 {total // 100} 元")
print("金额从高到低:", pairs)

top3_ids = [ticket_id for _, ticket_id in pairs[:3]]
print("前三名工单号:", top3_ids)

bad_lines = [" ".join(p) for p in rows if p not in good]
print("坏行原文:", bad_lines)
```

<div class="line-notes">

- `import unicodedata` 同上。
- `raw_lines = [` 同样的 13 行原始数据,不再重复解释。
- `cleaned = [unicodedata.normalize("NFKC", raw).strip() for raw in raw_lines]` 第一步:对**每一行**都做清洗,这是 `map`。注意这一步**还没丢空行**,所以列表有 13 项,其中两项是空串。
- `cleaned = [line for line in cleaned if line]` 第二步:丢掉空串。这是 `filter`,前面的表达式就是 `line` 本身。我故意把两步分开写,没有挤成一行:清洗和过滤是两件事,拆开更好读。左边又用了名字 `cleaned`,是把旧的换成新的。剩下 11 项。
- `rows = [line.split(maxsplit=4) for line in cleaned]` 第三步:每行拆成列表。`rows` 是**列表的列表**,11 项,每项是一个小列表。
- `good = [p for p in rows if len(p) == 5 and p[3].isdigit()]` 第四步:只留合格的。`p` 是一行拆出来的小列表,`if` 里的两道关卡和 `for` 版一模一样。9 项。
- `refunds = [p for p in good if "退款" in p[4] or "refund" in p[4].lower()]` 第五步:只留退款相关。`p[4]` 是描述。4 项。
- `pairs = [(int(p[3]), p[0]) for p in refunds]` 第六步:变成 `(金额, 工单号)` 元组。前面的表达式是一个元组。
- `pairs.sort(reverse=True)` 排序。这是**语句**,不是推导式能做的事,单独一行(Day 21:别接返回值)。
- `print(f"清洗后 {len(cleaned)} 行,可用 {len(good)} 张,坏行 {len(rows) - len(good)} 行")` 坏行数是 `rows` 的项数减去 `good` 的项数,11 减 9。
- `total = sum([fen for fen, _ in pairs])` 合计:先推导出所有金额,再用内置 `sum`。
- `print(f"退款相关 {len(pairs)} 张,合计 {total // 100} 元")` 4 张,1664 元。
- `print("金额从高到低:", pairs)` 同上。
- `top3_ids = [ticket_id for _, ticket_id in pairs[:3]]` 新增:前三名的工单号。`pairs[:3]` 先切前三项,再解包取第二项。
- `print("前三名工单号:", top3_ids)` 打印。
- `bad_lines = [" ".join(p) for p in rows if p not in good]` 新增:找出坏行原文。`p not in good` 问「这一行在不在合格列表里」(Day 21 的 `in` 对列表也行,会逐项比较内容);`" ".join(p)` 把拆开的小列表重新用空格接回字符串(Day 21 的 `join`)。注意:拆过再接,原来的多个空格会被缩成一个,但这里的坏行本来就是单空格。
- `print("坏行原文:", bad_lines)` 打印。

</div>

```text
$ uv run python part01/refund_report.py
清洗后 11 行,可用 9 张,坏行 2 行
退款相关 4 张,合计 1664 元
金额从高到低: [(59800, 'T310'), (46800, 'T303'), (29900, 'T308'), (29900, 'T301')]
前三名工单号: ['T310', 'T303', 'T308']
坏行原文: ['T305 计费 C042', 'T309 计费 C023 abc 金额字段坏了,要退款']
```

<div class="line-notes">

- `清洗后 11 行,可用 9 张,坏行 2 行` 和循环版一样。
- `退款相关 4 张,合计 1664 元` 一样。
- `金额从高到低: [(59800, 'T310'), (46800, 'T303'), (29900, 'T308'), (29900, 'T301')]` 一样,逐字符相同。
- `前三名工单号: ['T310', 'T303', 'T308']` 前三名。
- `坏行原文: ['T305 计费 C042', 'T309 计费 C023 abc 金额字段坏了,要退款']` 两个坏行:T305 少了两段,T309 的金额是 `abc`。

</div>

两种写法的前三行输出逐字符一样,说明改写没改变行为。**改写的习惯:先用 `for` 版写对、跑通,再一步步换成推导式,每换一步就对一次输出。** 不要上来就写一长串推导式再调试。

这个脚本里的 `rows`、`good`、`refunds` 每一步都有名字、都能单独 `print` 看一眼,这是推导式相比 JS 链式 `filter().map()` 的一个好处:你可以随时在中间断开检查,而不用把整条链改写。

basedpyright 在 standard 档对这几个脚本零报错(`comp_else_error.py`、`comp_scope.py` 里的红线是故意的)。Ruff 通过;它还把 `refund_report_loop.py` 里那条太长的 `print` 拆成了三行。

## 动手练习

### 练习 1:把四个循环改写成推导式

下面四段循环,每段改写成一行推导式,并和循环版对比结果是否相等。写 `part01/ex23_1_rewrite.py`。

```python
fens = [29900, 0, 46800, 4900, 0, 59800]
ids = ["T201", "T202", "T203"]
words = ["  计费 ", "登录", " 功能  "]

yuan_loop = []                           # (1) 每个金额换成元(整除 100)
for fen in fens:
    yuan_loop.append(fen // 100)

paid_loop = []                           # (2) 只留大于 0 的
for fen in fens:
    if fen > 0:
        paid_loop.append(fen)

tags_loop = []                           # (3) 每个工单号变成 "#t201" 这样的小写标签
for ticket_id in ids:
    tags_loop.append("#" + ticket_id.lower())

clean_loop = []                          # (4) 去掉两头空白,并丢掉清洗后是空串的
for w in words:
    if w.strip() != "":
        clean_loop.append(w.strip())
```

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex23_1_rewrite.py
fens = [29900, 0, 46800, 4900, 0, 59800]
ids = ["T201", "T202", "T203"]
words = ["  计费 ", "登录", " 功能  "]

yuan_loop = []
for fen in fens:
    yuan_loop.append(fen // 100)

paid_loop = []
for fen in fens:
    if fen > 0:
        paid_loop.append(fen)

tags_loop = []
for ticket_id in ids:
    tags_loop.append("#" + ticket_id.lower())

clean_loop = []
for w in words:
    if w.strip() != "":
        clean_loop.append(w.strip())

yuan = [fen // 100 for fen in fens]
paid = [fen for fen in fens if fen > 0]
tags = ["#" + ticket_id.lower() for ticket_id in ids]
clean = [w.strip() for w in words if w.strip() != ""]

print(yuan, yuan == yuan_loop)
print(paid, paid == paid_loop)
print(tags, tags == tags_loop)
print(clean, clean == clean_loop)
```

<div class="line-notes">

- `fens = [29900, 0, 46800, 4900, 0, 59800]` 六个金额,有两个 0。
- `ids = ["T201", "T202", "T203"]` 三个工单号。
- `words = ["  计费 ", "登录", " 功能  "]` 三个带空白的词。这里没有清洗后是空串的,但条件仍然要写,换了数据就用得上。
- `yuan_loop = []` (1) 的循环版,下面一共四段,和题目里的一样。
- `paid_loop = []` (2) 的循环版。
- `tags_loop = []` (3) 的循环版。
- `clean_loop = []` (4) 的循环版。
- `yuan = [fen // 100 for fen in fens]` (1) 只有变形,没有 `if`:前面的表达式 `fen // 100`,后面 `for fen in fens`。
- `paid = [fen for fen in fens if fen > 0]` (2) 只有筛选:前面的表达式就是 `fen` 本身,末尾加 `if fen > 0`。
- `tags = ["#" + ticket_id.lower() for ticket_id in ids]` (3) 变形:前面的表达式是字符串拼接加 `lower()`。
- `clean = [w.strip() for w in words if w.strip() != ""]` (4) 变形加筛选:前面是 `w.strip()`,末尾的 `if` 判断的也是 `w.strip()`。**`strip()` 写了两遍**,这是推导式的一个小遗憾(Python 3.8 之后有一种叫「海象运算符」的写法能省掉,先不学)。
- `print(yuan, yuan == yuan_loop)` 输出结果和是否与循环版一致。
- `print(paid, paid == paid_loop)` 同上。
- `print(tags, tags == tags_loop)` 同上。
- `print(clean, clean == clean_loop)` 同上。

</div>

```text
$ uv run python part01/ex23_1_rewrite.py
[299, 0, 468, 49, 0, 598] True
[29900, 46800, 4900, 59800] True
['#t201', '#t202', '#t203'] True
['计费', '登录', '功能'] True
```

<div class="line-notes">

- `[299, 0, 468, 49, 0, 598] True` 六个金额换成元,0 也保留(没有筛选),和循环版一致。
- `[29900, 46800, 4900, 59800] True` 两个 0 被去掉。
- `['#t201', '#t202', '#t203'] True` 小写标签。
- `['计费', '登录', '功能'] True` 清洗后的词。

</div>

</details>

### 练习 2:先猜,再跑

不要先运行。下面的七行输出分别是什么?先写下答案再核对。重点看第 2 行(`b`)和第 3 行(`c`)的区别,以及最后一行 `nums` 变没变。

```python
# agent-zero-lab/part01/ex23_2_guess.py
nums = [3, 8, 1, 6]

a = [n * 2 for n in nums if n > 2]
b = [n if n > 2 else 0 for n in nums]
c = [n for n in nums if n % 2 == 0]
d = [(i, n) for i, n in enumerate(nums)]
e = [n for n in nums if n > 100]
line = "T001 计费 C023"
f = [len(s) for s in line.split()]

print(a)
print(b)
print(c)
print(d)
print(e)
print(f)
print(nums)
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex23_2_guess.py
[6, 16, 12]
[3, 8, 0, 6]
[8, 6]
[(0, 3), (1, 8), (2, 1), (3, 6)]
[]
[4, 2, 4]
[3, 8, 1, 6]
```

<div class="line-notes">

- `[6, 16, 12]` `a`:先过滤,`n > 2` 的是 3、8、6(1 被丢掉),再各乘 2:6、16、12。项数从 4 变成 3。
- `[3, 8, 0, 6]` `b`:`if ... else` 在前面,**每项都保留**,不大于 2 的(1)被换成 0。项数仍是 4。
- `[8, 6]` `c`:偶数。`n % 2 == 0` 的只有 8 和 6(Day 12 的取余)。
- `[(0, 3), (1, 8), (2, 1), (3, 6)]` `d`:`enumerate` 默认从 0 数,每项是 `(下标, 值)` 的元组。
- `[]` `e`:没有大于 100 的,空列表,不报错。
- `[4, 2, 4]` `f`:`line.split()` 是 `['T001', '计费', 'C023']`,长度 4、2、4。注意「计费」是 2,因为 `len` 数的是字符个数(Day 15、16),不是字节。
- `[3, 8, 1, 6]` `nums` 一点没变:推导式总是造新列表,不改原来的。

</div>

</details>

### 练习 3:找出两个错

下面两段代码,第一段会崩,第二段不崩但结果不对。运行它们,说出病因和改法。

```python
# agent-zero-lab/part01/ex23_3_bug.py
fens = [29900, 0, 46800, 4900]
tickets = ["T203", "T201", "T204"]

ids = [t.lower() for t in tickets].sort()
print("个数:", len(ids))
```

```python
# agent-zero-lab/part01/ex23_3_bug_b.py
fens = [29900, 0, 46800, 4900, 0]

labels = ["大额" if fen >= 30000 else "小额" for fen in fens]
print(labels)
print("大额有", labels.count("大额"), "张,小额有", labels.count("小额"), "张")
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex23_3_bug.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex23_3_bug.py", line 6, in <module>
    print("个数:", len(ids))
                   ^^^^^^^^
TypeError: object of type 'NoneType' has no len()
$ uv run python part01/ex23_3_bug_b.py
['小额', '小额', '大额', '小额', '小额']
大额有 1 张,小额有 4 张
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/ex23_3_bug.py", line 6, in <module>` 第一段崩在第 6 行。
- `print("个数:", len(ids))` 崩的那行。
- `TypeError: object of type 'NoneType' has no len()` 病因是 Day 21 的老朋友:`[...].sort()` 里,推导式先造出新列表,紧接着 `.sort()` 原地排它并**返回 `None`**,`ids` 拿到的是 `None`。改法:`ids = sorted([t.lower() for t in tickets])`。编辑器也提前画了红线(`Argument of type "None"`)。
- `['小额', '小额', '大额', '小额', '小额']` 第二段不报错,5 项都有标签,**两个金额为 0 的也被标成了「小额」**。
- `大额有 1 张,小额有 4 张` 小额应该是 2 张(4900 和另一个有金额的),却数出了 4 张,因为两个 0 混在里面。病因:想「先排除 0,再标注大小」,却只写了前面的 `if ... else`(替换),没有末尾的 `if fen > 0`(过滤)。**两件事要两个 `if`。**

</div>

改完的版本 `part01/ex23_3_fixed.py`:

```python
# agent-zero-lab/part01/ex23_3_fixed.py
tickets = ["T203", "T201", "T204"]
ids = sorted([t.lower() for t in tickets])
print("个数:", len(ids), ids)

fens = [29900, 0, 46800, 4900, 0]
labels = ["大额" if fen >= 30000 else "小额" for fen in fens if fen > 0]
print(labels)
print("大额有", labels.count("大额"), "张,小额有", labels.count("小额"), "张")
```

<div class="line-notes">

- `tickets = ["T203", "T201", "T204"]` 乱序的工单号。
- `ids = sorted([t.lower() for t in tickets])` 先推导成小写列表,再交给 `sorted` 得到排好序的**新列表**,不再接 `.sort()` 的返回值。
- `print("个数:", len(ids), ids)` 3 个,`['t201', 't203', 't204']`。
- `fens = [29900, 0, 46800, 4900, 0]` 同样的金额。
- `labels = ["大额" if fen >= 30000 else "小额" for fen in fens if fen > 0]` 前面是替换,后面加了过滤:`if fen > 0`。两个 0 在被标注之前就被丢掉。
- `print(labels)` `['小额', '大额', '小额']`,三项。
- `print("大额有", labels.count("大额"), "张,小额有", labels.count("小额"), "张")` 用 Day 21 的 `count` 数。

</div>

```text
$ uv run python part01/ex23_3_fixed.py
个数: 3 ['t201', 't203', 't204']
['小额', '大额', '小额']
大额有 1 张,小额有 2 张
```

<div class="line-notes">

- `个数: 3 ['t201', 't203', 't204']` 排好序的三个小写工单号。
- `['小额', '大额', '小额']` 29900 小额、46800 大额、4900 小额。
- `大额有 1 张,小额有 2 张` 对了:没有金额的不再混进来。

</div>

</details>

### 练习 4:一批工单,四个问题,四行推导式

用 Day 18 的 10 张工单(下面的 `tickets`),每个问题**一行推导式**回答。写 `part01/ex23_4_batch.py`:(1) 人工类别是「计费」的工单号;(2) 描述全是英文(`isascii()`)的工单号;(3) 每张工单的 `(描述字数, 工单号)`,按字数从多到少取前三张;(4) 客户 C042 的所有工单的描述。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex23_4_batch.py
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

billing_ids = [t.split()[0] for t in tickets if t.split()[1] == "计费"]
print("人工标计费的:", billing_ids)

english = [t.split()[0] for t in tickets if t.split(maxsplit=3)[3].isascii()]
print("描述全是英文的:", english)

lengths = [(len(t.split(maxsplit=3)[3]), t.split()[0]) for t in tickets]
longest3 = sorted(lengths, reverse=True)[:3]
print("描述最长的三张:", longest3)

of_c042 = [t.split(maxsplit=3)[3] for t in tickets if t.split()[2] == "C042"]
print("C042 的描述:", of_c042)
```

<div class="line-notes">

- `tickets = [` 10 张工单,和 Day 18 的 `batch_classify.py` 同一批,每行格式是「工单号 人工类别 客户号 描述」。
- `billing_ids = [t.split()[0] for t in tickets if t.split()[1] == "计费"]` (1) `t.split()` 拆开,第 1 项是类别,第 0 项是工单号。**`split()` 写了两遍**,每遍重新拆一次,小数据没问题,大数据就浪费。更好的做法是先 `rows = [t.split(maxsplit=3) for t in tickets]` 拆一次,再基于 `rows` 筛选,这就是 `refund_report.py` 的思路。
- `print("人工标计费的:", billing_ids)` T001、T003、T006、T008、T009、T010,一共 6 张。
- `english = [t.split()[0] for t in tickets if t.split(maxsplit=3)[3].isascii()]` (2) 描述是第 4 段;`isascii()` 当字符串里**全是 ASCII 字符**(英文字母、数字、标点)时为真,有一个汉字就为假。`maxsplit=3` 保证描述里的空格不被拆开。
- `print("描述全是英文的:", english)` `['T005', 'T006']`,只有这两张。
- `lengths = [(len(t.split(maxsplit=3)[3]), t.split()[0]) for t in tickets]` (3) 先造 `(描述字数, 工单号)` 元组列表,前面的表达式是一个元组。
- `longest3 = sorted(lengths, reverse=True)[:3]` 倒序排序再切前三。字数相同的按工单号倒序。
- `print("描述最长的三张:", longest3)` `[(35, 'T006'), (35, 'T005'), (26, 'T001')]`。T006 和 T005 都是 35 个字符,英文空格也算;T001 的 26 个字符里有中文字。
- `of_c042 = [t.split(maxsplit=3)[3] for t in tickets if t.split()[2] == "C042"]` (4) 筛选条件看第 2 段(客户号),取出来的是第 4 段(描述)。
- `print("C042 的描述:", of_c042)` 两张:T008 和 T010 的描述。

</div>

```text
$ uv run python part01/ex23_4_batch.py
人工标计费的: ['T001', 'T003', 'T006', 'T008', 'T009', 'T010']
描述全是英文的: ['T005', 'T006']
描述最长的三张: [(35, 'T006'), (35, 'T005'), (26, 'T001')]
C042 的描述: ['发票金额和订单金额对不上', '我想要一份发票的PDF版本']
```

<div class="line-notes">

- `人工标计费的: ['T001', 'T003', 'T006', 'T008', 'T009', 'T010']` 六个。
- `描述全是英文的: ['T005', 'T006']` 两个。T004 的描述里虽然有「PDF」这样的英文,但还有汉字,所以不算。
- `描述最长的三张: [(35, 'T006'), (35, 'T005'), (26, 'T001')]` 前两名并列 35,第三名 T001 是 26。
- `C042 的描述: ['发票金额和订单金额对不上', '我想要一份发票的PDF版本']` T008 和 T010 的描述,顺序是原来出现的顺序。

</div>

这四行都有一个共同点:`t.split(...)` 被反复调用。这是推导式的一个常见代价:想保留中间结果,要么多写一层推导式(像 `refund_report.py` 的 `rows`),要么改回 `for`。

</details>

**验收标准**:`refund_report.py` 能默写出来,并能说出每一行推导式等价的 `for` 版;能说清「`if` 放末尾」和「`if ... else` 放前面」的区别;练习 3 两个错都能说出病因;4 道练习都做对,Ruff 通过。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 列表推导式(list comprehension) | 用一对方括号一次性造出新列表的写法:`[表达式 for 名字 in 一批 if 条件]` |
| 表达式 | 推导式最前面那一段,决定放进新列表的每一项长什么样 |
| 过滤(filter) | 推导式末尾加 `if 条件`,条件为假的项直接丢掉,项数会变少 |
| 映射(map) | 对每一项做同样的变形,项数不变,例如 `[y * 100 for y in yuan]` |
| 条件表达式 | `A if 条件 else B`,Day 17 讲过;放在推导式最前面时是「选值」 |
| 作用域(scope) | 一个名字能被用到的范围。推导式里的名字只在方括号里面有效 |
| `NameError` | 用了没有定义的名字,今天是在推导式外面用了里面的名字 |
| `SyntaxError: invalid syntax` | 语法不对。推导式里把 `else` 放到末尾就会这样,程序一行都不会运行 |
| 副作用(side effect) | 除了返回结果之外还做了别的事,例如 `print`、写文件。推导式里别放有副作用的东西 |
| `isascii()` | 字符串方法,全部字符都是 ASCII 时返回真 |
| `pass` | 什么都不做的占位语句,用在语法上必须有一行、但你什么都不想做的地方 |
| 生成器表达式 | 去掉方括号的 `for` 表达式,和推导式长得像但不是同一种东西,后面的课再讲 |

## 常见误区

**把 `else` 放到推导式末尾。** `[x for x in xs if 条件 else y]` 是 `SyntaxError: invalid syntax`。「选值」的 `if ... else` 放最前面:`[x if 条件 else y for x in xs]`。

**想排除一部分,却只写了前面的 `if ... else`。** 每一项都还在,只是换了值。要排除,得在末尾另加一个单独的 `if`。

**在推导式里 `print` 或做别的事。** 得到一个没人要的 `[None, None, ...]`。要做事用 `for`。

**把 `[...].sort()` 的结果赋给变量。** 和 Day 21 一样,`sort()` 返回 `None`。要排序用 `sorted([...])`。

**一个推导式塞太多。** 超过一行半还看不懂,就拆回 `for`,或者像 `refund_report.py` 那样拆成几步、每步一个名字。

**在推导式外面用里面的名字。** `NameError`。推导式的变量不外漏,这是好事;要保留结果就赋给一个变量。

**以为推导式更快,所以到处用。** 它确实比「空列表加 `append`」略快一点,但差别在大多数脚本里微不足道。选它的理由是**好读**,不是快。

**改写时一次换太多。** 先用 `for` 写对,再一步步换成推导式,每步都核对输出。

## 学习资料

### 文档与文章

- [Python 教程 · 列表推导式](https://docs.python.org/zh-cn/3.12/tutorial/datastructures.html#list-comprehensions):中文,官方教程里列表推导式一节,例子很短;后面接的「嵌套的列表推导式」今天不用看。
- [Python 语言参考 · 列表显示(list displays)](https://docs.python.org/zh-cn/3.12/reference/expressions.html#list-displays):中文,推导式的正式语法,想知道 `for`、`if` 允许怎么组合可以查这里。
- [Python 函数式编程指引](https://docs.python.org/zh-cn/3.12/howto/functional.html):中文,官方 HOWTO,里面有「生成器表达式和列表推导式」一节,把它和 `map`、`filter` 做了对比。今天只读那一节。
- [PEP 202 · List Comprehensions](https://peps.python.org/pep-0202/):英文,2000 年提出推导式的原始提案,很短,可以看到语法为什么设计成这样。
- [MDN · Array.prototype.filter](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Array/filter)、[Array.prototype.map](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Array/map):中文,JS 一侧对照。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1b54y117KG&autoplay=0&high_quality=1" title="Python基本语法：列表推导式" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>周周学Python · Python基本语法:列表推导式 · 12 分钟,从循环改写成推导式讲起,和今天的顺序一致。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1qD421V7JT&autoplay=0&high_quality=1" title="5-8七分钟搞懂列表推导式这个概念" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员陈雷雷 · 5-8七分钟搞懂列表推导式这个概念 · 7 分钟,讲得慢,适合第一次看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/3dt4OGnU5sM" title="Python Tutorial: Comprehensions - How they work and why you should be using them" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial: Comprehensions - How they work and why you should be using them · 英文,先讲列表推导式的写法和 `if`,再讲字典、集合推导式;今天看前半,后半留到 Day 24 以后。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/RaIu2-NM0t0" title="List Comprehension in Python - A Python Feature You MUST KNOW - Python Tutorial" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Patrick Loeber · List Comprehension in Python · 英文,短,配了一批小例子,看完可以对照 `comp_basic.py`。</figcaption>
</figure>

### 书籍

- Eric Matthes《Python Crash Course》第 3 版,No Starch Press,2023(中译《Python编程:从入门到实践》)。第 4 章「Working with Lists」里有「List Comprehensions」一小节,例子是平方数,和今天的 `comp_basic.py` 对得上。
- Luciano Ramalho《Fluent Python》第 2 版,O'Reilly,2022。第 2 章「An Array of Sequences」里「List Comprehensions and Generator Expressions」一节,讲推导式的可读性、作用域和「什么时候别用」,比今天讲得深;读前半就够,中文版第 2 版出版情况我没核实,按英文书名找。
- Al Sweigart《Automate the Boring Stuff with Python》第 2 版,No Starch Press,2019 没有专章讲推导式,今天不用看。

### 开源项目与代码

- [Asabeneh/30-Days-Of-Python · Day 13 List comprehension](https://github.com/Asabeneh/30-Days-Of-Python/tree/master/13_Day_List_comprehension):英文,推导式的写法、`if` 过滤、`lambda` 等,一批练习;`lambda` 现在不用看。
- [jackfrued/Python-100-Days · 09.常用数据结构之列表-2](https://github.com/jackfrued/Python-100-Days/blob/master/Day01-20/09.常用数据结构之列表-2.md):中文,里面有一节「生成式」(推导式的另一种叫法),和今天内容对应。

## 自测

1. `[n * 2 for n in [1, 2, 3, 4] if n % 2 == 0]` 的结果是什么?把它改写成 `for` 循环。

<details><summary>答案</summary>

`[4, 8]`。先过滤出偶数 2、4,再各乘 2。

```python
result = []
for n in [1, 2, 3, 4]:
    if n % 2 == 0:
        result.append(n * 2)
```

</details>

2. `[x if x > 0 else 0 for x in [3, -1, 5]]` 和 `[x for x in [3, -1, 5] if x > 0]` 的结果各是什么?为什么长度不同?

<details><summary>答案</summary>

前者 `[3, 0, 5]`,后者 `[3, 5]`。前者的 `if ... else` 在前面,是「选值」,每一项都保留,-1 被换成 0;后者的 `if` 在末尾,是过滤,-1 被丢掉。

</details>

3. 下面这行为什么是 `SyntaxError`?怎么改?

```python
result = [x for x in nums if x > 0 else 0]
```

<details><summary>答案</summary>

`else` 不能跟在末尾的 `if` 后面。要「大于 0 的保留,否则用 0」,把条件表达式挪到最前面:`[x if x > 0 else 0 for x in nums]`。

</details>

4. `names = [n.lower() for n in ["A", "B"]]` 之后,在外面 `print(n)` 会怎样?`for n in ["A", "B"]: pass` 之后 `print(n)` 呢?

<details><summary>答案</summary>

前者 `NameError: name 'n' is not defined`,推导式里的变量不外漏。后者能打印出 `B`,`for` 的循环变量留在外面(Day 18)。

</details>

5. **面试题**:什么时候不该用列表推导式?

<details><summary>答案</summary>

(1) 要做事、不要结果(打印、写文件、调接口),比如 `[print(x) for x in xs]` 会造出一个没用的 `[None, ...]`;(2) 逻辑复杂、要多个中间变量,折成多行后可读性不如 `for`;(3) 需要中途 `break`/`continue`;(4) 嵌套层数多。推导式的价值是简洁和好读,变得难读时就拆回普通循环。

</details>

6. 下面哪种写法会让 `ids` 变成 `None`?怎么改?

```python
ids = [t.lower() for t in tickets].sort()
```

<details><summary>答案</summary>

这一种:推导式先造出新列表,`.sort()` 原地排序并返回 `None`,`ids` 拿到的就是 `None`。改成 `ids = sorted([t.lower() for t in tickets])`,或者先赋给变量再单独一行 `ids.sort()`。

</details>

## 明天预告

Day 24 · 字典:键值对和 `.items()`。这三天你一直在用「按位置找东西」:列表的下标、元组的第几项。今天的 `refund_report.py` 里 `p[3]` 是金额、`p[4]` 是描述,过两天自己都不记得 3 和 4 是什么意思。明天学字典(dict),相当于 JS 的 Object 或 Map:用有名字的键找值,`ticket["amount"]` 代替 `p[3]`,还能数「每个类别各有几张工单」。学完你就能把列表推导式和字典配起来用了。
