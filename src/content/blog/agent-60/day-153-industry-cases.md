---
title: 'Day 153 · 行业里的 Agent:金融、医疗、电商、SaaS 客服各长什么样'
description: '专题篇最后一篇。先用 881 条 JD 统计哪些行业在招 Agent 工程师,再拆 SaaS 客服、金融、医疗、电商四个行业的典型 Agent:知识从哪来、工具是什么、红线在哪、拿什么指标验收、出错要赔多少。最后讲面试时怎么把 SupportPilot 迁移到目标行业,以及怎么选行业。'
pubDate: 2026-10-22
regime: none
tags: ['industry', 'fde', 'use-case', 'interview', 'agent-60']
series: 'agent-60'
day: 153
lang: 'zh'
---

## 今天要解决的问题

建议在 [Day 60 · 结业](/blog/agent-60/day-60-graduation/) 之后读。做完 SupportPilot 以后,你会碰到一个很现实的问题:投出去的岗位不全是 SaaS 客服。银行要做投研助手,医院信息科要做病历质控,电商公司要做商家客服和导购。面试官问的是「你这套东西搬到我们这儿要改什么」,而不是「你会不会写 Agent 循环」。

这一篇不写新框架,讲行业。学完你应该能:

1. 说出国内和海外 JD 里 Agent 岗位集中在哪几个行业,知道这个数字是怎么数出来的、有多粗糙。
2. 用同一个五项框架(知识源、工具、红线、验收指标、出错代价)拆任何一个行业的 Agent 场景。
3. 讲清楚 SaaS 客服、金融、医疗、电商四个行业各一个公开案例:它做了什么、公布了什么数字、哪些数字是公司自己说的。
4. 面试时把 SupportPilot 的架构「换皮」讲到目标行业,知道哪些模块原样保留、哪些要重做。
5. 给自己选一个主攻行业,并说得出理由。

预计用时 3–4 小时。前置是 Day 43–54 的 SupportPilot(架构、评测、审批都会反复引用),最好也读过 Day 86 的治理合规和 Day 121 的 BillSleuth。

## 先看数据:JD 里提到哪些行业

我用 `docs/jd-research/jds.json` 里的岗位正文数了一遍。口径先说清楚,因为它很粗:

- 样本是 2026-10-12 抓的 880 条里**有正文的** 516 条(国内 695 条里只有 331 条有正文,海外 185 条全有)。没有正文的 Boss 列表数据不参与。
- 方法是关键词正则匹配「职位名 + 正文」,命中一次就算这个行业。正文里常有公司介绍,腾讯的 JD 写一句「服务金融、电商、游戏等行业」就会同时命中三个行业,所以这是「JD 里提到了这个行业」,不是「这个岗位做这个行业」。
- 一条 JD 可以同时算进几个行业,百分比加起来不等于 100%。

| 行业 | 国内(n=331) | 海外(n=185) |
| --- | --- | --- |
| 研发效能 / 写代码 | 42 条,13% | 18 条,10% |
| 金融(银行、证券、保险、支付、风控) | 39 条,12% | 47 条,25% |
| 客服 / 售后 | 26 条,8% | 8 条,4% |
| 电商零售 | 23 条,7% | 6 条,3% |
| 医疗健康 | 17 条,5% | 19 条,10% |
| 法律 | 4 条,1% | 10 条,5% |

能读出来的东西不多,但有三条比较稳。第一,**金融在海外特别突出**,四分之一的海外 JD 提到金融,里面有 Stripe、Ramp 这类支付和财务公司,也有新加坡、香港的银行和咨询外包。第二,国内电商和客服的比例比海外高,这和国内大厂的业务结构一致,腾讯营销、京东、抖音电商的岗位都在里面。第三,医疗和法律在海外比例是国内的两倍以上,海外有 Harvey、Abridge 这种单一行业的 AI 公司在大量招人,国内同类公司少。

剩下的大头是「不分行业」:Agent 平台、Agent Infra、通用助手。所以别把行业当成唯一的筛子。行业知识的作用是让你在一堆同样会写 LangGraph 的候选人里多一个区分点。

## 一个框架:换行业时要换的五样东西

SupportPilot 的骨架是:分类 → 检索知识库 → 调业务工具 → 起草回复 → 自检 → 敏感操作走审批 → 转人工。这个骨架在大部分行业都成立,真正要换的是五样东西。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="同一套 Agent 骨架,换行业时替换五个模块">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <text x="20" y="28" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">骨架不变(SupportPilot)</text>
  <rect x="20" y="42" width="90" height="36" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="65" y="65" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">分类</text>
  <rect x="125" y="42" width="90" height="36" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="170" y="65" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">检索</text>
  <rect x="230" y="42" width="90" height="36" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="275" y="65" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">调工具</text>
  <rect x="335" y="42" width="90" height="36" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="380" y="65" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">起草+自检</text>
  <rect x="440" y="42" width="90" height="36" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="485" y="65" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">审批闸门</text>
  <rect x="545" y="42" width="75" height="36" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
  <text x="582" y="65" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">转人工</text>
  <line x1="110" y1="60" x2="125" y2="60" stroke="var(--rule)"/>
  <line x1="215" y1="60" x2="230" y2="60" stroke="var(--rule)"/>
  <line x1="320" y1="60" x2="335" y2="60" stroke="var(--rule)"/>
  <line x1="425" y1="60" x2="440" y2="60" stroke="var(--rule)"/>
  <line x1="530" y1="60" x2="545" y2="60" stroke="var(--rule)"/>
  <text x="20" y="118" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">换行业要换的五样</text>
  <line x1="170" y1="78" x2="90" y2="140" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
  <line x1="275" y1="78" x2="210" y2="140" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
  <line x1="485" y1="78" x2="330" y2="140" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
  <line x1="380" y1="78" x2="450" y2="140" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
  <line x1="582" y1="78" x2="570" y2="140" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
  <rect x="30" y="140" width="110" height="64" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
  <text x="85" y="162" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">① 知识源</text>
  <text x="85" y="182" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">帮助中心→研报</text>
  <text x="85" y="196" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">→诊疗指南</text>
  <rect x="150" y="140" width="110" height="64" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
  <text x="205" y="162" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">② 工具</text>
  <text x="205" y="182" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">账单→持仓</text>
  <text x="205" y="196" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">→HIS/订单</text>
  <rect x="270" y="140" width="110" height="64" rx="4" fill="var(--paper)" stroke="var(--compute)"/>
  <text x="325" y="162" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">③ 红线</text>
  <text x="325" y="182" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">什么绝对不能</text>
  <text x="325" y="196" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">让模型自己做</text>
  <rect x="390" y="140" width="110" height="64" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
  <text x="445" y="162" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">④ 验收指标</text>
  <text x="445" y="182" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">解决率/转化率</text>
  <text x="445" y="196" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">/漏报率</text>
  <rect x="510" y="140" width="110" height="64" rx="4" fill="var(--paper)" stroke="var(--compute)"/>
  <text x="565" y="162" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">⑤ 出错代价</text>
  <text x="565" y="182" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">退一单钱</text>
  <text x="565" y="196" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">→吊销牌照</text>
  <text x="20" y="240" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">蓝 = 模型侧,琥珀 = 外部系统与规则侧。行业越严,③⑤ 越重,</text>
  <text x="20" y="258" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">审批闸门和转人工占的工作量越大,模型本身反而是小头。</text>
</svg>
<figcaption>SupportPilot 的骨架在四个行业里都能用,换的是知识源、工具、红线、指标、出错代价。</figcaption>
</figure>

**知识源**:Agent 回答问题时能引用什么。客服是帮助中心文章,金融是研报、产品说明书、内部合规手册,医疗是诊疗指南和药品说明书,电商是商品详情页和售后规则。知识源决定了 RAG 那一层的难度:帮助中心文章短而规整,研报是带表格的长 PDF,药品说明书有大量否定句和剂量数字(Day 15 讲过,embedding 对否定句很迟钝)。

**工具**:Agent 能读写哪些系统。客服查账单、开工单,金融查持仓和交易流水,医疗读 HIS(医院信息系统)和检验结果,电商查订单、物流、库存。工具的权限分级(Day 40)在每个行业都要重做一遍,因为「写操作」的含义变了:客服里退一笔钱是写操作,医疗里往病历里写一句话就是写操作。

**红线**:哪些事情模型绝对不能自己做,规则写死在代码里,不靠 prompt。下面每个行业我都会举一条有出处的。

**验收指标**:上线前后拿什么数字证明它有用。客服看解决率和转人工率,电商看转化率,医疗更在意漏报(该提醒的没提醒)而不是准确率。

**出错代价**:错一次要付出什么。客服错一次大不了退一单钱,但后面会讲到,退一单钱也可能上法庭。金融错一次可能是监管处罚,医疗错一次是人身伤害。代价越高,你花在审批闸门、日志审计、评测上的时间占比越高。

下面四个行业都按这五项拆。案例全部是公开报道,每个数字我都标了出处和「谁说的」。大部分效果数字是公司自己披露的,没有第三方审计,读的时候心里打个折。

## SaaS 客服:离 SupportPilot 最近,也最卷

这是你最熟的场景,也是 Agent 落地最早、竞争最激烈的地方。海外有 Intercom Fin、Sierra、Decagon,国内几乎每个云厂商和客服 SaaS 都有自己的大模型客服。

先看定价,因为定价方式反过来决定了工程上要做什么。Intercom 官网 2026 年 10 月写的 Fin 价格是**每次解决 0.99 美元**,「解决」的定义是 Fin 最后一次回答之后客户没有再要求帮助(查自 [fin.ai/pricing](https://fin.ai/pricing))。Sierra 不公开价格,它的官方博客把模式叫 outcome-based pricing:只在 Agent 达成约定结果时收钱,比如解决了一次咨询、挽回了一次退订([Sierra 博客](https://sierra.ai/blog/outcome-based-pricing-for-ai-agents))。

按结果收费听起来对客户很友好,对工程师的意思是:**「什么算解决」必须能被机器判断,而且判断标准要经得起客户审计**。Fin 那条定义有个明显的漏洞,客户被气走了不再回复,也会被算成「解决」。第三方评测文章就批评过这一点。你在 SupportPilot 里做的评测(Day 50)是离线的,按结果收费的产品要把同一套判断逻辑放到线上,每一单都要算,还要留证据。这就是为什么 Day 144 讲的隐式反馈采集在客服行业特别值钱。

再看一个被讲烂了但仍然值得讲的案例:Klarna。2024 年 2 月 Klarna 发新闻稿说,接入 OpenAI 的 AI 助手上线第一个月处理了 230 万次对话,占客服聊天量的三分之二,工作量相当于 700 名全职客服,平均解决时间从 11 分钟降到 2 分钟以内([Klarna 新闻稿](https://www.klarna.com/international/press/klarna-ai-assistant-handles-two-thirds-of-customer-service-chats-in-its-first-month/),[CX Today 报道](https://www.cxtoday.com/contact-center/klarna-claims-its-new-ai-assistant-does-the-work-of-700-full-time-agents/))。到 2025 年 5 月,CEO 公开说之前太看重成本、导致服务质量下降,开始重新招人工客服,承诺「想找人就一定有人」([CX Dive,2025-05-09](https://www.customerexperiencedive.com/news/klarna-reinvests-human-talent-customer-service-AI-chatbot/747586/))。The Pragmatic Engineer 当时就写过一篇冷静的分析,指出那批数字有多少是营销口径([原文](https://blog.pragmaticengineer.com/klarnas-ai-chatbot/))。

这件事给工程师的教训很具体。三分之二的对话被 AI 接住,剩下三分之一恰好是最复杂、最情绪化、最值钱的那部分。**转人工不是兜底功能,是产品的一半**:什么时候转、转的时候带什么上下文、人工接手后能不能看到 Agent 查过什么。SupportPilot 里你做过转人工条件(Day 47),面试时可以拿 Klarna 讲为什么这个节点要单独评测。

最后是出错代价。2024 年 2 月加拿大 BC 省民事仲裁庭判 Air Canada 败诉:它网站上的聊天机器人告诉一位乘客丧亲票价可以事后申请退差价,实际政策要求事先申请。Air Canada 辩称聊天机器人是「独立的法律实体」,仲裁员直接驳回,判公司赔偿([CanLII 判决原文 2024 BCCRT 149](https://www.canlii.org/en/bc/bccrt/doc/2024/2024bccrt149/2024bccrt149.html),需浏览器打开;[Kiplinger 报道](https://kiplinger.com/personal-finance/travel/air-canada-to-pay-a-partial-refund-for-chatbot-error))。赔的钱不多,几百加元,但判决的意思很清楚:**Agent 说出口的政策,公司要认**。所以客服 Agent 回答政策类问题时,引用出处(Day 21)不只是为了让用户信服,也是给公司自己留证据,方便事后查到底是知识库写错了还是模型编的。

五项总结一下:知识源是帮助中心和政策文档,工具是账单、订单、工单系统,红线是「退款、改价、承诺政策例外」必须走审批或只能引用原文,指标是解决率、转人工率、满意度,出错代价从退一单钱到被告上仲裁庭。

## 金融:先做内部助手,再碰客户

金融是海外 JD 里比例最高的行业。走在最前面的落地方式,几乎都是**先给内部员工用,不直接面对客户**。

最常被引用的是摩根士丹利。2023 年 3 月它成为 OpenAI 在财富管理领域的第一个战略合作方,先给 300 名理财顾问试用一个基于 GPT-4 的内部助手,只允许它回答约 10 万份经过公司审核的研究和流程文档里的内容([CNBC,2023-03-14](https://www.cnbc.com/2023/03/14/morgan-stanley-testing-openai-powered-chatbot-for-its-financial-advisors.html))。后来公司说超过 98% 的顾问团队在用,又加了一个会议纪要工具 Debrief,在客户同意的前提下记录会议、起草跟进事项、写回 Salesforce([InvestmentNews](https://www.investmentnews.com/fintech/morgan-stanleys-open-ai-powered-solution-for-advisors-has-expanded/254880);OpenAI 官网也有案例页 [openai.com/index/morgan-stanley](https://openai.com/index/morgan-stanley/),需浏览器打开)。98% 这个数字来自公司自己。

这个案例里值得学的是两个设计选择。第一,**知识源是封闭的、审核过的**,不是开放网页。金融机构最怕的不是模型答不出来,是模型引用了一个没审核过的说法,顾问又转述给客户。第二,**输出给的是顾问,不是客户**。顾问是持牌的人,最后对客户说什么由他负责,Agent 只是让他更快找到材料。这种「人在回路里」的位置是金融 Agent 最常见的形态,你在 Day 94 讲的 Agent UX 里那几种审批模式,在这里基本都会用上。

国内的情况类似。从这次抓到的 JD 看,腾讯金融科技、腾讯金融的 Agent 架构师岗位,以及银行信息科技中心的 AI 应用开发岗,写的场景大多是投研辅助、客户经理助手、风控审核辅助、合规文档审查,直接给 C 端客户做投资建议的很少。

金融 Agent 的工程难点集中在三处。

**数字必须来自系统,不能来自模型**。持仓多少、收益率多少、利率多少,一律由工具查出来,模型只负责组织语言。这跟 BillSleuth(Day 125)「不许编数字」是同一条规则,做法也一样:生成的回答里每个数字都要能对上某次工具调用的返回值,对不上就拦下来。

**适当性和合规话术**。给什么人推荐什么产品,金融监管有专门的适当性管理要求;哪些话不能说(承诺收益、暗示保本),合规部门会给一份清单。这些规则写进 guardrail(Day 145),不要只放在 system prompt 里。

**审计**。每次回答引用了哪些文档、调了哪些工具、谁批准的,都要能事后调出来,留存期限按机构的合规要求定。Day 85 的全链路 trace 在金融行业不是「锦上添花」,是上线前提。

五项:知识源是审核过的研报、产品文档、合规手册;工具是持仓、交易、客户画像、风控系统,几乎全部只读;红线是不编数字、不给超出适当性的建议、不承诺收益;指标是检索命中率、顾问采纳率、节省时长,以及合规抽检通过率;出错代价是监管处罚和声誉。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1P3gs6uEbJ&autoplay=0&high_quality=1" title="Agent为什么难落地?企业级AI Agent落地的5大核心挑战与解决方案" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>唐国梁Tommy · Agent为什么难落地?企业级AI Agent落地的5大核心挑战与解决方案|腾讯、阿里、百度企业级实践深度拆解 · 19 分钟,讲企业落地卡在哪(数据权限、系统集成、效果验收),可以对照本篇的五项框架听。</figcaption>
</figure>

## 医疗:红线写在法规里

医疗是出错代价最高的行业,也是红线最明确的行业,很多事情法规直接写了不能做。

国内最直接的一条:国家卫健委和国家中医药局 2022 年印发的《互联网诊疗监管细则(试行)》规定,处方应由接诊医师本人开具,**严禁使用人工智能等自动生成处方**;医师接诊前要实名认证,人工智能软件等不得冒用、替代医师本人提供诊疗服务([中新网报道](https://www.chinanews.com.cn/cj/2022/06-27/9789307.shtml))。这条规定直接框住了医疗 Agent 的边界:它可以帮医生整理病历、提示风险、查文献,可以给患者做健康科普和导诊,但「开药」「下诊断」这两个动作必须是医生做,系统要能证明是医生做的。

C 端的典型是蚂蚁阿福(原名 AQ)。科技日报 2026-02-24 报道,蚂蚁阿福 App 总用户数超过 1 亿([科技日报](https://www.stdaily.com/web/gdxw/2026-02/24/content_476005.html));到 9 月外滩大会,蚂蚁方面公布的是 1.5 亿用户、单日健康咨询近 2000 万人次,但虎嗅的文章指出 1.5 亿的口径(累计还是活跃)没有说清([虎嗅](https://www.huxiu.com/article/4890516.html))。这类产品做的是健康咨询、报告解读、导诊挂号,刻意停在「诊断」之前。你从工程角度看它,最值得想的是:用户问「我这个指标高是不是得了 XX 病」,Agent 怎么既有用又不越线。常见做法是先解释指标含义,再按风险分级给建议(观察、复查、尽快就医),高风险词直接触发就医提醒,不展开推测。

医生侧的典型是「环境式病历」(ambient documentation):医生看诊时 Agent 在旁边听,结束后自动生成病历草稿,医生审核签字。海外的 Abridge 是代表,AI Engineer 大会上有它的工程师讲从病历记录走向临床辅助的演讲(下面的视频)。这个场景的五项很典型:知识源是对话录音和患者既往病历,工具是 HIS 和电子病历系统,红线是草稿必须医生确认才进正式病历,指标是医生修改率和节省的文书时间,出错代价是病历里写错了药名或剂量。

医疗评测和别的行业有一个根本区别:**漏报比误报贵得多**。一个用药风险提醒,误报十次医生会烦,漏报一次可能出事。所以评测时不能只看准确率,要单独看高风险类别的召回率,并且接受一定的误报率。这跟 Day 69 讲的统计不一样的地方在于,你要先和医生一起定「哪些错误是不可接受的」,再定阈值。

数据合规也比别的行业重。病历是敏感个人信息,能不能出院区、能不能调用公有云模型,每家医院规定不同。很多医院项目最后选的是私有化部署开源模型(Day 76),原因不是效果更好,是数据不能出去。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/u6q-byPWUuo" title="From Ambient Documentation to Clinical Intelligence — Chaitanya Asawa, Abridge" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · From Ambient Documentation to Clinical Intelligence(Abridge 工程师 Chaitanya Asawa)· 看他怎么讲病历草稿的评测和医生审核环节。</figcaption>
</figure>

## 电商:量大、多模态、大促是考场

电商的 Agent 分两类用户:面向买家的售前导购和售后客服,面向商家的经营助手。

买家侧,京东 2025 年 9 月发布京小智 5.0,定位是「电商智能客服行业 Agent 原生应用」,面向京东中小商家免费开放。京东披露的 5 万家店铺内测数据是:转人工率降低 28% 以上,用户满意度提升 15% 以上,售前咨询转化率提升 37% 以上;三星京东自营旗舰店的案例里导购转化率提升 27.6%、转人工率降低 43%([品玩报道,2025-09-25](https://www.pingwest.com/w/307975))。这些都是京东自己的数字。

商家侧,Shopify 的 Sidekick 常被拿来举例:它读店铺的真实数据,调用 Shopify 的功能去改设置、做报表,改动前先把变更展示给商家确认。这部分我只找到第三方博客的描述(包括它在 2025 年底换用 Claude 的说法),没找到 Shopify 官方的完整说明,所以只当作「商家助手长这样」的参考,具体功能以官方为准。

电商场景和 SupportPilot 比,有四个明显的不同。

**量和峰值**。大促零点的咨询量是平时的几十倍,Agent 服务要能扛住峰值,成本也要按峰值算。Day 38 的模型路由在这里很实用:「我的快递到哪了」这种问题用小模型加订单工具就够,复杂售后才上大模型。

**多模态**。买家发一张商品破损照片要求退款,发一张别家截图问有没有同款。Day 136 讲的视觉输入在电商客服里是刚需,不是加分项。

**导购会直接影响收入**。客服答错是体验问题,导购推错了就是少卖一单。所以电商导购的指标是转化率和客单价,评测要能做 A/B(Day 71),只做离线测试集不够。

**商家规则千差万别**。同一个平台上,每家店的退换货规则、优惠规则都不同。知识库要按店铺隔离,这其实就是 Day 82 的多租户问题。

五项:知识源是商品详情、店铺规则、平台规则;工具是订单、物流、库存、优惠券;红线是不能承诺超出店铺规则的赔付、不能乱改价;指标是转人工率、解决率、导购转化率;出错代价是赔付、差评和平台处罚。

## 四个行业放在一张图上

<figure>
<svg viewBox="0 0 640 320" role="img" aria-label="四个行业按出错代价和自动化程度的相对位置">
  <rect x="0" y="0" width="640" height="320" fill="var(--paper-raised)"/>
  <line x1="80" y1="270" x2="600" y2="270" stroke="var(--rule)" stroke-width="2"/>
  <line x1="80" y1="270" x2="80" y2="30" stroke="var(--rule)" stroke-width="2"/>
  <text x="340" y="300" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">出错代价 →(退一单钱 … 人身伤害)</text>
  <text x="30" y="150" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)" transform="rotate(-90 30 150)">Agent 能自己做完的比例 →</text>
  <circle cx="170" cy="80" r="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="170" y="78" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">电商</text>
  <text x="170" y="94" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">查单/物流</text>
  <circle cx="250" cy="120" r="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="250" y="118" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">SaaS 客服</text>
  <text x="250" y="134" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">政策/账单</text>
  <circle cx="420" cy="190" r="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="420" y="188" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">金融</text>
  <text x="420" y="204" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">内部助手</text>
  <circle cx="540" cy="230" r="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="540" y="228" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">医疗</text>
  <text x="540" y="244" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">草稿+医生签</text>
  <line x1="150" y1="50" x2="570" y2="260" stroke="var(--ink-faint)" stroke-dasharray="4 4"/>
  <text x="400" y="60" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">越往右下,审批闸门、审计、</text>
  <text x="400" y="76" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">转人工的工作量越大</text>
</svg>
<figcaption>示意图,位置是相对的、按本篇的案例判断,不是测量值。电商查单这类问题 Agent 能自己闭环,医疗几乎每个写操作都要医生确认。</figcaption>
</figure>

这张图想说的就一件事:**行业越往右下,你的工作量越偏向「模型之外」**。在电商,优化 prompt 和检索能直接提指标;在医疗,同样的时间花在审批流程、审计日志、高风险类别评测上更划算。面试时如果你能说出「这个行业里我会把 60% 的时间花在审批和评测上,原因是……」,比讲用了哪个框架有说服力得多。

## 面试时怎么把 SupportPilot 讲到目标行业

你手上的作品是虚构 SaaS 公司的客服 Agent。投金融、医疗、电商岗位时,不用重写项目,但要准备一套「迁移讲法」。我的建议是按五项框架,先说哪些原样保留,再说哪些要重做,最后说你会先验证什么。

| SupportPilot 模块 | 金融 | 医疗 | 电商 |
| --- | --- | --- | --- |
| 知识库 RAG(Day 45) | 保留架构;换成审核过的研报和产品文档,长 PDF 表格解析要加强 | 保留;换指南和说明书,否定句和剂量数字要专门评测 | 保留;按店铺多租户隔离 |
| 业务工具 MCP(Day 46) | 换持仓、交易工具,全部只读起步 | 换 HIS/病历接口,写操作只写草稿区 | 换订单、物流、库存,加图片输入 |
| 审批闸门(Day 25、46) | 扩成合规审核节点,留审计 | 所有写入正式病历的动作都要医生签 | 只在赔付、改价时触发 |
| 评测(Day 50) | 加「数字是否可溯源」检查和合规抽检 | 高风险类别单独算召回率 | 加线上 A/B 看转化率 |
| 部署(Day 53) | 私有云或专属区域 | 院内私有化,开源模型 | 按大促峰值做容量规划 |

讲的时候用一个具体问题开头效果最好。比如面金融岗:「SupportPilot 里有一条规则,退款金额必须来自账单工具的返回值,模型不能自己算。搬到理财顾问助手,我会把这条规则扩到所有数字:收益率、持仓、费率,回答里每个数字都要能对上一次工具调用,对不上就拦截。我在 BillSleuth 里实现过同样的检查。」这比泛泛地说「我了解金融合规」好得多,因为它说明你知道规则落在代码的哪一层。

如果被问到你没做过的行业知识,诚实说不懂,然后讲你会怎么学:找业务方要三十条真实问题、和合规或医生一起定不可接受错误清单、先做内部工具再碰客户。这三步在每个行业都适用,面试官听得出你做过类似的事。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ermCBcEFR&autoplay=0&high_quality=1" title="5个企业级Agent落地案例效果预览介绍" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>韦东东666 · 5个企业级Agent落地案例效果预览介绍 · 13 分钟,看几个不同行业的 Agent 做成什么样,练习用五项框架给每个案例找知识源、工具和红线。</figcaption>
</figure>

## 怎么选行业

不选也行,做通用 Agent 平台的岗位一直不少。但如果你想要一个区分点,我建议按三个问题选:

**你有没有相关经历**。在银行做过后端、在电商公司做过订单系统,这些经历在 Agent 岗位面试里是实打实的加分,因为你懂那些系统的脏数据和边界情况。没有相关经历的行业,短期很难靠自学追上有经验的人。

**你能不能接受那个行业的节奏**。医疗和金融项目周期长,合规评审一轮几周,上线门槛高,但做成了很稳。电商和 SaaS 迭代快,今天改明天上,压力在指标上。

**岗位在哪**。用今天的统计看:海外金融机会最多,医疗和法律也有一批单一行业的 AI 公司;国内电商、客服、研发效能更集中,金融主要在大厂金融科技部门和银行信息科技中心。查 JD 时用行业关键词加「Agent」「大模型应用」搜,数一数你目标城市的数量,比听别人说哪个行业火更靠谱。

选定之后,最划算的投入是给 SupportPilot 加一个「行业版」的小分支:换一套该行业的知识源和两个工具,加一条该行业的红线和对应评测。花两三天,面试时就有东西可讲。

## 动手练习

今天的练习有两部分:自己跑一遍行业统计,然后写一页「SupportPilot 迁移到 X 行业」的设计说明。

**第一步:跑行业统计。** JD 数据在站点仓库里,下载到练习仓:

```bash
cd ~/Documents/agent-60-lab
mkdir -p topics/industry-cases && cd topics/industry-cases
curl -L -o jds.json https://raw.githubusercontent.com/lm742611149/aiinfra.blog/main/docs/jd-research/jds.json
```

```python
# agent-60-lab/topics/industry-cases/jd_industry.py
import json
import re
import sys
from collections import Counter

INDUSTRIES = {
    "金融": r"金融|银行|证券|保险|基金|信贷|理财|投研|风控|fintech|\bbank|insurance|payments?\b|trading|financial",
    "医疗健康": r"医疗|医院|医药|临床|诊疗|问诊|healthcare|medical|clinical|pharma|patient",
    "电商零售": r"电商|零售|商家|e-?commerce|retail|merchant",
    "客服": r"智能客服|客服|售后|customer support|customer service|contact center",
    "法律": r"法律|律师|法务|legal|law firm",
    "研发效能": r"代码生成|编程助手|研发效能|coding agent|code generation|developer tool",
}


def main(path: str) -> None:
    data = json.load(open(path, encoding="utf-8"))
    for region in ["domestic", "overseas"]:
        total = 0
        hits: Counter[str] = Counter()
        for job in data[region]:
            text = ((job.get("title") or "") + " " + (job.get("text") or "")).lower()
            if len(text) < 100:
                continue
            total += 1
            for name, pattern in INDUSTRIES.items():
                if re.search(pattern, text):
                    hits[name] += 1
        print(f"{region}: {total} 条有正文")
        for name, n in hits.most_common():
            print(f"  {name:6} {n:4}  {n / total:.0%}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "jds.json")
```

<div class="line-notes">

- `INDUSTRIES = {` 行业名到正则的映射。中英文关键词写在一起,因为国内 JD 是中文、海外是英文,一个正则同时覆盖两边。
- `\bbank` `\b` 是单词边界,防止匹配到 `embankment` 这种词中间的 bank。注意它挡不住 `bankruptcy`,实测 `re.search(r"\bbank", "bankruptcy")` 返回命中,这是这个统计粗糙的地方之一。同一行的 `payments?\b` 里 `s?` 表示 s 可有可无,`payment` 和 `payments` 都能命中。
- `"客服": r"智能客服|` 「智能客服」其实被「客服」包含了,写在前面只是为了读的人一眼看出意图,对结果没有影响。
- `data = json.load(open(path, encoding="utf-8"))` 读整个文件。顶层是一个 dict,有 `fetched`、`note`、`domestic`、`overseas` 四个键,实测 `domestic` 695 条、`overseas` 185 条。
- `for region in ["domestic", "overseas"]:` 国内和海外分开数,因为两边的百分比口径(分母)不同。
- `hits: Counter[str] = Counter()` Counter 是一个计数用的 dict,`hits["金融"] += 1` 时键不存在会自动从 0 开始,不用先判断。
- `text = ((job.get("title") or "")` 职位名和正文拼起来再转小写。`or ""` 是因为有的记录 `text` 字段是 `None`,直接拼会报 `TypeError`。国内第一条是 Boss 截图转录,title 是「某公司「软硬件服务 AI 转型」Agent 岗(IMG_2963)」,正文 237 字。
- `if len(text) < 100:` 少于 100 个字符的当作没有正文跳过,这样 Boss 列表里那几百条只有标题的记录不参与。实测国内剩 331 条,海外 185 条全部保留。
- `if re.search(pattern, text):` 只要出现一次就算命中,一条 JD 可以同时算进好几个行业,所以百分比加起来超过 100%。
- `print(f"  {name:6} {n:4}  {n / total:.0%}")` `:6` 和 `:4` 是对齐宽度,`:.0%` 把小数格式化成不带小数位的百分比,比如 39/331 打印成 `12%`。

</div>

运行:

```bash
uv run python jd_industry.py jds.json
```

输出大致长这样(2026-10-12 那批数据):

```text
domestic: 331 条有正文
  研发效能     42  13%
  金融       39  12%
  客服       26  8%
  电商零售     23  7%
  医疗健康     17  5%
  法律        4  1%
overseas: 185 条有正文
  金融       47  25%
  医疗健康     19  10%
  研发效能     18  10%
  法律       10  5%
  客服        8  4%
  电商零售      6  3%
```

**第二步:看误判。** 改一下脚本,把命中「金融」的 JD 打印出公司名和职位名,随机看 20 条,数一数有几条是真的做金融业务的。你会发现有不少是因为公司介绍里写了「服务金融客户」被误判的。把你的误判率写下来,这个数字就是上面那张表的可信度。

**第三步:写迁移说明。** 选一个你最想去的行业,用今天的五项框架写一页设计说明,标题叫「SupportPilot 迁移到 X 行业」。必须包含:

1. 五项各写一段:知识源、工具(列出至少 3 个,标明只读还是读写)、红线(至少 2 条,每条写清楚落在代码哪一层)、验收指标(至少 3 个,写清楚怎么算)、出错代价。
2. 一张模块迁移表,格式同上文,标出保留、修改、新增。
3. 上线前要先验证的三件事,以及每件事怎么验证。
4. 至少引用一个该行业的公开案例,写出处,标明数字是谁说的。

**验收标准**:

- 脚本能跑出和上面一致的数字(用同一份 jds.json)。
- 你给出了一个具体的误判率,比如「金融 20 条里有 6 条是误判」。
- 迁移说明里每条红线都说清了实现位置(prompt、guardrail、工具层权限、审批节点中的哪一个),不能只写「注意合规」。
- 拿这一页去给一个没看过 SupportPilot 的朋友讲,5 分钟能讲完,对方能复述出你为什么这样改。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| outcome-based pricing | 按结果收费。客户只在 Agent 达成约定结果(解决一次咨询、挽回一次退订)时付钱,Intercom Fin、Sierra 都用这类模式。 |
| 解决率 / resolution rate | Agent 独立处理完、不需要人工的对话占比。各家定义不同,一定要问清「什么算解决」。 |
| 转人工率 | Agent 把对话交给人工的比例。越低不一定越好,该转不转更糟。 |
| 环境式病历 / ambient documentation | 医生看诊时系统在旁边听,自动生成病历草稿,医生审核后签字入档。 |
| HIS | Hospital Information System,医院信息系统,挂号、医嘱、收费、病历都在里面。 |
| 适当性管理 | 金融机构要把合适的产品卖给合适风险承受能力的客户,不能乱推荐。 |
| 漏报 / 召回率 | 该发现的问题没发现叫漏报。召回率是发现了的占所有该发现的比例,医疗场景通常比准确率更重要。 |
| 私有化部署 | 把模型和系统部署在客户自己的机房或专属云里,数据不出客户边界。 |
| FDE | Forward Deployed Engineer,驻场工程师,去客户那里把产品落到客户具体业务里。行业知识对这个岗位特别重要。 |

## 常见误区

**以为行业 Agent 要从头做一套新架构。** 大部分行业用的还是分类、检索、调工具、起草、自检、审批这套骨架。要换的是知识源、工具和红线,架构上的重写往往是因为没想清楚这五项。

**把厂商公布的效果数字当成事实。** Klarna 的三分之二、京小智的 28%、摩根士丹利的 98%,都是公司自己披露的,口径各不相同。面试里引用可以,但要说「据 XX 自己披露」,并且能说出这个数字可能被高估的原因。

**以为合规是法务的事,工程师不用管。** Air Canada 的判决说明,Agent 说出口的话公司要负责。红线要落到代码里:哪些工具不给、哪些输出要拦、哪些操作必须审批,这些都是工程决定。

**医疗、金融场景只看准确率。** 高风险场景里,错一次的代价差别很大。要先和业务方一起列出「不可接受的错误」,单独评测这些类别,再决定能接受多少误报。

**以为懂一个行业就要会它的全部业务。** 面试官想听的是你知道该问什么:真实问题从哪来、红线谁定、数据能不能出去、出错谁负责。把这几个问题问对,比背一堆行业术语有用。

**行业统计数字当成精确值。** 今天那张表是正则匹配出来的,公司介绍会造成误判。它适合看大方向(海外金融多、国内电商多),不适合拿来说「医疗岗位占 5.1%」。

## 学习资料

### 文档与文章

- [Klarna 新闻稿:AI 助手第一个月处理三分之二的客服对话](https://www.klarna.com/international/press/klarna-ai-assistant-handles-two-thirds-of-customer-service-chats-in-its-first-month/):2024 年 2 月的原始数字,10 分钟读完,再配合下面两篇看后来怎么样了。
- [CX Dive:Klarna 重新招人工客服(2025-05-09)](https://www.customerexperiencedive.com/news/klarna-reinvests-human-talent-customer-service-AI-chatbot/747586/):CEO 原话,讲为什么回头。5 分钟。
- [The Pragmatic Engineer:Klarna's AI chatbot: how revolutionary is it, really?](https://blog.pragmaticengineer.com/klarnas-ai-chatbot/):工程师视角拆那批数字,教你怎么读厂商案例。20 分钟。
- [Intercom Fin 定价页](https://fin.ai/pricing) 和 [Fin 解决次数说明](https://www.intercom.com/help/en/articles/8205718-fin-ai-agent-resolutions):看按结果收费到底怎么定义「解决」。15 分钟。
- [Sierra:Outcome-based pricing for AI agents](https://sierra.ai/blog/outcome-based-pricing-for-ai-agents):按结果收费的另一种讲法。10 分钟。
- [CNBC:Morgan Stanley 测试 OpenAI 驱动的顾问助手(2023-03-14)](https://www.cnbc.com/2023/03/14/morgan-stanley-testing-openai-powered-chatbot-for-its-financial-advisors.html) 和 [InvestmentNews 后续报道](https://www.investmentnews.com/fintech/morgan-stanleys-open-ai-powered-solution-for-advisors-has-expanded/254880):金融内部助手的典型做法。共 15 分钟。
- [Air Canada 案判决 2024 BCCRT 149](https://www.canlii.org/en/bc/bccrt/doc/2024/2024bccrt149/2024bccrt149.html)(CanLII,需浏览器打开):判决书不长,重点看仲裁员怎么驳回「聊天机器人是独立实体」那一段。也可以读 [Kiplinger 的报道](https://kiplinger.com/personal-finance/travel/air-canada-to-pay-a-partial-refund-for-chatbot-error)。
- [中新网:《互联网诊疗监管细则(试行)》发布](https://www.chinanews.com.cn/cj/2022/06-27/9789307.shtml):「严禁使用人工智能等自动生成处方」的出处。5 分钟。
- [科技日报:蚂蚁阿福 App 用户数破亿(2026-02-24)](https://www.stdaily.com/web/gdxw/2026-02/24/content_476005.html) 和 [虎嗅对 1.5 亿口径的分析](https://www.huxiu.com/article/4890516.html):C 端健康 Agent 的规模和数字口径问题。15 分钟。
- [品玩:京东发布京小智 5.0(2025-09-25)](https://www.pingwest.com/w/307975):电商客服 Agent 的功能拆分和京东自己公布的效果数字。10 分钟。
- [Anthropic:Building effective agents](https://www.anthropic.com/research/building-effective-agents):附录 1 专门讲客服和编程为什么是 Agent 最先落地的两个场景,重读一遍附录。10 分钟。
- [OpenAI:A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf):第一章「什么时候该做 Agent」给了选场景的判断标准,和本篇的五项框架互补。20 分钟。

### B 站视频

- [唐国梁Tommy · Agent为什么难落地?企业级AI Agent落地的5大核心挑战与解决方案](https://www.bilibili.com/video/BV1P3gs6uEbJ):19 分钟,已嵌在金融一节,讲企业落地常见的卡点。
- [韦东东666 · 5个企业级Agent落地案例效果预览介绍](https://www.bilibili.com/video/BV1ermCBcEFR):13 分钟,看几个行业 Agent 的实际界面。
- [卫诗婕_漫谈播客集 · 当AI进入组织,那些「从没人说过的真相」|与网易阮良聊 AI Native 与企业 Agent 实战](https://www.bilibili.com/video/BV19Hnq6LE79):75 分钟播客,通勤时听,讲 Agent 进企业后组织层面的阻力。

### 其他经典视频

- [AI Engineer · From Ambient Documentation to Clinical Intelligence(Abridge)](https://www.youtube.com/watch?v=u6q-byPWUuo):已嵌在医疗一节。
- [Stripe · Bret Taylor of Sierra on AI agents, outcome-based pricing, and the OpenAI board](https://www.youtube.com/watch?v=n4E4xNYCkYM):Sierra CEO 讲为什么按结果收费、客服 Agent 怎么卖给大企业,看前半段关于定价的部分。
- [Digital Health Inside Out · Shiv Rao on Building Abridge and Scaling AI Across 250+ Health Systems](https://www.youtube.com/watch?v=QDXqUejasH8):Abridge 创始人讲怎么把医疗 AI 卖进医院系统,适合想做医疗方向的人。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):读第 1 章「Introduction to Building AI Applications with Foundation Models」里讲用例评估和「该不该做」的部分,和本篇的选场景思路一致。

### 开源项目与代码

- [sierra-research/tau2-bench](https://github.com/sierra-research/tau2-bench):Sierra 做的客服类 Agent 基准,有航空、零售、电信几个行业域。看它每个域怎么定义工具和政策,对你写迁移说明里的「红线」很有参考价值。
- [本站 JD 数据](https://github.com/lm742611149/aiinfra.blog/blob/main/docs/jd-research/jds.json):今天练习用的数据,`summary.md` 里有完整的抓取口径。

## 自测

1. 用五项框架拆一下「保险公司理赔初审 Agent」:知识源、工具、红线、指标、出错代价分别是什么?

<details><summary>答案</summary>

知识源:保险条款、理赔规则、历史判例。工具:保单查询、理赔材料 OCR、医院或维修单据核验,起步全部只读。红线:不能自己决定拒赔或赔付金额,只给出「建议+依据」,最终由理赔员决定;金额必须来自规则引擎计算,不能由模型算。指标:初审建议与理赔员最终结论的一致率、高风险(疑似欺诈)类别的召回率、每单节省时长。出错代价:错赔是直接损失,错拒是客诉和监管投诉。

</details>

2. Intercom Fin 把「解决」定义为「最后一次回答后客户没有再要求帮助」。这个定义有什么问题?如果你来设计,怎么改进?

<details><summary>答案</summary>

问题是客户被气走、放弃了也会算成解决,定义会高估效果。改进:加入正向信号(客户点了「已解决」或给了好评),加入负向信号排除(同一客户 24 小时内又发起同类问题、转去电话渠道、提了投诉),对没有明确信号的对话抽样人工复核,算一个校正系数。

</details>

3. 为什么金融行业的 Agent 大多先给内部员工用,而不是直接面向客户?

<details><summary>答案</summary>

持牌员工在中间,最终对客户说什么由人负责,模型出错有人兜底;知识源可以限定在审核过的内部文档;合规风险小,上线审批快;员工用起来的反馈能帮你积累评测数据。等内部效果和审计流程都跑稳了,再考虑面向客户的场景。

</details>

4. 医疗场景的评测和 SupportPilot 的评测最大的不同是什么?

<details><summary>答案</summary>

医疗要先和医生一起定出「不可接受的错误」清单,比如漏掉用药禁忌、剂量写错,对这些高风险类别单独算召回率,并接受一定误报率。SupportPilot 里各类错误代价相近,看整体准确率和解决率就够了。医疗里平均准确率很高也可能出事,只要漏掉一次高风险的情况。

</details>

5. **面试题**:你做的是 SaaS 客服 Agent,我们是一家跨境电商,你觉得你的项目哪些能直接用,哪些要改?

<details><summary>答案</summary>

答题思路:先说保留的骨架(分类、检索、工具、起草、自检、审批、转人工)和保留的评测方法;再按五项说要改的:知识库按店铺多租户隔离、多语言;工具换成订单、物流、库存,加商品图片和破损照片的视觉输入;红线是赔付和改价走审批、不承诺超出店铺规则的赔付;指标加导购转化率并做线上 A/B;容量按大促峰值规划,用模型路由把查单类问题交给小模型。最后说上线前先验证的三件事,比如拿三十条真实售后对话跑一遍看转人工点对不对。要具体到模块和天数,别只说「需要适配」。

</details>

6. **面试题**:Klarna 先宣布 AI 客服顶替 700 人,一年后又重新招人工。从工程角度,你从这件事学到什么?

<details><summary>答案</summary>

一是被 AI 接住的三分之二对话通常是简单的,剩下的复杂对话才最影响满意度,转人工的时机和交接质量要单独设计、单独评测。二是指标选错会误导方向:只看处理量和成本,会把质量问题藏起来,要同时看重复咨询、投诉、满意度。三是厂商公布的数字要看口径,「相当于 700 人的工作量」是工作量换算,不是裁员人数,也不等于质量相同。

</details>

## 明天预告

没有 Day 154 了。专题篇到这里结束,23 篇专题不用按顺序读,回头按每篇开头写的「建议在 Day X 之后读」挑你需要的。

接下来我的建议是:用今天的框架选一个主攻行业,给 SupportPilot 做一个行业版分支(换知识源、两个工具、一条红线和对应评测),然后照 Day 59 和 Day 130 的投递节奏去投。每次面试被问到行业问题答不上来,就记下来,补进你那份迁移说明里。这个领域变得很快,行业案例也一样,半年后重新跑一遍今天的统计脚本,看看哪些行业的岗位变多了。
