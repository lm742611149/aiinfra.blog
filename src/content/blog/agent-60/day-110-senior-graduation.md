---
title: 'Day 110 · 进阶结业:资深自检清单、谈薪和下一步'
description: '110 天的最后一天。用 880 条 JD 里资深档的真实数据做一次完整的自检:国内资深岗挂牌年包在什么区间、海外 Staff 岗给多少、远程的门到底有多窄;资深岗位怎么找、怎么谈(职级比薪资更值得谈);以及走完这门课之后,往哪几个方向继续。'
pubDate: 2026-10-12
regime: none
tags: ['career', 'salary', 'negotiation', 'staff-engineer', 'graduation', 'agent-60']
series: 'agent-60'
day: 110
lang: 'zh'
---

## 今天要解决的问题

如果你从 Day 0 一路走到这里,你已经做了两个完整的项目:SupportPilot(一个能上线的客服工单 Agent)和 AgentOps(一个多租户的 Agent 平台),外加一个代码审查 Agent、一堆设计文档、评测报告、ADR,可能还有几个开源 PR 和几篇博客。

今天不学新东西。做三件事:

1. 用资深岗位的真实要求,给自己做一次逐项自检,每一项都要找到证据。
2. 看清楚资深档的市场数据:国内、新加坡、海外 Staff、海外远程各自是什么区间,口径是什么。
3. 想清楚怎么找、怎么谈,以及 110 天之后往哪个方向走。

预计用时:3 到 4 小时。自检那部分要认真做,它直接决定你接下来一个月的计划。

## 110 天走过的路

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="110 天两个阶段的路线">
<text x="20" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">基础篇 Day 0–60:能上线一个 Agent</text>
<rect x="20" y="40" width="70" height="44" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="55" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">API</text>
<rect x="95" y="40" width="70" height="44" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="130" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">工具循环</text>
<rect x="170" y="40" width="70" height="44" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="205" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">RAG</text>
<rect x="245" y="40" width="70" height="44" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="280" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">MCP</text>
<rect x="320" y="40" width="70" height="44" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="355" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">评测</text>
<rect x="395" y="40" width="70" height="44" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="430" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">生产化</text>
<rect x="470" y="40" width="150" height="44" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="545" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">SupportPilot+求职</text>
<text x="20" y="128" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">进阶篇 Day 61–110:能设计、证明、推动</text>
<rect x="20" y="140" width="80" height="44" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="60" y="166" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">架构深水区</text>
<rect x="105" y="140" width="80" height="44" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="145" y="166" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">评测科学</text>
<rect x="190" y="140" width="80" height="44" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="230" y="166" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">模型层</text>
<rect x="275" y="140" width="80" height="44" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="315" y="166" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">平台化</text>
<rect x="360" y="140" width="80" height="44" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="400" y="166" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">前沿形态</text>
<rect x="445" y="140" width="90" height="44" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="490" y="166" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">AgentOps</text>
<rect x="540" y="140" width="80" height="44" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="580" y="166" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">影响力</text>
</svg>
<figcaption>两个阶段。基础篇解决「能不能做出来」,进阶篇解决「能不能设计好、证明它好、让别人用起来」。琥珀色是两个毕业项目和收尾。</figcaption>
</figure>

回头看,两个阶段的差别可以用一句话说:基础篇结束时,你能在面试里讲清楚你写的 Agent 每一步在干什么;进阶篇结束时,你应该能讲清楚为什么要这样设计、怎么证明它是对的、要花多少钱、出了事怎么办、以及怎么让十个团队一起用。后者就是资深岗位在买的东西。

## 资深自检:每一项都要有证据

下面这张表是我从 docs/jd-research 里资深档岗位(职位名带资深、专家、架构师,或者年限要求 5 年以上的)的高频要求整理出来的,再对应到这门课的产出。打勾的标准不是「我学过」,而是「我能拿出一个链接或文件给面试官看」。

| 能力 | 资深 JD 里常见的写法 | 证据(你应该有的东西) | 对应课程 |
| --- | --- | --- | --- |
| 架构设计 | 主导 Agent 平台整体架构 | AgentOps 设计文档 + 至少 5 条 ADR | Day 67、88、96、106 |
| 评测体系 | 建立效果度量与回归基准 | 评测平台 + 带置信区间的评测报告 | Day 69–74、100 |
| 可靠性 | 稳定性、降级、故障恢复 | 持久化运行时 + 降级策略 + 一份事故复盘 | Day 65、87、99 |
| 成本 | 成本建模、ROI | 成本看板 + 一页纸 ROI 提案 | Day 83、102、108 |
| 平台化 | 多租户、网关、权限 | 网关 + MCP 工具中心 + 压测报告 | Day 82–84、97、98、104 |
| 安全 | 注入防御、权限隔离、审计 | 自动化红队接入 CI + 审计日志 | Day 72、84、103 |
| 模型层 | 选型、微调、自部署(加分) | 一个 LoRA 路由小模型及其评测 | Day 75–81、101 |
| 前沿 | Coding Agent、Browser Use、语音 | 一份技术选型报告 | Day 89–95 |
| 系统设计面试 | Staff 级开放题 | 三道真题的计时答案 + 模拟面试录音 | Day 107 |
| 影响力 | 推动跨团队、带人 | 推广计划 + 带人计划 + 公开 PR 或博客 | Day 108、109 |

做法:把这张表复制到 `notes/day110/self-check.md`,每一行填上证据链接。填不上的就是你接下来一个月的计划。如果有三行以上填不上,先别急着投资深岗,回去把对应的项目补完,或者先按中高级岗位投,边工作边补。

对表的时候要诚实。面试官会顺着你的简历往下问两三层,一个只做过演示、没有真实数据的「评测平台」,问到「你们的 judge 和人工一致率多少」时就会露馅。

## 资深档的市场数据

以下数据全部来自 2026 年 10 月 12 日抓取的 880 条 JD(docs/jd-research),口径先说清楚:

- 国内薪资来自 Boss 直聘和猎聘的列表,用挂牌月薪区间的中点乘薪数(没写按 12 薪)折算成年包,单位万元人民币。这是招聘方挂的报价,不是成交价。
- 抓取时每个「关键词 × 城市」只抓了第一页,排序受平台推荐和抓取账号的画像影响。
- 海外薪资来自公开的招聘页面,大多是 base 区间,另有股权。

**国内:按年限**

| 年限要求 | 样本 | P25 | 中位 | P75 |
| --- | --- | --- | --- | --- |
| 3–5 年 | 197 | 35 | 48 | 66 |
| 5–10 年 | 107 | 36 | 54 | 68 |
| 10 年以上 | 7 | 49 | 160 | 240 |
| 全部 | 557 | 36 | 48 | 68 |

10 年以上只有 7 条,只能看个大概,别当成市场价。

**国内:按职位名**。我另外从同一批数据里筛出职位名带「资深」「专家」「架构师」「高级」「负责人」等字样的岗位,一共 49 条带薪资:P25 47 万,中位 66 万,P75 90 万,37% 在 80 万以上。整体样本里 80 万以上的只占 15%。这个筛法比较粗(「高级」两个字在国内 JD 里用得很随意),但方向很清楚:资深档的中位数比整体高出将近 20 万,而且上沿拉得很开。

**国内:其他切法**:万人以上的公司中位 57 万、P75 80 万;上海中位 54 万、P75 75 万;Boss 上写硕士要求的中位 60 万(33 条)、博士 96 万(7 条,样本少)。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="国内不同分组的挂牌年包区间对比">
<text x="20" y="20" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">挂牌年包(万元),线段 = P25 到 P75,圆点 = 中位</text>
<line x1="160" y1="190" x2="620" y2="190" stroke="var(--rule)"/>
<text x="160" y="206" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">20</text>
<text x="275" y="206" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">45</text>
<text x="390" y="206" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">70</text>
<text x="505" y="206" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">95</text>
<text x="150" y="54" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">全部 557 条</text>
<line x1="234" y1="50" x2="381" y2="50" stroke="var(--mem)" stroke-width="6" stroke-linecap="round"/>
<circle cx="289" cy="50" r="6" fill="var(--paper)" stroke="var(--mem)" stroke-width="2"/>
<text x="150" y="94" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">5–10 年 107 条</text>
<line x1="234" y1="90" x2="381" y2="90" stroke="var(--mem)" stroke-width="6" stroke-linecap="round"/>
<circle cx="317" cy="90" r="6" fill="var(--paper)" stroke="var(--mem)" stroke-width="2"/>
<text x="150" y="134" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">万人以上公司</text>
<line x1="238" y1="130" x2="436" y2="130" stroke="var(--mem)" stroke-width="6" stroke-linecap="round"/>
<circle cx="330" cy="130" r="6" fill="var(--paper)" stroke="var(--mem)" stroke-width="2"/>
<text x="150" y="174" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">资深职位名 49 条</text>
<line x1="284" y1="170" x2="482" y2="170" stroke="var(--compute)" stroke-width="6" stroke-linecap="round"/>
<circle cx="372" cy="170" r="6" fill="var(--paper)" stroke="var(--compute)" stroke-width="2"/>
</svg>
<figcaption>资深职位名那一组(琥珀色)的 P75 到了 90 万,上沿比其他分组长得多。这说明资深档的薪资差异主要在上沿:谈得好和谈得一般,差距可能有几十万。</figcaption>
</figure>

**新加坡**:MyCareersFuture 上 29 条带月薪的岗位,中位区间 SGD 7,500 到 10,000 每月,最高到 21,667。但这批雇主里中介和外包公司占比很高,样本里带薪资的岗位,区间上限大多在 8,500 到 14,000 之间,只有个别到 2 万以上。头部 AI 公司的新加坡岗位这次样本里没有带薪资的,所以这组数据只能代表外包和中介渠道,资深档的真实上限要靠 LinkedIn 和猎头了解。

**海外 Staff 档(公开 base 区间,另有股权)**:

| 公司 | 职位 | 地点 | 年薪 base |
| --- | --- | --- | --- |
| Harvey | Staff Software Engineer, Agents | 美国 | $231K–$340K + 股权 + 奖金 |
| Decagon | Staff Software Engineer, Agent Platform | 美国 | $200K–$400K + 股权 |
| Replit | Staff Software Engineer, Agentic Commerce & Payments | 美国 | $290K–$360K + 股权 |
| Perplexity | Member of Technical Staff, Applied AI | 美国 | $220K–$405K + 股权 |
| Cohere | Member of Technical Staff, Agent Code | 加拿大等 | CA$250K–CA$535K + 股权 |
| GC AI | Member of Technical Staff, Applied AI | 远程(限美加) | $180K–$430K + 股权 |
| Mozilla / Thunderbird | Staff Product Engineer, Enterprise AI | 远程(限美加) | $185K–$220K |

美国本土 26 条带薪资的样本中位区间是 $198K 到 $335K,海外远程 8 条是 $180K 到 $250K。

**远程的现实**:46 条海外远程岗里,限美国、加拿大或美洲的 18 条,限欧洲或英国时区的 6 条,限其他特定国家的 8 条,没写清楚的 11 条,明确写「全球任意地点」的只有 3 条。上表里两个远程 Staff 岗都写了限美加。所以如果你人在国内,海外远程 Staff 岗基本不是一条能靠投简历走通的路。更现实的路径是:国内资深岗;新加坡或香港的岗位(需要搬家);或者通过开源和社区影响力让对方先找到你,以合同工的形式合作。

## 资深岗位怎么找

中级岗位靠海投还能撞上几个面试,资深岗位海投的效率很低。几条更有效的渠道:

**内推。** 资深岗位的内推比例比中级高得多。前两天讲的影响力在这里变现:你帮过的人、一起做过项目的人、在社区里认识的人。直接问他们团队有没有这类岗位,比在招聘网站上投十份有用。

**猎头。** 猎聘和 LinkedIn 上的猎头手里有大量不公开挂出的资深岗位。和两三个专做 AI 方向的猎头保持联系,告诉他们你的目标:职级、方向、城市、最低薪资。猎头的费用由雇主付,对你免费。

**主动找到用人的人。** 在 GitHub、博客、技术社区里看到某个团队在做你感兴趣的 Agent 方向,直接给负责人发一封简短的邮件或私信:你是谁、做过什么(附链接)、为什么对他们的方向感兴趣。资深候选人这样做是被欢迎的,因为好的资深候选人稀缺。

**招聘平台用于了解行情。** Boss 和猎聘上的挂牌薪资是很好的谈薪参考,今天这些数据就是从那里来的。但正常浏览就好,别用脚本批量抓,我们抓数据时 Boss 的账号就被提示过异常。

## 资深怎么谈

Day 59 讲过谈薪的基本方法。资深档有几处不一样:

**先谈职级,再谈薪资。** 很多公司的薪资带宽是按职级定的,同一个职级里谈出来的差距有限,职级差一档,整个带宽都不一样。所以面试结束后的第一件事是确认对方打算给你什么职级,依据是什么。如果你认为被低定了,用你的作品和面试表现去争取重新评估,而不是在低职级里死磕薪资数字。职级名称各家不同,问清楚它在对方体系里对应的是什么范围的职责。

**看总包,拆开看。** 国内常见的构成是月薪、薪数、年终奖、股票或期权、签字费。15 薪和 12 薪的同一个月薪,年包差 25%。股票要问清楚归属节奏(几年、每年多少)、授予价格和流动性。创业公司的期权,按「可能归零」来估值,别把它当现金算进总包。

**用数据锚定。** 今天的数据就是锚点:如果你瞄准的是资深职位名那一档,中位 66 万、P75 90 万。你的期望可以落在 P50 到 P75 之间,并给出理由:你的作品、你解决过的问题的规模、你能带来的结果。说「我希望在 75 到 85 万之间,因为我做过多租户 Agent 平台和完整的评测体系,这正是你们这个岗位的核心职责」比单纯报一个数字有力得多。

**有竞争 offer 时才提。** 手里有其他 offer 是最有力的谈判筹码,但不要虚构。资深圈子小,被拆穿的代价很大。

**问清楚职责和预期。** 资深岗位入职后的前半年,对方期望你交付什么?你会有多少自主权?向谁汇报?团队有多少人?这些问题的答案,比几万块的差距更影响你接下来两年过得怎么样。

**留在现公司也是一个选项。** 拿着市场数据和外部 offer 和现在的老板谈晋升或调薪,有时候比跳槽更划算,特别是你在现公司已经积累了信任和上下文。但不要用一个你并不打算接的 offer 去威胁老板,这通常会伤害信任。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1VL6TY7E3V&autoplay=0&high_quality=1" title="高级程序员谈薪技巧!避雷话术!建议收藏!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>极海Channel · 高级程序员谈薪技巧!避雷话术!建议收藏! · 6 分钟,讲资深候选人谈薪时常见的话术坑,和上面的方法对照着看。</figcaption>
</figure>

## 110 天之后

这门课到这里结束,但这个领域不会停。往下走大概有四个方向,不用都选,挑一个深挖一年:

**专精一个领域。** 评测、安全、语音 Agent、代码 Agent、Browser Agent,任选一个做到团队里最懂的那个人。资深之后的竞争力常常来自深度,而不是广度。JD 里这些方向都已经有专门的岗位,比如美团的「Agent 可靠性技术专家」、网易的「LLM Agent Memory 专家」、Cohere 的「Safety and Security for Agents」。

**往平台和基础设施走。** 如果你在 W12 和 W13 里发现自己更喜欢模型网关、自部署推理、GPU 资源调度这些东西,可以往 AI 平台工程或推理基础设施方向走。这条路门槛更高,但岗位更稀缺,薪资上沿也更高。

**往产品走。** 如果你在 W14 讲 Agent 产品体验那天特别有感觉,可以考虑做 AI 产品的技术负责人,或者转产品经理。懂工程的 AI 产品经理非常少。

**往管理走。** 如果你在 Day 108 带人那部分最有成就感,可以考虑技术管理。Camille Fournier 的《The Manager's Path》是一本很好的入门书。不过 Staff 这条技术路线也能走得很远,不是只有转管理才算晋升。

**保持更新的信息源**(每周花两三个小时):

- Simon Willison 的博客:LLM 工具和实践的第一手记录,更新很勤。
- Latent Space:AI 工程师社区的播客和通讯,经常访谈一线做 Agent 的人。
- Anthropic 和 OpenAI 的工程博客:新能力和最佳实践往往先在这里出现。
- Hamel Husain 和 Eugene Yan 的博客:评测和 LLM 系统的实践经验。
- Hugging Face Papers 和 arXiv:每周扫一眼标题,挑和你方向相关的读。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LCEmiRjPEtQ" title="Andrej Karpathy: Software Is Changing (Again)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Y Combinator · Andrej Karpathy: Software Is Changing (Again) · 40 分钟。Karpathy 讲 Software 3.0 和 Agent 时代的软件,适合在结业这天看,想想你接下来想在这个变化里站在哪个位置。B 站有中文字幕版,见学习资料。</figcaption>
</figure>

## 动手练习

**步骤 1:完成自检表。** 把上面的十行能力表复制到 `notes/day110/self-check.md`,每一行填上证据链接。填不上的行,写清楚补齐计划和日期。

**步骤 2:算你的目标区间。** 按你的年限、城市、目标公司规模,从今天的数据里找到对应的 P50 和 P75,写下你的目标总包区间和理由(三条以内,每条对应一个作品或成果)。如果目标是新加坡或海外,写清楚你打算走哪条路径(搬家、合同工、社区影响力),以及这条路径的现实限制。

**步骤 3:更新简历。** 按 Day 56 的方法更新简历,但这次重点突出资深档的能力:设计了什么、证明了什么、推动了什么、规模多大。每条经历带一个数字。

**步骤 4:列出十个目标和十个联系人。** 十个目标公司或团队,十个可以帮你内推或者给你建议的人。给其中三个发消息。

**步骤 5:选一个深挖方向,写一年计划。** 从四个方向里挑一个,写下接下来一年每个季度的目标:学什么、做什么项目、产出什么公开作品。

**步骤 6:给课程留言。** 在这一篇下面留言,写下你学完后最有用的三天和最没用的一天。这门课会根据大家的反馈继续修改。

**验收标准**:自检表每一行都有证据或补齐计划;目标区间有数据和理由;简历更新完;至少给三个人发出了消息;一年计划写完。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 挂牌薪资 | 招聘方在 JD 上写的薪资区间,不是最终成交价 |
| P25 / P50 / P75 | 把样本从低到高排序后,第 25%、50%、75% 位置的值 |
| 总包(TC) | Total Compensation,月薪 × 薪数 + 年终 + 股票等的总和 |
| 归属(vesting) | 股票或期权分几年、按什么节奏真正归你所有 |
| 职级带宽 | 某个职级对应的薪资范围 |
| 内推 | 公司员工推荐候选人,资深岗位的主要来源之一 |
| EOR / 合同工 | 通过第三方雇佣或以合同形式为海外公司远程工作 |
| 深挖方向 | 资深之后选定一个领域持续投入,建立深度优势 |

## 常见误区

**把学过当成会了。** 自检表上打勾的标准是有证据,不是看过。面试官会往下问两三层,没有真实数据的项目经不起追问。

**只盯着薪资数字,不谈职级。** 职级定低了,同一个带宽里怎么谈都有限,而且之后的晋升也从低处起步。

**把期权当现金。** 创业公司的期权要按可能归零来估值。比较 offer 时,先比现金部分。

**对海外远程有不切实际的预期。** 数据很清楚:真正不限地区的远程岗极少。把它当成长期目标,用社区影响力慢慢接近,而不是当成下个月的计划。

**学完就停。** 这个领域半年变一次。不保持每周几小时的信息摄入,一年后你学的框架和最佳实践会有一半过时。

**觉得自己还没准备好。** 资深岗位的要求永远没人能百分之百满足。自检表填上七八成,就可以开始投了,剩下的边面试边补。

## 学习资料

### 文档与文章

- [Getting the title where you are](https://staffeng.com/guides/getting-the-title-where-you-are/):在现公司晋升到 Staff 的方法,如果你打算先在内部争取,先读这篇。
- [Promo packets](https://staffeng.com/guides/promo-packets/):怎么整理晋升材料,和今天的自检表思路一致。
- [levels.fyi](https://www.levels.fyi/):海外和部分国内公司的职级和薪资数据,看总包构成和职级对照。
- [Latent Space](https://www.latent.space/):AI 工程师的播客和通讯,保持更新的主要信息源之一。
- [Simon Willison 的博客](https://simonwillison.net/)、[Hamel Husain](https://hamel.dev/)、[Eugene Yan](https://eugeneyan.com/):三个长期值得关注的个人博客。
- [Anthropic Engineering](https://www.anthropic.com/engineering):Anthropic 的工程博客,Agent 相关的最佳实践很多出自这里。
- [Hugging Face Papers](https://huggingface.co/papers):每日热门论文,扫标题用。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1iS4y1h7m3&autoplay=0&high_quality=1" title="如何谈薪?面试千人大厂HR,教你【谈薪必胜法】搞钱!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>网易招聘 · 如何谈薪?面试千人大厂HR,教你【谈薪必胜法】搞钱! · 12 分钟,大厂 HR 视角讲谈薪,知道对面怎么想。</figcaption>
</figure>

- Web3天空之城,《大神Andrej Karpathy最新演讲:AI时代的软件》(BV1CLNtzyEP4),40 分钟,正文里那个 Karpathy 演讲的中文字幕版。

### 其他经典视频

- Y Combinator 的 Karpathy 演讲已经嵌在正文里。
- Sequoia Capital,《Andrej Karpathy: From Vibe Coding to Agentic Engineering w/ Stephanie Zhan》(YouTube ID 96jN2OCOfLs),30 分钟。Karpathy 讲从 vibe coding 到 agentic engineering 的转变,和这门课的定位很契合。

### 书籍

- Tanya Reilly,《The Staff Engineer's Path》,O'Reilly,2022。繁体中文版《Staff 工程師之路》。读第三部分 Leveling Up,讲资深之后怎么继续成长、怎么规划下一步。
- Camille Fournier,《The Manager's Path》,O'Reilly,2017。中文版《技术为径:带领公司走向卓越的工程师》,电子工业出版社,2023。考虑往管理走的话通读。
- Chris Voss,《Never Split the Difference》,HarperBusiness,2016。中文版书名《掌控谈话》。读讲锚定和提问的章节,谈薪前看。

### 开源项目与代码

- 你自己的 `agentops/` 和 `supportpilot/` 仓库:把它们整理成公开版本,README 里放上设计文档、评测报告和演示视频的链接。这是你最好的简历附件。
- [anthropics/courses](https://github.com/anthropics/courses):Anthropic 官方课程仓库,学完这门课之后,可以用它查漏补缺。

## 自测

1. 自检表上「评测体系」这一行,什么样的证据算合格?

<details><summary>答案</summary>

一个能跑的评测平台(离线回归、judge 管理)加一份真实的评测报告:样本量、指标、置信区间、改动前后的配对比较,以及 judge 和人工标注的一致率。只说「我做过评测」或者只有一个分数不算合格,面试官问到样本量和显著性时答不上来。

</details>

2. 国内资深档的挂牌薪资,中位数和上沿大概是多少?这个数字有哪些局限?

<details><summary>答案</summary>

5–10 年要求的岗位中位 54 万、P75 68 万;职位名带资深、专家、架构师等字样的 49 条中位 66 万、P75 90 万,37% 在 80 万以上。局限:是挂牌区间中点不是成交价;每个关键词和城市只抓了第一页,受平台推荐影响;「高级」这类字在国内 JD 里用得随意,筛法比较粗;10 年以上样本只有 7 条。

</details>

3. 为什么资深档建议先谈职级再谈薪资?

<details><summary>答案</summary>

很多公司的薪资带宽按职级定,同一职级里能谈的空间有限,职级差一档整个带宽都不同,而且之后的晋升起点也不同。所以职级被低定时,应该用作品和面试表现争取重新评估职级,而不是在低职级里谈薪资数字。

</details>

4. 你在国内,目标是海外远程 Staff 岗。根据数据,现实的路径有哪些?

<details><summary>答案</summary>

46 条海外远程岗里只有 3 条不限地区,两个远程 Staff 样本都限美加。现实路径:先在国内拿资深岗积累经验和作品;考虑新加坡或香港的岗位(需要搬家);通过开源贡献、技术博客、社区参与让海外团队先找到你,以合同工或第三方雇佣的形式合作。把它当成一到两年的目标,而不是靠投简历的短期计划。

</details>

5. 资深面试题:你为什么觉得自己适合资深 Agent 工程师这个职位?你接下来一年想在哪个方向深入?

<details><summary>答案</summary>

答题要点:用证据回答,而不是形容词。挑两三个最有说服力的成果:设计并上线了什么系统、规模多大、用什么评测证明效果、推动了多少团队采用、带来了什么业务结果(成本、效率、质量)。然后讲你的深挖方向和理由,最好和对方团队的方向有交集。最后可以坦诚说一个你还在补的短板和补的计划,这比假装全能更可信。

</details>

6. 110 天学完,你打算怎么保持更新?给出一个每周的具体安排。

<details><summary>答案</summary>

一个可行的安排:每周一花 30 分钟扫 Simon Willison 的博客和 Hugging Face Papers 的标题;每周三听一期 Latent Space 或类似播客(通勤时间);每周末花两小时深读一篇和自己方向相关的工程博客或论文,并动手复现其中一个小实验;每月写一篇博客或 TIL 记录学到的东西。关键是固定时间、固定来源、并且有输出。

</details>

## 明天预告

进阶篇到这里结束。想再往前走一步的话,明天(Day 111)开始作品篇:先做 Agent Loupe,一个给 Agent 用的调试器,再做 BillSleuth,一个会查账的计费争议调查 Agent,两个都是能挂在个人网站上让招聘方在线试用的作品。不做作品篇也没关系,下周一的计划照样是:按自检表补齐缺的那几行,给你列出的三个联系人发消息,再投五份资深岗位。

这门课从写下第一篇到最后一篇,本身就是一个 Agent 帮着人完成的项目。如果你觉得哪里写错了、过时了或者讲得不清楚,在对应那一天下面留言。这个领域变得太快,课程也要跟着改。祝你拿到想要的 offer,也祝你一年后回头看,会觉得今天的自己是个新人。
