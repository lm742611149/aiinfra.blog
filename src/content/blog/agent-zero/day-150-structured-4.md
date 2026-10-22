---
title: 'Day 150 · 结构化输出(四):校验失败把错误喂回去重试'
description: '给 RefundFields 加一条 schema 写不出来的业务规则「申请日期不能早于购买日期」,让一个 7B 小模型撞上它:原样重试三次错三次,把 pydantic 的报错原文喂回去,第二次就改了,有一次却改成了「满足规则但仍然错」的 2027 年。然后把这套「生成、校验、带错误重试」写成通用的 common/structured.py 里的 extract(),用假客户端走一遍截断、空内容、一直错四种分支,再在真模型上量重试的代价。'
pubDate: 2026-10-22
regime: none
tags: ['structured-output', 'pydantic', 'retry', 'agent-zero']
series: 'agent-zero'
day: 150
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 149](/blog/agent-zero/day-149-structured-3/) 用一个 pydantic 类 `RefundFields` 统一了三件事:`model_json_schema()` 生成 schema(发给服务端或写进提示词)、`model_validate_json()` 校验模型输出、拿到的对象直接交给 `refund()`。那天在 DeepSeek 官方上用 `schema_prompt()` 把 schema 写进提示词,18 次全过。

那天每次校验失败,代码只是记一笔就跳过了。可 `ValidationError` 的报错写得很具体:哪个字段、违反了什么规则、收到了什么值。今天就用它:失败了不扔掉,把报错原文告诉模型,让它改。

## 今天要解决的问题

学完今天你应该能做到:

1. 用 `model_validator` 给 pydantic 类加一条 schema 表达不了的业务规则,并说清它为什么不会出现在 schema 里。
2. 演示「原样重试」和「把错误喂回去重试」的区别,说出后者每次多发了哪两条消息。
3. 写出通用的 `extract()`:有次数上限,把「被截断」「返回空内容」和「校验失败」分开处理,超过上限抛 `ExtractionError`。
4. 用假客户端不花钱地测完 `extract()` 的每个分支,再在真模型上量出重试多花了多少次调用。

预计用时:2.5 小时。前置:[Day 149](/blog/agent-zero/day-149-structured-3/)(`RefundFields`、`schema_prompt()`、`model_run.py` 的 `money()`)、[Day 52](/blog/agent-zero/day-052-pydantic-2/)(validator)、[Day 49](/blog/agent-zero/day-049-type-hints-4/)(`Protocol` 和泛型)、[Day 129](/blog/agent-zero/day-129-messages/)(messages 就是记忆)、[Day 75](/blog/agent-zero/day-075-logging/)(logging)、[Day 137](/blog/agent-zero/day-137-llm-client-3/)(假客户端)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `common/structured.py` 里的 `extract()`;再做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先要有一个会失败的例子

想演示重试,得先让模型失败。可前几天的结果太好了:DeepSeek V4 Flash 在 6 张工单上动不动就 18/18。

所以今天换一个更小、更便宜的模型:硅基流动上的 `Qwen/Qwen2.5-7B-Instruct`,只有 70 亿参数。真实项目里也常这么做,抽取这种活儿量大,能用小模型就用小模型,出错了靠校验和重试兜住。它的单价我在硅基流动定价页上没找到,今天 `LLMClient` 还按 [Day 148](/blog/agent-zero/day-148-structured-2/) `.env.sf` 里 V4 Flash 的价格(输入 ¥3、输出 ¥9 每百万 token)记账,算出来的钱只会比实际多。

我先用 Day 149 的 `schema_prompt()` 在它上面跑了一遍 6 张工单(探路用的脚本,不贴了),5 张没问题,第 1 张是这样的:

```text
{"plan": "年付", "paid": 2388, "bought": "2026-09-01", "asked": "2023-10-20"}
```

工单原文是「我 2026 年 9 月 1 号买的年费会员,花了 2388,今天 10 月 20 号,想退掉」。「今天 10 月 20 号」没写年份,小模型给了一个 2023。格式完全合法,`RefundFields` 校验通过,交给 `refund()`:申请日期减购买日期是负数,小于 30 天,按「30 天内全额退」算出 2388,正确答案是 1871。

这个错 schema 拦不住,因为「申请日期不能早于购买日期」这种规则 JSON Schema 根本写不出来。它要在 pydantic 这一侧写。

## 第一步:用 model_validator 加一条业务规则

[Day 52](/blog/agent-zero/day-052-pydantic-2/) 学过 `field_validator`,一次检查一个字段。这条规则要同时看 `asked` 和 `bought` 两个字段,用 `model_validator(mode="after")`:等所有字段都校验完、对象建好以后,再跑一个检查整个对象的函数。新建 `part02/refund_rules.py`:

```python
# agent-zero-lab/part02/refund_rules.py
from typing import Self

from pydantic import model_validator

from part02.refund_model import RefundFields


# RefundFields 再加一条业务规则:申请日期不能早于购买日期
class RefundChecked(RefundFields):
    """从一张退款工单里抽出的四个字段。"""

    @model_validator(mode="after")
    def asked_not_before_bought(self) -> Self:
        if self.asked < self.bought:
            raise ValueError(f"申请日期 asked={self.asked} 早于购买日期 bought={self.bought},不可能,请对照工单原文重新确认两个日期")
        return self


if __name__ == "__main__":
    print(RefundChecked.model_validate_json('{"plan": "年付", "paid": 2388, "bought": "2026-09-01", "asked": "2026-10-20"}'))
    print(RefundChecked.model_validate_json('{"plan": "年付", "paid": 2388, "bought": "2026-09-01", "asked": "2023-10-20"}'))
```

<div class="line-notes">

- `from typing import Self` `Self` 表示「这个类自己的类型」,用在返回自身的方法上。Python 3.11 起才有。
- `from pydantic import model_validator` 装饰器(`@` 写在函数上面,[Day 52](/blog/agent-zero/day-052-pydantic-2/) 的 `field_validator` 就是这么用的;装饰器的原理 [Day 96](/blog/agent-zero/day-096-decorators/) 才讲,现在会用就行),把下面的方法注册成整个模型的校验函数。
- `class RefundChecked(RefundFields):` 继承 Day 149 的 `RefundFields`,四个字段和 `extra="forbid"` 全部继承下来,只多一条规则。
- `"""从一张退款工单里抽出的四个字段。"""` 文档字符串和父类一模一样。故意的:文档字符串会进 schema 的 `description`,也就是会写进提示词给模型看。我第一次写成了「再加一条业务规则:申请日期不能早于购买日期」,这样规则就提前告诉模型了,今天想演示的「先错、再被纠正」就看不到。给人看的说明放在类上面的 `#` 注释里。
- `@model_validator(mode="after")` `mode="after"` 表示在每个字段都按类型校验完以后运行,这时 `self.asked`、`self.bought` 已经是 `date` 对象了,可以直接比大小。
- `def asked_not_before_bought(self) -> Self:` 方法名随便起,起一个读得懂的。
- `if self.asked < self.bought:` 两个 `date` 可以直接用 `<` 比较,早的小。实测第二份数据 `2023-10-20 < 2026-09-01` 为真。
- `raise ValueError(f"申请日期 asked={self.asked}` 在校验函数里抛 `ValueError`,pydantic 会把它包装成 `ValidationError`,和类型错误走同一条路。这句话要写得让**模型**看得懂、知道怎么改,下面就会把它原样发给模型。
- `return self` 检查通过要把对象返回。忘了写这一行,pydantic 会报错。

</div>

```bash
cd agent-zero-lab
uv run python -m part02.refund_rules
```

```text
plan='年付' paid=2388 bought=datetime.date(2026, 9, 1) asked=datetime.date(2026, 10, 20)
Traceback (most recent call last):
  ...
pydantic_core._pydantic_core.ValidationError: 1 validation error for RefundChecked
  Value error, 申请日期 asked=2023-10-20 早于购买日期 bought=2026-09-01,不可能,请对照工单原文重新确认两个日期 [type=value_error, input_value={'plan': '年付', 'paid'..., 'asked': '2023-10-20'}, input_type=dict]
    For further information visit https://errors.pydantic.dev/2.14/v/value_error
```

第一份通过,第二份被拦。报错的第二行就是我们写的那句话,前面加了 `Value error,`,后面是 pydantic 附带的类型和输入值。

再确认一件事:这条规则进不进 schema?把两个类的 `model_json_schema()` 比一比,不一样的键只有一个:

```text
{'title': ('RefundChecked', 'RefundFields')}
```

只有类名不同。**`model_validator` 里的规则不会进 schema**,服务端约束不了它,写进提示词的 schema 里也看不到它。模型只有在违反之后,通过报错才知道有这条规则。这正是「把错误喂回去」存在的理由。

## 第二步:原样重试,行不行

最直觉的做法:失败了就再问一次。[Day 127](/blog/agent-zero/day-127-retry-backoff/) 学过网络错误的重试,429、503 再试一次往往就好了。这里也这么干。新建 `part02/retry_naive.py`:

```python
# agent-zero-lab/part02/retry_naive.py
from pydantic import ValidationError

from common.llm import LLMClient
from part02.extract_compare import ASK
from part02.messy_tickets import MESSY
from part02.refund_rules import RefundChecked
from part02.schema_prompt import schema_prompt

client = LLMClient(env_file=".env.sf", model="Qwen/Qwen2.5-7B-Instruct")
messages = [
    {"role": "system", "content": ASK + "\n\n" + schema_prompt(RefundChecked)},
    {"role": "user", "content": MESSY[0][0]},
]
for attempt in range(1, 4):
    r = client.chat(messages, temperature=0, max_tokens=300, response_format={"type": "json_object"})
    try:
        info = RefundChecked.model_validate_json(r.content)
        print(f"第 {attempt} 次通过: {info!r}")
        break
    except ValidationError as e:
        print(f"第 {attempt} 次失败: {e.errors()[0]['msg']}")
print(client.ledger)
```

<div class="line-notes">

- `client = LLMClient(env_file=".env.sf", model="Qwen/Qwen2.5-7B-Instruct")` 地址和 key 用硅基流动那份,模型名覆盖成 7B 小模型。
- `{"role": "system", "content": ASK + "\n\n" + schema_prompt(RefundChecked)},` 和 Day 149 第五步同一个写法:「随口要」那句加 schema。
- `{"role": "user", "content": MESSY[0][0]},` 只跑第 1 张,就是会出 2023 的那张。
- `for attempt in range(1, 4):` 1、2、3,最多三次。`range(1, 4)` 不含 4。
- `r = client.chat(messages, temperature=0,` 每次发的 `messages` 完全一样。
- `break` 通过了就跳出循环,不再重试。
- `except ValidationError as e:` 失败只打印,`messages` 不动,下一轮原样再发。

</div>

```bash
uv run python -m part02.retry_naive
```

```text
第 1 次失败: Value error, 申请日期 asked=2023-10-20 早于购买日期 bought=2026-09-01,不可能,请对照工单原文重新确认两个日期
第 2 次失败: Value error, 申请日期 asked=2023-10-20 早于购买日期 bought=2026-09-01,不可能,请对照工单原文重新确认两个日期
第 3 次失败: Value error, 申请日期 asked=2023-10-20 早于购买日期 bought=2026-09-01,不可能,请对照工单原文重新确认两个日期
3 次调用 | 输入 849 / 输出 144 tokens | 约 ¥0.0038
```

三次一模一样的错。道理很简单:模型没有记忆([Day 129](/blog/agent-zero/day-129-messages/)),你发的输入一字不差,`temperature=0` 又让它每次挑最可能的那个 token,它当然给你同一个答案。它根本不知道上一次错了。

网络错误重试有用,是因为错的是「路上」,模型那边没问题;这里错的是模型的判断,同样的输入换不来不同的判断。**原样重试只适合偶然的失败,对确定性的错误没用。**

## 第三步:把错误喂回去

改成这样:失败以后,往 `messages` 里追加两条。先把模型这次的回答作为 assistant 消息放回去,让它看到自己刚才写了什么;再加一条 user 消息,把 pydantic 的报错原文贴进去,请它改。新建 `part02/retry_feedback.py`:

```python
# agent-zero-lab/part02/retry_feedback.py
from pydantic import ValidationError

from common.llm import LLMClient
from part02.extract_compare import ASK
from part02.messy_tickets import MESSY
from part02.refund_rules import RefundChecked
from part02.schema_prompt import schema_prompt

client = LLMClient(env_file=".env.sf", model="Qwen/Qwen2.5-7B-Instruct")
messages = [
    {"role": "system", "content": ASK + "\n\n" + schema_prompt(RefundChecked)},
    {"role": "user", "content": MESSY[0][0]},
]
for attempt in range(1, 4):
    r = client.chat(messages, temperature=0, max_tokens=300, response_format={"type": "json_object"})
    print(f"第 {attempt} 次发了 {len(messages)} 条消息,模型回: {r.content}")
    try:
        info = RefundChecked.model_validate_json(r.content)
        print(f"第 {attempt} 次通过: {info!r}")
        break
    except ValidationError as e:
        print(f"第 {attempt} 次失败: {e.errors()[0]['msg']}")
        messages.append(r.message)
        messages.append({"role": "user", "content": f"你的输出没有通过校验,错误如下:\n{e}\n请修正后重新输出完整的 json。"})
print(client.ledger)
```

<div class="line-notes">

- `print(f"第 {attempt} 次发了 {len(messages)} 条消息` 打印每次请求带了几条消息,看 messages 怎么长大。
- `messages.append(r.message)` `r.message` 是 `LLMClient` 返回的 assistant 消息字典(Day 135–136 设计 `ChatResult` 时专门留的字段,就是为了能原样追加回历史),这里是 `{"role": "assistant", "content": "{\"plan\": \"年付\", ... \"asked\": \"2023-10-20\"}"}`。
- `messages.append({"role": "user", "content": f"你的输出没有通过校验,错误如下:\n{e}\n请修正后重新输出完整的 json。"})` `{e}` 放的是 `str(e)`,也就是上一步终端里看到的那三行报错原文,包括我们在 `ValueError` 里写的那句「请对照工单原文重新确认两个日期」。结尾的「json」小写也是 DeepSeek 那条规矩留下的习惯,这里用的是硅基流动,不写也行。

</div>

```bash
uv run python -m part02.retry_feedback
```

我前后跑了四遍。第一遍:

```text
第 1 次发了 2 条消息,模型回: {"plan": "年付", "paid": 2388, "bought": "2026-09-01", "asked": "2023-10-20"}
第 1 次失败: Value error, 申请日期 asked=2023-10-20 早于购买日期 bought=2026-09-01,不可能,请对照工单原文重新确认两个日期
第 2 次发了 4 条消息,模型回: {"plan": "年付", "paid": 2388, "bought": "2026-09-01", "asked": "2027-10-20"}
第 2 次通过: RefundChecked(plan='年付', paid=2388, bought=datetime.date(2026, 9, 1), asked=datetime.date(2027, 10, 20))
2 次调用 | 输入 757 / 输出 96 tokens | 约 ¥0.0031
```

后面三遍完全一样,都是:

```text
第 1 次发了 2 条消息,模型回: {"plan": "年付", "paid": 2388, "bought": "2026-09-01", "asked": "2023-10-20"}
第 1 次失败: Value error, 申请日期 asked=2023-10-20 早于购买日期 bought=2026-09-01,不可能,请对照工单原文重新确认两个日期
第 2 次发了 4 条消息,模型回: {"plan": "年付", "paid": 2388, "bought": "2026-09-01", "asked": "2026-10-20"}
第 2 次通过: RefundChecked(plan='年付', paid=2388, bought=datetime.date(2026, 9, 1), asked=datetime.date(2026, 10, 20))
2 次调用 | 输入 757 / 输出 96 tokens | 约 ¥0.0031
```

先看好消息:第二次请求带了 4 条消息(system、user、模型的错误答案、我们的纠错),模型看到具体的报错,改了 `asked`,一次就通过了。和上一步「三次三错」对比,区别全在多出来的那两条消息。

再看第一遍那个 **2027-10-20**。它满足了规则(不早于购买日期),通过了校验,但它是错的,正确答案是 2026-10-20。模型读到「早于购买日期」,最省事的改法是把年份往后推,推一年推过头了。四遍里有一遍这样,说明 `temperature=0` 也不保证每次一样([Day 112](/blog/agent-zero/day-112-sampling-2/) 量过 DeepSeek 关思考时 `temperature=0` 五次五种回答,这里是同一回事)。

这个结果很重要:**重试让模型满足校验,不等于让它答对。** 校验规则只是「对」的必要条件。规则越接近真实的业务约束,重试改出来的东西越可能是对的;规则太宽(只说「不能早于」),模型可以用一个错的值去满足它。练习 3 会再加一条「不能晚于今天」,把 2027 也拦下来。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="生成、校验、带错误重试的循环">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="90" width="130" height="56" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="114" fill="var(--ink)">模型生成</text>
<text x="32" y="134" fill="var(--ink-soft)">json_object</text>
<line x1="150" y1="118" x2="200" y2="118" stroke="var(--ink-faint)"/>
<rect x="200" y="90" width="150" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="212" y="114" fill="var(--ink)">finish_reason?</text>
<text x="212" y="134" fill="var(--ink-soft)">content 空?</text>
<line x1="350" y1="118" x2="400" y2="118" stroke="var(--ink-faint)"/>
<rect x="400" y="90" width="130" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="412" y="114" fill="var(--ink)">pydantic</text>
<text x="412" y="134" fill="var(--ink-soft)">类型 + 规则</text>
<line x1="530" y1="100" x2="560" y2="60" stroke="var(--ink-faint)"/>
<text x="540" y="50" fill="var(--ink)">通过 → 返回</text>
<text x="200" y="40" fill="var(--ink-soft)">length:max_tokens 翻倍,不追加消息</text>
<text x="200" y="60" fill="var(--ink-soft)">空内容:原样再发</text>
<path d="M465 146 C 465 220, 85 220, 85 146" fill="none" stroke="var(--compute)" stroke-dasharray="5 4"/>
<text x="150" y="214" fill="var(--compute)">校验失败:追加模型的回答 + 报错原文,再发</text>
<text x="150" y="244" fill="var(--ink-faint)">每种失败都算一次;超过 max_retries 抛 ExtractionError</text>
</g>
</svg>
<figcaption>今天要写的 extract() 的流程。三种失败处理方式不同:截断要给更多空间,空内容原样重发,只有校验失败才把错误告诉模型。</figcaption>
</figure>

## 第四步:写成通用的 extract()

上面两个脚本都是写死一张工单、一个类。真实项目里到处都要抽结构化字段:退款工单、发票、简历、会议纪要。把这套逻辑写成一个通用函数,放进 `common/`,以后哪部分都能用。

这个函数比 `retry_feedback.py` 多想三件事:

- **被截断**(`finish_reason == "length"`):JSON 肯定不完整,这时让模型「修正」没用,它不缺规则,缺空间。办法是把 `max_tokens` 翻倍再试,不往 `messages` 里加东西。
- **返回空内容**:DeepSeek 文档说 JSON mode 有概率返回空 content(Day 147 提过)。这种是偶然的,原样再发一次就行。
- **次数上限**:默认重试 2 次,加上第一次最多调 3 次。三次都不行,说明不是偶然,可能是提示词有矛盾、规则写得太死、或者工单里根本没这个信息,继续调只是烧钱。超过上限就抛一个专门的异常 `ExtractionError`,让调用方决定转人工还是怎样。

Day 149 的 `schema_prompt()` 也一起搬进来,`part02/schema_prompt.py` 那份留着不动,前面几个脚本还在用它。新建 `common/structured.py`:

```python
# agent-zero-lab/common/structured.py
"""通用结构化抽取:JSON mode + schema 写进提示词 + pydantic 校验 + 带错误重试。"""
import json
import logging
from typing import Any, Protocol

from pydantic import BaseModel, ValidationError

from common.llm import ChatResult

log = logging.getLogger(__name__)


class ChatClient(Protocol):
    """任何有这个 chat 方法的对象都行:LLMClient,或者测试里的假客户端。"""

    def chat(self, messages: list[dict[str, Any]], **kw: Any) -> ChatResult: ...


class ExtractionError(Exception):
    pass


def schema_prompt(model: type[BaseModel]) -> str:
    schema = json.dumps(model.model_json_schema(), ensure_ascii=False)
    return f"只输出一个 json 对象,不要 markdown 代码块,不要解释。它必须符合这份 JSON Schema:\n<schema>\n{schema}\n</schema>"


def extract[T: BaseModel](
    client: ChatClient,
    model: type[T],
    instructions: str,
    text: str,
    max_retries: int = 2,
    max_tokens: int = 500,
) -> T:
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": f"{instructions}\n\n{schema_prompt(model)}"},
        {"role": "user", "content": text},
    ]
    last_error = ""
    for attempt in range(1, max_retries + 2):
        r = client.chat(messages, temperature=0, max_tokens=max_tokens, response_format={"type": "json_object"})
        if r.finish_reason == "length":
            max_tokens *= 2
            last_error = "输出被截断"
            log.warning("第 %d 次:输出被截断,max_tokens 调到 %d", attempt, max_tokens)
            continue
        if not r.content.strip():
            last_error = "返回了空内容"
            log.warning("第 %d 次:返回空内容,原样重试", attempt)
            continue
        try:
            return model.model_validate_json(r.content)
        except ValidationError as e:
            last_error = str(e)
            log.warning("第 %d 次校验失败:%s", attempt, [err["msg"] for err in e.errors()])
            messages.append(r.message)
            messages.append(
                {"role": "user", "content": f"你的输出没有通过校验,错误如下:\n{e}\n请修正后重新输出完整的 json。"}
            )
    raise ExtractionError(f"{max_retries + 1} 次尝试后仍失败:{last_error}")
```

<div class="line-notes">

- `"""通用结构化抽取` 文件开头的文档字符串,一句话说清这个文件的套路。
- `log = logging.getLogger(__name__)` [Day 75](/blog/agent-zero/day-075-logging/) 的写法,每个模块一个 logger。`__name__` 在这里是 `"common.structured"`,日志里能看出是谁打的。重试是要记下来的事:重试率突然升高,往往说明模型或输入变了。
- `class ChatClient(Protocol):` [Day 49](/blog/agent-zero/day-049-type-hints-4/) 的 `Protocol`,相当于 TS 的 `interface`:只要求「有一个这样签名的 `chat` 方法」,不要求继承谁。`LLMClient` 天然满足,下一步的假客户端也满足。参数写成 `client: LLMClient` 运行时照样能跑,但编辑器会在传假客户端的地方画红线。
- `def chat(self, messages: list[dict[str, Any]], **kw: Any) -> ChatResult: ...` 方法体只有 `...`,意思是「只声明签名,不实现」。
- `class ExtractionError(Exception):` 自定义异常([Day 36](/blog/agent-zero/day-036-exceptions-2/) 学过),只写 `pass` 就够。调用方可以单独 `except ExtractionError`,和网络错误(`openai.APIError`)区分开:网络错了该等一会儿再试,抽取失败了该转人工。
- `def schema_prompt(model: type[BaseModel]) -> str:` 原样搬自 Day 149。
- `def extract[T: BaseModel](` Python 3.12 的泛型写法:`T` 是一个类型变量,`T: BaseModel` 限定它必须是 `BaseModel` 的子类。相当于 TS 的 `function extract<T extends BaseModel>(...)`。效果是返回类型跟着传入的类走:传 `RefundChecked`,编辑器就知道返回的是 `RefundChecked`,`.asked` 有补全。Day 49 讲 `TypeVar` 时用的是老写法 `T = TypeVar("T", bound=BaseModel)`,意思一样。
- `model: type[T],` 传类本身,决定 schema、校验规则和返回类型。
- `instructions: str,` 任务说明,比如「从客户的退款工单里抽出四个字段」。和 schema 拼成 system 消息。
- `text: str,` 要抽取的原文,放进 user 消息。
- `max_retries: int = 2,` 重试次数。不算第一次,所以总共最多 `max_retries + 1` 次。
- `max_tokens: int = 500,` 初始的输出上限,截断时会翻倍。四个字段的 JSON 不到 60 个 token,500 很宽裕。
- `messages: list[dict[str, Any]] = [` 标注类型,因为后面要 `append` 进 `r.message`(它的类型是 `dict[str, Any]`),不标的话类型检查器会按第一行推断成「值都是 str 的字典列表」,append 那行画红线。
- `for attempt in range(1, max_retries + 2):` `max_retries=2` 时是 `range(1, 4)`,即 1、2、3。
- `if r.finish_reason == "length":` 被截断。`max_tokens *= 2` 翻倍,`continue` 直接进下一轮,`messages` 不加东西:截断的半截 JSON 没必要让模型看,它也改不了。
- `if not r.content.strip():` 空字符串或只有空白。`continue` 原样再发。
- `return model.model_validate_json(r.content)` 通过就直接返回,函数结束。
- `except ValidationError as e:` 类型错、规则错、JSON 本身不合法,都是这一个异常。
- `last_error = str(e)` 记下最近一次的报错,最后抛异常时带上,方便排查。
- `log.warning("第 %d 次校验失败:%s", attempt, [err["msg"] for err in e.errors()])` 日志里只记每个错误的 `msg`,不记整段报错,免得日志太长。`%d`、`%s` 是 logging 的占位符写法,参数放后面,真正要输出时才拼字符串。
- `messages.append(r.message)` 和上一步一样,先放回模型的错误答案。
- `{"role": "user", "content": f"你的输出没有通过校验,错误如下:\n{e}` 再放报错原文。
- `raise ExtractionError(f"{max_retries + 1} 次尝试后仍失败:{last_error}")` 循环正常跑完(一直没 `return`)才会走到这里。

</div>

## 第五步:用假客户端测完每个分支

真模型很难按你的意思「截断一次」「返回空内容一次」,而这些分支不测,上线后第一次碰到就是事故。[Day 137](/blog/agent-zero/day-137-llm-client-3/) 给 `LLMClient` 写测试时用过假客户端:一个照着剧本回答的对象,不联网、不花钱。这里写一个能按顺序吐出事先写好的回复、并记下每次收到了什么请求的假客户端。新建 `part02/extract_fake.py`:

```python
# agent-zero-lab/part02/extract_fake.py
import logging
from typing import Any

from common.llm import ChatResult
from common.structured import ExtractionError, extract
from part02.refund_rules import RefundChecked

GOOD = '{"plan": "年付", "paid": 2388, "bought": "2026-09-01", "asked": "2026-10-20"}'
EARLY = '{"plan": "年付", "paid": 2388, "bought": "2026-09-01", "asked": "2023-10-20"}'
CUT = '{"plan": "年付", "paid": 23'


class FakeClient:
    """按顺序吐出事先写好的回复,并记下每次收到的请求。"""

    def __init__(self, replies: list[tuple[str, str]]) -> None:
        self.replies = replies
        self.calls: list[dict[str, Any]] = []

    def chat(self, messages: list[dict[str, Any]], **kw: Any) -> ChatResult:
        self.calls.append({"n_messages": len(messages), "max_tokens": kw["max_tokens"]})
        content, finish = self.replies[len(self.calls) - 1]
        return ChatResult(content=content, reasoning=None, finish_reason=finish, message={"role": "assistant", "content": content})


SCENARIOS = {
    "一次就对": [(GOOD, "stop")],
    "日期错一次": [(EARLY, "stop"), (GOOD, "stop")],
    "截断一次": [(CUT, "length"), (GOOD, "stop")],
    "空内容一次": [("", "stop"), (GOOD, "stop")],
    "一直错": [(EARLY, "stop")] * 3,
}

if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    for name, replies in SCENARIOS.items():
        fake = FakeClient(replies)
        try:
            info = extract(fake, RefundChecked, "从工单里抽字段。", "(工单原文)")
            result = f"通过 asked={info.asked}"
        except ExtractionError as e:
            result = f"ExtractionError: {str(e).splitlines()[0]}"
        print(f"{name}: {result} | 每次请求 {fake.calls}")
```

<div class="line-notes">

- `GOOD = '{"plan": "年付", "paid": 2388` 三种剧本台词:正确的、日期早于购买日的、被截断的半截 JSON。
- `class FakeClient:` 没继承任何东西,只是有一个签名和 `ChatClient` 一样的 `chat` 方法,类型检查器就认它是 `ChatClient`。这就是 `Protocol` 的好处。
- `self.calls: list[dict[str, Any]] = []` 每次被调用时记一笔,测试最后看它。
- `self.calls.append({"n_messages": len(messages), "max_tokens": kw["max_tokens"]})` 记下这一次收到了几条消息、`max_tokens` 是多少。注意存的是 `len(messages)` 这个数,不是 `messages` 列表本身:`extract()` 之后还会往同一个列表里 append,存列表的话打印出来每次都是最后的样子。
- `content, finish = self.replies[len(self.calls) - 1]` 第几次调用就拿剧本的第几句。第 1 次调用时 `len(self.calls)` 已经是 1,所以减 1。
- `return ChatResult(content=content, reasoning=None` 造一个真的 `ChatResult`,其他字段(token 数、花费)用默认值 0。
- `"截断一次": [(CUT, "length"), (GOOD, "stop")],` 第一次返回半截 JSON 且 `finish_reason` 是 `length`。
- `"一直错": [(EARLY, "stop")] * 3,` 列表乘 3 就是重复三遍,三次都错。
- `logging.basicConfig(level=logging.WARNING,` 只在入口脚本里配一次日志。`%(name)s` 会打出 logger 的名字 `common.structured`。
- `info = extract(fake, RefundChecked, "从工单里抽字段。", "(工单原文)")` 假客户端不看提示词,原文随便写。
- `result = f"ExtractionError: {str(e).splitlines()[0]}"` 异常信息有好几行(里面嵌着 pydantic 的报错),只取第一行。

</div>

```bash
uv run python -m part02.extract_fake
```

```text
一次就对: 通过 asked=2026-10-20 | 每次请求 [{'n_messages': 2, 'max_tokens': 500}]
WARNING common.structured: 第 1 次校验失败:['Value error, 申请日期 asked=2023-10-20 早于购买日期 bought=2026-09-01,不可能,请对照工单原文重新确认两个日期']
日期错一次: 通过 asked=2026-10-20 | 每次请求 [{'n_messages': 2, 'max_tokens': 500}, {'n_messages': 4, 'max_tokens': 500}]
WARNING common.structured: 第 1 次:输出被截断,max_tokens 调到 1000
截断一次: 通过 asked=2026-10-20 | 每次请求 [{'n_messages': 2, 'max_tokens': 500}, {'n_messages': 2, 'max_tokens': 1000}]
WARNING common.structured: 第 1 次:返回空内容,原样重试
空内容一次: 通过 asked=2026-10-20 | 每次请求 [{'n_messages': 2, 'max_tokens': 500}, {'n_messages': 2, 'max_tokens': 500}]
WARNING common.structured: 第 1 次校验失败:['Value error, 申请日期 asked=2023-10-20 早于购买日期 bought=2026-09-01,不可能,请对照工单原文重新确认两个日期']
WARNING common.structured: 第 2 次校验失败:['Value error, 申请日期 asked=2023-10-20 早于购买日期 bought=2026-09-01,不可能,请对照工单原文重新确认两个日期']
WARNING common.structured: 第 3 次校验失败:['Value error, 申请日期 asked=2023-10-20 早于购买日期 bought=2026-09-01,不可能,请对照工单原文重新确认两个日期']
一直错: ExtractionError: 3 次尝试后仍失败:1 validation error for RefundChecked | 每次请求 [{'n_messages': 2, 'max_tokens': 500}, {'n_messages': 4, 'max_tokens': 500}, {'n_messages': 6, 'max_tokens': 500}]
```

(日志走 stderr、`print` 走 stdout,在终端里两者会按时间顺序混在一起显示,就是上面这样。如果你把输出重定向到文件,顺序可能不一样。)

每一行「每次请求」都在验证一个设计决定:

- **日期错一次**:第二次请求 4 条消息,说明错误答案和纠错消息都加进去了。
- **截断一次**:第二次 `max_tokens` 从 500 变成 1000,消息还是 2 条。截断不让模型改,只给空间。
- **空内容一次**:第二次一切照旧,原样重发。
- **一直错**:消息数 2、4、6,每失败一次涨两条;第三次以后不再调,抛出 `ExtractionError`。

整个脚本一分钱不花,把真模型很难复现的分支全走了一遍。消息数涨到 6 也提醒了一件事:每次重试都把之前的错误答案和报错全带上,输入越来越长,越重试越贵([Day 131](/blog/agent-zero/day-131-conversation-cost/) 讲过对话越长越贵)。这也是上限不能设太高的原因之一。

## 第六步:在真模型上量一量

最后用 `extract()` 在小模型上把 6 张工单跑 3 轮,对比没有业务规则的 `RefundFields` 和加了规则的 `RefundChecked`:对了几张、错了几张、放弃了几张、一共调了多少次。新建 `part02/extract_run.py`:

```python
# agent-zero-lab/part02/extract_run.py
import logging

from common.llm import LLMClient
from common.structured import ExtractionError, extract
from part02.extract_compare import ASK
from part02.messy_tickets import MESSY
from part02.model_run import money
from part02.refund_model import RefundFields
from part02.refund_rules import RefundChecked

logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")
ROUNDS = 3


def main() -> None:
    client = LLMClient(env_file=".env.sf", model="Qwen/Qwen2.5-7B-Instruct")
    for model in (RefundFields, RefundChecked):
        calls_before = client.ledger.calls
        right = wrong = gave_up = 0
        for _ in range(ROUNDS):
            for ticket, gold in MESSY:
                try:
                    info = extract(client, model, ASK, ticket)
                except ExtractionError:
                    gave_up += 1
                    continue
                if money(info) == money(RefundFields.model_validate(gold)):
                    right += 1
                else:
                    wrong += 1
                    print(f"  [{model.__name__}] 算错: {info!r}")
        n = ROUNDS * len(MESSY)
        calls = client.ledger.calls - calls_before
        print(f"{model.__name__}: 对 {right}/{n}  错 {wrong}  放弃 {gave_up}  调用 {calls} 次")
    print(client.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from part02.model_run import money` Day 149 写的 `money(info)`,参数类型标的是 `RefundFields`。`RefundChecked` 是它的子类,也能传。
- `logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")` 这次格式里不带 logger 名字,输出短一点。
- `for model in (RefundFields, RefundChecked):` 同一个循环跑两个类。类也是对象,能放进元组里遍历。
- `calls_before = client.ledger.calls` 记下开始前的调用次数,结束时相减就是这个类用了几次。
- `right = wrong = gave_up = 0` 三个计数器一起清零。
- `info = extract(client, model, ASK, ticket)` 指令用「随口要」那句 `ASK`,其余全交给 `extract()`。
- `except ExtractionError:` 三次都不行就算「放弃」,真实系统里这里是转人工。
- `if money(info) == money(RefundFields.model_validate(gold)):` 和前两天一样,按算出来的钱判对错。
- `print(f"  [{model.__name__}] 算错: {info!r}")` 格式和规则都过了但钱算错,打印出来看是什么值。

</div>

```bash
uv run python -m part02.extract_run
```

我的输出(2026-10-22 晚上,硅基流动 Qwen2.5-7B-Instruct):

```text
  [RefundFields] 算错: RefundFields(plan='年付', paid=2388, bought=datetime.date(2026, 9, 1), asked=datetime.date(2023, 10, 20))
  [RefundFields] 算错: RefundFields(plan='年付', paid=2388, bought=datetime.date(2026, 9, 1), asked=datetime.date(2023, 10, 20))
  [RefundFields] 算错: RefundFields(plan='年付', paid=2388, bought=datetime.date(2026, 9, 1), asked=datetime.date(2023, 10, 20))
RefundFields: 对 15/18  错 3  放弃 0  调用 18 次
WARNING 第 1 次校验失败:['Value error, 申请日期 asked=2023-10-20 早于购买日期 bought=2026-09-01,不可能,请对照工单原文重新确认两个日期']
WARNING 第 1 次校验失败:['Value error, 申请日期 asked=2023-10-20 早于购买日期 bought=2026-09-01,不可能,请对照工单原文重新确认两个日期']
WARNING 第 1 次校验失败:['Value error, 申请日期 asked=2023-10-20 早于购买日期 bought=2026-09-01,不可能,请对照工单原文重新确认两个日期']
RefundChecked: 对 18/18  错 0  放弃 0  调用 21 次
39 次调用 | 输入 11454 / 输出 1860 tokens | 约 ¥0.0511
```

**没有规则的 `RefundFields`:15/18。** 第 1 张工单三轮都是 `asked=2023-10-20`,格式全对,校验全过,`refund()` 算出 2388 全额退款,客户多退了 517 元。没有任何地方报错。

**加了规则的 `RefundChecked`:18/18,调用 21 次。** 第 1 张工单每轮第一次都撞上规则,把报错喂回去以后第二次全改成了正确的 2026-10-20,三轮一共多调了 3 次。这次运气好,没有出现 2027 那种「改过头」。

算一笔账:18 张工单,重试多出 3 次调用,调用次数多了 1/6。这次 39 次调用记账 ¥0.0511(按 V4 Flash 价格记的,7B 小模型实际只会更便宜),平均每张工单不到 2 厘钱。换来的是把一个会让客户多退 517 元的错误挡住。我觉得很值,但前提是那条规则写对了。

## 什么错误值得喂回去

不是所有失败都适合让模型改。今天的经验整理一下:

- **类型错、格式错、枚举错**(`"2388元"`、`"年费会员"`、`"2026-9-1"`):报错指明了字段和规则,模型几乎一次就能改对。支持 schema 约束的厂商上这类错根本不会出现。
- **业务规则错**(申请早于购买):schema 写不出来,只能靠 validator 加重试。规则要尽量贴近真实约束,并且报错要写成模型能照着改的话。规则太宽,模型会用一个错的值去满足它(2027)。
- **截断和空内容**:不是模型「理解错了」,不该让它改,换空间或原样重发。
- **工单里根本没有的信息**(「多少钱我忘了」):重试再多次,模型也只能编。这种要在 schema 里允许 `null`(Day 149 练习 3),让模型有说「不知道」的出口,而不是靠重试逼出一个数。

这个「生成 → 校验 → 带错误重试」的循环以后还会反复出现。第三部分的工具调用里,模型传的参数不对,我们把报错当成工具结果返回给它,它自己改参数再调,本质上就是今天这一套。

## 动手练习

练习 1 调 9 次小模型,约 1 分钱;练习 2、3 不调 API。

**练习 1:报错写得含糊会怎样?** 把 `retry_feedback.py` 的纠错消息换成一句「你的输出不对,请重新输出 json。」,不带具体报错,对第 1 张工单跑 3 轮,每轮最多 3 次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex150_vague.py
from pydantic import ValidationError

from common.llm import LLMClient
from part02.extract_compare import ASK
from part02.messy_tickets import MESSY
from part02.refund_rules import RefundChecked
from part02.schema_prompt import schema_prompt

client = LLMClient(env_file=".env.sf", model="Qwen/Qwen2.5-7B-Instruct")
for trial in range(1, 4):
    messages = [
        {"role": "system", "content": ASK + "\n\n" + schema_prompt(RefundChecked)},
        {"role": "user", "content": MESSY[0][0]},
    ]
    answers = []
    for attempt in range(3):
        r = client.chat(messages, temperature=0, max_tokens=300, response_format={"type": "json_object"})
        try:
            info = RefundChecked.model_validate_json(r.content)
            answers.append(f"通过 asked={info.asked}")
            break
        except ValidationError:
            answers.append("失败")
            messages.append(r.message)
            messages.append({"role": "user", "content": "你的输出不对,请重新输出 json。"})
    print(f"第 {trial} 轮: {' → '.join(answers)}")
print(client.ledger)
```

<div class="line-notes">

- `for trial in range(1, 4):` 外层三轮,每轮从头开始,`messages` 在循环里面重新建。
- `answers = []` 记下这一轮每次的结果,最后用 ` → ` 连起来打印。
- `except ValidationError:` 不需要 `e`,因为不把报错告诉模型。
- `messages.append({"role": "user", "content": "你的输出不对,请重新输出 json。"})` 和第三步唯一的区别:只说错了,不说错在哪。
- `print(f"第 {trial} 轮: {' → '.join(answers)}")` `' → '.join(列表)` 相当于 JS 的 `answers.join(" → ")`。

</div>

```bash
uv run python -m part02.ex150_vague
```

```text
第 1 轮: 失败 → 失败 → 失败
第 2 轮: 失败 → 失败 → 失败
第 3 轮: 失败 → 失败 → 失败
9 次调用 | 输入 3150 / 输出 432 tokens | 约 ¥0.0133
```

9 次全错。模型知道「不对」,但不知道哪里不对,它看自己的答案,四个字段格式都对,只能原样再交一遍。第三步带着具体报错,四遍都在第二次通过了(其中一遍通过的是错的 2027)。**喂回去的价值全在报错的内容**:哪个字段、什么规则、现在的值是多少。这也是为什么 `ValueError` 里那句话要写给模型看,写清楚哪两个字段冲突、该去原文里核对什么。

</details>

**练习 2:调用方怎么接住 ExtractionError?** 写一个 `answer_ticket(client, ticket)`:调 `extract()`(`max_retries=1`),成功就返回「自动回复:可退 X 元」,`ExtractionError` 就返回「转人工」加原因。用第五步的 `FakeClient` 测一次成功、一次两次都错。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex150_fallback.py
from common.structured import ChatClient, ExtractionError, extract
from part02.extract_fake import EARLY, GOOD, FakeClient
from part02.model_run import money
from part02.refund_rules import RefundChecked


def answer_ticket(client: ChatClient, ticket: str) -> str:
    try:
        info = extract(client, RefundChecked, "从工单里抽字段。", ticket, max_retries=1)
    except ExtractionError as e:
        return f"转人工:{str(e).splitlines()[0]}"
    return f"自动回复:可退 {money(info)} 元"


print(answer_ticket(FakeClient([(GOOD, "stop")]), "工单 A"))
print(answer_ticket(FakeClient([(EARLY, "stop"), (EARLY, "stop")]), "工单 B"))
```

<div class="line-notes">

- `from part02.extract_fake import EARLY, GOOD, FakeClient` 复用第五步的假客户端和台词。`extract_fake.py` 的演示在 `if __name__` 下面,import 不会跑。
- `def answer_ticket(client: ChatClient, ticket: str) -> str:` 参数类型写 `ChatClient`,真客户端和假客户端都能传。
- `info = extract(client, RefundChecked, "从工单里抽字段。", ticket, max_retries=1)` 重试 1 次,总共最多 2 次。
- `except ExtractionError as e:` 只接抽取失败。网络错误(`openai.APIError`)不在这里接,让它往上抛,由更外层决定是等一会儿重试还是报警。
- `return f"转人工:{str(e).splitlines()[0]}"` 把原因带上,客服接手时知道发生了什么。
- `print(answer_ticket(FakeClient([(EARLY, "stop"), (EARLY, "stop")]), "工单 B"))` 剧本两句都错,正好用完 `max_retries=1` 的两次机会。

</div>

```bash
uv run python -m part02.ex150_fallback
```

```text
自动回复:可退 1871 元
第 1 次校验失败:['Value error, 申请日期 asked=2023-10-20 早于购买日期 bought=2026-09-01,不可能,请对照工单原文重新确认两个日期']
第 2 次校验失败:['Value error, 申请日期 asked=2023-10-20 早于购买日期 bought=2026-09-01,不可能,请对照工单原文重新确认两个日期']
转人工:2 次尝试后仍失败:1 validation error for RefundChecked
```

注意中间两行日志没有 `WARNING` 前缀:这个脚本没调 `logging.basicConfig`,logging 在没配置时会用一个兜底的处理器,只把 WARNING 及以上的消息原文打到 stderr。真实项目里入口脚本都会配一次。

`extract()` 只管「抽出来或者明确失败」,失败了怎么办是业务决定,放在调用方。这样同一个 `extract()` 在退款场景可以转人工,在批量处理发票时可以记到一张「待复核」表里。

</details>

**练习 3:把 2027 也拦下来。** 第三步有一次模型把申请日期改成了 2027-10-20,满足了「不早于购买日期」。写一个 `RefundCheckedToday`,在 `RefundChecked` 的基础上再加一条「申请日期不能晚于今天」(今天固定写成 2026-10-22),用三份数据测:正确的、2027 的、2023 的。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex150_future.py
from datetime import date
from typing import Self

from pydantic import ValidationError, model_validator

from part02.refund_rules import RefundChecked

TODAY = date(2026, 10, 22)


class RefundCheckedToday(RefundChecked):
    """从一张退款工单里抽出的四个字段。"""

    @model_validator(mode="after")
    def asked_not_in_future(self) -> Self:
        if self.asked > TODAY:
            raise ValueError(f"申请日期 asked={self.asked} 晚于今天 {TODAY},客户不可能在未来申请,请对照工单原文重新确认")
        return self


for text in (
    '{"plan": "年付", "paid": 2388, "bought": "2026-09-01", "asked": "2026-10-20"}',
    '{"plan": "年付", "paid": 2388, "bought": "2026-09-01", "asked": "2027-10-20"}',
    '{"plan": "年付", "paid": 2388, "bought": "2026-09-01", "asked": "2023-10-20"}',
):
    try:
        print("通过", RefundCheckedToday.model_validate_json(text).asked)
    except ValidationError as e:
        print("拦下:", [err["msg"] for err in e.errors()])
```

<div class="line-notes">

- `TODAY = date(2026, 10, 22)` 为了结果可复现写死了。真实代码里用 `date.today()`,或者更好的做法是把「今天」作为参数从外面传进来,测试时才能控制它。
- `class RefundCheckedToday(RefundChecked):` 再继承一层。父类的 `asked_not_before_bought` 照样会跑,两条规则都生效。
- `if self.asked > TODAY:` 晚于今天就报错。
- `"asked": "2027-10-20"}'` 第三步那次「改过头」的值。
- `"asked": "2023-10-20"}'` 原来的错误,确认父类的规则还在。

</div>

```bash
uv run python -m part02.ex150_future
```

```text
通过 2026-10-20
拦下: ['Value error, 申请日期 asked=2027-10-20 晚于今天 2026-10-22,客户不可能在未来申请,请对照工单原文重新确认']
拦下: ['Value error, 申请日期 asked=2023-10-20 早于购买日期 bought=2026-09-01,不可能,请对照工单原文重新确认两个日期']
```

两条规则把 `asked` 夹在了「购买日期」和「今天」之间,2027 和 2023 都过不去。这样重试时模型能选的「满足规则」的值就少多了,改出正确答案的机会更大。但它仍然不能保证正确:在 9 月 1 日到 10 月 22 日之间随便挑一天也能通过。规则只能缩小范围,最终还是要用评测集去量正确率,这是第六部分的内容。

</details>

**验收标准:** 能默写 `extract()`,说出截断、空内容、校验失败三种情况各怎么处理、为什么;`retry_naive.py` 和 `retry_feedback.py` 的结果能解释差别在哪两条消息;`extract_fake.py` 的五个场景能对着「每次请求」逐个说清楚;能说出「重试让模型满足校验,不等于答对」的例子。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 带错误重试(re-ask) | 校验失败后,把模型的错误回答和报错原文追加进 messages 再请求一次,让模型针对性地改 |
| `model_validator(mode="after")` | pydantic 装饰器,所有字段校验完后对整个对象再做一次检查,适合跨字段的业务规则 |
| 业务规则 | 和数据格式无关、由业务决定的约束,例「申请日期不能早于购买日期」,JSON Schema 表达不了 |
| `ExtractionError` | 今天自定义的异常,表示重试到上限仍未抽取成功,调用方据此转人工或降级 |
| 重试上限 | 最多尝试的次数,`extract()` 默认重试 2 次、总共 3 次;防止确定性的错误无限烧钱 |
| `Self` | `typing.Self`,标注「返回这个类自己的对象」 |
| `def f[T: Base](...)` | Python 3.12 泛型函数写法,相当于 TS 的 `function f<T extends Base>()` |
| 假客户端(fake client) | 按剧本返回固定结果的替身对象,用来不联网地测试各个分支 |

## 常见误区

**校验失败就原样重试。** 输入一字不差,`temperature=0`,模型给的还是同一个错答案。今天三次三错。要把报错喂回去。

**只告诉模型「不对」。** 练习 1 里 9 次全错。报错要具体到字段、规则和当前的值。

**以为重试通过了就是对的。** 模型把 2023 改成 2027 满足了规则,但答案还是错的。规则是必要条件,不是充分条件。

**截断了也让模型「修正」。** 半截 JSON 不是模型理解错了,是空间不够。加大 `max_tokens`,别往 messages 里追加纠错。

**不设重试上限,或者上限设得很高。** 每重试一次消息多两条、输入更长更贵,确定性的错误重试多少次都一样。2 到 3 次足够,剩下的交给 `ExtractionError` 处理。

**把业务规则写进文档字符串,以为只是注释。** 类的文档字符串会进 schema 的 `description`,进而进提示词。想给人看的说明用 `#` 注释。

**在 `extract()` 里接住所有异常。** 网络错误和抽取失败要分开:前者等一会儿再试([Day 127](/blog/agent-zero/day-127-retry-backoff/)),后者转人工。`except Exception` 会把两者混在一起。

**用信息缺失的工单去「重试」。** 「多少钱我忘了」重试多少次模型也只能编。给它允许 `null` 的出口。

## 学习资料

### 文档与文章

- [pydantic:Validators](https://docs.pydantic.dev/latest/concepts/validators/):英文,`field_validator` 和 `model_validator` 的 before/after/wrap 几种模式,今天只用了 after。
- [instructor:Re-asking with validation](https://python.useinstructor.com/concepts/reask_validation/):英文,instructor 把今天这套循环做成了库的核心功能,这一页讲它怎么把 validator 的报错交给模型。和今天的 `extract()` 对照着读。
- [instructor:Retrying](https://python.useinstructor.com/concepts/retrying/):英文,讲它的重试次数、什么时候该重试的配置。
- [Python 文档:logging 入门](https://docs.python.org/zh-cn/3.12/howto/logging.html):中文,复习 `basicConfig` 和「没配置时 WARNING 才会显示」的规则,练习 2 那两行没前缀的日志就是这个原因。
- [PEP 695](https://peps.python.org/pep-0695/):英文,`def f[T: X]` 这种泛型写法的出处,看「Specification」开头的几个例子就够。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1SMRpBmEyG&p=4&autoplay=0&high_quality=1" title="【吴恩达最新】Pydantic用于LLM工作流" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>吴恩达AIAgent(搬运) · Pydantic用于LLM工作流 · 第 4 P「验证 LLM 响应」,约 16 分钟。DeepLearning.AI 短课的中文字幕版,讲用 pydantic 校验模型输出、失败后带着错误重新请求,和今天第三步是同一个思路。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1LYQwBFEnX&autoplay=0&high_quality=1" title="面试官问：如何保证Agent稳定输出结构化数据？？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>智能体大模型-大鱼 · 面试官问:如何保证Agent稳定输出结构化数据?? · 5 分钟,2026 年 4 月。从面试回答的角度把提示词、JSON mode、schema、校验重试串起来讲,看完对照自测第 6 题,看看你的回答比它多了哪些。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/pZ4DIH2BVqg" title="Pydantic is STILL all you need: Jason Liu" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · Pydantic is STILL all you need: Jason Liu · 英文。instructor 的作者在 AI Engineer 大会上的演讲,讲为什么用 pydantic 类当模型输出的「接口」,以及校验加重试在生产里怎么用。Day 151 讲 instructor 前看最合适。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 2 章结构化输出一节,讲到「后处理」和「重试」的取舍,今天读完正好对上。
- 今天这组不需要再加别的书。

### 开源项目与代码

- [567-labs/instructor](https://github.com/567-labs/instructor):今天这套循环的成熟版本,源码里搜 `reask` 能找到它把报错拼回 messages 的那几行,和我们的 `extract()` 对比一下它多处理了什么。
- [pydantic/pydantic](https://github.com/pydantic/pydantic):`model_validator` 的实现和大量用法例子都在 tests 目录里。

## 自测

1. 为什么原样重试三次都得到同一个错误答案?什么情况下原样重试才有用?

<details><summary>答案</summary>

模型没有记忆,每次请求的输入一字不差,`temperature=0` 下它每步都挑最可能的 token,自然给出同一个答案;它也不知道上次错了。原样重试只适合偶然的失败:网络错误、429/503、JSON mode 偶尔返回空内容,这些不是模型判断错了。

</details>

2. 把错误喂回去时,往 messages 里追加了哪两条消息?为什么要先放模型自己的错误答案?

<details><summary>答案</summary>

先追加 assistant 消息(模型这次的输出,也就是 `r.message`),再追加 user 消息(「没有通过校验,错误如下」加 `str(e)` 报错原文)。放回错误答案,模型才知道「刚才写的是什么」,报错里说的 `asked=2023-10-20` 才有上下文;只给报错,模型等于重新做一遍题,还可能犯同样的错。

</details>

3. `extract()` 遇到 `finish_reason == "length"` 时为什么不把错误喂回去?

<details><summary>答案</summary>

截断说明 `max_tokens` 不够,输出被掐断,不是模型理解错了。让它「修正」没用,它下一次照样会在同一个长度被掐断。正确做法是加大 `max_tokens` 再试,而且不往 messages 里加半截 JSON,免得输入变长又浪费 token。

</details>

4. `model_validator` 里写的规则会出现在 `model_json_schema()` 里吗?这对两种厂商(支持 schema 约束的、不支持的)意味着什么?

<details><summary>答案</summary>

不会,今天比较 `RefundChecked` 和 `RefundFields` 的 schema,只有 `title` 不同。对支持 schema 约束的厂商,服务端只能约束格式,业务规则约束不了;对写进提示词的做法,模型事先也看不到这条规则。两种情况下业务规则都只能在本地校验,违反了再通过重试告诉模型。

</details>

5. 今天有一次重试把 `asked` 改成了 2027-10-20 并通过了校验。从这件事能得出什么结论?怎么改进?

<details><summary>答案</summary>

重试让模型满足校验规则,不等于答对;规则太宽时,模型会用一个错的值去满足它。改进办法是让规则更贴近真实约束(练习 3 加了「不能晚于今天」,把范围夹在购买日期和今天之间),报错写清该去原文核对什么;但规则只能缩小范围,最终的正确率要用带标准答案的评测集去量。

</details>

6. 面试题:「LLM 抽取结构化数据,校验失败了你怎么处理?」

<details><summary>答案</summary>

先分类型。被截断就加大 `max_tokens` 重发;返回空内容原样重发;校验失败(类型错、枚举错、业务规则错)就把模型的错误回答和具体的校验报错追加进对话,让它针对性地改,报错要写清字段、规则和当前值。重试有上限,一般 2 到 3 次,因为每次重试输入更长更贵,而确定性的错误重试也没用;超过上限抛专门的异常,由业务层转人工或进待复核队列,和网络错误的重试分开处理。重试次数要记日志,重试率是质量指标。最后要说明重试只能保证满足校验,值的正确性靠更贴近业务的规则、允许 null 的出口和评测集。

</details>

## 明天预告

Day 151 · 结构化输出(五):字段顺序、抽取的坑和 instructor。这三天有个问题一直没正面回答:Day 148 硅基流动按字母序先写 `asked`,结果填错了日期;Day 149 DeepSeek 按 schema 顺序写,就没错。明天专门讲字段顺序怎么影响结果、怎么排;再看抽取任务里比格式更危险的几个坑(编造、抄错编号、过度推断);最后看 instructor 这个库怎么把今天手写的 `extract()` 变成一行。
