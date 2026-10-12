---
title: 'Day 61 · 进阶开学:资深 Agent 工程师和中级差在哪'
description: '前 60 天让你能做出一个像样的 Agent,接下来 50 天要让你能扛住一个团队的 Agent 系统。先用 880 条 JD 里标题带「资深、专家、架构师」的那 42 条看清楚资深岗要什么,再看进阶篇的地图和要做的 AgentOps 平台,最后换一种学习方式:读论文、读源码、写设计文档。'
pubDate: 2026-10-12
regime: none
tags: ['senior', 'career', 'roadmap', 'agentops', 'agent-60']
series: 'agent-60'
day: 61
lang: 'zh'
---

## 今天要解决的问题

如果你是一路从 Day 0 走过来的,现在手里有一个能跑的 SupportPilot、一个代码审查 Agent,能说清楚 Agent 循环、RAG、MCP、评测和上线那一套。这已经够投大部分「AI Agent 开发工程师」岗位了。但你翻招聘网站时大概也注意到了,同样叫 Agent 工程师,有的标 25K,有的标 70K 起步还写着「16 薪」。差的那一截是什么,今天要先弄清楚。

学完今天,你应该能:

1. 用数据说出资深 Agent 岗位和普通岗位在薪资和要求上差多少,差在哪几项。
2. 拿一张能力对照表给自己打分,知道自己离资深还缺哪几块。
3. 看懂进阶篇 50 天的安排,以及每周练习最后怎么拼成 AgentOps 平台。
4. 换一种学习方式:从「跟着教程敲代码」变成「读一手资料、做实验、写文档」。

预计用时 3–4 小时,一半时间用在动手练习里那份自我评估和第一份 ADR 上。前置:学完 Day 0–60,手里有 SupportPilot 仓库。

## 先看数据:资深岗到底贵多少

基础篇 Day 59 讲薪资时用的是全部样本。今天换个切法:在 Boss 直聘和猎聘抓到的国内岗位里,把标题带「资深、专家、架构师、leader、负责人、高级」的挑出来,单独算。

带薪资的这类岗位有 42 条,挂牌年包(区间中点乘薪数)的中位数是 66 万,四分位是 47 万到 88 万。其余 375 条普通岗位,中位数 48 万,四分位 33 万到 71 万。也就是说,只看标题,资深岗的中位数比普通岗高出将近 40%,上四分位已经接近 90 万。样本不大,这个数字只能当方向看,但方向很清楚。

更有意思的是要求。这批资深岗里有 37 条抓到了完整的职位描述,我按关键词数了一下出现的比例:

| 关键词 | 出现比例 |
| --- | --- |
| 落地 | 84% |
| 架构 | 73% |
| 上下文 | 54% |
| 评测 | 51% |
| 平台 | 46% |
| 稳定性 | 46% |
| 主导 / owner | 38% |
| 多 Agent | 30% |
| 成本 | 27% |
| MCP | 24% |
| 微调 / SFT / RL | 11% |

几个读法。第一,「落地」和「架构」几乎是标配,说明资深岗要的不是会用某个框架,而是能把一件事从设计做到线上跑稳。第二,「平台」和「稳定性」都接近一半,资深的人经常要做的是给别的团队用的东西,而且要扛线上事故。第三,「主导」出现了 38%,这是普通岗 JD 里很少见的词。第四,微调和强化学习只有一成,别被网上「不会训练模型就不是资深」的说法吓到,它是加分项,不是门槛。

海外的情况在 Day 59 讲过:美国 Staff 级岗位的年限要求普遍在 8 年以上,职位描述里 design doc、mentoring、cross-team 这几个词很常见。国内外在这一点上是一致的,资深的核心是判断力和影响力,不是多会几个库。

拿一条真实的 JD 看看味道。腾讯营销线一个「AI Agent 架构师」岗位,职责里写的是:搭建平台级的统一 Agent 中枢,主导多子 Agent 集群编排与调度,搭建跨层全局记忆与上下文体系,设计 B 端和 C 端资产的共享复用机制。你会发现每一句都在说「平台」「体系」「机制」,没有一句是「用 LangChain 开发某某功能」。

<figure>
<svg viewBox="0 0 640 240" role="img" aria-label="普通岗与资深岗挂牌年包对比:普通岗 P25 33 万、中位 48 万、P75 71 万;资深岗 P25 47 万、中位 66 万、P75 88 万">
  <rect x="0" y="0" width="640" height="240" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">
    <line x1="120" y1="200" x2="600" y2="200" stroke="var(--rule)"/>
    <text x="120" y="218" text-anchor="middle">20 万</text>
    <text x="240" y="218" text-anchor="middle">40 万</text>
    <text x="360" y="218" text-anchor="middle">60 万</text>
    <text x="480" y="218" text-anchor="middle">80 万</text>
    <text x="600" y="218" text-anchor="middle">100 万</text>
  </g>
  <text x="20" y="84" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">普通岗</text>
  <text x="20" y="100" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">375 条</text>
  <line x1="198" y1="90" x2="426" y2="90" stroke="var(--mem)" stroke-width="2"/>
  <rect x="198" y="72" width="228" height="36" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <line x1="288" y1="72" x2="288" y2="108" stroke="var(--mem)" stroke-width="3"/>
  <text x="288" y="64" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">中位 48</text>
  <text x="20" y="154" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">资深岗</text>
  <text x="20" y="170" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">42 条</text>
  <rect x="282" y="142" width="246" height="36" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <line x1="396" y1="142" x2="396" y2="178" stroke="var(--compute)" stroke-width="3"/>
  <text x="396" y="134" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">中位 66</text>
  <text x="282" y="194" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">47</text>
  <text x="528" y="194" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">88</text>
  <text x="198" y="124" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">33</text>
  <text x="426" y="124" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">71</text>
</svg>
<figcaption>框是 P25 到 P75,粗线是中位数,单位万元/年。数据来自 2026 年 10 月 Boss 直聘和猎聘的挂牌薪资,资深岗按标题关键词筛选,样本少,看方向。</figcaption>
</figure>

## 中级和资深,差的是哪几种能力

我把 JD 里的要求、几家公司公开的工程师职级描述、还有自己面试别人的经验揉在一起,整理成下面这张表。左边是你学完基础篇大概的样子,右边是资深岗想要的样子。

| 维度 | 中级(学完 Day 60) | 资深 |
| --- | --- | --- |
| 设计 | 会用一种架构把需求做出来 | 能比较两三种架构,用数据说明为什么选这个,并写清楚什么时候该换 |
| 评测 | 有测试集,会跑分 | 知道分数差多少才算数,能设计线上实验,评测体系能被别人复用 |
| 规模 | 单个服务能上线 | 能估算 10 倍流量下的成本、延迟、容量,知道哪里先撑不住 |
| 平台 | 为一个业务写一个 Agent | 把运行时、工具接入、评测做成别的团队能用的平台 |
| 模型 | 会选 API、会写提示词 | 知道什么时候该自部署、该微调、该蒸馏,能算清总成本 |
| 稳定性 | 加了重试和超时 | 能设计持久化执行、降级和熔断,出事故能带着复盘 |
| 信息源 | 看教程、看视频 | 读论文、读源码、读官方工程博客,自己找答案 |
| 影响力 | 把自己的活干好 | 写设计文档说服别人,带新人,推动跨团队采用 |

这张表里没有一项是「会某个新框架」。框架半年一变,上面这些能力换什么框架都用得上。这也是进阶篇的写法跟基础篇不一样的原因:基础篇在教你做出东西,进阶篇在教你做判断。

拿一个具体场景感受一下差别。假设 SupportPilot 上线一个月后,运营反馈「最近转人工的工单变多了」。

中级的做法通常是:翻几条转人工的 trace,发现分类节点把一些账单问题分成了 other,改一下分类提示词,加几个 few-shot 例子,在测试集上跑一遍分数涨了两个点,提交。

资深的做法是先问几个问题。转人工率涨了多少,是绝对数还是比例,跟工单总量、工单类型分布的变化有没有关系?是不是上周换了模型版本或者知识库更新导致的?然后从线上 trace 里按类别抽样做错误分析,把失败分成几类各占多少。改完以后,两个点的提升在 60 条测试集上是不是统计显著?上线时用灰度,盯着转人工率和客户重问率两个指标,准备好回滚。最后写一页复盘,把这次发现的失败类型加进回归测试集,让它不会再悄悄回来。

两种做法写的代码可能差不多,差的是前后那一圈。进阶篇的 W11 会专门讲后面这一圈里的统计和实验,W13 讲事故复盘。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="同一个问题,中级做法只有改提示词和跑分两步,资深做法前后多了定位、统计检验、灰度和复盘">
  <rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)"/>
  <text x="20" y="40" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">中级</text>
  <g font-family="var(--font-mono)" font-size="11" text-anchor="middle">
    <rect x="200" y="22" width="110" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="255" y="41" fill="var(--ink)">改提示词</text>
    <rect x="330" y="22" width="110" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="385" y="41" fill="var(--ink)">跑测试集</text>
  </g>
  <text x="20" y="130" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">资深</text>
  <g font-family="var(--font-mono)" font-size="11" text-anchor="middle">
    <rect x="70" y="112" width="100" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="120" y="131" fill="var(--ink)">先定位原因</text>
    <rect x="200" y="112" width="110" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="255" y="131" fill="var(--ink)">改提示词</text>
    <rect x="330" y="112" width="110" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="385" y="131" fill="var(--ink)">跑测试集</text>
    <rect x="460" y="112" width="80" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="500" y="131" fill="var(--ink)">显著吗</text>
    <rect x="460" y="160" width="80" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="500" y="179" fill="var(--ink)">灰度上线</text>
    <rect x="550" y="160" width="74" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="587" y="179" fill="var(--ink)">复盘入库</text>
  </g>
  <g stroke="var(--ink-faint)" fill="none">
    <line x1="170" y1="127" x2="200" y2="127"/><line x1="310" y1="127" x2="330" y2="127"/><line x1="440" y1="127" x2="460" y2="127"/><line x1="500" y1="142" x2="500" y2="160"/><line x1="540" y1="175" x2="550" y2="175"/>
  </g>
  <text x="320" y="210" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">琥珀色那几步,就是进阶篇要补的</text>
</svg>
<figcaption>中间两步一样,差别在前后。定位原因、判断显著性、灰度和复盘,决定了改动是真的变好还是碰巧变好。</figcaption>
</figure>

## 进阶篇 50 天的地图

进阶篇从 Day 61 到 Day 110,分七块:

**W10 Agent 架构深水区(Day 61–67)**。harness 怎么设计、长任务里的上下文怎么管、记忆系统怎么写和怎么忘、跑几小时的任务怎么不怕重启、单 Agent 和多 Agent 到底怎么选。这周结束时你要写出一份 Agent 运行时的设计文档。

**W11 评测科学(Day 68–74)**。评测在团队里怎么组织,样本量和显著性,大规模 LLM 评审的校准,线上 A/B,自动化红队,自己设计 benchmark。

**W12 模型层(Day 75–81)**。用自己的评测集选模型,vLLM 自部署,LoRA 微调,DPO,蒸馏和路由,强化学习在 Agent 上的用法。这周会训练一个路由小模型。

**W13 平台化与规模(Day 82–88)**。多租户平台架构、模型网关、MCP 网关和 OAuth、规模化可观测、治理合规、事故复盘。

**W14 前沿形态(Day 89–95)**。Coding Agent 内部、Computer Use、语音 Agent、Deep Research、A2A 协议、Agent 的产品交互。

**W15–W16 进阶毕业项目(Day 96–105)**。把前面的零件拼成 AgentOps 平台。

**W17 资深求职(Day 106–110)**。设计文档和 ADR、Staff 级系统设计面试、带人和推动、开源影响力、资深谈薪。

### 要做的项目:AgentOps 平台

基础篇的毕业项目是一个 Agent。进阶篇的毕业项目是让很多 Agent 跑在上面的平台。设想云簿公司把 SupportPilot 做成功以后,销售、财务、研发几个团队都想要自己的 Agent。如果每个团队都从头写一遍模型调用、工具鉴权、评测和监控,三个月后公司里会有五套互不兼容的轮子,每套都有自己的坑。AgentOps 要解决的就是这个问题。

它大致有这几层:

- **模型网关**:所有模型调用都过它,负责路由、限流、按租户配额、供应商故障切换、成本归因。
- **MCP 工具中心**:工具统一注册,按租户和用户授权,每次调用都有审计日志。
- **持久化运行时**:长任务能断点续跑,人工审批这类步骤能等几个小时。
- **评测平台**:离线回归带统计检验,线上做 A/B 分流。
- **可观测**:OpenTelemetry 全链路,成本看板,告警。
- **路由小模型**:用 SupportPilot 积累的数据微调一个小模型,接住大部分简单请求。

W10 到 W14 每周的练习都在给它准备零件,到 W15 拼起来。做完以后,你的作品集里就同时有「一个能用的 Agent」和「一个让 Agent 规模化的平台」,后者正好对上那 46% 提「平台」的资深 JD。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="AgentOps 平台分层:上面是多个团队的 Agent,中间是运行时,下面是模型网关和 MCP 工具中心,两侧是评测平台和可观测">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11" text-anchor="middle">
    <rect x="150" y="16" width="100" height="32" rx="4" fill="none" stroke="var(--ink-soft)"/><text x="200" y="36" fill="var(--ink)">SupportPilot</text>
    <rect x="270" y="16" width="100" height="32" rx="4" fill="none" stroke="var(--ink-soft)"/><text x="320" y="36" fill="var(--ink)">销售 Agent</text>
    <rect x="390" y="16" width="100" height="32" rx="4" fill="none" stroke="var(--ink-soft)"/><text x="440" y="36" fill="var(--ink)">财务 Agent</text>
    <rect x="150" y="70" width="340" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="320" y="88" fill="var(--ink)">持久化运行时 harness</text>
    <text x="320" y="103" fill="var(--ink-soft)" font-size="10">循环 · 上下文 · 记忆 · 断点续跑 · 人工步骤</text>
    <rect x="150" y="130" width="160" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="230" y="149" fill="var(--ink)">模型网关</text>
    <text x="230" y="165" fill="var(--ink-soft)" font-size="10">路由 · 配额 · 成本归因</text>
    <rect x="330" y="130" width="160" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="410" y="149" fill="var(--ink)">MCP 工具中心</text>
    <text x="410" y="165" fill="var(--ink-soft)" font-size="10">注册 · OAuth · 审计</text>
    <rect x="150" y="196" width="160" height="32" rx="4" fill="none" stroke="var(--ink-soft)"/><text x="230" y="216" fill="var(--ink)">云端模型 + 路由小模型</text>
    <rect x="330" y="196" width="160" height="32" rx="4" fill="none" stroke="var(--ink-soft)"/><text x="410" y="216" fill="var(--ink)">业务系统 · 知识库</text>
    <rect x="20" y="70" width="110" height="158" rx="4" fill="none" stroke="var(--mem)" stroke-dasharray="4 3"/>
    <text x="75" y="140" fill="var(--ink)">评测平台</text><text x="75" y="156" fill="var(--ink-soft)" font-size="10">回归 · A/B</text>
    <rect x="510" y="70" width="110" height="158" rx="4" fill="none" stroke="var(--mem)" stroke-dasharray="4 3"/>
    <text x="565" y="140" fill="var(--ink)">可观测</text><text x="565" y="156" fill="var(--ink-soft)" font-size="10">OTel · 看板</text>
  </g>
  <g stroke="var(--rule)"><line x1="320" y1="48" x2="320" y2="70"/><line x1="230" y1="110" x2="230" y2="130"/><line x1="410" y1="110" x2="410" y2="130"/><line x1="230" y1="174" x2="230" y2="196"/><line x1="410" y1="174" x2="410" y2="196"/></g>
  <text x="320" y="252" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">蓝色是模型这一侧,琥珀色是对接外部系统的那一侧</text>
</svg>
<figcaption>AgentOps 的分层。业务团队只写自己那个 Agent 的逻辑,模型、工具、评测、监控都由平台统一提供。</figcaption>
</figure>

## 学习方式要换了

基础篇每天都有一段能照着敲的代码。进阶篇也有代码,但更多时候你要做的是下面这几件事。

**读一手资料**。Anthropic、OpenAI、LangChain、Cognition、Manus 这几家的工程博客,是目前 Agent 工程最好的教材,比任何二手解读都准确。论文也要开始读,不用每篇精读,至少能看懂摘要、方法图和实验表,知道它解决什么问题、代价是什么。我的习惯是每读一篇就写三行笔记:它说了什么,证据是什么,我的系统要不要跟着改。

**读源码**。框架文档只告诉你怎么用,源码才告诉你它怎么做取舍。Day 62 我们会读 OpenAI Agents SDK 和 LangGraph 的运行循环。读源码不用从头读到尾,带着一个问题去找答案,比如「工具调用失败时它怎么处理」,找到那几十行就够了。

**做实验而不是看结论**。网上关于「哪种上下文策略更好」「多 Agent 好不好」的结论很多,大部分是在别人的任务上测的。资深的做法是在自己的评测集上跑一遍,用数字说话。进阶篇的很多练习都是实验设计,结果表我会留空,你自己填。

**写文档**。每周最后一天的产出都是一份文档:设计文档、评测方案、选型报告。资深工程师花在写文档上的时间往往比写代码多,因为一份好的设计文档能让五个人少走一个月弯路。写得好不好,面试官看一眼你作品集里的文档就知道。

关于时间:进阶篇每天的内容比基础篇重,很多天需要 5 小时以上,微调和自部署那几天还要租 GPU。不用赶,宁可一天学透,也别跳过动手练习。

## 动手练习

今天的练习有两部分,都是写东西,不写代码。

**第一步:给自己做一次能力评估。** 复制上面那张中级和资深的对照表,每一行按 1 到 5 分给自己打分。1 分是「没接触过」,3 分是「做过,但说不清为什么这样做」,5 分是「能给别人讲清楚并且有作品证明」。每一行写一句证据,比如「评测 3 分:SupportPilot 有 100 条测试集,但从没判断过改动是否显著」。

**第二步:找出三个最低分。** 对照进阶篇地图,标出这三项分别在哪一周补。这三周学的时候多花时间。

**第三步:写你的第一份 ADR。** ADR(架构决策记录)是资深工程师最常写的小文档。回顾 SupportPilot,挑一个你当时做过的技术决定,比如「为什么用 pgvector 不用 Milvus」或者「为什么用 LangGraph 不自己写循环」,按下面这个模板写一份,放进仓库的 `docs/adr/0001-xxx.md`:

```markdown
# 0001 · 知识库向量存储选用 pgvector

- 状态:已采纳
- 日期:2026-10-12

## 背景
SupportPilot 的知识库约 60 篇帮助文章、几百个切块,业务数据已经在 Postgres 里。
需要一个支持向量检索和关键词检索的存储。

## 考虑过的方案
1. pgvector:和业务库同一个 Postgres,运维成本最低。
2. Milvus:专业向量库,适合亿级向量,但要多运维一套服务。
3. Chroma:上手快,但多副本和权限控制弱。

## 决定
选 pgvector。

## 理由
- 数据量小两个数量级,用不上专业向量库的优势。
- 混合检索可以直接用 Postgres 全文检索,不用再接一套。
- 团队只有一个人,少一套服务就少一类故障。

## 代价和重新评估的条件
- 向量数超过 500 万,或检索 P95 超过 200ms 时,重新评估 Milvus。
- 多租户隔离要靠行级权限,复杂度在应用层。
```

**验收标准**:能力评估每一行都有一句具体证据;三个短板都对应到了周;ADR 里有至少两个被放弃的方案,并写清楚了「什么情况下要推翻这个决定」。最后一条最重要,它是 ADR 和普通技术说明的区别。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 资深 / Senior | 能独立负责一块系统的设计和交付,在不确定中做取舍 |
| Staff 工程师 | 资深再往上一级,影响范围跨多个团队,常见于海外公司职级 |
| ADR | Architecture Decision Record,架构决策记录,一页纸记下一个决定的背景、方案、理由和代价 |
| 设计文档 | 动手前写的方案文档,包含目标、非目标、方案、取舍、风险,供团队评审 |
| AgentOps | 本课进阶项目的名字,指让多个 Agent 规模化运行的平台和流程 |
| 多租户 | 一套系统同时服务多个团队或客户,彼此数据和配额隔离 |
| 挂牌薪资 | JD 上写的薪资区间,不等于实际 offer |

## 常见误区

**以为资深就是会更多框架。** 数据显示资深 JD 最常出现的是落地、架构、平台、稳定性这些词,框架名反而不显眼。多学一个框架,不如把一个系统的取舍讲透。

**以为不会训练模型就当不了资深。** 资深 Agent 岗位里提微调和强化学习的只有一成左右。W12 会讲这块,目的是让你知道什么时候该用、怎么跟算法同事配合,不是让你转行做算法。

**把读论文当成负担一口气读完。** 论文是工具,带着问题读。大部分时候读摘要、看方法图和实验表就够了,只有决定要用它的时候才精读。

**跳过写文档。** 很多工程师觉得写文档浪费时间,能写代码就不写字。资深面试几乎一定会问「讲一个你主导的技术决策」,平时没写过 ADR 和设计文档的人,这道题很难答得有条理。

**进阶篇太重就开始跳天。** 宁可慢一点。进阶篇的每一周都会被后面的毕业项目用到,跳过的部分最后还是要补。

## 学习资料

### 文档与文章

- [Anthropic《Building effective agents》](https://www.anthropic.com/engineering/building-effective-agents):基础篇读过。进阶篇开学再读一遍,这次注意它怎么论证「先用最简单的方案」,这就是资深的思维方式。20 分钟。
- [Anthropic《Effective harnesses for long-running agents》](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents):2025 年 11 月的文章,讲跨很多个上下文窗口的长任务怎么设计 harness。明天的主题,今天先扫一遍。15 分钟。
- [Design Docs at Google](https://www.industrialempathy.com/posts/design-docs-at-google/):Google 工程师写的设计文档实践,讲清楚设计文档为什么存在、写什么、不写什么。30 分钟。
- [ADR 社区站](https://adr.github.io/) 和 [ADR 模板合集](https://github.com/joelparkerhenderson/architecture-decision-record):挑一个模板用,不用纠结哪个最好。
- [Lilian Weng《LLM Powered Autonomous Agents》](https://lilianweng.github.io/posts/2023-06-23-agent/):2023 年的老文章,但它把规划、记忆、工具三块的框架搭得很清楚,W10 讲记忆时会用到。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1zWdfBTEyx&autoplay=0&high_quality=1" title="我们如何构建高效的智能体:How We Build Effective Agents: Barry Zhang, Anthropic" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>全球AI情报局 · 我们如何构建高效的智能体:How We Build Effective Agents: Barry Zhang, Anthropic · 15 分钟,带中文字幕的搬运。重点听他讲「什么时候不该做 Agent」和「从 Agent 的视角看问题」两段。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1FAWGzVEWF&autoplay=0&high_quality=1" title="Anthropic构建高效agent的第一性原理:精读《Building effective agents》①" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>慢学AI · Anthropic构建高效agent的第一性原理:精读《Building effective agents》① · 10 分钟。中文逐段精读,适合配合原文一起看。这个 UP 主后面还有几集,讲各个 workflow 模式。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/D7_ipDqhtwk" title="How We Build Effective Agents: Barry Zhang, Anthropic" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · How We Build Effective Agents: Barry Zhang, Anthropic · 上面 B 站搬运的原版,英文好的直接看这个。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/FqPwHHrN1bg" title="What is Agentic AI Engineering (Meta Staff Engineer Explains)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>John Kim · What is Agentic AI Engineering (Meta Staff Engineer Explains) · 一个 Meta Staff 工程师讲他眼里的 Agent 工程是什么。可以对照今天的能力表,看他强调的是哪几项。</figcaption>
</figure>

### 书籍

- Will Larson《Staff Engineer: Leadership beyond the management track》(2021),[作者官网](https://staffeng.com/book):讲 Staff 工程师的几种类型和日常工作。今天读第一部分,搞清楚资深之后的路长什么样。
- Tanya Reilly《The Staff Engineer's Path》(O'Reilly,2022):比上一本更偏实操,讲怎么看全局、怎么推动跨团队的事。W17 之前读完前三章即可。
- Chip Huyen《AI Engineering》(O'Reilly,2025),[配套仓库](https://github.com/chiphuyen/aie-book):基础篇已经推荐过。进阶篇会反复回到第 4 章(评测)和第 10 章(架构与用户反馈)。

### 开源项目与代码

- [humanlayer/12-factor-agents](https://github.com/humanlayer/12-factor-agents):把生产级 Agent 的原则写成 12 条,很多条和 W10 的内容对应。今天通读一遍目录,后面几天会逐条用到。
- 你自己的 SupportPilot 仓库:今天建一个 `docs/adr/` 目录,把练习里那份 ADR 放进去。进阶篇每做一个重要决定都往里加一份。

## 自测

1. 资深 Agent 岗位的 JD 里,出现比例最高的两个词是什么?它们说明资深岗在要什么?

<details><summary>答案</summary>

「落地」(84%)和「架构」(73%)。说明资深岗要的是能把一个系统从设计做到线上跑稳的人,不是会用某个框架的人。

</details>

2. 资深岗挂牌年包的中位数大约比普通岗高多少?这个数字有什么局限?

<details><summary>答案</summary>

资深 66 万对普通 48 万,高出将近 40%。局限:样本只有 42 条,而且是按标题关键词筛的,有的公司标题不写「资深」但其实是资深岗;挂牌价也不等于实际 offer。只能看方向。

</details>

3. ADR 和普通的技术说明文档,最关键的区别是什么?

<details><summary>答案</summary>

ADR 记录的是「一个决定」,必须写出被放弃的方案、选这个的理由,以及什么条件下要推翻这个决定。普通说明文档只描述系统现在是什么样,不记录为什么。

</details>

4. 进阶篇的毕业项目 AgentOps 和基础篇的 SupportPilot 是什么关系?

<details><summary>答案</summary>

SupportPilot 是跑在平台上的一个 Agent;AgentOps 是让很多 Agent 共用模型网关、工具中心、运行时、评测和监控的平台。进阶篇会把 SupportPilot 迁移到 AgentOps 上作为第一个租户。

</details>

5. 资深面试题:「SupportPilot 上线后转人工率上升了,你会怎么处理?」请用两分钟讲清楚你的步骤。

<details><summary>答案</summary>

要点:先确认指标本身(绝对数还是比例,和工单量、类型分布变化的关系,最近有没有模型、知识库、提示词的变更);再从线上 trace 按类别抽样做错误分析,把失败分类并计数;针对占比最高的类别改动,在测试集上验证并判断改动是否显著;灰度上线,盯转人工率和重问率,准备回滚;最后复盘,把新发现的失败类型加入回归集。答题时重点讲「怎么确认问题、怎么证明改好了、怎么防止复发」,而不只是「改了提示词」。

</details>

6. 为什么进阶篇建议读一手资料而不是二手解读?

<details><summary>答案</summary>

Agent 领域变化快,二手解读经常过时或带有作者的误读。一手资料(官方工程博客、论文、源码)能看到原始证据和作者自己承认的局限,这是做判断时最需要的东西。

</details>

## 明天预告

Day 62 · Agent Harness 设计:把循环做成可复用的运行时。我们会读 OpenAI Agents SDK、Claude Agent SDK 和 LangGraph 的运行时源码,看三家在循环、工具、权限、钩子、子 Agent 和状态持久化上各自怎么取舍,然后给 AgentOps 设计一个自己的 harness 接口。
