---
title: 'Day 149 · 结构化输出(三):用 pydantic 定义 schema'
description: '把昨天手写的十几行 schema 字典换成一个 pydantic 类 RefundFields:model_json_schema() 一行生成 schema 发给服务端,model_validate_json() 一行完成本地校验,拿到的日期直接是 date,能交给 refund() 算钱。同一个类在硅基流动走 schema 约束、在 DeepSeek 官方写进提示词,两条路都实跑;再看把类写松了(给默认值、不禁多余字段)会生成什么样的 schema。'
pubDate: 2026-10-22
regime: none
tags: ['structured-output', 'pydantic', 'agent-zero']
series: 'agent-zero'
day: 149
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 148](/blog/agent-zero/day-148-structured-2/) 手写了一份 JSON Schema `REFUND_SCHEMA`,用 `jsonschema` 库在本地检查数据,又把同一份 schema 放进 `response_format` 发给硅基流动做约束解码。结论有三条:schema 管住了键名、类型、枚举和日期格式(「随口要 + schema」18 次格式全过);它管不了值(3 次把申请日期填成购买日期);提示词和 schema 要说同一件事(只在 schema 里允许 null,模型照样填 0)。

昨天的做法有个别扭的地方:一个约定写了三份。`REFUND_SCHEMA` 是一份,Day 147 手写的 `check()` 是一份,`to_refund()` 里把日期字符串转成 `date` 又是一份。哪天要加一个字段,三处都得改,漏一处就出 bug。今天把这三份合成一个 pydantic 类。

## 今天要解决的问题

学完今天你应该能做到:

1. 用 pydantic 写出 `RefundFields` 类,用 `model_json_schema()` 生成 JSON Schema,并说出它和昨天手写的 schema 有哪些不同。
2. 用 `model_validate_json()` 校验模型输出,看懂 `ValidationError` 的 `loc`、`type`、`msg`。
3. 把同一个类用在两种厂商上:支持 schema 约束的放进 `response_format`,不支持的(DeepSeek 官方)写进提示词。
4. 知道怎么写才能让生成的 schema 满足 strict 模式:`extra="forbid"`、不给默认值、可缺的字段用 `X | None`。

预计用时:2.5 小时。前置:[Day 51](/blog/agent-zero/day-051-pydantic-1/)(`BaseModel`、`ValidationError`)、[Day 52](/blog/agent-zero/day-052-pydantic-2/)(`Field`、`model_validate`、`model_dump`)、[Day 47](/blog/agent-zero/day-047-type-hints-3/)(`Literal`)、[Day 148](/blog/agent-zero/day-148-structured-2/)(`REFUND_SCHEMA`、`.env.sf`、`schema_edge.py` 里的 `schema_format()`)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `refund_model.py` 的 `RefundFields` 和 `schema_prompt.py` 的 `schema_prompt()`;再做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 一个类,三个用处

先回忆一下 pydantic 是什么。[Day 51](/blog/agent-zero/day-051-pydantic-1/) 把它比作前端的 zod:你写一个类,声明每个字段的类型,拿外部数据来构造它时,类型不对就抛 `ValidationError`,类型对的话还会帮你转换(比如把 `"2026-09-01"` 变成一个 `date` 对象)。

zod 用户可能知道 `zod-to-json-schema` 这个包:从 zod 定义生成 JSON Schema。pydantic 把这个能力直接内置了,就是今天的主角 `model_json_schema()`。于是一个类同时干了三件事:

- **生成 schema**,发给服务端做约束,或者写进提示词给模型看;
- **校验输出**,模型返回的 JSON 字符串一步变成对象,不合格就报错;
- **当类型用**,拿到的对象有补全、有类型检查,`info.bought` 直接就是 `date`。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="一个 pydantic 类的三个用处">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="230" y="20" width="180" height="60" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="242" y="44" fill="var(--ink)">class RefundFields</text>
<text x="242" y="64" fill="var(--ink-soft)">唯一的一份约定</text>
<line x1="270" y1="80" x2="130" y2="120" stroke="var(--ink-faint)"/>
<line x1="370" y1="80" x2="510" y2="120" stroke="var(--ink-faint)"/>
<rect x="20" y="120" width="220" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="144" fill="var(--ink)">model_json_schema()</text>
<text x="32" y="164" fill="var(--ink-soft)">→ response_format 或提示词</text>
<rect x="400" y="120" width="220" height="60" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="412" y="144" fill="var(--ink)">model_validate_json()</text>
<text x="412" y="164" fill="var(--ink-soft)">模型输出 → 对象 / 报错</text>
<line x1="240" y1="150" x2="400" y2="150" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
<text x="268" y="142" fill="var(--ink-faint)">模型生成 JSON</text>
<rect x="400" y="200" width="220" height="36" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="412" y="223" fill="var(--ink)">refund(info.plan, …)</text>
<line x1="510" y1="180" x2="510" y2="200" stroke="var(--ink-faint)"/>
<text x="20" y="223" fill="var(--ink-soft)">加字段只改类,三处一起变</text>
</g>
</svg>
<figcaption>左边生成 schema 交给模型(蓝色是模型那一侧),右边校验模型的输出,校验出来的对象直接交给代码。三件事都从同一个类出发。</figcaption>
</figure>

## 第一步:写 RefundFields

pydantic 已经在环境里了:openai SDK 依赖它,装 openai 时顺带装上了。今天要直接 import 它,所以把它写进自己的依赖,免得哪天 openai 换了依赖你的代码就坏了:

```bash
cd agent-zero-lab
uv add pydantic
```

2026 年 10 月查到的最新版是 2.14.1,`pyproject.toml` 多一行 `"pydantic>=2.14.1"`。新建 `part02/refund_model.py`:

```python
# agent-zero-lab/part02/refund_model.py
import json
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class RefundFields(BaseModel):
    """从一张退款工单里抽出的四个字段。"""

    model_config = ConfigDict(extra="forbid")

    plan: Literal["年付", "月付"] = Field(description="套餐类型")
    paid: int = Field(description="实付金额,单位元")
    bought: date = Field(description="购买日期")
    asked: date = Field(description="申请退款的日期")


if __name__ == "__main__":
    print(json.dumps(RefundFields.model_json_schema(), ensure_ascii=False, indent=2))
```

<div class="line-notes">

- `from datetime import date` 标准库的日期类型。字段直接标成 `date`,pydantic 校验时会把 `"2026-09-01"` 这种字符串转成 `date(2026, 9, 1)`。
- `from typing import Literal` [Day 47](/blog/agent-zero/day-047-type-hints-3/) 学过,`Literal["年付", "月付"]` 相当于 TS 的 `"年付" | "月付"`。
- `from pydantic import BaseModel, ConfigDict, Field` 三个都在 Day 51–52 用过。`ConfigDict` 是给整个类设置选项用的。
- `class RefundFields(BaseModel):` 继承 `BaseModel` 就是一个 pydantic 模型。类名会变成 schema 的 `title`。
- `"""从一张退款工单里抽出的四个字段。"""` 类的文档字符串会变成 schema 最外层的 `description`。模型能看到它,所以写给模型看的话可以写在这里。
- `model_config = ConfigDict(extra="forbid")` 收到类里没声明的字段就报错。它在 schema 里对应 `"additionalProperties": false`,昨天说过 strict 模式要求这一条。不写的话,pydantic 默认是 `extra="ignore"`:多余字段悄悄丢掉,schema 里也没有这一行。
- `plan: Literal["年付", "月付"] = Field(description="套餐类型")` 类型决定 schema 的 `type` 和 `enum`,`Field(description=...)` 决定 `description`。注意 `Field()` 里没有写默认值,所以这个字段**必填**。
- `paid: int = Field(description="实付金额,单位元")` `int` 生成 `"type": "integer"`。
- `bought: date = Field(description="购买日期")` `date` 生成 `"type": "string", "format": "date"`。不用再自己写日期正则。
- `print(json.dumps(RefundFields.model_json_schema()` `model_json_schema()` 是类方法,直接在类上调,不用先造一个对象。返回一个普通字典,和昨天的 `REFUND_SCHEMA` 同一种东西。

</div>

```bash
uv run python -m part02.refund_model
```

```text
{
  "additionalProperties": false,
  "description": "从一张退款工单里抽出的四个字段。",
  "properties": {
    "plan": {
      "description": "套餐类型",
      "enum": [
        "年付",
        "月付"
      ],
      "title": "Plan",
      "type": "string"
    },
    "paid": {
      "description": "实付金额,单位元",
      "title": "Paid",
      "type": "integer"
    },
    "bought": {
      "description": "购买日期",
      "format": "date",
      "title": "Bought",
      "type": "string"
    },
    "asked": {
      "description": "申请退款的日期",
      "format": "date",
      "title": "Asked",
      "type": "string"
    }
  },
  "required": [
    "plan",
    "paid",
    "bought",
    "asked"
  ],
  "title": "RefundFields",
  "type": "object"
}
```

十行 Python 生成了这一大段。

## 第二步:和手写的 schema 对一对

把它和 [Day 148](/blog/agent-zero/day-148-structured-2/) 的 `REFUND_SCHEMA` 放在一起看:

| 地方 | 昨天手写 | pydantic 生成 |
| --- | --- | --- |
| 字段和必填 | 四个字段全在 `required` | 一样,因为四个字段都没给默认值 |
| 枚举 | `"enum": ["年付", "月付"]` | 一样,来自 `Literal` |
| 整数 | `"type": "integer"` | 一样,来自 `int` |
| 日期 | `"pattern": "^\\d{4}-\\d{2}-\\d{2}$"` | `"format": "date"` |
| 多余字段 | `"additionalProperties": false` | 一样,来自 `extra="forbid"` |
| 名字 | 没有 | 每个字段多一个 `title`(字段名首字母大写),最外层 `title` 是类名 |
| 整体说明 | 没有 | 最外层 `description` 来自类的文档字符串 |

真正的区别只有日期这一行。`format: date` 是 JSON Schema 规范里的标准写法,意思是「这个字符串是一个 RFC 3339 格式的日期」,也就是 `YYYY-MM-DD`。昨天说过很多校验器默认不检查 `format`,但这里不怕:本地校验用的是 pydantic 自己,它看的是 Python 类型 `date`,不是 schema 里的 `format`。至于服务端认不认 `format`,下一步实测。

另一个小区别:打印出来的键是按字母排的(`additionalProperties` 在最前面,`type` 在最后),这是 pydantic 生成 schema 时的习惯,不影响意思。`properties` 里四个字段的顺序没被排,还是类里写的顺序。

## 第三步:本地校验 model_validate_json

[Day 52](/blog/agent-zero/day-052-pydantic-2/) 用过 `model_validate(dict)`,今天用它的兄弟 `model_validate_json(str)`:直接吃 JSON 字符串,解析和校验一步完成。拿昨天那几份数据过一遍,外加两份新的。新建 `part02/model_check.py`:

```python
# agent-zero-lab/part02/model_check.py
from pydantic import ValidationError

from part02.json_check import FENCE
from part02.refund_model import RefundFields

SAMPLES = {
    "全对": '{"plan": "年付", "paid": 2388, "bought": "2026-09-01", "asked": "2026-10-20"}',
    "值不对": '{"plan": "年费会员", "paid": "2388元", "bought": "2026-9-1", "asked": "2026-10-20"}',
    "多一个键": '{"plan": "年付", "paid": 2388, "bought": "2026-09-01", "asked": "2026-10-20", "note": "急"}',
    "带代码块": FENCE + 'json\n{"plan": "年付"}\n' + FENCE,
    "金额是字符串": '{"plan": "年付", "paid": "2388", "bought": "2026-09-01", "asked": "2026-10-20"}',
}

for name, text in SAMPLES.items():
    try:
        info = RefundFields.model_validate_json(text)
        print(f"{name}: 通过 → {info!r}")
    except ValidationError as e:
        print(f"{name}: {e.error_count()} 个错误")
        for err in e.errors():
            print(f"    {err['loc']} {err['type']}: {err['msg']}")
```

<div class="line-notes">

- `from pydantic import ValidationError` 校验失败抛的异常。JSON 本身不合法也是它,不是 `json.JSONDecodeError`。
- `SAMPLES = {` 这次每份数据都是**字符串**,因为模型返回的就是字符串。
- `"带代码块": FENCE + 'json` Day 147 第一步真模型的样子,开头是三个反引号。`FENCE` 是 Day 147 在 `json_check.py` 里定义的三个反引号,写成这样是为了不和文章的代码块打架。
- `"金额是字符串": '{"plan": "年付", "paid": "2388"` 金额是带引号的 `"2388"`,不是数字 `2388`。猜一下会不会通过。
- `info = RefundFields.model_validate_json(text)` 一步做三件事:`json.loads`、按类型检查、构造对象。相当于 zod 的 `Schema.parse(JSON.parse(text))`,只是 JSON 解析错误也包成了同一种异常。
- `print(f"{name}: 通过 → {info!r}")` `!r` 打印对象的 `repr`,能看到每个字段的值和类型。
- `e.error_count()` 一共几个错误。
- `for err in e.errors():` `errors()` 返回一个列表,每个错误是一个字典。最常用三个键:`loc` 是出错的位置(字段名组成的元组),`type` 是错误类型的机器名,`msg` 是给人看的说明。

</div>

```bash
uv run python -m part02.model_check
```

```text
全对: 通过 → RefundFields(plan='年付', paid=2388, bought=datetime.date(2026, 9, 1), asked=datetime.date(2026, 10, 20))
值不对: 3 个错误
    ('plan',) literal_error: Input should be '年付' or '月付'
    ('paid',) int_parsing: Input should be a valid integer, unable to parse string as an integer
    ('bought',) date_from_datetime_parsing: Input should be a valid date or datetime, input is too short
多一个键: 1 个错误
    ('note',) extra_forbidden: Extra inputs are not permitted
带代码块: 1 个错误
    () json_invalid: Invalid JSON: expected value at line 1 column 1
金额是字符串: 通过 → RefundFields(plan='年付', paid=2388, bought=datetime.date(2026, 9, 1), asked=datetime.date(2026, 10, 20))
```

几个值得停下来看的地方。

「全对」那行,`bought=datetime.date(2026, 9, 1)`:日期已经是 `date` 对象了。Day 147 的 `to_refund()` 里那两个 `date.fromisoformat` 可以删了。

「值不对」三个错误和昨天 `jsonschema` 报的一一对应,只是说法不同。`2026-9-1` 被拦下,报的是「input is too short」:pydantic 解析日期要求严格的 `YYYY-MM-DD`,少一位就算太短。

「带代码块」那行 `loc` 是空元组 `()`,意思是错误不在任何一个字段上,而是整个输入都不是 JSON。

**「金额是字符串」通过了,`paid=2388` 是整数。** 这是 pydantic 默认的「宽松模式」(lax mode):`"2388"` 这种能无损转成整数的字符串,它会帮你转。前端表单提交上来的数字常常是字符串,这个行为很贴心;但对模型输出来说就看情况了:模型写 `"2388"` 说明它没按 schema 来,你可能想知道这件事。练习 2 演示怎么关掉宽松模式。`"2388元"` 转不了,所以「值不对」那行还是报错了。

## 第四步:把生成的 schema 交给服务端

在硅基流动上重跑昨天的实验,区别只有两处:schema 换成 `RefundFields.model_json_schema()`,校验换成 `model_validate_json()`。新建 `part02/model_run.py`:

```python
# agent-zero-lab/part02/model_run.py
from pydantic import ValidationError

from common.llm import LLMClient
from part02.extract_compare import ASK, SPEC
from part02.messy_tickets import MESSY
from part02.refund_calc import refund
from part02.refund_model import RefundFields
from part02.schema_edge import schema_format

ROUNDS = 3


def money(info: RefundFields) -> int:
    return refund(info.plan, info.paid, info.bought, info.asked)


def main() -> None:
    client = LLMClient(env_file=".env.sf")
    fmt = schema_format(RefundFields.model_json_schema())
    for name, system in (("随口要", ASK), ("求它", SPEC)):
        ok = 0
        seen: dict[str, int] = {}
        for _ in range(ROUNDS):
            for ticket, gold in MESSY:
                r = client.chat(
                    [{"role": "system", "content": system}, {"role": "user", "content": ticket}],
                    temperature=0,
                    max_tokens=300,
                    response_format=fmt,
                )
                try:
                    info = RefundFields.model_validate_json(r.content)
                except ValidationError as e:
                    key = f"校验失败: {e.errors()[0]['msg']}"
                else:
                    expected = money(RefundFields.model_validate(gold))
                    if money(info) == expected:
                        ok += 1
                        continue
                    key = f"退 {money(info)} 应为 {expected}: {info!r}"
                seen[key] = seen.get(key, 0) + 1
        print(f"{name}+pydantic schema: 能用 {ok}/{ROUNDS * len(MESSY)}")
        for problem, count in seen.items():
            print(f"    {problem} ×{count}")
    print(client.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from part02.schema_edge import schema_format` Day 148 写的小函数,把任意 schema 包成 `{"type": "json_schema", "json_schema": {...}}`。
- `def money(info: RefundFields) -> int:` 取代 Day 147 的 `to_refund()`。参数是对象,`info.bought` 已经是 `date`,不用再转。编辑器里敲 `info.` 会弹出四个字段的补全,这就是「当类型用」。
- `fmt = schema_format(RefundFields.model_json_schema())` schema 只生成一次,放在循环外面。
- `info = RefundFields.model_validate_json(r.content)` 校验模型的输出。
- `except ValidationError as e:` 不合格就记下第一个错误的说明。
- `else:` `try` 里没有抛异常时才走这里。`try/except/else` 的 `else` 相当于「成功分支」,比把后面的代码都塞进 `try` 里清楚:这样 `money()` 里要是出了别的错,不会被上面的 `except` 误接住。
- `expected = money(RefundFields.model_validate(gold))` 正确答案 `gold` 是 Day 147 `messy_tickets.py` 里的字典,日期是字符串。`model_validate` 吃字典,顺手把字符串日期转成 `date`。用同一个类处理标准答案,比自己再写一遍转换可靠。
- `key = f"退 {money(info)} 应为 {expected}: {info!r}"` 格式过了但钱算错,把错的金额、正确金额和对象都记下来。
- `print(client.ledger)` 实测 `36 次调用 | 输入 3162 / 输出 1444 tokens | 约 ¥0.0225`。

</div>

```bash
uv run python -m part02.model_run
```

我的输出(2026-10-22 晚上,硅基流动 DeepSeek-V4-Flash,关思考):

```text
随口要+pydantic schema: 能用 15/18
    退 2388 应为 1871: RefundFields(plan='年付', paid=2388, bought=datetime.date(2026, 9, 1), asked=datetime.date(2026, 9, 1)) ×3
求它+pydantic schema: 能用 18/18
36 次调用 | 输入 3162 / 输出 1444 tokens | 约 ¥0.0225
```

和昨天手写 schema 的结果一模一样:「随口要」15/18,错的还是第 1 张工单的申请日期;「求它」18/18。这正是想要的结果:**换成 pydantic 生成的 schema,行为没变,代码少了一大截**。服务端也接受了 `format: date` 和 `title`,没有报错。

错误那一行现在读起来也舒服多了:`asked=datetime.date(2026, 9, 1)` 一眼就能看出申请日期和购买日期一样。

## 第五步:DeepSeek 官方怎么办

DeepSeek 官方的 `response_format` 不收 `json_schema`。办法是退回第二层:开 JSON mode,把 schema 写进提示词给模型看,本地再用 pydantic 校验。这时 `model_json_schema()` 的第二个用处就派上了。新建 `part02/schema_prompt.py`:

```python
# agent-zero-lab/part02/schema_prompt.py
import json

from pydantic import BaseModel, ValidationError

from common.llm import LLMClient
from part02.extract_compare import ASK
from part02.messy_tickets import MESSY
from part02.model_run import money
from part02.refund_model import RefundFields


def schema_prompt(model: type[BaseModel]) -> str:
    schema = json.dumps(model.model_json_schema(), ensure_ascii=False)
    return f"只输出一个 json 对象,不要 markdown 代码块,不要解释。它必须符合这份 JSON Schema:\n<schema>\n{schema}\n</schema>"


if __name__ == "__main__":
    system = ASK + "\n\n" + schema_prompt(RefundFields)
    print(system)
    print("-----")
    client = LLMClient()
    ok, last = 0, ""
    for _ in range(3):
        for ticket, gold in MESSY:
            r = client.chat(
                [{"role": "system", "content": system}, {"role": "user", "content": ticket}],
                temperature=0,
                max_tokens=300,
                response_format={"type": "json_object"},
            )
            last = r.content
            try:
                info = RefundFields.model_validate_json(r.content)
            except ValidationError as e:
                print("校验失败:", e.errors()[0]["msg"], repr(r.content))
                continue
            if money(info) == money(RefundFields.model_validate(gold)):
                ok += 1
            else:
                print("抽错了:", repr(info))
    print("最后一次的原始输出:", last)
    print(f"DeepSeek 官方 + schema 写进提示词: 能用 {ok}/18")
    print(client.ledger)
```

<div class="line-notes">

- `from part02.model_run import money` 复用上一步的算钱函数。`model_run.py` 的调用在 `main()` 里,import 不会跑 API。
- `def schema_prompt(model: type[BaseModel]) -> str:` `type[BaseModel]` 表示参数是「类本身」,不是对象:调用时传 `RefundFields`,不是 `RefundFields(...)`。任何 pydantic 类都能传进来,明天的通用函数就靠它。
- `schema = json.dumps(model.model_json_schema(), ensure_ascii=False)` 这次不缩进,写成一行,省 token。
- `"只输出一个 json 对象` 小写的 json 这个词必须有,否则 DeepSeek 的 JSON mode 直接 400(Day 147 演示过)。schema 用 `<schema>` 标签包起来,和指令分开,这是 [Day 143](/blog/agent-zero/day-143-prompt-5/) 学的标签分隔。
- `system = ASK + "\n\n" + schema_prompt(RefundFields)` 前面是「随口要」那句,后面接上 schema。和第四步的「随口要」对比,唯一的区别是 schema 从 `response_format` 挪进了提示词。
- `client = LLMClient()` 不传 `env_file`,读默认的 `.env`,也就是 DeepSeek 官方。
- `response_format={"type": "json_object"},` 第二层,保证是合法 JSON。
- `last = r.content` 记下最后一次的原始输出,循环完打印出来看键的顺序。
- `if money(info) == money(RefundFields.model_validate(gold)):` 和上一步同一套判断。

</div>

```bash
uv run python -m part02.schema_prompt
```

```text
把客户工单里的套餐类型、实付金额、购买日期、申请日期整理成 JSON。

只输出一个 json 对象,不要 markdown 代码块,不要解释。它必须符合这份 JSON Schema:
<schema>
{"additionalProperties": false, "description": "从一张退款工单里抽出的四个字段。", "properties": {"plan": {"description": "套餐类型", "enum": ["年付", "月付"], "title": "Plan", "type": "string"}, "paid": {"description": "实付金额,单位元", "title": "Paid", "type": "integer"}, "bought": {"description": "购买日期", "format": "date", "title": "Bought", "type": "string"}, "asked": {"description": "申请退款的日期", "format": "date", "title": "Asked", "type": "string"}}, "required": ["plan", "paid", "bought", "asked"], "title": "RefundFields", "type": "object"}
</schema>
-----
最后一次的原始输出: {"plan":"年付","paid":960,"bought":"2025-12-05","asked":"2026-08-28"}
DeepSeek 官方 + schema 写进提示词: 能用 18/18
18 次调用 | 输入 5145 / 输出 534 tokens | 约 ¥0.0100
```

18/18。有意思的是,这里提示词前半句还是「随口要」那句,却没有出现第四步那 3 次申请日期抽错。看「最后一次的原始输出」:键的顺序是 `plan`、`paid`、`bought`、`asked`,跟着 schema 里写的顺序走,先写 `bought` 再写 `asked`。昨天硅基流动的 schema 约束按字母序先写 `asked`,今天 DeepSeek 照着提示词里的 schema 自己写,顺序就是自然的。我还单独打印过第 1 张工单的输出,是 `{"plan":"年付","paid":2388,"bought":"2026-09-01","asked":"2026-10-20"}`,申请日期对了。

这不是说「写进提示词」比「服务端约束」更好。服务端约束保证格式,这条路只是 18 次碰巧都照做了,没有任何东西保证第 19 次不写成中文键。它说明的是:**字段生成的顺序会影响值,而顺序由谁决定,各家不一样**。

代价也要看一眼:输入 5145 个 token,平均每次 286 个,比第四步每次 88 个多出两百个,多的就是提示词里那一长串 schema。DeepSeek 有前缀缓存([Day 124](/blog/agent-zero/day-124-cost/) 讲过),system 每次一样,后面的调用大部分能命中缓存,实际花费 ¥0.0100,不贵。

## 第六步:类写松了会怎样

到目前为止 `RefundFields` 写得很「紧」:没默认值、禁了多余字段。很多人写 pydantic 的习惯是给可选字段一个默认值 `= None`,也不写 `extra="forbid"`。这样的类生成的 schema 长什么样,服务端又怎么处理?新建 `part02/loose_schema.py`:

```python
# agent-zero-lab/part02/loose_schema.py
import json
from datetime import date
from typing import Literal

from pydantic import BaseModel

from common.llm import LLMClient
from part02.extract_compare import ASK
from part02.extract_edge import EDGE
from part02.messy_tickets import MESSY
from part02.schema_edge import schema_format


class LooseFields(BaseModel):
    plan: Literal["年付", "月付"]
    paid: int | None = None
    bought: date
    asked: date


if __name__ == "__main__":
    schema = LooseFields.model_json_schema()
    print("additionalProperties:", schema.get("additionalProperties"), " required:", schema["required"])
    client = LLMClient(env_file=".env.sf")
    for ticket in (EDGE[0][1], MESSY[0][0]):
        r = client.chat(
            [{"role": "system", "content": ASK}, {"role": "user", "content": ticket}],
            temperature=0,
            max_tokens=300,
            response_format=schema_format(schema),
        )
        print(json.loads(r.content))
    print(client.ledger)
```

<div class="line-notes">

- `class LooseFields(BaseModel):` 没有 `model_config`,也就是默认的 `extra="ignore"`。
- `paid: int | None = None` 可以是整数或 `None`,**默认值是 `None`**。有默认值的字段在 pydantic 里就不是必填的。
- `print("additionalProperties:", schema.get("additionalProperties")` 用 `.get()` 是因为这个键可能根本不存在,`schema["additionalProperties"]` 会抛 `KeyError`。实测打印 `None`,说明生成的 schema 里没有这一行。同一行后半段打印 `required`,实测 `['plan', 'bought', 'asked']`,`paid` 不在里面。
- `for ticket in (EDGE[0][1], MESSY[0][0]):` 两张工单:「多少钱我忘了」和第 1 张正常的。
- `response_format=schema_format(schema),` 这份不满足 strict 要求的 schema,照样带着 `strict: True` 发出去,看服务端收不收。

</div>

```bash
uv run python -m part02.loose_schema
```

```text
additionalProperties: None  required: ['plan', 'bought', 'asked']
{'asked': '2026-10-20', 'bought': '2026-09-01', 'paid': None, 'plan': '年付'}
{'asked': '2026-10-20', 'bought': '2026-09-01', 'paid': 2388, 'plan': '年付'}
2 次调用 | 输入 113 / 输出 88 tokens | 约 ¥0.0011
```

硅基流动没报错,照单全收了,「忘了金额」那张还填了 `null`。看起来挺好?问题在于换一家就不一定了:Day 148 查过 OpenAI 的 strict 规则,**每个字段都必须在 `required` 里,对象必须 `additionalProperties: false`**,这份 schema 两条都不满足,按文档会被拒。我没有 OpenAI 的 key,这一点没实跑。同一个类在一家能用、换一家就 400,这种坑最好在写类的时候就避开。

顺带一提,第 1 张工单这次 `asked` 填对了,第四步同样「随口要」时它 3 次全错。这份 schema 没有 `description` 和 `title`,发给模型的输入变了,它的生成路径也跟着变了。我没有深究具体原因,能确定的是:这种值上的错时有时无,一两次结果说明不了问题,要靠多跑几轮、多准备几张工单去量。

所以给模型用的 pydantic 类,我的写法固定是三条:

- **`model_config = ConfigDict(extra="forbid")`**,生成 `additionalProperties: false`;
- **所有字段都不给默认值**,全部进 `required`;
- **可能缺的字段写成 `X | None`,也不给默认值**,模型必须写出这个键,值可以是 `null`。练习 1 会看这种写法生成的 schema。

## 第七步:openai SDK 的 parse

还有一个省事的写法值得知道。openai 的 Python SDK 提供 `client.chat.completions.parse()`,`response_format` 直接传 pydantic 类,SDK 帮你做两件事:把类转成 strict 的 JSON Schema 放进请求;拿到回复后用这个类校验,结果放在 `message.parsed` 里。它就是把第四步那几行打包了。新建 `part02/sdk_parse.py`:

```python
# agent-zero-lab/part02/sdk_parse.py
from common.llm import LLMClient
from part02.extract_compare import SPEC
from part02.messy_tickets import MESSY
from part02.refund_model import RefundFields

llm = LLMClient(env_file=".env.sf")
ticket, _ = MESSY[0]
completion = llm.client.chat.completions.parse(
    model=llm.model,
    messages=[{"role": "system", "content": SPEC}, {"role": "user", "content": ticket}],
    temperature=0,
    max_tokens=300,
    response_format=RefundFields,
    extra_body=llm.extra_body,
)
msg = completion.choices[0].message
print("content:", msg.content)
print("parsed:", repr(msg.parsed))
```

<div class="line-notes">

- `llm = LLMClient(env_file=".env.sf")` 只借用它读好的配置。`LLMClient.chat()` 不支持 `parse`,所以下面直接用里面的 openai 客户端 `llm.client`。这样调用不会记进 `llm.ledger`,只有一次调用,不到 1 厘钱。
- `completion = llm.client.chat.completions.parse(` 和平时的 `.create(` 只差一个词。
- `model=llm.model,` 直接调 SDK 时模型名要自己传,这里用 `.env.sf` 里读到的 `deepseek-ai/DeepSeek-V4-Flash`。
- `response_format=RefundFields,` 传的是类,不是字典。SDK 内部会生成 schema 并包成 `json_schema` 格式。
- `extra_body=llm.extra_body,` 把「关思考」那一项带上,`LLMClient.chat()` 平时会自动帮你加,直接用 SDK 就得自己加。
- `print("parsed:", repr(msg.parsed))` `parsed` 是已经校验好的 `RefundFields` 对象。

</div>

```bash
uv run python -m part02.sdk_parse
```

```text
content: {"asked": "2026-10-20", "bought": "2026-09-01", "paid": 2388, "plan": "年付"}
parsed: RefundFields(plan='年付', paid=2388, bought=datetime.date(2026, 9, 1), asked=datetime.date(2026, 10, 20))
```

在硅基流动上能用。同一个脚本把 `env_file` 去掉、改连 DeepSeek 官方,结果是:

```text
openai.BadRequestError: Error code: 400 - {'error': {'message': 'This response_format type is unavailable now (request_id: deb717fd-…)', 'type': 'invalid_request_error', 'param': None, 'code': 'invalid_request_error'}}
```

和 Day 147 那个 400 一字不差,因为 `parse()` 发出去的就是 `json_schema`。所以 `parse()` 只适合支持第三层的厂商。我们的课默认用 DeepSeek,后面的代码不靠它,而是自己写一个两边都能用的函数,明天就写。

## 动手练习

练习 1、2 不调 API;练习 3 调 2 次 DeepSeek,不到 2 厘钱。

**练习 1:两种「可以没有」的写法,schema 差在哪?** 写两个类,都只有一个字段 `paid: int | None`,一个不给默认值,一个默认值是 `None`。分别打印 schema 的 `required` 和 `paid` 的定义,再试试用空字典 `{}` 去 `model_validate`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex149_optional.py
from pydantic import BaseModel, Field


class MustAnswer(BaseModel):
    paid: int | None = Field(description="实付金额;没写就填 null")


class MayOmit(BaseModel):
    paid: int | None = Field(None, description="实付金额;没写就填 null")


for model in (MustAnswer, MayOmit):
    s = model.model_json_schema()
    print(model.__name__, "required =", s.get("required"), "paid =", s["properties"]["paid"])
    print("    不传 paid:", end=" ")
    try:
        print(repr(model.model_validate({})))
    except Exception as e:
        print(type(e).__name__, str(e).splitlines()[1:3])
```

<div class="line-notes">

- `paid: int | None = Field(description=` `Field()` 第一个参数没写,没有默认值,所以必填,只是值可以是 `None`。
- `paid: int | None = Field(None, description=` 第一个参数 `None` 是默认值,有了默认值就不必填。
- `print(model.__name__, "required =", s.get("required")` `__name__` 是类的名字。`MayOmit` 没有必填字段,schema 里干脆没有 `required` 这个键,所以用 `.get()`。
- `print("    不传 paid:", end=" ")` `end=" "` 让 `print` 结尾不换行,下一个 `print` 接在同一行,相当于 JS 里 `process.stdout.write`。
- `str(e).splitlines()[1:3]` 错误信息有好几行,只取第 2、3 行,看个大概。

</div>

```bash
uv run python -m part02.ex149_optional
```

```text
MustAnswer required = ['paid'] paid = {'anyOf': [{'type': 'integer'}, {'type': 'null'}], 'description': '实付金额;没写就填 null', 'title': 'Paid'}
    不传 paid: ValidationError ['paid', '  Field required [type=missing, input_value={}, input_type=dict]']
MayOmit required = None paid = {'anyOf': [{'type': 'integer'}, {'type': 'null'}], 'default': None, 'description': '实付金额;没写就填 null', 'title': 'Paid'}
    不传 paid: MayOmit(paid=None)
```

两种写法的 `paid` 都是 `anyOf: [integer, null]`(「两者之一」,和 Day 148 写的 `"type": ["integer", "null"]` 意思一样,只是写法不同)。区别在 `required`:`MustAnswer` 有,`MayOmit` 没有,还多了一个 `"default": null`。给模型用的类选 `MustAnswer` 这种:strict 模式要求它,而且模型必须把 `paid` 这个键写出来,你能区分「模型说没有金额(null)」和「模型压根忘了这个字段」。

</details>

**练习 2:关掉宽松模式。** 第三步看到 `"paid": "2388"` 被悄悄转成了 2388。写一个 `StrictRefundFields`,在 `RefundFields` 的基础上加 `strict=True`,用同一个字符串校验,对比两个类的结果。日期字段在严格模式下还能从字符串解析吗?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex149_strict.py
from pydantic import ConfigDict, ValidationError

from part02.refund_model import RefundFields


class StrictRefundFields(RefundFields):
    model_config = ConfigDict(extra="forbid", strict=True)


text = '{"plan": "年付", "paid": "2388", "bought": "2026-09-01", "asked": "2026-10-20"}'
for model in (RefundFields, StrictRefundFields):
    try:
        print(model.__name__, "通过:", repr(model.model_validate_json(text)))
    except ValidationError as e:
        print(model.__name__, "失败:", [(err["loc"], err["msg"]) for err in e.errors()])
```

<div class="line-notes">

- `class StrictRefundFields(RefundFields):` 继承就能拿到父类的四个字段,只改配置。
- `model_config = ConfigDict(extra="forbid", strict=True)` 子类的 `model_config` 会和父类的合并,这里把 `extra="forbid"` 也写上是为了一眼看全。`strict=True` 关掉类型之间的自动转换。
- `text = '{"plan": "年付", "paid": "2388"` 金额是字符串。
- `[(err["loc"], err["msg"]) for err in e.errors()]` 每个错误只取位置和说明,拼成元组列表。

</div>

```bash
uv run python -m part02.ex149_strict
```

```text
RefundFields 通过: RefundFields(plan='年付', paid=2388, bought=datetime.date(2026, 9, 1), asked=datetime.date(2026, 10, 20))
StrictRefundFields 失败: [(('paid',), 'Input should be a valid integer')]
```

严格模式下 `"2388"` 被拦下,只有这一个错误,两个日期照样通过了。因为 JSON 里根本没有「日期」这种类型,日期只能写成字符串,pydantic 的严格模式在解析 JSON 时专门允许 `date` 从 ISO 格式字符串来。要不要开严格模式是个取舍:开了能更早发现模型没按 schema 输出(这时候可以把错误喂回去让它改,明天的内容);不开则多一分容错。我做抽取任务一般开着,配合明天的重试。

</details>

**练习 3:金额可能没写的完整处理。** 写一个 `RefundFieldsMaybe`:和 `RefundFields` 一样,只是 `paid` 改成 `int | None`、不给默认值、说明里写「没写就填 null」。在 DeepSeek 官方上用 `schema_prompt()` 对「忘了金额」和第 1 张工单各跑一次,再写一个 `handle()`:金额是 `None` 时返回「转人工」,否则返回退款金额。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex149_null.py
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from common.llm import LLMClient
from part02.extract_edge import EDGE
from part02.messy_tickets import MESSY
from part02.refund_calc import refund
from part02.schema_prompt import schema_prompt


class RefundFieldsMaybe(BaseModel):
    """从一张退款工单里抽出的四个字段,金额可能没写。"""

    model_config = ConfigDict(extra="forbid")

    plan: Literal["年付", "月付"] = Field(description="套餐类型")
    paid: int | None = Field(description="实付金额,单位元;工单里没写金额就填 null,不要猜")
    bought: date = Field(description="购买日期")
    asked: date = Field(description="申请退款的日期")


def handle(info: RefundFieldsMaybe) -> str:
    if info.paid is None:
        return "转人工:工单里没有金额,请客服向客户确认"
    return f"退款 {refund(info.plan, info.paid, info.bought, info.asked)} 元"


client = LLMClient()
system = "从客户的退款工单里抽出四个字段。\n\n" + schema_prompt(RefundFieldsMaybe)
for ticket in (EDGE[0][1], MESSY[0][0]):
    r = client.chat(
        [{"role": "system", "content": system}, {"role": "user", "content": ticket}],
        temperature=0,
        max_tokens=300,
        response_format={"type": "json_object"},
    )
    info = RefundFieldsMaybe.model_validate_json(r.content)
    print(repr(info.paid), "→", handle(info))
print(client.ledger)
```

<div class="line-notes">

- `class RefundFieldsMaybe(BaseModel):` 为什么不继承 `RefundFields` 只改 `paid`?我第一次就是这么写的,basedpyright 报 `Override type "int | None" is not the same as base type "int"`:子类把父类字段的类型放宽了,用父类的地方可能接到 `None`,类型检查器不允许。所以单独写一个类。
- `paid: int | None = Field(description="实付金额,单位元;工单里没写金额就填 null,不要猜")` 练习 1 的 `MustAnswer` 写法:必填,值可以是 null。说明里写清楚什么时候填 null,Day 148 证明了这句话不能省。
- `def handle(info: RefundFieldsMaybe) -> str:` 业务逻辑分两支。
- `if info.paid is None:` 判断 `None` 要用 `is None`,不要写 `if not info.paid`:金额是 0 的话 `not 0` 也是真,会被误判成「没写」。
- `return f"退款 {refund(info.plan, info.paid` 走到这里时类型检查器知道 `info.paid` 一定是 `int` 了(上面的 `if` 把 `None` 排除了),这叫类型收窄,TS 里 `if (x === null) return` 之后 `x` 变成 `number` 是同一个机制。
- `system = "从客户的退款工单里抽出四个字段。\n\n" + schema_prompt(RefundFieldsMaybe)` 指令很短,格式和 null 规则全靠 schema 里的说明。
- `for ticket in (EDGE[0][1], MESSY[0][0]):` 没金额的一张,有金额的一张。

</div>

```bash
uv run python -m part02.ex149_null
```

```text
None → 转人工:工单里没有金额,请客服向客户确认
2388 → 退款 1871 元
2 次调用 | 输入 611 / 输出 59 tokens | 约 ¥0.0014
```

没金额的那张填了 `None` 并转人工,正常那张算出 1871。和 Day 148 第六步对比:那次提示词写着「整数」、schema 允许 null,模型填了 0;这次提示词里没有和 schema 冲突的说法,schema 的说明本身就写着「没写就填 null」,模型照做了。

</details>

**验收标准:** 能默写 `RefundFields`,说出每一行对应 schema 里的哪一段;`model_check.py` 五份数据的结果能逐条解释,尤其是「金额是字符串」为什么通过;`model_run.py` 和 `schema_prompt.py` 各跑出结果,能说出两条路的区别(谁保证格式、键的顺序由谁定、token 多了多少);能说出给模型用的 pydantic 类的三条写法。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| `model_json_schema()` | pydantic 类方法,从类生成 JSON Schema 字典。例:`RefundFields.model_json_schema()["required"]` 是四个字段名 |
| `model_validate_json()` | 吃 JSON 字符串,解析加校验一步完成,返回对象或抛 `ValidationError` |
| `extra="forbid"` | `ConfigDict` 选项,收到未声明字段就报错,schema 里生成 `additionalProperties: false` |
| `format: "date"` | JSON Schema 的标准格式标记,表示 `YYYY-MM-DD` 日期,pydantic 的 `date` 字段会生成它 |
| `anyOf` | JSON Schema 关键字,「符合其中任意一个」,`int \| None` 生成 `anyOf: [integer, null]` |
| 宽松模式(lax mode) | pydantic 默认行为,能无损转换的值自动转,例 `"2388"` 变成 2388 |
| 严格模式(strict mode) | `ConfigDict(strict=True)`,不做类型转换,`"2388"` 直接报错;JSON 里的 ISO 日期字符串仍可转成 `date` |
| `type[BaseModel]` | 类型标注,表示参数是一个类本身,不是它的对象 |
| `try/except/else` | `else` 块只在 `try` 没抛异常时执行,用来放「成功之后」的代码 |
| `chat.completions.parse()` | openai SDK 的方法,`response_format` 传 pydantic 类,自动生成 strict schema 并把结果校验进 `message.parsed` |

## 常见误区

**以为 pydantic 只是做校验的。** 给模型用时它更重要的身份是 schema 的唯一来源:`model_json_schema()` 生成的东西既发给服务端,也写进提示词。改字段只改类。

**可选字段习惯性写 `= None`。** 生成的 schema 里这个字段不在 `required`,strict 模式的厂商会拒;不 strict 的厂商收了,模型也可能干脆不写这个键。写 `X | None` 且不给默认值。

**忘了 `extra="forbid"`。** pydantic 默认 `extra="ignore"`,多余字段悄悄丢掉,schema 里也没有 `additionalProperties: false`。模型多写了一个 `note`,你永远不知道。

**以为 `"2388"` 会被拦下。** 默认宽松模式会把它转成整数。想知道模型有没有严格按 schema 输出,开 `strict=True`。

**用 `if not info.paid` 判断「没写金额」。** 金额是 0 时也会进这个分支。判断 `None` 用 `is None`。

**对 DeepSeek 官方用 `chat.completions.parse()`。** 它发出去的是 `json_schema`,DeepSeek 返回 `This response_format type is unavailable now`。不支持第三层的厂商,用 JSON mode 加 `schema_prompt()`。

**子类里把字段类型放宽。** `RefundFields` 的 `paid: int` 在子类里改成 `int | None`,basedpyright 报 `reportIncompatibleVariableOverride`。单独写一个类。

## 学习资料

### 文档与文章

- [pydantic:JSON Schema](https://docs.pydantic.dev/latest/concepts/json_schema/):英文,`model_json_schema()` 的全部选项,包括怎么改 `title`、怎么给字段加额外的 schema 内容。
- [pydantic:Models](https://docs.pydantic.dev/latest/concepts/models/):英文,看 `model_validate`、`model_validate_json` 和 `model_config` 那几节。
- [pydantic:Strict Mode](https://docs.pydantic.dev/latest/concepts/strict_mode/):英文,讲严格模式下哪些类型转换还允许,比如 JSON 里的日期字符串仍可转成 `date`。
- [pydantic:Validation Errors](https://docs.pydantic.dev/latest/errors/validation_errors/):英文,每种错误 `type`(`literal_error`、`int_parsing`、`extra_forbidden`…)的含义和例子,看到陌生的错误类型来这查。
- [OpenAI:Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs):英文,里面 Python 例子用的就是 `parse()` 加 pydantic 类,对照今天第七步看。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ppjF6LEnr&autoplay=0&high_quality=1" title="如何让模型稳定地输出JSON结构？——数据模型 Pydantic" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>懂点AI的H先生 · 如何让模型稳定地输出JSON结构?——数据模型 Pydantic · 8 分钟,2026 年 6 月。正好讲今天这件事:用 pydantic 类定义结构再交给模型,短,适合先看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1SMRpBmEyG&p=5&autoplay=0&high_quality=1" title="【吴恩达最新】Pydantic用于LLM工作流" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>吴恩达AIAgent(搬运) · Pydantic用于LLM工作流 · DeepLearning.AI 短课的中文字幕搬运,共 7 P。今天看第 5 P「在 API 调用中传递 Pydantic 模型」(约 10 分钟),讲的就是把类直接交给 API;第 4 P「验证 LLM 响应」留到明天看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/fuMKrKlaku4" title="OpenAI Structured Output - All You Need to Know" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Dave Ebbelaar · OpenAI Structured Output - All You Need to Know · 英文。用 pydantic 类配 OpenAI 的 parse(),从简单例子讲到嵌套结构,作者是做 AI 应用咨询的工程师,讲得很实在。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 2 章结构化输出一节,本周第三次推荐,这次重点看「后处理」那段,对应今天的本地校验。
- 今天这组不需要再加别的书,pydantic 官方文档比任何书都新。

### 开源项目与代码

- [pydantic/pydantic](https://github.com/pydantic/pydantic):源码和 issue,搜 `json_schema` 能看到很多「生成的 schema 某家厂商不认」的讨论。
- [openai/openai-python](https://github.com/openai/openai-python):README 里的「Structured outputs」示例就是第七步的 `parse()`。
- [567-labs/instructor](https://github.com/567-labs/instructor):把「pydantic 类 + 校验 + 重试」打包成一个库,支持很多厂商(包括不支持 json_schema 的)。明天自己手写这套,后天 Day 151 再看它。

## 自测

1. `RefundFields` 里哪一行决定了 schema 里的 `"additionalProperties": false`?去掉它会发生什么?

<details><summary>答案</summary>

`model_config = ConfigDict(extra="forbid")`。去掉后 pydantic 用默认的 `extra="ignore"`:生成的 schema 里没有 `additionalProperties`,本地校验时多余字段被悄悄丢掉不报错;strict 模式的厂商(比如 OpenAI)会因为缺这一条拒绝 schema。

</details>

2. 为什么 `model_check.py` 里 `"paid": "2388"` 通过了,`"paid": "2388元"` 没通过?怎么让前者也报错?

<details><summary>答案</summary>

pydantic 默认宽松模式,能无损转成整数的字符串 `"2388"` 会被自动转成 2388;`"2388元"` 转不了,报 `int_parsing`。给类加 `ConfigDict(strict=True)` 进入严格模式,`"2388"` 就会报「Input should be a valid integer」。

</details>

3. 同样是「随口要」的提示词,第四步(硅基流动 schema 约束)15/18,第五步(DeepSeek schema 写进提示词)18/18。这能说明「写进提示词」更好吗?

<details><summary>答案</summary>

不能。服务端约束保证格式,写进提示词只是这 18 次模型碰巧都照做了。差别来自键的生成顺序:硅基流动的约束按字母序先写 `asked`,DeepSeek 照着提示词里 schema 的顺序先写 `bought`。它说明的是字段顺序会影响值,而顺序由谁决定各家不同。要比较两种做法的好坏,得用更多工单、更多轮次去量。

</details>

4. `paid: int | None` 和 `paid: int | None = None` 生成的 schema 有什么不同?给模型用应该选哪个?

<details><summary>答案</summary>

两者 `paid` 都是 `anyOf: [integer, null]`;前者 `paid` 在 `required` 里,后者不在,还多了 `"default": null`。给模型用选前者:满足 strict 要求,而且模型必须写出 `paid` 键,`null` 明确表示「工单里没金额」,能和「模型漏了这个字段」区分开。

</details>

5. 面试题:「项目里要同时支持 OpenAI 和一个不支持 JSON Schema 约束的国产模型,结构化抽取的代码怎么组织?」

<details><summary>答案</summary>

用一个 pydantic 类做唯一的结构定义,按 strict 的要求写(`extra="forbid"`、不给默认值、可缺用 `X | None`)。支持第三层的厂商,把 `model_json_schema()` 包成 `response_format` 的 `json_schema`(或者用 SDK 的 `parse()`);不支持的,开 JSON mode,把同一份 schema 写进提示词。两条路出来都用 `model_validate_json()` 校验,失败时把错误喂回模型重试,超过上限就降级。提示词里还要写清每个字段的意思和缺失时填 null,因为 schema 只保证格式。最后用一组评测工单在两家上都跑,比较格式通过率和值的正确率。

</details>

## 明天预告

Day 150 · 结构化输出(四):校验失败把错误喂回去重试。今天 `model_validate_json()` 一失败,我们就只是记下来、跳过。可 `ValidationError` 的报错写得这么具体(哪个字段、什么规则、收到了什么),完全可以原样告诉模型让它改。明天把今天的 `schema_prompt()` 和校验拼成一个通用的 `extract()` 函数:生成、校验、带着错误重试,有次数上限,还要区分被截断和返回空内容这两种不该「让模型改」的失败。
