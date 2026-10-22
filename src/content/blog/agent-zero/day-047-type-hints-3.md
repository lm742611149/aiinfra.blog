---
title: 'Day 47 · 类型标注(三):TypedDict 和 Literal'
description: '用 TypedDict 给工单字典定形状(≈ TS 的 interface),键名拼错、少键、多键、值类型不对全会红线;用 Literal 把 status 限定成 open 和 closed 两个值(≈ TS 的字面量联合类型),再看 in 判断怎么把 str 收窄成 Literal。最后写一份带校验的工单类型定义 ticket_types.py。'
pubDate: 2026-10-22
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 47
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 46](/blog/agent-zero/day-046-type-hints-2/) 讲了三样东西:`Ticket | None` 逼你处理「没找到」,`if t is None:` 之后检查器把类型收窄成 Ticket;容器的方括号写法 `list[str]`、`dict[str, int]`、`tuple[str, float]`;还有 Any,检查器碰到它就完全不查,`json.loads` 返回的就是它。

Day 46 结尾留了个尾巴。工单读出来是字典,我们一直标成 `dict[str, Any]`。这个标注只说了「键是字符串」,至于有哪几个键、每个键的值是什么类型,一个字没说。status 也只能写成 str,`"clsoed"` 这种拼错的值检查器不管。今天用两个新工具把这两个洞补上。

## 今天要解决的问题

学完今天,你应该能:

1. 用 `TypedDict` 写出一个字典的「形状」(有哪些键、每个键什么类型),说出它和 TS `interface` 的对应关系,并用 `NotRequired` 标出可以没有的键。
2. 用 `Literal["open", "closed"]` 把一个值限定在几个固定选项里,读懂它的红线,并用 `if x in ("open", "closed"):` 把普通 str 收窄成 Literal。
3. 亲手验证 TypedDict 和 Literal 在运行时都不做检查,从 JSON 进来的数据要自己写校验。
4. 写出 `part01/ticket_types.py`:`Status`、`TicketDict`、`parse_status`、`parse_ticket`,basedpyright 0 errors。

预计用时:2.5 小时。前置:[Day 45](/blog/agent-zero/day-045-type-hints-1/) 的 basedpyright(standard 档)和读红线的方法、[Day 46](/blog/agent-zero/day-046-type-hints-2/) 的 `X | None`、收窄和 Any、[Day 24](/blog/agent-zero/day-024-dicts/) 的字典和 `get`、[Day 39](/blog/agent-zero/day-039-json/) 的 `json.loads`、[Day 43](/blog/agent-zero/day-043-classes-3/) 的 `ticket_model.py`(里面有 `TicketError`)、[Day 44](/blog/agent-zero/day-044-notebook-project/) 的 `part01/data/notebook.json`。

学法:先对照文章逐行敲一遍(不要复制粘贴)并跑通;第二天合上文章,把 `ticket_types.py` 默写出来;再做动手练习,做不出来再展开参考答案,看完关掉自己重写一遍。

命令都在项目根目录 `agent-zero-lab` 里跑,新文件放进 `part01/`。今天不装新依赖,不调 API,花费 0 元。下面检查结果里的路径一律缩短成文件名。

## 先看问题:`dict[str, Any]` 什么都拦不住

Day 46 第四步说过,Any 让检查器失明。工单字典标成 `dict[str, Any]`,值全是 Any,会发生什么?新建 `part01/dict_any_typo.py`:

```python
# agent-zero-lab/part01/dict_any_typo.py
from typing import Any

ticket: dict[str, Any] = {"id": "T-1004", "title": "扣费两次", "amount": 89.5, "status": "open"}

print(ticket["title"])
print(ticket["amount"] + 10)
ticket["status"] = "clsoed"
print(ticket["status"])
print(ticket["amout"])
```

<div class="line-notes">

- `ticket: dict[str, Any] = {` Day 39 起我们读 JSON 一直这么标。键是 str,值什么都行。
- `print(ticket["amount"] + 10)` 89.5 + 10 = 99.5,这一行是对的。
- `ticket["status"] = "clsoed"` closed 拼错了,字母 o 和 s 换了位置。
- `print(ticket["amout"])` 键名拼错,少了一个 n。

</div>

```bash
uv run basedpyright part01/dict_any_typo.py
uv run python part01/dict_any_typo.py
```

实测输出(traceback 路径缩短了):

```text
0 errors, 0 warnings, 0 notes
扣费两次
99.5
clsoed
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/dict_any_typo.py", line 10, in <module>
    print(ticket["amout"])
          ~~~~~~^^^^^^^^^
KeyError: 'amout'
```

两个错,检查器一个都没报。键名拼错运行时至少还会 KeyError;状态拼错连崩都不崩,`clsoed` 被老老实实存进去,打印出来,以后再存回 JSON。等哪天你按 `status == "closed"` 统计已关工单,这一张永远数不进去,而且没有任何报错提醒你。

前端的你遇到同样的问题会怎么做?写个 interface:

```ts
interface Ticket {
  id: string;
  title: string;
  amount: number;
  status: "open" | "closed";
}
```

这一段 TS 里有两个东西:`interface` 规定对象有哪些键,`"open" | "closed"` 规定 status 只能是这两个字符串之一。Python 里分别叫 TypedDict 和 Literal,今天一个一个来。

## 第一步:TypedDict,给字典定形状

新建 `part01/typed_dict_basic.py`:

```python
# agent-zero-lab/part01/typed_dict_basic.py
from typing import TypedDict, reveal_type


class TicketDict(TypedDict):
    id: str
    title: str
    amount: float
    status: str


ticket: TicketDict = {"id": "T-1004", "title": "扣费两次", "amount": 89.5, "status": "open"}
reveal_type(ticket["amount"])
print(ticket["amount"] + 10)
print(type(ticket))
print(ticket == {"id": "T-1004", "title": "扣费两次", "amount": 89.5, "status": "open"})

print(ticket["amout"])
ticket["amount"] = "八十九"
bad: TicketDict = {"id": "T-1005", "title": "API 调用超额"}
```

<div class="line-notes">

- `from typing import TypedDict, reveal_type` TypedDict 也在 Day 45 介绍过的 typing 工具箱里。
- `class TicketDict(TypedDict):` 写法借用了 class 语法:类名、括号里写 TypedDict。看着像 Day 42 的继承,但它不是真的造一个类,而是**声明一种字典的形状**,作用等同于 TS 的 `interface TicketDict { ... }`。名字后缀 Dict 是我的习惯,提醒自己「这是字典,不是 Ticket 对象」。
- `id: str` 每一行是「键名: 值的类型」,没有等号,不写默认值。这四行就是 interface 里那四行。
- `ticket: TicketDict = {` 标注成 TicketDict 后,检查器会拿右边的字典逐键对照形状。
- `reveal_type(ticket["amount"])` 取 amount,检查器应该知道它是 float,不再是 Any。
- `print(ticket["amount"] + 10)` 99.5。
- `print(type(ticket))` 看运行时它到底是什么。
- `print(ticket == {` 和一个普通字典比较。
- `print(ticket["amout"])` 错误 1:键名拼错。
- `ticket["amount"] = "八十九"` 错误 2:值类型不对。
- `bad: TicketDict = {"id": "T-1005", "title": "API 调用超额"}` 错误 3:少了 amount 和 status 两个键。

</div>

```bash
uv run basedpyright part01/typed_dict_basic.py
uv run python part01/typed_dict_basic.py
```

检查的实测输出:

```text
typed_dict_basic.py:13:13 - information: Type of "ticket["amount"]" is "float"
typed_dict_basic.py:18:7 - error: Could not access item in TypedDict
    "amout" is not a defined key in "TicketDict" (reportGeneralTypeIssues)
typed_dict_basic.py:19:1 - error: Could not assign item in TypedDict
    "Literal['八十九']" is not assignable to "float" (reportGeneralTypeIssues)
typed_dict_basic.py:20:19 - error: Type "dict[str, str]" is not assignable to declared type "TicketDict"
    "amount" is required in "TicketDict"
    "status" is required in "TicketDict" (reportAssignmentType)
3 errors, 0 warnings, 1 note
```

运行的实测输出(路径缩短了):

```text
Runtime type is 'float'
99.5
<class 'dict'>
True
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/typed_dict_basic.py", line 18, in <module>
    print(ticket["amout"])
          ~~~~~~^^^^^^^^^
KeyError: 'amout'
```

先看检查结果。和开头的 `dict[str, Any]` 比,变化很大:

- `ticket["amount"]` 不再是 Any,而是 float。检查器知道每个键对应什么类型,点出来的值也是有类型的,后面再拿它做什么都能接着查。
- 第 18 行键名拼错:`"amout" is not a defined key in "TicketDict"`,amout 不是 TicketDict 定义过的键。规则名是 `reportGeneralTypeIssues`,一个比较笼统的名字,看主说明就行。
- 第 19 行给 amount 赋字符串:`"Literal['八十九']" is not assignable to "float"`。
- 第 20 行少键:缩进那两行分别告诉你 amount 和 status 是 required(必须有的)。

再看运行结果,有两行要记住。`type(ticket)` 打印的是 `<class 'dict'>`,和一个普通字典比较是 `True`。TypedDict 在运行时**什么都不是**,它造出来的就是一个普通字典,不多一个属性、不多一个方法。这和 TS 的 interface 编译后完全消失是一个道理。

所以 TypedDict 和 Day 40 的 Ticket 类是两种东西,别混:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="三种描述工单的方式对比:dict[str, Any] 检查器什么都不知道;TypedDict 检查器知道键和类型,运行时是普通 dict;class Ticket 运行时是 Ticket 对象,有方法和 setter 校验">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="20" width="192" height="210" rx="4" fill="none" stroke="var(--rule)"/>
<text x="112" y="44" text-anchor="middle" fill="var(--ink)">dict[str, Any]</text>
<text x="112" y="80" text-anchor="middle" fill="var(--ink-soft)" font-size="11">检查时:</text>
<text x="112" y="98" text-anchor="middle" fill="var(--ink-soft)" font-size="11">只知道键是 str</text>
<text x="112" y="116" text-anchor="middle" fill="var(--ink-soft)" font-size="11">值全是 Any,不查</text>
<text x="112" y="152" text-anchor="middle" fill="var(--ink-soft)" font-size="11">运行时:</text>
<text x="112" y="170" text-anchor="middle" fill="var(--ink-soft)" font-size="11">普通 dict</text>
<text x="112" y="210" text-anchor="middle" fill="var(--ink-faint)" font-size="11">≈ TS 的 Record&lt;string, any&gt;</text>
<rect x="224" y="20" width="192" height="210" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="44" text-anchor="middle" fill="var(--ink)">TicketDict(TypedDict)</text>
<text x="320" y="80" text-anchor="middle" fill="var(--ink-soft)" font-size="11">检查时:</text>
<text x="320" y="98" text-anchor="middle" fill="var(--ink-soft)" font-size="11">知道有哪几个键</text>
<text x="320" y="116" text-anchor="middle" fill="var(--ink-soft)" font-size="11">每个键是什么类型</text>
<text x="320" y="152" text-anchor="middle" fill="var(--ink-soft)" font-size="11">运行时:</text>
<text x="320" y="170" text-anchor="middle" fill="var(--ink-soft)" font-size="11">还是普通 dict</text>
<text x="320" y="210" text-anchor="middle" fill="var(--ink-faint)" font-size="11">≈ TS 的 interface</text>
<rect x="432" y="20" width="192" height="210" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="528" y="44" text-anchor="middle" fill="var(--ink)">class Ticket</text>
<text x="528" y="80" text-anchor="middle" fill="var(--ink-soft)" font-size="11">检查时:</text>
<text x="528" y="98" text-anchor="middle" fill="var(--ink-soft)" font-size="11">知道属性和方法</text>
<text x="528" y="116" text-anchor="middle" fill="var(--ink-soft)" font-size="11">t.close() 能补全</text>
<text x="528" y="152" text-anchor="middle" fill="var(--ink-soft)" font-size="11">运行时:</text>
<text x="528" y="170" text-anchor="middle" fill="var(--ink-soft)" font-size="11">Ticket 对象,setter 会校验</text>
<text x="528" y="210" text-anchor="middle" fill="var(--ink-faint)" font-size="11">≈ TS 的 class</text>
</g>
</svg>
<figcaption>中间这一列是今天的 TypedDict:检查器眼里它和右边一样清楚,运行时却和左边一样只是个字典。取值写 t["amount"],不是 t.amount。</figcaption>
</figure>

什么时候用 TypedDict,什么时候用类?我的经验是看数据要去哪儿。数据本来就是字典、最后还要变回字典的(读写 JSON、发给模型的消息、HTTP 请求体),用 TypedDict,省得来回转换;数据要带行为的(关闭工单、校验金额),用类。后面你会反复碰到 TypedDict:openai 的 Python SDK 里,发给模型的每条消息的类型就是 TypedDict(练习 5 会看到源码),[Day 302](/blog/agent-zero/day-302-lg-state-styles/) 的 LangGraph 状态也可以写成 TypedDict。

### 可以没有的键:NotRequired

Day 43 的 `Ticket.from_dict` 里有一句 `d.get("status", "open")`,意思是 JSON 里可以不写 status,不写就当 open。TS 里这种键写成 `status?: string`。TypedDict 里用 `NotRequired[...]` 把值类型包起来。新建 `part01/typed_dict_more.py`:

```python
# agent-zero-lab/part01/typed_dict_more.py
from typing import NotRequired, TypedDict, reveal_type


class NewTicket(TypedDict):
    title: str
    amount: float
    status: NotRequired[str]


a = NewTicket(title="发票抬头开错了", amount=199)
b: NewTicket = {"title": "升级套餐", "amount": 399, "status": "closed"}
print(a)
print(b)
reveal_type(a.get("status"))
print(a.get("status", "open"), b.get("status", "open"))

c: NewTicket = {"title": "扣费两次", "amount": 89.5, "priority": 1}
print(a["status"])
```

<div class="line-notes">

- `from typing import NotRequired, TypedDict, reveal_type` NotRequired 是 Python 3.11 加进 typing 的,我们 3.12 可以直接用。
- `status: NotRequired[str]` 有 status 时它必须是 str,没有也行。≈ TS 的 `status?: string`。
- `a = NewTicket(title="发票抬头开错了", amount=199)` 第二种造法:把 TypedDict 当函数调,用关键字参数传每个键。结果还是一个普通字典,和花括号写法完全一样,选你顺手的。这样写时编辑器能补全键名。
- `b: NewTicket = {` 带上 status 的写法。
- `reveal_type(a.get("status"))` 可选的键用 get 取,类型是什么?
- `print(a.get("status", "open"), b.get("status", "open"))` 给默认值,a 没有 status 得到 open,b 有,得到 closed。
- `c: NewTicket = {"title": "扣费两次", "amount": 89.5, "priority": 1}` 错误 1:多了一个形状里没有的键。
- `print(a["status"])` 错误 2:直接用方括号取一个可能不存在的键。

</div>

```bash
uv run basedpyright part01/typed_dict_more.py
uv run python part01/typed_dict_more.py
```

检查的实测输出:

```text
typed_dict_more.py:15:13 - information: Type of "a.get("status")" is "str | None"
typed_dict_more.py:18:50 - error: Type "dict[str, str | float | int]" is not assignable to declared type "NewTicket"
    "priority" is an undefined item in type "NewTicket" (reportAssignmentType)
typed_dict_more.py:19:7 - error: Could not access item in TypedDict
    "status" is not a required key in "NewTicket", so access may result in runtime exception (reportTypedDictNotRequiredAccess)
2 errors, 0 warnings, 1 note
```

运行的实测输出(路径缩短了):

```text
{'title': '发票抬头开错了', 'amount': 199}
{'title': '升级套餐', 'amount': 399, 'status': 'closed'}
Runtime type is 'NoneType'
open closed
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/typed_dict_more.py", line 19, in <module>
    print(a["status"])
          ~^^^^^^^^^^
KeyError: 'status'
```

三处值得细看。

`a.get("status")` 的类型是 `str | None`,Day 46 的老朋友。可选的键用 get 取,检查器会提醒你可能拿到 None,和 Day 46 的 `dict.get` 一个套路。

多键那一条:`"priority" is an undefined item`,形状里没定义 priority,检查器不让放。注意运行时这一行(第 18 行)其实顺利执行了,c 照样是个带 priority 的字典,又是只有检查器在管。

第 19 行的规则名 `reportTypedDictNotRequiredAccess`,说明写得很直白:「status 不是必有的键,这样取可能在运行时出异常」。运行时果然 KeyError。修法就是改用 `a.get("status", "open")`,或者先 `if "status" in a:` 判断一下再取。

## 第二步:Literal,只能取这几个值

TicketDict 现在把 status 标成了 str,`"clsoed"` 还是能放进去。要把 status 限定成两个值,用 Literal。新建 `part01/literal_basic.py`:

```python
# agent-zero-lab/part01/literal_basic.py
from typing import Literal, reveal_type

Status = Literal["open", "closed"]


def set_status(id: str, status: Status) -> str:
    return f"{id} → {status}"


print(set_status("T-1004", "closed"))
print(set_status("T-1004", "clsoed"))

s: Status = "open"
reveal_type(s)
s = "pending"


def from_cli(arg: str) -> str:
    return set_status("T-1005", arg)


print(from_cli("closed"))
```

<div class="line-notes">

- `Status = Literal["open", "closed"]` 方括号里列出允许的值,这个类型只认这两个字符串。把它赋给一个名字 Status,以后到处写 Status 就行,这叫**类型别名**(type alias),≈ TS 的 `type Status = "open" | "closed"`。别名首字母大写,和类名一个习惯,读的人一看就知道这是类型不是变量。
- `def set_status(id: str, status: Status) -> str:` 参数用别名标注。
- `print(set_status("T-1004", "closed"))` 合法值。
- `print(set_status("T-1004", "clsoed"))` 错误 1:拼错的状态。
- `s: Status = "open"` 变量也能标成 Status。
- `reveal_type(s)` 看看检查器怎么看 s。
- `s = "pending"` 错误 2:不在列表里的值。
- `def from_cli(arg: str) -> str:` 模拟 Day 44 那种从 `sys.argv` 拿到的参数,类型是普通 str。
- `return set_status("T-1005", arg)` 错误 3:把普通 str 交给要 Status 的参数,能不能过?

</div>

```bash
uv run basedpyright part01/literal_basic.py
uv run python part01/literal_basic.py
```

检查的实测输出:

```text
literal_basic.py:12:28 - error: Argument of type "Literal['clsoed']" cannot be assigned to parameter "status" of type "Status" in function "set_status"
    Type "Literal['clsoed']" is not assignable to type "Status"
      "Literal['clsoed']" is not assignable to type "Literal['open']"
      "Literal['clsoed']" is not assignable to type "Literal['closed']" (reportArgumentType)
literal_basic.py:15:13 - information: Type of "s" is "Literal['open']"
literal_basic.py:16:5 - error: Type "Literal['pending']" is not assignable to declared type "Status"
    Type "Literal['pending']" is not assignable to type "Status"
      "Literal['pending']" is not assignable to type "Literal['open']"
      "Literal['pending']" is not assignable to type "Literal['closed']" (reportAssignmentType)
literal_basic.py:20:33 - error: Argument of type "str" cannot be assigned to parameter "status" of type "Status" in function "set_status"
    Type "str" is not assignable to type "Status"
      "str" is not assignable to type "Literal['open']"
      "str" is not assignable to type "Literal['closed']" (reportArgumentType)
3 errors, 0 warnings, 1 note
```

运行的实测输出:

```text
T-1004 → closed
T-1004 → clsoed
Runtime type is 'str'
T-1005 → closed
```

Day 45 第三步第一次见 `Literal[3]`,我说那是检查器对「代码里直接写的 3」的精确叫法。今天你自己写 Literal,意思一样:`Literal["open"]` 这个类型里只有一个值,就是字符串 open。`Literal["open", "closed"]` 是两个值。

这几条报错比 Day 45 的多了一层缩进,从最里面往外读(Day 46 讲过这个读法):检查器把 Status 拆开,告诉你 clsoed 既不是 `Literal['open']` 也不是 `Literal['closed']`,所以放不进 Status。错误 2 一样。

错误 3 是今天最要紧的一条。`from_cli` 的 arg 是普通 str,检查器只知道「它是某个字符串」,不知道是哪个,可能是 open,也可能是用户随手敲的 clsoed,所以不让它进 Status。这条红线不是在找你麻烦,它在提醒你:**从外面来的字符串还没检查过**。

运行结果再次证明 Literal 在运行时不起作用:`clsoed` 照样打印出来了。Day 45 的那句话对今天的两个新东西同样成立。

### 用 in 判断把 str 收窄成 Literal

那 from_cli 怎么写才对?先检查,检查过了检查器就放行。Day 46 学过 `if t is None:` 能收窄类型,判断字符串在不在一个元组里也能收窄。新建 `part01/literal_narrow.py`:

```python
# agent-zero-lab/part01/literal_narrow.py
from typing import Literal, reveal_type

Status = Literal["open", "closed"]


def set_status(id: str, status: Status) -> str:
    return f"{id} → {status}"


def from_cli(arg: str) -> str:
    if arg in ("open", "closed"):
        reveal_type(arg)
        return set_status("T-1005", arg)
    return f"不认识的状态: {arg}"


def badge(status: Status) -> str:
    if status == "open":
        return "[处理中]"
    reveal_type(status)
    return "[已关]"


print(from_cli("closed"))
print(from_cli("clsoed"))
print(badge("open"), badge("closed"))
```

<div class="line-notes">

- `if arg in ("open", "closed"):` Day 22 的元组加上 `in`。检查器看到元组里全是字面量,就知道进了这个 if 的 arg 只能是这两个值之一。写成 `if arg == "open" or arg == "closed":` 效果一样,我实测过,两种都能收窄。
- `reveal_type(arg)` 收窄后的类型。
- `return set_status("T-1005", arg)` 这次不会红线。
- `return f"不认识的状态: {arg}"` 没通过检查的走这里,告诉用户敲错了。
- `def badge(status: Status) -> str:` Literal 参数也能用 `==` 一个个分开处理。
- `if status == "open":` 是 open 的提前返回(Day 46 的 early return)。
- `reveal_type(status)` 过了上面那个 if,还剩什么?

</div>

```bash
uv run basedpyright part01/literal_narrow.py
uv run python part01/literal_narrow.py
```

实测输出:

```text
literal_narrow.py:13:21 - information: Type of "arg" is "Literal['open', 'closed']"
literal_narrow.py:21:17 - information: Type of "status" is "Literal['closed']"
0 errors, 0 warnings, 2 notes
Runtime type is 'str'
T-1005 → closed
不认识的状态: clsoed
Runtime type is 'str'
[处理中] [已关]
```

两个 reveal_type 正好是收窄的两种方向。第一个是**往里收**:arg 本来是 str,过了 in 判断,变成 `Literal['open', 'closed']`,可以交给要 Status 的参数了。第二个是**排除法**:status 本来是 open 或 closed,open 那条路已经 return 了,剩下的只可能是 closed。TS 里对 `"open" | "closed"` 做 `if (s === "open") return` 之后,s 也会变成 `"closed"`,一模一样。

<figure>
<svg viewBox="0 0 640 240" role="img" aria-label="str 是所有字符串的大圈,Status 是里面只含 open 和 closed 的小圈;clsoed 在小圈外面;if arg in 元组 把 str 收窄进小圈">
<rect x="0" y="0" width="640" height="240" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<ellipse cx="200" cy="120" rx="180" ry="100" fill="none" stroke="var(--rule)"/>
<text x="60" y="44" fill="var(--ink-soft)">str:所有字符串</text>
<ellipse cx="220" cy="130" rx="95" ry="50" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="220" y="112" text-anchor="middle" fill="var(--ink)">Status</text>
<text x="190" y="138" text-anchor="middle" fill="var(--ink)">"open"</text>
<text x="255" y="156" text-anchor="middle" fill="var(--ink)">"closed"</text>
<text x="70" y="190" fill="var(--ink-faint)">"clsoed"</text>
<text x="300" y="68" fill="var(--ink-faint)">"pending"</text>
<rect x="420" y="60" width="200" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="520" y="85" text-anchor="middle" fill="var(--ink)">arg: str</text>
<line x1="520" y1="100" x2="520" y2="130" stroke="var(--rule)"/>
<text x="530" y="120" fill="var(--ink-faint)" font-size="11">if arg in (...)</text>
<rect x="420" y="130" width="200" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="520" y="155" text-anchor="middle" fill="var(--ink)">arg: Status</text>
<line x1="420" y1="150" x2="318" y2="135" stroke="var(--mem)"/>
<text x="520" y="200" text-anchor="middle" fill="var(--ink-faint)" font-size="11">没通过的走 else,报「不认识」</text>
</g>
</svg>
<figcaption>Literal 是 str 里圈出来的一小块。小块里的值能当 str 用,str 不能直接当 Status 用,得先用 in 或 == 判断,把它收进小圈。</figcaption>
</figure>

图里的方向要记牢:Status 能当 str 用(`print`、拼接、`.upper()` 都行),反过来不行。这和 Day 45 「int 能当 float 用,反过来不行」是同一种关系,小的能放进大的格子里。

Literal 不只能写字符串,整数和布尔值也行,比如优先级 `Literal[1, 2, 3]`,练习 2 会用到它,还会看到检查器一个挺聪明的地方。

还有一个写法你在新代码里会见到:Python 3.12 起可以写 `type Status = Literal["open", "closed"]`,开头多一个 `type` 关键字,和 TS 的写法几乎一样。我在 3.12 里试过,检查器对它的处理和上面的 `Status = Literal[...]` 一致。我们这门课用不带 type 的写法,因为老代码和各种库里见得最多。

## 第三步:运行时它俩都不管

到这里你可能想:形状和取值都定死了,从 JSON 读进来的数据是不是就安全了?试一下。新建 `part01/typed_dict_runtime.py`:

```python
# agent-zero-lab/part01/typed_dict_runtime.py
import json
from typing import Literal, TypedDict


class TicketDict(TypedDict):
    id: str
    title: str
    amount: float
    status: Literal["open", "closed"]


raw = '{"id": "T-1006", "title": "退款", "amount": "五十", "status": "pending"}'
t: TicketDict = json.loads(raw)
print(t)
print(t["status"])
print(isinstance(t, TicketDict))
```

<div class="line-notes">

- `status: Literal["open", "closed"]` Literal 可以直接写在 TypedDict 里,不一定要先起别名。
- `raw = '{"id": "T-1006"` 一段「坏」JSON:金额是中文,状态是 pending,两样都不符合形状。
- `t: TicketDict = json.loads(raw)` Day 46 练习 4 的老坑:json.loads 返回 Any,Any 能赋给任何类型,检查器不会怀疑。
- `print(isinstance(t, TicketDict))` Day 46 用 isinstance 判断过是不是 dict,这里试着判断是不是 TicketDict。

</div>

```bash
uv run basedpyright part01/typed_dict_runtime.py
uv run python part01/typed_dict_runtime.py
```

检查的实测输出:

```text
typed_dict_runtime.py:17:21 - error: Second argument to "isinstance" must be a class or tuple of classes
    TypedDict class not allowed for instance or class checks (reportArgumentType)
1 error, 0 warnings, 0 notes
```

运行的实测输出(路径缩短了,中间一层 typing 内部的调用省略):

```text
{'id': 'T-1006', 'title': '退款', 'amount': '五十', 'status': 'pending'}
pending
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/typed_dict_runtime.py", line 17, in <module>
    print(isinstance(t, TicketDict))
          ^^^^^^^^^^^^^^^^^^^^^^^^^
  ...
TypeError: TypedDict does not support instance and class checks
```

坏数据一路畅通。第 14 行赋值检查器没意见(Any 的锅),运行时金额 `'五十'` 和状态 `pending` 都原样进了 t。想用 isinstance 在运行时补一道检查也不行:检查器直接说 TypedDict 不能用在 isinstance 里,运行时也是 TypeError。原因前面看到了,TypedDict 在运行时只是个普通 dict,根本没有「是不是 TicketDict」这回事。

所以分工要想清楚:**TypedDict 和 Literal 管的是你自己写的代码**,写错键名、传错状态,检查器当场抓;**从外面进来的数据(JSON、命令行参数、模型的回复)要靠你写代码去检查**,检查完再交给有类型的变量。Day 44 的 `ticket_from_dict` 和 Day 43 的 setter 就是在做这件事。[Day 51](/blog/agent-zero/day-051-pydantic-1/) 的 pydantic 会把「按类型自动检查外来数据」这件事包办掉,连 Literal 都能在运行时校验。在那之前,我们先自己手写一次,知道它到底在做什么。

## 把零件拼起来:ticket_types.py

用今天的两个工具,给记事本里的工单写一份类型定义,外加两个校验函数,把 JSON 里的字典安全地变成 TicketDict。新建 `part01/ticket_types.py`:

```python
# agent-zero-lab/part01/ticket_types.py
import json
from pathlib import Path
from typing import Any, Literal, NotRequired, TypedDict

from ticket_model import TicketError

BOOK = Path(__file__).resolve().parent / "data" / "notebook.json"

Status = Literal["open", "closed"]


class TicketDict(TypedDict):
    id: str
    title: str
    amount: float
    status: Status
    note: NotRequired[str]


def parse_status(value: str) -> Status:
    if value in ("open", "closed"):
        return value
    raise TicketError(f"状态只能是 open 或 closed,收到 {value!r}")


def parse_ticket(raw: dict[str, Any]) -> TicketDict:
    for key in ("id", "title", "amount"):
        if key not in raw:
            raise TicketError(f"缺少字段 {key}: {raw}")
    amount = raw["amount"]
    if not isinstance(amount, (int, float)):
        raise TicketError(f"{raw['id']} 金额不是数字: {amount!r}")
    ticket: TicketDict = {
        "id": str(raw["id"]),
        "title": str(raw["title"]),
        "amount": amount,
        "status": parse_status(raw.get("status", "open")),
    }
    if "note" in raw:
        ticket["note"] = str(raw["note"])
    return ticket


def load_typed(path: Path) -> list[TicketDict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return [parse_ticket(d) for d in data]


def line(t: TicketDict) -> str:
    mark = "已关" if t["status"] == "closed" else "处理中"
    text = f"{t['id']} {t['title']} ¥{t['amount']}({mark})"
    note = t.get("note")
    if note is not None:
        text += f" 备注: {note}"
    return text


def count_by_status(tickets: list[TicketDict]) -> dict[Status, int]:
    counts: dict[Status, int] = {"open": 0, "closed": 0}
    for t in tickets:
        counts[t["status"]] += 1
    return counts


if __name__ == "__main__":
    tickets = load_typed(BOOK)
    tickets[2]["note"] = "客户已发银行流水截图"
    for t in tickets:
        print(line(t))
    print(count_by_status(tickets))

    bad = {"id": "T-1006", "title": "退款", "amount": 50, "status": "pending"}
    try:
        parse_ticket(bad)
    except TicketError as e:
        print("没通过:", e)
```

<div class="line-notes">

- `from typing import Any, Literal, NotRequired, TypedDict` 今天用到的全在这一行。Any 留给「刚从 JSON 出来、还没检查」的那一段。
- `from ticket_model import TicketError` 复用 Day 40 起就有的业务异常,notebook.py 的 main 已经会接它。
- `Status = Literal["open", "closed"]` 状态的唯一定义。以后别的文件要用就 `from ticket_types import Status`,不要各写各的。
- `class TicketDict(TypedDict):` 工单的形状,和 Day 44 存进 notebook.json 的四个键一一对应。
- `status: Status` 不再是 str。
- `note: NotRequired[str]` 新加一个可选的备注键。旧的 notebook.json 里没有它,照样合法。
- `def parse_status(value: str) -> Status:` 把一个没检查过的字符串变成 Status。返回类型写 Status,逼着函数里必须真的检查过才能 return(练习 3 会看到不检查是什么红线)。
- `if value in ("open", "closed"):` 第二步的收窄,进来后 value 是 `Literal['open', 'closed']`。
- `return value` 已经收窄,可以当 Status 返回。
- `raise TicketError(f"状态只能是 open 或 closed,收到 {value!r}")` `!r` 是 Day 43 讲 `__repr__` 时用过的,打印带引号的 `'pending'`,空字符串也看得出来。
- `def parse_ticket(raw: dict[str, Any]) -> TicketDict:` 进来的是 Any 字典,出去的是 TicketDict。整个文件只有这一个函数碰 Any。
- `for key in ("id", "title", "amount"):` 三个必有的键挨个查。status 不在里面,因为它可以缺省。
- `raise TicketError(f"缺少字段 {key}: {raw}")` 缺哪个说哪个。
- `amount = raw["amount"]` 这里 amount 的类型是 Any。
- `if not isinstance(amount, (int, float)):` isinstance 的第二个参数可以是一个元组,意思是「是其中任何一个类就算」。整数和小数都算数字。
- `ticket: TicketDict = {` 每个值都经过处理再放进来。
- `"id": str(raw["id"]),` `str()` 保证是字符串。Day 44 的工单号本来就是字符串,这一步只是兜底。
- `"amount": amount,` 过了 isinstance,amount 已经被收窄成 `int | float`,放进 float 的格子没问题。
- `"status": parse_status(raw.get("status", "open")),` 没写 status 就当 open,再交给 parse_status 检查。这里有个要留心的地方:`raw.get(...)` 的结果是 Any,所以就算你忘了调 parse_status 直接放进来,检查器也不会报。Any 在这一行仍然是盲区,靠的是你记得调校验函数。
- `if "note" in raw:` 有备注才放,没有就不放这个键,符合 NotRequired 的意思。
- `ticket["note"] = str(raw["note"])` 可选键也能事后赋值。
- `def load_typed(path: Path) -> list[TicketDict]:` 和 ticket_model 的 load 平行,一个返回 Ticket 对象,一个返回 TicketDict。
- `return [parse_ticket(d) for d in data]` 每一条都过一遍校验,任何一条坏了就整体 raise。
- `mark = "已关" if t["status"] == "closed" else "处理中"` 取值用方括号,不是点。
- `note = t.get("note")` 可选键用 get,类型是 `str | None`。
- `if note is not None:` Day 46 的收窄。
- `def count_by_status(tickets: list[TicketDict]) -> dict[Status, int]:` 字典的键也可以是 Literal,返回值一看就知道只会有 open 和 closed 两个键。
- `counts: dict[Status, int] = {"open": 0, "closed": 0}` 两个状态先放 0,这样没有已关工单时也会显示 `'closed': 0`。空容器写标注(Day 46)这里也照做。
- `counts[t["status"]] += 1` `t["status"]` 是 Status,正好能当键。
- `tickets[2]["note"] = "客户已发银行流水截图"` 给第三张(T-1004)临时加个备注,只改内存,不存回文件。
- `bad = {"id": "T-1006", "title": "退款", "amount": 50, "status": "pending"}` 模拟一条坏数据。
- `parse_ticket(bad)` 应该被 parse_status 拦下。

</div>

先检查,再运行:

```bash
uv run basedpyright part01/ticket_types.py
uv run python part01/ticket_types.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
T-1001 发票抬头开错了 ¥199(已关)
T-1002 升级套餐 年付 ¥399(处理中)
T-1004 扣费两次 ¥89.5(处理中) 备注: 客户已发银行流水截图
T-1005 API 调用超额 ¥120(处理中)
{'open': 3, 'closed': 1}
没通过: 状态只能是 open 或 closed,收到 'pending'
```

和 Day 45、46 一样,我的 T-1004 是 89.5;你没做 Day 44 练习 2 的话这里是 99.5,其余一样。

这个文件的结构值得多看一眼,以后写 Agent 代码会反复用到:**Any 只活在一个函数里**(parse_ticket),它负责检查外来数据,检查通过就变成 TicketDict;从这个函数出去以后,所有代码面对的都是有形状、有取值范围的数据,检查器能一路帮你看着。模型返回的工具调用参数、HTTP 请求体,都是这么处理的。

| 今天的零件 | 在 ticket_types.py 里是哪一段 |
| --- | --- |
| 开头 `dict[str, Any]` 的问题 | Any 被关在 `parse_ticket` 的参数里 |
| 第一步 TypedDict | `class TicketDict(TypedDict)` 和所有 `t["..."]` 取值 |
| 第一步 NotRequired | `note: NotRequired[str]`、`t.get("note")`、`if "note" in raw` |
| 第二步 Literal 和类型别名 | `Status = Literal["open", "closed"]`、`dict[Status, int]` |
| 第二步 in 收窄 | `parse_status` 里的 `if value in ("open", "closed")` |
| 第三步 运行时不检查 | `parse_status` 和 `parse_ticket` 两个手写校验 |

## 动手练习

### 练习 1:客户的形状

CloudLedger 的客户有 id、name、plan(套餐,只能是 basic、pro、team 之一),email 可以没有。在 `part01/ex47_customer.py` 里写出 `Plan` 和 `CustomerDict`,再写 `customer_line(c)` 返回一行文字(没有邮箱时显示「未留邮箱」)。然后新建 `part01/ex47_customer_bad.py`,写三个故意错的客户:套餐写成 enterprise、少了 name、多了一个 phone 键,看检查器是不是一条不漏。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex47_customer.py
from typing import Literal, NotRequired, TypedDict

Plan = Literal["basic", "pro", "team"]


class CustomerDict(TypedDict):
    id: str
    name: str
    plan: Plan
    email: NotRequired[str]


def customer_line(c: CustomerDict) -> str:
    email = c.get("email", "未留邮箱")
    return f"{c['id']} {c['name']} [{c['plan']}] {email}"


if __name__ == "__main__":
    alice: CustomerDict = {"id": "C-001", "name": "李雷", "plan": "pro", "email": "lilei@example.com"}
    bob: CustomerDict = {"id": "C-002", "name": "韩梅梅", "plan": "basic"}
    print(customer_line(alice))
    print(customer_line(bob))
```

<div class="line-notes">

- `Plan = Literal["basic", "pro", "team"]` 三个套餐,类型别名。
- `plan: Plan` TypedDict 的值用别名。
- `email: NotRequired[str]` 邮箱可以不填。
- `email = c.get("email", "未留邮箱")` 给了默认值,结果是 str,不是 `str | None`。
- `if __name__ == "__main__":` 下面那个 bad 文件要导入 CustomerDict,不加这一行,导入时会把两行打印也执行一遍(Day 32)。
- `bob: CustomerDict = {"id": "C-002", "name": "韩梅梅", "plan": "basic"}` 没有 email,合法。

</div>

```python
# agent-zero-lab/part01/ex47_customer_bad.py
from ex47_customer import CustomerDict

c1: CustomerDict = {"id": "C-003", "name": "王芳", "plan": "enterprise"}
c2: CustomerDict = {"id": "C-004", "plan": "team"}
c3: CustomerDict = {"id": "C-005", "name": "赵强", "plan": "pro", "phone": "138"}
```

<div class="line-notes">

- `c1: CustomerDict = {"id": "C-003", "name": "王芳", "plan": "enterprise"}` 套餐不在 Plan 里。
- `c2: CustomerDict = {"id": "C-004", "plan": "team"}` 少 name。
- `c3: CustomerDict = {"id": "C-005", "name": "赵强", "plan": "pro", "phone": "138"}` 多了 phone。

</div>

```bash
uv run basedpyright part01/ex47_customer.py part01/ex47_customer_bad.py
uv run python part01/ex47_customer.py
uv run python part01/ex47_customer_bad.py; echo "exit=$?"
```

实测输出:

```text
ex47_customer_bad.py:4:58 - error: Type "dict[str, str]" is not assignable to declared type "CustomerDict"
    Type "Literal['enterprise']" is not assignable to type "Plan"
      "Literal['enterprise']" is not assignable to type "Literal['basic']"
      "Literal['enterprise']" is not assignable to type "Literal['pro']"
      "Literal['enterprise']" is not assignable to type "Literal['team']" (reportAssignmentType)
ex47_customer_bad.py:5:20 - error: Type "dict[str, str]" is not assignable to declared type "CustomerDict"
    "name" is required in "CustomerDict" (reportAssignmentType)
ex47_customer_bad.py:6:65 - error: Type "dict[str, str]" is not assignable to declared type "CustomerDict"
    "phone" is an undefined item in type "CustomerDict" (reportAssignmentType)
3 errors, 0 warnings, 0 notes
C-001 李雷 [pro] lilei@example.com
C-002 韩梅梅 [basic] 未留邮箱
exit=0
```

三条一条不漏,ex47_customer.py 本身 0 报错。最后那行 `exit=0`:三个错的客户在运行时都顺利造出来了,一个字都没报。第 4 行第 58 列指的正是 `"enterprise"`,检查器把红线画在最具体的那个值上。

</details>

### 练习 2:整数也能是 Literal

优先级只有 1、2、3 三档。新建 `part01/ex47_priority.py`,写 `Priority = Literal[1, 2, 3]`,再写两个「把优先级提高一档」的函数:`bump_naive` 直接 `return p + 1`;`bump` 先判断 p 是 3 就返回 3,否则 `return p + 1`。先猜检查器对这两个函数各说什么,再检查、运行。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex47_priority.py
from typing import Literal, reveal_type

Priority = Literal[1, 2, 3]


def bump_naive(p: Priority) -> Priority:
    return p + 1


def bump(p: Priority) -> Priority:
    if p == 3:
        return 3
    reveal_type(p)
    reveal_type(p + 1)
    return p + 1


print(bump_naive(3), bump(1), bump(3))
```

<div class="line-notes">

- `Priority = Literal[1, 2, 3]` Literal 里写整数。
- `return p + 1` p 是 1、2、3 之一,加 1 是 2、3、4 之一,4 不在 Priority 里。
- `if p == 3:` 先把最高档处理掉。
- `reveal_type(p)` 排除了 3 以后剩下什么。
- `reveal_type(p + 1)` 检查器会不会真的去算加法?
- `print(bump_naive(3), bump(1), bump(3))` 三个结果分别应该是 4(越界)、2、3。

</div>

```bash
uv run basedpyright part01/ex47_priority.py
uv run python part01/ex47_priority.py
```

实测输出:

```text
ex47_priority.py:8:12 - error: Type "Literal[2, 3, 4]" is not assignable to return type "Priority"
    Type "Literal[2, 3, 4]" is not assignable to type "Priority"
      Type "Literal[4]" is not assignable to type "Priority"
        "Literal[4]" is not assignable to type "Literal[1]"
        "Literal[4]" is not assignable to type "Literal[2]"
        "Literal[4]" is not assignable to type "Literal[3]" (reportReturnType)
ex47_priority.py:14:17 - information: Type of "p" is "Literal[1, 2]"
ex47_priority.py:15:17 - information: Type of "p + 1" is "Literal[2, 3]"
1 error, 0 warnings, 2 notes
Runtime type is 'int'
Runtime type is 'int'
4 2 3
```

我第一次跑的时候也有点意外:basedpyright 真的会对整数字面量做加法。bump_naive 里它算出 p + 1 是 `Literal[2, 3, 4]`,缩进到最里层告诉你是 4 放不进去。bump 里排除了 3 之后 p 是 `Literal[1, 2]`,加 1 是 `Literal[2, 3]`,全在范围内,所以没有红线。运行结果 `4 2 3` 里的那个 4,就是检查器提前拦住的越界值。

</details>

### 练习 3:偷懒的 parse_status

新建 `part01/ex47_lazy_status.py`,写一个不做检查、直接 `return value` 的 `parse_status_lazy(value: str) -> Status`(Status 从 ticket_types 导入)。检查器会说什么?为什么说这条红线是在帮你?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex47_lazy_status.py
from ticket_types import Status


def parse_status_lazy(value: str) -> Status:
    return value
```

<div class="line-notes">

- `from ticket_types import Status` 用今天定义的那一份,不重新写。ticket_types.py 的演示代码在 main guard 里,导入不会执行。
- `return value` value 是普通 str,没经过检查。

</div>

```bash
uv run basedpyright part01/ex47_lazy_status.py
```

实测输出:

```text
ex47_lazy_status.py:6:12 - error: Type "str" is not assignable to return type "Status"
    Type "str" is not assignable to type "Status"
      "str" is not assignable to type "Literal['open']"
      "str" is not assignable to type "Literal['closed']" (reportReturnType)
1 error, 0 warnings, 0 notes
```

返回类型写成 Status,就等于对调用方承诺「我给你的一定是 open 或 closed」。不检查就 return,这个承诺是空的,检查器拒绝放行。想消掉这条红线,唯一正经的办法就是加上 `if value in ("open", "closed"):`,也就是真的去检查。类型标注在这里起的作用,是逼你把该写的校验写上。

</details>

### 练习 4:Ticket 对象转成 TicketDict

Day 43 的 Ticket 类里 status 标的是 str。新建 `part01/ex47_to_typed.py`,写 `to_typed(t: Ticket) -> TicketDict`,把一个 Ticket 对象转成今天的 TicketDict。先写一个直接把 `t.status` 放进去的版本,看红线;再修好。最后造一张工单,先正常转一次,再把它的 status 改成 `"done"` 再转一次,看运行时发生什么。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex47_to_typed.py
from ticket_model import Ticket
from ticket_types import TicketDict, line, parse_status


def to_typed_bad(t: Ticket) -> TicketDict:
    return {"id": t.id, "title": t.title, "amount": t.amount, "status": t.status}


def to_typed(t: Ticket) -> TicketDict:
    return {"id": t.id, "title": t.title, "amount": t.amount, "status": parse_status(t.status)}


t = Ticket("T-1007", "发票重开", 66)
print(line(to_typed(t)))
t.status = "done"
print(line(to_typed(t)))
```

<div class="line-notes">

- `from ticket_types import TicketDict, line, parse_status` 复用今天的形状、打印函数和校验函数。
- `"amount": t.amount, "status": t.status}` t.status 是 str,TicketDict 要的是 Status。
- `"status": parse_status(t.status)}` 修法:先过校验。
- `t = Ticket("T-1007", "发票重开", 66)` 新工单,status 默认 open。
- `t.status = "done"` Ticket 类不管 status 写什么,Day 43 只给 amount 写了 setter。

</div>

```bash
uv run basedpyright part01/ex47_to_typed.py
uv run python part01/ex47_to_typed.py
```

检查的实测输出:

```text
ex47_to_typed.py:7:73 - error: Type "dict[str, str | float]" is not assignable to return type "TicketDict"
    Type "str" is not assignable to type "Status"
      "str" is not assignable to type "Literal['open']"
      "str" is not assignable to type "Literal['closed']" (reportReturnType)
1 error, 0 warnings, 0 notes
```

只有 to_typed_bad 那一行报错,修好的 to_typed 没问题。运行的实测输出(路径缩短了,最后两层省略):

```text
T-1007 发票重开 ¥66(处理中)
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex47_to_typed.py", line 17, in <module>
    print(line(to_typed(t)))
               ^^^^^^^^^^^
  ...
ticket_model.TicketError: 状态只能是 open 或 closed,收到 'done'
```

两个类型对不上的地方(Ticket 的 str 和 TicketDict 的 Status),检查器在交界处画了红线,parse_status 在运行时守住了交界。顺便看出 Ticket 类自己的漏洞:它允许 status 是任何字符串。把 `ticket_model.py` 里的 status 也改成 Status 是个好主意,不过 Ticket 类过几天会在 [Day 50](/blog/agent-zero/day-050-dataclass/) 改写成 dataclass,到时候再一起改,今天先不动它。

</details>

### 练习 5:发给模型的消息

以后调大模型,发过去的是一串消息,每条是一个字典,有 role(谁说的)和 content(说了什么)。新建 `part01/ex47_messages.py`,用 TypedDict 和 Literal 定义 `Message`,role 只能是 system、user、assistant。写四条消息,其中故意把 assistant 拼成 assitant,再写一条少了 content 的。先检查,再修好。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex47_messages.py
import json
from typing import Literal, TypedDict

Role = Literal["system", "user", "assistant"]


class Message(TypedDict):
    role: Role
    content: str


def ask(history: list[Message], question: str) -> list[Message]:
    return history + [{"role": "user", "content": question}]


messages: list[Message] = [
    {"role": "system", "content": "你是云簿的客服助手,只回答账单问题。"},
    {"role": "user", "content": "我被扣了两次钱"},
    {"role": "assitant", "content": "请提供订单号"},
    {"role": "user"},
]
messages = ask(messages, "订单号是 T-1004")
print(len(messages))
print(json.dumps(messages[-1], ensure_ascii=False))
```

<div class="line-notes">

- `Role = Literal["system", "user", "assistant"]` 三种角色:system 是给模型定规矩的,user 是用户,assistant 是模型自己。第二部分讲大模型 API 时会细讲。
- `role: Role` 每条消息的角色。
- `def ask(history: list[Message], question: str) -> list[Message]:` 在历史后面追加一条用户消息,返回新列表。
- `return history + [{"role": "user", "content": question}]` 两个列表相加得到新列表(Day 21)。检查器会把这个字面量字典对照 Message 检查。
- `messages: list[Message] = [` 列表里的每个字典都要符合 Message。
- `{"role": "assitant", "content": "请提供订单号"},` 拼错的角色。
- `{"role": "user"},` 少了 content。
- `print(json.dumps(messages[-1], ensure_ascii=False))` TypedDict 就是普通字典,可以直接 dumps(Day 39),这正是它比类方便的地方。

</div>

```bash
uv run basedpyright part01/ex47_messages.py
```

实测输出:

```text
ex47_messages.py:20:14 - error: Type "list[Message | dict[str, str]]" is not assignable to declared type "list[Message]"
    Type "Literal['assitant']" is not assignable to type "Role"
      "Literal['assitant']" is not assignable to type "Literal['system']"
      "Literal['assitant']" is not assignable to type "Literal['user']"
      "Literal['assitant']" is not assignable to type "Literal['assistant']"
    "content" is required in "Message" (reportAssignmentType)
1 error, 0 warnings, 0 notes
```

两个错合成了一条报错,因为它们都在同一个列表的赋值里;下面缩进的两段分别说了拼错的角色和缺的 content。修好的版本是 `part01/ex47_messages_fixed.py`,只改两行:

```python
    {"role": "assistant", "content": "请提供订单号"},
    {"role": "user", "content": "订单是上周五付的"},
```

<div class="line-notes">

- `{"role": "assistant", "content": "请提供订单号"},` 拼写改对。
- `{"role": "user", "content": "订单是上周五付的"},` 补上 content。

</div>

```bash
uv run basedpyright part01/ex47_messages_fixed.py
uv run python part01/ex47_messages_fixed.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
5
{"role": "user", "content": "订单号是 T-1004"}
```

这不是我编的练习场景。2026 年 10 月我下载了 openai 官方 Python SDK 3.36.1 的安装包,`openai/types/chat/chat_completion_user_message_param.py` 里用户消息的定义是这样的(注释删掉了):

```python
class ChatCompletionUserMessageParam(TypedDict, total=False):
    content: Required[Union[str, Iterable[ChatCompletionContentPartParam]]]
    role: Required[Literal["user"]]
    name: str
```

<div class="line-notes">

- `class ChatCompletionUserMessageParam(TypedDict, total=False):` `total=False` 表示「默认所有键都可以没有」,和我们一个个写 NotRequired 是反过来的写法。
- `content: Required[` 所以必须有的键反过来用 `Required` 标出来。`Union[A, B]` 是 `A | B` 的老写法(Day 46 练习 3 的对照表)。
- `role: Required[Literal["user"]]` 只有一个值的 Literal:这种消息的 role 只能是 user。
- `name: str` 可选。

</div>

结构和你刚写的 Message 几乎一样。以后你用 openai SDK 时把 `"assistant"` 拼错,编辑器里的红线就是这几行定义画出来的。

</details>

验收标准:`uv run basedpyright part01/ticket_types.py part01/ex47_customer.py part01/ex47_messages_fixed.py` 输出 `0 errors`;`uv run python part01/ticket_types.py` 的输出和正文一致(T-1004 金额以你的数据为准);不看文章能写出一个带 NotRequired 键的 TypedDict 和一个 Literal 类型别名;能用 `in` 判断把一个 str 交给要 Literal 的参数;能说清 TypedDict 和 Ticket 类各适合什么场合,以及为什么 JSON 进来的数据还要手写校验。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| TypedDict | 声明「一种字典有哪些键、每个键什么类型」的写法,`class TicketDict(TypedDict): ...`,≈ TS 的 interface;运行时造出来的仍是普通 dict |
| 形状(shape) | 口语说法,指一个字典或对象有哪些键、各是什么类型 |
| required / 必有键 | TypedDict 里默认每个键都必须有,少了会报 `"amount" is required` |
| NotRequired | 把某个键标成可以没有,`note: NotRequired[str]`,≈ TS 的 `note?: string` |
| `total=False` / Required | 另一种写法:`total=False` 让所有键默认可选,再用 `Required[...]` 标出必有的,openai SDK 就这么写 |
| Literal | 只允许列出来的几个值的类型,`Literal["open", "closed"]`,≈ TS 的字面量联合类型 `"open" \| "closed"` |
| 类型别名(type alias) | 给一个类型起名字,`Status = Literal[...]`,≈ TS 的 `type Status = ...`;3.12 也可写 `type Status = ...` |
| reportTypedDictNotRequiredAccess | 用方括号直接取一个 NotRequired 的键,可能 KeyError |
| reportGeneralTypeIssues | 比较笼统的规则名,TypedDict 里键名拼错、值类型不对会用到它 |
| 校验(validation) | 在运行时用 if/isinstance 检查外来数据,不合格就 raise,今天的 `parse_status`、`parse_ticket` |
| `isinstance(x, (int, float))` | 第二个参数写元组,表示是其中任一个类就算 |
| role | 发给大模型的消息里「谁说的」:system、user、assistant |

## 常见误区

**把 TypedDict 当类用,写 `t.amount`。** TypedDict 只是字典的形状,取值必须 `t["amount"]`。写 `t.amount` 检查器实测报 `Cannot access attribute "amount" for class "TicketDict"`,还附了一句提示 `Use ["amount"] to reference item in TypedDict`;运行时是 `AttributeError: 'dict' object has no attribute 'amount'`。

**以为标了 TypedDict,JSON 读进来就被检查过了。** 实测 `t: TicketDict = json.loads(raw)` 检查 0 errors,`'五十'` 和 `pending` 原样进了 t。json.loads 返回 Any,Any 能骗过任何标注。外来数据要先过 `parse_ticket` 这样的函数。

**用 isinstance 判断是不是某个 TypedDict。** 实测运行时 `TypeError: TypedDict does not support instance and class checks`,检查器也会提前画红线。只能判断 `isinstance(x, dict)`,再逐个键检查。

**以为写了 Literal,运行时就进不去别的值。** `set_status("T-1004", "clsoed")` 实测照样打印 `T-1004 → clsoed`。Literal 只管检查器,运行时要自己写 `if value in (...)`。

**把普通 str 直接传给 Literal 参数,然后用 `# type: ignore` 压红线。** 那条 `"str" is not assignable to type "Status"` 是在提醒你「这个字符串还没检查过」。正确做法是先 `if arg in ("open", "closed"):` 收窄,或交给 `parse_status`。

**直接用方括号取可选的键。** `a["status"]` 实测 reportTypedDictNotRequiredAccess,运行时 KeyError。NotRequired 的键用 `get(键, 默认值)`,或者先 `if "status" in a:`。

**同一组 Literal 到处复制一份。** 一个文件写 `Literal["open", "closed"]`,另一个写 `Literal["open", "close"]`,两边都不报错,但互相传值时红线一片。起一个别名放在 ticket_types.py,别的文件导入它。

## 学习资料

### 文档与文章

- [Python 标准库 · typing(中文)](https://docs.python.org/zh-cn/3.12/library/typing.html):页内搜 `TypedDict`、`NotRequired`、`Literal`,三个都有例子。TypedDict 那一节还写了 `total=False` 和继承的用法,今天不用,知道有就行。
- [mypy 文档 · TypedDict](https://mypy.readthedocs.io/en/stable/typed_dict.html) 和 [Literal types](https://mypy.readthedocs.io/en/stable/literal_types.html):英文,比官方参考讲得更像教程,Literal 那页有「Intelligent indexing」和穷举检查,是今天内容往后延伸的方向。
- [TypeScript Handbook · Object Types](https://www.typescriptlang.org/docs/handbook/2/objects.html):TS 的 interface 和可选属性 `?`,对照 TypedDict 和 NotRequired 看。[Everyday Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html) 里的「Literal Types」一节对照今天的 Literal。
- [Python typing 规范 · TypedDict](https://typing.python.org/en/latest/spec/typeddict.html) 和 [Literal](https://typing.python.org/en/latest/spec/literal.html):各个检查器共同遵守的规则原文,碰到「这样写到底算不算错」的问题时来查。
- [PEP 589](https://peps.python.org/pep-0589/)(TypedDict)、[PEP 586](https://peps.python.org/pep-0586/)(Literal)、[PEP 655](https://peps.python.org/pep-0655/)(Required 和 NotRequired):三个特性的提案,英文,看 Motivation 一节知道当初为什么要加就够了。
- [Adam Johnson · Python type hints: How to Use TypedDict](https://adamj.eu/tech/2021/05/10/python-type-hints-how-to-use-typeddict/):一篇短文,从 `dict[str, Any]` 的问题讲到 TypedDict,和今天开头的思路一样,英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV14uS3YgEwn&autoplay=0&high_quality=1" title="[Python] TypedDict 让你的字典结构乖乖听话" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>隔壁的程序员老王 · [Python] TypedDict 让你的字典结构乖乖听话 · 约 7 分钟,2024 年的视频,专讲 TypedDict,看完正文第一步再看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1sh4kzjEp1&autoplay=0&high_quality=1" title="【中配】Python中为字典添加类型标注的3种方法（TypedDict 对比 @dataclass） - Indently" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>黑纹白斑马(搬运 Indently,中文配音)· Python 中为字典添加类型标注的 3 种方法(TypedDict 对比 @dataclass) · 约 10 分钟,2025 年 10 月。前半段对应今天的 TypedDict,后半段的 dataclass 是 Day 50 的内容,可以先看个大概。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/XSkBFFOtQro" title="&quot;TypedDict&quot; In Python Is Actually AWESOME!" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Indently · "TypedDict" In Python Is Actually AWESOME! · 英文短视频,演示编辑器怎么靠 TypedDict 补全键名、报出拼错的键,和第一步的实验对着看。</figcaption>
</figure>

### 书籍

- 《流畅的 Python(第 2 版)》,Luciano Ramalho 著,人民邮电出版社,2023。第 15 章「类型提示进阶」里有专门一节讲 TypedDict,作者的态度和今天第三步一致:TypedDict 只给检查器看,运行时不校验,别把它当成数据校验工具。这一章后面的内容(重载、泛型类)现在还用不上,只读 TypedDict 那节。书的示例代码在 [fluentpython/example-code-2e](https://github.com/fluentpython/example-code-2e) 的 `15-more-types` 目录。

### 开源项目与代码

- [openai/openai-python](https://github.com/openai/openai-python):练习 5 看到的消息类型在 [src/openai/types/chat/chat_completion_user_message_param.py](https://github.com/openai/openai-python/blob/main/src/openai/types/chat/chat_completion_user_message_param.py)。同一个目录下还有 system、assistant、tool 消息各一个文件,打开两三个对比一下,看 role 的 Literal 是怎么区分它们的。这个 SDK 的请求参数几乎全是 TypedDict,是学 TypedDict 最好的真实代码。

## 自测

1. 把这段 TS 翻成 Python:`interface Refund { id: string; amount: number; reason?: string }`。

<details><summary>答案</summary>

```python
from typing import NotRequired, TypedDict


class Refund(TypedDict):
    id: str
    amount: float
    reason: NotRequired[str]
```

`interface` 对应 `class X(TypedDict)`,`number` 对应 float,可选属性 `reason?` 对应 `NotRequired[str]`。

</details>

2. `t` 是 TicketDict,`print(type(t))` 打印什么?`t.title` 能用吗?

<details><summary>答案</summary>

打印 `<class 'dict'>`,TypedDict 在运行时就是普通字典。`t.title` 不能用,检查器报 attribute 错误,运行时 AttributeError,要写 `t["title"]`。

</details>

3. `def from_cli(arg: str) -> str: return set_status("T-1", arg)`,其中 set_status 的参数是 `Status = Literal["open", "closed"]`。检查器会报错吗?怎么改?

<details><summary>答案</summary>

会报 reportArgumentType,`"str" is not assignable to type "Status"`,因为普通 str 可能是任何字符串。改法是先 `if arg in ("open", "closed"):` 收窄,收窄后 arg 是 `Literal['open', 'closed']`,再传进去;不在里面的走另一条路给出提示。

</details>

4. 为什么 `t: TicketDict = json.loads(raw)` 检查 0 errors,运行时却能装进 `status: "pending"`?

<details><summary>答案</summary>

json.loads 返回 Any,Any 能赋给任何类型,检查器不会怀疑;而 TypedDict 和 Literal 在运行时都不做检查。外来数据要先过 parse_ticket 这类手写校验(以后用 pydantic)再变成 TicketDict。

</details>

5. 面试题:同样是描述一张工单,什么时候用 TypedDict,什么时候用类?

<details><summary>答案</summary>

数据本身就是字典、要和 JSON 或 API 来回转换、不需要方法时用 TypedDict,比如发给模型的消息、HTTP 请求体,openai SDK 的请求参数就是 TypedDict。需要行为(close、计算)或者需要在运行时校验(setter)时用类。两者都要注意:TypedDict 不做运行时校验,需要校验外来数据时还得自己写或用 pydantic。

</details>

## 明天预告

[Day 48 · 第 7 周复习:编程地基(Day 42–47)](/blog/agent-zero/day-048-week07-review/)。这一周从继承、组合、`__repr__` 和 property,到命令行记事本,再到三天类型标注,东西多而且彼此相关。明天画一张本周知识地图,把这周踩过的坑列成错题清单,再合上文章默写一段核心代码并跑通。类型标注还没完,Day 49 会接着讲 Protocol 和 TypeVar。
