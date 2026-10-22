---
title: 'Day 47 · 主工作流:LangGraph 编排分类、检索、执行、起草、自检'
description: 'SupportPilot 的心脏。把 LLMClient 搬进项目并加上成本账本和结构化重试,设计工作流状态,写九个节点和条件路由:查客户、分诊、检索、调工具、起草、质检、退款审批、定稿、转人工。用假 LLM 写单测覆盖审批、转人工、质检打回,最后在终端里端到端跑 10 张工单。'
pubDate: 2026-10-12
regime: none
tags: ['capstone', 'langgraph', 'workflow', 'agent-loop', 'human-in-the-loop', 'supportpilot', 'agent-60']
series: 'agent-60'
day: 47
lang: 'zh'
---

## 今天要解决的问题

前四天的零件都齐了:知识库能检索,工具能查账单、能建退款申请,数据在库里。今天把它们串成一条能处理真实工单的流水线。

今天结束时你应该做到:

1. 项目里有一个统一的 `LLMClient`:记账(花了多少钱)、结构化输出(校验失败自动重试)、流式输出(边生成边推给前端)。
2. 一张 LangGraph 图,9 个节点,4 个条件分支,每个节点做什么、为什么这么分,能讲清楚。
3. 退款申请创建后,图停在审批节点等人;人点了通过或驳回,图从停下的地方接着跑。
4. 不连数据库、不调大模型,用假 LLM 跑通 6 个单测:退款审批、转人工时作废待审批申请、纯政策问题、转人工、质检两次不过、违规承诺被拦。
5. 终端里跑 10 张演示工单,看着每一步在干什么。

预计用时 5–7 小时,是 12 天里最核心的一天。前置:Day 9(手写 Agent 循环)、Day 13(五种 workflow 模式)、Day 24–25(LangGraph 基础和人工审批)、Day 45–46。

## LLMClient:从 W1 搬过来,加三样东西

W1 的 Day 4 你封装过一个 `LLMClient`。现在搬进项目,补上产品级需要的三样东西:

```python
# supportpilot/src/supportpilot/llm.py
"""W1 的 LLMClient 搬过来,加了三样东西:成本账本、结构化输出重试、流式回调。"""

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from openai import OpenAI
from pydantic import BaseModel, ValidationError

from .config import Settings, get_settings


@dataclass
class Usage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    calls: int = 0

    def add(self, other: "Usage") -> None:
        self.prompt_tokens += other.prompt_tokens
        self.completion_tokens += other.completion_tokens
        self.calls += other.calls

    def cost_cny(self, s: Settings) -> float:
        return (self.prompt_tokens * s.price_in_per_m + self.completion_tokens * s.price_out_per_m) / 1_000_000


@dataclass
class ChatResult:
    content: str
    tool_calls: list[dict] = field(default_factory=list)  # [{"id","name","arguments"(str)}]
    usage: Usage = field(default_factory=Usage)
    raw_message: dict = field(default_factory=dict)  # 原样回传给下一轮 messages 用


class LLMClient:
    def __init__(self, settings: Settings | None = None, model: str | None = None):
        self.s = settings or get_settings()
        self.model = model or self.s.llm_model
        # max_retries 交给 SDK:429 和 5xx 会自动指数退避重试
        self.client = OpenAI(base_url=self.s.llm_base_url, api_key=self.s.llm_api_key, max_retries=3, timeout=60)
        self.ledger = Usage()  # 这个实例累计花了多少 token

    def _usage(self, u: Any) -> Usage:
        got = Usage(prompt_tokens=getattr(u, "prompt_tokens", 0) or 0,
                    completion_tokens=getattr(u, "completion_tokens", 0) or 0, calls=1)
        self.ledger.add(got)
        return got

    def chat(self, messages: list[dict], *, tools: list[dict] | None = None, temperature: float = 0.2,
             json_mode: bool = False, model: str | None = None) -> ChatResult:
        kwargs: dict[str, Any] = {"model": model or self.model, "messages": messages, "temperature": temperature}
        if tools:
            kwargs["tools"] = tools
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        if self.s.llm_extra_body:  # 比如关掉思考:{"thinking": {"type": "disabled"}}
            kwargs["extra_body"] = self.s.llm_extra_body
        resp = self.client.chat.completions.create(**kwargs)
        msg = resp.choices[0].message
        calls = [{"id": c.id, "name": c.function.name, "arguments": c.function.arguments or "{}"}
                 for c in (msg.tool_calls or [])]
        raw: dict[str, Any] = {"role": "assistant", "content": msg.content or ""}
        if calls:
            raw["tool_calls"] = [{"id": c["id"], "type": "function",
                                  "function": {"name": c["name"], "arguments": c["arguments"]}} for c in calls]
        return ChatResult(content=msg.content or "", tool_calls=calls, usage=self._usage(resp.usage), raw_message=raw)

    def stream(self, messages: list[dict], *, on_token: Callable[[str], None] | None = None,
               temperature: float = 0.3, model: str | None = None) -> ChatResult:
        """流式生成。每来一段文字就调 on_token,最后返回拼好的完整结果。"""
        resp = self.client.chat.completions.create(
            model=model or self.model, messages=messages, temperature=temperature,
            stream=True, stream_options={"include_usage": True},
            extra_body=self.s.llm_extra_body or None,
        )
        parts: list[str] = []
        last_usage = None
        for chunk in resp:
            if chunk.usage:  # 有的厂商只在最后一块带 usage,有的每块都带累计值,所以只记最后一次
                last_usage = chunk.usage
            if chunk.choices and chunk.choices[0].delta.content:
                piece = chunk.choices[0].delta.content
                parts.append(piece)
                if on_token:
                    on_token(piece)
        text = "".join(parts)
        usage = self._usage(last_usage)  # 循环结束后只入账一次
        return ChatResult(content=text, usage=usage, raw_message={"role": "assistant", "content": text})

    def structured[T: BaseModel](self, messages: list[dict], schema: type[T], *, retries: int = 2,
                                 model: str | None = None) -> T:
        """JSON mode + pydantic 校验,校验失败把错误贴回去让模型改,最多重试 retries 次。"""
        hint = ("只输出一个 JSON 对象,不要任何解释。JSON Schema 如下:\n"
                + json.dumps(schema.model_json_schema(), ensure_ascii=False))
        msgs = [*messages, {"role": "system", "content": hint}]
        last_err = ""
        for _ in range(retries + 1):
            res = self.chat(msgs, json_mode=True, temperature=0, model=model)
            try:
                return schema.model_validate_json(res.content)
            except ValidationError as e:
                last_err = str(e)[:800]
                msgs = [*msgs, res.raw_message,
                        {"role": "user", "content": f"上面的 JSON 没通过校验,错误是:\n{last_err}\n请改正后只输出 JSON。"}]
        raise ValueError(f"结构化输出重试 {retries} 次仍失败:{last_err}")
```

<div class="line-notes">

- `"""W1 的 LLMClient 搬过来` 模块说明直接写清楚比 W1 版本多了什么:账本、结构化重试、流式回调。以后有人打开这个文件,第一行就知道它的职责。
- `from collections.abc import Callable` 给 `on_token` 标类型用。`Callable[[str], None]` 读作「接收一个 str、不返回值的函数」。
- `from dataclasses import dataclass, field` `dataclass` 自动生成 `__init__`;`field(default_factory=...)` 专门给列表、字典这类可变默认值用,每个实例各拿一份新的。
- `from .config import Settings, get_settings` 点开头是包内相对导入,指同一个 `supportpilot` 包里的 `config.py`。所以这个文件只能以 `supportpilot.llm` 的身份被导入,直接 `python llm.py` 会报 `attempted relative import with no known parent package`。
- `class Usage:` 三个计数器:输入 token、输出 token、调用次数。既用来表示「一次调用花了多少」,也用来当「累计账本」。
- `def add(self, other: "Usage") -> None:` 类型写成字符串 `"Usage"` 是前向引用:写这一行时 `Usage` 类还没定义完。实测账本的变化:先 `chat` 一次是 `Usage(12, 28, 1)`,再 `structured` 一次变成 `Usage(623, 85, 2)`,再流式一次变成 `Usage(635, 97, 3)`。
- `def cost_cny(self, s: Settings) -> float:` 单价是「元 / 百万 token」,所以除以 1_000_000(数字里的下划线只是分隔符,等于 1000000)。代入上面最后的账本:635 × 2 / 1e6 + 97 × 8 / 1e6 = 0.00127 + 0.000776 = 0.002046 元,和实测打印的 `0.002046` 一致。
- `class ChatResult:` 一次调用的结果,把 SDK 的复杂对象压成四个字段,节点代码只跟它打交道。
- `tool_calls: list[dict] = field(default_factory=list)` 不能写成 `= []`:dataclass 会直接报 `ValueError: mutable default <class 'list'> for field tool_calls is not allowed: use default_factory`。注释里写明了每个元素的三个键,`arguments` 是 JSON 字符串,还没解析。
- `raw_message: dict = field(default_factory=dict)` 按 OpenAI 协议拼好的 assistant 消息,act 节点下一轮直接 `msgs.append(res.raw_message)`。
- `self.s = settings or get_settings()` 没传就从 `.env` 读。`or` 在左边是 None 时取右边。
- `self.model = model or self.s.llm_model` 实测是 `deepseek-flash`。留一个 `model` 参数是给 Day 52 的小模型用的。
- `self.client = OpenAI(` `max_retries=3` 交给 SDK 做 429/5xx 的指数退避;`timeout=60` 防止一个请求卡死整张工单。
- `self.ledger = Usage()` 每个 `LLMClient` 实例一本账,初始 0/0/0。`Deps.spent()` 读的就是它。
- `def _usage(self, u: Any) -> Usage:` 把 SDK 的 usage 对象换成自己的 `Usage`,顺手记进账本。所有调用都经过这里,账就不会漏。
- `got = Usage(prompt_tokens=getattr(u, "prompt_tokens", 0) or 0,` `getattr(对象, 名字, 默认值)`:`u` 是 None(流式没拿到 usage)时不会抛 AttributeError,而是拿到 0;后面的 `or 0` 再把「属性存在但值是 None」兜成 0。
- `def chat(self, messages: list[dict], *, tools` 参数列表里单独一个 `*`,表示后面的参数只能用关键字传:`chat(msgs, tools=t)` 可以,`chat(msgs, t)` 会报错。参数多的函数这样写,调用处不会传错位置。
- `kwargs: dict[str, Any] = {"model"` 先放三个必有的参数,下面按需往里加。
- `if tools:` 没有工具时干脆不带 `tools` 这个键,请求里少一个空字段。
- `kwargs["response_format"] = {"type": "json_object"}` 开 JSON mode。test_llm 实测第一次请求带上了它,`temperature` 是 0。
- `if self.s.llm_extra_body:` 配了就透传,没配(空字典)就不带这个键。实测 `.env` 里是 `{"thinking": {"type": "disabled"}}`,关掉 deepseek-flash 默认的思考。
- `kwargs["extra_body"] = self.s.llm_extra_body` `extra_body` 是 openai SDK 留的口子:SDK 不认识的厂商专有参数放进去,会原样合并进请求体。
- `resp = self.client.chat.completions.create(**kwargs)` `**kwargs` 把字典展开成关键字参数,等于写 `create(model=..., messages=..., ...)`。
- `calls = [{"id": c.id, "name": c.function.name` 把 SDK 的工具调用对象压平成普通字典。`msg.tool_calls or []` 防止没有工具调用时是 None。实测「能退吗」那张工单,act 第一轮一次返回了两个调用:`list_subscriptions {"customer_id": "C0002"}` 和 `list_invoices {"customer_id": "C0002", "limit": 10}`。
- `raw: dict[str, Any] = {"role": "assistant", "content": msg.content or ""}` 实测问「用一句话说 CloudLedger 是什么」,raw_message 是 `{'role': 'assistant', 'content': 'CloudLedger 是一个基于云端的财务记账与账本管理平台,用于记录、分类和追踪个人或企业的收支流水。'}`。模型没见过我们虚构的 CloudLedger,这句是它看名字猜的(开着思考时它猜成了「分布式账本平台」),所以产品知识一定要靠检索喂给它。
- `raw["tool_calls"] = [{"id": c["id"], "type": "function",` 有工具调用时按协议格式拼回去。下一轮的 tool 消息靠 `id` 和它对上,对不上 API 会报 400。
- `return ChatResult(content=msg.content or ""` 实测上面那次问答 usage 是 12 输入、28 输出。关掉思考之前,同一个问题是 38 输入、256 输出:思考的 token 也算在 completion 里计费,一句话的回答多付了近 9 倍。
- `def stream(self, messages` 流式版本,draft 节点用它给前端推打字机效果。
- `stream=True, stream_options={"include_usage": True},` 不加 `include_usage`,流式响应里根本没有 usage,账本就漏记了。
- `extra_body=self.s.llm_extra_body or None,` 流式也要关思考。`or None`:没配时传 None,等于不带这个参数。
- `parts: list[str] = []` 收集每一段文字,最后拼起来。
- `for chunk in resp:` 实测流式问「写一句 20 字的客服问候」:关掉思考后一共 14 块,12 块带正文,剩下的是收尾块和 usage 块。不传 extra_body 直接调接口对比了一次:1010 块,只有十几块是正文,其余都是思考内容,`delta.content` 为空,会被下面的 if 跳过。
- `if chunk.usage:` 实测 DeepSeek 只在最后 1 块带 usage:关思考时是 12 输入 / 12 输出,不关时是 38 输入 / 1009 输出。别的厂商可能每块都带累计值,代码按「只记最后一次」写,两种行为都不会算错。
- `if chunk.choices and chunk.choices[0].delta.content:` 最后那块 usage 块的 `choices` 是空列表,所以先判断 `chunk.choices` 非空再取 `[0]`,否则会 IndexError。
- `on_token(piece)` 实测前 5 段依次是 `'您好'`、`'，'`、`'很高兴'`、`'为您'`、`'服务'`。draft 节点传进来的 on_token 会把每段推到 custom 流。
- `text = "".join(parts)` 12 段拼成 `您好，很高兴为您服务，请问有什么可以帮您？`。
- `usage = self._usage(last_usage)` 循环结束后只入账一次。这次是 12 / 12。
- `def structured[T: BaseModel](` Python 3.12 的泛型写法:传进来 `Triage` 类,返回值就是 `Triage` 实例,编辑器能提示 `.category` 这些字段。
- `hint = ("只输出一个 JSON 对象` 把 schema 转成 JSON 塞进提示词。实测 Triage 的 schema JSON 有 844 个字符,`ensure_ascii=False` 让中文 description 原样出现,不变成 `工` 这种转义。
- `msgs = [*messages, {"role": "system"` `[*a, x]` 是解包拼新列表,不改调用方传进来的 messages。测试实测第一次请求带 2 条消息:原来的 user 加上这条 system 提示。
- `for _ in range(retries + 1):` retries=2 就是最多 3 次。`_` 表示循环变量用不上。
- `return schema.model_validate_json(res.content)` 解析加校验一步完成。实测分诊「上周买的专业版年付,发现用不上,请帮我退款」,一次就过:`{'category': 'refund', 'needs_account_data': True, 'needs_human': False, 'urgency': 'normal', 'summary': '客户要求退上周购买的专业版年付费用', 'search_query': '专业版 年付 退款'}`,这次调用 57 个输出 token。
- `last_err = str(e)[:800]` 错误信息截到 800 字,太长会白占 token。测试实测的错误是 `1 validation error for Answer / confidence / Field required [type=missing, input_value={'category': 'refund'}, ...]`。
- `msgs = [*msgs, res.raw_message,` 把模型这次的输出和错误一起贴回去,让它对着改。测试实测第二次请求有 4 条消息:user、system 提示、模型上次的 JSON、「没通过校验」这条。
- `raise ValueError(f"结构化输出重试` 3 次都不过才放弃。测试里连续 3 次返回 `not json`,实测报错 `结构化输出重试 2 次仍失败:1 validation error for Answer Invalid JSON: expected ident at line 1 column 2 ...`。

</div>



**成本账本 `ledger`。** 每次调用都把 usage 累加到实例的账本上,`cost_cny()` 按配置的单价换算成人民币。每个节点在开始前记一下账本读数,结束后算差值,就知道这一步花了多少。整张工单的成本在状态里累加,评测报告里就能出现"平均每张工单 ¥0.03"这种数字。

**结构化输出 `structured()`。** 用 JSON mode 加 pydantic 校验。JSON mode 只保证输出是合法 JSON,不保证字段对,所以还要校验。校验失败时把错误信息原样贴回去让模型改,最多重试两次。DeepSeek 的文档特别提醒:开 JSON mode 必须在提示词里说"输出 JSON",否则模型可能一直输出空白直到 token 用完,所以 `hint` 里明确写了"只输出一个 JSON 对象"并附上 schema。

`def structured[T: BaseModel](...)` 是 Python 3.12 的泛型写法,意思是"传进来什么 schema 类型,就返回什么类型的实例",编辑器能正确提示返回值的字段。

**流式输出 `stream()`。** `stream_options={"include_usage": True}` 让流式响应也带上 token 用量。DeepSeek 我实测过,只有最后一块带 usage,前面的块都是空的;但不是所有厂商都这样,有的每一块都带一个累计值,那种情况下每块都入账,成本会被算成好几十倍。所以循环里只记住最后一次的 usage,循环结束后入账一次,两种行为都不会算错。

**关掉思考 `extra_body`。** 全课的惯例是用 `.env` 里的 `LLM_EXTRA_BODY` 关掉 deepseek-flash 默认开着的思考(Day 4 的 `llm.py` 就是这么做的)。Day 44 的 `Settings` 里还没有这一项,今天在 `config.py` 的 Settings 类里补一行:

```python
    # Day 47:透传给大模型接口的额外参数(JSON)。deepseek-flash 默认开思考,填 {"thinking": {"type": "disabled"}} 关掉
    llm_extra_body: dict = {}
```

`.env` 里写 `LLM_EXTRA_BODY={"thinking": {"type": "disabled"}}`,pydantic-settings 会把这段 JSON 解析成字典。`chat()` 和 `stream()` 都把它原样透传给接口。不关的代价很实在:我实测问一句「CloudLedger 是什么」,开着思考输出 256 个 token,关掉后 28 个;10 张演示工单全跑一遍,开着思考约 0.26 元,关掉后约 0.17 元。客服回复不需要模型先长篇思考,这钱省得心安理得。

`max_retries=3` 交给 openai SDK,它会对 429 和 5xx 自动做指数退避重试,这是 Day 12 你手写过的逻辑,SDK 已经帮你做好了。

先用假的 OpenAI 客户端测一下这三样东西:

```python
# supportpilot/tests/test_llm.py
"""LLMClient 的单测:用假的 OpenAI 客户端,验证成本记账和结构化输出的重试。"""

from types import SimpleNamespace as NS

import pytest
from pydantic import BaseModel

from supportpilot.config import Settings
from supportpilot.llm import LLMClient


class Answer(BaseModel):
    category: str
    confidence: float


def fake_client(replies: list[str]):
    calls = []

    def create(**kw):
        calls.append(kw)
        text = replies.pop(0)
        msg = NS(content=text, tool_calls=None)
        return NS(choices=[NS(message=msg)], usage=NS(prompt_tokens=1000, completion_tokens=100))

    return NS(chat=NS(completions=NS(create=create))), calls


def make(replies):
    llm = LLMClient(Settings(llm_api_key="test", price_in_per_m=2.0, price_out_per_m=8.0))
    llm.client, calls = fake_client(replies)
    return llm, calls


def test_structured_retries_with_validation_error():
    llm, calls = make(['{"category": "refund"}', '{"category": "refund", "confidence": 0.9}'])
    out = llm.structured([{"role": "user", "content": "x"}], Answer)
    assert out.category == "refund" and len(calls) == 2
    assert "没通过校验" in calls[1]["messages"][-1]["content"]      # 第二次带上了错误信息
    assert calls[0]["response_format"] == {"type": "json_object"}


def test_structured_gives_up():
    llm, _ = make(["not json"] * 3)
    with pytest.raises(ValueError, match="重试 2 次"):
        llm.structured([{"role": "user", "content": "x"}], Answer)


def test_ledger_cost():
    llm, _ = make(['{"category": "a", "confidence": 1}'])
    llm.structured([{"role": "user", "content": "x"}], Answer)
    # 1000 输入 × 2 元/百万 + 100 输出 × 8 元/百万 = 0.002 + 0.0008
    assert llm.ledger.cost_cny(llm.s) == pytest.approx(0.0028)
```

<div class="line-notes">

- `from types import SimpleNamespace as NS` SimpleNamespace 能随手造一个带属性的对象:`NS(content="x").content` 就是 `"x"`。用它冒充 SDK 返回的响应对象,不用真联网。
- `from supportpilot.config import Settings` 测试里直接构造 Settings 传价格,不依赖 `.env`。
- `class Answer(BaseModel):` 测试专用的小 schema,两个必填字段,方便造「缺字段」的情况。
- `def fake_client(replies: list[str]):` 造一个假 OpenAI 客户端:每调一次 `create`,按顺序吐出一条预设文字。
- `calls = []` 记下每次调用传了什么参数,测试拿来断言。
- `def create(**kw):` 接收任意关键字参数,和真 SDK 的调用方式对上。
- `text = replies.pop(0)` 从头取一条,取一条少一条。
- `return NS(choices=[NS(message=msg)], usage=NS(prompt_tokens=1000` 拼出 `resp.choices[0].message.content` 和 `resp.usage.prompt_tokens` 这两条访问路径,LLMClient 只用到这些。每次固定 1000 输入、100 输出,方便心算。
- `return NS(chat=NS(completions=NS(create=create))), calls` 一层套一层,对应 `client.chat.completions.create`。
- `llm = LLMClient(Settings(llm_api_key="test"` 真的构造一个 LLMClient(里面会建一个真 OpenAI 对象,但不发请求),单价设成 2 和 8。
- `llm.client, calls = fake_client(replies)` 把里面的真客户端换成假的。节点和 LLMClient 都不用为测试改一行代码。
- `llm, calls = make(['{"category": "refund"}'` 第一条故意缺 `confidence`,第二条完整。
- `out = llm.structured([{"role": "user", "content": "x"}], Answer)` 实测 out 是 `category='refund' confidence=0.9`,一共调用 2 次,两次请求分别带 2 条和 4 条消息。
- `assert "没通过校验" in calls[1]["messages"][-1]["content"]` 第二次请求的最后一条消息,就是贴回去的校验错误。
- `assert calls[0]["response_format"] == {"type": "json_object"}` 确认结构化输出走的是 JSON mode。
- `llm, _ = make(["not json"] * 3)` `[x] * 3` 得到 3 个相同元素的列表,刚好够 3 次尝试用完。
- `with pytest.raises(ValueError, match="重试 2 次"):` 断言这个 with 块里一定抛 ValueError,而且错误信息能被正则 `重试 2 次` 搜到。
- `assert llm.ledger.cost_cny(llm.s) == pytest.approx(0.0028)` 浮点数不能直接 `==`,`approx` 允许极小误差。1000 × 2 / 1e6 + 100 × 8 / 1e6 = 0.002 + 0.0008 = 0.0028。顺带实测:上面重试那个测试调了 2 次,账本是 2000 / 200,0.0056 元。

</div>



## 状态:工作流里流动的是什么

```python
# supportpilot/src/supportpilot/agent/state.py
import operator
from typing import Annotated, Literal, TypedDict

from pydantic import BaseModel, Field

Category = Literal["billing", "refund", "invoice", "account", "technical", "plan_change", "api", "other"]


class Ticket(TypedDict):
    id: str
    customer_email: str
    subject: str
    body: str


class SupportState(TypedDict, total=False):
    ticket: Ticket
    customer: dict | None
    triage: dict
    hits: list[dict]
    tool_log: Annotated[list[dict], operator.add]   # 每次工具调用追加一条,不覆盖
    findings: str
    refund_request: dict | None
    draft: str
    review: dict
    revisions: int
    approval: dict | None
    followup: str
    outcome: str            # resolved / waiting_approval / escalated
    handoff_reason: str
    reply: str              # 最终发给客户的文本(引用已渲染成链接)
    cost_cny: Annotated[float, operator.add]


class Triage(BaseModel):
    category: Category = Field(description="工单分类,定义见系统提示")
    needs_account_data: bool = Field(description="是否必须查这个客户的订阅/账单/历史才能回答")
    needs_human: bool = Field(description="是否必须直接转人工:投诉升级、法律威胁、安全事件、明确要求人工")
    urgency: Literal["low", "normal", "high"]
    summary: str = Field(description="一句话复述客户诉求,不超过 40 字")
    search_query: str = Field(description="用来检索帮助中心的查询:保留报错码、产品名词,去掉寒暄和情绪")


class Review(BaseModel):
    passed: bool
    problems: list[str] = Field(default_factory=list, description="不通过时列出具体问题,每条一句话")
```

<div class="line-notes">

- `import operator` 下面用 `operator.add`,它就是 `+` 的函数版:`operator.add([1], [2])` 得到 `[1, 2]`,`operator.add(0.1, 0.2)` 得到 0.3 左右。
- `Category = Literal["billing"` 类型别名,8 个合法分类。模型输出 `"refunds"` 这种不在列表里的值,pydantic 校验失败,触发重试。
- `class Ticket(TypedDict):` 工单的四个字段。实测第 3 张演示工单进图时是 `{"id": "T000153", "customer_email": "lina@example.com", "subject": "想退款", "body": "上周买的专业版年付,发现用不上,请帮我退款。"}`。
- `class SupportState(TypedDict, total=False):` `total=False` 表示每个键都可以不存在。图刚开始只有 `ticket`,其余字段靠节点一步步填,所以节点里读可选字段要用 `state.get(...)`。
- `customer: dict | None` 实测李娜是 `{"id": "C0002", "name": "李娜", "email": "lina@example.com", "company": "娜美贸易", "region": "上海", "is_vip": false, "created_at": "2025-06-01"}`;`nobody@example.com` 查不到,是 None。
- `triage: dict` 存的是 `Triage.model_dump()` 之后的普通字典。
- `hits: list[dict]` 实测李娜退款单第一条是 `{"chunk_id": 127, "doc_id": "KB-refund-003", "title": "年付超过 14 天怎么退", "heading": "计算方法", "score": 0.0323, "via": ["vector", "bm25"], ...}`。
- `tool_log: Annotated[list[dict], operator.add]` 给字段挂一个 reducer:节点返回的列表会和旧值相加(拼接),不会覆盖。实测李娜退款那单 act 返回 4 条记录,最后状态里 tool_log 长度是 4。
- `findings: str` act 节点写的调查结论,draft 和 check 都要读。
- `refund_request: dict | None` act 里 `create_refund_request` 成功时的返回值,路由靠它判断要不要去审批。
- `revisions: int` 质检没过的次数,超过上限转人工。
- `outcome: str` 注释里列了三种取值。实测 10 张演示工单里 7 张 resolved、3 张 escalated。
- `cost_cny: Annotated[float, operator.add]` 每个节点只返回自己这一步花的钱,LangGraph 自动累加。实测李娜那单:classify 0.00168 + act 0.0188 + draft 0.00216 + check 0.00176,合计 0.0244 元。
- `class Triage(BaseModel):` 分诊的结构化输出,`Field(description=...)` 会进 JSON schema,等于给模型看的字段说明书。
- `needs_account_data: bool = Field(` 实测「能退吗,先问问」也判成了 true,因为要算这个客户自己能退多少。
- `urgency: Literal["low", "normal", "high"]` 没写 description,三个值的意思够直白。实测「想退款」判 normal,「能退吗,先问问」判 low。
- `search_query: str = Field(` 实测「想退款」那单生成 `专业版 年付 退款`,「能退吗」那单是 `年付订阅 退款 退款金额 退款政策`。寒暄和情绪词都去掉了。
- `class Review(BaseModel):` 质检的结构化输出。
- `problems: list[str] = Field(default_factory=list` pydantic 里可变默认值同样用 `default_factory`。实测第 6 张(重复扣款)第一次质检退回了两条:「24 小时内自动退回」和调查结论不符;没说明申请还在待审批。

</div>



LangGraph 的状态是一个字典,每个节点读它、返回一个"要更新哪些字段"的小字典。大部分字段是覆盖:节点返回 `{"draft": "..."}`,状态里的 draft 就被替换。有两个字段用了 `Annotated[..., operator.add]`,意思是累加:

- `tool_log`:act 节点每次返回的工具调用记录追加到列表末尾。
- `cost_cny`:每个节点返回自己花的钱,累加成整张工单的总成本。

为什么 `hits` 存的是字典列表而不是 `Hit` 对象?因为状态会被 checkpointer 序列化存进数据库(Day 48),纯字典和列表最稳妥。节点里用的时候 `Hit(**h)` 还原回来。

`Triage` 和 `Review` 是两个结构化输出的 schema。`Triage` 里我特意加了 `search_query` 字段:让分诊模型顺手把客户的话改写成适合检索的查询,去掉"你好""麻烦了""急急急"这些对检索没用的词。一次调用干两件事,省一次 API。

`Category` 用 `Literal` 限定了 8 个取值,模型输出其他值时 pydantic 校验会失败,触发重试。

## 提示词:集中放,带版本号

```python
# supportpilot/src/supportpilot/agent/prompts.py
"""所有提示词集中放这里,带版本号。评测报告里会记录 PROMPT_VERSION,改提示词就改版本号。"""

PROMPT_VERSION = "v1"

CLASSIFY = """你是 CloudLedger(云簿,在线记账 SaaS)的工单分诊员。读客户工单,输出分类结果。

分类定义:
- billing:扣费、扣款失败、重复扣款、支付方式、账单查询(不涉及退钱的诉求)
- refund:客户要求退钱,或者问能不能退、退多少
- invoice:开发票、发票错误、重开发票
- account:登录、验证码、密码、账号锁定、绑定手机邮箱、成员权限、注销
- technical:导入导出、银行流水同步、结账、报表、App 同步等产品使用问题和报错
- plan_change:升级、降级、换年付月付、取消订阅、试用
- api:开放 API、API Key、限流、Webhook
- other:以上都不是

needs_account_data:回答必须依赖这个客户自己的订阅、账单或历史记录时为 true(比如"我被扣了两次""我能退多少");
纯政策或操作问题(比如"专票怎么开")为 false。
needs_human:客户威胁投诉到监管/媒体/律师、涉及账号被盗等安全事件、或者明确要求人工客服时为 true。"""

ACT = """你是 CloudLedger 客服后台的调查员。你的任务是用工具查清回答这张工单需要的客户数据,不直接回复客户。

规则:
1. 客户 ID 已经给你了,不需要再查 get_customer。
2. 涉及退款:先用 list_invoices 找到相关账单,再对它调用 check_refund_eligibility。退款金额只以工具返回为准,不要自己算。
3. 只有当客户明确要求退款、并且 check_refund_eligibility 返回 eligible=true 时,才调用 create_refund_request。
   客户只是询问"能不能退"时不要创建申请。
4. 只查和这张工单有关的数据,查到够用就停。
5. 结束时不再调用工具,输出「调查结论」:用几条短句列出查到的关键事实(账单号、金额、状态、规则结论),不要写给客户的话。"""

DRAFT = """你是 CloudLedger 的客服,给客户写工单回复。

写作要求:
- 只使用【帮助中心资料】和【调查结论】里的事实。资料里没有的,不要猜,直接说会转给同事跟进。
- 用到帮助中心资料的句子,在句末标注来源编号,格式严格为 [KB-xxx-000],只能用资料里出现过的编号。
- 如果有待审批的退款申请:只能说"已提交退款申请,审核通过后会原路退回",不能说已经退款或承诺到账时间以外的东西。
- 如果客户不符合退款条件:说明依据的规则,给出可行的替代办法(比如关闭自动续费)。
- 如果没查到客户账户:请客户提供注册邮箱。
- 语气礼貌、直接,先回答问题再补充说明。不超过 250 字。称呼用"您好"开头,不要落款。"""

CHECK = """你是客服质检员。检查这封回复草稿能不能发给客户。

逐条核对:
1. 草稿里每一个具体事实(金额、天数、规则、操作路径)是否都能在【帮助中心资料】或【调查结论】里找到依据。
2. 是否答非所问,或者漏掉了客户的主要诉求。
3. 是否承诺了没有依据的事(比如"已经为您退款""马上到账")。

全部没问题 passed=true。有任何一条问题 passed=false,并在 problems 里逐条写清楚哪句话有什么问题。"""
```

<div class="line-notes">

- `PROMPT_VERSION = "v1"` 评测报告里记这个版本号,分数才能对应到具体的提示词。
- `CLASSIFY = """你是 CloudLedger` 分诊提示词,实测 475 个字符。分诊结果的例子见 state.py 的注释。
- `needs_account_data:回答必须依赖` 正反例各给一个,边界就清楚了。
- `needs_human:客户威胁投诉到监管` 实测第 10 张「再不处理我就去 12315 投诉」被分成 billing,但 needs_human 是 true,直接转人工,整单只花了 0.0017 元。
- `ACT = """你是 CloudLedger 客服后台的调查员` 379 个字符。「不直接回复客户」这句把调查和写回复分开,act 的输出只给 draft 用。
- `1. 客户 ID 已经给你了` 实测 10 张工单里 act 一次都没调 get_customer,省了一轮。
- `3. 只有当客户明确要求退款` 实测有效:「能退吗,先问问」那单查完 check_refund_eligibility 就停了,调查结论写的是「客户只是询问“能退多少”,并未明确要求退款,因此未创建退款申请」。
- `5. 结束时不再调用工具,输出「调查结论」` 实测模型的结论是 4 条短句:订阅、账单、退款资格(eligible=true,950 元)、为什么没建申请。
- `DRAFT = """你是 CloudLedger 的客服` 起草提示词。
- `- 用到帮助中心资料的句子,在句末标注来源编号` 编号格式写死成 `[KB-xxx-000]`,finalize 才能用固定规则把它渲染成 `[1]`。
- `- 如果有待审批的退款申请:只能说` 提示词要求说「审核通过后会原路退回」。
- `CHECK = """你是客服质检员` 212 个字符。
- `1. 草稿里每一个具体事实` 这条很严。实测第 6 张(重复扣款)两版草稿都被挑出和调查结论对不上的句子,最后转了人工。我在开着思考的另一次实跑里还见过它和起草提示词打架:草稿按 DRAFT 的要求写「审核通过后会原路退回」,质检判「退款渠道没有依据」打回。两个提示词口径不一致,就会白花重写的钱。这些都是 Day 47 让你记进问题清单、Day 51 去修的那类问题。

</div>



所有提示词放一个文件,开头有 `PROMPT_VERSION`。Day 50 的评测报告会记录用的是哪个版本,Day 51 改提示词时就改版本号。提示词就是代码,要能 diff、能回滚、能对应到分数。

几个写法上的考虑:

分诊提示词把每个分类的边界写清楚了,尤其是 `needs_account_data` 举了正反例。模型分类出错,十有八九是因为分类定义模糊,而不是模型笨。

act 提示词第 2、3 条是退款的操作规程:先查账单、再判资格、符合条件且客户明确要求才建申请。这些规则在工具描述里也写了一遍。重复是故意的,工具描述是"这个工具怎么用",系统提示是"这件事的流程是什么",两处都有,模型遵守得更稳。

起草提示词明确禁止"已经退款""承诺到账时间"这类话。但我不完全信任提示词,质检节点还会用正则再查一遍。

## 依赖注入:让节点可以被测试

```python
# supportpilot/src/supportpilot/agent/deps.py
"""节点需要的外部依赖都装在 Deps 里。生产环境用 from_conn() 组装;测试时换成假的,不连数据库不花钱。"""

from collections.abc import Callable
from dataclasses import dataclass
from functools import partial
from typing import Any

from ..config import Settings, get_settings
from ..kb.retriever import HybridRetriever
from ..llm import LLMClient
from ..tools import business as biz
from ..tools.registry import call_tool


@dataclass
class Deps:
    llm: LLMClient                 # 起草用的主力模型
    small_llm: LLMClient           # 分类、质检用的便宜模型(Day 52 才真的分开,现在可以是同一个)
    retriever: Any                 # 有 search(query, k) -> list[Hit] 就行
    call_tool: Callable[..., tuple[str, bool]]   # (name, arguments, ticket_id=...) -> (text, is_error)
    escalate: Callable[[str, str], Any]
    decide_refund: Callable[[str, bool, str, str], dict]
    finish_ticket: Callable[[str, str, str | None, str], None]
    settings: Settings

    @classmethod
    def from_conn(cls, conn, settings: Settings | None = None) -> "Deps":
        s = settings or get_settings()
        llm = LLMClient(s)
        small = LLMClient(s, model=s.llm_small_model) if s.llm_small_model else llm
        return cls(llm=llm, small_llm=small, retriever=HybridRetriever(conn, settings=s),
                   call_tool=partial(call_tool, conn),
                   escalate=partial(biz.escalate_to_human, conn),
                   decide_refund=partial(biz.decide_refund, conn),
                   finish_ticket=partial(biz.finish_ticket, conn), settings=s)

    def spent(self) -> float:
        """两个客户端累计花了多少钱;同一个对象只算一次。"""
        total = self.llm.ledger.cost_cny(self.settings)
        if self.small_llm is not self.llm:
            total += self.small_llm.ledger.cost_cny(self.settings)
        return total
```

<div class="line-notes">

- `from functools import partial` `partial(f, a)` 返回一个新函数,调用时自动把 `a` 填进第一个参数。
- `class Deps:` 节点要用的外部依赖全装在这里,测试时整包换成假的。
- `llm: LLMClient` 起草和 act 用的主力模型。
- `small_llm: LLMClient` 分诊和质检用。
- `retriever: Any` 鸭子类型:只要有 `search(query, k)` 方法就行,真的 HybridRetriever 和测试里的 FakeRetriever 都能塞进来。
- `call_tool: Callable[..., tuple[str, bool]]` `Callable[..., X]` 的 `...` 表示参数不限,只约束返回值是 (文本, 是否出错)。
- `decide_refund: Callable[[str, bool, str, str], dict]` 四个参数依次是申请号、是否通过、审批人、备注。
- `def from_conn(cls, conn` `@classmethod` 的第一个参数是类本身,`cls(...)` 就是构造一个 Deps。返回类型写成字符串 `"Deps"` 也是前向引用。
- `small = LLMClient(s, model=s.llm_small_model) if s.llm_small_model else llm` 实测 `.env` 没配 `LLM_SMALL_MODEL`,`deps.small_llm is deps.llm` 是 True,两个名字指向同一个对象。
- `retriever=HybridRetriever(conn, settings=s),` Day 45 的混合检索,构造时要数据库连接。
- `call_tool=partial(call_tool, conn),` 节点里写 `deps.call_tool("get_customer", {...}, ticket_id=...)`,实际执行的是 `call_tool(conn, "get_customer", {...}, ticket_id=...)`。数据库连接在这里一次绑定好,节点代码里看不到它。
- `def spent(self) -> float:` 两个客户端合起来一共花了多少钱。节点用「结束时读数减开始时读数」算出自己这一步的花费。
- `if self.small_llm is not self.llm:` `is` 比较的是「是不是同一个对象」,不是值相等。实测是同一个对象,只算一次;不判断的话,同一本账会被算两遍。

</div>



节点需要的外部东西(大模型、检索器、工具、数据库操作)全装进一个 `Deps`。生产环境用 `from_conn()` 组装真的;测试时塞假的进去,节点代码一行都不用改。

`call_tool`、`escalate` 这些用 `functools.partial` 把数据库连接提前绑定好,节点调用时只需要传业务参数。节点代码里看不到任何数据库连接,它也不需要知道。

`small_llm` 现在和 `llm` 是同一个对象(配置里 `LLM_SMALL_MODEL` 留空),Day 52 做模型路由时才分开。`spent()` 里判断了是不是同一个对象,避免重复计费。

## 九个节点

```python
# supportpilot/src/supportpilot/agent/nodes.py
import json
import re
from dataclasses import asdict

from langgraph.config import get_stream_writer
from langgraph.types import interrupt

from ..kb.cite import build_context, check_citations, render_sources
from ..kb.retriever import Hit
from ..tools.registry import Level, openai_tools
from . import prompts
from .deps import Deps
from .state import Review, SupportState, Triage

PROMISE_RE = re.compile(r"已(经)?(为您|给您)?(办理|完成)?退款(?!申请)|退款已(到账|完成|办理|退回)|马上到账")


def _ticket_text(state: SupportState) -> str:
    t = state["ticket"]
    return f"发件邮箱:{t['customer_email']}\n主题:{t['subject']}\n正文:{t['body']}"


def _emit(event: dict) -> None:
    """往 custom 流里推一条事件(工具调用、token 等)。非流式运行时什么都不做。"""
    try:
        get_stream_writer()(event)
    except RuntimeError:  # 不在 LangGraph 运行上下文里(比如单测直接调节点函数)
        pass


def make_nodes(deps: Deps) -> dict:
    """返回 {节点名: 函数}。用闭包把 deps 带进去,图本身不关心依赖从哪来。"""

    def load_customer(state: SupportState) -> dict:
        text, err = deps.call_tool("get_customer", {"email": state["ticket"]["customer_email"]},
                                   ticket_id=state["ticket"]["id"])
        customer = None if err else json.loads(text)
        _emit({"type": "step", "node": "load_customer", "found": customer is not None})
        return {"customer": customer, "revisions": 0, "refund_request": None, "approval": None}

    def classify(state: SupportState) -> dict:
        before = deps.spent()
        triage = deps.small_llm.structured(
            [{"role": "system", "content": prompts.CLASSIFY}, {"role": "user", "content": _ticket_text(state)}],
            Triage)
        _emit({"type": "step", "node": "classify", "category": triage.category})
        return {"triage": triage.model_dump(), "cost_cny": deps.spent() - before}

    def retrieve(state: SupportState) -> dict:
        tr = state["triage"]
        query = tr.get("search_query") or f"{state['ticket']['subject']} {state['ticket']['body']}"
        hits = deps.retriever.search(query, k=deps.settings.retrieve_k)
        _emit({"type": "step", "node": "retrieve", "docs": [h.doc_id for h in hits]})
        return {"hits": [asdict(h) for h in hits]}

    def act(state: SupportState) -> dict:
        before = deps.spent()
        tid = state["ticket"]["id"]
        cust = state["customer"]
        msgs: list[dict] = [
            {"role": "system", "content": prompts.ACT},
            {"role": "user", "content": f"客户档案:{json.dumps(cust, ensure_ascii=False)}\n\n{_ticket_text(state)}\n\n"
                                        f"分诊结论:{state['triage']['summary']}"},
        ]
        log: list[dict] = []
        refund_request = None
        findings = ""
        tools = openai_tools({Level.READ, Level.PROPOSE})
        for step in range(deps.settings.max_act_steps):
            res = deps.llm.chat(msgs, tools=tools, temperature=0)
            if not res.tool_calls:
                findings = res.content
                break
            msgs.append(res.raw_message)
            for call in res.tool_calls:
                text, err = deps.call_tool(call["name"], call["arguments"], ticket_id=tid, customer_id=cust["id"])
                log.append({"step": step, "name": call["name"], "args": call["arguments"], "error": err,
                            "result": text[:500]})
                _emit({"type": "tool", "name": call["name"], "args": call["arguments"], "error": err})
                if call["name"] == "create_refund_request" and not err:
                    refund_request = json.loads(text)
                msgs.append({"role": "tool", "tool_call_id": call["id"], "content": text})
        else:
            findings = "(调查达到步数上限,以下为已查到的工具结果)\n" + "\n".join(
                f"- {x['name']}: {x['result'][:200]}" for x in log)
        return {"tool_log": log, "findings": findings, "refund_request": refund_request,
                "cost_cny": deps.spent() - before}

    def draft(state: SupportState) -> dict:
        before = deps.spent()
        hits = [Hit(**h) for h in state.get("hits", [])]
        parts = [f"【客户工单】\n{_ticket_text(state)}",
                 f"【帮助中心资料】\n{build_context(hits)}",
                 f"【调查结论】\n{state.get('findings') or '(没有查询客户数据)'}"]
        if state.get("customer") is None and state["triage"].get("needs_account_data"):
            parts.append("【注意】没有找到这个邮箱对应的客户账户。")
        if state.get("refund_request"):
            rr = state["refund_request"]
            parts.append(f"【待审批退款申请】{rr['id']},金额 {rr['amount_cny']:.2f} 元,规则 {rr['rule']}")
        if state.get("review") and not state["review"].get("passed"):
            parts.append("【上一版草稿被质检退回,问题如下,请改正】\n" + "\n".join(state["review"]["problems"]))
        res = deps.llm.stream(
            [{"role": "system", "content": prompts.DRAFT}, {"role": "user", "content": "\n\n".join(parts)}],
            on_token=lambda t: _emit({"type": "token", "text": t}))
        return {"draft": res.content, "cost_cny": deps.spent() - before}

    def check(state: SupportState) -> dict:
        before = deps.spent()
        hits = [Hit(**h) for h in state.get("hits", [])]
        problems: list[str] = []
        _, fake = check_citations(state["draft"], hits)
        if fake:
            problems.append(f"引用了不存在于资料中的编号:{', '.join(fake)}")
        if PROMISE_RE.search(state["draft"]):
            problems.append("草稿承诺了退款已完成/马上到账,退款必须经过人工审核")
        if not problems:  # 规则检查过了再花钱让模型检查
            review = deps.small_llm.structured([
                {"role": "system", "content": prompts.CHECK},
                {"role": "user", "content": f"【客户工单】\n{_ticket_text(state)}\n\n【帮助中心资料】\n{build_context(hits)}"
                                            f"\n\n【调查结论】\n{state.get('findings') or '无'}\n\n【回复草稿】\n{state['draft']}"},
            ], Review)
            problems.extend(review.problems if not review.passed else [])
        passed = not problems
        _emit({"type": "step", "node": "check", "passed": passed, "problems": problems})
        return {"review": {"passed": passed, "problems": problems},
                "revisions": state.get("revisions", 0) + (0 if passed else 1),
                "cost_cny": deps.spent() - before}

    def approval(state: SupportState) -> dict:
        rr = state["refund_request"]
        # interrupt 之前的代码在恢复时会重跑一遍,所以这里不能有副作用(不写库、不发消息)
        decision = interrupt({"type": "refund_approval", "ticket_id": state["ticket"]["id"], "request": rr,
                              "draft": state["draft"],
                              "needs_finance_review": rr["amount_cny"] > deps.settings.refund_review_threshold})
        approved = bool(decision.get("approved"))
        result = deps.decide_refund(rr["id"], approved, decision.get("approver", "unknown"), decision.get("note", ""))
        if approved:
            followup = f"补充:您的退款申请已审核通过,{rr['amount_cny']:.2f} 元将原路退回,到账时间以支付渠道为准。"
        else:
            followup = ("补充:很抱歉,您的退款申请经审核未通过" + (f",原因:{decision['note']}" if decision.get("note") else "")
                        + "。如有疑问可以直接回复这个工单。")
        return {"approval": {**decision, "result_status": result.get("status")}, "followup": followup}

    def handoff(state: SupportState) -> dict:
        reason = state.get("handoff_reason") or (
            "客户要求人工或涉及投诉/安全" if state.get("triage", {}).get("needs_human")
            else "草稿多次未通过质检:" + ";".join(state.get("review", {}).get("problems", [])))
        rr = state.get("refund_request")
        if rr and rr.get("status") == "pending":
            # act 已经建了申请、但草稿没过质检就转人工:这条申请不会再走到 approval 节点,作废它,
            # 免得它挂在审批列表里,有人点通过却没有对应的图可以恢复
            deps.decide_refund(rr["id"], False, "system:handoff", "工单已转人工,这条申请作废,由人工客服重新判断")
        deps.escalate(state["ticket"]["id"], reason)
        reply = "您好,您的问题已经转给人工客服同事,会在 1 个工作日内通过这个工单回复您。"
        return {"outcome": "escalated", "handoff_reason": reason, "reply": reply}

    def finalize(state: SupportState) -> dict:
        hits = [Hit(**h) for h in state.get("hits", [])]
        reply = render_sources(state["draft"], hits)
        if state.get("followup"):
            reply += "\n\n" + state["followup"]
        deps.finish_ticket(state["ticket"]["id"], "resolved", state["triage"]["category"], state["triage"]["summary"])
        return {"outcome": "resolved", "reply": reply}

    return {"load_customer": load_customer, "classify": classify, "retrieve": retrieve, "act": act,
            "draft": draft, "check": check, "approval": approval, "handoff": handoff, "finalize": finalize}
```

<div class="line-notes">

- `from dataclasses import asdict` `asdict(hit)` 把 Hit 对象转成普通字典,状态里只存字典,checkpointer 才好序列化。
- `from langgraph.config import get_stream_writer` 拿到当前运行的 custom 流写入函数,节点用它往外推事件。
- `from langgraph.types import interrupt` 审批节点用它让图停下来等人。
- `from ..kb.cite import build_context, check_citations, render_sources` 两个点表示上一级包 `supportpilot`,`..kb.cite` 就是 `supportpilot/kb/cite.py`(Day 45 写的)。
- `PROMISE_RE = re.compile(` 拆开读三段,用 `|` 连起来:<br>① `已(经)?(为您|给您)?(办理|完成)?退款(?!申请)` 匹配「已退款」「已为您退款」「已经为您完成退款」,结尾的 `(?!申请)` 是否定前瞻,后面紧跟「申请」就不算;<br>② `退款已(到账|完成|办理|退回)`;<br>③ `马上到账`。<br>实测「已为您提交退款申请」「已为您办理退款申请」都不命中。但这条规则也会误伤:「账单已是『已退款』状态」命中了 `已退款`。端到端时第 4 张(李娜「先问问」)就栽在这里:第 3 张批准后那张账单已经退了,两版草稿都如实写了「目前状态为已退款」,都被当成违规承诺打回,最后转了人工。描述状态被当成承诺,这是 Day 51 要修的误判。
- `def _ticket_text(state: SupportState) -> str:` 实测拼出来是 `发件邮箱:lina@example.com\n主题:想退款\n正文:上周买的专业版年付,发现用不上,请帮我退款。`。分诊、act、起草、质检都用这一份。
- `get_stream_writer()(event)` 两对括号:先调用拿到写入函数,再用 event 调用它。
- `except RuntimeError:` 单测里直接调节点函数时不在 LangGraph 运行上下文里,`get_stream_writer()` 会抛 RuntimeError,吞掉即可。
- `def make_nodes(deps: Deps) -> dict:` 九个节点都定义在这个函数里面,形成闭包,每个节点都能直接用 `deps`,图本身不需要知道依赖从哪来。
- `text, err = deps.call_tool("get_customer"` 用发件邮箱查客户。这一步不调模型,零成本。
- `customer = None if err else json.loads(text)` 实测李娜返回 C0002 的档案,事件是 `{'found': True}`;第 9 张 `nobody@example.com` 查不到,customer 是 None,事件是 `{'found': False}`。
- `return {"customer": customer, "revisions": 0, "refund_request": None, "approval": None}` 顺手把几个计数器和标志初始化,后面的节点就不用处处判断键在不在。
- `before = deps.spent()` 记下账本读数,节点结束时用差值算这一步花了多少。
- `triage = deps.small_llm.structured(` 实测第 3 张的分诊是 `{"category": "refund", "needs_account_data": true, "needs_human": false, "urgency": "normal", "summary": "客户要求退上周购买的专业版年付费用", "search_query": "专业版 年付 退款"}`。
- `return {"triage": triage.model_dump(), "cost_cny": deps.spent() - before}` 实测分诊这一步花了 0.00168 元。
- `query = tr.get("search_query") or f"{state['ticket']['subject']}` 分诊没给检索词时退回用主题加正文。f-string 里取字典值用单引号,因为外层是双引号。
- `hits = deps.retriever.search(query, k=deps.settings.retrieve_k)` k 是 5。实测「能退吗」那单检索到 `KB-refund-001、KB-refund-001、KB-refund-003、KB-refund-001、KB-refund-002`,分数 0.0328 到 0.0306。分数这么小是因为用的是 RRF 融合分;同一篇 KB-refund-001 出现三次,是命中了它的三个小节。
- `return {"hits": [asdict(h) for h in hits]}` 存进状态前转成字典。
- `cust = state["customer"]` 走到 act 一定有客户,路由 `after_retrieve` 保证了这一点,所以这里直接用 `[]` 取。
- `{"role": "user", "content": f"客户档案:{json.dumps(cust, ensure_ascii=False)}` 客户档案直接放进消息,提示词又说「不用再查 get_customer」,省一轮工具调用。
- `tools = openai_tools({Level.READ, Level.PROPOSE})` 只给只读和「提申请」两级的工具。实测是 7 个:get_customer、list_subscriptions、list_invoices、check_refund_eligibility、search_past_tickets、create_refund_request、query_customer_data。真正执行退款的工具不在里面,模型想退也退不了。
- `for step in range(deps.settings.max_act_steps):` 最多 5 轮模型调用。
- `res = deps.llm.chat(msgs, tools=tools, temperature=0)` 温度 0,调查这一步要稳定,不要发挥。
- `if not res.tool_calls:` 模型不再调工具,说明它认为查够了,这次的文字就是调查结论,break 跳出循环。
- `msgs.append(res.raw_message)` 先把 assistant 的工具调用放进历史,下面的 tool 结果才有对应的 id。
- `for call in res.tool_calls:` 一轮可能有好几个调用。实测「能退吗」:step 0 同时调了 list_subscriptions 和 list_invoices,step 1 调 check_refund_eligibility,step 2 不再调工具,输出结论。一共 3 轮模型调用。
- `text, err = deps.call_tool(call["name"], call["arguments"], ticket_id=tid, customer_id=cust["id"])` 实测 check_refund_eligibility 返回 `{"invoice_id": "INV-202609-0002", "eligible": true, "rule": "annual_first_14_days", "reason": "年付首次购买第 7 天,在 14 天内,全额退款。", "refund_amount_cny": 950.0, ...}`。
- `log.append({"step": step, "name": call["name"]` `result` 截到 500 字,日志不至于太大。
- `if call["name"] == "create_refund_request" and not err:` 实测第 3 张建了 `RF-T000153-INV-202609-0002`,950 元,status 是 pending;「先问问」那张没建,refund_request 保持 None。
- `msgs.append({"role": "tool", "tool_call_id": call["id"], "content": text})` 工具结果按 id 喂回模型。工具报错(err=True)也照样喂回去,让模型自己改参数。
- `else:` 这个 else 属于 for,不属于 if:for 循环正常跑完、中间一次都没 break,才会执行它,也就是 5 轮用完模型还在调工具。
- `findings = "(调查达到步数上限` 把已经查到的结果拼成结论,前面花的钱不白花。实测 10 张演示工单都没有走到这里。
- `return {"tool_log": log, "findings": findings, "refund_request": refund_request,` 实测「能退吗」这一步花了 0.01329 元,是整单里最贵的一步:三轮调用,每轮都带着越来越长的工具结果。
- `hits = [Hit(**h) for h in state.get("hits", [])]` 把字典还原成 Hit 对象,`**h` 把字典展开成关键字参数。
- `parts = [f"【客户工单】` 用中文方括号把几块材料分开,提示词里引用的就是这些标题。
- `f"【调查结论】\n{state.get('findings') or '(没有查询客户数据)'}"]` 没走 act 的工单(比如专票、报错码)这里就是固定的一句话。
- `if state.get("customer") is None and state["triage"].get("needs_account_data"):` 实测第 9 张 nobody 走到这里,草稿里写了「请提供注册邮箱」。
- `if state.get("refund_request"):` 实测第 3 张拼出 `【待审批退款申请】RF-T000153-INV-202609-0002,金额 950.00 元,规则 annual_first_14_days`。`:.2f` 把 float 格式化成两位小数。
- `if state.get("review") and not state["review"].get("passed"):` 质检打回后再进 draft,会多出这一块。实测第 9 张(找不到客户)第一版被退回三条意见,第二版改成「目前尚未能定位到对应账户,请您提供注册邮箱」,并补上了退款流程,质检通过。
- `res = deps.llm.stream(` 流式生成,每段文字通过 `_emit` 推出去。实测第 3 张 draft 这一步花了 0.00216 元。
- `_, fake = check_citations(state["draft"], hits)` `check_citations` 返回两样,第一样用不上,就用 `_` 接住。`fake` 是草稿里出现、但检索结果里没有的编号。
- `if PROMISE_RE.search(state["draft"]):` 规则二。实测第 4 张两版草稿都在这里被拦,原因见上面 PROMISE_RE 那条。
- `if not problems:` 规则检查都过了才花钱让模型检查;规则已经发现问题,就不再调模型。
- `【回复草稿】\n{state['draft']}` 注意质检模型拿到的是工单、资料、调查结论和草稿,**拿不到** draft 那一步加的「【注意】没有找到这个邮箱对应的客户账户」。实测第 9 张第一版写「目前我们未能查询到该邮箱对应的客户账户」,质检判「调查结论为『无』,没有任何依据」打回。这又是一条可以记进问题清单的。
- `problems.extend(review.problems if not review.passed else [])` 模型判不过时把它列的问题并进来。
- `"revisions": state.get("revisions", 0) + (0 if passed else 1),` 实测第 3 张一次通过,revisions 保持 0;第 9 张第一次不过变成 1,第二次通过保持 1;第 6 张两次都不过,变成 2,转人工。
- `decision = interrupt({"type": "refund_approval"` 图在这里停下,这个字典交给外面。实测 payload 的 request 是 `{"id": "RF-T000153-INV-202609-0002", "amount_cny": 950.0, "rule": "annual_first_14_days", "status": "pending", "note": "已创建待审批的退款申请。不要告诉客户退款已完成,只能说已提交审核。", ...}`。
- `"needs_finance_review": rr["amount_cny"] > deps.settings.refund_review_threshold})` 950 > 1000 是 False,审批面板上不标红。
- `approved = bool(decision.get("approved"))` 恢复时 `Command(resume=...)` 传进来的字典,就是这里 `interrupt()` 的返回值。
- `result = deps.decide_refund(rr["id"], approved` 人的决定落到数据库。实测批准后 `result_status` 是 `executed`。
- `followup = f"补充:您的退款申请已审核通过` 实测是 `补充:您的退款申请已审核通过,950.00 元将原路退回,到账时间以支付渠道为准。`。金额是 float,直接拼会显示成 `950.0 元`;`:.2f` 统一成两位小数,和 Day 23 的 `yuan()` 一个写法。
- `followup = ("补充:很抱歉,您的退款申请经审核未通过"` 实测第 5 张选了 n,备注是「演示驳回」,得到 `补充:很抱歉,您的退款申请经审核未通过,原因:演示驳回。如有疑问可以直接回复这个工单。`。
- `reason = state.get("handoff_reason") or (` 实测投诉单的原因是「客户要求人工或涉及投诉/安全」;第 4 张是「草稿多次未通过质检:草稿承诺了退款已完成/马上到账,退款必须经过人工审核」;第 6 张是「草稿多次未通过质检:草稿称『另一笔为正常扣款』,但调查结论明确……」。
- `rr = state.get("refund_request")` 转人工前先看 act 有没有建过退款申请。
- `if rr and rr.get("status") == "pending":` 只有「申请建了、草稿两次没过质检」这条路会带着 pending 申请走到这里;直接转人工的工单(投诉、needs_human)根本没进 act,rr 是 None。
- `deps.decide_refund(rr["id"], False, "system:handoff"` 把申请标成 rejected 并写明原因。实测第 6 张(重复扣款)两次质检不过转人工后,库里这条是 `RF-T000154-INV-202609-0004 | rejected | system:handoff | 工单已转人工,这条申请作废,由人工客服重新判断`,pending 的申请一条都没剩,审批列表里不会再出现它。不作废的话,它会一直挂在 Day 49 的审批列表里,点通过返回 409。
- `reply = "您好,您的问题已经转给人工客服同事` 转人工时给客户的固定话术,不调模型。
- `reply = render_sources(state["draft"], hits)` 把 `[KB-refund-001]` 换成 `[1]`,文末加「参考文章」和链接。
- `deps.finish_ticket(state["ticket"]["id"], "resolved"` 更新工单状态、分类和摘要。
- `return {"load_customer": load_customer, "classify": classify` 返回节点名到函数的字典,`build_graph` 遍历它注册节点。

</div>



逐个说。

**load_customer**:用发件邮箱查客户。查不到不报错,`customer` 为 None,后面的节点会据此让客户提供注册邮箱。这一步不调大模型,零成本。

**classify**:分诊。用小模型、温度 0、结构化输出。输出分类、是否需要查账户、是否需要转人工、紧急程度、一句话摘要、检索查询。

**retrieve**:用分诊给的 `search_query` 去检索。如果分诊没给就用原文。

**act**:全图唯一的 agent 循环,和 Day 9 手写的那个结构一样:调模型 → 有工具调用就执行 → 结果喂回 → 直到模型不再调工具。区别在于加了这些:

- 步数上限 `max_act_steps=5`,用 `for ... else` 写:循环正常跑完(没 break)说明到了上限,这时把已经查到的工具结果拼成调查结论,不浪费已经花的钱。
- 每次工具调用都记进 `tool_log`,并通过 `_emit` 推一个事件给前端。
- 工具错误(`err=True`)照常喂回模型,让它自己改参数重试。
- `create_refund_request` 成功时,把返回的申请记进 `refund_request`,后面的路由要用。
- 客户 ID 已经放进了用户消息,提示词也说"不需要再查 get_customer",省一轮。

**draft**:起草。把工单、检索资料(带编号)、调查结论、待审批申请、上一版被退回的原因全拼进去。用流式生成,每段文字通过 `_emit` 推出去,Day 49 的界面上就能看到打字机效果。

**check**:质检,先规则后模型。规则一:引用了检索结果里没有的编号。规则二:正则匹配到"已为您退款""马上到账"这类违规承诺。规则查出问题就不再调模型,省钱;规则过了才让小模型核对事实依据。这就是 Day 13 的 evaluator-optimizer:不通过就带着问题清单回到 draft 重写。

**approval**:退款审批。调用 `interrupt()`,图在这里停下,把申请详情交给外面。人的决定通过 `Command(resume=...)` 传回来,成为 `interrupt()` 的返回值。然后调 `decide_refund` 执行或驳回,写一句补充说明给客户。

这里有个 LangGraph 的规则一定要记住:**节点恢复时会从头重跑,`interrupt()` 之前的代码会执行两次。**所以 interrupt 之前只放没有副作用的代码(构造 payload),写库、发通知都放在 interrupt 之后或者别的节点里。Day 46 把审批通知放在工具层就是这个原因。

**handoff**:转人工。调 `escalate` 把工单标为 escalated,给客户一句固定的话。原因写进 `handoff_reason`,人工接手时能看到。还有一种情况要收尾:act 已经建了退款申请,草稿却两次没过质检转了人工。这条申请永远走不到 approval 节点,如果留着 pending,它会出现在 Day 49 的审批列表里,有人点通过却没有对应的图可以恢复(Day 49 实测返回 409)。所以转人工前把它作废(标成 rejected 并写明原因),要不要退由接手的人重新判断。

**finalize**:定稿。把草稿里的 `[KB-xxx]` 渲染成 `[1] [2]` 和文末链接,有审批结果的话加上补充说明,更新工单状态。

`_emit` 包了一层 try。`get_stream_writer()` 只在 LangGraph 运行时有效,单测里直接调节点函数时没有运行上下文,包一层让节点在任何地方都能调。

## 图和路由

```python
# supportpilot/src/supportpilot/agent/graph.py
from langgraph.graph import END, START, StateGraph

from .deps import Deps
from .nodes import make_nodes
from .state import SupportState


def after_classify(state: SupportState) -> str:
    return "handoff" if state["triage"]["needs_human"] else "retrieve"


def after_retrieve(state: SupportState) -> str:
    if state["triage"]["needs_account_data"] and state.get("customer"):
        return "act"
    return "draft"


def after_check(deps: Deps):
    def route(state: SupportState) -> str:
        if state["review"]["passed"]:
            rr = state.get("refund_request")
            return "approval" if rr and rr.get("status") == "pending" else "finalize"
        if state.get("revisions", 0) <= deps.settings.max_revisions:
            return "draft"
        return "handoff"
    return route


def build_graph(deps: Deps, checkpointer=None):
    n = make_nodes(deps)
    g = StateGraph(SupportState)
    for name, fn in n.items():
        g.add_node(name, fn)
    g.add_edge(START, "load_customer")
    g.add_edge("load_customer", "classify")
    g.add_conditional_edges("classify", after_classify, ["retrieve", "handoff"])
    g.add_conditional_edges("retrieve", after_retrieve, ["act", "draft"])
    g.add_edge("act", "draft")
    g.add_edge("draft", "check")
    g.add_conditional_edges("check", after_check(deps), ["approval", "finalize", "draft", "handoff"])
    g.add_edge("approval", "finalize")
    g.add_edge("finalize", END)
    g.add_edge("handoff", END)
    return g.compile(checkpointer=checkpointer)
```

<div class="line-notes">

- `from langgraph.graph import END, START, StateGraph` START、END 是图的入口和出口。
- `def after_classify(state: SupportState) -> str:` 返回下一个节点的名字。实测第 10 张投诉单 needs_human 是 true,走 handoff;其余 9 张走 retrieve。
- `def after_retrieve(state: SupportState) -> str:` 要查账而且找到了客户才进 act。实测:李娜退款单 → act;第 1 张专票 needs_account_data 是 false → draft;第 9 张 nobody 没有客户 → draft。
- `def after_check(deps: Deps):` 路由函数要读 `max_revisions`,所以写成「返回一个函数的函数」,用闭包把 deps 带进去。
- `return "approval" if rr and rr.get("status") == "pending" else "finalize"` 质检过了:有待审批的申请就去审批,没有就定稿。
- `if state.get("revisions", 0) <= deps.settings.max_revisions:` 实测路由表(max_revisions=1):<br>passed=False、revisions=1 → draft;<br>passed=False、revisions=2 → handoff;<br>passed=True、有 pending 申请 → approval;<br>passed=True、没有申请 → finalize。
- `n = make_nodes(deps)` 拿到九个节点函数。
- `g = StateGraph(SupportState)` 用状态的类型建图,reducer(tool_log、cost_cny 的累加)从这里读出来。
- `for name, fn in n.items():` 逐个注册节点。
- `g.add_edge(START, "load_customer")` 普通边,固定走向。
- `g.add_conditional_edges("classify", after_classify, ["retrieve", "handoff"])` 条件边:跑完 classify 调 `after_classify`,按返回的名字走。第三个参数列出所有可能的去处。
- `g.add_conditional_edges("check", after_check(deps), ["approval", "finalize", "draft", "handoff"])` 注意这里是 `after_check(deps)`,先调用一次拿到真正的路由函数。
- `return g.compile(checkpointer=checkpointer)` 不传 checkpointer 也能编译,只是遇到 interrupt 停下后状态没处存,无法恢复。

</div>



<figure>
<svg viewBox="0 0 640 400" role="img" aria-label="SupportPilot 工作流图">
<g font-family="var(--font-mono)" font-size="11">
<rect x="250" y="10" width="140" height="28" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="320" y="28" text-anchor="middle" fill="var(--ink)">load_customer</text>
<rect x="250" y="58" width="140" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="320" y="76" text-anchor="middle" fill="var(--ink)">classify</text>
<rect x="250" y="112" width="140" height="28" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="320" y="130" text-anchor="middle" fill="var(--ink)">retrieve</text>
<rect x="120" y="166" width="120" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="180" y="184" text-anchor="middle" fill="var(--ink)">act ⟳ 工具</text>
<rect x="250" y="220" width="140" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="320" y="238" text-anchor="middle" fill="var(--ink)">draft</text>
<rect x="250" y="274" width="140" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="320" y="292" text-anchor="middle" fill="var(--ink)">check</text>
<rect x="110" y="330" width="120" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="170" y="348" text-anchor="middle" fill="var(--ink)">approval ⏸</text>
<rect x="260" y="364" width="120" height="28" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="320" y="382" text-anchor="middle" fill="var(--ink)">finalize → END</text>
<rect x="470" y="300" width="130" height="28" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="535" y="318" text-anchor="middle" fill="var(--ink)">handoff → END</text>
</g>
<g stroke="var(--ink-faint)" stroke-width="1.3" fill="none" font-family="var(--font-mono)" font-size="10">
<line x1="320" y1="38" x2="320" y2="56"/>
<line x1="320" y1="86" x2="320" y2="110"/>
<path d="M390 72 C 470 72, 530 150, 535 298"/><text x="470" y="100" fill="var(--ink-soft)" stroke="none">needs_human</text>
<path d="M290 140 L 200 164"/><text x="150" y="155" fill="var(--ink-soft)" stroke="none">要查账且有客户</text>
<line x1="320" y1="140" x2="320" y2="218"/><text x="326" y="180" fill="var(--ink-soft)" stroke="none">否则</text>
<path d="M200 194 L 290 218"/>
<line x1="320" y1="248" x2="320" y2="272"/>
<path d="M390 288 C 430 288, 430 234, 392 234"/><text x="436" y="262" fill="var(--ink-soft)" stroke="none">不过且未超次数</text>
<path d="M390 296 L 468 312"/><text x="420" y="338" fill="var(--ink-soft)" stroke="none">再不过</text>
<path d="M280 302 L 200 328"/><text x="160" y="318" fill="var(--ink-soft)" stroke="none">通过且有待审批</text>
<line x1="320" y1="302" x2="320" y2="362"/>
<path d="M230 344 L 270 364"/>
</g>
</svg>
<figcaption>九个节点,四个条件分支。蓝色节点调大模型,琥珀色的审批节点会停下来等人。只有 act 内部是一个自主循环,其余流转都是代码写死的。</figcaption>
</figure>

四个路由函数都是纯函数,只看状态里的字段做判断,不调模型。分支逻辑一目了然,出了问题看一眼状态就知道为什么走了这条路。

`after_check` 里的 `revisions <= max_revisions`:第一次质检不过,revisions 变成 1,1 ≤ 1,回去重写;第二次还不过,revisions 变成 2,2 > 1,转人工。也就是说最多重写一次。为什么不多给几次?因为同一个模型、同样的资料,第三次写出来通常和第二次差不多,多重试只是多花钱。两次都过不了,说明资料不够或者问题超出了能力范围,该交给人。

`add_conditional_edges` 的第三个参数列出了所有可能去的节点。不写也能跑,但写上之后 LangGraph 能在编译时检查,画图时也能画出所有分支。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1HVFLzfEeS&autoplay=0&high_quality=1" title="挑战19分钟搞定,LangGraph快速入门与原理剖析" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>敲代码的码农 · 挑战 19 分钟搞定,LangGraph 快速入门与原理剖析 · 如果 Day 24 的 LangGraph 基础有点忘了,看这个快速复习状态、节点、条件边。</figcaption>
</figure>

## 为什么不用现成的预置 agent

LangGraph 有现成的预置 ReAct agent,几行代码就能得到一个"模型 + 工具"的循环,Day 24 你用过。为什么 act 节点要自己写?

一是要控制。我需要在工具调用之间插入自己的逻辑:记录日志、推送事件、识别退款申请、步数用完时把已查到的结果整理成结论。预置 agent 也能通过钩子做到一部分,但每加一样就要去翻一次文档看它支持不支持。自己写的循环就二十几行,想加什么直接加。

二是要看得懂。面试时被问"你的 agent 循环是怎么实现的",指着自己写的二十行讲清楚,比说"我调了某个函数"有说服力得多。Day 9 手写过,这里只是把它放进了产品代码。

如果你的场景就是标准的"模型加几个工具",没有这些定制需求,用预置的完全没问题。框架是工具,不是信仰。

## 单测:不花一分钱验证整条流程

工作流的逻辑(路由对不对、审批停没停、质检打回后有没有重写)和大模型的能力是两回事。前者用假 LLM 测,确定、免费、几秒钟;后者 Day 50 用评测测。

```python
# supportpilot/tests/fakes.py
"""假的 LLM / 检索 / 工具,让工作流的单测不连数据库、不花钱、结果确定。"""

import json

from supportpilot.agent import prompts
from supportpilot.agent.deps import Deps
from supportpilot.config import Settings
from supportpilot.kb.retriever import Hit
from supportpilot.llm import ChatResult, Usage


class FakeLLM:
    def __init__(self, triage: dict, act_script: list[list[tuple[str, dict]]], draft: str, review_ok: bool = True):
        self.triage, self.act_script, self.draft_text, self.review_ok = triage, list(act_script), draft, review_ok
        self.ledger = Usage()

    def structured(self, messages, schema, **_):
        self.ledger.add(Usage(100, 20, 1))
        if messages[0]["content"] == prompts.CLASSIFY:
            return schema(**self.triage)
        return schema(passed=self.review_ok, problems=[] if self.review_ok else ["金额没有依据"])

    def chat(self, messages, tools=None, **_):
        self.ledger.add(Usage(300, 50, 1))
        if not self.act_script:
            return ChatResult(content="调查结论:- 已查清")
        calls = [{"id": f"c{i}", "name": n, "arguments": json.dumps(a)} for i, (n, a) in
                 enumerate(self.act_script.pop(0))]
        raw = {"role": "assistant", "content": "", "tool_calls": [
            {"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": c["arguments"]}}
            for c in calls]}
        return ChatResult(content="", tool_calls=calls, raw_message=raw)

    def stream(self, messages, on_token=None, **_):
        self.ledger.add(Usage(800, 150, 1))
        for piece in (self.draft_text[:10], self.draft_text[10:]):
            if on_token:
                on_token(piece)
        return ChatResult(content=self.draft_text)


class FakeRetriever:
    def search(self, query, k=5):
        return [Hit(1, "KB-refund-002", "年付 14 天无理由退款", "条件", "首次购买的年付订阅 14 天内全额退款。",
                    "/help/refund/002", "refund", 0.03, ["vector", "bm25"])]


class FakeTools:
    def __init__(self, customer: dict | None = None):
        self.customer = customer
        self.calls: list[str] = []
        self.decided: list[tuple] = []
        self.escalated: list[str] = []
        self.finished: list[tuple] = []

    def __call__(self, name, arguments, *, ticket_id, customer_id=None):
        self.calls.append(name)
        args = json.loads(arguments) if isinstance(arguments, str) else arguments
        if name == "get_customer":
            return (json.dumps(self.customer), False) if self.customer else ("没有找到客户", True)
        if name == "list_invoices":
            return json.dumps({"total": 1, "returned": 1, "invoices": [{"id": "INV-202609-0001"}]}), False
        if name == "check_refund_eligibility":
            return json.dumps({"invoice_id": args["invoice_id"], "eligible": True, "refund_amount_cny": 950.0,
                               "rule": "annual_first_14_days"}), False
        if name == "create_refund_request":
            return json.dumps({"id": f"RF-{ticket_id}-{args['invoice_id']}", "status": "pending",
                               "amount_cny": 950.0, "rule": "annual_first_14_days"}), False
        return "未知工具", True


def make_deps(llm: FakeLLM, tools: FakeTools) -> Deps:
    return Deps(llm=llm, small_llm=llm, retriever=FakeRetriever(), call_tool=tools,
                escalate=lambda tid, reason: tools.escalated.append(tid),
                decide_refund=lambda rid, ok, who, note: (tools.decided.append((rid, ok)) or
                                                          {"status": "executed" if ok else "rejected"}),
                finish_ticket=lambda *a: tools.finished.append(a), settings=Settings())
```

<div class="line-notes">

- `class FakeLLM:` 冒充 LLMClient,只实现节点用到的 `structured`、`chat`、`stream` 三个方法和 `ledger`。
- `self.triage, self.act_script, self.draft_text, self.review_ok = triage, list(act_script), draft, review_ok` 一行同时给四个属性赋值。`list(act_script)` 复制一份,后面 `pop` 不会改到测试文件里的常量 ACT。
- `def structured(self, messages, schema, **_):` `**_` 吞掉用不上的关键字参数(retries、model)。
- `self.ledger.add(Usage(100, 20, 1))` 位置参数依次是输入、输出、次数。每次结构化调用记 100 / 20。
- `if messages[0]["content"] == prompts.CLASSIFY:` 看系统提示认出是哪个节点在调用:分诊返回预设结果,其余就是质检。
- `return schema(passed=self.review_ok` 质检结果。`review_ok=False` 时固定返回一条问题「金额没有依据」。
- `def chat(self, messages, tools=None, **_):` act 用的。每次记 300 / 50。
- `if not self.act_script:` 剧本用完就返回调查结论,act 循环会 break。
- `calls = [{"id": f"c{i}", "name": n, "arguments": json.dumps(a)}` 剧本里的一轮转成工具调用列表。`enumerate` 给每个调用编号 c0、c1……
- `def stream(self, messages, on_token=None, **_):` 起草用的,每次记 800 / 150。
- `for piece in (self.draft_text[:10], self.draft_text[10:]):` 把草稿切成两段,模拟流式推送。
- `class FakeRetriever:` 不管问什么都返回同一条资料 KB-refund-002。
- `return [Hit(1, "KB-refund-002"` 按位置依次是 chunk_id、doc_id、title、heading、text、url_path、category、score、via。
- `class FakeTools:` 冒充工具层,同时记下调用了什么。
- `def __call__(self, name, arguments, *, ticket_id, customer_id=None):` 定义了 `__call__`,实例就能像函数一样被调用,所以能直接塞进 `Deps.call_tool`。
- `args = json.loads(arguments) if isinstance(arguments, str) else arguments` load_customer 传的是字典,act 传的是模型给的 JSON 字符串,两种都接。
- `if name == "get_customer":` 有客户就返回档案,没有就返回错误。
- `return json.dumps({"invoice_id": args["invoice_id"], "eligible": True, "refund_amount_cny": 950.0,` 资格检查固定判符合,950 元。
- `return json.dumps({"id": f"RF-{ticket_id}-{args['invoice_id']}", "status": "pending",` 申请号的拼法和真实工具一致。
- `def make_deps(llm: FakeLLM, tools: FakeTools) -> Deps:` 用假零件组装一个 Deps,大模型、小模型都是同一个 FakeLLM。
- `decide_refund=lambda rid, ok, who, note: (tools.decided.append((rid, ok)) or` `append` 返回 None,`None or {...}` 取右边。一行 lambda 里既记录又返回结果,用的就是这个小技巧。
- `finish_ticket=lambda *a: tools.finished.append(a), settings=Settings())` `*a` 把所有位置参数收成元组。实测退款测试结束后 finished 是 `[('T000900', 'resolved', 'refund', '年付首购想退款')]`。

</div>



`FakeLLM` 按系统提示判断自己被哪个节点调用:分诊时返回预设的分诊结果,act 时按剧本依次返回工具调用,起草时返回预设草稿。`FakeTools` 模拟工具返回,同时记录被调用了哪些工具、审批了什么、转人工了什么,测试里可以断言。

```python
# supportpilot/tests/test_graph_smoke.py
import pytest
from fakes import FakeLLM, FakeTools, make_deps
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from supportpilot.agent.graph import build_graph

TICKET = {"id": "T000900", "customer_email": "lina@example.com", "subject": "想退款",
          "body": "上周买的专业版年付,用不上,请帮我退款。"}
REFUND_TRIAGE = {"category": "refund", "needs_account_data": True, "needs_human": False, "urgency": "normal",
                 "summary": "年付首购想退款", "search_query": "年付 退款"}
ACT = [[("list_invoices", {"customer_id": "C0002"})],
       [("check_refund_eligibility", {"invoice_id": "INV-202609-0001"})],
       [("create_refund_request", {"invoice_id": "INV-202609-0001", "reason": "首购 7 天不需要"})]]
DRAFT = "您好,您的年付订阅在 14 天内,符合全额退款条件 [KB-refund-002]。已提交退款申请,审核通过后会原路退回。"


def test_refund_goes_through_approval_then_resumes():
    tools = FakeTools(customer={"id": "C0002", "email": "lina@example.com"})
    graph = build_graph(make_deps(FakeLLM(REFUND_TRIAGE, ACT, DRAFT), tools), checkpointer=InMemorySaver())
    cfg = {"configurable": {"thread_id": TICKET["id"]}}

    out = graph.invoke({"ticket": TICKET}, cfg)
    assert "__interrupt__" in out                          # 停在审批节点
    payload = out["__interrupt__"][0].value
    assert payload["request"]["status"] == "pending"
    assert tools.calls == ["get_customer", "list_invoices", "check_refund_eligibility", "create_refund_request"]
    assert tools.decided == []                              # 人还没点,钱一分没动

    out = graph.invoke(Command(resume={"approved": True, "approver": "finance-amy"}), cfg)
    assert out["outcome"] == "resolved"
    assert tools.decided == [("RF-T000900-INV-202609-0001", True)]
    assert "[1]" in out["reply"] and "参考文章" in out["reply"]
    assert out["cost_cny"] > 0


def test_handoff_withdraws_pending_refund():
    tools = FakeTools(customer={"id": "C0002", "email": "lina@example.com"})
    deps = make_deps(FakeLLM(REFUND_TRIAGE, ACT, DRAFT, review_ok=False), tools)
    out = build_graph(deps).invoke({"ticket": TICKET})
    assert out["outcome"] == "escalated"
    assert tools.decided == [("RF-T000900-INV-202609-0001", False)]   # 申请被作废,不会留在审批列表里


def test_policy_question_skips_tools():
    triage = {**REFUND_TRIAGE, "category": "invoice", "needs_account_data": False, "summary": "专票怎么开"}
    tools = FakeTools(customer={"id": "C0001"})
    graph = build_graph(make_deps(FakeLLM(triage, [], DRAFT), tools))
    out = graph.invoke({"ticket": {**TICKET, "body": "专票怎么开"}})
    assert tools.calls == ["get_customer"]                 # 没进 act
    assert out["outcome"] == "resolved"


def test_angry_customer_goes_to_human():
    triage = {**REFUND_TRIAGE, "needs_human": True}
    tools = FakeTools(customer={"id": "C0002"})
    out = build_graph(make_deps(FakeLLM(triage, [], DRAFT), tools)).invoke({"ticket": TICKET})
    assert out["outcome"] == "escalated" and tools.escalated == ["T000900"]


def test_failed_review_twice_escalates():
    tools = FakeTools(customer={"id": "C0001"})
    triage = {**REFUND_TRIAGE, "needs_account_data": False}
    out = build_graph(make_deps(FakeLLM(triage, [], DRAFT, review_ok=False), tools)).invoke({"ticket": TICKET})
    assert out["outcome"] == "escalated"
    assert out["revisions"] == 2


def test_promise_rule_blocks_draft_without_llm():
    tools = FakeTools(customer={"id": "C0001"})
    triage = {**REFUND_TRIAGE, "needs_account_data": False}
    bad = "您好,已为您退款,马上到账 [KB-refund-002]。"
    out = build_graph(make_deps(FakeLLM(triage, [], bad), tools)).invoke({"ticket": TICKET})
    assert out["outcome"] == "escalated"
    assert any("承诺" in p for p in out["review"]["problems"])


@pytest.mark.parametrize("text,bad", [
    ("已为您退款,马上到账", True), ("退款已到账", True), ("已为您完成退款", True),
    ("已为您提交退款申请,审核通过后原路退回", False), ("已为您办理退款申请", False),
])
def test_promise_regex(text, bad):
    from supportpilot.agent.nodes import PROMISE_RE
    assert bool(PROMISE_RE.search(text)) is bad
```

<div class="line-notes">

- `from fakes import FakeLLM, FakeTools, make_deps` 直接导入同目录的 fakes.py。pytest 收集 tests 目录时会把它加进搜索路径。
- `from langgraph.checkpoint.memory import InMemorySaver` 内存版存档,审批停下后状态存在这里。
- `TICKET = {"id": "T000900"` 固定的测试工单。
- `ACT = [[("list_invoices"` 三轮剧本,每轮一个工具调用:查账单、查资格、建申请。
- `DRAFT = "您好,您的年付订阅在 14 天内` 合规草稿,带一个引用编号。
- `def test_refund_goes_through_approval_then_resumes():` 实测 14 个测试(含 test_llm 的 3 个)全部通过,0.99 秒。
- `cfg = {"configurable": {"thread_id": TICKET["id"]}}` thread_id 区分不同工单的存档,恢复时要用同一个。
- `out = graph.invoke({"ticket": TICKET}, cfg)` 实测停下时 out 里有 `__interrupt__`,payload 的键是 type、ticket_id、request、draft、needs_finance_review(950 < 1000,所以是 False)。
- `assert tools.calls == ["get_customer", "list_invoices", "check_refund_eligibility", "create_refund_request"]` 实测完全一致。这时假 LLM 被调了 7 次:分诊 1、act 4(3 轮工具加 1 轮结论)、起草 1、质检 1。cost_cny 是 0.00752:输入 2200 × 2 / 1e6 + 输出 390 × 8 / 1e6。
- `out = graph.invoke(Command(resume={"approved": True, "approver": "finance-amy"}), cfg)` 带着同一个 cfg 恢复,图从 approval 节点接着跑。
- `assert tools.decided == [("RF-T000900-INV-202609-0001", True)]` 人点了通过,才真正执行。
- `assert "[1]" in out["reply"] and "参考文章" in out["reply"]` 实测 reply 是「您好,您的年付订阅在 14 天内,符合全额退款条件 [1]。已提交退款申请,审核通过后会原路退回。」加上「参考文章:[1] 年付 14 天无理由退款 https://help.cloudledger.example/help/refund/002」和那句审核通过的补充。
- `assert out["cost_cny"] > 0` 恢复之后 approval 和 finalize 都不调模型,实测 cost_cny 还是 0.00752。
- `def test_handoff_withdraws_pending_refund():` 退款剧本照走,但质检永远不过:申请建了,草稿却过不了关。
- `deps = make_deps(FakeLLM(REFUND_TRIAGE, ACT, DRAFT, review_ok=False), tools)` 没传 checkpointer,这条路不会停在审批,质检两次不过直接转人工。
- `assert tools.decided == [("RF-T000900-INV-202609-0001", False)]` 实测 handoff 用 `False` 调了一次 decide_refund,申请被作废。没有这几行代码时 decided 是空列表,申请会一直 pending。
- `triage = {**REFUND_TRIAGE, "category": "invoice", "needs_account_data": False` `{**旧字典, 键: 新值}` 复制一份再改几个字段。
- `graph = build_graph(make_deps(FakeLLM(triage, [], DRAFT), tools))` 没传 checkpointer:这条路不会停,用不着存档。
- `assert tools.calls == ["get_customer"]` 只调了 load_customer 的那一次,没进 act。
- `def test_angry_customer_goes_to_human():` needs_human 为 true,classify 之后直接转人工。
- `def test_failed_review_twice_escalates():` 实测假 LLM 一共被调 5 次(分诊、起草、质检、起草、质检),revisions 0 → 1 → 2,handoff_reason 是「草稿多次未通过质检:金额没有依据」。
- `def test_promise_rule_blocks_draft_without_llm():` 实测假 LLM 只被调了 3 次(分诊加两次起草),两次质检都被正则拦下,一次模型质检都没花。
- `@pytest.mark.parametrize("text,bad", [` 一个测试函数配 5 组数据,pytest 会展开成 5 个测试。
- `def test_promise_regex(text, bad):` 5 组全部通过。我另外补测了「账单已是『已退款』状态」,它也会命中 `已退款`,这组不在用例里,端到端时就踩到了。

</div>



前六个测试各守一条底线:

- 退款工单一定会停在审批节点,人没点之前 `decided` 是空的,一分钱没动;点了通过之后才执行,并且最终回复里引用被渲染成了 `[1]` 和链接。
- 退款申请已经建了、草稿却两次没过质检转人工时,申请被作废,不会留在审批列表里。
- 政策问题不进 act,工具只调了 `get_customer`。
- `needs_human` 直接转人工。
- 质检两次不过就转人工,revisions 是 2。
- 草稿里有"已为您退款,马上到账",规则检查直接拦下,而且根本没走到模型质检。

最后一个参数化测试是给质检正则本身的。我第一版正则把"已为您办理退款申请"也当成了违规承诺,这是一句完全合规的话,误判会让好草稿被打回、白花一次重写的钱。判断规则也是代码,也会写错,也要测。

这些测试我在本机都跑过,全部通过。`InMemorySaver` 是内存版的 checkpointer,审批需要它:没有 checkpointer,图停下后状态就丢了,没法恢复。

## 端到端跑一遍

```json
{"customer_email": "zhangwei@example.com", "subject": "怎么开专票", "body": "我们公司要增值税专用发票,需要准备什么?"}
{"customer_email": "zhangwei@example.com", "subject": "导入失败", "body": "导入凭证一直提示 E2001,文件是从老系统导出的 xls。"}
{"customer_email": "lina@example.com", "subject": "想退款", "body": "上周买的专业版年付,发现用不上,请帮我退款。"}
{"customer_email": "lina@example.com", "subject": "能退吗", "body": "如果我现在不想用了,年付能退多少?先问问。"}
{"customer_email": "wangfang@example.com", "subject": "申请退款", "body": "5 月份买的专业版年付,现在用不上了,请退款。"}
{"customer_email": "liuyang@example.com", "subject": "扣了两次", "body": "9 月 12 号被扣了两次 39 元,请把多的退给我。"}
{"customer_email": "chenjing@example.com", "subject": "月费退款", "body": "这个月的 39 元请退给我,我不用了。"}
{"customer_email": "yanglei@example.com", "subject": "账套变只读了", "body": "为什么突然不能新增凭证了?"}
{"customer_email": "nobody@example.com", "subject": "退款", "body": "请把我的年费退了。"}
{"customer_email": "chenjing@example.com", "subject": "投诉", "body": "你们乱扣费,再不处理我就去 12315 投诉。"}
```

10 张工单覆盖了主要路径:政策问答、报错码、退款要求、退款咨询、按比例退款、重复扣款、月付退款被拒、扣款失败、找不到客户、投诉转人工。

```python
# supportpilot/scripts/run_tickets.py
"""端到端跑 data/seed/demo_tickets.jsonl 里的 10 张工单,终端里看每一步。遇到退款审批会停下来问你。
uv run python scripts/run_tickets.py            # 全部
uv run python scripts/run_tickets.py 3          # 只跑第 3 张
"""

import json
import sys
from pathlib import Path

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from supportpilot.agent.deps import Deps
from supportpilot.agent.graph import build_graph
from supportpilot.db import connect
from supportpilot.tools import business as biz

DEMO = Path(__file__).resolve().parent.parent / "data" / "seed" / "demo_tickets.jsonl"


def show(graph, payload, cfg) -> None:
    for mode, chunk in graph.stream(payload, cfg, stream_mode=["updates", "custom"]):
        if mode == "custom":
            if chunk["type"] == "token":
                print(chunk["text"], end="", flush=True)
            elif chunk["type"] == "tool":
                print(f"\n  🔧 {chunk['name']}({chunk['args']}){' ✗' if chunk['error'] else ''}")
            elif chunk["type"] == "step":
                info = {k: v for k, v in chunk.items() if k not in ("type", "node")}
                print(f"\n  ▸ {chunk['node']} {info}")
        elif "__interrupt__" in chunk:
            req = chunk["__interrupt__"][0].value["request"]
            print(f"\n  ⏸ 退款审批:{req['id']} ¥{req['amount_cny']:.2f} 规则={req['rule']}")


def main() -> None:
    tickets = [json.loads(x) for x in DEMO.read_text(encoding="utf-8").splitlines() if x.strip()]
    if len(sys.argv) > 1:
        tickets = [tickets[int(sys.argv[1]) - 1]]
    conn = connect()
    graph = build_graph(Deps.from_conn(conn), checkpointer=InMemorySaver())
    for t in tickets:
        tid = biz.create_ticket(conn, t["customer_email"], t["subject"], t["body"])
        cfg = {"configurable": {"thread_id": tid}}
        print(f"\n===== {tid} · {t['customer_email']} · {t['subject']} =====")
        show(graph, {"ticket": {"id": tid, **t}}, cfg)
        while graph.get_state(cfg).next:  # 停在审批节点
            ok = input("\n  通过这笔退款吗?[y/N] ").strip().lower() == "y"
            show(graph, Command(resume={"approved": ok, "approver": "cli", "note": "" if ok else "演示驳回"}), cfg)
        final = graph.get_state(cfg).values
        print(f"\n----- 最终回复({final.get('outcome')},¥{final.get('cost_cny', 0):.4f})-----\n{final.get('reply')}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `"""端到端跑 data/seed/demo_tickets.jsonl` 实测把 10 张全跑了一遍,两次审批依次输入 y、n,10 张合计约 0.17 元(开着思考时约 0.26 元)。
- `DEMO = Path(__file__).resolve().parent.parent / "data" / "seed" / "demo_tickets.jsonl"` 脚本在 scripts/ 下,往上两级是项目根。
- `def show(graph, payload, cfg) -> None:` 跑图并把过程打印出来,第一次启动和审批后恢复都用它。
- `for mode, chunk in graph.stream(payload, cfg, stream_mode=["updates", "custom"]):` stream_mode 传列表时,每次产出一个 (模式, 数据) 二元组。custom 是节点里 `_emit` 推的事件,updates 是节点返回的状态更新。
- `print(chunk["text"], end="", flush=True)` token 不换行连着打,`flush=True` 让字立刻出现在终端,不等缓冲区满。
- `print(f"\n  🔧 {chunk['name']}({chunk['args']})` 实测打印 `🔧 check_refund_eligibility({"invoice_id": "INV-202609-0002"})`。
- `info = {k: v for k, v in chunk.items() if k not in ("type", "node")}` 字典推导式,去掉两个固定键,剩下的原样打印。实测 `▸ retrieve {'docs': ['KB-invoice-001', 'KB-invoice-002', ...]}`。
- `elif "__interrupt__" in chunk:` updates 模式下,图停下时会产出一个带 `__interrupt__` 键的更新。
- `print(f"\n  ⏸ 退款审批:{req['id']}` 实测 `⏸ 退款审批:RF-T000153-INV-202609-0002 ¥950.00 规则=annual_first_14_days`。金额同样用 `:.2f`。
- `tickets = [json.loads(x) for x in DEMO.read_text(encoding="utf-8").splitlines() if x.strip()]` 一行一个 JSON,`if x.strip()` 跳过空行。
- `tickets = [tickets[int(sys.argv[1]) - 1]]` 命令行写 3 就取下标 2,也就是第 3 张。
- `graph = build_graph(Deps.from_conn(conn), checkpointer=InMemorySaver())` 真模型、真数据库、内存存档。
- `tid = biz.create_ticket(conn, t["customer_email"], t["subject"], t["body"])` 先在库里建工单拿到编号。实测 seed 造了 152 张,第一张演示工单就是 T000153。
- `while graph.get_state(cfg).next:` `next` 是接下来要跑的节点。图跑完是空元组,停在审批前是 `('approval',)`。
- `ok = input("\n  通过这笔退款吗?[y/N] ").strip().lower() == "y"` 只有输入 y 才通过,直接回车算驳回。`[y/N]` 里大写的 N 表示默认值。
- `final = graph.get_state(cfg).values` 取最终状态。
- `print(f"\n----- 最终回复({final.get('outcome')}` 实测 10 张的结果和花费:<br>1 专票 resolved ¥0.0052;2 E2001 resolved ¥0.0052;<br>3 李娜退款(y) resolved ¥0.0241;<br>4 先问问 escalated ¥0.0200,没建申请,但被 PROMISE_RE 误伤;<br>5 王芳按比例退 498.75 元(n) resolved ¥0.0252;<br>6 重复扣款 39 元 escalated ¥0.0357,申请建了,但草稿两次没过质检;<br>7 月付 resolved ¥0.0199,解释不退;<br>8 账套只读 resolved ¥0.0210;<br>9 找不到客户 resolved ¥0.0101,请客户提供注册邮箱;<br>10 投诉 escalated ¥0.0017。

</div>



```bash
uv run python scripts/run_tickets.py 3      # 只跑第 3 张:李娜要退款
```

输出大致长这样(工单号、检索到的文章、模型的措辞每次会有差异):

```text
===== T000153 · lina@example.com · 想退款 =====

  ▸ load_customer {'found': True}

  ▸ classify {'category': 'refund'}

  ▸ retrieve {'docs': ['KB-refund-002', 'KB-refund-001', ...]}

  🔧 list_invoices({"customer_id": "C0002"})

  🔧 check_refund_eligibility({"invoice_id": "INV-202609-0002"})

  🔧 create_refund_request({"invoice_id": "INV-202609-0002", "reason": "..."})
[notify:dry-run]
【退款待审批】RF-T000153-INV-202609-0002
...
您好,您的专业版年付订阅是 9 月 24 日首次购买的,目前在 14 天内,符合全额退款条件 [KB-refund-002]。我们已为您提交退款申请……
  ▸ check {'passed': True, 'problems': []}

  ⏸ 退款审批:RF-T000153-INV-202609-0002 ¥950.00 规则=annual_first_14_days

  通过这笔退款吗?[y/N] y

----- 最终回复(resolved,¥0.03 左右)-----
您好,……符合全额退款条件 [1]。……

参考文章:
[1] 年付 14 天无理由退款 https://help.cloudledger.example/help/refund/002

补充:您的退款申请已审核通过,950.00 元将原路退回,到账时间以支付渠道为准。
```

跑全部 10 张,每张都对照预期看一遍:第 4 张(只是问问)不应该建申请,第 7 张(月付)应该解释不退并建议关闭自动续费,第 9 张(找不到客户)应该请客户提供注册邮箱,第 10 张(投诉)应该直接转人工。

你会发现有些工单处理得不完美。比如"只是问问"那张,模型可能还是建了申请;或者某个回复漏了关键数字。别急着改,把问题记下来。Day 50 会把这些变成评测用例,Day 51 系统地修。今天的目标是"整条流程通了",不是"每张都完美"。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/6t7YJcEFUIY" title="LangGraph interrupt: Making it easier to build human-in-the-loop agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · LangGraph interrupt: Making it easier to build human-in-the-loop agents · 官方讲 interrupt 和 Command(resume) 的设计,看为什么"节点重跑"是这么设计的。</figcaption>
</figure>

## 动手练习

**步骤 1:放文件。** `config.py` 的 Settings 加上 `llm_extra_body`,`.env` 里填好 `LLM_EXTRA_BODY`;`src/supportpilot/llm.py`,`agent/` 下 `state.py`、`prompts.py`、`deps.py`、`nodes.py`、`graph.py`,`scripts/run_tickets.py`,`data/seed/demo_tickets.jsonl`,`tests/` 下 `fakes.py`、`test_graph_smoke.py`、`test_llm.py`。

**步骤 2:跑单测。** `make test`,确认新加的测试全过。这一步不需要 API key。

**步骤 3:画出你的图。** LangGraph 能把编译好的图画成 Mermaid:

```python
from supportpilot.agent.graph import build_graph
from fakes import FakeLLM, FakeTools, make_deps   # 在 tests 目录下运行
g = build_graph(make_deps(FakeLLM({}, [], ""), FakeTools()))
print(g.get_graph().draw_mermaid())
```

<div class="line-notes">

- `from fakes import FakeLLM, FakeTools, make_deps` 用假零件建图,画图不需要数据库和 API key。
- `g = build_graph(make_deps(FakeLLM({}, [], ""), FakeTools()))` 画图只看结构,FakeLLM 的参数随便给空的就行。
- `print(g.get_graph().draw_mermaid())` 实测输出开头是 `graph TD;`,接着列出 `__start__`、九个节点和 `__end__`,普通边是 `-->`(如 `act --> draft;`),条件边是虚线 `-.->`(如 `check -.-> approval;`)。

</div>



把输出贴到 mermaid.live 里看,和上面的图对照。

**步骤 4:端到端。** 确认 `.env` 里填了 `LLM_API_KEY` 和 `EMB_API_KEY`,数据库起着、数据导好了,然后 `uv run python scripts/run_tickets.py`,10 张全跑一遍。审批时第 3 张选 y,第 5 张选 n,看两种补充说明。

**步骤 5:记一份问题清单。** 新建 `docs/day47-observations.md`,每张工单一行:工单、期望、实际、哪里不对。至少记下 3 个问题,这是 Day 51 错误分析的原材料。

**验收标准:** `make test` 全绿(不需要 API);10 张演示工单都能跑完不崩;退款工单会停下等审批,批完能看到补充说明;投诉工单直接转人工;每张工单打印出了成本,大约在几分钱以内。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 成本账本 | LLMClient 上累计 token 用量的计数器,用来算每一步花了多少钱 |
| JSON mode | 让模型保证输出合法 JSON 的接口选项,不保证字段正确 |
| reducer | LangGraph 状态字段的合并方式,默认覆盖,`operator.add` 表示追加/累加 |
| 依赖注入 | 把外部依赖从参数传进来,而不是在函数里自己创建,方便替换成假的 |
| interrupt | LangGraph 中让图暂停并把数据交给外部的函数 |
| Command(resume) | 恢复暂停的图,并把值作为 interrupt() 的返回值 |
| checkpointer | 保存图状态的组件,暂停和恢复都依赖它 |
| evaluator-optimizer | 起草和质检分开,质检不过就带着意见重写 |
| for ... else | Python 语法,循环没有被 break 时执行 else 块 |

## 常见误区

**整个工单丢给一个大 agent。** 能跑,但分诊错了、检索漏了、承诺乱说,你分不清是哪一步的问题,也没法单独优化。拆成节点,每个节点有明确的输入输出。

**interrupt 之前写副作用。** 恢复时会再执行一次。写库、发通知、调外部接口,都放在 interrupt 之后或者别的节点。

**质检全交给模型。** 能用规则查的(编号是否存在、是否有违禁承诺)先用规则,确定、免费、不会漏。模型质检只做规则做不了的判断。

**单测里调真的大模型。** 慢、花钱、结果不确定,测试会时好时坏。工作流逻辑用假 LLM 测,模型能力用评测测,两件事分开。

**流式 usage 每块都入账。** 成本会被夸大很多倍,而且很难察觉,直到月底看账单。

**一看到不完美的回复就改提示词。** 今天改一句、明天改一句,改了什么、变好还是变坏都说不清。先记下来,等有了评测集再系统地改。

## 学习资料

### 文档与文章

- [LangGraph 概览](https://docs.langchain.com/oss/python/langgraph/overview) 和 [Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api):State、reducer、条件边的官方说明,1 小时。
- [LangGraph Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts):重点读"节点恢复时从头重跑"和"interrupt 前的副作用要幂等"两段,20 分钟。
- [LangGraph Streaming](https://docs.langchain.com/oss/python/langgraph/streaming):`stream_mode` 的几种模式,特别是 `custom` 模式和 `get_stream_writer`,20 分钟。
- [DeepSeek JSON Output](https://api-docs.deepseek.com/zh-cn/guides/json_mode) 和 [Function Calling](https://api-docs.deepseek.com/zh-cn/guides/function_calling):你用的厂商的结构化输出和工具调用说明,换厂商就看对应文档,20 分钟。
- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):重读 evaluator-optimizer 那一节,10 分钟。

### B 站视频

- 上面嵌的敲代码的码农《挑战 19 分钟搞定,LangGraph 快速入门与原理剖析》。
- 尚硅谷《LangGraph 教程》(BV1z3NY66EY1,132 集合集):系统性最强的中文 LangGraph 课,今天用到的条件边、checkpointer、人工介入都有专门的集,按目录挑着看,别从头刷。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1z3NY66EY1&autoplay=0&high_quality=1" title="尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>尚硅谷 · LangGraph 教程(合集)· 播放器里可以切分集,找"条件边""持久化""人机交互"相关的几集看。</figcaption>
</figure>

### 其他经典视频

- 上面嵌的 LangChain《LangGraph interrupt》。
- LangChain《Build a Customer Support Bot | LangGraph》(YouTube,b3XsvoFWp4c):航空客服机器人,对比它和 SupportPilot 的设计差异:它的敏感操作是怎么确认的、节点是怎么分的。
- [LangChain Academy · Introduction to LangGraph](https://academy.langchain.com/courses/intro-to-langgraph):官方免费课,Module 3(人机交互)和 Module 4(子图、并行)和今天最相关。

### 书籍

- Chip Huyen《AI Engineering》第 6 章 Agents 部分的"Planning"和"Agent Failure Modes and Evaluation":规划、工具选择错误、目标偏离等失败模式,对照我们为什么用固定流程,约 1 小时。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》第 7 章 Advanced Text Generation Techniques and Tools:后半部分讲 Agent 和 ReAct,图很清楚,40 分钟。

### 开源项目与代码

- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):`libs/langgraph/langgraph/types.py` 里看 `interrupt` 和 `Command` 的实现,理解为什么恢复时会重跑节点。
- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench):看它的 agent 是怎么调工具的,和我们的 act 节点对比。

## 自测

**1. `tool_log` 和 `cost_cny` 为什么要用 `Annotated[..., operator.add]`?去掉会怎样?**

<details><summary>答案</summary>

这两个字段需要累加而不是覆盖。`tool_log` 记录整张工单所有的工具调用,`cost_cny` 是各节点花费之和。去掉的话,每个节点返回的值会覆盖之前的,最后只剩最后一个节点的花费,工具记录也只剩最后一批。

</details>

**2. 质检第一次不通过、第二次也不通过,工作流会怎么走?revisions 分别是多少?**

<details><summary>答案</summary>

第一次不通过,revisions 从 0 变成 1,`1 <= max_revisions(1)`,回到 draft 重写;第二次不通过,revisions 变成 2,`2 > 1`,走 handoff 转人工。

</details>

**3. 审批节点里,如果把"写一条日志到数据库"放在 `interrupt()` 之前,会发生什么?**

<details><summary>答案</summary>

会写两次。图第一次执行到审批节点时写一次,然后在 interrupt 处暂停;人做出决定后图恢复,审批节点从头重跑,又写一次。interrupt 之前的代码必须没有副作用或者幂等。

</details>

**4. 为什么 check 节点先跑规则,规则不过就不调模型了?**

<details><summary>答案</summary>

规则检查确定、免费、不会漏(编号是否存在、是否有违禁承诺);规则发现问题时草稿反正要重写,再花钱让模型检查没有意义。规则过了,才需要模型做规则做不了的判断(事实是否都有依据)。

</details>

**5. 「面试题」你的工作流怎么测试?大模型的输出不确定,怎么写单测?**

<details><summary>答案</summary>

分两层。工作流逻辑(路由、审批暂停恢复、重写次数、转人工条件)用假 LLM 测:通过依赖注入把假的大模型、检索、工具传进节点,按剧本返回固定结果,测试确定、免费、几秒钟跑完。模型能力(分类准不准、回复好不好)不在单测里测,用评测集跑真实模型,看统计指标。两者分开,单测保证"流程对",评测衡量"效果好"。

</details>

**6. 「面试题」LangGraph 的 interrupt 是怎么实现暂停和恢复的?需要什么前提?**

<details><summary>答案</summary>

`interrupt()` 内部抛一个特殊异常让图停下,当前状态由 checkpointer 按 thread_id 保存;外部用同一个 thread_id 调 `invoke(Command(resume=值))` 时,LangGraph 读回状态,从被中断的节点开头重新执行,这次 `interrupt()` 直接返回 resume 的值。前提是编译时配了 checkpointer,恢复时用同一个 thread_id;因为节点会重跑,interrupt 之前的代码要没有副作用,也不能用 try/except 把 interrupt 包住吞掉异常。

</details>

## 明天预告

Day 48 · 多轮与记忆:会话状态、客户画像、上下文压缩。今天的工作流只能处理"一问一答",客户追问一句它就忘了前面说过什么。明天加上三种记忆:同一张工单内的多轮对话(状态存进 Postgres,进程重启也不丢)、跨工单的客户画像(吴刚第四次来问银行同步,Agent 应该知道他之前遇到过三次)、对话太长时的自动压缩。
