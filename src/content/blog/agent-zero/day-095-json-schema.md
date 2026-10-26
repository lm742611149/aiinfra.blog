---
title: 'Day 95 · JSON Schema:描述数据长什么样的标准'
description: '到今天为止,工具函数的参数合不合格都是靠 Python 里的 if 和白名单在管。今天换一种写法:把「这个字段是什么类型、哪些必填、能取哪些值」写成一份普通的 JSON,交给 jsonschema 库去查。用工单数据从最小的 {"type": "integer"} 一路写到带 enum、pattern、嵌套对象的完整 schema,看懂每一条报错,再看 pydantic 生成的 schema 和它一模一样,最后把它塞进一份工具定义,这就是以后模型「调用你的函数」时读的东西。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'json-schema', 'jsonschema', 'validation', 'agent-zero']
series: 'agent-zero'
day: 95
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 94](/blog/agent-zero/day-094-ledger-project/) 把这几周的零件拼成了 CloudLedger 迷你账单库:`schema.py` 里带约束的两张表、`seed.py` 搬旧数据并把孤儿发票存档、`bill_month` 按月开票且重复运行不会重复开、四个查询、一个命令行入口,再加 27 个测试。回头看那个项目,有一个地方一直是「手写 `if`」:`check_month` 用四个条件判断月份是不是 `YYYY-MM`,练习里的 `PLANS` 元组是套餐白名单,`__main__.py` 里 `args[0].isdigit()` 先确认是数字再 `int(...)`。每个函数的参数长什么样,全靠代码里散落的检查。

今天换一种方式:把「数据应该长什么样」单独写成一份数据,让一个现成的库照着它去检查。这份数据叫 JSON Schema。它不只是为了省几行 `if`,更重要的是它**能被发出去**:发给前端、发给别的服务、发给大模型。第三部分讲工具调用时,模型之所以知道你的函数要哪些参数,读的就是这份东西。

## 今天要解决的问题

学完今天,你应该能做到:

1. 看一份 JSON Schema 说出它允许什么、拒绝什么,并写出描述一张客服工单的 schema:`type`、`properties`、`required`、`enum`、`minimum`/`maximum`、`minLength`、`pattern`、`additionalProperties`、嵌套对象和数组。
2. 用 `jsonschema` 库在本地检查一段数据,区分 `validate()`(遇错就抛)和 `iter_errors()`(一次拿到全部错误),读懂每条错误的位置(`path`)和原因(`validator`、`message`)。
3. 说清 JSON Schema 和 pydantic 的分工:pydantic 的 `model_json_schema()` 生成的就是同一种东西,但 pydantic 会**转换**(`"66"` 变 66.0),jsonschema 只**判断**。
4. 认得出三个容易踩的坑:多余字段默认不拦、`format` 默认不检查、关键字拼错没人报错。

今天两个新概念:**JSON Schema 的关键字**(怎么写)和 **`jsonschema` 库**(怎么查)。预计用时:2.5 小时。花费 ¥0,不调 API。

前置:[Day 39](/blog/agent-zero/day-039-json/) 的 JSON 和 `json.loads`/`json.dumps`;[Day 26](/blog/agent-zero/day-026-nested-data/) 的嵌套字典;[Day 47](/blog/agent-zero/day-047-type-hints-3/) 的 `Literal`(今天的 `enum` 和它是一回事);[Day 52](/blog/agent-zero/day-052-pydantic-2/) 的 `Field(pattern=..., gt=0)`;[Day 80](/blog/agent-zero/day-080-fastapi-2/) 在 `/openapi.json` 里见过的那段 `type`、`properties`、`required`;[Day 94](/blog/agent-zero/day-094-ledger-project/) 的 `ledger.db`(练习 1 要用)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写「一份带 `required`、`enum`、`pattern`、`additionalProperties: false` 的工单 schema」和「用 `iter_errors` 打印全部错误」;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 从前端看:你早就在写 schema 了

前端有三样东西和今天的内容几乎一一对应。

第一样是 HTML 表单属性:`<input type="number" min="1" required>`、`<input pattern="^T-\d{4}$">`。浏览器照着这些属性检查用户输入,不合格就不让提交。JSON Schema 做的是同一件事,只是对象从「表单里的一个输入框」换成「一段 JSON 里的一个字段」,而且规则本身也写成 JSON。

第二样是 TS 的 `interface`。`interface Ticket { id: string; amount: number; status?: "open" | "closed" }` 已经说清了字段名、类型、可选和取值范围。但 TS 类型只活在编译期,编译完就没了,运行时拿到一段不合规的 JSON 它管不着;而且它是 TS 语法,没法发给一个 Python 服务或者一个大模型。JSON Schema 是一份 JSON 数据,能存进文件、能随请求发出去、能被任何语言的库读。

第三样是 `zod` 和 `ajv`。`zod` 是「在 TS 里写校验规则再校验」,`ajv` 是「拿一份 JSON Schema 校验」。Python 这边对应的是 pydantic(像 zod)和今天的 `jsonschema` 库(像 ajv)。第 5 步会看到两者的关系:pydantic 模型能一键导出 JSON Schema。

| 前端 | 今天的对应物 | 说明 |
| --- | --- | --- |
| `<input required min="1" pattern="...">` | `required`、`minimum`、`pattern` | 规则写在数据旁边,由别人替你检查 |
| `interface Ticket { ... }` | `{"type": "object", "properties": {...}}` | 一个是编译期的类型,一个是运行时的数据 |
| `status?: "open" \| "closed"` | 不进 `required`,加 `"enum": ["open", "closed"]` | 可选 + 枚举 |
| `ajv.compile(schema)` 再 `validate(data)` | `Draft202012Validator(schema)` 再 `iter_errors(data)` | 先编译 schema,再反复用 |
| `zod` 的 `z.object({...}).parse(data)` | pydantic 的 `Model.model_validate(data)` | 会转换、会抛异常 |
| `ajv` 的 `validate.errors` | `list(validator.iter_errors(data))` | 一次拿到所有错误 |

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="一份 JSON Schema 在三个地方被同一个校验器使用:HTTP 请求体进入 FastAPI 时、大模型的结构化输出回来时、模型要调用工具时给出的参数;三处都是数据加 schema 进校验器,出来要么通过要么一列错误">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="170" height="54" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="105" y="52" fill="var(--ink)" text-anchor="middle">HTTP 请求体</text>
<text x="105" y="72" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Day 80 的 POST /tickets</text>
<rect x="20" y="118" width="170" height="54" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="105" y="140" fill="var(--ink)" text-anchor="middle">模型的结构化输出</text>
<text x="105" y="160" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Day 148 才真用</text>
<rect x="20" y="206" width="170" height="54" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="105" y="228" fill="var(--ink)" text-anchor="middle">模型要调工具的参数</text>
<text x="105" y="248" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Day 157 才真用</text>
<line x1="190" y1="57" x2="260" y2="135" stroke="var(--rule)"/>
<line x1="190" y1="145" x2="260" y2="145" stroke="var(--rule)"/>
<line x1="190" y1="233" x2="260" y2="155" stroke="var(--rule)"/>
<rect x="260" y="100" width="150" height="90" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="335" y="128" fill="var(--ink)" text-anchor="middle">校验器</text>
<text x="335" y="148" fill="var(--ink-soft)" text-anchor="middle" font-size="11">数据 + schema</text>
<text x="335" y="168" fill="var(--ink-soft)" text-anchor="middle" font-size="11">jsonschema / pydantic</text>
<rect x="250" y="20" width="170" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="335" y="38" fill="var(--ink)" text-anchor="middle">TICKET_SCHEMA</text>
<text x="335" y="55" fill="var(--ink-soft)" text-anchor="middle" font-size="11">一份普通的 JSON</text>
<line x1="335" y1="64" x2="335" y2="100" stroke="var(--rule)" stroke-dasharray="4 3"/>
<line x1="410" y1="130" x2="470" y2="90" stroke="var(--rule)"/>
<line x1="410" y1="160" x2="470" y2="200" stroke="var(--rule)"/>
<rect x="470" y="64" width="150" height="50" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="545" y="85" fill="var(--ink)" text-anchor="middle">通过</text>
<text x="545" y="103" fill="var(--ink-soft)" text-anchor="middle" font-size="11">errors == []</text>
<rect x="470" y="176" width="150" height="50" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="545" y="197" fill="var(--ink)" text-anchor="middle">一列错误</text>
<text x="545" y="215" fill="var(--ink-soft)" text-anchor="middle" font-size="11">path + message</text>
<text x="20" y="286" fill="var(--ink-faint)" font-size="11">同一份 schema,三个入口共用;今天只做中间和右边,左边三个入口以后各自接上。</text>
</g>
</svg>
<figcaption>JSON Schema 的位置。琥珀色是「数据从外面进来」的入口和 schema 本身,蓝色是和模型有关的两个入口(以后的课),中间的校验器是今天要学会用的东西。</figcaption>
</figure>

## 第 1 步:最小的 schema 是一个字典

JSON Schema 就是一段 JSON,在 Python 里就是一个字典。最小的一份只有一个键:`{"type": "integer"}`,意思是「这段数据必须是整数」。检查数据要用 `jsonschema` 库,它不是标准库,先装:

```bash
cd /Users/你/agent-zero-lab
uv add jsonschema
```

2026 年 10 月查到的最新版是 4.26.0([PyPI](https://pypi.org/project/jsonschema/)),装完 `pyproject.toml` 里多一行 `"jsonschema>=4.26.0"`,顺带装进来的 `attrs`、`referencing`、`rpds-py`、`jsonschema-specifications` 是它的依赖,不用管。新建 `part01/schema_hello.py`:

```python
# agent-zero-lab/part01/schema_hello.py
from jsonschema import ValidationError, validate

INT_SCHEMA = {"type": "integer"}

for value in [5, 5.0, "5", True, None]:
    try:
        validate(value, INT_SCHEMA)
        print(f"{value!r:6} 通过")
    except ValidationError as e:
        print(f"{value!r:6} 不通过:{e.message}")
```

<div class="line-notes">

- `from jsonschema import ValidationError, validate` 两个最常用的名字:`validate` 是「拿 schema 查一段数据」的函数,`ValidationError` 是查不过时抛的异常。
- `INT_SCHEMA = {"type": "integer"}` 最小的 schema。`type` 是最基本的关键字,值是七种之一:`string`、`number`、`integer`、`boolean`、`object`、`array`、`null`。注意是 `"integer"` 不是 Python 的 `int`,是 `"string"` 不是 `str`,这是 JSON Schema 自己的叫法,和语言无关。
- `for value in [5, 5.0, "5", True, None]:` 五个值轮流过这道门。
- `validate(value, INT_SCHEMA)` 第一个参数是数据,第二个是 schema。通过就什么都不发生;不通过抛 `ValidationError`。
- `print(f"{value!r:6} 通过")` `!r` 让字符串带引号打印,`:6` 占 6 格对齐(Day 15 的 f-string 格式)。
- `except ValidationError as e:` 接住错误。
- `print(f"{value!r:6} 不通过:{e.message}")` `e.message` 是一句人话,比整个异常对象短得多。

</div>

```bash
uv run python -m part01.schema_hello
```

```text
5      通过
5.0    通过
'5'    不通过:'5' is not of type 'integer'
True   不通过:True is not of type 'integer'
None   不通过:None is not of type 'integer'
```

有两行值得盯一会儿。`5.0` 通过了:JSON Schema 的规矩是「小数部分为零的数就算 integer」,因为 JSON 文本里根本分不出 `5` 和 `5.0` 是两种类型。`True` 没通过:Python 里 `True == 1` 成立,`isinstance(True, int)` 也是 `True`,但 JSON Schema 把布尔和整数分得很清,`jsonschema` 库专门做了处理,不让 `True` 混进 integer。这两条和 Python 的直觉都不一样,记住「按 JSON 的规矩,不按 Python 的规矩」就对了。

## 第 2 步:描述一个对象:`type`、`properties`、`required`

一张工单是一个对象,描述它要三个关键字:`type: "object"` 说它是对象,`properties` 逐个说每个字段的 schema,`required` 列出必填字段。先写一版最松的,新建 `part01/schema_object.py`:

```python
# agent-zero-lab/part01/schema_object.py
import json

from jsonschema import Draft202012Validator

TICKET_V1 = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "title": {"type": "string"},
        "amount": {"type": "number"},
        "status": {"type": "string"},
    },
    "required": ["id", "title", "amount"],
}

validator = Draft202012Validator(TICKET_V1)

samples = [
    {"id": "T-1001", "title": "发票抬头开错了", "amount": 199},
    {"id": "T-1002", "title": "多扣了一个月"},
    {"id": "T-1003", "title": "退款", "amount": "199"},
    {"id": "T-1004", "title": "退款", "amount": 199, "priority": "high"},
    {"id": "T-1005", "title": "退款", "amount": 199, "status": "colsed"},
    ["T-1006", "退款", 199],
]

for data in samples:
    errors = list(validator.iter_errors(data))
    verdict = "通过" if not errors else "不通过:" + ";".join(e.message for e in errors)
    print(json.dumps(data, ensure_ascii=False), "->", verdict)
```

<div class="line-notes">

- `from jsonschema import Draft202012Validator` 这次不用 `validate` 函数,用**校验器类**。名字里的 2020-12 是 JSON Schema 规范的版本号(规范按发布年月命名),写最新这版就行。
- `"type": "object",` 最外层是对象。
- `"properties": {` 每个字段一条 schema。`properties` 的值本身是一个字典,键是字段名,值又是一份 schema,所以 schema 是可以层层嵌套的(Day 26 的嵌套字典)。
- `"amount": {"type": "number"},` 金额用 `number`,整数和小数都收。
- `"required": ["id", "title", "amount"],` 必填的三个。`status` 不在里面,所以可以不给。注意 `required` 是一个**列表**,写在 `properties` 外面,和它平级;新手常把它写进某个字段里。
- `validator = Draft202012Validator(TICKET_V1)` 用 schema 造一个校验器对象,相当于 `ajv.compile(schema)`。schema 只「编译」一次,后面反复查不同的数据。
- `{"id": "T-1002", "title": "多扣了一个月"},` 第二份:缺 `amount`。
- `{"id": "T-1003", "title": "退款", "amount": "199"},` 第三份:金额是字符串 `"199"`。
- `{"id": "T-1004", "title": "退款", "amount": 199, "priority": "high"},` 第四份:多了一个 schema 里没提到的字段 `priority`。
- `{"id": "T-1005", "title": "退款", "amount": 199, "status": "colsed"},` 第五份:`status` 拼错了。
- `["T-1006", "退款", 199],` 第六份:根本不是对象,是个列表。
- `errors = list(validator.iter_errors(data))` `iter_errors` 把这份数据**所有**不合格的地方一个个吐出来(它是个生成器,用 `list()` 收成列表,生成器 Day 99 讲)。没问题就是空列表。
- `verdict = "通过" if not errors else "不通过:" + ";".join(e.message for e in errors)` 空列表在 `if` 里算假(Day 14),所以 `not errors` 就是「没有错误」。

</div>

```bash
uv run python -m part01.schema_object
```

```text
{"id": "T-1001", "title": "发票抬头开错了", "amount": 199} -> 通过
{"id": "T-1002", "title": "多扣了一个月"} -> 不通过:'amount' is a required property
{"id": "T-1003", "title": "退款", "amount": "199"} -> 不通过:'199' is not of type 'number'
{"id": "T-1004", "title": "退款", "amount": 199, "priority": "high"} -> 通过
{"id": "T-1005", "title": "退款", "amount": 199, "status": "colsed"} -> 通过
["T-1006", "退款", 199] -> 不通过:['T-1006', '退款', 199] is not of type 'object'
```

前三行和最后一行都是你预期的。真正要看的是中间两个「通过」:多了一个 `priority` 字段,通过了;`status` 写成 `colsed`,也通过了。这不是 bug,是 JSON Schema 的默认态度:**没提到的字段随便加,没限定取值的字符串随便写**。`properties` 只负责「如果有这个字段,它得长这样」,不负责「只能有这些字段」。对一个要给模型用的工具来说,这两个「通过」都是隐患:模型可能把 `priority` 当成有效参数(其实你的函数根本不收),也可能把状态拼错而你毫无察觉。第 3 步把门收紧。

## 第 3 步:把门收紧:`enum`、范围、`pattern`、`additionalProperties`

把第 2 步的 schema 升级成正式版,放在单独的文件里,以后 Day 97 的小项目和测试都要 import 它。新建 `part01/ticket_schema.py`:

```python
# agent-zero-lab/part01/ticket_schema.py
from typing import Any

from jsonschema import Draft202012Validator

TICKET_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "Ticket",
    "description": "CloudLedger 客服工单",
    "type": "object",
    "properties": {
        "id": {"type": "string", "pattern": r"^T-\d{4}$", "description": "工单号,T- 加四位数字"},
        "title": {"type": "string", "minLength": 1, "maxLength": 30, "description": "一句话标题"},
        "amount": {"type": "number", "exclusiveMinimum": 0, "maximum": 100000, "description": "涉及金额,单位元"},
        "category": {"type": "string", "enum": ["billing", "technical", "account", "other"]},
        "status": {"type": "string", "enum": ["open", "closed"], "default": "open"},
        "tags": {"type": "array", "items": {"type": "string"}, "maxItems": 5, "uniqueItems": True},
        "customer": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "minLength": 1},
                "email": {"type": "string", "format": "email"},
            },
            "required": ["name"],
        },
    },
    "required": ["id", "title", "amount", "category"],
    "additionalProperties": False,
}


def check(schema: dict, data: Any) -> list[str]:
    """用 schema 检查 data,返回全部错误(位置: 原因);空列表表示通过。"""
    validator = Draft202012Validator(schema, format_checker=Draft202012Validator.FORMAT_CHECKER)
    errors = sorted(validator.iter_errors(data), key=lambda e: list(e.path))
    return [f"{'/'.join(str(p) for p in e.path) or '(整体)'}: {e.message}" for e in errors]
```

<div class="line-notes">

- `from typing import Any` 下面 `check` 的 `data` 参数可以是任何东西(字典、列表、数字),用 `Any` 标注(Day 46)。
- `"$schema": "https://json-schema.org/draft/2020-12/schema",` 声明这份 schema 按哪一版规范写。可以不写,写上以后别的工具(编辑器插件、别的语言的库)就知道怎么解释它。
- `"title": "Ticket",` 和下一行的 `"description"` 都是**注释性**关键字,不参与检查,给人和模型看的。Day 80 说过 `description` 以后会直接影响模型用不用对这个工具。
- `"id": {"type": "string", "pattern": r"^T-\d{4}$", "description": "工单号,T- 加四位数字"},` `pattern` 是正则(Day 52 的 `Field(pattern=...)` 就是它):`^T-` 开头是 `T-`,`\d{4}` 四位数字,`$` 到此结束。用 Python 的原始字符串 `r"..."`,不然 `\d` 要写成 `\\d`。
- `"title": {"type": "string", "minLength": 1, "maxLength": 30, "description": "一句话标题"},` 字符串长度范围:至少 1 个字符(空字符串不行),最多 30 个。
- `"amount": {"type": "number", "exclusiveMinimum": 0, "maximum": 100000, "description": "涉及金额,单位元"},` 数字范围:`exclusiveMinimum: 0` 是「必须大于 0」(不含 0),`maximum: 100000` 是「不超过 100000」(含)。对应 Day 52 的 `Field(gt=0, le=100000)`。另外两个是 `minimum`(含)和 `exclusiveMaximum`(不含)。
- `"category": {"type": "string", "enum": ["billing", "technical", "account", "other"]},` `enum` 列出所有允许的值,只能是这四个之一,大小写都要对。和 Day 47 的 `Literal["billing", ...]` 是一个意思。
- `"status": {"type": "string", "enum": ["open", "closed"], "default": "open"},` `default` 也是注释性的:它**不会**替你填默认值,只是告诉读的人「不给就当 open」。真要填默认值是你代码的事。
- `"tags": {"type": "array", "items": {"type": "string"}, "maxItems": 5, "uniqueItems": True},` 数组:`items` 是每个元素的 schema(每项都得是字符串),`maxItems` 最多几项,`uniqueItems` 不许重复。注意 Python 里写 `True`,转成 JSON 时是 `true`。
- `"customer": {` 嵌套对象:值又是一份完整的 `object` schema,有自己的 `properties` 和 `required`。
- `"email": {"type": "string", "format": "email"},` `format` 是「这个字符串应该是某种格式」:`email`、`date`、`uri`、`ipv4` 这些是规范定义好的名字。它有个坑,下面看输出时说。
- `"required": ["name"],` 嵌套对象自己的必填列表:客户必须有名字,邮箱可选。
- `"required": ["id", "title", "amount", "category"],` 最外层的必填,比第 2 步多了 `category`。
- `"additionalProperties": False,` **把门关上的那一行**:`properties` 里没列的字段一律不许出现。第 2 步里 `priority` 混进来,就是因为没有这一行。
- `def check(schema: dict, data: Any) -> list[str]:` 一个小工具函数,今天后面和 Day 97 都用它:返回一列人能读的错误。
- `validator = Draft202012Validator(schema, format_checker=Draft202012Validator.FORMAT_CHECKER)` 造校验器时**多传一个 `format_checker`**。不传的话,`format` 关键字只是注释,`"email"` 写成什么都通过(规范就是这么定的,`format` 默认只做标注)。传了,`jsonschema` 才真的去查邮箱格式。
- `errors = sorted(validator.iter_errors(data), key=lambda e: list(e.path))` 全部错误按出错位置排序,输出稳定。`e.path` 是一个 `deque`(双端队列,可以当列表用),记录错误在数据里的位置,比如 `['customer', 'email']`。
- `return [f"{'/'.join(str(p) for p in e.path) or '(整体)'}: {e.message}" for e in errors]` 把位置拼成 `customer/email` 这种路径;位置是空的(错在最外层,比如缺字段)就写 `(整体)`。`or` 在这里做兜底:空字符串算假,就换成右边的值(Day 17)。

</div>

拿它查六份数据,新建 `part01/schema_strict.py`:

```python
# agent-zero-lab/part01/schema_strict.py
import json

from part01.ticket_schema import TICKET_SCHEMA, check

samples = [
    {"id": "T-1001", "title": "发票抬头开错了", "amount": 199, "category": "billing"},
    {"id": "T-1005", "title": "退款", "amount": 199, "category": "billing", "status": "colsed"},
    {"id": "t1001", "title": "退款", "amount": 0, "category": "billing"},
    {"id": "T-1004", "title": "退款", "amount": 199, "category": "billing", "priority": "high"},
    {"id": "T-1007", "title": "", "amount": 199, "category": "Billing"},
    {"id": "T-1008", "title": "换绑邮箱", "amount": 1, "category": "account",
     "customer": {"name": "王伟", "email": "wangwei.example"}},
]

for data in samples:
    errors = check(TICKET_SCHEMA, data)
    print(json.dumps(data, ensure_ascii=False))
    if not errors:
        print("   通过")
    for e in errors:
        print("   ✗", e)
```

<div class="line-notes">

- `from part01.ticket_schema import TICKET_SCHEMA, check` 从刚写的文件里导入 schema 和检查函数。
- `{"id": "T-1005", "title": "退款", "amount": 199, "category": "billing", "status": "colsed"},` 第 2 步漏网的拼写错误,这次有 `enum` 守着。
- `{"id": "t1001", "title": "退款", "amount": 0, "category": "billing"},` 一份数据两个错:编号格式不对,金额是 0。
- `{"id": "T-1004", "title": "退款", "amount": 199, "category": "billing", "priority": "high"},` 第 2 步漏网的多余字段。
- `{"id": "T-1007", "title": "", "amount": 199, "category": "Billing"},` 空标题 + 大写的 `Billing`。
- `"customer": {"name": "王伟", "email": "wangwei.example"}},` 嵌套对象里的邮箱少了 `@`。
- `for e in errors:` 每条错误单独一行,前面打个叉。

</div>

```bash
uv run python -m part01.schema_strict
```

```text
{"id": "T-1001", "title": "发票抬头开错了", "amount": 199, "category": "billing"}
   通过
{"id": "T-1005", "title": "退款", "amount": 199, "category": "billing", "status": "colsed"}
   ✗ status: 'colsed' is not one of ['open', 'closed']
{"id": "t1001", "title": "退款", "amount": 0, "category": "billing"}
   ✗ amount: 0 is less than or equal to the minimum of 0
   ✗ id: 't1001' does not match '^T-\\d{4}$'
{"id": "T-1004", "title": "退款", "amount": 199, "category": "billing", "priority": "high"}
   ✗ (整体): Additional properties are not allowed ('priority' was unexpected)
{"id": "T-1007", "title": "", "amount": 199, "category": "Billing"}
   ✗ category: 'Billing' is not one of ['billing', 'technical', 'account', 'other']
   ✗ title: '' should be non-empty
{"id": "T-1008", "title": "换绑邮箱", "amount": 1, "category": "account", "customer": {"name": "王伟", "email": "wangwei.example"}}
   ✗ customer/email: 'wangwei.example' is not a 'email'
```

每一条报错都对得上一个关键字:`enum` 报 `is not one of`,`exclusiveMinimum` 报 `less than or equal to the minimum`,`pattern` 报 `does not match`,`additionalProperties` 报 `Additional properties are not allowed`,`minLength` 报 `should be non-empty`(只有下限是 1 时才这么说,下限是 2 就会报 `is too short`),`format` 报 `is not a 'email'`。`pattern` 那行打出来是 `'^T-\\d{4}$'`,两个反斜杠不是写错了:Python 打印字符串的 `repr` 把一个反斜杠显示成 `\\`,实际还是一个。

嵌套对象的错误位置写的是 `customer/email`,这是 `check` 里把 `e.path` 拼起来的结果。一份数据有几个错就报几个,不是遇到第一个就停,这一点对「把错误回给模型让它改」很重要:一次把问题说全,它一次就能改对。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="JSON Schema 关键字地图:最外层 type object 下面分 properties、required、additionalProperties 三支;properties 里每个字段按类型配不同的关键字:字符串用 minLength、maxLength、pattern、enum、format,数字用 minimum、maximum、exclusiveMinimum、exclusiveMaximum,数组用 items、maxItems、uniqueItems,对象再嵌套一层;title、description、default 是注释性的">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="20" width="200" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="120" y="45" fill="var(--ink)" text-anchor="middle">"type": "object"</text>
<line x1="120" y1="60" x2="120" y2="90" stroke="var(--rule)"/>
<rect x="20" y="90" width="200" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="120" y="112" fill="var(--ink)" text-anchor="middle">properties:每个字段一份 schema</text>
<rect x="20" y="134" width="200" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="120" y="156" fill="var(--ink)" text-anchor="middle">required:必填清单(列表)</text>
<rect x="20" y="178" width="200" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="120" y="200" fill="var(--ink)" text-anchor="middle">additionalProperties: false</text>
<line x1="220" y1="107" x2="260" y2="107" stroke="var(--rule)"/>
<text x="260" y="40" fill="var(--ink-faint)" font-size="11">字段按 type 选关键字</text>
<rect x="260" y="52" width="360" height="54" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="272" y="72" fill="var(--ink)">"string"</text>
<text x="272" y="92" fill="var(--ink-soft)" font-size="11">minLength · maxLength · pattern · enum · format</text>
<rect x="260" y="114" width="360" height="54" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="272" y="134" fill="var(--ink)">"number" / "integer"</text>
<text x="272" y="154" fill="var(--ink-soft)" font-size="11">minimum · maximum · exclusiveMinimum · exclusiveMaximum</text>
<rect x="260" y="176" width="360" height="54" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="272" y="196" fill="var(--ink)">"array"</text>
<text x="272" y="216" fill="var(--ink-soft)" font-size="11">items(每项的 schema)· maxItems · uniqueItems</text>
<rect x="260" y="238" width="360" height="54" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="272" y="258" fill="var(--ink)">"object"</text>
<text x="272" y="278" fill="var(--ink-soft)" font-size="11">再套一层 properties / required(customer 就是)</text>
<text x="20" y="250" fill="var(--ink)" font-size="11">只给人和模型看、不参与检查:</text>
<text x="20" y="270" fill="var(--ink-soft)" font-size="11">title · description · default · $schema</text>
<text x="20" y="312" fill="var(--ink-faint)" font-size="11">今天用到的全部关键字。规范里还有更多(oneOf、$ref 等),用到再查。</text>
</g>
</svg>
<figcaption>关键字按「它描述什么类型」分组记。左边三个是对象层面的,右边蓝色是字段层面的,左下角那几个不管检查,只是说明。</figcaption>
</figure>

## 第 4 步:读懂错误,以及 schema 自己写错了怎么办

`check` 把错误拼成了字符串,但原始的错误对象上还有更多信息。另外,`validate()` 和 `iter_errors()` 行为不同,schema 本身写错时也有几种不同的表现。新建 `part01/schema_nested.py`,用一份错了四处的数据把这些都看一遍:

```python
# agent-zero-lab/part01/schema_nested.py
from jsonschema import Draft202012Validator, SchemaError, ValidationError, validate
from jsonschema.exceptions import UnknownType
from jsonschema.exceptions import best_match

from part01.ticket_schema import TICKET_SCHEMA

bad = {
    "id": "T-1009",
    "title": "导出报表",
    "amount": 50,
    "category": "technical",
    "tags": ["export", 7, "export", "a", "b", "c"],
    "customer": {"email": "li@example.com"},
}

print("== 一个错误一个错误看 ==")
validator = Draft202012Validator(TICKET_SCHEMA)
for e in validator.iter_errors(bad):
    print(f"path={list(e.path)}  validator={e.validator}  json_path={e.json_path}")
    print("   message:", e.message)

print("== validate():只报第一个 ==")
try:
    validate(bad, TICKET_SCHEMA)
except ValidationError as e:
    print(type(e).__name__ + ":", e.message)

print("== best_match():挑最像根因的那个 ==")
print(best_match(validator.iter_errors(bad)).message)

print("== schema 自己写错了 ==")
wrong_type = {"type": "object", "properties": {"amount": {"type": "str"}}}
try:
    validate({"amount": 5}, wrong_type)
except SchemaError as e:
    print("validate() 先查 schema:", type(e).__name__ + ":", e.message)
try:
    Draft202012Validator(wrong_type).is_valid({"amount": 5})
except UnknownType as e:
    print("跳过检查直接用:", type(e).__name__ + ":", str(e).splitlines()[0])

typo = {"type": "object", "properties": {"amount": {"type": "number"}}, "requird": ["amount"]}
Draft202012Validator.check_schema(typo)
print("关键字拼错(requird):check_schema 没意见,缺 amount 也", "通过" if Draft202012Validator(typo).is_valid({}) else "不通过")
```

<div class="line-notes">

- `from jsonschema import Draft202012Validator, SchemaError, ValidationError, validate` `SchemaError` 是「schema 本身不合法」时抛的异常,和「数据不合法」的 `ValidationError` 是两回事。
- `from jsonschema.exceptions import UnknownType` 另一个 schema 写错时的异常,下面会碰到。
- `from jsonschema.exceptions import best_match` 一个小工具:从一堆错误里挑出最可能是根因的那个。
- `"tags": ["export", 7, "export", "a", "b", "c"],` 这个数组错了三处:第 2 项是数字、有重复、一共 6 项超过 5。
- `"customer": {"email": "li@example.com"},` 嵌套对象缺必填的 `name`。
- `validator = Draft202012Validator(TICKET_SCHEMA)` 这次故意**没传** `format_checker`,因为这份数据的邮箱是合法的,无所谓。
- `print(f"path={list(e.path)}  validator={e.validator}  json_path={e.json_path}")` 每个错误对象上的三样东西:`path` 是出错位置(从外到里的键和下标),`validator` 是**哪个关键字**判它不合格,`json_path` 是同一个位置的另一种写法(`$.tags[1]`,`$` 代表根)。
- `print("   message:", e.message)` 人话。
- `validate(bad, TICKET_SCHEMA)` 回到第 1 步的 `validate` 函数:它遇到错误就抛,一次只能知道一个。
- `print(best_match(validator.iter_errors(bad)).message)` `best_match` 按「错误越靠外层、越具体越像根因」的规则选一个。错误很多、只想给用户看一条时用它。
- `wrong_type = {"type": "object", "properties": {"amount": {"type": "str"}}}` 第一种写错:`type` 写成了 Python 的 `str`,JSON Schema 里没有这个类型名。
- `validate({"amount": 5}, wrong_type)` `validate` 函数在查数据**之前先查 schema**,所以抛的是 `SchemaError`。
- `Draft202012Validator(wrong_type).is_valid({"amount": 5})` 直接用校验器类**不会**先查 schema。`is_valid` 是 `iter_errors` 的简化版,只回 `True`/`False`。
- `except UnknownType as e:` 查到 `amount` 那一步才发现 `str` 不认识,抛 `UnknownType`。错误消息很长,只打印第一行。
- `typo = {"type": "object", "properties": {"amount": {"type": "number"}}, "requird": ["amount"]}` 第二种写错:`required` 拼成了 `requird`。
- `Draft202012Validator.check_schema(typo)` 主动检查 schema 合不合法的方法。它**没有报错**。
- `print("关键字拼错(requird):check_schema 没意见,缺 amount 也",` 空对象 `{}` 去查,实测**通过**:拼错的关键字被当成「不认识的、不影响检查的东西」直接忽略了。

</div>

```bash
uv run python -m part01.schema_nested
```

```text
== 一个错误一个错误看 ==
path=['tags', 1]  validator=type  json_path=$.tags[1]
   message: 7 is not of type 'string'
path=['tags']  validator=maxItems  json_path=$.tags
   message: ['export', 7, 'export', 'a', 'b', 'c'] is too long
path=['tags']  validator=uniqueItems  json_path=$.tags
   message: ['export', 7, 'export', 'a', 'b', 'c'] has non-unique elements
path=['customer']  validator=required  json_path=$.customer
   message: 'name' is a required property
== validate():只报第一个 ==
ValidationError: ['export', 7, 'export', 'a', 'b', 'c'] is too long
== best_match():挑最像根因的那个 ==
['export', 7, 'export', 'a', 'b', 'c'] is too long
== schema 自己写错了 ==
validate() 先查 schema: SchemaError: 'str' is not valid under any of the given schemas
跳过检查直接用: UnknownType: Unknown type 'str' for validator with schema:
关键字拼错(requird):check_schema 没意见,缺 amount 也 通过
```

四个错误各自带着位置和关键字名:`['tags', 1]` 是数组第 2 项,`['customer']` 是嵌套对象整体缺字段。`validate()` 只给了一个,而且给的还不是第一个错(它内部也走了一遍 `best_match`),所以**想看全部用 `iter_errors`,只要一句话用 `validate`**。

最后三行是今天最该记住的坑。`type` 写错这种「值不合法」的错,`validate()` 和 `check_schema()` 都能抓住;但**关键字名拼错**(`requird`、`minimun`、`addtionalProperties`)谁都不报,因为规范允许 schema 里出现自定义关键字,库只能当作不认识的注释跳过。表现就是:你以为设了必填,其实什么都没设,一份空对象照样通过。防法有两个:写完 schema 先拿一份**故意不合格**的数据去查,确认它真的被拦下(今天每一步都是这么做的);Day 97 的小项目里给每个工具的 schema 配一个「坏参数一定被拒」的测试。

## 第 5 步:pydantic 生成的就是它

[Day 52](/blog/agent-zero/day-052-pydantic-2/) 提过一句:模型的 `description` 以后会被导出成 JSON Schema。现在你认得 JSON Schema 了,看看导出来长什么样。新建 `part01/schema_from_pydantic.py`,照着 Day 52 的 `TicketForm` 写一个缩减版:

```python
# agent-zero-lab/part01/schema_from_pydantic.py
import json

from pydantic import BaseModel, Field, ValidationError

from part01.ticket_schema import check


class TicketForm(BaseModel):
    id: str = Field(pattern=r"^T-\d{4}$")
    title: str = Field(min_length=1, max_length=30, description="一句话标题")
    amount: float = Field(gt=0, le=100000)


schema = TicketForm.model_json_schema()
print(json.dumps(schema, ensure_ascii=False, indent=2))

print("== 同一份数据,两边各判一次 ==")
samples = [
    {"id": "T-1006", "title": "发票重开", "amount": 66},
    {"id": "T-1006", "title": "发票重开", "amount": "66"},
    {"id": "T-1010", "title": "多扣了一个月", "amount": -99},
]
for data in samples:
    by_schema = check(schema, data) or ["通过"]
    try:
        TicketForm.model_validate(data)
        by_pydantic = "通过"
    except ValidationError as e:
        by_pydantic = "; ".join(f"{err['loc'][0]}: {err['msg']}" for err in e.errors())
    print(json.dumps(data, ensure_ascii=False))
    print("   jsonschema:", "; ".join(by_schema))
    print("   pydantic  :", by_pydantic)
```

<div class="line-notes">

- `from pydantic import BaseModel, Field, ValidationError` 注意这个 `ValidationError` 是 **pydantic 的**,和 `jsonschema` 的同名异常不是一个类。同一个文件里两个都要用的话,得 `import jsonschema` 然后写 `jsonschema.ValidationError` 区分;今天这个文件只用 pydantic 的。
- `class TicketForm(BaseModel):` Day 52 的模型,去掉了 validator 和 tags,留三个字段。
- `amount: float = Field(gt=0, le=100000)` `gt` 是大于,`le` 是小于等于,对照着看下面导出来的关键字。
- `schema = TicketForm.model_json_schema()` **一行导出 JSON Schema**,返回的是字典,和你第 3 步手写的是同一种东西。
- `print(json.dumps(schema, ensure_ascii=False, indent=2))` `indent=2` 缩进打印,好读。
- `by_schema = check(schema, data) or ["通过"]` 拿 pydantic 导出的 schema,用 `jsonschema` 去查。空列表算假,`or` 换成 `["通过"]`。
- `TicketForm.model_validate(data)` 同一份数据交给 pydantic 查。
- `by_pydantic = "; ".join(f"{err['loc'][0]}: {err['msg']}" for err in e.errors())` pydantic 的错误列表每项是字典,`loc` 是位置,`msg` 是人话(Day 51)。

</div>

```bash
uv run python -m part01.schema_from_pydantic
```

```text
{
  "properties": {
    "id": {
      "pattern": "^T-\\d{4}$",
      "title": "Id",
      "type": "string"
    },
    "title": {
      "description": "一句话标题",
      "maxLength": 30,
      "minLength": 1,
      "title": "Title",
      "type": "string"
    },
    "amount": {
      "exclusiveMinimum": 0,
      "maximum": 100000,
      "title": "Amount",
      "type": "number"
    }
  },
  "required": [
    "id",
    "title",
    "amount"
  ],
  "title": "TicketForm",
  "type": "object"
}
== 同一份数据,两边各判一次 ==
{"id": "T-1006", "title": "发票重开", "amount": 66}
   jsonschema: 通过
   pydantic  : 通过
{"id": "T-1006", "title": "发票重开", "amount": "66"}
   jsonschema: amount: '66' is not of type 'number'
   pydantic  : 通过
{"id": "T-1010", "title": "多扣了一个月", "amount": -99}
   jsonschema: amount: -99 is less than or equal to the minimum of 0
   pydantic  : amount: Input should be greater than 0
```

导出的 schema 里每一行你现在都认识:`gt=0` 变成了 `exclusiveMinimum: 0`,`le=100000` 变成 `maximum`,`min_length` 变成 `minLength`,`pattern` 原样,每个字段还多了一个自动生成的 `title`。它没有 `additionalProperties: false`,因为 pydantic 默认对多余字段的态度是「忽略」,要改成拒绝得在模型里配 `extra="forbid"`(Day 80 的面试题提过)。

第二份数据暴露了两者最本质的区别:金额是字符串 `"66"`,**jsonschema 说不行,pydantic 说行**。pydantic 会试着**转换**,`"66"` 能转成 66.0 就放行(Day 51 的「能转的自动转好」);JSON Schema 只**判断**,`"66"` 是字符串就不是数字,没有商量。两种态度各有用处:接表单、接模型输出时,转换省事;给模型写工具定义、做接口契约时,判断更严格,也更容易被别的语言理解。所以这门课后面的做法是:**用 pydantic 写模型,导出 schema 给模型看,本地校验时按场景挑一个**。

还有一个对照值得记一下:第 3 步手写的 `TICKET_SCHEMA` 和这里导出的,在第 2 步到第 4 步讲的所有关键字上完全一致,所以手写和导出可以互换。什么时候手写?schema 很小、或者要给别的语言的人看、或者要发给模型且不想带 pydantic 的 `title` 噪音时。什么时候导出?字段多、要在 Python 里顺手用同一个模型做转换时。

## 第 6 步:它最终会被放进哪里

把今天的 schema 放进一份「工具定义」里,看看模型以后会读到什么。这一步不调模型,只打印。新建 `part01/schema_as_tool.py`:

```python
# agent-zero-lab/part01/schema_as_tool.py
import json

from part01.ticket_schema import TICKET_SCHEMA, check

CREATE_TICKET_TOOL = {
    "type": "function",
    "function": {
        "name": "create_ticket",
        "description": "给客户新建一张客服工单。金额不确定时先问客户,不要瞎填。",
        "parameters": TICKET_SCHEMA,
    },
}

print(json.dumps(CREATE_TICKET_TOOL, ensure_ascii=False, indent=2)[:420], "...")

model_said = '{"id": "T-2001", "title": "年付想改成月付", "amount": 468, "category": "plan"}'
args = json.loads(model_said)
print("模型给的参数:", args)
print("本地检查:", check(TICKET_SCHEMA, args))
```

<div class="line-notes">

- `CREATE_TICKET_TOOL = {` 这是 OpenAI 兼容接口里一个「工具」的固定形状(第三部分 [Day 157](/blog/agent-zero/day-157-tool-schema/) 细讲):最外层 `type: "function"`,里面 `name`、`description`、`parameters` 三块。
- `"parameters": TICKET_SCHEMA,` **`parameters` 的值就是一份 JSON Schema**,直接把今天写的塞进去。模型读着它决定每个参数填什么、哪些必填、能取哪些值。
- `print(json.dumps(CREATE_TICKET_TOOL, ensure_ascii=False, indent=2)[:420], "...")` 整段太长,只打印前 420 个字符看个形状。
- `model_said = '{"id": "T-2001", "title": "年付想改成月付", "amount": 468, "category": "plan"}'` 假装这是模型回来的一段参数(以后它真的会这样回一段 JSON 字符串)。模型把分类填成了 `plan`,不在四个允许值里。
- `args = json.loads(model_said)` 字符串转字典。
- `print("本地检查:", check(TICKET_SCHEMA, args))` 用**同一份 schema**在本地再查一遍。模型不一定守规矩,schema 既是给它的说明书,也是你的验货单。

</div>

```bash
uv run python -m part01.schema_as_tool
```

```text
{
  "type": "function",
  "function": {
    "name": "create_ticket",
    "description": "给客户新建一张客服工单。金额不确定时先问客户,不要瞎填。",
    "parameters": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "Ticket",
      "description": "CloudLedger 客服工单",
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^T-\\d{4}$",
          "description": ...
模型给的参数: {'id': 'T-2001', 'title': '年付想改成月付', 'amount': 468, 'category': 'plan'}
本地检查: ["category: 'plan' is not one of ['billing', 'technical', 'account', 'other']"]
```

这就是整条线:你写一份 schema,它被放进工具定义发给模型,模型按它填参数,参数回来你再用它查一遍,查出来的错误原样回给模型让它改。今天只做了第一步和最后一步,中间那段等第二、三部分接上。

## 用测试钉住 schema

第 4 步说过,schema 拼错关键字没人报错,唯一的保险是「拿坏数据试」。把这件事写成测试,以后改 schema 时跑一下就知道有没有改坏。新建 `tests/test_ticket_schema.py`:

```python
# agent-zero-lab/tests/test_ticket_schema.py
import pytest
from jsonschema import Draft202012Validator

from part01.ticket_schema import TICKET_SCHEMA, check

GOOD = {"id": "T-1001", "title": "发票抬头开错了", "amount": 199, "category": "billing"}


def test_schema_itself_is_valid():
    Draft202012Validator.check_schema(TICKET_SCHEMA)


def test_good_ticket_passes():
    assert check(TICKET_SCHEMA, GOOD) == []


def test_optional_fields_can_be_omitted():
    assert "status" not in TICKET_SCHEMA["required"]
    assert check(TICKET_SCHEMA, {**GOOD, "status": "closed", "tags": ["vip"]}) == []


@pytest.mark.parametrize(
    ("patch", "keyword"),
    [
        ({"amount": "199"}, "is not of type 'number'"),
        ({"amount": 0}, "less than or equal to the minimum"),
        ({"id": "t1001"}, "does not match"),
        ({"category": "Billing"}, "is not one of"),
        ({"priority": "high"}, "Additional properties are not allowed"),
        ({"title": ""}, "should be non-empty"),
        ({"customer": {"email": "a@b.c"}}, "'name' is a required property"),
        ({"customer": {"name": "王伟", "email": "wangwei.example"}}, "is not a 'email'"),
    ],
)
def test_bad_ticket_rejected(patch: dict, keyword: str):
    errors = check(TICKET_SCHEMA, {**GOOD, **patch})
    assert len(errors) == 1
    assert keyword in errors[0]


def test_missing_required_lists_each_field():
    errors = check(TICKET_SCHEMA, {"id": "T-1001"})
    assert sorted(errors) == [
        "(整体): 'amount' is a required property",
        "(整体): 'category' is a required property",
        "(整体): 'title' is a required property",
    ]
```

<div class="line-notes">

- `GOOD = {"id": "T-1001", "title": "发票抬头开错了", "amount": 199, "category": "billing"}` 一份合格的工单,下面每个用例在它基础上改一处。
- `Draft202012Validator.check_schema(TICKET_SCHEMA)` 第一个用例:schema 本身合法。抓得住 `type: "str"` 这类错,抓不住拼错的关键字,所以后面还要有「坏数据被拒」的用例。
- `assert check(TICKET_SCHEMA, GOOD) == []` 合格的工单没有错误。
- `assert check(TICKET_SCHEMA, {**GOOD, "status": "closed", "tags": ["vip"]}) == []` `{**GOOD, ...}` 是 Day 52 的字典解包:复制一份再加两个键。可选字段给了也通过。
- `@pytest.mark.parametrize(` 参数化(Day 73):八种坏法各跑一遍。
- `({"priority": "high"}, "Additional properties are not allowed"),` 这一条就是在守 `additionalProperties: false`;如果有人把它删了,这个用例会红。
- `({"customer": {"email": "a@b.c"}}, "'name' is a required property"),` 嵌套对象的必填也要守住。
- `def test_bad_ticket_rejected(patch: dict, keyword: str):` 每组数据:只改一处,就应该恰好一个错,而且错误消息里包含预期的关键词。
- `def test_missing_required_lists_each_field():` 一次缺三个必填字段,三个都要报出来,证明 `check` 真的是「一次全拿」。

</div>

```bash
uv run pytest -q
```

```text
.......................................                                  [100%]
39 passed in 0.34s
```

39 个是今天的 12 个(参数化展开后)加 Day 92 到 94 的 27 个。

## 动手练习

运行方式都是在 `agent-zero-lab` 根目录 `uv run python -m part01.文件名`。练习 1 要用 Day 94 的 `ledger.db`,脚本里会自己重建。

**练习 1:数据库约束和 schema 是一回事。** Day 94 的 `customers` 表上有 `CHECK (plan IN (...))`、`CHECK (seats > 0)`、`email UNIQUE`。把这张表的「形状」写成一份 `CUSTOMER_SCHEMA`(`email` 和 `city` 可以是 `null`,注意 `type` 可以写成列表),从 `ledger.db` 里读出全部 10 家客户,逐行检查,应该全部通过;再手造一行坏数据,看它报出几个错。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex95_1_customers.py
from part01.db import db
from part01.ledger.seed import LEDGER_DB, build
from part01.ticket_schema import check

CUSTOMER_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {"type": "integer", "minimum": 1},
        "company": {"type": "string", "minLength": 1},
        "contact": {"type": "string", "minLength": 1},
        "email": {"type": ["string", "null"], "format": "email"},
        "plan": {"type": "string", "enum": ["基础版", "专业版", "企业版"]},
        "seats": {"type": "integer", "minimum": 1},
        "city": {"type": ["string", "null"]},
        "created_at": {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}$"},
    },
    "required": ["id", "company", "contact", "plan", "seats", "created_at"],
    "additionalProperties": False,
}

build()
with db(LEDGER_DB, read_only=True) as conn:
    rows = [dict(r) for r in conn.execute("SELECT * FROM customers ORDER BY id")]

bad_total = 0
for row in rows:
    errors = check(CUSTOMER_SCHEMA, row)
    bad_total += len(errors)
    print(row["id"], row["company"], "->", "通过" if not errors else errors)
print("库里 10 行一共", bad_total, "个错误")

fake = {"id": 11, "company": "", "contact": "张三", "email": "zhangsan", "plan": "旗舰版", "seats": 0, "created_at": "2026/10/23"}
print("手造的一行 ->")
for e in check(CUSTOMER_SCHEMA, fake):
    print("   ✗", e)
```

<div class="line-notes">

- `"email": {"type": ["string", "null"], "format": "email"},` `type` 写成列表表示「这几种之一」:邮箱可以是字符串,也可以是 `null`(4 号客户没邮箱)。`format` 只对字符串起作用,`null` 时跳过。
- `"plan": {"type": "string", "enum": ["基础版", "专业版", "企业版"]},` 对应表上的 `CHECK (plan IN ...)`。
- `"seats": {"type": "integer", "minimum": 1},` 对应 `CHECK (seats > 0)`,整数的「大于 0」写成 `minimum: 1` 更直白。
- `"city": {"type": ["string", "null"]},` 6 号客户没城市。
- `"created_at": {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}$"},` 日期是文本,用正则管格式。
- `rows = [dict(r) for r in conn.execute("SELECT * FROM customers ORDER BY id")]` `Row` 转字典(Day 93),字典才能交给 `check`。`NULL` 读出来是 `None`,正好对应 schema 里的 `null`。
- `fake = {"id": 11, "company": "", "contact": "张三", "email": "zhangsan", "plan": "旗舰版", "seats": 0, "created_at": "2026/10/23"}` 五处错:空公司名、邮箱没 `@`、套餐不在三种里、席位 0、日期用了斜杠。

</div>

```text
1 星河餐饮 -> 通过
2 青木设计 -> 通过
3 远山物流 -> 通过
4 蓝鲸教育 -> 通过
5 启明科技 -> 通过
6 禾丰农业 -> 通过
7 半岛咖啡 -> 通过
8 云杉律所 -> 通过
9 北辰贸易 -> 通过
10 小满花店 -> 通过
库里 10 行一共 0 个错误
手造的一行 ->
   ✗ company: '' should be non-empty
   ✗ created_at: '2026/10/23' does not match '^\\d{4}-\\d{2}-\\d{2}$'
   ✗ email: 'zhangsan' is not a 'email'
   ✗ plan: '旗舰版' is not one of ['基础版', '专业版', '企业版']
   ✗ seats: 0 is less than the minimum of 1
```

数据库约束守的是「写进表的那一刻」,schema 守的是「数据在程序之间传递的那一刻」,两边的规则应该一致。以后改了表的 `CHECK`,记得同步改 schema,练习 4 那种对账脚本就是用来发现两边不一致的。

</details>

**练习 2:把报错翻译成中文。** Day 54 给 pydantic 的错误做过一张翻译表。给 `jsonschema` 也做一张:按 `e.validator`(哪个关键字判的)选一句中文模板,用 `e.instance`(出错的值)和 `e.validator_value`(schema 里写的限制)填进去。用第 3 步的几份坏数据试。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex95_2_zh_errors.py
from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

from part01.ticket_schema import TICKET_SCHEMA

ZH = {
    "required": lambda e: f"缺少必填字段 {e.message.split(chr(39))[1]}",
    "type": lambda e: f"类型应该是 {e.validator_value},收到 {e.instance!r}",
    "enum": lambda e: f"只能是 {'、'.join(map(str, e.validator_value))} 之一,收到 {e.instance!r}",
    "pattern": lambda e: f"格式不对,要符合 {e.validator_value},收到 {e.instance!r}",
    "exclusiveMinimum": lambda e: f"必须大于 {e.validator_value},收到 {e.instance!r}",
    "maximum": lambda e: f"不能超过 {e.validator_value},收到 {e.instance!r}",
    "minLength": lambda e: f"至少 {e.validator_value} 个字符,收到 {e.instance!r}",
    "maxLength": lambda e: f"最多 {e.validator_value} 个字符,收到 {len(e.instance)} 个",
    "additionalProperties": lambda e: "有不认识的字段:" + e.message.split("(")[1].rstrip(")"),
    "maxItems": lambda e: f"最多 {e.validator_value} 项,收到 {len(e.instance)} 项",
    "format": lambda e: f"不是合法的 {e.validator_value},收到 {e.instance!r}",
}


def explain_zh(e: ValidationError) -> str:
    where = "/".join(str(p) for p in e.path) or "整体"
    text = ZH.get(str(e.validator), lambda e: e.message)(e)
    return f"{where}:{text}"


validator = Draft202012Validator(TICKET_SCHEMA, format_checker=Draft202012Validator.FORMAT_CHECKER)
samples = [
    {"id": "t1001", "title": "", "amount": 0, "category": "Billing"},
    {"id": "T-1004", "title": "退款", "amount": 200000, "category": "billing", "priority": "high"},
    {"id": "T-1008", "title": "换绑邮箱", "amount": 1, "category": "account", "tags": list("abcdef"),
     "customer": {"name": "王伟", "email": "wangwei.example"}},
    {"title": "没有编号"},
]
for data in samples:
    print(data)
    for e in sorted(validator.iter_errors(data), key=lambda e: list(e.path)):
        print("   -", explain_zh(e))
```

<div class="line-notes">

- `ZH = {` 关键字名 → 一个接收错误对象、返回中文的 `lambda`(Day 30)。
- `"required": lambda e: f"缺少必填字段 {e.message.split(chr(39))[1]}",` `required` 的错误里,缺的字段名只在 `message` 里有(`'amount' is a required property`),按单引号切开取中间那段。`chr(39)` 就是单引号,f-string 里直接写单引号会和外面的引号打架。
- `"type": lambda e: f"类型应该是 {e.validator_value},收到 {e.instance!r}",` `e.validator_value` 是 schema 里写的那个值(比如 `"number"`),`e.instance` 是数据里出错的那个值。
- `"enum": lambda e: f"只能是 {'、'.join(map(str, e.validator_value))} 之一,收到 {e.instance!r}",` 枚举的 `validator_value` 是允许值列表,用顿号连起来。
- `"additionalProperties": lambda e: "有不认识的字段:" + e.message.split("(")[1].rstrip(")"),` 多余字段名也只在 `message` 的括号里,切出来。
- `text = ZH.get(str(e.validator), lambda e: e.message)(e)` 查表;表里没有的关键字用原始英文兜底。`dict.get` 的第二个参数就是默认值(Day 24)。
- `{"id": "T-1008", "title": "换绑邮箱", "amount": 1, "category": "account", "tags": list("abcdef"),` `list("abcdef")` 把字符串拆成六个单字母的列表,正好超过 `maxItems: 5`。

</div>

```text
{'id': 't1001', 'title': '', 'amount': 0, 'category': 'Billing'}
   - amount:必须大于 0,收到 0
   - category:只能是 billing、technical、account、other 之一,收到 'Billing'
   - id:格式不对,要符合 ^T-\d{4}$,收到 't1001'
   - title:至少 1 个字符,收到 ''
{'id': 'T-1004', 'title': '退款', 'amount': 200000, 'category': 'billing', 'priority': 'high'}
   - 整体:有不认识的字段:'priority' was unexpected
   - amount:不能超过 100000,收到 200000
{'id': 'T-1008', 'title': '换绑邮箱', 'amount': 1, 'category': 'account', 'tags': ['a', 'b', 'c', 'd', 'e', 'f'], 'customer': {'name': '王伟', 'email': 'wangwei.example'}}
   - customer/email:不是合法的 email,收到 'wangwei.example'
   - tags:最多 5 项,收到 6 项
{'title': '没有编号'}
   - 整体:缺少必填字段 id
   - 整体:缺少必填字段 amount
   - 整体:缺少必填字段 category
```

</details>

**练习 3(观察题):八个「和直觉不一样」。** 对下面八对 schema 和数据,先猜通过还是不通过,再跑:`True` 对 `integer`;`5.0` 对 `integer`;`1` 对 `boolean`;空 schema `{}` 对任意数据;没写 `additionalProperties` 时多余字段;`required` 里的字段值是 `null`;`required` 要求一个 `properties` 里没列的字段;`format: email` 开不开 `FORMAT_CHECKER`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex95_3_surprises.py
from jsonschema import Draft202012Validator

cases = [
    ("True 算 integer 吗", {"type": "integer"}, True),
    ("5.0 算 integer 吗", {"type": "integer"}, 5.0),
    ("1 算 boolean 吗", {"type": "boolean"}, 1),
    ("没写 type,什么都通过?", {}, {"anything": [1, 2, 3]}),
    ("多余字段默认拦吗", {"type": "object", "properties": {"a": {"type": "integer"}}}, {"a": 1, "b": 2}),
    ("required 只管「有没有」,不管「是不是 null」", {"type": "object", "required": ["a"]}, {"a": None}),
    ("properties 里没列的字段,required 也能要求", {"type": "object", "required": ["zzz"]}, {"a": 1}),
    ("format 不开检查器时", {"type": "string", "format": "email"}, "not-an-email"),
]
for label, schema, data in cases:
    plain = Draft202012Validator(schema).is_valid(data)
    strict = Draft202012Validator(schema, format_checker=Draft202012Validator.FORMAT_CHECKER).is_valid(data)
    extra = "" if plain == strict else f"(开 FORMAT_CHECKER 后:{'通过' if strict else '不通过'})"
    print(f"{label:<34} {'通过' if plain else '不通过'} {extra}")
```

<div class="line-notes">

- `("没写 type,什么都通过?", {}, {"anything": [1, 2, 3]}),` 空 schema 等于「没有任何限制」。
- `("required 只管「有没有」,不管「是不是 null」", {"type": "object", "required": ["a"]}, {"a": None}),` `required` 检查的是键在不在,`None` 也是一个值。想拒绝 `null` 要给 `a` 写 `type`。
- `plain = Draft202012Validator(schema).is_valid(data)` 不带格式检查器的结果。
- `strict = Draft202012Validator(schema, format_checker=Draft202012Validator.FORMAT_CHECKER).is_valid(data)` 带的结果,只有 `format` 那一条会不同。

</div>

```text
True 算 integer 吗                   不通过 
5.0 算 integer 吗                    通过 
1 算 boolean 吗                      不通过 
没写 type,什么都通过?                     通过 
多余字段默认拦吗                           通过 
required 只管「有没有」,不管「是不是 null」      通过 
properties 里没列的字段,required 也能要求    不通过 
format 不开检查器时                      通过 (开 FORMAT_CHECKER 后:不通过)
```

八条里最该记的三条:多余字段默认放行(要 `additionalProperties: false`);`required` 挡不住 `null`(要配 `type`);`format` 默认只是注释(要 `FORMAT_CHECKER`)。

</details>

**练习 4:检查一整个文件。** 写 `check_file(path)`:读一个 JSON 文件,它应该是工单数组(`{"type": "array", "items": TICKET_SCHEMA}`),逐条报告第几条、哪里错,返回不合格的条数;文件不是合法 JSON 或最外层不是数组时也要有人话提示。在 `part01/data/tickets_sample.json` 里放 4 张工单,其中 1 张故意写坏。

<details><summary>参考答案</summary>

先造数据文件 `part01/data/tickets_sample.json`(第 4 条金额是字符串,还多了个 `priority`):

```json
[
  {"id": "T-1001", "title": "发票抬头开错了", "amount": 199, "category": "billing", "status": "closed"},
  {"id": "T-1002", "title": "多扣了一个月", "amount": 99, "category": "billing"},
  {"id": "T-1004", "title": "登录后白屏", "amount": 89.5, "category": "technical", "tags": ["web", "urgent"]},
  {"id": "T-1005", "title": "换绑邮箱", "amount": "1", "category": "account", "priority": "low"}
]
```

```python
# agent-zero-lab/part01/ex95_4_file.py
import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

from part01.ticket_schema import TICKET_SCHEMA

BOOK_SCHEMA = {"type": "array", "items": TICKET_SCHEMA}


def check_file(path: Path) -> int:
    """检查一个工单文件,逐条打印问题;返回不合格的工单数。"""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"{path.name} 不是合法的 JSON:{e.msg}(第 {e.lineno} 行)")
        return 1
    validator = Draft202012Validator(BOOK_SCHEMA)
    bad: dict[int, list[str]] = {}
    for e in validator.iter_errors(data):
        if not e.path:
            print(f"{path.name} 整体不对:{e.message}")
            return 1
        index = e.path[0]
        where = "/".join(str(p) for p in list(e.path)[1:]) or "整体"
        bad.setdefault(index, []).append(f"{where}: {e.message}")
    for index in sorted(bad):
        ticket_id = data[index].get("id", "?") if isinstance(data[index], dict) else "?"
        print(f"第 {index} 条({ticket_id}):")
        for line in bad[index]:
            print("   ✗", line)
    print(f"{len(data)} 条,{len(bad)} 条不合格")
    return len(bad)


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "data" / "tickets_sample.json"
    sys.exit(1 if check_file(target) else 0)
```

<div class="line-notes">

- `BOOK_SCHEMA = {"type": "array", "items": TICKET_SCHEMA}` 数组 schema,每一项都要满足工单 schema。schema 可以像积木一样拼。
- `except json.JSONDecodeError as e:` 文件本身不是 JSON(Day 39 和 Day 54 都遇到过),给出行号。
- `if not e.path:` 位置是空的,说明错在最外层(比如根本不是数组),直接报告退出。
- `index = e.path[0]` 数组里的错误,`path` 的第一项是下标,告诉你是第几条工单。
- `where = "/".join(str(p) for p in list(e.path)[1:]) or "整体"` 去掉下标后的剩余路径,是这条工单内部的位置。
- `bad.setdefault(index, []).append(f"{where}: {e.message}")` 按工单下标归类错误。`setdefault` 是「没有这个键就先放一个空列表」(Day 24)。
- `sys.exit(1 if check_file(target) else 0)` 有不合格的就退出码 1,方便放进脚本或 CI 里当门禁(Day 94 的退出码惯例)。

</div>

```text
第 3 条(T-1005):
   ✗ amount: '1' is not of type 'number'
   ✗ 整体: Additional properties are not allowed ('priority' was unexpected)
4 条,1 条不合格
```

运行后 `echo $?` 看到 1。下标从 0 数,所以「第 3 条」就是文件里的第 4 张。

</details>

**练习 5(开放题):命令行参数也能用 schema 管。** Day 94 的 `bill` 命令用 `check_month` 查月份格式。把「`bill` 的参数」写成一份 `BILL_ARGS_SCHEMA`(只有一个 `month`,用 `pattern` 限制 `YYYY-MM` 且月份在 01 到 12),写 `validate_args(schema, args)` 返回错误列表,拿 Day 94 测试里那五个坏月份比较两种检查的结果,再试多传一个参数、月份不是字符串两种情况。想一想:什么情况下 schema 比 `if` 好,什么情况下不如。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex95_5_args_schema.py
from jsonschema import Draft202012Validator

from part01.ledger.billing import check_month

BILL_ARGS_SCHEMA = {
    "type": "object",
    "properties": {
        "month": {
            "type": "string",
            "pattern": r"^\d{4}-(0[1-9]|1[0-2])$",
            "description": "要开票的月份,格式 YYYY-MM,例如 2026-10",
        }
    },
    "required": ["month"],
    "additionalProperties": False,
}


def validate_args(schema: dict, args: dict) -> list[str]:
    v = Draft202012Validator(schema)
    return [f"{'/'.join(map(str, e.path)) or '(整体)'}: {e.message}" for e in v.iter_errors(args)]


for month in ["2026-10", "2026-13", "202610", "2026-1", "abcd-ef", "2026-00"]:
    by_schema = validate_args(BILL_ARGS_SCHEMA, {"month": month})
    try:
        check_month(month)
        by_code = "通过"
    except ValueError as e:
        by_code = f"ValueError: {e}"
    print(f"{month:<8} schema: {'通过' if not by_schema else by_schema[0]:<60} check_month: {by_code}")

print("多传一个参数:", validate_args(BILL_ARGS_SCHEMA, {"month": "2026-10", "dry_run": True}))
print("month 不是字符串:", validate_args(BILL_ARGS_SCHEMA, {"month": 202610}))
```

<div class="line-notes">

- `"pattern": r"^\d{4}-(0[1-9]|1[0-2])$",` 四位年、减号、月份两位且只能是 01 到 09 或 10 到 12。Day 94 的 `check_month` 用四个条件加一次 `int()` 才做到的事,一条正则写完。
- `"description": "要开票的月份,格式 YYYY-MM,例如 2026-10",` 给人和模型看的说明,写上例子。
- `def validate_args(schema: dict, args: dict) -> list[str]:` 和 `check` 一样的套路,没开 `FORMAT_CHECKER`,因为这里没用 `format`。
- `check_month(month)` Day 94 的手写检查,对照用。
- `print("多传一个参数:", validate_args(BILL_ARGS_SCHEMA, {"month": "2026-10", "dry_run": True}))` 多余的 `dry_run` 被 `additionalProperties: false` 拦住。`check_month` 根本看不到这个参数,它只收一个字符串。
- `print("month 不是字符串:", validate_args(BILL_ARGS_SCHEMA, {"month": 202610}))` 传了数字。`check_month(202610)` 会在 `len(month)` 那一步直接 `TypeError` 崩掉,schema 则给一条正常的错误。

</div>

```text
2026-10  schema: 通过                                                           check_month: 通过
2026-13  schema: month: '2026-13' does not match '^\\d{4}-(0[1-9]|1[0-2])$'   check_month: ValueError: 月份要写成 YYYY-MM,收到 '2026-13'
202610   schema: month: '202610' does not match '^\\d{4}-(0[1-9]|1[0-2])$'    check_month: ValueError: 月份要写成 YYYY-MM,收到 '202610'
2026-1   schema: month: '2026-1' does not match '^\\d{4}-(0[1-9]|1[0-2])$'    check_month: ValueError: 月份要写成 YYYY-MM,收到 '2026-1'
abcd-ef  schema: month: 'abcd-ef' does not match '^\\d{4}-(0[1-9]|1[0-2])$'   check_month: ValueError: 月份要写成 YYYY-MM,收到 'abcd-ef'
2026-00  schema: month: '2026-00' does not match '^\\d{4}-(0[1-9]|1[0-2])$'   check_month: ValueError: 月份要写成 YYYY-MM,收到 '2026-00'
多传一个参数: ["(整体): Additional properties are not allowed ('dry_run' was unexpected)"]
month 不是字符串: ["month: 202610 is not of type 'string'"]
```

两边对五个坏月份的判断一致。schema 多管住了两件 `check_month` 管不到的事(多余参数、类型不对),而且这份 schema 能原样发给模型。但 `check_month` 的错误消息是中文、带指引,schema 的消息是英文的正则;以及有些规则 schema 表达不了,比如「月份不能早于客户注册月」要查数据库,只能写代码。所以实际的工具是两层:schema 管形状,代码管业务。Day 97 的小项目就是这个结构。

</details>

验收标准:五道题都在自己终端里跑通;能不看文章写出一份带 `required`、`enum`、`pattern`、`additionalProperties: false` 的对象 schema;能用 `iter_errors` 打印一份数据的全部错误并说出每条是哪个关键字判的;能说出「多余字段、`format`、关键字拼错」三个坑各自怎么防;`uv run pytest` 全部通过(39 个)。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| JSON Schema | 用 JSON 描述「一段 JSON 应该长什么样」的标准;本身就是一份 JSON(Python 里是字典) |
| 关键字(keyword) | schema 里的键,如 `type`、`required`、`enum`;每个关键字规定一种检查 |
| Draft 2020-12 | JSON Schema 规范的一个版本,按发布年月命名;`$schema` 字段声明用哪一版 |
| `type` | 数据的类型,七种之一:`string`、`number`、`integer`、`boolean`、`object`、`array`、`null`;可以写列表表示「几种之一」 |
| `properties` | 对象的每个字段各配一份 schema |
| `required` | 必填字段的名字列表,和 `properties` 平级;只管键在不在,不管值是不是 `null` |
| `additionalProperties` | 设成 `false` 表示 `properties` 里没列的字段不许出现;默认允许 |
| `enum` | 允许值的清单,相当于 Day 47 的 `Literal` |
| `minimum` / `maximum` / `exclusiveMinimum` / `exclusiveMaximum` | 数字范围,带 exclusive 的不含端点 |
| `minLength` / `maxLength` / `pattern` | 字符串长度和正则 |
| `items` / `maxItems` / `uniqueItems` | 数组每项的 schema、最大项数、不许重复 |
| `format` | 字符串的格式名(`email`、`date`、`uri` 等);默认只是注释,传 `format_checker` 才检查 |
| `title` / `description` / `default` | 注释性关键字,不参与检查,给人和模型看 |
| `jsonschema` | Python 里按 JSON Schema 检查数据的库,相当于前端的 ajv |
| `validate(data, schema)` | 先查 schema 合法,再查数据;遇错抛 `ValidationError` |
| `Draft202012Validator` | 校验器类,用 schema 造一次反复用;`iter_errors` 产出全部错误,`is_valid` 只回真假,`check_schema` 查 schema 本身 |
| `ValidationError` | 数据不合格的异常;`.message`、`.path`、`.validator`、`.instance`、`.validator_value` |
| `SchemaError` / `UnknownType` | schema 本身写错的异常;后者是跳过检查直接用、查到一半才发现 |
| `best_match` | 从一堆错误里挑最像根因的一个 |
| `model_json_schema()` | pydantic 模型导出 JSON Schema 的方法 |
| 转换 vs 判断 | pydantic 会把 `"66"` 转成 66.0 再放行;jsonschema 只判断类型,`"66"` 不是数字 |

## 常见误区

**没写 `additionalProperties: false`,以为多余字段会被拦。** 实测 `priority` 混进来照样通过。给工具参数写 schema 时一律加上这一行,模型编出来的参数名才会被发现。

**`format: "email"` 写了就以为会查。** 实测不传 `format_checker` 时 `"not-an-email"` 通过。造校验器时传 `format_checker=Draft202012Validator.FORMAT_CHECKER`。

**关键字拼错没有任何提示。** `requird`、`minimun` 被当成不认识的注释直接忽略,`check_schema` 也不报。写完 schema 一定拿一份故意不合格的数据去试,并写成测试。

**`required` 写进了字段里。** `"amount": {"type": "number", "required": true}` 是老版本的写法,现在的规范里 `required` 是对象层面的列表,写在字段里会被忽略。

**用 Python 的类型名。** `"type": "str"`、`"type": "int"` 都不对,实测抛 `SchemaError`;要写 `"string"`、`"integer"`。

**以为 `True` 是整数、`5.0` 不是。** 按 JSON 的规矩正好相反:`True` 对 `integer` 不通过,`5.0` 通过。

**`validate()` 只报了一个错就以为只有一个。** 它内部挑了一个最像根因的。想看全部用 `iter_errors`。

**`required` 能挡住 `null`。** 挡不住,`{"a": None}` 对 `required: ["a"]` 通过。要配 `type`。

**拿 jsonschema 的结果当 pydantic 的结果。** 同一份数据 `"amount": "66"`,jsonschema 拒绝、pydantic 放行。两者的态度不同,选哪个看场景,别混用后互相奇怪。

**`default` 会替你填值。** 不会,它只是说明。默认值要在代码里填。

## 学习资料

### 文档与文章

- [JSON Schema 官方 · Getting Started Step-By-Step(英文)](https://json-schema.org/learn/getting-started-step-by-step):用一个「产品」对象从零写 schema,和今天的工单例子一个套路。
- [Understanding JSON Schema(英文,官方在线书)](https://json-schema.org/understanding-json-schema):每个关键字一节,查 `type`、`string`、`numeric`、`object`、`array` 这几节就够今天用。
- [JSON Schema · What is JSON Schema?(英文)](https://json-schema.org/overview/what-is-jsonschema):一页说清它是什么、谁在用。
- [python-jsonschema 文档 · Schema Validation(英文)](https://python-jsonschema.readthedocs.io/en/stable/validate/):`validate`、`Draft202012Validator`、`iter_errors`、`format_checker` 的用法,今天所有 API 的出处。
- [pydantic 文档 · JSON Schema(英文)](https://docs.pydantic.dev/latest/concepts/json_schema/):`model_json_schema()` 的细节,第 5 步的延伸。
- [ajv 官网(英文)](https://ajv.js.org/):前端那边的同类库,看一眼它的例子你会发现和今天的代码几乎一样。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1HY411J7y1&autoplay=0&high_quality=1" title="我和JSON Schema的那些事" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Apifox · 我和JSON Schema的那些事 · 2 分钟,播放 3 万,2022 年发布。两分钟讲 JSON Schema 是干什么的,先看它再敲第 1 步。内容没有逐段核对,以文章里的实测为准。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV12r4y1b7GN&autoplay=0&high_quality=1" title="14.什么是json schema" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>JornaJan · 14.什么是json schema · 约 9 分钟,播放 3 千,2022 年发布。逐个关键字过一遍,对照第 3 步的地图看。同样没有逐段核对,和文章不一致处以文章为准。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/dtLl37W68g8" title="An Introduction to JSON Schema: A Practical Look" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Erik Wilde · An Introduction to JSON Schema: A Practical Look · 英文,可开字幕。JSON Schema 的实用入门,讲它在接口契约里的位置,Day 157 还会再推荐一次。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/68jT0VGUsC4" title="Introduction to JSON Schema by Julian Berman" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>PyCon Israel · Introduction to JSON Schema by Julian Berman · 英文。讲者就是 `jsonschema` 库的作者,从 Python 使用者的角度讲 schema,第 4 步的 `iter_errors`、`best_match` 都是他设计的。</figcaption>
</figure>

### 书籍

- Arnaud Lauret,《The Design of Web APIs》第二版,Manning,2025(英文)。Day 80 推荐过,它把 JSON Schema 放在接口契约的语境里讲,今天学完关键字再去读它讲「怎么描述请求体」的章节会很顺。没有查到中文版,只写英文原版。

### 开源项目与代码

- [python-jsonschema/jsonschema](https://github.com/python-jsonschema/jsonschema):今天用的库,README 里有最短的例子;想看 `is not of type` 这句话是在哪生成的,搜 `_keywords.py` 里的 `type` 函数。
- [json-schema-org/json-schema-spec](https://github.com/json-schema-org/json-schema-spec):规范本身的仓库,`additionalProperties` 为什么默认 true 这类问题,issue 里有讨论。

## 自测

1. 下面这份 schema 想表达「`amount` 必填且必须是数字」,它有什么问题?

```python
{"type": "object", "properties": {"amount": {"type": "number", "required": True}}}
```

<details><summary>答案</summary>

`required` 写错了位置。现在的规范里它是对象层面的**列表**,要写成 `{"type": "object", "properties": {"amount": {"type": "number"}}, "required": ["amount"]}`。写在字段里的 `required: True` 会被当成不认识的关键字忽略,缺 `amount` 的数据照样通过,而且没有任何报错。

</details>

2. 数据 `{"id": "T-1001", "title": "x", "amount": 10, "category": "billing", "note": "急"}` 对今天的 `TICKET_SCHEMA`,通过吗?去掉 `additionalProperties` 那一行呢?

<details><summary>答案</summary>

不通过:`note` 不在 `properties` 里,`additionalProperties: false` 拒绝它,报 `Additional properties are not allowed ('note' was unexpected)`。去掉那一行就通过,因为默认允许多余字段。

</details>

3. `validate(data, schema)` 和 `Draft202012Validator(schema).iter_errors(data)` 各在什么时候用?它们对「schema 本身写错」的反应有什么不同?

<details><summary>答案</summary>

`validate` 适合「不合格就停」的场景,遇错抛一个 `ValidationError`(内部挑了最像根因的那个);`iter_errors` 适合「把所有问题一次列全」,比如要把错误回给模型或用户。`validate` 会先检查 schema 合法性,写错 `type` 值时抛 `SchemaError`;直接用校验器类不检查 schema,错误会在查数据时以 `UnknownType` 之类的形式冒出来。两者对拼错的关键字名都不报错。

</details>

4. 为什么 pydantic 对 `{"amount": "66"}` 说通过,jsonschema 说不通过?各自的好处是什么?

<details><summary>答案</summary>

pydantic 的职责是「把外部数据变成可靠的 Python 对象」,所以能转的就转,`"66"` 转成 66.0;jsonschema 的职责是「判断一段 JSON 符不符合描述」,不改数据,字符串就不是数字。转换适合接表单、接模型输出;严格判断适合做接口契约和给模型的工具定义,也更容易被别的语言理解。

</details>

5. 面试题:你给模型写了一个工具,参数用 JSON Schema 描述得很清楚。模型调用时还是传了一个 schema 里没有的参数、一个超出范围的金额。你怎么处理?schema 还有必要写吗?

<details><summary>答案</summary>

schema 对模型是「说明书」,它大概率照做但不保证;所以参数回来后要用同一份 schema 在本地再查一次(`iter_errors`),把全部错误原样回给模型,让它改正后重试,而不是直接执行或直接崩掉。schema 当然有必要:写得清楚能把错误率压到很低,而且本地校验用的就是它,一份定义两处用,不会出现「说明书和验货单不一致」。另外 `additionalProperties: false` 要写,不然模型编的参数名根本查不出来。

</details>

6. 面试题:数据库表上已经有 `CHECK` 约束了,为什么接口层还要再写一份 schema?两份规则不一致了怎么办?

<details><summary>答案</summary>

数据库约束只在写入那一刻生效,报错是数据库的原话,而且一次只报第一个;接口层的 schema 在数据进门时就把形状查清,错误能定位到字段、一次报全、可以翻译成人话,还能发给调用方(前端、别的服务、模型)当契约。两层各守一道门,数据库是最后一道。不一致是真实风险,办法是:schema 尽量从一处生成(比如 pydantic 模型导出),配一个「拿库里所有行过一遍 schema」的对账脚本(今天练习 1 的做法),改表的同时改 schema 并跑测试。

</details>

## 明天预告

Day 96 · 装饰器:@ 到底干了什么。这几周你已经用过六个 `@`:Day 43 的 `@property`、Day 50 的 `@dataclass`、Day 52 的 `@field_validator`、Day 73 的 `@pytest.fixture`、Day 79 的 `@app.get("/")`、Day 93 的 `@contextmanager`,每次都是「先照着用,原理以后讲」。明天就是那个以后:`@` 只是一行等价写法,背后是「函数是一个值,可以传进去、再传出来」。你会亲手写一个计时装饰器,看到不加 `functools.wraps` 时函数名会变成 `wrapper`,再写一个像今天第 6 步那样「登记工具、顺便生成 schema」的 `@tool`,把今天和明天接在一起。
