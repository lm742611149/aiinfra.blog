---
title: 'Day 43 · 类(三):__repr__、@property 和类方法'
description: '让 Ticket 打印出来像样:重写 __repr__ 和 __str__。用 @property 补上 Day 40 留下的漏洞,造完再把金额改成负数也会被拦住,顺带演示 setter 里两个真实的坑。最后把 ticket_from_dict 挂到类上变成 Ticket.from_dict,改完的 ticket_model.py 让前几天的脚本全部重跑一遍。'
pubDate: 2026-10-22
regime: none
tags: ['python', 'classes', 'agent-zero']
series: 'agent-zero'
day: 43
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 42](/blog/agent-zero/day-042-classes-2/) 学了继承和组合:子类在括号里写父类,白拿父类的方法,写了自己的 `__init__` 就要先调 `super().__init__()`;「A 是一种 B」用继承,「A 有一个 B」用组合。最后写了 `notifiers.py`,邮件和短信两种渠道继承 Notifier,NotifyCenter 用组合持有一组渠道。

Day 42 还顺带看到一件事:所有类最终都继承自 `object`,Day 40 直接 print 对象时那串 `<__main__.Ticket object at 0x10e8e7530>` 就是 object 给的默认打印方式。既然是继承来的,就能重写。今天从这里开始,把 Ticket 打磨成一个用起来顺手、也更不容易被用坏的类,明天的工单记事本就直接用它。

## 今天要解决的问题

学完今天,你应该能:

1. 给类写 `__repr__` 和 `__str__`,说清 print 一个对象、print 一个装着对象的列表时分别用的是哪个。
2. 用 `@property` 写只读属性,用 `@x.setter` 让「给属性赋值」也经过校验;认出 setter 里自己调自己引起的 `RecursionError`。
3. 用 `@classmethod` 写一个「另一种造对象的方式」`from_dict`,说清 `cls` 和 `self` 的区别,以及为什么返回类型要写成 `"Ticket"` 带引号。
4. 改完共享的 `ticket_model.py` 以后,把依赖它的旧脚本重跑一遍,确认没改坏。

预计用时:3 小时。今天的新东西比平时多,`__repr__`、property、类方法各占一段,每段之间可以歇一下。前置:[Day 40](/blog/agent-zero/day-040-classes-1/) 的 Ticket 类、[Day 41](/blog/agent-zero/day-041-week06-review/) 的 `ticket_checkup.py`、[Day 42](/blog/agent-zero/day-042-classes-2/) 的继承和 object、[Day 15](/blog/agent-zero/day-015-strings-1/) 的 f-string。

学法:先对照文章逐行敲一遍(不要复制粘贴)并跑通;第二天合上文章,把最后改好的 `ticket_model.py` 默写出来;再做动手练习,做不出来再展开参考答案,看完关掉自己重写一遍。

命令都在项目根目录 `agent-zero-lab` 里跑,新文件放进 `part01/`。今天会**改** Day 40 建的 `part01/ticket_model.py`,改之前先复制一份备份:`cp part01/ticket_model.py part01/ticket_model_day40.py`。不装新依赖,不调 API,花费 0 元。

## 第一步:__repr__,让对象打印出来能看懂

先看问题。新建 `part01/repr_demo.py`,一个没写 `__repr__` 的类和一个写了的类放在一起比:

```python
# agent-zero-lab/part01/repr_demo.py
class Plain:
    def __init__(self, id: str, amount: float):
        self.id = id
        self.amount = amount


class Ticket:
    def __init__(self, id: str, title: str, amount: float, status: str = "open"):
        self.id = id
        self.title = title
        self.amount = amount
        self.status = status

    def __repr__(self) -> str:
        return f"Ticket(id={self.id!r}, title={self.title!r}, amount={self.amount!r}, status={self.status!r})"


p = Plain("T-1001", 199)
print(p)
print([p])

t = Ticket("T-1001", "发票抬头开错了", 199)
print(t)
print([t, Ticket("T-1005", "升级套餐", 399, "closed")])
print(repr(t) == f"{t!r}")
print(f"{t.id} 和 {t.id!r}")
```

<div class="line-notes">

- `class Plain:` 一个普通的类,没写任何魔术方法。
- `class Ticket:` 和 Day 40 的 Ticket 一样有四个属性,多了一个 `__repr__`。
- `def __repr__(self) -> str:` `__repr__` 是 Day 40 提过的**魔术方法**之一。Python 需要「把这个对象变成给程序员看的字符串」时自动调它,必须返回 str。这里是在重写 object 的同名方法,和 Day 42 子类重写 send 是一回事。
- `return f"Ticket(id={self.id!r}, title={self.title!r}, amount={self.amount!r}, status={self.status!r})"` f-string 里的 `!r` 是新写法:`{x!r}` 等于 `{repr(x)}`,对字符串来说就是**带上引号**。拼出来是 `Ticket(id='T-1001', title='发票抬头开错了', amount=199, status='open')`,长得就像一行能重新造出这个对象的代码。
- `print(p)` 没写 `__repr__`,用 object 的默认版本,实测 `<__main__.Plain object at 0x10ad27980>`。
- `print([p])` 放进列表也一样,实测 `[<__main__.Plain object at 0x10ad27980>]`。
- `print(t)` 写了 `__repr__`,实测 `Ticket(id='T-1001', title='发票抬头开错了', amount=199, status='open')`。
- `print([t, Ticket("T-1005", "升级套餐", 399, "closed")])` 打印列表时,Python 对每个元素调 `__repr__`,实测两张工单都清清楚楚。
- `print(repr(t) == f"{t!r}")` 内置函数 `repr(对象)` 就是去调对象的 `__repr__`,和 `!r` 一样。实测 `True`。
- `print(f"{t.id} 和 {t.id!r}")` 看 `!r` 对字符串的效果,实测 `T-1001 和 'T-1001'`。

</div>

```bash
uv run python part01/repr_demo.py
```

实测输出(地址每次运行都不同):

```text
<__main__.Plain object at 0x10ad27980>
[<__main__.Plain object at 0x10ad27980>]
Ticket(id='T-1001', title='发票抬头开错了', amount=199, status='open')
[Ticket(id='T-1001', title='发票抬头开错了', amount=199, status='open'), Ticket(id='T-1005', title='升级套餐', amount=399, status='closed')]
True
T-1001 和 'T-1001'
```

为什么 `__repr__` 里要用 `!r` 带引号?看一个反例:如果写成 `id={self.id}`,id 为 `"T-1001"` 和 id 为数字 1001 打印出来分不清;标题里有逗号时,你也分不清哪里是标题结束。带上引号,一眼能看出每个值的类型和边界。Python 自己的类型都遵守这个习惯:`repr("abc")` 是 `'abc'`,`repr([1, 2])` 是 `[1, 2]`。

前端对照:JS 里 `console.log(obj)` 会把对象的结构展开给你看,浏览器帮你做了这件事;Python 的 print 不会,它只调 `__repr__`(或者下一步的 `__str__`)。所以在 Python 里,**给自己的类写一个 `__repr__` 几乎是必做的**,以后调试 Agent 时打印一列消息对象、一列工具调用,全靠它。

## 第二步:__str__ 和 __repr__ 分工

`__repr__` 是给程序员看的。有时候你还想要一个给用户看的版本,比如 Day 40 的 `summary()` 那种 `[open] T-1001 发票抬头开错了 ¥199`。这个版本叫 `__str__`。新建 `part01/str_vs_repr.py`:

```python
# agent-zero-lab/part01/str_vs_repr.py
class Ticket:
    def __init__(self, id: str, title: str, amount: float, status: str = "open"):
        self.id = id
        self.title = title
        self.amount = amount
        self.status = status

    def __repr__(self) -> str:
        return f"Ticket(id={self.id!r}, title={self.title!r}, amount={self.amount!r}, status={self.status!r})"

    def __str__(self) -> str:
        return f"[{self.status}] {self.id} {self.title} ¥{self.amount}"


t = Ticket("T-1001", "发票抬头开错了", 199)
print(t)
print(str(t))
print(f"新工单:{t}")
print(repr(t))
print([t])
print({"latest": t})
```

<div class="line-notes">

- `def __repr__(self) -> str:` 和第一步一样,给程序员看。
- `def __str__(self) -> str:` 给人看的版本。print、`str()`、f-string 里的 `{t}` 都会优先调它。
- `return f"[{self.status}] {self.id} {self.title} ¥{self.amount}"` 和 Day 40 的 summary 一个格式。
- `print(t)` 有 `__str__` 就用它,实测 `[open] T-1001 发票抬头开错了 ¥199`。
- `print(str(t))` 实测同上。`str(对象)` 就是调 `__str__`,和 Day 14 把数字转成字符串的 `str(199)` 是同一个函数。
- `print(f"新工单:{t}")` f-string 里不加 `!r` 时调 `__str__`,实测 `新工单:[open] T-1001 发票抬头开错了 ¥199`。
- `print(repr(t))` 明确要 repr,实测 `Ticket(id='T-1001', title='发票抬头开错了', amount=199, status='open')`。
- `print([t])` 重点:**列表里的元素一律用 `__repr__`**,不管你写没写 `__str__`。实测 `[Ticket(id='T-1001', ...)]`。
- `print({"latest": t})` 字典里的值也一样用 `__repr__`。

</div>

```bash
uv run python part01/str_vs_repr.py
```

实测输出:

```text
[open] T-1001 发票抬头开错了 ¥199
[open] T-1001 发票抬头开错了 ¥199
新工单:[open] T-1001 发票抬头开错了 ¥199
Ticket(id='T-1001', title='发票抬头开错了', amount=199, status='open')
[Ticket(id='T-1001', title='发票抬头开错了', amount=199, status='open')]
{'latest': Ticket(id='T-1001', title='发票抬头开错了', amount=199, status='open')}
```

规则记一句就够:**单独 print、str()、f-string 用 `__str__`;放进列表或字典里、在交互环境里直接敲变量名、`!r`,用 `__repr__`;只写了 `__repr__` 时,`__str__` 也用它**。反过来不成立:只写 `__str__`、不写 `__repr__`,列表里还是那串地址,练习 3 会实测。

所以优先级很清楚:先写 `__repr__`,确实需要一个面向用户的版本再加 `__str__`。JS 里和 `__str__` 最像的是 `toString()`,模板字符串 `` `${obj}` `` 会调它。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="print(t)、str(t)、f-string 走 __str__;列表、字典、repr()、!r 走 __repr__;没有 __str__ 时退回 __repr__">
<rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="200" height="70" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="35" y="52" fill="var(--ink)">print(t)</text>
<text x="35" y="70" fill="var(--ink)">str(t)</text>
<text x="35" y="88" fill="var(--ink)">f"{t}"</text>
<rect x="20" y="120" width="200" height="70" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="35" y="142" fill="var(--ink)">print([t]) / {"k": t}</text>
<text x="35" y="160" fill="var(--ink)">repr(t)</text>
<text x="35" y="178" fill="var(--ink)">f"{t!r}"</text>
<rect x="400" y="40" width="220" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="510" y="62" text-anchor="middle" fill="var(--ink)">__str__</text>
<text x="510" y="80" text-anchor="middle" fill="var(--ink-soft)" font-size="11">给人看:[open] T-1001 ...</text>
<rect x="400" y="130" width="220" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="510" y="152" text-anchor="middle" fill="var(--ink)">__repr__</text>
<text x="510" y="170" text-anchor="middle" fill="var(--ink-soft)" font-size="11">给程序员看:Ticket(id='T-1001'...)</text>
<line x1="220" y1="65" x2="400" y2="65" stroke="var(--rule)"/>
<line x1="220" y1="155" x2="400" y2="155" stroke="var(--rule)"/>
<line x1="510" y1="90" x2="510" y2="130" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="520" y="114" fill="var(--ink-faint)" font-size="11">没写 __str__ 时往下退</text>
</g>
</svg>
<figcaption>左边是你写的代码,右边是 Python 调的魔术方法。虚线表示没有 __str__ 时退回 __repr__,反方向不会退。</figcaption>
</figure>

## 第三步:Day 40 留下的漏洞

Day 40 把校验写进了 `__init__`,「造出来就等于校验通过」。那造出来之后呢?新建 `part01/hole_demo.py`,用的还是 Day 40 原版的 `ticket_model.py`(今天还没改它):

```python
# agent-zero-lab/part01/hole_demo.py
from ticket_model import Ticket, TicketError

try:
    Ticket("T-1002", "申请退款", -50)
except TicketError as e:
    print("构造时拦住了:", e)

t = Ticket("T-1001", "发票抬头开错了", 199)
t.amount = -50
print("造完再改,没人拦:", t.amount)
print(t.to_dict())
```

<div class="line-notes">

- `Ticket("T-1002", "申请退款", -50)` 构造时传负数。
- `print("构造时拦住了:", e)` 实测 `构造时拦住了: T-1002 金额不能是负数: -50`,`__init__` 的校验在起作用。
- `t = Ticket("T-1001", "发票抬头开错了", 199)` 造一张合格的。
- `t.amount = -50` 造完以后直接给属性赋值。这一行只是普通的属性赋值,`__init__` 早就跑完了,没有任何代码会检查它。
- `print("造完再改,没人拦:", t.amount)` 实测 `造完再改,没人拦: -50`。
- `print(t.to_dict())` 实测 `{'id': 'T-1001', 'title': '发票抬头开错了', 'amount': -50, 'status': 'open'}`,再 save 一下,负数金额就进了文件。

</div>

```bash
uv run python part01/hole_demo.py
```

实测输出:

```text
构造时拦住了: T-1002 金额不能是负数: -50
造完再改,没人拦: -50
{'id': 'T-1001', 'title': '发票抬头开错了', 'amount': -50, 'status': 'open'}
```

Day 40 自测第 4 题说「程序里任何地方拿到的 Ticket 都一定是合格的」,现在看来只对了一半。要堵住它,得让「给 amount 赋值」这个动作也跑一段校验代码。JS 里你会写 `set amount(v) { ... }`,Python 对应的东西叫 property。先从简单的只读版本看起。

## 第四步:只读的 property

**property**(特性)就是「看起来像属性、其实是方法」的东西:读的时候写 `t.is_closed`,不加括号,背后却跑了一个函数。相当于 JS class 里的 `get isClosed() { ... }`。新建 `part01/property_demo.py`:

```python
# agent-zero-lab/part01/property_demo.py
class Ticket:
    def __init__(self, id: str, title: str, amount: float, status: str = "open"):
        self.id = id
        self.title = title
        self.amount = amount
        self.status = status

    @property
    def is_closed(self) -> bool:
        return self.status == "closed"


t = Ticket("T-1001", "发票抬头开错了", 199)
print(t.is_closed)
t.status = "closed"
print(t.is_closed)
print(vars(t))
print(type(Ticket.is_closed))
t.is_closed = False
```

<div class="line-notes">

- `@property` 写在 def 上面一行,以 `@` 开头,这种写法叫**装饰器**。它的原理要到 [Day 96](/blog/agent-zero/day-096-decorators/) 才讲,今天当成固定搭配记住:在方法上面写 `@property`,这个方法就变成了一个「读起来像属性」的东西。
- `def is_closed(self) -> bool:` 除了 self 不能有别的参数,因为读属性时没地方传参数。
- `return self.status == "closed"` 每次读 `t.is_closed` 都现算一遍。
- `print(t.is_closed)` 注意**没有括号**。实测 `False`。
- `t.status = "closed"` 改状态。
- `print(t.is_closed)` 再读,实测 `True`,跟着 status 变了。这就是现算的好处:不会出现 status 改了、is_closed 忘了改的不一致。
- `print(vars(t))` 实测 `{'id': 'T-1001', 'title': '发票抬头开错了', 'amount': 199, 'status': 'closed'}`,里面**没有** is_closed。property 不存在对象身上,它挂在类上。
- `print(type(Ticket.is_closed))` 从类上取,实测 `<class 'property'>`。
- `t.is_closed = False` 想给只读 property 赋值。

</div>

```bash
uv run python part01/property_demo.py
```

实测输出:

```text
False
True
{'id': 'T-1001', 'title': '发票抬头开错了', 'amount': 199, 'status': 'closed'}
<class 'property'>
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/property_demo.py", line 20, in <module>
    t.is_closed = False
    ^^^^^^^^^^^
AttributeError: property 'is_closed' of 'Ticket' object has no setter
```

报错说得很直白:is_closed 这个 property 没有 setter(赋值方法),所以只能读不能写。basedpyright 也提前抓到了,实测报 `Cannot assign to attribute "is_closed" for class "Ticket"`。只读 property 适合「由别的属性算出来的值」,is_closed 由 status 决定,不该让人单独改它。

## 第五步:setter,让赋值也过校验

现在给 amount 加一个 setter。新建 `part01/setter_demo.py`,我在读和写里各打一句,让你看清每一步什么时候被调用:

```python
# agent-zero-lab/part01/setter_demo.py
class TicketError(Exception):
    pass


class Ticket:
    def __init__(self, id: str, title: str, amount: float):
        self.id = id
        self.title = title
        self.amount = amount

    @property
    def amount(self) -> float:
        print("    读 amount")
        return self._amount

    @amount.setter
    def amount(self, value: float) -> None:
        print(f"    写 amount = {value}")
        if value < 0:
            raise TicketError(f"{self.id} 金额不能是负数: {value}")
        self._amount = value


print("造工单:")
t = Ticket("T-1001", "发票抬头开错了", 199)
print("改成 299:")
t.amount = 299
print("读出来:", t.amount)
print(vars(t))
print("改成 -50:")
try:
    t.amount = -50
except TicketError as e:
    print("拦住了:", e)
print("还是", t.amount)
```

<div class="line-notes">

- `self.amount = amount` `__init__` 里这一行看起来没变,可现在类上有一个叫 amount 的 property,所以它**不是**普通赋值,而是去调下面的 setter。校验因此只写一处。
- `@property` 先写读的那一半(getter)。
- `def amount(self) -> float:` 名字就叫 amount。
- `return self._amount` 真正的值存在 `_amount` 上。名字前面加一个下划线是 Python 的约定,意思是「内部用的,外面别直接碰」。Python 不会真的禁止你访问,全靠自觉,有点像 TS 的 `private` 只在编辑器里管用。
- `@amount.setter` 再写写的那一半。`amount.setter` 的 amount 就是上面那个 property 的名字,两个方法**必须同名**。相当于 JS 的 `set amount(value) { ... }`。
- `def amount(self, value: float) -> None:` setter 收一个参数,就是等号右边的值。
- `if value < 0:` 校验搬到这里。
- `raise TicketError(f"{self.id} 金额不能是负数: {value}")` 抛异常,下一行就不会执行。
- `self._amount = value` 校验通过才存。注意存的是 `_amount`,不是 `amount`,原因看下面的坑。
- `t = Ticket("T-1001", "发票抬头开错了", 199)` 实测打印 `    写 amount = 199`,证明 `__init__` 走了 setter。
- `t.amount = 299` 实测 `    写 amount = 299`。
- `print("读出来:", t.amount)` 读 amount 走 getter,先打印 `    读 amount`,再打印 `读出来: 299`。
- `print(vars(t))` 实测 `{'id': 'T-1001', 'title': '发票抬头开错了', '_amount': 299}`,对象身上存的是 `_amount`。
- `t.amount = -50` 实测打印 `    写 amount = -50`,然后抛异常。
- `print("拦住了:", e)` 实测 `拦住了: T-1001 金额不能是负数: -50`。
- `print("还是", t.amount)` 实测 `还是 299`,赋值失败,旧值没被破坏。

</div>

```bash
uv run python part01/setter_demo.py
```

实测输出:

```text
造工单:
    写 amount = 199
改成 299:
    写 amount = 299
    读 amount
读出来: 299
{'id': 'T-1001', 'title': '发票抬头开错了', '_amount': 299}
改成 -50:
    写 amount = -50
拦住了: T-1001 金额不能是负数: -50
    读 amount
还是 299
```

外面用的人感觉不到任何变化,`t.amount` 照样读、照样写,但每次写都过了一道校验。这就是 property 最大的价值:**先用普通属性写,哪天需要校验了再换成 property,调用方一行都不用改**。Java 程序员习惯一上来就写 `getAmount()`/`setAmount()`,Python 不需要。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="t.amount = -50 调用 setter,setter 校验失败抛 TicketError;t.amount 读取调用 getter,getter 返回 self._amount">
<rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="160" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="100" y="55" text-anchor="middle" fill="var(--ink)">t.amount = 299</text>
<rect x="20" y="130" width="160" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="100" y="155" text-anchor="middle" fill="var(--ink)">print(t.amount)</text>
<rect x="240" y="30" width="200" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="340" y="55" text-anchor="middle" fill="var(--ink)">@amount.setter 校验</text>
<rect x="240" y="130" width="200" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="340" y="155" text-anchor="middle" fill="var(--ink)">@property getter</text>
<rect x="500" y="80" width="120" height="40" rx="4" fill="none" stroke="var(--rule)"/>
<text x="560" y="105" text-anchor="middle" fill="var(--ink)">self._amount</text>
<line x1="180" y1="50" x2="240" y2="50" stroke="var(--rule)"/>
<line x1="180" y1="150" x2="240" y2="150" stroke="var(--rule)"/>
<line x1="440" y1="50" x2="500" y2="95" stroke="var(--rule)"/>
<line x1="440" y1="150" x2="500" y2="105" stroke="var(--rule)"/>
<text x="340" y="90" text-anchor="middle" fill="var(--ink-faint)" font-size="11">负数:raise TicketError,不写入</text>
<text x="470" y="62" fill="var(--ink-faint)" font-size="11">写</text>
<text x="470" y="145" fill="var(--ink-faint)" font-size="11">读</text>
</g>
</svg>
<figcaption>外面写的是 t.amount,里面真正存的是 self._amount。写要经过 setter,读要经过 getter,校验只写一处。</figcaption>
</figure>

### setter 里两个真实的坑

第一个坑:setter 里写成了 `self.amount = value`。第二个坑:`__init__` 里先设 amount、后设 id,而 setter 的报错信息要用 `self.id`。新建 `part01/setter_bugs.py` 一次看两个:

```python
# agent-zero-lab/part01/setter_bugs.py
class Loop:
    def __init__(self, amount: float):
        self.amount = amount

    @property
    def amount(self) -> float:
        return self._amount

    @amount.setter
    def amount(self, value: float) -> None:
        self.amount = value


class Order:
    def __init__(self, id: str, amount: float):
        self.amount = amount
        self.id = id

    @property
    def amount(self) -> float:
        return self._amount

    @amount.setter
    def amount(self, value: float) -> None:
        if value < 0:
            raise ValueError(f"{self.id} 金额不能是负数: {value}")
        self._amount = value


try:
    Loop(199)
except RecursionError as e:
    print("RecursionError:", e)

Order("T-1002", -50)
```

<div class="line-notes">

- `self.amount = amount` Loop 的 `__init__` 调 setter。
- `self.amount = value` 坑一:setter 里又给 `self.amount` 赋值,这又会调 setter,setter 里又赋值……自己调自己,永远停不下来。
- `self.amount = amount` 坑二:Order 的 `__init__` 先设 amount。
- `self.id = id` 后设 id。setter 跑的时候 id 还不存在。
- `raise ValueError(f"{self.id} 金额不能是负数: {value}")` 本想抛一个友好的错,结果拼报错信息时读 `self.id` 先崩了。
- `except RecursionError as e:` 递归太深时 Python 抛的异常。
- `print("RecursionError:", e)` 实测 `RecursionError: maximum recursion depth exceeded`。
- `Order("T-1002", -50)` 不包 try,看坑二的原样报错。

</div>

```bash
uv run python part01/setter_bugs.py
```

实测输出(traceback 只留关键几行):

```text
RecursionError: maximum recursion depth exceeded
Traceback (most recent call last):
  ...
  File ".../agent-zero-lab/part01/setter_bugs.py", line 17, in __init__
    self.amount = amount
    ^^^^^^^^^^^
  File ".../agent-zero-lab/part01/setter_bugs.py", line 27, in amount
    raise ValueError(f"{self.id} 金额不能是负数: {value}")
                        ^^^^^^^
AttributeError: 'Order' object has no attribute 'id'
```

**RecursionError**(递归错误):函数调自己叫递归,Python 默认最多套 1000 层左右,超了就抛这个。看到它出现在 property 附近,十有八九是 setter 或 getter 里忘了加下划线。basedpyright 对这个文件实测报了 `Attribute "_amount" is unknown`:因为 Loop 里从来没有给 `_amount` 赋过值,getter 却在读它,这条红线就是提示。

坑二更隐蔽:你想要的是「金额不能是负数」,看到的却是「没有 id 这个属性」,很容易往错误的方向查。规矩是 **`__init__` 里先设 setter 要用到的属性,再设有 setter 的属性**。等会儿最后的 ticket_model.py 里,`self.id = id` 就排在 `self.amount = amount` 前面。

## 第六步:类方法,另一种造对象的方式

Day 40 写了一个类外面的函数 `ticket_from_dict(d)`,当时说「把它挂到类上的写法叫类方法」。普通方法的第一个参数是对象(self),**类方法**的第一个参数是类本身,习惯叫 `cls`。最常见的用途就是写「另一种造对象的方式」:除了 `Ticket(...)`,还能 `Ticket.from_dict(字典)`。JS 里对应 `static fromDict(d) { return new this(...) }`。

新建 `part01/classmethod_demo.py`:

```python
# agent-zero-lab/part01/classmethod_demo.py
from typing import Any


class Ticket:
    def __init__(self, id: str, title: str, amount: float, status: str = "open"):
        self.id = id
        self.title = title
        self.amount = amount
        self.status = status

    def __repr__(self) -> str:
        return f"{type(self).__name__}(id={self.id!r}, amount={self.amount!r}, status={self.status!r})"

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Ticket":
        print("    cls 是", cls)
        return cls(d["id"], d["title"], d["amount"], d.get("status", "open"))


class VipTicket(Ticket):
    pass


row = {"id": "T-1001", "title": "发票抬头开错了", "amount": 199}
a = Ticket.from_dict(row)
print(a)
b = VipTicket.from_dict(row)
print(b, isinstance(b, VipTicket))
c = a.from_dict({"id": "T-1005", "title": "升级套餐", "amount": 399, "status": "closed"})
print(c)
```

<div class="line-notes">

- `return f"{type(self).__name__}(id={self.id!r}` 这次 `__repr__` 开头不写死 Ticket,而是用 Day 42 见过的 `type(self).__name__`,子类对象打印出来就是子类的名字。
- `@classmethod` 又一个装饰器,固定搭配:写在方法上面,这个方法的第一个参数就变成了类。
- `def from_dict(cls, d: dict[str, Any]) -> "Ticket":` 第一个参数 cls,第二个才是字典。返回类型 `"Ticket"` 加了引号,原因看下面的坑。
- `print("    cls 是", cls)` 看看 cls 到底是谁。
- `return cls(d["id"], d["title"], d["amount"], d.get("status", "open"))` `cls(...)` 就是「用这个类造一个对象」。cls 是 Ticket 时就等于 `Ticket(...)`。
- `class VipTicket(Ticket):` 一个什么都没加的子类,只为看 cls 的妙处。
- `a = Ticket.from_dict(row)` 通过类调用,不用先有对象。实测先打印 `    cls 是 <class '__main__.Ticket'>`。
- `print(a)` 实测 `Ticket(id='T-1001', amount=199, status='open')`。
- `b = VipTicket.from_dict(row)` 通过子类调用。实测 `    cls 是 <class '__main__.VipTicket'>`。
- `print(b, isinstance(b, VipTicket))` 实测 `VipTicket(id='T-1001', amount=199, status='open') True`。造出来的是子类对象。如果 from_dict 里写死 `return Ticket(...)`,这里就会造出一个普通 Ticket。
- `c = a.from_dict({"id": "T-1005"` 通过对象调用也行,Python 会把对象所属的类当 cls 传进去,实测 cls 还是 Ticket。不过习惯上都用类名调。

</div>

```bash
uv run python part01/classmethod_demo.py
```

实测输出:

```text
    cls 是 <class '__main__.Ticket'>
Ticket(id='T-1001', amount=199, status='open')
    cls 是 <class '__main__.VipTicket'>
VipTicket(id='T-1001', amount=199, status='open') True
    cls 是 <class '__main__.Ticket'>
Ticket(id='T-1005', amount=399, status='closed')
```

普通方法、类方法对比一下:

| | 普通方法 | 类方法 |
| --- | --- | --- |
| 写法 | `def close(self):` | `@classmethod` + `def from_dict(cls, d):` |
| 第一个参数 | 对象(self) | 类(cls) |
| 怎么调 | `t.close()` | `Ticket.from_dict(d)` |
| 典型用途 | 读写这个对象的属性 | 换一种方式造对象 |
| JS 对应 | 普通方法 | `static` 方法 |

你以后会在很多库里看到 `from_xxx` 这种类方法:pydantic 的 `Model.model_validate(字典)`([Day 52](/blog/agent-zero/day-052-pydantic-2/))、标准库的 `datetime.fromisoformat("2026-10-22")`、`dict.fromkeys(...)`,全是这个套路。

### 返回类型为什么要加引号

把 `-> "Ticket"` 的引号去掉试试。新建 `part01/annot_bug.py`:

```python
# agent-zero-lab/part01/annot_bug.py
from typing import Any


class Ticket:
    def __init__(self, id: str):
        self.id = id

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Ticket:
        return cls(d["id"])


print(Ticket.from_dict({"id": "T-1001"}).id)
```

<div class="line-notes">

- `def from_dict(cls, d: dict[str, Any]) -> Ticket:` 返回类型直接写 Ticket,不带引号。
- `print(Ticket.from_dict({"id": "T-1001"}).id)` 根本走不到这一行。

</div>

```bash
uv run python part01/annot_bug.py
```

实测输出:

```text
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/annot_bug.py", line 5, in <module>
    class Ticket:
  File ".../agent-zero-lab/part01/annot_bug.py", line 10, in Ticket
    def from_dict(cls, d: dict[str, Any]) -> Ticket:
                                             ^^^^^^
NameError: name 'Ticket' is not defined
```

Python 3.12 执行到 `def from_dict` 这一行时,会当场求出类型标注的值。可这时 `class Ticket:` 的类体还没执行完,Ticket 这个名字还不存在,于是 NameError。basedpyright 也实测报了 `"Ticket" is not defined`。加上引号,标注就成了一个字符串,Python 不去求值,编辑器照样能看懂。

顺带一提,我用 Python 3.14 跑同一个文件,实测能正常打印 `T-1001`:3.14 改成了「用到标注时才求值」。但我们的项目锁在 3.12([Day 10](/blog/agent-zero/day-010-uv-1/) 建项目时定的),所以引号得写。

## 把零件拼起来:改造 ticket_model.py

现在把今天学的全部放进 Day 40 的 `part01/ticket_model.py`。改的原则是**加东西,不删东西**:`ticket_from_dict`、`save`、`load` 这些名字 Day 41 的 `ticket_checkup.py`、Day 42 的 `notifiers.py` 都在用,一个都不能少,也不能改用法。打开文件,改成下面这样:

```python
# agent-zero-lab/part01/ticket_model.py
import json
from pathlib import Path
from typing import Any

DATA = Path(__file__).resolve().parent / "data" / "tickets_v2.json"


class TicketError(Exception):
    pass


class Ticket:
    def __init__(self, id: str, title: str, amount: float, status: str = "open"):
        if title.strip() == "":
            raise TicketError(f"{id} 标题是空的")
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

    def close(self) -> None:
        self.status = "closed"

    def summary(self) -> str:
        return f"[{self.status}] {self.id} {self.title} ¥{self.amount}"

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "title": self.title, "amount": self.amount, "status": self.status}

    def __repr__(self) -> str:
        return f"Ticket(id={self.id!r}, title={self.title!r}, amount={self.amount!r}, status={self.status!r})"

    def __str__(self) -> str:
        return self.summary()

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Ticket":
        return cls(d["id"], d["title"], d["amount"], d.get("status", "open"))


def ticket_from_dict(d: dict[str, Any]) -> Ticket:
    return Ticket.from_dict(d)


def save(path: Path, tickets: list[Ticket]) -> None:
    data = [t.to_dict() for t in tickets]
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load(path: Path) -> list[Ticket]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return [ticket_from_dict(d) for d in data]


if __name__ == "__main__":
    tickets = [Ticket("T-1001", "发票抬头开错了", 199), Ticket("T-1005", "升级套餐", 399)]
    tickets[0].close()
    save(DATA, tickets)

    loaded = load(DATA)
    print(loaded)
    for t in loaded:
        print(t, t.is_closed)

    try:
        loaded[1].amount = -50
    except TicketError as e:
        print("没改成:", e)
    print(repr(loaded[1]))
```

<div class="line-notes">

- `if title.strip() == "":` 标题校验还在 `__init__` 里(练习 2 会把它也换成 property)。
- `self.id = id` 第五步坑二的规矩:id 排在 amount 前面,setter 拼报错信息要用它。
- `self.amount = amount` 原来这一行后面紧跟的金额校验删掉了,这一行现在走 setter,校验只在 setter 里写一份。
- `@property` amount 的 getter。
- `return self._amount` 真正的值在 `_amount`。
- `@amount.setter` 构造时和造完以后的赋值都走这里。
- `raise TicketError(f"{self.id} 金额不能是负数: {value}")` 报错文字和 Day 40 一字不差,Day 41 的体检结果才能保持一样。
- `@property` 第四步的只读 property。
- `def is_closed(self) -> bool:` 明天记事本里「已经关闭过了」的判断用它。
- `def summary(self) -> str:` 保留,别的文件在调它。
- `def to_dict(self) -> dict[str, Any]:` 保留。`self.amount` 读的是 getter,JSON 里的键仍然是 `amount`,不是 `_amount`。
- `def __repr__(self) -> str:` 第一步的写法。
- `def __str__(self) -> str:` 直接复用 summary,不写两遍。
- `@classmethod` 第六步。
- `def from_dict(cls, d: dict[str, Any]) -> "Ticket":` 带引号的返回类型。
- `return cls(d["id"], d["title"], d["amount"], d.get("status", "open"))` 原来 ticket_from_dict 的函数体搬到这里,`Ticket` 换成 `cls`。
- `def ticket_from_dict(d: dict[str, Any]) -> Ticket:` 旧名字保留,变成一行转发。这里在类外面,Ticket 已经定义好了,返回类型不用加引号。
- `return Ticket.from_dict(d)` 老代码调旧名字,新代码可以直接用 `Ticket.from_dict`,两边都行。
- `print(loaded)` 打印列表,走 `__repr__`。
- `print(t, t.is_closed)` 单独打印走 `__str__`,后面跟 is_closed。
- `loaded[1].amount = -50` 第三步的漏洞,现在被 setter 拦住。
- `print("没改成:", e)` 实测 `没改成: T-1005 金额不能是负数: -50`。
- `print(repr(loaded[1]))` 实测金额还是 399。

</div>

```bash
uv run python part01/ticket_model.py
```

实测输出:

```text
[Ticket(id='T-1001', title='发票抬头开错了', amount=199, status='closed'), Ticket(id='T-1005', title='升级套餐', amount=399, status='open')]
[closed] T-1001 发票抬头开错了 ¥199 True
[open] T-1005 升级套餐 ¥399 False
没改成: T-1005 金额不能是负数: -50
Ticket(id='T-1005', title='升级套餐', amount=399, status='open')
```

### 改了共享文件,旧脚本要重跑

`ticket_model.py` 被好几个文件 import,改了它就要把用它的脚本都跑一遍,确认没改坏。这一步在真实项目里叫回归测试,以后由 pytest 自动做,现在手动:

```bash
uv run python part01/ticket_checkup.py
uv run python part01/ex40_batch.py
uv run python part01/notifiers.py
```

实测输出:

```text
体检完成:合格 3 个,有问题 4 个
  OK  T-2001.json: [open] T-2001 发票抬头开错了 ¥199
  OK  T-2002.json: [closed] T-2002 升级套餐 | 年付 ¥399
  OK  old/T-1901.json: [open] T-1901 旧工单 ¥50
  BAD T-2003.json: T-2003 金额不能是负数: -80
  BAD T-2004.json: 不是合法 JSON: Expecting property name enclosed in double quotes
  BAD T-2005.json: 不是合法 JSON: Expecting value
  BAD T-2006.json: 缺字段 'amount'
报告写到 data/checkup_report.json
跳过: T-1002 金额不能是负数: -50
跳过: T-1003 标题是空的
2 张合格
合计: 598
  邮件 -> li@beichen.com: [云簿客服] 工单 T-1001「发票抬头开错了」当前状态 closed
  短信 -> 138-0000-1234: 工单 T-1001「发票抬头开错了」当…
发出 2 条通知
  邮件 -> li@beichen.com: [云簿客服] 工单 T-1005「升级套餐」当前状态 closed
发出 1 条通知
没发: T-1001 已经是关闭状态
邮件记录 2 条,短信记录 1 条
{'id': 'T-1001', 'title': '发票抬头开错了', '_amount': 199, 'status': 'closed'}
```

体检结果和 Day 41 一字不差,批量造工单和 Day 40 一样,通知也照常。只有一处变了:`notifiers.py` 最后一行 `vars(t)` 里的 `'amount'` 变成了 `'_amount'`。这正好说明为什么存 JSON 要用自己写的 `to_dict` 而不是 `vars`:内部怎么存是类自己的事,随时可能变,`to_dict` 才是对外的约定。

零件对照:

| 今天的零件 | 在 ticket_model.py 里是哪一段 |
| --- | --- |
| 第一步 `__repr__`、`!r` | `def __repr__` |
| 第二步 `__str__` | `def __str__`,复用 summary |
| 第三步 漏洞 | 被 amount 的 setter 堵上 |
| 第四步 只读 property | `is_closed` |
| 第五步 setter,id 先于 amount | `@amount.setter`、`__init__` 里的赋值顺序 |
| 第六步 classmethod、带引号的返回类型 | `from_dict`,以及转发它的 `ticket_from_dict` |

## 动手练习

**练习 1:给客户类加 repr 和只读 plan。** Day 40 练习 1 的 Customer 同时存了 `plan` 和 `history`,升级时两处都要改,忘了一处就不一致。改成只存 history,`plan` 写成只读 property(取 history 最后一个);再加一个 `__repr__`。文件名 `part01/ex43_customer.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex43_customer.py
class Customer:
    def __init__(self, name: str, plan: str = "free"):
        self.name = name
        self.history: list[str] = [plan]

    @property
    def plan(self) -> str:
        return self.history[-1]

    def upgrade(self, new_plan: str) -> None:
        self.history.append(new_plan)

    def __repr__(self) -> str:
        return f"Customer(name={self.name!r}, plan={self.plan!r})"


a = Customer("北辰科技")
a.upgrade("pro")
a.upgrade("enterprise")
print(a)
print([a, Customer("南山工作室", "pro")])
print(a.plan, a.history)
```

<div class="line-notes">

- `self.history: list[str] = [plan]` 只存一份数据。
- `@property` 当前套餐由历史算出来。
- `return self.history[-1]` Day 21 的负数索引,取最后一个。
- `self.history.append(new_plan)` 升级只改一处,plan 自动跟着变。
- `return f"Customer(name={self.name!r}, plan={self.plan!r})"` `self.plan` 走 getter。
- `print(a)` 没写 `__str__`,用 `__repr__`,实测 `Customer(name='北辰科技', plan='enterprise')`。
- `print([a, Customer("南山工作室", "pro")])` 实测 `[Customer(name='北辰科技', plan='enterprise'), Customer(name='南山工作室', plan='pro')]`。
- `print(a.plan, a.history)` 实测 `enterprise ['free', 'pro', 'enterprise']`。

</div>

实测输出:

```text
Customer(name='北辰科技', plan='enterprise')
[Customer(name='北辰科技', plan='enterprise'), Customer(name='南山工作室', plan='pro')]
enterprise ['free', 'pro', 'enterprise']
```

</details>

**练习 2:标题也走 setter。** 正文的 Ticket 里标题校验还在 `__init__`,造完再把标题改成空格也没人管。写一个只有 id 和 title 的小 Ticket,把标题做成 property:setter 先 `strip()` 去掉首尾空格,空了就抛 TicketError,不空就存去掉空格后的版本。测试构造时带空格的标题、造完改成空格和空字符串、构造时直接传空格。文件名 `part01/ex43_title.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex43_title.py
class TicketError(Exception):
    pass


class Ticket:
    def __init__(self, id: str, title: str):
        self.id = id
        self.title = title

    @property
    def title(self) -> str:
        return self._title

    @title.setter
    def title(self, value: str) -> None:
        cleaned = value.strip()
        if cleaned == "":
            raise TicketError(f"{self.id} 标题是空的")
        self._title = cleaned


t = Ticket("T-1001", "  发票抬头开错了  ")
print(repr(t.title))
for bad in ["   ", ""]:
    try:
        t.title = bad
    except TicketError as e:
        print("拦住了:", e)
print(repr(t.title))
try:
    Ticket("T-1003", "  ")
except TicketError as e:
    print("构造也拦:", e)
```

<div class="line-notes">

- `self.id = id` 先设 id,setter 的报错要用。
- `self.title = title` 走 setter。
- `cleaned = value.strip()` Day 16 的 strip。
- `self._title = cleaned` 存清洗过的版本,setter 不光能校验,还能顺手整理数据。
- `print(repr(t.title))` 用 repr 打印字符串能看见引号,首尾有没有空格一目了然。实测 `'发票抬头开错了'`,两边的空格没了。
- `t.title = bad` 两次都被拦,实测两行 `拦住了: T-1001 标题是空的`。
- `print(repr(t.title))` 实测还是 `'发票抬头开错了'`。
- `Ticket("T-1003", "  ")` 构造时也经过同一个 setter,实测 `构造也拦: T-1003 标题是空的`。

</div>

实测输出:

```text
'发票抬头开错了'
拦住了: T-1001 标题是空的
拦住了: T-1001 标题是空的
'发票抬头开错了'
构造也拦: T-1003 标题是空的
```

想把它合进正文的 ticket_model.py 也可以,但注意 Day 41 的体检脚本:`"  "` 标题的报错文字不变,所以结果还会一样;改之前先想好,改完照样把三个旧脚本重跑一遍。

</details>

**练习 3:观察会发生什么。** 只写 `__str__`、不写 `__repr__`,三种打印分别是什么?先猜再跑。文件名 `part01/ex43_only_str.py`。

```python
# agent-zero-lab/part01/ex43_only_str.py
class Ticket:
    def __init__(self, id: str):
        self.id = id

    def __str__(self) -> str:
        return f"工单 {self.id}"


t = Ticket("T-1001")
print(t)
print([t])
print(f"{t!r}")
```

<div class="line-notes">

- `def __str__(self) -> str:` 只有 `__str__`。
- `print(t)` 走 `__str__`。
- `print([t])` 列表里走 `__repr__`,而 `__repr__` 没写。
- `print(f"{t!r}")` 明确要 repr。

</div>

<details><summary>参考答案</summary>

实测输出:

```text
工单 T-1001
[<__main__.Ticket object at 0x10247ee10>]
<__main__.Ticket object at 0x10247ee10>
```

只有第一行用上了 `__str__`。`__repr__` 没写就用 object 的默认版本,而 `__repr__` 不会反过来去借 `__str__`。调试时最常见的就是打印一个列表,所以只写 `__str__` 基本等于白写。先写 `__repr__`。

</details>

**练习 4:从一行文本造工单。** [Day 38](/blog/agent-zero/day-038-files-with/) 把工单存成过 `T-1001|发票抬头开错了|199` 这种竖线分隔的文本。写一个继承正文 Ticket 的 `LineTicket`,加一个类方法 `from_line(line)`:去掉末尾换行、按竖线切开、不是 3 段就抛 TicketError、金额用 `float()` 转。用三行数据测试,其中一行少一段。文件名 `part01/ex43_from_line.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex43_from_line.py
from ticket_model import Ticket, TicketError


class LineTicket(Ticket):
    @classmethod
    def from_line(cls, line: str) -> "LineTicket":
        parts = line.strip().split("|")
        if len(parts) != 3:
            raise TicketError(f"这一行不是 3 段: {line.strip()!r}")
        id, title, amount = parts
        return cls(id, title, float(amount))


lines = ["T-1001|发票抬头开错了|199\n", "T-1002|申请退款\n", "T-1005|升级套餐|399\n"]
for line in lines:
    try:
        t = LineTicket.from_line(line)
    except TicketError as e:
        print("跳过:", e)
        continue
    print(repr(t), type(t).__name__)
```

<div class="line-notes">

- `class LineTicket(Ticket):` 继承正文改好的 Ticket,白拿 property、repr、from_dict。
- `def from_line(cls, line: str) -> "LineTicket":` 类方法,返回类型同样要加引号。
- `parts = line.strip().split("|")` Day 16 的 strip 和 split。
- `if len(parts) != 3:` 段数不对。
- `raise TicketError(f"这一行不是 3 段: {line.strip()!r}")` 用 `!r` 打印原文,带引号,空格和缺的内容看得清。
- `id, title, amount = parts` Day 22 的解包。
- `return cls(id, title, float(amount))` 用 cls 造,所以造出来的是 LineTicket。金额经过 Ticket 的 setter 校验。
- `print("跳过:", e)` 第二行实测 `跳过: 这一行不是 3 段: 'T-1002|申请退款'`。
- `print(repr(t), type(t).__name__)` 实测 `Ticket(id='T-1001', title='发票抬头开错了', amount=199.0, status='open') LineTicket`。

</div>

实测输出:

```text
Ticket(id='T-1001', title='发票抬头开错了', amount=199.0, status='open') LineTicket
跳过: 这一行不是 3 段: 'T-1002|申请退款'
Ticket(id='T-1005', title='升级套餐', amount=399.0, status='open') LineTicket
```

注意两个细节。一是 `type(t).__name__` 是 LineTicket,可 repr 开头写的还是 `Ticket(`:正文的 `__repr__` 把类名写死了,第六步 classmethod_demo 里那种 `type(self).__name__` 的写法才能跟着子类变。二是金额是 `199.0`,因为 `float("199")` 得到的是浮点数。明天的记事本会处理这个显示问题。

</details>

验收标准:四个练习的输出和上面一致;不看文章能写出 Ticket 的 `__repr__`、amount 的 property + setter、from_dict 类方法;改完 ticket_model.py 后三个旧脚本重跑结果和改之前一样;看到 property 附近的 RecursionError 能马上想到「setter 里少了下划线」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| `__repr__` | 魔术方法,返回给程序员看的字符串;列表、字典里的元素、`repr()`、`!r` 用它 |
| `__str__` | 魔术方法,返回给人看的字符串;print、`str()`、f-string 优先用它,没有就退回 `__repr__`,≈ JS 的 `toString()` |
| `!r` | f-string 里 `{x!r}` 等于 `{repr(x)}`,字符串会带上引号 |
| repr() | 内置函数,调对象的 `__repr__` |
| 装饰器(decorator) | 写在 def 上一行、以 `@` 开头的东西,如 `@property`;原理 Day 96 讲 |
| property(特性) | 读起来像属性、背后是方法,`@property` ≈ JS 的 `get x()` |
| getter / setter | property 的读方法 / 写方法;`@x.setter` ≈ JS 的 `set x(v)` |
| 只读 property | 只写了 getter 没写 setter,赋值时报 `has no setter` |
| `_amount` | 前面带下划线的名字,约定为「内部用,外面别碰」,Python 不强制 |
| RecursionError | 函数自己调自己太多层时的异常,setter 里写 `self.amount = value` 就会触发 |
| 类方法(classmethod) | `@classmethod` 装饰的方法,第一个参数是类本身 cls,≈ JS 的 `static` 方法 |
| cls | 类方法的第一个参数,代表调用它的那个类,`cls(...)` 就是造一个该类的对象 |
| NameError | 用到一个还不存在的名字时的异常;类体里写 `-> Ticket` 在 3.12 会触发 |
| 回归测试 | 改了代码以后把原来能跑的东西再跑一遍,确认没改坏 |

## 常见误区

**只写 `__str__` 不写 `__repr__`。** 单独 print 好看了,放进列表实测还是 `[<__main__.Ticket object at 0x10247ee10>]`。先写 `__repr__`。

**`__repr__` 里不用 `!r`。** 字符串不带引号,`'T-1001'` 和 `1001` 分不清,标题里的逗号和字段分隔也分不清。

**读 property 时加了括号。** `t.is_closed()` 实际是先读出 True/False,再去「调用」一个布尔值,会报 `TypeError: 'bool' object is not callable`。property 读的时候不加括号。

**setter 里写 `self.amount = value`。** 自己调自己,实测 `RecursionError: maximum recursion depth exceeded`。存到 `self._amount`。

**`__init__` 里属性的顺序不对。** setter 的报错信息要用 `self.id`,id 却设在后面,实测得到的是 `AttributeError: 'Order' object has no attribute 'id'`,真正的「金额不能是负数」被盖住了。

**getter 和 setter 不同名。** `@amount.setter` 下面的方法也必须叫 amount;起成别的名字,就成了另一个东西,`t.amount = ...` 照样报 `has no setter`。

**类方法里写死类名。** `return Ticket(...)` 在子类上调 from_dict 也只能造出 Ticket,用 `cls(...)`,实测 `VipTicket.from_dict(row)` 才能得到 VipTicket。

**类体里返回类型写 `-> Ticket` 不加引号。** Python 3.12 实测 `NameError: name 'Ticket' is not defined`,写成 `-> "Ticket"`。

**用 `vars(t)` 存 JSON。** 加了 property 以后 vars 里是 `_amount`,存出去的键名就变了。对外的格式只认 `to_dict`。

## 学习资料

### 文档与文章

- [Python 数据模型 · `object.__repr__` 和 `object.__str__`(中文)](https://docs.python.org/zh-cn/3.12/reference/datamodel.html#object.__repr__):官方对两个方法分工的原话。`__repr__` 那一条写着「如果可能,这应类似一个有效的 Python 表达式,能被用来重建具有相同取值的对象」,`__str__` 那一条写着它「并不预期返回一个有效的 Python 表达式」。
- [Python 内置函数 · property 和 classmethod(中文)](https://docs.python.org/zh-cn/3.12/library/functions.html#property):property 那一条的示例几乎就是第五步的结构,往下翻到 classmethod 一条。
- [MDN · getter](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Functions/get) 和 [MDN · static](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Classes/static):JS 这一边的 get/set 和静态方法,对照看。
- [Real Python · Python's property(): Add Managed Attributes to Your Classes](https://realpython.com/python-property/):英文长文,讲 property 的各种用法,看「先用普通属性、需要时再换成 property」那一段(对爬虫返回 403,需浏览器打开)。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1N3411e7zo&autoplay=0&high_quality=1" title="Python面向对象__str__和__repr__的区别" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>大熊课堂 · Python面向对象__str__和__repr__的区别 · 4 分钟,只讲第一、二步这一件事。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1wm4y1h7mV&autoplay=0&high_quality=1" title="property装饰器" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Python很简单 · property装饰器 · 约 16 分钟,对应第四、五步的 getter 和 setter。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1jv4y1K7Yu&autoplay=0&high_quality=1" title="【python】staticmethod与classmethod深度机制解析——要知其所以然" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>码农高天 · 【python】staticmethod与classmethod深度机制解析 · 约 11 分钟,作者是 CPython 核心开发者,讲的是背后的机制,比今天深。第一遍看不懂很正常,学完 Day 96 装饰器再回来看一遍。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/jCzT9XFZ5bw" title="Python OOP Tutorial 6: Property Decorators - Getters, Setters, and Deleters" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python OOP Tutorial 6: Property Decorators · 英文,Day 40 推荐过的那个系列的第 6 集,讲 property。同系列第 5 集《Special (Magic/Dunder) Methods》前半段就是 __repr__ 和 __str__,第 3 集《classmethods and staticmethods》讲类方法,按标题在 YouTube 搜得到,有空一起看。</figcaption>
</figure>

### 书籍

- 《流畅的 Python(第 2 版)》,Luciano Ramalho 著,安道译,人民邮电出版社。第 1 章讲数据模型,`__repr__` 和 `__str__` 的分工就是从这里讲起的;第 11 章(英文版章名 A Pythonic Object)讲怎么写一个「像 Python 自带类型一样好用」的类,`__repr__`、classmethod 构造器、只读 property 都在里面。现在读会有点吃力,挑这两章翻翻。
- 《Python 编程:从入门到实践(第 3 版)》,Eric Matthes 著,人民邮电出版社。第 9 章「类」里「修改属性的值」那一节,讲的正是第三步「直接改属性没人拦」的问题,书里用方法来解决,对照今天的 property 看。

### 开源项目与代码

- [CPython · `Lib/fractions.py`](https://github.com/python/cpython/blob/3.12/Lib/fractions.py):标准库的分数类,今天三样东西全在里面。第 291 行起是 `@classmethod def from_float(cls, f)`,「另一种造对象的方式」;第 397 行起 `@property def numerator(a)` 是只读 property;第 405 行 `def __repr__(self)` 返回 `Fraction(3, 4)` 这种能重建对象的写法。在终端敲 `uv run python -c "from fractions import Fraction; print(repr(Fraction(3, 4)))"` 就能看到效果。

## 自测

1. 下面代码打印哪两行?

```python
class P:
    def __init__(self, name: str):
        self.name = name

    def __repr__(self) -> str:
        return f"P({self.name!r})"

    def __str__(self) -> str:
        return self.name


p = P("小李")
print(p)
print([p])
```

<details><summary>答案</summary>

第一行 `小李`(单独 print 用 `__str__`),第二行 `[P('小李')]`(列表里用 `__repr__`,`!r` 给名字加了引号)。

</details>

2. `t.is_closed` 和 `t.is_closed()` 哪个对?is_closed 是用 `@property` 写的。

<details><summary>答案</summary>

`t.is_closed` 对。property 读的时候不加括号,它已经替你调用了方法并返回 True 或 False;再加括号就是在调用一个布尔值,报 `TypeError: 'bool' object is not callable`。

</details>

3. 一个 setter 里写着 `self.price = value`,造对象时报 `RecursionError: maximum recursion depth exceeded`。为什么?怎么改?

<details><summary>答案</summary>

`self.price = value` 又触发了 price 的 setter,setter 里又赋值,无限套下去。真正的值要存在另一个名字上,改成 `self._price = value`,getter 里返回 `self._price`。

</details>

4. 类方法 `from_dict` 里为什么写 `cls(...)` 而不是 `Ticket(...)`?

<details><summary>答案</summary>

cls 是「调用这个方法的那个类」。在子类上调 `VipTicket.from_dict(d)` 时 cls 是 VipTicket,`cls(...)` 造出的是子类对象;写死 `Ticket(...)` 就永远只能造出 Ticket。

</details>

5. 面试题:你接手一个 Agent 项目,消息对象 `Message` 有个 `content` 属性被几十处代码直接读写。现在要求 content 不能超过 8000 个字符,你会怎么改,为什么?

<details><summary>答案</summary>

把 content 换成 property:真正的值存在 `_content`,getter 返回它,setter 里检查长度,超了就抛异常(或者按需求截断并记日志),`__init__` 里的 `self.content = content` 也会自动走 setter。这样几十处读写 `msg.content` 的代码一行都不用改,校验却覆盖了构造和之后每一次赋值。如果改成 `get_content()`/`set_content()` 方法,所有调用方都得改。实际项目里这种消息类多半用 pydantic 写,字段约束(Day 52)是同样的思路。

</details>

## 明天预告

[Day 44 · 小项目:命令行工单记事本](/blog/agent-zero/day-044-notebook-project/)。到今天,Ticket 会校验、会打印、能从字典造出来,Day 42 学了组合,Day 39 学了 JSON。明天把它们拼成一个真正能用的命令行小工具:`add`、`list`、`close`、`delete`、`search` 几个命令,工单存在 JSON 文件里,关掉终端再打开数据还在。
