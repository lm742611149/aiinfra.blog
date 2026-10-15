---
title: 'BillSleuth · 计费争议调查 Agent'
name: 'BillSleuth'
tagline: '客户问「为什么多扣了钱」,Agent 自己查账、复算、找出根因,带证据解释'
summary: '虚构 SaaS 公司的订阅、发票、付款、税和贷记单数据,12 类计费故障加「客户误解」场景。Agent 查账复算,结论里每个数字都要有出处,冲正必须人工审批,100 个场景做严格评测。最像 FDE 日常工作的一个。'
order: 2
difficulty: 3
level: '资深'
duration: '3–4 周(有逐日教程,10 天正文)'
cost: '约 $5–20 API 费(跑全量评测)'
gpu: false
targets: ['海外 FDE', 'AI 应用工程师', 'Solutions Engineer']
stack: ['Python', 'LangGraph', 'MCP', 'SQLite', 'Decimal', 'FastAPI']
recognition: '100 场景评测报告(准确率、置信区间、pass^k)+ 在线演示'
depends: []
status: 'tutorial'
tutorial: '/blog/agent-60/day-121-billsleuth-kickoff/'
---

## 这个项目是什么

客户发来一句「这个月为什么多扣了我 26 块」。BillSleuth 自己去查订阅、发票、付款和税,用参考计费引擎复算应收金额,逐行对比,找出原因:按天折算的分母写死成 30、重复扣款、税码过期、优惠券叠加错、升级时间算错、跨时区月末……然后给出带证据的解释。需要退钱时它只能起草贷记单,必须人工审批。

全部数据都是虚构公司「云簿 CloudLedger」的,不碰任何真实系统。课程里有完整的逐日教程(Day 121–130)。

## 为什么值得做

计费是几乎每家 SaaS 都有、都头疼的系统,面试官不需要你解释背景。它出错代价高,逼着你做普通 Demo 不会做的事:金额全用 Decimal、Agent 不许心算、每个数字都要有出处、退钱必须人批。它还能严格评测:根因对不对、差额是不是分毫不差,不需要 LLM 打分。这三点合起来,正好是海外 FDE 面试最想听到的:能理解一个陌生业务,把 Agent 做到可靠,并且拿数据证明。

它也是后面两个项目的地基:BillBench 把它扩成公开基准,LedgerGym 把它的场景变成强化学习环境。

## 要做出什么

必做的是计费领域模型和参考引擎、12 类故障的造数脚本(每个场景带标准答案)、MCP 工具层(只读工具加复算工具,唯一的写工具只能写草稿)、LangGraph 调查流程和证据链、数字溯源校验器、贷记单审批和幂等、100 个场景的评测和模拟客户、带实时调查面板的在线演示。

不做的是真实支付、多币种和年付(留作扩展)、自动退款。

## 架构

<figure>
<svg viewBox="0 0 640 380" role="img" aria-label="BillSleuth 架构:客户问题进入 LangGraph 调查流程,通过 MCP 工具层访问计费库和参考引擎,产出证据链、解释和贷记单草稿,评测框架从外部驱动">
  <rect x="0" y="0" width="640" height="380" fill="var(--paper-raised)" rx="6"/>
  <rect x="20" y="30" width="130" height="50" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="85" y="52" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">客户问题</text>
  <text x="85" y="70" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">+ 客户编号</text>
  <line x1="150" y1="55" x2="200" y2="55" stroke="var(--ink-soft)" marker-end="url(#a121)"/>
  <rect x="200" y="20" width="230" height="170" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="315" y="40" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">调查流程(LangGraph)</text>
  <text x="215" y="64" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">intake  读懂在抱怨什么</text>
  <text x="215" y="84" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">locate  代码找候选发票</text>
  <text x="215" y="104" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">investigate ⇄ tools 假设-验证</text>
  <text x="215" y="124" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">conclude  提交结论</text>
  <text x="215" y="144" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">write_up  解释 + 数字溯源</text>
  <text x="215" y="164" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">approval  贷记单待审批</text>
  <line x1="430" y1="90" x2="480" y2="90" stroke="var(--compute)" marker-end="url(#a121)"/>
  <rect x="480" y="20" width="140" height="170" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="550" y="40" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">MCP 工具层</text>
  <text x="490" y="64" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">6 个只读工具</text>
  <text x="490" y="84" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">recompute_invoice</text>
  <text x="490" y="104" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">draft_credit_note</text>
  <text x="490" y="124" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">审计日志</text>
  <line x1="550" y1="190" x2="550" y2="230" stroke="var(--compute)" marker-end="url(#a121)"/>
  <rect x="470" y="230" width="150" height="50" fill="none" stroke="var(--compute)" rx="4"/>
  <text x="545" y="252" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">billing.db</text>
  <text x="545" y="270" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">参考计费引擎</text>
  <rect x="200" y="230" width="230" height="50" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="315" y="252" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">证据链 E1, E2, …</text>
  <text x="315" y="270" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">工具结果由代码抽取</text>
  <line x1="315" y1="190" x2="315" y2="230" stroke="var(--ink-soft)" marker-end="url(#a121)"/>
  <rect x="20" y="230" width="150" height="50" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="95" y="252" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">客户版 / 内部版</text>
  <text x="95" y="270" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">贷记单草稿 → 人批</text>
  <line x1="200" y1="255" x2="170" y2="255" stroke="var(--ink-soft)" marker-end="url(#a121)"/>
  <rect x="20" y="310" width="600" height="50" fill="none" stroke="var(--rule)" stroke-dasharray="5 4" rx="4"/>
  <text x="320" y="332" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">评测框架:100 个场景 × 模拟客户 → 根因准确率 / 差额匹配 / 数字幻觉 / 误冲正 / pass^k / 成本</text>
  <text x="320" y="350" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">标准答案来自造数脚本,和 Agent 完全隔离</text>
  <defs><marker id="a121" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>蓝色是模型侧,琥珀色是工具和数据侧。注意参考引擎在工具层后面:Agent 不会算账,只会调用 recompute_invoice 让引擎算。</figcaption>
</figure>

## 分阶段计划

| 周 | 目标 | 产出 | 怎么算完成 |
| --- | --- | --- | --- |
| 1 | 数据和工具 | 参考引擎、12 类故障造数、MCP 工具层 | 引擎单测全绿,100 个场景生成完 |
| 2 | 调查 Agent | LangGraph 流程、证据链、数字溯源校验 | 5 个典型场景端到端答对 |
| 3 | 审批和评测 | 贷记单审批、100 场景评测、模拟客户 | 六个指标都能算出来 |
| 4 | 迭代和上线 | 错例分析、改进、演示站、案例页 | 改进有统计显著性,演示可公开访问 |

## 验收指标

| 指标 | 定义 | 起点目标 |
| --- | --- | --- |
| 根因准确率 | 结论根因等于标准答案的占比 | ≥ 85% |
| 差额精确匹配率 | 多收金额分毫不差的占比 | ≥ 85% |
| 数字幻觉率 | 回复里有找不到出处的金额的占比 | 0%(校验器兜底) |
| 误冲正率 | 账没错却起草贷记单的占比 | ≤ 5% |
| pass^k | 同一场景跑 k 次全对的比例 | 报 k=3 |
| 单场景成本 | token 花费的中位数和 P95 | 你自己测 |

目标是开工前拍的起点,测出来达不到就如实写。

## 最终产出

开源仓库、评测报告(六个指标加置信区间、错例分析、迭代记录)、在线演示站、两分钟演示视频、FDE 式的案例页。调查过程的 trace 可以导入 Agent Loupe 查看。

## 难点和坑

评测容易偏乐观:复算工具几乎直接把差额告诉了 Agent,所以要加模拟客户和更难的场景。模型抄数字会抄错,证据必须由代码从工具结果里抽取。「客户误解」的场景里 Agent 很想冲正讨好客户,误冲正率要单独盯。审批要幂等,同一张草稿并发提交只能生成一张。改进只认统计显著的提升,6 个场景从 50% 到 90% 很可能是噪声。

## 面试里怎么讲

示范讲法:客户问为什么多扣钱,人工查一单要半小时。我做了一个只读查账 Agent,金额全部交给参考引擎算,结论里每个数字都能追到某次工具调用,退钱只能起草、必须人批。在 100 个带标准答案的场景上,根因准确率多少、差额精确匹配多少、误冲正多少。最大的取舍是不让模型算钱,代价是要维护一个参考引擎。

<details><summary>追问:为什么不让模型直接算金额?</summary>

模型做小数运算和按天折算会出错,而且出错时很自信。计费里差一分钱就是错。把计算交给确定性的引擎,模型只负责决定查什么、比什么、怎么解释。

</details>

<details><summary>追问:你的评测会不会太乐观?</summary>

会。复算工具把差额算出来了,题目偏简单。我的做法是加模拟客户(会追问、会给错信息)、加多张发票交织的场景、单独统计「客户误解」类场景的误冲正率,并且报置信区间而不是单个数字。

</details>

<details><summary>追问:如果客户的计费系统是十年前自研的,你怎么落地?</summary>

先拿几十个真实争议工单和账务同事一起查一遍,把查账步骤和特殊规则记下来;只读工具按 Agent 需要的结构重新设计,而不是照搬表结构;能写成代码的规则进参考引擎,写不成的让 Agent 遇到时转人工;第一阶段只解释、不冲正。

</details>

## 前置知识

Day 22–28 MCP 和 LangGraph,Day 29–35 评测,Day 69 统计置信区间,Day 70 模拟用户。

## 参考资料

- [τ-bench 论文](https://arxiv.org/abs/2406.12045):模拟用户和 pass^k 指标的来源。
- [Stripe 文档:按天折算](https://docs.stripe.com/billing/subscriptions/prorations):订阅计费里折算的标准做法。
- [Model Context Protocol](https://modelcontextprotocol.io/):工具层协议。
- [LangGraph 文档](https://docs.langchain.com/oss/python/langgraph/overview):调查流程的状态机。
- 课程 Day 121–130:完整的逐日实现。
