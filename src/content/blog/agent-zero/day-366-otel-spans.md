---
title: 'Day 366 · Tracing(三):自己用 OpenTelemetry 打 span'
description: '昨天从 Langfuse 发出去的数据里已经看到,它底下就是 OpenTelemetry 的 span。今天把这层拆开:用官方 SDK 自己建 TracerProvider、挂出口,按 GenAI 语义约定给调模型和调工具打 span,发给本机不用 Docker 跑起来的 Jaeger,再从 Jaeger 的查询接口取回来,用 Day 364 的 print_tree 画出同一张瀑布图。顺带踩两个坑:忘了 set_tracer_provider 时什么都不报,异常被记两遍。'
pubDate: 2026-10-22
regime: none
tags: ['observability', 'tracing', 'opentelemetry', 'agent-zero']
series: 'agent-zero'
day: 366
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 365](/blog/agent-zero/day-365-langfuse/) 给工单 Agent 接上了 Langfuse:一行 `from langfuse import openai` 让每次调模型自动记成 generation,`@observe` 和 `start_as_current_observation` 给 Agent 入口和工具套 observation,`propagate_attributes` 把用户和会话挂到整棵树上,`create_score` 把评测结果写回 trace。没有账号,我们写了一个假收件箱 `part06/fake_langfuse.py`,接住了 SDK 发出的数据。

在收件箱里我们看到一件事:SDK 发的是 `POST /api/public/otel/v1/traces`,请求体是 OpenTelemetry 的 protobuf,解开以后是一个个标准的 span,带着 `user.id`、`session.id` 这些 OpenTelemetry 的通用属性名。也就是说,Langfuse 是建在 OpenTelemetry 上面的一层。今天把这层拆开,直接用 OpenTelemetry 自己打 span。

## 今天要解决的问题

学完今天你应该能:

1. 说清楚 OpenTelemetry SDK 的几个零件:tracer、span、TracerProvider、SpanProcessor、Exporter、Resource,各管什么,数据怎么从你的代码流到 Jaeger。
2. 用 `start_as_current_span` 按 GenAI 语义约定给工单 Agent 的调模型、调工具、整次运行打 span,带上 span kind、状态和 token。
3. 不用 Docker 在本机跑起 Jaeger,把 span 发进去,再用它的查询接口取回来验证。
4. 认出两个坑:忘了 `set_tracer_provider` 时什么都不报;异常被自己记一次、SDK 再记一次。

今天只有一个新概念:**OpenTelemetry SDK**(它的几个零件算一个整体)。GenAI 语义约定的属性名 [Day 364](/blog/agent-zero/day-364-tracing-concepts/) 已经用过,今天是照着它写全。

预计用时 2.5 小时。实跑调了 2 次工单 Agent、2 次一句话的小调用、3 次故意写错模型名的调用(返回 400,不计费),合计输入约 5700、输出约 1100 个 token,按 deepseek-flash 高峰价约 0.02 元,算式在第五步末尾。前置:[Day 364](/blog/agent-zero/day-364-tracing-concepts/) 的 `part06/mini_trace.py`(`print_tree`)和 trace/span 概念;[Day 365](/blog/agent-zero/day-365-langfuse/) 的 `part06/fake_langfuse.py` 和 `part06/lf_view.py`(练习 2 用);[Day 360](/blog/agent-zero/day-360-trajectory-1/) 的 `part06/traj_agent.py`;[Day 98](/blog/agent-zero/day-098-context-managers/) 的上下文管理器;[Day 77](/blog/agent-zero/day-077-server-1/) 的进程和端口。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章,把 `otel_setup.py` 和 `traced_chat` 默写出来,画出 provider、processor、exporter 的关系图;做练习时先自己写,做不出再展开参考答案,看完关掉重写一遍。

## 为什么还要学 OpenTelemetry

Langfuse 已经很好用了,为什么还要往下拆一层?三个实际的原因。

第一,你的 Agent 不会单独存在。后面它会变成一个 HTTP 服务,前面有网关、后面有业务系统,公司的后端服务大概率已经用 OpenTelemetry 接了 Jaeger、Grafana Tempo 或者某个商业的 APM(应用性能监控)平台。你希望一张工单从网关进来、经过 Agent、调到账单服务的整条链路在一个 trace 里,而不是 Agent 那一段在 Langfuse、其余在别处。

第二,不绑定厂商。按 OpenTelemetry 标准打的 span,想发给 Langfuse、Jaeger、Datadog 还是阿里云,改出口配置就行,打 span 的代码不动。Day 365 我们已经亲眼看到 Langfuse 收的就是这个格式。

第三,招聘要求里经常直接写「熟悉 OpenTelemetry」,面试会问 span kind、上下文传播这些。用过 Langfuse 不等于懂这一层。

## OpenTelemetry SDK 的几个零件

OpenTelemetry(常简写成 OTel)是一个开源标准加一套各语言的实现,管三类数据:trace、指标(metrics)和日志(logs)。今天只用 trace 这一块。它的 Python 包分成两层:**API**(`opentelemetry-api`,只有接口,库作者写埋点时只依赖它)和 **SDK**(`opentelemetry-sdk`,真正干活的实现,应用启动时装上)。这样分是为了让库可以放心地埋点:没装 SDK 时,API 的调用全是空操作,不影响性能,下面第一步会亲眼看到这一点。

<figure>
<svg viewBox="0 0 640 290" role="img" aria-label="OpenTelemetry SDK 的数据流:代码用 tracer 开 span,span 结束后交给 TracerProvider,provider 把它依次交给挂在上面的 SpanProcessor,每个 processor 带一个 exporter,分别发往终端、Jaeger、Langfuse">
<rect x="0" y="0" width="640" height="290" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="24" width="180" height="96" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="28" y="46" fill="var(--ink)">你的代码(API)</text>
<text x="28" y="70" fill="var(--ink-soft)">tracer = get_tracer()</text>
<text x="28" y="90" fill="var(--ink-soft)">with tracer.start_</text>
<text x="28" y="106" fill="var(--ink-soft)">  as_current_span()</text>
<line x1="196" y1="72" x2="232" y2="72" stroke="var(--ink-soft)"/>
<text x="200" y="64" fill="var(--ink-faint)">span 结束</text>
<rect x="232" y="24" width="160" height="96" fill="none" stroke="var(--ink-soft)"/>
<text x="244" y="46" fill="var(--ink)">TracerProvider</text>
<text x="244" y="70" fill="var(--ink-soft)">Resource:</text>
<text x="244" y="88" fill="var(--ink-soft)">service.name=</text>
<text x="244" y="104" fill="var(--ink-soft)">cloudledger-agent</text>
<line x1="392" y1="50" x2="424" y2="50" stroke="var(--ink-soft)"/>
<line x1="392" y1="95" x2="424" y2="130" stroke="var(--ink-soft)"/>
<line x1="392" y1="105" x2="424" y2="210" stroke="var(--ink-soft)"/>
<rect x="424" y="30" width="200" height="40" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="434" y="48" fill="var(--ink)">Simple + Console</text>
<text x="434" y="63" fill="var(--ink-soft)">马上打印到终端</text>
<rect x="424" y="110" width="200" height="40" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="434" y="128" fill="var(--ink)">Batch + OTLP/HTTP</text>
<text x="434" y="143" fill="var(--ink-soft)">→ Jaeger :4318</text>
<rect x="424" y="190" width="200" height="40" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="434" y="208" fill="var(--ink)">Batch + OTLP/HTTP</text>
<text x="434" y="223" fill="var(--ink-soft)">→ Langfuse(练习 2)</text>
<text x="16" y="160" fill="var(--ink-soft)">trace.set_tracer_provider(provider)</text>
<text x="16" y="178" fill="var(--ink-faint)">把 provider 设成全局,API 才知道交给谁</text>
<text x="16" y="260" fill="var(--ink-soft)">一个 provider 可以挂多个 processor:同一份 span 发好几个地方</text>
</g>
</svg>
<figcaption>今天要搭的东西。左边是你写埋点代码时接触的 API,中间和右边是 SDK:provider 收下结束的 span,交给每个 processor,processor 决定什么时候发,exporter 决定发到哪、用什么格式。</figcaption>
</figure>

逐个说一句话:

- **tracer**:开 span 的工具。`trace.get_tracer("cloudledger.agent")` 拿一个,名字写的是「谁在埋点」(埋点库或模块名),不是服务名。
- **span**:Day 364 讲过,一步。OpenTelemetry 的 span 比我们手写的多三样东西:kind(这一步是调外部服务、接请求,还是内部处理)、status(成功、出错、没设)、events(这一步里发生的带时间的事件,比如异常)。
- **TracerProvider**:总管。所有结束的 span 都交给它,它再交给挂在上面的 processor。一个进程设一个全局的。
- **Resource**:描述「这些数据是谁产生的」,比如服务名 `service.name`、环境 `deployment.environment.name`,附在每个 span 上。
- **SpanProcessor**:决定什么时候发。`SimpleSpanProcessor` 每结束一个 span 就立刻发,调试方便但会拖慢业务;`BatchSpanProcessor` 攒一批在后台线程里发,生产用它。
- **Exporter**:决定发到哪、什么格式。`ConsoleSpanExporter` 打印到终端,`OTLPSpanExporter` 用 OTLP 协议发给 Jaeger、Langfuse 这类后端,`InMemorySpanExporter` 存在内存里给测试用。

**OTLP**(OpenTelemetry Protocol)是 OpenTelemetry 自己定的传输协议,有 HTTP 和 gRPC 两种,HTTP 版默认端口 4318、路径 `/v1/traces`。Day 365 的假收件箱接的就是 HTTP 版,只是路径前面多了 Langfuse 的 `/api/public/otel`。

## 第一步:最小的例子,打印到终端

装包。Day 365 装 langfuse 时其实已经顺带装上了,这里显式写进依赖,不依赖「顺带」:

```bash
uv add opentelemetry-sdk opentelemetry-exporter-otlp-proto-http
```

2026 年 10 月装到的是 `opentelemetry-sdk 1.45.1` 和 `opentelemetry-exporter-otlp-proto-http 1.45.1`。

```python
# agent-zero-lab/part06/otel_hello.py
"""OpenTelemetry 最小例子:一个根 span 套一个子 span,用官方 SDK 打印到终端。不调模型。
用法: uv run python -m part06.otel_hello"""
from __future__ import annotations

import time

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor

provider = TracerProvider()
provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))
trace.set_tracer_provider(provider)

tracer = trace.get_tracer("cloudledger.agent")

with tracer.start_as_current_span("handle_ticket", attributes={"user.id": "C007"}):
    with tracer.start_as_current_span("execute_tool get_subscription") as span:
        time.sleep(0.05)
        span.set_attribute("gen_ai.tool.name", "get_subscription")
```

<div class="line-notes">

- `from opentelemetry import trace` API 这一层的入口。`trace.get_tracer`、`trace.set_tracer_provider` 都在这里。
- `from opentelemetry.sdk.trace import TracerProvider` 注意路径里有 `sdk`:这是 SDK 的实现,不是 API。
- `from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor` 一个出口、一个处理器,都在 SDK 的 `export` 模块里。
- `provider = TracerProvider()` 建总管。没传 Resource,所以下面的输出里服务名是默认的 `unknown_service:python`。
- `provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))` 从里往外读:建一个「打印到终端」的出口,套一个「立刻发」的处理器,挂到总管上。
- `trace.set_tracer_provider(provider)` 把它设成全局的。少了这一行会怎样,代码下面马上演示。
- `tracer = trace.get_tracer("cloudledger.agent")` 参数是埋点的模块名,会作为 `otel.scope.name` 出现在后端里。
- `with tracer.start_as_current_span("handle_ticket", attributes={"user.id": "C007"}):` 开一个 span 并设成「当前的」。和 Day 364 手写的 `with tracer.span(...)` 用法几乎一样,属性用 `attributes=` 字典传,带点的属性名不用再绕。
- `with tracer.start_as_current_span("execute_tool get_subscription") as span:` 在上一个 `with` 里面开的,自动成为它的孩子。「current」就是 Day 364 那个栈的栈顶。
- `span.set_attribute("gen_ai.tool.name", "get_subscription")` 开完以后再补属性。OpenTelemetry 的属性值只能是字符串、布尔、整数、小数,或者它们组成的列表,不能是字典。

</div>

```bash
uv run python -m part06.otel_hello
```

实测输出(两个 span,这里贴第一个,第二个 `handle_ticket` 结构一样):

```text
{
    "name": "execute_tool get_subscription",
    "context": {
        "trace_id": "0x0957b295031189bccd8e60e07bc6b455",
        "span_id": "0xc31494be13238b66",
        "trace_state": "[]"
    },
    "kind": "SpanKind.INTERNAL",
    "parent_id": "0x78bcb7c926dc95bf",
    "start_time": "2026-10-22T11:13:40.674530Z",
    "end_time": "2026-10-22T11:13:40.728126Z",
    "status": {
        "status_code": "UNSET"
    },
    "attributes": {
        "gen_ai.tool.name": "get_subscription"
    },
    "events": [],
    "links": [],
    "resource": {
        "attributes": {
            "telemetry.sdk.language": "python",
            "telemetry.sdk.name": "opentelemetry",
            "telemetry.sdk.version": "1.45.1",
            "service.instance.id": "04fb5adb-f44f-4760-9e82-6f764e027bb8",
            "service.name": "unknown_service:python"
        },
        "schema_url": ""
    }
}
```

拿它和 Day 364 手写的 span 字典逐项对:`trace_id` 32 个十六进制字符、`span_id` 16 个,一样;`parent_id` 是 `0x78bcb7c9…`,第二个 span `handle_ticket` 的 `span_id` 正是它,`handle_ticket` 的 `parent_id` 是 null,一样;开始结束时间、属性,一样。多出来的就是上一节说的那几样:`kind` 默认 `INTERNAL`;`status` 是 `UNSET`,意思是「没人说它出错」,在 OpenTelemetry 里这就等于成功,不用显式设 OK;`events` 空;`resource` 是 SDK 自动填的。顺序也一样:孩子先结束、先打印,根最后。

现在把 `trace.set_tracer_provider(provider)` 这一行注释掉再跑:

```bash
uv run python -m part06.otel_hello
```

终端什么都没有,退出码 0。不报错,不警告。再写三行看看这时拿到的 span 是什么:

```python
from opentelemetry import trace
t = trace.get_tracer("x")
with t.start_as_current_span("a") as s:
    print(type(s).__name__, s.is_recording(), format(s.get_span_context().trace_id, "032x"))
```

<div class="line-notes">

- `print(type(s).__name__, s.is_recording(), format(s.get_span_context().trace_id, "032x"))` 打印 span 的类名、它是否在记录、以及 trace_id。`format(数字, "032x")` 把整数写成 32 位十六进制,不足的前面补 0。

</div>

实测输出:

```text
NonRecordingSpan False 00000000000000000000000000000000
```

没有全局 provider 时,API 给你的是一个 `NonRecordingSpan`:什么都不记,trace_id 全是 0。这就是「库只依赖 API、没装 SDK 时全是空操作」那条设计在起作用。好处是埋了点的库在没配置的项目里不会出事;坏处和 Day 365 没配 key 一样,配错了你不会知道。**看到 trace_id 全 0,先查 `set_tracer_provider` 有没有调、是不是在开 span 之前调的**。

## 第二步:不用 Docker,在本机跑一个 Jaeger

Jaeger 是 CNCF(云原生计算基金会)的开源分布式追踪系统,收 span、存起来、给一个网页看瀑布图。2.x 版本本身就建在 OpenTelemetry Collector 之上,原生收 OTLP。它不懂 token 和钱,这正好和 Langfuse 互补:Jaeger 看整条服务链路,Langfuse 看 LLM 的细节。

学过 [Day 100](/blog/agent-zero/day-100-docker-1/) 的 Docker,有 Docker 的话一行就能起(这一行我没跑,本机没有 Docker):

```bash
docker run --rm -d --name jaeger -p 16686:16686 -p 4318:4318 jaegertracing/jaeger:2.22.0
```

没有 Docker 也行,Jaeger 在 GitHub 上发了 macOS 的单个可执行文件。我在 scratchpad 里单独建了一个目录放它(你可以放在 `/Users/你/tools/jaeger`,别放进 `agent-zero-lab`):

```bash
mkdir -p ~/tools/jaeger && cd ~/tools/jaeger
curl -sL -o j.tgz https://github.com/jaegertracing/jaeger/releases/download/v2.22.0/jaeger-2.22.0-darwin-amd64.tar.gz
curl -sL -o sum.txt https://github.com/jaegertracing/jaeger/releases/download/v2.22.0/jaeger-2.22.0-darwin-amd64.sha256sum.txt
tar xzf j.tgz
shasum -a 256 jaeger-2.22.0-darwin-amd64/jaeger
grep "/jaeger$" sum.txt
./jaeger-2.22.0-darwin-amd64/jaeger
```

<div class="line-notes">

- `curl -sL -o j.tgz https://github.com/jaegertracing/jaeger/releases/download/v2.22.0/jaeger-2.22.0-darwin-amd64.tar.gz` 2026 年 10 月最新的 v2.22.0(10 月 6 日发布),Intel Mac 用 `darwin-amd64`,M 系列芯片换成 `darwin-arm64`。压缩包 67 MB。
- `curl -sL -o sum.txt https://github.com/jaegertracing/jaeger/releases/download/v2.22.0/jaeger-2.22.0-darwin-amd64.sha256sum.txt` 官方给的校验和文件。从网上下载可执行文件,先核对校验和,确认下到的和官方发布的是同一个文件。
- `shasum -a 256 jaeger-2.22.0-darwin-amd64/jaeger` 算自己下到的文件的 SHA-256。实测是 `85178921dcbe254709e0b988b4705d5fb57faf43a47f232a7d25303e4cfb3732`。
- `grep "/jaeger$" sum.txt` 在官方文件里找 `jaeger` 那一行,实测是 `85178921dcbe…3732 *jaeger-2.22.0-darwin-amd64/jaeger`,和上一行一致。
- `./jaeger-2.22.0-darwin-amd64/jaeger` 前台运行,终端会一直被它占着,开新窗口干别的。用 curl 下载的文件没有 macOS 的「来自互联网」标记,我这里直接就能运行;用浏览器下载的可能会被系统拦下说无法验证开发者,这种情况我没试。

</div>

启动日志很长,最后一行是:

```text
2026-10-22T18:59:16.385+0800	info	service@v0.160.0/service.go:284	Everything is ready. Begin running and processing data.	{...}
```

它监听了两个我们关心的端口:4318 收 OTLP/HTTP 的 span,16686 是网页界面和查询接口。用 [Day 77](/blog/agent-zero/day-077-server-1/) 的 `lsof` 确认一下:

```bash
lsof -i :4318 | head -2
curl -s -o /dev/null -w "%{http_code}\n" localhost:16686/
```

```text
COMMAND   PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
jaeger  85745 你       17u  IPv4 0x56394943ffc7eebf      0t0  TCP localhost:4318 (LISTEN)
200
```

(第二行的用户名一列我换成了「你」。)实测它占了约 50 MB 内存(`ps -o rss= -p 85745` 得到 50124 KB),和 Langfuse 自托管建议的 16 GiB 机器比,不是一个量级。代价是默认把数据存在内存里,关掉就没了,只适合开发时看。

## 第三步:初始化,一个 provider 按需挂出口

真实项目里,初始化代码集中放一个地方,进程启动时调一次。我们让它按环境变量决定挂哪些出口:设了 `JAEGER_OTLP_ENDPOINT` 就发 Jaeger,设了 `OTEL_CONSOLE` 就同时打印到终端。

```python
# agent-zero-lab/part06/otel_setup.py
"""OpenTelemetry 初始化:一个 TracerProvider,按环境变量挂上出口(Jaeger、终端)。整个进程只调一次。"""
from __future__ import annotations

import os

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter, SimpleSpanProcessor

_provider: TracerProvider | None = None


def setup_otel(service_name: str = "cloudledger-agent") -> TracerProvider:
    global _provider
    if _provider is not None:
        return _provider
    resource = Resource.create({"service.name": service_name,
                                "deployment.environment.name": os.getenv("APP_ENV", "dev")})
    provider = TracerProvider(resource=resource)
    jaeger = os.getenv("JAEGER_OTLP_ENDPOINT")               # 例如 http://localhost:4318/v1/traces
    if jaeger:
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=jaeger)))
    if os.getenv("OTEL_CONSOLE"):
        provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))
    trace.set_tracer_provider(provider)
    _provider = provider
    return provider
```

<div class="line-notes">

- `from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter` 包名一段段读:exporter、otlp 协议、proto(protobuf 格式)、http 传输。另有一个 grpc 版本的包,Langfuse 不收 gRPC,所以统一用 HTTP 版。
- `from opentelemetry.sdk.resources import Resource` 描述服务身份的类。
- `_provider: TracerProvider | None = None` 模块级变量,记住已经建好的 provider。名字前的下划线表示「模块内部用」。
- `global _provider` 函数里要给模块级变量重新赋值,必须先声明 `global`,不然 `_provider = provider` 只会建一个函数里的局部变量,外面那个永远是 None。JS 里函数可以直接改外层的 `let`,Python 不行,这是两边很容易混的地方。
- `if _provider is not None:` 第二次调就直接返回第一次建的。OpenTelemetry 的全局 provider 只能设一次,第二次 `set_tracer_provider` 会被忽略并打警告,所以自己先挡住。练习 2 会用到这个「调多次也安全」。
- `resource = Resource.create({"service.name": service_name,` 服务名,Jaeger 界面左上角的下拉框按它分组,实测查询接口返回的服务列表是 `["jaeger","cloudledger-agent"]`。
- `"deployment.environment.name": os.getenv("APP_ENV", "dev")})` 区分开发、测试、生产,没设就是 `dev`。
- `jaeger = os.getenv("JAEGER_OTLP_ENDPOINT")               # 例如 http://localhost:4318/v1/traces` 这是我们自己起的变量名。OpenTelemetry 也有标准变量 `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`,`OTLPSpanExporter()` 不传 endpoint 时会读它;这里显式传,读代码的人一眼看到数据发去哪。
- `provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=jaeger)))` 发远端用 Batch:攒一批、后台线程发,不拖慢 Agent。
- `provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))` 打印到终端用 Simple:立刻看到。
- `trace.set_tracer_provider(provider)` 第一步演示过,少了它全是空操作。

</div>

## 第四步:按 GenAI 语义约定写三种 span

Day 364 我们已经照 GenAI 语义约定起过属性名。现在把它写全,做成三个可复用的小工具:整次运行的根 span、调模型的 span、调工具的 span。这套约定在 2026 年 10 月查到的状态仍是 Development(还在变),放在单独的仓库 [semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai) 里维护。今天用到的部分:

| 操作 | span 名 | span kind | 关键属性 |
| --- | --- | --- | --- |
| 调用 Agent | `invoke_agent {gen_ai.agent.name}` | INTERNAL(进程内的 Agent)或 CLIENT(远程 Agent) | `gen_ai.operation.name=invoke_agent`、`gen_ai.agent.name`、`gen_ai.conversation.id` |
| 调模型 | `chat {gen_ai.request.model}` | CLIENT | `gen_ai.operation.name=chat`、`gen_ai.provider.name`、`gen_ai.request.model`、`gen_ai.response.model`、`gen_ai.response.finish_reasons`、`gen_ai.usage.input_tokens`、`gen_ai.usage.output_tokens` |
| 调工具 | `execute_tool {gen_ai.tool.name}` | INTERNAL | `gen_ai.operation.name=execute_tool`、`gen_ai.tool.name`、`gen_ai.tool.call.id`、`gen_ai.tool.type` |

span kind 说的是「这一步在跨不跨进程」:**CLIENT** 是我向外部服务发请求(调模型就是向 DeepSeek 发 HTTP 请求),**SERVER** 是我在接别人的请求,**INTERNAL** 是进程内部处理。后端靠它画服务之间的依赖关系。

`gen_ai.provider.name` 有一张标准取值表,DeepSeek 是 `deepseek`,OpenAI 是 `openai`。这是较新的名字,老版本约定叫 `gen_ai.system`,网上的老文章和一些库还在用旧名字,看到了知道是一回事。

```python
# agent-zero-lab/part06/genai_otel.py
"""按 OpenTelemetry GenAI 语义约定手动打 span:整次运行、调模型、调工具各一种。"""
from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from opentelemetry import trace
from opentelemetry.trace import Span, SpanKind, Status, StatusCode

tracer = trace.get_tracer("cloudledger.agent")
PROVIDER = os.getenv("GENAI_PROVIDER", "deepseek")          # 按约定里的标准取值表填


@contextmanager
def agent_span(agent_name: str, customer_id: str, conversation_id: str) -> Iterator[Span]:
    attrs = {"gen_ai.operation.name": "invoke_agent", "gen_ai.agent.name": agent_name,
             "gen_ai.conversation.id": conversation_id, "user.id": customer_id}
    with tracer.start_as_current_span(f"invoke_agent {agent_name}", kind=SpanKind.INTERNAL, attributes=attrs) as span:
        yield span


def traced_chat(client: Any, *, model: str, messages: list, **kwargs: Any) -> Any:
    attrs = {"gen_ai.operation.name": "chat", "gen_ai.provider.name": PROVIDER, "gen_ai.request.model": model}
    with tracer.start_as_current_span(f"chat {model}", kind=SpanKind.CLIENT, attributes=attrs,
                                      record_exception=False) as span:
        try:
            resp = client.chat.completions.create(model=model, messages=messages, **kwargs)
        except Exception as e:
            span.record_exception(e)
            span.set_status(Status(StatusCode.ERROR, str(e)))
            span.set_attribute("error.type", type(e).__name__)
            raise
        span.set_attribute("gen_ai.response.model", resp.model)
        span.set_attribute("gen_ai.response.finish_reasons", [c.finish_reason for c in resp.choices])
        if resp.usage:
            span.set_attribute("gen_ai.usage.input_tokens", resp.usage.prompt_tokens)
            span.set_attribute("gen_ai.usage.output_tokens", resp.usage.completion_tokens)
        return resp


@contextmanager
def tool_span(name: str, call_id: str) -> Iterator[Span]:
    attrs = {"gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": name,
             "gen_ai.tool.call.id": call_id, "gen_ai.tool.type": "function"}
    with tracer.start_as_current_span(f"execute_tool {name}", kind=SpanKind.INTERNAL, attributes=attrs,
                                      record_exception=False) as span:
        try:
            yield span
        except Exception as e:
            span.record_exception(e)
            span.set_status(Status(StatusCode.ERROR, str(e)))
            span.set_attribute("error.type", type(e).__name__)
            raise
```

<div class="line-notes">

- `from opentelemetry.trace import Span, SpanKind, Status, StatusCode` 都是 API 层的类型。这个文件只依赖 API,不 import 任何 `sdk`,这正是「库只依赖 API」的写法:谁用它,谁在启动时配 SDK。
- `tracer = trace.get_tracer("cloudledger.agent")` 在模块被导入时就拿 tracer。这时全局 provider 可能还没设,没关系:API 给的是一个代理,真正开 span 时才去找 provider。但开 span 必须在 `setup_otel()` 之后,否则就是第一步那个全 0 的 `NonRecordingSpan`。
- `PROVIDER = os.getenv("GENAI_PROVIDER", "deepseek")          # 按约定里的标准取值表填` 换成别家模型时改环境变量。
- `@contextmanager` [Day 98](/blog/agent-zero/day-098-context-managers/) 学的,把带 `yield` 的函数变成能写在 `with` 后面的东西。
- `def agent_span(agent_name: str, customer_id: str, conversation_id: str) -> Iterator[Span]:` 根 span。`conversation_id` 对应约定里的 `gen_ai.conversation.id`,作用和 Day 365 的 session_id 一样,把一段对话的几个 trace 串起来。
- `"gen_ai.conversation.id": conversation_id, "user.id": customer_id}` `user.id` 不在 GenAI 约定里,是 OpenTelemetry 通用属性,Day 364、365 都用过。
- `with tracer.start_as_current_span(f"invoke_agent {agent_name}", kind=SpanKind.INTERNAL, attributes=attrs) as span:` 我们的 Agent 和调用方在一个进程里,所以是 INTERNAL。
- `def traced_chat(client: Any, *, model: str, messages: list, **kwargs: Any) -> Any:` 包一层 `chat.completions.create`。`*` 后面的参数只能用关键字传,防止把 model 和 messages 的位置传反;`**kwargs` 原样转给 SDK,`tools`、`temperature`、`extra_body` 都从这里过。
- `with tracer.start_as_current_span(f"chat {model}", kind=SpanKind.CLIENT, attributes=attrs,` 调模型是向外部服务发请求,所以 CLIENT。实测 span 名是 `chat deepseek-flash`。
- `record_exception=False) as span:` 关掉 SDK 自动记异常,由下面的 `except` 自己记。不关会记两遍,练习 1 实测。
- `span.record_exception(e)` 把异常的类型、消息、堆栈作为一个名叫 `exception` 的 event 记到 span 上。
- `span.set_status(Status(StatusCode.ERROR, str(e)))` 把 span 标成出错。后端按状态筛「所有出错的 trace」就靠它。
- `span.set_attribute("error.type", type(e).__name__)` 约定要求出错时带 `error.type`,值是异常类名,第六步实测是 `BadRequestError`。
- `raise` 记完原样抛出去。span 只负责记,不负责吞错误,和 Day 364 练习 1 一个道理。
- `span.set_attribute("gen_ai.response.model", resp.model)` 厂商实际用的模型,可能和请求的不一样(请求别名、返回具体版本)。实测两个都是 `deepseek-flash`。
- `span.set_attribute("gen_ai.response.finish_reasons", [c.finish_reason for c in resp.choices])` 列表属性。第一次调模型时实测是 `["tool_calls"]`:模型要调工具,不是说完了。
- `span.set_attribute("gen_ai.usage.input_tokens", resp.usage.prompt_tokens)` openai SDK 叫 `prompt_tokens`,约定叫 `input_tokens`,在这里翻译一次。
- `def tool_span(name: str, call_id: str) -> Iterator[Span]:` 工具 span 做成上下文管理器而不是装饰器,原因和 Day 365 一样:我们的工具都经过 `call_tool(conn, name, args)` 一个函数分发,用 `with` 包住那一行最自然。
- `"gen_ai.tool.call.id": call_id, "gen_ai.tool.type": "function"}` `call_id` 是模型给这次工具调用起的编号(实测形如 `call_00_TDeILj6pltSzOKirxKXI2639`),靠它能把「模型要求调工具」和「工具真的被调」对上。
- `yield span` `with tool_span(...)` 块里的代码在这里执行;块里抛的异常会在这一行冒出来,被下面的 `except` 接住。

</div>

工具参数(`gen_ai.tool.call.arguments`)这次没记。Day 364 为了查越权记过,约定里它是 Opt-In,默认不记,原因是参数里可能有客户信息,Day 367 讲隐私时细说。

## 第五步:用到工单 Agent 上,发进 Jaeger

```python
# agent-zero-lab/part06/otel_agent.py
"""Day 360 的工单 Agent,用 OpenTelemetry 手动打 span,发给本机的 Jaeger。
用法: JAEGER_OTLP_ENDPOINT=http://localhost:4318/v1/traces uv run python -m part06.otel_agent C007 "..." """
from __future__ import annotations

import json
import secrets
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from part06.otel_setup import setup_otel  # noqa: E402

provider = setup_otel()

from part06.genai_otel import agent_span, tool_span, traced_chat  # noqa: E402
from part06.oracle import DB  # noqa: E402
from part06.traj_agent import EXTRA, MODEL, SYSTEM, TOOLS, call_tool, client  # noqa: E402


def run(customer_id: str, ticket: str, conversation_id: str, max_turns: int = 10) -> tuple[str, str]:
    tmp = Path(tempfile.mkdtemp()) / "cloudledger.db"
    shutil.copy(DB, tmp)
    conn = sqlite3.connect(tmp)
    conn.row_factory = sqlite3.Row
    messages: list = [{"role": "system", "content": SYSTEM},
                      {"role": "user", "content": f"[客户编号 {customer_id}] {ticket}"}]
    reply = ""
    with agent_span("ticket", customer_id, conversation_id) as root:
        for _ in range(max_turns):
            resp = traced_chat(client, model=MODEL, messages=messages, tools=TOOLS, temperature=0.7, extra_body=EXTRA)
            msg = resp.choices[0].message
            messages.append(msg.model_dump(exclude_none=True))
            if not msg.tool_calls:
                reply = msg.content or ""
                break
            for tc in msg.tool_calls:
                if tc.type != "function":
                    continue
                args = json.loads(tc.function.arguments or "{}")
                with tool_span(tc.function.name, tc.id):
                    result = call_tool(conn, tc.function.name, args)
                messages.append({"role": "tool", "tool_call_id": tc.id,
                                 "content": json.dumps(result, ensure_ascii=False)})
        trace_id = format(root.get_span_context().trace_id, "032x")
    conn.close()
    return reply, trace_id


if __name__ == "__main__":
    reply, trace_id = run(sys.argv[1], sys.argv[2], conversation_id="otel-" + secrets.token_hex(4))
    print("trace_id:", trace_id)
    print("回复:", reply[:50])
    provider.shutdown()
```

<div class="line-notes">

- `provider = setup_otel()` 在导入 `genai_otel`、`traj_agent` 之前就把 provider 设好。严格说 `genai_otel` 拿 tracer 时不要求 provider 已经存在,但「先配置、后导入业务代码」是一个不用动脑子就不会错的顺序,以后接自动埋点库(练习 3)时必须这样。
- `from part06.traj_agent import EXTRA, MODEL, SYSTEM, TOOLS, call_tool, client  # noqa: E402` 被测的 Agent 照旧不改。注意这次进程里没有导入 `langfuse.openai`,所以没有 Day 365 那个补丁,调模型的 span 全靠 `traced_chat`。
- `with agent_span("ticket", customer_id, conversation_id) as root:` 根 span,实测名字是 `invoke_agent ticket`,和 Day 364、365 一样。
- `resp = traced_chat(client, model=MODEL, messages=messages, tools=TOOLS, temperature=0.7, extra_body=EXTRA)` 原来的 `client.chat.completions.create(...)` 换成 `traced_chat(client, ...)`,参数原样往下传。
- `with tool_span(tc.function.name, tc.id):` 只有真正执行工具那一行在 span 里。
- `trace_id = format(root.get_span_context().trace_id, "032x")` OpenTelemetry 里 trace_id 是一个 128 位整数,转成 32 位十六进制字符串才是我们熟悉的样子,Jaeger 的查询接口用这个形式。
- `provider.shutdown()` 把 Batch 处理器里还没发出去的 span 发完,再关掉。作用和 Day 365 的 `langfuse.flush()` 一样。

</div>

```bash
JAEGER_OTLP_ENDPOINT=http://localhost:4318/v1/traces uv run python -m part06.otel_agent C007 "10月8号扣了我两次,两笔都是2392,多扣的退我"
```

<div class="line-notes">

- `JAEGER_OTLP_ENDPOINT=http://localhost:4318/v1/traces uv run python -m part06.otel_agent C007` 环境变量写在命令前面,只对这一条命令生效。`/v1/traces` 是 OTLP/HTTP 规定的 trace 路径。

</div>

实测输出:

```text
trace_id: a70d52d554fc0c489562dd5a5c376560
回复: 已经为您提交好了，情况如下：

**退款申请已提交，等待主管审批**
- 退款发票：INV-2026
```

浏览器打开 `http://localhost:16686`,Service 选 `cloudledger-agent`,点 Find Traces,就能看到这个 trace 的瀑布图。(我确认了这个网页能打开,返回 200,但没有截图贴在这里。下面用 Jaeger 的查询接口把同一个 trace 取回来,结果是可以核对的。)

Jaeger 的网页本身也是调后端接口拿数据的,你在 DevTools 的 Network 面板里能看到它请求 `/api/traces/<trace_id>`。我们直接调这个接口,把返回的 JSON 翻译成 Day 364 的 span 字典,再用 `print_tree` 画:

```python
# agent-zero-lab/part06/jaeger_peek.py
"""从本机 Jaeger 的查询接口把一个 trace 取回来,翻译成 Day 364 的 span 字典,用同一个 print_tree 画出来。
用法: uv run python -m part06.jaeger_peek <trace_id>"""
from __future__ import annotations

import sys

import httpx

from part06.mini_trace import print_tree

data = httpx.get(f"http://localhost:16686/api/traces/{sys.argv[1]}").json()["data"][0]
service = data["processes"]["p1"]["serviceName"]
spans = []
for s in data["spans"]:
    parent = next((r["spanID"] for r in s["references"] if r["refType"] == "CHILD_OF"), None)
    spans.append({"span_id": s["spanID"], "parent_id": parent, "name": s["operationName"],
                  "start": s["startTime"] / 1e6, "end": (s["startTime"] + s["duration"]) / 1e6,
                  "attrs": {t["key"]: t["value"] for t in s["tags"]}})
print(f"service = {service},共 {len(spans)} 个 span")
print_tree(spans)
for s in sorted(spans, key=lambda x: x["start"]):
    a = s["attrs"]
    tok = f"输入 {a['gen_ai.usage.input_tokens']} 输出 {a['gen_ai.usage.output_tokens']}" if "gen_ai.usage.input_tokens" in a else ""
    print(f"  {s['name']:<36} kind={a.get('span.kind')}  {tok}")
```

<div class="line-notes">

- `import httpx` [Day 64](/blog/agent-zero/day-064-httpx-1/) 学的 HTTP 客户端,相当于 Python 里的 fetch,这个练习仓库早就装了。
- `data = httpx.get(f"http://localhost:16686/api/traces/{sys.argv[1]}").json()["data"][0]` Jaeger 网页用的那个查询接口。返回 `{"data": [trace]}`,取第一个。
- `service = data["processes"]["p1"]["serviceName"]` Jaeger 把 Resource 叫 process,每个 span 用 `processID` 引用它,省得每个 span 都重复存一遍服务信息。我们只有一个服务,就是 `p1`。
- `parent = next((r["spanID"] for r in s["references"] if r["refType"] == "CHILD_OF"), None)` Jaeger 不用 `parent_id` 字段,而是用一个「引用」列表,`CHILD_OF` 那条指向父亲。`next(生成器, None)` 取第一个,找不到就是 None,即根 span。
- `"start": s["startTime"] / 1e6, "end": (s["startTime"] + s["duration"]) / 1e6,` Jaeger 的时间单位是**微秒**,而且存的是开始时间加时长,不是结束时间。OpenTelemetry 原始数据是纳秒,Day 364 是秒,三家三个单位,换算时最容易出错的就是这里。
- `"attrs": {t["key"]: t["value"] for t in s["tags"]}})` Jaeger 管属性叫 tags,是 `[{key, type, value}]` 列表,转成字典。
- `print(f"  {s['name']:<36} kind={a.get('span.kind')}  {tok}")` span kind 在 Jaeger 里也变成了一个叫 `span.kind` 的 tag。

</div>

```bash
uv run python -m part06.jaeger_peek a70d52d554fc0c489562dd5a5c376560
```

实测输出:

```text
service = cloudledger-agent,共 7 个 span
|████████████████████████████████████████| invoke_agent ticket              3766 ms
|████████████                            |   chat deepseek-flash            1175 ms
|            █                           |   execute_tool get_subscription      1 ms
|            █                           |   execute_tool list_invoices        0 ms
|            █████████████████           |   chat deepseek-flash            1562 ms
|                             █          |   execute_tool create_refund_request      2 ms
|                             ██████████ |   chat deepseek-flash            1024 ms
  invoke_agent ticket                  kind=internal  
  chat deepseek-flash                  kind=client  输入 669 输出 95
  execute_tool get_subscription        kind=internal  
  execute_tool list_invoices           kind=internal  
  chat deepseek-flash                  kind=client  输入 1083 输出 241
  execute_tool create_refund_request   kind=internal  
  chat deepseek-flash                  kind=client  输入 1350 输出 136
```

同一棵树,第三次见了:Day 364 自己手写,Day 365 Langfuse 记,今天 OpenTelemetry 记、Jaeger 存。7 个 span,三次调模型是 client,其余是 internal,第一次调模型的输入仍是 669 个 token。

在 Jaeger 里看属性,工具那个 span 实测带着:

```json
[{"key": "otel.scope.name", "type": "string", "value": "cloudledger.agent"},
 {"key": "gen_ai.operation.name", "type": "string", "value": "execute_tool"},
 {"key": "gen_ai.tool.call.id", "type": "string", "value": "call_00_TDeILj6pltSzOKirxKXI2639"},
 {"key": "gen_ai.tool.name", "type": "string", "value": "create_refund_request"},
 {"key": "gen_ai.tool.type", "type": "string", "value": "function"},
 {"key": "span.kind", "type": "string", "value": "internal"}]
```

和 Day 365 Langfuse 记下的东西比一比:这里**没有输入输出原文**,没有 prompt、没有工具结果,只有名字、编号、token 这些元数据。这是我们自己决定的(`traced_chat` 里没记 messages),也是 GenAI 约定的默认态度:原文默认不记,要记必须显式打开。Langfuse 的 SDK 默认把原文全记下来,两边的默认值正好相反,Day 367 讲隐私时会回到这里。

这一课的钱:两次工单 Agent(本步一次,练习 2 一次 C012)输入 3102 + 1732、输出 472 + 454,两次一句话的小调用各 8 输入 11 输出,算下来输入约 4850、输出约 950;再加上调试时多跑的一两次,按输入 5700、输出 1100 估:5700 × 2 / 100 万 + 1100 × 8 / 100 万 ≈ 0.011 + 0.009 = 0.02 元。写错模型名的 400 请求没有 token,不计费。

## 第六步:故意出错,看失败的 span 长什么样

把模型名写成不存在的 `no-such-model`,看 `traced_chat` 记下什么。这次不用 Jaeger,用 `InMemorySpanExporter` 把 span 收在内存里直接打印,写测试时就是这么用的:

```python
# agent-zero-lab/part06/otel_error.py
"""故意把模型名写错,看 traced_chat 把失败记成什么样。span 收在内存里,不用 Jaeger。
用法: uv run python -m part06.otel_error"""
from __future__ import annotations

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

memory = InMemorySpanExporter()
provider = TracerProvider()
provider.add_span_processor(SimpleSpanProcessor(memory))
trace.set_tracer_provider(provider)

from part06.genai_otel import traced_chat  # noqa: E402
from part06.traj_agent import client  # noqa: E402

try:
    traced_chat(client, model="no-such-model", messages=[{"role": "user", "content": "你好"}])
except Exception as e:
    print("调用方照样收到异常:", type(e).__name__)

for s in memory.get_finished_spans():
    print("span:", s.name)
    print("  status:", s.status.status_code.name, "|", (s.status.description or "")[:200])
    print("  error.type:", (s.attributes or {}).get("error.type"))
    print("  events:", [ev.name for ev in s.events])
```

<div class="line-notes">

- `from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter` 把 span 存在一个列表里的出口,专门给测试用。
- `provider.add_span_processor(SimpleSpanProcessor(memory))` 测试里用 Simple:span 一结束就进列表,读的时候不用等。
- `traced_chat(client, model="no-such-model", messages=[{"role": "user", "content": "你好"}])` DeepSeek 会返回 400。
- `for s in memory.get_finished_spans():` 取出所有已结束的 span。
- `print("  status:", s.status.status_code.name, "|", (s.status.description or "")[:200])` 状态码的名字和描述,描述很长,只取前 200 个字符。
- `print("  error.type:", (s.attributes or {}).get("error.type"))` `s.attributes` 在类型上可能是 None,`or {}` 兜一下,类型检查才不报红。

</div>

```bash
uv run python -m part06.otel_error
```

实测输出:

```text
调用方照样收到异常: BadRequestError
span: chat no-such-model
  status: ERROR | BadRequestError: Error code: 400 - {'error': {'message': 'The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed no-such-model. (request_id: 9a9d7a74-3311-4aa3-b098-a6c6571f
  error.type: BadRequestError
  events: ['exception']
```

四样东西都对:异常照样传给了调用方;span 状态是 ERROR;`error.type` 是 `BadRequestError`;一个 `exception` 事件,里面有完整堆栈。描述前面那个 `BadRequestError: ` 前缀不是我们写的:异常穿出 `with` 块时,SDK 默认还会再设一次状态(`set_status_on_exception` 默认开),用「类名: 消息」覆盖了我们设的描述。这无伤大雅。真正会出问题的是事件,看练习 1。

至于指标(每分钟 token 用量、调模型耗时的 P95 这类数字),OpenTelemetry 也管,用的是 `MeterProvider`、直方图和计数器,和今天的 trace 是另一套零件。它更适合放在规模化的时候讲,[Day 595](/blog/agent-zero/day-595-obs-scale-2/) 会和告警、看板一起讲,今天不展开。

### 小结

OpenTelemetry 分 API 和 SDK 两层:代码用 tracer 开 span,结束的 span 交给全局的 TracerProvider,provider 交给挂在上面的每个 SpanProcessor,processor 决定什么时候发,exporter 决定发去哪。忘了 `set_tracer_provider`,API 全是空操作,trace_id 全 0,不报错。按 GenAI 约定,调模型是 CLIENT 的 `chat {model}`,调工具是 INTERNAL 的 `execute_tool {name}`,整次运行是 `invoke_agent {name}`;出错时设 ERROR 状态、记异常事件、带 `error.type`,然后原样抛出。Jaeger 不用 Docker 也能跑,约 50 MB 内存,收 OTLP,查询接口能把 trace 取回来。同一棵树,三种方式记,形状一样。

## 动手练习

### 练习 1:异常为什么会被记两遍

几乎不花钱(只发两次会返回 400 的请求)。`traced_chat` 里写了 `record_exception=False`。去掉它,同一次失败会在 span 上留下几个 `exception` 事件?写一个对比脚本。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex366_double.py
"""练习 1:去掉 record_exception=False,同一次失败会在 span 上记几次异常?只调一次会失败的模型接口(400,不计费)。
用法: uv run python -m part06.ex366_double"""
from __future__ import annotations

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import Status, StatusCode

from part06.traj_agent import client

memory = InMemorySpanExporter()
provider = TracerProvider()
provider.add_span_processor(SimpleSpanProcessor(memory))
trace.set_tracer_provider(provider)
tracer = trace.get_tracer("demo")

for flag in (True, False):
    try:
        with tracer.start_as_current_span(f"chat record_exception={flag}", record_exception=flag) as span:
            try:
                client.chat.completions.create(model="no-such-model", messages=[{"role": "user", "content": "你好"}])
            except Exception as e:
                span.record_exception(e)
                span.set_status(Status(StatusCode.ERROR, str(e)))
                raise
    except Exception:
        pass

for s in memory.get_finished_spans():
    print(f"{s.name:<30} 异常事件 {len(s.events)} 个: {[ev.name for ev in s.events]}")
```

<div class="line-notes">

- `for flag in (True, False):` `True` 是 SDK 的默认值,`False` 是我们 `traced_chat` 里的写法。
- `with tracer.start_as_current_span(f"chat record_exception={flag}", record_exception=flag) as span:` span 名里带上开关的值,输出时好认。
- `span.record_exception(e)` 我们手动记一次。
- `raise` 异常继续往外穿出 `with` 块。`record_exception=True` 时,SDK 在异常穿出时会再记一次。
- `except Exception:` 外层接住,让循环继续跑下一种。

</div>

```bash
uv run python -m part06.ex366_double
```

实测输出:

```text
chat record_exception=True     异常事件 2 个: ['exception', 'exception']
chat record_exception=False    异常事件 1 个: ['exception']
```

默认开着时,同一个异常记了两遍:一遍是我们在 `except` 里手动记的,一遍是异常穿出 `with` 时 SDK 自动记的。后端按异常事件数告警时会翻倍。两种改法:要么手动记、关掉自动的(我们的写法,好处是能在记之前加 `error.type`);要么不手动记、全交给 SDK。别两个都开。

</details>

### 练习 2:一份 span 同时发给 Jaeger 和 Langfuse

调一次模型。保持 Jaeger 开着,再起 Day 365 的假收件箱(`uv run python -m part06.fake_langfuse`),在 `setup_otel()` 建好的 provider 上再挂一个出口,发到 Langfuse 的 OTLP 接口。跑一张 C012 工单,两边都确认收到。

<details><summary>参考答案</summary>

Langfuse 收 OTLP 的地址是 `{LANGFUSE_BASE_URL}/api/public/otel/v1/traces`,认证用 Day 365 讲的 Basic(公钥:私钥做 base64);官方文档还要求加一个 `x-langfuse-ingestion-version: 4` 头,不加的话数据可能要等最多 10 分钟才出现。

```python
# agent-zero-lab/part06/ex366_two_exports.py
"""练习 2:一份 span 同时发给 Jaeger 和 Langfuse。Langfuse 用 Day 365 的假收件箱代替。
先起 Jaeger 和 part06.fake_langfuse,再跑:
JAEGER_OTLP_ENDPOINT=http://localhost:4318/v1/traces uv run python -m part06.ex366_two_exports"""
from __future__ import annotations

import base64
import os

from dotenv import load_dotenv
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from part06.otel_setup import setup_otel

load_dotenv()
provider = setup_otel()
token = base64.b64encode(f"{os.environ['LANGFUSE_PUBLIC_KEY']}:{os.environ['LANGFUSE_SECRET_KEY']}".encode()).decode()
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(
    endpoint=f"{os.environ['LANGFUSE_BASE_URL']}/api/public/otel/v1/traces",
    headers={"Authorization": f"Basic {token}", "x-langfuse-ingestion-version": "4"})))

from part06.otel_agent import run  # noqa: E402

reply, trace_id = run("C012", "你们扣了我两次钱!赶紧退!", conversation_id="two-exports-1")
provider.shutdown()
print("trace_id:", trace_id)
```

<div class="line-notes">

- `provider = setup_otel()` 先建好带 Jaeger 出口的 provider。
- `token = base64.b64encode(f"{os.environ['LANGFUSE_PUBLIC_KEY']}:{os.environ['LANGFUSE_SECRET_KEY']}".encode()).decode()` 从里往外:拼成 `pk-lf-local:sk-lf-local`,`.encode()` 变字节,`b64encode` 编码,`.decode()` 再变回字符串。相当于浏览器里的 `btoa("pk:sk")`。
- `provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(` 在同一个 provider 上再挂一个处理器。每个结束的 span 会依次交给两个处理器,各发各的。
- `endpoint=f"{os.environ['LANGFUSE_BASE_URL']}/api/public/otel/v1/traces",` 代入得 `http://127.0.0.1:3999/api/public/otel/v1/traces`,换成云版就是 `https://cloud.langfuse.com/api/public/otel/v1/traces`。
- `from part06.otel_agent import run  # noqa: E402` `otel_agent.py` 导入时会再调一次 `setup_otel()`,拿到的是同一个 provider(第三步那个 `_provider` 判断在这里起作用),所以我们刚挂的 Langfuse 出口不会被覆盖。
- `provider.shutdown()` 两个 Batch 处理器都会把剩下的发完。

</div>

```bash
JAEGER_OTLP_ENDPOINT=http://localhost:4318/v1/traces uv run python -m part06.ex366_two_exports
uv run python -m part06.jaeger_peek 1be817b4eee088a1548d4cbf195d9d06
uv run python -m part06.lf_view 1
```

实测输出(trace_id 是第一条命令打印的,后两条命令里换成你自己的):

```text
trace_id: 1be817b4eee088a1548d4cbf195d9d06
service = cloudledger-agent,共 5 个 span
|████████████████████████████████████████| invoke_agent ticket              3114 ms
|████████████████                        |   chat deepseek-flash            1249 ms
|                █                       |   execute_tool get_subscription      1 ms
|                █                       |   execute_tool list_invoices        0 ms
|                ███████████████████████ |   chat deepseek-flash            1863 ms
  invoke_agent ticket                  kind=internal  
  chat deepseek-flash                  kind=client  输入 659 输出 100
  execute_tool get_subscription        kind=internal  
  execute_tool list_invoices           kind=internal  
  chat deepseek-flash                  kind=client  输入 1073 输出 354

trace 1be817b4…  user=C012  session=None
|████████████████████████████████████████| invoke_agent ticket              3114 ms
|████████████████                        |   chat deepseek-flash            1249 ms
|                █                       |   execute_tool get_subscription      1 ms
|                █                       |   execute_tool list_invoices        0 ms
|                ███████████████████████ |   chat deepseek-flash            1863 ms
  [None] invoke_agent ticket
  [None] chat deepseek-flash
  [None] execute_tool get_subscription
  [None] execute_tool list_invoices
  [None] chat deepseek-flash
```

两边同一个 trace_id、同样 5 个 span、同样的时间。`lf_view` 里类型一栏是 None,因为这些 span 上没有 Langfuse SDK 写的 `langfuse.observation.type`,我们的假收件箱只会读这个属性。真 Langfuse 不一样:按它的 OpenTelemetry 集成文档,没有这个属性时它会看 `gen_ai.operation.name` 等约定来判断类型,`gen_ai.usage.*` 映射成用量,`gen_ai.request.model` 映射成模型名(这一段是文档的说法,没实跑)。所以按约定起名,换后端时才能被自动认出来。

</details>

### 练习 3:官方的自动埋点和手写的差在哪

调一次模型(一句话,几乎不花钱)。不写 `traced_chat`,装 OpenTelemetry 官方的 OpenAI 自动埋点库,让它给 openai SDK 打补丁,看它记下的 span。先用默认方式安装,看会不会出问题。

<details><summary>参考答案</summary>

```bash
uv add opentelemetry-instrumentation-openai-v2
```

2026 年 10 月装到的是 `opentelemetry-instrumentation-openai-v2 2.4b0`(2026 年 5 月发布),它会顺带装上 `opentelemetry-util-genai 1.2b0`(9 月发布)。一导入就报错:

```text
    from opentelemetry.util.genai.instruments import (
ModuleNotFoundError: No module named 'opentelemetry.util.genai.instruments'
```

新版的 util-genai 改了内部模块,老的 openai-v2 还在找旧路径。两个包都是 b(beta)版,这种不兼容很常见。把 util-genai 限制在 1.2 以下:

```bash
uv add "opentelemetry-util-genai<1.2"
```

装上的是 1.1b0,导入就好了。

```python
# agent-zero-lab/part06/ex366_auto.py
"""练习 3:不手写 traced_chat,用官方的 OpenAI 自动埋点库,看它记下的 span 和我们手写的差在哪。
用法: uv run python -m part06.ex366_auto"""
from __future__ import annotations

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

from part06.traj_agent import EXTRA, MODEL, client  # noqa: E402

client.chat.completions.create(model=MODEL, messages=[{"role": "user", "content": "用一句话说你好"}],
                               temperature=0, extra_body=EXTRA)
for s in memory.get_finished_spans():
    print(s.name, s.kind.name)
    for k, v in sorted((s.attributes or {}).items()):
        print(f"  {k} = {v}")
```

<div class="line-notes">

- `OpenAIInstrumentor().instrument()` 给 openai SDK 打补丁,和 Day 365 的 `langfuse.openai` 是同一种做法,只是记成标准的 OpenTelemetry span。必须在 provider 设好之后调。
- `client.chat.completions.create(model=MODEL, messages=[{"role": "user", "content": "用一句话说你好"}],` 我们自己的代码一行没变,直接调原版的 `create`。
- `for k, v in sorted((s.attributes or {}).items()):` 按属性名排序打印,方便对比。

</div>

```bash
uv run python -m part06.ex366_auto
```

实测输出:

```text
chat deepseek-flash CLIENT
  gen_ai.operation.name = chat
  gen_ai.provider.name = openai
  gen_ai.request.model = deepseek-flash
  gen_ai.request.temperature = 0
  gen_ai.response.finish_reasons = ('stop',)
  gen_ai.response.id = c1e87d56-8999-476a-acec-6cbe767283e0
  gen_ai.response.model = deepseek-flash
  gen_ai.usage.input_tokens = 8
  gen_ai.usage.output_tokens = 11
  openai.response.system_fingerprint = e72d3c7f663d3e1383b00b3884cb4501
```

span 名、kind、token 和我们手写的一样,还多记了温度、响应编号。最显眼的差别是 `gen_ai.provider.name = openai`:它只认 SDK,不知道背后是 DeepSeek。按厂商统计花费时这会把所有走 openai SDK 的模型都算成 OpenAI。我又加上 `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental` 跑了一次,属性完全一样(去掉每次都变的响应编号后逐行比对,没有差别)。

我的取舍:自己控制的调用点(Agent 循环、评分器)用手写的 `traced_chat`,属性准、能写对厂商名;框架内部调 openai 而你插不进代码的地方(比如 LangChain 的 `ChatOpenAI`),用自动埋点。两个别同时开在同一个调用上,否则同一次调模型会出现两个 span,token 算两遍。

</details>

### 练习 4:上下文传播,让两个服务的 span 接上

不调模型。Day 364 讲过 `traceparent` 请求头。用 OpenTelemetry 的 `inject` 和 `extract` 演示:「网关」开一个 span,把编号写进请求头;「Agent 服务」从请求头读出来,接着开 span。两个服务在一个进程里假装,不发网络请求。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex366_propagate.py
"""练习 4:上下文传播。「网关」把 traceparent 写进请求头,「Agent 服务」从请求头里读出来接着打 span。
两边在一个进程里假装是两个服务,不发网络请求,不调模型。用法: uv run python -m part06.ex366_propagate"""
from __future__ import annotations

from opentelemetry import trace
from opentelemetry.propagate import extract, inject
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

memory = InMemorySpanExporter()
provider = TracerProvider()
provider.add_span_processor(SimpleSpanProcessor(memory))
trace.set_tracer_provider(provider)
tracer = trace.get_tracer("demo")


def gateway() -> dict[str, str]:
    headers: dict[str, str] = {"content-type": "application/json"}
    with tracer.start_as_current_span("POST /tickets"):
        inject(headers)                                  # 把当前 span 的编号写进请求头
    return headers


def agent_service(headers: dict[str, str]) -> None:
    ctx = extract(headers)                               # 从请求头里读出上游的编号
    with tracer.start_as_current_span("invoke_agent ticket", context=ctx):
        with tracer.start_as_current_span("chat deepseek-flash"):
            pass


headers = gateway()
print("请求头:", headers)
agent_service(headers)
for s in memory.get_finished_spans():
    parent = f"{s.parent.span_id:016x}" if s.parent else None
    ctx = s.get_span_context()
    if ctx is None:
        continue
    print(f"{s.name:<22} trace {ctx.trace_id:032x}  span {ctx.span_id:016x}  父 {parent}")
```

<div class="line-notes">

- `from opentelemetry.propagate import extract, inject` 传播的两个动作:`inject` 往一个字典(请求头)里写,`extract` 从字典里读。默认用的就是 W3C Trace Context 标准,也就是 `traceparent` 头。
- `inject(headers)                                  # 把当前 span 的编号写进请求头` 必须在 `with` 里面调,这时「当前 span」才是 `POST /tickets`。真实系统里网关的 HTTP 客户端库会自动做这一步。
- `ctx = extract(headers)                               # 从请求头里读出上游的编号` 得到一个上下文对象,里面装着上游的 trace_id 和 span_id。真实系统里服务端框架的中间件会自动做这一步。
- `with tracer.start_as_current_span("invoke_agent ticket", context=ctx):` 关键在 `context=ctx`:不传它,这里会新开一个 trace;传了,新 span 就挂到上游那个 span 下面。
- `parent = f"{s.parent.span_id:016x}" if s.parent else None` `:016x` 是「16 位十六进制,不足补 0」。
- `ctx = s.get_span_context()` 已结束的 span 的上下文。类型上它可能是 None,先判断一下,basedpyright 才不报红。

</div>

```bash
uv run python -m part06.ex366_propagate
```

实测输出:

```text
请求头: {'content-type': 'application/json', 'traceparent': '00-bac87f3c11c5a9968e73130881c540d8-7d1406411156d15f-03'}
POST /tickets          trace bac87f3c11c5a9968e73130881c540d8  span 7d1406411156d15f  父 None
chat deepseek-flash    trace bac87f3c11c5a9968e73130881c540d8  span 8df0405b40eba958  父 c7bf4509015be2d5
invoke_agent ticket    trace bac87f3c11c5a9968e73130881c540d8  span c7bf4509015be2d5  父 7d1406411156d15f
```

请求头里多了 `traceparent`,格式正是 Day 364 讲的 `版本-trace_id-父span_id-标志`。三个 span 共用一个 trace_id;`invoke_agent ticket` 的父亲是 `7d140641…`,正是网关那个 `POST /tickets` 的 span_id,两边接上了。

最后的标志是 `03` 而不是 Day 364 例子里的 `01`。`01` 表示「这条 trace 被采样了,要记」;`02` 是 W3C Trace Context 第二版加的「trace_id 是随机生成的」标志;两个都有就是 `03`。我在 SDK 源码 `opentelemetry/trace/span.py` 里查到了 `RANDOM_TRACE_ID = 0x02` 这个定义。

</details>

### 验收标准

- `otel_hello.py` 跑通,你能指着输出说出 `kind`、`status`、`resource` 是什么;注释掉 `set_tracer_provider` 时见过全 0 的 trace_id。
- Jaeger 在本机跑起来,`otel_agent.py` 的 trace 能用 `jaeger_peek.py` 取回来,画出 7 个 span,调模型的是 client。
- `otel_error.py` 的失败 span 是 ERROR,带 `error.type`,只有一个 exception 事件。
- 你能不看文章画出 tracer → provider → processor → exporter 的关系,说出 Simple 和 Batch 的区别。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| OpenTelemetry(OTel) | 开源的可观测标准加各语言实现,管 trace、指标、日志三类数据 |
| API / SDK | OTel 的两层:API 只有接口,没装 SDK 时是空操作;SDK 是真正记录和发送的实现 |
| tracer | 开 span 的工具,`trace.get_tracer(模块名)` |
| TracerProvider | 总管,收下所有结束的 span,交给挂在上面的处理器;一个进程设一个全局的 |
| Resource | 描述「数据是谁产生的」,如 `service.name`,附在每个 span 上 |
| SpanProcessor | 决定什么时候发:Simple 立刻发,Batch 攒一批在后台发 |
| Exporter | 决定发去哪:Console、OTLP、InMemory |
| OTLP | OpenTelemetry 的传输协议,HTTP 版默认端口 4318、路径 `/v1/traces` |
| `start_as_current_span` | 开一个 span 并设成当前的,块里开的 span 自动成为它的孩子 |
| span kind | 这一步的角色:CLIENT 调外部、SERVER 接请求、INTERNAL 进程内 |
| span status | UNSET(没说出错,等于成功)、OK、ERROR |
| span event | span 上带时间的事件,异常记成名叫 `exception` 的事件 |
| `NonRecordingSpan` | 没配 SDK 时 API 给的空 span,什么都不记,trace_id 全 0 |
| Jaeger | CNCF 的开源分布式追踪系统,2.x 原生收 OTLP,有网页看瀑布图 |
| 自动埋点 instrumentation | 给某个库打补丁、自动产生 span 的包,如 `opentelemetry-instrumentation-openai-v2` |
| `inject` / `extract` | 上下文传播的两个动作:往请求头写编号 / 从请求头读编号 |
| SHA-256 校验和 | 文件内容算出的指纹,用来确认下载的文件没被改过 |
| `global` | 在函数里给模块级变量重新赋值前必须写的声明 |

## 常见误区

**忘了 `set_tracer_provider`,或者调晚了。** 不报错,不警告,所有 span 都是 `NonRecordingSpan`,trace_id 全 0。初始化放在进程启动的最前面,先于导入业务代码。

**以为 `get_tracer` 的名字是服务名。** 它是埋点模块的名字,出现在 `otel.scope.name` 里;服务名在 Resource 的 `service.name` 里。服务名不设,Jaeger 里看到的是 `unknown_service:python`。

**生产用 `SimpleSpanProcessor`。** 它每结束一个 span 就同步发一次网络请求,Agent 每调一次工具都要等它发完。发远端一律用 Batch,Simple 只在调试和测试里用。

**脚本结束前不 `shutdown()`。** Batch 处理器里攒着的 span 就丢了。和 Day 365 的 flush 一个道理。

**异常记两遍。** 自己 `record_exception` 了,又没关 `record_exception=False`,每个失败 span 两个异常事件。

**把字典塞进属性。** OTel 属性只收字符串、数字、布尔和它们的列表。要记结构化的东西,先 `json.dumps` 成字符串,或者拆成几个属性。

**时间单位换错。** OTel 原始数据是纳秒,Jaeger 查询接口是微秒,Python 的 `time.time()` 是秒。自己写转换时先确认单位,不然瀑布图要么全挤成一条,要么拉得老长。

**自动埋点和手写埋点同时开在一个调用上。** 一次调模型两个 span,token 和费用算两遍。一个调用点只留一种。

**以为自动埋点知道你用的是哪家。** 走 openai SDK 的调用,它一律记成 `openai`。

## 学习资料

### 文档与文章

- [OpenTelemetry · Python 入门(中文)](https://opentelemetry.io/zh/docs/languages/python/getting-started/):官方的 Python 上手页,有中文翻译,[英文原版](https://opentelemetry.io/docs/languages/python/getting-started/)更新更及时。
- [OpenTelemetry · Python 手动埋点](https://opentelemetry.io/docs/languages/python/instrumentation/):`start_as_current_span`、属性、事件、状态、异常的官方写法,今天第四步对照它看,英文。
- [semantic-conventions-genai · GenAI spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md):chat、execute_tool、invoke_agent 三种 span 的完整属性表,英文。
- [Jaeger · Getting Started](https://www.jaegertracing.io/docs/latest/getting-started/):二进制和 Docker 两种启动方式、端口说明,英文。
- [Langfuse · OpenTelemetry 集成](https://langfuse.com/integrations/native/opentelemetry):练习 2 用到的接口地址、认证头、`gen_ai.*` 属性怎么映射成 Langfuse 的字段,英文。
- [W3C · Trace Context](https://www.w3.org/TR/trace-context/):`traceparent` 格式和标志位的定义,练习 4 对照看,英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1NwNVemEyE&autoplay=0&high_quality=1" title="【IT老齐695】OpenTelemetry日志、指标、链路一站解决方案" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT老齐 · 【IT老齐695】OpenTelemetry日志、指标、链路一站解决方案 · 23 分钟,讲 OTel 是什么、三类数据、Collector 和后端的关系,正好补上今天第一节的大图。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1UQ4y1i7xv&autoplay=0&high_quality=1" title="【CNCF项目介绍】Jaeger - 分布式追踪工具" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>成富_Alex · 【CNCF项目介绍】Jaeger - 分布式追踪工具 · 4 分钟,Jaeger 是什么、能看什么。视频是 2021 年的,讲的是 1.x,今天用的 2.x 已经改成建在 OTel Collector 上,界面大同小异。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1w3HrePENj&autoplay=0&high_quality=1" title="基于 Opentelemetry 的大模型应用可观测丨阿里云云原生研发工程师李艳红（彦鸿）发表主题演讲" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>阿里云云原生 · 基于 Opentelemetry 的大模型应用可观测 · 18 分钟,大厂怎么用 OTel 给 LLM 应用埋点,讲到 GenAI 语义约定和自动埋点,和练习 3 对照。2024 年的演讲,约定里个别属性名后来改过(如 `gen_ai.system` 改成 `gen_ai.provider.name`)。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/R8BYnL-Yp1w" title="A practical guide to using OpenTelemetry in Python by Tom Eastman." loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Python New Zealand · A practical guide to using OpenTelemetry in Python by Tom Eastman · 31 分钟,英文。从 Python 开发者的角度讲 provider、processor、exporter 和手动埋点,和今天第一、三步对应。</figcaption>
</figure>

### 书籍

- Ted Young、Austin Parker《Learning OpenTelemetry》(O'Reilly,2024):OpenTelemetry 联合创始人写的,讲 API/SDK 分层、上下文传播、Collector,比官方文档好读,英文。
- Charity Majors、Liz Fong-Jones、George Miranda《Observability Engineering》(O'Reilly,2022):第 6、7 章讲 trace 和 OpenTelemetry 埋点,英文。

### 开源项目与代码

- [open-telemetry/opentelemetry-python](https://github.com/open-telemetry/opentelemetry-python):API 和 SDK 的源码。`opentelemetry-sdk/src/opentelemetry/sdk/trace/export/__init__.py` 里能看到 Simple 和 Batch 处理器各有多少行。
- [open-telemetry/opentelemetry-python-contrib](https://github.com/open-telemetry/opentelemetry-python-contrib):各种自动埋点库都在这里,练习 3 的 openai-v2 和 util-genai 也在。
- [jaegertracing/jaeger · Releases](https://github.com/jaegertracing/jaeger/releases):各平台的二进制和校验和文件。

## 自测

1. TracerProvider、SpanProcessor、Exporter 各管什么?一个 provider 能挂几个 processor?

<details><summary>答案</summary>

TracerProvider 是总管,收下所有结束的 span;SpanProcessor 决定什么时候发(Simple 立刻发,Batch 攒一批后台发);Exporter 决定发去哪、什么格式(Console、OTLP、InMemory)。一个 provider 可以挂多个 processor,每个 span 依次交给它们,这就是「一份 span 发好几个地方」的原理。

</details>

2. 跑了埋点代码,Jaeger 里什么都没有,打印出来的 trace_id 全是 0。最可能是哪里错了?

<details><summary>答案</summary>

没有调 `trace.set_tracer_provider(provider)`,或者调在开 span 之后。没有全局 provider 时 API 返回 `NonRecordingSpan`,不记任何东西,trace_id 全 0,也不报错。其次查 exporter 的 endpoint 对不对、脚本结束前有没有 `provider.shutdown()`。

</details>

3. 调模型的 span 为什么是 CLIENT,调工具的为什么是 INTERNAL?

<details><summary>答案</summary>

span kind 说的是这一步跨不跨进程、谁调谁。调模型是向 DeepSeek 的服务器发 HTTP 请求,是我方作为客户端调外部服务,所以 CLIENT。我们的工具是在本进程里查 SQLite,所以 INTERNAL。如果工具是调另一个服务(比如 MCP server),它就应该是 CLIENT,而对方那边接请求的 span 是 SERVER。

</details>

4. `traced_chat` 里为什么写 `record_exception=False`,又自己调 `record_exception`?

<details><summary>答案</summary>

`start_as_current_span` 默认在异常穿出 `with` 块时自动记一次异常事件。我们要在记录时顺手设 `error.type` 和状态,所以在 `except` 里手动记;如果不关掉自动的,同一个异常会记两次(练习 1 实测 2 个 `exception` 事件)。

</details>

5. 同样是记录一次调模型,Langfuse SDK 和今天手写的 `traced_chat` 默认记的东西有什么不同?

<details><summary>答案</summary>

Langfuse SDK(`langfuse.openai`)默认把完整的输入消息列表和输出原文都记下来;`traced_chat` 只记模型名、厂商、token、结束原因这些元数据,不记原文,这也是 GenAI 语义约定的默认态度,原文要显式打开。所以 Langfuse 里排查方便但隐私风险大,OTel 这边反过来。

</details>

6. (面试题)「公司后端已经用 OpenTelemetry 接了 Jaeger,你的 Agent 要接可观测,你怎么做?」

<details><summary>答案</summary>

要点:①用 OTel 埋点,不另起一套,这样网关、Agent、业务服务的 span 在一个 trace 里;②初始化一个 TracerProvider,Resource 里写清服务名和环境,用 Batch 处理器加 OTLP 出口发给公司现有的 Collector 或 Jaeger;③Agent 里按 GenAI 语义约定打三种 span:invoke_agent、chat(CLIENT,带厂商、模型、token、finish_reasons)、execute_tool,出错设 ERROR 和 error.type;④框架内部插不进代码的模型调用用官方自动埋点库,注意它的 provider.name 只认 SDK,别和手写的重复;⑤确认上下文传播:服务端中间件读 `traceparent`,调下游时写进去;⑥需要看 prompt 和 LLM 细节,再在同一个 provider 上挂一个出口发 Langfuse,原文默认不记、要记先脱敏;⑦验收:拿一个请求在 Jaeger 里看到从网关到工具的完整一棵树。

</details>

## 明天预告

Day 367 · Tracing(四):看什么视图,隐私和合规。三天下来,trace 已经接上了,也存下来了。明天回答两个问题:接上以后每周该固定看什么(最慢的、最贵的、各项评测的失败率、客户点踩的、单张成本的分布),在一批真实的 trace 上一个个算出来;以及 trace 里那些客户的手机号、邮箱怎么办,在数据离开进程之前把它们换掉,再说清楚数据出境、保留期限这些合规上的事。
