---
title: '880 条真实 JD 拆解:国内和海外的 AI Agent 工程师到底要什么'
description: '2026 年 10 月抓了 880 条 AI Agent / 大模型应用工程师的招聘要求,国内 695 条(含 Boss 直聘 435 条、猎聘 140 条)、海外 185 条。两边都要评测、Python 和 RAG;国内更爱问 Agent 内部怎么转,海外更看重把东西交到客户手里。国内挂牌年包中位 48 万,明确卡硕士的约一成,远程比你想的窄。'
pubDate: 2026-10-12
regime: none
tags: ['jd', 'career', 'agent-60']
lang: 'zh'
---

做这门课之前,我一直有个疑问:网上说的「AI Agent 工程师」到底是一个什么样的岗位?国内和海外要的是不是一回事?光看几条 JD 很容易被个例带偏,有的写得像算法岗,有的写得像运维岗,有的其实是前端。

所以 10 月 12 号这天,我把能抓到的招聘平台都抓了一遍。先抓了 305 条(国内 120、海外 185),后来又用自己的账号登录 Boss 直聘和猎聘补了 575 条国内岗位,一共 880 条:国内 695,海外 185。下面是我把它们翻了一遍之后的看法,数字都来自这批数据,原始记录在仓库的 `docs/jd-research/` 里,每条都有链接和抓取日期。

先说结论,省得你往下翻:

两边都要的东西几乎一样,评测、Python、RAG、部署,谁都绕不开。差别在侧重点上。国内 JD 爱问「Agent 内部是怎么转的」,上下文工程、工具调用、多 Agent 的出现比例都明显比海外高,大厂尤其如此;海外 JD 更关心你能不能把东西交到客户手里,Forward Deployed Engineer 这类面向客户的岗位在美国样本里占了一半以上。国内挂牌年包的中位数是 48 万,明确卡硕士的大约一成。远程这件事比大多数人想得更窄。

## 样本从哪来,能信几分

先交代清楚数据怎么来的,不然后面的百分比没法看。

| 平台 | 地区 | 条数 | 备注 |
| --- | --- | --- | --- |
| 智联招聘 | 国内 | 27 | 北京/上海/深圳/杭州搜「AI Agent工程师」,**唯一带薪资的国内来源**,以中小公司为主 |
| 字节跳动招聘官网 | 国内 | 22 | 社招接口,关键词 Agent |
| 腾讯招聘官网 | 国内 | 21 | 公开查询接口 |
| 百度招聘官网 | 国内 | 13 | |
| 网易招聘官网 | 国内 | 12 | |
| 美团招聘官网 | 国内 | 11 | |
| Boss 直聘(登录抓取) | 国内 | 435 | 用我自己的账号登录,5 个关键词 × 北上深杭,**全部带薪资**;只拿到 74 条完整正文 |
| 猎聘(登录抓取) | 国内 | 140 | 同样登录抓取,4 个关键词 × 北上深杭,全部带薪资和正文 |
| Boss 直聘(手机截图) | 国内 | 7 | 截图转录,没有链接 |
| 京东招聘官网 | 国内 | 4 | 职位名叫「软件开发岗」,按正文含 Agent 筛出来的 |
| V2EX 招聘节点 | 国内 | 3 | 含 1 条远程兼职 |
| LinkedIn 公开职位页 | 新加坡/香港/远程 | 64 | 香港 23、新加坡 23、远程 18 |
| Hacker News「Who is hiring」10 月帖 | 海外 | 39 | 偏创业公司 |
| Ashby 公开接口 | 海外 | 36 | OpenAI、Sierra、Decagon、Harvey、Cohere、Ramp、Notion、LangChain 等 |
| MyCareersFuture | 新加坡 | 29 | 新加坡政府职位库,**全部带月薪** |
| Greenhouse 公开接口 | 海外 | 12 | Anthropic、Intercom、Stripe |
| Lever 公开接口 | 海外 | 2 | Palantir |
| Remote OK / We Work Remotely | 海外远程 | 3 | |

海外 185 条按地区拆开是:新加坡 52、香港 23、海外远程 46、美国本土 40,剩下 24 条是欧洲、日韩、澳洲、印度这些地方。

抓不到的平台也得说一下。Boss 直聘和猎聘不登录根本拿不到数据,Boss 的接口直接回「您的环境存在异常」,猎聘的搜索接口要签名头。后来我用自己的账号登录了浏览器再抓,两边都拿到了,但 Boss 翻到第 78 条职位详情时弹了「您的账户存在异常行为」,我马上停了,所以 Boss 435 条里只有 74 条有完整正文,其余只有列表上的薪资、年限、学历和公司规模。前程无忧和拉勾挡在阿里云的人机校验后面,牛客的公开接口 404,阿里巴巴官网要登录态,电鸭跳人机验证。海外这边 Wellfound 靠前端渲染拿不到职位,YC 的 Work at a Startup 要登录。脉脉、华为、米哈游、小红书、蚂蚁这次没顾上试。

所以这份数据有几个明显的偏:

国内第一批 120 条里大厂官网占了 74 条,大厂官网不写薪资;第二批 Boss 和猎聘以中小公司为主,每个「关键词 × 城市」只抓了第一页,排序还受平台推荐和我账号画像的影响。海外的 LinkedIn 只拿到每次搜索的前 30 条,HN 上大多是创业公司。新加坡的政府职位库里,中介和外包公司发的帖特别多。

还有一点最重要:下面所有「百分之多少的 JD 提到某技能」,都是拿正则在 JD 全文里匹配关键词算出来的,不是我一条条人工标的。国内这部分只算有正文的 334 条(第一批 120 + Boss/猎聘 214),两批用的正则不完全一样,我在第一批上对过,多数技能差 0 到 5 个点。海外 JD 喜欢先写三段公司介绍,国内大厂 JD 把职责写得很细,这会让同一个技能在两边的命中率天然有差别。所以差三五个点别当回事,看差了二三十个点的那些。

## 两边都要的:评测、Python、RAG

<figure>
<svg viewBox="0 0 640 326" role="img" aria-label="国内与海外 JD 中两边都高频的技能出现比例条形图">
<text x="0" y="16" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">两边都要的七项</text>
<rect x="178" y="26" width="10" height="10" fill="var(--mem)"/><text x="194" y="35" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">国内 n=334</text>
<rect x="308" y="26" width="10" height="10" fill="var(--compute)"/><text x="324" y="35" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">海外 n=185</text>
<line x1="178" y1="42" x2="178" y2="308" stroke="var(--rule)" stroke-width="1"/>
<text x="178" y="322" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">0%</text>
<line x1="278" y1="42" x2="278" y2="308" stroke="var(--rule)" stroke-width="1"/>
<text x="278" y="322" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">25%</text>
<line x1="378" y1="42" x2="378" y2="308" stroke="var(--rule)" stroke-width="1"/>
<text x="378" y="322" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">50%</text>
<line x1="478" y1="42" x2="478" y2="308" stroke="var(--rule)" stroke-width="1"/>
<text x="478" y="322" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">75%</text>
<line x1="578" y1="42" x2="578" y2="308" stroke="var(--rule)" stroke-width="1"/>
<text x="578" y="322" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">100%</text>
<text x="168" y="63" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Python</text>
<rect x="178" y="49" width="260" height="11" fill="var(--mem)"/>
<text x="444" y="59" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">65%</text>
<rect x="178" y="63" width="252" height="11" fill="var(--compute)"/>
<text x="436" y="73" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">63%</text>
<text x="168" y="101" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">评测 Eval</text>
<rect x="178" y="87" width="192" height="11" fill="var(--mem)"/>
<text x="376" y="97" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">48%</text>
<rect x="178" y="101" width="248" height="11" fill="var(--compute)"/>
<text x="432" y="111" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">62%</text>
<text x="168" y="139" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">RAG / 检索</text>
<rect x="178" y="125" width="204" height="11" fill="var(--mem)"/>
<text x="388" y="135" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">51%</text>
<rect x="178" y="139" width="216" height="11" fill="var(--compute)"/>
<text x="400" y="149" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">54%</text>
<text x="168" y="177" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Prompt 工程</text>
<rect x="178" y="163" width="184" height="11" fill="var(--mem)"/>
<text x="368" y="173" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">46%</text>
<rect x="178" y="177" width="184" height="11" fill="var(--compute)"/>
<text x="368" y="187" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">46%</text>
<text x="168" y="215" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">部署 / 容器 / 云</text>
<rect x="178" y="201" width="156" height="11" fill="var(--mem)"/>
<text x="340" y="211" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">39%</text>
<rect x="178" y="215" width="212" height="11" fill="var(--compute)"/>
<text x="396" y="225" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">53%</text>
<text x="168" y="253" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">成本 / 延迟 / ROI</text>
<rect x="178" y="239" width="124" height="11" fill="var(--mem)"/>
<text x="308" y="249" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">31%</text>
<rect x="178" y="253" width="156" height="11" fill="var(--compute)"/>
<text x="340" y="263" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">39%</text>
<text x="168" y="291" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">安全</text>
<rect x="178" y="277" width="44" height="11" fill="var(--mem)"/>
<text x="228" y="287" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">11%</text>
<rect x="178" y="291" width="88" height="11" fill="var(--compute)"/>
<text x="272" y="301" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">22%</text>
</svg>
<figcaption>两边都高频的七项技能,国内是有正文的 334 条(大厂官网 120 + Boss/猎聘 214)。Python、RAG、Prompt 两边几乎打平;评测海外高 14 个点,但国内也有将近一半在提。</figcaption>
</figure>

**评测是两边公认的门槛。** 国内 48%、海外 62% 的 JD 提到了评测。国内大厂更重视,第一批大厂官网为主的样本里是 56%,Boss 和猎聘上的中小公司是 44%。我原本以为这是海外大厂才讲究的东西,结果国内大厂写得更狠。腾讯有个「Agent Harness 工程师」的岗位,职责第三条是这么写的:

> 构建自动化 eval pipeline,覆盖离线 Benchmark、在线 A/B Testing、SBS 人工评测与 regression detection;设计任务级评测指标与 rubric(含 LLM-as-Judge、pass@k、轨迹级评分),建设评测集管理与 CI 门禁,使每次 Prompt、模型、工具变更都有量化的收益与回归判定。

这段话基本就是这门课 W5 一整周的目录。智联上一家郑州的小公司也要求面试时「能讲清上线后效果指标是多少、是怎么测出来的」。海外那边 LangChain、Harvey、Cohere 都把「用评测驱动质量」写进了要求。

换句话说,面试官现在默认你会写 Agent,他想知道的是你怎么证明它变好了。这也是为什么课程在评测上花了一整周([Day 29](/blog/agent-60/day-29-why-evals/) 到 [Day 35](/blog/agent-60/day-35-week5-review-eval-ci/)),毕业项目里还要再做一遍。

**Python 是默认语言。** 国内 65%、海外 63%。剩下没写 Python 的,多半是写了「Python/Go/TS/Java 任一」。

**RAG 两边都过半**,国内 51%、海外 54%。不过拆到地区看差别不小:新加坡香港高达 84%,美国本土只有 25%。新港的岗位很多是企业落地和外包项目,知识库问答是最常见的活;美国的 Agent 公司已经默认你会检索,不怎么单独写了。

**部署和工程化也都要。** 国内 39%、海外 53% 提到 Docker、K8s 或云。这一项我觉得国内其实被低估了,因为大厂 JD 习惯写「全链路交付」「从架构设计到上线运维」,不一定点名 Docker,关键词就没匹配上。

还有一条共识不在图上,但我翻 JD 时感受最强:**真实上线经验比框架名重要得多。** 海外几乎每条都写「shipped to production」;国内大厂写「全链路交付」,中小公司写得更直白,「至少 1 个已上线的大模型应用项目,本人承担主要开发」。会背 LangChain 的 API 不值钱,能说清楚你上线的那个 Agent 每天跑多少单、错在哪、怎么修的,才值钱。

## 差得最多的:国内问内部,海外问交付

<figure>
<svg viewBox="0 0 640 440" role="img" aria-label="国内与海外 JD 中差距最大的技能出现比例条形图">
<text x="0" y="16" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">差得最多的:前八项国内高,后两项海外高</text>
<rect x="178" y="26" width="10" height="10" fill="var(--mem)"/><text x="194" y="35" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">国内 n=334</text>
<rect x="308" y="26" width="10" height="10" fill="var(--compute)"/><text x="324" y="35" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">海外 n=185</text>
<line x1="178" y1="42" x2="178" y2="422" stroke="var(--rule)" stroke-width="1"/>
<text x="178" y="436" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">0%</text>
<line x1="278" y1="42" x2="278" y2="422" stroke="var(--rule)" stroke-width="1"/>
<text x="278" y="436" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">25%</text>
<line x1="378" y1="42" x2="378" y2="422" stroke="var(--rule)" stroke-width="1"/>
<text x="378" y="436" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">50%</text>
<line x1="478" y1="42" x2="478" y2="422" stroke="var(--rule)" stroke-width="1"/>
<text x="478" y="436" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">75%</text>
<line x1="578" y1="42" x2="578" y2="422" stroke="var(--rule)" stroke-width="1"/>
<text x="578" y="436" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">100%</text>
<text x="168" y="63" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">上下文工程 / 记忆</text>
<rect x="178" y="49" width="208" height="11" fill="var(--mem)"/>
<text x="392" y="59" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">52%</text>
<rect x="178" y="63" width="100" height="11" fill="var(--compute)"/>
<text x="284" y="73" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">25%</text>
<text x="168" y="101" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">工具调用 / API</text>
<rect x="178" y="87" width="220" height="11" fill="var(--mem)"/>
<text x="404" y="97" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">55%</text>
<rect x="178" y="101" width="156" height="11" fill="var(--compute)"/>
<text x="340" y="111" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">39%</text>
<text x="168" y="139" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">多 Agent</text>
<rect x="178" y="125" width="148" height="11" fill="var(--mem)"/>
<text x="332" y="135" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">37%</text>
<rect x="178" y="139" width="88" height="11" fill="var(--compute)"/>
<text x="272" y="149" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">22%</text>
<text x="168" y="177" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Java</text>
<rect x="178" y="163" width="92" height="11" fill="var(--mem)"/>
<text x="276" y="173" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">23%</text>
<rect x="178" y="177" width="40" height="11" fill="var(--compute)"/>
<text x="224" y="187" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">10%</text>
<text x="168" y="215" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Go</text>
<rect x="178" y="201" width="92" height="11" fill="var(--mem)"/>
<text x="276" y="211" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">23%</text>
<rect x="178" y="215" width="56" height="11" fill="var(--compute)"/>
<text x="240" y="225" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">14%</text>
<text x="168" y="253" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">全栈 / 前端</text>
<rect x="178" y="239" width="152" height="11" fill="var(--mem)"/>
<text x="336" y="249" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">38%</text>
<rect x="178" y="253" width="116" height="11" fill="var(--compute)"/>
<text x="300" y="263" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">29%</text>
<text x="168" y="291" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">熟练用 Coding Agent</text>
<rect x="178" y="277" width="84" height="11" fill="var(--mem)"/>
<text x="268" y="287" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">21%</text>
<rect x="178" y="291" width="60" height="11" fill="var(--compute)"/>
<text x="244" y="301" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">15%</text>
<text x="168" y="329" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Skills</text>
<rect x="178" y="315" width="40" height="11" fill="var(--mem)"/>
<text x="224" y="325" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">10%</text>
<rect x="178" y="329" width="12" height="11" fill="var(--compute)"/>
<text x="196" y="339" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">3%</text>
<text x="168" y="367" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">SQL / 数据系统</text>
<rect x="178" y="353" width="124" height="11" fill="var(--mem)"/>
<text x="308" y="363" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">31%</text>
<rect x="178" y="367" width="164" height="11" fill="var(--compute)"/>
<text x="348" y="377" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">41%</text>
<text x="168" y="405" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">面向客户 / 交付</text>
<rect x="178" y="391" width="132" height="11" fill="var(--mem)"/>
<text x="316" y="401" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">33%</text>
<rect x="178" y="405" width="184" height="11" fill="var(--compute)"/>
<text x="368" y="415" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">46%</text>
</svg>
<figcaption>差距最大的十项。上面八项国内更高,多数跟「Agent 内部怎么实现」和语言栈有关;最下面两项海外更高,都跟「对接客户和业务数据」有关。MCP 两边都是 16%–17%,不再算差异。</figcaption>
</figure>

第一眼最扎眼的是**上下文工程**:国内 52%,海外 25%。国内 JD 里「上下文管理」「Context 组装与压缩」「记忆机制」出现得特别频繁。再加上工具调用(55% 对 39%)、多 Agent(37% 对 22%)、Skills(10% 对 3%),国内 JD 的画像很清楚:它要你懂 Agent 的发动机是怎么转的。

这里有个要注意的地方。只看第一批大厂官网样本时,这个差距更夸张,上下文工程 66%、多 Agent 42%、MCP 26%;补进 Boss 和猎聘的中小公司之后,上下文工程降到 44%,MCP 只有 13%。合起来 MCP 是 17%,和海外的 16% 基本一样,所以「国内更看重 MCP」这个说法我收回。中小公司的 JD 更像清单,「熟悉 Prompt、LangChain、RAG」这类写法更多,Prompt 工程在它们那里有 50%。

这跟国内大厂现在的招聘方向有关。腾讯、美团、字节、百度有一批岗位的标题直接就叫「Agent Harness 工程师」「Agent Infra」。腾讯光这次抓到的就有六个带 Harness 的岗位,混元、企业微信、WorkBuddy、CodeBuddy 都在招。还是刚才那个腾讯岗位,第一条职责把 Harness 是什么写得很明白:

> 负责 Agent 运行时的架构设计与实现,包括 agent loop 调度、Tool/Skill 抽象与注册机制、Context 组装与压缩策略、长任务的状态持久化与 checkpoint 恢复、Sub-Agent 并发编排、以及沙箱隔离与权限控制体系。

说白了,Harness 就是包在大模型外面的那一圈东西:循环、工具注册、上下文组装、断点恢复、子 Agent、沙箱。这门课 [Day 9](/blog/agent-60/day-09-agent-loop-from-scratch/) 让你手写 Agent 循环,[Day 20](/blog/agent-60/day-20-context-engineering-memory/) 讲上下文压缩,[Day 25](/blog/agent-60/day-25-langgraph-hitl/) 讲 checkpoint,[Day 26](/blog/agent-60/day-26-multi-agent/) 讲子 Agent,[Day 40](/blog/agent-60/day-40-permissions-sandbox/) 讲沙箱,拼起来就是一个最小的 Harness。面试被问到这个词别慌。

海外反过来。**面向客户和交付**海外 46%、国内 33%,美国本土单独看是 52%。**SQL 和数据系统**海外 41%、国内 31%,新港更是 64%。海外 JD 写技术要求往往比较抽象,反复强调 ownership、和客户一起把 Agent 落地。

语言上也有个小差别:国内 Go 和 Java 都是 23%(大厂里 Go 更多,第一批是 34%),海外分别只有 14% 和 10%;海外 TypeScript 更多,美国本土 45% 的 JD 提到 TS。如果你是 Java 后端出身,在国内投 Agent 岗不算劣势,不少大厂的 Agent 平台就是 Java 或 Go 写的,只是 Python 那部分你得补上。

## 一个意外:国内比海外更看重你会不会用 Coding Agent

我本来以为「熟练使用 Claude Code / Cursor / Codex」是海外才会写进 JD 的东西,结果国内是 21%(大厂 26%,Boss 和猎聘 19%),海外只有 15%。

国内写得还很具体。腾讯 Harness 岗要求「重度使用 Cursor / Claude Code / Codex 等 agentic coding 工具进行日常编程,对 Agent 的能力边界、典型 failure mode(上下文丢失、工具误用、多轮偏移、幻觉式收敛)有切身的体感和自己的方法论」。Boss 上有个企业落地岗写的是「熟练使用 Codex、Claude Code、Cursor 等 AI 编程工具,能够高效完成代码生成、调试、重构、测试和工程交付,并对生成代码进行质量把控」。

注意后半句,**对生成代码进行质量把控**。会用不算本事,能看出它哪里写错了、知道它在什么情况下会犯糊涂,才是 JD 想要的。这件事没法临时抱佛脚,只能靠天天用。所以这门课从 [Day 2](/blog/agent-60/day-02-python-for-backend-devs/) 开始就建议你拿 Coding Agent 一起写代码,[Day 55](/blog/agent-60/day-55-second-project-code-review-agent/) 再专门讲它的失败模式。

## 学历和年限

先说学历,因为这块我原来的印象是错的。

Boss 上截的那 7 个岗位里有 3 个写了硕士,我一度以为国内 Agent 岗普遍卡硕士。补了数据才发现是样本太小造成的错觉。Boss 列表 435 条里,写本科的占 80.5%,硕士 7.8%,博士 1.6%,大专和学历不限各 5% 左右;猎聘 140 条里本科 79.3%(其中一半多写的是「统招本科」),硕士 11.4%。有正文的 214 条里,正文提到硕士、博士或研究生的是 20 条,9%。所以明确卡硕士的大约一成,集中在大厂和偏算法的岗位,第一批大厂官网 120 条里就有 12 条提硕士。

海外几乎不提学历,美国 40 条里只有 1 条。

| 地区 | 年限要求的分布 / 中位数 | 提到硕士/博士的 |
| --- | --- | --- |
| 国内(Boss 435 条) | 3–5 年 31.5%、经验不限 23.9%、5–10 年 19.8%、1–3 年 14.3%、应届 7.1% | 列表写硕士/博士 9.4% |
| 国内(猎聘 140 条) | 3–5 年 43.6%、1–3 年 20.7%、经验不限 17.9%、5–10 年 15.7% | 列表写硕士/博士 12.1% |
| 新加坡 + 香港 | 中位数 4 年 | 13 / 75 |
| 海外远程 | 中位数 5 年 | 6 / 46 |
| 美国本土 | 中位数 5 年 | 1 / 40 |

国内主流是 3 到 5 年,海外中位数 5 年,美国的 Staff 岗动不动 8 年以上。

我的理解是:国内大厂筛简历的第一道关还是学历,卡硕士的那一成岗位,本科靠作品集很难翻过去,不如把时间花在剩下那九成上;海外看的是你干过什么。

还有个小细节:不少国内 JD 写「3 年以上 AI 应用经验」。这个领域真正火起来也就两三年,严格满足的人很少。招聘方心里也清楚,实际上看的是你有没有真东西可讲。工作里如果用 AI 做过落地,哪怕只是内部工具,都可以如实写进去。

## 薪资:能看到的数字和看不到的数字

国内的薪资是这次补数据之后变化最大的部分。第一批只有智联上 24 条带薪资,中位数折年约 24 万,那批基本是传统行业在招第一个 AI 工程师。Boss 和猎聘补进来 557 条带薪资的岗位之后,数字翻了一倍。

先说口径:我拿每条 JD 挂出来的月薪区间取中点,乘以薪数(没写的按 12 薪)折成年包。这是招聘方的报价,不是成交价,区间上沿一般要很强的人才拿得到。日薪的实习岗和「面议」不算。

| 国内(Boss + 猎聘,557 条) | P25 | 中位 | P75 |
| --- | --- | --- | --- |
| 全部 | 36 万 | **48 万** | 68 万 |
| 1–3 年 | 26 万 | 40 万 | 54 万 |
| 3–5 年 | 35 万 | 48 万 | 66 万 |
| 5–10 年 | 36 万 | 54 万 | 68 万 |
| 应届(多为大厂校招) | 38 万 | 45 万 | 54 万 |
| 经验不限 | 36 万 | 52 万 | 78 万 |

月薪区间中点的中位数是 35K。45% 的岗位年包中点在 50 万以上,15% 在 80 万以上,低于 30 万的占 18%。薪数最常见的是 12 薪(46%),然后是 15 薪、16 薪、14 薪。

分城市,上海最高,中位 54 万;深圳 48 万,北京 47 万,杭州 42 万。分公司规模(只看 Boss),万人以上的公司中位 57 万,1000 到 9999 人 56 万,100 到 499 人 48 万,20 到 99 人 39 万,20 人以下 36 万。学历上,写本科的岗位中位 52 万,写硕士的 60 万,博士只有 7 条,中位 96 万。

分平台看,Boss 中位 49 万,猎聘 42 万。猎聘的区间写得更保守,上沿拉得没那么高。

海外这边:

| 地区 | 有薪资的样本 | 中位数 | 范围 |
| --- | --- | --- | --- |
| 新加坡 | MyCareersFuture 29 条 | 月薪 SGD 7,500–10,000,年约 9–12 万新币 | SGD 3,000–21,667/月 |
| 香港 | 0 条 | 没有数据 | LinkedIn 上 23 条没一条写薪资 |
| 海外远程 | 8 条 | 年薪 $180K–$250K | $100K–$430K |
| 美国本土 | 26 条 | 年薪 $198K–$335K | $150K–$445K,另有股权 |

新加坡的中位数被中介和外包压低了。MyCareersFuture 上发帖的雇主一大半是外包和人力公司,TCS 的 LLM 岗月薪才 3,000–5,000 新币,Shopee 的 Agent 方向算法工程师就是 10,000–16,000。同一个城市,同样写着 Agent,差三倍。投之前先看雇主是谁。

美国的数字最好看,但基本都要求美国或加拿大的工作身份,对大多数读者是看得见摸不着的。

## 远程:比你想的窄得多

这是我这次最想提醒的一点。海外远程 46 条,按地域限制拆开:

| 限制 | 条数 |
| --- | --- |
| 限美国 / 加拿大 / 美洲 | 18 |
| 限欧洲或英国时区 | 6 |
| 限其他特定国家(印度、巴西、沙特、韩国等) | 8 |
| 没写清楚 | 11 |
| 明确写「全球任意地点」 | **3** |

46 条里只有 3 条是真正的全球远程,其中一条是 HN 上 Tether 的 AI Harness Engineer,另外两条在 We Work Remotely 上。还有不少 Ashby 上的岗位标着 remote-eligible,点进去地点写的是旧金山或纽约,我都算成了美国本土。

所以「在国内拿美国工资远程干活」这条路,对 Agent 岗来说存在,但非常窄。比较现实的几条路是:国内岗,新加坡或香港的岗位(要搬过去),或者以 contractor 身份接海外的活,价格通常比美国 band 低一截。别指望投几十份海外远程就能中,先把国内或新港的路走通。

## FDE:海外的大热门,国内刚冒头

在海外样本里翻的时候,我发现有一类岗位多到离谱:Forward Deployed Engineer,简称 FDE,还有它的近亲 Applied AI Architect、Agent Deployment Engineer。OpenAI、Anthropic、Palantir、Decagon、Ramp、Notion、ElevenLabs、Intercom、Stripe 都在招。美国本土样本里一半以上跟面向客户交付有关。

FDE 干的事,说白了就是带着自家的 Agent 平台住进客户那里,把客户的业务搞明白,把 Agent 配好、接好、调好,直到它真的在客户那儿跑起来。技术要扎实,还得能跟客户的业务人员聊明白需求。薪资一点都不低,Decagon 的 Agent Deployment Engineer 写的是 $175K–$230K,Ramp 的 FDE 是 $189K–$330K。

国内也开始有了。智联上这次抓到两条,一家山东公司招「FDE 专家(AI 应用与工程化方向)」,月薪 1.8–3.5 万;一家北京的数字科技集团招「AI 智能体(FDE)工程师」。百度也有数字人方向的 FDE。国内 JD 里更常见的说法是「对接业务部门」「把业务需求转化为可落地的系统能力」,本质是一回事。

如果你本来就是做 ToB 业务系统的,跟客户、产品、实施打过很多交道,FDE 可能是最适合你的入口。这门课 [Day 43](/blog/agent-60/day-43-capstone-kickoff/) 开题时会练「从客户需求拆到验收指标」,[Day 59](/blog/agent-60/day-59-job-search-salary/) 会单独讲怎么找这类岗位。

**国内为什么难招?** 一是要的能力组合太少见:技术要能自己写代码、接系统,还要听得懂业务、能面对客户、经常出差,会写代码的不愿意见客户,会见客户的技术又不够硬。二是国内 ToB 客户习惯把实施当成白送的服务,不少公司按「实施」「售前」的价钱招,技术强的人看不上,真正按资深工程师给钱的 FDE 很少(上面两条 1.8–3.5 万,对比美国 17.5–23 万美元年薪)。三是名字还没统一,很多人干的就是 FDE,只是 JD 不这么叫。

**「能做 FDE 的人大多去创业了」?** 一半对。FDE 每天练的正是创业最需要的:直接看到客户痛点、快速做出能用的东西、说服客户买单,Palantir 出来的人也确实创办了不少公司。但这里有幸存者偏差,大多数 FDE 还在打工,只是没人讲;创业还要启动资金、扛得住几年没收入、有销售渠道,这些 FDE 经历给不了。另外 FDE 常要驻场出差,纯远程的很少,想找远程工作的话要把这一点算进去。

## Boss 直聘上的 7 个岗位,一个个看

我先在 Boss 手机端截了 8 个 JD,第 8 个是纯前端(React + TypeScript),跟 Agent 没关系,我去掉了。剩下 7 个大多没截到公司名,按 A 到 G 编号。

**A,某公司的「软硬件服务 AI 转型」岗。** 要求 TS/Python/Java 任一门、全栈经验、复杂平台项目、熟练使用 Coding Agent,加分项是 K8s 和真实 Agent 开发经验,还欢迎校招。这是典型的「业务部门要上 AI」岗位,不卡学历、不卡 Python,看重的是你能不能把东西做出来并运营下去。老后端转型投这种最合适。

**B,Agent 平台基础能力岗。** 本科、5 年以上、精通 Python 和 FastAPI。职责里写着「Agent、Skill、工具调用、工作流、运行时等基础能力建设」,还要「跟进 MCP、Skills、Claude Code 等主流智能体开发方案并落地」。这个岗位要你懂原理,LangChain/LlamaIndex 要「理解底层原理」,还点名要能解决幻觉、逻辑循环、工具调用失败。5 年门槛偏高,但技术要求跟课程几乎完全重合。失败处理看 [Day 12](/blog/agent-60/day-12-failure-modes/),Skills 和框架原理看 [Day 27](/blog/agent-60/day-27-frameworks-compared/)。

**C,LLM Agent 系统开发岗。** 硕士以上,这一条就会挡掉很多人。但它的加分项有一句我很喜欢:「有完整的 Agent/LLM 应用项目经验(课程项目、个人项目或开源贡献均可)」。职责里还写了「Agent 评测与质量保障体系,建立效果度量与回归基准」。如果学历够,这个岗位跟课程是一一对应的,毕业项目直接能拿去讲。

**D,企业 AI 应用落地岗。** 硕士优先、3 年以上 AI 落地经验。这条 JD 是我觉得最「实在」的一条,每一句都是干过活的人才会写的:结构化输出、结果校验、异常兜底、对接数据平台和审批系统和企业协作工具、熟练 SQL,还要「基于评测、日志和线上反馈持续优化 Agent 的效果、稳定性、响应时长和成本」。加分项是企业知识问答、数据分析助手、智能客服。这几乎就是在描述这门课的毕业项目 SupportPilot,对接企业系统和 SQL 的部分在 [Day 46](/blog/agent-60/day-46-capstone-tools-mcp/)。

**E,小红书的软件工程方向 Agent 岗**(截图里露出了公司全称行吟信息科技)。做的是给工程师用的编码和设计 Agent,Multi-Agent 是核心。技术要求不算高,LangChain、RAG、MCP 这些,但它非常强调产品思维:「能够从工程师和业务视角出发,主动发现、定义研发流程中的效率瓶颈」「能清晰地向技术与非技术背景的同事阐述产品价值与技术方案」。这类岗位面试时你讲项目,一定要讲清楚用户是谁、解决了什么痛点,别只讲技术栈。

**F,AI 平台的 DevOps 和可观测岗。** 严格说不算 Agent 开发,更像给 Agent 团队做底座的 SRE:容器化、CI/CD、Terraform、Prometheus,外加「用 OpenTelemetry 实现分布式链路追踪,覆盖 API、AI 工作流、模型请求及工具调用」和「Token 使用量」监控。有运维或平台背景的人可以留意这类岗位,竞争比纯 Agent 开发小。可观测的入门在 [Day 34](/blog/agent-60/day-34-tracing-observability/)。

**G,某大型游戏公司的 Agent 岗**,只截到了加分项,但这一屏信息量最大。它要你能「说清框架的局限性和何时不用框架」,要 MCP Server 开发、Tracing、Agent 安全模型(Prompt Injection 防御、工具权限隔离、操作审计、最小权限)、Computer Use / Browser Use、日调用 10K+ 的大规模部署,还有一条很少见的「Agent 经济学:成本建模、ROI 计算、Agent vs 人工的决策框架」。最后一条是「对 Coding Agent(Claude Code/Cursor)有深入研究」。这条 JD 基本可以当作「高级 Agent 工程师」的能力清单来对照。安全看 [Day 39](/blog/agent-60/day-39-prompt-injection/),成本和 ROI 看 [Day 38](/blog/agent-60/day-38-cost-and-latency/)。

把这 7 个放一起看,国内 Agent 岗其实分成了几种:业务落地型(A、D)、平台基础能力型(B、C)、产品型(E)、底座运维型(F)和综合型(G)。你投之前最好先想清楚自己更像哪一种,简历按那个方向写。

## 新加坡和香港:清单式 JD,金融扎堆

新港这 75 条有点特别,它们夹在国内和美国中间。技术栈清单写得最全:RAG 84%、Prompt 71%、SQL 64%、向量库 52%、Agent 框架 60%,每一项都比国内和美国高。这里面有一部分原因是中介和外包公司喜欢把所有热门词都列上,真到面试不一定都问。

香港的岗位高度集中在金融和加密货币:OKX、Binance、Amber Group、RedotPay、Bullish、CoinDesk 都在招 Agent 或 chatbot 方向的 AI 工程师,另外就是咨询公司和大集团的 CEO 办公室。如果你对金融业务熟,香港是个值得看的方向,只是薪资这次一条都没抓到,只能靠面试时自己问。

## 如果你在找这类工作,我的建议

看完这几百条,我给想转 Agent 岗的朋友几条很具体的建议:

**评测一定要能讲出数字。** 准备一个「我的 Agent 从 X 分提到 Y 分」的完整故事:测试集怎么建的、judge 怎么写的、哪类错误最多、改了什么、分数怎么变的。这是两边 JD 的最大公约数。

**把 Harness 那一套搞懂。** 国内大厂现在最缺的是懂 Agent 运行时的人。手写过 Agent 循环、自己做过上下文压缩和断点恢复,面试时能接住一大片问题。

**每天用 Coding Agent,并且记下它犯过的错。** 面试官问「你怎么看 Claude Code 的 failure mode」,能举出三个自己踩过的具体例子,比背十条概念强。

**做一个真实落地的项目,最好能对接业务系统。** 一个带知识库、带业务工具、带审批、带评测、真部署上线的客服或数据助手,能同时命中 D、C、A 三类岗位的要求。

**投之前看清雇主和地域。** 新加坡外包和直招差三倍,海外远程九成以上限地区,国内大厂卡学历。别在注定过不去的岗位上浪费时间。

最后,把 JD 里的高频技能跟课程对一下,方便你按需跳着补:

| JD 里的要求 | 国内 / 海外出现比例 | 去哪天学 |
| --- | --- | --- |
| Python 工程能力 | 65% / 63% | [Day 2](/blog/agent-60/day-02-python-for-backend-devs/) |
| 大模型 API、Function Calling | 55% / 39% | [Day 3](/blog/agent-60/day-03-first-api-call/)、[Day 8](/blog/agent-60/day-08-function-calling/) |
| 手写 Agent 循环、失败处理 | (Harness 类岗位必问) | [Day 9](/blog/agent-60/day-09-agent-loop-from-scratch/)、[Day 12](/blog/agent-60/day-12-failure-modes/) |
| 结构化输出与校验 | (Boss D 点名) | [Day 6](/blog/agent-60/day-06-structured-output/) |
| 上下文工程 / 记忆 | 52% / 25% | [Day 20](/blog/agent-60/day-20-context-engineering-memory/) |
| RAG / 检索 / 重排序 | 51% / 54% | [Day 16](/blog/agent-60/day-16-first-rag/)、[Day 18](/blog/agent-60/day-18-retrieval-quality/) |
| 向量数据库 | 23% / 30% | [Day 17](/blog/agent-60/day-17-pgvector/) |
| MCP | 17% / 16% | [Day 22](/blog/agent-60/day-22-mcp-explained/)、[Day 23](/blog/agent-60/day-23-build-mcp-server/) |
| Agent 框架与原理 | 46% / 36% | [Day 24](/blog/agent-60/day-24-langgraph-basics/)、[Day 27](/blog/agent-60/day-27-frameworks-compared/) |
| 多 Agent | 37% / 22% | [Day 26](/blog/agent-60/day-26-multi-agent/) |
| 评测 | 48% / 62% | [Day 29](/blog/agent-60/day-29-why-evals/) 到 [Day 35](/blog/agent-60/day-35-week5-review-eval-ci/) |
| 可观测 / Tracing / OpenTelemetry | 21% / 31% | [Day 34](/blog/agent-60/day-34-tracing-observability/) |
| 服务化与部署 | 39% / 53% | [Day 36](/blog/agent-60/day-36-agent-as-service/)、[Day 41](/blog/agent-60/day-41-deploy/) |
| 成本、延迟、ROI | 31% / 39% | [Day 38](/blog/agent-60/day-38-cost-and-latency/) |
| 安全(注入、权限、沙箱) | 11% / 22% | [Day 39](/blog/agent-60/day-39-prompt-injection/)、[Day 40](/blog/agent-60/day-40-permissions-sandbox/) |
| 对接企业系统、SQL | 31% / 41% | [Day 46](/blog/agent-60/day-46-capstone-tools-mcp/) |
| 熟练用 Coding Agent | 21% / 15% | [Day 2](/blog/agent-60/day-02-python-for-backend-devs/)、[Day 55](/blog/agent-60/day-55-second-project-code-review-agent/) |
| 面向客户、FDE | 33% / 46% | [Day 43](/blog/agent-60/day-43-capstone-kickoff/)、[Day 59](/blog/agent-60/day-59-job-search-salary/) |
| 微调(LoRA、SFT) | 23% / 19% | 不在主线,[Day 60](/blog/agent-60/day-60-graduation/) 给进阶路径 |
| 简历与面试 | | [Day 56](/blog/agent-60/day-56-resume/)、[Day 57](/blog/agent-60/day-57-interview-fundamentals/)、[Day 58](/blog/agent-60/day-58-interview-system-design/) |

微调我是故意没放进主线的。国内 23% 的 JD 提到了,中小公司常写「独立做过一次轻量微调」,但它在 Agent 岗里多半是加分项,两个月里优先级排不上。

## 怎么用这份数据

原始数据在网站仓库的 `docs/jd-research/` 下面:`jds.json` 是全部 880 条记录,每条有平台、公司、职位、地点、薪资、年限、学历、匹配到的技能、链接、抓取日期和 JD 正文前 4000 字(Boss 只有 74 条有正文);`boss.json` 和 `liepin.json` 是两个平台的原始抓取结果;`summary.md` 是统计表;`boss-screenshots.md` 是 Boss 截图的转录。

我自己用它的方式是这样的:先按你想去的地区把 JD 筛出来,挑二三十条跟你背景最接近的,通读一遍原文,把反复出现的词圈出来,再跟自己的简历对。比看任何统计图都有用。

JD 变化很快,这份数据是 2026 年 10 月 12 日抓的,过三个月就该重抓一次。

下面是十条样本的原始链接,抓取当天都能打开(LinkedIn 等需要登录的没放):

1. 腾讯 · Agent Harness 工程师:<http://careers.tencent.com/jobdesc.html?postId=2098332758412804096>
2. 美团 · Agent Harness 工程师:<https://zhaopin.meituan.com/web/position/detail?jobUnionId=4654932817>
3. 字节跳动 · Agent Harness 工程师(AI 数据与安全):<https://jobs.bytedance.com/society/position/7651517511770818869/detail>
4. 智联 · 山东恒远智能 · FDE 专家(AI 应用与工程化方向),1.8–3.5 万:<https://www.zhaopin.com/jobdetail/CC466107580J40878467211.htm>
5. 智联 · 外企德科 · AI 大模型应用开发工程师,2.5–5 万·16 薪:<https://www.zhaopin.com/jobdetail/CC138117190J40902547605.htm>
6. MyCareersFuture · Shopee · AI Engineer(Agentic Commerce 方向),SGD 10,000–16,000/月:<https://www.mycareersfuture.gov.sg/job/2fd52f33c4b2abe6dd2bbf234c97f495>
7. Decagon · Agent Deployment Engineer,$175K–$230K:<https://jobs.ashbyhq.com/decagon/8c40fb7a-5f25-4112-a1df-f1c22b81042c>
8. Anthropic · Forward Deployed Engineer(伦敦):<https://job-boards.greenhouse.io/anthropic/jobs/5423029008>
9. OpenAI · AI Systems Engineer, Codex Agents,$230K–$385K:<https://jobs.ashbyhq.com/openai/de06790a-7243-4e33-a6f1-e7bd34009588>
10. Remote OK · Sticker Mule · AI agent engineer(远程),$150K–$250K:<https://remoteOK.com/remote-jobs/remote-ai-agent-engineer-sticker-mule-1137399>

如果你手上有别的平台的 JD,尤其是拉勾、前程无忧这些我抓不到的,欢迎在下面留言或者把截图发我,下次更新时一起加进来。
