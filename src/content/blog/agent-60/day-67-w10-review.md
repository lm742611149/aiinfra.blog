---
title: 'Day 67 · W10 复习:写一份 Agent 运行时的设计文档'
description: 'W10 的五个主题合成一份正式的设计文档:AgentOps 运行时的背景、目标与非目标、方案、被放弃的选项、风险和评测计划。先讲设计文档为什么存在、写什么不写什么,再给出一份完整示范和两份 ADR,最后是这周的资深面试题汇总和坑清单。'
pubDate: 2026-10-12
regime: none
tags: ['design-doc', 'adr', 'review', 'agentops', 'agent-60']
series: 'agent-60'
day: 67
lang: 'zh'
---

## 今天要解决的问题

这周学了五样东西:harness 怎么分层、长任务的上下文怎么管、记忆怎么写和忘、长任务怎么不怕重启、架构怎么选。每一样单独拿出来你都能讲,但真到工作里,没有人会让你「讲一讲上下文压缩」。你会接到的任务是:「我们要给五个团队做一个统一的 Agent 运行时,你出个方案。」

这时候要交的东西就是一份设计文档。资深工程师和中级工程师在产出上最明显的区别之一,就是前者大量时间花在写这种文档上。一份好的设计文档能让评审的人在半小时内看懂你要做什么、为什么这样做、放弃了什么、风险在哪,然后在动手之前就把最贵的错误拦下来。

学完今天你应该能:

1. 说清楚设计文档的结构,以及每一部分要回答的问题。
2. 把 W10 的五个主题组织进一份 AgentOps 运行时的设计文档。
3. 写出「被放弃的方案」这一节,而且写得让人信服。
4. 回答这周的资深面试题。

预计用时 5–6 小时,大部分时间在写自己的那份文档。前置:Day 61–66。

## 一页纸的知识地图

先把这周的东西串一遍。

| 天 | 主题 | 最该记住的一句话 |
| --- | --- | --- |
| 61 | 资深和中级的区别 | 资深岗要的是落地、架构、平台、稳定性,不是会更多框架 |
| 62 | harness 设计 | 循环要薄,其余六层都是扩展点;预算和审批是硬约束 |
| 63 | 上下文进阶 | 窗口大不等于看得清;前缀稳定才能命中缓存;按轮裁剪,先清工具结果再摘要 |
| 64 | 记忆系统 | 先分类再设计;业务数据以系统为准;来源有优先级;一定要会忘 |
| 65 | 持久化执行 | 记日志加重放;模型调用必须被记录;副作用必须带幂等键 |
| 66 | 编排取舍 | 争的是子任务之间的依赖;读易写难;用实验按难度做决定 |

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="W10 五个主题如何对应到运行时设计文档的各个章节">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="30" y="30" fill="var(--ink-faint)">这周学的</text>
    <text x="400" y="30" fill="var(--ink-faint)">设计文档里的位置</text>
    <g text-anchor="middle">
      <rect x="30" y="44" width="170" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="115" y="63" fill="var(--ink)">Day 62 harness 分层</text>
      <rect x="30" y="84" width="170" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="115" y="103" fill="var(--ink)">Day 63 上下文</text>
      <rect x="30" y="124" width="170" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="115" y="143" fill="var(--ink)">Day 64 记忆</text>
      <rect x="30" y="164" width="170" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="115" y="183" fill="var(--ink)">Day 65 持久化</text>
      <rect x="30" y="204" width="170" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="115" y="223" fill="var(--ink)">Day 66 编排</text>
      <rect x="400" y="44" width="210" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="505" y="63" fill="var(--ink)">方案:接口与扩展点</text>
      <rect x="400" y="94" width="210" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="505" y="113" fill="var(--ink)">方案:默认策略</text>
      <rect x="400" y="144" width="210" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="505" y="163" fill="var(--ink)">被放弃的方案</text>
      <rect x="400" y="194" width="210" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="505" y="213" fill="var(--ink)">风险与评测计划</text>
    </g>
  </g>
  <g stroke="var(--rule)" fill="none">
    <line x1="200" y1="59" x2="400" y2="59"/>
    <line x1="200" y1="99" x2="400" y2="109"/><line x1="200" y1="139" x2="400" y2="109"/>
    <line x1="200" y1="179" x2="400" y2="109"/><line x1="200" y1="179" x2="400" y2="209"/>
    <line x1="200" y1="219" x2="400" y2="159"/><line x1="200" y1="59" x2="400" y2="159"/>
  </g>
</svg>
<figcaption>这周的每个主题都会在设计文档里出现,有的变成方案,有的变成被放弃的选项,有的变成风险。</figcaption>
</figure>

## 设计文档写什么

Google 工程师 Malte Ubl 写过一篇《Design Docs at Google》,是关于设计文档最常被引用的文章之一。他的核心观点是:设计文档的价值在于**在改动还便宜的时候发现问题**,以及在组织里形成共识、留下决策的历史。代码写完以后再发现方向错了,代价是设计阶段的几十倍。

结合那篇文章和我自己的经验,一份设计文档通常包括这几部分:

**背景**。现在是什么情况,为什么需要做这件事。写给不了解上下文的评审人看,三五段就够,不要写成需求文档。

**目标和非目标**。目标要能验证,比如「新团队接入一个 Agent 不超过两天」,而不是「提升开发效率」。非目标同样重要,它写的是「这件事听起来相关,但我们这次不做」,比如「不做可视化编排界面」。没有非目标的文档,评审时一定会有人问「为什么不顺便把 X 也做了」。

**方案**。系统的样子:架构图、关键接口、数据怎么流、默认策略。重点写设计决定,不要写实现细节。评审人关心的是「为什么用日志重放而不是定期快照」,不是函数怎么命名。

**被放弃的方案**。这一节最能体现资深程度。至少写两个认真考虑过的替代方案,说清楚它们好在哪、为什么最后没选。写得好的话,评审时大部分「为什么不用 X」的问题都会被提前回答。

**横切关注点**。安全、隐私、成本、可观测、合规。不一定每项都长,但每项都要有一句话说明考虑过了。

**风险和未决问题**。哪些地方你自己也没把握,打算怎么验证。诚实地写出来,比假装一切都想清楚了更让人信任。

**评测和上线计划**。怎么证明它有效,分几步上线,出问题怎么回滚。

长度上,Ubl 的文章里说比较大的项目一般十到二十页,小一些的改动可以写成一两页的「迷你设计文档」。AgentOps 运行时这个规模,写五到八页比较合适。

还有一点:**设计文档不是写完就扔的**。实现过程中如果做了和文档不一样的决定,回去更新文档,或者另写一份 ADR 记录这个变化。半年后新同事来问「为什么这么设计」,文档是最好的答案。

## 示范:AgentOps 运行时设计文档

下面是一份完整但精简的示范,大约五页的内容压缩成了要点。你的版本应该更详细,尤其是方案和被放弃的方案两节。

```markdown
# AgentOps 运行时设计文档

作者:你 · 评审人:平台组、SupportPilot 组、财务 Agent 组 · 状态:评审中 · 2026-10

## 1. 背景
云簿已有一个上线的客服 Agent(SupportPilot)。销售、财务、研发三个团队计划在下季度各自做 Agent。
SupportPilot 的循环、工具接入、审批、上下文管理是为它自己写的,其他团队无法复用。
如果各团队各写一套,预计会出现五套互不兼容的实现,审计、成本控制和事故排查都无法统一。

## 2. 目标
- G1:新团队基于运行时接入一个带工具和审批的 Agent,不超过 2 人日。
- G2:任意 Agent 运行在进程重启后可恢复,有副作用的工具调用不重复执行。
- G3:每个运行都有统一的步数、token 预算上限和审计记录,业务方不能关闭。
- G4:SupportPilot 迁移到运行时后,W5 评测集成功率不下降(差异不显著),单张工单成本不上升超过 5%。

## 3. 非目标
- 不做可视化拖拽编排(业务方用代码定义 Agent)。
- 不做模型网关(另见 W13 网关设计,本运行时通过接口调用网关)。
- 不支持跨租户共享记忆。
- 本期不内置多 Agent 编排,只提供子 Agent 调用的基础能力。

## 4. 方案
### 4.1 分层
循环(薄)+ 六个扩展点:Model、ContextManager、PermissionPolicy、Hook、StateStore、Memory。
接口定义见附录 A(即 Day 62 的 harness 接口,补充 Memory)。
### 4.2 默认策略
- 上下文:LayeredContext,按轮裁剪;超预算先清理工具结果,再摘要;system 和工具定义前缀固定。
- 权限:有副作用的工具默认审批;租户可配置金额阈值等规则。
- 记忆:按租户和主体隔离;后台写入;来源优先级;按类型设有效期;支持按主体删除。
- 持久化:所有模型调用和工具调用通过 step 记录,日志存 Postgres;副作用调用自动生成幂等键。
### 4.3 硬约束
最大步数、token 预算、副作用审批默认开启、审计日志。可调数值,不可关闭。
### 4.4 数据流
请求 → 运行时创建 run → 每步写日志 → 需要审批时状态落库并返回 → 审批回调恢复 → 结束写审计。

## 5. 被放弃的方案
### 5.1 直接采用 Claude Agent SDK 作为运行时
优点:成熟的 harness,压缩、工具、子 Agent 现成。
放弃原因:循环在外部进程中,难以接入我们的日志重放和幂等机制;各团队模型选择不同,
需要支持 DeepSeek 等非 Claude 模型。保留为 Model 的一种实现,供适合的团队使用。
### 5.2 以 LangGraph 为运行时基础
优点:checkpoint 和中断现成,SupportPilot 已在用。
放弃原因:checkpoint 粒度为节点,节点内副作用需各团队自行保证幂等,
平台无法统一兜底;对只需要简单循环的团队,图的写法成本偏高。
LangGraph 仍可作为业务方在运行时之上编排的工具。
### 5.3 直接引入 Temporal
优点:持久化执行最成熟。
放弃原因:团队目前无人有 Temporal 运维经验,确定性约束需要所有业务方学习。
本期用自研日志重放(Postgres),接口保持与 Temporal activity 语义一致,
当运行时长超过 24 小时的任务占比超过 10% 时重新评估。

## 6. 横切关注点
- 安全:工具调用前经过权限策略;审计日志不可被业务方修改。
- 隐私:记忆层拒绝敏感字段;删除请求 7 天内物理清除。
- 成本:每个 run 记录 token 与缓存命中;预算超限即停。
- 可观测:钩子对接 OpenTelemetry(W13 细化)。

## 7. 风险与未决问题
- R1:自研日志重放在多进程恢复时的并发问题,计划用行锁,需压测验证。
- R2:摘要压缩可能丢失关键信息,需在长任务评测集上量化。
- Q1:子 Agent 的预算是否从父 run 的预算中扣除?倾向于是,待评审讨论。

## 8. 评测与上线
- 离线:W5 评测集 + Day 63 长任务集,对比迁移前后成功率、成本、P95。
- 故障注入:在随机步骤 kill 进程,验证恢复结果一致、副作用不重复。
- 上线:SupportPilot 先 5% 流量,两周无回退后全量;再接入财务 Agent。
- 回滚:保留旧循环代码一个月,配置开关切换。
```

几个写法上的细节。目标都带了可验证的数字,G4 甚至写了「差异不显著」,这为 W11 的统计检验埋了伏笔。非目标里写了「不做模型网关」并指向另一份设计,避免评审时话题跑偏。被放弃的方案每一个都先写优点,再写放弃的原因,最后写「在什么条件下重新评估」或者「它在新方案里还扮演什么角色」,这让人觉得你是认真比较过的,而不是为了否定而否定。风险部分写了自己没把握的地方和验证办法。

## 两份配套的 ADR

设计文档讲的是整体方案,具体的决定用 ADR 单独记录,方便以后单独查找和推翻。Day 61 你写过第一份,这里再给两份和运行时相关的。

```markdown
# 0002 · 运行时持久化采用自研日志重放,暂不引入 Temporal

- 状态:已采纳 · 日期:2026-10-12
## 背景
运行时需要支持进程重启后恢复,以及审批等待数小时。
## 决定
用 Postgres 存每一步的结果,重放恢复;副作用调用自动生成幂等键。
## 理由
团队无 Temporal 运维经验;当前最长任务约 3 小时;只需要一张表。
## 代价
多进程并发恢复、卡住任务的发现与调度需要自己实现。
## 重新评估条件
运行超过 24 小时的任务占比超过 10%,或自研方案一个季度内出现 2 次以上恢复相关事故。
```

```markdown
# 0003 · 上下文管理默认「先清工具结果,再摘要」

- 状态:已采纳 · 日期:2026-10-12
## 背景
长任务的输入 token 主要来自工具结果,摘要压缩需要额外调用模型。
## 决定
默认 LayeredContext:超预算时先批量清理旧工具结果,仍超预算再摘要。
## 理由
Day 63 的长任务实验中,只清理工具结果即可减少约八成 token(以你的实验数据为准)。
## 代价
被清理的结果需要时要重新调用工具;每次批量清理会让一段缓存失效。
## 重新评估条件
长任务评测集成功率比不压缩的基线低 3 个百分点以上(且显著)。
```

注意 0003 里那个「约八成」,你要换成自己在 Day 63 实验里跑出来的数。ADR 里的数字必须有出处,这是它能被信任的原因。

## 写好设计文档的几个习惯

**先写目标和非目标,再写方案。** 很多人一上来就画架构图,写到一半才发现目标没想清楚。目标定了,方案的取舍才有标准。

**评审之前先找一个人看。** 正式评审会上被问倒,改起来更麻烦。先找一个同事或者用 Claude 当第一个读者,让它按一份清单挑毛病:目标是否可验证、非目标是否明确、每个被放弃的方案是否有条件、风险是否有验证办法。

**评审意见要有记录。** 文档末尾加一节「评审记录」,写下谁提了什么、怎么处理的。被否决的意见也写上理由,下次有人提同样的问题可以直接引用。

**用图,但别只有图。** 架构图能让人一眼看懂结构,但图上不会写为什么。每张图下面都要有文字说明关键的设计决定。

## W10 资深面试题汇总

下面这些题这周的各篇都出现过,今天集中再练一遍。建议每题先自己口头讲两分钟,录下来听一遍,再对照要点。

1. 你怎么判断一个改动真的让 Agent 变好了,而不是碰巧?(Day 61,W11 会深入)
2. 设计一个供多个团队使用的 Agent 运行时,哪些做成硬约束,哪些开放?(Day 62)
3. Agent 跑长任务成本是预期的 5 倍,越往后越容易出错,怎么排查?(Day 63)
4. 设计跨会话的客户记忆,要求不用错过期信息,满足删除权。(Day 64)
5. 需要审批、可能运行数天的退款流程,怎么保证不丢进度、不重复退款、能回滚?(Day 65)
6. 产品经理想把客服 Agent 全面升级成多 Agent,你怎么回应?(Day 66)
7. 讲一个你主导的技术决策,当时考虑过哪些方案,为什么选了现在这个?(今天)

<details><summary>第 7 题的答题结构</summary>

用设计文档的结构讲:背景一两句;目标(带数字);考虑过的两三个方案及各自优缺点;选择的理由;代价和你怎么缓解;结果(用数据说);如果重来会改什么。最后一点很加分,说明你会复盘。可以直接用 AgentOps 运行时或 SupportPilot 里的某个 ADR 当素材。

</details>

## W10 坑清单

- 按消息条数裁剪上下文,拆散了工具调用和结果。(Day 62、63)
- 系统提示词开头放时间戳,缓存命中率归零。(Day 63)
- 只限制步数不限制 token 预算。(Day 62)
- 把业务系统里有的数据存进记忆,系统改了记忆没改。(Day 64)
- 记忆没有有效期,Agent 拿过期信息自信地说错话。(Day 64)
- 用模型判断敏感信息要不要记。(Day 64)
- 在重放路径里直接调模型。(Day 65)
- 有副作用的调用不带幂等键。(Day 65)
- 只看成功率选架构,系统性地偏向最贵的方案。(Day 66)
- 设计文档没有非目标,没有被放弃的方案。(今天)

## 动手练习

**第一步:写你自己的设计文档。** 以上面的示范为骨架,写一份 AgentOps 运行时设计文档,放进 `agentops/docs/design/runtime.md`。方案部分要引用你这周写的代码(harness、LayeredContext、MemoryStore、DurableRun)和实验数据(Day 63、Day 66)。

**第二步:补齐两份 ADR。** 把上面的 0002、0003 改成你自己的版本,数字换成你的实验结果。再写一份 0004,记录你在 Day 66 实验后对 SupportPilot 架构的决定。

**第三步:找人评审。** 找一个同事,或者把文档和下面这份清单一起交给 Claude,让它当一个挑剔的评审人:

```text
请以资深工程师评审人的身份审阅这份设计文档,逐条检查并指出问题:
1. 每个目标是否可验证(有数字或明确的通过标准)?
2. 非目标是否写清楚,能挡住最可能出现的「顺便做一下」?
3. 每个被放弃的方案是否写了优点、放弃原因、重新评估条件?
4. 风险是否都有验证或缓解办法?
5. 评测计划能否证明目标达成?
6. 有没有横切关注点(安全、隐私、成本、可观测)被遗漏?
对每个问题给出具体的修改建议,不要泛泛而谈。
```

**第四步:根据评审修改,并在文末写评审记录。**

**验收标准**:设计文档包含全部八个部分;至少三个被放弃的方案,每个都有重新评估条件;引用了至少两组你自己的实验数据;有评审记录,记下至少五条意见及处理方式。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 设计文档 design doc | 动手前写的方案文档,用于评审和形成共识 |
| 目标 / 非目标 | 这次要达成的可验证结果 / 明确不做的相关事项 |
| 被放弃的方案 alternatives considered | 认真考虑过但没有采用的方案及原因 |
| 横切关注点 | 安全、隐私、成本、可观测等贯穿整个系统的问题 |
| 迷你设计文档 | 针对较小改动的一两页简化版设计文档 |
| 评审记录 | 设计评审中提出的意见及处理结果 |

## 常见误区

**设计文档写成需求文档或使用手册。** 需求文档写「要什么」,使用手册写「怎么用」,设计文档写「打算怎么做、为什么这么做、放弃了什么」。

**目标写得无法验证。** 「提升效率」「更稳定」没法判断有没有达成。每个目标都要有数字或明确的通过标准。

**被放弃的方案写成稻草人。** 只写缺点、不写优点的替代方案,评审人一眼就能看出来你没认真比较。

**觉得设计文档写完就完了。** 实现中改了方向不回来更新,半年后文档和系统对不上,比没有文档更误导人。

**等所有问题都想清楚再写。** 设计文档本来就是用来暴露问题的,把没把握的地方写进风险和未决问题,让评审帮你想。

## 学习资料

### 文档与文章

- [Malte Ubl《Design Docs at Google》](https://www.industrialempathy.com/posts/design-docs-at-google/):设计文档最经典的一篇,今天必读。30 分钟。
- [designdocs.dev](https://www.designdocs.dev/):收集了很多公司公开的设计文档范例,挑两三份和 Agent 或平台相关的看。
- [ADR 社区站](https://adr.github.io/):ADR 的来历和各种模板。
- [ADR 模板合集](https://github.com/joelparkerhenderson/architecture-decision-record):有大量真实例子,看别人怎么写「重新评估条件」。
- [humanlayer/12-factor-agents](https://github.com/humanlayer/12-factor-agents):拿它的 12 条对照你的设计文档,看有没有漏掉的原则。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV17s4y1J7rG&autoplay=0&high_quality=1" title="阿里工程师带你学技术文档该怎么写" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>阿里技术_AlibabaTech · 阿里工程师带你学技术文档该怎么写 · 30 分钟,国内大厂视角讲技术文档的结构和常见问题,三万多播放。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1WP4y1B7ym&autoplay=0&high_quality=1" title="程序员的软技能实战-写好设计文档" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>idx_done · 程序员的软技能实战-写好设计文档 · 5 分钟的短视频,几个实用的小建议。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/bgHL41e7vgI" title="What Is A Design Doc In Software Engineering? (full example)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Clément Mihailescu · What Is A Design Doc In Software Engineering? (full example) · 前 Google、Facebook 工程师逐节讲一份完整的设计文档,十几万播放。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/2Muxy3wE-E0" title="From Context Engineering to AI Agent Harnesses: The New Software Discipline" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Delphina · From Context Engineering to AI Agent Harnesses: The New Software Discipline · 把上下文工程和 harness 放在一起讲,正好是这周内容的总结,适合复习时看。</figcaption>
</figure>

### 书籍

- Titus Winters、Tom Manshreck、Hyrum Wright《Software Engineering at Google》(O'Reilly,2020):第 10 章讲文档,第 9 章讲代码评审,对理解「为什么写、写给谁」很有帮助。
- Tanya Reilly《The Staff Engineer's Path》(O'Reilly,2022):第 5 章「Leading Big Projects」讲怎么带大项目,其中写 RFC 和设计文档、推动评审的部分,是设计文档在组织里怎么起作用的实战指南。
- Will Larson《Staff Engineer》(2021),[作者官网](https://staffeng.com/book):里面有一章专门讲怎么写工程策略,和设计文档相辅相成。

### 开源项目与代码

- 你的 `agentops/docs/design/runtime.md` 和 `docs/adr/`:今天的产出,后面每周都会往里加。
- [anthropics/claude-agent-sdk-python](https://github.com/anthropics/claude-agent-sdk-python) 和 [openai/openai-agents-python](https://github.com/openai/openai-agents-python) 的 README:看成熟项目怎么用一页纸讲清楚自己的设计理念,写设计文档背景部分时可以借鉴。

## 自测

1. 设计文档最核心的价值是什么?

<details><summary>答案</summary>

在改动还便宜的时候发现问题,在组织里形成共识,并留下决策的历史供以后查阅。

</details>

2. 为什么非目标和目标一样重要?

<details><summary>答案</summary>

非目标明确了这次不做什么,挡住评审中「顺便把 X 也做了」的范围蔓延,也让读者知道方案的边界。

</details>

3. 「被放弃的方案」一节怎么写才有说服力?

<details><summary>答案</summary>

每个方案先写它的优点,再写放弃的具体原因,最后写在什么条件下会重新评估或者它在新方案中还扮演什么角色。只写缺点会显得是在立稻草人。

</details>

4. 设计文档和 ADR 的关系是什么?

<details><summary>答案</summary>

设计文档描述整体方案;ADR 记录单个具体决定的背景、理由、代价和重新评估条件,方便单独查找和推翻。实现中如果偏离设计文档,应该更新文档或新写 ADR。

</details>

5. 示范文档的目标 G4 为什么写「差异不显著」而不是「成功率不下降」?

<details><summary>答案</summary>

评测分数有随机波动,小样本上的小幅下降可能只是噪音。用「差异不显著」作为标准,需要配合统计检验判断,避免因为噪音误判迁移失败或成功。这也是 W11 要讲的内容。

</details>

6. 资深面试题:「讲一个你主导的技术决策。」

<details><summary>答案</summary>

按设计文档的结构讲:背景;可验证的目标;考虑过的两三个方案及其优缺点;选择的理由;代价与缓解;用数据说明的结果;如果重来会改什么。素材可以用 AgentOps 运行时的持久化方案选择(自研日志重放 vs Temporal vs LangGraph checkpoint),讲清重新评估的条件。

</details>

## 明天预告

Day 68 · 评测是产品:评测体系的组织、流程和所有权。W11 开始讲评测科学。基础篇的 W5 教你建测试集、写评审、跑回归,那是一个人的工作方式。明天讲当评测要服务一个团队、一个平台时,用例谁写、谁维护、怎么评审、怎么和需求绑定。
