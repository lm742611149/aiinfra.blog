---
title: 'Day 109 · 开源与技术影响力:贡献、写作、演讲'
description: '资深面试里最有说服力的证据,往往是面试官能自己点开看的东西:一个被合并的 PR、一篇有数据的技术博客、一次分享的录像。今天讲怎么给 MCP 和 Agent 框架提一个能被合并的 PR,在 AI 生成 PR 泛滥的 2026 年要注意什么,怎么写技术博客和做分享,以及这些对国内资深岗和海外远程岗到底有多大用。'
pubDate: 2026-10-12
regime: none
tags: ['open-source', 'github', 'writing', 'public-speaking', 'career', 'agent-60']
series: 'agent-60'
day: 109
lang: 'zh'
---

## 今天要解决的问题

前两天讲的影响力都在公司内部。今天讲公司外部的影响力:开源贡献、技术写作、公开分享。

先说清楚它的位置。它不是找工作的必需品,很多资深工程师没有一个像样的 GitHub 也照样拿到好 offer。但在两种情况下它特别有用:一是你想换到一个面试官不认识你、你的履历也不够亮的地方;二是你想拿海外远程岗。这两种情况,面试官手里关于你的信息很少,能自己点开看的东西权重就很大。

学完今天你应该能做到:

1. 用 JD 数据判断开源和写作对你的目标岗位大概有多少分量。
2. 挑一个合适的 Agent 或 MCP 相关开源项目,按「文档、测试、修 bug、加功能」的阶梯提出第一个能被合并的 PR。
3. 知道在 AI 生成 PR 很多的 2026 年,维护者对外部贡献的态度变了什么,怎么避免成为被关掉的那种 PR。
4. 写一篇有数据、有踩坑的技术博客,知道发在哪、怎么写标题。
5. 准备一个 15 到 20 分钟的技术分享。

预计用时:今天读完和规划要 3 小时左右,但这一天的练习会持续几周,PR 被合并通常需要来回几轮。前置:Day 54(作品包装)、Day 105(AgentOps 包装)。

## JD 里怎么说

我在 docs/jd-research 的数据里数了一下,有完整正文的 JD 中,明确提到开源项目、开源贡献或者 GitHub 的,国内 334 条里有 55 条(约 16%),海外 185 条里有 26 条(约 14%)。提到技术博客或写作的更少。这是关键词匹配的结果,只能看个大概。

16% 不算高,但看具体怎么写就知道分量。站长截图里的 Boss C(一个硕士门槛的 LLM Agent 岗)写了两条加分项:「有完整的 Agent/LLM 应用项目经验(课程项目、个人项目或开源贡献均可)」和「有技术博客、开源项目或相关竞赛经历」。这类写法的意思是:你没有大厂背景、没有直接的 Agent 工作经验,但能拿出公开的东西证明自己,它们认。

海外远程这块更直接。46 条海外远程岗里,写明「全球任意地点」的只有 3 条,其中一条是 Hacker News 上 Tether 的 AI Harness Engineer。剩下的大多限美加或欧洲。这么窄的门,能挤进去的人通常不是靠投简历,而是对方先在 GitHub、博客或者社区里看到了你。所以如果你的目标里有海外远程,公开影响力不是加分项,是入场方式之一。

还有一点:资深面试官最怕的是候选人把团队的成果说成自己的。公开的 PR 和博客有作者、有时间、有讨论记录,是最难造假的证据。

## 第一个 PR:选项目

选项目的标准:

- **你在用的。** 你用过它、踩过它的坑,才知道哪里值得改。这门课用到的 MCP Python SDK、LangGraph、OpenAI Agents SDK、Langfuse、promptfoo 都是候选。
- **活跃的。** 最近一个月有合并的外部 PR,issue 有人回复。看仓库的 Pulse 页面和最近关闭的 PR 就知道。
- **有贡献指南的。** 有 `CONTRIBUTING.md`、有 `good first issue` 标签,说明维护者欢迎外部贡献,也告诉你规矩。
- **规模合适的。** 太大的项目(几万 star、几百个贡献者)维护者精力被摊得很薄,新人的 PR 可能挂几周;太小的项目可能没人维护。几千 star、有专职维护者的项目往往最友好。

## 贡献的阶梯

<figure>
<svg viewBox="0 0 640 240" role="img" aria-label="开源贡献从低风险到高风险的阶梯">
<rect x="20" y="170" width="140" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="90" y="192" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">提好的 issue</text>
<text x="90" y="209" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">可复现+最小例子</text>
<rect x="170" y="130" width="140" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="240" y="152" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">文档和示例</text>
<text x="240" y="169" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">修错、补例子</text>
<rect x="320" y="90" width="140" height="50" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="390" y="112" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">测试和小 bug</text>
<text x="390" y="129" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">先认领再动手</text>
<rect x="470" y="50" width="150" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="545" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">功能和设计</text>
<text x="545" y="89" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">先在 issue 里讨论</text>
<path d="M 90 170 L 90 150 L 170 150" fill="none" stroke="var(--rule)" stroke-width="1.5"/>
<path d="M 240 130 L 240 110 L 320 110" fill="none" stroke="var(--rule)" stroke-width="1.5"/>
<path d="M 390 90 L 390 70 L 470 70" fill="none" stroke="var(--rule)" stroke-width="1.5"/>
<text x="320" y="30" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">越往右,被合并前需要的信任和沟通越多</text>
</svg>
<figcaption>贡献的阶梯。新人最常见的错误是第一步就跳到最右边,提一个没人讨论过的大功能。</figcaption>
</figure>

**第一级:提一个好 issue。** 很多人觉得 issue 不算贡献。其实一个带最小复现、版本号、期望行为和实际行为的 issue,对维护者价值很高。你在 AgentOps 里踩到的 SDK 问题,就是现成的素材。

**第二级:文档和示例。** 文档里的错别字、过时的 API、缺失的例子。这类 PR 合并快,而且让你熟悉项目的贡献流程(CLA 签署、CI、代码风格、提交信息格式)。Agent 框架的 API 变化快,文档跟不上是常态,机会很多。

**第三级:测试和小 bug。** 从 `good first issue` 或者自己发现的 bug 开始。动手前在 issue 下面留言认领,说明你打算怎么修。这一步省掉了大量白做的工作。

**第四级:功能和设计。** 必须先在 issue 或 discussion 里讨论,得到维护者认可再写代码。不讨论直接提的大 PR,即使写得很好,也经常被以「方向不符」关掉。

Mitchell Hashimoto(HashiCorp 联合创始人、终端模拟器 Ghostty 的作者)写过一篇《Contributing to Complex Projects》,讲怎么进入一个陌生的大代码库:先当用户,再读代码的执行路径,再从小处改。今天的练习建议先读这篇。

## 2026 年的新情况:AI 生成的 PR

这一节是这两年才出现的问题,而且直接关系到你的 PR 能不能被合并。

用 Claude Code、Codex 这类工具生成一个 PR 已经几乎零成本,于是很多热门开源项目收到大量「路过式」PR:改动看起来像样,但作者没理解项目的上下文,没跑过完整测试,维护者 review 一次要花的时间比作者写它的时间还长。B 站上有个视频解读了 Latent Space 的一篇报道:Vercel AI SDK、Astro、tldraw 等项目开始用自己的 Agent 处理 issue、复现 bug、实现功能,一些项目甚至关闭外部 PR,把代码请求转成 issue 或 discussion。

这对你意味着几件事:

- **先读项目对 AI 生成代码的规定。** 越来越多的项目在 `CONTRIBUTING.md` 里写明了要求,比如必须披露是否使用了 AI、必须本人理解并能解释每一行、禁止批量提交。违反规定的 PR 会被直接关闭,甚至影响你在这个项目里的信誉。
- **你的价值在上下文和判断,不在代码量。** 维护者现在缺的不是能写代码的人,而是理解问题、能复现、能讲清楚取舍、能对结果负责的人。一个附带最小复现、根因分析和测试的小 PR,比一个两千行的功能 PR 更受欢迎。
- **可以用 Coding Agent,但要像对待新人的代码一样审查它。** Day 2 和 Day 55 讲过的审查清单在这里同样适用。PR 描述里坦白你用了什么工具、自己验证了什么。

这也是为什么今天说的阶梯比以前更重要:在 AI 生成 PR 泛滥的环境里,维护者对陌生人的信任门槛变高了,从 issue 和小改动开始建立信任,是更现实的路径。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1yuto66ExZ&autoplay=0&high_quality=1" title="PR 不再受欢迎:AI 开源项目如何重写贡献规则" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>isomoes · PR 不再受欢迎:AI 开源项目如何重写贡献规则 · 4 分钟,解读 AI 原生开源项目怎么处理外部 PR,提第一个 PR 之前看。</figcaption>
</figure>

## 一个 PR 从头到尾

以给 MCP Python SDK 修一个文档里的过时示例为例,完整流程:

```bash
# 1. fork 后克隆自己的 fork
git clone git@github.com:<你的用户名>/python-sdk.git
cd python-sdk
git remote add upstream https://github.com/modelcontextprotocol/python-sdk.git

# 2. 读贡献指南,按它的要求装开发环境(以仓库当前的 CONTRIBUTING.md 为准)
cat CONTRIBUTING.md
uv sync --all-extras   # 这个项目用 uv,命令以文档为准

# 3. 从最新主干开分支,分支名说清楚做什么
git fetch upstream
git switch -c docs/fix-outdated-server-example upstream/main

# 4. 改动 + 跑测试和 lint(具体命令看 CONTRIBUTING.md 和 CI 配置)
uv run pytest
uv run ruff check .

# 5. 提交信息写清楚;项目用 Conventional Commits 的话照着格式写
git commit -m "docs: update server example to MCPServer API"
git push origin docs/fix-outdated-server-example
```

PR 描述我会写四段:改了什么、为什么改(链接 issue 或者说明问题)、怎么验证的(跑了哪些测试、截图或输出)、有没有使用 AI 工具以及你怎么检查的。维护者看完这四段就能决定要不要 review,不用来回问。

被要求修改时,别急着辩解。维护者对项目的理解比你深,按要求改,改完在评论里说一声。被拒了也正常,问一下原因,把学到的东西用到下一个 PR。

## 自己的开源项目

除了给别人的项目贡献,把自己的东西开源也是一条路。这门课里你已经有现成的素材:

- **SupportPilot 或 AgentOps 的精简版。** 去掉虚构公司的业务数据,保留架构、评测框架和部署脚本。重点打磨 README:一句话说清楚是什么,一张架构图,三条命令跑起来,一份评测报告的截图。
- **一个小而专的 MCP server。** 比如一个把某类国内常用服务(你熟悉的业务系统、内部工具)包成 MCP 的 server。小项目更容易被人真正用起来。
- **一个评测工具或数据集。** W11 的统计检验脚本整理成一个小库,或者你构造的 benchmark 的方法和一部分数据。这类东西在社区里比又一个 Agent 框架更稀缺。

几个细节:选一个许可证(choosealicense.com 上三分钟能选完,一般用 MIT 或 Apache-2.0);写 `CONTRIBUTING.md`,哪怕只有几行;打 tag 发 release;回复每一个 issue。不要追求 star 数,一个有十个真实用户的工具,比一个三千 star 但没人用的项目在面试里更有说服力。

## 技术写作

写作是投入产出比最高的一种公开影响力,因为它能被搜索到,能被转发,而且写的过程本身逼你把东西想清楚。

**写什么。** 最有价值的三类:

1. **踩坑和根因。** 「LangGraph 的 interrupt 不配 checkpointer 时第一次调用不报错,恢复时才抛异常」这种,别人搜报错信息就能搜到你。
2. **带数据的对比和复盘。** 「我把 SupportPilot 的路由从大模型换成微调小模型,成本降了多少、准确率掉了多少、哪些类别掉得最多」。有数字的文章比观点文章可信得多。
3. **设计决策。** 把你的 ADR 扩写成文章:当时的约束、考虑过的方案、为什么这么选、事后看对不对。这类文章资深面试官最爱看。

**怎么写。** Julia Evans 有一篇讲她怎么写博客的文章,核心几条很实用:写你刚学会的东西(你还记得哪里难);一篇只讲一件事;用具体的例子而不是抽象的道理。swyx 的《Learn in Public》讲的是另一面:把学习过程公开,不用等成为专家才写。

**发在哪。** 中文读者:个人站加掘金或知乎同步,公众号适合有固定读者之后。英文读者(海外远程的目标):个人站加 dev.to 或者 Medium,写完在 Hacker News、Reddit 相关板块、X 上分享。个人站是根,平台是分发渠道,不要只发在平台上。

**标题写清楚问题。** 「关于 Agent 的一些思考」没人点。「LangGraph 人工审批在 SQLite checkpointer 下重启丢状态的排查」会被需要它的人搜到。

**频率。** 一个月一篇有质量的,比一周一篇水文好。Simon Willison 的博客是一个好榜样:大量短小的 TIL(today I learned)加偶尔的长文,常年积累下来,成了 LLM 领域很多工程师每天都会看的个人博客。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1334y1q72q&autoplay=0&high_quality=1" title="程序员写技术博客新手指南" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>技术胖 · 程序员写技术博客新手指南 · 9 分钟,一位写了四年博客的 UP 主讲为什么写、写什么、有什么收获。</figcaption>
</figure>

## 分享和演讲

从小场合开始:组内技术分享 → 公司内部技术沙龙 → 本地 meetup → 行业大会。每一级都在为下一级攒素材和信心。

一个 15 到 20 分钟的技术分享,我常用的结构:

- **开头 2 分钟:一个具体的问题。** 「上个月我们的客服 Agent 在大促第一天把转人工率从 12% 推到了 31%」,比「今天讲讲 Agent 可观测性」抓人得多。
- **中间 12 分钟:你怎么分析和解决的。** 讲两三个关键决定,每个配一张图或一段数据。不要放大段代码。
- **结尾 3 分钟:可以带走的东西。** 三条结论,或者一个检查清单。
- **留 3 分钟问答。**

准备时录一遍自己讲的视频,回看一次,你会发现很多口头禅和讲得不清楚的地方。讲完把幻灯片和录像(如果有)放到个人站上,它就成了一个能长期展示的作品。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="做项目、写、讲、得到反馈的循环">
<circle cx="320" cy="110" r="78" fill="none" stroke="var(--rule)" stroke-width="1.5" stroke-dasharray="5 4"/>
<rect x="255" y="10" width="130" height="40" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="35" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">做项目 / 修 bug</text>
<rect x="430" y="90" width="130" height="40" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="495" y="115" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">写成博客 / PR</text>
<rect x="255" y="170" width="130" height="40" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="195" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">分享出去</text>
<rect x="80" y="90" width="130" height="40" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="145" y="115" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">反馈和机会</text>
<text x="320" y="115" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">每转一圈</text>
<text x="320" y="131" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">素材更多</text>
</svg>
<figcaption>公开影响力的循环。起点永远是真实做过的事,写作和分享只是把它放大。没有项目做底的个人品牌撑不了多久。</figcaption>
</figure>

## 时间怎么分配

这些事情很容易变成无底洞,也很容易因为看不到回报而放弃。我的建议是每周固定 3 到 5 小时,并且按季度设一个具体目标,比如:

- 第一个季度:2 个被合并的文档或测试 PR,1 篇踩坑博客。
- 第二个季度:1 个被合并的 bug 修复 PR,2 篇博客(其中一篇是带数据的复盘),1 次组内分享。
- 第三个季度:开源一个自己的小工具,1 次公司外的分享。

一年下来,你会有 5 个左右被合并的 PR、6 篇以上的博客、两三次分享。放在简历上,这已经是很多资深候选人没有的东西。

## 动手练习

**步骤 1:选项目。** 从 MCP Python SDK、OpenAI Agents SDK、Langfuse、promptfoo、LangGraph 中挑两个,读它们的 `CONTRIBUTING.md`,记下:开发环境怎么装、测试怎么跑、提交格式、是否要签 CLA、对 AI 生成代码有什么规定。

**步骤 2:提第一个 issue 或文档 PR。** 从你在 AgentOps 里踩过的坑里找一个,确认在最新版本仍然存在,提一个带最小复现的 issue。或者找一处过时的文档提一个 PR。记录链接。

**步骤 3:认领一个小 bug。** 在 `good first issue` 里找一个,留言认领并写出你的修复思路,等维护者回复后再动手。

**步骤 4:写一篇博客。** 从 AgentOps 的 ADR 里挑一个,扩写成 1,500 到 3,000 字的文章,包含约束、方案对比、数据、事后反思。发到你的个人站,并同步到一个平台。

**步骤 5:准备一个 15 分钟分享。** 按上面的结构写提纲和幻灯片,主题从 AgentOps 里选。录一遍,回看一遍,改一版。

**步骤 6:定季度目标。** 写下接下来三个月的公开影响力目标,具体到数量和日期,放进你的周计划。

**验收标准**:两个项目的贡献规则笔记;至少一个已提交的 issue 或 PR 链接;一篇已发布的博客链接;一份分享提纲和一次录像;季度目标清单。PR 不要求今天被合并,但要求已经提交并在跟进。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| good first issue | 开源项目给新贡献者标记的入门 issue |
| CONTRIBUTING.md | 项目的贡献指南,写开发环境、测试、提交规范 |
| CLA / DCO | 贡献者许可协议 / 开发者原创证明,部分项目要求签署才能合并 |
| 最小复现 | 去掉无关代码后,仍能复现问题的最短代码 |
| 路过式 PR | 作者没有理解项目上下文就提交的 PR,AI 工具让这类 PR 大量增加 |
| Conventional Commits | 一种提交信息格式规范,如 `fix:`、`docs:`、`feat:` 前缀 |
| TIL | Today I Learned,记录当天学到的小知识的短文 |
| Learn in Public | 公开学习过程,而不是等成为专家后才输出 |

## 常见误区

**第一个 PR 就提大功能。** 没在 issue 里讨论就写了一千行,结果维护者说方向不对。从 issue 和小改动开始,先建立信任。

**用 Coding Agent 批量刷 PR。** 在 2026 年这是最快毁掉自己信誉的方式。维护者能看出来,很多项目已经明确禁止,被标记后你后面的 PR 也会被怀疑。

**追 star 数。** star 多不等于有人用,面试官也知道 star 可以刷。真实的用户、被合并的 PR、有人引用的文章更有说服力。

**写观点不写数据。** 「我认为多 Agent 被高估了」这种文章很多,没人记得。「我在同一个任务上对比了单 Agent 和多 Agent,成功率和成本分别是多少」会被反复引用。

**只发在平台上。** 平台会改规则、会限流、会关停。个人站是你自己的资产,平台只是分发渠道。

**等准备好了再开始。** 永远不会准备好。从一个 issue、一篇 TIL 开始。

## 学习资料

### 文档与文章

- [Open Source Guides:How to Contribute](https://opensource.guide/how-to-contribute/):GitHub 出的开源贡献指南,第一次贡献前通读一遍,30 分钟。
- [GitHub Docs:Contributing to a project](https://docs.github.com/en/get-started/exploring-projects-on-github/contributing-to-a-project):fork、分支、PR 的官方操作说明。
- [Mitchell Hashimoto:Contributing to Complex Projects](https://mitchellh.com/writing/contributing-to-complex-projects):怎么进入一个陌生的大代码库,资深工程师必读。
- [MCP Python SDK 的 CONTRIBUTING.md](https://github.com/modelcontextprotocol/python-sdk/blob/main/CONTRIBUTING.md)、[OpenAI Agents SDK 的 CONTRIBUTING.md](https://github.com/openai/openai-agents-python/blob/main/CONTRIBUTING.md)、[Langfuse 的 CONTRIBUTING.md](https://github.com/langfuse/langfuse/blob/main/CONTRIBUTING.md)、[LangChain 贡献指南](https://docs.langchain.com/oss/python/contributing/overview):今天练习要读的几份。
- [MCP 社区贡献说明](https://modelcontextprotocol.io/community/contributing):MCP 规范和生态的贡献流程。
- [Julia Evans:How do you write blog posts?](https://jvns.ca/blog/2016/05/22/how-do-you-write-blog-posts/):讲怎么写技术博客,短而实用。
- [swyx:Learn in Public](https://www.swyx.io/learn-in-public):为什么要公开学习,怎么开始。
- [Simon Willison 的 TIL](https://til.simonwillison.net/):看一个顶级技术博主怎么用短文持续积累。
- [choosealicense.com](https://choosealicense.com/):给自己的项目选许可证。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1EP411d7Np&autoplay=0&high_quality=1" title="如何参与开源项目?0基础入门:怎么打开GitHub?什么是issue?什么是PR?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Python自动化办公社区 · 如何参与开源项目?0基础入门:怎么打开GitHub?什么是issue?什么是PR? · 13 分钟,如果你还没提过 PR,先看这个熟悉流程。</figcaption>
</figure>

- CodeSheep,《为什么程序员必须写技术博客?以及如何写?》(BV1Px411d74c),16 分钟。讲博客对面试的作用,播放量很高,适合给自己打打气。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/WldXhauP024" title="Getting started with open source contributions for beginners" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>GitHub · Getting started with open source contributions for beginners · 6 分钟,GitHub 官方讲怎么找项目、怎么提第一个贡献。</figcaption>
</figure>

- Jacob Sorber,《How to Contribute to Open Source Projects on Github (pull requests)》(YouTube ID x24fOAPclL4),11 分钟,演示完整的 fork 到 PR 流程。

### 书籍

- Karl Fogel,《Producing Open Source Software》,O'Reilly,第二版免费在线阅读于 [producingoss.com](https://producingoss.com/)。从维护者的视角理解开源项目怎么运作,读讲参与者和沟通的章节,你会更懂维护者为什么拒绝某些 PR。
- Nadia Eghbal,《Working in Public: The Making and Maintenance of Open Source Software》,Stripe Press,2020。讲现代开源项目的维护者困境,和今天讲的 AI 生成 PR 问题是一脉相承的。没查到中文版。
- John Sonmez,《软技能:代码之外的生存指南》。读第二篇「自我营销」,讲博客和个人品牌,有点鸡汤但方法具体。

### 开源项目与代码

- [firstcontributions/first-contributions](https://github.com/firstcontributions/first-contributions):专门给新人练习提 PR 的仓库,五分钟走通流程。
- [goodfirstissue.dev](https://goodfirstissue.dev/):按语言汇总各项目的 good first issue。
- [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers):MCP 官方和社区 server 列表,做自己的 MCP server 前先看看有没有现成的。
- [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo):评测和红队工具,活跃度高,和 W11 的内容相关,适合作为贡献目标。

## 自测

1. 为什么说公开影响力对海外远程岗特别重要?用 JD 数据说明。

<details><summary>答案</summary>

46 条海外远程岗里,写明全球任意地点的只有 3 条,其余大多限美加或欧洲。这么窄的门,很少是靠投简历挤进去的,通常是对方先在 GitHub、博客或社区里看到了你。另外远程团队招人时面试官对你的了解更少,能自己点开验证的公开作品权重更大。

</details>

2. 你在 LangGraph 里发现了一个 bug,想直接修。正确的顺序是什么?

<details><summary>答案</summary>

先在最新版本上确认 bug 仍然存在;搜一下是否已有相关 issue;没有就提一个带最小复现、版本号、期望和实际行为的 issue;在 issue 里说明你想修以及思路,等维护者回复;得到认可后按 CONTRIBUTING.md 开发、跑测试、提 PR,PR 描述里链接 issue、说明验证方法和是否使用了 AI 工具。

</details>

3. 2026 年维护者对外部 PR 的态度有什么变化?这对你提 PR 有什么影响?

<details><summary>答案</summary>

AI 工具让路过式 PR 大量增加,review 成本超过写代码成本,一些项目开始限制外部 PR、要求披露 AI 使用、甚至把代码请求转成 issue。影响是:先读项目对 AI 代码的规定;从 issue 和小改动开始建立信任;价值放在复现、根因分析和测试上,而不是代码量;使用 AI 工具要坦白并自己审查。

</details>

4. 下面哪个博客标题更好?为什么?A:「关于 RAG 的一些思考」 B:「中文客服知识库上 BM25 + 向量混合检索 vs 纯向量:recall@5 从 0.81 到 0.92」

<details><summary>答案</summary>

B。它说清楚了场景、方法、指标和结果,需要这个信息的人能搜到,读者看标题就知道值不值得点,而且带数据,可信度高。A 没有信息量,也搜不到。

</details>

5. 资深面试题:你怎么看待工程师做开源和写技术博客?你自己做过什么?对你的工作有什么帮助?

<details><summary>答案</summary>

答题要点:不要说空话,讲具体的。比如给 MCP SDK 提过什么 PR、怎么发现问题、和维护者怎么沟通;写过一篇什么复盘,数据是什么,有没有带来反馈或机会。然后讲对工作的帮助:写作逼你把问题想清楚、读开源代码提升了对框架原理的理解、和社区的交流让你更早知道生态变化。如果做得不多,诚实说,并讲你接下来的计划。面试官想看的是持续学习和对外输出的习惯,而不是数量。

</details>

6. 你只有每周 3 小时,开源贡献、写博客、做分享三件事怎么安排第一个季度?

<details><summary>答案</summary>

一个可行的安排:前四周每周 3 小时用来读两个目标项目的贡献规则、提 1 到 2 个 issue 或文档 PR;中间四周写一篇踩坑或复盘博客;最后四周跟进 PR 修改、在组内做一次分享。季度目标具体到数量和日期,做完再加量。不要三件事同时开始。

</details>

## 明天预告

Day 110 · 进阶结业:资深自检清单、谈薪和下一步。最后一天,我们拿 JD 数据里资深档的要求做一次完整的自检,讲资深岗位的渠道和谈薪(国内 P75、80 万以上那一档,新加坡,海外远程的现实限制),以及 110 天之后可以往哪几个方向继续走。
