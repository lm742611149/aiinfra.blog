---
title: 'Day 102 · AgentOps(六):全链路可观测与成本看板'
description: 'Day 85 讲了规模化可观测该怎么设计,今天把它真正装进 AgentOps:网关和级联路由按 OTel GenAI 约定打 span 和指标,trace 从调用方一路传到上游,指标用 OTLP 推给 Collector 以支持多进程部署;再用 usage 表做成本看板和账单对账。我在本机把网关、真实的 Collector 和 Prometheus 端点串起来跑了一遍,中间踩到的五个坑都写在里面。'
pubDate: 2026-10-12
regime: none
tags: ['observability', 'opentelemetry', 'prometheus', 'cost', 'tracing', 'agent-60']
series: 'agent-60'
day: 102
lang: 'zh'
---

## 今天要解决的问题

Day 85 把规模化可观测的设计讲完了:为什么要尾部采样、原文和元数据分开管、指标的标签基数、用燃烧速率代替固定阈值告警。那一天的代码是 `agent-60-lab` 里的示例。今天把这些装进 AgentOps,让平台上线后真的能回答下面这些问题:

1. 客服说「这张工单回得特别慢」,你拿着响应头里的 trace id,能在 Jaeger 里看到这次请求在网关、级联、上游各花了多少时间吗?
2. 网关一个容器开了 4 个进程(Day 104),Prometheus 看到的数字是 4 个进程加起来的,还是随机某一个的?
3. Day 96 定的「网关额外延迟 P95 < 30ms」「成本归因误差 < 2%」这两条验收指标,上线后靠什么持续盯着?
4. 告警规则里写的指标名,和 Collector 实际吐出来的指标名对得上吗?

预计用时 5–7 小时。前置:Day 34(OTel 和 Langfuse 入门)、Day 85(规模化可观测的设计)、Day 97(网关)、Day 101(级联路由)。Day 104 的部署配置会用到今天加的环境变量。代码放在 Day 96 预留的 `src/agentops/obs/`,Collector、Prometheus 的配置放在仓库根目录的 `obs/`。

这一篇我做的验证比前几天多一层:除了单元测试,我还在本机下载了 OpenTelemetry Collector 0.162.0 和 promtool 3.13.4,用真实的 Collector 收网关的数据,用 promtool 检查告警规则。下面提到的「实测」都是这样来的。

## 埋点的分工:自动的、半自动的、手写的

先想清楚哪些靠自动埋点,哪些要自己写。

**自动的**:入站 HTTP 请求和出站 HTTP 请求。`opentelemetry-instrumentation-fastapi` 给每个进来的请求起一个 server span,并且读调用方传来的 `traceparent`;`opentelemetry-instrumentation-httpx` 给每个出去的请求起一个 client span,并且把 `traceparent` 写进请求头。有了这两个,SupportPilot 调网关、网关调上游、工具中心调租户的 MCP server、worker 调网关,链路就自动串起来了,一行业务代码都不用改。

**半自动的**:业务维度。自动埋点不知道这个请求属于哪个租户、哪个功能节点、走的哪条路由。这些要在网关的路由函数里挂到当前 span 上。

**手写的**:每一次上游模型调用。自动埋点会给它一个通用的 HTTP client span,但 GenAI 语义约定要求的东西(哪家供应商、哪个模型、多少 token、花了多少钱)它不知道,级联路由里「这次调用是小模型还是回退」更不知道。这部分自己写,也是今天代码的主体。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="一次 triage 请求的 trace 结构:调用方、网关 server span、级联里两个 chat span、各自的 httpx client span">
<rect x="20" y="20" width="600" height="34" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="32" y="42" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">SupportPilot:分诊节点(调用方自己的 span)</text>
<rect x="50" y="66" width="560" height="34" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="62" y="88" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">POST /v1/chat/completions(自动)agentops.tenant / feature / route</text>
<rect x="80" y="112" width="160" height="34" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="92" y="134" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">chat triage-v1</text>
<rect x="250" y="112" width="350" height="34" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="262" y="134" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">chat deepseek-v4-pro(回退,role=big)</text>
<rect x="100" y="158" width="130" height="34" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="112" y="180" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">POST vLLM</text>
<rect x="270" y="158" width="320" height="34" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="282" y="180" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">POST api.deepseek.com(自动,带 traceparent)</text>
<text x="32" y="222" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">蓝色:我们的服务和手写的 chat span;琥珀色:httpx 自动生成的出站 span</text>
<text x="32" y="242" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">server span 上还挂着 agentops.cascade.chosen=big、reason=low_conf</text>
</svg>
<figcaption>一次走级联路由、最后回退到大模型的请求。横向是时间,两个 chat span 一前一后。从这张图一眼能看出时间花在小模型(短)还是大模型(长)上,以及为什么回退。</figcaption>
</figure>

## 初始化:每个进程一次,trace 和指标都用推的

```python
# agentops/src/agentops/obs/telemetry.py
"""OpenTelemetry 初始化。每个进程调一次,trace 和指标都用 OTLP 推给 Collector。

为什么指标也用推而不是让 Prometheus 来拉:Day 104 网关一个容器开 4 个进程,
用 prometheus_client 暴露 /metrics 时,每次被拉到的只是其中一个进程的数。
用 OTLP 推,每个进程带着自己的 service.instance.id 推到 Collector,在那里汇总。
"""
import os
import socket

from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import MetricReader, PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SimpleSpanProcessor, SpanExporter

_initialized = False


def init(service: str = "agentops", *, span_exporter: SpanExporter | None = None,
         metric_reader: MetricReader | None = None) -> None:
    """生产上不传参数,地址读标准环境变量 OTEL_EXPORTER_OTLP_ENDPOINT;测试传内存导出器。"""
    global _initialized
    if _initialized:
        return
    resource = Resource.create({
        # 显式写进 Resource 的属性会盖过环境变量,所以这里自己先读 OTEL_SERVICE_NAME,
        # 否则网关和 worker 在 Prometheus 里都叫同一个 job
        "service.name": os.environ.get("OTEL_SERVICE_NAME", service),
        "service.instance.id": f"{socket.gethostname()}-{os.getpid()}",   # 多进程时靠它区分
        "deployment.environment.name": os.environ.get("AGENTOPS_ENV", "dev"),
    })
    tp = TracerProvider(resource=resource)
    if span_exporter is not None:
        tp.add_span_processor(SimpleSpanProcessor(span_exporter))
    else:
        tp.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(tp)

    # 同一个坑:写死 export_interval_millis 会盖过 OTEL_METRIC_EXPORT_INTERVAL,所以先读环境变量
    interval = int(os.environ.get("OTEL_METRIC_EXPORT_INTERVAL", "15000"))
    reader = metric_reader or PeriodicExportingMetricReader(OTLPMetricExporter(), export_interval_millis=interval)
    metrics.set_meter_provider(MeterProvider(resource=resource, metric_readers=[reader]))

    # 出站 httpx 请求自动带上 traceparent:网关调上游、调租户的 MCP server、worker 调网关,都能串成一条链
    HTTPXClientInstrumentor().instrument()
    _initialized = True


def instrument_app(app) -> None:
    """入站请求自动起 server span,并读取调用方传来的 traceparent。健康检查不记,省得刷屏。"""
    FastAPIInstrumentor.instrument_app(app, excluded_urls="healthz")
```

指标为什么用 OTLP 推而不是暴露 `/metrics` 让 Prometheus 来拉,注释里写了原因,这里展开一下,因为这是今天最容易做错的一个决定。Day 104 的结论是网关一个容器开 4 个进程。如果每个进程用 `prometheus_client` 暴露 `/metrics`,Prometheus 访问 `gateway:8080/metrics` 时,请求会被 uvicorn 随机交给其中一个进程,拿到的只是那一个进程的计数。这一次拉到进程 A,下一次拉到进程 B,计数器还会忽大忽小,`rate()` 算出来的是一堆噪声。`prometheus_client` 有专门的多进程模式,但要共享目录、要处理进程退出后的文件,很麻烦。用 OTLP 推就没有这个问题:每个进程带着自己的 `service.instance.id` 推到 Collector,在 Prometheus 里是独立的序列,`sum()` 一下就是全部。

这一点我实测过:网关开 2 个进程,打 20 个请求,Collector 的 Prometheus 端点上同一个指标出现两条序列,`instance` 标签分别是两个进程,数字加起来正好是总请求数。

注释里那两句「显式写进 Resource 的属性会盖过环境变量」「写死 export_interval_millis 会盖过 OTEL_METRIC_EXPORT_INTERVAL」,是我端到端跑的时候踩到的两个坑。第一版我写的是 `"service.name": service`,部署时明明设了 `OTEL_SERVICE_NAME=agentops-gateway`,Prometheus 里的 `job` 标签却一直是 `agentops`,因为代码里显式给的值优先级更高。导出间隔也一样。这类问题单元测试测不出来,只有真的接上 Collector 看一眼才发现。规则是:**凡是 OTel 标准环境变量能配的东西,代码里要么不写,要么先读环境变量再兜底**。

## 每一次上游调用:span 和指标

```python
# agentops/src/agentops/obs/genai.py
"""网关里每一次上游调用的 span 和指标,按 OTel GenAI 语义约定命名;平台自己的维度用 agentops. 前缀。

指标的标签只放取值有限的维度(租户、路由、供应商、模型、结果),工单号、运行 ID 这类
高基数的东西只进 trace,不进指标(Day 85 讲过标签基数)。
"""
import contextvars
import time
from contextlib import contextmanager
from dataclasses import dataclass, field

from opentelemetry import metrics, trace
from opentelemetry.trace import SpanKind, Status, StatusCode

tracer = trace.get_tracer("agentops.gateway")
meter = metrics.get_meter("agentops.gateway")

# 桶边界用 GenAI 语义约定建议的值。默认桶是 0 到 10000,单位是秒的话,一两秒的调用全挤在头两个桶里
op_duration = meter.create_histogram(
    "gen_ai.client.operation.duration", unit="s", description="上游模型调用耗时",
    explicit_bucket_boundaries_advisory=[0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56, 5.12, 10.24,
                                         20.48, 40.96, 81.92])
token_usage = meter.create_histogram(
    "gen_ai.client.token.usage", unit="{token}", description="每次调用的 token 数,按 input/output 区分",
    explicit_bucket_boundaries_advisory=[1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304,
                                         16777216, 67108864])
cost_counter = meter.create_counter("agentops.gateway.cost", unit="CNY", description="按网关价格表折算的花费")
attempts = meter.create_counter("agentops.upstream.attempts", description="上游尝试次数,按结果区分")
overhead = meter.create_histogram(
    "agentops.gateway.overhead", unit="ms", description="网关自身耗时 = 请求总耗时 - 上游耗时(Day 104)",
    explicit_bucket_boundaries_advisory=[1, 2, 5, 10, 20, 30, 50, 100, 200, 500, 1000, 2000, 5000])
decisions = meter.create_counter("agentops.cascade.decisions", description="级联路由的决策(Day 101)")


@dataclass
class RequestCtx:
    tenant: str = ""
    feature: str = ""
    route: str = ""
    upstream_s: float = 0.0        # 这个请求里所有上游调用的耗时总和,算网关开销用
    extra: dict = field(default_factory=dict)


current: contextvars.ContextVar[RequestCtx | None] = contextvars.ContextVar("agentops_request", default=None)


def begin_request(tenant: str, feature: str, route: str) -> None:
    """网关的路由函数开头调用:把业务维度挂到 server span 上,也存进上下文给后面的 span 用。"""
    ctx = current.get()
    if ctx is not None:                      # 中间件已经放了一个,原地填,让中间件能读到
        ctx.tenant, ctx.feature, ctx.route = tenant, feature, route
    trace.get_current_span().set_attributes({"agentops.tenant": tenant, "agentops.feature": feature,
                                             "agentops.route": route})


@contextmanager
def chat_span(provider: str, model: str, role: str | None = None):
    """包住一次上游调用。用法:
        with chat_span("deepseek", "deepseek-flash") as rec:
            resp = await prov.complete(...)
            rec(resp, cost)
    """
    ctx = current.get() or RequestCtx()
    attrs = {"gen_ai.operation.name": "chat", "gen_ai.provider.name": provider, "gen_ai.request.model": model}
    labels = {**attrs, "agentops.tenant": ctx.tenant, "agentops.route": ctx.route}
    result: dict = {}

    def record(resp: dict, cost: float) -> None:
        result["resp"], result["cost"] = resp, cost

    t0 = time.perf_counter()
    with tracer.start_as_current_span(f"chat {model}", kind=SpanKind.CLIENT, attributes=attrs) as span:
        span.set_attributes({"agentops.tenant": ctx.tenant, "agentops.feature": ctx.feature,
                             "agentops.route": ctx.route})
        if role:
            span.set_attribute("agentops.cascade.role", role)
        try:
            yield record
        except Exception as e:
            span.set_status(Status(StatusCode.ERROR, str(e)[:200]))
            span.set_attribute("error.type", type(e).__name__)
            attempts.add(1, {**labels, "outcome": "error"})
            op_duration.record(time.perf_counter() - t0, {**labels, "error.type": type(e).__name__})
            raise
        finally:
            ctx.upstream_s += time.perf_counter() - t0
        resp, cost = result.get("resp") or {}, result.get("cost", 0.0)
        u = resp.get("usage") or {}
        pt, ct = int(u.get("prompt_tokens", 0)), int(u.get("completion_tokens", 0))
        span.set_attributes({"gen_ai.response.model": resp.get("model", model),
                             "gen_ai.usage.input_tokens": pt, "gen_ai.usage.output_tokens": ct,
                             "agentops.cost_cny": cost})
        op_duration.record(time.perf_counter() - t0, labels)
        token_usage.record(pt, {**labels, "gen_ai.token.type": "input"})
        token_usage.record(ct, {**labels, "gen_ai.token.type": "output"})
        cost_counter.add(cost, {"agentops.tenant": ctx.tenant, "agentops.route": ctx.route,
                                "gen_ai.provider.name": provider})
        attempts.add(1, {**labels, "outcome": "ok"})


def record_decision(route: str, chosen: str, reason: str, shadow: bool) -> None:
    trace.get_current_span().set_attributes({"agentops.cascade.chosen": chosen, "agentops.cascade.reason": reason,
                                             "agentops.cascade.shadow": shadow})
    decisions.add(1, {"agentops.route": route, "chosen": chosen, "reason": reason, "shadow": str(shadow).lower()})


class OverheadMiddleware:
    """纯 ASGI 中间件:量网关自己花了多少时间。只看 /v1/chat/completions。"""

    def __init__(self, app, path: str = "/v1/chat/completions"):
        self.app, self.path = app, path

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"] != self.path:
            return await self.app(scope, receive, send)
        ctx = RequestCtx()
        token = current.set(ctx)
        t0 = time.perf_counter()
        try:
            await self.app(scope, receive, send)
        finally:
            current.reset(token)
            if ctx.tenant:                       # 鉴权失败的请求没有租户,不计入
                ms = (time.perf_counter() - t0 - ctx.upstream_s) * 1000
                overhead.record(ms, {"agentops.tenant": ctx.tenant, "agentops.route": ctx.route})
```

几个设计决定。

**命名照 GenAI 语义约定走。** span 名是 `chat {model}`,属性用 `gen_ai.operation.name`、`gen_ai.provider.name`、`gen_ai.request.model`、`gen_ai.usage.input_tokens` 这些标准名。约定里 `deepseek` 是登记过的标准供应商值,直接用;通义和自部署的 vLLM 没有登记,用自定义值。平台自己的维度一律用 `agentops.` 前缀,和标准属性分开,以后约定里加了同名属性也不会冲突。注意 GenAI 语义约定在 2026 年已经从主仓库搬到了单独的 `semantic-conventions-genai` 仓库,而且仍然是 Development 状态,属性名还可能变。Day 34 用的就是新仓库的名字,今天和它保持一致。

**直方图的桶边界要自己给。** OTel SDK 默认的桶边界是 0 到 10000 那一组,适合以毫秒为单位的数。`gen_ai.client.operation.duration` 的单位是秒,用默认桶的话,一两秒的模型调用全挤在最前面两个桶里,P95 根本算不出来。GenAI 语义约定给了推荐的桶边界(0.01 秒到 81.92 秒,每档翻倍),token 数也有推荐的一组。我用 `explicit_bucket_boundaries_advisory` 把它们写在创建直方图的地方,并在 Prometheus 输出里确认过桶确实变了。

**指标的标签只放低基数的维度。** 租户、路由、供应商、模型、结果,每个都只有几个到几十个取值。工单号、run id、trace id 这些只进 span,不进指标。这是 Day 85 讲过的规则,今天落到代码里。

**网关开销单独量。** Day 104 压测时,我是在 Locust 那一侧用「总耗时减上游耗时」算网关开销的。上线以后没有 Locust,所以把同样的算法搬进网关:一个纯 ASGI 中间件在请求开始时放一个上下文对象,每次上游调用把自己的耗时加进去,请求结束时用总耗时减掉,记进 `agentops.gateway.overhead`。Day 96 的「P95 < 30ms」从此有了线上数据。

然后是接线。网关路由函数里加三处,级联里加一处:

```python
# agentops/src/agentops/gateway/app.py(chat_completions 里,路由权限检查之后)
    genai.begin_request(ctx.tenant_id, feature, route)                       # Day 102
    sc = trace.get_current_span().get_span_context()
    trace_id = format(sc.trace_id, "032x") if sc.is_valid else uuid.uuid4().hex   # Day 102:用真正的 trace id

# 同一个函数里,按顺序尝试上游的循环中,原来的 resp = await prov.complete(...) 换成:
            with genai.chat_span(target.provider, target.model) as rec:          # Day 102
                resp = await prov.complete(target.model, body)
                rec(resp, cost_of_response(target.provider, target.model, resp))
```

```python
# agentops/src/agentops/router_model/cascade.py(_call 里同样包一层,多带一个 role)
        with genai.chat_span(target.provider, target.model, role=role) as rec:     # Day 102
            resp = await prov.complete(target.model, body)
            rec(resp, cost_of_response(target.provider, target.model, resp))

# agentops/src/agentops/router_model/route.py(写决策表之前)
    genai.record_decision(route, d.chosen, d.reason, policy.shadow_mode)       # Day 102
```

`cost_of_response` 是从 Day 97 网关里抽出来的一个小函数,放在 `gateway/pricing.py` 里,网关主流程、级联、埋点共用,保证 span 上的成本、指标里的成本、`usage` 表里的成本是同一个算法算的:

```python
# agentops/src/agentops/gateway/pricing.py(文件末尾加)
def cost_of_response(provider: str, model: str, resp: dict) -> float:
    """从 OpenAI 兼容响应的 usage 里算钱。Day 102 抽出来,网关主流程、级联、埋点共用一份。"""
    u = resp.get("usage") or {}
    return cost_cny(provider, model, int(u.get("prompt_tokens", 0)),
                    int((u.get("prompt_tokens_details") or {}).get("cached_tokens", 0)),
                    int(u.get("completion_tokens", 0)))
```

Day 97 用的是自己生成的 `X-Trace-Id`,现在换成了 OTel 的 trace id。响应头还叫 `X-Trace-Id`,调用方不用改,但这个值现在能直接拿去 Jaeger 里搜了。调用方如果自己传了 `traceparent`,网关会接着它的 trace 往下走,而不是另起一条。

最后在 `main.py` 的应用工厂里挂上中间件和自动埋点,`config.py` 加一个开关 `otel_enabled: bool = False`(生产设成 true):

```python
# agentops/src/agentops/main.py(create_app 里,app.state.overrides = overrides 之后)
    # Day 102 可观测:进程级初始化只做一次;测试里由夹具先用内存导出器初始化
    if settings.otel_enabled:
        from agentops.obs import telemetry
        telemetry.init()
    from agentops.obs import telemetry as _tel
    from agentops.obs.genai import OverheadMiddleware
    app.add_middleware(OverheadMiddleware)
    _tel.instrument_app(app)
```

没开 `otel_enabled` 的时候,OTel API 返回的是空实现,埋点代码照常执行但什么都不做,开销可以忽略。所以之前所有测试不用改一行就继续通过。

## 后台任务:两条 trace 用 link 连起来

运行时的任务跨越两个时刻:`POST /runs` 时的那个请求,和几秒到几小时后 worker 真正执行它。Day 85 建议把它们做成两条 trace、用 span link 连起来,而不是硬塞进一条(一条 trace 跨几小时,尾部采样根本等不到它结束)。

```python
# agentops/src/agentops/obs/runlink.py
"""运行时的任务跨越两个时刻:POST /runs 时的那个请求,和几秒到几小时后 worker 真正执行它。
按 Day 85 的建议,它们是两条 trace,用 span link 连起来,而不是硬塞进同一条 trace。

  创建任务时:runs.input 里存一份 capture() 的结果
  worker 执行时:with run_span("run supportpilot.ticket", run.input["_trace"], {...}): ...
"""
from contextlib import contextmanager

from opentelemetry import trace
from opentelemetry.trace import Link, SpanKind
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

_prop = TraceContextTextMapPropagator()
tracer = trace.get_tracer("agentops.runtime")


def capture() -> dict:
    """把当前 trace 上下文写成 {"traceparent": ...},可以直接存进 JSON 列。"""
    carrier: dict = {}
    _prop.inject(carrier)
    return carrier


@contextmanager
def run_span(name: str, carrier: dict | None, attributes: dict):
    links = []
    if carrier:
        sc = trace.get_current_span(_prop.extract(carrier)).get_span_context()
        if sc.is_valid:
            links.append(Link(sc, {"agentops.link": "created_by"}))
    # 新起一条 trace(context=空),只通过 link 指回创建它的请求
    with tracer.start_as_current_span(name, context=trace.set_span_in_context(trace.INVALID_SPAN), kind=SpanKind.CONSUMER,
                                      links=links, attributes=attributes) as span:
        yield span
```

用法是 Day 99 的 `POST /runs` 在写 `runs.input` 时顺手存一份 `capture()` 的结果,worker 跑任务时用 `run_span` 包住整个执行过程。在 Jaeger 里打开 worker 那条 trace,能看到一个指回创建请求的链接,点过去就是当时调用方那条。

## 测试:内存里的 span 和指标

OTel 的 provider 是进程级全局的,只能设一次。所以测试模块一开头就用内存导出器初始化,之后每个测试清空再断言。

```python
# agentops/tests/test_obs.py
"""可观测的测试:内存里的 span 和指标,不需要 Collector。

OTel 的 provider 是进程级全局的,只能设一次,所以用一个模块级夹具初始化,每个测试开头清空。
"""
import httpx
import pytest
from fastapi.testclient import TestClient
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.sdk.metrics.export import InMemoryMetricReader
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import SpanKind, StatusCode

from agentops.config import Settings
from agentops.gateway.providers import FakeProvider, OpenAICompatProvider
from agentops.main import create_app
from agentops.obs import telemetry
from tests.conftest import PEPPER

SPANS = InMemorySpanExporter()
READER = InMemoryMetricReader()
telemetry.init("agentops-test", span_exporter=SPANS, metric_reader=READER)


@pytest.fixture(autouse=True)
def _clear():
    SPANS.clear()
    READER.get_metrics_data()      # 读一次,把之前测试累积的增量清掉(增量语义下不会清,下面按差值断言)
    yield


def client(engine, providers):
    return TestClient(create_app(Settings(key_pepper=PEPPER), engine=engine, providers=providers))


def chat(c, key, **headers):
    return c.post("/v1/chat/completions", headers={"Authorization": f"Bearer {key}", "X-AgentOps-Feature": "ticket.draft",
                                                    **headers},
                  json={"model": "fast", "messages": [{"role": "user", "content": "hi"}]})


def metric_points(name):
    data = READER.get_metrics_data()
    out = []
    for rm in data.resource_metrics if data else []:
        for sm in rm.scope_metrics:
            for m in sm.metrics:
                if m.name == name:
                    out.extend(m.data.data_points)
    return out


def test_one_trace_server_and_chat_span(engine, keys):
    r = chat(client(engine, {"deepseek": FakeProvider("deepseek"), "qwen": FakeProvider("qwen")}), keys["cloudledger"])
    assert r.status_code == 200
    spans = SPANS.get_finished_spans()
    chat_span = next(s for s in spans if s.name == "chat deepseek-flash")
    server = next(s for s in spans if s.kind == SpanKind.SERVER)
    assert chat_span.kind == SpanKind.CLIENT
    assert chat_span.context.trace_id == server.context.trace_id
    assert chat_span.attributes["gen_ai.provider.name"] == "deepseek"
    assert chat_span.attributes["gen_ai.usage.input_tokens"] == 1000
    assert chat_span.attributes["agentops.tenant"] == "t_cloudledger"
    assert server.attributes["agentops.feature"] == "ticket.draft"
    # 响应头里的 X-Trace-Id 就是这条 trace 的 id,用户报问题时拿它直接在 Jaeger 里搜
    assert r.headers["X-Trace-Id"] == format(server.context.trace_id, "032x")


def test_continues_callers_trace(engine, keys):
    caller_trace = "4bf92f3577b34da6a3ce929d0e0e4736"
    chat(client(engine, {"deepseek": FakeProvider("deepseek"), "qwen": FakeProvider("qwen")}), keys["cloudledger"],
         traceparent=f"00-{caller_trace}-00f067aa0ba902b7-01")
    assert {format(s.context.trace_id, "032x") for s in SPANS.get_finished_spans()} == {caller_trace}


def test_failover_leaves_error_span(engine, keys):
    providers = {"deepseek": FakeProvider("deepseek", fail_times=1), "qwen": FakeProvider("qwen")}
    assert chat(client(engine, providers), keys["cloudledger"]).status_code == 200
    chats = sorted((s for s in SPANS.get_finished_spans() if s.name.startswith("chat ")), key=lambda s: s.start_time)
    assert [s.attributes["gen_ai.provider.name"] for s in chats] == ["deepseek", "qwen"]
    assert chats[0].status.status_code == StatusCode.ERROR and chats[1].status.status_code != StatusCode.ERROR


def test_traceparent_sent_upstream(engine, keys):
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["traceparent"] = req.headers.get("traceparent")
        return httpx.Response(200, json={"model": "deepseek-flash", "choices": [
            {"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": "ok"}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 2}})

    mock = httpx.AsyncClient(base_url="http://upstream.invalid", transport=httpx.MockTransport(handler))
    # instrument() 全局打补丁的对象是 httpx 自带的真实传输层,生产上 OpenAICompatProvider 用的就是它;
    # 测试换成了 MockTransport,补丁管不到,所以单独给这个 client 装一次
    HTTPXClientInstrumentor.instrument_client(mock)
    real = OpenAICompatProvider("deepseek", "http://upstream.invalid", "k", _client=mock)
    chat(client(engine, {"deepseek": real, "qwen": FakeProvider("qwen")}), keys["cloudledger"])
    server = next(s for s in SPANS.get_finished_spans() if s.kind == SpanKind.SERVER)
    assert seen["traceparent"].split("-")[1] == format(server.context.trace_id, "032x")


def test_metrics_cost_and_overhead(engine, keys):
    before = sum(p.value for p in metric_points("agentops.gateway.cost"))
    r = chat(client(engine, {"deepseek": FakeProvider("deepseek"), "qwen": FakeProvider("qwen")}), keys["cloudledger"])
    cost_points = metric_points("agentops.gateway.cost")
    assert abs(sum(p.value for p in cost_points) - before - float(r.headers["X-AgentOps-Cost-CNY"])) < 1e-6
    oh = [p for p in metric_points("agentops.gateway.overhead") if p.attributes["agentops.tenant"] == "t_cloudledger"]
    assert oh and oh[0].count >= 1
    tok = {p.attributes["gen_ai.token.type"] for p in metric_points("gen_ai.client.token.usage")}
    assert tok == {"input", "output"}


def test_worker_span_links_back_to_creating_request():
    from opentelemetry import trace as t

    from agentops.obs.runlink import capture, run_span
    with t.get_tracer("test").start_as_current_span("POST /runs") as creator:
        carrier = capture()
    with run_span("run supportpilot.ticket", carrier, {"agentops.run_id": "r_1", "agentops.tenant": "t_cloudledger"}):
        pass
    run = next(s for s in SPANS.get_finished_spans() if s.name == "run supportpilot.ticket")
    assert run.context.trace_id != creator.get_span_context().trace_id          # 两条 trace
    assert run.links[0].context.trace_id == creator.get_span_context().trace_id  # 用 link 连起来
    assert run.attributes["agentops.run_id"] == "r_1"
```

`test_traceparent_sent_upstream` 里那个 `instrument_client` 值得说一下。httpx 的全局埋点给 httpx 自带的真实传输层打补丁,测试为了不连网换成了 `MockTransport`,补丁就管不到了,第一次跑这个测试时上游根本没收到 `traceparent`。我先确认这是测试本身的问题而不是生产代码的问题:单独起了一个本地 HTTP 服务,用默认传输层发请求,服务端确实收到了 `traceparent`,trace id 和发起方一致。然后才在测试里给这个 mock client 单独装一次埋点。测试失败时先弄清楚是被测的东西坏了还是测试的假设错了,这个顺序不能反。

加上前面几天的,我本机一共 36 条测试全过。

## Collector:真的跑一遍

Collector 的配置沿用 Day 85 的思路,属性名换成 AgentOps 实际打的那些,采样规则加了一条 Day 101 的:级联里小模型输出坏了或者挂了的 trace 全留。

```yaml
# agentops/obs/otelcol.yaml
# AgentOps 的 Collector:trace 尾部采样后送 Jaeger,指标转成 Prometheus 格式给 Prometheus 拉。
# 采样规则沿用 Day 85,属性名换成 AgentOps 实际打的那些。
receivers:
  otlp:
    protocols:
      grpc: {endpoint: 0.0.0.0:4317}
      http: {endpoint: 0.0.0.0:4318}

processors:
  memory_limiter:                    # 放在最前面:Collector 自己被打爆时先丢数据,别 OOM
    check_interval: 1s
    limit_percentage: 80
    spike_limit_percentage: 20
  tail_sampling:
    decision_wait: 30s
    num_traces: 50000
    expected_new_traces_per_sec: 200
    decision_cache:
      sampled_cache_size: 100000
      non_sampled_cache_size: 500000
    policies:
      - name: errors
        type: status_code
        status_code: {status_codes: [ERROR]}
      - name: slow
        type: latency
        latency: {threshold_ms: 10000}        # 网关一次请求超过 10 秒(上游 P99 的量级)
      - name: cascade-fallback
        type: string_attribute
        string_attribute:
          key: agentops.cascade.reason
          values: [parse_error, small_down]   # Day 101:小模型出问题的那些全留
      - name: expensive
        type: ottl_condition
        ottl_condition:
          error_mode: ignore
          span:
            - 'span.attributes["agentops.cost_cny"] > 0.05'
      - name: baseline
        type: probabilistic
        probabilistic: {sampling_percentage: 10}
  batch: {}

exporters:
  otlp/jaeger:
    endpoint: jaeger:4317
    tls: {insecure: true}
  prometheus:
    endpoint: 0.0.0.0:8889             # Prometheus 来这里拉;每个网关进程的数据带着各自的 instance 标签
    # 指标名翻译规则写死,告警规则依赖它(点变下划线、带单位和类型后缀)
    translation_strategy: UnderscoreEscapingWithSuffixes
    # job 和 instance 标签已经由 service.name、service.instance.id 自动生成;其余资源属性只带环境,别把基数带上去
    resource_constant_labels:
      included: ["deployment.environment.name"]

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, tail_sampling, batch]
      exporters: [otlp/jaeger]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [prometheus]
```

我在本机下载了 `otelcol-contrib` 0.162.0,先用 `otelcol-contrib validate --config=obs/otelcol.yaml` 检查,通过。然后把 Jaeger 导出器临时换成 `debug`,真正把它跑起来,网关开两个进程、打开 `AGENTOPS_OTEL_ENABLED`,发了一批请求。中间发现了三件事:

第一,第一版配置里我用的是 Day 85 那个年代常见的 `resource_to_telemetry_conversion: {enabled: true}`,Collector 启动时打了一条警告:这个选项在 0.162.0 里已经弃用,要换成 `resource_constant_labels`。顺带想清楚了这件事:`job` 和 `instance` 标签已经由 `service.name`、`service.instance.id` 自动生成,资源属性全部转成标签只会增加基数,所以只留了环境这一个。

第二,指标名的翻译规则我显式写成了 `translation_strategy: UnderscoreEscapingWithSuffixes`。默认就是这个,但告警规则的正确性依赖它,写死比依赖默认值安全,哪天默认值变了告警不会悄悄失效。

第三,也是最重要的:FastAPI 自动埋点默认用的是旧版 HTTP 语义约定,指标名是 `http.server.duration`,标签里有一个 `http.target`,值是原始请求路径。网关只有一个路径还好,运行时的 `GET /runs/r_8f3a…` 每个任务一个路径,每个都会变成一条新的时间序列,Prometheus 迟早被撑爆。设置环境变量 `OTEL_SEMCONV_STABILITY_OPT_IN=http` 之后,改用新版约定:指标叫 `http.server.request.duration`,单位秒,标签是 `http.route`(路由模板,`/runs/{run_id}`),基数可控。我在两种设置下各跑了一次,确认了标签的变化。这个环境变量我已经加进了 Day 104 的部署配置。

下面是 Collector 吐给 Prometheus 的实际指标名,告警规则就是照着它写的:

```text
agentops_gateway_cost_CNY_total
agentops_gateway_overhead_milliseconds_bucket / _count / _sum
agentops_upstream_attempts_total
agentops_cascade_decisions_total
gen_ai_client_operation_duration_seconds_bucket / _count / _sum
gen_ai_client_token_usage_bucket / _count / _sum
http_server_request_duration_seconds_bucket / _count / _sum
```

其中 `agentops_cascade_decisions_total` 要有 triage 请求才会出现,我那批请求走的都是 fast,这个名字是用 SDK 自带的 Prometheus 读取器确认的,翻译规则和 Collector 相同。

翻译规则就三条:点变下划线;单位变后缀(毫秒是 `_milliseconds`,秒是 `_seconds`,自定义单位 CNY 原样拼上去);计数器加 `_total`。标签名也是点变下划线,`agentops.tenant` 在 Prometheus 里叫 `agentops_tenant`。

还有一个意外的好处:Collector 是在我发第一批请求之后才起来的,那批请求的指标导出失败了。但第二批请求之后,Prometheus 端点上的计数是两批的总和。因为 OTel 指标默认是累计值,进程一直记着从启动以来的总数,中间导出失败只会让 Prometheus 少几个采样点,不会少计数。这正是累计语义适合 Prometheus 的原因。

## 告警规则

```yaml
# agentops/obs/alerts.yaml
# Prometheus 告警规则。指标名是 OTel 指标经过 Collector 的 prometheus 导出器转换后的名字:
# 点变下划线,单位变后缀(ms → _milliseconds,s → _seconds),计数器加 _total。
groups:
  - name: agentops-gateway
    rules:
      # Day 96 的验收指标:网关额外延迟 P95 < 30ms。Day 104 压测时单进程扛不住就是这个先破
      - alert: GatewayOverheadP95High
        expr: |
          histogram_quantile(0.95,
            sum by (le) (rate(agentops_gateway_overhead_milliseconds_bucket[10m]))) > 30
        for: 15m
        labels: {severity: ticket}
        annotations:
          summary: "网关自身开销 P95 {{ $value | humanize }}ms,超过 30ms 目标。先看网关 CPU,Day 104 的结论是加进程"

      # 某个上游供应商的失败率。高了会触发故障切换,质量可能悄悄下降(Day 97)
      - alert: UpstreamErrorRatioHigh
        expr: |
          sum by (gen_ai_provider_name) (rate(agentops_upstream_attempts_total{outcome="error"}[10m]))
          / sum by (gen_ai_provider_name) (rate(agentops_upstream_attempts_total[10m])) > 0.05
        for: 10m
        labels: {severity: page}
        annotations:
          summary: "{{ $labels.gen_ai_provider_name }} 失败率 {{ $value | humanizePercentage }},看供应商状态页和 429 比例"

      # Day 101:小模型服务挂了,级联全部回退,不影响可用性但成本上去了,找运维不找模型团队
      - alert: CascadeSmallModelDown
        expr: |
          sum(rate(agentops_cascade_decisions_total{reason="small_down"}[10m]))
          / sum(rate(agentops_cascade_decisions_total[10m])) > 0.2
        for: 10m
        labels: {severity: ticket}
        annotations:
          summary: "triage 小模型 {{ $value | humanizePercentage }} 的请求因为不可用而回退"

  - name: agentops-slo
    rules:
      # 网关可用性 SLO 99.5%:5xx 视为坏事件。用 Day 85 的多窗口燃烧速率,这里只写最快的那一档。
      # 需要 OTEL_SEMCONV_STABILITY_OPT_IN=http,才有 http_route 和 http_response_status_code 这两个标签
      - alert: GatewayAvailabilityFastBurn
        expr: |
          (
            sum(rate(http_server_request_duration_seconds_count{http_route="/v1/chat/completions",http_response_status_code=~"5.."}[1h]))
            / sum(rate(http_server_request_duration_seconds_count{http_route="/v1/chat/completions"}[1h]))
          ) / (1 - 0.995) > 14.4
          and
          (
            sum(rate(http_server_request_duration_seconds_count{http_route="/v1/chat/completions",http_response_status_code=~"5.."}[5m]))
            / sum(rate(http_server_request_duration_seconds_count{http_route="/v1/chat/completions"}[5m]))
          ) / (1 - 0.995) > 14.4
        labels: {severity: page}
        annotations:
          summary: "网关 1 小时内烧掉了 2% 以上的月度错误预算"
```

四条规则,每条都对应前面某一天的一个结论:网关开销对应 Day 96 的验收指标和 Day 104 的压测;上游失败率对应 Day 97 的故障切换(切换成功了用户感觉不到,但质量可能悄悄降了);小模型不可用对应 Day 101;可用性燃烧速率用 Day 85 的方法,只写了最快的那一档,另外两档照着改窗口和阈值。

我用 promtool 3.13.4 跑了 `promtool check rules obs/alerts.yaml`,4 条规则语法全部通过。语法通过不代表规则在真实数据上会按预期触发,这一点要等你有了真实流量,用 promtool 的规则单测(`promtool test rules`)或者在测试环境故意制造一次故障来验证。

告警的 `severity` 只有两档:`page` 半夜叫醒人,`ticket` 开个单白天处理。上游失败率高是 page,因为它可能是供应商出了大问题,需要人决定要不要手动切换;网关开销高和小模型不可用是 ticket,它们让平台变慢或变贵,但不影响可用性。

## 本地起全家桶

开发时用一个单独的 compose 文件把 Collector、Jaeger、Prometheus、Grafana 一起起来,和 Day 96 的 `docker-compose.yml` 叠加使用:

```yaml
# agentops/obs/compose.obs.yaml
# 本地开发用的可观测全家桶,和 Day 96 的 docker-compose.yml 一起起:
#   docker compose -f docker-compose.yml -f obs/compose.obs.yaml up -d
# Jaeger 看 trace:http://localhost:16686   Prometheus:http://localhost:9090   Grafana:http://localhost:3000
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.162.0     # 和本地 validate 用的版本一致
    command: ["--config=/etc/otelcol/config.yaml"]
    volumes: [./obs/otelcol.yaml:/etc/otelcol/config.yaml:ro]
    ports: ["4317:4317", "4318:4318"]

  jaeger:
    image: jaegertracing/jaeger:2.22.0
    ports: ["16686:16686"]

  prometheus:
    image: prom/prometheus:v3.13.4
    volumes:
      - ./obs/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./obs/alerts.yaml:/etc/prometheus/alerts.yaml:ro
    ports: ["9090:9090"]

  grafana:
    image: grafana/grafana:13.0.10
    ports: ["3000:3000"]
    environment: {GF_AUTH_ANONYMOUS_ENABLED: "true"}      # 本地开发图省事,线上必须关
```

```yaml
# agentops/obs/prometheus.yml
global: {scrape_interval: 15s, evaluation_interval: 30s}
rule_files: [/etc/prometheus/alerts.yaml]
scrape_configs:
  - job_name: otel-collector
    static_configs: [{targets: ["otel-collector:8889"]}]
```

镜像版本我都去 Docker Hub 确认过存在:Collector 和本地 validate 用的是同一个 0.162.0,Jaeger 用 2.22.0(和 Day 34 一致)。这几个容器我本机没有 Docker 跑不了,配置文件只做了解析检查;Collector 那份是用真二进制跑过的。生产部署时,Day 104 的 `deploy/compose.yaml` 里加了一个 Collector 服务,网关和 worker 的环境变量里加了 `AGENTOPS_OTEL_ENABLED`、`OTEL_EXPORTER_OTLP_ENDPOINT`、`OTEL_SERVICE_NAME` 和 `OTEL_SEMCONV_STABILITY_OPT_IN`。

## 成本看板:钱的账用 usage 表,不用指标

指标里有 `agentops_gateway_cost_CNY_total`,看板能不能直接用它?用来看趋势、做告警可以,用来对账不行。指标会因为进程重启、采集失败丢掉一些点,`rate()` 和 `increase()` 在这种情况下算出来的是近似值。Day 96 的验收指标是「平台按租户加功能汇总的成本,与上游账单误差小于 2%」,这种精度只能用一行不少的明细。Day 97 的 `usage` 表就是这份明细,失败的调用也记了一行。

```python
# agentops/src/agentops/obs/cost.py
"""成本看板和对账。数据源是 Day 97 的 usage 表:它是钱的唯一事实来源,指标里的成本只用来告警。

为什么不直接用 Prometheus 里的 agentops_gateway_cost_CNY_total 做看板:指标会因为采集失败、
进程重启丢点,用来看趋势和告警没问题,用来对账不行。对账必须用一行不少的明细。
"""
import csv
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import case, func, select
from sqlalchemy.engine import Engine

from agentops.db import usage


def daily_cost(engine: Engine, days: int = 7, by: tuple[str, ...] = ("tenant_id", "feature"),
               now: datetime | None = None) -> list[dict]:
    """按天 + 指定维度汇总花费、调用数、失败数。看板上「哪个租户的哪个节点最贵」就是这张表。"""
    since = (now or datetime.now(UTC)) - timedelta(days=days)
    day = func.date(usage.c.ts).label("day")
    cols = [day] + [usage.c[k] for k in by]
    q = (select(*cols, func.sum(usage.c.cost_cny).label("cost_cny"), func.count().label("calls"),
                func.sum(case((usage.c.status == "upstream_error", 1), else_=0)).label("errors"))
         .where(usage.c.ts >= since).group_by(*cols).order_by(day, func.sum(usage.c.cost_cny).desc()))
    with engine.connect() as c:
        return [dict(r) for r in c.execute(q).mappings()]


@dataclass
class Gap:
    day: str
    ours: float
    bill: float

    @property
    def rel(self) -> float:
        return abs(self.ours - self.bill) / self.bill if self.bill else float("inf")


def reconcile(engine: Engine, provider: str, bill_csv: str, tolerance: float = 0.02) -> list[Gap]:
    """把供应商控制台导出的按天账单(两列:date, amount_cny)和 usage 表按天的汇总对比。
    返回误差超过 tolerance(默认 2%,Day 96 的验收指标)的那些天。自部署模型用 GPU 账单对。"""
    bill: dict[str, float] = defaultdict(float)
    with open(bill_csv, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            bill[row["date"]] += float(row["amount_cny"])
    if not bill:
        return []
    first = min(bill)
    with engine.connect() as c:
        ours = {str(r.day): float(r.cost) for r in c.execute(
            select(func.date(usage.c.ts).label("day"), func.sum(usage.c.cost_cny).label("cost"))
            .where(usage.c.provider == provider, usage.c.ts >= date.fromisoformat(first))
            .group_by(func.date(usage.c.ts)))}
    gaps = [Gap(d, round(ours.get(d, 0.0), 4), round(amt, 4)) for d, amt in sorted(bill.items())]
    return [g for g in gaps if g.rel > tolerance]
```

```python
# agentops/tests/test_cost.py
from datetime import UTC, datetime, timedelta

from sqlalchemy import insert

from agentops.db import usage
from agentops.obs.cost import daily_cost, reconcile

NOW = datetime(2026, 10, 12, 12, 0, tzinfo=UTC)


def _row(tenant, feature, provider, cost, days_ago, status="ok"):
    return dict(tenant_id=tenant, feature=feature, route="fast", provider=provider, model="m", prompt_tokens=1,
                completion_tokens=1, cost_cny=cost, latency_ms=1, status=status, ts=NOW - timedelta(days=days_ago))


def test_daily_cost_by_tenant_feature(engine):
    with engine.begin() as c:
        c.execute(insert(usage), [
            _row("t_cloudledger", "ticket.draft", "deepseek", 1.0, 0),
            _row("t_cloudledger", "ticket.draft", "deepseek", 2.0, 0),
            _row("t_cloudledger", "ticket.triage", "vllm", 0.1, 0),
            _row("t_cloudledger", "ticket.draft", "deepseek", 0.0, 0, status="upstream_error"),
            _row("t_acme", "chat", "deepseek", 5.0, 1),
            _row("t_acme", "chat", "deepseek", 9.0, 30),          # 窗口外
        ])
    rows = daily_cost(engine, days=7, now=NOW)
    today = [r for r in rows if r["day"] == "2026-10-12"]
    assert today[0]["feature"] == "ticket.draft" and today[0]["cost_cny"] == 3.0
    assert today[0]["calls"] == 3 and today[0]["errors"] == 1
    assert sum(r["cost_cny"] for r in rows) == 3.0 + 0.1 + 5.0


def test_reconcile_flags_days_over_2_percent(engine, tmp_path):
    with engine.begin() as c:
        c.execute(insert(usage), [_row("t", "f", "deepseek", 10.0, 1), _row("t", "f", "deepseek", 10.0, 0)])
    bill = tmp_path / "deepseek-2026-10.csv"
    bill.write_text("date,amount_cny\n2026-10-11,10.1\n2026-10-12,11.0\n", encoding="utf-8")
    gaps = reconcile(engine, "deepseek", str(bill))
    assert [(g.day, g.ours, g.bill) for g in gaps] == [("2026-10-12", 10.0, 11.0)]   # 1% 那天放过,9% 那天报出
```

`reconcile` 每天跑一次:从供应商控制台导出昨天的账单(大多数平台都能导出按天的 CSV),和 `usage` 表按天汇总对比,误差超过 2% 的那天报出来。差出来的钱一般有几个来源:价格表没跟上供应商调价、缓存命中的计费字段算错(Day 97 提醒过,不同供应商字段名不一样)、超时的请求上游其实计费了但我们记的是 0。自部署的模型用 GPU 账单对,对出来的差距就是 Day 101 说的「利用率估高了」。

Grafana 看板直接连 Postgres 查,四个面板:

```sql
-- agentops/obs/dashboards/cost_panels.sql
-- Grafana 成本看板的四个面板,数据源选 PostgreSQL,直接查 AgentOps 的库(用只读账号)。
-- $__timeFilter / $__timeGroupAlias 是 Grafana 的宏,会替换成看板当前选的时间范围和分桶。

-- 面板 1:每天每个租户花了多少钱(堆叠柱状图)
SELECT $__timeGroupAlias(ts, '1d'), tenant_id AS metric, sum(cost_cny) AS value
FROM usage WHERE $__timeFilter(ts)
GROUP BY 1, 2 ORDER BY 1;

-- 面板 2:钱花在哪个节点(表格,按花费倒序)。feature 是调用方在 X-AgentOps-Feature 里报的
SELECT tenant_id, feature, route, count(*) AS calls, round(sum(cost_cny)::numeric, 2) AS cost_cny,
       round((sum(cost_cny) / nullif(count(*), 0))::numeric, 5) AS cny_per_call
FROM usage WHERE $__timeFilter(ts)
GROUP BY 1, 2, 3 ORDER BY cost_cny DESC LIMIT 30;

-- 面板 3:故障切换比例(时间序列)。fallback_ok 是主供应商失败、备用成功的那些
SELECT $__timeGroupAlias(ts, '1h'), route AS metric,
       avg(CASE WHEN status = 'fallback_ok' THEN 1.0 ELSE 0.0 END) AS value
FROM usage WHERE $__timeFilter(ts) AND status IN ('ok', 'fallback_ok')
GROUP BY 1, 2 ORDER BY 1;

-- 面板 4:triage 级联(Day 101):小模型接住的比例,以及 shadow 期间小模型确定时的一致率
SELECT $__timeGroupAlias(ts, '1d'),
       avg(CASE WHEN reason = 'confident' THEN 1.0 ELSE 0.0 END) AS small_share,
       avg(CASE WHEN small_label = big_label THEN 1.0 ELSE 0.0 END)
         FILTER (WHERE reason = 'confident' AND big_label IS NOT NULL) AS agreement_when_confident
FROM route_decisions WHERE $__timeFilter(ts) AND route = 'triage'
GROUP BY 1 ORDER BY 1;
```

这四条 SQL 是 Postgres 语法加 Grafana 的宏,我本机没有 Postgres 和 Grafana,没有实际跑过,`cost.py` 里同样逻辑的汇总在 SQLite 上测过。Grafana 连库要用只读账号,`usage` 和 `route_decisions` 两张表给 SELECT 就够了。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1NwNVemEyE&autoplay=0&high_quality=1" title="【IT老齐695】OpenTelemetry日志、指标、链路一站解决方案" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT老齐 · 【IT老齐695】OpenTelemetry日志、指标、链路一站解决方案 · 23 分钟。OTel 三种信号和 Collector 的整体架构,讲得很清楚,适合在读今天的配置之前看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/crEyMDJ4Bp0" title="LLM Observability with OpenTelemetry - Ultimate Guide" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Agenta AI · LLM Observability with OpenTelemetry - Ultimate Guide · 9 分钟。用 OTel 记大模型调用的 span 和属性,和今天的 chat_span 是同一件事,看别人怎么组织属性。</figcaption>
</figure>

## 动手练习

**目标**:AgentOps 每一次上游调用都有带 GenAI 属性的 span,trace 能从调用方一路串到上游;多进程下指标正确汇总;告警规则的指标名经过实际验证;每天自动对账。

1. 装依赖:`uv add opentelemetry-sdk opentelemetry-exporter-otlp-proto-http opentelemetry-instrumentation-fastapi opentelemetry-instrumentation-httpx`。写 `obs/telemetry.py`、`obs/genai.py`、`obs/runlink.py`、`obs/cost.py`,按「接线」那几段改网关、级联和 `main.py`。
2. 写 `tests/test_obs.py` 和 `tests/test_cost.py`,全部测试通过。
3. 起 Collector(有 Docker 用 `obs/compose.obs.yaml`;没有的话像我一样下载 `otelcol-contrib` 二进制,把 Jaeger 导出器换成 `debug`)。网关开两个进程、打开 `AGENTOPS_OTEL_ENABLED`,发一批请求,做三件事:在 Collector 日志里看到 trace;在 `:8889/metrics` 上看到两个 `instance` 的序列;确认 `job` 标签是你设的服务名。
4. 去掉 `OTEL_SEMCONV_STABILITY_OPT_IN=http` 再跑一次,对比 HTTP 指标的名字和标签,体会 `http.target` 和 `http.route` 的区别。
5. 用 `promtool check rules` 检查告警规则;再挑一条,写一个 `promtool test rules` 的单测,用假的时间序列验证它会触发。
6. 从供应商控制台导出一周账单,跑 `reconcile`,把差距超过 2% 的天查清楚原因。

**验收标准**:

- 测试全过。
- 用一个请求的 `X-Trace-Id` 能在 Jaeger 里找到这条 trace(或者在 Collector 的 debug 输出里找到同一个 trace id),里面有 server span、chat span 和 httpx 出站 span。
- 多进程下 Prometheus 上能看到每个进程一条序列,`sum` 等于实际请求数。
- 告警规则里的每个指标名都能在 Collector 的 Prometheus 端点上找到。
- 对账脚本跑过一次,有结论。

记录表:

| 项目 | 结果 |
| --- | --- |
| 测试条数 / 通过 | |
| 两个进程时同一指标的序列数 | |
| 开 / 不开 `OTEL_SEMCONV_STABILITY_OPT_IN` 时 HTTP 指标名 | |
| 网关开销 P95(线上或压测) | |
| promtool check rules 结果 | |
| 一周对账:超过 2% 的天数,主要原因 | |

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 自动埋点 | instrumentation 库替你给框架和 HTTP 客户端打 span,不改业务代码 |
| traceparent | W3C 标准的请求头,携带 trace id 和父 span id,服务之间靠它串起链路 |
| span link | 把一个 span 指向另一条 trace 里的某个 span,用来关联不在同一条 trace 里的因果关系 |
| GenAI 语义约定 | OpenTelemetry 为大模型调用定的 span、属性、指标命名规范,2026 年起在单独的仓库维护 |
| Resource | 描述「是谁在上报」的属性集合,比如服务名、实例 ID、环境 |
| OTLP | OpenTelemetry 的传输协议,trace、指标、日志都用它推给 Collector |
| 累计值 | cumulative,计数器上报从进程启动以来的总数,丢几次上报不会丢计数 |
| 桶边界 | 直方图把观测值分到哪些区间里,决定了分位数能算多准 |
| 语义约定迁移开关 | OTEL_SEMCONV_STABILITY_OPT_IN,让自动埋点从旧版命名切到新版命名 |
| translation_strategy | Collector 的 Prometheus 导出器把 OTel 指标名翻译成 Prometheus 名字的规则 |
| promtool | Prometheus 自带的命令行工具,能检查规则语法、跑规则单测 |
| 对账 | 用平台自己的明细和供应商账单逐天对比,找出计费错误 |

## 常见误区

**多进程部署时让 Prometheus 拉 /metrics。** 每次只拉到其中一个进程的数。用 OTLP 推,每个进程一条序列。

**代码里写死 OTel 能用环境变量配的东西。** 显式值会盖过环境变量,部署时的配置悄悄失效。先读环境变量再兜底。

**直方图用默认桶边界。** 单位是秒时默认桶毫无用处。按 GenAI 语义约定给桶边界。

**不管 HTTP 语义约定的版本。** 旧版用原始路径做标签,带 ID 的路径会把指标系统撑爆。打开迁移开关,用路由模板。

**告警规则里的指标名凭感觉写。** 名字经过 Collector 翻译,单位后缀、`_total` 一个不对告警就永远不会触发,而且不会报错。去 Collector 的输出里抄。

**用指标做对账。** 指标会丢点,适合看趋势和告警。对账用一行不少的明细表。

**测试失败就改测试。** 先确认是被测代码坏了还是测试的假设错了。我那个 traceparent 测试,是先用真实传输层证明生产代码没问题,才去改测试的。

**把长任务塞进一条 trace。** 尾部采样等不到它结束。拆成两条,用 link 连。

## 学习资料

### 文档与文章

- [OpenTelemetry GenAI 语义约定(新仓库)](https://github.com/open-telemetry/semantic-conventions-genai):span、属性、指标的命名规范,指标那一篇里有推荐的桶边界和标准供应商名单。原来 opentelemetry.io 上的页面已经标成「已迁移」。
- [HTTP 语义约定迁移说明](https://opentelemetry.io/docs/specs/semconv/non-normative/http-migration/):`OTEL_SEMCONV_STABILITY_OPT_IN` 的几个取值和新旧名字对照。
- [FastAPI 自动埋点文档](https://opentelemetry-python-contrib.readthedocs.io/en/latest/instrumentation/fastapi/fastapi.html):`excluded_urls` 等参数。
- [Collector 的 Prometheus 导出器](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/exporter/prometheusexporter):`resource_constant_labels` 和 `translation_strategy` 的说明,配置以你用的版本的 README 为准。
- [W3C Trace Context](https://www.w3.org/TR/trace-context/):`traceparent` 头的格式,10 分钟。
- [Google SRE Workbook:Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/):多窗口燃烧速率告警的原始出处,Day 85 讲过,今天的可用性规则照它写。
- [promtool](https://prometheus.io/docs/prometheus/latest/command-line/promtool/):`check rules` 和 `test rules` 的用法。
- [Grafana PostgreSQL 数据源](https://grafana.com/docs/grafana/latest/datasources/postgres/):`$__timeFilter`、`$__timeGroupAlias` 这些宏的说明。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1QPYDztEtW&autoplay=0&high_quality=1" title="大厂是怎么监控 Java 项目的?保姆级教程 | Prometheus + Grafana 可观测性实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员鱼皮 · 大厂是怎么监控 Java 项目的?保姆级教程 | Prometheus + Grafana 可观测性实战 · 38 分钟,3P。虽然是 Java 项目,Prometheus 抓取、Grafana 面板和告警的部分是通用的,没用过 Grafana 的话看一遍。</figcaption>
</figure>

- 「初禾w-w · B站最全最新版本Langfuse落地教程」(BV1kZ3y6hEQM,20P):如果你的团队除了 Jaeger 还想用 Langfuse 看带原文的 trace(Day 85 那条「带原文」的管道),挑接入和自托管那几 P 看。

### 其他经典视频

- OpenObservability Talks「OpenTelemetry for GenAI and the OpenLLMetry project」(YouTube,1 小时):GenAI 语义约定是怎么来的,和社区里的自动埋点项目 OpenLLMetry 的关系。

### 书籍

- Charity Majors、Liz Fong-Jones、George Miranda,《Observability Engineering》,O'Reilly,2022。读讲结构化事件和高基数的章节,理解为什么「指标放低基数、高基数放 trace」。没查证到中文版,以英文原版为准。
- Betsy Beyer 等,《The Site Reliability Workbook》,O'Reilly,2018,[官方免费在线版](https://sre.google/workbook/table-of-contents/)。第 5 章 Alerting on SLOs。

### 开源项目与代码

- [open-telemetry/opentelemetry-python](https://github.com/open-telemetry/opentelemetry-python):SDK 本身,遇到「显式值盖过环境变量」这类问题时读 `Resource.create` 和 `PeriodicExportingMetricReader` 的源码最快。
- [traceloop/openllmetry](https://github.com/traceloop/openllmetry):给 OpenAI、Anthropic 等 SDK 自动打 GenAI span 的开源埋点库,SupportPilot 那一侧可以直接用它。

## 自测

1. 网关一个容器开 4 个进程,用 `prometheus_client` 暴露 `/metrics` 让 Prometheus 来拉,会出什么问题?怎么解决?

<details><summary>答案</summary>

Prometheus 每次拉取被 uvicorn 交给其中一个进程,拿到的只是那个进程的计数,不同次拉到不同进程,计数器忽大忽小,`rate()` 算出来是噪声。解决办法是每个进程用 OTLP 把指标推给 Collector,每个进程带着自己的 `service.instance.id`,在 Prometheus 里是独立的序列,用 `sum()` 汇总。`prometheus_client` 的多进程模式也能解决,但要共享目录、处理进程退出,更麻烦。

</details>

2. 部署时设了 `OTEL_SERVICE_NAME=agentops-gateway`,Prometheus 里 `job` 标签却是 `agentops`。可能的原因是什么?

<details><summary>答案</summary>

代码里创建 Resource 时显式写了 `service.name`,显式值的优先级高于环境变量。修法是在代码里先读 `OTEL_SERVICE_NAME` 再兜底,或者干脆不在代码里写 `service.name`。同类问题还有导出间隔、导出地址等,凡是 OTel 标准环境变量能配的,代码里都不要写死。

</details>

3. 为什么要设置 `OTEL_SEMCONV_STABILITY_OPT_IN=http`?不设会有什么后果?

<details><summary>答案</summary>

不设的话,FastAPI 自动埋点用旧版 HTTP 语义约定,指标标签里有 `http.target`,值是原始路径。运行时的 `GET /runs/{run_id}` 每个任务一个路径,每个都是一条新的时间序列,指标系统的序列数会无限增长。设了之后用新版约定,标签是 `http.route`(路由模板),基数可控,指标名也换成 `http.server.request.duration`,单位是秒。

</details>

4. 告警规则写的是 `agentops_gateway_overhead_ms_bucket`,上线一个月从来没响过。最可能的原因是什么?

<details><summary>答案</summary>

指标名写错了。OTel 指标经过 Collector 翻译后,单位 `ms` 变成后缀 `_milliseconds`,实际名字是 `agentops_gateway_overhead_milliseconds_bucket`。Prometheus 对不存在的指标不会报错,表达式结果永远为空,告警永远不会触发。规则里的名字要从 Collector 的实际输出里抄,并用 promtool 的规则单测验证会触发。

</details>

5. 为什么成本对账用 `usage` 表而不用 Prometheus 里的成本计数器?

<details><summary>答案</summary>

指标会因为进程重启、导出失败、采集间隔丢点,`increase()` 这类函数在重置和缺点时只能近似。对账要求误差小于 2%,需要一行不少的明细。`usage` 表每一次上游调用都记一行,包括失败的,是钱的唯一事实来源。指标里的成本只用来看趋势和做告警。

</details>

6. **资深面试题**:你接手了一个 Agent 平台,老板说「我们上了 OpenTelemetry,可观测已经做完了」。你会检查哪些东西来判断它是不是真的做完了?

<details><summary>答案</summary>

不看装了什么,看能不能回答问题。先拿几个具体问题去试:随便挑一个用户投诉的请求,能不能用它的 trace id 在后端找到完整链路,从调用方到网关到上游,每一段耗时清楚;一个后台任务能不能找到创建它的那个请求。然后查指标:多进程部署下指标是不是正确汇总(看序列数和实例标签);直方图的桶边界和单位是否匹配,分位数算得出来吗;有没有高基数的标签,比如原始路径或者 ID;HTTP 语义约定是新版还是旧版。再查告警:规则里的指标名在实际输出里存不存在,有没有用规则单测或者故障演练证明它会响,告警有没有分级(叫醒人的和开单的)。最后查成本和合规:成本能不能细到租户和功能节点、和账单对过账没有;带原文的 trace 有没有脱敏、访问控制和保留期。每一项给出「能 / 不能 / 部分」和证据,做不到的列成改进计划。「装了 OTel」只是第一步,「出事时三分钟内能定位到原因」才是做完。

</details>

## 明天预告

Day 103 · AgentOps(七):安全加固与红队回归。看得见之后要守得住。明天从平台的信任边界讲起:跨租户越权、工具定义被偷换、刷钱、审计被改,先用确定性测试把隔离钉死,再把 promptfoo 红队接进夜间 CI。今天加的 trace 会在红队失败时派上用场,每一条被打穿的攻击都能在 Jaeger 里看到完整的调用过程。
