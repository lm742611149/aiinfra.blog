---
title: 'Day 56 · 简历:AI Agent 岗的简历怎么写'
description: '用 880 条真实 JD 的技能频次给简历做关键词对照,把 SupportPilot 和代码审查 Agent 写成「问题、方案、数据」三段式的项目经历,把原来的工作经历诚实地往 AI 方向改写,并正面处理年限和学历门槛。最后产出中英文两版一页简历。'
pubDate: 2026-10-12
regime: none
tags: ['resume', 'job-search', 'jd', 'portfolio', 'career', 'agent-60']
series: 'agent-60'
day: 56
lang: 'zh'
---

## 今天要解决的问题

两个作品都做完了,接下来五天全部用来找工作。第一件事是简历,因为它决定了你有没有机会把作品讲给面试官听。

今天结束时你应该有:

1. 一张「JD 关键词 → 你的证据」对照表,说得出每个高频技能在你简历的哪一行有证据,哪几个是空白。
2. 两段写好的项目经历(SupportPilot 和代码审查 Agent),每段都是「问题、方案、数据」的结构,数据全部来自你自己的记录表。
3. 一段改写过的工作经历,诚实地突出和 Agent 岗相关的那部分能力。
4. 一份 300 字左右的「代表项目说明」,很多公司会单独要。
5. 中文版和英文版各一页的简历 PDF,链接都能点。

预计用时 4–6 小时。前置是 Day 54 的 README 和结果表、Day 55 的评测数字。

## 先看招聘方到底要什么

写简历之前先读 JD,而且不是读一两份,是读一批。站长在 2026 年 10 月 12 日做了一次调研,一共收了 880 条 AI Agent 相关岗位:国内 695 条,海外 185 条。国内分两批:第一批 120 条来自腾讯、字节、美团、百度、网易、京东的招聘官网,加上智联招聘、Boss 直聘截图和 V2EX;第二批是用站长自己的账号登录后抓的 Boss 直聘 435 条和猎聘 140 条,以中小公司和各行业的业务团队为主。海外来自 LinkedIn、新加坡政府职位库 MyCareersFuture、Hacker News 十月招聘帖,以及 OpenAI、Anthropic、Sierra、Decagon 等公司在 Ashby/Greenhouse/Lever 上的公开职位。

技能比例只能用有 JD 正文的那部分算:国内 334 条(Boss 列表大多只有标题和薪资,只有 74 条抓到了正文),海外 185 条。比例是用关键词在 JD 全文里匹配出来的,不是人工标注,只用来看方向,差五个百分点以内的不要当回事。

| 技能 | 国内(334 条) | 海外(185 条) | 你在课程里哪天学的 |
| --- | --- | --- | --- |
| Python | 65% | 63% | Day 2 起全程 |
| LLM API / Function Calling / Tool Use | 55% | 39% | Day 3、Day 8–11 |
| Context Engineering / 记忆 | 52% | 25% | Day 20、Day 48 |
| RAG / 检索 | 51% | 54% | W3、Day 45 |
| 评测 Eval | 48% | 62% | W5、Day 50–51 |
| Prompt 工程 | 46% | 46% | Day 5 |
| Agent 框架(LangChain/LangGraph 等) | 46% | 36% | Day 24–27 |
| 部署 / Docker / K8s / 云 | 39% | 53% | Day 41、Day 53 |
| 全栈 / 前端 | 38% | 29% | Day 49(Streamlit) |
| 多 Agent | 37% | 22% | Day 26 |
| 面向客户 / 交付 | 33% | 46% | Day 43 |
| SQL / 数据系统 | 31% | 41% | Day 17、Day 46 |
| 成本 / 延迟 / ROI | 31% | 39% | Day 38、Day 52 |
| 高并发 / 分布式 | 28% | 50% | 你原来的后端经验 |
| 微调 / RL | 23% | 19% | 课程不涉及 |
| Java | 23% | 10% | 你原来的经验 |
| Go | 23% | 14% | 课程不涉及 |
| 熟练用 Coding Agent | 21% | 15% | Day 55 |
| 可观测 / Tracing | 21% | 31% | Day 34、Day 52 |
| MCP | 17% | 16% | Day 22–23、Day 46 |
| 安全(注入/权限/沙箱) | 11% | 22% | Day 39–40、Day 53 |
| Skills | 10% | 3% | Day 27 |

几个读法:

国内 JD 更关心 Agent 内部是怎么工作的。上下文工程(52% 对 25%)、工具调用(55% 对 39%)、多 Agent(37% 对 22%)这几项国内明显更高;只看大厂官网那 120 条,上下文工程更是到了 66%,腾讯、美团、字节好几个岗位的标题直接就叫「Agent Harness 工程师」。MCP 两边差不多(17% 和 16%),不算国内特有的要求。你在简历里不能只写「用 LangGraph 搭了一个 Agent」,要写出你处理了上下文压缩、工具失败重试、子 Agent 隔离这些具体问题。

评测是两边都看重的硬通货,海外 62%,国内 48%(大厂官网样本里是 56%)。腾讯一个 Agent Harness 岗位的原话是「使每次 Prompt、模型、工具变更都有量化的收益与回归判定」;智联上一家公司要求候选人「能讲清上线后效果指标是多少、是怎么测出来的」。你的项目经历里如果没有一个带口径的评测数字,基本等于没写。

真实上线经验比框架名重要。海外 JD 几乎每条都写 shipped to production;国内中小公司常见的说法是「至少 1 个已上线的大模型应用项目,本人承担主要开发」。你的 SupportPilot 有公网地址、有限流、有预算闸,这就是「上线」,把这一点写出来。

还有两个你在课程里只碰到边的高频项:高并发分布式和 SQL。好消息是,如果你是后端出身,这正是你原来工作经历里有的东西,不需要从课程里找证据。

## 关键词对照表:先找证据,再写句子

拿到一份想投的 JD,先别急着改简历,做一张三列的表:

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="JD 关键词到简历证据的对照方法">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
  <text x="20" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">JD 关键词</text>
  <text x="230" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">你的证据(可被追问)</text>
  <text x="460" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">简历里的一行</text>
  <rect x="16" y="44" width="180" height="36" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="26" y="67" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">评测与回归</text>
  <rect x="226" y="44" width="200" height="36" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="236" y="67" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">100 条测试集+CI 门禁</text>
  <rect x="456" y="44" width="168" height="36" fill="none" stroke="var(--rule)"/>
  <text x="466" y="67" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">项目 1 第 2 条</text>
  <rect x="16" y="94" width="180" height="36" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="26" y="117" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">上下文工程</text>
  <rect x="226" y="94" width="200" height="36" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="236" y="117" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">稳定前缀·摘要压缩</text>
  <rect x="456" y="94" width="168" height="36" fill="none" stroke="var(--rule)"/>
  <text x="466" y="117" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">项目 1 第 3 条</text>
  <rect x="16" y="144" width="180" height="36" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="26" y="167" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">K8s</text>
  <rect x="226" y="144" width="200" height="36" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
  <text x="236" y="167" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">没有 → 不写</text>
  <rect x="456" y="144" width="168" height="36" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
  <text x="466" y="167" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">面试时如实说</text>
  <text x="20" y="214" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">中间一列空着的关键词,宁可不写也不要硬凑</text>
</svg>
<figcaption>简历上每一个技能词都应该能在中间那列找到一个经得起三层追问的证据。找不到证据的词,写上去就是给面试官递刀。</figcaption>
</figure>

具体做法:

1. 把 JD 的职责和要求逐条拆成关键词,用 JD 原文的写法(它写「Context Engineering」你就别写成「上下文管理」,很多公司的简历筛选是按关键词搜索的,包括 Boss 直聘上招聘方搜人)。
2. 每个关键词在中间列写一个具体证据:哪个项目、哪个模块、哪个数字。
3. 证据能对上的,在右列标出它在简历的哪一行;对不上的,判断是「我会但没写」还是「我真不会」。前者补一行,后者别写。

做三五份 JD 之后你会发现,90% 的关键词是重复的。这时候把高频的那些固定写进简历的通用版本,投具体岗位时再微调技能栏的顺序和项目要点的先后。

## 项目经历:问题、方案、数据

这是简历里最重要的部分。我见过太多这样的写法:

> SupportPilot 智能客服 Agent
> 技术栈:Python、LangGraph、RAG、MCP、pgvector、FastAPI、Docker、Langfuse
> 负责系统的设计与开发,实现了工单分类、知识检索、工具调用、回复生成等功能,提升了客服效率。

这一段的问题是没有任何一句话能被验证,也没有任何一句话会让面试官想追问。「提升了客服效率」提升了多少?怎么测的?

改成三段式,每条要点都包含「做了什么具体的事」和「结果是什么数字」:

> **SupportPilot · SaaS 客服工单 Agent**(个人项目,2026.10)· 演示:demo.你的域名 · GitHub:github.com/你的用户名/supportpilot
> - 用 LangGraph 编排「分类、混合检索、MCP 业务工具、起草、自检」五节点工作流,退款类操作通过 interrupt 进入人工审批;在 100 条测试工单上端到端任务成功率 xx%。
> - 建立三层评测(规则断言、LLM-as-judge、轨迹检查)并接入 GitHub Actions 回归门禁;judge 与人工标注一致率 xx%,依据错误分析迭代 x 轮,成功率从 xx% 提升到 xx%。
> - 通过稳定 prompt 前缀(缓存命中率 x% → y%)和大小模型路由,单工单成本从 ¥0.xx 降到 ¥0.0x,评测分数下降 x 个点以内;按转人工率和复核时长测算,单工单综合成本约为纯人工的 x%。
> - 设计 24 条注入测试用例覆盖越权查询、绕过审批、间接注入等六类攻击;将客户身份绑定在工具层、退款只能申请不能执行,越权和绕过审批两类成功率降为 0。

数字全部用 xx 代替了,因为必须换成你自己记录表里的值。这条规则没有例外:简历上的每个数字,面试官问「怎么测的」,你都要能当场讲清楚口径。宁可写「在 100 条测试工单上」这种朴素的口径,也不要写一个看起来很厉害但说不清来源的数。

注意第一行的「个人项目」。课程里的项目就是个人项目,不要包装成「某公司智能客服系统」,也不要把它写进工作经历。面试官一问细节(「你们公司日均多少工单?」),包装立刻穿帮,而且会让他怀疑你简历上的其他内容。个人项目只要做得扎实,一点都不丢人。调研里一个要求硕士学历的 LLM Agent 系统开发岗,加分项里就明确写着「个人项目或开源贡献均可」。

第二个项目(代码审查 Agent)写两三条就够,重点放在它和第一个项目不同的地方:diff 解析和行号校验、埋 bug 评测集上的召回和有用率、阈值选择的取舍。

## 工作经历:诚实地换个角度写

如果你原来是后端工程师,你的工作经历里有大量 Agent 岗位需要、但你可能没意识到的东西。关键是换个角度描述同一件事,而不是编造没做过的事。

拿一个做过 B2B 订阅计费系统的后端举例:

| 原来的写法 | 换个角度(同一件事,没有编造) | 对上了 JD 的哪个词 |
| --- | --- | --- |
| 负责计费模块开发 | 负责订阅计费核心链路,处理按比例计费、发票生成、与支付网关和 CRM 的双向同步 | 企业系统集成、SQL |
| 参与线上问题排查 | 主导 x 起跨服务数据不一致问题的根因分析,用日志和链路追踪定位,沉淀排查手册 | 可观测、Tracing |
| 写单元测试 | 为计费规则建立回归测试集 x 条,作为发布门禁 | 评测、回归 |
| 对接审批流 | 设计退款审批流程,敏感操作双人复核并留审计日志 | 人工审批、安全 |
| 使用 Claude Code 写代码 | 日常用 Claude Code 等 Coding Agent 开发,建立了针对生成代码的审查清单(测试是否被改、异常是否被吞等) | 熟练用 Coding Agent |

最后一行值得多说一句:国内约两成(21%)的 JD 点名要求熟练使用 Claude Code、Cursor、Codex,有的还要求「把控生成代码质量」。如果你在工作中确实在用,写出来,并且写出你怎么控制质量(Day 55 那张清单),这是很多候选人会忽略的加分项。没用过就别写,这种东西面试时聊两句就露馅。

如果你原来是测试、前端或数据岗,思路一样:测试工程师的用例设计和回归体系对应评测,前端工程师的流式渲染和交互对应 Agent 的前端体验(国内 JD 里提全栈或前端的有 38%),数据工程师的数据清洗和 SQL 对应 RAG 的数据处理和 text-to-SQL。

## 年限和学历门槛,怎么面对

这部分不好听,但必须说清楚。

**年限**:国内 Boss 和猎聘列表里,要求 3–5 年的最多(Boss 31.5%、猎聘 43.6%),其次是「经验不限」(Boss 23.9%)和 1–3 年(猎聘 20.7%);海外写了年限的岗位中位数是 5 年。大多数 JD 里的年限指的是总的软件开发经验,而不是 AI 经验,所以一个有 3 年后端经验的人看到「3–5 年」的 Agent 岗是可以投的。也有岗位会单独写 AI 年限,比如智联上一个 FDE 岗写的是「1–3 年开发工作经验,其中至少 1 年与 AI 应用 / Agent 开发 / 大模型落地相关」。遇到这种要求,两个月的个人项目算不上一年的 AI 工作经验,不要硬凑,但可以投,在简历和面试里坦率说明你 AI 方向的经验来自哪里,用作品的深度去弥补。被拒很正常,不必内耗。

**学历**:国内大约八成岗位写的是本科(Boss 列表 80.5%、猎聘 79.3%),明确要求硕士或博士的大约一成(Boss 9.4%、猎聘 12.1%);卡得更严的是大厂和算法味重的岗位,只看大厂官网那 120 条,有 12 条提到硕士。海外基本不提学历。卡硕士的岗位,本科靠作品集很难越过简历初筛,因为很多公司的筛选是 HR 或系统按条件过滤的,作品集根本没机会被看到。现实的策略是:八成岗位本科就够,把精力优先放在这些岗位上;对写着「硕士优先」而不是「硕士及以上」的岗位照常投;如果特别想去一个卡学历的团队,找内推,让简历直接到用人经理手里,这是唯一可能绕过筛选的路。

**两个月的课程和三年经验的人比,差在哪?** 差在线上真实流量和真实用户带来的问题。你可以在面试里主动承认这一点,然后讲你用什么方法尽量逼近真实:用评测集替代真实流量,用注入测试替代真实攻击者,用账本替代真实账单。这种自知之明在面试里通常是加分的。

## 代表项目说明:300 字写清四件事

越来越多的公司会在简历之外要一段项目说明。前面提到的那个智联岗位,投递要求里写得很具体:「挑一个你做过的大模型 / AI 相关项目,写清楚四件事:数据从哪来、你怎么处理、上线后效果是多少、如果再给你一次你会改进什么。」

这四个问题本身就是一个很好的框架,即使对方没要,也建议你准备好,面试的自我介绍和项目介绍都能用。用 SupportPilot 写一版:

> **数据从哪来**:虚构 SaaS 公司的 60 余篇帮助中心文章和包含客户、订阅、发票的业务库,均为脚本生成,模拟真实客服场景;另造 100 条测试工单和 24 条注入用例。
> **怎么处理**:帮助中心按标题层级切块,pgvector 向量检索与 BM25 混合后 rerank;业务数据通过 MCP 工具按需查询,客户身份由服务端绑定;LangGraph 编排分类、检索、执行、起草、自检,退款进入人工审批。
> **效果**:100 条测试工单端到端成功率 xx%,P95 延迟 x 秒,单工单成本 ¥0.0x;越权与绕过审批两类攻击成功率为 0。
> **再来一次会改进**:评测集过于依赖合成数据,会更早引入真人编写的工单;自检节点的误拒率偏高,会先做错误分析再决定是否换模型。

这段话里的每一个数字和每一个技术选择,都是面试官接下来会追问的地方。写的时候就要想好追问的答案。

## 一页简历的结构

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="一页简历的版面结构">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <rect x="150" y="14" width="340" height="276" fill="none" stroke="var(--rule)"/>
  <rect x="162" y="24" width="316" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="172" y="44" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">姓名 · 电话 · 邮箱 · GitHub · 演示链接</text>
  <rect x="162" y="60" width="316" height="20" fill="none" stroke="var(--rule)"/>
  <text x="172" y="74" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">一句话定位</text>
  <rect x="162" y="86" width="316" height="28" fill="none" stroke="var(--rule)"/>
  <text x="172" y="104" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">技能(分组,只写能被追问的)</text>
  <rect x="162" y="120" width="316" height="84" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="172" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">项目经历 ×2(问题·方案·数据)</text>
  <text x="172" y="158" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">占版面最大,每条带数字</text>
  <rect x="162" y="210" width="316" height="56" fill="none" stroke="var(--rule)"/>
  <text x="172" y="230" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">工作经历(换角度改写)</text>
  <rect x="162" y="272" width="316" height="14" fill="none" stroke="var(--rule)"/>
  <text x="172" y="283" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">教育</text>
  <text x="500" y="150" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">转方向的人</text>
  <text x="500" y="166" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">项目放工作前</text>
</svg>
<figcaption>转方向的候选人,把项目经历放在工作经历前面。如果你原来的工作就和 Agent 高度相关,反过来放。</figcaption>
</figure>

几条细节:

- **一页**。三年以内经验的人,一页足够;超过一页说明你没取舍。
- **链接要能点**。PDF 里的 GitHub、演示地址、博客必须是可点击的超链接,而且放在顶部。很多人把链接写成纯文本,面试官得手动复制,大多数人不会这么做。
- **技能栏分组写**,比如「Agent 开发:LangGraph、MCP、Function Calling、上下文工程」「检索:pgvector、BM25 混合检索、rerank」「评测与可观测:LLM-as-judge、轨迹评测、Langfuse」「工程:Python、FastAPI、Docker、PostgreSQL」,再加上你原来的主力语言。只写你能被追问三层的东西。
- **一句话定位**写在名字下面,比如「后端工程师(x 年),近期专注 AI Agent 开发,做过带评测和安全测试的客服 Agent 与代码审查 Agent」。
- 中文简历在国内通常会写期望城市和到岗时间;照片可选,大多数技术岗不看。

## 英文版的不同

如果你打算投新加坡、香港或海外岗位,需要一份英文简历。不是把中文版机翻一遍,有几处习惯不同:

- 不写照片、年龄、婚育、籍贯。
- 每条要点用动词过去式开头:Built、Designed、Reduced、Introduced。
- 数字照样要有,英文简历比中文更看重 impact。
- 要点写短,一行到一行半。
- 项目的口径写清楚:「on a 100-ticket eval set」「measured with a self-built cost ledger at DeepSeek's Oct 2026 list prices」。

SupportPilot 第一条的英文版示例:

> - Built a LangGraph workflow (classify → hybrid retrieval → MCP tools → draft → self-check) with human approval for refunds via interrupts; reached xx% end-to-end task success on a 100-ticket eval set.

海外 JD 里「面向客户 / 交付」的比例接近一半,美国本土样本更是过半,很多岗位叫 Forward Deployed Engineer 或 Applied AI Engineer。如果你投这类岗位,英文简历里要有能体现「和客户或业务方一起定义需求、交付、迭代」的经历,Day 59 会单独讲这类岗位。

## 动手练习

**步骤**

1. 从 Boss 直聘、公司招聘官网、LinkedIn 各挑 2 份你真想投的 JD,一共 6 份,做关键词对照表。
2. 统计对照表里中间列为空的关键词,判断哪些是「会但没写」(补进简历),哪些是「不会」(记下来,决定是 Day 60 之后补,还是放弃这类岗位)。
3. 按三段式写两个项目经历,所有数字从 `docs/results.md` 里取,逐个核对。
4. 按「换角度改写」的方法重写最近一段工作经历,每条要点都要你自己确认是真实发生过的。
5. 写 300 字代表项目说明。
6. 排版成一页 PDF,中英文各一份。检查所有链接都能点击、能打开。
7. 找一个在招人的朋友(或开一个新的 Claude 会话扮演面试官),给他 60 秒看简历,问他记住了什么,想追问什么。

**验收标准**

- 简历上每个技能词都能在对照表里找到证据。
- 每条项目要点都有至少一个数字,并且你能讲清口径。
- 没有把课程项目写成公司项目,没有编造工作经历。
- 60 秒测试里,对方能说出你的定位和至少一个项目数字。
- 中英文两版都是一页,链接全部可点。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| JD | Job Description,职位描述,包括职责和任职要求 |
| 关键词对照 | 把 JD 里的技能词逐一对应到你简历上的具体证据 |
| 三段式要点 | 每条项目经历写清「做了什么、怎么做的、结果数字」 |
| 口径 | 一个数字在什么数据上、用什么方法测出来的 |
| 简历初筛 | HR 或系统按学历、年限、关键词等条件过滤简历的环节 |
| 内推 | 由公司在职员工推荐,简历通常直接到用人团队 |
| Agent Harness | 国内大厂常见的岗位方向,指 Agent 的运行底座:循环调度、工具注册、上下文组装、沙箱、checkpoint |
| FDE | Forward Deployed Engineer,驻场或面向客户交付的工程师 |
| impact | 英文简历里指工作带来的可量化结果 |

## 常见误区

**技术栈列得越长越好。** 列了 K8s,面试官就会问 K8s。每个词都是一个可能的追问点,列你答不上来的词等于主动给自己挖坑。

**用形容词代替数字。** 「显著提升」「大幅降低」没有信息量,换成具体数字和口径。

**把个人项目包装成公司项目。** 一追问业务规模就穿帮,而且会连累简历其他内容的可信度。个人项目写清楚是个人项目,用深度取胜。

**一份简历投所有岗位。** 国内大厂偏 Agent 内部机制,海外偏交付和结果,FDE 岗偏客户沟通。至少准备「通用版」和两三个侧重不同的变体。

**看到硕士门槛就全部放弃,或者完全无视。** 区分「硕士优先」和「硕士及以上」,前者照投,后者走内推或放弃。

**简历上写「熟悉 Claude Code」却说不出任何使用心得。** 这项要求现在很常见,面试官会追问你怎么控制生成代码的质量。

## 学习资料

### 文档与文章

- [腾讯 · Agent Harness 工程师](http://careers.tencent.com/jobdesc.html?postId=2098332758412804096):国内大厂 Agent 岗写得最细的 JD 之一,职责里的 tracing、评测、调试工具链,要求里的「Coding Agent 典型 failure mode」,对照你的简历逐条看,20 分钟。
- [智联招聘 · AI 大模型应用开发工程师(大国智能网天)](https://www.zhaopin.com/jobdetail/CCL1269552950J40849301316.htm):中小公司 JD 的典型,「代表项目说明」的四个问题就来自这里。
- [智联招聘 · AI 智能体(FDE)工程师(中兵数字)](https://www.zhaopin.com/jobdetail/CCL1276161630J40883543101.htm):看国内 FDE 岗怎么写年限要求和 Coding Agent 要求。
- [网易 · Agent 应用开发工程师](https://hr.163.com/job-detail.html?id=76697):职责里「搭建智能体运行效果监控指标」「集成至智能客服」和 SupportPilot 几乎一一对应。
- [The Tech Resume Inside Out](https://thetechresume.com/):Gergely Orosz 写的技术简历指南的官网,有样章和模板。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1DCDjBRExV&autoplay=0&high_quality=1" title="时隔六年,曝光一下我的最新简历!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员鱼皮 · 时隔六年,曝光一下我的最新简历! · 22 分钟,看一份真实的技术简历怎么排版、项目怎么取舍,不必照搬他的风格。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1hubZ6WEfU&autoplay=0&high_quality=1" title="我的AI Agent面试复盘。纯是个人的分享和总结,未必准确,期待大家交流指正哈哈哈哈!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>假如今天可以躺平 · 我的AI Agent面试复盘 · 36 分钟,2026 年 8 月发布。今天先看面试官围绕简历上的项目追问了什么,倒推你的简历每一行要准备到什么深度;明天会再用到它。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/SYlB9JcoJng" title="The Tech Resume Inside-Out with Gergely Orosz [Coding Career Chats]" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Shawn Wang (swyx) · The Tech Resume Inside-Out with Gergely Orosz [Coding Career Chats] · 前 Uber 工程经理聊招聘方怎么读简历,适合准备英文简历时看。</figcaption>
</figure>

### 书籍

- Gergely Orosz《The Tech Resume Inside Out》(自出版,2020):约 200 页,讲招聘流程里简历的作用、不同资历的写法,含模板和改写前后的真实案例。读讲招聘流程和改写案例的部分,2 小时。

### 开源项目与代码

- [AmruthPillai/Reactive-Resume](https://github.com/AmruthPillai/Reactive-Resume):开源的简历编辑器,可以自托管,导出 PDF 链接可点击。
- [Overleaf 简历模板](https://www.overleaf.com/latex/templates):英文简历常用 LaTeX 模板,排版干净。

## 自测

1. 根据调研数据,国内和海外 Agent 岗 JD 最大的侧重点差异是什么?这对你写简历有什么影响?

<details><summary>答案</summary>

国内更看重 Agent 内部机制:上下文工程(52% 对 25%)、工具调用(55% 对 39%)、多 Agent(37% 对 22%)、Skills 都明显更高,大厂常见 Agent Harness 方向,MCP 两边持平;海外更看重交付、结果和面向客户,部署、SQL、客户交付比例更高。所以投国内岗时项目要点要写出你处理了哪些 Agent 内部问题,投海外岗时突出上线、结果数字和与业务方协作。

</details>

2. 下面这条项目要点有什么问题?「基于 RAG 技术构建知识库问答,大幅提升了回答准确率。」改写它。

<details><summary>答案</summary>

没有具体做法,没有数字,没有口径。改写示例:「帮助中心按标题层级切块,pgvector 向量检索与 BM25 混合后 rerank;在 30 条检索测试集上 recall@5 从 xx% 提升到 xx%。」数字换成你自己的测量值。

</details>

3. 一个岗位写「硕士及以上学历,3 年以上 Agent/RAG 落地经验」,你是本科、5 年后端、两个月 Agent 个人项目。投不投?怎么投?

<details><summary>答案</summary>

这个岗位有两道硬门槛都不满足:学历是「及以上」不是「优先」,AI 落地经验也不够。直接海投大概率过不了初筛。如果特别想去,找内推让简历直接到用人团队,并在简历和沟通里坦率说明 AI 经验来自个人项目、用作品深度说话;否则把精力放在不卡学历的岗位上。

</details>

4. 为什么建议把课程项目明确标成「个人项目」,而不是写进工作经历?

<details><summary>答案</summary>

面试官一追问业务规模、团队、真实流量就会穿帮,而且一处不实会让对方怀疑简历其他内容。个人项目本身是被认可的,不少 JD 加分项里明确写了「个人项目或开源贡献均可」,关键是做得深、有数字、讲得清。

</details>

5. (面试题)「请用两分钟介绍一个你最有代表性的 AI 项目。」用「数据从哪来、怎么处理、效果多少、再来一次怎么改」四段写出提纲。

<details><summary>答案</summary>

参考今天的 300 字说明:数据来源说清是合成数据以及为什么这样设计;处理部分抓两三个关键技术决策(混合检索、身份绑定在工具层、人工审批),每个准备好被追问;效果给两三个带口径的数字;改进部分给出真实的不足和你的计划。讲的时候留钩子让面试官追问你准备最充分的地方。

</details>

6. 你在工作中天天用 Cursor,简历上该怎么写这件事才有说服力?

<details><summary>答案</summary>

不只写「熟练使用 Cursor」,而是写使用方式和质量控制,例如「日常使用 Cursor/Claude Code 开发,建立生成代码审查清单(检查测试是否被修改、异常是否被吞、新增依赖与外部调用),并通过 AGENTS.md 固化项目约定」。面试时能讲出 Coding Agent 典型的失败模式和你遇到过的具体例子。

</details>

## 明天预告

Day 57 · 面试(一):高频基础题 60 道。简历投出去之后,接到的第一轮技术面通常是基础题加项目追问。明天按 LLM 基础、提示词、工具调用、RAG、Agent 架构与框架原理、上下文工程、MCP 与 Skills、评测、安全与工程化分组整理 60 道高频题,每道题给答题要点,答案折叠,先自己说一遍再看。
