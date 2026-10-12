---
title: 'Day 43 · 毕业项目开题:为什么做 SupportPilot、需求文档与架构图'
description: '毕业项目 SupportPilot 开工第一天。先用 JD 数据说清为什么选智能客服工单这个题,再像 FDE 那样从一次模拟客户访谈里拆出需求、非目标和验收指标,最后定架构、目录结构和 12 天排期。今天写的 PRD 是后面每一天的验收依据。'
pubDate: 2026-10-12
regime: none
tags: ['capstone', 'prd', 'architecture', 'fde', 'supportpilot', 'agent-60']
series: 'agent-60'
day: 43
lang: 'zh'
---

## 今天要解决的问题

前六周你做了一堆小项目:命令行聊天机器人、手写 Agent 循环、带引用的文档问答、MCP + LangGraph 的工单分流、评测集和 CI 门禁、部署上线。每个都能跑,但单拿出来哪个都撑不起一次面试。面试官想看的是一个**完整的、像真产品的东西**:有明确用户、有业务规则、有评测分数、能上线、能讲清楚取舍。

接下来 12 天(Day 43–54)就做这一个东西:**SupportPilot,一个给虚构 SaaS 公司「云簿 CloudLedger」用的智能客服工单 Agent**。今天不写业务代码,只做开工前该做的事。今天结束时你应该能做到:

1. 用招聘数据说清楚为什么选这个题,而不是选"AI 写周报""AI 旅行规划"。
2. 从一段客户访谈里拆出需求、非目标和可以量化的验收指标,写成一页 PRD。
3. 画出系统架构图,说清每个模块为什么在那里、以后放到哪个文件。
4. 定下 12 天的排期,每天一个能演示的产出。
5. 估出单张工单的成本,心里有数这个项目跑评测要花多少钱。

预计用时 3–4 小时,大部分时间花在写 PRD 和自己画一遍架构图上。前置:W1–W6 全部,特别是 Day 13(workflow 还是 agent)、Day 25(人工审批)、Day 29(为什么要评测)。

## 为什么是智能客服工单

先说一个我见过很多次的失败:有人花两周做了个"多 Agent 自动写小红书文案"的项目,技术栈很新,面试时被问"你怎么知道它写得好",答不上来;再问"出错了谁负责",也答不上来。问题不在技术,在题目本身没有对错标准,没有业务规则,也就没法评测、没法讲取舍。

选题我用了四条标准,都是从招聘需求倒推出来的。

**第一,覆盖 JD 里出现最多的技能。** 本站在 2026-10-12 抓了 305 条 AI Agent 相关 JD(国内 120 条、海外 185 条,调研方法和原始数据在站内 `docs/jd-research/`)。按关键词统计,国内 JD 里提到工具调用 / Function Calling 的占 63%,评测 56%,RAG 52%,部署和工程化 41%;海外样本里评测 62%、RAG 54%、部署 53%。国内 JD 里有 23% 明确写了"知识库"或"知识问答",直接写"智能客服"的只有 5%,但一个客服工单 Agent 恰好把这些高频项全装进去了:回答政策问题要 RAG,查账单要工具调用,退款要人工审批,回复对不对要评测,给真人用要部署。

**第二,有明确的对错。** 客服的回答是可以判对错的:"年付首购第 7 天能不能全额退款"有标准答案,"这个客户 9 月是不是被扣了两次"查数据库就知道。有对错就能建评测集,有评测集就能在面试里说"我把通过率从 X 提到了 Y,靠的是这三处改动"。这句话的分量比"我用了 LangGraph"重得多。

**第三,有真实的风险和取舍。** 退款涉及钱,所以必须有人工审批;客户可能威胁投诉,所以要知道什么时候转人工;工单里可能夹着"忽略之前的指令"这种注入,所以要有安全设计。这些恰好是面试官最爱追问的地方,也是 JD 里"处理幻觉、循环、工具调用失败""最小权限""Agent 安全模型"这些要求对应的东西。

**第四,对接企业系统。** 一个 Boss 直聘上的企业 AI 落地岗写得很直白:"对接数据平台、业务系统、知识库、审批系统、企业协作工具,熟练 SQL"。新加坡和香港的样本里 64% 提到 SQL 或数据系统。SupportPilot 会接业务数据库(用工具和受控的 text-to-SQL 查)、知识库、审批流和飞书/钉钉/企业微信的群通知,Day 46 专门讲。

海外的公司里,Sierra、Decagon、Intercom 这些专做客服 Agent 的公司都在招 Agent 工程师,Sierra 还专门做了一个客服场景的 Agent 基准 τ-bench。客服是 Agent 落地最早、最成熟、钱最清楚的场景之一,这不是我拍脑袋选的。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1P6an6EEc9&autoplay=0&high_quality=1" title="为什么我不让 AI 客服直接回复用户?新思路构建可信赖的 AI 客服|录屏精简版" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Koala聊开源 · 为什么我不让 AI 客服直接回复用户?新思路构建可信赖的 AI 客服 · 9 分钟,整段看。他的核心观点是 AI 客服要先"可信"再"自动",和我们今天定的"退款必须过人工、草稿要过质检"是同一个思路。</figcaption>
</figure>

## 像 FDE 那样拆需求:先访谈,再写代码

这一节是今天最重要的部分,也是大多数自学项目缺的部分。

海外样本里有一类岗位特别多:Forward Deployed Engineer(FDE,前线部署工程师),还有 Applied AI Engineer、Agent Deployment Engineer 这些名字。美国本土的 40 条样本里,有 52% 提到面向客户或客户交付;国内也开始出现 FDE 岗,智联上有两条,百度数字人有一条。这类工程师的日常是:去客户那里坐几天,听他们讲业务,把含糊的"我们想用 AI 提升客服效率"拆成能写代码、能验收的东西,然后自己动手做出来。

就算你投的不是 FDE,面试里被问"这个项目的需求从哪来的",能讲出一个访谈和拆解的过程,比说"我自己想的"好太多。所以我们模拟一次。

### 一次模拟访谈

假设你去见云簿的客服负责人老周。下面是访谈记录的节选,我故意写得像真实对话一样乱:

> 我们现在 6 个客服,每天大概 300 张工单。一半以上是重复问题,发票怎么开、验证码收不到、导入报错这种,帮助中心里都有,但客户就是不看。
>
> 最头疼的是退款。退款规则有好几条,年付 14 天内全退、超过了按月算还要扣手续费、月付不退,新来的客服经常算错,算错了要么客户投诉,要么公司亏钱。上个月有个客服给企业版客户承诺了全额退款,企业版是合同单根本不能这么退,最后销售去擦的屁股。
>
> 还有被重复扣款的,这种得查后台,客服要开三个系统:工单系统、计费后台、财务的退款审批。
>
> 我不想让 AI 直接给客户退钱,这个绝对不行。但如果它能把账查清楚、把规则算对、把回复草稿写好,我们的人点个确认,那就省大事了。
>
> 有些客户上来就说要去 12315 投诉,这种必须马上给到组长。
>
> 对了,我们财务审批都在飞书群里,退款申请最好能推到群里。

### 从访谈到需求

拆的时候我用一个很朴素的办法:每句话问三个问题。这是事实还是情绪?背后的真实问题是什么?怎么验收?

| 访谈原话 | 真实问题 | 需求 | 怎么验收 |
| --- | --- | --- | --- |
| 一半以上是重复问题,帮助中心里都有 | 知识没被用起来 | 政策和操作类问题自动答,答案带帮助中心出处 | 检索命中率、引用合法率、事实覆盖率 |
| 退款规则新人经常算错 | 规则计算不该靠人记,也不该靠模型猜 | 退款资格和金额由代码按规则算,模型只负责解释 | 每条退款规则一个单元测试,评测集里退款金额 100% 对 |
| 给企业版客户承诺了全额退款 | 承诺越权 | 回复里不能出现没有依据的承诺;企业版退款转客户成功经理 | "禁止承诺"规则检查 + 专门的企业版用例 |
| 客服要开三个系统 | 查数据成本高 | Agent 用工具查客户、订阅、账单,把结论整理好 | 工具调用正确率 |
| 不想让 AI 直接退钱 | 风险控制 | 退款只能创建"待审批"申请,人点通过才执行 | 审批闸门正确率 100%,模型拿不到执行退款的工具 |
| 去 12315 投诉的必须马上给组长 | 高风险工单识别 | 投诉、法律威胁、账号被盗、要求人工 → 直接转人工 | 转人工召回率 100% |
| 财务审批在飞书群 | 融入现有流程 | 退款申请推送到飞书/钉钉/企业微信群 | 有推送,推送失败不影响主流程 |

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="从客户访谈到验收指标的拆解流程">
<rect x="10" y="60" width="130" height="70" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="75" y="90" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">访谈原话</text>
<text x="75" y="112" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">事实 + 情绪 + 抱怨</text>
<rect x="170" y="60" width="130" height="70" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="235" y="90" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">真实问题</text>
<text x="235" y="112" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">为什么会疼</text>
<rect x="330" y="60" width="130" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="395" y="90" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">需求</text>
<text x="395" y="112" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">系统要做什么</text>
<rect x="490" y="60" width="140" height="70" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="560" y="90" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">验收指标</text>
<text x="560" y="112" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">评测集里怎么判</text>
<line x1="140" y1="95" x2="168" y2="95" stroke="var(--ink-faint)" stroke-width="1.5" marker-end="url(#a43)"/>
<line x1="300" y1="95" x2="328" y2="95" stroke="var(--ink-faint)" stroke-width="1.5" marker-end="url(#a43)"/>
<line x1="460" y1="95" x2="488" y2="95" stroke="var(--ink-faint)" stroke-width="1.5" marker-end="url(#a43)"/>
<text x="320" y="30" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">每句话问三遍:是事实吗?背后是什么?怎么判对错?</text>
<text x="320" y="170" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">拆不出验收指标的需求,先放进"非目标"</text>
<defs><marker id="a43" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink-faint)"/></marker></defs>
</svg>
<figcaption>FDE 式需求拆解:从原话到验收指标。最后一列写不出来的,说明这个需求还没想清楚。</figcaption>
</figure>

这张表里最值钱的是最后一列。很多人做项目只写到"需求"那列就开工,结果做完不知道算不算做完。验收指标一旦写下来,Day 50 的评测集就有了骨架:每条指标对应评测里的一项检查。

### 访谈里没说、但你要追问的

真实访谈里,客户不会把所有边界情况都告诉你。FDE 的价值一半在追问。我会追问老周这几个问题(答案我替他编好了,写进了 Day 44 的造数脚本里):

- "第 14 天当天申请算不算 14 天内?"答:算,含第 14 天。这就是一个边界用例,评测集里专门有一条第 14 天、一条第 15 天。
- "续费的年付能不能退?"答:续费后 7 天内全退。这条规则访谈时他没提,不追问就会漏。
- "客户用别的邮箱发工单怎么办?"答:让客户提供注册邮箱,不能凭名字猜是谁。
- "退款超过多少钱要特别注意?"答:超过 1,000 元财务要复核。
- "AI 回复客户之前,需要人看一眼吗?"答:政策类问题不用,涉及钱的要。

追问完你会发现,"智能客服"这四个字底下其实是一张很具体的规则表。把规则写成代码,把代码写成测试,这就是你和"调 API 做个聊天框"的区别。

## 一页 PRD

下面是 SupportPilot 的 PRD,放在仓库 `docs/PRD.md`。写 PRD 不是为了好看,是为了 12 天后能对着它逐条打勾。

```markdown
# supportpilot/docs/PRD.md
# SupportPilot PRD v1(2026-10)

## 背景
云簿 CloudLedger 是在线记账 SaaS,客服 6 人,日均 300 张工单。
一半以上是帮助中心已有答案的重复问题;退款规则复杂、人工经常算错;处理一张涉及账单的工单要切 3 个系统。

## 用户
- 客户:通过工单或在线客服提问
- 客服:看 Agent 的处理过程,接手转人工的工单
- 财务:审批退款申请

## 目标(本期要做)
1. 政策/操作类问题:检索帮助中心,自动生成带出处的回复
2. 账户类问题:查询客户、订阅、账单,把事实整理进回复
3. 退款:按规则代码判断资格和金额,创建待审批申请,推送到财务群;审批通过后补发结果
4. 高风险工单(投诉、法律威胁、安全事件、要求人工)直接转人工
5. 多轮追问:同一工单内记得上下文;记得这个客户以前的问题
6. 每次改动都能跑评测,看到分数涨跌

## 非目标(本期不做)
- 不直接执行退款、不修改订阅(模型拿不到这类工具)
- 不做语音、不做邮件收发集成(用 HTTP 接口模拟渠道)
- 不做多语言(英文工单能看懂,但回复质量不保证)
- 不训练或微调模型

## 验收指标(dev / test 两个集合都要报)
| 指标 | 目标 |
| --- | --- |
| 分类准确率 | ≥ 90% |
| 检索命中率(recall@5) | ≥ 90% |
| 引用合法率(不引用不存在的文章) | 100% |
| 退款闸门正确率(该建申请才建,不该建不建) | 100% |
| 禁止承诺(不出现"已退款""马上到账") | 100% |
| 转人工召回率 | 100% |
| 全部检查通过率 | dev ≥ 80%,test 与 dev 差距 ≤ 5 个点 |
| 单张工单平均成本 | ≤ ¥0.05 |
| 端到端 P95 延迟 | ≤ 25 秒(首个 token ≤ 8 秒) |

## 风险
- 模型编造规则或金额 → 金额只来自工具;质检节点检查事实依据
- 提示词注入诱导退款 → 退款金额服务端重算;执行退款不暴露给模型
- 评测集过拟合 → dev/test 按场景拆分,test 只在里程碑时跑
```

非目标那一节值得多说一句。面试官问"为什么不做 X",你能回答"我考虑过,这期刻意不做,原因是……",这说明你有判断力。什么都想做的项目最后什么都做不完。

验收指标里的数字是目标,不是承诺。Day 50 跑出第一份基线分数后,你可能会发现 80% 太高或太低,那就调,但要在 PRD 里记下为什么调。

## 架构:每个方块后面是哪个文件

<figure>
<svg viewBox="0 0 640 440" role="img" aria-label="SupportPilot 系统架构图">
<rect x="10" y="40" width="150" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="85" y="64" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">客户 / 客服 / 财务</text>
<text x="85" y="84" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">三种用户</text>
<rect x="10" y="130" width="150" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="85" y="154" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Streamlit 界面</text>
<text x="85" y="174" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">ui/ · Day 49</text>
<rect x="10" y="220" width="150" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="85" y="244" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">FastAPI + SSE</text>
<text x="85" y="264" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">api/ · Day 49</text>
<rect x="10" y="310" width="150" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="85" y="334" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">评测 evals/</text>
<text x="85" y="354" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">Day 50–51</text>
<line x1="85" y1="96" x2="85" y2="128" stroke="var(--ink-faint)" stroke-width="1.5"/>
<line x1="85" y1="186" x2="85" y2="218" stroke="var(--ink-faint)" stroke-width="1.5"/>
<line x1="160" y1="248" x2="198" y2="248" stroke="var(--ink-faint)" stroke-width="1.5"/>
<line x1="160" y1="338" x2="198" y2="338" stroke="var(--ink-faint)" stroke-width="1.5"/>
<rect x="200" y="20" width="230" height="410" rx="8" fill="none" stroke="var(--mem)" stroke-dasharray="4 3"/>
<text x="315" y="40" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">LangGraph 工作流 agent/ · Day 47</text>
<g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
<rect x="225" y="54" width="180" height="28" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="315" y="72" text-anchor="middle">load_customer 查客户</text>
<rect x="225" y="92" width="180" height="28" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="315" y="110" text-anchor="middle">prepare_context 记忆</text>
<rect x="225" y="130" width="180" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="315" y="148" text-anchor="middle">classify 分诊</text>
<rect x="225" y="168" width="180" height="28" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="315" y="186" text-anchor="middle">retrieve 检索</text>
<rect x="225" y="206" width="180" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="315" y="224" text-anchor="middle">act 调工具查数据</text>
<rect x="225" y="244" width="180" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="315" y="262" text-anchor="middle">draft 起草</text>
<rect x="225" y="282" width="180" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="315" y="300" text-anchor="middle">check 质检</text>
<rect x="225" y="320" width="180" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="315" y="338" text-anchor="middle">approval 人工审批 ⏸</text>
<rect x="225" y="358" width="85" height="28" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="267" y="376" text-anchor="middle">finalize</text>
<rect x="320" y="358" width="85" height="28" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="362" y="376" text-anchor="middle">handoff</text>
</g>
<text x="315" y="410" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">状态存 Postgres checkpoint · Day 48</text>
<g font-family="var(--font-mono)" font-size="11">
<rect x="460" y="40" width="170" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="545" y="61" text-anchor="middle" fill="var(--ink)">LLM API</text>
<text x="545" y="79" text-anchor="middle" fill="var(--ink-soft)">DeepSeek / 通义 / Claude</text>
<rect x="460" y="115" width="170" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="545" y="136" text-anchor="middle" fill="var(--ink)">知识库 kb.*</text>
<text x="545" y="154" text-anchor="middle" fill="var(--ink-soft)">pgvector + BM25 · Day 45</text>
<rect x="460" y="190" width="170" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="545" y="211" text-anchor="middle" fill="var(--ink)">业务库 biz.*</text>
<text x="545" y="229" text-anchor="middle" fill="var(--ink-soft)">工具 + text-to-SQL · Day 46</text>
<rect x="460" y="265" width="170" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="545" y="286" text-anchor="middle" fill="var(--ink)">飞书/钉钉/企微群</text>
<text x="545" y="304" text-anchor="middle" fill="var(--ink-soft)">审批通知 · Day 46</text>
<rect x="460" y="340" width="170" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="545" y="361" text-anchor="middle" fill="var(--ink)">MCP server</text>
<text x="545" y="379" text-anchor="middle" fill="var(--ink-soft)">给外部 Agent 用 · Day 46</text>
</g>
<line x1="405" y1="144" x2="458" y2="65" stroke="var(--mem)" stroke-width="1.2"/>
<line x1="405" y1="182" x2="458" y2="140" stroke="var(--compute)" stroke-width="1.2"/>
<line x1="405" y1="220" x2="458" y2="215" stroke="var(--compute)" stroke-width="1.2"/>
<line x1="405" y1="334" x2="458" y2="290" stroke="var(--compute)" stroke-width="1.2"/>
</svg>
<figcaption>SupportPilot 架构。蓝色是调用大模型的节点,琥珀色是工具和外部系统。审批节点会停下来等人,状态存进 Postgres,等多久都不丢。</figcaption>
</figure>

几个设计决定,每个都是面试会被问的。

**为什么是 workflow 加一段 agent,而不是一个大 agent?** Day 13 讲过 Anthropic 的建议:能用固定流程就别用自主 agent。客服工单的主干是固定的:查客户、分诊、检索、起草、质检。只有"查业务数据"这一步需要模型自己决定调哪些工具、调几次,所以只有 `act` 节点是一个小的 agent 循环,其他节点都是确定的。这样做的好处是每一步都能单独测、单独评,出了问题知道是哪一步。坏处是不够灵活,比如客户一张工单问了三件不相干的事,固定流程处理起来比较笨。我接受这个代价。

**为什么退款规则写在代码里?** 规则是确定的,写成 Python 函数可以单元测试,7 条规则 7 个测试,永远不会算错。让模型去算"950 × 7 / 12 × 0.9",它大多数时候算对,偶尔算错,而"偶尔算错"在钱的事情上不能接受。模型负责的是理解客户要什么、选对工具、把结果讲清楚。

**为什么业务库和知识库放同一个 Postgres?** 本地只起一个容器,部署也只要一个数据库。pgvector 在几十万向量以内表现足够,我们只有几百个文本块。等哪天知识库到了千万级再拆出去,Day 17 讲过取舍。

**为什么工作流内部不走 MCP?** SupportPilot 自己调业务工具是进程内直接调函数,不绕 MCP:少一跳网络,单测好写。同一套业务函数另外包一个 MCP server,给 Claude Desktop、Cursor 或别的团队的 Agent 用。一份实现,两个出口。

**为什么要一个质检节点?** 起草和检查分开,是 Day 13 讲的 evaluator-optimizer 模式。质检先跑规则(引用是不是编的、有没有承诺退款到账),规则过了再让一个便宜模型核对事实依据,不过就退回重写一次,还不过就转人工。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/D7_ipDqhtwk" title="How We Build Effective Agents: Barry Zhang, Anthropic" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · How We Build Effective Agents: Barry Zhang, Anthropic · 15 分钟左右,重点听"不是所有事都需要 agent"和"站在 agent 的视角看它拿到的上下文"两段,正好解释为什么 SupportPilot 只让一个节点自主。</figcaption>
</figure>

## 目录结构

先把目录定下来,后面 11 天往里填。标了日期的是那天新增的,Day 52–54 的部分由后面三天补上。

```text
supportpilot/
├── pyproject.toml              # Day 44 依赖、ruff、pytest 配置
├── .env.example                # Day 44 所有配置项,复制成 .env
├── docker-compose.yml          # Day 44 Postgres+pgvector;Day 52 加 Langfuse;Day 53 加 app
├── Makefile                    # Day 44 常用命令
├── README.md                   # Day 44 雏形,Day 54 定稿
├── db/schema.sql               # Day 44 biz.* 业务表 + kb.* 知识库表
├── data/
│   ├── kb/                     # Day 44 生成的 62 篇帮助中心文章(markdown)
│   └── seed/demo_tickets.jsonl # Day 47 演示用的 10 张工单
├── scripts/
│   ├── kb_facts.py             # Day 44 帮助中心的"事实源",评测标准答案也从这来
│   ├── gen_kb.py               # Day 44 事实 → markdown
│   ├── init_db.py              # Day 44 建表
│   ├── seed_db.py              # Day 44 造 200 个客户和账单
│   ├── ingest_kb.py            # Day 45 增量导入知识库
│   ├── run_tickets.py          # Day 47 终端里端到端跑工单
│   └── chat_ticket.py          # Day 48 终端里多轮对话,状态存 Postgres
├── src/supportpilot/
│   ├── config.py               # Day 44 pydantic-settings
│   ├── db.py                   # Day 44 数据库连接
│   ├── llm.py                  # Day 47 LLMClient(W1 版本 + 成本账本 + 结构化重试)
│   ├── kb/                     # Day 45 chunker / embed / retriever / cite
│   ├── tools/                  # Day 46 business / registry / sql_tool / notify / mcp_server
│   ├── agent/                  # Day 47 state / prompts / deps / nodes / graph
│   ├── memory/                 # Day 48 profile / compress / checkpoint
│   ├── api/app.py              # Day 49 FastAPI + SSE
│   ├── ui/streamlit_app.py     # Day 49 演示界面
│   ├── obs/                    # Day 52 tracing、成本统计
│   └── security/               # Day 53 注入防护、限流
├── evals/
│   ├── datasets/tickets_v1.jsonl   # Day 50 100 条用例
│   ├── build_dataset.py checks.py judges.py run_eval.py   # Day 50
│   ├── retrieval_eval.py       # Day 45 只评检索
│   ├── failures_to_csv.py      # Day 51 导出失败用例做错误分析
│   └── reports/                # 每次评测的报告
├── tests/                      # 每天都加,不连库不花钱的单测为主
└── docs/
    ├── PRD.md                  # Day 43 今天
    ├── eval-changelog.md       # Day 51 每次改动和分数变化
    ├── error-analysis-v1.md    # Day 51 失败归类计数表
    └── architecture.md         # Day 54
```

`src/` 布局(代码放在 `src/supportpilot/` 而不是根目录)是 Python 打包的推荐做法,好处是测试跑的一定是安装后的包,不会因为当前目录碰巧能 import 而掩盖打包问题。uv 建项目时选 `--package` 就是这个布局。

## 12 天排期

| Day | 产出 | 当天能演示什么 |
| --- | --- | --- |
| 43 | PRD、架构图、目录、排期 | 今天这篇 |
| 44 | 仓库骨架、配置、62 篇帮助中心、200 个客户的业务库 | `make data` 一条命令建好数据 |
| 45 | 知识库导入、混合检索、引用 | 输入一个问题,返回 5 段带出处的资料,检索命中率基线 |
| 46 | 业务工具、退款规则、审批通知、text-to-SQL、MCP server | 在 Claude Desktop 里查客户账单 |
| 47 | LangGraph 主工作流 | 终端里 10 张工单端到端跑通,退款停下来等你按 y |
| 48 | 多轮对话、客户画像、上下文压缩、checkpoint 落库 | 同一工单追问,重启进程后状态还在 |
| 49 | FastAPI + Streamlit | 浏览器里看着 Agent 一步步干活,财务点审批 |
| 50 | 100 条评测集、三层评测 | 第一份评测报告 |
| 51 | 错误分析与迭代 | 改动日志 + 分数对比 |
| 52 | Langfuse、成本看板、缓存与模型路由 | 每张工单花了多少钱一目了然 |
| 53 | 注入测试、权限审计、Docker 部署 | 公网可访问的 demo |
| 54 | README、演示视频、技术博客 | 招聘方 5 分钟看懂 |

这个排期是按"每天不限时"排的。如果你一天只有两三个小时,Day 44 和 Day 50 大概率要拆成两天,不要硬赶。赶出来没测过的代码,Day 50 评测时会一起还债。

## 成本估算:跑一次评测要花多少钱

先估单张工单。一张需要查账单的工单大约这样消耗 token(按我们后面要写的提示词长度估):

| 步骤 | 输入 token | 输出 token |
| --- | --- | --- |
| classify 分诊 | 约 1,000 | 约 120 |
| act 调工具(平均 3 轮) | 约 3 × 2,200 = 6,600 | 约 3 × 120 = 360 |
| draft 起草 | 约 2,500 | 约 300 |
| check 质检 | 约 2,600 | 约 150 |
| 合计 | 约 12,700 | 约 930 |

2026 年 10 月我查的 DeepSeek 官方价格(deepseek-flash,北京时间工作日 9–12 点和 14–18 点是高峰):高峰期缓存未命中输入 2 元/百万 token、输出 8 元/百万 token,非高峰减半。按高峰价算:

```text
输入:12,700 × 2 / 1,000,000 ≈ ¥0.0254
输出:   930 × 8 / 1,000,000 ≈ ¥0.0074
单张工单 ≈ ¥0.033(非高峰约 ¥0.016)
```

100 条评测用例,每条再加一次 LLM 评审(约 3,000 输入、200 输出,¥0.0076),一次完整评测大约 100 × (0.033 + 0.008) ≈ ¥4。Day 51 要反复跑十几次,心里留 ¥50 的预算足够。政策类问题不走 act,成本只有一半左右。Day 52 会用 prompt caching(缓存命中的输入只要 0.04 元/百万)和小模型分诊再往下压。

价格会变,写进 `.env` 的 `PRICE_IN_PER_M` 和 `PRICE_OUT_PER_M` 两个配置里,换厂商只改配置。

## 动手练习

**练习 1:写你自己的访谈拆解表(1 小时)。** 不要直接抄上面那张表。找一个你熟悉的业务场景(你现在公司的客服、HR 问答、IT 工单都行),自己扮演客户写 10 句访谈原话,然后按"原话 → 真实问题 → 需求 → 验收"拆成表。如果你就做 SupportPilot,那就给老周的访谈再补 5 个追问,每个追问写出你猜的答案,以及它会变成评测集里的哪种用例。

**练习 2:把 PRD 放进仓库(20 分钟)。**

```bash
mkdir supportpilot && cd supportpilot
git init
mkdir docs
# 把上面的 PRD 复制进 docs/PRD.md,按你的理解改
git add docs/PRD.md
git commit -m "docs: SupportPilot PRD v1"
```

**练习 3:自己画一遍架构图(40 分钟)。** 用 excalidraw.com 或纸笔都行,不看上面的图,凭理解画。画完对照,看自己漏了什么。漏掉的地方通常就是你还没理解的地方。我第一次画漏了"审批节点停下来之后状态存哪",结果设计 API 时卡了半天。

**练习 4:算你自己的成本(20 分钟)。** 如果你用的不是 DeepSeek,去你用的厂商官网查当天价格,按上面的 token 估算表重新算单张工单成本和一次评测的成本,写进 PRD 的风险一节。

**验收标准:** 仓库里有 `docs/PRD.md`,包含目标、非目标、至少 8 条可量化的验收指标;你能不看稿,用两分钟给别人讲清楚架构图里每个方块是干什么的、为什么只有一个节点是自主 agent。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| PRD | Product Requirements Document,产品需求文档。写清做什么、不做什么、怎么算做完 |
| FDE | Forward Deployed Engineer,前线部署工程师。驻扎在客户那里,把需求拆清楚并亲手交付的工程师 |
| 非目标 | 明确写下"这期不做"的东西,防止范围失控 |
| 验收指标 | 可以量化、可以自动检查的完成标准,后面直接变成评测项 |
| 审批闸门 | 敏感操作必须经过人工确认的那道关卡 |
| evaluator-optimizer | 一个模型起草、另一个检查、不过就重写的模式(Day 13) |
| src 布局 | 包代码放在 `src/包名/` 下的项目结构 |
| 高峰/非高峰价 | DeepSeek 按时段定价,非高峰是高峰的一半 |

## 常见误区

**一上来就写代码。** 不先写验收指标,做到第 8 天你会发现不知道该优化什么,评测集也不知道该考什么。今天花 3 小时写 PRD,Day 50 能省一整天。

**把题目选得太大。** "全自动客服,能处理所有问题"是做不完的。SupportPilot 的非目标列了四条,每一条都是砍掉的功能。面试时能讲清楚砍掉了什么、为什么,比做了一堆半成品有说服力。

**让模型负责它不擅长的事。** 规则计算、权限判断、金额校验这些确定性的事交给代码。模型的长处是理解自然语言和组织语言,别让它当计算器和门卫。

**架构图画成技术栈清单。** 一张图上堆满 logo(LangChain、Redis、Kafka……)不是架构图。架构图要说明数据怎么流、哪里会停、哪里需要人。

**以为访谈只是走形式。** 上面五个追问里,"续费 7 天可退"和"企业版不适用"两条如果漏了,评测集就测不出来,上线后就是事故。需求拆解的质量直接决定评测集的质量。

## 学习资料

### 文档与文章

- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):今天的架构决定基本都能在这篇里找到依据,重读"workflow vs agent"和"evaluator-optimizer"两节,20 分钟。
- [OpenAI · A practical guide to building agents(PDF)](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf):看"guardrails"和"human intervention"两部分,讲什么时候必须让人介入,和我们的审批闸门对应,30 分钟。
- [Sierra · τ-bench: Benchmarking AI agents](https://sierra.ai/blog/benchmarking-ai-agents):专门针对客服场景的 Agent 基准,看它怎么定义"任务完成"和怎么模拟用户,Day 50 建评测集时会再用到,20 分钟。
- [Applied LLMs · What We've Learned From A Year of Building with LLMs](https://applied-llms.org/):一线团队的经验合集,看"Operational"和"Strategic"部分,关于从小处做起、先有评测再优化,1 小时。
- [LangGraph 官方客服机器人教程](https://langchain-ai.github.io/langgraph/tutorials/customer-support/customer-support/):航空客服的完整例子,先扫一遍它怎么切分节点和工具,对比我们的设计差在哪,30 分钟。
- [DeepSeek 模型与价格(中文)](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):成本估算的价格来源,注意高峰/非高峰时段。

### B 站视频

- 上面嵌的 Koala聊开源《为什么我不让 AI 客服直接回复用户?》。
- 武哥聊编程《AI 智能客服和工单处理系统,基于 Langchain4j + Springboot + Vue + RAG + PGVector》(BV1pEhV64ERV,35 分钟):Java 技术栈做的同类系统,适合后端出身的同学对照看,重点看他的模块划分和我们的有什么不同。下面嵌了。
- 海浪星辰矩阵《电商智能客服系统演示:AI 问答、知识库检索、订单查询与人工客服》(BV1rPpb6kEay,45 分钟):纯演示,看产品形态,特别是人工客服接手那段,15 分钟快进着看就行。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1pEhV64ERV&autoplay=0&high_quality=1" title="【AI实战】AI智能客服和工单处理系统,基于Langchain4j+Springboot+Vue+RAG+PGVector+Emb的企业智能客服系统,企业知识库" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>武哥聊编程 · AI 智能客服和工单处理系统(Langchain4j + Spring Boot + PGVector) · 前 10 分钟看系统演示和架构,后面的代码按需看。</figcaption>
</figure>

### 其他经典视频

- 上面嵌的 Barry Zhang《How We Build Effective Agents》。
- LangChain 官方《Build a Customer Support Bot | LangGraph》(YouTube,b3XsvoFWp4c):配合上面那篇教程看,讲怎么用图来约束客服 Agent,Day 47 前看完。

### 书籍

- Chip Huyen《AI Engineering: Building Applications with Foundation Models》(O'Reilly,2025):读第 1 章后半部分"规划 AI 应用"(用例评估、设定期望、里程碑),和今天的 PRD 一一对应;第 10 章讲 AI 应用的整体架构,可以对照我们的架构图,两章合计约 2 小时。中文版情况我没能查证,以英文原版为准。

### 开源项目与代码

- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench):看 `tau_bench/envs/retail` 目录,它怎么把零售客服的规则写成 wiki、把数据写成数据库、把工具写成函数,结构和 SupportPilot 很像,30 分钟。
- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):今天不用读代码,先 star,Day 47 要用。
- [datawhalechina/hello-agents](https://github.com/datawhalechina/hello-agents):中文的 Agent 教程,里面的项目案例可以拿来对比选题。

## 自测

**1. 为什么 SupportPilot 只有 act 一个节点让模型自主决定调什么工具?**

<details><summary>答案</summary>

因为其他步骤(查客户、分诊、检索、起草、质检)顺序是固定的,用 workflow 更可控、更好测、更便宜;只有"查哪些业务数据、查几次"随工单变化,才需要 agent 循环。这样每个节点都能单独评测,出了问题能定位到具体步骤。

</details>

**2. 退款金额由谁计算?为什么?**

<details><summary>答案</summary>

由业务代码 `check_refund_eligibility` 按规则计算,模型只负责调用这个工具并把结果解释给客户。规则是确定性的,代码可以单元测试,永远算对;模型计算偶尔出错,在钱的事情上不可接受。另外服务端重算还能防注入:客户在工单里写"退我 9999 元"也没用。

</details>

**3. 访谈里老周没提到"续费 7 天可退",为什么这条规则很重要?它会怎样影响评测集?**

<details><summary>答案</summary>

因为不追问就会漏掉一整类客户(年付自动续费后反悔的),上线后这类工单会被错误地按"超过 14 天"按比例退款,少退钱还会引来投诉。追问出来后,评测集里就要专门加"续费第 4 天申请退款应全额退"的场景,以及第 14/15 天这样的边界用例。

</details>

**4. 一张需要查账单的工单,按高峰价大概花多少钱?怎么算的?**

<details><summary>答案</summary>

约 ¥0.033。输入约 12,700 token × 2 元/百万 ≈ ¥0.0254,输出约 930 token × 8 元/百万 ≈ ¥0.0074。政策类问题不走工具调用,大约一半。

</details>

**5. 「面试题」面试官问:"你这个项目的需求是怎么来的?你怎么知道做完了?"你会怎么答?**

<details><summary>答案</summary>

按 FDE 的方式讲:先做了一次(模拟的)客服负责人访谈,把原话拆成"真实问题 → 需求 → 验收指标",追问出了续费退款、企业版例外、第 14 天边界等规则;写了 PRD,明确了非目标(不直接执行退款、不做语音等);验收指标都是可量化的,比如退款闸门正确率 100%、转人工召回率 100%、全通过率 dev ≥ 80%,这些指标直接变成了评测集里的检查项,所以"做完"的定义就是评测报告达标。

</details>

**6. 「面试题」为什么不直接用一个大 Agent 加一堆工具,让它自己决定怎么处理工单?**

<details><summary>答案</summary>

可以这么做,但代价是:行为不可预测,难以定位错误,token 成本更高,而且关键约束(比如退款必须审批、质检必须做)只能靠提示词保证。客服工单主流程是固定的,用 workflow 把确定的部分固定下来,只在需要灵活决策的地方放 agent,这是 Anthropic 和 OpenAI 的指南都推荐的做法。如果以后发现固定流程处理不了某类工单(比如一张工单多个不相关诉求),再针对那部分增加自主性。

</details>

## 明天预告

Day 44 · 搭骨架:仓库结构、配置、造数据。用 uv 初始化项目,配好 ruff、pytest 和 pre-commit,写 `config.py` 统一管理配置,用 Docker 起 Postgres + pgvector,然后造数据:62 篇帮助中心文章和 200 个客户的订阅、账单、历史工单,其中 12 个"剧情客户"专门对应今天访谈里拆出来的退款场景。明天结束时,一条 `make data` 就能把整个数据环境建好。
