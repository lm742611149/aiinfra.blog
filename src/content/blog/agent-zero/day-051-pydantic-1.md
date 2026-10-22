---
title: 'Day 51 · pydantic(一):守大门的模型和校验报错'
description: '外面进来的数据(表单、JSON、以后的模型输出)不能信。今天装上 pydantic,用 BaseModel 写一个工单表单模型:类型对不上会被拦下,能转的会被转好;再把 ValidationError 拆开看,把英文报错翻成表单上的中文提示。写法和前端的 zod 是一个思路。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'pydantic', 'agent-zero']
series: 'agent-zero'
day: 51
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 50](/blog/agent-zero/day-050-dataclass/) 用 `@dataclass` 把 Ticket 改写成只列字段的类,Python 自动生成了 `__init__`、`__repr__` 和 `__eq__`,校验写在 `__post_init__` 里。那一课最后老老实实说了 dataclass 的两个洞:它**不检查类型**,`TicketDC(1004, None, "八十九")` 照样造得出来;校验全靠自己手写的 if。

Day 50 的自测最后一题问过 dataclass 和 pydantic 怎么选,答案是「看数据从哪来」。工单记事本里的数据是自己代码造的,dataclass 够用。可接下来几个月,你要处理的数据大多从外面来:网页表单提交的工单、HTTP 接口收到的 JSON,到第二部分还有大模型吐出来的 JSON。这些数据进门之前要有人把关,今天就请这个门卫上岗。

## 今天要解决的问题

学完今天,你应该能:

1. 用 `uv add pydantic` 装好 pydantic,写一个继承 `BaseModel` 的模型,说出它和 dataclass 最大的区别:**造对象时按类型标注检查并转换数据**。
2. 读懂一条 `ValidationError`:哪个字段、什么错误类型、收到的是什么;会用 `e.errors()` 逐条取出来。
3. 知道 pydantic 默认的「宽松模式」会帮你转哪些值(`"66"` 变 66.0)、拦哪些值(`"八十九"`、`None`),以及检查器和运行时各管哪一段。
4. 写出 `part01/ticket_form.py`:校验 5 条网页表单提交的工单,通过的变成模型对象,不通过的给出中文提示。

预计用时:2.5 小时。前置:[Day 39](/blog/agent-zero/day-039-json/) 的 `json.loads`、[Day 36](/blog/agent-zero/day-036-exceptions-2/) 的 try/except、[Day 40](/blog/agent-zero/day-040-classes-1/) 的类和继承、[Day 47](/blog/agent-zero/day-047-type-hints-3/) 的 `ticket_types.py`(`Status`)、[Day 50](/blog/agent-zero/day-050-dataclass/) 的 `ticket_dc.py`。

学法:先对照文章逐行敲一遍(不要复制粘贴)并跑通;第二天合上文章,把 `ticket_form.py` 里的 TicketForm 模型和 `check_form` 默写出来;再做动手练习,做不出来再展开参考答案,看完关掉自己重写一遍。

命令都在项目根目录 `agent-zero-lab` 里跑,新文件放进 `part01/`。今天要装一个第三方库 pydantic,不调 API,花费 0 元。检查结果和报错里的长路径我缩短成了文件名。

## 先看问题:表单里的数字都是字符串

你写前端时一定碰到过这件事:`<input type="number">` 里填了 66,`e.target.value` 拿到的是字符串 `"66"`;用 `FormData` 提交,所有值也都是字符串。后端收到的 JSON 里,金额很可能就是 `"amount": "66"`。

拿 Day 50 的 dataclass 版 Ticket 接一下这种数据。新建 `part01/form_problem.py`:

```python
# agent-zero-lab/part01/form_problem.py
import json

from ticket_dc import Ticket

body = '{"id": "T-1006", "title": "发票重开", "amount": "66", "status": "open"}'
form = json.loads(body)
print(form["amount"], type(form["amount"]))
try:
    t = Ticket(**form)
    print(t)
except Exception as e:
    print(type(e).__name__, e)
```

<div class="line-notes">

- `from ticket_dc import Ticket` Day 50 写的 dataclass 版工单,`__post_init__` 里查标题、金额、状态。
- `body = '{"id": "T-1006", "title": "发票重开", "amount": "66", "status": "open"}'` 模拟浏览器提交上来的请求体,金额 `"66"` 带着引号,是字符串。
- `form = json.loads(body)` Day 39 学的,把 JSON 文本变成字典。检查器只知道它是 Any,不知道里面每个值是什么类型。
- `print(form["amount"], type(form["amount"]))` 先确认金额到底是什么类型。
- `t = Ticket(**form)` Day 30 的 `**`,把字典拆成关键字参数。
- `except Exception as e:` 为了看清报的是什么错,先把所有异常接住,打印异常的类名和内容。正式代码里不要这么宽地接。

</div>

```bash
uv run basedpyright part01/form_problem.py
uv run python part01/form_problem.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
66 <class 'str'>
TypeError '<' not supported between instances of 'str' and 'int'
```

检查器一声不吭,因为 `json.loads` 返回的是 Any,它没法知道 `"66"` 是字符串。运行时 dataclass 把 `"66"` 原样存进了 amount,然后 `__post_init__` 里那句 `self.amount < 0` 拿字符串和 0 比大小,炸出一个 TypeError。

这条报错有两个毛病。第一,它说的是「`<` 不支持 str 和 int」,完全没提「金额」两个字,用户看不懂,你排查时也得翻代码才知道是哪一行。第二,`"66"` 其实是个完全合理的金额,只是类型差了一点,我们本意是想收下它的。

要修,就得在 `__post_init__` 最前面加一串:amount 是字符串就试着转 float,转不了就报「金额不是数字」;id 不是字符串就报错;status 不在范围里就报错……字段一多,又回到 Day 41 那种长长的 if 链。这种「按类型标注检查并转换外来数据」的活,pydantic 已经替你写好了。

## 装上 pydantic

pydantic 不是标准库,要装。在 `agent-zero-lab` 根目录:

```bash
uv add pydantic
```

实测输出:

```text
Resolved 8 packages in 24ms
Installed 5 packages in 23ms
 + annotated-types==0.8.0
 + pydantic==2.14.1
 + pydantic-core==2.50.1
 + typing-extensions==4.16.0
 + typing-inspection==0.4.4
```

一个 `uv add` 装了 5 个包,另外 4 个是 pydantic 自己的依赖,和 npm 装一个包带进来一串依赖一样(Day 10)。其中 `pydantic-core` 是用 Rust 写的校验内核,所以 pydantic 虽然每次都要检查,速度并不慢。2026 年 10 月我查到 PyPI 上的最新版是 2.14.1,你装到的版本可能更新,只要是 2 开头就和本文一致。

一定要认准 **pydantic 2**。网上还有大量 pydantic 1 的老教程,写法有不少不同(比如 v1 的 `.dict()`、`@validator`,v2 里分别叫 `model_dump()`、`@field_validator`,明天讲)。看到 `from pydantic import validator`、`class Config:` 这种写法,就知道是老教程。

## 第一步:BaseModel,写法和 dataclass 几乎一样

新建 `part01/pd_basic.py`:

```python
# agent-zero-lab/part01/pd_basic.py
import json

from pydantic import BaseModel

from ticket_types import Status


class TicketForm(BaseModel):
    id: str
    title: str
    amount: float
    status: Status = "open"


a = TicketForm(id="T-1004", title="扣费两次", amount=89.5)
print(a)
print(repr(a))
print(a.amount, a.status)

form = json.loads('{"id": "T-1006", "title": "发票重开", "amount": "66", "status": "open"}')
b = TicketForm(**form)
print(repr(b))
print(type(form["amount"]), "->", type(b.amount))

c = TicketForm(id="T-1006", title="发票重开", amount=66.0)
print(b == c)
```

<div class="line-notes">

- `from pydantic import BaseModel` BaseModel 是 pydantic 的基类。注意 import 的名字是小写的 `pydantic`,和包名一样。
- `from ticket_types import Status` Day 47 的 `Literal["open", "closed"]`,直接拿来用。
- `class TicketForm(BaseModel):` 和 Day 50 不同,这里不是加装饰器,而是**继承** BaseModel(Day 42 讲过继承)。继承之后,这个类就有了「造对象时检查数据」的本事。名字叫 TicketForm,强调它是「表单进来的那一份」。
- `id: str` 字段写法和 dataclass 一模一样:`名字: 类型`。没有默认值就是必填。
- `amount: float` 金额是 float。待会儿看它怎么对待字符串 `"66"`。
- `status: Status = "open"` 有默认值的字段,不传就是 open。类型是 Literal,pydantic 在运行时也会检查它,这一点 dataclass 做不到。
- `a = TicketForm(id="T-1004", title="扣费两次", amount=89.5)` pydantic 模型**只能用关键字传参**,不能写成 `TicketForm("T-1004", "扣费两次", 89.5)`(常见误区里有实测报错)。
- `print(a)` 直接 print 会走 `__str__`,pydantic 的格式是 `字段=值` 用空格隔开,没有类名。
- `print(repr(a))` repr 带类名,和 dataclass 的格式一样。
- `form = json.loads(` 和开头一样的表单数据,金额是字符串 `"66"`。
- `b = TicketForm(**form)` 把字典拆开传进去。明天会学一个更正规的写法 `model_validate`,今天先用你熟悉的 `**`。
- `print(type(form["amount"]), "->", type(b.amount))` 进去之前和出来之后,金额分别是什么类型。
- `c = TicketForm(id="T-1006", title="发票重开", amount=66.0)` 金额直接给 66.0。
- `print(b == c)` pydantic 模型也会按字段比较相等,和 dataclass 一样。

</div>

```bash
uv run basedpyright part01/pd_basic.py
uv run python part01/pd_basic.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
id='T-1004' title='扣费两次' amount=89.5 status='open'
TicketForm(id='T-1004', title='扣费两次', amount=89.5, status='open')
89.5 open
TicketForm(id='T-1006', title='发票重开', amount=66.0, status='open')
<class 'str'> -> <class 'float'>
True
```

看第四、五行:进去的是字符串 `"66"`,出来的 `b.amount` 是 float 66.0。pydantic 看到字段标注的是 float,收到的字符串又能干净地转成数字,就替你转了。这叫**解析**(parse):不只是检查「是不是 float」,而是「能不能变成 float,能就变」。所以造出来的对象,`b.amount` 一定是 float,后面的代码可以放心拿它做加减比较,不会再碰到开头那个 TypeError。

这就是标题里「守大门」的意思。外面的数据乱七八糟,进门时 pydantic 统一检查、统一转换,门里面的代码拿到的都是类型干净的对象。

### 和 zod 对照一下

如果你在前端用过 zod,今天的东西你已经会了一大半。两边写法对照:

| 做的事 | zod(TS) | pydantic(Python) |
| --- | --- | --- |
| 定义结构 | `const TicketForm = z.object({ id: z.string(), amount: z.number() })` | `class TicketForm(BaseModel):` 下面写 `id: str`、`amount: float` |
| 可选值的字面量 | `z.enum(["open", "closed"])` | `Literal["open", "closed"]` |
| 校验,失败抛异常 | `TicketForm.parse(data)` | `TicketForm(**data)`(明天学 `model_validate(data)`) |
| 失败时的异常 | `ZodError`,问题列表在 `.issues` | `ValidationError`,问题列表在 `.errors()` |
| 每条问题 | `{ path, message, code }` | `{ loc, msg, type, input }` |
| 从结构得到类型 | `z.infer<typeof TicketForm>` | 不用,类本身就是类型 |

最后一行是两者最大的写法差别。TS 的类型在运行时不存在,zod 只能先写一个运行时的 schema,再用 `z.infer` 反推出类型。Python 的类型标注在运行时还在(Day 45 讲过,它只是不被执行),pydantic 直接读类上的标注干活,一份定义同时是类型和校验规则。

还有一处行为不一样:zod 的 `z.number()` 收到字符串 `"66"` 会报错,要转得写 `z.coerce.number()`;pydantic 默认就转。这个差别第三步专门看。

## 第二步:ValidationError 长什么样

转不了的数据会怎样?故意给一份四处都错的表单。新建 `part01/pd_error.py`:

```python
# agent-zero-lab/part01/pd_error.py
import json

from pydantic import BaseModel, ValidationError

from ticket_types import Status


class TicketForm(BaseModel):
    id: str
    title: str
    amount: float
    status: Status = "open"


form = json.loads('{"id": 1006, "amount": "八十九", "status": "pending"}')
try:
    TicketForm(**form)
except ValidationError as e:
    print(e)
    print("一共几处错:", e.error_count())
    for err in e.errors():
        print(err["loc"], err["type"], err["msg"], repr(err["input"]))
```

<div class="line-notes">

- `from pydantic import BaseModel, ValidationError` ValidationError 是校验失败时抛的异常类,要 import 进来才能在 except 里写它。
- `form = json.loads('{"id": 1006, "amount": "八十九", "status": "pending"}')` 四个问题:id 是数字不是字符串、title 整个没有、金额是中文、状态不在 Literal 里。
- `TicketForm(**form)` 造对象就是校验,不用另外调什么 check 方法。
- `except ValidationError as e:` 只接校验错误。和 Day 36 讲的一样,接得越准越好,别的异常该炸就让它炸。
- `print(e)` 整条报错转成文字,给人看的。
- `print("一共几处错:", e.error_count())` error_count() 返回错误条数。
- `for err in e.errors():` errors() 返回一个列表,每个元素是一个字典,对应一处错误。给程序用的就是它。
- `print(err["loc"], err["type"], err["msg"], repr(err["input"]))` 每条错误最常用的四个键:loc 是位置(哪个字段),type 是错误类型的代号,msg 是英文说明,input 是收到的值。

</div>

```bash
uv run basedpyright part01/pd_error.py
uv run python part01/pd_error.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
4 validation errors for TicketForm
id
  Input should be a valid string [type=string_type, input_value=1006, input_type=int]
    For further information visit https://errors.pydantic.dev/2.14/v/string_type
title
  Field required [type=missing, input_value={'id': 1006, 'amount': '...', 'status': 'pending'}, input_type=dict]
    For further information visit https://errors.pydantic.dev/2.14/v/missing
amount
  Input should be a valid number, unable to parse string as a number [type=float_parsing, input_value='八十九', input_type=str]
    For further information visit https://errors.pydantic.dev/2.14/v/float_parsing
status
  Input should be 'open' or 'closed' [type=literal_error, input_value='pending', input_type=str]
    For further information visit https://errors.pydantic.dev/2.14/v/literal_error
一共几处错: 4
('id',) string_type Input should be a valid string 1006
('title',) missing Field required {'id': 1006, 'amount': '八十九', 'status': 'pending'}
('amount',) float_parsing Input should be a valid number, unable to parse string as a number '八十九'
('status',) literal_error Input should be 'open' or 'closed' 'pending'
```

先看上半段 `print(e)` 的格式。第一行 `4 validation errors for TicketForm`,一共 4 处错。下面每处错占三行:第一行是字段名;第二行是说明,方括号里是错误类型 `type`、收到的值 `input_value`、收到的值的类型 `input_type`;第三行是官方文档里这种错误的说明页链接,看不懂某种错误时点进去就有例子。

逐条翻译一下:

- `id`:`Input should be a valid string`,应该是字符串,你给的是整数 1006。**pydantic 不会把整数转成字符串**,这一点和金额那边不一样,第三步细说。
- `title`:`Field required`,必填字段没给。这时没有「收到的值」,input 显示的是整份输入字典。
- `amount`:`unable to parse string as a number`,「八十九」解析不成数字。
- `status`:`Input should be 'open' or 'closed'`,Literal 的范围在运行时也被检查了。Day 47 为了这个专门写了 `parse_status`,现在一行都不用写。

最要紧的是**4 处错一次全报出来**。Day 41、Day 50 手写的校验是 if 一条条往下走,碰到第一个问题就 raise,用户改完金额再提交,才发现状态也不对,来回好几趟。pydantic 把所有字段都查完再一起报,和前端表单「提交后所有错误字段一起标红」的体验一样。

下半段是 `e.errors()` 逐条打印的结果。`loc` 是个元组 `('id',)`,不是字符串,因为数据可能有嵌套:如果字段是一个列表,第 3 个元素出了错,loc 会是 `('tags', 2)` 这样的路径,和 zod 的 `path: ["tags", 2]` 一个意思。今天的数据都是一层,取 `loc[0]` 就是字段名。

`type` 是给程序判断用的代号,`msg` 是给人看的英文。要翻译成中文提示,按 type 翻最稳:msg 的措辞可能随版本变,type 是 pydantic 文档里列出来的固定代号。最后拼 ticket_form.py 时就这么做。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="外来数据(表单 JSON、HTTP 请求、以后的模型输出)从左边进来,经过中间的 TicketForm 门卫:能转的转好、转不了的拦下。右上是通过的模型对象,字段类型都是干净的;右下是 ValidationError,包含所有出错字段的 loc、type、msg、input">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink-faint)" font-size="11">门外:什么都可能</text>
<rect x="20" y="40" width="170" height="170" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="34" y="66" fill="var(--ink)">表单 JSON</text>
<text x="34" y="86" fill="var(--ink-soft)" font-size="11">"amount": "66"</text>
<text x="34" y="116" fill="var(--ink)">HTTP 请求</text>
<text x="34" y="136" fill="var(--ink-soft)" font-size="11">"id": 1006</text>
<text x="34" y="166" fill="var(--ink)">模型输出(第二部分)</text>
<text x="34" y="186" fill="var(--ink-soft)" font-size="11">"status": "pending"</text>
<line x1="190" y1="125" x2="240" y2="125" stroke="var(--rule)"/>
<rect x="240" y="80" width="150" height="90" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="315" y="112" text-anchor="middle" fill="var(--ink)">TicketForm</text>
<text x="315" y="132" text-anchor="middle" fill="var(--ink-soft)" font-size="11">按标注检查</text>
<text x="315" y="150" text-anchor="middle" fill="var(--ink-soft)" font-size="11">能转就转</text>
<line x1="390" y1="110" x2="430" y2="70" stroke="var(--rule)"/>
<line x1="390" y1="140" x2="430" y2="180" stroke="var(--rule)"/>
<rect x="430" y="40" width="190" height="60" rx="4" fill="none" stroke="var(--rule)"/>
<text x="444" y="64" fill="var(--ink)">通过:模型对象</text>
<text x="444" y="84" fill="var(--ink-soft)" font-size="11">amount 一定是 float</text>
<rect x="430" y="150" width="190" height="80" rx="4" fill="none" stroke="var(--rule)"/>
<text x="444" y="174" fill="var(--ink)">拦下:ValidationError</text>
<text x="444" y="194" fill="var(--ink-soft)" font-size="11">所有错一次报完</text>
<text x="444" y="212" fill="var(--ink-soft)" font-size="11">loc / type / msg / input</text>
</g>
</svg>
<figcaption>门外的数据格式五花八门,进门只有两种结局:变成字段类型都对的模型对象,或者带着一份完整错误清单被拦下。门里面的代码不用再关心「这个金额会不会是字符串」。</figcaption>
</figure>

## 第三步:宽松模式会帮你转哪些

第一步看到 `"66"` 被转成了 66.0,第二步看到 1006 没被转成字符串。到底哪些转、哪些不转?猜不如试。新建 `part01/pd_lax.py`,一个字段一个字段地喂各种值:

```python
# agent-zero-lab/part01/pd_lax.py
from typing import Any

from pydantic import BaseModel, ValidationError


class Probe(BaseModel):
    amount: float = 0
    urgent: bool = False
    note: str = ""


def check(field: str, values: list[Any]) -> None:
    for v in values:
        try:
            p = Probe(**{field: v})
            print(f"{field} 收到 {v!r:8} 通过,存成 {getattr(p, field)!r}")
        except ValidationError as e:
            print(f"{field} 收到 {v!r:8} 拦下,{e.errors()[0]['type']}")


check("amount", ["89.5", " 89.5 ", "1e2", 100, True, "八十九", None])
check("urgent", ["on", "yes", "false", 0, "是", 2])
check("note", ["加急", 100, None])
```

<div class="line-notes">

- `from typing import Any` 待测的值五花八门,列表类型只能写 `list[Any]`(Day 46)。
- `class Probe(BaseModel):` 一个专门用来试的模型,三个字段都有默认值,这样每次只传一个字段也能造。probe 是探针的意思。
- `urgent: bool = False` 布尔字段,比如表单上的「加急」复选框。
- `def check(field: str, values: list[Any]) -> None:` 给某个字段挨个喂值。
- `p = Probe(**{field: v})` `{field: v}` 现造一个只有一个键的字典再拆开,等于 `Probe(amount="89.5")` 这样只传一个字段。
- `print(f"{field} 收到 {v!r:8} 通过,存成 {getattr(p, field)!r}")` `!r` 用 repr 打印,字符串带引号,一眼能分清 `'100'` 和 `100`;`:8` 是占 8 格宽,让输出对齐。`getattr(p, field)` 按名字取属性,`getattr(p, "amount")` 就是 `p.amount`。
- `print(f"{field} 收到 {v!r:8} 拦下,{e.errors()[0]['type']}")` 只打印第一条错误的 type 代号。
- `check("amount", ["89.5", " 89.5 ", "1e2", 100, True, "八十九", None])` 金额字段:普通数字字符串、前后带空格的、科学计数法、整数、布尔、中文、None。
- `check("urgent", ["on", "yes", "false", 0, "是", 2])` 布尔字段。`"on"` 是 HTML 复选框勾上时浏览器默认提交的值。
- `check("note", ["加急", 100, None])` 字符串字段收到数字和 None。

</div>

```bash
uv run basedpyright part01/pd_lax.py
uv run python part01/pd_lax.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
amount 收到 '89.5'   通过,存成 89.5
amount 收到 ' 89.5 ' 通过,存成 89.5
amount 收到 '1e2'    通过,存成 100.0
amount 收到 100      通过,存成 100.0
amount 收到 True     通过,存成 1.0
amount 收到 '八十九'    拦下,float_parsing
amount 收到 None     拦下,float_type
urgent 收到 'on'     通过,存成 True
urgent 收到 'yes'    通过,存成 True
urgent 收到 'false'  通过,存成 False
urgent 收到 0        通过,存成 False
urgent 收到 '是'      拦下,bool_parsing
urgent 收到 2        拦下,bool_parsing
note 收到 '加急'     通过,存成 '加急'
note 收到 100      拦下,string_type
note 收到 None     拦下,string_type
```

(中文字符在终端里占两格,所以带中文的那几行没对齐,不影响。)

规律可以这么记:pydantic 默认的**宽松模式**(lax mode)只做「不会丢信息、不会有歧义」的转换。

- 数字字段:能干净解析成数字的字符串都收,前后的空格会去掉,`"1e2"` 这种科学计数法也认。整数 100 变成 100.0。
- 布尔字段:认一小撮约定俗成的写法,`"on"`、`"yes"`、`"true"`、`"1"` 是真,`"off"`、`"no"`、`"false"`、`"0"` 是假,还有整数 0 和 1。「是」这种中文不认,2 也不认。表单复选框的 `"on"` 能直接收,这对接网页表单很方便。
- 字符串字段:**不收数字**。100 转成 `"100"` 看起来无害,但 pydantic 2 认为数字和字符串是两种东西,工单号 1006 和 `"T-1006"` 不该被悄悄混在一起,所以拦下。
- None 哪里都不收,除非字段写了 `X | None`(Day 46)。

有一个值得留意的意外:`True` 被收进了金额,存成 1.0。Python 里 bool 本来就是 int 的一种(`True == 1` 是 True),pydantic 宽松模式顺着这个规矩放行了。真实场景里很少有人往金额里传布尔值,但你要知道它不会被拦。想要「类型不对就拦,一个都不转」,有严格模式,练习 2 去试。

完整的「什么类型收到什么值会怎么处理」有一张大表,在 pydantic 文档的 Conversion Table 页,学习资料里有链接。碰到「这个值到底收不收」的疑问,查表或者像今天这样写个探针跑一下,都比猜靠谱。

## 检查器和运行时,各管一段

Day 45 起你一直在用 basedpyright 看红线。pydantic 模型在检查器眼里是什么样?新建 `part01/pd_redline.py`:

```python
# agent-zero-lab/part01/pd_redline.py
from pydantic import BaseModel


class TicketForm(BaseModel):
    id: str
    title: str
    amount: float


t = TicketForm(id="T-1006", title="发票重开", amount="66")
print(repr(t))
t.amount = -1
print(repr(t))
t.amount = "abc"
print(repr(t))
```

<div class="line-notes">

- `t = TicketForm(id="T-1006", title="发票重开", amount="66")` 代码里直接写字符串 `"66"`。运行时 pydantic 会转,检查器会怎么说?
- `t.amount = -1` 造好之后改成负数。
- `t.amount = "abc"` 再改成一个根本不是数字的字符串。

</div>

```bash
uv run basedpyright part01/pd_redline.py
uv run python part01/pd_redline.py
```

检查的实测输出:

```text
pd_redline.py:11:50 - error: Argument of type "Literal['66']" cannot be assigned to parameter "amount" of type "float" in function "__init__"
    "Literal['66']" is not assignable to "float" (reportArgumentType)
pd_redline.py:15:12 - error: Cannot assign to attribute "amount" for class "TicketForm"
    "Literal['abc']" is not assignable to "float" (reportAttributeAccessIssue)
2 errors, 0 warnings, 0 notes
```

运行的实测输出:

```text
TicketForm(id='T-1006', title='发票重开', amount=66.0)
TicketForm(id='T-1006', title='发票重开', amount=-1)
TicketForm(id='T-1006', title='发票重开', amount='abc')
```

这里有三个现象,每个都值得记住。

**第一行检查器报错,运行时却通过了。** 检查器只看标注:amount 标的是 float,你写了个字符串字面量,画红线。它不知道 pydantic 运行时会帮你转。这不矛盾,两者分工不同:你自己在代码里写死的值,类型就该写对,`amount=66` 才是正确写法;「字符串要转成数字」是给**外来数据**准备的,外来数据(`json.loads` 的结果)在检查器眼里是 Any,本来就不会画线,第一步的 `TicketForm(**form)` 就是 0 errors。

**造好以后的赋值,pydantic 默认不管。** `t.amount = -1` 和 `t.amount = "abc"` 运行时都改成功了,第三行甚至把一个字符串塞进了 float 字段。和 Day 50 dataclass 的 `__post_init__` 一样,pydantic 默认也只在**造对象那一刻**把关。好在检查器拦下了 `"abc"` 那一行。负数检查器拦不住,因为 -1 是合法的 float;「金额必须为正」是业务规则,不是类型,明天用 `Field(gt=0)` 解决。

想让赋值也过一遍校验,pydantic 有个开关,练习 3 去开。不过我自己的习惯是不开:模型对象尽量「造出来就不改」,要改就造一个新的,改动都要经过构造这一道门。

## 把零件拼起来:ticket_form.py

现在做今天的目标:模拟一个工单提交页面,收到 5 份表单,逐份校验,通过的变成模型对象,不通过的给出能直接显示在表单上的中文提示。

先准备数据。新建 `part01/data/form_submissions.json`,内容如下(这是前端提交上来的样子,金额都是字符串):

```json
[
  {"id": "T-1006", "title": "发票重开", "amount": "66", "status": "open"},
  {"id": "T-1007", "title": "退订后还在扣费", "amount": "八十九", "status": "open"},
  {"id": 1008, "title": "改发票邮箱", "amount": "0", "status": "pending"},
  {"id": "T-1009", "title": "", "amount": "30", "status": "open"},
  {"id": "T-1010", "title": "多扣了一个月", "amount": "-99", "status": "open"}
]
```

然后新建 `part01/ticket_form.py`:

```python
# agent-zero-lab/part01/ticket_form.py
import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ValidationError

from ticket_types import Status

HERE = Path(__file__).resolve().parent
INBOX = HERE / "data" / "form_submissions.json"

LABELS = {"id": "工单号", "title": "标题", "amount": "金额", "status": "状态"}
HINTS = {
    "missing": "必填",
    "string_type": "要填文字",
    "float_parsing": "要填数字",
    "float_type": "要填数字",
    "literal_error": "只能是 open 或 closed",
}


class TicketForm(BaseModel):
    id: str
    title: str
    amount: float
    status: Status = "open"


def to_messages(e: ValidationError) -> list[str]:
    messages: list[str] = []
    for err in e.errors():
        name = str(err["loc"][0])
        label = LABELS.get(name, name)
        hint = HINTS.get(err["type"], err["msg"])
        messages.append(f"{label}{hint}(收到 {err['input']!r})")
    return messages


def check_form(raw: dict[str, Any]) -> tuple[TicketForm | None, list[str]]:
    try:
        return TicketForm(**raw), []
    except ValidationError as e:
        return None, to_messages(e)


if __name__ == "__main__":
    submissions = json.loads(INBOX.read_text(encoding="utf-8"))
    passed: list[TicketForm] = []
    for raw in submissions:
        form, messages = check_form(raw)
        if form is None:
            print(f"拦下 {raw['id']}: " + ";".join(messages))
        else:
            passed.append(form)
            print(f"通过 {form!r}")
    print(f"一共 {len(submissions)} 条,通过 {len(passed)} 条")
```

<div class="line-notes">

- `HERE = Path(__file__).resolve().parent` Day 37 的老写法,脚本所在的 part01 目录,从哪里运行都能找到数据文件。
- `INBOX = HERE / "data" / "form_submissions.json"` 刚建的 5 份表单。
- `LABELS = {"id": "工单号", "title": "标题", "amount": "金额", "status": "状态"}` 字段名到中文标签的对照,和前端表单上每个输入框的 label 一样。
- `HINTS = {` 错误类型代号到中文提示的对照。按 type 翻译,不按英文 msg 翻译,原因第二步说过。
- `"float_type": "要填数字",` 金额收到 None 时是 float_type,收到中文是 float_parsing,两种都提示「要填数字」。
- `class TicketForm(BaseModel):` 和第一步一样的模型。
- `def to_messages(e: ValidationError) -> list[str]:` 把一个 ValidationError 变成几句中文。
- `name = str(err["loc"][0])` loc 是元组,取第一个元素就是字段名。元素可能是字符串也可能是整数(列表下标),外面套个 str 统一成字符串,检查器也就不会抱怨。
- `label = LABELS.get(name, name)` Day 24 字典的 get:有对照就用中文,没有就原样用字段名。
- `hint = HINTS.get(err["type"], err["msg"])` 没翻译过的错误类型,退回英文 msg,至少不会什么都不显示。
- `messages.append(f"{label}{hint}(收到 {err['input']!r})")` 拼成「金额要填数字(收到 '八十九')」这样一句。
- `def check_form(raw: dict[str, Any]) -> tuple[TicketForm | None, list[str]]:` 返回一个二元组:成功时是 (模型对象, 空列表),失败时是 (None, 错误提示列表)。调用方不用写 try,和 zod 的 `safeParse` 返回 `{ success, data, error }` 是一个思路。
- `return TicketForm(**raw), []` 校验通过,第二个位置给空列表。
- `return None, to_messages(e)` 校验失败。
- `form, messages = check_form(raw)` Day 22 的元组解包。
- `if form is None:` Day 46 的收窄,下面的 else 里 form 就是 TicketForm。
- `print(f"拦下 {raw['id']}: " + ";".join(messages))` 多条提示用分号连起来。注意这里打印的 id 用的是原始字典里的值,没通过校验的数据只能从 raw 里取。
- `print(f"通过 {form!r}")` `!r` 打印 repr,能看到金额已经变成 float。

</div>

```bash
uv run basedpyright part01/ticket_form.py
uv run python part01/ticket_form.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
通过 TicketForm(id='T-1006', title='发票重开', amount=66.0, status='open')
拦下 T-1007: 金额要填数字(收到 '八十九')
拦下 1008: 工单号要填文字(收到 1008);状态只能是 open 或 closed(收到 'pending')
通过 TicketForm(id='T-1009', title='', amount=30.0, status='open')
通过 TicketForm(id='T-1010', title='多扣了一个月', amount=-99.0, status='open')
一共 5 条,通过 3 条
```

T-1006 的金额 `"66"` 被转成 66.0 收下了;T-1007 的「八十九」被拦;1008 两处错一次报完。

可是看第四、五条:**标题是空字符串的 T-1009、金额是 -99 的 T-1010 都通过了。** 这不是 pydantic 的毛病,是模型只写了类型:空字符串也是 str,-99 也是 float,类型上挑不出错。Day 50 的 `__post_init__` 里有「标题不能空」「金额不能负」这两条业务规则,今天的模型还没写。明天的 `Field` 和 `field_validator` 就是专门干这个的。

| 今天的零件 | 在 ticket_form.py 里是哪一段 |
| --- | --- |
| 开头 表单数字是字符串 | `form_submissions.json` 里的 `"amount": "66"` |
| 第一步 `BaseModel` 和字段 | `class TicketForm(BaseModel)` 四个字段 |
| 第一步 Literal 运行时也查 | `status: Status`,1008 的 pending 被拦 |
| 第二步 `ValidationError`、`e.errors()` | `to_messages` 里的 for 循环 |
| 第二步 按 type 翻译 | `HINTS` 字典 |
| 第三步 宽松模式 | `"66"` 变 66.0;`1008` 不变字符串 |
| zod 的 safeParse 思路 | `check_form` 返回 (对象或 None, 提示列表) |

## 动手练习

### 练习 1:客户表单

Day 50 练习 2 把客户写成了 dataclass,还专门写了 parse_plan 守套餐。现在用 pydantic 写一个 `CustomerForm`:id、name 必填;plan 只能是 basic、pro、team,默认 basic;email 可以没有(`str | None`,默认 None)。新建 `part01/ex51_customer.py`,用下面四份 JSON 各试一次,先猜哪几份能过、拦下的各有几处错:

1. `{"id": "C-001", "name": "李雷", "plan": "pro", "email": "lilei@example.com"}`
2. `{"id": "C-002", "name": "韩梅梅"}`
3. `{"id": "C-003", "name": "王芳", "plan": "enterprise", "email": 123}`
4. `{"id": "C-004", "plan": "team", "email": null}`

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex51_customer.py
import json
from typing import Literal

from pydantic import BaseModel, ValidationError

Plan = Literal["basic", "pro", "team"]


class CustomerForm(BaseModel):
    id: str
    name: str
    plan: Plan = "basic"
    email: str | None = None


bodies = [
    '{"id": "C-001", "name": "李雷", "plan": "pro", "email": "lilei@example.com"}',
    '{"id": "C-002", "name": "韩梅梅"}',
    '{"id": "C-003", "name": "王芳", "plan": "enterprise", "email": 123}',
    '{"id": "C-004", "plan": "team", "email": null}',
]
for body in bodies:
    try:
        print("通过", repr(CustomerForm(**json.loads(body))))
    except ValidationError as e:
        print(f"拦下 {e.error_count()} 处:", [(err["loc"][0], err["type"]) for err in e.errors()])
```

<div class="line-notes">

- `Plan = Literal["basic", "pro", "team"]` 和 Day 50 一样的类型别名。
- `plan: Plan = "basic"` Day 50 要配一个 parse_plan 加 `__post_init__` 才能在运行时守住,这里一行搞定。
- `email: str | None = None` 允许 None,默认 None。JSON 里的 `null` 经过 `json.loads` 就是 None。
- `print("通过", repr(CustomerForm(**json.loads(body))))` 解析 JSON、拆字典、校验,一行里从里往外读。
- `print(f"拦下 {e.error_count()} 处:", [(err["loc"][0], err["type"]) for err in e.errors()])` Day 23 的列表推导式,把每条错误压成 (字段, 类型) 二元组。

</div>

```bash
uv run basedpyright part01/ex51_customer.py
uv run python part01/ex51_customer.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
通过 CustomerForm(id='C-001', name='李雷', plan='pro', email='lilei@example.com')
通过 CustomerForm(id='C-002', name='韩梅梅', plan='basic', email=None)
拦下 2 处: [('plan', 'literal_error'), ('email', 'string_type')]
拦下 1 处: [('name', 'missing')]
```

第 3 份两处错一起报;第 4 份只错在 name 缺失,`"email": null` 是合法的,因为字段写了 `str | None`。对比 Day 50 练习 2:那边为了把 `raw["plan"]` 传进去,先得手动调 parse_plan,不然检查器画红线;这边 JSON 来的值是 Any,直接交给模型,运行时它自己查。

</details>

### 练习 2:严格模式

第三步说过,宽松模式会把 `"66"` 转成数字。有些场景你不想要这种「好心」,比如两个后端服务之间约定好了金额就是 JSON 数字,对方传了字符串,说明对方代码有 bug,应该立刻报出来。新建 `part01/ex51_strict.py`,给模型加上 `model_config = ConfigDict(strict=True)`,分别喂 `66`、`"66"`、`true` 三种金额,看哪些能过。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex51_strict.py
import json

from pydantic import BaseModel, ConfigDict, ValidationError


class StrictForm(BaseModel):
    model_config = ConfigDict(strict=True)

    id: str
    amount: float


for body in ['{"id": "T-1", "amount": 66}', '{"id": "T-1", "amount": "66"}', '{"id": "T-1", "amount": true}']:
    try:
        print("通过", repr(StrictForm(**json.loads(body))))
    except ValidationError as e:
        err = e.errors()[0]
        print("拦下", body, err["type"], err["msg"])
```

<div class="line-notes">

- `from pydantic import BaseModel, ConfigDict, ValidationError` ConfigDict 用来写模型的配置。
- `model_config = ConfigDict(strict=True)` 在类里写一个名字固定叫 `model_config` 的类属性,pydantic 会读它。它没有类型标注,所以 pydantic 不会把它当成字段。strict=True 就是严格模式。
- `amount: float` 严格模式下,float 字段只收数字。
- `print("通过", repr(StrictForm(**json.loads(body))))` 三份数据挨个试。

</div>

```bash
uv run basedpyright part01/ex51_strict.py
uv run python part01/ex51_strict.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
通过 StrictForm(id='T-1', amount=66.0)
拦下 {"id": "T-1", "amount": "66"} float_type Input should be a valid number
拦下 {"id": "T-1", "amount": true} float_type Input should be a valid number
```

整数 66 还是收了(存成 66.0),因为整数变小数不丢信息,严格模式也认;字符串 `"66"` 和 `true` 都被拦。宽松还是严格,看数据是谁给的:网页表单、用户输入、大模型输出,格式天生不稳,用默认的宽松模式;自己团队约定好格式的服务之间,可以用严格模式早点发现对方的 bug。这门课里绝大多数场景用宽松模式。

</details>

### 练习 3:让赋值也校验

「检查器和运行时」那一节里,`t.amount = "abc"` 运行时改成功了。新建 `part01/ex51_assign.py`,给 TicketForm 加上 `model_config = ConfigDict(validate_assignment=True)`,然后把金额先改成字符串 `"70.5"`、再改成「七十」,看看各发生什么。要赋的两个值从一段 JSON 里读出来(这样检查器把它们当 Any,不会画红线,我们看的是运行时)。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex51_assign.py
import json

from pydantic import BaseModel, ConfigDict, ValidationError


class TicketForm(BaseModel):
    model_config = ConfigDict(validate_assignment=True)

    id: str
    title: str
    amount: float


t = TicketForm(id="T-1006", title="发票重开", amount=66)
edits = json.loads('{"first": "70.5", "second": "七十"}')
t.amount = edits["first"]
print(repr(t), type(t.amount))
try:
    t.amount = edits["second"]
except ValidationError as e:
    print("没改成:", e.errors()[0]["loc"], e.errors()[0]["type"])
print(repr(t))
```

<div class="line-notes">

- `model_config = ConfigDict(validate_assignment=True)` 打开「赋值也校验」。
- `edits = json.loads('{"first": "70.5", "second": "七十"}')` 两个待赋的值,都是字符串。
- `t.amount = edits["first"]` 赋值时也走一遍宽松模式的转换。
- `print(repr(t), type(t.amount))` 看存进去的是什么类型。
- `t.amount = edits["second"]` 转不了的值,赋值这一行就会抛 ValidationError。
- `print(repr(t))` 赋值失败后,对象还是原来的样子吗?

</div>

```bash
uv run basedpyright part01/ex51_assign.py
uv run python part01/ex51_assign.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
TicketForm(id='T-1006', title='发票重开', amount=70.5) <class 'float'>
没改成: ('amount',) float_parsing
TicketForm(id='T-1006', title='发票重开', amount=70.5)
```

`"70.5"` 被转成 float 70.5 存了进去;「七十」在赋值那一刻就被拦,对象保持 70.5 不变。这就是 Day 50 末尾说的「pydantic 有现成的开关」。Day 43 用 property 的 setter 手写过同样的效果,一个字段写一对方法;这里一行配置管所有字段。

</details>

### 练习 4:给前端返回字段错误

前端表单最想要的错误格式通常是「字段名 → 一句提示」的对象,拿到后直接显示在对应输入框下面。新建 `part01/ex51_field_errors.py`,写一个 `errors_by_field(e: ValidationError) -> dict[str, str]`(同一个字段有多条错误时只留第一条),复用 ticket_form.py 的 HINTS 和 TicketForm,把 `{"id": 1008, "amount": "八十九", "status": "pending"}` 的错误转成 `{"ok": false, "errors": {...}}` 的 JSON 打印出来。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex51_field_errors.py
import json

from pydantic import ValidationError

from ticket_form import HINTS, TicketForm


def errors_by_field(e: ValidationError) -> dict[str, str]:
    result: dict[str, str] = {}
    for err in e.errors():
        name = str(err["loc"][0])
        if name not in result:
            result[name] = HINTS.get(err["type"], err["msg"])
    return result


raw = json.loads('{"id": 1008, "amount": "八十九", "status": "pending"}')
try:
    TicketForm(**raw)
except ValidationError as e:
    body = {"ok": False, "errors": errors_by_field(e)}
    print(json.dumps(body, ensure_ascii=False, indent=2))
```

<div class="line-notes">

- `from ticket_form import HINTS, TicketForm` 直接用正文写好的模型和中文提示表。ticket_form.py 的演示代码在 main guard 里,import 时不会执行(Day 32)。
- `result: dict[str, str] = {}` 空字典要标类型,不然检查器推不出值是什么类型(Day 46)。
- `if name not in result:` 同一个字段只留第一条。今天的模型每个字段最多一条错,明天加了约束以后会出现一个字段多条的情况。
- `body = {"ok": False, "errors": errors_by_field(e)}` 拼一个接口响应的样子。
- `print(json.dumps(body, ensure_ascii=False, indent=2))` Day 39:ensure_ascii=False 让中文原样输出,indent=2 缩进两格。

</div>

```bash
uv run basedpyright part01/ex51_field_errors.py
uv run python part01/ex51_field_errors.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
{
  "ok": false,
  "errors": {
    "id": "要填文字",
    "title": "必填",
    "amount": "要填数字",
    "status": "只能是 open 或 closed"
  }
}
```

Python 的 False 经过 json.dumps 变成了 JSON 的 `false`。这个格式前端拿到以后 `errors.amount` 就能直接显示在金额输入框下面。到第一部分后半学 FastAPI 时,接口收到坏数据会自动返回 422 和一份类似的错误列表,背后就是 pydantic 的 `e.errors()`。

</details>

验收标准:`uv run basedpyright part01/ticket_form.py part01/ex51_customer.py part01/ex51_field_errors.py` 输出 `0 errors`;`uv run python part01/ticket_form.py` 的输出和正文一致(5 条通过 3 条);不看文章能写出一个带 Literal 字段的 BaseModel,并用 try/except 接住 ValidationError、逐条打印 loc 和 type;能说出 `"66"`、`"八十九"`、`1006`(给 str 字段)、`None` 在宽松模式下各会怎样;能说清为什么 T-1009 和 T-1010 今天还能通过。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| pydantic | 第三方的数据校验库,用类型标注定义数据结构,造对象时检查并转换数据;FastAPI、OpenAI SDK 和大多数 Agent 框架都建在它上面。当前大版本是 2 |
| `BaseModel` | pydantic 的模型基类,继承它的类在造对象时会按字段标注校验 |
| 模型(model) | 这里指继承 BaseModel 的类,和大模型的「模型」不是一回事 |
| `ValidationError` | 校验失败时抛的异常,一次包含所有出错的字段 |
| `e.errors()` | 把 ValidationError 拆成列表,每条是字典,常用键 `loc`(位置)、`type`(错误代号)、`msg`(英文说明)、`input`(收到的值) |
| `loc` | 错误位置,元组形式,如 `('amount',)`;嵌套数据会是 `('tags', 2)` 这样的路径,≈ zod 的 `path` |
| 解析(parse) | 不只检查类型,还把能转的值转成目标类型,如 `"66"` → 66.0 |
| 宽松模式(lax mode) | pydantic 默认模式,做不丢信息的转换:数字字符串转数字、`"on"`/`"yes"` 转 True;不把数字转成字符串 |
| 严格模式(strict mode) | `ConfigDict(strict=True)`,类型不对就拦,不做转换(整数给 float 字段除外) |
| `model_config` / `ConfigDict` | 写在模型类里的配置,如 `strict`、`validate_assignment` |
| zod | 前端常用的 TS 校验库,`z.object({...}).parse(data)`,和 pydantic 思路相同 |

## 常见误区

**以为 pydantic 和 dataclass 一样能按位置传参。** 写 `TicketForm("T-1004", "扣费两次", 89.5)`,实测运行时报 `TypeError: BaseModel.__init__() takes 1 positional argument but 4 were given`,检查器也提前报了 `Expected 0 positional arguments`。pydantic 模型只收关键字参数,字段多的时候这样反而不容易传错位。

**看着检查器的红线以为运行时会报错。** `TicketForm(id="T-1006", title="发票重开", amount="66")` 检查器报 `"Literal['66']" is not assignable to "float"`,运行时却正常转成了 66.0。代码里自己写的值按类型写对;外来数据(Any)交给 pydantic 在运行时处理,两边各管各的。

**以为字符串字段会接受数字。** 工单号传了整数 1006,实测 `Input should be a valid string [type=string_type, input_value=1006, input_type=int]`。pydantic 2 不会把数字转成字符串,前端提交工单号时要确保是字符串。pydantic 1 的老教程里这会被自动转换,别被误导。

**以为造好以后改字段也会被校验。** 实测 `t.amount = "abc"` 运行时改成功了,字段里存着一个字符串。默认只在构造时校验;需要的话加 `ConfigDict(validate_assignment=True)`(练习 3)。

**用 `except Exception` 把校验错误和别的错误混在一起接。** 这样一来,代码里的真 bug(比如拼错变量名引起的 NameError)也会被当成「用户填错了」显示在表单上。只接 `ValidationError`,别的让它炸出来。

**跟着 pydantic 1 的教程写。** `.dict()`、`.parse_obj()`、`@validator`、类里写 `class Config:`,这些都是 v1 写法,在 v2 里要么改名要么已不推荐。看教程先看发布时间(2023 年 6 月 v2 发布之前的基本都是 v1),再看 import 的东西对不对得上今天的写法。

**`uv add pydantic` 之后直接 `python 脚本.py`。** 没用 `uv run`,用的就不是项目的虚拟环境,会报 `ModuleNotFoundError: No module named 'pydantic'`(Day 11 讲过 .venv)。在项目里一律 `uv run python ...`。

## 学习资料

### 文档与文章

- [pydantic 文档 · Models](https://docs.pydantic.dev/latest/concepts/models/):官方对 BaseModel 的完整说明,英文。今天对应开头的 Basic model usage 和 Validating data 两节,后面的嵌套模型、泛型模型先跳过。
- [pydantic 文档 · Validation Errors](https://docs.pydantic.dev/latest/errors/validation_errors/):所有错误类型代号的列表,每个都有一段触发它的小例子。今天的 HINTS 字典要加新的翻译时,来这里查 type 的名字。
- [pydantic 文档 · Conversion Table](https://docs.pydantic.dev/latest/concepts/conversion_table/):第三步那张「收不收」的完整版,按字段类型和输入类型列出宽松、严格模式下各自的行为。
- [pydantic 文档 · Strict Mode](https://docs.pydantic.dev/latest/concepts/strict_mode/):练习 2 的严格模式,包括只给单个字段开严格的写法。
- [zod 文档 · Basic usage](https://zod.dev/basics):如果你用过 zod,对照着看 parse、safeParse、ZodError 的 issues,和今天的 ValidationError 一一对应。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1JKmeY9ED2&autoplay=0&high_quality=1" title="[Python] Pydantic 让数据结构与验证融为一体" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>隔壁的程序员老王 · [Python] Pydantic 让数据结构与验证融为一体 · 约 10 分钟,2024 年。从「为什么要校验」讲到 BaseModel 和报错,和今天第一、二步的顺序差不多,适合敲完代码后看一遍巩固。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1wm421G7Go&autoplay=0&high_quality=1" title="Pydantic教程：解决Python的最大问题 - pixegami" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>黑纹白斑马(搬运,原作者 pixegami) · Pydantic 教程:解决 Python 的最大问题 · 约 11 分钟,带中文字幕。前半段讲「动态类型让外来数据没人把关」,正好是今天开头那个 TypeError 的问题;后半段的 Field 和 validator 留到明天看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/502XOB0u8OY" title="Why Python Needs Pydantic for Real Applications" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>ArjanCodes · Why Python Needs Pydantic for Real Applications · 英文。讲 pydantic 在真实项目里守在哪些边界上(API 输入、配置、外部服务返回),听完对「数据从外部来就用 pydantic」这条规则会更有体感。</figcaption>
</figure>

### 书籍

- *Robust Python*,Patrick Viafore 著,O'Reilly,2021,英文(我没查到中译本)。第 14 章「Runtime Checking With pydantic」专讲今天的主题,里面有一节「Validation Versus Parsing」,把「只检查」和「检查并转换」的区别讲得很清楚,正好对应第一步的解析。全书讲 Python 类型标注怎么让代码更可靠,Day 45 到今天的内容都能在里面找到更深的讨论。

### 开源项目与代码

- [openai/openai-python 的 `src/openai/types/chat/chat_completion.py`](https://github.com/openai/openai-python/blob/main/src/openai/types/chat/chat_completion.py):OpenAI 官方 Python SDK 里「一次聊天调用的返回结果」的定义。打开能看到 `class Choice(BaseModel):`,里面有 `finish_reason: Literal["stop", "length", "tool_calls", ...]`,和今天的 `status: Status` 是一个写法;文件后面还有 `class ChatCompletion(BaseModel):`。这里的 BaseModel 是 SDK 在 `_models.py` 里对 pydantic BaseModel 做的一层包装。Day 120 你第一次调大模型 API 时拿到的返回值,就是这个类的对象。

## 自测

1. 下面的代码运行后打印什么?

```python
from pydantic import BaseModel

class Order(BaseModel):
    id: str
    total: float

print(repr(Order(id="O-1", total="99")))
```

<details><summary>答案</summary>

打印 `Order(id='O-1', total=99.0)`。字符串 `"99"` 在宽松模式下被解析成 float 99.0。检查器会在 `total="99"` 下面画红线,但运行时能通过。

</details>

2. `Order(id=1, total="九十九")` 会报几处错?分别是什么 type?

<details><summary>答案</summary>

2 处,而且一次全报出来:id 是 `string_type`(整数不会被转成字符串),total 是 `float_parsing`(中文解析不成数字)。

</details>

3. 想把 ValidationError 翻译成中文提示,为什么按 `err["type"]` 翻而不是按 `err["msg"]` 翻?

<details><summary>答案</summary>

type 是 pydantic 文档里列出的固定代号(如 `missing`、`float_parsing`),给程序判断用;msg 是给人看的英文说明,措辞可能随版本调整,拿它做字典的键容易某天突然对不上。

</details>

4. 今天 ticket_form.py 里 T-1009(标题为空)和 T-1010(金额 -99)为什么能通过?

<details><summary>答案</summary>

模型只声明了类型:空字符串是合法的 str,-99 是合法的 float。「标题不能空」「金额要为正」是业务规则,要用明天的 `Field(min_length=1)`、`Field(gt=0)` 或自定义校验器来写。

</details>

5. 面试题:你在 Agent 项目里让大模型返回 JSON,为什么拿到之后还要用 pydantic 校验一遍?不校验会出什么问题?

<details><summary>答案</summary>

模型的输出是外部数据,格式不保证:字段可能缺失、数字可能带引号、枚举值可能大小写不对或者编一个不存在的值。不校验的话,这些错会在下游某一行代码里以奇怪的形式炸出来(比如今天开头那种 `'<' not supported between instances of 'str' and 'int'`),离出错的源头很远,很难查。用 pydantic 在入口校验,一是能转的自动转好,下游拿到的类型是确定的;二是失败时有结构化的错误列表,能精确到字段,可以把错误发回给模型让它改正后重试(第二部分 Day 150 的做法);三是模型定义本身还能导出 JSON Schema 告诉模型应该输出什么格式。

</details>

## 明天预告

[Day 52 · pydantic(二):Field、validator、model_dump 和 model_validate](/blog/agent-zero/day-052-pydantic-2/)。今天的门卫只认类型,空标题和负数金额都放了进来。明天用 `Field(gt=0)`、`Field(min_length=1)` 给字段加约束,用 `field_validator` 写「标题不能全是空格」这种自定义规则,再用 `model_validate` 和 `model_dump` 把模型和字典、JSON 来回转,做出 pydantic 版的工单记事本。
