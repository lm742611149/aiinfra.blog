---
title: 'Day 655 · Loupe(四):导入器二 Langfuse 导出,导入器三自研 SDK'
description: '写 Loupe 的第二、第三个导入器。Langfuse 的 observation 导出:v2 接口的数据按 observation 一行、input 和 output 一律是字符串、时间是带 Z 的 ISO 字符串、自带用量和成本。自研 SDK:单文件、只用标准库,一步结束写一行 JSONL,进程中途被杀也不丢已完成的步骤。两个导入器都交给 Day 652 的 normalize,各用手写样例和真实样例的测试钉住。'
pubDate: 2026-10-27
regime: none
tags: ['agent-loupe', 'langfuse', 'jsonl', 'importer', 'agent-zero']
series: 'agent-zero'
day: 655
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 654](/blog/agent-zero/day-654-loupe-import-otlp/) 写了第一个导入器 `importers/otlp.py`:拆开 OTLP JSON 的 resource、scope、span 三层包装,处理十六进制 ID、字符串整数、纳秒时间这些编码规则,再把 span 的属性交给 Day 653 的 `genai.py` 去「读懂含义」,最后交给 Day 652 的 `normalize`。「拆包装」和「懂含义」分成两层,是那一天最该记住的结构。

今天的两个导入器照同样的形状写。第一个读 Langfuse 导出的数据,它的包装完全不同(没有三层嵌套,一个 observation 一行,时间是 ISO 字符串),但内容和 OTLP 是亲戚。第二个读我们自己的 SDK 写出来的 JSONL。第二个最特别:数据格式是我们定的,所以可以按「调试器要什么」来设计,不用迁就别人。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说出 Langfuse v2 observations 接口返回的是什么形状,`input` 和 `output` 为什么要再 `json.loads` 一次,`fields` 参数不带 `io` 会怎样。
2. 写出 `server/loupe/importers/langfuse.py`:按 `traceId` 分组、按时间排序(不是按字符串排序)、用 `parentObservationId` 找父子、读用量和成本。
3. 写出单文件 `server/loupe_sdk.py`,给 Agent 加上记录;理解它为什么「步骤结束时才写一行,但编号在开始时分配」,为什么 input 必须在调用那一刻拷贝。
4. 写出 `server/loupe/importers/sdk_jsonl.py`,处理「进程被杀,文件只写了一半」这种情况,并用 20 个测试把两个导入器钉住。

预计用时 3 小时:Langfuse 一小时一刻,SDK 和它的导入器一小时三刻。这一天塞了两个导入器,是这周最重的一天之一。今天不调模型,花费 0:Langfuse 样例是用 Day 654 存下的真实文件转出来的,SDK 的测试用不花钱的假客户端。

前置:[Day 652](/blog/agent-zero/day-652-loupe-model/)(`models.py`、`normalize`)、[Day 653](/blog/agent-zero/day-653-loupe-otel/)(`genai.py` 里的 `maybe_json`)、[Day 654](/blog/agent-zero/day-654-loupe-import-otlp/)(`otlp.py` 里的 `read_documents`,以及 `samples/weather_otlp.jsonl`)、[Day 365](/blog/agent-zero/day-365-langfuse/)(Langfuse 是什么)、[Day 71](/blog/agent-zero/day-071-pytest-1/)(pytest)。

学法提示:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `observation_to_step` 和 `loupe_sdk.step` 默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## Langfuse 导出长什么样

[Day 365](/blog/agent-zero/day-365-langfuse/) 接入过 Langfuse:一个开源的大模型应用可观测平台,你的程序把 trace 发给它,它存起来,在网页上给你看。Langfuse 里一步叫一个 **observation**(观察记录),类型有 `GENERATION`(模型调用)、`TOOL`、`AGENT`、`RETRIEVER`、`EMBEDDING`、`SPAN`、`EVENT` 等。

要注意一件事:Langfuse 自己就能收 OTLP。它的 API 文档里有一个 `POST /api/public/otel/v1/traces`,你的 Agent 用 Day 654 那套 OpenTelemetry 发给它就行。所以「数据从 OpenTelemetry 进 Langfuse」这条路,Day 654 的导入器已经能读(读的是进去之前的那份文件)。今天读的是**出来**的那份:用户在 Langfuse 里看到一条有意思的 trace,通过公开 API 把它拉下来,丢给 Loupe。

我 2026 年 10 月 27 日对照 [Langfuse 公开 API 文档](https://langfuse.com/docs/api-and-data-platform/features/public-api)和它的 [OpenAPI 文件](https://cloud.langfuse.com/generated/api/openapi.yml)查到的情况是:实时读 observation 的接口是 `GET /api/public/v2/observations`。它有几个特点,每一个都会影响导入器怎么写。

第一,它按 observation 一行返回,**没有「一条 trace 一个对象」这种形状**。一条 trace 的所有 observation 要自己用 `traceId` 收拢,正好是 Day 654 里按 `traceId` 分组的同一招。

第二,要哪些字段得用 `fields` 参数点名。`core` 一直返回(`id`、`traceId`、`startTime`、`endTime`、`parentObservationId`、`type` 等),`basic` 默认返回(`name`、`level`、`statusMessage` 等),而 `input` 和 `output` 在 `io` 组,`model` 在 `model` 组,用量和成本在 `usage` 组。不点名的组**整个字段都不出现**,不是 `null`。所以拉数据的命令要写成这样(这段**没有实跑**,我没有 Langfuse 账号,凭据是你自己项目设置里的 Public Key 和 Secret Key):

```bash
curl -G -u "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" \
  "https://cloud.langfuse.com/api/public/v2/observations" \
  --data-urlencode "traceId=你的 trace id" \
  --data-urlencode "fromStartTime=2026-10-27T00:00:00Z" \
  --data-urlencode "toStartTime=2026-10-28T00:00:00Z" \
  --data-urlencode "fields=core,basic,io,model,usage,trace_context" \
  --data-urlencode "limit=100" > langfuse_export.json
```

第三,`input` 和 `output` **一律是字符串**。OpenAPI 文件里它们的类型没写死,但接口说明里写得很明白:`parseIoAsJson` 这个参数已经废弃,传 `true` 会直接 400,「Input/output fields are always returned as raw strings」。意思是 Agent 当初记的是一个 messages 列表,到你手里是 `"[{\"role\": \"user\", ...}]"` 这样一个 JSON 文本,要自己再解一次。Day 653 里遇到过同样的事(`gen_ai.input.messages` 在 Python 的 OpenTelemetry 里也是 JSON 字符串),所以 `maybe_json` 今天还会用。

第四,结果按 `startTime` **从新到旧**排,而且有分页:返回里的 `meta.cursor` 是下一页的游标,把它作为 `cursor` 参数再请求一次,直到没有 cursor。所以一个导出文件可能是好几页拼起来的。这和 Day 654 的 JSONL(一行一个请求)是同一个形状,`read_documents` 能直接复用。

第五,`parentObservationId` 的说明里有一句容易漏掉:「Observations marked as app roots by the SDK may retain a non-null parent ID」。SDK 把某个 observation 标成应用的根,它也可能保留一个指向别处的父 ID(比如你的 Agent 被另一个系统调用时)。导入时,**父 ID 不在这批数据里,就当它是根**。

### 没有 Langfuse 账号,样例怎么来

我没有真实的 Langfuse 数据可以导,而这门课也不该要求你先去注册。办法是:拿 Day 654 存下来的 `samples/weather_otlp.jsonl`(一次真实运行),写一个小脚本把它**转成 v2 接口会返回的形状**。字段名和类型照 OpenAPI 文件来,再用另一个脚本对着 OpenAPI 文件检查字段有没有写错。所以今天的 Langfuse 样例是**照文档拼出来的,不是从真实 Langfuse 服务拉下来的**。这一点我在文末汇总里再说一遍。

在 `server/` 目录下建 `scratch/__init__.py`(空文件,Day 654 已经建过就跳过),然后新建:

```python
# agent-loupe/server/scratch/make_langfuse_sample.py
import json
import sys
from pathlib import Path
from typing import Any

from loupe.importers.genai import llm_input_output
from loupe.importers.otlp import attrs_of, hex_id, nanos_to_dt, read_documents

TYPE_BY_OP = {"chat": "GENERATION", "execute_tool": "TOOL", "invoke_agent": "AGENT"}


def iso(nanos: str) -> str:
    return nanos_to_dt(nanos).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def as_raw(value: Any) -> str | None:
    # v2 接口的 input / output 一律是字符串:对象要先 JSON 序列化,本来就是字符串的原样给
    if value is None or isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False)


def row(span: dict[str, Any], attrs: dict[str, Any], root_name: str) -> dict[str, Any]:
    op = attrs.get("gen_ai.operation.name")
    failed = span.get("status", {}).get("code") in (2, "2", "STATUS_CODE_ERROR")
    inp: Any = None
    out: Any = None
    if op == "chat":
        inp, out = llm_input_output(attrs)
        inp = inp and inp["messages"]
    elif op == "execute_tool":
        inp, out = attrs.get("gen_ai.tool.call.arguments"), attrs.get("gen_ai.tool.call.result")
    tokens_in, tokens_out = attrs.get("gen_ai.usage.input_tokens"), attrs.get("gen_ai.usage.output_tokens")
    return {
        "id": hex_id(span["spanId"]), "traceId": hex_id(span["traceId"]),
        "startTime": iso(span["startTimeUnixNano"]), "endTime": iso(span["endTimeUnixNano"]),
        "projectId": "demo-project", "parentObservationId": hex_id(span.get("parentSpanId", "")) or None,
        "type": TYPE_BY_OP.get(str(op), "SPAN"), "isRootObservation": not span.get("parentSpanId"),
        "name": span["name"], "level": "ERROR" if failed else "DEFAULT",
        "statusMessage": span.get("status", {}).get("message") or None, "environment": "default",
        "traceName": root_name, "tags": ["weather"],
        "input": as_raw(inp), "output": as_raw(out),
        "model": attrs.get("gen_ai.response.model") or attrs.get("gen_ai.request.model"),
        "usageDetails": {"input": tokens_in, "output": tokens_out, "total": tokens_in + tokens_out} if tokens_in else None,
        "costDetails": None, "totalCost": None,
        # 规范里这四个必填,没选 model 字段组时永远是 null
        "modelId": None, "inputPrice": None, "outputPrice": None, "totalPrice": None,
    }


src, dst = Path(sys.argv[1]), Path(sys.argv[2])
spans = [s for d in read_documents(src.read_text(encoding="utf-8"))
         for rs in d["resourceSpans"] for ss in rs["scopeSpans"] for s in ss["spans"]]
root_name = next(s["name"] for s in spans if not s.get("parentSpanId"))
rows = [row(s, attrs_of(s), root_name) for s in sorted(spans, key=lambda s: -int(s["startTimeUnixNano"]))]
dst.write_text(json.dumps({"data": rows, "meta": {}}, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"{len(rows)} 条 observation 存到 {dst}")
```

<div class="line-notes">

- `from loupe.importers.genai import llm_input_output` 反过来用 Day 653 的函数:导入器是「OTLP 属性 → Step」,今天这个脚本是「OTLP 属性 → Langfuse 的一行」,借它把消息从 `parts` 转回 OpenAI 格式。
- `TYPE_BY_OP = {"chat": "GENERATION",` 和 Day 653 的 `KIND_BY_OPERATION` 反方向的一张小表。Langfuse 的类型名全大写。
- `return nanos_to_dt(nanos).isoformat(timespec="milliseconds")` 纳秒转 `datetime`(Day 654 的函数),再写成毫秒精度,`+00:00` 换成 `Z`。得到 `2026-10-27T05:03:43.354Z` 这种样子,和 Langfuse 接口里的 `date-time` 一致。
- `if value is None or isinstance(value, str):` 工具参数在 OTLP 里本来就是 JSON 字符串(`'{"city": "Beijing"}'`),不能再 `json.dumps` 一次,否则变成 `"{\"city\": ...}"` 套两层。我第一次写就漏了这个判断,导出来的工具 input 带着一圈转义。
- `failed = span.get("status", {}).get("code") in (2, "2", "STATUS_CODE_ERROR")` OTLP 里状态码 2 才是 ERROR(Day 654 讲过),`{}` 是没设过。
- `inp = inp and inp["messages"]` `llm_input_output` 返回 `{"messages": [...], "tools": ...}`,Langfuse 的 OpenAI 集成记的 input 就是消息列表本身,所以只取 `messages`,**工具定义丢掉**。这一步是我的假设,下面「两个没验证的假设」会再提。
- `"parentObservationId": hex_id(span.get("parentSpanId", "")) or None,` 根 span 的 `parentSpanId` 是空串,转成 `None`(JSON 里的 `null`)。
- `"isRootObservation": not span.get("parentSpanId"),` 没有父的就是逻辑根。
- `"usageDetails": {"input": tokens_in,` OpenAPI 里 `usageDetails` 是「键是用量名、值是整数」的字典,Langfuse 用 `input`、`output`、`total` 这几个名字。我这次样例里 `weather_otlp.jsonl` 第一次模型调用是 `310 / 106 / 416`。
- `"costDetails": None, "totalCost": None,` 成本留空是**故意的**:Langfuse 要认识这个模型名才会算钱,`deepseek-flash` 它不认识(要你自己在设置里加模型定价),所以真实导出里这两项就是 `null`。测试里再单独手写有成本的情况。
- `"modelId": None, "inputPrice": None,` 这四个字段在规范里是必填,没请求 `model` 字段组时永远是 `null`。第一次检查时我漏了它们,下面的检查脚本把这个错抓出来了。
- `rows = [row(s, attrs_of(s), root_name) for s in sorted(spans, key=lambda s: -int(s["startTimeUnixNano"]))]` 按开始时间**从新到旧**排,模仿接口的顺序。导入器必须自己重排,这是故意留的坑。
- `dst.write_text(json.dumps({"data": rows, "meta": {}},` 外层是 `{"data": [...], "meta": {...}}`。没有下一页,所以 `meta` 里没有 `cursor`。

</div>

跑它:

```bash
cd /Users/你/agent-loupe/server
uv run python -m scratch.make_langfuse_sample ../samples/weather_otlp.jsonl ../samples/weather_langfuse.json
```

```text
6 条 observation 存到 ../samples/weather_langfuse.json
```

你的 `weather_otlp.jsonl` 是 Day 654 自己跑出来的,里面的气温、token 数和我的不一样,下面所有输出里的具体数字都以你的为准,结构应该一样。我这份里有 6 个 span:一个 Agent、两次模型调用、三次工具调用。

### 对着 OpenAPI 检查字段名

字段名写错最难发现:导入器读不到就当没有,不报错。写一个检查脚本,把 OpenAPI 文件下载下来,看样例里的字段是不是都在规范里、规范要求必填的是不是都有。要先装一个读 YAML 的包:

```bash
cd /Users/你/agent-loupe/server
uv add --dev pyyaml
curl -L -o /Users/你/langfuse-openapi.yml https://cloud.langfuse.com/generated/api/openapi.yml
```

```python
# agent-loupe/server/scratch/s12_check_keys.py
import json
import sys
from pathlib import Path

import yaml

spec = yaml.safe_load(Path(sys.argv[1]).read_text(encoding="utf-8"))
schema = spec["components"]["schemas"]["ObservationV2"]
known, required = set(schema["properties"]), set(schema["required"])
rows = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))["data"]
unknown = {k for r in rows for k in r} - known
missing = [(i, k) for i, r in enumerate(rows) for k in required if k not in r]
print(f"{len(rows)} 行;规范里有 {len(known)} 个字段,其中 {len(required)} 个必填")
print("样例里规范没有的字段:", sorted(unknown) or "无")
print("缺的必填字段:", missing or "无")
```

<div class="line-notes">

- `import yaml` PyYAML,Python 世界里读 YAML 的标准包,≈ 前端的 `js-yaml`。OpenAPI 文件是 YAML 写的。
- `schema = spec["components"]["schemas"]["ObservationV2"]` OpenAPI 把每种数据的形状放在 `components.schemas` 下面,v2 接口返回的一条 observation 叫 `ObservationV2`。
- `known, required = set(schema["properties"]), set(schema["required"])` `properties` 是所有字段(我查到 42 个),`required` 是必填的(11 个)。
- `unknown = {k for r in rows for k in r} - known` 集合推导式:所有行出现过的键,减去规范里有的。剩下的就是我手滑写错的字段名。
- `missing = [(i, k) for i, r in enumerate(rows) for k in required if k not in r]` 每一行缺了哪个必填字段。

</div>

```bash
uv run python -m scratch.s12_check_keys /Users/你/langfuse-openapi.yml ../samples/weather_langfuse.json
```

我第一次跑时,转换脚本里还没有那四个 `modelId`、`inputPrice` 之类的字段,输出是:

```text
6 行;规范里有 42 个字段,其中 11 个必填
样例里规范没有的字段: 无
缺的必填字段: [(0, 'inputPrice'), (0, 'outputPrice'), (0, 'totalPrice'), (0, 'modelId'), (1, 'inputPrice'), ...
```

补上以后:

```text
6 行;规范里有 42 个字段,其中 11 个必填
样例里规范没有的字段: 无
缺的必填字段: 无
```

看一眼样例文件里的三种行(我把长字符串截短了),重点看 `input` 和 `output`:

```json
{
 "id": "61ae330224ddb14f",
 "traceId": "51d91320d144ee7d815b7648ea5e02f6",
 "startTime": "2026-10-27T05:03:43.354Z",
 "endTime": "2026-10-27T05:03:44.497Z",
 "parentObservationId": "2f041f301d8db504",
 "type": "GENERATION",
 "name": "chat deepseek-flash",
 "level": "DEFAULT",
 "input": "[{\"role\": \"system\", \"content\": \"你是天气助手。需要气温时调用 get_weather,不要自己编。\"}, {…",
 "output": "{\"role\": \"assistant\", \"content\": \"我先查一下这三个城市的气温。\", \"tool_calls\": [{\"id…",
 "model": "deepseek-flash",
 "usageDetails": { "input": 310, "output": 106, "total": 416 },
 "totalCost": null
}
```

(上面省略了 `projectId`、`environment`、`tags` 等和导入无关的字段。)

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="Langfuse 的一行 observation 怎么对应到 Loupe 的 Step:左边是接口返回的字段,右边是 Step 的字段,中间标出要做的转换">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
<text x="24" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">v2 observation 的一行</text>
<text x="400" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Loupe 的 Step</text>
<rect x="20" y="40" width="200" height="236" fill="var(--compute-wash)" stroke="var(--compute)"/>
<rect x="420" y="40" width="200" height="236" fill="var(--mem-wash)" stroke="var(--mem)"/>
<g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
<text x="32" y="64">type: "GENERATION"</text>
<text x="32" y="96">startTime / endTime</text>
<text x="32" y="128">parentObservationId</text>
<text x="32" y="160">input / output (字符串)</text>
<text x="32" y="192">usageDetails.input</text>
<text x="32" y="224">totalCost / costDetails</text>
<text x="32" y="256">level: "ERROR"</text>
<text x="432" y="64">kind: "llm"</text>
<text x="432" y="96">started_at / ended_at</text>
<text x="432" y="128">parent_idx</text>
<text x="432" y="160">input / output (对象)</text>
<text x="432" y="192">input_tokens</text>
<text x="432" y="224">cost_usd</text>
<text x="432" y="256">error</text>
</g>
<g font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">
<text x="320" y="62">查类型表</text>
<text x="320" y="94">带 Z 的 ISO → UTC</text>
<text x="320" y="126">id → 排序后的序号</text>
<text x="320" y="158">json.loads 再解一次</text>
<text x="320" y="190">取 input 键</text>
<text x="320" y="222">没有就读 total</text>
<text x="320" y="254">statusMessage 当报错</text>
</g>
<g stroke="var(--ink-faint)" fill="none">
<path d="M222 60 H418"/><path d="M222 92 H418"/><path d="M222 124 H418"/><path d="M222 156 H418"/><path d="M222 188 H418"/><path d="M222 220 H418"/><path d="M222 252 H418"/>
</g>
</svg>
<figcaption>琥珀色是别人的格式(接口返回的字段),蓝色是我们的模型。中间一列是导入器要做的事。没有一行是复制过来就能用的,每一行都要转一道。</figcaption>
</figure>

### 故意制造一次:input 不解析

我写导入器时第一版直接把 `o["input"]` 塞进 `Step.input`。`Step.input` 的类型是 `Any`,字符串当然合法,所以**不会报任何错**,问题要到后面才冒出来。用一个小脚本重演:

```python
# agent-loupe/server/scratch/s13_naive_langfuse.py
import json
import sys
from pathlib import Path

from loupe.models import Step

rows = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["data"]
gen = next(r for r in rows if r["type"] == "GENERATION")
print(type(gen["input"]).__name__, gen["input"][:60])
step = Step(run_id="r", idx=0, kind="llm", name=gen["name"],
            started_at=gen["startTime"], ended_at=gen["endTime"], input=gen["input"])
print(step.input[:40])
print(step.input[0]["role"])
```

<div class="line-notes">

- `gen = next(r for r in rows if r["type"] == "GENERATION")` 取第一个模型调用那一行。
- `print(type(gen["input"]).__name__, gen["input"][:60])` 打印类型和前 60 个字符,确认它是 `str`。
- `step = Step(run_id="r", idx=0, kind="llm", name=gen["name"],` 直接构造一个 `Step`,`started_at` 传的是带 `Z` 的字符串,pydantic 会转成 UTC 时间(Day 652)。
- `print(step.input[:40])` 能切片,因为它是字符串。看起来一切正常。
- `print(step.input[0]["role"])` 前端要拿 `messages[0].role` 时就是这一行。字符串的第 0 个元素是 `[` 这个字符。

</div>

```bash
uv run python -m scratch.s13_naive_langfuse ../samples/weather_langfuse.json
```

```text
str [{"role": "system", "content": "你是天气助手。需要气温时调用 get_weather,不
[{"role": "system", "content": "你是天气助手。需
Traceback (most recent call last):
  ...
    print(step.input[0]["role"])
          ~~~~~~~~~~~~~^^^^^^^^
TypeError: string indices must be integers, not 'str'
```

这个错放在导入这一刻不会出,要等到 Day 665 的详情面板读 `input.messages`、Day 669 把 `input` 发回给模型重跑时才炸,离出错的代码隔了十几天。所以解析要在导入器里做,而且要有测试:测试里断言 `step.input` 是个**列表装的字典**,不是字符串。

### 再演一次:时间别当字符串排

Langfuse 的时间是 ISO 字符串,而且**不保证都带 `Z`**,也可能是 `+08:00` 这种偏移。直接对字符串排序,偏移不同时顺序是错的:

```python
# agent-loupe/server/scratch/s14_string_sort.py
from datetime import datetime

times = ["2026-10-27T05:00:00Z", "2026-10-27T10:00:00+08:00"]
print(sorted(times))
print(sorted(times, key=datetime.fromisoformat))
```

<div class="line-notes">

- `times = ["2026-10-27T05:00:00Z", "2026-10-27T10:00:00+08:00"]` 第二个是北京时间十点,换算成 UTC 是凌晨两点,其实比第一个早三小时。
- `print(sorted(times))` 字符串比较是逐字符的,`05` 小于 `10`,所以第一个排前面。错的。
- `key=datetime.fromisoformat` 先转成带时区的时间再比。Python 3.11 起 `fromisoformat` 认识结尾的 `Z`,我们用的是 3.12。

</div>

```text
['2026-10-27T05:00:00Z', '2026-10-27T10:00:00+08:00']
['2026-10-27T10:00:00+08:00', '2026-10-27T05:00:00Z']
```

[Day 652](/blog/agent-zero/day-652-loupe-model/) 讲过「时区不统一就存成字符串排序」,今天换了个场合又踩一遍。排序用的是 `datetime`,不是字符串。

不过得说实话:在这个导入器里,排错**不会**直接让最终顺序出错,因为最后的 `normalize` 会再按 `datetime` 排一遍。我一开始写的测试(两个不同偏移的时间、一早一晚)就是这样,我把导入器里的排序故意改成按字符串,测试照样全绿,它根本没守住任何东西。排序真正会出事的地方是**同一时刻开始**的两步:`normalize` 的排序是稳定的,同时刻的谁在前取决于导入器交给它的顺序,而父应该在子前面。所以测试改成了下面「同一时刻、不同写法」那一个,我把排序改成字符串再跑,它才红。这种「故意改坏代码、看测试红不红」的做法叫**变异测试**,Day 657 复习时会正式做一遍。

## 写 Langfuse 导入器

结构和 Day 654 一样分层,每层一个小函数:

```python
# agent-loupe/server/loupe/importers/langfuse.py
from datetime import datetime
from typing import Any

from loupe.importers.genai import maybe_json
from loupe.importers.otlp import read_documents
from loupe.models import Run, Step, StepKind, Trace, normalize

KIND_BY_TYPE: dict[str, StepKind] = {
    "GENERATION": "llm", "TOOL": "tool", "AGENT": "agent",
    "RETRIEVER": "retrieval", "EMBEDDING": "retrieval",
}


def observations_of(text: str) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for doc in read_documents(text):
        if isinstance(doc, list):
            found += doc
        elif isinstance(doc, dict) and isinstance(doc.get("data"), list):
            found += doc["data"]
        elif isinstance(doc, dict) and isinstance(doc.get("observations"), list):
            found += doc["observations"]
        else:
            raise ValueError("不是 Langfuse 导出:要么是数组,要么有 data(或 observations)数组")
    return found


def llm_input(raw: Any) -> Any:
    value = maybe_json(raw)
    if isinstance(value, list):
        return {"messages": value, "tools": None}
    return value


def observation_to_step(o: dict[str, Any]) -> Step:
    kind = KIND_BY_TYPE.get(str(o.get("type", "")).upper(), "other")
    usage = o.get("usageDetails") or {}
    cost = o.get("totalCost")
    if cost is None:
        cost = (o.get("costDetails") or {}).get("total")
    failed = o.get("level") == "ERROR"
    return Step(
        run_id="", idx=0, kind=kind, name=o.get("name") or kind,
        started_at=o["startTime"], ended_at=o.get("endTime") or o["startTime"],
        input=llm_input(o.get("input")) if kind == "llm" else maybe_json(o.get("input")),
        output=maybe_json(o.get("output")),
        error=(o.get("statusMessage") or "error") if failed else None,
        input_tokens=usage.get("input"), output_tokens=usage.get("output"),
        cost_usd=cost, model=o.get("model"))


def import_langfuse(text: str) -> list[Trace]:
    by_trace: dict[str, list[dict[str, Any]]] = {}
    for o in observations_of(text):
        by_trace.setdefault(o["traceId"], []).append(o)

    traces: list[Trace] = []
    for trace_id, obs in by_trace.items():
        obs.sort(key=lambda o: datetime.fromisoformat(o["startTime"]))
        idx_of = {o["id"]: i for i, o in enumerate(obs)}
        steps = [observation_to_step(o).model_copy(update={
            "idx": i, "parent_idx": idx_of.get(o.get("parentObservationId") or "")})
            for i, o in enumerate(obs)]
        root_i = next((i for i, s in enumerate(steps) if s.parent_idx is None), 0)
        tags = next((o["tags"] for o in obs if o.get("tags")), [])
        run = Run(id=trace_id, name=obs[0].get("traceName") or steps[root_i].name,
                  started_at=steps[root_i].started_at, ended_at=steps[root_i].ended_at,
                  status="error" if steps[root_i].error else "ok",
                  tags=[*tags, "langfuse"])
        traces.append(normalize(run, steps))
    return traces
```

<div class="line-notes">

- `from loupe.importers.otlp import read_documents` Day 654 的「整个文件是一个 JSON,还是一行一个」的读法,直接借用。导出文件如果是分页拼起来的(一页一行),它也能读。
- `KIND_BY_TYPE: dict[str, StepKind] = {` Langfuse 的类型名到我们五种 `kind`。没列出来的(`SPAN`、`CHAIN`、`EVENT`、`EVALUATOR`、`GUARDRAIL` 等)一律走 `other`,和 Day 653「不认识的操作名一律 other」同一个原则。
- `def observations_of(text: str)` 只管「拆包装」:不管文件是数组、`{"data": [...]}` 还是 `{"observations": [...]}`,都拿出 observation 的列表。`data` 是我对照 OpenAPI 确认的 v2 形状;数组和 `observations` 是兼容别的导出方式,**我这次没有查到对应的文档,不保证真实存在**,所以放在 `elif` 里当兜底。
- `raise ValueError("不是 Langfuse 导出:` 认不出就抛带说明的 `ValueError`,Day 656 的统一入口会把它换成给用户看的错误。
- `value = maybe_json(raw)` `input` 和 `output` 是 JSON 字符串,先解一次。`maybe_json` 只对以 `[` 或 `{` 开头的字符串尝试解析,失败了原样返回,所以模型回答 `"[注意] 北京今天…"` 这种碰巧以 `[` 开头的文本也不会炸。
- `return {"messages": value, "tools": None}` Langfuse 的 OpenAI 集成记的 input 是消息列表本身。Day 652 约定 llm 步的 `input` 是 `{"messages": [...], "tools": ...}`,所以包一层。`tools` 是 `None`:这份数据里没有工具定义。
- `kind = KIND_BY_TYPE.get(str(o.get("type", "")).upper(), "other")` `.upper()` 是防御:万一导出工具把类型写成小写。
- `usage = o.get("usageDetails") or {}` 没选 `usage` 字段组时整个字段不存在,选了但没记时是 `null`。`or {}` 两种都兜住。
- `if cost is None:` `totalCost` 优先,没有再读 `costDetails.total`。真实样例里两个都是 `null`,成本到 Day 660 由价格表补。
- `failed = o.get("level") == "ERROR"` Langfuse 的级别有 `DEBUG`、`DEFAULT`、`WARNING`、`ERROR` 四种。只有 `ERROR` 算报错,`WARNING` 不算。
- `started_at=o["startTime"], ended_at=o.get("endTime") or o["startTime"],` `endTime` 是可空的(规范里 `nullable`):还没结束的 observation 是 `null`。这时让结束时间等于开始时间,耗时显示 0,比抛错强。
- `input=llm_input(o.get("input")) if kind == "llm" else maybe_json(o.get("input")),` 模型步包成 `{"messages": ...}`,其他步骤(工具参数 `{"city": "Beijing"}`)只解开 JSON。
- `error=(o.get("statusMessage") or "error") if failed else None,` 报错原因在 `statusMessage`,没写就用 `"error"` 占位。
- `input_tokens=usage.get("input"), output_tokens=usage.get("output"),` 用量字典的键是 `input` 和 `output`,不是 OpenAI 的 `prompt_tokens`。
- `by_trace.setdefault(o["traceId"], []).append(o)` 按 `traceId` 收拢,一个文件里有几条 trace 就返回几个 `Trace`。
- `obs.sort(key=lambda o: datetime.fromisoformat(o["startTime"]))` 刚才演示过:转成 `datetime` 再排。接口给的顺序是从新到旧,这一行把它翻回来。
- `idx_of = {o["id"]: i for i, o in enumerate(obs)}` 排好以后建「observation id → 序号」的表。
- `idx_of.get(o.get("parentObservationId") or "")` 查父亲的序号。根的 `parentObservationId` 是 `None`,`or ""` 之后查不到,得 `None`;父 ID 指向这批数据之外(上面说的 app root 情况)同样查不到,得 `None`,自动成为根。
- `root_i = next((i for i, s in enumerate(steps) if s.parent_idx is None), 0)` 排在最前面、没有父亲的那一步当根,找不到就用第 0 步。
- `tags = next((o["tags"] for o in obs if o.get("tags")), [])` `tags` 是 trace 上的,Langfuse 把它冗余写到每个 observation 上,取第一个有值的。
- `run = Run(id=trace_id, name=obs[0].get("traceName") or steps[root_i].name,` 运行名优先用 trace 的名字(`traceName`),没有就用根步骤的名字。
- `status="error" if steps[root_i].error else "ok",` 和 Day 654 一样,运行状态只看根。一个工具报错、Agent 照常给出回答,不算失败。
- `tags=[*tags, "langfuse"])` 末尾加一个 `langfuse` 标记来源,Day 662 的列表页可以按它筛。
- `traces.append(normalize(run, steps))` 最后交给同一个 `normalize`:把序号收尾、补汇总。

</div>

用真实样例看一次结果。再写一个小脚本:

```python
# agent-loupe/server/scratch/s11_langfuse.py
import sys
from pathlib import Path

from loupe.importers.langfuse import import_langfuse

[trace] = import_langfuse(Path(sys.argv[1]).read_text(encoding="utf-8"))
r = trace.run
print(r.id[:8], r.name, r.status, r.tags, r.model, r.total_input_tokens, r.total_output_tokens, r.total_cost_usd)
for s in trace.steps:
    secs = (s.ended_at - s.started_at).total_seconds()
    print(s.idx, s.parent_idx, s.kind, s.name, f"{secs:.2f}s", s.input_tokens, s.cost_usd)
print(trace.steps[2].input, trace.steps[2].output)
print(type(trace.steps[1].input["messages"]), [m["role"] for m in trace.steps[5].input["messages"]])
print(trace.steps[5].output)
```

<div class="line-notes">

- `[trace] = import_langfuse(` 列表解包,要求恰好一个元素,多了少了都会报错。我们知道样例里只有一条 trace。
- `print(r.id[:8],` 打印运行的 id 前 8 位、名字、状态、标签、模型、总 token、总成本。
- `print(s.idx, s.parent_idx, s.kind, s.name, f"{secs:.2f}s", s.input_tokens, s.cost_usd)` 每一步一行:序号、父序号、类型、名字、耗时、输入 token、成本。
- `print(trace.steps[2].input, trace.steps[2].output)` 第 2 步是第一个工具调用,看参数和结果是不是已经是字典。
- `[m["role"] for m in trace.steps[5].input["messages"]]` 第 5 步是最后一次模型调用,它的输入应该是 6 条消息:system、user、assistant 和三条 tool。

</div>

```bash
uv run python -m scratch.s11_langfuse ../samples/weather_langfuse.json
```

```text
51d91320 invoke_agent weather_agent ok ['weather', 'langfuse'] deepseek-flash 799 190 0.0
0 None agent invoke_agent weather_agent 8.67s None None
1 0 llm chat deepseek-flash 1.14s 310 None
2 0 tool execute_tool get_weather 2.16s None None
3 0 tool execute_tool get_weather 2.13s None None
4 0 tool execute_tool get_weather 2.15s None None
5 0 llm chat deepseek-flash 1.08s 489 None
{'city': 'Beijing'} {'city': 'Beijing', 'temp_c': 13.2}
<class 'list'> ['system', 'user', 'assistant', 'tool', 'tool', 'tool']
{'role': 'assistant', 'content': '三个城市现在的气温:\n\n| 城市 | 气温 |\n|---|---|\n| 北京 | 13.2 °C |\n| 上海 | 19.9 °C |\n| 广州 | 31.2 °C |\n\n平均气温 = (13.2 + 19.9 + 31.2) ÷ 3 = 64.3 ÷ 3 ≈ **21.4 °C**'}
```

接口给的是从新到旧,导入后按时间排回来了,第 0 步是根,其余五步的父亲都是它。总 token `799 / 190` 是两次模型调用相加(`310 + 489`,`106 + 84`),是 `normalize` 补出来的。三次工具调用各约 2.1 秒、一个接一个,这就是 Day 649 发现的那个慢点,换了一种来源照样看得见。

### 两个没验证的假设

写这个导入器时我有两处是**猜的**,你拿到真实的 Langfuse 导出后要核对:

1. 模型步的 `input`:我假设 OpenAI 集成记下来的就是消息列表。如果你的数据里是 `{"messages": [...], "tools": [...]}` 这样的对象,`llm_input` 会原样放过去,工具定义也就跟着进来了,这是好事。
2. `output`:我假设是一条 assistant 消息对象。如果是别的形状,放进 `Step.output` 也不会错(它是 `Any`),只是 Day 665 的详情面板可能不会按消息的样子渲染。

这两处等你手里有真实导出再改,别指望我替你验证过。

### 测试

测试分两类:手写的最小数据,每个测试钉一个坑;再加一个读真实样例的。新建 `tests/test_langfuse.py`:

```python
# agent-loupe/server/tests/test_langfuse.py
import json
from pathlib import Path
from typing import Any

import pytest

from loupe.importers.langfuse import import_langfuse

SAMPLES = Path(__file__).parents[2] / "samples"


def obs(oid: str, otype: str, start: str, end: str | None, parent: str | None = None, **extra: Any) -> dict[str, Any]:
    return {"id": oid, "traceId": "t1", "type": otype, "name": oid, "startTime": start, "endTime": end,
            "parentObservationId": parent, **extra}


ROWS = [
    obs("tool1", "TOOL", "2026-10-27T05:00:01.000Z", "2026-10-27T05:00:02.500Z", "root", level="ERROR",
        statusMessage="ConnectTimeout", input='{"city": "Beijing"}', output="not json at all"),
    obs("gen1", "GENERATION", "2026-10-27T05:00:00.100Z", "2026-10-27T05:00:00.900Z", "root", model="deepseek-flash",
        input='[{"role": "user", "content": "北京多少度"}]', output='{"role": "assistant", "content": "13 度"}',
        usageDetails={"input": 310, "output": 106, "total": 416}, totalCost=0.00012),
    obs("root", "AGENT", "2026-10-27T05:00:00.000Z", None, None, traceName="weather-demo", tags=["prod"]),
]


def test_shuffled_rows_sorted_and_parents_remapped() -> None:
    [trace] = import_langfuse(json.dumps({"data": ROWS, "meta": {}}))
    assert [(s.name, s.parent_idx) for s in trace.steps] == [("root", None), ("gen1", 0), ("tool1", 0)]
    assert trace.run.name == "weather-demo"
    assert trace.run.tags == ["prod", "langfuse"]


def test_input_output_are_raw_strings_parsed_back() -> None:
    [trace] = import_langfuse(json.dumps({"data": ROWS}))
    gen, tool = trace.steps[1], trace.steps[2]
    assert gen.input == {"messages": [{"role": "user", "content": "北京多少度"}], "tools": None}
    assert gen.output == {"role": "assistant", "content": "13 度"}
    assert tool.input == {"city": "Beijing"}
    assert tool.output == "not json at all"


def test_error_level_usage_cost_and_missing_end_time() -> None:
    [trace] = import_langfuse(json.dumps({"data": ROWS}))
    root, gen, tool = trace.steps
    assert tool.error == "ConnectTimeout"
    assert (gen.input_tokens, gen.output_tokens, gen.model) == (310, 106, "deepseek-flash")
    assert trace.run.total_cost_usd == pytest.approx(0.00012)
    assert root.ended_at == root.started_at
    assert trace.run.ended_at.isoformat() == "2026-10-27T05:00:02.500000+00:00"
    assert trace.run.status == "ok"


def test_cost_details_total_is_fallback() -> None:
    rows = [obs("a", "GENERATION", "2026-10-27T05:00:00Z", "2026-10-27T05:00:01Z", costDetails={"input": 1.0, "total": 3.0})]
    [trace] = import_langfuse(json.dumps(rows))
    assert trace.steps[0].cost_usd == 3.0


def test_equal_start_in_different_offsets_keeps_parent_first() -> None:
    # 同一时刻:北京时间 10:00 就是 UTC 02:00。按字符串排,子(02:00:00Z)会跑到父(10:00:00+08:00)前面
    rows = [obs("parent", "AGENT", "2026-10-27T10:00:00+08:00", "2026-10-27T10:00:05+08:00"),
            obs("child", "TOOL", "2026-10-27T02:00:00Z", "2026-10-27T02:00:01Z", parent="parent")]
    [trace] = import_langfuse(json.dumps(rows))
    assert [s.name for s in trace.steps] == ["parent", "child"]
    assert [s.parent_idx for s in trace.steps] == [None, 0]
    assert trace.steps[0].started_at.isoformat() == "2026-10-27T02:00:00+00:00"


def test_app_root_with_dangling_parent_is_still_root() -> None:
    rows = [obs("root", "AGENT", "2026-10-27T05:00:00Z", "2026-10-27T05:00:03Z", parent="not-in-this-export"),
            obs("c", "TOOL", "2026-10-27T05:00:01Z", "2026-10-27T05:00:02Z", parent="root")]
    [trace] = import_langfuse(json.dumps(rows))
    assert [s.parent_idx for s in trace.steps] == [None, 0]


def test_pages_one_per_line_and_two_traces() -> None:
    other = obs("x", "SPAN", "2026-10-27T06:00:00Z", "2026-10-27T06:00:01Z") | {"traceId": "t2"}
    page1 = json.dumps({"data": ROWS[:2], "meta": {"cursor": "abc"}})
    page2 = json.dumps({"data": [ROWS[2], other], "meta": {}})
    traces = import_langfuse(page1 + "\n" + page2)
    assert sorted(len(t.steps) for t in traces) == [1, 3]


def test_not_langfuse_raises() -> None:
    with pytest.raises(ValueError):
        import_langfuse('{"hello": 1}')


def test_real_weather_sample() -> None:
    [trace] = import_langfuse((SAMPLES / "weather_langfuse.json").read_text(encoding="utf-8"))
    assert [s.kind for s in trace.steps] == ["agent", "llm", "tool", "tool", "tool", "llm"]
    assert all(s.parent_idx == 0 for s in trace.steps[1:])
    assert set(trace.steps[2].output) == {"city", "temp_c"}
    llm_tokens = [s.input_tokens for s in trace.steps if s.kind == "llm"]
    assert trace.run.total_input_tokens == sum(t for t in llm_tokens if t)
    assert [m["role"] for m in trace.steps[5].input["messages"]][-3:] == ["tool", "tool", "tool"]
```

<div class="line-notes">

- `SAMPLES = Path(__file__).parents[2] / "samples"` `__file__` 是 `server/tests/test_langfuse.py`,`parents[2]` 是 `agent-loupe/`。
- `def obs(oid: str, otype: str, start: str, end: str | None, parent: str | None = None, **extra: Any)` 造一个最小 observation 的小工厂,`**extra` 接收其他字段(`level`、`model`、`input` 等)。每个测试只写它关心的那几个。
- `ROWS = [` 三行故意**倒着**放:工具在前,模型调用居中,根在最后。导入器必须自己排。
- `obs("tool1", "TOOL",` 工具那一行带 `level="ERROR"` 和 `statusMessage`,输出故意写成一个不是 JSON 的字符串 `"not json at all"`。
- `usageDetails={"input": 310, "output": 106, "total": 416}, totalCost=0.00012),` 模型那一行带用量和成本。
- `obs("root", "AGENT", "2026-10-27T05:00:00.000Z", None, None, traceName="weather-demo", tags=["prod"]),` 根的 `endTime` 是 `None`,测「没结束」的情况。
- `[trace] = import_langfuse(json.dumps({"data": ROWS, "meta": {}}))` 外面套 v2 接口的壳。
- `assert [(s.name, s.parent_idx) for s in trace.steps] == [("root", None), ("gen1", 0), ("tool1", 0)]` 排序和父子重映射一起验:根在 0,另外两个的父亲都是 0。
- `assert tool.output == "not json at all"` 解析失败的字符串原样保留,不炸。
- `assert root.ended_at == root.started_at` 没有结束时间,耗时 0。
- `assert trace.run.ended_at.isoformat() == "2026-10-27T05:00:02.500000+00:00"` 运行的结束时间由 `normalize` 取所有步骤里最晚的。
- `costDetails={"input": 1.0, "total": 3.0}` 只给 `costDetails`、不给 `totalCost`,验证兜底。
- `rows = [obs("parent", "AGENT", "2026-10-27T10:00:00+08:00",` 刚才 `s14` 那个坑的测试版,而且是**能抓到它**的版本:父和子在同一时刻开始,只是一个写成北京时间、一个写成 UTC。字符串排序会把 `02:00:00Z` 排到 `10:00:00+08:00` 前面,子跑到父前面,「父的编号小于子」的约定就破了。
- `assert [s.parent_idx for s in trace.steps] == [None, 0]` 真正守住约定的是这一行。
- `parent="not-in-this-export"` 父 ID 指向导出之外,根仍然是根。
- `other = obs("x", "SPAN",` 字典合并运算符 `|`(Python 3.9 起),≈ JS 的 `{...a, ...b}`。
- `page1 + "\n" + page2` 两页拼成「一行一页」的文件,验证 `read_documents` 的复用,以及两条 trace 被分开。
- `with pytest.raises(ValueError):` 不是 Langfuse 导出就该抛 `ValueError`。
- `assert set(trace.steps[2].output) == {"city", "temp_c"}` 真实样例里气温每次不一样,所以只断言键,不断言具体值。

</div>

```bash
uv run pytest tests/test_langfuse.py -q
```

```text
.........                                                                [100%]
9 passed in 0.14s
```

## 导入器三:自研 SDK

前两个导入器读的都是别人的格式,别人记什么我们就只能看什么。Day 653 的真跑已经看到了:OpenTelemetry 的自动埋点不记工具定义。回头看 PRD 里的功能三:**从任意一步改参数重跑**。重跑要把当时发给模型的 messages 和 tools 原样再发一遍,少一样就不是「重跑」了。所以我们需要一个**一定会记全**的来源,而最省事的办法是自己写。

要求有四条:单个文件,复制到任何 Agent 项目里就能用;只用标准库,不让用户为了看 trace 装一堆依赖;每次模型调用记下完整的 messages 和 tools;不影响业务代码,不开记录时几乎没有开销。

### 文件格式:一行一条记录

格式先想清楚,代码才好写。SDK 写出来的是 JSONL(JSON Lines,每行一个 JSON 对象的文本文件,[格式说明](https://jsonlines.org/)),一共三种记录:

- `run_start`:一次运行开始。`id`、`name`、`started_at`、`tags`。
- `step`:一步**结束**时写一行。`run_id`、`idx`、`parent_idx`、`kind`、`name`、`started_at`、`ended_at`、`input`、`output`,模型步还有 `model`、`input_tokens`、`output_tokens`。字段名**和 Day 652 的 `Step` 一模一样**,所以导入器几乎不用转换。
- `run_end`:一次运行结束。`ended_at`、`status`。

为什么选 JSONL 而不是一个大 JSON?因为 Agent 会崩溃。一个大 JSON 要等整次运行结束才能写出去,中途进程被杀,什么都没留下。JSONL 一步结束就往文件末尾**追加**一行,被杀的时候已经完成的步骤都已经在磁盘上了。

有两个细节要想清楚,不然会写出 bug:

**编号在步骤开始时分配,记录在步骤结束时写。** 嵌套的步骤(Agent 包着模型和工具)里,子步骤先结束、先写进文件,父步骤后写。所以文件里的顺序是「子在前、父在后」,不是编号顺序。编号在开始时分配,保证了「父的编号一定比子小」(Day 652 的约定),代价是导入器要按编号或时间重排,`normalize` 本来就在做。

**input 要在调用那一刻拷贝。** SDK 在步骤开始时拿到的 `input` 是调用方手里的对象(比如工具的参数、发给模型的 `messages` 列表),而记录要等步骤**结束**才写。这中间,函数体可能把自己的参数改掉(一个工具边取边清空传进来的列表),别的任务也可能往同一个列表里追加。如果只存引用,写出来的就不是「调用时的样子」。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="嵌套步骤的编号和写入顺序:agent 的编号是 0 最先开始,但最后一个写进文件;两个子步骤编号 1、2,先结束先写">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
<text x="24" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">时间 →</text>
<g font-family="var(--font-mono)" font-size="11">
<rect x="24" y="44" width="420" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="34" y="64" fill="var(--ink)">idx 0 agent(开始最早,结束最晚)</text>
<rect x="44" y="84" width="150" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="54" y="104" fill="var(--ink)">idx 1 llm</text>
<rect x="204" y="84" width="110" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="214" y="104" fill="var(--ink)">idx 2 tool</text>
</g>
<text x="24" y="148" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">文件里一行一行的顺序(往末尾追加)</text>
<g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
<rect x="24" y="160" width="124" height="28" fill="none" stroke="var(--rule)"/><text x="32" y="179">run_start</text>
<rect x="154" y="160" width="124" height="28" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="162" y="179">step idx 1</text>
<rect x="284" y="160" width="124" height="28" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="292" y="179">step idx 2</text>
<rect x="414" y="160" width="124" height="28" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="422" y="179">step idx 0</text>
<rect x="544" y="160" width="76" height="28" fill="none" stroke="var(--rule)"/><text x="552" y="179">run_end</text>
</g>
<text x="24" y="224" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">进程在 step idx 2 之后被杀:前两行的信息都在;但根 agent 步还没写,run_end 也没有。</text>
</svg>
<figcaption>子步骤先结束、先落盘,父步骤最后写。进程被杀时,完成的子步骤都保住了,丢的是还没结束的根步骤和 run_end。导入器要能处理这种「半截」文件。</figcaption>
</figure>

### 写 SDK

在 `server/` 下新建 `loupe_sdk.py`。注意它在 `server/` 根目录,不在 `loupe/` 包里:它是要被复制走的单个文件,不该依赖包里的任何东西,所以连 `from loupe.models import ...` 都不能写。

```python
# agent-loupe/server/loupe_sdk.py
"""Agent Loupe 轻量 SDK:单文件、只用标准库,把一次 Agent 运行写成 JSONL。

    import loupe_sdk as loupe
    loupe.wrap_openai(client)                 # 每次 chat.completions.create 记一个 llm 步
    @loupe.trace_step(kind="tool")            # 普通函数记成 tool 步
    def get_weather(city): ...
    with loupe.run("weather-demo", out="runs.jsonl", tags=["demo"]):
        agent.run("...")
"""
import contextvars
import functools
import inspect
import json
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _snapshot(obj: Any) -> Any:
    """深拷贝成纯 JSON。工具可能在函数体里改自己的参数,不拷贝的话记下来的就不是调用时的样子。"""
    return json.loads(json.dumps(obj, ensure_ascii=False, default=str))


class _Run:
    def __init__(self, name: str, out: str, tags: list[str]) -> None:
        self.id = uuid.uuid4().hex[:12]
        self.name = name
        self.path = Path(out)
        self.tags = tags
        self.status = "ok"
        self.next_idx = 0
        self.stack: list[int] = []  # 正在进行中的步骤,栈顶就是新步骤的父步骤

    def write(self, record: dict[str, Any]) -> None:
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")


_current: contextvars.ContextVar[_Run | None] = contextvars.ContextVar("loupe_run", default=None)


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
def step(kind: str, name: str, input: Any = None, **extra: Any) -> Iterator[dict[str, Any]]:
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


def trace_step(kind: str = "tool", name: str | None = None) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    def deco(fn: Callable[..., Any]) -> Callable[..., Any]:
        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            arguments = dict(inspect.signature(fn).bind(*args, **kwargs).arguments)  # 参数名 -> 值
            with step(kind, name or fn.__name__, input=arguments) as rec:
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
        if kwargs.get("stream"):  # 流式不记,原样放行
            return create(**kwargs)
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

<div class="line-notes">

- `import contextvars` 标准库里的「上下文变量」,先当成「每个线程、每个异步任务各有一份的全局变量」。后面讲为什么用它。
- `from collections.abc import Callable, Iterator` 类型标注要用的两个名字。`Callable` ≈ TS 里的函数类型 `(...args) => any`。
- `from datetime import UTC, datetime` `UTC` 是 Python 3.11 起有的常量,Day 652 的 `models.py` 也用了它。
- `def _now() -> str:` 下划线开头表示「模块内部用,别从外面 import」。返回带时区的 ISO 字符串,形如 `2026-10-27T05:07:26.110827+00:00`。
- `return json.loads(json.dumps(obj, ensure_ascii=False, default=str))` 先序列化再反序列化,得到一份和原对象**完全无关**的深拷贝。`default=str` 是兜底:遇到 JSON 不认识的对象(比如 `datetime`)转成字符串,不抛 `TypeError`。
- `self.id = uuid.uuid4().hex[:12]` 运行 id:随机 UUID 的前 12 个十六进制字符,够区分,又比 32 位短。我这次是 `8faf0e65cdc4`。
- `self.next_idx = 0` 下一步的编号,每开始一步加一。
- `self.stack: list[int] = []` 正在进行中的步骤的编号栈。新步骤开始时,栈顶就是它的父亲。这是个**普通列表**,练习 3 会让你看到它在并发时的问题。
- `with self.path.open("a", encoding="utf-8") as f:` `"a"` 是追加模式。每写一条记录就打开、写、关闭一次,慢一点,但进程被杀时不会有缓冲区里没写出去的内容。
- `_current: contextvars.ContextVar[_Run | None] = contextvars.ContextVar("loupe_run", default=None)` 当前是哪个 `run`,存在 ContextVar 里。用全局变量也能跑,但多线程、异步任务同时跑多个 Agent 时会串。
- `@contextmanager` 把一个带 `yield` 的函数变成可以 `with` 的东西([Day 98](/blog/agent-zero/day-098-context-managers/)讲过)。`yield` 之前相当于 `__enter__`,之后相当于 `__exit__`。
- `token = _current.set(r)` 设置当前 run,拿到一个「令牌」,结束时用它还原。
- `r.write({"type": "run_start",` 开始就写第一行。就算整个运行里一步都没记成,文件里也至少有这一行,看得出来「跑过」。
- `except Exception:` 运行里有异常冒出来:状态记成 `error`,然后 `raise` 原样抛出去。**SDK 不能吞业务代码的异常。**
- `finally:` 不管成功失败都写 `run_end` 并还原当前 run。
- `def step(kind: str, name: str, input: Any = None, **extra: Any)` 记一步。`input` 这个名字盖住了 Python 内置的 `input()`,在这个函数里没关系,而且和 `Step.input` 字段对齐。`**extra` 接 `model=...` 这类额外字段。
- `if r is None:` 没有包在 `run()` 里:`yield {}` 给调用方一个空字典让它随便写,然后什么都不记。业务代码里的 `@trace_step` 可以一直留着。
- `idx = r.next_idx` 开始时就分配编号。
- `"parent_idx": r.stack[-1] if r.stack else None,` 栈里有东西,栈顶就是父亲;空的就是根。
- `"input": _snapshot(input), **extra,` 就是这一行:**调用那一刻拷贝**。`**extra` 把 `model="deepseek-flash"` 这类字段并进记录。
- `r.stack.append(idx)` 把自己压栈,里面再开始的步骤会把我当父亲。
- `yield rec  # 调用方把 output、token 等写进 rec` 把还没写完的记录交给调用方,调用方往里填 `output`、`input_tokens`。
- `rec["error"] = f"{type(e).__name__}: {e}"` 异常记成 `ZeroDivisionError: division by zero` 这样的文本,然后 `raise` 继续抛。
- `r.stack.pop()` 出栈,不管成功还是失败。
- `rec["output"] = _snapshot(rec.get("output"))` 输出也拷贝一次,同样的理由。没设置输出就是 `None`。
- `r.write(rec)` 最后写文件。这一行在 `finally` 里,所以报错的步骤也会落盘,而且带着 `error`。
- `arguments = dict(inspect.signature(fn).bind(*args, **kwargs).arguments)` 把调用的参数按名字对上:`get_weather("Beijing")` 和 `get_weather(city="Beijing")` 都得到 `{"city": "Beijing"}`。`inspect.signature(fn)` 取函数签名,`.bind(...)` 把实参绑到形参上。这样工具步的 input 和 OTLP 导入进来的(`{"city": "Beijing"}`)是同一个形状。
- `with step(kind, name or fn.__name__, input=arguments) as rec:` 没指定名字就用函数名。
- `rec["output"] = out` 把返回值交给 `step`,它会在结束时拷贝并写出去。
- `create = client.chat.completions.create` 先把原来的方法存下来。openai SDK 的客户端是普通对象,可以直接给属性赋新值,这种做法叫**猴子补丁**(monkey patch)。
- `if kwargs.get("stream"):` 流式调用返回的是一个迭代器,不是完整的响应,下面读 `resp.choices[0]` 会炸。所以流式的直接放行、**不记**。
- `inp = {"messages": kwargs.get("messages"), "tools": kwargs.get("tools")}` 这就是 SDK 比自动埋点强的地方:完整的 messages 和 tools 都在。形状和 Day 652 约定的 llm 步 input 一致。
- `with step("llm", f"chat {model}", input=inp, model=model) as rec:` 名字写成 `chat deepseek-flash`,和 OTLP 里 span 的命名习惯对齐。
- `out["tool_calls"] = [tc.model_dump() for tc in msg.tool_calls]` openai SDK 的 `tool_calls` 是 pydantic 对象,`model_dump()` 转成普通字典。
- `reasoning = getattr(msg, "reasoning_content", None)` 推理模型([Day 115](/blog/agent-zero/day-115-reasoning-models/) 讲过)会带 `reasoning_content`,不是所有厂商都有,用 `getattr` 带默认值。
- `rec["input_tokens"] = resp.usage.prompt_tokens` 用量。字段名用 `Step` 的 `input_tokens`,不是 OpenAI 的 `prompt_tokens`。
- `client.chat.completions.create = traced` 把补丁装上。之后 Agent 里任何地方调这个客户端的 `create`,走的都是 `traced`。

</div>

### 先跑一个最小的

写一个不调模型的小脚本,看 SDK 到底写出了什么:

```python
# agent-loupe/server/scratch/s15_sdk_hello.py
from pathlib import Path

import loupe_sdk as loupe

OUT = Path("scratch/out/hello.jsonl")
OUT.unlink(missing_ok=True)


@loupe.trace_step(kind="tool")
def get_temp(city: str) -> float:
    return {"Beijing": 13.2, "Shanghai": 19.9}[city]


with loupe.run("hello", out=str(OUT), tags=["demo"]):
    with loupe.step("agent", "agent.run", input="北京和上海几度?"):
        get_temp("Beijing")
        get_temp("Shanghai")

for n, line in enumerate(OUT.read_text(encoding="utf-8").splitlines()):
    print(n, line[:150])
```

<div class="line-notes">

- `OUT = Path("scratch/out/hello.jsonl")` 输出放在 `scratch/out/`,先 `mkdir -p scratch/out`。这个目录不提交。
- `OUT.unlink(missing_ok=True)` 文件存在就删掉,不存在也不报错。SDK 是追加写,不清掉的话每跑一次多一份。
- `@loupe.trace_step(kind="tool")` 装饰器,≈ 前端的高阶函数 `withTrace(fn)`。
- `with loupe.run("hello", out=str(OUT), tags=["demo"]):` 开始一次运行,写第一行 `run_start`。
- `with loupe.step("agent", "agent.run", input="北京和上海几度?"):` 手动开一个 agent 步,里面调两次工具,它们会自动把它当父亲。
- `print(n, line[:150])` 每行只打印前 150 个字符,不然太长。

</div>

```bash
mkdir -p scratch/out
uv run python -m scratch.s15_sdk_hello
```

```text
0 {"type": "run_start", "id": "8faf0e65cdc4", "name": "hello", "started_at": "2026-10-27T05:07:26.110827+00:00", "tags": ["demo"]}
1 {"type": "step", "run_id": "8faf0e65cdc4", "idx": 1, "parent_idx": 0, "kind": "tool", "name": "get_temp", "started_at": "2026-10-27T05:07:26.112931+00
2 {"type": "step", "run_id": "8faf0e65cdc4", "idx": 2, "parent_idx": 0, "kind": "tool", "name": "get_temp", "started_at": "2026-10-27T05:07:26.113387+00
3 {"type": "step", "run_id": "8faf0e65cdc4", "idx": 0, "parent_idx": null, "kind": "agent", "name": "agent.run", "started_at": "2026-10-27T05:07:26.1128
4 {"type": "run_end", "id": "8faf0e65cdc4", "ended_at": "2026-10-27T05:07:26.114353+00:00", "status": "ok"}
```

五行:一个 `run_start`、三个 `step`、一个 `run_end`。第 3 行的 `idx` 是 0:agent 步是**第一个开始**的,却是**第一个之后才写**的,正好是上面那张图。`id` 每次运行都不一样,`started_at` 当然也是。

### 再证明一次为什么要拷贝

不用 SDK,用一个会改参数的小工具演示「存引用」和「存拷贝」的差别:

```python
# agent-loupe/server/scratch/s16_no_snapshot.py
import json
from typing import Any


def drain(items: list[int]) -> int:
    total = 0
    while items:
        total += items.pop()  # 一个会改参数的工具:边取边清空
    return total


args = [3, 5, 8]
by_reference: dict[str, Any] = {"input": {"items": args}}
by_copy: dict[str, Any] = {"input": json.loads(json.dumps({"items": args}))}

print("总和:", drain(args))

print("存引用:", by_reference["input"])
print("存拷贝:", by_copy["input"])
```

<div class="line-notes">

- `def drain(items: list[int]) -> int:` 一个工具,把传进来的列表一个个 `pop` 出来求和,列表最后是空的。写得不好,但真实代码里「顺手改参数」比你想的常见。
- `args = [3, 5, 8]` 调用前的参数。
- `by_reference: dict[str, Any] = {"input": {"items": args}}` 字典里放的是 `args` 这个列表**本身**,不是它的内容。JS 里 `{ items: args }` 一样是引用语义。
- `by_copy: dict[str, Any] = {` 先 `dumps` 成文本、再 `loads` 回对象,得到一个和 `args` 毫无关系的新列表。
- `print("总和:", drain(args))` 调用工具,`args` 被改空。
- `print("存引用:", by_reference["input"])` 引用那份跟着变了。

</div>

```text
总和: 16
存引用: {'items': []}
存拷贝: {'items': [3, 5, 8]}
```

记录里本该是「调用时参数是 `[3, 5, 8]`」,存引用的版本写出来却是空列表,看 trace 的人会纳闷「它根据什么算出 16 的」。我这里要诚实说一点:`wrap_openai` 记 `messages` 时,步骤结束写文件在 Agent 往列表里追加回答**之前**,所以对「模型调用」这一类,存引用多数时候碰巧不出问题。拷贝真正保护的是**步骤进行期间**被改动的参数(像这个 `drain`),以及以后任何「先攒着、晚点再写」的改法。Day 656 的造数脚本就是后一种:记录先放在内存列表里,最后才写文件,所以那里的 `list(messages)` 不能省。

### 写 SDK 的导入器

SDK 的格式是我们自己定的,导入器最简单:一行一行读,三种记录分别处理。要认真对待的是**不完整的文件**。

```python
# agent-loupe/server/loupe/importers/sdk_jsonl.py
import json
from typing import Any

from loupe.models import Run, Step, StepKind, Trace, normalize

KINDS: tuple[StepKind, ...] = ("llm", "tool", "agent", "retrieval", "other")


def read_records(text: str) -> list[dict[str, Any]]:
    lines = [(n, line) for n, line in enumerate(text.splitlines(), 1) if line.strip()]
    records: list[dict[str, Any]] = []
    for pos, (n, line) in enumerate(lines):
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError as e:
            if pos == len(lines) - 1:  # 最后一行写到一半进程就没了:丢掉这一行,别丢整个文件
                break
            raise ValueError(f"第 {n} 行不是合法 JSON:{e.msg}") from e
    return records


def record_to_step(rec: dict[str, Any]) -> Step:
    fields = {k: v for k, v in rec.items() if k != "type"}
    if fields.get("kind") not in KINDS:
        fields["kind"] = "other"
    fields.setdefault("run_id", "")
    return Step.model_validate(fields)


def import_sdk_jsonl(text: str) -> list[Trace]:
    starts: dict[str, dict[str, Any]] = {}
    ends: dict[str, dict[str, Any]] = {}
    steps_by_run: dict[str, list[Step]] = {}
    for rec in read_records(text):
        kind = rec.get("type")
        if kind == "run_start":
            starts[rec["id"]] = rec
        elif kind == "run_end":
            ends[rec["id"]] = rec
        elif kind == "step":
            steps_by_run.setdefault(rec["run_id"], []).append(record_to_step(rec))

    traces: list[Trace] = []
    for run_id in dict.fromkeys([*starts, *steps_by_run]):
        steps = steps_by_run.get(run_id, [])
        start, end = starts.get(run_id, {}), ends.get(run_id)
        first = min((s.started_at for s in steps), default=None)
        last = max((s.ended_at for s in steps), default=None)
        started = start.get("started_at") or first
        ended = (end or {}).get("ended_at") or last or started
        run = Run.model_validate({
            "id": run_id, "name": start.get("name", run_id), "started_at": started, "ended_at": ended,
            # 没有 run_end:进程多半是中途死了,记成 error
            "status": end["status"] if end else "error",
            "tags": [*start.get("tags", []), "sdk"]})
        traces.append(normalize(run, steps))
    return traces
```

<div class="line-notes">

- `KINDS: tuple[StepKind, ...] = ("llm", "tool", "agent", "retrieval", "other")` Day 652 里 `kind` 只许五种。SDK 的使用者可能手写 `loupe.step("planner", ...)`,所以导入时要把不认识的转成 `other`。
- `lines = [(n, line) for n, line in enumerate(text.splitlines(), 1) if line.strip()]` 每行配上行号(从 1 开始),空行丢掉。行号是为了报错时告诉用户「第几行坏了」。
- `for pos, (n, line) in enumerate(lines):` `pos` 是在非空行列表里的位置,`n` 是原来的行号,两个用途不同。
- `if pos == len(lines) - 1:` 坏的是**最后一行**。进程被杀的时候,最后一次 `write` 可能只写了一半,这就是它的样子:`{"type": "step", "run_id": "r1", "id`。丢掉这一行,别丢整个文件。
- `raise ValueError(f"第 {n} 行不是合法 JSON:{e.msg}") from e` 坏的在中间,说明文件被动过手脚,或者根本不是我们的文件,这时候该报错,不能悄悄吞掉。`from e` 把原始异常接成「因为」。
- `fields = {k: v for k, v in rec.items() if k != "type"}` 记录里除了 `type` 以外的键,和 `Step` 的字段名一样。这就是前面说「字段名和 Day 652 一模一样」的好处。
- `fields.setdefault("run_id", "")` 缺 `run_id` 就补空串,最后 `normalize` 会统一改成运行的 id。
- `return Step.model_validate(fields)` 交给 pydantic 校验。时间字符串在这里被转成 UTC 的 `datetime`,缺必填字段会抛 `ValidationError`。
- `starts: dict[str, dict[str, Any]] = {}` 按运行 id 收集三种记录。一个文件里可以有好几次运行(SDK 是追加写)。
- `steps_by_run.setdefault(rec["run_id"], []).append(record_to_step(rec))` 步骤按所属运行分组。
- `for run_id in dict.fromkeys([*starts, *steps_by_run]):` 要处理的运行 id:有 `run_start` 的,加上只有步骤、没有 `run_start` 的(文件开头被截掉了)。`dict.fromkeys` 去重且保持顺序,集合 `{...}` 会打乱顺序,测试里「先 first 后 second」就不稳定了。
- `first = min((s.started_at for s in steps), default=None)` 没有任何步骤时 `min` 会报错,`default=None` 避免。
- `ended = (end or {}).get("ended_at") or last or started` 结束时间的优先级:`run_end` 写的,其次最后一步的结束,最后退回开始时间。
- `"status": end["status"] if end else "error",` 没有 `run_end`,说明进程没走到收尾,按 error 算。**有** `run_end` 就信它写的。
- `"tags": [*start.get("tags", []), "sdk"]})` 末尾加 `sdk` 标记来源。
- `traces.append(normalize(run, steps))` 同样交给 `normalize`:文件里是「子在前、父在后」,这里按开始时间重排并重新编号。

</div>

读刚才的 `hello.jsonl`,写一个小脚本:

```python
# agent-loupe/server/scratch/s17_sdk_import.py
import sys
from pathlib import Path

from loupe.importers.sdk_jsonl import import_sdk_jsonl

for trace in import_sdk_jsonl(Path(sys.argv[1]).read_text(encoding="utf-8")):
    r = trace.run
    print(r.id, r.name, r.status, r.tags, f"{(r.ended_at - r.started_at).total_seconds() * 1000:.1f}ms")
    for s in trace.steps:
        print(" ", s.idx, s.parent_idx, s.kind, s.name, s.input, s.output)
```

<div class="line-notes">

- `for trace in import_sdk_jsonl(` 返回列表,一个文件可能有多次运行,所以用 `for` 而不是解包。
- `f"{(r.ended_at - r.started_at).total_seconds() * 1000:.1f}ms"` 两个 `datetime` 相减得到 `timedelta`,`.total_seconds()` 转成秒,乘 1000 变毫秒。
- `print(" ", s.idx, s.parent_idx, s.kind, s.name, s.input, s.output)` 每一步一行。

</div>

```bash
uv run python -m scratch.s17_sdk_import scratch/out/hello.jsonl
```

```text
8faf0e65cdc4 hello ok ['demo', 'sdk'] 3.5ms
  0 None agent agent.run 北京和上海几度? None
  1 0 tool get_temp {'city': 'Beijing'} 13.2
  2 0 tool get_temp {'city': 'Shanghai'} 19.9
```

文件里 agent 在最后一个记录,导入后排回了第 0 位,两个工具的父亲都是 0。`get_temp` 的 `input` 是 `{'city': 'Beijing'}`,参数名对上了,不是 `{'args': ['Beijing']}`。

### 故意制造一次:进程被杀

用 Day 656 才会正式生成的真实文件做这个演示太早,先用另一个办法:拿 `weather_sdk.jsonl`(Day 656 的产物,你现在没有它也没关系,换成上面的 `hello.jsonl` 照样能做),取前几行再拼半行,模拟进程在写第五步的时候被杀了。下面是我用真实文件做的:

```bash
head -n 5 samples/weather_sdk.jsonl > scratch/out/killed.jsonl
sed -n 6p samples/weather_sdk.jsonl | head -c 300 >> scratch/out/killed.jsonl
uv run python -m scratch.s17_sdk_import scratch/out/killed.jsonl | cut -c1-110
```

```text
c70cc39b6020 weather-agent error ['weather', 'deepseek', 'sdk'] 7863.2ms
  0 None llm chat deepseek-flash {'messages': [{'role': 'system', 'content': '你是天气助手。需要气温时调用 get_weather,不要自己编。'}, {'rol
  1 None tool get_weather {'city': 'Beijing'} {'city': 'Beijing', 'temp_c': 13.2}
  2 None tool get_weather {'city': 'Shanghai'} {'city': 'Shanghai', 'temp_c': 19.9}
  3 None tool get_weather {'city': 'Guangzhou'} {'city': 'Guangzhou', 'temp_c': 31.2}
```

这次的文件是 `run_start` 加四个完成的步骤,再加第六行的前 300 个字符(没写完,`json.loads` 会失败,被丢掉)。结果:四个步骤都读出来了,运行状态是 `error`(没有 `run_end`),耗时按最后一个完成的步骤算。**但是 `parent_idx` 全是 `None`**:这四个步骤的父亲是根 agent 步,而根最后才写,被杀时它还没落盘,所以它们的父亲「不存在」,`normalize` 把指向不存在的父亲的步骤当成了根。数据没丢,树丢了。

这是这个格式的取舍,我选择接受它:每步结束才写,记下的是「完成的事实」,不需要在步骤开始时先写一行「我开始了」再改。如果你的 Agent 经常崩,可以在 SDK 里给每一步加一条 `step_start` 记录,代价是文件翻倍。我没有做,写在 README 的已知限制里。

### SDK 的测试

`tests/test_sdk.py` 一共 11 个测试,覆盖往返、落盘顺序、异常、没有 run 时不记、深拷贝、半截文件、假 OpenAI 客户端。新建:

```python
# agent-loupe/server/tests/test_sdk.py
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

import loupe_sdk as loupe
from loupe.importers.sdk_jsonl import import_sdk_jsonl


def test_roundtrip_nested_steps(tmp_path: Path) -> None:
    out = tmp_path / "runs.jsonl"

    @loupe.trace_step(kind="tool")
    def add(a: int, b: int) -> int:
        return a + b

    with loupe.run("sdk-test", out=str(out), tags=["t"]):
        with loupe.step("agent", "outer"):
            add(1, 2)
    [trace] = import_sdk_jsonl(out.read_text(encoding="utf-8"))
    assert [(s.name, s.parent_idx, s.kind) for s in trace.steps] == [("outer", None, "agent"), ("add", 0, "tool")]
    assert trace.steps[1].input == {"a": 1, "b": 2}
    assert trace.steps[1].output == 3
    assert trace.run.status == "ok"
    assert trace.run.tags == ["t", "sdk"]


def test_file_order_is_children_first_but_idx_order_wins(tmp_path: Path) -> None:
    out = tmp_path / "runs.jsonl"
    with loupe.run("order", out=str(out)):
        with loupe.step("agent", "parent"):
            with loupe.step("tool", "child"):
                pass
    names = [json.loads(line).get("name") for line in out.read_text(encoding="utf-8").splitlines()]
    assert names == ["order", "child", "parent", None]
    [trace] = import_sdk_jsonl(out.read_text(encoding="utf-8"))
    assert [s.name for s in trace.steps] == ["parent", "child"]


def test_exception_marks_step_and_run_as_error(tmp_path: Path) -> None:
    out = tmp_path / "runs.jsonl"
    with pytest.raises(ZeroDivisionError):
        with loupe.run("boom", out=str(out)):
            with loupe.step("tool", "divide"):
                1 / 0
    [trace] = import_sdk_jsonl(out.read_text(encoding="utf-8"))
    assert trace.steps[0].error == "ZeroDivisionError: division by zero"
    assert trace.run.status == "error"


def test_step_outside_run_records_nothing(tmp_path: Path) -> None:
    with loupe.step("tool", "orphan") as rec:
        rec["output"] = 1
    assert list(tmp_path.iterdir()) == []


def test_input_is_copied_before_the_function_mutates_it(tmp_path: Path) -> None:
    out = tmp_path / "runs.jsonl"

    @loupe.trace_step(kind="tool")
    def drain(items: list[int]) -> int:
        total = 0
        while items:
            total += items.pop()  # 工具在函数体里把参数改光了
        return total

    with loupe.run("mutate", out=str(out)):
        drain([3, 5, 8])
    [trace] = import_sdk_jsonl(out.read_text(encoding="utf-8"))
    assert trace.steps[0].input == {"items": [3, 5, 8]}
    assert trace.steps[0].output == 16


def test_no_run_end_means_crashed() -> None:
    lines = [json.dumps({"type": "run_start", "id": "r1", "name": "crashed", "started_at": "2026-10-27T05:00:00+00:00"}),
             json.dumps({"type": "step", "run_id": "r1", "idx": 0, "kind": "llm", "name": "chat",
                         "started_at": "2026-10-27T05:00:00+00:00", "ended_at": "2026-10-27T05:00:05+00:00"})]
    [trace] = import_sdk_jsonl("\n".join(lines))
    assert trace.run.status == "error"
    assert trace.run.ended_at.second == 5


def test_half_written_last_line_is_dropped_but_middle_garbage_is_an_error() -> None:
    good = json.dumps({"type": "run_start", "id": "r1", "name": "x", "started_at": "2026-10-27T05:00:00+00:00"})
    [trace] = import_sdk_jsonl(good + '\n{"type": "step", "run_id": "r1", "id')
    assert trace.steps == []
    with pytest.raises(ValueError, match="第 2 行"):
        import_sdk_jsonl(good + "\nnot json\n" + good)


def test_unknown_kind_becomes_other() -> None:
    rec = {"type": "step", "run_id": "r1", "idx": 0, "kind": "planner", "name": "p",
           "started_at": "2026-10-27T05:00:00+00:00", "ended_at": "2026-10-27T05:00:01+00:00"}
    [trace] = import_sdk_jsonl(json.dumps(rec))
    assert trace.steps[0].kind == "other"
    assert trace.run.name == "r1"


def test_two_runs_appended_to_one_file(tmp_path: Path) -> None:
    out = tmp_path / "runs.jsonl"
    for name in ("first", "second"):
        with loupe.run(name, out=str(out)):
            with loupe.step("tool", "t"):
                pass
    traces = import_sdk_jsonl(out.read_text(encoding="utf-8"))
    assert [t.run.name for t in traces] == ["first", "second"]


def fake_client(content: str = "13 度") -> SimpleNamespace:
    def create(**kwargs: Any) -> SimpleNamespace:
        call = SimpleNamespace(model_dump=lambda: {"id": "c1", "type": "function",
                                                    "function": {"name": "get_weather", "arguments": "{}"}})
        msg = SimpleNamespace(content=content, tool_calls=[call] if kwargs.get("tools") else None)
        return SimpleNamespace(choices=[SimpleNamespace(message=msg)],
                               usage=SimpleNamespace(prompt_tokens=42, completion_tokens=7))
    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))


def test_wrap_openai_records_llm_step(tmp_path: Path) -> None:
    out = tmp_path / "runs.jsonl"
    client = loupe.wrap_openai(fake_client())
    with loupe.run("llm", out=str(out)):
        client.chat.completions.create(model="m1", messages=[{"role": "user", "content": "hi"}], tools=[{"type": "function"}])
    [trace] = import_sdk_jsonl(out.read_text(encoding="utf-8"))
    s = trace.steps[0]
    assert (s.kind, s.name, s.model, s.input_tokens, s.output_tokens) == ("llm", "chat m1", "m1", 42, 7)
    assert s.input == {"messages": [{"role": "user", "content": "hi"}], "tools": [{"type": "function"}]}
    assert s.output is not None and s.output["tool_calls"][0]["function"]["name"] == "get_weather"


def test_wrap_openai_lets_streaming_through_unrecorded(tmp_path: Path) -> None:
    out = tmp_path / "runs.jsonl"
    client = loupe.wrap_openai(fake_client())
    with loupe.run("s", out=str(out)):
        client.chat.completions.create(model="m1", messages=[], stream=True)
    assert len(out.read_text(encoding="utf-8").splitlines()) == 2  # 只有 run_start 和 run_end
```

<div class="line-notes">

- `def test_roundtrip_nested_steps(tmp_path: Path) -> None:` `tmp_path` 是 pytest 自带的 fixture,每个测试拿到一个全新的临时目录,测完自动清理。
- `@loupe.trace_step(kind="tool")` 在测试函数里直接定义并装饰一个小函数 `add`。
- `assert trace.steps[1].input == {"a": 1, "b": 2}` `inspect.signature(...).bind` 的效果:位置参数 `add(1, 2)` 被记成按名字的字典。
- `assert names == ["order", "child", "parent", None]` 文件里的顺序:`run_start`(有 `name`:`order`)、子、父、`run_end`(没有 `name`,`.get` 得 `None`)。这个测试把「子在前、父在后」钉死了。
- `assert [s.name for s in trace.steps] == ["parent", "child"]` 导入后父在前。
- `with pytest.raises(ZeroDivisionError):` 断言**异常确实被原样抛了出来**,SDK 没有吞掉它。
- `assert trace.steps[0].error == "ZeroDivisionError: division by zero"` 报错文本的格式。
- `assert list(tmp_path.iterdir()) == []` 没包在 `run()` 里的 `step` 什么文件都没写。
- `total += items.pop()  # 工具在函数体里把参数改光了` 函数返回时 `items` 已经是空列表。
- `assert trace.steps[0].input == {"items": [3, 5, 8]}` 记录里的 input 仍然是调用时的 `[3, 5, 8]`,这是 `_snapshot` 的功劳。我把 `"input": _snapshot(input)` 改成 `"input": input` 再跑,这个测试红了。我最初写的版本是在步骤结束**之后**才往列表里追加,把 `_snapshot` 删掉它照样绿,测试根本没守住拷贝,Day 657 的变异测试把它抓出来了。
- `assert trace.steps[0].output == 16` 返回值也对。
- `assert trace.run.ended_at.second == 5` 没有 `run_end`,结束时间等于最后一步的结束。
- `import_sdk_jsonl(good + '\n{"type": "step", "run_id": "r1", "id')` 末尾拼半行,模拟被杀。结果是没有步骤、不报错。
- `with pytest.raises(ValueError, match="第 2 行"):` 坏行在中间,必须报错,而且错误消息里要说清楚是第几行。`match` 是正则搜索。
- `"kind": "planner"` 不认识的类型。
- `assert trace.run.name == "r1"` 没有 `run_start` 时,运行名退回 id。
- `for name in ("first", "second"):` 同一个文件里追加两次运行。
- `def fake_client(content: str = "13 度") -> SimpleNamespace:` 一个不联网的假 openai 客户端:`SimpleNamespace` 随手造出有 `chat.completions.create` 这条属性链的对象,返回值也是同样随手造的。≈ 前端测试里的 `jest.fn()` 手写 mock。
- `msg = SimpleNamespace(content=content, tool_calls=[call] if kwargs.get("tools") else None)` 传了 `tools` 就假装模型要调工具,没传就是普通回答。
- `client = loupe.wrap_openai(fake_client())` 给假客户端装补丁,和给真的装一样。
- `assert (s.kind, s.name, s.model, s.input_tokens, s.output_tokens) == ("llm", "chat m1", "m1", 42, 7)` 五个字段一起验。
- `assert s.input == {"messages":` **工具定义被记下来了**。这就是自研 SDK 存在的理由。
- `stream=True` 流式调用不记,文件只剩两行。这是一个**已知限制**,测试把它写成了行为。

</div>

```bash
uv run pytest tests/test_langfuse.py tests/test_sdk.py -q
```

```text
....................                                                     [100%]
20 passed in 0.32s
```

(今天新写的 9 个 Langfuse 测试加 11 个 SDK 测试。整个 `tests/` 一起跑的数字取决于你前几天写了多少。)

### 已知限制:写进 README

SDK 有三处限制,今天不改,但要写明白,因为用户会踩:

1. **只记非流式调用。** 流式要边收边拼,复杂一截,我们的 Agent 也没用流式。
2. **`stack` 是普通列表。** 同一个 run 里用 `asyncio.gather` 并发跑几个工具,它们共享这个栈,父子关系会记错。练习 3 让你亲眼看到并修好它。
3. **新开的线程里什么都不记。** `ContextVar` 在 `ThreadPoolExecutor` 的工作线程里默认是空的(不会自动继承),`step()` 发现没有当前 run,就静默跳过。要记的话得手动把上下文带过去,今天不做。

## 今天的文件

| 文件 | 干什么 | 新建还是修改 | 花费 |
| --- | --- | --- | --- |
| `agent-loupe/server/loupe/importers/langfuse.py` | Langfuse observation 导入器 | 新建 | 不花 |
| `agent-loupe/server/loupe_sdk.py` | 单文件轻量 SDK | 新建 | 不花 |
| `agent-loupe/server/loupe/importers/sdk_jsonl.py` | SDK 的 JSONL 导入器 | 新建 | 不花 |
| `agent-loupe/server/tests/test_langfuse.py`、`test_sdk.py` | 9 + 11 个测试 | 新建 | 不花 |
| `agent-loupe/samples/weather_langfuse.json` | 照 OpenAPI 拼出来的 Langfuse 样例 | 新建 | 不花 |
| `agent-loupe/server/pyproject.toml`、`uv.lock` | 加了开发依赖 `pyyaml` | 修改 | |
| `agent-loupe/server/scratch/make_langfuse_sample.py`、`s11` 到 `s17`、`ex655_*.py` | 演示和练习 | 新建,不提交 | 不花 |

`importers/__init__.py` 今天先不动,明天写统一入口时才把三个导入器接在一起。

## 动手练习

**练习 1:分页。** 真实的导出文件很可能是好几页拼起来的。写 `scratch/ex655_pages.py`:把 `samples/weather_langfuse.json` 拆成两页(前 3 行一页,后 3 行一页,第一页的 `meta` 带一个假的 `cursor`),存成「一行一页」的 JSONL,再用 `import_langfuse` 读,确认还是一条 trace、6 步,而且跟没拆之前的结果完全一样。

<details><summary>参考答案</summary>

```python
# agent-loupe/server/scratch/ex655_pages.py
import json
from pathlib import Path

from loupe.importers.langfuse import import_langfuse

src = Path("../samples/weather_langfuse.json")
whole = src.read_text(encoding="utf-8")
rows = json.loads(whole)["data"]

pages = [{"data": rows[:3], "meta": {"cursor": "fake-cursor"}}, {"data": rows[3:], "meta": {}}]
split = "\n".join(json.dumps(p, ensure_ascii=False) for p in pages)

[a] = import_langfuse(whole)
[b] = import_langfuse(split)
print(len(b.steps), "步,和不拆一样:", a.model_dump() == b.model_dump())
print("行数:", len(split.splitlines()))
```

<div class="line-notes">

- `rows = json.loads(whole)["data"]` 取出 6 行 observation。样例是倒序存的,前三行是最新的三步,这正好说明拆成两页以后,**每页内部和页与页之间的顺序都不重要**。
- `pages = [{"data": rows[:3], "meta": {"cursor": "fake-cursor"}}, {"data": rows[3:], "meta": {}}]` 第一页带游标,表示后面还有;最后一页的 `meta` 是空的,表示没有下一页。
- `split = "\n".join(json.dumps(p, ensure_ascii=False) for p in pages)` 每页压成一行,用换行拼起来。`json.dumps` 默认不带缩进,所以一页一行。
- `[a] = import_langfuse(whole)` 不拆的结果。
- `a.model_dump() == b.model_dump()` pydantic 模型转成普通字典再比,两边一模一样才是 `True`。

</div>

```text
6 步,和不拆一样: True
行数: 2
```

能一样,是因为 `read_documents` 先试整体 `json.loads`、失败了再按行读,而 `observations_of` 对每一页都取 `data`,最后拼成一个大列表再按 `traceId` 分组。分页对导入器是透明的。

</details>

**练习 2:工具抛了异常,但被业务代码接住了。** 写 `scratch/ex655_caught.py`:用 `@loupe.trace_step` 装饰一个会抛 `ValueError` 的函数,在 `with loupe.run(...)` 里**用 `try/except` 接住它**,不让异常冒出来。导入后回答:这一步有没有 `error`?运行的 `status` 是什么?为什么?

<details><summary>参考答案</summary>

```python
# agent-loupe/server/scratch/ex655_caught.py
from pathlib import Path

import loupe_sdk as loupe
from loupe.importers.sdk_jsonl import import_sdk_jsonl

OUT = Path("scratch/out/caught.jsonl")
OUT.unlink(missing_ok=True)


@loupe.trace_step(kind="tool")
def parse_city(text: str) -> str:
    if not text:
        raise ValueError("城市名是空的")
    return text.strip()


with loupe.run("caught", out=str(OUT)):
    with loupe.step("agent", "agent.run"):
        try:
            parse_city("")
        except ValueError:
            pass  # Agent 自己处理了:换个办法继续
        parse_city(" 北京 ")

[trace] = import_sdk_jsonl(OUT.read_text(encoding="utf-8"))
print(trace.run.status)
for s in trace.steps:
    print(s.idx, s.name, repr(s.error), repr(s.output))
```

<div class="line-notes">

- `raise ValueError("城市名是空的")` 工具里抛的异常。
- `with loupe.step("agent", "agent.run"):` 外层 agent 步,两次工具调用都在它里面。
- `except ValueError:` 接住异常,Agent 当作「这个办法不行,换一个」。异常**没有**冒出 `with loupe.run(...)`。
- `print(s.idx, s.name, repr(s.error), repr(s.output))` `repr` 让 `None` 显示成 `None`、字符串带引号,看得更清楚。

</div>

```text
ok
0 agent.run None None
1 parse_city 'ValueError: 城市名是空的' None
2 parse_city None '北京'
```

第 1 步有 `error`:异常飞过 `trace_step` 的 `with step(...)` 时被记下了,然后继续往外抛,才被业务代码的 `except` 接住。运行的 `status` 是 `ok`:`run()` 只有在**异常一路冒到它外面**时才记 error,这里没有。这和 Day 652「一步报错不等于运行失败」是同一个原则:`status` 回答「有没有正常结束」,报错的步数是另一个统计量,Day 662 的列表页会单独列一列。

</details>

**练习 3:修好并发时的父子关系。** 写 `scratch/ex655_async.py`,用 `asyncio.gather` 同时跑两个工具(一个睡 0.2 秒,一个睡 0.1 秒),先看现在记成什么样,再把 `loupe_sdk.py` 里的栈改成 `ContextVar`,让两个工具的父亲都是 agent 步。

<details><summary>参考答案</summary>

先写重现脚本:

```python
# agent-loupe/server/scratch/ex655_async.py
import asyncio
from pathlib import Path

import loupe_sdk as loupe
from loupe.importers.sdk_jsonl import import_sdk_jsonl

OUT = Path("scratch/out/async.jsonl")
OUT.unlink(missing_ok=True)


async def tool(name: str, seconds: float) -> None:
    with loupe.step("tool", name):
        await asyncio.sleep(seconds)


async def main() -> None:
    with loupe.run("async-demo", out=str(OUT)):
        with loupe.step("agent", "agent.run"):
            await asyncio.gather(tool("slow", 0.2), tool("fast", 0.1))


asyncio.run(main())
[trace] = import_sdk_jsonl(OUT.read_text(encoding="utf-8"))
for s in trace.steps:
    print(s.idx, s.parent_idx, s.name)
```

<div class="line-notes">

- `async def tool(name: str, seconds: float) -> None:` 一个异步「工具」,在 `step` 里 `await` 睡一会儿,≈ JS 的 `await new Promise(r => setTimeout(r, ms))`。
- `with loupe.step("tool", name):` 在 `await` 前后这个 `with` 都是开着的:`slow` 开着的时候 `fast` 也开始了。
- `await asyncio.gather(tool("slow", 0.2), tool("fast", 0.1))` ≈ `Promise.all`。两个协程同时进行。
- `print(s.idx, s.parent_idx, s.name)` 看每一步的父亲是谁。

</div>

```text
0 None agent.run
1 0 slow
2 1 fast
```

`fast` 的父亲是 1(`slow`),本该是 0。过程是这样的:`slow` 开始,压栈,栈是 `[0, 1]`;`await` 让出控制权,`fast` 开始,看栈顶是 1,把 `slow` 当成了父亲。**栈是整个 run 共享的一个列表,而这两个工具是并发的**。

修法:栈不要放在 `_Run` 对象里,放进一个 `ContextVar`。`asyncio` 每个任务(`gather` 会给每个协程建一个任务)启动时会**复制**当前上下文,之后各自修改各自的,互不干扰。栈用不可变的元组,「压栈」是 `set` 一个新元组,出栈是用令牌还原。改四处:

```python
# agent-loupe/server/loupe_sdk.py(改动的几处)
# 1. _Run.__init__ 里删掉:  self.stack: list[int] = []
# 2. _current 下面加一行:
_stack: contextvars.ContextVar[tuple[int, ...]] = contextvars.ContextVar("loupe_stack", default=())

# 3. step() 里,idx 分配之后:
    stack = _stack.get()
    rec: dict[str, Any] = {
        "type": "step", "run_id": r.id, "idx": idx,
        "parent_idx": stack[-1] if stack else None,
        # ……其余不变
    }
    token = _stack.set((*stack, idx))   # 代替 r.stack.append(idx)

# 4. step() 的 finally 里:
        _stack.reset(token)              # 代替 r.stack.pop()
```

<div class="line-notes">

- `_stack: contextvars.ContextVar[tuple[int, ...]] = contextvars.ContextVar("loupe_stack", default=())` 默认是空元组,表示「没有进行中的步骤」。`tuple[int, ...]` 是「任意长度的整数元组」的类型写法。
- `stack = _stack.get()` 读当前上下文里的栈。每个异步任务读到的是自己那份。
- `"parent_idx": stack[-1] if stack else None,` 和以前一样,栈顶是父亲。
- `token = _stack.set((*stack, idx))` `(*stack, idx)` 是「原来的栈加上我」的新元组。`set` 返回令牌,用来还原。
- `_stack.reset(token)` 还原到进入这一步之前的栈,不管成功还是失败。

</div>

改完再跑:

```text
0 None agent.run
1 0 slow
2 0 fast
```

这一次两个工具的父亲都是 0。`pytest` 里已有的测试不受影响,全部仍然通过。把这次改动留下来,后面 Day 656 以及以后用的 SDK 都是改好的版本;Day 656 的天气 Agent 工具调用是顺序执行的,两个版本表现一样,不用担心今天文章里贴的代码和你改完的不同。

</details>

**验收标准**:`uv run pytest -q` 全部通过;`samples/` 里有 `weather_langfuse.json`;`s15`、`s17` 的输出和上面一致;练习 3 的 `ex655_async` 输出 `0 None / 1 0 / 2 0`。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| observation | Langfuse 对 trace 里一步的叫法,类型有 GENERATION、TOOL、AGENT、SPAN、EVENT 等 |
| cursor(游标) | 分页接口里「下一页从哪里开始」的凭据。返回里带 `cursor` 就还有下一页,没有就到头了 |
| 字段组(`fields`) | Langfuse v2 接口让你点名要哪几组字段(`core`、`basic`、`io`、`model`、`usage`……),没点名的组整个字段都不出现 |
| raw string | 「原始字符串」。Langfuse 的 `input`、`output` 是 JSON 序列化后的文本,要再 `json.loads` 一次 |
| JSONL | JSON Lines,每行一个 JSON 对象的文本文件,适合追加写、边写边读 |
| 追加写 | 打开文件用 `"a"` 模式,只往末尾加,不覆盖已有内容 |
| 猴子补丁(monkey patch) | 运行时替换某个对象已有的方法。`wrap_openai` 就是把客户端的 `create` 换成了带记录的版本 |
| 深拷贝 | 连同内部嵌套的对象一起复制,以后改原对象不影响副本 |
| ContextVar | Python 的上下文变量:每个线程、每个 asyncio 任务各有一份独立的值 |
| `inspect.signature` | 取一个函数的参数列表;`.bind(...)` 把实参按名字对到形参上 |
| 装饰器 | 接收一个函数、返回一个新函数的函数。`@loupe.trace_step` 就是给函数套一层记录 |
| SimpleNamespace | 随手造一个「属性对象」的标准库小工具,测试里拿来造假客户端 |

## 常见误区

**以为 Langfuse 的 `input`、`output` 已经是对象。** v2 接口一律返回字符串。直接塞进 `Step.input` 不报错,要等到前端读 `messages` 才炸,离出错的代码隔了好几天。导入时解开,并写一个断言「是列表装字典」的测试。

**请求时不带 `fields`。** 默认只返回 `core` 和 `basic`:没有 `input`、没有 `output`、没有用量、没有模型。导入后得到一条只有名字和时间的空壳 trace。拉数据的命令里要写 `fields=core,basic,io,model,usage`。

**用字符串排序 ISO 时间。** 带 `Z` 和带 `+08:00` 的混在一起,顺序是错的,而且不报错。转成 `datetime` 再排。

**把「父 ID 不在这批数据里」当成数据损坏。** Langfuse 文档明说了,标成 app root 的 observation 可能保留一个指向别处的父 ID。查不到父亲就当根,别抛错。

**以为成本一定有。** Langfuse 不认识的模型(比如 `deepseek-flash`)算不出钱,`totalCost` 是 `null`。导入器不要把 `None` 当 0 累加,成本由 Day 660 的价格表补。

**SDK 里把 input 存成引用。** 工具在函数体里改自己的参数(或者别的任务往同一个列表里追加),写出来的就不是调用时的样子。`_snapshot` 在步骤开始那一刻就拷贝。

**步骤开始时就写一行,结束时再写一行。** 看起来更不怕崩,其实文件翻倍、导入器要配对、被杀时留下一堆「开始了没结束」的记录。我们选了「结束时写一行」,被杀时丢的只是根步骤的父子关系,不是数据。

**SDK 吞掉业务代码的异常。** 记录是旁路,不能改变业务行为。`except` 里记完错误一定要 `raise`。测试里 `pytest.raises(ZeroDivisionError)` 就是在守这一条。

**测试里让半截的最后一行也报错。** 进程被杀时最后一行写一半是**常态**,不是损坏。只有中间的坏行才该报错。

## 学习资料

### 文档与文章

- [Langfuse 公开 API](https://langfuse.com/docs/api-and-data-platform/features/public-api):怎么用 v2 observations 接口拉数据,`fields` 字段组、游标分页都在这里,写导入器之前读,15 分钟。
- [Langfuse OpenAPI 文件](https://cloud.langfuse.com/generated/api/openapi.yml):接口的机器可读定义,搜 `ObservationV2` 看每个字段的类型和说明,今天的检查脚本就读它,10 分钟。
- [Langfuse Observation Types](https://langfuse.com/docs/observability/features/observation-types):observation 的类型表,对照我们的 `KIND_BY_TYPE`,10 分钟。
- [JSON Lines](https://jsonlines.org/):格式的一页说明,三条规则,5 分钟。
- [Python 文档:contextvars](https://docs.python.org/3/library/contextvars.html):ContextVar 和异步任务的关系,读开头的说明和 `asyncio` 那一段,15 分钟。
- [Python 文档:inspect.Signature.bind](https://docs.python.org/3/library/inspect.html#inspect.Signature.bind):`trace_step` 里把实参对到参数名用的就是它。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1NyMk6QENt&autoplay=0&high_quality=1" title="Agent可观测性从0到1:Langfuse + OpenTelemetry 双剑合璧,打造LLM原生监控体系" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>代码指南 · Agent可观测性从0到1:Langfuse + OpenTelemetry 双剑合璧,打造LLM原生监控体系 · 1 小时 48 分。长,挑讲 Langfuse 界面里 trace 和 observation 长什么样的部分看,对照今天样例里的 type、level、usageDetails 这几个字段。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/epnPfe5am3I" title="Get Started with Langfuse - Open-Source LLM Monitoring" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Dave Ebbelaar · Get Started with Langfuse - Open-Source LLM Monitoring · 英文。从零接入 Langfuse,看它界面上的 trace 和每一步的输入输出,想一想「导出」按钮背后就是今天的接口。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Ym9r5E_hBpA" title="JSON vs JSONL vs NDJSON: What Actually Matters in Production" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Masa Tech Team · JSON vs JSONL vs NDJSON: What Actually Matters in Production · 英文。讲为什么日志类数据用一行一个 JSON,追加写和流式读的好处,对应今天 SDK 的文件格式选择。</figcaption>
</figure>

### 书籍

- **Observability Engineering**,Charity Majors、Liz Fong-Jones、George Miranda,O'Reilly,2022。第 5、6 章讲「结构化事件」和把事件串成 trace,对应 SDK 里一步一条记录、靠父子编号串起来的设计,约 1 小时。
- **Fluent Python**(第 2 版),Luciano Ramalho,O'Reilly,2022。第 18 章讲 `with` 和 `@contextmanager`,SDK 的 `run` 和 `step` 都是它的用法;第 21 章讲异步编程,对应练习 3,各读相关的一节,约 1 小时。

### 开源项目与代码

- [langfuse/langfuse-python](https://github.com/langfuse/langfuse-python):Langfuse 的 Python SDK,看 `@observe` 装饰器怎么实现,和我们的 `trace_step` 对照:它也要处理嵌套和异步,看它怎么传「当前步骤是谁」。
- [open-telemetry/opentelemetry-python](https://github.com/open-telemetry/opentelemetry-python):看 `opentelemetry/context` 目录,OpenTelemetry 在 Python 里正是用 `contextvars` 保存「当前 span」,和练习 3 的修法一个思路。

## 自测

1. Langfuse 的导出里 `input` 为什么要 `json.loads` 一次?不解析,什么时候才会出问题?

<details><summary>答案</summary>

v2 接口把 `input`、`output` 一律当原始字符串返回,Agent 当初记的消息列表被序列化成了 JSON 文本。不解析的话 `Step.input` 是个字符串,pydantic 不会报错(类型是 `Any`),要等前端读 `input.messages` 或者重跑时把它发回模型才炸,离出错的地方隔了好几天。所以导入时解析,并写测试断言解析后是「列表装字典」。

</details>

2. 导入 Langfuse 数据时,一个 observation 的 `parentObservationId` 指向导出文件里不存在的 ID,怎么处理?为什么不报错?

<details><summary>答案</summary>

当成根,`parent_idx` 设为 `None`。Langfuse 文档明说了:被 SDK 标成 app root 的 observation 可能保留一个指向别处的父 ID(比如这个 Agent 是被另一个系统调用的)。另外,分页导出时漏拉了一页,也会出现「父亲不在这批数据里」。这些情况都是合法的输入,报错会让用户拿不到任何东西。

</details>

3. SDK 为什么在步骤开始时分配 `idx`、结束时才写文件?文件里的顺序因此是什么样?

<details><summary>答案</summary>

开始时分配,保证父步骤的编号一定小于子步骤(Day 652 的约定);结束时才写,是因为那时才知道输出、token 数、错误和结束时间,只需要写一行,不用先写「开始」再回头改。文件里是子在前、父在后(子先结束),导入器按开始时间重排并重新编号。

</details>

4. 进程在运行中途被杀,SDK 的文件会是什么样?导入后能得到什么,丢了什么?

<details><summary>答案</summary>

已经结束的步骤都已经追加到文件里了,最后一行可能只写了一半。导入器丢掉写了一半的最后一行,其余完整的步骤都读出来;没有 `run_end`,所以运行状态记成 error,结束时间取最后一个步骤的结束。丢掉的是还没结束的步骤,尤其是最外层的根步骤(它最后才写),所以已完成的子步骤会因为找不到父亲而变成根,树形结构没了,但数据都在。

</details>

5. 面试题:你的 SDK 要在 asyncio 并发里也能记对父子关系。「当前步骤栈」放在哪里?为什么放在 `_Run` 对象里不行?

<details><summary>答案</summary>

放在 `ContextVar` 里,值用不可变的元组,进入一步时 `set` 一个「旧栈加我」的新元组,退出时用令牌还原。`asyncio.gather` 给每个协程建任务,任务启动时复制当前上下文,之后各改各的,互不影响。放在 `_Run` 对象里,所有并发任务共享同一个栈,一个任务压栈后另一个任务开始的步骤就把它当了父亲,父子关系记错。代价是线程池里的工作线程默认不继承上下文,需要手动带过去。

</details>

6. `wrap_openai` 对流式调用的处理是什么?为什么不直接支持?

<details><summary>答案</summary>

`stream=True` 时原样放行、不记录。流式返回的是迭代器,不是完整响应,要边收边拼 `content` 和 `tool_calls` 的片段,最后才知道完整的输出和 token 数,实现复杂一截。我们的 Agent 没有用流式,所以先不支持,并把这个限制写进 README,用一个测试把「不记、不报错」的行为钉住。

</details>

## 明天预告

明天是 Day 656,Loupe(五):统一入口自动识别格式,给 Agent 加记录,造假数据。今天有了三个导入器,但调用方得先知道文件是哪种格式。明天写 `importers/__init__.py` 里的 `detect_format` 和 `import_any`:看文件开头就认出是 OTLP、Langfuse 还是 SDK 的 JSONL,认不出时给一句说人话的错误。然后用 SDK 给 Day 649 的天气 Agent 加上记录,真跑一次,并让它故意查一个不存在的城市,得到一条失败的真实 trace。最后写一个造数脚本,生成一万步的合成 trace,量一下导入要多久。
