---
title: 'Day 49 · 类型标注(四):Protocol 和 TypeVar'
description: '用 Protocol 让检查器「只看有没有这个方法,不看继承自谁」(≈ TS 的结构类型),给一个不继承 Notifier 的企业微信机器人放行;再用 TypeVar 写「传进什么类型就返回什么类型」的泛型函数(≈ TS 的 <T>),最后给一个假的大模型客户端 FakeClient 写好类型,让它和以后的真客户端走同一个接口。'
pubDate: 2026-10-22
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 49
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 48](/blog/agent-zero/day-048-week07-review/) 复习了这一周:继承和组合、`__repr__` 和 property、命令行记事本,还有三天类型标注。小项目 `close_batch.py` 让 NotifyCenter 带着邮件和日志两个渠道批量关单,basedpyright 0 报错。

复习日的明天预告留了一个问题。NotifyCenter 的参数标的是 `list[Notifier]`,意思是「Notifier 或它的子类」。可如果同事给你一个现成的企业微信机器人类,它有一模一样的 send 方法,只是没继承 Notifier,会怎样?程序照样能跑,检查器却会画红线。今天先解决这个,再解决另一个问题:写一个「从列表里取第一个」的通用函数,怎么让检查器知道取出来的是什么类型。

## 今天要解决的问题

学完今天,你应该能:

1. 用 `Protocol` 声明「有这样一个方法的东西都算」,说出它和 TS 结构类型的对应关系,读懂「缺方法」「签名不对」两种红线。
2. 给一个假的大模型客户端 `FakeClient` 和用它的函数写好类型,让假客户端不继承任何类也通过检查。
3. 用 Python 3.12 的 `def first[T](items: list[T]) -> T | None` 写泛型函数,读懂老写法 `T = TypeVar("T")`,并用 `[T: HasId]` 给类型变量加上限。
4. 说出 Any、object、TypeVar 三种写法在「通用函数」上的区别。

预计用时:2.5 小时。前置:[Day 42](/blog/agent-zero/day-042-classes-2/) 的 `notifiers.py`(继承、组合、多态)、[Day 43](/blog/agent-zero/day-043-classes-3/) 的 `ticket_model.py`(property)、[Day 45](/blog/agent-zero/day-045-type-hints-1/) 到 [Day 47](/blog/agent-zero/day-047-type-hints-3/) 三天类型标注(basedpyright、`X | None`、收窄、Any、TypedDict、Literal)。

学法:先对照文章逐行敲一遍(不要复制粘贴)并跑通;第二天合上文章,把 `fake_client.py` 和 `by_id` 默写出来;再做动手练习,做不出来再展开参考答案,看完关掉自己重写一遍。

命令都在项目根目录 `agent-zero-lab` 里跑,新文件放进 `part01/`。今天不装新依赖,不调 API,花费 0 元。数据用 Day 44 的 `part01/data/notebook.json`(T-1001 已关,T-1002、T-1004、T-1005 未关;我的 T-1004 金额是 89.5,没做 Day 44 练习 2 的话是 99.5)。下面检查结果里的路径一律缩短成文件名。

## 先看问题:跑得通,检查器却不让

新建 `part01/duck_problem.py`。WechatBot 是「同事写的」企业微信机器人,有 send 方法,参数也是一张工单,但没继承 Notifier:

```python
# agent-zero-lab/part01/duck_problem.py
from notifiers import EmailNotifier, Notifier
from ticket_model import Ticket


class WechatBot:
    def __init__(self, group: str):
        self.group = group

    def send(self, ticket: Ticket) -> None:
        print(f"  企业微信 -> {self.group}: 工单 {ticket.id} 状态 {ticket.status}")


def notify_all(channels: list[Notifier], ticket: Ticket) -> int:
    for ch in channels:
        ch.send(ticket)
    return len(channels)


t = Ticket("T-1004", "扣费两次", 89.5)
print("发出", notify_all([EmailNotifier("li@beichen.com"), WechatBot("财务群")], t), "条")
```

<div class="line-notes">

- `from notifiers import EmailNotifier, Notifier` Day 42 的渠道类。
- `class WechatBot:` 括号里什么都没写,不继承任何类。
- `def send(self, ticket: Ticket) -> None:` 和 Notifier 子类的 send 签名一样:收一张工单,不返回东西。
- `def notify_all(channels: list[Notifier], ticket: Ticket) -> int:` 和 Day 42 NotifyCenter 的写法一样,渠道标成 `list[Notifier]`。
- `ch.send(ticket)` 运行时 Python 只管 ch 身上有没有 send,不管它是哪个类。
- `print("发出", notify_all([EmailNotifier("li@beichen.com"), WechatBot("财务群")], t), "条")` 邮件渠道和企业微信机器人放进同一个列表。

</div>

```bash
uv run basedpyright part01/duck_problem.py
uv run python part01/duck_problem.py
```

检查的实测输出:

```text
duck_problem.py:21:58 - error: Argument of type "list[EmailNotifier | WechatBot]" cannot be assigned to parameter "channels" of type "list[Notifier]" in function "notify_all"
    "WechatBot" is not assignable to "Notifier" (reportArgumentType)
1 error, 0 warnings, 0 notes
```

运行的实测输出:

```text
  邮件 -> li@beichen.com: [云簿客服] 工单 T-1004「扣费两次」当前状态 open
  企业微信 -> 财务群: 工单 T-1004 状态 open
发出 2 条
```

程序完全没问题,两个渠道都发出去了。Python 运行时的规矩一直是「有这个方法就能调」,这种风格有个外号叫**鸭子类型**(duck typing):走起来像鸭子、叫起来像鸭子,就当它是鸭子。Day 42 第三步的多态循环靠的也是它。

检查器的规矩却是另一套。`list[Notifier]` 的意思是「Notifier 或者它的子类」,WechatBot 不是 Notifier 的子类,所以不行。这种「看你是不是我家族谱上的」的规则叫**名义类型**(nominal typing),认的是名字和继承关系。

前端的你可能会觉得奇怪,因为 TS 里同样的代码不报错:

```ts
interface Notifier { send(ticket: Ticket): void }
class WechatBot { send(ticket: Ticket) { /* ... */ } }
const ch: Notifier = new WechatBot();   // TS 里完全合法
```

WechatBot 没写 `implements Notifier`,TS 照样放行,因为 TS 只比较**结构**:你要的 send 我有,参数和返回值也对得上,那我就是。这叫**结构类型**(structural typing)。Python 的类默认按名义比较,要让检查器也按结构比较,就用今天第一个新东西:Protocol。

改法有两种,先说不推荐的那种:让 WechatBot 去继承 Notifier。问题是 WechatBot 是同事写的、或者来自某个第三方库,你不一定能改它;就算能改,继承还会带进来 Notifier 的 to、sent、format,企业微信机器人根本用不上。Day 42 讲过,为了「凑类型」去继承是坏味道。

## 第一步:Protocol,只看有没有这个方法

新建 `part01/protocol_basic.py`:

```python
# agent-zero-lab/part01/protocol_basic.py
from typing import Protocol

from notifiers import EmailNotifier
from ticket_model import Ticket


class Sender(Protocol):
    def send(self, ticket: Ticket) -> None: ...


class WechatBot:
    def __init__(self, group: str):
        self.group = group

    def send(self, ticket: Ticket) -> None:
        print(f"  企业微信 -> {self.group}: 工单 {ticket.id} 状态 {ticket.status}")


class TextOnly:
    def send(self, text: str) -> None:
        print("  只收文字:", text)


class Silent:
    def notify(self, ticket: Ticket) -> None:
        pass


def notify_all(channels: list[Sender], ticket: Ticket) -> int:
    for ch in channels:
        ch.send(ticket)
    return len(channels)


t = Ticket("T-1004", "扣费两次", 89.5)
print("发出", notify_all([EmailNotifier("li@beichen.com"), WechatBot("财务群")], t), "条")

bad1: Sender = TextOnly()
bad2: Sender = Silent()
print(type(bad1).__name__, type(bad2).__name__)
```

<div class="line-notes">

- `from typing import Protocol` Protocol 在 typing 工具箱里,Python 3.8 起就有。
- `class Sender(Protocol):` 写法借用了继承的语法,但意思完全不同:这里不是造一个父类,而是**声明一种「能力」**,读作「Sender 就是任何有下面这些方法的东西」。≈ TS 的 `interface Sender { send(ticket: Ticket): void }`。名字我起成 Sender(会发送的东西),和具体的渠道类区分开。
- `def send(self, ticket: Ticket) -> None: ...` 只写签名,方法体就是三个点 `...`(这个值叫 Ellipsis,在这里的意思是「这里不写实现」)。Protocol 里的方法都这么写,它只是一份说明书。
- `class WechatBot:` 和开头那个一模一样,还是不继承任何类。
- `class TextOnly:` 反例一:有 send,但收的是一段文字,不是工单。
- `def send(self, text: str) -> None:` 参数名和参数类型都和 Sender 不一样。
- `class Silent:` 反例二:方法叫 notify,根本没有 send。
- `def notify_all(channels: list[Sender], ticket: Ticket) -> int:` 唯一的改动:`list[Notifier]` 换成 `list[Sender]`。
- `print("发出", notify_all([EmailNotifier("li@beichen.com"), WechatBot("财务群")], t), "条")` EmailNotifier 有 send,WechatBot 也有,两个都满足 Sender。注意 EmailNotifier 也没有继承 Sender,它是 Day 42 写的,那时候还没有 Sender 这个东西。
- `bad1: Sender = TextOnly()` 把反例一当成 Sender 用。
- `bad2: Sender = Silent()` 把反例二当成 Sender 用。
- `print(type(bad1).__name__, type(bad2).__name__)` 运行时会不会出事?

</div>

```bash
uv run basedpyright part01/protocol_basic.py
uv run python part01/protocol_basic.py
```

检查的实测输出:

```text
protocol_basic.py:39:16 - error: Type "TextOnly" is not assignable to declared type "Sender"
    "TextOnly" is incompatible with protocol "Sender"
      "send" is an incompatible type
        Type "(text: str) -> None" is not assignable to type "(ticket: Ticket) -> None"
          Parameter name mismatch: "ticket" versus "text"
          Parameter 1: type "Ticket" is incompatible with type "str"
            "Ticket" is not assignable to "str" (reportAssignmentType)
protocol_basic.py:40:16 - error: Type "Silent" is not assignable to declared type "Sender"
    "Silent" is incompatible with protocol "Sender"
      "send" is not present (reportAssignmentType)
2 errors, 0 warnings, 0 notes
```

运行的实测输出:

```text
  邮件 -> li@beichen.com: [云簿客服] 工单 T-1004「扣费两次」当前状态 open
  企业微信 -> 财务群: 工单 T-1004 状态 open
发出 2 条
TextOnly Silent
```

notify_all 那一行的红线消失了,WechatBot 被放行。两个反例被抓住,而且说明写得很细,从外往里读(Day 46 教的读法):

TextOnly 那条,第二层说「TextOnly 和协议 Sender 不兼容」,第三层说「send 的类型对不上」,第四层把两个签名并排摆出来:你有的是 `(text: str) -> None`,要的是 `(ticket: Ticket) -> None`。最里面两行是具体差在哪:参数名不一样(ticket 对 text),第 1 个参数的类型不一样(Ticket 对 str)。

Silent 那条短得多:`"send" is not present`,压根没有 send。

运行结果再一次说明标注只给检查器看:bad1、bad2 照样造出来了,`type(...).__name__` 打出了它们真正的类名。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="名义类型和结构类型对比:左边 list[Notifier] 只认 Notifier 家族,EmailNotifier 通过,WechatBot 被拒;右边 list[Sender] 只看有没有 send(ticket),EmailNotifier 和 WechatBot 都通过,TextOnly 和 Silent 被拒">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="160" y="28" text-anchor="middle" fill="var(--ink)">list[Notifier]:看族谱</text>
<text x="480" y="28" text-anchor="middle" fill="var(--ink)">list[Sender]:看结构</text>
<line x1="320" y1="16" x2="320" y2="244" stroke="var(--rule)" stroke-dasharray="4 3"/>
<rect x="40" y="48" width="240" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="160" y="73" text-anchor="middle" fill="var(--ink)">Notifier(父类)</text>
<line x1="160" y1="88" x2="160" y2="110" stroke="var(--rule)"/>
<rect x="40" y="110" width="240" height="36" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="160" y="133" text-anchor="middle" fill="var(--ink)">EmailNotifier ✓</text>
<rect x="40" y="170" width="240" height="36" rx="4" fill="none" stroke="var(--rule)"/>
<text x="160" y="193" text-anchor="middle" fill="var(--ink-faint)">WechatBot ✗ 不是子类</text>
<rect x="360" y="48" width="240" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="480" y="73" text-anchor="middle" fill="var(--ink)">要求:send(ticket: Ticket)</text>
<text x="400" y="122" fill="var(--ink)">EmailNotifier ✓</text>
<text x="400" y="146" fill="var(--ink)">WechatBot     ✓</text>
<text x="400" y="178" fill="var(--ink-faint)">TextOnly  ✗ 签名不对</text>
<text x="400" y="202" fill="var(--ink-faint)">Silent    ✗ 没有 send</text>
<text x="320" y="238" text-anchor="middle" fill="var(--ink-soft)" font-size="11">运行时两边都一样:有 send 就能调(鸭子类型)</text>
</g>
</svg>
<figcaption>左边是 Python 类的默认规则,和 Java 的 class 一样认继承关系;右边是 Protocol 的规则,和 TS 的 interface 一样只认结构。两边都只影响检查器,运行时 Python 一直是右边那种行为。</figcaption>
</figure>

### 参数名也算在签名里

TextOnly 的报错里有一行 `Parameter name mismatch`,参数名不一样也会被当成不兼容。只有参数名不同、类型完全一样时,检查器还会管吗?新建 `part01/protocol_edges.py` 试一下,顺便试试在运行时用 isinstance 判断:

```python
# agent-zero-lab/part01/protocol_edges.py
from typing import Protocol, runtime_checkable

from ticket_model import Ticket


class Sender(Protocol):
    def send(self, ticket: Ticket) -> None: ...


@runtime_checkable
class CheckedSender(Protocol):
    def send(self, ticket: Ticket) -> None: ...


class OtherName:
    def send(self, t: Ticket) -> None:
        print("  收到", t.id)


class TextOnly:
    def send(self, text: str) -> None:
        print("  只收文字:", text)


ok: Sender = OtherName()
print(isinstance(TextOnly(), CheckedSender))
print(isinstance(OtherName(), Sender))
```

<div class="line-notes">

- `from typing import Protocol, runtime_checkable` runtime_checkable 是一个装饰器,下面解释。
- `@runtime_checkable` 加在 Protocol 上,让它可以用在 isinstance 里。
- `class OtherName:` 只有参数名不同:`t` 而不是 `ticket`,类型都是 Ticket。
- `ok: Sender = OtherName()` 检查器放不放行?
- `print(isinstance(TextOnly(), CheckedSender))` TextOnly 的 send 签名明明不对,运行时会说 True 还是 False?
- `print(isinstance(OtherName(), Sender))` 对没加 runtime_checkable 的 Sender 用 isinstance。

</div>

```bash
uv run basedpyright part01/protocol_edges.py
uv run python part01/protocol_edges.py
```

检查的实测输出:

```text
protocol_edges.py:26:14 - error: Type "OtherName" is not assignable to declared type "Sender"
    "OtherName" is incompatible with protocol "Sender"
      "send" is an incompatible type
        Type "(t: Ticket) -> None" is not assignable to type "(ticket: Ticket) -> None"
          Parameter name mismatch: "ticket" versus "t" (reportAssignmentType)
protocol_edges.py:27:18 - error: Class overlaps "CheckedSender" unsafely and could produce a match at runtime
    Attributes of "TextOnly" have the same names as the protocol (reportGeneralTypeIssues)
protocol_edges.py:28:18 - error: Class overlaps "Sender" unsafely and could produce a match at runtime
    Attributes of "OtherName" have the same names as the protocol (reportGeneralTypeIssues)
protocol_edges.py:28:31 - error: Second argument to "isinstance" must be a class or tuple of classes
    Protocol class must be @runtime_checkable to be used with instance and class checks (reportArgumentType)
4 errors, 0 warnings, 0 notes
```

运行的实测输出(路径缩短了,typing 内部那一层保留):

```text
True
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/protocol_edges.py", line 28, in <module>
    print(isinstance(OtherName(), Sender))
          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File ".../python3.12/typing.py", line 1917, in __instancecheck__
    raise TypeError("Instance and class checks can only be used with"
TypeError: Instance and class checks can only be used with @runtime_checkable protocols
```

三件事。

**参数名不同也不行。** 为什么检查器连名字都管?因为 Python 可以用关键字传参(Day 29):别人写 `ch.send(ticket=t)`,对 OtherName 来说实测是 `TypeError: OtherName.send() got an unexpected keyword argument 'ticket'`。所以实现 Protocol 时,参数名照抄 Protocol 里的。

**runtime_checkable 只查名字。** `isinstance(TextOnly(), CheckedSender)` 运行时打印了 `True`,可 TextOnly 的 send 收的是文字,根本不是一个合格的 Sender。运行时的检查只看「有没有叫 send 的属性」,不看参数。检查器那两条 `Class overlaps ... unsafely` 就是在提醒你这一点:运行时这个判断可能会「误认」。所以我不推荐用 isinstance 去判断 Protocol,类型交给检查器,运行时要可靠的检查就自己写。

**不加 runtime_checkable 根本不能 isinstance。** 和 Day 47 的 TypedDict 一样,Protocol 默认只给检查器用,运行时拿它判断直接 TypeError。

### Protocol 和继承怎么选

学了 Protocol,是不是 Day 42 的父类 Notifier 就白写了?不是,它们管的事不一样。Notifier 父类带着**共用的代码**(to、sent、format),子类继承了能少写很多;Sender 协议**一行实现都没有**,它只是对「我需要什么」的描述。我的习惯是:

- 函数参数的类型,尽量写成 Protocol,只写出这个函数真正要用的方法。notify_all 只调 send,参数就只要求有 send,谁都能来。
- 一组类之间有大量重复代码,用继承把重复的部分放进父类。

这两个可以同时用,而且经常同时用:EmailNotifier 继承 Notifier 拿到共用代码,同时它也自动满足 Sender,不需要多写一个字。

## 第二步:给假的大模型客户端写类型

Protocol 在 Agent 代码里最常见的用途,是给「调大模型的客户端」定接口。第二部分会写一个真的客户端,它要联网、要 API key、每次调用花钱。可很多代码(拼消息、处理回复、重试逻辑)根本不需要真模型就能验证,这时就用一个**假客户端**:不联网,按顺序吐出事先准备好的回复,还把收到的消息记下来供你检查。旧课里这个假客户端叫 FakeClient,我们沿用这个名字。

真客户端和假客户端是两个毫不相干的类,用它们的函数怎么写参数类型?写真客户端的类名,假客户端就会像 WechatBot 一样被拒;写 Any,检查器就什么都不查。答案是写一个 Protocol。新建 `part01/fake_client.py`:

```python
# agent-zero-lab/part01/fake_client.py
from typing import Literal, Protocol, TypedDict

Role = Literal["system", "user", "assistant"]


class Message(TypedDict):
    role: Role
    content: str


class ChatClient(Protocol):
    def chat(self, messages: list[Message]) -> str: ...


class FakeClient:
    def __init__(self, replies: list[str]):
        self.replies = replies
        self.seen: list[list[Message]] = []

    def chat(self, messages: list[Message]) -> str:
        self.seen.append(messages)
        return self.replies[len(self.seen) - 1]


def draft_reply(client: ChatClient, title: str) -> str:
    messages: list[Message] = [
        {"role": "system", "content": "你是云簿的客服,用一句话回复客户。"},
        {"role": "user", "content": f"工单标题:{title}"},
    ]
    return client.chat(messages).strip()


if __name__ == "__main__":
    fake = FakeClient(["  您好,重复扣的 89.5 元会在 3 个工作日内退回。 ", "您好,发票已重新开具。"])
    print(draft_reply(fake, "扣费两次"))
    print(draft_reply(fake, "发票抬头开错了"))
    print(len(fake.seen), fake.seen[1][1]["content"])
```

<div class="line-notes">

- `Role = Literal["system", "user", "assistant"]` Day 47 练习 5 的三种角色。
- `class Message(TypedDict):` 一条消息的形状,和 Day 47 练习 5 一样。那个文件顶层有打印代码、没有 main guard,所以这里重新定义一次,不去 import 它。
- `class ChatClient(Protocol):` 「能聊天的客户端」:任何有这个 chat 方法的对象都算。
- `def chat(self, messages: list[Message]) -> str: ...` 收一串消息,返回模型回复的文字。这是一个简化版:第二部分的真客户端返回的不只是文字,还有 token 数、花费这些信息,到时候这个 Protocol 会跟着改。现在先用最简单的形状把思路走通。
- `class FakeClient:` 不继承 ChatClient,也不继承任何类。
- `def __init__(self, replies: list[str]):` 造的时候把「剧本」传进来:第几次被调用就回第几条。
- `self.seen: list[list[Message]] = []` 记下每次收到的消息列表。类型读作「消息列表组成的列表」,一次调用一个消息列表。空容器写标注(Day 46)。
- `self.seen.append(messages)` 先记下来,再回复。
- `return self.replies[len(self.seen) - 1]` 第 1 次调用时 seen 长度是 1,取 `replies[0]`;第 2 次取 `replies[1]`。剧本用完了会怎样?练习 3 会看到。
- `def draft_reply(client: ChatClient, title: str) -> str:` 参数标成 Protocol,真假客户端都能传。这个函数今天只会收到 FakeClient,但它的写法已经是「以后接真模型也不用改」的样子。
- `messages: list[Message] = [` 标上 `list[Message]`,两条消息的 role 和 content 都会被对照检查。
- `{"role": "system", "content": "你是云簿的客服,用一句话回复客户。"},` system 消息给模型定规矩。
- `{"role": "user", "content": f"工单标题:{title}"},` user 消息是这次的问题。
- `return client.chat(messages).strip()` 模型回复经常带首尾空白,strip 去掉(Day 16)。检查器知道 chat 返回 str,所以 `.strip()` 能补全。
- `fake = FakeClient(["  您好,重复扣的 89.5 元会在 3 个工作日内退回。 ", "您好,发票已重新开具。"])` 第一条回复故意前后带空格。
- `print(len(fake.seen), fake.seen[1][1]["content"])` 一共被调了几次,第二次调用的第二条消息(user)内容是什么。用假客户端写代码时,检查「发给模型的是什么」往往比检查回复更有用。

</div>

再写两个不合格的假客户端,新建 `part01/fake_client_bad.py`:

```python
# agent-zero-lab/part01/fake_client_bad.py
from fake_client import ChatClient, Message, draft_reply


class DictFake:
    def chat(self, messages: list[Message]) -> dict[str, str]:
        return {"content": "您好"}


class TypoFake:
    def caht(self, messages: list[Message]) -> str:
        return "您好"


print(draft_reply(DictFake(), "扣费两次"))
client: ChatClient = TypoFake()
```

<div class="line-notes">

- `from fake_client import ChatClient, Message, draft_reply` fake_client.py 的演示在 main guard 里,导入不会跑。
- `def chat(self, messages: list[Message]) -> dict[str, str]:` 返回的是字典,不是文字。真实场景里这很常见:SDK 返回的是一个对象,你忘了取里面的文字就直接返回了。
- `def caht(self, messages: list[Message]) -> str:` 方法名拼错。
- `print(draft_reply(DictFake(), "扣费两次"))` 运行时会在 draft_reply 里的 `.strip()` 处出事。

</div>

```bash
uv run basedpyright part01/fake_client.py part01/fake_client_bad.py
uv run python part01/fake_client.py
uv run python part01/fake_client_bad.py
```

检查的实测输出:

```text
fake_client_bad.py:15:19 - error: Argument of type "DictFake" cannot be assigned to parameter "client" of type "ChatClient" in function "draft_reply"
    "DictFake" is incompatible with protocol "ChatClient"
      "chat" is an incompatible type
        Type "(messages: list[Message]) -> dict[str, str]" is not assignable to type "(messages: list[Message]) -> str"
          Function return type "dict[str, str]" is incompatible with type "str"
            "dict[str, str]" is not assignable to "str" (reportArgumentType)
fake_client_bad.py:16:22 - error: Type "TypoFake" is not assignable to declared type "ChatClient"
    "TypoFake" is incompatible with protocol "ChatClient"
      "chat" is not present (reportAssignmentType)
2 errors, 0 warnings, 0 notes
```

fake_client.py 本身 0 报错,FakeClient 不继承任何东西就通过了检查,这正是大纲里今天要验证的事。两个坏的各报一条,DictFake 那条第五层写得很清楚:返回类型 `dict[str, str]` 和 `str` 不兼容。

运行 fake_client.py 的实测输出:

```text
您好,重复扣的 89.5 元会在 3 个工作日内退回。
您好,发票已重新开具。
2 工单标题:发票抬头开错了
```

首尾空格被 strip 掉了;seen 里记了两次调用,第二次的 user 消息是「工单标题:发票抬头开错了」。运行 fake_client_bad.py 的实测输出(只留最后几行):

```text
  File "/Users/你/agent-zero-lab/part01/fake_client.py", line 31, in draft_reply
    return client.chat(messages).strip()
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^
AttributeError: 'dict' object has no attribute 'strip'
```

看报错的位置:崩在 `fake_client.py` 的第 31 行,也就是 draft_reply 里面,而真正写错的是 `fake_client_bad.py` 的 DictFake。运行时的报错总是出现在「用到它的地方」,检查器的红线出现在「传错的地方」(fake_client_bad.py 第 15 行)。哪个更好找,不用多说。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="draft_reply 只依赖 ChatClient 协议;今天传进去的是 FakeClient,第二部分换成真客户端 LLMClient,两者都满足 chat 方法,draft_reply 一行不改">
<rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="80" width="170" height="60" rx="4" fill="none" stroke="var(--rule)"/>
<text x="105" y="106" text-anchor="middle" fill="var(--ink)">draft_reply</text>
<text x="105" y="126" text-anchor="middle" fill="var(--ink-soft)" font-size="11">(client: ChatClient)</text>
<rect x="235" y="80" width="170" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="106" text-anchor="middle" fill="var(--ink)">ChatClient</text>
<text x="320" y="126" text-anchor="middle" fill="var(--ink-soft)" font-size="11">chat(messages) -> str</text>
<line x1="190" y1="110" x2="235" y2="110" stroke="var(--rule)"/>
<rect x="450" y="30" width="170" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="535" y="54" text-anchor="middle" fill="var(--ink)">FakeClient</text>
<text x="535" y="74" text-anchor="middle" fill="var(--ink-soft)" font-size="11">今天 · 0 元 · 不联网</text>
<rect x="450" y="134" width="170" height="56" rx="4" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="535" y="158" text-anchor="middle" fill="var(--ink-soft)">真客户端</text>
<text x="535" y="178" text-anchor="middle" fill="var(--ink-faint)" font-size="11">第二部分 · 要 key · 花钱</text>
<line x1="405" y1="100" x2="450" y2="60" stroke="var(--mem)"/>
<line x1="405" y1="120" x2="450" y2="160" stroke="var(--mem)" stroke-dasharray="4 3"/>
<text x="428" y="74" fill="var(--ink-faint)" font-size="11">满足</text>
<text x="428" y="158" fill="var(--ink-faint)" font-size="11">满足</text>
</g>
</svg>
<figcaption>draft_reply 只认「有 chat 方法」这一条。今天拿假客户端把逻辑跑通,以后换成真客户端,draft_reply 一行不用改,两个客户端之间也不需要任何继承关系。</figcaption>
</figure>

## 第三步:TypeVar,传进什么就返回什么

换一个问题。工单列表、工单号列表、客户列表,经常要「取第一个,没有就返回 None」。写成一个通用函数,参数和返回值怎么标?新建 `part01/generic_first.py`,把三种写法放在一起比:

```python
# agent-zero-lab/part01/generic_first.py
from typing import Any, reveal_type

from ticket_model import Ticket


def first_any(items: list[Any]) -> Any:
    return items[0] if items else None


def first_obj(items: list[object]) -> object:
    return items[0] if items else None


def first[T](items: list[T]) -> T | None:
    return items[0] if items else None


tickets = [Ticket("T-1004", "扣费两次", 89.5), Ticket("T-1005", "API 调用超额", 120)]
ids = ["T-1004", "T-1005"]

c = first(tickets)
reveal_type(c)
reveal_type(first(ids))
if c is not None:
    print(c.title, first(ids), first([]))

b = first_obj([tickets[0], tickets[1]])
reveal_type(b)
print(b.title)

a = first_any(tickets)
reveal_type(a)
print(a.titel)
```

<div class="line-notes">

- `def first_any(items: list[Any]) -> Any:` 写法一:Any。什么都能进,出来的也是 Any。
- `return items[0] if items else None` 空列表为假(Day 17),有东西就取第一个。三个函数的函数体一模一样,区别全在签名上。
- `def first_obj(items: list[object]) -> object:` 写法二:object,Day 46 第四步讲过,它是「任何值」,但检查器不让你随便用。
- `def first[T](items: list[T]) -> T | None:` 写法三:泛型。函数名后面的 `[T]` 声明一个**类型变量**(type variable)T,意思是「这里有一个类型,具体是什么,等调用时看传进来的东西再定」。`list[T]` 进,`T | None` 出,两个 T 是同一个。≈ TS 的 `function first<T>(items: T[]): T | undefined`。这种方括号写法是 Python 3.12 新加的,我们的项目就是 3.12。
- `tickets = [Ticket("T-1004", "扣费两次", 89.5), Ticket("T-1005", "API 调用超额", 120)]` 检查器推断为 `list[Ticket]`。
- `ids = ["T-1004", "T-1005"]` 推断为 `list[str]`。
- `c = first(tickets)` 传 `list[Ticket]` 进去,T 就定成 Ticket。
- `reveal_type(c)` 应该是 `Ticket | None`。
- `reveal_type(first(ids))` 同一个函数,传 `list[str]`,T 就定成 str。
- `if c is not None:` 返回值带 None,用之前照例收窄(Day 46)。
- `print(c.title, first(ids), first([]))` 收窄后 c 是 Ticket,`.title` 能补全。
- `b = first_obj([tickets[0], tickets[1]])` 直接把列表写在括号里传。为什么不传 tickets 变量?常见误区里会说。
- `print(b.title)` b 的类型是 object,检查器不让你取 title。
- `a = first_any(tickets)` Any 版本。
- `print(a.titel)` 故意拼错,看检查器管不管。

</div>

```bash
uv run basedpyright part01/generic_first.py
uv run python part01/generic_first.py
```

检查的实测输出:

```text
generic_first.py:23:13 - information: Type of "c" is "Ticket | None"
generic_first.py:24:13 - information: Type of "first(ids)" is "str | None"
generic_first.py:29:13 - information: Type of "b" is "object"
generic_first.py:30:9 - error: Cannot access attribute "title" for class "object"
    Attribute "title" is unknown (reportAttributeAccessIssue)
generic_first.py:33:13 - information: Type of "a" is "Any"
1 error, 0 warnings, 4 notes
```

运行的实测输出(路径缩短了):

```text
Runtime type is 'Ticket'
Runtime type is 'str'
扣费两次 T-1004 None
Runtime type is 'Ticket'
扣费两次
Runtime type is 'Ticket'
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/generic_first.py", line 34, in <module>
    print(a.titel)
          ^^^^^^^
AttributeError: 'Ticket' object has no attribute 'titel'. Did you mean: 'title'?
```

三种写法,三种结果,放在一张表里看:

| 写法 | 传 `list[Ticket]` 进去,出来的类型 | 能 `.title` 吗 | 拼错 `.titel` 呢 |
| --- | --- | --- | --- |
| `list[Any] -> Any` | Any | 能 | 检查器不管,运行时崩 |
| `list[object] -> object` | object | 红线,不让用 | 也不让用 |
| `def first[T](list[T]) -> T \| None` | `Ticket \| None` | 收窄后能 | 红线 |

Any 是「我不管了」,什么都放行,连拼错都放行;object 是「我什么都不知道」,什么都不让做,b 运行时明明是 Ticket,`.title` 也明明能跑(实测打出了「扣费两次」),检查器还是拦着;泛型是「进来什么就出去什么」,信息一点不丢。写通用函数时,这一行签名决定了用它的人能得到多少帮助。

### 老写法:TypeVar

方括号写法是 3.12 才有的。在这之前,类型变量要先用 `TypeVar` 单独造出来,你读库和框架源码时会大量看到这种写法:

```python
from typing import TypeVar

T = TypeVar("T")


def first(items: list[T]) -> T | None:
    return items[0] if items else None
```

<div class="line-notes">

- `T = TypeVar("T")` 造一个类型变量,赋给名字 T。引号里的名字要和左边一致,这是 TypeVar 的规定。
- `def first(items: list[T]) -> T | None:` 函数名后面不再写 `[T]`,直接用模块里的 T。

</div>

意思完全一样,检查器的推断也一样(下面 by_id_old 会实测)。区别在于老写法的 T 是个模块级的变量,好几个函数共用一个 T 时,读的人得往上翻才知道它是什么;新写法的 T 写在函数名旁边,作用范围一眼就清楚。新代码用新写法,读到老写法知道是一回事就行。今天的标题写的是 TypeVar,因为这个名字你会在文档和源码里反复见到,而新写法在 typing 文档里也叫 type parameter(类型参数),本质上还是类型变量。

### 给 T 加个上限:`[T: HasId]`

再进一步。写一个「按 id 查找」的通用函数:工单有 id,客户也有 id。函数里要读 `item.id`,可光写 `[T]`,T 可以是任何类型,检查器不知道它有没有 id。这时给 T 加一个上限(bound):「T 可以是任何类型,只要它有 id」。「有 id」怎么表达?又是一个 Protocol。新建 `part01/generic_bound.py`:

```python
# agent-zero-lab/part01/generic_bound.py
from typing import Protocol, TypeVar, reveal_type

from ticket_model import Ticket


class HasId(Protocol):
    id: str


class Customer:
    def __init__(self, id: str, name: str):
        self.id = id
        self.name = name


def by_id[T: HasId](items: list[T], id: str) -> T | None:
    for item in items:
        if item.id == id:
            return item
    return None


U = TypeVar("U", bound=HasId)


def by_id_old(items: list[U], id: str) -> U | None:
    for item in items:
        if item.id == id:
            return item
    return None


tickets = [Ticket("T-1004", "扣费两次", 89.5), Ticket("T-1005", "API 调用超额", 120)]
customers = [Customer("C-001", "李雷"), Customer("C-002", "韩梅梅")]

t = by_id(tickets, "T-1005")
c = by_id_old(customers, "C-002")
reveal_type(t)
reveal_type(c)
if t is not None and c is not None:
    print(t.title, c.name)

print(by_id(["T-1004", "T-1005"], "T-1004"))
```

<div class="line-notes">

- `class HasId(Protocol):` 这个 Protocol 里没有方法,只有一个属性。
- `id: str` 意思是「有一个叫 id 的属性,值是 str」。Ticket 在 `__init__` 里写了 `self.id = id`,检查器从那一行知道它有 str 类型的 id,所以 Ticket 满足 HasId,一个字都不用改。
- `class Customer:` 一个和 Ticket 毫无关系的类,也有 id。
- `def by_id[T: HasId](items: list[T], id: str) -> T | None:` `T: HasId` 读作「T 必须满足 HasId」,≈ TS 的 `function byId<T extends HasId>(...)`。冒号在这里不是类型标注,是「上限」的意思。
- `if item.id == id:` 因为 T 有上限,检查器知道 item 一定有 id,这一行不会红。去掉 `: HasId` 我试过,这一行实测报 `Cannot access attribute "id" for class "object*"`:没有上限的 T,检查器只能当它是 object。
- `return item` 返回的还是 T,不是 HasId。这一点很关键,下面 reveal_type 会看到。
- `U = TypeVar("U", bound=HasId)` 老写法的上限:`bound=` 参数。
- `def by_id_old(items: list[U], id: str) -> U | None:` 和 by_id 完全一样,只是写法老。
- `t = by_id(tickets, "T-1005")` 传工单列表。
- `c = by_id_old(customers, "C-002")` 传客户列表,用老写法的版本。
- `if t is not None and c is not None:` 两个都收窄。
- `print(t.title, c.name)` t 是 Ticket 才有 title,c 是 Customer 才有 name。
- `print(by_id(["T-1004", "T-1005"], "T-1004"))` 字符串没有 id 属性,不满足上限。

</div>

```bash
uv run basedpyright part01/generic_bound.py
uv run python part01/generic_bound.py
```

检查的实测输出:

```text
generic_bound.py:39:13 - information: Type of "t" is "Ticket | None"
generic_bound.py:40:13 - information: Type of "c" is "Customer | None"
generic_bound.py:44:13 - error: Argument of type "list[str]" cannot be assigned to parameter "items" of type "list[T@by_id]" in function "by_id"
    Type "Literal['T-1004']" is not assignable to type "HasId"
      "Literal['T-1004']" is incompatible with protocol "HasId"
        "id" is not present
    Type "Literal['T-1005']" is not assignable to type "HasId"
      "Literal['T-1005']" is incompatible with protocol "HasId"
        "id" is not present (reportArgumentType)
1 error, 0 warnings, 2 notes
```

运行的实测输出(路径缩短了):

```text
Runtime type is 'Ticket'
Runtime type is 'Customer'
API 调用超额 韩梅梅
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/generic_bound.py", line 44, in <module>
    print(by_id(["T-1004", "T-1005"], "T-1004"))
          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/你/agent-zero-lab/part01/generic_bound.py", line 19, in by_id
    if item.id == id:
       ^^^^^^^
AttributeError: 'str' object has no attribute 'id'
```

reveal_type 的结果是 `Ticket | None` 和 `Customer | None`,不是 `HasId | None`。如果 by_id 的返回类型直接写 `HasId | None`(不用泛型),返回值就只剩「有 id」这一条信息,`t.title` 会红线。**泛型加上限,让函数内部能用 id,又让调用方拿回完整的类型**,两头都不亏。

报错里的 `T@by_id` 是检查器给类型变量起的全名:「by_id 这个函数里的 T」,和别的函数里的 T 区分开。老写法的 U 在报错里也会这样显示。

## 把零件拼起来:reply_drafts.py

用今天的东西给记事本里的未关闭工单批量起草回复:按顺序用假客户端起草,再用另一个「回显」假客户端检查某几张工单发给模型的内容长什么样。新建 `part01/reply_drafts.py`:

```python
# agent-zero-lab/part01/reply_drafts.py
import sys
from pathlib import Path
from typing import Protocol

from fake_client import ChatClient, FakeClient, Message
from ticket_model import Ticket, load

BOOK = Path(__file__).resolve().parent / "data" / "notebook.json"
SYSTEM = "你是云簿的客服,用一句话回复客户。"


class HasId(Protocol):
    id: str


class EchoClient:
    def chat(self, messages: list[Message]) -> str:
        return f"(回显) {messages[-1]['content']}"


def by_id[T: HasId](items: list[T], id: str) -> T | None:
    for item in items:
        if item.id == id:
            return item
    return None


def build_messages(t: Ticket) -> list[Message]:
    return [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": f"工单 {t.id}:{t.title},金额 ¥{t.amount}"},
    ]


def draft_all(client: ChatClient, tickets: list[Ticket]) -> dict[str, str]:
    drafts: dict[str, str] = {}
    for t in tickets:
        if t.is_closed:
            continue
        drafts[t.id] = client.chat(build_messages(t)).strip()
    return drafts


def main(argv: list[str]) -> int:
    tickets = load(BOOK)
    fake = FakeClient([
        "您好,年付升级已生效,差价会在下一张发票里体现。",
        "您好,重复扣的款会在 3 个工作日内原路退回。",
        "您好,超额部分已按套餐价重新计算。 ",
    ])
    for id, text in draft_all(fake, tickets).items():
        print(f"{id}: {text}")
    print("假客户端被调用", len(fake.seen), "次")

    for id in argv:
        t = by_id(tickets, id)
        if t is None:
            print(f"{id}: 没有这张工单")
            continue
        print(draft_all(EchoClient(), [t]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

<div class="line-notes">

- `from fake_client import ChatClient, FakeClient, Message` 第二步写好的协议、假客户端和消息形状,一处定义到处用。
- `from ticket_model import Ticket, load` Day 40 起就有的 load,返回 `list[Ticket]`。
- `class HasId(Protocol):` 和第三步一样。这里重新写一份,是因为 generic_bound.py 没有 main guard,import 它会把那段崩溃的演示也跑一遍。
- `class EchoClient:` 第二个假客户端:不按剧本回复,而是把最后一条消息原样回显。用来检查「发给模型的到底是什么」。它和 FakeClient 没有任何关系,都满足 ChatClient。
- `return f"(回显) {messages[-1]['content']}"` `messages[-1]` 是最后一条(Day 21 的负数下标),取出它的 content。f-string 外面用双引号,里面取键就用单引号,两种引号别撞上。
- `def by_id[T: HasId](items: list[T], id: str) -> T | None:` 第三步的泛型函数。这里传进去的是 Ticket 列表,返回的就是 `Ticket | None`。
- `def build_messages(t: Ticket) -> list[Message]:` 把「拼消息」单独抽出来,返回类型 `list[Message]` 保证每条的 role 都拼对了。
- `{"role": "user", "content": f"工单 {t.id}:{t.title},金额 ¥{t.amount}"},` 代入 T-1004 是 `工单 T-1004:扣费两次,金额 ¥89.5`。
- `def draft_all(client: ChatClient, tickets: list[Ticket]) -> dict[str, str]:` 客户端参数写 Protocol,所以下面两种假客户端都能传进来。
- `if t.is_closed:` 已关闭的不起草。notebook.json 里 T-1001 已关,会被跳过。
- `drafts[t.id] = client.chat(build_messages(t)).strip()` 起草一张,按工单号存进字典。
- `fake = FakeClient([` 三条剧本,对应三张未关闭的工单,第三条故意在末尾多一个空格。
- `print("假客户端被调用", len(fake.seen), "次")` 应该是 3 次,不多不少。如果是 4 次,说明已关闭的也被起草了。
- `for id in argv:` 命令行里给的工单号,挨个用回显客户端检查。
- `t = by_id(tickets, id)` 类型是 `Ticket | None`。
- `if t is None:` 收窄,打一句提示接着下一个。
- `print(draft_all(EchoClient(), [t]))` 只放一张工单进去。如果这张已关闭,draft_all 会跳过它,得到空字典。

</div>

```bash
uv run basedpyright part01/reply_drafts.py
uv run python part01/reply_drafts.py T-1004 T-1001 T-9999
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
T-1002: 您好,年付升级已生效,差价会在下一张发票里体现。
T-1004: 您好,重复扣的款会在 3 个工作日内原路退回。
T-1005: 您好,超额部分已按套餐价重新计算。
假客户端被调用 3 次
{'T-1004': '(回显) 工单 T-1004:扣费两次,金额 ¥89.5'}
{}
T-9999: 没有这张工单
```

T-1001 已关,没有被起草,假客户端正好被调 3 次;第三条回复末尾的空格被 strip 掉了;回显客户端把 T-1004 发给模型的内容原样吐了回来;T-1001 用回显检查时得到空字典,因为它已关闭;T-9999 找不到。

| 今天的零件 | 在 reply_drafts.py 里是哪一段 |
| --- | --- |
| 开头 名义类型 vs 结构类型 | FakeClient、EchoClient 都不继承 ChatClient,照样通过 |
| 第一步 Protocol 方法 | `fake_client.ChatClient`,被 `draft_all` 的参数使用 |
| 第二步 FakeClient、seen | `fake`、`len(fake.seen)` |
| 第三步 泛型函数 | `by_id[T: HasId]` |
| 第三步 Protocol 属性做上限 | `class HasId(Protocol): id: str` |

## 动手练习

### 练习 1:有金额的东西

工单有 amount,退款记录也有 amount。新建 `part01/ex49_amount.py`:写一个 `HasAmount` 协议(`amount: float`)和一个普通类 `Refund`(id、amount 两个属性),再写 `total(items: list[HasAmount]) -> float` 求和。分别传两张退款和一张 Ticket 进去,先检查。如果有红线,读懂它,再修好(修好的版本放在 `part01/ex49_amount_fixed.py`,并且让一张 Ticket 和一张 Refund 能放进同一个列表求和)。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex49_amount.py
from typing import Protocol

from ticket_model import Ticket


class HasAmount(Protocol):
    amount: float


class Refund:
    def __init__(self, id: str, amount: float):
        self.id = id
        self.amount = amount


def total(items: list[HasAmount]) -> float:
    return sum(x.amount for x in items)


print(total([Refund("R-01", 50), Refund("R-02", 30.5)]))
print(total([Ticket("T-1004", "扣费两次", 89.5)]))
```

<div class="line-notes">

- `amount: float` 协议里写属性,和第三步的 `id: str` 一样。
- `self.amount = amount` Refund 的 amount 是普通属性。
- `return sum(x.amount for x in items)` 生成器表达式求和,和 Day 44 里 `sum(t.amount for t in book.tickets)` 一样。
- `print(total([Ticket("T-1004", "扣费两次", 89.5)]))` Ticket 的 amount 是 Day 43 的 property。

</div>

```bash
uv run basedpyright part01/ex49_amount.py
uv run python part01/ex49_amount.py
```

实测输出:

```text
ex49_amount.py:22:14 - error: Argument of type "list[Ticket]" cannot be assigned to parameter "items" of type "list[HasAmount]" in function "total"
    "Ticket" is incompatible with protocol "HasAmount"
      "amount" is invariant because it is mutable
      "amount" is an incompatible type
        "property" is not assignable to "float" (reportArgumentType)
1 error, 0 warnings, 0 notes
80.5
89.5
```

运行完全正常,检查器却不认 Ticket。读里面两层:`"amount" is invariant because it is mutable`,协议里写 `amount: float` 表示「一个可以读也可以随便写的普通属性」;`"property" is not assignable to "float"`,Ticket 的 amount 是 property,检查器认为它不是同一种东西。total 其实只**读** amount,根本不写,那协议里就只要求「能读」。写法是在协议里也用 property:

```python
# agent-zero-lab/part01/ex49_amount_fixed.py
from typing import Protocol

from ticket_model import Ticket


class HasAmount(Protocol):
    @property
    def amount(self) -> float: ...


class Refund:
    def __init__(self, id: str, amount: float):
        self.id = id
        self.amount = amount


def total(items: list[HasAmount]) -> float:
    return sum(x.amount for x in items)


print(total([Refund("R-01", 50), Refund("R-02", 30.5)]))
print(total([Ticket("T-1004", "扣费两次", 89.5), Refund("R-01", 50)]))
```

<div class="line-notes">

- `@property` 协议里的 property 意思是「能读出一个 float」,只要求读,不要求能写。
- `def amount(self) -> float: ...` 和普通 Protocol 方法一样,只写签名。普通属性(Refund)和 property(Ticket)都能读,所以都满足。
- `print(total([Ticket("T-1004", "扣费两次", 89.5), Refund("R-01", 50)]))` 两种完全不相关的类放进同一个列表。

</div>

```bash
uv run basedpyright part01/ex49_amount_fixed.py
uv run python part01/ex49_amount_fixed.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
80.5
139.5
```

89.5 + 50 = 139.5。经验:**协议只要求函数真正要用的那一点**。只读就写 property,这样要求最松,能满足它的东西最多。

</details>

### 练习 2:把 TS 泛型翻译过来

把这段 TS 翻成 Python 3.12 写法,放进 `part01/ex49_last_or.py`:

```ts
function lastOr<T>(items: T[], fallback: T): T {
  return items.length ? items[items.length - 1] : fallback;
}
```

然后用 reveal_type 看三次调用的结果:字符串列表配字符串默认值、`[199, 89.5]` 配 0、`[199, 120]` 配 `"无"`。先猜第三个会怎样。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex49_last_or.py
from typing import reveal_type


def last_or[T](items: list[T], fallback: T) -> T:
    return items[-1] if items else fallback


reveal_type(last_or(["T-1004", "T-1005"], "无"))
reveal_type(last_or([199, 89.5], 0))
reveal_type(last_or([199, 120], "无"))
empty: list[str] = []
print(last_or(empty, "无"), last_or([199, 120], 0))
```

<div class="line-notes">

- `def last_or[T](items: list[T], fallback: T) -> T:` 两个参数用同一个 T,意思是「默认值和列表元素是同一种类型」。返回值不带 None,因为空列表时有默认值顶上。
- `return items[-1] if items else fallback` `items[-1]` 是最后一个,对应 TS 的 `items[items.length - 1]`。
- `reveal_type(last_or([199, 89.5], 0))` 列表里有整数也有小数。
- `reveal_type(last_or([199, 120], "无"))` 整数列表配一个字符串默认值。
- `empty: list[str] = []` 空列表要写标注,不然 T 推不出来。
- `print(last_or(empty, "无"), last_or([199, 120], 0))` 空列表拿到默认值「无」,另一个拿到 120。

</div>

```bash
uv run basedpyright part01/ex49_last_or.py
uv run python part01/ex49_last_or.py
```

实测输出:

```text
ex49_last_or.py:9:13 - information: Type of "last_or(["T-1004", "T-1005"], "无")" is "str"
ex49_last_or.py:10:13 - information: Type of "last_or([199, 89.5], 0)" is "float"
ex49_last_or.py:11:13 - information: Type of "last_or([199, 120], "无")" is "int"
ex49_last_or.py:11:33 - error: Argument of type "Literal['无']" cannot be assigned to parameter "fallback" of type "T@last_or" in function "last_or"
    "Literal['无']" is not assignable to "int" (reportArgumentType)
1 error, 0 warnings, 3 notes
Runtime type is 'str'
Runtime type is 'float'
Runtime type is 'int'
无 120
```

第二个是 float:列表里有 89.5,T 定成 float,默认值 0 是 int,int 能当 float 用(Day 45),没问题。第三个,检查器先从列表定下 T 是 int,再看默认值 `"无"` 放不进 int,于是报错。这和 TS 的行为一样,TS 里同样的调用也会报「string 不能赋给 number」。同一个 T 出现在两个参数上,就是在要求这两个参数类型一致。

</details>

### 练习 3:剧本用完了

第二步的 FakeClient 准备了几条回复,被调用的次数超过了会怎样?新建 `part01/ex49_fake_more.py`,写一个 `ScriptedClient`,行为和 FakeClient 一样,但剧本用完时抛出一个说清楚情况的 `AssertionError`。再拿老的 FakeClient 多调一次做对比。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex49_fake_more.py
from fake_client import ChatClient, FakeClient, Message, draft_reply


class ScriptedClient:
    def __init__(self, replies: list[str]):
        self.replies = replies
        self.seen: list[list[Message]] = []

    def chat(self, messages: list[Message]) -> str:
        self.seen.append(messages)
        if len(self.seen) > len(self.replies):
            raise AssertionError(f"只准备了 {len(self.replies)} 条回复,却被调用了第 {len(self.seen)} 次")
        return self.replies[len(self.seen) - 1]


client: ChatClient = ScriptedClient(["好的"])
print(draft_reply(client, "扣费两次"))
try:
    draft_reply(client, "发票抬头开错了")
except AssertionError as e:
    print("测试数据不够:", e)

old = FakeClient(["好的"])
draft_reply(old, "扣费两次")
draft_reply(old, "发票抬头开错了")
```

<div class="line-notes">

- `if len(self.seen) > len(self.replies):` 第 2 次调用时 seen 长度 2,剧本只有 1 条。
- `raise AssertionError(` AssertionError 是 Python 内置的「本来以为一定成立的事没成立」。用它而不是 TicketError,是因为这不是业务错误,是测试数据没准备够,以后写测试(Day 71 起)时 pytest 对它有专门的显示。
- `client: ChatClient = ScriptedClient(["好的"])` 顺手标成 ChatClient,确认它满足协议。
- `draft_reply(old, "发票抬头开错了")` 老的 FakeClient 剧本也只有一条。

</div>

```bash
uv run basedpyright part01/ex49_fake_more.py
uv run python part01/ex49_fake_more.py
```

实测输出(路径缩短了):

```text
0 errors, 0 warnings, 0 notes
好的
测试数据不够: 只准备了 1 条回复,却被调用了第 2 次
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex49_fake_more.py", line 26, in <module>
    draft_reply(old, "发票抬头开错了")
  File "/Users/你/agent-zero-lab/part01/fake_client.py", line 31, in draft_reply
    return client.chat(messages).strip()
           ^^^^^^^^^^^^^^^^^^^^^
  File "/Users/你/agent-zero-lab/part01/fake_client.py", line 23, in chat
    return self.replies[len(self.seen) - 1]
           ~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^
IndexError: list index out of range
```

两种报错放在一起比:`IndexError: list index out of range` 你得顺着 traceback 往上读三层,才明白是剧本不够;ScriptedClient 那句话一眼就懂。假客户端以后是你测试 Agent 的主要工具,Agent 多调了一次模型往往就意味着循环逻辑有 bug,报错说清楚能省很多时间。

</details>

### 练习 4:让 NotifyCenter 接受企业微信

Day 42 的 NotifyCenter 构造参数是 `list[Notifier]`。新建 `part01/ex49_center.py`,写一个参数改成 `list[Sender]` 的 NotifyCenter(close_ticket 的逻辑照抄),让 EmailNotifier 和 WechatBot 一起放进去,basedpyright 0 报错。不要改 notifiers.py。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex49_center.py
from typing import Protocol

from notifiers import EmailNotifier
from ticket_model import Ticket, TicketError


class Sender(Protocol):
    def send(self, ticket: Ticket) -> None: ...


class WechatBot:
    def __init__(self, group: str):
        self.group = group

    def send(self, ticket: Ticket) -> None:
        print(f"  企业微信 -> {self.group}: 工单 {ticket.id} 状态 {ticket.status}")


class NotifyCenter:
    def __init__(self, channels: list[Sender]):
        self.channels = channels

    def close_ticket(self, ticket: Ticket) -> int:
        if ticket.status == "closed":
            raise TicketError(f"{ticket.id} 已经是关闭状态")
        ticket.close()
        for ch in self.channels:
            ch.send(ticket)
        return len(self.channels)


center = NotifyCenter([EmailNotifier("li@beichen.com"), WechatBot("财务群")])
print("发出", center.close_ticket(Ticket("T-1005", "API 调用超额", 120)), "条")
```

<div class="line-notes">

- `class Sender(Protocol):` 和第一步一样。protocol_basic.py 顶层有演示代码,所以这里自己写一份。
- `class WechatBot:` 同上。
- `def __init__(self, channels: list[Sender]):` 唯一的实质改动。
- `center = NotifyCenter([EmailNotifier("li@beichen.com"), WechatBot("财务群")])` EmailNotifier 来自 notifiers.py,一行没改,它天然满足 Sender。

</div>

```bash
uv run basedpyright part01/ex49_center.py
uv run python part01/ex49_center.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
  邮件 -> li@beichen.com: [云簿客服] 工单 T-1005「API 调用超额」当前状态 closed
  企业微信 -> 财务群: 工单 T-1005 状态 closed
发出 2 条
```

渠道父类 Notifier 还在,邮件、短信照样继承它复用代码;通知中心只认 Sender。以后谁写了新渠道,不管继不继承 Notifier,只要 send 的签名对,就能放进来。

</details>

验收标准:`uv run basedpyright part01/fake_client.py part01/reply_drafts.py part01/ex49_amount_fixed.py part01/ex49_center.py` 输出 `0 errors`;`reply_drafts.py T-1004 T-1001 T-9999` 的输出和正文一致;不看文章能写出一个带方法的 Protocol 和一个带上限的泛型函数;能说清 Protocol 和继承各解决什么问题,以及 Any、object、T 在通用函数上的区别。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 鸭子类型(duck typing) | 运行时只看对象有没有你要调的方法,不管它是哪个类;Python 和 JS 运行时都是这样 |
| 名义类型(nominal typing) | 检查器按类名和继承关系判断兼容,`list[Notifier]` 只收 Notifier 和它的子类;Python 普通类的默认规则 |
| 结构类型(structural typing) | 检查器只看结构(有哪些方法和属性、签名对不对),不看名字;TS 的 interface 就是这样 |
| Protocol | 声明「有这些方法或属性的东西都算」,`class Sender(Protocol): def send(...) -> None: ...`,≈ TS 的 interface;不需要被继承 |
| `...`(Ellipsis) | 三个点,Protocol 方法体里表示「只有签名,不写实现」 |
| `@runtime_checkable` | 让 Protocol 能用在 isinstance 里,但运行时只检查方法名在不在,不检查参数 |
| 假客户端(FakeClient) | 不联网、按剧本返回固定回复的对象,用来在不花钱的情况下验证调用模型的代码 |
| 泛型(generic) | 写一次,对多种类型都适用,并且保留具体类型信息的函数或类 |
| 类型变量(type variable) | 泛型里那个「待定的类型」,`def first[T](...)` 里的 T;老写法 `T = TypeVar("T")` |
| 上限(bound) | 限制类型变量必须满足某个类型,`[T: HasId]`、`TypeVar("U", bound=HasId)`,≈ TS 的 `T extends HasId` |
| `T@by_id` | 检查器报错里类型变量的全名,意思是「by_id 函数的 T」 |
| invariant(不变) | 报错里会出现的词:可读可写的属性或列表,类型必须完全一样,子类型也不行 |

## 常见误区

**写 Protocol 后又让类去继承它。** `class WechatBot(Sender):` 能运行,但完全没必要,Protocol 的意义就是不用继承。继承了反而会把它变成名义关系,读代码的人还以为它从 Sender 那里拿到了什么实现。

**实现协议时参数名随手起。** Sender 写的是 `send(self, ticket)`,你写成 `send(self, t)`,实测报 `Parameter name mismatch: "ticket" versus "t"`。别人用关键字 `send(ticket=...)` 调用时你的类会出错,所以检查器连名字都要对上。照抄协议里的参数名。

**用 isinstance 判断 Protocol。** 没加 `@runtime_checkable` 实测运行时 `TypeError: Instance and class checks can only be used with @runtime_checkable protocols`;加了也只查名字,`isinstance(TextOnly(), CheckedSender)` 实测返回 True,其实签名完全不对。类型交给检查器,运行时要可靠的检查自己写。

**协议里写普通属性,结果 property 进不来。** `amount: float` 实测拒绝了 Ticket(`"property" is not assignable to "float"`)。只需要读的,协议里写 `@property def amount(self) -> float: ...`。

**通用函数写 Any 图省事。** `first_any` 实测连 `a.titel` 这种拼写错误都放行,运行时才崩。写成 `def first[T](items: list[T]) -> T | None`,出来的类型和进去的一样。

**以为 `list[Ticket]` 能传给 `list[object]`。** 我在第三步的初稿里写的是 `first_obj(tickets)`,实测报错 `"list[Ticket]" is not assignable to "list[object]"`,下面还有一句 `Type parameter "_T@list" is invariant`。原因是列表可以往里加东西:如果允许,函数就能往你的工单列表里塞一个字符串。所以正文里改成了把列表字面量直接写在括号里。这个规则叫「不变」(invariant),现在知道有这回事就行,报错里给的建议(换成只读的 Sequence)以后用到再讲。

**只写 `[T]` 就在函数里取属性。** T 没有上限时可以是任何类型,`item.id` 检查器不认。要用什么,就用 `[T: 某个 Protocol]` 写出来。

**老写法 TypeVar 的名字对不上。** `T = TypeVar("U")` 这种左右不一致的写法,实测报 `TypeVar must be assigned to a variable named "U"`,TypeVar 要求引号里的名字和变量名相同。新代码直接用 3.12 的方括号写法,没有这个问题。

## 学习资料

### 文档与文章

- [Python 标准库 · typing(中文)](https://docs.python.org/zh-cn/3.12/library/typing.html):页内搜 `Protocol`、`runtime_checkable`、`TypeVar`。「泛型」一节同时给了 3.12 新写法和老写法的对照。
- [mypy 文档 · Protocols and structural subtyping](https://mypy.readthedocs.io/en/stable/protocols.html):英文,比官方参考更像教程,开头就把名义类型和结构类型对比讲清楚了,还有一节专讲 Protocol 里的属性和 property(练习 1 的坑)。
- [mypy 文档 · Generics](https://mypy.readthedocs.io/en/stable/generics.html):泛型函数、上限(bound),新旧两种写法都有例子。
- [TypeScript Handbook · Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html) 和 [Type Compatibility](https://www.typescriptlang.org/docs/handbook/type-compatibility.html):TS 那边的对应内容。Generics 里的「Generic Constraints」就是今天的上限;Type Compatibility 开头那段讲的就是结构类型。
- [PEP 544](https://peps.python.org/pep-0544/)(Protocol)和 [PEP 695](https://peps.python.org/pep-0695/)(3.12 的类型参数新写法):提案原文,英文,读 Motivation 一节知道为什么要加就够了。PEP 544 的标题就叫「Structural subtyping (static duck typing)」,静态的鸭子类型。
- [Python typing 规范 · Protocols](https://typing.python.org/en/latest/spec/protocol.html):各个检查器共同遵守的规则原文,碰到「这样算不算满足协议」的问题时来查。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1goigewEzN&autoplay=0&high_quality=1" title="python 类型系统(4)—Protocol" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>zidea2015 · python 类型系统(4)—Protocol · 约 4 分半,2024 年。很短,专讲 Protocol 和鸭子类型的关系,看完第一步再看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1T3L8zHEP5&autoplay=0&high_quality=1" title="Python 泛型Generics" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>智说 · Python 泛型 Generics · 约 4 分钟,2025 年。对应第三步,看它怎么用类型变量保住返回值的类型。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/xvb5hGLoK0A" title="Protocol Or ABC In Python - When to Use Which One?" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>ArjanCodes · Protocol Or ABC In Python - When to Use Which One? · 英文。ABC(抽象基类)是另一种「定接口」的办法,要求继承,我们没讲;这个视频把它和 Protocol 放在一起比,结论和第一步末尾「Protocol 和继承怎么选」那段相近。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/q6ujWWaRdbA" title="Python 3.12 Generic Types Explained" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>ArjanCodes · Python 3.12 Generic Types Explained · 英文,专讲 3.12 的方括号写法和老 TypeVar 的对照,和第三步完全对应。</figcaption>
</figure>

### 书籍

- 《流畅的 Python(第 2 版)》,Luciano Ramalho 著,人民邮电出版社,2023。第 8 章「函数中的类型提示」里有 TypeVar 和「静态协议」两节,正好是今天的两个主题;第 13 章讲接口、协议和抽象基类,把鸭子类型、Protocol、继承放在一起比,适合学完今天以后读。书是按 3.10 写的,泛型用的是 TypeVar 老写法。

### 开源项目与代码

- [python/typeshed 的 `stdlib/_typeshed/__init__.pyi`](https://github.com/python/typeshed/blob/main/stdlib/_typeshed/__init__.pyi):typeshed 是给标准库写类型的官方项目,basedpyright 就靠它知道 `json.loads` 返回什么。在这个文件里搜 `class SupportsRead`,它就是一个 Protocol:「有 read 方法的东西」。`json.load(f)` 的参数 f 标的就是它,所以文件对象、网络响应、你自己写的类,只要有 read 都能传。这和今天的 Sender 是一个思路。

## 自测

1. 把这段 TS 翻成 Python:`interface Pricer { price(plan: string): number }`,再写一个不继承它、但满足它的类 `FlatPricer`,所有套餐都返回 99。

<details><summary>答案</summary>

```python
from typing import Protocol


class Pricer(Protocol):
    def price(self, plan: str) -> float: ...


class FlatPricer:
    def price(self, plan: str) -> float:
        return 99
```

interface 对应 `class X(Protocol)`,方法体写 `...`;FlatPricer 不用继承,参数名 plan 要和协议一致。

</details>

2. 同样是「描述一个能 send 的东西」,父类 Notifier 和协议 Sender 有什么不同?

<details><summary>答案</summary>

Notifier 是真正的类,带着共用的代码(to、sent、format),子类继承它就能复用,检查器按继承关系判断(名义类型)。Sender 只是一份说明,没有任何实现,不用继承,检查器只看结构:有签名对得上的 send 就算(结构类型)。两者可以同时用,EmailNotifier 继承 Notifier,同时自动满足 Sender。

</details>

3. `def first(items: list[Any]) -> Any` 和 `def first[T](items: list[T]) -> T | None` 有什么区别?对 `list[Ticket]` 调用后,哪个能在 `.titel` 拼错时报红线?

<details><summary>答案</summary>

Any 版本返回 Any,检查器在那之后完全不查,`.titel` 不报错,运行时 AttributeError;泛型版本返回 `Ticket | None`,收窄后 `.titel` 会报 `Cannot access attribute`。泛型保留了「进来的是什么」这个信息。

</details>

4. `by_id[T: HasId]` 返回类型写 `T | None`,如果改成 `HasId | None` 会损失什么?

<details><summary>答案</summary>

调用方拿到的只剩「有 id」这一条信息。传工单列表进去,出来的不再是 Ticket,`t.title` 会红线。写成 T,传 Ticket 出来就是 Ticket,传 Customer 出来就是 Customer。

</details>

5. 面试题:你的 Agent 代码要调大模型,但写单元测试时不想联网、不想花钱。你会怎么设计客户端的类型?

<details><summary>答案</summary>

用一个 Protocol 描述「能聊天的客户端」需要的方法(比如 `chat(messages) -> 结果`),业务函数的参数只依赖这个 Protocol,不依赖具体的 SDK 类。生产环境传真客户端,测试时传一个按剧本返回固定回复、并记录收到了哪些消息的假客户端。两者不需要继承关系,类型检查器会保证假客户端的签名和真的一致;测试时还能断言「发给模型的消息长什么样」「一共调了几次」,剧本用完要报清楚的错,因为多调一次模型往往说明循环有 bug。

</details>

## 明天预告

[Day 50 · dataclass:装数据的类](/blog/agent-zero/day-050-dataclass/)。今天的 Customer 类写了一个 `__init__`,里面全是 `self.id = id` 这样的样板代码;Day 43 的 Ticket 还要手写 `__repr__` 和 `to_dict`。明天用 `@dataclass` 让 Python 替你把这些生成出来,再兑现 Day 47 的承诺:把 Ticket 改写成 dataclass,顺手把它的 status 收紧成 Status。
