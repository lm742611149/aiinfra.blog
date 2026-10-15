---
title: 'Anchor · 持久化 Agent 运行时'
name: 'Anchor'
tagline: '进程被杀、网络断开、审批挂三天,退款也只扣一次的 Agent 运行时'
summary: '基于 Postgres 的持久化 Agent 运行时:每步写检查点,崩溃后断点续跑,工具副作用靠幂等键和 outbox 只生效一次,人工审批可挂起数天,多 worker 抢任务不打架。最后用随机杀进程和网络分区的故障注入证明它可靠。'
order: 7
difficulty: 5
level: '资深+'
duration: '7–9 周(业余时间)'
cost: '约 $5–20 API 费(故障测试用假模型,不花钱);可选租 3 台小云主机做真实分区测试,按小时计'
gpu: false
targets: ['Agent 平台工程师', 'AI 基础设施工程师', '后端/分布式系统工程师']
stack: ['Python', 'asyncio', 'PostgreSQL', 'psycopg', 'Toxiproxy', 'pytest']
recognition: '公开的故障注入测试报告(Jepsen 风格的历史记录 + 不变量检查器)+ 可复现的测试脚本'
depends: []
status: 'spec'
---

## 这个项目是什么

先讲一个做计费后端的人都怕的场景。云簿 CloudLedger 的客服 Agent 处理一笔退款争议:查账单、查使用量、判断该退 $800,金额超过 $500 要财务审批,财务第二天才点同意,Agent 接着调支付接口退款,再给客户发邮件、关工单。假设退款接口返回成功的那一刻,worker 进程被 OOM 杀了,检查点还没来得及写。重启后运行时从上一个检查点续跑,发现「退款这一步还没完成」,于是又退了一次。客户收到两笔 $800。

这不是我编的极端情况。Inngest 的文档在讲 `step.waitForEvent` 的例子时专门写了一句:退款函数要做成幂等的,因为退款可能在 Inngest 保存步骤结果之前就已经成功,然后这一步会被重试。Temporal、DBOS 的文档也都要求 activity 或 step 幂等。这些框架把「从断点续跑」做好了,但「断点和副作用之间那条缝」最后还是交给你自己。

Anchor 就是把这条缝当主角的运行时。它是一个 Python 库加一个 Postgres 库:Agent 的每次模型调用、每次工具调用都写进日志表(journal),崩溃后重放日志跳过已完成的步骤;有副作用的工具必须声明自己的「只生效一次」策略(幂等键、事务内写入、outbox、可查询对账,四选一),声明不了的工具在不确定状态下停下来交给人;人工审批让运行挂起,不占 worker,几天后从任意一台 worker 恢复;多个 worker 用租约加 fencing token 抢任务。项目的另一半是一套故障注入测试:随机 `kill -9`、暂停进程、用 Toxiproxy 切断数据库和支付接口的网络,跑上千个退款流程,再用检查器核对模拟银行的账本,证明没有一笔钱被退两次。

## 为什么值得做

长任务 Agent 正在变成平台团队的标配需求,各家持久化执行框架都在往 Agent 方向靠,下面是我查过的现状(2026-10-15)。Temporal 的文档站有专门的 AI cookbook,里面有 OpenAI Agents SDK、Google ADK、Strands 等的示例,每次 LLM 调用和工具调用都作为 activity 持久化。Restate 的 AI 文档列了 Vercel AI SDK、OpenAI Agents SDK、Pydantic AI、LangChain 等集成,做法是把 LLM 调用包进 `ctx.run()`。DBOS 是一个装进应用的库,把 workflow 和 step 检查点写进 Postgres,不需要单独的编排服务器。LangGraph 用 checkpointer(比如 `PostgresSaver`)保存图状态,`interrupt()` 做人工介入。Inngest 用 `step.run` 的结果缓存来续跑。这几个仓库最近一周都有提交。

那还自己写干什么?不是为了替代它们,是为了能在面试里讲透它们。资深平台岗问持久化执行,问到第二层一定是「重放时 LLM 输出不一样怎么办」「worker 假死又活过来怎么办」「exactly-once 到底存不存在」。用过 Temporal 的人很多,能把这些问题用自己的代码和故障测试数据回答的人很少。另外,大部分 Agent 项目展示的是「做对了什么」,Anchor 展示的是「在故障下没做错什么」,这在作品集里是少见的维度,也正好对上后端和基础设施背景的人最有说服力的那部分经验。

我的判断是,这个项目对有后端经验、想转 Agent 平台方向的人性价比最高:分布式的基本功你本来就有,补上 Agent 特有的问题(模型非确定性、长时间挂起、工具语义各异)就是一份很硬的作品。

## 要做出什么

必做:

- 运行和步骤模型:`run`、`step` 两张表,每步记录输入摘要、输出、状态;模型调用的输出原样记下来,重放时直接用记录,不再请求模型。
- 副作用协议:工具注册时声明一种策略。幂等键型(键由 run_id 和步骤序号派生)、事务型(和 journal 写在同一个数据库事务里)、outbox 型(消息先进 outbox 表,单独的投递进程发)、对账型(重试前先查对方有没有这笔)。都不支持的工具,中断后状态标为 UNKNOWN,转人工。
- 人工审批:运行进入 WAITING,释放 worker;审批记录绑定参数哈希,参数变了审批作废;支持超时。
- 多 worker 调度:`SELECT ... FOR UPDATE SKIP LOCKED` 抢任务,租约加心跳,每次写 journal 带上 fencing token,过期的 worker 写不进去。
- 故障注入框架:随机 `kill -9`、`SIGSTOP` 暂停、Toxiproxy 切网络和加延迟。
- 检查器:读模拟银行账本和 journal,检查四条不变量(见验收指标)。
- 示例 Agent:CloudLedger 退款争议流程,用假模型和真模型各跑一套。

加分:

- 代码版本固定:运行开始时记下代码版本,挂起期间部署了新版本,老运行按老逻辑走完,参考 Temporal 的 patching 思路。
- 同一套故障测试跑一遍「LangGraph + PostgresSaver + 普通工具调用」的朴素实现,作为对照。
- 3 台云主机上的真实网络分区测试。

不做什么:不做可视化控制台(用 SQL 和日志就够),不做跨数据库支持,不追求吞吐量,不实现通用工作流语言,不碰 Kubernetes。

## 架构

<figure>
<svg viewBox="0 0 640 400" role="img" aria-label="Anchor 架构:多个 worker 通过租约从 Postgres 抢运行,每步写 journal,副作用经幂等键或 outbox 调用支付接口,故障注入器在 worker、数据库、支付接口之间制造崩溃和分区">
  <rect x="0" y="0" width="640" height="400" fill="var(--paper-raised)" rx="6"/>
  <rect x="20" y="30" width="150" height="44" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="95" y="57" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">worker A(epoch 7)</text>
  <rect x="20" y="90" width="150" height="44" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="95" y="117" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">worker B(epoch 8)</text>
  <rect x="20" y="150" width="150" height="44" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
  <text x="95" y="177" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">worker C 已被杀</text>
  <rect x="250" y="30" width="200" height="190" fill="none" stroke="var(--ink)"/>
  <text x="350" y="54" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">PostgreSQL</text>
  <text x="265" y="82" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">runs:状态/租约/epoch</text>
  <text x="265" y="106" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">steps:journal</text>
  <text x="265" y="130" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">effects:意图/结果</text>
  <text x="265" y="154" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">outbox:待投递消息</text>
  <text x="265" y="178" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">approvals:参数哈希</text>
  <text x="265" y="202" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">timers:挂起到期</text>
  <line x1="170" y1="52" x2="250" y2="80" stroke="var(--ink-soft)"/>
  <line x1="170" y1="112" x2="250" y2="112" stroke="var(--ink-soft)"/>
  <rect x="490" y="30" width="130" height="60" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="555" y="56" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">模拟支付接口</text>
  <text x="555" y="76" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">认幂等键</text>
  <rect x="490" y="110" width="130" height="44" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="555" y="137" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">邮件 / 工单</text>
  <rect x="490" y="174" width="130" height="44" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="555" y="201" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">财务审批页</text>
  <path d="M170 112 C 210 20, 450 10, 490 50" fill="none" stroke="var(--compute)"/>
  <line x1="450" y1="150" x2="490" y2="132" stroke="var(--compute)" stroke-dasharray="4 3"/>
  <text x="458" y="172" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">outbox</text>
  <rect x="20" y="250" width="600" height="56" fill="none" stroke="var(--ink-soft)" stroke-dasharray="6 4"/>
  <text x="320" y="274" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">故障注入器(nemesis)</text>
  <text x="320" y="294" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">kill -9 / SIGSTOP / Toxiproxy 断网、加延迟、重置连接</text>
  <rect x="20" y="326" width="600" height="56" fill="none" stroke="var(--ink)"/>
  <text x="320" y="350" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">检查器</text>
  <text x="320" y="370" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">账本 + journal → 不重复、不丢失、不越权、终将完成</text>
</svg>
<figcaption>蓝色是跑 Agent 的 worker,琥珀色是有副作用的外部系统。下面两层是测试设施:注入器负责搞破坏,检查器事后对账。</figcaption>
</figure>

最关键的取舍是 Anchor 对「exactly-once」的定义。网络上发出去的请求没法保证只送达一次,这一点不用争;Anchor 能保证的是「至少投递一次,加上接收方去重」,所以效果上只生效一次。每次有副作用的调用分三步:先在 effects 表写一条 PENDING 意图并提交,再带着幂等键调外部接口,成功后把结果写回。崩溃发生在中间,恢复时看到 PENDING,按工具声明的策略处理:幂等键型就用同一个键再调一次,让对方去重;对账型先查;都不行就停下来要人。这比「假装没问题」慢,但每种情况都有确定的去处。

第二个取舍是重放模型。Temporal 要求 workflow 代码确定性,靠重放事件历史重建状态;Restate、DBOS、Inngest 是按步骤记录结果、重放时跳过已完成步骤。Agent 的控制流本来就由模型输出决定,所以 Anchor 选后一种:模型输出是 journal 里的普通记录,重放时读记录,不再调用模型。代价是 journal 会很长,要做压缩和截断。

第三个是僵尸 worker。worker A 被 `SIGSTOP` 暂停了 40 秒,租约过期,worker B 接手;A 醒来后并不知道自己已经失去租约,还会继续写。Martin Kleppmann 那篇讲分布式锁的文章给的解法是 fencing token:每次接手 epoch 加一,所有写入都带 epoch 条件,旧 epoch 的写入直接失败。支付接口那一侧也要校验,不然 A 还是能把退款请求发出去。

## 分阶段计划

| 周 | 目标 | 产出 | 怎么算完成 |
| --- | --- | --- | --- |
| 1 | 读文档、写设计文档 | 设计文档,含不变量定义和故障模型 | 能用一页纸说清 Anchor 和 Temporal、DBOS、LangGraph 在重放模型上的区别 |
| 2 | 单 worker 持久化 | runs、steps 表,步骤记录与重放 | 跑到第 N 步时 `kill -9`,重启后从第 N 步继续,前面的模型调用一次都没重发 |
| 3 | 副作用协议 | effects 表、四种策略、模拟支付接口 | 在退款调用成功、结果未写回之间注入崩溃,账本上只有一笔退款 |
| 4 | 人工审批与定时器 | WAITING 状态、审批绑定参数哈希、超时 | 用可控时钟模拟挂起 3 天,另一台 worker 恢复后流程正确走完 |
| 5 | 多 worker 与租约 | SKIP LOCKED 调度、心跳、fencing token | 3 个 worker 并发跑 200 个运行,没有一个运行被两个 worker 同时推进 |
| 6 | 故障注入框架 | nemesis 进程、Toxiproxy 编排、历史记录 | 一条命令跑完「随机故障 + 自动对账」,输出不变量检查结果 |
| 7 | 大规模故障测试 | 至少 1,000 个运行的测试报告 | 四条不变量全部通过,或者每个违例都有根因和修复 |
| 8 | 对照实验(加分) | LangGraph 朴素实现的同条件测试 | 两边同样的负载和故障,报告重复副作用次数 |
| 9 | 包装 | README、技术博客、演示视频 | 读者照 README 在自己电脑上 30 分钟内跑出一份故障测试报告 |

本机能做的部分:Postgres 和 Toxiproxy 在 macOS 上都能用 Homebrew 装(Toxiproxy 的 README 写了 `brew tap shopify/shopify` 再 `brew install toxiproxy`),worker 就是几个 Python 进程,不需要 Docker。故障测试全部用假模型,按脚本返回固定的工具调用,这样既不花钱,失败也能复现。真模型只在示例 Agent 和演示时用,算式是:运行数 × 每次运行的模型调用数 × token 数 × 单价,跑一两百个退款流程用便宜模型几美元就够。本机做不了的只有一件事:同一台机器上的「网络分区」其实是 Toxiproxy 模拟的 TCP 故障,真实的跨机分区要租 3 台小云主机,按「台数 × 小时数 × 每小时单价」自己代入当时价格,跑完就删。

## 验收指标

| 指标 | 怎么测 | 目标 |
| --- | --- | --- |
| 重复副作用 | 检查器对账:每个退款意图在账本上的笔数 | 0。另外报告测试规模,n 次运行零违例时,违例率 95% 上界约为 3/n |
| 丢失运行 | 故障停止后等待收敛,统计没走到终态的运行 | 0,所有运行都进入完成、失败或待人工三种终态之一 |
| 审批绕过 | 检查器核对:每笔超额退款都有一条参数哈希匹配的审批 | 0 |
| UNKNOWN 比例 | 进入「需要人工判断」状态的副作用占比 | 报告数值,并按工具策略分组;幂等键型工具应为 0 |
| 恢复时间 | 从 worker 被杀到运行在别处继续的间隔 | 报告 P50 / P95,上界由租约时长决定,设计文档里先算出来 |
| 检查点开销 | 每步多出来的延迟 | 报告中位数,和模型调用耗时放在一起比 |
| 挂起成本 | 挂起中的运行占用的 worker 数 | 0,挂起期间不占进程 |

不变量的写法参考 Jepsen:测试只记录发生了什么(谁在什么时候发起了什么操作、结果是什么),正确性由事后的检查器判定,不在测试代码里边跑边断言。这样同一份历史记录可以加新的检查规则反复分析。

## 最终产出

- 仓库:Anchor 库、示例退款 Agent、故障注入框架、检查器,README 里一条命令跑测试。
- 故障测试报告:按 Jepsen 分析文章的结构写,包括系统描述、故障模型、发现的问题、修复,每个问题附历史记录片段。
- 技术博客:中文一篇,题目可以就叫「退款不能扣两次:给 Agent 做持久化执行」。
- 演示视频:4 分钟,终端里同时开 3 个 worker,中途随机杀进程、断网,最后检查器输出对账结果。
- 设计文档:和 Temporal、Restate、DBOS、LangGraph 的对比表,讲清每个设计决定的理由。

## 难点和坑

LangGraph 的 `interrupt()` 不是从原地继续。官方文档写得很清楚:恢复时整个节点从头重新执行,不是从调用 `interrupt` 的那一行继续,所以 `interrupt` 之前的副作用必须幂等,文档还警告在一个节点里循环调用 `interrupt` 会让每次恢复都重放之前所有轮次。做对照实验时,朴素实现里的重复副作用很多就出在这里。

日志会长到撞上限。Temporal 的事件历史在 10,240 个事件时开始告警,超过 51,200 个事件直接终止执行,文档建议用 Continue-As-New 切断。一个跑几百轮工具调用、每轮带完整模型输出的 Agent,Anchor 的 journal 也会遇到同样问题,要提前设计「把旧步骤压缩成一个快照、开一段新日志」的机制。

幂等键会过期。Stripe 的文档写明,API v1 的幂等键至少保留 24 小时后可能被清理,清理后用同一个键再请求会被当成新请求。设想周五晚上 worker 全挂了,周一才恢复,PENDING 的退款意图拿着同一个键去重试,对方早就不认识这个键了。所以幂等键型工具也要有过期时间,超过就降级成对账型。

假死比真死难对付。`kill -9` 很好测,进程没了租约自然过期。`SIGSTOP` 暂停才是真考验,醒来的 worker 状态完整、信心十足,只是已经不是租约持有者。我建议把 `SIGSTOP` 列为第一优先的故障类型。

挂起期间代码变了。审批挂了三天,你中间改了退款步骤的提示词或者调整了步骤顺序,老运行重放时 journal 和新代码对不上。最省事的做法是运行开始时记版本号,老版本 worker 保留到老运行跑完;Temporal 的 patching 文档讲了另一种在代码里分支的做法,可以对照着写进设计文档。

时钟别用真的。测「挂起 3 天后超时」不能真等 3 天,所有时间都要通过可注入的时钟读取。还要统一用数据库的时间判断租约,worker 本地时钟可能有偏差。

长事务把 SKIP LOCKED 拖垮。抢任务的事务里如果顺手调了模型,锁会持有几十秒,其他 worker 全都跳过这一行,看起来像任务饿死。抢到租约就立即提交,干活放在事务外。

## 面试里怎么讲

示范讲法:「我做计费后端时最怕的是重复扣款,Agent 跑长任务后这个问题更严重:中间要等人工审批几天,还会碰上进程重启。现有框架解决了断点续跑,但几家的文档都要求你自己保证步骤幂等,断点和副作用之间那条缝没人替你补。所以我做了 Anchor:每步写 journal,模型输出也记下来避免重放时结果不同;副作用先写意图再调用,工具必须声明幂等键、事务、outbox、对账四种策略之一,都不支持就转人工;多 worker 用租约加 fencing token 防僵尸。然后我按 Jepsen 的思路写了故障注入和检查器,随机杀进程、暂停进程、切网络,跑了上千个退款流程对账。取舍是我承认网络上没有 exactly-once,只保证至少一次投递加去重,换来的是每种故障都有确定的处理路径。」面试时把这里的「上千个」换成你实际跑出的数字。

<details>
<summary>追问一:exactly-once 到底存不存在?</summary>

投递层面不存在,发送方无法区分「请求丢了」和「响应丢了」。能做到的是效果上只生效一次:发送方至少投递一次,接收方按幂等键去重,或者把副作用和状态记录放进同一个事务。outbox 模式本身也有这个性质,microservices.io 上写明投递进程可能重复发送,消费方必须幂等。所以面试里说「exactly-once 处理」而不是「exactly-once 投递」。

</details>

<details>
<summary>追问二:为什么不直接用 Temporal?</summary>

生产上我会认真考虑用现成的,Anchor 是为了搞清楚这些框架在解决什么问题。具体到 Agent 场景,Temporal 要求 workflow 代码确定性,模型调用必须放进 activity,长循环还要处理事件历史上限;DBOS 只依赖 Postgres,部署最轻;Restate 和 Inngest 按步骤记录结果。选型看团队已有的基础设施和运维能力。做过 Anchor 之后,我能看懂每家的取舍,出了问题知道去哪查。

</details>

<details>
<summary>追问三:你怎么证明没有重复扣款,而不是测试没测到?</summary>

两点。第一,检查器只看外部账本和 journal 的事后对账,不依赖被测代码自己的日志。第二,故障注入点是随机的,并且专门在「副作用成功、结果未写回」这个窗口里加了定点注入。零违例不等于零概率,我会给出测试规模,n 次运行零违例时违例率的 95% 上界约为 3/n,也会讲清楚哪些故障没覆盖,比如数据库本身丢数据。

</details>

## 前置知识

- Day 25:LangGraph checkpoint、人工审批和中断恢复。
- Day 37:队列、重试、幂等、超时、断点续跑的基础版本。
- Day 46:SupportPilot 的退款审批工具,示例 Agent 从它改。
- Day 62:Agent harness 设计,Anchor 是 harness 里的持久化层。
- Day 65:持久化执行概念和 Temporal、Restate、DBOS、LangGraph 的对比。
- Day 69:评测统计学,零违例时的置信上界。
- Day 87:Agent 事故复盘,故障测试报告的写法相通。
- Day 99:AgentOps 持久化运行时与长任务。

## 参考资料

- [Temporal 事件历史](https://docs.temporal.io/workflow-execution/event):事件历史上限(10,240 告警、51,200 终止)和 Continue-As-New。
- [Temporal Activities](https://docs.temporal.io/activities):activity 失败自动重试、建议幂等的原文。
- [Temporal AI cookbook](https://docs.temporal.io/ai-cookbook):OpenAI Agents SDK 等框架接 Temporal 的示例,看别人怎么切 activity。
- [Restate 持久化执行](https://docs.restate.dev/concepts/durable_execution):journal 记录操作和结果、重放跳过已完成步骤。
- [DBOS 架构](https://docs.dbos.dev/architecture):只依赖 Postgres 的检查点设计,Anchor 的直接参照。
- [DBOS workflow 教程](https://docs.dbos.dev/python/tutorials/workflow-tutorial):workflow ID 当幂等键、step 要幂等的说明。
- [LangGraph 持久化](https://docs.langchain.com/oss/python/langgraph/persistence)和[中断](https://docs.langchain.com/oss/python/langgraph/interrupts):checkpointer 用法,以及恢复时整个节点重跑的规则。
- [Inngest 函数怎么执行](https://www.inngest.com/docs/learn/how-functions-are-executed):步骤结果缓存与重放,含退款要幂等的那句提醒。
- [Designing robust and predictable APIs with idempotency](https://stripe.com/blog/idempotency):Stripe 讲幂等键的原理。
- [Stripe 幂等请求文档](https://docs.stripe.com/api/idempotent_requests):键的保留期和参数比对规则,模拟支付接口照它实现。
- [Implementing Stripe-like Idempotency Keys in Postgres](https://brandur.org/idempotency-keys):在 Postgres 里实现幂等键的完整写法,effects 表的设计参考。
- [Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html):outbox 模式和它的重复投递问题。
- [How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html):Kleppmann 讲租约失效和 fencing token。
- [Jepsen 分析文章](https://jepsen.io/analyses):故障测试报告的写法范本;[Elle](https://github.com/jepsen-io/elle) 是它的黑盒检查器,看历史记录加事后检查的思路。
- [Toxiproxy](https://github.com/Shopify/toxiproxy):模拟断网、延迟、连接重置的 TCP 代理,故障注入的主力。
