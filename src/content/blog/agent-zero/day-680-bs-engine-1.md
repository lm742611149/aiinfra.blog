---
title: 'Day 680 · BillSleuth(一):金额只走一个函数,事件是事实订阅是快照'
description: 'BillSleuth 的第一天正式代码。先把 Decimal 的规矩一条条跑出来,收进 money.py 的三个函数,用 pytest 钉死,改一个舍入方式测试就变红;再建 billing.db 的十张表:金额为什么存 TEXT(连 SQL 的 SUM 都会把它变回浮点数),订阅表为什么只是快照、真相在事件表里,事件时间为什么统一存 UTC,以及让 SQLite 自己拦住脏数据的 CHECK 和外键。'
pubDate: 2026-10-22
regime: none
tags: ['billsleuth', 'decimal', 'sqlite', 'event-sourcing', 'agent-zero']
series: 'agent-zero'
day: 680
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 679](/blog/agent-zero/day-679-bs-prd/) 把开题做完了:补了优惠券、税、贷记单三个名词(先折扣后算税,多收了开贷记单,不改发票),把客户的抱怨整理成 13 类根因,用一个小实验看到只听客户原话模型只能蒙;写了一页 PRD 并用 `prd_check.py` 守住,画了架构图,排好了 Day 680 到 701 的进度,用 15 次假运行把六个验收指标各算了一遍。

架构图右下角有两样东西:`billing.db` 和参考计费引擎。引擎明天写。今天先打地基:金额怎么表示、怎么舍入,库里有哪些表、每张表存什么。这两件事看起来枯燥,但后面每一个工具、每一条证据、每一个评测分数都踩在它们上面。Day 677 留了一句「Decimal 在 Day 680 专门讲」,就是今天。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清楚 Decimal 的几条规矩(从字符串造、和整数可以混算、和 float 混算直接报错、只在最后舍入一次),写出拒收 float 的 `money()`,并用 pytest 证明改了舍入方式测试会变红。
2. 解释为什么 SQLite 里金额存 TEXT 不存 REAL,以及为什么就算存了 TEXT,也不能用 SQL 的 `SUM` 算钱。
3. 建出 BillSleuth 的十张表,说出「订阅表是快照,事件表是事实」是什么意思,用事件回放出任意时刻的订阅状态。
4. 说清楚事件时间为什么统一存 UTC,并用 CHECK 约束和外键让数据库自己拦住两类脏数据,知道外键检查默认是关着的。

预计用时 2.5 到 3 小时。前置:[Day 677](/blog/agent-zero/day-677-bs-why/)(Decimal 三条规矩、左闭右开、时区练习)、[Day 12](/blog/agent-zero/day-012-numbers/)(浮点误差)、[Day 85](/blog/agent-zero/day-085-sql-1/)(建表和 SELECT)、[Day 91](/blog/agent-zero/day-091-sql-6/)(主键、外键、约束)、[Day 92](/blog/agent-zero/day-092-python-sqlite-1/) 和 [Day 93](/blog/agent-zero/day-093-python-sqlite-2/)(Python 操作 SQLite、`row_factory`、事务)、[Day 71](/blog/agent-zero/day-071-pytest-1/) 到 [Day 73](/blog/agent-zero/day-073-pytest-3/)(pytest、parametrize、fixture)、[Day 535](/blog/agent-zero/day-535-durable-1/)(事件溯源)。今天不调模型,花费 0 元。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `money.py` 的三个函数和 `subscriptions`、`subscription_events` 两张表默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 第零步:从草稿到项目

到昨天为止,`billsleuth/` 里只有 `scratch/` 草稿、`docs/prd.md` 和 `scripts/prd_check.py`。今天开始写正式代码,先把包和测试的骨架搭起来:

```bash
cd billsleuth
mkdir -p billsleuth tests
touch billsleuth/__init__.py
uv add --dev pytest
sed -i '' 's/^billing.db$/*.db/' .gitignore
```

<div class="line-notes">

- `mkdir -p billsleuth tests` 在仓库里再建一个同名的 `billsleuth/` 目录,它是 Python 包,正式代码都放这里;`tests/` 放测试。外层是仓库,里层是包,Day 679 的仓库结构图画过。
- `touch billsleuth/__init__.py` 空文件,告诉 Python「这个目录是一个包」,这样才能 `from billsleuth.money import ...`。相当于给目录配了一个 `index.js` 入口,只是这里可以是空的。
- `uv add --dev pytest` 测试只在开发时用,装进 dev 依赖组。2026 年 10 月查到 PyPI 上是 pytest 9.1.1。
- `sed -i '' 's/^billing.db$/*.db/' .gitignore` 把 Day 679 写的 `billing.db` 那一行换成 `*.db`。今天的草稿脚本会在 `scratch/` 下生成好几个练习库,一个都不该提交。`sed -i ''` 是 macOS 的原地修改写法,Linux 上写 `sed -i`。

</div>

然后在 `pyproject.toml` 末尾加上 pytest 的配置,写法和 [Day 72](/blog/agent-zero/day-072-pytest-2/) 一样:

```toml
[tool.pytest]
pythonpath = ["."]
testpaths = ["tests"]
```

<div class="line-notes">

- `[tool.pytest]` pytest 9 起支持直接在 `pyproject.toml` 里写 `[tool.pytest]` 这一节。
- `pythonpath = ["."]` 跑测试时把仓库根目录加进模块搜索路径,测试文件里的 `from billsleuth.money import ...` 才找得到。不加这一行就是 Day 72 演示过的 `ModuleNotFoundError`。
- `testpaths = ["tests"]` 只在 `tests/` 里找测试,不去翻 `scratch/`。

</div>

## 概念一:金额只走一个函数

### 先把 Decimal 的规矩一条条跑出来

Day 677 只让你记了三条:从字符串造、用 `quantize` 舍入、别用 `round()`。今天要把规则收进代码,就得知道更多细节。我把可能遇到的情况写成八行,一行一个现象:

```python
# billsleuth/scratch/decimal_rules.py  Decimal 的几条规矩,一条一条跑出来
from decimal import ROUND_HALF_EVEN, ROUND_HALF_UP, Decimal, getcontext

CENT = Decimal("0.01")

print("1 有效位数:", getcontext().prec)
x = Decimal("267.00") * 16 / 31
print("2 267×16/31 =", x)
print("3 同一个数不同写法:", Decimal("2.5") == Decimal("2.50"), str(Decimal("2.5")), str(Decimal("2.50")))
half = Decimal("0.125")
print("4 0.125 两种舍入:", half.quantize(CENT, rounding=ROUND_HALF_UP), half.quantize(CENT, rounding=ROUND_HALF_EVEN))
once = (Decimal("39") * 10 / 31).quantize(CENT, rounding=ROUND_HALF_UP)
daily = (Decimal("39") / 31).quantize(CENT, rounding=ROUND_HALF_UP)
print("5 最后舍入一次:", once, " 先算日价再乘:", daily, "×10 =", daily * 10)
print("6 和整数混算:", Decimal("39.00") * 3)
print("7 除不尽:", Decimal(1) / 3 * 3)
print("8 和 float 混算:", Decimal("1.00") + 0.1)  # pyright: ignore[reportOperatorIssue]
```

<div class="line-notes">

- `from decimal import ROUND_HALF_EVEN, ROUND_HALF_UP, Decimal, getcontext` 多拿两样:`ROUND_HALF_EVEN` 是逢五取偶,`getcontext()` 返回当前的「运算环境」,里面记着精度和默认舍入方式。
- `print("1 有效位数:", getcontext().prec)` Decimal 默认保留 28 位**有效数字**(不是 28 位小数)。
- `x = Decimal("267.00") * 16 / 31` Day 677 那个 137.81 的原始值。除不尽,算到 28 位有效数字为止。
- `Decimal("2.5") == Decimal("2.50")` 比较时只看数值,相等;但 `str` 出来一个是 `2.5` 一个是 `2.50`,Decimal 会记住你写了几位小数。这一点对存库很重要:不规整的话,库里会同时出现 `117`、`117.0`、`117.00`。
- `half.quantize(CENT, rounding=ROUND_HALF_UP), half.quantize(CENT, rounding=ROUND_HALF_EVEN)` 0.125 正好在两个分中间:四舍五入得 0.13,逢五取偶得 0.12(2 是偶数)。
- `once = (Decimal("39") * 10 / 31)` 团队版一个席位 39 美元,周期 31 天,折算 10 天。整个分数算完再舍入。
- `daily = (Decimal("39") / 31)` 先算日价舍入到分,再乘 10。Day 678 默写时我就是这么错的。
- `print("6 和整数混算:", Decimal("39.00") * 3)` 和 `int` 混算没问题,结果还是 Decimal,而且保留两位小数。
- `print("7 除不尽:", Decimal(1) / 3 * 3)` 1/3 在 28 位处被截断,再乘回 3 就不是 1 了。Decimal 不是「无限精确」,只是「按十进制精确」,除法照样会有误差,所以舍入只能在最后做一次,中间不要截。
- `Decimal("1.00") + 0.1` 和 float 混算。`# pyright: ignore[...]` 是告诉类型检查器「这一行的红线我知道,是故意的」。

</div>

```bash
uv run python scratch/decimal_rules.py
```

```text
1 有效位数: 28
2 267×16/31 = 137.8064516129032258064516129
3 同一个数不同写法: True 2.5 2.50
4 0.125 两种舍入: 0.13 0.12
5 最后舍入一次: 12.58  先算日价再乘: 1.26 ×10 = 12.60
6 和整数混算: 117.00
7 除不尽: 0.9999999999999999999999999999
Traceback (most recent call last):
  File ".../billsleuth/scratch/decimal_rules.py", line 17, in <module>
    print("8 和 float 混算:", Decimal("1.00") + 0.1)  # pyright: ignore[reportOperatorIssue]
                              ~~~~~~~~~~~~~~~~^~~~~
TypeError: unsupported operand type(s) for +: 'decimal.Decimal' and 'float'
```

第 8 行炸了,这是好事。Decimal 拒绝和 float 做加法,因为它不知道你那个 0.1 到底是想要 0.1,还是想要 0.1000000000000000055511…。在 JS 里 `0.1 + 0.2` 永远不会报错,只会悄悄给你一个 0.30000000000000004;Python 的 Decimal 在这里替你把了一道关。

但它没有把住所有的关。`Decimal(0.1)`(用 float 构造)不报错,Day 677 见过,它会得到一长串。这就是为什么我们还要自己写一道闸。

第 5 行是今天最值得记住的一行:同样是 39 美元折算 10 天,一次舍入得 12.58,先算日价再乘得 12.60,差两分钱。第 7 行解释了为什么不能「每一步都舍入到分」也不能「每一步都不管」:**中间结果保留全部精度,只在最后舍入一次**。

### money.py:三个函数

整个项目的金额只允许经过这一个文件。谁要把一个数变成金额,调 `money()`;谁要折算,调 `prorate()`;谁要给人看,调 `fmt()`。规则改了,只改这里。

```python
# billsleuth/billsleuth/money.py  整个项目的金额只走这里:Decimal、两位小数、四舍五入
from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")
ZERO = Decimal("0.00")


def money(x: Decimal | int | str) -> Decimal:
    """把金额规整成两位小数。故意不收 float。"""
    if isinstance(x, float):
        raise TypeError(f"金额不能用 float: {x!r},请传字符串或 Decimal")
    return Decimal(x).quantize(CENT, rounding=ROUND_HALF_UP)


def prorate(amount: Decimal, days: int, period_days: int) -> Decimal:
    """按天折算:amount × days / period_days,整个分数算完才舍入一次。"""
    if period_days <= 0:
        raise ValueError("period_days 必须大于 0")
    return money(amount * days / period_days)


def fmt(x: Decimal) -> str:
    """给人看的格式:两位小数,不带货币符号。"""
    return f"{money(x):.2f}"
```

<div class="line-notes">

- `CENT = Decimal("0.01")` 舍入的模板,两位小数。
- `ZERO = Decimal("0.00")` 带两位小数的零。求和时用它当起点,结果的小数位才稳定;用整数 `0` 起步,一个空列表求和会得到 `0` 而不是 `0.00`。
- `def money(x: Decimal | int | str) -> Decimal:` 类型标注里故意没有 `float`。basedpyright 看到有人传 float 会画红线,这是第一道闸,在你写代码的时候就拦住。`|` 表示「或」,和 TS 的联合类型一样。
- `if isinstance(x, float):` 第二道闸,在运行时拦住。类型标注只是提示,Python 运行时不检查它,有人绕过类型检查(比如从 JSON 里读出来的数字就是 float)照样能传进来。`isinstance` 相当于 JS 的 `typeof x === 'number'` 加上「是不是小数」的判断。
- `raise TypeError(f"金额不能用 float: {x!r},请传字符串或 Decimal")` 报错信息里说清楚怎么改。`{x!r}` 用 `repr` 显示值,字符串会带引号,能一眼看出传进来的是什么类型。
- `return Decimal(x).quantize(CENT, rounding=ROUND_HALF_UP)` 字符串、整数、Decimal 都能安全地造 Decimal,然后规整成两位小数。`money("2.675")` 得 2.68,而 Day 677 里 `round(2.675, 2)` 得 2.67。
- `def prorate(amount: Decimal, days: int, period_days: int) -> Decimal:` 和 Day 677 草稿里的 `prorate` 一样,参数名改成更通用的 `days`:它可以是剩余天数,也可以是已用天数,由调用方决定。
- `if period_days <= 0:` 周期天数是 0 说明上游把日期算错了,除以 0 之前先报一个能看懂的错。
- `return money(amount * days / period_days)` 整个分数算完,交给 `money()` 舍入一次。`prorate` 自己不碰舍入规则,规则只在 `money()` 里写一遍。
- `return f"{money(x):.2f}"` 先规整再格式化,`:.2f` 保证总是两位小数。`fmt(Decimal("80"))` 得 `"80.00"`。

</div>

### 故意制造一次:脚本找不到包

写个小脚本试一下三个函数,放在 `scratch/` 里:

```python
# billsleuth/scratch/try_money.py  money.py 的三个函数各试一下
from decimal import Decimal

from billsleuth.money import fmt, money, prorate

print(money("58.505"), money(3), money(Decimal("2.675")))
print(prorate(Decimal("267.00"), 16, 31), prorate(Decimal("39"), 10, 31))
print(fmt(Decimal("80")), fmt(Decimal("-4.6400")))
print(money(0.1))  # pyright: ignore[reportArgumentType]
```

<div class="line-notes">

- `from billsleuth.money import fmt, money, prorate` 从里层的 `billsleuth` 包里导入。
- `print(money("58.505"), money(3), money(Decimal("2.675")))` 三种合法输入:字符串、整数、Decimal。
- `prorate(Decimal("267.00"), 16, 31), prorate(Decimal("39"), 10, 31)` 两个熟悉的数:Day 677 的 137.81,上面第 5 行的 12.58。
- `fmt(Decimal("80")), fmt(Decimal("-4.6400"))` 小数位不够的补齐,多了的规整掉。-4.64 是 Day 677 里 2 月少收的那个数。
- `print(money(0.1))` 最后一行故意传 float,看第二道闸。

</div>

在仓库根目录照 Day 679 的习惯直接跑:

```bash
uv run python scratch/try_money.py
```

```text
Traceback (most recent call last):
  File ".../billsleuth/scratch/try_money.py", line 4, in <module>
    from billsleuth.money import fmt, money, prorate
ModuleNotFoundError: No module named 'billsleuth'
```

`billsleuth` 明明就在旁边,为什么找不到?Day 678「准备环境」讲过:`python 某个脚本.py` 只把**脚本所在的目录**(这里是 `scratch/`)加进搜索路径,不加当前目录。`scratch/` 里没有 `billsleuth`,自然找不到。前两天的草稿脚本没出这个问题,是因为它们只 import 标准库和同目录的文件。

修法是用 `-m` 按模块名运行。`python -m scratch.try_money` 会把**当前目录**加进搜索路径,再去找 `scratch/try_money.py`。这和课程练习仓库里 `uv run python -m partNN.xxx` 的跑法是同一个道理:

```bash
uv run python -m scratch.try_money
```

<div class="line-notes">

- `uv run python -m scratch.try_money` 模块名用点分隔、不带 `.py`。`scratch/` 没有 `__init__.py` 也能这么跑,Python 把它当成「命名空间包」。以后凡是 import 了 `billsleuth` 的草稿脚本,都在仓库根目录用 `-m` 跑。

</div>

```text
Traceback (most recent call last):
  File "<frozen runpy>", line 198, in _run_module_as_main
  File "<frozen runpy>", line 88, in _run_code
  File ".../billsleuth/scratch/try_money.py", line 9, in <module>
    print(money(0.1))  # pyright: ignore[reportArgumentType]
          ^^^^^^^^^^
  File ".../billsleuth/billsleuth/money.py", line 11, in money
    raise TypeError(f"金额不能用 float: {x!r},请传字符串或 Decimal")
TypeError: 金额不能用 float: 0.1,请传字符串或 Decimal
58.51 3.00 2.68
137.81 12.58
80.00 -4.64
```

前三行正常输出被打印在报错后面,是因为报错走的是 stderr、正常输出走 stdout,终端里两路交错显示,顺序不代表执行顺序。看内容:58.505 逢半进一得 58.51;整数 3 变成 3.00;137.81、12.58 和前面一致;80 补成 80.00,-4.6400 规整成 -4.64;最后 `money(0.1)` 被第二道闸拦下,报错信息告诉你该怎么改。

### 用 pytest 把规则钉死

规则写在代码里还不够。三个月后有人觉得「银行家舍入更专业」顺手改了,谁来发现?答案是测试:改了规则,测试先红。

```python
# billsleuth/tests/test_money.py  把金额规则钉死:改了规则,这里先红
from decimal import Decimal

import pytest

from billsleuth.money import ZERO, fmt, money, prorate


def test_money_rounds_half_up():
    assert money("58.505") == Decimal("58.51")
    assert money("0.125") == Decimal("0.13")


def test_money_rejects_float():
    with pytest.raises(TypeError):
        money(0.1)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("full", "days", "period", "want"),
    [
        ("117.00", 15, 30, "58.50"),  # Day 677 6 月升级,退团队版
        ("267.00", 16, 31, "137.81"),  # 7 月升级,收商业版
        ("117.00", 16, 31, "60.39"),
        ("39", 10, 31, "12.58"),  # 先算日价会得到 12.60
        ("99.99", 5, 30, "16.67"),  # 正好落在半分上,round() 会给 16.66
        ("117.00", 0, 30, "0.00"),
    ],
)
def test_prorate_rounds_once(full, days, period, want):
    assert prorate(Decimal(full), days, period) == Decimal(want)


def test_prorate_rejects_empty_period():
    with pytest.raises(ValueError):
        prorate(Decimal("117.00"), 0, 0)


def test_fmt_always_two_places():
    assert fmt(Decimal("80")) == "80.00"
    assert fmt(ZERO - Decimal("4.6400")) == "-4.64"
```

<div class="line-notes">

- `from billsleuth.money import ZERO, fmt, money, prorate` 测试文件在 `tests/` 里,靠 `pyproject.toml` 的 `pythonpath = ["."]` 找到包。
- `assert money("58.505") == Decimal("58.51")` 正好在半分上的数,四舍五入进位。换成逢五取偶会得到 58.50(0 是偶数),这一条就会红。
- `assert money("0.125") == Decimal("0.13")` 第二个半分的例子,逢五取偶会得到 0.12。
- `with pytest.raises(TypeError):` 断言下面这一句**必须**抛 `TypeError`,不抛就算失败,[Day 72](/blog/agent-zero/day-072-pytest-2/) 讲过。相当于 jest 的 `expect(() => ...).toThrow(TypeError)`。
- `money(0.1)  # type: ignore[arg-type]` 故意传错类型,让类型检查器别管这一行。
- `@pytest.mark.parametrize(` 一张表跑六条用例,[Day 73](/blog/agent-zero/day-073-pytest-3/) 讲过,相当于 jest 的 `test.each`。
- `("117.00", 15, 30, "58.50"),  # Day 677 6 月升级,退团队版` 每条数据都来自前几天手算过的例子,不是拿 `prorate` 跑出来抄的。Day 678 小项目里强调过:期望值不能从被测代码里来。
- `("39", 10, 31, "12.58"),  # 先算日价会得到 12.60` 专门钉「只舍入一次」这条规则。
- `("99.99", 5, 30, "16.67"),  # 正好落在半分上,round() 会给 16.66` 99.99 × 5 / 30 = 16.665,Day 678 练习 4 找到的那个半分。
- `("117.00", 0, 30, "0.00"),` 边界:剩 0 天,折算 0。
- `prorate(Decimal("117.00"), 0, 0)` 周期 0 天必须报 `ValueError`,而不是 Python 自带的除零错误。
- `assert fmt(ZERO - Decimal("4.6400")) == "-4.64"` 负数也要格式化对,发票上的退还行都是负数。

</div>

```bash
uv run pytest tests/test_money.py -v
```

```text
tests/test_money.py::test_money_rounds_half_up PASSED                    [ 10%]
tests/test_money.py::test_money_rejects_float PASSED                     [ 20%]
tests/test_money.py::test_prorate_rounds_once[117.00-15-30-58.50] PASSED [ 30%]
tests/test_money.py::test_prorate_rounds_once[267.00-16-31-137.81] PASSED [ 40%]
tests/test_money.py::test_prorate_rounds_once[117.00-16-31-60.39] PASSED [ 50%]
tests/test_money.py::test_prorate_rounds_once[39-10-31-12.58] PASSED     [ 60%]
tests/test_money.py::test_prorate_rounds_once[99.99-5-30-16.67] PASSED   [ 70%]
tests/test_money.py::test_prorate_rounds_once[117.00-0-30-0.00] PASSED   [ 80%]
tests/test_money.py::test_prorate_rejects_empty_period PASSED            [ 90%]
tests/test_money.py::test_fmt_always_two_places PASSED                   [100%]

============================== 10 passed in 0.11s ==============================
```

parametrize 把一张六行的表展开成六条测试,方括号里是每条的参数,失败时一眼能看出是哪组数据。

现在扮演那个「觉得银行家舍入更专业」的同事,把 `money.py` 里的 `ROUND_HALF_UP` 两处都换成 `ROUND_HALF_EVEN`,再跑:

```text
>       assert money("58.505") == Decimal("58.51")
E       AssertionError: assert Decimal('58.50') == Decimal('58.51')
>       assert prorate(Decimal(full), days, period) == Decimal(want)
E       AssertionError: assert Decimal('16.66') == Decimal('16.67')
FAILED tests/test_money.py::test_money_rounds_half_up - AssertionError: asser...
FAILED tests/test_money.py::test_prorate_rounds_once[99.99-5-30-16.67] - Asse...
2 failed, 8 passed in 0.13s
```

(我只截了关键几行。)两条红了,而且红得很具体:58.505 变成 58.50,16.665 变成 16.66。注意其他四组折算数据都还是绿的,它们没有落在半分上,两种舍入结果一样。如果测试表里没有特意放半分的数据,这个改动会悄无声息地合进去。改回 `ROUND_HALF_UP`,10 条全绿。

银行家舍入本身不是错,有些财务系统就用它,它的好处是大量数据求和时舍入误差不会单向累积。关键是**整个系统只用一种,写在一个地方,用测试钉住**。BillSleuth 选四舍五入,因为客户和客服手算时用的都是它,解释起来最省事。

## 概念二:事件是事实,订阅表是快照

### 金额存 REAL 还是 TEXT

[Day 85](/blog/agent-zero/day-085-sql-1/) 讲过 SQLite 的几种列类型。存小数,第一反应是 `REAL`。先看一下会发生什么:

```python
# billsleuth/scratch/real_vs_text.py  金额存 REAL 还是 TEXT,SUM 交给谁
import sqlite3
from decimal import Decimal

conn = sqlite3.connect(":memory:")
conn.execute("CREATE TABLE a (amount REAL)")
conn.execute("CREATE TABLE b (amount TEXT)")
for v in ["0.1", "0.2"]:
    conn.execute("INSERT INTO a VALUES (?)", (float(v),))
    conn.execute("INSERT INTO b VALUES (?)", (v,))

print("REAL 列 SUM   :", conn.execute("SELECT SUM(amount) FROM a").fetchone()[0])
print("TEXT 列 SUM   :", conn.execute("SELECT SUM(amount) FROM b").fetchone()[0])
rows = conn.execute("SELECT amount FROM b").fetchall()
print("TEXT 读回 Python 再加:", sum((Decimal(r[0]) for r in rows), Decimal("0")))
print("TEXT 列读回来的类型:", type(rows[0][0]).__name__, repr(rows[0][0]))
```

<div class="line-notes">

- `conn = sqlite3.connect(":memory:")` 内存数据库,脚本结束就没了,适合做实验。
- `conn.execute("CREATE TABLE a (amount REAL)")` 表 a 用 REAL 存金额。SQLite 的 REAL 就是 8 字节浮点数,和 JS 的 `number`、Python 的 `float` 是同一种东西。
- `conn.execute("CREATE TABLE b (amount TEXT)")` 表 b 用 TEXT 存字符串。
- `conn.execute("INSERT INTO a VALUES (?)", (float(v),))` 存 0.1 和 0.2 两个浮点数。`(x,)` 是只有一个元素的元组,逗号不能省,[Day 92](/blog/agent-zero/day-092-python-sqlite-1/) 讲过参数化查询。
- `conn.execute("INSERT INTO b VALUES (?)", (v,))` 存字符串 `"0.1"` 和 `"0.2"`。
- `print("TEXT 列 SUM   :"` 对 TEXT 列也用 SQL 求和,看看会怎样。
- `sum((Decimal(r[0]) for r in rows), Decimal("0"))` 读回 Python,每个转成 Decimal 再加。`sum` 的第二个参数是起始值,默认是整数 0,这里换成 Decimal。
- `type(rows[0][0]).__name__, repr(rows[0][0])` 看看 TEXT 列读回来是什么类型。

</div>

```bash
uv run python scratch/real_vs_text.py
```

```text
REAL 列 SUM   : 0.30000000000000004
TEXT 列 SUM   : 0.30000000000000004
TEXT 读回 Python 再加: 0.3
TEXT 列读回来的类型: str '0.1'
```

第一行在意料之中。第二行是我第一次跑时没想到的:**TEXT 列用 SQL 的 SUM,结果还是浮点数**。SQLite 的 `SUM` 会先把文本转成数字再加,转的就是浮点数,存成 TEXT 只保住了「存」,保不住「算」。

所以 BillSleuth 定两条规矩:**金额存 TEXT,读回 Python 用 Decimal 算**,SQL 只负责查,不负责算钱。读回来的是 `str`,和你存进去的字符串一模一样,`Decimal("0.1")` 就是精确的 0.1。练习 1 会在真正的发票行表上再验证一次。

另一种常见做法是存整数分(117.00 美元存 11700),SQL 的 SUM 对整数是精确的。它也完全可以,Stripe 的 API 就用整数的最小货币单位表示金额。我们选 TEXT 加 Decimal,是因为折算会产生「分以下」的中间值,用 Decimal 算更自然,而且库里看到的数和发票上印的一样,调试时不用心算除以 100。

### 十张表

表名和字段在规划里已经定了,后面十几天的工具、引擎、评测都按这个名字写,定下来就不改。新增的地方我会在注释里标「新增」。

```sql
-- billsleuth/billsleuth/schema.sql
-- 金额一律存 TEXT(Decimal 的字符串),不用 REAL。日期存 ISO 字符串,事件时间统一存 UTC。
CREATE TABLE customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    country TEXT NOT NULL,          -- CN / SG / DE / US,同时决定按哪个时区取本地日期
    currency TEXT NOT NULL,         -- 国际版统一 USD
    tax_region TEXT NOT NULL        -- 用来查 tax_rates.region
);
CREATE TABLE plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    interval TEXT NOT NULL CHECK (interval IN ('month', 'year')),
    unit_price TEXT NOT NULL        -- 每席位每个周期的价格
);
CREATE TABLE coupons (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('percent', 'amount')),
    value TEXT NOT NULL,            -- percent: 20 表示 20%;amount: 10.00 表示减 10 美元
    duration_months INTEGER NOT NULL
);
CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    plan_id TEXT NOT NULL REFERENCES plans(id),   -- 当前套餐(快照)
    quantity INTEGER NOT NULL,                    -- 当前席位数(快照)
    status TEXT NOT NULL,                         -- active / canceled / paused
    start_date TEXT NOT NULL,
    current_period_start TEXT NOT NULL,
    current_period_end TEXT NOT NULL,             -- 不含当天
    billing_anchor_day INTEGER NOT NULL CHECK (billing_anchor_day BETWEEN 1 AND 28),
    coupon_id TEXT REFERENCES coupons(id)         -- 新增列:订阅绑定的优惠券,可为空
);
CREATE TABLE subscription_events (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
    type TEXT NOT NULL CHECK (type IN ('create', 'upgrade', 'downgrade', 'quantity_change', 'cancel', 'pause', 'resume')),
    effective_at TEXT NOT NULL,     -- UTC 时间,如 2026-06-19T16:30:00+00:00
    payload_json TEXT NOT NULL      -- 如 {"plan_id": "business", "quantity": 3}
);
CREATE TABLE invoices (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,       -- 不含当天
    issued_at TEXT NOT NULL,
    status TEXT NOT NULL,           -- paid / open / void
    subtotal TEXT NOT NULL,
    discount TEXT NOT NULL,
    tax TEXT NOT NULL,
    total TEXT NOT NULL,
    currency TEXT NOT NULL
);
CREATE TABLE invoice_lines (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    kind TEXT NOT NULL CHECK (kind IN ('recurring', 'proration', 'discount', 'tax', 'adjustment')),
    description TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_amount TEXT NOT NULL,
    amount TEXT NOT NULL,
    period_start TEXT,
    period_end TEXT,
    tax_code TEXT
);
CREATE TABLE payments (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    amount TEXT NOT NULL,
    status TEXT NOT NULL,           -- succeeded / failed / refunded
    attempted_at TEXT NOT NULL,
    gateway_ref TEXT NOT NULL
);
CREATE TABLE credit_notes (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    amount TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'issued'))
);
CREATE TABLE tax_rates (
    code TEXT PRIMARY KEY,
    region TEXT NOT NULL,
    rate TEXT NOT NULL,             -- 0.06 表示 6%
    valid_from TEXT NOT NULL,
    valid_to TEXT                   -- 含当天;NULL 表示至今有效
);
CREATE INDEX idx_inv_customer ON invoices(customer_id, period_start);
CREATE INDEX idx_lines_invoice ON invoice_lines(invoice_id);
CREATE INDEX idx_pay_invoice ON payments(invoice_id);
CREATE INDEX idx_events_sub ON subscription_events(subscription_id, effective_at);
```

<div class="line-notes">

- `-- 金额一律存 TEXT` 文件开头先把两条全局约定写清楚,读表的人第一眼就看到。
- `country TEXT NOT NULL,          -- CN / SG / DE / US` 国家同时决定时区,Day 677 练习 2 那个凌晨 0:30 的 bug 就要靠它把 UTC 时间换回客户本地日期。
- `tax_region TEXT NOT NULL` 税务地区单独一列,不直接用 country。真实世界里同一个国家不同地区税率可以不同,`wrong_tax_region` 这类根因就是这一列和税率表对不上。
- `interval TEXT NOT NULL CHECK (interval IN ('month', 'year')),` CHECK 约束:只能是这两个值之一,写别的数据库直接拒绝。相当于 TS 的 `interval: 'month' | 'year'`,只是由数据库来执行。[Day 91](/blog/agent-zero/day-091-sql-6/) 讲过约束。
- `unit_price TEXT NOT NULL        -- 每席位每个周期的价格` 团队版 `39.00`、商业版 `89.00`,TEXT 存。
- `value TEXT NOT NULL,            -- percent: 20 表示 20%` 和 Day 679 `coupon_tax.py` 里的 `percent_off = Decimal("20")` 是同一个约定。
- `duration_months INTEGER NOT NULL` 「前 3 个月八折」的 3。席位数、月数这类天然是整数的量用 INTEGER,只有金额和税率用 TEXT。
- `customer_id TEXT NOT NULL REFERENCES customers(id),` 外键:这一列的值必须是 `customers` 表里存在的 id。注意 SQLite 默认**不检查**外键,下面 `db.py` 会打开它。
- `plan_id TEXT NOT NULL REFERENCES plans(id),   -- 当前套餐(快照)` 订阅表里的套餐和席位数都是「现在」的值,所以标成快照。为什么要强调,下一节讲。
- `current_period_end TEXT NOT NULL,             -- 不含当天` 左闭右开,Day 677 的约定写进表注释。
- `billing_anchor_day INTEGER NOT NULL CHECK (billing_anchor_day BETWEEN 1 AND 28),` Day 677 决定锚点日只能是 1 到 28,今天让数据库来守这条规则。
- `coupon_id TEXT REFERENCES coupons(id)         -- 新增列` 规划里的 coupons 表只有券本身,没说券绑在哪个订阅上,我加了这一列。没有 `NOT NULL`,大多数订阅没有券。
- `type TEXT NOT NULL CHECK (type IN ('create', 'upgrade'` 七种事件类型,写死成一个封闭的列表。注意开通也是一种事件(`create`),这是下一节的关键。
- `effective_at TEXT NOT NULL,     -- UTC 时间` 事件时间统一存 UTC,原因在后面「事件时间为什么存 UTC」。
- `payload_json TEXT NOT NULL      -- 如 {"plan_id": "business", "quantity": 3}` 事件的内容存成 JSON 字符串。不同类型的事件字段不同(升级带套餐,改席位只带数量),用一列 JSON 比给每种事件建一张表简单得多。
- `period_end TEXT NOT NULL,       -- 不含当天` 发票的周期也是左闭右开。
- `status TEXT NOT NULL,           -- paid / open / void` void 是「作废」,作废的发票要留着,不能删,这是会计凭证。
- `subtotal TEXT NOT NULL,` 小计、折扣、税、合计四个汇总数都存下来,而不是每次从行项目加。这样「汇总数和行项目对不上」本身就可以成为一类能被查出来的故障。
- `kind TEXT NOT NULL CHECK (kind IN ('recurring', 'proration', 'discount', 'tax', 'adjustment')),` 发票行的五种类型。Day 677 练习 4 里那个 `credit / charge / recurring` 的区分,在正式表里变成 `proration`(折算,正负都有)和 `recurring`(整月订阅费)。
- `period_start TEXT,` 行项目的周期可以为空:税行、折扣行不对应某个时间段。
- `gateway_ref TEXT NOT NULL` 支付网关返回的流水号。`duplicate_charge`(重复扣款)这类根因就是同一张发票有两条成功的 payment,流水号不同。
- `status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'issued'))` 贷记单的三种状态。Agent 唯一能写的就是 `draft`,Day 690 会把它做成状态机。
- `rate TEXT NOT NULL,             -- 0.06 表示 6%` 税率也是 TEXT,它要参与金额计算,不能是浮点数。
- `valid_to TEXT                   -- 含当天;NULL 表示至今有效` 注意这里和周期**相反**,是含当天的。税率表通常这么写(「有效期至 6 月 30 日」),我们照着习惯来,但在注释里写清楚,引擎查税率时要小心。
- `CREATE INDEX idx_inv_customer ON invoices(customer_id, period_start);` 按客户查发票、按周期排序是最常见的查询,[Day 89](/blog/agent-zero/day-089-sql-5/) 讲过索引。
- `CREATE INDEX idx_events_sub ON subscription_events(subscription_id, effective_at);` 回放事件时按订阅取、按时间排,下面的 `state_at` 用的就是这个顺序。

</div>

### db.py:连接、建表、外键

```python
# billsleuth/billsleuth/db.py  SQLite 连接:库路径、Decimal 自动转字符串、外键检查、建表
import os
import sqlite3
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = Path(__file__).with_name("schema.sql")

sqlite3.register_adapter(Decimal, str)  # 写库时 Decimal 自动变成字符串


def db_path() -> Path:
    return Path(os.environ.get("BILLSLEUTH_DB", ROOT / "billing.db"))


def connect(path: Path | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(path or db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")  # 新增:SQLite 默认不检查外键
    return conn


def init_db(path: Path | None = None) -> sqlite3.Connection:
    p = path or db_path()
    p.unlink(missing_ok=True)
    conn = connect(p)
    conn.executescript(SCHEMA.read_text(encoding="utf-8"))
    return conn


if __name__ == "__main__":
    c = init_db()
    names = [r["name"] for r in c.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")]
    print(f"{db_path().name}:{len(names)} 张表 {names}")
```

<div class="line-notes">

- `ROOT = Path(__file__).resolve().parent.parent` `db.py` 在 `billsleuth/billsleuth/` 里,上两级是仓库根,`billing.db` 默认放这里。
- `SCHEMA = Path(__file__).with_name("schema.sql")` 和 `db.py` 同目录的 `schema.sql`。`with_name` 把文件名换掉、目录不变。
- `sqlite3.register_adapter(Decimal, str)` 告诉 sqlite3 模块:遇到 Decimal 参数,先用 `str()` 转成字符串再存。这样写库时直接传 `Decimal("58.50")`,存进去的是 `'58.50'`,不用每次手动转。不注册的话,sqlite3 不认识 Decimal,实测报 `ProgrammingError: Error binding parameter 1: type 'decimal.Decimal' is not supported`。
- `return Path(os.environ.get("BILLSLEUTH_DB", ROOT / "billing.db"))` 库路径可以用环境变量改。Day 693 评测时每个场景用自己的一份库副本,就靠这个变量切换。
- `conn.row_factory = sqlite3.Row` 查询结果可以按列名取值,`row["amount"]`,[Day 93](/blog/agent-zero/day-093-python-sqlite-2/) 讲过。
- `conn.execute("PRAGMA foreign_keys = ON")  # 新增:SQLite 默认不检查外键` 这一行是规划之外新增的,也是今天最容易忘的一行。SQLite 为了兼容老版本,外键约束默认不生效,每个连接都要自己打开。下面马上演示不开会怎样。
- `p.unlink(missing_ok=True)` 建库前先删掉旧文件,保证每次都是干净的。`missing_ok=True` 文件不存在也不报错。这个函数会清空数据,只在造数和测试时调用。
- `conn.executescript(SCHEMA.read_text(encoding="utf-8"))` `executescript` 一次执行多条 SQL,用分号分隔。普通的 `execute` 只能执行一条。
- `if __name__ == "__main__":` 直接运行 `db.py` 时建一个空库并列出表名,被 import 时不执行。
- `c.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")` `sqlite_master` 是 SQLite 自带的系统表,记录着库里所有的表和索引,相当于数据库的目录。

</div>

```bash
uv run python -m billsleuth.db
```

```text
billing.db:10 张表 ['coupons', 'credit_notes', 'customers', 'invoice_lines', 'invoices', 'payments', 'plans', 'subscription_events', 'subscriptions', 'tax_rates']
```

十张表,和规划一致。

### 让数据库替我们拦住脏数据

约束写在表上,好处是不管谁往库里写(造数脚本、测试、以后的工具),都绕不过去。试两类脏数据:锚点日 31 号的订阅,和指向不存在客户的发票。

```python
# billsleuth/scratch/constraints.py  让数据库替我们拦住两类脏数据
import sqlite3
from pathlib import Path

from billsleuth.db import init_db

conn = init_db(Path("scratch/constraints.db"))
conn.execute("INSERT INTO customers VALUES ('C001', '青禾记账工作室', 'CN', 'USD', 'CN')")
conn.execute("INSERT INTO plans VALUES ('team', '团队版', 'month', '39.00')")

try:
    conn.execute(
        "INSERT INTO subscriptions VALUES ('SUB1', 'C001', 'team', 3, 'active', '2026-01-31',"
        " '2026-01-31', '2026-02-28', 31, NULL)"
    )
except sqlite3.IntegrityError as e:
    print("锚点日 31:", e)

try:
    conn.execute(
        "INSERT INTO invoices VALUES ('INV-X', 'C999', 'SUB-NOPE', '2026-06-05', '2026-07-05',"
        " '2026-06-05', 'paid', '117.00', '0.00', '0.00', '117.00', 'USD')"
    )
except sqlite3.IntegrityError as e:
    print("不存在的客户:", e)

conn.commit()
raw = sqlite3.connect("scratch/constraints.db")  # 不经过 db.connect,也就没开外键检查
raw.execute(
    "INSERT INTO invoices VALUES ('INV-X', 'C999', 'SUB-NOPE', '2026-06-05', '2026-07-05',"
    " '2026-06-05', 'paid', '117.00', '0.00', '0.00', '117.00', 'USD')"
)
print("直接 sqlite3.connect 时:", raw.execute("SELECT COUNT(*) FROM invoices").fetchone()[0], "张发票指向不存在的客户")
```

<div class="line-notes">

- `conn = init_db(Path("scratch/constraints.db"))` 用一个单独的练习库,不碰 `billing.db`。路径相对于当前目录,所以要在仓库根目录运行。
- `conn.execute("INSERT INTO customers VALUES ('C001', '青禾记账工作室', 'CN', 'USD', 'CN')")` 一个虚构客户。按列的顺序给值:id、名字、国家、币种、税务地区。
- `" '2026-01-31', '2026-02-28', 31, NULL)"` 1 月 31 日开通、锚点日 31,Day 677 里 `date(2027, 2, 31)` 报错的那种客户。
- `except sqlite3.IntegrityError as e:` 违反约束时 sqlite3 抛 `IntegrityError`,[Day 91](/blog/agent-zero/day-091-sql-6/) 见过。
- `"INSERT INTO invoices VALUES ('INV-X', 'C999', 'SUB-NOPE'` 客户 C999 和订阅 SUB-NOPE 都不存在。
- `conn.commit()` 把前面合法的两行提交掉,下面换一个连接打开同一个文件。
- `raw = sqlite3.connect("scratch/constraints.db")` 不经过我们的 `connect()`,就没有那句 `PRAGMA foreign_keys = ON`。
- `raw.execute("SELECT COUNT(*) FROM invoices")` 数一下发票表里有几行。

</div>

```bash
uv run python -m scratch.constraints
```

```text
锚点日 31: CHECK constraint failed: billing_anchor_day BETWEEN 1 AND 28
不存在的客户: FOREIGN KEY constraint failed
直接 sqlite3.connect 时: 1 张发票指向不存在的客户
```

前两行是我们想要的,报错信息直接告诉你违反了哪条规则。第三行是坑:同一个库文件,换一个没开外键检查的连接,一张指向不存在客户的发票就写进去了。**外键约束写在表上,但开关在连接上**。所以项目里所有地方都必须通过 `db.connect()` 拿连接,不许自己 `sqlite3.connect`。练习 3 还会看到另一个更隐蔽的情况:开关开了,但开晚了。

### 订阅表只知道「现在」

现在讲今天的第二个概念。看 `subscriptions` 表:它存的是当前套餐、当前席位数。Day 677 那个客户 6 月 20 日从团队版升到了商业版,今天去查订阅表,看到的是「商业版 3 席」。

那么问题来了:客户问「6 月那张发票该收多少」,6 月 5 日开票时他是什么套餐?订阅表回答不了,它只记得现在。就像一个只有 `useState` 当前值、没有历史记录的组件:你知道它现在是什么,不知道它是怎么变成这样的。

所以 BillSleuth 的设计是:**`subscription_events` 才是事实,`subscriptions` 只是快照**。每一次变化(包括开通本身)都记成一条事件,要知道任意时刻的状态,就从第一条事件开始按时间顺序一条条叠上去。[Day 535](/blog/agent-zero/day-535-durable-1/) 讲持久化执行时见过这个想法,叫事件溯源(event sourcing):状态是事件折叠出来的,和 Redux 里 `state = events.reduce(reducer, initial)` 是一回事。计费里它尤其重要,因为**争议几乎都是关于过去的**。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="订阅事件时间线:6/5 create 团队版 3 席,6/19 16:30 UTC upgrade 商业版 3 席;订阅表只存最新快照;任意时刻的状态由该时刻之前的事件叠加得到">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="20" y="26" font-size="12" fill="var(--ink)">subscription_events(事实,只追加)</text>
    <line x1="40" y1="70" x2="600" y2="70" stroke="var(--rule)"/>
    <circle cx="80" cy="70" r="5" fill="var(--compute)"/>
    <text x="60" y="56" fill="var(--compute)">E1 create</text>
    <text x="40" y="92" fill="var(--ink-soft)">6/5 02:00 UTC</text>
    <text x="40" y="108" fill="var(--ink-soft)">团队版 × 3</text>
    <circle cx="330" cy="70" r="5" fill="var(--compute)"/>
    <text x="305" y="56" fill="var(--compute)">E2 upgrade</text>
    <text x="280" y="92" fill="var(--ink-soft)">6/19 16:30 UTC</text>
    <text x="280" y="108" fill="var(--ink-soft)">(上海 6/20 00:30)</text>
    <text x="280" y="124" fill="var(--ink-soft)">商业版 × 3</text>
    <line x1="200" y1="62" x2="200" y2="140" stroke="var(--mem)" stroke-dasharray="3 3"/>
    <text x="150" y="152" fill="var(--mem)">问 6/10 时?</text>
    <text x="150" y="168" fill="var(--mem)">叠 E1 → 团队版</text>
    <line x1="520" y1="62" x2="520" y2="140" stroke="var(--mem)" stroke-dasharray="3 3"/>
    <text x="470" y="152" fill="var(--mem)">问 7/10 时?</text>
    <text x="470" y="168" fill="var(--mem)">叠 E1+E2 → 商业版</text>
    <rect x="20" y="190" width="600" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="32" y="210" fill="var(--ink)">subscriptions(快照):plan_id = business, quantity = 3</text>
    <text x="32" y="226" fill="var(--ink-faint)">只回答「现在」,6 月那张发票该收多少它答不了</text>
  </g>
</svg>
<figcaption>事件只追加、不修改;任何时刻的状态都能从事件重新算出来。订阅表是为了查询方便存的一份最新结果,和事件对不上时以事件为准。</figcaption>
</figure>

写成代码:

```python
# billsleuth/scratch/events_demo.py  订阅表只知道「现在」,过去要从事件里回放
import json
import sqlite3
from pathlib import Path

from billsleuth.db import init_db

conn = init_db(Path("scratch/events.db"))
conn.execute("INSERT INTO customers VALUES ('C001', '青禾记账工作室', 'CN', 'USD', 'CN')")
conn.executemany("INSERT INTO plans VALUES (?, ?, 'month', ?)", [("team", "团队版", "39.00"), ("business", "商业版", "89.00")])
# 快照:当前是商业版 3 席
conn.execute(
    "INSERT INTO subscriptions VALUES ('SUB1', 'C001', 'business', 3, 'active', '2026-06-05',"
    " '2026-07-05', '2026-08-05', 5, NULL)"
)
# 事实:两条事件,时间都存 UTC。上海 6/20 00:30 点的升级,UTC 是 6/19 16:30
conn.executemany(
    "INSERT INTO subscription_events VALUES (?, 'SUB1', ?, ?, ?)",
    [
        ("E1", "create", "2026-06-05T02:00:00+00:00", json.dumps({"plan_id": "team", "quantity": 3})),
        ("E2", "upgrade", "2026-06-19T16:30:00+00:00", json.dumps({"plan_id": "business", "quantity": 3})),
    ],
)


def state_at(conn: sqlite3.Connection, sub_id: str, at_utc: str) -> dict:
    """把 at_utc 之前(含)的事件按时间顺序一条条叠起来,得到那一刻的订阅状态。"""
    state: dict = {}
    for row in conn.execute(
        "SELECT type, payload_json FROM subscription_events"
        " WHERE subscription_id = ? AND effective_at <= ? ORDER BY effective_at",
        (sub_id, at_utc),
    ):
        state.update(json.loads(row["payload_json"]))  # 后来的事件覆盖前面的同名字段
        state["by"] = row["type"]
    return state


snap = conn.execute("SELECT plan_id, quantity FROM subscriptions WHERE id = 'SUB1'").fetchone()
print("订阅表快照:", dict(snap))
for at in ["2026-06-10T00:00:00+00:00", "2026-06-19T16:29:59+00:00", "2026-06-19T16:30:00+00:00", "2026-07-10T00:00:00+00:00"]:
    print(f"{at} 时的状态:", state_at(conn, "SUB1", at))
conn.commit()
```

<div class="line-notes">

- `conn.executemany("INSERT INTO plans VALUES (?, ?, 'month', ?)"` `executemany` 用同一条 SQL 插入多行,每个元组一行。团队版 39、商业版 89,和 Day 677 一致。
- `"INSERT INTO subscriptions VALUES ('SUB1', 'C001', 'business', 3` 快照写的是现在的状态:商业版 3 席,当前周期 7/5 到 8/5,锚点日 5。
- `("E1", "create", "2026-06-05T02:00:00+00:00"` 开通事件。上海时间 6 月 5 日上午 10 点,UTC 是凌晨 2 点。payload 用 `json.dumps(...)` 把字典 `{"plan_id": "team", "quantity": 3}` 转成 JSON 字符串存进 TEXT 列,相当于 JS 的 `JSON.stringify`。
- `("E2", "upgrade", "2026-06-19T16:30:00+00:00"` Day 677 练习 2 那次升级:上海 6 月 20 日 0:30,换成 UTC 是 6 月 19 日 16:30。存的是 UTC。
- `def state_at(conn: sqlite3.Connection, sub_id: str, at_utc: str) -> dict:` 「在 at_utc 这一刻,订阅是什么样」。
- `" WHERE subscription_id = ? AND effective_at <= ? ORDER BY effective_at",` 取那一刻之前(含)的全部事件,按时间排好。这里直接拿字符串比大小,为什么可以,下一节讲。
- `state.update(json.loads(row["payload_json"]))` 把每条事件的字段盖到 state 上,后来的覆盖前面的。`update` 相当于 JS 的 `Object.assign(state, payload)`,整个循环就是一个 reduce。
- `state["by"] = row["type"]` 顺便记下最后一条生效的是哪种事件,调试时有用。
- `snap = conn.execute("SELECT plan_id, quantity FROM subscriptions WHERE id = 'SUB1'").fetchone()` 读快照做对照。
- `for at in ["2026-06-10T00:00:00+00:00", "2026-06-19T16:29:59+00:00", "2026-06-19T16:30:00+00:00"` 四个时刻:升级前、升级前一秒、升级那一秒、升级后。中间两个专门测边界。

</div>

```bash
uv run python -m scratch.events_demo
```

```text
订阅表快照: {'plan_id': 'business', 'quantity': 3}
2026-06-10T00:00:00+00:00 时的状态: {'plan_id': 'team', 'quantity': 3, 'by': 'create'}
2026-06-19T16:29:59+00:00 时的状态: {'plan_id': 'team', 'quantity': 3, 'by': 'create'}
2026-06-19T16:30:00+00:00 时的状态: {'plan_id': 'business', 'quantity': 3, 'by': 'upgrade'}
2026-07-10T00:00:00+00:00 时的状态: {'plan_id': 'business', 'quantity': 3, 'by': 'upgrade'}
```

快照只能告诉你「商业版」。事件能告诉你 6 月 10 日还是团队版,升级前一秒还是团队版,升级那一秒起变成商业版。明天的参考引擎就靠这个回放:给每个计费周期找出当时的套餐和席位,再算应收。**引擎只读事件,不读订阅表的当前值**。

我第一版的 `state_at` 只取了「最后一条事件的 payload」,这个例子里也能跑对,因为两条事件都带了完整的套餐和席位。但改席位的事件只带 `{"quantity": 5}`,只取最后一条就会把套餐丢掉。所以要从头叠,练习 4 会加一条改席位事件验证。

### 事件时间为什么存 UTC

上面的 `state_at` 直接用 `effective_at <= ?` 比较两个字符串。这能行,是因为两边都是同一种格式、同一个时区:`2026-06-19T16:30:00+00:00` 这样的 ISO 字符串,按字典序比和按时间比结果一样,就像 `"2026-06-19" < "2026-06-20"` 一样。

如果有人图省事,按客户本地时间存了事件,会怎样:

```python
# billsleuth/scratch/offset_bug.py  事件时间要是存成本地时区,字符串比较就错了
from datetime import datetime
from zoneinfo import ZoneInfo

stored_local = "2026-06-20T00:30:00+08:00"  # 有人按客户本地时间存了升级事件
query = "2026-06-19T20:00:00+00:00"  # 问:UTC 6/19 20:00(上海 6/20 04:00)时升级了没有

print("字符串比较:", stored_local <= query)
print("按时间比较:", datetime.fromisoformat(stored_local) <= datetime.fromisoformat(query))
utc = datetime.fromisoformat(stored_local).astimezone(ZoneInfo("UTC")).isoformat()
print("换成 UTC 再存:", utc, " 字符串比较:", utc <= query)
```

<div class="line-notes">

- `stored_local = "2026-06-20T00:30:00+08:00"` 同一次升级,存成了上海本地时间,带 `+08:00`。它和 `2026-06-19T16:30:00+00:00` 是**同一个时刻**。
- `query = "2026-06-19T20:00:00+00:00"` 问一个升级之后的时刻:UTC 20 点,上海已经是 6 月 20 日凌晨 4 点。正确答案是「已经升级了」。
- `print("字符串比较:", stored_local <= query)` 按字符逐个比:前面 `2026-06-` 一样,接着 `2` 和 `1` 比,`"20" > "19"`,所以判成「升级在查询时刻之后」。
- `datetime.fromisoformat(stored_local) <= datetime.fromisoformat(query)` 解析成带时区的 `datetime` 再比,Python 会按真实时刻比较。
- `datetime.fromisoformat(stored_local).astimezone(ZoneInfo("UTC")).isoformat()` 先换成 UTC,再格式化回字符串。Day 677 练习 2 用过 `astimezone`。

</div>

```bash
uv run python scratch/offset_bug.py
```

```text
字符串比较: False
按时间比较: True
换成 UTC 再存: 2026-06-19T16:30:00+00:00  字符串比较: True
```

字符串比较说「还没升级」,真实答案是「已经升级了」。而 SQL 里的 `effective_at <= ?` 就是字符串比较,SQLite 不会帮你解析时区。规则因此是:**事件时间统一换成 UTC 再存**,所有比较和排序才可靠;要按客户本地日期算账(Day 677 练习 2 的结论)时,在引擎里用 `customers.country` 对应的时区换回本地日期。存储用 UTC,计算用本地,两件事分开。

## 今天的文件

| 零件 | 文件 | 新建还是修改 | 后面哪天用到 |
| --- | --- | --- | --- |
| 包和测试骨架 | `billsleuth/__init__.py`、`pyproject.toml` 的 `[tool.pytest]` | 新建 / 修改 | 全程 |
| 忽略所有库文件 | `.gitignore`(`billing.db` 改成 `*.db`) | 修改 | 全程 |
| 金额三函数 | `billsleuth/money.py` | 新建 | Day 681 引擎,Day 683 工具,Day 688 校验器 |
| 金额测试 | `tests/test_money.py` | 新建 | 每次改规则 |
| 十张表 | `billsleuth/schema.sql` | 新建 | 全程 |
| 连接和建库 | `billsleuth/db.py` | 新建 | Day 682 造数,Day 693 每个场景一份库 |
| 事件回放 | `scratch/events_demo.py` 里的 `state_at` | 草稿 | Day 681 引擎正式实现 |
| 约束测试 | `tests/test_schema.py` | 练习 2 新建 | 每次改表 |
| 草稿 | `scratch/decimal_rules.py`、`try_money.py`、`real_vs_text.py`、`constraints.py`、`offset_bug.py` | 新建 | |

跑法记两种:只用标准库的草稿 `uv run python scratch/xxx.py`;import 了 `billsleuth` 的草稿在仓库根目录 `uv run python -m scratch.xxx`;测试 `uv run pytest`。今天全部不调模型,花费 0 元。

## 动手练习

**练习 1:发票行求和放在哪里做。** 把 Day 677 那张 7 月发票的三行(-58.50、133.50、267.00)存进 `invoice_lines` 表,分别用 SQL 的 `SUM` 和 Python 的 Decimal 求和,比较结果,然后写一个 `money_sum(values)`。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex1_money_sum.py  练习 1:发票行求和放在 Python 里做
from decimal import Decimal
from pathlib import Path

from billsleuth.db import init_db
from billsleuth.money import ZERO, money

conn = init_db(Path("scratch/ex1.db"))
conn.execute("INSERT INTO customers VALUES ('C001', '青禾记账工作室', 'CN', 'USD', 'CN')")
conn.execute("INSERT INTO plans VALUES ('business', '商业版', 'month', '89.00')")
conn.execute("INSERT INTO subscriptions VALUES ('SUB1','C001','business',3,'active','2026-06-05','2026-07-05','2026-08-05',5,NULL)")
conn.execute("INSERT INTO invoices VALUES ('INV2','C001','SUB1','2026-07-05','2026-08-05','2026-07-05','paid','342.00','0.00','0.00','342.00','USD')")
lines = [("L1", "proration", "退团队版 6/20–7/5", Decimal("-58.50")),
         ("L2", "proration", "收商业版 6/20–7/5", Decimal("133.50")),
         ("L3", "recurring", "商业版 7/5–8/5", Decimal("267.00"))]
conn.executemany("INSERT INTO invoice_lines VALUES (?, 'INV2', ?, ?, 1, ?, ?, NULL, NULL, NULL)",
                 [(i, k, d, a, a) for i, k, d, a in lines])


def money_sum(values: list[str]) -> Decimal:
    return money(sum((Decimal(v) for v in values), ZERO))


rows = conn.execute("SELECT amount FROM invoice_lines WHERE invoice_id = 'INV2'").fetchall()
print("存进去的类型:", type(rows[0]["amount"]).__name__, [r["amount"] for r in rows])
print("SQL SUM:", conn.execute("SELECT SUM(amount) FROM invoice_lines WHERE invoice_id = 'INV2'").fetchone()[0])
print("money_sum:", money_sum([r["amount"] for r in rows]))
```

<div class="line-notes">

- `conn = init_db(Path("scratch/ex1.db"))` 练习自己的库。外键开着,所以必须先插客户、套餐、订阅、发票,才能插发票行,顺序反了会报 `FOREIGN KEY constraint failed`。
- `lines = [("L1", "proration", "退团队版 6/20–7/5", Decimal("-58.50")),` 金额直接用 Decimal,靠 `db.py` 里注册的 adapter 自动转成字符串存。
- `[(i, k, d, a, a) for i, k, d, a in lines]` 每行的 `unit_amount` 和 `amount` 都填同一个数(数量是 1)。
- `def money_sum(values: list[str]) -> Decimal:` 从库里读出来的金额是字符串列表,逐个转 Decimal,从 `ZERO` 开始加,最后交给 `money()` 规整。
- `print("存进去的类型:", type(rows[0]["amount"]).__name__` 验证 adapter 确实存成了字符串。

</div>

```bash
uv run python -m scratch.ex1_money_sum
```

```text
存进去的类型: str ['-58.50', '133.50', '267.00']
SQL SUM: 342.0
money_sum: 342.00
```

这组数字恰好加起来没有浮点误差,SQL 给出 342.0,看起来没问题。但它是 float,而且丢了第二位小数;换一组数就会像正文的 0.1 + 0.2 那样出尾巴。`money_sum` 给出 342.00,和发票上印的一致。Day 683 的工具层里,所有求和都用这个思路。

</details>

**练习 2:约束也要测。** 把正文 `constraints.py` 演示的两条约束写成 pytest 测试,再加一条:发票行的 `kind` 写成表里没有的 `refund` 要被拒绝。用 fixture 准备一个带客户和套餐的临时库。

<details><summary>参考答案</summary>

```python
# billsleuth/tests/test_schema.py  练习 2:表结构里的约束也要测
import sqlite3

import pytest

from billsleuth.db import init_db


@pytest.fixture
def conn(tmp_path):
    c = init_db(tmp_path / "t.db")
    c.execute("INSERT INTO customers VALUES ('C001', '青禾记账工作室', 'CN', 'USD', 'CN')")
    c.execute("INSERT INTO plans VALUES ('team', '团队版', 'month', '39.00')")
    return c


def sub_row(anchor: int) -> tuple:
    return ("SUB1", "C001", "team", 3, "active", "2026-06-05", "2026-06-05", "2026-07-05", anchor, None)


def test_anchor_day_must_be_1_to_28(conn):
    conn.execute("INSERT INTO subscriptions VALUES (?,?,?,?,?,?,?,?,?,?)", sub_row(28))
    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        conn.execute("INSERT INTO subscriptions VALUES (?,?,?,?,?,?,?,?,?,?)", ("SUB2",) + sub_row(31)[1:])


def test_invoice_needs_real_customer(conn):
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        conn.execute(
            "INSERT INTO invoices VALUES ('INV-X', 'C999', 'SUB-NOPE', '2026-06-05', '2026-07-05',"
            " '2026-06-05', 'paid', '117.00', '0.00', '0.00', '117.00', 'USD')"
        )


def test_line_kind_is_closed_list(conn):
    conn.execute("INSERT INTO subscriptions VALUES (?,?,?,?,?,?,?,?,?,?)", sub_row(5))
    conn.execute(
        "INSERT INTO invoices VALUES ('INV1', 'C001', 'SUB1', '2026-06-05', '2026-07-05',"
        " '2026-06-05', 'paid', '117.00', '0.00', '0.00', '117.00', 'USD')"
    )
    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        conn.execute(
            "INSERT INTO invoice_lines VALUES ('L1', 'INV1', 'refund', '退款', 1, '-10.00', '-10.00', NULL, NULL, NULL)"
        )
```

<div class="line-notes">

- `@pytest.fixture` 声明一个 fixture,测试函数的参数名写 `conn` 就会自动拿到它的返回值,[Day 73](/blog/agent-zero/day-073-pytest-3/) 讲过,相当于 jest 的 `beforeEach`。
- `def conn(tmp_path):` `tmp_path` 是 pytest 自带的 fixture,每条测试给一个全新的临时目录,测试之间互不干扰,也不会弄脏仓库。
- `c = init_db(tmp_path / "t.db")` 在临时目录里建一个带全部十张表的库,外键已经打开。
- `def sub_row(anchor: int) -> tuple:` 造一行订阅数据的小工具,只有锚点日可变。
- `conn.execute("INSERT INTO subscriptions VALUES (?,?,?,?,?,?,?,?,?,?)", sub_row(28))` 先插一条锚点日 28 的,证明边界值 28 是合法的。只测「31 被拒」不够,还要测「28 能过」,和 Day 678 检查脚本的道理一样。
- `with pytest.raises(sqlite3.IntegrityError, match="CHECK"):` 不光要求抛 `IntegrityError`,还要求错误信息里有 `CHECK`。不加 `match` 的话,主键重复之类的其他错误也会让测试通过,那就测错了东西。
- `("SUB2",) + sub_row(31)[1:]` 换一个 id(避免撞主键),锚点日 31。元组可以用 `+` 拼接、用切片取一部分,和列表一样。
- `with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):` 这条测试能过,前提是 `db.connect()` 里打开了外键。把那一行 PRAGMA 删掉,这条就会红,它守的正是那一行。
- `'refund'` 发票行没有 refund 这种类型。退款走贷记单,不是发票上的一行,所以 CHECK 拒绝它是对的。

</div>

```bash
uv run pytest -v
```

```text
tests/test_money.py::test_money_rounds_half_up PASSED                    [  7%]
...
tests/test_schema.py::test_anchor_day_must_be_1_to_28 PASSED             [ 84%]
tests/test_schema.py::test_invoice_needs_real_customer PASSED            [ 92%]
tests/test_schema.py::test_line_kind_is_closed_list PASSED               [100%]
```

(中间几行省略,和正文 `test_money.py` 那 10 条一样。)最后一行是 `13 passed in 0.17s`:10 条金额测试加 3 条约束测试。

</details>

**练习 3:观察会发生什么。** 在一个已经执行过 INSERT 的连接上,再执行 `PRAGMA foreign_keys = ON`,外键会生效吗?用内存库试一下。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex3_pragma_late.py  练习 3:事务开着的时候再开外键检查,会怎样
import sqlite3

conn = sqlite3.connect(":memory:")
conn.executescript("""
CREATE TABLE customers (id TEXT PRIMARY KEY);
CREATE TABLE invoices (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id));
""")
conn.execute("INSERT INTO customers VALUES ('C001')")  # 这一句让 Python 自动开了一个事务
print("事务中?", conn.in_transaction)
conn.execute("PRAGMA foreign_keys = ON")
print("开了吗?", conn.execute("PRAGMA foreign_keys").fetchone()[0])
conn.execute("INSERT INTO invoices VALUES ('INV-X', 'C999')")
print("脏数据进去了:", conn.execute("SELECT * FROM invoices").fetchall())

conn.commit()
conn.execute("PRAGMA foreign_keys = ON")
print("提交以后再开:", conn.execute("PRAGMA foreign_keys").fetchone()[0])
try:
    conn.execute("INSERT INTO invoices VALUES ('INV-Y', 'C999')")
except sqlite3.IntegrityError as e:
    print("这次拦住了:", e)
```

<div class="line-notes">

- `conn.executescript("""` 只建两张最小的表,够演示就行。
- `conn.execute("INSERT INTO customers VALUES ('C001')")` Python 的 sqlite3 模块在执行 INSERT 之前会自动开一个事务,[Day 93](/blog/agent-zero/day-093-python-sqlite-2/) 讲过它的事务行为。
- `print("事务中?", conn.in_transaction)` `in_transaction` 告诉你当前是不是在一个还没提交的事务里。
- `conn.execute("PRAGMA foreign_keys = ON")` 在事务进行中打开外键检查。
- `conn.execute("PRAGMA foreign_keys").fetchone()[0]` 不带 `= ON` 就是查询当前值,1 开 0 关。
- `conn.execute("INSERT INTO invoices VALUES ('INV-X', 'C999')")` 插一张指向不存在客户的发票。
- `conn.commit()` 提交,结束事务。
- `print("提交以后再开:"` 事务外面再开一次。

</div>

```bash
uv run python scratch/ex3_pragma_late.py
```

```text
事务中? True
开了吗? 0
脏数据进去了: [('INV-X', 'C999')]
提交以后再开: 1
这次拦住了: FOREIGN KEY constraint failed
```

在事务里执行 `PRAGMA foreign_keys = ON` **不报错,但也不生效**,查询结果还是 0,脏数据照样进去了。[SQLite 的外键文档](https://www.sqlite.org/foreignkeys.html)写了这条规则:不能在一个多语句事务进行中(也就是不在自动提交模式时)打开或关闭外键约束。这就是为什么 `db.connect()` 里那一句必须紧跟在 `sqlite3.connect` 后面,在任何写操作之前。这种「静默无效」的设置是最危险的,你以为开了,其实没开。

</details>

**练习 4:快照会和事实对不上吗?** 在 `scratch/events.db` 里给 SUB1 追加一条事件:上海 7 月 30 日凌晨 1 点把席位加到 5(Day 677 练习 3 那次),但不改订阅表。写一个 `replay`,从全部事件回放出「现在」,和快照逐字段对比。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex4_snapshot_drift.py  练习 4:用事件回放出「现在」,和快照对账
import json
from pathlib import Path

from billsleuth.db import connect

conn = connect(Path("scratch/events.db"))  # events_demo.py 留下的库
conn.execute(
    "INSERT OR REPLACE INTO subscription_events VALUES ('E3', 'SUB1', 'quantity_change', ?, ?)",
    ("2026-07-29T17:00:00+00:00", json.dumps({"quantity": 5})),  # 上海 7/30 01:00 加到 5 席
)
conn.commit()


def replay(sub_id: str) -> dict:
    state: dict = {}
    for row in conn.execute(
        "SELECT type, payload_json FROM subscription_events WHERE subscription_id = ? ORDER BY effective_at", (sub_id,)
    ):
        state.update(json.loads(row["payload_json"]))  # 后来的事件覆盖前面的字段
        state["last_event"] = row["type"]
    return state


now = replay("SUB1")
snap = dict(conn.execute("SELECT plan_id, quantity FROM subscriptions WHERE id = 'SUB1'").fetchone())
print("事件回放:", now)
print("订阅快照:", snap)
drift = {k: (snap[k], now[k]) for k in snap if snap[k] != now.get(k)}
print("对不上的字段:", drift or "无")
```

<div class="line-notes">

- `conn = connect(Path("scratch/events.db"))` 用 `connect` 而不是 `init_db`,打开正文留下的库,不清空它。要先跑过 `events_demo`。
- `"INSERT OR REPLACE INTO subscription_events VALUES ('E3'` `INSERT OR REPLACE` 遇到主键 E3 已存在时替换,这样脚本跑两遍也不报错。
- `("2026-07-29T17:00:00+00:00", json.dumps({"quantity": 5})),` 上海 7 月 30 日 01:00 换成 UTC 是 7 月 29 日 17:00。payload 只有 `quantity`,改席位不涉及套餐。
- `def replay(sub_id: str) -> dict:` 和正文 `state_at` 一样从头叠,只是不限时间,回放到最新。
- `state.update(json.loads(row["payload_json"]))` E3 只带 `quantity`,`update` 只覆盖这一个字段,`plan_id` 保留 E2 留下的 `business`。如果写成「只取最后一条事件」,这里就会丢掉 plan_id。
- `drift = {k: (snap[k], now[k]) for k in snap if snap[k] != now.get(k)}` 逐字段比,只留对不上的,值是 `(快照, 回放)`。
- `print("对不上的字段:", drift or "无")` 空字典是假值,`or` 让它显示成「无」。

</div>

```bash
uv run python -m scratch.ex4_snapshot_drift
```

```text
事件回放: {'plan_id': 'business', 'quantity': 5, 'last_event': 'quantity_change'}
订阅快照: {'plan_id': 'business', 'quantity': 3}
对不上的字段: {'quantity': (3, 5)}
```

事件说现在是 5 席,快照还停在 3 席。这正是 `quantity_change_ignored`(减席位没生效)这类根因在数据层面的样子:事件记下了变化,但某个环节没跟上。BillSleuth 定的规则是**两边对不上时以事件为准**,这也是引擎只读事件的原因。快照的作用只是让「查当前状态」这种常见查询不用每次回放,它坏了可以重新算出来,事件坏了就什么都没有了。

</details>

**验收标准:** `uv run pytest` 13 条全绿;把 `ROUND_HALF_UP` 换成 `ROUND_HALF_EVEN` 时能指出哪两条会红、为什么只有这两条;`uv run python -m billsleuth.db` 打出 10 张表;能解释为什么 TEXT 列的 SQL `SUM` 还是浮点数;能不看文章说出订阅表和事件表各存什么、对不上时以谁为准;能说出外键检查的两个坑(默认关、事务里开无效)。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 有效数字(precision) | Decimal 默认保留 28 位有效数字,不是 28 位小数;除不尽时在这里截断 |
| `ROUND_HALF_EVEN` | 逢五取偶,也叫银行家舍入,0.125 得 0.12;Decimal 默认用它 |
| `money()` | BillSleuth 里把任何金额规整成两位小数的唯一入口,拒收 float |
| `register_adapter` | 告诉 sqlite3 某种 Python 类型写库时怎么转换,这里把 Decimal 转成字符串 |
| `python -m` | 按模块名运行脚本,会把当前目录加进搜索路径 |
| CHECK 约束 | 列上的条件,写入的值不满足就被数据库拒绝,如锚点日 1 到 28 |
| 外键(foreign key) | 一列的值必须在另一张表的主键里存在;SQLite 默认不检查,要 `PRAGMA foreign_keys = ON` |
| PRAGMA | SQLite 的设置命令,有的设置在事务里修改无效 |
| `sqlite_master` | SQLite 自带的系统表,记录库里所有表和索引 |
| 快照(snapshot) | 只存当前状态的表,如 `subscriptions`,能从事件重新算出来 |
| 事件(event) | 一次变化的记录,只追加不修改,如 `subscription_events`;是计费的事实来源 |
| 事件回放(replay) | 从第一条事件开始按时间顺序叠加,得到任意时刻的状态,相当于 `events.reduce(...)` |
| UTC | 协调世界时,不随地区变化;事件时间统一存 UTC,计算时再换成客户本地时间 |

## 常见误区

**以为存成 TEXT 就安全了。** TEXT 列用 SQL 的 `SUM`,SQLite 先把文本转成浮点数再加,实测还是 0.30000000000000004。存用 TEXT,算用 Python 的 Decimal。

**`money()` 有了类型标注就不用运行时检查。** 类型标注只在编辑器里起作用,从 JSON 读出来的小数就是 float,运行时照样能传进来。两道闸都要。

**每一步都舍入到分。** 39 美元折算 10 天,先算日价得 12.60,只舍入一次得 12.58。中间保留精度,最后舍入一次。

**测试数据没有落在半分上。** 把四舍五入换成逢五取偶,不在半分上的四组折算全是绿的。专门放 58.505、16.665 这种数。

**建了外键以为就生效了。** SQLite 默认不检查外键,每个连接都要开;项目里统一通过 `db.connect()` 拿连接。

**在事务里才开外键检查。** 不报错,也不生效。`PRAGMA foreign_keys = ON` 紧跟在连接之后、任何写操作之前。

**引擎从订阅表读当前套餐来算过去的账。** 订阅表只知道现在。算 6 月的账要回放 6 月时的事件。

**回放只取最后一条事件。** 改席位的事件只带 `quantity`,只取最后一条会丢掉套餐。从第一条开始叠。

**事件时间按客户本地时间存。** `+08:00` 和 `+00:00` 混在一起,SQL 的字符串比较就会把先后弄反。统一存 UTC,算账时再换回本地日期。

**import 了包的草稿脚本直接 `python scratch/x.py`。** 只有 `scratch/` 进了搜索路径,报 `ModuleNotFoundError`。在仓库根目录用 `python -m scratch.x`。

## 学习资料

### 文档与文章

- [Python 文档 · decimal](https://docs.python.org/zh-cn/3.12/library/decimal.html):看「快速入门教程」、`quantize` 和舍入模式列表,今天每一条规矩都能在这里找到出处,中文,25 分钟。
- [Python 文档 · sqlite3](https://docs.python.org/zh-cn/3.12/library/sqlite3.html):看「如何将自定义 Python 类型适配到 SQLite 值」那一节,讲的就是 `register_adapter`,中文,15 分钟。
- [SQLite · Datatypes In SQLite](https://www.sqlite.org/datatype3.html):SQLite 的类型亲和性规则,解释为什么 TEXT 列也能参与数值运算,15 分钟。
- [SQLite · Foreign Key Support](https://www.sqlite.org/foreignkeys.html):第 2 节讲外键为什么默认关闭、怎么打开,以及「不能在事务中途打开或关闭」那句话的原文,15 分钟。
- [SQLite · CREATE TABLE](https://www.sqlite.org/lang_createtable.html):查 CHECK 约束的语法和行为,10 分钟。
- [Martin Fowler · Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html):事件溯源的经典说明,重点看「应用状态可以从事件日志重建」那几段,20 分钟。
- [Stripe API · Credit Notes](https://docs.stripe.com/api/credit_notes):看一张真实的贷记单对象有哪些字段,对照我们的 `credit_notes` 表少了什么,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Le4y137gU&autoplay=0&high_quality=1" title="【计算机知识】定点数与浮点数(2)浮点数法表示方法!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>计算机知识星球 · 【计算机知识】定点数与浮点数(2)浮点数法表示方法! · 3 分钟,看懂浮点数在内存里怎么存,就明白为什么 REAL 列存不了精确的 0.1。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV15541147z3&autoplay=0&high_quality=1" title="[动画] 事件溯源(Event Sourcing),读写分离(CQRS)与事件驱动的设计(Event-Driven Design)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小马过河Vizit · [动画] 事件溯源(Event Sourcing),读写分离(CQRS)与事件驱动的设计 · 10 分钟,动画讲事件溯源,看前半段「状态从事件重建」就够,CQRS 部分今天用不到。</figcaption>
</figure>

- 时吉科技《Python中浮点数精度问题》(BV1t7411a7bZ,4 分钟):在 Python 里演示精度问题和 Decimal 的用法,和今天第一个脚本对照着看。
- 搬运工来架构《大厂系统设计都在用的Event Sourcing是什么?》(BV1eJ4m1u7NV,5 分钟):另一个角度讲事件溯源,更偏系统设计面试。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/0kzjD6jvfnk" title="Representing Monetary Values in Python" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>ArjanCodes · Representing Monetary Values in Python · 讲 float、整数分、Decimal 三种表示金额的方式各自的坑,和今天「存 TEXT、算 Decimal」的选择对照。</figcaption>
</figure>

- Computerphile《Floating Point Numbers - Computerphile》(YouTube `PZRI1IfStY0`):经典科普,讲浮点数的设计取舍,想彻底弄懂 0.1 为什么存不准时看。

### 书籍

- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly, 2017;中国电力出版社有中译本《数据密集型应用系统设计》):第 11 章讲事件日志和由事件派生的状态,对应今天「事件是事实、订阅表是快照」。
- Martin Fowler《Patterns of Enterprise Application Architecture》(Addison-Wesley, 2002):第 18 章的 Money 一节,讲为什么金额要做成值对象、分摊时除不尽的分怎么处理。今天的 `money.py` 是它最简化的版本,没做币种和分摊。

### 开源项目与代码

- [py-moneyed/py-moneyed](https://github.com/py-moneyed/py-moneyed):Python 的 Money 类型实现,看它怎么把金额和币种绑在一起,和我们只有一个 `money()` 函数的做法对比,15 分钟。
- [getlago/lago](https://github.com/getlago/lago):开源计费系统,翻它的数据库迁移文件,看 subscriptions、invoices、credit_notes 这些表的字段,和我们的十张表对照。

## 自测

1. `Decimal("39") * 10 / 31` 只舍入一次和先算日价再乘,结果各是多少?为什么不一样?

<details><summary>答案</summary>

只舍入一次:39 × 10 / 31 = 12.580…,舍入 12.58。先算日价:39 / 31 = 1.258…,舍入 1.26,再乘 10 得 12.60。日价的舍入误差(约 0.002)被乘了 10 倍。规则是中间结果保留全部精度,只在最后舍入一次。

</details>

2. 金额已经存成 TEXT 了,为什么还不能用 SQL 的 `SUM` 算发票合计?

<details><summary>答案</summary>

SQLite 的 `SUM` 会先把文本转成浮点数再相加,实测 `'0.1'` 和 `'0.2'` 求和得 0.30000000000000004,练习 1 里 342.00 变成了 342.0。TEXT 只保证存进去的值精确,计算要读回 Python 转成 Decimal 再做。

</details>

3. 把 `money.py` 的 `ROUND_HALF_UP` 换成 `ROUND_HALF_EVEN`,`test_money.py` 里哪两条会红?为什么其他折算数据还是绿的?

<details><summary>答案</summary>

`test_money_rounds_half_up`(58.505 变成 58.50)和 parametrize 里 99.99-5-30 那组(16.665 变成 16.66)。其他四组折算数据(58.50、137.81、60.39、12.58、0.00)的原始值都不在半分上,两种舍入方式结果相同。所以测试数据里必须专门放正好在半分上的数。

</details>

4. 订阅表和事件表各存什么?客户问「6 月那张发票该收多少」,该查哪张?两张对不上时以谁为准?

<details><summary>答案</summary>

订阅表存当前的套餐、席位、周期,是快照;事件表存每一次变化(开通、升级、改席位、取消……),只追加不修改,是事实。算 6 月的账要从事件表回放出 6 月时的状态,订阅表只知道现在。对不上时以事件为准,快照可以从事件重新算出来。

</details>

5. 为什么事件时间要统一存 UTC?按客户本地时间计费的规则又怎么实现?

<details><summary>答案</summary>

SQL 里比较和排序 `effective_at` 是字符串比较,不同时区偏移(`+08:00` 和 `+00:00`)混在一起时字典序和时间顺序不一致,实测上海 6/20 00:30 的事件被判成在 UTC 6/19 20:00 之后。统一存 UTC,字符串比较才和时间比较一致。按本地日期计费是计算层的事:引擎用客户的国家对应的时区把 UTC 时间换回本地日期再算天数。存储用 UTC,计算用本地。

</details>

6. 面试题:面试官问「你的计费表为什么不直接在订阅表上改套餐和席位,还要单独搞一张事件表?这不是多此一举吗?」

<details><summary>答案</summary>

计费争议几乎都是关于过去的:「6 月为什么扣了这么多」要知道 6 月时的套餐和席位,只存当前值的订阅表回答不了,改一次就丢一次历史。事件表只追加不修改,任何时刻的状态都能回放出来,这就是事件溯源。它还带来三个好处:审计,每次变化什么时候、变成什么都有记录;可复算,参考引擎只读事件就能重新算出每一期的应收,BillSleuth 的复算工具就靠这个;能发现不一致,快照和事件回放对不上本身就是一类可以查出来的故障(减席位没生效)。订阅表保留下来是为了查询当前状态方便,当作缓存,坏了可以从事件重建。代价是写入时要同时维护两边,读历史要回放,在我们这个规模下可以忽略;量大了可以定期存快照点,从最近的快照点开始回放。

</details>

## 明天预告

明天是 Day 681 · BillSleuth(二):参考引擎和用单测钉死规则,价目表和税率。今天的 `money.py` 和 `state_at` 是零件,明天把它们拼成参考计费引擎:按锚点日排周期,回放每个周期当时的套餐和席位,按天折算记到下一张发票,套上优惠券的有效月份,按开票日查税率的有效期,算出每一张应收发票;每条规则都先写一条手算过的测试再写实现。
