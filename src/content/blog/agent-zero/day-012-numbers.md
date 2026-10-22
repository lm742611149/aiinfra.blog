---
title: 'Day 12 · 变量和数字:int、float 和运算'
description: '正式学 Python 语法的第一天:变量就是给值贴名字,Python 的数字分成 int 和 float 两种,/ 和 // 不是一回事,负数整除和 JS 结果不同。最后拿 0.1 + 0.2 讲清楚浮点误差,把一张五个席位的年付报价单用「分」算对。'
pubDate: 2026-10-22
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 12
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 11](/blog/agent-zero/day-011-uv-2/) 把 `.venv` 打开看了:它是一个指向某个 Python 的链接,加一个放库的 `site-packages`,加一张说明书 `pyvenv.cfg`。`pyproject.toml` 写「要什么」,`uv.lock` 记「装了什么」,`.venv` 删了用 `uv sync` 一秒恢复。这门课一律不激活环境,用 `uv run`。

到这里工具全齐了:编辑器会画红线([Day 9](/blog/agent-zero/day-009-editor-setup/)),uv 管项目和依赖,`~/agent-zero-lab/part01/` 空着等代码。前几天其实已经偷偷用过 Python 的东西:Day 9 写过 `amount = "299"`,Day 8 的练习里 `299 * 0.13` 算出了 `38.870000000000005`,Day 9 的练习里 `299 / 1` 的类型是 `float` 而不是整数。当时都说「Day 12 讲」,就是今天。

## 今天要解决的问题

学完今天,你应该能:

1. 用变量存值、改值,说出 Python 变量和 JS 的 `let`/`const` 哪里不一样;看到 `NameError` 和 `count++` 报的 `SyntaxError` 知道怎么回事。
2. 分清 `int` 和 `float`,用 `type()` 查一个值是哪种;会用 `+ - * / // % **` 七个运算符,特别是能说出 `/` 和 `//` 的区别、`-7 // 2` 为什么是 `-4`。
3. 解释 `0.1 + 0.2` 为什么不等于 `0.3`,知道 `round(2.5)` 为什么是 `2`。
4. 用「整数分」写一个报价脚本 `part01/price_calc.py`:五个席位的年付价、省了多少、税和含税合计,一分不差。

预计用时:2.5 小时。变量 40 分钟,两种数字和运算符 50 分钟,浮点误差和报价脚本 40 分钟,剩下做练习。

前置:[Day 8](/blog/agent-zero/day-008-python-vs-node/)(交互模式、`print` 多个参数、两类报错)、[Day 9](/blog/agent-zero/day-009-editor-setup/)(红线、`reveal_type`、`TypeError`)、[Day 10](/blog/agent-zero/day-010-uv-1/) 和 [Day 11](/blog/agent-zero/day-011-uv-2/)(`~/agent-zero-lab`、`uv run`)。今天不调任何 API,花费 0 元。

学法提示:先对照文章逐行敲一遍(代码自己敲,不复制粘贴)并跑通;第二天合上文章,把 `price_calc.py` 默写出来再跑,对一下输出;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚我是在哪跑的

输出是我 2026-10-22 在 2019 款 Intel MacBook Pro(macOS 14、zsh)上真跑的,仓库是按 Day 10 那份清单重建的 `agent-zero-lab`(`uv init --no-package`、`uv add rich`、`uv add --dev ruff`),路径显示成 `/Users/你/agent-zero-lab`。

有一处和 Day 11 不同:我这次 `uv run python --version` 是 3.12.13,Day 11 里是 3.12.15,你那边以自己机器为准。今天讲的整数、小数运算在 3.12 的各个小版本里结果完全一样,不用在意这个差别。

今天所有脚本都放在 `~/agent-zero-lab/part01/`,在仓库根目录用 `uv run python part01/文件名.py` 运行。交互模式用 `uv run python` 打开(不加文件名),这样进去的是项目自己的 Python。

## 变量:给一个值贴个名字

### 第一个变量脚本

在 Zed 里打开 `~/agent-zero-lab`,在 `part01` 里新建 `variables.py`。场景是 Day 5 那张 T001:客户 C023 的 299 元被扣了两次。

```python
# agent-zero-lab/part01/variables.py
amount = 299
times = 2
charged = amount * times
print("扣了几次:", times)
print("一共扣了:", charged, "元")
print("多扣了:", charged - amount, "元")

times = 1
print("退款以后扣了几次:", times)
print("charged 还是:", charged)
```

<div class="line-notes">

- `amount = 299` 把 `299` 这个值存起来,起名叫 `amount`。`=` 读作「赋值」:右边算出一个值,左边的名字从此指向它。相当于 JS 的 `let amount = 299`,但 Python **没有** `let`、`const`、`var`,直接写名字就行。
- `times = 2` 第二个变量。
- `charged = amount * times` 右边先算:`amount` 是 299,`times` 是 2,`299 * 2` 得 598。然后 `charged` 指向 598。
- `print("扣了几次:", times)` Day 8 学过,`print` 多个参数中间用空格隔开。变量名不加引号,打印的是它的值 `2`;加了引号 `"times"` 就是打印这五个字母。
- `print("一共扣了:", charged, "元")` 打印 598。
- `print("多扣了:", charged - amount, "元")` 参数也可以是一个算式,先算出 `598 - 299 = 299` 再打印。
- `times = 1` 给已经有的变量重新赋值。JS 里如果当初写的是 `const times = 2`,这一行会报 `TypeError: Assignment to constant variable`;Python 没有 `const`,任何变量都能改。
- `print("退款以后扣了几次:", times)` 现在是 1。
- `print("charged 还是:", charged)` 关键在这一行:`times` 改了,`charged` 会不会跟着变成 299?不会。`charged` 在第 4 行就已经算好、指向 598 了,它记的是**当时算出来的值**,不是「amount 乘 times」这个公式。和 JS 一样,也和 Excel 单元格不一样。

</div>

```text
$ cd ~/agent-zero-lab
$ uv run python part01/variables.py
扣了几次: 2
一共扣了: 598 元
多扣了: 299 元
退款以后扣了几次: 1
charged 还是: 598
```

<div class="line-notes">

- `$ cd ~/agent-zero-lab` 先回到仓库根目录,后面所有命令都在这跑。
- `一共扣了: 598 元` 299 × 2。
- `charged 还是: 598` 改了 `times` 以后 `charged` 没动。

</div>

我对变量的理解是「贴在值上的名字标签」,不是「装东西的盒子」。`times = 1` 不是把盒子里的 2 换成 1,而是把 `times` 这张标签从 2 上撕下来,贴到 1 上。`charged` 那张标签一直贴在 598 上,没人动它。这个说法在今天看不出区别,到 [Day 21](/blog/agent-zero/day-021-lists/) 学列表的时候会很要紧:两个名字贴在同一个列表上,改一个另一个也变。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="变量是贴在值上的标签:times 先贴在 2 上,重新赋值后改贴到 1 上;charged 一直贴在 598 上">
<rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink-faint)">第 4 行之后</text>
<rect x="20" y="44" width="90" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="34" y="64" fill="var(--ink)">amount</text>
<rect x="20" y="88" width="90" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="34" y="108" fill="var(--ink)">times</text>
<rect x="20" y="132" width="90" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="34" y="152" fill="var(--ink)">charged</text>
<line x1="110" y1="59" x2="180" y2="59" stroke="var(--ink-soft)"/>
<line x1="110" y1="103" x2="180" y2="103" stroke="var(--ink-soft)"/>
<line x1="110" y1="147" x2="180" y2="147" stroke="var(--ink-soft)"/>
<rect x="180" y="44" width="70" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="200" y="64" fill="var(--ink)">299</text>
<rect x="180" y="88" width="70" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="208" y="108" fill="var(--ink)">2</text>
<rect x="180" y="132" width="70" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="200" y="152" fill="var(--ink)">598</text>
<text x="340" y="28" fill="var(--ink-faint)">times = 1 之后</text>
<rect x="340" y="88" width="90" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="354" y="108" fill="var(--ink)">times</text>
<rect x="340" y="132" width="90" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="354" y="152" fill="var(--ink)">charged</text>
<rect x="500" y="44" width="70" height="30" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
<text x="528" y="64" fill="var(--ink-faint)">2</text>
<line x1="430" y1="103" x2="500" y2="103" stroke="var(--ink-soft)"/>
<rect x="500" y="88" width="70" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="528" y="108" fill="var(--ink)">1</text>
<line x1="430" y1="147" x2="500" y2="147" stroke="var(--ink-soft)"/>
<rect x="500" y="132" width="70" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="520" y="152" fill="var(--ink)">598</text>
<text x="20" y="196" fill="var(--ink-soft)">重新赋值 = 把标签改贴到新的值上;charged 记的是算好的 598,不是公式</text>
</g>
</svg>
<figcaption>变量是标签,值是标签贴着的东西。改 times 不会让 charged 重算。</figcaption>
</figure>

### 和 JS 对照

| 想做的事 | JS | Python |
| --- | --- | --- |
| 声明并赋值 | `let amount = 299` | `amount = 299` |
| 不许改的「常量」 | `const TAX = 13` | `TAX_PERCENT = 13`(全大写只是约定,改了也不报错) |
| 重新赋值 | `amount = 300` | `amount = 300` |
| 加一 | `count++` 或 `count += 1` | 只有 `count += 1` |
| 命名风格 | 驼峰 `refundAmount` | 小写加下划线 `refund_amount` |
| 没声明就用 | `ReferenceError: x is not defined` | `NameError: name 'x' is not defined` |

命名风格那一行是 Python 社区的规矩,写在 PEP 8(Python 官方的代码风格指南)里:变量和函数用小写加下划线,常量用全大写加下划线。Day 10 的 `add_column` 就是这个风格。Ruff 默认不管你变量怎么起名,但读别人的 Python 代码,全是这个写法,入乡随俗。

### 一个值能换类型,一个名字能有哪些字

在交互模式里试几行。在仓库根目录敲 `uv run python`,看到 `>>>` 后逐行敲:

```text
$ uv run python
>>> amount = 299
>>> amount
299
>>> type(amount)
<class 'int'>
>>> amount = "299"
>>> type(amount)
<class 'str'>
>>> 2nd_charge = 299
  File "<stdin>", line 1
    2nd_charge = 299
    ^
SyntaxError: invalid decimal literal
>>> second-charge = 299
  File "<stdin>", line 1
    second-charge = 299
    ^^^^^^^^^^^^^
SyntaxError: cannot assign to expression here. Maybe you meant '==' instead of '='?
>>> 金额 = 299
>>> 金额
299
>>> TAX_PERCENT = 13
>>> TAX_PERCENT = 6
>>> TAX_PERCENT
6
>>> exit()
```

<div class="line-notes">

- `>>> amount = 299` 赋值语句本身不显示任何东西。
- `>>> amount` 交互模式里只敲一个名字,会显示它的值(Day 8 说过,交互模式会自动显示表达式的值)。
- `>>> type(amount)` `type(...)` 是内置函数,告诉你一个值是什么类型。
- `<class 'int'>` `int` 是整数类型。`<class '...'>` 这个外壳先不管,看引号里的名字就行。
- `>>> amount = "299"` 同一个名字,改成指向一个字符串。
- `<class 'str'>` 类型跟着值走,名字本身没有类型。JS 也是这样(`let a = 1; a = "1"` 不报错);TS 会拦你,Python 运行时不拦,但 Day 9 的 basedpyright 有时会提醒。
- `>>> 2nd_charge = 299` 名字不能以数字开头。
- `SyntaxError: invalid decimal literal` 「不是合法的十进制数字」:Python 看到 `2` 开头,以为你在写一个数,写到 `n` 就对不上了。
- `>>> second-charge = 299` 名字里不能有 `-`,和 JS 一样。Day 11 讲 `markdown_it` 时提过,import 名里也不能有 `-`。
- `SyntaxError: cannot assign to expression here. Maybe you meant '==' instead of '='?` Python 把它读成了 `second 减 charge`,一个减法算式不能放在 `=` 左边。后面那句猜测(你是不是想写 `==`)这里猜错了,报错的提示不总是对的,但第一句话是对的。
- `>>> 金额 = 299` 中文名字是合法的。能用,但我不推荐:输入法来回切很容易敲出中文标点,Day 8 的 `invalid character '“'` 就是这么来的。课里的变量名全用英文。
- `>>> TAX_PERCENT = 6` 全大写的「常量」照样能改,Python 不拦。全大写只是写给人看的:「这个值别动」。
- `6` 被改了。
- `>>> exit()` 退出交互模式,回到 `$`。

</div>

### 先撞两个错

变量最常见的两个错,都在 Ruff 和 basedpyright 的眼皮底下,但值得亲手撞一次。第一个,拼错名字。新建 `part01/var_errors.py`:

```python
# agent-zero-lab/part01/var_errors.py
refund_amount = 299
print("要退:", refund_ammount, "元")
```

<div class="line-notes">

- `refund_amount = 299` 定义的是 `refund_amount`,一个 m。
- `print("要退:", refund_ammount, "元")` 用的时候多敲了一个 m。保存时 Zed 里这个名字下面已经有红线了,basedpyright 说 `"refund_ammount" is not defined`(Day 9 的 `reportUndefinedVariable`)。

</div>

```text
$ uv run python part01/var_errors.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/var_errors.py", line 3, in <module>
    print("要退:", refund_ammount, "元")
                   ^^^^^^^^^^^^^^
NameError: name 'refund_ammount' is not defined. Did you mean: 'refund_amount'?
```

<div class="line-notes">

- `line 3, in <module>` 第 3 行出的事。`<module>` 的意思是「在文件最外层,不在任何函数里」。
- `^^^^^^^^^^^^^^` 尖号标出了哪个名字有问题。
- `NameError: name 'refund_ammount' is not defined. Did you mean: 'refund_amount'?` 「这个名字没定义过」,还猜了你想写的是哪个。Python 3.10 起才有这个猜测,而且猜得通常很准。看到 `NameError`,第一反应就是查拼写。

</div>

第二个,前端手感写出 `++`。新建 `part01/plus_plus.py`:

```python
# agent-zero-lab/part01/plus_plus.py
count = 0
count++
print(count)
```

<div class="line-notes">

- `count++` JS 里天天写的自增。

</div>

```text
$ uv run python part01/plus_plus.py
  File "/Users/你/agent-zero-lab/part01/plus_plus.py", line 3
    count++
           ^
SyntaxError: invalid syntax
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/plus_plus.py", line 3` 没有 `Traceback` 那一行,说明一行都没执行(Day 8 讲的语法错)。
- `SyntaxError: invalid syntax` Python 根本没有 `++` 和 `--` 运算符。改成 `count += 1`。

</div>

`+=` 这一类写法叫**增量赋值**:`count += 1` 等于 `count = count + 1`。`-=`、`*=`、`/=`、`//=` 都有,和 JS 一样,下面运算符那节会用到。

## 两种数字:int 和 float

JS 里只有一种数字 `number`,`typeof 5` 和 `typeof 0.13` 都是 `"number"`。Python 分成两种:**int**(整数,integer 的缩写)和 **float**(浮点数,就是带小数点的数)。Day 9 的 `reveal_type(5 / 9 * 100)` 显示的 `float` 就是后者。

新建 `part01/int_float.py`:

```python
# agent-zero-lab/part01/int_float.py
seats = 5
monthly = 49
rate = 0.13
print(type(seats), type(rate))
print(seats * monthly, type(seats * monthly))
print(monthly * rate, type(monthly * rate))
print(468 / 12, type(468 / 12))
print(2**64)
print(2**53 + 1)
tokens_per_month = 1_000_000
print(tokens_per_month)
```

<div class="line-notes">

- `seats = 5` 5 个席位。CloudLedger 帮助中心里专业版的价格是每月 49 元,或者年付 468 元(折合每月 39 元),今天的例子都用这两个数。
- `rate = 0.13` 写了小数点,就是 float。Day 8 练习里用的税率 13%,今天接着用。
- `print(type(seats), type(rate))` 一个 int,一个 float。
- `print(seats * monthly, type(seats * monthly))` int 乘 int。
- `print(monthly * rate, type(monthly * rate))` int 乘 float。
- `print(468 / 12, type(468 / 12))` int 除以 int,而且能除尽。
- `print(2**64)` `**` 是乘方,2 的 64 次方。
- `print(2**53 + 1)` 这个数在 JS 里有讲究,下面说。
- `tokens_per_month = 1_000_000` 数字里可以加下划线分组,Python 会忽略它,`1_000_000` 就是一百万。写大数时比数零清楚得多,Day 2 算 token 单价时满屏的「每百万」以后就这么写。JS 也支持(`1_000_000`),只是前端不常见。

</div>

```text
$ uv run python part01/int_float.py
<class 'int'> <class 'float'>
245 <class 'int'>
6.37 <class 'float'>
39.0 <class 'float'>
18446744073709551616
9007199254740993
1000000
```

<div class="line-notes">

- `<class 'int'> <class 'float'>` 没写小数点是 int,写了是 float。
- `245 <class 'int'>` int 和 int 做加减乘,结果还是 int。
- `6.37 <class 'float'>` int 和 float 一起算,结果变成 float。规则很简单:**只要有一个 float 参与,结果就是 float**。
- `39.0 <class 'float'>` 468 ÷ 12 正好是 39,可结果是 `39.0`,不是 `39`。`/` 不管能不能除尽,**结果一律是 float**。这就是 Day 9 练习里 `299 / 1` 是 float 的原因。
- `18446744073709551616` 20 位数,一位不差。Python 的 int **没有大小上限**,多大都能精确表示,只受内存限制。
- `9007199254740993` 精确的 2^53 + 1。
- `1000000` 打印时下划线没了,它只是写代码时的分隔符。

</div>

最后两行要拿 JS 对比一下才有意思:

```text
$ node -e "console.log(2**64, 2**53 + 1, Number.MAX_SAFE_INTEGER)"
18446744073709552000 9007199254740992 9007199254740991
```

<div class="line-notes">

- `$ node -e` 一行打印三个数。
- `18446744073709552000 9007199254740992 9007199254740991` 第一个是 JS 的 2^64,末尾几位变成了 000,不精确了。第二个是 2^53 + 1,算出来少了 1。第三个是 `Number.MAX_SAFE_INTEGER`,JS 能精确表示的最大整数。JS 所有数字都是浮点数,超过这个就开始丢精度,所以前端处理数据库里的大 ID 时常常要用字符串或 `BigInt`。Python 的 int 天生就是「BigInt」,不用操心。

</div>

为什么 Python 要分两种?因为整数和小数在计算机里的存法完全不同。int 是精确的,数多大都精确;float 是近似的,只有大约 15 到 17 位有效数字,下面讲 `0.1 + 0.2` 时会看到「近似」的代价。所以能用 int 的地方就用 int:席位数、次数、token 数、钱(换算成「分」以后),都是整数。

## 七个算术运算符

### 先看一张表

| 运算 | Python | 例子 | 结果 | JS 里 |
| --- | --- | --- | --- | --- |
| 加 | `+` | `468 + 12` | `480` | 一样 |
| 减 | `-` | `588 - 468` | `120` | 一样 |
| 乘 | `*` | `49 * 12` | `588` | 一样 |
| 除 | `/` | `468 / 12` | `39.0` | 结果 `39`,JS 不区分 |
| 整除 | `//` | `500 // 12` | `41` | 没有,要写 `Math.floor(500 / 12)` |
| 取余 | `%` | `500 % 12` | `8` | 正数一样,负数不一样 |
| 乘方 | `**` | `2 ** 10` | `1024` | 一样 |

`//` 叫**整除**(floor division):做除法,然后往下取整,只要整数部分。`%` 叫**取余**(modulo):除完剩下的那一点。两个总是成对出现:`500 // 12` 是 41,`500 % 12` 是 8,验算 41 × 12 + 8 = 500。

注意 `//` 在 JS 里是注释符号。前端手感在 Python 里写 `// 这是注释`,会被当成整除运算,报 `SyntaxError`。Python 的注释是 `#`。

### 用在报价上

新建 `part01/operators.py`。场景是 Day 5 的 T003:客户 C015 想把月付改成年付,问差价怎么算。

```python
# agent-zero-lab/part01/operators.py
yearly = 468
monthly = 49
print("月付一年:", monthly * 12)
print("年付省:", monthly * 12 - yearly)
print("年付折合每月:", yearly / 12)
print("年付折合每月(整除):", yearly // 12)

minutes = 135
print("回复用时:", minutes // 60, "小时", minutes % 60, "分钟")
print("2 的 10 次方:", 2**10)

balance = 100
balance -= 30
balance *= 2
print("余额:", balance)
```

<div class="line-notes">

- `print("月付一年:", monthly * 12)` 49 × 12。
- `print("年付省:", monthly * 12 - yearly)` 乘法先算,再减。运算顺序和数学课、和 JS 一样:先 `**`,再 `* / // %`,最后 `+ -`;拿不准就加括号。
- `print("年付折合每月:", yearly / 12)` `/`,结果是 float。
- `print("年付折合每月(整除):", yearly // 12)` `//`,两个 int 整除,结果是 int。
- `minutes = 135` 某张工单从提交到第一次回复用了 135 分钟。
- `print("回复用时:", minutes // 60, "小时", minutes % 60, "分钟")` `//` 和 `%` 最经典的用法:拆单位。135 分钟里有几个完整的 60(2 个),剩几分钟(15)。
- `print("2 的 10 次方:", 2**10)` Ruff 格式化时会把 `2 ** 10` 写成 `2**10`(简单的乘方两边不加空格),两种写法意思一样。
- `balance = 100` 账户余额 100 元。
- `balance -= 30` 等于 `balance = balance - 30`,变成 70。
- `balance *= 2` 等于 `balance = balance * 2`,变成 140。

</div>

```text
$ uv run python part01/operators.py
月付一年: 588
年付省: 120
年付折合每月: 39.0
年付折合每月(整除): 39
回复用时: 2 小时 15 分钟
2 的 10 次方: 1024
余额: 140
```

<div class="line-notes">

- `年付省: 120` 588 − 468 = 120,T003 的答案:年付一年省 120 元。
- `年付折合每月: 39.0` 帮助中心写的「折合每月 39 元」,Python 用 `/` 算出来带个 `.0`。
- `年付折合每月(整除): 39` 用 `//` 就是干净的 39。能确定除得尽、又想要整数时,用 `//`。
- `回复用时: 2 小时 15 分钟` 2 × 60 + 15 = 135,对得上。
- `余额: 140` (100 − 30) × 2。

</div>

### 负数整除:和 JS 不一样的地方

正数的时候 `//` 和 JS 的 `Math.floor(a / b)` 一样。负数就要小心了。打开交互模式:

```text
$ uv run python
>>> -7 // 2
-4
>>> -7 % 2
1
>>> 7 // 2
3
>>> 7 % 2
1
>>> -2 ** 2
-4
>>> (-2) ** 2
4
>>> 7.0 // 2
3.0
>>> 10 / 0
Traceback (most recent call last):
  File "<stdin>", line 1, in <module>
ZeroDivisionError: division by zero
>>> exit()
```

<div class="line-notes">

- `>>> -7 // 2` −7 ÷ 2 = −3.5。
- `-4` 往下取整,是往**更小**的方向取,−3.5 往下是 −4,不是 −3。很多人以为整除就是「把小数部分砍掉」,砍掉得到的是 −3,那是往 0 的方向取,不一样。
- `1` 余数配合整除:−4 × 2 + 1 = −7。Python 的余数**跟除数的符号走**,除数 2 是正的,余数就不会是负的。
- `>>> 7 // 2` 正数没有争议,3。
- `>>> -2 ** 2` 乘方比负号先算,这是 `-(2 ** 2)`。
- `-4` 和数学里 −2² = −4 一致。
- `>>> (-2) ** 2` 想要「负二的平方」就加括号。
- `3.0` `//` 只管取整,不管类型:有 float 参与,结果还是 float,只是小数部分是 0。
- `ZeroDivisionError: division by zero` Day 9 见过的除以零。`/`、`//`、`%` 除数是 0 都会报这个。JS 里 `10 / 0` 得到 `Infinity`,不报错。

</div>

同样几条在 Node 里:

```text
$ node -e "console.log(Math.floor(-7/2), Math.trunc(-7/2), -7 % 2, (-2)**2)"
-4 -3 -1 4
$ node -e "console.log(-2**2)"
[eval]:1
console.log(-2**2)
            ^^^^
'**' cannot be applied to unary/await expression.

SyntaxError: Unary operator used immediately before exponentiation expression. Parenthesis must be used to disambiguate operator precedence
```

<div class="line-notes">

- `-4 -3 -1 4` `Math.floor` 和 Python 的 `//` 一样是 −4;`Math.trunc`(砍掉小数)是 −3;JS 的 `%` 余数跟**被除数**的符号走,得 −1,和 Python 的 1 不同。
- `SyntaxError: Unary operator used immediately before exponentiation expression.` JS 干脆不许你写 `-2**2`,要求加括号说清楚。Python 允许,按「乘方优先」算。两边都加括号最省心。

</div>

什么时候会撞上负数整除?算退款、算余额、算时间差的时候。比如把「欠费 7 元」存成 −7,按每两个月分摊,`-7 // 2` 是 −4 而不是 −3。我的建议是:钱和时间的计算里出现负数时,先想清楚你要的是「往下取」还是「往 0 取」,不确定就在交互模式里试一下,不要凭 JS 的手感猜。

## 0.1 + 0.2 和浮点误差

Day 8 的 `299 * 0.13` 算出 `38.870000000000005`,当时说是浮点数的舍入误差。现在正式看。新建 `part01/float_error.py`:

```python
# agent-zero-lab/part01/float_error.py
import math

print(0.1 + 0.2)
print(0.1 + 0.2 == 0.3)
print(299 * 0.13)
print(19.99 * 100)
print(round(19.99 * 100))
print(round(2.5), round(3.5), round(8.5))
print(round(2.675, 2))
print(math.isclose(0.1 + 0.2, 0.3))
```

<div class="line-notes">

- `import math` 导入 Python 自带的数学模块,相当于 JS 里直接能用的 `Math`,只是 Python 要先 import。`import` 的细节 [Day 32](/blog/agent-zero/day-032-modules/) 讲,今天只用它的一个函数。
- `print(0.1 + 0.2)` 最有名的一道题。
- `print(0.1 + 0.2 == 0.3)` `==` 是「等不等于」,结果是真或假。真假这种值叫布尔值,[Day 14](/blog/agent-zero/day-014-bool-none/) 讲,今天先看结果。
- `print(299 * 0.13)` Day 8 的那个数。
- `print(19.99 * 100)` 把 19.99 元换算成分。
- `print(round(19.99 * 100))` `round(x)` 四舍五入到整数(Day 8 用过 `round(x, 2)` 保留两位)。
- `print(round(2.5), round(3.5), round(8.5))` 三个「正好是 .5」的数。
- `print(round(2.675, 2))` 保留两位小数,按小学的规矩应该是 2.68。
- `print(math.isclose(0.1 + 0.2, 0.3))` `math.isclose(a, b)` 判断两个 float「是不是足够接近」。

</div>

```text
$ uv run python part01/float_error.py
0.30000000000000004
False
38.870000000000005
1998.9999999999998
1999
2 4 8
2.67
True
```

<div class="line-notes">

- `0.30000000000000004` 多了一个 4,在小数点后第 17 位。
- `False` 所以 `0.1 + 0.2 == 0.3` 是假的。用 `==` 比较两个 float,是一个经典 bug 的来源。
- `38.870000000000005` 和 Day 8 一样。
- `1998.9999999999998` 19.99 × 100 应该是 1999,算出来差一点点。这个数要是直接截掉小数部分,就变成 1998 分,少了一分钱。[Day 14](/blog/agent-zero/day-014-bool-none/) 讲 `int()` 时会看到这件事真实发生。
- `1999` `round` 四舍五入回 1999,对了。**元换算成分,一定要 `round`**。
- `2 4 8` 不是 3、4、9。Python 的 `round` 遇到正好一半时,取**离它最近的偶数**:2.5 在 2 和 3 中间,取偶数 2;3.5 取 4;8.5 取 8。这叫「银行家舍入」(四舍六入五成双),目的是大量数据加起来时舍入误差不往一个方向偏。JS 的 `Math.round(2.5)` 是 3,`Math.round(8.5)` 是 9,两边不一样。
- `2.67` 这个和「五成双」无关:2.675 存进计算机时实际是 2.67499999…,本来就比 2.675 小一点,所以舍成 2.67。Python 官方文档专门拿这个例子讲过。
- `True` 判断两个 float 相等,用 `math.isclose`,不用 `==`。

</div>

JS 里一样:

```text
$ node -e "console.log(0.1 + 0.2, 0.1 + 0.2 === 0.3, 19.99 * 100, Math.round(19.99 * 100))"
0.30000000000000004 false 1998.9999999999998 1999
```

<div class="line-notes">

- `0.30000000000000004 false 1998.9999999999998 1999` 和 Python 一模一样。这不是 Python 的毛病,也不是 JS 的毛病,是几乎所有编程语言共用的那种小数格式(IEEE 754 双精度浮点数)的特性。JS 的 `number` 和 Python 的 `float` 是同一个东西。

</div>

### 为什么会这样

说白了,原因和「1/3 写不成有限小数」是一回事。

十进制里,1/3 = 0.3333…,写到哪一位都写不完,只能在某一位截断,截断就有误差。计算机用二进制存小数,二进制里**能写完的小数**只有 1/2、1/4、1/8 这种「分母是 2 的几次方」的数及其组合。0.1 = 1/10,分母里有个 5,在二进制里就是一个无限循环小数:0.000110011001100…,存的时候只能截到 52 位二进制,截断就有一点点误差。0.2 也一样。两个带误差的数加起来,误差凑巧露了出来,就成了 `0.30000000000000004`。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="0.1 在二进制里是 0.0001100110011 无限循环,存储时截断到 52 位,存进去的是一个比 0.1 稍大一点的近似值;0.5 是二进制 0.1,能精确存">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="30" fill="var(--ink)">十进制 1/3 = 0.3333333333…   写不完,只能截断</text>
<text x="20" y="62" fill="var(--ink)">二进制 0.1 = 0.0001100110011001100110011…  也写不完</text>
<rect x="20" y="80" width="400" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="32" y="102" fill="var(--ink)">存进去:截到 52 位有效二进制位</text>
<line x1="420" y1="97" x2="450" y2="97" stroke="var(--ink-soft)"/>
<polygon points="450,92 460,97 450,102" fill="var(--ink-soft)"/>
<text x="466" y="94" fill="var(--ink-soft)">实际存的是</text>
<text x="466" y="110" fill="var(--ink-soft)">0.1000000000000000055…</text>
<line x1="20" y1="136" x2="620" y2="136" stroke="var(--rule)"/>
<text x="20" y="160" fill="var(--ink)">二进制 0.5 = 0.1     0.25 = 0.01     0.75 = 0.11</text>
<rect x="20" y="174" width="400" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="196" fill="var(--ink)">分母是 2 的几次方:能精确存,没有误差</text>
</g>
</svg>
<figcaption>0.1 存不准,就像 1/3 写不完。0.5、0.25 这种存得准,所以不是所有小数都有误差。</figcaption>
</figure>

所以有误差的不是「小数」,而是「在二进制里写不完的小数」。`468 / 12` 得到的 `39.0` 就是精确的,`0.5 + 0.25` 也是精确的。麻烦在于你很难一眼看出哪个会出事:`19.99 * 3` 打印出来是 `59.97`,看着没问题,`1.1 * 3` 打印出来是 `3.3000000000000003`。不可预测,才是它危险的地方。

### 平时怎么办

两条规矩够用一整门课:

1. **比较 float 不用 `==`**,用 `math.isclose(a, b)`。后面写测试([Day 71](/blog/agent-zero/day-071-pytest-1/))时这条会再出现一次。
2. **钱用整数算**。把元换成分(×100),全程用 int 加减乘,最后显示时再除以 100。int 是精确的,不会冒出 0.0000000004。

还有第三种办法,Python 自带的 `decimal` 模块,专门做十进制精确计算,金融系统里很常用。它要先学会函数、模块和字符串才好讲,课里到作品篇的 BillSleuth 才正式用它。在那之前,整数分就够了。

## 拼起来:五个席位的年付报价单

T003 的客户其实是个小团队,5 个人都在用专业版。客服要给他一张报价:月付一年多少、年付多少、省了多少、省了百分之几、按 13% 的税率税额多少、含税合计多少。全程用分算。新建 `part01/price_calc.py`:

```python
# agent-zero-lab/part01/price_calc.py
TAX_PERCENT = 13

seats = 5
monthly_fen = 4900
yearly_fen = 46800

pay_monthly_fen = monthly_fen * 12 * seats
pay_yearly_fen = yearly_fen * seats
saved_fen = pay_monthly_fen - pay_yearly_fen
saved_percent = saved_fen / pay_monthly_fen * 100

tax_fen = pay_yearly_fen * TAX_PERCENT // 100
total_fen = pay_yearly_fen + tax_fen

print("席位数:", seats)
print("月付一年:", pay_monthly_fen / 100, "元")
print("年付:", pay_yearly_fen / 100, "元")
print("年付省下:", saved_fen / 100, "元,约", round(saved_percent, 1), "%")
print("税额:", tax_fen / 100, "元")
print("含税合计:", total_fen // 100, "元", total_fen % 100, "分")
```

<div class="line-notes">

- `TAX_PERCENT = 13` 税率写成整数百分比 13,不写成 0.13。0.13 是 float,一乘就可能带进误差;13 是 int。全大写表示「这是个配置,别在中间改它」。
- `seats = 5` 席位数,int。
- `monthly_fen = 4900` 月付 49 元 = 4900 分。变量名带上单位 `_fen`,这是我很推荐的习惯:一眼看出这个数是分还是元,不会把两种单位加在一起。
- `yearly_fen = 46800` 年付 468 元 = 46800 分。
- `pay_monthly_fen = monthly_fen * 12 * seats` 4900 × 12 × 5 = 294000 分。全是 int,结果精确。
- `pay_yearly_fen = yearly_fen * seats` 46800 × 5 = 234000 分。
- `saved_fen = pay_monthly_fen - pay_yearly_fen` 294000 − 234000 = 60000 分。
- `saved_percent = saved_fen / pay_monthly_fen * 100` 百分比本来就不是钱,用 `/` 得到 float 没关系:60000 / 294000 × 100 = 20.408163…。
- `tax_fen = pay_yearly_fen * TAX_PERCENT // 100` 先乘 13 再整除 100:234000 × 13 = 3042000,`// 100` 得 30420 分。**顺序很重要**:先乘后除,中间结果一直是整数。如果写成 `pay_yearly_fen * (TAX_PERCENT / 100)`,`13 / 100` 先变成 float 0.13,又回到浮点的老路上。<br>这里 `// 100` 恰好除得尽。除不尽时 `//` 会把不到一分的零头直接舍掉,练习 3 专门看这个。
- `total_fen = pay_yearly_fen + tax_fen` 234000 + 30420 = 264420 分。
- `print("月付一年:", pay_monthly_fen / 100, "元")` 只在显示的时候除以 100,变回元。显示出来的 float 只看不再拿去算,有一点误差也不会累积。
- `print("年付省下:", saved_fen / 100, "元,约", round(saved_percent, 1), "%")` 百分比保留一位小数。
- `print("含税合计:", total_fen // 100, "元", total_fen % 100, "分")` 用 `//` 和 `%` 把分拆成「元」和「分」两部分,和上面拆小时分钟一个套路。

</div>

```text
$ uv run python part01/price_calc.py
席位数: 5
月付一年: 2940.0 元
年付: 2340.0 元
年付省下: 600.0 元,约 20.4 %
税额: 304.2 元
含税合计: 2644 元 20 分
```

<div class="line-notes">

- `月付一年: 2940.0 元` 294000 / 100。`/` 的结果是 float,所以带 `.0`。想显示成 `2940.00` 这种固定两位小数,要用 [Day 15](/blog/agent-zero/day-015-strings-1/) 的 f-string,今天先忍着。
- `年付: 2340.0 元` 468 × 5。
- `年付省下: 600.0 元,约 20.4 %` 一年省 600 元,省了约 20.4%。客服可以直接把这两个数发给客户。
- `税额: 304.2 元` 2340 × 13%。
- `含税合计: 2644 元 20 分` 2340 + 304.2 = 2644.2 元,拆成 2644 元 20 分。

</div>

写完顺手跑一遍 Day 9 和 Day 10 的工具,确认没有红线、排版是 Ruff 认可的:

```text
$ uv run ruff check part01/price_calc.py part01/float_error.py part01/operators.py
All checks passed!
$ uv run ruff format --check part01/price_calc.py part01/float_error.py part01/operators.py
3 files already formatted
```

<div class="line-notes">

- `$ uv run ruff check part01/price_calc.py part01/float_error.py part01/operators.py` Day 10 装进 dev 组的 Ruff,`uv run` 调用项目里那个。
- `All checks passed!` 没有问题。别对整个 `part01/` 跑,那里面有今天故意写错的 `var_errors.py` 和 `plus_plus.py`,Ruff 会报出来,那是对的。
- `3 files already formatted` `--check` 只检查不改,三个文件都已经是 Ruff 格式。

</div>

在 Zed 里打开这几个文件,basedpyright 也不会画任何红线。我在命令行用 basedpyright 1.40.2 对 `variables.py`、`int_float.py`、`operators.py`、`float_error.py`、`price_calc.py` 跑了一遍,结果是 `0 errors, 0 warnings, 0 notes`。

| 今天的零件 | 在报价单里是哪一步 |
| --- | --- |
| 变量 = 名字标签,`=` 赋值 | 每一行 `xxx_fen = ...` |
| 全大写常量是约定 | `TAX_PERCENT = 13` |
| 名字带单位 | `monthly_fen`、`saved_fen` |
| int 精确、没有上限 | 所有金额都是分,int 运算 |
| `/` 结果一律是 float | 百分比 `saved_percent`、显示时 `/ 100` |
| `//` 和 `%` 成对拆单位 | `total_fen // 100` 元、`total_fen % 100` 分 |
| 先乘后除,别让 0.13 进来 | `pay_yearly_fen * TAX_PERCENT // 100` |
| 浮点误差,`round` 只在最后用 | `round(saved_percent, 1)` |

## 动手练习

### 练习 1:先猜,再跑

打开 `uv run python`,下面八行每行先在纸上写下你猜的结果(注意写成 `3` 还是 `3.0`),再敲进去对答案:`7 / 2`、`7 // 2`、`7 % 2`、`2 ** 3`、`10 / 5`、`type(10 / 5)`、`1 + 2.0`、`-7 // 2`。

<details><summary>参考答案</summary>

```text
$ uv run python
>>> 7 / 2
3.5
>>> 7 // 2
3
>>> 7 % 2
1
>>> 2 ** 3
8
>>> 10 / 5
2.0
>>> type(10 / 5)
<class 'float'>
>>> 1 + 2.0
3.0
>>> -7 // 2
-4
>>> exit()
```

<div class="line-notes">

- `3.5` `/` 是真正的除法。
- `3` `//` 整除,两个 int,结果 int。
- `1` 7 = 3 × 2 + 1。拿 `% 2` 判断奇偶是最常见的用法:余 1 是奇数,余 0 是偶数。
- `8` 2 的 3 次方。
- `2.0` 最多人猜错的一行:能除尽也是 float。
- `<class 'float'>` 再确认一次。
- `3.0` int 加 float 得 float。
- `-4` 往下取整,不是 −3。

</div>

八个全对说明今天的运算符过关了。错在 `2.0` 和 `-4` 的,回去重读「两种数字」和「负数整除」两节。

</details>

### 练习 2:T001 和 T003 的答案

新建 `part01/ex12_refund.py`,用变量算两件事,不准在 `print` 里直接写算好的数:T001 客户被扣了两次 299 元,实付多少、应退多少;T003 单个席位月付一年和年付差多少。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex12_refund.py
price = 299
charged_times = 2
paid = price * charged_times
refund = paid - price
print("T001 实付:", paid, "元,应退:", refund, "元")

monthly = 49
yearly = 468
diff = monthly * 12 - yearly
print("T003 月付一年:", monthly * 12, "元,年付:", yearly, "元,差价:", diff, "元")
```

<div class="line-notes">

- `price = 299` 单价。
- `charged_times = 2` 扣了两次。名字写清楚是「被扣的次数」,别只写 `n`。
- `paid = price * charged_times` 598。
- `refund = paid - price` 应付一次,多出来的就是要退的:598 − 299 = 299。
- `diff = monthly * 12 - yearly` 588 − 468 = 120。这几个都是整元,没有小数,直接用 int 元就行,不用换成分。
- `print("T003 月付一年:", monthly * 12, "元,年付:", yearly, "元,差价:", diff, "元")` `print` 的参数可以有好几个,一行打印出来。

</div>

```text
$ uv run python part01/ex12_refund.py
T001 实付: 598 元,应退: 299 元
T003 月付一年: 588 元,年付: 468 元,差价: 120 元
```

<div class="line-notes">

- `T001 实付: 598 元,应退: 299 元` 和 `variables.py` 算的一样。
- `T003 月付一年: 588 元,年付: 468 元,差价: 120 元` 和 `operators.py` 一样。

</div>

</details>

### 练习 3:19.99 元的税,四舍五入到分

CloudLedger 有个基础版每月 19.99 元。用整数分算它 13% 的税,分别用三种写法看结果:精确值(`/`)、直接整除(`//`)、四舍五入到分。再用元和小数直接算一次 `19.99 * 0.13` 对比。提示:整数里实现「四舍五入」的老办法是先加上除数的一半再整除。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex12_tax.py
price_fen = 1999
TAX_PERCENT = 13

exact = price_fen * TAX_PERCENT / 100
floor_fen = price_fen * TAX_PERCENT // 100
half_up_fen = (price_fen * TAX_PERCENT + 50) // 100

print("精确值:", exact, "分")
print("直接整除:", floor_fen, "分")
print("四舍五入:", half_up_fen, "分")
print("用元和小数算:", 19.99 * 0.13)
```

<div class="line-notes">

- `price_fen = 1999` 19.99 元 = 1999 分。手写成分,不用 `19.99 * 100` 去换算,就碰不到上面那个 1998.9999。
- `exact = price_fen * TAX_PERCENT / 100` 1999 × 13 = 25987,再 `/ 100`,得 259.87 分。税额算出来不到整分,是正常的。
- `floor_fen = price_fen * TAX_PERCENT // 100` 25987 // 100 = 259。零头 0.87 分直接扔了。
- `half_up_fen = (price_fen * TAX_PERCENT + 50) // 100` 先加 50(除数 100 的一半)再整除:25987 + 50 = 26037,// 100 = 260。零头 ≥ 0.5 分时加 50 会进一位,< 0.5 分时不会。这是整数里「四舍五入」的标准写法,只对正数成立。

</div>

```text
$ uv run python part01/ex12_tax.py
精确值: 259.87 分
直接整除: 259 分
四舍五入: 260 分
用元和小数算: 2.5987
```

<div class="line-notes">

- `直接整除: 259 分` 少收一分。一张发票少一分不起眼,一百万张就是一万元。
- `四舍五入: 260 分` 2.60 元,这才是该收的税。
- `用元和小数算: 2.5987` 这次小数版本没冒出误差,但你还得再 `round(..., 2)` 一次,而 `round` 又有「五成双」和 2.675 那种坑。整数版每一步你都知道发生了什么。

</div>

真实的系统里「零头怎么舍」是业务规则(按发票舍还是按行舍、四舍五入还是全舍),要问财务,不是程序员随手定的。BillSleuth 那部分会碰到这种规则真的写进合同的情况。

</details>

### 练习 4:把秒数拆成时分秒

一次 Agent 批处理跑了 9876 秒。新建 `part01/ex12_duration.py`,用 `//` 和 `%` 算出是几小时几分几秒,最后验算一遍加回去等不等于 9876。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex12_duration.py
total_seconds = 9876
hours = total_seconds // 3600
rest = total_seconds % 3600
minutes = rest // 60
seconds = rest % 60
print(total_seconds, "秒 =", hours, "小时", minutes, "分", seconds, "秒")
print("验算:", hours * 3600 + minutes * 60 + seconds)
```

<div class="line-notes">

- `hours = total_seconds // 3600` 一小时 3600 秒,9876 里有 2 个完整的小时。
- `rest = total_seconds % 3600` 剩下 9876 − 7200 = 2676 秒。
- `minutes = rest // 60` 2676 里有 44 个完整的分钟。
- `seconds = rest % 60` 剩 2676 − 2640 = 36 秒。
- `print("验算:", hours * 3600 + minutes * 60 + seconds)` 反过来乘回去加起来。拆完对账,Day 6 的老习惯。

</div>

```text
$ uv run python part01/ex12_duration.py
9876 秒 = 2 小时 44 分 36 秒
验算: 9876
```

<div class="line-notes">

- `9876 秒 = 2 小时 44 分 36 秒` 两层 `//` 和 `%`:先拆小时,剩下的再拆分钟。
- `验算: 9876` 对上了。

</div>

</details>

验收标准:`variables.py`、`int_float.py`、`operators.py`、`float_error.py`、`price_calc.py` 都能跑,输出和文中一致;能不看文章说出 `/` 和 `//` 的区别、`-7 // 2` 为什么是 −4、`0.1 + 0.2` 为什么不等于 0.3;`price_calc.py` 能默写出来,含税合计是 2644 元 20 分;`uv run ruff check` 对今天的正常文件没有报错。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 变量(variable) | 贴在一个值上的名字。`amount = 299` 让 `amount` 指向 299,相当于 JS 的 `let amount = 299`,但不写 `let` |
| 赋值(assignment) | `=` 的动作:先算右边,再让左边的名字指向结果 |
| 重新赋值 | 让已有的名字改指另一个值;别的变量不受影响 |
| 增量赋值 | `x += 1` 这类写法,等于 `x = x + 1`;Python 没有 `++`、`--` |
| 常量(约定) | 全大写的变量名如 `TAX_PERCENT`,告诉读代码的人「别改它」,Python 不强制 |
| PEP 8 | Python 官方代码风格指南,规定变量用 `snake_case`(小写加下划线)、常量全大写 |
| `type()` | 内置函数,返回一个值的类型,如 `<class 'int'>` |
| `NameError` | 用了一个没定义过的名字,多半是拼错了 |
| int(整数) | 没有小数点的数,精确、没有大小上限 |
| float(浮点数) | 带小数点的数,和 JS 的 `number` 是同一种格式(IEEE 754 双精度),只有约 15–17 位有效数字,是近似值 |
| 数字下划线 | `1_000_000` 里的下划线只为好读,Python 忽略它 |
| `/` 除法 | 结果一律是 float,能除尽也是,如 `468 / 12` 得 `39.0` |
| `//` 整除(floor division) | 除完往下取整;负数往更小的方向取,`-7 // 2` 是 −4 |
| `%` 取余(modulo) | 除完剩下的部分;Python 的余数和除数同号,`-7 % 2` 是 1 |
| `**` 乘方 | `2 ** 10` 是 1024;比负号先算,`-2 ** 2` 是 −4 |
| `ZeroDivisionError` | 除数是 0。Python 报错,JS 得 `Infinity` |
| 浮点误差 | 二进制写不完的小数(如 0.1)被截断存储产生的微小误差,`0.1 + 0.2` 得 `0.30000000000000004` |
| IEEE 754 | 几乎所有语言共用的浮点数格式标准,JS 和 Python 的小数都按它存 |
| 银行家舍入 | Python `round` 遇到正好一半时取最近的偶数,`round(2.5)` 是 2、`round(3.5)` 是 4 |
| `math.isclose` | 判断两个 float 是否足够接近,用来代替 `==` |
| 整数分 | 把金额乘 100 用 int 存成「分」再计算,避免浮点误差 |

## 常见误区

**写 `count++`。** Python 没有自增运算符,报 `SyntaxError: invalid syntax`。写 `count += 1`。反过来,写 `count+1` 只算出一个值,不会改 `count`。

**以为 `468 / 12` 是 39。** 是 `39.0`。`/` 的结果永远是 float。要整数就用 `//`,并且确认你确实想要往下取整。

**把 JS 的注释 `//` 带到 Python 里。** `price = 49 // 月付价格` 不是注释,是「49 整除一个叫『月付价格』的变量」,会报语法错或 `NameError`。Python 注释是 `#`。

**以为整除就是砍掉小数。** 正数是这样,负数不是。`-7 // 2` 是 −4,JS 的 `Math.trunc(-7 / 2)` 是 −3。涉及负数(退款、欠费、时间倒推)时先在交互模式里试。

**用 `==` 比两个小数。** `0.1 + 0.2 == 0.3` 是 `False`。比 float 用 `math.isclose`,或者干脆用整数分。

**元换成分时直接截断。** `19.99 * 100` 是 `1998.9999999999998`,截掉小数部分就少一分钱。要么用 `round(19.99 * 100)`,要么一开始就把价格写成分 `1999`。

**以为 Python 的 `round` 和 JS 的 `Math.round` 一样。** `round(8.5)` 是 8,`Math.round(8.5)` 是 9。遇到正好 .5 时 Python 取偶数。后面课里有篇文章拿网格坐标踩过这个坑(Day 213)。

**税率写成 0.13 再乘金额。** 一乘就进了 float。写成整数百分比 13,先乘后 `// 100`。

**以为改了一个变量,用到它的其他变量会自动更新。** `charged = amount * times` 算完就定了,之后改 `times`,`charged` 不变。变量不是 Excel 公式。

## 学习资料

### 文档与文章

- [Python 官方教程 · 3. Python 速览](https://docs.python.org/zh-cn/3.12/tutorial/introduction.html):中文,读「3.1.1 数字」那一小节,讲 `/`、`//`、`%`、`**`、交互模式里的 `_`,十分钟读完,和今天的运算符表一一对照。
- [Python 官方教程 · 15. 浮点算术:争议和限制](https://docs.python.org/zh-cn/3.12/tutorial/floatingpoint.html):中文,官方自己解释 0.1 为什么存不准、`round(2.675, 2)` 为什么是 2.67。今天必读,写得很清楚。
- [Python 标准库 · 内置类型](https://docs.python.org/zh-cn/3.12/library/stdtypes.html):中文,「数字类型 --- int, float, complex」一节有所有运算符的正式说明,脚注里写了 `//` 和 `%` 对负数的规则。当字典查。
- [Python 标准库 · 内置函数 round](https://docs.python.org/zh-cn/3.12/library/functions.html):中文,在页面里搜 `round`,有「舍入到最近的偶数」的原文说明。
- [PEP 8 · 命名约定](https://peps.python.org/pep-0008/):英文,看「Naming Conventions」一节,变量、常量怎么起名的出处。
- [MDN · Number](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Number):中文,对照看 JS 的 `MAX_SAFE_INTEGER` 和 `EPSILON`,理解为什么 Python 的 int 没有这个上限。
- [0.30000000000000004.com](https://0.30000000000000004.com/):英文,一页列出几十种语言算 `0.1 + 0.2` 的结果。看一眼就知道这不是某个语言的毛病。
- [The Floating-Point Guide](https://floating-point-gui.de/):英文,专门写给「为什么我的数加起来不对」的程序员,比教科书好懂,「Basic Answers」一页就够。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1UM4y147LJ&autoplay=0&high_quality=1" title="【前端面试】为什么 0.1 + 0.2 不等于 0.3" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>哲玄前端 · 【前端面试】为什么 0.1 + 0.2 不等于 0.3 · 5 分钟,2023 年 5 月,播放 17 万。从前端面试题的角度讲,用的是 JS,但讲的就是今天那张二进制图。你作为前端多半被问过这题,今天把 Python 这边也对上。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1rY411J7pu&autoplay=0&high_quality=1" title="15分钟学会Python变量 | 真正0基础Python教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>学习编程王同学 · 15分钟学会Python变量 | 真正0基础Python教程 · 17 分钟,2022 年 4 月。从零讲变量、命名规则、重新赋值,节奏慢,适合今天第一节没跟上的时候补。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/khKv-8q7YmY" title="Python Tutorial for Beginners 3: Integers and Floats - Working with Numeric Data" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial for Beginners 3: Integers and Floats · 英文,可开自动字幕。Python 入门视频里口碑最好的一套,这一集讲 int、float、算术运算符和增量赋值,和今天的范围几乎一样。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/PZRI1IfStY0" title="Floating Point Numbers - Computerphile" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Computerphile · Floating Point Numbers · 英文,可开自动字幕。诺丁汉大学的老师在纸上推一遍浮点数怎么存,讲清楚「科学计数法 + 有限位数」这个思路。想知道 52 位是怎么来的就看这个。</figcaption>
</figure>

### 书籍

- Eric Matthes《Python Crash Course》第 3 版,No Starch Press,2023。中译本书名《Python编程:从入门到实践》(袁国忠译,人民邮电出版社)。第 2 章「变量和简单数据类型」讲的就是今天的内容,例子比这里简单,适合换个角度再看一遍。
- Allen B. Downey《Think Python》第 3 版,O'Reilly,2024,作者在 [allendowney.github.io/ThinkPython](https://allendowney.github.io/ThinkPython/) 免费放了全文(英文)。第 1、2 章讲值、变量、表达式,写得很细,每章末尾有练习。
- David Goldberg 的论文《What Every Computer Scientist Should Know About Floating-Point Arithmetic》(1991),Oracle 文档站有[全文](https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html)。很硬,今天不用读,知道「浮点误差」的经典出处在这就行,以后想深挖再回来。

### 开源项目与代码

- [erikwiffin/0.30000000000000004](https://github.com/erikwiffin/0.30000000000000004):上面那个网站的源码,README 里有各语言的代码片段,可以看看 Go、Rust、SQL 里同一个算式长什么样。
- [satwikkansal/wtfpython](https://github.com/satwikkansal/wtfpython):收集 Python 里各种「反直觉」的例子,README 里链着社区的中文翻译。今天搜 `round` 和 `float`,看看还有哪些和数字有关的坑;其他章节学到哪看到哪。

## 自测

1. `a = 10`,`b = a * 2`,`a = 1`,这时 `b` 是多少?为什么?

<details><summary>答案</summary>

20。`b = a * 2` 执行时 `a` 是 10,算出 20,`b` 指向 20。之后 `a` 改指 1,不会让 `b` 重算。变量记的是值,不是公式。

</details>

2. 下面每个表达式的结果和类型分别是什么:`9 / 3`、`9 // 3`、`9 // 2.0`、`2 ** 3 * 2`?

<details><summary>答案</summary>

`9 / 3` 是 `3.0`(float,`/` 永远出 float);`9 // 3` 是 `3`(int);`9 // 2.0` 是 `4.0`(有 float 参与,结果是 float);`2 ** 3 * 2` 是 `16`(先乘方得 8,再乘 2)。

</details>

3. 为什么 `0.1 + 0.2 == 0.3` 是 `False`,而 `0.5 + 0.25 == 0.75` 是 `True`?

<details><summary>答案</summary>

0.1、0.2 在二进制里是无限循环小数,存进 float 时被截断,带着微小误差,相加后误差露出来,结果是 0.30000000000000004。0.5、0.25、0.75 的分母是 2 的几次方,在二进制里是有限小数(0.1、0.01、0.11),能精确存,没有误差。

</details>

4. 一个同事写了 `tax = int(price * 0.13 * 100) / 100` 来算税,你觉得有什么问题?怎么改?

<details><summary>答案</summary>

两个问题:`price * 0.13` 已经是带误差的 float,乘 100 后可能变成 xxx.99999,`int(...)` 会直接截断,少一分;而且截断本身就不是四舍五入。改法是把价格存成整数分,税率写成整数百分比:`tax_fen = (price_fen * 13 + 50) // 100`,全程 int 运算。

</details>

5. 面试题:你在做一个 Agent 的计费模块,要把每次调用的费用加起来。为什么不建议用 float 存金额?有哪些替代办法?

<details><summary>答案</summary>

float 是二进制近似值,像 0.1 这样的十进制小数存不准,每次运算都可能带进极小的误差,成千上万次累加后误差会变成看得见的分差;用 `==` 对账也会失败。替代办法:一是用整数存最小货币单位(分,或者更小的单位如「千分之一分」),全程整数运算,显示时再换算;二是用十进制定点数(Python 的 `decimal.Decimal`、数据库的 `NUMERIC`/`DECIMAL` 类型)。还要和业务方定清楚舍入规则:在哪一步舍、四舍五入还是银行家舍入。

</details>

## 明天预告

Day 13 · 第 2 周复习:编程地基(Day 7–12)。这一周从 PATH 讲到装 Python、编辑器红线、uv 的两天,今天才写下第一批真正的 Python 代码。明天停一天,画一张这周的知识地图,合上文章默写三段:做一个在哪都能敲的 Python 命令、从空目录重建 `agent-zero-lab`、今天的报价单,再把这一周撞过的报错整理成一张表。下周开始布尔值、字符串和条件判断,地基要先打牢。
