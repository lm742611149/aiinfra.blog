---
title: 'Day 152 · 国内智能体合规:实施意见、拟人化互动办法、智能体互联国标与内容标识'
description: '2026 年国内给智能体出了三份新文件:5 月的《智能体规范应用与创新发展实施意见》、7 月 15 日施行的《人工智能拟人化互动服务管理暂行办法》、5 月发布的 GB/Z 185 智能体互联系列国家标准,再加上清朗专项和已经施行一年的标识办法。今天逐条读原文,判断 SupportPilot 适用哪些、不适用哪些,再把「仅限用户本人决策、需由用户授权决策、智能体自主决策」写成一个能审计的决策策略。'
pubDate: 2026-10-22
regime: none
tags: ['compliance', 'regulation', 'china', 'governance', 'agent-identity', 'agent-60']
series: 'agent-60'
day: 152
lang: 'zh'
---

## 今天要解决的问题

**建议在 [Day 86 · 治理与合规](/blog/agent-60/day-86-governance-compliance/)之后读。** Day 86 已经讲了生成式 AI 服务的备案和登记、生成内容标识、个人信息出境、日志留存和欧盟 AI Act 的时间表。那些内容今天不重复,只在需要时点一句。

Day 86 写完以后,国内又出了几份专门针对智能体的文件,而且有一份已经让大厂动了产品:2026 年 7 月 15 日,《人工智能拟人化互动服务管理暂行办法》施行的同一天,豆包和千问下线了各自的智能体功能。公司对外的说法只是「产品功能调整」,但时间点太巧,行业里普遍把两件事联系在一起。

做 Agent 的工程师碰到这些文件,常见两种反应:一种是觉得「这是法务的事」,一种是看了新闻标题就以为「AI 陪伴被禁了、智能体要备案了」。两种都不对。今天的做法和 Day 86 一样:**读原文,把条文翻译成技术要求**,同时搞清楚哪些条款对你的产品根本不适用。

先说清楚,**这一篇不是法律意见**。条文以官方发布的文本为准,适用与否由你们公司的法务判断。我会尽量引用原文和条款号,方便你拿去和法务对。

学完今天你应该能:

1. 说清 2026 年这几份文件各是什么性质(政策意见、部门规章、指导性国家标准、专项行动),对工程设计的约束力有什么不同。
2. 引用《实施意见》第 6 条,把 SupportPilot 的每个工具分进「仅限用户本人决策、需由用户授权决策、智能体自主决策」三类,并用代码执行。
3. 按《拟人化互动服务管理暂行办法》第二条判断一个 Agent 适不适用这部办法,知道适用时要做哪些功能(极端情绪干预、两小时提醒、未成年人模式、退出、数据不得给第三方)。
4. 知道 GB/Z 185 系列七个部分分别规定什么,能和 MCP、A2A 做对照。
5. 根据清朗专项的整治清单,给自己的 Agent 做一遍自查。

预计用时 4 小时,其中读原文 1.5 小时。

## 一年里的时间线

先把这些文件按时间排一下,感觉会清楚很多:

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="2025 年 9 月到 2026 年 8 月国内智能体相关法规和标准的时间线">
  <rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
  <line x1="60" y1="20" x2="60" y2="315" stroke="var(--rule)"/>
  <circle cx="60" cy="34" r="5" fill="var(--compute)"/>
  <text x="76" y="38" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">2025-09-01 标识办法 + GB 45438 施行</text>
  <circle cx="60" cy="66" r="5" fill="var(--rule)"/>
  <text x="76" y="70" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">2025-12-27 拟人化互动办法征求意见稿</text>
  <circle cx="60" cy="98" r="5" fill="var(--mem)"/>
  <text x="76" y="102" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">2026-04-10 拟人化互动办法公布(五部门令第 21 号)</text>
  <circle cx="60" cy="130" r="5" fill="var(--compute)"/>
  <text x="76" y="134" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">2026-04-30 清朗·整治 AI 应用乱象专项部署(为期 4 个月)</text>
  <circle cx="60" cy="162" r="5" fill="var(--mem)"/>
  <text x="76" y="166" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">2026-05-08 智能体规范应用与创新发展实施意见</text>
  <circle cx="60" cy="194" r="5" fill="var(--mem)"/>
  <text x="76" y="198" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">2026-05-22 GB/Z 185.1~185.7-2026 智能体互联发布</text>
  <circle cx="60" cy="226" r="5" fill="var(--compute)"/>
  <text x="76" y="230" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">2026-07-15 拟人化互动办法施行;豆包、千问下线智能体</text>
  <circle cx="60" cy="258" r="5" fill="var(--rule)"/>
  <text x="76" y="262" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">2026-07 下旬 智能体身份码首批发放,累计 2000 余个</text>
  <circle cx="60" cy="290" r="5" fill="var(--rule)"/>
  <text x="76" y="294" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">2026-08-02 欧盟 AI Act 第 50 条透明度义务开始适用</text>
</svg>
<figcaption>蓝点是今天重点读的三份文件,琥珀点是已经在执行、会被检查的要求,灰点是相关事件。拟人化互动办法从公布到施行留了三个多月,这段时间就是给企业改产品的窗口。</figcaption>
</figure>

这几份文件的**性质不一样**,这一点决定了你要怎么对待它们:

| 文件 | 性质 | 对工程的约束 |
| --- | --- | --- |
| 《人工智能生成合成内容标识办法》 | 规范性文件,配套强制性国家标准 GB 45438-2025 | 必须做,而且有标准可查 |
| 《人工智能拟人化互动服务管理暂行办法》 | 部门规章(五部门令第 21 号) | 适用范围内必须做,有罚则 |
| 《智能体规范应用与创新发展实施意见》 | 三部门的政策意见 | 本身没有罚则,但指明了后续立法和监管的方向 |
| GB/Z 185-2026 智能体互联 | 国家标准化指导性技术文件(GB/Z) | 推荐参考,不强制 |
| 清朗·整治 AI 应用乱象 | 专项执法行动 | 检查清单,查到就处置 |

GB 开头的是强制性国家标准,GB/T 是推荐性,GB/Z 是指导性技术文件,约束力依次变弱。看到「智能体国标发布了」先看前缀,别一听国标就以为必须照做。

## 《实施意见》:写给工程师的四条

《智能体规范应用与创新发展实施意见》由国家网信办、国家发展改革委、工业和信息化部联合印发,网信网 2026 年 5 月 8 日发布全文。它开头给智能体下了一个定义:「具备自主感知、记忆、决策、交互与执行能力的智能系统」。全文分基本原则、夯实发展基础、守牢安全底线、强化应用牵引、建设创新生态几部分,一共 19 个典型应用场景。大部分内容是产业政策,和写代码直接相关的集中在「守牢安全底线」那一部分。我挑四条。

**第 6 条「明确决策权限」**,原文是:

> 在遵守法律法规、尊重社会公德和伦理规范前提下,厘清仅限用户本人决策、需由用户授权决策和智能体自主决策等各种决策方式的合理边界及所需权限。确保用户对智能体自主决策享有知情权和最终决策权,智能体执行操作不得超出用户授权范围。

这是整份文件里对 Agent 架构影响最直接的一句。它把决策分成了三类,而且给了两个硬要求:用户对 Agent 自己做的决定**有知情权和最终决策权**,Agent **不得超出用户授权范围**。翻译成工程语言就是三件事:每个工具要登记属于哪一类;需要授权的动作要有授权记录,且授权有范围和时效;Agent 自主做的事要能让用户看到、能撤回或推翻。Day 94 的自主程度分级和 Day 25 的人工审批你已经做过,今天的练习把它们和这条原文对上。

**第 7 条「加强行为管控」**,提到要「发展规则内嵌、行为围栏等技术」,并「探索利用区块链等技术,建立重要应用场景智能体行为可验证、可追溯机制」。行为围栏对应 Day 40 的权限和沙箱,可追溯对应 Day 84 做过的哈希链审计日志。

**第 9 条「加强供应链安全」**,要求「加强模型接入、应用程序接口调用、扩展工具使用等环节安全管理」,并探索供应链安全信息共享和预警。扩展工具就是 MCP server、插件、Skills 这一类,第三方 MCP server 的安全问题在专题篇里另有一篇讲。

**第 11 条「构建分类分级治理框架」**,把智能体分成两档管:敏感领域和重点行业「实行备案、检测、问题产品召回等管理措施」;生活娱乐、日常办公等低风险领域,「通过合规自测、信息报告、分发平台管理、行业自律等实现高效治理」。这里说的备案是一个方向,目前还没有落地成具体的智能体备案办法,不要和 Day 86 讲的生成式 AI 服务备案混为一谈。

另外第 4 条提出「探索建立智能体注册平台,提供智能体数字身份管理、检索发现、能力声明等服务」,第 3 条点名要推广「智能体互联协议(AIP)等智能体互联关键国家标准」。这两句和下面的 GB/Z 185 是一条线上的。

## 拟人化互动办法:先判断适不适用

《人工智能拟人化互动服务管理暂行办法》是国家网信办、国家发展改革委、工业和信息化部、公安部、国家市场监督管理总局五部门的令(第 21 号),2026 年 4 月 10 日公布,7 月 15 日起施行,一共 32 条。它是今天这几份文件里唯一有明确罚则的。

### 第二条决定了你要不要往下读

第二条原文分三款:

> 利用人工智能技术,向中华人民共和国境内公众提供模拟自然人人格特征、思维模式和沟通风格的持续性的情感互动服务(以下简称拟人化互动服务),适用本办法。
>
> 前款规定的情感互动服务包括通过文字、图片、音频、视频等形式,提供的情感照护、陪伴、支持等互动服务。
>
> 提供智能客服、知识问答、工作助手、学习教育、科学研究等服务,不涉及持续性的情感互动的,不适用本办法。

第三款很关键:**智能客服、知识问答、工作助手不涉及持续性情感互动的,不适用**。所以 SupportPilot 这种客服工单 Agent,按字面是不适用的。网上很多「AI 新规」的标题让人以为所有 Agent 都要加两小时提醒,那是没读第二条。

但边界没那么死。判断的关键词是「持续性的情感互动」。设想产品经理提了一个需求:给 CloudLedger 的客服 Agent 起名「小簿」,配一个温柔的人设,能记住客户的生日和最近的烦心事,客户报完错还会跟它聊几句工作压力,它会安慰。这个功能做着做着就可能从「客服」滑向「陪伴」。我的建议是在需求评审时就把这条线写下来:客服 Agent 不做持续性的情感陪伴,用户明显在找情绪支持时,给出简短的回应和求助渠道,然后回到业务。这样既不违背第二条第三款的定位,也不会对一个真的情绪崩溃的用户冷冰冰。

### 适用时要做的功能

如果你做的正好是陪伴类、角色扮演类、虚拟伙伴类产品,下面这些条款就要逐条做成功能。我按工程实现分组:

- **识别和干预**(第十三条):发现用户极端情绪,「及时生成情绪安抚和鼓励寻求帮助等相关内容」;发现用户面临重大财产损失或明确表示自残自杀等,「采取提供相应援助等必要措施予以干预,并及时联络用户监护人或者紧急联系人」。这要求注册时就收集紧急联系人(第十二条),而且要有一条从模型检测到人工处置的通道,不能只靠模型回一句安慰。
- **标识和提醒**(第十八条):要「提示用户正在与人工智能服务而非自然人进行互动」;发现过度依赖、沉迷倾向时「以弹窗等显著方式动态提醒」;「对用户连续使用拟人化互动服务每超过 2 个小时的,应当以对话或者弹窗等方式提醒用户注意使用时长」。两小时提醒是会话层的计时器,要定义清楚「连续」怎么算(中间断开多久算重新计时),这个办法没写,需要你和法务定一个口径并写进文档。
- **未成年人**(第十四条、第十七条):不得向未成年人提供虚拟亲属、虚拟伴侣等虚拟亲密关系服务;不满十四周岁要监护人同意;要建立未成年人模式,有切换、定期现实提醒、时长限制;支持监护人接收风险提醒、了解使用概况、屏蔽特定角色、限制充值;还要「采取有效措施识别未成年人用户身份」并提供申诉渠道。
- **数据**(第十六条):用户交互数据「除法律另有规定或者权利人明确同意外」不得提供给第三方;要给用户提供聊天记录的复制和删除选项;属于敏感个人信息的交互数据,除法律另有规定或取得用户单独同意外,不得用于模型训练。对 Agent 来说,「不得提供给第三方」要特别想一下:把对话发给第三方模型 API 算不算?把 trace 送到海外的可观测平台算不算?这需要法务判断,工程上至少要把每一个数据流向列清楚,Day 86 画的数据流图就是干这个的。
- **退出**(第十九条、第二十条):要有便捷的退出途径,用户通过窗口、语音、关键词要求退出时「应当及时停止服务,不得采取持续互动等方式阻碍用户退出」。停服要提前告知。
- **安全评估和备案**(第二十二条、第二十六条):上线或新增相关功能、技术有重大变化、「注册用户 100 万以上或者月活跃用户 10 万以上」等情形要做安全评估并向省级网信部门报告;要按《互联网信息服务算法推荐管理规定》履行算法备案。
- **罚则**(第三十条):法律、行政法规没有规定的,由有关部门警告、通报批评、责令限期改正;拒不改正或情节严重的,责令停止提供服务,「可以并处一万元以上十万元以下罚款;涉及危害公民生命健康安全且有危害后果的,并处十万元以上二十万元以下罚款」。

还有一条容易被忽略的第十条第二款:提供者「不得将替代社会交往、控制用户心理、诱导沉迷依赖等作为服务目标」。这条落到工程上,是你的优化指标不能是「用户使用时长」或「日均对话轮数」这类会把产品往沉迷方向推的数字。Day 71 讲 A/B 实验时我们选过指标,做陪伴类产品时这件事会直接碰到合规。

### 豆包和千问做了什么

7 月 4 日前后,豆包和千问几乎同时向用户推送通知,智能体功能 7 月 15 日下线。按《科创板日报》和界面新闻的报道,豆包允许用户在一段时间内查看和保存智能体信息与历史对话,10 月 15 日后按隐私政策处理数据,并引导用户去字节旗下的猫箱 App;千问也提示用户提前导出。两家的公告都只说「产品功能调整」,没有提到这部办法,把它们联系起来是媒体的分析。

从工程角度看,这个案例能学到的一点是:**用户创建的角色类智能体,平台很难逐个判断是不是「持续性情感互动」**。一个平台上有几十万个用户自建的智能体,有的是写周报助手,有的是虚拟恋人,要做到办法里要求的未成年人模式、极端情绪干预、两小时提醒,对每一个都做一遍成本很高。干脆把功能收掉、让专门做陪伴的产品去承接,是一种务实的选择。你在设计一个允许用户自建智能体的平台时,要在一开始就想好:平台层统一提供哪些合规能力,用户建的智能体能不能选「陪伴」这一类。

## GB/Z 185:国家版的 Agent 互联标准

2026 年 5 月 22 日,国家市场监督管理总局和国家标准化管理委员会发布了 GB/Z 185-2026《人工智能 智能体互联》系列,一共 7 个部分,在全国标准信息公共服务平台上能查到,状态是「现行」,类型是指导性技术文件。有的报道写的是「8 项」,以官方平台上列出的 7 项为准。按中国电子技术标准化研究院牵头的解读,7 个部分各管一块:

| 部分 | 名称 | 规定什么 | 你学过的对照 |
| --- | --- | --- | --- |
| GB/Z 185.1 | 总体架构 | 智能体互联的总体架构 | Day 93 的三层协议图 |
| GB/Z 185.2 | 身份码 | 身份码的编码、分配与管理 | 没有直接对应 |
| GB/Z 185.3 | 身份管理 | 身份注册、账户、凭证和鉴别 | Day 84 的 OAuth、Day 93 的 Agent Card 签名 |
| GB/Z 185.4 | 智能体描述 | 能力描述及其注册、发布和变更 | A2A 的 Agent Card |
| GB/Z 185.5 | 智能体发现 | 发现流程 | A2A 的 `/.well-known/agent-card.json` |
| GB/Z 185.6 | 智能体交互 | 点对点、群组、混合等交互模式 | A2A 的 Task 和 Message |
| GB/Z 185.7 | 智能体工具调用 | 外部工具调用的架构、流程和数据格式 | MCP |

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="GB/Z 185 与 MCP、A2A 的对照">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
  <rect x="20" y="20" width="290" height="220" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="165" y="44" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">GB/Z 185 系列</text>
  <text x="36" y="76" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">185.2 身份码 · 185.3 身份管理</text>
  <text x="36" y="108" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">185.4 描述 · 185.5 发现</text>
  <text x="36" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">185.6 交互(点对点/群组/混合)</text>
  <text x="36" y="172" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">185.7 工具调用</text>
  <text x="36" y="214" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">身份码由注册服务方统一分配</text>
  <rect x="330" y="20" width="290" height="140" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="475" y="44" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">A2A 1.0</text>
  <text x="346" y="76" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">Agent Card(可签名)</text>
  <text x="346" y="108" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">well-known 发现</text>
  <text x="346" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">Task / Message / Artifact</text>
  <rect x="330" y="176" width="290" height="64" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="475" y="200" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">MCP</text>
  <text x="346" y="226" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">tools / resources / prompts</text>
  <line x1="310" y1="92" x2="330" y2="92" stroke="var(--rule)"/>
  <line x1="310" y1="136" x2="330" y2="136" stroke="var(--rule)"/>
  <line x1="310" y1="168" x2="330" y2="208" stroke="var(--rule)"/>
</svg>
<figcaption>功能上大体能一一对上。最明显的不同在左上角:GB/Z 185 有统一分配的身份码和身份管理体系,A2A 靠各家自己的域名和签名,没有中心化的身份分配。</figcaption>
</figure>

最有中国特色的是第 2、3 部分。按解读报道,身份码由身份注册服务方统一分配,采用分层标识体系,一个身份码只对应一个智能体。2026 年 7 月下旬的应用推进会上举行了首批身份码发放仪式,央视网报道累计发放了 2000 余个重点行业智能体身份码。这和《实施意见》第 4 条的「智能体注册平台」「数字身份管理」是一条线。A2A 的身份是去中心化的:谁控制 `example.com`,谁就能发布它的 Agent Card;GB/Z 185 的思路是有一个注册体系来分配和管理身份。两种思路各有道理,前者灵活,后者便于监管和追溯。

解读里还提到总体架构分五个「概念域」:用户域发起任务、接收结果;智能体域维护自己的身份和描述,负责鉴权、交互和工具访问;管理服务域提供身份、凭证和鉴别;互联服务域负责描述管理、发现和消息分发;资源访问域提供工具和外部资源。拿它和 Day 93 那张图比,多出来的就是「管理服务域」这个中心化的身份管理角色。

另外有媒体报道,一个基于这套国标的 AIP(Agent Interconnection Protocol)开源实现在 AtomGit 上发布了 v2.1。这个我只在二手报道里看到,没有去核对代码。

我对这套标准的判断是:**现在学它的价值在于理解思路和面试时能对比着讲,而不是马上去对接**。它是指导性文件,目前没有要求所有智能体都接入;国内大部分 Agent 产品之间的互联需求还不多。但如果你做的是政务、医疗、金融这类《实施意见》第 11 条说的「敏感领域及重点行业」,身份码和注册很可能是将来的要求,值得提前关注。标准全文可以在全国标准信息公共服务平台上按标准号查找。

## 清朗专项:监管在查什么

2026 年 4 月 30 日,中央网信办部署了为期 4 个月的「清朗·整治 AI 应用乱象」专项行动,分两个阶段。第二阶段主要针对内容乱象(虚假信息、换脸冒充、低俗内容、AI 水军),第一阶段有 7 类问题,其中好几条直接点到工程实现。第三类(训练语料安全)主要针对训练模型的公司,下面挑出和 Agent 开发者相关的六类:

- **第一类,未按规定履行大模型备案登记义务**:「应备未备」。对应 Day 86 讲的备案和登记。
- **第二类,AI 平台安全和审核过滤能力不足**:通知原文里点了「缺乏安全围栏机制、审核过滤能力不足」,以及生成内容里带违法不良信息的网盘和网站链接。Agent 生成回复时附上的链接也要过审核。
- **第四类,AI 数据投毒**:这一条里有一句对 RAG 特别重要,「在模型生成回答过程中,对引用信源缺乏交叉验证和风险提示机制,未标注引用信息链接」。你在 Day 21 做的带引用出处的文档问答,正好就是这条要求的正面做法。
- **第五类,生成合成内容标识落实不到位**:没加标识、标识不规范、「未落实跨平台隐式标识互识互认义务」,以及教人去除 AI 标识。
- **第六类,滥用 AI 技术开展违法违规活动**:其中一句是「利用智能体技术窃取用户数据或账户密钥,侵犯他人隐私或合法权益」。你的 Agent 如果有浏览器操作或读文件的能力,Day 39 讲的间接注入让它把用户密钥发出去,就落在这一条里。
- **第七类,开源模型安全管理不到位**:针对开源社区和模型托管平台。

专项从 4 月底部署,按 4 个月算大约到 8 月底(这是我按通知里的「为期 4 个月」推算的,通知本身没写结束日期)。专项会结束,但这份清单基本上就是以后日常检查的重点。练习里我们会拿它给 SupportPilot 做一遍自查。

## 和欧盟对照一下

如果你的 Agent 同时面向国内和海外用户,或者你在找海外岗位,下面这张表能帮你在面试里讲清两边的差别。欧盟这一侧的细节在 Day 86 已经讲过。

| 要求 | 国内 | 欧盟 AI Act |
| --- | --- | --- |
| 告诉用户在和 AI 交互 | 标识办法第四条(交互场景界面加显著提示);拟人化办法第十八条 | 第 50 条透明度义务,2026 年 8 月 2 日起适用 |
| 生成内容可识别 | 显式标识 + 文件元数据隐式标识(标识办法第四条、第五条,GB 45438-2025) | 第 50 条要求生成内容以机器可读方式标记 |
| 上线前的程序 | 生成式 AI 服务备案或登记;拟人化服务做安全评估和算法备案 | 高风险系统有合规评估,时间表已推迟到 2027 年 12 月起 |
| Agent 决策边界 | 《实施意见》第 6 条(政策层面) | 高风险系统要求人工监督 |
| 未成年人 | 拟人化办法第十四条有具体功能要求 | 主要靠其他法规 |

国内的特点是**针对具体产品形态单独立规**(深度合成、生成式 AI、拟人化互动各一份),而且执行节奏快,从公布到施行一般三到六个月;欧盟是一部大法按风险分级,时间表长,还在 2026 年 7 月往后推了一次。

## 落到 SupportPilot:决策分级写成代码

SupportPilot 不适用拟人化办法,但《实施意见》第 6 条的思路对它完全适用,而且就算没有这条,也是好的工程实践。我们把它做成一个独立的策略模块,所有工具调用在执行前都要经过它。

三类决策在 SupportPilot 里大概是这样分的:

- **智能体自主决策**:查知识库、查账单、查订阅。只读,做错了不会造成损失。
- **需由用户授权决策**:提退款申请、改套餐。会改变用户的账单,要用户明确同意,同意要有范围(哪张发票、多少钱)和时效。
- **仅限用户本人决策**:注销账号、更换支付方式。后果不可逆或者涉及身份验证,Agent 不应该代办,只能给用户一个去自己操作的入口。

还有一条默认规则:**没登记的工具一律拒绝**。新加一个工具忘了登记层级,宁可它用不了,也不要它默认就能被 Agent 调用。

## 动手练习

在 `agent-60-lab` 根目录准备目录(不需要新依赖):

```bash
cd ~/Documents/agent-60-lab
mkdir -p topics/china_compliance
touch topics/__init__.py topics/china_compliance/__init__.py
```

### 第 1 步:决策策略

```python
# agent-60-lab/topics/china_compliance/decision_policy.py
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any


class Tier(Enum):
    USER_ONLY = "仅限用户本人决策"
    USER_AUTHORIZED = "需由用户授权决策"
    AUTONOMOUS = "智能体自主决策"


TOOL_TIERS: dict[str, Tier] = {
    "search_kb": Tier.AUTONOMOUS,
    "get_invoices": Tier.AUTONOMOUS,
    "create_refund_request": Tier.USER_AUTHORIZED,
    "change_plan": Tier.USER_AUTHORIZED,
    "close_account": Tier.USER_ONLY,
    "change_payment_method": Tier.USER_ONLY,
}


@dataclass
class Grant:
    grant_id: str
    customer_id: str
    tool: str
    max_amount: float | None  # 金额上限,None 表示这个工具不涉及金额
    expires_at: datetime
    via: str  # 用户是怎么授权的,比如「对话内确认按钮」
    used: bool = False  # 一次授权只能用一次


@dataclass
class Decision:
    action: str  # allow / confirm / hand_to_user / deny
    tier: str
    reason: str
    grant_id: str | None = None


@dataclass
class DecisionPolicy:
    grants: list[Grant] = field(default_factory=list)
    audit: list[dict[str, Any]] = field(default_factory=list)

    def check(self, tool: str, args: dict[str, Any], customer_id: str, now: datetime) -> Decision:
        tier = TOOL_TIERS.get(tool)
        if tier is None:
            d = Decision("deny", "未登记", f"工具 {tool} 没有登记决策层级,默认拒绝")
        elif tier is Tier.AUTONOMOUS:
            d = Decision("allow", tier.value, "只读或低风险,Agent 可以自己做")
        elif tier is Tier.USER_ONLY:
            d = Decision("hand_to_user", tier.value, "只能由用户本人操作,Agent 只给入口链接")
        else:
            d = self._check_grant(tool, args, customer_id, now, tier)
        self.audit.append({"at": now.isoformat(timespec="seconds"), "customer": customer_id,
                           "tool": tool, "args": args, **d.__dict__})
        return d

    def _check_grant(self, tool: str, args: dict[str, Any], customer_id: str,
                     now: datetime, tier: Tier) -> Decision:
        amount = args.get("amount")
        for g in self.grants:
            if g.used or g.customer_id != customer_id or g.tool != tool or now >= g.expires_at:
                continue
            if g.max_amount is not None and (amount is None or amount > g.max_amount):
                return Decision("confirm", tier.value,
                                f"金额 {amount} 超出授权上限 {g.max_amount},要重新问用户", g.grant_id)
            g.used = True
            return Decision("allow", tier.value, f"用户已通过{g.via}授权", g.grant_id)
        return Decision("confirm", tier.value, "没有有效授权,先问用户")


def grant_once(customer_id: str, tool: str, max_amount: float | None, now: datetime,
               minutes: int = 30) -> Grant:
    gid = f"g-{customer_id}-{tool}-{now:%H%M%S}"
    return Grant(gid, customer_id, tool, max_amount, now + timedelta(minutes=minutes), "对话内确认按钮")


def explain_for_user(audit: list[dict[str, Any]], customer_id: str) -> list[str]:
    """给用户看的「Agent 替你做了什么」,对应知情权。"""
    done = {"allow": "已执行", "confirm": "等你确认", "hand_to_user": "需要你本人操作", "deny": "已拒绝"}
    return [f"{a['at'][11:16]} {a['tool']}:{done[a['action']]}({a['reason']})"
            for a in audit if a["customer"] == customer_id]
```

<div class="line-notes">

- `class Tier(Enum):` 三个枚举值的中文直接用《实施意见》第 6 条的原词。以后法务、审计来问「你们怎么落实第 6 条的」,打开这个文件就能对上,不需要翻译。
- `TOOL_TIERS: dict[str, Tier] = {` 工具到层级的登记表。它是整个模块的核心,应该和 Day 46 的工具注册放在一起评审:新加工具的 MR 如果没改这张表,CI 就该挂(练习 2)。
- `"create_refund_request": Tier.USER_AUTHORIZED,` 退款申请要用户授权。注意 Day 46 里退款申请本身就只是「提申请」、要客服审批,这里又加了一层用户授权:一层是用户同意 Agent 替他申请,一层是公司同意退。两层管的是不同的人。
- `"close_account": Tier.USER_ONLY,` 注销账号是不可逆的,只能用户本人做。
- `class Grant:` 一次用户授权。字段对应「授权范围」的几个维度:谁(`customer_id`)、做什么(`tool`)、多大(`max_amount`)、多久(`expires_at`)、怎么授权的(`via`)。
- `max_amount: float | None` 演示里用 `float` 方便读。真实系统里金额要用整数分或 `Decimal`,和 Day 46 一致。
- `via: str` 记下授权方式,出了争议时能说清楚「用户是在哪个界面、点了什么同意的」。
- `used: bool = False` 一次授权只能用一次。第一版我没加这个字段,结果 30 分钟内同一个授权可以退好几笔,这显然超出了用户同意的范围。
- `class Decision:` 四种结果:`allow` 执行、`confirm` 回去问用户、`hand_to_user` 交给用户自己做、`deny` 拒绝。比简单的「是/否」多两种,因为第 6 条的三类决策在被拦下时的处理方式不一样。
- `tier = TOOL_TIERS.get(tool)` 没登记的工具拿到 `None`。
- `d = Decision("deny", "未登记"` 默认拒绝。演示里 `export_all_customers` 走到这里。
- `elif tier is Tier.AUTONOMOUS:` 演示里 `get_invoices` 直接放行。
- `elif tier is Tier.USER_ONLY:` 演示里 `close_account` 返回 `hand_to_user`。测试里还验证了:就算有人给它塞了一个授权,也照样不执行。
- `self.audit.append(` 每一次判断都进审计,不管结果是什么。`**d.__dict__` 把决定的四个字段展开进去。演示跑完一共 7 条。真实系统里这条记录要写进 Day 84 那种只追加的审计表。
- `amount = args.get("amount")` 从工具参数里取金额,没有就是 `None`。
- `if g.used or g.customer_id != customer_id or g.tool != tool or now >= g.expires_at:` 四个条件任何一个不满足就跳过这条授权:用过了、不是这个客户、不是这个工具、过期了。测试里用 C009 去用 C007 的授权,被跳过。
- `if g.max_amount is not None and (amount is None or amount > g.max_amount):` 授权有金额上限时,金额超了或者干脆没传金额,都回去问用户。演示里授权 199、要退 299,返回 `金额 299.0 超出授权上限 199.0,要重新问用户`。
- `g.used = True` 放行的同时把授权标记成用过。
- `return Decision("confirm", tier.value, "没有有效授权,先问用户")` 演示里一开始没有任何授权时,`create_refund_request` 走到这里。
- `def grant_once(` 用户在对话里点「同意」后生成一条授权,默认 30 分钟有效。`grant_id` 拼了客户、工具和时间,演示里是 `g-C007-create_refund_request-140000`。
- `def explain_for_user(` 把审计记录翻成用户看得懂的话,放在界面上「Agent 替你做了什么」那一栏。这是第 6 条「知情权」的最小实现。
- `a['at'][11:16]` 从 `2026-10-22T14:05:00` 里截出 `14:05`。

</div>

### 第 2 步:跑一遍

```python
# agent-60-lab/topics/china_compliance/demo_policy.py
from datetime import datetime, timedelta

from topics.china_compliance.decision_policy import DecisionPolicy, explain_for_user, grant_once

now = datetime(2026, 10, 22, 14, 0, 0)
policy = DecisionPolicy()

calls = [
    ("get_invoices", {"customer_id": "C007"}),
    ("create_refund_request", {"invoice_id": "INV-0712", "amount": 199.0}),
    ("close_account", {"customer_id": "C007"}),
    ("export_all_customers", {}),
]
for tool, args in calls:
    d = policy.check(tool, args, "C007", now)
    print(f"{tool:24} {d.action:13} {d.tier} | {d.reason}")

policy.grants.append(grant_once("C007", "create_refund_request", 199.0, now))
for amount, minutes in [(299.0, 5), (199.0, 6), (199.0, 7)]:
    d = policy.check("create_refund_request", {"amount": amount}, "C007", now + timedelta(minutes=minutes))
    print(f"{minutes:>2} 分钟后退 {amount}: {d.action} | {d.reason}")

print("审计记录条数:", len(policy.audit))
print("\n".join(explain_for_user(policy.audit, "C007")[-3:]))
```

<div class="line-notes">

- `now = datetime(2026, 10, 22, 14, 0, 0)` 时间写死,每次跑结果都一样,方便和下面的输出对照。
- `calls = [` 四个工具各代表一种情况:自主、要授权、仅本人、未登记。客户用 CloudLedger 种子数据里的 C007。
- `print(f"{tool:24} {d.action:13}` 左对齐补空格,输出成一张对得齐的表。
- `policy.grants.append(grant_once(` 模拟用户在对话里点了「同意 Agent 为 INV-0712 申请退款 199 元」。
- `for amount, minutes in [(299.0, 5), (199.0, 6), (199.0, 7)]:` 第 5 分钟想退 299(超上限),第 6 分钟退 199(正常),第 7 分钟再退 199(授权已经用过)。
- `explain_for_user(policy.audit, "C007")[-3:]` 只打印最后三条,也就是授权之后的三次尝试。

</div>

```bash
uv run python -m topics.china_compliance.demo_policy
```

输出大致长这样(时间是写死的,所以每次都一样):

```text
get_invoices             allow         智能体自主决策 | 只读或低风险,Agent 可以自己做
create_refund_request    confirm       需由用户授权决策 | 没有有效授权,先问用户
close_account            hand_to_user  仅限用户本人决策 | 只能由用户本人操作,Agent 只给入口链接
export_all_customers     deny          未登记 | 工具 export_all_customers 没有登记决策层级,默认拒绝
 5 分钟后退 299.0: confirm | 金额 299.0 超出授权上限 199.0,要重新问用户
 6 分钟后退 199.0: allow | 用户已通过对话内确认按钮授权
 7 分钟后退 199.0: confirm | 没有有效授权,先问用户
审计记录条数: 7
14:05 create_refund_request:等你确认(金额 299.0 超出授权上限 199.0,要重新问用户)
14:06 create_refund_request:已执行(用户已通过对话内确认按钮授权)
14:07 create_refund_request:等你确认(没有有效授权,先问用户)
```

### 第 3 步:测试

```python
# agent-60-lab/topics/china_compliance/test_policy.py
from datetime import datetime, timedelta

from topics.china_compliance.decision_policy import TOOL_TIERS, DecisionPolicy, Tier, grant_once

NOW = datetime(2026, 10, 22, 14, 0, 0)


def test_unknown_tool_is_denied() -> None:
    assert DecisionPolicy().check("drop_table", {}, "C007", NOW).action == "deny"


def test_user_only_never_runs_even_with_grant() -> None:
    p = DecisionPolicy(grants=[grant_once("C007", "close_account", None, NOW)])
    assert p.check("close_account", {}, "C007", NOW).action == "hand_to_user"


def test_grant_is_single_use_and_scoped() -> None:
    p = DecisionPolicy(grants=[grant_once("C007", "create_refund_request", 199.0, NOW)])
    assert p.check("create_refund_request", {"amount": 199.0}, "C009", NOW).action == "confirm"
    assert p.check("create_refund_request", {"amount": 199.0}, "C007", NOW).action == "allow"
    assert p.check("create_refund_request", {"amount": 199.0}, "C007", NOW).action == "confirm"


def test_grant_expires() -> None:
    p = DecisionPolicy(grants=[grant_once("C007", "change_plan", None, NOW, minutes=30)])
    assert p.check("change_plan", {}, "C007", NOW + timedelta(minutes=31)).action == "confirm"


def test_every_write_tool_is_not_autonomous() -> None:
    writes = {"create_refund_request", "change_plan", "close_account", "change_payment_method"}
    assert all(TOOL_TIERS[t] is not Tier.AUTONOMOUS for t in writes)


def test_every_check_is_audited() -> None:
    p = DecisionPolicy()
    for tool in ["search_kb", "close_account", "nope"]:
        p.check(tool, {}, "C007", NOW)
    assert [a["action"] for a in p.audit] == ["allow", "hand_to_user", "deny"]
```

<div class="line-notes">

- `def test_unknown_tool_is_denied()` 默认拒绝。这条测试防的是以后有人把 `TOOL_TIERS.get(tool)` 改成带默认值 `Tier.AUTONOMOUS` 图省事。
- `def test_user_only_never_runs_even_with_grant()` 仅限本人的操作,哪怕有授权记录也不执行。授权记录可能是被注入攻击伪造出来的,这一类操作根本不该走授权这条路。
- `"C009", NOW).action == "confirm"` C007 的授权不能被 C009 用,授权是按人的。
- `def test_grant_expires()` 30 分钟的授权在第 31 分钟失效。
- `def test_every_write_tool_is_not_autonomous()` 一条「元测试」:所有写操作都不能是自主决策。以后有人把 `change_plan` 改成 `AUTONOMOUS`,这里会挂,逼着他在 MR 里解释为什么。
- `def test_every_check_is_audited()` 三种结果都进了审计,顺序对。

</div>

```bash
uv run pytest -q topics/china_compliance
```

我实测是 `6 passed`,basedpyright standard 档 0 个错误。

**练习**

1. **接进 Agent 循环。** 把 `DecisionPolicy.check` 接到 Day 9 手写循环(或 Day 47 的 LangGraph 工具节点)里执行工具之前。`confirm` 时用 Day 25 的 `interrupt` 停下来问用户,用户同意后调用 `grant_once` 再重试;`hand_to_user` 时让 Agent 回复一个去「账户设置」页面的链接;`deny` 时把理由作为工具错误返回给模型,让它换个做法。
2. **登记表进 CI。** 写一个测试,从 Day 46 的工具注册表(或 MCP server 的 `list_tools`)里取出所有工具名,断言每个都在 `TOOL_TIERS` 里。新加工具忘了登记,CI 直接挂。
3. **做合规自查表。** 新建 `topics/china_compliance/checklist.md`,按下面的表逐行填 SupportPilot 的现状,「现状」写你的实现在哪个文件、哪一天做的,没做的写「未做」。

| 来源 | 要求 | SupportPilot 适用吗 | 现状 |
| --- | --- | --- | --- |
| 拟人化办法第二条 | 判断是否持续性情感互动 | 不适用,写明理由 | |
| 实施意见第 6 条 | 三类决策分级、授权范围、知情权 | 适用 | |
| 实施意见第 7 条 | 行为可追溯 | 适用 | |
| 实施意见第 9 条 | 扩展工具供应链安全 | 适用 | |
| 标识办法第四条 | 交互界面显著提示 AI | 适用 | |
| 标识办法第四条第二款 | 导出、下载的文件带显式标识 | 有导出功能时适用 | |
| 标识办法第五条 | 文件元数据隐式标识 | 有导出功能时适用 | |
| 清朗第一阶段第二类 | 安全围栏、回复中的链接审核 | 适用 | |
| 清朗第一阶段第四类 | 引用信源标注链接 | 适用 | |
| 清朗第一阶段第六类 | 防止智能体窃取用户数据或密钥 | 适用 | |
| Day 86 | 模型备案或登记、公示 | 面向公众时适用 | |

4. **(选做)隐式标识。** 给 SupportPilot 导出的工单处理报告加隐式标识。标识办法第五条要求元数据里包含「生成合成内容属性信息、服务提供者名称或者编码、内容编号等制作要素信息」。按全国网安标委实践指南和一些厂商文档,GB 45438-2025 里的字段名是 `Label`、`ContentProducer`、`ProduceID` 等,这是二手信息,动手前去全国标准信息公共服务平台核对 GB 45438-2025 原文。

**验收标准**:demo 的输出和上面一致;6 个测试全绿;练习 2 的 CI 测试能在你故意加一个没登记的工具时失败;自查表每一行都填了「适用吗」和「现状」,不适用的写出了依据的条款。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 《实施意见》 | 《智能体规范应用与创新发展实施意见》,网信办、发改委、工信部 2026 年 5 月发布的政策文件,本身没有罚则 |
| 三类决策 | 《实施意见》第 6 条:仅限用户本人决策、需由用户授权决策、智能体自主决策 |
| 拟人化互动服务 | 拟人化办法第二条:模拟自然人人格特征、思维模式和沟通风格的持续性情感互动服务 |
| 部门规章 | 国务院部门以「令」的形式发布的规定,有法律约束力,比如拟人化办法是五部门令第 21 号 |
| GB / GB/T / GB/Z | 强制性国家标准 / 推荐性国家标准 / 国家标准化指导性技术文件,约束力依次变弱 |
| GB/Z 185 | 《人工智能 智能体互联》系列,7 个部分,2026 年 5 月 22 日发布 |
| 智能体身份码 | GB/Z 185.2 规定的智能体唯一标识,由注册服务方统一分配 |
| AIP | 智能体互联协议,《实施意见》第 3 条点名推广 |
| 显式标识 / 隐式标识 | 用户能直接感知的 AI 提示 / 写在文件元数据里的标识(标识办法第三条) |
| 安全评估 | 拟人化办法第二十二条:上线、重大变化、注册用户 100 万或月活 10 万以上等情形要做并上报省级网信部门 |
| 算法备案 | 按《互联网信息服务算法推荐管理规定》向网信部门备案算法 |
| 清朗专项 | 中央网信办的专项整治行动,「整治 AI 应用乱象」从 2026 年 4 月 30 日部署,为期 4 个月 |
| 默认拒绝 | 没有明确登记的工具或权限一律不允许,和「默认允许」相对 |

## 常见误区

**以为所有 Agent 都要遵守拟人化办法。** 第二条第三款写明,智能客服、知识问答、工作助手等不涉及持续性情感互动的不适用。先判断适用性,再谈功能。

**以为客服 Agent 加了人设就没事。** 适用性看的是有没有「持续性的情感互动」,不看你叫它什么。人设、记住用户的私事、主动聊情绪,做多了就可能滑过去。需求评审时就要把线画清楚。

**把《实施意见》当成已经生效的强制规定。** 它是政策意见,不直接设罚则。里面说的「智能体备案」「注册平台」是方向,还没有对应的具体办法。但它是后续立法的风向标,第 6 条现在就照着做也没有坏处。

**听说「智能体国标」就以为必须对接。** GB/Z 185 是指导性技术文件,不强制。现在的价值是理解思路;做敏感行业的要关注后续要求。

**以为授权就是一个布尔值。** 授权要有对象、范围、金额、时效、一次性,还要记下用户是怎么授权的。「用户同意过」不等于「用户同意了这一笔」。

**只给监管看、不给用户看。** 第 6 条要求的是用户的知情权。审计日志存在后台不够,用户要能在界面上看到 Agent 替他做了什么、能推翻。

**把两小时提醒理解成「每两小时弹一次就行」。** 办法写的是「连续使用每超过 2 个小时」,「连续」怎么定义办法没写,要和法务定口径、写进文档、测试里覆盖边界。

## 学习资料

### 文档与文章

- [网信办 ·《智能体规范应用与创新发展实施意见》全文](https://www.cac.gov.cn/2026-05/08/c_1779979789523320.htm):重点读第三部分「守牢安全底线」的第 5 到 14 条,20 分钟。
- [网信办 ·《人工智能拟人化互动服务管理暂行办法》全文](https://www.cac.gov.cn/2026-04/10/c_1777558395078289.htm):32 条全读,先读第二条判断适用性,40 分钟。
- [网信办 · 拟人化互动办法答记者问](https://www.cac.gov.cn/2026-04/10/c_1777558395284407.htm):官方对适用范围、干预提醒、未成年人条款的解释,15 分钟。
- [网信办 · 拟人化互动办法征求意见稿](https://www.cac.gov.cn/2025-12/27/c_1768571207311996.htm):和正式版对比,能看出哪些地方改了,适合想深入的人。按需。
- [China Law Translate · 拟人化互动办法英文译本](https://www.chinalawtranslate.com/?p=22483):海外面试或给外籍同事解释时用。按需。
- [网信办 ·《人工智能生成合成内容标识办法》](https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm):第三到第五条讲显式和隐式标识,15 分钟。
- [网信办 ·《互联网信息服务算法推荐管理规定》](https://www.cac.gov.cn/2022-01/04/c_1642894606364259.htm):拟人化办法第二十六条引用的算法备案依据,读备案相关条款,15 分钟。
- [全国标准信息公共服务平台 · GB/Z 185.1-2026](https://openstd.samr.gov.cn/bzgk/gb/newGbInfo?hcno=CFF03D872963466AC7F03ED0E28B6702):总体架构部分的官方条目,发布日期和发布单位以这里为准;在平台上搜「智能体互联」能看到全部 7 项。
- [21 世纪经济报道 ·《人工智能 智能体互联》系列国家标准解读](https://m.sfccn.com/2026/7-3/3OMDE1MzFfMjE3MzM3OA.html):7 个部分各管什么、五个概念域的中文解读,15 分钟。
- [央视网 · 国内首个智能体互联标准体系在京发布](https://city.news.cctv.com/2026/07/23/ARTItqT93iLa5VKjhRuo6TYs260723.shtml):身份码首批发放的报道,5 分钟。
- [新华网 · 中央网信办部署「清朗·整治 AI 应用乱象」专项行动](https://www.news.cn/politics/20260430/5a335918ff184d098c169c3dc0401508/c.html):两个阶段、14 类问题的完整清单,自查时逐条对,20 分钟。
- [财联社 · 豆包、千问即将下线智能体功能](https://www.cls.cn/detail/2417079):7 月的产品调整报道,5 分钟。
- [artificialintelligenceact.eu · 第 50 条](https://artificialintelligenceact.eu/article/50/):欧盟透明度义务原文,对照表用,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1c2DQB6EKF&autoplay=0&high_quality=1" title="《人工智能拟人化互动服务管理暂行办法》7月15日施行，严禁向未成年人提供虚拟伴侣等服务" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>央视财经 · 《人工智能拟人化互动服务管理暂行办法》7 月 15 日施行,严禁向未成年人提供虚拟伴侣等服务 · 33 秒。官方媒体在公布当周的要点概括,看它强调了哪几条。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1euNi66EaW&autoplay=0&high_quality=1" title="7月15日起，AI拟人化互动服务新规开始施行" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>央视频 · 7 月 15 日起,AI 拟人化互动服务新规开始施行 · 44 秒。施行当天的报道,和上一个对照着看。</figcaption>
</figure>

- [暴躁哐哐 · 生成合成算法备案实战指南](https://www.bilibili.com/video/BV1z9bSzhENu):6 分钟,Day 86 推荐过,一个开发者走备案被退回四次的经历,拟人化办法第二十六条要求的算法备案就是这个流程。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/aWsAgSLDmn0" title="Your Chatbot Must Now Say It's AI — EU AI Act Article 50" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Relay Labs · Your Chatbot Must Now Say It's AI, EU AI Act Article 50 · 欧盟第 50 条对聊天机器人的要求,和国内标识办法第四条对照着看。</figcaption>
</figure>

- [Brookings Institution · How China and the US will regulate AI models for safety](https://www.youtube.com/watch?v=sW_gcq7YsTY):智库视角讲中美两边的监管思路差异,适合准备海外面试时听。

### 书籍

今天这组不需要。这几份文件都是 2026 年的,书跟不上,读原文就是最好的材料。想补背景的话,Day 86 推荐的资料仍然适用。

### 开源项目与代码

- 今天没有必须看的开源项目。AIP 的开源实现据报道在 AtomGit 上,有兴趣可以在 AtomGit 按「AIP 智能体互联」搜索,和 Day 93 你写的最小 A2A 服务端对比一下身份和发现的做法。

## 自测

**1. SupportPilot 是 CloudLedger 的客服工单 Agent,它适用《人工智能拟人化互动服务管理暂行办法》吗?依据是什么?什么样的需求改动会让它变得可能适用?**

<details><summary>答案</summary>

按字面不适用。办法第二条第三款写明,提供智能客服、知识问答、工作助手等服务,不涉及持续性情感互动的,不适用本办法。会让它变得可能适用的改动是往「持续性情感互动」方向走:给它一个模拟真人的人设、长期记住用户的个人情感话题、主动和用户聊情绪、以陪伴为目的设计对话。需求评审时要明确客服 Agent 不做持续性情感陪伴,遇到用户情绪问题给简短回应和求助渠道后回到业务。最终是否适用由法务判断。

</details>

**2. 《实施意见》第 6 条把决策分成哪三类?在你的 Agent 里分别怎么处理被拦下的情况?**

<details><summary>答案</summary>

仅限用户本人决策、需由用户授权决策、智能体自主决策。智能体自主决策的直接执行,但要让用户能看到(知情权);需由用户授权的,没有有效授权就暂停回去问用户,授权要有范围、金额、时效,一次一用;仅限用户本人的,Agent 不执行,也不接受授权,只给用户一个自己操作的入口。另外,没有登记层级的工具一律拒绝。

</details>

**3. 拟人化办法里,哪些条款会变成会话层或账号层的具体功能?举四个。**

<details><summary>答案</summary>

第十八条:显著提示用户在和 AI 互动;发现过度依赖时弹窗动态提醒;连续使用每超过 2 小时提醒使用时长。第十三条:识别极端情绪并生成安抚和求助内容,极端情境下干预并联络监护人或紧急联系人(这要求第十二条注册时收集紧急联系人)。第十四条:未成年人模式,包括切换、现实提醒、时长限制、监护人功能,以及识别未成年人身份。第十六条:提供聊天记录复制、删除选项,交互数据不得未经同意提供给第三方。第十九条:便捷退出,用户要求退出时立即停止,不得纠缠。

</details>

**4. GB/Z 185 的「Z」是什么意思?它和 MCP、A2A 怎么对照?最明显的不同是什么?**

<details><summary>答案</summary>

GB/Z 是国家标准化指导性技术文件,约束力弱于推荐性的 GB/T 和强制性的 GB,不强制执行。对照上,185.4 智能体描述和 185.5 发现对应 A2A 的 Agent Card 和 well-known 发现,185.6 交互对应 A2A 的任务和消息,185.7 工具调用对应 MCP 那一层。最明显的不同是 185.2 和 185.3:有统一分配的身份码和身份注册管理体系,一个身份码对应一个智能体;A2A 的身份靠各家域名和签名,是去中心化的。

</details>

**5. 面试题:你要给一家国内银行做一个面向个人客户的理财咨询 Agent,上线前合规上你会主动和法务对哪些点?**

<details><summary>答案</summary>

先定性:面向境内公众,底层模型要用已备案的,应用要做登记并公示模型和备案号(Day 86);理财属于《实施意见》第 11 条说的敏感领域和重点行业,关注后续的备案、检测要求,也要符合金融主管部门的规定(拟人化办法第三十一条也提到金融服务要同时符合主管部门规定)。产品形态上确认不做持续性情感互动,否则适用拟人化办法。决策分级:查询和解释类自主,任何下单、转账、赎回必须用户本人确认或授权,授权有金额和时效,对应第 6 条。标识:界面显著提示 AI,导出的报告加显式和隐式标识。内容安全:回复中的链接审核、引用信源标链接(清朗专项点名),防止注入导致泄露账户信息。数据:交互数据流向哪些第三方(模型 API、可观测平台),是否出境,用于训练是否取得单独同意。还要准备审计和日志留存方案。

</details>

**6. 清朗专项第一阶段里有一条和 RAG 直接相关,是哪一条?你在课程里哪一天做过对应的事?**

<details><summary>答案</summary>

第四类「AI 数据投毒问题」里的一句:在模型生成回答过程中,对引用信源缺乏交叉验证和风险提示机制,未标注引用信息链接。对应 Day 21 的带引用出处的文档问答,以及 Day 45 SupportPilot 知识库模块的引用格式。交叉验证可以对应 Day 19 讲的忠实度评测和多来源检索。

</details>

## 明天预告

Day 153 是专题篇的最后一篇,讲行业里的 Agent:金融、医疗、电商、SaaS 客服各长什么样。今天的合规内容明天会用上:每个行业的「合规红线」那一栏,有一半就来自今天读过的这些条文。专题篇可以跳着读,前面的二十多个专题里挑你需要的看就行。
