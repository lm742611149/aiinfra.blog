---
title: 'Day 17 · 条件判断:if、elif、else 和布尔运算'
description: '用 if、elif、else 让程序按条件走不同的路,缩进代替花括号;and、or、not 把几个条件组合起来,短路求值和 `if x == "a" or "b"` 永远为真的陷阱;最后用关键词给工单分类、按金额决定谁来审批退款,同时发现关键词规则只对了 9 张里的 6 张。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 17
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 16](/blog/agent-zero/day-016-strings-2/) 学了字符串方法:`strip`、`removesuffix`、`replace`、`split`、`in`、`find`,又讲了中文的编码。`ask_amount.py` 现在能吃 `299元`、`¥19.99`、`1,234,567`,`ticket_card2.py` 能按任意空白拆工单行。

但它们有一个共同的漏洞:程序**不会先看一眼再决定**。输入 `abc`,它照样往下走,到 `float()` 那里崩;工单行只有 `T009 计费` 两段,它照样去取 `parts[2]`;`find` 找不到返回 `-1`,它照样拿去切片。今天学 `if`:让程序在每个岔路口先判断,按结果走不同的路。再用 `and`、`or`、`not` 把几个判断组合起来。

## 今天要解决的问题

学完今天,你应该能:

1. 写出 `if`、`elif`、`else`,知道 Python 用冒号加缩进代替 JS 的花括号;看到 `IndentationError`、`SyntaxError: expected ':'` 知道缺了什么;知道 `elif` 是「从上到下,碰到第一个成立的就停」。
2. 用 `and`、`or`、`not` 组合条件,说清楚短路求值,知道 `x or "默认值"` 这个惯用写法和 `if x == "a" or "b"` 永远为真的陷阱。
3. 用 `in` 加 `or` 写关键词分类规则,并用一组真实工单测出它对了几张。
4. 写出 `part01/refund_rule.py`:读单价和次数,先判断输入是不是合法数字,再按退款金额决定谁来批准;并给 `ticket_card2.py` 补上「段数不够」的检查。

预计用时:2.5 小时。if/elif/else 50 分钟,and/or/not 40 分钟,拼起来 40 分钟,剩下做练习。

前置:[Day 14](/blog/agent-zero/day-014-bool-none/)(布尔值、比较运算符、`bool()` 和真值)、[Day 15](/blog/agent-zero/day-015-strings-1/)(f-string)、[Day 16](/blog/agent-zero/day-016-strings-2/)(字符串方法、`in`、`ask_amount.py`、`ticket_card2.py`)。今天不调任何 API,花费 0 元。

学法提示:先对照文章逐行敲一遍(代码自己敲,不复制粘贴)并跑通;第二天合上文章,把 `refund_rule.py` 默写出来,用 `299` 和 `4`、`abc` 和 `2` 两组输入各跑一次;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚我是在哪跑的

输出是我 2026-10-23 在 2019 款 Intel MacBook Pro(macOS 14、zsh)上用演示家目录真跑的,家目录显示成 `/Users/你`,`~/agent-zero-lab` 接着 Day 16 的状态,`uv run python` 是 3.12.13,Ruff 是 0.17.2。今天的脚本都放在 `part01/`,在仓库根目录用 `uv run python part01/文件名.py` 运行。要从键盘读输入的脚本,我用管道喂输入记录输出,下面贴的是你在终端里敲的时候会看到的样子:提示文字后面跟着你敲的字。

## if:让程序先看一眼再决定

### 最小的 if

先写一个只有一个分支的。假设一线客服能直接批准 500 元以内的退款,超过的要转组长。新建 `part01/if_basic.py`:

```python
# agent-zero-lab/part01/if_basic.py
amount = int(input("退款金额(元):"))

if amount > 500:
    print("超过 500 元,要转组长审批")
    print("已记录审批人")
print("检查结束")
```

<div class="line-notes">

- `amount = int(input("退款金额(元):"))` Day 14 的写法:读一行字符串,马上转成整数。输入 `299` 就得到整数 299。
- `if amount > 500:` `if` 后面跟一个条件(一个得到 `True` 或 `False` 的表达式),末尾一个**冒号**。条件成立,就执行下面缩进的那些行。
- `print("超过 500 元,要转组长审批")` 前面空了 4 个格。缩进就是「这几行属于上面那个 if」的标记。
- `print("已记录审批人")` 同样缩进 4 格,和上一行是同一个块,条件成立时两行一起执行。
- `print("检查结束")` 没有缩进,回到最左边,表示 if 块结束了。这一行不管条件成不成立都会执行。

</div>

```text
$ cd ~/agent-zero-lab
$ uv run python part01/if_basic.py
退款金额(元):299
检查结束
$ uv run python part01/if_basic.py
退款金额(元):800
超过 500 元,要转组长审批
已记录审批人
检查结束
```

<div class="line-notes">

- `退款金额(元):299` 299 > 500 不成立。
- `检查结束` 整个 if 块被跳过了,只打印最后一行。
- `退款金额(元):800` 800 > 500 成立。
- `超过 500 元,要转组长审批` 块里的第一行。
- `已记录审批人` 块里的第二行。
- `检查结束` 缩进回到最左边的那一行,两次都会执行。

</div>

JS 里同样的逻辑是:

```js
if (amount > 500) {
  console.log("超过 500 元,要转组长审批");
  console.log("已记录审批人");
}
console.log("检查结束");
```

两种写法的区别只有一处:JS 用花括号 `{ }` 圈出一个块,缩进只是给人看的;Python **没有花括号,缩进本身就是语法**。冒号和缩进缺一不可。

### 缩进和冒号写错了会怎样

Python 写错缩进或冒号,程序一行都不会执行,直接报错。三个初学者最常碰到的:

```python
# agent-zero-lab/part01/indent_error.py
amount = 800
if amount > 500:
print("转组长审批")
```

```text
$ uv run python part01/indent_error.py
  File "/Users/你/agent-zero-lab/part01/indent_error.py", line 4
    print("转组长审批")
    ^^^^^
IndentationError: expected an indented block after 'if' statement on line 3
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/indent_error.py", line 4` 出事在第 4 行。
- `print("转组长审批")` 报错指向这一行,指示条 `^^^^^` 在 `print` 上。
- `IndentationError: expected an indented block after 'if' statement on line 3` 第 3 行的 `if` 后面应该有一个缩进的块,第 4 行却没缩进。修法:给第 4 行前面加 4 个空格。

</div>

```python
# agent-zero-lab/part01/colon_error.py
amount = 800
if amount > 500
    print("转组长审批")
```

```text
$ uv run python part01/colon_error.py
  File "/Users/你/agent-zero-lab/part01/colon_error.py", line 3
    if amount > 500
                   ^
SyntaxError: expected ':'
```

<div class="line-notes">

- `line 3` 第 3 行。
- `if amount > 500` 指示条 `^` 落在行尾。
- `SyntaxError: expected ':'` 缺了冒号。Python 3.10 以后报错信息已经很直白了,以前只写 `invalid syntax`。

</div>

```python
# agent-zero-lab/part01/assign_error.py
amount = 800
if amount = 500:
    print("刚好 500")
```

```text
$ uv run python part01/assign_error.py
  File "/Users/你/agent-zero-lab/part01/assign_error.py", line 3
    if amount = 500:
       ^^^^^^^^^^^^
SyntaxError: invalid syntax. Maybe you meant '==' or ':=' instead of '='?
```

<div class="line-notes">

- `line 3` 第 3 行。
- `if amount = 500:` 单个等号是赋值,不是比较。
- `SyntaxError: invalid syntax. Maybe you meant '==' or ':=' instead of '='?` Python 直接猜出你想写的是 `==`。JS 里 `if (amount = 500)` 不会报错,它先把 500 赋给 `amount`,再把 500 当成「真」,能跑、结果全错;Python 把这个坑堵死了。

</div>

这三个文件你的 Zed 里会直接显示红线,Ruff 也不会给你「一切正常」,而是告诉你 `Failed to parse`(解析不了)。写 Python 缩进的规矩:**一级缩进固定 4 个空格**,别混用 Tab 和空格。Zed 默认敲 Tab 会插 4 个空格,不用你操心。

### if / else:二选一

只有「成立才做」不够,常常是两条路都要走。新建 `part01/if_else.py`:

```python
# agent-zero-lab/part01/if_else.py
amount = int(input("退款金额(元):"))

if amount <= 500:
    print("一线客服可以直接批准")
else:
    print("超过 500 元,转组长审批")
```

<div class="line-notes">

- `amount = int(input("退款金额(元):"))` 读金额。
- `if amount <= 500:` 条件:小于等于 500。注意等号:刚好 500 元算一线批准。
- `print("一线客服可以直接批准")` 条件成立时走这里。
- `else:` 「否则」,后面也有一个冒号,不跟条件。`else` 要和 `if` 对齐,都在最左边。
- `print("超过 500 元,转组长审批")` 条件不成立时走这里。

</div>

```text
$ uv run python part01/if_else.py
退款金额(元):299
一线客服可以直接批准
$ uv run python part01/if_else.py
退款金额(元):800
超过 500 元,转组长审批
```

<div class="line-notes">

- `一线客服可以直接批准` 299 ≤ 500,走 if。
- `超过 500 元,转组长审批` 800 > 500,走 else。两条路里**必走其一,且只走一条**。

</div>

### elif:三选一、四选一

分支多了,用 `elif`(else if 的缩写,JS 里是 `else if`)。要求:金额小于等于 0 的无效;500 元以内一线批准;5000 元以内组长批准;再多要财务和组长一起批。新建 `part01/if_elif.py`:

```python
# agent-zero-lab/part01/if_elif.py
amount = int(input("退款金额(元):"))

if amount <= 0:
    print("金额无效")
elif amount <= 500:
    print("一线客服可以直接批准")
elif amount <= 5000:
    print("需要组长审批")
else:
    print("需要财务和组长一起审批")
```

<div class="line-notes">

- `amount = int(input("退款金额(元):"))` 读金额。
- `if amount <= 0:` 第一道关:非正数先挡掉。
- `print("金额无效")` 走到这里说明金额 ≤ 0。
- `elif amount <= 500:` 第二道关。能走到这里,说明上面的 `amount <= 0` 已经**不成立**了,所以这一支的真实含义是「0 < amount ≤ 500」,不用再写 `amount > 0 and`。
- `print("一线客服可以直接批准")` 0 到 500 之间。
- `elif amount <= 5000:` 第三道关。能走到这里,说明 `amount > 500`,所以含义是 500 到 5000。
- `print("需要组长审批")` 500 到 5000 之间。
- `else:` 以上都不成立,那就是大于 5000。
- `print("需要财务和组长一起审批")` 大额。

</div>

用几组边界值试:

```text
$ uv run python part01/if_elif.py
退款金额(元):-5
金额无效
$ uv run python part01/if_elif.py
退款金额(元):0
金额无效
$ uv run python part01/if_elif.py
退款金额(元):299
一线客服可以直接批准
$ uv run python part01/if_elif.py
退款金额(元):500
一线客服可以直接批准
$ uv run python part01/if_elif.py
退款金额(元):501
需要组长审批
$ uv run python part01/if_elif.py
退款金额(元):8000
需要财务和组长一起审批
```

<div class="line-notes">

- `退款金额(元):-5` 负数。
- `金额无效` 第一支。
- `退款金额(元):0` 刚好 0,`<= 0` 成立。
- `退款金额(元):299` 正常的 T001。
- `一线客服可以直接批准` 第二支。
- `退款金额(元):500` 边界值:刚好 500。`<= 500` 包含 500,所以一线能批。如果写成 `< 500`,500 就会掉到组长那一支。边界值要拿业务规则确认:「500 元以内」到底含不含 500。
- `退款金额(元):501` 刚过边界。
- `需要组长审批` 第三支。
- `退款金额(元):8000` 大额。
- `需要财务和组长一起审批` 走到 `else`。

</div>

用一张图看这条链,每个菱形是一道关,**从上往下,碰到第一个成立的就走那条路,后面的条件根本不会去看**:

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="退款金额判断流程:amount 小于等于 0 则金额无效;否则小于等于 500 则一线批准;否则小于等于 5000 则组长审批;否则财务和组长一起审批">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="20" width="150" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="45" fill="var(--ink)">amount &lt;= 0 ?</text>
<rect x="260" y="20" width="150" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="272" y="45" fill="var(--ink)">金额无效</text>
<line x1="170" y1="40" x2="260" y2="40" stroke="var(--ink-soft)"/>
<text x="198" y="34" fill="var(--ink-soft)" font-size="11">是</text>
<rect x="20" y="95" width="150" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="120" fill="var(--ink)">amount &lt;= 500 ?</text>
<line x1="95" y1="60" x2="95" y2="95" stroke="var(--ink-soft)"/>
<text x="102" y="82" fill="var(--ink-soft)" font-size="11">否</text>
<rect x="260" y="95" width="150" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="272" y="120" fill="var(--ink)">一线批准</text>
<line x1="170" y1="115" x2="260" y2="115" stroke="var(--ink-soft)"/>
<text x="198" y="109" fill="var(--ink-soft)" font-size="11">是</text>
<rect x="20" y="170" width="150" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="195" fill="var(--ink)">amount &lt;= 5000 ?</text>
<line x1="95" y1="135" x2="95" y2="170" stroke="var(--ink-soft)"/>
<text x="102" y="157" fill="var(--ink-soft)" font-size="11">否</text>
<rect x="260" y="170" width="150" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="272" y="195" fill="var(--ink)">组长审批</text>
<line x1="170" y1="190" x2="260" y2="190" stroke="var(--ink-soft)"/>
<text x="198" y="184" fill="var(--ink-soft)" font-size="11">是</text>
<rect x="20" y="245" width="220" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="32" y="270" fill="var(--ink)">else:财务 + 组长</text>
<line x1="95" y1="210" x2="95" y2="245" stroke="var(--ink-soft)"/>
<text x="102" y="232" fill="var(--ink-soft)" font-size="11">否</text>
<text x="440" y="45" fill="var(--ink-soft)">-5, 0</text>
<text x="440" y="120" fill="var(--ink-soft)">299, 500</text>
<text x="440" y="195" fill="var(--ink-soft)">501, 5000</text>
<text x="260" y="270" fill="var(--ink-soft)">8000</text>
</g>
</svg>
<figcaption>elif 链是一条从上到下的筛子,每道关只会看到被上面所有关放过的值。</figcaption>
</figure>

### 顺序错了,结果就错

「第一个成立的就停」意味着**条件的顺序很重要**。把上面的链故意写错顺序,新建 `part01/if_order_bug.py`:

```python
# agent-zero-lab/part01/if_order_bug.py
amount = int(input("退款金额(元):"))

if amount > 0:
    print("一线客服可以直接批准")
elif amount > 5000:
    print("需要财务和组长一起审批")
else:
    print("金额无效")
```

<div class="line-notes">

- `amount = int(input("退款金额(元):"))` 读金额。
- `if amount > 0:` 第一支:大于 0 就算「一线批准」。8000 元也大于 0。
- `print("一线客服可以直接批准")` 所有正数都在这里被截走。
- `elif amount > 5000:` 这一支永远走不到,因为大于 5000 的数一定也大于 0,早被第一支拦走了。
- `print("需要财务和组长一起审批")` 死代码。
- `else:` 只有 ≤ 0 的才到这里。
- `print("金额无效")` 无效金额。

</div>

```text
$ uv run python part01/if_order_bug.py
退款金额(元):299
一线客服可以直接批准
$ uv run python part01/if_order_bug.py
退款金额(元):8000
一线客服可以直接批准
$ uv run python part01/if_order_bug.py
退款金额(元):-5
金额无效
```

<div class="line-notes">

- `退款金额(元):299` 正常。
- `一线客服可以直接批准` 对。
- `退款金额(元):8000` 8000 元的退款。
- `一线客服可以直接批准` 错了!应该走财务审批。没有任何报错,金额大了一线客服也能批,这种业务错误比崩溃危险得多。
- `退款金额(元):-5` 负数。
- `金额无效` 对。

</div>

写 elif 链的口诀:**从最严格、最特殊的写起,最宽松的放最后**,或者像 `if_elif.py` 那样,每一支都靠上一支的「不成立」来收窄范围。写完一定要用边界值各试一遍。

## and、or、not:把条件组合起来

### 三个运算符

一个条件常常不够。「金额在 0 到 500 之间并且不是 VIP」「是 VIP 或者金额很大」,要把几个比较组合起来。Python 用单词,JS 用符号:

| 含义 | Python | JS |
| --- | --- | --- |
| 并且(两个都成立才成立) | `and` | `&&` |
| 或者(至少一个成立就成立) | `or` | `||` |
| 取反 | `not` | `!` |

新建 `part01/bool_ops.py`:

```python
# agent-zero-lab/part01/bool_ops.py
amount = 299
is_vip = False

print(amount > 0 and amount <= 500)
print(amount > 500 or is_vip)
print(not is_vip)
print(not amount > 500)

print(amount != 0 and 10000 / amount > 1)
zero = 0
print(zero != 0 and 10000 / zero > 1)

typed = ""
name = typed or "匿名客户"
print(name)
print(amount and "有金额")
nothing = None
print(nothing or zero or "最后一个")
print(zero and "不会走到这里")
```

<div class="line-notes">

- `amount = 299` T001 的 299 元。
- `is_vip = False` 假设这个客户不是 VIP。名字用 `is_` 开头,一看就是个是非题(Day 14)。
- `print(amount > 0 and amount <= 500)` `and`:左右两边都是 `True` 才是 `True`。299 > 0 成立、299 ≤ 500 成立,得 `True`。这个等价于 Day 14 的连写 `0 < amount <= 500`。
- `print(amount > 500 or is_vip)` `or`:至少一边是 `True` 就是 `True`。299 > 500 不成立,`is_vip` 是 `False`,两边都假,得 `False`。
- `print(not is_vip)` `not` 把真假反过来,`not False` 得 `True`。
- `print(not amount > 500)` `not` 管的是它后面整个比较:先算 `amount > 500` 得 `False`,再取反得 `True`。
- `print(amount != 0 and 10000 / amount > 1)` 保护除法。`amount` 是 299,所以右边也要算:10000 / 299 约 33.4,大于 1,得 `True`。
- `zero = 0` 现在换一个 0。
- `print(zero != 0 and 10000 / zero > 1)` 同样的写法,`zero` 是 0。左边 `0 != 0` 是 `False`,结果已经定了,Python 根本不去算右边的 `10000 / 0`,所以没有报错,直接得 `False`。这叫短路求值。
- `typed = ""` 假装用户什么都没输入。
- `name = typed or "匿名客户"` `or` 的另一种用法:左边是「假」(空字符串)就取右边的。
- `print(name)` 看取了哪边。
- `print(amount and "有金额")` `and`:左边是「真」(299)就取右边。
- `nothing = None` 一个 `None`。
- `print(nothing or zero or "最后一个")` 连着 `or`:从左往右找第一个「真」的,`None` 假、`0` 假,走到最后一个,不管它是真是假都取它。
- `print(zero and "不会走到这里")` `and`:左边是「假」,直接返回左边,右边不看。

</div>

```text
$ uv run python part01/bool_ops.py
True
False
True
True
True
False
匿名客户
有金额
最后一个
0
```

<div class="line-notes">

- `True` `299 > 0 and 299 <= 500`。
- `False` `299 > 500 or False`。
- `True` `not False`。
- `True` `not (299 > 500)`。
- `True` 右边算了,10000 / 299 大于 1。
- `False` 短路:左边已经 `False`,右边没算,所以没有 `ZeroDivisionError`。
- `匿名客户` 空字符串是假,取右边。
- `有金额` 299 是真,取右边。
- `最后一个` `None` 和 `0` 都是假,取最后一个。
- `0` `and` 左边是假,结果就是左边那个值 `0`,而不是 `False`。

</div>

最后两行揭示了一件和 JS 一样的事:**`and` 和 `or` 返回的不是 `True`/`False`,而是参与运算的某个值本身**。`typed or "匿名客户"` 就是一句常见的「给缺失值一个默认值」,JS 里写 `typed || "匿名客户"`,完全一样。

### 短路求值:左边定了,右边就不看

上面 `zero != 0 and 10000 / zero > 1` 没报错,是因为 `and` 左边是假就不看右边。反过来写,把危险的计算放在左边,就没有保护了:

```python
# agent-zero-lab/part01/zero_div.py
zero = 0
print(10000 / zero > 1 and zero != 0)
```

```text
$ uv run python part01/zero_div.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/zero_div.py", line 3, in <module>
    print(10000 / zero > 1 and zero != 0)
          ~~~~~~^~~~~~
ZeroDivisionError: division by zero
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/zero_div.py", line 3` 出事在第 3 行。
- `print(10000 / zero > 1 and zero != 0)` 先算左边,10000 / 0 就炸了,没机会看到右边的保护。
- `~~~~~~^~~~~~` 指示条标出出错的除法。
- `ZeroDivisionError: division by zero` 除以零。

</div>

所以条件里**先放便宜的、安全的判断,再放贵的、有风险的**。比如先判断「列表不为空」再取第一个,先判断「不是 None」再调用方法。

下面是三个运算符的真值表,画一张图备查:

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="and、or、not 的真值表:and 两边都真才真,or 至少一边真就真,not 取反;and 左边假则不看右边,or 左边真则不看右边">
<rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink-faint)">A     B      A and B     A or B</text>
<text x="20" y="52" fill="var(--ink)">真    真       真          真</text>
<text x="20" y="74" fill="var(--ink)">真    假       假          真</text>
<text x="20" y="96" fill="var(--ink)">假    真       假          真</text>
<text x="20" y="118" fill="var(--ink)">假    假       假          假</text>
<text x="20" y="150" fill="var(--ink-faint)">not 真 → 假      not 假 → 真</text>
<rect x="340" y="14" width="280" height="76" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="352" y="38" fill="var(--ink)">A and B:A 是假就停</text>
<text x="352" y="60" fill="var(--ink-soft)">B 不会被计算,结果就是 A 的值</text>
<text x="352" y="80" fill="var(--ink-soft)">0 and "x" → 0</text>
<rect x="340" y="100" width="280" height="76" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="352" y="124" fill="var(--ink)">A or B:A 是真就停</text>
<text x="352" y="146" fill="var(--ink-soft)">B 不会被计算,结果就是 A 的值</text>
<text x="352" y="166" fill="var(--ink-soft)">"" or "匿名" → "匿名"</text>
<text x="20" y="200" fill="var(--ink-soft)">优先级:not 最高,and 其次,or 最低。不确定就加括号</text>
</g>
</svg>
<figcaption>真值表加短路规则。and 和 or 都是「从左往右,能定结果就立刻停」。</figcaption>
</figure>

优先级:`not` 先算,然后 `and`,最后 `or`。`a or b and c` 等价于 `a or (b and c)`,和数学里「先乘后加」一个道理。**写条件时多加括号**,既不会算错,也让读代码的人省心。

### if 里的真值:空的就是假

Day 14 讲过「什么算假」:`0`、空字符串、`None`、空列表都是假,其余是真。放进 `if` 里,可以省掉显式的比较。新建 `part01/truthy_if.py`:

```python
# agent-zero-lab/part01/truthy_if.py
text = ""
coupon = 0
parts = []

if not text:
    print("没有输入内容")

if coupon:
    print("有优惠券")
else:
    print("coupon 是 0,被当成没有")

if coupon is not None:
    print("coupon 不是 None,说明有优惠券,只是 0 元")

if not parts:
    print("拆出来是空的")
```

<div class="line-notes">

- `text = ""` 一个空字符串,假装用户没输入。
- `coupon = 0` 优惠券金额 0 元。
- `parts = []` 一个空列表,假装 `split` 之后什么都没有。
- `if not text:` 空字符串是假,`not` 之后变真,进入分支。这是「检查有没有输入」最常见的写法,比 `if text == "":` 简洁。
- `print("没有输入内容")` 走到这里。
- `if coupon:` 把一个整数直接放进 `if`:0 是假,所以不进。
- `print("有优惠券")` 不会执行。
- `else:` 走这一支。
- `print("coupon 是 0,被当成没有")` 问题在这里:「有一张 0 元的优惠券」和「没有优惠券」在业务上是两回事,`if coupon:` 把它们混了。
- `if coupon is not None:` 想区分「没有」和「0」,要明确地判断它是不是 `None`(Day 14 的 `is not None`)。
- `print("coupon 不是 None,说明有优惠券,只是 0 元")` 这样才对。
- `if not parts:` 空列表是假。
- `print("拆出来是空的")` 走到这里。

</div>

```text
$ uv run python part01/truthy_if.py
没有输入内容
coupon 是 0,被当成没有
coupon 不是 None,说明有优惠券,只是 0 元
拆出来是空的
```

<div class="line-notes">

- `没有输入内容` 第一个 if 成立。
- `coupon 是 0,被当成没有` `if coupon:` 把 0 当成假。
- `coupon 不是 None,说明有优惠券,只是 0 元` 用 `is not None` 区分对了。
- `拆出来是空的` 空列表是假。

</div>

原则:**要判断「有没有」,而 0 又是合法的值时,用 `is None`/`is not None`**;只关心「内容是否为空」时(字符串、列表),直接用 `if x:`/`if not x:`。

### 最常见的陷阱:`x == "a" or "b"`

JS 和 Python 都有这个坑,而且几乎每个新手都会写一遍。想表达「类别是计费或者 billing」,新手会这样写。新建 `part01/or_bug.py`:

```python
# agent-zero-lab/part01/or_bug.py
category = "登录"

if category == "计费" or "billing":
    print("进了计费分支")
else:
    print("没进计费分支")

if category == "计费" or category == "billing":
    print("进了计费分支")
else:
    print("没进计费分支")

if category in ("计费", "billing"):
    print("进了计费分支")
else:
    print("没进计费分支")
```

<div class="line-notes">

- `category = "登录"` 一个明显不是计费的类别。
- `if category == "计费" or "billing":` 看着像自然语言「等于计费或 billing」,Python 实际读成两半:`(category == "计费")` 和 `"billing"`。`"billing"` 是个非空字符串,是真,所以整个条件永远是真。
- `print("进了计费分支")` 它会走到这里。
- `else:` 永远走不到。
- `print("没进计费分支")` 死代码。
- `if category == "计费" or category == "billing":` 正确写法一:每半都写完整的比较。
- `if category in ("计费", "billing"):` 正确写法二:用 `in` 判断是不是「这几个里的任何一个」。括号里这一组值叫元组(tuple,Day 22 讲),今天只要知道它能放几个值就行,JS 里相当于 `["计费", "billing"].includes(category)`。

</div>

```text
$ uv run python part01/or_bug.py
进了计费分支
没进计费分支
没进计费分支
```

<div class="line-notes">

- `进了计费分支` 第一个 if:类别明明是「登录」,却进了计费分支。
- `没进计费分支` 第二个 if,完整比较,对。
- `没进计费分支` 第三个 if,用 `in`,也对。

</div>

好消息是 Ruff 会给第一种写法画线:`SIM222 Use `True` instead of `... or True``,意思是「这个条件永远是 True」。你在 Zed 里看到这个黄线,先别忽略它。

### 一行的 if:条件表达式

简单的二选一可以写成一行:`值1 if 条件 else 值2`,相当于 JS 的 `条件 ? 值1 : 值2`。新建 `part01/ternary.py`:

```python
# agent-zero-lab/part01/ternary.py
times = 2
label = "需要退款" if times > 1 else "无需退款"
print(label)
times = 1
print("需要退款" if times > 1 else "无需退款")
```

<div class="line-notes">

- `times = 2` 扣了两次。
- `label = "需要退款" if times > 1 else "无需退款"` 条件在中间:`times > 1` 成立取前面的值,不成立取后面的。读起来像一句英文。
- `print(label)` 看结果。
- `times = 1` 改成 1 次。
- `print("需要退款" if times > 1 else "无需退款")` 也可以直接塞进 `print` 的括号里,不用先存变量。

</div>

```text
$ uv run python part01/ternary.py
需要退款
无需退款
```

<div class="line-notes">

- `需要退款` 2 > 1。
- `无需退款` 1 > 1 不成立。

</div>

只在非常简单的二选一时用这种写法,条件一复杂就老老实实写 `if/else`,不然读的人要停下来解码。

## 拼起来

### 用关键词给工单分类

Agent 工程师经常做的一件事是给用户的话分类:这是问计费的、登录的,还是功能的?最朴素的办法是看有没有某些关键词。新建 `part01/classify.py`:

```python
# agent-zero-lab/part01/classify.py
desc = input("工单描述:").strip()
text = desc.lower()

if (
    "扣" in text
    or "退款" in text
    or "发票" in text
    or "金额" in text
    or "refund" in text
    or "charge" in text
):
    category = "计费"
elif "登录" in text or "验证码" in text or "密码" in text or "password" in text:
    category = "登录"
else:
    category = "功能"

print(f"类别:{category}")
```

<div class="line-notes">

- `desc = input("工单描述:").strip()` 读一行描述,去掉两头空白(Day 16)。
- `text = desc.lower()` 转成小写,英文工单大小写就不影响匹配(Day 16 的 `case_demo.py`)。
- `if (` 条件很长,用括号把它括起来,就可以在括号里随便换行。
- `"扣" in text` 第一个关键词。`in` 判断「扣」这个字是不是出现在文本里。
- `or "退款" in text` 每个 `or` 另起一行,每行一个条件,对齐。这是格式化工具 `ruff format` 的标准写法,读起来是一张清单。
- `or "发票" in text` 发票也算计费。
- `or "金额" in text` 金额。
- `or "refund" in text` 英文关键词,所以前面才要转小写。
- `or "charge" in text` 英文的扣费。
- `):` 括号收尾,冒号不能漏。
- `category = "计费"` 命中任何一个关键词,归为计费。
- `elif "登录" in text or "验证码" in text or "密码" in text or "password" in text:` 登录类。条件短,一行放得下。
- `category = "登录"` 登录。
- `else:` 都没命中。
- `category = "功能"` 其余统一归功能。
- `print(f"类别:{category}")` 打印结果。

</div>

拿 Day 5 里的几张真实工单试试:

```text
$ uv run python part01/classify.py
工单描述:10月3日和10月5日各扣了一次299元,被扣了两次
类别:计费
$ uv run python part01/classify.py
工单描述:Forgot password email never arrived
类别:登录
$ uv run python part01/classify.py
工单描述:导出发票PDF时中文显示成方框
类别:计费
$ uv run python part01/classify.py
工单描述:想把月付改成年付,差价怎么算
类别:功能
```

<div class="line-notes">

- `工单描述:10月3日和10月5日各扣了一次299元,被扣了两次` T001。
- `类别:计费` 命中「扣」。对。
- `工单描述:Forgot password email never arrived` T005。
- `类别:登录` 转小写后命中 `password`。对。
- `工单描述:导出发票PDF时中文显示成方框` T004。
- `类别:计费` 错了。描述里有「发票」两个字,命中了计费规则,但这张是「导出 PDF 时中文成方框」,Day 5 的人工分类是「功能」。
- `工单描述:想把月付改成年付,差价怎么算` T003。
- `类别:功能` 也错了。人工分类是「计费」,可描述里没有任何一个关键词,只能掉进 `else`。

</div>

我把 Day 5 的 9 张工单全部跑了一遍(用终端里的循环批量喂输入,等你学了 Day 18 的 `for`,可以在 Python 里自己写),和 Day 5 人工分的类别对照:

| 工单 | 人工类别 | 规则结果 | 对不对 |
| --- | --- | --- | --- |
| T001 被扣了两次 | 计费 | 计费 | 对 |
| T002 手机验证码收不到 | 登录 | 登录 | 对 |
| T003 月付改年付,差价怎么算 | 计费 | 功能 | 错,没有关键词 |
| T004 导出发票 PDF 中文显示成方框 | 功能 | 计费 | 错,「发票」抢先 |
| T005 Forgot password | 登录 | 登录 | 对 |
| T006 Refund request | 计费 | 计费 | 对 |
| T007 发票抬头能改成英文 | 功能 | 计费 | 错,「发票」抢先 |
| T008 发票金额和订单金额对不上 | 计费 | 计费 | 对 |
| T009 续费后发票没有发到邮箱 | 计费 | 计费 | 对 |

9 张对 6 张,错的三张两种毛病:一种是**关键词太宽**(「发票」既出现在计费工单,也出现在功能工单),一种是**关键词没覆盖**(T003 用的是「月付」「年付」,规则里没有)。

可以接着补规则:把「导出」「抬头」「PDF」「方框」这些功能类的词放到最前面先判断,再把「月付」「年付」加进计费词里。这是 `part01/classify2.py`:

```python
# agent-zero-lab/part01/classify2.py
desc = input("工单描述:").strip()
text = desc.lower()

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

print(f"类别:{category}")
```

<div class="line-notes">

- `desc = input("工单描述:").strip()` 同上。
- `text = desc.lower()` 同上。
- `if "导出" in text or "抬头" in text or "pdf" in text or "方框" in text:` 功能类的词放到**最前面**先判断。`pdf` 要写小写,因为 `text` 已经被转成小写了,大写的 `PDF` 在 `text` 里是 `pdf`。
- `category = "功能"` 命中功能词,就是功能,后面的计费规则不会再看(「第一个成立的就停」)。
- `elif (` 计费类的条件,括号换行写。
- `or "月付" in text` 新加的,管 T003。
- `or "年付" in text` 同上。
- `):` 括号收尾。
- `category = "计费"` 计费。
- `elif "登录" in text or "验证码" in text or "密码" in text or "password" in text:` 登录类不变。
- `category = "登录"` 登录。
- `else:` 其余。
- `category = "功能"` 默认功能。
- `print(f"类别:{category}")` 同上。

</div>

```text
$ uv run python part01/classify2.py
工单描述:导出发票PDF时中文显示成方框
类别:功能
$ uv run python part01/classify2.py
工单描述:想把月付改成年付,差价怎么算
类别:计费
```

<div class="line-notes">

- `工单描述:导出发票PDF时中文显示成方框` T004,再试一遍。
- `类别:功能` 对了。「导出」命中,功能类在前面先拦住。
- `工单描述:想把月付改成年付,差价怎么算` T003。
- `类别:计费` 对了。「月付」命中。

</div>

9 张全对了(我也跑了全部 9 张)。但是**别高兴得太早**:我是看着这 9 张的答案去补关键词的。这种「看着答案调规则」,在测试集上漂亮、在新工单上不一定对,专业的叫法是**过拟合**。明天来了一张「我想要一份发票的 PDF 版本」,它会被「PDF」拦成功能,实际是计费。关键词规则的上限就在这里:好调、可解释、不花钱,但覆盖不全、改一处碰一处。用大模型来分类就是为了解决这个问题,这门课的 Day 341 起会讲怎么**用一批标好的工单去测量**分类的准确率,而不是靠感觉。现在你手里至少有了第一个基线:关键词规则 6/9 → 9/9(但只在这 9 张上),以后任何更聪明的方案都要和它比。

### 退款规则:先校验,再分级

把 Day 16 的清洗和今天的 if/elif 合起来。新建 `part01/refund_rule.py`,先判断输入是不是合法数字,再算,再按金额决定谁来批:

```python
# agent-zero-lab/part01/refund_rule.py
import unicodedata

price_text = unicodedata.normalize("NFKC", input("单价(元,可带小数):")).strip()
price_text = price_text.removeprefix("¥").removesuffix("元").strip().replace(",", "")
times_text = unicodedata.normalize("NFKC", input("被扣了几次:")).strip()
times_text = times_text.removesuffix("次").strip()

if not price_text.replace(".", "", 1).isdigit():
    print(f"单价「{price_text}」不是数字,请检查后重新运行")
elif not times_text.isdigit():
    print(f"次数「{times_text}」不是整数,请检查后重新运行")
else:
    price_fen = round(float(price_text) * 100)
    times = int(times_text)
    if times <= 1:
        print("只扣了一次,无需退款")
    else:
        refund_fen = price_fen * (times - 1)
        if refund_fen <= 50000:
            approver = "一线客服可以直接批准"
        elif refund_fen <= 500000:
            approver = "需要组长审批"
        else:
            approver = "需要财务和组长一起审批"
        print(f"应退 {refund_fen / 100:,.2f} 元,{approver}")
```

<div class="line-notes">

- `import unicodedata` 规范化要用。
- `price_text = unicodedata.normalize("NFKC", input("单价(元,可带小数):")).strip()` Day 16 的清洗,这次把 `input(...)` 直接塞进 `normalize` 里,少一个中间变量。
- `price_text = price_text.removeprefix("¥").removesuffix("元").strip().replace(",", "")` 一条链:去 `¥`、去「元」、去空白、去千位逗号。
- `times_text = unicodedata.normalize("NFKC", input("被扣了几次:")).strip()` 次数同样。
- `times_text = times_text.removesuffix("次").strip()` 去掉「次」。
- `if not price_text.replace(".", "", 1).isdigit():` 校验单价。`replace(".", "", 1)` 把第一个小数点去掉(只换一次,第三个参数是次数),`isdigit()` 判断剩下的是不是全是数字。`"19.99"` 去掉点是 `"1999"`,通过;`"abc"` 通不过;`""` 空串 `isdigit()` 也是 `False`,所以直接回车也会被挡住。`not` 取反:不是数字就进这个分支。
- `print(f"单价「{price_text}」不是数字,请检查后重新运行")` 友好的提示,把用户输入的内容放进去。
- `elif not times_text.isdigit():` 单价过关了,再校验次数。次数不允许小数点,直接 `isdigit()`。
- `print(f"次数「{times_text}」不是整数,请检查后重新运行")` 次数的提示。
- `else:` 两项都合法,才进真正的计算。
- `price_fen = round(float(price_text) * 100)` 到了这里 `float()` 一定不会崩。缩进了 4 格,属于 else 块。
- `times = int(times_text)` 同上。
- `if times <= 1:` else 里面又有一个 if,这叫嵌套,多缩进一层(8 格)。
- `print("只扣了一次,无需退款")` 没多扣。
- `else:` 这个 else 和上一行的 `if times <= 1` 对齐,属于内层。
- `refund_fen = price_fen * (times - 1)` 多扣了几次就退几次。
- `if refund_fen <= 50000:` 分级:500 元就是 50000 分,所以阈值用分。
- `approver = "一线客服可以直接批准"` 把结果存进变量,最后统一打印。
- `elif refund_fen <= 500000:` 5000 元 = 500000 分。
- `approver = "需要组长审批"` 中间一档。
- `else:` 大额。
- `approver = "需要财务和组长一起审批"` 最高档。
- `print(f"应退 {refund_fen / 100:,.2f} 元,{approver}")` 缩进 8 格,在内层 else 里,最后统一打印金额和审批人。

</div>

```text
$ uv run python part01/refund_rule.py
单价(元,可带小数):299
被扣了几次:2
应退 299.00 元,一线客服可以直接批准
$ uv run python part01/refund_rule.py
单价(元,可带小数):299元
被扣了几次:4
应退 897.00 元,需要组长审批
$ uv run python part01/refund_rule.py
单价(元,可带小数):¥1,999
被扣了几次:4 次
应退 5,997.00 元,需要财务和组长一起审批
$ uv run python part01/refund_rule.py
单价(元,可带小数):299
被扣了几次:1
只扣了一次,无需退款
$ uv run python part01/refund_rule.py
单价(元,可带小数):abc
被扣了几次:2
单价「abc」不是数字,请检查后重新运行
$ uv run python part01/refund_rule.py
单价(元,可带小数):299
被扣了几次:两次
次数「两」不是整数,请检查后重新运行
```

<div class="line-notes">

- `单价(元,可带小数):299` T001,扣了 2 次。
- `应退 299.00 元,一线客服可以直接批准` 299 × 1 = 299 元 = 29900 分,≤ 50000,一线。
- `单价(元,可带小数):299元` 带「元」的,清洗后是 299。
- `被扣了几次:4` 扣 4 次,多扣 3 次。
- `应退 897.00 元,需要组长审批` 299 × 3 = 897 元 = 89700 分,超过 50000、不超过 500000,组长。
- `单价(元,可带小数):¥1,999` 带 `¥` 和逗号的。
- `被扣了几次:4 次` 带「次」的。
- `应退 5,997.00 元,需要财务和组长一起审批` 1999 × 3 = 5997 元 = 599700 分,超过 500000,财务。
- `被扣了几次:1` 只扣一次。
- `只扣了一次,无需退款` `times <= 1` 的分支。
- `单价(元,可带小数):abc` Day 16 里这里是 `ValueError` 崩溃。
- `单价「abc」不是数字,请检查后重新运行` 现在被 if 挡住了,不再崩溃。
- `被扣了几次:两次` 中文数字的次数。
- `次数「两」不是整数,请检查后重新运行` 去掉「次」之后剩下「两」,`isdigit()` 不认,被挡住。

</div>

注意这里做的是**先检查再动手**(程序员叫「前置校验」):一进来先看输入合不合格,不合格就给提示、不往下走。另一种思路是「先动手,出错了再接住」,用异常处理,[Day 35](/blog/agent-zero/day-035-exceptions-1/) 学。两种在真实代码里都会用,各有适合的场合。

### 给 ticket_card2.py 补上段数检查

Day 16 里,`T009 计费` 这种只有两段的行让 `ticket_card2.py` 报 `IndexError`。现在补上检查。这是 Day 16 建的文件,把拆分之后的部分放进 if/else:

```python
# agent-zero-lab/part01/ticket_card2.py
line = input("工单行:").strip()
parts = line.split(maxsplit=3)

if len(parts) < 4:
    print(f"这行只拆出 {len(parts)} 段,至少要 4 段(工单号 类别 客户号 描述):「{line}」")
else:
    ticket_id = parts[0]
    category = parts[1]
    customer = parts[2]
    desc = parts[3]
    number = int(ticket_id.removeprefix("T"))

    print(f"工单 {ticket_id}(第 {number} 号) | 类别 {category} | 客户 {customer}")
    print(f"描述:{desc}")
    print(f"提到发票:{'发票' in desc}")
```

<div class="line-notes">

- `line = input("工单行:").strip()` 读一行,去空白。
- `parts = line.split(maxsplit=3)` 拆成最多四段。
- `if len(parts) < 4:` 段数不够 4 就是残缺行。`len(parts)` 数列表里有几项(和数字符串字符数是同一个函数)。
- `print(f"这行只拆出 {len(parts)} 段,至少要 4 段(工单号 类别 客户号 描述):「{line}」")` 给一个能看懂的提示,把原始行也打印出来方便排查。
- `else:` 段数够了。
- `ticket_id = parts[0]` 以下和 Day 16 一样,只是都缩进了 4 格,放进了 else 块。
- `category = parts[1]` 类别。
- `customer = parts[2]` 客户号。
- `desc = parts[3]` 描述。
- `number = int(ticket_id.removeprefix("T"))` 工单编号。
- `print(f"工单 {ticket_id}(第 {number} 号) | 类别 {category} | 客户 {customer}")` 摘要。
- `print(f"描述:{desc}")` 描述。
- `print(f"提到发票:{'发票' in desc}")` 是否提到发票。

</div>

```text
$ uv run python part01/ticket_card2.py
工单行:T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次
工单 T001(第 1 号) | 类别 计费 | 客户 C023
描述:10月3日和10月5日各扣了一次299元,被扣了两次
提到发票:False
$ uv run python part01/ticket_card2.py
工单行:T009 计费
这行只拆出 2 段,至少要 4 段(工单号 类别 客户号 描述):「T009 计费」
$ uv run python part01/ticket_card2.py
工单行:
这行只拆出 0 段,至少要 4 段(工单号 类别 客户号 描述):「」
```

<div class="line-notes">

- `工单 T001(第 1 号) | 类别 计费 | 客户 C023` 正常的行照旧。
- `提到发票:False` T001 的描述里没有「发票」。
- `工单行:T009 计费` 残缺行。
- `这行只拆出 2 段,至少要 4 段` Day 16 在这里崩溃,现在是一句提示。
- `工单行:` 什么都没敲,直接回车。
- `这行只拆出 0 段,至少要 4 段` 空行拆出来是 0 段(`split()` 不带分隔符拆空串得 `[]`,和 Day 16 里 `split(",")` 得 `['']` 不一样),也被挡住了。

</div>

写完检查一遍:

```text
$ uv run ruff check part01/if_basic.py part01/if_else.py part01/if_elif.py part01/bool_ops.py part01/truthy_if.py part01/ternary.py part01/classify.py part01/classify2.py part01/refund_rule.py part01/ticket_card2.py
All checks passed!
$ uv run ruff format --check part01/classify.py part01/classify2.py part01/refund_rule.py part01/ticket_card2.py
4 files already formatted
```

<div class="line-notes">

- `All checks passed!` 十个正常的脚本都通过。`indent_error.py`、`colon_error.py`、`assign_error.py` 是故意写错的,Ruff 会说 `Failed to parse`;`or_bug.py` 会被 `SIM222` 点名,也是故意的。
- `4 files already formatted` `ruff format` 是 Day 13 学的格式化工具。`classify.py` 里那种 `if (` 换行 `or ...` 的样子,就是它自动排的标准写法。
- 另外,basedpyright 对 `bool_ops.py` 和 `truthy_if.py` 各给了一条 warning,说 `amount != 0`、`coupon is not None` 的结果「永远是同一个」,因为我在上一行把 `amount` 写死成 299、`coupon` 写死成 0。这是演示代码的特点,真实代码里值来自输入,不会有这条;我留着没改。

</div>

| 今天的零件 | 在 `refund_rule.py` / `classify.py` 里是哪一步 |
| --- | --- |
| `if ... :` 加缩进 | 每个分支都有 4 格缩进的块 |
| `elif` 从上到下找第一个成立的 | 按金额分三档、按关键词分三类 |
| 边界值(`<=` 还是 `<`) | 500 元刚好一线批准,50000 分 |
| `not` | `if not price_text.replace(...).isdigit():` |
| `or` 连多个关键词 | `"扣" in text or "退款" in text ...` |
| `in` | 子串判断,关键词匹配的基础 |
| 嵌套 if | `else` 里再判断 `times <= 1` |
| 前置校验 | 先判断输入合不合法,不合法就给提示 |
| 过拟合 | 看着 9 张答案调规则,6/9 变成 9/9,但新工单未必对 |

## 动手练习

### 练习 1:判断工单优先级

写 `part01/ex1_priority.py`:读类别(计费/登录/功能)、涉及金额(整数元,没有就填 0)、是不是 VIP(y/n),按下面的规则给优先级,从上往下第一条成立的生效:

1. 计费类并且金额大于等于 5000,或者客户是 VIP:紧急
2. 计费类并且金额大于 0:高
3. 登录类:中
4. 其余:低

用五组输入各跑一次:`计费 6000 n`、`计费 299 n`、`登录 0 y`、`登录 0 n`、`功能 0 n`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex1_priority.py
category = input("类别(计费/登录/功能):").strip()
amount = int(input("涉及金额(元,没有填 0):"))
is_vip = input("是 VIP 客户吗(y/n):").strip().lower() == "y"

if (category == "计费" and amount >= 5000) or is_vip:
    priority = "紧急"
elif category == "计费" and amount > 0:
    priority = "高"
elif category == "登录":
    priority = "中"
else:
    priority = "低"

print(f"优先级:{priority}")
```

<div class="line-notes">

- `category = input("类别(计费/登录/功能):").strip()` 读类别,去两头空白。
- `amount = int(input("涉及金额(元,没有填 0):"))` 读金额转整数。
- `is_vip = input("是 VIP 客户吗(y/n):").strip().lower() == "y"` 读一个 y/n,去空白,转小写,最后和 `"y"` 比较,得到 `True` 或 `False`,直接存进 `is_vip`。输入 `Y` 也算。这一行里 `==` 的优先级低于方法调用,所以是先处理完字符串再比较。
- `if (category == "计费" and amount >= 5000) or is_vip:` 规则 1。括号把「计费并且大金额」括在一起,明确优先级;整句话的意思是「(大额计费) 或者 VIP」。
- `priority = "紧急"` 命中规则 1。
- `elif category == "计费" and amount > 0:` 规则 2。能走到这里说明规则 1 不成立。
- `priority = "高"` 命中规则 2。
- `elif category == "登录":` 规则 3。
- `priority = "中"` 命中规则 3。
- `else:` 规则 4。
- `priority = "低"` 其余。
- `print(f"优先级:{priority}")` 打印。

</div>

```text
$ uv run python part01/ex1_priority.py
类别(计费/登录/功能):计费
涉及金额(元,没有填 0):6000
是 VIP 客户吗(y/n):n
优先级:紧急
$ uv run python part01/ex1_priority.py
类别(计费/登录/功能):计费
涉及金额(元,没有填 0):299
是 VIP 客户吗(y/n):n
优先级:高
$ uv run python part01/ex1_priority.py
类别(计费/登录/功能):登录
涉及金额(元,没有填 0):0
是 VIP 客户吗(y/n):Y
优先级:紧急
$ uv run python part01/ex1_priority.py
类别(计费/登录/功能):登录
涉及金额(元,没有填 0):0
是 VIP 客户吗(y/n):n
优先级:中
$ uv run python part01/ex1_priority.py
类别(计费/登录/功能):功能
涉及金额(元,没有填 0):0
是 VIP 客户吗(y/n):n
优先级:低
```

<div class="line-notes">

- `涉及金额(元,没有填 0):6000` 第一组:计费、6000。
- `优先级:紧急` 6000 ≥ 5000,规则 1。
- `涉及金额(元,没有填 0):299` 第二组:计费、299。
- `优先级:高` 规则 1 不成立(299 < 5000,不是 VIP),规则 2 成立。
- `是 VIP 客户吗(y/n):Y` 第三组:登录类,但是 VIP,输入的是大写 `Y`。
- `优先级:紧急` `lower()` 把 `Y` 变成 `y`,VIP 触发规则 1,尽管类别是登录。
- `优先级:中` 第四组:登录、不是 VIP,规则 3。
- `优先级:低` 第五组:功能,什么都不沾,规则 4。

</div>

第三组值得多想一下:规则的顺序决定了 VIP 压过类别。业务上这是对是错,要问业务方;代码的责任是把规则按人定的顺序实现出来,并且把边界值都测一遍。

</details>

### 练习 2:先猜,再跑

下面六行,先在纸上写出每一行会打印什么,再跑。`part01/ex2_guess.py`:

```python
# agent-zero-lab/part01/ex2_guess.py
empty = ""
zero = 0
items = []
price = 5
none_value = None

print(empty or "匿名")
print(zero and price)
print(not items)
print(price > 3 and "ok")
print(none_value or zero or "x")
print(1 < price < 10 and not price > 8)
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex2_guess.py
匿名
0
True
ok
x
True
```

<div class="line-notes">

- `匿名` `empty or "匿名"`:`empty` 是空字符串(假),取右边。
- `0` `zero and price`:`zero` 是 0(假),`and` 停在左边,结果是 0。不是 `False`,也不是 5。
- `True` `not items`:空列表是假,取反得 `True`。
- `ok` `price > 3 and "ok"`:`5 > 3` 为真,`and` 取右边的字符串。
- `x` `none_value or zero or "x"`:`None` 假、`0` 假,取最后一个 `"x"`。
- `True` `1 < price < 10 and not price > 8`:`1 < 5 < 10` 成立;`not (5 > 8)` 是 `not False` 得 `True`;`True and True` 得 `True`。

</div>

猜错的话,回到上面的真值表图,把每个值是真还是假标一遍,再看它停在哪一边。

</details>

### 练习 3:找出两个错

下面的 `part01/ex3_bug.py` 想做两件事:不是登录或功能的就归计费;金额超过 500 要组长、超过 5000 要财务。它有两个错。先用 `登录 800` 跑一遍,再用 `计费 8000` 跑一遍,看看会发生什么,然后修好。

```python
# agent-zero-lab/part01/ex3_bug.py
category = input("类别:").strip()
amount = int(input("金额(元):"))

if category == "登录" or "功能":
    kind = "非计费"
else:
    kind = "计费"

if amount > 500:
    level = "组长"
elif amount > 5000:
    level = "财务"
else:
    level = "一线"

print(kind, level)
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex3_bug.py
类别:登录
金额(元):800
非计费 组长
$ uv run python part01/ex3_bug.py
类别:计费
金额(元):8000
非计费 组长
```

<div class="line-notes">

- `类别:登录` 第一次输入,登录类、800 元。
- `非计费 组长` 看上去全对:登录是非计费,800 在 500 到 5000 之间是组长。**两个 bug 都被蒙过去了**,这一组输入恰好是「错的和对的撞上了」。
- `类别:计费` 第二次输入,计费类、8000 元。
- `非计费 组长` 两个都错了:计费类被判成非计费,8000 元应该要财务,却是组长。

</div>

第一个错:`if category == "登录" or "功能":`,右边的 `"功能"` 是非空字符串,永远是真,所以不管什么类别都是「非计费」(和今天 `or_bug.py` 同一个陷阱,Ruff 的 `SIM222` 也会提醒)。第二个错:elif 的顺序,`amount > 500` 排在前面,8000 在第一支就被截走,`amount > 5000` 永远走不到(和 `if_order_bug.py` 同一种)。

修好的 `part01/ex3_fixed.py`:

```python
# agent-zero-lab/part01/ex3_fixed.py
category = input("类别:").strip()
amount = int(input("金额(元):"))

if category in ("登录", "功能"):
    kind = "非计费"
else:
    kind = "计费"

if amount > 5000:
    level = "财务"
elif amount > 500:
    level = "组长"
else:
    level = "一线"

print(kind, level)
```

<div class="line-notes">

- `category = input("类别:").strip()` 读类别。
- `amount = int(input("金额(元):"))` 读金额。
- `if category in ("登录", "功能"):` 用 `in` 判断「是这两个中的任何一个」,不会写成永远为真的样子。
- `kind = "非计费"` 登录或功能。
- `else:` 其余。
- `kind = "计费"` 其余归计费。
- `if amount > 5000:` 大额放前面先判断。
- `level = "财务"` 超过 5000。
- `elif amount > 500:` 上一支不成立后,这里才是 500 到 5000。
- `level = "组长"` 组长。
- `else:` 其余。
- `level = "一线"` 500 以内。
- `print(kind, level)` 同时打印两个结果。

</div>

```text
$ uv run python part01/ex3_fixed.py
类别:登录
金额(元):800
非计费 组长
$ uv run python part01/ex3_fixed.py
类别:计费
金额(元):8000
计费 财务
$ uv run python part01/ex3_fixed.py
类别:计费
金额(元):299
计费 一线
```

<div class="line-notes">

- `非计费 组长` 登录类 800 元,和修之前一样,说明修之前那一组输入没有暴露问题。
- `计费 财务` 计费类 8000 元,两个都对了。
- `计费 一线` 计费类 299 元,一线。

</div>

教训:**测试输入要挑能区分对错的**。只拿一组输入,两个 bug 刚好互相掩护。每个分支至少要有一组输入走过,边界值前后各一组。

</details>

### 练习 4:席位折扣

CloudLedger(假设)对年付按席位数给折扣:不到 5 席位没有折扣,5 到 9 席位 95 折,10 到 19 席位 9 折,20 席位及以上 85 折。年付单价每席位 468 元(46800 分,Day 12)。写 `part01/ex4_discount.py`:读席位数,打印折扣、原价、优惠、应付。优惠用整数分算:`原价 × 折扣百分点 // 100`。用 3、5、10、20 各跑一次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex4_discount.py
seats = int(input("席位数:"))
price_year_fen = 46800

if seats >= 20:
    discount = 15
elif seats >= 10:
    discount = 10
elif seats >= 5:
    discount = 5
else:
    discount = 0

total_fen = price_year_fen * seats
saved_fen = total_fen * discount // 100
pay_fen = total_fen - saved_fen

print(f"{seats} 席位,折扣 {discount}%")
print(f"原价 {total_fen / 100:,.2f} 元,优惠 {saved_fen / 100:,.2f} 元")
print(f"应付 {pay_fen / 100:,.2f} 元")
```

<div class="line-notes">

- `seats = int(input("席位数:"))` 读席位数。
- `price_year_fen = 46800` 年付单价,468 元。
- `if seats >= 20:` 从大到小写:最大的档放最前面。
- `discount = 15` 85 折,优惠 15%。
- `elif seats >= 10:` 能走到这里,说明席位数 < 20,所以含义是 10 到 19。只需要写一个下限。
- `discount = 10` 9 折。
- `elif seats >= 5:` 5 到 9。
- `discount = 5` 95 折。
- `else:` 不到 5 席位。
- `discount = 0` 没折扣。
- `total_fen = price_year_fen * seats` 原价(分)。
- `saved_fen = total_fen * discount // 100` 优惠金额:先乘后整除,不引入浮点误差(Day 12)。
- `pay_fen = total_fen - saved_fen` 应付。
- `print(f"{seats} 席位,折扣 {discount}%")` 花括号外面的 `%` 就是普通字符。
- `print(f"原价 {total_fen / 100:,.2f} 元,优惠 {saved_fen / 100:,.2f} 元")` 金额排版同 Day 15。
- `print(f"应付 {pay_fen / 100:,.2f} 元")` 应付。

</div>

```text
$ uv run python part01/ex4_discount.py
席位数:3
3 席位,折扣 0%
原价 1,404.00 元,优惠 0.00 元
应付 1,404.00 元
$ uv run python part01/ex4_discount.py
席位数:5
5 席位,折扣 5%
原价 2,340.00 元,优惠 117.00 元
应付 2,223.00 元
$ uv run python part01/ex4_discount.py
席位数:10
10 席位,折扣 10%
原价 4,680.00 元,优惠 468.00 元
应付 4,212.00 元
$ uv run python part01/ex4_discount.py
席位数:20
20 席位,折扣 15%
原价 9,360.00 元,优惠 1,404.00 元
应付 7,956.00 元
```

<div class="line-notes">

- `席位数:3` 不到 5。
- `3 席位,折扣 0%` 没折扣。
- `原价 1,404.00 元,优惠 0.00 元` 46800 × 3 = 140400 分。
- `席位数:5` 刚好在 5 的边界上。
- `5 席位,折扣 5%` 边界值归 5 到 9 这一档(`>= 5`)。
- `原价 2,340.00 元,优惠 117.00 元` 234000 × 5 // 100 = 11700 分 = 117 元。
- `席位数:10` 边界。
- `10 席位,折扣 10%` 归 10 到 19 那档。
- `原价 4,680.00 元,优惠 468.00 元` 468000 × 10 // 100 = 46800 分。
- `席位数:20` 边界。
- `20 席位,折扣 15%` 归最高档。
- `原价 9,360.00 元,优惠 1,404.00 元` 936000 × 15 // 100 = 140400 分。

</div>

注意一个业务上的怪事:19 席位和 20 席位的总价差距。19 席位原价 8,892 元、9 折后 8,002.80 元;20 席位原价 9,360 元、85 折后 7,956 元。**多买一个席位,应付反而少了**。阶梯折扣常有这种问题,这类业务规则的边界要和产品方确认,而不是直接照写。

</details>

练习的验收标准:`if_basic.py`、`if_else.py`、`if_elif.py`、`bool_ops.py`、`truthy_if.py`、`classify.py`、`refund_rule.py`、`ticket_card2.py` 和四道练习都能跑,输出和文中一致;能不看文章说出「elif 碰到第一个成立的就停」、`x == "a" or "b"` 为什么永远为真、`0 and 5` 和 `"" or "匿名"` 各得什么;能默写 `refund_rule.py` 的分级部分;能解释为什么 `classify2.py` 在 9 张上全对仍然不能说它「准」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 条件 | 一个得到 `True` 或 `False` 的表达式,如 `amount > 500` |
| 分支 | 程序按条件走的不同的路;`if`/`elif`/`else` 就是分支 |
| 代码块 | 缩进在一起的一组语句,属于上一行以冒号结尾的那条语句 |
| 缩进 | 行首的空格。Python 用它标记代码块,一级固定 4 个空格,JS 用花括号 |
| `if` / `elif` / `else` | 如果 / 否则如果 / 否则;`elif` 对应 JS 的 `else if` |
| `IndentationError` | 缩进不对,如 `if` 后面的行忘了缩进 |
| `SyntaxError` | 语法错误,整个文件根本没法开始运行,如漏了冒号、把 `==` 写成 `=` |
| `and` / `or` / `not` | 并且 / 或者 / 取反,对应 JS 的 `&&` / `||` / `!` |
| 短路求值 | `and` 左边是假、`or` 左边是真时,右边不再计算 |
| 优先级 | 运算的先后:`not` 最先,`and` 其次,`or` 最后;拿不准就加括号 |
| 嵌套 | if 里面再套 if,多缩进一层 |
| 条件表达式 | 一行写完的二选一:`值1 if 条件 else 值2`,对应 JS 的 `条件 ? 值1 : 值2` |
| 元组(tuple) | 括号里放一组值,如 `("计费", "billing")`,Day 22 讲;今天配合 `in` 使用 |
| `isdigit()` | 字符串方法,判断是不是全由数字组成,空字符串得 `False` |
| 边界值 | 刚好在分界线上的值,如 500 元;测试时要拿它们专门试 |
| 死代码 | 永远执行不到的代码,如顺序写错后走不到的 elif |
| 前置校验 | 先判断输入合不合法,不合法就提示,不往下走 |
| 关键词规则 | 用「包含某词就归某类」的 if 链做分类,简单、可解释,但覆盖有限 |
| 基线(baseline) | 最朴素方案的成绩,后面更聪明的方案都要和它比 |
| 过拟合 | 按已知的答案去调规则,在这批数据上很准,新数据上不一定 |

## 常见误区

**忘了冒号,或者忘了缩进。** `SyntaxError: expected ':'`、`IndentationError: expected an indented block`。冒号和 4 格缩进是 Python 的花括号。

**用 `=` 当比较。** `if amount = 500:` 在 Python 里是语法错误。比较是 `==`。

**elif 的顺序写反。** 第一个成立的就停,宽的条件放前面会把窄的挡住,不报错但结果全错。每道关都要拿边界值试。

**`if x == "a" or "b":` 当成「x 是 a 或 b」。** 右边 `"b"` 是非空字符串,永远为真。写 `x == "a" or x == "b"`,或者 `x in ("a", "b")`。

**把 `and`、`or` 当成只会返回 True/False。** 它们返回的是某个值本身,`"" or "匿名"` 得 `"匿名"`,`0 and 5` 得 `0`。

**用 `if x:` 判断「有没有值」,而 0 是合法值。** `coupon = 0` 会被当成没有优惠券。要区分「没有」和「0」,用 `is None`。

**条件里先放有风险的计算。** `10000 / zero > 1 and zero != 0` 先炸了,保护放在了后面。保护条件放左边,让短路替你挡住。

**边界值写成 `<` 还是 `<=` 凭感觉。** 「500 元以内」到底含不含 500,问清楚再写,写完用刚好 500 的输入试一遍。

**测试输入只用一组。** 两个 bug 互相掩护,第一组输入全对,上线才发现。每个分支都要有输入走过。

**拿 9 张工单调规则,看到 9/9 就当它准。** 规则是看着答案补的,只在这 9 张上成立。要用没参与调规则的新数据去验证,这是后面评测那部分的核心。

## 学习资料

### 文档与文章

- [Python 教程 · if 语句](https://docs.python.org/zh-cn/3.12/tutorial/controlflow.html#if-statements):中文,官方教程里 `if`/`elif`/`else` 的一小节,不到一屏,例子很短。
- [Python 标准库 · 布尔运算 — and, or, not](https://docs.python.org/zh-cn/3.12/library/stdtypes.html#boolean-operations-and-or-not):中文,官方对这三个运算符的定义,包括「返回的不一定是布尔值」「短路」这些规则。
- [Python 语言参考 · if 语句](https://docs.python.org/zh-cn/3.12/reference/compound_stmts.html#the-if-statement):中文,`if` 的正式语法,今天看一眼「suite」(代码块)的写法就行。
- [PEP 8 · Indentation](https://peps.python.org/pep-0008/#indentation):英文,每级缩进用 4 个空格的出处,以及「不要混用 Tab 和空格」。
- [MDN · if...else](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Statements/if...else):中文,JS 的 `if`,对照 Python 看花括号和缩进的区别。
- [MDN · 逻辑与 (&&)](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Operators/Logical_AND):中文,JS 里的 `&&` 同样返回某个操作数而不是布尔值,和 Python 的 `and` 对照。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV13tkfBtEs2&autoplay=0&high_quality=1" title="5分钟学编程 · Python篇 #12｜逻辑运算符：and、or、not 与三目运算符" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>猫小申 · 5分钟学编程 · Python篇 #12｜逻辑运算符:and、or、not 与三目运算符 · 5 分钟,2025 年 11 月。把今天的 `and`/`or`/`not` 和一行的条件表达式放在一起讲,短。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1xy4DzzEHy&autoplay=0&high_quality=1" title="掌握Python的3种程序控制结构：顺序、条件（if/elif/else）、循环（for/while）" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小柯聊AI · 掌握Python的3种程序控制结构:顺序、条件(if/elif/else)、循环(for/while) · 6 分钟,2025 年 10 月。条件的部分对应今天,循环的部分是 Day 18 和 Day 19,可以先看前半。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/DZwmZ8Usvnk" title="Python Tutorial for Beginners 6: Conditionals and Booleans - If, Else, and Elif Statements" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial for Beginners 6: Conditionals and Booleans · 英文,可开自动字幕。If/elif/else、and/or/not、真值判断,一个视频讲完,例子都很短,看完马上能对上今天的内容。</figcaption>
</figure>

### 书籍

- Eric Matthes《Python Crash Course》第 3 版,No Starch Press,2023(中译《Python编程:从入门到实践》)。第 5 章「If Statements」,条件测试、`if-elif-else`、`and`/`or`、检查列表是否为空,今天的内容它都有。
- Allen B. Downey《Think Python》第 3 版,O'Reilly,2024,[免费在线版](https://allendowney.github.io/ThinkPython/)。第 5 章「Conditionals and Recursion」前半部分讲布尔表达式、`if`、`elif`、嵌套条件;后半的递归现在不用看。

### 开源项目与代码

- [Asabeneh/30-Days-Of-Python](https://github.com/Asabeneh/30-Days-Of-Python):英文,「Day 9 Conditionals」一章,每个知识点配一两行例子和练习,和今天的顺序接近。
- [jackfrued/Python-100-Days](https://github.com/jackfrued/Python-100-Days):中文,国内很流行的 Python 入门教程,`Day01-20` 目录里有《05.分支结构》一篇,可以对照着再做几道题。

## 自测

1. 下面这段代码,输入 `500` 会打印什么?输入 `5000` 呢?为什么?

```python
amount = int(input())
if amount < 500:
    print("一线")
elif amount < 5000:
    print("组长")
else:
    print("财务")
```

<details><summary>答案</summary>

输入 500 打印「组长」,输入 5000 打印「财务」。`<` 不包含边界,500 不小于 500,所以掉到第二支;5000 同理掉到 else。如果业务规则是「500 元以内一线批准、5000 元以内组长批准」,这里应该用 `<=`。

</details>

2. `"" or "匿名"`、`0 and 5`、`None or 0 or "x"`、`not []` 各得什么?

<details><summary>答案</summary>

`"匿名"`、`0`、`"x"`、`True`。`or` 取第一个真值(都是假就取最后一个),`and` 在遇到假值时停下并返回它,`not` 对空列表(假)取反得 `True`。

</details>

3. 为什么 `if category == "计费" or "billing":` 对任何类别都成立?怎么改?

<details><summary>答案</summary>

Python 把它读成 `(category == "计费") or "billing"`,`"billing"` 是非空字符串,是真,所以整个条件永远是真。改成 `category == "计费" or category == "billing"`,或者 `category in ("计费", "billing")`。

</details>

4. `if coupon:` 和 `if coupon is not None:` 在 `coupon = 0` 时结果有什么不同?什么业务场景下这个差别会出错?

<details><summary>答案</summary>

`if coupon:` 把 0 当假,不进分支;`is not None` 只排除 `None`,0 会进分支。场景:优惠券金额 0 元(比如一张只赠送权益的券)和「没有优惠券」不同,前者要发给用户,后者不发。用 `if coupon:` 会把 0 元券当成没有。

</details>

5. 面试题:你的 Agent 让大模型输出一个 JSON `{"action": "refund", "amount": -500}`,然后执行退款。在真正调退款接口之前,你的代码里至少要判断哪些条件?为什么不能只在提示词里写「金额必须为正」?

<details><summary>答案</summary>

至少要判断:`action` 是不是允许的取值之一(用 `in`);`amount` 是不是数字、是不是大于 0、有没有超过单笔上限(今天的 `<= 500 / <= 5000` 分级);字段缺失(`None`)的情况;金额超过阈值时要转人工而不是直接执行。不能只靠提示词,因为模型的输出是概率性的,同样的提示词也可能偶尔输出负数、字符串金额或者缺字段,提示词只能降低概率。涉及钱的动作要在**代码层面**用确定的规则挡一道,这是 Agent 工程里「护栏」的最基本形态,这门课安全那部分(Day 378 起)会系统地讲。

</details>

## 明天预告

Day 18 · for 循环和 range。今天做的所有事,一次只能处理一张工单:要把 Day 5 的 9 张工单全测一遍,我得在终端里自己写个循环去喂输入。明天学 Python 的 `for`,相当于 JS 的 `for...of`:一次处理一批,用 `range` 生成 1 到 10 的数字,用 `enumerate` 同时拿到编号和内容。学完就能让 `classify.py` 一口气把 9 张工单都分一遍,自己算出 6/9,不用手动数。
