---
title: 'Day 96 · AgentOps 开题:设计文档、里程碑、验收指标'
description: '进阶毕业项目开工。SupportPilot 是一个 Agent,AgentOps 是让十个团队都能安全、便宜、可评测地跑 Agent 的平台。今天先不急着写网关,把设计文档、目录结构、五个子系统之间的接口和验收指标定下来,后面九天照着它施工。'
pubDate: 2026-10-12
regime: none
tags: ['agentops', 'design-doc', 'multi-tenant', 'architecture', 'agent-60']
series: 'agent-60'
day: 96
lang: 'zh'
---

## 今天要解决的问题

基础篇的毕业项目 SupportPilot 是一个 Agent:一张工单进来,它分类、查知识库、调业务工具、等审批、写回复。它跑得不错,也有评测和成本账本。进阶篇的毕业项目要往上走一层:假设云簿公司里第二个、第三个团队也要做 Agent 了,财务想做对账助手,销售想做线索整理,运维想做告警分诊。如果每个团队都像你当初那样从零搭一遍模型客户端、工具鉴权、长任务、评测和成本统计,公司会得到五套互不兼容、各有漏洞的轮子。

AgentOps 就是解决这个问题的平台。今天不写业务代码,只做资深工程师开工前一定要做的那件事:写清楚要做什么、不做什么、各部分之间怎么说话、做成什么样算完。今天结束时你应该能:

1. 讲清楚为什么要从「一个 Agent」走到「一个平台」,以及平台化什么时候是过度设计。
2. 画出 AgentOps 的架构图,说出控制面和数据面分别管什么。
3. 写出一份能拿去评审的设计文档,包含目标、非目标、接口约定、风险和验收指标。
4. 搭好仓库骨架:数据模型、租户和 API key、应用工厂,三个单测全绿。
5. 排出 Day 96 到 Day 105 的里程碑,每一天都有能验收的产出。

预计用时 5 到 7 小时,其中一半时间花在写文档上,这是故意的。前置:Day 43 到 Day 54 的 SupportPilot,Day 61 到 Day 95 的进阶内容(网关、MCP 鉴权、持久化执行、评测统计会反复用到)。

## 先回答一个问题:真的需要平台吗

平台化是资深工程师最容易犯的错误之一,也是最容易被面试官追问的地方。一个团队、一个 Agent 的时候做平台,纯属给自己找活干:抽象全是猜的,接口改十遍,真正的业务反而没人管。判断要不要做平台,我自己的经验是看三件事有没有同时出现。

第一,至少有三个团队在重复做同一类基础设施,而且做法已经开始分叉。比如 SupportPilot 用 DeepSeek,财务助手直接调了通义,两边的重试逻辑、超时、成本统计各写一套,月底财务问「AI 这个月花了多少钱,花在哪个功能上」,没人答得上来。

第二,出现了只有统一才能解决的风险。最典型的是密钥和权限:如果每个团队都把上游模型的 API key 写进自己的配置文件,换一次 key 要改五个仓库,泄漏一次要查五个地方;每个团队都能直接调「退款」这种写操作工具,审计日志散落在各处,出了事故根本拼不出时间线。

第三,有人愿意为它负责。平台不是写完就完的项目,是一个长期产品。没有 owner 的平台,半年后就是一个谁都不敢动的公共依赖。

云簿这个虚构场景里三条都满足,所以我们做。面试时如果被问「你为什么要做平台」,不要回答「因为平台更高级」,要回答具体的重复和风险,再说你怎么控制范围。

## AgentOps 包含什么,不包含什么

设计文档里最有价值的一节往往是「非目标」。写清楚不做什么,评审的人才不会在第二周跑来问「能不能顺便支持一下语音」。

**要做的五个子系统:**

- **模型网关**(Day 97):所有团队调大模型都走它。它提供一个 OpenAI 兼容的接口,按逻辑路由名(比如 fast、smart)选择真正的供应商和模型,负责限流、配额、故障切换,并把每一次调用的 token 和成本记到对应的租户和功能名下。
- **MCP 工具中心**(Day 98):业务工具以 MCP server 的形式注册进来,租户的 Agent 通过中心访问工具。中心负责鉴权、按角色授权、写操作审批标记和审计日志。
- **持久化运行时**(Day 99):长任务、要等人审批的任务交给它跑。每一步的结果都落库,进程挂了能从断点续上,同一步不会执行两次。
- **评测平台**(Day 100):离线回归评测、统计检验、线上 A/B 分流,结果按租户保存,能比较两个版本是不是真的有差别。
- **路由小模型、可观测、安全、压测**(Day 101 到 Day 104):在前四个子系统上加功能,最后包装成作品(Day 105)。

**明确不做的:**

- 不做可视化编排界面。拖拽式工作流是 Dify、Coze 的领域,我们的用户是写代码的团队。
- 不做自己的 Agent 框架。租户可以用 LangGraph、可以手写循环,平台只提供运行时和基础设施,不规定 Agent 内部怎么写。
- 不做模型训练平台。Day 101 会接一个微调好的小模型,但训练流程留在 Day 77 到 Day 81 的脚本里,不做成服务。
- 不追求多区域部署和高可用到四个九。单区域、单 Postgres 主库,压测目标写在后面的验收指标里。

最后一条特别重要。资深工程师和中级工程师的一个区别,是知道哪些「应该做」的事这一期不做,并且把理由写下来。

<figure>
<svg viewBox="0 0 640 400" role="img" aria-label="AgentOps 架构:租户应用通过网关、工具中心、运行时、评测平台访问模型和业务系统,控制面管理租户、配额、策略">
  <rect x="20" y="20" width="600" height="60" rx="8" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="40" y="44" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">租户应用</text>
  <rect x="40" y="52" width="130" height="20" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="105" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">SupportPilot</text>
  <rect x="185" y="52" width="130" height="20" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="250" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">财务对账助手</text>
  <rect x="330" y="52" width="130" height="20" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="395" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">运维告警分诊</text>
  <text x="520" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">……</text>
  <rect x="20" y="110" width="440" height="170" rx="8" fill="none" stroke="var(--mem)" stroke-dasharray="5 4"/>
  <text x="34" y="130" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">数据面:每个请求都经过</text>
  <rect x="40" y="145" width="190" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="135" y="168" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">模型网关 /v1</text>
  <text x="135" y="188" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">路由 限流 配额 计费</text>
  <rect x="250" y="145" width="190" height="56" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="345" y="168" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">MCP 工具中心 /mcp</text>
  <text x="345" y="188" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">鉴权 授权 审计</text>
  <rect x="40" y="212" width="190" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="135" y="235" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">运行时 /runs</text>
  <text x="135" y="255" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">断点续跑 审批等待</text>
  <rect x="250" y="212" width="190" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="345" y="235" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">评测平台 /evals</text>
  <text x="345" y="255" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">回归 统计 A/B</text>
  <rect x="480" y="110" width="140" height="170" rx="8" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="550" y="132" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">控制面</text>
  <text x="550" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">租户和 key</text>
  <text x="550" y="182" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">配额和预算</text>
  <text x="550" y="204" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">路由表</text>
  <text x="550" y="226" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">工具策略</text>
  <text x="550" y="248" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">审计查询</text>
  <rect x="20" y="310" width="290" height="60" rx="8" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="165" y="336" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">上游模型</text>
  <text x="165" y="356" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">DeepSeek 通义 自部署小模型</text>
  <rect x="330" y="310" width="290" height="60" rx="8" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="475" y="336" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">业务系统的 MCP server</text>
  <text x="475" y="356" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">账单 客户 工单 知识库</text>
  <line x1="200" y1="80" x2="200" y2="110" stroke="var(--rule)" stroke-width="1.5"/>
  <line x1="135" y1="280" x2="135" y2="310" stroke="var(--mem)" stroke-width="1.5"/>
  <line x1="345" y1="280" x2="475" y2="310" stroke="var(--compute)" stroke-width="1.5"/>
  <line x1="460" y1="195" x2="480" y2="195" stroke="var(--rule)" stroke-width="1.5"/>
</svg>
<figcaption>蓝色是模型侧,琥珀色是工具和业务系统侧。数据面每个请求都要经过,所以要快、要稳;控制面只有管理员和配置变更会碰,可以慢一点,但改动要留痕。</figcaption>
</figure>

## 控制面和数据面:为什么要分开想

这两个词来自网络和 Kubernetes。数据面是真正处理业务流量的部分:每一次模型调用、每一次工具调用、每一步运行时的执行。控制面是管理这些流量的规则:谁是租户,每个租户每分钟能发多少请求,fast 路由背后是哪个模型,哪个角色能调退款工具。

分开想的好处是,两边的要求完全不同。数据面要的是低延迟和高可用,网关多加 50 毫秒,所有团队的所有请求都慢 50 毫秒;控制面要的是正确和可追溯,一次错误的配额变更可能让一个租户整天用不了,所以每次变更都要记录是谁改的、改了什么。具体到实现上,数据面读控制面的配置要有缓存,控制面挂了数据面最好还能按最后一次配置继续跑;控制面的写操作全部进审计日志。

我们这个项目规模小,控制面和数据面在同一个 FastAPI 进程里,共用一个 Postgres。但代码结构上要分开,接口上也要分开,这样哪天真要拆,拆的是部署而不是重写。这种「先在代码边界上分开,等规模到了再在部署上分开」的做法,是资深工程师常用的控制复杂度的方式。

## 多租户隔离:四个维度

多租户这个词在 SaaS 里讲烂了,但放到 Agent 平台上,有几个维度是普通 SaaS 不太会碰到的。

**数据隔离。** 每张表都带 tenant_id,每条查询都按 tenant_id 过滤。这一点和普通 SaaS 一样,难点在于 Agent 会生成你没预料到的查询。Day 46 的 text-to-SQL 工具用同名 CTE 做了行级隔离,平台层面要保证所有工具都经过同样的约束,而不是靠每个工具作者自觉。

**配额隔离。** 这是最典型的「吵闹的邻居」问题:一个租户的 Agent 进了死循环,一分钟调两千次模型,把平台在上游的速率额度全部吃光,其他租户全部开始报 429。所以限流要按租户做,预算要按租户做,而且要在请求到达上游之前做。

**密钥隔离。** 租户永远拿不到上游模型的 API key,只拿到平台签发的 key。平台的 key 能吊销、能限定作用域(只能调网关、不能调工具),库里只存哈希。今天就把它写出来。

**故障隔离。** 某个上游供应商挂了,网关切到备用供应商;某个租户的 MCP server 挂了,只影响用到它的 Agent。平台本身不能因为一个租户的异常输入而整体出错,比如一个租户传了一个 10 MB 的 prompt,平台应该拒绝,而不是在内存里把它处理完。

隔离模型上有三种常见做法:每个租户一个数据库(silo)、共享数据库但每个租户一个 schema、所有租户共享表靠 tenant_id 区分(pool)。我们选 pool,理由写在下面的 ADR 里。面试被问到时,不要只说「我们用了 tenant_id」,要说清楚你考虑过另外两种、为什么没选,以及什么条件下会换。

## 仓库结构

下面是 AgentOps 的完整目录。Day 96 到 Day 100 是我写,Day 101 到 Day 105 按同一个结构往里加。每个子系统一个包,包里的文件名在各天之间保持一致,这样你在 Day 103 看到 `mcphub/policy.py` 时,知道它就是 Day 98 写的那个文件。

```text
agentops/
├── pyproject.toml                 # Day 96 依赖与 pytest 配置
├── .env.example                   # Day 96 所有 AGENTOPS_ 开头的配置项
├── docker-compose.yml             # Day 96 Postgres;Day 102 加 OTel Collector + Jaeger
├── Makefile                       # Day 96 test / run / fmt
├── docs/
│   ├── design.md                  # Day 96 设计文档(今天的主要产出)
│   └── adr/                       # Day 96 起,每个重要决定一份 ADR
├── src/agentops/
│   ├── config.py                  # Day 96 pydantic-settings
│   ├── db.py                      # Day 96 全部表定义(SQLAlchemy Core)
│   ├── deps.py                    # Day 96 FastAPI 依赖:engine、tenant(scope)
│   ├── main.py                    # Day 96 应用工厂 create_app(),各天往里挂 router
│   ├── tenancy/keys.py            # Day 96 API key 签发与解析,TenantContext
│   ├── gateway/                   # Day 97 pricing / providers / routes / ratelimit / ledger / app
│   ├── mcphub/                    # Day 98 registry / policy / audit / app
│   ├── runtime/                   # Day 99 store / harness / worker / app
│   ├── evals/                     # Day 100 dataset / stats / runner / experiments / app
│   ├── router_model/              # Day 101 小模型路由:把 Day 81 的模型接进网关
│   ├── obs/                       # Day 102 OTel tracing、指标、成本看板
│   └── security/                  # Day 103 红队用例与 CI 回归
├── apps/
│   └── supportpilot_adapter/      # Day 99 把 SupportPilot 包成运行时里的 agent
├── loadtest/                      # Day 104 压测脚本
├── deploy/                        # Day 104 compose 与 K8s 两种部署
└── tests/                         # 每天都加,默认全部用 SQLite 内存库和假上游,不花钱
```

和 SupportPilot 的关系:SupportPilot 仍然是一个独立仓库,它的 `llm.py` 里的 base_url 改成指向网关,它的 MCP 客户端改成指向工具中心,它的长任务通过 `apps/supportpilot_adapter` 交给运行时。也就是说,AgentOps 是 SupportPilot 的基础设施,SupportPilot 是 AgentOps 的第一个租户。平台项目一定要有一个真实的第一租户,否则所有接口设计都是想象出来的。

## 五个接口约定

设计文档里写得最细的应该是接口,因为接口一旦被三个团队用上,就很难改了。下面这张表是 AgentOps 各子系统对外的约定,后面九天的代码都必须遵守它。

| 子系统 | 对外接口 | 身份 | 关键约定 |
| --- | --- | --- | --- |
| 网关 | `POST /v1/chat/completions`,OpenAI 兼容 | `Authorization: Bearer ak_...`,scope `gateway` | `model` 字段填逻辑路由名(fast / smart / auto);请求头 `X-AgentOps-Feature` 报功能名;响应头返回 `X-AgentOps-Cost-CNY`、`X-AgentOps-Provider` |
| 工具中心 | `POST /mcp/{server_id}`,MCP streamable HTTP | 同上,scope `mcp`;请求头 `X-AgentOps-Role` 声明调用者角色 | 未授权的工具在 `tools/list` 里直接不出现;拒绝和放行都写审计 |
| 运行时 | `POST /runs`、`GET /runs/{id}`、`POST /runs/{id}/approve` | scope `runs` | 状态机 queued → running → waiting_human → succeeded / failed / cancelled;每一步有幂等键 |
| 评测 | `POST /evals/runs`、`GET /evals/runs/{id}`、`GET /evals/compare?a=&b=` | scope `evals` | 结果按用例存;比较接口返回配对统计检验结果,不只给平均分 |
| 控制面 | 管理脚本和 `/admin/*`(Day 104 再做成接口) | 平台管理员 | 所有写操作进 `audit_log` |

几个约定的理由值得写进文档:

网关用 OpenAI 兼容协议,而不是自己设计一套。原因是租户现有代码几乎都是 openai SDK 写的,改一个 base_url 就能接入,迁移成本接近零。代价是 Anthropic 专有的能力(比如某些缓存控制参数)要么透传、要么暂时不支持,这一点写进风险。

`model` 字段填逻辑名而不是真实模型名,是平台最重要的一个解耦。租户只关心「我要一个快的」还是「我要一个聪明的」,背后用 DeepSeek 还是通义、用哪个版本,由平台根据价格和评测结果调整。哪天 DeepSeek 涨价了,平台改一行路由表,所有租户无感切换。

功能名由调用方在请求头里报上来。成本归因如果只到租户级别,财务只知道 SupportPilot 花了八百块,不知道其中多少花在分类、多少花在起草回复。功能名让成本能细到「哪个节点最贵」,这是 Day 102 成本看板的数据基础。

## 数据模型

所有表定义放在一个文件里。这不是唯一的做法,很多项目每个模块管自己的表,但我们这个规模下放在一起更好审查:一眼能看到所有带 tenant_id 的表,也能一眼看出谁漏了。

选 SQLAlchemy Core 而不是 ORM,也不是裸 SQL。Core 让同一套表定义既能在 Postgres 上跑,也能在 SQLite 内存库里跑单测,测试不需要起数据库容器;不用 ORM 是因为平台代码以批量写入和简单查询为主,ORM 的会话和延迟加载在这里帮不上忙,反而让「这里到底发了几条 SQL」变得不透明。

```python
# agentops/src/agentops/db.py
"""所有表定义在一处。生产用 Postgres,单测用 SQLite 内存库,所以只用 SQLAlchemy Core 的通用类型。"""
from sqlalchemy import (JSON, Boolean, Column, DateTime, Float, ForeignKey, Integer, MetaData, String, Table,
                        Text, UniqueConstraint, create_engine, func)
from sqlalchemy.engine import Engine

metadata = MetaData()

tenants = Table(
    "tenants", metadata,
    Column("id", String(40), primary_key=True),          # t_cloudledger
    Column("name", String(200), nullable=False),
    Column("tier", String(20), nullable=False, default="standard"),   # free / standard / enterprise
    Column("monthly_budget_cny", Float, nullable=False, default=500.0),
    Column("rpm_limit", Integer, nullable=False, default=120),        # 每分钟请求数
    Column("allowed_models", JSON, nullable=False, default=list),     # 空列表 = 跟随 tier 默认
    Column("created_at", DateTime(timezone=True), server_default=func.now()),
)

api_keys = Table(
    "api_keys", metadata,
    Column("id", String(40), primary_key=True),          # k_xxx,公开的 key 前缀
    Column("tenant_id", ForeignKey("tenants.id"), nullable=False),
    Column("secret_hash", String(128), nullable=False),  # 只存哈希
    Column("label", String(100), nullable=False),
    Column("scopes", JSON, nullable=False),              # ["gateway", "mcp", "runs", "evals"]
    Column("revoked", Boolean, nullable=False, default=False),
    Column("created_at", DateTime(timezone=True), server_default=func.now()),
)

# Day 97 模型网关:每次上游调用一行,成本归因靠它
usage = Table(
    "usage", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("tenant_id", String(40), nullable=False, index=True),
    Column("feature", String(60), nullable=False),       # 调用方自己报的功能名,如 ticket.classify
    Column("route", String(60), nullable=False),         # 网关里的逻辑模型名,如 fast / smart
    Column("provider", String(40), nullable=False),
    Column("model", String(80), nullable=False),
    Column("prompt_tokens", Integer, nullable=False),
    Column("cached_tokens", Integer, nullable=False, default=0),
    Column("completion_tokens", Integer, nullable=False),
    Column("cost_cny", Float, nullable=False),
    Column("latency_ms", Integer, nullable=False),
    Column("status", String(20), nullable=False),        # ok / upstream_error / fallback_ok
    Column("trace_id", String(64)),
    Column("ts", DateTime(timezone=True), server_default=func.now(), index=True),
)

# Day 98 MCP 工具中心
mcp_servers = Table(
    "mcp_servers", metadata,
    Column("id", String(60), primary_key=True),          # cloudledger-billing
    Column("owner_tenant", String(40), nullable=False),
    Column("url", String(300), nullable=False),          # 上游 streamable HTTP 地址
    Column("description", Text, nullable=False, default=""),
)

tool_policies = Table(
    "tool_policies", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("tenant_id", String(40), nullable=False),
    Column("server_id", ForeignKey("mcp_servers.id"), nullable=False),
    Column("tool", String(80), nullable=False),          # 工具名,"*" 表示整台 server
    Column("level", String(20), nullable=False),         # read / write / dangerous
    Column("allowed_roles", JSON, nullable=False),       # ["agent", "supervisor"]
    Column("needs_approval", Boolean, nullable=False, default=False),
    UniqueConstraint("tenant_id", "server_id", "tool"),
)

audit_log = Table(
    "audit_log", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("tenant_id", String(40), nullable=False, index=True),
    Column("actor", String(120), nullable=False),        # key:k_xxx / user:alice / run:r_xxx
    Column("action", String(80), nullable=False),        # tool.call / tool.denied / run.approve ...
    Column("target", String(160), nullable=False),
    Column("detail", JSON, nullable=False),
    Column("ts", DateTime(timezone=True), server_default=func.now()),
)

# Day 99 持久化运行时
runs = Table(
    "runs", metadata,
    Column("id", String(40), primary_key=True),
    Column("tenant_id", String(40), nullable=False, index=True),
    Column("agent", String(60), nullable=False),         # supportpilot.ticket
    Column("status", String(20), nullable=False),        # queued/running/waiting_human/succeeded/failed/cancelled
    Column("input", JSON, nullable=False),
    Column("output", JSON),
    Column("error", Text),
    Column("attempts", Integer, nullable=False, default=0),
    Column("lease_owner", String(60)),                   # 哪个 worker 正在跑
    Column("lease_until", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True), server_default=func.now()),
    Column("updated_at", DateTime(timezone=True), server_default=func.now()),
)

steps = Table(
    "steps", metadata,
    Column("run_id", ForeignKey("runs.id"), primary_key=True),
    Column("seq", Integer, primary_key=True),
    Column("kind", String(20), nullable=False),          # llm / tool / approval / note
    Column("key", String(200), nullable=False),          # 幂等键:同一个 run 里同一个 key 只执行一次
    Column("request", JSON, nullable=False),
    Column("result", JSON),
    Column("status", String(20), nullable=False),        # done / waiting / failed
    Column("ts", DateTime(timezone=True), server_default=func.now()),
    UniqueConstraint("run_id", "key"),
)

# Day 100 评测平台
eval_runs = Table(
    "eval_runs", metadata,
    Column("id", String(40), primary_key=True),
    Column("tenant_id", String(40), nullable=False),
    Column("dataset", String(120), nullable=False),      # tickets_v1@sha256 前 8 位
    Column("variant", String(60), nullable=False),       # prompt_v3 / router_on ...
    Column("summary", JSON, nullable=False),
    Column("created_at", DateTime(timezone=True), server_default=func.now()),
)

eval_results = Table(
    "eval_results", metadata,
    Column("eval_run_id", ForeignKey("eval_runs.id"), primary_key=True),
    Column("case_id", String(60), primary_key=True),
    Column("passed", Boolean, nullable=False),
    Column("scores", JSON, nullable=False),
    Column("cost_cny", Float, nullable=False, default=0.0),
    Column("latency_ms", Integer, nullable=False, default=0),
)


def make_engine(url: str) -> Engine:
    return create_engine(url, future=True)


def init_db(engine: Engine) -> None:
    metadata.create_all(engine)
```

几处设计说明。`usage` 表记录每一次上游调用,包括失败和降级的调用,因为失败也花钱(超时的请求上游可能已经开始计费),而且失败率本身就是要监控的指标。`steps` 表上的 `(run_id, key)` 唯一约束是运行时幂等的最后一道保险:就算代码有 bug 导致同一步被执行两次,数据库也会拒绝第二次写入。`audit_log` 只追加不修改,生产上应该给应用账号只授予 INSERT 和 SELECT 权限。

## 租户和 API key

租户拿到的 key 形如 `ak_k_3f2a9c1d.xxxxxxxx`,点前面是公开的 key id,点后面是只出现一次的 secret。库里只存 secret 的 HMAC 哈希,拿到数据库备份的人也伪造不出 key。比较哈希用 `hmac.compare_digest`,避免按响应时间猜出 secret 的前几位。

```python
# agentops/src/agentops/tenancy/keys.py
"""租户 API key:形如 ak_<key_id>.<secret>。库里只存 secret 的 HMAC,泄漏库也拿不到明文。"""
import hashlib
import hmac
import secrets
from dataclasses import dataclass

from sqlalchemy import insert, select
from sqlalchemy.engine import Connection

from agentops.db import api_keys, tenants


@dataclass(frozen=True)
class TenantContext:
    """每个请求解析出来的身份,往下传给网关、MCP 中心、运行时。"""
    tenant_id: str
    key_id: str
    scopes: frozenset[str]
    tier: str
    rpm_limit: int
    monthly_budget_cny: float
    allowed_models: tuple[str, ...]

    def require(self, scope: str) -> None:
        if scope not in self.scopes:
            raise PermissionError(f"key {self.key_id} lacks scope '{scope}'")


def _hash(secret: str, pepper: str) -> str:
    return hmac.new(pepper.encode(), secret.encode(), hashlib.sha256).hexdigest()


def issue_key(conn: Connection, tenant_id: str, label: str, scopes: list[str], pepper: str) -> str:
    key_id = "k_" + secrets.token_hex(6)
    secret = secrets.token_urlsafe(24)
    conn.execute(insert(api_keys).values(id=key_id, tenant_id=tenant_id, secret_hash=_hash(secret, pepper),
                                         label=label, scopes=scopes, revoked=False))
    return f"ak_{key_id}.{secret}"   # 只在签发时返回一次


class AuthError(Exception):
    pass


def resolve(conn: Connection, raw: str, pepper: str) -> TenantContext:
    if not raw.startswith("ak_") or "." not in raw:
        raise AuthError("malformed key")
    key_id, secret = raw[3:].split(".", 1)
    row = conn.execute(
        select(api_keys, tenants.c.tier, tenants.c.rpm_limit, tenants.c.monthly_budget_cny, tenants.c.allowed_models)
        .join(tenants, tenants.c.id == api_keys.c.tenant_id)
        .where(api_keys.c.id == key_id)
    ).mappings().first()
    # 常量时间比较,防止按响应时间猜 secret
    if row is None or row["revoked"] or not hmac.compare_digest(row["secret_hash"], _hash(secret, pepper)):
        raise AuthError("invalid or revoked key")
    return TenantContext(tenant_id=row["tenant_id"], key_id=key_id, scopes=frozenset(row["scopes"]),
                         tier=row["tier"], rpm_limit=row["rpm_limit"],
                         monthly_budget_cny=row["monthly_budget_cny"],
                         allowed_models=tuple(row["allowed_models"] or ()))
```

`TenantContext` 是整个平台里传得最多的对象。网关用它判断限流和配额,工具中心用它判断授权,运行时用它隔离任务,评测平台用它隔离结果。它是不可变的 dataclass,请求开始时解析一次,之后一路传下去,任何地方都不应该再从 header 里重新解析身份。

FastAPI 的依赖把这件事统一起来,各子系统的 router 只写 `Depends(tenant("gateway"))`,不碰 header:

```python
# agentops/src/agentops/deps.py
"""FastAPI 依赖:引擎和租户身份。各模块的 router 都用这两个,不自己解析 header。"""
from collections.abc import Callable

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.engine import Engine

from agentops.tenancy.keys import AuthError, TenantContext, resolve


def get_engine(request: Request) -> Engine:
    return request.app.state.engine


def tenant(scope: str) -> Callable[..., TenantContext]:
    """用法:ctx: TenantContext = Depends(tenant("gateway"))"""
    def dep(request: Request, authorization: str = Header(default=""),
            engine: Engine = Depends(get_engine)) -> TenantContext:
        raw = authorization.removeprefix("Bearer ").strip()
        try:
            with engine.connect() as c:
                ctx = resolve(c, raw, request.app.state.settings.key_pepper)
            ctx.require(scope)
        except AuthError as e:
            raise HTTPException(401, str(e)) from e
        except PermissionError as e:
            raise HTTPException(403, str(e)) from e
        request.state.tenant = ctx      # 日志、tracing 中间件从这里取租户
        return ctx
    return dep
```

应用工厂留好挂载点。注意 `overrides` 参数,它让测试可以注入假的上游模型和假的 MCP server,这是后面每一天的测试都不花钱、不依赖网络的关键:

```python
# agentops/src/agentops/main.py
"""应用工厂。每个子系统自带一个 APIRouter,在这里挂载;还没写的子系统先不挂。"""
from fastapi import FastAPI
from sqlalchemy.engine import Engine

from agentops.config import Settings, get_settings
from agentops.db import init_db, make_engine


def create_app(settings: Settings | None = None, engine: Engine | None = None, **overrides) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="AgentOps", version="0.1.0")
    app.state.settings = settings
    app.state.engine = engine or make_engine(settings.database_url)
    init_db(app.state.engine)
    app.state.overrides = overrides   # 测试时注入假的上游 provider、假的 MCP 上游等

    @app.get("/healthz")
    def healthz() -> dict:
        return {"ok": True}

    # 各天逐步挂载:
    # Day 97  from agentops.gateway.app import router as gateway_router;  app.include_router(gateway_router)
    # Day 98  from agentops.mcphub.app import router as mcp_router;        app.include_router(mcp_router)
    # Day 99  from agentops.runtime.app import router as runs_router;      app.include_router(runs_router)
    # Day 100 from agentops.evals.app import router as evals_router;       app.include_router(evals_router)
    return app
```

## 设计文档怎么写

很多工程师觉得设计文档是形式主义,写完没人看。这种感觉通常来自两种坏文档:一种是代码写完后补的,纯粹描述现状,没有任何决策;另一种是长达四十页的模板填空,关键决定埋在第二十七页。

好的设计文档是写给评审人看的,目的是在动手之前暴露分歧。Google 工程实践里对设计文档的描述很到位:它最重要的部分是上下文、目标和非目标、考虑过的其他方案,以及取舍。我给 AgentOps 用的结构如下,控制在五到八页:

1. **背景**:现在的问题是什么,用数字说。比如「三个团队各自对接模型,上月模型支出 2,400 元无法按功能拆分;两次上游故障导致 SupportPilot 中断共 47 分钟」(数字是示例,写你自己的)。
2. **目标与非目标**:上面那两个列表。
3. **方案总览**:架构图加一段话。
4. **详细设计**:五个子系统各一节,重点写接口和数据模型。
5. **考虑过的其他方案**:比如「直接部署 LiteLLM 作为网关」「用 Temporal 作为运行时」,各写为什么现在不选、什么情况下会选。
6. **风险和缓解**:网关成为单点、Postgres 成为瓶颈、OpenAI 兼容协议覆盖不了某些供应商特性。
7. **验收指标和里程碑**:见下一节。
8. **开放问题**:还没想清楚、需要评审人给意见的地方。

第五节是区分资深和中级的地方。中级工程师的设计文档通常只有一个方案;资深工程师的文档里,至少有一个被认真考虑过然后放弃的方案,而且放弃的理由经得起追问。

ADR(架构决策记录)是设计文档的补充。设计文档讲整体,ADR 一次只记一个决定,格式很短:背景、决定、后果。今天写第一份:

```markdown
# docs/adr/0001-pool-multitenancy-on-postgres.md

## 背景
AgentOps 第一期预计 3–5 个租户,单租户日调用量在千到万级别。需要选择租户数据隔离方式。

## 决定
所有租户共享表,用 tenant_id 区分(pool 模式),存储用单个 Postgres。
所有查询必须经过带 tenant_id 的数据访问函数;单测覆盖跨租户读取必须失败的情况。

## 考虑过的其他方案
- 每租户一个 schema:隔离更强,但迁移要跑 N 遍,租户数上去后运维成本线性增长。
- 每租户一个数据库(silo):适合有合规要求的大客户,第一期没有这样的租户。

## 后果
+ 运维简单,跨租户统计(平台成本、总调用量)一条 SQL。
- 一个 tenant_id 过滤的 bug 就是数据泄漏,必须靠代码审查和测试兜底。
- 出现需要物理隔离的企业客户时,要为它单独起一套(silo),届时再写 ADR-00xx。
```

## 验收指标和里程碑

验收指标要写成能测的数字,不能写「性能良好」「安全可靠」。下面是 AgentOps 第一期的指标,每一条都对应后面某一天的测试或压测:

| 指标 | 目标 | 怎么测 | 对应 |
| --- | --- | --- | --- |
| 跨租户隔离 | 用 A 的 key 读 B 的任何数据,100% 失败 | 隔离测试套件 | 每天 |
| 网关额外延迟 | P95 小于 30 毫秒(不含上游) | 假上游 + 压测 | Day 97、104 |
| 上游故障切换 | 主供应商返回 5xx 时,切到备用,租户请求成功率不低于 99% | 故障注入测试 | Day 97 |
| 限流 | 租户超出每分钟配额后返回 429,不影响其他租户 | 并发测试 | Day 97 |
| 成本归因 | 平台按租户加功能汇总的成本,与上游账单误差小于 2% | 对账脚本 | Day 97、102 |
| 工具授权 | 未授权工具不出现在 tools/list,调用被拒且有审计 | 单测 + 审计查询 | Day 98 |
| 断点续跑 | 任务执行中杀掉 worker,重启后从断点继续,已完成的步骤不重复执行 | 故障注入测试 | Day 99 |
| 评测 | 两个版本比较时给出差值的置信区间和 p 值 | 单测 + 示例报告 | Day 100 |
| 红队回归 | 注入和越权用例全部被拦截,进 CI | CI | Day 103 |

里程碑按天排:

| Day | 产出 | 验收 |
| --- | --- | --- |
| 96 | 设计文档、ADR-0001、仓库骨架 | 本篇的 3 个单测通过,文档评审过 |
| 97 | 模型网关 | 路由、限流、配额、故障切换、计费测试通过 |
| 98 | MCP 工具中心 | 授权过滤、审批标记、审计测试通过 |
| 99 | 持久化运行时 | 断点续跑和幂等测试通过,SupportPilot 跑通 |
| 100 | 评测平台 | 统计检验和 A/B 分流测试通过 |
| 101–105 | 路由小模型、可观测、安全、压测与部署、作品包装 | 见各天 |

## 动手练习

**步骤 1:建仓库。**

```bash
uv init --package --name agentops --python 3.12 agentops
cd agentops
uv add fastapi "uvicorn[standard]" httpx "sqlalchemy>=2" pydantic-settings openai "mcp>=2"
uv add --dev pytest
mkdir -p src/agentops/{tenancy,gateway,mcphub,runtime,evals} tests docs/adr
```

写本文中的 `config.py`、`db.py`、`tenancy/keys.py`、`deps.py`、`main.py`。`tenancy/__init__.py` 和 `tests/__init__.py` 建空文件即可。我写这篇时用的版本是 FastAPI 0.143、SQLAlchemy 2.1、mcp 2.3,你装到的版本号可能更新,接口用法在这几个包里都比较稳定。

**步骤 2:写测试夹具和三个测试。**

```python
# agentops/tests/conftest.py
import pytest
from sqlalchemy import insert
from sqlalchemy.pool import StaticPool

from agentops.db import init_db, make_engine, tenants
from agentops.tenancy.keys import issue_key

PEPPER = "test-pepper"


@pytest.fixture
def engine():
    from sqlalchemy import create_engine
    eng = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    init_db(eng)
    with eng.begin() as c:
        c.execute(insert(tenants), [
            dict(id="t_cloudledger", name="云簿 CloudLedger", tier="standard", monthly_budget_cny=500.0,
                 rpm_limit=60, allowed_models=[]),
            dict(id="t_acme", name="Acme 内部助手", tier="free", monthly_budget_cny=5.0,
                 rpm_limit=5, allowed_models=["fast"]),
        ])
    return eng


@pytest.fixture
def keys(engine):
    with engine.begin() as c:
        return {
            "cloudledger": issue_key(c, "t_cloudledger", "supportpilot", ["gateway", "mcp", "runs", "evals"], PEPPER),
            "acme": issue_key(c, "t_acme", "bot", ["gateway"], PEPPER),
        }
```

```python
# agentops/tests/test_tenancy.py
import pytest

from agentops.tenancy.keys import AuthError, resolve
from tests.conftest import PEPPER


def test_key_resolves_to_its_tenant(engine, keys):
    with engine.connect() as c:
        ctx = resolve(c, keys["acme"], PEPPER)
    assert ctx.tenant_id == "t_acme"
    assert ctx.rpm_limit == 5
    ctx.require("gateway")
    with pytest.raises(PermissionError):
        ctx.require("mcp")


def test_tampered_secret_is_rejected(engine, keys):
    bad = keys["acme"][:-2] + "xx"
    with engine.connect() as c, pytest.raises(AuthError):
        resolve(c, bad, PEPPER)
```

```python
# agentops/tests/test_app.py
from fastapi import Depends
from fastapi.testclient import TestClient

from agentops.config import Settings
from agentops.deps import tenant
from agentops.main import create_app
from tests.conftest import PEPPER


def test_tenant_dependency_checks_key_and_scope(engine, keys):
    app = create_app(Settings(key_pepper=PEPPER), engine=engine)

    @app.get("/whoami")
    def whoami(ctx=Depends(tenant("mcp"))):
        return {"tenant": ctx.tenant_id}

    c = TestClient(app)
    assert c.get("/healthz").json() == {"ok": True}
    assert c.get("/whoami").status_code == 401
    assert c.get("/whoami", headers={"Authorization": f"Bearer {keys['acme']}"}).status_code == 403
    r = c.get("/whoami", headers={"Authorization": f"Bearer {keys['cloudledger']}"})
    assert r.json() == {"tenant": "t_cloudledger"}
```

运行 `uv run pytest -q`,应该看到 3 个测试通过。我在本机跑的输出是 `3 passed`。

**步骤 3:写设计文档。** 按上一节的八个部分写 `docs/design.md`,至少包含:一张架构图(手画拍照也行)、目标和非目标各不少于三条、五个接口的约定表、至少一个「考虑过但放弃的方案」、验收指标表。

**步骤 4:找人评审。** 发给一个同事或朋友,请他只回答两个问题:哪个决定你最不认同,哪个风险我没写。把他的意见和你的回应附在文档末尾的「评审记录」里。

**验收标准:** 3 个测试全绿;设计文档能让一个没参与过的人在 15 分钟内看懂系统边界和接口;至少有一条评审意见并已回应。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 多租户(multi-tenancy) | 一套系统同时服务多个互相隔离的客户或团队,每个叫一个租户 |
| 控制面 / 数据面 | 管理规则和配置的部分 / 处理实际业务流量的部分 |
| 吵闹的邻居(noisy neighbor) | 一个租户的异常负载影响到共享资源上的其他租户 |
| pool / silo | 多租户隔离的两端:所有租户共享资源 / 每个租户独占资源 |
| 逻辑路由名 | 网关对外暴露的模型别名(fast、smart),背后映射到真实供应商和模型 |
| 成本归因 | 把每一笔模型花费记到具体的租户和功能上 |
| ADR | Architecture Decision Record,一次只记一个架构决定的短文档 |
| 设计文档 | 动手前写的方案说明,核心是目标、非目标、取舍和风险 |
| TenantContext | 本项目里每个请求解析出的租户身份对象,一路往下传 |
| 幂等键 | 同一个操作重复提交时用来识别「这是同一件事」的键 |

## 常见误区

**一上来就做平台。** 只有一个 Agent 的时候做平台,抽象都是猜的。至少等到三个团队在重复同一类基础设施,再动手。

**设计文档写成现状描述。** 文档的价值在于动手前暴露分歧。没有「考虑过的其他方案」和「风险」两节的文档,评审人没什么可评的。

**非目标不写或写得含糊。** 「暂不考虑高级功能」等于没写。要写成「不做可视化编排,理由是用户都是写代码的团队」这样具体的句子。

**接口用真实模型名。** 租户代码里写死 `deepseek-flash`,平台就失去了替换供应商的能力。对外只暴露逻辑名。

**测试依赖真实上游。** 平台的测试如果要真的调 DeepSeek,就会又慢又花钱又不稳定,最后大家不跑。从第一天起就留好注入假上游的口子。

**租户 key 明文存库。** 数据库备份、慢查询日志、导出的 CSV,任何一个泄漏都会连带泄漏所有租户的 key。只存哈希。

## 学习资料

### 文档与文章

- [Design Docs at Google](https://www.industrialempathy.com/posts/design-docs-at-google/):Malte Ubl 写的设计文档实践,讲清楚文档该写什么、什么时候不用写。今天写文档前先读,20 分钟。
- [Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions):Michael Nygard 提出 ADR 的原文,很短,10 分钟。
- [ADR 社区站](https://adr.github.io/) 和 [architecture-decision-record 模板仓库](https://github.com/joelparkerhenderson/architecture-decision-record):各种 ADR 模板和范例,挑一个顺手的。
- [AWS SaaS Lens](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/saas-lens.html):AWS 官方的 SaaS 架构指南,看租户隔离、吵闹邻居和计量计费几节,不用 AWS 也适用。40 分钟。
- [Mature Platform Prerequisites](https://martinfowler.com/articles/platform-prerequisites.html):Martin Fowler 网站上关于平台化前提条件的文章,对应本篇「真的需要平台吗」一节。30 分钟。
- [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):基础篇读过,今天再看一遍,注意它反复强调的「先用最简单的方案」,这对平台设计同样成立。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1hu4y1R7BY&autoplay=0&high_quality=1" title="一个视频搞懂多租户架构该怎么做?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>侠梦的开发笔记 · 一个视频搞懂多租户架构该怎么做? · 17 分钟,讲三种隔离模式和各自的取舍,看完再回头读本篇的 ADR。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV17s4y1J7rG&autoplay=0&high_quality=1" title="阿里工程师带你学技术文档该怎么写" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>阿里技术_AlibabaTech · 阿里工程师带你学技术文档该怎么写 · 30 分钟,大厂里技术方案文档的结构和评审方式,和本篇的八段式对照着看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/e8k6TynqGFs" title="Multi-tenant Architecture for SaaS" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>CodeOpinion · Multi-tenant Architecture for SaaS · 讲租户识别、数据隔离和计算隔离几种做法,英文,语速适中。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/bgHL41e7vgI" title="What Is A Design Doc In Software Engineering? (full example)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Clément Mihailescu · What Is A Design Doc In Software Engineering? (full example) · 前 Google 工程师拿一个完整示例走一遍设计文档,适合第一次认真写文档的人。</figcaption>
</figure>

### 书籍

- **Building Multi-Tenant SaaS Architectures**,Tod Golding,O'Reilly,2024。作者是 AWS 的 SaaS 技术负责人,整本书讲多租户的隔离、身份、计量和运维。今天读第 1 到 3 章(什么是多租户、部署模型、租户身份),约 2 小时。
- **Software Architecture: The Hard Parts**,Neal Ford、Mark Richards、Pramod Sadalage、Zhamak Dehghani,O'Reilly,2021。整本书都在讲取舍分析,和写「考虑过的其他方案」一节直接相关。今天读第 1 章和讲 ADR 的部分。
- **Designing Data-Intensive Applications(第 2 版)**,Martin Kleppmann、Chris Riccomini,O'Reilly,2026。平台的数据面最终都会碰到它讲的问题。今天不用读,Day 99 的持久化运行时会用到它讲事务和一致性的章节。

### 开源项目与代码

- [LiteLLM](https://github.com/BerriAI/litellm):开源的模型网关,Day 97 我们会自己写一个小网关,写之前先看它的 [文档](https://docs.litellm.ai/docs/) 里路由、预算、虚拟 key 几节,知道成熟方案长什么样。
- [The Twelve-Factor App](https://12factor.net/):配置、依赖、进程这几条是 `config.py` 和后面部署的设计依据。

## 自测

1. 你在面试里说「我们做了一个 Agent 平台」,面试官问「为什么要做平台,一个公共库不行吗」,你怎么回答?

<details><summary>答案</summary>

公共库能解决代码复用,解决不了运行时才有的问题。我会举三个只有集中才能做的事:第一,上游密钥统一保管和轮换,租户只拿到可吊销的平台 key;第二,限流和预算要在所有团队的请求汇合处做,库做不到跨进程、跨团队的配额;第三,成本归因和审计要求所有调用经过同一个记录点。然后补一句范围控制:平台不规定 Agent 怎么写,只提供这些基础设施,所以和公共库并不冲突,库可以作为平台的 SDK 存在。

</details>

2. 网关接口里 `model` 字段为什么填 fast、smart 这样的逻辑名?这样做的代价是什么?

<details><summary>答案</summary>

好处是解耦:平台可以根据价格、评测结果、故障情况更换背后的供应商和模型,租户代码不用改。代价有两个:一是租户失去了对具体模型的控制,某些依赖特定模型行为的功能可能在切换后表现变化,所以平台换模型前要跑评测;二是供应商专有的能力很难通过统一接口暴露,需要透传或者暂不支持。

</details>

3. 用 pool 模式做多租户,最大的风险是什么?你在工程上怎么兜底?

<details><summary>答案</summary>

最大的风险是某条查询漏了 tenant_id 过滤,导致一个租户读到另一个租户的数据。兜底方式:所有数据访问走统一的函数,函数签名里强制要求 TenantContext;写专门的跨租户隔离测试,用 A 的 key 去读 B 的每一种资源都必须失败;代码审查清单里加这一条;条件允许时用 Postgres 的行级安全(RLS)做数据库层面的第二道防线。

</details>

4. `usage` 表为什么连失败的上游调用也要记?

<details><summary>答案</summary>

一是失败也可能花钱,超时的请求上游可能已经生成了一部分 token 并计费,不记就对不上账;二是失败率本身是要监控和告警的指标,按租户、按供应商的失败率能帮助判断是租户的问题还是上游的问题;三是故障切换后需要知道切换发生了多少次,`status` 字段里的 fallback_ok 就是为此留的。

</details>

5. 资深面试题:你的设计文档里「考虑过的其他方案」写了「直接部署 LiteLLM」。评审人追问:LiteLLM 已经有路由、预算、虚拟 key,为什么还要自己写?请给出一个站得住的回答,并说明什么情况下你会改主意。

<details><summary>答案</summary>

可以这样回答:第一期我们要的是网关、工具中心、运行时、评测四件事共用同一套租户身份、审计和成本模型,LiteLLM 只覆盖网关这一块,接进来以后租户、key、预算要在两套系统里各维护一份,对账和审计会分裂。第二,我们的网关逻辑本身很薄(路由表、令牌桶、计费),自己写的代码量在几百行级别,维护成本可控,而且能和评测平台联动做路由决策。第三,这是一个可逆的决定:网关对外是 OpenAI 兼容接口,将来换成 LiteLLM 或者其他成熟网关,租户无感。

改主意的条件:如果需要支持的供应商数量超过五六家、各家协议差异大到我们要花大量时间做适配,或者团队没有人能长期维护网关,我会改为部署 LiteLLM,把我们的租户和计费作为它的上层。回答里要体现的是:你知道成熟方案的存在,认真比较过,决定有理由,而且知道什么信号出现时要推翻它。

</details>

6. 资深面试题:验收指标里写了「网关额外延迟 P95 小于 30 毫秒」。为什么要单独测「额外延迟」而不是端到端延迟?你打算怎么测?

<details><summary>答案</summary>

端到端延迟主要由上游模型决定,几百毫秒到几十秒都有,网关自己的开销淹没在里面,看不出网关有没有退化。单独测额外延迟,才能在网关代码改动时发现问题。测法:用一个固定延迟(比如恒定 200 毫秒)的假上游替换真实供应商,压测网关,用网关测到的总耗时减去假上游的固定延迟,统计 P50、P95、P99;同时在网关内部给鉴权、限流、路由、记账各打一个 span,超标时能定位到具体环节。

</details>

## 明天预告

Day 97 · AgentOps(一):模型网关与多租户。我们把今天约定的 `POST /v1/chat/completions` 做出来:价格表和计费、按逻辑路由选供应商、令牌桶限流、月度预算、主供应商出错时切到备用,每一次调用都记进 `usage` 表。全部用假上游测试,一分钱不花。
