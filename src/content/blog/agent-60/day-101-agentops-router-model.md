---
title: 'Day 101 · AgentOps(五):把微调小模型接进网关做级联路由'
description: 'Day 79 的级联路由写在 SupportPilot 自己的代码里,Day 81 训出了分诊小模型。今天把级联搬进 AgentOps 网关,变成任何租户都能用的 triage 路由:小模型先判,低置信度、高风险类别、输出解析失败、小模型挂了这四种情况回退大模型;上线前先跑 shadow 模式,用一致率决定什么时候切流量。'
pubDate: 2026-10-12
regime: none
tags: ['routing', 'cascade', 'vllm', 'lora', 'shadow-mode', 'agent-60']
series: 'agent-60'
day: 101
lang: 'zh'
---

## 今天要解决的问题

Day 79 写过一个分诊路由器:小模型先判,置信度不够再问大模型。那段代码住在 SupportPilot 里,是 SupportPilot 自己的事。Day 81 把小模型训练做成了流水线,产出一个挂在 vLLM 上的 LoRA 适配器 `triage-v1`,还有一份 `route.yaml`,写着阈值、高风险类别和 shadow 开关。

现在问题来了:公司里第二个团队也想用这个分诊模型,第三个团队想训自己的小模型做同样的级联。每个团队各写一份路由器,各自记日志,各自算回退率,这正是 Day 96 说的「每个团队各造一遍轮子」。今天把级联搬进网关:

1. 说清楚级联为什么应该是平台能力,而不是每个应用自己的代码;以及什么时候不该搬。
2. 在网关里加一个 `triage` 逻辑路由:小模型先判,五种决策结果(用小模型,或者因为四种原因之一回退大模型)全部可测、可记录。
3. 实现 shadow 模式:两个模型都调,线上用大模型的结果,小模型的判断只记录。写一份报告,用「小模型自认为很确定时和大模型的一致率」决定什么时候切流量。
4. 把自部署小模型的成本折算进网关的计费,让成本归因不因为「自己的卡不花钱」而失真。
5. 算一笔账:级联上线后分诊节点省多少钱,shadow 期间多花多少钱。

预计用时 4–6 小时。前置:Day 79(级联和置信度)、Day 81(分诊小模型流水线和 `route.yaml`)、Day 97(网关)、Day 100(评测平台)。今天的代码放在 Day 96 预留的 `src/agentops/router_model/` 里,测试照旧用假上游,不需要 GPU。

## 为什么要搬进网关,什么时候不该搬

放在应用里和放在网关里,代码几乎一样,区别在谁拥有它。

放在 SupportPilot 里,分诊模型的阈值、回退规则、日志格式都是 SupportPilot 团队的私事。模型团队在 Day 81 训出 v2,要等 SupportPilot 排期改配置;想看全公司分诊模型的回退率,要去每个用它的应用里各查一遍;想统一做 shadow 验证,每个应用都要自己实现一次「两个都调、只用一个」。

放在网关里,应用只需要把请求里的 `model` 从 `smart` 改成 `triage`。阈值由模型负责人在 `route.yaml` 里调,所有租户同时生效;每一次决策写进同一张表,一条 SQL 就能看全平台的回退率;shadow、灰度、回滚都在一个地方做。Day 96 的接口约定里,租户只认逻辑路由名,背后用什么模型由平台决定。级联路由是这条约定最自然的延伸:租户说「我要分诊」,平台决定是小模型分还是大模型分。

但不是所有级联都该搬。判断标准是:级联的决策逻辑是不是通用的。分诊这种「输出一个类别、用 logprobs 算置信度」的模式,换个小模型、换个类别集合还是同一套逻辑,值得平台化。如果某个应用的回退条件是「小模型说要退款、并且这个客户上个月投诉过两次」,这里面有业务知识,应该留在应用里,网关只提供 `fast` 和 `smart` 两个积木。平台吃进太多业务逻辑,最后会变成一个所有人都不敢改的大泥球。

还有一个命名问题。Day 96 的接口表里预留过 `auto` 这个路由名,本意是「平台自动选模型」。今天这个级联是专门给分诊用的,换成别的任务要换小模型、换阈值、换类别,所以叫 `triage` 更准确。`auto` 留给以后真正通用的难度路由,比如按问题复杂度在 fast 和 smart 之间选。名字起得太大,以后要么名不副实,要么改名的时候所有租户都要改代码。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="triage 级联路由的决策流程:小模型先判,四种情况回退大模型,shadow 模式两个都调">
<rect x="20" y="120" width="110" height="50" rx="8" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="75" y="142" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">租户请求</text>
<text x="75" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">model=triage</text>
<line x1="130" y1="145" x2="170" y2="145" stroke="var(--ink-faint)" stroke-width="1.5"/>
<rect x="170" y="110" width="140" height="70" rx="8" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="240" y="135" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">小模型 triage-v1</text>
<text x="240" y="153" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">vLLM + LoRA</text>
<text x="240" y="169" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">logprobs → 置信度</text>
<line x1="310" y1="145" x2="350" y2="145" stroke="var(--ink-faint)" stroke-width="1.5"/>
<rect x="350" y="20" width="270" height="56" rx="8" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="485" y="44" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">confident → 用小模型的结果</text>
<text x="485" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">解析成功 + 非高风险 + 置信度 ≥ 阈值</text>
<rect x="350" y="96" width="270" height="110" rx="8" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="485" y="118" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">回退 deepseek-v4-pro</text>
<text x="485" y="140" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">low_conf 置信度低于阈值</text>
<text x="485" y="157" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">always_big 退款、账单</text>
<text x="485" y="174" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">parse_error 输出不是合法 JSON</text>
<text x="485" y="191" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">small_down 小模型报错或超时</text>
<rect x="350" y="226" width="270" height="56" rx="8" fill="var(--paper-raised)" stroke="var(--rule)" stroke-dasharray="5 4"/>
<text x="485" y="250" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">shadow:两个都调,返回大模型</text>
<text x="485" y="268" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">小模型的判断只写进 route_decisions</text>
<line x1="330" y1="145" x2="350" y2="48" stroke="var(--ink-faint)" stroke-width="1.2"/>
<line x1="330" y1="145" x2="350" y2="150" stroke="var(--ink-faint)" stroke-width="1.2"/>
<line x1="330" y1="145" x2="350" y2="254" stroke="var(--ink-faint)" stroke-width="1.2" stroke-dasharray="4 3"/>
</svg>
<figcaption>小模型(琥珀色,自部署的外部服务)先判,结果落到一个成功分支或四个回退原因之一。虚线是 shadow 模式:上线第一周每个请求都调两次。</figcaption>
</figure>

## 置信度和策略

置信度的算法和 Day 79 完全一样:在小模型的输出里找到 `"category": "xxx"`,把 xxx 对应的那几个 token 的对数概率加起来取指数。我把它搬进平台包里,Day 81 的离线评测脚本也改成从这里导入。这一点比看起来重要:线上用一份置信度算法,离线扫阈值用另一份,两边哪怕只差一个正则,扫出来的阈值在线上就不成立了。

```python
# agentops/src/agentops/router_model/confidence.py
"""从 logprobs 算分诊置信度。和 Day 79 的 confidence.py 是同一份逻辑,搬进平台包里,
网关和 Day 81 的离线评测脚本共用,保证线上和离线算出来的是同一个数。"""
import json
import math
import re


def label_confidence(tokens: list[str], logprobs: list[float], field: str = "category") -> tuple[str | None, float]:
    """找到 "field": "xxx" 里 xxx 对应的那几个 token,把它们的对数概率相加再取 exp。"""
    text = "".join(tokens)
    m = re.search(rf'"{field}"\s*:\s*"([a-z_]+)"', text)
    if not m:
        return None, 0.0
    start, end = m.span(1)
    pos, total = 0, 0.0
    for tok, lp in zip(tokens, logprobs, strict=False):
        tok_start, tok_end = pos, pos + len(tok)
        if tok_end > start and tok_start < end:
            total += lp
        pos = tok_end
    return m.group(1), math.exp(total)


def parse_json(text: str) -> dict | None:
    s = text.strip()
    if s.startswith("`"):
        s = s.strip("`").removeprefix("json").strip()
    try:
        v = json.loads(s)
    except json.JSONDecodeError:
        return None
    return v if isinstance(v, dict) else None
```

策略从 Day 81 的 `route.yaml` 读。阈值、高风险类别、shadow 开关归模型负责人管,网关只读不写。小模型和回退模型是谁,以网关的路由表为准。两边各说一份,就要在启动时校验它们说的是同一个模型,对不上宁可起不来。这需要 `uv add pyyaml`。

```python
# agentops/src/agentops/router_model/policy.py
"""级联路由的配置。阈值、高风险类别、shadow 开关由模型负责人在 Day 81 的 route.yaml 里维护,
网关只读;小模型和回退模型是谁,以网关的路由表为准,启动时校验两边一致。"""
from dataclasses import dataclass, field
from pathlib import Path

import yaml


@dataclass(frozen=True)
class CascadePolicy:
    model: str                                    # 小模型名,必须等于路由表里第一个目标的 model
    threshold: float
    always_big: frozenset[str] = field(default_factory=frozenset)
    shadow_mode: bool = True                      # 默认 shadow:新模型先只记录不生效
    label_field: str = "category"


def load_policy(path: str | Path) -> CascadePolicy:
    raw = yaml.safe_load(Path(path).read_text())
    return CascadePolicy(model=raw["model"], threshold=float(raw["threshold"]),
                         always_big=frozenset(raw.get("always_big") or ()),
                         shadow_mode=bool(raw.get("shadow_mode", True)),
                         label_field=raw.get("label_field", "category"))
```

`shadow_mode` 默认是 `True`。新模型、新版本的默认状态就应该是「只记录不生效」,打开它需要有人主动改配置。反过来,忘了关 shadow 的代价是多花点钱,忘了开 shadow 的代价是一个没在真实流量上验证过的模型直接接管了线上。两种失误的代价不对称,默认值就该往安全的一边放。

## 级联本身

```python
# agentops/src/agentops/router_model/cascade.py
"""级联:小模型先判,四种情况回退大模型。shadow 模式下两个都调,返回大模型的结果,只记录小模型的判断。

  confident   小模型解析成功、类别不在高风险名单、置信度 ≥ 阈值  → 用小模型
  low_conf    置信度低于阈值                                    → 回退
  always_big  类别在高风险名单(退款、账单)                       → 回退,不管置信度多高
  parse_error 小模型输出不是合法 JSON 或找不到类别字段             → 回退
  small_down  小模型服务报错或超时                                → 回退(可用性优先)
"""
import asyncio
from dataclasses import dataclass

from agentops.gateway.providers import Provider, ProviderError
from agentops.gateway.routes import Target
from agentops.router_model.confidence import label_confidence, parse_json
from agentops.router_model.policy import CascadePolicy


@dataclass
class Attempt:
    role: str                    # small / big
    target: Target
    resp: dict | None
    error: ProviderError | None
    ms: int


@dataclass
class Decision:
    chosen: str                  # small / big
    reason: str
    small_label: str | None
    small_conf: float | None
    big_label: str | None
    attempts: list[Attempt]      # 每次上游调用,网关逐个记账

    @property
    def response(self) -> dict:
        return next(a.resp for a in self.attempts if a.role == self.chosen and a.resp is not None)


async def _call(role: str, prov: Provider, target: Target, body: dict) -> Attempt:
    loop = asyncio.get_running_loop()
    t0 = loop.time()
    try:
        resp = await prov.complete(target.model, body)
        return Attempt(role, target, resp, None, int((loop.time() - t0) * 1000))
    except ProviderError as e:
        return Attempt(role, target, None, e, int((loop.time() - t0) * 1000))


def _small_judgement(resp: dict, policy: CascadePolicy) -> tuple[str | None, float | None, bool]:
    """返回 (类别, 置信度, 解析是否成功)。"""
    choice = resp["choices"][0]
    content = ((choice.get("logprobs") or {}).get("content")) or []
    label, conf = label_confidence([c["token"] for c in content], [c["logprob"] for c in content],
                                   policy.label_field)
    parsed = parse_json(choice["message"].get("content") or "")
    ok = parsed is not None and label is not None and parsed.get(policy.label_field) == label
    return label, conf, ok


def _label_of(resp: dict | None, policy: CascadePolicy) -> str | None:
    if resp is None:
        return None
    parsed = parse_json(resp["choices"][0]["message"].get("content") or "")
    return parsed.get(policy.label_field) if parsed else None


async def run(policy: CascadePolicy, small: Target, big: Target, providers: dict[str, Provider], body: dict) -> Decision:
    small_body = {**body, "temperature": 0, "logprobs": True}      # 置信度依赖 logprobs,温度固定为 0
    if policy.shadow_mode:
        s, b = await asyncio.gather(_call("small", providers[small.provider], small, small_body),
                                    _call("big", providers[big.provider], big, body))
        label, conf, ok = _small_judgement(s.resp, policy) if s.resp else (None, None, False)
        reason = _reason(policy, s, label, conf, ok)
        if b.resp is None:
            raise b.error or ProviderError("fallback failed", retryable=False, status=502)
        return Decision("big", reason, label, conf, _label_of(b.resp, policy), [s, b])

    s = await _call("small", providers[small.provider], small, small_body)
    label, conf, ok = _small_judgement(s.resp, policy) if s.resp else (None, None, False)
    reason = _reason(policy, s, label, conf, ok)
    if reason == "confident":
        return Decision("small", reason, label, conf, None, [s])
    b = await _call("big", providers[big.provider], big, body)
    if b.resp is None:
        raise b.error or ProviderError("fallback failed", retryable=False, status=502)
    return Decision("big", reason, label, conf, _label_of(b.resp, policy), [s, b])


def _reason(policy: CascadePolicy, s: Attempt, label, conf, ok) -> str:
    if s.resp is None:
        return "small_down"
    if not ok:
        return "parse_error"
    if label in policy.always_big:
        return "always_big"
    if conf is None or conf < policy.threshold:
        return "low_conf"
    return "confident"
```

几个决定值得说。

**回退原因分五类,而且每一类都记下来。** Day 79 的路由器只区分「用了小模型」和「用了大模型」。放到平台上,你需要知道为什么回退:`low_conf` 多,说明阈值太高或者模型在某些类别上没学好;`parse_error` 多,说明输出格式不稳,可能是推理时的模板和训练时不一致(Day 81 排查线上准确率下降时讲过这个坑);`small_down` 多,说明 vLLM 那台机器有问题,该找运维而不是找模型团队。原因不同,该找的人完全不同。

**小模型挂了就回退,不报错。** 小模型是一个优化,不是一个依赖。它慢了或者挂了,用户应该感觉不到,只是这一单贵了一点。所以给 vLLM 的超时设得很短(配置里默认 3 秒,分类请求正常应该几百毫秒内返回),超时就当它挂了。如果把小模型的失败直接报给租户,你就是把一个省钱的手段变成了一个新的故障点。

**高风险类别不看置信度。** 退款和账单分错的代价比分诊费高几个数量级,这两类一律交给大模型。这条规则来自 Day 81 的 `route.yaml`,注意它判断的是小模型给出的类别:小模型把一张退款工单分成了 invoice,而且很确定,这条规则就拦不住它。这是这套设计的一个已知漏洞,下面报告里专门有一个指标盯着它。

**请求小模型时强制 `temperature=0` 和 `logprobs=True`。** 置信度依赖 logprobs,温度不为零时同一张工单两次的结果可能不同,置信度也就没有意义。网关替调用方加上这两个参数,不依赖每个租户自己记得传。

**shadow 模式下两个模型并发调。** 用 `asyncio.gather` 同时发出去,延迟取两者里慢的那个,大约就是大模型的延迟,和不开 shadow 时回退到大模型一样。串行调的话,shadow 期间每个请求都多出一个小模型的延迟,租户会感觉到。

## 接进网关

改动分四处。路由表加一行,`triage` 的第一个目标是小模型,第二个是回退模型。免费档不开放这个路由:

```python
# agentops/src/agentops/gateway/routes.py(ROUTES 和 TIER_ROUTES 各改一处)
    # Day 101 级联路由:第一个是自部署的小模型,第二个是回退模型。阈值等策略在 route.yaml 里
    "triage": [Target("vllm", "triage-v1"), Target("deepseek", "deepseek-v4-pro")],
}

TIER_ROUTES = {"free": {"fast"}, "standard": {"fast", "smart", "triage"}, "enterprise": {"fast", "smart", "triage"}}
```

`providers_for` 里注册 vLLM,超时单独配:

```python
# agentops/src/agentops/gateway/app.py(providers_for 的字典里加一项)
            # Day 101 自部署的分诊小模型。超时设短:小模型慢了不如直接回退
            "vllm": OpenAICompatProvider("vllm", s.vllm_base_url, s.vllm_api_key, s.vllm_timeout_s),
```

```python
# agentops/src/agentops/config.py(Settings 里加四行)
    vllm_base_url: str = "http://127.0.0.1:8001/v1"
    vllm_api_key: str = ""
    vllm_timeout_s: float = 3.0
    triage_policy_path: str = "models/triage-router/config/route.yaml"
```

`chat_completions` 里,限流和预算检查之后、按顺序尝试上游之前,级联路由走自己的分支。这样 Day 97 的鉴权、路由权限、限流、预算,以及 Day 103 的按钱熔断,对 `triage` 一样生效:

```python
# agentops/src/agentops/gateway/app.py(chat_completions 里,providers = providers_for(request) 之后)
    if route in cascade_route.CASCADES:                         # Day 101
        return await cascade_route.handle(request, ctx, route, body, feature, trace_id, providers)
```

最后在 `db.py` 里加一张决策表,每一次级联决策一行:

```python
# agentops/src/agentops/db.py(make_engine 之前)
# Day 101 级联路由的每一次决策,shadow 模式下的一致率、回退率都从这张表算
route_decisions = Table(
    "route_decisions", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("tenant_id", String(40), nullable=False, index=True),
    Column("route", String(60), nullable=False),          # triage
    Column("feature", String(60), nullable=False),
    Column("small_label", String(60)),                    # 小模型给的类别,解析失败为空
    Column("small_conf", Float),
    Column("big_label", String(60)),                      # 只有调了大模型才有
    Column("chosen", String(10), nullable=False),         # small / big
    Column("reason", String(40), nullable=False),         # confident / low_conf / always_big / parse_error / small_down
    Column("shadow", Boolean, nullable=False),
    Column("trace_id", String(64)),
    Column("ts", DateTime(timezone=True), server_default=func.now(), index=True),
)
```

处理函数把这些串起来:跑级联,每一次上游调用都记账(shadow 期间小模型那次也算钱,回退时小模型失败的那次记 `upstream_error`),写一条决策,响应头里告诉调用方这次是谁答的、为什么:

```python
# agentops/src/agentops/router_model/route.py
"""网关里的级联路由入口。chat_completions 发现逻辑路由名在 CASCADES 里,就交给这里处理。"""
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import insert

from agentops.db import route_decisions
from agentops.gateway import ledger
from agentops.gateway.pricing import cost_cny
from agentops.gateway.providers import Provider, ProviderError
from agentops.gateway.routes import ROUTES
from agentops.router_model import cascade
from agentops.router_model.policy import CascadePolicy, load_policy
from agentops.tenancy.keys import TenantContext

CASCADES = {"triage"}        # 哪些逻辑路由走级联;值以 ROUTES 里的 [小模型, 回退模型] 为目标


def policies_for(request: Request) -> dict[str, CascadePolicy]:
    app = request.app
    if "cascades" in app.state.overrides:
        return app.state.overrides["cascades"]
    if not hasattr(app.state, "cascades"):
        pol = load_policy(app.state.settings.triage_policy_path)
        small = ROUTES["triage"][0]
        if pol.model != small.model:   # route.yaml 和路由表说的不是同一个模型,宁可起不来
            raise RuntimeError(f"route.yaml model {pol.model!r} != ROUTES['triage'][0] {small.model!r}")
        app.state.cascades = {"triage": pol}
    return app.state.cascades


def _usage(resp: dict) -> tuple[int, int, int]:
    u = resp.get("usage") or {}
    return (int(u.get("prompt_tokens", 0)), int((u.get("prompt_tokens_details") or {}).get("cached_tokens", 0)),
            int(u.get("completion_tokens", 0)))


async def handle(request: Request, ctx: TenantContext, route: str, body: dict, feature: str,
                 trace_id: str, providers: dict[str, Provider]) -> JSONResponse:
    policy = policies_for(request)[route]
    small, big = ROUTES[route][0], ROUTES[route][1]
    engine = request.app.state.engine
    try:
        d = await cascade.run(policy, small, big, providers, body)
    except ProviderError as e:
        raise HTTPException(e.status or 502, f"cascade failed: {e}") from e

    total = 0.0
    for a in d.attempts:                     # 每一次上游调用都记账,shadow 模式下小模型那次也要算钱
        if a.resp is None:
            ledger.record(engine, tenant_id=ctx.tenant_id, feature=feature, route=route, provider=a.target.provider,
                          model=a.target.model, prompt_tokens=0, cached_tokens=0, completion_tokens=0, cost_cny=0.0,
                          latency_ms=a.ms, status="upstream_error", trace_id=trace_id)
            continue
        pt, cached, ct = _usage(a.resp)
        cost = cost_cny(a.target.provider, a.target.model, pt, cached, ct)
        total += cost
        ledger.record(engine, tenant_id=ctx.tenant_id, feature=feature, route=route, provider=a.target.provider,
                      model=a.target.model, prompt_tokens=pt, cached_tokens=cached, completion_tokens=ct,
                      cost_cny=cost, latency_ms=a.ms, status="ok" if a.role == d.chosen else "shadow_or_fallback",
                      trace_id=trace_id)
    with engine.begin() as c:
        c.execute(insert(route_decisions).values(
            tenant_id=ctx.tenant_id, route=route, feature=feature, small_label=d.small_label,
            small_conf=d.small_conf, big_label=d.big_label, chosen=d.chosen, reason=d.reason,
            shadow=policy.shadow_mode, trace_id=trace_id))
    chosen = next(a for a in d.attempts if a.role == d.chosen)
    return JSONResponse(d.response, headers={
        "X-AgentOps-Cost-CNY": f"{total:.6f}", "X-AgentOps-Provider": chosen.target.provider,
        "X-AgentOps-Model": chosen.target.model, "X-AgentOps-Route-Decision": f"{d.chosen}:{d.reason}",
        "X-Trace-Id": trace_id})
```

`X-AgentOps-Route-Decision` 这个响应头是给租户排查问题用的。客服说「这张工单分错了」,租户在 trace 里看到 `small:confident`,就知道是小模型很确定地分错了,该去找模型团队;看到 `big:parse_error`,就知道小模型输出坏了、大模型分错了,两件事要分别处理。

SupportPilot 这边的改动反而最小:Day 47 分诊节点里调 Day 79 `triage()` 的地方,换回普通的 `chat.completions.create(model="triage", ...)`,`agentops-lab/w12/router.py` 可以删了。应用代码变少,是平台化做对了的一个信号。

## 测试:五种决策加 shadow

测试用一个假的分诊模型,能指定它返回什么类别、置信度多少、输出是否损坏、是否宕机。为了顺便验证置信度算法,假模型故意把类别名切成两个 token 返回。

```python
# agentops/tests/test_router_model.py
import json
import math
from dataclasses import dataclass, field

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from agentops.config import Settings
from agentops.db import route_decisions, usage
from agentops.gateway.providers import ProviderError
from agentops.main import create_app
from agentops.router_model.confidence import label_confidence
from agentops.router_model.policy import CascadePolicy
from tests.conftest import PEPPER


@dataclass
class FakeTriageModel:
    """假的分诊模型。small=True 时返回 logprobs,类别那几个 token 的概率乘起来等于 conf。"""
    name: str
    label: str = "invoice"
    conf: float = 0.97
    small: bool = True
    broken_output: bool = False
    down: bool = False
    calls: list[dict] = field(default_factory=list)

    async def complete(self, model: str, body: dict) -> dict:
        self.calls.append(body)
        if self.down:
            raise ProviderError(f"{self.name}: timeout", retryable=True)
        text = "抱歉我不太确定" if self.broken_output else json.dumps({"category": self.label, "needs_human": False})
        choice = {"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": text}}
        if self.small:
            half = len(self.label) // 2           # 故意把类别名切成两个 token,验证按字符区间累加
            tokens = ['{"', "category", '": "', self.label[:half], self.label[half:], '", "needs_human": false}']
            each = math.log(self.conf) / 2
            lps = [0.0, 0.0, 0.0, each, each, 0.0]
            if self.broken_output:
                tokens, lps = [text], [-0.1]
            choice["logprobs"] = {"content": [{"token": t, "logprob": lp} for t, lp in zip(tokens, lps)]}
        return {"id": "x", "object": "chat.completion", "model": model, "choices": [choice],
                "usage": {"prompt_tokens": 300, "completion_tokens": 20}}


POLICY = CascadePolicy(model="triage-v1", threshold=0.9, always_big=frozenset({"refund", "billing"}),
                       shadow_mode=False)


def make(engine, small, big, policy=POLICY):
    app = create_app(Settings(key_pepper=PEPPER), engine=engine,
                     providers={"vllm": small, "deepseek": big}, cascades={"triage": policy})
    return TestClient(app)


def ask(client, key):
    return client.post("/v1/chat/completions", headers={"Authorization": f"Bearer {key}", "X-AgentOps-Feature": "ticket.triage"},
                       json={"model": "triage", "messages": [{"role": "user", "content": "发票抬头开错了"}]})


def decisions(engine):
    with engine.connect() as c:
        return [dict(r) for r in c.execute(select(route_decisions)).mappings()]


def usage_rows(engine):
    with engine.connect() as c:
        return [dict(r) for r in c.execute(select(usage.c.provider, usage.c.status, usage.c.cost_cny)).mappings()]


def test_confidence_spans_split_tokens():
    label, conf = label_confidence(['{"', "category", '": "', "inv", "oice", '"}'], [0, 0, 0, -0.05, -0.05, 0])
    assert label == "invoice" and abs(conf - math.exp(-0.1)) < 1e-9


def test_confident_small_model_wins(engine, keys):
    small, big = FakeTriageModel("vllm"), FakeTriageModel("deepseek", small=False)
    r = ask(make(engine, small, big), keys["cloudledger"])
    assert r.status_code == 200 and r.headers["X-AgentOps-Route-Decision"] == "small:confident"
    assert len(big.calls) == 0
    assert small.calls[0]["logprobs"] is True and small.calls[0]["temperature"] == 0
    assert [u["provider"] for u in usage_rows(engine)] == ["vllm"]


@pytest.mark.parametrize("small_kwargs,reason", [
    ({"conf": 0.6}, "low_conf"),
    ({"label": "refund", "conf": 0.99}, "always_big"),
    ({"broken_output": True}, "parse_error"),
    ({"down": True}, "small_down"),
])
def test_falls_back_to_big(engine, keys, small_kwargs, reason):
    small = FakeTriageModel("vllm", **small_kwargs)
    big = FakeTriageModel("deepseek", label="invoice", small=False)
    r = ask(make(engine, small, big), keys["cloudledger"])
    assert r.status_code == 200
    assert r.headers["X-AgentOps-Route-Decision"] == f"big:{reason}"
    assert r.headers["X-AgentOps-Provider"] == "deepseek"
    d = decisions(engine)[0]
    assert d["chosen"] == "big" and d["reason"] == reason and d["big_label"] == "invoice"
    assert len(usage_rows(engine)) == 2            # 小模型那次也记账,失败的记 upstream_error


def test_shadow_mode_returns_big_but_records_small(engine, keys):
    small = FakeTriageModel("vllm", label="bug", conf=0.95)
    big = FakeTriageModel("deepseek", label="invoice", small=False)
    policy = CascadePolicy(model="triage-v1", threshold=0.9, shadow_mode=True)
    r = ask(make(engine, small, big, policy), keys["cloudledger"])
    assert json.loads(r.json()["choices"][0]["message"]["content"])["category"] == "invoice"
    d = decisions(engine)[0]
    assert (d["chosen"], d["reason"], d["shadow"]) == ("big", "confident", True)
    assert (d["small_label"], d["big_label"]) == ("bug", "invoice")   # 这一条就是一次「不一致」
    assert len(small.calls) == 1 and len(big.calls) == 1


def test_free_tier_cannot_use_triage(engine, keys):
    r = ask(make(engine, FakeTriageModel("vllm"), FakeTriageModel("deepseek", small=False)), keys["acme"])
    assert r.status_code == 403


def test_report_agreement(engine):
    from sqlalchemy import insert

    from agentops.router_model.report import summarize
    rows = ([dict(small_label="invoice", big_label="invoice", reason="confident")] * 8
            + [dict(small_label="bug", big_label="invoice", reason="confident")]
            + [dict(small_label="refund", big_label="refund", reason="always_big")]
            + [dict(small_label="account", big_label="bug", reason="low_conf")])
    with engine.begin() as c:
        c.execute(insert(route_decisions), [dict(tenant_id="t_cloudledger", route="triage", feature="f",
                                                 small_conf=0.9, chosen="big", shadow=True, **r) for r in rows])
    s = summarize(engine, "t_cloudledger")
    assert s["decisions"] == 11 and s["agreement"] == round(9 / 11, 3)
    assert s["agreement_when_confident"] == round(8 / 9, 3)
    assert s["per_class"]["invoice"] == "8/9" and s["per_class"]["bug"] == "0/1"
```

```bash
uv run pytest -q
```

我本机连同前面几天的测试一共 28 条,全部通过。新加的 9 条覆盖了:切开的 token 能正确累加置信度;置信度够时只调小模型,而且网关替调用方加上了 `logprobs` 和 `temperature=0`;四种回退原因各自触发,决策表和响应头都对;shadow 模式返回大模型的结果、两个模型各调一次、小模型的判断被记下;免费档用不了 `triage`;以及下一节报告的计算。

## shadow 期间看什么:报告

shadow 模式跑一周,拿什么决定能不能切流量?写一个报告,从决策表里算:

```python
# agentops/src/agentops/router_model/report.py
"""级联路由的周报:shadow 期间看一致率,上线后看小模型接住的比例和回退原因。

  uv run python -m agentops.router_model.report t_cloudledger 7
"""
import sys
from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.engine import Engine

from agentops.db import route_decisions


def summarize(engine: Engine, tenant_id: str, days: int = 7, now: datetime | None = None) -> dict:
    since = (now or datetime.now(UTC)) - timedelta(days=days)
    with engine.connect() as c:
        rows = c.execute(select(route_decisions).where(route_decisions.c.tenant_id == tenant_id,
                                                       route_decisions.c.ts >= since)).mappings().all()
    n = len(rows)
    reasons = Counter(r["reason"] for r in rows)
    # 一致率只在两边都有类别时才有意义:shadow 期间全部是,上线后只有回退的那部分是
    both = [r for r in rows if r["small_label"] and r["big_label"]]
    per_class: dict[str, list[int]] = defaultdict(lambda: [0, 0])     # 按大模型的类别分组:[一致, 总数]
    for r in both:
        per_class[r["big_label"]][1] += 1
        per_class[r["big_label"]][0] += int(r["small_label"] == r["big_label"])
    confident = [r for r in both if r["reason"] == "confident"]
    return {
        "decisions": n,
        "small_share": round(reasons["confident"] / n, 3) if n else None,       # 上线后小模型接住的比例
        "reasons": dict(reasons),
        "agreement": round(sum(r["small_label"] == r["big_label"] for r in both) / len(both), 3) if both else None,
        # 最重要的一个数:小模型自己说「我很确定」的那些,和大模型一致的比例。上线后这部分不会再有人复核
        "agreement_when_confident": (round(sum(r["small_label"] == r["big_label"] for r in confident)
                                           / len(confident), 3) if confident else None),
        "per_class": {k: f"{a}/{t}" for k, (a, t) in sorted(per_class.items())},
    }


if __name__ == "__main__":
    from agentops.config import get_settings
    from agentops.db import make_engine
    print(summarize(make_engine(get_settings().database_url), sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 7))
```

报告里有好几个数,但决定能不能切流量的只有一个:**`agreement_when_confident`,小模型自认为很确定的那些单子里,它和大模型一致的比例**。原因是切流量之后,小模型「很确定」的单子就直接用它的结果,再也不会有大模型复核。小模型不确定的那些反正会回退,它们的一致率高低不影响线上质量。所以总体一致率是个参考,这个条件一致率才是上线标准。Day 81 模型卡里留空的那个「一致率 ≥ ____% 才切流量」,填的就应该是它。

`per_class` 按大模型给的类别分组看一致率,用来发现上面说的那个漏洞:如果 refund 这一组里出现小模型很确定地分成了别的类别,`always_big` 规则就拦不住,要么把这类样本补进训练集,要么在阈值之外再加一条规则(比如正文里出现「退款」「扣款」就强制回退)。

还要注意 shadow 期间的一致率不等于准确率。大模型也会错,两个模型一起错的时候算「一致」。所以每周还要抽一些样本人工看,特别是两者不一致的那些,判断到底谁对。Day 30 的错误分析方法在这里原样适用。

切流量也不是一步到位。可以先按租户切:内部测试租户先关 shadow,观察一周回退率和人工改判率,再切 SupportPilot。回滚很简单,`route.yaml` 里把 `shadow_mode` 改回 `true`,或者把阈值改成 1.01,所有请求都会回退到大模型。改配置就能回滚,不用发布代码,这是把策略放进配置文件的回报。

## 自部署模型的成本怎么记

Day 97 的价格表查不到价格就报错。vLLM 上的小模型没有账单,如果在价格表里填 0,成本看板上分诊节点会突然变得几乎免费,级联省了多少钱就算不清了,也没人会去关那台闲着的 GPU。

折算方法是:每百万 token 的价格 = 卡的小时价 ÷(每小时实际处理的 token 数 ÷ 一百万)。「实际处理」要乘上利用率,因为卡是按小时付钱的,不管有没有请求。举个例子(都是假设的数字,你要用 Day 76 压测出的吞吐和自己的账单替换):一张卡每小时 8 元,分类请求以输入为主、vLLM 的预填充很快,满载每秒能处理约 2 万个 token,白天平均利用率按 30% 算,每小时实际处理 2 万 × 3600 × 0.3 ≈ 2160 万个 token,折合每百万 token 约 0.37 元。价格表里我先填了 0.5,留点余量:

```python
# agentops/src/agentops/gateway/pricing.py(PRICES 里加一行)
    # 自部署模型没有账单,按「卡的小时价 ÷ 每小时实际处理的 token 数」折算,算法见 Day 101。示例数字
    ("vllm", "triage-v1"): Price(input=0.5, cached_input=0.5, output=0.5),
```

这个价格要每个月对一次账:实际 GPU 账单除以 `usage` 表里 vllm 那几行的 token 总数,和价格表里的数差太多就改。利用率是最容易高估的那个数,夜里没流量,卡照样在计费。

## 算一笔账

拿一次分诊调用算:输入 300 个 token,输出 20 个。价格用 Day 97 价格表里的数(deepseek-v4-pro 输入每百万 9 元、输出 27 元,小模型按 0.5 元)。

- 只用大模型:300 × 9 ÷ 1e6 + 20 × 27 ÷ 1e6 = 0.0027 + 0.00054 ≈ 0.00324 元。
- 只用小模型:320 × 0.5 ÷ 1e6 ≈ 0.00016 元,是大模型的二十分之一。
- 级联,假设八成被小模型接住:0.8 × 0.00016 + 0.2 ×(0.00016 + 0.00324)= 0.000128 + 0.00068 ≈ 0.00081 元,比只用大模型省约 75%。回退的那两成要付两次钱,这一点不能忘。
- shadow 期间:每次都调两个,0.00016 + 0.00324 = 0.0034 元,比只用大模型还贵约 5%。shadow 一周的代价就是这 5%,换来的是在真实流量上验证过的上线依据。

每天两万张工单,分诊节点一个月的差别是:只用大模型约 0.00324 × 20000 × 30 ≈ 1944 元,级联约 486 元。省下的一千四百多块,够不够付那张卡的钱?按上面每小时 8 元,一个月二十四小时开着是 5760 元。

这就是 Day 81 成本对比表要回答的问题,而在这组假设下答案是:单靠分诊这一个节点,自部署小模型不划算。要么让这张卡同时服务更多节点或更多租户(这正是平台化的价值,一张卡分摊到全公司),要么用按需计费、能缩到零的推理服务,要么承认这一期先不自部署,用 `deepseek-flash` 当小模型。最后这个选项的代码一行都不用改,把路由表里 `triage` 的第一个目标换成 `Target("deepseek", "deepseek-flash")` 就行,只是置信度要从 DeepSeek 返回的 logprobs 里算,上线前确认它支持并且校准过。

资深工程师和中级工程师在这里的区别,是愿不愿意在把小模型训出来、接进网关之后,还老老实实算这笔账,并且接受「这一期不该上」这个结论。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1u6h1zrEWu&autoplay=0&high_quality=1" title="【VLLM本地部署大模型】30分钟手把手带你使用VLLM本地部署企业级DeepSeek模型" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>LLM大模型应用开发 · 【VLLM本地部署大模型】30分钟手把手带你使用VLLM本地部署企业级DeepSeek模型 · 34 分钟。部署流程和 OpenAI 兼容接口那部分是今天接网关的前提,配合 Day 76 看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/GhXQKz5WKSA" title="RouteLLM achieves 90% GPT4o Quality AND 80% CHEAPER" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Matthew Berman · RouteLLM achieves 90% GPT4o Quality AND 80% CHEAPER · 9 分钟。讲 RouteLLM 这篇论文的结论,和今天的级联是同一个思路的通用版。标题里的数字是论文在它的基准上的结果,别直接当成你的预期。</figcaption>
</figure>

## 动手练习

**目标**:AgentOps 网关有一个可用的 `triage` 级联路由,先跑 shadow,有报告,有成本对比,能按配置回滚。

1. `uv add pyyaml`,在 `src/agentops/router_model/` 下写 `confidence.py`、`policy.py`、`cascade.py`、`route.py`、`report.py`,按「接进网关」一节改路由表、`providers_for`、`config.py`、`db.py` 和 `chat_completions`。
2. 写 `tests/test_router_model.py`,全部测试跑通。
3. 把 Day 81 离线评测脚本里的置信度计算改成 `from agentops.router_model.confidence import label_confidence`,确认扫阈值的结果和改之前一样。
4. 有 GPU 的话,按 Day 81 的 `make serve` 起 vLLM,把 `vllm_base_url` 指过去,用 SupportPilot 跑 50 张工单,确认决策表里有数据、响应头正确。没有 GPU 的话,把路由表里小模型换成 `deepseek-flash` 跑同样的流程。
5. shadow 跑一段时间(练习时可以用评测集回放代替真实流量),出一份报告,填下面的表,写出「切还是不切」的结论和理由。
6. 演练一次回滚:把阈值改成 1.01,确认所有请求都变成 `big:low_conf`。

**验收标准**:

- 测试全过;四种回退原因和 shadow 各有一条测试覆盖。
- 决策表里能查到每一次决策的原因;响应头里有 `X-AgentOps-Route-Decision`。
- 报告里有 `agreement_when_confident` 和按类别的一致率,上线结论引用的是它而不是总体一致率。
- 成本对比用的是你自己的吞吐、利用率和账单,并且明确回答了「这张卡值不值」。

记录表:

| 项目 | 数值 |
| --- | --- |
| shadow 期间决策数 | |
| 总体一致率 | |
| 小模型确定时的一致率(上线标准) | |
| 一致率最低的类别和数值 | |
| 回退原因分布(low_conf / always_big / parse_error / small_down) | |
| 每百万 token 折算价(元)和依据 | |
| 分诊节点月成本:只用大模型 / 级联 / shadow | |
| 结论:切 / 不切 / 换方案,理由一句话 | |

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 级联路由 | cascade,先用便宜的模型,不够确定再用贵的模型 |
| 逻辑路由 | 租户请求里写的路由名(fast、smart、triage),背后用什么模型由平台决定 |
| 置信度 | 这里指小模型给出那个类别的概率,由类别 token 的对数概率相加取指数得到 |
| logprobs | 模型返回的每个输出 token 的对数概率,vLLM 和不少兼容接口都支持 |
| 校准 | 置信度和实际正确率是否对得上,置信度 0.9 的那批预测应该大约九成是对的 |
| shadow 模式 | 新模型和旧模型同时跑,线上只用旧模型的结果,新模型的输出只记录用于评估 |
| 一致率 | 两个模型给出相同结果的比例,不等于准确率,两个都错也算一致 |
| 条件一致率 | 只在小模型自认为确定的样本里算一致率,是级联上线的关键指标 |
| 折算价 | 自部署模型没有账单,按卡的小时价和实际吞吐折算出来的每百万 token 价格 |
| 利用率 | 卡实际在处理请求的时间比例,夜里没流量时卡照样计费 |

## 常见误区

**线上和离线各有一份置信度算法。** 离线扫出来的阈值只对离线那份算法成立。共用一份代码。

**小模型挂了就报错。** 小模型是优化不是依赖,挂了应该静默回退,只是这一单贵一点。

**用总体一致率决定上线。** 切流量后,小模型确定的那些单子不再有人复核,看的应该是这部分的一致率。

**把一致率当准确率。** 两个模型一起错也算一致。不一致的样本要抽查,判断谁对。

**自部署模型在价格表里填 0。** 成本看板会失真,级联省了多少钱算不清,闲置的 GPU 也没人管。按吞吐和利用率折算,每月对账。

**shadow 默认关闭。** 新模型默认就该只记录不生效,打开要有人主动改配置。两种失误代价不对称,默认值往安全的一边放。

**把业务规则也搬进网关。** 网关只放通用的级联逻辑,和具体业务相关的回退条件留在应用里,否则平台会变成谁都不敢改的大泥球。

**训出来了就一定要上。** 按自己的数字算完,单个节点撑不起一张卡的钱是常有的事。结论可以是「这一期不上」。

## 学习资料

### 文档与文章

- [vLLM:LoRA Adapters](https://docs.vllm.ai/en/latest/features/lora.html):`--enable-lora` 和 `--lora-modules` 的用法,一个基座挂多个适配器时请求里怎么指定。
- [vLLM:OpenAI-Compatible Server](https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html):确认 `logprobs` 参数在你那个版本的行为。
- [RouteLLM: Learning to Route LLMs with Preference Data(arXiv 2406.18665)](https://arxiv.org/abs/2406.18665):用偏好数据训练路由器,读摘要和实验部分,看他们怎么定义「质量和成本的取舍曲线」。
- [FrugalGPT(arXiv 2305.05176)](https://arxiv.org/abs/2305.05176):级联调用多个模型降本的早期论文,读讲 LLM cascade 的那一节。
- [Martin Fowler:Dark Launching](https://martinfowler.com/bliki/DarkLaunching.html):shadow 模式在软件发布里的老名字,5 分钟。
- [LiteLLM:Routing](https://docs.litellm.ai/docs/routing):开源网关怎么做路由和回退,和我们自己写的对照着看取舍。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1N5LtzrEWX&autoplay=0&high_quality=1" title="越大越聪明?小模型正悄悄改变世界" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>知安局 · 越大越聪明?小模型正悄悄改变世界 · 6 分钟。科普向,讲小模型在特定任务上的位置,适合拿来想清楚「哪些节点值得交给小模型」。</figcaption>
</figure>

### 其他经典视频

- Trelis Research「Serve Multiple LoRA Adapters on a Single GPU」(YouTube,57 分钟):一张卡上挂多个 LoRA 适配器,对应上面「一张卡分摊给多个节点和租户」的方案,看前半小时。

### 书籍

- Chip Huyen,《AI Engineering》,O'Reilly,2025。读第 10 章(AI Engineering Architecture and User Feedback)里讲模型路由器和网关的部分,和今天的设计几乎一一对应;第 9 章(Inference Optimization)讲推理成本。没查证到中文版,以英文原版为准。

### 开源项目与代码

- [lm-sys/RouteLLM](https://github.com/lm-sys/RouteLLM):论文的开源实现,几种路由器的代码都在里面。
- [BerriAI/litellm](https://github.com/BerriAI/litellm):开源模型网关,看它的回退和路由配置怎么设计。

## 自测

1. 为什么把级联放进网关?举一个不该放进网关的级联例子。

<details><summary>答案</summary>

放进网关后,阈值和模型版本由模型负责人统一管理,所有租户同时生效;每次决策写进同一张表,全平台的回退率一条 SQL 就能看到;shadow、灰度、回滚都在一处做,应用代码也变少。不该放进去的是带业务知识的回退条件,比如「小模型判成退款,并且这个客户上个月投诉过两次就交给大模型」,这需要应用自己的数据和规则,放进网关会让平台吃进业务逻辑。

</details>

2. 小模型服务超时了,网关应该怎么做?为什么?

<details><summary>答案</summary>

静默回退到大模型,决策原因记 `small_down`,这一次上游失败记一行 `upstream_error`。小模型是降本手段,不是功能依赖,它挂了用户不该感知到,只是这一单成本变高。如果把超时直接报给租户,就把一个优化变成了新的故障点。超时要设得短,分类请求正常几百毫秒返回,等它十几秒还不如直接问大模型。

</details>

3. shadow 一周,总体一致率 92%,小模型确定时的一致率 97%,refund 类一致率 70%。能切流量吗?

<details><summary>答案</summary>

要看上线标准是不是按条件一致率定的。97% 如果达到了模型卡里的门槛,整体上可以考虑切,但 refund 类的 70% 必须先查清楚:refund 本来在 `always_big` 里,一致率低说明有大量工单被小模型分成了别的类别,而且其中有一部分小模型还很确定,这些会绕过高风险规则直接用小模型的结果。切之前要么补这类训练数据重训,要么加一条和小模型无关的强制回退规则(比如正文出现退款相关的词),然后再看一周。

</details>

4. 自部署小模型的价格表里为什么不能填 0?每百万 token 的折算价怎么算?

<details><summary>答案</summary>

填 0 会让成本归因失真,看板上分诊节点几乎免费,级联省了多少算不清,闲置的 GPU 也没人管。折算价等于卡的小时价除以每小时实际处理的 token 数(以百万为单位),实际处理量 = 满载吞吐 × 3600 × 利用率。利用率最容易高估,夜里没流量卡也在计费。每个月用真实账单除以 usage 表里自部署模型的 token 总数对一次账。

</details>

5. 级联上线后,八成请求被小模型接住,成本却只降了 75% 而不是 80% 以上。为什么?

<details><summary>答案</summary>

回退的两成请求要付两次钱:先问小模型、再问大模型。小模型那次虽然便宜,但不是零。另外接住的八成也不是免费,要付小模型的折算价。所以级联的成本 = 小模型占比 × 小模型价格 + 回退占比 ×(小模型价格 + 大模型价格),一定高于「只算回退部分的大模型价格」。

</details>

6. **资深面试题**:你的团队花了三周训了一个分诊小模型,离线准确率和大模型只差两个点,接进网关的代码也写好了。你算完账发现,单靠这个节点省的钱不够付 GPU。你会怎么向团队和老板汇报?

<details><summary>答案</summary>

先说结论:这一期不建议按原方案上线自部署,并给出数字。分诊节点每月省多少、GPU 每月多少、差多少,写清楚吞吐和利用率的来源。然后说明三周的投入没有白费:训练流水线、评测、置信度和级联代码、shadow 机制都已经在平台上,是可复用的资产。接着给出几个替代方案和各自的条件:让同一张卡服务更多节点或租户,需要哪些团队接入、接入后分摊下来是否划算;换按需计费、能缩到零的推理服务,成本模型怎么变;先用便宜的托管模型当级联里的小模型,代码只改路由表一行,今天就能拿到大部分收益。最后给出建议的下一步和决策点,比如「先上托管小模型的级联拿收益,等有两个以上节点要用自研模型时再评估自部署」。汇报的关键是用数据把「不上」讲成一个负责任的工程决定,同时让团队的工作产生可见的价值。

</details>

## 明天预告

Day 102 · AgentOps(六):全链路可观测与成本看板。今天给决策表、usage 表里又加了不少数据,明天把它们和 OpenTelemetry 的 trace 串起来:一个工单从 SupportPilot 进来,经过网关、级联、工具中心、运行时,每一步在同一条 trace 里;再用这些数据搭成本看板和告警,包括今天说的回退率、shadow 一致率和 GPU 折算成本对账。
