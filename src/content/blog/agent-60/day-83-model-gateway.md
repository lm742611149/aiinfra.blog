---
title: 'Day 83 · 模型网关:路由、限流、配额、降级、成本归因'
description: '平台的第一块砖。所有 Agent 的模型调用都先经过网关:虚拟 key 鉴权、按月预算、按 token 限流、按模型组路由、出错自动切换供应商、按租户和项目记账。今天写一个能跑测试的最小网关,再对比 LiteLLM、Higress、Portkey 这些现成方案该怎么选。'
pubDate: 2026-10-12
regime: none
tags: ['gateway', 'rate-limit', 'fallback', 'cost-attribution', 'litellm', 'agent-60']
series: 'agent-60'
day: 83
lang: 'zh'
---

## 今天要解决的问题

昨天的平台提案里,我建议第一块做模型网关。理由很简单:它的接入成本几乎为零(业务方只要把 `LLM_BASE_URL` 换成网关地址),而它带来的好处第二天就能看到。财务终于知道每个部门花了多少钱;某家供应商下午三点开始大面积 429 的时候,所有 Agent 自动切到备用供应商,业务方甚至没察觉;某个团队的批处理脚本写错了死循环,烧到预算上限就被拦住,而不是第二天早上看到一张四位数的账单。

今天结束时你应该能:

1. 说清模型网关在架构里的位置,以及它管的十件事里哪几件必须做、哪几件可以以后再说。
2. 解释为什么限流要按 token 而不是按请求数,能写出令牌桶(token bucket)并处理「预估和实际用量不一致」的问题。
3. 设计路由和降级策略:什么错误该切换供应商、什么错误不该切,熔断器什么时候打开,流式请求的降级有什么特殊之处。
4. 实现按租户、项目、Agent 的成本归因,能和供应商的月账单对上。
5. 在 LiteLLM、Higress、Portkey、自研之间做出有理由的选择。

预计用时 5–6 小时(含写代码和跑测试)。前置:Day 3(usage 和计费)、Day 12(重试和失败处理)、Day 38(成本算式和价格)、Day 82(平台架构)。

## 网关在哪,管什么

模型网关坐在所有业务 Agent 和所有模型供应商之间。对业务方来说它就是一个「OpenAI 兼容的 API」,地址换成网关的,key 换成平台发的虚拟 key,其他代码一行不改。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="模型网关的位置:左边是多个租户的 Agent,中间网关依次做鉴权、预算、限流、路由降级、记账,右边是多个模型供应商">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="16" y="40" width="110" height="40" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/><text x="71" y="64" text-anchor="middle" fill="var(--ink)">客服 Agent</text>
    <rect x="16" y="100" width="110" height="40" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/><text x="71" y="124" text-anchor="middle" fill="var(--ink)">销售 Agent</text>
    <rect x="16" y="160" width="110" height="40" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/><text x="71" y="184" text-anchor="middle" fill="var(--ink)">Dify 应用</text>
    <text x="71" y="230" text-anchor="middle" fill="var(--ink-soft)">只认网关地址</text>
    <text x="71" y="246" text-anchor="middle" fill="var(--ink-soft)">和虚拟 key</text>
    <rect x="170" y="24" width="290" height="250" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="315" y="44" text-anchor="middle" fill="var(--ink)">模型网关</text>
    <rect x="186" y="56" width="258" height="30" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="315" y="75" text-anchor="middle" fill="var(--ink)">1 鉴权:虚拟 key -&gt; 租户</text>
    <rect x="186" y="94" width="258" height="30" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="315" y="113" text-anchor="middle" fill="var(--ink)">2 预算:本月花了多少</text>
    <rect x="186" y="132" width="258" height="30" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="315" y="151" text-anchor="middle" fill="var(--ink)">3 限流:按 token 的令牌桶</text>
    <rect x="186" y="170" width="258" height="30" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="315" y="189" text-anchor="middle" fill="var(--ink)">4 路由 + 降级 + 熔断</text>
    <rect x="186" y="208" width="258" height="30" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="315" y="227" text-anchor="middle" fill="var(--ink)">5 记账:租户/项目/Agent</text>
    <text x="315" y="260" text-anchor="middle" fill="var(--ink-soft)">缓存 · 日志 · 护栏钩子</text>
    <rect x="504" y="50" width="120" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="564" y="74" text-anchor="middle" fill="var(--ink)">DeepSeek</text>
    <rect x="504" y="110" width="120" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="564" y="134" text-anchor="middle" fill="var(--ink)">阿里百炼</text>
    <rect x="504" y="170" width="120" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="564" y="194" text-anchor="middle" fill="var(--ink)">自部署 vLLM</text>
    <text x="564" y="236" text-anchor="middle" fill="var(--ink-soft)">真实 key 只在这里</text>
  </g>
  <g stroke="var(--ink-faint)" stroke-width="1.2" fill="none">
    <path d="M126 60 L170 100"/><path d="M126 120 L170 130"/><path d="M126 180 L170 160"/>
    <path d="M460 120 L504 70"/><path d="M460 140 L504 130"/><path d="M460 160 L504 190"/>
  </g>
</svg>
<figcaption>请求在网关里依次经过五道关。业务方手里只有平台发的虚拟 key,真实的供应商 key 只存在网关里,这一点本身就是很大的安全收益。</figcaption>
</figure>

把网关该做的事列全,大概有十件:统一协议、鉴权(虚拟 key)、路由、限流、配额与预算、降级与故障切换、成本归因、缓存、请求日志与审计、护栏钩子(调用前后做内容检查)。但第一版不需要全做。我的优先级是:**鉴权、成本归因、限流、降级必须有**,这四件是平台化的直接收益;预算、日志其次;缓存和护栏可以等真有需求再加,而且缓存在 Agent 场景里命中率通常不高,做错了还有租户串数据的风险(Day 82 讲过)。

## 买还是自己写

2026 年网关这个品类已经很成熟了,你有很多现成选择。先看我对几个主流方案的印象:

| 方案 | 形态 | 适合谁 | 要注意的 |
| --- | --- | --- | --- |
| LiteLLM Proxy | Python,核心开源,自带虚拟 key、团队预算、按 key 的模型预算和降级、花费日志、管理界面 | 大多数从零开始的团队,功能最全、文档最多 | Python 实现,高并发下要多实例;2026 年 3 月出过一次供应链投毒事件,见下文 |
| Higress | 阿里开源(现在仓库在 higress-group 组织下,Apache-2.0),基于 Envoy 和 Istio 的云原生网关,AI 能力以插件提供(多模型代理、token 限流、fallback、MCP 托管) | 已经在用 Kubernetes、Envoy 的团队,国内部署友好 | 学习曲线偏网关运维,插件配置分散 |
| Portkey Gateway | 2026 年 3 月宣布网关全部开源,包括治理、可观测、预算和 MCP 网关;同年 5 月被 Palo Alto Networks 收购 | 想要现成治理能力、能接受商业公司主导的项目 | 收购后路线会偏安全产品,长期开源走向要观察 |
| Envoy AI Gateway / Bifrost | 前者是 Envoy 社区的 AI 网关,后者是 Go 写的高性能网关 | 对延迟和吞吐要求高的场景 | 生态和文档比 LiteLLM 少 |
| 自研薄网关 | 自己写,通常两三百行起步 | 有特殊的计费、路由或合规逻辑,现成方案改不动 | 所有边界情况都要自己踩一遍 |

我的建议是:**先用现成的,把公司特有的逻辑做成它的插件或者旁路服务**。比如成本归因要接公司的财务系统,不需要因此重写一个网关,让网关把用量日志推到消息队列,另起一个服务消费就行。

但今天我们还是要自己写一个最小网关。原因是只有自己写过一遍,你才知道 LiteLLM 那几百个配置项每一个在防什么,面试时问「你会怎么设计一个 LLM 网关」也才答得出细节。

关于 LiteLLM 的那次事件要专门说一下。2026 年 3 月 24 日,PyPI 上的 litellm 1.82.7 和 1.82.8 两个版本被植入恶意代码,会把机器上的 SSH key、云凭证、环境变量加密后发到攻击者的域名,1.82.8 甚至通过一个 `.pth` 文件让 Python 一启动就执行,不需要 import litellm。这两个版本很快被撤下,但影响面很大,因为不少 Agent 框架把它作为传递依赖。这件事对网关特别有教育意义:**网关是全公司持有供应商 key 最集中的地方,也就是攻击价值最高的地方**。所以网关的依赖要锁定精确版本(`uv.lock` 带哈希),镜像要校验签名,升级要先在隔离环境跑,机器上不要放和网关无关的凭证。

## 限流为什么要按 token

很多人做限流的第一反应是「每个租户每分钟最多 N 个请求」。对普通 API 这没问题,对大模型不行。一个「帮我分类这张工单」的请求可能 1,500 token,一个「把这份 80 页的合同总结一下」的请求可能 60,000 token,两者都算一个请求,但对供应商配额和成本的消耗差了 40 倍。供应商自己的限制也是同时按 RPM(每分钟请求数)和 TPM(每分钟 token 数)两个维度卡的,通常先撞上的是 TPM。

所以网关的限流主维度应该是 token。常用的算法是**令牌桶**:桶的容量是 C 个 token,每秒往里补充 r 个;请求来了要拿走它预计消耗的 token 数,桶里不够就拒绝,并告诉调用方大概要等多久(补够需要的时间 = 缺口 ÷ r)。令牌桶的好处是允许突发:桶满的时候可以一次放过一个大请求,而平均速率不会超过 r。Stripe 那篇讲限流的经典博客把这个算法讲得很清楚,链接在文末。

这里有一个大模型特有的麻烦:**请求进来的时候,你不知道它会消耗多少 token**。输入部分可以估(字符数换算,或者真的跑一遍 tokenizer),输出部分完全不知道。常见的做法是「预扣 + 结算」:

- 预扣:输入估算值 + `max_tokens`(调用方声明的输出上限)。`max_tokens` 不填的话给一个默认值,所以网关应该鼓励甚至强制调用方填。
- 结算:拿到响应后,用 `usage` 里的真实数字,预扣多了就把差额还回桶里,扣少了就记成欠账(桶里的余额变成负数,后面的请求要等它补回来)。

估算要偏保守还是偏宽松?我倾向于宽松一点,因为预扣太多会让桶的有效容量变小,而少扣的部分结算时会补回来。下面代码里用「字符数除以 2」估算输入:中文大约每 1–1.5 个字一个 token,所以对中文是少估;英文大约每 4 个字符一个 token,对英文是多估。你在生产里最好换成真的 tokenizer,DeepSeek 和通义都提供了离线的 tokenizer 文件。

## 预算和配额

限流管的是「速率」,预算管的是「总量」。两者都要有:限流防止一个租户在一分钟内挤占所有人,预算防止一个租户在一个月里花掉全部经费。

预算有硬上限和软上限两种处理方式。硬上限是到了就拒绝(HTTP 402),适合内部的实验项目、个人 key。软上限是到了就报警、通知负责人,但请求照常处理,适合线上的生产 Agent,因为直接拒绝意味着客服 Agent 停摆,这个代价往往比多花的钱大得多。

还有一种折中是**超预算后降级到便宜的模型**。LiteLLM 有个 `budget_fallbacks` 配置专门做这件事:某个 key 在主模型上的日预算用完后,后续请求自动改走预先配置的便宜模型,调用方不会收到错误。这个功能很好用,但它是一个产品决策而不是纯技术决策:回复质量会下降,而用户不知道。我的建议是只在评测过备用模型、确认质量在可接受范围之后才开,并且在响应头里标明实际用的是哪个模型,方便事后追查。

## 路由和降级

业务方调用时传的 `model` 不应该是具体的模型名,而是一个**模型组**名,比如 `fast` 和 `smart`。组背后是一个有序的部署列表:`fast = [deepseek-flash, 通义备用]`。这样做有两个好处:平台可以在不通知业务方的情况下换供应商、换版本;组内的顺序就是降级顺序。

**什么错误该降级?** 判断标准是「换个地方可能就好了」:

- 429 限流、5xx 服务端错误、超时、连接失败:换一家很可能就成功,应该降级。
- 400 参数错误、401 鉴权错误:换一家也一样错(或者错得更隐蔽),应该直接把错误还给调用方。
- 上下文超长:可以降级到一个上下文窗口更大的模型,这是一种单独的降级。
- 内容安全拦截:有些供应商会拒绝某些内容,换一家可能会通过。这种降级要很小心,因为它可能是在绕开本该生效的安全策略。

**熔断器(circuit breaker)。** 如果主供应商挂了,每个请求都先去试一下主供应商、等它超时、再切备用,那每个请求都白白多了一个超时的时间。熔断器的做法是:某个部署连续失败 N 次,就「熔断」一段时间,这段时间内直接跳过它;冷却时间过后放一个请求去试探,成功了就恢复。Day 12 讲过 Agent 层面的失败处理,这里是同样的思路放在网关层。

**降级的隐性成本。** 切到另一家模型,回复的风格、格式稳定性、工具调用的可靠性都可能变。所以**降级目标必须在你的评测集上跑过**,W11 的评测平台要把「备用模型」也纳入回归。还有两个技术细节:一是推理模型的加密推理内容不能跨供应商使用,LiteLLM 的文档里专门提到了这一点,多轮对话中途切了供应商,之前的推理上下文就丢了;二是流式请求只能在**第一个 token 返回之前**降级,一旦开始往客户端推内容,就只能报错,不能悄悄换一家从头再来。

## 成本归因

成本归因是网关最被低估的功能。没有它,财务问你每个部门花了多少,你只能按人头平摊。

做法是每一次调用都记一行账:

- **维度**:租户、项目、Agent、run ID(一次任务)、模型组、实际用的部署。项目、Agent 和 run ID 通过请求头传进来(`X-Project`、`X-Agent`、`X-Run-Id`)。
- **用量**:输入 token、其中命中缓存的 token、输出 token。缓存命中的价格只有原价的几十分之一(Day 38 算过 DeepSeek 的缓存命中价),不区分的话成本会算高很多。
- **价格版本**:用的是哪一版价格表。供应商调价后,历史账单应该按当时的价格算,所以价格表要有版本号,每行账记下用的是哪个版本。

每个月底拿网关的账和供应商的发票对一次。差额在 2% 以内通常是正常的(四舍五入、少量没走网关的调用);差额大了就要查:可能有人绕过网关直连,可能价格表没更新,也可能 token 字段解析错了(比如漏了缓存命中的那部分)。

拿到账以后怎么用,有两种模式。**Showback**(展示)是只给各部门看他们花了多少,不真的扣钱;**chargeback**(回收)是真的从各部门预算里扣。内部平台起步时建议先 showback,让大家先习惯看账,等数据准确、大家认可了口径再谈 chargeback,否则第一个月就会陷入「这个钱凭什么算我的」的扯皮。

## 写一个最小网关

下面这个网关大约 150 行,实现了鉴权、预算、token 限流、路由降级、熔断、记账。它有三个刻意的简化:限流和熔断状态存在进程内存里(多实例要换 Redis,后面给出 Lua 脚本);不支持流式;租户配置从 YAML 读(生产里来自控制面的配置快照)。

先装依赖:

```bash
cd agent-60-lab && uv add fastapi uvicorn "httpx>=0.28" openai pyyaml && uv add --dev pytest
mkdir -p w13/gateway
```

令牌桶和熔断器:

```python
# agent-60-lab/w13/gateway/ratelimit.py
import time
from dataclasses import dataclass, field
from typing import Callable


@dataclass
class TokenBucket:
    """按 token 计的令牌桶:capacity 是桶的大小,rate 是每秒补充多少。"""
    capacity: float
    rate: float
    clock: Callable[[], float] = time.monotonic
    tokens: float = field(init=False)
    updated: float = field(init=False)

    def __post_init__(self) -> None:
        self.tokens = self.capacity
        self.updated = self.clock()

    def _refill(self) -> None:
        now = self.clock()
        self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
        self.updated = now

    def try_take(self, n: float) -> tuple[bool, float]:
        """拿 n 个 token。成功返回 (True, 0);失败返回 (False, 还要等几秒)。"""
        self._refill()
        if n > self.capacity:
            return False, float("inf")      # 单次请求比整个桶还大,永远拿不到
        if self.tokens >= n:
            self.tokens -= n
            return True, 0.0
        return False, (n - self.tokens) / self.rate

    def give_back(self, n: float) -> None:
        """预扣多了,事后把差额还回去。"""
        self._refill()
        self.tokens = min(self.capacity, self.tokens + n)


class CircuitBreaker:
    """连续失败 threshold 次就熔断 cooldown 秒,冷却后放一个请求试探。"""

    def __init__(self, threshold: int = 3, cooldown: float = 30.0,
                 clock: Callable[[], float] = time.monotonic):
        self.threshold, self.cooldown, self.clock = threshold, cooldown, clock
        self.failures = 0
        self.opened_at: float | None = None

    def allow(self) -> bool:
        if self.opened_at is None:
            return True
        return self.clock() - self.opened_at >= self.cooldown   # 半开:放行试探

    def record(self, ok: bool) -> None:
        if ok:
            self.failures, self.opened_at = 0, None
            return
        self.failures += 1
        if self.failures >= self.threshold:
            self.opened_at = self.clock()
```

账本用 SQLite,够演示也够你本机分析:

```python
# agent-60-lab/w13/gateway/ledger.py
import sqlite3
import time
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY,
  ts REAL NOT NULL,
  month TEXT NOT NULL,
  tenant TEXT NOT NULL,
  project TEXT,
  agent TEXT,
  run_id TEXT,
  model_group TEXT NOT NULL,
  deployment TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  cached_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  price_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_tenant_month ON usage(tenant, month);
"""


def month_of(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m")


class Ledger:
    def __init__(self, path: str = "gateway_usage.db"):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.executescript(SCHEMA)

    def record(self, **row) -> None:
        ts = time.time()
        self.db.execute(
            "INSERT INTO usage (ts, month, tenant, project, agent, run_id, model_group, deployment,"
            " input_tokens, cached_tokens, output_tokens, cost_usd, price_version)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (ts, month_of(ts), row["tenant"], row.get("project"), row.get("agent"), row.get("run_id"),
             row["model_group"], row["deployment"], row["input_tokens"], row["cached_tokens"],
             row["output_tokens"], row["cost_usd"], row["price_version"]),
        )
        self.db.commit()

    def month_spend(self, tenant: str) -> float:
        cur = self.db.execute(
            "SELECT COALESCE(SUM(cost_usd), 0) FROM usage WHERE tenant=? AND month=?",
            (tenant, month_of(time.time())),
        )
        return cur.fetchone()[0]

    def breakdown(self, tenant: str) -> list[tuple]:
        return self.db.execute(
            "SELECT project, agent, model_group, ROUND(SUM(cost_usd), 6), COUNT(*)"
            " FROM usage WHERE tenant=? GROUP BY project, agent, model_group ORDER BY 4 DESC",
            (tenant,),
        ).fetchall()
```

配置文件。价格沿用 Day 38 查到的 DeepSeek 官方价格;各家的 base_url 和备用供应商的模型名都用环境变量填,`load_config` 会在解析 YAML 之前替换 `${...}`:

```yaml
# agent-60-lab/w13/gateway/config.yaml
price_version: "2026-10-12"        # 价格表也要有版本,事后对账才知道当时按什么价算的

deployments:                         # 价格:美元 / 百万 token,来自 Day 38 查到的官方价格
  deepseek-flash:
    base_url: ${DEEPSEEK_BASE_URL}     # 和 Day 3 的 LLM_BASE_URL 是同一个值
    api_key_env: DEEPSEEK_API_KEY
    model: deepseek-flash
    price: {input: 0.30, cached: 0.006, output: 1.20}
  deepseek-pro:
    base_url: ${DEEPSEEK_BASE_URL}
    api_key_env: DEEPSEEK_API_KEY
    model: deepseek-v4-pro
    price: {input: 1.32, cached: 0.044, output: 3.96}
  qwen-backup:                       # 备用供应商,模型名和价格请按你开通的服务填
    base_url: ${DASHSCOPE_BASE_URL}    # 百炼控制台给的 OpenAI 兼容地址
    api_key_env: DASHSCOPE_API_KEY
    model: ${QWEN_MODEL}
    price: {input: 0.30, cached: 0.06, output: 1.20}

model_groups:                        # 业务方只认组名,背后换供应商他们不用改代码
  fast: [deepseek-flash, qwen-backup]
  smart: [deepseek-pro, deepseek-flash]

tenants:                             # 生产里放数据库,key 只存哈希
  support:
    key_sha256: "8c1d...省略"
    allowed_groups: [fast, smart]
    tpm: 400000                      # 每分钟 token
    monthly_budget_usd: 300
  sales:
    key_sha256: "1f2e...省略"
    allowed_groups: [fast]
    tpm: 100000
    monthly_budget_usd: 50
```

网关主体。注意 `create_app` 接受一个 `http_client_factory` 参数,生产里不传,测试里传一个假的上游,这样不花一分钱就能测故障切换:

```python
# agent-60-lab/w13/gateway/gateway.py
import hashlib
import json
import os
import string
from dataclasses import dataclass
from typing import Callable

import httpx
import openai
import yaml
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from ledger import Ledger
from ratelimit import CircuitBreaker, TokenBucket

RETRYABLE = (openai.RateLimitError, openai.APITimeoutError, openai.APIConnectionError,
             openai.InternalServerError)


@dataclass
class Deployment:
    name: str
    base_url: str
    api_key: str
    model: str
    price: dict


@dataclass
class Tenant:
    name: str
    allowed_groups: list[str]
    bucket: TokenBucket
    monthly_budget_usd: float


def load_config(path: str) -> dict:
    raw = string.Template(open(path, encoding="utf-8").read()).safe_substitute(os.environ)
    return yaml.safe_load(raw)


def estimate_tokens(body: dict) -> int:
    """粗估输入 token:字符数除以 2(中文偏少估、英文偏多估),再加上 max_tokens 作为输出预留。"""
    text = json.dumps(body.get("messages", []), ensure_ascii=False)
    return len(text) // 2 + int(body.get("max_tokens") or 1024)


def cost_of(usage, price: dict) -> tuple[int, int, int, float]:
    cached = 0
    details = getattr(usage, "prompt_tokens_details", None)
    if details is not None and getattr(details, "cached_tokens", None):
        cached = details.cached_tokens
    cached = cached or getattr(usage, "prompt_cache_hit_tokens", 0) or 0   # DeepSeek 的字段名
    inp, out = usage.prompt_tokens, usage.completion_tokens
    usd = ((inp - cached) * price["input"] + cached * price["cached"] + out * price["output"]) / 1e6
    return inp, cached, out, usd


def create_app(config: dict, ledger: Ledger,
               http_client_factory: Callable[[], httpx.AsyncClient] | None = None) -> FastAPI:
    deployments = {
        name: Deployment(name, d["base_url"], os.environ.get(d["api_key_env"], "missing"),
                         d["model"], d["price"])
        for name, d in config["deployments"].items()
    }
    breakers = {name: CircuitBreaker() for name in deployments}
    tenants_by_hash = {
        t["key_sha256"]: Tenant(name, t["allowed_groups"],
                                TokenBucket(capacity=t["tpm"], rate=t["tpm"] / 60),
                                t["monthly_budget_usd"])
        for name, t in config["tenants"].items()
    }
    clients: dict[str, openai.AsyncOpenAI] = {}

    def client_for(d: Deployment) -> openai.AsyncOpenAI:
        if d.name not in clients:
            clients[d.name] = openai.AsyncOpenAI(
                base_url=d.base_url, api_key=d.api_key, max_retries=0, timeout=30,
                http_client=http_client_factory() if http_client_factory else None)
        return clients[d.name]

    app = FastAPI()

    @app.post("/v1/chat/completions")
    async def chat(request: Request, authorization: str = Header(""),
                   x_project: str | None = Header(None), x_agent: str | None = Header(None),
                   x_run_id: str | None = Header(None)):
        # 1. 鉴权:平台发的虚拟 key -> 租户。真实供应商的 key 业务方永远拿不到。
        key = authorization.removeprefix("Bearer ").strip()
        tenant = tenants_by_hash.get(hashlib.sha256(key.encode()).hexdigest())
        if tenant is None:
            raise HTTPException(401, "invalid api key")

        body = await request.json()
        if body.get("stream"):
            raise HTTPException(400, "这个最小网关不支持 stream,见正文说明")
        group = body.pop("model", "")
        if group not in tenant.allowed_groups or group not in config["model_groups"]:
            raise HTTPException(403, f"tenant {tenant.name} cannot use model group {group!r}")

        # 2. 预算:按月硬上限。先查账再放行,跑超一单可以接受,跑超一个月不行。
        spent = ledger.month_spend(tenant.name)
        if spent >= tenant.monthly_budget_usd:
            raise HTTPException(402, f"monthly budget exhausted: ${spent:.2f}")

        # 3. 限流:按 token 预扣,拿不到就告诉调用方等多久。
        reserved = estimate_tokens(body)
        ok, wait = tenant.bucket.try_take(reserved)
        if not ok:
            retry_after = "60" if wait == float("inf") else str(max(1, int(wait) + 1))
            return JSONResponse({"error": "tenant token rate limit"}, status_code=429,
                                headers={"Retry-After": retry_after})

        # 4. 路由 + 降级:组里的部署按顺序试,只对「换个地方可能就好了」的错误降级。
        errors = []
        for dep_name in config["model_groups"][group]:
            dep, breaker = deployments[dep_name], breakers[dep_name]
            if not breaker.allow():
                errors.append(f"{dep_name}: circuit open")
                continue
            try:
                resp = await client_for(dep).chat.completions.create(**body, model=dep.model)
            except RETRYABLE as e:
                breaker.record(False)
                errors.append(f"{dep_name}: {type(e).__name__}")
                continue
            except openai.APIStatusError as e:      # 400 之类:换哪家都一样错,直接还给调用方
                tenant.bucket.give_back(reserved)
                raise HTTPException(e.status_code, f"{dep_name}: {e.message}")
            breaker.record(True)

            # 5. 记账:按实际用量结算,把预扣的差额还回桶里。
            inp, cached, out, usd = cost_of(resp.usage, dep.price)
            actual = inp + out
            if actual < reserved:
                tenant.bucket.give_back(reserved - actual)
            else:
                tenant.bucket.tokens -= actual - reserved     # 少扣的记成欠账
            ledger.record(tenant=tenant.name, project=x_project, agent=x_agent, run_id=x_run_id,
                          model_group=group, deployment=dep_name, input_tokens=inp,
                          cached_tokens=cached, output_tokens=out, cost_usd=usd,
                          price_version=config["price_version"])
            return JSONResponse(resp.model_dump(), headers={
                "x-gateway-deployment": dep_name, "x-gateway-cost-usd": f"{usd:.6f}"})

        tenant.bucket.give_back(reserved)
        raise HTTPException(503, "all deployments failed: " + "; ".join(errors))

    return app
```

有几处值得停下来看看。

鉴权那一步只存 key 的 SHA-256 哈希,数据库泄露了也拿不到原 key。生产里还要加 key 的过期时间、吊销,以及每个 key 能访问的模型组。

预算检查放在限流前面,因为预算超了就没必要再扣令牌。但预算检查用的是「已经花的钱」,不包括这一单,所以租户可能超支一单的金额,这是可以接受的,要做到一分不超就得预扣金额,复杂度会上一个台阶。

400 错误不降级,直接返回,同时把预扣的 token 还回去。所有部署都失败时返回 503,并把每个部署的失败原因带上,方便调用方和值班的人排查。

`cost_of` 同时兼容两种缓存命中字段:OpenAI 风格的 `prompt_tokens_details.cached_tokens` 和 DeepSeek 的 `prompt_cache_hit_tokens`。不同供应商的 usage 字段不完全一样,这正是网关该替业务方抹平的差异。

## 用测试验证

测试用 `httpx.MockTransport` 模拟上游供应商,可以让主供应商返回 429 或 400,验证降级逻辑是否正确:

```python
# agent-60-lab/w13/gateway/test_gateway.py
import hashlib

import httpx
from fastapi.testclient import TestClient

from gateway import create_app
from ledger import Ledger

KEY_SUPPORT, KEY_SALES = "sk-support-test", "sk-sales-test"


def sha(k: str) -> str:
    return hashlib.sha256(k.encode()).hexdigest()


def make_config(tpm=400_000, budget=300.0):
    price = {"input": 0.30, "cached": 0.006, "output": 1.20}
    return {
        "price_version": "test",
        "deployments": {
            "primary": {"base_url": "https://primary.invalid/v1", "api_key_env": "X", "model": "m-primary", "price": price},
            "backup": {"base_url": "https://backup.invalid/v1", "api_key_env": "X", "model": "m-backup", "price": price},
        },
        "model_groups": {"fast": ["primary", "backup"]},
        "tenants": {
            "support": {"key_sha256": sha(KEY_SUPPORT), "allowed_groups": ["fast"], "tpm": tpm, "monthly_budget_usd": budget},
            "sales": {"key_sha256": sha(KEY_SALES), "allowed_groups": [], "tpm": tpm, "monthly_budget_usd": budget},
        },
    }


def completion(model: str) -> dict:
    return {
        "id": "c1", "object": "chat.completion", "created": 0, "model": model,
        "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": "好的"}}],
        "usage": {"prompt_tokens": 1000, "completion_tokens": 100, "total_tokens": 1100,
                  "prompt_tokens_details": {"cached_tokens": 600}},
    }


def fake_upstream(primary_status: int):
    calls = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(req.url.host)
        if req.url.host == "primary.invalid" and primary_status != 200:
            return httpx.Response(primary_status, json={"error": {"message": "boom"}})
        return httpx.Response(200, json=completion(req.url.host))

    return calls, (lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))


def post(client, key=KEY_SUPPORT, model="fast"):
    return client.post("/v1/chat/completions", headers={"Authorization": f"Bearer {key}", "X-Project": "refund"},
                       json={"model": model, "messages": [{"role": "user", "content": "退款"}], "max_tokens": 200})


def test_happy_path_records_cost(tmp_path):
    ledger = Ledger(str(tmp_path / "u.db"))
    calls, factory = fake_upstream(200)
    client = TestClient(create_app(make_config(), ledger, factory))
    r = post(client)
    assert r.status_code == 200
    assert r.headers["x-gateway-deployment"] == "primary"
    # (1000-600)*0.30 + 600*0.006 + 100*1.20 = 120 + 3.6 + 120 = 243.6 -> /1e6
    assert abs(ledger.month_spend("support") - 243.6e-6) < 1e-9
    assert ledger.breakdown("support")[0][0] == "refund"


def test_fallback_on_429(tmp_path):
    calls, factory = fake_upstream(429)
    client = TestClient(create_app(make_config(), Ledger(str(tmp_path / "u.db")), factory))
    r = post(client)
    assert r.status_code == 200
    assert r.headers["x-gateway-deployment"] == "backup"
    assert calls == ["primary.invalid", "backup.invalid"]


def test_bad_request_is_not_retried(tmp_path):
    calls, factory = fake_upstream(400)
    client = TestClient(create_app(make_config(), Ledger(str(tmp_path / "u.db")), factory))
    assert post(client).status_code == 400
    assert calls == ["primary.invalid"]


def test_group_not_allowed(tmp_path):
    _, factory = fake_upstream(200)
    client = TestClient(create_app(make_config(), Ledger(str(tmp_path / "u.db")), factory))
    assert post(client, key=KEY_SALES).status_code == 403
    assert post(client, key="sk-nobody").status_code == 401


def test_rate_limit_and_budget(tmp_path):
    _, factory = fake_upstream(200)
    client = TestClient(create_app(make_config(tpm=300), Ledger(str(tmp_path / "u.db")), factory))
    r = post(client)                       # 预估 ~200+ token,桶 300:第一次能过
    assert r.status_code == 200            # 实际用了 1100,桶欠账
    r = post(client)
    assert r.status_code == 429 and int(r.headers["Retry-After"]) >= 1

    client = TestClient(create_app(make_config(budget=0.0001), Ledger(str(tmp_path / "b.db")), factory))
    assert post(client).status_code == 200    # 花了 0.0002436,超了
    assert post(client).status_code == 402
```

在 `agent-60-lab` 目录下运行:

```bash
uv run pytest -q w13/gateway
```

我在本机(Python 3.12、fastapi 0.143、openai 3.29、httpx 0.28)跑的结果是 `5 passed`。第一个测试里那个 243.6 的算式值得自己算一遍:1,000 个输入 token 里 600 个命中缓存,未命中的 400 个按 0.30,命中的 600 个按 0.006,输出 100 个按 1.20,合计 243.6 美元每百万,也就是这一单 0.0002436 美元。

想接真实供应商跑一下的话,设好 `DEEPSEEK_API_KEY` 和 `DEEPSEEK_BASE_URL`(值就是 Day 3 里 `LLM_BASE_URL` 用的那个地址),把 `config.yaml` 里某个租户的 `key_sha256` 换成你自己 key 的哈希(`python3 -c "import hashlib;print(hashlib.sha256(b'sk-my-test').hexdigest())"`),然后:

```python
# agent-60-lab/w13/gateway/main.py
from gateway import create_app, load_config
from ledger import Ledger

app = create_app(load_config("config.yaml"), Ledger("gateway_usage.db"))
```

```bash
cd w13/gateway && uv run uvicorn main:app --port 4000
# 另开一个终端,业务方的代码只改 base_url 和 key:
curl -s localhost:4000/v1/chat/completions -H "Authorization: Bearer sk-my-test" \
  -H "X-Project: refund" -H "Content-Type: application/json" \
  -d '{"model":"fast","max_tokens":100,"messages":[{"role":"user","content":"用一句话解释什么是退款"}]}' -i | head -20
```

响应头里的 `x-gateway-deployment` 和 `x-gateway-cost-usd` 告诉你这次用了哪个部署、花了多少钱。

## 多实例:把令牌桶搬到 Redis

网关一定是多实例部署的,进程内存里的令牌桶在多实例下会失效:三个实例各自有一个满桶,租户的实际速率就是配置的三倍。要把桶的状态放到 Redis 里,而且「读余额、补充、扣减、写回」必须是原子操作,否则两个实例同时读到同一个余额就会超发。Redis 的 Lua 脚本是原子执行的,正好用来做这个:

```lua
-- agent-60-lab/w13/gateway/token_bucket.lua
-- KEYS[1] = 桶的 key,例如 tb:support
-- ARGV[1] = 容量,ARGV[2] = 每秒补充速率,ARGV[3] = 这次要拿的 token 数
local cap  = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local need = tonumber(ARGV[3])

-- 用 Redis 服务器自己的时间,避免各个网关实例的时钟不一致
local t   = redis.call('TIME')
local now = tonumber(t[1]) + tonumber(t[2]) / 1000000

local b      = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(b[1]) or cap
local ts     = tonumber(b[2]) or now
tokens = math.min(cap, tokens + (now - ts) * rate)

local ok, wait = 0, 0
if tokens >= need then
  tokens = tokens - need
  ok = 1
else
  wait = (need - tokens) / rate
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', tostring(now))
redis.call('EXPIRE', KEYS[1], math.ceil(cap / rate) * 2)
return {ok, tostring(wait)}
```

Python 侧用 `redis.asyncio` 的 `register_script` 加载一次,每个请求调用一次即可。结算阶段的「还回差额」也要写成一个类似的小脚本。熔断器的状态同理,可以放 Redis,也可以接受每个实例各自熔断(每个实例多试几次失败的代价不大),这是一个可以偷懒的地方。

## 流式请求怎么办

真实的 Agent 大量使用流式输出(Day 4、Day 36),最小网关不支持流式只是为了让代码短。加上流式要处理三件事:

- 网关要把上游的 SSE 流原样转发给客户端,FastAPI 用 `StreamingResponse` 包一个异步生成器即可。
- 成本:流式响应默认不带 usage,要在请求里加 `stream_options={"include_usage": true}`,让最后一个 chunk 带上用量,网关在流结束时记账。
- 降级:只能在拿到第一个 chunk 之前切换。实现上就是「先 await 第一个 chunk,拿到了才开始向客户端返回」,拿第一个 chunk 时出错就试下一个部署。

这也是为什么我说先用 LiteLLM 这类现成方案:流式、各家参数差异、函数调用格式转换这些细节,自己写要花很多时间,而它们已经被大量用户踩过坑了。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1EGNGzhEQj&autoplay=0&high_quality=1" title="大模型网关 LiteLLM 零基础快速上手教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员暮闲 · 大模型网关 LiteLLM 零基础快速上手教程 · 16 分钟。从安装到配置多个模型、生成虚拟 key、看花费,跟着做一遍,再对照今天自己写的网关,就能看出每个配置项在防什么。</figcaption>
</figure>

## 动手练习

**第一步:把最小网关跑起来(1.5 小时)。** 按上面的代码建好 `w13/gateway/`,跑通 5 个测试。然后自己加两个测试:

1. 主供应商连续失败 3 次后熔断器打开,第 4 个请求直接走备用,不再访问主供应商(提示:`fake_upstream` 里统计 `calls` 的次数;`CircuitBreaker` 默认阈值是 3)。
2. 一个租户把桶用完收到 429 时,另一个租户不受影响,证明限流是按租户隔离的。

**第二步:成本归因报表(1 小时)。** 写一个 `report.py`,从 `gateway_usage.db` 输出上个月每个租户、每个项目的花费,以及每个模型组的缓存命中率(命中 token ÷ 输入 token)。用假数据先跑通。

**第三步:用 LiteLLM 搭一遍同样的功能(1.5 小时)。** 按 LiteLLM 文档起一个 proxy(需要 Postgres 存 key 和花费),配两个模型组和 fallback,生成两个带预算的虚拟 key,用 curl 打一次正常请求,再把主部署的 `api_base` 改成一个不存在的地址,验证降级生效。记录下来:你自己写的网关有哪些功能 LiteLLM 有而你没有,反过来有没有。

**第四步:写一页选型结论。** 假设你在昨天那家公司,用今天的表格给出你的选择和三条理由,并写明「什么情况下会推翻这个决定」。

**验收标准:**

- 7 个测试全部通过,包括你自己加的两个。
- 报表能按租户和项目给出花费,并显示缓存命中率。
- 选型结论里提到了供应链安全(锁版本、校验),以及降级目标必须进评测集。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 模型网关(LLM gateway) | 位于所有调用方和模型供应商之间的代理,统一做鉴权、路由、限流、计费等 |
| 虚拟 key | 平台发给业务方的 key,映射到租户和权限,背后的真实供应商 key 只在网关里 |
| RPM / TPM | 每分钟请求数 / 每分钟 token 数,供应商限流的两个维度 |
| 令牌桶(token bucket) | 限流算法,桶按固定速率补充令牌,请求消耗令牌,允许一定程度的突发 |
| 模型组 | 一组可互相替代的模型部署的逻辑名,业务方调用组名,网关决定具体用哪个 |
| 降级(fallback) | 首选部署失败时自动改用备用部署 |
| 熔断器(circuit breaker) | 某个部署连续失败后在一段时间内直接跳过它,冷却后再试探 |
| 成本归因 | 把每次调用的花费记到租户、项目、Agent 等维度上 |
| showback / chargeback | 只展示各部门花费 / 真的从各部门预算里扣钱 |
| 供应链攻击 | 通过篡改依赖包(比如 PyPI 上的版本)来攻击使用它的系统 |

## 常见误区

**按请求数限流。** 大模型请求的 token 数可以差几十倍,按请求数限流既防不住大请求挤占配额,又会误伤大量小请求。主维度应该是 token,请求数作为辅助。

**所有错误都降级。** 400 参数错误换一家也是错,降级只是浪费时间和钱,还会把错误信息变得更难懂。只对限流、服务端错误、超时这类「换个地方可能就好了」的错误降级。

**降级目标没评测过。** 主模型在评测集上 92 分,备用模型从来没跑过,真降级的那天回复质量掉到多少没人知道。备用模型要进回归评测。

**成本只算输入和输出,不区分缓存命中。** 缓存命中价只有原价的几十分之一,不区分的话账单会算高很多,和供应商发票对不上。

**多实例部署还用进程内存做限流。** N 个实例各有一个桶,实际限额变成 N 倍。状态要放到 Redis 这类共享存储,并且读改写要原子。

**网关机器上放着一堆无关凭证,依赖随便升级。** 网关是供应商 key 最集中的地方,2026 年 3 月 LiteLLM 的投毒事件就是冲着这类凭证来的。锁版本、校验哈希、最小化机器上的凭证。

## 学习资料

### 文档与文章

- [LiteLLM · Virtual Keys](https://docs.litellm.ai/docs/proxy/virtual_keys):虚拟 key 的生成、权限继承规则。注意文档里「key 从它的 owner 继承什么」那张表,设计自己的平台时很有参考价值。30 分钟。
- [LiteLLM · Fallbacks](https://docs.litellm.ai/docs/proxy/reliability):三种降级(普通错误、上下文超长、内容策略)的区别,以及推理内容跨供应商不能复用的提醒。20 分钟。
- [LiteLLM · Budget Fallbacks](https://docs.litellm.ai/docs/proxy/budget_fallbacks):按 key 的模型预算和超预算后的降级链。15 分钟。
- [Higress · AI Token 限流插件](https://higress.ai/docs/latest/plugins/ai/api-consumer/ai-token-ratelimit/):基于 Redis 的 token 限流,支持全局和按租户(按请求里的动态 key)两种模式。中文文档。20 分钟。
- [Stripe · Scaling your API with rate limiters](https://stripe.com/blog/rate-limiters):令牌桶在生产里怎么用的经典文章,讲了请求限流、并发限流、负载削减几种限流器的组合。30 分钟。
- [FutureSearch · LiteLLM PyPI supply chain attack](https://futuresearch.ai/blog/litellm-pypi-supply-chain-attack/) 和 [NetSPI 的分析](https://www.netspi.com/blog/executive-blog/ai-ml-pentesting/litellm-supply-chain-compromise/):2026 年 3 月那次投毒事件的经过和自查方法。20 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1g24y157Ek&autoplay=0&high_quality=1" title="API网关的限流，熔断和降级" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>人月聊IT · API网关的限流,熔断和降级 · 4 分钟。传统 API 网关里这三个概念的关系,很短,适合在读今天「路由和降级」那节之前先建立直觉。</figcaption>
</figure>

上面那个 LiteLLM 上手教程也在这一组。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Nk7qDiLHyuU" title="LiteLLM AI Gateway: Routing, API Keys, Budgets, and Guardrails for Local and Cloud Models" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Paul Zuradzki · LiteLLM AI Gateway: Routing, API Keys, Budgets, and Guardrails · 9 分钟。把路由、虚拟 key、预算、护栏串起来演示一遍,和今天网关的五道关一一对应。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025)第 10 章:讲从单个应用演进到带路由、网关、缓存、护栏的架构,其中模型网关一节列了网关该管的事,和今天的清单可以互相对照。40 分钟。
- Alex Xu《System Design Interview: An Insider's Guide》(2020)第 4 章「Design a Rate Limiter」:令牌桶、漏桶、滑动窗口几种算法的对比,以及分布式限流的竞态问题。面试前必看。1 小时。

### 开源项目与代码

- [BerriAI/litellm](https://github.com/BerriAI/litellm):重点看 `litellm/router.py` 里降级和冷却(cooldown)的实现,对照今天的熔断器。1 小时。
- [higress-group/higress](https://github.com/higress-group/higress):看 `plugins/wasm-go/extensions/` 下面以 `ai-` 开头的插件目录,了解一个云原生网关把 AI 能力拆成了哪些插件。30 分钟。
- [Portkey-AI/gateway](https://github.com/Portkey-AI/gateway):另一种设计思路,路由、重试、降级都用一个 JSON 配置描述。30 分钟。

## 自测

1. 一个租户配置的 TPM 是 60,000,令牌桶容量设为 60,000、补充速率 1,000/秒。它刚刚用完了桶,现在来了一个预估 5,000 token 的请求,网关应该返回什么?Retry-After 填多少?

<details><summary>答案</summary>

桶里是 0(或接近 0),需要 5,000,缺口 5,000,补充速率 1,000/秒,需要等 5 秒。返回 429,`Retry-After: 6`(向上取整再加一点余量)。调用方应该按这个时间退避重试,而不是立刻重试。

</details>

2. 为什么 400 错误不降级,而 429 要降级?内容安全拦截的降级为什么要小心?

<details><summary>答案</summary>

400 是请求本身有问题(参数错、格式错),换一家大概率还是错,降级只会浪费时间和钱,还可能让错误信息更难理解。429 是这一家当前太忙,换一家很可能成功。内容安全拦截的降级要小心,因为这可能是在绕开本该生效的安全策略,比如一个本该被拒绝的有害请求,换了一家审核更松的供应商就通过了。是否降级应该由平台的安全策略决定,而不是默认开启。

</details>

3. 流式请求的降级有什么限制?网关怎么实现?

<details><summary>答案</summary>

只能在第一个 chunk 返回之前降级,一旦开始向客户端推送内容就不能再换一家重来,只能报错。实现方式是先 await 上游的第一个 chunk,拿到了才开始向客户端返回 StreamingResponse;拿第一个 chunk 时出错就尝试下一个部署。同时请求里要带 `stream_options={"include_usage": true}`,让最后一个 chunk 带上用量,网关在流结束时记账。

</details>

4. 月底网关的账比供应商发票少了 15%,你会按什么顺序排查?

<details><summary>答案</summary>

先查有没有绕过网关的直连调用(看供应商后台按 key 的用量,是否有不属于网关的 key 在消耗);再查价格表版本是否在供应商调价后更新;再查 token 解析:是否漏算了某类 token(推理模型的 reasoning tokens、图片 token),缓存命中价格是否用错;最后查失败重试是否没记账(供应商对部分失败的请求也会计费)。

</details>

5. 多实例网关里,为什么令牌桶的「读余额、补充、扣减、写回」必须原子执行?Lua 脚本里为什么用 Redis 的 TIME 而不是网关传进来的时间?

<details><summary>答案</summary>

两个实例同时读到同一个余额,各自扣减后写回,后写的会覆盖先写的,结果两个请求都被放行,实际消耗超过了余额。Lua 脚本在 Redis 里是原子执行的,中间不会插入其他命令。用 Redis 服务器的 TIME 是为了避免各网关实例时钟不一致:某个实例时钟快了几秒,算出来的补充量就会偏大。

</details>

6. **资深面试题**:设计一个服务全公司 30 个团队、峰值每秒 2,000 次模型调用的 LLM 网关。说说你的架构、最关键的三个设计决策,以及你会怎么证明它可靠。

<details><summary>答案</summary>

架构:无状态网关实例多副本部署在负载均衡后面;限流和预算状态放 Redis(集群,按租户分片),用 Lua 保证原子;配置(租户、模型组、价格表)来自控制面快照,本地缓存;用量日志异步写 Kafka,由独立服务落库做成本归因和对账,不在请求路径上同步写数据库。三个关键决策:一是按 token 限流且采用预扣加结算,并强制或默认 max_tokens;二是降级只针对可恢复错误,配合熔断器,降级目标必须进评测集,流式只在首包前降级;三是网关不在请求路径上同步依赖任何慢组件,Redis 不可用时有本地降级策略(比如按实例平分限额的近似限流),而不是拒绝所有请求。可靠性证明:网关自身 SLO(比如 99.95% 可用、额外延迟 P99 小于 30ms),压测到峰值 3 倍,故障演练(拔掉一个供应商、拔掉 Redis、注入延迟)验证降级和熔断,每月账单对账误差小于 2%。还要提安全:真实 key 只在网关,依赖锁版本防供应链攻击,审计日志记录谁用了什么。

</details>

## 明天预告

Day 84 讲**MCP 网关与鉴权**:模型的出口管住了,接下来管工具的出口。你会看到 2026 年 7 月最新版 MCP 规范里的授权流程(OAuth 2.1、受保护资源元数据、Client ID Metadata Documents 取代动态注册),为什么规范明令禁止「令牌透传」,工具定义被偷偷改掉的 rug pull 攻击怎么用指纹钉住来防,并动手写一个带工具登记、按租户授权和防篡改审计日志的工具中心。
