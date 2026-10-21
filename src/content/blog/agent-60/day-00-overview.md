---
title: 'Day 0 · 开学第一课：AI Agent 工程师做什么、两个月怎么学'
description: '先把岗位看清楚：Agent 工程师每天在干什么、招聘方要什么、2026 年大概能拿多少钱。然后是这 60 天的地图、开课前要装的东西、整门课大概花多少 API 费用，以及两个月能做到和做不到的事。'
pubDate: 2026-10-12
regime: none
tags: ['career', 'roadmap', 'setup', 'agent-60']
series: 'agent-60'
day: 0
lang: 'zh'
---

## 今天要解决的问题

今天不写 Agent，先把方向对准。读完这一篇，你应该能做到这几件事：

1. 用两三句话跟朋友解释「AI Agent 工程师」是干什么的，和算法工程师、AI 产品经理、「AI 训练师」分别差在哪。
2. 打开一份招聘 JD，能看出它是真的 Agent 开发岗，还是挂名的客服岗、标注岗。
3. 知道这 60 天每周学什么、最后交出什么作品。
4. 把开发环境和 API 账号准备好，并且心里有数：整门课大概花多少钱。

预计用时：2 到 3 小时。其中一半时间花在「准备工作」那一节，装软件、注册账号、充值。

前置：会用至少一门编程语言写过真实项目（Java、Go、JS、PHP、C# 都行），会用命令行和 git。不需要会 Python，Day 2 会补；不需要懂机器学习，这门课不教。

## 这个岗位到底在干什么

先说一个我身边很常见的场景。一家做 SaaS 的公司，客服每天收几百张工单：「为什么我被扣了两次钱」「发票抬头怎么改」「导出报表时报错 E1023」。以前的做法是客服挨个看、去后台查订单、去帮助中心翻文档、再写回复。

Agent 工程师要做的，是写一个程序让大模型来干这件事。程序把工单交给模型，模型判断这是计费问题，于是调用「查订单」这个工具，拿到两条扣款记录，再调用「查退款政策」从知识库里检索出相关条款，最后起草一封回复，附上政策出处。如果需要退款，就停下来等客服点「批准」。

这里面模型只负责「想」：理解问题、决定下一步调用哪个工具、组织语言。真正去数据库查数据、去知识库检索、去执行退款的，全是你写的代码。所以这个岗位本质上是**后端工程 + 大模型**，不是做模型本身。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="Agent 工程师负责的系统：模型在中间做决策，左边是输入，右边是工程师写的工具和数据">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
<rect x="20" y="95" width="120" height="70" rx="6" fill="none" stroke="var(--rule)"/>
<text x="80" y="125" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">用户 / 工单</text>
<text x="80" y="145" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">「被扣了两次钱」</text>
<rect x="210" y="80" width="170" height="100" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="295" y="110" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">大模型</text>
<text x="295" y="132" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">理解问题</text>
<text x="295" y="150" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">决定调哪个工具</text>
<text x="295" y="168" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">组织回复</text>
<rect x="450" y="30" width="170" height="44" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="535" y="57" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">查订单 / 查账单</text>
<rect x="450" y="108" width="170" height="44" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="535" y="135" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">知识库检索 (RAG)</text>
<rect x="450" y="186" width="170" height="44" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="535" y="213" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">退款 (需人工批准)</text>
<line x1="140" y1="130" x2="210" y2="130" stroke="var(--ink-soft)" stroke-width="1.5"/>
<line x1="380" y1="110" x2="450" y2="52" stroke="var(--ink-soft)" stroke-width="1.5"/>
<line x1="380" y1="130" x2="450" y2="130" stroke="var(--ink-soft)" stroke-width="1.5"/>
<line x1="380" y1="150" x2="450" y2="208" stroke="var(--ink-soft)" stroke-width="1.5"/>
<text x="295" y="225" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">蓝色 = 模型侧　琥珀 = 你写的代码和外部系统</text>
</svg>
<figcaption>一个客服工单 Agent 的骨架。模型只做决策，琥珀色的部分全部是工程师写的代码，这也是这门课大部分时间在练的东西。</figcaption>
</figure>

把日常工作拆开看，一个 Agent 工程师一周里大概会做这些事：设计工具（函数签名、描述、返回值怎么写模型才用得对）；写和调提示词；接知识库，做检索；用 LangGraph 之类的框架把流程编排起来；写 MCP server 把公司内部系统暴露给模型；建评测集，改一个提示词之后跑一遍看分数涨了还是跌了；看线上 trace，找出 Agent 在哪一步犯傻；控制成本和延迟；防 prompt injection，给危险操作加人工确认。

你会发现里面没有「训练模型」。确实没有。绝大多数公司用的是 DeepSeek、通义千问、Claude、GPT 这些现成模型的 API，最多做点轻量微调。会训模型的人有，但那是另一个岗位，门槛和人数都差一个量级。

### 和几个相近岗位的区别

招聘网站上带「AI」「Agent」「大模型」字样的岗位很多，名字很乱。我按实际干的活分成四类：

| 岗位 | 实际在干什么 | 要不要写代码 | 和这门课的关系 |
| --- | --- | --- | --- |
| Agent 工程师 / 大模型应用工程师 / LLM 应用开发 | 用现成模型搭系统，工具、RAG、编排、评测、上线 | 大量写 | 就是这门课的目标 |
| 算法工程师（大模型方向） | 训练、微调、对齐、做模型评测基准 | 大量写，偏研究 | 不教，门槛通常要求硕博 |
| AI 产品经理 / Agent 产品经理 | 定义场景、设计流程、定指标 | 很少 | 能用到一部分（评测、流程设计） |
| 「AI 训练师」/ 数据标注 | 给模型打分、写示范答案 | 不写 | 无关 |

**具身智能 / 机器人是另一条线。** 2026 年 Hugging Face 旗下 Pollen Robotics 的开源机器鸭 Microduck(25 厘米、15 个舵机、瑞芯微 RK3566 主控、售价 399 美元)很火,国内有人手搓复刻。它的「智能」是在 MuJoCo 仿真里用强化学习(PPO)训练出走路策略,再迁移到实机(sim2real),和这门课的 Agent(调用大模型 + 工具)是两套技术栈。招人的是机器人、硬件公司,要的是控制、仿真、强化学习和嵌入式。当爱好玩很好,但别把它当成 Agent 求职的作品。

还有一种要小心：标题写「AI Agent」，打开 JD 一看是「负责用 AI 工具回复客户咨询」或者「运营智能客服后台配置」。这是客服岗或运营岗。判断方法很简单，看 JD 里有没有出现 Python、API、RAG、function calling、LangChain/LangGraph、评测这类词。一个都没有的，基本就不是开发岗。

### 招聘方到底要什么

为了不凭印象说话，这门课开课前做了一次 JD 调研：2026 年 10 月 12 日一共抓了 **880 条**真实的 Agent 相关岗位。国内 695 条，来自字节、腾讯、百度、网易、美团、京东的招聘官网，智联招聘，V2EX，以及登录后抓取的 Boss 直聘 435 条和猎聘 140 条；海外 185 条（新加坡 52、香港 23、海外远程 46、美国本土 40、其他地区 24，来自 LinkedIn、Hacker News 招聘帖、新加坡政府职位库 MyCareersFuture，以及 OpenAI、Anthropic、Sierra、LangChain 等公司的公开招聘接口）。完整的拆解单独写成了一篇：[880 条真实 JD 拆解](/blog/agent-jd-report-2026-10/)。

技能比例只能算有正文的 JD：国内 334 条（大厂官网为主的 120 条，加上 Boss 和猎聘有正文的 214 条），海外 185 条。比例是用关键词匹配 JD 全文统计的，不是人工逐条标注，所以差几个百分点不说明问题，看大的差距就行。

| 技能 | 国内 | 海外 |
| --- | --- | --- |
| Python | 65% | 63% |
| LLM API / 工具调用 | 55% | 39% |
| 上下文工程 / 记忆 | 52% | 25% |
| RAG / 检索 | 51% | 54% |
| 评测 Eval | 48% | 62% |
| Agent 框架（LangChain、LangGraph 等） | 46% | 36% |
| Prompt 工程 | 46% | 46% |
| 部署（Docker / K8s / 云） | 39% | 53% |
| 多 Agent | 37% | 22% |
| SQL / 数据系统 | 31% | 41% |
| Java | 23% | 10% |
| Go | 23% | 14% |
| 熟练使用 Coding Agent（Claude Code、Cursor、Codex） | 21% | 15% |
| 可观测 / Tracing | 21% | 31% |
| MCP | 17% | 16% |

我从这份数据里读出来几件事。

**评测是国内外共同的门槛。** 国内 48%、海外 62% 的 JD 提到评测，国内大厂更高（56%）。腾讯一个 Agent Harness 岗位要求「每次 Prompt、模型、工具变更都有量化的收益与回归判定」，智联上一家郑州的公司要求候选人「能讲清上线后效果指标是多少、是怎么测出来的」。这门课 W5 整整一周讲评测，原因就在这。

**国内更看重 Agent 内部机制。** 上下文工程（52% 对 25%）、多 Agent（37% 对 22%）、工具调用（55% 对 39%），国内的比例都明显高于海外，大厂尤其明显。腾讯、美团、百度、字节好几个岗位的标题直接就叫「Agent Harness」「Agent Infra」。MCP 两边差不多，都在 16% 到 17%。海外的 JD 写得更抽象，更强调你能不能把东西交付上线、能不能和客户一起落地。

**真实上线经验比框架名字值钱。** 海外几乎每条都写「shipped to production」，国内中小公司常写「至少 1 个已上线的大模型应用项目，本人承担主要开发」。所以毕业项目要真的部署上线，不能只停留在本地 demo。

**会用 Coding Agent 已经是明确要求。** 国内 21% 的 JD（大厂是 26%）点名要熟练使用 Claude Code、Cursor 或 Codex，有的还写了「能把控生成代码的质量」，比海外的比例还高。Day 2 会专门讲怎么用它们学和写代码、怎么审查它们写出来的东西。

**门槛结构。** 国内主流要求 3 到 5 年（Boss 上占 31.5%，猎聘上占 43.6%）。学历上八成写本科，明确写硕士或博士的大约一成（Boss 列表 9.4%，猎聘 12.1%），集中在大厂和偏算法的岗位。海外年限中位数是 5 年，学历基本不提。

这份清单就是这门课的骨架。60 天里每一项都会动手做一遍，最后用一个毕业项目把它们串起来。

## 2026 年大概能拿多少钱

还是用同一次调研的数据。国内的数字来自 Boss 直聘和猎聘上 557 条带薪资的岗位：拿每条挂出来的月薪区间取中点，乘以薪数（没写按 12 薪）折成年包。这是招聘方的报价，不是成交价，区间上沿一般要很强的人才拿得到。

| 国内（Boss + 猎聘，557 条） | P25 | 中位 | P75 |
| --- | --- | --- | --- |
| 全部 | 36 万 | **48 万** | 68 万 |
| 1–3 年 | 26 万 | 40 万 | 54 万 |
| 3–5 年 | 35 万 | 48 万 | 66 万 |
| 5–10 年 | 36 万 | 54 万 | 68 万 |

分城市，上海中位 54 万，深圳 48 万，北京 47 万，杭州 42 万。公司越大给得越多，万人以上的公司中位 57 万，20 人以下的 36 万。

海外的数字：

| 地区 | 有薪资的样本 | 中位数 | 范围 |
| --- | --- | --- | --- |
| 新加坡 | MyCareersFuture 29 条 | 月薪 7,500–10,000 新币（年约 9–12 万新币） | 月薪 3,000–21,667 新币 |
| 香港 | LinkedIn 23 条，没有一条写薪资 | 无数据 | |
| 海外远程 | 8 条 | 年薪 18 万–25 万美元 | 10 万–43 万美元 |
| 美国本土 | 26 条 | 年薪 19.8 万–33.5 万美元 | 15 万–44.5 万美元（另有股权） |

这两张表有几处一定要读对。

国内一开始我只抓到智联上 24 条带薪资的，中位数折年才 24 万，那批大多是传统行业在招第一个 AI 工程师。补上 Boss 和猎聘之后，中位数翻了一倍。所以别拿某一个平台、某几条 JD 就下结论。大厂官网不写薪资，大厂的行情最靠谱的是问在里面的朋友。

新加坡的样本里外包和中介公司很多，所以中位数偏低。同在新加坡，TCS 的 LLM 岗月薪 3,000–5,000 新币，Shopee 的 Agent 方向岗位是 10,000–16,000，差了三倍。

海外远程的高薪看着诱人，但要看清限制：46 条远程岗里，限美国、加拿大或美洲的 18 条，限欧洲时区的 6 条，限其他特定国家的 8 条，没写清的 11 条，**明确写「全球任意地点都可以」的只有 3 条**。对身在中国境内的人来说，能拿美国薪资的远程 Agent 岗非常少。现实的路径是国内岗、新加坡或香港的岗位，或者以 contractor 身份接海外项目。

大的趋势有公开报告佐证。脉脉 2026 年 5 月发布的《2026 春招职场洞察报告》说，今年 1 到 4 月 AI 岗位新发量同比涨了 8.7 倍，新经济行业整体平均月薪 4.96 万元（这是所有新经济岗位的平均，不是 Agent 岗单独的数）。这些只能说明方向，不能直接拿来当你的报价。你最终能拿多少，更多取决于你原来的级别和城市，Agent 能力是在这个基础上往上加的部分。

## 这 60 天怎么安排

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="60 天课程地图：W1 到 W9 各周主题和小项目">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
<text x="20" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">周　　主题　　　　　　　　　　　　　 小项目（最后拼进毕业项目）</text>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="40" width="40" height="22" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="40" y="56" text-anchor="middle" fill="var(--ink)">W1</text>
<text x="72" y="56" fill="var(--ink)">大模型与 API</text><text x="300" y="56" fill="var(--ink-soft)">命令行聊天机器人（流式 + 成本统计）</text>
<rect x="20" y="68" width="40" height="22" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="40" y="84" text-anchor="middle" fill="var(--ink)">W2</text>
<text x="72" y="84" fill="var(--ink)">工具调用与 Agent 循环</text><text x="300" y="84" fill="var(--ink-soft)">手写循环的命令行 Agent</text>
<rect x="20" y="96" width="40" height="22" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="40" y="112" text-anchor="middle" fill="var(--ink)">W3</text>
<text x="72" y="112" fill="var(--ink)">上下文工程与 RAG</text><text x="300" y="112" fill="var(--ink-soft)">带引用出处的文档问答</text>
<rect x="20" y="124" width="40" height="22" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="40" y="140" text-anchor="middle" fill="var(--ink)">W4</text>
<text x="72" y="140" fill="var(--ink)">MCP、LangGraph、多 Agent</text><text x="300" y="140" fill="var(--ink-soft)">工单分流 Agent</text>
<rect x="20" y="152" width="40" height="22" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="40" y="168" text-anchor="middle" fill="var(--ink)">W5</text>
<text x="72" y="168" fill="var(--ink)">评测与可观测</text><text x="300" y="168" fill="var(--ink-soft)">评测集 + CI 回归门禁</text>
<rect x="20" y="180" width="40" height="22" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="40" y="196" text-anchor="middle" fill="var(--ink)">W6</text>
<text x="72" y="196" fill="var(--ink)">生产化：服务、安全、部署</text><text x="300" y="196" fill="var(--ink-soft)">部署成公网服务</text>
<rect x="20" y="208" width="40" height="50" rx="3" fill="var(--compute)" stroke="var(--compute)"/><text x="40" y="238" text-anchor="middle" fill="var(--paper-raised)">W7-8</text>
<text x="72" y="228" fill="var(--ink)">毕业项目 SupportPilot</text><text x="300" y="228" fill="var(--ink-soft)">智能客服工单 Agent，完整上线</text>
<text x="72" y="248" fill="var(--ink-faint)">Day 43–54</text><text x="300" y="248" fill="var(--ink-faint)">RAG + MCP + LangGraph + 评测 + 部署</text>
<rect x="20" y="264" width="40" height="22" rx="3" fill="none" stroke="var(--rule)"/><text x="40" y="280" text-anchor="middle" fill="var(--ink)">W9</text>
<text x="72" y="280" fill="var(--ink)">第二作品 + 简历 + 面试</text><text x="300" y="280" fill="var(--ink-soft)">代码审查 Agent（选做）</text>
</g>
</svg>
<figcaption>60 天课程地图。前四周（蓝）学会搭 Agent，后两周（琥珀）学会让它可靠、能上线，W7–8 做毕业项目，最后一周准备求职。</figcaption>
</figure>

整门课按周组织，每周最后一天是复习日，复习日会给出这一周小项目的完整代码。小项目不是一次性的练习，它们会一块一块地拼进毕业项目里：W1 的模型客户端封装、W2 的 Agent 循环、W3 的知识库检索、W4 的 MCP 工具和工作流、W5 的评测、W6 的服务和部署。到了 W7 你不是从零开始，而是把前六周的零件组装、加固、包装。

毕业项目叫 SupportPilot，是给一家虚构的 SaaS 公司「云簿 CloudLedger」做的智能客服工单 Agent。选这个题有私心：客服、工单、知识库是国内 Agent 招聘里出现最多的落地场景，面试官一听就懂，而且它天然能把 RAG、工具调用、人工审批、评测全部用上。数据全部是自己造的，不涉及任何真实公司。

最后一周讲简历、面试题和找工作的渠道。另外给一个可选的第二作品，代码审查 Agent，一天能做出能用的版本。

## 每天怎么用这个站

每篇文章的结构都一样，建议按这个顺序走：

先读「今天要解决的问题」，知道今天的终点在哪。然后读正文，正文里嵌的视频不用全看，图注里会写看哪一段。接着做「动手练习」，这是一天里最重要的部分，**代码一定要自己敲一遍跑起来**，不要复制粘贴完就算了。我见过太多人看了三十个小时教程视频，面试让手写一个 Agent 循环写不出来。最后做「自测」，答案折叠着，先自己写再展开。

「学习资料」那一节是给有余力的人的：官方文档、B 站视频、其他经典视频、书、开源项目，每条都写了看哪部分、花多久。时间紧的话只看标了「必看」的。

这门课没有规定每天学几小时。有空就多学，没空就少学。但我的建议是每天至少写一点代码，哪怕半小时。连续性比单次时长重要。

关于「两个月」：如果你每天能投入四五个小时，两个月学完是现实的。如果只有周末，按自己的节奏走，三四个月学完也完全没问题，内容不会过期得那么快（虽然这个领域确实变得很快，每篇我都尽量写 2026 年的现状）。

## 准备工作

### 软件

需要装的东西不多：

- **uv**：Python 的项目和依赖管理工具，比 pip + venv 快很多，现在新项目基本都用它。装好 uv 之后它会帮你装 Python，不用另外去官网下。
- **Git** 和一个 GitHub 账号：作品最后要放在 GitHub 上给面试官看。
- **编辑器**：VS Code、Cursor、Zed 都行。装上 Python 插件。
- **Docker Desktop**：W3 跑 pgvector、W5 跑 Langfuse、W6 部署都要用。现在可以先不装，W3 之前装好就行。

### API 账号

这门课的代码默认用 **DeepSeek** 的 API。原因很实际：国内直接能连，不用代理；价格低；兼容 OpenAI 的接口格式，支持工具调用和 JSON 输出，整门课需要的能力都有。同一份代码改三个环境变量就能换成通义千问、Kimi、智谱、OpenAI 或者 Claude，Day 3 会专门讲怎么切。

具体步骤：

1. 打开 **platform.deepseek.com**（开放平台，和聊天用的 chat.deepseek.com 不是一个地方，账号通用），手机号登录。
2. 左侧菜单点「API keys」，再点「创建 API key」，名字随便起，比如 `agent-60`。
3. 弹出来那串 `sk-` 开头的字符**只显示这一次**，马上复制存好。关掉就看不到了，丢了只能删掉重建。
4. 左侧点「充值」，用支付宝或微信先充 10 到 20 元。**不充值调用会直接报 402**，下面动手练习会讲。

这个 key 等于你的钱包密码，**不要贴进代码、不要发到群里、不要提交到 git**。待会儿我们把它放进 `.env` 文件里。

如果你在海外，或者公司给报销，也可以同时开一个 Claude 或 OpenAI 的账号做对比。不是必须的。

### 整门课花多少钱

按 2026 年 10 月 DeepSeek 官方价格页查到的价格，默认模型 `deepseek-flash` 在高峰时段是输入每百万 token 2 元（缓存未命中）、输出每百万 token 8 元，空闲时段（北京时间工作日 9–12 点、14–18 点以外）再打对折。

我们按一个偏高的学习强度估算：每天跑 200 次调用，每次平均输入 3,000 token、输出 500 token。

- 每天输入：200 × 3,000 = 60 万 token；输出：200 × 500 = 10 万 token。
- 60 天合计：输入 3,600 万，输出 600 万。
- 全按高峰价算：36 × 2 + 6 × 8 = 72 + 48 = 120 元。

再加上 W3 的 embedding 调用、W5 跑评测（评测会把同一批用例反复跑很多遍，是最费钱的阶段），整门课的 API 花费大概在 100 到 300 元之间。晚上学习的话走空闲价，还能再省一半。如果你换成 Claude Sonnet 这类国外的旗舰模型，价格要高一个数量级，所以日常练习用便宜模型，只在需要对比效果时再换。

## 诚实地说，两个月能做到什么

能做到的：独立搭一个带工具调用、知识库、工作流、评测、可观测、部署上线的 Agent 系统；能把它讲清楚，包括为什么这么设计、数据怎么样、踩过什么坑；能应付大部分 Agent 岗的技术面试；手上有一个能在线演示的毕业项目和一篇技术博客。

做不到的：两个月不会让你变成五年经验的资深工程师。如果你原来是两年经验的后端，学完之后投的是「两年后端 + Agent 项目经验」的岗位，薪资会比纯后端好，但别指望直接拿资深的包。如果原来已经是五年以上的后端或者有带人经历，这门课补上的是 AI 这块拼图，有机会直接按原级别转过去。

学历和年限也是硬约束。调研里国内约十分之一的 JD 写明要硕士，这类岗位本科靠作品集很难绕过去，与其硬碰，不如优先投不卡学历的。国内主流要求 3 到 5 年这件事也提醒你：完全没有工作经验的应届生，光靠这门课去投社招岗会比较吃力，更适合走校招或者实习。

还有一点：薪资的上限更多取决于你**原来的工程能力**，而不是你会不会用 LangGraph。面试官最终在看的是「这个人能不能把一个不靠谱的模型做成一个靠谱的系统」。这门课后半段花大量篇幅讲评测、可观测、安全、成本，原因就在这里。只会调 API 搭 demo 的人很多，能把 Agent 稳定跑在生产环境的人少。

## 动手练习

今天的练习是把环境准备好，并且确认能连上 API。

**第 1 步：装 uv。**

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh
# Windows (PowerShell)
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

# 装好后重开终端
uv --version
uv python install 3.12
```

**第 2 步：建课程仓库。**

```bash
mkdir agent-60-lab && cd agent-60-lab
git init
uv init --python 3.12
uv add openai python-dotenv
```

`uv init` 后面**别加 `--package` 或 `--lib`**。加了的话 uv 会按「要发布的 Python 包」来建，多出一个 `src/agent_60_lab/` 目录，`pyproject.toml` 里也会多出 `[project.scripts]` 和 `[build-system]` 两段。这门课的代码是平铺的（`w1/ask.py`、`common/llm.py` 这样），用不上那套结构。已经建成这样也没关系，把 `src` 目录和那两段配置删掉就行。

建完看一眼目录，大概是这几个文件：`pyproject.toml`、`.python-version`、`README.md`、`uv.lock`、`.venv/`，普通的 `uv init` 还会给一个 `main.py`。网上旧教程里说的 `hello.py` 是老版本 uv 的叫法，现在叫 `main.py`，是同一个东西。如果你的目录里两个都没有，自己新建一个 `main.py` 就行。

顺手检查一下 `pyproject.toml` 里的 `authors`：uv 会从你电脑上 git 的全局配置里读名字和邮箱。如果那是公司邮箱，而这个仓库以后要放到你自己的 GitHub 上，在这个目录里改成个人的：

```bash
git config user.email 你的个人邮箱
```

然后把 `pyproject.toml` 里那一行邮箱也手动改掉。

**第 3 步：写 `.env`，并让 git 忽略它。**

`.env` **不会自动生成**，任何工具都不会替你建，因为里面是你自己的 key。在项目根目录新建一个文件，名字就叫 `.env`（前面有个点，没有扩展名），内容：

```bash
# agent-60-lab/.env
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=sk-你的key
LLM_MODEL=deepseek-flash
```

建好以后在 Finder 里可能看不见它：以点开头的文件在 macOS 上默认隐藏，按 `Cmd + Shift + .` 就能显示，终端里用 `ls -a`。编辑器的文件树一般能直接看到。

然后让 git 忽略它。新一点的 uv 有时不会生成 `.gitignore`，没有就自己建一个，至少写这几行：

```bash
# agent-60-lab/.gitignore
.env
.env.*
!.env.example
.venv/
__pycache__/
.DS_Store
```

检查一下有没有生效：

```bash
git check-ignore -v .env   # 打印出 .gitignore 的那一行，说明 .env 已经被忽略
git status                 # 待提交列表里不应该出现 .env
```

习惯上还会建一个 `.env.example`，内容和 `.env` 一样，只是 key 换成占位符 `sk-你的key`。它可以提交到 git，别人拿到你的仓库照着填就行。

**第 4 步：第一次调用。**

把 `main.py` 的内容换成下面这段（文件叫什么不重要，叫 `hello.py` 也一样，运行时对上名字就行）：

```python
# agent-60-lab/main.py
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
resp = client.chat.completions.create(
    model=os.environ["LLM_MODEL"],
    messages=[{"role": "user", "content": "用一句话介绍你自己"}],
    # DeepSeek 默认开思考模式，练习阶段关掉，更快更省
    extra_body={"thinking": {"type": "disabled"}},
)
print(resp.choices[0].message.content)
print(resp.usage)
```

<div class="line-notes">

- `import os` 只用它一样东西:`os.environ`,也就是当前进程的环境变量。后面三个配置都从这里读。
- `from dotenv import load_dotenv` 装的包叫 `python-dotenv`,import 的时候名字是 `dotenv`,两者对不上很正常,别以为装错了。
- `from openai import OpenAI` OpenAI 官方 SDK。DeepSeek 兼容同一套接口协议,所以换个 `base_url` 就能连 DeepSeek,不用另装 SDK。
- `load_dotenv()` 读 `.env`,把里面每行 `KEY=值` 塞进环境变量。实测:调用前 `"LLM_BASE_URL" in os.environ` 是 `False`,调用后变成 `True`,函数本身返回 `True`,表示找到并读到了文件。它默认从 `main.py` 所在目录开始往上一级一级找 `.env`。
- `client = OpenAI(base_url=os.environ["LLM_BASE_URL"]` 建一个客户端,只是把地址和 key 存起来,这一行还不会发请求。实测 `client.base_url` 是 `https://api.deepseek.com`。用方括号 `os.environ["..."]` 取值,没配置就立刻报 `KeyError: 'LLM_BASE_URL'`,对应下面报错表的第三行。
- `resp = client.chat.completions.create(` 这一行才真正发出一次 HTTP POST,地址是 `{base_url}/chat/completions`。它是同步调用,模型回完之前程序就停在这里等。实测返回对象的类型是 `ChatCompletion`。
- `model=os.environ["LLM_MODEL"],` 模型名也从 `.env` 读,实测值是 `deepseek-flash`。换厂商只改 `.env`,不动代码。
- `messages=[{"role": "user", "content": "用一句话介绍你自己"}],` 对话历史是一个列表,每条消息是一个 dict,带 `role`(谁说的)和 `content`(说了什么)。这里只有一条用户消息,Day 4 会往里加 system 和多轮对话。
- `extra_body={"thinking": {"type": "disabled"}},` SDK 不认识的参数放进 `extra_body`,会原样合并进请求 JSON。这里用它关掉 DeepSeek 的思考模式。
- `print(resp.choices[0].message.content)` `choices` 是一个列表,默认只有 1 个候选,所以取 `[0]`。实测 `len(resp.choices) == 1`,`finish_reason` 是 `"stop"`(模型自己说完了,没被截断)。这次实跑打印出:`我是DeepSeek，由深度求索公司创造的AI助手，致力于用热情细腻的方式帮助你探索世界、解决问题。`
- `print(resp.usage)` 这次实跑:`completion_tokens=25, prompt_tokens=8, total_tokens=33`,`prompt_cache_hit_tokens=0, prompt_cache_miss_tokens=8`。按输入 2 元、输出 8 元每百万 token 计:`8 × 2 / 1_000_000 + 25 × 8 / 1_000_000 = 0.000216` 元。

</div>

```bash
uv run main.py
```

我自己跑出来是这样的（模型每次措辞会不一样）：

```text
我是DeepSeek，一个由深度求索公司创造的AI助手，随时准备用热情而细腻的方式帮你解答问题、处理任务！
CompletionUsage(completion_tokens=29, prompt_tokens=8, total_tokens=37, ..., prompt_cache_hit_tokens=0, prompt_cache_miss_tokens=8)
```

第二行是这次请求的账单：你的问题占了 8 个 token，回答用了 29 个。按上面的价格算，8 × 2 ÷ 100 万 + 29 × 8 ÷ 100 万，大约 0.00025 元。充 10 块够跑四万次这样的请求。`prompt_cache_miss_tokens` 是没命中缓存、按全价算的输入，Day 38 讲缓存的时候会再碰到它。

第一次跑最常见的几个报错，对着查：

| 报错 | 原因 | 怎么办 |
| --- | --- | --- |
| `Error code: 402 ... Insufficient Balance` | 账户没钱。说明 key 和代码都对了，请求已经到了 DeepSeek | 去开放平台「充值」，充完马上能用 |
| `Error code: 401` | key 不对，或者复制时多了空格、少了字符 | 回平台重新建一个 key，整串复制 |
| `KeyError: 'LLM_BASE_URL'` | 没读到 `.env`：文件没建、名字写错（比如 `env`、`.env.txt`），或者不在当前目录 | 确认 `.env` 在你执行 `uv run` 的那个目录里 |
| `ModuleNotFoundError: No module named 'openai'` | 依赖没装，或者没用 `uv run` 而是直接 `python` | 先 `uv add openai python-dotenv`，再用 `uv run` 跑 |
| `Connection error` / 超时 | 网络问题。DeepSeek 国内能直连，开了全局代理反而可能出问题 | 关掉代理试试；用国外厂商时则相反，要开代理 |

如果你用的不是 DeepSeek，把 `extra_body` 那一行删掉（别家不认这个参数，可能报 400），再改 `.env` 里的三个值就行。

**第 5 步：写一份自己的岗位笔记。** 这一步不写代码，是给自己定个靶子。去 Boss 直聘、猎聘或 LinkedIn 搜「Agent 开发」「大模型应用」，找 10 份你所在城市的 JD，做一张表：每行一份 JD（公司、职位、薪资、年限、学历），后面列关键词（Python、RAG、工具调用、MCP、评测、LangChain、前端/全栈……），数一数每个关键词在 10 份里出现了几次。

为什么要做：一是开学前就知道招聘方最看重哪几样，学到那几天心里有数；二是 Day 56 写简历时拿这张表逐项对照，哪些你有项目能证明、哪些还缺，一目了然；三是用你自己城市的薪资和年限，比看全国平均更贴近现实。

不想全部手抄的话，可以先看这个站的《[880 条真实 JD 拆解](/blog/agent-jd-report-2026-10/)》，里面已经数好了国内外的整体比例。但至少自己完整读两三份 JD，体会一下「有真实落地经验」「熟悉 Agent 底层原理」这类话在招聘方那里具体指什么。

**验收标准：** `uv run main.py` 能打印出模型回复和 token 用量；`git check-ignore .env` 有输出，`.env` 没有进 git；手里有一张 10 份 JD 的关键词表。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| LLM（Large Language Model） | 大语言模型，比如 DeepSeek、Qwen、Claude、GPT。输入一段文字，输出接下来的文字 |
| Agent（智能体） | 让模型自己决定下一步做什么、调用什么工具、直到完成任务的程序。区别于「问一句答一句」 |
| Tool / Function calling | 工具调用。模型输出一段结构化的「我想调用某函数、参数是这些」，由你的代码去真正执行 |
| RAG（检索增强生成） | 先从知识库里检索相关内容，塞进提示词里，再让模型回答。用来让模型知道它训练时没见过的私有数据 |
| MCP（Model Context Protocol） | 一个开放协议，规定了「工具和数据」怎么接到 AI 应用上。写一次 MCP server，多个 AI 客户端都能用 |
| Eval（评测） | 用一批测试用例给 Agent 打分，判断改动是变好还是变坏 |
| Token | 模型处理文字的最小单位，计费也按它算。中文一个字大约 0.6 个 token（DeepSeek 官方口径） |
| API key | 调用模型 API 的密钥，等同于密码，泄露了别人就能花你的钱 |
| uv | Python 的项目管理工具，管 Python 版本、依赖和虚拟环境 |

## 常见误区

**以为要先学机器学习。** 很多人一说转 AI 就去刷吴恩达的机器学习、李沐的动手学深度学习。那是算法岗的路。Agent 岗面试几乎不问反向传播，问的是你怎么设计工具、怎么做评测、怎么控制成本。Day 1 会给你一份「Agent 工程师需要的模型直觉」，够用了。

**只看视频不写代码。** 视频看起来很爽，有一种学会了的错觉。面试一手写就露馅。每天的「动手练习」必须做。

**一上来就用 LangChain。** LangChain 封装很厚，出了问题你不知道底下发生了什么。这门课先让你用原生 API 手写 Agent 循环（Day 9），W4 才上框架。面试官很喜欢问「不用框架你怎么实现」。

**把 API key 写进代码提交到 GitHub。** 公开仓库里的 key 几分钟内就会被扫描程序抓走。第一天就养成用 `.env` 的习惯。

**以为 Agent 就是越自主越好。** 实际上线的系统里，大部分是「固定流程 + 局部让模型决策」的 workflow，完全自主的 Agent 反而少，因为不可控。Day 13 会专门讲这个取舍。

## 学习资料

### 文档与文章

- [Anthropic《Building effective agents》](https://www.anthropic.com/engineering/building-effective-agents)：**必看**。整个行业对「什么是 Agent、什么时候该用」讨论最多的一篇，今天先通读一遍有个印象，Day 13 会逐个模式实现。30 分钟。
- [Lilian Weng《LLM Powered Autonomous Agents》](https://lilianweng.github.io/posts/2023-06-23-agent/)：2023 年的经典综述，把 Agent 拆成规划、记忆、工具三块。有些例子旧了，框架还是对的。40 分钟。
- [DeepSeek API 文档（中文）](https://api-docs.deepseek.com/zh-cn/)：今天跑通第一次调用要看「首次调用 API」和「模型 & 价格」两页。
- [uv 官方文档](https://docs.astral.sh/uv/)：装 uv 卡住了看 Installation 一节。
- 脉脉《2026 春招职场洞察报告》的转载：[凤凰网科技](https://tech.ifeng.com/c/8t6CJpDnSVU)，看 AI 岗位增长和薪资数据，注意它是全行业平均。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1aaxyz8ELY&autoplay=0&high_quality=1" title="吴恩达最新《Agentic AI》大佬亲授智能体教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>吴恩达机器学习（搬运）· （中英双语!）吴恩达最新《Agentic AI》大佬亲授智能体教程，附示例代码！ · 共 31 P，今天只看 P2「什么是智能体 AI」、P3「自主性程度」、P5「智能体 AI 应用」，20 分钟左右。整门课后面会反复回来看其他 P。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1DWJkzvEKw&autoplay=0&high_quality=1" title="李宏毅 机器学习2025秋 第2讲：上下文工程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小尹不吱声（搬运）· 【李宏毅 | 机器学习2025秋】第 2 讲：上下文工程 (Context Engineering) — AI Agent 背后的关键技术 · 110 分钟。今天可以只看前 30 分钟，听李宏毅怎么解释 Agent 和「上下文」的关系，Day 20 会再看完。</figcaption>
</figure>

- 李宏毅 2025 生成式 AI 课程 AI Agent 相关讲次合集：B 站搜「李宏毅 2025 AI Agent」，播放量高的搬运合集很多（比如 BV1bbjvzME7B），挑带课件的看。作为整门课的「理论背景课」，有空时按顺序看。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/sal78ACtGTc" title="What's next for AI agentic workflows ft. Andrew Ng of AI Fund" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Sequoia Capital · What's next for AI agentic workflows ft. Andrew Ng of AI Fund · 13 分钟。吴恩达讲反思、工具使用、规划、多 Agent 四种模式，这个分法后来被大量引用。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LCEmiRjPEtQ" title="Andrej Karpathy: Software Is Changing (Again)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Y Combinator · Andrej Karpathy: Software Is Changing (Again) · 40 分钟。Karpathy 讲「Software 3.0」和为什么要做「部分自主」的产品，对理解 Agent 该有多自主很有帮助。B 站搜标题也有中字搬运。</figcaption>
</figure>

- [DeepLearning.AI《Agentic AI》课程主页](https://www.deeplearning.ai/courses/agentic-ai/)：上面 B 站视频的官方来源，课后有代码练习。

### 书籍

- Chip Huyen《AI Engineering: Building Applications with Foundation Models》，O'Reilly，2025。这门课最推荐的一本书，讲的就是「用现成模型做应用」这件事，评测那几章尤其好。今天读第 1 章，了解 AI 工程和传统机器学习工程的区别。目前没查到简体中文正式版，读英文原版。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》，O'Reilly，2024；中文版《图解大模型：生成式 AI 原理与实战》，人民邮电出版社，2025。图多，适合 Day 1 补模型直觉。今天不用读。

### 开源项目与代码

- [Datawhale《hello-agents》](https://github.com/datawhalechina/hello-agents)：中文的 Agent 系统教程，和这门课可以互相补充。今天看它的目录，知道有这么个东西。
- [微软《AI Agents for Beginners》](https://github.com/microsoft/ai-agents-for-beginners)：有中文翻译，偏微软技术栈，入门概念讲得清楚。
- [Hugging Face Agents Course](https://huggingface.co/learn/agents-course)：免费，带证书，偏 HF 生态。

## 自测

1. 用两三句话说明 Agent 工程师和算法工程师的区别。

<details><summary>答案</summary>

Agent 工程师用现成的大模型（多数是 API）搭系统，主要工作是工具设计、检索、流程编排、评测、上线运维；算法工程师训练和改进模型本身，做预训练、微调、对齐。前者本质是后端工程加大模型，后者偏研究，学历门槛通常更高。

</details>

2. 一份 JD 标题是「AI Agent 专员」，职责写的是「使用 AI 工具高效处理客户咨询，维护智能客服话术库」。这是开发岗吗？

<details><summary>答案</summary>

不是。没有任何编程、API、RAG、框架相关的要求，「使用 AI 工具」「维护话术库」是客服或运营的工作内容。

</details>

3. 在一个工单 Agent 里，「去数据库查这个客户的扣款记录」这件事是谁做的？模型还是你的代码？

<details><summary>答案</summary>

你的代码。模型只是输出「我想调用 get_invoices，参数 customer_id=123」这样一段结构化数据，你的程序解析它、真正执行查询，再把结果交回给模型。

</details>

4. 按文中的估算口径，如果你每天调用 500 次，每次输入 4,000 token、输出 800 token，用 deepseek-flash 高峰价跑 30 天大概多少钱？

<details><summary>答案</summary>

每天输入 500 × 4,000 = 200 万 token，输出 500 × 800 = 40 万 token。30 天输入 6,000 万、输出 1,200 万。高峰价：60 × 2 + 12 × 8 = 120 + 96 = 216 元。空闲时段大约一半，108 元左右。这还没算缓存命中带来的折扣。

</details>

5. 为什么 `.env` 要加进 `.gitignore`？如果已经不小心提交了一次，只删掉文件再提交够不够？

<details><summary>答案</summary>

`.env` 里有 API key，提交到公开仓库会被扫描程序抓走盗用。只删文件再提交不够，git 历史里还留着。正确做法是立刻去平台作废这个 key、重新生成一个，再考虑清理历史。作废 key 是第一步，也是最重要的一步。

</details>

6. 面试题：面试官问「你为什么想从后端转 Agent 开发，你觉得你的后端经验有什么用？」你会怎么答？

<details><summary>答案</summary>

参考思路：Agent 系统里模型只负责决策，其余部分（工具实现、数据访问、权限、幂等、重试、队列、监控、部署）都是后端工程问题。后端经验让我能把一个不确定的模型包在一个可靠的系统里，比如给退款这种写操作加幂等和人工审批，给工具调用加超时和重试，用 trace 定位线上问题。再举一个自己做过的具体例子，比只说概念有说服力得多。

</details>

## 明天预告

Day 1 · 大模型到底在干什么：token、上下文窗口、下一个词预测。不讲数学，只讲 Agent 工程师需要的那几条直觉：模型为什么会一本正经地胡说、为什么中文比英文贵、为什么聊久了它会「忘事」、temperature 调高调低差在哪。这些直觉后面每一天都会用到。
