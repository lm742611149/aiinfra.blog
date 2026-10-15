---
title: 'Day 121 · 作品二开题:BillSleuth,一个会查账的 Agent'
description: '第二个作品换一个方向:做一个能查清「为什么多扣了钱」的计费争议调查 Agent。今天先补订阅计费的基本功(计费周期、锚点日、按天折算、优惠券、税、贷记单),再把 PRD、非目标、架构、十天排期和验收指标定下来。'
pubDate: 2026-10-15
regime: none
tags: ['billing', 'fde', 'prd', 'architecture', 'agent-60']
series: 'agent-60'
day: 121
lang: 'zh'
---

## 今天要解决的问题

作品一 Agent Loupe 证明的是「我会做给 Agent 用的工具」。作品二要证明另一件事:**我能把 Agent 放进一个出错代价很高的业务里,并且拿数据说明它靠得住。** 我选的场景是计费争议:客户发来一句「为什么这个月多扣了我 26 美元」,Agent 自己去查订阅、发票、扣款和税,复算金额,找到原因,写出带证据的解释,需要退钱的时候起草一张贷记单交给人审批。

这个项目叫 BillSleuth(sleuth 是侦探的意思)。今天不写多少代码,先把地基打好。学完你应该能:

1. 用自己的话讲清楚订阅计费里的七个概念:计费周期、计费锚点日、按天折算、升降级、优惠券、税、贷记单,并且能手算一张带折算的发票。
2. 说出客户最常见的十几类账单争议,以及每一类该去查哪张表。
3. 写一份 BillSleuth 的 PRD:用户故事、功能清单、**非目标**,说明为什么全部用虚构数据。
4. 画出架构图,说清楚参考引擎、MCP 工具层、调查流程、证据链、审批、评测这几块各管什么。
5. 定下十天排期和六个验收指标,知道 Day 127 要拿什么数字来证明这个项目做成了。

预计用时 3–4 小时,一半时间读计费概念、手算,一半写 PRD。前置:Day 23(写 MCP server)、Day 24–25(LangGraph 和人工审批)、Day 28(工单分流 Agent)、Day 69(评测里的统计)、Day 73(设计 benchmark)。这几天的写法后面会直接沿用。

## 为什么第二个作品选计费争议

先说我自己挑题时的三个标准,你换题目时也可以拿来用。

第一,**招聘方一眼能看懂它值钱**。上周我们抓了一批海外远程 FDE(Forward Deployed Engineer,驻场交付工程师)和 Solutions Engineer 的 JD,FDE 那一组里八成写了要直接面对客户,四成多要出差,65% 提到部署和云,SQL 也出现在三分之一多的 JD 里。反过来,RAG、多 Agent、框架这些词在 FDE 的 JD 里只有普通 Agent 工程师岗的一半左右。FDE 的日常不是造框架,是把 Agent 接进客户那套乱七八糟的业务系统,让它在真实数据上不出错。计费是几乎每个 SaaS 公司都有、而且都头疼的系统,面试官不需要你解释背景。

第二,**出错的代价高,所以可靠性有意义**。客服 Agent 答错一个功能问题,客户再问一次就好;计费 Agent 把 26.02 说成 25.80,财务对账对不上,客户会觉得你们在糊弄他。这逼着我们做几件普通 Demo 不会做的事:金额全部用 Decimal、Agent 不许心算、每个数字都要有出处、退钱必须人批。这些恰好是面试时最能拉开差距的话题。

第三,**能严格评测**。SupportPilot 的回复好不好,很多时候要靠 LLM judge 打分,分数有噪声。计费争议不一样:根因是不是「按天折算分母写死 30」,多收的是不是 26.02 美元,对就是对,错就是错。我们可以造 100 个带标准答案的场景,用精确匹配算准确率,再用 Day 69 的方法给出置信区间。这样的评测报告放在作品页上,比一段演示视频有说服力得多。

还有一个私心:**计费是一门很多工程师没系统学过的手艺**。做完这个项目,你对订阅、折算、税、贷记单的理解,会比大多数只调过支付 SDK 的人深,这本身就是 FDE 面试里的加分项。

## 订阅计费十分钟入门

下面这些概念全部用我们虚构的公司「云簿 CloudLedger」来讲。它卖在线记账软件,按席位(seat,就是账号数)收费。规则是我照着主流订阅计费系统的通行做法简化的,Stripe 的文档里能找到对应概念,链接放在学习资料里。

### 计费周期和锚点日

月付客户每个月出一张发票,年付每年一张。每张发票覆盖一段时间,叫计费周期(billing period),用 `period_start` 和 `period_end` 表示。**`period_end` 不含当天**:6 月 5 日到 7 月 5 日这个周期,包含 6 月 5 日,不包含 7 月 5 日,一共 30 天。这个约定看着不起眼,后面算天数全靠它,很多计费 bug 就出在有人把结束日当成了包含。

每个月从几号开始算,由计费锚点日(billing anchor day)决定。客户 6 月 5 日开通,锚点日就是 5,之后每个月 5 号出账。真实系统要处理 1 月 31 日开通、2 月没有 31 日这种情况,我们偷个懒,规定锚点日只能是 1 到 28 号。

### 按天折算

客户在周期中间改了套餐或席位数,这个月的钱怎么算?最常见的做法叫按天折算(proration):旧配置没用完的天数退给客户,新配置剩下的天数向客户收钱。

拿一个具体例子手算一遍。客户买的是团队版,每席位每月 39 美元,3 个席位,一个月 117 美元。周期是 6 月 5 日到 7 月 5 日,30 天。6 月 20 日升级到商业版,每席位 89 美元,3 个席位一个月 267 美元。从 6 月 20 日到 7 月 5 日还剩 15 天:

- 退还旧套餐未使用部分:117 × 15 / 30 = 58.50 美元
- 收取新套餐剩余部分:267 × 15 / 30 = 133.50 美元

这两行不会出现在 6 月那张已经开出的发票上,而是记到下一张,也就是 7 月 5 日出的发票上。所以 7 月那张发票有三行:-58.50、+133.50、再加上 7 月整月的新套餐 267.00,小计 342.00。客户看到 7 月账单比平时多出一大截,常常第一反应是「多扣了」,其实是对的。这类「账没错、客户看不懂」的情况,在我们的评测集里占五分之一。

这里有两个决定会直接影响金额。一是**分母用这个周期的实际天数**,6 月周期是 30 天,7 月周期是 31 天,有人图省事写死 30,31 天的月份就会多收。二是**「6 月 20 日」是谁的 6 月 20 日**。客户在上海,凌晨 0 点 30 分点了升级,UTC 时间还是 6 月 19 日 16 点 30 分。如果系统按 UTC 取日期,剩余天数就从 15 天变成 16 天,又多收一天。这两个 bug 后面都会被我们故意造出来,让 Agent 去抓。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="按天折算示意:6 月周期中途升级,旧套餐退还 15 天,新套餐收取 15 天,记在 7 月发票上">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="28" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">6 月周期 6/5 – 7/5(30 天),6/20 升级</text>
  <line x1="40" y1="70" x2="600" y2="70" stroke="var(--rule)"/>
  <text x="40" y="60" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">6/5</text>
  <text x="310" y="60" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">6/20</text>
  <text x="580" y="60" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">7/5</text>
  <rect x="40" y="80" width="280" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="180" y="100" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">团队版 117/月 已用 15 天</text>
  <rect x="320" y="80" width="280" height="30" fill="none" stroke="var(--mem)" stroke-dasharray="4 3"/>
  <text x="460" y="100" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">未用 15 天 → 退 58.50</text>
  <rect x="320" y="118" width="280" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="460" y="138" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">商业版 267/月 剩 15 天 → 收 133.50</text>
  <text x="20" y="185" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">7 月 5 日的发票:</text>
  <text x="40" y="207" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">折算 -58.50 | 折算 +133.50 | 7 月订阅费 267.00 | 小计 342.00 | 税 6% 20.52 | 合计 362.52</text>
  <text x="40" y="235" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">分母用周期实际天数;日期按客户所在地的本地日期算</text>
</svg>
<figcaption>中途升级的钱记在下一张发票上,所以客户会在 7 月看到一张「比平时贵很多」的账单。图里的数字和 Day 122 引擎单元测试里的数字一致。</figcaption>
</figure>

### 优惠券、税、贷记单

优惠券(coupon)分两种:按百分比打折,或者直接减一个金额。它还有有效期,比如「前 3 个月八折」。客户最常问的一类问题是「我没改套餐,怎么这个月突然涨价了」,答案往往是优惠期结束了。我们的规则是优惠券作用在小计上,小计包括订阅费和折算,税在折扣之后算。

税的计算顺序是:**(小计 − 折扣)× 税率**,四舍五入到分。税率按地区来,而且有有效期。真实世界里各国税率会调整,系统里必须存「哪个税率从哪天到哪天有效」,开票时按开票日查。我们的税率表里有一个虚构的「美国数字服务税」,7 月 1 日从 5% 降到 3%,专门用来制造「用了过期税率」这类故障。中国 6%、新加坡 9%、德国 19% 是按常见税率简化的,只用来练习,真实税务以当地规定为准。

贷记单(credit note)是本项目的核心动作。发票一旦开出就不能改,多收了钱的正确做法不是去改发票金额,而是开一张贷记单:说明「这张发票冲减多少钱、为什么」,然后把这笔钱退回客户的卡上,或者留作余额抵扣下一期。它和退款(refund)的关系是,贷记单是会计上的凭证,退款是钱怎么回到客户手里。BillSleuth 只做到「起草贷记单」这一步,签发要人审批,真正退款在我们的系统之外。

最后提一个今天不展开的概念,催缴(dunning):扣款失败后按策略重试、发提醒邮件、最终暂停服务。它产生的争议(「卡里明明有钱怎么说我欠费」)也很常见,但需要模拟支付网关的行为,放进非目标,留给你以后扩展。

## 客户会问的十几类问题

我把常见的计费争议整理成 12 类根因,外加一类「账没错,是客户误解」。它们就是 Day 122 造数据时要注入的故障,也是 Agent 结论里 `root_cause` 字段的取值:

| 根因 | 客户通常怎么说 | 该查哪里 |
| --- | --- | --- |
| proration_wrong_days 折算分母写死 30 天 | 「这个月怎么比算的多一点」 | 发票折算行 + 周期天数 |
| proration_missing_credit 升级漏了退还行 | 「升级后这张发票贵得离谱」 | 折算行是否成对出现 |
| duplicate_charge 同一张发票扣款两次 | 「卡上有两笔一样的扣款」 | 扣款记录 |
| duplicate_invoice 同一周期开了两张发票 | 「收到两张一样的发票」 | 同周期的其他发票 |
| expired_tax_rate 用了过期税率 | 「税好像不对」 | 税率表的有效期 |
| wrong_tax_region 用了别的地区税率 | 「为什么税这么高」 | 客户税务地区 |
| coupon_not_applied 优惠券没抵扣 | 「说好的八折呢」 | 优惠券有效月份 |
| coupon_wrong_base 百分比券算错基数 | 「折扣好像少了」 | 折扣行和小计 |
| quantity_change_ignored 减席位没生效 | 「减了席位怎么没便宜」 | 订阅事件 + 订阅费行 |
| cancel_not_respected 取消后仍扣款 | 「早就取消了还扣钱」 | 取消事件 + 之后的发票 |
| timezone_change_date 时区算错日期 | 「这个月好像多算了一点」 | 事件本地日期 vs 折算起始日 |
| wrong_plan_price 单价不对 | 「价格和官网不一样」 | 订阅费行单价 vs 价目表 |
| no_error 账没错 | 以上任何一种说法 | 全部核对一遍才能下这个结论 |

最后一行最容易被忽略。一个只会「找错」的 Agent,看到客户抱怨就往有错的方向想,很容易把正确的折算说成多收,然后起草一张不该有的贷记单。这比漏掉一个错误更糟,因为它会真的把钱退出去。所以验收指标里专门有一项「误冲正率」。

另外你会发现,客户的说法和根因之间不是一一对应的。「这个月怎么比算的多一点」可能是折算分母错、时区错、税率错、单价错,也可能根本没错。Agent 不能从客户原话直接猜答案,必须去查。这也是它值得用 Agent 来做的原因:查什么、先查什么、查到一半发现方向不对要换,这些步骤没法事先写死。

## PRD:做什么、不做什么

PRD 我习惯写成一页,放在仓库的 `docs/prd.md`。下面是 BillSleuth 的版本,你可以照着改。

**背景**:云簿的计费客服每天收到几十个「多扣钱了」的工单,一个熟练的客服查一单要 15 到 30 分钟,要在三四个后台之间来回翻,还经常算错。

**用户与用户故事**:

- 一线客服:我把客户原话和客户编号丢给 BillSleuth,几十秒内拿到结论(有没有多收、多收多少、原因)、一段可以直接发给客户的回复、一段给同事看的内部说明,里面每个数字都能点开看出处。
- 计费主管:Agent 起草的贷记单会出现在我的审批列表里,我能看到证据链,批准或驳回。没有我的批准,钱不会动。
- 工程师(就是你):每次改提示词、换模型、加工具,跑一遍 100 个场景的评测,拿到准确率、成本和置信区间,知道这次改动是变好还是变坏。

**功能清单**:参考计费引擎;100 个带标准答案的场景;只读查询工具和复算工具(MCP);调查流程(LangGraph);证据链和数字溯源校验;客户版和内部版两种解释;贷记单草稿和人工审批;评测和模拟客户;Web 演示页。

**非目标**,这一段比功能清单更重要:

- 不接任何真实支付网关,不真的退款。「签发贷记单」就是终点。
- 不处理多币种和汇率,云簿国际版统一用美元结算。
- 不做催缴、不做用量计费、不做月付和年付之间的互换。
- 不让 Agent 直接改发票或改订阅。它能写的只有贷记单草稿。
- **不使用任何真实公司的代码、表结构或客户数据**,全部虚构。

最后一条我想多说几句。你可能在工作里就接触过计费系统,手里有现成的真实场景。把它们抽象成「故障类别」放进作品里是可以的,这是你的经验;但真实的表结构、代码片段、客户名字、金额,一个都不要带进来。一是公司保密要求,二是面试官看到这些会担心你将来也这样对待他们的数据。虚构数据还有一个工程上的好处:每个场景都有确定的标准答案,可以反复重跑,这是真实数据给不了的。

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

几个关键的设计决定,先说结论,理由在对应的那一天展开:

**参考引擎是「标准答案」,同时也是 Agent 的工具**。造数时用它生成正确的账,再注入错误;Agent 查账时通过 `recompute_invoice` 调用同一个引擎,拿「应收」和「实收」逐类对比。这样做的好处是 Agent 永远不用自己算钱。坏处也很明显:评测会偏乐观,因为工具几乎直接把差额告诉了 Agent。Day 127 我们会正视这个问题,加上模拟客户和更难的场景。

**定位候选发票用代码,不用模型**。客户说了金额和月份,在发票列表里找对应的那张是一个确定的查找问题,写十行代码比让模型翻列表便宜、稳定、可测。能用代码做的就别交给模型,这是 Day 9 以来我们反复说的原则,在这里体现得很具体。

**证据由代码从工具结果里抽取**。模型抄数字会抄错,代码不会。每次工具调用成功后,代码把结果里的金额、日期、税率抽出来,编号成 E1、E2……存进状态。最后写给客户的每个数字,都必须能在这里找到,找不到就打回重写。

**写操作只有一个,而且只能写草稿**。和 Day 28 一样,最小权限。

## 仓库结构和十天排期

```text
billsleuth/
├── pyproject.toml
├── .env                     # LLM_BASE_URL / LLM_API_KEY / LLM_MODEL / LLM_EXTRA_BODY / LLM_PRICE
├── billing.db               # 造数生成,不提交
├── scenarios/S001.json …    # 100 个场景的标准答案,不给 Agent 看
├── docs/prd.md
├── billsleuth/
│   ├── money.py             # Decimal 规则(Day 122)
│   ├── schema.sql  db.py    # 建表和连接(Day 122)
│   ├── engine.py            # 参考计费引擎(Day 122)
│   ├── refdata.py           # 价目表、优惠券、税率(Day 122)
│   ├── faults.py  seed.py   # 12 类故障注入和造数(Day 122)
│   ├── repo.py  server.py   # 读库和 MCP server(Day 123)
│   ├── llm.py  mcp_bridge.py  evidence.py  graph.py  run.py   # 调查流程(Day 124)
│   ├── grounding.py  explain.py   # 数字溯源和解释(Day 125)
│   └── …                    # 审批、评测、演示(Day 126–129)
└── tests/
```

| Day | 内容 | 产出 |
| --- | --- | --- |
| 121 | 开题(今天) | PRD、架构、指标 |
| 122 | 计费参考引擎与 12 类故障造数 | `engine.py`、`seed.py`、100 个场景、引擎单测 |
| 123 | MCP 工具层、复算工具与审计日志 | `server.py`,对 100 个场景复算都能找到差额的测试 |
| 124 | LangGraph 调查流程与证据链 | `graph.py`,真模型跑通若干场景 |
| 125 | 有据可查的解释 | 数字溯源校验器、两种解释 |
| 126 | 贷记单草稿、人工审批与幂等 | 审批流(CLI + Web) |
| 127 | 100 个场景的评测与模拟客户 | 评测报告(六个指标 + 置信区间) |
| 128 | 错误分析与迭代 | 改进前后对比 |
| 129 | 在线演示、实时调查面板与部署 | 公网演示页 |
| 130 | 作品篇结业 | 案例页、面试故事 |

## 验收指标

指标在开工前定,不在做完后挑好看的报。下面六个都在 Day 127 计算,目标值是我拍的起点,不是承诺,测出来达不到就如实写:

| 指标 | 定义 | 起点目标 |
| --- | --- | --- |
| 根因准确率 | 结论的 `root_cause` 等于标准答案的场景占比 | ≥ 85% |
| 差额精确匹配率 | 结论的多收金额和标准答案**分毫不差**的占比 | ≥ 85% |
| 数字幻觉率 | 最终回复里出现证据链里找不到出处的金额的场景占比 | 0%(校验器兜底) |
| 误冲正率 | 账没错却起草了贷记单的场景占 no_error 场景的比例 | ≤ 5% |
| pass^k | 同一个场景跑 k 次全部答对的比例(τ-bench 的指标) | 报 k=3 |
| 单场景成本与耗时 | 每个场景的 token 花费和墙钟时间,报中位数和 P95 | 成本 < ¥0.1 |

差额要求分毫不差,是因为计费里「差不多」就是错。数字幻觉率定成 0%,是因为我们有校验器:模型写出编造的数字会被打回,三次还不行就用模板兜底,所以最终送到客户手里的回复里不应该有编造的数字。如果测出来不是 0,说明校验器有漏洞,这比模型的问题更严重。

## 动手练习

今天的练习是搭好仓库骨架、写 PRD,再用 Python 验证一遍你的手算。

**第一步:建仓库**

```bash
mkdir billsleuth && cd billsleuth
uv init --bare --name billsleuth
uv add "mcp[cli]" langgraph langchain-openai python-dotenv
uv add --dev pytest anyio
mkdir -p billsleuth tests scenarios docs
touch billsleuth/__init__.py
cp ../agent-60-lab/.env .env      # 复用课程里的 DeepSeek 配置
printf 'billing.db\n.env\n.venv/\n__pycache__/\n' > .gitignore
```

然后在 `pyproject.toml` 末尾加上,让测试能 `import billsleuth`:

```toml
[tool.pytest.ini_options]
pythonpath = ["."]
```

**第二步:写 `docs/prd.md`**。照上面的结构写,至少包含背景、三类用户故事、功能清单、非目标(五条以上)、六个验收指标。写非目标时,每一条都想一下「如果面试官问为什么不做,我怎么回答」。

**第三步:用 Decimal 验证手算**。新建 `scratch_proration.py`,把上面 6 月升级的例子算一遍,再改成 7 月(31 天)的周期算一遍,看分母写死 30 会差多少:

```python
# billsleuth/scratch_proration.py
"""手算验证:按天折算,分母用周期实际天数 vs 写死 30 天。"""
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")


def prorate(full: Decimal, used_days: int, period_days: int) -> Decimal:
    return (full * used_days / period_days).quantize(CENT, rounding=ROUND_HALF_UP)


def show(period_start: date, period_end: date, change: date) -> None:
    days = (period_end - period_start).days  # period_end 不含当天
    remaining = (period_end - change).days
    old_full, new_full = Decimal("117.00"), Decimal("267.00")  # 团队版 3 席 / 商业版 3 席
    right = prorate(new_full, remaining, days) - prorate(old_full, remaining, days)
    wrong = prorate(new_full, remaining, 30) - prorate(old_full, remaining, 30)
    print(f"{period_start}~{period_end} 共 {days} 天,{change} 升级,剩 {remaining} 天:"
          f"折算净额 {right},分母写死 30 时 {wrong},差 {wrong - right}")


show(date(2026, 6, 5), date(2026, 7, 5), date(2026, 6, 20))
show(date(2026, 7, 5), date(2026, 8, 5), date(2026, 7, 20))
print(Decimal("0.1") + Decimal("0.2"), 0.1 + 0.2)
```

```bash
uv run python scratch_proration.py
```

输出大致长这样(第一行两个数相同,因为 6 月周期正好 30 天;第二行会出现差额):

```text
2026-06-05~2026-07-05 共 30 天,2026-06-20 升级,剩 15 天:折算净额 75.00,分母写死 30 时 75.00,差 0.00
2026-07-05~2026-08-05 共 31 天,2026-07-20 升级,剩 16 天:折算净额 77.42,分母写死 30 时 80.00,差 2.58
0.3 0.30000000000000004
```

第二行你自己先手算一遍再对答案:267 × 16 / 31 = 137.806…,四舍五入 137.81;117 × 16 / 31 = 60.387…,四舍五入 60.39;净额 77.42。分母写死 30 时是 142.40 − 62.40 = 80.00。

**验收标准**:仓库能 `uv run python -c "import billsleuth"`;`docs/prd.md` 写完,非目标至少五条;能不看文章讲清楚 7 月那个例子为什么差 2.58;能说出 12 类根因里至少 8 类,以及每类该查哪张表。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| FDE(Forward Deployed Engineer) | 驻场交付工程师,把公司的产品(现在常常是 Agent 平台)接进客户的系统并让它在客户数据上跑通,大部分时间面对客户 |
| 计费周期 billing period | 一张发票覆盖的时间段,`period_start` 含当天,`period_end` 不含 |
| 计费锚点日 billing anchor day | 每个周期从每月几号开始,本项目限定 1–28 |
| 按天折算 proration | 周期中途改配置时,按剩余天数退旧收新 |
| 优惠券 coupon | 百分比折扣或固定减免,有有效月数 |
| 税率有效期 | 每个税率有生效日和失效日,开票时按日期查 |
| 贷记单 credit note | 冲减已开发票金额的会计凭证,本项目只起草、人工签发 |
| 催缴 dunning | 扣款失败后的重试和提醒流程,本项目不做 |
| 参考引擎 reference engine | 按规则算出「应收」的代码,既用来造数也作为 Agent 的复算工具 |
| 证据链 evidence chain | 从工具结果里抽出、带编号的事实清单,回答里的数字必须出自这里 |
| 误冲正 false credit | 账没错却起草了贷记单 |

## 常见误区

**把发票金额直接改掉来「修正」多收。** 已开出的发票是会计凭证,改了就对不上之前的扣款和报税。正确做法是开贷记单冲减,留下完整的审计痕迹。

**用 float 存金额,想着最后 round 一下就行。** `0.1 + 0.2` 在 float 里是 0.30000000000000004,一张发票几十行累加下来,差一分钱就会让对账失败。从第一行代码开始就用 Decimal,存库用字符串。

**以为折算的分母是 30。** 分母是这个周期的实际天数,28 到 31 都有可能。「一个月按 30 天算」是银行算利息的某些惯例,不是订阅计费的通用规则,用之前要看清楚自己公司的规则。

**只造有错的场景。** 评测集里如果全是有错的账,Agent 学会的策略是「客户一抱怨就说有错」。一定要放「账没错」的场景,并单独统计误冲正率。

**觉得 Agent 越自主越好,连定位发票都交给模型。** 能用代码确定地做完的步骤,就用代码做。模型留给真正需要判断的环节:先查哪个假设、证据够不够下结论。

**拿真实工作里的数据当作品素材。** 抽象成故障类别可以,真实表结构、代码和客户信息一个都不能带。

## 学习资料

### 文档与文章

- [Stripe · Subscriptions 概览](https://docs.stripe.com/billing/subscriptions/overview):订阅、周期、发票之间的关系讲得很清楚,20 分钟扫一遍,建立整体概念。
- [Stripe · Prorations](https://docs.stripe.com/billing/subscriptions/prorations):按天折算的官方说明,看「哪些操作会触发折算」和 `proration_behavior` 几个取值,15 分钟。
- [Stripe · Billing cycle](https://docs.stripe.com/billing/subscriptions/billing-cycle):计费锚点和周期重置,10 分钟。
- [Stripe · Credit notes](https://docs.stripe.com/invoicing/dashboard/credit-notes):贷记单怎么冲减已开发票、和退款的关系,10 分钟。
- [Stripe · Coupons and promotion codes](https://docs.stripe.com/billing/subscriptions/coupons):优惠券的种类和有效期,10 分钟。
- [a16z · Trading Margin for Moat: Why the Forward Deployed Engineer Is the Hottest Job in Startups](https://a16z.com/services-led-growth/):从投资人角度讲为什么 AI 公司都在招 FDE,读完你会更清楚作品二要证明什么,15 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1QH4y1m7re&autoplay=0&high_quality=1" title="什么是SaaS?四分钟带你了解SaaS的前世今生!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>云计算科普研究所 · 什么是SaaS?四分钟带你了解SaaS的前世今生! · 4 分钟,没接触过 SaaS 的先看这个,知道订阅制为什么需要一套计费系统。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ZY411f73U&autoplay=0&high_quality=1" title="彻底讲透SaaS部署模式、付费模式!产品经理必知的100个问题系列" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>黑马产品经理 · 彻底讲透SaaS部署模式、付费模式!产品经理必知的100个问题系列 · 34 分钟,从产品角度讲按席位、按用量、按功能分层的付费模式,看付费模式那一半就够。</figcaption>
</figure>

- 人生海海聊AI《01-FDE 前线部署工程师》(BV1EJpc6ZEoi,51 分钟):中文里少见的专门讲 FDE 这个岗位的视频,播放量不高,当作补充。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/EL2YIn5cLig" title="The Rise of the Forward Deployed Engineer" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>ZAUEY (Claire Zau) · The Rise of the Forward Deployed Engineer · 讲 FDE 这个岗位从 Palantir 到 AI 公司的演变,以及它和售前、咨询的区别。</figcaption>
</figure>

- Aced (formerly Exponent)《What is a forward deployed engineer?》(YouTube `D0Chcs_Zc2E`):面试辅导机构做的岗位介绍,适合准备 FDE 面试前看。

### 书籍

- Tien Tzuo、Gabe Weisert《Subscribed》(Portfolio, 2018;中信出版社有中译本《订阅经济》):Zuora 创始人写的订阅商业模式,看第一部分,知道订阅公司在乎哪些指标(续费、扩容、流失),理解计费错误为什么伤客户关系。
- Martin Fowler《Patterns of Enterprise Application Architecture》(Addison-Wesley, 2002):第 18 章 Base Patterns 里的 Money 一节,讲金额为什么要做成带币种的值对象、分摊时怎么处理除不尽的分,明天写引擎前读。
- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章讲 Agent 的部分,重点看工具分只读和写操作、写操作要加审批那段,对应我们的最小权限设计。

### 开源项目与代码

- [getlago/lago](https://github.com/getlago/lago):开源的用量和订阅计费系统,看它的数据模型(subscriptions、invoices、credit_notes、coupons)和我们的有什么异同,半小时。
- [killbill/killbill](https://github.com/killbill/killbill):老牌开源计费平台,文档里对订阅变更和折算的处理规则写得很细,遇到边界情况可以查。
- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench):Day 73 讲过的客服 Agent benchmark,我们 Day 127 的模拟客户和 pass^k 都从它借鉴。

## 自测

1. 6 月 5 日到 7 月 5 日这个周期有多少天?为什么说 `period_end` 不含当天这个约定很重要?

<details><summary>答案</summary>

30 天(6 月 5 日到 6 月 30 日 26 天,加 7 月 1 日到 4 日 4 天)。如果把 `period_end` 当成包含当天,天数会多算 1,按天折算的分母和分子都会错,而且相邻两个周期会在 7 月 5 日这一天重叠,同一天被收两次钱。

</details>

2. 客户 7 月 20 日从团队版(3 席,117/月)升级到商业版(3 席,267/月),周期 7 月 5 日到 8 月 5 日。这次升级在哪张发票上产生哪两行?金额各是多少?

<details><summary>答案</summary>

记在 8 月 5 日出的发票上。周期 31 天,剩 16 天:退还旧套餐 117 × 16 / 31 = 60.39,收取新套餐 267 × 16 / 31 = 137.81。两行分别是 -60.39 和 +137.81,另外这张发票还有 8 月整月的 267.00 订阅费。

</details>

3. 贷记单和退款是什么关系?为什么 BillSleuth 只做到起草贷记单?

<details><summary>答案</summary>

贷记单是冲减已开发票金额的会计凭证,退款是把钱退回客户支付方式的资金动作,一张贷记单可以对应退款,也可以作为余额抵扣下期。BillSleuth 只起草贷记单,因为动钱的操作必须有人负责:草稿让主管审批,签发后再由财务流程退款。Agent 判断错了的代价是一张被驳回的草稿,而不是一笔退错的钱。

</details>

4. 为什么评测集里要放 20% 「账没错」的场景?只放有错的场景会怎样?

<details><summary>答案</summary>

只放有错的场景,一个「客户一抱怨就说有错」的 Agent 也能拿高分,评测就失去了区分度。真实工单里有大量账没错、客户看不懂的情况(折算、税、优惠期结束、年费续费),Agent 在这些场景里起草贷记单就是误冲正,会真的把钱退出去。所以要放这类场景,并且单独统计误冲正率。

</details>

5. 定位候选发票这一步为什么用代码而不是交给模型?

<details><summary>答案</summary>

客户提到了金额或月份时,在发票列表里找对应的发票是一个确定性的查找,十行代码就能写完,结果稳定、可以单元测试,还不花 token。交给模型反而会引入不确定性:它可能看漏、看错行。模型的价值在需要判断的环节,比如先验证哪个假设、证据够不够下结论。

</details>

6. 资深面试题:面试官问「你的 Agent 准确率 90%,那剩下 10% 错了怎么办?计费这种场景能接受吗?」你怎么回答?

<details><summary>答案</summary>

先把「错」分类,不同的错代价不同。漏判(有错没查出来)的后果是客户再来一次或转人工,可以接受一定比例;误冲正(没错却要退钱)直接造成资金损失,要单独压到很低,所以写操作只能起草、必须人批,误冲正率单独作为指标。编造数字是最不能接受的,用证据链和溯源校验器在系统层面挡住,目标是 0。然后讲落地方式:先做客服的辅助工具而不是直接面对客户,Agent 给结论和证据,人确认后发出;用评测集持续跟踪三类错误,置信区间说明结论有多可靠;再按根因类别看哪些可以逐步放开自动化,比如重复扣款这类证据很明确的先放。最后提成本:人工查一单 15 到 30 分钟,Agent 几十秒加几分钱,即使只做辅助,也有明确的投入产出。

</details>

## 明天预告

明天(Day 122)写参考计费引擎:把今天手算的按天折算、锚点日、优惠券、税率有效期写成代码,用单元测试把每条规则钉死;然后写 12 个故障注入函数和造数脚本,一次生成 100 个带标准答案的场景。这一天代码量最大,但写完以后,后面所有的工具、Agent 和评测都有了可靠的地基。
