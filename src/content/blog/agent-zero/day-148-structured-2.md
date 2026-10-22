---
title: 'Day 148 · 结构化输出(二):JSON mode 和 JSON Schema 约束'
description: '把昨天的四个字段写成一份 JSON Schema,逐个关键字读懂 type、properties、required、enum、pattern、additionalProperties;先用 jsonschema 库在本地检查,再查清 2026 年 10 月各家对 schema 约束的支持。DeepSeek 官方接口不收 json_schema,今天换到硅基流动上的同一个模型实跑第三层:提示词随口一说,键名和枚举也全对了,却冒出一个 schema 管不了的新错。'
pubDate: 2026-10-22
regime: none
tags: ['structured-output', 'json-schema', 'agent-zero']
series: 'agent-zero'
day: 148
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 147](/blog/agent-zero/day-147-structured-1/) 让模型从随手写的退款工单里抽出 `plan`、`paid`、`bought`、`asked` 四个字段。量出来的结论是:随口要 JSON,18 次全包了代码块;打开 JSON mode(`response_format={"type": "json_object"}`),18 次都是合法 JSON,但键全是中文的「套餐类型」;把格式写清楚(求它),18 次全对。最后用一个假模型看了第三层「逼它」:约束解码在每一步把不合格的候选划掉。

昨天第三层只停在原理上,因为 DeepSeek 的 `response_format` 不收 `json_schema`,直接 400。今天把这一层补完:先学会写那份交给服务端的「结构说明」JSON Schema,再找一家真收它的厂商跑一遍,看它到底管住了什么、没管住什么。

## 今天要解决的问题

学完今天你应该能做到:

1. 读懂并手写一份 JSON Schema,说清 `type`、`properties`、`required`、`enum`、`pattern`、`additionalProperties`、`description` 各管什么。
2. 用 `jsonschema` 库在本地拿 schema 检查一段数据,看懂它的报错。
3. 说出 2026 年 10 月 DeepSeek、OpenAI、Claude、阿里百炼、硅基流动对 schema 约束各支持到哪一步,以及 strict 模式对 schema 的几条硬性要求。
4. 在硅基流动上实跑一次 schema 约束,能解释为什么「格式全对」的结果里还会有抽错的值。

预计用时:2.5 小时。前置:[Day 147](/blog/agent-zero/day-147-structured-1/)(三个层次、`json_check.py`、`extract_compare.py`、`extract_edge.py`)、[Day 123](/blog/agent-zero/day-123-openai-compatible/)(OpenAI 兼容协议,换 `base_url` 就能换厂商)、[Day 135](/blog/agent-zero/day-135-llm-client-1/)(`LLMClient` 的 `env_file` 参数)、[Day 39](/blog/agent-zero/day-039-json/)(`json.dumps`)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `refund_schema.py` 里的 `REFUND_SCHEMA` 和 `schema_run.py` 里的 `SCHEMA_MODE`;再做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## JSON Schema 是什么

你在前端写过 TS 的类型定义:

```ts
interface RefundFields {
  plan: "年付" | "月付";
  paid: number;
  bought: string;
  asked: string;
}
```

它告诉编辑器「这个对象长什么样」,写错了画红线。问题是这份定义只活在 TS 编译期,编译完就没了,也没法发给别人的服务器。

**JSON Schema** 做的是同一件事,只不过它本身就是一段 JSON:有哪些字段、每个字段什么类型、哪些必须有、能不能多出别的字段。因为是 JSON,它能存成文件,能放进 HTTP 请求里发给模型厂商,服务端拿到以后照着它去约束模型的输出。你在 DevTools 里看到的某些接口文档(OpenAPI/Swagger)里那一大段 `"type": "object", "properties": {...}`,就是 JSON Schema。

它有好几个版本(draft-07、2019-09、2020-12),各家大模型厂商用的都是其中一个子集。今天只用最常见的七个关键字,够写绝大多数抽取任务。

## 第一步:把四个字段写成 schema

在 Day 147 那份 `agent-zero-lab` 里新建 `part02/refund_schema.py`:

```python
# agent-zero-lab/part02/refund_schema.py
import json
from typing import Any

DATE = r"^\d{4}-\d{2}-\d{2}$"

REFUND_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "plan": {"type": "string", "enum": ["年付", "月付"], "description": "套餐类型"},
        "paid": {"type": "integer", "description": "实付金额,单位元"},
        "bought": {"type": "string", "pattern": DATE, "description": "购买日期 YYYY-MM-DD"},
        "asked": {"type": "string", "pattern": DATE, "description": "申请退款日期 YYYY-MM-DD"},
    },
    "required": ["plan", "paid", "bought", "asked"],
    "additionalProperties": False,
}

if __name__ == "__main__":
    print(json.dumps(REFUND_SCHEMA, ensure_ascii=False, indent=2))
```

<div class="line-notes">

- `from typing import Any` 下面这个字典里的值有字符串、字典、列表、布尔,类型很杂,标成 `dict[str, Any]` 省事,也免得后面改它时编辑器画红线。
- `DATE = r"^\d{4}-\d{2}-\d{2}$"` 一个正则(Day 1 见过正则),意思是「4 位数字-2 位数字-2 位数字,前后不许有别的」。`^` 是开头,`$` 是结尾,`\d` 是一个数字。前面的 `r` 表示原始字符串,反斜杠不转义,相当于 JS 里写正则字面量 `/^\d{4}-\d{2}-\d{2}$/`。两个日期字段共用它,所以提成常量。
- `REFUND_SCHEMA: dict[str, Any] = {` 整份 schema 就是一个普通的 Python 字典,和你写一个 JSON 对象没区别。
- `"type": "object",` 最外层:整个输出必须是一个 JSON 对象(`{...}`),不能是数组、字符串。Day 147 的 `check()` 里那句 `isinstance(data, dict)` 检查的就是这一条。
- `"properties": {` 对象里每个字段长什么样,键是字段名,值是这个字段自己的一份小 schema。相当于 TS interface 花括号里的那几行。
- `"plan": {"type": "string", "enum": ["年付", "月付"]` `enum` 是「只能是这几个值之一」,相当于 TS 的 `"年付" | "月付"`。昨天模型写的「年费会员」在这里就不合格。同一行末尾的 `description` 是字段说明。它不参与校验,是写给模型看的:服务端会把它连同 schema 一起交给模型,模型据此理解这个字段该填什么。
- `"paid": {"type": "integer"` JSON Schema 里 `integer` 是整数,`number` 是任意数字(含小数)。JS 只有一种 `number`,这里要分清:`2388` 合格,`2388.0` 在多数校验器里也算整数,`"2388元"` 不合格。
- `"bought": {"type": "string", "pattern": DATE` `pattern` 要求字符串匹配一个正则。`"2026-09-01"` 合格,`"2026-9-1"` 不合格。JSON Schema 还有一个 `"format": "date"` 也能表达日期,但很多校验器默认不检查 `format`,`pattern` 更靠得住。
- `"required": ["plan", "paid", "bought", "asked"],` 哪些字段必须出现。不在这个列表里的字段可以缺。TS 里对应的是不加 `?` 的属性。
- `"additionalProperties": False,` 不许出现 `properties` 之外的字段。不写这一行,`{"plan": ..., "note": "急"}` 也算合格。Python 里写 `False`,`json.dumps` 输出时变成 JSON 的 `false`。
- `print(json.dumps(REFUND_SCHEMA, ensure_ascii=False, indent=2))` `ensure_ascii=False` 让中文原样输出,不变成 `年` 这种转义;`indent=2` 缩进两格,相当于 JS 的 `JSON.stringify(obj, null, 2)`。

</div>

```bash
cd agent-zero-lab
uv run python -m part02.refund_schema
```

输出(开头一段,后面同样格式):

```text
{
  "type": "object",
  "properties": {
    "plan": {
      "type": "string",
      "enum": [
        "年付",
        "月付"
      ],
      "description": "套餐类型"
    },
    "paid": {
      "type": "integer",
      "description": "实付金额,单位元"
    },
    "bought": {
      "type": "string",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}$",
      "description": "购买日期 YYYY-MM-DD"
    },
```

注意 `pattern` 打出来是 `^\\d{4}`,两个反斜杠。这不是写错了:JSON 字符串里反斜杠要转义成 `\\`,解析回来还是一个反斜杠。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="TS 类型和 JSON Schema 的对应">
<rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-faint)">TS 类型(只活在编译期)</text>
<text x="340" y="26" fill="var(--ink-faint)">JSON Schema(能发给服务端)</text>
<rect x="20" y="40" width="280" height="200" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="32" y="64" fill="var(--ink)">interface RefundFields {</text>
<text x="44" y="94" fill="var(--ink)">plan: "年付" | "月付";</text>
<text x="44" y="124" fill="var(--ink)">paid: number;</text>
<text x="44" y="154" fill="var(--ink)">bought: string;</text>
<text x="44" y="184" fill="var(--ink-soft)">// 不写 ? 就是必填</text>
<text x="44" y="214" fill="var(--ink-soft)">// 多余字段:TS 看情况</text>
<text x="32" y="232" fill="var(--ink)">}</text>
<rect x="340" y="40" width="280" height="200" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="352" y="64" fill="var(--ink)">"type": "object"</text>
<text x="352" y="94" fill="var(--ink)">"enum": ["年付","月付"]</text>
<text x="352" y="124" fill="var(--ink)">"type": "integer"</text>
<text x="352" y="154" fill="var(--ink)">"pattern": "^\d{4}-…"</text>
<text x="352" y="184" fill="var(--ink)">"required": [...]</text>
<text x="352" y="214" fill="var(--ink)">"additionalProperties": false</text>
<line x1="300" y1="94" x2="340" y2="94" stroke="var(--ink-faint)"/>
<line x1="300" y1="124" x2="340" y2="124" stroke="var(--ink-faint)"/>
<line x1="300" y1="154" x2="340" y2="154" stroke="var(--ink-faint)"/>
<line x1="300" y1="184" x2="340" y2="184" stroke="var(--ink-faint)"/>
<line x1="300" y1="214" x2="340" y2="214" stroke="var(--ink-faint)"/>
<text x="20" y="260" fill="var(--ink-soft)">schema 比 TS 多两样:pattern(格式)和 integer(整数),TS 表达不了</text>
</g>
</svg>
<figcaption>左边是你熟悉的 TS 类型,右边是同一份约定的 JSON Schema 写法。右边是 JSON,能存、能发,能让别人的服务器照着检查。</figcaption>
</figure>

## 第二步:在本地拿 schema 检查数据

Schema 写好了,先别急着发给厂商。它写得对不对,在本地就能验证:拿几份数据过一遍,看它拦下了什么。Python 里做这件事的标准库是 `jsonschema`(不是 Python 自带的,要装),相当于前端的 `ajv`。

```bash
uv add jsonschema
```

2026 年 10 月查到的最新版是 4.26.0(PyPI),装完 `pyproject.toml` 的 dependencies 里多一行 `"jsonschema>=4.26.0"`。

新建 `part02/schema_check.py`:

```python
# agent-zero-lab/part02/schema_check.py
from jsonschema import Draft202012Validator

from part02.refund_schema import REFUND_SCHEMA

validator = Draft202012Validator(REFUND_SCHEMA)

SAMPLES = {
    "全对": {"plan": "年付", "paid": 2388, "bought": "2026-09-01", "asked": "2026-10-20"},
    "中文键": {"套餐类型": "年费会员", "实付金额": 2388, "购买日期": "2026-09-01", "申请日期": "2026-10-20"},
    "值不对": {"plan": "年费会员", "paid": "2388元", "bought": "2026-9-1", "asked": "2026-10-20"},
    "多一个键": {"plan": "年付", "paid": 2388, "bought": "2026-09-01", "asked": "2026-10-20", "note": "急"},
}

for name, data in SAMPLES.items():
    errors = list(validator.iter_errors(data))
    print(f"{name}: {len(errors)} 个错误")
    for e in errors:
        print("   ", e.message)
```

<div class="line-notes">

- `from jsonschema import Draft202012Validator` 按 2020-12 这一版规范检查的校验器。版本名就是规范发布的年月,写最新的这版就行。
- `validator = Draft202012Validator(REFUND_SCHEMA)` 用 schema 造一个校验器对象,后面反复用。相当于 ajv 里 `const validate = ajv.compile(schema)`。
- `"中文键": {"套餐类型": "年费会员"` 昨天「随口要 + JSON mode」真实输出的样子。
- `"值不对": {"plan": "年费会员", "paid": "2388元", "bought": "2026-9-1"` 键对了,三个值都不合格。
- `"多一个键":` 四个字段全对,多了一个 `note`。
- `errors = list(validator.iter_errors(data))` `iter_errors` 把所有不合格的地方一个个吐出来(是个生成器,用 `list()` 收成列表)。还有一个 `validator.validate(data)`,遇到第一个错误就抛异常,适合「不合格就停」;这里要看全部错误,所以用 `iter_errors`。
- `print("   ", e.message)` 每个错误对象的 `message` 是一句英文说明,下面的输出里能看到。

</div>

```bash
uv run python -m part02.schema_check
```

```text
全对: 0 个错误
中文键: 5 个错误
    'plan' is a required property
    'paid' is a required property
    'bought' is a required property
    'asked' is a required property
    Additional properties are not allowed ('套餐类型', '实付金额', '申请日期', '购买日期' were unexpected)
值不对: 3 个错误
    '年费会员' is not one of ['年付', '月付']
    '2388元' is not of type 'integer'
    '2026-9-1' does not match '^\\d{4}-\\d{2}-\\d{2}$'
多一个键: 1 个错误
    Additional properties are not allowed ('note' was unexpected)
```

每一条报错都对得上一个关键字:`required` 报「is a required property」,`additionalProperties` 报「Additional properties are not allowed」,`enum` 报「is not one of」,`type` 报「is not of type」,`pattern` 报「does not match」。「中文键」那一行四个多余的键顺序和原数据不一样,这是 jsonschema 内部用集合收集造成的,不影响结果。

Day 147 手写的 `check()` 二十来行做的事,这里一份 schema 加三行代码就做完了,而且报错更具体。这份 schema 接下来还有第二个用处:原样发给厂商,让服务端在生成时就按它约束。**同一份 schema,本地拿来检查,服务端拿来约束**,这是今天最值得记住的一点。

## 各家对 schema 约束支持到哪一步

把 schema 交给服务端,各家接口的写法和限制不一样。下面这张表是 2026-10-22 逐家查文档得来的:

| 厂商 | JSON mode | schema 约束 | 写法 | 文档里写的限制 |
| --- | --- | --- | --- | --- |
| DeepSeek 官方 | 支持,提示词要有 json | `response_format` 不支持(Day 147 实测 400);工具调用有 strict(Beta) | `response_format={"type": "json_object"}` | 有概率返回空 content |
| OpenAI | 支持,上下文要有 JSON | 支持 | `response_format={"type": "json_schema", "json_schema": {"name", "strict": true, "schema"}}` | 每个字段都要进 `required`;对象要 `additionalProperties: false`;根必须是对象;最多 5000 个属性、10 层嵌套 |
| Claude | 没有单独的 | 支持 | 请求里 `output_config.format` 传 `{"type": "json_schema", "schema": ...}` | 不支持 `minimum`、`maximum`、`minLength` 等数值和长度约束;`additionalProperties` 只能是 `false`;必填字段排在可选字段前面输出 |
| 阿里百炼 | 支持,提示词要有 json | 支持,只限 Qwen3.7/3.8 的 Plus、Flash、Max 等少数系列 | 和 OpenAI 同样的 `json_schema` 写法 | 图片、视频、音频输入时退回 JSON mode |
| 硅基流动 | 支持 | 文档只写了 `json_object`;实测 `json_schema` 能用(见下文) | 和 OpenAI 同样的写法 | 文档提醒合理设置 `max_tokens`,自己处理不完整的 JSON |

几个读表时要注意的地方:

**strict 模式对 schema 有硬性要求。** OpenAI 的 strict 要求每个字段都写进 `required`,想让某个字段「可以没有」,不能把它从 `required` 里拿掉,而是把类型写成 `["integer", "null"]`,让模型填 `null`。我们的 `REFUND_SCHEMA` 四个字段全必填、`additionalProperties` 是 `false`,正好满足这几条,所以它能原样发给 OpenAI 和硅基流动。

**同一个关键字,有的家认有的家不认。** Claude 文档明确写了不支持 `minimum`/`maximum`,发过去会 400;它的 Python SDK 会帮你把这类约束挪进 `description` 里当提示。所以 schema 里用到冷门关键字之前,先查目标厂商的支持列表。

**JSON mode 的「提示词要有 json」规矩只管 JSON mode。** 百炼文档写了用 `json_schema` 时提示词不必出现 json 这个词,不过仍然建议在提示词里说清楚格式。后面第七步会看到不说清楚会出什么事。

OpenAI 和 Claude 我手头没有 key,表里这两行只来自官方文档,没实跑。今天实跑选硅基流动,原因很实际:它就是一个 OpenAI 兼容接口,上面部署了同一个 DeepSeek V4 Flash 模型,换 `base_url` 和 key 就能用,模型不变,比较起来最公平。

## 第三步:准备硅基流动的配置

硅基流动(SiliconFlow)是国内的模型托管平台,把很多开源模型部署好,按 OpenAI 兼容协议提供接口。如果你在 Day 2 的准备工作里还没注册,去 [siliconflow.cn](https://www.siliconflow.cn/pricing) 注册并在「API 密钥」页面建一个 key。后面第四部分做向量检索(embedding)也会用到这个平台。

价格(2026-10-22 查它的定价页):`deepseek-ai/DeepSeek-V4-Flash` 每百万 token 输入 ¥3、输出 ¥9(8 点到次日 2 点),凌晨 2 点到 8 点半价。比 DeepSeek 官方贵一些,今天只跑几十次,几分钱的事。

[Day 135](/blog/agent-zero/day-135-llm-client-1/) 的 `LLMClient(env_file=...)` 可以指定另一份 `.env`。在 `agent-zero-lab/` 根目录建 `.env.sf`:

```bash
# agent-zero-lab/.env.sf
# 硅基流动:同一个 DeepSeek V4 Flash 模型,它家接受 json_schema
LLM_BASE_URL=https://api.siliconflow.cn/v1
LLM_API_KEY=sk-你自己的硅基流动key
LLM_MODEL=deepseek-ai/DeepSeek-V4-Flash
LLM_EXTRA_BODY={"thinking": {"type": "disabled"}}
LLM_PRICE=3,3,9
```

<div class="line-notes">

- `LLM_BASE_URL=https://api.siliconflow.cn/v1` 硅基流动的接口地址,末尾 `/v1` 不能少。
- `LLM_API_KEY=sk-你自己的硅基流动key` 换成你自己的。和 `.env` 一样,这个文件不能进 git([Day 53](/blog/agent-zero/day-053-env-secrets/) 讲过 `.gitignore`),记得把 `.env.sf` 也加进去。
- `LLM_MODEL=deepseek-ai/DeepSeek-V4-Flash` 硅基流动上模型名带厂商前缀,和 DeepSeek 官方的 `deepseek-flash` 写法不同。
- `LLM_EXTRA_BODY={"thinking": {"type": "disabled"}}` 关掉思考模式。这一行我第一次没写,结果硅基流动上这个模型默认是开着思考的:54 次调用输出了 10759 个 token,关掉以后同样 54 次只有 2261 个,钱差了三倍多。第七步还会看到思考模式和 schema 放在一起的另一个坑。
- `LLM_PRICE=3,3,9` `LLMClient` 按「缓存命中,未命中,输出」三个单价算钱(元每百万 token)。缓存命中价我没在定价页找到,按未命中价算,只会算多不会算少。

</div>

`LLMClient(env_file=".env.sf")` 内部用 `load_dotenv(..., override=True)` 读这份文件,会把进程里的 `LLM_*` 环境变量覆盖成硅基流动的值。所以同一个脚本里,先建了 `.env.sf` 的客户端,之后再 `LLMClient()` 也会拿到硅基流动。今天每个脚本只用一家,没有影响;要两家混用时,先建默认的那个。

## 第四步:schema 约束实跑

把 schema 包进 `response_format`,在 6 张工单上跑 3 轮。对照组有三个:

| 做法 | 提示词 | response_format |
| --- | --- | --- |
| 随口要 + JSON mode | Day 147 的 `ASK`:「整理成 JSON」 | `json_object` |
| 随口要 + schema | `ASK` | `json_schema` |
| 求它 + schema | Day 147 的 `SPEC`:写清键名和格式 | `json_schema` |

第一行在硅基流动上重跑一遍,确认换了平台以后 JSON mode 还是昨天那个结论。第二行是今天的重点:提示词什么都没说,只靠 schema,能做到什么程度。新建 `part02/schema_run.py`:

```python
# agent-zero-lab/part02/schema_run.py
from typing import Any

from common.llm import LLMClient
from part02.extract_compare import ASK, SPEC, to_refund
from part02.json_check import check
from part02.messy_tickets import MESSY
from part02.refund_schema import REFUND_SCHEMA

JSON_MODE = {"type": "json_object"}
SCHEMA_MODE = {
    "type": "json_schema",
    "json_schema": {"name": "refund_fields", "strict": True, "schema": REFUND_SCHEMA},
}
MODES: dict[str, tuple[str, dict[str, Any]]] = {
    "随口要+JSON mode": (ASK, JSON_MODE),
    "随口要+schema": (ASK, SCHEMA_MODE),
    "求它+schema": (SPEC, SCHEMA_MODE),
}
ROUNDS = 3


def main() -> None:
    client = LLMClient(env_file=".env.sf")
    print("厂商:", client.client.base_url, "模型:", client.model)
    for name, (system, fmt) in MODES.items():
        before = client.ledger.cost
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
                data, problems = check(r.content)
                if data is None or problems:
                    key = problems[0]
                elif to_refund(data) != to_refund(gold):
                    key = f"抽错了: {data}"
                else:
                    ok += 1
                    continue
                seen[key] = seen.get(key, 0) + 1
        for problem, count in seen.items():
            print(f"  [{name}] {problem} ×{count}")
        print(f"{name}: 能用 {ok}/{ROUNDS * len(MESSY)}  ¥{client.ledger.cost - before:.4f}")
    print("合计:", client.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from part02.extract_compare import ASK, SPEC, to_refund` 直接复用 Day 147 的两个提示词和「交给 `refund()` 算钱」的函数,保证和昨天比的是同一道题。
- `from part02.json_check import check` 还是 Day 147 手写的那把尺子。也可以换成上一步的 `validator`,这里继续用 `check()` 是为了和昨天的数字直接对比。
- `SCHEMA_MODE = {` 第三层在请求里长这样。外层 `type` 是 `json_schema`,里面的 `json_schema` 有三样东西。
- `"json_schema": {"name": "refund_fields", "strict": True, "schema": REFUND_SCHEMA},` `name` 是给这份 schema 起的名字(OpenAI 要求只用字母、数字、下划线和短横线);`strict: True` 表示严格按 schema 约束解码;`schema` 就是第一步写的那个字典,原样放进来。
- `client = LLMClient(env_file=".env.sf")` 读上一步的硅基流动配置。其他代码一行不用改,这就是 Day 123 说的 OpenAI 兼容协议的好处。
- `print("厂商:", client.client.base_url` `client.client` 是 `LLMClient` 里面包着的 openai SDK 客户端,打印一下确认真的连到了硅基流动。
- `response_format=fmt,` 三种做法唯一的区别在这里和 system 提示词。
- `if data is None or problems:` 和昨天不同,这里把「不是 JSON」和「字段不合格」合在一起记,只记第一个问题。
- `key = problems[0]` `data is None` 时 `check()` 也会在问题列表里放一条「不是合法 JSON」,所以 `problems[0]` 一定存在。
- `elif to_refund(data) != to_refund(gold):` 格式全过,再看算出来的钱对不对。今天的新错就出在这一行。
- `ok += 1` 然后 `continue` 跳过下面的计数,直接进下一张工单。
- `print("合计:", client.ledger)` 实测 `54 次调用 | 输入 4185 / 输出 2261 tokens | 约 ¥0.0329`。

</div>

```bash
uv run python -m part02.schema_run
```

我的输出(2026-10-22 晚上,硅基流动 DeepSeek-V4-Flash,关思考):

```text
厂商: https://api.siliconflow.cn/v1/ 模型: deepseek-ai/DeepSeek-V4-Flash
  [随口要+JSON mode] 缺字段 plan ×18
随口要+JSON mode: 能用 0/18  ¥0.0104
  [随口要+schema] 抽错了: {'asked': '2026-09-01', 'bought': '2026-09-01', 'paid': 2388, 'plan': '年付'} ×3
随口要+schema: 能用 15/18  ¥0.0102
求它+schema: 能用 18/18  ¥0.0123
合计: 54 次调用 | 输入 4185 / 输出 2261 tokens | 约 ¥0.0329
```

逐行看。

**随口要 + JSON mode:0/18,全部缺字段 plan。** 换到硅基流动,结论和昨天在 DeepSeek 官方一模一样:是合法 JSON,键是中文的。

**随口要 + schema:15/18。** 这是今天最该看的一行。提示词还是那句「整理成 JSON」,一个英文键名都没提,但 18 次输出全部通过了 `check()`:键是 `plan`、`paid`、`bought`、`asked`,`plan` 只会是「年付」或「月付」,日期全是 `YYYY-MM-DD`。键名、类型、枚举、格式,全由 schema 管住了。昨天 Day 147 的假模型演示的就是这件事,今天在真服务端上看到了。

可是有 3 次「抽错了」,而且三轮里都是同一张工单:第 1 张「我 2026 年 9 月 1 号买的年费会员,花了 2388,今天 10 月 20 号,想退掉」。模型把 `asked`(申请日期)也填成了 `2026-09-01`,和购买日期一样。格式完全合法,schema 无话可说,但交给 `refund()` 算出来的钱是错的:申请日期等于购买日期,系统会以为是当天退款,全额退 2388,正确答案是 1871。

**求它 + schema:18/18。** 提示词写清了每个字段的意思,这个错就没了。

## 为什么格式全对,值却抽错了

看那条错误输出,键的顺序是 `asked`、`bought`、`paid`、`plan`,正好是字母顺序,和我们 schema 里写的 `plan`、`paid`、`bought`、`asked` 不一样。练习 3 会专门验证:硅基流动返回的键就是按字母排的。

模型是一个 token 一个 token 从左往右写的(Day 106)。按字母序,它第一个要写的是 `asked`。这时候它还没写过 `bought`,脑子里也没有「这是两个不同日期」的区分;字段名 `asked` 本身又不是一个常见英文词组,提示词里也没解释。工单里出现的第一个日期是 9 月 1 日,它就填了 9 月 1 日。等写到 `bought` 时,又填了一次 9 月 1 日。

「求它」那组为什么没事?`SPEC` 里写着 `"asked": "申请日期 YYYY-MM-DD"`,模型写 `asked` 之前就知道它是申请日期。schema 里其实也有 `description`,但「随口要」那组的结果说明,至少在硅基流动这里,单靠 schema 里的说明不够让模型分清两个日期,提示词里写清楚才稳。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="schema 保证格式,但字段生成顺序会影响值">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-faint)">工单:我 2026 年 9 月 1 号买的年费会员,花了 2388,今天 10 月 20 号,想退掉</text>
<text x="20" y="56" fill="var(--ink-soft)">生成顺序(按字母)→</text>
<rect x="20" y="70" width="140" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="92" fill="var(--ink)">① "asked"</text>
<text x="32" y="114" fill="var(--mem)">"2026-09-01" ✗</text>
<rect x="175" y="70" width="140" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="187" y="92" fill="var(--ink)">② "bought"</text>
<text x="187" y="114" fill="var(--ink-soft)">"2026-09-01"</text>
<rect x="330" y="70" width="140" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="342" y="92" fill="var(--ink)">③ "paid"</text>
<text x="342" y="114" fill="var(--ink-soft)">2388</text>
<rect x="485" y="70" width="135" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="497" y="92" fill="var(--ink)">④ "plan"</text>
<text x="497" y="114" fill="var(--ink-soft)">"年付"</text>
<rect x="20" y="160" width="295" height="70" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="32" y="182" fill="var(--ink)">schema 检查:全部通过</text>
<text x="32" y="202" fill="var(--ink-soft)">键对、类型对、日期格式对</text>
<rect x="330" y="160" width="290" height="70" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="342" y="182" fill="var(--ink)">refund() 算钱:2388 ✗</text>
<text x="342" y="202" fill="var(--ink-soft)">正确是 1871,同一天申请=全退</text>
</g>
</svg>
<figcaption>随口要 + schema 那 3 次错误。第一个写的是 asked,模型在没区分两个日期时就填了第一个出现的日期。schema 检查全过,钱算错了。</figcaption>
</figure>

字段顺序怎么影响结果、怎么设计顺序,是 [Day 151](/blog/agent-zero/day-151-structured-5/) 的内容。今天记住两点就够:schema 管格式不管值;**不同厂商输出键的顺序不一样**,OpenAI 文档写的是按 schema 里的顺序,Claude 文档写的是必填在前、可选在后,硅基流动文档没写,实测是字母序。我猜是它的约束解码引擎在处理 schema 时把属性排了序,但它没公开实现,这只是猜测。

## 第五步:提示词和 schema 打架时听谁的

上一步提示词只是没说,如果提示词明确要求一个和 schema 冲突的格式呢?新建 `part02/schema_force.py`:

```python
# agent-zero-lab/part02/schema_force.py
from common.llm import LLMClient
from part02.messy_tickets import MESSY
from part02.schema_run import JSON_MODE, SCHEMA_MODE

AGAINST = "把工单整理成 JSON。键用中文:套餐、金额、购买日、退款日。套餐照抄客户原话,金额写成「xxx元」。"

client = LLMClient(env_file=".env.sf")
ticket, _ = MESSY[0]
for name, fmt in (("JSON mode", JSON_MODE), ("schema", SCHEMA_MODE)):
    r = client.chat(
        [{"role": "system", "content": AGAINST}, {"role": "user", "content": ticket}],
        temperature=0,
        max_tokens=300,
        response_format=fmt,
    )
    print(f"{name}: {r.content!r}")
print(client.ledger)
```

<div class="line-notes">

- `from part02.schema_run import JSON_MODE, SCHEMA_MODE` 复用上一步定义的两种 `response_format`。`schema_run.py` 的调用都在 `main()` 里,import 它不会跑 API。
- `AGAINST = "把工单整理成 JSON。键用中文` 故意和 schema 对着干:中文键、照抄原话、金额带「元」。
- `for name, fmt in (("JSON mode", JSON_MODE), ("schema", SCHEMA_MODE)):` 同一条提示词,先 JSON mode 后 schema 各跑一次。
- `print(f"{name}: {r.content!r}")` `!r` 打印带引号和转义的原样字符串,看得清换行。

</div>

```bash
uv run python -m part02.schema_force
```

```text
JSON mode: '{\n  "套餐": "年费会员",\n  "金额": "2388元",\n  "购买日": "2026年9月1日",\n  "退款日": "2026年10月20日"\n}'
schema: '{\n  "asked": "2026-09-01",\n  "bought": "2026-09-01",\n  "paid": 2388,\n  "plan": "年付"\n}'
2 次调用 | 输入 150 / 输出 96 tokens | 约 ¥0.0013
```

JSON mode 下模型完全听提示词的:中文键、「年费会员」、「2388元」、「2026年9月1日」。schema 下提示词的格式要求一条都没生效,输出的键、类型、枚举全按 schema 来。**格式上 schema 说了算**,因为它不是在「劝」模型,而是在生成时直接把不合格的 token 划掉了,提示词再怎么要求「年费会员」,那几个 token 根本选不到。

但注意 `asked` 又是 `2026-09-01`,和第四步同一个错。提示词改了个方向,内容上的毛病一点没少。

## 第六步:schema 挡不住的两种错

Day 147 的 `extract_edge.py` 有两张难工单:「忘了金额」和「被截断」(`max_tokens=12`)。换成 schema 约束再跑一次。顺便试一个想法:把 `paid` 的类型改成「整数或 null」,模型是不是就会在没有金额时填 `null`?新建 `part02/schema_edge.py`:

```python
# agent-zero-lab/part02/schema_edge.py
import copy

from common.llm import LLMClient
from part02.extract_compare import SPEC
from part02.extract_edge import EDGE
from part02.refund_schema import REFUND_SCHEMA


def schema_format(schema: dict) -> dict:
    return {"type": "json_schema", "json_schema": {"name": "refund_fields", "strict": True, "schema": schema}}


NULLABLE = copy.deepcopy(REFUND_SCHEMA)
NULLABLE["properties"]["paid"]["type"] = ["integer", "null"]
NULLABLE["properties"]["paid"]["description"] = "实付金额,单位元;工单里没写就填 null"

if __name__ == "__main__":
    client = LLMClient(env_file=".env.sf")
    for label, ticket, max_tokens in EDGE:
        for name, schema in (("integer", REFUND_SCHEMA), ("integer|null", NULLABLE)):
            r = client.chat(
                [{"role": "system", "content": SPEC}, {"role": "user", "content": ticket}],
                temperature=0,
                max_tokens=max_tokens,
                response_format=schema_format(schema),
            )
            print(f"{label} [{name}] finish={r.finish_reason} 输出={r.content!r}")
    print(client.ledger)
```

<div class="line-notes">

- `import copy` 标准库,用来复制对象。
- `def schema_format(schema: dict) -> dict:` 把任意一份 schema 包成 `response_format` 的样子,和 `SCHEMA_MODE` 是一个结构,只是 schema 可以换。练习 2 也会用它。
- `NULLABLE = copy.deepcopy(REFUND_SCHEMA)` **深拷贝**:连里面嵌套的字典一起复制一份新的。如果写 `NULLABLE = REFUND_SCHEMA`,两个名字指向同一个字典,下一行一改,`REFUND_SCHEMA` 也跟着变了;浅拷贝 `REFUND_SCHEMA.copy()` 只复制最外层,`properties` 里面还是共用的。相当于 JS 里 `structuredClone(obj)` 和 `{...obj}` 的区别。
- `NULLABLE["properties"]["paid"]["type"] = ["integer", "null"]` `type` 可以是一个列表,表示「这几种类型之一」。这是 OpenAI strict 模式推荐的「可以没有」的写法:字段仍然必填,但值可以是 `null`,相当于 TS 的 `paid: number | null`。
- `NULLABLE["properties"]["paid"]["description"] = "实付金额,单位元;工单里没写就填 null"` schema 里的说明也改了,告诉模型什么时候填 `null`。
- `for label, ticket, max_tokens in EDGE:` Day 147 的两张难工单,第三个元素是 `max_tokens`:「忘了金额」300,「被截断」12。
- `[{"role": "system", "content": SPEC}` 注意这里用的是 Day 147 的原版 `SPEC`,它写着 `paid` 是「实付金额(整数,单位元)」,没提 null。
- `response_format=schema_format(schema),` 两份 schema 各跑一次。

</div>

```bash
uv run python -m part02.schema_edge
```

```text
忘了金额 [integer] finish=stop 输出='{"asked": "2026-10-20", "bought": "2026-09-01", "paid": 0, "plan": "年付"}'
忘了金额 [integer|null] finish=stop 输出='{"asked": "2026-10-20", "bought": "2026-09-01", "paid": 0, "plan": "年付"}'
被截断 [integer] finish=length 输出='{"asked": "2026-10-20", "'
被截断 [integer|null] finish=length 输出='{"asked": "2026-10-20", "'
4 次调用 | 输入 474 / 输出 96 tokens | 约 ¥0.0023
```

**「忘了金额」两种 schema 都填了 0。** 只要求整数时填 0,和昨天一样;允许 `null` 了,schema 说明里也写了「没写就填 null」,它还是填 0。原因在提示词:`SPEC` 写的是「整数,单位元」,提示词和 schema 说的不一致,模型听了提示词。**schema 允许 null,只是给了模型一个说「不知道」的选项,不等于它会用这个选项。** 练习 2 把提示词也改成允许 null,结果就变了。

**「被截断」schema 也救不了。** `finish=length`,输出停在 `{"asked": "2026-10-20", "`。约束解码保证的是「每一步都走在合格的路上」,`max_tokens` 到了,服务端直接停,不会替你补完后面的括号。这条和 Day 147 一样:先看 `finish_reason`。

## 第七步:思考模型配 schema 的一个坑

第三步说过硅基流动上的模型默认可能开着思考。我在试探各家支持时,用硅基流动上另一个模型 `Qwen/Qwen3-8B` 撞上了一个怪结果,整理成脚本 `part02/schema_thinking.py`:

```python
# agent-zero-lab/part02/schema_thinking.py
from common.llm import LLMClient
from part02.messy_tickets import MESSY
from part02.schema_run import SCHEMA_MODE

client = LLMClient(env_file=".env.sf", model="Qwen/Qwen3-8B")
ticket, _ = MESSY[0]
for thinking in ("disabled", "enabled"):
    r = client.chat(
        [{"role": "user", "content": ticket}],
        temperature=0,
        max_tokens=300,
        response_format=SCHEMA_MODE,
        extra_body={"thinking": {"type": thinking}},
    )
    print(f"思考 {thinking}: finish={r.finish_reason} 输出 {r.completion_tokens} tokens, 思考过程 {len(r.reasoning or '')} 字")
    print(f"    content 前 50 字符: {r.content[:50]!r}")
```

<div class="line-notes">

- `client = LLMClient(env_file=".env.sf", model="Qwen/Qwen3-8B")` `model=` 覆盖 `.env.sf` 里的模型名,地址和 key 不变。这是 Day 135 讲的 `**overrides`。
- `[{"role": "user", "content": ticket}],` 故意不给 system 提示词,只把工单原文发过去。格式要求只在 schema 里。
- `extra_body={"thinking": {"type": thinking}},` `LLMClient` 把它和 `.env.sf` 里的 `LLM_EXTRA_BODY` 合并,后传的覆盖先读的,所以这里能把思考打开。
- `len(r.reasoning or '')` 思考过程在 `reasoning` 字段(Day 136 讲过 DeepSeek 的 `reasoning_content`);没有思考时它是 `None`,`or ''` 让 `len` 不报错。
- `r.content[:50]` 只看正文前 50 个字符。

</div>

```bash
uv run python -m part02.schema_thinking
```

```text
思考 disabled: finish=stop 输出 54 tokens, 思考过程 0 字
    content 前 50 字符: '{\n  "asked": "2026-10-20",\n  "bought": "2026-09-01'
思考 enabled: finish=length 输出 890 tokens, 思考过程 1017 字
    content 前 50 字符: '{\n\n   \n    \n   \n    \n   \n    \n   \n    \n   \n    \n  '
```

关思考时一切正常。开思考后,模型先想了 1017 个字,然后正文只写出一个 `{`,接下来全是换行和空格,一直写到 `max_tokens` 用完,`finish=length`。这个 JSON 永远不会完整。

为什么?空格和换行在 JSON 语法里是合法的(两个 token 之间可以随便加空白),所以约束解码不会把它们划掉。模型的思考过程里没看到格式要求(提示词里什么都没说),到了正文,它最想写的东西全被 schema 禁了,剩下合法又「最不离谱」的选项就是空白,于是一路写空白。OpenAI 的 JSON mode 文档里也专门提醒过类似情况:不在消息里告诉模型要输出 JSON,它可能一直生成空白直到 token 上限。

这个坑我只在 Qwen3-8B 开思考、提示词不提格式时撞到,换别的组合未必出现。教训很直接:**schema 约束了,提示词里照样要说清楚格式**;抽取任务一般用不着思考模式,关掉更省钱也更稳。这次我没查到 Qwen3-8B 在硅基流动的单价,这两次调用一共约 950 个输出 token,按 V4 Flash 的输出价算也不到 1 分钱。

## 三层怎么选,今天补完

把 Day 147 和今天合起来:

- 提示词永远写清每个字段的意思和格式。今天两次看到,schema 再严,提示词不说清楚就会出内容错(日期填错、不会用 null、思考模式下写空白)。
- 厂商支持 schema 约束就用,同一份 schema 发给服务端。键名、类型、枚举、日期格式从「大概率对」变成「一定对」,今天「随口要 + schema」18 次格式全过就是证据。
- 不支持的(比如 DeepSeek 官方),用 JSON mode,把 schema 或格式写进提示词。
- 不管用哪一层,本地都要再检查一次,而且检查 `finish_reason`。本地检查可以直接用同一份 schema 跑 `jsonschema`,明天换成更顺手的 pydantic。

## 动手练习

练习 1 不调 API;练习 2 调 3 次、练习 3 调 1 次,合计不到 1 分钱。

**练习 1:写一份分诊 schema,用两个新关键字。** 假设一张工单要分诊成两个字段:`category`(billing/technical/account/other 四选一,前几周分类时用过 `billing` 这种类别)和 `urgency`(1 到 5 的整数)。写一份 schema,用 `minimum` 和 `maximum` 限制 urgency 的范围,再用 `jsonschema` 检查四份数据:全对的、大写 `Billing` 加 urgency 7、urgency 2.5、缺 urgency。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex148_keywords.py
from jsonschema import Draft202012Validator

TRIAGE_SCHEMA = {
    "type": "object",
    "properties": {
        "category": {"type": "string", "enum": ["billing", "technical", "account", "other"]},
        "urgency": {"type": "integer", "minimum": 1, "maximum": 5},
    },
    "required": ["category", "urgency"],
    "additionalProperties": False,
}

validator = Draft202012Validator(TRIAGE_SCHEMA)
for data in (
    {"category": "billing", "urgency": 4},
    {"category": "Billing", "urgency": 7},
    {"category": "other", "urgency": 2.5},
    {"category": "other"},
):
    print(data, "→", [e.message for e in validator.iter_errors(data)] or "通过")
```

<div class="line-notes">

- `"urgency": {"type": "integer", "minimum": 1, "maximum": 5},` `minimum`/`maximum` 是「大于等于」「小于等于」,两端都包含。要不含端点用 `exclusiveMinimum`/`exclusiveMaximum`。
- `{"category": "Billing", "urgency": 7},` 两个错:大小写不对(`enum` 是精确比较,区分大小写),7 超出上限。
- `{"category": "other", "urgency": 2.5},` 小数不是 `integer`。
- `[e.message for e in validator.iter_errors(data)] or "通过"` 列表推导式收集所有报错;空列表在 `or` 里算假,于是打印「通过」。

</div>

```bash
uv run python -m part02.ex148_keywords
```

```text
{'category': 'billing', 'urgency': 4} → 通过
{'category': 'Billing', 'urgency': 7} → ["'Billing' is not one of ['billing', 'technical', 'account', 'other']", '7 is greater than the maximum of 5']
{'category': 'other', 'urgency': 2.5} → ["2.5 is not of type 'integer'"]
{'category': 'other'} → ["'urgency' is a required property"]
```

这份 schema 能原样发给 OpenAI,但发给 Claude 会因为 `minimum`/`maximum` 被拒(它的文档列为不支持),那时就只能把范围写进 `description`,在本地用 `jsonschema` 兜底检查。

</details>

**练习 2:让「忘了金额」真的填 null。** 第六步里只改 schema 没用。把提示词也改成允许 null(Day 147 练习 2 的 `SPEC_NULL` 写法),配合 `NULLABLE`,在硅基流动上对「忘了金额」跑 3 次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex148_null.py
import json

from common.llm import LLMClient
from part02.extract_compare import SPEC
from part02.extract_edge import EDGE
from part02.schema_edge import NULLABLE, schema_format

SPEC_NULL = SPEC.replace("实付金额(整数,单位元)", "实付金额(整数,单位元;工单里没写金额就填 null,不要猜)")
assert SPEC_NULL != SPEC, "replace 没生效,检查原文"
ticket = EDGE[0][1]

client = LLMClient(env_file=".env.sf")
for _ in range(3):
    r = client.chat(
        [{"role": "system", "content": SPEC_NULL}, {"role": "user", "content": ticket}],
        temperature=0,
        max_tokens=300,
        response_format=schema_format(NULLABLE),
    )
    print("paid =", repr(json.loads(r.content)["paid"]))
print(client.ledger)
```

<div class="line-notes">

- `from part02.schema_edge import NULLABLE, schema_format` 第六步建的「整数或 null」schema 和包装函数。`schema_edge.py` 的调用在 `if __name__` 下面,import 不会跑 API。
- `SPEC_NULL = SPEC.replace(` 和 Day 147 练习 2 同一句改法,提示词和 schema 终于说的是同一件事。
- `assert SPEC_NULL != SPEC,` 防 `replace` 静默没生效。
- `ticket = EDGE[0][1]` 「年付的,2026-09-01 买的,2026-10-20 想退,多少钱我忘了」。
- `print("paid =", repr(json.loads(r.content)["paid"]))` JSON 的 `null` 解析成 Python 的 `None`。

</div>

```bash
uv run python -m part02.ex148_null
```

```text
paid = None
paid = None
paid = None
3 次调用 | 输入 378 / 输出 105 tokens | 约 ¥0.0021
```

提示词和 schema 一致以后,3 次都是 `None`。schema 负责「允许 null 这个值存在」,提示词负责「告诉模型什么时候该用它」,两边缺一个都不行。下游代码拿到 `None` 要转人工或追问客户,不能交给 `refund()`,这一步 Day 149 用 pydantic 的 `int | None` 来写。

</details>

**练习 3:验证硅基流动的键是按字母排的。** 写一个 schema,三个字段在 `properties` 里的顺序是 `zebra`、`mango`、`apple`(正好是字母倒序),各写一句 description(动物、水果、城市),让模型填,看输出的顺序。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex148_order.py
from common.llm import LLMClient
from part02.schema_edge import schema_format

ORDER_SCHEMA = {
    "type": "object",
    "properties": {
        "zebra": {"type": "string", "description": "随便写一个动物"},
        "mango": {"type": "string", "description": "随便写一种水果"},
        "apple": {"type": "string", "description": "随便写一个城市"},
    },
    "required": ["zebra", "mango", "apple"],
    "additionalProperties": False,
}

client = LLMClient(env_file=".env.sf")
r = client.chat(
    [{"role": "user", "content": "按要求填这三个字段"}],
    temperature=0,
    max_tokens=100,
    response_format=schema_format(ORDER_SCHEMA),
)
print(r.content)
```

<div class="line-notes">

- `"zebra": {"type": "string", "description": "随便写一个动物"},` 故意让字段名和意思对不上:`apple` 的说明是「城市」,看模型听字段名还是听说明。
- `"required": ["zebra", "mango", "apple"],` 三个都必填,排除 Claude 那种「必填在前」规则的干扰。
- `[{"role": "user", "content": "按要求填这三个字段"}],` 提示词里不提任何字段,只靠 schema。

</div>

```bash
uv run python -m part02.ex148_order
```

```text
{"apple": "苹果", "mango": "芒果", "zebra": "斑马"}
```

两个发现。第一,顺序是 `apple`、`mango`、`zebra`,字母序,和 schema 里的倒序正好相反,第四步的猜测成立。第二,`apple` 的说明是「随便写一个城市」,模型写的是「苹果」:它先写出键名 `apple`,接着就按这个英文词的意思填了。这和第四步 `asked` 填错是一回事,**字段名本身就是给模型的提示,而且比 description 更有分量**。起字段名时要起一个不会被误解的名字,比如 `refund_requested_date` 比 `asked` 清楚得多,这一点 Day 151 展开讲。

</details>

**验收标准:** 能不看文章写出 `REFUND_SCHEMA`,说出每个关键字管什么;`schema_check.py` 的四段报错能逐条对上关键字;`schema_run.py` 跑出三行结果,能解释「随口要 + schema」那 3 次错误为什么 schema 拦不住;知道 DeepSeek 官方不支持 `json_schema`、OpenAI strict 要求全部字段必填并用 `null` 表示可缺。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| JSON Schema | 用 JSON 写的数据结构说明,规定有哪些字段、什么类型、哪些必填。例:`{"type": "object", "properties": {"paid": {"type": "integer"}}}` |
| `properties` | schema 里列出对象每个字段各自规则的地方,相当于 TS interface 花括号里的内容 |
| `required` | 必须出现的字段名列表,相当于 TS 里不带 `?` 的属性 |
| `enum` | 值只能是列表中的一个,相当于 TS 的字面量联合类型 `"年付" \| "月付"` |
| `pattern` | 字符串必须匹配的正则,例 `^\d{4}-\d{2}-\d{2}$` |
| `additionalProperties` | 设为 `false` 时不许出现 `properties` 以外的字段 |
| `integer` / `number` | JSON Schema 区分整数和任意数字,JS 只有一种 number |
| strict 模式 | 请求里 `"strict": true`,服务端严格按 schema 约束解码;OpenAI 要求全部字段进 `required`、`additionalProperties: false` |
| `jsonschema` | Python 里按 JSON Schema 检查数据的库,相当于前端的 ajv |
| 硅基流动(SiliconFlow) | 国内模型托管平台,OpenAI 兼容接口,部署了 DeepSeek、Qwen 等开源模型 |
| 深拷贝(`copy.deepcopy`) | 连嵌套的字典、列表一起复制,改副本不影响原件,相当于 JS 的 `structuredClone` |

## 常见误区

**以为 schema 约束能保证值是对的。** 今天「随口要 + schema」18 次格式全过,3 次把申请日期填成购买日期,退款算成全额。schema 只管长什么样。

**以为 schema 里允许 null,模型就会在不知道时填 null。** 第六步 schema 允许了、说明也写了,提示词还写着「整数」,模型照样填 0。提示词和 schema 要说同一件事。

**以为各家输出键的顺序都按 schema 写的来。** OpenAI 按 schema 顺序,Claude 必填在前,硅基流动实测是字母序。顺序会影响模型先想什么,进而影响值。

**用了 schema 就不在提示词里写格式。** Qwen3-8B 开思考、提示词不提格式,输出了一个 `{` 加 800 多个 token 的空白,直到 `finish=length`。

**把 OpenAI 的 strict 写法照搬到 Claude。** `minimum`、`maximum`、`minLength` 这类约束 Claude 不支持,会 400。发之前先看目标厂商的支持列表,不支持的放进 `description`,本地再用 `jsonschema` 检查。

**改 schema 副本时直接赋值或浅拷贝。** `NULLABLE = REFUND_SCHEMA` 再改 `paid` 的类型,原来的 `REFUND_SCHEMA` 也被改了,别的脚本跟着出怪结果。嵌套字典要 `copy.deepcopy`。

**换平台忘了关思考。** 硅基流动上 DeepSeek-V4-Flash 默认开思考,我第一次跑 54 次花了 ¥0.1094,关掉后同样的活 ¥0.0329。

## 学习资料

### 文档与文章

- [JSON Schema 官方:Getting started step-by-step](https://json-schema.org/learn/getting-started-step-by-step):英文,从一个商品目录例子一步步加关键字,和今天第一步的顺序很像,半小时能读完。
- [Understanding JSON Schema · object](https://json-schema.org/understanding-json-schema/reference/object):英文,`properties`、`required`、`additionalProperties` 的完整说明和例子,写 schema 时当字典查。
- [jsonschema 库文档](https://python-jsonschema.readthedocs.io/en/stable/):英文,看「Schema Validation」一节的 `validate` 和 `iter_errors`。
- [OpenAI:Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs):英文,重点看「Supported schemas」一节,strict 模式的全部规矩和数量上限都在那。
- [Claude:Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs):英文,看「JSON Schema limitations」和「Property ordering」两段。
- [阿里云百炼:结构化输出](https://help.aliyun.com/zh/model-studio/json-mode):中文,哪些 Qwen 模型支持 `json_schema`,以及 JSON mode 的 json 关键字规矩。
- [硅基流动:JSON 模式](https://docs.siliconflow.cn/cn/userguide/guides/json-mode):中文,只写了 `json_object`;今天用的 `json_schema` 是实测能用、文档没写的能力,用在正式项目前要再确认一次。
- [DeepSeek:JSON Output](https://api-docs.deepseek.com/zh-cn/guides/json_mode):中文,昨天读过,对照今天的表再看一遍它缺了什么。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1biuA6mEgJ&autoplay=0&high_quality=1" title="JSON Schema是什么？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员凌峰 · JSON Schema是什么? · 5 分钟,2026 年 8 月。用「菜和菜谱」打比方讲 JSON 和 JSON Schema 的区别,type、properties、required 三个关键字,适合先看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1nKHe6XEXL&autoplay=0&high_quality=1" title="让 AI 回传可靠的 JSON｜Structured Output 教学｜JSON Schema" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>CodingStartup起码课 · 让 AI 回传可靠的 JSON|Structured Output 教学|JSON Schema · 8 分钟,2026 年 10 月,粤语区作者、简体字幕。用茶餐厅点单做例子,同一张单真实调用很多次,从最脆弱的做法一路走到 schema 约束,和 Day 147、148 的思路一样,可以对照着看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/dtLl37W68g8" title="An Introduction to JSON Schema: A Practical Look" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Erik Wilde · An Introduction to JSON Schema: A Practical Look · 英文。作者长期做 API 设计,讲 schema 在 API 里怎么用、关键字怎么组合,比今天讲得更系统。</figcaption>
</figure>

### 书籍

- 《Understanding JSON Schema》(Michael Droettboom 等,json-schema.org 免费在线版,[链接](https://json-schema.org/understanding-json-schema)):JSON Schema 官方推荐的入门书,按类型分章,今天用到的都在「object」「string」「numeric」三章。没有中文版。
- Chip Huyen《AI Engineering》(O'Reilly,2025)第 2 章讲结构化输出的那一节,昨天推荐过,今天读完再看一遍「约束采样」那段会更有体会。

### 开源项目与代码

- [python-jsonschema/jsonschema](https://github.com/python-jsonschema/jsonschema):今天用的校验库源码。
- [json-schema-org/JSON-Schema-Test-Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite):官方测试集,每个关键字什么数据算合格、什么不算,一条条写成了 JSON,想弄清某个关键字的边界时翻它最快。
- [mlc-ai/xgrammar](https://github.com/mlc-ai/xgrammar):一个把 JSON Schema 编译成约束解码规则的引擎,vLLM、SGLang 这些推理框架都集成了它。很多托管平台的 `json_schema` 背后就是这类引擎(硅基流动具体用的哪个没公开)。

## 自测

1. `required` 和 `additionalProperties: false` 各防的是哪种错?各举一个今天的例子。

<details><summary>答案</summary>

`required` 防缺字段:「中文键」那份数据缺了 plan、paid、bought、asked 四个字段,报四条「is a required property」。`additionalProperties: false` 防多字段:「多一个键」那份多了 `note`,报「Additional properties are not allowed」。两个配合起来,才能保证字段「不多不少」。

</details>

2. 想让 `paid` 在工单没写金额时可以缺,在 OpenAI strict 模式下应该怎么写?为什么不能直接从 `required` 里删掉?

<details><summary>答案</summary>

把类型写成 `"type": ["integer", "null"]`,仍然保留在 `required` 里。OpenAI strict 要求每个字段都必须出现在 `required` 中,删掉会被拒。用 `null` 表示「没有」,字段始终在,下游代码只要判断是不是 `None`。同时提示词里要说清楚什么时候填 null,练习 2 证明只改 schema 不够。

</details>

3. 「随口要 + JSON mode」0/18,「随口要 + schema」15/18,提示词一样,差别从哪来?剩下 3 次为什么还错?

<details><summary>答案</summary>

JSON mode 只保证是合法 JSON,键名由模型自己定,它用了中文键;schema 约束在生成时把不合格的 token 划掉,键名、枚举、日期格式只能按 schema 来,所以格式全过。剩下 3 次错在值:硅基流动按字母序先生成 `asked`,提示词又没解释 `asked` 是申请日期,模型填了工单里第一个出现的日期 9 月 1 日。格式合法,schema 管不了。

</details>

4. 为什么约束解码下模型会一直输出空白,直到 `max_tokens` 用完?

<details><summary>答案</summary>

JSON 语法允许 token 之间有任意空白,所以空格和换行永远是「合格」的候选,不会被划掉。如果模型想写的内容全被 schema 禁了(比如它没在提示词里看到格式要求,想写一段解释),剩下最可能的合格选项就是空白,于是一直写空白。今天在 Qwen3-8B 开思考、提示词不提格式时实测到。办法是提示词里写清格式、抽取任务关思考、检查 `finish_reason`。

</details>

5. 面试题:「你们的 Agent 需要从用户输入里抽结构化字段,同时要支持 DeepSeek 和 OpenAI 两家,你怎么设计?」

<details><summary>答案</summary>

一份 JSON Schema(或 pydantic 模型生成的 schema)做唯一的结构定义,三处共用:OpenAI 走 `response_format` 的 `json_schema` 加 `strict: true`,DeepSeek 官方不支持就开 `json_object` 并把 schema 写进提示词;两家的提示词都写清每个字段的含义和缺失时填 null;程序这边不管哪家都用同一份 schema 在本地校验,并检查 `finish_reason`,校验失败把错误喂回去重试、有次数上限。schema 写成 strict 兼容的样子(全部必填、可缺用 null、`additionalProperties: false`),避开 Claude 等不支持的数值约束。最后要说明 schema 只保证格式,值对不对靠提示词、字段命名和评测集来保证。

</details>

6. 为什么改 schema 副本要用 `copy.deepcopy`,用 `REFUND_SCHEMA.copy()` 会怎样?

<details><summary>答案</summary>

`.copy()` 是浅拷贝,只复制最外层字典,`properties` 以及里面的 `paid` 字典还是和原件共用同一个对象。改 `NULLABLE["properties"]["paid"]["type"]` 时,`REFUND_SCHEMA` 里的 `paid` 也会变成 `["integer", "null"]`,其他用 `REFUND_SCHEMA` 的脚本就悄悄换了规则。`deepcopy` 把每一层都复制一份,改副本不影响原件。

</details>

## 明天预告

Day 149 · 结构化输出(三):用 pydantic 定义 schema。今天手写的 `REFUND_SCHEMA` 有十几行嵌套字典,写起来容易漏逗号,本地检查又要另外装 `jsonschema`。明天用 [Day 51](/blog/agent-zero/day-051-pydantic-1/) 学过的 pydantic 写一个 `RefundFields` 类,`model_json_schema()` 一行生成同样的 schema 发给服务端,`model_validate_json()` 一行完成本地检查,还能直接拿到 `date` 类型的日期。
