---
title: 'Day 42 · 类(二):继承和组合'
description: '你在 Day 36 写的 class TicketError(Exception) 就是继承。今天对照 JS 的 extends 和 super,写邮件和短信两种通知渠道类,演示忘了 super().__init__ 和子类没实现方法时的真实报错;再看一个「工单继承邮件通知器」的错误设计,用组合把它改对。'
pubDate: 2026-10-22
regime: none
tags: ['python', 'classes', 'agent-zero']
series: 'agent-zero'
day: 42
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 41](/blog/agent-zero/day-041-week06-review/) 是第 6 周复习:默写了 `check_ticket`、带 try 的 JSON 读写和 Ticket 类,又拼出 `ticket_checkup.py`,把一个混着坏文件的 `inbox/` 目录查了一遍,三个合格、四个坏的,每个坏文件都说清了原因。

那个脚本里有一行一直没细讲:`ticket_model.py` 开头的 `class TicketError(Exception): pass`。括号里写了个 `Exception`,类体只有一个 `pass`,可它能被 raise、能被 except 接住、还能带一句错误信息。这些本事是从哪来的?答案就是今天的第一个概念,**继承**。第二个概念是**组合**,它解决的是「继承用错了地方」之后的麻烦。

## 今天要解决的问题

学完今天,你应该能:

1. 写一个父类和两个子类,说清子类从父类「白拿」了什么、自己又改了什么(重写)。
2. 在子类的 `__init__` 里正确调用 `super().__init__(...)`,并认出忘了调用时那条 `AttributeError`。
3. 把一组不同子类的对象放进同一个列表,用同一句 `ch.send(t)` 调用它们;认出子类忘了实现方法时的 `NotImplementedError`。
4. 用「是一个」和「有一个」两句话判断该用继承还是组合,并把一个用错继承的设计改成组合。

预计用时:2.5 小时。前置:[Day 36](/blog/agent-zero/day-036-exceptions-2/) 的自定义异常、[Day 15](/blog/agent-zero/day-015-strings-1/) 的切片和 f-string、[Day 32](/blog/agent-zero/day-032-modules/) 的 import、[Day 40](/blog/agent-zero/day-040-classes-1/) 的 class / `__init__` / self。

学法:先对照文章逐行敲一遍(不要复制粘贴)并跑通;第二天合上文章,把最后的 `notifiers.py` 默写出来;再做动手练习,做不出来再展开参考答案,看完关掉自己重写一遍。

命令都在项目根目录 `agent-zero-lab` 里跑,新文件放进 `part01/`,会 import [Day 40](/blog/agent-zero/day-040-classes-1/) 建的 `part01/ticket_model.py`(里面有 `Ticket`、`TicketError`、`ticket_from_dict`)。今天不装新依赖,不调 API,花费 0 元。

## 先拆开你已经用过的继承

新建 `part01/inherit_exception.py`,看看 TicketError 身上到底有什么:

```python
# agent-zero-lab/part01/inherit_exception.py
import json

from ticket_model import TicketError

print(issubclass(TicketError, Exception))
print(TicketError.__bases__)

err = TicketError("T-1002 金额不能是负数: -50")
print(isinstance(err, TicketError), isinstance(err, Exception))
print(err.args)

try:
    raise err
except Exception as e:
    print("被 except Exception 接住了:", type(e).__name__, e)

print(issubclass(json.JSONDecodeError, ValueError))
try:
    json.loads("{'id': 'T-1001'}")
except ValueError as e:
    print("被 except ValueError 接住了:", type(e).__name__)
```

<div class="line-notes">

- `from ticket_model import TicketError` Day 40 的 `ticket_model.py`,演示代码包在 `if __name__ == "__main__":` 里,import 时不会执行。
- `print(issubclass(TicketError, Exception))` `issubclass(子, 父)` 问「前一个类是不是后一个类的**子类**」。实测 `True`。它和 Day 40 学的 `isinstance` 是一对:isinstance 问对象,issubclass 问类。
- `print(TicketError.__bases__)` 每个类都有 `__bases__`,记着它的直接父类。实测 `(<class 'Exception'>,)`,括号加逗号是 [Day 22](/blog/agent-zero/day-022-tuples-unpack/) 学的元组,只有一个元素。
- `err = TicketError("T-1002 金额不能是负数: -50")` 造一个异常对象。注意我们的 TicketError 里**没有写** `__init__`,可它照样收了一个参数。
- `print(isinstance(err, TicketError), isinstance(err, Exception))` 实测 `True True`。err 既是 TicketError,也算 Exception。
- `print(err.args)` 实测 `('T-1002 金额不能是负数: -50',)`。`args` 这个属性我们从没写过,它来自父类 Exception 的 `__init__`:没写的东西去父类找,这就是继承。
- `except Exception as e:` 只写了接 Exception,可抛出来的是 TicketError。
- `print("被 except Exception 接住了:", type(e).__name__, e)` 实测 `被 except Exception 接住了: TicketError T-1002 金额不能是负数: -50`。`type(e).__name__` 取对象所属类的名字。except 写父类,子类的异常也会被接住。
- `print(issubclass(json.JSONDecodeError, ValueError))` Day 39 天天打交道的 JSONDecodeError,实测 `True`,它是 ValueError 的子类。
- `json.loads("{'id': 'T-1001'}")` 单引号的假 JSON,会抛 JSONDecodeError。
- `print("被 except ValueError 接住了:", type(e).__name__)` 实测 `被 except ValueError 接住了: JSONDecodeError`。

</div>

```bash
uv run python part01/inherit_exception.py
```

实测输出:

```text
True
(<class 'Exception'>,)
True True
('T-1002 金额不能是负数: -50',)
被 except Exception 接住了: TicketError T-1002 金额不能是负数: -50
True
被 except ValueError 接住了: JSONDecodeError
```

**继承**说白了就是:写一个新类时,在括号里指定一个已有的类,新类自动拥有那个类的全部属性和方法,你只写不一样的部分。被继承的叫**父类**(也叫基类),新写的叫**子类**。子类的对象同时也「算」父类的对象,所以 `except Exception` 能接住 TicketError,`except ValueError` 能接住 JSONDecodeError。

最后两行顺便解开了一个小疑惑:Python 标准库里的 JSONDecodeError 就是这么写的,源码是 `class JSONDecodeError(ValueError):`,学习资料里给了链接。

和 JS 对一下:

| JS / TS | Python | 说明 |
| --- | --- | --- |
| `class TicketError extends Error {}` | `class TicketError(Exception): pass` | 父类写在括号里,不用 extends |
| `super(...)` 在 constructor 里 | `super().__init__(...)` | 调父类的构造方法,第二步细讲 |
| `super.method()` | `super().method()` | 调父类的同名方法,练习 2 用到 |
| `err instanceof Error` | `isinstance(err, Exception)` | 子类对象也算父类的实例 |
| 一个类只能 extends 一个 | 括号里可以写多个 | 第四步会看到写两个的后果 |

## 第一步:父类和子类

场景:工单关掉以后要通知客户。有的客户留了邮箱,有的留了手机号,所以有邮件和短信两种渠道。它们有共同的部分(要发给谁、拼一句通知文字、记下发过什么),也有不同的部分(短信有字数限制)。共同的部分写进父类,不同的部分写进子类。

新建 `part01/notify_step1.py`:

```python
# agent-zero-lab/part01/notify_step1.py
class Notifier:
    def __init__(self, to: str):
        self.to = to
        self.sent: list[str] = []

    def format(self, ticket_id: str, title: str) -> str:
        return f"工单 {ticket_id}「{title}」已处理"

    def send(self, ticket_id: str, title: str) -> None:
        text = self.format(ticket_id, title)
        self.sent.append(text)
        print(f"  [通知] 发给 {self.to}: {text}")


class EmailNotifier(Notifier):
    pass


class SmsNotifier(Notifier):
    def send(self, ticket_id: str, title: str) -> None:
        text = self.format(ticket_id, title)
        if len(text) > 12:
            text = text[:11] + "…"
        self.sent.append(text)
        print(f"  [短信] 发给 {self.to}: {text}")


email = EmailNotifier("li@beichen.com")
sms = SmsNotifier("138-0000-1234")

email.send("T-1001", "发票抬头开错了")
sms.send("T-1001", "发票抬头开错了")

print(email.sent, sms.sent)
print(isinstance(sms, SmsNotifier), isinstance(sms, Notifier), isinstance(sms, EmailNotifier))
print(SmsNotifier.__mro__)
```

<div class="line-notes">

- `class Notifier:` 父类,「通知渠道」这个大类。它写了所有渠道都一样的东西。
- `self.to = to` 发给谁,邮箱或手机号。
- `self.sent: list[str] = []` 发过的每条文字都记下来,方便后面检查。每个对象一个新列表,Day 40 讲过为什么不能写成参数默认值。
- `def format(self, ticket_id: str, title: str) -> str:` 拼通知文字。所有渠道共用这一套措辞。
- `return f"工单 {ticket_id}「{title}」已处理"` T-1001 拼出来是 `工单 T-1001「发票抬头开错了」已处理`,`len` 实测是 21 个字符。
- `def send(self, ticket_id: str, title: str) -> None:` 父类的发送方法,默认做法是拼文字、记下、打印。
- `text = self.format(ticket_id, title)` 注意是 `self.format`,不是 `Notifier.format`。等会儿子类对象调 send 时,self 是那个子类对象。
- `class EmailNotifier(Notifier):` 子类,括号里写父类。
- `pass` 类体什么都不写。EmailNotifier 的 `__init__`、format、send 全是从 Notifier 拿的。
- `class SmsNotifier(Notifier):` 另一个子类。
- `def send(self, ticket_id: str, title: str) -> None:` 子类自己写了一个同名的 send,这叫**重写**(override):SmsNotifier 的对象调 send 时用这个,不再用父类的。
- `if len(text) > 12:` 假装短信最多 12 个字(真实短信长得多,这里故意设小,好看到效果)。
- `text = text[:11] + "…"` Day 15 的切片,取前 11 个字符再补一个省略号,正好 12 个。
- `email = EmailNotifier("li@beichen.com")` 造子类对象。EmailNotifier 没写 `__init__`,Python 就去父类找,用 Notifier 的 `__init__`,所以这里要传 to。
- `email.send("T-1001", "发票抬头开错了")` EmailNotifier 自己没有 send,用父类的,实测打印 `  [通知] 发给 li@beichen.com: 工单 T-1001「发票抬头开错了」已处理`。
- `sms.send("T-1001", "发票抬头开错了")` 用 SmsNotifier 自己的 send,实测 `  [短信] 发给 138-0000-1234: 工单 T-1001「发…`,被截成 12 个字。
- `print(email.sent, sms.sent)` 实测 `['工单 T-1001「发票抬头开错了」已处理'] ['工单 T-1001「发…']`。两个对象各有自己的 sent 列表。
- `print(isinstance(sms, SmsNotifier), isinstance(sms, Notifier), isinstance(sms, EmailNotifier))` 实测 `True True False`。sms 是短信渠道,也算通知渠道,但不是邮件渠道,兄弟类之间没关系。
- `print(SmsNotifier.__mro__)` MRO 是 method resolution order 的缩写,「找方法的顺序」。实测 `(<class '__main__.SmsNotifier'>, <class '__main__.Notifier'>, <class 'object'>)`:先在自己身上找,找不到去父类,再找不到去 object。

</div>

```bash
uv run python part01/notify_step1.py
```

实测输出:

```text
  [通知] 发给 li@beichen.com: 工单 T-1001「发票抬头开错了」已处理
  [短信] 发给 138-0000-1234: 工单 T-1001「发…
['工单 T-1001「发票抬头开错了」已处理'] ['工单 T-1001「发…']
True True False
(<class '__main__.SmsNotifier'>, <class '__main__.Notifier'>, <class 'object'>)
```

MRO 最后那个 `object` 是什么?Python 里所有类都默认继承自 `object`,哪怕你写 `class Notifier:` 什么都没写。Day 40 直接 print 对象时看到的 `<__main__.Ticket object at 0x...>`,就是 object 提供的默认打印方式。明天学 `__repr__`,其实就是在重写 object 的一个方法。

找方法的规则就一条:**从对象自己的类开始,沿着 MRO 一层层往上找,找到第一个就用**。所以 EmailNotifier 调 send 找到的是 Notifier 的,SmsNotifier 调 send 在自己身上就找到了,不会再往上走。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="Notifier 父类下面有 EmailNotifier 和 SmsNotifier 两个子类,调用 send 时沿箭头从子类往父类找">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="220" y="20" width="200" height="90" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="42" text-anchor="middle" fill="var(--ink)">Notifier(父类)</text>
<text x="240" y="64" fill="var(--ink-soft)" font-size="11">__init__(to)</text>
<text x="240" y="80" fill="var(--ink-soft)" font-size="11">format(...)</text>
<text x="240" y="96" fill="var(--ink-soft)" font-size="11">send(...)</text>
<rect x="40" y="160" width="220" height="70" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="150" y="182" text-anchor="middle" fill="var(--ink)">EmailNotifier</text>
<text x="60" y="204" fill="var(--ink-soft)" font-size="11">pass(全部用父类的)</text>
<rect x="380" y="160" width="220" height="70" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="490" y="182" text-anchor="middle" fill="var(--ink)">SmsNotifier</text>
<text x="400" y="204" fill="var(--ink-soft)" font-size="11">send(...) 重写,超长截断</text>
<line x1="150" y1="160" x2="260" y2="110" stroke="var(--rule)"/>
<line x1="490" y1="160" x2="380" y2="110" stroke="var(--rule)"/>
<text x="150" y="140" fill="var(--ink-faint)" font-size="11">找不到 send,往上找</text>
<text x="420" y="140" fill="var(--ink-faint)" font-size="11">自己有 send,不往上</text>
</g>
</svg>
<figcaption>子类先在自己身上找方法,找不到才去父类。EmailNotifier 的 send 来自 Notifier,SmsNotifier 的 send 是自己重写的。</figcaption>
</figure>

## 第二步:super() 和忘了它的后果

邮件渠道想多一个属性:标题前缀,比如 `[云簿客服]`。这就得给 EmailNotifier 写自己的 `__init__`。问题来了:子类一旦写了自己的 `__init__`,按第一步的找法,Python 找到子类的就不再往上找了,父类的 `__init__` 不会自动执行,`self.to` 和 `self.sent` 也就没人设置。

新建 `part01/notify_super.py`,对比写了和没写 super 的两个子类:

```python
# agent-zero-lab/part01/notify_super.py
class Notifier:
    def __init__(self, to: str):
        print("  Notifier.__init__ 跑了")
        self.to = to
        self.sent: list[str] = []


class EmailForgot(Notifier):
    def __init__(self, to: str, prefix: str):
        self.prefix = prefix


class Email(Notifier):
    def __init__(self, to: str, prefix: str = "[云簿客服]"):
        super().__init__(to)
        self.prefix = prefix


print("造 Email:")
good = Email("li@beichen.com")
print(vars(good))

print("造 EmailForgot:")
bad = EmailForgot("li@beichen.com", "[云簿客服]")
print(vars(bad))
print(bad.to)
```

<div class="line-notes">

- `print("  Notifier.__init__ 跑了")` 在父类构造方法里打一句,看它到底有没有被执行。
- `class EmailForgot(Notifier):` 忘了调 super 的版本。
- `def __init__(self, to: str, prefix: str):` 子类自己的构造方法,收两个参数。
- `self.prefix = prefix` 只设了自己的新属性,to 收进来了却没人管。
- `class Email(Notifier):` 正确的版本。
- `def __init__(self, to: str, prefix: str = "[云簿客服]"):` 前缀给个默认值。
- `super().__init__(to)` `super()` 代表「我的父类那一层」,`super().__init__(to)` 就是把 to 交给父类的 `__init__` 去处理,父类负责设好 to 和 sent。这一行相当于 JS constructor 里的 `super(to)`。
- `self.prefix = prefix` 父类的部分弄完,再设子类自己的部分。
- `good = Email("li@beichen.com")` 实测先打印 `  Notifier.__init__ 跑了`。
- `print(vars(good))` Day 40 的 vars,实测 `{'to': 'li@beichen.com', 'sent': [], 'prefix': '[云簿客服]'}`,父类的两个属性和子类的一个属性都在。
- `bad = EmailForgot("li@beichen.com", "[云簿客服]")` 这次没有打印「Notifier.__init__ 跑了」,父类构造方法根本没执行。
- `print(vars(bad))` 实测 `{'prefix': '[云簿客服]'}`,只有一个属性。
- `print(bad.to)` 读 to,崩。

</div>

```bash
uv run python part01/notify_super.py
```

实测输出:

```text
造 Email:
  Notifier.__init__ 跑了
{'to': 'li@beichen.com', 'sent': [], 'prefix': '[云簿客服]'}
造 EmailForgot:
{'prefix': '[云簿客服]'}
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/notify_super.py", line 27, in <module>
    print(bad.to)
          ^^^^^^
AttributeError: 'EmailForgot' object has no attribute 'to'
```

这个坑比 Day 40 的「忘了写 self」还阴:**造对象的时候不报错**,要等到用 to 的那一刻才崩,而那一刻可能离造对象的地方很远。更糟的是,我用 basedpyright 检查这个文件,实测 `0 errors, 0 warnings, 0 notes`,编辑器一条红线都不画。

JS 在这一点上比 Python 严格。JS 的子类 constructor 里不调 `super()` 就用 `this`,当场抛 `ReferenceError: Must call super constructor in derived class before accessing 'this'`。Python 不管,你不调它就真不调。所以给自己定一条规矩:**子类写了 `__init__`,第一行就写 `super().__init__(...)`**。

什么时候子类可以不写 `__init__`?子类没有新属性的时候,比如第一步的 EmailNotifier 和 SmsNotifier,直接用父类的就行。

## 第三步:同一句调用,不同的渠道

继承带来的最大好处不在少写几行代码,而在这里:调用方不用关心手里拿的是哪种渠道。新建 `part01/notify_many.py`,这次 send 直接收一个 Ticket 对象:

```python
# agent-zero-lab/part01/notify_many.py
from ticket_model import Ticket


class Notifier:
    def __init__(self, to: str):
        self.to = to

    def send(self, ticket: Ticket) -> str:
        raise NotImplementedError(f"{type(self).__name__} 还没写 send")


class EmailNotifier(Notifier):
    def send(self, ticket: Ticket) -> str:
        return f"邮件 -> {self.to}: 工单 {ticket.id} 状态 {ticket.status}"


class SmsNotifier(Notifier):
    def send(self, ticket: Ticket) -> str:
        return f"短信 -> {self.to}: {ticket.id} {ticket.status}"


class WechatNotifier(Notifier):
    pass


t = Ticket("T-1001", "发票抬头开错了", 199)
t.close()

channels: list[Notifier] = [EmailNotifier("li@beichen.com"), SmsNotifier("138-0000-1234")]
for ch in channels:
    print(ch.send(t))

WechatNotifier("li_wx").send(t)
```

<div class="line-notes">

- `from ticket_model import Ticket` 用 Day 40 的 Ticket,它有 id、title、amount、status 和 close。
- `def send(self, ticket: Ticket) -> str:` 父类的 send 收一张工单。这次为了好观察,send 返回文字而不是直接打印。
- `raise NotImplementedError(f"{type(self).__name__} 还没写 send")` 父类不知道具体怎么发,干脆规定「子类必须自己写 send」。`NotImplementedError` 是 Python 自带的异常,意思是「这个方法还没实现」。`type(self).__name__` 取的是**实际对象**的类名,不是 Notifier。
- `class EmailNotifier(Notifier):` 邮件渠道重写了 send。
- `return f"邮件 -> {self.to}: 工单 {ticket.id} 状态 {ticket.status}"` 用 ticket 的属性拼文字。
- `class SmsNotifier(Notifier):` 短信渠道,文字更短。
- `class WechatNotifier(Notifier):` 新来的同事加了一个微信渠道,只写了个壳,忘了写 send。
- `t.close()` Day 40 的 close 方法,status 变成 closed。
- `channels: list[Notifier] = [EmailNotifier("li@beichen.com"), SmsNotifier("138-0000-1234")]` 一个列表里装两种不同的对象,类型标注写的是父类 `list[Notifier]`,因为它们都算 Notifier。
- `for ch in channels:` 循环里不判断 ch 是哪种渠道。
- `print(ch.send(t))` 同一句代码,ch 是邮件就走邮件的 send,是短信就走短信的 send。实测两行:`邮件 -> li@beichen.com: 工单 T-1001 状态 closed`、`短信 -> 138-0000-1234: T-1001 closed`。
- `WechatNotifier("li_wx").send(t)` 微信渠道自己没有 send,按 MRO 找到父类的 send,父类的 send 直接抛 NotImplementedError。

</div>

```bash
uv run python part01/notify_many.py
```

实测输出:

```text
邮件 -> li@beichen.com: 工单 T-1001 状态 closed
短信 -> 138-0000-1234: T-1001 closed
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/notify_many.py", line 34, in <module>
    WechatNotifier("li_wx").send(t)
  File ".../agent-zero-lab/part01/notify_many.py", line 10, in send
    raise NotImplementedError(f"{type(self).__name__} 还没写 send")
NotImplementedError: WechatNotifier 还没写 send
```

「同一句调用,对象不同,行为不同」这件事有个专门的名字叫**多态**。名字听着唬人,你在前端其实天天用:React 里 `items.map(item => <Card {...item} />)` 不用管每个 item 具体是什么,只要它们长得一样就行。今天的 channels 列表也一样,只要每个元素都有 send,循环就能跑。

父类里写 `raise NotImplementedError` 是一种很常见的约定,意思是「这个方法是留给子类填的空」。不写这一行,父类 send 什么都不做(或者写个 `pass`),那么 WechatNotifier 的 send 就会悄悄什么也不发,你要等到客户投诉「没收到微信」才发现。抛出来,第一次测试就能看到。(Python 还有一个更严格的写法叫抽象基类,`from abc import ABC, abstractmethod`,能在**造对象时**就报错,[Day 49](/blog/agent-zero/day-049-type-hints-4/) 学 Protocol 时会拿它们对比。)

这和 Agent 有什么关系?第三部分写 Agent 的工具时,每个工具都要有名字、说明和一个「执行」方法,Agent 循环拿到模型选的工具名,找到那个工具对象,调它的执行方法,根本不关心它是查天气还是查订单。那就是今天这个 for 循环换了个场景。

## 第四步:继承用错了地方

继承很顺手,顺手到容易乱用。看一个真实场景里常见的错误设计:产品经理说「工单关闭时要给客户发邮件」,有人心想「那让工单自己会发邮件好了」,于是写出了 `class EmailTicket(EmailNotifier)`。过了一周,需求变成「邮件和短信都要发」,他又写了一个继承两个父类的版本。

新建 `part01/bad_inherit.py`,把这两步都复现出来:

```python
# agent-zero-lab/part01/bad_inherit.py
class EmailNotifier:
    def __init__(self, to: str):
        self.to = to

    def send(self, text: str) -> None:
        print(f"  邮件 -> {self.to}: {text}")


class SmsNotifier:
    def __init__(self, to: str):
        self.to = to

    def send(self, text: str) -> None:
        print(f"  短信 -> {self.to}: {text}")


class EmailTicket(EmailNotifier):
    def __init__(self, id: str, title: str, to: str):
        super().__init__(to)
        self.id = id
        self.title = title
        self.status = "open"

    def close(self) -> None:
        self.status = "closed"
        self.send(f"{self.id} 已关闭")


class EmailSmsTicket(EmailNotifier, SmsNotifier):
    def __init__(self, id: str, title: str, to: str):
        super().__init__(to)
        self.id = id
        self.status = "open"

    def close(self) -> None:
        self.status = "closed"
        self.send(f"{self.id} 已关闭")


t = EmailTicket("T-1001", "发票抬头开错了", "li@beichen.com")
t.close()
print(vars(t))
print(isinstance(t, EmailNotifier))

t2 = EmailSmsTicket("T-1005", "升级套餐", "li@beichen.com")
t2.close()
```

<div class="line-notes">

- `class EmailNotifier:` 为了让问题单纯,这里的两个渠道类各自独立,send 收一段文字。
- `class EmailTicket(EmailNotifier):` 工单继承了邮件通知器。读出来就是「工单是一种邮件通知器」,这句话本身就不通。
- `super().__init__(to)` 第二步的规矩它倒是遵守了,把 to 交给父类。
- `self.send(f"{self.id} 已关闭")` 工单直接调自己身上(其实是继承来的)send。
- `class EmailSmsTicket(EmailNotifier, SmsNotifier):` 括号里写两个父类,这叫**多重继承**。他以为这样工单就同时拥有两种发送能力。
- `super().__init__(to)` 按 MRO,这里只会调到 EmailNotifier 的 `__init__`。
- `self.send(f"{self.id} 已关闭")` 两个父类都有 send,按 MRO 先找到 EmailNotifier 的,找到就停。SmsNotifier 的 send 永远轮不到。
- `t.close()` 实测打印 `  邮件 -> li@beichen.com: T-1001 已关闭`。
- `print(vars(t))` 实测 `{'to': 'li@beichen.com', 'id': 'T-1001', 'title': '发票抬头开错了', 'status': 'closed'}`。工单数据里混进了一个 `to`,存成 JSON 时它要不要存?换客户邮箱要不要改工单?都说不清。
- `print(isinstance(t, EmailNotifier))` 实测 `True`。程序认为这张工单「是一个邮件通知器」,任何接收通知器的地方都能把工单塞进去。
- `t2.close()` 实测只打印 `  邮件 -> li@beichen.com: T-1005 已关闭`,**短信一条都没发**,也没报错。而且就算 SMS 的 send 被调到了,它的 to 也是邮箱地址,手机号根本没地方放。

</div>

```bash
uv run python part01/bad_inherit.py
```

实测输出:

```text
  邮件 -> li@beichen.com: T-1001 已关闭
{'to': 'li@beichen.com', 'id': 'T-1001', 'title': '发票抬头开错了', 'status': 'closed'}
True
  邮件 -> li@beichen.com: T-1005 已关闭
```

最后一行就是这类设计的结局:需求一变,继承关系就扛不住,还错得悄无声息。再往下想一步,如果还要「微信」「Webhook」,或者「只发邮件」「只发短信」「都发」三种客户,继承的写法要么类的数量越来越多(EmailTicket、SmsTicket、EmailSmsTicket、EmailWechatTicket……),要么塞进更多父类,MRO 越来越难猜。

毛病出在一开始那句话:**工单不是通知器**。判断用不用继承,把两个类名代进下面两句话读一读:

- 「A **是一种** B」读得通(短信渠道是一种通知渠道、TicketError 是一种 Exception),用继承。
- 「A **有一个** B」或者「A **用到** B」才读得通(通知中心有几个通知渠道、记事本有一堆工单),用组合。

**组合**就是:不去继承别人,而是把别的对象存成自己的属性,需要时调它。你在前端肯定这么干过:一个 React 组件不会去「继承」另一个组件,而是把它当成子组件放进来,或者通过 props 传进来。React 旧版官方文档的 [Composition vs Inheritance](https://legacy.reactjs.org/docs/composition-vs-inheritance.html) 一页原话是,他们在成千上万个组件里(thousands of components)没找到过推荐用组件继承的场景。Python 里道理一样。

## 第五步:用组合改对

把职责拆开:Ticket 只管工单自己的数据(就是 Day 40 那个,一行不改);渠道类管怎么发;新加一个 `NotifyCenter`(通知中心)类,它**有**一组渠道,负责「关工单,然后挨个渠道通知」。新建 `part01/notifiers.py`:

```python
# agent-zero-lab/part01/notifiers.py
from ticket_model import Ticket, TicketError


class Notifier:
    def __init__(self, to: str):
        self.to = to
        self.sent: list[str] = []

    def format(self, ticket: Ticket) -> str:
        return f"工单 {ticket.id}「{ticket.title}」当前状态 {ticket.status}"

    def send(self, ticket: Ticket) -> None:
        raise NotImplementedError(f"{type(self).__name__} 还没写 send")


class EmailNotifier(Notifier):
    def __init__(self, to: str, prefix: str = "[云簿客服]"):
        super().__init__(to)
        self.prefix = prefix

    def send(self, ticket: Ticket) -> None:
        text = f"{self.prefix} {self.format(ticket)}"
        self.sent.append(text)
        print(f"  邮件 -> {self.to}: {text}")


class SmsNotifier(Notifier):
    def __init__(self, to: str, max_len: int = 20):
        super().__init__(to)
        self.max_len = max_len

    def send(self, ticket: Ticket) -> None:
        text = self.format(ticket)
        if len(text) > self.max_len:
            text = text[: self.max_len - 1] + "…"
        self.sent.append(text)
        print(f"  短信 -> {self.to}: {text}")


class NotifyCenter:
    def __init__(self, channels: list[Notifier]):
        self.channels = channels

    def close_ticket(self, ticket: Ticket) -> int:
        if ticket.status == "closed":
            raise TicketError(f"{ticket.id} 已经是关闭状态")
        ticket.close()
        for ch in self.channels:
            ch.send(ticket)
        return len(self.channels)


if __name__ == "__main__":
    email = EmailNotifier("li@beichen.com")
    sms = SmsNotifier("138-0000-1234")
    center = NotifyCenter([email, sms])

    t = Ticket("T-1001", "发票抬头开错了", 199)
    print("发出", center.close_ticket(t), "条通知")

    quiet = NotifyCenter([email])
    print("发出", quiet.close_ticket(Ticket("T-1005", "升级套餐", 399)), "条通知")

    try:
        center.close_ticket(t)
    except TicketError as e:
        print("没发:", e)

    print("邮件记录", len(email.sent), "条,短信记录", len(sms.sent), "条")
    print(vars(t))
```

<div class="line-notes">

- `from ticket_model import Ticket, TicketError` Ticket 原封不动地用 Day 40 的,它不知道通知这回事。
- `class Notifier:` 父类,三样共同的东西:to、sent、format。
- `def format(self, ticket: Ticket) -> str:` 共用的措辞,T-1001 关闭后拼出 `工单 T-1001「发票抬头开错了」当前状态 closed`。
- `raise NotImplementedError(f"{type(self).__name__} 还没写 send")` 第三步的约定:send 留给子类填。
- `class EmailNotifier(Notifier):` 「邮件渠道是一种通知渠道」读得通,用继承。
- `def __init__(self, to: str, prefix: str = "[云簿客服]"):` 有新属性 prefix,所以要自己写 `__init__`。
- `super().__init__(to)` 第一行先交给父类。
- `text = f"{self.prefix} {self.format(ticket)}"` 前缀加共用措辞。
- `self.sent.append(text)` sent 是父类 `__init__` 建的,能用它说明 super 调对了。
- `class SmsNotifier(Notifier):` 短信渠道。
- `def __init__(self, to: str, max_len: int = 20):` 字数上限做成属性,默认 20,不同运营商可以传不同的值。
- `if len(text) > self.max_len:` T-1001 关闭后那句是 29 个字符,超了。
- `text = text[: self.max_len - 1] + "…"` 取前 19 个加省略号,正好 20 个。`[: n]` 冒号后面的空格是格式化工具加的,和 `[:n]` 一样。
- `class NotifyCenter:` 不继承任何类。它和渠道是「有」的关系。
- `def __init__(self, channels: list[Notifier]):` 造的时候把渠道对象**传进来**。
- `self.channels = channels` 存成属性,这一行就是组合:别的对象成了我的一部分。
- `def close_ticket(self, ticket: Ticket) -> int:` 关单加通知,返回发了几条。
- `if ticket.status == "closed":` 已经关过的不重复通知,不然客户会收到两遍。
- `raise TicketError(f"{ticket.id} 已经是关闭状态")` 复用 Day 36 的业务异常。
- `ticket.close()` 关单是 Ticket 自己的本事,通知中心只是调用它。
- `for ch in self.channels:` 第三步的多态循环,不管每个 ch 是哪种渠道。
- `ch.send(ticket)` 挨个发。
- `return len(self.channels)` 发了几条就是有几个渠道。
- `center = NotifyCenter([email, sms])` 这个客户要邮件和短信都发,就给它两个渠道。
- `print("发出", center.close_ticket(t), "条通知")` 先打出邮件和短信两行,再打 `发出 2 条通知`。
- `quiet = NotifyCenter([email])` 另一个客户只要邮件,就只给一个渠道,不用新写任何类。这里故意复用同一个 email 对象,它的 sent 会累计。
- `center.close_ticket(t)` t 已经关了,再关一次。
- `print("没发:", e)` 实测 `没发: T-1001 已经是关闭状态`。
- `print("邮件记录", len(email.sent), "条,短信记录", len(sms.sent), "条")` 实测 `邮件记录 2 条,短信记录 1 条`,邮件被两个通知中心共用了。
- `print(vars(t))` 实测 `{'id': 'T-1001', 'title': '发票抬头开错了', 'amount': 199, 'status': 'closed'}`,工单身上干干净净,没有 to,没有 sent。

</div>

```bash
uv run python part01/notifiers.py
```

实测输出:

```text
  邮件 -> li@beichen.com: [云簿客服] 工单 T-1001「发票抬头开错了」当前状态 closed
  短信 -> 138-0000-1234: 工单 T-1001「发票抬头开错了」当…
发出 2 条通知
  邮件 -> li@beichen.com: [云簿客服] 工单 T-1005「升级套餐」当前状态 closed
发出 1 条通知
没发: T-1001 已经是关闭状态
邮件记录 2 条,短信记录 1 条
{'id': 'T-1001', 'title': '发票抬头开错了', 'amount': 199, 'status': 'closed'}
```

和第四步对比一下:「邮件和短信都发」不再需要多重继承,往列表里多放一个对象就行;「只发邮件」也不用新类;将来加 Webhook 渠道(练习 1),Ticket 和 NotifyCenter 一行都不用改。整个文件里继承和组合都用了,各管一摊:**渠道之间是「是一种」,用继承共享代码;通知中心和渠道之间是「有」,用组合拼起来**。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="NotifyCenter 用组合持有 EmailNotifier 和 SmsNotifier 两个对象,两个渠道类继承自 Notifier,Ticket 独立在一边被传入">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="80" width="170" height="70" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="105" y="104" text-anchor="middle" fill="var(--ink)">NotifyCenter</text>
<text x="35" y="126" fill="var(--ink-soft)" font-size="11">channels = [email, sms]</text>
<text x="35" y="142" fill="var(--ink-faint)" font-size="11">有(组合)</text>
<rect x="250" y="30" width="170" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="335" y="60" text-anchor="middle" fill="var(--ink)">EmailNotifier</text>
<rect x="250" y="150" width="170" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="335" y="180" text-anchor="middle" fill="var(--ink)">SmsNotifier</text>
<line x1="190" y1="105" x2="250" y2="55" stroke="var(--mem)"/>
<line x1="190" y1="125" x2="250" y2="175" stroke="var(--mem)"/>
<rect x="480" y="90" width="140" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="550" y="120" text-anchor="middle" fill="var(--ink)">Notifier</text>
<line x1="420" y1="55" x2="480" y2="105" stroke="var(--rule)"/>
<line x1="420" y1="175" x2="480" y2="125" stroke="var(--rule)"/>
<text x="455" y="78" fill="var(--ink-faint)" font-size="11">是一种</text>
<text x="455" y="160" fill="var(--ink-faint)" font-size="11">是一种</text>
<rect x="20" y="180" width="170" height="36" rx="4" fill="none" stroke="var(--rule)"/>
<text x="105" y="203" text-anchor="middle" fill="var(--ink-soft)">Ticket(独立,被传入)</text>
</g>
</svg>
<figcaption>蓝线是组合(通知中心有两个渠道对象),灰线是继承(两个渠道都是一种 Notifier)。Ticket 不继承谁,也不被谁继承,只是作为参数传进 close_ticket。</figcaption>
</figure>

零件对照:

| 前面的零件 | 在 notifiers.py 里是哪一段 |
| --- | --- |
| 开头 TicketError(Exception) 的继承 | `EmailNotifier(Notifier)`、`SmsNotifier(Notifier)` |
| 第一步 重写 send | 两个子类各自的 send |
| 第二步 `super().__init__(to)` | 两个子类 `__init__` 的第一行 |
| 第三步 多态循环、NotImplementedError | `for ch in self.channels`、父类的 send |
| 第五步 组合 | `NotifyCenter` 的 `self.channels = channels` |
| Day 36 TicketError | 重复关闭时抛出 |
| Day 40 Ticket、close | 被传进来的工单和它的 close 方法 |

## 动手练习

**练习 1:加一个 Webhook 渠道。** 很多 SaaS 客户要的不是邮件,而是「工单关了就往我们系统的某个网址推一条 JSON」,这叫 Webhook。写一个 `WebhookNotifier`,继承 Notifier,构造时多收一个 `secret`(签名用的密钥);send 时把 `{"event": "ticket.closed", "ticket": 工单字典}` 转成 JSON 字符串,记进 sent 并打印(真的发请求要等 [Day 64](/blog/agent-zero/day-064-httpx-1/) 学 httpx,今天只打印),打印时密钥只露前 3 位。把它和邮件渠道一起放进 NotifyCenter 关一张工单。文件名 `part01/ex42_webhook.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex42_webhook.py
import json

from notifiers import EmailNotifier, Notifier, NotifyCenter
from ticket_model import Ticket


class WebhookNotifier(Notifier):
    def __init__(self, to: str, secret: str):
        super().__init__(to)
        self.secret = secret

    def send(self, ticket: Ticket) -> None:
        body = json.dumps({"event": "ticket.closed", "ticket": ticket.to_dict()}, ensure_ascii=False)
        self.sent.append(body)
        print(f"  POST {self.to} 签名={self.secret[:3]}*** 内容={body}")


hook = WebhookNotifier("https://hooks.beichen.com/tickets", "s3cr3t-key")
center = NotifyCenter([EmailNotifier("li@beichen.com"), hook])
center.close_ticket(Ticket("T-1001", "发票抬头开错了", 199))
print(len(hook.sent), isinstance(hook, Notifier))
```

<div class="line-notes">

- `from notifiers import EmailNotifier, Notifier, NotifyCenter` 从正文的 `notifiers.py` 导入,它的演示代码在 main guard 里,import 不会执行。
- `class WebhookNotifier(Notifier):` 「Webhook 渠道是一种通知渠道」,读得通,继承。
- `super().__init__(to)` 这里的 to 是网址,父类不在乎它是什么字符串。
- `self.secret = secret` 子类自己的新属性。
- `body = json.dumps({"event": "ticket.closed", "ticket": ticket.to_dict()}, ensure_ascii=False)` Day 40 的 to_dict 加 Day 39 的 dumps。
- `print(f"  POST {self.to} 签名={self.secret[:3]}*** 内容={body}")` `self.secret[:3]` 是 `s3c`,日志里永远别打完整密钥。
- `center = NotifyCenter([EmailNotifier("li@beichen.com"), hook])` NotifyCenter 一行没改,新渠道直接放进列表。
- `center.close_ticket(Ticket("T-1001", "发票抬头开错了", 199))` 实测先打邮件那行,再打 POST 那行。
- `print(len(hook.sent), isinstance(hook, Notifier))` 实测 `1 True`。

</div>

实测输出:

```text
  邮件 -> li@beichen.com: [云簿客服] 工单 T-1001「发票抬头开错了」当前状态 closed
  POST https://hooks.beichen.com/tickets 签名=s3c*** 内容={"event": "ticket.closed", "ticket": {"id": "T-1001", "title": "发票抬头开错了", "amount": 199, "status": "closed"}}
1 True
```

</details>

**练习 2:在父类的基础上加点东西。** 老板想要一种「加急邮件」:措辞在普通邮件前面加 `【加急】`,后面补上金额。要求不复制父类 format 的代码,而是先拿到父类拼好的文字再加工。写 `UrgentEmailNotifier(EmailNotifier)`,对比普通邮件和加急邮件发同一张工单的效果,再打印它的 MRO。文件名 `part01/ex42_urgent.py`。提示:super() 不只能调 `__init__`,也能调父类的普通方法。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex42_urgent.py
from notifiers import EmailNotifier
from ticket_model import Ticket


class UrgentEmailNotifier(EmailNotifier):
    def format(self, ticket: Ticket) -> str:
        base = super().format(ticket)
        return f"【加急】{base},金额 ¥{ticket.amount}"


t = Ticket("T-1005", "升级套餐", 399)
EmailNotifier("li@beichen.com").send(t)
UrgentEmailNotifier("boss@beichen.com").send(t)
print(UrgentEmailNotifier.__mro__)
```

<div class="line-notes">

- `class UrgentEmailNotifier(EmailNotifier):` 继承邮件渠道,孙子辈的类。没写 `__init__`,用 EmailNotifier 的,所以 prefix 照样有。
- `def format(self, ticket: Ticket) -> str:` 只重写 format,send 还用 EmailNotifier 的。
- `base = super().format(ticket)` 调父类那一层的 format。EmailNotifier 自己没写 format,按 MRO 继续往上,用的是 Notifier 的,得到 `工单 T-1005「升级套餐」当前状态 open`。相当于 JS 的 `super.format(ticket)`。
- `return f"【加急】{base},金额 ¥{ticket.amount}"` 在父类结果上加工。
- `EmailNotifier("li@beichen.com").send(t)` 普通邮件,实测 `  邮件 -> li@beichen.com: [云簿客服] 工单 T-1005「升级套餐」当前状态 open`。
- `UrgentEmailNotifier("boss@beichen.com").send(t)` send 是 EmailNotifier 的,它里面调的 `self.format` 却找到了子类重写的版本,因为 self 是 UrgentEmailNotifier 对象。实测 `  邮件 -> boss@beichen.com: [云簿客服] 【加急】工单 T-1005「升级套餐」当前状态 open,金额 ¥399`。
- `print(UrgentEmailNotifier.__mro__)` 实测四层:UrgentEmailNotifier → EmailNotifier → Notifier → object。

</div>

实测输出:

```text
  邮件 -> li@beichen.com: [云簿客服] 工单 T-1005「升级套餐」当前状态 open
  邮件 -> boss@beichen.com: [云簿客服] 【加急】工单 T-1005「升级套餐」当前状态 open,金额 ¥399
(<class '__main__.UrgentEmailNotifier'>, <class 'notifiers.EmailNotifier'>, <class 'notifiers.Notifier'>, <class 'object'>)
```

这道题最值得琢磨的是第二行:父类的 send 里写的是 `self.format(...)`,而 self 是子类对象,所以调到的是子类的 format。父类定好流程,子类只换其中一步,这是继承最正当的用法。

</details>

**练习 3:观察会发生什么。** 下面的 PushNotifier 写了自己的 `__init__` 却没调 super。先猜一下会在哪一行崩、报什么错,再跑一下,然后修好。文件名 `part01/ex42_forgot.py`。

```python
# agent-zero-lab/part01/ex42_forgot.py
from notifiers import Notifier
from ticket_model import Ticket


class PushNotifier(Notifier):
    def __init__(self, to: str, app: str):
        self.app = app

    def send(self, ticket: Ticket) -> None:
        text = f"{self.app} 推送: {self.format(ticket)}"
        self.sent.append(text)
        print(text)


PushNotifier("device-42", "云簿 App").send(Ticket("T-1001", "发票抬头开错了", 199))
```

<div class="line-notes">

- `def __init__(self, to: str, app: str):` 写了自己的构造方法。
- `self.app = app` 只设了 app,父类的 `__init__` 没被调用,to 和 sent 都不存在。
- `text = f"{self.app} 推送: {self.format(ticket)}"` format 只用 ticket,不用 self 的属性,所以这一行能过。
- `self.sent.append(text)` 这里才崩。

</div>

<details><summary>参考答案</summary>

实测输出(末尾几行):

```text
  File ".../agent-zero-lab/part01/ex42_forgot.py", line 12, in send
    self.sent.append(text)
    ^^^^^^^^^
AttributeError: 'PushNotifier' object has no attribute 'sent'. Did you mean: 'send'?
```

崩在 send 里的 `self.sent.append`,离出问题的 `__init__` 隔了好几行。最坑的是那句 `Did you mean: 'send'?`:Python 看 sent 和 send 只差一个字母,好心猜你拼错了,可真正的原因是父类 `__init__` 没跑。所以看到「某个父类该设的属性不存在」,先别急着按提示改名,去子类的 `__init__` 看有没有 super。修法是在 `self.app = app` 前面加一行:

```python
    def __init__(self, to: str, app: str):
        super().__init__(to)
        self.app = app
```

<div class="line-notes">

- `super().__init__(to)` 让父类设好 to 和 sent。
- `self.app = app` 再设自己的。

</div>

加上之后实测输出 `云簿 App 推送: 工单 T-1001「发票抬头开错了」当前状态 open`。

</details>

**练习 4:换一个假渠道来测试。** 组合的另一个好处是好测试:测 NotifyCenter 时不想真的打印一堆东西(以后是真的发邮件、发短信,还要花钱),可以塞一个「只记录不发送」的假渠道进去。要求:写 `ListNotifier`,send 只把 format 的结果记进 sent;再写一个继承 NotifyCenter 的 `FlexibleCenter`,加一个 `add_channel(ch)` 方法,可以中途加渠道。先用一个假渠道关一张工单,再加第二个假渠道关第二张,最后检查两个假渠道分别记了几条。文件名 `part01/ex42_fake.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex42_fake.py
from notifiers import Notifier, NotifyCenter
from ticket_model import Ticket


class ListNotifier(Notifier):
    def send(self, ticket: Ticket) -> None:
        self.sent.append(self.format(ticket))


class FlexibleCenter(NotifyCenter):
    def add_channel(self, ch: Notifier) -> None:
        self.channels.append(ch)


fake_a = ListNotifier("测试邮箱")
fake_b = ListNotifier("测试手机")
center = FlexibleCenter([fake_a])
center.close_ticket(Ticket("T-1001", "发票抬头开错了", 199))
center.add_channel(fake_b)
center.close_ticket(Ticket("T-1005", "升级套餐", 399))

print(len(fake_a.sent), len(fake_b.sent))
print(fake_b.sent)
print("检查通过" if len(fake_a.sent) == 2 and len(fake_b.sent) == 1 else "检查失败")
```

<div class="line-notes">

- `class ListNotifier(Notifier):` 没写 `__init__`,用父类的,sent 自然就有。
- `self.sent.append(self.format(ticket))` 只记,不打印,也不真发。
- `class FlexibleCenter(NotifyCenter):` 「灵活的通知中心是一种通知中心」,读得通,继承。只加方法,不写 `__init__`。
- `self.channels.append(ch)` channels 是父类 `__init__` 存的列表,往里加一个就多一个渠道。
- `center = FlexibleCenter([fake_a])` 一开始只有一个假渠道。
- `center.add_channel(fake_b)` 关完第一张后加第二个。
- `print(len(fake_a.sent), len(fake_b.sent))` 实测 `2 1`:fake_a 两张都收到了,fake_b 只收到加入之后的那张。
- `print(fake_b.sent)` 实测 `['工单 T-1005「升级套餐」当前状态 closed']`。
- `print("检查通过" if len(fake_a.sent) == 2` 条件表达式 `A if 条件 else B`,相当于 JS 的三元运算符 `条件 ? A : B`,Day 40 练习 3 的修法里用过。实测 `检查通过`。这就是一个手写的测试,[Day 71](/blog/agent-zero/day-071-pytest-1/) 学 pytest 后会换成 assert。

</div>

实测输出:

```text
2 1
['工单 T-1005「升级套餐」当前状态 closed']
检查通过
```

注意 NotifyCenter 完全不知道自己拿到的是假渠道。如果当初用了第四步那种「工单继承邮件通知器」的设计,想换假的就得改类定义,而组合只要换一个传进去的对象。

</details>

验收标准:四个练习的输出和上面一致;不看文章能写出一个带 super 的子类;看到「父类该设的属性不存在」能马上想到去查 super;能用「是一种 / 有一个」两句话说明 notifiers.py 里哪里用了继承、哪里用了组合。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 继承(inheritance) | 新类在括号里写一个已有的类,自动拥有它的属性和方法。`class EmailNotifier(Notifier)` ≈ JS 的 `extends` |
| 父类 / 基类 | 被继承的那个类,如 Notifier、Exception |
| 子类 | 继承别人的那个类,如 EmailNotifier、TicketError |
| 重写(override) | 子类写一个和父类同名的方法,替换父类的做法 |
| super() | 代表父类那一层,`super().__init__(...)` 调父类构造方法,`super().format(...)` 调父类普通方法 |
| issubclass | `issubclass(子, 父)` 判断一个类是不是另一个类的子类 |
| `__bases__` | 类的直接父类,是个元组 |
| MRO | 找方法的顺序,`类.__mro__` 查看;从自己开始往父类找,找到第一个就用 |
| object | 所有类的最终父类,没写父类时默认继承它 |
| 多态 | 同一句调用 `ch.send(t)`,对象不同行为不同 |
| NotImplementedError | 自带异常,父类用它表示「这个方法留给子类实现」 |
| 多重继承 | 括号里写多个父类;同名方法只用 MRO 里第一个找到的 |
| 组合(composition) | 把别的对象存成自己的属性来用,如 `self.channels = channels` |
| Webhook | 事件发生时,服务端主动往对方给的网址推一条 HTTP 请求(练习 1) |

## 常见误区

**子类写了 `__init__` 却没调 `super().__init__()`。** 造对象不报错,用到父类属性时才崩,实测 `AttributeError: 'EmailForgot' object has no attribute 'to'`,basedpyright 也不提醒。子类 `__init__` 第一行就写 super。

**被 `Did you mean` 带偏。** 练习 3 里实测 `'PushNotifier' object has no attribute 'sent'. Did you mean: 'send'?`,真正的原因是 super 没调,不是拼错。

**以为子类会自动先跑父类的 `__init__`。** JS 不调 super 会直接抛 ReferenceError,Python 不会,子类的 `__init__` 一旦存在,父类的就不再自动执行。

**父类留空方法写 `pass` 而不是 `raise NotImplementedError`。** 写 pass,子类忘了实现时什么都不发生,问题会被藏起来;抛异常,实测第一次调用就看到 `NotImplementedError: WechatNotifier 还没写 send`。

**为了「复用代码」乱继承。** 工单想发邮件就继承邮件通知器,结果工单数据里混进了 `to`,`isinstance(t, EmailNotifier)` 是 True。读一读「A 是一种 B」通不通,不通就用组合。

**用多重继承拼能力。** `class EmailSmsTicket(EmailNotifier, SmsNotifier)` 实测只发了邮件,短信的 send 永远轮不到,而且不报错。两个父类有同名方法时,只有 MRO 里排第一的那个会被用到。

**觉得用了继承就得一路继承下去。** 继承超过两三层,改最上面一个方法要担心下面所有子类,读代码也要上下翻好几个文件。实际项目里一层继承加组合能解决绝大部分问题。

## 学习资料

### 文档与文章

- [Python 官方教程 · 9. 类(中文)](https://docs.python.org/zh-cn/3.12/tutorial/classes.html):今天看 9.5「继承」和 9.5.1「多重继承」,多重继承那节了解一下 MRO 是怎么排的就够了。
- [Python 内置函数 · super(中文)](https://docs.python.org/zh-cn/3.12/library/functions.html#super):官方对 super 的说明,和 issubclass、isinstance 在同一页。
- [MDN · extends](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Classes/extends) 和 [MDN · super](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Operators/super):JS 那一边的写法,对照着看「派生类构造函数里必须先调 super」那一段。
- [Real Python · Inheritance and Composition: A Python OOP Guide](https://realpython.com/inheritance-composition-python/):英文长文,用员工薪资系统讲继承和组合各自的适用场景,和今天第四、五步是同一个思路(对爬虫返回 403,需浏览器打开)。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ZW4y127Vp&autoplay=0&high_quality=1" title="[29] Python 类继承 | 老鼠的儿子会打洞" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>林粒粒呀 · [29] Python 类继承 | 老鼠的儿子会打洞 · 约 8 分钟,零基础系列里的一集,父类、子类、super 都讲到了,适合先看一遍建立印象。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1VY411K7RB&autoplay=0&high_quality=1" title="【提升Python技能】 Python的super super()的使用" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>肥清哥哥 · 【提升Python技能】Python的super super()的使用 · 约 8 分钟,专讲 super,对应第二步和练习 2。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1QU44zUEmd&autoplay=0&high_quality=1" title="【中配】继承的缺陷：为何优先使用组合而非继承 - CodeAesthetic" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>黑纹白斑马 · 【中配】继承的缺陷:为何优先使用组合而非继承 - CodeAesthetic · 约 10 分钟,CodeAesthetic 原片的中文配音,讲的就是第四步那种「需求一变,继承就扛不住」。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/RSl87lqOXDE" title="Python OOP Tutorial 4: Inheritance - Creating Subclasses" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python OOP Tutorial 4: Inheritance - Creating Subclasses · 英文,Day 40 推荐的那个系列的第 4 集,用 Employee 和 Developer 讲子类、super 和 isinstance/issubclass,顺序和今天几乎一样。</figcaption>
</figure>

### 书籍

- 《Python 编程:从入门到实践(第 3 版)》,Eric Matthes 著,人民邮电出版社。第 9 章「类」里讲继承的那一节,包括「将实例用作属性」,后者就是今天的组合。
- 《Head First 设计模式(第 2 版)》,Eric Freeman、Elisabeth Robson 著,中国电力出版社。第 1 章用会飞会叫的鸭子讲「多用组合,少用继承」,例子是 Java 写的,但思路和今天第四、五步一模一样,当故事书看。

### 开源项目与代码

- [CPython · `Lib/json/decoder.py`](https://github.com/python/cpython/blob/3.12/Lib/json/decoder.py):第 20 行 `class JSONDecodeError(ValueError):`,第 35 行 `ValueError.__init__(self, errmsg)`,标准库里一个真实的「继承异常类、自己加属性(msg、pos、lineno)、再调父类构造方法」的例子。它用的是 `父类名.__init__(self, ...)` 这种老写法,效果和 super 一样。
- [CPython · `Lib/logging/__init__.py`](https://github.com/python/cpython/blob/3.12/Lib/logging/__init__.py):继承和组合同时出现的好例子。`class StreamHandler(Handler)`、`class FileHandler(StreamHandler)` 是继承,对应今天的渠道类;Logger 里的 `self.handlers = []` 和 `addHandler` 是组合,对应 NotifyCenter 的 channels 和练习 4 的 add_channel。[Day 75](/blog/agent-zero/day-075-logging/) 学日志时会正式用到它。

## 自测

1. 下面代码打印什么?

```python
class A:
    def hello(self) -> str:
        return "A"

    def greet(self) -> str:
        return "我是 " + self.hello()


class B(A):
    def hello(self) -> str:
        return "B"


print(A().greet(), B().greet())
```

<details><summary>答案</summary>

`我是 A 我是 B`。B 没有 greet,用 A 的;但 greet 里调的是 `self.hello()`,B 的对象调时 self 是 B 对象,找到 B 重写的 hello。和练习 2 里父类 send 调到子类 format 是同一回事。

</details>

2. 子类写了 `__init__`,里面没有调 super。造对象时会报错吗?什么时候会出问题?

<details><summary>答案</summary>

造对象时不报错。父类 `__init__` 没执行,父类该设的属性不存在,等到第一次用这些属性时才抛 AttributeError,而且 basedpyright 也不会提前提醒。

</details>

3. `except ValueError` 能不能接住 `json.JSONDecodeError`?为什么?

<details><summary>答案</summary>

能。JSONDecodeError 是 ValueError 的子类(`issubclass(json.JSONDecodeError, ValueError)` 实测 True),except 写父类,所有子类的异常都会被接住。

</details>

4. 「订单」和「付款记录」两个类,一个订单可以有多笔付款。应该让 Order 继承 Payment,还是让 Order 有一个 payments 列表?

<details><summary>答案</summary>

让 Order 有一个 payments 列表,用组合。「订单是一种付款记录」读不通,「订单有几笔付款」读得通。

</details>

5. 面试题:一个 Agent 要支持很多工具(查订单、查天气、发邮件),你会怎么用类来组织这些工具和 Agent?

<details><summary>答案</summary>

工具之间是「是一种」关系:定一个工具父类(或接口),规定每个工具都有名字、说明、参数格式和一个执行方法,具体工具继承它各自实现执行方法,父类的执行方法可以 raise NotImplementedError 提醒忘了实现。Agent 和工具之间是「有」的关系:Agent 持有一个工具列表或按名字索引的字典,通过构造参数传进来,收到模型要调的工具名时查表、调执行方法,不关心具体是哪个工具。这样加新工具不用改 Agent,测试时也能塞一个假工具进去。

</details>

## 明天预告

[Day 43 · 类(三):__repr__、@property 和类方法](/blog/agent-zero/day-043-classes-3/)。今天看到所有类都继承自 object,直接 print 对象时那串 `<... object at 0x...>` 就是 object 给的默认样子。明天重写 `__repr__` 让 Ticket 打印得像样;再用 @property 补上 Day 40 留下的一个漏洞,造完再改金额改成负数居然没人拦;最后把 `ticket_from_dict` 挂到类上变成 `Ticket.from_dict`。
