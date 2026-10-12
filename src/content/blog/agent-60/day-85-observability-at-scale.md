---
title: 'Day 85 · 规模化可观测:OTel 全链路、采样、成本看板、告警'
description: '一个 Agent 接 Langfuse 很简单,一百万次运行每天全量记录就会把存储和预算压垮。今天算清 trace 的数据量,用 OpenTelemetry Collector 的尾部采样只留下有价值的 trace,把 prompt 原文和元数据分开存、分开保留,定一套 Agent 的指标和 SLO,用燃烧速率代替固定阈值做告警。'
pubDate: 2026-10-12
regime: none
tags: ['observability', 'opentelemetry', 'sampling', 'slo', 'alerting', 'agent-60']
series: 'agent-60'
day: 85
lang: 'zh'
---

## 今天要解决的问题

Day 34 给工单 Agent 接上 Langfuse 和 OpenTelemetry 的时候,我们的做法是「全记」:每次运行、每次模型调用、每个工具调用都生成 span,prompt 和回复原文全部带上。一个 Agent、每天几百次运行,这样做没有任何问题,而且非常好用,出了问题打开 trace 就能看到模型当时看到了什么。

现在平台上有 30 个 Agent,每天合计一百万次运行。全记会发生三件事:存储和观测平台的账单比模型费用还高;trace 后端的查询越来越慢,真出事的时候打不开;安全团队发现全公司客户的对话原文都在 trace 里,保留了一年,任何有看板权限的人都能翻。

今天结束时你应该能:

1. 估算一个 Agent 平台每天的 trace 数据量,知道钱花在哪个部分。
2. 让 trace 一路穿过模型网关和工具中心,形成完整的调用链。
3. 用 OpenTelemetry Collector 配置尾部采样:错误、慢请求、转人工、低评分、高成本的 trace 全留,其余按比例抽样。
4. 把 prompt 原文和元数据拆成两条管道,分别脱敏、分别设置保留期。
5. 定一套 Agent 的核心指标和 SLO,用多窗口燃烧速率告警,并做成本异常检测。

预计用时 5 小时。前置:Day 34(Langfuse 和 OTel 基础,GenAI 语义约定)、Day 52(成本账本)、Day 82–84(平台、网关、工具中心)。

## 先算账:trace 到底有多大

做任何采样决策之前,先估一下数据量。拿 Day 38 那张退款工单来算:一次运行大约 4 次模型调用,累计输入约 17,000 token、输出约 700 token,再加上检索、几次工具调用、几个工作流节点,大概 30 个 span。

元数据部分(span 名、时间、模型名、token 数、状态、租户、Agent 版本这些属性),每个 span 大约 1 KB,一次运行约 30 KB。

内容部分才是大头。按语义约定,每个模型调用的 span 上可以带 `gen_ai.input.messages` 和 `gen_ai.output.messages`,也就是完整的输入和输出。注意每次调用都会带上**完整的**对话历史,所以 4 次调用的输入加起来就是那 17,000 token。中文按每个 token 约 1.5 个字、每个字 3 字节(UTF-8)算,再加上工具返回结果和 JSON 结构的开销,一次运行的内容部分大约 100 KB。

一百万次运行每天:

```text
元数据: 1,000,000 × 30 KB  ≈ 30 GB/天
内容:   1,000,000 × 100 KB ≈ 100 GB/天
保留 30 天:元数据 0.9 TB,内容 3 TB
```

几个结论很直接:内容比元数据大三倍以上,而且内容是唯一有隐私风险的部分;元数据才是算指标、画看板需要的东西;真正需要回看原文的,只是出了问题的那一小部分运行。这就是今天所有设计的出发点:**元数据多留、原文少留;正常的少留、异常的全留**。

## 先把链路连起来

采样之前还要保证 trace 是完整的。平台化之后,一次运行会经过好几个服务:Agent 运行时、模型网关、工具中心、下游的 MCP server。如果每个服务各自起一个 trace,你在后端看到的是四段互不相关的碎片。

OpenTelemetry 用 W3C 的 `traceparent` 头在服务之间传递 trace 上下文。规则很简单:每个服务收到请求时读出上游的 `traceparent`,在它下面创建子 span;调用下游时再把自己的上下文写进 `traceparent`。

- **Agent 运行时到模型网关**:用 OpenAI SDK 调网关时,`opentelemetry-instrumentation-httpx` 会自动在 HTTP 头里加上 `traceparent`;网关这边用 `opentelemetry-instrumentation-fastapi` 自动读取。昨天写的网关加两行初始化就能接上。
- **网关到模型供应商**:供应商不会参与你的 trace,链路在网关这里结束,但网关的 span 里记下供应商、模型、token 数和耗时。
- **Agent 到工具中心再到 MCP server**:2026-07-28 版 MCP 规范明确了 trace 上下文通过请求 `_meta` 里的 `traceparent`、`tracestate`、`baggage` 传递,所以即使工具调用走的是 stdio,链路也能接上。

还有一个很实用的做法:在 trace 的根 span 上放几个「业务属性」,比如 `agentops.tenant`、`agentops.agent`、`agentops.agent_version`、`agentops.run_id`,用 OTel 的 baggage 把它们传给下游,每个服务在自己的 span 上也记一份。这样不管从哪一段开始查,都能按租户和 Agent 版本过滤。

## 采样:头部还是尾部

采样有两种时机。

**头部采样(head sampling)**:请求一进来就决定记不记,比如随机记 5%。实现简单、开销小,但它在决定时不知道这次运行会不会出错,所以出错的运行有 95% 的概率没被记下来,而那正是你最想看的。

**尾部采样(tail sampling)**:先把一个 trace 的所有 span 收齐,看完整个 trace 再决定留不留。可以按「有没有错误、耗时多长、属性是什么」来决定。代价是 Collector 要把所有进行中的 trace 缓存在内存里等它们结束。

Agent 场景几乎一定要用尾部采样,因为你关心的那些运行(出错、转人工、评分低、特别贵)只有在运行结束后才知道。一套实用的规则是:

| 保留规则 | 依据 |
| --- | --- |
| 有任何 span 状态是 ERROR | 错误全留 |
| 整个 trace 耗时超过 30 秒 | 慢的全留(阈值按你的 P99 定) |
| 转了人工 | 业务意义上的失败 |
| 线上评测分数低于 0.6 | 质量问题 |
| 单次运行成本超过 0.05 美元 | 成本异常 |
| 指定租户(刚接入、或者在排查问题) | 临时全量 |
| 其余随机 5% | 当基线,用来对比「正常长什么样」 |

尾部采样的规则是「任意一条投了保留票就保留」,所以随机 5% 的那部分里也会包含一部分错误,这没关系。

下面是 Collector 的配置。它用了一个 `forward` 连接器把一条管道拆成两条:采样后的 trace 一份带原文发给 Langfuse(短保留),一份去掉原文发给长期存储(这里用 Grafana Tempo 举例)。

```yaml
# agent-60-lab/w13/obs/otelcol.yaml
receivers:
  otlp:
    protocols:
      grpc: {endpoint: 0.0.0.0:4317}
      http: {endpoint: 0.0.0.0:4318}

processors:
  tail_sampling:
    decision_wait: 60s                 # Agent 运行比普通请求长,等久一点再决定
    num_traces: 200000                 # 内存里最多同时缓存的 trace 数
    expected_new_traces_per_sec: 2000
    decision_cache:                    # 决定做完后才到的晚到 span,按缓存的决定处理
      sampled_cache_size: 500000
      non_sampled_cache_size: 2000000
    policies:
      - name: errors
        type: status_code
        status_code: {status_codes: [ERROR]}
      - name: slow
        type: latency
        latency: {threshold_ms: 30000}
      - name: escalated
        type: boolean_attribute
        boolean_attribute: {key: agentops.escalated, value: true}
      - name: low-eval-or-expensive
        type: ottl_condition
        ottl_condition:
          error_mode: ignore
          span:
            - 'span.attributes["gen_ai.evaluation.score.value"] < 0.6'
            - 'span.attributes["agentops.cost_usd"] > 0.05'
      - name: debug-tenants
        type: string_attribute
        string_attribute: {key: agentops.tenant, values: [finance-onboarding]}
      - name: baseline
        type: probabilistic
        probabilistic: {sampling_percentage: 5}

  # 长期存储那一路:删掉原文,只留元数据
  attributes/strip_content:
    actions:
      - {key: gen_ai.input.messages, action: delete}
      - {key: gen_ai.output.messages, action: delete}
      - {key: gen_ai.system_instructions, action: delete}
      - {key: gen_ai.tool.call.arguments, action: delete}
      - {key: gen_ai.tool.call.result, action: delete}

  # 带原文那一路:原文留着,但遮掉手机号、身份证号这类值
  redaction/pii:
    allow_all_keys: true
    blocked_values:
      - '1[3-9][0-9]{9}'                       # 大陆手机号
      - '[1-9][0-9]{16}[0-9Xx]'                # 身份证号
    summary: info

  batch: {}

connectors:
  forward/sampled: {}

exporters:
  otlphttp/langfuse:
    endpoint: ${env:LANGFUSE_OTEL_ENDPOINT}   # Langfuse 的 OTLP 地址:你的 Langfuse 域名 + /api/public/otel
    headers: {Authorization: "Basic ${env:LANGFUSE_AUTH}"}
  otlp/tempo:
    endpoint: tempo:4317
    tls: {insecure: true}

service:
  pipelines:
    traces/in:
      receivers: [otlp]
      processors: [tail_sampling]
      exporters: [forward/sampled]
    traces/with_content:
      receivers: [forward/sampled]
      processors: [redaction/pii, batch]
      exporters: [otlphttp/langfuse]
    traces/metadata_only:
      receivers: [forward/sampled]
      processors: [attributes/strip_content, batch]
      exporters: [otlp/tempo]
```

几个容易踩的坑。

**数值条件为什么用 OTTL。** 尾部采样的 `numeric_attribute` 策略只认整数,成本 0.05 美元和评测分数 0.6 都是小数,所以用 `ottl_condition`,它能比较浮点数。

**长时间运行的 Agent。** `decision_wait` 是从这个 trace 的第一个 span 到达开始计时的。一个需要人工审批的工单可能挂好几个小时,远远超过 60 秒。解决办法有两个:一是 `decision_cache`,让决定之后才到达的 span 按缓存的决定处理;二是从设计上把长任务拆开,人工审批前后各算一个 trace,用 span link 或者 `run_id` 关联起来。Day 65 讲持久化执行时提过,断点续跑的任务本来就适合这样切。

**多个 Collector 实例。** 尾部采样要求同一个 trace 的所有 span 落到同一个 Collector 实例上,否则每个实例只看到一部分,决定就是错的。规模大了要加一层「负载均衡 Collector」,用 `loadbalancing` 导出器按 trace ID 把 span 分发到后面的采样层。

**Langfuse 自己也有采样。** 如果你只用 Langfuse 不用 Collector,它的 SDK 支持按比例采样(文档在文末),但那是头部采样,用来控制量可以,用来留住错误不行。

## 原文和元数据分开管

上面的配置已经把原文和元数据拆成了两路,这里把背后的原则说清楚。

**原文默认不采,显式开启。** OTel 的 GenAI 语义约定对 `gen_ai.input.messages` 这类内容属性的建议是:默认不采集,由使用者明确开启,自动埋点库通常用 `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` 这样的环境变量控制。平台层面应该把这个开关做成按租户配置的,而且开启要有理由、有审批。

**两路不同的保留期。** 带原文的那一路保留 14 到 30 天就够了,足以覆盖问题的发现和排查周期;只有元数据的那一路可以保留半年到一年,用来看趋势和做容量规划。Day 86 会讲保留期和合规要求的关系。

**脱敏在 Collector 里做最后一道。** 应用层应该先做脱敏(Day 40 的 PII 处理),Collector 的 redaction 是兜底。正则只能抓格式固定的东西(手机号、身份证号、银行卡号),抓不住「我住在某某小区几号楼」这种。所以兜底归兜底,原文的访问权限和保留期才是主要防线。

**看原文要有权限和审计。** 带原文的 trace 后端要按租户控制访问权限,谁看了哪条 trace 也要记下来。很多团队在这一点上很松,看板账号全员共享,这在 Day 86 的安全问卷里过不了关。

## Agent 的指标体系

trace 是用来查单个问题的,指标是用来看全局和告警的。一个 Agent 平台我建议至少有这几组指标,都要能按租户、Agent、Agent 版本、模型组拆开看:

| 类别 | 指标 | 怎么得到 |
| --- | --- | --- |
| 结果 | 任务成功率、转人工率、用户反馈(赞踩)、线上评测分 | 运行结束时打点;评测分来自 W11 的线上评测 |
| 延迟 | 端到端 P50/P95/P99、首 token 延迟、每步模型调用和工具调用耗时 | span 时长,或直方图指标 |
| 成本 | 单任务成本、每小时总成本、缓存命中率 | 网关账本(Day 83) |
| 可靠性 | 模型调用错误率、降级率、熔断次数、工具错误率 | 网关和工具中心打点 |
| 安全 | 护栏触发率、被拒绝的工具调用、需要审批的次数 | 工具中心审计(Day 84) |

**小心标签基数(cardinality)。** Prometheus 这类指标系统里,每一种标签值组合都是一条独立的时间序列。租户 40 个、Agent 25 个、模型 6 个、结果 4 种,一个指标就是 24,000 条序列,还能接受。如果你顺手把 `user_id` 或 `run_id` 加成标签,序列数会变成几百万,指标系统会直接扛不住。规则是:**指标的标签只放取值有限的维度,高基数的东西(用户、运行、工单号)放在 trace 和日志里**。下面的代码里有一个算序列数的小函数,加标签之前先算一下。

## SLO 和燃烧速率告警

指标有了,下一步是告警。最常见的做法是固定阈值:「转人工率超过 10% 就报警」。这有两个问题:阈值定低了天天误报,大家很快就不看了;定高了真出事时报得太晚。而且它不区分「突然飙升」和「慢慢变差」这两种完全不同的情况。

Google SRE 的做法是先定 **SLO**(服务等级目标),再根据**错误预算的燃烧速率**告警。拿工单 Agent 举例:

- SLO:95% 的工单不需要转人工返工(这就是「好事件」的定义)。
- 错误预算:30 天里允许 5% 的工单出问题。
- 燃烧速率:当前错误率除以允许的错误率。燃烧速率为 1 表示刚好在 30 天末用完预算;为 14.4 表示照这个速度 2 天多就会用完。

SRE Workbook 第 5 章推荐的多窗口告警是:1 小时内燃烧速率超过 14.4(相当于 1 小时花掉月预算的 2%)且最近 5 分钟也超过,就呼人;6 小时内超过 6 且最近 30 分钟也超过,也呼人;3 天内超过 1 且最近 6 小时也超过,开工单慢慢查。长窗口防止一时的抖动造成误报,短窗口保证问题恢复后告警能及时消失,不会挂几个小时。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="燃烧速率告警示意:横轴时间,纵轴燃烧速率。一次突发故障让 1 小时和 5 分钟窗口同时超过 14.4 触发呼叫;另一段缓慢恶化只让 3 天窗口超过 1 触发工单">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <line x1="50" y1="210" x2="620" y2="210" stroke="var(--rule)"/>
  <line x1="50" y1="20" x2="50" y2="210" stroke="var(--rule)"/>
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">
    <text x="44" y="214" text-anchor="end">0</text>
    <text x="44" y="186" text-anchor="end">1</text>
    <text x="44" y="102" text-anchor="end">6</text>
    <text x="44" y="46" text-anchor="end">14.4</text>
    <text x="335" y="236" text-anchor="middle">时间</text>
  </g>
  <line x1="50" y1="182" x2="620" y2="182" stroke="var(--rule)" stroke-dasharray="3 3"/>
  <line x1="50" y1="98" x2="620" y2="98" stroke="var(--rule)" stroke-dasharray="3 3"/>
  <line x1="50" y1="42" x2="620" y2="42" stroke="var(--compute)" stroke-dasharray="3 3"/>
  <polyline fill="none" stroke="var(--mem)" stroke-width="2" points="50,196 90,195 120,194 140,30 170,26 190,190 230,195 280,194"/>
  <polyline fill="none" stroke="var(--compute)" stroke-width="2" points="300,194 360,188 420,180 480,174 540,170 600,166"/>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="128" y="10" width="150" height="20" rx="3" fill="var(--mem-wash)"/><text x="203" y="24" text-anchor="middle" fill="var(--ink)">突发:1h 和 5m 都超 14.4 呼人</text>
    <rect x="420" y="128" width="190" height="20" rx="3" fill="var(--compute-wash)"/><text x="515" y="142" text-anchor="middle" fill="var(--ink)">缓慢变差:3d 超 1 开工单</text>
  </g>
</svg>
<figcaption>同一个 SLO 下的两种故障。固定阈值很难同时处理好这两种情况,燃烧速率告警用不同窗口和不同严重级别分别处理:突发的立刻叫醒人,缓慢恶化的开工单在工作时间处理。</figcaption>
</figure>

写成 Prometheus 规则大概是这样(假设你有一个按结果打标签的计数器 `agentops_task_total`):

```yaml
# agent-60-lab/w13/obs/alerts.yaml
groups:
  - name: agentops-slo
    rules:
      - alert: AgentTaskSuccessFastBurn
        expr: |
          (
            sum by (tenant, agent) (rate(agentops_task_total{outcome!="success"}[1h]))
            / sum by (tenant, agent) (rate(agentops_task_total[1h]))
          ) / (1 - 0.95) > 14.4
          and
          (
            sum by (tenant, agent) (rate(agentops_task_total{outcome!="success"}[5m]))
            / sum by (tenant, agent) (rate(agentops_task_total[5m]))
          ) / (1 - 0.95) > 14.4
        labels: {severity: page}
        annotations:
          summary: "{{ $labels.tenant }}/{{ $labels.agent }} 1 小时内烧掉了 2% 以上的月度错误预算"
```

另外两条规则(6 小时 / 30 分钟、3 天 / 6 小时)照样写,只改窗口和阈值。

同样的逻辑我用 Python 写了一遍,方便你在没有 Prometheus 的情况下理解和测试,顺带加了成本异常检测和标签基数计算:

```python
# agent-60-lab/w13/obs/slo.py
from dataclasses import dataclass


@dataclass
class Window:
    good: int
    total: int

    @property
    def error_rate(self) -> float:
        return 0.0 if self.total == 0 else 1 - self.good / self.total


def burn_rate(w: Window, slo: float) -> float:
    """燃烧速率 = 实际错误率 / 允许的错误率。1 表示刚好在 30 天里把错误预算花完。"""
    return w.error_rate / (1 - slo)


# SRE Workbook 第 5 章推荐的多窗口组合:(长窗口, 短窗口, 阈值, 级别)
RULES = [
    ("1h", "5m", 14.4, "page"),     # 1 小时烧掉 2% 的月预算
    ("6h", "30m", 6.0, "page"),     # 6 小时烧掉 5%
    ("3d", "6h", 1.0, "ticket"),    # 3 天烧掉 10%
]


def evaluate(windows: dict[str, Window], slo: float) -> list[str]:
    """长短两个窗口都超阈值才报警:长窗口防误报,短窗口让恢复后告警及时消失。"""
    fired = []
    for long_w, short_w, threshold, severity in RULES:
        if (burn_rate(windows[long_w], slo) >= threshold
                and burn_rate(windows[short_w], slo) >= threshold):
            fired.append(f"{severity}: burn>={threshold} over {long_w}/{short_w}")
    return fired


def cost_anomaly(this_hour: float, same_hour_last_4_weeks: list[float], factor: float = 2.0,
                 floor_usd: float = 5.0) -> bool:
    """成本异常:比过去四周同一小时的中位数高 factor 倍,而且绝对值过了地板价才报。"""
    base = sorted(same_hour_last_4_weeks)[len(same_hour_last_4_weeks) // 2]
    return this_hour >= floor_usd and this_hour >= factor * max(base, 0.01)


def series_count(label_values: dict[str, int]) -> int:
    """一个指标会产生多少条时间序列:各标签取值个数相乘。"""
    n = 1
    for v in label_values.values():
        n *= v
    return n
```

```python
# agent-60-lab/w13/obs/test_slo.py
from slo import Window, burn_rate, cost_anomaly, evaluate, series_count

SLO = 0.95   # 「任务成功」的 SLO:95% 的工单不用转人工返工


def test_burn_rate_math():
    assert abs(burn_rate(Window(good=900, total=1000), SLO) - 2.0) < 1e-9   # 错 10%,允许 5%


def test_fast_burn_pages_only_when_short_window_agrees():
    # 1 小时错 80%、最近 5 分钟错 90%:两个窗口的燃烧速率都超过 14.4
    bad = {"1h": Window(200, 1000), "5m": Window(10, 100), "6h": Window(5000, 6000),
           "30m": Window(400, 500), "3d": Window(90000, 100000)}
    fired = evaluate(bad, SLO)
    assert any(f.startswith("page") for f in fired)
    recovered = dict(bad, **{"5m": Window(99, 100), "30m": Window(495, 500), "6h": Window(5950, 6000)})
    assert not any(f.startswith("page") for f in evaluate(recovered, SLO))


def test_cost_anomaly_and_cardinality():
    assert cost_anomaly(30.0, [8, 9, 10, 12])
    assert not cost_anomaly(3.0, [0.5, 0.5, 0.6, 0.4])         # 翻了好几倍,但没过地板价
    assert series_count({"tenant": 40, "agent": 25, "model": 6, "outcome": 4}) == 24000
```

运行 `uv run pytest -q w13/obs`,我本机是 `3 passed`。

**成本告警为什么不用燃烧速率。** 成本没有「好事件和坏事件」,更适合和历史比:这个小时的花费是过去四周同一个小时中位数的两倍以上,并且绝对值超过一个下限(防止深夜几毛钱的波动也报警),就报警。用「同一个小时」比较是因为 Agent 的流量有明显的日内和周内周期,周一上午十点和周日凌晨三点没有可比性。Day 87 会讲,成本暴涨是 Agent 事故里很常见的一类,通常是某个循环出了问题,早发现一小时就少烧一小时的钱。

**质量告警。** 线上评测分数的移动平均下降、用户点踩率上升,同样可以套燃烧速率的框架(把「评测分低于阈值」定义为坏事件)。这一类告警最容易漏掉,因为系统没有报错、延迟也正常,只是回答变差了,往往是模型供应商静默更新或者某次 prompt 改动引起的。

## 看板长什么样

一个平台级的看板,我的建议是分三层,从上往下越来越细:

- **第一屏:平台整体。** 今天的运行数、成功率、P95 延迟、总成本,各自和上周同期比;正在触发的告警;按租户的成本排行。值班的人打开看板,五秒钟要能回答「现在有没有事」。
- **第二屏:单个 Agent。** 选中一个 Agent,看它的成功率、转人工率、评测分、延迟分布、单任务成本的时间曲线,按 Agent 版本分开画,这样一次发布前后的变化一眼就能看出来。
- **第三屏:下钻。** 从曲线上点一个异常的时间点,跳到那段时间被采样下来的 trace 列表(带原文的那一路),再点进单个 trace。

最后这个「从指标跳到 trace」的能力很关键。Grafana 里叫 exemplars:在直方图指标上附带几个对应 trace 的 ID,点一下就过去。没有这个,看板和 trace 是两个孤岛,排查时要手动对时间、对租户。

还有一条:**平台自己也要有 SLO**。Day 82 说过,平台是所有 Agent 的依赖。模型网关的可用性、额外延迟,工具中心的可用性,trace 管道的数据延迟(从 span 产生到能查到要多久),都要有目标和告警,而且目标要比业务 Agent 的更严。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Q4E9GDAslIk" title="GenAI Observability: Keeping GenAI Honest Without Oversharing - Liudmila Molkova, Grafana Labs" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>CNCF · GenAI Observability: Keeping GenAI Honest Without Oversharing · 31 分钟。讲者 Liudmila Molkova 参与制定了 OTel 的 GenAI 语义约定,这个演讲正好讲今天的核心矛盾:要看得见,又不能把用户数据到处乱放。内容采集为什么默认关闭、该怎么开,这里讲得最清楚。</figcaption>
</figure>

## 动手练习

**第一步:估算你自己的数据量(30 分钟)。** 用 Day 34 接好的 Langfuse,导出 20 条真实 trace,算出每次运行的 span 数、元数据大小、原文大小。按「每天 10 万次运行、原文保留 30 天、元数据保留 180 天」算出存储总量。再算一遍按今天的采样规则(假设 3% 错误、2% 慢、4% 转人工、5% 基线,有重叠,合计约 12%)之后的量。

**第二步:跑通 Collector 两路管道(2 小时)。** 本机需要 Docker。用今天的 `otelcol.yaml`,把 Tempo 换成一个 `debug` 导出器方便观察(`exporters: {debug: {verbosity: detailed}}`),启动 `otel/opentelemetry-collector-contrib` 镜像。让你的工单 Agent 把 OTLP 发到 Collector。造几个场景:一次正常运行、一次工具抛异常、一次把 `agentops.escalated` 设成 true。在 debug 输出里确认:正常运行大多数不出现(只有 5% 的概率);异常和转人工的一定出现;metadata 那一路里没有 `gen_ai.input.messages`;带原文那一路里的手机号被遮掉了。

**第三步:让链路穿过网关(1 小时)。** 给 Day 83 的网关加上 FastAPI 和 httpx 的自动埋点,确认在后端看到的是一条完整的链:Agent 的根 span 下面挂着网关的 span。

**第四步:写告警规则(1 小时)。** 跑通 `w13/obs` 的 3 个测试。然后补全 `alerts.yaml` 的另外两条燃烧速率规则,加一条成本异常规则和一条网关自身可用性规则。

**验收标准:**

- 有一张数据量估算表,包括采样前后的对比。
- Collector 的 debug 输出能证明四件事:异常 trace 全留、正常 trace 按比例留、元数据路没有原文、原文路做了脱敏。
- 后端里能看到一条从 Agent 到网关的完整 trace。
- `alerts.yaml` 里有三条燃烧速率规则、一条成本规则、一条平台自身的规则,每条都写清楚了触发后谁处理。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| traceparent | W3C 定义的 HTTP 头,在服务之间传递 trace ID 和父 span ID |
| baggage | OTel 在服务间传递业务上下文(如租户、Agent 版本)的机制 |
| 头部采样 / 尾部采样 | 请求开始时就决定记不记 / 等整个 trace 结束后看完再决定 |
| OTel Collector | OpenTelemetry 的数据管道组件,负责接收、处理(采样、脱敏)、转发遥测数据 |
| forward 连接器 | Collector 里把一条管道的输出接到另一条管道输入的组件,用来一分为多 |
| 标签基数(cardinality) | 一个指标所有标签值组合的数量,决定时间序列的条数 |
| SLO | 服务等级目标,例如「95% 的工单不需要转人工返工」 |
| 错误预算 | SLO 允许的失败额度,例如 30 天内 5% |
| 燃烧速率(burn rate) | 实际错误率除以允许错误率,表示错误预算消耗的快慢 |
| exemplar | 附在指标数据点上的 trace ID,用于从指标直接跳到对应 trace |

## 常见误区

**全量记录,等出了问题再说。** 规模上去之后,存储和观测平台的费用会超过模型费用,而且查询变慢,真出事时反而用不上。按数据量估算提前设计采样。

**用头部随机采样控制量。** 头部采样在决定时不知道这次会不会出错,错误的运行大部分会被丢掉。Agent 场景用尾部采样,把错误、慢、转人工、低分、高成本的全部留下。

**原文和元数据一起保留一年。** 原文是存储大头,也是唯一有隐私风险的部分。原文短保留、严格权限,元数据长保留,分开两路处理。

**把 user_id、run_id 加成指标标签。** 时间序列数会爆炸,指标系统直接被拖垮。高基数的维度放 trace 和日志,指标只放有限取值的标签。

**固定阈值告警。** 定低了天天误报没人看,定高了报得太晚,还分不清突发和缓慢变差。基于 SLO 用多窗口燃烧速率告警。

**只盯错误率和延迟,没有质量告警。** Agent 最隐蔽的故障是「没报错但回答变差了」,要用线上评测分和用户反馈做告警。

## 学习资料

### 文档与文章

- [OpenTelemetry · GenAI 语义约定](https://opentelemetry.io/docs/specs/semconv/gen-ai/):官方文档入口;规范本身已经搬到独立仓库 [semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai),看 `docs/registry/attributes/gen-ai.md` 里内容类属性的采集建议,以及新增的 `gen_ai.evaluation.*` 评测属性。1 小时。
- [Tail Sampling Processor README](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/tailsamplingprocessor):所有策略类型和参数的权威说明,重点看 `decision_cache` 和 `sampling_strategy`。40 分钟。
- [OpenTelemetry 博客 · Tail Sampling](https://opentelemetry.io/blog/2022/tail-sampling/):为什么要尾部采样、部署上要注意什么(负载均衡层)。15 分钟。
- [Redaction Processor README](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/redactionprocessor):`allowed_keys` 的「默认拒绝」设计和 `blocked_values` 正则。20 分钟。
- [Google SRE Workbook · Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/):燃烧速率告警的出处,从最简单的阈值告警一步步推导到多窗口多燃烧速率,强烈建议完整读一遍。1 小时。
- [Google SRE Book · Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/):四个黄金信号和「告警要针对症状而不是原因」。40 分钟。
- [Langfuse · Sampling](https://langfuse.com/docs/observability/features/sampling):Langfuse SDK 层面的采样配置。10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1w3HrePENj&autoplay=0&high_quality=1" title="基于 Opentelemetry 的大模型应用可观测丨阿里云云原生研发工程师李艳红（彦鸿）发表主题演讲" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>阿里云云原生 · 基于 OpenTelemetry 的大模型应用可观测 · 18 分钟。阿里云工程师讲大模型应用的链路追踪怎么做、关注哪些指标,国内团队的视角,和今天的指标体系可以对照着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1NwNVemEyE&autoplay=0&high_quality=1" title="【IT老齐695】OpenTelemetry日志、指标、链路一站解决方案" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT老齐 · OpenTelemetry 日志、指标、链路一站解决方案 · 23 分钟。如果你对 OTel 的 Collector、管道、导出器这些概念还不熟,先看这个打底,再回来读今天的配置。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/JsCCrBF7F1g" title="LLM Observability, Evaluation, Experimentation Platform — Dat Ngo, Arize" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · LLM Observability, Evaluation, Experimentation Platform — Dat Ngo, Arize · 17 分钟。从可观测平台厂商的角度讲观测、评测、实验三者怎么打通,和今天「从指标跳到 trace、把评测分当告警信号」的思路一致。</figcaption>
</figure>

上面那个 Liudmila Molkova 的演讲也在这一组。

### 书籍

- Charity Majors、Liz Fong-Jones、George Miranda《Observability Engineering》(O'Reilly, 2022;2026 年 6 月出了第 2 版,章节号可能不同):第 1 版第 17 章「Cheap and Accurate Enough: Sampling」专讲采样,包括按内容采样和动态采样,直接对应今天的尾部采样。1.5 小时。
- 《SRE:Google 运维解密》(Site Reliability Engineering,O'Reilly 2016;中文版电子工业出版社):第 4 章服务质量目标、第 6 章分布式系统的监控。英文版在 sre.google 免费在线阅读。1.5 小时。

### 开源项目与代码

- [open-telemetry/opentelemetry-collector-contrib](https://github.com/open-telemetry/opentelemetry-collector-contrib):今天用到的 `tailsamplingprocessor`、`redactionprocessor`、`attributesprocessor` 都在这里,遇到配置问题直接看对应目录的 README 和测试用例。按需查阅。
- [open-telemetry/semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai):GenAI 和 MCP 的语义约定,`docs/gen-ai/mcp.md` 讲 MCP 调用的 span 怎么命名。30 分钟。

## 自测

1. 一个平台每天 50 万次运行,每次 40 个 span,元数据每 span 1 KB,原文每次运行 120 KB。原文保留 14 天、元数据保留 180 天,全量记录需要多少存储?如果尾部采样留下 10%,原文那一路省了多少?

<details><summary>答案</summary>

元数据:50 万 × 40 KB = 20 GB/天,180 天约 3.6 TB。原文:50 万 × 120 KB = 60 GB/天,14 天约 840 GB。合计约 4.4 TB。采样留 10% 之后(两路都在采样之后),原文降到约 84 GB,省了约 756 GB;元数据也降到约 360 GB。如果元数据想全量保留用于精确统计,可以只对原文那一路采样,元数据走另一条不采样的管道,或者干脆用指标代替。

</details>

2. 为什么 Agent 场景用尾部采样而不是头部采样?尾部采样在部署上有什么额外要求?

<details><summary>答案</summary>

头部采样在请求开始时就决定,那时不知道这次运行会不会出错、转人工或者特别贵,而这些正是最需要保留的 trace,按比例随机采样会丢掉大部分。尾部采样看完整个 trace 再决定。额外要求:Collector 要在内存里缓存进行中的 trace,需要按吞吐量设置 num_traces 等参数;同一个 trace 的所有 span 必须到达同一个采样实例,规模大时要在前面加按 trace ID 分发的负载均衡层;长时间运行的 trace 要用 decision_cache 处理晚到的 span,或者从设计上把长任务拆成多个 trace。

</details>

3. SLO 是 95% 的工单不需要返工。过去 1 小时有 12% 的工单返工,最近 5 分钟有 15%。燃烧速率是多少?会不会触发呼叫级告警?

<details><summary>答案</summary>

允许错误率 5%。1 小时燃烧速率 12% / 5% = 2.4,5 分钟 15% / 5% = 3。都远低于 14.4,不会触发 1 小时窗口的呼叫告警。要看 6 小时窗口:如果 6 小时平均也在 10% 以上(燃烧速率 2),也达不到 6。如果持续 3 天燃烧速率超过 1,会触发工单级告警。这说明问题存在但不紧急,工作时间处理即可。

</details>

4. 同事想在任务计数器上加一个 `customer_id` 标签,方便按客户看成功率。你怎么回应?

<details><summary>答案</summary>

不建议。客户数可能成千上万,每个客户和其他标签组合都会产生新的时间序列,序列数会爆炸,拖垮指标系统。按客户看成功率应该从 trace 或者结构化日志、数据仓库里查,或者只对少数重点客户单独打一个低基数的标签(比如客户等级)。原则是指标标签只放取值有限的维度。

</details>

5. 带原文的 trace 管道里,Collector 的 redaction 能不能保证没有个人信息泄露?还需要什么措施?

<details><summary>答案</summary>

不能。正则只能抓格式固定的东西(手机号、身份证号、银行卡号),地址、姓名、自由描述的病情等都抓不住。还需要:应用层先脱敏(Day 40);原文默认不采集,按租户审批开启;带原文的数据保留期短;后端按租户控制访问权限,看原文要有审计;Day 86 讲的数据分级和删除流程要覆盖 trace。

</details>

6. **资深面试题**:你负责的 Agent 平台每天 200 万次运行,观测费用已经是模型费用的 1.3 倍,老板让你一个月内降到 30% 以内,同时不能影响排查问题。你的方案是什么?

<details><summary>答案</summary>

先测量:按服务和属性拆开看数据量,通常原文占大头,重复的完整对话历史又是原文的大头。方案分四块。一是原文和元数据分离:原文默认不采,按租户开启;采了的只保留 14 天;元数据长期保留。二是尾部采样:错误、慢、转人工、低评测分、高成本、指定租户全留,其余 3–5% 基线,预计留下 10% 左右;部署负载均衡层保证同一 trace 落到同一采样实例,处理长任务的晚到 span。三是能用指标的不用 trace:看板和告警全部基于指标(从网关账本和运行结果打点),不再从 trace 里实时聚合。四是存储分层:近期热存储、历史冷存储。验证不影响排查:上线前回放过去一个月的 10 个真实事故,确认用采样后的数据都能定位根因;上线后跟踪排查时间这个指标。要提到风险和取舍:采样会让少量罕见问题的样本不足,用「指定租户临时全量」和动态调整采样率补;原文少了,线上评测要改成在线实时打分并把分数写进元数据,而不是事后从原文里重算。

</details>

## 明天预告

Day 86 讲**治理与合规**:企业客户买你的 Agent 之前会发来一份几十道题的安全问卷,国内面向公众的生成式 AI 服务要过备案或登记,生成的内容要按 2025 年 9 月起施行的办法加标识,调用海外模型还牵涉数据出境,欧盟的 AI Act 在 2026 年 7 月刚刚调整了时间表。明天把这些要求逐条翻译成技术方案:数据分级、保留期、删除请求怎么在所有存储里执行到底、审计留存多久,并动手实现一个覆盖全部存储的数据删除流程。
