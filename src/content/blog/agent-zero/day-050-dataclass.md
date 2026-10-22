---
title: 'Day 50 · dataclass:装数据的类'
description: '用 @dataclass 让 Python 自动生成 __init__、__repr__ 和 __eq__,只写字段就有了一个能打印、能比较的类;用 field(default_factory=list) 躲开可变默认值的坑;用 __post_init__ 补上校验、asdict 导出字典。最后把 Ticket 改写成 dataclass,status 收紧成 Day 47 的 Status。'
pubDate: 2026-10-22
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 50
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 49](/blog/agent-zero/day-049-type-hints-4/) 学了两样东西。Protocol 让检查器只看结构不看继承,企业微信机器人和假的大模型客户端 FakeClient 不继承任何类也通过了检查;泛型函数 `def by_id[T: HasId](items: list[T], id: str) -> T | None` 传进 Ticket 就返回 Ticket,传进 Customer 就返回 Customer。

Day 49 里为了演示 HasId 写了一个 Customer 类,`__init__` 里两行 `self.id = id`、`self.name = name`。这种代码这几周你写了很多遍:Day 40 的 Ticket、Day 42 的渠道类、Day 43 又给 Ticket 手写了 `__repr__` 和 `to_dict`。字段一多,`__init__` 里就是一长串「把参数原样存起来」,`__repr__` 里再把同样的字段名抄一遍。今天让 Python 替你写这些。

## 今天要解决的问题

学完今天,你应该能:

1. 用 `@dataclass` 写一个只列字段的类,说出它自动生成了哪三个方法(`__init__`、`__repr__`、`__eq__`),以及它在运行时**不**检查类型。
2. 用 `field(default_factory=list)` 给列表字段设默认值,读懂直接写 `= []` 时的报错;知道字段顺序的规矩(没默认值的在前)。
3. 用 `__post_init__` 在构造后做校验,用 `asdict` 把对象转成字典。
4. 写出 `part01/ticket_dc.py`:dataclass 版的 Ticket,status 用 Day 47 的 `Status`,能读写 notebook.json,basedpyright 0 errors。

预计用时:2.5 小时。前置:[Day 29](/blog/agent-zero/day-029-functions-2/) 的可变默认值陷阱、[Day 30](/blog/agent-zero/day-030-functions-3/) 的 `**kwargs`、[Day 40](/blog/agent-zero/day-040-classes-1/) 和 [Day 43](/blog/agent-zero/day-043-classes-3/) 的 Ticket 类(`__init__`、`__repr__`、property、classmethod)、[Day 47](/blog/agent-zero/day-047-type-hints-3/) 的 `ticket_types.py`(`Status`、`parse_status`)、[Day 49](/blog/agent-zero/day-049-type-hints-4/) 的 Protocol。

学法:先对照文章逐行敲一遍(不要复制粘贴)并跑通;第二天合上文章,把 `ticket_dc.py` 里的 Ticket 类默写出来;再做动手练习,做不出来再展开参考答案,看完关掉自己重写一遍。

命令都在项目根目录 `agent-zero-lab` 里跑,新文件放进 `part01/`。dataclass 是标准库,不用装;今天不调 API,花费 0 元。数据用 Day 44 的 `part01/data/notebook.json`(T-1001 已关,T-1002、T-1004、T-1005 未关;我的 T-1004 是 89.5,没做 Day 44 练习 2 的话是 99.5)。下面检查结果里的路径一律缩短成文件名。

## 先看问题:两张一模一样的工单不相等

新建 `part01/eq_problem.py`:

```python
# agent-zero-lab/part01/eq_problem.py
from ticket_model import Ticket

a = Ticket("T-1004", "扣费两次", 89.5)
b = Ticket("T-1004", "扣费两次", 89.5)
print(a == b, a is b)
print(a.to_dict() == b.to_dict())
```

<div class="line-notes">

- `from ticket_model import Ticket` Day 43 改造过的 Ticket,有 `__repr__`、`__str__`、property,但没写 `__eq__`。
- `a = Ticket("T-1004", "扣费两次", 89.5)` 和下一行的 b 每个字段都一样。
- `print(a == b, a is b)` `is` 判断是不是同一个对象(Day 46 写 `is None` 用的就是它),`==` 判断值是不是相等。
- `print(a.to_dict() == b.to_dict())` 转成字典再比。

</div>

```bash
uv run python part01/eq_problem.py
```

实测输出:

```text
False False
True
```

`a == b` 是 False。普通类没写 `__eq__` 时,`==` 的行为和 `is` 一样,只有同一个对象才相等,字段一模一样也没用。这和 JS 里 `{id: 1} === {id: 1}` 是 false 一个道理。转成字典后再比就是 True,因为字典的 `==` 是按内容比的。

想让 Ticket 按内容比较,就得再手写一个 `__eq__`,把四个字段逐个比一遍。加上 `__init__` 和 `__repr__`,同一串字段名要在三个地方各抄一遍,以后加个字段要改三处,漏改一处就是 bug。对于「主要用来装数据」的类,Python 有专门的工具。

## 第一步:@dataclass,只写字段

新建 `part01/dc_basic.py`:

```python
# agent-zero-lab/part01/dc_basic.py
from dataclasses import dataclass


@dataclass
class TicketDC:
    id: str
    title: str
    amount: float
    status: str = "open"


a = TicketDC("T-1004", "扣费两次", 89.5)
b = TicketDC(id="T-1004", title="扣费两次", amount=89.5)
print(a)
print([a])
print(a == b, a is b)
a.status = "closed"
print(a == b, a.status, b.status)

weird = TicketDC(1004, None, "八十九")
print(weird)
```

<div class="line-notes">

- `from dataclasses import dataclass` 标准库 dataclasses 模块,Python 3.7 起就有。
- `@dataclass` 写在 class 上面的装饰器(和 Day 43 的 `@property` 一样是 @ 开头)。它会读下面类体里写的字段,自动给这个类生成方法。装饰器到底是什么,后面有专门的一天讲,现在知道「放在上面,给类加功能」就够了。
- `class TicketDC:` 名字后缀 DC 只是为了和 ticket_model 的 Ticket 区分,最后拼的时候会叫回 Ticket。
- `id: str` 每一行是「字段名: 类型」,和 Day 47 的 TypedDict 写法几乎一样。**dataclass 只认带类型标注的行**,不写类型,它就不当成字段。
- `amount: float` 三个没有默认值的字段,造对象时必须传。
- `status: str = "open"` 有默认值的字段,不传就用它。
- `a = TicketDC("T-1004", "扣费两次", 89.5)` 调的是自动生成的 `__init__`,参数顺序就是字段的书写顺序。
- `b = TicketDC(id="T-1004", title="扣费两次", amount=89.5)` 也可以用关键字传(Day 29),字段多的时候更清楚。
- `print(a)` 自动生成的 `__repr__`。
- `print([a])` 放进列表打印,Day 43 说过列表里走的是 `__repr__`。
- `print(a == b, a is b)` 自动生成的 `__eq__`:同一个类、每个字段都相等,就相等。
- `a.status = "closed"` 普通赋值,dataclass 的对象默认可以改。
- `print(a == b, a.status, b.status)` 改了一个字段,不相等了。
- `weird = TicketDC(1004, None, "八十九")` 故意三个字段全传错类型:id 是整数、title 是 None、金额是中文。
- `print(weird)` 运行时会不会拦?

</div>

```bash
uv run basedpyright part01/dc_basic.py
uv run python part01/dc_basic.py
```

检查的实测输出:

```text
dc_basic.py:21:18 - error: Argument of type "Literal[1004]" cannot be assigned to parameter "id" of type "str" in function "__init__"
    "Literal[1004]" is not assignable to "str" (reportArgumentType)
dc_basic.py:21:24 - error: Argument of type "None" cannot be assigned to parameter "title" of type "str" in function "__init__"
    "None" is not assignable to "str" (reportArgumentType)
dc_basic.py:21:30 - error: Argument of type "Literal['八十九']" cannot be assigned to parameter "amount" of type "float" in function "__init__"
    "Literal['八十九']" is not assignable to "float" (reportArgumentType)
3 errors, 0 warnings, 0 notes
```

运行的实测输出:

```text
TicketDC(id='T-1004', title='扣费两次', amount=89.5, status='open')
[TicketDC(id='T-1004', title='扣费两次', amount=89.5, status='open')]
True False
False closed open
TicketDC(id=1004, title=None, amount='八十九', status='open')
```

五行字段定义,换来了三样东西:

- `__init__`:按字段顺序收参数,有默认值的可以不传。
- `__repr__`:`TicketDC(id='T-1004', title='扣费两次', ...)`,和 Day 43 手写的格式一模一样,字符串也带了引号(它内部用的就是 `!r`)。
- `__eq__`:`a == b` 是 True,`a is b` 还是 False。值相等,但不是同一个对象。

检查器也完全认识这个自动生成的 `__init__`,报错里写的就是 `in function "__init__"`,三个传错类型的参数一个不漏。

可最后一行要看清楚:`TicketDC(id=1004, title=None, amount='八十九', ...)` 在运行时顺利造出来了。**dataclass 不检查类型**,字段上的标注和 Day 45 讲的一样,只给检查器看。它省掉的是样板代码,不是校验代码。校验怎么补,第三步讲。

### 看看它到底生成了什么

「自动生成方法」听着有点玄,可以亲眼看一下。新建 `part01/dc_peek.py`:

```python
# agent-zero-lab/part01/dc_peek.py
import inspect
from dataclasses import dataclass, fields


@dataclass
class TicketDC:
    id: str
    title: str
    amount: float
    status: str = "open"


print(inspect.signature(TicketDC))
print([f.name for f in fields(TicketDC)])
print("__init__" in TicketDC.__dict__, "__repr__" in TicketDC.__dict__, "__eq__" in TicketDC.__dict__)
```

<div class="line-notes">

- `import inspect` 标准库里「查看对象内部」的工具箱。今天只用它一个函数,知道有这么个东西就行。
- `from dataclasses import dataclass, fields` fields 能列出一个 dataclass 有哪些字段。
- `print(inspect.signature(TicketDC))` signature 是函数签名,对一个类取签名,得到的就是它 `__init__` 的参数列表(不含 self)。
- `print([f.name for f in fields(TicketDC)])` 每个字段是一个对象,`.name` 是字段名。
- `print("__init__" in TicketDC.__dict__,` 类的 `__dict__` 是「这个类自己定义了哪些东西」的字典。我们一个方法都没写,看看里面有没有这三个。

</div>

```bash
uv run python part01/dc_peek.py
```

实测输出:

```text
(id: str, title: str, amount: float, status: str = 'open') -> None
['id', 'title', 'amount', 'status']
True True True
```

第一行就是 `@dataclass` 替你写的 `__init__` 的签名,默认值、类型标注都在。第三行三个 True:这三个方法确实被加到了类上,和你亲手写的没有区别。如果你在类里自己写了 `__repr__`,dataclass 就不会覆盖它,最后拼 ticket_dc.py 时会用到这一点。

对比一下 TS。TS 没有完全对应的东西,最接近的是「参数属性」:`class TicketDC { constructor(public id: string, public title: string, public amount: number, public status = "open") {} }`,它也省掉了 `this.id = id` 这种赋值,但不会给你生成打印格式和按值比较。dataclass 做的事更多一点。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="左边是你写的五行:@dataclass 和四个字段;箭头指向右边 Python 生成的三个方法:__init__ 按字段收参数,__repr__ 按字段打印,__eq__ 按字段比较;下方注明运行时不检查类型">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink-faint)" font-size="11">你写的</text>
<rect x="20" y="36" width="230" height="140" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="36" y="62" fill="var(--ink)">@dataclass</text>
<text x="36" y="84" fill="var(--ink)">class TicketDC:</text>
<text x="52" y="106" fill="var(--ink-soft)">id: str</text>
<text x="52" y="124" fill="var(--ink-soft)">title: str</text>
<text x="52" y="142" fill="var(--ink-soft)">amount: float</text>
<text x="52" y="160" fill="var(--ink-soft)">status: str = "open"</text>
<line x1="250" y1="106" x2="300" y2="106" stroke="var(--rule)"/>
<text x="258" y="98" fill="var(--ink-faint)" font-size="11">生成</text>
<text x="300" y="28" fill="var(--ink-faint)" font-size="11">Python 替你写的</text>
<rect x="300" y="36" width="320" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="316" y="61" fill="var(--ink)">__init__(id, title, amount, status="open")</text>
<rect x="300" y="86" width="320" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="316" y="111" fill="var(--ink)">__repr__ → TicketDC(id='T-1004', ...)</text>
<rect x="300" y="136" width="320" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="316" y="161" fill="var(--ink)">__eq__ → 每个字段都相等才相等</text>
<text x="320" y="208" text-anchor="middle" fill="var(--ink-soft)" font-size="11">不生成的:类型检查、业务校验(负数金额照样进得去)</text>
</g>
</svg>
<figcaption>字段名只写一次,三个方法都从这一份字段列表里来。以后加一个字段,三个方法同时更新,不会出现「__init__ 加了、__repr__ 忘了」的情况。</figcaption>
</figure>

### 字段顺序的规矩

`__init__` 的参数顺序就是字段顺序,所以 Day 29 那条规矩在这里同样成立:没有默认值的参数不能跟在有默认值的后面。把 status 挪到中间试试,新建 `part01/dc_order.py`:

```python
# agent-zero-lab/part01/dc_order.py
from dataclasses import dataclass


@dataclass
class TicketDC:
    id: str
    status: str = "open"
    title: str
```

<div class="line-notes">

- `status: str = "open"` 有默认值的字段放在了中间。
- `title: str` 后面跟着一个没有默认值的。

</div>

```bash
uv run basedpyright part01/dc_order.py
uv run python part01/dc_order.py
```

实测输出(运行只留最后一行):

```text
dc_order.py:9:5 - error: Fields without default values cannot appear after fields with default values (reportGeneralTypeIssues)
1 error, 0 warnings, 0 notes
TypeError: non-default argument 'title' follows default argument
```

检查器和运行时都拦了。注意运行时的报错发生在**定义类的那一刻**,还没造任何对象,整个文件一运行就崩。规矩很简单:有默认值的字段一律写在最后。

## 第二步:field,给列表字段设默认值

工单想加一个标签列表 tags,默认是空的。很自然会写成 `tags: list[str] = []`。新建 `part01/dc_mutable.py`:

```python
# agent-zero-lab/part01/dc_mutable.py
from dataclasses import dataclass


@dataclass
class TicketDC:
    id: str
    tags: list[str] = []
```

<div class="line-notes">

- `tags: list[str] = []` 列表做默认值。Day 29 讲过普通函数里这么写的后果:所有调用共用同一个列表。

</div>

```bash
uv run basedpyright part01/dc_mutable.py
uv run python part01/dc_mutable.py
```

实测输出(运行只留最后一行):

```text
0 errors, 0 warnings, 0 notes
ValueError: mutable default <class 'list'> for field tags is not allowed: use default_factory
```

这一次检查器没管(standard 档下 0 errors),是 dataclass 自己在定义类的时候拦住了:「可变的默认值 list 不允许用在字段 tags 上,请用 default_factory」。

回忆一下 [Day 40](/blog/agent-zero/day-040-classes-1/) 练习里那个 `ex40_shared.py`:普通类的 `__init__(self, id, tags=[])`,两个对象的 tags 实测是同一个列表,一个加了标签,另一个也跟着变。dataclass 知道这个坑,干脆不让你这么写。报错里提到的 default_factory,就是今天的第二个新东西。新建 `part01/dc_field.py`:

```python
# agent-zero-lab/part01/dc_field.py
from dataclasses import dataclass, field


@dataclass
class TicketDC:
    id: str
    title: str
    amount: float
    status: str = "open"
    tags: list[str] = field(default_factory=list)
    note: str = field(default="", repr=False)


a = TicketDC("T-1004", "扣费两次", 89.5)
b = TicketDC("T-1005", "API 调用超额", 120, note="客户是年付")
a.tags.append("退款")
print(a)
print(b)
print(a.tags is b.tags, b.note)
print(TicketDC("T-1006", "发票重开", 66, tags=["发票", "加急"]))
```

<div class="line-notes">

- `from dataclasses import dataclass, field` field 是小写的函数,写在字段的 `=` 右边,用来给这个字段做更细的设置。
- `tags: list[str] = field(default_factory=list)` `default_factory` 要的是一个「造默认值的函数」。这里传的是 `list` 本身,不带括号:每造一个对象,dataclass 就调用一次 `list()`,得到一个全新的空列表。factory 是工厂的意思,「每次现做一个」。
- `note: str = field(default="", repr=False)` field 的另外两个参数:`default` 是普通默认值(不可变的值直接给就行,和写 `= ""` 一样);`repr=False` 让这个字段不出现在打印结果里。备注可能很长,打印工单时不想看到它。
- `a = TicketDC("T-1004", "扣费两次", 89.5)` tags 和 note 都没传。
- `b = TicketDC("T-1005", "API 调用超额", 120, note="客户是年付")` 只传 note,用关键字。
- `a.tags.append("退款")` 只给 a 加标签。
- `print(a.tags is b.tags, b.note)` 两个对象的 tags 是不是同一个列表?
- `print(TicketDC("T-1006", "发票重开", 66, tags=["发票", "加急"]))` 造的时候直接传一个列表进去也行。

</div>

```bash
uv run basedpyright part01/dc_field.py
uv run python part01/dc_field.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
TicketDC(id='T-1004', title='扣费两次', amount=89.5, status='open', tags=['退款'])
TicketDC(id='T-1005', title='API 调用超额', amount=120, status='open', tags=[])
False 客户是年付
TicketDC(id='T-1006', title='发票重开', amount=66, status='open', tags=['发票', '加急'])
```

a 加了「退款」,b 的 tags 还是空的,`a.tags is b.tags` 是 False,各有各的列表。打印结果里没有 note,`repr=False` 起作用了,但 `b.note` 照样能取到。

一句话记住什么时候要用 field:**默认值是列表、字典、集合这种可变的东西,用 `field(default_factory=...)`**,字典就是 `field(default_factory=dict)`;不可变的(字符串、数字、None、元组)直接写 `= 值`。

还有一个容易混的:后面学 pydantic 时你会见到大写的 `Field`,它来自另一个库,只是名字碰巧一样。dataclass 配小写 field,pydantic 配大写 Field,[Day 52](/blog/agent-zero/day-052-pydantic-2/) 会再提一次。

## 第三步:__post_init__ 补校验,asdict 导出

dataclass 替你写了 `__init__`,那 Day 43 写在 `__init__` 里的校验(标题不能空、金额不能负)放哪儿?放进 `__post_init__`:dataclass 生成的 `__init__` 把字段都存好之后,会自动调用它(如果你写了的话)。post 是「之后」的意思。

顺便把 status 从 str 收紧成 Day 47 的 Status。新建 `part01/dc_post_init.py`:

```python
# agent-zero-lab/part01/dc_post_init.py
from dataclasses import asdict, dataclass, field

from ticket_model import TicketError
from ticket_types import Status, parse_status


@dataclass
class TicketDC:
    id: str
    title: str
    amount: float
    status: Status = "open"
    tags: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.title.strip() == "":
            raise TicketError(f"{self.id} 标题是空的")
        if self.amount < 0:
            raise TicketError(f"{self.id} 金额不能是负数: {self.amount}")
        self.status = parse_status(self.status)


t = TicketDC("T-1004", "扣费两次", 89.5, tags=["退款"])
print(asdict(t))
for args in [("T-1006", "  ", 50), ("T-1007", "退款", -50)]:
    try:
        TicketDC(*args)
    except TicketError as e:
        print("造不出来:", e)

t.status = "done"
raw = {"id": "T-1008", "title": "退款", "amount": 50, "status": "pending"}
try:
    TicketDC(**raw)
except TicketError as e:
    print("造不出来:", e)

t.amount = -1
print(t)
```

<div class="line-notes">

- `from dataclasses import asdict, dataclass, field` asdict 把 dataclass 对象转成字典。
- `from ticket_model import TicketError` 沿用 Day 36 起的业务异常,报错文字也和 Day 43 一字不差。
- `from ticket_types import Status, parse_status` Day 47 的状态类型和校验函数,不重新写一份(Day 47 常见误区最后一条)。
- `status: Status = "open"` 字段类型从 str 换成 Status。默认值 `"open"` 在 Status 里,检查器没意见。
- `def __post_init__(self) -> None:` 名字前后各两个下划线,一个字母都不能错,写错了 dataclass 不会调用它,也不会报错(常见误区里有)。
- `if self.title.strip() == "":` 字段已经存好了,直接用 `self.title`。
- `if self.amount < 0:` 金额校验搬到这里。
- `self.status = parse_status(self.status)` 运行时再查一遍状态。检查器能管住代码里写的字面量,管不住从 JSON 里读出来的值(Day 47 第三步),所以运行时也要查。parse_status 的参数要 str,Status 是 str 的一种,能传进去。
- `print(asdict(t))` 转成普通字典。tags 这种嵌套的列表也会被复制成新列表。
- `for args in [("T-1006", "  ", 50), ("T-1007", "退款", -50)]:` 两组坏参数,放在元组里。
- `TicketDC(*args)` `*args` 把元组拆开当成位置参数传(Day 30 的 `*`)。
- `t.status = "done"` 事后改状态,写一个 Status 里没有的值。
- `raw = {"id": "T-1008", "title": "退款", "amount": 50, "status": "pending"}` 模拟从 JSON 读进来的字典。
- `TicketDC(**raw)` `**raw` 把字典拆开当成关键字参数(Day 30)。键名正好和字段名一样,所以能直接这么造。
- `t.amount = -1` 事后把金额改成负数。
- `print(t)` 看看 t 现在是什么样。

</div>

```bash
uv run basedpyright part01/dc_post_init.py
uv run python part01/dc_post_init.py
```

检查的实测输出:

```text
dc_post_init.py:32:12 - error: Cannot assign to attribute "status" for class "TicketDC"
    Type "Literal['done']" is not assignable to type "Status"
      "Literal['done']" is not assignable to type "Literal['open']"
      "Literal['done']" is not assignable to type "Literal['closed']" (reportAttributeAccessIssue)
1 error, 0 warnings, 0 notes
```

运行的实测输出:

```text
{'id': 'T-1004', 'title': '扣费两次', 'amount': 89.5, 'status': 'open', 'tags': ['退款']}
造不出来: T-1006 标题是空的
造不出来: T-1007 金额不能是负数: -50
造不出来: 状态只能是 open 或 closed,收到 'pending'
TicketDC(id='T-1004', title='扣费两次', amount=-1, status='done', tags=['退款'])
```

一项一项看。

**asdict** 得到的就是 Day 43 手写 `to_dict` 的结果,外加 tags。以后存 JSON 不用再自己拼字典。

**`__post_init__`** 拦住了空标题和负数金额,报错文字和 Day 43 一样;从字典来的 `pending` 也被 parse_status 拦住了。

**status 收紧成 Status 以后**,`t.status = "done"` 这一行检查器当场画了红线。还记得 [Day 47](/blog/agent-zero/day-047-type-hints-3/) 练习 4 吗?那时候 Ticket 的 status 是 str,`t.status = "done"` 检查器一声不吭,要等转成 TicketDict 时 parse_status 才在运行时拦下。现在这个错在写代码时就被发现了。

但最后一行暴露了两个洞,要老老实实说清楚:

- 第 32 行 `t.status = "done"` 检查器报了,运行时却照样改成功了。`__post_init__` 只在**构造时**执行一次,事后赋值它管不着。
- `t.amount = -1` 连检查器都不报(-1 是合法的 float),运行时也改成功了。Day 43 用 property 的 setter 堵上的那个漏洞,在这个 dataclass 版本里又回来了。

还有一处你可能注意到了:`TicketDC(**raw)` 那一行,检查器实测没有报错,尽管 raw 里 amount 是整数、status 是 pending。把字典拆成关键字参数时,检查器只知道值的类型是 `str | int`,没法逐个对上字段,于是放过了。字典从外面来时,运行时校验更是省不掉。

所以 dataclass 和 Day 43 手写的类是一笔取舍:dataclass 省掉了 `__init__`、`__repr__`、`__eq__`、`to_dict` 的样板代码,换来的是「只在构造时校验一次」。dataclass 也能和 property 混用,但写法别扭,字段和 property 同名时要绕好几道弯,我不推荐新手这么做。真正需要「每次赋值都校验」的场景,下一课的 pydantic 有现成的开关。对工单记事本这种「造出来之后只会调 close() 改状态」的数据,构造时校验一次已经够用。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="一个 dataclass 对象的生命周期:构造时依次经过自动生成的 __init__ 存字段、你写的 __post_init__ 校验;之后的赋值 t.amount = -1 直接改字段,不经过校验;检查器能在写代码时拦住 t.status = done 这种 Literal 不符的赋值">
<rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="40" width="140" height="56" rx="4" fill="none" stroke="var(--rule)"/>
<text x="90" y="64" text-anchor="middle" fill="var(--ink)">TicketDC(...)</text>
<text x="90" y="84" text-anchor="middle" fill="var(--ink-faint)" font-size="11">造对象</text>
<rect x="190" y="40" width="160" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="270" y="64" text-anchor="middle" fill="var(--ink)">__init__</text>
<text x="270" y="84" text-anchor="middle" fill="var(--ink-soft)" font-size="11">自动生成 · 存字段</text>
<rect x="380" y="40" width="160" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="460" y="64" text-anchor="middle" fill="var(--ink)">__post_init__</text>
<text x="460" y="84" text-anchor="middle" fill="var(--ink-soft)" font-size="11">你写的 · 校验</text>
<line x1="160" y1="68" x2="190" y2="68" stroke="var(--rule)"/>
<line x1="350" y1="68" x2="380" y2="68" stroke="var(--rule)"/>
<text x="570" y="72" fill="var(--ink-soft)" font-size="11">合格</text>
<line x1="540" y1="68" x2="565" y2="68" stroke="var(--rule)"/>
<rect x="20" y="136" width="200" height="56" rx="4" fill="none" stroke="var(--rule)"/>
<text x="120" y="160" text-anchor="middle" fill="var(--ink)">t.amount = -1</text>
<text x="120" y="180" text-anchor="middle" fill="var(--ink-faint)" font-size="11">事后赋值</text>
<line x1="220" y1="164" x2="380" y2="164" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="300" y="156" text-anchor="middle" fill="var(--ink-faint)" font-size="11">直接改字段,不经过校验</text>
<rect x="380" y="136" width="240" height="56" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="500" y="160" text-anchor="middle" fill="var(--ink)">检查器</text>
<text x="500" y="180" text-anchor="middle" fill="var(--ink-soft)" font-size="11">只拦得住 t.status = "done"</text>
</g>
</svg>
<figcaption>上面一排是构造时的路线,__post_init__ 一定会执行;下面是造完以后的赋值,运行时没有任何关卡,只有检查器能按类型拦一部分。</figcaption>
</figure>

## 把零件拼起来:ticket_dc.py

现在把 Ticket 改写成 dataclass。先说为什么**新建一个文件**,而不是直接改 Day 43 的 `ticket_model.py`。

第一个原因是 ticket_model.py 被六七个文件 import 着(ticket_checkup、notifiers、notebook、typed_report、ticket_stats、close_batch……),而 dataclass 版本和原版在两处行为不同:`t.amount = -1` 不再被拦,`vars(t)` 和打印格式也变了。直接替换,就得把这些脚本挨个重跑、挨个确认。

第二个原因是一个真实的坑。status 要用 Status,Status 在 ticket_types.py 里;可 ticket_types.py 第一行就是 `from ticket_model import TicketError`。如果再让 ticket_model.py 去 `from ticket_types import Status`,两个文件互相导入。我在一个副本目录里试了一下,实测输出(路径缩短了):

```text
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ticket_model.py", line 6, in <module>
    from ticket_types import Status
  File "/Users/你/agent-zero-lab/part01/ticket_types.py", line 6, in <module>
    from ticket_model import TicketError
  File "/Users/你/agent-zero-lab/part01/ticket_model.py", line 6, in <module>
    from ticket_types import Status
ImportError: cannot import name 'Status' from partially initialized module 'ticket_types' (most likely due to a circular import) (/Users/你/agent-zero-lab/part01/ticket_types.py)
```

这叫**循环导入**(circular import)。从下往上读:ticket_model 要 Status,于是去执行 ticket_types;ticket_types 第一行又要 ticket_model 的 TicketError,于是回头去执行 ticket_model;ticket_model 又走到要 Status 那一行,可这时 ticket_types 才执行了开头几行,Status 还没定义,只能报错。`partially initialized module` 就是「只初始化了一半的模块」。

新文件 ticket_dc.py 同时 import 这两个文件,它们俩之间还是单向的,问题就没了。新建 `part01/ticket_dc.py`:

```python
# agent-zero-lab/part01/ticket_dc.py
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from ticket_model import TicketError
from ticket_types import Status, parse_status

HERE = Path(__file__).resolve().parent
BOOK = HERE / "data" / "notebook.json"
OUT = HERE / "data" / "tickets_dc.json"


@dataclass
class Ticket:
    id: str
    title: str
    amount: float
    status: Status = "open"
    tags: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.title.strip() == "":
            raise TicketError(f"{self.id} 标题是空的")
        if self.amount < 0:
            raise TicketError(f"{self.id} 金额不能是负数: {self.amount}")
        self.status = parse_status(self.status)

    @property
    def is_closed(self) -> bool:
        return self.status == "closed"

    def close(self) -> None:
        self.status = "closed"

    def summary(self) -> str:
        return f"[{self.status}] {self.id} {self.title} ¥{self.amount}"

    def __str__(self) -> str:
        return self.summary()

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Ticket":
        return cls(
            id=d["id"],
            title=d["title"],
            amount=d["amount"],
            status=parse_status(d.get("status", "open")),
            tags=list(d.get("tags", [])),
        )


def load(path: Path) -> list[Ticket]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return [Ticket.from_dict(d) for d in data]


def save(path: Path, tickets: list[Ticket]) -> None:
    data = [t.to_dict() for t in tickets]
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    tickets = load(BOOK)
    tickets[2].tags.append("退款")
    for t in tickets:
        print(t)
    print(repr(tickets[2]))

    save(OUT, tickets)
    again = load(OUT)
    print("存进去再读回来,一样吗?", again == tickets)

    try:
        Ticket.from_dict({"id": "T-1006", "title": "退款", "amount": 50, "status": "pending"})
    except TicketError as e:
        print("没通过:", e)
```

<div class="line-notes">

- `from typing import Any` from_dict 收的是刚从 JSON 出来的字典,Any 只活在这一个方法的参数里(Day 47 的规矩)。
- `from ticket_model import TicketError` 只拿异常,不拿旧的 Ticket 类。
- `from ticket_types import Status, parse_status` 状态的唯一定义。
- `OUT = HERE / "data" / "tickets_dc.json"` 存到一个新文件,不覆盖记事本。
- `class Ticket:` 这次就叫 Ticket。和 ticket_model.Ticket 同名不冲突,因为它们在不同的模块里,练习 3 会同时用到两个。
- `status: Status = "open"` Day 47 说的「收紧成 Status」就是这一行。
- `tags: list[str] = field(default_factory=list)` 新字段。旧的 notebook.json 里没有 tags,from_dict 里会处理。
- `def __post_init__(self) -> None:` 第三步的三道校验。
- `@property` dataclass 里照样可以写 property 和普通方法,`@dataclass` 只管字段(带类型标注的行),不碰方法。
- `def is_closed(self) -> bool:` Day 43 的只读 property 原样搬来,Day 44 的 TicketBook、Day 42 的通知逻辑都用它。
- `def close(self) -> None:` 改状态。
- `self.status = "closed"` 写的是字面量,检查器知道它在 Status 里。如果手滑写成 `"close"`,这一行会红线。
- `def summary(self) -> str:` 保留,别的代码在用这个名字。
- `def __str__(self) -> str:` 自己写了 `__str__`。dataclass 只生成 `__repr__`,不碰 `__str__`,所以 print 走这里,`repr()` 和列表打印走 dataclass 生成的版本。
- `def to_dict(self) -> dict[str, Any]:` 名字和 Day 40 起的约定一样,里面换成一行 asdict。
- `return asdict(self)` 字段多了少了,这里都不用改。
- `@classmethod` Day 43 第六步。
- `def from_dict(cls, d: dict[str, Any]) -> "Ticket":` 返回类型照样加引号。
- `id=d["id"],` 用关键字传参,一个字段一行,字段多的时候不会对错位。
- `status=parse_status(d.get("status", "open")),` 没写 status 就当 open,再检查。`__post_init__` 里还会再查一次,这里先查是为了让检查器满意:`d.get(...)` 是 Any,直接传给 Status 参数不会报错,但写上 parse_status,读代码的人一眼知道这里检查过。
- `tags=list(d.get("tags", [])),` 旧数据没有 tags 就给空列表;`list(...)` 复制一份,不和字典共用同一个列表。这里的 `[]` 是普通表达式,每次执行都新造一个,不是 Day 29 那种默认参数,没有共用的问题。
- `return [Ticket.from_dict(d) for d in data]` 每条都过一遍校验。
- `data = [t.to_dict() for t in tickets]` 存的时候用 to_dict,不用 vars(Day 43 讲过)。
- `tickets[2].tags.append("退款")` 给第三张(T-1004)加个标签,只改内存。
- `print(repr(tickets[2]))` dataclass 生成的 `__repr__`。
- `again = load(OUT)` 存进去再读回来。
- `print("存进去再读回来,一样吗?", again == tickets)` 两个列表比较时会逐个元素用 `==`,也就是 dataclass 生成的 `__eq__`。
- `Ticket.from_dict({"id": "T-1006", "title": "退款", "amount": 50, "status": "pending"})` 坏状态,应该被拦。

</div>

先检查,再运行:

```bash
uv run basedpyright part01/ticket_dc.py
uv run python part01/ticket_dc.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
[closed] T-1001 发票抬头开错了 ¥199
[open] T-1002 升级套餐 年付 ¥399
[open] T-1004 扣费两次 ¥89.5
[open] T-1005 API 调用超额 ¥120
Ticket(id='T-1004', title='扣费两次', amount=89.5, status='open', tags=['退款'])
存进去再读回来,一样吗? True
没通过: 状态只能是 open 或 closed,收到 'pending'
```

旧的 notebook.json 没有 tags,照样读进来了;print 走自己写的 `__str__`,repr 走 dataclass 生成的;存进去再读回来,`again == tickets` 是 True。Day 43 的版本这里会是 False,因为它没有 `__eq__`。看一眼新文件的开头:

```bash
head -8 part01/data/tickets_dc.json
```

实测输出:

```text
[
  {
    "id": "T-1001",
    "title": "发票抬头开错了",
    "amount": 199,
    "status": "closed",
    "tags": []
  },
```

每张工单多了一个 `"tags": []`,这是 asdict 按字段导出的结果。

| 今天的零件 | 在 ticket_dc.py 里是哪一段 |
| --- | --- |
| 开头 `==` 不按值比较 | `again == tickets` 现在是 True |
| 第一步 `@dataclass`、字段、默认值 | `@dataclass class Ticket` 和五个字段 |
| 第一步 字段顺序 | 有默认值的 status、tags 放在最后 |
| 第二步 `field(default_factory=list)` | `tags` 字段 |
| 第三步 `__post_init__` | 标题、金额、状态三道校验 |
| 第三步 `asdict` | `to_dict` |
| 第三步 status 收紧成 Status | `status: Status = "open"`,`close()` 里的字面量 |
| Day 43 property、classmethod、`__str__` | `is_closed`、`from_dict`、`__str__` 原样保留 |

和 Day 43 的版本比,手写的 `__init__`、`__repr__`、to_dict 里的字典都没了,多出来的是 tags 字段和状态校验,总行数差不多(我数了一下,类定义部分去掉空行一个 32 行、一个 33 行),但做的事多了。dataclass 省下的行数,正好拿去写了更多的校验。

## 动手练习

### 练习 1:改不了的价格

价格这种数据,造出来以后就不该被随手改。新建 `part01/ex50_frozen.py`,用 `@dataclass(frozen=True)` 写一个 `Price`(plan、monthly 两个字段),造一个 pro 套餐 99 元的价格,试着把 monthly 改成 79,看检查器和运行时各说什么。然后用 `dataclasses.replace` 造一个促销价,最后试试把两个 Price 当成字典的键。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex50_frozen.py
from dataclasses import FrozenInstanceError, dataclass, replace


@dataclass(frozen=True)
class Price:
    plan: str
    monthly: float


pro = Price("pro", 99)
try:
    pro.monthly = 79
except FrozenInstanceError as e:
    print("改不了:", e)

promo = replace(pro, monthly=79)
print(pro, promo, pro is promo)
print({pro: "原价", promo: "促销价"})
```

<div class="line-notes">

- `from dataclasses import FrozenInstanceError, dataclass, replace` 改冻结对象时抛的异常、装饰器、复制并改字段的函数。
- `@dataclass(frozen=True)` 装饰器带参数时要加括号。frozen 是冻结:造出来以后任何字段都不能再赋值。
- `pro.monthly = 79` 冻结的对象不能改。
- `except FrozenInstanceError as e:` 接住看看说了什么。
- `promo = replace(pro, monthly=79)` 不改原对象,而是复制一份并把 monthly 换成 79。≈ JS 里 `{...pro, monthly: 79}` 的写法。
- `print({pro: "原价", promo: "促销价"})` 能当字典的键,要求对象「不会变」。冻结的 dataclass 满足这一点,dataclass 会顺便替它生成 `__hash__`(哈希,字典找键用的那个数),普通的 dataclass 不行。

</div>

```bash
uv run basedpyright part01/ex50_frozen.py
uv run python part01/ex50_frozen.py
```

检查的实测输出:

```text
ex50_frozen.py:13:9 - error: Cannot assign to attribute "monthly" for class "Price"
    Attribute "monthly" is read-only (reportAttributeAccessIssue)
1 error, 0 warnings, 0 notes
```

运行的实测输出:

```text
改不了: cannot assign to field 'monthly'
Price(plan='pro', monthly=99) Price(plan='pro', monthly=79) False
{Price(plan='pro', monthly=99): '原价', Price(plan='pro', monthly=79): '促销价'}
```

这次检查器和运行时**都**拦了,不像第三步那样只有检查器管。frozen 也是第三步那个「事后赋值不校验」问题的一种解法:根本不让事后赋值,要改就 replace 造一个新的,而 replace 会重新走 `__init__` 和 `__post_init__`,校验一次不落。代价是 Ticket 的 `close()` 就不能写成 `self.status = "closed"` 了。我的习惯是:配置、价格、坐标这种「值」用 frozen,工单这种「会变状态的东西」不用。

</details>

### 练习 2:客户改写成 dataclass

把 Day 47 练习 1 的客户写成 dataclass:id、name,plan 只能是 basic、pro、team(默认 basic),email 可以没有(`str | None`,默认 None),还有一个工单号列表 ticket_ids。写一个 `parse_plan` 和 `__post_init__` 守住套餐,再写 `line()` 返回一行摘要。新建 `part01/ex50_customer.py`,造两个客户,再拿一个套餐是 enterprise 的字典试一次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex50_customer.py
from dataclasses import dataclass, field
from typing import Literal

Plan = Literal["basic", "pro", "team"]


def parse_plan(value: str) -> Plan:
    if value in ("basic", "pro", "team"):
        return value
    raise ValueError(f"套餐不认识: {value!r}")


@dataclass
class Customer:
    id: str
    name: str
    plan: Plan = "basic"
    email: str | None = None
    ticket_ids: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.plan = parse_plan(self.plan)

    def line(self) -> str:
        email = self.email if self.email is not None else "未留邮箱"
        return f"{self.id} {self.name} [{self.plan}] {email} 工单 {len(self.ticket_ids)} 张"


a = Customer("C-001", "李雷", "pro", "lilei@example.com")
b = Customer("C-002", "韩梅梅")
a.ticket_ids.append("T-1004")
print(a.line())
print(b.line())
print(b)
raw = {"id": "C-003", "name": "王芳", "plan": "enterprise"}
try:
    Customer(raw["id"], raw["name"], parse_plan(raw["plan"]))
except ValueError as e:
    print("没通过:", e)
```

<div class="line-notes">

- `def parse_plan(value: str) -> Plan:` 和 parse_status 一个套路:收 str,检查过才返回 Plan。
- `plan: Plan = "basic"` 有默认值,放在没默认值的 name 后面。
- `email: str | None = None` Day 46 的 `X | None`,默认 None 表示没留邮箱。None 不可变,直接写 `= None`,不用 field。
- `ticket_ids: list[str] = field(default_factory=list)` 列表默认值必须用 field。
- `self.plan = parse_plan(self.plan)` 运行时守住套餐。
- `email = self.email if self.email is not None else "未留邮箱"` 收窄后 email 是 str。
- `b = Customer("C-002", "韩梅梅")` plan、email、ticket_ids 都用默认值。
- `print(b)` 看 dataclass 生成的打印,None 和空列表都会显示出来。
- `Customer(raw["id"], raw["name"], parse_plan(raw["plan"]))` 字典里取出来的是普通 str,直接传给 Plan 参数会红线(Day 47 第二步),所以先过 parse_plan。我第一版写的是 `Customer(raw["id"], raw["name"], raw["plan"])`,实测报 `Argument of type "str" cannot be assigned to parameter "plan" of type "Plan"`。

</div>

```bash
uv run basedpyright part01/ex50_customer.py
uv run python part01/ex50_customer.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
C-001 李雷 [pro] lilei@example.com 工单 1 张
C-002 韩梅梅 [basic] 未留邮箱 工单 0 张
Customer(id='C-002', name='韩梅梅', plan='basic', email=None, ticket_ids=[])
没通过: 套餐不认识: 'enterprise'
```

和 Day 47 的 CustomerDict 比:那边是 TypedDict,运行时是普通字典,取值写 `c["plan"]`;这边是 dataclass,运行时是 Customer 对象,取值写 `c.plan`,还能带 line() 这样的方法。Day 47 说的「数据要带行为就用类」,dataclass 是写这种类最省事的办法。

</details>

### 练习 3:in 和 remove 终于能用了

新建 `part01/ex50_eq.py`,分别造一个 Day 43 的 Ticket 列表和一个今天 dataclass 的 Ticket 列表,各自用一张「字段完全一样的新工单」去做 `in` 判断,再对 dataclass 版本的列表做 `remove`。先猜结果。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex50_eq.py
import ticket_dc
import ticket_model

old = [ticket_model.Ticket("T-1004", "扣费两次", 89.5)]
new = [ticket_dc.Ticket("T-1004", "扣费两次", 89.5)]

print(ticket_model.Ticket("T-1004", "扣费两次", 89.5) in old)
print(ticket_dc.Ticket("T-1004", "扣费两次", 89.5) in new)
new.remove(ticket_dc.Ticket("T-1004", "扣费两次", 89.5))
print(len(new))
```

<div class="line-notes">

- `import ticket_dc` 两个模块里都有叫 Ticket 的类,用 `模块名.类名` 区分(Day 32 的 import 写法)。ticket_dc 的演示在 main guard 里,import 不会执行。
- `print(ticket_model.Ticket("T-1004", "扣费两次", 89.5) in old)` 列表的 `in` 是拿每个元素用 `==` 比。旧 Ticket 没有 `__eq__`,只有同一个对象才算。
- `print(ticket_dc.Ticket("T-1004", "扣费两次", 89.5) in new)` dataclass 版按字段比。
- `new.remove(ticket_dc.Ticket("T-1004", "扣费两次", 89.5))` remove 也是用 `==` 找要删的元素。旧版本这样写会报 `ValueError: list.remove(x): x not in list`。

</div>

```bash
uv run basedpyright part01/ex50_eq.py
uv run python part01/ex50_eq.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
False
True
0
```

`in`、`remove`、`index`、`count` 这些列表方法背后都是 `==`,所以「按值相等」不只是让 `a == b` 好看,它决定了这些常用操作能不能按你想的工作。Day 44 的 TicketBook.delete 是先 find 拿到同一个对象再 remove,所以旧版本也没出问题;如果当时是拿一张新造的工单去删,就会撞上这个坑。

</details>

验收标准:`uv run basedpyright part01/ticket_dc.py part01/ex50_customer.py part01/ex50_eq.py` 输出 `0 errors`;`uv run python part01/ticket_dc.py` 的输出和正文一致(T-1004 金额以你的数据为准);不看文章能写出一个带列表字段和 `__post_init__` 的 dataclass;能说出 dataclass 生成了哪三个方法、没做哪两件事(类型检查、事后赋值的校验);能说清什么时候用 TypedDict、什么时候用 dataclass。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| dataclass | 标准库 dataclasses 提供的装饰器,`@dataclass` 放在类上,按类型标注的字段自动生成 `__init__`、`__repr__`、`__eq__`;运行时不检查类型 |
| 字段(field) | dataclass 里每一行 `名字: 类型` 或 `名字: 类型 = 默认值`,只认带类型标注的行 |
| `field(...)` | 小写的函数,写在字段 `=` 右边做更细的设置,常用参数 `default_factory`、`default`、`repr` |
| `default_factory` | 「造默认值的函数」,每造一个对象调用一次,`field(default_factory=list)` 让每个对象有自己的空列表 |
| 可变默认值 | 列表、字典、集合这种能原地修改的值做默认值,会被所有对象共用;dataclass 直接报 `mutable default ... is not allowed` |
| `__post_init__` | dataclass 生成的 `__init__` 存完字段后自动调用的方法,用来写校验或计算 |
| `asdict` | 把 dataclass 对象(包括里面嵌套的)转成普通字典 |
| `__eq__` | `==` 背后调用的魔术方法;普通类不写它时 `==` 等于 `is` |
| `frozen=True` | 冻结的 dataclass,造好后不能赋值,能当字典的键;要改用 `dataclasses.replace` 造新的 |
| 循环导入(circular import) | 两个模块互相 import,其中一个只执行了一半就被另一个要东西,报 `partially initialized module` |
| `inspect.signature` | 标准库函数,查看一个函数或类的参数签名 |

## 常见误区

**以为 dataclass 会检查类型。** `TicketDC(1004, None, "八十九")` 实测顺利造出来,打印成 `TicketDC(id=1004, title=None, amount='八十九', status='open')`。字段上的类型只给检查器看,运行时要拦就写 `__post_init__`,或者用下一课的 pydantic。

**列表默认值直接写 `= []`。** 实测在定义类的那一刻就是 `ValueError: mutable default <class 'list'> for field tags is not allowed: use default_factory`,而且 basedpyright standard 档不报。写 `field(default_factory=list)`,注意 `list` 后面不带括号。

**写成 `field(default_factory=list())`。** 带了括号,传进去的就是一个已经造好的空列表,而不是「造列表的函数」。dataclass 每次造对象时都会去「调用」它,实测结果是 `TypeError: 'list' object is not callable`;检查器也提前标了红,报的是 `No overloads for "field" match the provided arguments`。

**有默认值的字段写在前面。** 实测检查器报 `Fields without default values cannot appear after fields with default values`,运行时 `TypeError: non-default argument 'title' follows default argument`。有默认值的一律放最后。

**`__post_init__` 名字拼错。** 写成 `__postinit__` 或 `__post_init`,dataclass 不认识它,当成普通方法放着不调用,校验悄无声息地失效,没有任何报错。写完造一个坏对象试一次,确认真的被拦住了。

**以为 `__post_init__` 管得住事后赋值。** 实测 `t.amount = -1` 构造后照样改成功。需要「不能改」就用 `frozen=True`;需要「每次改都校验」就用 property 手写,或者用 pydantic。

**两个模块互相 import。** ticket_model 和 ticket_types 互相导入,实测 `ImportError: cannot import name 'Status' from partially initialized module 'ticket_types' (most likely due to a circular import)`。修法是让依赖保持单向:要两边都用的东西,放进第三个文件,或者像今天这样由一个新文件同时导入两边。

**大小写 field 和 Field 混用。** dataclass 用 `from dataclasses import field`,pydantic 用 `from pydantic import Field`,不是同一个东西,参数也不一样,[Day 52](/blog/agent-zero/day-052-pydantic-2/) 会再讲。

## 学习资料

### 文档与文章

- [Python 标准库 · dataclasses(中文)](https://docs.python.org/zh-cn/3.12/library/dataclasses.html):今天所有东西的官方说明。重点看「模块内容」里 `@dataclass` 的参数表(frozen、order、eq 都在这里)、「后初始化处理」一节(`__post_init__`)、「可变默认值」一节,最后一节的例子和第二步的坑一模一样。
- [PEP 557 · Data Classes](https://peps.python.org/pep-0557/):提案原文,英文。Rationale 一节列了 dataclass 和 namedtuple、attrs 等已有方案比有什么不同,读一读能知道它为什么长这样。
- [Python typing 规范 · Dataclasses](https://typing.python.org/en/latest/spec/dataclasses.html):检查器是怎么理解 dataclass 的,比如为什么能从字段推出 `__init__` 的签名。碰到「检查器为什么不报」的问题时来查。
- [TypeScript Handbook · Classes · Parameter Properties](https://www.typescriptlang.org/docs/handbook/2/classes.html#parameter-properties):TS 那边省掉 `this.x = x` 的写法,对照第一步末尾那段看两者差在哪。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV15zSVYtE13&autoplay=0&high_quality=1" title="【Py】dataclass：懂事的类会自己生成方法 | Python特性" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Hucci写代码 · 【Py】dataclass:懂事的类会自己生成方法 · 约 7 分钟,2024 年。对应第一步:dataclass 替你生成了哪些方法,和手写的类比起来少了多少代码。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1TR4y1V7NV&autoplay=0&high_quality=1" title="【Python】@dataclasses 一个让你节约数小时的装饰器 | Python 基础教程 | Python 冷知识 | 十分钟高手系列" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>羽芋羊 · @dataclasses 一个让你节约数小时的装饰器 · 约 9 分钟,2022 年的视频,讲得比较全:field、default_factory、frozen 都有,看完第二步和练习 1 再看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/CvQ7e6yUtnw" title="This Is Why Python Data Classes Are Awesome" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>ArjanCodes · This Is Why Python Data Classes Are Awesome · 英文,从一个普通类改写成 dataclass,中间讲了 default_factory、`__post_init__`、frozen,和今天的顺序几乎一致。</figcaption>
</figure>

### 书籍

- 《流畅的 Python(第 2 版)》,Luciano Ramalho 著,人民邮电出版社,2023。第 5 章「数据类构建器」专讲 dataclass,把它和 namedtuple、typing.NamedTuple 放在一起比,还讲了 `field` 的全部参数和 `__post_init__`。作者在这一章末尾专门提醒:数据类用多了可能是一种「坏味道」,数据和处理它的行为分到了两个地方。读完今天正好读这一章。

### 开源项目与代码

- [openai/openai-agents-python 的 `src/agents/agent.py`](https://github.com/openai/openai-agents-python/blob/main/src/agents/agent.py):OpenAI 官方的 Agent SDK,它的核心类 `Agent` 就是一个 dataclass。在文件里搜 `@dataclass`,能看到 `tools: list[Tool] = field(default_factory=list)` 这样的字段,和今天第二步的写法一模一样;类名后面的 `Generic[TContext]` 是 Day 49 泛型的类版本。现在看不懂大部分字段没关系,先找到这几行眼熟的,第五部分讲框架时会再回来。

## 自测

1. 下面这个类,`print(Order("O-1", 99))` 和 `Order("O-1", 99) == Order("O-1", 99)` 各输出什么?

```python
from dataclasses import dataclass

@dataclass
class Order:
    id: str
    total: float
    paid: bool = False
```

<details><summary>答案</summary>

打印 `Order(id='O-1', total=99, paid=False)`,相等比较是 `True`。dataclass 自动生成了 `__repr__` 和按字段比较的 `__eq__`。如果去掉 `@dataclass` 又不手写这两个方法,打印是 `<__main__.Order object at 0x...>`,比较是 False。

</details>

2. 给 Order 加一个 `items: list[str]` 字段,默认为空列表,应该怎么写?写成 `items: list[str] = []` 会怎样?

<details><summary>答案</summary>

写 `items: list[str] = field(default_factory=list)`,并且 `from dataclasses import field`。写成 `= []` 会在定义类时报 `ValueError: mutable default <class 'list'> for field items is not allowed: use default_factory`,因为可变的默认值会被所有对象共用。

</details>

3. `Order("O-1", -5)` 想让它报错,校验写在哪里?写好以后 `o.total = -5` 会被拦吗?

<details><summary>答案</summary>

写在 `def __post_init__(self) -> None:` 里,`if self.total < 0: raise ...`。它只在构造时执行一次,事后 `o.total = -5` 不会被拦。要不让改可以用 `@dataclass(frozen=True)`,要每次赋值都校验就得用 property,或者 pydantic。

</details>

4. 同样描述一张工单,Day 47 的 TicketDict 和今天的 dataclass Ticket,运行时各是什么?各怎么取 amount?

<details><summary>答案</summary>

TicketDict 运行时是普通的 dict,取值写 `t["amount"]`,不能带方法;dataclass Ticket 运行时是 Ticket 对象,取值写 `t.amount`,可以带 close()、is_closed 这些行为。两者都不在运行时检查类型。和 JSON 来回转、不需要方法的用 TypedDict;需要行为的用 dataclass。

</details>

5. 面试题:dataclass 和 pydantic 都能「定义一个装数据的类」,你在 Agent 项目里怎么选?

<details><summary>答案</summary>

看数据从哪里来。纯内部传来传去、由自己的代码构造的数据(配置、中间结果、事件记录),用 dataclass 就够了,它是标准库,轻、快,不做运行时类型检查。从外部进来的数据(HTTP 请求、模型输出的 JSON、用户填的表单)必须在边界上校验,用 pydantic,它会按字段类型检查并转换,报错还会逐条列出哪个字段错了;大模型的结构化输出和工具参数,几乎都是用 pydantic 模型来定义和校验的。dataclass 的 `__post_init__` 也能手写校验,但字段一多就是 Day 41 那种啰嗦的 if 链。

</details>

## 明天预告

[Day 51 · pydantic(一):守大门的模型和校验报错](/blog/agent-zero/day-051-pydantic-1/)。今天的 ticket_dc.py 在 `__post_init__` 里手写了三道校验,`TicketDC(**raw)` 那种从字典来的坏数据还靠 parse_status 兜底。明天的 pydantic 把「按类型校验外来数据」这件事包下来:字段写法和 dataclass 很像,但金额传成「八十九」会直接给你一条说清楚哪个字段、错在哪的 ValidationError,写法和前端的 zod 几乎是一个思路。
