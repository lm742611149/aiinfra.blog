---
title: 'Day 108 · 带人和推动:技术方案怎么说服老板和其他团队'
description: '资深工程师没有直接权力,却要让老板拍板、让别的团队迁移、让新人把 Agent 做对。今天讲四件事:用 ROI 和评测数据写一页纸给管理层,在没有权力的情况下推动平台落地,带新人做 Agent 项目,以及怎么回应「AI 不靠谱」的质疑。'
pubDate: 2026-10-12
regime: none
tags: ['leadership', 'influence', 'roi', 'mentoring', 'staff-engineer', 'agent-60']
series: 'agent-60'
day: 108
lang: 'zh'
---

## 今天要解决的问题

昨天的系统设计面试,是在 45 分钟里说服一个面试官。今天讲的是入职以后,在几周甚至几个月里说服一群人。这件事比面试难,因为对方没有义务听你讲完。

学完今天你应该能做到:

1. 说清楚资深工程师「没有权力但要有影响力」这件事的具体含义,知道 Will Larson 讲的四种 Staff 角色分别靠什么产生影响。
2. 写一页纸给管理层,用 ROI、风险和评测数据把一个 Agent 项目讲清楚,让对方能在 10 分钟内做决定。
3. 设计一个平台推广计划,让其他团队自愿迁移,而不是靠行政命令。
4. 带一个新人完成一个 Agent 小项目:怎么拆任务、怎么用评测做 review、怎么给反馈。
5. 面对「AI 不靠谱」「这个上线出了事谁负责」这类质疑,有一套用数据回应的方法。

预计用时:3 到 5 小时。前置:Day 38(成本与 Agent 经济学)、Day 52(单工单 ROI)、Day 71(线上 A/B)、Day 106(设计文档)。

## 没有权力的影响力

先说一个让很多人转资深时很难受的事实:你的职级变高了,但你能直接命令的人并没有变多。你不能让产品经理改需求,不能让另一个团队的工程师改代码,也不能让老板批预算。你能做的是让他们自己愿意这么做。

Will Larson 在《Staff Engineer》里把 Staff 工程师分成四种角色:

| 角色 | 主要工作 | 影响力从哪来 |
| --- | --- | --- |
| Tech Lead | 带一个团队完成一个方向 | 和团队的日常协作,技术判断被反复验证 |
| Architect | 负责一个关键领域的技术方向 | 对领域的深度理解,设计文档和评审 |
| Solver | 被派去解决最难的问题 | 解决问题的记录,一个接一个 |
| Right Hand | 作为高层管理者的延伸 | 和管理层的信任,能代表他们做判断 |

做 Agent 平台的资深工程师,大多数时候是 Tech Lead 和 Architect 的混合。不管哪种,影响力的来源都差不多:**你的判断被验证过很多次**。所以前期最重要的是挑几件能快速验证的事做成,用结果攒信用。一上来就推动一个半年才能见效的大改造,很容易在中途失去支持。

国内的公司还多一层现实:很多决定是在周会、周报和 OKR 对齐里做出来的。把你的方案放进老板关心的目标里(降本、提效、风险),比单独讲技术价值有效得多。这不是迎合,是翻译:把技术语言翻译成决策者的语言。

## 给管理层写一页纸

管理层看方案,通常只有十分钟,并且会问三个问题:这件事值多少钱?要花多少钱和多少人?最坏会怎样?一页纸就是围绕这三个问题写的。

我推荐的结构借了芭芭拉·明托《金字塔原理》的思路:结论先行,论据分组,每组再往下展开。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="给管理层的一页纸结构">
<rect x="170" y="15" width="300" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="35" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">结论 + 需要你批准的事</text>
<text x="320" y="51" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">第一句话就说要什么</text>
<rect x="20" y="100" width="185" height="58" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="112" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">值多少</text>
<text x="112" y="140" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">ROI,按年算</text>
<rect x="228" y="100" width="185" height="58" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="320" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">花多少</text>
<text x="320" y="140" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">人、钱、时间</text>
<rect x="436" y="100" width="185" height="58" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="528" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">最坏会怎样</text>
<text x="528" y="140" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">风险和止损点</text>
<line x1="320" y1="59" x2="112" y2="100" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="320" y1="59" x2="320" y2="100" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="320" y1="59" x2="528" y2="100" stroke="var(--rule)" stroke-width="1.5"/>
<text x="112" y="185" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">算式 + 假设</text>
<text x="320" y="185" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">分阶段投入</text>
<text x="528" y="185" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">评测数据 + 回滚</text>
<text x="320" y="230" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">技术细节放附录,链到设计文档</text>
</svg>
<figcaption>一页纸的结构。第一行写结论和你要的东西,下面三块分别回答管理层的三个问题。</figcaption>
</figure>

下面是一份示例,假设你要推动 SupportPilot 从试点扩大到全部客服渠道。所有数字都是假设,写你自己的版本时要换成真实数据:

```markdown
# 提议:SupportPilot 从试点扩大到全部文字客服渠道

**需要的决定**:批准 Q1 投入 2 名工程师 + 每月模型预算 X 元,
3 月底前覆盖全部文字渠道。

## 值多少(按年)
- 试点 8 周数据:Agent 独立解决率 62%(样本 4,100 张工单,95% 置信区间 60.5%–63.5%)
- 每张工单人工处理成本 = 平均处理 9 分钟 × 坐席综合时薪 ≈ A 元
- Agent 处理成本 = 模型费 + 人工复核(抽检 10%)≈ B 元
- 年工单量 N 张 × 62% × (A − B) ≈ 年节省 C 万元
- 次要收益:夜间响应时间从 6 小时降到 1 分钟以内

## 花多少
- 人力:2 名工程师 × 3 个月,之后 0.5 人维护
- 模型费用:按全量估算每月约 X 元(已含缓存折扣,算式见附录)
- 回本周期:约 D 个月

## 最坏会怎样
- 错误回复:试点期间严重错误率 0.4%(人工抽检口径),全部是可撤回的信息类错误
- 退款等写操作一律人工确认,Agent 无法独立执行
- 止损:任一周差评率比人工基线高 2 个百分点,自动回退到试点范围

附录:设计文档链接、评测报告链接、成本算式
```

几个写法上的细节:

**第一句话就说你要什么。** 很多工程师写方案像写论文,背景铺垫三段才说到请求。管理层读到第三段可能已经去开下一个会了。

**数字带样本量和口径。** 「解决率 62%」和「4,100 张工单上 62%,置信区间 60.5% 到 63.5%」在老板眼里可信度差很多。W11 学的统计方法在这里派上用场。

**主动写风险和止损点。** 工程师常常怕写风险会让方案被否掉,实际情况相反:你不写,老板会自己想,而且想得比实际更坏。你写了并给出止损机制,等于告诉他「最坏的情况我已经替你兜住了」。

**收益要换算成老板的单位。** 「转人工率下降 18%」对客服总监有意义,对 CEO 没感觉。换成「每年少招 12 个坐席」或者「节省约 C 万元」。

**Agent vs 人工的算式要诚实。** Day 38 和 Day 52 讲过:Agent 的成本不只是 token,还有人工复核、错误补救、维护人力。只算 token 得出的 ROI 一定虚高,懂行的老板一眼就能看穿。

## 推动平台落地:让别人自愿迁移

Day 82 到 Day 88 设计了 AgentOps 平台。设计得再好,如果业务团队不迁移,它就只是一个没人用的内部项目。这是平台工程最常见的失败方式。

我见过的成功推广大概都遵循几条:

**先找两个早期用户,深度共建。** 挑最痛、最愿意尝试的两个团队,你的人直接帮他们迁移,甚至帮他们写代码。他们成功了,就是最好的宣传。他们踩的坑,就是平台的第一批改进。

**把平台做成「铺好的路」,而不是「唯一的路」。** Netflix 讲的 paved road、Spotify 讲的 golden path 都是这个思路:平台提供的方式最省事、默认就有监控、评测、权限,但不禁止团队自己做。大多数团队会自己选省事的路。强制迁移只在安全和合规这类底线问题上用。

**迁移成本要低到一个下午。** 写好迁移指南、提供脚本、准备一个完整的示例项目。每多一步手动操作,迁移意愿就下降一截。

**量化采用情况,公开出来。** 每月统计接入团队数、经过网关的调用比例、因为平台避免的事故数。把这些数字放进周报,让管理层看到平台的价值,也让还没迁移的团队感受到一点压力。

**设一个固定的答疑时间。** 每周一小时的 office hours,任何团队都可以来问。很多迁移卡住不是技术问题,而是没人回答一个小问题。

**处理反对意见时先听。** 一个团队不愿意迁移,背后往往有合理的理由:平台缺他们需要的功能、迁移时间撞上他们的大版本、或者他们之前被别的内部平台坑过。先搞清楚理由,能解决的解决,不能解决的写进平台路线图,并告诉他们什么时候能有。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Z9ftpRhRiJE" title="The engineering mindset | Will Larson (Carta, Stripe, Uber, Calm, Digg)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Lenny's Podcast · The engineering mindset | Will Larson · 77 分钟,Will Larson 讲工程策略、怎么和管理层沟通、Staff 工程师怎么产生影响。可以开 YouTube 自动翻译字幕,重点听讲 engineering strategy 和 executives 的部分。</figcaption>
</figure>

## 带新人做 Agent 项目

资深工程师的另一半影响力来自带人。Agent 项目带人有几个特别的地方。

**任务拆分按「可以独立评测」来拆。** 普通后端项目按模块拆就行。Agent 项目的模块之间耦合很深(改了检索会影响回答,改了提示词会影响工具调用),所以拆任务时要确保每个子任务都有自己的评测指标。比如「把检索的 recall@5 从 0.85 提到 0.92」是一个好任务,「优化一下检索」不是。

**用评测做 code review 的一部分。** 新人提的 MR,除了看代码,还要看评测报告:总分变了多少、哪些用例变好了、哪些变差了。这能把 review 从「我觉得这样写不好」变成「这个改动让退款类问题的准确率掉了 4 个点,看看为什么」。对新人来说,后者是更具体、更不伤人的反馈。

**先让新人做错误分析。** Day 30 讲的读 trace、给失败分类,是新人理解一个 Agent 系统最快的方式。读 100 条 trace 之后,他对系统的理解会比读一周代码更深。

**约定团队使用 Coding Agent 的规则。** JD 里国内约两成、海外约 15% 的岗位要求熟练使用 Claude Code、Cursor、Codex 这类工具。团队里新人会大量用它们写代码。资深工程师要定规则:仓库里放好 `CLAUDE.md` 或 `AGENTS.md`,写清楚代码规范和禁止事项;AI 生成的代码同样要过评测和 review;提交说明里注明哪些部分是 AI 生成的、你是怎么验证的。规则的目的不是限制使用,而是让产出可审查。

**反馈要具体、及时、私下。** 「这个 MR 质量不太好」没用。「这三个工具的描述写得太短,模型分不清什么时候用哪个,看看 Day 11 的那几条原则」有用。批评私下说,表扬公开说。

**给新人能拿得出手的成果。** 让他负责一个完整的小功能,从设计文档到上线,并在周会上讲。新人成长了,你的影响力也跟着放大。

## 回应「AI 不靠谱」

推动 Agent 项目一定会碰到这类质疑:「大模型会胡说八道」「出了事谁负责」「上次那个 AI 项目就失败了」。这些质疑有合理的部分,不能当成对方不懂技术而绕过去。

我的回应方式分三步:

**第一步,承认问题,并把它变成可度量的问题。** 「AI 会出错」是对的。人工也会出错。问题不是会不会错,而是错误率多少、错了影响多大、能不能发现和纠正。把模糊的担心变成三个可以回答的问题。

**第二步,用数据和人工基线比较。** 拿出评测数据:Agent 在这类问题上的错误率是多少,人工坐席的错误率是多少(很多团队从来没量过人工的错误率,量出来常常让人意外)。如果 Agent 的错误率比人工高,也照实说,然后讲你怎么控制影响范围。

**第三步,讲清楚爆炸半径和兜底。** 哪些操作 Agent 可以独立做(查询、解答),哪些必须人工确认(退款、修改订单),出错了怎么发现(抽检、用户反馈、监控),发现了怎么回滚(开关、降级)。当对方明白最坏情况是有上限的,担心通常会降下来。

至于「出了事谁负责」,答案要在设计阶段就定好:Agent 的行为由负责它的团队负责,写进上线审批流程。不要回避这个问题,回避会被理解成没想过。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="影响力-关注度矩阵,用来决定对不同干系人花多少精力">
<line x1="80" y1="190" x2="600" y2="190" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="80" y1="190" x2="80" y2="20" stroke="var(--rule)" stroke-width="1.5"/>
<text x="340" y="212" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">对这件事的关注度 →</text>
<text x="30" y="105" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)" transform="rotate(-90 30 105)">决策影响力 →</text>
<rect x="340" y="25" width="250" height="75" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="465" y="55" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">重点经营</text>
<text x="465" y="75" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">客服总监、你的老板</text>
<rect x="90" y="25" width="240" height="75" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="210" y="55" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">保持满意</text>
<text x="210" y="75" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">CTO、安全合规负责人</text>
<rect x="340" y="110" width="250" height="70" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="465" y="140" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">及时告知</text>
<text x="465" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">客服坐席、业务团队工程师</text>
<rect x="90" y="110" width="240" height="70" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="210" y="140" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">定期同步</text>
<text x="210" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">其他部门</text>
</svg>
<figcaption>干系人地图。推动一个 Agent 项目之前,把相关的人放进这四个格子,精力按格子分配。右上角的人要在写设计文档之前就聊过。</figcaption>
</figure>

## 动手练习

今天的产出物是三样:一页纸、一份推广计划、一份带人计划。

**步骤 1:写一页纸。** 选 SupportPilot 扩量或者 AgentOps 平台立项中的一个,按上面的结构写一页纸,放在 `agentops/docs/proposals/`。要求:

- 第一句话写明需要的决定和资源。
- ROI 有完整算式,每个输入写清楚来源(实测、估算、行业假设)。
- 至少一个指标带样本量和置信区间(用 Day 69 的脚本算)。
- 风险至少三条,每条有止损机制。

**步骤 2:画干系人地图。** 列出这个项目相关的所有人(可以虚构一个公司,但角色要真实),放进影响力和关注度的四个格子。给右上角每个人写一句「他最关心什么、我准备怎么回应」。

**步骤 3:写推广计划。** 假设 AgentOps 平台已经上线,写一页推广计划:第一个月找哪两个团队共建、迁移指南包含什么、怎么量化采用率、怎么处理不愿意迁移的团队。

**步骤 4:写带人计划。** 假设来了一个有两年后端经验、没做过 Agent 的新人,写他前四周的计划:每周的任务(按可独立评测拆分)、要读的资料(从本课挑)、你怎么 review、第四周他要交付什么。

**步骤 5:模拟一次质疑。** 让一个朋友或 Claude 扮演持怀疑态度的 CTO,对你的一页纸提出至少五个尖锐问题(「如果模型涨价两倍怎么办」「试点数据是不是挑过的」之类)。用今天的三步法回应,记录下回答得不好的问题,回去补数据。

**验收标准**:一页纸能在 10 分钟内读完并让人做决定;ROI 算式能被别人复算;干系人地图右上角每个人都有应对方案;带人计划的每周任务都有评测指标;模拟质疑的记录里,回答不好的问题都有补充计划。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Staff 四种角色 | Will Larson 归纳的 Tech Lead、Architect、Solver、Right Hand 四种 Staff 工程师工作方式 |
| 一页纸 | 给决策者的简短提案,结论先行,回答值多少、花多少、最坏会怎样 |
| 金字塔原理 | 芭芭拉·明托提出的写作方法:结论在上,论据分组在下 |
| Paved road | 平台提供默认最省事的路径,但不强制,用便利性引导采用 |
| 早期用户 | 平台推广时最先深度共建的几个团队 |
| Office hours | 固定时间段的公开答疑 |
| 爆炸半径 | 一个错误最多能影响到的范围 |
| 干系人地图 | 按决策影响力和关注度给相关人分类,决定沟通策略 |
| 人工基线 | 同一任务由人工完成时的错误率、耗时、成本,用来和 Agent 对比 |

## 常见误区

**把技术先进性当成说服理由。** 「这个方案用了最新的多 Agent 架构」对老板没有意义。他关心的是钱、时间和风险。技术细节放附录。

**只写收益不写风险。** 以为写风险会让方案被否。实际上不写风险的方案更难通过,因为决策者会自己脑补最坏情况,而且他脑补的通常比实际更糟。

**ROI 只算 token。** Agent 的成本还包括人工复核、错误补救、维护人力。只算 token 的 ROI 一定虚高,被拆穿一次,你后面所有的数字都会被打折听。

**用行政命令推平台。** 让老板下一道「所有团队下季度必须迁移」的命令,看起来最快,实际上会制造大量应付式迁移和怨气。命令只适合安全合规这类底线问题。

**带新人时只看代码不看评测。** Agent 项目里,代码写得漂亮不代表效果好。只做代码 review 会漏掉最重要的问题。

**把质疑当成对方不懂。** 「AI 不靠谱」背后常常有真实的经历和合理的担心。先听完,再用数据回应。

## 学习资料

### 文档与文章

- [Staff archetypes](https://staffeng.com/guides/staff-archetypes/):Will Larson 讲四种 Staff 角色,15 分钟。
- [Present to executives](https://staffeng.com/guides/present-to-executives/):怎么给管理层做汇报,讲得非常具体,今天的一页纸结构和它一致。
- [Staying aligned with authority](https://staffeng.com/guides/staying-aligned-with-authority/):怎么和管理层保持方向一致,避免做了半天发现老板不要。
- [Engineering strategy](https://staffeng.com/guides/engineering-strategy/):当你推动的不是一个项目而是一个方向时,怎么写工程策略。
- [lethain.com](https://lethain.com/):Will Larson 的博客,讲工程管理和技术领导力的文章很多,挑标题感兴趣的读。
- [Anthropic:How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system):里面讲多 Agent 系统的 token 成本是单 Agent 的数倍,适合拿来练习「技术方案的成本怎么讲给老板听」。
- [Hamel Husain:Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/):回应「AI 不靠谱」时最有用的思路来源:用评测把模糊的担心变成具体的数字。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1pK4y1e71B&autoplay=0&high_quality=1" title="【汇报技巧】十分钟掌握方案汇报技巧" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>KKLAout · 【汇报技巧】十分钟掌握方案汇报技巧 · 10 分钟,不是技术视频,但讲方案汇报的结构和节奏,写一页纸之前看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1k5JrzXE6T&autoplay=0&high_quality=1" title="#8 Heng: 在科技大厂从Staff Engineer转职Engineering Manager" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员土汪 · #8 Heng: 在科技大厂从Staff Engineer转职Engineering Manager · 65 分钟播客,一位大厂 Staff 工程师讲 Staff 的日常工作和影响力来源,以及转管理的考虑。通勤时听。</figcaption>
</figure>

- yaopengue,《金字塔原理-工作汇报篇》(BV1Kb411P71z),48 分钟。想系统学结论先行的写法可以看。

### 其他经典视频

- Lenny's Podcast 的 Will Larson 访谈已经嵌在正文里。
- Book Overflow,《Discussing Staff Engineer by Will Larson》(YouTube ID -m8CDR_lHXo),79 分钟。两个工程师逐章讨论《Staff Engineer》这本书,没时间读书可以先听这个。

### 书籍

- Will Larson,《Staff Engineer: Leadership beyond the management track》,2021,自出版。没查到简体中文版。读第一部分讲四种角色和 Staff 的日常工作的章节,大部分内容在 staffeng.com 上免费公开。
- Camille Fournier,《The Manager's Path》,O'Reilly,2017。中文版《技术为径:带领公司走向卓越的工程师》,电子工业出版社,2023。读讲 Tech Lead 和带人的前几章,即使不打算转管理,带新人的部分也很有用。
- 芭芭拉·明托,《金字塔原理》,南海出版公司有多个版本。读讲结论先行和论据分组的前几章,够写一页纸用了。
- Will Larson,《An Elegant Puzzle: Systems of Engineering Management》,Stripe Press,2019。偏工程管理,讲团队规模、技术债和组织设计,往 Staff 以上走时再读。

### 开源项目与代码

- [joelparkerhenderson/architecture-decision-record](https://github.com/joelparkerhenderson/architecture-decision-record):推广平台时,把关键决定写成 ADR 公开出来,能减少很多重复解释。
- [anthropics/claude-code 最佳实践文档](https://www.anthropic.com/engineering/claude-code-best-practices):给团队定 Coding Agent 使用规则时的参考,特别是 CLAUDE.md 怎么写。

## 自测

1. 一页纸的第一句话应该写什么?为什么不先写背景?

<details><summary>答案</summary>

写需要对方做的决定和需要的资源,比如「批准 Q1 投入 2 名工程师和每月 X 元模型预算」。管理层时间很少,可能只读第一段。先写背景,读者看完三段还不知道你要什么,决定就会被推迟。背景和细节放在后面或附录里。

</details>

2. 你算出 Agent 每张工单成本是人工的十分之一,但老板不信。可能是哪里出了问题?

<details><summary>答案</summary>

很可能只算了 token 成本。完整的 Agent 成本包括模型费、人工复核或抽检的人力、错误补救成本(用户投诉、二次处理)、平台维护的工程人力。另外,收益只应该按 Agent 能独立解决的那部分工单算,不是全部工单。把这些补齐后,再给出样本量和置信区间,可信度会高很多。

</details>

3. 推平台时,一个业务团队明确拒绝迁移。你接下来做什么?

<details><summary>答案</summary>

先找他们聊,搞清楚拒绝的原因:平台缺功能、时间冲突、迁移成本高、还是对内部平台不信任。能当场解决的解决(比如帮他们写迁移代码);缺功能的写进路线图并给出时间;时间冲突的约一个合适的窗口。只有涉及安全合规底线时才考虑升级给管理层要求强制迁移。同时继续用早期用户的成功案例和采用数据争取他们。

</details>

4. 新人的 MR 代码写得很干净,但你担心效果有问题。你怎么 review?

<details><summary>答案</summary>

要求 MR 附上评测报告:总分变化、按类别的变化、变好和变差的具体用例。重点看变差的用例,和新人一起读这些 trace,找原因。这样反馈是具体的(「退款类准确率掉了 4 个点,这几条 trace 里模型选错了工具」),而不是主观的。顺便检查评测集是否覆盖了这次改动影响的场景。

</details>

5. 资深面试题:你推动过一个别人一开始不认同的技术决策吗?你是怎么做的?最后结果如何?

<details><summary>答案</summary>

答题要点:讲一个真实案例,用 STAR 结构。突出几点:你先理解了反对者的顾虑而不是急着说服;你把讨论从观点之争变成数据之争(做了实验、评测、小范围试点);你给了止损机制,降低了对方接受的风险;决策后你用结果验证,并且如果结果不如预期,你主动调整了。面试官想看的是你在没有权力时推动事情的方法,以及你是否能承认自己错了。

</details>

6. 「AI 会胡说八道,出了事谁负责?」这个质疑你怎么用三步法回应?

<details><summary>答案</summary>

第一步,承认会出错,并把问题变成可度量的:错误率多少、影响多大、能否发现和纠正。第二步,拿出评测数据,并和人工基线对比,照实说 Agent 哪里比人好、哪里比人差。第三步,讲爆炸半径和兜底:哪些操作必须人工确认,出错怎么发现(抽检、监控、用户反馈),怎么回滚。「谁负责」的答案是负责这个 Agent 的团队,写进上线审批流程。

</details>

## 明天预告

Day 109 · 开源与技术影响力:贡献、写作、演讲。今天讲的是公司内部的影响力,明天讲公司外部的:怎么给 Agent 框架和 MCP 生态提一个能被合并的 PR,怎么写技术博客,怎么做一次分享,以及这些对资深面试和海外远程岗位到底有多大用。
