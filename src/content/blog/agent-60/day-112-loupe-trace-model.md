---
title: 'Day 112 · Agent Loupe(一):trace 数据模型与三种导入器'
description: '定下 Run 和 Step 两个模型,读懂 OpenTelemetry GenAI 语义约定里的 gen_ai.* 属性,写出 OTLP JSON、Langfuse 导出、自研轻量 SDK 三个导入器,最后给 Day 9 的 Agent 加几行代码,产出第一条真实的 trace。'
pubDate: 2026-10-15
regime: none
tags: ['agent-loupe', 'opentelemetry', 'tracing', 'data-model', 'agent-60']
series: 'agent-60'
day: 112
lang: 'zh'
---

## 今天要解决的问题

调试器的地基是数据。今天定下来的两个模型,后面八天所有代码都要用,前端的类型、数据库的表、对比算法、重跑逻辑都建立在它上面。所以今天宁可慢,也要想清楚。学完你应该能:

1. 说出 `Run` 和 `Step` 每个字段为什么存在,以及为什么用 `idx` 而不是 span ID 做主键。
2. 读懂 OpenTelemetry GenAI 语义约定里一次模型调用、一次工具调用分别记哪些属性,消息为什么是 `parts` 结构。
3. 写出三个导入器,把 OTLP JSON、Langfuse 导出、自己的 JSONL 都转成同一种数据。
4. 写一个只用标准库的单文件 SDK,给 Day 9 的 Agent 加几行代码就能产出 trace。
5. 用 pytest 覆盖三个导入器的关键行为,包括「进程中途被杀」这种不完整的记录。

预计用时 5 到 6 小时。前置:Day 111 的仓库骨架;Day 6 的 pydantic;Day 9 的 `agent_loop.py`、`day09_demo.py`;Day 34 接 Langfuse 时见过的 trace 概念。

## 两个模型,先把字段一个个想清楚

先看代码,再逐个解释。

```python
# agent-loupe/server/loupe/models.py
from collections import Counter
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

StepKind = Literal["llm", "tool", "agent", "retrieval", "other"]


class Run(BaseModel):
    id: str
    name: str
    started_at: datetime
    ended_at: datetime
    status: Literal["ok", "error"] = "ok"
    model: str | None = None
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_cost_usd: float = 0.0
    tags: list[str] = Field(default_factory=list)
    parent_run_id: str | None = None  # 重跑出来的 run 指向原 run(Day 117 用)
    forked_from_step: int | None = None


class Step(BaseModel):
    run_id: str
    idx: int
    parent_idx: int | None = None
    kind: StepKind
    name: str
    started_at: datetime
    ended_at: datetime
    input: Any = None  # llm 步: {"messages": [...], "tools": [...]}
    output: Any = None  # llm 步: assistant 消息(content / tool_calls / reasoning_content)
    error: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    cost_usd: float | None = None
    model: str | None = None


class Trace(BaseModel):
    run: Run
    steps: list[Step]


def normalize(run: Run, steps: list[Step]) -> Trace:
    """三个导入器的公共收尾:按开始时间排序、重新编号、补齐 run 的汇总字段。"""
    steps = sorted(steps, key=lambda s: (s.started_at, s.idx))
    remap = {s.idx: i for i, s in enumerate(steps)}
    fixed = []
    for i, s in enumerate(steps):
        parent = remap.get(s.parent_idx) if s.parent_idx is not None else None
        fixed.append(s.model_copy(update={"idx": i, "parent_idx": parent, "run_id": run.id}))

    llm_models = [s.model for s in fixed if s.kind == "llm" and s.model]
    update: dict[str, Any] = {
        "total_input_tokens": run.total_input_tokens or sum(s.input_tokens or 0 for s in fixed),
        "total_output_tokens": run.total_output_tokens or sum(s.output_tokens or 0 for s in fixed),
        "total_cost_usd": run.total_cost_usd or round(sum(s.cost_usd or 0 for s in fixed), 6),
        "model": run.model or (Counter(llm_models).most_common(1)[0][0] if llm_models else None),
    }
    if fixed:
        update["started_at"] = min(run.started_at, fixed[0].started_at)
        update["ended_at"] = max(run.ended_at, max(s.ended_at for s in fixed))
    return Trace(run=run.model_copy(update=update), steps=fixed)
```

**为什么是两层,不是三层**。OpenTelemetry 的数据结构是 resource → scope → span 三层,Langfuse 是 session → trace → observation。对调试器来说,用户关心的单位只有两个:一次运行,和运行里的每一步。会话(多轮对话串起来)那一层,用 `tags` 就能表达,不值得再加一张表。层数越少,前端越简单。

**`idx` 而不是 span ID**。OTLP 的 spanId 是 16 位十六进制字符串,Langfuse 的 observation id 是 UUID,我们的 SDK 原本也可以生成随机 ID。但调试器里几乎所有操作都和「第几步」有关:时间轴的行号、对比时「第 7 步开始不一样」、重跑时「从第 5 步分叉」。所以导入时按开始时间排序,重新编号成 0、1、2……,`(run_id, idx)` 就是主键,`parent_idx` 也指向编号。原始 ID 丢了吗?需要的话可以放进 input 里,但到目前为止我没碰到需要它的场景。

这里有一个隐含的约定,后面好几处代码都依赖它:**父步骤的 idx 一定小于子步骤**。因为父步骤一定先开始。`normalize` 排序时用的是 `(started_at, idx)`,如果父子两步开始时间完全相同(时钟精度不够时会发生),原来的顺序保持不变,而三个导入器给的原始顺序都是父在前。Day 114 算树深度、Day 115 自底向上累加成本,都靠这个约定只扫一遍数组。

**`kind` 只有五种**。llm、tool、agent、retrieval、other。OpenTelemetry 的 `gen_ai.operation.name` 有二十来个取值,Langfuse 有十种 observation 类型,如果原样保留,前端每个地方都要处理一堆情况。调试器要回答的问题只需要区分:这是一次模型调用吗?是一次工具调用吗?是一个包着别的步骤的容器(agent)吗?是检索吗?其他的一律 other。分得越粗,前端越好写;不够用的时候再细分,反过来就难了。

**`input` 和 `output` 是 `Any`**。不同 kind 的输入输出长得完全不一样,工具的参数是一个字典,检索的输出是文档列表。只有 llm 步我们做了约定:input 是 `{"messages": [...], "tools": [...]}`,output 是一条 assistant 消息,格式统一成这门课从 Day 3 起一直用的 OpenAI 格式,包括 `tool_calls` 和 DeepSeek 的 `reasoning_content`。Day 115 渲染消息、Day 116 比较消息、Day 117 重建消息再发给模型,全都依赖这个约定。

**时间是带时区的 `datetime`**。三种来源的时间格式都不一样:OTLP 是纳秒整数,Langfuse 是带 Z 的 ISO 字符串,我们的 SDK 写的是 `+00:00` 结尾的 ISO 字符串。pydantic 会把字符串解析成 datetime,我们统一存 UTC。前端拿到 ISO 字符串,`new Date()` 直接能用。

**`Run` 的汇总字段由 `normalize` 补齐**。总 token、总成本、主要模型,能从步骤算出来的,导入器不用自己算。注意 `Run.ended_at` 是必填的:进程中途崩掉、没有记下结束时间的运行,导入器要自己想办法补,下面 SDK 导入器里会看到怎么补。

## OpenTelemetry 的 GenAI 语义约定

为什么要支持 OpenTelemetry?因为它是可观测领域的通用格式,各家 tracing 工具几乎都能导出它。你的调试器能读 OTLP,就能读别人用各种 SDK 产生的 trace,而不只是你自己的。

2026 年 10 月我去查规范时发现,GenAI 相关的约定已经从 OpenTelemetry 主仓库挪到了单独的 [semantic-conventions-genai 仓库](https://github.com/open-telemetry/semantic-conventions-genai),原来的页面写着不再维护。状态仍然是 **Development**,意思是还在变,字段名以后可能改。这也是为什么我们要做「导入时转换成自己的模型」:规范变了,只改一个导入器,其他代码不动。

一次模型调用(规范里叫 inference span)要点如下:

- span 名建议是 `{gen_ai.operation.name} {gen_ai.request.model}`,比如 `chat deepseek-flash`。
- `gen_ai.operation.name`:`chat`、`text_completion`、`generate_content` 都表示一次模型调用。
- `gen_ai.request.model` / `gen_ai.response.model`:请求的模型名和实际响应的模型名,后者可能带版本号。
- `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens`:token 数。
- `gen_ai.input.messages`、`gen_ai.output.messages`、`gen_ai.system_instructions`、`gen_ai.tool.definitions`:完整的消息内容、系统提示词和工具定义。这四个的要求级别是 **Opt-In**,默认不记录,因为里面可能有用户隐私。所以你从别人那里拿到的 OTLP trace,很可能只有 token 数没有消息内容,导入器必须能处理缺失。

一次工具调用的 span 名建议是 `execute_tool {gen_ai.tool.name}`,参数和结果在 `gen_ai.tool.call.arguments`、`gen_ai.tool.call.result`,同样是 Opt-In。Agent 层面的操作有 `invoke_agent`、`create_agent`、`invoke_workflow`。

最需要注意的是消息格式。它不是 OpenAI 的 `{"role", "content", "tool_calls"}`,而是这样的:

```json
[
  {"role": "assistant",
   "parts": [
     {"type": "tool_call", "id": "call_VSPy...", "name": "get_weather", "arguments": {"location": "Paris"}}
   ]}
]
```

每条消息由若干 part 组成,part 的类型有 `text`、`tool_call`、`tool_call_response`、`reasoning` 等。这种设计比 OpenAI 格式更通用,能同时表达 Anthropic 那种一条消息里混着文字和工具调用的情况。我们的导入器把它转回 OpenAI 格式:`text` 拼成 content,`tool_call` 变成 `tool_calls`(注意 arguments 要转成字符串,OpenAI 格式里它是字符串),`tool_call_response` 变成 `role: tool` 的消息,`reasoning` 变成 `reasoning_content`。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="三种 trace 格式经过各自的导入器,汇入统一的 Run 和 Step 模型">
  <rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)" rx="6"/>
  <rect x="20" y="30" width="190" height="80" fill="none" stroke="var(--rule)"/>
  <text x="115" y="52" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">OTLP JSON</text>
  <text x="30" y="74" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">resourceSpans/scopeSpans</text>
  <text x="30" y="92" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">spanId · parentSpanId</text>
  <text x="30" y="104" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">gen_ai.* · 纳秒时间</text>
  <rect x="20" y="125" width="190" height="80" fill="none" stroke="var(--rule)"/>
  <text x="115" y="147" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Langfuse 导出</text>
  <text x="30" y="169" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">observations[]</text>
  <text x="30" y="187" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">parentObservationId</text>
  <text x="30" y="199" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">type=GENERATION/TOOL…</text>
  <rect x="20" y="220" width="190" height="80" fill="none" stroke="var(--rule)"/>
  <text x="115" y="242" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">loupe_sdk JSONL</text>
  <text x="30" y="264" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">run_start / step / run_end</text>
  <text x="30" y="282" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">一行一条,追加写</text>
  <line x1="210" y1="70" x2="290" y2="150" stroke="var(--compute)" marker-end="url(#a112)"/>
  <line x1="210" y1="165" x2="290" y2="165" stroke="var(--compute)" marker-end="url(#a112)"/>
  <line x1="210" y1="260" x2="290" y2="180" stroke="var(--compute)" marker-end="url(#a112)"/>
  <rect x="290" y="130" width="120" height="70" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="350" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">normalize()</text>
  <text x="350" y="180" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">排序 · 编号 · 汇总</text>
  <line x1="410" y1="165" x2="450" y2="165" stroke="var(--ink-soft)" marker-end="url(#a112)"/>
  <rect x="450" y="80" width="170" height="170" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="535" y="102" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">Trace</text>
  <text x="462" y="126" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">Run: id, name, 时间</text>
  <text x="462" y="144" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">  status, tokens, cost</text>
  <text x="462" y="170" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">Step[]: idx, parent_idx</text>
  <text x="462" y="188" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">  kind, name, 时间</text>
  <text x="462" y="206" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">  input, output, error</text>
  <text x="462" y="224" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">  tokens, cost, model</text>
  <text x="320" y="318" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">差异全部消化在导入器里,后面的代码只认右边这一种</text>
  <defs><marker id="a112" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>三种格式在父子关系、时间格式、消息格式上都不一样,统一在导入时做完。规范变了只改一个导入器。</figcaption>
</figure>

## 导入器一:OTLP JSON

```python
# agent-loupe/server/loupe/importers/otlp.py
"""导入 OTLP JSON(ExportTraceServiceRequest),按 OpenTelemetry GenAI 语义约定读 gen_ai.* 属性。"""
import json
from datetime import datetime, timezone
from typing import Any

from loupe.models import Run, Step, StepKind, Trace, normalize

KIND_BY_OPERATION: dict[str, StepKind] = {
    "chat": "llm", "text_completion": "llm", "generate_content": "llm",
    "execute_tool": "tool",
    "invoke_agent": "agent", "create_agent": "agent", "invoke_workflow": "agent",
    "embeddings": "retrieval", "retrieval": "retrieval",
}


def _value(v: dict) -> Any:
    """OTLP 的 AnyValue → Python 值。"""
    if "stringValue" in v:
        s = v["stringValue"]
        if s[:1] in "[{":  # 消息、工具定义这类结构化属性,很多 SDK 是序列化成 JSON 字符串放进来的
            try:
                return json.loads(s)
            except json.JSONDecodeError:
                return s
        return s
    if "intValue" in v:
        return int(v["intValue"])  # OTLP JSON 里 int64 是字符串
    if "doubleValue" in v:
        return float(v["doubleValue"])
    if "boolValue" in v:
        return bool(v["boolValue"])
    if "arrayValue" in v:
        return [_value(x) for x in v["arrayValue"].get("values", [])]
    if "kvlistValue" in v:
        return {kv["key"]: _value(kv["value"]) for kv in v["kvlistValue"].get("values", [])}
    return None


def _attrs(span: dict) -> dict[str, Any]:
    return {a["key"]: _value(a.get("value", {})) for a in span.get("attributes", [])}


def _ts(nanos: str | int) -> datetime:
    return datetime.fromtimestamp(int(nanos) / 1e9, tz=timezone.utc)


def _as_text(x: Any) -> str:
    return x if isinstance(x, str) else json.dumps(x, ensure_ascii=False)


def parts_to_openai(messages: list[dict] | None) -> list[dict]:
    """GenAI 约定的 {role, parts:[...]} → 全课统一用的 OpenAI 消息格式。"""
    out: list[dict] = []
    for m in messages or []:
        parts = m.get("parts", [])
        responses = [p for p in parts if p.get("type") == "tool_call_response"]
        if responses:  # 工具结果:一个 part 对应一条 role=tool 消息
            out += [{"role": "tool", "tool_call_id": p.get("id"), "content": _as_text(p.get("response"))}
                    for p in responses]
            continue
        texts = [p.get("content", "") for p in parts if p.get("type") == "text"]
        msg: dict[str, Any] = {"role": m.get("role", "user"), "content": "\n".join(texts) if texts else None}
        calls = [p for p in parts if p.get("type") == "tool_call"]
        if calls:
            msg["tool_calls"] = [{"id": c.get("id"), "type": "function",
                                  "function": {"name": c.get("name"), "arguments": _as_text(c.get("arguments", {}))}}
                                 for c in calls]
        reasoning = [p.get("content", "") for p in parts if p.get("type") == "reasoning"]
        if reasoning:
            msg["reasoning_content"] = "\n".join(reasoning)
        out.append(msg)
    return out


def _span_to_step(span: dict, a: dict[str, Any]) -> Step:
    op = a.get("gen_ai.operation.name", "")
    kind: StepKind = KIND_BY_OPERATION.get(op, "other")
    status = span.get("status", {})
    failed = status.get("code") in (2, "STATUS_CODE_ERROR")
    common = dict(run_id="", idx=0, kind=kind, name=span.get("name", op or "span"),
                  started_at=_ts(span["startTimeUnixNano"]), ended_at=_ts(span["endTimeUnixNano"]),
                  error=(status.get("message") or "error") if failed else None)
    if kind == "llm":
        messages = parts_to_openai(a.get("gen_ai.input.messages"))
        system = a.get("gen_ai.system_instructions")
        if system:
            text = "\n".join(p.get("content", "") for p in system if isinstance(p, dict))
            messages.insert(0, {"role": "system", "content": text})
        outputs = parts_to_openai(a.get("gen_ai.output.messages"))
        return Step(**common, input={"messages": messages, "tools": a.get("gen_ai.tool.definitions")},
                    output=outputs[0] if outputs else None,
                    model=a.get("gen_ai.response.model") or a.get("gen_ai.request.model"),
                    input_tokens=a.get("gen_ai.usage.input_tokens"),
                    output_tokens=a.get("gen_ai.usage.output_tokens"))
    if kind == "tool":
        return Step(**common, input=a.get("gen_ai.tool.call.arguments"), output=a.get("gen_ai.tool.call.result"))
    return Step(**common, input=a.get("gen_ai.retrieval.query.text"), output=a.get("gen_ai.retrieval.documents"))


def import_otlp(doc: dict) -> list[Trace]:
    spans_by_trace: dict[str, list[dict]] = {}
    for rs in doc.get("resourceSpans", []):
        for ss in rs.get("scopeSpans", []):
            for span in ss.get("spans", []):
                spans_by_trace.setdefault(span["traceId"], []).append(span)

    traces = []
    for trace_id, spans in spans_by_trace.items():
        spans.sort(key=lambda s: int(s["startTimeUnixNano"]))
        index_of = {s["spanId"]: i for i, s in enumerate(spans)}
        steps = []
        for i, span in enumerate(spans):
            step = _span_to_step(span, _attrs(span))
            steps.append(step.model_copy(update={"idx": i, "parent_idx": index_of.get(span.get("parentSpanId", ""))}))
        root = next((s for s in steps if s.parent_idx is None), steps[0])
        run = Run(id=trace_id, name=root.name, started_at=root.started_at, ended_at=root.ended_at,
                  status="error" if any(s.error for s in steps) else "ok", tags=["otlp"])
        traces.append(normalize(run, steps))
    return traces
```

几个容易踩的坑,都写在注释里了,再展开说两句。

`_value` 处理 OTLP 的 AnyValue。JSON 编码的 OTLP 里,64 位整数是**字符串**(`"intValue": "120"`),因为 JavaScript 的 number 装不下 64 位整数。不转 `int` 的话,后面累加 token 时会变成字符串拼接,`"120" + "18"` 得到 `"12018"`,一个不报错但完全错误的数字。

`gen_ai.input.messages` 这种结构化属性,规范里类型写的是 any,但 OTLP 的属性值里放复杂结构很麻烦,很多 SDK 的做法是序列化成 JSON 字符串塞进 `stringValue`。所以 `_value` 看到以 `[` 或 `{` 开头的字符串会试着解析,解析不了就原样保留。

一个 trace(同一个 `traceId`)对应一个 Run。根 span 就是没有父节点、或者父节点不在这批数据里的那个(trace 被截断时会出现后一种情况)。状态码在 JSON 里可能是数字 `2`,也可能是字符串 `"STATUS_CODE_ERROR"`,取决于导出工具,两种都认。

## 导入器二:Langfuse 导出

```python
# agent-loupe/server/loupe/importers/langfuse.py
"""导入 Langfuse 公开 API 拿到的数据:
- GET /api/public/traces/{id} 的返回(一个带 observations 数组的 trace 对象)
- GET /api/public/v2/observations 的返回({"data": [...]})
- 或者直接一个 observation 数组
"""
from typing import Any

from loupe.models import Run, Step, StepKind, Trace, normalize

KIND_BY_TYPE: dict[str, StepKind] = {
    "GENERATION": "llm", "TOOL": "tool", "AGENT": "agent",
    "RETRIEVER": "retrieval", "EMBEDDING": "retrieval",
}


def _usage(obs: dict, key: str) -> int | None:
    for field in ("usageDetails", "usage"):  # 新字段 usageDetails,老版本是 usage
        val = (obs.get(field) or {}).get(key)
        if val is not None:
            return int(val)
    return None


def _cost(obs: dict) -> float | None:
    for val in (obs.get("totalCost"), obs.get("calculatedTotalCost"), (obs.get("costDetails") or {}).get("total")):
        if val is not None:
            return float(val)
    return None


def _llm_input(raw: Any) -> Any:
    # OpenAI 集成记下来的 input 一般就是 messages 数组,统一包成 {"messages": ...}
    if isinstance(raw, list):
        return {"messages": raw, "tools": None}
    return raw


def import_langfuse(doc: Any) -> list[Trace]:
    if isinstance(doc, dict) and "observations" in doc:
        observations, trace_meta = doc["observations"], {doc.get("id"): doc}
    elif isinstance(doc, dict) and "data" in doc:
        observations, trace_meta = doc["data"], {}
    else:
        observations, trace_meta = list(doc), {}

    by_trace: dict[str, list[dict]] = {}
    for obs in observations:
        by_trace.setdefault(obs["traceId"], []).append(obs)

    traces = []
    for trace_id, obs_list in by_trace.items():
        obs_list.sort(key=lambda o: o["startTime"])
        index_of = {o["id"]: i for i, o in enumerate(obs_list)}
        steps = []
        for i, o in enumerate(obs_list):
            kind = KIND_BY_TYPE.get(str(o.get("type", "")).upper(), "other")
            steps.append(Step(
                run_id=trace_id, idx=i, parent_idx=index_of.get(o.get("parentObservationId") or ""),
                kind=kind, name=o.get("name") or kind,
                started_at=o["startTime"], ended_at=o.get("endTime") or o["startTime"],
                input=_llm_input(o.get("input")) if kind == "llm" else o.get("input"),
                output=o.get("output"),
                error=(o.get("statusMessage") or "error") if o.get("level") == "ERROR" else None,
                input_tokens=_usage(o, "input"), output_tokens=_usage(o, "output"),
                cost_usd=_cost(o), model=o.get("model"),
            ))
        meta = trace_meta.get(trace_id, {})
        run = Run(id=trace_id, name=meta.get("name") or steps[0].name,
                  started_at=steps[0].started_at, ended_at=max(s.ended_at for s in steps),
                  status="error" if any(s.error for s in steps) else "ok",
                  tags=list(meta.get("tags") or []) + ["langfuse"])
        traces.append(normalize(run, steps))
    return traces
```

Langfuse 的数据从它的[公开 API](https://langfuse.com/docs/api-and-data-platform/features/public-api)拿。单条 trace 的详情接口返回一个带 `observations` 数组的对象;新的 v2 observations 接口返回 `{"data": [...]}`。我对照了 2026 年 10 月它的 OpenAPI 定义,observation 上和我们相关的字段是 `id`、`traceId`、`parentObservationId`、`type`、`name`、`startTime`、`endTime`、`level`、`statusMessage`、`input`、`output`、`model`、`usageDetails`、`totalCost`。老版本的数据里用量和成本叫 `usage`、`calculatedTotalCost`,所以 `_usage` 和 `_cost` 都按「新字段优先,老字段兜底」来取。

`type` 的映射:`GENERATION` 是模型调用,`TOOL` 是工具,`AGENT` 是 Agent,`RETRIEVER` 和 `EMBEDDING` 归到 retrieval,`SPAN`、`CHAIN`、`EVENT`、`EVALUATOR`、`GUARDRAIL` 都归 other。Langfuse 判断错误的方式是 `level == "ERROR"`,错误信息在 `statusMessage`。

注意测试里我故意把 observations 的顺序打乱了。API 返回的顺序并不保证是时间顺序,导入器必须自己排。

## 导入器三:自研轻量 SDK

为什么还要自己写一个 SDK?Langfuse 和 OpenTelemetry 的 SDK 都很完整,但对「给 Day 9 那 100 行代码加个记录」这件事来说太重了:要起服务、配 key、装依赖。我们要的是一个单文件、只用标准库、复制过去就能用的东西,而且它记下来的东西必须足够 Day 117 重跑用,也就是每次模型调用的**完整** messages 和 tools。

```python
# agent-loupe/server/loupe_sdk.py
"""Agent Loupe 轻量 SDK:单文件、只用标准库,把一次 Agent 运行写成 JSONL。

用法:
    import loupe_sdk as loupe
    loupe.wrap_openai(client)                 # 每次 chat.completions.create 自动记一个 llm 步
    @loupe.trace_step(kind="tool")            # 普通函数记成 tool 步
    def get_weather(city): ...
    with loupe.run("weather-demo", out="runs.jsonl", tags=["demo"]):
        agent.run("...")
"""
import contextvars
import functools
import json
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

_current: contextvars.ContextVar["_Run | None"] = contextvars.ContextVar("loupe_run", default=None)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _snapshot(obj: Any) -> Any:
    """深拷贝成纯 JSON。Agent 之后还会往 messages 里 append,不拷贝的话记下来的就不是当时的样子。"""
    return json.loads(json.dumps(obj, ensure_ascii=False, default=str))


class _Run:
    def __init__(self, name: str, out: str, tags: list[str]):
        self.id = uuid.uuid4().hex[:12]
        self.name = name
        self.path = Path(out)
        self.tags = tags
        self.status = "ok"
        self.next_idx = 0
        self.stack: list[int] = []  # 正在进行中的步骤,栈顶就是新步骤的父步骤

    def write(self, record: dict) -> None:
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")


@contextmanager
def run(name: str, out: str = "runs.jsonl", tags: list[str] | None = None) -> Iterator[_Run]:
    r = _Run(name, out, tags or [])
    token = _current.set(r)
    r.write({"type": "run_start", "id": r.id, "name": name, "started_at": _now(), "tags": r.tags})
    try:
        yield r
    except Exception:
        r.status = "error"
        raise
    finally:
        r.write({"type": "run_end", "id": r.id, "ended_at": _now(), "status": r.status})
        _current.reset(token)


@contextmanager
def step(kind: str, name: str, input: Any = None, **extra: Any) -> Iterator[dict]:
    r = _current.get()
    if r is None:  # 没有包在 run() 里:什么都不记,也不影响业务代码
        yield {}
        return
    idx = r.next_idx
    r.next_idx += 1
    rec: dict[str, Any] = {
        "type": "step", "run_id": r.id, "idx": idx,
        "parent_idx": r.stack[-1] if r.stack else None,
        "kind": kind, "name": name, "started_at": _now(), "input": _snapshot(input), **extra,
    }
    r.stack.append(idx)
    try:
        yield rec  # 调用方把 output、token 等写进 rec
    except Exception as e:
        rec["error"] = f"{type(e).__name__}: {e}"
        raise
    finally:
        r.stack.pop()
        rec["ended_at"] = _now()
        rec["output"] = _snapshot(rec.get("output"))
        r.write(rec)


def trace_step(kind: str = "tool", name: str | None = None) -> Callable:
    def deco(fn: Callable) -> Callable:
        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            with step(kind, name or fn.__name__, input={"args": list(args), "kwargs": kwargs}) as rec:
                out = fn(*args, **kwargs)
                rec["output"] = out
                return out
        return wrapper
    return deco


def wrap_openai(client: Any) -> Any:
    """给 openai.OpenAI 实例打补丁:每次 chat.completions.create 记一个 llm 步。只支持非流式。"""
    create = client.chat.completions.create

    @functools.wraps(create)
    def traced(**kwargs: Any) -> Any:
        model = kwargs.get("model")
        inp = {"messages": kwargs.get("messages"), "tools": kwargs.get("tools")}
        with step("llm", f"chat {model}", input=inp, model=model) as rec:
            resp = create(**kwargs)
            msg = resp.choices[0].message
            out: dict[str, Any] = {"role": "assistant", "content": msg.content}
            if msg.tool_calls:
                out["tool_calls"] = [tc.model_dump() for tc in msg.tool_calls]
            reasoning = getattr(msg, "reasoning_content", None)
            if reasoning:
                out["reasoning_content"] = reasoning
            rec["output"] = out
            if resp.usage:
                rec["input_tokens"] = resp.usage.prompt_tokens
                rec["output_tokens"] = resp.usage.completion_tokens
            return resp

    client.chat.completions.create = traced
    return client
```

挑几个设计说一下。

**JSONL,一行一条,追加写**。每完成一步就往文件末尾追加一行,而不是等整个运行结束再写一个大 JSON。好处是进程中途崩溃时,已经完成的步骤都在文件里。代价是 `run_end` 可能没写上,所以导入器要能处理没有 `run_end` 的运行:结束时间取最后一步的结束时间,状态记为 error。这个情况我专门写了测试。

**步骤结束时才写,但 idx 在开始时分配**。嵌套的步骤(agent 包着 llm 和 tool)里,子步骤先结束、先写进文件,父步骤后写。所以文件里的顺序不是 idx 顺序,导入器要按 idx 排序。idx 在开始时分配,保证了「父步骤的 idx 小于子步骤」这个约定。

**`_snapshot` 深拷贝**。这里非常容易踩坑。`wrap_openai` 记下 `kwargs["messages"]`,但 Agent 的循环之后会继续往同一个 messages 列表里 append。如果只存引用,等这一步结束写文件时,记下的已经是后面追加过的列表了,每一步的 input 看起来都一样长,而且都包含了「未来」的消息。用 JSON 序列化再反序列化做一次深拷贝,顺带把 pydantic 对象这类不能直接 JSON 化的东西转成字符串。

**`contextvars` 而不是全局变量**。当前是哪个 run、栈上有哪些进行中的步骤,存在 ContextVar 里。普通全局变量在多线程或 asyncio 里会串;ContextVar 在每个线程、每个 asyncio 任务里各有一份。不过要说清楚,目前 `_Run.stack` 本身是普通列表,如果你在同一个 run 里用 `asyncio.gather` 并发跑几个工具,它们会共享这个栈,父子关系可能记错。这是已知限制,写进 README,Day 117 之前我们的 Agent 都是顺序执行的。

**没包在 `run()` 里时什么都不做**。`step()` 发现没有当前 run 就直接 yield 一个空字典。这样你可以把 `@trace_step` 留在业务代码里,不开 trace 时它几乎没有开销,也不会报错。

**`wrap_openai` 只支持非流式**。流式响应需要边收边拼,复杂度高一截,我们的 Agent 也没有用流式。这也是一个写进 README 的限制。

## 统一入口:自动识别格式

```python
# agent-loupe/server/loupe/importers/__init__.py
import json

from loupe.models import Trace

from .langfuse import import_langfuse
from .otlp import import_otlp
from .sdk_jsonl import import_sdk_jsonl


def detect_format(text: str) -> str:
    head = text.lstrip()[:1]
    if head == "{" and '"run_start"' in text.split("\n", 1)[0]:
        return "sdk"  # JSONL 的第一行就是 run_start
    try:
        doc = json.loads(text)
    except json.JSONDecodeError:
        return "sdk"  # 整体不是一个 JSON,按 JSONL 处理
    if isinstance(doc, dict) and "resourceSpans" in doc:
        return "otlp"
    if isinstance(doc, list) or (isinstance(doc, dict) and ("observations" in doc or "data" in doc)):
        return "langfuse"
    raise ValueError("认不出格式:支持 OTLP JSON、Langfuse 导出、loupe_sdk 的 JSONL")


def import_any(text: str) -> list[Trace]:
    fmt = detect_format(text)
    if fmt == "otlp":
        return import_otlp(json.loads(text))
    if fmt == "langfuse":
        return import_langfuse(json.loads(text))
    return import_sdk_jsonl(text)
```

识别规则很朴素:第一行是 `run_start` 的就是我们的 JSONL;整体能解析成 JSON 的,有 `resourceSpans` 是 OTLP,有 `observations` 或 `data` 或者本身是数组的当成 Langfuse;都不是就报一个说人话的错。Day 113 的上传接口直接调 `import_any`,用户不用选格式。

## 给 Day 9 的 Agent 加上记录

现在产出第一条真实的 trace。把 `server/loupe_sdk.py` 复制到 `agent-60-lab/w2/`,在同一个目录下新建:

```python
# agent-60-lab/w2/day112_traced.py
"""给 Day 9 的 Agent 加上 Agent Loupe 记录,跑一次,产出 runs.jsonl。"""
import json

from dotenv import load_dotenv

import loupe_sdk as loupe
from agent_loop import Agent
from day09_demo import WORKSPACE, reg

# 工具层:包一层 reg.call,每次工具执行记成一个 tool 步
_raw_call = reg.call


def traced_call(name: str, arguments: str) -> str:
    with loupe.step("tool", name, input=json.loads(arguments or "{}")) as rec:
        out = _raw_call(name, arguments)
        result = json.loads(out)
        rec["output"] = result
        if isinstance(result, dict) and "error" in result:
            rec["error"] = str(result["error"])  # 工具报错不抛异常(Day 9 的设计),但要在 trace 里标红
        return out


reg.call = traced_call

if __name__ == "__main__":
    load_dotenv()  # Agent 在构造时读 LLM_* 环境变量,所以要在创建 Agent 之前加载
    WORKSPACE.mkdir(exist_ok=True)
    (WORKSPACE / "cities.txt").write_text("这次出差要去的城市:\n- 杭州\n- 成都\n- 哈尔滨\n", encoding="utf-8")
    agent = Agent(reg, system="你是一个做事很仔细的中文助手。需要外部信息时调用工具;算术一律用 calculate。")
    loupe.wrap_openai(agent.client)  # 模型层:每次请求记成一个 llm 步
    with loupe.run("day09-cities", out="runs.jsonl", tags=["day09", "deepseek"]):
        with loupe.step("agent", "agent.run", input="读一下 cities.txt…") as rec:
            rec["output"] = agent.run("读一下 cities.txt,查这几个城市现在的气温,告诉我平均气温和最冷的是哪个。")
    print("已写入 runs.jsonl")
```

改动只在两个地方:模型层用 `wrap_openai` 打补丁,工具层把 `reg.call` 包一层。`agent_loop.py` 和 `day09_demo.py` 一行都没动。这是一个值得记住的思路:可观测的代码应该从外面套上去,不应该散落在业务逻辑里。

工具报错时 Day 9 的注册表不抛异常,而是返回 `{"error": ...}` 交给模型。对 Agent 来说这是对的,但对调试器来说,这一步应该被标成红色。所以 `traced_call` 检查返回值,有 error 字段就写进 step 的 `error`。

```bash
cd agent-60-lab/w2
cp ../../agent-loupe/server/loupe_sdk.py .   # 按你的实际路径
uv run python day112_traced.py
```

我跑的那一次,终端输出是 Day 9 原来的日志:

```text
[step 1] 调用 read_file({"path": "cities.txt"})
           结果 {"path": "cities.txt", "content": "这次出差要去的城市:\n- 杭州\n- 成都\n- 哈尔滨\n"}
[step 2] 调用 get_weather({"city": "杭州", "unit": "celsius"})
           结果 {"city": "杭州", "country": "中国", "temperature": 19.6, "unit": "celsius", "weather": "阴", "wind_kmh": 3.9}
[step 2] 调用 get_weather({"city": "成都", "unit": "celsius"})
           结果 {"city": "成都", "country": "中国", "temperature": 19.8, "unit": "celsius", "weather": "阴", "wind_kmh": 2.6}
[step 2] 调用 get_weather({"city": "哈尔滨", "unit": "celsius"})
           结果 {"city": "哈尔滨", "country": "中国", "temperature": 6.1, "unit": "celsius", "weather": "阴", "wind_kmh": 1.0}
[step 3] 调用 calculate({"expression": "(19.6+19.8+6.1)/3"})
           结果 {"expression": "(19.6+19.8+6.1)/3", "result": 15.16666666666667}
[step 4] 完成 (2.0s)
已写入 runs.jsonl
```

`runs.jsonl` 一共 12 行:一行 `run_start`、10 个步骤、一行 `run_end`。把它复制到 `agent-loupe/samples/day09_cities.jsonl`,在 `server/` 目录下用导入器读一遍:

```bash
uv run python -c "
from loupe.importers import import_any
[t] = import_any(open('../samples/day09_cities.jsonl').read())
print(t.run.status, t.run.model, t.run.total_input_tokens, t.run.total_output_tokens)
for s in t.steps:
    print(s.idx, s.parent_idx, s.kind, s.name, s.input_tokens, round((s.ended_at - s.started_at).total_seconds(), 1))
"
```

我这次的结果:

```text
ok deepseek-flash 3275 509
0 None agent agent.run None 24.1
1 0 llm chat deepseek-flash 542 2.0
2 0 tool read_file None 0.0
3 0 llm chat deepseek-flash 639 1.7
4 0 tool get_weather None 5.0
5 0 tool get_weather None 5.3
6 0 tool get_weather None 5.6
7 0 llm chat deepseek-flash 977 2.4
8 0 tool calculate None 0.0
9 0 llm chat deepseek-flash 1117 2.0
```

Day 111 说的那个发现就在这里:三次 `get_weather` 各要五秒多,一个接一个,占了总时长的三分之二。还能看到输入 token 从 542 涨到 1117,每一轮都在把整个历史重发一遍。你跑出来的数字会不一样,天气接口的延迟和网络关系很大,重要的是结构对得上。

## 再造一点假数据

真实 trace 只有 10 步,不够测性能。写一个造数脚本,生成任意步数的合成 trace,格式和 SDK 写出来的完全一样:

```python
# agent-loupe/samples/gen_synthetic.py
"""造合成 trace(loupe_sdk 的 JSONL 格式),不调任何 API。

    python samples/gen_synthetic.py --steps 30 --out samples/synthetic_small.jsonl
    python samples/gen_synthetic.py --steps 10000 --out samples/synthetic_10k.jsonl

内容是假的(城市、温度都是随机数),只用来测界面和性能,不代表任何模型的真实行为。
"""
import argparse
import json
import random
from datetime import datetime, timedelta, timezone

CITIES = ["北京", "上海", "广州", "深圳", "杭州", "成都", "武汉", "西安", "哈尔滨", "昆明"]
SYSTEM = "你是一个做事很仔细的中文助手。需要外部信息时调用工具;算术一律用 calculate。"


def make_run(run_id: str, target_steps: int, seed: int = 7) -> list[dict]:
    rnd = random.Random(seed)
    t = datetime(2026, 10, 15, 2, 0, tzinfo=timezone.utc)
    recs: list[dict] = [{"type": "run_start", "id": run_id, "name": f"synthetic-{target_steps}",
                         "started_at": t.isoformat(), "tags": ["synthetic"]}]
    messages: list[dict] = [{"role": "system", "content": SYSTEM},
                            {"role": "user", "content": "把这几个城市的气温都查一遍,算平均值。"}]
    idx = 0
    # 根步骤:整个 agent 的运行
    root = {"type": "step", "run_id": run_id, "idx": 0, "parent_idx": None, "kind": "agent",
            "name": "agent.run", "started_at": t.isoformat(), "input": messages[1]["content"]}
    idx = 1
    while idx < target_steps:
        # 一轮 LLM:输入是当时完整的 messages(这就是上下文越来越长的原因)
        dur = timedelta(milliseconds=rnd.randint(600, 2500))
        n_calls = rnd.randint(1, 3)
        calls = [{"id": f"call_{idx}_{k}", "type": "function",
                  "function": {"name": "get_weather", "arguments": json.dumps({"city": rnd.choice(CITIES)}, ensure_ascii=False)}}
                 for k in range(n_calls)]
        in_tok = sum(len(json.dumps(m, ensure_ascii=False)) for m in messages) // 2
        out_msg = {"role": "assistant", "content": None, "tool_calls": calls}
        recs.append({"type": "step", "run_id": run_id, "idx": idx, "parent_idx": 0, "kind": "llm",
                     "name": "chat deepseek-flash", "model": "deepseek-flash",
                     "started_at": t.isoformat(), "ended_at": (t + dur).isoformat(),
                     "input": {"messages": list(messages)}, "output": out_msg,
                     "input_tokens": in_tok, "output_tokens": 20 * n_calls + rnd.randint(5, 40)})
        messages.append(out_msg)
        t += dur
        idx += 1
        for c in calls:
            if idx >= target_steps:
                break
            tdur = timedelta(milliseconds=rnd.randint(80, 900))
            failed = rnd.random() < 0.03
            result = {"error": "ConnectTimeout"} if failed else {"temperature": round(rnd.uniform(-5, 30), 1)}
            recs.append({"type": "step", "run_id": run_id, "idx": idx, "parent_idx": 0, "kind": "tool",
                         "name": "get_weather", "started_at": t.isoformat(), "ended_at": (t + tdur).isoformat(),
                         "input": json.loads(c["function"]["arguments"]), "output": result,
                         **({"error": "ConnectTimeout"} if failed else {})})
            messages.append({"role": "tool", "tool_call_id": c["id"], "content": json.dumps(result, ensure_ascii=False)})
            t += tdur
            idx += 1
        if len(messages) > 40:  # 太长了就只保留最近的,模拟上下文截断,不然 10k 步的文件会有几个 GB
            messages = messages[:2] + messages[-20:]
    root["ended_at"] = t.isoformat()
    root["output"] = "完成"
    recs.insert(1, root)
    recs.append({"type": "run_end", "id": run_id, "ended_at": t.isoformat(), "status": "ok"})
    return recs


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=30)
    ap.add_argument("--out", default="samples/synthetic_small.jsonl")
    args = ap.parse_args()
    recs = make_run(f"syn{args.steps}", args.steps)
    with open(args.out, "w", encoding="utf-8") as f:
        for r in recs:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"写入 {args.out}: {sum(r['type'] == 'step' for r in recs)} 个步骤")
```

```bash
cd agent-loupe
python3 samples/gen_synthetic.py --steps 30 --out samples/synthetic_small.jsonl
python3 samples/gen_synthetic.py --steps 10000 --out samples/synthetic_10k.jsonl
```

它不依赖任何第三方包,系统自带的 Python 就能跑。1 万步的文件在我这里是 19 MB 左右。注意脚本里有一段「超过 40 条消息就截断」:真实的 Agent 不会跑一万步而不截断上下文,不截的话每一步都带着前面所有消息,文件会大到几个 GB。合成数据里的温度和城市都是随机的,只用来测界面和性能,文件开头的注释里也写明了。

## 动手练习

**练习 1:把上面的代码放进仓库,跑通测试。** 测试文件 `server/tests/test_importers.py`:

```python
# agent-loupe/server/tests/test_importers.py
import json
from pathlib import Path

import pytest

import loupe_sdk as loupe
from loupe.importers import detect_format, import_any

SAMPLES = Path(__file__).parents[2] / "samples"


def _s(key, val):
    return {"key": key, "value": {"stringValue": val}}


def _i(key, val):
    return {"key": key, "value": {"intValue": str(val)}}


OTLP = {"resourceSpans": [{"scopeSpans": [{"spans": [
    {"traceId": "t1", "spanId": "a", "name": "invoke_agent weather",
     "startTimeUnixNano": "1760493600000000000", "endTimeUnixNano": "1760493603000000000",
     "attributes": [_s("gen_ai.operation.name", "invoke_agent")]},
    {"traceId": "t1", "spanId": "b", "parentSpanId": "a", "name": "chat deepseek-flash",
     "startTimeUnixNano": "1760493600100000000", "endTimeUnixNano": "1760493601000000000",
     "attributes": [
         _s("gen_ai.operation.name", "chat"), _s("gen_ai.request.model", "deepseek-flash"),
         _i("gen_ai.usage.input_tokens", 120), _i("gen_ai.usage.output_tokens", 18),
         _s("gen_ai.input.messages", json.dumps([{"role": "user", "parts": [{"type": "text", "content": "北京多少度"}]}])),
         _s("gen_ai.output.messages", json.dumps([{"role": "assistant", "parts": [
             {"type": "tool_call", "id": "c1", "name": "get_weather", "arguments": {"city": "北京"}}]}])),
     ]},
    {"traceId": "t1", "spanId": "c", "parentSpanId": "a", "name": "execute_tool get_weather",
     "startTimeUnixNano": "1760493601100000000", "endTimeUnixNano": "1760493601500000000",
     "status": {"code": 2, "message": "ConnectTimeout"},
     "attributes": [_s("gen_ai.operation.name", "execute_tool"), _s("gen_ai.tool.call.arguments", '{"city": "北京"}')]},
]}]}]}

LANGFUSE = {"id": "lf1", "name": "weather-demo", "tags": ["prod"], "observations": [
    {"id": "o2", "traceId": "lf1", "type": "GENERATION", "name": "chat", "parentObservationId": "o1",
     "startTime": "2026-10-15T02:00:01Z", "endTime": "2026-10-15T02:00:02Z", "model": "deepseek-flash",
     "input": [{"role": "user", "content": "北京多少度"}], "output": {"role": "assistant", "content": "22 度"},
     "usageDetails": {"input": 50, "output": 6}, "totalCost": 0.00002},
    {"id": "o1", "traceId": "lf1", "type": "AGENT", "name": "agent", "parentObservationId": None,
     "startTime": "2026-10-15T02:00:00Z", "endTime": "2026-10-15T02:00:03Z"},
]}


def test_otlp_maps_kinds_parents_and_messages():
    [trace] = import_any(json.dumps(OTLP))
    kinds = [s.kind for s in trace.steps]
    assert kinds == ["agent", "llm", "tool"]
    assert [s.parent_idx for s in trace.steps] == [None, 0, 0]
    llm = trace.steps[1]
    assert llm.input["messages"] == [{"role": "user", "content": "北京多少度"}]
    assert llm.output["tool_calls"][0]["function"]["arguments"] == '{"city": "北京"}'
    assert trace.steps[2].error == "ConnectTimeout"
    assert trace.run.status == "error"
    assert (trace.run.total_input_tokens, trace.run.model) == (120, "deepseek-flash")


def test_langfuse_sorts_by_time_and_keeps_cost():
    [trace] = import_any(json.dumps(LANGFUSE))
    assert [s.name for s in trace.steps] == ["agent", "chat"]  # 输入里顺序是乱的
    assert trace.steps[1].parent_idx == 0
    assert trace.steps[1].input == {"messages": [{"role": "user", "content": "北京多少度"}], "tools": None}
    assert trace.run.total_cost_usd == pytest.approx(0.00002)
    assert trace.run.tags == ["prod", "langfuse"]


def test_sdk_roundtrip(tmp_path):
    out = tmp_path / "runs.jsonl"

    @loupe.trace_step(kind="tool")
    def add(a: int, b: int) -> int:
        return a + b

    with loupe.run("sdk-test", out=str(out), tags=["t"]):
        with loupe.step("agent", "outer"):
            add(1, 2)
    [trace] = import_any(out.read_text())
    assert [(s.name, s.parent_idx) for s in trace.steps] == [("outer", None), ("add", 0)]
    assert trace.steps[1].output == 3
    assert trace.run.status == "ok"


def test_sdk_without_run_end_is_error(tmp_path):
    lines = [json.dumps({"type": "run_start", "id": "r1", "name": "crashed", "started_at": "2026-10-15T02:00:00+00:00"}),
             json.dumps({"type": "step", "run_id": "r1", "idx": 0, "kind": "llm", "name": "chat",
                         "started_at": "2026-10-15T02:00:00+00:00", "ended_at": "2026-10-15T02:00:05+00:00"})]
    [trace] = import_any("\n".join(lines))
    assert trace.run.status == "error"
    assert trace.run.ended_at.second == 5


def test_synthetic_sample_imports():
    [trace] = import_any((SAMPLES / "synthetic_small.jsonl").read_text())
    assert len(trace.steps) == 30
    assert detect_format((SAMPLES / "synthetic_small.jsonl").read_text()) == "sdk"


def test_unknown_format_raises():
    with pytest.raises(ValueError):
        import_any('{"hello": 1}')
```

`test_synthetic_sample_imports` 依赖 `samples/synthetic_small.jsonl`,先跑造数脚本。然后:

```bash
cd server
uv run pytest -q
```

我这里的输出是 `6 passed`。测试里的 OTLP 和 Langfuse 数据是我按规范和 API 文档手写的最小样例,不是从真实系统导出的。

**练习 2:产出你自己的 trace。** 按上一节给 Day 9 的 Agent 加记录,跑一次,导入器读出来以后回答三个问题:最慢的是哪一步?输入 token 最多的是哪一次模型调用?有没有报错的步骤?把这条 trace 放进 `samples/`。

**练习 3:让 OTLP 导入器多认一个字段。** 规范里还有 `gen_ai.usage.cache_read.input_tokens`(命中缓存的输入 token 数)。在 `Step` 里不加新字段的前提下,想办法让这个信息在调试器里看得到。提示:可以放进 llm 步的 `input` 字典里一个约定好的键,比如 `input["cache_read_tokens"]`。写一个测试证明它被读进来了。做完想一想:为什么我不直接给 Step 加一个字段?

<details><summary>参考思路</summary>

在 `_span_to_step` 的 llm 分支里,把 `a.get("gen_ai.usage.cache_read.input_tokens")` 放进 input 字典。不加字段的原因是:规范还在 Development 状态,缓存 token 只有部分厂商返回,为一个不稳定的、只有部分数据有的信息改动数据模型,会牵动数据库表、前端类型、对比算法;放在 input 里是「先观察,确定有用再升级成正式字段」。如果后来发现成本计算需要它(命中缓存的价格便宜得多),那时再正式加字段。

</details>

**验收标准**:`uv run pytest -q` 全部通过;`samples/` 里有一条你自己跑出来的真实 trace 和两条合成 trace;能用导入器读出真实 trace 的步骤列表,父子关系正确(所有 llm 和 tool 步的 parent_idx 都指向 agent.run);练习 3 有测试。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| OTLP | OpenTelemetry 的传输协议,有 protobuf 和 JSON 两种编码,今天处理 JSON 版 |
| 语义约定(semantic conventions) | 规定某一类操作的 span 叫什么名字、记哪些属性的规范 |
| AnyValue | OTLP 里属性值的类型,可以是字符串、整数、浮点、布尔、数组、键值列表 |
| Opt-In | 规范里的要求级别,表示默认不记录、需要使用者主动打开 |
| parts | GenAI 约定的消息结构,一条消息由多个不同类型的部分组成 |
| observation | Langfuse 对 trace 里一步的叫法 |
| JSONL | 每行一个 JSON 对象的文本格式,适合追加写 |
| ContextVar | Python 的上下文变量,在不同线程、不同 asyncio 任务里各有一份值 |
| 深拷贝 | 连同内部嵌套的对象一起复制,改原对象不影响副本 |
| normalize | 我们给导入后统一收尾的步骤起的名字:排序、编号、补汇总字段 |

## 常见误区

**直接用 span ID 当前端的 key 和主键。** 能用,但对比和重跑全都要「第几步」,到时候到处都要把 ID 转成序号。在入口处转一次,后面全省事。

**以为 OTLP 里一定有消息内容。** 消息、系统提示词、工具定义都是 Opt-In,很多线上系统出于隐私考虑不开。导入器要允许这些字段缺失,界面也要能显示「这一步没有记录内容」。

**intValue 不转 int。** JSON 版 OTLP 的 64 位整数是字符串,不转换就会出现 token 数拼接成一长串数字的怪现象,而且不报错。

**SDK 只存 messages 的引用。** Agent 会继续往同一个列表里追加消息,存引用记下来的就是最后的状态,每一步看起来都一样。必须在调用那一刻拷贝。

**导入器假设数据是有序的。** Langfuse API 不保证顺序,SDK 写文件是「子步骤先写」,OTLP 里 span 的顺序取决于导出工具。排序要自己做。

**为了一个新字段改数据模型。** 模型是所有代码的地基,能放进 input/output 的扩展信息先放进去,确定稳定、必要了再升级成正式字段。

## 学习资料

### 文档与文章

- [OpenTelemetry GenAI 语义约定:span](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md):今天的主要参考。重点读 inference span 和 execute tool span 两节的属性表,40 分钟。
- [OTLP 规范](https://opentelemetry.io/docs/specs/otlp/):看 JSON 编码那一节,弄清楚 int64 为什么是字符串、ID 为什么是十六进制,20 分钟。
- [Langfuse Observation Types](https://langfuse.com/docs/observability/features/observation-types):十种类型的定义,对照我们的 kind 映射表,10 分钟。
- [Langfuse 公开 API](https://langfuse.com/docs/api-and-data-platform/features/public-api):怎么拿到 trace 和 observation 的数据,写导入器之前读,15 分钟。
- [OpenAI Agents SDK:Tracing](https://openai.github.io/openai-agents-python/tracing/):另一套 trace 结构,看它的 span 类型,想一想怎么映射到我们的五种 kind,15 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1NwNVemEyE&autoplay=0&high_quality=1" title="【IT老齐695】OpenTelemetry日志、指标、链路一站解决方案" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT老齐 · 【IT老齐695】OpenTelemetry日志、指标、链路一站解决方案 · 23 分钟,讲清楚 trace、span、上下文传播这些基本概念,对 OpenTelemetry 还陌生的话先看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1w3HrePENj&autoplay=0&high_quality=1" title="基于 Opentelemetry 的大模型应用可观测丨阿里云云原生研发工程师李艳红(彦鸿)发表主题演讲" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>阿里云云原生 · 基于 Opentelemetry 的大模型应用可观测 · 19 分钟,一线团队讲大模型应用的 span 怎么设计、记哪些属性。2024 年的演讲,属性名以今天读的规范为准。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/RNaa_48LWBY" title="Making GenAI Observable with OpenTelemetry" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>wiggitywhitney · Making GenAI Observable with OpenTelemetry · 16 分钟,演示 GenAI span 在实际工具里长什么样,英文。</figcaption>
</figure>

### 书籍

- **Observability Engineering**,Charity Majors、Liz Fong-Jones、George Miranda,O'Reilly,2022。读第 6 章(怎么把事件串成 trace)和第 7 章(用 OpenTelemetry 埋点),正好对应今天的数据模型和 SDK,约 1 小时。
- **Designing Data-Intensive Applications**,Martin Kleppmann,O'Reilly。第 4 章讲编码与演进,讲数据格式变化时怎么兼容新旧版本,对应今天「新字段优先、老字段兜底」的写法,读前半章,约 40 分钟。

### 开源项目与代码

- [open-telemetry/semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai):规范仓库。`docs/gen-ai/non-normative/` 下面有完整的示例,看一次带工具调用的对话会产生哪几个 span、各带什么属性。
- [langfuse/langfuse-python](https://github.com/langfuse/langfuse-python):Langfuse 的 Python SDK,看它的 `@observe` 装饰器怎么实现,和我们的 `trace_step` 对照。

## 自测

1. `Step` 用 `(run_id, idx)` 做主键,`idx` 是按开始时间重新编的号。这给后面的代码带来了什么方便?又依赖了什么前提?

<details><summary>答案</summary>

方便:时间轴行号、对比时「第几步开始不同」、重跑时「从第几步分叉」都可以直接用 idx 表达,不用在 ID 和序号之间转换。前提是父步骤的 idx 一定小于子步骤,因为父步骤先开始;这让「算树深度」「自底向上累加成本」都能只扫一遍数组。开始时间相同时排序保持原顺序,而导入器给的原顺序是父在前。

</details>

2. OTLP JSON 里 `"intValue": "120"` 为什么是字符串?不处理会怎样?

<details><summary>答案</summary>

OTLP 的整数是 int64,JavaScript 的 number 只能精确表示 53 位整数,所以 JSON 编码时 int64 用字符串表示。不转换的话,汇总 token 时会变成字符串拼接,得到一个看起来很大但完全错误的数字,而且不会报错。

</details>

3. 我们的 SDK 为什么在步骤开始时分配 idx,在结束时才写文件?

<details><summary>答案</summary>

开始时分配 idx,保证父步骤的编号一定小于子步骤;结束时才写,是因为那时才知道输出、token、错误和结束时间。代价是文件里子步骤比父步骤先出现,所以导入器要按 idx 排序。另一个好处是每完成一步就落盘一行,进程崩溃时已完成的步骤不会丢。

</details>

4. `wrap_openai` 里为什么要对 messages 做深拷贝?举一个不拷贝会出现的具体现象。

<details><summary>答案</summary>

Agent 循环会继续往同一个 messages 列表里 append。不拷贝的话,步骤结束写文件时序列化的是被追加过的列表:第一次模型调用的 input 里会出现它自己的回复、甚至后面几轮的工具结果,所有 llm 步的 input 看起来一样长,上下文增长图变成一条平线。

</details>

5. 资深面试题:GenAI 语义约定还处在 Development 状态,字段名以后可能变。你的系统怎么设计才能承受这种变化?

<details><summary>答案</summary>

把外部格式和内部模型隔开:外部格式只在导入器里出现,导入时转成自己的稳定模型,其他所有代码只依赖内部模型。规范变了,只改一个导入器,并且可以同时认新旧两种字段名(新字段优先、老字段兜底),旧数据照样能导入。再配上用真实样例做的导入测试,规范升级时先跑测试就知道哪里断了。代价是转换时可能丢信息,所以内部模型留了 input/output 这种开放字段来装暂时没有正式位置的数据。

</details>

6. 一条 trace 没有 `run_end` 记录,我们怎么处理?为什么不直接丢弃?

<details><summary>答案</summary>

结束时间取最后一个步骤的结束时间,状态记为 error。不丢弃是因为崩溃的运行恰恰最需要调试:前面完成的步骤都在文件里,能看到崩溃前最后做了什么。

</details>

## 明天预告

数据模型和导入器都有了,明天(Day 113)把它们接到后端上:**FastAPI 存储与查询接口**。SQLite 表怎么设计、索引怎么建,运行列表的游标分页,一万步 trace 的分段加载,以及导入时按价格表把成本补上。
