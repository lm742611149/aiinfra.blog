---
title: 'Day 59 · 求职渠道与薪资:国内、新加坡、海外远程,怎么找、怎么谈'
description: '用 2026 年 10 月抓取的 880 条 AI Agent 岗 JD 说话:每个招聘平台能看到什么、看不到什么,国内、新加坡、香港、美国、海外远程各自的薪资样本和口径,Forward Deployed Engineer 这类岗位是什么,远程岗真实的地域限制,以及谈薪、比较 offer、识别假 AI 岗和培训贷。'
pubDate: 2026-10-12
regime: none
tags: ['job-search', 'salary', 'fde', 'remote', 'negotiation', 'career', 'agent-60']
series: 'agent-60'
day: 59
lang: 'zh'
---

## 今天要解决的问题

简历和面试都准备好了,还剩两个现实问题:去哪儿找岗位,能拿多少钱。这两个问题网上的答案特别多,也特别乱,有「Agent 工程师年薪百万」的营销号,也有「AI 岗都是骗人的」的吐槽帖。今天尽量只用能核对的数据说话。

今天结束时你应该:

1. 知道国内外主要招聘渠道各自能看到什么样的岗位、薪资透明度如何,选定自己的主渠道。
2. 对国内、新加坡、香港、美国、海外远程的薪资有一个带口径的认识,知道哪些数字是有样本支撑的、哪些没有。
3. 弄清 Forward Deployed Engineer(FDE)这类面向客户的 Agent 岗位,判断自己适不适合。
4. 对「海外远程」有现实的预期。
5. 掌握谈薪的基本方法,能用一张表比较两个 offer。
6. 能识别假 AI 岗、外包派遣和培训贷。

预计用时 3–4 小时,之后是持续数周的投递。前置是 Day 56 的简历。

## 数据从哪来

站长在 2026 年 10 月 12 日抓了一批 Agent 岗位 JD,一共 880 条:国内 695 条,海外 185 条(新加坡 52、香港 23、海外远程 46、美国本土 40、欧洲日韩澳印等 24)。国内分两批:第一批 120 条主要来自腾讯、字节、美团、百度、网易、京东的招聘官网和智联招聘;第二批 575 条是用站长自己的账号登录后抓的 Boss 直聘 435 条和猎聘 140 条。下面的比例和薪资都出自这批数据,它的局限要先说清楚:

- **国内薪资只来自 Boss 和猎聘的 557 条**。大厂官网不公布薪资;第一批里智联那 24 条以中小公司为主,不再单独引用。
- **薪资是招聘方挂出来的区间,不是实际成交价**。我们取月薪区间的中点乘以薪数(没写薪数按 12 薪)折成年包,区间上沿通常要很强的候选人才拿得到。
- Boss 和猎聘每个「关键词 × 城市」只抓了第一页,排序受平台推荐算法和账号画像影响;Boss 435 条里只有 74 条抓到了正文,抓到第 78 条详情时平台提示「账户存在异常行为」,就停了。
- 拉勾、前程无忧被人机验证拦住,没有数据。
- 海外 LinkedIn 只拿到了每个搜索的前几十条,Hacker News 招聘帖偏创业公司。
- 技能比例是关键词匹配,不是人工标注。

所以这不是一份行业薪资报告,是一个「能核对的样本」。看数字的时候请带着这些局限看。

## 渠道:每个平台能看到什么

| 平台 | 地区 | 样本数 | 能看到什么 | 适合用来 |
| --- | --- | --- | --- | --- |
| Boss 直聘 | 国内 | 435 + 截图 7 | 要登录才能看,列表全部带薪资,和招聘方直接聊 | 主力投递渠道,中小公司和大厂业务团队都在 |
| 猎聘 | 国内 | 140 | 要登录,带薪资和完整 JD,猎头多 | 中高端岗位、被猎头找 |
| 智联招聘 | 国内 | 27 | 公开搜索,有薪资,中小公司为主 | 补充渠道 |
| 大厂招聘官网 | 国内 | 74 | 公开,JD 写得最细,**无薪资** | 研究大厂要求、直接投递 |
| 脉脉 | 国内 | 未抓 | 要登录,有内推和职言区 | 找内推、打听团队情况 |
| 拉勾、前程无忧 | 国内 | 0 | 被人机验证拦住 | 这次没有数据 |
| V2EX 招聘节点 | 国内 | 3 | 公开,技术圈创业公司 | 小团队、偶尔有远程 |
| LinkedIn | 新加坡/香港/远程 | 64 | 公开职位页,香港岗**都没写薪资** | 外企、新港岗位 |
| MyCareersFuture | 新加坡 | 29 | 新加坡政府职位库,**全部写月薪** | 新加坡薪资行情 |
| 公司官网(Ashby/Greenhouse/Lever) | 海外 | 50 | OpenAI、Anthropic、Sierra、Decagon 等,美国岗大多写薪资区间 | 头部 AI 公司 |
| Hacker News Who is hiring | 海外 | 39 | 每月一帖,创业公司 | 海外创业公司、部分远程 |
| Remote OK、We Work Remotely | 远程 | 3 | 公开 | 远程岗,相关岗位很少 |

顺带一个提醒:Boss 和猎聘都要登录才能看全,Boss 对短时间内大量打开职位详情很敏感,站长抓数据时连续看了七十多个详情页就收到了账号异常提示。你自己找工作时正常浏览不会有问题,但不要用脚本批量刷,也别用来源不明的「自动投递」插件,账号被限制会直接影响求职。

我的建议是:国内以 Boss 直聘为主,大厂官网直投加脉脉找内推为辅;想去新加坡看 LinkedIn 和 MyCareersFuture;想去头部海外 AI 公司直接看它们的官网职位页。

关于 Boss 直聘有一个实际的技巧:在 Boss 上是招聘方先看到你的在线简历再决定要不要回复你,所以在线简历里的「个人优势」和「项目经历」要放 Day 56 那些关键词;打招呼的第一句话不要用默认模板,写一句和这个岗位 JD 相关的话,比如「看到贵司在做客服场景的 Agent,我做过一个带评测和人工审批的客服工单 Agent,演示链接……」。

## 薪资:有样本的和没样本的

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="各地区 Agent 岗位薪资样本中位区间">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">样本薪资中位区间(各自原币种,不做汇率换算)</text>
  <text x="20" y="66" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">国内·Boss+猎聘 557</text>
  <rect x="230" y="52" width="150" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="390" y="67" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">年包中位 48 万元</text>
  <text x="20" y="106" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">新加坡·MCF 29 条</text>
  <rect x="230" y="92" width="150" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="390" y="107" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">月薪 SGD 7.5k–10k</text>
  <text x="20" y="146" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">香港·LinkedIn 23 条</text>
  <rect x="230" y="132" width="150" height="20" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
  <text x="390" y="147" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">无一条写薪资</text>
  <text x="20" y="186" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">海外远程·8 条</text>
  <rect x="230" y="172" width="150" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="390" y="187" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">年薪 $180K–$250K</text>
  <text x="20" y="226" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">美国本土·26 条</text>
  <rect x="230" y="212" width="150" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="390" y="227" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">年薪 $198K–$335K</text>
  <text x="20" y="266" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">条形长度只表示「有样本」,不表示高低比较;不同来源、不同币种、不同口径</text>
  <text x="20" y="284" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">国内是挂牌区间中点×薪数,不是成交价;海外远程能拿这个区间的多数限美加身份</text>
</svg>
<figcaption>2026 年 10 月 12 日抓取样本的薪资中位区间。故意没有画成可比较的柱状图:币种、税制、样本来源都不一样,直接比高低会误导。</figcaption>
</figure>

逐个说口径。

**国内。** Boss 和猎聘一共 557 条带薪资的岗位,按「月薪区间中点 × 薪数」折算,年包中位数 **48 万元**,P25 是 36 万,P75 是 68 万;月薪区间中点的中位数是 3.5 万。45% 的岗位年包中点在 50 万以上,15% 在 80 万以上,也有 18% 低于 30 万。薪数最常见的是 12 薪(46%),其次是 15 薪、16 薪和 14 薪。分平台看,Boss 中位 49 万,猎聘中位 42 万。

拆开看更有用:

| 维度 | 分组 | 年包中位(P25–P75) |
| --- | --- | --- |
| 年限 | 1–3 年(90 条) | 40 万(26–54) |
| 年限 | 3–5 年(197 条) | 48 万(35–66) |
| 年限 | 5–10 年(107 条) | 54 万(36–68) |
| 城市 | 上海 | 54 万(37–75) |
| 城市 | 深圳 | 48 万(36–66) |
| 城市 | 北京 | 47 万(36–62) |
| 城市 | 杭州 | 42 万(27–66) |
| 公司规模(Boss) | 10000 人以上(112 条) | 57 万(37–80) |
| 公司规模(Boss) | 100–499 人(93 条) | 48 万(33–68) |
| 公司规模(Boss) | 0–20 人(34 条) | 36 万(23–62) |

几个读法。第一,这是挂牌价,不是成交价:招聘方挂「30–50K」,大多数人谈下来落在区间中下段,能拿到上沿的是很强的候选人。所以把中位数当作「挂牌的中间值」,而不是「你会拿到的数」。第二,年限之间的差距没有想象中大,1–3 年和 5–10 年的中位只差 14 万,但 P75 的差距更能说明问题,也就是同一年限里个人差异很大,作品和面试表现能拉开不少。第三,公司规模影响明显,万人以上的公司中位 57 万,20 人以下的 36 万,差了二十多万。第四,这些都是 Agent 岗位的挂牌价,对一个刚转方向、AI 经验来自两个月个人项目的人,现实的预期是先拿到「你原来年限对应的那一档」,而不是直接对标 P75。

还有一个常被引用的数字可以放在一起对照:脉脉今年 3 月发布的人才报告(媒体报道)说,2026 年 1–2 月平台上 AI 岗位新发岗位的平均月薪约 60,738 元。它比我们样本的月薪中点中位数(3.5 万)高出不少,因为它包括了算法研究员、大模型算法这类薪资很高的岗位,用的是平均值,样本也只是脉脉上的中高端岗位。两个数放在一起,恰好说明口径有多重要:你去谈薪时,要拿和自己岗位、城市、公司规模、年限匹配的那一格数据。

**新加坡。** 政府职位库 MyCareersFuture 上 29 条,每一条都写了月薪,中位区间 SGD 7,500 到 10,000 一个月,折合年薪约 9 万到 12 万新币;范围从 3,000 到 21,667。需要注意的是这上面的雇主很多是中介和 IT 外包公司,头部公司的薪资高得多:比如 Shopee 两个 Agent 相关的 AI 工程师岗位写的是月薪 SGD 10,000–16,000 和 10,000–17,000;Sierra 在新加坡招的「Software Engineer, Agent (Cantonese Speaking)」,它官网职位页写的年薪是 SGD 295K–495K 加股权(这是样本外、需要粤语的高位个例,不在 880 条样本里,是同一天单独从 Sierra 的公开职位接口核对的;会粤语的读者可以留意,但别把它当成新加坡的普遍水平)。新加坡还要考虑工作签证的门槛,外籍员工需要满足 Employment Pass 的最低薪资和评分要求,具体以新加坡人力部当年的规定为准。

**香港。** LinkedIn 上 23 条,**没有一条写薪资**,这次没有数据。岗位集中在金融和加密货币公司(OKX、Binance、Amber、RedotPay、Bullish、CoinDesk)以及咨询公司,其中 Bullish 和 CoinDesk 招的都是 AI Forward Deployed Engineer,要求 5 年以上经验。

**美国本土。** 26 条写了薪资,中位区间年薪 $198K 到 $335K,范围 $150K 到 $445K,另有股权。比如 OpenAI 的 Forward Deployed Software Engineer 写的是 $185K–$325K,Decagon 的 Agent Deployment Engineer 是 $175K–$230K。这些岗位基本都要求美国工作身份,对大多数读者的意义是「知道天花板在哪」,而不是现实目标。

## 海外远程:先把预期调对

很多人学 Agent 是冲着「给海外公司远程工作、拿美元工资」去的。这次的数据很直接地回答了这个问题:海外远程样本 46 条里,限美国、加拿大或美洲的 18 条,限欧洲或英国时区的 6 条,限印度、巴西、沙特、韩国等特定国家的 8 条,没写清楚的 11 条,**明确写着「全球任意地点」的只有 3 条**。而写了薪资的 8 条远程岗,中位区间 $180K–$250K,基本都在限美加的那一类里。

换句话说,面向中国境内求职者的海外远程 Agent 岗非常少。这背后是雇佣合规的问题:跨国雇人涉及劳动法、税务、数据出境,大多数公司不愿意处理。能走的路有这几条:

- 通过 Deel、Remote 这类名义雇主(EOR)平台被雇佣,前提是公司愿意,薪资一般会按你所在地重新定价,远低于美国本土的数字。
- 以独立承包人(contractor)身份接项目,自己处理税务和收款合规。
- 先在国内外企或出海公司做,积累英文工作环境和跨时区协作的经验,再找机会内部转远程。
- 去新加坡或香港这类签证路径相对清晰的地方。

我不劝你放弃远程,但请不要把它当作两个月后的主要目标。把它当成长期选项,同时认真投国内和新加坡的岗位。遇到「远程、全球、高薪、门槛低」同时出现的岗位,先往骗局的方向怀疑。

## Forward Deployed Engineer:一种越来越多的 Agent 岗

FDE 这个名字来自 Palantir,意思是「部署到前线的工程师」:不是坐在公司里做产品,而是嵌进客户团队,把公司的平台在客户的真实业务里落地。AI 公司把这个角色发扬光大了,因为企业客户买了模型或 Agent 平台之后,最大的难题是怎么用到自己的业务里。

在这批样本里,美国本土岗位有 52% 提到面向客户或交付,新加坡和香港也是 52%,远高于国内的 33%。岗位名字五花八门:Forward Deployed Engineer、Applied AI Engineer、Applied AI Architect、Agent Deployment Engineer。OpenAI、Anthropic、Replit、Ramp、Notion、Intercom、Stripe、Palantir 都在招。国内也开始出现了,智联上有两条:一家军工数字化公司的「AI 智能体(FDE)工程师」(月薪 1.5–2.5 万,1–3 年经验,其中至少 1 年 AI 相关),一家智能制造公司的「FDE 专家」(月薪 1.8–3.5 万,5–10 年经验,要求懂制造业 MOM/MES 系统);百度也有数字人方向的 FDE 岗。

FDE 和普通 Agent 工程师的区别,从国内那条 JD 的原话里能看得很清楚:「能把 AI 能力写进现场」「既能写代码也能跑现场」「以能不能让业务团队马上试用为工作节奏」「用真实数据验证效果,不追概念」。日常工作是这样一个循环:和客户一起梳理业务流程,找到值得用 Agent 的环节,快速做出原型,定验收指标,在客户的真实数据上评测,上线,再根据反馈迭代。

适合你的信号:你喜欢和人打交道,能把技术方案讲给不懂技术的人听;你对某个行业有了解(金融、制造、医疗、零售);你能接受出差或在客户现场工作;你喜欢「做出来能用」胜过「做得优雅」。如果你原来做过 B2B 软件的实施、售前、技术支持,FDE 是一个非常自然的转型方向。

FDE 的面试通常多一轮:给你一个模拟客户场景,让你现场问需求、提方案、估工作量,有时还要你向「客户」演示。Day 58 系统设计里的需求澄清、分阶段上线、ROI 估算,在 FDE 面试里会被问得更细。SupportPilot 的 README 里如果有一段「如果真实客户要上线,我会怎么分三个阶段推进」,投 FDE 岗时会是加分项。

## 面试流程长什么样

国内社招 Agent 岗常见的流程:HR 或招聘方初筛,技术一面(基础题和项目追问,通常 1 小时),技术二面(系统设计或深挖项目,有时加编码),三面(部门负责人,看综合能力和团队匹配),HR 面(动机、稳定性、薪资)。大厂可能还有交叉面。整个流程两到四周。

海外和外企常见的流程:recruiter 电话,技术电话面或带回家的作业(take-home,比如「三天内做一个小 Agent 并写说明」),然后是一轮包含多场面试的 onsite(线上),通常有系统设计、项目深挖、编码、行为面试(behavioral,用 STAR 结构讲过去的经历);FDE 岗多一场客户场景模拟。英文面试如果是你的短板,提前准备好项目介绍和几个常见行为问题的英文回答,并且出声练。

## 谈薪

拿到口头 offer 之后才是谈薪。几个原则:

**先准备,后开口。** 知道三个数:你的底线(低于它就不去)、你的目标、你的依据(同城同类岗位的数据、你当前的薪资、手上其他 offer)。用今天的数据时要用口径匹配的那一格,比如你有 3 年经验、投杭州一家几百人公司的 Agent 岗,就看「3–5 年」「杭州」「100–499 人」这几格,别拿全国中位数或脉脉的平均数去谈,也别忘了这些都是挂牌价。

**拆开看薪资结构。** 国内要问清楚:月薪基数、几个月(13 薪、15 薪、16 薪差别很大)、年终奖是固定还是浮动、绩效系数、股票或期权(数量、归属节奏、是否有回购)、社保公积金的缴纳基数和比例、签字费、试用期薪资是否打折。只比较月薪是最常见的错误。

**让对方先报数,或者报一个有依据的区间。** HR 问期望薪资时,可以先问对方这个岗位的预算范围;如果必须先说,报一个区间,区间的下沿就是你的目标而不是底线,并给出依据。

**用事实谈,不用情绪谈。** 「我手上有另一个 offer 是 X,我更想来你们这里,因为……,能不能在 Y 上调整一下」比「我觉得太低了」有效得多。不要编造不存在的 offer,行业圈子比你想象的小。

**谈非现金部分。** 如果月薪谈不动,试试签字费、更高的职级、提前转正、更多的远程天数、培训预算。

**一切以书面为准。** 拿到书面 offer、确认背景调查通过之前,不要从现在的公司离职。

比较 offer 时用一张表,把所有能量化的都量化:

| 项目 | Offer A | Offer B |
| --- | --- | --- |
| 月薪 × 月数 | | |
| 年终奖(按往年实际发放估) | | |
| 股票 / 期权(按保守估值折年) | | |
| 公积金(公司缴纳部分) | | |
| 通勤时间 / 远程天数 | | |
| 团队做的 Agent 是核心业务还是边缘项目 | | |
| 有没有评测、上线这类真实工程实践 | | |
| 直属上级的技术判断(面试时的感受) | | |

最后三行没法量化,但对一个刚转方向的人来说可能比钱更重要。在一个真正把 Agent 做到生产、重视评测的团队待一年,你的下一份工作会好找得多。

## 避坑

**名字叫 Agent,实际不是开发岗。** 有的岗位叫「AI Agent 训练师」「Agent 运营」,实际是数据标注、对话审核或者销售。看职责描述里有没有写代码、做系统。

**外包和派遣。** 调研样本里(尤其是智联)有不少岗位的发布方是人力资源公司,有的会写「正编某 AI 手机公司」,有的不写。投之前问清楚:劳动合同和谁签,社保谁交,工作地点在哪,项目结束后怎么办。外包不一定不能去,但要知道自己去的是什么。

**培训贷。** 「先培训后上岗」「包就业」「培训期间免费、上岗后从工资扣」「入职前需要先学一门课程」,这些都是红色信号。正规公司不会要求你为了入职先付钱或签贷款合同。

**花钱买「AI 证书」。** 培训机构卖的「智能体工程师」「大模型应用开发师」证书,常打着「人社部」「某某协会」的旗号,收费几千到上万,有的和培训贷捆在一起。调研的 881 条 JD 里没有一条点名要这类证书,写了「证书优先」的十来条全是阿里云、AWS、Azure 这类云厂商的官方认证。真想考,LangChain 的 LCAE(99 美元)或者阿里云大模型 ACP 这种厂商官方认证至少考的内容和工作相关,费用和形式见 Day 56「证书:要不要考,考了写在哪」;但它们也只是加分小项,替代不了作品。

**远程岗骗局。** 要求先交押金、设备费、保证金;用加密货币付款或要求你提供银行账户用于「代收」;面试只有文字聊天、没有任何技术考察就发 offer;公司在网上查不到任何信息。遇到其中任何一条就停下。

**面试做免费工作。** 带回家的作业正常是几个小时到一两天的量,题目和公司业务有距离。如果要求你「做一个完整的我们的业务系统」并且要部署,要警惕。

## 投递节奏

转方向找工作是一个数量游戏加一个迭代过程。建议:

- 第一周投 20 到 30 个岗位,包括一些你不那么想去的,用来练面试。
- 记录漏斗:投递数、回复数、一面数、二面数、offer 数。回复率很低说明简历或渠道有问题,回到 Day 56;一面挂得多说明基础题要补,回到 Day 57;二面挂得多说明系统设计或项目深度不够,回到 Day 58。
- 每场面试后 30 分钟内写复盘:问了什么,哪里没答好,下次怎么答。把新题补进你的题库。
- 每周至少一次找内推,脉脉、前同事、技术社群都可以。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="求职漏斗与回退路径">
  <rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)"/>
  <rect x="20" y="40" width="300" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="30" y="60" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">投递</text>
  <rect x="45" y="78" width="250" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="55" y="98" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">回复 / 约面</text>
  <rect x="70" y="116" width="200" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="80" y="136" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">通过一面</text>
  <rect x="95" y="154" width="150" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="105" y="174" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">二面以后 / offer</text>
  <text x="350" y="98" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">卡在这 → Day 56 简历、换渠道</text>
  <text x="350" y="136" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">卡在这 → Day 57 基础题</text>
  <text x="350" y="174" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">卡在这 → Day 58 设计、项目深度</text>
  <text x="20" y="208" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">每周看一次漏斗,哪一层掉得最多就回去补哪一天</text>
</svg>
<figcaption>求职漏斗。不要凭感觉判断「是不是我不行」,看漏斗哪一层掉得最多,对症补。</figcaption>
</figure>

## 动手练习

**步骤**

1. 在 Boss 直聘完善在线简历(用 Day 56 的关键词),设置求职意向,写一句不用默认模板的打招呼语。
2. 按你的目标地区选两个主渠道,各收藏 15 个岗位,按「很想去 / 可以去 / 练手」分三档。
3. 在 Boss、猎聘、MyCareersFuture 或公司官网上找写了薪资的岗位,记下 10 条和你的年限、城市、公司规模都匹配的薪资区间,算出你自己的参考中位数,和今天的分组表对照,写下底线和目标。
4. 判断你是否适合 FDE 方向:写下三条支持和三条反对的理由。如果适合,找 3 个 FDE 岗读 JD,把 Day 58 的分阶段上线方案改写成一段「如果给真实客户落地」的说明,加进 README。
5. 建一张求职漏斗表(投递日期、公司、岗位、渠道、状态、复盘链接)。
6. 第一周投出 20 份以上。
7. 准备一份 offer 比较表模板,等用得上的时候填。

**验收标准**

- 有一个基于至少 10 条口径匹配的薪资样本算出来的参考区间,而不是网上看来的数字。
- 收藏的岗位里没有「假 AI 岗」或培训贷类岗位(逐个用避坑清单过一遍)。
- 漏斗表已经在用,第一周的投递都有记录。
- 能用一分钟讲清楚自己为什么选择或不选择 FDE 方向。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| FDE | Forward Deployed Engineer,嵌入客户团队、把产品落地到客户业务里的工程师 |
| Applied AI Engineer | 海外常见岗位名,偏把模型能力应用到具体产品或客户场景 |
| EOR | Employer of Record,名义雇主,替海外公司在你所在国家合法雇佣你的平台 |
| contractor | 独立承包人,按合同提供服务,不是公司员工,自行处理税务 |
| Employment Pass | 新加坡给外籍专业人士的工作签证,有最低薪资和评分要求 |
| take-home | 带回家完成的面试作业 |
| behavioral 面试 | 通过询问过去经历评估协作、沟通、处理冲突等能力的面试 |
| 薪资结构 | 月薪、月数、年终奖、股票、公积金、补贴等组成部分 |
| 求职漏斗 | 投递到 offer 各阶段的数量和转化率 |

## 常见误区

**拿网上的「平均薪资」当目标。** 先问口径:哪个平台、哪类岗位、平均还是中位、包不包括年终和股票。今天的两个国内数字(Boss 和猎聘 Agent 岗挂牌月薪中点的中位数约 3.5 万、脉脉 AI 岗新发岗位平均月薪约 6 万)差了将近一倍,原因就是口径不同;而同一个 48 万的中位数,拆到万人公司和 20 人小公司又差了二十多万。

**只比较月薪。** 月数、年终、股票、公积金基数加起来可能让两个月薪相同的 offer 年收入差几十万。

**把海外远程当主要目标。** 数据显示全球任意地点可投的远程 Agent 岗极少,作为长期选项可以,作为两个月后的主线风险太大。

**只投最想去的几家。** 没有练手的面试,第一场就是最想去的公司,大概率会浪费机会。

**面试挂了就怀疑自己不适合。** 看漏斗数据定位问题,对症补。转方向的人前十场面试挂掉一半以上是常态。

**谈薪时编造 offer。** 行业小,HR 之间会核实,一旦被发现会直接失去信任。

## 学习资料

### 文档与文章

- [每日经济新闻 · 脉脉 2026 年 1–2 月人才报告相关报道](https://www.nbd.com.cn/articles/2026-03-09/4285378.html):AI 岗位平均月薪 60,738 元的出处,读的时候注意它是平台新发岗位的平均值,包含算法岗。
- [智联招聘 · AI 智能体(FDE)工程师](https://www.zhaopin.com/jobdetail/CCL1276161630J40883543101.htm) 与 [FDE 专家(AI 应用与工程化方向)](https://www.zhaopin.com/jobdetail/CC466107580J40878467211.htm):国内 FDE 岗的两种形态,一个偏技术落地,一个偏行业专家。
- [OpenAI · Forward Deployed Software Engineer](https://jobs.ashbyhq.com/openai/00207abc-49b7-465c-a219-f7c1140f8047)、[Decagon · Agent Deployment Engineer](https://jobs.ashbyhq.com/decagon/8c40fb7a-5f25-4112-a1df-f1c22b81042c)、[Anthropic · Forward Deployed Engineer(伦敦)](https://job-boards.greenhouse.io/anthropic/jobs/5423029008):海外头部公司的 FDE JD,看职责和面试流程描述。
- [Sierra · Software Engineer, Agent (Cantonese Speaking),新加坡](https://jobs.ashbyhq.com/sierra/b37a6f9e-53c7-4c47-beb5-1ab4451f3001) 和 [应届生岗](https://jobs.ashbyhq.com/sierra/79953d72-60d4-43e0-8c8c-6eccda422dce):新加坡头部 Agent 公司的岗位要求和薪资区间。
- [Shopee · AI Engineer – Agent Reasoning & Multimodal Dialogue](https://www.mycareersfuture.gov.sg/job/8e3e92444ea6fcea90ccf50e0716bf44):新加坡政府职位库上的一条大厂 Agent 岗,有月薪区间。
- 渠道入口:[Boss 直聘](https://www.zhipin.com/)、[猎聘](https://www.liepin.com/)、[脉脉](https://maimai.cn/)、[V2EX 招聘节点](https://www.v2ex.com/go/jobs)、[LinkedIn Jobs](https://www.linkedin.com/jobs/)、[MyCareersFuture](https://www.mycareersfuture.gov.sg/)、[Hacker News Who is hiring 历史帖](https://news.ycombinator.com/submitted?id=whoishiring)、[Remote OK](https://remoteok.com/)、[电鸭](https://eleduck.com/)。
- [Levels.fyi](https://www.levels.fyi/):海外公司按职级的薪资数据,了解头部公司的职级和薪资结构。
- [Deel](https://www.deel.com/)、[Remote](https://remote.com/):两个常见的名义雇主平台,了解跨国远程雇佣是怎么运作的。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1N14y1r7tJ&autoplay=0&high_quality=1" title="HR常见压价话术+谈薪公式!12年HR总监的谈薪宝典" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>HR大婷讲求职 · HR常见压价话术+谈薪公式!12年HR总监的谈薪宝典 · 12 分钟,从 HR 的角度看谈薪,重点听常见压价话术和怎么回应。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Pm4y1K7V7&autoplay=0&high_quality=1" title="(全英沉浸式) 让每个程序员都能英语面试!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>长沙二人卷 · (全英沉浸式) 让每个程序员都能英语面试! · 4 分钟,准备投新加坡、香港或外企时,先感受一下英文技术面试的节奏。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/qZgErBZk0GY" title="Forward Deployed Engineer | Role & Interview Overview" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Aced (formerly Exponent) · Forward Deployed Engineer | Role &amp; Interview Overview · FDE 是做什么的、面试分几轮、各轮考什么,判断自己适不适合之前看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/u9BoG1n1948" title="Tips for negotiating your salary (from an ex-FAANG recruiter)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>mayuko · Tips for negotiating your salary (from an ex-FAANG recruiter) · 前大厂招聘官讲谈薪,海外 offer 的薪资结构和谈法讲得比较清楚。</figcaption>
</figure>

### 书籍

- Chris Voss《Never Split the Difference》(HarperBusiness, 2016):前 FBI 谈判专家写的谈判书,中文版书名为《掌控谈话》。读讲「校准式提问」和「锚定」的章节,用在谈薪上,2 小时。
- Gergely Orosz《The Tech Resume Inside Out》(自出版,2020):书里讲招聘流程的部分,能帮你理解招聘方在每个环节看什么,和今天的漏斗分析配合使用。

### 开源项目与代码

今天这组不需要。如果你想自己持续跟踪岗位,可以把 Day 16 学的东西用上:写个脚本定期抓取公开的职位接口(比如公司官网的 Ashby、Greenhouse 公开接口),存进数据库,用关键词或 embedding 筛出匹配的岗位。注意遵守各网站的使用条款,需要登录或有人机验证的平台不要去绕。

## 自测

1. 今天的数据里,国内 Agent 岗年包中位 48 万。如果你是 1–3 年经验、投杭州一家 50 人的公司,能直接拿 48 万去谈吗?为什么?

<details><summary>答案</summary>

不能。48 万是 557 条岗位挂牌区间中点的总体中位数,不是成交价,而且混合了所有年限、城市和公司规模。1–3 年的中位是 40 万,杭州的中位是 42 万,20–99 人公司的中位是 39 万,三格都低于总体;再考虑挂牌价通常高于成交价,你的参考值应该从这几格里取,并以面试表现和作品往上谈。

</details>

2. 海外远程样本 46 条里,真正面向全球的有几条?这对你的求职策略意味着什么?

<details><summary>答案</summary>

只有 3 条明确写全球任意地点,大多数限美加、欧洲或特定国家。所以海外远程不适合作为短期主线,现实路径是国内岗位、新加坡香港岗位、或者通过 EOR、contractor 方式的机会,同时把远程作为长期选项积累英文和跨时区协作经验。

</details>

3. FDE 和普通的 Agent 开发工程师有什么区别?什么样的人适合?

<details><summary>答案</summary>

FDE 嵌入客户或业务团队,负责从需求梳理、原型、评测到上线的落地全过程,更强调沟通、快速交付和用真实数据验证;普通 Agent 工程师更多在公司内部做产品或平台。适合喜欢和人打交道、能把技术讲给非技术人员听、有行业背景、能接受出差或驻场、偏好「能用」胜过「优雅」的人,做过实施、售前、技术支持的人转型尤其自然。

</details>

4. 你收到一个「AI Agent 工程师」岗位,对方说先参加两周付费培训,培训费可以从入职后工资里扣。你怎么判断?

<details><summary>答案</summary>

这是典型的培训贷信号,正规公司不会要求候选人为入职付费或签贷款。应该停止,并检查公司主体、是否有真实的技术面试、合同主体是谁。

</details>

5. (面试题)HR 问:「你的期望薪资是多少?」请给出一个回答思路。

<details><summary>答案</summary>

先尝试了解岗位预算,比如「想先了解一下这个岗位的薪资范围和结构」;如果必须先说,报一个区间,下沿就是你的目标而不是底线,并给依据,比如同城同类岗位的数据、现在的薪资结构、项目和技能的匹配度;同时说明会综合看月数、年终、股票等整体结构。

</details>

6. 投了 40 个岗位,回复只有 3 个,但这 3 个一面都过了。问题最可能出在哪?怎么调整?

<details><summary>答案</summary>

回复率低而一面通过率高,说明能力没问题,问题在简历初筛或渠道:简历关键词和 JD 不匹配、在线简历不完整、打招呼语是默认模板、投的岗位卡学历或年限、渠道选错。回到 Day 56 重做关键词对照,调整投递的岗位类型,多找内推。

</details>

## 明天预告

Day 60 · 结业:60 天回顾、能力自检清单、接下来怎么进阶。最后一天,对照 JD 给自己的能力打一次勾,清点作品,看看没达标的部分怎么补;然后讲接下来三个月可以往哪几个方向深入,包括 LoRA 轻量微调、浏览器 Agent、语音 Agent 和开源贡献,以及怎么保持跟得上这个变化极快的领域。
