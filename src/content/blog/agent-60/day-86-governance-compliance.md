---
title: 'Day 86 · 治理与合规:数据驻留、PII、审计、模型备案'
description: '企业客户的安全问卷、国内生成式 AI 服务的备案与登记、AI 生成内容标识、个人信息出境、欧盟 AI Act 在 2026 年 7 月调整后的时间表。今天把这些要求逐条翻译成技术方案:画数据流图、做数据分级、给每类数据定保留期,并实现一个能覆盖所有存储的删除流程。'
pubDate: 2026-10-12
regime: none
tags: ['governance', 'compliance', 'privacy', 'data-retention', 'regulation', 'agent-60']
series: 'agent-60'
day: 86
lang: 'zh'
---

## 今天要解决的问题

资深工程师和中级工程师的一个明显区别,是前者在设计阶段就会问:「这个数据从哪来、存在哪、谁能看、存多久、用户要求删除时能不能删干净、会不会出境」。中级工程师往往要等到法务或者客户的安全团队找上门,才发现整个架构要返工。

Agent 系统在合规上比普通业务系统更麻烦,原因有三个:它天然要处理大量自然语言,用户会在对话里随口说出手机号、身份证、病情;它要把这些内容发给第三方模型供应商,可能在境外;它会把内容复制到很多地方,trace、记忆、评测集、缓存,每复制一份就多一个要管的地方。

先说清楚:**这一篇不是法律意见**。法规的适用要由你们公司的法务判断,条文以官方发布的文本为准。我们的目标是让你作为工程师,知道有哪些要求、它们会怎样改变技术设计,以及在法务问你问题时能给出准确的回答。

今天结束时你应该能:

1. 看懂企业客户安全问卷里最常见的问题,知道每个问题要靠架构里的哪一部分回答。
2. 说清国内面向公众提供生成式 AI 服务时的备案、登记、标识要求,以及调用境外模型涉及的数据出境规则。
3. 知道欧盟 AI Act 在 2026 年 7 月调整后的关键日期,判断你的 Agent 大概落在哪个风险类别。
4. 画出一个 Agent 系统的数据流图,做数据分级,给每一类数据定保留期。
5. 实现一个覆盖所有存储(包括 trace、记忆、评测集)的数据删除流程,并留下回执。

预计用时 4–5 小时。前置:Day 40(脱敏、审计)、Day 82(多租户)、Day 84(审计日志)、Day 85(trace 管道)。

## 从安全问卷倒推架构

如果你的 Agent 要卖给企业客户,签合同之前几乎一定会收到一份安全问卷,几十到上百道题。和 AI 相关的部分,问来问去基本是这些:

| 客户问的 | 你需要的架构能力 |
| --- | --- |
| 我们的数据会不会被用来训练模型? | 和模型供应商的协议条款;自部署模型的话说明训练流程不使用客户数据 |
| 数据存在哪个国家/地区?会不会出境? | 数据流图;按租户配置模型路由和存储区域(Day 82–83) |
| 对话内容保留多久?能不能要求删除? | 每类数据的保留期;覆盖所有存储的删除流程 |
| 哪些员工能看到我们的数据?有没有审计? | trace 和原文的访问权限;访问审计(Day 85) |
| 用了哪些第三方(子处理者)? | 模型供应商、观测平台、向量库托管方的清单 |
| 怎么防止数据泄露给其他客户? | 多租户隔离(Day 82),包括缓存和评测集 |
| 怎么防止 prompt injection 导致越权? | 工具权限、审批、审计(Day 39–40、Day 84) |
| 有什么认证? | ISO 27001、SOC 2;AI 相关的有 ISO/IEC 42001(AI 管理体系) |
| 出了安全事件多久通知我们? | 事故响应流程(Day 87) |

你会发现,这张表的右边一列就是 W13 前几天做的事。这也是为什么平台化之后合规会容易很多:一个模型网关就能回答「数据去了哪」,一个工具中心就能回答「Agent 能做什么」,而不用每个团队各自去答一遍。

我的经验是,**第一次填问卷时一定会发现答不上来的题**,这不丢人,把它们变成平台的待办事项就好。最常见的答不上来的是两道:「对话内容保留多久」(因为 trace 从来没设过保留期)和「能不能删干净」(因为没人知道数据被复制到了哪些地方)。

## 国内:面向公众提供服务时的要求

### 备案和登记

《生成式人工智能服务管理暂行办法》从 2023 年 8 月 15 日起施行,它管的是**向中华人民共和国境内公众**提供生成文本、图片、音频、视频等内容的服务。这里有两个关键词决定了你的 Agent 适不适用。

「境内公众」意味着企业内部自用的工具(比如只给自己员工用的知识库助手)、以及不面向境内公众的研发,不在这个办法的范围内。但面向客户的客服 Agent,只要用户是境内公众,就要认真看。

具体落到产品上,目前的做法分两种:

- **备案**:你自己提供模型服务(自研或者微调了模型并对外提供),要向国家网信办申请生成式人工智能服务备案,也就是常说的「大模型备案」。
- **登记**:你的应用通过 API 调用**已经备案的**模型(比如调用 DeepSeek、通义的 API),由地方网信办登记。

按网信办 2026 年 9 月 14 日的公告,截至 2026 年 8 月 31 日,全国累计有 1,112 款生成式人工智能服务完成备案,731 款生成式人工智能应用或功能完成登记。公告里还重申了一条:已上线的应用或功能,应在显著位置或产品详情页面公示所使用的已备案或登记服务情况,注明模型名称、备案号或上线编号。

这对技术选型的直接影响是:**面向境内公众的 Agent,底层模型要用已经备案的**。这也是国内团队普遍选国产模型 API 做主力的现实原因之一。Day 83 的模型网关在这里很有用:在网关的租户配置里给面向公众的租户只开放已备案模型的模型组,路由层强制执行,业务方想绕也绕不过去。

如果是自研模型要走备案,备案过程会要求提交安全评估材料、语料来源说明、拦截关键词库、测试题库等,推荐性国家标准 GB/T 45654-2025《网络安全技术 生成式人工智能服务安全基本要求》(2025 年 11 月 1 日起实施)是这些材料的主要依据,它从语料安全、模型安全、安全措施三个方面提了要求。这个过程通常由专门的合规团队牵头,但测试题库和拒答率的数据需要工程团队提供,和 W11 的评测平台关系很大。

### 生成内容的标识

《人工智能生成合成内容标识办法》从 2025 年 9 月 1 日起施行,配套的强制性国家标准 GB 45438-2025《网络安全技术 人工智能生成合成内容标识方法》同日实施。它要求两类标识:

- **显式标识**:用户能直接感知到的,比如文字提示「以下内容由 AI 生成」、语音里的提示音、图片上的角标。
- **隐式标识**:写在文件元数据里的,用户一般看不到,用于追溯。

对一个文字客服 Agent 来说,实际的影响通常是:界面上要让用户知道他在和 AI 对话、回复是 AI 生成的;如果 Agent 生成可以下载、导出的文件(报告、图片、音频),文件里要带上隐式标识,导出时也要带显式标识。这一类需求最好在平台层统一做(比如 SDK 里提供一个统一的导出函数),否则每个团队的实现五花八门,检查时很难证明「全都做了」。

### 个人信息和数据出境

《个人信息保护法》对 Agent 有几条直接的约束:处理个人信息要有合法基础(通常是用户同意或者履行合同所必需);敏感个人信息(健康、金融账户、身份证号、行踪等)需要单独同意;用户有权要求删除自己的个人信息。

**调用境外模型就是数据出境。** 如果你的 Agent 把包含境内用户个人信息的对话发给境外的模型 API,这就构成个人信息出境。2024 年 3 月施行的《促进和规范数据跨境流动规定》放宽了一些门槛,大致的分档是(以非关键信息基础设施运营者为例,不含重要数据):

- 自当年 1 月 1 日起累计向境外提供不满 10 万人个人信息(不含敏感个人信息),免于申报;
- 10 万到 100 万人的非敏感个人信息,或不满 1 万人的敏感个人信息,要订立个人信息出境标准合同或者通过个人信息保护认证;
- 100 万人以上的非敏感个人信息,或 1 万人以上的敏感个人信息,要申报数据出境安全评估。

还有一些豁免情形,比如为订立、履行个人作为一方当事人的合同所必需。具体怎么适用要法务判断,但工程上有几件事是确定要做的:**知道哪些请求会出境**(数据流图),**能按租户关掉出境路由**(网关),**出境前尽量脱敏**(Day 40 的 PII 处理),以及**能统计出境涉及多少人**(这需要你的用量日志能按最终用户去重计数,而不只是按请求计数)。

### 日志留存

《网络安全法》(2025 年 10 月修改,2026 年 1 月 1 日起施行,这次修改还新增了关于人工智能的条款)要求网络运营者采取监测、记录网络运行状态和网络安全事件的技术措施,并留存相关的网络日志**不少于六个月**。这条要求和「对话原文只保留 14 天」并不矛盾:要留六个月的是网络日志和安全事件记录(谁在什么时候访问了什么、做了什么操作),这正是 Day 84 的审计日志和 Day 85 的元数据那一路;对话原文是另一类数据,可以短期保留。关键是你的系统要把这两类东西分开存,才能分别设置保留期。

## 欧盟 AI Act:2026 年 7 月的调整

如果你的 Agent 有欧盟用户,或者你在找海外的工作,AI Act 是绕不开的。它 2024 年 8 月生效,分阶段适用:禁止类的 AI 实践从 2025 年 2 月起适用,通用目的 AI 模型(GPAI)提供者的义务从 2025 年 8 月起适用。

原定 2026 年 8 月 2 日是大部分义务(包括高风险系统)开始适用的日子。2026 年这件事有了重要变化:作为欧盟「数字综合方案」(Digital Omnibus)的一部分,一项推迟时间表的法规在 2026 年 7 月 24 日刊登在欧盟官方公报上,7 月 27 日生效。按律所 Garrigues 的整理:

- 附件三列出的独立高风险系统(招聘、教育、生物识别、关键基础设施等领域),义务推迟到 **2027 年 12 月 2 日**;
- 嵌入在受欧盟行业法规管辖的产品里的高风险系统,推迟到 **2028 年 8 月 2 日**;
- 第 50 条的透明度义务对 2026 年 8 月 2 日之后上市的系统照常适用,之前已上市、会生成合成内容的系统,输出标识有一个到 **2026 年 12 月 2 日**的过渡期。

对一个客服 Agent 来说,它通常不属于高风险类别,主要适用的是第 50 条的透明度义务:让用户知道自己在和 AI 交互,生成的合成内容要能被识别出来。但如果你的 Agent 用于招聘筛选(Day 82 那个 HR 筛简历的 Agent)、信贷评估这类场景,就可能落进高风险类别,要求会多得多:风险管理体系、数据治理、技术文档、日志记录、人工监督、准确性和稳健性。这些要求大多数都对应着 W11(评测)和 W13(平台、可观测、审计)的工作。

条文、范围、例外都很细,上面只是工程师需要的轮廓,具体以官方文本和法务意见为准。

## 画出数据流图

所有合规问题的起点是同一张图:**数据从哪来、流到哪、在哪里停留**。下面是 SupportPilot 跑在 AgentOps 平台上时,一张工单里的客户信息的流向:

<figure>
<svg viewBox="0 0 640 320" role="img" aria-label="一张工单的数据流:客户消息进入 Agent 运行时,经脱敏后发往模型网关,网关按租户路由到境内或境外模型;同时数据被复制到会话存储、长期记忆、trace 原文、trace 元数据、评测集和审计日志,各自有不同的保留期">
  <rect x="0" y="0" width="640" height="320" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="14" y="130" width="90" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/><text x="59" y="150" text-anchor="middle" fill="var(--ink)">客户消息</text><text x="59" y="166" text-anchor="middle" fill="var(--ink-soft)">含个人信息</text>
    <rect x="130" y="130" width="110" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="185" y="150" text-anchor="middle" fill="var(--ink)">Agent 运行时</text><text x="185" y="166" text-anchor="middle" fill="var(--ink-soft)">先脱敏</text>
    <rect x="266" y="130" width="100" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="316" y="150" text-anchor="middle" fill="var(--ink)">模型网关</text><text x="316" y="166" text-anchor="middle" fill="var(--ink-soft)">按租户路由</text>
    <rect x="400" y="96" width="110" height="36" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="455" y="118" text-anchor="middle" fill="var(--ink)">境内已备案模型</text>
    <rect x="400" y="170" width="110" height="36" rx="4" fill="var(--compute-wash)" stroke="var(--compute)" stroke-dasharray="4 3"/><text x="455" y="192" text-anchor="middle" fill="var(--ink)">境外模型=出境</text>
    <rect x="14" y="240" width="96" height="58" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="62" y="262" text-anchor="middle" fill="var(--ink)">会话</text><text x="62" y="280" text-anchor="middle" fill="var(--ink-soft)">90 天</text>
    <rect x="118" y="240" width="96" height="58" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="166" y="262" text-anchor="middle" fill="var(--ink)">长期记忆</text><text x="166" y="280" text-anchor="middle" fill="var(--ink-soft)">365 天</text>
    <rect x="222" y="240" width="96" height="58" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="270" y="262" text-anchor="middle" fill="var(--ink)">trace 原文</text><text x="270" y="280" text-anchor="middle" fill="var(--ink-soft)">30 天</text>
    <rect x="326" y="240" width="96" height="58" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="374" y="262" text-anchor="middle" fill="var(--ink)">trace 元数据</text><text x="374" y="280" text-anchor="middle" fill="var(--ink-soft)">180 天</text>
    <rect x="430" y="240" width="96" height="58" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="478" y="262" text-anchor="middle" fill="var(--ink)">评测集</text><text x="478" y="280" text-anchor="middle" fill="var(--ink-soft)">最容易漏</text>
    <rect x="534" y="240" width="96" height="58" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="582" y="262" text-anchor="middle" fill="var(--ink)">审计日志</text><text x="582" y="280" text-anchor="middle" fill="var(--ink-soft)">≥6 个月</text>
  </g>
  <g stroke="var(--ink-faint)" stroke-width="1.2" fill="none">
    <path d="M104 152 L130 152"/><path d="M240 152 L266 152"/><path d="M366 146 L400 114"/><path d="M366 160 L400 188"/>
    <path d="M185 174 L62 240"/><path d="M185 174 L166 240"/><path d="M185 174 L270 240"/><path d="M185 174 L374 240"/><path d="M270 298 C 300 314, 450 314, 478 298"/><path d="M316 174 L582 240"/>
  </g>
  <text x="320" y="30" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一条客户消息,最终会在 6 个地方留下痕迹</text>
  <text x="320" y="50" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">删除请求要覆盖全部 6 个,出境与否由网关路由决定</text>
</svg>
<figcaption>SupportPilot 一张工单的数据流。评测集那一格用琥珀色标出来,是因为它最容易被遗漏:评测用例经常是从线上 trace 里挑出来的,带着真实的客户信息,权限却常常是全员可读、永不过期。</figcaption>
</figure>

画这张图时有几个地方最容易漏:**评测集**(从线上挑出来的样本)、**缓存**(网关的响应缓存、语义缓存)、**向量库**(如果客户上传的文档被切块存进了知识库)、**备份**(数据库的备份里也有,删除请求一般允许备份随轮转自然过期,但要在隐私政策里说清楚)、**第三方观测平台**(Langfuse 云版、模型供应商自己的日志)。

## 数据分级和保留期

图画出来之后,给每一类数据定级别和保留期。一个实用的分级:

| 等级 | 例子 | 规则 |
| --- | --- | --- |
| 公开 | 帮助中心文章、产品文档 | 无特殊要求 |
| 内部 | 系统 prompt、工具定义、聚合后的指标 | 只在公司内部,不进入外部第三方 |
| 机密 | 客户的业务数据、工单内容、对话原文 | 按租户隔离,访问有审计,保留期有上限 |
| 敏感个人信息 | 身份证号、银行卡、健康信息 | 进模型前脱敏;原则上不出境;最短保留;单独同意 |

保留期怎么定,原则是**能短则短,但不短于法定和业务需要**:

- 会话:保留到工单关闭后一段时间,比如 90 天,便于客户回来追问。
- 长期记忆:按产品设计,比如一年;用户可以随时查看和删除(Day 64 讲过记忆要让用户可控)。
- trace 原文:14–30 天,覆盖问题的发现和排查周期。
- trace 元数据和审计日志:不少于六个月,很多公司定一年。
- 评测集:不应该自动过期(否则回归测试会悄悄变少),所以**进入评测集之前必须先脱敏或者改写**,这样它就不再是客户的个人信息了。这是我最想强调的一条。

## 删除请求要删到底

用户说「删除我的数据」时,最难的不是写 DELETE 语句,而是**知道要删哪些地方**。解决办法是建一个「数据存储登记表」:平台上每一个会存客户数据的地方都必须登记,登记时写清楚按什么字段找到某个客户的数据、保留多久、删除时是物理删除还是去标识化。新加一个存储不登记,就不允许上线。

有两类数据不应该直接删,而是**去标识化**:审计日志(法规要求留存,而且删掉会破坏 Day 84 的哈希链,所以把客户 ID 换成一个不可逆的假名)和 trace 元数据(用来算指标,删掉会让历史统计失真)。

删除完成后要留一份**回执**:哪天、处理了哪个客户、每个存储处理了多少行,由谁执行。用户或者监管问起来,这就是证据。

下面这段代码实现了这个思路,用 SQLite 模拟多个存储:

```python
# agent-60-lab/w13/governance/retention.py
import sqlite3
import time
from dataclasses import dataclass


@dataclass
class Store:
    """平台里每一个会存客户数据的地方都要登记,漏一个,删除请求就做不完整。"""
    table: str
    customer_col: str
    ts_col: str
    retention_days: int | None      # None 表示按合同/法规另行处理,不自动删
    erase_mode: str                 # "delete" 或 "anonymize"


STORES = [
    Store("sessions", "customer_id", "created_at", 90, "delete"),
    Store("memories", "customer_id", "created_at", 365, "delete"),
    Store("trace_payloads", "customer_id", "created_at", 30, "delete"),   # prompt 原文
    Store("trace_spans", "customer_id", "created_at", 180, "anonymize"),  # 元数据留着算指标
    Store("eval_cases", "customer_id", "created_at", None, "delete"),     # 最容易忘的一个
    Store("audit_log", "customer_id", "created_at", None, "anonymize"),   # 审计要留,但去标识
]


def purge_expired(db: sqlite3.Connection, now: float | None = None) -> dict[str, int]:
    now = now or time.time()
    out = {}
    for s in STORES:
        if s.retention_days is None:
            continue
        cur = db.execute(f"DELETE FROM {s.table} WHERE {s.ts_col} < ?",
                         (now - s.retention_days * 86400,))
        out[s.table] = cur.rowcount
    db.commit()
    return out


def erase_customer(db: sqlite3.Connection, customer_id: str, pseudonym: str) -> dict[str, int]:
    """处理「删除我的数据」请求。返回每张表处理了多少行,作为回执存档。"""
    receipt = {}
    for s in STORES:
        if s.erase_mode == "delete":
            cur = db.execute(f"DELETE FROM {s.table} WHERE {s.customer_col} = ?", (customer_id,))
        else:
            cur = db.execute(f"UPDATE {s.table} SET {s.customer_col} = ? WHERE {s.customer_col} = ?",
                             (pseudonym, customer_id))
        receipt[s.table] = cur.rowcount
    db.commit()
    return receipt
```

```python
# agent-60-lab/w13/governance/test_retention.py
import sqlite3

from retention import STORES, erase_customer, purge_expired

DAY = 86400


def make_db():
    db = sqlite3.connect(":memory:")
    for s in STORES:
        db.execute(f"CREATE TABLE {s.table} (customer_id TEXT, created_at REAL, payload TEXT)")
    return db


def test_purge_respects_each_store():
    db, now = make_db(), 1000 * DAY
    for s in STORES:
        db.execute(f"INSERT INTO {s.table} VALUES ('C007', ?, 'x')", (now - 100 * DAY,))
    result = purge_expired(db, now)
    assert result["sessions"] == 1 and result["trace_payloads"] == 1      # 90 天、30 天:过期
    assert result["memories"] == 0 and result["trace_spans"] == 0         # 365、180 天:未过期
    assert "eval_cases" not in result                                     # 不自动删


def test_erase_covers_every_store():
    db = make_db()
    for s in STORES:
        db.execute(f"INSERT INTO {s.table} VALUES ('C007', 0, 'x'), ('C009', 0, 'y')")
    receipt = erase_customer(db, "C007", "erased-7f3a")
    assert all(n == 1 for n in receipt.values())
    for s in STORES:
        assert db.execute(f"SELECT COUNT(*) FROM {s.table} WHERE customer_id='C007'").fetchone()[0] == 0
        assert db.execute(f"SELECT COUNT(*) FROM {s.table} WHERE customer_id='C009'").fetchone()[0] == 1
```

运行 `uv run pytest -q w13/governance`,我本机是 `2 passed`。

这段代码只是骨架,真实系统还要处理几件事:向量库和对象存储不是 SQL 表,要在登记表里为它们写各自的删除函数;第三方系统(Langfuse 云版、模型供应商)要调它们的删除接口,或者确认它们的保留期短于你的承诺;删除要异步执行并可重试,某个存储失败了要告警,而不是静默跳过;最后,`f-string` 拼表名只在表名来自你自己的登记表时才安全,千万不要让外部输入进入表名。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1z9bSzhENu&autoplay=0&high_quality=1" title="【技术合规】生成合成算法备案实战指南：从被拒4次到成功备案的踩坑全记录" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>暴躁哐哐 · 【技术合规】生成合成算法备案实战指南:从被拒 4 次到成功备案的踩坑全记录 · 6 分钟。一个开发者走备案流程被退回四次的真实经历,能让你对「备案到底要准备什么、技术团队要出什么材料」有具体的感觉。</figcaption>
</figure>

## 合规要求怎么变成技术方案

最后把今天的内容收拢成一张表,这也是你在平台设计文档里应该有的一节:

| 要求 | 技术方案 | 落在哪 |
| --- | --- | --- |
| 面向境内公众的服务用已备案模型 | 网关按租户限制模型组 | Day 83 |
| 应用公示所用模型和备案号 | 平台为每个 Agent 记录所用模型组和对应备案信息,产品页自动展示 | 控制面 |
| 生成内容加显式、隐式标识 | 平台 SDK 统一的回复包装和导出函数 | 运行时 |
| 个人信息出境的分档管理 | 数据流图;按租户关闭出境路由;出境前脱敏;按最终用户去重统计 | 网关 + 账本 |
| 敏感个人信息单独同意、最小化 | 进模型前脱敏;原文不进长期存储 | 运行时 + Day 85 |
| 删除权 | 数据存储登记表 + 删除流程 + 回执 | 治理服务 |
| 网络日志留存不少于六个月 | 审计日志和元数据单独存储、单独保留期 | Day 84–85 |
| 透明度(告知用户在和 AI 交互) | 界面统一标识;语音场景开场白 | 产品 + SDK |
| 高风险场景的人工监督 | 工具风险分级 + 人工审批 | Day 84 |

## 动手练习

**第一步:画你的数据流图(1 小时)。** 以 SupportPilot 为对象,画出一条客户消息流经和停留的所有地方,包括你在 W5 建的评测集、W6 的会话存储、Day 85 的两路 trace。每个节点标上:数据等级、保留期、所在地区(境内/境外)、哪些角色能访问。

**第二步:填一份安全问卷(1 小时)。** 用今天第一张表里的 9 个问题,为 SupportPilot 写出答案。答不上来或者答案不理想的,列成待办,写清楚要改什么。

**第三步:实现删除流程(1.5 小时)。** 跑通 `w13/governance` 的测试。然后扩展:

1. 把 `STORES` 换成你 SupportPilot 里真实的存储(Postgres 的会话表、pgvector 的知识库切块、Langfuse 的 trace),为不是 SQL 的存储写单独的删除函数。
2. 删除回执写进 Day 84 的审计日志(客户 ID 用假名)。
3. 写一个测试:往评测集里放一条带客户手机号的用例,证明你的「进入评测集前脱敏」流程会把它拦下来。

**第四步:写一页「合规要求到技术方案」对照表。** 用今天最后那张表做模板,结合你的产品(面向谁、在哪、用哪些模型)写出你自己的版本,每一行标上负责人。

**验收标准:**

- 数据流图覆盖至少 6 个存储位置,包含评测集和第三方观测平台。
- 安全问卷有 9 道题的答案和待办清单。
- 删除流程测试通过,覆盖所有登记的存储,回执写入了审计日志。
- 对照表每一行都能说出对应的代码或配置在哪里。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 备案 / 登记 | 自己提供生成式 AI 模型服务向国家网信办备案 / 通过 API 调用已备案模型的应用由地方网信办登记 |
| 显式标识 / 隐式标识 | 用户能直接感知的 AI 生成提示 / 写在文件元数据里的标识 |
| 个人信息出境 | 把境内收集的个人信息提供给境外接收方,调用境外模型 API 通常属于此类 |
| 标准合同 | 个人信息出境的一种合规路径,与境外接收方订立网信办制定的标准合同 |
| 敏感个人信息 | 一旦泄露或被非法使用,容易导致人格尊严受侵害或人身、财产安全受危害的个人信息 |
| 子处理者(subprocessor) | 替你处理客户数据的第三方,如模型供应商、观测平台 |
| 数据存储登记表 | 平台上所有存放客户数据的位置清单,删除和保留策略据此执行 |
| 去标识化 | 把个人标识替换为假名,使数据无法直接关联到个人 |
| GPAI | 欧盟 AI Act 中的通用目的 AI 模型 |
| ISO/IEC 42001 | AI 管理体系的国际标准,企业客户问卷里越来越常见 |

## 常见误区

**合规是法务的事,上线前再说。** 数据流、保留期、删除能力都是架构层面的决定,上线后再改代价很大。设计阶段就要画数据流图。

**只删数据库,忘了 trace、记忆、评测集和缓存。** 用户要求删除时,真正麻烦的是那些被复制出去的副本。没有数据存储登记表,就不可能删干净。

**评测集直接用线上原文。** 评测集需要长期保留,如果里面是客户的原始对话,它就是一个永不过期、权限宽松的个人信息库。进入评测集之前先脱敏或改写。

**以为内部工具就完全不用管。** 内部自用的 Agent 可能不适用面向公众服务的备案要求,但员工和客户的个人信息照样受个人信息保护法约束,调用境外模型照样可能涉及出境。

**审计日志也按「最短保留」处理。** 网络日志和安全事件记录有不少于六个月的留存要求。审计日志和对话原文要分开存、分开定保留期,前者删除时做去标识化而不是物理删除。

**照搬网上的法规解读当结论。** 法规在变(网络安全法 2025 年刚修改,AI Act 2026 年 7 月刚调整),不同场景适用不同条款。工程师要知道轮廓和影响,具体适用以官方文本和法务意见为准。

## 学习资料

### 文档与文章

- [国家网信办 ·《生成式人工智能服务管理暂行办法》](https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm):原文,先读第二条的适用范围和第三章服务规范。30 分钟。英文对照可以看 [China Law Translate 的译本](https://www.chinalawtranslate.com/generative-ai-interim/)。
- [新京报 · 生成式人工智能服务已备案信息公告(截至 2026 年 8 月 31 日)](https://m.bjnews.com.cn/detail/1789387872129240.html):备案和登记的最新数字,以及已上线应用的公示要求。10 分钟。
- [新华网 ·《人工智能生成合成内容标识办法》发布](https://www.news.cn/tech/20250314/f8b96305ff274e0cb70031c2819092ee/c.html):标识办法的发布报道和要点。15 分钟。
- [全国网络安全标准化技术委员会 · GB/T 45654-2025 生成式人工智能服务安全基本要求](https://www.tc260.org.cn/upload/2025-06-30/1751257342816036759.pdf):备案材料的主要依据,重点看语料安全和模型安全两章。英文译本见 [CSET 的翻译](https://cset.georgetown.edu/publication/china-gen-ai-safety-standard-final/)。1 小时。
- [国家网信办 ·《促进和规范数据跨境流动规定》](https://www.cac.gov.cn/2024-03/22/c_1712776625820516.htm):出境分档的原文。20 分钟。
- [中央网信办 · 专家解读《网络安全法》修改](https://www.cac.gov.cn/2026-01/02/c_1769093523928606.htm):2025 年修改的要点,包括新增的人工智能条款。15 分钟。
- [Garrigues · AI Digital Omnibus regulation has been published](https://www.garrigues.com/en_GB/garrigues-digital/ai-digital-omnibus-regulation-has-been-published-redefining-deadlines-and):欧盟 AI Act 2026 年 7 月调整后的各项日期。15 分钟。
- [artificialintelligenceact.eu](https://artificialintelligenceact.eu/):AI Act 条文的可检索版本,查第 50 条透明度义务和附件三高风险清单。按需查阅。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV13mQtYKEc1&autoplay=0&high_quality=1" title="【政策解读】人工智能生成合成内容标识办法" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>超级贝勒何 · 【政策解读】人工智能生成合成内容标识办法 · 21 分钟。逐条讲标识办法,显式和隐式标识分别要求什么、平台和服务提供者各自的义务。</figcaption>
</figure>

上面那个备案踩坑的视频也在这一组。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/q-7IoeJw4aw" title="How the Digital Omnibus is reshaping the EU AI Act" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>HelloDPO · How the Digital Omnibus is reshaping the EU AI Act · 27 分钟。数据保护从业者讲 Omnibus 改了 AI Act 的哪些地方、为什么改。录制时法规还在立法流程中,最终日期以正文引用的已发布版本为准。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/s_rxOnCt3HQ" title="The EU's AI Act Explained" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>EU Made Simple · The EU's AI Act Explained · 5 分钟。用五分钟讲清 AI Act 按风险分级的整体框架,对这部法规完全陌生的话先看这个。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025)第 10 章里关于护栏(guardrails)和数据隐私的部分:讲输入输出两侧的防护、PII 处理在架构里放在哪一层。40 分钟。合规类的书籍更新跟不上法规变化,今天以官方文本和上面的文章为主。

### 开源项目与代码

- [Presidio](https://github.com/data-privacy-stack/presidio):微软发起的开源 PII 识别和脱敏工具(仓库已迁到 data-privacy-stack 组织下),支持自定义识别器(可以加中文手机号、身份证的规则),适合放在「进入评测集之前」和「进模型之前」两个位置。40 分钟。
- [open-telemetry/opentelemetry-collector-contrib 的 redactionprocessor](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/redactionprocessor):昨天用过的 Collector 脱敏,作为 trace 这一路的兜底。按需查阅。

## 自测

1. 一个只给公司内部员工用的知识库问答 Agent,适用《生成式人工智能服务管理暂行办法》的备案或登记要求吗?它有没有其他需要注意的合规问题?

<details><summary>答案</summary>

办法管的是向境内公众提供生成式 AI 服务,企业内部自用、不面向公众的通常不在其适用范围内(具体由法务判断)。但其他要求仍然适用:员工和知识库里涉及的客户个人信息受《个人信息保护法》约束;如果调用境外模型,涉及个人信息的部分可能构成出境;网络日志留存要求依然适用;数据要分级、有保留期、能删除。

</details>

2. 你的客服 Agent 面向境内用户,产品经理想把某个效果更好的境外模型接进来做主力。你会从合规角度提出哪些问题?技术上能做什么?

<details><summary>答案</summary>

问题:该模型是否在境内备案(面向境内公众的服务需要使用已备案模型);对话中的个人信息发往境外构成出境,按当年累计涉及人数适用免于申报、标准合同或认证、安全评估的不同路径;是否涉及敏感个人信息;供应商的数据使用和保留条款。技术上:在网关按租户限制模型组,面向公众的租户只开放已备案模型;如需试用境外模型,只在内部或特定租户开启;出境前脱敏;用量日志能按最终用户去重统计出境人数;数据流图更新并让法务确认。

</details>

3. 用户要求删除自己的数据。为什么审计日志里的记录不直接删除,而是去标识化?

<details><summary>答案</summary>

审计日志属于需要留存的网络日志和安全事件记录(不少于六个月),直接删除会违反留存要求,也会让安全事件无法追溯;同时 Day 84 的哈希链会因为删除记录而断裂,失去防篡改能力。去标识化(把客户 ID 换成不可逆的假名)既保留了日志的完整性和留存义务,又让记录无法再关联到这个人。

</details>

4. 为什么说评测集是删除请求里最容易漏的地方?你会怎么从流程上解决?

<details><summary>答案</summary>

评测集经常从线上 trace 里挑选真实案例,带着客户的原始对话和个人信息;它需要长期保留(否则回归测试会悄悄变少),而且常常全员可读,所以它是一个权限宽、不过期的个人信息库,又很少被列进数据存储清单。流程上:任何样本进入评测集之前必须经过脱敏或改写,用自动检测(如 Presidio 加中文规则)拦截带个人信息的用例;评测集登记进数据存储登记表;评测集的访问权限按租户控制。

</details>

5. 欧盟 AI Act 在 2026 年 7 月的调整中,附件三的高风险系统义务推迟到了什么时候?一个用于招聘筛选简历的 Agent 和一个电商客服 Agent,大概分别落在什么类别?

<details><summary>答案</summary>

附件三独立高风险系统的义务推迟到 2027 年 12 月 2 日(嵌入受行业法规管辖产品的推迟到 2028 年 8 月 2 日)。招聘筛选属于附件三列出的就业领域,很可能是高风险,要求风险管理、数据治理、技术文档、日志、人工监督等。电商客服通常不是高风险,主要适用第 50 条的透明度义务(告知用户在和 AI 交互、合成内容可识别)。具体判断以条文和法务意见为准。

</details>

6. **资深面试题**:你的 Agent 平台要接一家大型银行客户,对方的安全团队给了 120 道题的问卷,要求两周内答复,并且提出「数据不出境、对话原文不超过 7 天、所有工具调用可审计、要有独立部署选项」。你怎么推进?

<details><summary>答案</summary>

先做差距分析:把问卷题目按数据流、存储与保留、访问控制、审计、供应商、事故响应、认证分组,对照平台现状标出「已满足 / 配置即可满足 / 需要开发 / 无法满足」,和客户确认优先级。四个硬要求逐一对应:数据不出境,用网关为该租户只开放境内已备案模型或自部署模型,观测和存储都放境内,子处理者清单里没有境外方;原文 7 天,该租户的 trace 原文路设 7 天保留,会话和记忆按合同单独设,评测集只用脱敏改写后的样本;审计,所有工具调用经工具中心,哈希链审计并定期锚定,审计保留不少于六个月;独立部署,走 Day 82 的 bridge 模式,为该租户提供 silo 部署(独立数据库、worker,甚至独立网关实例),控制面配置下发即可。证据:数据流图、数据存储登记表、保留策略配置、删除回执样例、审计日志样例、渗透测试报告。要说明哪些做不到或需要时间,给出时间表,不要承诺做不到的事。还要提到这类客户往往会作为平台演进的驱动,把为它做的能力(按租户保留期、silo 部署)做成通用功能。

</details>

## 明天预告

Day 87 讲 **Agent 事故复盘**:Air Canada 的客服机器人给出了和官方政策相矛盾的丧亲票价退款说法,航空公司被裁定要赔钱;Cursor 的客服机器人「Sam」凭空发明了一条登录限制,引发一波退订;Replit 的 Agent 在代码冻结期间删掉了生产数据库。明天从这些真实案例出发,讲 Agent 特有的事故类型、出事后头 15 分钟该按哪些开关、怎么用 trace 定位根因、无责复盘怎么写,以及怎样把每次事故变成新的评测用例和护栏,并动手实现一套分级的紧急开关和行为熔断器。
