---
title: 'Day 55 · 第 8 周复习:编程地基(Day 49–54)'
description: '这一周学了 Protocol 和 TypeVar、dataclass、pydantic 两天、环境变量和一个录入工具。今天默写三段核心代码,再只用本周学过的东西拼一个「批量导入客户」的命令行脚本,让它在 basedpyright 下 0 报错,最后把这周实测过的报错整理成一张错题表。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'review', 'agent-zero']
series: 'agent-zero'
day: 55
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 54](/blog/agent-zero/day-054-intake-project/) 把前几天的零件装成了录入工具:键盘输入凑成字典,交给 Day 52 的 `Ticket` 模型校验,通过的存进 JSON,被拦的翻译成中文并记进 JSON Lines 日志。那个工具里一条校验规则都没写,全靠模型。

这一周前三天在学「怎么描述一份数据的样子」:Protocol 描述「有这个方法的东西」,dataclass 描述「一包字段」,pydantic 在 dataclass 的基础上加了「造的时候就检查」。第四天讲数据以外的东西:配置和密钥。第五天是小项目。今天停一天,先把这一周的脉络画出来,再不看文章默写,最后拼一个新东西证明这些零件真的拿得动。

## 今天要解决的问题

学完今天,你应该能:

1. 合上文章默写出三段代码:一个带 Protocol、假客户端和泛型函数的文件,一个带 Field 和校验器的 pydantic 模型加读写 JSON,一个读 `.env` 并给 key 打码的 `load_settings`。跑出和文中一致的结果。
2. 只用这一周的知识拼出 `customer_import.py`:批量导入客户,用 pydantic 拦下不合规矩的行,用 Protocol 让「汇报」可以换成屏幕、文件或测试用的假对象,用 dataclass 装结果,用环境变量切换汇报方式,`uv run basedpyright` 0 报错。
3. 说清 dataclass、`TypedDict`、pydantic `BaseModel` 三者各适合什么场合,不再选错。
4. 看到这周出现过的任何一条报错,不翻文章就能说出病因。

预计用时:3 小时。三段默写各 25 分钟左右,小项目 1 小时,剩下的时间做练习和自测。前置:[Day 49](/blog/agent-zero/day-049-type-hints-4/) 到 [Day 54](/blog/agent-zero/day-054-intake-project/) 全部。今天不装新依赖,不调 API,花费 0 元。

学法和平时一样:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章,把三段默写和 `import_customers` 函数再写一遍;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

命令都在项目根目录 `agent-zero-lab` 里跑,文件放进 `part01/`。小项目会用到根目录的 `.env`、`.env.test`、`.gitignore`(Day 53 建的,里面应该有 `.env`、`.env.*`、`!.env.example` 三行)和 `part01/data/` 目录。先用下面两条命令确认它们在:

```bash
ls -a | grep env
git check-ignore -v .env .env.test .env.example
```

应该看到 `.env`、`.env.example`、`.env.test` 三个文件,以及三条各被 `.gitignore` 的哪一行命中的记录。下面输出里的长路径我缩短了,家目录写成 `/Users/你`。

## 本周知识地图

这周六天可以分成三层。最底下是**怎么描述数据**:Protocol(Day 49)、dataclass(Day 50)、pydantic(Day 51–52),它们回答「这包东西长什么样、谁来保证它长这样」。中间是**数据以外的东西**:配置和密钥(Day 53)。最上面是**用它们做一个真东西**(Day 54)。今天的小项目横跨三层。

<figure>
<svg viewBox="0 0 640 310" role="img" aria-label="本周知识地图:底层是 Day 49 Protocol 和 TypeVar、Day 50 dataclass、Day 51 到 52 pydantic 三种描述数据的方式;中层是 Day 53 环境变量和密钥;上层是 Day 54 录入工具,把它们装在一起;今天的 customer_import.py 横跨三层">
<rect x="0" y="0" width="640" height="310" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="16" y="26" fill="var(--ink-faint)" font-size="11">用它们做真东西</text>
<rect x="16" y="34" width="608" height="48" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="63" text-anchor="middle" fill="var(--ink)">Day 54 intake.py · 键盘 → 模型校验 → JSON + 被拦日志</text>
<text x="16" y="110" fill="var(--ink-faint)" font-size="11">数据以外:配置和密钥</text>
<rect x="16" y="118" width="608" height="48" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="147" text-anchor="middle" fill="var(--ink)">Day 53 os.environ · .env · load_dotenv · .gitignore · SecretStr</text>
<text x="16" y="194" fill="var(--ink-faint)" font-size="11">怎么描述一份数据</text>
<rect x="16" y="202" width="190" height="90" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="111" y="226" text-anchor="middle" fill="var(--ink)">Day 49 Protocol</text>
<text x="111" y="246" text-anchor="middle" fill="var(--ink-soft)" font-size="11">只看有没有这个方法</text>
<text x="111" y="264" text-anchor="middle" fill="var(--ink-soft)" font-size="11">TypeVar · [T: HasId]</text>
<rect x="225" y="202" width="190" height="90" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="226" text-anchor="middle" fill="var(--ink)">Day 50 dataclass</text>
<text x="320" y="246" text-anchor="middle" fill="var(--ink-soft)" font-size="11">自动 init/repr/eq</text>
<text x="320" y="264" text-anchor="middle" fill="var(--ink-soft)" font-size="11">field · __post_init__</text>
<rect x="434" y="202" width="190" height="90" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="529" y="226" text-anchor="middle" fill="var(--ink)">Day 51–52 pydantic</text>
<text x="529" y="246" text-anchor="middle" fill="var(--ink-soft)" font-size="11">造的时候就校验</text>
<text x="529" y="264" text-anchor="middle" fill="var(--ink-soft)" font-size="11">Field · validator · dump</text>
</g>
</svg>
<figcaption>蓝色是「描述数据」,琥珀色是「程序和外部世界打交道」。这周的主线:外来的数据不能信,在门口用模型拦一道;外来的配置不能写进代码,放进环境变量。</figcaption>
</figure>

## 本周每天一句话

- [Day 49](/blog/agent-zero/day-049-type-hints-4/):`class ChatClient(Protocol)` 只列方法签名,任何有同名同参数名方法的类都算它,不用继承(≈ TS 的结构类型);`def by_id[T: HasId](items: list[T], id: str) -> T | None` 的 T 表示「传进什么类型就返回什么类型」,冒号后面是上限;Protocol 默认不能拿来 `isinstance`。
- [Day 50](/blog/agent-zero/day-050-dataclass/):`@dataclass` 只写字段,自动生成 `__init__`、`__repr__`、`__eq__`;列表默认值要写 `field(default_factory=list)`;有默认值的字段放后面;运行时不检查类型;校验补在 `__post_init__` 里。
- [Day 51](/blog/agent-zero/day-051-pydantic-1/):`BaseModel` 写法像 dataclass,但造对象时按标注检查并转换(`"66"` 变 66.0);失败抛 `ValidationError`,`e.errors()` 逐条给出 `loc`、`type`、`msg`、`input`;翻译提示按 `type` 不按 `msg`。
- [Day 52](/blog/agent-zero/day-052-pydantic-2/):`Field(gt=0, min_length=1, pattern=...)` 加约束;`@field_validator` + `@classmethod` 写自定义规则,必须 return,规则不满足 `raise ValueError`;`model_validate` 把字典变模型,`model_dump` 把模型变字典。
- [Day 53](/blog/agent-zero/day-053-env-secrets/):`os.environ["X"]` 缺了就当场 KeyError,`.get` 只给真正可选的配置;`load_dotenv()` 从脚本所在目录往上找 `.env`,已有的变量不覆盖,`override=True` 才覆盖;`.gitignore` 里写 `.env`、`.env.*`、`!.env.example`;key 用 `SecretStr` 装,打印出来是星号。
- [Day 54](/blog/agent-zero/day-054-intake-project/):工具自己不写校验规则,交给 `Ticket`;错误按 `type` 翻译、数字从 `ctx` 取;文件读不出来绝不覆盖;输入提前结束会抛 `EOFError`;编号用最大号加一。

## 默写一:假客户端和泛型函数

默写的规矩:先只看下面这段要求,在空文件里写,写完跑,跑通了再展开对照。

**要求**:定义消息的形状 `Message`(`role` 只能是 system、user、assistant,`content` 是字符串)和 `ChatClient`(只有一个方法 `chat(messages) -> str`,用 Protocol)。写一个不继承任何东西的 `FakeClient`:构造时收一串预先写好的回复,每次 `chat` 把收到的 messages 记进 `seen`,按顺序返回下一条回复。再写 `HasId` 协议(只有一个属性 `id: str`)和泛型函数 `by_id`,从列表里按 id 找对象,找不到返回 None。最后写一个 dataclass `Doc`(id、title),写 `ask(client, doc, question)`:拼成两条消息(system 里带上文档标题,user 是问题),发给客户端,把回复去掉首尾空白再返回。验证:假客户端被调用 1 次,查不存在的 id 得到 None。文件名 `part01/recall_client.py`。

<details><summary>对照答案</summary>

```python
# agent-zero-lab/part01/recall_client.py
from dataclasses import dataclass
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


class HasId(Protocol):
    id: str


def by_id[T: HasId](items: list[T], id: str) -> T | None:
    for item in items:
        if item.id == id:
            return item
    return None


@dataclass
class Doc:
    id: str
    title: str


def ask(client: ChatClient, doc: Doc, question: str) -> str:
    messages: list[Message] = [
        {"role": "system", "content": f"只根据这篇文档回答:{doc.title}"},
        {"role": "user", "content": question},
    ]
    return client.chat(messages).strip()


if __name__ == "__main__":
    docs = [Doc("D-1", "退款政策"), Doc("D-2", "发票说明")]
    fake = FakeClient(["  7 天内可以退款。 "])
    doc = by_id(docs, "D-1")
    if doc is not None:
        print(ask(fake, doc, "买错了能退吗?"))
    print(by_id(docs, "D-9"))
    print(len(fake.seen), fake.seen[0][0]["content"])
```

<div class="line-notes">

- `from dataclasses import dataclass` Day 50 的装饰器。
- `from typing import Literal, Protocol, TypedDict` 三样都是 typing 模块里的:字面量类型、协议、字典形状。
- `Role = Literal["system", "user", "assistant"]` 三个角色名,拼错一个字母检查器就会红线。
- `class Message(TypedDict):` 一条消息是一个字典,键是 `role` 和 `content`。TypedDict 只管检查器,运行时它就是普通 dict(Day 47)。
- `class ChatClient(Protocol):` 协议:只描述形状,不提供实现。
- `def chat(self, messages: list[Message]) -> str: ...` 方法体写三个点。参数名 `messages` 也是协议的一部分,实现的类必须叫同一个名字(本周错题表里有)。
- `class FakeClient:` 括号里什么都不写,不继承 ChatClient,照样被认可,因为它有形状一样的 `chat`。
- `def __init__(self, replies: list[str]):` 剧本:一串提前写好的回复。
- `self.seen: list[list[Message]] = []` 记下每次收到的整个消息列表,所以是「列表的列表」。空容器要标类型(Day 46)。
- `self.seen.append(messages)` 先记录再回复。
- `return self.replies[len(self.seen) - 1]` 第一次调用时 `seen` 里有 1 条,下标 0,返回第 0 条回复;第二次返回下标 1。剧本不够用时会 IndexError,默写里不处理。
- `class HasId(Protocol):` 协议也可以描述属性:任何有 `id: str` 的东西。
- `def by_id[T: HasId](items: list[T], id: str) -> T | None:` Python 3.12 的泛型写法。方括号里 `T: HasId` 的意思是「T 是某个类型,但必须满足 HasId」。传进 `list[Doc]` 就返回 `Doc | None`,不是笼统的 HasId。
- `for item in items:` 逐个找。
- `if item.id == id:` 因为 T 满足 HasId,检查器放心让你读 `.id`。
- `return item` 找到就返回。
- `return None` 循环走完没找到。
- `@dataclass` 紧接着的 `class Doc:` 只写两个字段 `id`、`title`,自动得到构造函数和漂亮的 repr(Day 50)。dataclass 的 `id: str` 同样满足 HasId 协议。
- `def ask(client: ChatClient, doc: Doc, question: str) -> str:` 第一个参数写协议类型,所以真客户端、假客户端都能传。
- `messages: list[Message] = [` 变量上标了类型,字典里的 role 拼错就会被抓。
- `{"role": "system", "content": f"只根据这篇文档回答:{doc.title}"},` 代入 `Doc("D-1", "退款政策")` 是「只根据这篇文档回答:退款政策」。
- `return client.chat(messages).strip()` 假客户端回的是 `"  7 天内可以退款。 "`,`strip()` 去掉首尾空白(Day 16)。
- `docs = [Doc("D-1", "退款政策"), Doc("D-2", "发票说明")]` 两篇文档。
- `fake = FakeClient(["  7 天内可以退款。 "])` 剧本只有一条,所以只能被调用一次。
- `doc = by_id(docs, "D-1")` 类型是 `Doc | None`。
- `if doc is not None:` 收窄(Day 46):进入这个分支后,检查器知道 `doc` 是 `Doc`,可以传给 `ask`。
- `print(by_id(docs, "D-9"))` 不存在的编号,得到 None。
- `print(len(fake.seen), fake.seen[0][0]["content"])` `fake.seen[0]` 是第一次收到的消息列表,`[0]` 是其中的 system 那条,取它的 content。

</div>

```bash
uv run basedpyright part01/recall_client.py
uv run python part01/recall_client.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
7 天内可以退款。
None
1 只根据这篇文档回答:退款政策
```

</details>

自查三点。`FakeClient` 后面有没有手滑写成 `FakeClient(ChatClient)`(能跑,但就违背了 Protocol 的初衷,而且 FakeClient 现在得实现所有方法);`by_id` 的返回类型有没有写成 `HasId | None`(那样 `ask` 就拿不到 `Doc`,检查器会说类型不对);`doc` 有没有先判断 None 再传给 `ask`。

## 默写二:pydantic 模型和读写 JSON

**要求**:写 `Ticket(BaseModel)`:`id` 要像 `T-1004`(T、横杠、四位数字),`title` 1 到 30 个字,`amount` 大于 0 小于等于 10 万,`status` 只能是 open 或 closed 默认 open,`tags` 是字符串列表默认空列表。再写一个 `title` 的校验器:去掉首尾空白,如果去完是空的就报「标题不能全是空格」。写 `save(tickets)` 和 `load()` 在 `part01/data/recall_tickets.json` 里读写(存用 `model_dump`,读用 `model_validate`)。验证:三份原始数据,第一份标题带空格、金额是字符串 `"66"`,第二份带标签,第三份三处错;前两份通过,第三份被拦,打印每处错的字段和类型;存了再读回来和原来相等。文件名 `part01/recall_ticket.py`。

<details><summary>对照答案</summary>

```python
# agent-zero-lab/part01/recall_ticket.py
import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, ValidationError, field_validator

OUT = Path(__file__).resolve().parent / "data" / "recall_tickets.json"


class Ticket(BaseModel):
    id: str = Field(pattern=r"^T-\d{4}$")
    title: str = Field(min_length=1, max_length=30)
    amount: float = Field(gt=0, le=100000)
    status: Literal["open", "closed"] = "open"
    tags: list[str] = Field(default_factory=list)

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, value: str) -> str:
        value = value.strip()
        if value == "":
            raise ValueError("标题不能全是空格")
        return value


def save(tickets: list[Ticket]) -> None:
    data = [t.model_dump() for t in tickets]
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load() -> list[Ticket]:
    data = json.loads(OUT.read_text(encoding="utf-8"))
    return [Ticket.model_validate(d) for d in data]


if __name__ == "__main__":
    raws = [
        {"id": "T-2001", "title": "  发票重开  ", "amount": "66"},
        {"id": "T-2002", "title": "扣费两次", "amount": 89.5, "tags": ["退款"]},
        {"id": "2003", "title": "   ", "amount": -1},
    ]
    good: list[Ticket] = []
    for raw in raws:
        try:
            good.append(Ticket.model_validate(raw))
        except ValidationError as e:
            print(f"拦下 {raw['id']}:", [(err["loc"][0], err["type"]) for err in e.errors()])
    save(good)
    print(load() == good, [t.title for t in good], good[0].amount)
```

<div class="line-notes">

- `from typing import Literal` 状态只有两个值,这次直接在模型里写 `Literal`,不借用 Day 47 的 `Status`。
- `from pydantic import BaseModel, Field, ValidationError, field_validator` 四样:模型基类、字段约束、异常、校验器装饰器。
- `OUT = Path(__file__).resolve().parent / "data" / "recall_tickets.json"` Day 37 的写法,不管从哪个目录运行都存在 `part01/data/`。
- `class Ticket(BaseModel):` 模型。
- `id: str = Field(pattern=r"^T-\d{4}$")` 正则:`^` 开头,`T-` 字面量,`\d{4}` 四位数字,`$` 结尾。前面的 `r` 表示原始字符串,反斜杠不转义。
- `title: str = Field(min_length=1, max_length=30)` 长度约束。
- `amount: float = Field(gt=0, le=100000)` 大于 0、小于等于 10 万。`gt` 是 greater than,`le` 是 less than or equal。
- `status: Literal["open", "closed"] = "open"` 有默认值,所以三份原始数据里不写也行。
- `tags: list[str] = Field(default_factory=list)` 每个对象拿到自己的空列表,和 dataclass 一样的道理。
- `@field_validator("title")` 声明这个方法管 `title` 字段。
- `@classmethod` 必须有,而且写在 `field_validator` 的**下面**(Day 52)。
- `def title_not_blank(cls, value: str) -> str:` 第一个参数是 `cls` 不是 `self`,第二个是已经通过前面各关的值。
- `value = value.strip()` 清洗:`"  发票重开  "` 变成 `"发票重开"`。
- `raise ValueError("标题不能全是空格")` 抛 ValueError,pydantic 把它包装成一条 `value_error`。
- `return value` 一定要 return,否则字段值变成 None。
- `data = [t.model_dump() for t in tickets]` 每个模型变成字典,装成列表。
- `OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")` 中文原样保存,缩进 2 格。
- `return [Ticket.model_validate(d) for d in data]` 读回来每张都重新过一遍规则。
- `{"id": "T-2001", "title": "  发票重开  ", "amount": "66"},` 标题带空格,金额是字符串。通过后变成 `title='发票重开'`、`amount=66.0`。
- `{"id": "2003", "title": "   ", "amount": -1},` 三处错:id 不是 `T-` 开头,标题全空格,金额不大于 0。
- `print(f"拦下 {raw['id']}:", [(err["loc"][0], err["type"]) for err in e.errors()])` 只打印(字段, 错误类型),看清三处各是什么类型。
- `print(load() == good, [t.title for t in good], good[0].amount)` 存了再读回来,模型按字段比较相等;第一张的标题是清洗后的,金额是转好的 66.0。

</div>

```bash
uv run basedpyright part01/recall_ticket.py
uv run python part01/recall_ticket.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
拦下 2003: [('id', 'string_pattern_mismatch'), ('title', 'value_error'), ('amount', 'greater_than')]
True ['发票重开', '扣费两次'] 66.0
```

</details>

自查三点。校验器有没有忘了 `@classmethod` 或者把它写在 `@field_validator` 上面;校验器末尾有没有 `return value`;三处错的类型是不是 `string_pattern_mismatch`、`value_error`、`greater_than`,而且「字段」是 loc 的第一个元素。

## 默写三:配置读取和 .gitignore

**要求**:写 `Settings(BaseModel)`:`base_url` 必须以 `http://` 或 `https://` 开头,`api_key` 用 `SecretStr` 装、至少 10 个字符,`model` 非空。写 `load_settings(env_file=None)`:传了文件名就用 `override=True` 读那个文件,没传就读默认的 `.env`;三个变量从 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL` 取(缺了就让它当场 KeyError)。验证:打印默认配置(key 应该是星号)、key 的前 6 位、`.env.test` 里的模型名。然后在终端里用 `git check-ignore -v` 验证 `.gitignore` 的三条规则。文件名 `part01/recall_settings.py`。

<details><summary>对照答案</summary>

```python
# agent-zero-lab/part01/recall_settings.py
import os

from dotenv import load_dotenv
from pydantic import BaseModel, Field, SecretStr


class Settings(BaseModel):
    base_url: str = Field(pattern=r"^https?://")
    api_key: SecretStr = Field(min_length=10)
    model: str = Field(min_length=1)


def load_settings(env_file: str | None = None) -> Settings:
    if env_file:
        load_dotenv(env_file, override=True)
    else:
        load_dotenv()
    return Settings(
        base_url=os.environ["LLM_BASE_URL"],
        api_key=SecretStr(os.environ["LLM_API_KEY"]),
        model=os.environ["LLM_MODEL"],
    )


if __name__ == "__main__":
    s = load_settings()
    print(s)
    print(s.api_key.get_secret_value()[:6] + "…")
    print(load_settings(".env.test").model)
```

<div class="line-notes">

- `import os` 读环境变量。
- `from dotenv import load_dotenv` 注意包名 python-dotenv,导入名是 `dotenv`。
- `from pydantic import BaseModel, Field, SecretStr` 这次不需要 ValidationError,因为默写版不翻译格式错误,让它自然抛出。
- `base_url: str = Field(pattern=r"^https?://")` `s?` 表示 s 可有可无,所以 http 和 https 都行。
- `api_key: SecretStr = Field(min_length=10)` 装成「秘密字符串」,打印、repr、`model_dump` 都显示星号。最小长度拦住 `.env` 里 `LLM_API_KEY=` 没填值的情况。
- `def load_settings(env_file: str | None = None) -> Settings:` 参数可以不传。
- `load_dotenv(env_file, override=True)` 点名要的文件,以它为准。路径相对于**当前目录**,不像无参数时那样从脚本所在目录往上找。
- `load_dotenv()` 没点名,`.env` 只兜底,终端里已设的变量优先。
- `base_url=os.environ["LLM_BASE_URL"],` 方括号取值:缺了当场 KeyError,不会悄悄拿到 None。
- `api_key=SecretStr(os.environ["LLM_API_KEY"]),` 先包成 SecretStr 再给模型,检查器才不会画红线。
- `print(s)` 打印整个配置,`api_key=SecretStr('**********')`,真 key 不会出现在屏幕上。
- `print(s.api_key.get_secret_value()[:6] + "…")` 要拿原文必须显式调用 `get_secret_value()`,这里只取前 6 位,代入假 key `sk-fake-day53-...` 是 `sk-fak`。
- `print(load_settings(".env.test").model)` 点名读测试配置,模型名变成 `fake-model`。

</div>

```bash
uv run basedpyright part01/recall_settings.py
uv run python part01/recall_settings.py
git check-ignore -v .env .env.test .env.example
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
base_url='https://api.deepseek.com' api_key=SecretStr('**********') model='deepseek-flash'
sk-fak…
fake-model
.gitignore:13:.env	.env
.gitignore:14:.env.*	.env.test
.gitignore:15:!.env.example	.env.example
```

最后三行就是 `git check-ignore -v` 的回答:`.env` 被第 13 行忽略,`.env.test` 被第 14 行的 `.env.*` 忽略,`.env.example` 命中第 15 行带 `!` 的例外,所以会被提交。行号取决于你的 `.gitignore` 原来有几行。

</details>

自查三点。`.gitignore` 里三条的顺序(例外 `!.env.example` 必须在 `.env.*` **后面**);有没有把 key 直接 `print` 出来;`load_settings(".env.test")` 在 `part01` 目录里运行时会静默读不到(返回 False,不报错),所以验证命令都要从项目根目录运行。

## 小项目:批量导入客户

场景:销售团队从别的系统导出了一份客户名单(JSON),要导进云簿。名单是人工整理的,难免有毛病:有的名字是空的,有的套餐写成了 `vip`,有的邮箱多打了一个 @,有的客户编号重复。你要写一个命令行脚本:

```bash
uv run python part01/customer_import.py
```

读 `part01/data/customers_raw.json`,合规的存进 `customers_ok.json`,不合规的说清楚是第几行、哪里不对;汇报可以输出到屏幕,也可以输出到文件(由环境变量 `IMPORT_REPORT` 决定);有被拦的行就返回退出码 1。只用这周的知识,basedpyright 0 报错。

先把名单准备好。新建 `part01/data/customers_raw.json`,十行,故意埋了五个毛病:

```json
[
  {"id": "C-001", "name": "李雷", "plan": "pro", "email": " LiLei@Example.com "},
  {"id": "C-002", "name": "韩梅梅", "email": "hanmei@example.com"},
  {"id": "C-003", "name": "", "plan": "basic"},
  {"id": "C-004", "name": "Jim", "plan": "vip"},
  {"id": "C-005", "name": "王芳", "plan": "team", "email": "wangfang@@example.com"},
  {"id": "C-1", "name": "赵六", "plan": "basic"},
  {"id": "C-001", "name": "李雷(重复)", "plan": "basic"},
  {"id": "C-008", "name": "孙悟空", "plan": "team", "email": null},
  {"id": "C-009", "name": "周杰", "plan": "pro"},
  {"id": "C-010", "name": "Anna Zhang", "plan": "team", "email": "ANNA@X.IO"}
]
```

对一下毛病:第 3 行名字是空字符串;第 4 行套餐 `vip` 不在三个允许的值里;第 5 行邮箱有两个 `@`;第 6 行编号 `C-1` 不是 `C-` 加三位数字;第 7 行编号 `C-001` 和第 1 行重复。第 1 行邮箱前后带空格还有大写,第 8 行邮箱是 `null`,这两行是对的,但要被**清洗**或者**接受**。

先想一想需要哪些零件,这周其实都准备好了:

- 描述一个客户:pydantic 模型(Day 51–52),邮箱清洗用校验器。
- 找出重复的编号:Day 49 的泛型函数 `by_id`,不用再写一遍。
- 汇报的去向会变(屏幕、文件、测试时收集起来):Protocol 加三个互不继承的实现(Day 49)。
- 装「一共几行、导入了谁、拦下了哪几行」:dataclass(Day 50),用 `field(default_factory=...)`。
- 汇报方式由环境变量切换:`os.environ.get` 和 `load_dotenv`(Day 53)。
- 读写 JSON、命令行退出码:Day 39、Day 44。

新建 `part01/customer_import.py`:

```python
# agent-zero-lab/part01/customer_import.py
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Protocol

from dotenv import load_dotenv
from pydantic import BaseModel, Field, ValidationError, field_validator

DATA = Path(__file__).resolve().parent / "data"
SRC = DATA / "customers_raw.json"
OUT = DATA / "customers_ok.json"


class Customer(BaseModel):
    id: str = Field(pattern=r"^C-\d{3}$")
    name: str = Field(min_length=1, max_length=20)
    plan: Literal["basic", "pro", "team"] = "basic"
    email: str | None = None

    @field_validator("email")
    @classmethod
    def clean_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip().lower()
        if value.count("@") != 1 or value.startswith("@") or value.endswith("@"):
            raise ValueError(f"邮箱格式不对,收到 {value!r}")
        return value


class HasId(Protocol):
    id: str


def by_id[T: HasId](items: list[T], id: str) -> T | None:
    for item in items:
        if item.id == id:
            return item
    return None


class Reporter(Protocol):
    def say(self, text: str) -> None: ...


class ConsoleReporter:
    def say(self, text: str) -> None:
        print(text)


class FileReporter:
    def __init__(self, path: Path):
        self.path = path
        path.write_text("", encoding="utf-8")

    def say(self, text: str) -> None:
        with self.path.open("a", encoding="utf-8") as f:
            f.write(text + "\n")


class ListReporter:
    def __init__(self) -> None:
        self.lines: list[str] = []

    def say(self, text: str) -> None:
        self.lines.append(text)


@dataclass
class ImportResult:
    total: int = 0
    ok: list[Customer] = field(default_factory=list)
    rejected: dict[int, str] = field(default_factory=dict)


def describe(e: ValidationError) -> str:
    return ";".join(f"{err['loc'][0]}: {err['msg']}" for err in e.errors())


def import_customers(rows: list[dict[str, Any]], reporter: Reporter) -> ImportResult:
    result = ImportResult(total=len(rows))
    for number, row in enumerate(rows, start=1):
        try:
            customer = Customer.model_validate(row)
        except ValidationError as e:
            result.rejected[number] = describe(e)
            reporter.say(f"第 {number} 行被拦 -> {result.rejected[number]}")
            continue
        if by_id(result.ok, customer.id) is not None:
            result.rejected[number] = f"id: {customer.id} 前面已经导入过了"
            reporter.say(f"第 {number} 行被拦 -> {result.rejected[number]}")
            continue
        result.ok.append(customer)
    return result


def pick_reporter() -> Reporter:
    path = os.environ.get("IMPORT_REPORT")
    return FileReporter(Path(path)) if path else ConsoleReporter()


def main() -> int:
    load_dotenv()
    rows: list[dict[str, Any]] = json.loads(SRC.read_text(encoding="utf-8"))
    reporter = pick_reporter()
    result = import_customers(rows, reporter)
    OUT.write_text(json.dumps([c.model_dump() for c in result.ok], ensure_ascii=False, indent=2), encoding="utf-8")
    reporter.say(f"共 {result.total} 行,导入 {len(result.ok)} 个,被拦 {len(result.rejected)} 行")
    return 1 if result.rejected else 0


if __name__ == "__main__":
    sys.exit(main())
```

<div class="line-notes">

- `import json` 读写名单和结果。
- `import os` 读 `IMPORT_REPORT`。
- `import sys` 为了最后的 `sys.exit`。
- `from dataclasses import dataclass, field` 装结果的类要用,`field` 是小写的(Day 50),别和 pydantic 的 `Field` 搞混。
- `from typing import Any, Literal, Protocol` `Any` 给 JSON 读进来的字典,`Literal` 给套餐,`Protocol` 给两个协议。
- `from dotenv import load_dotenv` 让你能在 `.env` 里写 `IMPORT_REPORT=...`。
- `from pydantic import BaseModel, Field, ValidationError, field_validator` 模型要用的四样。
- `DATA = Path(__file__).resolve().parent / "data"` 数据目录。
- `SRC = DATA / "customers_raw.json"` 原始名单。
- `OUT = DATA / "customers_ok.json"` 合规的存在这里。
- `class Customer(BaseModel):` 一个客户。
- `id: str = Field(pattern=r"^C-\d{3}$")` 像 `C-001`。
- `name: str = Field(min_length=1, max_length=20)` 1 到 20 个字。
- `plan: Literal["basic", "pro", "team"] = "basic"` 只能是三种套餐,不写默认 basic(第 2 行就没写)。
- `email: str | None = None` 邮箱可以没有。
- `@field_validator("email")` 管 email 字段。
- `def clean_email(cls, value: str | None) -> str | None:` 值可能是 None(第 8 行 `null` 变成 None),所以参数类型也要带 `| None`。
- `if value is None:` 没填就原样放行。第 9 行根本没有 email 键,用的是默认值 None,默认值不过校验器(pydantic 默认不校验默认值),但这一行让 `null` 也走得通。
- `value = value.strip().lower()` 第 1 行 `" LiLei@Example.com "` 变成 `"lilei@example.com"`。
- `if value.count("@") != 1 or value.startswith("@") or value.endswith("@"):` 恰好一个 `@`,而且不在开头或结尾。第 5 行 `wangfang@@example.com` 有两个,被拦。
- `raise ValueError(f"邮箱格式不对,收到 {value!r}")` 报错里带上清洗后的值,`!r` 让引号显出来。
- `class HasId(Protocol):` Day 49 的协议。Customer 是 pydantic 模型,它的 `id: str` 字段同样满足。
- `def by_id[T: HasId](items: list[T], id: str) -> T | None:` Day 49 的泛型函数,原样搬来。传进 `list[Customer]`,返回 `Customer | None`。
- `class Reporter(Protocol):` 汇报者协议:只要有 `say(text)` 方法。
- `def say(self, text: str) -> None: ...` 参数名叫 `text`,后面三个实现都必须叫同一个名字。
- `class ConsoleReporter:` 屏幕汇报,不继承 Reporter。
- `print(text)` 直接打印。
- `class FileReporter:` 文件汇报。
- `def __init__(self, path: Path):` 记下路径。
- `path.write_text("", encoding="utf-8")` 一创建就把文件清空,这样每次运行的报告都是新的,不会累积上次的内容。
- `with self.path.open("a", encoding="utf-8") as f:` 每说一句就追加一行(Day 38 的 `"a"`)。
- `f.write(text + "\n")` 补换行符。
- `class ListReporter:` 测试用的假汇报者:不输出,只把话收进列表。和 Day 49 的 FakeClient 同一个思路。
- `def __init__(self) -> None:` 没有参数的 `__init__` 要写 `-> None`,检查器才会检查这个方法体。
- `self.lines: list[str] = []` 收集到的话。
- `@dataclass` 紧接着的 `class ImportResult:` 导入结果。
- `total: int = 0` 一共几行,有默认值。
- `ok: list[Customer] = field(default_factory=list)` 合规的客户。列表默认值必须 `default_factory`,直接写 `= []` 会 ValueError。
- `rejected: dict[int, str] = field(default_factory=dict)` 被拦的行:键是行号,值是原因。字典同理。
- `def describe(e: ValidationError) -> str:` 把一个 ValidationError 压成一句话。
- `return ";".join(f"{err['loc'][0]}: {err['msg']}" for err in e.errors())` 每处错一段「字段: 原因」,用分号连起来。括号里是生成器表达式(Day 54)。这里不翻译成中文,保持小项目短一点,练习里你可以接上 Day 54 的翻译。
- `def import_customers(rows: list[dict[str, Any]], reporter: Reporter) -> ImportResult:` 核心函数:只管导入,不管读文件、不管汇报去哪,方便测试。reporter 的类型是协议,所以三种汇报者都能传。
- `result = ImportResult(total=len(rows))` 先建一个空结果,记下总行数 10。
- `for number, row in enumerate(rows, start=1):` 行号从 1 开始,人说「第 3 行」。
- `customer = Customer.model_validate(row)` 过模型。
- `except ValidationError as e:` 没通过。
- `result.rejected[number] = describe(e)` 记下是第几行、什么毛病。
- `reporter.say(f"第 {number} 行被拦 -> {result.rejected[number]}")` 汇报给屏幕或文件。
- `continue` 这一行处理完,接着下一行,一行出错不影响别的。
- `if by_id(result.ok, customer.id) is not None:` 模型通过了,还要查有没有和已导入的重复。重复是「整份名单」的规则,不是单个客户的规则,所以不写进 `Customer`(Day 54 练习 2 的结论)。
- `result.rejected[number] = f"id: {customer.id} 前面已经导入过了"` 第 7 行的 `C-001` 在这里被拦。
- `result.ok.append(customer)` 全部通过才加入。
- `return result` 把结果交出去。
- `def pick_reporter() -> Reporter:` 决定汇报去哪。返回类型写协议,不写具体的类。
- `path = os.environ.get("IMPORT_REPORT")` 可选配置,用 `.get`(Day 53)。
- `return FileReporter(Path(path)) if path else ConsoleReporter()` 设了就写文件,没设就打印。
- `def main() -> int:` 返回退出码。
- `load_dotenv()` 读 `.env`,终端里设的变量优先。
- `rows: list[dict[str, Any]] = json.loads(SRC.read_text(encoding="utf-8"))` `json.loads` 返回 Any,在变量上标类型让后面的检查有依据。注意这是「声明」,不是运行时校验;每行真正的校验在 `Customer.model_validate` 里。
- `result = import_customers(rows, reporter)` 十行进去,结果出来。
- `OUT.write_text(json.dumps([c.model_dump() for c in result.ok], ensure_ascii=False, indent=2), encoding="utf-8")` 合规的客户用 `model_dump` 变字典存盘。
- `reporter.say(f"共 {result.total} 行,导入 {len(result.ok)} 个,被拦 {len(result.rejected)} 行")` 收尾汇报:共 10 行,导入 5 个,被拦 5 行。
- `return 1 if result.rejected else 0` 有被拦的就是 1。空字典是假值,所以没有被拦的返回 0。
- `sys.exit(main())` main 的返回值变成进程的退出码。

</div>

检查、运行、看退出码:

```bash
uv run basedpyright part01/customer_import.py
uv run python part01/customer_import.py
echo "exit=$?"
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
第 3 行被拦 -> name: String should have at least 1 character
第 4 行被拦 -> plan: Input should be 'basic', 'pro' or 'team'
第 5 行被拦 -> email: Value error, 邮箱格式不对,收到 'wangfang@@example.com'
第 6 行被拦 -> id: String should match pattern '^C-\d{3}$'
第 7 行被拦 -> id: C-001 前面已经导入过了
共 10 行,导入 5 个,被拦 5 行
exit=1
```

对一下:五行被拦,原因各不相同。第 3 行的名字是空的,第 4 行套餐 `vip`,第 5 行邮箱两个 `@`(「Value error」那段是我们自己写的 `ValueError` 被 pydantic 包装后的样子),第 6 行编号格式不对,第 7 行编号重复是我们自己的规则。第 1 行带空格的大写邮箱和第 8 行的 `null` 都通过了。五个导入,所以退出码是 1。看一下存下来的结果:

```bash
head -14 part01/data/customers_ok.json
```

实测输出:

```text
[
  {
    "id": "C-001",
    "name": "李雷",
    "plan": "pro",
    "email": "lilei@example.com"
  },
  {
    "id": "C-002",
    "name": "韩梅梅",
    "plan": "basic",
    "email": "hanmei@example.com"
  },
  {
```

邮箱已经清洗成小写、没有空格;第 2 行没写套餐,得到默认的 `basic`。

再换成文件汇报,屏幕上应该什么都没有,汇报全在文件里:

```bash
IMPORT_REPORT=part01/data/report.txt uv run python part01/customer_import.py
echo "exit=$?"
cat part01/data/report.txt
```

实测输出:

```text
exit=1
第 3 行被拦 -> name: String should have at least 1 character
第 4 行被拦 -> plan: Input should be 'basic', 'pro' or 'team'
第 5 行被拦 -> email: Value error, 邮箱格式不对,收到 'wangfang@@example.com'
第 6 行被拦 -> id: String should match pattern '^C-\d{3}$'
第 7 行被拦 -> id: C-001 前面已经导入过了
共 10 行,导入 5 个,被拦 5 行
```

屏幕上只有最后一行 `exit=1`,汇报的六行都在文件里,和上一次逐字相同。`import_customers` 一行没改,换的只是传给它的那个汇报者。这就是 Protocol 的价值:函数只要求「有 say 方法」,不管它背后是屏幕还是文件。

### 用假汇报者检查,不动真文件

`ListReporter` 就是为了这一刻:不碰文件、不碰屏幕,直接问「它说了什么」。新建 `part01/import_check.py`:

```python
# agent-zero-lab/part01/import_check.py
from customer_import import ListReporter, import_customers

rows = [
    {"id": "C-100", "name": "甲"},
    {"id": "C-100", "name": "乙"},
    {"id": "X", "name": "丙", "email": "bad"},
]
reporter = ListReporter()
result = import_customers(rows, reporter)

print(result.total, len(result.ok), result.rejected)
print(reporter.lines)
assert len(result.ok) == 1
assert sorted(result.rejected) == [2, 3]
print("检查通过")
```

<div class="line-notes">

- `from customer_import import ListReporter, import_customers` 导入核心函数和假汇报者。导入时 `customer_import` 里 `main` 不会运行,因为它在 `if __name__ == "__main__":` 下面。
- `rows = [` 三行测试数据:第一行正常,第二行编号和第一行重复,第三行编号和邮箱都不对。
- `reporter = ListReporter()` 假汇报者,会把汇报都收进 `lines`。
- `result = import_customers(rows, reporter)` 和正式运行同一个函数。
- `print(result.total, len(result.ok), result.rejected)` 总行数 3,导入 1 个,被拦 `{2: ..., 3: ...}`。
- `print(reporter.lines)` 看汇报者收到的原话。
- `assert len(result.ok) == 1` assert 是「断言」:后面的条件为真就什么都不发生,为假就抛 `AssertionError`。这是不用 pytest 的最简单的检查(Day 71 起正式学测试)。
- `assert sorted(result.rejected) == [2, 3]` 对字典调用 `sorted` 得到排好序的键列表,应该正好是第 2、3 行。
- `print("检查通过")` 两个 assert 都没炸才会走到这里。

</div>

```bash
uv run python part01/import_check.py
```

实测输出:

```text
3 1 {2: 'id: C-100 前面已经导入过了', 3: "id: String should match pattern '^C-\\d{3}$';email: Value error, 邮箱格式不对,收到 'bad'"}
['第 2 行被拦 -> id: C-100 前面已经导入过了', "第 3 行被拦 -> id: String should match pattern '^C-\\d{3}$';email: Value error, 邮箱格式不对,收到 'bad'"]
检查通过
```

第三行同时有两处错,所以原因是两段用分号连起来的;被拦的行号是 2 和 3,正好符合预期。

零件对照:

| 本周的零件 | 在 customer_import.py 里是哪一段 |
| --- | --- |
| Day 49 Protocol | `Reporter` 和三个互不继承的实现;`HasId` |
| Day 49 泛型 `[T: HasId]` | `by_id`,查重复的编号 |
| Day 50 dataclass、`default_factory` | `ImportResult` |
| Day 51 `ValidationError`、`e.errors()` | `describe`,`except ValidationError` |
| Day 52 `Field`、`field_validator`、`model_validate`、`model_dump` | `Customer`,`import_customers`,`main` 里存盘 |
| Day 53 `os.environ.get`、`load_dotenv` | `pick_reporter`,`main` 的第一行 |
| Day 54 逐行处理、被拦的不丢、退出码 | `import_customers` 的 `continue`,`return 1 if ... else 0` |

这个脚本的骨架是 Agent 工程里最常见的一种:**外来的一批东西,逐个校验,好的收下,坏的记下原因,最后给出汇总**。以后模型一次返回好几个工具调用参数、一次抽取出一批字段时,处理方式和这里一样,只是输入从 JSON 文件换成了模型的输出。

### 三种「装数据的东西」怎么选

这周接触了 dataclass、pydantic 模型,加上之前的 TypedDict,很容易乱。一张表:

| | TypedDict(Day 47) | dataclass(Day 50) | pydantic BaseModel(Day 51–52) |
| --- | --- | --- | --- |
| 运行时是什么 | 普通 dict | 普通类的对象 | 对象,带校验 |
| 造的时候检查吗 | 不检查 | 不检查(除非自己写 `__post_init__`) | 检查并转换 |
| 适合装 | 数据本身就是字典,只想让检查器帮忙 | 程序内部自己产生、不用怀疑的数据 | **外面进来的**数据:表单、JSON、模型输出、配置 |
| 本周的例子 | `Message` | `ImportResult`、`Doc` | `Customer`、`Ticket`、`Settings` |

判断一个数据该用谁,问一句:**这份数据是从外面来的吗?** 是,用 pydantic;不是,是程序自己拼出来用的,dataclass 够了,而且更轻。

## 本周错题与坑清单

这周实测过的报错放在一起。左边是你会看到的原文,右边是病因和修法:

| 报错(实测原文) | 哪天 | 病因和修法 |
| --- | --- | --- |
| `TypeError: Instance and class checks can only be used with @runtime_checkable protocols` | 49 | 拿 Protocol 做 `isinstance`。Protocol 默认只给检查器用;真要运行时判断,在类上加 `@runtime_checkable`,而且它只检查有没有这个名字,不检查签名 |
| `Parameter name mismatch: "text" versus "msg"` 加 `TypeError: JsonReporter.say() got an unexpected keyword argument 'text'` | 49、55 | 实现 Protocol 的方法,参数名和协议里不一样。参数名也算签名的一部分,因为调用者可以按关键字传参 |
| `AttributeError: 'dict' object has no attribute 'strip'` | 49 | 假客户端的 `chat` 返回了字典,调用方却按字符串用。给返回值标 `-> str`,检查器能提前抓到 |
| `ValueError: mutable default <class 'list'> for field tags is not allowed: use default_factory` | 50 | dataclass 里直接写 `tags: list[str] = []`。改成 `field(default_factory=list)`,注意 `list` 后面不带括号 |
| `TypeError: non-default argument 'title' follows default argument` | 50 | 有默认值的字段写在了没默认值的前面。有默认值的放最后 |
| `ImportError: cannot import name 'Status' from partially initialized module 'ticket_types'` | 50 | 两个模块互相 import(Day 50 实测)。让依赖单向,共同要用的东西放进第三个文件 |
| `TypeError: '<' not supported between instances of 'str' and 'int'` | 50、51 | dataclass 不转换类型,`"66"` 原样存进金额,后面比大小炸了。外来数据用 pydantic |
| `Input should be a valid number, unable to parse string as a number [type=float_parsing, ...]` | 51 | 金额收到 `"八十九"`。`type` 代号是 `float_parsing`,翻译提示挂在代号上 |
| `Input should be greater than 0 [type=greater_than, ...]` | 52 | `Field(gt=0)` 拦下了 -1。数字限制在 `ctx` 里,翻译时用 `{gt:g}` 取 |
| `Value error, 标题不能全是空格` | 52 | 自己的校验器 `raise ValueError(...)` 被包装成 `value_error`。别抛 ValidationError,也别抛自己的异常类 |
| `KeyError: 'LLM_API_KEY'` | 53 | 没读到 `.env`:不在项目根目录、文件名不对(`env`、`.env.txt`)、变量名拼错 |
| `load_dotenv(".env.test")` 返回 `False`,环境里什么都没多 | 53 | 点名的文件名是相对于**当前目录**的,在 `part01` 里运行就找不到,而且不报错。命令从项目根目录运行 |
| `EOFError: EOF when reading a line` | 54 | `input()` 读不到内容了:管道里的输入不够,或用户按了 `Ctrl + D`。用 `try/except EOFError` 当成「输入结束」 |
| `出错了: bad.json 不是合法的 JSON(Expecting property name enclosed in double quotes,第 1 行)` | 54 | 数据文件被手改坏了(尾逗号、单引号)。读不出来就停下,**绝不**当空本子覆盖 |
| `bool("0")` 得到 `True` | 55 | 环境变量永远是字符串,非空字符串都是真。开关要写 `== "1"`(见练习 2) |

## 动手练习

### 练习 1:再写一个汇报者,故意叫错参数名

给 `Reporter` 再写一个实现 `JsonReporter`:把每句话包成 `{"msg": 话}` 的 JSON 字符串存进列表。第一版故意把方法写成 `def say(self, msg: str)`,用 `reporter: Reporter = JsonReporter()` 声明,看检查器怎么说;再写一句 `reporter.say(text="直接用关键字传参")` 看运行时怎么说。然后改对,让它能传给 `import_customers`。第一版文件 `part01/ex55_reporter_bad.py`,第二版 `part01/ex55_reporter_good.py`。

<details>
<summary>参考答案</summary>

第一版:

```python
# agent-zero-lab/part01/ex55_reporter_bad.py
import json

from customer_import import Reporter


class JsonReporter:
    def __init__(self) -> None:
        self.records: list[str] = []

    def say(self, msg: str) -> None:
        self.records.append(json.dumps({"msg": msg}, ensure_ascii=False))


reporter: Reporter = JsonReporter()
reporter.say(text="直接用关键字传参")
```

<div class="line-notes">

- `from customer_import import Reporter` 只需要协议。
- `def say(self, msg: str) -> None:` 参数名叫 `msg`,和协议里的 `text` 不同。
- `self.records.append(json.dumps({"msg": msg}, ensure_ascii=False))` 包成 JSON 字符串。
- `reporter: Reporter = JsonReporter()` 把它赋给协议类型的变量,检查器在这一行比对形状。
- `reporter.say(text="直接用关键字传参")` 按协议里的参数名调用,检查器认为合法,因为 `reporter` 的声明类型是 Reporter。

</div>

```bash
uv run basedpyright part01/ex55_reporter_bad.py
uv run python part01/ex55_reporter_bad.py
```

实测输出(检查结果里的路径缩短了,运行报错只留最后两行):

```text
part01/ex55_reporter_bad.py
  part01/ex55_reporter_bad.py:15:22 - error: Type "JsonReporter" is not assignable to declared type "Reporter"
    "JsonReporter" is incompatible with protocol "Reporter"
      "say" is an incompatible type
        Type "(msg: str) -> None" is not assignable to type "(text: str) -> None"
          Parameter name mismatch: "text" versus "msg" (reportAssignmentType)
1 error, 0 warnings, 0 notes
    reporter.say(text="直接用关键字传参")
TypeError: JsonReporter.say() got an unexpected keyword argument 'text'
```

检查器在赋值那一行就指出了:`Parameter name mismatch: "text" versus "msg"`。如果不理它硬跑,运行到按关键字调用时才炸,`unexpected keyword argument 'text'`。参数名是接口的一部分,因为 Python 允许按名字传参。改成 `text` 就好:

```python
# agent-zero-lab/part01/ex55_reporter_good.py
import json

from customer_import import Reporter, import_customers


class JsonReporter:
    def __init__(self) -> None:
        self.records: list[str] = []

    def say(self, text: str) -> None:
        self.records.append(json.dumps({"msg": text}, ensure_ascii=False))


reporter = JsonReporter()
checked: Reporter = reporter
result = import_customers([{"id": "C-100", "name": "甲"}, {"id": "C-100", "name": "乙"}], checked)
print(len(result.ok), reporter.records)
```

<div class="line-notes">

- `def say(self, text: str) -> None:` 参数名和协议一致。
- `reporter = JsonReporter()` 这次不标类型,保留具体类型,下面才能读 `reporter.records`。
- `checked: Reporter = reporter` 另起一个变量声明成协议类型,让检查器照样比对一遍。
- `result = import_customers([{"id": "C-100", "name": "甲"}, {"id": "C-100", "name": "乙"}], checked)` 两行编号相同,第二行会被查重拦下。
- `print(len(result.ok), reporter.records)` 导入 1 个,汇报者收到 1 条。

</div>

```text
1 ['{"msg": "第 2 行被拦 -> id: C-100 前面已经导入过了"}']
```

检查两个文件:`ex55_reporter_good.py` 是 0 errors;`ex55_reporter_bad.py` 是 1 error。

</details>

### 练习 2:预演开关

给导入脚本加一个预演开关:环境变量 `IMPORT_DRY_RUN=1` 时只汇报「本来会写入几个客户」,不真的写 `customers_ok.json`。先自己想一想为什么不能写 `if os.environ.get("IMPORT_DRY_RUN"):`,用一行 Python 验证。新建 `part01/ex55_dry.py`,复用 `customer_import` 里的东西。

<details>
<summary>参考答案</summary>

先验证直觉:

```bash
uv run python -c "print(bool('0'), bool(''), bool('false'))"
```

```text
True False True
```

环境变量永远是字符串。`"0"` 和 `"false"` 都是**非空字符串**,在 `if` 里是真。所以 `IMPORT_DRY_RUN=0` 想表达「不预演」,却会被当成要预演。判断必须写成和一个具体的值比较。`ex55_dry.py`:

```python
# agent-zero-lab/part01/ex55_dry.py
import json
import os
import sys
from typing import Any

from dotenv import load_dotenv

from customer_import import OUT, SRC, ConsoleReporter, import_customers


def is_dry_run() -> bool:
    return os.environ.get("IMPORT_DRY_RUN", "0") == "1"


def main() -> int:
    load_dotenv()
    rows: list[dict[str, Any]] = json.loads(SRC.read_text(encoding="utf-8"))
    result = import_customers(rows, ConsoleReporter())
    if is_dry_run():
        print(f"预演:本来会写入 {len(result.ok)} 个客户到 {OUT.name},没有真写")
    else:
        OUT.write_text(json.dumps([c.model_dump() for c in result.ok], ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"已写入 {len(result.ok)} 个客户到 {OUT.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

<div class="line-notes">

- `from customer_import import OUT, SRC, ConsoleReporter, import_customers` 复用路径常量、汇报者和核心函数。
- `def is_dry_run() -> bool:` 单独一个函数,判断逻辑只有一处。
- `return os.environ.get("IMPORT_DRY_RUN", "0") == "1"` `.get` 的第二个参数是没设时的默认值 `"0"`;只有恰好是 `"1"` 才返回 True,`"0"`、`"false"`、空、没设,全部是 False。
- `result = import_customers(rows, ConsoleReporter())` 预演也要真的校验一遍,才知道本来会写几个。
- `if is_dry_run():` 预演分支。
- `print(f"预演:本来会写入 {len(result.ok)} 个客户到 {OUT.name},没有真写")` 只打印不写文件。
- `OUT.write_text(json.dumps(` 正式分支才写盘。

</div>

```bash
rm -f part01/data/customers_ok.json
IMPORT_DRY_RUN=1 uv run python part01/ex55_dry.py | tail -2
ls part01/data | grep customers_ok
IMPORT_DRY_RUN=0 uv run python part01/ex55_dry.py | tail -1
ls part01/data | grep customers_ok
```

实测输出:

```text
第 7 行被拦 -> id: C-001 前面已经导入过了
预演:本来会写入 5 个客户到 customers_ok.json,没有真写
已写入 5 个客户到 customers_ok.json
customers_ok.json
```

第一次预演:有汇报、没有写文件(紧跟着的 `ls | grep` 什么也没打印);`IMPORT_DRY_RUN=0` 正常写入,最后一条 `ls` 找到了文件。

</details>

### 练习 3:被拦的行存成 JSON Lines

现在被拦的行只在汇报里一闪而过。写 `part01/ex55_rejected.py`:读名单、导入,把每个被拦的行存进 `part01/data/customers_rejected.jsonl`,每行一条记录,带行号、原始数据、原因。

<details>
<summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex55_rejected.py
import json
import sys
from typing import Any

from customer_import import DATA, SRC, ListReporter, import_customers

REJECTED = DATA / "customers_rejected.jsonl"


def main() -> int:
    rows: list[dict[str, Any]] = json.loads(SRC.read_text(encoding="utf-8"))
    result = import_customers(rows, ListReporter())
    with REJECTED.open("w", encoding="utf-8") as f:
        for number, reason in result.rejected.items():
            record = {"row": number, "raw": rows[number - 1], "reason": reason}
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    print(f"写了 {len(result.rejected)} 行到 {REJECTED.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

<div class="line-notes">

- `from customer_import import DATA, SRC, ListReporter, import_customers` 汇报用不到,用假汇报者把它吞掉,屏幕上就只剩本脚本自己的那一行。
- `REJECTED = DATA / "customers_rejected.jsonl"` 输出文件。
- `result = import_customers(rows, ListReporter())` 导入。`result.rejected` 是 `{3: ..., 4: ..., ...}`。
- `with REJECTED.open("w", encoding="utf-8") as f:` 这里用 `"w"` 而不是 `"a"`:每次运行都从头写,日志不累积。录入工具里要累积的日志才用 `"a"`。
- `for number, reason in result.rejected.items():` 同时拿行号和原因。
- `record = {"row": number, "raw": rows[number - 1], "reason": reason}` 行号从 1 开始,列表下标从 0 开始,所以取原始数据要减一。第 3 行对应 `rows[2]`。
- `f.write(json.dumps(record, ensure_ascii=False) + "\n")` 一条记录一行。

</div>

```bash
uv run python part01/ex55_rejected.py
head -2 part01/data/customers_rejected.jsonl
wc -l part01/data/customers_rejected.jsonl
```

实测输出:

```text
写了 5 行到 customers_rejected.jsonl
{"row": 3, "raw": {"id": "C-003", "name": "", "plan": "basic"}, "reason": "name: String should have at least 1 character"}
{"row": 4, "raw": {"id": "C-004", "name": "Jim", "plan": "vip"}, "reason": "plan: Input should be 'basic', 'pro' or 'team'"}
       5 part01/data/customers_rejected.jsonl
```

五行,和被拦的五个行号对得上。销售拿到这个文件,可以直接对着行号回去改原始名单。

</details>

验收标准:三段默写都能不看文章写出来,`uv run basedpyright` 全部 0 errors;`customer_import.py` 的输出和退出码(1)与文中一致,换成 `IMPORT_REPORT` 后屏幕上只剩退出码;`import_check.py` 打印「检查通过」;三个练习的输出和参考答案一致;错题表里随便挑一行,能说出病因。

## 名词解释

今天没有新概念,只有小项目和练习里第一次正式用到的几个写法:

| 名词 | 意思 |
| --- | --- |
| `assert 条件` | 断言:条件为真什么都不发生,为假抛 `AssertionError`。最简单的自检方式,Day 71 起会换成 pytest |
| 预演(dry run) | 把「会做什么」算出来并报告,但不真的改数据。Day 48 讲过,今天用环境变量开关它 |
| 假对象(fake) | 满足同一个接口、但不做真事的替身,比如 `ListReporter`、`FakeClient`。让核心函数不用碰屏幕、文件和网络就能检查 |
| 查重 | 导入前检查新数据是否和已有的重复。它是「整份名单」的规则,放在导入函数里,不放在单个模型里 |
| `ensure_ascii=False` | `json.dumps` 的参数,让中文原样输出,不转成 `\uXXXX` |
| `sorted(字典)` | 对字典排序得到排好序的键列表 |

## 常见误区

**用 `bool(os.environ.get("X"))` 判断开关。** `"0"` 和 `"false"` 都是真。要和具体的值比较,比如 `== "1"`。

**把「查重」写进单个模型。** 模型只看得到自己这一条,重复是和别的行比较才知道的事。放在批处理函数里,用 `by_id` 之类的查找去做。

**核心函数里直接 `print`。** `import_customers` 只管导入,汇报通过 `reporter.say` 交出去。如果函数里写死 `print`,换成写文件、写日志就得改核心函数,也没法检查它说了什么。

**以为 `rows: list[dict[str, Any]] = json.loads(...)` 就是校验了。** 它只是告诉检查器「请当它是这个类型」,运行时一个字节都没检查。真正的检查是每行的 `Customer.model_validate`。

**默写时「差不多一样」就算过。** 这一周的代码里很多是对括号、装饰器顺序、参数名这种细节极其敏感的东西。`@classmethod` 在 `@field_validator` 下面还是上面、Protocol 的参数名叫 `text` 还是 `msg`,不一致就是红线或报错。默写要对着检查器过一遍。

## 学习资料

### 文档与文章

- [Python 官方文档 · dataclasses(中文)](https://docs.python.org/zh-cn/3.12/library/dataclasses.html):Day 50 的全部内容都在这一页,页内搜 `default_factory` 和 `__post_init__` 各看一遍例子。
- [pydantic 文档 · Models](https://docs.pydantic.dev/latest/concepts/models/):`model_validate`、`model_dump` 的完整说明。
- [pydantic 文档 · Fields](https://docs.pydantic.dev/latest/concepts/fields/):`Field` 的所有参数,看一遍你就知道还有哪些约束可以用(`multiple_of`、`strict` 等)。
- [Python typing 规范 · Protocols](https://typing.python.org/en/latest/spec/protocol.html):Protocol 的权威说明,有一节专讲「成员签名怎么比较」,对应今天练习 1 的参数名。
- [PEP 695 · 类型参数语法](https://peps.python.org/pep-0695/):Day 49 的 `def by_id[T: HasId]` 这种写法的来历,读「Motivation」一节就够。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1B5yqBCEPT&autoplay=0&high_quality=1" title="Python数据验证神器Pydantic：FastAPI开发者必学的完整教程【中英字幕】" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>认真的笨笨 · Python数据验证神器Pydantic · 约 89 分钟,2025 年。完整教程,今天只看前半:模型定义、Field、校验器那几章,对着本周的 `Ticket` 和 `Customer` 看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV15zSVYtE13&autoplay=0&high_quality=1" title="【Py】dataclass：懂事的类会自己生成方法 | Python特性" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Hucci写代码 · dataclass:懂事的类会自己生成方法 · 约 7 分钟,2024 年。Day 50 推荐过,复习日再看一遍,这次对照 `ImportResult` 里的 `field(default_factory=...)`。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/zN4VCb0LbQI" title="Attrs, Pydantic, or Python Data Classes?" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>ArjanCodes · Attrs, Pydantic, or Python Data Classes? · 英文。同一个例子用三种方式写一遍并比较,正好回答「三种装数据的东西怎么选」,有英文字幕可以开。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/YTsJQ4ixq88" title="7 Things You Didn’t Know Dataclasses Could Do" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>ArjanCodes · 7 Things You Didn’t Know Dataclasses Could Do · 英文。dataclass 的进阶用法,看前几个就够,`frozen` 和 `field` 的部分对应 Day 50 的练习。</figcaption>
</figure>

### 书籍

- 《流畅的 Python(第 2 版)》,Luciano Ramalho 著,人民邮电出版社,2023。第 5 章「数据类构建器」把 namedtuple、`NamedTuple`、dataclass 放在一起比较,正好回答「选哪个」;第 13 章「接口、协议和抽象基类」讲 Protocol 和鸭子类型。现在读第 5 章就够了。

### 开源项目与代码

- [python-dotenv](https://github.com/theskumar/python-dotenv):Day 53 用的库,`src/dotenv/main.py` 里的 `find_dotenv` 就是「从脚本所在目录往上找」的实现,几十行,读得懂。
- [pydantic](https://github.com/pydantic/pydantic):本周的核心依赖。想知道 `Field(gt=0)` 报的 `greater_than` 从哪来,搜它的源码。

## 自测

1. 下面这个类为什么能传给 `ask(client: ChatClient, ...)`,尽管它没继承任何东西?

```python
class EchoClient:
    def chat(self, messages: list[Message]) -> str:
        return messages[-1]["content"]
```

<details><summary>答案</summary>

`ChatClient` 是 Protocol,检查器只比对形状:有没有叫 `chat` 的方法、参数名和类型是否一致、返回类型是否一致。EchoClient 的 `chat(self, messages: list[Message]) -> str` 完全一致,所以被认可。继承不是必需的。

</details>

2. `by_id[T: HasId]` 里的 `T: HasId` 是什么意思?传进 `list[Customer]`,返回值的类型是什么?

<details><summary>答案</summary>

T 是一个类型变量,冒号后面是上限:T 必须满足 `HasId`(有 `id: str` 属性)。传进 `list[Customer]` 时 T 被确定为 `Customer`,返回类型是 `Customer | None`,不是笼统的 `HasId | None`,所以调用方拿到的仍然是 Customer,能读它的 `name`、`plan`。

</details>

3. `ImportResult` 里为什么写 `ok: list[Customer] = field(default_factory=list)` 而不是 `ok: list[Customer] = []`?

<details><summary>答案</summary>

直接写 `= []`,dataclass 在定义类的时候就会抛 `ValueError: mutable default <class 'list'> for field ok is not allowed: use default_factory`,因为所有对象会共享同一个列表。`default_factory=list` 让每次造对象时调用一次 `list()`,每个对象拿到自己的空列表。

</details>

4. 为什么「导入了的编号不能重复」这条规则没有写进 `Customer` 模型,而是写在 `import_customers` 里?

<details><summary>答案</summary>

一个模型实例只知道自己的字段,看不见别的客户。重复是「这一行和之前已经导入的行比较」才知道的事,需要看见整份结果,所以放在逐行处理的函数里。

</details>

5. (面试题)你要导入一份用户上传的 5000 行 CSV 或 JSON,有些行格式不对。你怎么设计,才能让用户一次就知道所有问题,而不是改一个错、再传一次、再发现下一个错?

<details><summary>答案</summary>

逐行校验,每一行的错都接住并记下,不要遇到第一个错就整体失败;同一行的多个错也用「一次报完」的校验方式(pydantic 的 ValidationError 本来就把一行里所有错收在一起)。最后返回一份汇总:总行数、成功几行、失败几行,以及每个失败行的行号、原始数据、原因,最好还能存成文件让用户下载。重复、跨行的规则放在批处理函数里单独检查。只有「整份文件打不开」这种致命错误才整体失败。

</details>

6. `IMPORT_DRY_RUN=false uv run python part01/ex55_dry.py` 如果判断写成 `if os.environ.get("IMPORT_DRY_RUN"):`,会发生什么?

<details><summary>答案</summary>

会进入预演分支,不写文件。环境变量取出来是字符串 `"false"`,非空字符串在 `if` 里是真。要和具体值比较,比如 `== "1"`。

</details>

## 明天预告

明天是 [Day 56 · git(一):仓库、add、commit、log 和 diff](/blog/agent-zero/day-056-git-1/)。这一周你建了很多文件:`.env`、`.env.example`、一堆 `part01/*.py`、几份 JSON 数据。到现在 `agent-zero-lab` 里的所有东西都还没有提交过一次,`git status` 一直是一排 `??`。明天第一次提交,并且亲眼看一遍:要是 `.gitignore` 没写对,key 会怎样跟着进仓库。
