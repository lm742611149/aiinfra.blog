---
title: 'Day 107 · Staff 级系统设计面试:三道真题完整示范'
description: '资深和 Staff 的系统设计面试,考的不是你记住了多少组件,而是你能不能从业务目标和约束出发,在 45 分钟里把规模估算、关键取舍、评测和演进路线讲清楚。今天用「企业级 Agent 平台」「十万并发客服 Agent」「代码 Agent 的评测体系」三道题完整走一遍,附追问清单和常见失分点。'
pubDate: 2026-10-12
regime: none
tags: ['system-design', 'interview', 'staff-engineer', 'estimation', 'evals', 'agent-60']
series: 'agent-60'
day: 107
lang: 'zh'
---

## 今天要解决的问题

Day 58 讲过系统设计面试,那时的目标是中级岗位:能画出一个合理的架构,讲清每个组件干什么。今天往上走一档。资深和 Staff 的系统设计面试,面试官默认你会画架构图,他想看的是别的东西。

今天学完你应该能做到:

1. 说出 Staff 级系统设计和中级系统设计在评分上的差别,知道面试官在每个阶段想听到什么。
2. 用一个固定的时间分配框架,在 45 到 60 分钟里走完一道开放题,不会在某一步卡死。
3. 对 Agent 系统做规模和成本估算:QPS、token 吞吐、供应商限流、月成本,并且把假设说清楚。
4. 完整回答三道真题,每道题能讲出至少三个关键取舍和一条演进路线。
5. 准备好一份追问清单,面试官往深处挖的时候接得住。

预计用时:5 到 7 小时。最好找人模拟面试,至少自己对着计时器讲一遍。前置:Day 58、Day 82–88(平台化)、Day 106(设计文档)。

## Staff 面试官在看什么

我把中级和资深/Staff 的系统设计评分差别整理成一张表。这不是哪家公司的官方评分标准,是综合 Hello Interview 等面试辅导平台公开的分级说明、几家公司的面经,以及我自己做面试官时的感受:

| 维度 | 中级能过的表现 | Staff 能过的表现 |
| --- | --- | --- |
| 需求 | 问清功能需求 | 主动追问业务目标、成功指标、约束,并且把模糊的需求收敛成可设计的范围 |
| 估算 | 算出 QPS | 算出 QPS、成本、容量瓶颈,并指出哪个数字决定了架构 |
| 架构 | 画出合理的组件 | 架构是从约束推出来的,能说清楚每个组件为什么存在 |
| 深挖 | 面试官问到才深入 | 自己挑出最难的两三个点主动深入 |
| 取舍 | 知道有别的方案 | 用同一组维度比较,讲代价和推翻条件 |
| 演进 | 很少涉及 | 讲清楚 MVP、三个月后、一年后分别长什么样,以及组织和成本怎么跟着变 |
| 风险 | 提一句「要监控」 | 讲失败模式、评测、灰度、回滚、安全和合规 |

Agent 系统的面试还多一层:面试官会特别留意你是否把「模型不可靠」当成一个一等公民的约束。普通后端系统,一个服务要么返回正确结果、要么报错。Agent 系统会返回一个看起来正确但其实错了的结果,而且错误率随模型、提示词和数据漂移。能把这一点贯穿到架构、评测和上线策略里,是 Staff 候选人和熟练的中级候选人之间最明显的分界线。

我在 jds.json 里看海外 Staff 岗的要求,Harvey「Staff Software Engineer, Agents」、Decagon「Staff Software Engineer, Agent Platform」、Anthropic「Staff+ Software Engineer, Claude Managed Agents」,都会强调 technical direction 和跨团队设计;国内字节「Agent 架构研发工程师/专家」、美团「Agent 可靠性技术专家」写的也是「主导整体架构」「可靠性体系」。系统设计面试就是在验证这件事。

## 45 分钟的时间框架

面试时间不够是最常见的失败原因。我用的框架:

<figure>
<svg viewBox="0 0 640 170" role="img" aria-label="45 分钟系统设计面试的时间分配">
<rect x="20" y="50" width="70" height="50" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="55" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">需求</text>
<text x="55" y="90" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">5-8 分</text>
<rect x="90" y="50" width="60" height="50" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="120" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">估算</text>
<text x="120" y="90" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">5 分</text>
<rect x="150" y="50" width="110" height="50" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="205" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">高层架构</text>
<text x="205" y="90" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">8-10 分</text>
<rect x="260" y="50" width="190" height="50" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="355" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">深挖 2-3 个难点</text>
<text x="355" y="90" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">15 分</text>
<rect x="450" y="50" width="90" height="50" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="495" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">评测与风险</text>
<text x="495" y="90" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">5 分</text>
<rect x="540" y="50" width="80" height="50" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="580" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">演进</text>
<text x="580" y="90" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">3-5 分</text>
<text x="320" y="135" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">琥珀色那段是拉开差距的地方,别把时间花在画登录注册上</text>
</svg>
<figcaption>Staff 面试的时间分配。需求和估算加起来十分钟以上不算浪费,它们决定了后面所有的取舍。</figcaption>
</figure>

几个要点:

**需求阶段要「收」。** 题目往往故意给得很大。你要做的是问出业务目标和约束,然后主动缩小范围:「我们先聚焦在客服场景的文字渠道,语音放到演进部分,可以吗?」面试官通常会同意,并且给你加分,因为这正是 Staff 在真实工作里该做的事。

**估算要找到「决定架构的那个数字」。** 算 QPS 不是目的。目的是找到一个数字,它一出来,某个设计就必须这样做。比如算出 token 吞吐超过单个供应商的限额,那多供应商路由就不是锦上添花,而是必需。

**深挖要自己挑。** 画完高层架构后,主动说「我认为这个系统最难的是这三个地方,我们按风险从高到低聊」。别等面试官点。

**最后两分钟留给总结。** 用三句话复述关键取舍和你会怎么演进。面试官写评价时,常常就是照着你最后这几句写的。

## 真题一:设计一个企业级 Agent 平台

**题目原话(大致)**:公司有十几个业务团队都在做 Agent,各自调模型、各自接工具、各自做评测。设计一个平台,让他们更快、更安全地上线 Agent。

**需求阶段我会问的问题**:

- 平台的用户是谁?业务团队的工程师,还是也包括不写代码的运营同学?这决定要不要做可视化编排。
- 现在最痛的是什么?是成本失控、安全事故、还是重复造轮子?这决定先做哪一块。
- 有没有合规要求?数据能不能出境?要不要支持私有化部署的模型?
- 规模:多少个团队、多少个 Agent、日调用量多少?

假设得到的回答是:15 个团队、60 个 Agent、日调用 500 万次模型请求;最痛的是上个月有团队把额度打爆连累别人,以及两次 prompt injection 导致的数据泄露;数据不能出境;用户主要是工程师。

**估算**:500 万次每天,平均 5.8 QPS,但白天高峰按 5 倍算约 30 QPS。这个量本身不大。决定架构的数字不是 QPS,而是「15 个团队共用供应商额度」和「两次安全事故」。所以平台的第一优先级是隔离和治理,不是性能。

**高层架构**:

- **模型网关**:统一入口,做路由、限流、租户配额、成本归因、故障切换。
- **MCP 工具中心**:工具注册、OAuth 授权、按租户和用户的权限、调用审计。
- **Agent 运行时(SDK + 托管服务)**:提供标准的 harness(循环、上下文管理、人工审批、持久化),团队可以只用 SDK,也可以托管运行。
- **评测平台**:数据集管理、离线回归、judge 管理、线上 A/B。
- **可观测**:OTel 全链路,按租户的成本和质量看板。
- **控制台**:租户管理、密钥、配额、审批策略。

**深挖我会主动挑的三个点**:

1. **租户隔离怎么做到什么程度。** 逻辑隔离(同一套服务,按租户 ID 分配额和数据)还是物理隔离(敏感团队独立部署)。我的选择:默认逻辑隔离,对处理个人敏感信息的租户提供独立的工具执行沙箱和独立的日志存储。代价是运维复杂度,推翻条件是出现合规要求必须物理隔离的客户。
2. **工具权限模型。** Agent 能调什么工具,不能只看 Agent 本身的配置,还要看「代表谁在调」。我会设计成三层:租户允许的工具集合、Agent 声明需要的工具、最终用户授权的范围,取交集。写操作默认需要人工确认,可以按工具和金额阈值放宽。这一点直接回应了两次安全事故。
3. **平台要不要管提示词和编排。** 管得太多,平台变成低代码工具,工程师不爱用;管得太少,治理落不了地。我的选择:平台不管业务提示词,但强制所有调用经过网关和工具中心,强制接入评测和可观测。用「必经之路」做治理,而不是用「统一编排」。

**评测与风险**:平台自己的评测是「接入平台后各团队的上线周期、事故率、单位任务成本有没有下降」。风险是平台成为单点故障,所以网关要多副本、要有直连供应商的紧急旁路,旁路的使用要告警。

**演进**:第一季度只做网关和工具中心(解决最痛的两件事),第二季度做评测平台,第三季度做托管运行时。组织上,平台团队 4 到 6 人,每个季度找两个业务团队做深度共建,而不是一开始就要求所有团队迁移。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1F43y6XETn&autoplay=0&high_quality=1" title="面试官问:设计一个生产级Agent系统,你怎么从头到尾把架构搭起来?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Agent开发实战 · 面试官问:设计一个生产级Agent系统,你怎么从头到尾把架构搭起来? · 5 分钟,看一个国内面经里的标准答法,再对照上面的 Staff 版本,找出它缺了哪几层。</figcaption>
</figure>

## 真题二:设计一个支撑十万并发会话的客服 Agent

**题目**:一家电商平台的大促期间,客服 Agent 要同时服务 10 万个在线会话。设计这个系统。

这道题的核心是估算。很多人一上来就画架构,然后在面试官问「你的模型调用量是多少」时卡住。

**需求阶段要问出来的**:会话里用户多久发一条消息?Agent 平均每条消息要调几次模型、几次工具?首字延迟要求多少?能转人工吗,人工坐席有多少?

假设:用户平均 30 秒发一条消息;Agent 每条消息平均 2.5 次模型调用(分类、检索后回答,部分需要工具);首字延迟 P95 小于 2 秒;人工坐席 2000 人。

**估算**(全部是假设,面试时要说出来):

```text
用户消息速率 = 100,000 会话 / 30 秒 ≈ 3,300 条/秒
模型调用 QPS = 3,300 × 2.5 ≈ 8,300 次/秒

每次调用输入 token(系统提示词 + 历史 + 检索结果)≈ 3,000
每次调用输出 token ≈ 200
输入吞吐 ≈ 8,300 × 3,000 ≈ 2,500 万 token/秒
输出吞吐 ≈ 8,300 × 200 ≈ 166 万 token/秒

按一小时高峰算:
输入 ≈ 900 亿 token/小时,输出 ≈ 60 亿 token/小时
单价设为 P_in、P_out(元/百万 token),小时成本 = 90,000 × P_in + 6,000 × P_out
```

这里我故意不代入具体价格,因为价格变化太快,面试时你可以问面试官假设什么价格,或者说「我假设输入每百万 token 一块钱量级、输出几块钱量级,数量级上这一小时是十万元级别」。数量级对了就行。

算到这里,决定架构的数字出现了两个:

1. **8,300 QPS 的模型调用,远超任何单一供应商默认给一个账号的限额。** 所以必须多供应商、多账号,或者自部署一部分流量。
2. **每小时十万元级别的成本。** 所以前缀缓存和小模型分流不是优化项,是上线前提。系统提示词和知识库检索结果如果能稳定在前缀,缓存命中后输入成本能降一大截(各家缓存折扣不同,要查当前价格)。

**高层架构**:

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="十万并发客服 Agent 的架构">
<rect x="10" y="100" width="90" height="50" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="55" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">接入层</text>
<text x="55" y="139" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">长连接 SSE</text>
<rect x="125" y="100" width="100" height="50" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="175" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">会话服务</text>
<text x="175" y="139" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">状态在 Redis</text>
<rect x="250" y="30" width="120" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="310" y="52" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">小模型分诊</text>
<text x="310" y="69" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">自部署,吃六七成</text>
<rect x="250" y="100" width="120" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="310" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Agent 工作者</text>
<text x="310" y="139" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">无状态,水平扩</text>
<rect x="250" y="170" width="120" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="310" y="192" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">工具和知识库</text>
<text x="310" y="209" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">订单只读副本</text>
<rect x="400" y="100" width="110" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="455" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">模型网关</text>
<text x="455" y="139" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">多供应商+缓存</text>
<rect x="535" y="70" width="95" height="40" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="582" y="95" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">供应商 A/B</text>
<rect x="535" y="140" width="95" height="40" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="582" y="165" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">自部署池</text>
<rect x="125" y="190" width="100" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="175" y="212" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">人工坐席</text>
<text x="175" y="229" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">2000 人,有上限</text>
<line x1="100" y1="125" x2="125" y2="125" stroke="var(--rule)" stroke-width="2"/>
<line x1="225" y1="125" x2="250" y2="125" stroke="var(--rule)" stroke-width="2"/>
<line x1="225" y1="115" x2="250" y2="60" stroke="var(--rule)" stroke-width="2"/>
<line x1="310" y1="150" x2="310" y2="170" stroke="var(--rule)" stroke-width="2"/>
<line x1="370" y1="125" x2="400" y2="125" stroke="var(--rule)" stroke-width="2"/>
<line x1="510" y1="118" x2="535" y2="92" stroke="var(--rule)" stroke-width="2"/>
<line x1="510" y1="132" x2="535" y2="158" stroke="var(--rule)" stroke-width="2"/>
<line x1="175" y1="150" x2="175" y2="190" stroke="var(--compute)" stroke-width="2" stroke-dasharray="4 3"/>
<text x="190" y="175" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">转人工限流</text>
</svg>
<figcaption>决定这张图的是两个数字:8,300 QPS 的模型调用和小时十万元级的成本。小模型分诊和多供应商网关都是从估算里推出来的。</figcaption>
</figure>

**深挖的三个点**:

1. **流量分层。** 大促期间六七成的问题是「我的快递到哪了」「怎么退货」这类高频问题。用一个自部署的小模型(W12 学的蒸馏和路由)先分诊,能用模板加查询直接回答的不走大模型。大模型只处理剩下的复杂会话。这一刀下去,QPS 和成本都能砍掉一大半。具体比例要用历史工单数据评测,面试时说「需要用去年大促的日志验证这个比例」。
2. **转人工的容量。** 2,000 个人工坐席,每人同时处理 3 到 5 个会话,上限约一万个会话。如果 Agent 的转人工率是 15%,10 万会话就是 1.5 万个转人工,超出容量。所以转人工必须排队、必须给用户预期等待时间,并且转人工率本身是这个系统最重要的业务指标之一。这一点很多候选人想不到,它恰恰是「从业务出发」的体现。
3. **降级策略。** 大模型供应商限流或者故障时,按优先级降级:先切到备用供应商;再关掉非必要的步骤(比如回答后的自检);再让小模型用更保守的模板回答;最后提示用户稍后再试或进入人工排队。每一级都要能自动触发,触发条件写成指标阈值。

**评测与风险**:上线前用历史大促的会话回放做压测和质量评测;上线时按流量 1%、10%、50% 灰度,护栏指标是转人工率、用户重复提问率、差评率;退款类写操作一律需要确认,防止批量错误退款这种高损失事故。

**演进**:第一阶段只覆盖物流和退换货两类高频问题;第二阶段扩到售前咨询;第三阶段做语音渠道。

## 真题三:设计代码 Agent 的评测体系

**题目**:公司内部有一个代码 Agent,能根据 issue 修改代码并提 MR。设计一套评测体系,让团队知道每次改动是变好了还是变差了。

这道题没有大流量,考的是 W11 学的评测科学。我会这样展开:

**需求**:评测的用户是谁?Agent 团队自己(每次改提示词、换模型要回归),还是管理层(决定要不要扩大使用)?两者要的指标不一样。前者要快、要稳定、要能定位问题;后者要能和业务结果挂钩。

**离线评测集怎么构造**:

- 从公司内部仓库的历史里挖。找「issue 加上对应修复它的 MR,并且 MR 里带了测试」的组合,和 SWE-bench 的思路一样:用修复前的代码作为起点,用 MR 里新增的测试作为判定。
- 人工筛选。SWE-bench Verified 就是因为原始数据里有大量描述不清或者测试不合理的任务,才做了人工筛选。内部数据同样需要:issue 描述是否足够、测试是否只测了这个修复、环境能否稳定复现。
- 防污染。用于评测的任务不能出现在提示词示例或者微调数据里。按时间切:用某个日期之后的 MR 做评测集。

**判定和指标**:

- 主指标:任务解决率(新增测试通过,且原有测试不退化)。
- 稳定性:同一任务跑 k 次,算 pass@k(至少成功一次)和 pass^k(k 次都成功)。τ-bench 论文里专门讲过 pass^k 的意义:对要上生产的 Agent,一致性比偶尔成功更重要。
- 成本和效率:每个任务的 token 成本、工具调用次数、耗时。
- 过程质量:改动的行数是否合理、有没有改了不该改的文件(用规则检查)、代码风格(用 linter)。

**统计**:用 W11 讲的方法。假设评测集 300 个任务,基线解决率 40%,要检测出 5 个点的提升,需要估算样本量够不够;两次运行之间用配对比较,而不是比较两个百分比。这一点在面试里讲出来,通常是加分最多的地方,因为大多数候选人只会说「跑一下看分数」。

**线上指标**:MR 被合并的比例、合并后被回滚的比例、人工 review 时修改的行数、开发者的采纳率。离线分数和线上指标要定期对照,发现脱节就说明离线评测集需要更新。

**基础设施**:每个任务要一个隔离的沙箱(容器),要能并行跑几百个;环境构建要缓存;测试有 flaky 的要识别并剔除。

**演进**:先用 50 个人工精选任务做冒烟集,每次改动都跑;再扩到 300 个做每日回归;最后接上线上指标做季度评审。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Ru54dxzCyD0" title="How to Prepare for System Design Interviews w/ Meta Staff Engineer" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hello Interview · How to Prepare for System Design Interviews w/ Meta Staff Engineer · 18 分钟,前 Meta Staff 工程师讲不同级别的系统设计面试分别看什么,和上面那张评分表对照着看。</figcaption>
</figure>

## 追问清单

面试官在你讲完之后往深挖的问题,我按出现频率整理了这些。每一条都准备一个 30 秒的回答:

- 如果流量突然涨到 10 倍,哪个组件先扛不住?
- 如果主力模型供应商宕机两小时,用户看到的是什么?
- 怎么知道这个 Agent 上线后比原来好?好多少算显著?
- 一个提示词改动,怎么保证没有让某类小众问题变差?
- 有人通过用户输入注入指令,让 Agent 调用了不该调的工具,你的设计在哪一层挡住?
- 这个系统一个月花多少钱?哪一项占大头?怎么砍一半?
- 如果只有两个人、一个月时间,你先做哪一部分?
- 这个架构一年后最可能需要推翻的是哪个决定?

最后两个问题是 Staff 面试特别爱问的。第一个考你在资源约束下做取舍的能力,第二个考你对自己方案的诚实程度。回答「我觉得没有需要推翻的」基本等于失分。

## 动手练习

**步骤 1:自己先答。** 三道题各找一个 45 分钟的整块时间,开计时器,在纸上或白板工具(Excalidraw)上答。不看上面的示范。答完拍照或截图存进 `notes/day107/`。

**步骤 2:对照示范打分。** 用「Staff 面试官在看什么」那张表,给自己每个维度打分(1 到 3 分),写下差距最大的两个维度。

**步骤 3:重写估算。** 真题二的估算换一组假设重新算:用户 20 秒发一条、每条 3 次模型调用、输入 4,000 token。用当前某家供应商的真实价格(查官网,写上查证日期)算出高峰一小时成本。再算如果小模型分诊吃掉 65% 流量、前缀缓存命中率 70%,成本降到多少。

**步骤 4:模拟面试。** 找一个朋友当面试官,或者用 Claude 扮演面试官(给它上面的追问清单,要求它每次只问一个问题、不要给提示)。至少完整模拟一道题,录下来回放,数一下你说了多少次「嗯」「然后」,以及有没有在 10 分钟内把需求收敛下来。

**步骤 5:准备自己的项目版本。** 把 AgentOps 平台当作「真题一」的真实答案,准备一个 10 分钟的讲述版本:业务问题、关键数字、三个取舍、一个你后来推翻的决定。资深面试里经常会让你讲自己做过的系统,这比现场设计更能拉开差距。

**验收标准**:三道题都有计时完成的答案记录;估算重算结果有算式和价格出处;至少一次完整的模拟面试录音和自评;AgentOps 的 10 分钟讲述稿。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 需求收敛 | 把开放的题目缩小成可以在面试时间内设计的范围,并和面试官确认 |
| 决定架构的数字 | 估算中那个一出来就迫使你采用某种设计的数字 |
| 逻辑隔离 / 物理隔离 | 同一套服务按租户 ID 隔离,还是给租户独立部署 |
| 分诊(triage) | 先用便宜的手段判断请求类型,把简单请求分流出去 |
| 降级 | 系统部分不可用时,按预定顺序关闭功能以保住核心体验 |
| pass@k / pass^k | k 次运行至少成功一次的概率 / k 次全部成功的概率 |
| 数据污染 | 评测任务出现在训练数据或提示词示例里,导致分数虚高 |
| 护栏指标 | 灰度时用来决定是否回滚的指标,不是要优化的目标 |

## 常见误区

**一上来就画图。** 需求没问清就开始画组件,后面面试官一个约束就让你的架构推倒重来。前五分钟用来问问题,不会被扣分。

**估算只算 QPS,没有成本。** Agent 系统的成本和 QPS 是同一量级的约束。只算 QPS 的候选人,在面试官眼里还停留在普通后端的思维里。

**把模型当成可靠的组件。** 架构图里模型是一个方框,箭头进去箭头出来,好像它一定返回正确结果。Staff 级的回答要把「模型会错」体现在评测、自检、人工确认和降级里。

**被动深挖。** 画完架构图就停下来等面试官问。资深候选人应该主动说出最难的点,并按风险排序。

**只有一个方案。** 每个关键决定都应该至少提一个备选方案,哪怕一句话带过。「我也考虑过 X,但在这个约束下 Y 更合适,因为……」这句话的分量比画对十个组件还重。

**没有演进。** 把一年后的完整架构当作第一版来设计,显得不懂资源约束。讲清楚 MVP 和后续阶段,才像真的做过项目的人。

## 学习资料

### 文档与文章

- [Hello Interview:System Design in a Hurry](https://www.hellointerview.com/learn/system-design/in-a-hurry/introduction):系统设计面试的系统性入门,重点看 [Delivery Framework](https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery) 一节,和今天的时间框架对照。
- [Hello Interview:Mastering Estimation](https://www.hellointerview.com/blog/mastering-estimation):估算的方法和常见错误,20 分钟。
- [system-design-primer](https://github.com/donnemartin/system-design-primer):经典的系统设计开源教程,当作基础组件的查漏补缺。
- [Anthropic:How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system):真实的多 Agent 系统设计,里面的 token 成本倍数、评测方法都是系统设计面试的好素材。
- [Chip Huyen:Building A Generative AI Platform](https://huyenchip.com/2024/07/25/genai-platform.html):从零到完整的生成式 AI 平台架构,真题一可以直接拿它当参考答案的骨架。
- [SWE-bench](https://www.swebench.com/) 和 [Anthropic 关于 SWE-bench 的工程博客](https://www.anthropic.com/engineering/swe-bench-sonnet):真题三的背景材料,看任务是怎么构造和判定的。
- [τ-bench 论文](https://arxiv.org/abs/2406.12045) 和 [Sierra 的介绍文章](https://sierra.ai/blog/benchmarking-ai-agents):pass^k 的来源,讲为什么一致性对客服 Agent 重要。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV19f4y1a7DZ&autoplay=0&high_quality=1" title="系统设计面试6个技巧|我面Google前的准备方法" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>TerryChen_泰瑞 · 系统设计面试6个技巧|我面Google前的准备方法 · 12 分钟,讲需求澄清和时间控制,和今天的框架互相印证。</figcaption>
</figure>

- 假如今天可以躺平,《我的AI Agent面试复盘》(BV1hubZ6WEfU),36 分钟。一个候选人的真实面经复盘,听听国内面试官会怎么追问 Agent 系统设计。
- Tson1111,《[系统设计面试]System Design Seminar by Scott Shi》(BV1aKETzTEK3)。一个很长的系统设计合集,按题目挑几集看,不用全看。

### 其他经典视频

- Hello Interview 的《How to Prepare for System Design Interviews w/ Meta Staff Engineer》已经嵌在正文里。
- Hello Interview,《Design Uber w/ a Ex-Meta Staff Engineer》(YouTube ID lsKU38RKQSo),63 分钟。不是 Agent 题,但能完整看到一个 Staff 面试官期望的节奏。

### 书籍

- Alex Xu,《System Design Interview – An Insider's Guide》第 1 卷(2020)和第 2 卷(2022),自出版。繁体中文版书名《內行人才知道的系統設計面試指南》。第 1 卷第 2 章讲估算,第 3 章讲答题框架,今天重点读这两章。
- Martin Kleppmann,《Designing Data-Intensive Applications》,O'Reilly。有中文译本,版本较多,以书店信息为准。不用通读,遇到分布式数据的追问时查对应章节。
- Chip Huyen,《AI Engineering》,O'Reilly,2025。第 10 章讲 AI 工程的架构演进,和真题一的分阶段演进思路一致。

### 开源项目与代码

- [SWE-bench/SWE-bench](https://github.com/SWE-bench/SWE-bench):看 harness 部分怎么用容器隔离每个任务,真题三的基础设施可以照这个讲。
- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench):用户模拟器加工具环境的评测框架,真题二的上线前评测可以借鉴。
- [ByteByteGoHq/system-design-101](https://github.com/ByteByteGoHq/system-design-101):常见系统设计概念的图解,面试前快速复习用。

## 自测

1. Staff 级和中级系统设计面试,评分上最大的三个差别是什么?

<details><summary>答案</summary>

一是需求阶段:Staff 要主动追问业务目标和约束,并把模糊题目收敛成可设计的范围。二是取舍:每个关键决定要有备选方案、比较维度、代价和推翻条件。三是演进和风险:要讲 MVP 到一年后的阶段路线,以及失败模式、评测、灰度和回滚。Agent 题目还要把「模型会错」贯穿进架构。

</details>

2. 真题二里,「决定架构的数字」是哪两个?它们分别迫使你做了什么设计?

<details><summary>答案</summary>

一是约 8,300 QPS 的模型调用,超出单一供应商的默认限额,迫使你做多供应商网关和部分自部署。二是高峰每小时十万元量级的成本,迫使你把前缀缓存和小模型分诊当作上线前提,而不是后期优化。

</details>

3. 为什么真题二里要算转人工的容量?不算会怎样?

<details><summary>答案</summary>

人工坐席有硬上限(2,000 人每人 3 到 5 个会话,约一万会话)。转人工率 15% 时,10 万会话会产生 1.5 万个转人工请求,超出容量。不算的话,大促时用户点了转人工却没人接,体验比 Agent 答错还糟。这说明转人工率是核心业务指标,也说明需要排队和预期等待时间的设计。

</details>

4. 代码 Agent 的离线评测集,为什么要按时间切分?pass@k 和 pass^k 各适合回答什么问题?

<details><summary>答案</summary>

按时间切是为了防污染:用某个日期之后的 MR 做评测,确保它们没有出现在提示词示例、微调数据或者模型的训练数据里。pass@k 回答「多试几次能不能做出来」,适合评估能力上限;pass^k 回答「每次都能做出来吗」,适合评估上线可靠性,对生产系统更重要。

</details>

5. 资深面试题:你设计的平台上线一年后,你觉得最可能需要推翻的是哪个决定?为什么当初还是这么选?

<details><summary>答案</summary>

用 AgentOps 举例:最可能推翻的是「模型网关用开源方案而不是自研」。当初的约束是三个月内要接入五个团队、人力只有 1.5 人,开源方案能最快上线;代价是租户模型和配额粒度不完全匹配。当租户数超过某个阈值、或者需要按功能归因成本时,自研的收益会超过成本。这个决定当初写进了 ADR,带着推翻条件,所以推翻它不是失败,而是计划内的演进。面试官想听的是你对自己方案的边界有清楚的认识。

</details>

6. 面试官问「如果只有两个人、一个月,你先做哪一部分」,真题一你怎么答?

<details><summary>答案</summary>

先做模型网关,只做三件事:统一入口、租户配额和限流、调用日志。它直接解决「一个团队打爆额度连累所有人」这个最痛的问题,而且后续的成本归因、评测、可观测都依赖它的日志。工具中心的权限控制是第二优先级,因为安全事故影响更大但改造需要业务团队配合,一个月内很难推完。

</details>

## 明天预告

Day 108 · 带人和推动:技术方案怎么说服老板和其他团队。面试过了只是开始,资深工程师大部分时间花在让别人接受一个方案上:怎么用 ROI 和评测数据说话,一页纸怎么写给管理层,怎么带新人做 Agent 项目,以及怎么回应「AI 不靠谱」这类质疑。
