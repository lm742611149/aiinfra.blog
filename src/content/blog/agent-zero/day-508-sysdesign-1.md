---
title: 'Day 508 · 系统设计(一):七步框架和企业客服 Agent'
description: 'Agent 岗的系统设计题怎么答:需求、指标、架构、数据、评测、风险、成本与 ROI 七步。用「每天 1 万张工单的企业客服 Agent」完整走一遍,三段脚本实跑:3 步工作流实测每张工单 820 个输入 token;排队模拟验证利特尔法则(17.4 对 17.1);ROI 敏感度分析显示 token 用量变 20%,每月节省只变 1200 元,客服看草稿的时间变 20%,节省变 27 万。'
pubDate: 2026-10-22
regime: none
tags: ['interview', 'system-design', 'roi', 'customer-support', 'agent-zero']
series: 'agent-zero'
day: 508
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 507](/blog/agent-zero/day-507-live-coding/) 练的是现场编码:10 分钟手写一个 Agent 循环,判卷脚本 7 条用例,还看到了「判卷全过、真接口 400」这种假客户端测不出来的错。加强题加上了并行、每个工具 3 秒超时、同一个调用重复 3 次就停。

那 25 行代码在今天会缩成架构图里的一个方块。二面、三面常见的是另一种题:「我们每天 1 万张客服工单,设计一个 Agent 系统来处理。」没有标准答案,一画就是 40 分钟。这种题考的不是你会不会写循环,而是你会不会拆问题、做取舍、算账。

## 今天要解决的问题

学完今天,你应该能做到:

1. 记住七步框架(需求、指标、架构、数据、评测、风险、成本与 ROI),知道每一步必须产出什么、大概花几分钟。
2. 用利特尔法则从「每天多少张、每张处理多久」算出要多少个 worker,并用一个排队模拟验证这个估算。
3. 算一张工单的模型费和 Agent 对人工的 ROI,用敏感度分析说出「ROI 对哪个参数最敏感」。
4. 不看文章,40 分钟讲完「企业客服 Agent」这道题,第 5、6、7 步不被跳过。

预计用时 3 小时。前置:[Day 196](/blog/agent-zero/day-196-workflow-vs-agent/) workflow 和 agent 的区别;[Day 387](/blog/agent-zero/day-387-queue-basics/) 队列;[Day 396](/blog/agent-zero/day-396-cost-1/) 一张工单花多少钱;[Day 402](/blog/agent-zero/day-402-batch-cache-roi/) Agent 经济学;[Day 414](/blog/agent-zero/day-414-approval-design/) 审批设计;[Day 437](/blog/agent-zero/day-437-prd/) 到 [Day 439](/blog/agent-zero/day-439-schedule-cost/) SupportPilot 的 PRD、架构和成本估算;第五部分写的 `cloudledger/cloudledger.db`。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,在一张白纸上默写七步框架,并把 `estimate.py` 的 `agent_cost` 默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 系统设计题和前面几天有什么不一样

前五天的题都有对错:MCP 和 function calling 不在一层,这就是对的;`try` 包太大会误报,这就是错的。系统设计题没有对错,只有「有没有道理」。面试官给你一句话的题面,剩下全靠你问、你假设、你取舍。

它在招聘里有多常见?站长 10 月整理的 JD 里,国内有正文的 334 条中,145 条(43%)写了「架构设计」或「系统设计」,不过多数是写在职责里(「负责 Agent 系统的架构设计」),说明面试会考,不说明一定是一道独立的设计题。更有信号的是成本:「成本、延迟、ROI」国内 31%、海外 39% 的 JD 提到,有一家大型游戏公司的 JD 把「Agent 经济学:成本建模、ROI、Agent vs 人工」直接写进了加分项。

这就是 Agent 系统设计题和传统后端系统设计题最大的差别。传统题讲完架构、数据库、缓存、扩容差不多就够了;Agent 题里面试官一定会问两件事:「你怎么知道它答对了」和「这东西值不值得做」。前者是评测,后者是成本和 ROI。很多候选人画架构就画了 30 分钟,这两步来不及讲,而它们恰恰是拉开差距的地方。

## 七步框架

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="Agent 系统设计题的七步框架与时间分配:需求 5 分,指标 3 分,架构 12 分,数据 4 分,评测 6 分,风险 4 分,成本 4 分">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">40 分钟面试的大致分配(剩下的时间留给追问)</text>
  <rect x="20" y="44" width="72" height="44" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="28" y="64" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">1 需求</text>
  <text x="28" y="80" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">5 分</text>
  <rect x="100" y="44" width="72" height="44" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="108" y="64" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">2 指标</text>
  <text x="108" y="80" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">3 分</text>
  <rect x="180" y="44" width="130" height="44" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="188" y="64" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">3 架构</text>
  <text x="188" y="80" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">12 分</text>
  <rect x="318" y="44" width="72" height="44" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="326" y="64" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">4 数据</text>
  <text x="326" y="80" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">4 分</text>
  <rect x="398" y="44" width="80" height="44" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="406" y="64" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">5 评测</text>
  <text x="406" y="80" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">6 分</text>
  <rect x="486" y="44" width="64" height="44" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="494" y="64" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">6 风险</text>
  <text x="494" y="80" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">4 分</text>
  <rect x="558" y="44" width="66" height="44" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="564" y="64" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">7 成本</text>
  <text x="564" y="80" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">4 分</text>
  <text x="20" y="122" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">每一步必须产出的东西</text>
  <text x="20" y="144" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">1 用户/场景/范围/非目标    2 成功率·延迟·成本·安全的数字目标</text>
  <text x="20" y="164" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">3 一张图 + workflow 还是 agent 的理由    4 数据来源·权限·更新</text>
  <text x="20" y="184" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">5 离线测试集 + 线上指标 + 上线节奏    6 失败模式和兜底</text>
  <text x="20" y="204" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">7 单次成本算式 + Agent vs 人工 ROI + 最敏感的参数</text>
  <text x="20" y="236" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">最常见的失败:第 3 步花掉 30 分钟,5、6、7 没讲到</text>
</svg>
<figcaption>七步框架和时间分配。蓝色几步回答「这个系统做得好不好」,琥珀色几步回答「这个系统做得出来、跑得住」。</figcaption>
</figure>

七步的顺序有讲究。先需求和指标,是因为后面每一个设计决定都要能回头对照:「为什么要人工审批?因为指标里越权和误操作是 0。」先有指标,架构上的每个方块才有理由。评测排在风险和成本前面,是因为面试官最想听的就是它,放在后面容易被时间挤掉。

第 1 步要主动问问题,别一上来就画图。你问的问题本身就在被打分。好问题的特征是**答案会改变设计**:「工单里涉及退款吗?金额上限多少?」决定你要不要做人工审批;「知识库多久更新一次?」决定索引怎么更新;「有没有历史工单数据?」决定评测集从哪来。「用什么数据库?」这种问题就不太好,换哪个数据库这道题的设计都差不多。

面试官不一定回答你的问题,很多时候他会说「你自己假设」。那就大声说出假设并写在白板上:「我假设……,您看是否合理。」假设错了没关系,面试官会纠正;不说假设直接设计,你们俩脑子里的系统可能根本不是一个。

## 第一题:设计一个企业客服 Agent

题面:「我们是一家 SaaS 公司,每天大约 1 万张客服工单,来自邮件、网页表单和 App 内聊天。请设计一个 Agent 系统来处理这些工单。」

这道题你做过,SupportPilot 就是它的缩小版。面试时要做的是把你的项目放大到生产规模,并补上个人项目里碰不到的部分:队列、扩容、分阶段上线、和人工的成本比较。下面按七步走一遍。

### 第 1 步:需求澄清

我会问这几个问题,并把面试官的回答(或者我的假设)写在白板上:

- 工单类型分布?假设:账单与付款 35%、功能使用 30%、故障报错 20%、退款与取消 10%、其他 5%。
- Agent 的权限边界?假设:可以查账户、订阅、发票,可以**申请**退款但不能执行,不能改账户数据。
- 现在怎么处理?假设:平均每张工单人工处理 8 分钟,首次响应平均 4 小时。
- 客服团队多少人?这一条要和上一条对得上,下面马上会算。
- 多语言?假设先只做中文和英文。
- 非目标:不做电话语音,不做营销外呼。

这里有个很容易被面试官抓住的地方:**假设之间要自洽**。每天 1 万张、每张 8 分钟,就是每天 80,000 分钟,约 1333 个人工小时。一个客服每天真正在处理工单的时间按 6 小时算,需要两百多人。如果你同时假设「40 人的客服团队」,数字就对不上了,面试官一句「40 个人每天能处理多少张?」你就卡住。第 7 步的脚本会把这个隐含人数算出来打印,养成习惯:每说一个数,心里过一遍它和别的数对不对得上。

### 第 2 步:指标

先定目标,后面每个设计决定都回头对照:

| 指标 | 目标 | 说明 |
| --- | --- | --- |
| 自动解决率 | 第一阶段 30%,半年后 50% | 不用人工修改直接发出,且客户没有再追问 |
| 草稿采纳率 | 70% 以上 | 客服直接发或小改后发的比例 |
| 首次响应时间 | P95 < 2 分钟 | 自动回复或「已收到,正在处理」 |
| 事实错误率 | < 1% | 回复里的金额、日期、政策和系统数据不符 |
| 越权与误操作 | 0 | 硬约束,不是优化目标 |
| 单工单模型成本 | < ¥0.1 | 不含人工 |

最后一行我写了一个很宽松的数。第 7 步会算出来,模型费其实是整个账里最不重要的一项。

### 第 3 步:架构

<figure>
<svg viewBox="0 0 640 320" role="img" aria-label="企业客服 Agent 的生产架构:渠道经接入层进入队列,工作流 worker 做分类、检索、业务工具、起草和自检,路由到自动发送、客服工作台、审批队列三个出口;下方是知识库更新管道、Tracing 和评测">
  <rect x="0" y="0" width="640" height="320" fill="var(--paper-raised)"/>
  <rect x="14" y="30" width="96" height="88" fill="none" stroke="var(--rule)"/>
  <text x="24" y="52" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">渠道</text>
  <text x="24" y="72" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">邮件</text>
  <text x="24" y="88" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">表单</text>
  <text x="24" y="104" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">App 聊天</text>
  <rect x="130" y="50" width="90" height="48" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="140" y="70" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">接入层</text>
  <text x="140" y="88" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">去重·脱敏</text>
  <rect x="240" y="50" width="70" height="48" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="250" y="78" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">队列</text>
  <rect x="330" y="20" width="200" height="190" rx="6" fill="none" stroke="var(--mem)"/>
  <text x="340" y="38" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">工作流 worker × 25(可横向扩)</text>
  <rect x="345" y="48" width="80" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="352" y="68" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">分类·小</text>
  <rect x="435" y="48" width="84" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="442" y="68" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">检索 RAG</text>
  <rect x="345" y="88" width="80" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="352" y="108" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">业务工具</text>
  <rect x="435" y="88" width="84" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="442" y="108" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">起草·大</text>
  <rect x="345" y="128" width="174" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="352" y="148" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">自检 + 出口检查 + 路由</text>
  <rect x="345" y="168" width="174" height="30" fill="none" stroke="var(--rule)"/>
  <text x="352" y="188" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">checkpoint(Postgres)</text>
  <line x1="110" y1="74" x2="130" y2="74" stroke="var(--ink-faint)"/>
  <line x1="220" y1="74" x2="240" y2="74" stroke="var(--ink-faint)"/>
  <line x1="310" y1="74" x2="330" y2="74" stroke="var(--ink-faint)"/>
  <rect x="550" y="40" width="80" height="40" fill="none" stroke="var(--rule)"/>
  <text x="558" y="64" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">自动发送</text>
  <rect x="550" y="96" width="80" height="40" fill="none" stroke="var(--rule)"/>
  <text x="558" y="120" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">客服工作台</text>
  <rect x="550" y="152" width="80" height="40" fill="none" stroke="var(--rule)"/>
  <text x="558" y="176" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">审批队列</text>
  <line x1="530" y1="100" x2="550" y2="60" stroke="var(--ink-faint)"/>
  <line x1="530" y1="110" x2="550" y2="116" stroke="var(--ink-faint)"/>
  <line x1="530" y1="120" x2="550" y2="172" stroke="var(--ink-faint)"/>
  <rect x="130" y="240" width="140" height="40" fill="none" stroke="var(--rule)"/>
  <text x="140" y="264" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">知识库更新管道</text>
  <rect x="290" y="240" width="140" height="40" fill="none" stroke="var(--rule)"/>
  <text x="300" y="264" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">Tracing·指标·告警</text>
  <rect x="450" y="240" width="170" height="40" fill="none" stroke="var(--rule)"/>
  <text x="460" y="264" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">评测(离线+线上回流)</text>
  <text x="14" y="306" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">右侧三个出口由路由决定:低风险高置信自动发,其余进工作台,涉及钱的进审批</text>
</svg>
<figcaption>企业客服 Agent 的生产架构。和 SupportPilot 相比多了接入层、队列、可横向扩的 worker 和三个出口。worker 里每一步都是 Day 507 那种带上限和超时的调用。</figcaption>
</figure>

画完图,讲三个决定和理由。面试官不会因为你画了某个方块加分,只会因为你说清了「为什么要它」加分。

**为什么是 workflow,不是一个自由的 Agent。** 客服流程大部分是确定的:分类、查资料、查数据、起草、检查。用 LangGraph 这种显式的图把它们串起来,每一步可观测、可评测、可单独换模型。只在「查什么数据」这一步给模型有限的工具选择权。这是 [Day 196](/blog/agent-zero/day-196-workflow-vs-agent/) 的结论,也是 SupportPilot 在 [Day 462](/blog/agent-zero/day-462-flow-graph/) 不用预置 agent 的原因。

**为什么要队列。** 这个要算,下一节专门讲。

**为什么分三个出口。** 不是每张工单都适合自动发。按类别的风险和自检的置信度分流:功能使用这种低风险类别、自检通过的,自动发送;其余生成草稿进客服工作台,客服一键发或者改了再发;涉及钱的进审批队列,[Day 414](/blog/agent-zero/day-414-approval-design/) 讲过审批界面要展示依据,不能变成橡皮图章。这个分流规则是一个可以随评测数据调的旋钮,第一阶段可以只开一个类别。

### 要几个 worker:利特尔法则

「为什么要队列、要几个 worker」是这道题最常被追问的地方,也是你从前端转过来最可能卡住的地方。我们从一个前端能看到的现象讲起。

打开 DevTools 的 Network 面板,假设你的页面每秒发 2 个请求,每个请求要 3 秒才返回。盯着面板看一会儿,同一时刻「还在转圈」的请求大概有几个?每秒新来 2 个,每个要挂 3 秒,所以任何时刻大约有 2 × 3 = 6 个在转。这就是**利特尔法则**(Little's Law):

**系统里同时在处理的数量 = 每秒到达的数量 × 每个要处理的时间**

写成符号是 L = λ × W。它的厉害之处在于几乎不挑条件:不管请求是均匀来还是一阵一阵来,只要长期平均算,它都成立。

放到工单上。每天 1 万张,平均每秒 10000 ÷ 86400 ≈ 0.116 张,看起来很少。但工单到达不均匀,工作日上午、出故障的时候,可能是平均值的 10 倍,按高峰每秒 1.16 张算。每张工单走完工作流要调好几次模型,按 15 秒算。同时在处理的工单数 L = 1.16 × 15 ≈ 17.4 张。

17.4 是平均值。高峰里有的秒钟来 3 张,有的秒钟一张不来,同时在处理的数量会上下抖动。worker 只开 18 个,抖到 25 的那几秒就会有工单排队。抖动有多大?公式能算,但更直观的办法是模拟一次。

```python
# agent-zero-lab/part09/sysdesign/queue_sim.py
import random

random.seed(508)
RATE = 1.16      # 高峰每秒到达的工单数
HANDLE = 15.0    # 每张处理秒数
SECONDS = 3600   # 模拟一个高峰小时

finish_times: list[float] = []
t = 0.0
while t < SECONDS:
    t += random.expovariate(RATE)
    finish_times.append(t + HANDLE)
arrivals = [f - HANDLE for f in finish_times]

samples = []
for s in range(60, SECONDS, 1):
    samples.append(sum(1 for a, f in zip(arrivals, finish_times) if a <= s < f))
samples.sort()
print(f"一小时到达 {len(arrivals)} 张,平均每秒 {len(arrivals) / SECONDS:.2f} 张")
print(f"同时在处理:平均 {sum(samples) / len(samples):.1f},P99 {samples[int(len(samples) * 0.99)]},最多 {samples[-1]}")
print(f"利特尔法则估算:{RATE} × {HANDLE} = {RATE * HANDLE:.1f}")
```

<div class="line-notes">

- `random.seed(508)` 固定随机种子,你跑出来的数和我一样。去掉这行,每次结果会略有不同。
- `RATE = 1.16      # 高峰每秒到达的工单数` 1 万张每天、高峰是平均的 10 倍:10000 ÷ 86400 × 10 ≈ 1.16。
- `HANDLE = 15.0    # 每张处理秒数` 一张工单走完分类、检索、起草、自检,调四五次模型,15 秒是一个合理假设。这里简化成每张都是正好 15 秒。
- `finish_times: list[float] = []` 记每张工单处理完的时刻。
- `t += random.expovariate(RATE)` 下一张工单什么时候到。「平均每秒 1.16 张、互相独立地随机到达」时,两张之间的间隔服从指数分布,`expovariate` 就是按这个分布抽一个间隔,平均是 1 ÷ 1.16 ≈ 0.86 秒。你不用记这个分布,只要知道它模拟的是「随机地、一阵一阵地来」,不是每 0.86 秒准时来一张。
- `finish_times.append(t + HANDLE)` 这里假设工单一到就有 worker 接(worker 无限多),所以完成时刻就是到达加 15 秒。我们要量的就是「这种情况下同时要多少个 worker」。
- `arrivals = [f - HANDLE for f in finish_times]` 反推出每张的到达时刻。
- `for s in range(60, SECONDS, 1):` 从第 60 秒开始每秒看一次。跳过开头一分钟,是因为刚开始系统是空的,前 15 秒的数偏低,不代表稳定状态。
- `samples.append(sum(1 for a, f in zip(arrivals, finish_times) if a <= s < f))` 数第 s 秒时有几张「已经到了、还没做完」,也就是同时在处理的数量。`zip` 把两个列表配成对,像 JS 里同时遍历两个数组的下标。这一行要扫四千多张工单乘三千多秒,纯 Python 跑了约 2 秒,够用。
- `samples.sort()` 排序以后,第 99% 位置上的数就是 P99:99% 的时刻,同时在处理的数量不超过它。
- `print(f"利特尔法则估算:{RATE} × {HANDLE} = {RATE * HANDLE:.1f}")` 和公式对比。

</div>

```bash
uv run python -m part09.sysdesign.queue_sim
```

```text
一小时到达 4116 张,平均每秒 1.14 张
同时在处理:平均 17.1,P99 27,最多 31
利特尔法则估算:1.16 × 15.0 = 17.4
```

平均 17.1,公式 17.4,对得上(随机抽出来的到达率是 1.14,略低于 1.16,所以平均也略低)。但 P99 是 27,最多到过 31。也就是说,按平均值开 18 个 worker,高峰小时里会有不少时刻排队。

所以面试时这样说:「高峰每秒约 1.2 张,每张 15 秒,按利特尔法则平均同时处理约 18 张;考虑到达的随机波动,我模拟过 P99 在 27 左右,worker 并发设到 25 到 30。多出来的偶尔排几秒队是可以接受的,因为有队列兜着,工单不会丢。」

这也就回答了「为什么要队列」:一是到达不均匀,队列把高峰削平;二是模型服务会限流、会抖、会挂,队列把「接收工单」和「处理工单」拆开,模型那边出问题时工单在队列里等着,恢复以后补处理,不会丢。还要补一句:要确认模型厂商的速率限制够用,25 个 worker 同时调,每张调 4 到 5 次,每分钟就是几百次请求,不够就申请提额或者配备用厂商。

### 第 4 步:数据

- **知识库**:帮助中心、内部 SOP、历史上的优秀回复。要有一条更新管道,文档改了自动增量重建索引,并保留版本号,回复里引用的是哪个版本能追溯。
- **业务数据**:通过工具实时查,不预先复制一份。操作对象的身份从工单关联的账户取,不由模型传,这是 [Day 506](/blog/agent-zero/day-506-interview-4/) 练习 3 那个权限检查的思路。
- **隐私**:进模型之前,把不必要的个人信息脱敏;trace 里同样脱敏;选模型厂商时要考虑数据是否出境。
- **历史工单**:这是评测集最好的来源,脱敏后按类别抽样。

### 第 5 步:评测与上线节奏

离线评测:从历史工单里按类别抽 500 张,由资深客服标注「理想回复要点」和「该不该转人工」;再加 50 条对抗和注入用例。三层评测:规则断言、LLM 评委、轨迹检查,评委先和人工标注对齐,这些都是第六部分和 SupportPilot 评测那几天做过的。

线上分三个阶段,这一段面试官通常很爱听:

1. **影子模式**(2 周):Agent 对每张工单生成草稿,但不给任何人看,只拿来和客服实际发出的回复对比。零风险,能拿到真实分布上的第一手数据。
2. **辅助模式**(1 到 2 个月):草稿展示给客服,客服决定用不用、改多少。草稿采纳率和修改幅度是最真实的评测数据,而且第 7 步会看到,ROI 最敏感的就是这里。
3. **自动模式**:从采纳率最高、风险最低的类别开始,一类一类开放自动发送。每开一类都要有一段观察期和一个随时能关掉的开关。

### 第 6 步:风险

| 风险 | 后果 | 措施 |
| --- | --- | --- |
| 事实错误(金额、日期说错) | 客诉、信任损失 | 回复里的数据必须来自工具结果,出口检查比对 |
| 注入导致越权 | 数据泄露 | 身份绑定在工具层,出口检查,注入测试集进 CI |
| 误退款 | 资金损失 | 只能申请不能执行,金额上限,人工审批 |
| 模型服务故障 | 工单积压 | 队列缓冲,备用厂商,降级为「已收到,人工处理中」 |
| 知识库过期 | 答错政策 | 文档版本化,政策类文档一改就触发相关评测 |
| 效果悄悄变差 | 慢性客诉 | 线上指标按周对比,抽样复查,锁定模型版本 |

最后一行是很多人想不到的:模型厂商会在同一个名字下更新模型。DeepSeek 的定价页上,`deepseek-flash` 后面就标着具体版本 `DeepSeek-V4.1-Flash-1017`,而旧的 `deepseek-v4-flash` 名字已经下线、请求被转到新模型。你什么都没改,效果可能就变了,所以线上指标要按版本看。

### 第 7 步:成本与 ROI

这一步分三段:先量一张工单要多少 token,再算模型费和人工费,最后看哪个参数最要紧。

**先量。** 面试时你不可能现场跑代码,但你可以说「我在自己的项目里量过」。我们用 CloudLedger 的工单,跑一个最简的三步工作流:小模型分类、带政策和客户数据起草、自检。每种主题取一张,一共 8 张。

```python
# agent-zero-lab/part09/sysdesign/measure_ticket.py
import json
import sqlite3

from common.llm import LLMClient

KB = """【退款政策】年付客户可申请退还未使用整月的费用,按月均价计算,已开发票需先作废。月付不退当月费用。
【重复扣款】同一账期出现两笔金额相同的扣款,核实后 3 个工作日内原路退回多扣的一笔。
【发票重开】发票抬头写错可在「账单-发票」申请重开,原发票作废,新发票 1 个工作日内发到邮箱。
【登录验证码】验证码 5 分钟内有效;连续 5 次错误锁定 30 分钟;收不到短信可改用邮箱验证码。
【套餐升级】中途升级按剩余天数补差价,立即生效;降级下个账期生效。
【导出超时】年度报表数据量大时导出可能超时,可按季度分段导出,或在「报表-后台导出」生成后下载。"""
CLASSIFY = "把工单分到 billing / technical / account / other 之一,只输出类别名。"
DRAFT = "你是云簿客服。只根据给你的政策和客户数据回复,数据里没有的不要编;涉及退款只能说已提交申请。回复 120 字以内。"
CHECK = '检查客服回复:金额、日期是否都能在客户数据里找到依据,是否承诺了政策没有的东西。只输出 JSON:{"ok": true/false, "risk": "low"/"high"}'

db = sqlite3.connect("cloudledger/cloudledger.db")
rows = db.execute("SELECT id, customer_id, subject, body FROM tickets GROUP BY subject ORDER BY id").fetchall()
llm = LLMClient()
per_ticket = []
for tid, cid, subject, body in rows:
    sub = db.execute("SELECT plan, billing_cycle, seats, status FROM subscriptions WHERE customer_id=?", (cid,)).fetchone()
    invs = db.execute("SELECT id, amount_cents, status, issued_at FROM invoices WHERE customer_id=? ORDER BY issued_at DESC LIMIT 3", (cid,)).fetchall()
    data = json.dumps({"subscription": sub, "invoices": invs}, ensure_ascii=False)
    before = (llm.ledger.prompt_tokens, llm.ledger.completion_tokens, llm.ledger.cost)
    hit = 0
    cat = llm.chat([{"role": "system", "content": CLASSIFY}, {"role": "user", "content": body}], temperature=0, max_tokens=5)
    draft = llm.chat([{"role": "system", "content": DRAFT + "\n\n" + KB},
                      {"role": "user", "content": f"客户数据:{data}\n\n工单:{subject}\n{body}"}], temperature=0.3, max_tokens=300)
    check = llm.chat([{"role": "system", "content": CHECK},
                      {"role": "user", "content": f"客户数据:{data}\n政策:{KB}\n回复:{draft.content}"}],
                     temperature=0, max_tokens=30, response_format={"type": "json_object"})
    hit = cat.cache_hit_tokens + draft.cache_hit_tokens + check.cache_hit_tokens
    p, c, cost = (now - b for now, b in zip((llm.ledger.prompt_tokens, llm.ledger.completion_tokens, llm.ledger.cost), before))
    per_ticket.append((p, c, hit))
    print(f"{tid} {subject:<6} {cat.content.strip():<9} 输入 {p:>4}(命中 {hit:>4}) 输出 {c:>3}  ¥{cost:.5f}  自检 {check.content.strip()}")
n = len(per_ticket)
print(f"平均每张:输入 {sum(x[0] for x in per_ticket) / n:.0f},其中命中 {sum(x[2] for x in per_ticket) / n:.0f},输出 {sum(x[1] for x in per_ticket) / n:.0f}")
print(llm.ledger)
```

<div class="line-notes">

- `from common.llm import LLMClient` 这一段可以用自己的 `LLMClient` 了([Day 135](/blog/agent-zero/day-135-llm-client-1/) 前后建的),它的账本 `ledger` 会累计 token 和钱,正好用来量。
- `KB = """【退款政策】` 一个缩小版知识库:6 条政策,真系统里这里是 RAG 检索出来的几段。这里直接全塞进去,让每张工单的输入一样长,方便比较。
- `CHECK = '检查客服回复:` 自检那一步,只要一个小 JSON。这一步对应架构图里「自检 + 出口检查」那个方块。
- `rows = db.execute("SELECT id, customer_id, subject, body FROM tickets GROUP BY subject ORDER BY id").fetchall()` CloudLedger 的工单表里有 41 张,按主题 `GROUP BY` 每种取一张,得到 8 张不同主题的。SQLite 允许 `GROUP BY` 时选没聚合的列,取的是组里某一行;换 Postgres 会报错,要写成 `DISTINCT ON`。
- `invs = db.execute("SELECT id, amount_cents, status, issued_at FROM invoices WHERE customer_id=? ORDER BY issued_at DESC LIMIT 3", (cid,)).fetchall()` 查这个客户最近 3 张发票,模拟「业务工具」那一步。`?` 是占位符,参数单独传,防 SQL 注入,第一部分 SQL 课讲过。
- `before = (llm.ledger.prompt_tokens, llm.ledger.completion_tokens, llm.ledger.cost)` 记下这张工单开始前账本的数,做完以后相减,就是这一张的用量。
- `cat = llm.chat([{"role": "system", "content": CLASSIFY}, {"role": "user", "content": body}], temperature=0, max_tokens=5)` 第一步分类。生产里这一步用更便宜的小模型,这里为了简单用同一个模型。
- `temperature=0, max_tokens=30, response_format={"type": "json_object"})` 自检要 JSON。DeepSeek 支持 `json_object`(不支持 `json_schema`,[Day 145](/blog/agent-zero/day-145-prompt-lab/) 试过会 400),prompt 里必须出现「JSON」这个词。
- `p, c, cost = (now - b for now, b in zip((llm.ledger.prompt_tokens, llm.ledger.completion_tokens, llm.ledger.cost), before))` 三个「现在减之前」一次算完。`zip` 把现在的三个数和之前的三个数配对,生成器逐个相减,再解构给三个变量,像 JS 的 `const [p, c, cost] = now.map((x, i) => x - before[i])`。

</div>

```bash
uv run python -m part09.sysdesign.measure_ticket
```

```text
T1001 导出报表报错 technical 输入  792(命中    0) 输出  41  ¥0.00191  自检 {"ok": true, "risk": "low"}
T1003 取消订阅   billing   输入  800(命中    0) 输出  64  ¥0.00211  自检 {"ok": true, "risk": "low"}
T1006 升级套餐   billing   输入  804(命中    0) 输出  60  ¥0.00209  自检 {"ok": true, "risk": "low"}
T1007 申请退款   billing   输入  842(命中    0) 输出  64  ¥0.00220  自检 {"ok": true, "risk": "low"}
T1008 发票抬头修改 billing   输入  806(命中    0) 输出  47  ¥0.00199  自检 {"ok": true, "risk": "low"}
T1009 席位数量不对 billing   输入  829(命中    0) 输出  68  ¥0.00220  自检 {"ok": true, "risk": "low"}
T1012 登录不了   account   输入  800(命中  256) 输出  53  ¥0.00152  自检 {"ok": true, "risk": "low"}
T1014 重复扣款   billing   输入  885(命中  256) 输出  98  ¥0.00205  自检 {"ok": true, "risk": "low"}
平均每张:输入 820,其中命中 64,输出 62
24 次调用 | 输入 6558 / 输出 495 tokens | 约 ¥0.0161
```

三个观察:

- 一张工单 3 次调用,平均输入 820、输出 62 个 token。账本按 `.env` 里的高峰价算出 ¥0.0161;我是晚上 7 点跑的,实际是空闲价,真实花费约一半,¥0.008。
- 缓存几乎没命中,只有最后两张命中了 256 个 token。原因是这个知识库太短,几次请求之间完全相同的开头很少,能命中的部分自然就少。生产里系统提示加工具定义加检索结果动辄几千 token,命中率会高得多,[Day 397](/blog/agent-zero/day-397-prompt-caching/) 讲过固定部分放前面。
- 「登录不了」被分到了 account,其余 7 张里 6 张是 billing,「导出报表报错」是 technical。8 张全部自检通过。这只是一个小样本,不是评测。

820 个 token 是一个玩具工作流的数。生产系统要检索 5 段文档、带上对话历史和多次工具结果,输入会大一个数量级。所以下面的估算按每张 1 万输入、500 输出,命中一半来算,这是一个偏保守的假设。面试时就这么说:「我自己的项目里一张工单量出来是几百到几千 token,生产里按 1 万估,偏保守。」

**再算钱。** 把所有假设放进一个 dataclass,每个都能换。

```python
# agent-zero-lab/part09/sysdesign/estimate.py
from dataclasses import dataclass, replace

PRICE = {"hit": 0.04, "miss": 2.0, "out": 8.0}  # deepseek-flash 高峰价,元/百万 token,2026-10 查


@dataclass
class Plan:
    tickets_per_day: int = 10_000
    in_tokens: int = 10_000
    out_tokens: int = 500
    hit_rate: float = 0.5
    salary: float = 8_000
    overhead: float = 1.4
    hours_per_month: float = 174
    human_minutes: float = 8
    auto_rate: float = 0.3
    spot_check: float = 0.05
    assist_minutes: float = 3
    build_cost: float = 720_000


def model_cost(p: Plan) -> float:
    hit = p.in_tokens * p.hit_rate
    miss = p.in_tokens - hit
    return (hit * PRICE["hit"] + miss * PRICE["miss"] + p.out_tokens * PRICE["out"]) / 1_000_000


def per_minute(p: Plan) -> float:
    return p.salary * p.overhead / p.hours_per_month / 60


def agent_cost(p: Plan) -> float:
    auto = model_cost(p) + p.spot_check * p.human_minutes * per_minute(p)
    assisted = model_cost(p) + p.assist_minutes * per_minute(p)
    return p.auto_rate * auto + (1 - p.auto_rate) * assisted


def monthly_saving(p: Plan) -> float:
    human = p.human_minutes * per_minute(p)
    return (human - agent_cost(p)) * p.tickets_per_day * 30


if __name__ == "__main__":
    base = Plan()
    human = base.human_minutes * per_minute(base)
    print(f"高峰到达:{base.tickets_per_day / 86400 * 10:.2f} 张/秒(平均的 10 倍)")
    print(f"模型费:每张 ¥{model_cost(base):.4f},每月 ¥{model_cost(base) * base.tickets_per_day * 30:,.0f}")
    staff = base.tickets_per_day * base.human_minutes / 60 / 6
    print(f"这些假设隐含的客服人数:{staff:.0f} 人(每人每天有效处理 6 小时)")
    print(f"人工:每分钟 ¥{per_minute(base):.2f},每张 ¥{human:.2f}")
    print(f"Agent 加权:每张 ¥{agent_cost(base):.2f},省 {1 - agent_cost(base) / human:.0%}")
    print(f"每月省 ¥{monthly_saving(base):,.0f},开发成本 {base.build_cost / monthly_saving(base):.1f} 个月回本")
    print("\n参数 ±20% 时每月节省的变化:")
    fields = ["in_tokens", "hit_rate", "auto_rate", "assist_minutes", "human_minutes", "salary"]
    rows = []
    for f in fields:
        lo = monthly_saving(replace(base, **{f: getattr(base, f) * 0.8}))
        hi = monthly_saving(replace(base, **{f: getattr(base, f) * 1.2}))
        rows.append((abs(hi - lo), f, lo, hi))
    for spread, f, lo, hi in sorted(rows, reverse=True):
        print(f"  {f:<15} ×0.8 → ¥{lo:>11,.0f}   ×1.2 → ¥{hi:>11,.0f}   差 ¥{spread:,.0f}")
```

<div class="line-notes">

- `PRICE = {"hit": 0.04, "miss": 2.0, "out": 8.0}  # deepseek-flash 高峰价,元/百万 token,2026-10 查` 2026 年 10 月在 DeepSeek 定价页查的:`deepseek-flash` 高峰时段缓存命中 0.04、未命中 2、输出 8 元每百万 token,空闲时段减半。估算用高峰价,偏保守。
- `@dataclass` 把一堆假设装进一个类,每个字段有默认值。[Day 50](/blog/agent-zero/day-050-dataclass/) 学过,相当于 TS 里一个带默认值的配置对象 `{ ticketsPerDay: 10000, ... }`。
- `salary: float = 8_000` 客服月薪 8000 元。`overhead: float = 1.4` 是用工成本系数:社保、公积金、办公、管理,公司实际花的钱约是工资的 1.4 倍,这是一个常见的粗估。
- `hours_per_month: float = 174` 每月工作小时数,约 21.75 天 × 8 小时。
- `auto_rate: float = 0.3` 第一阶段自动解决率 30%,就是第 2 步定的指标。
- `spot_check: float = 0.05` 自动发出的工单,抽 5% 让人复查,这部分人工也要算钱。
- `assist_minutes: float = 3` 辅助模式下,客服看草稿、小改、发送,假设从 8 分钟降到 3 分钟。这是最没把握的一个数,影子模式和辅助模式第一个月就是为了量它。
- `build_cost: float = 720_000` 开发成本:假设三个人做半年,每人每月用工成本 4 万,3 × 6 × 4 万 = 72 万。
- `hit = p.in_tokens * p.hit_rate` 1 万输入里一半命中缓存,5000 个按 0.04 算,另外 5000 个按 2 算。
- `return (hit * PRICE["hit"] + miss * PRICE["miss"] + p.out_tokens * PRICE["out"]) / 1_000_000` 代入:5000 × 0.04 + 5000 × 2 + 500 × 8 = 200 + 10000 + 4000 = 14200,除以一百万,每张 ¥0.0142。
- `return p.salary * p.overhead / p.hours_per_month / 60` 人工每分钟:8000 × 1.4 ÷ 174 ÷ 60 ≈ ¥1.07。
- `auto = model_cost(p) + p.spot_check * p.human_minutes * per_minute(p)` 自动解决的那张:模型费,加上 5% 概率被抽查、抽查一次按 8 分钟人工算。0.0142 + 0.05 × 8 × 1.07 ≈ ¥0.44。
- `assisted = model_cost(p) + p.assist_minutes * per_minute(p)` 走辅助模式的那张:模型费加 3 分钟人工,0.0142 + 3 × 1.07 ≈ ¥3.23。
- `return p.auto_rate * auto + (1 - p.auto_rate) * assisted` 按比例加权:0.3 × 0.44 + 0.7 × 3.23 ≈ ¥2.40。
- `return (human - agent_cost(p)) * p.tickets_per_day * 30` 每张省下的钱乘以每月张数。
- `staff = base.tickets_per_day * base.human_minutes / 60 / 6` 第 1 步说的自洽检查:按这些假设,现在需要多少客服。
- `lo = monthly_saving(replace(base, **{f: getattr(base, f) * 0.8}))` 敏感度分析的核心:每次只把一个参数改成 0.8 倍,其他不动,看结果变多少。`replace(base, in_tokens=8000)` 会复制一份 Plan 只改这一个字段,原来的 `base` 不变,和 JS 的 `{ ...base, inTokens: 8000 }` 一样。`**{f: ...}` 是因为字段名存在变量 `f` 里,要用字典展开成关键字参数。`getattr(base, f)` 按名字取字段的值,像 JS 的 `base[f]`。
- `rows.append((abs(hi - lo), f, lo, hi))` 记下「改小 20% 和改大 20% 两个结果差多少」,差得越多,说明结果对这个参数越敏感。
- `for spread, f, lo, hi in sorted(rows, reverse=True):` 按差值从大到小排,最敏感的排最前。元组排序先比第一个元素,所以按 `spread` 排。

</div>

```bash
uv run python -m part09.sysdesign.estimate
```

```text
高峰到达:1.16 张/秒(平均的 10 倍)
模型费:每张 ¥0.0142,每月 ¥4,260
这些假设隐含的客服人数:222 人(每人每天有效处理 6 小时)
人工:每分钟 ¥1.07,每张 ¥8.58
Agent 加权:每张 ¥2.40,省 72%
每月省 ¥1,855,970,开发成本 0.4 个月回本

参数 ±20% 时每月节省的变化:
  human_minutes   ×0.8 → ¥  1,348,751   ×1.2 → ¥  2,363,188   差 ¥1,014,437
  salary          ×0.8 → ¥  1,483,924   ×1.2 → ¥  2,228,016   差 ¥744,092
  assist_minutes  ×0.8 → ¥  1,991,142   ×1.2 → ¥  1,720,797   差 ¥270,345
  auto_rate       ×0.8 → ¥  1,805,763   ×1.2 → ¥  1,906,177   差 ¥100,414
  in_tokens       ×0.8 → ¥  1,856,582   ×1.2 → ¥  1,855,358   差 ¥1,224
  hit_rate        ×0.8 → ¥  1,855,382   ×1.2 → ¥  1,856,558   差 ¥1,176
```

一行一行读:

- 模型费每张 ¥0.0142,每月 4260 元。对一家每月人工成本两百多万的客服团队,这是零头。第 2 步那个「< ¥0.1」的指标,放宽到这么松都没关系。
- 隐含客服人数 222 人,和「每天 1 万张、每张 8 分钟」自洽。面试时你可以主动说出这个数,面试官会知道你在核对假设。
- 每张工单人工 ¥8.58,Agent 加权 ¥2.40,省 72%。
- 敏感度表是今天最值得记住的东西。`human_minutes` 和 `salary` 排前两名,但它们是现状,不是你能改的。在你能改的参数里,**`assist_minutes`(客服看草稿要几分钟)排第一,差 27 万;`auto_rate`(自动解决率)第二,差 10 万;`in_tokens` 和 `hit_rate` 只差一千多块**。

也就是说,把 token 用量压掉 20%,每月多省 1200 元;让客服看草稿快 20%(3 分钟变 2.4 分钟),每月多省 27 万。第一阶段的工作重点是**提高草稿质量、让客服改得快**,而不是压 token。能把这句话带着数字说出来,面试官会知道你理解的是业务,不只是技术。

**还要说清这个 ROI 哪里不可信。** 「0.4 个月回本」好得不像真的,面试官一定会挑战,你要先自己说:

1. 省下的是**工时**,不会自动变成钱。只有当客服团队因此不用再扩招,或者有人被调去做别的,这笔钱才真的省下来。所以更准确的说法是「每月释放约 X 个人力」,用 `monthly_saving` 除以人均用工成本,约 185.6 万 ÷ 1.12 万 ≈ 166 人(人均用工成本 8000 × 1.4 = 1.12 万)。
2. 开发成本只算了三个人半年,没算持续的运维、评测标注、知识库维护,这些每月都要人。
3. 最大的不确定在 `assist_minutes`:3 分钟是假设,草稿如果质量差,客服要先读一遍再删掉重写,反而比自己写还慢。练习 2 会算出这个打平点。

所以第 7 步的结尾这样说:「按这些假设回本很快,但真正的风险在草稿采纳率。这也是为什么我的上线节奏先走两周影子模式,再走一到两个月辅助模式,先把 `assist_minutes` 量出来,再决定要不要投更多。」这样成本这一步就和第 5 步的上线节奏接上了。

今天的实跑一共花了约 ¥0.008(只有 `measure_ticket.py` 调了模型,按空闲价),另外两个脚本不调模型。

## 40 分钟讲完是什么样子

七步都过了一遍,最后看一下在面试现场怎么把它们串起来。下面是一个压缩到两分钟的口述版本,你在白板上画的就是上面那张架构图:

「先确认几个问题:工单分布、Agent 能做什么不能做什么、现在人工处理多久……我先假设每张 8 分钟,那现在大约需要两百多名客服。目标定在第一阶段自动解决 30%、草稿采纳率 70%、越权为零。架构上我用固定的工作流而不是自由 Agent,因为流程大部分是确定的;前面加队列,高峰按每秒 1.2 张、每张 15 秒算,同时处理约 18 张,考虑波动 worker 开 25 到 30 个;出口分三条,自动发、进工作台、进审批。数据上业务数据实时查,身份从工单账户取。评测用 500 张历史工单加 50 条对抗用例,上线走影子、辅助、自动三个阶段。风险里我最担心事实错误和误退款,分别靠出口比对和只申请不执行来兜。成本上每张模型费约一分多钱,人工约八块六,Agent 加权后两块四;ROI 对客服看草稿的时间最敏感,对 token 几乎不敏感,所以第一阶段重点是草稿质量。」

讲到这里大约用了 30 分钟,剩下 10 分钟给追问。追问清单是明天的内容。

## 动手练习

**练习 1:换几组参数。** 用 `estimate.py` 里的函数,算四种情况:题面默认;用 `measure_ticket.py` 实测的 token(820 输入、62 输出、命中率约 8%);每天 5 万张;草稿很差、客服每张要看 7 分钟。每种打印每张模型费、Agent 每张成本、人工每张成本、每月节省、高峰时同时在处理的工单数。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex508_params.py
from dataclasses import replace

from part09.sysdesign.estimate import Plan, agent_cost, model_cost, monthly_saving, per_minute

scenarios = {
    "题面默认": Plan(),
    "实测 token": Plan(in_tokens=820, out_tokens=62, hit_rate=0.08),
    "5 万张/天": replace(Plan(), tickets_per_day=50_000),
    "草稿很差": replace(Plan(), assist_minutes=7),
}
for name, p in scenarios.items():
    peak = p.tickets_per_day / 86400 * 10
    print(f"{name:<8} 模型费 ¥{model_cost(p):.4f}/张  Agent ¥{agent_cost(p):.2f}/张  "
          f"人工 ¥{p.human_minutes * per_minute(p):.2f}/张  每月省 ¥{monthly_saving(p):>11,.0f}  "
          f"高峰并发≈{peak * 15:.0f}")
```

<div class="line-notes">

- `"实测 token": Plan(in_tokens=820, out_tokens=62, hit_rate=0.08),` 命中率 64 ÷ 820 ≈ 0.08。直接用关键字参数建一个新 Plan,没写的字段用默认值。
- `"5 万张/天": replace(Plan(), tickets_per_day=50_000),` 和上一行两种写法效果一样,`replace` 适合「在某个已有的 Plan 上改一个字段」。
- `peak = p.tickets_per_day / 86400 * 10` 高峰到达率,还是按平均的 10 倍。
- `f"高峰并发≈{peak * 15:.0f}")` 利特尔法则:到达率乘每张 15 秒。

</div>

```bash
uv run python -m part09.ex.ex508_params
```

```text
题面默认     模型费 ¥0.0142/张  Agent ¥2.40/张  人工 ¥8.58/张  每月省 ¥  1,855,970  高峰并发≈17
实测 token 模型费 ¥0.0020/张  Agent ¥2.38/张  人工 ¥8.58/张  每月省 ¥  1,859,628  高峰并发≈17
5 万张/天   模型费 ¥0.0142/张  Agent ¥2.40/张  人工 ¥8.58/张  每月省 ¥  9,279,849  高峰并发≈87
草稿很差     模型费 ¥0.0142/张  Agent ¥5.40/张  人工 ¥8.58/张  每月省 ¥    954,820  高峰并发≈17
```

(中文字符宽度和英文不一样,所以列没完全对齐。)读法:模型费从 ¥0.0142 降到 ¥0.0020,降了七倍,每月节省只多了 3658 元;草稿差到客服要看 7 分钟,每月节省直接砍掉一半。5 万张时并发要 87,利特尔法则是线性的,张数翻 5 倍,worker 也翻 5 倍,这时候模型厂商的速率限制会先成为瓶颈。

</details>

**练习 2:打平点。** 客服看草稿要花多少分钟时,Agent 就完全不省钱了?分别算自动解决率 0%、30%、60% 三种情况。不要手解方程,用二分法让程序去找。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex508_breakeven.py
from dataclasses import replace

from part09.sysdesign.estimate import Plan, monthly_saving


def breakeven_assist(p: Plan) -> float:
    lo, hi = 0.0, 30.0
    for _ in range(40):
        mid = (lo + hi) / 2
        if monthly_saving(replace(p, assist_minutes=mid)) > 0:
            lo = mid
        else:
            hi = mid
    return lo


for auto in (0.0, 0.3, 0.6):
    print(f"自动解决率 {auto:.0%}:辅助模式每张超过 {breakeven_assist(replace(Plan(), auto_rate=auto)):.2f} 分钟就不省钱")
```

<div class="line-notes">

- `lo, hi = 0.0, 30.0` 打平点一定在 0 到 30 分钟之间:0 分钟时肯定省钱,30 分钟时肯定不省。
- `for _ in range(40):` 每次区间缩小一半,40 次以后区间宽度是 30 ÷ 2⁴⁰,远小于小数点后两位,够精确了。
- `mid = (lo + hi) / 2` 二分法:每次取中间试一下。还省钱,说明打平点在右边,把 `lo` 挪过来;不省了,打平点在左边,挪 `hi`。和你在一本字典里翻页找字是一个道理。

</div>

```bash
uv run python -m part09.ex.ex508_breakeven
```

```text
自动解决率 0%:辅助模式每张超过 7.99 分钟就不省钱
自动解决率 30%:辅助模式每张超过 11.24 分钟就不省钱
自动解决率 60%:辅助模式每张超过 19.37 分钟就不省钱
```

自动解决率为 0 时,打平点 7.99 分钟,比人工的 8 分钟略少一点,差的那一点是模型费。这符合直觉:全靠辅助,客服看草稿要是不比自己写快,就白干了。

自动解决率 30% 时,打平点跳到 11.24 分钟。也就是说,即使辅助模式下客服比原来还慢(11 分钟比 8 分钟),自动解决那 30% 省下的钱也能把账拉平。这个数要小心解读:它说的是「钱上还不亏」,不是「这样也可以」。客服每张多花 3 分钟,体验很差,采纳率会掉,用不了多久大家就不用草稿了。所以面试时打平点要配一句:「打平点给了我们一个底线,但辅助模式的目标是明显快于人工,我们在辅助模式阶段每周看采纳率和修改幅度。」

</details>

**练习 3:开放题。换一道题,40 分钟。** 「设计一个 Agent,帮销售团队在每次客户会议后自动整理纪要,并更新 CRM(客户管理系统)里的商机信息。」用七步框架做,每一步写出必须产出的东西,第 7 步要有算式。

<details><summary>参考答案</summary>

示范解法,按七步写出要点。你写的和我不一样很正常,对照时看每一步有没有产出、产出有没有理由。

**1 需求。** 问:会议录音从哪来(Zoom/腾讯会议的转写?),每天多少场,要更新 CRM 的哪些字段,谁能确认改动?假设:销售 50 人,每人每天 3 场,共 150 场;有会议转写文本;要更新的是商机阶段、预计金额、下一步行动、关键联系人四个字段;**改动必须由销售本人确认**,Agent 不直接写 CRM。非目标:不做实时会中提示,不做邮件自动发送。

**2 指标。** 纪要被销售采纳(不改或小改)的比例 ≥ 70%;CRM 字段建议的准确率(销售点「确认」不改的比例)≥ 80%;会后 5 分钟内出纪要;错把 A 客户的信息写进 B 客户的商机为 0。

**3 架构。** 这是 workflow,不需要自由 Agent:会议结束事件 → 队列 → 拉取转写 → 按发言人切段 → 抽取(结构化输出,四个字段 + 证据句) → 查 CRM 当前值 → 生成「改前 → 改后」的差异 → 推到销售的待确认列表 → 销售点确认后由代码写 CRM。并发很低(每天 150 场),利特尔法则算出来同时处理不到 1 个,不需要扩容设计,一个 worker 够。

**4 数据。** 转写文本含客户隐私和商业信息,进模型前脱敏客户个人信息;商机 ID 由会议日历邀请关联,**不让模型从对话里猜是哪个客户**;CRM 写权限只在「确认」按钮后面那段代码里,模型拿不到。

**5 评测。** 取 50 场历史会议,让销售标注四个字段的正确值和纪要要点;规则检查(金额是数字、阶段在枚举里)、LLM 评委查纪要的忠实度(每条要点能在转写里找到原句);上线先影子两周,对比销售自己手填的 CRM 变更。

**6 风险。** 转写错(人名、金额听错)→ 每个字段附证据原句,销售确认时能看到;客户在会上说「大概五十万吧」被记成确定金额 → 抽取时要求区分「明确承诺」和「随口一说」;把竞品信息写进 CRM 有合规问题 → 字段白名单。

**7 成本与 ROI。** 一场 45 分钟的会议转写约 1 万字,按 1 个汉字约 1 个 token 粗估(不同分词器差别很大,[Day 108](/blog/agent-zero/day-108-tokens-2/) 量过),约 1 万输入 token,抽取和纪要两次调用共约 2.5 万输入、1500 输出。按 `deepseek-flash` 高峰价:25000 × 2 + 1500 × 8 = 62000,除以一百万,约 ¥0.06 一场,每月 150 × 22 × 0.06 ≈ ¥200。人工这边:销售会后整理纪要加更新 CRM 平均 15 分钟,假设销售用工成本每分钟 ¥2,一场 ¥30;Agent 后销售只需确认,约 3 分钟,¥6。每月省 150 × 22 × 24 ≈ 7.9 万元。最敏感的参数还是「确认要几分钟」,和客服题一样。另外这道题有一个客服题没有的收益:CRM 数据更全、更及时,销售管理者的预测更准,这部分很难算成钱,面试时可以点出来但别硬算。

</details>

**验收标准**

- 能在白纸上默写七步和每一步的产出,40 分钟讲完客服题,第 5、6、7 步都讲到。
- 能用利特尔法则口算并发,并说出为什么 worker 要开得比平均值多。
- 能说出 ROI 对哪个参数最敏感、对哪个几乎不敏感,并给出数字。
- 能主动指出自己 ROI 里最不可信的三处。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 系统设计面试 | 给一句话的题面,让你在 40 分钟左右设计一个系统,考拆问题、做取舍、生产意识,没有标准答案 |
| 七步框架 | 需求、指标、架构、数据、评测、风险、成本与 ROI;Agent 题比传统题多了评测和 ROI 两步 |
| 非目标 | 明确说「这次不做」的范围,防止设计无限膨胀 |
| 利特尔法则(Little's Law) | 系统里同时在处理的数量 = 到达速率 × 每个处理时长,L = λ × W;例:每秒 1.16 张、每张 15 秒,同时约 17.4 张 |
| 指数分布 | 「随机、独立地到达」时两次到达之间的间隔分布,`random.expovariate` 按它抽样 |
| P99 | 把所有观测值从小到大排,第 99% 位置的值;99% 的时间不超过它 |
| 用工成本系数 | 公司为一个员工实际花的钱和工资之比,常粗估为 1.3 到 1.5 |
| 影子模式 | 新系统接真实流量、产出结果,但结果不给任何人看,只用来和现有做法对比 |
| 敏感度分析 | 每次只改一个参数(比如 ±20%),看结果变多少,找出结论最依赖哪个假设 |
| 打平点 | 某个参数变到多少时,方案刚好不赚不亏 |

## 常见误区

**一上来就画图。** 没问需求、没定指标,后面每个方块都没有理由。先花 5 分钟问问题和说假设。

**假设之间对不上。** 「每天 1 万张、每张 8 分钟、40 个客服」,三个数放在一起不成立,面试官一算就穿。脚本里那一行「隐含客服人数」就是为了防这个。

**按平均值开 worker。** 利特尔法则给的是平均,到达是一阵一阵的。模拟里平均 17.1,P99 是 27。

**拼命压 token 成本。** 敏感度分析里 token 用量变 20%,每月节省只变 1200 元;客服看草稿时间变 20%,节省变 27 万。先把草稿质量做好。

**ROI 报一个漂亮数就停。** 「0.4 个月回本」不可信:省下的是工时不是钱,开发成本没算运维和标注,看草稿要几分钟还是假设。自己先说出这三点。

**架构讲了 30 分钟。** 评测、风险、成本没时间讲,而这三步才是 Agent 题拉开差距的地方。按时间表走,架构最多 12 分钟。

**觉得面试官不回答问题是在为难你。** 很多时候他就是想看你怎么假设。说「我先假设……,您看是否合理」,然后继续。

## 学习资料

### 文档与文章

- [ByteByteGo · A Framework For System Design Interviews](https://bytebytego.com/courses/system-design-interview/a-framework-for-system-design-interviews):传统系统设计题的四步法(理解问题、高层设计、深入、收尾),今天的七步是在它上面加了指标、评测和 ROI。
- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):第 3 步「为什么是 workflow 不是 agent」的出处,面试时引用它比自己说更有分量。
- [维基百科 · 利特尔法则](https://zh.wikipedia.org/wiki/利特爾法則):中文,定义和几个例子。[英文版](https://en.wikipedia.org/wiki/Little%27s_law)讲得更全。
- [DeepSeek · 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):今天 `PRICE` 的出处,高峰和空闲两档,以及模型名和版本的对应。
- [donnemartin/system-design-primer](https://github.com/donnemartin/system-design-primer):传统系统设计的知识清单,队列、缓存、负载均衡这些名词不熟的时候查这里。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1F43y6XETn&autoplay=0&high_quality=1" title="面试官问：设计一个生产级Agent系统，你怎么从头到尾把架构搭起来？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Agent开发实战 · 面试官问:设计一个生产级 Agent 系统,你怎么从头到尾把架构搭起来? · 5 分钟,2026 年 7 月。短,当作一个别人的版本听,对照七步看他漏了哪一步。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV19f4y1a7DZ&autoplay=0&high_quality=1" title="系统设计面试6个技巧｜我面Google前的准备方法" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>TerryChen_泰瑞 · 系统设计面试 6 个技巧|我面 Google 前的准备方法 · 12 分钟,2021 年的老视频,讲的是传统系统设计面试,但「先问需求、主动说假设、控制时间」这几条完全通用。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/i7twT3x5yv8" title="System Design Interview: A Step-By-Step Guide" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>ByteByteGo · System Design Interview: A Step-By-Step Guide · 英文,动画讲系统设计面试的步骤和时间分配,和第一篇文档是同一个作者。</figcaption>
</figure>

### 书籍

- Alex Xu《System Design Interview – An Insider's Guide》(Byte Code LLC,2020):第 3 章就是上面那个四步框架,第 2 章讲粗略估算(back-of-the-envelope),今天的并发和成本估算是同一种功夫。
- Chip Huyen《AI Engineering》(O'Reilly,2025):最后一章「AI Engineering Architecture and User Feedback」讲一个 AI 应用从简单到复杂怎么一层层加组件,正好对应今天的架构图。

### 开源项目与代码

- [langchain-ai/deepagents](https://github.com/langchain-ai/deepagents):如果面试官追问「为什么不直接用现成的 agent 框架」,看看这类框架的默认结构(规划、子 Agent、文件系统),能说清它适合什么、不适合客服这种确定流程。
- 今天的三个脚本 `measure_ticket.py`、`queue_sim.py`、`estimate.py` 本身就值得放进你的作品仓库,面试时「我有一个估算脚本」比「我估计」有说服力得多。

## 自测

1. 七步框架里,哪两步是 Agent 系统设计题比传统系统设计题多出来的?为什么面试官特别看重?

<details><summary>答案</summary>

评测(第 5 步)和成本与 ROI(第 7 步)。模型输出不确定,「你怎么知道它答对了」决定这个系统能不能上线;Agent 有持续的模型费和人工复核成本,「这东西值不值得做」决定它该不该做。传统题讲完架构、存储、扩容就够了,Agent 题这两步不讲等于没答完。

</details>

2. 每天 2 万张工单,高峰是平均的 10 倍,每张处理 20 秒,平均同时要处理多少张?worker 开这么多够吗?

<details><summary>答案</summary>

高峰到达率 20000 ÷ 86400 × 10 ≈ 2.31 张/秒,利特尔法则 L = 2.31 × 20 ≈ 46 张。不够,这是平均值,随机到达时会上下波动,今天的模拟里平均 17 时 P99 到了 27,大约高出一半。按这个比例 worker 要开到 70 左右,并且要确认模型厂商的速率限制撑得住。

</details>

3. 敏感度分析里,`in_tokens` 改 ±20%,每月节省只差 1224 元,为什么这么不敏感?

<details><summary>答案</summary>

因为模型费在总成本里占比太小。每张模型费 ¥0.0142,而人工部分是几块钱(辅助模式 3 分钟约 ¥3.2)。`in_tokens` 从 0.8 倍到 1.2 倍,差 4000 个输入 token,一半按 2 元、一半按 0.04 元算,每张只差约 ¥0.004,乘上每月 30 万张约 1200 元。`assist_minutes` 从 0.8 倍到 1.2 倍差 1.2 分钟,乘每分钟 ¥1.07、再乘 70% 走辅助模式的比例,每张约差 ¥0.90,是前者的两百多倍。

</details>

4. 「0.4 个月回本」这个结论,你会怎么向面试官解释它的局限?

<details><summary>答案</summary>

三点:一是省下的是工时,只有不再扩招或者把人调去做别的,才变成真的钱,更准确的说法是「释放约 166 个人力」;二是开发成本只算了三个人半年,没算持续的运维、标注、知识库维护;三是最关键的 `assist_minutes = 3` 是假设,草稿质量差时客服反而更慢,所以上线先走影子和辅助模式,把它量出来再决定投入。

</details>

5. (面试题)「你为什么用固定的工作流,而不是让一个 Agent 自己决定怎么处理工单?」

<details><summary>答案</summary>

因为客服流程大部分是确定的:分类、检索、查业务数据、起草、自检,顺序基本不变。用显式的图把它们串起来,每一步都能单独观测、单独评测、单独换模型(分类用小模型、起草用大模型);出了问题能定位到是哪一步。自由的 Agent 更灵活,但路径不可预测,评测和排障都难得多,成本也高。我只在「查哪些业务数据」这一步给模型工具选择权。这也是 Anthropic 那篇 Building effective agents 的观点:能用 workflow 的地方先用 workflow,路径真的没法预先确定时才用 agent。明天的 Deep Research 就是后一种情况。

</details>

6. (面试题)「影子模式、辅助模式、自动模式,为什么不直接上自动模式?」

<details><summary>答案</summary>

因为离线评测集再好也只是样本,真实分布只有接真实流量才看得到。影子模式零风险地拿到真实分布上的对比数据;辅助模式让客服当最后一道关,同时量出最关键的 ROI 参数(草稿采纳率、客服看草稿要几分钟),我的敏感度分析显示 ROI 对这个参数最敏感;自动模式按类别逐步开放,先开采纳率最高、风险最低的,每开一类都有观察期和随时能关的开关。直接上自动模式,一旦有系统性错误(比如某条政策理解错了),会在没人发现的情况下发给成千上万的客户。

</details>

## 明天预告

Day 509 · 系统设计(二):Deep Research Agent 和追问清单。今天的客服题路径基本确定,所以用 workflow。明天换一道路径没法预先确定的题:「用户输入一个研究问题,Agent 在 10 分钟内产出一份带引用的调研报告。」这是真正的 Agent,而且适合多 Agent。我们会用 Day 507 的 async 循环当研究员,真跑一个主管加三个研究员的小系统,量一量它比单个 Agent 多花多少 token,最后把面试官最爱问的 15 个追问做成第五套题库。
