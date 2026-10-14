---
title: 'Day 6 · 结构化输出：JSON mode、JSON Schema、pydantic 校验与重试'
description: '程序要的不是一段话，是能直接用的数据。今天讲清 JSON mode 和 Structured Outputs 的区别、各家支持到什么程度，然后写一个通用的 extract 函数：用 pydantic 定义 schema，让模型按 schema 输出，校验失败就把错误信息喂回去让它改。最后用它从客服工单里抽取客户、订单号、诉求和情绪。'
pubDate: 2026-10-12
regime: none
tags: ['structured-output', 'json-schema', 'pydantic', 'extraction', 'agent-60']
series: 'agent-60'
day: 6
lang: 'zh'
---

## 今天要解决的问题

昨天的分类实验里，v1 出现了 `INVALID`：模型说的意思是对的，但格式不对，程序解析不了。分类只要一个词，问题还不大；如果你要从一张工单里同时拿出客户邮箱、订单号列表、问题类别、紧急程度、一句话摘要，再用这些字段去查数据库、填工单系统，格式稍微一歪整条流水线就断了。

Agent 和普通聊天机器人最大的区别之一，就是它的输出要被程序消费。工具调用本质上也是一种结构化输出（Day 8 你会看到）。所以「让模型稳定地输出合法的结构化数据」是这个岗位的基本功。

学完今天你应该能：

1. 说清 JSON mode 和 Structured Outputs（schema 约束）的区别，以及为什么后者更可靠。
2. 知道 2026 年 DeepSeek、OpenAI、Claude 各支持到什么程度，能根据厂商选择方案。
3. 用 pydantic 定义输出 schema，导出 JSON Schema 给模型。
4. 写出「校验失败把错误喂回去重试」的循环，并知道重试的边界。
5. 完成一个工单字段抽取器，带单元测试。

预计用时：4 到 5 小时。前置：Day 2 的 pydantic、Day 4 的 `LLMClient`。

今天的代码会进 `common/`，W2 的工具调用、W3 的检索结果解析、W5 的评分器都会直接用它。所以测试要写全，别图快跳过。

## 三个层次：从「求它」到「逼它」

让模型输出 JSON，可靠程度从低到高有三个层次。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="结构化输出的三个层次">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="150" width="190" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="115" y="174" text-anchor="middle" fill="var(--ink)">① 提示词要求</text>
<text x="115" y="194" text-anchor="middle" fill="var(--ink-soft)">「请只输出 JSON」</text>
<rect x="225" y="100" width="190" height="110" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="124" text-anchor="middle" fill="var(--ink)">② JSON mode</text>
<text x="320" y="144" text-anchor="middle" fill="var(--ink-soft)">保证是合法 JSON</text>
<text x="320" y="164" text-anchor="middle" fill="var(--ink-soft)">不保证字段对</text>
<rect x="430" y="40" width="190" height="170" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="525" y="64" text-anchor="middle" fill="var(--ink)">③ Structured Outputs</text>
<text x="525" y="84" text-anchor="middle" fill="var(--ink-soft)">按 JSON Schema</text>
<text x="525" y="104" text-anchor="middle" fill="var(--ink-soft)">约束解码</text>
<text x="525" y="124" text-anchor="middle" fill="var(--ink-soft)">字段、类型、枚举</text>
<text x="525" y="144" text-anchor="middle" fill="var(--ink-soft)">都由服务端保证</text>
<text x="20" y="30" fill="var(--ink-faint)">可靠程度 ↗　　　　　　　无论哪层，程序侧都要 pydantic 再校验一次</text>
</g>
</svg>
<figcaption>三个层次的结构化输出。越往右越可靠，但不是每家厂商都支持第三层。不管用哪一层，你的程序都应该再校验一遍。</figcaption>
</figure>

**第一层：提示词里要求。** 写「只输出 JSON，格式如下……」。大部分时候能用，但总有一些时候模型会在 JSON 前面加一句「好的，以下是结果：」，或者用 markdown 代码块包起来，或者漏一个字段。

**第二层：JSON mode。** 请求里加 `response_format={"type": "json_object"}`，服务端保证输出是一个合法的 JSON 对象，`json.loads` 不会失败。但它不管字段对不对：你要 `invoice_ids`，它给你 `order_ids`；你要整数，它给字符串，这些 JSON mode 都不拦。

**第三层：Structured Outputs（结构化输出）。** 你把一个 JSON Schema 交给服务端，服务端在生成每个 token 时都只允许那些「仍然符合 schema」的候选，这叫**约束解码**（constrained decoding）。回想 Day 1：模型每一步给出一个概率分布，约束解码就是在采样前把不合法的 token 概率直接置零。所以输出一定能被 schema 解析，必填字段一定在，枚举值一定在范围里。

### 2026 年 10 月各家的支持情况

| 厂商 | JSON mode | Schema 约束输出 | 备注 |
| --- | --- | --- | --- |
| DeepSeek | 支持 `json_object` | 官方文档只写了 json_object | 提示词里必须出现「json」字样并给示例；文档说有一定概率返回空 content |
| OpenAI | 支持 | 支持，`response_format` 传 `json_schema` 并设 `strict: true` | Python SDK 有 `client.chat.completions.parse(response_format=PydanticModel)` |
| Claude | 无单独的 JSON mode | 支持，`output_config.format` 传 `json_schema` | Python SDK 有 `client.messages.parse(output_format=PydanticModel)` |
| 通义千问等 | 多数支持 | 部分模型支持 | 以百炼文档为准 |

还有一种通用的「后门」：几乎所有支持工具调用的厂商，都可以把你想要的结构定义成一个工具的参数，然后强制模型调用这个工具，工具参数就是你要的 JSON。很多框架（包括下面提到的 instructor）在厂商不支持 schema 输出时就是这么干的。Day 8 学完工具调用你就明白了。

我们的默认厂商 DeepSeek 只到第二层，所以今天的方案是**第二层 + 把 schema 写进提示词 + pydantic 校验 + 失败重试**。这套方法在任何厂商上都能用；在支持第三层的厂商上，重试几乎不会被触发，但校验那一步照样保留，代价几乎为零。

还要提醒一点，约束解码也有例外。Claude 的文档列了几种：模型拒绝回答时、输出被 `max_tokens` 截断时，结果都可能不符合 schema；枚举值的大小写偶尔也会变。所以「服务端保证」不等于你的程序可以不校验。

## 用 pydantic 定义 schema

先定义我们想从工单里抽出来的东西：

```python
from typing import Literal

from pydantic import BaseModel, Field


class TicketInfo(BaseModel):
    """从一张客服工单中抽取的结构化信息。"""

    customer_name: str | None = Field(None, description="客户姓名或称呼，工单中没有就填 null")
    customer_email: str | None = Field(None, description="客户邮箱，没有就填 null")
    invoice_ids: list[str] = Field(default_factory=list, description="工单中提到的发票号，形如 INV-2026-000123，原样抄写")
    category: Literal["billing", "technical", "account", "other"]
    urgency: int = Field(ge=1, le=5, description="1 最不紧急，5 最紧急。涉及多扣钱、无法登录、数据丢失的至少为 4")
    sentiment: Literal["positive", "neutral", "negative", "angry"]
    summary: str = Field(description="用一句中文概括客户诉求，不超过 40 字")
    needs_human: bool = Field(description="是否必须人工处理：涉及退款、法律、投诉升级时为 true")
```

几个设计要点：

- **用 `Literal` 定义枚举**。导出的 JSON Schema 里会变成 `enum`，模型能看到所有合法值，校验时也会拦住范围外的值。
- **`description` 是写给模型看的**。每个字段的含义、格式、边界都写在这里，相当于把昨天提示词里的「类别定义」搬到了 schema 里。
- **可选字段明确允许 `None`**，并在描述里说「没有就填 null」。否则模型找不到信息时会编一个出来。这一点非常重要：**抽取任务最大的风险不是格式错，而是模型编造一个工单里根本没有的邮箱**。
- **数值约束用 `ge`、`le`**。注意 Claude 的 schema 约束不支持 minimum/maximum 这类数值约束，但没关系，pydantic 会在我们这一侧校验。

看一下导出的 schema：

```python
import json
print(json.dumps(TicketInfo.model_json_schema(), ensure_ascii=False, indent=2))
```

输出是一个标准 JSON Schema，`properties` 下每个字段都有 type 和 description，`category` 带 `enum`，`urgency` 带 `minimum`/`maximum`，`required` 列出了必填字段。这一大段就是我们要放进提示词里给模型看的东西。

## 校验失败怎么办：把错误喂回去

模型输出了 JSON，pydantic 校验报错，比如 `urgency` 给了 7。最朴素的办法是直接重试，但更有效的办法是**把错误信息告诉模型，让它改**：

```text
assistant：{"category": "billing", "urgency": 7, ...}
user：你的输出没有通过校验，错误如下：
      urgency: Input should be less than or equal to 5
      请修正后重新输出完整的 JSON。
```

模型看到具体的错误，第二次几乎都能改对。这个「生成 → 校验 → 带错误重试」的循环是结构化输出的标准模式，instructor 这类库的核心就是它。它在 Agent 里还会以另一种形式反复出现：工具调用参数错了，把报错作为工具结果返回，模型自己改参数重试（Day 12）。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="生成、校验、带错误重试的循环">
<rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="80" width="120" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="80" y="110" text-anchor="middle" fill="var(--ink)">模型生成 JSON</text>
<rect x="200" y="80" width="140" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="270" y="102" text-anchor="middle" fill="var(--ink)">json.loads +</text>
<text x="270" y="120" text-anchor="middle" fill="var(--ink)">pydantic 校验</text>
<rect x="420" y="30" width="190" height="40" rx="6" fill="none" stroke="var(--rule)"/>
<text x="515" y="55" text-anchor="middle" fill="var(--ink)">通过：返回对象</text>
<rect x="420" y="140" width="190" height="50" rx="6" fill="none" stroke="var(--rule)"/>
<text x="515" y="162" text-anchor="middle" fill="var(--ink)">失败：错误信息</text>
<text x="515" y="180" text-anchor="middle" fill="var(--ink-soft)">追加进 messages</text>
<line x1="140" y1="105" x2="200" y2="105" stroke="var(--ink-soft)" stroke-width="1.5"/>
<line x1="340" y1="95" x2="420" y2="50" stroke="var(--ink-soft)" stroke-width="1.5"/>
<line x1="340" y1="115" x2="420" y2="165" stroke="var(--ink-soft)" stroke-width="1.5"/>
<path d="M420 180 C 250 215, 100 200, 80 130" fill="none" stroke="var(--compute)" stroke-width="1.5" stroke-dasharray="5 4"/>
<text x="180" y="208" fill="var(--compute)">重试（最多 N 次）</text>
</g>
</svg>
<figcaption>结构化输出的标准循环。重试时不是简单地再问一遍，而是把具体的校验错误交给模型，让它有针对性地改。超过次数上限就放弃并报错，不要无限重试。</figcaption>
</figure>

重试的边界要想清楚：

- **设上限**，一般 2 到 3 次。三次都错，说明问题不在偶然，可能是 schema 太复杂、提示词有矛盾、或者输入本身就没有这些信息，继续重试只是烧钱。
- **区分错误类型**。`finish_reason == "length"` 是被截断了，重试前应该调大 `max_tokens`，而不是让模型「修正」。content 为空（DeepSeek 文档提到的情况）直接重试即可。
- **记录每次重试**。重试率是一个很好的质量指标，某个 schema 的重试率突然升高，往往说明模型或输入分布变了。

## 字段顺序也有讲究

模型是从左到右一个 token 一个 token 生成的，JSON 也不例外。这意味着 schema 里**字段的先后顺序会影响结果**。

昨天讲过「先想再答」。在结构化输出里也可以这么做：在 schema 最前面放一个 `reasoning` 字段，描述写「先用一两句话分析工单的主要诉求」，然后才是 `category`、`urgency` 这些判断类字段。模型生成到 `category` 的时候，前面已经写好了分析，判断会更稳。反过来，如果 `reasoning` 放在最后，它就变成了「先下结论再找理由」，对准确率没有帮助。

不过要注意 Claude 文档里提到的一个细节：它的约束解码会把必填字段排在可选字段前面输出，不管你在 schema 里怎么排。所以想让推理字段先输出，就把它设成必填。

类似的道理，`summary` 这种需要综合全文的字段，放在具体抽取字段（姓名、邮箱、编号）之后比较好，模型先把细节抽一遍，再写总结时更不容易漏。

还有一个关于 schema 设计的取舍：枚举值用英文还是中文？我倾向英文小写的短词（`billing`、`technical`），原因有三个：程序里用起来方便；token 少；不同模型对英文枚举的遵守普遍更好。给人看的中文名在展示层做映射就行。

## 抽取任务的几个坑

我做过不少抽取任务，最常见的问题不是格式，而是内容：

**编造。** 工单里没有邮箱，模型给你编一个 `user@example.com`。对策是 schema 里允许 null、描述里写「没有就填 null」，并在提示词里强调「只抽取原文中出现的信息」。上线前专门准备几条「信息缺失」的测试样本。

**改写。** 订单号 `INV-2026-004417` 被抄成 `INV-2026-04417`。Day 1 讲过，长编号会被切成很多 token，模型抄写容易出错。对策是在描述里写「原样抄写」，更可靠的做法是用正则在原文里二次核对：抽出来的每个编号都必须能在原文里找到，找不到就丢弃或标记。今天的练习里会做这一步。

**过度推断。** 客户说「上个月被扣了两次」，模型在 summary 里写「客户要求退款 299 元」，但原文根本没说金额。对策是在描述里限定「概括客户的原话，不要推测」。

**schema 太大。** 一次抽二十个字段，准确率会下降，输出也更长。字段多的话考虑拆成两次调用，或者只抽真正下游要用的字段。

## 动手练习

写一个通用的 `extract()` 函数放进 `common/`，然后用它做工单抽取。

**第 1 步：通用抽取函数。**

```python
# agent-60-lab/common/structured.py
"""通用结构化抽取：JSON mode + schema 写进提示词 + pydantic 校验 + 带错误重试。"""
from __future__ import annotations

import json
import logging
from typing import Any, Protocol

from pydantic import BaseModel, ValidationError

from common.llm import ChatResult

log = logging.getLogger(__name__)


class ChatClient(Protocol):
    """任何有这个 chat 方法的对象都行：LLMClient，或者测试里的假客户端。"""

    def chat(self, messages: list[dict[str, Any]], **kw: Any) -> ChatResult: ...


class ExtractionError(Exception):
    pass


def schema_prompt(model: type[BaseModel]) -> str:
    schema = json.dumps(model.model_json_schema(), ensure_ascii=False, indent=2)
    return (
        "请只输出一个 json 对象，不要输出任何解释或 markdown 代码块。"
        f"这个 json 必须符合下面的 JSON Schema：\n<schema>\n{schema}\n</schema>"
    )


def extract[T: BaseModel](
    client: ChatClient,
    model: type[T],
    instructions: str,
    text: str,
    max_retries: int = 2,
    max_tokens: int = 1000,
) -> T:
    messages = [
        {"role": "system", "content": f"{instructions}\n\n{schema_prompt(model)}"},
        {"role": "user", "content": f"<input>\n{text}\n</input>"},
    ]
    last_error = ""
    for attempt in range(max_retries + 1):
        r = client.chat(
            messages,
            temperature=0,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
        )
        if r.finish_reason == "length":
            max_tokens *= 2
            last_error = "输出被截断"
            log.warning("第 %d 次：输出被截断，max_tokens 调到 %d", attempt + 1, max_tokens)
            continue
        if not r.content.strip():
            last_error = "返回了空内容"
            log.warning("第 %d 次：返回空内容，重试", attempt + 1)
            continue
        try:
            return model.model_validate_json(r.content)
        except ValidationError as e:
            last_error = str(e)
            log.warning("第 %d 次校验失败：%s", attempt + 1, e.errors()[:3])
            messages.append(r.message)
            messages.append({
                "role": "user",
                "content": f"你的输出没有通过校验，错误如下：\n{e}\n请修正后重新输出完整的 json。",
            })
    raise ExtractionError(f"{max_retries + 1} 次尝试后仍失败：{last_error}")
```

`model_validate_json` 一步完成「解析 JSON + 校验」，非法 JSON 也会抛 `ValidationError`，所以一个 except 就能接住两种错误。

`client` 的类型为什么不直接写 `LLMClient`，而是自己定义一个 `ChatClient`？`Protocol` 相当于 TS 的 `interface`：只要求「有一个这样签名的 `chat` 方法」，不要求是哪个类。第 3 步测试要传一个假客户端进来，如果这里写死 `LLMClient`，测试照样能跑（Python 运行时不查类型），但编辑器会在每个 `extract(c, ...)` 下面画红线。

**第 2 步：工单抽取。**

```python
# agent-60-lab/w1/extract_ticket.py
import logging
import re
from typing import Literal

from pydantic import BaseModel, Field

from common.llm import LLMClient
from common.structured import extract

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)


class TicketInfo(BaseModel):
    """从一张客服工单中抽取的结构化信息。"""

    customer_name: str | None = Field(None, description="客户姓名或称呼，工单中没有就填 null")
    customer_email: str | None = Field(None, description="客户邮箱，工单中没有就填 null，不要编造")
    invoice_ids: list[str] = Field(default_factory=list, description="工单中提到的发票号，形如 INV-2026-000123，原样抄写")
    category: Literal["billing", "technical", "account", "other"]
    urgency: int = Field(ge=1, le=5, description="1 最不紧急，5 最紧急。多扣钱、无法登录、数据丢失至少为 4")
    sentiment: Literal["positive", "neutral", "negative", "angry"]
    summary: str = Field(description="用一句中文概括客户的原话诉求，不超过 40 字，不要推测金额等原文没有的信息")
    needs_human: bool = Field(description="涉及退款、法律、投诉升级时为 true")


INSTRUCTIONS = (
    "你是云簿 CloudLedger 客服系统的工单解析器。只抽取工单原文中明确出现的信息，"
    "原文没有的字段填 null 或空列表，绝不编造。"
)

INVOICE_RE = re.compile(r"INV-\d{4}-\d{6}")


def verify_ids(info: TicketInfo, text: str) -> TicketInfo:
    """模型抄的发票号必须能在原文里找到；找不到的丢弃并告警。"""
    found = set(INVOICE_RE.findall(text))
    kept = [i for i in info.invoice_ids if i in found]
    if len(kept) != len(info.invoice_ids):
        log.warning("丢弃原文中不存在的发票号：%s", set(info.invoice_ids) - found)
    missed = found - set(kept)
    if missed:
        log.warning("模型漏抽了发票号：%s，已补上", missed)
    return info.model_copy(update={"invoice_ids": sorted(found)})


TICKETS = [
    (
        "你好，我是王磊（wanglei@example.com），INV-2026-004417 和 INV-2026-004418 是同一个月的，"
        "被扣了两次钱！！这是第三次找你们了，再不处理我就投诉到消协。"
    ),
    "导出报表一直失败，提示 E1023，麻烦看一下。",
    "请问专业版和企业版有什么区别？我们团队 12 个人。",
]


def main() -> None:
    client = LLMClient()
    for t in TICKETS:
        info = verify_ids(extract(client, TicketInfo, INSTRUCTIONS, t), t)
        print(info.model_dump_json(indent=2))
    print(client.ledger)


if __name__ == "__main__":
    main()
```

```bash
uv run python -m w1.extract_ticket
```

两个写法细节：

- `basicConfig` 只在入口脚本里配一次「日志往哪打」，打日志用自己模块的 `log = logging.getLogger(__name__)`。直接写 `logging.warning(...)` 用的是根 logger，Ruff 会提示 `LOG015`。
- 第一张工单太长，拆成了两行字符串。Python 会把**相邻的两个字符串字面量自动拼成一个**（`"ab" "cd"` 就是 `"abcd"`）。在列表里这么写要套一层括号，不然和「漏写了一个逗号」看起来一模一样，Ruff 会提示 `ISC004`。真漏了逗号的话，两张工单会悄悄合成一张，不报任何错。

跑之前先猜一下每张工单的结果，再对照实际输出。

输出是三个 JSON 对象。第一张工单应该抽出姓名、邮箱、两个发票号，类别 billing，紧急程度 4 或 5，情绪 angry，needs_human 为 true。第二张没有姓名和邮箱，这两个字段应该是 null。如果你看到模型给第二张编了一个邮箱，说明提示词约束还不够，回去加强描述。

**第 3 步：用假客户端测试重试逻辑。** 重试逻辑是确定性的代码，不应该靠真的调用模型来测。写一个假的客户端，按顺序返回预设的回复：

```python
# agent-60-lab/tests/test_structured.py
from dataclasses import dataclass, field

import pytest
from pydantic import BaseModel, Field

from common.llm import ChatResult
from common.structured import ExtractionError, extract


class Item(BaseModel):
    name: str
    qty: int = Field(ge=1)


@dataclass
class FakeClient:
    replies: list[tuple[str, str]]                   # (content, finish_reason)
    seen: list[list[dict]] = field(default_factory=list)

    def chat(self, messages, **kw) -> ChatResult:
        self.seen.append(list(messages))
        content, finish = self.replies.pop(0)
        return ChatResult(content=content, reasoning=None, finish_reason=finish,
                          message={"role": "assistant", "content": content})


def test_first_try_ok():
    c = FakeClient([('{"name": "笔", "qty": 2}', "stop")])
    assert extract(c, Item, "抽取", "两支笔") == Item(name="笔", qty=2)


def test_retry_feeds_error_back():
    c = FakeClient([('{"name": "笔", "qty": 0}', "stop"), ('{"name": "笔", "qty": 1}', "stop")])
    assert extract(c, Item, "抽取", "一支笔").qty == 1
    retry_msgs = c.seen[1]
    assert retry_msgs[-1]["role"] == "user" and "qty" in retry_msgs[-1]["content"]


def test_gives_up_after_max_retries():
    c = FakeClient([("not json", "stop")] * 3)
    with pytest.raises(ExtractionError):
        extract(c, Item, "抽取", "x", max_retries=2)


def test_empty_content_is_retried():
    c = FakeClient([("", "stop"), ('{"name": "a", "qty": 1}', "stop")])
    assert extract(c, Item, "抽取", "x").name == "a"
```

```bash
uv run pytest -q
```

这里用到一个以后会反复用的测试思路：**把「调用模型」替换成一个假对象，专门测你自己写的控制逻辑**。Python 是鸭子类型，`FakeClient` 只要有一个签名相同的 `chat` 方法就能冒充 `LLMClient`，第 1 步定义的 `ChatClient` 协议就是把这件事写给类型检查器看。W5 写评测时，确定性的部分都会这样测。

**第 4 步（可选）：试试 instructor。** instructor 是专门做结构化输出的库，把今天这套「schema + 校验 + 重试」都封装好了：

```python
# agent-60-lab/w1/try_instructor.py
import os

import instructor
from dotenv import load_dotenv
from openai import OpenAI

from w1.extract_ticket import TicketInfo

load_dotenv()   # 这里没用 LLMClient，要自己加载 .env

client = instructor.from_openai(
    OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"]),
    mode=instructor.Mode.JSON,     # 厂商不支持 schema 约束时用 JSON 模式
)
info = client.chat.completions.create(
    model=os.environ["LLM_MODEL"],
    response_model=TicketInfo,
    max_retries=2,
    messages=[{"role": "user", "content": "导出报表一直失败，提示 E1023"}],
    extra_body={"thinking": {"type": "disabled"}},
)
print(info)
```

**别用 `uv add instructor`**：我们项目的 openai 是 3.x，instructor 目前最高只支持 openai 2.x，装不上（报 `No solution found when resolving dependencies`）。用 uv 开一个临时环境跑，不动项目依赖：

```bash
uv run --no-project --with instructor --with python-dotenv python -m w1.try_instructor
```

第一次会下载 40 来个包，之后就快了。

用过自己写的版本，再看 instructor 就知道它在做什么了。如果换成支持 schema 约束的厂商，把 mode 换成对应的模式，其余代码一行不用改。生产项目里用它没问题，面试时能讲清楚它背后的循环更重要。

**验收标准：** 三张工单都抽取成功，第二张没有编造邮箱；`verify_ids` 能发现并修正模型抄错的发票号（可以手动把原文改一个数字来测试）；4 个测试全部通过。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 结构化输出 | 让模型输出符合预定结构（通常是 JSON）的数据，供程序直接使用 |
| JSON mode | `response_format={"type": "json_object"}`，保证输出是合法 JSON，不保证字段 |
| Structured Outputs | 按 JSON Schema 约束输出，字段和类型由服务端保证 |
| JSON Schema | 描述 JSON 数据结构的标准，规定字段、类型、必填、枚举等 |
| 约束解码 | 生成每个 token 时屏蔽不符合语法或 schema 的候选 |
| Literal | Python 类型标注，限定取值为几个固定值，导出为 enum |
| model_validate_json | pydantic 方法，一步完成 JSON 解析和校验 |
| instructor | 封装了结构化输出、校验、重试的开源库 |
| 抽取（extraction） | 从非结构化文本中提取指定字段 |

## 常见误区

**以为 JSON mode 就够了。** 它只保证能 parse，字段名、类型、枚举都不管。还是要校验。

**以为服务端保证了 schema 就不用校验。** 拒答、截断、大小写这些例外都会产生不合规的输出。程序侧的校验永远保留。

**必填一切。** 把所有字段都设成必填，模型找不到信息时只能编。允许 null，并在描述里说清楚。

**失败了无限重试。** 重试有上限，超过就报错并记录。持续失败的根因要去修，不要靠重试掩盖。

**让模型抄写长编号还完全相信它。** 编号、金额、日期这类关键字段，用正则或数据库在原文和系统里二次核对。

**用 temperature 1 做抽取。** 抽取要稳定，temperature 设 0。

**把 schema 写得和数据库表一模一样。** 数据库字段是给存储设计的，抽取 schema 是给模型理解设计的。字段名要能望文生义（`customer_email` 而不是 `c_eml`），描述要写清楚，必要时在程序里再做一次映射。schema 是模型的「接口文档」，接口文档写得烂，调用方就会用错。

## 学习资料

### 文档与文章

- [DeepSeek：JSON Output](https://api-docs.deepseek.com/zh-cn/guides/json_mode)：必须包含「json」字样、可能返回空 content 这两个坑都在这页。**必看**，5 分钟。
- [OpenAI：Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)：讲约束解码的原理、JSON mode 与 Structured Outputs 的区别、支持的 schema 子集。30 分钟。
- [Claude：Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)：Claude 的 schema 输出和严格工具调用，看 JSON Schema limitations 一节，了解约束解码不支持哪些 schema 特性。20 分钟。
- [openai-python helpers.md](https://github.com/openai/openai-python/blob/main/helpers.md)：`client.chat.completions.parse` 的用法和截断、过滤时抛出的异常。
- [JSON Schema 入门](https://json-schema.org/learn/getting-started-step-by-step)：没接触过 JSON Schema 的看这一页。20 分钟。
- [instructor 文档](https://python.useinstructor.com/)：看 Getting Started 和 Retrying 两节。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1SMRpBmEyG&autoplay=0&high_quality=1" title="Pydantic用于LLM工作流" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>吴恩达AIAgent（搬运）· 【吴恩达最新】Pydantic用于LLM工作流（模型基础/响应验证/API调用/工具调用实战）--Pydantic for LLM Workflows · 共 7 P、约 70 分钟，DeepLearning.AI 短课的中字版。今天看 P3「Pydantic 模型基础」、P4「验证 LLM 响应」、P5「在 API 调用中传递 Pydantic 模型」，P6 讲工具调用，留到 Day 8。</figcaption>
</figure>

- 隔壁的程序员老王《Pydantic 让数据结构与验证融为一体》（BV1JKmeY9ED2，Day 2 推荐过）：pydantic 还不熟的话先回去看这个。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/yj-wSRJwrrc" title="Pydantic is all you need: Jason Liu" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · Pydantic is all you need: Jason Liu · instructor 作者的演讲，讲为什么应该用 schema 而不是字符串来和模型打交道。2023 年的演讲，里面的 API 写法旧了，思路是今天这一课的源头。</figcaption>
</figure>

- [DeepLearning.AI《Pydantic for LLM Workflows》](https://www.deeplearning.ai/short-courses/pydantic-for-llm-workflows/)：上面 B 站视频的官方版本，带可运行的 Notebook。

### 书籍

- Chip Huyen《AI Engineering》（O'Reilly，2025）第 2 章「Understanding Foundation Models」中的「Structured Outputs」一节：讲从提示词、后处理、约束采样到微调的几种实现方式和各自的取舍，是今天这一课最好的理论补充。40 分钟。

### 开源项目与代码

- [567-labs/instructor](https://github.com/567-labs/instructor)：结构化输出的主流库，读 `instructor/retry.py`，看它的重试循环和我们写的有什么区别。
- [pydantic/pydantic](https://github.com/pydantic/pydantic)：`model_json_schema` 的实现，有兴趣再看。

## 自测

1. JSON mode 和 Structured Outputs 的核心区别是什么？

<details><summary>答案</summary>

JSON mode 只保证输出是合法的 JSON 对象，不管字段名、类型和取值；Structured Outputs 按你给的 JSON Schema 做约束解码，保证字段、类型、枚举都符合 schema（拒答、截断等例外情况除外）。

</details>

2. DeepSeek 用 JSON mode 时有哪两个文档里明确提醒的坑？

<details><summary>答案</summary>

提示词里必须出现「json」字样并最好给出格式示例；有一定概率返回空的 content。另外要合理设置 max_tokens 避免 JSON 被截断。

</details>

3. 抽取客户邮箱时，工单里根本没有邮箱，模型返回了 `customer@example.com`。怎么从 schema 和提示词两方面修？

<details><summary>答案</summary>

schema：把字段设为可选（`str | None`），描述里写「没有就填 null，不要编造」。提示词：强调「只抽取原文中明确出现的信息」。还可以在程序里做校验：抽出的邮箱必须能在原文中找到。并准备「信息缺失」的测试样本专门验证。

</details>

4. 校验失败重试时，为什么要把错误信息发给模型，而不是简单地重新请求一次？

<details><summary>答案</summary>

简单重试是在赌概率，同样的输入很可能产生同样的错误（尤其 temperature=0 时）。把具体错误（哪个字段、什么约束）告诉模型，它能有针对性地修正，成功率高得多，通常一次就能改对。

</details>

5. 一次抽取返回 `finish_reason == "length"`，应该怎么处理？

<details><summary>答案</summary>

输出被截断，JSON 不完整。不应该让模型「修正」，而是调大 max_tokens 再请求；如果反复截断，考虑减少字段、缩短描述类字段的长度要求，或者拆成多次抽取。

</details>

6. 面试题：「你们怎么保证 Agent 从合同里抽出来的金额是对的？」

<details><summary>答案</summary>

分层回答：一，schema 约束类型和格式（金额为数字、币种为枚举），用结构化输出加 pydantic 校验；二，提示词要求原样抽取并给出原文出处（引用片段）；三，程序侧二次核对，抽出的金额必须能在原文中匹配到，和系统里的订单金额交叉验证；四，低置信度或核对不一致的转人工；五，建测试集持续评估抽取准确率，特别覆盖格式多样的金额写法（大写数字、千分位、不同币种）。核心思想是不单独信任模型的输出，用确定性的规则去验证它。

</details>

## 明天预告

Day 7 · W1 复习 + 小项目：带流式输出和成本统计的命令行聊天机器人。把这一周的东西串起来：一页知识地图、小项目完整代码（多轮、流式、切换厂商、斜杠命令、每轮花费统计、对话保存和加载），再加一组 W1 的面试题和这周最容易踩的坑。
