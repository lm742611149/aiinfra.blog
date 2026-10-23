---
title: 'Day 29 · 函数(二):默认参数、关键字参数和可变默认值陷阱'
description: '给参数写默认值,不传就用它;调用时用「名字=值」传参,顺序随意。再撞一次 Python 最有名的坑:拿 [] 当默认值,所有调用共用同一个列表,两个客户的对话串在了一起。今天复现它、认出 Ruff 的提醒,并学会三种修法。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 29
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 28](/blog/agent-zero/day-028-functions-1/) 学了函数的基本形状:`def 名字(参数):` 定义,名字加括号调用;`return` 把结果交回并立刻结束函数,没有 `return` 就得到 `None`;参数个数对不上会 `TypeError`;`return a, b` 返回的是元组;`def` 是一条要执行到才生效的语句;`sorted(rows, key=函数名)` 把函数当值传出去。小项目里把 Day 20 的日报拆成了 `clean`、`parse`、`classify`、`extract_fen`。

那时所有参数都是「必须传、按位置对应」。可你一直在用另一种:`line.split(maxsplit=3)`、`sorted(rows, reverse=True)`、`enumerate(x, start=1)`、`print("T1", "T2", sep=" | ")`,括号里写着「名字=值」,而且不传也行。今天讲清这两件事怎么回事、怎么在自己的函数里写出来,再讲一个只有 Python 才有的、新手几乎必踩的坑。

## 今天要解决的问题

学完今天,你应该能:

1. 给参数写默认值 `def with_tax(fen, rate_percent=6)`,调用时不传就用默认值;知道没有默认值的参数不能跟在有默认值的后面,认得 `SyntaxError: parameter without a default follows parameter with a default`。
2. 用「名字=值」的关键字参数调用,顺序随意,能跳过中间的默认值;认得三个报错:`SyntaxError: positional argument follows keyword argument`、`TypeError: label() got multiple values for argument 'ticket_id'`、`TypeError: label() got an unexpected keyword argument 'categroy'`。
3. 说清 Python 的默认值**只在 `def` 那一刻算一次**,对照 JS 每次调用都重新算;能复现「`tags=[]` 被所有调用共用」的现象,用 `f.__defaults__` 看到证据;会用 `None` 加 `if x is None:` 修;知道 `x = x or []` 在调用者传入空列表时会出新的错。
4. 写出 `part01/ticket_search.py`:一个 `search(tickets, category=None, min_fen=0, keyword="", limit=None)`,用关键字参数的各种组合查工单,再配一个 `format_ticket(t, show_amount=True, sep=" | ")`。

预计用时:3 小时。默认参数和关键字参数 60 分钟,三个传参报错 20 分钟,可变默认值陷阱和修法 60 分钟,小项目和练习 40 分钟。

前置:[Day 14](/blog/agent-zero/day-014-bool-none/)(`None`、`is None`)、[Day 21](/blog/agent-zero/day-021-lists/)(`b = a` 是同一个列表、`append` 原地修改)、[Day 24](/blog/agent-zero/day-024-dicts/)(字典)、[Day 28](/blog/agent-zero/day-028-functions-1/)(`def`、`return`)。今天不调任何 API,花费 0 元。

学法提示:先对照文章逐行敲一遍(代码自己敲,不复制粘贴)并跑通;第二天合上文章,把 `mut_chat.py` 和它的修复版 `mut_fix.py` 默写出来,先写出会出错的版本再运行,确认你能让错误现象重现;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚我是在哪跑的

输出是我 2026-10-23 在 2019 款 Intel MacBook Pro(macOS 14、zsh)上用演示家目录真跑的,家目录显示成 `/Users/你`,`~/agent-zero-lab` 接着 Day 28 的状态,`uv run python` 是 3.12.13,Ruff 是 0.17.2,basedpyright 是 standard 档。今天的脚本都放在 `part01/`,在仓库根目录用 `uv run python part01/文件名.py` 运行。

## 先看 JS 的默认参数

前端写默认参数很顺手,先看一眼 JS 里「默认值是个数组」会怎样,这一段是今天最重要的对比:

```text
$ node -e '
function addTag(tag, tags = []) {
  tags.push(tag);
  return tags;
}
console.log(addTag("退款"));
console.log(addTag("年付"));

function label(id, { category = "未知", urgent = false } = {}) {
  return `${id} ${category} ${urgent}`;
}
console.log(label("T201", { urgent: true }));
console.log(label("T202"));
'
[ '退款' ]
[ '年付' ]
T201 未知 true
T202 未知 false
```

<div class="line-notes">

- `function addTag(tag, tags = []) {` JS 的默认参数写法 `tags = []`,和 Python 的 `tags=[]` 长得几乎一样。
- `tags.push(tag);` 往数组里加。
- `return tags;` 交回数组。
- `console.log(addTag("退款"));` 第一次调用,没传 `tags`,用默认值,得到 `[ '退款' ]`。
- `console.log(addTag("年付"));` 第二次调用,又没传,**JS 又新造了一个空数组**,得到 `[ '年付' ]`,和第一次互不相干。**记住这个结果,Python 里会不一样。**
- `function label(id, { category = "未知", urgent = false } = {}) {` JS 里想「按名字传参数」,常见写法是收一个对象再解构,每个字段带默认值,整个对象也有默认值 `{}`。
- `return` 用模板字符串把三样拼成一句。
- `console.log(label("T201", { urgent: true }));` 只传了 `urgent`,`category` 用默认的「未知」。
- `console.log(label("T202"));` 整个对象都没传,走 `= {}`,两个字段都用默认。

</div>

Python 把「按名字传」直接做进了函数调用的语法里,不用先打包成对象,下面就看。

## 默认参数:不传就用它

新建 `part01/dflt_basic.py`:

```python
# agent-zero-lab/part01/dflt_basic.py
def with_tax(fen, rate_percent=6):
    return fen + fen * rate_percent // 100


print(with_tax(29900))
print(with_tax(29900, 10))
print(with_tax(29900, rate_percent=0))
print("默认值存在函数身上:", with_tax.__defaults__)
```

<div class="line-notes">

- `def with_tax(fen, rate_percent=6):` 第二个参数后面写 `=6`,意思是「调用时不传它,就当它是 6」。等号两边不留空格,这是 Python 社区的习惯(Ruff 会检查)。
- `return fen + fen * rate_percent // 100` 和昨天一样的含税价公式。
- `print(with_tax(29900))` 只传一个实参:`fen` 是 29900,`rate_percent` 没传,用默认的 6。`29900 * 6 // 100` 是 1794,和是 31694。
- `print(with_tax(29900, 10))` 传了第二个,覆盖默认值:`29900 * 10 // 100` 是 2990,和是 32890。
- `print(with_tax(29900, rate_percent=0))` 也可以按名字覆盖,写成 `rate_percent=0`,不加税,29900。
- `print("默认值存在函数身上:", with_tax.__defaults__)` 函数是一个对象,它的默认值被存在 `__defaults__` 这个属性里,是一个元组 `(6,)`。这一行今天后面还会用到,记住它。

</div>

```text
$ uv run python part01/dflt_basic.py
31694
32890
29900
默认值存在函数身上: (6,)
```

<div class="line-notes">

- `31694` 没传税率,用默认的 6%。
- `32890` 传 10 覆盖了默认值。
- `29900` 按名字传 0%,没加税。
- `默认值存在函数身上: (6,)` 默认值被存在函数对象里,是个元组。

</div>

### 有默认值的必须放在后面

要是把有默认值的参数写在没默认值的前面呢?新建 `part01/dflt_err_order.py`:

```python
# agent-zero-lab/part01/dflt_err_order.py
def with_tax(rate_percent=6, fen):
    return fen + fen * rate_percent // 100


print(with_tax(100))
```

```text
$ uv run python part01/dflt_err_order.py
  File "/Users/你/agent-zero-lab/part01/dflt_err_order.py", line 2
    def with_tax(rate_percent=6, fen):
                                 ^^^
SyntaxError: parameter without a default follows parameter with a default
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/dflt_err_order.py", line 2` 出错在第 2 行,就是 `def` 那一行。注意**这次没有 `Traceback`**:语法错误在 Python 读文件、还没开始运行的时候就被发现了,下面的 `print` 一行都没来得及执行。
- `def with_tax(rate_percent=6, fen):` 第二个参数 `fen` 没有默认值,却跟在有默认值的 `rate_percent=6` 后面。
- `^^^` 波浪线指向 `fen`。
- `SyntaxError: parameter without a default follows parameter with a default` 没默认值的参数,跟在有默认值的参数后面。原因:调用 `with_tax(100)` 时,100 该给谁?Python 干脆规定「有默认的都放最后」。修:`def with_tax(fen, rate_percent=6):`。(更早的 Python 版本把这句写成 `non-default argument follows default argument`,意思一样。)

</div>

## 关键字参数:你早就在用

先看你已经写过的这几行,新建 `part01/kw_already.py`:

```python
# agent-zero-lab/part01/kw_already.py
line = "T201 计费 C023 8月2日重复扣款299元"
print(line.split(maxsplit=3))
for no, word in enumerate(["x", "y"], start=1):
    print(no, word)
print(sorted([3, 1, 2], reverse=True))
print("T201", "T202", sep=" | ", end="!\n")
```

<div class="line-notes">

- `line = "T201 计费 C023 8月2日重复扣款299元"` 一行工单。
- `print(line.split(maxsplit=3))` `maxsplit=3` 就是关键字参数:名字是 `maxsplit`,值是 3。不写名字的话,`split` 的第一个位置参数是分隔符,3 会被当成分隔符,所以这里**必须**写名字。
- `for no, word in enumerate(["x", "y"], start=1):` `start=1` 是关键字参数,让编号从 1 开始。
- `print(no, word)` 打印编号和值。
- `print(sorted([3, 1, 2], reverse=True))` `reverse=True` 是关键字参数。
- `print("T201", "T202", sep=" | ", end="!\n")` `print` 的 `sep` 和 `end`:分隔符和结尾,`\n` 是换行。

</div>

```text
$ uv run python part01/kw_already.py
['T201', '计费', 'C023', '8月2日重复扣款299元']
1 x
2 y
[3, 2, 1]
T201 | T202!
```

<div class="line-notes">

- `['T201', '计费', 'C023', '8月2日重复扣款299元']` 最多拆成四段。
- `1 x` 编号从 1 开始。
- `2 y` 第二项。
- `[3, 2, 1]` 从大到小。
- `T201 | T202!` 分隔符换成了 ` | `,结尾换成了 `!` 加换行。

</div>

现在自己写一个同时有位置参数、默认参数和关键字调用的函数。新建 `part01/kw_label.py`:

```python
# agent-zero-lab/part01/kw_label.py
def label(ticket_id, category, amount_fen=0, urgent=False):
    text = f"{ticket_id} {category}"
    if amount_fen:
        text += f" {amount_fen // 100}元"
    if urgent:
        text += " [加急]"
    return text


print(label("T201", "计费"))
print(label("T201", "计费", 29900))
print(label("T201", "计费", urgent=True))
print(label("T201", "计费", 29900, True))
print(label(urgent=True, category="登录", ticket_id="T202"))
print(label("T203", category="功能", amount_fen=0))
```

<div class="line-notes">

- `def label(ticket_id, category, amount_fen=0, urgent=False):` 两个必须传的(`ticket_id`、`category`),两个有默认值的(`amount_fen` 默认 0,`urgent` 默认 `False`)。
- `text = f"{ticket_id} {category}"` 先拼出基础文本。
- `if amount_fen:` 金额是 0 就是假,不显示。
- `text += f" {amount_fen // 100}元"` 有金额才追加。`+=` 对字符串也成立。
- `if urgent:` 加急标记。
- `text += " [加急]"` 追加。
- `return text` 交回。
- `print(label("T201", "计费"))` 两个必须的,其余用默认,得到 `T201 计费`。
- `print(label("T201", "计费", 29900))` 第三个位置给 `amount_fen`,29900 分,显示 299 元。
- `print(label("T201", "计费", urgent=True))` **跳过中间的 `amount_fen`**,直接按名字给 `urgent`。位置参数做不到这一点:你没法只传第四个而不传第三个。
- `print(label("T201", "计费", 29900, True))` 全按位置传,`True` 是什么意思得回头看定义,不好读。
- `print(label(urgent=True, category="登录", ticket_id="T202"))` 全按名字传,顺序可以乱写。
- `print(label("T203", category="功能", amount_fen=0))` 前面按位置,后面按名字,混着用。

</div>

```text
$ uv run python part01/kw_label.py
T201 计费
T201 计费 299元
T201 计费 [加急]
T201 计费 299元 [加急]
T202 登录 [加急]
T203 功能
```

<div class="line-notes">

- `T201 计费` 都用默认值。
- `T201 计费 299元` 第三个位置是金额。
- `T201 计费 [加急]` 跳过金额只传 `urgent`。
- `T201 计费 299元 [加急]` 全按位置,结果一样,但读的人看不出 `True` 是什么。
- `T202 登录 [加急]` 乱序的关键字调用,结果一样。
- `T203 功能` 金额 0,不显示。

</div>

规矩只有一条:**混着用时,位置参数写在前面,关键字参数写在后面。** 我的习惯是:必须传的、一眼看得懂意思的(工单号、类别)用位置;开关和可选项(`urgent=True`、`limit=3`)一律写名字,读代码的人不用回头翻定义。

## 传参的三个报错

新建 `part01/kw_err_after.py`,先违反上面那条规矩:

```python
# agent-zero-lab/part01/kw_err_after.py
def label(ticket_id, category):
    return f"{ticket_id} {category}"


print(label(ticket_id="T201", "计费"))
```

```text
$ uv run python part01/kw_err_after.py
  File "/Users/你/agent-zero-lab/part01/kw_err_after.py", line 6
    print(label(ticket_id="T201", "计费"))
                                      ^
SyntaxError: positional argument follows keyword argument
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/kw_err_after.py", line 6` 又是语法错误,发生在读文件阶段,没有 `Traceback`。
- `print(label(ticket_id="T201", "计费"))` 先写了 `ticket_id=...` 的关键字,后面又跟了一个不带名字的 `"计费"`。
- `SyntaxError: positional argument follows keyword argument` 位置参数跟在关键字参数后面。Python 无法判断这个「计费」该给谁。修:`label("T201", "计费")` 或者两个都写名字。

</div>

第二个:同一个参数被传了两次。新建 `part01/kw_err_twice.py`:

```python
# agent-zero-lab/part01/kw_err_twice.py
def label(ticket_id, category):
    return f"{ticket_id} {category}"


print(label("T201", ticket_id="T202"))
```

```text
$ uv run python part01/kw_err_twice.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/kw_err_twice.py", line 6, in <module>
    print(label("T201", ticket_id="T202"))
          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
TypeError: label() got multiple values for argument 'ticket_id'
```

<div class="line-notes">

- `line 6, in <module>` 这次是运行时报错,有 `Traceback`。
- `print(label("T201", ticket_id="T202"))` 第一个位置实参 `"T201"` 已经给了第一个参数 `ticket_id`,后面又用关键字再给一次。
- `TypeError: label() got multiple values for argument 'ticket_id'` `label()` 为参数 `ticket_id` 收到了多个值。

</div>

第三个:名字拼错了。新建 `part01/kw_err_unknown.py`:

```python
# agent-zero-lab/part01/kw_err_unknown.py
def label(ticket_id, category):
    return f"{ticket_id} {category}"


print(label("T201", categroy="计费"))
```

```text
$ uv run python part01/kw_err_unknown.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/kw_err_unknown.py", line 6, in <module>
    print(label("T201", categroy="计费"))
          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
TypeError: label() got an unexpected keyword argument 'categroy'
```

<div class="line-notes">

- `line 6, in <module>` 运行时报错。
- `print(label("T201", categroy="计费"))` 把 `category` 拼成了 `categroy`。
- `TypeError: label() got an unexpected keyword argument 'categroy'` 收到了一个没料到的关键字参数。**报错里的名字就是你拼错的那个**,和定义对一下就找到。这条报错在以后很常见:调用别人的函数传了它不认识的参数(第二部分调大模型接口时会遇到),就是这句。

</div>

三个报错的编辑器红线也都有,所以养成「看一眼红线再运行」的习惯能省不少时间。

## 默认值只算一次

现在到今天的重点。回顾 JS 那段:`addTag("退款")` 和 `addTag("年付")` 各拿到一个新数组。Python 不一样,**默认值在 `def` 被执行的那一刻算出来,只算这一次**,以后每次调用拿到的都是那个现成的对象。

先用一个不会出事的例子证明这点。新建 `part01/dflt_once.py`,默认值是「当前时间」:

```python
# agent-zero-lab/part01/dflt_once.py
import time


def stamp(t=time.time()):
    return t


first = stamp()
time.sleep(0.2)
second = stamp()
print("隔了 0.2 秒,两次拿到的一样吗?", first == second)
print("默认值就是定义那一刻算好的:", stamp.__defaults__ == (first,))
```

<div class="line-notes">

- `import time` 标准库的时间模块,`import` 在 Day 32 细讲。
- `def stamp(t=time.time()):` 默认值是 `time.time()`,当前时间的秒数。重点:这个括号里的表达式**在 `def` 这一行就计算了**,算出一个具体的数字,存进函数对象,以后调用不再算。
- `return t` 原样交回。
- `first = stamp()` 第一次调用,没传 `t`,用默认值。
- `time.sleep(0.2)` 睡 0.2 秒。
- `second = stamp()` 第二次调用,间隔了 0.2 秒。
- `print("隔了 0.2 秒,两次拿到的一样吗?", first == second)` 如果每次调用都重新算,这两个数该差 0.2 左右。
- `print("默认值就是定义那一刻算好的:", stamp.__defaults__ == (first,))` `__defaults__` 里存的就是那个数,和 `first` 对得上。

</div>

```text
$ uv run python part01/dflt_once.py
隔了 0.2 秒,两次拿到的一样吗? True
默认值就是定义那一刻算好的: True
```

<div class="line-notes">

- `隔了 0.2 秒,两次拿到的一样吗? True` 一模一样,没有重新算。
- `默认值就是定义那一刻算好的: True` 函数身上存的就是它。

</div>

时间戳这种数字是不可变的,拿着同一个也不会出事。**如果默认值是个能被修改的东西呢?** 比如一个列表。新建 `part01/mut_trap.py`:

```python
# agent-zero-lab/part01/mut_trap.py
def add_tag(tag, tags=[]):
    tags.append(tag)
    return tags


print(add_tag("退款"))
print(add_tag("年付"))
print(add_tag("发票", ["手动"]))
print(add_tag("重复扣款"))
print("函数身上的默认值:", add_tag.__defaults__)
```

<div class="line-notes">

- `def add_tag(tag, tags=[]):` 默认值是一个空列表 `[]`。这个列表在 `def` 执行的那一刻被造出来,存进函数对象,以后所有「没传 `tags`」的调用拿到的都是这**同一个**列表。
- `tags.append(tag)` 往列表里加。`append` 原地修改(Day 21),所以改的就是那个存在函数身上的默认列表。
- `return tags` 交回这个列表。
- `print(add_tag("退款"))` 第一次调用,默认列表原来是空的,加了「退款」,交回 `['退款']`。
- `print(add_tag("年付"))` 第二次调用,没传 `tags`,拿到的还是**那个已经装着「退款」的列表**,再加「年付」,交回 `['退款', '年付']`。对比 JS:那里是 `[ '年付' ]`。
- `print(add_tag("发票", ["手动"]))` 这次**传了**自己的列表,函数改的是传进来的这个,默认列表没被碰。得到 `['手动', '发票']`。
- `print(add_tag("重复扣款"))` 又不传了,默认列表上有「退款」「年付」,再加一个。
- `print("函数身上的默认值:", add_tag.__defaults__)` 直接看函数身上的默认值,证据就在这里。

</div>

```text
$ uv run python part01/mut_trap.py
['退款']
['退款', '年付']
['手动', '发票']
['退款', '年付', '重复扣款']
函数身上的默认值: (['退款', '年付', '重复扣款'],)
```

<div class="line-notes">

- `['退款']` 第一次。
- `['退款', '年付']` 第二次,**上一次调用的结果还在**。
- `['手动', '发票']` 传了自己的列表,不受影响。
- `['退款', '年付', '重复扣款']` 又回到默认列表,三个标签累积了。
- `函数身上的默认值: (['退款', '年付', '重复扣款'],)` 默认值元组里那个列表,现在装着三个东西。它不再是你写代码时看到的空列表了。

</div>

原因和 Day 21 的 `b = a` 是同一个:两次调用拿到的是同一个列表对象,不是两个长得一样的列表。用图看更清楚:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="可变默认值的陷阱:def 执行时造出一个空列表存在函数对象里;第一次调用往里加退款,第二次调用没传 tags,拿到的还是同一个列表,再加年付,所以里面有两项;传自己列表的调用不受影响">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="12" y="16" width="190" height="86" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="22" y="38" fill="var(--ink)">def add_tag(tag, tags=[])</text>
<text x="22" y="58" fill="var(--ink-soft)">执行 def 的这一刻</text>
<text x="22" y="76" fill="var(--ink-soft)">造出一个空列表</text>
<text x="22" y="92" fill="var(--ink-faint)">存在函数对象里</text>
<rect x="260" y="16" width="200" height="86" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="270" y="38" fill="var(--ink)">add_tag.__defaults__</text>
<text x="270" y="62" fill="var(--ink-soft)">([ ],)  只有这一个</text>
<text x="270" y="84" fill="var(--ink-faint)">以后所有调用共用</text>
<line x1="202" y1="59" x2="260" y2="59" stroke="var(--ink-soft)"/>
<rect x="12" y="130" width="190" height="104" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="22" y="152" fill="var(--ink)">add_tag("退款")</text>
<text x="22" y="172" fill="var(--ink-soft)">没传 tags</text>
<text x="22" y="192" fill="var(--ink)">add_tag("年付")</text>
<text x="22" y="212" fill="var(--ink-soft)">没传 tags</text>
<line x1="202" y1="160" x2="350" y2="102" stroke="var(--compute)" stroke-width="1.5"/>
<line x1="202" y1="200" x2="360" y2="102" stroke="var(--compute)" stroke-width="1.5"/>
<rect x="260" y="130" width="200" height="104" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="270" y="152" fill="var(--ink)">调用后默认列表变成</text>
<text x="270" y="176" fill="var(--ink-soft)">['退款', '年付']</text>
<text x="270" y="200" fill="var(--ink-faint)">第二次看到的是</text>
<text x="270" y="218" fill="var(--ink-faint)">第一次留下的东西</text>
<rect x="490" y="130" width="138" height="104" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="498" y="152" fill="var(--ink)">传了自己的</text>
<text x="498" y="172" fill="var(--ink-soft)">["手动"]</text>
<text x="498" y="196" fill="var(--ink-faint)">改的是自己的,</text>
<text x="498" y="214" fill="var(--ink-faint)">默认列表不受影响</text>
</g>
</svg>
<figcaption>可变默认值只造一次,所有「没传」的调用共用它。蓝色是那个唯一的默认列表,琥珀色是调用。</figcaption>
</figure>

Ruff 也在盯这个:跑 `ruff check --select B006,B008` 能看到它点名:

```text
$ uv run ruff check --select B006,B008 --output-format concise part01/mut_trap.py part01/mut_chat.py part01/dflt_once.py
part01/dflt_once.py:5:13: B008 Do not perform function call `time.time` in argument defaults; instead, perform the call within the function, or read the default from a module-level singleton variable
part01/mut_chat.py:2:37: B006 Do not use mutable data structures for argument defaults
part01/mut_trap.py:2:23: B006 Do not use mutable data structures for argument defaults
Found 3 errors.
2 unsafe fixes available with `--fix --unsafe-fixes`.
```

<div class="line-notes">

- `part01/dflt_once.py:5:13: B008` 规则 B008:别在默认值里调用函数。这条对 `dflt_once.py` 的 `time.time()` 报警,因为调用的结果只会算一次,往往不是你想要的。
- `part01/mut_chat.py:2:37: B006` 规则 B006:别用可变数据结构当默认值。第 2 行第 37 列,就是 `history=[]` 的那对方括号。
- `part01/mut_trap.py:2:23: B006` 同一条规则,在刚才的 `add_tag`。
- `Found 3 errors.` 三处。
- `2 unsafe fixes available` Ruff 说它能自动改(加 `--fix --unsafe-fixes`),但标了「不安全」,因为改了函数的行为(下面就是手动改的写法)。

</div>

我们的练习仓库里 Ruff 默认开着这两条规则,所以写 `tags=[]` 时编辑器就会提醒你。**看到 B006,不要点「忽略」,按下面的写法改。**

## Agent 里的版本:两个客户的对话串了

这不只是「怪现象」。Agent 里每个会话都有一份对话历史,一个存放 `{"role": ..., "content": ...}` 的列表(Day 129 会正式学消息结构)。如果有人写了这样的函数,会怎样?新建 `part01/mut_chat.py`:

```python
# agent-zero-lab/part01/mut_chat.py
def add_message(role, text, history=[]):
    history.append({"role": role, "content": text})
    return history


chat_a = add_message("user", "我的发票在哪?")
chat_b = add_message("user", "帮我退款")
print("客户 A 的对话:", chat_a)
print("A 和 B 是同一个列表吗?", chat_a is chat_b)
```

<div class="line-notes">

- `def add_message(role, text, history=[]):` 往一份对话历史里追加一条消息。默认值是空列表,意思是「新开一个对话」。陷阱就埋在这里。
- `history.append({"role": role, "content": text})` 追加一条消息,是一个字典。
- `return history` 交回整份历史。
- `chat_a = add_message("user", "我的发票在哪?")` 客户 A 开了新对话,没传 `history`,用默认列表,里面加了 A 的这一句。
- `chat_b = add_message("user", "帮我退款")` 客户 B 也开了新对话,没传 `history`。拿到的**还是同一个默认列表**,A 的那句还在里面,B 的话加在后面。
- `print("客户 A 的对话:", chat_a)` 打印 A 的对话。
- `print("A 和 B 是同一个列表吗?", chat_a is chat_b)` `is` 判断是不是同一个对象(Day 14)。

</div>

```text
$ uv run python part01/mut_chat.py
客户 A 的对话: [{'role': 'user', 'content': '我的发票在哪?'}, {'role': 'user', 'content': '帮我退款'}]
A 和 B 是同一个列表吗? True
```

<div class="line-notes">

- `客户 A 的对话: [{'role': 'user', 'content': '我的发票在哪?'}, {'role': 'user', 'content': '帮我退款'}]` A 的对话里出现了 B 说的「帮我退款」。如果下一步把这份历史发给大模型,模型会看到别的客户说的话,回复里甚至可能带出 B 的信息。
- `A 和 B 是同一个列表吗? True` 证据:`chat_a` 和 `chat_b` 是同一个对象。

</div>

这种 bug 的可怕在于**不报错、小测试里看不出来**:你一个人开一个对话,永远只调一次,一切正常;上线以后两个用户同时用,才有人看到别人的消息。后面做带记忆的 Agent 时,这是必须死死记住的一个坑。

## 三种修法

**第一种,也是最常用的:默认值写 `None`,函数里再建。** 新建 `part01/mut_fix.py`:

```python
# agent-zero-lab/part01/mut_fix.py
def add_message(role, text, history=None):
    if history is None:
        history = []
    history.append({"role": role, "content": text})
    return history


chat_a = add_message("user", "我的发票在哪?")
chat_b = add_message("user", "帮我退款")
print("客户 A:", chat_a)
print("客户 B:", chat_b)

mine = [{"role": "system", "content": "你是云簿客服"}]
add_message("user", "你好", mine)
print("传自己的列表,就接着往里加:", len(mine), "条")
```

<div class="line-notes">

- `def add_message(role, text, history=None):` 默认值改成 `None`。`None` 不可变,放心共用。
- `if history is None:` 判断「调用者没传」。用 `is None`(Day 14),不要用 `== None`。
- `history = []` 没传的情况下,**每次调用时**才新建一个空列表,每次调用都拿到自己独有的。这一句写在函数体里,每次调用都会执行,和默认值只算一次不同。
- `history.append({"role": role, "content": text})` 追加。
- `return history` 交回。
- `chat_a = add_message("user", "我的发票在哪?")` A 新开对话,得到一个新列表。
- `chat_b = add_message("user", "帮我退款")` B 新开对话,得到另一个新列表。
- `print("客户 A:", chat_a)` A 只有自己那句。
- `print("客户 B:", chat_b)` B 只有自己那句。
- `mine = [{"role": "system", "content": "你是云簿客服"}]` 想接着已有的历史往里加:自己准备一份,里面先放一条系统消息。
- `add_message("user", "你好", mine)` 传了 `history`,不是 `None`,所以不会新建,函数往传进来的这份里追加。这次没接返回值,因为就地改了 `mine`。
- `print("传自己的列表,就接着往里加:", len(mine), "条")` 现在有 2 条。

</div>

```text
$ uv run python part01/mut_fix.py
客户 A: [{'role': 'user', 'content': '我的发票在哪?'}]
客户 B: [{'role': 'user', 'content': '帮我退款'}]
传自己的列表,就接着往里加: 2 条
```

<div class="line-notes">

- `客户 A: [{'role': 'user', 'content': '我的发票在哪?'}]` A 只看到自己的。
- `客户 B: [{'role': 'user', 'content': '帮我退款'}]` B 只看到自己的。
- `传自己的列表,就接着往里加: 2 条` 一条系统消息加一条用户消息。

</div>

**不要偷懒写成 `history = history or []`。** 短是短,但调用者传进来的是**空列表**时会出另一个错(空列表是假,Day 17)。新建 `part01/mut_or_trap.py`:

```python
# agent-zero-lab/part01/mut_or_trap.py
def add_message(role, text, history=None):
    history = history or []
    history.append({"role": role, "content": text})
    return history


mine = []
add_message("user", "你好", mine)
print("我传进去的列表:", mine)
```

<div class="line-notes">

- `def add_message(role, text, history=None):` 同样默认 `None`。
- `history = history or []` 如果 `history` 是 `None` 或者**空列表**(都是假),换成一个新的空列表。
- `history.append({"role": role, "content": text})` 往里加。
- `return history` 交回。
- `mine = []` 调用者自己准备了一个空列表,想让函数往里装。
- `add_message("user", "你好", mine)` 传进去。`mine` 是空列表,为假,`or` 把它换成了一个新的空列表,函数往新的里加,`mine` 没被碰。
- `print("我传进去的列表:", mine)` 还是空的。

</div>

```text
$ uv run python part01/mut_or_trap.py
我传进去的列表: []
```

<div class="line-notes">

- `我传进去的列表: []` 调用者以为函数会往 `mine` 里加,结果它还是空的,消息去了另一个列表。不报错,只是悄悄不对。和 Day 24 的 `.get("amount") or "没填"` 吞掉 0 是同一类错:`or` 把所有「假」都当成「没传」。

</div>

所以判断「有没有传」,**只用 `is None`**。

**第三种:不修改,造新的。** 默认值用一个不可变的空元组 `()`,函数不改传进来的东西,而是造一个新列表交回去。新建 `part01/mut_pure.py`:

```python
# agent-zero-lab/part01/mut_pure.py
def add_message(role, text, history=()):
    return list(history) + [{"role": role, "content": text}]


h1 = add_message("user", "你好")
h2 = add_message("assistant", "请问有什么可以帮你?", h1)
print(len(h1), len(h2))
print(h1 is h2, h2[0] is h1[0])
```

<div class="line-notes">

- `def add_message(role, text, history=()):` 默认值是空元组,元组不可变,共用也没事。
- `return list(history) + [{"role": role, "content": text}]` `list(history)` 先把元组或列表复制成一个新列表,再 `+` 上一条新消息,造出第三个新列表交回去。没有 `append`,没有修改任何传进来的东西。
- `h1 = add_message("user", "你好")` 从空历史开始,得到只有 1 条的新列表。
- `h2 = add_message("assistant", "请问有什么可以帮你?", h1)` 在 `h1` 的基础上再加一条,得到一个**新**列表 `h2`。`h1` 不变。
- `print(len(h1), len(h2))` 两份各自的长度。
- `print(h1 is h2, h2[0] is h1[0])` 两个列表是不是同一个,以及它们的第一条消息是不是同一个对象。

</div>

```text
$ uv run python part01/mut_pure.py
1 2
False True
```

<div class="line-notes">

- `1 2` `h1` 还是 1 条,`h2` 有 2 条。没有改动传进来的 `h1`。
- `False True` 两个列表不是同一个;但第一条消息(一个字典)两边**是同一个对象**,因为 `list(history)` 只是浅拷贝(Day 26)。这里没人去改消息本身,所以没关系;如果以后要改消息里的内容,就得用 `copy.deepcopy`。

</div>

三种写法我怎么选:默认就用第一种(`None` 加 `if`),最直白,绝大多数项目都这么写;需要「调用后原数据不能动」时用第三种;`or []` 不用。同样的坑对字典 `{}` 和集合 `set()` 也成立。数字、字符串、`None`、元组这些不可变的东西,当默认值完全没问题。

## 小项目:一个能按条件查工单的函数

把今天的东西用在一个小任务上:Agent 的工具函数通常有一堆可选条件(按类别、按金额下限、按关键词、最多返回几条),这正是默认参数加关键字参数的用武之地。新建 `part01/ticket_search.py`:

```python
# agent-zero-lab/part01/ticket_search.py
tickets = [
    {"id": "T901", "category": "计费", "amount": "29900", "desc": "重复扣款,请退款"},
    {"id": "T902", "category": "登录", "amount": "0", "desc": "验证码收不到"},
    {
        "id": "T903",
        "category": "计费",
        "amount": "46800",
        "desc": "年付多扣了,要求退款",
    },
    {"id": "T904", "category": "功能", "amount": "0", "desc": "导出PDF乱码"},
    {"id": "T905", "category": "计费", "amount": "4900", "desc": "想要发票PDF"},
    {"id": "T906", "category": "计费", "amount": "59800", "desc": "扣了两次,申请退款"},
    {"id": "T907", "category": "登录", "amount": "0", "desc": "Forgot password"},
]


def search(tickets, category=None, min_fen=0, keyword="", limit=None):
    result = []
    for t in tickets:
        if category is not None and t["category"] != category:
            continue
        if int(t["amount"]) < min_fen:
            continue
        if keyword and keyword not in t["desc"]:
            continue
        result.append(t)
        if limit is not None and len(result) >= limit:
            break
    return result


def format_ticket(t, show_amount=True, sep=" | "):
    parts = [t["id"], t["category"]]
    if show_amount:
        parts.append(f"{int(t['amount']) // 100}元")
    parts.append(t["desc"])
    return sep.join(parts)


def ids(found):
    return [t["id"] for t in found]


print("全部:", ids(search(tickets)))
print("只看计费:", ids(search(tickets, "计费")))
print("计费且 ≥ 100 元:", ids(search(tickets, category="计费", min_fen=10000)))
print("含「退款」,最多 2 张:", ids(search(tickets, keyword="退款", limit=2)))
print(
    "计费、有金额、最多 3 张:",
    ids(search(tickets, min_fen=1, limit=3, category="计费")),
)
print()
for t in search(tickets, category="计费", min_fen=10000):
    print(format_ticket(t))
print(format_ticket(tickets[0], show_amount=False))
print(format_ticket(tickets[1], sep=" / "))
```

<div class="line-notes">

- `tickets = [` 7 张工单,每张是字典,金额是字符串(Day 24 的约定:用时才 `int`)。T901、T903、T905、T906 是计费类,T902 和 T907 是登录,T904 是功能。
- `def search(tickets, category=None, min_fen=0, keyword="", limit=None):` 一个必须传的 `tickets`,四个可选条件。每个默认值都是「不筛选」的意思:`None` 表示不限类别,0 表示不限金额,空串表示不限关键词,`None` 表示不限条数。四个默认值全是不可变的,没有 `[]`。
- `result = []` 结果列表,每次调用在函数体里新建,每次都是新的。
- `for t in tickets:` 遍历。
- `if category is not None and t["category"] != category:` 给了类别,而且这张的类别不对,就跳过。`is not None` 是 `is None` 的反面。
- `continue` 跳过这一张(Day 19)。
- `if int(t["amount"]) < min_fen:` 金额低于下限,跳过。
- `if keyword and keyword not in t["desc"]:` 给了关键词(非空串为真),而且描述里没有,就跳过。
- `result.append(t)` 走到这里才是符合条件的。
- `if limit is not None and len(result) >= limit:` 给了条数上限而且已经够了。
- `break` 够了就停,后面的不用看了(Day 19)。
- `return result` 交回符合条件的工单列表。
- `def format_ticket(t, show_amount=True, sep=" | "):` 把一张工单显示成一行,两个可选项:要不要金额,用什么分隔符。
- `parts = [t["id"], t["category"]]` 先放工单号和类别。
- `if show_amount:` 要显示金额吗?默认要。
- `parts.append(f"{int(t['amount']) // 100}元")` 追加金额,f-string 里取键用单引号。
- `parts.append(t["desc"])` 追加描述。
- `return sep.join(parts)` 用 `sep` 把几项拼成一行(Day 16 的 `join`)。
- `def ids(found):` 一个小帮手,只取出工单号方便打印。
- `return [t["id"] for t in found]` 推导式(Day 23)。
- `print("全部:", ids(search(tickets)))` 只传必须的,四个条件全默认,返回全部 7 张。
- `print("只看计费:", ids(search(tickets, "计费")))` 第二个位置参数是 `category`。
- `print("计费且 ≥ 100 元:", ids(search(tickets, category="计费", min_fen=10000)))` 按名字传两个条件。
- `print("含「退款」,最多 2 张:", ids(search(tickets, keyword="退款", limit=2)))` 跳过 `category` 和 `min_fen`,只传后两个,这是关键字参数的用处。
- `print(` 这一行被折成了多行,里面是一个顺序打乱的调用:`min_fen=1, limit=3, category="计费"`。
- `ids(search(tickets, min_fen=1, limit=3, category="计费")),` 顺序乱写没关系。
- `print()` 空一行。
- `for t in search(tickets, category="计费", min_fen=10000):` 把结果循环打印。
- `print(format_ticket(t))` 默认格式。
- `print(format_ticket(tickets[0], show_amount=False))` 关掉金额。
- `print(format_ticket(tickets[1], sep=" / "))` 换分隔符。

</div>

```text
$ uv run python part01/ticket_search.py
全部: ['T901', 'T902', 'T903', 'T904', 'T905', 'T906', 'T907']
只看计费: ['T901', 'T903', 'T905', 'T906']
计费且 ≥ 100 元: ['T901', 'T903', 'T906']
含「退款」,最多 2 张: ['T901', 'T903']
计费、有金额、最多 3 张: ['T901', 'T903', 'T905']

T901 | 计费 | 299元 | 重复扣款,请退款
T903 | 计费 | 468元 | 年付多扣了,要求退款
T906 | 计费 | 598元 | 扣了两次,申请退款
T901 | 计费 | 重复扣款,请退款
T902 / 登录 / 0元 / 验证码收不到
```

<div class="line-notes">

- `全部: ['T901', 'T902', 'T903', 'T904', 'T905', 'T906', 'T907']` 没有筛选条件,7 张全在。
- `只看计费: ['T901', 'T903', 'T905', 'T906']` 四张计费类。
- `计费且 ≥ 100 元: ['T901', 'T903', 'T906']` T905 只有 49 元,出局。
- `含「退款」,最多 2 张: ['T901', 'T903']` 描述含「退款」的有 T901、T903、T906,`limit=2` 到第二张就 `break`,T906 没机会进来。
- `计费、有金额、最多 3 张: ['T901', 'T903', 'T905']` 计费类里金额不为 0 的有四张,取前三张。
- `T901 | 计费 | 299元 | 重复扣款,请退款` 默认格式。
- `T903 | 计费 | 468元 | 年付多扣了,要求退款` 第二张。
- `T906 | 计费 | 598元 | 扣了两次,申请退款` 第三张。
- `T901 | 计费 | 重复扣款,请退款` `show_amount=False`,金额没了。
- `T902 / 登录 / 0元 / 验证码收不到` 分隔符换成 ` / `。

</div>

basedpyright 对这个脚本零报错,Ruff 通过。这一类函数以后会反复见到:第三部分给大模型写「工具」时,工具的每一个可选参数都是这个形状,而且 `None` 的使用方式一模一样。

## 动手练习

### 练习 1:按剩余天数退款

年付客户中途退订,按没用到的天数比例退款。写 `part01/ex29_1_refund.py`:

- `refund_fen(paid_fen, used_days, total_days=365)`:已付金额(分)、已用天数、总天数(默认 365 天)。交回应退金额(整数分,用整除)= 已付 × 剩余天数 ÷ 总天数;已用天数不少于总天数时交回 0,要求用提前 `return`。
- 用下面五种调用方式验证(位置、关键字、覆盖默认值、全部按名字乱序、用满了):

```python
print(refund_fen(468000, 30))
print(refund_fen(468000, used_days=30))
print(refund_fen(468000, 30, total_days=366))
print(refund_fen(paid_fen=29900, total_days=30, used_days=10))
print(refund_fen(468000, 400))
```

期望输出:

```text
429534
429534
429639
19933
0
```

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex29_1_refund.py
def refund_fen(paid_fen, used_days, total_days=365):
    if used_days >= total_days:
        return 0
    return paid_fen * (total_days - used_days) // total_days


print(refund_fen(468000, 30))
print(refund_fen(468000, used_days=30))
print(refund_fen(468000, 30, total_days=366))
print(refund_fen(paid_fen=29900, total_days=30, used_days=10))
print(refund_fen(468000, 400))
```

<div class="line-notes">

- `def refund_fen(paid_fen, used_days, total_days=365):` 两个必须的,一个有默认值 365 的,默认值的参数排在最后。
- `if used_days >= total_days:` 已经用满了(或者更多,比如退订晚了)。
- `return 0` 没有可退的,提前返回,不用往下算,也避开了负数。
- `return paid_fen * (total_days - used_days) // total_days` 先乘后整除,金额是整数分(Day 12)。第一次调用 `468000 * (365 - 30) // 365`:`468000 * 335` 是 156780000,除以 365 取整得 429534。
- `print(refund_fen(468000, 30))` 全按位置传,`total_days` 用默认的 365。
- `print(refund_fen(468000, used_days=30))` 第二个参数按名字传,结果一样。
- `print(refund_fen(468000, 30, total_days=366))` 用关键字覆盖默认值,闰年按 366 天。`468000 * 336 // 366` 是 429639。
- `print(refund_fen(paid_fen=29900, total_days=30, used_days=10))` 三个全按名字、顺序乱写。月付 299 元,30 天用了 10 天,剩 20 天:`29900 * 20 // 30` 是 19933。
- `print(refund_fen(468000, 400))` 400 天大于 365,走提前返回。

</div>

```text
$ uv run python part01/ex29_1_refund.py
429534
429534
429639
19933
0
```

<div class="line-notes">

- `429534` 年付 4680 元,用了 30 天,退 4295.34 元。
- `429534` 按名字传 `used_days`,结果一样。
- `429639` 按 366 天算,每天更少,退得稍多一点。
- `19933` 月付客户的退款。
- `0` 已经用满,没有可退的。

</div>

</details>

### 练习 2:先猜,再跑

不要先运行。下面七行输出分别是什么?先写下答案再核对。重点看第 5 行(`g(3, [])` 传了自己的列表,后面的 `g(4)` 看到的是什么)和最后一行(`__defaults__`)。

```python
# agent-zero-lab/part01/ex29_2_guess.py
def f(a, b=2, c=3):
    return a, b, c


def g(x, items=[]):
    items.append(x)
    return len(items)


def k(x, items=None):
    if items is None:
        items = []
    items.append(x)
    return len(items)


print(f(1))
print(f(1, 5))
print(f(1, c=9))
print(f(c=7, a=0))
print(g(1), g(2), g(3, []), g(4))
print(k(1), k(2))
print(f.__defaults__, g.__defaults__)
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex29_2_guess.py
(1, 2, 3)
(1, 5, 3)
(1, 2, 9)
(0, 2, 7)
1 2 1 3
1 1
(2, 3) ([1, 2, 4],)
```

<div class="line-notes">

- `(1, 2, 3)` 第 1 行。只传了 `a`,`b` 和 `c` 用默认的 2 和 3。
- `(1, 5, 3)` 第 2 行。第二个位置给了 `b`,`c` 仍然默认。
- `(1, 2, 9)` 第 3 行。`c=9` 按名字传,跳过了 `b`,`b` 用默认 2。
- `(0, 2, 7)` 第 4 行。`c=7, a=0` 顺序乱写,`b` 默认 2。
- `1 2 1 3` 第 5 行。`g` 用了可变默认值:`g(1)` 往默认列表加,长度 1;`g(2)` 同一个默认列表,长度 2;`g(3, [])` 传了自己的新列表,长度 1,默认列表不受影响;`g(4)` 回到默认列表,里面已经有 1、2,再加 4,长度 3。四个 `g(...)` 在同一个 `print` 里按从左到右的顺序执行。
- `1 1` 第 6 行。`k` 用 `None` 加 `if`,每次都新建列表,两次长度都是 1。
- `(2, 3) ([1, 2, 4],)` 第 7 行。`f` 的默认值元组是 `(2, 3)`;`g` 的默认值元组里那个列表,已经变成了 `[1, 2, 4]`(1、2、4 三次累积,3 去了自己传的列表里)。

</div>

</details>

### 练习 3:找出五个错

`part01/ex29_3_bug.py` 里藏着今天的五个坑。先照原样跑一遍,每次只修**最先露出来的那一个**,再跑,直到跑完,并且每一行输出你都能解释。

```python
# agent-zero-lab/part01/ex29_3_bug.py
def fee(rate_percent=3, amount_fen):
    return amount_fen * rate_percent // 100


print(fee(10000, 5))
print(fee(amount_fen=10000, 5))
print(fee(10000, amount_fen=10000))
print(fee(10000, rate=5))


def tag_all(descs, tags=[]):
    for d in descs:
        if "退款" in d:
            tags.append("退款")
    return tags


print(len(tag_all(["要退款"])), len(tag_all(["要退款"])))
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex29_3_bug.py
  File "/Users/你/agent-zero-lab/part01/ex29_3_bug.py", line 2
    def fee(rate_percent=3, amount_fen):
                            ^^^^^^^^^^
SyntaxError: parameter without a default follows parameter with a default
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/ex29_3_bug.py", line 2` 第一个坑在第 2 行。语法错误,所以连第 6 行的 `print` 都没机会运行,没有任何输出。
- `def fee(rate_percent=3, amount_fen):` 有默认值的 `rate_percent` 排在没默认值的 `amount_fen` 前面。
- `SyntaxError: parameter without a default follows parameter with a default` 修:把必须传的放前面,`def fee(amount_fen, rate_percent=3):`。**改完要同时想一想调用处**:第 6 行的 `fee(10000, 5)` 原本就是「金额在前、税率在后」,正好对得上。

</div>

```text
$ uv run python part01/ex29_3_bug.py
  File "/Users/你/agent-zero-lab/part01/ex29_3_bug.py", line 7
    print(fee(amount_fen=10000, 5))
                                 ^
SyntaxError: positional argument follows keyword argument
```

<div class="line-notes">

- `line 7` 第二个坑,又是语法错误,依然一行都没运行。
- `print(fee(amount_fen=10000, 5))` 先写关键字再写位置。
- `SyntaxError: positional argument follows keyword argument` 修:`fee(10000, rate_percent=5)`,位置在前、关键字在后。

</div>

```text
$ uv run python part01/ex29_3_bug.py
500
500
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex29_3_bug.py", line 8, in <module>
    print(fee(10000, amount_fen=10000))
          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
TypeError: fee() got multiple values for argument 'amount_fen'
```

<div class="line-notes">

- `500` 第 6 行 `fee(10000, 5)`:`10000 * 5 // 100`。
- `500` 第 7 行改过之后 `fee(10000, rate_percent=5)`,结果一样。
- `line 8, in <module>` 第三个坑,这次是运行时报错。
- `print(fee(10000, amount_fen=10000))` 第一个位置实参已经给了 `amount_fen`,又按名字给一次。
- `TypeError: fee() got multiple values for argument 'amount_fen'` 修:想用默认税率就只写 `fee(10000)`。

</div>

```text
$ uv run python part01/ex29_3_bug.py
500
500
300
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex29_3_bug.py", line 9, in <module>
    print(fee(10000, rate=5))
          ^^^^^^^^^^^^^^^^^^
TypeError: fee() got an unexpected keyword argument 'rate'
```

<div class="line-notes">

- `300` 第 8 行改成 `fee(10000)`,用默认税率 3%:`10000 * 3 // 100`。
- `line 9, in <module>` 第四个坑。
- `print(fee(10000, rate=5))` 参数叫 `rate_percent`,写成了 `rate`。
- `TypeError: fee() got an unexpected keyword argument 'rate'` 修:`rate_percent=5`。

</div>

```text
$ uv run python part01/ex29_3_bug.py
500
500
300
500
1 2
```

<div class="line-notes">

- `500` 前四行都对了。
- `500` 第二行。
- `300` 第三行。
- `500` 第四行。
- `1 2` **第五个坑,不报错**:两次独立的调用 `tag_all(["要退款"])`,第一次长度 1,第二次应该也是 1,却得到 2。原因是 `tags=[]` 可变默认值,第二次调用看到了第一次留下的「退款」。Ruff 的 B006 在你写它的时候就提醒过。修:`tags=None`,函数里 `if tags is None: tags = []`。

</div>

五个都改好的 `part01/ex29_3_fixed.py`:

```python
# agent-zero-lab/part01/ex29_3_fixed.py
def fee(amount_fen, rate_percent=3):
    return amount_fen * rate_percent // 100


print(fee(10000, 5))
print(fee(10000, rate_percent=5))
print(fee(10000))
print(fee(10000, rate_percent=5))


def tag_all(descs, tags=None):
    if tags is None:
        tags = []
    for d in descs:
        if "退款" in d:
            tags.append("退款")
    return tags


print(len(tag_all(["要退款"])), len(tag_all(["要退款"])))
```

<div class="line-notes">

- `def fee(amount_fen, rate_percent=3):` 必须传的在前,有默认值的在后。
- `return amount_fen * rate_percent // 100` 手续费。
- `print(fee(10000, 5))` 位置传,500。
- `print(fee(10000, rate_percent=5))` 按名字,500。
- `print(fee(10000))` 用默认税率 3%,300。
- `print(fee(10000, rate_percent=5))` 参数名拼对,500。
- `def tag_all(descs, tags=None):` 默认值换成 `None`。
- `if tags is None:` 没传?
- `tags = []` 每次调用新建一个自己的列表。
- `for d in descs:` 遍历描述。
- `if "退款" in d:` 含「退款」。
- `tags.append("退款")` 加标签。
- `return tags` 交回。
- `print(len(tag_all(["要退款"])), len(tag_all(["要退款"])))` 两次独立调用,各得到一个新列表,长度都是 1。

</div>

```text
$ uv run python part01/ex29_3_fixed.py
500
500
300
500
1 1
```

<div class="line-notes">

- `500` 第一个。
- `500` 第二个。
- `300` 第三个。
- `500` 第四个。
- `1 1` 两次调用互不影响,这才是对的。

</div>

</details>

### 练习 4:消息工厂

Agent 的每条消息通常带一些附加信息(标签)。写 `part01/ex29_4_message.py`:

- `make_message(role, content, tags=None)`:交回字典 `{"role": ..., "content": ..., "tags": [...]}`,没传 `tags` 就给这条消息一个**自己的**空列表;
- `history_text(history, sep="\n", show_role=True)`:把消息列表拼成一段文字,`show_role=True` 时每行是 `角色: 内容`,否则只有内容,`sep` 是行与行之间的分隔符;
- 验证:给第一条消息加一个标签,其他消息的标签不能被影响。

期望输出:

```text
['发票'] ['退款'] []
user: 我的发票在哪?
user: 帮我退款
assistant: 好的,已转财务
我的发票在哪? / 帮我退款 / 好的,已转财务
```

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex29_4_message.py
def make_message(role, content, tags=None):
    if tags is None:
        tags = []
    return {"role": role, "content": content, "tags": tags}


def history_text(history, sep="\n", show_role=True):
    lines = []
    for m in history:
        if show_role:
            lines.append(f"{m['role']}: {m['content']}")
        else:
            lines.append(m["content"])
    return sep.join(lines)


a = make_message("user", "我的发票在哪?")
b = make_message("user", "帮我退款", ["退款"])
a["tags"].append("发票")
print(a["tags"], b["tags"], make_message("user", "你好")["tags"])

history = [a, b, make_message("assistant", "好的,已转财务")]
print(history_text(history))
print(history_text(history, sep=" / ", show_role=False))
```

<div class="line-notes">

- `def make_message(role, content, tags=None):` 默认 `None`,不用 `[]`。
- `if tags is None:` 没传。
- `tags = []` 这条消息自己的空列表。
- `return {"role": role, "content": content, "tags": tags}` 交回字典。
- `def history_text(history, sep="\n", show_role=True):` 两个有默认值的可选项,默认值都是不可变的字符串和布尔值。
- `lines = []` 函数体里新建的列表。
- `for m in history:` 遍历消息。
- `if show_role:` 要角色吗?
- `lines.append(f"{m['role']}: {m['content']}")` 带角色的一行。
- `else:` 不要角色。
- `lines.append(m["content"])` 只有内容。
- `return sep.join(lines)` 用分隔符拼成一段文字。
- `a = make_message("user", "我的发票在哪?")` 没传 `tags`,拿到自己的空列表。
- `b = make_message("user", "帮我退款", ["退款"])` 传了 `["退款"]`。
- `a["tags"].append("发票")` 只给 `a` 加标签。
- `print(a["tags"], b["tags"], make_message("user", "你好")["tags"])` 三份标签:`a` 的是 `['发票']`,`b` 的是 `['退款']`,第三条新造的是 `[]`。如果 `make_message` 用了 `tags=[]`,第一和第三个都会是 `['发票']`。
- `history = [a, b, make_message("assistant", "好的,已转财务")]` 三条消息的历史。
- `print(history_text(history))` 默认:一行一条,带角色。
- `print(history_text(history, sep=" / ", show_role=False))` 只覆盖两个默认值,按名字传。

</div>

```text
$ uv run python part01/ex29_4_message.py
['发票'] ['退款'] []
user: 我的发票在哪?
user: 帮我退款
assistant: 好的,已转财务
我的发票在哪? / 帮我退款 / 好的,已转财务
```

<div class="line-notes">

- `['发票'] ['退款'] []` 三份标签互不影响。
- `user: 我的发票在哪?` 默认格式的第一行。
- `user: 帮我退款` 第二行。
- `assistant: 好的,已转财务` 第三行。
- `我的发票在哪? / 帮我退款 / 好的,已转财务` 去掉角色、换了分隔符。

</div>

</details>

**验收标准:** 练习 1 的五种调用都对;练习 2 先自己写出七行答案再核对;练习 3 能说清为什么第五个坑不报错、Ruff 的哪一条规则提前提醒过;练习 4 的三份标签互不影响。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 默认参数 | 定义时给参数写 `=值`,调用时不传就用它。`def f(a, b=2)` |
| 关键字参数 | 调用时写「名字=值」,按名字对应,顺序随意。`f(b=3, a=1)` |
| 位置参数 | 按位置对应的参数,不写名字。`f(1, 3)` |
| 可变对象 | 建好以后还能改的:列表、字典、集合。数字、字符串、`None`、元组不能改 |
| `__defaults__` | 函数身上存默认值的属性,一个元组。能直接看到默认值现在的样子 |
| `is None` | 判断「是不是 `None` 这个唯一的对象」,判断「有没有传」时的标准写法 |
| 哨兵值(sentinel) | 用 `None` 这类特殊值表示「没传」,函数里再决定怎么办 |
| `SyntaxError` | 语法错误,Python 读文件时就发现,整个脚本一行都不会运行 |
| `TypeError: ... got multiple values for argument` | 同一个参数被传了两次 |
| `TypeError: ... got an unexpected keyword argument` | 传了一个函数不认识的名字 |
| Ruff B006 / B008 | 规则:别用可变数据结构、别用函数调用当参数默认值 |

## 常见误区

**以为 Python 的默认值像 JS 一样每次调用重新算。** 不是,`def` 执行时算一次。数字、字符串没事,列表、字典、集合有事。

**用 `[]`、`{}`、`set()` 当默认值。** 所有没传的调用共用同一个对象,不报错,调用得越多越乱。写 `None`,函数里新建。看到 Ruff 的 B006 就改。

**写成 `history = history or []`。** 调用者传进来一个空列表时,空列表是假,会被换成新的,调用者以为在往自己的列表里装东西,其实没装。判断「有没有传」用 `is None`。

**把 `if x is None` 写成 `if not x`。** 同上,`0`、空串、空列表都会被当成「没传」。区分「没传」和「传了个假值」只能用 `is None`。

**把有默认值的参数放在前面。** `SyntaxError: parameter without a default follows parameter with a default`。必须传的放前面,可选的放后面。

**位置参数写在关键字参数后面。** `SyntaxError: positional argument follows keyword argument`。先写位置,再写名字。

**同一个参数又按位置又按名字传。** `got multiple values for argument`。数一数前面按位置传了几个,它们占掉了前几个参数。

**把开关参数写成位置。** `label("T201", "计费", 29900, True)`,半年后没人记得 `True` 是什么。开关和可选项一律写名字。

**改了函数参数的顺序,忘了改调用处。** 如果两个参数类型相同(两个整数),位置一错不报错,只是算错。重要的调用写成关键字,参数顺序就不再重要。

**默认值写成函数调用。** `def log(t=time.time())` 只在定义那一刻算一次,以后永远是同一个时间。要「每次调用的当前时间」,写 `t=None`,函数里 `if t is None: t = time.time()`。

## 学习资料

### 文档与文章

- [Python 教程 · 默认参数值](https://docs.python.org/zh-cn/3.12/tutorial/controlflow.html#default-argument-values):中文,官方教程里最重要的一句话写得很直白:「默认值只计算一次」,并且就用列表举了例子。
- [Python 教程 · 关键字参数](https://docs.python.org/zh-cn/3.12/tutorial/controlflow.html#keyword-arguments):中文,位置参数和关键字参数的规则,几个报错例子和今天的三个报错对应。
- [FAQ · 为什么默认值会在对象之间共享](https://docs.python.org/zh-cn/3.12/faq/programming.html#why-are-default-values-shared-between-objects):中文,官方 FAQ 里专门回答这个问题,还提到了这个特性的一个有用之处(缓存)。
- [The Hitchhiker's Guide to Python · Common Gotchas](https://docs.python-guide.org/writing/gotchas/):英文,「Mutable Default Arguments」一节,几行代码演示同一个坑,也给了 `None` 的修法。
- [Ruff · mutable-argument-default (B006)](https://docs.astral.sh/ruff/rules/mutable-argument-default/):英文,Ruff 这条规则的说明,里面有「为什么不好」和修法。
- [MDN · 默认参数值](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Functions/Default_parameters):中文,JS 一侧对照,「默认参数在调用时才求值」那一段正好和 Python 相反。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1GwJRzuE7d&autoplay=0&high_quality=1" title="【Python】可变的默认参数陷阱丨程序员踩坑日记·基础篇01期" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员踩坑日记 · 【Python】可变的默认参数陷阱 · 4 分钟,2025 年的视频,直接复现今天的 `add_tag` 现象并讲修法。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV13F4m1V7Kk&autoplay=0&high_quality=1" title="4分钟搞懂参数默认值这个概念 #Python #编程 #程序员" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员陈雷雷 · 4分钟搞懂参数默认值这个概念 · 4 分钟,先把默认参数本身讲明白,是今天前半部分的复习。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/_JGmemuINww" title="Python Tutorial: Clarifying the Issues with Mutable Default Arguments" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial: Clarifying the Issues with Mutable Default Arguments · 英文,16 分钟,他用时间戳的例子讲「默认值只算一次」,和今天的 `dflt_once.py` 同一个思路,再讲列表的坑。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/1PTx3-mAO1E" title="Mutable default arguments in Python" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Python Morsels · Mutable default arguments in Python · 英文,不到 4 分钟,最短的一版,适合默写前快速过一遍。</figcaption>
</figure>

### 书籍

- Luciano Ramalho《Fluent Python》第 2 版,O'Reilly,2022。第 6 章「Object References, Mutability, and Recycling」里专门讲了把可变对象当参数默认值的问题,以及函数怎么安全地对待调用者传进来的可变参数。书很厚,现在只读这一节。
- Eric Matthes《Python Crash Course》第 3 版,No Starch Press,2023(中译《Python编程:从入门到实践》)。第 8 章「Functions」里的「Default Values」「Making an Argument Optional」,和今天前半部分一一对应。

### 开源项目与代码

- 今天这组不需要:默认参数和可变默认值陷阱用官方 FAQ 和上面的视频就能学透,不必另找开源代码。

## 自测

1. `def f(a, b=2, c=3)`,调用 `f(1, c=9)` 得到什么?`f(c=7, a=0)` 呢?

<details><summary>答案</summary>

`(1, 2, 9)` 和 `(0, 2, 7)`(假设函数交回 `(a, b, c)`)。没传的 `b` 用默认值 2,关键字参数的顺序随意。

</details>

2. 下面哪些定义会报 `SyntaxError`?

```python
def a(x, y=1): ...
def b(x=1, y): ...
def c(x=1, y=2): ...
```

<details><summary>答案</summary>

只有 `b`。没默认值的 `y` 不能跟在有默认值的 `x=1` 后面。

</details>

3. 下面的代码运行两次 `append_one()`,各打印什么?为什么?怎么改?

```python
def append_one(items=[]):
    items.append(1)
    return items
print(append_one())
print(append_one())
```

<details><summary>答案</summary>

`[1]` 和 `[1, 1]`。默认列表只在 `def` 时造一次,两次调用共用它。改成 `items=None`,函数里 `if items is None: items = []`。

</details>

4. `history = history or []` 和 `if history is None: history = []` 哪个更安全?说出一个会出问题的场景。

<details><summary>答案</summary>

后者。调用者传进来一个空列表 `[]` 时,前者因为空列表是假,会换成一个新列表,调用者手里的那个不会被填充;后者只在真的是 `None` 时才新建。

</details>

5. `TypeError: f() got multiple values for argument 'a'` 和 `TypeError: f() got an unexpected keyword argument 'x'` 各是什么原因?

<details><summary>答案</summary>

前者:同一个参数 `a` 被传了两次,通常是已经按位置传了一个,又按名字传了一次。后者:函数没有叫 `x` 的参数,多半是名字拼错,或者调用的版本和函数定义不一致。

</details>

6. **面试题**:Python 中函数参数的默认值是在什么时候求值的?这会带来什么问题,怎么避免?

<details><summary>答案</summary>

默认值在函数定义时(执行 `def` 语句时)求值,只算一次,结果存在函数对象的 `__defaults__` 里。如果默认值是可变对象(列表、字典、集合),所有不传该参数的调用共用同一个对象,一次调用的修改会被后面的调用看到。避免:默认值用 `None`,在函数体里 `if x is None: x = []`;或者用不可变的默认值(元组)再造新对象返回。Ruff 的 B006 规则可以自动发现。在 Agent 项目里常见的后果是:会话历史、缓存、结果列表被不同用户共用,导致串号。

</details>

## 明天预告

Day 30 · 函数(三):`*args`、`**kwargs`、作用域和 lambda。今天你见过两种传参(位置和名字)。明天看一个函数怎么「收下数量不定的参数」:`print("a", "b", "c")` 为什么能传任意多个,`*args` 和 `**kwargs` 对应 JS 的 rest 参数和展开;函数里和函数外的同名变量到底谁管谁(作用域,今天 `fen = 100` 那一行只是预告);以及 `lambda`,一次性的小函数,相当于 JS 的箭头函数,可以让昨天的 `key=amount_then_id` 写成一行。
