---
title: 'Day 82 · 从一个 Agent 到一个平台:多租户 Agent 平台架构'
description: 'SupportPilot 跑顺了,销售、HR、财务都来要一个自己的 Agent。今天讲什么时候该平台化、平台该给什么不该给什么、多租户在数据/配额/密钥/模型四个维度怎么隔离、控制面和数据面怎么拆,以及自建平台和直接上 Dify 的分界线。'
pubDate: 2026-10-12
regime: none
tags: ['platform', 'multi-tenancy', 'architecture', 'agentops', 'agent-60']
series: 'agent-60'
day: 82
lang: 'zh'
---

## 今天要解决的问题

假设你的 SupportPilot 已经上线半年,客服团队很满意。接下来会发生一件几乎每家公司都会遇到的事:销售团队想要一个帮他们整理线索的 Agent,HR 想要一个筛简历的,财务想要一个对账的。最省事的做法是把 SupportPilot 的仓库复制三份,各改各的。

三个月后你会看到这些现象:四个仓库里有四份 LLM 客户端封装,三份已经落后于你修过的那个重试 bug;财务问「上个月模型费用 4 万块,每个部门各花了多少」,没人答得上来,因为四个团队共用一个供应商 key;安全团队发现 prompt injection 的防护只在客服那份代码里修了;还有一个团队把客户手机号原文写进了 trace,而且 trace 保留了一年。

这就是平台化要解决的问题。今天结束时你应该能:

1. 用三个具体信号判断「现在是不是该做平台」,也能说出过早平台化的代价。
2. 列出 Agent 平台该提供的能力清单,并说清哪些东西必须留在业务团队手里。
3. 讲清多租户隔离的四个维度(数据、配额、密钥、模型),以及 silo、pool、bridge 三种部署模型的取舍,会用 Postgres 行级安全(RLS)做数据隔离。
4. 画出控制面和数据面的拆分,说出「控制面挂了数据面还能不能跑」。
5. 判断一个需求该直接上 Dify 这类平台,还是自建一层薄平台。

预计用时 4–5 小时。前置:Day 36(服务化)、Day 37(任务队列)、Day 40(权限与审计)、Day 52–53(SupportPilot 的成本账本和安全加固)。今天开始的 W13 五天都在为进阶毕业项目 AgentOps 平台准备零件,代码放在 `agent-60-lab/w13/`,Day 96 起会搬进 `agentops/` 仓库。

## 什么时候该做平台

平台不是越早做越好。我见过一个团队在只有一个 Agent 的时候就开始写「通用 Agent 平台」,抽象了半年,定义了 Agent、Skill、Workflow、Plugin 四层概念,结果第二个业务方来的时候发现他们的需求套不进任何一层,最后还是自己从头写了。

比较靠谱的判断方式是看三个信号,出现两个就该认真考虑了。

**第三个团队来要同样的东西。** 第一个团队做的时候你不知道哪些是通用的,第二个团队来的时候你开始有感觉,第三个团队来的时候,共同部分才算看清楚。软件工程里有个老说法叫「三次法则」,第三次重复的时候再抽象,放在平台上同样成立。

**同一个修复要改 N 遍。** 比如 Day 39 讲的间接注入防护、Day 40 的 PII 脱敏、模型供应商换了 API 版本,只要这类修复要在多个仓库里各改一遍,就说明这些能力本来就该是共享的。安全类修复尤其危险,漏掉一个仓库就是一个洞。

**有人要按部门分账或者统一管控。** 财务要分摊成本、法务要统一审核数据出境、安全要统一审计谁调用了什么工具。这类需求本质上是「一个控制点」,分散在各个团队里是做不出来的。

反过来,如果只有一两个 Agent、团队都在一个组里、成本也不大,那就别急着做平台,把 SupportPilot 的代码整理成一个内部 Python 包让别人 `uv add` 进去,收益已经很大了。

公开的案例也大多是这个节奏。Uber 在 2024 年写过他们的 GenAI Gateway,当时公司内部已经有 60 多个大模型用例,才做了一个统一网关来处理鉴权、缓存、观测和数据安全审查([InfoQ 的报道](https://www.infoq.com/news/2024/09/uber-genai-gateway-llm-openai/))。LinkedIn 讲他们的 GenAI 平台时也说,早期每个产品团队都自己搭提示词管理、模型调用、会话记忆这些脚手架,后来才收敛成编排、提示词、工具与技能、内容与记忆四块共享能力(下面的视频里有完整讲述)。两家都是先有一堆重复,再有平台。

## 平台到底给什么

一个常见的误解是「平台 = 一个能拖拽搭 Agent 的界面」。界面是可选的,平台真正的价值在于把那些每个 Agent 都需要、而且做错了代价很大的东西集中做好。我把它分成七块:

| 能力 | 平台负责 | 业务团队负责 |
| --- | --- | --- |
| 模型访问 | 统一网关、虚拟 key、限流、预算、故障切换、成本归因(Day 83) | 选哪个模型组、每次调用的参数 |
| 工具 | 工具注册、鉴权、权限审计、MCP 网关(Day 84) | 自己业务的工具实现 |
| 运行时 | Agent 循环、持久化执行、人工审批、超时与重试(W10 已讲) | 工作流逻辑、提示词 |
| 知识与记忆 | 向量库、切块与检索服务、记忆存储,按租户隔离 | 往知识库里放什么文档 |
| 评测 | 评测框架、judge 服务、回归门禁、线上 A/B(W11 已讲) | 写自己的测试集和判分标准 |
| 可观测 | trace 管道、采样、指标、看板、告警(Day 85) | 看自己的看板,定自己的 SLO |
| 治理 | 数据分级、留存、审计、合规检查(Day 86) | 遵守规则,申报新数据类型 |

注意右边那一列。提示词、业务工具、测试集这三样东西必须留在业务团队手里,因为只有他们懂业务。平台团队如果连提示词都要管,很快就会变成所有 Agent 改动的瓶颈,业务方改一句话要排两周的期。

Team Topologies 这本书里有个说法叫「最薄可用平台」(thinnest viable platform):平台应该是能让业务团队加速的最小那一层,有时候甚至只是一份文档加几个共享库。Evan Bottcher 那篇被引用很多的文章《What I talk about when I talk about platforms》也是这个意思:平台是一组自助服务的 API、工具和知识,目标是让业务团队少依赖平台团队,而不是更多。

## 多租户:先想清楚租户是谁

「租户」这个词在 Agent 平台里有两种完全不同的含义,很多设计混乱都是因为没分清。

第一种是**内部租户**:平台服务公司内部的多个业务团队,客服是一个租户,销售是一个租户。这种情况下租户之间不太会恶意攻击彼此,主要矛盾是成本分摊、配额争抢和数据权限(HR 的简历数据不该被销售的 Agent 检索到)。

第二种是**外部租户**:你把 SupportPilot 做成 SaaS 卖给其他公司,每个客户公司是一个租户。这时候租户隔离就是安全底线了,A 公司的知识库内容出现在 B 公司的回复里,是能上新闻的事故。

很多真实系统是两层叠在一起的:组织(org)下面有项目(project),项目下面才有最终用户。设计数据模型的时候,我建议从一开始就让所有表都带 `tenant_id`,哪怕现在只有一个租户。后补租户字段的迁移是我做过最痛苦的那类迁移之一,因为你得逐个排查每一条查询有没有漏加条件。

## 隔离的四个维度

隔离不只是「数据分开存」。一个多租户 Agent 平台至少要在四个维度上隔离:

**数据。** 知识库、会话历史、长期记忆、trace、评测集,这五类都含租户数据。其中最容易漏的是后两个:trace 里有完整的 prompt 和回复,评测集经常是从线上 trace 里挑出来的。还有一个隐蔽的地方是**缓存**:如果你在网关做了响应缓存,缓存 key 里没有租户 ID,那 A 租户问过的问题,B 租户问同样的问题时就会拿到 A 的答案,答案里可能带着 A 的客户信息。

**配额。** 一个租户跑批处理,一下子发了一万张工单,把供应商那边的速率限制吃满,其他所有租户都开始收到 429。这叫「吵闹的邻居」(noisy neighbor)。解决办法是每个租户有自己的 token 限流和并发上限,明天讲网关时会写代码。

**密钥。** 有两种模式:平台统一持有供应商 key,按租户分账;或者租户自带 key(BYOK,bring your own key),平台只是代为调用。外部 SaaS 的大客户经常要求 BYOK,因为他们和模型供应商签了自己的数据协议。平台要能同时支持两种,而且租户自带的 key 要加密存储,日志里不能出现。

**模型。** 不同租户能用的模型不一样。财务租户的数据不允许出境,只能用国内已备案的模型;某个外部客户合同里写了「不允许使用某供应商」。这些规则要在网关的路由层强制执行,不能靠业务方自觉。

## 三种部署模型:silo、pool、bridge

AWS 在 SaaS 架构的资料里把多租户部署分成三种模型,这套叫法现在业内用得很普遍:

- **Silo(独立)**:每个租户一套独立的资源,独立的数据库、独立的 worker、甚至独立的网关实例。隔离最彻底,但成本高,运维要管 N 套东西,升级要升 N 遍。
- **Pool(共享)**:所有租户共用一套资源,靠应用层的 `tenant_id` 和数据库的行级安全来隔离。成本最低,运维最简单,但隔离靠代码正确性,一个漏写的 WHERE 条件就是事故。
- **Bridge(混合)**:按资源类型或按租户等级混用。比如计算层共享、数据库按租户分 schema;或者普通租户 pool、付了钱的大客户 silo。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="三种多租户部署模型对比:silo 每个租户独立资源,pool 共享资源靠 tenant_id 隔离,bridge 普通租户共享、大客户独立">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <text x="105" y="26" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">silo</text>
  <text x="320" y="26" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">pool</text>
  <text x="535" y="26" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">bridge</text>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="20" y="44" width="50" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="45" y="68" text-anchor="middle" fill="var(--ink)">A</text>
    <rect x="80" y="44" width="50" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="105" y="68" text-anchor="middle" fill="var(--ink)">B</text>
    <rect x="140" y="44" width="50" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="165" y="68" text-anchor="middle" fill="var(--ink)">C</text>
    <rect x="20" y="96" width="50" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="45" y="120" text-anchor="middle" fill="var(--ink)">DB A</text>
    <rect x="80" y="96" width="50" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="105" y="120" text-anchor="middle" fill="var(--ink)">DB B</text>
    <rect x="140" y="96" width="50" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="165" y="120" text-anchor="middle" fill="var(--ink)">DB C</text>
    <rect x="250" y="44" width="140" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="320" y="68" text-anchor="middle" fill="var(--ink)">共享 worker A B C</text>
    <rect x="250" y="96" width="140" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="320" y="114" text-anchor="middle" fill="var(--ink)">共享 DB</text><text x="320" y="128" text-anchor="middle" fill="var(--ink-soft)">tenant_id + RLS</text>
    <rect x="450" y="44" width="80" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="490" y="68" text-anchor="middle" fill="var(--ink)">共享 A B</text>
    <rect x="540" y="44" width="80" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="580" y="68" text-anchor="middle" fill="var(--ink)">大客户 C</text>
    <rect x="450" y="96" width="80" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="490" y="120" text-anchor="middle" fill="var(--ink)">共享 DB</text>
    <rect x="540" y="96" width="80" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="580" y="120" text-anchor="middle" fill="var(--ink)">DB C</text>
  </g>
  <line x1="215" y1="40" x2="215" y2="230" stroke="var(--rule)"/>
  <line x1="425" y1="40" x2="425" y2="230" stroke="var(--rule)"/>
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">
    <text x="105" y="166" text-anchor="middle">隔离最强</text><text x="105" y="184" text-anchor="middle">成本 x N</text><text x="105" y="202" text-anchor="middle">升级 N 遍</text>
    <text x="320" y="166" text-anchor="middle">成本最低</text><text x="320" y="184" text-anchor="middle">一个漏写的 WHERE</text><text x="320" y="202" text-anchor="middle">就是事故</text>
    <text x="535" y="166" text-anchor="middle">按租户等级混用</text><text x="535" y="184" text-anchor="middle">最常见的终态</text><text x="535" y="202" text-anchor="middle">复杂度在路由层</text>
  </g>
</svg>
<figcaption>三种部署模型。蓝色是计算层(worker、Agent 运行时),琥珀色是数据层。真实平台多数会走到 bridge:默认 pool,合规要求高或付费高的租户单独 silo。</figcaption>
</figure>

我的建议是**默认 pool,数据库层用 RLS 兜底,给 silo 留好口子**。原因很实际:内部平台的租户一般不超过几十个,silo 带来的运维成本远大于收益;但总有那么一两个租户(财务、法务、或者某个大客户)会要求物理隔离,所以租户配置里要有一个「部署模式」字段,路由层根据它把请求发到共享集群或专属集群。

Pool 模式最大的风险是「应用层忘了加租户条件」。只靠代码审查防不住,因为查询会越来越多,总有人忘。数据库层的行级安全能兜住这一类错误:就算应用层的 SQL 没写 `WHERE tenant_id = ?`,数据库也只会返回当前租户的行。下面看具体怎么做。

## 用 Postgres 行级安全兜底

Postgres 的 RLS(row-level security)允许你在表上定义一条策略,每一次查询都会被自动加上这个过滤条件。配合一个「当前请求属于哪个租户」的会话变量,就能实现数据库级别的租户隔离。

```sql
-- agent-60-lab/w13/tenancy/schema.sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE kb_chunks (
    id         bigserial PRIMARY KEY,
    tenant_id  text NOT NULL,
    doc_id     text NOT NULL,
    content    text NOT NULL,
    embedding  vector(1024)
);
CREATE INDEX ON kb_chunks (tenant_id, doc_id);

ALTER TABLE kb_chunks ENABLE ROW LEVEL SECURITY;
-- 表的 owner 默认不受 RLS 约束,FORCE 让 owner 也受约束
ALTER TABLE kb_chunks FORCE ROW LEVEL SECURITY;

-- current_setting 第二个参数 true:变量没设置时返回 NULL 而不是报错。
-- NULL 和任何值比较都不成立,所以忘了设租户 = 一行都看不到,而不是看到全部。
CREATE POLICY tenant_isolation ON kb_chunks
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- 应用用一个普通角色连库。超级用户和带 BYPASSRLS 属性的角色会无视所有策略,
-- 应用千万别用它们连。
CREATE ROLE agent_app LOGIN PASSWORD 'change-me';
GRANT SELECT, INSERT, UPDATE, DELETE ON kb_chunks TO agent_app;
GRANT USAGE ON SEQUENCE kb_chunks_id_seq TO agent_app;
```

`USING` 管读(SELECT、UPDATE 和 DELETE 能看到哪些行),`WITH CHECK` 管写(INSERT 和 UPDATE 写进去的行必须满足条件)。只写 `USING` 的话,租户 A 的代码可以插入一行 `tenant_id = 'B'` 的数据,虽然 A 看不到它,但 B 的知识库里就被塞了一条东西。这是一个很常见的漏洞。

应用层怎么设置这个变量是另一个坑。连接池里的连接会被不同请求复用,如果你用 `SET app.tenant_id = 'A'`,这个设置会一直留在这条连接上,下一个请求拿到这条连接,如果它恰好忘了设置,就会以 A 的身份查询。正确的做法是在**事务内**用 `set_config(..., true)`,第三个参数 `true` 表示只在当前事务生效,事务结束自动失效:

```python
# agent-60-lab/w13/tenancy/db.py
# uv add "psycopg[binary]" psycopg-pool
import contextvars
from contextlib import contextmanager

from psycopg_pool import ConnectionPool

current_tenant: contextvars.ContextVar[str] = contextvars.ContextVar("current_tenant")

pool = ConnectionPool(conninfo="postgresql://agent_app:change-me@localhost:5432/agentops", open=False)


@contextmanager
def tenant_tx():
    """所有业务查询都必须在这里面做。拿不到租户就直接报错,而不是默默查全表。"""
    tenant = current_tenant.get()          # 没设置会抛 LookupError
    with pool.connection() as conn, conn.transaction():
        conn.execute("SELECT set_config('app.tenant_id', %s, true)", (tenant,))
        yield conn


def search_chunks(doc_id: str) -> list[tuple]:
    with tenant_tx() as conn:
        # 注意:这里故意没写 tenant_id 条件,RLS 会替我们加上
        return conn.execute("SELECT id, content FROM kb_chunks WHERE doc_id = %s", (doc_id,)).fetchall()
```

在 FastAPI 里,租户身份来自鉴权中间件(API key 或 JWT 里的 claim),中间件里 `current_tenant.set(...)`,之后同一个请求里的所有数据库访问自动带上租户。`contextvars` 对 asyncio 是安全的,每个请求有自己的上下文,不会串。

有两点要清醒地认识到。第一,RLS 是兜底,不是替代:应用层的查询仍然应该显式带上租户条件,因为这样查询计划能用上 `(tenant_id, doc_id)` 索引,而且代码读起来意图清楚。第二,RLS 只管 Postgres 里的数据。如果你的向量库是独立的 Milvus 或 Qdrant,要用它们的 collection/partition 或者 payload 过滤来做隔离,同样要在一个统一的数据访问层里强制,不能让业务代码直接拿着客户端去查。

## 控制面和数据面

平台的组件按职责可以分成两类。**控制面**(control plane)负责「配置和管理」:租户和项目的增删改、Agent 定义和版本、提示词版本、工具注册和授权、密钥管理、预算设置、计费报表。**数据面**(data plane)负责「每一次请求的执行」:模型网关、Agent 运行时 worker、工具调用、trace 采集管道。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="控制面和数据面的拆分:控制面管理租户、Agent 定义、工具注册、密钥和预算,把配置下发到数据面;数据面包含网关、运行时、工具中心和 trace 管道,处理每一次请求">
  <rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
  <rect x="20" y="20" width="600" height="96" rx="6" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
  <text x="34" y="40" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">控制面:改得少,可以慢,但要可审计</text>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="34" y="54" width="104" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/><text x="86" y="81" text-anchor="middle" fill="var(--ink)">租户/项目</text>
    <rect x="150" y="54" width="104" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/><text x="202" y="74" text-anchor="middle" fill="var(--ink)">Agent 定义</text><text x="202" y="90" text-anchor="middle" fill="var(--ink-soft)">prompt 版本</text>
    <rect x="266" y="54" width="104" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/><text x="318" y="74" text-anchor="middle" fill="var(--ink)">工具注册</text><text x="318" y="90" text-anchor="middle" fill="var(--ink-soft)">授权策略</text>
    <rect x="382" y="54" width="104" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/><text x="434" y="74" text-anchor="middle" fill="var(--ink)">密钥</text><text x="434" y="90" text-anchor="middle" fill="var(--ink-soft)">预算/配额</text>
    <rect x="498" y="54" width="104" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/><text x="550" y="81" text-anchor="middle" fill="var(--ink)">账单报表</text>
  </g>
  <line x1="320" y1="116" x2="320" y2="150" stroke="var(--ink-faint)" stroke-width="1.5"/>
  <polygon points="314,144 326,144 320,154" fill="var(--ink-faint)"/>
  <text x="332" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">配置快照下发,数据面本地缓存</text>
  <rect x="20" y="160" width="600" height="150" rx="6" fill="none" stroke="var(--rule)"/>
  <text x="34" y="180" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">数据面:每个请求都经过,要快,要能在控制面挂掉时继续跑</text>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="34" y="196" width="130" height="50" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="99" y="218" text-anchor="middle" fill="var(--ink)">模型网关</text><text x="99" y="234" text-anchor="middle" fill="var(--ink-soft)">Day 83</text>
    <rect x="178" y="196" width="130" height="50" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="243" y="218" text-anchor="middle" fill="var(--ink)">Agent 运行时</text><text x="243" y="234" text-anchor="middle" fill="var(--ink-soft)">W10</text>
    <rect x="322" y="196" width="130" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="387" y="218" text-anchor="middle" fill="var(--ink)">工具中心</text><text x="387" y="234" text-anchor="middle" fill="var(--ink-soft)">Day 84</text>
    <rect x="466" y="196" width="140" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="536" y="218" text-anchor="middle" fill="var(--ink)">知识库/记忆</text><text x="536" y="234" text-anchor="middle" fill="var(--ink-soft)">按租户隔离</text>
    <rect x="34" y="258" width="572" height="36" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/><text x="320" y="281" text-anchor="middle" fill="var(--ink)">trace / 指标 / 用量 管道 (Day 85) -&gt; 回流到控制面的账单和看板</text>
  </g>
</svg>
<figcaption>控制面和数据面。控制面把配置做成快照推给数据面,数据面本地缓存;控制面短暂不可用时,已有的 Agent 照常服务,只是不能改配置。</figcaption>
</figure>

拆开的核心原因是**两者的可用性要求和变化频率完全不同**。数据面每秒处理很多请求,一分钟不可用就是一分钟所有 Agent 停摆;控制面一天可能只被调用几十次(有人改了个 prompt 版本),它挂五分钟大多数人都不会注意到。如果两者混在一个服务里,控制面一次有 bug 的发布就能把数据面一起带走。

具体落地时有一条很重要的原则:**数据面不能在请求路径上同步调用控制面**。比如网关处理每个请求时都去控制面问一次「这个 key 对应哪个租户、预算还剩多少」,那控制面就成了数据面的单点。正确的做法是控制面把配置做成版本化的快照,数据面定期拉取(或者订阅变更)并缓存在本地内存,请求路径上只查本地。预算这种需要实时性的数据,在数据面用 Redis 之类的共享存储累计,控制面只负责设上限。

这里有个取舍:配置下发有延迟,比如你在控制面把某个租户的预算调成 0,数据面可能要过 30 秒才生效。对于紧急情况(Day 87 会讲的 kill switch),要么缩短拉取间隔,要么提供一条单独的「推送」通道。

## 中间件放在哪:Redis、队列、检索库和对象存储

国内 JD 里经常一口气列出「熟悉 Redis、Kafka、Milvus、ES」,第一次看会以为 Agent 平台要把这些全装上。其实每一样都对应一个具体的问题,问题没出现就不用引入。SupportPilot 一直只用 Postgres(加 pgvector)一个库,单租户、几十个并发完全够;到了多租户平台,下面这几样会陆续进来。先看它们在哪个位置:

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="Agent 平台里的中间件位置:请求经过网关和运行时,Redis 管限流计数、会话和缓存;队列连接 API 和后台 worker 以及 trace 管道;检索库服务知识库和记忆;对象存储放文件和大载荷;OLAP 存 trace 分析">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="11">
<rect x="20" y="30" width="110" height="40" rx="4" fill="none" stroke="var(--rule)"/><text x="75" y="55" text-anchor="middle" fill="var(--ink)">客户端/渠道</text>
<line x1="130" y1="50" x2="170" y2="50" stroke="var(--ink-faint)"/>
<rect x="170" y="30" width="120" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="230" y="55" text-anchor="middle" fill="var(--ink)">API / 模型网关</text>
<line x1="290" y1="50" x2="330" y2="50" stroke="var(--ink-faint)"/>
<rect x="330" y="30" width="130" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="395" y="55" text-anchor="middle" fill="var(--ink)">Agent 运行时 worker</text>
<line x1="460" y1="50" x2="500" y2="50" stroke="var(--ink-faint)"/>
<rect x="500" y="30" width="120" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="560" y="55" text-anchor="middle" fill="var(--ink)">工具 / MCP</text>
<rect x="170" y="110" width="120" height="50" rx="4" fill="none" stroke="var(--ink-faint)"/><text x="230" y="131" text-anchor="middle" fill="var(--ink)">Redis</text><text x="230" y="148" text-anchor="middle" fill="var(--ink-soft)">限流 会话 缓存</text>
<line x1="230" y1="70" x2="230" y2="110" stroke="var(--rule)"/>
<rect x="20" y="110" width="130" height="50" rx="4" fill="none" stroke="var(--ink-faint)"/><text x="85" y="131" text-anchor="middle" fill="var(--ink)">队列</text><text x="85" y="148" text-anchor="middle" fill="var(--ink-soft)">Redis/RabbitMQ/Kafka</text>
<path d="M170 60 Q120 85 100 110" fill="none" stroke="var(--rule)"/>
<path d="M150 135 Q260 95 360 70" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<rect x="330" y="110" width="130" height="50" rx="4" fill="none" stroke="var(--ink-faint)"/><text x="395" y="131" text-anchor="middle" fill="var(--ink)">检索库</text><text x="395" y="148" text-anchor="middle" fill="var(--ink-soft)">pgvector/Milvus/ES</text>
<line x1="395" y1="70" x2="395" y2="110" stroke="var(--rule)"/>
<rect x="490" y="110" width="130" height="50" rx="4" fill="none" stroke="var(--ink-faint)"/><text x="555" y="131" text-anchor="middle" fill="var(--ink)">Postgres</text><text x="555" y="148" text-anchor="middle" fill="var(--ink-soft)">业务 配置 checkpoint</text>
<line x1="440" y1="70" x2="520" y2="110" stroke="var(--rule)"/>
<rect x="20" y="210" width="290" height="50" rx="4" fill="none" stroke="var(--ink-faint)"/><text x="165" y="231" text-anchor="middle" fill="var(--ink)">对象存储(S3/OSS/MinIO)</text><text x="165" y="248" text-anchor="middle" fill="var(--ink-soft)">上传文件 大工具结果 trace 原始事件</text>
<rect x="330" y="210" width="290" height="50" rx="4" fill="none" stroke="var(--ink-faint)"/><text x="475" y="231" text-anchor="middle" fill="var(--ink)">OLAP(ClickHouse 等)</text><text x="475" y="248" text-anchor="middle" fill="var(--ink-soft)">trace 分析 成本看板 评测分数</text>
<line x1="85" y1="160" x2="85" y2="210" stroke="var(--rule)" stroke-dasharray="4 3"/>
<line x1="150" y1="150" x2="400" y2="210" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="20" y="288" fill="var(--ink-faint)">实线:请求路径上同步调用;虚线:异步事件流</text>
</g>
</svg>
<figcaption>Agent 平台里常见中间件的位置。请求路径上只有网关、运行时、Redis、检索库和 Postgres;队列、对象存储和 OLAP 都在异步那一侧,出了问题不该直接卡住用户的请求。</figcaption>
</figure>

| 中间件 | 在 Agent 平台里干什么 | 什么时候引入 |
| --- | --- | --- |
| Redis(或 Valkey) | 按租户和 key 的限流计数、预算累计(上一节说的数据面实时数据);会话和短期状态缓存;语义缓存;分布式锁(同一张工单不能被两个 worker 同时处理);轻量任务队列 | 有了第二个应用实例就该上。单实例时内存里计数就行,多实例不共享计数,限流就形同虚设 |
| 队列(Redis Streams/RabbitMQ/SQS,规模大了 Kafka) | API 收到请求后把长任务交给后台 worker(Day 37、Day 65);webhook、邮件这类事件触发;trace、用量、计费事件送到下游 | 有跑超过几十秒的任务,或者一个事件要被多个下游消费(计费、看板、告警)时。Kafka 的优势是多消费者、可回放、吞吐高,代价是运维重,事件量没到每秒几千条之前,Redis Streams 或云上托管队列更省事 |
| 检索库(pgvector → Milvus/Qdrant/ES/OpenSearch) | 知识库检索、长期记忆检索、工具检索 | 先用 pgvector,和业务数据一个库、能用 RLS 做隔离。向量量级到千万级、检索 QPS 很高,或者要按租户分别扩容时,再考虑独立的向量库;公司本来就有 ES 集群而且要 BM25 加向量的混合检索,ES 是顺手的选择。门槛以你自己的压测为准,别照搬别人的数字 |
| 对象存储(S3、阿里云 OSS、自建 MinIO) | 用户上传的 PDF 和图片;超大的工具结果(只在上下文里放摘要和引用,原文放这里,Day 63 讲过);trace 原始事件;评测快照和导出 | 一开始就该有。大文件塞 Postgres 或者塞进 trace 本身,库会很快膨胀 |
| OLAP(ClickHouse 等) | trace、观测数据、评测分数、成本的分析查询 | trace 一天几百万条、按租户和模型聚合的看板查询开始拖慢 Postgres 时 |

一个很好的参照是 Langfuse 的自托管架构(2026 年 10 月看的是 v4 文档):Postgres 放事务数据,ClickHouse 放 trace、observation 和评分,Redis/Valkey 兼做缓存和队列,S3 一类的对象存储放所有进来的原始事件、多模态输入和大导出,worker 从队列里取任务异步处理,队列里只放引用,数据本身在对象存储里。这正好是上面这张表的一个缩小版,而且它同样没用 Kafka。

面试被问「你为什么用了 Kafka」时,最好的回答是讲出那个让你不得不用它的问题;最差的回答是「因为大家都用」。反过来,被问「为什么不用 Milvus」,能说出「数据量多少、QPS 多少、pgvector 压测结果怎样、隔离靠 RLS」就是加分项。

## 平台 API 设计

平台对外的 API 决定了业务团队怎么用它。我建议资源模型从这几个开始,别一上来就设计二十个:

| 资源 | 是什么 | 例子 |
| --- | --- | --- |
| Tenant / Project | 租户和它下面的项目,配额和预算挂在这里 | `support/refund` |
| Agent | 一个 Agent 的定义:模型组、提示词版本、绑定的工具、记忆配置、评测集 | `refund-agent@v14` |
| Run | 一次执行,有状态(运行中、等待审批、完成、失败) | `run_8f2a...` |
| ToolBinding | 某个 Agent 被授权使用哪些工具,到哪个风险级别 | `billing.get_invoice:read` |
| Secret | 租户自带的密钥,只能写不能读 | `byok/openai` |

一个 Agent 的定义大致长这样:

```yaml
# agent-60-lab/w13/tenancy/refund-agent.yaml
apiVersion: agentops/v1
kind: Agent
metadata:
  tenant: support
  project: refund
  name: refund-agent
spec:
  version: 14
  modelGroup: smart                 # 只写组名,具体用哪家由网关决定(Day 83)
  prompt: prompts/refund@v14        # 提示词在仓库里管,这里只引用版本
  tools:
    - billing.get_invoice           # 来自工具中心的登记名(Day 84)
    - billing.create_refund         # 高风险工具,运行时自动走人工审批
  memory: {customerProfile: true, retentionDays: 365}
  evals: {suite: refund-regression, gate: "pass_rate >= 0.92"}
  rollout: {strategy: canary, percent: 10}
```

这里有一个在平台设计里经常吵架的问题:**Agent 应该是配置还是代码?** 配置化(上面那种 YAML)的好处是平台能理解和管控每一个 Agent,改模型、改工具不用发版;代码化(业务团队写 Python,平台提供 SDK 和运行环境,类似 serverless)的好处是表达能力没有上限。

我的观点是,内部平台走「代码优先,配置做元数据」比较稳。真实的 Agent 很快就会出现配置表达不了的逻辑,比如「金额超过 500 先查一下这个客户近三个月的退款次数」,硬塞进配置就会发明出一套蹩脚的 DSL。比较合理的分工是:业务逻辑写成代码,用平台 SDK 调网关、工具中心和记忆服务;模型组、工具授权、预算、灰度比例这些「管控相关」的东西放在配置里,由控制面管。这样平台该管的都管得住,业务方也不会被框死。

## 自建平台还是直接上 Dify

Dify、Coze(扣子)这类平台本身就是多租户的 Agent 应用平台:有工作空间、可视化工作流、知识库、模型供应商管理,Dify 还是开源可以自部署的。很多人会问:那我还自己做平台干什么?

这两者解决的问题其实不同。Dify 这类平台的核心用户是**想自己拼 Agent 的业务人员和产品经理**,优势是上手快、拖拽就能出东西。你自建的平台核心用户是**写代码交付 Agent 的工程团队**,要的是评测门禁、细粒度的权限和审计、成本归因、灰度发布、和公司现有系统(身份、监控、数据平台)的深度集成。

| 需求 | 更适合 |
| --- | --- |
| 业务人员自己做内部问答、文档助手,数量多但每个都不复杂 | 直接部署 Dify,接公司 SSO |
| 面向客户的 Agent,要评测、审批、审计、成本按部门分摊 | 自建薄平台,复用开源组件 |
| 两种都有 | 两个都要:Dify 接自建的模型网关和工具中心,共享底层管控 |

第三种其实很常见,也是我比较推荐的形态:不管业务人员用 Dify 拼的,还是工程团队写代码的,都走同一个模型网关(统一分账、统一限流)和同一个工具中心(统一授权、统一审计)。上层用什么搭 Agent 可以多样,底层的管控只有一份。

自建也不意味着从零写。网关可以用 LiteLLM 或 Higress,观测可以用 Langfuse,工具网关有 agentgateway 这类开源项目,明天和后天会逐个讲。你真正要自己写的,通常只有把这些拼起来的那一层薄薄的胶水,加上和公司身份系统、计费系统的对接。

## 平台团队最常犯的错

最后说几个我观察到的坑,这些比技术选型更决定平台的成败。

为想象中的用户设计。平台团队坐在一起讨论「将来可能会有这种需求」,做出了一堆没人用的功能,而现有用户真正卡住的问题(比如「我的 Agent 为什么昨天成本翻倍了」)没人管。平台应该当成产品来做,有用户访谈、有使用数据、有路线图。

强制迁移。平台做好了,发通知说「下个季度所有 Agent 必须迁到平台上」。业务团队会觉得这是在给他们添活。更好的做法是让平台的好处足够明显:接了网关就自动有成本看板,接了工具中心就自动通过安全审计,让大家主动来。

抽象泄漏。平台封装了模型调用,但某个模型有个特殊参数(比如推理强度),平台的接口里没有,业务方没法用。每一层封装都要留逃生口,比如允许透传供应商特有的参数。

平台本身没有 SLO。平台成了所有 Agent 的依赖,它的可用性和延迟直接影响所有业务。平台团队要给自己定 SLO,而且要比业务方的 SLO 更严,这一点 Day 85 会展开。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/n9rjuBuShko" title="Building LinkedIn's GenAI Platform — Xiaofeng Wang" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · Building LinkedIn's GenAI Platform — Xiaofeng Wang · 18 分钟。LinkedIn 讲他们怎么从各团队各搭脚手架,收敛到编排、提示词、工具与技能、内容与记忆四块共享能力,以及为什么从 Java 转向 Python。正好对照今天的「平台给什么」那张表。</figcaption>
</figure>

## 动手练习

今天的产出物有两个:一份平台提案,和一个能证明 RLS 隔离有效的测试。

**第一步:写平台提案(1.5–2 小时)。** 假设你所在的公司有 SupportPilot(客服)、一个销售线索 Agent、一个 HR 简历筛选 Agent。用下面的结构写一份两页以内的提案,放在 `agent-60-lab/w13/tenancy/proposal.md`:

1. 现状和问题:列出至少三个由重复建设导致的具体问题,每个问题给出可以量化的影响(比如「同一个注入防护修复改了 3 个仓库,其中 1 个漏改了 2 周」)。
2. 平台范围:用今天那张七行的表,标出第一个季度做哪几块、不做哪几块,不做的写清楚原因。
3. 租户模型:租户是谁、几层、默认 pool 还是 silo、哪个租户要 silo 以及为什么。
4. 架构图:控制面和数据面各有哪些组件,配置怎么下发,控制面挂了会怎样。
5. 非目标:至少写三条「这个平台不做什么」。

**第二步:搭 RLS 环境并写隔离测试(1.5 小时)。** 本机需要 Docker:

```bash
docker run -d --name agentops-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 pgvector/pgvector:pg17
docker exec -i agentops-pg psql -U postgres -c "CREATE DATABASE agentops"
docker exec -i agentops-pg psql -U postgres -d agentops < agent-60-lab/w13/tenancy/schema.sql
```

然后写测试:

```python
# agent-60-lab/w13/tenancy/test_rls.py
# uv add --dev pytest "psycopg[binary]"
import os

import psycopg
import pytest

DSN = os.environ.get("AGENT_APP_DSN", "postgresql://agent_app:change-me@localhost:5432/agentops")


def as_tenant(conn: psycopg.Connection, tenant: str | None) -> None:
    if tenant is not None:
        conn.execute("SELECT set_config('app.tenant_id', %s, true)", (tenant,))


@pytest.fixture
def conn():
    with psycopg.connect(DSN) as c:
        yield c
        c.rollback()          # 每个测试结束回滚,不留脏数据


def test_tenant_sees_only_own_rows(conn):
    as_tenant(conn, "support")
    conn.execute("INSERT INTO kb_chunks (tenant_id, doc_id, content) VALUES ('support', 'kb-002', '退款政策')")
    as_tenant(conn, "sales")
    conn.execute("INSERT INTO kb_chunks (tenant_id, doc_id, content) VALUES ('sales', 'kb-002', '报价单模板')")
    rows = conn.execute("SELECT content FROM kb_chunks WHERE doc_id = 'kb-002'").fetchall()
    assert rows == [("报价单模板",)]


def test_no_tenant_means_no_rows(conn):
    as_tenant(conn, "support")
    conn.execute("INSERT INTO kb_chunks (tenant_id, doc_id, content) VALUES ('support', 'kb-009', 'x')")
    conn.commit()             # 提交后 set_config(…, true) 失效,相当于「忘了设租户」
    assert conn.execute("SELECT count(*) FROM kb_chunks").fetchone()[0] == 0
    with conn.transaction():  # 清理
        as_tenant(conn, "support")
        conn.execute("DELETE FROM kb_chunks WHERE doc_id = 'kb-009'")


def test_cannot_write_into_other_tenant(conn):
    as_tenant(conn, "support")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        conn.execute("INSERT INTO kb_chunks (tenant_id, doc_id, content) VALUES ('sales', 'x', '偷塞一条')")
```

运行 `uv run pytest -q agent-60-lab/w13/tenancy/test_rls.py`。

**第三步:故意弄坏一次。** 把策略里的 `WITH CHECK` 那一行删掉,重建表,再跑测试,看哪个测试会失败;再试着用 `postgres` 超级用户连库跑一遍,观察 RLS 是不是完全失效。把两次观察写进提案的「风险」一节。

**验收标准:**

- 三个测试全部通过,而且你能解释每个测试防的是哪一类真实事故。
- 提案里有部署模型的选择和理由、控制面和数据面的组件清单、至少三条非目标。
- 能回答:如果把 `set_config` 的第三个参数改成 `false`,在连接池环境下会出什么问题。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 多租户(multi-tenancy) | 一套系统同时服务多个相互隔离的使用方(租户),租户之间看不到彼此的数据 |
| 租户(tenant) | 平台上的一个隔离单位,内部平台通常是业务团队,外部 SaaS 通常是客户公司 |
| silo / pool / bridge | 三种多租户部署模型:每租户独立资源 / 全部共享 / 按资源或租户等级混用 |
| 吵闹的邻居(noisy neighbor) | 一个租户占用过多共享资源,导致其他租户性能下降或被限流 |
| RLS(row-level security) | 数据库的行级安全策略,每次查询自动加上过滤条件,只返回当前身份能看的行 |
| BYOK(bring your own key) | 租户使用自己和模型供应商签约的 API key,平台代为调用 |
| 控制面(control plane) | 管理配置的那部分系统:租户、Agent 定义、授权、密钥、预算 |
| 数据面(data plane) | 处理每一次请求的那部分系统:网关、运行时、工具调用、trace 管道 |
| 最薄可用平台(thinnest viable platform) | Team Topologies 的概念,平台只做能让业务团队加速的最小那一层 |
| 配置快照 | 控制面把当前配置打包成带版本号的只读副本下发,数据面本地缓存使用 |
| OLAP | 面向分析查询的数据库(如 ClickHouse),适合对海量 trace 做按租户、模型的聚合 |
| 对象存储 | S3、OSS、MinIO 这类按 key 存大文件的服务,便宜、容量几乎无限,不适合频繁小改 |

## 常见误区

**只有一个 Agent 的时候就开始做「通用平台」。** 这时候你还不知道哪些部分是通用的,抽象出来的概念大概率套不进第二个业务。先把代码整理成可复用的包,等第三个需求出现再抽象。

**只在应用层做租户隔离,靠代码审查保证每条 SQL 都带 `tenant_id`。** 查询越来越多之后,总会有人漏。数据库层的 RLS 是成本很低的兜底,而且它的默认行为(没设租户就一行都看不到)是安全的。

**RLS 策略只写 `USING` 不写 `WITH CHECK`。** 这样只防住了读,没防住写。租户 A 的代码可以往 B 的数据里插行,这类问题往往在很久以后才被发现。

**用超级用户或表的 owner 连库。** 超级用户无视所有 RLS 策略,owner 在没有 `FORCE ROW LEVEL SECURITY` 时也不受约束。应用必须用一个普通角色连库。

**数据面每个请求都同步问控制面。** 控制面成了单点,它一抖所有 Agent 跟着抖。配置要做成快照下发,数据面本地缓存。

**忘了缓存和评测集也有租户数据。** 网关的响应缓存 key 里不带租户 ID,会把 A 的答案给 B;从线上 trace 挑出来的评测集里有真实客户信息,权限却往往是全员可读。

## 学习资料

### 文档与文章

- [AWS · SaaS Tenant Isolation Strategies](https://docs.aws.amazon.com/whitepapers/latest/saas-tenant-isolation-strategies/saas-tenant-isolation-strategies.html):silo、pool、bridge 这套叫法的出处,讲得很系统。重点看隔离模型和「按层隔离」两节。1 小时。
- [Microsoft · Architectural approaches for AI and ML in multitenant solutions](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/approaches/ai-ml):微软架构中心专门讲多租户 AI 系统,包括模型共享与否、租户数据能不能用于训练这些问题。40 分钟。
- [Evan Bottcher · What I talk about when I talk about platforms](https://martinfowler.com/articles/talk-about-platforms.html):平台工程最常被引用的短文,讲清平台是「自助服务的 API、工具和知识」。15 分钟。
- [InfoQ · Uber 的 GenAI Gateway](https://www.infoq.com/news/2024/09/uber-genai-gateway-llm-openai/):Uber 为什么在 60 多个用例之后做统一网关、网关管了哪些事、PII 脱敏和缓存之间的矛盾。15 分钟。原文在 Uber 工程博客,搜「Navigating the LLM Landscape: Uber's Innovation with GenAI Gateway」,需浏览器打开。
- [ByteByteGo · The Evolution of LinkedIn's Generative AI Tech Stack](https://blog.bytebytego.com/p/the-evolution-of-linkedins-generative):LinkedIn GenAI 平台演进的长文整理,和上面的视频互补。30 分钟。
- [Dify 文档](https://docs.dify.ai/):看一下工作空间、成员权限和模型供应商管理是怎么设计的,作为「现成多租户平台」的参照。30 分钟。
- [Langfuse · Self-hosting](https://langfuse.com/self-hosting):看架构图那一节,Postgres、ClickHouse、Redis、对象存储各管什么,是「中间件放在哪」那一节的真实样板,20 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1sNAWeBEr6&autoplay=0&high_quality=1" title="【IT老齐708】多租户应用五种架构模式" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT老齐 · 【IT老齐708】多租户应用五种架构模式 · 11 分钟。从独立部署讲到完全共享,和今天的 silo/pool/bridge 是同一个问题的不同切法,用传统 SaaS 的例子讲,容易懂。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Ve4y1g7Bk&autoplay=0&high_quality=1" title="【IT老齐249】SAAS多租户系统数据如何隔离？三种方案综合对比" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT老齐 · 【IT老齐249】SAAS多租户系统数据如何隔离?三种方案综合对比 · 12 分钟。独立库、独立 schema、共享表加租户字段三种方案的成本和风险对比。看完再回头读今天 RLS 那一节。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/hq3h5HNIBPE" title="AWS re:Invent 2024 - Generative AI meets multi-tenancy: Inside a working solution (SAS407)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AWS Events · Generative AI meets multi-tenancy: Inside a working solution (SAS407) · 57 分钟。AWS SaaS 团队现场拆一个多租户生成式 AI 系统:租户上下文怎么一路传下去、知识库怎么隔离、成本怎么按租户算。时间不够就看前 30 分钟。</figcaption>
</figure>

上面那个 LinkedIn 的视频也算在这一组。

### 书籍

- Tod Golding《Building Multi-Tenant SaaS Architectures》(O'Reilly, 2024):第 2 章「Multi-Tenant Architecture Fundamentals」和第 3 章「Multi-Tenant Deployment Models」讲控制面、数据面和部署模型,第 7 章讲 noisy neighbor。作者是 AWS SaaS Factory 的负责人。合计 2 小时。
- Matthew Skelton、Manuel Pais《Team Topologies》(IT Revolution, 2019,已出第 2 版;简体中文版书名《高效能团队模式》):讲平台团队和「最薄可用平台」的那几章。想清楚平台团队和业务团队怎么协作,比选什么技术更重要。1.5 小时。
- Chip Huyen《AI Engineering》(O'Reilly, 2025)第 10 章「AI Engineering Architecture and User Feedback」:从单个应用一步步加上护栏、路由、网关、缓存,和今天的能力清单正好对应。1 小时。

### 开源项目与代码

- [langgenius/dify](https://github.com/langgenius/dify):看 `api/models/account.py` 里的 `Tenant`、`TenantAccountJoin`,再随便打开 `api/models/dataset.py` 看知识库表怎么挂 `tenant_id`,学习一个真实开源平台怎么在数据模型里处理多租户。1 小时。
- [pgvector/pgvector](https://github.com/pgvector/pgvector):今天 schema 里用的向量扩展,README 里的索引一节回顾一下,注意多租户场景下「先按租户过滤再做近似检索」可能遇到的召回问题。30 分钟。

## 自测

1. 说出三个「该考虑平台化了」的信号,并说明为什么只有一个 Agent 时不建议做平台。

<details><summary>答案</summary>

信号:第三个团队来要同类东西;同一类修复(尤其是安全修复)要在多个仓库里各改一遍;出现按部门分账、统一审计、统一数据出境审核这类需要「单一控制点」的需求。只有一个 Agent 时你还分不清哪些部分是通用的,抽象出来的概念大概率不适合下一个业务,先把代码整理成可复用的包收益更高、风险更低。

</details>

2. RLS 策略里 `current_setting('app.tenant_id', true)` 的第二个参数为什么要写 `true`?应用层设置这个变量时为什么要用事务级的 `set_config(..., true)`?

<details><summary>答案</summary>

第二个参数 `true` 表示变量不存在时返回 NULL 而不是报错,NULL 和任何值比较都不成立,所以「忘了设租户」的结果是一行都看不到,这是安全的默认行为。`set_config` 的第三个参数 `true` 让设置只在当前事务内有效。连接池会复用连接,如果用会话级设置,上一个请求设的租户会残留在连接上,下一个请求忘了设的话就会以上一个租户的身份查询。

</details>

3. 多租户隔离除了数据,还有哪三个维度?各举一个出问题的例子。

<details><summary>答案</summary>

配额:一个租户跑批处理吃满供应商速率限制,其他租户全部收到 429。密钥:租户自带的 key 被打进日志,或者平台 key 被所有租户混用导致无法分账。模型:合规要求数据不出境的租户,请求被路由到了海外模型。

</details>

4. 为什么数据面不能在请求路径上同步调用控制面?控制面把某租户预算调成 0,数据面多久生效,怎么权衡?

<details><summary>答案</summary>

同步调用会让控制面成为数据面的单点,控制面一次故障或慢查询就会拖垮所有 Agent,而两者的可用性要求差很多。生效时间取决于配置快照的拉取间隔,通常是几秒到几十秒。对一般配置变更这个延迟可以接受;对紧急操作(停用某个 Agent、冻结预算)要么缩短间隔,要么提供单独的推送通道,让数据面立即收到。

</details>

5. 一个需求方说「我们想让运营同学自己搭几个内部问答机器人」,你会建议自建平台还是部署 Dify?如果公司同时有工程团队写的客服 Agent 呢?

<details><summary>答案</summary>

运营自己搭、单个不复杂、数量多,直接部署 Dify 并接公司 SSO 最快。如果同时有工程团队交付的面向客户的 Agent,建议两者并存,但底层共用:Dify 和自研 Agent 都走同一个模型网关(统一分账、限流、合规路由)和同一个工具中心(统一授权和审计)。上层搭建方式可以多样,底层管控只有一份。

</details>

6. **资深面试题**:公司里已经有 5 个团队各自做了 Agent,CTO 让你牵头做 Agent 平台。前三个月你会做什么,不做什么?

<details><summary>答案</summary>

答题要点是先找到最痛、最通用、最容易证明价值的那一块,而不是先设计完整的平台。第一个月访谈 5 个团队,把重复建设和事故列出来,量化成本(重复代码、重复修复、算不清的账单、安全事件)。通常模型网关是最好的切入点:接入成本低(改个 base_url),好处立刻可见(按团队分账、统一限流、故障切换)。第二个月上线网关并让 2 个团队接入,同时把租户模型和数据模型定下来(所有表带 tenant_id,默认 pool,留 silo 口子)。第三个月根据数据决定下一块是工具中心还是可观测。明确不做:可视化搭建界面、统一的 Agent DSL、强制迁移。要提到的指标:接入团队数、网关覆盖的调用比例、成本归因准确率、平台自身的可用性 SLO。还要说明怎么让团队主动迁移(接入就送看板和审计),以及控制面和数据面分离、平台自身 SLO 比业务更严这些架构原则。

</details>

7. (资深面试题)面试官问:「你的 Agent 平台为什么没用 Kafka?」你会怎么回答?

<details><summary>答案</summary>

从问题出发回答:平台里需要异步的地方是长任务交给 worker、trace 和用量事件送到下游。当前事件量(给出数字,比如每秒几十到几百条)、消费者数量(计费、看板两个)用 Redis Streams 或托管队列就能满足,运维成本低;Kafka 的价值在多消费者、可回放、高吞吐,等出现「事件量到每秒几千、需要回放历史事件重算账单、下游团队要独立消费」这些需求时再迁移,并且在设计里留了一层事件发布接口,换实现不影响业务代码。也可以举 Langfuse 自托管同样用 Redis 做队列、对象存储放原始事件的例子。

</details>

## 明天预告

Day 83 讲**模型网关**:平台的第一个、也是最容易出成效的组件。你会看到一个请求从业务 Agent 发出,经过鉴权、预算检查、按 token 限流、按模型组路由、出错降级,再到按租户和项目记账的完整过程,自己用 FastAPI 写一个 200 行左右的最小网关并用测试验证故障切换,同时对比 LiteLLM、Higress、Portkey 这些现成方案该怎么选。
