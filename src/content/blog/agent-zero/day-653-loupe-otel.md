---
title: 'Day 653 · Loupe(二):OTel GenAI 语义约定'
description: '把 2026 年 10 月的 OpenTelemetry GenAI 语义约定读一遍:十八种操作名怎么归到 Loupe 的五种 kind,四个要求级别里哪些属性默认根本不记,消息为什么是 parts 结构。用 DeepSeek 真跑一次官方自动埋点,看它实际记了什么、和约定差在哪,写出映射表和 parts 转 OpenAI 消息的转换函数。'
pubDate: 2026-10-23
regime: none
tags: ['agent-loupe', 'opentelemetry', 'tracing', 'agent-zero']
series: 'agent-zero'
day: 653
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 652](/blog/agent-zero/day-652-loupe-model/) 定下了 Loupe 的两个模型:`Run` 是一次运行,`Step` 是其中一步;`kind` 只许 `llm/tool/agent/retrieval/other` 五种,时间必须带时区并统一成 UTC,`normalize` 负责排序、编号、补汇总。还约定了 llm 步的 `input` 是 `{"messages": [...], "tools": [...]}`、`output` 是一条 assistant 消息,都用 OpenAI 格式。把 Day 649 的记录装进来以后,每一步的 `input` 和 `output` 都是空的,因为当时根本没记。

今天看别人是怎么记的。OpenTelemetry 是可观测领域的通用格式,各种框架和 SDK 都能导出它,Loupe 能读它,就能读别人的 trace,而不只是自己的。在写导入器(Day 654)之前,先把它的规矩读懂,写出一张「它的哪个属性对应我们的哪个字段」的映射表。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说出 GenAI 约定里一次模型调用、一次工具调用各记哪些属性,四个要求级别(Required、Conditionally Required、Recommended、Opt-In)分别是什么意思,以及为什么别人给你的 trace 很可能没有消息原文。
2. 把约定里的十八种操作名归到 Loupe 的五种 `kind`,写出 `KIND_BY_OPERATION`。
3. 读懂 `parts` 结构的消息,写出 `parts_to_openai`,把它转成全课一直用的 OpenAI 消息格式。
4. 用 DeepSeek 真跑一次官方的 OpenAI 自动埋点,对照约定找出至少三处「实际记的和约定写的不一样」。

预计用时 2.5 小时:读约定一小时,跑埋点和写转换函数一小时,映射表、测试和练习半小时。正文调两次小 Agent,每次约 ¥0.0024,练习再调一次,全天约 ¥0.007。

前置:[Day 652](/blog/agent-zero/day-652-loupe-model/)(`models.py`)、[Day 366](/blog/agent-zero/day-366-otel-spans/)(OpenTelemetry SDK、手打 GenAI span、练习 3 的自动埋点)、[Day 367](/blog/agent-zero/day-367-tracing-views/)(内容记录开关和隐私)、[Day 159](/blog/agent-zero/day-159-tool-roundtrip/)(tool_calls 和 tool 消息)。

学法提示:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把十八种操作名的归类和 `parts_to_openai` 默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 约定现在在哪、是什么状态

先复习两个词。**span** 是 trace 里的一段操作,有名字、开始结束时间、父 span 和一组属性(key-value),[Day 364](/blog/agent-zero/day-364-tracing-concepts/) 讲过;Loupe 里一个 span 对应一个 Step。**语义约定**(semantic conventions)是 OpenTelemetry 规定「某一类操作的 span 叫什么名字、记哪些属性、属性叫什么」的规范。有了它,不同的库记出来的模型调用长得一样,看的工具不用为每个库单独适配。

[Day 366](/blog/agent-zero/day-366-otel-spans/) 照着 GenAI 约定手打过三种 span(调用 Agent、调模型、调工具),当时查到它在单独的仓库 [semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai) 维护,状态是 Development。我今天(2026 年 10 月 22 日)又去看了一遍 main 分支,几处变化:

- 状态仍是 **Development**,也就是还在变,属性名以后可能改。这是我们要「导入时转成自己的模型」的根本原因:规范改了,只改一个导入器。
- 模型调用(规范里叫 inference)的约定挪到了单独的文件 `client-inference.md`,原来的 `gen-ai-spans.md` 只留一句指过去。
- 操作名列表里有一批 Day 366 没用到的:记忆相关的七个、`plan`、`fetch_response`。
- 消息内容的格式有 JSON Schema 文件,在仓库的 `model/gen-ai/` 下面,规范要求「必须遵守」。

下面的内容都以这个版本为准。你读的时候如果发现又变了,以规范为准,今天的代码哪里对不上,正好练习一次「只改导入器」。

## 第一步:十八种操作名归成五种

每个 GenAI span 都有一个 `gen_ai.operation.name` 属性,说明这是什么操作。它是 Loupe 判断 `kind` 的唯一依据。规范里列出的知名取值有十八个,我按它们实际在做什么归类:

| 操作名 | 是什么 | Loupe kind |
| --- | --- | --- |
| `chat` | 对话补全,OpenAI Chat API 那种 | llm |
| `text_completion` | 老式文本补全 | llm |
| `generate_content` | 多模态生成,Gemini 那种 | llm |
| `execute_tool` | 执行一个工具 | tool |
| `invoke_agent` | 调用一个 Agent | agent |
| `create_agent` | 创建一个 Agent | agent |
| `invoke_workflow` | 调用一个工作流 | agent |
| `plan` | Agent 的规划或拆任务阶段 | agent |
| `embeddings` | 算向量 | retrieval |
| `retrieval` | 检索,比如查向量库 | retrieval |
| `search_memory` | 从记忆库里查 | retrieval |
| `create_memory`、`update_memory`、`upsert_memory`、`delete_memory` | 写记忆、改记忆、删记忆 | other |
| `create_memory_store`、`delete_memory_store` | 建、删记忆库 | other |
| `fetch_response` | 按编号取回一个以前生成好的回复,不做推理 | other |

几个归类我想说一句为什么。

`plan` 归成 agent 而不是 llm:规划阶段里面通常会调一次或几次模型,它们会以子 span 的形式出现,`plan` 本身是个包着它们的容器,和 `invoke_agent` 一样。

`embeddings` 归成 retrieval:严格说它也是调模型,但它不收 messages、不出 assistant 消息,如果归成 llm,前端渲染消息的组件拿到它会无事可做。它几乎总是检索流程的一部分,和检索放一起看更顺。

`fetch_response` 归成 other:名字像模型调用,规范里写明了它「不做推理」,只是把以前的结果取回来。如果归成 llm,Day 666 统计「这次运行调了几次模型」就会多算。

记忆那几个写操作归成 other:它们不是模型、不是工具调用、也不是在查东西。哪天 Loupe 要专门做记忆的可视化,再给它们细分。

规范里还有一句:如果知名取值都不合适,可以用自定义的值。所以导入器碰到不认识的操作名,一律当 other,不能报错。

写成代码,放在 `server/loupe/importers/genai.py` 的开头(完整文件在第四步):

```python
KIND_BY_OPERATION: dict[str, StepKind] = {
    "chat": "llm", "text_completion": "llm", "generate_content": "llm",
    "execute_tool": "tool",
    "invoke_agent": "agent", "create_agent": "agent", "invoke_workflow": "agent", "plan": "agent",
    "embeddings": "retrieval", "retrieval": "retrieval", "search_memory": "retrieval",
}


def kind_of(operation: str | None) -> StepKind:
    return KIND_BY_OPERATION.get(operation or "", "other")
```

<div class="line-notes">

- `KIND_BY_OPERATION: dict[str, StepKind] = {` 值的类型标成 `StepKind`(Day 652 定义的五选一),写成 `"LLM"` 这种拼错的值编辑器会直接画红线。
- `"invoke_agent": "agent", "create_agent": "agent", "invoke_workflow": "agent", "plan": "agent",` 四个容器类的操作。
- `"embeddings": "retrieval", "retrieval": "retrieval", "search_memory": "retrieval",` 三个「去找东西」的操作。
- `def kind_of(operation: str | None) -> StepKind:` span 可能根本没有 `gen_ai.operation.name`(比如一个普通的 HTTP span 混在里面),所以参数允许 `None`。
- `return KIND_BY_OPERATION.get(operation or "", "other")` 字典里没有的一律 other。七个记忆写操作和 `fetch_response` 没写进字典,也走这里。

</div>

## 第二步:四个要求级别,和默认不记的那些

规范给每个属性标了一个**要求级别**(requirement level),决定埋点库「必须记、应该记、还是别人要求了才记」。这直接决定了你从别人那里拿到的 trace 里有什么。拿模型调用 span 来看(我用脚本把 `client-inference.md` 里的属性表抽了出来,下面是和 Loupe 有关的部分):

| 级别 | 意思 | 模型调用 span 里的例子 |
| --- | --- | --- |
| Required | 必须记 | `gen_ai.operation.name`、`gen_ai.provider.name` |
| Conditionally Required | 满足条件时必须记 | `gen_ai.request.model`(拿得到就记)、`error.type`(出错时)、`gen_ai.conversation.id` |
| Recommended | 应该记,可以被配置关掉 | `gen_ai.response.model`、`gen_ai.usage.input_tokens`、`gen_ai.usage.output_tokens`、`gen_ai.usage.cache_read.input_tokens`、`gen_ai.response.finish_reasons`、`gen_ai.request.temperature` |
| Opt-In | 默认不记,使用者主动打开才记 | `gen_ai.input.messages`、`gen_ai.output.messages`、`gen_ai.system_instructions`、`gen_ai.tool.definitions` |

工具调用 span(`execute_tool`)类似:`gen_ai.tool.name` 是 Required,`gen_ai.tool.call.id` 是 Conditionally Required,参数 `gen_ai.tool.call.arguments` 和结果 `gen_ai.tool.call.result` 是 Opt-In。检索 span 的查询文本和返回文档也是 Opt-In。

**所有「内容」都是 Opt-In。** 消息、系统提示词、工具定义、工具参数和结果,里面可能有用户的姓名、手机号、订单,规范默认不记,要用的人自己打开。[Day 367](/blog/agent-zero/day-367-tracing-views/) 实测过这一点,也讲了为什么生产环境默认不记是对的。对 Loupe 的意思是:别人给你的 OTLP trace,很可能只有时间、token 数和模型名,点开模型调用那一步什么都看不到。导入器必须能处理这种情况,界面要显示「这一步没有记录内容」,而不是报错或者显示一个空的对话。

还有一句规范原话值得记住:`gen_ai.usage.input_tokens` 应该包含所有类型的输入 token,**包括命中缓存的**。命中缓存的那部分另记在 `gen_ai.usage.cache_read.input_tokens` 里,是总数的子集。Day 660 按价格表算钱时,命中缓存的部分单价便宜得多,要先减出来,别重复算。

### 亲眼看一次:不打开时记了什么

光读规范不够,拿真实数据看。用的还是 Day 649 那个查三城气温的 `weather_agent.py`,加上 Day 366 练习 3 用过的官方 OpenAI 自动埋点库。脚本放在练习仓库里,因为它要调模型、要读 `.env`:

```bash
cd /Users/你/agent-zero-lab
uv add opentelemetry-sdk opentelemetry-instrumentation-openai-v2 "opentelemetry-util-genai<1.2"
```

2026 年 10 月装到的是 `opentelemetry-sdk 1.45.1`、`opentelemetry-instrumentation-openai-v2 2.4b0`、`opentelemetry-util-genai 1.1b0`。`<1.2` 的限制是 Day 366 踩过的坑:util-genai 1.2b0 改了内部模块,老的 openai-v2 一导入就报错。我今天又查了一次 PyPI,openai-v2 还是 5 月的 2.4b0,这个限制还得留着。

```python
# agent-zero-lab/part11/otel_capture.py
import json
from pathlib import Path

from opentelemetry import trace
from opentelemetry.instrumentation.openai_v2 import OpenAIInstrumentor
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

memory = InMemorySpanExporter()
provider = TracerProvider()
provider.add_span_processor(SimpleSpanProcessor(memory))
trace.set_tracer_provider(provider)
OpenAIInstrumentor().instrument()

from common.llm import LLMClient  # noqa: E402
from part11.weather_agent import TASK, run  # noqa: E402

llm = LLMClient()
print(run(TASK, llm).splitlines()[-1])
spans = [{"name": s.name, "attributes": dict(s.attributes or {})} for s in memory.get_finished_spans()]
for s in spans:
    a = s["attributes"]
    print(s["name"], "| 有消息原文" if "gen_ai.input.messages" in a else "| 没有消息原文")
out = Path("part11/runs/genai_chat_spans.json")
out.write_text(json.dumps(spans, ensure_ascii=False, indent=2, default=list), encoding="utf-8")
print(f"{len(spans)} 个 span,存到 {out};{llm.ledger}")
```

<div class="line-notes">

- `memory = InMemorySpanExporter()` 把 span 存在内存里的出口,跑完再取出来看,不用起任何服务。Day 366 练习 3 用过。
- `provider.add_span_processor(SimpleSpanProcessor(memory))` 每个 span 一结束就交给出口。
- `OpenAIInstrumentor().instrument()` 给 openai SDK 打补丁:之后每次 `client.chat.completions.create` 都会自动产生一个 span。必须在设好 provider 之后调。
- `from common.llm import LLMClient  # noqa: E402` 打完补丁再 import。`LLMClient`([Day 135](/blog/agent-zero/day-135-llm-client-1/))里面用的就是 openai SDK,所以我们自己的代码一行不用改。`# noqa: E402` 告诉 Ruff「import 不在文件开头是故意的」。
- `from part11.weather_agent import TASK, run  # noqa: E402` Day 649 的 Agent 循环原样拿来用。
- `print(run(TASK, llm).splitlines()[-1])` 跑一次,只打印回答的最后一行(平均气温那句)。
- `spans = [{"name": s.name, "attributes": dict(s.attributes or {})} for s in memory.get_finished_spans()]` 取出所有结束的 span,只留名字和属性。`s.attributes` 是一个只读的映射,`dict(...)` 复制成普通字典才能存 JSON。
- `print(s["name"], "| 有消息原文" if "gen_ai.input.messages" in a else "| 没有消息原文")` 看每个 span 有没有记消息。
- `out.write_text(json.dumps(spans, ensure_ascii=False, indent=2, default=list), encoding="utf-8")` `default=list`:属性里的 `finish_reasons` 是元组,json 不认识,让它遇到不认识的类型就转成列表。

</div>

```bash
uv run python -m part11.otel_capture
```

```text
调用 get_weather(Beijing)
调用 get_weather(Shanghai)
调用 get_weather(Guangzhou)
平均气温 = (9.1 + 17.3 + 24.4) / 3 = 50.8 / 3 ≈ **16.9 °C**
chat deepseek-flash | 没有消息原文
chat deepseek-flash | 没有消息原文
2 个 span,存到 part11/runs/genai_chat_spans.json;2 次调用 | 输入 792 / 输出 181 tokens | 约 ¥0.0023
```

两次模型调用,两个 span,都没有消息原文。这就是默认状态,也是你从大部分生产系统拿到的 trace 的样子。三次 `get_weather` 没有 span,因为自动埋点只管 openai SDK,工具是我们自己的函数,它看不见。明天会手动给工具补上 span。

## 第三步:打开内容记录,看真实的 parts

加上 Day 367 用过的两个环境变量再跑一次:

```bash
OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental \
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=SPAN_ONLY \
uv run python -m part11.otel_capture
```

<div class="line-notes">

- `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental \` 用最新版的 GenAI 约定。不加的话,有的库会按老约定把消息记成事件(event)而不是 span 属性。
- `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=SPAN_ONLY \` 把消息原文记到 span 属性上。Day 367 踩过:写成 `true` 是老写法,新版会打一行警告然后照样不记。

</div>

```text
平均气温 = (9.1 + 17.3 + 24.4) ÷ 3 = 50.8 ÷ 3 ≈ **16.9 °C**
chat deepseek-flash | 有消息原文
chat deepseek-flash | 有消息原文
2 个 span,存到 part11/runs/genai_chat_spans.json;2 次调用 | 输入 799 / 输出 196 tokens | 约 ¥0.0024
```

打开 `part11/runs/genai_chat_spans.json`,第二个 span(第二次调模型,已经拿到了三个城市的气温)的属性是这样的。消息那两个属性原本是一长串带 `你` 转义的字符串,为了能读,我把它们解析出来缩进排好放在后面:

```text
gen_ai.operation.name = chat
gen_ai.provider.name = openai
gen_ai.request.model = deepseek-flash
gen_ai.response.model = deepseek-flash
gen_ai.response.id = 3f5928ea-7a29-4e72-8066-39b008328983
gen_ai.response.finish_reasons = ['stop']
gen_ai.usage.input_tokens = 489
gen_ai.usage.output_tokens = 90
openai.response.system_fingerprint = e72d3c7f663d3e1383b00b3884cb4501
gen_ai.input.messages = "[{\"role\":\"system\",\"parts\":[{\"content\":\"\\u4f60\\u662f…"
gen_ai.output.messages = "[{\"role\":\"assistant\",\"parts\":[{\"content\":\"\\u73b0…"
```

`gen_ai.input.messages` 解析出来:

```json
[
  {"role": "system", "parts": [{"content": "你是天气助手。需要气温时调用 get_weather,不要自己编。", "type": "text"}]},
  {"role": "user", "parts": [{"content": "北京、上海、广州现在各多少度?算一下三个城市的平均气温。", "type": "text"}]},
  {"role": "assistant", "parts": [
    {"arguments": {"city": "Beijing"}, "name": "get_weather", "id": "call_00_lFl7AJOvUciP3astiFF70101", "type": "tool_call"},
    {"arguments": {"city": "Shanghai"}, "name": "get_weather", "id": "call_01_0USwnoFws31aXuc44x669063", "type": "tool_call"},
    {"arguments": {"city": "Guangzhou"}, "name": "get_weather", "id": "call_02_JY7otXHwn5IhunBjsNmc0017", "type": "tool_call"},
    {"content": "我来查一下这三个城市的气温。", "type": "text"}
  ]},
  {"role": "tool", "parts": [{"response": "{\"city\": \"Beijing\", \"temp_c\": 9.1}", "id": "call_00_lFl7AJOvUciP3astiFF70101", "type": "tool_call_response"}]},
  {"role": "tool", "parts": [{"response": "{\"city\": \"Shanghai\", \"temp_c\": 17.3}", "id": "call_01_0USwnoFws31aXuc44x669063", "type": "tool_call_response"}]},
  {"role": "tool", "parts": [{"response": "{\"city\": \"Guangzhou\", \"temp_c\": 24.4}", "id": "call_02_JY7otXHwn5IhunBjsNmc0017", "type": "tool_call_response"}]}
]
```

这就是 GenAI 约定的消息格式。和我们熟悉的 OpenAI 格式放在一起比一比:

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="同一条 assistant 消息在 OpenAI 格式和 GenAI parts 格式里的样子对比">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
<text x="20" y="26" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">OpenAI 格式(Loupe 内部用)</text>
<rect x="20" y="36" width="280" height="200" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="60" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">role: "assistant"</text>
<text x="32" y="82" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">content: "我来查一下…"</text>
<text x="32" y="104" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">tool_calls: [</text>
<text x="44" y="126" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">{id, type: "function",</text>
<text x="44" y="144" font-family="var(--font-mono)" font-size="11" fill="var(--ink)"> function: {name,</text>
<text x="44" y="162" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">  arguments: "{\"city\":…}"}}</text>
<text x="32" y="184" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">]</text>
<text x="32" y="210" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">工具结果:每个一条 role=tool</text>
<text x="32" y="226" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">  带 tool_call_id</text>
<text x="340" y="26" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">GenAI 约定(OTel 里存的)</text>
<rect x="340" y="36" width="280" height="200" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="352" y="60" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">role: "assistant"</text>
<text x="352" y="82" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">parts: [</text>
<text x="364" y="104" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">{type: "tool_call", id, name,</text>
<text x="364" y="122" font-family="var(--font-mono)" font-size="11" fill="var(--ink)"> arguments: {city: …}},</text>
<text x="364" y="144" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">{type: "text",</text>
<text x="364" y="162" font-family="var(--font-mono)" font-size="11" fill="var(--ink)"> content: "我来查一下…"}</text>
<text x="352" y="184" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">]</text>
<text x="352" y="210" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">工具结果:role=tool 的 parts 里</text>
<text x="352" y="226" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">  type=tool_call_response</text>
<line x1="300" y1="136" x2="338" y2="136" stroke="var(--ink-soft)" marker-start="url(#c653)" marker-end="url(#c653)"/>
<text x="320" y="268" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">左边按字段分(文字一个、工具调用一个列表),右边按顺序排一串 part</text>
<text x="320" y="286" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">左边 arguments 是字符串,右边是对象</text>
<defs><marker id="c653" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>同一条「我来查一下,顺便调三个工具」的回复。OpenAI 格式把文字和工具调用分到两个字段里;parts 格式把它们按顺序排成一串,每段标上类型。</figcaption>
</figure>

**parts** 的意思是「一条消息由若干段组成,每段有自己的类型」。为什么要这么设计?因为 OpenAI 的格式表达不了「先说一段话、调一个工具、再说一段话」这种顺序,而 Anthropic 的模型就会这样回复;图片、音频、思考过程也都能作为一种 part 塞进来。规范的 JSON Schema 里定义的 part 类型有这些:`text`(文字)、`tool_call`(调工具)、`tool_call_response`(工具结果)、`reasoning`(思考过程)、`blob`(内嵌的二进制,比如图片)、`file`(按文件编号引用)、`uri`(按地址引用)、`server_tool_call` 和 `server_tool_call_response`(厂商服务端执行的工具,比如联网搜索)、`compaction`(上下文压缩),再加一个兜底的 `GenericPart`,允许任何自定义的 `type`。

角色(`role`)只有四种:`system`、`user`、`assistant`、`tool`,和 OpenAI 一样。

### 实际记的和约定写的,差在哪

把真实输出和规范逐条对,我找到几处不一样。这些不是谁错了,而是你写导入器时必须知道的事实:

**消息是字符串,不是结构。** `gen_ai.input.messages` 的值是一长串 JSON 文本。规范的原话是:span 属性在某个语言里还不支持结构化的值时,应该序列化成 JSON 字符串记;支持了就记成结构。Python 的 OpenTelemetry 现在还不支持复杂的属性值(Day 366 讲过,属性只能是字符串、数字、布尔和它们的列表),所以是字符串。别的语言、以后的版本可能直接是结构。导入器两种都要认。

**系统提示词在 messages 里,没有 `gen_ai.system_instructions`。** 规范说,厂商的接口允许把系统指令和对话分开传时,才用 `gen_ai.system_instructions`。OpenAI Chat 接口的系统提示词就是 messages 里 role 为 system 的一条,所以记在 messages 里是对的。但如果是 OpenAI Responses 接口的 `instructions`,或者 Anthropic 的 `system` 参数,就会出现在 `gen_ai.system_instructions` 里。导入器要把它补回 messages 的最前面。

**工具定义没记。** 我们传了 `tools=TOOLS`,但属性里没有 `gen_ai.tool.definitions`。它在规范里是 Opt-In,规范还专门写了「可能很大,不建议默认记录非必需的部分」。这一版的自动埋点库在开了内容记录的情况下也没记它。后果是:导入后 llm 步的 `input["tools"]` 是 `None`,Day 666 算「工具定义占了多少 token」时,OTLP 来的数据算不出这一块,界面要说清楚是「没记录」而不是「0」。

**`finish_reason` 的取值。** 输出消息里 `"finish_reason": "tool_calls"`,而规范的 JSON Schema 里 FinishReason 只允许 `stop`、`length`、`content_filter`、`tool_call`、`compaction`、`error`,单数的 `tool_call`。埋点库直接照抄了 OpenAI 接口返回的值。导入器如果用这个字段做判断,两种写法都要认。

**`gen_ai.provider.name` 是 `openai`**,Day 366 就发现了:自动埋点只认 SDK,不知道背后是 DeepSeek。Loupe 不靠它算钱(看的是 `model`),所以不影响,但你看别人的 trace 时别被它骗了。

**没有缓存命中数。** DeepSeek 的响应里有 `prompt_cache_hit_tokens`,但这个属性名是 DeepSeek 自己的,埋点库只认 OpenAI 的 `prompt_tokens_details.cached_tokens`,所以 `gen_ai.usage.cache_read.input_tokens` 没记。

## 第四步:把 parts 转成 OpenAI 消息

先演示一次最容易犯的错:拿到属性直接当列表用。

```python
# agent-loupe/server/scratch/s6_parts_naive.py
import json
from pathlib import Path

attrs = json.loads(Path("../samples/genai_chat_span.json").read_text(encoding="utf-8"))["attributes"]
messages = attrs["gen_ai.input.messages"]
print(type(messages).__name__, len(messages))
for m in messages:
    print(m.get("role"))
```

<div class="line-notes">

- `attrs = json.loads(Path("../samples/genai_chat_span.json").read_text(encoding="utf-8"))["attributes"]` 读一个保存下来的 span。这个文件是我从上面的 `genai_chat_spans.json` 里取出第二个 span 单独存的,复制到了 Loupe 的 `samples/`,测试也要用它(做法见下面)。
- `messages = attrs["gen_ai.input.messages"]` 以为拿到的是消息列表。
- `print(type(messages).__name__, len(messages))` 看看它到底是什么类型、多长。
- `for m in messages:` 遍历。

</div>

先把样例存进 Loupe 仓库:

```bash
cd /Users/你/agent-loupe
python3 -c "import json;d=json.load(open('/Users/你/agent-zero-lab/part11/runs/genai_chat_spans.json'));json.dump(d[1],open('samples/genai_chat_span.json','w'),ensure_ascii=False,indent=2)"
cd server
uv run python -m scratch.s6_parts_naive
```

```text
str 1350
Traceback (most recent call last):
  ...
    print(m.get("role"))
          ^^^^^
AttributeError: 'str' object has no attribute 'get'
```

它是一个 1350 个字符的字符串。Python 里遍历字符串是一个字符一个字符地取,第一个字符是 `[`,字符串没有 `.get` 方法,于是报错。≈ 在 JS 里拿到 `'[{"role":...'` 就直接 `.map(m => m.role)`,只不过 JS 的字符串连 `.map` 都没有,会更早报错。修法是看到以 `[` 或 `{` 开头的字符串就先试着 `json.loads`。

完整的转换模块:

```python
# agent-loupe/server/loupe/importers/genai.py
import json
from typing import Any

from loupe.models import StepKind

KIND_BY_OPERATION: dict[str, StepKind] = {
    "chat": "llm", "text_completion": "llm", "generate_content": "llm",
    "execute_tool": "tool",
    "invoke_agent": "agent", "create_agent": "agent", "invoke_workflow": "agent", "plan": "agent",
    "embeddings": "retrieval", "retrieval": "retrieval", "search_memory": "retrieval",
}


def kind_of(operation: str | None) -> StepKind:
    return KIND_BY_OPERATION.get(operation or "", "other")


def maybe_json(value: Any) -> Any:
    if isinstance(value, str) and value[:1] in ("[", "{"):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def as_text(value: Any) -> str:
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def parts_to_openai(messages: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in maybe_json(messages) or []:
        parts: list[dict[str, Any]] = m.get("parts", [])
        responses = [p for p in parts if p.get("type") == "tool_call_response"]
        if responses:
            out += [{"role": "tool", "tool_call_id": p.get("id"), "content": as_text(p.get("response"))}
                    for p in responses]
            continue
        texts: list[str] = []
        calls: list[dict[str, Any]] = []
        reasoning: list[str] = []
        for p in parts:
            t = p.get("type")
            if t == "text":
                texts.append(p.get("content", ""))
            elif t == "tool_call":
                calls.append({"id": p.get("id"), "type": "function",
                              "function": {"name": p.get("name"), "arguments": as_text(p.get("arguments", {}))}})
            elif t == "reasoning":
                reasoning.append(p.get("content", ""))
            else:
                texts.append(f"[{t} 内容未展示]")
        msg: dict[str, Any] = {"role": m.get("role", "user"), "content": "\n".join(texts) if texts else None}
        if calls:
            msg["tool_calls"] = calls
        if reasoning:
            msg["reasoning_content"] = "\n".join(reasoning)
        out.append(msg)
    return out


def system_to_messages(instructions: Any) -> list[dict[str, Any]]:
    parts = maybe_json(instructions)
    if not parts:
        return []
    if isinstance(parts, str):
        return [{"role": "system", "content": parts}]
    text = "\n".join(p.get("content", "") for p in parts if p.get("type") == "text")
    return [{"role": "system", "content": text}]


def llm_input_output(attrs: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    has_content = any(k in attrs for k in ("gen_ai.input.messages", "gen_ai.output.messages"))
    if not has_content:
        return None, None
    messages = system_to_messages(attrs.get("gen_ai.system_instructions"))
    messages += parts_to_openai(attrs.get("gen_ai.input.messages"))
    outputs = parts_to_openai(attrs.get("gen_ai.output.messages"))
    tools = maybe_json(attrs.get("gen_ai.tool.definitions"))
    return {"messages": messages, "tools": tools}, (outputs[0] if outputs else None)
```

<div class="line-notes">

- `from loupe.models import StepKind` 用 Day 652 定义的类型。导入器依赖模型,模型不依赖导入器,方向不能反。
- `def maybe_json(value: Any) -> Any:` 「是 JSON 字符串就解析,不是就原样返回」。约定允许结构化和字符串两种记法,这个函数把两种统一成结构。
- `if isinstance(value, str) and value[:1] in ("[", "{"):` 只对以 `[` 或 `{` 开头的字符串动手。`value[:1]` 取第一个字符,空字符串时得到空字符串而不是报错(`value[0]` 会报 IndexError)。普通文本(比如工具返回的 `"rainy, 57°F"`)不碰。
- `except json.JSONDecodeError:` 碰巧以 `[` 开头但不是 JSON(比如 `"[注意] 库存不足"`),就原样返回,不让整个导入失败。
- `def as_text(value: Any) -> str:` 反过来:不是字符串就转成 JSON 文本。OpenAI 格式里工具参数和工具结果的 content 都要求是字符串。
- `for m in maybe_json(messages) or []:` 先解析,解析出来是 `None` 就用空列表,≈ `(parse(x) ?? []).forEach(...)`。
- `responses = [p for p in parts if p.get("type") == "tool_call_response"]` 工具结果。parts 格式里一条 tool 消息可以装好几个结果,OpenAI 格式要求一个结果一条消息。
- `out += [{"role": "tool", "tool_call_id": p.get("id"), "content": as_text(p.get("response"))}` 拆成多条 role=tool 消息。`response` 可能是字符串也可能是对象,统一成字符串。`out += [...]` ≈ `out.push(...arr)`。
- `continue` 这条消息处理完了,跳到下一条。
- `if t == "text":` 文字段,收集起来最后拼成一个 content。
- `elif t == "tool_call":` 工具调用段,转成 OpenAI 的 `{id, type: "function", function: {name, arguments}}`。
- `"function": {"name": p.get("name"), "arguments": as_text(p.get("arguments", {}))}})` 关键的一处:parts 里 `arguments` 是对象 `{"city": "Beijing"}`,OpenAI 格式里是字符串 `'{"city": "Beijing"}'`。不转的话,Day 669 把这条消息原样发回给模型重跑时,DeepSeek 会因为类型不对拒收。
- `elif t == "reasoning":` 思考段,对应 DeepSeek 的 `reasoning_content`。
- `texts.append(f"[{t} 内容未展示]")` 其余类型(图片、文件、服务端工具……)先放一个占位文字,至少界面上看得出「这里原本有个东西」,不悄悄丢掉。
- `msg: dict[str, Any] = {"role": m.get("role", "user"), "content": "\n".join(texts) if texts else None}` 多段文字用换行拼起来;一段文字都没有时 content 是 `None`,和 OpenAI 接口里「只调工具不说话」的消息一致。
- `if calls:` 有工具调用才加 `tool_calls` 键,没有就不加,和 Day 649 存的 `r.message` 形状一样(那里是 `exclude_none=True`)。
- `def system_to_messages(instructions: Any) -> list[dict[str, Any]]:` 处理单独记的系统指令。它的格式是一组 part(规范的 JSON Schema 里只有 text 等几种),也有库直接记成一段文字。
- `def llm_input_output(attrs: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:` 给 llm 步用:从一个 span 的全部属性里拼出 Day 652 约定的 input 和 output。返回值是一个二元组,≈ TS 的 `[Input | null, Output | null]`。
- `if not has_content:` 输入输出都没记(默认状态),两个都返回 `None`,界面显示「没有记录内容」。
- `messages = system_to_messages(attrs.get("gen_ai.system_instructions"))` 系统指令放最前面。
- `return {"messages": messages, "tools": tools}, (outputs[0] if outputs else None)` 输出取第一条。规范里 output.messages 可以有多条(请求了多个候选回复时),Agent 循环里几乎总是一条。

</div>

试一下真实样例:

```bash
uv run python -c "
import json
from loupe.importers.genai import llm_input_output
a = json.load(open('../samples/genai_chat_span.json'))['attributes']
i, o = llm_input_output(a)
print(len(i['messages']), [m['role'] for m in i['messages']], i['tools'])
print(json.dumps(i['messages'][2], ensure_ascii=False))
"
```

```text
6 ['system', 'user', 'assistant', 'tool', 'tool', 'tool'] None
{"role": "assistant", "content": "我来查一下这三个城市的气温。", "tool_calls": [{"id": "call_00_lFl7AJOvUciP3astiFF70101", "type": "function", "function": {"name": "get_weather", "arguments": "{\"city\": \"Beijing\"}"}}, {"id": "call_01_0USwnoFws31aXuc44x669063", "type": "function", "function": {"name": "get_weather", "arguments": "{\"city\": \"Shanghai\"}"}}, {"id": "call_02_JY7otXHwn5IhunBjsNmc0017", "type": "function", "function": {"name": "get_weather", "arguments": "{\"city\": \"Guangzhou\"}"}}]}
```

六条消息,角色顺序和 Agent 循环里的完全一样;第三条 assistant 消息有文字也有三个工具调用,arguments 变回了字符串。`tools` 是 `None`,对应上面说的「工具定义没记」。

**转换会丢掉一样东西:顺序。** 那条 assistant 消息在 parts 里是「三个工具调用,然后一段文字」,转成 OpenAI 格式以后文字和工具调用分在两个字段,先后关系没了。对 DeepSeek、OpenAI 的回复这无所谓,它们的接口本来就不区分;对 Anthropic 那种「说一段、调一个、再说一段」的回复,Loupe 的详情面板会显示得不完全一样。我接受这个损失,换来的是全课所有代码只认一种消息格式。练习 2 会让你亲眼看到顺序在哪一步丢的。

## 第五步:映射表

把今天的结论整理成一张表,存成 `agent-loupe/docs/otel_mapping.md`。明天写 OTLP 导入器时照着它写,以后规范变了也先改这张表:

| Loupe 字段 | 从哪个 span 字段或属性来 | 说明 |
| --- | --- | --- |
| Run.id | traceId | 一个 traceId 一个 Run |
| Run.name | 根 span 的 name | 根:没有父 span,或父 span 不在文件里 |
| Run.status | 根 span 的 status | 状态码是错误就是 error,其他是 ok |
| Run.tags | 固定加 `otlp`,再加 resource 的 `service.name` | |
| Step.kind | `gen_ai.operation.name` | 查 `KIND_BY_OPERATION`,没有或不认识就是 other |
| Step.name | span 的 name | 如 `chat deepseek-flash` |
| Step.started_at / ended_at | span 的开始、结束时间 | 纳秒整数,明天讲 |
| Step.parent_idx | parentSpanId | 换成父 span 排序后的编号 |
| Step.error | status 的 message,没有就用 `error.type` | 只在状态是错误时填 |
| Step.model(llm) | `gen_ai.response.model`,没有就用 `gen_ai.request.model` | 实际用的模型优先 |
| Step.input_tokens / output_tokens(llm) | `gen_ai.usage.input_tokens` / `output_tokens` | input 已包含缓存命中的部分 |
| Step.input(llm) | `gen_ai.system_instructions` + `gen_ai.input.messages` + `gen_ai.tool.definitions` | Opt-In,常常没有 |
| Step.output(llm) | `gen_ai.output.messages` 的第一条 | Opt-In |
| Step.input / output(tool) | `gen_ai.tool.call.arguments` / `gen_ai.tool.call.result` | Opt-In |
| Step.input / output(retrieval) | `gen_ai.retrieval.query.text` / `gen_ai.retrieval.documents` | Opt-In |
| Step.cost_usd | 约定里没有 | Day 660 按价格表补 |
| 不导入 | `gen_ai.provider.name`、`gen_ai.response.id`、`gen_ai.request.temperature` 等 | 以后需要再加 |

<figure>
<svg viewBox="0 0 640 280" role="img" aria-label="一个 chat span 的属性分三类:身份和时间、统计数字、内容,分别映射到 Step 的不同字段">
<rect x="0" y="0" width="640" height="280" fill="var(--paper-raised)" rx="6"/>
<text x="20" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">chat span 的属性</text>
<rect x="20" y="34" width="270" height="62" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="54" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">gen_ai.operation.name  Required</text>
<text x="30" y="72" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">name / 开始结束 / parent / status</text>
<text x="30" y="90" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">一定有</text>
<rect x="20" y="106" width="270" height="62" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="126" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">gen_ai.usage.*_tokens  Recommended</text>
<text x="30" y="144" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">gen_ai.response.model</text>
<text x="30" y="162" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">通常有</text>
<rect x="20" y="178" width="270" height="62" fill="none" stroke="var(--compute)" stroke-dasharray="4 3"/>
<text x="30" y="198" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">gen_ai.input/output.messages  Opt-In</text>
<text x="30" y="216" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">system_instructions / tool.definitions</text>
<text x="30" y="234" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">默认没有</text>
<line x1="292" y1="65" x2="378" y2="65" stroke="var(--ink-soft)" marker-end="url(#d653)"/>
<line x1="292" y1="137" x2="378" y2="137" stroke="var(--ink-soft)" marker-end="url(#d653)"/>
<line x1="292" y1="209" x2="378" y2="209" stroke="var(--ink-soft)" stroke-dasharray="4 3" marker-end="url(#d653)"/>
<text x="335" y="200" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">parts→OpenAI</text>
<rect x="380" y="34" width="240" height="206" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="392" y="54" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">kind, name, started_at,</text>
<text x="392" y="72" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">ended_at, parent_idx, error</text>
<text x="392" y="126" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">input_tokens, output_tokens</text>
<text x="392" y="144" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">model</text>
<text x="392" y="198" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">input: {messages, tools}</text>
<text x="392" y="216" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">output: assistant 消息</text>
<text x="392" y="234" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">没记就是 None</text>
<text x="320" y="266" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">时间轴只靠上两块就能画出来;详情面板和重跑要靠虚线那一块</text>
<defs><marker id="d653" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>按要求级别看,一个模型调用 span 的属性分三层。拿到没开内容记录的 trace,Loupe 照样能画时间轴、算 token,只是点开看不到对话。</figcaption>
</figure>

## 测试

```python
# agent-loupe/server/tests/test_genai.py
import json
from pathlib import Path

from loupe.importers.genai import kind_of, llm_input_output, parts_to_openai

SAMPLES = Path(__file__).parents[2] / "samples"

PARIS = [
    {"role": "user", "parts": [{"type": "text", "content": "Weather in Paris?"}]},
    {"role": "assistant", "parts": [{"type": "tool_call", "id": "call_VSPy", "name": "get_weather",
                                     "arguments": {"location": "Paris"}}]},
    {"role": "tool", "parts": [{"type": "tool_call_response", "id": "call_VSPy", "response": "rainy, 57°F"}]},
]


def test_kind_of_known_and_unknown_operations() -> None:
    assert [kind_of(op) for op in ("chat", "execute_tool", "invoke_agent", "retrieval")] == \
        ["llm", "tool", "agent", "retrieval"]
    assert kind_of("create_memory") == "other"
    assert kind_of(None) == "other"


def test_spec_example_to_openai() -> None:
    out = parts_to_openai(PARIS)
    assert out[0] == {"role": "user", "content": "Weather in Paris?"}
    call = out[1]["tool_calls"][0]
    assert out[1]["content"] is None
    assert call["function"] == {"name": "get_weather", "arguments": '{"location": "Paris"}'}
    assert out[2] == {"role": "tool", "tool_call_id": "call_VSPy", "content": "rainy, 57°F"}


def test_json_string_attribute_is_parsed() -> None:
    assert parts_to_openai(json.dumps(PARIS)) == parts_to_openai(PARIS)


def test_reasoning_and_unknown_parts() -> None:
    [msg] = parts_to_openai([{"role": "assistant", "parts": [
        {"type": "reasoning", "content": "先查北京"},
        {"type": "blob", "modality": "image", "content": "iVBOR..."},
        {"type": "text", "content": "好的"}]}])
    assert msg["reasoning_content"] == "先查北京"
    assert msg["content"] == "[blob 内容未展示]\n好的"


def test_real_deepseek_span() -> None:
    attrs = json.loads((SAMPLES / "genai_chat_span.json").read_text(encoding="utf-8"))["attributes"]
    inp, out = llm_input_output(attrs)
    assert inp is not None and out is not None
    assert [m["role"] for m in inp["messages"]] == ["system", "user", "assistant", "tool", "tool", "tool"]
    calls = inp["messages"][2]["tool_calls"]
    assert [c["id"] for c in calls] == [m["tool_call_id"] for m in inp["messages"][3:]]
    assert json.loads(calls[0]["function"]["arguments"]) == {"city": "Beijing"}
    assert inp["tools"] is None
    assert out["role"] == "assistant" and "tool_calls" not in out


def test_no_content_recorded() -> None:
    assert llm_input_output({"gen_ai.operation.name": "chat", "gen_ai.usage.input_tokens": 310}) == (None, None)
```

<div class="line-notes">

- `SAMPLES = Path(__file__).parents[2] / "samples"` `__file__` 是这个测试文件的路径,`parents[0]` 是 `tests/`,`[1]` 是 `server/`,`[2]` 是仓库根目录。这样不管从哪个目录跑 pytest 都找得到样例。
- `PARIS = [` 规范示例文档 `examples-llm-calls.md` 里那个巴黎天气的例子,我把 id 缩短了。用规范自己的例子做测试,规范改了格式、例子跟着改,你一对就知道。
- `assert kind_of("create_memory") == "other"` 规范里有、我们故意没映射的,走兜底。
- `assert out[1]["content"] is None` 只调工具不说话的 assistant 消息,content 是 `None` 不是空字符串。
- `assert call["function"] == {"name": "get_weather", "arguments": '{"location": "Paris"}'}` arguments 从对象变成了字符串。
- `assert parts_to_openai(json.dumps(PARIS)) == parts_to_openai(PARIS)` 字符串和结构两种记法,结果一样。
- `assert msg["content"] == "[blob 内容未展示]\n好的"` 不认识的 part 留了占位,文字照常保留。
- `assert [c["id"] for c in calls] == [m["tool_call_id"] for m in inp["messages"][3:]]` 三个工具调用的 id 和后面三条 tool 消息的 `tool_call_id` 一一对上,这是 [Day 159](/blog/agent-zero/day-159-tool-roundtrip/) 讲的配对关系,转换后不能乱。
- `assert json.loads(calls[0]["function"]["arguments"]) == {"city": "Beijing"}` 比较时先解析再比。字符串的空格写法可能不一样(DeepSeek 原本返回的是什么格式我们已经不知道了),解析后的内容一样才是关键。
- `assert inp["tools"] is None` 把「工具定义没记」这个事实也写进测试。哪天埋点库开始记了,这条测试会红,提醒你去看看。

</div>

```bash
cd /Users/你/agent-loupe/server
uv run pytest -q
```

```text
............                                                             [100%]
12 passed in 1.24s
```

昨天 6 个,今天加 6 个。basedpyright 查 `loupe/`、`tests/`、`scratch/` 0 个错误。

## 今天的文件

| 文件 | 干什么 | 新建还是修改 | 花费 |
| --- | --- | --- | --- |
| `agent-zero-lab/part11/otel_capture.py` | 给 Day 649 的 Agent 加官方自动埋点,存下 span | 新建 | 两次约 ¥0.005 |
| `agent-zero-lab/part11/runs/genai_chat_spans.json` | 两个真实的 chat span | 生成 | |
| `agent-loupe/samples/genai_chat_span.json` | 第二个 span,测试用 | 生成 | |
| `agent-loupe/server/loupe/importers/genai.py` | 操作名映射、parts 转 OpenAI、拼 llm 步的输入输出 | 新建 | 不花 |
| `agent-loupe/server/tests/test_genai.py` | 6 个测试 | 新建 | 不花 |
| `agent-loupe/docs/otel_mapping.md` | 映射表 | 新建 | |
| `agent-loupe/server/scratch/s6_parts_naive.py`、`ex653_*.py` | 演示和练习 | 新建,不提交 | 不花 |

花费的算式:正文两次运行各调 2 次模型,ledger 打出来分别是 ¥0.0023 和 ¥0.0024,合计约 ¥0.005;练习 3 再跑一次 ¥0.0022,全天约 ¥0.007。

## 动手练习

**练习 1:规范变了你怎么知道。** 写 `scratch/ex653_ops.py`:直接从 GitHub 下载规范的 `gen-ai-spans.md`,把操作名那张表里的所有名字抽出来,逐个打印它在 `KIND_BY_OPERATION` 里归成什么,再列出「映射表里有、规范里已经没有」的名字。

<details><summary>参考答案</summary>

```python
# agent-loupe/server/scratch/ex653_ops.py
import re
from urllib.request import urlopen

from loupe.importers.genai import KIND_BY_OPERATION

URL = ("https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/"
       "main/docs/gen-ai/gen-ai-spans.md")

text = urlopen(URL, timeout=30).read().decode("utf-8")
start = text.index("`gen_ai.operation.name` has the following list of well-known values")
table = text[start:text.index("\n\n", text.index("| --- |", start))]
ops = re.findall(r"^\| `([a-z_]+)` \|", table, re.M)
print(f"规范里 {len(ops)} 个操作名")
for op in ops:
    print(f"  {op:<22} → {KIND_BY_OPERATION.get(op, 'other（没写进映射表）')}")
extra = sorted(set(KIND_BY_OPERATION) - set(ops))
print("映射表里有、规范里没有的:", extra or "无")
```

<div class="line-notes">

- `from urllib.request import urlopen` 标准库自带的 HTTP 客户端,用法比 httpx 简陋,但不用为一个练习往 Loupe 加依赖。
- `URL = ("https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/"` `raw.githubusercontent.com` 返回文件原文,不是 GitHub 的网页。两段字符串写在括号里会自动拼接,≈ JS 里用 `+` 拼长字符串。
- `start = text.index("`gen_ai.operation.name` has the following list of well-known values")` 找到操作名表格前面那句固定的话。`index` 找不到会抛异常,规范改了措辞时脚本会大声失败,而不是悄悄返回空列表。
- `table = text[start:text.index("\n\n", text.index("| --- |", start))]` 从那句话开始,截到表格分隔行之后的第一个空行,就是整张表。
- `ops = re.findall(r"^\| `([a-z_]+)` \|", table, re.M)` 每行开头是 `` | `chat` | `` 这种格式,把反引号里的名字抓出来。
- `print(f"  {op:<22} → {KIND_BY_OPERATION.get(op, 'other（没写进映射表）')}")` `:<22` 左对齐补到 22 格,打出来是一列整齐的表。
- `extra = sorted(set(KIND_BY_OPERATION) - set(ops))` 集合相减:映射表里有、规范里没有的。规范删了或改名了某个操作,这里就会冒出来。

</div>

```bash
uv run python -m scratch.ex653_ops
```

```text
规范里 18 个操作名
  chat                   → llm
  create_agent           → agent
  create_memory          → other（没写进映射表）
  create_memory_store    → other（没写进映射表）
  delete_memory          → other（没写进映射表）
  delete_memory_store    → other（没写进映射表）
  embeddings             → retrieval
  execute_tool           → tool
  fetch_response         → other（没写进映射表）
  generate_content       → llm
  invoke_agent           → agent
  invoke_workflow        → agent
  plan                   → agent
  retrieval              → retrieval
  search_memory          → retrieval
  text_completion        → llm
  update_memory          → other（没写进映射表）
  upsert_memory          → other（没写进映射表）
映射表里有、规范里没有的: 无
```

18 个都有着落,没写进映射表的 8 个是我们有意归到 other 的。这个脚本可以每个月跑一次,规范里多出一个新操作名时,你会在列表里看到它并决定归到哪一类。下载要能访问 `raw.githubusercontent.com`,访问不了就先在浏览器里把文件存下来,把 `urlopen(...)` 换成读本地文件。

</details>

**练习 2:顺序在哪里丢的。** 写一个反方向的函数 `openai_to_parts`,把 OpenAI 格式的消息转回 parts 格式。用真实样例做一次来回:parts → OpenAI → parts,看和原来的是否完全一样。再把你函数里「先放文字还是先放工具调用」的顺序换一下,再比一次。

<details><summary>参考答案</summary>

```python
# agent-loupe/server/scratch/ex653_roundtrip.py
import json
from pathlib import Path
from typing import Any

from loupe.importers.genai import maybe_json, parts_to_openai


def openai_to_parts(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in messages:
        if m["role"] == "tool":
            out.append({"role": "tool", "parts": [
                {"type": "tool_call_response", "id": m.get("tool_call_id"), "response": m.get("content")}]})
            continue
        parts: list[dict[str, Any]] = []
        if m.get("reasoning_content"):
            parts.append({"type": "reasoning", "content": m["reasoning_content"]})
        for c in m.get("tool_calls") or []:
            parts.append({"type": "tool_call", "id": c["id"], "name": c["function"]["name"],
                          "arguments": maybe_json(c["function"]["arguments"])})
        if m.get("content"):
            parts.append({"type": "text", "content": m["content"]})
        out.append({"role": m["role"], "parts": parts})
    return out


attrs = json.loads(Path("../samples/genai_chat_span.json").read_text(encoding="utf-8"))["attributes"]
original_parts = json.loads(attrs["gen_ai.input.messages"])
as_openai = parts_to_openai(original_parts)
back = openai_to_parts(as_openai)
print("parts → OpenAI → parts 和原来一样:", back == original_parts)
print("再转一次 OpenAI 也一样:", parts_to_openai(back) == as_openai)
```

<div class="line-notes">

- `if m["role"] == "tool":` 一条 tool 消息变成一个只有一段 `tool_call_response` 的 parts 消息。
- `if m.get("reasoning_content"):` 思考内容放最前面,模型是先想再说的。
- `for c in m.get("tool_calls") or []:` 没有 `tool_calls` 键时 `.get` 返回 `None`,`or []` 换成空列表。
- `"arguments": maybe_json(c["function"]["arguments"])})` 字符串参数解析回对象。
- `if m.get("content"):` 文字放在工具调用**后面**。这是我对着真实样例改出来的,下面说为什么。
- `print("parts → OpenAI → parts 和原来一样:", back == original_parts)` Python 的 `==` 对字典和列表是逐层比较内容,字典的键顺序不影响,列表的元素顺序影响。≈ 一个深比较的 `isEqual`。

</div>

```bash
uv run python -m scratch.ex653_roundtrip
```

```text
parts → OpenAI → parts 和原来一样: True
再转一次 OpenAI 也一样: True
```

把「文字」那两行挪到 `for c in ...` 前面再跑:

```text
parts → OpenAI → parts 和原来一样: False
再转一次 OpenAI 也一样: True
```

第一行变成了 False:原来的 parts 里文字在三个工具调用后面,转成 OpenAI 格式以后这个先后关系没有地方存,转回来只能按你函数里写的固定顺序排。第二行始终是 True,说明从 OpenAI 格式这边看,信息一点没丢。结论:**parts 比 OpenAI 格式多一样信息,就是段与段之间的顺序**。Loupe 内部用 OpenAI 格式,就接受了这个损失。如果以后要完整显示 Anthropic 那种交替的回复,可以把原始的 parts 另存一份在 `input` 里一个约定的键下面。

</details>

**练习 3:没开内容记录时导入会怎样。** 不加那两个环境变量再跑一次 `otel_capture.py`,把第二个 span 交给 `llm_input_output`,看返回什么;再说说界面上应该怎么显示这一步。

<details><summary>参考答案</summary>

```bash
cd /Users/你/agent-zero-lab
uv run python -m part11.otel_capture
cd /Users/你/agent-loupe/server
uv run python -c "
import json
from loupe.importers.genai import llm_input_output
a = json.load(open('/Users/你/agent-zero-lab/part11/runs/genai_chat_spans.json'))[1]['attributes']
print(sorted(a))
print(llm_input_output(a))
"
```

第一条命令的输出和第二步一样(两个「没有消息原文」)。第二条:

```text
['gen_ai.operation.name', 'gen_ai.provider.name', 'gen_ai.request.model', 'gen_ai.response.finish_reasons', 'gen_ai.response.id', 'gen_ai.response.model', 'gen_ai.usage.input_tokens', 'gen_ai.usage.output_tokens', 'openai.response.system_fingerprint']
(None, None)
```

九个属性,没有任何内容;`llm_input_output` 返回两个 `None`。这一步导入后 `input_tokens` 是 482(这次跑的,和样例里的 489 差几个 token,模型每次回复的长度不完全一样)、`model` 是 deepseek-flash,时间轴上照常显示,只是 `input` 和 `output` 为空。界面上应该在详情面板写明「这一步没有记录消息内容(OpenTelemetry 默认不记,来源端设置 `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` 才有)」,把原因和打开方法一起告诉用户,而不是显示一个空白的对话框让人以为模型什么都没收到。上下文构成图(Day 666)对这种步骤只能画一根「总共 482 tokens、构成未知」的灰条。

</details>

**验收标准**:`server/` 下 `uv run pytest -q` 12 passed;`otel_capture.py` 开和不开内容记录各跑一次,能说出两次 span 的属性差在哪;`ex653_ops.py` 列出的 18 个操作名你都能说出为什么归到那一类;能不看文章说出四个要求级别的意思,以及「实际记的和约定写的」至少三处不一样。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 语义约定(semantic conventions) | OpenTelemetry 规定某一类操作的 span 叫什么、记哪些属性、属性叫什么的规范 |
| GenAI 语义约定 | 专门针对大模型、Agent、工具调用的那一套,2026 年 10 月仍是 Development 状态 |
| Development(状态) | 规范还在变,属性名可能改,不保证向后兼容 |
| `gen_ai.operation.name` | 每个 GenAI span 都有的属性,说明是什么操作,如 `chat`、`execute_tool` |
| 要求级别(requirement level) | 每个属性标的「必须记 / 条件满足必须记 / 应该记 / 主动打开才记」 |
| Opt-In | 默认不记,使用者主动打开才记;消息、工具定义、工具参数都是 |
| inference span | 规范对「一次模型调用」那种 span 的叫法 |
| parts | GenAI 约定的消息结构:一条消息由若干段组成,每段标一个类型 |
| part 类型 | `text`、`tool_call`、`tool_call_response`、`reasoning`、`blob`、`file`、`uri` 等 |
| 自动埋点(instrumentation) | 给某个库打补丁、自动产生 span 的包,今天用的是 `opentelemetry-instrumentation-openai-v2`(Day 366 学过) |
| 映射表 | 「外部格式的哪个字段对应内部模型的哪个字段」的对照表,导入器照着它写 |

## 常见误区

**以为 OTLP trace 里一定有对话内容。** 消息、系统提示词、工具定义、工具参数和结果全是 Opt-In,默认不记。拿到别人的 trace 先看有没有 `gen_ai.input.messages`,没有就只能看时间和 token。

**把 `gen_ai.input.messages` 直接当列表遍历。** Python 的 OpenTelemetry 把它记成 JSON 字符串,遍历会得到一个个字符,接着报 `AttributeError: 'str' object has no attribute 'get'`。先 `maybe_json`。

**parts 里的 `arguments` 原样放进 OpenAI 消息。** parts 里是对象,OpenAI 格式里要字符串。现在看不出问题,到 Day 669 重跑时把消息发回给模型才报错。

**按 `gen_ai.provider.name` 判断用的是哪家。** 自动埋点只认 SDK,DeepSeek、硅基流动走 openai SDK 时都记成 `openai`。看模型名。

**遇到不认识的操作名就报错。** 规范允许自定义取值,而且列表本身也在增加(记忆相关的七个就是较新加进来的一组)。不认识的一律 other,用练习 1 的脚本定期看看有没有新的值得单独归类。

**以为 `input_tokens` 不含缓存命中的部分。** 规范写明它包含所有输入 token,缓存命中另记在 `cache_read.input_tokens`,是子集。算钱时先减出来再分别乘单价。

**把系统提示词只当 messages 里的一条。** 用 Responses 接口的 `instructions` 或 Anthropic 的 `system` 参数时,它在 `gen_ai.system_instructions` 里,不在 messages 里。漏读它,详情面板上就看不到系统提示词。

## 学习资料

### 文档与文章

- [GenAI 约定:Client Inference](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/client-inference.md):今天的主要参考,模型调用 span 的完整属性表和每个属性的脚注,重点读 input/output messages 和 tool.definitions 的说明,40 分钟。
- [GenAI 约定:Spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md):操作名表、检索 span、工具 span,以及「内容记在属性上」那一节,30 分钟。
- [GenAI 约定:LLM 调用示例](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/non-normative/examples-llm-calls.md):带工具调用的完整例子,测试里的巴黎天气就来自这里,15 分钟。
- [输入消息的 JSON Schema](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/model/gen-ai/gen-ai-input-messages.json):所有 part 类型的正式定义,写转换函数时对着查,15 分钟。
- [OpenTelemetry:属性要求级别](https://opentelemetry.io/docs/specs/semconv/general/attribute-requirement-level/):Required、Recommended、Opt-In 的正式定义,10 分钟。
- [opentelemetry-instrumentation-openai-v2](https://github.com/open-telemetry/opentelemetry-python-contrib/tree/main/instrumentation-genai/opentelemetry-instrumentation-openai-v2):今天用的自动埋点库,README 里有内容记录的配置说明,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1w3HrePENj&autoplay=0&high_quality=1" title="基于 Opentelemetry 的大模型应用可观测丨阿里云云原生研发工程师李艳红（彦鸿）发表主题演讲" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>阿里云云原生 · 基于 Opentelemetry 的大模型应用可观测 · 19 分钟。一线团队讲大模型应用的 span 怎么设计、记哪些属性。2024 年的演讲,属性名以今天读的规范为准,看思路:哪些默认记、哪些要打开。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1NyMk6QENt&autoplay=0&high_quality=1" title="Agent可观测性从0到1：Langfuse + OpenTelemetry 双剑合璧，打造LLM原生监控体系" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>代码指南 · Agent可观测性从0到1:Langfuse + OpenTelemetry 双剑合璧,打造LLM原生监控体系 · 1 小时 48 分。长,挑讲 OpenTelemetry 埋点和 GenAI 属性的部分看,对照今天的映射表想想 Langfuse 是怎么把这些属性存成自己的 observation 的(Day 655 要用)。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/JnQXEMHh3aw" title="OpenTelemetry for GenAI and the OpenLLMetry project" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>OpenObservability Talks · OpenTelemetry for GenAI and the OpenLLMetry project · 英文。GenAI 约定的参与者聊这套约定是怎么来的、为什么内容默认不记,听背景,具体属性名以规范为准。</figcaption>
</figure>

### 书籍

- **Learning OpenTelemetry**,Ted Young、Austin Parker,O'Reilly,2024。Ted Young 是 OpenTelemetry 项目的联合创始人。读讲语义约定和属性设计的章节,理解为什么要有统一的属性名、为什么规范分要求级别。

### 开源项目与代码

- [open-telemetry/semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai):规范仓库。`docs/gen-ai/non-normative/models.py` 用 Python 写了一遍消息和 part 的数据结构,和今天的 `genai.py` 对照着看。
- [Arize-ai/openinference](https://github.com/Arize-ai/openinference):另一套给大模型应用用的 trace 约定(Arize Phoenix 用它),属性名和 GenAI 约定不一样。看它的 README 和约定文档,体会「同一件事两套命名」时为什么导入器要和内部模型隔开。

## 自测

1. 一个 `chat` span 只有 `gen_ai.operation.name`、`gen_ai.request.model` 和两个 token 数,没有任何消息。这个 trace 是坏的吗?Loupe 怎么处理?

<details><summary>答案</summary>

不是坏的,这是默认状态。消息、系统提示词、工具定义都是 Opt-In,不主动打开就不记,出于隐私考虑。Loupe 照常导入:kind、时间、token、模型都有,时间轴能画;`llm_input_output` 返回两个 `None`,详情面板显示「没有记录消息内容」并说明怎么打开。

</details>

2. `plan`、`embeddings`、`fetch_response` 分别归成哪种 kind?为什么?

<details><summary>答案</summary>

`plan` 归 agent:它是 Agent 的规划阶段,里面的模型调用会以子 span 出现,它本身是容器。`embeddings` 归 retrieval:它不收 messages、不出 assistant 消息,渲染成对话没有意义,而且几乎总是检索流程的一部分。`fetch_response` 归 other:规范写明它只取回以前生成的回复、不做推理,归成 llm 会让「调了几次模型」多算。

</details>

3. parts 格式和 OpenAI 格式各有什么,转换时丢了什么?

<details><summary>答案</summary>

parts 格式:一条消息是一串带类型的段(text、tool_call、tool_call_response、reasoning、图片等),按顺序排,工具参数是对象,一条 tool 消息可以装多个结果。OpenAI 格式:文字在 content,工具调用在 tool_calls 列表,参数是字符串,一个工具结果一条 role=tool 消息。转成 OpenAI 格式时丢了段与段之间的顺序(先说话还是先调工具),练习 2 的来回转换能看出来;图片等类型 Loupe 先用占位文字代替。

</details>

4. 为什么 `gen_ai.input.messages` 在 Python 里是字符串?你的导入器要怎么写才不怕它将来变成结构?

<details><summary>答案</summary>

OpenTelemetry 的 span 属性目前只支持字符串、数字、布尔和它们的列表,不支持嵌套结构;规范说这种情况下要把消息序列化成 JSON 字符串记,支持了就记成结构。导入器用 `maybe_json` 先统一:是以 `[` 或 `{` 开头的字符串就解析,已经是结构就原样用。测试里两种都喂一次,结果必须一样。

</details>

5. 面试题:你在做一个读 OpenTelemetry trace 的工具,对方给的数据来自三家不同的埋点库,有的记内容有的不记,有的 provider 名不准,有的多了你不认识的操作名。你怎么设计导入,保证不崩、不误导?

<details><summary>答案</summary>

一是隔离:外部格式只在导入器里出现,导入时就转成自己的内部模型,规范和各家差异都消化在这一层。二是宽进:不认识的操作名归 other,内容属性既认字符串也认结构,缺失的字段就是 `None`,不报错。三是不误导:缺失和零分开(token 没记是 None 不是 0),没记内容在界面上明说原因和打开方法;不靠不可靠的字段做判断(provider 名不准就看模型名)。四是可验证:用规范自己的示例和真实采集的样例做测试,再写个脚本定期对比规范的操作名列表,规范一变就知道。

</details>

6. 面试题:为什么不直接把 OpenTelemetry 的 span 存进数据库,前端去适配它?

<details><summary>答案</summary>

一是它在变,Development 状态,存原样数据等于把规范的每次变动传到前端和数据库;二是它不是唯一来源,还有 Langfuse 导出和自研 SDK,三种格式让前端每个组件都写三套分支;三是调试器需要的「第几步」「父子编号」「OpenAI 格式的消息」它都没有,每次查询都要现算。导入时一次性转成 Run/Step,代价是转换可能丢信息(比如 parts 的顺序),这个代价是看得见、能测的。

</details>

## 明天预告

明天是 Day 654,Loupe(三):导入器一 OTLP JSON。今天只看了 span 的属性,还没看它外面那层包装:一个 OTLP JSON 文件里 span 是怎么按 resource 和 scope 嵌套的,时间为什么是一个十九位的字符串,ID 为什么要十六进制,整数为什么也是字符串。明天用官方的 JSON 文件出口把天气 Agent 的完整运行(含手打的 Agent 和工具 span)存成文件,写 `importers/otlp.py` 把它变成一个 Trace,今天的 `genai.py` 直接拿来用。
