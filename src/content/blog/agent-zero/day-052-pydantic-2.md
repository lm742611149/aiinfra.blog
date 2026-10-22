---
title: 'Day 52 · pydantic(二):Field、validator、model_dump 和 model_validate'
description: '昨天的模型只认类型,空标题和负数金额都放了进来。今天用 Field 给字段加约束(金额必须为正、标题 1 到 30 个字、工单号要像 T-1004),用 field_validator 写「标题不能全是空格」这种自定义规则,再用 model_validate 和 model_dump 在字典、JSON 和模型之间来回转,做出 pydantic 版的工单记事本 ticket_pd.py。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'pydantic', 'agent-zero']
series: 'agent-zero'
day: 52
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 51](/blog/agent-zero/day-051-pydantic-1/) 装上了 pydantic,写了第一个 `BaseModel`。它在造对象时按类型标注检查并转换数据:表单里的 `"66"` 被转成 66.0,「八十九」被拦下;所有出错的字段收进一个 `ValidationError`,用 `e.errors()` 能逐条拿到 `loc`、`type`、`msg`、`input`,我们按 type 把它们翻成了中文提示。

那一课的 `ticket_form.py` 留了个尾巴:5 份表单通过了 3 份,其中 T-1009 标题是空字符串,T-1010 金额是 -99。类型上它们都没错,错在业务规则。Day 50 的 dataclass 用 `__post_init__` 手写了这两条规则,今天看 pydantic 怎么写,顺便把模型和字典、JSON 之间的来回转换学了,工单才能存盘、读盘。

## 今天要解决的问题

学完今天,你应该能:

1. 用 `Field(...)` 给字段加约束:数字的 `gt`/`ge`/`lt`/`le`,字符串和列表的 `min_length`/`max_length`,字符串的 `pattern`;知道 `Field` 的 `default`、`default_factory`、`description` 各管什么。
2. 用 `@field_validator` 写 Field 表达不了的自定义规则,知道它在什么时候运行、怎么报错、为什么一定要 return。
3. 用 `model_validate`/`model_validate_json` 从字典和 JSON 文本造模型,用 `model_dump`/`model_dump_json` 导出去。
4. 写出 `part01/ticket_pd.py`:pydantic 版 Ticket,金额必须为正,能读写 notebook.json,basedpyright 0 errors。

预计用时:2.5 小时。前置:[Day 51](/blog/agent-zero/day-051-pydantic-1/) 的 BaseModel 和 ValidationError、[Day 50](/blog/agent-zero/day-050-dataclass/) 的小写 `field` 和 `ticket_dc.py`、[Day 43](/blog/agent-zero/day-043-classes-3/) 的 `@property` 和 `@classmethod`、[Day 39](/blog/agent-zero/day-039-json/) 的 json 模块。

学法:先对照文章逐行敲一遍(不要复制粘贴)并跑通;第二天合上文章,把 `ticket_pd.py` 里的 Ticket 模型(连同两个校验器)默写出来;再做动手练习,做不出来再展开参考答案,看完关掉自己重写一遍。

命令都在项目根目录 `agent-zero-lab` 里跑,新文件放进 `part01/`。pydantic 昨天已经装好,今天不装新东西、不调 API,花费 0 元。检查结果和报错里的长路径我缩短成了文件名。

正文里有一个正则表达式 `^T-\d{4}$`,用来检查工单号格式。正则你在 [Day 1](/blog/agent-zero/day-001-salary-honest/) 用 JS 写过,Python 里的写法一样:`^` 是开头,`T-` 原样匹配,`\d{4}` 是正好 4 个数字,`$` 是结尾。今天只用这一个,看懂就行。

## 第一步:Field,给字段加约束

[Day 50](/blog/agent-zero/day-050-dataclass/) 的末尾提过,pydantic 有一个大写的 `Field`,和 dataclass 的小写 `field` 同样写在 `=` 右边,但多了一大块本事:约束。新建 `part01/pd_field.py`:

```python
# agent-zero-lab/part01/pd_field.py
import json

from pydantic import BaseModel, Field, ValidationError

from ticket_types import Status


class TicketForm(BaseModel):
    id: str = Field(pattern=r"^T-\d{4}$")
    title: str = Field(min_length=1, max_length=30)
    amount: float = Field(gt=0, le=100000)
    status: Status = "open"
    tags: list[str] = Field(default_factory=list, max_length=5)


bodies = [
    '{"id": "T-1006", "title": "发票重开", "amount": "66"}',
    '{"id": "T-1009", "title": "", "amount": "30"}',
    '{"id": "T-1010", "title": "多扣了一个月", "amount": "-99"}',
    '{"id": "t1011", "title": "退款", "amount": 0, "tags": ["a", "b", "c", "d", "e", "f"]}',
    '{"id": "T-1012", "title": "  ", "amount": 50}',
]
for body in bodies:
    try:
        print("通过", repr(TicketForm(**json.loads(body))))
    except ValidationError as e:
        for err in e.errors():
            print("拦下", err["loc"], err["type"], err["msg"])
```

<div class="line-notes">

- `from pydantic import BaseModel, Field, ValidationError` 大写的 Field 来自 pydantic,不是 dataclasses。
- `id: str = Field(pattern=r"^T-\d{4}$")` pattern 是正则约束,字符串必须匹配。前面的 `r` 表示原始字符串(raw string),让 `\d` 原样传给正则,不被 Python 当成转义。Field 里没写默认值,所以 id 仍然**必填**。
- `title: str = Field(min_length=1, max_length=30)` 字符串长度 1 到 30。长度按字符数算,「多扣了一个月」是 6。
- `amount: float = Field(gt=0, le=100000)` gt 是 greater than(大于),le 是 less or equal(小于等于)。合起来就是 0 < 金额 ≤ 100000,0 本身不行。
- `status: Status = "open"` 不需要约束的字段,照旧直接写默认值。
- `tags: list[str] = Field(default_factory=list, max_length=5)` `default_factory=list` 和 Day 50 小写 field 的同名参数一样,每个对象一个新的空列表;`max_length` 用在列表上管的是元素个数。
- `'{"id": "T-1009", "title": "", "amount": "30"}',` 昨天漏网的空标题。
- `'{"id": "T-1010", "title": "多扣了一个月", "amount": "-99"}',` 昨天漏网的负数金额。
- `'{"id": "t1011", "title": "退款", "amount": 0, "tags": ["a", "b", "c", "d", "e", "f"]}',` 工单号小写又少了横杠、金额正好是 0、标签 6 个。
- `'{"id": "T-1012", "title": "  ", "amount": 50}',` 标题是两个空格。先猜一下能不能过。
- `for err in e.errors():` 一份数据可能有好几条错,全打出来。

</div>

```bash
uv run basedpyright part01/pd_field.py
uv run python part01/pd_field.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
通过 TicketForm(id='T-1006', title='发票重开', amount=66.0, status='open', tags=[])
拦下 ('title',) string_too_short String should have at least 1 character
拦下 ('amount',) greater_than Input should be greater than 0
拦下 ('id',) string_pattern_mismatch String should match pattern '^T-\d{4}$'
拦下 ('amount',) greater_than Input should be greater than 0
拦下 ('tags',) too_long List should have at most 5 items after validation, not 6
通过 TicketForm(id='T-1012', title='  ', amount=50.0, status='open', tags=[])
```

昨天的两条漏网之鱼都抓住了:空标题是 `string_too_short`,-99 是 `greater_than`。注意 -99 是字符串 `"-99"`,pydantic 先按宽松模式把它转成 -99.0,**再**拿去和 0 比较,所以约束检查的永远是转换后的值。第四份三处错一起报;金额 0 不满足「大于 0」,被拦。

最后一份通过了:标题 `"  "` 是两个空格,长度 2,满足 `min_length=1`。长度约束只数字符,不管字符是不是空白。这条规则 Field 写不出来,要靠第二步的自定义校验器。

常用的约束就这几个,记住哪类字段能用哪些:

| 约束 | 用在 | 意思 | 今天的例子 |
| --- | --- | --- | --- |
| `gt` / `ge` | 数字 | 大于 / 大于等于 | `amount: float = Field(gt=0)` |
| `lt` / `le` | 数字 | 小于 / 小于等于 | `Field(le=100000)` |
| `min_length` / `max_length` | 字符串、列表 | 字符数或元素个数的下限 / 上限 | `title`、`tags` |
| `pattern` | 字符串 | 必须匹配这个正则 | `id` |

记 g 和 l 的办法:g 是 greater,l 是 less,带 e 的多一个 equal(等于)。zod 里对应的是 `z.number().gt(0)`、`z.string().min(1).max(30)`、`z.string().regex(...)`,一个是链式调用,一个是关键字参数,意思一样。

### Field 的另外两个常用参数:default 和 description

约束之外,Field 还常用来写默认值和说明。到第二部分让大模型返回结构化数据时,每个字段都会这么写。新建 `part01/pd_desc.py`:

```python
# agent-zero-lab/part01/pd_desc.py
from pydantic import BaseModel, Field, ValidationError


class TicketInfo(BaseModel):
    summary: str = Field(description="用一句中文概括客户诉求")
    customer_email: str | None = Field(default=None, description="客户邮箱,工单里没有就填 null")


print(repr(TicketInfo(summary="扣费两次要退款")))
try:
    TicketInfo.model_validate({"customer_email": "a@b.com"})
except ValidationError as e:
    print(e.errors()[0]["loc"], e.errors()[0]["type"])
for name, info in TicketInfo.model_fields.items():
    print(name, info.is_required(), info.description)
```

<div class="line-notes">

- `summary: str = Field(description="用一句中文概括客户诉求")` 只有 description,没有默认值,所以**仍然必填**。description 不参与校验,它是写给读代码的人,以及以后写给大模型看的说明。
- `customer_email: str | None = Field(default=None, description=` `default=None` 让这个字段可以不传。类型里的 `str | None` 说「值可以是 None」,`default=None` 说「不传就当 None」,两件事要一起写。
- `TicketInfo.model_validate({"customer_email": "a@b.com"})` model_validate 第三步细讲,现在当成 `TicketInfo(**字典)` 看。故意不给 summary。
- `for name, info in TicketInfo.model_fields.items():` 每个 pydantic 模型都有 `model_fields`,一个「字段名 → 字段信息」的字典(Day 24 的 `.items()`)。
- `print(name, info.is_required(), info.description)` 字段信息里能查到是否必填、description 是什么。

</div>

```bash
uv run basedpyright part01/pd_desc.py
uv run python part01/pd_desc.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
TicketInfo(summary='扣费两次要退款', customer_email=None)
('summary',) missing
summary True 用一句中文概括客户诉求
customer_email False 客户邮箱,工单里没有就填 null
```

只写了 description 的 summary 是必填的,不传就是 `missing`;写了 `default=None` 的 customer_email 不是必填。这些 description 现在看起来只是注释,到 [Day 149](/blog/agent-zero/day-149-structured-3/) 它们会被导出成 JSON Schema 发给大模型,模型就是读着这些说明决定每个字段填什么的。

这里有个我踩过的坑。旧教程里常见 `Field(None, description=...)` 这种把默认值写在第一个位置的写法,运行时完全没问题,可 basedpyright 认不出位置参数是默认值。我第一版就是这么写的,实测检查结果:

```text
pd_desc.py:10:12 - error: Argument missing for parameter "customer_email" (reportCallIssue)
1 error, 0 warnings, 0 notes
```

检查器以为 customer_email 是必填的,在 `TicketInfo(summary=...)` 那一行画了红线。改成 `default=None` 关键字写法就好了。养成习惯:Field 的默认值一律写 `default=`。

## 第二步:field_validator,写自己的规则

「标题不能全是空格」「金额最多两位小数」,这种规则 Field 的参数里没有,要自己写函数。新建 `part01/pd_validator.py`:

```python
# agent-zero-lab/part01/pd_validator.py
import json

from pydantic import BaseModel, Field, ValidationError, field_validator


class TicketForm(BaseModel):
    id: str = Field(pattern=r"^T-\d{4}$")
    title: str = Field(min_length=1, max_length=30)
    amount: float = Field(gt=0, le=100000)

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, value: str) -> str:
        value = value.strip()
        if value == "":
            raise ValueError("标题不能全是空格")
        return value

    @field_validator("amount")
    @classmethod
    def at_most_two_decimals(cls, value: float) -> float:
        if round(value, 2) != value:
            raise ValueError(f"金额最多两位小数,收到 {value}")
        return value


bodies = [
    '{"id": "T-1012", "title": "  扣费两次 ", "amount": 89.5}',
    '{"id": "T-1013", "title": "  ", "amount": 50}',
    '{"id": "T-1014", "title": "退款", "amount": "19.999"}',
    '{"id": "T-1015", "title": "", "amount": -1}',
]
for body in bodies:
    try:
        print("通过", repr(TicketForm(**json.loads(body))))
    except ValidationError as e:
        for err in e.errors():
            print("拦下", err["loc"], err["type"], err["msg"])
```

<div class="line-notes">

- `from pydantic import BaseModel, Field, ValidationError, field_validator` field_validator 是个装饰器,小写,下划线连接。
- `@field_validator("title")` 括号里写这个校验器管哪个字段,名字是字符串,要和字段名一字不差。
- `@classmethod` 下面这个方法是类方法(Day 43),第一个参数是 cls 不是 self。为什么是类方法:校验器运行时对象还没造出来,没有 self 可用。两个装饰器的顺序固定是 field_validator 在上、classmethod 在下。
- `def title_not_blank(cls, value: str) -> str:` 方法名随便起,起个能看出规则的名字。value 是这个字段的值,而且是**已经过了类型检查和 Field 约束**的值,所以能放心标成 str。
- `value = value.strip()` 去掉首尾空白。
- `raise ValueError("标题不能全是空格")` 规则不满足就抛 ValueError。pydantic 会接住它,包装成 ValidationError 里的一条,type 是 `value_error`。别在这里抛 ValidationError,也别抛自己的 TicketError,pydantic 只认 ValueError(和 AssertionError)。
- `return value` 返回值就是最终存进字段的值。这里返回的是去掉空白的标题,所以校验器也能顺手「清洗」数据。**一定要 return**,忘了的后果下面实测。
- `@field_validator("amount")` 第二个校验器,管金额。
- `if round(value, 2) != value:` `round(19.999, 2)` 是 20.0,和原值不等,说明小数超过两位。89.5 四舍五入到两位还是 89.5,相等,放行。
- `'{"id": "T-1012", "title": "  扣费两次 ", "amount": 89.5}',` 标题前后有空格,看存进去的样子。
- `'{"id": "T-1015", "title": "", "amount": -1}',` 空标题和负数金额,看校验器还会不会运行。

</div>

```bash
uv run basedpyright part01/pd_validator.py
uv run python part01/pd_validator.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
通过 TicketForm(id='T-1012', title='扣费两次', amount=89.5)
拦下 ('title',) value_error Value error, 标题不能全是空格
拦下 ('amount',) value_error Value error, 金额最多两位小数,收到 19.999
拦下 ('title',) string_too_short String should have at least 1 character
拦下 ('amount',) greater_than Input should be greater than 0
```

第一行:标题存成了 `'扣费两次'`,前后空格没了,这是校验器 return 的值。第二、三行是两个校验器各自拦下的,msg 前面被 pydantic 加了一个 `Value error, ` 前缀,后面是你写的中文。

最后一份最有意思:空标题报的是 `string_too_short`,-1 报的是 `greater_than`,都是 Field 约束的错,**你写的校验器根本没运行**。一个字段的校验是按顺序走的,前一关没过,后面就不走了:

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="一个字段的校验顺序:收到的值先过类型检查和宽松转换,再过 Field 约束,最后才进 field_validator;任何一关失败都直接变成 ValidationError 里的一条,后面的关卡不再执行;全部通过后,validator 的返回值存进字段">
<rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="40" width="110" height="56" rx="4" fill="none" stroke="var(--rule)"/>
<text x="75" y="64" text-anchor="middle" fill="var(--ink)">收到的值</text>
<text x="75" y="84" text-anchor="middle" fill="var(--ink-faint)" font-size="11">"-99"</text>
<rect x="155" y="40" width="130" height="56" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="220" y="64" text-anchor="middle" fill="var(--ink)">① 类型</text>
<text x="220" y="84" text-anchor="middle" fill="var(--ink-soft)" font-size="11">转成 -99.0</text>
<rect x="310" y="40" width="130" height="56" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="375" y="64" text-anchor="middle" fill="var(--ink)">② Field 约束</text>
<text x="375" y="84" text-anchor="middle" fill="var(--ink-soft)" font-size="11">gt=0</text>
<rect x="465" y="40" width="155" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="542" y="64" text-anchor="middle" fill="var(--ink)">③ field_validator</text>
<text x="542" y="84" text-anchor="middle" fill="var(--ink-soft)" font-size="11">你写的规则</text>
<line x1="130" y1="68" x2="155" y2="68" stroke="var(--rule)"/>
<line x1="285" y1="68" x2="310" y2="68" stroke="var(--rule)"/>
<line x1="440" y1="68" x2="465" y2="68" stroke="var(--rule)"/>
<line x1="220" y1="96" x2="220" y2="140" stroke="var(--rule)" stroke-dasharray="4 3"/>
<line x1="375" y1="96" x2="375" y2="140" stroke="var(--rule)" stroke-dasharray="4 3"/>
<line x1="542" y1="96" x2="542" y2="140" stroke="var(--rule)" stroke-dasharray="4 3"/>
<rect x="155" y="140" width="465" height="44" rx="4" fill="none" stroke="var(--rule)"/>
<text x="387" y="160" text-anchor="middle" fill="var(--ink)">任何一关失败 → ValidationError 里的一条,后面不再走</text>
<text x="387" y="176" text-anchor="middle" fill="var(--ink-faint)" font-size="11">-99.0 卡在 ②,报 greater_than,③ 不运行</text>
<text x="20" y="200" fill="var(--ink-soft)" font-size="11">三关都过:③ 的返回值存进字段(比如去掉空格的标题)</text>
</g>
</svg>
<figcaption>同一个字段的三道关卡按顺序走。所以校验器里拿到的 value 一定已经是正确的类型、满足了 Field 约束,写规则时不用再操心「它会不会是字符串」。不同字段之间互不影响,一份数据的所有字段都会各自走完。</figcaption>
</figure>

这个顺序带来一个好处:校验器里的 value 类型是确定的。`at_most_two_decimals` 里直接 `round(value, 2)`,不用担心 value 是字符串 `"19.999"`,因为第一关已经把它转成了 float。

### 两个校验器专属的坑

**忘了 return。** 新建 `part01/pd_forgot_return.py`,把校验器最后的 `return value` 删掉:

```python
# agent-zero-lab/part01/pd_forgot_return.py
from pydantic import BaseModel, field_validator


class TicketForm(BaseModel):
    title: str

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, value: str) -> str:
        if value.strip() == "":
            raise ValueError("标题不能全是空格")


t = TicketForm(title="扣费两次")
print(repr(t))
```

<div class="line-notes">

- `def title_not_blank(cls, value: str) -> str:` 标注了返回 str,函数体里却没有 return。
- `raise ValueError("标题不能全是空格")` 只有不合格时才有动作,合格时函数走到底,Python 函数走到底默认返回 None(Day 28)。
- `t = TicketForm(title="扣费两次")` 一个完全合格的标题。

</div>

```bash
uv run basedpyright part01/pd_forgot_return.py
uv run python part01/pd_forgot_return.py
```

实测输出:

```text
pd_forgot_return.py:10:45 - error: Function with declared return type "str" must return value on all code paths
    "None" is not assignable to "str" (reportReturnType)
1 error, 0 warnings, 0 notes
TicketForm(title=None)
```

运行时没有任何报错,合格的标题却变成了 None。pydantic 把校验器的返回值当成字段的最终值,你返回了 None,它就存 None,连「title 是 str」都不再检查。好在检查器抓住了:标注了 `-> str` 却有一条路径没 return。这又是一个「返回类型一定要标」的理由(Day 45)。

**字段名写错。** 校验器括号里的名字是字符串,拼错了不会有红线。新建 `part01/pd_typo_field.py`:

```python
# agent-zero-lab/part01/pd_typo_field.py
from pydantic import BaseModel, field_validator


class TicketForm(BaseModel):
    title: str

    @field_validator("titel")
    @classmethod
    def title_not_blank(cls, value: str) -> str:
        return value.strip()


print(repr(TicketForm(title=" 退款 ")))
```

<div class="line-notes">

- `@field_validator("titel")` title 拼成了 titel。
- `print(repr(TicketForm(title=" 退款 ")))` 看能不能造出来。

</div>

```bash
uv run basedpyright part01/pd_typo_field.py
uv run python part01/pd_typo_field.py
```

实测输出(运行只留最后几行):

```text
0 errors, 0 warnings, 0 notes
pydantic.errors.PydanticUserError: Decorators defined with incorrect fields: __main__.TicketForm:140457066962048.title_not_blank (use check_fields=False if you're inheriting from the model and intended this)

For further information visit https://errors.pydantic.dev/2.14/u/decorator-missing-field
```

检查器不管,pydantic 在**定义类的那一刻**就报错了:`Decorators defined with incorrect fields`,装饰器指向了不存在的字段,后面跟着方法名 `title_not_blank`,一看就知道是哪个校验器。中间那串数字是对象的内存地址,每次运行都不一样。这比 Day 50 拼错 `__post_init__`「悄悄不运行」要好得多:错误在第一时间、以大声的方式暴露出来。

## 第三步:model_validate 和 model_dump,进门和出门

模型要能从 JSON 文件里读进来,也要能写回去。前两天我们一直用 `TicketForm(**字典)` 造对象,pydantic 有正式的进门方法;出门方法则对应 Day 50 的 `asdict`。新建 `part01/pd_dump.py`:

```python
# agent-zero-lab/part01/pd_dump.py
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from ticket_types import Status


class Ticket(BaseModel):
    id: str
    title: str
    amount: float = Field(gt=0)
    status: Status = "open"
    tags: list[str] = Field(default_factory=list)


t = Ticket(id="T-1004", title="扣费两次", amount=89.5, tags=["退款"])
d = t.model_dump()
print(type(d).__name__, d)
print(t.model_dump(exclude={"tags"}))
s = t.model_dump_json()
print(type(s).__name__, s)

raw: dict[str, Any] = {"id": "T-1004", "title": "扣费两次", "amount": "89.5", "tags": ["退款"]}
print(Ticket.model_validate(raw) == t)
print(Ticket.model_validate_json(s) == t)

for bad in [["T-1004", "扣费两次", 89.5], '{"id": "T-1005", "title": "超额", "amount": 120,}']:
    try:
        if isinstance(bad, str):
            Ticket.model_validate_json(bad)
        else:
            Ticket.model_validate(bad)
    except ValidationError as e:
        err = e.errors()[0]
        print("拦下", err["type"], err["msg"])
```

<div class="line-notes">

- `d = t.model_dump()` 模型 → 普通字典。≈ Day 50 的 `asdict(t)`。
- `print(type(d).__name__, d)` `type(d).__name__` 取类型的名字,这里是 dict。
- `print(t.model_dump(exclude={"tags"}))` exclude 传一个字段名集合(Day 25),导出时去掉这些字段。反过来还有 include,只导出指定的字段。
- `s = t.model_dump_json()` 模型 → JSON **字符串**,一步到位,不用再 json.dumps。
- `raw: dict[str, Any] = {"id": "T-1004", "title": "扣费两次", "amount": "89.5", "tags": ["退款"]}` 一个从外面来的字典,金额是字符串。
- `print(Ticket.model_validate(raw) == t)` model_validate 是**类方法**,用类名调用:字典 → 模型,边造边校验。和 `Ticket(**raw)` 效果一样,但它接收的是一整个对象而不是关键字参数。
- `print(Ticket.model_validate_json(s) == t)` JSON 字符串 → 模型,解析 JSON 和校验一步完成,不用先 json.loads。
- `for bad in [["T-1004", "扣费两次", 89.5], '{"id": "T-1005", "title": "超额", "amount": 120,}']:` 两种坏输入:一个列表(不是字典),一段末尾多了逗号的坏 JSON。
- `if isinstance(bad, str):` Day 46 的 isinstance 收窄,字符串走 model_validate_json,别的走 model_validate。

</div>

```bash
uv run basedpyright part01/pd_dump.py
uv run python part01/pd_dump.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
dict {'id': 'T-1004', 'title': '扣费两次', 'amount': 89.5, 'status': 'open', 'tags': ['退款']}
{'id': 'T-1004', 'title': '扣费两次', 'amount': 89.5, 'status': 'open'}
str {"id":"T-1004","title":"扣费两次","amount":89.5,"status":"open","tags":["退款"]}
True
True
拦下 model_type Input should be a valid dictionary or instance of Ticket
拦下 json_invalid Invalid JSON: trailing comma at line 1 column 51
```

四个方法两两成对,名字很规整:

| 方向 | 和字典打交道 | 和 JSON 字符串打交道 |
| --- | --- | --- |
| 进门(造模型,会校验) | `Ticket.model_validate(d)` | `Ticket.model_validate_json(s)` |
| 出门(导出,不校验) | `t.model_dump()` | `t.model_dump_json()` |

进门的两个用类名调用(类方法),出门的两个用对象调用。名字都以 `model_` 开头,这是 pydantic 2 的约定:模型自带的方法全带这个前缀,不会和你自己起的字段名撞上。如果你见到 `.dict()`、`.json()`、`.parse_obj()`,那是 pydantic 1 的旧名字,分别对应 `model_dump()`、`model_dump_json()`、`model_validate()`。

几个细节:

- `model_dump_json()` 输出的中文是原样的,没有变成 `扣` 这种转义,也没有空格和缩进,最紧凑。Day 39 的 `json.dumps` 默认会转义中文,要加 `ensure_ascii=False`;这里不用。
- 坏 JSON 的报错 `trailing comma at line 1 column 51` 精确到了第几个字符,比 Day 39 里 `json.loads` 的 JSONDecodeError 更友好,而且同样包在 ValidationError 里,一个 except 就能接住「JSON 坏了」和「字段不对」两类问题。
- 列表传给 model_validate 得到的是清楚的 `model_type` 错误。如果用 `Ticket(**列表)`,`**` 只能拆字典,会直接在拆包时报一个和校验无关的 TypeError。**外来数据一律用 model_validate**,不用 `**`,这是今天开始的新习惯。

zod 那边,`schema.parse(JSON.parse(text))` 对应 `model_validate_json(text)`;出门在 TS 里本来就是普通对象,直接 `JSON.stringify` 就行,所以 zod 没有 model_dump 这一类方法。Python 的模型对象不是字典,要导出就得 dump。

## 把零件拼起来:ticket_pd.py

现在把 Day 50 的 `ticket_dc.py` 改写成 pydantic 版。还是新建文件,不改旧的,理由和 Day 50 一样:旧文件被好几个脚本 import 着。新建 `part01/ticket_pd.py`:

```python
# agent-zero-lab/part01/ticket_pd.py
import json
from pathlib import Path

from pydantic import BaseModel, Field, ValidationError, field_validator

from ticket_types import Status

HERE = Path(__file__).resolve().parent
BOOK = HERE / "data" / "notebook.json"
OUT = HERE / "data" / "tickets_pd.json"


class Ticket(BaseModel):
    id: str = Field(pattern=r"^T-\d{4}$")
    title: str = Field(min_length=1, max_length=30)
    amount: float = Field(gt=0, le=100000)
    status: Status = "open"
    tags: list[str] = Field(default_factory=list)

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, value: str) -> str:
        value = value.strip()
        if value == "":
            raise ValueError("标题不能全是空格")
        return value

    @field_validator("amount")
    @classmethod
    def at_most_two_decimals(cls, value: float) -> float:
        if round(value, 2) != value:
            raise ValueError(f"金额最多两位小数,收到 {value}")
        return value

    @property
    def is_closed(self) -> bool:
        return self.status == "closed"

    def close(self) -> None:
        self.status = "closed"

    def summary(self) -> str:
        return f"[{self.status}] {self.id} {self.title} ¥{self.amount}"

    def __str__(self) -> str:
        return self.summary()


def load(path: Path) -> list[Ticket]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return [Ticket.model_validate(d) for d in data]


def save(path: Path, tickets: list[Ticket]) -> None:
    data = [t.model_dump() for t in tickets]
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    tickets = load(BOOK)
    tickets[2].tags.append("退款")
    for t in tickets:
        print(t)

    save(OUT, tickets)
    again = load(OUT)
    print("存进去再读回来,一样吗?", again == tickets)

    try:
        Ticket.model_validate({"id": "T-1006", "title": "退款", "amount": -50, "status": "pending"})
    except ValidationError as e:
        print(f"没通过,{e.error_count()} 处:")
        for err in e.errors():
            print(" ", err["loc"][0], err["msg"])
```

<div class="line-notes">

- `from ticket_types import Status` 状态的唯一定义还是 Day 47 那个。不再需要 parse_status,Literal 由 pydantic 在运行时检查。也不需要 TicketError 了,出错统一是 ValidationError。
- `OUT = HERE / "data" / "tickets_pd.json"` 存到新文件,不覆盖记事本。
- `class Ticket(BaseModel):` 这次就叫 Ticket,和 ticket_dc.Ticket 在不同模块里,不冲突。
- `id: str = Field(pattern=r"^T-\d{4}$")` notebook.json 里的四个工单号都是这个格式。
- `amount: float = Field(gt=0, le=100000)` 大纲里说的「金额必须为正」就是 gt=0 这几个字。
- `tags: list[str] = Field(default_factory=list)` 旧数据没有 tags,读进来就是空列表。
- `def title_not_blank(cls, value: str) -> str:` 第二步原样搬来。
- `def at_most_two_decimals(cls, value: float) -> float:` 第二步原样搬来。
- `@property` pydantic 模型里照样能写 property 和普通方法,BaseModel 只把带类型标注的类属性当字段。is_closed、close、summary、`__str__` 都是从 ticket_dc.py 原样搬过来的,别的代码用这些名字。
- `self.status = "closed"` 默认不校验赋值(Day 51),这里写的是 Status 里的字面量,检查器会帮你看着。
- `def __str__(self) -> str:` 自己写的 `__str__` 会覆盖 pydantic 那个「字段=值」的打印格式,`repr()` 还是 pydantic 的。
- `return [Ticket.model_validate(d) for d in data]` 读盘用 model_validate,每张工单都过一遍全部规则。和 Day 50 比,from_dict 这个类方法整个不用写了。
- `data = [t.model_dump() for t in tickets]` 存盘用 model_dump。这里没有直接用 model_dump_json,因为要的是一整个列表加缩进,先转成字典列表再交给 json.dumps 最简单。
- `tickets[2].tags.append("退款")` 给 T-1004 加标签,只改内存。
- `print("存进去再读回来,一样吗?", again == tickets)` 模型按字段比较相等。
- `Ticket.model_validate({"id": "T-1006", "title": "退款", "amount": -50, "status": "pending"})` 金额为负、状态不对,两处错。
- `print(" ", err["loc"][0], err["msg"])` 缩进两格,逐条打印。

</div>

```bash
uv run basedpyright part01/ticket_pd.py
uv run python part01/ticket_pd.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
[closed] T-1001 发票抬头开错了 ¥199.0
[open] T-1002 升级套餐 年付 ¥399.0
[open] T-1004 扣费两次 ¥89.5
[open] T-1005 API 调用超额 ¥120.0
存进去再读回来,一样吗? True
没通过,2 处:
  amount Input should be greater than 0
  status Input should be 'open' or 'closed'
```

和 Day 50 的输出比,有一处不一样:金额显示成了 `¥199.0`,dataclass 版是 `¥199`。notebook.json 里存的是整数 199,dataclass 不转换,原样存着 int;pydantic 按标注把它转成了 float 199.0。看一眼新文件:

```bash
head -9 part01/data/tickets_pd.json
```

实测输出:

```text
[
  {
    "id": "T-1001",
    "title": "发票抬头开错了",
    "amount": 199.0,
    "status": "closed",
    "tags": []
  },
  {
```

存回去的也是 `199.0`。这对程序没有影响,199.0 读回来还是 199.0,`again == tickets` 是 True。但它提醒你一件事:pydantic 的模型里,**字段值一定是标注的那个类型**,这正是我们要的。至于金额到底该用 float 还是别的类型(钱用浮点数会有 Day 12 那个 0.1+0.2 的问题),作品篇做计费调查时会换成 Decimal,现在先不管。

| 今天的零件 | 在 ticket_pd.py 里是哪一段 |
| --- | --- |
| 第一步 `Field(gt=0, le=...)` | `amount` 字段,金额必须为正 |
| 第一步 `min_length`/`max_length`/`pattern` | `title`、`id` 字段 |
| 第一步 `Field(default_factory=list)` | `tags` 字段 |
| 第二步 `@field_validator` + `@classmethod` | `title_not_blank`、`at_most_two_decimals` |
| 第二步 return 清洗后的值 | 标题去掉首尾空白再存 |
| 第三步 `model_validate` | `load()` |
| 第三步 `model_dump` | `save()` |
| Day 50 property、方法、`__str__` | `is_closed`、`close`、`summary`、`__str__` |

和 Day 50 的 ticket_dc.py 对比:`__post_init__` 里三道手写的 if、`from_dict` 类方法、对 TicketError 和 parse_status 的依赖都没了,换成了字段上的几个 Field 参数和两个校验器;规则反而多了(工单号格式、标题长度、金额上限、两位小数)。

## 动手练习

### 练习 1:客户模型带邮箱清洗

给客户写一个 pydantic 模型 `Customer`:id 必须像 `C-001`(C、横杠、3 位数字);name 1 到 20 个字;plan 只能是 basic、pro、team,默认 basic;email 可以没有,有的话要先去掉首尾空格、转成小写,而且必须恰好有一个 @、不能在开头或结尾。新建 `part01/ex52_customer.py`,用 model_validate_json 校验下面三段 JSON,通过的打印 model_dump():

1. `{"id": "C-001", "name": "李雷", "plan": "pro", "email": " LiLei@Example.com "}`
2. `{"id": "C-002", "name": "韩梅梅"}`
3. `{"id": "C-3", "name": "王芳", "email": "wangfang.example.com"}`

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex52_customer.py
from typing import Literal

from pydantic import BaseModel, Field, ValidationError, field_validator

Plan = Literal["basic", "pro", "team"]


class Customer(BaseModel):
    id: str = Field(pattern=r"^C-\d{3}$")
    name: str = Field(min_length=1, max_length=20)
    plan: Plan = "basic"
    email: str | None = None

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip().lower()
        if value.count("@") != 1 or value.startswith("@") or value.endswith("@"):
            raise ValueError(f"邮箱格式不对: {value!r}")
        return value


bodies = [
    '{"id": "C-001", "name": "李雷", "plan": "pro", "email": " LiLei@Example.com "}',
    '{"id": "C-002", "name": "韩梅梅"}',
    '{"id": "C-3", "name": "王芳", "email": "wangfang.example.com"}',
]
for body in bodies:
    try:
        c = Customer.model_validate_json(body)
        print("通过", c.model_dump())
    except ValidationError as e:
        print("拦下", [(err["loc"][0], err["msg"]) for err in e.errors()])
```

<div class="line-notes">

- `id: str = Field(pattern=r"^C-\d{3}$")` C、横杠、正好 3 位数字。
- `email: str | None = None` 不需要约束的可选字段,直接写 `= None` 就行。
- `def normalize_email(cls, value: str | None) -> str | None:` 字段类型是 `str | None`,value 也可能是 None,标注要写全,不然检查器会在 `value.strip()` 那里提醒你 None 没有 strip。
- `if value is None:` 没留邮箱就原样返回 None。
- `value = value.strip().lower()` 先清洗:去空格、转小写。
- `if value.count("@") != 1 or value.startswith("@") or value.endswith("@"):` 一个很粗的格式检查。真实项目里邮箱用 pydantic 的 `EmailStr` 类型(要另装 email-validator 包),今天不引入。
- `c = Customer.model_validate_json(body)` JSON 文本直接进门,所以这个文件连 `import json` 都不需要。
- `print("通过", c.model_dump())` 出门看清洗后的值。

</div>

```bash
uv run basedpyright part01/ex52_customer.py
uv run python part01/ex52_customer.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
通过 {'id': 'C-001', 'name': '李雷', 'plan': 'pro', 'email': 'lilei@example.com'}
通过 {'id': 'C-002', 'name': '韩梅梅', 'plan': 'basic', 'email': None}
拦下 [('id', "String should match pattern '^C-\\d{3}$'"), ('email', "Value error, 邮箱格式不对: 'wangfang.example.com'")]
```

第一份的邮箱被清洗成了 `lilei@example.com`。校验器不只是拦,还能把「差不多对」的数据整理成统一格式,这在处理用户输入和模型输出时特别有用。第三份 msg 里显示的是 `\\d`,那是 Python 打印字符串列表时的转义写法,实际的正则还是 `\d`。

</details>

### 练习 2:退款申请存成 JSON Lines

[Day 39](/blog/agent-zero/day-039-json/) 练习里见过 JSON Lines(一行一个 JSON,文件后缀 .jsonl)。写一个 `RefundRequest` 模型:ticket_id 像 T-1004;amount 大于 0、不超过 5000;reason 至少 4 个字。新建 `part01/ex52_refunds.py`:造两个合格的申请,用 model_dump_json 一行一个写进 `part01/data/refunds.jsonl`,再手写追加一行坏数据 `{"ticket_id": "T-1010", "amount": 9999, "reason": "全退"}`;然后逐行用 model_validate_json 读回来,坏行报出行号和原因,最后算合格申请的退款合计。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex52_refunds.py
from pathlib import Path

from pydantic import BaseModel, Field, ValidationError

HERE = Path(__file__).resolve().parent
LOG = HERE / "data" / "refunds.jsonl"


class RefundRequest(BaseModel):
    ticket_id: str = Field(pattern=r"^T-\d{4}$")
    amount: float = Field(gt=0, le=5000)
    reason: str = Field(min_length=4)


requests = [
    RefundRequest(ticket_id="T-1004", amount=89.5, reason="同一笔扣了两次"),
    RefundRequest(ticket_id="T-1005", amount=20, reason="超额部分有争议"),
]
with LOG.open("w", encoding="utf-8") as f:
    for r in requests:
        f.write(r.model_dump_json() + "\n")
    f.write('{"ticket_id": "T-1010", "amount": 9999, "reason": "全退"}\n')

good: list[RefundRequest] = []
for n, line in enumerate(LOG.read_text(encoding="utf-8").splitlines(), start=1):
    try:
        good.append(RefundRequest.model_validate_json(line))
    except ValidationError as e:
        print(f"第 {n} 行不合格:", [(err["loc"][0], err["msg"]) for err in e.errors()])
print("读回", len(good), "条,和写进去的一样吗?", good == requests)
print("合计退款", sum(r.amount for r in good))
```

<div class="line-notes">

- `reason: str = Field(min_length=4)` 理由至少 4 个字,防止「退款」「全退」这种什么都没说的理由。
- `RefundRequest(ticket_id="T-1004", amount=89.5, reason="同一笔扣了两次"),` 代码里自己造的对象也会过一遍校验。
- `with LOG.open("w", encoding="utf-8") as f:` Day 38 的 with 写文件,"w" 每次运行都重写。
- `f.write(r.model_dump_json() + "\n")` model_dump_json 输出不带换行的紧凑 JSON,正好一行一条。
- `f.write('{"ticket_id": "T-1010", "amount": 9999, "reason": "全退"}\n')` 模拟别处写进来的一条坏数据:金额超上限,理由只有 2 个字。
- `for n, line in enumerate(LOG.read_text(encoding="utf-8").splitlines(), start=1):` splitlines 按行切开;enumerate 加上行号,start=1 让行号从 1 开始,和编辑器里的一致。
- `good.append(RefundRequest.model_validate_json(line))` 每行单独进门,一行坏了不影响别的行。
- `print("读回", len(good), "条,和写进去的一样吗?", good == requests)` 两个列表逐个比较。
- `print("合计退款", sum(r.amount for r in good))` 括号里是生成器表达式,和列表推导式一样的写法,只是外面是圆括号,直接交给 sum。

</div>

```bash
uv run basedpyright part01/ex52_refunds.py
uv run python part01/ex52_refunds.py
cat part01/data/refunds.jsonl
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
第 3 行不合格: [('amount', 'Input should be less than or equal to 5000'), ('reason', 'String should have at least 4 characters')]
读回 2 条,和写进去的一样吗? True
合计退款 109.5
{"ticket_id":"T-1004","amount":89.5,"reason":"同一笔扣了两次"}
{"ticket_id":"T-1005","amount":20.0,"reason":"超额部分有争议"}
{"ticket_id": "T-1010", "amount": 9999, "reason": "全退"}
```

前两行是 model_dump_json 写的,紧凑、中文原样、20 变成了 20.0;第三行是手写的,带空格。读的时候两种格式都认。第一部分后面几天和第二部分的 Agent 日志,都会用这种「一行一个模型」的方式存。

</details>

### 练习 3(选做):跨字段的规则

field_validator 一次只看一个字段。「退款金额不能超过实付金额」要同时看两个字段,怎么办?查 pydantic 文档的 Validators 页,用 `@model_validator(mode="after")` 写一个 `Refund` 模型(ticket_id、paid、refund,后两个都要大于 0),新建 `part01/ex52_cross.py`,试三组:实付 89.5 退 89.5;实付 120 退 200;实付 66 退 -1。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex52_cross.py
from typing import Self

from pydantic import BaseModel, Field, ValidationError, model_validator


class Refund(BaseModel):
    ticket_id: str
    paid: float = Field(gt=0)
    refund: float = Field(gt=0)

    @model_validator(mode="after")
    def refund_not_more_than_paid(self) -> Self:
        if self.refund > self.paid:
            raise ValueError(f"退款 {self.refund} 不能超过实付 {self.paid}")
        return self


print(repr(Refund(ticket_id="T-1004", paid=89.5, refund=89.5)))
for raw in [{"ticket_id": "T-1005", "paid": 120, "refund": 200}, {"ticket_id": "T-1006", "paid": 66, "refund": -1}]:
    try:
        Refund.model_validate(raw)
    except ValidationError as e:
        for err in e.errors():
            print("拦下", err["loc"], err["msg"])
```

<div class="line-notes">

- `from typing import Self` Self 表示「这个类自己」,Python 3.11 起在 typing 里。
- `@model_validator(mode="after")` 模型级校验器。after 的意思是在所有字段都校验完、对象造好之后运行。
- `def refund_not_more_than_paid(self) -> Self:` 注意这里是普通方法,有 self,不加 @classmethod:after 模式下对象已经造好了,能用 self 访问所有字段。
- `if self.refund > self.paid:` 同时看两个字段。
- `return self` 和 field_validator 一样必须返回,返回的是对象本身。
- `{"ticket_id": "T-1006", "paid": 66, "refund": -1}` refund 本身就不合格,看模型级校验器还跑不跑。

</div>

```bash
uv run basedpyright part01/ex52_cross.py
uv run python part01/ex52_cross.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
Refund(ticket_id='T-1004', paid=89.5, refund=89.5)
拦下 () Value error, 退款 200.0 不能超过实付 120.0
拦下 ('refund',) Input should be greater than 0
```

第二组的 loc 是空元组 `()`,因为这条错不属于某一个字段,属于整个模型。Day 51 的 `to_messages` 里写的 `err["loc"][0]` 碰到它会报 IndexError,用模型级校验器时要处理这种情况。第三组 refund 先在字段这一关就失败了,模型级校验器没有运行,和第二步那张图的道理一样:前面有错,after 校验器就不跑。

</details>

### 练习 4:用今天的模型重跑昨天的表单

昨天 `ticket_form.py` 校验 5 份表单通过了 3 份。新建 `part01/ex52_recheck.py`,用 ticket_pd.py 的 Ticket 和 model_validate 重新校验 `form_submissions.json`(文件路径直接 import ticket_form 的 INBOX),每份打印通过或拦下原因(字段名加 type)。先猜结果。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex52_recheck.py
import json

from pydantic import ValidationError

from ticket_form import INBOX
from ticket_pd import Ticket

for raw in json.loads(INBOX.read_text(encoding="utf-8")):
    try:
        t = Ticket.model_validate(raw)
        print("通过", t)
    except ValidationError as e:
        reasons = [f"{err['loc'][0]}({err['type']})" for err in e.errors()]
        print("拦下", raw["id"], "、".join(reasons))
```

<div class="line-notes">

- `from ticket_form import INBOX` 昨天定义的数据文件路径,不重复写一遍。
- `from ticket_pd import Ticket` 今天带约束和校验器的模型。
- `t = Ticket.model_validate(raw)` 用正式的进门方法。
- `print("通过", t)` 直接 print 走自己写的 `__str__`。
- `reasons = [f"{err['loc'][0]}({err['type']})" for err in e.errors()]` 拼成「amount(greater_than)」这样的短说明。

</div>

```bash
uv run basedpyright part01/ex52_recheck.py
uv run python part01/ex52_recheck.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
通过 [open] T-1006 发票重开 ¥66.0
拦下 T-1007 amount(float_parsing)
拦下 1008 id(string_type)、amount(greater_than)、status(literal_error)
拦下 T-1009 title(string_too_short)
拦下 T-1010 amount(greater_than)
```

5 份只过了 1 份。昨天漏网的 T-1009、T-1010 现在都被拦下;1008 还多出一条 `amount(greater_than)`,它的金额是 `"0"`,昨天只查类型时 0 是合法的 float,今天要求大于 0。同一份数据,规则越完整,能进门的越少,这就是门卫该干的事。

</details>

验收标准:`uv run basedpyright part01/ticket_pd.py part01/ex52_customer.py part01/ex52_refunds.py part01/ex52_recheck.py` 输出 `0 errors`;`uv run python part01/ticket_pd.py` 的输出和正文一致;不看文章能写出带 `Field(gt=0)`、`Field(pattern=...)` 和一个 field_validator 的模型;能说出 model_validate、model_validate_json、model_dump、model_dump_json 各是从什么到什么;能解释为什么 `{"title": ""}` 报的是 `string_too_short` 而不是你校验器里的中文。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| `Field(...)` | pydantic 的字段配置,大写,写在字段 `=` 右边;能设默认值、约束和说明。和 dataclasses 的小写 `field` 不是一个东西 |
| 约束(constraint) | 类型之外的限制,如 `gt=0`、`max_length=30`、`pattern=...`,写在 Field 里 |
| `gt` / `ge` / `lt` / `le` | 大于 / 大于等于 / 小于 / 小于等于,用于数字字段 |
| `min_length` / `max_length` | 字符串的字符数或列表的元素个数的下限 / 上限 |
| `pattern` | 字符串必须匹配的正则表达式 |
| `description` | 字段说明,不参与校验;会进入 JSON Schema,第二部分写给大模型看 |
| `@field_validator("字段名")` | 自定义单个字段的校验规则,配 `@classmethod` 使用,抛 ValueError 表示不合格,return 的值存进字段 |
| `@model_validator(mode="after")` | 模型级校验器,所有字段校验完后运行,用来写跨字段的规则 |
| `model_validate` / `model_validate_json` | 类方法,从字典 / JSON 字符串造模型,同时校验 |
| `model_dump` / `model_dump_json` | 把模型导出成字典 / JSON 字符串,可用 `exclude`、`include` 挑字段 |
| `model_fields` | 模型的字段信息字典,能查是否必填、description 等 |
| `PydanticUserError` | 模型本身写错时(如校验器指向不存在的字段)在定义类时抛的错误,和数据错误的 ValidationError 不同 |

## 常见误区

**以为写了 Field 就是可选字段。** `summary: str = Field(description="...")` 仍然是必填的,实测不传报 `missing`。要可选,得在 Field 里写 `default=...` 或 `default_factory=...`。

**把默认值写成 Field 的第一个位置参数。** `Field(None, description=...)` 运行时没问题,但 basedpyright 认不出来,实测报 `Argument missing for parameter "customer_email"`。写成 `Field(default=None, ...)`。

**field_validator 忘了 return。** 实测合格的标题变成了 `TicketForm(title=None)`,运行时一声不吭。返回类型一定要标,检查器会报 `must return value on all code paths`。

**校验器里的字段名拼错。** `@field_validator("titel")` 检查器不报,运行时在定义类时就抛 `PydanticUserError: Decorators defined with incorrect fields`。看到这个错,先对一下装饰器括号里的名字。

**以为自己的校验器一定会运行。** 空字符串先被 `min_length=1` 拦下,报 `string_too_short`,你写的「标题不能全是空格」根本没机会运行。顺序是类型 → Field 约束 → field_validator,前面失败后面就不跑。所以中文提示表里要同时翻译 Field 约束的 type。

**校验器里抛自定义异常。** 在 field_validator 里 `raise TicketError(...)`,pydantic 不会把它包进 ValidationError,而是让它原样炸出去,你在 except ValidationError 那里接不住。校验器里只抛 ValueError。

**外来数据还用 `Model(**data)`。** data 如果不是字典(比如模型输出了一个列表),`**` 在拆包时就报 TypeError,和校验无关。用 `Model.model_validate(data)`,实测得到清楚的 `model_type` 错误。

**跟着 v1 教程用 `.dict()`、`.json()`、`.parse_obj()`、`@validator`。** v2 里对应的是 `model_dump()`、`model_dump_json()`、`model_validate()`、`@field_validator`。旧名字有的还能用但会出弃用警告,有的参数完全不同,别混着写。

## 学习资料

### 文档与文章

- [pydantic 文档 · Fields](https://docs.pydantic.dev/latest/concepts/fields/):Field 的全部参数。今天对应 Default values、Field constraints、description 几节,重点看 Numeric Constraints 和 String Constraints 两张表。
- [pydantic 文档 · Validators](https://docs.pydantic.dev/latest/concepts/validators/):field_validator 和 model_validator 的官方说明。文档里讲了 after、before、wrap、plain 四种模式,今天用的是默认的 after,另外三种先知道名字;Raising validation errors 一节讲校验器里该抛什么异常,Ordering of validators 一节讲同一个字段挂了多个校验器时谁先谁后。
- [pydantic 文档 · Serialization](https://docs.pydantic.dev/latest/concepts/serialization/):model_dump、model_dump_json 的参数,include/exclude 的嵌套写法、`mode="json"` 都在这里。
- [zod 文档 · Defining schemas](https://zod.dev/api):如果你熟悉 zod,对照着看 `.min()`、`.max()`、`.regex()`、`.refine()`,`.refine()` 就是 zod 版的 field_validator。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1hBtzetE6Q&autoplay=0&high_quality=1" title="12-4(2)：Pydantic的Field。Field可以给数据设置校验规则,pydantic的重要概念" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>大小寒学AI · 12-4(2):Pydantic 的 Field · 约 9 分钟,2024 年。专讲 Field 的约束参数,对应第一步;看完可以对照那张约束表自己再试几个。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Ra3g6nE45&autoplay=0&high_quality=1" title="[快速上手FastAPI] Pydantic数据验证快速入门" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>大熊课堂 · [快速上手 FastAPI] Pydantic 数据验证快速入门 · 约 13 分钟,2026 年。从 BaseModel 讲到 Field 和校验器,是为后面 FastAPI 课程打基础的,和这门课第一部分后半的 FastAPI 正好衔接。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/7aBRk_JP-qY" title="Pydantic V2 - Full Course - Learn the BEST Library for Data Validation and Parsing" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Coding Crash Courses · Pydantic V2 - Full Course · 英文,较长。按章节跳着看:Field、Validators、Serialization 三章对应今天的三步;Settings 那一章明天讲 .env 时可以回来看。</figcaption>
</figure>

### 书籍

- *Robust Python*,Patrick Viafore 著,O'Reilly,2021,英文。昨天推荐过的第 14 章「Runtime Checking With pydantic」,今天读里面的 Validators 一节,作者用的是 v1 的 `@validator` 写法,对照今天的 `@field_validator` 看,思路完全一样,只是名字变了。

### 开源项目与代码

- [pydantic/pydantic-ai](https://github.com/pydantic/pydantic-ai):pydantic 团队自己做的 Agent 框架。打开 README 里的示例代码,能看到用 BaseModel 加 `Field(description=...)` 定义 Agent 的输出格式,框架把它变成 schema 交给大模型,模型回来的 JSON 再用 model_validate 校验。这就是今天这些方法在 Agent 里的真实用法,第五部分讲框架时还会回来。

## 自测

1. 下面的模型,`Order.model_validate({"id": "O-1", "total": "0"})` 会怎样?

```python
from pydantic import BaseModel, Field

class Order(BaseModel):
    id: str
    total: float = Field(gt=0)
```

<details><summary>答案</summary>

抛 ValidationError,一处错,type 是 `greater_than`。字符串 `"0"` 先按宽松模式转成 0.0,再检查「大于 0」,不满足。

</details>

2. `name: str = Field(description="客户姓名")` 这个字段是必填还是可选?怎么改成「不传就是 None」?

<details><summary>答案</summary>

必填,Field 里没有默认值。改成 `name: str | None = Field(default=None, description="客户姓名")`,类型和默认值都要改。

</details>

3. field_validator 里要表示「数据不合格」,应该抛什么异常?最后为什么必须 return?

<details><summary>答案</summary>

抛 ValueError,pydantic 会把它包装成 ValidationError 里 type 为 `value_error` 的一条。return 的值就是字段最终存的值,不 return 等于返回 None,字段会被悄悄改成 None。

</details>

4. model_validate、model_validate_json、model_dump、model_dump_json 各是从什么到什么?哪两个会做校验?

<details><summary>答案</summary>

model_validate:字典 → 模型;model_validate_json:JSON 字符串 → 模型;model_dump:模型 → 字典;model_dump_json:模型 → JSON 字符串。进门的两个(validate)会校验,出门的两个(dump)不校验。

</details>

5. 面试题:让大模型抽取工单信息,输出里有个 urgency 字段,要求 1 到 5 的整数。你会怎么在代码里保证它合法?模型给了 7 怎么办?

<details><summary>答案</summary>

用 pydantic 定义输出模型,`urgency: int = Field(ge=1, le=5, description="1 最不紧急,5 最紧急")`,拿到模型输出后用 `model_validate_json` 校验。description 会进 JSON Schema 告诉模型取值范围;ge/le 在我们这边兜底,有些厂商的结构化输出不支持数值约束,所以不能只靠模型。模型给了 7,会得到一条 `less_than_equal` 的 ValidationError,可以把 `e.errors()` 里的 msg(「Input should be less than or equal to 5」)作为反馈发回给模型,让它改正后重试,设一个最多重试次数,超过就报错或转人工。这个重试循环是第二部分 Day 150 的内容。

</details>

## 明天预告

[Day 53 · 环境变量和密钥:.env、python-dotenv、.gitignore](/blog/agent-zero/day-053-env-secrets/)。两天的 pydantic 管的都是「数据从外面进来」。还有一类外来数据你很快就要碰到:配置,尤其是 API key。明天讲怎么用 `.env` 文件和 python-dotenv 读配置、怎么让 key 永远不进代码仓库,最后用今天的 pydantic 写一个会校验、打印时自动打码的配置模型。
