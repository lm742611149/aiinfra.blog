---
title: 'Day 40 · 类(一):class、__init__ 和 self'
description: '对照你写过的 JS class,学 Python 的 class:__init__ 就是 constructor,self 就是 this,只是要自己写出来。把工单从字典做成 Ticket 类,看清 self 到底是谁、忘了写 self 会报什么错,最后给 Ticket 加上 to_dict,和昨天的 JSON 接上。'
pubDate: 2026-10-22
regime: none
tags: ['python', 'classes', 'agent-zero']
series: 'agent-zero'
day: 40
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 39](/blog/agent-zero/day-039-json/) 学了 JSON:`json.dumps` 把字典变成 JSON 字符串,`json.loads` 变回来,写中文要加 `ensure_ascii=False`,解析外部文本要包 try 接 `JSONDecodeError`。最后的 `ticket_json_store.py` 把工单存成了 `tickets.json`,金额读回来就是整数,标题里带竖线也不怕。

不过到现在为止,一张工单一直是个字典。字典什么都能装,这既是优点也是毛病:键拼错了它不吭声,编辑器也帮不上忙;「关闭工单」「打印摘要」这些操作散落在各处的函数里,跟数据本身没有绑在一起。今天学 class,把「工单的数据」和「工单能做的事」放进同一个东西里。

## 今天要解决的问题

学完今天,你应该能:

1. 写一个带 `__init__` 的类,用它造出多个**实例**,说清楚类和实例的区别。
2. 解释 `self` 是什么,说出 `t.summary()` 和 `Ticket.summary(t)` 为什么是同一回事。
3. 认出三种「忘了 self」的报错:属性没存上、方法少了 self、构造时少传了参数。
4. 给类写会改状态的方法(`close`)和返回新数据的方法(`to_dict`),把对象存成 JSON 再读回成对象。

预计用时:2.5 小时。前置:[Day 24](/blog/agent-zero/day-024-dicts/) 的字典、[Day 28](/blog/agent-zero/day-028-functions-1/) 的函数、[Day 29](/blog/agent-zero/day-029-functions-2/) 的默认参数和可变默认值陷阱、[Day 32](/blog/agent-zero/day-032-modules/) 的 `__name__`、[Day 36](/blog/agent-zero/day-036-exceptions-2/) 的 TicketError、[Day 39](/blog/agent-zero/day-039-json/) 的 JSON。

学法:先对照文章逐行敲一遍(不要复制粘贴)并跑通;第二天合上文章,把最后的 `ticket_model.py` 默写出来;再做动手练习,做不出来再展开参考答案,看完关掉自己重写一遍。

命令都在项目根目录 `agent-zero-lab` 里跑,新文件放进 `part01/`。今天不装新依赖,不调 API,花费 0 元。

## 先看字典哪里不够用

新建 `part01/dict_typo.py`,演示一个很常见的错:

```python
# agent-zero-lab/part01/dict_typo.py
t = {"id": "T-1001", "title": "发票抬头开错了", "amount": 199}
t["titel"] = "发票抬头改好了"
print(t)
print(t["title"])
```

<div class="line-notes">

- `t = {"id": "T-1001", "title": "发票抬头开错了", "amount": 199}` 一张字典工单。
- `t["titel"] = "发票抬头改好了"` 本意是改标题,手一滑把 `title` 打成了 `titel`。字典的规矩是「键不存在就新建」,所以这一行不报错,而是悄悄多出一个键。
- `print(t)` 实测 `{'id': 'T-1001', 'title': '发票抬头开错了', 'amount': 199, 'titel': '发票抬头改好了'}`,四个键。
- `print(t["title"])` 实测 `发票抬头开错了`,标题根本没改。

</div>

实测输出:

```text
{'id': 'T-1001', 'title': '发票抬头开错了', 'amount': 199, 'titel': '发票抬头改好了'}
发票抬头开错了
```

程序没崩,结果是错的,这比崩了更糟。我在 Zed 里打开这个文件,basedpyright([Day 9](/blog/agent-zero/day-009-editor-setup/) 装的类型检查器)一条红线都没有,因为对它来说往字典里加个新键完全合法。等会儿换成类,同样的拼错编辑器会当场标出来。

## 先和 JS 对一下表

你在 JS/TS 里写过 class,概念完全一样,只是写法有几处不同:

```js
// 你熟悉的 JS 写法,只看不跑
class Ticket {
  constructor(id, title, amount) {
    this.id = id;
    this.title = title;
    this.amount = amount;
  }
  summary() {
    return `${this.id} ${this.title} ¥${this.amount}`;
  }
}
const t = new Ticket("T-1001", "发票抬头开错了", 199);
```

| JS / TS | Python | 说明 |
| --- | --- | --- |
| `class Ticket { }` | `class Ticket:` | 冒号加缩进,和 if、def 一样 |
| `constructor(id, title)` | `def __init__(self, id, title):` | 构造函数名字固定叫 `__init__`,前后各两个下划线 |
| `this.id = id` | `self.id = id` | `self` 就是 `this` |
| `this` 自动就有 | `self` **必须写成第一个参数** | 最大的区别,今天的坑基本都出在这 |
| `summary() { }` | `def summary(self):` | 方法也要写 self |
| `new Ticket(...)` | `Ticket(...)` | Python 没有 `new` |
| `t.title` | `t.title` | 访问方式一样 |

`__init__` 这种前后带双下划线的名字,Python 里叫**魔术方法**(也叫 dunder,double underscore 的缩写),是 Python 在特定时刻自动调用的方法。`__init__` 在「造出一个新对象」时被调用。Day 32 见过的 `__name__` 也是这种双下划线的写法。

## 第一步:class 和 __init__

新建 `part01/class_basic.py`:

```python
# agent-zero-lab/part01/class_basic.py
class Ticket:
    def __init__(self, id: str, title: str, amount: float):
        self.id = id
        self.title = title
        self.amount = amount


t1 = Ticket("T-1001", "发票抬头开错了", 199)
t2 = Ticket("T-1002", "申请退款", 50)

print(t1.id, t1.title, t1.amount)
print(t2.id, t2.title, t2.amount)
print(type(t1))
print(isinstance(t1, Ticket))
print(t1)

t1.amount = 299
print(t1.amount, t2.amount)
print(t1.titel)
```

<div class="line-notes">

- `class Ticket:` 定义一个**类**,名字叫 Ticket。类名习惯用大写开头的驼峰(`Ticket`、`TicketError`),函数和变量用小写加下划线(`load_tickets`),这样一眼能分清。
- `def __init__(self, id: str, title: str, amount: float):` 构造方法。第一个参数 `self` 代表「正在被造出来的那个对象」,后面三个是你造对象时要传的东西。类型标注写法和普通函数一样。
- `self.id = id` 把传进来的 `id` 存到对象身上,成为对象的**属性**。左边的 `self.id` 是对象的属性,右边的 `id` 是参数,两个名字一样只是习惯,不是必须。
- `self.title = title` 同上。
- `self.amount = amount` 同上。三行跑完,这个对象身上就有了三个属性。
- `t1 = Ticket("T-1001", "发票抬头开错了", 199)` 像调用函数一样调用类,就会造出一个新对象,这个对象叫 Ticket 的**实例**。Python 在背后做了两件事:先造一个空对象,再调 `__init__(这个空对象, "T-1001", "发票抬头开错了", 199)`。你只传了三个参数,self 是 Python 自己塞进去的。
- `t2 = Ticket("T-1002", "申请退款", 50)` 同一个类再造一个。t1 和 t2 是两个独立的对象。
- `print(t1.id, t1.title, t1.amount)` 用点号取属性,实测 `T-1001 发票抬头开错了 199`。
- `print(t2.id, t2.title, t2.amount)` 实测 `T-1002 申请退款 50`。
- `print(type(t1))` 实测 `<class '__main__.Ticket'>`。`__main__` 是因为这个类定义在被直接运行的脚本里(Day 32 讲过 `__name__ == "__main__"`)。
- `print(isinstance(t1, Ticket))` 实测 `True`。昨天用 `isinstance(data, list)` 检查是不是列表,自己写的类也能这样查。
- `print(t1)` 直接打印对象,实测 `<__main__.Ticket object at 0x10e8e7530>`。后面那串十六进制是对象在内存里的地址,每次运行都不一样。这个样子很不好读,[Day 43](/blog/agent-zero/day-043-classes-3/) 学 `__repr__` 时会把它改成人能看懂的样子。
- `t1.amount = 299` 属性可以直接改。
- `print(t1.amount, t2.amount)` 实测 `299 50`。改 t1 不影响 t2,每个实例有自己的一份属性。
- `print(t1.titel)` 故意拼错。

</div>

```bash
uv run python part01/class_basic.py
```

实测输出:

```text
T-1001 发票抬头开错了 199
T-1002 申请退款 50
<class '__main__.Ticket'>
True
<__main__.Ticket object at 0x10e8e7530>
299 50
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/class_basic.py", line 20, in <module>
    print(t1.titel)
          ^^^^^^^^
AttributeError: 'Ticket' object has no attribute 'titel'. Did you mean: 'title'?
```

最后的报错叫 `AttributeError`,「属性错误」:Ticket 对象没有叫 `titel` 的属性。Python 3.12 还会猜你想写的是 `title`。更好的是,这行代码根本不用等到运行:我用 basedpyright 检查这个文件,它直接报了

```text
class_basic.py:20:10 - error: Cannot access attribute "titel" for class "Ticket"
    Attribute "titel" is unknown (reportAttributeAccessIssue)
```

编辑器里这一行会画红线。这就是类比字典强的第一个地方:**对象有哪些属性是定死的,编辑器知道,拼错能提前抓到**。(严格说,Python 允许你在 `__init__` 之外给对象临时加属性,`t1.titel = "..."` 赋值并不会在运行时报错;但类型检查器会对这种写法画红线,所以实际写代码时你会在第一时间看到。)

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="Ticket 类像一张模具图纸,调用 Ticket(...) 两次造出 t1 和 t2 两个实例,各自有自己的 id、title、amount">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="60" width="200" height="110" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="120" y="84" text-anchor="middle" fill="var(--ink)">class Ticket</text>
<text x="40" y="110" fill="var(--ink-soft)" font-size="11">__init__(self, id,</text>
<text x="40" y="128" fill="var(--ink-soft)" font-size="11">         title, amount)</text>
<text x="40" y="152" fill="var(--ink-faint)" font-size="11">图纸:规定有哪些属性</text>
<line x1="220" y1="95" x2="380" y2="60" stroke="var(--rule)"/>
<line x1="220" y1="135" x2="380" y2="165" stroke="var(--rule)"/>
<text x="300" y="66" text-anchor="middle" fill="var(--ink-soft)" font-size="11">Ticket("T-1001", ...)</text>
<text x="300" y="178" text-anchor="middle" fill="var(--ink-soft)" font-size="11">Ticket("T-1002", ...)</text>
<rect x="380" y="20" width="240" height="85" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="395" y="42" fill="var(--ink)">t1(实例)</text>
<text x="395" y="62" fill="var(--ink-soft)" font-size="11">id     = "T-1001"</text>
<text x="395" y="78" fill="var(--ink-soft)" font-size="11">title  = "发票抬头开错了"</text>
<text x="395" y="94" fill="var(--ink-soft)" font-size="11">amount = 299</text>
<rect x="380" y="125" width="240" height="85" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="395" y="147" fill="var(--ink)">t2(实例)</text>
<text x="395" y="167" fill="var(--ink-soft)" font-size="11">id     = "T-1002"</text>
<text x="395" y="183" fill="var(--ink-soft)" font-size="11">title  = "申请退款"</text>
<text x="395" y="199" fill="var(--ink-soft)" font-size="11">amount = 50</text>
</g>
</svg>
<figcaption>类是图纸,实例是照着图纸造出来的东西。每个实例有自己的一份属性,改 t1.amount 不影响 t2。</figcaption>
</figure>

## 第二步:self 到底是谁

光有数据还不够,给 Ticket 加一个方法。**方法**就是定义在类里面的函数,它能通过 self 读到这个对象自己的属性。新建 `part01/self_demo.py`:

```python
# agent-zero-lab/part01/self_demo.py
class Ticket:
    def __init__(self, id: str, title: str, amount: float):
        print("  __init__ 里的 self:", self)
        self.id = id
        self.title = title
        self.amount = amount

    def summary(self) -> str:
        return f"{self.id} {self.title} ¥{self.amount}"


print("开始造 t1")
t1 = Ticket("T-1001", "发票抬头开错了", 199)
print("造好的 t1:        ", t1)
print(t1.summary())
print(Ticket.summary(t1))
```

<div class="line-notes">

- `print("  __init__ 里的 self:", self)` 在构造方法里把 self 打印出来,看看它是什么。
- `def summary(self) -> str:` 一个方法。第一个参数照样是 self,除此之外不需要别的参数,因为要用的数据都在 self 身上。
- `return f"{self.id} {self.title} ¥{self.amount}"` 用 self 读属性,拼成一行摘要。这里不能直接写 `id`、`title`,方法里没有这些局部变量,只能通过 self 拿。
- `print("开始造 t1")` 标记一下时间顺序。
- `t1 = Ticket("T-1001", "发票抬头开错了", 199)` 造对象,这时 `__init__` 被调用,打印出 `  __init__ 里的 self: <__main__.Ticket object at 0x1013d72c0>`。
- `print("造好的 t1:        ", t1)` 实测 `<__main__.Ticket object at 0x1013d72c0>`,地址和上一行**一模一样**。`__init__` 里的 self 和造完之后的 t1 就是同一个对象。
- `print(t1.summary())` 调用方法。你没传任何参数,但 Python 把点号前面的 `t1` 当成 self 传了进去。实测 `T-1001 发票抬头开错了 ¥199`。
- `print(Ticket.summary(t1))` 换一种写法:通过类名调用方法,自己把 t1 当第一个参数传进去。实测结果完全一样。

</div>

实测输出(地址每次运行都不同,但前后两行一定相同):

```text
开始造 t1
  __init__ 里的 self: <__main__.Ticket object at 0x1013d72c0>
造好的 t1:         <__main__.Ticket object at 0x1013d72c0>
T-1001 发票抬头开错了 ¥199
T-1001 发票抬头开错了 ¥199
```

最后两行说明了 self 的全部秘密:**`t1.summary()` 就是 `Ticket.summary(t1)` 的简写**。Python 看到「对象.方法()」,就去对象的类里找到这个方法,把对象本身作为第一个参数塞进去。JS 的 `this` 也是这么回事,只是 JS 把这个参数藏起来了,Python 让你明着写。

明着写有个好处:不会出现 JS 里那种「方法传给回调之后 this 丢了」的困惑,self 就是一个普通参数,谁调用就是谁。self 这个名字也只是约定,写成 `this` 或 `me` 程序照样能跑,但所有 Python 代码都写 self,你也写 self。

<figure>
<svg viewBox="0 0 640 170" role="img" aria-label="t1.summary() 被 Python 改写成 Ticket.summary(t1),t1 成为 self 参数">
<rect x="0" y="0" width="640" height="170" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="170" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="105" y="55" text-anchor="middle" fill="var(--ink)">t1.summary()</text>
<line x1="190" y1="50" x2="250" y2="50" stroke="var(--rule)"/>
<text x="220" y="42" text-anchor="middle" fill="var(--ink-faint)" font-size="11">等于</text>
<rect x="250" y="30" width="200" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="350" y="55" text-anchor="middle" fill="var(--ink)">Ticket.summary(t1)</text>
<line x1="420" y1="70" x2="420" y2="105" stroke="var(--compute)"/>
<rect x="250" y="105" width="370" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="265" y="130" fill="var(--ink)">def summary(self):   # self 就是 t1</text>
<text x="20" y="110" fill="var(--ink-soft)" font-size="11">点号前面的对象</text>
<text x="20" y="128" fill="var(--ink-soft)" font-size="11">自动变成第一个参数</text>
</g>
</svg>
<figcaption>Python 的 self 和 JS 的 this 是同一个东西,区别只在 Python 要你在参数列表里写出来。</figcaption>
</figure>

## 第三步:三种忘了 self 的报错

刚学 class 时,90% 的错都和 self 有关。一次全演示出来。新建 `part01/forgot_self.py`:

```python
# agent-zero-lab/part01/forgot_self.py
class Ticket:
    def __init__(self, id: str, title: str):
        self.id = id
        title = title

    def summary():
        return "我忘了写 self"


t = Ticket("T-1001", "发票抬头开错了")
print(vars(t))
try:
    print(t.title)
except AttributeError as e:
    print("AttributeError:", e)
try:
    t.summary()
except TypeError as e:
    print("TypeError:", e)
Ticket("T-1002")
```

<div class="line-notes">

- `self.id = id` 这一行是对的。
- `title = title` 错误一:少写了 `self.`。这一行只是把参数 title 赋值给它自己,一个函数里的局部变量,`__init__` 一结束就没了,对象身上什么也没留下。
- `def summary():` 错误二:方法的参数列表里没写 self。
- `t = Ticket("T-1001", "发票抬头开错了")` 造对象。这一步不会报错。
- `print(vars(t))` `vars(对象)` 把对象身上的所有属性以字典的形式列出来,排查这类问题特别好用。实测 `{'id': 'T-1001'}`,只有 id,没有 title,证明 title 没存上。
- `print(t.title)` 去读不存在的属性。
- `print("AttributeError:", e)` 实测 `AttributeError: 'Ticket' object has no attribute 'title'`。注意这次没有 `Did you mean`,因为对象身上压根没有任何相近的名字。
- `t.summary()` 调一个没写 self 的方法。Python 照例把 t 塞进去当第一个参数,可这个方法一个参数都不收。
- `print("TypeError:", e)` 实测 `TypeError: Ticket.summary() takes 0 positional arguments but 1 was given`,「summary 收 0 个参数,却给了 1 个」。你明明一个参数都没传,那「1 个」就是 Python 自动塞的 self。
- `Ticket("T-1002")` 错误三:造对象时少传了 title。不包 try,让它崩。

</div>

实测输出:

```text
{'id': 'T-1001'}
AttributeError: 'Ticket' object has no attribute 'title'
TypeError: Ticket.summary() takes 0 positional arguments but 1 was given
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/forgot_self.py", line 21, in <module>
    Ticket("T-1002")
TypeError: Ticket.__init__() missing 1 required positional argument: 'title'
```

三条报错和它们的病因,背下来能省很多时间:

| 报错 | 病因 |
| --- | --- |
| `'Ticket' object has no attribute 'title'` | `__init__` 里写成了 `title = title`,少了 `self.` |
| `takes 0 positional arguments but 1 was given` | 方法定义时少写了 self |
| `__init__() missing 1 required positional argument: 'title'` | 造对象时少传了参数(数参数时不算 self) |

第二条最迷惑人,「我没传参数,它说我传了 1 个」,看到 `but 1 was given` 比你以为的多一个,先去看方法有没有写 self。这三个错 basedpyright 也都能提前标出来,我实测它对这个文件报了 3 个 error 和 1 个 warning,warning 那条是第 7 行的 `Instance methods should take a "self" parameter`(实例方法应该有 self 参数),所以编辑器里的红线和黄线都别忽略。

## 第四步:会改状态的方法

方法除了读属性,还能改属性。这正是把数据和操作放在一起的意义:「关闭工单」不再是一个到处传字典的函数,而是工单自己的能力。新建 `part01/ticket_methods.py`:

```python
# agent-zero-lab/part01/ticket_methods.py
class Ticket:
    def __init__(self, id: str, title: str, amount: float):
        self.id = id
        self.title = title
        self.amount = amount
        self.status = "open"
        self.tags: list[str] = []

    def add_tag(self, tag: str) -> None:
        if tag not in self.tags:
            self.tags.append(tag)

    def close(self) -> None:
        self.status = "closed"

    def is_big(self, limit: float = 300) -> bool:
        return self.amount >= limit


a = Ticket("T-1001", "发票抬头开错了", 199)
b = Ticket("T-1005", "升级套餐", 399)

a.add_tag("invoice")
a.add_tag("invoice")
a.add_tag("urgent")
b.close()

print(a.id, a.status, a.tags)
print(b.id, b.status, b.tags)
print(a.is_big(), b.is_big(), a.is_big(limit=100))
print(vars(a))
```

<div class="line-notes">

- `self.status = "open"` 属性不一定都来自参数。状态一开始都是 open,不用调用方传。
- `self.tags: list[str] = []` 每张工单一个标签列表。这里给属性加了类型标注,告诉编辑器「这是装字符串的列表」。**空列表写在 `__init__` 的函数体里**,每造一个对象就新建一个列表,所以 a 和 b 的 tags 互不相干。如果写成参数默认值 `tags=[]`,就会掉进 Day 29 的可变默认值陷阱,练习 3 会演示。
- `def add_tag(self, tag: str) -> None:` 除了 self,方法还能收别的参数,和普通函数一样。
- `if tag not in self.tags:` 已经有了就不重复加。
- `self.tags.append(tag)` 改的是 self 身上的列表,也就是调用这个方法的那张工单。
- `def close(self) -> None:` 关闭工单。不返回东西,作用是改状态。
- `self.status = "closed"` 改属性。
- `def is_big(self, limit: float = 300) -> bool:` 方法参数也能有默认值(Day 29)。
- `return self.amount >= limit` 金额达到上限算大额。
- `a.add_tag("invoice")` 给 a 加标签。
- `a.add_tag("invoice")` 重复加一次,会被 if 挡住。
- `a.add_tag("urgent")` 再加一个不同的。
- `b.close()` 只关 b。
- `print(a.id, a.status, a.tags)` 实测 `T-1001 open ['invoice', 'urgent']`,invoice 只出现一次。
- `print(b.id, b.status, b.tags)` 实测 `T-1005 closed []`。b 被关了,a 没受影响;a 加的标签也没跑到 b 身上。
- `print(a.is_big(), b.is_big(), a.is_big(limit=100))` 实测 `False True True`。199 不到 300,399 到了;把上限改成 100,199 也算大额。
- `print(vars(a))` 实测 `{'id': 'T-1001', 'title': '发票抬头开错了', 'amount': 199, 'status': 'open', 'tags': ['invoice', 'urgent']}`。看到没,对象的属性在内部其实就是存在一个字典里,vars 把它拿了出来。

</div>

实测输出:

```text
T-1001 open ['invoice', 'urgent']
T-1005 closed []
False True True
{'id': 'T-1001', 'title': '发票抬头开错了', 'amount': 199, 'status': 'open', 'tags': ['invoice', 'urgent']}
```

`vars(a)` 那一行值得多看一眼:对象的属性底下就是一个字典,类做的事是给这个字典加上「固定有哪些键」的约定,再把操作它的函数(方法)挂在旁边。所以别把类想得太玄,它和你会的字典离得很近。

## 把零件拼起来:Ticket 类存成 JSON

最后把 Day 36 的校验、昨天的 JSON 和今天的类拼起来:造 Ticket 时就校验,不合格直接抛 TicketError,根本造不出坏工单;再写 `to_dict` 让对象能存成 JSON,写 `ticket_from_dict` 把 JSON 读回成对象。新建 `part01/ticket_model.py`:

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
        if amount < 0:
            raise TicketError(f"{id} 金额不能是负数: {amount}")
        self.id = id
        self.title = title
        self.amount = amount
        self.status = status

    def close(self) -> None:
        self.status = "closed"

    def summary(self) -> str:
        return f"[{self.status}] {self.id} {self.title} ¥{self.amount}"

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "title": self.title, "amount": self.amount, "status": self.status}


def ticket_from_dict(d: dict[str, Any]) -> Ticket:
    return Ticket(d["id"], d["title"], d["amount"], d.get("status", "open"))


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

    for t in load(DATA):
        print(t.summary())
    print(DATA.read_text(encoding="utf-8"))

    try:
        Ticket("T-1002", "申请退款", -50)
    except TicketError as e:
        print("没造出来:", e)

    json.dumps(tickets[0])
```

<div class="line-notes">

- `DATA = Path(__file__).resolve().parent / "data" / "tickets_v2.json"` 换个文件名,不和昨天的 `tickets.json` 混在一起。
- `class TicketError(Exception):` 注意这一行也是 class。Day 36 写的自定义异常,本身就是一个类,括号里的 `Exception` 表示它从 Exception 继承而来,继承是 [Day 42](/blog/agent-zero/day-042-classes-2/) 的内容。
- `def __init__(self, id: str, title: str, amount: float, status: str = "open"):` 多了一个带默认值的 status,读回已关闭的工单时要用。
- `if title.strip() == "":` 校验放进构造方法。和 Day 36 的 `check_ticket` 一样的检查,只是位置变了。
- `raise TicketError(f"{id} 标题是空的")` 在 `__init__` 里 raise,对象就造不出来,调用方拿到的是异常而不是一个坏对象。
- `if amount < 0:` 金额检查。因为昨天开始金额已经是数字了,不再需要 `float()` 转换那一段。
- `raise TicketError(f"{id} 金额不能是负数: {amount}")` 后面 T-1002 的 -50 会在这里被拦下。
- `self.id = id` 校验都过了才存属性。
- `def close(self) -> None:` 第四步的老朋友。
- `def summary(self) -> str:` 摘要前面加上状态。
- `def to_dict(self) -> dict[str, Any]:` 对象 → 字典。json.dumps 不认识 Ticket,但认识字典,这个方法就是桥。
- `return {"id": self.id, "title": self.title, "amount": self.amount, "status": self.status}` 把四个属性装进字典。tickets[0] 关闭后返回 `{'id': 'T-1001', 'title': '发票抬头开错了', 'amount': 199, 'status': 'closed'}`。
- `def ticket_from_dict(d: dict[str, Any]) -> Ticket:` 反方向:字典 → 对象。它写在类外面,是个普通函数。把它挂到类上的写法叫类方法,Day 43 学。
- `return Ticket(d["id"], d["title"], d["amount"], d.get("status", "open"))` 用字典里的值造一个 Ticket。`d.get("status", "open")` 是 Day 24 学的,没有 status 键时用 open。读回来的数据也会过一遍 `__init__` 的校验,有人把文件里的金额改成负数,读的时候就会被拦下。
- `def save(path: Path, tickets: list[Ticket]) -> None:` 参数类型可以写成 `list[Ticket]`,自己的类也能当类型用。
- `data = [t.to_dict() for t in tickets]` 推导式:每个对象变成字典。
- `path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")` 昨天第五步末尾的一行写法。
- `def load(path: Path) -> list[Ticket]:` 读回来,返回 Ticket 列表而不是字典列表。
- `data = json.loads(path.read_text(encoding="utf-8"))` 一行读完再解析。
- `return [ticket_from_dict(d) for d in data]` 每个字典变成 Ticket。
- `if __name__ == "__main__":` Day 32 学的:下面这段只在直接运行这个文件时执行,被别的文件 import 时不执行。练习 4 要从别的文件 import Ticket,所以这里提前加上。
- `tickets = [Ticket("T-1001", "发票抬头开错了", 199), Ticket("T-1005", "升级套餐", 399)]` 两张合格工单。
- `tickets[0].close()` 关掉第一张。
- `save(DATA, tickets)` 存。
- `for t in load(DATA):` 读回来的已经是 Ticket 对象了。
- `print(t.summary())` 能直接调方法。实测 `[closed] T-1001 发票抬头开错了 ¥199` 和 `[open] T-1005 升级套餐 ¥399`,关闭状态存下来又读回来了。
- `print(DATA.read_text(encoding="utf-8"))` 看文件原样,是一个带缩进的 JSON 数组。
- `Ticket("T-1002", "申请退款", -50)` 造一张负数金额的工单。
- `print("没造出来:", e)` 实测 `没造出来: T-1002 金额不能是负数: -50`。
- `json.dumps(tickets[0])` 故意直接 dumps 一个 Ticket 对象,看看不写 to_dict 会怎样。

</div>

```bash
uv run python part01/ticket_model.py
```

实测输出:

```text
[closed] T-1001 发票抬头开错了 ¥199
[open] T-1005 升级套餐 ¥399
[
  {
    "id": "T-1001",
    "title": "发票抬头开错了",
    "amount": 199,
    "status": "closed"
  },
  {
    "id": "T-1005",
    "title": "升级套餐",
    "amount": 399,
    "status": "open"
  }
]
没造出来: T-1002 金额不能是负数: -50
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/ticket_model.py", line 62, in <module>
    json.dumps(tickets[0])
  ...
TypeError: Object of type Ticket is not JSON serializable
```

最后的报错昨天见过,当时是集合,今天是自己写的类:json 模块只认识字典、列表、字符串、数字、布尔和 None。所以写类的时候,凡是要存文件、要发给接口、要传给模型的,都配一个 `to_dict`。这件事很烦,而且 to_dict 和 `__init__` 里的字段名得手动保持一致,加一个字段要改三处。[Day 50](/blog/agent-zero/day-050-dataclass/) 的 dataclass 和 [Day 51](/blog/agent-zero/day-051-pydantic-1/) 的 pydantic 就是来解决这个麻烦的,pydantic 一个 `model_dump()` 就替你干了 to_dict 的活,校验也写成字段声明。但它们的底子都是今天的 class,先把这一层弄明白。

零件对照:

| 前面的零件 | 在 ticket_model.py 里是哪一段 |
| --- | --- |
| 第一步 class + `__init__` + `self.x = x` | `class Ticket` 和它的构造方法 |
| 第二步 方法里用 self 读属性 | `summary`、`to_dict` |
| 第四步 改状态的方法 | `close` |
| Day 36 TicketError | `__init__` 里的两道校验 |
| Day 39 json.dumps / loads | `save` 和 `load` |
| Day 32 `__name__ == "__main__"` | 最下面的演示代码 |

## 动手练习

**练习 1:客户类。** 写一个 `Customer` 类:造的时候传公司名和套餐(套餐默认 `"free"`);有一个 `history` 列表记录用过的所有套餐,一开始只有初始套餐;`upgrade(new_plan)` 换套餐并记进历史;`describe()` 返回一句描述。造两个客户,一个从 free 升到 pro 再升到 enterprise,一个一开始就是 pro,打印两人的描述。文件名 `part01/ex40_customer.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex40_customer.py
class Customer:
    def __init__(self, name: str, plan: str = "free"):
        self.name = name
        self.plan = plan
        self.history: list[str] = [plan]

    def upgrade(self, new_plan: str) -> None:
        self.plan = new_plan
        self.history.append(new_plan)

    def describe(self) -> str:
        return f"{self.name} 当前 {self.plan},历史 {' -> '.join(self.history)}"


a = Customer("北辰科技")
b = Customer("南山工作室", "pro")
a.upgrade("pro")
a.upgrade("enterprise")
print(a.describe())
print(b.describe())
```

<div class="line-notes">

- `def __init__(self, name: str, plan: str = "free"):` 套餐有默认值,不传就是 free。
- `self.history: list[str] = [plan]` 历史列表在函数体里新建,初始内容就是开局套餐。
- `def upgrade(self, new_plan: str) -> None:` 换套餐。
- `self.plan = new_plan` 改当前套餐。
- `self.history.append(new_plan)` 记进历史。
- `return f"{self.name} 当前 {self.plan},历史 {' -> '.join(self.history)}"` `' -> '.join(列表)` 是 Day 16 的 join,用箭头把历史串起来。f-string 外面是双引号,里面的分隔符用单引号,避免冲突。
- `a = Customer("北辰科技")` 只传名字,套餐用默认的 free。
- `b = Customer("南山工作室", "pro")` 一开始就是 pro。
- `a.upgrade("pro")` a 升两次。
- `print(a.describe())` 实测 `北辰科技 当前 enterprise,历史 free -> pro -> enterprise`。
- `print(b.describe())` 实测 `南山工作室 当前 pro,历史 pro`,a 的升级没影响 b。

</div>

实测输出:

```text
北辰科技 当前 enterprise,历史 free -> pro -> enterprise
南山工作室 当前 pro,历史 pro
```

</details>

**练习 2:类别计数器。** 写一个 `CategoryCounter` 类,内部用一个字典记每个类别出现了几次;`add(category)` 计数加一,`top()` 返回次数最多的类别。用 `["billing", "refund", "billing", "login", "billing", "refund"]` 测试。文件名 `part01/ex40_counter.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex40_counter.py
class CategoryCounter:
    def __init__(self):
        self.counts: dict[str, int] = {}

    def add(self, category: str) -> None:
        self.counts[category] = self.counts.get(category, 0) + 1

    def top(self) -> str:
        return max(self.counts, key=lambda c: self.counts[c])


counter = CategoryCounter()
for c in ["billing", "refund", "billing", "login", "billing", "refund"]:
    counter.add(c)
print(counter.counts)
print("最多的类别:", counter.top())
```

<div class="line-notes">

- `def __init__(self):` 构造方法可以只有 self,造的时候什么都不用传:`CategoryCounter()`。
- `self.counts: dict[str, int] = {}` 每个计数器有自己的空字典。
- `self.counts[category] = self.counts.get(category, 0) + 1` Day 24 的计数写法:没有就从 0 开始,再加 1。
- `return max(self.counts, key=lambda c: self.counts[c])` `max` 遍历字典的键,`key=` 告诉它按什么比大小,这里按次数比。lambda 是 [Day 30](/blog/agent-zero/day-030-functions-3/) 学的匿名函数,相当于 JS 的 `c => this.counts[c]`。
- `counter = CategoryCounter()` 造一个计数器。
- `counter.add(c)` 逐个加。
- `print(counter.counts)` 实测 `{'billing': 3, 'refund': 2, 'login': 1}`。
- `print("最多的类别:", counter.top())` 实测 `最多的类别: billing`。

</div>

实测输出:

```text
{'billing': 3, 'refund': 2, 'login': 1}
最多的类别: billing
```

</details>

**练习 3:观察会发生什么。** 下面的 Ticket 把 tags 写成了参数默认值。先猜两个 print 的结果,再新建 `part01/ex40_shared.py` 跑一下,然后自己修好。

```python
# agent-zero-lab/part01/ex40_shared.py
class Ticket:
    def __init__(self, id: str, tags: list[str] = []):
        self.id = id
        self.tags = tags


a = Ticket("T-1001")
b = Ticket("T-1002")
a.tags.append("urgent")
print(a.tags, b.tags)
print(a.tags is b.tags)
```

<div class="line-notes">

- `def __init__(self, id: str, tags: list[str] = []):` 默认值 `[]` 只在定义函数时创建**一次**,之后每次不传 tags 都用的是同一个列表。
- `self.tags = tags` a 和 b 都没传 tags,所以它们的 `self.tags` 指向同一个列表。
- `a.tags.append("urgent")` 只给 a 加。
- `print(a.tags, b.tags)` 实测 `['urgent'] ['urgent']`,b 也有了。
- `print(a.tags is b.tags)` `is` 判断两个名字是不是指向同一个对象,实测 `True`。

</div>

<details><summary>参考答案</summary>

实测输出:

```text
['urgent'] ['urgent']
True
```

这就是 [Day 29](/blog/agent-zero/day-029-functions-2/) 的可变默认值陷阱,放进 `__init__` 里危害更大:所有没传 tags 的工单共用一个列表,给一张加标签,其他工单全跟着变。修法和 Day 29 一样,默认值用 None,在函数体里新建列表:

```python
# agent-zero-lab/part01/ex40_shared_fixed.py
class Ticket:
    def __init__(self, id: str, tags: list[str] | None = None):
        self.id = id
        self.tags = tags if tags is not None else []


a = Ticket("T-1001")
b = Ticket("T-1002")
a.tags.append("urgent")
print(a.tags, b.tags)
print(a.tags is b.tags)
```

<div class="line-notes">

- `def __init__(self, id: str, tags: list[str] | None = None):` `list[str] | None` 读作「字符串列表或者 None」,这种 `|` 写法 [Day 46](/blog/agent-zero/day-046-type-hints-2/) 细讲。默认值换成 None,None 不可变,共用也没关系。
- `self.tags = tags if tags is not None else []` 没传就当场新建一个空列表,每次调用都是新的。
- `print(a.tags, b.tags)` 实测 `['urgent'] []`。
- `print(a.tags is b.tags)` 实测 `False`。

</div>

实测输出:

```text
['urgent'] []
False
```

正文第四步那种「参数里不收 tags,直接在函数体里 `self.tags = []`」也是对的,看你需不需要让调用方传初始标签。

</details>

**练习 4:批量造工单。** 从 `ticket_model.py` 里 import `Ticket` 和 `TicketError`,用下面四行数据批量造 Ticket,不合格的打印原因并跳过,最后打印合格张数和金额合计。文件名 `part01/ex40_batch.py`,和 `ticket_model.py` 放在同一个目录。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex40_batch.py
from ticket_model import Ticket, TicketError

rows = [
    {"id": "T-1001", "title": "发票抬头开错了", "amount": 199},
    {"id": "T-1002", "title": "申请退款", "amount": -50},
    {"id": "T-1003", "title": "  ", "amount": 80},
    {"id": "T-1005", "title": "升级套餐", "amount": 399},
]

good: list[Ticket] = []
for row in rows:
    try:
        good.append(Ticket(row["id"], row["title"], row["amount"]))
    except TicketError as e:
        print("跳过:", e)

print(len(good), "张合格")
print("合计:", sum(t.amount for t in good))
```

<div class="line-notes">

- `from ticket_model import Ticket, TicketError` Day 32 的 from import。`uv run python part01/ex40_batch.py` 运行时,Python 会在脚本所在的 `part01/` 里找 `ticket_model.py`,所以能找到。因为 ticket_model 的演示代码包在 `if __name__ == "__main__":` 里,import 时不会执行,也就不会触发它最后那个故意的崩溃。
- `rows = [` 四行数据,和 Day 36 的样本类似,金额已经是数字。
- `good: list[Ticket] = []` 合格工单的列表,类型是「Ticket 组成的列表」。
- `good.append(Ticket(row["id"], row["title"], row["amount"]))` 造对象。如果 `__init__` 抛了 TicketError,`Ticket(...)` 这个调用就没有结果,append 也不会发生。
- `except TicketError as e:` 接住。
- `print("跳过:", e)` 实测两行:`跳过: T-1002 金额不能是负数: -50`、`跳过: T-1003 标题是空的`。
- `print(len(good), "张合格")` 实测 `2 张合格`。
- `print("合计:", sum(t.amount for t in good))` 用点号取金额,实测 `合计: 598`,和 Day 36 的 598.0 是同一批合格工单(那天金额是 float 所以带 .0)。

</div>

实测输出:

```text
跳过: T-1002 金额不能是负数: -50
跳过: T-1003 标题是空的
2 张合格
合计: 598
```

和 Day 36 的 `process_batch` 比一下:那天要先造字典、再调 `check_ticket` 校验;今天校验长在 Ticket 身上,「造出来」本身就等于「校验通过」。手里拿着一个 Ticket,就不用再怀疑它的金额是不是负数。

</details>

验收标准:四个练习的输出和上面一致;不看文章能写出带 `__init__` 和一个方法的类;能用一句话解释 `t.summary()` 和 `Ticket.summary(t)` 的关系;看到 `takes 0 positional arguments but 1 was given` 能马上想到「方法少了 self」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 类(class) | 一张图纸,规定这类对象有哪些属性、能做哪些事。`class Ticket:` |
| 实例(instance) | 照着类造出来的一个具体对象。`t1 = Ticket(...)` 里的 t1 |
| 对象(object) | Python 里一切值都是对象;今天主要指类的实例 |
| `__init__` | 构造方法,造对象时自动调用,≈ JS 的 `constructor` |
| self | 方法的第一个参数,代表调用这个方法的那个对象,≈ JS 的 `this`,但必须写出来 |
| 属性(attribute) | 存在对象身上的数据,`self.title = title` 设置,`t.title` 读取 |
| 方法(method) | 定义在类里的函数,第一个参数是 self |
| 魔术方法(dunder) | 前后各两个下划线的方法,如 `__init__`,Python 在特定时刻自动调用 |
| AttributeError | 访问对象上不存在的属性时的异常 |
| isinstance | 判断一个值是不是某个类的实例 |
| vars | `vars(对象)` 以字典形式列出对象的全部属性 |
| to_dict | 自己写的「对象 → 字典」方法,让对象能被 json.dumps |
| is | 判断两个名字是否指向同一个对象(而不只是内容相同) |

## 常见误区

**`__init__` 里忘了写 `self.`。** 写成 `title = title`,不报错,但属性没存上,之后读 `t.title` 实测报 `AttributeError: 'Ticket' object has no attribute 'title'`。用 `vars(t)` 一看就知道少了哪个。

**方法定义里忘了写 self。** 实测报 `TypeError: Ticket.summary() takes 0 positional arguments but 1 was given`。那个「1」是 Python 自动塞进去的对象本身。

**造对象时把 self 也算进参数个数。** `__init__(self, id, title)` 造对象时只传两个:`Ticket("T-1001", "标题")`。少传一个实测报 `missing 1 required positional argument: 'title'`。

**把可变的默认值写在 `__init__` 的参数里。** `tags=[]` 让所有实例共用一个列表,实测给 a 加标签后 b 也有了,`a.tags is b.tags` 是 True。默认值用 None,在函数体里新建。

**以为 json.dumps 能直接存对象。** 实测报 `TypeError: Object of type Ticket is not JSON serializable`。先 `to_dict()` 再 dumps,读回来再用字典造对象。

**直接 print 对象想看内容。** 只会看到 `<__main__.Ticket object at 0x10e8e7530>`。临时看用 `vars(t)`,长期的办法是 Day 43 的 `__repr__`。

**觉得类太重,什么都想写成类。** 一次性的脚本、只是装一下数据的地方,字典完全够用。数据有固定字段、有校验规则、有一组跟着它走的操作(比如工单的关闭、打标签),才值得写成类。

## 学习资料

### 文档与文章

- [Python 官方教程 · 9. 类(中文)](https://docs.python.org/zh-cn/3.12/tutorial/classes.html):看 9.3「初探类」这一节就够了,类对象、实例对象、方法对象三个小节正好是今天的三步,后面的继承留到 Day 42。
- [MDN · 类](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Classes):你熟悉的 JS 这一边,对照着看 constructor 和方法的写法。
- [菜鸟教程 · Python3 面向对象](https://www.runoob.com/python3/python3-class.html):中文速查,`self 代表类的实例,而非类` 那一段和第二步讲的是同一件事。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV17e4y1r7wd&autoplay=0&high_quality=1" title="python自定义类class是什么?init和self的作用?什么是面向对象的编程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>啥都发的小c · python自定义类class是什么?init和self的作用? · 约 10 分钟,专门讲 __init__ 和 self,和今天第一、二步对应。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1B7WgeyE2Y&autoplay=0&high_quality=1" title="【中配】Python中的'self'是什么:简单解释 - Indently" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>黑纹白斑马 · 【中配】Python中的'self'是什么:简单解释 - Indently · 6 分钟,Indently 的中文配音版,把 self 就是实例本身这件事演示得很直白。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1WQtmzcEn9&autoplay=0&high_quality=1" title="7 分钟搞懂 Python 对象和类!零基础也能秒会" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>水哥澎湃 · 7 分钟搞懂 Python 对象和类!零基础也能秒会 · 实际约 17 分钟,2025 年的视频,类和对象的关系讲得慢,适合第一遍没懂的时候看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/ZDa-Z5JzLYM" title="Python OOP Tutorial 1: Classes and Instances" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python OOP Tutorial 1: Classes and Instances · 英文,经典的面向对象第一集,讲到 `Employee.fullname(emp_1)` 那段就是今天第二步的 `Ticket.summary(t1)`。</figcaption>
</figure>

### 书籍

- 《Python 编程:从入门到实践(第 3 版)》,Eric Matthes 著,人民邮电出版社。第 9 章「类」,前两节「创建和使用类」「使用类和实例」对应今天,用的例子是小狗和汽车,很适合 0 基础。
- 《流畅的 Python(第 2 版)》,Luciano Ramalho 著,人民邮电出版社。现在不用读,等第一部分学完,想弄懂「Python 的对象到底是怎么回事」时再翻它讲数据模型的第 1 章。

### 开源项目与代码

- [python-dotenv 的 `main.py`](https://github.com/theskumar/python-dotenv/blob/main/src/dotenv/main.py):Day 38 看过它的 `with open`,今天再看文件开头的 `class DotEnv:`。它的 `__init__` 收 `dotenv_path` 等几个参数,存成 `self.dotenv_path`;下面的 `def dict(self)`、`def get(self, key)` 都是用 self 读自己的属性。整个结构和今天的 Ticket 一模一样,只是多了几个参数。

## 自测

1. 下面代码打印什么?

```python
class Box:
    def __init__(self, n: int):
        self.n = n

    def double(self) -> int:
        return self.n * 2


a = Box(3)
b = Box(5)
a.n = 10
print(a.double(), b.double())
```

<details><summary>答案</summary>

`20 10`。a 和 b 各有自己的 n,把 a.n 改成 10 不影响 b,`a.double()` 是 20,`b.double()` 是 10。

</details>

2. `t.close()` 在 Python 内部等价于哪种写法?close 方法里的 self 是谁?

<details><summary>答案</summary>

等价于 `Ticket.close(t)`,self 就是 t。Python 把点号前面的对象自动作为第一个参数传进方法。

</details>

3. 运行时看到 `TypeError: Ticket.add_tag() takes 1 positional argument but 2 were given`,你调用的是 `t.add_tag("urgent")`。问题出在哪?

<details><summary>答案</summary>

`add_tag` 定义时少写了 self,写成了 `def add_tag(tag):`。调用时 Python 传了两个参数(t 本身和 "urgent"),方法只收一个。改成 `def add_tag(self, tag):`。

</details>

4. 为什么 ticket_model.py 要把校验写在 `__init__` 里,而不是像 Day 36 那样单独写一个 check_ticket 函数?

<details><summary>答案</summary>

写在 `__init__` 里,不合格的数据根本造不出 Ticket 对象,程序里任何地方拿到的 Ticket 都一定是合格的,不用每次用之前再检查一遍;单独的 check 函数要靠每个调用方记得去调,忘了一处就会有坏数据混进来。从 JSON 读回来时也会经过 `__init__`,文件被人改坏了也能拦下。

</details>

5. 面试题:在 Agent 项目里,什么时候你会用类而不是字典来表示数据?举一个例子。

<details><summary>答案</summary>

数据有固定字段、需要校验、并且有一组跟着它走的操作时用类。比如一次 Agent 运行的会话:有固定的 messages 列表、token 计数、状态,有「追加一条消息」「统计花费」「是否超过轮数上限」这些操作,写成类能保证字段不拼错、操作集中在一处、编辑器能提示。从模型或接口进来的数据边界上,一般用 pydantic 这类基于类的模型做校验;只是函数内部临时拼一下、马上就转成 JSON 发出去的数据,用字典就够。

</details>

## 明天预告

[Day 41 · 第 6 周复习:编程地基(Day 35–40)](/blog/agent-zero/day-041-week06-review/)。这周从异常一路学到类,零件已经够拼一个像样的小工具了。明天把 try/except、raise、finally、pathlib、with、JSON 和今天的 Ticket 类串成一张图,默写三段核心代码,再只用本周学过的东西写一个「工单目录体检」脚本。
