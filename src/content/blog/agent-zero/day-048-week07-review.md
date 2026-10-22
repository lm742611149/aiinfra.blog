---
title: 'Day 48 · 第 7 周复习:编程地基(Day 42–47)'
description: '这一周学了继承和组合、__repr__ 和 property、命令行记事本,还有三天类型标注。今天默写三段核心代码,再只用本周学过的东西拼一个「批量关单并通知」的命令行脚本,让它在 basedpyright 下 0 报错,最后把这周实测过的报错整理成一张错题表。'
pubDate: 2026-10-22
regime: none
tags: ['python', 'review', 'agent-zero']
series: 'agent-zero'
day: 48
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 47](/blog/agent-zero/day-047-type-hints-3/) 用 TypedDict 给工单字典定了形状,用 `Literal["open", "closed"]` 把状态限定成两个值,又亲手验证了它们在运行时都不检查,所以写了 `parse_status` 和 `parse_ticket` 两个校验函数,放进 `part01/ticket_types.py`。

这一周前半段在学怎么把代码组织成类(继承、组合、魔术方法、property),中间拿一个命令行记事本把它们用了一遍,后半段三天都在学怎么让检查器帮你看住这些类和数据。两件事其实是连着的:类写得越多,对象在文件之间传来传去,越需要检查器告诉你「这里传错了」。今天停一天,把它们串起来。

## 今天要解决的问题

学完今天,你应该能:

1. 合上文章默写出一组通知渠道类:父类 + 两个子类(用 `super().__init__`)+ 一个用组合持有渠道的通知中心,跑出和文中一致的结果。
2. 默写出带 `__repr__`、`__str__`、金额 setter、只读 property 和 `from_dict` 类方法的 Ticket 类,以及一份带 `Literal`、`TypedDict`、`X | None` 的类型定义。
3. 只用本周的知识拼出 `close_batch.py`:从命令行收一串工单号,批量关单、经两个渠道通知、返回一个有形状的结果字典、用退出码告诉调用方成败,`uv run basedpyright` 0 报错。
4. 看到这周出现过的任何一条报错,不翻文章就能说出病因。

预计用时:3 小时。三段默写各 25 分钟左右,小项目 1 小时,剩下的时间做练习和自测。前置:[Day 42](/blog/agent-zero/day-042-classes-2/) 到 [Day 47](/blog/agent-zero/day-047-type-hints-3/) 全部。今天不调 API,不装新依赖,花费 0 元。

学法和平时一样:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章,把三段默写和 `close_many` 函数再写一遍;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

命令都在项目根目录 `agent-zero-lab` 里跑,文件放进 `part01/`。小项目会 import 三个已有文件,先确认它们在,而且演示代码都包在 `if __name__ == "__main__":` 里:Day 43 改造过的 `part01/ticket_model.py`、Day 42 的 `part01/notifiers.py`、Day 44 的 `part01/notebook.py`。数据用 Day 44 的 `part01/data/notebook.json`,里面应该是 T-1001(已关)、T-1002、T-1004、T-1005 四张。下面检查结果里的路径一律缩短成文件名。

## 本周知识地图

这周的六天可以拆成三层。最下面一层是**怎么造对象**(Day 42、43),中间一层是**拿对象做一个真东西**(Day 44),最上面一层是**让检查器看住这些对象和数据**(Day 45–47)。今天的小项目从上到下都会用到:

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="本周知识地图:底层是 Day 42 继承与组合、Day 43 repr property 类方法;中层是 Day 44 命令行记事本,用 sys.argv 和退出码;上层是 Day 45 标注和检查器、Day 46 X 或 None 和容器、Day 47 TypedDict 和 Literal;今天的 close_batch.py 横跨三层">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="16" y="28" fill="var(--ink-faint)" font-size="11">检查器看住它们</text>
<rect x="16" y="36" width="190" height="62" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="111" y="60" text-anchor="middle" fill="var(--ink)">Day 45 标注</text>
<text x="111" y="80" text-anchor="middle" fill="var(--ink-soft)" font-size="11">basedpyright · 读红线</text>
<rect x="225" y="36" width="190" height="62" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="60" text-anchor="middle" fill="var(--ink)">Day 46 X | None</text>
<text x="320" y="80" text-anchor="middle" fill="var(--ink-soft)" font-size="11">收窄 · list[str] · Any</text>
<rect x="434" y="36" width="190" height="62" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="529" y="60" text-anchor="middle" fill="var(--ink)">Day 47 TypedDict</text>
<text x="529" y="80" text-anchor="middle" fill="var(--ink-soft)" font-size="11">Literal · 手写校验</text>
<text x="16" y="128" fill="var(--ink-faint)" font-size="11">拿对象做个真东西</text>
<rect x="16" y="136" width="608" height="50" rx="4" fill="none" stroke="var(--rule)"/>
<text x="320" y="166" text-anchor="middle" fill="var(--ink)">Day 44 notebook.py · sys.argv · 退出码 · TicketBook 组合</text>
<text x="16" y="216" fill="var(--ink-faint)" font-size="11">怎么造对象</text>
<rect x="16" y="224" width="296" height="62" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="164" y="248" text-anchor="middle" fill="var(--ink)">Day 42 继承 vs 组合</text>
<text x="164" y="268" text-anchor="middle" fill="var(--ink-soft)" font-size="11">super() · 多态 · 「是一种」「有」</text>
<rect x="328" y="224" width="296" height="62" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="476" y="248" text-anchor="middle" fill="var(--ink)">Day 43 魔术方法</text>
<text x="476" y="268" text-anchor="middle" fill="var(--ink-soft)" font-size="11">__repr__ · property · classmethod</text>
<line x1="164" y1="224" x2="164" y2="186" stroke="var(--rule)"/>
<line x1="476" y1="224" x2="476" y2="186" stroke="var(--rule)"/>
<line x1="111" y1="98" x2="111" y2="136" stroke="var(--rule)"/>
<line x1="320" y1="98" x2="320" y2="136" stroke="var(--rule)"/>
<line x1="529" y1="98" x2="529" y2="136" stroke="var(--rule)"/>
</g>
</svg>
<figcaption>下面两块(琥珀色)是运行时真正干活的代码,上面三块(蓝色)只在检查时起作用。今天的 close_batch.py 三层都踩:渠道类和 Ticket 在底层,命令行入口在中层,BatchResult 的形状在上层。</figcaption>
</figure>

这张图里最容易混的是上下两层的分工。Day 43 的 setter 在**运行时**拦住负数金额,Day 47 的 Literal 在**检查时**拦住拼错的状态,两者不能互相替代。Day 47 第三步那个实验(`json.loads` 出来的坏数据一路畅通)就是在提醒你:上层再严,数据从外面进来那一刻,还是得靠下层的代码去查。

## 本周每天一句话

- [Day 42](/blog/agent-zero/day-042-classes-2/):`class EmailNotifier(Notifier)` 是继承,子类写了自己的 `__init__` 就要先 `super().__init__(...)`;「A 是一种 B」读得通才继承,读不通就用组合,把别的对象存成自己的属性(`self.channels = channels`)。
- [Day 43](/blog/agent-zero/day-043-classes-3/):`__repr__` 给开发者看(带 `!r` 引号),`__str__` 给用户看;`@property` ≈ JS 的 getter,`@amount.setter` 让赋值也过校验,真值存在 `self._amount`;`@classmethod` 的第一个参数是类本身 `cls`,用来写 `from_dict` 这种「另一种造法」。
- [Day 44](/blog/agent-zero/day-044-notebook-project/):`sys.argv[1:]` 是用户敲的参数(全是字符串),`sys.exit(main())` 把 main 的返回值变成退出码;记事本类持有路径和工单列表,每条会改数据的命令最后都要 save。
- [Day 45](/blog/agent-zero/day-045-type-hints-1/):`def f(x: int) -> str:` 和 TS 几乎一样,但运行时没人看;装 basedpyright、在 pyproject.toml 写 `typeCheckingMode = "standard"`,先检查再运行;`reveal_type` 问检查器「你觉得这是什么」。
- [Day 46](/blog/agent-zero/day-046-type-hints-2/):可能没有就写 `Ticket | None`,用 `if t is None:` 收窄;容器写 `list[str]`、`dict[str, int]`、`tuple[float, float]`,空容器也要标;Any 让检查器失明,`json.loads` 返回的就是它。
- [Day 47](/blog/agent-zero/day-047-type-hints-3/):TypedDict ≈ TS 的 interface,运行时只是普通 dict,可选键写 `NotRequired`;`Literal["open", "closed"]` ≈ TS 的字面量联合类型,普通 str 要先用 `in` 判断才能交给它。

## 默写一:通知渠道

默写的规矩:先只看下面这段要求,在空文件里写,写完跑,跑通了再展开对照。

**要求**:写父类 `Notifier`,`__init__` 收 `to` 并建一个空列表 `sent`,`send(text)` 直接 `raise NotImplementedError`;写 `EmailNotifier`(多一个 `prefix` 属性,默认 `"[云簿客服]"`)和 `SmsNotifier`(超过 10 个字符就截成 9 个加「…」),两个子类的 send 都要把发出的文字记进 sent 并打印一行;写 `NotifyCenter`,构造时传进一组渠道,`broadcast(text)` 挨个渠道发送并返回发了几条。最后验证子类是 Notifier 的实例、直接用父类发会报错。为了好默写,这一版的 send 收的是一段文字,不是 Day 42 的工单对象。文件名 `part01/recall_notify.py`。

<details><summary>对照答案</summary>

```python
# agent-zero-lab/part01/recall_notify.py
class Notifier:
    def __init__(self, to: str):
        self.to = to
        self.sent: list[str] = []

    def send(self, text: str) -> None:
        raise NotImplementedError(f"{type(self).__name__} 还没写 send")


class EmailNotifier(Notifier):
    def __init__(self, to: str, prefix: str = "[云簿客服]"):
        super().__init__(to)
        self.prefix = prefix

    def send(self, text: str) -> None:
        self.sent.append(f"{self.prefix} {text}")
        print(f"  邮件 -> {self.to}: {self.prefix} {text}")


class SmsNotifier(Notifier):
    def send(self, text: str) -> None:
        short = text if len(text) <= 10 else text[:9] + "…"
        self.sent.append(short)
        print(f"  短信 -> {self.to}: {short}")


class NotifyCenter:
    def __init__(self, channels: list[Notifier]):
        self.channels = channels

    def broadcast(self, text: str) -> int:
        for ch in self.channels:
            ch.send(text)
        return len(self.channels)


email = EmailNotifier("li@beichen.com")
sms = SmsNotifier("138-0000-1234")
center = NotifyCenter([email, sms])
print("发出", center.broadcast("工单 T-1001 已关闭"), "条")
print(isinstance(sms, Notifier), len(email.sent), sms.sent)
try:
    Notifier("x").send("hi")
except NotImplementedError as e:
    print("父类不能直接发:", e)
```

<div class="line-notes">

- `class Notifier:` 父类放所有渠道共有的东西:收件人 to、发送记录 sent。
- `self.sent: list[str] = []` 空列表写标注,Day 46 的规矩。不写的话检查器认为它是 `list[Unknown]`。
- `raise NotImplementedError(f"{type(self).__name__} 还没写 send")` Day 42 第三步:父类不知道怎么发,留给子类填。`type(self).__name__` 是「实际是哪个类」的名字,下面直接用父类调用时实测是 `Notifier`。
- `class EmailNotifier(Notifier):` 「邮件渠道是一种通知渠道」读得通,用继承。
- `def __init__(self, to: str, prefix: str = "[云簿客服]"):` 有新属性才需要自己写 `__init__`,带默认值的参数放后面。
- `super().__init__(to)` 第一行先交给父类,不然 `self.to` 和 `self.sent` 都不存在。Day 42 练习 3 实测过忘写它的后果:`AttributeError: ... has no attribute 'sent'`。
- `self.sent.append(f"{self.prefix} {text}")` sent 是父类建的,能用它说明 super 调对了。
- `class SmsNotifier(Notifier):` 短信没有新属性,所以**不写** `__init__`,直接沿用父类的。这一点默写时经常被忘:不写 `__init__` 是合法的,写了才必须调 super。
- `short = text if len(text) <= 10 else text[:9] + "…"` [Day 39](/blog/agent-zero/day-039-json/) 用过的一行 if/else(条件表达式,≈ JS 的三元 `a ? b : c`)。「工单 T-1001 已关闭」是 13 个字符(中文、字母、空格都算一个),超了,取前 9 个「工单 T-1001」再加省略号。
- `class NotifyCenter:` 不继承任何类。通知中心「有」一组渠道,是组合。
- `def __init__(self, channels: list[Notifier]):` 渠道从外面传进来,标注写父类,两种子类都能放。
- `self.channels = channels` 这一行就是组合。
- `for ch in self.channels:` 多态:不管 ch 实际是哪种渠道,都调 send。
- `print("发出", center.broadcast("工单 T-1001 已关闭"), "条")` 实测先打出邮件、短信两行,再打 `发出 2 条`。
- `print(isinstance(sms, Notifier), len(email.sent), sms.sent)` 实测 `True 1 ['工单 T-1001…']`。
- `Notifier("x").send("hi")` 父类可以造出来,但 send 一调就抛。

</div>

```bash
uv run basedpyright part01/recall_notify.py
uv run python part01/recall_notify.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
  邮件 -> li@beichen.com: [云簿客服] 工单 T-1001 已关闭
  短信 -> 138-0000-1234: 工单 T-1001…
发出 2 条
True 1 ['工单 T-1001…']
父类不能直接发: Notifier 还没写 send
```

</details>

自查三点。`super().__init__(to)` 有没有写成 `super.__init__(to)`(少了括号,实测是 `TypeError: descriptor '__init__' requires a 'super' object but received a 'str'`);SmsNotifier 里有没有多余地写一个只调 super 的 `__init__`(不算错,但没必要);NotifyCenter 有没有误写成 `class NotifyCenter(Notifier)`。最后一条是 Day 42 第四步的反面教材:通知中心不是一种渠道,继承了它就多出 to 和 sent 两个毫无意义的属性。

## 默写二:Ticket 类

**要求**:定义 `TicketError`;写 `Ticket`,`__init__` 收 id、title、amount、status(默认 `"open"`);amount 用 property + setter,负数抛 TicketError,真值存在 `_amount`;`is_closed` 是只读 property;`__repr__` 用 `!r`,`__str__` 打印成 `[open] T-1004 扣费两次 ¥89.5`;`from_dict` 是类方法,字典里没有 status 就当 open。造一张工单,分别打印它本身和装着它的列表,再试着把金额改成负数。文件名 `part01/recall_ticket.py`。

<details><summary>对照答案</summary>

```python
# agent-zero-lab/part01/recall_ticket.py
from typing import Any


class TicketError(Exception):
    pass


class Ticket:
    def __init__(self, id: str, title: str, amount: float, status: str = "open"):
        self.id = id
        self.title = title
        self.amount = amount
        self.status = status

    @property
    def amount(self) -> float:
        return self._amount

    @amount.setter
    def amount(self, value: float) -> None:
        if value < 0:
            raise TicketError(f"{self.id} 金额不能是负数: {value}")
        self._amount = value

    @property
    def is_closed(self) -> bool:
        return self.status == "closed"

    def __repr__(self) -> str:
        return f"Ticket(id={self.id!r}, title={self.title!r}, amount={self.amount!r}, status={self.status!r})"

    def __str__(self) -> str:
        return f"[{self.status}] {self.id} {self.title} ¥{self.amount}"

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Ticket":
        return cls(d["id"], d["title"], d["amount"], d.get("status", "open"))


t = Ticket.from_dict({"id": "T-1004", "title": "扣费两次", "amount": 89.5})
print(t)
print([t])
print(t.is_closed)
try:
    t.amount = -1
except TicketError as e:
    print("没改成:", e)
print(repr(t))
```

<div class="line-notes">

- `from typing import Any` from_dict 收的字典是从 JSON 来的,值的类型不确定,Day 46 讲过这里只能写 Any。
- `self.id = id` id 必须排在 amount 前面:下一行赋值会走 setter,setter 拼报错信息要用 `self.id`。顺序反了,实测报的是 `AttributeError: 'Ticket' object has no attribute 'id'`,真正的「金额不能是负数」被盖住(Day 43 第五步坑二)。
- `self.amount = amount` 看着是普通赋值,其实调的是下面的 setter,所以构造时也会校验。
- `@property` getter,读 `t.amount` 时走这里。
- `return self._amount` 真值在带下划线的属性里。
- `@amount.setter` 名字必须和 getter 一样叫 amount。
- `raise TicketError(f"{self.id} 金额不能是负数: {value}")` 校验只写这一份,构造和事后赋值都走它。
- `self._amount = value` 写成 `self.amount = value` 就是自己调自己,实测 `RecursionError`(Day 43 第五步坑一)。
- `def is_closed(self) -> bool:` 只有 getter,没有 setter,读的时候不加括号。
- `return f"Ticket(id={self.id!r}` `!r` 让字符串带上引号,`'T-1004'` 一眼看出是字符串。
- `def __str__(self) -> str:` 给人看的格式,print 和 f-string 走它。
- `@classmethod` 第一个参数是类本身。
- `def from_dict(cls, d: dict[str, Any]) -> "Ticket":` 返回类型加引号,因为这一行还在 Ticket 的类体里,名字还没定义完(Day 43 第六步)。
- `return cls(d["id"], d["title"], d["amount"], d.get("status", "open"))` 用 cls 而不是写死 Ticket,子类调用时才会造出子类。
- `print(t)` 单独打印走 `__str__`,实测 `[open] T-1004 扣费两次 ¥89.5`。
- `print([t])` 放进列表打印走 `__repr__`,实测 `[Ticket(id='T-1004', ...)]`。
- `print(t.is_closed)` 实测 `False`。
- `t.amount = -1` setter 拦住,实测 `没改成: T-1004 金额不能是负数: -1`。
- `print(repr(t))` 金额还是 89.5,没被改坏。

</div>

```bash
uv run basedpyright part01/recall_ticket.py
uv run python part01/recall_ticket.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
[open] T-1004 扣费两次 ¥89.5
[Ticket(id='T-1004', title='扣费两次', amount=89.5, status='open')]
False
没改成: T-1004 金额不能是负数: -1
Ticket(id='T-1004', title='扣费两次', amount=89.5, status='open')
```

</details>

自查:四个装饰器(两个 `@property`、一个 `@amount.setter`、一个 `@classmethod`)有没有漏;`__repr__` 里有没有每个字段都带 `!r`;`from_dict` 的返回类型有没有加引号(不加,实测在 3.12 是 `NameError: name 'Ticket' is not defined`)。这段默写大约 40 行,是本周最长的一段。如果你写到一半卡在 setter,先跳过它把别的写完跑通,再回来补,别让一个点拖住整段。

## 默写三:类型定义

**要求**:用 `Literal` 定义 `Status`;用 `TypedDict` 定义 `TicketDict`(id、title、amount、status,外加一个可以没有的 note);写 `parse_status(value: str) -> Status`,不合法就 `raise ValueError`;写 `find(tickets, id)`,找不到返回 None;写 `open_total(tickets)` 算未关闭工单的金额合计。准备两张工单,一张带 note,查一张存在的、一张不存在的,再把 `"closed"` 和 `"Closed"` 各交给 parse_status 一次。文件里不能有 Any,basedpyright 0 报错。文件名 `part01/recall_types.py`。

<details><summary>对照答案</summary>

```python
# agent-zero-lab/part01/recall_types.py
from typing import Literal, NotRequired, TypedDict

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
    raise ValueError(f"状态只能是 open 或 closed,收到 {value!r}")


def find(tickets: list[TicketDict], id: str) -> TicketDict | None:
    for t in tickets:
        if t["id"] == id:
            return t
    return None


def open_total(tickets: list[TicketDict]) -> float:
    total: float = 0
    for t in tickets:
        if t["status"] == "open":
            total += t["amount"]
    return total


tickets: list[TicketDict] = [
    {"id": "T-1001", "title": "发票抬头开错了", "amount": 199, "status": "closed"},
    {"id": "T-1004", "title": "扣费两次", "amount": 89.5, "status": parse_status("open"), "note": "客户发了截图"},
]
hit = find(tickets, "T-1004")
if hit is not None:
    print(hit["title"], hit.get("note", "无备注"))
print(find(tickets, "T-9999"))
print(open_total(tickets))
for raw in ["closed", "Closed"]:
    try:
        print(parse_status(raw))
    except ValueError as e:
        print("拦下:", e)
```

<div class="line-notes">

- `from typing import Literal, NotRequired, TypedDict` 三样都在 typing 里,不用装。
- `Status = Literal["open", "closed"]` 类型别名,≈ TS 的 `type Status = "open" | "closed"`。
- `class TicketDict(TypedDict):` 声明字典的形状,运行时它就是普通 dict。
- `note: NotRequired[str]` ≈ TS 的 `note?: string`。
- `def parse_status(value: str) -> Status:` 返回类型写 Status,逼着函数体真的检查过才能 return(Day 47 练习 3)。
- `if value in ("open", "closed"):` in 判断把 str 收窄成 `Literal['open', 'closed']`。
- `raise ValueError(` 这一段不依赖别的文件,所以直接用内置的 ValueError,不 import TicketError。
- `def find(tickets: list[TicketDict], id: str) -> TicketDict | None:` 可能找不到,就在返回类型里老实写出来(Day 46 第一步)。
- `return None` 循环走完都没找到。
- `total: float = 0` 从 0 开始累加的变量,写明 float。
- `if t["status"] == "open":` TypedDict 取值用方括号。
- `{"id": "T-1001", "title": "发票抬头开错了", "amount": 199, "status": "closed"},` 代码里直接写的 `"closed"` 是字面量,检查器知道它在 Status 里,不用过 parse_status。
- `"status": parse_status("open"), "note": "客户发了截图"},` 这里调 parse_status 只是演示它的返回值能直接放进 status 的格子。
- `hit = find(tickets, "T-1004")` hit 的类型是 `TicketDict | None`。
- `if hit is not None:` 收窄,不写这一行,下面那行实测两条红线:`Object of type "None" is not subscriptable`(reportOptionalSubscript)和 `"get" is not a known attribute of "None"`。
- `print(hit["title"], hit.get("note", "无备注"))` 实测 `扣费两次 客户发了截图`。
- `print(find(tickets, "T-9999"))` 实测 `None`。
- `print(open_total(tickets))` 只有 T-1004 是 open,实测 `89.5`。
- `for raw in ["closed", "Closed"]:` 第二个首字母大写,模拟用户手敲的值。
- `print("拦下:", e)` 实测 `拦下: 状态只能是 open 或 closed,收到 'Closed'`。`!r` 打出了引号,大小写差别看得清清楚楚。

</div>

```bash
uv run basedpyright part01/recall_types.py
uv run python part01/recall_types.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
扣费两次 客户发了截图
None
89.5
closed
拦下: 状态只能是 open 或 closed,收到 'Closed'
```

</details>

自查:这一段的检验标准不只是「跑通」,还要 `0 errors`。如果你的检查结果有红线,对照 Day 45 第三步的读法,先看行号和规则名。我故意把 `find` 的返回类型写成 `-> TicketDict` 试了一次,最后那行 `return None` 实测报 `Type "None" is not assignable to return type "TicketDict"`。这条红线正是在说「你承诺了一定有,却在某条路上给了 None」。

## 小项目:批量关单并通知

场景:客服组长每天下班前要把一批处理完的工单关掉,每关一张,要给客服邮箱发一封邮件,同时往审计日志里记一行。有些工单号是从聊天记录里复制来的,可能敲错,也可能早就关过了。你要写一个命令行工具:

```bash
uv run python part01/close_batch.py T-1002 T-1001 T-9999 T-1005
```

关得掉的关掉并通知;关不掉的说清楚为什么,不能因为一张出错就停下;最后告诉组长关了几张、跳过几张;只要有跳过的,退出码就是 1,方便以后被别的脚本调用时判断成败。只用本周学的东西,而且 basedpyright 要 0 报错。

为了不弄脏 Day 44 的记事本,这个工具第一次运行时会把 `notebook.json` 复制一份成 `notebook_review.json`,之后只改这份副本。

先想一下需要哪些零件。这一周其实已经把大半写好了:TicketBook 会按号找工单、会存文件(Day 44);NotifyCenter 会关单并挨个渠道通知,重复关闭还会抛 TicketError(Day 42);邮件渠道现成。缺的只有三样:一个写日志文件的渠道、一个批量处理的函数、一个描述「处理结果」的类型。

新建 `part01/close_batch.py`:

```python
# agent-zero-lab/part01/close_batch.py
import sys
from pathlib import Path
from typing import TypedDict

from notebook import TicketBook
from notifiers import EmailNotifier, Notifier, NotifyCenter
from ticket_model import Ticket, TicketError

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "data" / "notebook.json"
WORK = HERE / "data" / "notebook_review.json"
LOG = HERE / "data" / "notify.log"


class BatchResult(TypedDict):
    closed: list[str]
    skipped: dict[str, str]


class LogNotifier(Notifier):
    def __init__(self, to: str, path: Path):
        super().__init__(to)
        self.path = path

    def send(self, ticket: Ticket) -> None:
        text = self.format(ticket)
        self.sent.append(text)
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(f"{self.to}\t{text}\n")


def close_many(book: TicketBook, center: NotifyCenter, ids: list[str]) -> BatchResult:
    result: BatchResult = {"closed": [], "skipped": {}}
    for id in ids:
        try:
            t = book.find(id)
            center.close_ticket(t)
        except TicketError as e:
            result["skipped"][id] = str(e)
            continue
        result["closed"].append(id)
    return result


def main(argv: list[str]) -> int:
    if not argv:
        print("用法: uv run python part01/close_batch.py 工单号 [工单号 ...]")
        return 2
    if not WORK.exists():
        WORK.write_text(SOURCE.read_text(encoding="utf-8"), encoding="utf-8")
    book = TicketBook(WORK)
    center = NotifyCenter([EmailNotifier("kefu@cloudledger.cn"), LogNotifier("audit", LOG)])
    result = close_many(book, center, argv)
    book.save()
    print(f"关闭 {len(result['closed'])} 张: {result['closed']}")
    for id, reason in result["skipped"].items():
        print(f"跳过 {id}: {reason}")
    return 1 if result["skipped"] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

<div class="line-notes">

- `from typing import TypedDict` 结果的形状用 Day 47 的 TypedDict 描述。
- `from notebook import TicketBook` Day 44 的记事本类。notebook.py 的 main 在 `if __name__ == "__main__":` 里,import 时不会去读命令行参数。
- `from notifiers import EmailNotifier, Notifier, NotifyCenter` Day 42 的三个类。Notifier 要拿来继承,所以也导入。
- `from ticket_model import Ticket, TicketError` Ticket 只用来写 send 的参数标注,TicketError 要接。
- `HERE = Path(__file__).resolve().parent` 三个路径都从脚本所在目录出发,在哪儿运行都一样(Day 37)。
- `WORK = HERE / "data" / "notebook_review.json"` 只改这份副本。
- `class BatchResult(TypedDict):` 处理结果的形状:关掉的工单号列表,跳过的「工单号 → 原因」。写成 TypedDict 而不是类,是因为它就是一包数据,将来还可能直接 `json.dumps` 出去(Day 47 讲过什么时候用哪个)。
- `skipped: dict[str, str]` 键是工单号,值是原因,Day 46 的容器写法。
- `class LogNotifier(Notifier):` 新渠道。「日志渠道是一种通知渠道」读得通,继承。
- `def __init__(self, to: str, path: Path):` 比父类多一个 path,所以要自己写 `__init__`。
- `super().__init__(to)` 第一行交给父类,sent 才存在。
- `text = self.format(ticket)` 复用父类的措辞,实测 T-1002 关闭后是 `工单 T-1002「升级套餐 年付」当前状态 closed`。
- `with open(self.path, "a", encoding="utf-8") as f:` 日志要留历史,用 `"a"` 追加(Day 38)。日志是一行一条的纯文本,不是 JSON,追加没问题。
- `f.write(f"{self.to}\t{text}\n")` `\t` 是制表符,把「谁」和「内容」隔开,以后想按列切开也方便。
- `def close_many(book: TicketBook, center: NotifyCenter, ids: list[str]) -> BatchResult:` 记事本和通知中心都从参数传进来,而不是在函数里自己造。这样练习 3 可以传一个空渠道的通知中心进来,以后写测试也方便。
- `result: BatchResult = {"closed": [], "skipped": {}}` 两个空容器,类型由 BatchResult 定好了,不用再单独标。
- `for id in ids:` 一张一张处理。
- `t = book.find(id)` 找不到抛 `TicketError: 没有这张工单: T-9999`。
- `center.close_ticket(t)` 已经关过的抛 `TicketError: T-1001 已经是关闭状态`;正常的先 close,再挨个渠道 send。
- `except TicketError as e:` 两种失败都是 TicketError,一个 except 接住。**只接 TicketError**:真正的程序错误(比如练习 1 里的 KeyError)会照常崩出来。
- `result["skipped"][id] = str(e)` 存原因的文字,不存异常对象本身。BatchResult 说了值是 str,练习 1 会看到存错了检查器怎么说。
- `continue` 这一张失败了,接着处理下一张,不停。
- `result["closed"].append(id)` 走到这里说明 try 里两行都成功了。写在 try 外面,try 只包住可能抛 TicketError 的两行,Day 41 说的「try 包得越小越好」。
- `if not argv:` 一个工单号都没给。
- `return 2` 用法错误用 2,和「有工单被跳过」的 1 区分开。很多命令行工具都这么约定,比如我们天天用的 uv:`uv --nope; echo $?` 实测得到 `2`。不是所有工具都守这个约定,macOS 自带的 `ls --nope` 实测是 1,所以写自己的工具时把约定写进用法说明里。
- `WORK.write_text(SOURCE.read_text(encoding="utf-8"), encoding="utf-8")` 副本不存在时,读出原文件整个写过去,等于复制。两边都写 `encoding="utf-8"`(Day 38 的编码坑)。
- `book = TicketBook(WORK)` 记事本对着副本。
- `center = NotifyCenter([EmailNotifier("kefu@cloudledger.cn"), LogNotifier("audit", LOG)])` 组合:通知中心有两个渠道。要加短信,往列表里再放一个就行。
- `book.save()` 全部处理完存一次。中途抛的 TicketError 都在 close_many 里被接住了,所以一定能走到这里。
- `for id, reason in result["skipped"].items():` 字典遍历用 `.items()`(Day 24)。
- `return 1 if result["skipped"] else 0` 空字典为假,有跳过的就返回 1。
- `sys.exit(main(sys.argv[1:]))` main 收参数列表而不是自己去读 `sys.argv`,练习 2 能直接调 `main([...])`。

</div>

先检查:

```bash
uv run basedpyright part01/close_batch.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
```

再按顺序跑三次。第一次什么都不给,第二次混进一张已关的、一张不存在的,第三次再关一张:

```bash
rm -f part01/data/notebook_review.json part01/data/notify.log
uv run python part01/close_batch.py; echo "exit=$?"
uv run python part01/close_batch.py T-1002 T-1001 T-9999 T-1005; echo "exit=$?"
uv run python part01/close_batch.py T-1004; echo "exit=$?"
```

实测输出:

```text
用法: uv run python part01/close_batch.py 工单号 [工单号 ...]
exit=2
  邮件 -> kefu@cloudledger.cn: [云簿客服] 工单 T-1002「升级套餐 年付」当前状态 closed
  邮件 -> kefu@cloudledger.cn: [云簿客服] 工单 T-1005「API 调用超额」当前状态 closed
关闭 2 张: ['T-1002', 'T-1005']
跳过 T-1001: T-1001 已经是关闭状态
跳过 T-9999: 没有这张工单: T-9999
exit=1
  邮件 -> kefu@cloudledger.cn: [云簿客服] 工单 T-1004「扣费两次」当前状态 closed
关闭 1 张: ['T-1004']
exit=0
```

对一下:T-1001 和 T-9999 夹在中间,没有挡住后面的 T-1005;两种失败原因各说各的;第三次没有跳过,退出码 0。邮件渠道每次打印一行,日志渠道不打印,看文件:

```bash
cat part01/data/notify.log
```

实测输出(中间是制表符):

```text
audit	工单 T-1002「升级套餐 年付」当前状态 closed
audit	工单 T-1005「API 调用超额」当前状态 closed
audit	工单 T-1004「扣费两次」当前状态 closed
```

三行,两次运行的记录都在,`"a"` 模式没有清掉第一次的。最后确认原来的记事本没被动过。用一行 Python 把两个文件里每张工单的状态打出来(`-c` 后面跟一段代码直接运行,不用建文件):

```bash
uv run python -c "import json;print([(d['id'],d['status']) for d in json.load(open('part01/data/notebook_review.json'))])"
uv run python -c "import json;print([(d['id'],d['status']) for d in json.load(open('part01/data/notebook.json'))])"
```

实测输出:

```text
[('T-1001', 'closed'), ('T-1002', 'closed'), ('T-1004', 'closed'), ('T-1005', 'closed')]
[('T-1001', 'closed'), ('T-1002', 'open'), ('T-1004', 'open'), ('T-1005', 'open')]
```

副本全关了,原件还是一关三开。Day 49、50 的例子都会用原件,所以这一步要确认。

零件对照:

| 本周的零件 | 在 close_batch.py 里是哪一段 |
| --- | --- |
| Day 42 继承、super | `LogNotifier(Notifier)` 和它 `__init__` 的第一行 |
| Day 42 组合、多态 | `NotifyCenter([EmailNotifier(...), LogNotifier(...)])`,close_ticket 里挨个 send |
| Day 43 property、`__str__` | NotifyCenter 内部的 `ticket.status`、`is_closed`;TicketBook.find 的报错 |
| Day 44 TicketBook、sys.argv、退出码 | `TicketBook(WORK)`、`main(sys.argv[1:])`、返回 0/1/2 |
| Day 45 参数和返回值标注 | 每个函数的签名,`main(argv: list[str]) -> int` |
| Day 46 容器类型 | `list[str]`、`dict[str, str]`、`.items()` |
| Day 47 TypedDict | `BatchResult` 和 `result["closed"]` 这样的取值 |

这个脚本的骨架你以后会反复见到:**输入一串任务,逐个执行,每个失败都被接住并记下原因,最后返回一份结构化的结果**。第三部分 Agent 一次调用好几个工具时,处理方式和 close_many 几乎一样,只是任务清单从命令行参数换成了模型给的工具调用列表。

## 本周错题与坑清单

这周实测过的报错放在一起。左边是你会看到的原文,右边是病因和修法:

| 报错(实测原文) | 哪天 | 病因和修法 |
| --- | --- | --- |
| `AttributeError: 'EmailForgot' object has no attribute 'to'` | 42 | 子类写了 `__init__` 却没调 `super().__init__()`,父类建的属性不存在 |
| `... has no attribute 'sent'. Did you mean: 'send'?` | 42 | 同上,别被 Did you mean 带偏,不是拼错 |
| `NotImplementedError: WechatNotifier 还没写 send` | 42 | 子类忘了实现父类留空的方法,这是好事,父类用 raise 而不是 pass 才能看到 |
| `[<__main__.Ticket object at 0x10247ee10>]` | 43 | 只写了 `__str__` 没写 `__repr__`,放进列表打印就是这样 |
| `TypeError: 'bool' object is not callable` | 43 | property 读的时候加了括号,`t.is_closed()` 应为 `t.is_closed` |
| `RecursionError: maximum recursion depth exceeded` | 43 | setter 里写 `self.amount = value`,自己调自己,改成 `self._amount` |
| `NameError: name 'Ticket' is not defined` | 43 | 类体里返回类型写了 `-> Ticket`,要加引号 |
| `出错了: 参数个数不对,应该是: add 标题 金额` | 44 | 标题带空格没加引号,被终端切成了好几个参数 |
| `Expecting property name enclosed in double quotes` | 44 | 数据文件被手改坏了(尾逗号、单引号),改之前先 cp 备份 |
| `2 errors, 22 warnings, 0 notes` | 45 | pyproject.toml 里没写 `typeCheckingMode = "standard"`,命令行用的是更严的 recommended |
| `must return value on all code paths` | 45 | 标了 `-> str` 却有一条路没 return;只打印的函数标 `-> None` |
| `Operator "+" not supported for "None"` | 46 | `dict.get` 没给默认值就做运算,写 `get(k, 0)` |
| `"title" is not a known attribute of "None"` | 46 | 拿到 `X \| None` 直接用,先 `if t is None:` |
| `Type "list[Ticket]" is not assignable to return type "list[str]"` | 46 | 推导式前面收集错了东西,应是 `t.id` |
| `"amout" is not a defined key in "TicketDict"` | 47 | TypedDict 的键名拼错 |
| `"str" is not assignable to type "Status"` | 47 | 没检查过的字符串交给 Literal,先 `if x in (...)` 或过 parse_status |
| `TypeError: TypedDict does not support instance and class checks` | 47 | 不能 `isinstance(x, TicketDict)`,只能查 `isinstance(x, dict)` 再逐个键查 |

有两类坑不报错,比报错更难发现,这周各遇到一次。一类是**运行时什么都不说**:`set_status("T-1004", "clsoed")` 照样打印、`json.loads` 出来的 `pending` 照样进了 TicketDict,检查器能抓的只有你自己写在代码里的值。另一类是**结果悄悄错了**:Day 42 的多重继承只发了邮件、Day 44 的 `list --by-title` 被当成 list 执行、Day 46 的 big_ids 返回了一串 Ticket。遇到「程序没报错但结果不对」,先想这几个。

## 动手练习

### 练习 1:一个错盖住另一个错

新建 `part01/ex48_typos.py`,把 close_many 原样抄一遍,然后故意改坏三处:`"skipped"` 拼成 `"skiped"`;存原因时直接存异常对象 `e` 而不是 `str(e)`;往 closed 里 append 的是 `t` 而不是 `id`。先猜检查器会报几条,再检查。然后修掉拼写,再检查一次。最后新建 `part01/ex48_typos_run.py`,对改坏的版本传一个不存在的工单号,看运行时报什么。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex48_typos.py
from close_batch import BatchResult
from notebook import TicketBook
from notifiers import NotifyCenter
from ticket_model import TicketError


def close_many(book: TicketBook, center: NotifyCenter, ids: list[str]) -> BatchResult:
    result: BatchResult = {"closed": [], "skipped": {}}
    for id in ids:
        try:
            t = book.find(id)
            center.close_ticket(t)
        except TicketError as e:
            result["skiped"][id] = e
            continue
        result["closed"].append(t)
    return result
```

<div class="line-notes">

- `from close_batch import BatchResult` 复用小项目里的形状。close_batch.py 的 main 在 main guard 里,import 不会执行。
- `result["skiped"][id] = e` 两个错叠在一行:键名拼错,值存成了异常对象。
- `result["closed"].append(t)` 第三个错:append 的是 Ticket。

</div>

```bash
uv run basedpyright part01/ex48_typos.py
```

实测输出:

```text
ex48_typos.py:15:13 - error: Could not access item in TypedDict
    "skiped" is not a defined key in "BatchResult" (reportGeneralTypeIssues)
ex48_typos.py:17:33 - error: Argument of type "Ticket" cannot be assigned to parameter "object" of type "str" in function "append"
    "Ticket" is not assignable to "str" (reportArgumentType)
2 errors, 0 warnings, 0 notes
```

三个错只报了两条。第 15 行只说了键名,没说值的类型不对:`"skiped"` 不是 BatchResult 定义过的键,检查器不知道这个键该放什么,也就没法判断 `e` 放得对不对。把 skiped 改回 skipped 另存为 `part01/ex48_typos2.py`(第一行注释也改成新文件名)再检查:

```bash
uv run basedpyright part01/ex48_typos2.py
```

实测输出:

```text
ex48_typos2.py:15:13 - error: Argument of type "TicketError" cannot be assigned to parameter "value" of type "str" in function "__setitem__"
    "TicketError" is not assignable to "str" (reportArgumentType)
ex48_typos2.py:17:33 - error: Argument of type "Ticket" cannot be assigned to parameter "object" of type "str" in function "append"
    "Ticket" is not assignable to "str" (reportArgumentType)
2 errors, 0 warnings, 0 notes
```

第三个错现在出来了。`__setitem__` 是字典 `d[k] = v` 这种赋值背后调用的魔术方法,和 Day 43 的 `__repr__` 一类。经验是:**修完一批红线一定再检查一次**,前面的错可能挡着后面的错。

再看改坏的版本在运行时怎样:

```python
# agent-zero-lab/part01/ex48_typos_run.py
from close_batch import WORK
from ex48_typos import close_many
from notebook import TicketBook
from notifiers import NotifyCenter

book = TicketBook(WORK)
print(close_many(book, NotifyCenter([]), ["T-9999"]))
```

<div class="line-notes">

- `from close_batch import WORK` 用副本,小项目跑过一次后它已经存在。
- `print(close_many(book, NotifyCenter([]), ["T-9999"]))` 通知中心给一个空渠道列表,不发任何通知;T-9999 不存在,会走进 except。

</div>

```bash
uv run python part01/ex48_typos_run.py
```

实测输出(路径缩短了):

```text
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex48_typos.py", line 12, in close_many
    t = book.find(id)
        ^^^^^^^^^^^^^
  File "/Users/你/agent-zero-lab/part01/notebook.py", line 53, in find
    raise TicketError(f"没有这张工单: {id}")
ticket_model.TicketError: 没有这张工单: T-9999

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex48_typos_run.py", line 8, in <module>
    print(close_many(book, NotifyCenter([]), ["T-9999"]))
          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/你/agent-zero-lab/part01/ex48_typos.py", line 15, in close_many
    result["skiped"][id] = e
    ~~~~~~^^^^^^^^^^
KeyError: 'skiped'
```

中间那句 `During handling of the above exception, another exception occurred` 你第一次见,意思是「处理上面那个异常的时候,又出了一个新异常」。它和 Day 36 的 `The above exception was the direct cause of the following exception` 长得像,区别在于:direct cause 是你用 `raise ... from e` 故意连起来的,During handling 是 except 块里**意外**又出了错。读法一样,先看最下面那段:KeyError,在 except 里面。上面那段 TicketError 本来会被好好接住,是我们的拼写错误把处理过程弄崩了。

</details>

### 练习 2:加一个 --reset

副本 `notebook_review.json` 一旦全关了,小项目就没法再演示。新建 `part01/ex48_reset.py`,给工具加一个开头的 `--reset` 选项:有它就先从 notebook.json 重新复制一份、删掉旧日志,然后照常处理后面的工单号;只给 `--reset` 不给工单号时,复制完就以 0 退出。复用 close_batch.py 的 main,不要把它抄一遍。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex48_reset.py
import sys

from close_batch import LOG, SOURCE, WORK, main


def reset() -> None:
    WORK.write_text(SOURCE.read_text(encoding="utf-8"), encoding="utf-8")
    LOG.unlink(missing_ok=True)


def cli(argv: list[str]) -> int:
    if argv[:1] == ["--reset"]:
        reset()
        print("已从 notebook.json 重新复制一份")
        argv = argv[1:]
        if not argv:
            return 0
    return main(argv)


if __name__ == "__main__":
    sys.exit(cli(sys.argv[1:]))
```

<div class="line-notes">

- `from close_batch import LOG, SOURCE, WORK, main` 路径常量和 main 都从小项目里拿,一处定义。
- `WORK.write_text(SOURCE.read_text(encoding="utf-8"), encoding="utf-8")` 不管副本在不在,都重新复制。
- `LOG.unlink(missing_ok=True)` 删日志,`missing_ok=True` 表示文件不存在也不报错(Day 39 练习里见过 unlink)。
- `if argv[:1] == ["--reset"]:` 为什么不写 `argv[0] == "--reset"`?argv 是空列表时 `argv[0]` 会 IndexError,切片 `argv[:1]` 在空列表上得到 `[]`,安全([Day 15](/blog/agent-zero/day-015-strings-1/) 讲过切片超出范围不报错,列表也一样)。
- `argv = argv[1:]` 去掉 `--reset`,剩下的是工单号。
- `if not argv:` 只给了 `--reset`。
- `return main(argv)` 剩下的照旧交给小项目的 main,退出码也原样返回。

</div>

```bash
uv run basedpyright part01/ex48_reset.py
uv run python part01/ex48_reset.py --reset; echo "exit=$?"
uv run python part01/ex48_reset.py --reset T-1002 T-1002; echo "exit=$?"
uv run python part01/ex48_reset.py --reset
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
已从 notebook.json 重新复制一份
exit=0
已从 notebook.json 重新复制一份
  邮件 -> kefu@cloudledger.cn: [云簿客服] 工单 T-1002「升级套餐 年付」当前状态 closed
关闭 1 张: ['T-1002']
跳过 T-1002: T-1002 已经是关闭状态
exit=1
已从 notebook.json 重新复制一份
```

第二条故意把 T-1002 写了两遍:第一遍关掉,第二遍因为已经关了被跳过,没有发两封邮件。这是 Day 42 在 NotifyCenter 里写那道「已关闭就抛错」检查的回报。最后一条把副本恢复成初始状态,下一个练习要用。

</details>

### 练习 3:只看不做的 dry run

组长想先看看「如果关这一批,会关掉哪些、跳过哪些」,但不真的关、不发通知、不存文件。新建 `part01/ex48_dry_run.py`,写 `plan_close(book, ids) -> BatchResult`。先只处理「找不到」和「已关闭」两种情况,对 `["T-1001", "T-1002", "T-1003", "T-1002"]` 跑一次,看结果有什么问题,再修好。

<details><summary>参考答案</summary>

我先写的版本只有两道检查,跑出来是这样(实测):

```text
{'closed': ['T-1002', 'T-1002'], 'skipped': {'T-1001': 'T-1001 已经是关闭状态', 'T-1003': '没有这张工单: T-1003'}}
```

T-1002 被「计划关闭」了两次。真跑的时候第二次会因为已关闭被跳过(练习 2 实测过),dry run 却说两次都能关,两边对不上。原因是 dry run 什么都不改,T-1002 的状态一直是 open。修法是记住「这一批里已经计划关的」,再出现就算重复:

```python
# agent-zero-lab/part01/ex48_dry_run.py
from close_batch import WORK, BatchResult
from notebook import TicketBook
from ticket_model import TicketError


def plan_close(book: TicketBook, ids: list[str]) -> BatchResult:
    result: BatchResult = {"closed": [], "skipped": {}}
    for id in ids:
        try:
            t = book.find(id)
        except TicketError as e:
            result["skipped"][id] = str(e)
            continue
        if t.is_closed:
            result["skipped"][id] = f"{id} 已经是关闭状态"
            continue
        if id in result["closed"]:
            result["skipped"][id] = f"{id} 重复,前面已经算过一次"
            continue
        result["closed"].append(id)
    return result


book = TicketBook(WORK)
print(plan_close(book, ["T-1001", "T-1002", "T-1003", "T-1002"]))
print([t.status for t in book.tickets])
```

<div class="line-notes">

- `def plan_close(book: TicketBook, ids: list[str]) -> BatchResult:` 返回同一种形状,组长看 dry run 和看真跑的结果是一个格式。这就是给结果起类型名的好处,两个函数一对照就知道它们是一伙的。
- `t = book.find(id)` 只有这一行可能抛 TicketError,try 只包它。
- `if t.is_closed:` 已关闭直接用 Day 43 的 property 判断,不用真去调 close 让它抛错。
- `if id in result["closed"]:` 修复:本批已经算过的。`in` 对列表是逐个比较,几百个工单号以内完全够用。
- `print([t.status for t in book.tickets])` 最后确认什么都没改。

</div>

```bash
uv run basedpyright part01/ex48_dry_run.py
uv run python part01/ex48_dry_run.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
{'closed': ['T-1002'], 'skipped': {'T-1001': 'T-1001 已经是关闭状态', 'T-1003': '没有这张工单: T-1003', 'T-1002': 'T-1002 重复,前面已经算过一次'}}
['closed', 'open', 'open', 'open']
```

这下和真跑一致了,状态也一个没动。「预演」和「真做」要给出同样的结论,是以后写 Agent 时很重要的一个习惯:让 Agent 先出一份计划给人审,审过了再执行,计划和执行要对得上。

</details>

验收标准:三段默写都能不看文章写出来,`uv run basedpyright` 全部 0 errors;`close_batch.py` 的三次运行输出和退出码(2、1、0)与文中一致,`notebook.json` 原件没被改;三个练习的输出和参考答案一致;错题表里随便挑一行,能说出病因。

## 名词解释

今天没有新概念,只有小项目和练习里第一次正式用到的几个写法:

| 名词 | 意思 |
| --- | --- |
| 退出码 2 | 很多命令行工具的约定:用法错误(参数不对)返回 2,和「执行了但有失败」的 1 区分开 |
| dry run(预演) | 只算出「会做什么」,不真的改数据、不发通知,让人先看一眼再决定执行 |
| `During handling of the above exception, another exception occurred` | traceback 里的一句话:except 块里处理异常时又意外出了新异常;和 `raise ... from e` 的 direct cause 不同 |
| `__setitem__` | `d[k] = v` 背后调用的魔术方法,检查器报字典赋值类型不对时会提到它 |
| `python -c "代码"` | 不建文件,直接运行一段 Python 代码,适合一次性的小检查 |
| `\t` | 字符串里的制表符,常用来分隔一行里的几列 |

本周其他术语在各天的名词解释里:继承、子类、super、多态、组合([Day 42](/blog/agent-zero/day-042-classes-2/)),`__repr__`、`__str__`、property、setter、classmethod([Day 43](/blog/agent-zero/day-043-classes-3/)),sys.argv、退出码([Day 44](/blog/agent-zero/day-044-notebook-project/)),类型检查器、reveal_type([Day 45](/blog/agent-zero/day-045-type-hints-1/)),`X | None`、收窄、Any([Day 46](/blog/agent-zero/day-046-type-hints-2/)),TypedDict、NotRequired、Literal、类型别名([Day 47](/blog/agent-zero/day-047-type-hints-3/))。

## 常见误区

**把检查器当成运行时校验。** 这周最容易犯的错。BatchResult、Status、`list[str]` 都只在 `uv run basedpyright` 时起作用,程序跑起来没人看。小项目里能拦住「已关闭」「不存在」的,是 NotifyCenter 和 TicketBook 里实打实的 if 和 raise。

**修完一条红线就以为没事了。** 练习 1 实测:三个错第一次只报两条,修掉拼写后第三条才冒出来。改完要再跑一次检查,直到 `0 errors`。

**except 接得太宽。** close_many 只接 TicketError。如果写成 `except Exception`,练习 1 里那个 KeyError 也会被当成「跳过原因」悄悄记下,程序 bug 就被藏成了一条业务提示。

**子类都要写 `__init__`。** 不是。SmsNotifier 没有新属性,就不写,自动沿用父类的;只有要加属性(LogNotifier 的 path)时才写,写了第一行必须是 super。

**为了用新渠道去改 NotifyCenter。** 加日志渠道时 NotifyCenter 和 Ticket 一行都没改,只新写了一个 LogNotifier。如果你发现加一种渠道要改通知中心的代码,说明组合没用对。

**复习日只看不默写。** 默写二里 id 和 amount 的赋值顺序,看文章时谁都觉得理所当然,合上文章写就很容易写反,写反了得到的是 Day 43 实测过的 `AttributeError: 'Ticket' object has no attribute 'id'`,和「金额不能是负数」八竿子打不着。这种坑只有自己动手写才会撞上,一定合上文章写。

## 学习资料

### 文档与文章

- [Python 官方教程 · 9. 类(中文)](https://docs.python.org/zh-cn/3.12/tutorial/classes.html):9.5「继承」对应 Day 42,今天用来查漏。9.3.5 讲类变量和实例变量,如果你对「sent 为什么要在 `__init__` 里建」还有疑问,读这一节。
- [Python 标准库 · typing(中文)](https://docs.python.org/zh-cn/3.12/library/typing.html):Day 45–47 的所有写法都在这一页,页内搜 `TypedDict`、`Literal`、`Optional` 各看一遍例子。
- [basedpyright 文档](https://docs.basedpyright.com/latest/):左侧 Configuration 里有 `typeCheckingMode` 各档的说明,Day 45 那条「命令行默认 recommended」就是从这里查的。
- [TypeScript Handbook · Type Compatibility](https://www.typescriptlang.org/docs/handbook/type-compatibility.html):明天讲 Protocol 前可以先读,TS 的类型兼容是「看结构不看名字」,Python 默认反过来,这正是明天要解决的问题。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1QU44zUEmd&autoplay=0&high_quality=1" title="【中配】继承的缺陷：为何优先使用组合而非继承 - CodeAesthetic" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>黑纹白斑马(搬运 CodeAesthetic,中文配音)· 继承的缺陷:为何优先使用组合而非继承 · 约 10 分钟。Day 42 推荐过,复习日再看一遍,这次对照小项目里的 LogNotifier 和 NotifyCenter 看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1sW81zbEkD&autoplay=0&high_quality=1" title="为什么越来越多Python项目都在写类型注解？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Hucci写代码 · 为什么越来越多 Python 项目都在写类型注解? · 约 11 分钟,2025 年。把 Day 45–47 三天的动机串起来讲了一遍,适合做完默写三以后看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/hxGOiiR9ZKg" title="The Flaws of Inheritance" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>CodeAesthetic · The Flaws of Inheritance · 上面那个 B 站视频的英文原版,动画很清楚。能听英文的直接看这个,里面最后讲到的「接口」就是明天的 Protocol。</figcaption>
</figure>

### 书籍

- 《流畅的 Python(第 2 版)》,Luciano Ramalho 著,人民邮电出版社,2023。第 14 章专讲继承,作者给了一串「什么时候别继承」的建议,和 Day 42 第四步的结论一致;第 8 章「函数中的类型提示」是 Day 45–46 的加深版。现在读第 14 章前半就够了。
- 《Python 编程:从入门到实践(第 3 版)》,Eric Matthes 著,人民邮电出版社。第 9 章「类」的 9.3 和 9.4 节练习可以当额外的默写题。

### 开源项目与代码

- [python-dotenv 的 `main.py`](https://github.com/theskumar/python-dotenv/blob/main/src/dotenv/main.py):Day 41 让你对着它找本周知识,今天换个角度读:看它的函数签名,数一数用了几处 `Optional[...]`、`Dict[...]`、`Iterator[...]`。这些是 Day 46 讲的老写法,换成新写法分别是 `X | None`、`dict[...]`。

## 自测

1. 下面的 SmsNotifier 能正常发短信吗?为什么?

```python
class SmsNotifier(Notifier):
    def __init__(self, to: str, max_len: int = 20):
        self.max_len = max_len
```

<details><summary>答案</summary>

不能。它写了自己的 `__init__` 却没调 `super().__init__(to)`,父类的 `self.to` 和 `self.sent` 都没建,send 里一用就是 `AttributeError`。改法是在第一行加 `super().__init__(to)`。

</details>

2. `close_many` 里为什么把 `result["closed"].append(id)` 写在 try 外面,而不是紧跟在 `center.close_ticket(t)` 后面?

<details><summary>答案</summary>

两种写法这里结果一样,但写在外面让 try 只包住可能抛 TicketError 的两行。如果 append 那一行将来改成了更复杂的代码、意外抛了 TicketError,写在 try 里面就会被当成「跳过原因」记下,真正的问题被藏起来。try 包得越小,接到的异常越确定是你预料的那一种。

</details>

3. `t: TicketDict = json.loads(raw)` 检查 0 errors,运行时 status 却是 `pending`。这一周里哪两个东西本可以拦住它?

<details><summary>答案</summary>

Day 47 的 `parse_ticket`(里面调 `parse_status`)在运行时检查外来的字典;或者 Day 43 那种在构造时校验的类。TypedDict 和 Literal 都只管检查器,而 json.loads 返回 Any,Any 能骗过任何标注。外来数据要先过运行时校验,再交给有类型的变量。

</details>

4. close_batch.py 返回 0、1、2 三种退出码,分别是什么意思?调用它的脚本怎么拿到这个数?

<details><summary>答案</summary>

0 是全部成功;1 是执行了但有工单被跳过;2 是用法错误(一个工单号都没给)。在终端里紧跟着 `echo $?` 能看到上一条命令的退出码;以后在 CI 或别的脚本里调用它,也是看这个数判断成败。

</details>

5. 面试题:你给 Agent 写了一个「批量关闭工单」的工具,模型一次传进来 20 个工单号,其中 3 个不存在、2 个已经关了。这个工具应该怎么返回结果?

<details><summary>答案</summary>

不要因为第一个失败就整体报错,也不要只回一句「部分失败」。像 close_many 那样逐个处理,每个失败都接住,返回一个结构化的结果:关掉了哪些、跳过了哪些、每个跳过的具体原因(不存在、已关闭)。模型拿到这份结果,才能决定是告诉用户「这 3 个号可能敲错了」,还是去查一下那 2 张是谁关的。这种操作最好还配一个 dry run,先让人看计划再执行,重复的号在计划里就要标出来。

</details>

## 明天预告

[Day 49 · 类型标注(四):Protocol 和 TypeVar](/blog/agent-zero/day-049-type-hints-4/)。小项目里的 NotifyCenter 只认 Notifier 的子类,可如果有人给你一个不继承 Notifier、但也有 send 方法的企业微信机器人,检查器就会画红线,尽管程序跑得通。TS 里这根本不是问题,因为 TS 只看结构。明天用 Protocol 让 Python 也「只看结构」,再用 TypeVar 写一个「传进什么类型就返回什么类型」的函数,最后给一个假的大模型客户端写好类型,为第二部分调真模型做准备。
