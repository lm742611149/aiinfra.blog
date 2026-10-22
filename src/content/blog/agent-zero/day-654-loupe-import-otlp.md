---
title: 'Day 654 · Loupe(三):导入器一 OTLP JSON'
description: '用 OpenTelemetry 官方的 JSON 文件出口,把天气 Agent 的一次完整运行(Agent、模型、工具三种 span)存成 OTLP JSON 文件,读懂它 resource、scope、span 三层嵌套和四条编码规则:ID 是十六进制、枚举是整数、64 位整数和纳秒时间是字符串、属性值包在 AnyValue 里。然后写 Loupe 的第一个正式导入器 importers/otlp.py,用手写样例和真实样例的测试把它钉住。'
pubDate: 2026-10-23
regime: none
tags: ['agent-loupe', 'opentelemetry', 'otlp', 'importer', 'agent-zero']
series: 'agent-zero'
day: 654
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 653](/blog/agent-zero/day-653-loupe-otel/) 读了 OpenTelemetry 的 GenAI 语义约定:十八种操作名归成 Loupe 的五种 `kind`;消息、工具定义、工具参数全是 Opt-In,默认不记;消息是 `parts` 结构,用 `genai.py` 里的 `parts_to_openai` 转成 OpenAI 格式。还用 DeepSeek 真跑了一次自动埋点,发现消息记成了 JSON 字符串、工具定义没记、`finish_reason` 照抄了 OpenAI 的 `tool_calls`。

那天看的只是单个 span 的**属性**。span 存成文件、在系统之间传来传去时,外面还包着一层格式,叫 OTLP。今天把这层包装拆开,写 Loupe 的第一个正式导入器:给它一个 OTLP JSON 文件,还给你一个或几个 `Trace`。

## 今天要解决的问题

学完今天,你应该能做到:

1. 用官方的 JSON 文件出口把一次 Agent 运行存成 OTLP JSON 文件,说出文件里 `resourceSpans → scopeSpans → spans` 三层各装的是什么。
2. 说出 OTLP JSON 的四条编码规则(ID 十六进制、枚举整数、64 位整数是字符串、属性值是 AnyValue),每条不遵守会出什么事。
3. 写出 `server/loupe/importers/otlp.py`:按 traceId 分组、排序编号、找根 span、套用 Day 653 的 `genai.py`,最后交给 Day 652 的 `normalize`。
4. 用测试覆盖:手写的最小样例、真实样例、一行一个请求的 JSONL 文件、根 span 缺失的截断 trace。

预计用时 2.5 小时。正文跑一次 Agent 约 ¥0.0023,练习再跑一次约 ¥0.002,全天不到 ¥0.01。

前置:[Day 652](/blog/agent-zero/day-652-loupe-model/)(`models.py`、`normalize`)、[Day 653](/blog/agent-zero/day-653-loupe-otel/)(`genai.py`、`otel_capture.py`)、[Day 366](/blog/agent-zero/day-366-otel-spans/)(TracerProvider、手打 span、span kind 和状态)。

学法提示:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `any_value`、`nanos_to_dt` 和 `import_otlp` 的主循环默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## OTLP 是什么,为什么要 JSON 版

**OTLP**(OpenTelemetry Protocol)是 OpenTelemetry 规定的「span 怎么打包、怎么传」的协议。[Day 366](/blog/agent-zero/day-366-otel-spans/) 把 span 发给 Jaeger 时用的 `OTLPSpanExporter` 走的就是它,那时用的是 protobuf 编码:一种二进制格式,小而快,但人看不懂、浏览器里也不好处理。OTLP 还规定了一种 JSON 编码,内容一样,写成文本。

Loupe 收的是「已经存下来的 trace 文件」,JSON 版最合适:用户可以从 OpenTelemetry Collector 的文件出口拿到它,可以用今天这个 Python 文件出口自己生成,也可以手写一个最小的来测试。用浏览器 DevTools 打开也能直接看。

## 第一步:存一份真实的 OTLP JSON

Day 653 用的是内存出口,只拿到了两个模型调用 span,工具调用没有 span,Agent 整体也没有。今天补全:Agent 外面包一个 `invoke_agent` span,每次工具调用包一个 `execute_tool` span,按 [Day 366](/blog/agent-zero/day-366-otel-spans/) 学过的约定手打;模型调用还是交给自动埋点。出口换成官方的 JSON 文件出口。

先在练习仓库装上它:

```bash
cd /Users/你/agent-zero-lab
uv add opentelemetry-exporter-otlp-json-file
```

2026 年 10 月装到的是 `opentelemetry-exporter-otlp-json-file 0.66b1`(10 月 6 日发布,版本号里的 b 表示 beta,还在变),它会顺带装上 `opentelemetry-exporter-otlp-json-common` 和 `opentelemetry-proto-json`。这个包在 PyPI 上最早的版本是 2026 年 6 月的 0.64b0,是新东西,在它之前要自己转格式,下面会说我第一次是怎么转错的。

```python
# agent-zero-lab/part11/otlp_dump.py
import json
import sys
from pathlib import Path
from typing import Any

from opentelemetry import trace
from opentelemetry.exporter.otlp.json.file.trace_exporter import FileSpanExporter
from opentelemetry.instrumentation.openai_v2 import OpenAIInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import SpanKind, Status, StatusCode

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "part11/runs/weather_otlp.jsonl")
OUT.unlink(missing_ok=True)
provider = TracerProvider(resource=Resource.create({"service.name": "weather-agent"}))
provider.add_span_processor(BatchSpanProcessor(FileSpanExporter(OUT)))
trace.set_tracer_provider(provider)
OpenAIInstrumentor().instrument()
tracer = trace.get_tracer("part11.otlp_dump")

from common.llm import LLMClient  # noqa: E402
from part11.weather_agent import SYSTEM, TASK, TOOLS, get_weather  # noqa: E402


def run(task: str, llm: LLMClient, max_steps: int = 6) -> str:
    with tracer.start_as_current_span("invoke_agent weather_agent", kind=SpanKind.INTERNAL,
                                      attributes={"gen_ai.operation.name": "invoke_agent",
                                                  "gen_ai.agent.name": "weather_agent"}):
        messages: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM},
                                          {"role": "user", "content": task}]
        for _ in range(max_steps):
            r = llm.chat(messages, tools=TOOLS)
            messages.append(r.message)
            calls = r.message.get("tool_calls")
            if not calls:
                return r.content
            for tc in calls:
                name, raw_args = tc["function"]["name"], tc["function"]["arguments"]
                with tracer.start_as_current_span(f"execute_tool {name}", attributes={
                        "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": name,
                        "gen_ai.tool.call.id": tc["id"], "gen_ai.tool.type": "function",
                        "gen_ai.tool.call.arguments": raw_args}) as span:
                    try:
                        result = json.dumps(get_weather(**json.loads(raw_args)), ensure_ascii=False)
                    except Exception as e:
                        span.set_status(Status(StatusCode.ERROR, f"{type(e).__name__}: {e}"))
                        result = json.dumps({"error": str(e)}, ensure_ascii=False)
                    span.set_attribute("gen_ai.tool.call.result", result)
                messages.append({"role": "tool", "tool_call_id": tc["id"], "content": result})
        return "超过步数上限"


if __name__ == "__main__":
    task = sys.argv[2] if len(sys.argv) > 2 else TASK
    llm = LLMClient()
    print(run(task, llm).splitlines()[-1])
    provider.shutdown()
    print(f"存到 {OUT},{len(OUT.read_text(encoding='utf-8').splitlines())} 行;{llm.ledger}")
```

<div class="line-notes">

- `from opentelemetry.exporter.otlp.json.file.trace_exporter import FileSpanExporter` 官方的 JSON 文件出口。包路径一段段读:出口、OTLP 协议、JSON 编码、文件。
- `OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "part11/runs/weather_otlp.jsonl")` 输出文件,扩展名是 `.jsonl`,原因见下面的输出。
- `OUT.unlink(missing_ok=True)` 先删掉旧文件。这个出口是**追加写**的(我读了它的源码,打开文件用的是 `"a"` 模式),不删的话两次运行的 span 会混在一个文件里。`missing_ok=True` 文件不存在也不报错。
- `provider = TracerProvider(resource=Resource.create({"service.name": "weather-agent"}))` 给整个进程起个服务名,它会出现在文件的 resource 那一层,导入时变成 Run 的一个标签。
- `provider.add_span_processor(BatchSpanProcessor(FileSpanExporter(OUT)))` 批量处理器:攒一批 span 再交给出口一次写一行。Day 366 讲过它和 `SimpleSpanProcessor` 的区别,批量的更适合真实使用。
- `tracer = trace.get_tracer("part11.otlp_dump")` 我们手打的 span 都来自这个 tracer,名字会出现在文件的 scope 那一层。
- `with tracer.start_as_current_span("invoke_agent weather_agent", kind=SpanKind.INTERNAL,` 整次运行的根 span。名字按约定写成 `invoke_agent {agent 名}`,进程内的 Agent 用 INTERNAL。`start_as_current_span` 把它设成「当前 span」,在它里面开的 span(包括自动埋点开的模型调用 span)都会自动认它当父亲。
- `attributes={"gen_ai.operation.name": "invoke_agent",` 导入器靠这个属性判断它是 agent 步。
- `r = llm.chat(messages, tools=TOOLS)` 模型调用,自动埋点会在这里产生一个 `chat deepseek-flash` span,父亲是上面的根 span。
- `with tracer.start_as_current_span(f"execute_tool {name}", attributes={` 每次工具调用一个 span,名字按约定是 `execute_tool {工具名}`。
- `"gen_ai.tool.call.arguments": raw_args}) as span:` 工具参数是 Opt-In,这里主动记。我们自己的样例数据都是天气,没有隐私问题;如果是客服 Agent,参数里有客户信息,就要想想 Day 367 讲的脱敏。
- `span.set_status(Status(StatusCode.ERROR, f"{type(e).__name__}: {e}"))` 工具出错时把 span 标成错误,附上错误信息,比如 `KeyError: 'results'`。练习 2 会故意触发一次。
- `result = json.dumps({"error": str(e)}, ensure_ascii=False)` 出错也要给模型回一个 tool 消息,不然下一次调模型时 tool_call 没有配对的结果,接口会报错([Day 159](/blog/agent-zero/day-159-tool-roundtrip/) 讲过配对)。
- `span.set_attribute("gen_ai.tool.call.result", result)` 工具结果也记下来,同样是 Opt-In。
- `task = sys.argv[2] if len(sys.argv) > 2 else TASK` 第二个命令行参数可以换任务,练习 2 用。
- `provider.shutdown()` 程序退出前必须调:批量处理器手里还攒着没写出去的 span,`shutdown` 让它全部写完再关文件。忘了这一句,文件里会少最后几个 span,往往恰好是最外层的根 span(它最后结束)。

</div>

```bash
OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental \
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=SPAN_ONLY \
uv run python -m part11.otlp_dump
```

```text
平均气温 = (9.1 + 17.3 + 24.4) ÷ 3 = 50.8 ÷ 3 ≈ **16.9 ℃**
存到 part11/runs/weather_otlp.jsonl,4 行;2 次调用 | 输入 799 / 输出 186 tokens | 约 ¥0.0023
```

这一版循环里没有打印「调用 get_weather」,所以只看到最后的回答。文件有 4 行。为什么是 4 行而不是 1 行?因为这个出口每收到一批 span 就追加一行,每行是一个完整的 OTLP 请求;批量处理器按时间攒批,这次运行花了 28 秒,攒出了 4 批。所以它其实是 **JSONL**(每行一个 JSON),和 OpenTelemetry Collector 的文件出口写出来的格式一样。导入器既要认「整个文件是一个 JSON」,也要认「每行一个 JSON」。

把文件复制到 Loupe 的样例目录:

```bash
cp /Users/你/agent-zero-lab/part11/runs/weather_otlp.jsonl /Users/你/agent-loupe/samples/
```

## 第二步:看一眼文件长什么样

第一行的开头(我把它格式化了,原文件是一整行):

```json
{"resourceSpans": [{
  "resource": {"attributes": [
    {"key": "telemetry.sdk.language", "value": {"stringValue": "python"}},
    {"key": "telemetry.sdk.name", "value": {"stringValue": "opentelemetry"}},
    {"key": "telemetry.sdk.version", "value": {"stringValue": "1.45.1"}},
    {"key": "service.instance.id", "value": {"stringValue": "67199320-7db4-48b6-9c10-3e0294137d42"}},
    {"key": "service.name", "value": {"stringValue": "weather-agent"}}]},
  "scopeSpans": [{
    "scope": {"name": "opentelemetry.util.genai.handler", "version": "1.1b0"},
    "spans": [{
      "traceId": "73cf5b49e616f3bab0a38682b97eb809",
      "spanId": "7f4ebc085155f42b",
      "parentSpanId": "4f5c959779cb69c0",
      "flags": 256,
      "name": "chat deepseek-flash",
      "kind": 3,
      "startTimeUnixNano": "1792684600894079000",
      "endTimeUnixNano": "1792684601833853000",
      "attributes": [
        {"key": "gen_ai.operation.name", "value": {"stringValue": "chat"}},
        {"key": "gen_ai.response.finish_reasons", "value": {"arrayValue": {"values": [{"stringValue": "tool_calls"}]}}},
        {"key": "gen_ai.usage.input_tokens", "value": {"intValue": "310"}},
        …
      ]}]}]}]}
```

三层嵌套:

- **resourceSpans**:按「谁产生的」分组。`resource` 描述产生这些 span 的服务:语言、SDK 版本、服务名。一个文件可以装多个服务的 span。
- **scopeSpans**:同一个服务里,再按「哪个库产生的」分组。`scope` 是 tracer 的名字,这里能看到两个:自动埋点的 `opentelemetry.util.genai.handler`,和我们自己的 `part11.otlp_dump`。
- **spans**:真正的 span 列表。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="OTLP JSON 文件的三层嵌套:resourceSpans 里有 resource 和 scopeSpans,scopeSpans 里有 scope 和 spans">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
<rect x="20" y="20" width="600" height="260" fill="none" stroke="var(--rule)"/>
<text x="32" y="40" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">resourceSpans[i]</text>
<rect x="40" y="52" width="560" height="34" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="52" y="74" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">resource.attributes: service.name = weather-agent, SDK 版本… → Run.tags</text>
<rect x="40" y="96" width="560" height="170" fill="none" stroke="var(--rule)"/>
<text x="52" y="116" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">scopeSpans[j]</text>
<rect x="60" y="126" width="520" height="28" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="72" y="145" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">scope.name: part11.otlp_dump(哪个 tracer 产生的,导入器不用)</text>
<rect x="60" y="162" width="520" height="94" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="72" y="182" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">spans[k]: traceId · spanId · parentSpanId</text>
<text x="72" y="202" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">         name · kind · start/endTimeUnixNano</text>
<text x="72" y="222" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">         status · attributes[{key, value: AnyValue}]</text>
<text x="72" y="244" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">         → 一个 Step;同一 traceId 的归成一个 Run</text>
</svg>
<figcaption>一个文件(或 JSONL 的一行)是一个请求。同一个 trace 的 span 可能散在多个 resource、多个 scope、甚至多行里,导入器要把它们按 traceId 收拢。</figcaption>
</figure>

再用一个小脚本把 4 行里所有 span 列出来,看清它们在文件里的顺序:

```python
# agent-loupe/server/scratch/s8_peek.py
import json
import sys
from pathlib import Path

lines = Path(sys.argv[1]).read_text(encoding="utf-8").splitlines()
print(f"{len(lines)} 行")
for n, line in enumerate(lines):
    doc = json.loads(line)
    for rs in doc["resourceSpans"]:
        service = [a["value"] for a in rs["resource"]["attributes"] if a["key"] == "service.name"]
        for ss in rs["scopeSpans"]:
            for sp in ss["spans"]:
                print(f"第{n}行 {service[0]['stringValue']:<14} {ss['scope']['name']:<33} "
                      f"{sp['name']:<27} kind={sp['kind']} span={sp['spanId']} parent={sp.get('parentSpanId', '-')}")
```

<div class="line-notes">

- `lines = Path(sys.argv[1]).read_text(encoding="utf-8").splitlines()` 按行切开,每行一个 OTLP 请求。
- `for rs in doc["resourceSpans"]:` 三层循环一层层往里走,和上面的图一一对应。
- `service = [a["value"] for a in rs["resource"]["attributes"] if a["key"] == "service.name"]` 属性是一个 `{key, value}` 的**列表**,不是字典。找某个键只能遍历,≈ `attrs.filter(a => a.key === 'service.name')`。导入器里会先把它转成字典。
- `print(f"第{n}行 {service[0]['stringValue']:<14} {ss['scope']['name']:<33} "` 值还包着一层 `{"stringValue": ...}`,下一节讲。
- `f"{sp['name']:<27} kind={sp['kind']} span={sp['spanId']} parent={sp.get('parentSpanId', '-')}")` 根 span 没有 `parentSpanId` 字段,`.get` 给个横杠。

</div>

```bash
cd /Users/你/agent-loupe/server
uv run python -m scratch.s8_peek ../samples/weather_otlp.jsonl
```

```text
4 行
第0行 weather-agent  opentelemetry.util.genai.handler  chat deepseek-flash         kind=3 span=7f4ebc085155f42b parent=4f5c959779cb69c0
第1行 weather-agent  part11.otlp_dump                  execute_tool get_weather    kind=1 span=d3e6cde10baf8c70 parent=4f5c959779cb69c0
第2行 weather-agent  part11.otlp_dump                  execute_tool get_weather    kind=1 span=7357323c8a8d075c parent=4f5c959779cb69c0
第3行 weather-agent  part11.otlp_dump                  execute_tool get_weather    kind=1 span=817e13dd7094ff30 parent=4f5c959779cb69c0
第3行 weather-agent  part11.otlp_dump                  invoke_agent weather_agent  kind=1 span=4f5c959779cb69c0 parent=-
第3行 weather-agent  opentelemetry.util.genai.handler  chat deepseek-flash         kind=3 span=e8ea2896e0f9cf8e parent=4f5c959779cb69c0
```

几件事一眼能看出来:

- 6 个 span 散在 4 行里,同一行里又分在两个 scope 下。
- 根 span `invoke_agent` 出现在倒数第二个。span 是**结束时**才写出的,根 span 包住了所有其他 span,最后结束,所以排在后面。Day 652 说「导入器给的顺序不可靠」,这就是实例。
- 其余 5 个的 `parent` 都是 `4f5c959779cb69c0`,也就是根 span 的 `spanId`。模型调用 span 是自动埋点开的,我们没告诉它父亲是谁,它自己认了「当前 span」。
- `kind=3` 和 `kind=1` 是整数,不是 `CLIENT`、`INTERNAL` 这种名字。

## 第三步:四条编码规则

OTLP 的 JSON 编码是从 protobuf 定义机械转换出来的,再加了几条自己的规定。[OTLP 规范](https://opentelemetry.io/docs/specs/otlp/) 的 JSON Protobuf Encoding 一节写得很清楚,我挑和导入器有关的四条,每条都看看不遵守会怎样。

### 规则一:属性值包在 AnyValue 里

属性的 `value` 不是直接的值,而是一个只有一个键的对象,键名说明类型:`stringValue`、`intValue`、`doubleValue`、`boolValue`、`arrayValue`(列表)、`kvlistValue`(键值列表,相当于字典)、`bytesValue`。这个包装叫 **AnyValue**。≈ TS 里的带标签联合类型 `{stringValue: string} | {intValue: string} | ...`,看哪个键存在就知道是哪种。

### 规则二:64 位整数是字符串

`"intValue": "310"`,token 数是带引号的字符串。原因在 JavaScript:JS 的 number 是 64 位浮点数,只能精确表示到 2 的 53 次方,而 protobuf 的 int64 能到 2 的 63 次方。为了让 JS 解析 JSON 时不丢精度,protobuf 的 JSON 映射规定 64 位整数一律写成十进制字符串。规范的原话是写出时用字符串,读入时数字和字符串都要接受。

不转换会怎样?写个小脚本看看:

```python
# agent-loupe/server/scratch/s9_intvalue.py
import json
from datetime import UTC, datetime
from typing import Any

from loupe.models import Step

raw: dict[str, Any] = json.loads('{"gen_ai.usage.input_tokens": {"intValue": "310"}}')
naive = {k: next(iter(v.values())) for k, v in raw.items()}
tokens = naive["gen_ai.usage.input_tokens"]
print(repr(tokens))

t = datetime(2026, 10, 22, 15, 56, 40, tzinfo=UTC)
s = Step.model_validate({"run_id": "r", "idx": 0, "kind": "llm", "name": "chat",
                         "started_at": t, "ended_at": t, "input_tokens": tokens})
print("进了 Step 以后:", repr(s.input_tokens))

print("JSON 里两个 token 字符串相加:", tokens + "489")
try:
    print(tokens > 300)
except TypeError as e:
    print("TypeError:", e)
```

<div class="line-notes">

- `raw: dict[str, Any] = json.loads('{"gen_ai.usage.input_tokens": {"intValue": "310"}}')` 模拟从文件里读出来的一个属性。从 JSON 来的东西类型都是 `Any`,类型检查器帮不了你,这也是这类 bug 难发现的原因。
- `naive = {k: next(iter(v.values())) for k, v in raw.items()}` 偷懒的拆包法:不管类型,把 AnyValue 里唯一的那个值拿出来。`next(iter(...))` 取第一个元素,≈ `Object.values(v)[0]`。
- `print(repr(tokens))` 打出 `'310'`,带引号,是字符串。
- `s = Step.model_validate({"run_id": "r", "idx": 0, "kind": "llm", "name": "chat",` 交给 Day 652 的 Step。
- `print("JSON 里两个 token 字符串相加:", tokens + "489")` 字符串相加是拼接。
- `print(tokens > 300)` 字符串和整数比大小。

</div>

```bash
uv run python -m scratch.s9_intvalue
```

```text
'310'
进了 Step 以后: 310
JSON 里两个 token 字符串相加: 310489
TypeError: '>' not supported between instances of 'str' and 'int'
```

第二行有意思:进了 `Step` 以后变成了整数 310。pydantic 默认是**宽松模式**(lax mode),看到 `int` 字段收到 `"310"` 这种纯数字字符串,会帮你转。所以 Step 上的 token 字段碰巧是安全的。但导入器里别的地方会直接用属性值:判断「这一步输入超过多少 token」、累加、排序,那里就是拼接成 `310489` 或者直接 `TypeError`。所以规矩是**在最底层的 `any_value` 里就转成 int**,上面的代码拿到的永远是真正的数字。

### 规则三:时间是纳秒整数(也是字符串)

`"startTimeUnixNano": "1792684600894079000"`:从 1970 年 1 月 1 日 UTC 起的纳秒数,64 位整数,所以也是字符串。十九位数字,前十位是秒,后九位是秒以下的部分。

转成 `datetime` 最顺手的写法是 `datetime.fromtimestamp(int(n) / 1e9, UTC)`,我第一版就这么写的。问题在 `/ 1e9`:除出来是一个浮点数,`1792684600.894079` 这种 16 位有效数字的值已经贴着浮点数的精度上限了。Python 的 `datetime` 只到微秒,纳秒本来就要丢掉后三位;丢的时候,浮点运算和取整方式会让结果有时差 1 微秒。我写了个脚本量了一下:

```python
# agent-loupe/server/scratch/s7_nanos.py
import random
from datetime import UTC, datetime

from loupe.importers.otlp import nanos_to_dt

n = 1792684600894079000
print(n / 1e9)
print(datetime.fromtimestamp(n / 1e9, UTC).isoformat())
print(nanos_to_dt(n).isoformat())

random.seed(1)
bad, worst = 0, 0.0
for _ in range(100_000):
    n = 1792684600 * 10**9 + random.randrange(10**9)
    diff = abs((datetime.fromtimestamp(n / 1e9, UTC) - nanos_to_dt(n)).total_seconds())
    bad += diff > 0
    worst = max(worst, diff)
print(f"10 万个随机纳秒时间戳:用 /1e9 换算和整数换算结果不同的有 {bad} 个,最多差 {worst * 1e6:.0f} 微秒")
```

<div class="line-notes">

- `from loupe.importers.otlp import nanos_to_dt` 导入器里的整数版换算,完整代码在下一节。这个脚本要等你写完 `otlp.py` 才能跑。
- `n = 1792684600894079000` 第一个 chat span 的开始时间。
- `print(n / 1e9)` 浮点除法的结果。
- `n = 1792684600 * 10**9 + random.randrange(10**9)` 同一秒里随机取一个纳秒时刻。`10**9` 是 10 的 9 次方。
- `bad += diff > 0` 布尔值可以当 0 和 1 加,≈ JS 里 `bad += Number(diff > 0)`。

</div>

```bash
uv run python -m scratch.s7_nanos
```

```text
1792684600.894079
2026-10-22T15:56:40.894079+00:00
2026-10-22T15:56:40.894079+00:00
10 万个随机纳秒时间戳:用 /1e9 换算和整数换算结果不同的有 50182 个,最多差 1 微秒
```

这个具体的时间两种写法结果一样,随机抽十万个,一半差 1 微秒。1 微秒对看时间轴毫无影响,但有两个地方在乎:同一份文件导入两次,结果必须一模一样,不然「同一条运行」导入两次会被当成内容变了;以及父子 span 开始时间只差几百纳秒时,差 1 微秒可能让排序颠倒,破坏 Day 652 那条「父编号比子编号小」的约定。整数运算(整除取秒、取余算微秒)永远精确,没有理由不用它。

### 规则四:ID 是十六进制,枚举是整数

traceId 是 16 字节、spanId 是 8 字节,在 protobuf 里是二进制。OTLP 规范专门规定:JSON 里写成十六进制字符串,不区分大小写(32 位和 16 位十六进制字符);枚举(span 的 `kind`、状态的 `code`)**必须**写成整数。

为什么要专门规定?因为 protobuf 标准的 JSON 映射正好相反:bytes 用 base64,枚举用名字。我第一次生成样例时还不知道有官方的 JSON 文件出口,用的是 protobuf 自带的 `google.protobuf.json_format.MessageToDict` 把编码好的请求转成字典,得到的 span 是这样的:

```text
"traceId": "iyHJpBIq5NrLUSdo9j1Iwg==",
"spanId": "5qc3sSMiwIE=",
"parentSpanId": "u3c4ieMwkvE=",
"kind": "SPAN_KIND_CLIENT",
"status": {},
```

ID 是 base64(结尾的等号是标志),kind 是名字。这种文件不符合 OTLP 规范,但现实里你会碰到:有人就是这么转的。Loupe 的导入器对它宽容一点:看到 ID 不是纯十六进制,就当 base64 解码再转十六进制。base64 编码 8 字节和 16 字节的数据时,结尾一定有 `=` 或 `==`,所以不会和十六进制混淆。`kind` 我们根本不用(Loupe 的 kind 来自 `gen_ai.operation.name`),是名字还是数字都无所谓。练习 3 会验证两种写法导入结果完全一样。

`status` 是 `{}`:没设过状态的 span 是 UNSET,protobuf 不写默认值,所以是空对象。状态码 0 是 UNSET、1 是 OK、2 是 ERROR。只有 2 才是出错,导入器只认它(整数 2、字符串 `"2"` 和名字 `"STATUS_CODE_ERROR"` 都认)。

## 第四步:写导入器

规则都清楚了,完整的导入器:

```python
# agent-loupe/server/loupe/importers/otlp.py
import base64
import json
import re
from datetime import UTC, datetime
from typing import Any

from loupe.importers.genai import kind_of, llm_input_output, maybe_json
from loupe.models import Run, Step, Trace, normalize

HEX = re.compile(r"^[0-9a-fA-F]+$")
ERROR_CODES = (2, "2", "STATUS_CODE_ERROR")


def any_value(v: dict[str, Any]) -> Any:
    if "stringValue" in v:
        return v["stringValue"]
    if "intValue" in v:
        return int(v["intValue"])
    if "doubleValue" in v:
        return float(v["doubleValue"])
    if "boolValue" in v:
        return bool(v["boolValue"])
    if "arrayValue" in v:
        return [any_value(x) for x in v["arrayValue"].get("values", [])]
    if "kvlistValue" in v:
        return {kv["key"]: any_value(kv.get("value", {})) for kv in v["kvlistValue"].get("values", [])}
    return None


def attrs_of(obj: dict[str, Any]) -> dict[str, Any]:
    return {a["key"]: any_value(a.get("value", {})) for a in obj.get("attributes", [])}


def nanos_to_dt(nanos: str | int) -> datetime:
    n = int(nanos)
    return datetime.fromtimestamp(n // 1_000_000_000, UTC).replace(microsecond=n % 1_000_000_000 // 1000)


def hex_id(raw: str) -> str:
    if raw and not HEX.match(raw):
        return base64.b64decode(raw).hex()
    return raw.lower()


def span_to_step(span: dict[str, Any], attrs: dict[str, Any]) -> Step:
    op = attrs.get("gen_ai.operation.name")
    kind = kind_of(op)
    status = span.get("status", {})
    failed = status.get("code") in ERROR_CODES
    error = (status.get("message") or attrs.get("error.type") or "error") if failed else None
    step = Step(run_id="", idx=0, kind=kind, name=span.get("name") or op or "span",
                started_at=nanos_to_dt(span["startTimeUnixNano"]),
                ended_at=nanos_to_dt(span["endTimeUnixNano"]), error=error)
    if kind == "llm":
        inp, out = llm_input_output(attrs)
        return step.model_copy(update={
            "input": inp, "output": out,
            "model": attrs.get("gen_ai.response.model") or attrs.get("gen_ai.request.model"),
            "input_tokens": attrs.get("gen_ai.usage.input_tokens"),
            "output_tokens": attrs.get("gen_ai.usage.output_tokens")})
    if kind == "tool":
        return step.model_copy(update={"input": maybe_json(attrs.get("gen_ai.tool.call.arguments")),
                                       "output": maybe_json(attrs.get("gen_ai.tool.call.result"))})
    if kind == "retrieval":
        return step.model_copy(update={"input": attrs.get("gen_ai.retrieval.query.text"),
                                       "output": maybe_json(attrs.get("gen_ai.retrieval.documents"))})
    return step


def read_documents(text: str) -> list[dict[str, Any]]:
    text = text.strip()
    try:
        return [json.loads(text)]
    except json.JSONDecodeError:
        return [json.loads(line) for line in text.splitlines() if line.strip()]


def import_otlp(text: str) -> list[Trace]:
    by_trace: dict[str, list[tuple[dict[str, Any], str]]] = {}
    for doc in read_documents(text):
        for rs in doc.get("resourceSpans", []):
            service = attrs_of(rs.get("resource", {})).get("service.name", "")
            for ss in rs.get("scopeSpans", []):
                for span in ss.get("spans", []):
                    by_trace.setdefault(hex_id(span["traceId"]), []).append((span, service))

    traces: list[Trace] = []
    for trace_id, pairs in by_trace.items():
        pairs.sort(key=lambda p: int(p[0]["startTimeUnixNano"]))
        idx_of = {hex_id(span["spanId"]): i for i, (span, _) in enumerate(pairs)}
        steps: list[Step] = []
        for i, (span, _) in enumerate(pairs):
            parent = idx_of.get(hex_id(span.get("parentSpanId", "")))
            steps.append(span_to_step(span, attrs_of(span)).model_copy(update={"idx": i, "parent_idx": parent}))
        root_i = next((i for i, s in enumerate(steps) if s.parent_idx is None), 0)
        root, service = steps[root_i], pairs[root_i][1]
        run = Run(id=trace_id, name=root.name, started_at=root.started_at, ended_at=root.ended_at,
                  status="error" if root.error else "ok",
                  tags=["otlp"] + ([service] if service else []))
        traces.append(normalize(run, steps))
    return traces
```

<div class="line-notes">

- `from loupe.importers.genai import kind_of, llm_input_output, maybe_json` Day 653 写好的三个函数直接用。OTLP 导入器只管「拆包装」,属性的含义交给 genai.py。
- `HEX = re.compile(r"^[0-9a-fA-F]+$")` 整串都是十六进制字符。
- `ERROR_CODES = (2, "2", "STATUS_CODE_ERROR")` 三种写法的「出错」。规范要求整数 2;另外两种是从别的工具导出时见过的写法,一起认。
- `def any_value(v: dict[str, Any]) -> Any:` 规则一:拆 AnyValue。挨个看是哪个键。
- `return int(v["intValue"])` 规则二:64 位整数是字符串,在这里就转成 int。
- `return [any_value(x) for x in v["arrayValue"].get("values", [])]` 列表的每个元素又是一个 AnyValue,递归拆。`finish_reasons` 就是这样变成 `["tool_calls"]` 的。
- `return {kv["key"]: any_value(kv.get("value", {})) for kv in v["kvlistValue"].get("values", [])}` 键值列表变成字典,值同样递归拆。
- `return None` `bytesValue` 和空的 AnyValue 都返回 None。GenAI 约定里没有用到二进制属性。
- `def attrs_of(obj: dict[str, Any]) -> dict[str, Any]:` 把 `[{key, value}, ...]` 的列表变成普通字典 `{key: 值}`,后面查属性就是 `attrs.get("gen_ai.usage.input_tokens")`。span 和 resource 都有 `attributes`,共用这一个函数。
- `return datetime.fromtimestamp(n // 1_000_000_000, UTC).replace(microsecond=n % 1_000_000_000 // 1000)` 规则三:`//` 是整除,≈ `Math.floor(a / b)`;`%` 取余。先用整秒建时间,再把「秒以下的纳秒数除以 1000」作为微秒填进去。全程整数,没有浮点误差。`1_000_000_000` 里的下划线只是为了好读,≈ JS 的 `1_000_000_000`。
- `if raw and not HEX.match(raw):` 规则四:不是纯十六进制就当 base64。空字符串(根 span 的 parentSpanId)原样返回。
- `return base64.b64decode(raw).hex()` base64 解码成字节,再转十六进制字符串。
- `return raw.lower()` 规范说十六进制不区分大小写,统一成小写,同一个 ID 不会因为大小写被当成两个。
- `failed = status.get("code") in ERROR_CODES` 只有状态码是错误才算出错。没设状态的 `{}` 是 UNSET,不是错。
- `error = (status.get("message") or attrs.get("error.type") or "error") if failed else None` 错误信息优先用状态描述(我们写的 `KeyError: 'results'`),其次是约定里的 `error.type` 属性,都没有就写个 `"error"`,总之出错的步骤 `error` 一定非空。
- `step = Step(run_id="", idx=0, kind=kind, name=span.get("name") or op or "span",` 先建一个通用的 Step,`run_id` 和 `idx` 先占位,后面 `normalize` 和主循环会改。这里用构造函数而不是 `model_validate`,是因为传进去的值都是我们转好的(时间是 `datetime`,kind 是 `StepKind`),类型检查器认得。
- `inp, out = llm_input_output(attrs)` 模型步:Day 653 的函数拼出 messages、tools 和输出消息,没记内容就是两个 None。
- `"model": attrs.get("gen_ai.response.model") or attrs.get("gen_ai.request.model"),` 实际响应的模型优先,它可能带具体版本号。
- `"input_tokens": attrs.get("gen_ai.usage.input_tokens"),` 已经是 int 了(`any_value` 转过),没记就是 None。这里 `model_copy` 不校验,所以前面那一步转换更不能省。
- `return step.model_copy(update={"input": maybe_json(attrs.get("gen_ai.tool.call.arguments")),` 工具步:参数是 JSON 字符串 `'{"city": "Beijing"}'`,解析成字典存,详情面板好展示。
- `return step` agent 和 other 步只有通用字段。
- `def read_documents(text: str) -> list[dict[str, Any]]:` 先当整个文件是一个 JSON 解析,失败了再按行解析。今天的样例是 4 行,第一次 `json.loads` 会因为第二行而失败(报 `Extra data`),然后走按行那条路。
- `by_trace.setdefault(hex_id(span["traceId"]), []).append((span, service))` 按 traceId 分组。`setdefault` 是「没有这个键就先放一个空列表,然后返回它」,≈ `(map[k] ??= []).push(x)`。连同服务名一起存,因为服务名在外层的 resource 上,出了这一层循环就拿不到了。
- `pairs.sort(key=lambda p: int(p[0]["startTimeUnixNano"]))` 按开始时间排序。直接比纳秒整数,最精确;注意要 `int(...)`,字符串比较在位数相同时碰巧对,位数不同就错。
- `idx_of = {hex_id(span["spanId"]): i for i, (span, _) in enumerate(pairs)}` spanId 到新编号的表。`(span, _)` 是元组解构,`_` 表示这个值不用。
- `parent = idx_of.get(hex_id(span.get("parentSpanId", "")))` 父 span 的编号。父 span 不在这个文件里(trace 被截断)时,`.get` 返回 None,这一步就成了根。
- `steps.append(span_to_step(span, attrs_of(span)).model_copy(update={"idx": i, "parent_idx": parent}))` 每个 span 转成 Step,填上编号和父编号。
- `root_i = next((i for i, s in enumerate(steps) if s.parent_idx is None), 0)` 找第一个根。`next(生成器, 默认值)` 取第一个满足条件的,一个都没有就用 0,≈ `findIndex` 加兜底。因为已经排过序,有多个根时取最早开始的那个。
- `run = Run(id=trace_id, name=root.name, started_at=root.started_at, ended_at=root.ended_at,` Run 的名字和时间先取根步骤的,`normalize` 还会再用所有步骤校正时间。
- `status="error" if root.error else "ok",` 只看根 span。Day 652 讨论过:工具出错 Agent 可能自己处理了,不能因为一步出错就判整次运行失败。
- `tags=["otlp"] + ([service] if service else []))` 来源标签加服务名,列表页可以按服务筛选。
- `traces.append(normalize(run, steps))` 最后交给 Day 652 的统一收尾。返回的是列表,一个文件里可以有好几个 trace。

</div>

导入器只做一件事:把 OTLP 的形状变成 Run/Step 的形状。所有和 GenAI 有关的含义(哪个属性是 token、消息怎么转)都在 `genai.py` 里,所有和 Loupe 有关的约定(编号、汇总)都在 `normalize` 里。三层各管各的,规范哪一层变了,改哪一层。

## 第五步:导入真实样例

写一个小脚本把导入结果打出来:

```python
# agent-loupe/server/scratch/s10_import.py
import sys
from pathlib import Path

from loupe.importers.otlp import import_otlp

for trace in import_otlp(Path(sys.argv[1]).read_text(encoding="utf-8")):
    r = trace.run
    print(f"{r.id} | {r.name} | {r.status} | {r.tags} | {r.model} | "
          f"输入 {r.total_input_tokens} 输出 {r.total_output_tokens} | {(r.ended_at - r.started_at).total_seconds():.2f}s")
    for s in trace.steps:
        secs = (s.ended_at - s.started_at).total_seconds()
        inp = "无" if s.input is None else (f"{len(s.input['messages'])} 条消息" if s.kind == "llm" else s.input)
        print(f"  {s.idx} 父={s.parent_idx} {s.kind:<5} {s.name:<27} {secs:6.2f}s 输入={inp} 错误={s.error}")
```

<div class="line-notes">

- `for trace in import_otlp(Path(sys.argv[1]).read_text(encoding="utf-8")):` 导入器收的是文本而不是路径。Day 659 的上传接口拿到的是请求体里的文本,不是文件,所以从一开始就按文本设计。
- `inp = "无" if s.input is None else (f"{len(s.input['messages'])} 条消息" if s.kind == "llm" else s.input)` 模型步只显示消息条数,不然一屏打不下;工具步直接显示参数。

</div>

```bash
uv run python -m scratch.s10_import ../samples/weather_otlp.jsonl
```

```text
73cf5b49e616f3bab0a38682b97eb809 | invoke_agent weather_agent | ok | ['otlp', 'weather-agent'] | deepseek-flash | 输入 799 输出 186 | 28.43s
  0 父=None agent invoke_agent weather_agent   28.43s 输入=无 错误=None
  1 父=0 llm   chat deepseek-flash           0.94s 输入=2 条消息 错误=None
  2 父=0 tool  execute_tool get_weather      7.66s 输入={'city': 'Beijing'} 错误=None
  3 父=0 tool  execute_tool get_weather     11.63s 输入={'city': 'Shanghai'} 错误=None
  4 父=0 tool  execute_tool get_weather      7.39s 输入={'city': 'Guangzhou'} 错误=None
  5 父=0 llm   chat deepseek-flash           0.81s 输入=6 条消息 错误=None
```

和 Day 649 那份手写记录比一比:

| | Day 649 的 `weather_run.json` | 今天导入的 OTLP |
| --- | --- | --- |
| 步数 | 5 | 6,多了根步骤 agent |
| 时间 | 离起点几秒 | 绝对时间,UTC |
| 父子关系 | 没有 | 5 个子步骤都指向第 0 步 |
| 模型步的输入 | 没有 | 第 1 步 2 条消息,第 5 步 6 条 |
| 工具步的输入输出 | 只在名字里写了城市 | 参数和返回值都在 |

第 1 步 2 条消息(系统提示词和用户问题),第 5 步 6 条(多了 assistant 的工具调用和三条工具结果),这就是 Day 666 要画的「上下文在哪一步变大」的原始数据。

工具每次七到十一秒,比 Day 649 那次慢不少,是我这里当时到 Open-Meteo 的网络慢,不是代码的问题。Day 649 讲过怎么把三个工具并行,这里没改。

## 测试

```python
# agent-loupe/server/tests/test_otlp.py
import base64
import json
from pathlib import Path
from typing import Any

from loupe.importers.otlp import any_value, hex_id, import_otlp, nanos_to_dt

SAMPLES = Path(__file__).parents[2] / "samples"
T0 = 1792684600_000_000_000


def s(key: str, val: str) -> dict[str, Any]:
    return {"key": key, "value": {"stringValue": val}}


def i(key: str, val: int) -> dict[str, Any]:
    return {"key": key, "value": {"intValue": str(val)}}


def span(span_id: str, name: str, start_ms: int, end_ms: int, parent: str = "", **extra: Any) -> dict[str, Any]:
    return {"traceId": "73cf5b49e616f3bab0a38682b97eb809", "spanId": span_id, "parentSpanId": parent,
            "name": name, "kind": 1, "startTimeUnixNano": str(T0 + start_ms * 1_000_000),
            "endTimeUnixNano": str(T0 + end_ms * 1_000_000), **extra}


DOC = {"resourceSpans": [{
    "resource": {"attributes": [s("service.name", "weather-agent")]},
    "scopeSpans": [{"spans": [
        span("bb", "execute_tool get_weather", 1000, 1400, parent="aa",
             status={"code": 2, "message": "ConnectTimeout"},
             attributes=[s("gen_ai.operation.name", "execute_tool"), s("gen_ai.tool.call.arguments", '{"city": "Beijing"}')]),
        span("cc", "chat deepseek-flash", 100, 900, parent="aa", attributes=[
            s("gen_ai.operation.name", "chat"), s("gen_ai.request.model", "deepseek-flash"),
            i("gen_ai.usage.input_tokens", 310), i("gen_ai.usage.output_tokens", 106)]),
        span("aa", "invoke_agent weather_agent", 0, 3000, attributes=[s("gen_ai.operation.name", "invoke_agent")]),
    ]}]}]}


def test_any_value_types() -> None:
    assert any_value({"intValue": "310"}) == 310
    assert any_value({"arrayValue": {"values": [{"stringValue": "stop"}]}}) == ["stop"]
    assert any_value({"kvlistValue": {"values": [{"key": "a", "value": {"boolValue": True}}]}}) == {"a": True}


def test_nanos_and_ids() -> None:
    assert nanos_to_dt("1792684600894079000").isoformat() == "2026-10-22T15:56:40.894079+00:00"
    raw = bytes.fromhex("4f5c959779cb69c0")
    assert hex_id(base64.b64encode(raw).decode()) == "4f5c959779cb69c0"
    assert hex_id("4F5C959779CB69C0") == "4f5c959779cb69c0"


def test_handwritten_doc() -> None:
    [trace] = import_otlp(json.dumps(DOC))
    assert [(st.kind, st.parent_idx) for st in trace.steps] == [("agent", None), ("llm", 0), ("tool", 0)]
    assert trace.steps[1].input is None
    assert trace.steps[2].error == "ConnectTimeout"
    assert trace.steps[2].input == {"city": "Beijing"}
    assert trace.run.status == "ok"
    assert trace.run.tags == ["otlp", "weather-agent"]
    assert (trace.run.total_input_tokens, trace.run.model) == (310, "deepseek-flash")


def test_jsonl_lines_merge_into_one_trace() -> None:
    lines = []
    for sp in DOC["resourceSpans"][0]["scopeSpans"][0]["spans"]:
        lines.append(json.dumps({"resourceSpans": [{"scopeSpans": [{"spans": [sp]}]}]}))
    [trace] = import_otlp("\n".join(lines))
    assert len(trace.steps) == 3


def test_truncated_trace_without_root() -> None:
    only_children = {"resourceSpans": [{"scopeSpans": [{"spans": DOC["resourceSpans"][0]["scopeSpans"][0]["spans"][:2]}]}]}
    [trace] = import_otlp(json.dumps(only_children))
    assert [st.parent_idx for st in trace.steps] == [None, None]
    assert trace.run.name == "chat deepseek-flash"


def test_real_weather_sample() -> None:
    [trace] = import_otlp((SAMPLES / "weather_otlp.jsonl").read_text(encoding="utf-8"))
    kinds = [st.kind for st in trace.steps]
    assert kinds == ["agent", "llm", "tool", "tool", "tool", "llm"]
    assert all(st.parent_idx == 0 for st in trace.steps[1:])
    assert trace.steps[1].input_tokens == 310
    assert trace.steps[2].output == {"city": "Beijing", "temp_c": 9.1}
    last = trace.steps[5]
    assert last.input is not None
    assert [m["role"] for m in last.input["messages"]][-3:] == ["tool", "tool", "tool"]
```

<div class="line-notes">

- `T0 = 1792684600_000_000_000` 手写样例的时间起点,用纳秒整数。
- `def s(key: str, val: str) -> dict[str, Any]:` 造一个字符串属性的小帮手,手写 OTLP 时少打很多括号。
- `return {"key": key, "value": {"intValue": str(val)}}` 整数属性按规范写成字符串,测试数据也要守规矩。
- `def span(span_id: str, name: str, start_ms: int, end_ms: int, parent: str = "", **extra: Any) -> dict[str, Any]:` 造一个 span,时间用毫秒写,内部换成纳秒字符串。
- `span("bb", "execute_tool get_weather", 1000, 1400, parent="aa",` 故意乱序:工具 span 排第一,根 span 排最后,和真实文件一样。spanId 写成 `aa`、`bb`、`cc`,也是合法的十六进制。
- `status={"code": 2, "message": "ConnectTimeout"},` 工具出错。
- `assert hex_id(base64.b64encode(raw).decode()) == "4f5c959779cb69c0"` 同一个 spanId 的 base64 写法,转回来是十六进制。
- `assert trace.steps[1].input is None` 手写的 chat span 没有消息属性,input 是 None,不报错。
- `assert trace.run.status == "ok"` 工具出错,但根 span 没出错,运行就是 ok。
- `lines.append(json.dumps({"resourceSpans": [{"scopeSpans": [{"spans": [sp]}]}]}))` 每个 span 单独一行,模拟批量出口写出的多行文件。三行导入后要合成一个 Trace。
- `only_children = {"resourceSpans": [{"scopeSpans": [{"spans": DOC["resourceSpans"][0]["scopeSpans"][0]["spans"][:2]}]}]}` 只要前两个 span,根 span 丢了,模拟被截断的 trace(比如进程崩溃前根 span 还没结束)。两个子步骤的父亲都找不到,都变成根,运行名取最早开始的那个。
- `assert trace.steps[2].output == {"city": "Beijing", "temp_c": 9.1}` 工具结果从 JSON 字符串解析成了字典。这个 9.1 是 10 月 22 日晚上北京的真实气温,样例文件里写死了,测试才稳定。

</div>

```bash
cd /Users/你/agent-loupe/server
uv run pytest -q
```

```text
..................                                                       [100%]
18 passed in 1.07s
```

前两天 12 个,今天加 6 个。basedpyright 查 `loupe/`、`tests/`、`scratch/` 和练习仓库的 `part11/`,都是 0 个错误。

## 今天的文件

| 文件 | 干什么 | 新建还是修改 | 花费 |
| --- | --- | --- | --- |
| `agent-zero-lab/part11/otlp_dump.py` | 天气 Agent 加 Agent、工具 span 和自动埋点,存成 OTLP JSONL | 新建 | 约 ¥0.0023 |
| `agent-zero-lab/pyproject.toml`、`uv.lock` | 加了 `opentelemetry-exporter-otlp-json-file` | 修改 | |
| `agent-loupe/samples/weather_otlp.jsonl` | 真实样例,4 行 6 个 span | 复制 | |
| `agent-loupe/server/loupe/importers/otlp.py` | OTLP JSON 导入器 | 新建 | 不花 |
| `agent-loupe/server/tests/test_otlp.py` | 6 个测试 | 新建 | 不花 |
| `agent-loupe/server/scratch/s7_nanos.py` 到 `s10_import.py`、`ex654_*.py` | 演示和练习 | 新建,不提交 | 练习 2 约 ¥0.002 |

## 动手练习

**练习 1:导入结果过一遍自检。** 用 Day 652 练习 1 的 `check()` 检查今天导入的 Trace,并把它存成 `samples/weather_otlp.trace.json`,和 Day 652 的 `weather_run_day649.trace.json` 放在一起,以后 Day 658 建表时两份都能用。

<details><summary>参考答案</summary>

```python
# agent-loupe/server/scratch/ex654_save.py
import sys
from pathlib import Path

from loupe.importers.otlp import import_otlp
from scratch.ex652_check import check

src = Path(sys.argv[1])
for trace in import_otlp(src.read_text(encoding="utf-8")):
    out = Path("../samples") / f"{src.stem}.trace.json"
    out.write_text(trace.model_dump_json(indent=2), encoding="utf-8")
    print(f"{trace.run.id[:8]}… {len(trace.steps)} 步,自检 {len(check(trace))} 个问题,存到 {out}")
```

<div class="line-notes">

- `from scratch.ex652_check import check` Day 652 练习 1 写的检查函数。`scratch/` 有 `__init__.py`,用 `-m` 跑时可以像普通包一样 import。
- `out = Path("../samples") / f"{src.stem}.trace.json"` `src.stem` 是 `weather_otlp`,存成 `weather_otlp.trace.json`。一个文件里有多个 trace 时这样写会互相覆盖,我们的样例只有一个,够用。
- `print(f"{trace.run.id[:8]}… {len(trace.steps)} 步,自检 {len(check(trace))} 个问题,存到 {out}")` `[:8]` 取前 8 个字符,traceId 太长。

</div>

```bash
uv run python -m scratch.ex654_save ../samples/weather_otlp.jsonl
```

```text
73cf5b49… 6 步,自检 0 个问题,存到 ../samples/weather_otlp.trace.json
```

编号连续、run_id 一致、父在子前、没有结束早于开始。别小看这一步:导入器要是排序写错(比如按字符串排纳秒),自检会立刻报「父步骤不在它前面」。

</details>

**练习 2:让一个工具出错。** 用 `otlp_dump.py` 的第二个参数换个任务,让模型去查一个不存在的城市,导入后看那一步的 `error` 和整次运行的 `status`。

<details><summary>参考答案</summary>

我第一次用的是「Atlantis 和北京现在各多少度?」,结果 Open-Meteo 的地名接口真的找到了一个叫 Atlantis 的地方(美国佛罗里达有个小镇叫这个名字),模型回答「Atlantis 返回了 16.3°C,不过亚特兰蒂斯是传说中的城市」,工具没出错,白花了 ¥0.0018。换一个编出来的名字:

```bash
cd /Users/你/agent-zero-lab
OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental \
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=SPAN_ONLY \
uv run python -m part11.otlp_dump part11/runs/weather_fail.jsonl "Qwzxkvland 和北京现在各多少度?Qwzxkvland 的英文名就是 Qwzxkvland。"
```

```text
Qwzxkvland 的天气没查到，查询返回了错误（`'results'`），拿不到气温数据。这可能是因为该地名在天气数据里不存在，或拼写方式不同。你能确认一下这个地区属于哪个国家，或者提供其他可能的名称吗？我再试着查一次。
存到 part11/runs/weather_fail.jsonl,3 行;2 次调用 | 输入 755 / 输出 144 tokens | 约 ¥0.0019
```

任务里加「英文名就是 Qwzxkvland」,是怕模型自作主张把它翻译成别的。导入:

```bash
cp /Users/你/agent-zero-lab/part11/runs/weather_fail.jsonl /Users/你/agent-loupe/samples/
cd /Users/你/agent-loupe/server
uv run python -m scratch.s10_import ../samples/weather_fail.jsonl
```

```text
370b151157270b79614f9439d434c108 | invoke_agent weather_agent | ok | ['otlp', 'weather-agent'] | deepseek-flash | 输入 755 输出 144 | 10.24s
  0 父=None agent invoke_agent weather_agent   10.24s 输入=无 错误=None
  1 父=0 llm   chat deepseek-flash           1.06s 输入=2 条消息 错误=None
  2 父=0 tool  execute_tool get_weather      2.46s 输入={'city': 'Qwzxkvland'} 错误=KeyError: 'results'
  3 父=0 tool  execute_tool get_weather      5.67s 输入={'city': 'Beijing'} 错误=None
  4 父=0 llm   chat deepseek-flash           1.05s 输入=5 条消息 错误=None
```

第 2 步记下了 `KeyError: 'results'`:地名接口查不到时返回的 JSON 里没有 `results` 这个键,Day 649 的 `get_weather` 没处理这种情况。整次运行是 ok:Agent 把错误交给了模型,模型老老实实告诉用户没查到,北京照常回答了。这正是 Day 652 练习 4 说的情况,列表页上这条运行该显示「ok,有 1 步报错」。

顺带看出一个 Day 649 的小毛病:`get_weather` 把底层的 `KeyError` 原样抛出来,模型看到的错误信息是 `'results'`,完全看不懂。更好的做法是在工具里把它翻译成「没找到叫 Qwzxkvland 的城市」,这是 [Day 170](/blog/agent-zero/day-170-agent-full/) 讲工具错误处理时的老话题。Loupe 的作用就是让这种问题被看见。

</details>

**练习 3:base64 写法的文件能不能导入。** 写个脚本,把 `weather_otlp.jsonl` 里所有 ID 改成 base64、`kind` 改成名字(模拟用 protobuf 标准 JSON 映射转出来的文件),导入后和原文件的导入结果比较。

<details><summary>参考答案</summary>

```python
# agent-loupe/server/scratch/ex654_base64.py
import base64
import json
from pathlib import Path
from typing import Any

from loupe.importers.otlp import import_otlp

KIND_NAMES = {1: "SPAN_KIND_INTERNAL", 3: "SPAN_KIND_CLIENT"}


def b64(hex_str: str) -> str:
    return base64.b64encode(bytes.fromhex(hex_str)).decode() if hex_str else hex_str


def to_proto_style(doc: dict[str, Any]) -> dict[str, Any]:
    for rs in doc["resourceSpans"]:
        for ss in rs["scopeSpans"]:
            for sp in ss["spans"]:
                for key in ("traceId", "spanId", "parentSpanId"):
                    if key in sp:
                        sp[key] = b64(sp[key])
                sp["kind"] = KIND_NAMES.get(sp["kind"], sp["kind"])
    return doc


text = Path("../samples/weather_otlp.jsonl").read_text(encoding="utf-8")
proto_lines = [json.dumps(to_proto_style(json.loads(line))) for line in text.splitlines()]
print(json.loads(proto_lines[0])["resourceSpans"][0]["scopeSpans"][0]["spans"][0]["spanId"])

[a] = import_otlp(text)
[b] = import_otlp("\n".join(proto_lines))
print("run id:", a.run.id == b.run.id, b.run.id)
print("两种写法导入结果完全一样:", a == b)
```

<div class="line-notes">

- `KIND_NAMES = {1: "SPAN_KIND_INTERNAL", 3: "SPAN_KIND_CLIENT"}` protobuf 里 span kind 枚举的名字,今天的文件只用到这两个值。
- `return base64.b64encode(bytes.fromhex(hex_str)).decode() if hex_str else hex_str` 十六进制 → 字节 → base64 字符串。`.decode()` 把 bytes 变成 str。
- `sp["kind"] = KIND_NAMES.get(sp["kind"], sp["kind"])` 整数换成名字。
- `print("两种写法导入结果完全一样:", a == b)` pydantic 模型的 `==` 比较所有字段,嵌套的 Run 和每个 Step 都比。

</div>

```bash
uv run python -m scratch.ex654_base64
```

```text
f068CFFV9Cs=
run id: True 73cf5b49e616f3bab0a38682b97eb809
两种写法导入结果完全一样: True
```

第一个 span 的 ID 从 `7f4ebc085155f42b` 变成了 `f068CFFV9Cs=`,导入后运行编号还是十六进制的 `73cf5b49…`,整个 Trace 完全相等。宽容地接受,严格地输出:不管来的是哪种写法,Loupe 内部和数据库里只有一种。

</details>

**练习 4:一万个 span 要导多久。** 造一个一万个 span、顺序打乱的 OTLP 文件,量一下 `import_otlp` 的耗时。

<details><summary>参考答案</summary>

```python
# agent-loupe/server/scratch/ex654_big.py
import json
import random
import time
from typing import Any

from loupe.importers.otlp import import_otlp

T0 = 1792684600_000_000_000
N = 10_000


def span(i: int, parent: str, op: str) -> dict[str, Any]:
    start = T0 + i * 50_000_000
    return {"traceId": "ab" * 16, "spanId": f"{i:016x}", "parentSpanId": parent,
            "name": f"{op} #{i}", "kind": 1,
            "startTimeUnixNano": str(start), "endTimeUnixNano": str(start + 40_000_000),
            "attributes": [{"key": "gen_ai.operation.name", "value": {"stringValue": op}},
                           {"key": "gen_ai.usage.input_tokens", "value": {"intValue": str(300 + i)}}]}


random.seed(0)
spans = [span(0, "", "invoke_agent")] + [
    span(i, f"{0:016x}", random.choice(["chat", "execute_tool"])) for i in range(1, N)]
random.shuffle(spans)
text = json.dumps({"resourceSpans": [{"scopeSpans": [{"spans": spans}]}]})
print(f"{N} 个 span,文件 {len(text) / 1e6:.1f} MB")

t = time.perf_counter()
[trace] = import_otlp(text)
print(f"导入用了 {time.perf_counter() - t:.2f} 秒,{len(trace.steps)} 步,第 0 步 {trace.steps[0].name}")
```

<div class="line-notes">

- `start = T0 + i * 50_000_000` 每个 span 比上一个晚 50 毫秒开始。
- `return {"traceId": "ab" * 16, "spanId": f"{i:016x}", "parentSpanId": parent,` `"ab" * 16` 是字符串重复,得到 32 个字符的 `abab…`,一个合法的 traceId。`:016x` 是十六进制、补零到 16 位,`i=255` 得到 `00000000000000ff`。
- `random.shuffle(spans)` 原地打乱顺序,≈ 洗牌算法。根 span 被洗到了不知道哪里。
- `t = time.perf_counter()` 只量导入,不量造数据。

</div>

```bash
uv run python -m scratch.ex654_big
```

```text
10000 个 span,文件 3.9 MB
导入用了 1.31 秒,10000 步,第 0 步 invoke_agent #0
```

我连跑两次,第二次是 0.88 秒(第一次要加载模块、预热)。在我这台 2019 款 Intel MacBook Pro 上,一万步一秒左右,洗乱的根 span 被排回了第 0 步。这些 span 没有消息内容,真实的 trace 带着消息会慢不少,文件也大得多。对导入来说一秒可以接受,它只在上传时跑一次;Day 663 真正要量的是一万步在浏览器里渲染卡不卡。

</details>

**验收标准**:`server/` 下 `uv run pytest -q` 18 passed;`otlp_dump.py` 生成的文件能被 `s8_peek.py` 列出 6 个 span,被 `s10_import.py` 导成 1 条运行、6 步、5 个子步骤都指向第 0 步;练习 1 的自检 0 个问题;能不看文章说出 OTLP JSON 的三层嵌套和四条编码规则,以及每条不处理会出什么事。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| OTLP | OpenTelemetry Protocol,span 怎么打包、怎么传的协议,有 protobuf 和 JSON 两种编码 |
| protobuf | Google 的一种二进制数据格式,先写结构定义(.proto 文件)再编码,小而快 |
| resourceSpans | OTLP 最外层,按产生 span 的服务分组 |
| resource | 描述产生 span 的服务:服务名、SDK、语言等 |
| scopeSpans / scope | 第二层,按产生 span 的库(tracer 名字)分组 |
| AnyValue | OTLP 里属性值的包装:`{"stringValue": ...}`、`{"intValue": ...}` 等,键名表示类型 |
| int64 | 64 位整数;JSON 里写成十进制字符串,因为 JS 的 number 只能精确到 2 的 53 次方 |
| startTimeUnixNano | 从 1970-01-01 UTC 起的纳秒数,十九位,JSON 里是字符串 |
| 十六进制 / base64 | 把二进制写成文本的两种方式;OTLP JSON 的 ID 必须是十六进制,protobuf 标准映射用 base64 |
| 枚举(enum) | 一组有名字的整数常量,如 span kind 的 INTERNAL=1、CLIENT=3,状态的 ERROR=2 |
| UNSET | span 状态的默认值,没设过就是它,不等于出错 |
| JSONL | 每行一个 JSON 的文本格式;OTLP 文件出口每批 span 写一行 |
| BatchSpanProcessor | 攒一批 span 再交给出口的处理器;程序退出前要 `shutdown` 把剩下的写完 |
| lax mode(宽松模式) | pydantic 的默认校验模式,`"310"` 交给 int 字段会被转成 310 |

## 常见误区

**用 `MessageToDict` 把 protobuf 请求转成 JSON 当 OTLP 文件。** 得到的 ID 是 base64(`iyHJpBIq5NrLUSdo9j1Iwg==`)、kind 是名字(`SPAN_KIND_CLIENT`),不符合 OTLP 规范,别的工具可能不认。用官方的 JSON 文件出口,或者 Collector 的文件出口。

**`intValue` 不转 int。** 进了 pydantic 的 int 字段会被宽松模式转好,看起来没事;一旦在导入器里直接比较、累加,就是 `TypeError` 或者 `310489` 这种拼接出来的怪数。在最底层的 `any_value` 里转。

**纳秒时间用 `/ 1e9` 换算。** 浮点误差加上取整方式,十万个里有一半差 1 微秒。整除和取余,全程整数。

**按字符串排序纳秒时间。** 位数相同时碰巧对;位数不同就错,比如 2001 年 9 月以前的纳秒时间戳是十八位,按字符串会排到现在的十九位时间戳后面。转成 int 再排。

**以为 span 在文件里按开始时间排好了。** span 是结束时写出的,根 span 最后结束,往往在文件末尾。自己排序。

**忘了 `provider.shutdown()`。** 批量处理器手里攒着的 span 没写出去,文件里少最后几个,常常就是根 span。导入后所有子步骤都成了根。

**一个文件只解析一次 `json.loads`。** 文件出口写的是每批一行的 JSONL,整个文件 `json.loads` 会报 `Extra data`。两种都试。

**把 status 为 `{}` 的 span 当成出错。** 那是 UNSET,没设过状态,不是错。只有状态码 2 才是 ERROR。

**一步报错就把运行标成 error。** 练习 2 里查不到城市的那一步报了错,Agent 照常给出了回答。OTLP 导入器只看根 span 的状态。

## 学习资料

### 文档与文章

- [OTLP 规范](https://opentelemetry.io/docs/specs/otlp/):读 JSON Protobuf Encoding 那一节,十六进制 ID、整数枚举、64 位整数字符串、忽略未知字段几条规定都在这里,20 分钟。
- [trace.proto](https://github.com/open-telemetry/opentelemetry-proto/blob/main/opentelemetry/proto/trace/v1/trace.proto):OTLP 里 span 的正式定义,看 `Span`、`Status`、`SpanKind` 三段的注释,字段含义和枚举取值都写得很清楚,30 分钟。
- [opentelemetry-proto 的示例](https://github.com/open-telemetry/opentelemetry-proto/tree/main/examples):官方给的 OTLP JSON 示例文件,拿来测导入器正好,10 分钟。
- [opentelemetry-exporter-otlp-json-file](https://pypi.org/project/opentelemetry-exporter-otlp-json-file/):今天用的 JSON 文件出口,beta 版,5 分钟。
- [Collector 的文件出口](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/exporter/fileexporter):生产环境里更常见的 OTLP JSON 文件来源,看它的配置和「每行一个请求」的说明,10 分钟。
- [protobuf 的 JSON 映射](https://protobuf.dev/programming-guides/json/):标准映射里 bytes 是 base64、int64 是字符串、枚举是名字,对照着看 OTLP 改了哪几条,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1bF411r71X&autoplay=0&high_quality=1" title="OpenTelemetry入门｜一看就懂" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>阳明云原生 · OpenTelemetry入门|一看就懂 · 1 小时 42 分。系统讲 OpenTelemetry 的组成,挑讲 OTLP 协议、Collector 和 exporter 的部分看,弄清楚今天这个文件在一个真实系统里是从哪里流出来的。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1NwNVemEyE&autoplay=0&high_quality=1" title="【IT老齐695】OpenTelemetry日志、指标、链路一站解决方案" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT老齐 · 【IT老齐695】OpenTelemetry日志、指标、链路一站解决方案 · 23 分钟。短一些,讲 trace、span、上下文传播,看完对「子 span 自动认当前 span 当父亲」会更有感觉。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/_CJrFW_yjRo" title="OpenTelemetry Collector: EVERYTHING you need to know [to get started]" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Adam Gardner · OpenTelemetry Collector: EVERYTHING you need to know [to get started] · 英文。Collector 的接收器、处理器、出口怎么串起来,看出口那一段,知道用户手里的 OTLP 文件多半是怎么导出来的。</figcaption>
</figure>

### 书籍

- **Learning OpenTelemetry**,Ted Young、Austin Parker,O'Reilly,2024。读讲 OTLP 和 Collector 的章节,补齐「span 产生以后去了哪」这一段。
- **Observability Engineering**,Charity Majors、Liz Fong-Jones、George Miranda,O'Reilly,2022。第 6、7 章讲事件怎么串成 trace、怎么用 OpenTelemetry 埋点,对应今天手打的 Agent 和工具 span。

### 开源项目与代码

- [open-telemetry/opentelemetry-python](https://github.com/open-telemetry/opentelemetry-python):在 `exporter/opentelemetry-exporter-otlp-json-common` 下面看官方的 JSON 编码器怎么把 ID 转成十六进制,和我们的 `hex_id` 反过来对照。
- [open-telemetry/opentelemetry-proto](https://github.com/open-telemetry/opentelemetry-proto):协议定义仓库,`examples/` 里的 JSON 可以直接喂给今天的导入器试试。

## 自测

1. 一个 OTLP JSON 文件里,同一个 trace 的 span 可能分散在哪几个地方?导入器怎么把它们收拢?

<details><summary>答案</summary>

可能分散在多个 resourceSpans(不同服务)、多个 scopeSpans(不同的库,比如自动埋点和手打的 tracer)、甚至 JSONL 的多行里(批量出口每批写一行)。导入器把所有层、所有行的 span 全部遍历一遍,按 traceId 放进一个字典分组,每组变成一个 Trace。

</details>

2. 为什么 `"intValue": "310"` 是字符串?不转 int 在我们的代码里会怎样?

<details><summary>答案</summary>

64 位整数超出 JS number 的精确范围(2 的 53 次方),protobuf 的 JSON 映射规定写成十进制字符串。不转的话,交给 Step 的 int 字段时 pydantic 宽松模式会帮你转,看起来没事;但导入器里直接比较会 `TypeError: '>' not supported between instances of 'str' and 'int'`,字符串相加会拼成 `310489`。所以在 `any_value` 里一开始就转。

</details>

3. `nanos_to_dt` 为什么不写成 `datetime.fromtimestamp(n / 1e9, UTC)`?

<details><summary>答案</summary>

`/ 1e9` 得到浮点数,十九位的纳秒时间换成秒以后贴着浮点精度上限,加上取整方式不同,实测十万个随机时间戳一半差 1 微秒。同一个时间每次换算结果要一致,父子 span 开始时间很近时也不能让误差颠倒顺序。整除取秒、取余算微秒,全程整数,永远精确。

</details>

4. 根 span 的状态是 ok,其中一个工具 span 的状态码是 2,Loupe 里这条运行是什么状态?为什么?

<details><summary>答案</summary>

ok。OTLP 导入器只看根 span 的状态。工具出错 Agent 可能已经处理了(练习 2 里查不到城市,模型如实告诉了用户,北京照常回答),整次运行是正常结束的。出错那一步的 `error` 字段记着 `KeyError: 'results'`,界面另外显示「有 1 步报错」。

</details>

5. 面试题:你要写一个导入第三方数据的模块,对方的格式有规范,但现实中的文件经常不完全守规范。你怎么取舍「严格」和「宽容」?

<details><summary>答案</summary>

输入宽容,输出严格。对不影响含义的偏差宽容处理:ID 是 base64 还是十六进制都认,状态码是整数、字符串还是名字都认,整个文件是一个 JSON 还是每行一个都认,不认识的操作名归 other,缺了根 span 就把孤儿步骤当根。转换以后内部只有一种写法,ID 统一成小写十六进制,时间统一成 UTC,数字统一成 int。对会改变含义的东西严格:时间没有时区直接拒收,kind 不在五种里直接报错。每种宽容都写一个测试(用规范示例、真实样例和故意改过的变体),这样宽容是有边界的,不会变成「什么都吞」。

</details>

6. 面试题:用 OpenTelemetry 的批量处理器把 span 写文件,程序结束时忘了调 `shutdown`,导入后会看到什么现象?怎么从数据里发现这个问题?

<details><summary>答案</summary>

最后一批还在内存里的 span 没写出去。根 span 最后结束,最容易被丢,导入后会看到所有子步骤都变成了根(父 span 不在文件里),运行名变成了第一个子步骤的名字,运行的结束时间也早于真实结束时间。发现办法:导入后检查「有多个根步骤」或者「运行名不是 invoke_agent 开头」,这类 trace 打一个「可能不完整」的标记;再检查同一个 trace 里有没有 parentSpanId 指向文件里不存在的 span。

</details>

## 明天预告

明天是 Day 655,Loupe(四):导入器二 Langfuse 导出,导入器三自研 SDK。今天的 OTLP 导入器把「拆包装」和「懂含义」分成了 `otlp.py` 和 `genai.py` 两层,明天的两个导入器照同样的形状写:Langfuse 的 observation 用 `parentObservationId` 串父子、时间是 ISO 字符串、自带成本;我们自己的 `loupe_sdk.py` 一步结束写一行 JSONL,进程中途被杀也不丢已完成的步骤。三个导入器最后都交给同一个 `normalize`。
