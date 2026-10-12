---
title: 'Day 97 · AgentOps(一):模型网关与多租户'
description: '所有团队调大模型都走这一个入口。今天写出 OpenAI 兼容的 /v1/chat/completions:逻辑路由、按租户的令牌桶限流、月度预算、主供应商挂了自动切备用,每一次上游调用都按租户和功能记账。全程用假上游测试,一分钱不花。'
pubDate: 2026-10-12
regime: none
tags: ['agentops', 'llm-gateway', 'rate-limit', 'fallback', 'cost-attribution', 'agent-60']
series: 'agent-60'
day: 97
lang: 'zh'
---

## 今天要解决的问题

Day 96 定好了网关的接口:租户用平台签发的 key,调 OpenAI 兼容的 `POST /v1/chat/completions`,`model` 填 fast 或 smart,请求头报功能名。今天把它做出来。写完以后,你应该能:

1. 讲清楚一个请求在网关里依次经过哪几道关,每一道为什么放在这个位置。
2. 实现按租户的令牌桶限流,并解释为什么一个租户被限流不能影响别的租户。
3. 实现主备供应商的故障切换,分清哪些错误该换供应商重试、哪些错误该直接还给租户。
4. 让每一次上游调用(包括失败的)都按租户、功能、供应商、模型记账,能按功能查出钱花在哪。
5. 用 10 个不联网的测试证明以上行为。

预计用时 5 到 6 小时。前置:Day 96 的仓库骨架;Day 38 的成本算式;Day 83 讲过网关职责和 LiteLLM、Portkey 的对比,今天是动手版。

## 一个请求在网关里走过的路

先看全貌。下面这张图是网关处理一次请求的顺序,顺序本身就是设计:越便宜、越能早拒绝的检查放越前面。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="网关请求处理顺序:鉴权、路由权限、限流、预算、按顺序尝试上游、记账、返回">
  <g font-family="var(--font-mono)" font-size="12">
    <rect x="10" y="30" width="86" height="54" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="53" y="54" text-anchor="middle" fill="var(--ink)">鉴权</text>
    <text x="53" y="72" text-anchor="middle" font-size="11" fill="var(--ink-soft)">401 / 403</text>
    <rect x="114" y="30" width="86" height="54" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="157" y="54" text-anchor="middle" fill="var(--ink)">路由权限</text>
    <text x="157" y="72" text-anchor="middle" font-size="11" fill="var(--ink-soft)">400 / 403</text>
    <rect x="218" y="30" width="86" height="54" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="261" y="54" text-anchor="middle" fill="var(--ink)">限流</text>
    <text x="261" y="72" text-anchor="middle" font-size="11" fill="var(--ink-soft)">429</text>
    <rect x="322" y="30" width="86" height="54" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="365" y="54" text-anchor="middle" fill="var(--ink)">预算</text>
    <text x="365" y="72" text-anchor="middle" font-size="11" fill="var(--ink-soft)">402</text>
    <rect x="426" y="22" width="200" height="120" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="526" y="44" text-anchor="middle" fill="var(--ink)">按顺序尝试上游</text>
    <rect x="440" y="56" width="172" height="30" rx="4" fill="var(--paper-raised)" stroke="var(--mem)"/>
    <text x="526" y="76" text-anchor="middle" font-size="11" fill="var(--ink)">deepseek / flash</text>
    <rect x="440" y="98" width="172" height="30" rx="4" fill="var(--paper-raised)" stroke="var(--rule)" stroke-dasharray="4 3"/>
    <text x="526" y="118" text-anchor="middle" font-size="11" fill="var(--ink-soft)">qwen / flash(备用)</text>
    <line x1="96" y1="57" x2="114" y2="57" stroke="var(--ink-faint)"/>
    <line x1="200" y1="57" x2="218" y2="57" stroke="var(--ink-faint)"/>
    <line x1="304" y1="57" x2="322" y2="57" stroke="var(--ink-faint)"/>
    <line x1="408" y1="57" x2="426" y2="57" stroke="var(--ink-faint)"/>
    <path d="M 612 71 C 630 80, 630 104, 612 113" fill="none" stroke="var(--mem)"/>
    <text x="634" y="96" font-size="10" fill="var(--mem)" text-anchor="end">5xx</text>
    <rect x="426" y="180" width="200" height="56" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="526" y="204" text-anchor="middle" fill="var(--ink)">记账 usage</text>
    <text x="526" y="222" text-anchor="middle" font-size="11" fill="var(--ink-soft)">每次尝试一行,失败也记</text>
    <line x1="526" y1="142" x2="526" y2="180" stroke="var(--compute)"/>
    <rect x="218" y="180" width="190" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="313" y="204" text-anchor="middle" fill="var(--ink)">返回</text>
    <text x="313" y="222" text-anchor="middle" font-size="11" fill="var(--ink-soft)">响应头带成本和供应商</text>
    <line x1="426" y1="208" x2="408" y2="208" stroke="var(--ink-faint)"/>
    <text x="10" y="270" font-size="11" fill="var(--ink-faint)">越便宜、越能早拒绝的检查越靠前:鉴权读一行库,限流只读内存,预算要聚合查询,上游要花钱</text>
  </g>
</svg>
<figcaption>前四道关任何一道拒绝,请求都不会碰上游,也就不花钱。上游这一段只在可重试的错误上换供应商。</figcaption>
</figure>

为什么限流在预算前面?限流只碰内存里的一个桶,预算要对 `usage` 表做一次求和,前者便宜得多。一个陷入死循环的 Agent 每秒打几十次请求,让它在限流这一关就被挡掉,数据库不用陪它一起受罪。为什么鉴权在最前面?因为不知道是谁,后面所有按租户的判断都无从谈起,而且未鉴权的流量不应该消耗任何有成本的资源。

## 价格表和计费

网关能做成本归因,前提是它知道每个模型多少钱。价格表放在代码里,和路由表放在一起维护:

```python
# agentops/src/agentops/gateway/pricing.py
"""价格表:元 / 百万 token。DeepSeek 是 2026-10 官方页的高峰价(见 Day 3);通义一行是示例数字,上线前按官方价格页改。"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Price:
    input: float          # 未命中缓存的输入
    cached_input: float   # 命中缓存的输入
    output: float


PRICES: dict[tuple[str, str], Price] = {
    ("deepseek", "deepseek-flash"): Price(input=2.0, cached_input=0.04, output=8.0),
    ("deepseek", "deepseek-v4-pro"): Price(input=9.0, cached_input=0.30, output=27.0),
    ("qwen", "qwen-flash"): Price(input=0.3, cached_input=0.06, output=3.0),   # 示例数字,以官方为准
    ("qwen", "qwen-plus"): Price(input=0.8, cached_input=0.16, output=8.0),    # 示例数字,以官方为准
}


def cost_cny(provider: str, model: str, prompt_tokens: int, cached_tokens: int, completion_tokens: int) -> float:
    p = PRICES.get((provider, model))
    if p is None:
        # 宁可报错也不要按 0 元记账:没价格的模型上线,成本归因就是错的
        raise KeyError(f"no price for {provider}/{model}")
    miss = max(prompt_tokens - cached_tokens, 0)
    return (miss * p.input + cached_tokens * p.cached_input + completion_tokens * p.output) / 1_000_000
```

DeepSeek 两行用的是 Day 3 查到的 2026 年 10 月官方高峰价(元每百万 token,命中缓存的输入、未命中的输入、输出分开计)。通义那两行我标了示例数字,你上线前一定要去百炼的模型和价格页改成真实价格。

有一个设计选择值得说:查不到价格时我选择抛异常,而不是按 0 元记账。你可能觉得这太严格,万一新加了一个模型忘了加价格,整个网关调用就失败了。我的理由是,按 0 元记账的错误是静默的,会持续好几周没人发现,直到财务对账时发现平台统计的成本比账单少了三成,那时候已经没法追溯哪些调用用的是哪个模型。抛异常的错误是响亮的,加模型的那个人当场就会发现。资深工程师在「静默地错」和「响亮地失败」之间,通常选后者。

缓存命中的计费要注意:DeepSeek 返回的 `prompt_tokens` 包含命中缓存的部分,`prompt_tokens_details.cached_tokens` 是其中命中的数量,所以未命中的部分要相减。不同供应商的字段名不一样(有的叫 `prompt_cache_hit_tokens`),接新供应商时这里是最容易算错钱的地方,一定要拿真实响应核对一次。

## 供应商:一个类接所有 OpenAI 兼容接口

DeepSeek、阿里百炼、自部署的 vLLM 都提供 OpenAI 兼容接口,所以一个 `OpenAICompatProvider` 就够用。重点在错误分类:

```python
# agentops/src/agentops/gateway/providers.py
"""上游供应商。只要实现 complete(),网关就能用它;测试里用 FakeProvider,不走网络。"""
from dataclasses import dataclass, field
from typing import Protocol

import httpx


class ProviderError(Exception):
    def __init__(self, message: str, *, retryable: bool, status: int | None = None):
        super().__init__(message)
        self.retryable = retryable   # 能不能换下一个供应商再试
        self.status = status


class Provider(Protocol):
    name: str

    async def complete(self, model: str, body: dict) -> dict: ...


@dataclass
class OpenAICompatProvider:
    """DeepSeek、通义百炼、自部署 vLLM 都提供 OpenAI 兼容接口,一个类就够。"""
    name: str
    base_url: str
    api_key: str
    timeout_s: float = 30.0
    _client: httpx.AsyncClient | None = field(default=None, repr=False)

    async def complete(self, model: str, body: dict) -> dict:
        if self._client is None:
            # 自部署的 vLLM 可以不要 key;没 key 就不发这个头,别拼出一个非法的 "Bearer "
            headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
            self._client = httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout_s, headers=headers)
        try:
            r = await self._client.post("/chat/completions", json={**body, "model": model})
        except (httpx.LocalProtocolError, httpx.UnsupportedProtocol, httpx.InvalidURL) as e:
            # 请求还没发出去就在本地失败了:是我们的配置写错了(URL、请求头),换一家上游也没用
            raise ProviderError(f"{self.name}: bad upstream config ({type(e).__name__}), "
                                f"check base_url / api_key", retryable=False, status=500) from e
        except (httpx.TimeoutException, httpx.TransportError) as e:
            raise ProviderError(f"{self.name}: {type(e).__name__}", retryable=True) from e
        if r.status_code >= 500 or r.status_code == 429:
            raise ProviderError(f"{self.name}: HTTP {r.status_code}", retryable=True, status=r.status_code)
        if r.status_code >= 400:
            # 4xx 多半是请求本身有问题(参数错、内容被拒),换供应商也没用,直接还给租户
            raise ProviderError(f"{self.name}: HTTP {r.status_code} {r.text[:200]}", retryable=False,
                                status=r.status_code)
        return r.json()


@dataclass
class FakeProvider:
    """测试用。fail_times 次之后才成功;usage 固定,方便断言成本。"""
    name: str
    fail_times: int = 0
    fail_status: int = 503
    prompt_tokens: int = 1000
    cached_tokens: int = 0
    completion_tokens: int = 200
    calls: list[str] = field(default_factory=list)

    async def complete(self, model: str, body: dict) -> dict:
        self.calls.append(model)
        if len(self.calls) <= self.fail_times:
            raise ProviderError(f"{self.name}: HTTP {self.fail_status}", retryable=self.fail_status >= 500,
                                status=self.fail_status)
        return {
            "id": f"fake-{len(self.calls)}", "object": "chat.completion", "model": model,
            "choices": [{"index": 0, "finish_reason": "stop",
                         "message": {"role": "assistant", "content": f"[{self.name}/{model}] ok"}}],
            "usage": {"prompt_tokens": self.prompt_tokens, "completion_tokens": self.completion_tokens,
                      "prompt_tokens_details": {"cached_tokens": self.cached_tokens}},
        }
```

`retryable` 这个标记决定了故障切换的行为,它的判断规则是:

- **超时、连接失败、5xx**:是上游自己的问题,换一家很可能就好了,可以切换。
- **429**:上游限流。这一条有争议。如果是你在这家供应商的总额度被打满了,换一家是对的;但如果你的请求本身就太多,换一家只是把问题转移过去。我这里选择切换,同时在 `usage` 表里记下,Day 102 的看板会监控 429 的比例,比例异常时告警,让人判断是要扩额度还是要排查哪个租户在刷。
- **其他 4xx**:请求本身有问题,比如参数不对、内容被安全审核拦截、上下文超长。换一家大概率还是同样的错误,还白白多花一次时间。直接还给租户,让调用方修自己的请求。
- **请求在本地就失败了**:`LocalProtocolError`、`UnsupportedProtocol`、`InvalidURL`。这三个都是请求还没发出去,httpx 在我们自己这边就拒绝了,原因几乎总是配置写错:base_url 少了 `https://`,或者 key 是空的、拼出了一个非法的 `Authorization: Bearer ` 头。换一家不会好,反而会把真正的原因藏起来,所以不切换,返回 500 并在错误信息里直接说「检查 base_url / api_key」。

这条规则看起来简单,但很多自己写重试的代码都在这里出错:对所有错误一律重试三次,结果一个参数错误的请求在三家供应商各失败一次,租户等了十几秒才拿到一个本来一秒就能告诉他的 400。

最后那一条要单独说一下,因为它很容易被「传输层错误都可以重试」这条直觉盖过去。`LocalProtocolError` 在 httpx 里是 `TransportError` 的子类,如果只按父类判断,一个漏配了 key 的部署会这样出事:deepseek 本地拼头失败,切到 qwen,qwen 的 key 也是空的,又失败,最后网关回一个 `502 all upstreams failed`。值班的人看到 502,第一反应是供应商挂了,去翻供应商的状态页,半小时后才发现是自己少配了一个环境变量。所以判断顺序是先挑出本地错误,再处理其余的传输错误。另外,没有 key 的时候干脆不发 `Authorization` 头,Day 101 接内网 vLLM 时用得上,它本来就可以不要 key。

`FakeProvider` 是测试的主角。它可以配置前几次失败、失败的状态码、返回的 token 数,这样故障切换和计费都能精确断言。

## 路由表

```python
# agentops/src/agentops/gateway/routes.py
"""逻辑路由表:租户只认 fast / smart,背后是按顺序尝试的(供应商, 模型)列表。改这张表 = 全平台换模型。"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Target:
    provider: str
    model: str


ROUTES: dict[str, list[Target]] = {
    "fast": [Target("deepseek", "deepseek-flash"), Target("qwen", "qwen-flash")],
    "smart": [Target("deepseek", "deepseek-v4-pro"), Target("qwen", "qwen-plus")],
}

# 各档位默认能用的路由;tenants.allowed_models 非空时以它为准
TIER_ROUTES = {"free": {"fast"}, "standard": {"fast", "smart"}, "enterprise": {"fast", "smart"}}


def allowed_routes(tier: str, override: tuple[str, ...]) -> set[str]:
    return set(override) if override else TIER_ROUTES.get(tier, set())
```

路由表就是 Day 96 说的「改一行,全平台换模型」的那一行。每个逻辑名后面是一个有序列表,第一个是主选,后面是备用。

有两个细节要讲清楚。第一,备用模型和主选模型不是同一个模型,能力和输出风格都有差异。故障切换保证了可用性,但可能悄悄降低质量。所以 Day 100 的评测平台要能按 provider 维度拆分评测结果,Day 102 的看板要显示 fallback 的比例。如果 fallback 比例长期很高,说明主选不稳定,该换主选了。

第二,档位控制可用路由。免费档只能用 fast,这既是成本控制,也是一种产品设计:smart 路由贵十倍,应该让有预算的团队用。`tenants.allowed_models` 非空时覆盖档位默认,用于给某个租户单独开放或收紧。

## 令牌桶限流

```python
# agentops/src/agentops/gateway/ratelimit.py
"""按租户的令牌桶。单进程版本;多副本部署时换成 Redis 实现,接口不变。"""
import threading
import time
from dataclasses import dataclass


@dataclass
class _Bucket:
    tokens: float
    updated: float


class RateLimiter:
    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._buckets: dict[str, _Bucket] = {}
        self._lock = threading.Lock()

    def allow(self, key: str, per_minute: int, burst: int | None = None) -> tuple[bool, float]:
        """返回 (是否放行, 建议多少秒后重试)。桶容量默认等于每分钟配额,允许短时突发。"""
        cap = float(burst or per_minute)
        rate = per_minute / 60.0                       # 每秒回填多少个
        now = self._clock()
        with self._lock:
            b = self._buckets.get(key)
            if b is None:
                b = self._buckets[key] = _Bucket(tokens=cap, updated=now)
            b.tokens = min(cap, b.tokens + (now - b.updated) * rate)
            b.updated = now
            if b.tokens >= 1:
                b.tokens -= 1
                return True, 0.0
            return False, (1 - b.tokens) / rate
```

令牌桶的原理一句话就能说清:桶里最多装 `cap` 个令牌,每秒补充 `rate` 个,每个请求拿走一个,桶空了就拒绝。它比「每分钟最多 N 次」的固定窗口计数好在两点:一是没有窗口边界的突刺问题(固定窗口下,一个租户可以在第 59 秒和第 61 秒各打满一次配额,两秒内打出两倍流量);二是天然允许短时突发,桶满的时候可以一下子打出 `cap` 个请求,这对 Agent 很重要,因为 Agent 的调用本来就是突发的,一张工单处理时连续调五六次模型,然后安静一会儿。

返回值里的「建议多少秒后重试」会放进响应头 `Retry-After`。这个细节是给租户的 SDK 用的,openai SDK 收到 429 时会读这个头决定退避多久。

这是单进程版本。网关多副本部署时,每个副本各有一个桶,一个租户实际能拿到的配额会变成副本数乘以配额。生产上要换成 Redis 实现(用 Lua 脚本保证读改写的原子性),接口不变,这一点写进设计文档的风险里。Day 104 压测会专门验证多副本下的行为。

## 记账和预算

```python
# agentops/src/agentops/gateway/ledger.py
"""记账与预算。每一次上游尝试都记一行,失败的也记。"""
from datetime import UTC, datetime

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func, insert, select
from sqlalchemy.engine import Engine

from agentops.db import usage


def record(engine: Engine, **row) -> None:
    with engine.begin() as c:
        c.execute(insert(usage).values(**row))


def month_spend(engine: Engine, tenant_id: str, now: datetime | None = None) -> float:
    now = now or datetime.now(UTC)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    with engine.connect() as c:
        v = c.execute(select(func.coalesce(func.sum(usage.c.cost_cny), 0.0))
                      .where(usage.c.tenant_id == tenant_id, usage.c.ts >= start)).scalar_one()
    return float(v)


# 网关的路由是 async def,同步的 SQLAlchemy 调用不能直接写在里面,否则一次慢查询会卡住整个事件循环。
# 这两个包装把它们丢进线程池;同步版本留着,脚本和测试里直接用。
async def record_async(engine: Engine, **row) -> None:
    await run_in_threadpool(record, engine, **row)


async def month_spend_async(engine: Engine, tenant_id: str) -> float:
    return await run_in_threadpool(month_spend, engine, tenant_id)


def spend_by_feature(engine: Engine, tenant_id: str) -> list[dict]:
    with engine.connect() as c:
        rows = c.execute(
            select(usage.c.feature, func.count().label("calls"), func.sum(usage.c.cost_cny).label("cost_cny"))
            .where(usage.c.tenant_id == tenant_id).group_by(usage.c.feature).order_by(func.sum(usage.c.cost_cny).desc())
        ).mappings().all()
    return [dict(r) for r in rows]
```

`month_spend` 每个请求都查一次,在流量大的时候会是瓶颈。第一期这样写是为了正确性优先,验收指标里网关额外延迟 P95 30 毫秒的预算,一次带索引的聚合查询在万行级数据上完全够用。规模上去之后有两个改法:一是在内存里缓存每个租户的本月累计,每次记账时增量更新,定期和数据库对账;二是只对快接近预算的租户做精确检查。不要第一天就上缓存,等压测数据说明它是瓶颈再改。

预算检查是「软上限」:检查的是请求开始时的累计花费,所以最后一个请求可能让总花费超过预算一点点。测试里专门覆盖了这个行为(第二次请求放行,花费从 4 元涨到 8 元,超过了 5 元的预算,第三次才被拒)。要做成严格上限,需要在请求前预扣一个最大可能花费(按 `max_tokens` 估算),请求结束后多退少补,复杂度高很多。对内部平台来说,软上限加告警是合理的取舍,写进文档,让评审人知道你是有意为之。

`spend_by_feature` 是给财务和 Day 102 看板用的:一条 SQL 就能回答「SupportPilot 本月的钱主要花在哪个节点」。

## 把它们串起来

```python
# agentops/src/agentops/gateway/app.py
"""POST /v1/chat/completions:鉴权 → 路由权限 → 限流 → 预算 → 按顺序尝试上游 → 记账 → 返回。"""
import logging
import time
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from agentops.config import Settings
from agentops.deps import tenant
from agentops.gateway import ledger
from agentops.gateway.pricing import cost_cny
from agentops.gateway.providers import OpenAICompatProvider, Provider, ProviderError
from agentops.gateway.ratelimit import RateLimiter
from agentops.gateway.routes import ROUTES, allowed_routes
from agentops.tenancy.keys import TenantContext

log = logging.getLogger(__name__)
router = APIRouter()
MAX_BODY_CHARS = 400_000          # 约 10 万汉字,超过直接拒,别让一个请求吃掉网关内存


def build_providers(s: Settings) -> dict[str, Provider]:
    """按配置构造上游。必须有 key 的供应商缺了 key,就不注册它,并打一行说清楚缺的是哪个环境变量。
    第二项是 key 对应的环境变量名;写 None 表示这家可以不要 key(比如内网自部署的 vLLM)。"""
    candidates: dict[str, tuple[OpenAICompatProvider, str | None]] = {
        "deepseek": (OpenAICompatProvider("deepseek", s.deepseek_base_url, s.deepseek_api_key, s.upstream_timeout_s),
                     "AGENTOPS_DEEPSEEK_API_KEY"),
        "qwen": (OpenAICompatProvider("qwen", s.qwen_base_url, s.qwen_api_key, s.upstream_timeout_s),
                 "AGENTOPS_QWEN_API_KEY"),
    }
    providers: dict[str, Provider] = {}
    for name, (prov, key_env) in candidates.items():
        if key_env and not prov.api_key:
            log.warning("upstream %s disabled: %s is not set", name, key_env)
            continue
        providers[name] = prov
    return providers


def init_gateway(app) -> None:
    """create_app 里调用一次:启动时就把上游构造好,缺配置的在启动日志里就能看到。"""
    ov = app.state.overrides
    app.state.providers = ov["providers"] if "providers" in ov else build_providers(app.state.settings)


def providers_for(request: Request) -> dict[str, Provider]:
    return request.app.state.providers


def limiter_for(request: Request) -> RateLimiter:
    if not hasattr(request.app.state, "limiter"):
        request.app.state.limiter = request.app.state.overrides.get("limiter", RateLimiter())
    return request.app.state.limiter


@router.post("/v1/chat/completions")
async def chat_completions(request: Request, ctx: TenantContext = Depends(tenant("gateway")),
                           feature: str = Header(default="unknown", alias="X-AgentOps-Feature")):
    body = await request.json()
    if body.get("stream"):
        raise HTTPException(400, "stream=true is not supported yet; see Day 102")   # 第一期不做流式,写进非目标
    if len(str(body.get("messages", ""))) > MAX_BODY_CHARS:
        raise HTTPException(413, "messages too large")

    route = body.get("model", "")
    if route not in ROUTES:
        raise HTTPException(400, f"unknown route '{route}', use one of {sorted(ROUTES)}")
    if route not in allowed_routes(ctx.tier, ctx.allowed_models):
        raise HTTPException(403, f"route '{route}' not allowed for tier '{ctx.tier}'")

    ok, retry_after = limiter_for(request).allow(ctx.tenant_id, ctx.rpm_limit)
    if not ok:
        return JSONResponse({"error": "rate limited"}, status_code=429,
                            headers={"Retry-After": f"{retry_after:.1f}"})

    engine = request.app.state.engine
    if await ledger.month_spend_async(engine, ctx.tenant_id) >= ctx.monthly_budget_cny:
        raise HTTPException(402, "monthly budget exhausted")

    trace_id = request.headers.get("X-Trace-Id") or uuid.uuid4().hex
    providers = providers_for(request)
    if not any(t.provider in providers for t in ROUTES[route]):
        # 这条路由背后一个能用的上游都没有,多半是部署漏配了 key。说清楚,别让人以为是供应商挂了
        raise HTTPException(503, f"route '{route}' has no configured upstream; check the AGENTOPS_*_API_KEY settings")
    last_err: ProviderError | None = None
    for i, target in enumerate(ROUTES[route]):
        prov = providers.get(target.provider)
        if prov is None:
            continue
        t0 = time.perf_counter()
        try:
            resp = await prov.complete(target.model, body)
        except ProviderError as e:
            await ledger.record_async(engine, tenant_id=ctx.tenant_id, feature=feature, route=route, provider=target.provider,
                          model=target.model, prompt_tokens=0, cached_tokens=0, completion_tokens=0, cost_cny=0.0,
                          latency_ms=int((time.perf_counter() - t0) * 1000), status="upstream_error",
                          trace_id=trace_id)
            last_err = e
            if not e.retryable:
                raise HTTPException(e.status or 502, str(e)) from e
            continue
        u = resp.get("usage") or {}
        pt, ct = int(u.get("prompt_tokens", 0)), int(u.get("completion_tokens", 0))
        cached = int((u.get("prompt_tokens_details") or {}).get("cached_tokens", 0))
        cost = cost_cny(target.provider, target.model, pt, cached, ct)
        await ledger.record_async(engine, tenant_id=ctx.tenant_id, feature=feature, route=route, provider=target.provider,
                      model=target.model, prompt_tokens=pt, cached_tokens=cached, completion_tokens=ct, cost_cny=cost,
                      latency_ms=int((time.perf_counter() - t0) * 1000), status="ok" if i == 0 else "fallback_ok",
                      trace_id=trace_id)
        return JSONResponse(resp, headers={"X-AgentOps-Cost-CNY": f"{cost:.6f}", "X-AgentOps-Provider": target.provider,
                                           "X-AgentOps-Model": target.model, "X-Trace-Id": trace_id})
    raise HTTPException(502, f"all upstreams failed: {last_err}")
```

逐段看几个决定:

**流式暂时不支持。** 第一期直接拒绝 `stream=true`,在设计文档的非目标里写明。流式要求网关边收边转发,同时还要在流结束时拿到 usage 来记账,错误处理也复杂得多(流到一半上游断了,已经发给客户端的内容收不回来)。SupportPilot 的节点调用都是非流式的,只有最后展示给用户的回复需要流式,那一步可以先由 SupportPilot 自己直连。这是一个典型的「先做 80% 场景需要的部分」。

**请求大小限制。** 40 万字符大约是 10 万个汉字,超过直接 413。不加这一条,一个 bug 导致的超大请求会在网关的内存里完整解析一遍,再转发给上游,上游拒绝后还要再记一遍错误。

**trace_id。** 调用方传了 `X-Trace-Id` 就沿用,没传就生成一个,写进 `usage` 表和响应头。Day 102 接 OpenTelemetry 时,它会被替换成标准的 trace 上下文,现在先把字段占住。

**失败的尝试也记一行。** 主供应商失败、切到备用成功时,`usage` 里有两行:一行 `upstream_error`,一行 `fallback_ok`。这样能统计每家供应商的失败率。

**缺 key 的供应商在启动时就剔除。** `build_providers` 在 `create_app` 里跑一次,哪家没配 key,就不注册它,并在启动日志里打一行 `upstream deepseek disabled: AGENTOPS_DEEPSEEK_API_KEY is not set`。请求打到一条背后一个可用上游都没有的路由时,直接回 503,错误信息指向 `AGENTOPS_*_API_KEY`。我考虑过另一种做法:缺 key 就让进程起不来。它更严格,但 Day 98 到 Day 100 的测试和本地开发都要单独起应用、根本不碰网关,如果缺 key 就起不来,每个测试都得塞两把假 key。所以选了「标为不可用 + 启动日志 + 请求时说清楚」。生产上想要更严格,在部署检查里加一条「启动日志里不能出现 disabled」就行。

**数据库调用不在事件循环上跑。** 路由是 `async def`,而 `ledger` 用的是同步的 SQLAlchemy。同步调用直接写在 async 函数里,执行的那几毫秒整个事件循环都停着,所有在途请求一起等;平时只有一两毫秒看不出来,哪天数据库抖一下、一次查询卡了两秒,网关上所有请求就一起卡两秒,健康检查也会超时。所以这里用 `month_spend_async` 和 `record_async`,它们用 FastAPI 自带的 `run_in_threadpool` 把同步调用丢进线程池。另一个选择是整个换成 SQLAlchemy 的异步引擎,那是更彻底的做法,但 `db.py` 的引擎、Day 98 的审计、Day 99 的任务存储、Day 100 的评测都在用同步接口,一起改动面太大。线程池的方案只多了两个小函数,其他模块一行不用动。鉴权依赖 `tenant()` 本来就是普通的 `def`,FastAPI 会自动把它放进线程池,不用管。Day 104 压测时会看到,在 SQLite 上线程池并不会让吞吐变高,它买的是隔离,不是速度。

最后在 `main.py` 里把 Day 96 留的注释换成真正的挂载,顺带在启动时把上游构造好:

```python
    from agentops.gateway.app import init_gateway, router as gateway_router   # Day 97
    app.include_router(gateway_router)
    init_gateway(app)
```

## 测试:十个场景

```python
# agentops/tests/test_gateway.py
import asyncio
import logging

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import select

from agentops.config import Settings
from agentops.db import usage
from agentops.gateway import ledger
from agentops.gateway.providers import FakeProvider, OpenAICompatProvider
from agentops.gateway.ratelimit import RateLimiter
from agentops.main import create_app
from tests.conftest import PEPPER

MSG = {"messages": [{"role": "user", "content": "你好"}]}


def make(engine, **providers):
    provs = {"deepseek": FakeProvider("deepseek"), "qwen": FakeProvider("qwen")} | providers
    app = create_app(Settings(key_pepper=PEPPER), engine=engine, providers=provs)
    return TestClient(app), provs


def auth(key, feature="ticket.classify"):
    return {"Authorization": f"Bearer {key}", "X-AgentOps-Feature": feature}


def test_routes_to_primary_and_bills_the_tenant(engine, keys):
    c, provs = make(engine, deepseek=FakeProvider("deepseek", prompt_tokens=3000, cached_tokens=2000,
                                                  completion_tokens=400))
    r = c.post("/v1/chat/completions", json={"model": "fast", **MSG}, headers=auth(keys["cloudledger"]))
    assert r.status_code == 200
    assert r.headers["X-AgentOps-Provider"] == "deepseek"
    # (1000 × 2 + 2000 × 0.04 + 400 × 8) / 1e6 = 0.00528
    assert r.headers["X-AgentOps-Cost-CNY"] == "0.005280"
    with engine.connect() as conn:
        row = conn.execute(select(usage)).mappings().one()
    assert (row["tenant_id"], row["feature"], row["status"]) == ("t_cloudledger", "ticket.classify", "ok")


def test_falls_back_when_primary_is_down(engine, keys):
    c, provs = make(engine, deepseek=FakeProvider("deepseek", fail_times=99, fail_status=503))
    r = c.post("/v1/chat/completions", json={"model": "fast", **MSG}, headers=auth(keys["cloudledger"]))
    assert r.status_code == 200 and r.headers["X-AgentOps-Provider"] == "qwen"
    with engine.connect() as conn:
        statuses = [x.status for x in conn.execute(select(usage.c.status).order_by(usage.c.id))]
    assert statuses == ["upstream_error", "fallback_ok"]


def test_client_errors_are_not_retried_on_other_providers(engine, keys):
    c, provs = make(engine, deepseek=FakeProvider("deepseek", fail_times=99, fail_status=400))
    r = c.post("/v1/chat/completions", json={"model": "fast", **MSG}, headers=auth(keys["cloudledger"]))
    assert r.status_code == 400
    assert provs["qwen"].calls == []


def test_free_tier_cannot_use_smart(engine, keys):
    c, _ = make(engine)
    r = c.post("/v1/chat/completions", json={"model": "smart", **MSG}, headers=auth(keys["acme"]))
    assert r.status_code == 403


def test_rate_limit_is_per_tenant(engine, keys):
    c, _ = make(engine)
    codes = [c.post("/v1/chat/completions", json={"model": "fast", **MSG}, headers=auth(keys["acme"])).status_code
             for _ in range(7)]
    assert codes[:5] == [200] * 5 and codes[5:] == [429, 429]     # acme 每分钟 5 次
    # acme 被限流不影响 cloudledger
    r = c.post("/v1/chat/completions", json={"model": "fast", **MSG}, headers=auth(keys["cloudledger"]))
    assert r.status_code == 200


def test_budget_exhausted_returns_402(engine, keys):
    # acme 月预算 5 元。让假上游每次报 200 万输入 token:2,000,000 × 2 / 1e6 = 4 元一次
    c, _ = make(engine, deepseek=FakeProvider("deepseek", prompt_tokens=2_000_000, completion_tokens=0))
    r1 = c.post("/v1/chat/completions", json={"model": "fast", **MSG}, headers=auth(keys["acme"]))
    assert r1.status_code == 200          # 这一次花了 4 元,还没超
    r2 = c.post("/v1/chat/completions", json={"model": "fast", **MSG}, headers=auth(keys["acme"]))
    assert r2.status_code == 200          # 累计 8 元,本次请求开始时只有 4 元,所以放行
    r3 = c.post("/v1/chat/completions", json={"model": "fast", **MSG}, headers=auth(keys["acme"]))
    assert r3.status_code == 402


def test_token_bucket_refills_over_time():
    now = [0.0]
    rl = RateLimiter(clock=lambda: now[0])
    assert all(rl.allow("t", per_minute=60)[0] for _ in range(60))
    ok, wait = rl.allow("t", per_minute=60)
    assert not ok and 0.9 < wait <= 1.0
    now[0] += 1.0
    assert rl.allow("t", per_minute=60)[0]


def test_missing_upstream_keys_fail_clearly(engine, keys, caplog):
    # 不注入假上游,也不配 key:两家都应该在启动时被剔除,请求拿到 503 和一句指向配置的话
    with caplog.at_level(logging.WARNING, logger="agentops.gateway.app"):
        c = TestClient(create_app(Settings(key_pepper=PEPPER), engine=engine))
    assert "AGENTOPS_DEEPSEEK_API_KEY is not set" in caplog.text
    r = c.post("/v1/chat/completions", json={"model": "fast", **MSG}, headers=auth(keys["cloudledger"]))
    assert r.status_code == 503 and "AGENTOPS_" in r.json()["detail"]


def test_local_config_errors_are_not_retried(engine, keys):
    # 模拟「请求在本地就拼坏了」:httpx 在发出去之前抛 LocalProtocolError
    def broken(request: httpx.Request) -> httpx.Response:
        raise httpx.LocalProtocolError("Illegal header value b'Bearer '")
    bad = OpenAICompatProvider("deepseek", "https://upstream.invalid", "k")
    bad._client = httpx.AsyncClient(base_url="https://upstream.invalid", transport=httpx.MockTransport(broken))
    c, provs = make(engine, deepseek=bad)
    r = c.post("/v1/chat/completions", json={"model": "fast", **MSG}, headers=auth(keys["cloudledger"]))
    assert r.status_code == 500 and "check base_url / api_key" in r.json()["detail"]
    assert provs["qwen"].calls == []          # 配置错误不切到下一家


def test_ledger_calls_run_off_the_event_loop(engine, keys, monkeypatch):
    # 在线程池里跑的函数拿不到正在运行的事件循环;直接在 async 路由里跑的能拿到
    seen = []

    def on_loop() -> bool:
        try:
            asyncio.get_running_loop()
            return True
        except RuntimeError:
            return False

    real_record, real_spend = ledger.record, ledger.month_spend
    monkeypatch.setattr(ledger, "record", lambda *a, **k: (seen.append(on_loop()), real_record(*a, **k))[1])
    monkeypatch.setattr(ledger, "month_spend", lambda *a, **k: (seen.append(on_loop()), real_spend(*a, **k))[1])
    c, _ = make(engine)
    r = c.post("/v1/chat/completions", json={"model": "fast", **MSG}, headers=auth(keys["cloudledger"]))
    assert r.status_code == 200
    assert seen == [False, False]              # 查花费一次、记账一次,都不在事件循环线程上
```

第一个测试的成本断言值得手算一遍:3000 个输入 token 里有 2000 个命中缓存,未命中 1000 个;输出 400 个。按 flash 高峰价:(1000 × 2 + 2000 × 0.04 + 400 × 8) ÷ 1,000,000 = (2000 + 80 + 3200) ÷ 1,000,000 = 0.00528 元。如果你算出来不是这个数,检查一下是不是把命中缓存的 token 又按全价算了一遍,这正是上面说的最容易算错的地方。

限流测试里,acme 每分钟 5 次,前 5 个请求通过,第 6、7 个返回 429,紧接着 cloudledger 的请求照常通过。这一条就是 Day 96 验收指标里「不影响其他租户」的证据。

后面三个测试是为上面两个决定写的。`test_missing_upstream_keys_fail_clearly` 不注入假上游、也不配 key,确认启动日志里有那行提示、请求拿到的是 503 而不是 502。`test_local_config_errors_are_not_retried` 用 httpx 的 `MockTransport` 在本地直接抛 `LocalProtocolError`,确认网关回 500 而且没有去调 qwen。`test_ledger_calls_run_off_the_event_loop` 的思路是:在线程池里执行的函数拿不到正在运行的事件循环,直接在 async 路由里执行的能拿到,所以把 `ledger.record` 和 `ledger.month_spend` 换成会记下这一点的包装,断言两次调用都不在事件循环线程上。我把这三个测试放到改之前的代码上跑过,三个都失败,改完之后全部通过,说明它们确实在检查这两处行为。

我本机运行 `uv run pytest -q` 的输出是 `13 passed`(Day 96 的 3 个加今天的 10 个)。

## 接入 SupportPilot

SupportPilot 那边几乎不用改代码。它的 `LLMClient` 读的是 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL` 三个环境变量(Day 4 起的约定),改成:

```bash
# supportpilot/.env
LLM_BASE_URL=http://localhost:8000/v1
LLM_API_KEY=ak_k_xxxxxx.yyyyyyyy      # 用 issue_key 给 t_cloudledger 签发的 key
LLM_MODEL=fast
```

功能名需要每次调用时带上 `X-AgentOps-Feature` 头。openai SDK 支持 `extra_headers` 参数,在 SupportPilot 的各个节点里调用时传 `extra_headers={"X-AgentOps-Feature": "ticket.classify"}` 即可。改动集中在 `llm.py` 的 `chat()` 和 `structured()` 里加一个 `feature` 参数。这个改动的价值要到 Day 102 才完全体现:看板上第一次看到「起草回复这个节点占了 71% 的成本」时,你就知道该优化哪里了(71% 是举例,以你自己的数据为准)。

## 网关自己挂了怎么办

把所有团队的模型调用收到一个入口,带来的最大风险是这个入口本身成了单点。网关挂五分钟,所有团队的 Agent 一起停五分钟。评审时这个问题一定会被问到,设计文档里要提前回答。

我的回答分三层。第一层是让网关本身尽量简单、无状态:今天的网关除了限流桶以外不在内存里保存任何状态,可以起多个副本放在负载均衡后面,任何一个副本挂了,流量自动转到其他副本。限流桶换成 Redis 之后,网关就是完全无状态的。

第二层是减少网关对其他组件的强依赖。网关每个请求都要读数据库(鉴权和预算),数据库一抖,网关就跟着抖。改进办法是把租户信息和本月花费缓存在内存里,几十秒刷新一次;数据库暂时不可用时,用缓存里最后一次的值继续放行,同时把待写的 usage 记录先放在本地队列里,恢复后补写。这样数据库的短暂故障不会变成所有租户的故障。代价是故障期间的限额判断不精确,这是一个有意识的取舍:对内部平台来说,短时间多花一点钱,好过所有业务停摆。

第三层是给租户留后路。SDK 层面可以配置一个应急开关:网关连续失败超过阈值时,允许指定的高优先级租户临时直连上游(用平台托管的应急密钥,调用事后补记账)。这个开关平时关闭,打开时要告警,用完要复盘。很多团队不愿意做这一层,觉得破坏了「所有调用都走网关」的原则,但在凌晨三点线上客服全部停摆的时候,你会希望有这个开关。

这三层都不需要今天实现,但要写进设计文档的风险一节,并在 Day 104 压测时验证第一层。

## 动手练习

**步骤 1:** 写本文的 `pricing.py`、`providers.py`、`routes.py`、`ratelimit.py`、`ledger.py`、`app.py`,在 `main.py` 挂载 router,写 `tests/test_gateway.py`,跑通全部测试。

**步骤 2:接一次真实上游(可选,花几分钱)。** 在 `.env` 里填真实的 `AGENTOPS_DEEPSEEK_API_KEY`,起一个本地 Postgres(`docker compose up -d`),用脚本建租户、签 key,然后:

```bash
uv run uvicorn agentops.main:create_app --factory --port 8000
curl -s localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer $KEY" -H "X-AgentOps-Feature: smoke" -H "Content-Type: application/json" \
  -d '{"model":"fast","messages":[{"role":"user","content":"用一句话介绍你自己"}]}' -i | head -20
```

看响应头里的 `X-AgentOps-Cost-CNY`,再去 DeepSeek 控制台核对这次调用的 token 数,确认计费对得上。

**步骤 3:故障注入。** 把 deepseek 的 base_url 故意改成一个解析不到的域名,比如 `https://deepseek.invalid`,再调一次,确认请求通过 qwen 成功返回,`usage` 表里有一行 `upstream_error` 和一行 `fallback_ok`。再试一次把 base_url 写成没有 `https://` 的 `deepseek.invalid`:这次是本地配置错误,网关应该直接回 500,不会切到 qwen。两次的区别就是上面「请求在本地就失败了」那条规则。

**步骤 4:写一份网关 ADR。** 记录「429 是否触发供应商切换」这个决定,写出你的选择、理由、以及什么监控信号出现时要重新考虑。

**验收标准:** 13 个测试全绿;能口头解释今天十个测试各自证明了什么;步骤 3 的两种故障表现不同,能说清为什么;ADR 写完。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 模型网关(LLM gateway) | 所有模型调用的统一入口,负责鉴权、路由、限流、计费、故障切换 |
| 逻辑路由 | 对外的模型别名,背后是一组有序的(供应商,模型)候选 |
| 故障切换(fallback) | 主选上游失败时按顺序尝试备用上游 |
| 令牌桶(token bucket) | 按固定速率补充令牌、请求消耗令牌的限流算法,允许有上限的突发 |
| 固定窗口计数 | 每个时间窗口计数、到上限就拒的限流方法,有窗口边界突刺问题 |
| Retry-After | HTTP 响应头,告诉客户端多久之后再重试 |
| 软上限 | 允许最后一次请求略微超出的预算检查方式 |
| 可重试错误 | 换个上游或稍后再试有可能成功的错误,如超时和 5xx |
| 成本归因 | 把每笔花费记到租户和功能上 |

## 常见误区

**所有错误都重试。** 4xx 是请求的问题,重试只会浪费时间和钱。先分类再决定。

**按 0 元记录未知模型的成本。** 静默的错误比响亮的失败危险得多,查不到价格就报错。

**命中缓存的 token 按全价算。** 供应商返回的输入 token 数通常包含命中部分,要相减再分别计价,否则成本会被高估几倍。

**单进程限流直接上多副本。** 每个副本一个桶,实际配额会乘以副本数。多副本必须用共享存储实现。

**故障切换后不看质量。** 备用模型能力不同,可用性保住了,质量可能悄悄下降。要按供应商拆分评测结果,监控 fallback 比例。

**网关第一版就做流式、缓存、多区域。** 先做最常用的路径,并把没做的写进非目标。

## 学习资料

### 文档与文章

- [LiteLLM Routing](https://docs.litellm.ai/docs/routing) 和 [预算与虚拟 key](https://docs.litellm.ai/docs/proxy/users):成熟开源网关怎么设计路由策略、重试、冷却和按 key 的预算。对照今天的代码看,40 分钟。
- [Stripe:Scaling your API with rate limiters](https://stripe.com/blog/rate-limiters):Stripe 讲他们的四种限流器和令牌桶实现,工程味很浓,30 分钟。
- [Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/):AWS Builders' Library 讲超时、重试、退避抖动,重试为什么会放大故障。30 分钟。
- [Google SRE:Handling Overload](https://sre.google/sre-book/handling-overload/):按客户配额、拒绝的成本、重试预算,网关限流的理论背景。40 分钟。
- [Token bucket(维基百科)](https://en.wikipedia.org/wiki/Token_bucket):算法定义,5 分钟。
- [DeepSeek 价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) 和 [阿里云百炼模型列表](https://help.aliyun.com/zh/model-studio/models):更新 `pricing.py` 时以这两页为准。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV14NyrBTEeB&autoplay=0&high_quality=1" title="什么是 AI 网关?大厂 AI 开发神器有多强?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员鱼皮 · 什么是 AI 网关?大厂 AI 开发神器有多强? · 6 分钟,先用它建立整体印象。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1EGNGzhEQj&autoplay=0&high_quality=1" title="大模型网关 LiteLLM 零基础快速上手教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员暮闲 · 大模型网关 LiteLLM 零基础快速上手教程 · 16 分钟,跟着把 LiteLLM 跑起来,和我们自己写的网关对比路由和虚拟 key 的做法。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Nk7qDiLHyuU" title="LiteLLM AI Gateway: Routing, API Keys, Budgets, and Guardrails" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Paul Zuradzki · LiteLLM AI Gateway: Routing, API Keys, Budgets, and Guardrails · 英文,演示路由、按 key 预算和护栏的配置,看它的预算是怎么挂在 key 上的。</figcaption>
</figure>

### 书籍

- **Release It!(第 2 版)**,Michael T. Nygard,Pragmatic Bookshelf,2018。稳定性模式的经典:超时、断路器、舱壁、稳态。读第 5 章「Stability Patterns」,和今天的故障切换、限流一一对应。
- **Site Reliability Engineering**,Betsy Beyer 等编,O'Reilly,2016(中文版《SRE:Google 运维解密》,电子工业出版社)。读第 21 章「处理过载」和第 22 章「级联故障」,网上有官方免费在线版。

### 开源项目与代码

- [LiteLLM](https://github.com/BerriAI/litellm):看 `litellm/router.py` 里的重试和冷却逻辑。
- [Portkey Gateway](https://github.com/Portkey-AI/gateway):TypeScript 写的网关,看它的 fallback 和 loadbalance 配置格式。
- [Envoy AI Gateway](https://github.com/envoyproxy/ai-gateway) 和 [Bifrost](https://github.com/maximhq/bifrost):前者基于 Envoy,适合已经用 Envoy 的公司;后者用 Go 写,主打性能。了解一下选型的光谱即可。

## 自测

1. 网关里限流为什么放在预算检查之前?

<details><summary>答案</summary>

限流只读写内存里的一个桶,预算要对 usage 表做聚合查询,前者便宜得多。异常流量(比如死循环的 Agent)应该在最便宜的那一关被挡掉,不要让它给数据库施压。

</details>

2. 上游返回 400 时,为什么不切换到备用供应商?

<details><summary>答案</summary>

400 说明请求本身有问题(参数错误、内容被拦、上下文超长),换供应商大概率得到同样的错误,只会让租户多等、平台多付一次请求的开销。应该直接把错误还给调用方修请求。

</details>

3. 一次调用输入 5000 token,其中 4000 命中缓存,输出 600 token,按 deepseek-flash 高峰价算成本。

<details><summary>答案</summary>

未命中 1000 × 2 = 2000,命中 4000 × 0.04 = 160,输出 600 × 8 = 4800,合计 6960,除以一百万得 0.00696 元。

</details>

4. 单进程令牌桶部署成三个副本会发生什么?怎么修?

<details><summary>答案</summary>

每个副本各维护一份桶,负载均衡把请求分散到三个副本,一个租户的实际配额变成原来的三倍。修法是把桶状态放到 Redis 这类共享存储,用 Lua 脚本或原子操作保证读改写的一致性;接口保持 allow(key, per_minute) 不变。

</details>

5. 资深面试题:你的网关预算检查是软上限。产品经理说「免费档必须一分钱都不能超」,你怎么改?代价是什么?

<details><summary>答案</summary>

改成预扣:请求开始前按 max_tokens 和输入长度估算这次请求的最大可能花费,在预算里原子地扣掉(或者记一笔冻结额度),预扣失败就拒绝;请求结束后按实际 usage 结算,多退少补。代价:一是需要事务或原子计数保证并发安全,多副本时要用共享存储;二是估算偏保守,接近预算时一些本来能完成的请求会被拒;三是要处理请求失败、超时时冻结额度的释放,否则额度会泄漏。我会先问清楚「一分钱都不能超」的业务原因,如果只是免费档防滥用,软上限加很低的预算加告警通常就够了;如果是对外按量收费的场景,才值得做预扣。

</details>

6. 资深面试题:fast 路由的主选从 deepseek-flash 换成一个更便宜的新模型,你会怎么上线这个变更?

<details><summary>答案</summary>

不直接改路由表。先用评测平台在各租户的评测集上跑新旧模型对比,看质量差异是否在可接受范围(要有统计检验,不是看平均分);再按租户或按流量比例灰度,比如先给一个愿意尝鲜的租户,观察线上指标(转人工率、重问率、错误率、成本)一到两周;同时保留旧模型作为备用路由,出问题可以一键回滚。变更本身要写 ADR 或变更记录,通知各租户 owner。成本下降的收益要和质量风险一起汇报,而不是只报省了多少钱。

</details>

## 明天预告

Day 98 · AgentOps(二):MCP 工具中心与鉴权。把业务工具从各团队手里收到平台上统一管理:工具注册表、按租户和角色的授权策略、写操作的审批标记、每一次放行和拒绝都写审计日志,最后把 SupportPilot 的账单工具迁进来。
