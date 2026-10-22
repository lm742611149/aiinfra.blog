---
title: 'Day 36 · 异常(二):raise、自定义异常和 finally'
description: '昨天学会接住别人抛的异常,今天自己抛:用 raise 拦下不合格的数据,定义自己的 TicketError,用 raise ... from 保留原始错误,再用 finally 保证收尾代码一定执行。最后拼一个批量校验工单的小程序。'
pubDate: 2026-10-22
regime: none
tags: ['python', 'exceptions', 'agent-zero']
series: 'agent-zero'
day: 36
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 35](/blog/agent-zero/day-035-exceptions-1/) 学的是「接住」:用 `try` 包住可能出错的代码,用 `except ValueError as e:` 接住特定类型的异常,程序就不会整个崩掉;还学了怎么从下往上读 traceback,先看最后一行的异常类型和信息,再往上找是哪个文件哪一行出的事。

但昨天的异常都是别人抛的:`float("abc")` 抛 `ValueError`,`open` 一个不存在的文件抛 `FileNotFoundError`。今天换个角色,自己来抛。原因很实际:有些数据 Python 觉得完全没问题,业务上却不能要。比如工单金额写成 `-50`,`float("-50")` 高高兴兴地返回 `-50.0`,可一张工单的金额怎么会是负数?这种时候得你自己喊停。

## 今天要解决的问题

学完今天,你应该能做到下面四件事,每一件都能用一个脚本验证:

1. 用 `raise` 在函数里主动抛出异常,并说清楚抛出之后代码往哪走。
2. 写一个自己的异常类 `TicketError`,让调用方能只接住「工单数据有问题」这一类错误。
3. 用 `raise ... from e` 把底层的 `ValueError` 换成 `TicketError`,同时保留原始报错。
4. 用 `finally` 写一定会执行的收尾代码,知道它在「正常返回」「异常被接住」「异常没被接住」三种情况下都会跑。

预计用时:2 到 2.5 小时。前置:[Day 28](/blog/agent-zero/day-028-functions-1/) 的函数、[Day 24](/blog/agent-zero/day-024-dicts/) 的字典、[Day 35](/blog/agent-zero/day-035-exceptions-1/) 的 try/except。

学法:先对照文章逐行敲一遍(不要复制粘贴)并跑通;第二天合上文章,把最后那个 `ticket_batch.py` 默写出来;再做动手练习,做不出来再展开参考答案,看完关掉自己重写一遍。

今天所有命令都在项目根目录 `agent-zero-lab` 里跑(就是 [Day 10](/blog/agent-zero/day-010-uv-1/) 用 `uv init` 建的那个目录),新文件都放进 `part01/`。今天不调大模型 API,花费是 0 元。

## 先和 JS 对一下表

你在前端写过 `throw new Error("...")`,Python 的 `raise` 就是它。下面这张表先扫一眼,后面每一行都会用代码演示一遍。

| 你在 JS/TS 里写的 | Python 里对应的 | 说明 |
| --- | --- | --- |
| `throw new Error("金额不对")` | `raise ValueError("金额不对")` | Python 不写 `new`,直接调用异常类 |
| `class TicketError extends Error {}` | `class TicketError(Exception): pass` | 括号里写「继承自谁」 |
| `try { } catch (e) { } finally { }` | `try: ... except X as e: ... finally: ...` | finally 的规则两边一样 |
| `new Error("x", { cause: err })` | `raise X("x") from err` | 把原始错误挂在新错误上 |
| `catch (e) { throw e }` | `except X: raise` | 原样再抛出去 |

有一点不一样要先记住:JS 的 `catch (e)` 什么都接,想区分类型得在里面写 `if (e instanceof TypeError)`;Python 的 `except ValueError` 直接按类型过滤,不是这个类型的异常会从它旁边穿过去,继续往外飞。今天的自定义异常就是利用这一点。

## 第一步:用 raise 主动喊停

先看最小的例子。`parse_amount` 把字符串转成金额,转完检查一下是不是负数,是就抛异常。

新建 `part01/raise_basic.py`:

```python
# agent-zero-lab/part01/raise_basic.py
def parse_amount(text: str) -> float:
    amount = float(text)
    if amount < 0:
        raise ValueError(f"金额不能是负数: {amount}")
    return amount


print(parse_amount("199.5"))

try:
    parse_amount("-20")
except ValueError as e:
    print("拦下来了:", e)

print(parse_amount("-20"))
print("这一行不会执行")
```

<div class="line-notes">

- `def parse_amount(text: str) -> float:` 一个普通函数,参数是字符串,返回浮点数。`: str` 和 `-> float` 是类型标注,Day 45 专门讲,现在当成注释看就行。
- `amount = float(text)` 第一次调用时 `text` 是 `"199.5"`,`amount` 得到 `199.5`;第二次是 `"-20"`,得到 `-20.0`。注意 `float()` 对 `"-20"` 一点意见都没有,它只管「能不能转成数字」。
- `if amount < 0:` 这就是业务规则:金额不能小于 0。`-20.0 < 0` 为 `True`,进入下一行。
- `raise ValueError(f"金额不能是负数: {amount}")` 先调用 `ValueError(...)` 造出一个异常对象,信息是 `金额不能是负数: -20.0`,然后 `raise` 把它抛出去。抛出的那一刻,函数立刻停下,**下面的 `return amount` 不会执行**,控制权交回给调用它的地方。
- `return amount` 只有没抛异常时才走到这里。`"199.5"` 走的就是这条路。
- `print(parse_amount("199.5"))` 实测打印 `199.5`。
- `try:` 第二次调用包在 try 里,和 Day 35 一样。
- `parse_amount("-20")` 函数里 `raise` 了,异常飞出函数,落到这个 try 块里。
- `except ValueError as e:` 类型对得上,接住。`e` 就是函数里造出来的那个异常对象。
- `print("拦下来了:", e)` 实测打印 `拦下来了: 金额不能是负数: -20.0`。`print` 一个异常对象,打出来的就是你传给它的那句话。
- `print(parse_amount("-20"))` 第三次调用没有 try 保护,异常一路飞到最外层也没人接,程序崩溃,退出码是 1(实测 `echo $?` 输出 `exit=1`)。
- `print("这一行不会执行")` 确实没执行,输出里看不到这句。

</div>

跑一下:

```bash
uv run python part01/raise_basic.py
```

实测输出(路径太长,我把前面一截换成了 `.../`,你的电脑上会是完整路径):

```text
199.5
拦下来了: 金额不能是负数: -20.0
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/raise_basic.py", line 16, in <module>
    print(parse_amount("-20"))
          ^^^^^^^^^^^^^^^^^^^
  File ".../agent-zero-lab/part01/raise_basic.py", line 5, in parse_amount
    raise ValueError(f"金额不能是负数: {amount}")
ValueError: 金额不能是负数: -20.0
```

用 Day 35 的读法从下往上读:最后一行是异常类型和你写的那句话;往上一层是 `line 5, in parse_amount`,正好是 `raise` 那一行;再往上是 `line 16, in <module>`,`<module>` 指的是「文件最外层,不在任何函数里」,也就是第三次调用的位置。traceback 记录的是异常一路飞出来经过的每一层,你自己 `raise` 的异常和 Python 内置函数抛的异常,读法完全一样。

为什么不直接 `print("金额不对")` 然后 `return 0`?我第一次写校验函数就是这么干的,结果调用方拿到 0,当成正常金额加进了总数,一点动静都没有。`print` 只是在终端里喊了一嗓子,程序该干嘛还干嘛;`raise` 是真的把流程停住,逼调用方二选一:要么用 try 接住并决定怎么处理,要么让程序崩掉。错误数据不会悄悄混进后面的计算里。

这一步只多了一个东西:`raise 异常对象`。异常类型先借用内置的 `ValueError`,它的意思是「类型对了但值不对」,用在这里很合适。

## 第二步:自定义异常 TicketError

用 `ValueError` 有个麻烦。看下面这段调用:

```python
try:
    amount = parse_amount(ticket["amount"])
except ValueError:
    ...
```

`except ValueError` 接住的可能是两种完全不同的事。一种是我们自己 `raise` 的「金额是负数」;另一种是 `float("abc")` 自己抛的 `could not convert string to float`。如果代码再长一点,里面还有 `int()`、日期解析,它们也都抛 `ValueError`。调用方根本分不清是哪一种。

解决办法是给「工单数据有问题」这件事起个专门的名字,也就是自定义一个异常类型。新建 `part01/ticket_error.py`:

```python
# agent-zero-lab/part01/ticket_error.py
class TicketError(Exception):
    pass


def check_ticket(ticket: dict[str, str]) -> None:
    if ticket["title"].strip() == "":
        raise TicketError(f"{ticket['id']} 标题是空的")


tickets = [
    {"id": "T-1001", "title": "发票抬头开错了"},
    {"id": "T-1003", "title": "   "},
]

for t in tickets:
    try:
        check_ticket(t)
        print(t["id"], "通过")
    except TicketError as e:
        print("工单有问题:", e)

print(issubclass(TicketError, Exception))
```

<div class="line-notes">

- `class TicketError(Exception):` 定义一个新的异常类型叫 `TicketError`,括号里的 `Exception` 表示它「继承自」Exception,相当于 JS 的 `class TicketError extends Error`。类的完整写法 [Day 40](/blog/agent-zero/day-040-classes-1/) 才讲,今天你只需要把这两行当成固定模板:**`class 名字(Exception):` 加一行 `pass`**。
- `pass` 意思是「这里什么都不写」。Python 的类体不能是空的,必须写点什么,`pass` 就是占位用的。它什么都不加,但继承来的东西一样不少:能被 `raise`,能带一句话,能被 `except` 接住。
- `def check_ticket(ticket: dict[str, str]) -> None:` 参数是一张工单字典,`-> None` 表示这个函数不返回东西,它的工作只有一件:发现问题就抛异常,没问题就安静地结束。
- `if ticket["title"].strip() == "":` `.strip()` 是 Day 16 学的去掉首尾空白。T-1003 的标题是三个空格 `"   "`,strip 之后变成 `""`,条件成立。
- `raise TicketError(f"{ticket['id']} 标题是空的")` 用法和 `ValueError` 一模一样。f-string 里用了单引号 `ticket['id']`,因为外面已经是双引号了,里面再写双引号在 Python 3.12 之前会报错,养成习惯换成单引号。代入 T-1003,信息是 `T-1003 标题是空的`。
- `tickets = [` 两张样本工单,一张正常,一张标题全是空格。
- `for t in tickets:` 逐张检查(Day 18 的 for 循环)。
- `check_ticket(t)` T-1001 正常返回;T-1003 在里面抛了 `TicketError`。
- `print(t["id"], "通过")` 只有 check 没抛异常才走到这里。实测打印 `T-1001 通过`。
- `except TicketError as e:` 只接 `TicketError`,别的类型从旁边穿过去。
- `print("工单有问题:", e)` 实测打印 `工单有问题: T-1003 标题是空的`。循环接着跑,不会因为一张坏工单停掉。
- `print(issubclass(TicketError, Exception))` `issubclass(A, B)` 问「A 是不是 B 的子类」,实测 `True`。所以 `except Exception` 也能接住 `TicketError`,下面会用到这一点。

</div>

```bash
uv run python part01/ticket_error.py
```

实测输出:

```text
T-1001 通过
工单有问题: T-1003 标题是空的
True
```

现在调用方写 `except TicketError`,意思就非常明确了:「工单数据不合格,这张跳过,记一笔」。而真正的意外(比如代码写错了引发的 `KeyError`、`TypeError`)不会被它误吞,照样会冒出来让你看见。

这里顺带说一下 Python 异常的「家谱」。所有异常都挂在一棵继承树上,`except` 一个父类,就能接住它下面所有的子类。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="Python 异常继承树:BaseException 下面是 Exception 和 KeyboardInterrupt,Exception 下面有 ValueError、KeyError 和我们自己的 TicketError">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="250" y="16" width="140" height="28" rx="4" fill="none" stroke="var(--rule)"/>
<text x="320" y="35" text-anchor="middle" fill="var(--ink)">BaseException</text>
<line x1="320" y1="44" x2="190" y2="80" stroke="var(--rule)"/>
<line x1="320" y1="44" x2="480" y2="80" stroke="var(--rule)"/>
<rect x="130" y="80" width="120" height="28" rx="4" fill="none" stroke="var(--rule)"/>
<text x="190" y="99" text-anchor="middle" fill="var(--ink)">Exception</text>
<rect x="400" y="80" width="160" height="28" rx="4" fill="none" stroke="var(--rule)"/>
<text x="480" y="99" text-anchor="middle" fill="var(--ink-soft)">KeyboardInterrupt</text>
<text x="480" y="126" text-anchor="middle" fill="var(--ink-faint)" font-size="11">按 Ctrl+C 时抛的</text>
<line x1="190" y1="108" x2="70" y2="150" stroke="var(--rule)"/>
<line x1="190" y1="108" x2="190" y2="150" stroke="var(--rule)"/>
<line x1="190" y1="108" x2="320" y2="150" stroke="var(--rule)"/>
<rect x="20" y="150" width="100" height="28" rx="4" fill="none" stroke="var(--rule)"/>
<text x="70" y="169" text-anchor="middle" fill="var(--ink)">ValueError</text>
<rect x="140" y="150" width="100" height="28" rx="4" fill="none" stroke="var(--rule)"/>
<text x="190" y="169" text-anchor="middle" fill="var(--ink)">KeyError</text>
<rect x="260" y="150" width="120" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="169" text-anchor="middle" fill="var(--ink)">TicketError</text>
<line x1="320" y1="178" x2="320" y2="206" stroke="var(--compute)"/>
<rect x="260" y="206" width="120" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="225" text-anchor="middle" fill="var(--ink)">AmountError</text>
<text x="400" y="169" fill="var(--ink-soft)" font-size="11">← 今天自己写的</text>
<text x="400" y="225" fill="var(--ink-soft)" font-size="11">← 练习 2 写的子类</text>
</g>
</svg>
<figcaption>except 一个类,就接住它和它下面所有的子类。except TicketError 接得住 AmountError,接不住旁边的 ValueError 和 KeyError。</figcaption>
</figure>

图里有个细节:按 Ctrl+C 中断程序时抛的 `KeyboardInterrupt` 不在 `Exception` 下面,所以 `except Exception` 接不住它,你按 Ctrl+C 程序还是能停下来。这是 Python 故意这么设计的。自定义异常永远继承 `Exception`,不要继承 `BaseException`。

## 第三步:raise ... from,换个名字但别丢了原因

工单的金额字段是字符串,要用 `float()` 转。转不了的时候,`float()` 抛的是 `ValueError`。我们希望对外统一成 `TicketError`,好让调用方只写一个 except。思路是:在函数里接住 `ValueError`,再抛一个 `TicketError`。

先看不加 `from` 的写法,新建 `part01/raise_no_from.py`:

```python
# agent-zero-lab/part01/raise_no_from.py
class TicketError(Exception):
    pass


def read_amount(ticket: dict[str, str]) -> float:
    try:
        return float(ticket["amount"])
    except ValueError:
        raise TicketError(f"{ticket['id']} 金额不是数字: {ticket['amount']}")


read_amount({"id": "T-1004", "amount": "abc"})
```

<div class="line-notes">

- `class TicketError(Exception):` 和上一步一样的两行模板。每个文件都重新写一遍,是因为它们是独立的小脚本;Day 32 学过的 import 可以让多个文件共用一个定义,等代码稳定了再拆。
- `return float(ticket["amount"])` 代入 `"abc"`,`float` 抛 `ValueError: could not convert string to float: 'abc'`。
- `except ValueError:` 接住了,但这次没写 `as e`,因为我们不打算用它。
- `raise TicketError(f"{ticket['id']} 金额不是数字: {ticket['amount']}")` 在 except 块**里面**又抛了一个新异常。信息是 `T-1004 金额不是数字: abc`。
- `read_amount({"id": "T-1004", "amount": "abc"})` 没有 try 保护,新的 TicketError 一路飞到最外层,程序崩溃。我们就是要看它崩出来的 traceback 长什么样。

</div>

实测输出:

```text
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/raise_no_from.py", line 8, in read_amount
    return float(ticket["amount"])
           ^^^^^^^^^^^^^^^^^^^^^^^
ValueError: could not convert string to float: 'abc'

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File ".../agent-zero-lab/part01/raise_no_from.py", line 13, in <module>
    read_amount({"id": "T-1004", "amount": "abc"})
  File ".../agent-zero-lab/part01/raise_no_from.py", line 10, in read_amount
    raise TicketError(f"{ticket['id']} 金额不是数字: {ticket['amount']}")
TicketError: T-1004 金额不是数字: abc
```

两段 traceback,中间那句 `During handling of the above exception, another exception occurred` 翻译过来是「在处理上面那个异常的时候,又发生了另一个异常」。Python 很贴心,两个都给你看了。问题在于这句话的口气:它像是在说「处理错误的代码自己也出 bug 了」。读日志的人会以为 except 块里写错了什么,其实这个 TicketError 是我们故意抛的。

加上 `from e` 就能把意思说准。新建 `part01/raise_from.py`:

```python
# agent-zero-lab/part01/raise_from.py
class TicketError(Exception):
    pass


def read_amount(ticket: dict[str, str]) -> float:
    try:
        return float(ticket["amount"])
    except ValueError as e:
        raise TicketError(f"{ticket['id']} 金额不是数字: {ticket['amount']}") from e


print(read_amount({"id": "T-1001", "amount": "199"}))
read_amount({"id": "T-1004", "amount": "abc"})
```

<div class="line-notes">

- `except ValueError as e:` 这次要用原始异常,所以写上 `as e`。`e` 里装的是 `ValueError: could not convert string to float: 'abc'`。
- `raise TicketError(` 结尾多了 `from e`,意思是「这个 TicketError 是**由** e 引起的」。新异常对象上会多一个属性 `__cause__`,指向原来的 ValueError。相当于 JS 的 `new Error("...", { cause: err })`。
- `print(read_amount({"id": "T-1001", "amount": "199"}))` 正常的工单,实测打印 `199.0`。
- `read_amount({"id": "T-1004", "amount": "abc"})` 坏工单,崩出来看 traceback。

</div>

实测输出:

```text
199.0
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/raise_from.py", line 8, in read_amount
    return float(ticket["amount"])
           ^^^^^^^^^^^^^^^^^^^^^^^
ValueError: could not convert string to float: 'abc'

The above exception was the direct cause of the following exception:

Traceback (most recent call last):
  File ".../agent-zero-lab/part01/raise_from.py", line 14, in <module>
    read_amount({"id": "T-1004", "amount": "abc"})
  File ".../agent-zero-lab/part01/raise_from.py", line 10, in read_amount
    raise TicketError(f"{ticket['id']} 金额不是数字: {ticket['amount']}") from e
TicketError: T-1004 金额不是数字: abc
```

中间那句变成了 `The above exception was the direct cause of the following exception`,「上面那个异常是下面这个异常的直接原因」。两段信息都还在,但因果关系说清楚了:不是处理代码出了 bug,而是我们有意把底层错误翻译成了业务错误。

这个写法以后天天见。第二部分开始调大模型 API,openai 这个库的源码里就是这么干的:底层网络库抛的各种连接错误,被它接住后统一翻译成 `APIConnectionError` 之类的自己的异常,原始错误挂在 `from` 后面。今天「学习资料」里放了它的 `_exceptions.py` 链接,现在就能看懂一大半。

还有一种写法也会遇到:在 except 里只写一个光秃秃的 `raise`,不跟任何东西。意思是「把刚才接住的那个异常原样再扔出去」。适合「我只想记一笔日志,处理不了,交给上层」的场景。练习 4 会用到。

## 第四步:finally,不管发生什么都要执行

有些代码无论成功失败都必须跑。前端里最熟悉的例子是 loading 状态:请求成功要关 loading,请求失败也要关 loading,不然转圈圈永远停不下来。你大概写过这种代码:

```js
try { await fetchTickets() } catch (e) { showError(e) } finally { setLoading(false) }
```

Python 的 `finally` 规则和 JS 一样。先用一个带 `return` 的函数看执行顺序,新建 `part01/finally_order.py`:

```python
# agent-zero-lab/part01/finally_order.py
def handle(text: str) -> float:
    print("  开始处理", text)
    try:
        amount = float(text)
        print("  转换成功")
        return amount
    except ValueError:
        print("  转换失败")
        return 0.0
    finally:
        print("  finally: 收尾")


print("结果:", handle("199"))
print("结果:", handle("abc"))
```

<div class="line-notes">

- `print("  开始处理", text)` 开头两个空格只是让函数里打印的行缩进一点,和外面 `结果:` 那行区分开。
- `amount = float(text)` 第一次 `"199"` 成功得到 `199.0`;第二次 `"abc"` 抛 ValueError,下面两行直接跳过。
- `return amount` 重点在这里:try 里已经 `return` 了,按理说函数该结束了,但 Python 会**先去跑 finally,再真正返回**。
- `except ValueError:` 第二次调用走这里。
- `return 0.0` except 里的 return 也一样,先跑 finally 再返回。
- `finally:` 和 try、except 对齐,写在最后。
- `print("  finally: 收尾")` 实测两次调用都打印了这一句,而且都打在 `结果:` 之前,说明 return 的值是在 finally 跑完之后才交出去的。
- `print("结果:", handle("199"))` 实测 `结果: 199.0`。
- `print("结果:", handle("abc"))` 实测 `结果: 0.0`。

</div>

实测输出:

```text
  开始处理 199
  转换成功
  finally: 收尾
结果: 199.0
  开始处理 abc
  转换失败
  finally: 收尾
结果: 0.0
```

上面两次,异常要么没发生,要么被 except 接住了。第三种情况更关键:异常发生了,而且**没被接住**。新建 `part01/finally_crash.py`:

```python
# agent-zero-lab/part01/finally_crash.py
def handle(ticket: dict[str, str]) -> None:
    try:
        print("处理", ticket["id"])
        print("金额", ticket["amount"])
    finally:
        print("finally: 解锁工单", ticket["id"])


handle({"id": "T-1001", "amount": "199"})
handle({"id": "T-1006"})
print("这一行不会执行")
```

<div class="line-notes">

- `try:` 这次只有 try 和 finally,没有 except。这是合法的写法:我不打算处理任何异常,只想保证收尾。
- `print("处理", ticket["id"])` 两张工单都有 id,都能打印。
- `print("金额", ticket["amount"])` T-1006 这张字典里没有 `"amount"` 这个键,抛 `KeyError: 'amount'`(Day 24 学过,用方括号取不存在的键会抛这个)。
- `finally:` 异常没人接,但飞出函数之前,finally 先执行。
- `print("finally: 解锁工单", ticket["id"])` 实测 T-1006 也打印了 `finally: 解锁工单 T-1006`,而且打在 traceback 前面。
- `handle({"id": "T-1006"})` 异常飞出函数,到最外层还是没人接,程序崩溃。
- `print("这一行不会执行")` 确实没执行。finally 保证的是「收尾代码会跑」,不保证「程序不崩」。

</div>

实测输出:

```text
处理 T-1001
金额 199
finally: 解锁工单 T-1001
处理 T-1006
finally: 解锁工单 T-1006
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/finally_crash.py", line 11, in <module>
    handle({"id": "T-1006"})
  File ".../agent-zero-lab/part01/finally_crash.py", line 5, in handle
    print("金额", ticket["amount"])
                  ~~~~~~^^^^^^^^^^
KeyError: 'amount'
```

「解锁工单」这个名字是我故意起的。真实系统里,客服打开一张工单时,系统往往会给它加个锁,免得两个人同时改。处理完不管成没成功都得解锁,否则这张工单就永远卡在「有人正在处理」。这类必须成对出现的动作(加锁和解锁、打开文件和关闭文件、连上数据库和断开连接)就是 finally 的主场。后天 [Day 38](/blog/agent-zero/day-038-files-with/) 讲的 `with`,本质上就是帮你自动写好了这个 finally。

三种情况放在一张图里:

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="try except finally 的三条执行路径:正常、异常被接住、异常没被接住,三条路都经过 finally">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="30" fill="var(--ink)">① 正常</text>
<rect x="110" y="16" width="90" height="24" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="155" y="32" text-anchor="middle" fill="var(--ink)">try 跑完</text>
<line x1="200" y1="28" x2="370" y2="28" stroke="var(--rule)"/>
<rect x="370" y="16" width="90" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="415" y="32" text-anchor="middle" fill="var(--ink)">finally</text>
<line x1="460" y1="28" x2="500" y2="28" stroke="var(--rule)"/><text x="505" y="32" fill="var(--ink-soft)">返回结果</text>
<text x="20" y="100" fill="var(--ink)">② 被接住</text>
<rect x="110" y="86" width="90" height="24" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="155" y="102" text-anchor="middle" fill="var(--ink)">try 抛了</text>
<line x1="200" y1="98" x2="240" y2="98" stroke="var(--rule)"/>
<rect x="240" y="86" width="100" height="24" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="290" y="102" text-anchor="middle" fill="var(--ink)">except 处理</text>
<line x1="340" y1="98" x2="370" y2="98" stroke="var(--rule)"/>
<rect x="370" y="86" width="90" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="415" y="102" text-anchor="middle" fill="var(--ink)">finally</text>
<line x1="460" y1="98" x2="500" y2="98" stroke="var(--rule)"/><text x="505" y="102" fill="var(--ink-soft)">返回结果</text>
<text x="20" y="170" fill="var(--ink)">③ 没接住</text>
<rect x="110" y="156" width="90" height="24" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="155" y="172" text-anchor="middle" fill="var(--ink)">try 抛了</text>
<line x1="200" y1="168" x2="370" y2="168" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="285" y="160" text-anchor="middle" fill="var(--ink-faint)" font-size="11">except 类型不对,跳过</text>
<rect x="370" y="156" width="90" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="415" y="172" text-anchor="middle" fill="var(--ink)">finally</text>
<line x1="460" y1="168" x2="500" y2="168" stroke="var(--rule)"/><text x="505" y="172" fill="var(--ink-soft)">异常继续往外飞</text>
<text x="20" y="215" fill="var(--ink-faint)" font-size="11">三条路都要经过 finally;它不改变结局,只保证收尾一定执行。</text>
</g>
</svg>
<figcaption>try / except / finally 的三条路径。finally 是三条路的必经之地。</figcaption>
</figure>

## 把零件拼起来:批量校验工单

现在把今天四个零件拼成一个能用的小程序:一批工单逐张校验,合格的累加金额,不合格的跳过并记下原因,最后不管发生什么都打印一份汇总。新建 `part01/ticket_batch.py`:

```python
# agent-zero-lab/part01/ticket_batch.py
class TicketError(Exception):
    pass


def check_ticket(ticket: dict[str, str]) -> float:
    if ticket["title"].strip() == "":
        raise TicketError(f"{ticket['id']} 标题是空的")
    try:
        amount = float(ticket["amount"])
    except ValueError as e:
        raise TicketError(f"{ticket['id']} 金额不是数字: {ticket['amount']}") from e
    if amount < 0:
        raise TicketError(f"{ticket['id']} 金额不能是负数: {amount}")
    return amount


def process_batch(tickets: list[dict[str, str]]) -> float:
    total = 0.0
    done = 0
    failed: list[str] = []
    try:
        for t in tickets:
            try:
                total += check_ticket(t)
                done += 1
            except TicketError as e:
                failed.append(str(e))
    finally:
        print(f"处理完 {done} 张,跳过 {len(failed)} 张")
        for reason in failed:
            print("  跳过:", reason)
    return total


tickets = [
    {"id": "T-1001", "title": "发票抬头开错了", "amount": "199"},
    {"id": "T-1002", "title": "申请退款", "amount": "-50"},
    {"id": "T-1003", "title": "  ", "amount": "80"},
    {"id": "T-1004", "title": "扣费两次", "amount": "abc"},
    {"id": "T-1005", "title": "升级套餐", "amount": "399"},
]

print("合计金额:", process_batch(tickets))
print("---- 第二批少了一个字段 ----")
print("合计金额:", process_batch([tickets[0], {"id": "T-1006", "title": "没写金额"}]))
```

<div class="line-notes">

- `class TicketError(Exception):` 第二步的模板。
- `def check_ticket(ticket: dict[str, str]) -> float:` 和第二步不同,这次校验通过会返回金额,所以返回类型是 `float`。一个函数要么返回合格的金额,要么抛 TicketError,没有第三种结果。
- `if ticket["title"].strip() == "":` 第一道检查:标题。T-1003 的标题是两个空格,在这里被拦下。
- `raise TicketError(f"{ticket['id']} 标题是空的")` T-1003 得到 `T-1003 标题是空的`。
- `try:` 第二道检查包在 try 里,因为 `float()` 可能自己抛异常。
- `amount = float(ticket["amount"])` T-1004 的 `"abc"` 在这里抛 ValueError。
- `except ValueError as e:` 接住 ValueError。
- `raise TicketError(f"{ticket['id']} 金额不是数字: {ticket['amount']}") from e` 第三步的写法,翻译成 TicketError 并保留原因。T-1004 得到 `T-1004 金额不是数字: abc`。
- `if amount < 0:` 第三道检查:负数。T-1002 的 `-50.0` 在这里被拦下。
- `raise TicketError(f"{ticket['id']} 金额不能是负数: {amount}")` T-1002 得到 `T-1002 金额不能是负数: -50.0`。
- `return amount` 三道检查都过了才走到这里。T-1001 返回 `199.0`,T-1005 返回 `399.0`。
- `def process_batch(tickets: list[dict[str, str]]) -> float:` 参数是工单列表,返回合格工单的金额合计。
- `total = 0.0` 合计金额,从 0 开始。
- `done = 0` 处理成功的张数。
- `failed: list[str] = []` 失败原因清单,一开始是空列表。`: list[str]` 是给编辑器看的类型标注,意思是「装字符串的列表」。
- `try:` 外层 try,只配了一个 finally,目的是保证汇总一定打印。
- `for t in tickets:` 逐张处理。
- `try:` 内层 try,专门接单张工单的 TicketError。两层 try 各管各的:内层管「这一张不合格就跳过」,外层管「不管怎样都要汇总」。
- `total += check_ticket(t)` 合格就把金额加进总数。如果 check_ticket 抛了异常,这一行的加法根本不会发生,下一行 `done += 1` 也会被跳过。
- `done += 1` 第一批跑完 `done` 是 2(T-1001 和 T-1005)。
- `except TicketError as e:` 只接业务错误。
- `failed.append(str(e))` `str(e)` 把异常对象变成它那句话,存进清单。第一批跑完清单里有 3 条。
- `finally:` 外层 try 的收尾。
- `print(f"处理完 {done} 张,跳过 {len(failed)} 张")` 第一批实测 `处理完 2 张,跳过 3 张`。
- `for reason in failed:` 把失败原因逐条打出来。
- `print("  跳过:", reason)` 第一批实测打了三行,顺序和工单顺序一致:T-1002、T-1003、T-1004。
- `return total` 第一批返回 `199.0 + 399.0 = 598.0`。
- `tickets = [` 五张样本工单,一张正常、一张负数、一张空标题、一张金额不是数字、一张正常。
- `print("合计金额:", process_batch(tickets))` 实测 `合计金额: 598.0`。
- `print("---- 第二批少了一个字段 ----")` 第二批故意放一张缺 `amount` 键的工单,看看会怎样。
- `print("合计金额:", process_batch([tickets[0], {"id": "T-1006", "title": "没写金额"}]))` T-1001 正常处理;T-1006 在 `ticket["amount"]` 抛了 KeyError,它不是 TicketError,内层 except 接不住,一路飞出 process_batch。飞出去之前外层 finally 照样执行,实测打印 `处理完 1 张,跳过 0 张`,然后程序崩溃,`合计金额:` 这一行没打出来。

</div>

```bash
uv run python part01/ticket_batch.py
```

实测输出:

```text
处理完 2 张,跳过 3 张
  跳过: T-1002 金额不能是负数: -50.0
  跳过: T-1003 标题是空的
  跳过: T-1004 金额不是数字: abc
合计金额: 598.0
---- 第二批少了一个字段 ----
处理完 1 张,跳过 0 张
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/ticket_batch.py", line 46, in <module>
    print("合计金额:", process_batch([tickets[0], {"id": "T-1006", "title": "没写金额"}]))
                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File ".../agent-zero-lab/part01/ticket_batch.py", line 25, in process_batch
    total += check_ticket(t)
             ^^^^^^^^^^^^^^^
  File ".../agent-zero-lab/part01/ticket_batch.py", line 10, in check_ticket
    amount = float(ticket["amount"])
                   ~~~~~~^^^^^^^^^^
KeyError: 'amount'
```

第二批的崩溃是我故意留的,它把今天的两个知识点同时演示了一遍。`except TicketError` 只接自己人,所以 KeyError 穿了过去,这正是自定义异常的好处:我们没想到的错误不会被悄悄吞掉。外层 finally 在崩溃前把汇总打了出来,这正是 finally 的作用。至于缺字段该不该也算「工单数据有问题」,我觉得该算,练习 3 就是让你把它也翻译成 TicketError。

最后对一下零件:

| 前面的零件 | 在 ticket_batch.py 里是哪一段 |
| --- | --- |
| 第一步 raise_basic.py:`raise` 拦负数 | `check_ticket` 最后那个 `if amount < 0` |
| 第二步 ticket_error.py:自定义 `TicketError` | 文件开头两行,和 `check_ticket` 第一道标题检查 |
| 第三步 raise_from.py:`raise ... from e` | `check_ticket` 中间那个 try/except ValueError |
| 第四步 finally_crash.py:finally 收尾 | `process_batch` 外层 try/finally 打印汇总 |

这个 `check_ticket` 以后会换好几次样子:Day 51 学 pydantic 之后,三道检查会变成几行字段声明,pydantic 抛的 `ValidationError` 也是一个自定义异常,和今天的 TicketError 是一回事。

## 动手练习

**练习 1:优先级校验。** 写 `parse_priority(text)`,把字符串转成整数优先级,只接受 1 到 5,超出范围 `raise ValueError`。用 `"3"`、`"9"`、`"高"` 三个输入测试,每个都用 try 接住并打印结果。文件名 `part01/ex36_priority.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex36_priority.py
def parse_priority(text: str) -> int:
    level = int(text)
    if level < 1 or level > 5:
        raise ValueError(f"优先级只能是 1 到 5,收到 {level}")
    return level


for raw in ["3", "9", "高"]:
    try:
        print(raw, "->", parse_priority(raw))
    except ValueError as e:
        print(raw, "-> 出错:", e)
```

<div class="line-notes">

- `level = int(text)` `"3"` 得到 `3`;`"9"` 得到 `9`;`"高"` 在这里就抛了 `ValueError`,下面的检查都不会跑。
- `if level < 1 or level > 5:` `9 > 5` 成立。`or` 是 Day 17 学的「或」。
- `raise ValueError(f"优先级只能是 1 到 5,收到 {level}")` 代入 9,信息是 `优先级只能是 1 到 5,收到 9`。
- `for raw in ["3", "9", "高"]:` 三个测试输入。
- `print(raw, "->", parse_priority(raw))` `"3"` 实测打印 `3 -> 3`。
- `except ValueError as e:` 两种 ValueError 都在这里被接住:我们自己抛的,和 `int()` 抛的。
- `print(raw, "-> 出错:", e)` 实测 `9 -> 出错: 优先级只能是 1 到 5,收到 9` 和 `高 -> 出错: invalid literal for int() with base 10: '高'`。

</div>

实测输出:

```text
3 -> 3
9 -> 出错: 优先级只能是 1 到 5,收到 9
高 -> 出错: invalid literal for int() with base 10: '高'
```

注意后两行:一个是你写的中文提示,一个是 Python 的英文报错,都是 ValueError。这正好说明了第二步讲的问题,同一个类型装着两种来源。想区分它们,就该上自定义异常了。

</details>

**练习 2:异常的子类。** 在 `TicketError` 下面再定义一个 `AmountError(TicketError)`,专门表示金额问题。写 `check_amount(ticket_id, amount)`,负数时抛 `AmountError`。分别用 `except TicketError` 和 `except AmountError` 去接,看两种写法是不是都能接住,并打印异常真正的类型名。文件名 `part01/ex36_subclass.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex36_subclass.py
class TicketError(Exception):
    pass


class AmountError(TicketError):
    pass


def check_amount(ticket_id: str, amount: float) -> None:
    if amount < 0:
        raise AmountError(f"{ticket_id} 金额不能是负数: {amount}")


try:
    check_amount("T-1002", -50)
except TicketError as e:
    print("按 TicketError 接住:", e)
    print("它其实是:", type(e).__name__)

try:
    check_amount("T-1002", -50)
except AmountError as e:
    print("按 AmountError 接住:", e)
```

<div class="line-notes">

- `class TicketError(Exception):` 父类,和正文一样。
- `class AmountError(TicketError):` 括号里写的是 `TicketError`,所以它是 TicketError 的子类,也间接是 Exception 的子类。对照上面那张继承树图,它挂在 TicketError 下面。
- `raise AmountError(f"{ticket_id} 金额不能是负数: {amount}")` 传进来的是整数 `-50`,所以信息是 `-50` 而不是 `-50.0`。
- `except TicketError as e:` 用父类去接,能接住子类。
- `print("按 TicketError 接住:", e)` 实测 `按 TicketError 接住: T-1002 金额不能是负数: -50`。
- `print("它其实是:", type(e).__name__)` `type(e)` 拿到异常对象真正的类,`.__name__` 是类名字符串。实测 `它其实是: AmountError`。虽然是用父类接的,对象本身还是子类。
- `except AmountError as e:` 用子类本身去接,当然也行。
- `print("按 AmountError 接住:", e)` 实测 `按 AmountError 接住: T-1002 金额不能是负数: -50`。

</div>

实测输出:

```text
按 TicketError 接住: T-1002 金额不能是负数: -50
它其实是: AmountError
按 AmountError 接住: T-1002 金额不能是负数: -50
```

这就是异常分层的用处:批处理代码写 `except TicketError` 一网打尽;某个只关心金额的地方写 `except AmountError`,别的工单错误照样往外飞。requests、openai 这些库都是这么搭异常体系的。

</details>

**练习 3:缺字段也算工单错误。** 正文第二批工单崩在了 `KeyError: 'amount'`。修改 `check_ticket`,让缺 `title` 或 `amount` 字段时也抛 `TicketError`(用 `raise ... from`),再跑第二批,目标输出是 `处理完 1 张,跳过 1 张` 和 `合计金额: 199.0`。文件名 `part01/ex36_missing.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex36_missing.py
class TicketError(Exception):
    pass


def check_ticket(ticket: dict[str, str]) -> float:
    try:
        title = ticket["title"]
        raw_amount = ticket["amount"]
    except KeyError as e:
        raise TicketError(f"{ticket.get('id', '?')} 缺字段: {e}") from e
    if title.strip() == "":
        raise TicketError(f"{ticket['id']} 标题是空的")
    try:
        amount = float(raw_amount)
    except ValueError as e:
        raise TicketError(f"{ticket['id']} 金额不是数字: {raw_amount}") from e
    if amount < 0:
        raise TicketError(f"{ticket['id']} 金额不能是负数: {amount}")
    return amount


def process_batch(tickets: list[dict[str, str]]) -> float:
    total = 0.0
    done = 0
    failed: list[str] = []
    try:
        for t in tickets:
            try:
                total += check_ticket(t)
                done += 1
            except TicketError as e:
                failed.append(str(e))
    finally:
        print(f"处理完 {done} 张,跳过 {len(failed)} 张")
        for reason in failed:
            print("  跳过:", reason)
    return total


batch = [
    {"id": "T-1001", "title": "发票抬头开错了", "amount": "199"},
    {"id": "T-1006", "title": "没写金额"},
]
print("合计金额:", process_batch(batch))
```

<div class="line-notes">

- `try:` 新加的一段:先把两个字段取出来放进变量,取不到就在这里统一处理。
- `title = ticket["title"]` T-1006 有标题,取到 `"没写金额"`。
- `raw_amount = ticket["amount"]` T-1006 没有这个键,抛 `KeyError: 'amount'`。
- `except KeyError as e:` 接住。`e` 打印出来是 `'amount'`,带引号,就是那个缺的键名。
- `raise TicketError(f"{ticket.get('id', '?')} 缺字段: {e}") from e` `ticket.get('id', '?')` 是 Day 24 学的安全取值:连 id 都没有时用 `?` 代替,免得在报错的代码里又抛一个 KeyError。代入 T-1006,信息是 `T-1006 缺字段: 'amount'`。
- `if title.strip() == "":` 后面的检查改用前面取出来的变量 `title`,不再直接读字典。
- `amount = float(raw_amount)` 同理用 `raw_amount`。
- `raise TicketError(f"{ticket['id']} 金额不是数字: {raw_amount}") from e` 和正文一样。
- `def process_batch(tickets: list[dict[str, str]]) -> float:` 这个函数一个字都没改。错误的分类改在了 check_ticket 里,批处理代码完全不用动,这就是统一成一种异常类型的好处。
- `failed.append(str(e))` T-1006 这次被内层 except 接住了。
- `print(f"处理完 {done} 张,跳过 {len(failed)} 张")` 实测 `处理完 1 张,跳过 1 张`。
- `print("  跳过:", reason)` 实测 `  跳过: T-1006 缺字段: 'amount'`。
- `print("合计金额:", process_batch(batch))` 实测 `合计金额: 199.0`,这次没崩。

</div>

实测输出:

```text
处理完 1 张,跳过 1 张
  跳过: T-1006 缺字段: 'amount'
合计金额: 199.0
```

</details>

**练习 4:观察会发生什么。** 下面这段代码在 finally 里写了 `return`。先猜它会打印什么,再新建 `part01/finally_return.py` 跑一下。

```python
# agent-zero-lab/part01/finally_return.py
def risky() -> str:
    try:
        raise ValueError("出大事了")
    finally:
        return "一切正常"


print(risky())
```

<div class="line-notes">

- `raise ValueError("出大事了")` try 里抛了异常,没有 except 接它,按理说它会飞出函数让程序崩溃。
- `finally:` 飞出去之前先执行 finally。
- `return "一切正常"` finally 里的 return 把函数的结局整个换掉了:异常被丢弃,函数正常返回这句话。
- `print(risky())` 实测打印 `一切正常`,没有任何报错。

</div>

<details><summary>参考答案</summary>

实测输出:

```text
一切正常
```

那个 `ValueError("出大事了")` 凭空消失了,没有 traceback,没有退出码 1。原因是 finally 里的 `return` 会覆盖掉正在往外飞的异常。这在真实项目里是很难查的 bug:某个地方出了大事,日志里却一行都没有。规矩很简单,**finally 里只做收尾(打印、解锁、关闭),不写 return**。我用的 Python 3.12 对此一声不吭;我用 uv 临时装了 Python 3.14 再跑一遍,多了一行 `SyntaxWarning: 'return' in a 'finally' block`(这是 PEP 765 加的),但它只是警告,输出照样是 `一切正常`。

</details>

验收标准:四个练习文件都能用 `uv run python part01/文件名.py` 跑出和上面一致的输出;不看文章能默写出 `ticket_batch.py` 的 `check_ticket` 和 `process_batch`;能说清 `raise X from e` 和 except 里直接 `raise X` 的 traceback 有什么区别。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| raise | 主动抛出一个异常,相当于 JS 的 `throw`。写法 `raise ValueError("...")`,抛出后当前函数立刻停止 |
| 自定义异常 | 自己定义的异常类型,写成 `class TicketError(Exception): pass`,用来给某一类错误起专门的名字 |
| 继承(异常里的) | `class A(B)` 表示 A 是 B 的一种,`except B` 能接住 A。相当于 JS 的 `extends` |
| Exception | 几乎所有「普通」异常的共同父类。自定义异常都继承它 |
| BaseException | 所有异常的祖宗,`KeyboardInterrupt` 这种「用户要退出」的信号直接挂在它下面,不在 Exception 下面 |
| raise ... from e | 抛新异常的同时把原始异常 e 记为「原因」,traceback 里会显示 `The above exception was the direct cause of the following exception` |
| 重新抛出 | 在 except 里只写 `raise`,把刚接住的异常原样再扔出去 |
| finally | try 语句的收尾块,不管 try 正常结束、异常被接住还是异常没被接住,都会执行 |
| pass | 什么都不做的占位语句,用在语法上必须写点东西但你什么都不想写的地方 |
| issubclass | `issubclass(A, B)` 判断 A 是不是 B 的子类,返回 True/False |

## 常见误区

**raise 后面跟字符串会报错。** 从 JS 过来的人容易写 `raise "金额不对"`(JS 里 `throw "金额不对"` 是合法的)。Python 不行,实测报错:

```text
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/raise_string.py", line 2, in <module>
    raise "金额不对"
TypeError: exceptions must derive from BaseException
```

意思是「异常必须是 BaseException 的子类」。字符串不是异常,要包一层:`raise ValueError("金额不对")`。编辑器里 basedpyright 也会提前画红线,报 `Invalid exception class or object`。

**忘了写 raise,只写了异常对象。** 下面这段我真写过:

```python
if amount < 0:
    ValueError(f"金额不能是负数: {amount}")
```

它造出了一个异常对象,然后什么都没干就扔掉了。实测 `parse_amount("-20")` 照样返回 `-20.0`,没有任何报错。basedpyright 的 standard 档不会提醒这个;切到 recommended 档会给一条 `Result of call expression is of type "ValueError" and is not used`。看到异常类名前面没有 `raise`,就要警惕。

**用 except Exception 把自定义异常的好处抵消掉。** 有人图省事,批处理里写 `except Exception`,结果正文第二批那个 KeyError 也被当成「工单不合格」跳过了。看起来更稳,其实是把代码 bug 藏了起来,数据少了一张都没人发现。业务上能预料到的错误用自定义异常接,预料不到的让它崩出来。

**以为有了 finally 程序就不会崩。** finally 只保证收尾代码执行,不处理异常。`finally_crash.py` 里 finally 打印了「解锁工单」,程序照样崩了。要不崩,得有 except。

**在 finally 里 return 或 break。** 练习 4 演示过,它会把正在飞的异常吞掉,一点痕迹都不留。finally 里只做收尾。

**自定义异常继承 BaseException。** 继承了 BaseException 的异常,`except Exception` 接不住,很多库和框架的兜底处理也接不住,结果就是程序意外退出。永远继承 `Exception`(或者它的子类)。

## 学习资料

### 文档与文章

- [Python 官方教程 · 8. 错误和异常(中文)](https://docs.python.org/zh-cn/3.12/tutorial/errors.html):重点读 8.4「触发异常」、8.5「异常链」、8.6「用户自定义异常」、8.7「定义清理操作」,正好对应今天四步。
- [Python 标准库 · 内置异常(中文)](https://docs.python.org/zh-cn/3.12/library/exceptions.html):页面最底下有完整的「异常层次结构」,就是今天那张继承树的完整版,扫一眼知道有哪些内置异常就行。
- [MDN · throw(中文)](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Statements/throw):JS 那边的对照,看完你会发现两门语言的心智模型几乎一样。
- [菜鸟教程 · Python3 错误和异常](https://www.runoob.com/python3/python3-errors-execptions.html):中文、短,有 try/except/else/finally 的流程图,适合当速查。
- [Python工匠 · 异常处理的三个好习惯](https://github.com/piglei/one-python-craftsman/blob/master/zh_CN/6-three-rituals-of-exceptions-handling.md):朱雷的开源系列文章之一,讲了什么时候该抛、该接、该翻译异常,读完今天的内容再看正合适。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1XPzTBuE9z&autoplay=0&high_quality=1" title="Python 异常处理核心!raise 和 try-except 保姆级教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>水哥澎湃 · Python 异常处理核心!raise 和 try-except 保姆级教程 · 约 15 分钟,全程中文演示 raise 的用法,和今天第一步、第二步对着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1XUXVYwEvM&autoplay=0&high_quality=1" title="python异常处理-try的else和finaly" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT阿杰 · python异常处理-try的else和finaly · 4 分钟,讲 finally 的执行时机,顺带讲了今天没讲的 else 块(try 没出错时才执行),当拓展看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/NIWwJbo-9_8" title="Python Tutorial: Using Try/Except Blocks for Error Handling" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial: Using Try/Except Blocks for Error Handling · 英文,讲 try/except/else/finally 和手动 raise,节奏慢、例子清楚,开英文字幕能跟上。</figcaption>
</figure>

### 书籍

- 《Python 编程:从入门到实践(第 3 版)》,Eric Matthes 著,人民邮电出版社。第 10 章「文件和异常」,异常部分和今天的难度正好匹配,文件部分留到 Day 38 再看。
- 《Python 工匠:案例、技巧与工程实践》,朱雷著,人民邮电出版社 2022 年。有一章专讲异常与错误处理,偏工程经验,适合学完第一部分之后回头读。

### 开源项目与代码

- [openai-python 的 `_exceptions.py`](https://github.com/openai/openai-python/blob/main/src/openai/_exceptions.py):第二部分天天要用的库。打开看 `class APIError(OpenAIError)`、`class RateLimitError(APIStatusError)` 这几行,就是今天练习 2 的分层写法,只是层数更多。
- [requests 的 `exceptions.py`](https://github.com/psf/requests/blob/main/src/requests/exceptions.py):最有名的 HTTP 库的异常体系,一个文件全是 `class XxxError(...)`,很多类体里就是一个文档字符串,和我们的 `pass` 同理。

## 自测

1. `raise` 执行之后,同一个函数里它下面的代码还会执行吗?异常会去哪里?

<details><summary>答案</summary>

不会执行。异常立刻离开当前函数,交给调用它的地方;调用方如果有 try 且 except 类型对得上就被接住,否则继续往外一层飞,直到最外层还没人接,程序崩溃并打印 traceback。

</details>

2. 写出定义一个叫 `RefundError` 的自定义异常所需的最少代码。

<details><summary>答案</summary>

```python
class RefundError(Exception):
    pass
```

继承 `Exception`,类体用 `pass` 占位。

</details>

3. 有了 `except TicketError`,为什么还要专门定义 TicketError,而不是全部用 `ValueError`?

<details><summary>答案</summary>

`ValueError` 太常见,`float()`、`int()` 等内置函数都会抛,`except ValueError` 分不清是业务规则不满足还是别的地方出了问题。自定义类型让调用方只接住「工单数据不合格」这一类,其他意外照样冒出来,不会被误吞。

</details>

4. traceback 中间出现 `During handling of the above exception, another exception occurred` 和 `The above exception was the direct cause of the following exception`,分别说明代码是怎么写的?

<details><summary>答案</summary>

前者是在 except 块里直接 `raise 新异常`,没写 `from`,Python 只知道「处理时又出了一个异常」;后者是写了 `raise 新异常 from e`,明确表示原异常是新异常的直接原因。两者都保留了原始错误,但后者的意思更准确。

</details>

5. 下面函数调用 `f()` 会打印什么,最终返回什么?

```python
def f() -> int:
    try:
        return 1
    finally:
        print("收尾")
```

<details><summary>答案</summary>

先打印 `收尾`,然后返回 `1`。try 里的 return 会先等 finally 跑完再真正返回(和 `finally_order.py` 实测一致)。如果 finally 里也写了 return,就会覆盖掉 1,这是要避免的写法。

</details>

## 明天预告

[Day 37 · 路径:pathlib](/blog/agent-zero/day-037-pathlib/)。今天的工单还是写死在代码里的列表,真实情况下它们在文件里。读文件之前得先找到文件:文件在哪个目录、路径怎么拼、文件存不存在、一个目录下有哪些 `.json`。明天用 pathlib 把这些事做了,顺便你会再见到 Day 35 的老朋友 `FileNotFoundError`。
