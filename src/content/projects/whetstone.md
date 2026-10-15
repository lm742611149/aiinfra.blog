---
title: 'Whetstone · 会自我改进的 Agent:用评测自动优化提示词和工具'
name: 'Whetstone'
tagline: '拿评测里的失败案例自动改写 Agent 的提示词和工具描述,并证明不是过拟合'
summary: '把 BillSleuth 的提示词、工具描述当成可训练的文本参数,用 GEPA 这类反思式优化器自动改写。重点不在分数涨了多少,而在训练/验证/留出集划分、多次重复和配对检验,证明提升在没见过的场景上也成立。'
order: 8
difficulty: 4
level: '资深'
duration: '6–8 周(业余时间)'
cost: '约 $40–100 API 费(2026-10 估算,算式见正文)'
gpu: false
targets: ['Agent 平台工程师', 'AI 评测工程师', '海外 FDE']
stack: ['Python', 'GEPA', 'DSPy', 'LangGraph', 'FastMCP', 'SciPy']
recognition: '留出集上做过配对检验的提升报告 + 可复现的优化流水线,可选给 GEPA 仓库贡献一个 adapter 示例'
depends: ['billsleuth']
status: 'spec'
---

## 这个项目是什么

做过 BillSleuth 第 128 天错误分析的人都知道那个循环:跑评测,翻错例,猜原因,改一句提示词,再跑。改十轮以后,你已经说不清哪句话是为哪个错例加的,也不知道新加的那句有没有把另外三个场景改坏。Whetstone 想把这件事交给程序做:把 BillSleuth 里所有「写给模型看的文字」(每个节点的系统提示词、MCP 工具的描述、几条示例)抽出来当参数,让一个优化器读评测失败的轨迹,自己提出改法,自己验证,留下更好的版本。

这件事现在已经有成熟的方法。DSPy 把提示词当成可编译的程序参数,MIPROv2 同时搜索指令和示例;GEPA 让一个反思模型读完整轨迹(推理、工具调用、工具返回)后用自然语言诊断问题,再从帕累托前沿上挑候选继续改。你不用发明新算法,要做的是把它们正确地接到一个多步、带工具的 Agent 上,然后回答一个更难的问题:涨的分是真的吗?

做完的样子是一个仓库加一份报告。仓库里一条命令跑完「划分数据 → 优化 → 留出集评测 → 统计检验」,输出优化前后的提示词 diff、每个场景的成败对照、置信区间和 p 值。报告写清楚哪些改动有效、哪些只是在验证集上碰巧好看。

## 为什么值得做

招聘方对「我优化了提示词,准确率从 70% 涨到 85%」这种说法已经免疫了,因为大多数人既没留出集,也没重复跑。你能拿出一张表,写着「120 个从未参与优化的场景、每个跑 5 次、配对 bootstrap 区间不含 0、换种子重跑优化器三次结果的极差」,这在面试里很少见。我的判断是,这个项目对准的是评测工程和 Agent 平台方向:平台团队要给几十个业务 Agent 提供「自动调优」能力,第一件事就是防止它们过拟合自己的评测集。

和现有东西比,你的差异在两处。第一,GEPA 论文和 DSPy 教程里的任务多是单轮或固定流水线(数学、问答、分类),BillSleuth 是 LangGraph 状态机加 MCP 工具加模拟客户的多轮场景,轨迹更长,失败原因更分散。第二,论文报的是平均提升(GEPA 论文 v2 摘要写的是六个任务上平均比 GRPO 高 6%、最多 20%,rollout 少最多 35 倍),而你报的是带区间和检验的、在业务场景上的结论,还包括失败的尝试。

## 要做出什么

必做:

- 文本参数化:BillSleuth 的系统提示词、MCP 工具的描述、结论节点的示例,全部移到 `params/` 目录,运行时按版本号加载,代码里不再有硬编码的提示词。
- 带反馈的评分器:每个场景返回分数,同时返回一段文字反馈(根因判错成什么、差额差了多少、哪个数字找不到出处、是否误冲正)。GEPA 靠这段文字反思。
- 三种优化方式对照:你在 Day 128 手工迭代的版本、一个只看分数的 OPRO 式元提示优化器(自己写,一百来行)、GEPA。
- 数据划分与防泄漏:场景扩到 300 个,按 12 类根因加「客户误解」分层划成训练、验证、留出三份,另外在优化冻结后用新种子再生成一份「新鲜集」。
- 统计报告:每个配置在留出集上跑 5 次,算配对 bootstrap 区间、McNemar 检验、优化器多种子方差。

加分:

- 用 GEPA 的 MCP adapter 单独优化工具描述,看只改工具描述能拿到多少。
- 把结论节点改写成 DSPy 模块,跑一次 MIPROv2 当第四个对照。
- 迁移测试:在 BillSleuth 上优化出的提示词,换一个模型跑,看提升还剩多少。
- 优化前后的轨迹导入 Agent Loupe,用逐步对比解释改动起作用的位置。

不做什么:不改 BillSleuth 的图结构和工具代码(只改文字,否则分不清是哪部分起了作用);不做 ADAS 那种让元 Agent 写新 Agent 代码的搜索,那是另一个量级的项目;不训练模型权重。

## 架构

<figure>
<svg viewBox="0 0 640 400" role="img" aria-label="Whetstone 架构:场景生成器产出四份数据,优化器循环在训练集和验证集上改写文本参数,冻结后在留出集和新鲜集上做统计检验">
  <rect x="0" y="0" width="640" height="400" fill="var(--paper-raised)" rx="6"/>
  <rect x="20" y="24" width="150" height="56" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="95" y="48" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">场景生成器</text>
  <text x="95" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">engine.py + 故障注入</text>
  <line x1="170" y1="52" x2="200" y2="52" stroke="var(--ink-soft)" marker-end="url(#aws)"/>
  <rect x="200" y="20" width="420" height="64" fill="none" stroke="var(--rule)"/>
  <text x="212" y="42" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">分层划分(按根因类别)</text>
  <text x="212" y="66" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">train 120 · val 60 · test 120 · fresh(冻结后再生成)</text>
  <rect x="20" y="118" width="260" height="150" fill="none" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
  <text x="32" y="138" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">优化循环(只碰 train / val)</text>
  <rect x="36" y="150" width="228" height="40" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="150" y="175" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">BillSleuth 跑候选参数</text>
  <rect x="36" y="214" width="228" height="40" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="150" y="239" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">评分器:分数 + 文字反馈</text>
  <line x1="150" y1="190" x2="150" y2="214" stroke="var(--ink-soft)" marker-end="url(#aws)"/>
  <rect x="330" y="118" width="290" height="60" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="475" y="142" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">反思模型读轨迹和反馈</text>
  <text x="475" y="162" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">提出新提示词 / 工具描述</text>
  <rect x="330" y="200" width="290" height="60" fill="none" stroke="var(--rule)"/>
  <text x="475" y="224" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">候选池(val 上的帕累托前沿)</text>
  <text x="475" y="244" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">params/v001 … v0NN</text>
  <line x1="264" y1="234" x2="330" y2="160" stroke="var(--ink-soft)" marker-end="url(#aws)"/>
  <line x1="475" y1="178" x2="475" y2="200" stroke="var(--ink-soft)" marker-end="url(#aws)"/>
  <line x1="330" y1="230" x2="264" y2="172" stroke="var(--ink-soft)" stroke-dasharray="3 3" marker-end="url(#aws)"/>
  <line x1="475" y1="260" x2="475" y2="296" stroke="var(--ink-soft)" marker-end="url(#aws)"/>
  <text x="485" y="284" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">冻结一个版本</text>
  <rect x="20" y="296" width="600" height="84" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="320" y="320" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">留出评测:test + fresh,每个场景跑 5 次</text>
  <text x="320" y="342" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">配对 bootstrap 区间 · McNemar · 优化器 3 个种子的方差</text>
  <text x="320" y="364" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">护栏:数字幻觉率、误冲正率、单场景成本不许变差</text>
  <defs><marker id="aws" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>虚线框里的循环只许看训练集和验证集。留出集一个配置只评一次,新鲜集在提示词冻结以后才生成,优化器从来没机会见到它。</figcaption>
</figure>

关键取舍有三个。第一,优化器选 GEPA 当主力,原因是它直接吃文字反馈和完整轨迹,而 BillSleuth 的失败恰好有很具体的文字原因(「把重复扣款判成了按天折算」);只看一个 0/1 分数的优化器在 120 个训练场景上很难知道该往哪改。GEPA 仓库自带 LangChain adapter(支持 LangGraph 图)和 MCP adapter(优化工具描述),接入成本比把 BillSleuth 重写成 DSPy 程序低得多。

第二,验证集故意做小。DSPy 的 GEPA 教程写得很直白:每个候选都要在验证集上全跑一遍,验证集越大,固定预算里能探索的候选越少;不传验证集时 GEPA 会拿训练集做选择,这等于主动允许过拟合。所以划分是 120/60/120,而不是常见的 60/20/20 比例。

第三,反思模型和被优化的模型分开。被优化的是便宜的执行模型,反思模型用大一号的,它在一次优化里只被调用几十次,贵一点无所谓。

## 分阶段计划

| 周 | 目标 | 产出 | 怎么算完成 |
| --- | --- | --- | --- |
| 1 | 参数化 BillSleuth,冻结基线 | `params/v000/`,场景扩到 300,分层划分脚本 | 用 v000 跑出的分数和 Day 127 的结果在区间内一致 |
| 2 | 带反馈的评分器 | `scorer.py` 返回 `score` 和 `feedback` | 抽 30 个错例人工看反馈,能看出错在哪且不直接泄露标准答案 |
| 3 | 接 GEPA 跑通第一次优化 | adapter、优化日志、v001 起的候选版本 | light 预算跑完,验证集分数曲线和每个候选的 diff 都能看到 |
| 4 | 对照组 | OPRO 式优化器、Day 128 手工版本 | 三种方式在同一验证集上都有分数 |
| 5 | 重复与留出评测 | 每种优化器 3 个种子,留出集每配置跑 5 次 | 结果表填满,脚本可一条命令复现 |
| 6 | 统计检验与泛化 | bootstrap、McNemar、新鲜集、换模型测试 | 报告里每个「提升」都附区间和 p 值 |
| 7 | 泄漏审计与成本 | 提示词泄漏扫描、token 成本对比 | 优化后提示词里找不到训练场景的金额、客户名、发票号 |
| 8 | 报告与发布 | README、技术报告、Loupe 对比截图 | 别人 clone 后按 README 能复现留出集结果 |

## 验收指标

| 指标 | 怎么测 | 目标 |
| --- | --- | --- |
| 留出集根因准确率提升 | 每场景 5 次取均值,配对 bootstrap 1 万次 | 95% 区间下限大于 0 才算有提升 |
| 留出集逐场景成败变化 | McNemar 检验(对每个场景取 5 次多数票) | p < 0.05,同时报告「变好」和「变坏」的场景数 |
| 差额精确匹配率 | 同上 | 方向为提升,不要求显著 |
| 数字幻觉率、误冲正率 | Day 125 溯源校验器、Day 127 定义 | 护栏:区间上限不超过基线 + 2 个点 |
| 优化器稳定性 | 3 个种子各优化一次,看留出集分数极差 | 如实报告;极差比提升还大,就不能说优化器有效 |
| 验证集到留出集的落差 | val 提升减去 test 提升 | 落差超过 val 提升的一半,报告里要专门解释 |
| 新鲜集表现 | 冻结后新生成 60 个场景 | 和留出集结论方向一致 |
| 单场景成本 | token 数 × 单价 | 记录提示词变长带来的成本变化 |

为什么必须做配对检验:留出集 120 个场景,准确率在 70% 附近时,95% 区间的半宽大约是 8 个百分点(1.96 × √(0.7×0.3/120) ≈ 0.082)。两个配置各自算区间,5 个点的提升几乎总是重叠;同一批场景做配对比较,把场景难度这部分方差消掉,才有机会看出真实差异。Day 69 写过的 `paired_diff`、`mcnemar`、`cluster_bootstrap_diff` 可以直接复用。

成本算式(价格 2026-10-15 查 [DeepSeek 价格页](https://api-docs.deepseek.com/quick_start/pricing)):`deepseek-flash` 闲时输入未命中缓存 $0.15、命中 $0.003、输出 $0.6(每百万 token),忙时(UTC 工作日 01–04、06–10 点)翻倍;`deepseek-v4-pro` 闲时输入 $0.66、输出 $1.98。单场景 token 数先从 Day 127 的 trace 里量,下面的数只是假设:如果一次场景平均 4 万输入、3 千输出,全按未命中算,闲时约 4 × 0.15 / 100 + 0.3 × 0.6 / 100 ≈ $0.008。一次 GEPA 优化按几百次评测算(GEPA 仓库 README 说一般 100–500 次),加上反思模型几十次调用,大约几美元;三种优化器 × 3 个种子,再加留出集 120 场景 × 5 次 × 4 个配置 = 2400 次运行,总数落在几十美元。模拟客户和 LLM 评审另算。

## 最终产出

- 仓库 `whetstone/`:参数化后的 BillSleuth、评分器、三种优化器、统计脚本,一条命令复现。
- 技术报告:方法、划分、结果表、区间、失败的尝试,以及优化后提示词里到底多了什么。
- 提示词演化页:每个版本相对上一版的 diff 和验证集分数,做成静态网页挂在网站上。
- Agent Loupe 对比截图:同一场景优化前后从哪一步开始走不同的路。
- 可选上游贡献:如果你给 LangGraph + MCP 的组合写了比较干净的 adapter 示例,可以提给 GEPA 仓库。

## 难点和坑

最常见的坑是优化器把训练场景「背」进提示词。反思模型看到「客户 C-0042 的 3 月发票税额错了」,很可能写出一条「检查 2026 年 3 月的税率是否已过期」之类的规则,它在训练集上有用,在留出集上没用,还会误导别的场景。第 7 周的泄漏扫描就是干这个的:把训练集里出现过的金额、日期、客户名、发票号做成词表,在优化后的提示词里逐个搜。

反馈文字写成标准答案也是泄漏。反馈写「根因应该是 duplicate_charge」,模型学到的是那一个场景;写「你只看了发票,没看付款记录,两笔付款的 gateway_ref 不同但金额相同」才是可迁移的教训。

不传验证集、或者验证集和训练集是同一批,GEPA 会在训练集上选候选,DSPy 文档明确说这样会故意过拟合。看起来分数涨得很漂亮,留出集上一测就回去了。

LLM 的非确定性比你以为的大。temperature 设 0 也不保证同输入同输出,一个场景跑 5 次可能 3 对 2 错。只跑一次就比较两个配置,等于在比运气。每次比较前先看一下基线自己和自己的差异有多大,这就是你的噪声底。

提示词会越改越长。反思式优化喜欢加规则,几轮以后系统提示词可能翻好几倍,单场景成本跟着涨,DeepSeek 的缓存也会因为前缀变了而失效(命中价和未命中价差 50 倍)。报告里成本要和准确率一起列。

工具描述改了,工具行为没变。优化器可能在 `list_invoices` 的描述里写上「支持按税码过滤」,而工具根本没有这个参数,模型照着调就会报参数错误。给工具描述的改写加一个校验:参数 schema 不许动,描述里提到的参数名必须在 schema 里。

偷看留出集。看了留出集结果再回去改评分器或换优化器设置,这个留出集就已经参与了选择。规则写进 README:一个配置在留出集上只评一次,想再改就用新鲜集,并且在报告里注明。

## 面试里怎么讲

示范讲法:「我在做计费争议调查 Agent 时,手工改提示词已经改不动了,十轮以后说不清哪句话对哪个错例有用。我把所有给模型看的文字参数化,用 GEPA 让一个反思模型读失败轨迹自动改写,对照组是手工版本和一个只看分数的优化器。300 个场景分层划成训练、验证、留出,留出集每个场景跑 5 次,用配对 bootstrap 和 McNemar 检验。结果是(填你的数):留出集根因准确率提升 X 个点,区间 [a, b];优化器换三个种子,极差 Y 个点。取舍上,我故意把验证集做小,让固定预算能探索更多候选;代价是选择更吵,所以必须靠留出集兜底。另外我发现提示词长了 Z 倍,单场景成本涨了 W%,这部分我在报告里和准确率放在一起。」

<details><summary>你怎么确定提升不是在评测集上过拟合?</summary>

三层隔离。优化只碰训练集和验证集;留出集一个配置只评一次;提示词冻结之后再用新种子生成一批新鲜场景。然后看三个信号:验证集提升和留出集提升的落差有多大,留出集上的配对区间是否不含 0,新鲜集的方向是否一致。最后人工扫一遍优化后的提示词,看有没有训练场景的具体金额和名字。

</details>

<details><summary>为什么用配对检验,不直接比两个准确率?</summary>

两个配置跑的是同一批场景,场景本身难度差异很大,有的场景谁都做对,有的谁都做错。分开算区间会把这部分方差算进去,120 个场景时半宽 8 个点左右,很难看出 5 个点的提升。配对比较只看同一场景上两个配置的差,难度方差被消掉了。McNemar 只看「一对一错」的场景,更直接地回答「变好的比变坏的多吗」。

</details>

<details><summary>GEPA 和用 GRPO 做强化学习比,什么时候选哪个?</summary>

GEPA 改的是文字,不碰权重,几百次评测就能出结果,适合用闭源 API、场景少、每次运行贵的情况,改了什么也能直接读懂。GRPO 改权重,需要开源模型、GPU 和大量 rollout,适合任务稳定、量大、值得把能力固化进小模型的时候。GEPA 论文自己的对比是 rollout 少很多、平均分更高,但那是论文作者在他们六个任务上的结果,换到你的业务要自己测。

</details>

## 前置知识

- Day 31:建测试集,分层与边界用例
- Day 32、Day 70:LLM-as-judge 与评审校准
- Day 69:评测里的统计学,置信区间、McNemar、bootstrap
- Day 73:benchmark 设计与污染防护
- Day 80:强化学习与 Agent,GRPO 的基本概念(用来做对照讨论)
- Day 121–128:BillSleuth 全部内容,尤其 Day 127 评测和 Day 128 错误分析

## 参考资料

- [GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning](https://arxiv.org/abs/2507.19457)(Agrawal 等,2025):主力优化器的论文,看反思和帕累托选择怎么设计。
- [gepa-ai/gepa](https://github.com/gepa-ai/gepa):官方实现,2026-10 仍在活跃提交,LangChain adapter 和 MCP adapter 都在 `src/gepa/adapters/` 下。
- [GEPA adapter 指南](https://gepa-ai.github.io/gepa/guides/adapters/):给 BillSleuth 写自定义 adapter 时照着它实现 `evaluate` 和 `make_reflective_dataset`。
- [DSPy: Compiling Declarative Language Model Calls into Self-Improving Pipelines](https://arxiv.org/abs/2310.03714)(Khattab 等,2023):把提示词当程序参数来优化的出发点。
- [DSPy 的 GEPA 教程](https://dspy.ai/current/getting-started/gepa-optimization/):训练集和验证集各干什么、为什么验证集要小、为什么要另留测试集,写得很清楚。
- [Optimizing Instructions and Demonstrations for Multi-Stage Language Model Programs](https://arxiv.org/abs/2406.11695)(Opsahl-Ong 等,2024):MIPRO 论文,加分项里的第四个对照。
- [DSPy MIPROv2 文档](https://dspy.ai/current/api/optimizers/MIPROv2/):MIPROv2 的参数和用法。
- [Large Language Models as Optimizers](https://arxiv.org/abs/2309.03409)(Yang 等,2023):OPRO,只看分数的元提示优化,自己写对照组时参考;官方仓库 2024 年底后没再更新,读论文即可。
- [TextGrad: Automatic "Differentiation" via Text](https://arxiv.org/abs/2406.07496)(Yuksekgonul 等,2024):用文字反馈当「梯度」的另一条思路,和 GEPA 的反馈设计对照着读。
- [Automated Design of Agentic Systems](https://arxiv.org/abs/2408.08435)(Hu、Lu、Clune,2024):让元 Agent 写新 Agent 代码,本项目明确不做,但面试会被问到区别。
- [Adding Error Bars to Evals](https://arxiv.org/abs/2411.00640)(Miller,2024):评测统计的实操指南,配对差、聚类标准误、重复采样。
- [The Hitchhiker's Guide to Testing Statistical Significance in Natural Language Processing](https://aclanthology.org/P18-1128/)(Dror 等,ACL 2018):不同指标该用哪种检验。
- [An Empirical Investigation of Statistical Significance in NLP](https://aclanthology.org/D12-1091/)(Berg-Kirkpatrick 等,EMNLP 2012):配对 bootstrap 在 NLP 评测里的经典用法。
- [τ-bench](https://arxiv.org/abs/2406.12045)(Yao 等,2024):pass^k 和模拟用户,BillSleuth 评测的方法来源。
