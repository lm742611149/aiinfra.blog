---
title: 'Day 46 · 类型标注(二):X | None、容器类型和 Any'
description: '用 Ticket | None 逼自己处理「没找到」,看 if t is None 怎么把类型收窄;读懂 list[str]、dict[str, int]、tuple[str, float] 的方括号;再看 Any 为什么是检查器的盲区。最后把一个带 3 条红线的统计脚本修到 0 errors。'
pubDate: 2026-10-22
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 46
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 45](/blog/agent-zero/day-045-type-hints-1/) 讲了类型标注的基础写法:`amount: float`、`rate: float = 0.06`、`-> str`、`-> None`,以及最重要的一句,**Python 运行时不看标注**。要靠 `uv run basedpyright`(standard 档)去读标注、找错,一条报错拆成位置、级别、说明、规则名来读。最后写了一个完整标注的 `typed_report.py`,里面用了一个还没正式讲的 `list[Ticket]`。

今天把剩下的常用写法补齐。真实代码里有两类东西 Day 45 的写法盖不住:一类是「可能没有」的值,比如按工单号去找,可能找不到;另一类是装着一堆东西的容器,列表、字典、元组。外加一个「什么都不查」的 Any,它在读 JSON 时天天出现。

## 今天要解决的问题

学完今天,你应该能:

1. 用 `X | None` 标注「可能没有」的返回值和参数,读懂 `reportOptionalMemberAccess` 这类红线,并用 `if x is None:` 把类型收窄后再用。
2. 写出 `list[str]`、`dict[str, int]`、`tuple[str, float]`、`tuple[float, ...]`、`set[str]`,知道空容器什么时候必须写标注。
3. 说清 Any 和 object 的区别,知道 `json.loads` 的结果为什么是 Any、为什么危险。
4. 把 `stats_buggy.py` 里的 3 条红线全部修掉,得到 `0 errors` 的 `ticket_stats.py`。

预计用时:2.5 小时。前置:[Day 45](/blog/agent-zero/day-045-type-hints-1/) 装好的 basedpyright 和 pyproject.toml 里的 standard 配置、[Day 14](/blog/agent-zero/day-014-bool-none/) 的 None、[Day 21](/blog/agent-zero/day-021-lists/) 到 [Day 26](/blog/agent-zero/day-026-nested-data/) 的列表、元组、字典、集合、[Day 43](/blog/agent-zero/day-043-classes-3/) 的 `ticket_model.py`、[Day 44](/blog/agent-zero/day-044-notebook-project/) 的 `part01/data/notebook.json`。

学法:先对照文章逐行敲一遍(不要复制粘贴)并跑通;第二天合上文章,把 `ticket_stats.py` 默写出来;再做动手练习,做不出来再展开参考答案,看完关掉自己重写一遍。

命令都在项目根目录 `agent-zero-lab` 里跑,新文件放进 `part01/`。今天不装新依赖,不调 API,花费 0 元。下面检查结果里的路径一律缩短成文件名。

## 第一步:可能没有的值,`Ticket | None`

Day 44 的 `TicketBook.find` 找不到工单时会 raise。另一种常见做法是返回 None,让调用方自己决定怎么办,Python 标准库的 `dict.get` 就是这样。可返回 None 有个老问题:调用方很容易忘了检查。前端你一定见过这个:

```text
TypeError: Cannot read properties of null (reading 'close')
```

TS 开了 `strictNullChecks` 以后,`find` 的返回类型写成 `Ticket | null`,你直接 `.close()` 它会报 `'t' is possibly 'null'`。Python 的写法几乎一样,只是 null 换成 None。新建 `part01/none_find.py`:

```python
# agent-zero-lab/part01/none_find.py
from ticket_model import Ticket


def find(tickets: list[Ticket], id: str) -> Ticket | None:
    for t in tickets:
        if t.id == id:
            return t
    return None


tickets = [Ticket("T-1001", "发票抬头开错了", 199), Ticket("T-1002", "升级套餐", 399)]
print(find(tickets, "T-1002"))
print(find(tickets, "T-9999"))
find(tickets, "T-9999").close()
```

<div class="line-notes">

- `def find(tickets: list[Ticket], id: str) -> Ticket | None:` 返回类型 `Ticket | None` 读作「Ticket 或者 None」。`|` 在类型标注里是「或」,叫联合类型(union),和 TS 的 `Ticket | null` 一个意思。`list[Ticket]` 第三步讲。
- `return t` 找到了,返回那张工单。
- `return None` 循环走完没找到。其实不写这一行,函数结束时也会返回 None,但写出来读的人一眼就知道「这里是没找到」。
- `print(find(tickets, "T-1002"))` 找得到,打印走 `__str__`。
- `print(find(tickets, "T-9999"))` 找不到,打印 None。
- `find(tickets, "T-9999").close()` 故意不检查就调方法。

</div>

先检查,再运行:

```bash
uv run basedpyright part01/none_find.py
uv run python part01/none_find.py
```

实测输出:

```text
none_find.py:15:25 - error: "close" is not a known attribute of "None" (reportOptionalMemberAccess)
1 error, 0 warnings, 0 notes
[open] T-1002 升级套餐 ¥399
None
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/none_find.py", line 15, in <module>
    find(tickets, "T-9999").close()
    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AttributeError: 'NoneType' object has no attribute 'close'
```

检查器说:`close` 不是 None 的已知属性。它的意思是「这个值有可能是 None,None 上没有 close」。规则名 `reportOptionalMemberAccess` 拆开看:Optional(可能为空)、Member Access(点出属性)。运行时的报错和前端那条几乎一字不差,`'NoneType' object has no attribute 'close'`,只是 JS 说 null、Python 说 NoneType。

返回类型写成 `Ticket | None`,等于在函数签名上贴了张条子:「我可能什么都不给你」。检查器会盯着每个调用处,你不处理 None 就不放行。

### 老写法 Optional

你在别人的代码、老教程、甚至一些库的文档里会看到另一种写法:

```python
from typing import Optional

def find(tickets: list[Ticket], id: str) -> Optional[Ticket]: ...
```

`Optional[Ticket]` 和 `Ticket | None` 完全等价。`X | None` 这种写法是 Python 3.10 才有的(PEP 604),之前只能用 Optional。我们项目是 3.12,一律写 `X | None`,更短,和 TS 也更像。看到 Optional 时心里翻译一下就行。注意 Optional 这个名字容易误导:它说的是「值可能是 None」,和「参数可以不传」没关系,参数能不能不传看的是有没有默认值。

## 第二步:if x is None,把类型收窄

拿到 `Ticket | None` 以后怎么用?先判断一下是不是 None,检查器会跟着你的 if 走。新建 `part01/none_narrow.py`:

```python
# agent-zero-lab/part01/none_narrow.py
from typing import reveal_type

from ticket_model import Ticket


def find(tickets: list[Ticket], id: str) -> Ticket | None:
    for t in tickets:
        if t.id == id:
            return t
    return None


def close_one(tickets: list[Ticket], id: str) -> str:
    t = find(tickets, id)
    reveal_type(t)
    if t is None:
        return f"没有这张工单: {id}"
    reveal_type(t)
    t.close()
    return f"已关闭 {t}"


def greet(name: str | None = None) -> str:
    if name is None:
        return "你好"
    return f"你好,{name}"


tickets = [Ticket("T-1001", "发票抬头开错了", 199), Ticket("T-1002", "升级套餐", 399)]
print(close_one(tickets, "T-1001"))
print(close_one(tickets, "T-9999"))
print(greet())
print(greet("李雷"))
```

<div class="line-notes">

- `from typing import reveal_type` Day 45 学的,让检查器报出它眼里的类型。
- `def find(` 和上一个文件一样,这里复制一份,免得导入 none_find.py 时把它底下那几行也执行了。
- `t = find(tickets, id)` 这里 t 的类型是 `Ticket | None`。
- `reveal_type(t)` 第一次看。
- `if t is None:` 判断是不是 None 要用 `is`,不用 `==`。None 在整个程序里只有一个,`is` 比的是「是不是同一个对象」,又快又准([Day 14](/blog/agent-zero/day-014-bool-none/) 讲过)。
- `return f"没有这张工单: {id}"` None 的情况先处理掉,直接返回。这种「先把特殊情况打发走」的写法叫提前返回(early return),前端写组件时的 `if (!data) return <Empty />` 就是它。
- `reveal_type(t)` 走到这里的,一定不是 None。
- `t.close()` 没有红线了。
- `def greet(name: str | None = None) -> str:` 参数也能是 `X | None`,配上默认值 None,就是「可以不传,不传就是 None」。
- `if name is None:` 同样先处理 None。
- `print(greet())` 不传参数。

</div>

```bash
uv run basedpyright part01/none_narrow.py
uv run python part01/none_narrow.py
```

实测输出:

```text
none_narrow.py:16:17 - information: Type of "t" is "Ticket | None"
none_narrow.py:19:17 - information: Type of "t" is "Ticket"
0 errors, 0 warnings, 2 notes
Runtime type is 'Ticket'
Runtime type is 'Ticket'
已关闭 [closed] T-1001 发票抬头开错了 ¥199
Runtime type is 'NoneType'
没有这张工单: T-9999
你好
你好,李雷
```

看检查结果那两行:同一个变量 t,在第 16 行是 `Ticket | None`,过了 `if t is None: return` 之后的第 19 行就只剩 `Ticket`。检查器知道:是 None 的那条路已经 return 出去了,能走到第 19 行的只能是 Ticket。这叫**类型收窄**(narrowing)。TS 里完全一样的机制也叫 narrowing,你写 `if (t === null) return;` 之后 TS 就不再提醒 possibly null。

运行时那几行 `Runtime type is ...` 是 reveal_type 在运行时打的(第二次查 T-9999 时,第二个 reveal_type 根本没走到,所以只多出一行 NoneType)。正式代码里 reveal_type 用完要删掉。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="find 返回 Ticket 或 None,if t is None 分成两条路:None 那条提前返回,另一条里 t 被收窄成 Ticket,可以安全调用 close">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="210" y="16" width="220" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="41" text-anchor="middle" fill="var(--ink)">t = find(tickets, id)</text>
<text x="450" y="41" fill="var(--ink-soft)" font-size="11">t: Ticket | None</text>
<line x1="320" y1="56" x2="320" y2="80" stroke="var(--rule)"/>
<rect x="240" y="80" width="160" height="36" rx="4" fill="none" stroke="var(--rule)"/>
<text x="320" y="103" text-anchor="middle" fill="var(--ink)">if t is None:</text>
<line x1="280" y1="116" x2="150" y2="150" stroke="var(--rule)"/>
<line x1="360" y1="116" x2="490" y2="150" stroke="var(--rule)"/>
<text x="180" y="138" fill="var(--ink-faint)" font-size="11">是</text>
<text x="450" y="138" fill="var(--ink-faint)" font-size="11">不是</text>
<rect x="40" y="150" width="220" height="70" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="150" y="176" text-anchor="middle" fill="var(--ink)">return "没有这张工单"</text>
<text x="150" y="198" text-anchor="middle" fill="var(--ink-soft)" font-size="11">t: None,提前离开</text>
<rect x="380" y="150" width="220" height="70" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="490" y="176" text-anchor="middle" fill="var(--ink)">t.close()</text>
<text x="490" y="198" text-anchor="middle" fill="var(--ink-soft)" font-size="11">t: Ticket,不再有红线</text>
</g>
</svg>
<figcaption>类型收窄:检查器沿着 if 的两条路分别记住 t 是什么。None 那条路 return 了,剩下那条路上 t 只可能是 Ticket。</figcaption>
</figure>

### 你天天在用的 `X | None`:dict.get

Day 24 学过 `dict.get(键)`,键不存在时返回 None 而不是抛 KeyError。所以它的返回类型就是 `值类型 | None`。新建 `part01/dict_get_none.py`:

```python
# agent-zero-lab/part01/dict_get_none.py
from typing import Optional, reveal_type

prices = {"basic": 99, "pro": 399}
p = prices.get("team")
reveal_type(p)
print(p)
print(p + 10)


def old_style(name: Optional[str] = None) -> str:
    return name or "匿名"
```

<div class="line-notes">

- `prices = {"basic": 99, "pro": 399}` 套餐价格,检查器推断为 `dict[str, int]`。
- `p = prices.get("team")` 没有 team 这个键。
- `reveal_type(p)` 看看 get 的返回类型。
- `print(p + 10)` 拿可能是 None 的值做加法。
- `def old_style(name: Optional[str] = None) -> str:` 老写法,只是让你看看它长什么样,检查器对它没意见。
- `return name or "匿名"` `or` 在左边为假(None、空字符串)时取右边,Day 17 学的真值。它也能把 `str | None` 变成 str,但空字符串 `""` 也会被换成「匿名」,要想清楚这是不是你要的。

</div>

```bash
uv run basedpyright part01/dict_get_none.py
uv run python part01/dict_get_none.py
```

实测输出(traceback 只留最后三行):

```text
dict_get_none.py:6:13 - information: Type of "p" is "int | None"
dict_get_none.py:8:7 - error: Operator "+" not supported for "None" (reportOptionalOperand)
1 error, 0 warnings, 1 note
Runtime type is 'NoneType'
None
    print(p + 10)
          ~~^~~~
TypeError: unsupported operand type(s) for +: 'NoneType' and 'int'
```

`int | None`,而且检查器换了个规则名 `reportOptionalOperand`:可能为 None 的值不能当运算的一边(operand,操作数)。修法有两种:要么先 `if p is None:` 处理掉,要么给 get 传默认值 `prices.get("team", 0)`,这时返回类型就是纯 int。检查器怎么知道这两种调用返回类型不同?标准库的类型写在 typeshed 仓库里(学习资料有链接),`dict.get` 在那里写了好几个版本:不传默认值的返回 `_VT | None`,传了和值同类型的默认值就返回 `_VT`。`_VT` 是「值的类型」的占位符,[Day 49](/blog/agent-zero/day-049-type-hints-4/) 讲 TypeVar 时会再见到它。

## 第三步:容器类型,方括号里写装的是什么

Day 45 的标注都是「一个值」。容器(装着很多值的东西)要写两层:外面是容器本身,方括号里是装的东西。新建 `part01/containers.py`:

```python
# agent-zero-lab/part01/containers.py
from typing import reveal_type

titles: list[str] = ["发票抬头开错了", "升级套餐"]
counts: dict[str, int] = {"billing": 2, "account": 1}
pair: tuple[str, float] = ("T-1004", 89.5)
amounts: tuple[float, ...] = (199, 399, 89.5)
tags: set[str] = {"退款", "发票"}

titles.append("扣费两次")
counts["refund"] = counts.get("refund", 0) + 1
print(titles, counts, pair, amounts, sorted(tags), sep="\n")

for k, v in counts.items():
    reveal_type(v)
reveal_type(pair[1])

titles.append(120)
counts["refund"] = "一张"
pair = ("T-1005", 120, "open")
print(titles, counts, pair, sep="\n")
```

<div class="line-notes">

- `titles: list[str] = [` 字符串组成的列表,≈ TS 的 `string[]`。列表里每一项都是同一种类型,方括号里只写一个。
- `counts: dict[str, int] = {` 键是 str、值是 int 的字典,方括号里写两个,先键后值,≈ TS 的 `Record<string, number>`。
- `pair: tuple[str, float] = ("T-1004", 89.5)` 元组每个位置写一个类型:第 0 位 str、第 1 位 float,长度固定为 2,≈ TS 的 `[string, number]`。
- `amounts: tuple[float, ...] = (199, 399, 89.5)` 后面跟 `...` 表示「任意多个 float」,这时元组当只读列表用。
- `tags: set[str] = {"退款", "发票"}` 字符串集合,≈ TS 的 `Set<string>`。
- `counts["refund"] = counts.get("refund", 0) + 1` 传了默认值 0,get 的结果就是 int,可以直接加。refund 原来不存在,算完是 1。
- `print(titles, counts, pair, amounts, sorted(tags), sep="\n")` 集合打印的顺序每次运行可能不一样,用 `sorted` 排一下,输出才固定。`sep="\n"` 让每个参数各占一行。
- `for k, v in counts.items():` Day 24 学的遍历字典。
- `reveal_type(v)` 检查器知道 v 是 int,因为字典声明了值是 int。
- `reveal_type(pair[1])` 取元组第 1 位,检查器知道是 float。
- `titles.append(120)` 错误 1:往字符串列表里放数字。
- `counts["refund"] = "一张"` 错误 2:值应该是 int。
- `pair = ("T-1005", 120, "open")` 错误 3:声明是两个位置,给了三个。

</div>

```bash
uv run basedpyright part01/containers.py
uv run python part01/containers.py
```

检查的实测输出:

```text
containers.py:15:17 - information: Type of "v" is "int"
containers.py:16:13 - information: Type of "pair[1]" is "float"
containers.py:18:15 - error: Argument of type "Literal[120]" cannot be assigned to parameter "object" of type "str" in function "append"
    "Literal[120]" is not assignable to "str" (reportArgumentType)
containers.py:19:1 - error: Argument of type "Literal['一张']" cannot be assigned to parameter "value" of type "int" in function "__setitem__"
    "Literal['一张']" is not assignable to "int" (reportArgumentType)
containers.py:20:8 - error: Type "tuple[Literal['T-1005'], Literal[120], Literal['open']]" is not assignable to declared type "tuple[str, float]"
    "tuple[Literal['T-1005'], Literal[120], Literal['open']]" is not assignable to "tuple[str, float]"
      Tuple size mismatch; expected 2 but received 3 (reportAssignmentType)
3 errors, 0 warnings, 2 notes
```

运行的实测输出:

```text
['发票抬头开错了', '升级套餐', '扣费两次']
{'billing': 2, 'account': 1, 'refund': 1}
('T-1004', 89.5)
(199, 399, 89.5)
['发票', '退款']
Runtime type is 'int'
Runtime type is 'int'
Runtime type is 'int'
Runtime type is 'float'
['发票抬头开错了', '升级套餐', '扣费两次', 120]
{'billing': 2, 'account': 1, 'refund': '一张'}
('T-1005', 120, 'open')
```

三条错误里有两条值得多看一眼。

第 19 行那条说的是 `__setitem__` 函数的 value 参数。你写的是 `counts["refund"] = "一张"`,哪来的函数?这是 Python 的规矩:`字典[键] = 值` 背后调用的是字典的 `__setitem__(键, 值)` 方法,和 Day 43 的 `__repr__` 一样是魔术方法。检查器报错时用的是它的「真名」,知道这个就不会被吓到。

第 20 行那条有三层缩进,最里面一层 `Tuple size mismatch; expected 2 but received 3` 才是最直接的原因:长度不对。长报错从最里层往外读,往往更快找到重点。

运行结果是更要紧的证据:三行错误代码**全都执行成功了**,列表里混进了整数 120,字典里混进了字符串,元组变成三个元素,Python 一声没吭。下游谁拿 `titles` 去做字符串拼接、拿 `counts` 去求和,谁就崩。容器类型标注的价值就在这里:运行时根本不管你往容器里放什么,只有检查器管。

把今天的容器写法和 TS 并排放一下:

| Python | TypeScript | 读作 |
| --- | --- | --- |
| `list[str]` | `string[]` | 字符串列表 |
| `dict[str, int]` | `Record<string, number>` | 键 str、值 int 的字典 |
| `tuple[str, float]` | `[string, number]` | 两个位置,各有类型 |
| `tuple[float, ...]` | `readonly number[]` | 任意多个 float 的元组 |
| `set[str]` | `Set<string>` | 字符串集合 |
| `list[Ticket]` | `Ticket[]` | Ticket 列表 |
| `dict[str, list[str]]` | `Record<string, string[]>` | 值是字符串列表的字典 |

最后一行是套娃:方括号里还能再写容器类型,和 [Day 26](/blog/agent-zero/day-026-nested-data/) 的嵌套数据一一对应,练习 2 会用到。

### 老写法 List、Dict

和 Optional 一样,你会在老代码里看到 `from typing import List, Dict, Tuple, Set`,写成 `List[str]`、`Dict[str, int]`(首字母大写)。Python 3.9 之前内置的 list、dict 不能写方括号,只能从 typing 导入大写版本;3.9 起(PEP 585)小写的就能直接用,大写版本在官方文档里被标成了 deprecated(不推荐,将来可能删)。我们一律写小写。练习 3 会把一段老写法改成新写法。

### 空容器要写标注

建一个空列表准备往里放东西,是最常见的写法之一。空列表里什么都没有,检查器猜不出将来放什么。新建 `part01/empty_list.py`:

```python
# agent-zero-lab/part01/empty_list.py
from typing import reveal_type

found = []
reveal_type(found)
found.append("T-1001")
found.append(3)

ids: list[str] = []
reveal_type(ids)
ids.append("T-1001")
ids.append(3)
```

<div class="line-notes">

- `found = []` 不写标注的空列表。
- `found.append(3)` 往里混放一个整数,看检查器管不管。
- `ids: list[str] = []` 写了标注的空列表。
- `ids.append(3)` 同样混放整数。

</div>

```bash
uv run basedpyright part01/empty_list.py
```

实测输出:

```text
empty_list.py:5:13 - information: Type of "found" is "list[Unknown]"
empty_list.py:10:13 - information: Type of "ids" is "list[str]"
empty_list.py:12:12 - error: Argument of type "Literal[3]" cannot be assigned to parameter "object" of type "str" in function "append"
    "Literal[3]" is not assignable to "str" (reportArgumentType)
1 error, 0 warnings, 2 notes
```

`found` 是 `list[Unknown]`,Day 45 说过 Unknown 就是检查器放弃了,所以往里放什么都不报。`ids` 写了 `list[str]`,第 12 行立刻红线。规矩很简单:**空容器写标注**。Day 44 的 `self.tickets: list[Ticket] = []` 就是这么写的,现在你知道为什么了。

## 第四步:Any,检查器的盲区

最后一个是 Any,意思是「什么类型都行」。它在 Day 39 就出现过:`dict[str, Any]` 表示值什么类型都可能有。Any 最常见的来源是 `json.loads`:JSON 里可能是对象、数组、数字、字符串,标准库没法提前知道,只好把返回类型写成 Any。新建 `part01/any_demo.py`:

```python
# agent-zero-lab/part01/any_demo.py
import json
from pathlib import Path
from typing import Any, reveal_type

BOOK = Path(__file__).resolve().parent / "data" / "notebook.json"

data = json.loads(BOOK.read_text(encoding="utf-8"))
reveal_type(data)
first: dict[str, Any] = data[0]
reveal_type(first["amount"])
print(first["title"])
print(first["amount"].upper())
```

<div class="line-notes">

- `from typing import Any, reveal_type` Any 也从 typing 导入。
- `BOOK = Path(__file__).resolve().parent / "data" / "notebook.json"` Day 44 的记事本文件。
- `data = json.loads(BOOK.read_text(encoding="utf-8"))` 读出来是一个工单字典组成的列表。
- `reveal_type(data)` 看看检查器认为它是什么。
- `first: dict[str, Any] = data[0]` 第一张工单,键是 str,值什么都有(字符串、数字)。
- `reveal_type(first["amount"])` 取出金额。
- `print(first["title"])` 实测打印 `发票抬头开错了`。
- `print(first["amount"].upper())` 金额是数字,数字没有 upper。检查器会说什么?

</div>

```bash
uv run basedpyright part01/any_demo.py
uv run python part01/any_demo.py
```

实测输出(traceback 只留最后三行):

```text
any_demo.py:9:13 - information: Type of "data" is "Any"
any_demo.py:11:13 - information: Type of "first["amount"]" is "Any"
0 errors, 0 warnings, 2 notes
Runtime type is 'list'
Runtime type is 'int'
发票抬头开错了
    print(first["amount"].upper())
          ^^^^^^^^^^^^^^^^^^^^^
AttributeError: 'int' object has no attribute 'upper'
```

`0 errors`。对 Any 的值,你点什么方法、做什么运算,检查器都放行,就像那段代码没写标注一样。这和 TS 的 `any` 一模一样:一旦是 any,`x.whatever.you.want()` 统统不报。Any 还会「传染」:从 Any 里取出来的 `first["amount"]` 还是 Any。

既然这么危险,为什么还要有 Any?因为总有检查器确实没法知道类型的地方,JSON、网络请求的结果、模型返回的内容都是。Any 的意思是「这里我先不查,由你自己负责」。

TS 后来加了一个更安全的 `unknown`:类型也不确定,但不许直接用,得先判断。Python 里对应的是 `object`。新建 `part01/object_demo.py`:

```python
# agent-zero-lab/part01/object_demo.py
import json
from pathlib import Path

BOOK = Path(__file__).resolve().parent / "data" / "notebook.json"

first: object = json.loads(BOOK.read_text(encoding="utf-8"))[0]
print(first["amount"].upper())
if isinstance(first, dict):
    print(first["title"])
```

<div class="line-notes">

- `first: object = json.loads` 把 Any 收进一个标着 object 的变量。object 是所有类型的祖先(Day 42 学继承时提过,每个类最终都继承自 object),什么值都能放进来。
- `print(first["amount"].upper())` 对 object 直接用方括号取值。
- `if isinstance(first, dict):` `isinstance(值, 类)` 判断值是不是某个类的实例,≈ JS 的 `instanceof`。检查器会像 `is None` 一样跟着它收窄。
- `print(first["title"])` 判断过是 dict 以后再取。

</div>

```bash
uv run basedpyright part01/object_demo.py
```

实测输出:

```text
object_demo.py:8:7 - error: "__getitem__" method not defined on type "object" (reportIndexIssue)
1 error, 0 warnings, 0 notes
```

只有第 8 行报错(`__getitem__` 是方括号取值背后的魔术方法,和刚才的 `__setitem__` 是一对),第 10 行在 isinstance 判断之后,检查器放行了。

| | Any | object |
| --- | --- | --- |
| 什么值都能放进来 | 能 | 能 |
| 不判断就直接用 | 放行,不报错 | 报错 |
| TS 里对应 | `any` | `unknown` |
| 什么时候用 | 实在没法写清类型,且你愿意自己负责 | 类型不确定,但想逼自己先判断 |

我的建议:在自己写的函数签名里尽量不出现 Any;从 json.loads 这种地方拿到 Any 后,尽快把它变成有类型的东西。最可靠的办法是 Day 44 已经在做的:`ticket_from_dict(d)` 把字典变成 Ticket,一路校验过去,之后用的都是 Ticket。明天的 TypedDict 和 Day 51 的 pydantic 是这条路的升级版。

## 把零件拼起来:修 3 条红线

下面这个统计脚本是我按「一开始随手写」的样子写的,里面藏着 3 个今天讲的错。新建 `part01/stats_buggy.py`,原样敲:

```python
# agent-zero-lab/part01/stats_buggy.py
from pathlib import Path

from ticket_model import Ticket, load

BOOK = Path(__file__).resolve().parent / "data" / "notebook.json"


def find(tickets: list[Ticket], id: str) -> Ticket | None:
    for t in tickets:
        if t.id == id:
            return t
    return None


def count_by_status(tickets: list[Ticket]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for t in tickets:
        counts[t.status] = counts.get(t.status) + 1
    return counts


def big_ids(tickets: list[Ticket], limit: float = 100) -> list[str]:
    return [t for t in tickets if t.amount >= limit]


def title_of(tickets: list[Ticket], id: str) -> str:
    return find(tickets, id).title


tickets = load(BOOK)
print(title_of(tickets, "T-1004"))
print(big_ids(tickets))
print(count_by_status(tickets))
```

<div class="line-notes">

- `def count_by_status(tickets: list[Ticket]) -> dict[str, int]:` 按状态数张数,应该得到 `{'closed': 1, 'open': 3}`。
- `counts[t.status] = counts.get(t.status) + 1` 坑 1:get 没给默认值,第一次遇到某个状态时是 None + 1。
- `def big_ids(tickets: list[Ticket], limit: float = 100) -> list[str]:` 金额不低于 limit 的工单号。
- `return [t for t in tickets if t.amount >= limit]` 坑 2:推导式前面写的是 t,收集的是整张工单,不是工单号。
- `return find(tickets, id).title` 坑 3:find 可能返回 None。
- `print(title_of(tickets, "T-1004"))` T-1004 存在,所以这一行运行时不会出事。

</div>

先运行,看看「只靠运行」能发现几个:

```bash
uv run python part01/stats_buggy.py
```

实测输出(traceback 只留最后三行):

```text
扣费两次
[Ticket(id='T-1001', title='发票抬头开错了', amount=199, status='closed'), Ticket(id='T-1002', title='升级套餐 年付', amount=399, status='open'), Ticket(id='T-1005', title='API 调用超额', amount=120, status='open')]
    counts[t.status] = counts.get(t.status) + 1
                       ~~~~~~~~~~~~~~~~~~~~~^~~
TypeError: unsupported operand type(s) for +: 'NoneType' and 'int'
```

运行时只崩了一个。另外两个更阴:`title_of` 因为查的 T-1004 正好存在,一点事没有,换成不存在的工单号才会炸;`big_ids` 返回了一串 Ticket 而不是工单号,不崩,但结果是错的,要等有人拿它去拼字符串才会发现。再检查:

```bash
uv run basedpyright part01/stats_buggy.py
```

实测输出:

```text
stats_buggy.py:19:28 - error: Operator "+" not supported for "None" (reportOptionalOperand)
stats_buggy.py:24:12 - error: Type "list[Ticket]" is not assignable to return type "list[str]" (reportReturnType)
stats_buggy.py:28:30 - error: "title" is not a known attribute of "None" (reportOptionalMemberAccess)
3 errors, 0 warnings, 0 notes
```

三个一次全出来,而且都是今天学过的规则名。修好后另存为 `part01/ticket_stats.py`,顺便加一个返回元组的函数,再把调用放进 `if __name__ == "__main__":`:

```python
# agent-zero-lab/part01/ticket_stats.py
from pathlib import Path

from ticket_model import Ticket, load

BOOK = Path(__file__).resolve().parent / "data" / "notebook.json"


def find(tickets: list[Ticket], id: str) -> Ticket | None:
    for t in tickets:
        if t.id == id:
            return t
    return None


def count_by_status(tickets: list[Ticket]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for t in tickets:
        counts[t.status] = counts.get(t.status, 0) + 1
    return counts


def big_ids(tickets: list[Ticket], limit: float = 100) -> list[str]:
    return [t.id for t in tickets if t.amount >= limit]


def title_of(tickets: list[Ticket], id: str) -> str | None:
    t = find(tickets, id)
    if t is None:
        return None
    return t.title


def amount_range(tickets: list[Ticket]) -> tuple[float, float] | None:
    if not tickets:
        return None
    amounts = [t.amount for t in tickets]
    return min(amounts), max(amounts)


if __name__ == "__main__":
    tickets = load(BOOK)
    print(title_of(tickets, "T-1004"))
    print(title_of(tickets, "T-9999"))
    print(big_ids(tickets))
    print(big_ids(tickets, limit=300))
    print(count_by_status(tickets))
    print(amount_range(tickets))
    print(amount_range([]))
```

<div class="line-notes">

- `def find(tickets: list[Ticket], id: str) -> Ticket | None:` 没改,它本身是对的,错在用它的人。
- `counts: dict[str, int] = {}` 空字典写标注,第三步的规矩。
- `counts[t.status] = counts.get(t.status, 0) + 1` 修 1:给 get 默认值 0,返回类型从 `int | None` 变成 int。
- `return [t.id for t in tickets if t.amount >= limit]` 修 2:收集 `t.id`。这个错检查器能抓到,全靠返回类型写了 `list[str]`;要是写成不带方括号的 `list`,它就看不出来了。
- `def title_of(tickets: list[Ticket], id: str) -> str | None:` 修 3:找不到时这个函数也没有标题可给,老实把返回类型改成 `str | None`,把「可能没有」继续告诉调用方。另一种修法是找不到时 raise,像 Day 44 的 find 那样。两种都对,看调用方更想要哪种。
- `if t is None:` 收窄。
- `return t.title` 这里 t 已经是 Ticket。
- `def amount_range(tickets: list[Ticket]) -> tuple[float, float] | None:` 返回最小和最大金额两个值,用元组;空列表时没有最小最大,返回 None。`|` 的两边可以是任何类型,包括容器。
- `if not tickets:` 空列表为假。不先判断的话,`min([])` 会抛 `ValueError`。
- `return min(amounts), max(amounts)` Day 22 学过,return 后面用逗号隔开就是返回元组。
- `print(title_of(tickets, "T-9999"))` 找不到的情况也跑一下。
- `print(big_ids(tickets, limit=300))` 只有 399 那张不低于 300。
- `print(amount_range([]))` 空列表的情况。

</div>

```bash
uv run basedpyright part01/ticket_stats.py
uv run python part01/ticket_stats.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
扣费两次
None
['T-1001', 'T-1002', 'T-1005']
['T-1002']
{'closed': 1, 'open': 3}
(89.5, 399)
None
```

`big_ids` 默认 limit 是 100,89.5 那张不够,剩下三张;最小金额 89.5、最大 399。和 Day 45 一样,如果你的 T-1004 是 99.5,第六行是 `(99.5, 399)`,其余不变。

| 今天的零件 | 在 ticket_stats.py 里是哪一段 |
| --- | --- |
| 第一步 `X \| None` 返回值 | `find`、`title_of`、`amount_range` 的返回类型 |
| 第二步 `if x is None` 收窄 | `title_of` 里的提前返回 |
| 第二步 dict.get 的 `int \| None` | `count_by_status` 里的 `get(..., 0)` |
| 第三步 容器类型 | `list[Ticket]`、`list[str]`、`dict[str, int]`、`tuple[float, float]` |
| 第三步 空容器写标注 | `counts: dict[str, int] = {}` |
| 第四步 Any | `load` 里面 json.loads 的 Any,由 `ticket_from_dict` 变成 Ticket,这个文件里就再也见不到 Any |

## 动手练习

### 练习 1:可能算不出来的平均数

在 `part01/ex46_average.py` 里写 `average(amounts: list[float]) -> float | None`:空列表返回 None,否则返回平均值(保留两位)。再写一个 `show(amounts)` 返回一句话:没有数据时说「没有数据」,有数据时说平均和含税(6%)金额。basedpyright 要 0 errors。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex46_average.py
def average(amounts: list[float]) -> float | None:
    if not amounts:
        return None
    return round(sum(amounts) / len(amounts), 2)


def show(amounts: list[float]) -> str:
    avg = average(amounts)
    if avg is None:
        return "没有数据"
    return f"平均 ¥{avg},含税 ¥{round(avg * 1.06, 2)}"


print(show([199, 399, 89.5, 120]))
print(show([]))
```

<div class="line-notes">

- `def average(amounts: list[float]) -> float | None:` 空列表没有平均数,用 None 表示「算不出来」,比返回 0 诚实:0 是一个真实的平均数,None 才是「没有」。
- `if not amounts:` 不先判断,`len([])` 是 0,除以 0 会抛 ZeroDivisionError。
- `return round(sum(amounts) / len(amounts), 2)` (199 + 399 + 89.5 + 120) / 4 = 807.5 / 4 = 201.875,保留两位是 201.88。
- `avg = average(amounts)` avg 的类型是 `float | None`。
- `if avg is None:` 收窄。去掉这两行,下面的 `avg * 1.06` 会报 reportOptionalOperand。
- `return f"平均 ¥{avg},含税 ¥{round(avg * 1.06, 2)}"` 201.88 × 1.06 = 213.9928,保留两位 213.99。
- `print(show([199, 399, 89.5, 120]))` 列表里混着 int 和 float,标的是 `list[float]`,检查器允许,原因同 Day 45:int 能当 float 用。

</div>

```bash
uv run basedpyright part01/ex46_average.py
uv run python part01/ex46_average.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
平均 ¥201.88,含税 ¥213.99
没有数据
```

</details>

### 练习 2:套娃容器

写 `group_titles(tickets: list[Ticket]) -> dict[str, list[str]]`,把记事本里的工单按状态分组,值是标题列表。读 `part01/data/notebook.json`,打印每组的状态、张数和标题。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex46_group.py
from pathlib import Path

from ticket_model import Ticket, load

BOOK = Path(__file__).resolve().parent / "data" / "notebook.json"


def group_titles(tickets: list[Ticket]) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = {}
    for t in tickets:
        groups.setdefault(t.status, []).append(t.title)
    return groups


groups = group_titles(load(BOOK))
for status, titles in groups.items():
    print(status, len(titles), titles)
```

<div class="line-notes">

- `def group_titles(tickets: list[Ticket]) -> dict[str, list[str]]:` 字典的值本身是字符串列表,≈ TS 的 `Record<string, string[]>`。
- `groups: dict[str, list[str]] = {}` 空字典,必须标注,不然检查器不知道值是列表。
- `groups.setdefault(t.status, []).append(t.title)` `setdefault(键, 默认值)`:键存在就返回已有的值,不存在就先放进默认值再返回它。所以第一次遇到 open 时放一个空列表,之后每次拿到的都是同一个列表,往里 append。检查器知道 setdefault 返回 `list[str]`,所以 append 一个整数会红线。
- `for status, titles in groups.items():` status 是 str,titles 是 `list[str]`,检查器都知道。

</div>

```bash
uv run basedpyright part01/ex46_group.py
uv run python part01/ex46_group.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
closed 1 ['发票抬头开错了']
open 3 ['升级套餐 年付', '扣费两次', 'API 调用超额']
```

</details>

### 练习 3:把老写法翻成新写法

下面是一段老写法的代码。先原样敲进 `part01/ex46_old_style.py`,检查并运行;再把 typing 里的大写类型全部换成今天的写法,删掉不再需要的 import,结果要一模一样。

```python
# agent-zero-lab/part01/ex46_old_style.py
from typing import Dict, List, Optional


def first_open(titles: List[str], closed: Dict[str, bool]) -> Optional[str]:
    for t in titles:
        if not closed.get(t, False):
            return t
    return None


print(first_open(["发票抬头开错了", "升级套餐"], {"发票抬头开错了": True}))
```

<div class="line-notes">

- `from typing import Dict, List, Optional` 老代码的标配 import。
- `def first_open(titles: List[str], closed: Dict[str, bool]) -> Optional[str]:` 返回第一个没关闭的标题,全关了就返回 None。
- `if not closed.get(t, False):` 字典里没有的标题当成没关闭。

</div>

<details><summary>参考答案</summary>

老写法检查实测 `0 errors, 0 warnings, 0 notes`,运行打印 `升级套餐`。standard 档不会因为你用了老写法就报错,它只是过时,不是错。

新写法:

```python
# agent-zero-lab/part01/ex46_old_style.py
def first_open(titles: list[str], closed: dict[str, bool]) -> str | None:
    for t in titles:
        if not closed.get(t, False):
            return t
    return None


print(first_open(["发票抬头开错了", "升级套餐"], {"发票抬头开错了": True}))
```

<div class="line-notes">

- `def first_open(titles: list[str], closed: dict[str, bool]) -> str | None:` `List` → `list`,`Dict` → `dict`,`Optional[str]` → `str | None`。三个都是内置名字或语法,import 那一行整行删掉。

</div>

检查还是 `0 errors`,运行还是 `升级套餐`。对照表:`List[X]` → `list[X]`,`Dict[K, V]` → `dict[K, V]`,`Tuple[...]` → `tuple[...]`,`Set[X]` → `set[X]`,`Optional[X]` → `X | None`,`Union[A, B]` → `A | B`。

</details>

### 练习 4:Any 能骗过检查器

新建 `part01/ex46_any_trap.py`,把 json.loads 的结果直接塞进一个标着 `list[Ticket]` 的变量,然后用 Ticket 的 property。先猜检查器会不会报错,再运行。

```python
# agent-zero-lab/part01/ex46_any_trap.py
import json
from pathlib import Path

from ticket_model import Ticket

BOOK = Path(__file__).resolve().parent / "data" / "notebook.json"

tickets: list[Ticket] = json.loads(BOOK.read_text(encoding="utf-8"))
print(type(tickets[0]))
print(tickets[0].is_closed)
```

<div class="line-notes">

- `tickets: list[Ticket] = json.loads(` 你在标注里「声称」这是 Ticket 列表。
- `print(type(tickets[0]))` `type(值)` 看值实际是什么类。
- `print(tickets[0].is_closed)` Ticket 有 is_closed,字典没有。

</div>

<details><summary>参考答案</summary>

检查实测 `0 errors, 0 warnings, 0 notes`。运行实测:

```text
<class 'dict'>
Traceback (most recent call last):
  ...
AttributeError: 'dict' object has no attribute 'is_closed'
```

Any 可以赋给任何类型的变量,检查器不会怀疑。你写了 `list[Ticket]`,它就信了,后面所有检查都建立在这句假话上。真实的值是字典组成的列表,`.is_closed` 当场崩。

所以标注不等于转换:写 `list[Ticket]` 不会把字典变成 Ticket。正确做法是真的去造对象:`tickets = [Ticket.from_dict(d) for d in json.loads(...)]`(Day 43 的类方法),或者直接用 `ticket_model.load(BOOK)`。从 Any 到有类型的那一步,必须有代码真正做事。

</details>

### 练习 5:给 notebook 加一个不抛异常的查找

Day 44 的 `TicketBook.find` 找不到会 raise。在不改 notebook.py 的前提下,新建 `part01/ex46_maybe.py`,写一个函数 `maybe_find(book: TicketBook, id: str) -> Ticket | None`,内部调 `book.find`,把 TicketError 转成 None;然后用它查 T-1002 和 T-9999,各打印一句话。basedpyright 要 0 errors。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex46_maybe.py
from notebook import BOOK, TicketBook
from ticket_model import Ticket, TicketError


def maybe_find(book: TicketBook, id: str) -> Ticket | None:
    try:
        return book.find(id)
    except TicketError:
        return None


book = TicketBook(BOOK)
for id in ["T-1002", "T-9999"]:
    t = maybe_find(book, id)
    if t is None:
        print(f"{id}: 没找到")
    else:
        print(f"{id}: {t.title},{'已关' if t.is_closed else '未关'}")
```

<div class="line-notes">

- `from notebook import BOOK, TicketBook` 导入 Day 44 的记事本。notebook.py 底下有 `if __name__ == "__main__":`,导入时不会执行命令分发。
- `def maybe_find(book: TicketBook, id: str) -> Ticket | None:` 参数类型是我们自己写的 TicketBook 类。
- `return book.find(id)` 找到了直接返回 Ticket。
- `except TicketError:` 只接业务异常,把「没找到」翻译成 None。Day 44 讲过别接 Exception。
- `if t is None:` 收窄,else 分支里 t 是 Ticket。
- `print(f"{id}: {t.title},{'已关' if t.is_closed else '未关'}")` 用 Ticket 的属性,没有红线。

</div>

```bash
uv run basedpyright part01/ex46_maybe.py
uv run python part01/ex46_maybe.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
T-1002: 升级套餐 年付,未关
T-9999: 没找到
```

raise 和返回 None 是两种风格:raise 适合「找不到就是出错了」的场合(Day 44 用户敲错工单号);返回 None 适合「找不到很正常」的场合(查一下有没有,没有就新建)。不管选哪种,都要在类型上说清楚,`-> Ticket` 的函数就不该偷偷返回 None。

</details>

验收标准:`uv run basedpyright part01/ticket_stats.py part01/ex46_average.py part01/ex46_group.py part01/ex46_maybe.py` 输出 `0 errors`;`ticket_stats.py` 的运行输出和正文一致(T-1004 的金额以你的数据为准);不看文章能写出 `list[str]`、`dict[str, int]`、`tuple[str, float]`、`X | None` 四种写法,并能用 `if x is None:` 把一条 reportOptionalMemberAccess 修掉;能说清 Any 和 object 的区别。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 联合类型(union) | 用 `\|` 连起来的类型,`int \| str` 表示「int 或 str」,≈ TS 的联合类型 |
| `X \| None` | 「X 或者 None」,表示值可能没有,≈ TS 开了 strictNullChecks 后的 `X \| null` |
| Optional | `typing.Optional[X]`,`X \| None` 的老写法,两者完全等价 |
| 类型收窄(narrowing) | 检查器跟着 `if x is None`、`isinstance` 等判断,在分支里把类型缩小 |
| 提前返回(early return) | 先处理特殊情况并 return,剩下的代码只处理正常情况 |
| reportOptionalMemberAccess | 对可能为 None 的值点属性或方法 |
| reportOptionalOperand | 拿可能为 None 的值做运算 |
| 容器类型 / 泛型容器 | 带方括号写明内容的类型,`list[str]`、`dict[str, int]`,方括号里是装的东西 |
| `tuple[float, ...]` | 任意长度、每项都是 float 的元组 |
| `__setitem__` / `__getitem__` | `d[k] = v` 和 `d[k]` 背后调用的魔术方法,报错里常见 |
| Any | 「什么类型都行」,检查器对它完全不检查,≈ TS 的 `any` |
| object | 所有类型的祖先,什么都能放,但不判断就不让用,≈ TS 的 `unknown` |
| `isinstance(值, 类)` | 判断值是不是某个类的实例,≈ JS 的 `instanceof`,检查器会据此收窄 |
| typeshed | 存放 Python 标准库类型标注的官方仓库,检查器从这里知道 `dict.get` 返回什么 |
| deprecated | 「不推荐,将来可能删」,typing 里的 List、Dict 这些大写别名就是 |

## 常见误区

**拿到 `X | None` 直接用。** `find(...).close()` 检查器实测报 `"close" is not a known attribute of "None"`,运行时是 `AttributeError: 'NoneType' object has no attribute 'close'`。先 `if t is None:` 处理掉。

**用 `== None` 判断。** 能跑,但约定是 `is None`。None 只有一个,比身份更准;而且有些类会改写 `==` 的行为,`==` 不一定靠得住。

**`dict.get` 不给默认值就做运算。** `counts.get(k) + 1` 实测 reportOptionalOperand,运行时第一次遇到新键就 `TypeError: unsupported operand type(s) for +: 'NoneType' and 'int'`。计数时写 `get(k, 0)`。

**空列表、空字典不写标注。** `found = []` 实测是 `list[Unknown]`,往里放什么检查器都不管。写成 `found: list[str] = []`。

**以为标了容器类型,运行时就进不去别的东西。** `titles.append(120)` 实测照样进去,列表变成 `[..., 120]`。容器类型只有检查器在看。

**以为写了 `list[Ticket]` 就会把 JSON 变成 Ticket。** 标注不做转换。`tickets: list[Ticket] = json.loads(...)` 检查 0 errors,运行时 `'dict' object has no attribute 'is_closed'`。用 `Ticket.from_dict` 真正造对象。

**到处写 Any 图省事。** Any 让检查器在那一片完全失明,而且会传染给从它取出的值。签名里尽量不写 Any;类型确实不确定时考虑 object,判断后再用。

**以为 Optional 是「可以不传」。** `Optional[str]` 只说值可能是 None。参数能不能不传看有没有默认值:`name: str | None` 没默认值时照样必须传。

## 学习资料

### 文档与文章

- [Python 标准库 · typing(中文)](https://docs.python.org/zh-cn/3.12/library/typing.html):今天查三处:`Any`、`Optional`(里面专门提醒了它和「可选参数」不是一回事)、文末「泛型具体容器」那一节里 List、Dict 被标为已弃用别名的说明。
- [TypeScript Handbook · Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html):TS 的类型收窄,`typeof`、真值判断、`instanceof` 和今天的 `is None`、`isinstance` 是同一套思路,你会很快看懂。
- [mypy · Type hints cheat sheet](https://mypy.readthedocs.io/en/stable/cheat_sheet_py3.html):Useful built-in types 那一节把今天的容器写法和 `X | None` 都列了,适合打印出来贴着。
- [PEP 604](https://peps.python.org/pep-0604/) 和 [PEP 585](https://peps.python.org/pep-0585/):`X | Y` 写法和小写容器写法的来历,英文,知道它们分别从 3.10 和 3.9 开始就够了。
- [pyright 文档 · Type Inference](https://github.com/microsoft/pyright/blob/main/docs/type-inference.md):basedpyright 底下的 pyright 怎么推断类型,里面有一节专讲空列表 `[]` 推断成什么,和第三步的实验对得上。英文,挑那一节看。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1qS4y1h7ee&autoplay=0&high_quality=1" title="【python技巧005】注解不是注释！彻底弄懂所有的&quot;注解&quot;怎么写" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>__阿岳__ · 【python技巧005】注解不是注释!彻底弄懂所有的"注解"怎么写 · 约 12 分钟,把容器、Optional、Union 的写法过了一遍。视频是 2022 年的,里面的大写 List、Optional 心里按练习 3 的对照表翻译成新写法。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ipsjebEek&autoplay=0&high_quality=1" title="【中配】Python中的“typing”模块：即将弃用 - Indently" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>黑纹白斑马(搬运 Indently,中文配音)· Python 中的 typing 模块:即将弃用 · 约 7 分钟,专讲为什么 List、Dict、Optional 这些大写写法不推荐了,正好配第三步和练习 3。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/QORvB-_mbZ0" title="Python Typing - Type Hints & Annotations" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Tech With Tim · Python Typing - Type Hints &amp; Annotations · 英文,从基础标注讲到 List、Dict、Optional、Any,用 mypy 演示报错,和这两天的内容重合度很高。视频比较早,用的是 typing 里的大写写法。</figcaption>
</figure>

### 书籍

- 《流畅的 Python(第 2 版)》,Luciano Ramalho 著,人民邮电出版社,2023。第 8 章「函数中的类型提示」后半讲 Optional 和 Union、泛化容器、元组类型和 Any,今天读这部分。书里对 Any 和 object 的对比讲得很透,和第四步的表格可以互相印证。

### 开源项目与代码

- [python/typeshed](https://github.com/python/typeshed):打开 `stdlib/builtins.pyi`,搜 `def get(self, key: _KT`,能看到 dict.get 的三个版本,第一个就是 `def get(self, key: _KT, default: None = None, /) -> _VT | None`,这就是第二步里 `p` 变成 `int | None` 的出处。再打开 `stdlib/json/__init__.pyi` 搜 `def loads`,返回类型是 `-> Any`,第四步的 Any 就从这里来。

## 自测

1. 函数签名是 `def find(tickets: list[Ticket], id: str) -> Ticket | None`,直接写 `find(ts, "T-1").title` 检查器会报什么规则?怎么改?

<details><summary>答案</summary>

`reportOptionalMemberAccess`,说明是 `"title" is not a known attribute of "None"`。先存到变量里,`if t is None:` 处理掉(return、raise 或给默认值),之后 t 被收窄成 Ticket,再用 `t.title`。

</details>

2. 把下面三个 TS 类型翻成 Python:`string[]`、`Record<string, number>`、`[string, number]`。

<details><summary>答案</summary>

`list[str]`、`dict[str, int]`(数字要是可能有小数就写 `dict[str, float]`)、`tuple[str, float]`。

</details>

3. `prices = {"basic": 99}`,`prices.get("pro")` 和 `prices.get("pro", 0)` 的类型分别是什么?

<details><summary>答案</summary>

前者是 `int | None`,键不存在时返回 None;后者是 `int`,键不存在时返回默认值 0。typeshed 里 dict.get 按「传没传默认值」写了不同版本的返回类型。

</details>

4. `found = []` 和 `found: list[str] = []` 在检查器眼里有什么区别?

<details><summary>答案</summary>

前者是 `list[Unknown]`,检查器不知道里面该放什么,往里放什么都不报;后者是 `list[str]`,放整数会报 reportArgumentType。空容器要写标注。

</details>

5. Any 和 object 都能接收任何值,区别在哪?各对应 TS 的什么?

<details><summary>答案</summary>

Any 接收后,对它做什么检查器都放行,对应 TS 的 `any`;object 接收后,不判断类型就不让用(点方法、方括号取值都报错),要先用 isinstance 收窄,对应 TS 的 `unknown`。

</details>

## 明天预告

[Day 47 · 类型标注(三):TypedDict 和 Literal](/blog/agent-zero/day-047-type-hints-3/)。今天 Any 那一步留了个尾巴:`dict[str, Any]` 说不清「这个字典里有哪几个键、每个键是什么类型」,status 也只写得出 str,写成 `"clsoed"` 检查器不管。明天用 TypedDict 给工单字典定形状(≈ TS 的 interface),用 Literal 把 status 限定成 `"open"` 和 `"closed"` 两个值(≈ TS 的字面量联合类型),写出一份工单类型定义。
