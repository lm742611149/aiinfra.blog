---
title: 'Day 14 · 布尔、None 和类型转换'
description: 'True 和 False 是首字母大写的,== 不会偷偷转换类型,0 < x <= 500 能连着写;None 是 Python 唯一的「空」,判断它用 is;int()、float()、str() 把字符串和数字互相转,input() 拿到的永远是字符串。最后做一个从键盘读金额、算退款的小脚本。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 14
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 13](/blog/agent-zero/day-013-week02-review/) 复习了第 2 周:默写了 `hello-py`、从空目录重建 uv 项目、Day 12 的报价单,又做了一个在任何目录都能敲的 `~/bin/cl-calc` 客服速算卡,金额全程用整数分算。那天最后留了个尾巴:速算卡里的数字全是写死在代码里的,换一个客户就得改代码。

要让程序从键盘读数字,得先过三道坎。第一,键盘读进来的东西是字符串 `"299"`,不是数字 `299`,Day 9 已经见过字符串当数字算会报 `TypeError`,要学会转换。第二,转换会失败,用户可能输入 `299元`,要知道失败长什么样。第三,有些值「暂时没有」,比如客户还没用优惠券,JS 里用 `null` 表示,Python 用 `None`。顺带把 Day 12 里一闪而过的 `True`/`False` 讲清楚,今天的内容就齐了。

## 今天要解决的问题

学完今天,你应该能:

1. 写出六个比较运算符,说出 Python 的 `==` 和 JS 的 `==`、`===` 哪里不同;会用 `0 < amount <= 500` 这种连写;知道 `True + True` 为什么是 2。
2. 用 `None` 表示「还没有值」,用 `is None` 判断它;看到 `TypeError: ... 'NoneType'` 知道是有个变量还是 `None` 就被拿去算了。
3. 用 `int()`、`float()`、`str()`、`bool()` 转换类型,知道哪些字符串能转、哪些会报 `ValueError`,知道 `int(19.99 * 100)` 为什么是 1998。
4. 写出 `part01/ask_amount.py`:用 `input()` 读单价和扣款次数,转成整数分,算出该退多少。

预计用时:2.5 小时。布尔和比较 40 分钟,None 30 分钟,类型转换 50 分钟,剩下做 input 脚本和练习。

前置:[Day 8](/blog/agent-zero/day-008-python-vs-node/)(交互模式、`print` 返回 `None`)、[Day 9](/blog/agent-zero/day-009-editor-setup/)(`TypeError`、`int("abc")` 跑不了、`299 == None` 的类型是 bool)、[Day 12](/blog/agent-zero/day-012-numbers/)(int 和 float、整数分、`round`)。今天不调任何 API,花费 0 元。

学法提示:先对照文章逐行敲一遍(代码自己敲,不复制粘贴)并跑通;第二天合上文章,把 `ask_amount.py` 默写出来,用 `299` 和 `2`、`19.99` 和 `3` 两组输入各跑一次对答案;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚我是在哪跑的

输出是我 2026-10-23 在 2019 款 Intel MacBook Pro(macOS 14、zsh)上用演示家目录真跑的,家目录显示成 `/Users/你`,`~/agent-zero-lab` 接着 Day 12 的状态,`uv run python` 是 3.12.13。今天的脚本都放在 `part01/`,在仓库根目录用 `uv run python part01/文件名.py` 运行。

有一点要先说:最后那几个脚本要从键盘读输入。为了把输出原样记下来,我是用管道把输入喂给脚本的(Day 5 的 `|`),所以终端里不会显示我「敲」的字。你在终端里自己敲,敲的字会显示在提示文字后面。第一次出现时我会两种都贴出来,之后贴的是你在终端里会看到的样子。

## True 和 False

### 六个比较运算符

Day 12 的 `0.1 + 0.2 == 0.3` 打印出 `False`。这种只有「是」和「否」两个值的类型叫**布尔**(bool,来自数学家 Boole 的名字),两个值写作 `True` 和 `False`,首字母大写。比较运算的结果就是布尔值。

新建 `part01/compare.py`。还是那张 T001:299 元被扣了两次。假设客服一线能直接批的退款上限是 500 元。

```python
# agent-zero-lab/part01/compare.py
amount = 299
refund_limit = 500
print(amount > 0)
print(amount == 299, amount != 299)
print(amount <= refund_limit)
print(0 < amount <= refund_limit)
times = 1
print(times == 1.0, times == "1")
is_refunded = False
print(is_refunded, type(is_refunded))
print(True + True, True * 10)
```

<div class="line-notes">

- `refund_limit = 500` 一线客服能直接批的退款上限,500 元。
- `print(amount > 0)` 大于。金额是不是正数。
- `print(amount == 299, amount != 299)` `==` 等于,`!=` 不等于。注意 `==` 是两个等号,一个等号 `=` 是赋值(Day 12)。Python 没有 `===`。
- `print(amount <= refund_limit)` 小于等于。还有 `<` 和 `>=`,一共六个。
- `print(0 < amount <= refund_limit)` **连写**:意思是 `0 < amount` 并且 `amount <= refund_limit`,和数学里 0 < x ≤ 500 的写法一样。JS 里不能这么写,下面会看到。
- `times = 1` 一个 int。
- `print(times == 1.0, times == "1")` int 和 float 比,int 和字符串比。
- `is_refunded = False` 布尔值可以直接存进变量。名字用 `is_`、`has_` 开头,一看就知道是个是非题,这是常见的命名习惯,前端也这么写(`isLoading`)。
- `print(is_refunded, type(is_refunded))` 看它的类型。
- `print(True + True, True * 10)` 布尔值拿来算术,看看会怎样。

</div>

```text
$ cd ~/agent-zero-lab
$ uv run python part01/compare.py
True
True False
True
True
True False
False <class 'bool'>
2 10
```

<div class="line-notes">

- `True` 299 > 0。
- `True False` 等于 299 为真,不等于 299 为假。
- `True` 299 ≤ 500。
- `True` 连写也是真。
- `True False` 这一行最要紧。`1 == 1.0` 是真:int 和 float 比的是数值,1 和 1.0 数值相等。`1 == "1"` 是**假**:数字和字符串在 Python 里永远不相等,`==` 不会替你把 `"1"` 转成数字。
- `False <class 'bool'>` 类型叫 `bool`。
- `2 10` `True` 当成 1,`False` 当成 0。Python 里 bool 其实是 int 的一个特殊版本,所以能参与算术。知道就行,别真这么写;唯一常见的用法是数「有几个是真的」,等学了列表再说。

</div>

### 和 JS 的 == 对比

JS 有两种等号:`==` 会先转换类型再比,`===` 不转换。Python 只有一种 `==`,行为接近 JS 的 `===`,数字和字符串不会自动互转:

```text
$ node -e 'console.log(1 == "1", 1 === "1", 0 < 299 <= 500, 0 < 999 <= 500, 5 > 3 > 1)'
true false true true false
```

<div class="line-notes">

- `$ node -e 'console.log(1 == "1", 1 === "1", 0 < 299 <= 500, 0 < 999 <= 500, 5 > 3 > 1)'` 外层用单引号,里面的 JS 字符串用双引号(Day 7 的引号规矩)。
- `true false true true false` 第一个:JS 的 `==` 把 `"1"` 转成数字再比,得 true。第四个是陷阱:`0 < 999 <= 500` 在 JS 里是 **true**。JS 从左往右算,`0 < 999` 得 `true`,再算 `true <= 500`,`true` 被转成 1,1 ≤ 500,真。999 明明超过了 500。最后一个 `5 > 3 > 1` 也一样被算歪成 false。

</div>

同样两个连写在 Python 里:

```text
$ uv run python
>>> 0 < 999 <= 500
False
>>> 5 > 3 > 1
True
>>> true
Traceback (most recent call last):
  File "<stdin>", line 1, in <module>
NameError: name 'true' is not defined. Did you mean: 'True'?
>>> exit()
```

<div class="line-notes">

- `False` Python 把连写当成「两个比较都成立」,999 不满足 ≤ 500,结果是假,符合直觉。
- `True` 5 > 3 并且 3 > 1。
- `>>> true` 前端手感写了小写。
- `NameError: name 'true' is not defined. Did you mean: 'True'?` Python 把小写的 `true` 当成一个没定义的变量名。同样 `false`、`null`、`undefined` 在 Python 里全都是 `NameError`。

</div>

| | JS | Python |
| --- | --- | --- |
| 真、假 | `true`、`false` | `True`、`False` |
| 类型名 | `boolean` | `bool` |
| 等于 / 不等于 | `===` / `!==`(推荐)、`==` / `!=`(会转类型) | `==` / `!=`(不转类型) |
| `1 == "1"` | `==` 得 true,`===` 得 false | `False` |
| 连写 `0 < x <= 500` | 能写,但结果是错的 | 能写,意思和数学一样 |

到这里你只需要会「产生」布尔值。拿布尔值去决定「走哪条路」是 [Day 17](/blog/agent-zero/day-017-if-else/) 的 if,把几个布尔值组合起来的 `and`、`or`、`not` 也在那天讲。

## None:Python 唯一的「空」

### 用 None 表示「还没有」

JS 有两个「空」:`null`(我明确说这里没有值)和 `undefined`(压根没赋过值)。Python 只有一个:**None**。至于「压根没赋过值」,Python 不会给你一个 undefined,而是直接报 `NameError`(Day 12 拼错变量名那个)。

新建 `part01/none_demo.py`。场景:客户下单时可以用优惠券,没用的话「优惠金额」这一栏就是空的。

```python
# agent-zero-lab/part01/none_demo.py
discount_fen = None
print(discount_fen, type(discount_fen))
print(discount_fen is None, discount_fen == 0)

result = print("打印一行")
print("print 的返回值:", result)

discount_fen = 1000
print(discount_fen is None)
```

<div class="line-notes">

- `discount_fen = None` 「优惠金额:还没有」。注意不是 0:0 是「有优惠,优惠了 0 元」,None 是「这件事不存在」。这两个意思在业务上不一样,后面查数据库时,空值和 0 也是分开的。
- `print(discount_fen, type(discount_fen))` 看看它打印出来是什么、类型叫什么。
- `print(discount_fen is None, discount_fen == 0)` `is None` 是判断 None 的标准写法,下面细说。和 0 比一下,看它们是不是一回事。
- `result = print("打印一行")` Day 8 说过 `print(...)` 有返回值,是 None。这里把它存起来看一眼。
- `print("print 的返回值:", result)` 打印存下来的返回值。
- `discount_fen = 1000` 客户用了一张 10 元的券。
- `print(discount_fen is None)` 现在不是 None 了。

</div>

```text
$ uv run python part01/none_demo.py
None <class 'NoneType'>
True False
打印一行
print 的返回值: None
False
```

<div class="line-notes">

- `None <class 'NoneType'>` None 的类型叫 `NoneType`,这个类型只有 None 这一个值。
- `True False` 是 None;和 0 不相等。None 不等于 0,也不等于空字符串 `""`、不等于 `False`,它只等于它自己。
- `打印一行` 这是 `print("打印一行")` 打出来的。
- `print 的返回值: None` 函数什么都不返回时,Python 默认返回 None,相当于 JS 函数不写 return 时得到 `undefined`。以后自己写函数([Day 28](/blog/agent-zero/day-028-functions-1/))会经常见到。
- `False` 改成 1000 之后就不是 None 了。

</div>

### 为什么用 is,不用 ==

`is` 问的是「是不是**同一个**东西」,`==` 问的是「值相不相等」。None 在整个程序里只有一个,所有写 `None` 的地方指的都是同一个对象,所以「是不是 None」最准确的问法是 `x is None`;反过来是 `x is not None`。

`x == None` 大多数时候结果一样,但 PEP 8 明确要求和 None 比较用 `is`,原因是 `==` 的行为可以被别人写的类改掉(第一部分后面学类时会看到),`is` 不能。Ruff 有一条专门的规则 E711 管这个,默认没打开,练习 4 会手动打开它看一次。记住一句就够:**判断 None 永远写 `is None` / `is not None`**,Day 46 学类型标注时还会用到这个写法。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="JS 有 null 和 undefined 两种空,Python 只有 None;JS 里访问没定义的变量得到 ReferenceError,Python 是 NameError;判断 None 用 is None">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink-faint)">JS</text>
<rect x="20" y="40" width="280" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="32" y="65" fill="var(--ink)">null      我说了:这里没有值</text>
<rect x="20" y="90" width="280" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="32" y="115" fill="var(--ink)">undefined 还没赋过值 / 没这个属性</text>
<rect x="20" y="140" width="280" height="40" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
<text x="32" y="165" fill="var(--ink-soft)">没声明的变量 → ReferenceError</text>
<text x="340" y="28" fill="var(--ink-faint)">Python</text>
<rect x="340" y="40" width="280" height="90" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="352" y="72" fill="var(--ink)">None   唯一的「空」</text>
<text x="352" y="96" fill="var(--ink-soft)">判断:x is None</text>
<text x="352" y="116" fill="var(--ink-soft)">函数不写 return 也得到它</text>
<rect x="340" y="140" width="280" height="40" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
<text x="352" y="165" fill="var(--ink-soft)">没定义的变量 → NameError</text>
<line x1="300" y1="60" x2="340" y2="70" stroke="var(--ink-soft)"/>
<line x1="300" y1="110" x2="340" y2="100" stroke="var(--ink-soft)"/>
<line x1="300" y1="160" x2="340" y2="160" stroke="var(--ink-soft)"/>
<text x="20" y="212" fill="var(--ink-soft)">JS 两种「空」在 Python 里合成一个 None;没定义的名字两边都报错</text>
</g>
</svg>
<figcaption>JS 的 null 和 undefined 都对应 Python 的 None。Python 没有 undefined。</figcaption>
</figure>

### None 拿去算会怎样

None 最常见的事故是:一个变量本来该有数,结果还是 None,就被拿去算了。新建 `part01/none_error.py`:

```python
# agent-zero-lab/part01/none_error.py
price_fen = 46800
discount_fen = None
print("折后:", price_fen - discount_fen)
```

<div class="line-notes">

- `price_fen = 46800` 年付 468 元。
- `discount_fen = None` 优惠还没有。
- `print("折后:", price_fen - discount_fen)` 直接减。保存时 Zed 里这里就有红线了,basedpyright 说 `Operator "-" not supported for types "Literal[46800]" and "None"`。

</div>

```text
$ uv run python part01/none_error.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/none_error.py", line 4, in <module>
    print("折后:", price_fen - discount_fen)
                   ~~~~~~~~~~^~~~~~~~~~~~~~
TypeError: unsupported operand type(s) for -: 'int' and 'NoneType'
```

<div class="line-notes">

- `~~~~~~~~~~^~~~~~~~~~~~~~` 指着减号。
- `TypeError: unsupported operand type(s) for -: 'int' and 'NoneType'` 「减号不支持 int 和 NoneType」。以后看到报错里出现 `'NoneType'`,第一反应就是:哪个变量我以为有值,其实是 None?顺着往上找它是在哪赋的值。这类报错在调大模型 API 时特别常见,模型没返回某个字段,你拿到的就是 None。

</div>

对比 JS:

```text
$ node -e 'let a; console.log(a, null == undefined, null === undefined, 46800 - null, 46800 - undefined)'
undefined true false 46800 NaN
```

<div class="line-notes">

- `undefined true false 46800 NaN` JS 里 `46800 - null` 得 46800(null 被当成 0),`46800 - undefined` 得 `NaN`,都不报错,错误的数字悄悄流到后面。Python 直接停下来告诉你。还是 Day 9 那句话:会报错的语言,反而更安全。

</div>

## 类型转换:int()、float()、str()、bool()

### 字符串和数字互转

Day 9 演示过,`"299" * 2` 得到 `"299299"`,`"299" - 299` 报 `TypeError`。要拿字符串算数,先把它转成数字。新建 `part01/convert.py`:

```python
# agent-zero-lab/part01/convert.py
text = "299"
print(text * 2, int(text) * 2)
print(int(" 299\n"), int("1_000"), int("１２３"))
print(float("19.99"), float("1e3"))
print(str(299) + "元", type(str(299)))
print(int(19.99), int(-2.5), round(-2.5))
print(int(19.99 * 100), round(19.99 * 100))
print(float(3), int(True))
```

<div class="line-notes">

- `text = "299"` 一个字符串,就像从表单、从文件里读到的金额。
- `print(text * 2, int(text) * 2)` 转换前后各乘 2。`int(x)` 把 x 转成整数,相当于 JS 的 `Number(x)` 或 `parseInt(x, 10)`。
- `print(int(" 299\n"), int("1_000"), int("１２３"))` 三个「看起来不太规整」的字符串:前后带空格和换行(`\n` 是换行符,字符串那两天细讲);带下划线;全角数字(中文输入法打出来的那种)。
- `print(float("19.99"), float("1e3"))` `float(x)` 转成浮点数。`1e3` 是科学计数法,1 × 10³。
- `print(str(299) + "元", type(str(299)))` `str(x)` 把任何东西转成字符串,相当于 JS 的 `String(x)`。转成字符串以后才能和 `"元"` 用 `+` 拼起来。
- `print(int(19.99), int(-2.5), round(-2.5))` 把 float 转成 int。
- `print(int(19.99 * 100), round(19.99 * 100))` Day 12 那个 `1998.9999999999998`,分别用 `int` 和 `round` 处理。
- `print(float(3), int(True))` int 转 float,bool 转 int。

</div>

```text
$ uv run python part01/convert.py
299299 598
299 1000 123
19.99 1000.0
299元 <class 'str'>
19 -2 -2
1998 1999
3.0 1
```

<div class="line-notes">

- `299299 598` 字符串乘 2 是重复两遍,转成 int 再乘才是 598。
- `299 1000 123` 三个都转成功了。`int()` 会自己去掉前后的空格和换行;认识数字里的下划线;连全角数字 `１２３` 都认。这一点比 JS 宽松:`Number("１２３")` 在 JS 里是 `NaN`。中国用户在输入框里用全角数字的情况真的有,Python 这里帮了你。
- `19.99 1000.0` `float()` 认小数点和科学计数法。
- `299元 <class 'str'>` 拼出来的是字符串。显示金额时常这么拼,Day 15 的 f-string 会更方便。
- `19 -2 -2` 重点。`int(19.99)` 是 19,不是 20:`int()` **直接砍掉小数部分**,不四舍五入。`int(-2.5)` 是 −2,往 0 的方向砍,和 Day 12 的 `//` 往下取整不一样(`-5 // 2` 是 −3)。`round(-2.5)` 也是 −2,那是 Day 12 讲的「五取偶」。
- `1998 1999` 这一行是一个真实的 bug。`19.99 * 100` 算出来是 1998.9999999999998,`int()` 一砍就成了 1998 分,发票上显示 19.98 元,客户少付一分;`round()` 才得到正确的 1999。旧版课里有个练习就是从「基础版每月 19.99 元,发票上显示 19.98 元」查到这一行的。**元转分用 `round`,不用 `int`**。
- `3.0 1` int 转 float 加个 `.0`;`True` 转 int 是 1,和上面 `True + True` 是 2 一个道理。

</div>

再看转换失败。打开交互模式:

```text
$ uv run python
>>> int("299元")
Traceback (most recent call last):
  File "<stdin>", line 1, in <module>
ValueError: invalid literal for int() with base 10: '299元'
>>> int("19.99")
Traceback (most recent call last):
  File "<stdin>", line 1, in <module>
ValueError: invalid literal for int() with base 10: '19.99'
>>> float("abc")
Traceback (most recent call last):
  File "<stdin>", line 1, in <module>
ValueError: could not convert string to float: 'abc'
>>> int("")
Traceback (most recent call last):
  File "<stdin>", line 1, in <module>
ValueError: invalid literal for int() with base 10: ''
>>> int(None)
Traceback (most recent call last):
  File "<stdin>", line 1, in <module>
TypeError: int() argument must be a string, a bytes-like object or a real number, not 'NoneType'
>>> int(float("19.99"))
19
>>> exit()
```

<div class="line-notes">

- `ValueError: invalid literal for int() with base 10: '299元'` **ValueError**:类型对了(是字符串),但值不行。`invalid literal ... with base 10` 是「这不是一个合法的十进制整数写法」,最后引号里是原样的输入,带着那个「元」。JS 的 `parseInt("299元")` 会悄悄返回 299,`Number("299元")` 返回 `NaN`;Python 直接报错。
- `ValueError: invalid literal for int() with base 10: '19.99'` 带小数点的字符串,`int()` 也不认。`int()` 只认整数的写法。
- `ValueError: could not convert string to float: 'abc'` `float()` 失败的报错措辞不同,意思一样。
- `ValueError: invalid literal for int() with base 10: ''` 空字符串也不行。用户什么都没输直接回车,就会得到空字符串,这个坑下面 input 那节会撞。
- `TypeError: int() argument must be a string, a bytes-like object or a real number, not 'NoneType'` 换成 None,报的是 **TypeError**:None 这种类型根本不在 `int()` 接受的范围里。ValueError 是「类型对,值不对」,TypeError 是「类型就不对」,这个区分以后看报错时很有用。
- `19` 想把 `"19.99"` 转成整数,先 `float()` 再 `int()`。但当金额用的话,别忘了上面那个 1998 的坑。

</div>

Day 9 说「`int("abc")` 这种值不对的错,类型检查器看不出来」,现在你看到它跑起来的样子了。怎么在程序里接住这种错误、提示用户重新输入,要等 if([Day 17](/blog/agent-zero/day-017-if-else/))和异常处理([Day 35](/blog/agent-zero/day-035-exceptions-1/))。今天先认识它。

### bool():什么算「假」

`bool(x)` 把任何值转成 True 或 False。哪些值转出来是 False,Python 和 JS 大体一样,只有一处不同,而且前端最容易踩。新建 `part01/to_bool.py`:

```python
# agent-zero-lab/part01/to_bool.py
print(bool(0), bool(0.0), bool(""), bool(None), bool([]))
print(bool(1), bool(-1), bool(" "), bool("0"), bool("False"))
```

<div class="line-notes">

- `print(bool(0), bool(0.0), bool(""), bool(None), bool([]))` 五个「空」的值:0、0.0、空字符串、None、空列表。`[]` 是空列表,相当于 JS 的空数组,[Day 21](/blog/agent-zero/day-021-lists/) 讲。
- `print(bool(1), bool(-1), bool(" "), bool("0"), bool("False"))` 五个「看起来像假」但不一定是假的值:负数、只有一个空格的字符串、字符串 `"0"`、字符串 `"False"`。

</div>

```text
$ uv run python part01/to_bool.py
False False False False False
True True True True True
$ node -e 'console.log(Boolean(0), Boolean(""), Boolean(null), Boolean([]), Boolean("0"), Boolean("false"))'
false false false true true true
```

<div class="line-notes">

- `False False False False False` 第一行全是假。规则很好记:**数字 0、空的东西、None 是假,其他都是真**。
- `True True True True True` 第二行全是真。`bool(" ")` 是真,因为一个空格也是一个字符,不是空字符串。`bool("0")` 和 `bool("False")` 也是真,它们是非空的字符串,`bool()` 不看字符串的内容是什么意思。
- `false false false true true true` JS 的对应结果。和 Python 不同的是第四个:**JS 里空数组 `[]` 是真,Python 里空列表是假**。写惯了 JS 的人,拿 `if (list)` 判断列表非空时要切换一下脑子,第二部分讲上下文窗口的 Day 109 就有一行代码靠「空列表是假」来判断还有没有消息可删。

</div>

`bool("False")` 是真,这个坑会在读配置时撞上:环境变量、命令行参数读进来全是字符串,配置写着 `DEBUG=False`,你 `bool(...)` 一下得到 `True`。要判断字符串的意思,得拿它和 `"true"`、`"1"` 这些去比,以后读 `.env` 文件时会讲。

这种「放在需要真假的地方时,一个值算真还是算假」叫**真值**(truthiness),Day 17 学 if 时会正式用它。

| 转换 | 用途 | 会失败的例子 |
| --- | --- | --- |
| `int(x)` | 字符串或小数 → 整数 | `int("299元")`、`int("19.99")`、`int("")` 报 ValueError |
| `float(x)` | 字符串或整数 → 小数 | `float("abc")` 报 ValueError |
| `str(x)` | 任何东西 → 字符串 | 基本不会失败 |
| `bool(x)` | 任何东西 → 真假 | 不会失败,但 `bool("False")` 是 True |
| `round(x)` | 小数 → 最近的整数 | 不会失败,遇 .5 取偶数(Day 12) |

## input():从键盘读一行

### 读进来的永远是字符串

`input("提示文字")` 打印提示,等用户敲一行字、按回车,把这一行作为**字符串**返回。它大致相当于浏览器里的 `prompt()`,只是在终端里。新建 `part01/ask_raw.py`:

```python
# agent-zero-lab/part01/ask_raw.py
text = input("被扣了几次:")
print("你输入的是:", text, type(text))
print("乘 3:", text * 3)
print("转成 int 再乘 3:", int(text) * 3)
```

<div class="line-notes">

- `text = input("被扣了几次:")` 程序停在这里等你输入。你敲 `2` 回车,`text` 得到的是 `"2"`,不是 `2`。
- `print("你输入的是:", text, type(text))` 确认一下类型。
- `print("乘 3:", text * 3)` 不转换直接乘。
- `print("转成 int 再乘 3:", int(text) * 3)` 转换后再乘。

</div>

在终端里运行,敲 `2` 回车:

```text
$ uv run python part01/ask_raw.py
被扣了几次:2
你输入的是: 2 <class 'str'>
乘 3: 222
转成 int 再乘 3: 6
```

<div class="line-notes">

- `被扣了几次:2` 冒号后面的 `2` 是你敲的。`input` 不会自动在提示后面加空格或换行,提示文字怎么写就怎么显示。
- `你输入的是: 2 <class 'str'>` 打印出来看着是 2,类型却是 `str`。光看 `print` 的输出分不出 `2` 和 `"2"`,拿不准就看 `type`。
- `乘 3: 222` 字符串重复三遍。不报错,悄悄给你一个错的结果,这比报错更麻烦。
- `转成 int 再乘 3: 6` 这才对。

</div>

我写文章时是这样喂输入的(Day 5 的管道),输出里看不到「敲」的那个 2,并且第一行和第二行连在了一起:

```text
$ printf '2\n' | uv run python part01/ask_raw.py
被扣了几次:你输入的是: 2 <class 'str'>
乘 3: 222
转成 int 再乘 3: 6
```

<div class="line-notes">

- `$ printf '2\n' | uv run python part01/ask_raw.py` `printf` 和 `echo` 类似,`'2\n'` 是字符 2 加一个换行,换行就相当于按了回车。管道把它送进脚本的标准输入,`input` 从标准输入读一行。
- `被扣了几次:你输入的是: 2 <class 'str'>` 因为输入不是从键盘敲的,终端没有回显 `2` 和那个回车,所以提示文字后面直接接上了下一行的输出。

</div>

管道喂输入这个办法以后很有用:脚本要读好几次输入时,每次测试都手敲很烦,用 `printf '299\n2\n' |` 一次喂进去就行。下面的例子我都是这么跑的,贴出来的是你在终端里手敲时会看到的样子。

### 拼起来:从键盘读金额,算退款

把今天的东西拼起来:读单价(元,可能带小数)和扣款次数,转成整数分,算出该退多少,顺便打印一个布尔值说明是不是真的需要退款。新建 `part01/ask_amount.py`:

```python
# agent-zero-lab/part01/ask_amount.py
price_text = input("单价(元,可带小数):")
times_text = input("被扣了几次:")

price_fen = round(float(price_text) * 100)
times = int(times_text)

refund_fen = price_fen * (times - 1)
print("单价:", price_fen, "分")
print("需要退款:", times > 1)
print("应退:", refund_fen // 100, "元", refund_fen % 100, "分")
```

<div class="line-notes">

- `price_text = input("单价(元,可带小数):")` 变量名带 `_text` 后缀,提醒自己这还是字符串,和 Day 12 的 `_fen` 后缀一个思路。
- `times_text = input("被扣了几次:")` 第二次输入。
- `price_fen = round(float(price_text) * 100)` 从里往外读:`float("19.99")` 得 19.99,乘 100 得 1998.9999999999998,`round` 得 1999。不能用 `int(...)`,那会得到 1998;也不能直接 `int(price_text)`,带小数点的字符串 `int()` 不认。
- `times = int(times_text)` 次数是整数,直接 `int()`。
- `refund_fen = price_fen * (times - 1)` 应付一次,多扣的次数是 `times - 1`。括号让减法先算。
- `print("需要退款:", times > 1)` 一个比较表达式直接打印,得到 True 或 False。等学了 if,这里就能写成「需要退款就打印金额,不需要就打印『无需退款』」。
- `print("应退:", refund_fen // 100, "元", refund_fen % 100, "分")` Day 12 的老办法,拆成元和分。

</div>

T001 的数据,299 元扣了 2 次:

```text
$ uv run python part01/ask_amount.py
单价(元,可带小数):299
被扣了几次:2
单价: 29900 分
需要退款: True
应退: 299 元 0 分
```

<div class="line-notes">

- `单价(元,可带小数):299` 不带小数点也行,`float("299")` 得 299.0,乘 100 再 `round` 得 29900。
- `单价: 29900 分` 转成分了。
- `需要退款: True` 2 > 1。
- `应退: 299 元 0 分` 和 Day 13 的速算卡一致。

</div>

基础版 19.99 元扣了 3 次,和只扣了 1 次(没问题)的情况:

```text
$ uv run python part01/ask_amount.py
单价(元,可带小数):19.99
被扣了几次:3
单价: 1999 分
需要退款: True
应退: 39 元 98 分
$ uv run python part01/ask_amount.py
单价(元,可带小数):19.99
被扣了几次:1
单价: 1999 分
需要退款: False
应退: 0 元 0 分
```

<div class="line-notes">

- `单价: 1999 分` 用了 `round`,1999 分,没丢那一分。
- `应退: 39 元 98 分` 多扣了两次:1999 × 2 = 3998 分。
- `需要退款: False` 只扣一次,1 > 1 不成立。
- `应退: 0 元 0 分` 1999 × 0 = 0。

</div>

最后故意输一个真实用户很可能会输的东西:

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

<div class="line-notes">

- `单价(元,可带小数):299元` 带了个「元」。
- `被扣了几次:2` 注意顺序:两个 `input` 都执行完了,到第 5 行转换时才出事。
- `line 5, in <module>` 第 5 行,`float(price_text)`。
- `ValueError: could not convert string to float: '299元'` 程序直接崩了。用户输入永远不可信,这个脚本现在还很脆。要么提示用户「只输数字」,要么用 Day 16 的字符串方法先把「元」去掉,要么用 Day 17 的 if 和 Day 35 的异常处理接住错误。这三样学完,你会回来把这个脚本改结实。

</div>

写完照例检查一遍:

```text
$ uv run ruff check part01/compare.py part01/none_demo.py part01/convert.py part01/to_bool.py part01/ask_raw.py part01/ask_amount.py
All checks passed!
```

<div class="line-notes">

- `All checks passed!` 六个正常的文件都通过。`none_error.py` 是故意写错的,Ruff 不管它(那是类型问题,归 basedpyright 管),Zed 里能看到它的红线。basedpyright(standard 档)对这六个文件是 `0 errors, 0 warnings, 0 notes`。

</div>

| 今天的零件 | 在 `ask_amount.py` 里是哪一步 |
| --- | --- |
| `input()` 返回字符串 | `price_text`、`times_text` |
| `float()` 字符串转小数 | `float(price_text)` |
| `round()` 元转分,不用 `int()` | `round(float(price_text) * 100)` |
| `int()` 字符串转整数 | `int(times_text)` |
| 比较得到布尔值 | `times > 1` |
| ValueError:类型对、值不对 | 输入 `299元` 时崩溃 |
| 变量名带 `_text`、`_fen` 标单位和状态 | 一眼看出哪个还是字符串、哪个是分 |

## 动手练习

### 练习 1:先猜,再跑

在 `uv run python` 里,每行先写下你猜的结果,再敲进去:`3 > 2 > 1`、`1 == 1.0`、`"1" == 1`、`bool("0")`、`int("  42 ")`、`None == False`、`int(9.99)`、`True + 1`。

<details><summary>参考答案</summary>

```text
$ uv run python
>>> 3 > 2 > 1
True
>>> 1 == 1.0
True
>>> "1" == 1
False
>>> bool("0")
True
>>> int("  42 ")
42
>>> None == False
False
>>> int(9.99)
9
>>> True + 1
2
>>> exit()
```

<div class="line-notes">

- `>>> 3 > 2 > 1` 连写:3 > 2 并且 2 > 1。JS 里同样这行是 false。
- `>>> 1 == 1.0` 数值相等。
- `>>> "1" == 1` 字符串和数字永远不相等,不转类型。
- `>>> bool("0")` 非空字符串都是真,不看内容。
- `>>> int("  42 ")` 前后空格 `int()` 自己会去掉。
- `>>> None == False` None 只等于 None。它在 `bool()` 里算假,但它不「等于」False。
- `>>> int(9.99)` 砍掉小数,不是 10。
- `>>> True + 1` True 当 1 用。

</div>

八个全对,今天的比较和转换就过关了。错得最多的通常是 `bool("0")` 和 `None == False`,前者是「`bool` 不读内容」,后者是「算假」和「等于假」是两回事。

</details>

### 练习 2:int 和 round 差在哪

新建 `part01/ex14_yuan_to_fen.py`,读一个元为单位的金额,分别用 `int(元 * 100)` 和 `round(元 * 100)` 转成分打印出来。用 `19.99`、`0.29`、`1.15`、`299` 四个输入各跑一次,看哪几个结果不同。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex14_yuan_to_fen.py
text = input("金额(元):")
yuan = float(text)
print("int  :", int(yuan * 100), "分")
print("round:", round(yuan * 100), "分")
```

<div class="line-notes">

- `text = input("金额(元):")` 读进来是字符串。
- `yuan = float(text)` 先转成 float。
- `print("int  :", int(yuan * 100), "分")` `"int  :"` 里多加了两个空格,是为了和下一行的 `round:` 对齐,好比较。
- `print("round:", round(yuan * 100), "分")` 四舍五入。

</div>

```text
$ uv run python part01/ex14_yuan_to_fen.py
金额(元):19.99
int  : 1998 分
round: 1999 分
$ uv run python part01/ex14_yuan_to_fen.py
金额(元):0.29
int  : 28 分
round: 29 分
$ uv run python part01/ex14_yuan_to_fen.py
金额(元):1.15
int  : 114 分
round: 115 分
$ uv run python part01/ex14_yuan_to_fen.py
金额(元):299
int  : 29900 分
round: 29900 分
```

<div class="line-notes">

- `int  : 1998 分` 19.99 × 100 是 1998.9999999999998,砍掉小数少一分。
- `int  : 28 分` 0.29 × 100 是 28.999999999999996,也少一分。
- `int  : 114 分` 1.15 × 100 是 114.99999999999999,还是少一分。
- `int  : 29900 分` 整数元乘 100 没有误差,两种写法一样。所以这个 bug 用整元测试永远测不出来,一碰到带分的价格才冒出来。

</div>

四个里三个出错,这不是偶然,是带小数的金额乘 100 经常落在「差一点点」的位置。记住:元转分,`round`。

</details>

### 练习 3:模型花费计算器

把 Day 13 速算卡里的模型费那段改成从键盘读:新建 `part01/ex14_tokens.py`,读输入 token 数和输出 token 数(单价还是假设的每百万 2 元和 8 元),打印花费(四舍五入到分),再打印一个布尔值「超过 1 元了吗」。用 `1234567` 和 `345678`、`1_234_567` 和 `345678`、` 50000 `(前后带空格)和 `12000`、`1,234,567` 和 `345678` 四组输入试试。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex14_tokens.py
INPUT_FEN_PER_M = 200
OUTPUT_FEN_PER_M = 800

input_tokens = int(input("输入 token 数:"))
output_tokens = int(input("输出 token 数:"))

total = input_tokens * INPUT_FEN_PER_M + output_tokens * OUTPUT_FEN_PER_M
cost_fen = (total + 500_000) // 1_000_000
print("花费:", cost_fen // 100, "元", cost_fen % 100, "分")
print("超过 1 元了吗:", cost_fen > 100)
```

<div class="line-notes">

- `input_tokens = int(input("输入 token 数:"))` 函数套函数,从里往外读:`input(...)` 先返回字符串,`int(...)` 再把它转成整数。和 JS 的 `Number(prompt("..."))` 一个写法。
- `total = input_tokens * INPUT_FEN_PER_M + output_tokens * OUTPUT_FEN_PER_M` 「分 × 百万」的总数,两项先加起来(Day 13 说的舍入只做一次)。
- `cost_fen = (total + 500_000) // 1_000_000` 先加一半再整除,四舍五入到分。
- `print("超过 1 元了吗:", cost_fen > 100)` 1 元是 100 分。注意比较的两边单位要一致,拿分和分比。

</div>

```text
$ uv run python part01/ex14_tokens.py
输入 token 数:1234567
输出 token 数:345678
花费: 5 元 23 分
超过 1 元了吗: True
$ uv run python part01/ex14_tokens.py
输入 token 数:1_234_567
输出 token 数:345678
花费: 5 元 23 分
超过 1 元了吗: True
$ uv run python part01/ex14_tokens.py
输入 token 数: 50000 
输出 token 数:12000
花费: 0 元 20 分
超过 1 元了吗: False
$ uv run python part01/ex14_tokens.py
输入 token 数:1,234,567
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex14_tokens.py", line 5, in <module>
    input_tokens = int(input("输入 token 数:"))
                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
ValueError: invalid literal for int() with base 10: '1,234,567'
```

<div class="line-notes">

- `花费: 5 元 23 分` 和 Day 13 的速算卡一样。
- `输入 token 数:1_234_567` 下划线写法 `int()` 也认,结果相同。
- `花费: 0 元 20 分` 50000 × 200 + 12000 × 800 = 19600000,加 500000 再整除一百万得 20 分。前后的空格没影响。
- `超过 1 元了吗: False` 20 分没超过 100 分。
- `ValueError: invalid literal for int() with base 10: '1,234,567'` 千分位逗号 `int()` 不认。可很多后台页面、账单邮件里的 token 数就是带逗号显示的,用户直接复制过来就是这个样子。去掉逗号要用 Day 16 的 `replace`。这次第一个 `input` 就失败了,所以第二个提示没有出现。

</div>

</details>

### 练习 4:is None 和 == None

新建 `part01/ex14_none_check.py`,写三行:`coupon_fen is None`、`coupon_fen == None`、`bool(coupon_fen)`,`coupon_fen` 是 None。跑一下,再用 `uv run ruff check --select E711` 检查这个文件,看 Ruff 怎么说。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex14_none_check.py
coupon_fen = None
print(coupon_fen is None)
print(coupon_fen == None)
print(bool(coupon_fen))
```

<div class="line-notes">

- `print(coupon_fen is None)` 标准写法。
- `print(coupon_fen == None)` 不推荐的写法。
- `print(bool(coupon_fen))` None 转布尔。

</div>

```text
$ uv run python part01/ex14_none_check.py
True
True
False
$ uv run ruff check part01/ex14_none_check.py
All checks passed!
$ uv run ruff check --select E711 part01/ex14_none_check.py
E711 Comparison to `None` should be `cond is None`
 --> part01/ex14_none_check.py:4:21
  |
2 | coupon_fen = None
3 | print(coupon_fen is None)
4 | print(coupon_fen == None)
  |                     ^^^^
5 | print(bool(coupon_fen))
```

<div class="line-notes">

- `True` 前两行结果一样。今天这个例子里 `==` 没出事,问题出在别人写的类可以改变 `==` 的行为,`is` 不会被改。
- `False` None 在 `bool()` 里是假。
- `All checks passed!` 默认规则不查这一条。
- `$ uv run ruff check --select E711 part01/ex14_none_check.py` `--select E711` 是「只检查 E711 这一条规则」。规则编号 Day 9 讲过,E 开头的来自 Python 社区老牌的 pycodestyle 检查器。
- `E711 Comparison to `None` should be `cond is None`` 「和 None 比较应该写成 `is None`」,指着第 4 行。以后想在项目里一直开着这条,写进 `pyproject.toml` 的 Ruff 配置里,第一部分讲类型标注时会配。

</div>

</details>

验收标准:`compare.py`、`none_demo.py`、`convert.py`、`to_bool.py`、`ask_raw.py`、`ask_amount.py` 都能跑,输出和文中一致;能不看文章说出 `1 == "1"` 在 Python 和 JS 里的结果、为什么判断 None 用 `is`、`int(19.99 * 100)` 为什么是 1998;`ask_amount.py` 能默写出来,输入 `19.99` 和 `3` 时应退 39 元 98 分;看到 ValueError 和 TypeError 能说出区别。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 布尔值(bool) | 只有 `True` 和 `False` 两个值的类型,首字母大写;JS 里是 `true`/`false` |
| 比较运算符 | `==`、`!=`、`<`、`>`、`<=`、`>=`,结果是布尔值。Python 没有 `===` |
| 连写比较 | `0 < x <= 500` 表示两个比较同时成立,和数学写法一样;JS 里这么写会算错 |
| None | Python 唯一的「空值」,类型是 `NoneType`;对应 JS 的 `null` 和 `undefined` |
| `is` / `is not` | 判断「是不是同一个对象」。和 None 比较时用 `x is None`、`x is not None` |
| E711 | Ruff(来自 pycodestyle)的规则编号:和 None 比较应该用 `is` |
| 类型转换 | 把一种类型的值变成另一种,如 `int("299")`、`str(299)`、`float("19.99")` |
| `int()` | 转成整数。字符串必须是整数写法(可带前后空格、下划线、全角数字);float 转 int 直接砍掉小数 |
| `float()` | 转成浮点数,认小数点和科学计数法如 `1e3` |
| `str()` | 把任何值转成字符串 |
| `bool()` | 把任何值转成真假。0、空字符串、None、空列表是假,其余为真 |
| 真值(truthiness) | 一个值放在需要真假的地方时算真还是算假;Day 17 的 if 会用到 |
| `ValueError` | 类型对、值不对,如 `int("299元")` |
| `TypeError` | 类型就不对,如 `46800 - None`、`int(None)` |
| `input()` | 打印提示、读一行键盘输入,返回字符串(不含回车),相当于终端版的 `prompt()` |
| `printf` | 和 `echo` 类似的输出命令,`printf '2\n'` 输出 2 和一个换行,常用来给脚本喂输入 |

## 常见误区

**写成小写的 `true`、`false`、`null`。** 在 Python 里都是 `NameError`,它们被当成了没定义的变量名。写 `True`、`False`、`None`。

**以为 `==` 会像 JS 那样转类型。** `1 == "1"` 是 `False`。从 `input()`、文件、网页表单拿到的数字都是字符串,拿去和数字比,永远不相等,也不报错。先转换再比。

**`input()` 读进来直接算。** `"2" * 3` 得到 `"222"`,不报错,结果是错的。读进来先 `int()` 或 `float()`。

**元转分用 `int()`。** `int(19.99 * 100)` 是 1998,少一分。用 `round()`。

**以为 `int()` 会四舍五入。** `int(9.99)` 是 9。`int()` 只砍掉小数部分;要四舍五入用 `round()`,而且记得 Day 12 的「五取偶」。

**`int("19.99")` 想一步转成整数。** 报 ValueError。`int()` 只认整数写法,带小数点的先 `float()`。

**`bool("False")` 以为是假。** 非空字符串都是真,`bool()` 不读字符串的意思。读配置、读命令行参数时尤其要注意。

**把空列表当真。** JS 里 `[]` 是真,Python 里空列表是假。写惯 JS 的人在这里会把判断写反。

**用 `== None` 判断空值。** 能跑,但不规范,PEP 8 要求 `is None`。

**把 None 当 0 用。** None 不等于 0,`46800 - None` 直接 TypeError。「没有优惠」和「优惠 0 元」在业务上是两件事,该用哪个想清楚;真要当 0 算,得自己先把 None 换成 0(学了 if 就会写)。

**看到 `'NoneType'` 的报错去查 None 那一行。** 报错的行是「拿 None 去用」的地方,问题往往出在更早的「这个变量为什么还是 None」。顺着变量往上找它是在哪赋值的。

## 学习资料

### 文档与文章

- [Python 标准库 · 内置类型](https://docs.python.org/zh-cn/3.12/library/stdtypes.html):中文,读开头的「逻辑值检测」「布尔运算」「比较运算」三小节,今天讲的真值规则、连写比较、`is` 都在里面,官方说法很短。
- [Python 标准库 · 内置函数](https://docs.python.org/zh-cn/3.12/library/functions.html):中文,在页面里分别搜 `int`、`float`、`str`、`bool`、`input`,每个都有几个例子。`int` 那条写了它接受哪些字符串(空格、下划线都在里面)。
- [Python 标准库 · 内置常量](https://docs.python.org/zh-cn/3.12/library/constants.html):中文,`None`、`True`、`False` 的正式定义,一屏读完。
- [PEP 8 · Programming Recommendations](https://peps.python.org/pep-0008/):英文,搜「Comparisons to singletons like None」,就是「和 None 比较用 is」那条规矩的原文。
- [PEP 285 · Adding a bool type](https://peps.python.org/pep-0285/):英文,2002 年给 Python 加 bool 类型的提案,解释了为什么 bool 是 int 的子类、`True + True` 为什么是 2。看开头的「Rationale」就够。
- [MDN · 相等性比较和相同性](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Guide/Equality_comparisons_and_sameness):中文,JS 的 `==` 和 `===` 到底怎么转类型。对照着看,就明白 Python 的 `==` 为什么简单。
- [MDN · null](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Operators/null):中文,JS 里 `null` 和 `undefined` 的区别,和今天那张图对照。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Pk4UzAECx&autoplay=0&high_quality=1" title="Python初学者必备：5大基础数据类型（int, float, str, bool, None）全解析" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小柯聊AI · Python初学者必备:5大基础数据类型(int, float, str, bool, None)全解析 · 5 分钟,2025 年 10 月。把 Day 12、今天和明天的五种基础类型放在一起过一遍,短,适合学完后串起来复习。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ci4y1G7Ph&autoplay=0&high_quality=1" title="第12课：Python数据类型的互相转换" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>编程杨老师 · 第12课:Python数据类型的互相转换 · 10 分钟,2020 年 8 月,播放 1.5 万。专讲 int、float、str 互转和转换失败的情况,讲得慢、例子多。视频里用的编辑器和运行方式和我们不同,看转换规则就行。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV16c41197CZ&autoplay=0&high_quality=1" title="python数据类型-理解None对象" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT阿杰 · python数据类型-理解None对象 · 4 分钟,2023 年 11 月。专讲 None 是什么、什么时候会遇到它,补今天 None 那一节。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Dl2lsErTFXg" title="&quot;None&quot; in Python" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Python Morsels · "None" in Python · 英文,可开自动字幕。Trey Hunner 做的短视频,讲 None 表示什么、为什么用 is 判断、函数默认返回 None。他的视频都是几分钟一个知识点,讲得很准。</figcaption>
</figure>

### 书籍

- Eric Matthes《Python Crash Course》第 3 版,No Starch Press,2023(中译《Python编程:从入门到实践》)。布尔表达式在第 5 章「if 语句」开头,`input()` 和 `int()` 在第 7 章「用户输入和 while 循环」开头。今天只看这两小段,剩下的等学到 if 和 while 再看。
- Allen B. Downey《Think Python》第 3 版,O'Reilly,2024,[免费在线版](https://allendowney.github.io/ThinkPython/)。第 1 章 1.5 节「Values and types」讲用 `int()`、`float()` 转换,第 5 章开头讲布尔表达式和比较运算符。

### 开源项目与代码

- [satwikkansal/wtfpython](https://github.com/satwikkansal/wtfpython):Day 12 推荐过。今天在里面搜 `True` 和 `is`,能找到 `True + True`、`is` 和 `==` 的几个反直觉例子,看懂了说明今天的东西真懂了;看不懂的(涉及列表、类的)先跳过。

## 自测

1. 下面四个表达式在 Python 里分别得到什么:`5 == 5.0`、`"5" == 5`、`0 < 7 <= 5`、`None == 0`?

<details><summary>答案</summary>

`True`(数值相等)、`False`(字符串和数字不相等,不转类型)、`False`(连写表示两个都要成立,7 ≤ 5 不成立)、`False`(None 只等于 None)。

</details>

2. 一个函数本该返回金额,你用 `total = get_total()` 拿到结果,下一行 `total + 100` 报 `TypeError: unsupported operand type(s) for +: 'NoneType' and 'int'`。最可能是什么原因?

<details><summary>答案</summary>

`get_total()` 返回了 None。最常见的情况是函数里忘了写 `return`,Python 默认返回 None(和 `print(...)` 返回 None 一样)。或者函数在某些情况下返回 None 表示「没有」。查 `get_total` 的代码,而不是查 `total + 100` 这一行。

</details>

3. 为什么 `int("299元")` 报的是 ValueError,而 `int(None)` 报的是 TypeError?

<details><summary>答案</summary>

`int()` 接受字符串,`"299元"` 是字符串,类型没问题,但内容不是合法的整数写法,所以是「值不对」,ValueError。None 的类型 `NoneType` 根本不在 `int()` 接受的类型里,所以是「类型不对」,TypeError。

</details>

4. 用户在输入框里填了 `19.99`,你要把它存成分。下面三种写法哪个对?`int(text) * 100`、`int(float(text) * 100)`、`round(float(text) * 100)`。

<details><summary>答案</summary>

只有第三个对。第一个:`int("19.99")` 直接报 ValueError,`int()` 不认小数点。第二个:`float("19.99") * 100` 是 1998.9999999999998,`int()` 砍掉小数得 1998,少一分。第三个:`round` 得到 1999。

</details>

5. 面试题:Agent 从大模型的 JSON 输出里取一个字段 `refund_amount`,有时候模型没给这个字段,有时候给的是字符串 `"299"`,有时候给的是 `"299元"`。你的代码应该怎么处理这几种情况?

<details><summary>答案</summary>

模型输出不可信,要当成用户输入对待。三种情况分开处理:字段缺失时拿到的是 None,要用 `is None` 判断,不能直接拿去算,否则就是 `NoneType` 的 TypeError;是字符串时要显式转换,`int()`/`float()`,不能指望 `==` 或运算自动转;转换可能抛 ValueError(如 `"299元"`),要接住错误,决定是清洗(去掉「元」)、让模型重新输出,还是转人工。金额转换成整数分时用 `round` 而不是 `int`。更好的做法是让模型按固定格式输出,再用校验库检查类型和取值范围,这门课在结构化输出和 pydantic 那几天会讲。

</details>

## 明天预告

Day 15 · 字符串(一):索引、切片和 f-string。今天的 `ask_amount.py` 一遇到 `299元` 就崩,打印金额也只能写成 `299 元 0 分` 这种拼凑的样子。明天学字符串:用索引和切片从 `"T001 计费 C023 ..."` 这样的工单行里截出工单号和客户号,用 f-string(相当于 JS 的模板字符串)把金额排成 `299.00 元`。字符串是 Agent 工程师每天打交道最多的类型,提示词、模型回复、工具结果全是字符串,接下来两天把它学扎实。
