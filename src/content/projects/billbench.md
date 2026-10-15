---
title: 'BillBench · 企业计费 Agent 公开基准与排行榜'
name: 'BillBench'
tagline: '把 BillSleuth 的造数和判分做成别人愿意用的公开基准'
summary: '500 个分难度的计费争议场景,公开集给人开发,私有集用秘密种子生成、按季度轮换防污染。十几个模型跑分上榜,开放提交,配技术报告。'
order: 6
difficulty: 4
level: '资深'
duration: '8–10 周(业余时间)'
cost: '首轮只跑便宜模型约 $30–50;十几个模型全跑约 $650(2026-10-15 估算)'
gpu: false
targets: ['AI 评测工程师', 'Agent 平台工程师', '海外 FDE']
stack: ['Python', 'uv', 'SQLite', 'OpenAI 兼容接口', 'Hugging Face Datasets', 'Astro', 'GitHub Actions']
recognition: '外部团队的提交条目出现在榜上 + 技术报告(arXiv,可投评测类会议赛道)'
depends: ['billsleuth']
status: 'spec'
---

## 这个项目是什么

BillSleuth 做完时,你手里有一个参考计费引擎、12 类故障注入函数、100 个带标准答案的场景,还有一套全是确定性规则的判分器(Day 122、Day 127)。这些东西现在只服务你自己的一个 Agent。BillBench 要做的,是把它们变成一个任何人都能装上、跑自己的模型、把分数提交上来的公开基准。

具体说,场景从 100 个扩到 500 个,分三档难度;数据切成公开集和私有集,私有集不发布,只用来给榜单打分;写一个 `billbench` 命令行,一条命令就能用任意 OpenAI 兼容接口的模型跑完;做一个排行榜网站,先放上你自己跑的十几个模型,再开放提交;最后写一份技术报告,讲清楚这个基准测什么、不测什么、分数可信到什么程度。

做完的样子:别人在 README 里看到 `uvx billbench run --model ...`,半小时内跑出第一份结果;榜单上每一行能点开看到逐场景的轨迹;报告里有每个模型的置信区间和错例分析。

## 为什么值得做

τ-bench(Yao 等,2024)用「LLM 扮演用户 + 工具 + 数据库终态判分」测客服 Agent,τ²-bench(Barres 等,2025)加了用户也能操作环境的双控制设定。它们现在覆盖航空、零售、电信和银行知识库(以 2026-10-15 仓库 README 为准),没有一个领域是 B2B 订阅计费。计费争议有个很少见的好性质:标准答案能精确到分,判分不用 LLM 评审。这是 BillBench 和现有 Agent 基准不一样的地方。

对招聘方来说,「我做过一个 Agent」很常见,「我设计过一个别人在用的基准」少得多。评测岗、Agent 平台岗的面试里经常问的污染、置信区间、判分器自身的正确性、怎么防止榜单被刷,这个项目每一条都要真做一遍。我的判断是,它比再做一个 Agent 更能证明你懂评测;但前提是真的有人用,哪怕只有两三个外部提交。

## 要做出什么

必做:

- 500 个场景:L1 单一故障(就是 Day 122 那种),L2 单一故障但客户说法有误导、发票历史更长、相关发票不止一张,L3 两个故障叠加或前一个错误已被部分冲正。三档都保留两成「账没错」的场景。表结构和字段名沿用 BillSleuth,一个都不改。
- 两条赛道:工具赛道提供 `recompute_invoice`;规则赛道拿掉它,只给计费规则文档和一个十进制计算器工具。Day 122 已经承认复算工具让题目变简单,规则赛道才测得出模型自己会不会算账。
- 数据切分:300 个公开场景(带标准答案,给人开发和自测),200 个私有场景(用秘密种子生成,只有维护者能跑)。
- `billbench` 命令行:`run`、`grade`、`report`、`submit prepare`、`submit validate`。纯 Python + SQLite,不需要 Docker。
- 固定的模拟客户:模型、温度、提示词写死在版本号里,所有上榜结果用同一个。
- 排行榜网站:默认按 pass^1 排,同时显示 pass^4、95% 置信区间、误冲正率、数字幻觉率、单场景成本。区间重叠的模型并列显示,不硬排名次。
- 技术报告 + 数据卡(datasheet)+ Croissant 元数据。

加分:

- 私有集每季度用新种子重新生成一批,公开集和新私有集分数的差距单独成一列。
- 接入一个通用评测框架(比如 Inspect AI),让已经在用它的人不用学新工具。
- 「训练过」标记:提交者声明是否在 BillBench 公开集或生成器输出上训练过,和 LedgerGym 衔接。

不做什么:不做多语言、不做真实支付网关接入、不收真实公司账单数据,也不做 LLM 评审打分。所有数据仍然是虚构公司「云簿 CloudLedger」的。

## 架构

<figure>
<svg viewBox="0 0 640 400" role="img" aria-label="BillBench 架构:生成器用公开种子和秘密种子分别产出公开集和私有集,运行器调用被测模型和固定的模拟客户,判分器输出结果文件,提交流程进入排行榜">
  <rect x="0" y="0" width="640" height="400" fill="var(--paper-raised)" rx="6"/>
  <rect x="20" y="30" width="170" height="70" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="105" y="55" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">场景生成器</text>
  <text x="105" y="75" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">参考引擎 + 故障注入</text>
  <text x="105" y="92" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">L1 / L2 / L3</text>
  <line x1="190" y1="50" x2="240" y2="50" stroke="var(--ink-soft)" marker-end="url(#bb1)"/>
  <line x1="190" y1="85" x2="240" y2="120" stroke="var(--ink-soft)" marker-end="url(#bb1)"/>
  <rect x="240" y="25" width="170" height="45" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="325" y="45" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">公开集 300</text>
  <text x="325" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">公开种子 · 带答案</text>
  <rect x="240" y="100" width="170" height="45" fill="none" stroke="var(--ink-soft)" stroke-dasharray="5 4" rx="4"/>
  <text x="325" y="120" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">私有集 200</text>
  <text x="325" y="137" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">秘密种子 · 季度轮换</text>
  <rect x="440" y="30" width="180" height="110" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="530" y="52" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">运行器 billbench run</text>
  <text x="452" y="76" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">被测模型(任意接口)</text>
  <text x="452" y="96" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">固定模拟客户</text>
  <text x="452" y="116" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">每次运行一份库副本</text>
  <line x1="410" y1="50" x2="440" y2="60" stroke="var(--ink-soft)" marker-end="url(#bb1)"/>
  <line x1="410" y1="122" x2="440" y2="110" stroke="var(--ink-soft)" marker-end="url(#bb1)"/>
  <line x1="530" y1="140" x2="530" y2="180" stroke="var(--ink-soft)" marker-end="url(#bb1)"/>
  <rect x="440" y="180" width="180" height="60" fill="none" stroke="var(--compute)" rx="4"/>
  <text x="530" y="203" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">判分器(确定性)</text>
  <text x="530" y="223" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">按库终态 + 证据链</text>
  <line x1="440" y1="210" x2="380" y2="210" stroke="var(--ink-soft)" marker-end="url(#bb1)"/>
  <rect x="200" y="180" width="180" height="60" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="290" y="203" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">submission.json</text>
  <text x="290" y="223" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">轨迹放 HF 数据集</text>
  <line x1="200" y1="210" x2="140" y2="210" stroke="var(--ink-soft)" marker-end="url(#bb1)"/>
  <rect x="20" y="180" width="120" height="60" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="80" y="203" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">提交 PR</text>
  <text x="80" y="223" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">CI 校验格式</text>
  <line x1="80" y1="240" x2="80" y2="280" stroke="var(--ink-soft)" marker-end="url(#bb1)"/>
  <rect x="20" y="280" width="600" height="90" fill="none" stroke="var(--rule)" rx="4"/>
  <text x="320" y="303" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">排行榜(静态站点,数据来自 manifest.json)</text>
  <text x="40" y="328" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">未验证:提交者自己在公开集上跑的分数</text>
  <text x="40" y="348" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">已验证:维护者在私有集上重跑,轨迹公开,提示词未改</text>
  <text x="40" y="364" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">两列分开显示,差距本身就是过拟合信号</text>
  <defs><marker id="bb1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>琥珀色是数据和判分侧,蓝色是模型侧。私有集只在维护者机器上存在,公开仓库里只有生成器代码。</figcaption>
</figure>

最关键的取舍在私有集。常见做法有两种:一种是固定一批题不公开,像很多榜单那样;另一种是定期换题,LiveBench(White 等,2024)就是按时间持续更新题目来限制污染。BillBench 的场景本来就是程序生成的,两种可以合起来:生成器代码完全公开,私有集只是换了一个不公开的种子,每季度换一次。这样任何人都能验证题目是怎么出的,又背不下具体的题。代价也要说清楚:生成器公开,意味着别人可以用它造无限多的训练数据,模型会学到这个分布。这不算作弊,但必须让提交者声明,并在榜上标出来。

第二个取舍是验证机制,我直接参考 τ²-bench 的做法:提交需要附带轨迹,没改提示词、没跳过题目的才标「已验证」,改了脚手架或加了工具的要标成自定义提交。SWE-bench 那边的经验也值得看:它要求每个实例都附推理轨迹,打勾验证要维护者自己在随机子集上重跑;2025 年 11 月起 Verified 榜只接受学术和研究机构的提交,而且必须附 arXiv 预印本或技术报告(以 SWE-bench/experiments 仓库 README 为准,2026-10-15 查证)。规则越来越严,是因为榜单一出名就有人刷。你的榜单小,但从第一天就把规则写清楚,成本最低。

## 分阶段计划

| 周 | 目标 | 产出 | 怎么算完成 |
| --- | --- | --- | --- |
| 1 | 定难度分级和赛道 | 设计文档、L2/L3 的故障组合清单 | 每个 L3 组合手算一个例子,差额和引擎一致 |
| 2 | 扩生成器到 500 场景 | `generate --seed --split` | Day 122 那条自检测试对 500 个场景全过 |
| 3 | 规则赛道 | 规则文档、计算器工具 | 参考解(按规则手写的脚本)在规则赛道上 500 个全对 |
| 4 | 打包命令行 | `pip`/`uvx` 可装的包、README | 一台干净机器上从安装到出第一份报告不超过 30 分钟 |
| 5 | 跑首轮基线 | 四五个便宜模型的结果 | 每个模型 k=4,报告带 Wilson 区间 |
| 6 | 提交流程 | `submit prepare/validate`、CI 校验、manifest | 用一个假提交走完 PR → CI → 上榜 |
| 7 | 排行榜网站 | 静态站点、逐场景轨迹查看 | 手机上能看,区间重叠的并列 |
| 8 | 跑满十几个模型 | 完整榜单 | 每行能追溯到轨迹文件 |
| 9–10 | 报告与推广 | 技术报告、数据卡、发帖 | 至少一个外部提交跑通(哪怕是朋友) |

## 验收指标

| 指标 | 怎么测 | 目标 |
| --- | --- | --- |
| 标准答案正确性 | 引擎重算差额与 truth 逐个比对 | 500/500,任何一个不对都不发布 |
| 判分器正确性 | 参考解必须满分,空 Agent 必须零分,手造的 20 条边界答案逐条断言 | 全部通过 |
| 区分度 | 最强和最弱模型的 pass^1 区间不重叠;L1→L3 分数单调下降 | 两条都满足才算难度分级有效 |
| 模拟客户稳定性 | 同一模型同一场景跑 4 次,统计客户是否泄露答案、是否提前结束 | 抽查 50 条人工看,泄露为 0 |
| 安装难度 | 新机器计时 | 30 分钟内出结果 |
| 单模型跑分成本 | 报告里的 token 统计 × 单价 | 公布在榜上,不设门槛 |
| 公开/私有差距 | 同一模型两组分数之差 | 只报告,不设目标;差距大的条目要能解释 |

跑分成本的算式是:`场景数 × k × (每场景输入 token × 输入单价 + 每场景输出 token × 输出单价)`,再加模拟客户的同类花费。每场景 token 我用 Day 124 的实测做锚:调查节点一次 1 万到 2.4 万输入、1 千左右输出,而 Day 128 说过这只算了一部分。加上意图识别、写解释和多轮追问,我先按每次运行 4 万输入、3 千输出估,这是假设,第 5 周用 20 个场景实测后替换。私有集 200 个场景、k=4,也就是每个模型 800 次运行。价格是 2026-10-15 查的标准价(美元/百万 token,不含缓存和批量折扣):

| 模型 | 输入 / 输出单价 | 每次运行 | 800 次 |
| --- | --- | --- | --- |
| Claude Opus 5.5 | 4 / 20 | $0.22 | $176 |
| Claude Sonnet 5.5 | 2 / 10 | $0.11 | $88 |
| Claude Haiku 5.5 | 0.10 / 0.50 | $0.0055 | $4.4 |
| gpt-5.6-sol | 4 / 20 | $0.22 | $176 |
| gpt-6-sol | 2 / 10 | $0.11 | $88 |
| gpt-6-luna | 0.10 / 0.50 | $0.0055 | $4.4 |
| deepseek-v4-pro(闲时) | 0.66 / 1.98 | $0.032 | $26 |
| deepseek-flash(闲时) | 0.15 / 0.60 | $0.0078 | $6.2 |
| Gemini 3.8 Flash | 0.75 / 3.75 | $0.041 | $33 |
| Qwen3.8 Flash | 0.15 / 0.47 | $0.0074 | $5.9 |
| Qwen3.8 27B | 0.24 / 2.20 | $0.016 | $13 |
| GLM 5.3 FlashX | 0.37 / 1.25 | $0.019 | $15 |

Claude、OpenAI、DeepSeek 的价格来自各自官方价格页,DeepSeek 高峰时段价格翻倍;Gemini、Qwen、GLM 取自 OpenRouter 的模型列表接口。十二个加起来约 $636,模拟客户如果用 deepseek-flash 闲时价、每次 1 万输入 500 输出,9600 次再加约 $17。这远超每月 $30–60 的预算,所以分两步走:第 5 周只跑四五个便宜模型,k=4 也就 $30 左右;贵的模型放到第 8 周,先用 k=1 跑 200 题(四分之一的钱),或者去申请厂商的研究额度。提示词缓存能明显降低输入费用,因为系统提示词和对话前缀每轮都一样,但缓存命中率要实测,不能先算进去。

## 最终产出

- 公开仓库 `billbench`:生成器、运行器、判分器、命令行,代码用 MIT 许可证。
- Hugging Face 上的数据集:公开集 300 个场景和 SQLite 快照,数据用 CC BY 4.0,每个文件里放一个 canary 字符串(BIG-bench 的做法,让训练数据清洗时能识别出来)。
- 排行榜网站,挂在站内,每行可以点开看逐场景轨迹。
- 技术报告:先挂 arXiv;如果第二年 NeurIPS 还有评测与数据集赛道,可以投。2026 年这个赛道已改名为 Evaluations & Datasets,要求提交时数据和代码可访问、附 Croissant 元数据。
- 一篇中文长文和一条英文推,讲 BillBench 测出来的几个反直觉现象(写实测,不预设结论)。

## 难点和坑

**标准答案错一个,榜单就失信。** 500 个场景里只要有一个 truth 算错,别人跑出来「全对只差这一题」,第一反应是你的基准有 bug。Day 122 的数据集自检测试必须在 CI 里跑,每次改生成器都跑。L3 的两个故障叠加时尤其容易错:第一个故障改了小计,第二个故障算税的基数就变了,差额不是两个差额相加。

**模拟客户会泄露答案。** 模拟客户看得到场景描述,如果提示词里写了根因,它在第三轮追问时可能说出「是不是税率用错了」。Day 127 已经把 `truth` 和 `detail` 从客户输入里拿掉了,扩场景时新增的字段也要逐个过一遍。抽 50 条对话人工看,是省不掉的。

**模拟客户换模型,分数就变。** 去年跑的结果和今年的不可比,如果中间换了模拟客户的模型。版本号要包含模拟客户的模型 ID 和提示词哈希,榜单按版本分表。厂商下线旧模型时,整张榜可能要重跑,这一项要写进预算。

**判分规则能被钻空子。** Day 127 的发票号判法是「标准答案的发票都在结论里就算对」,多写不扣分。公开基准上,有人会让模型把客户所有发票都列上。上榜版本要么给多写的发票设上限,要么把精确度单独成一列。

**私有集不是绝对安全。** 运行器要调用被测模型的接口,私有场景的内容会经过对方服务器。对闭源 API 这无法避免;能做的是季度轮换,以及在报告里写清楚这个威胁模型。

**「容易装」比想象中难。** 我的电脑没有 Docker,这反而是个约束优势:全程只用 Python 和 SQLite。坑在依赖版本,Python 3.12 的 `zoneinfo` 在 Windows 上需要 `tzdata` 包,不装的话时区类场景直接报 `ZoneInfoNotFoundError`。安装测试至少要在 macOS、Linux 和 Windows 上各跑一次,可以用 GitHub Actions 的矩阵。

**名次的统计意义。** 200 题、k=4,两个模型 pass^1 差 3 个百分点,区间几乎一定重叠。Day 69 的做法是按场景聚类算区间,同一场景的 4 次运行不是独立样本。榜单上硬排第一第二,是最容易被懂行的人看不起的地方。

## 面试里怎么讲

示范讲法:「我之前做了一个查计费争议的 Agent,评测时发现市面上没有 B2B 计费这个领域的 Agent 基准,而这个领域恰好能精确判分。我把造数和判分做成了 BillBench:500 个场景分三档难度,公开集给人开发,私有集用秘密种子生成、按季度轮换。判分全是确定性规则,按数据库终态判,不用 LLM 评审。我跑了十几个模型(这里讲你实测到的最大发现,比如规则赛道和工具赛道的差距),每个分数都带按场景聚类的置信区间,区间重叠的并列。取舍上,我选择公开生成器,换来的是任何人都能审查题目,代价是别人能用它造训练数据,所以榜上加了『训练过』的标记。」

<details>
<summary>私有集用秘密种子生成,和直接藏一批固定题相比好在哪,坏在哪?</summary>

好处是能轮换:题背不下来,而且每季度新私有集和公开集的分数差可以当作过拟合的度量。生成器公开,题目的出法可审查。坏处是分布是公开的,在生成器输出上训练的模型会占优,这和「见过测试题」不同,但需要提交者自己声明。另一个风险是生成器有偏:所有题都长得像,模型学到的是模板而不是计费知识。可以用 L2 的客户说法改写和 L3 的叠加故障缓解,在报告里写成局限。

</details>

<details>
<summary>你怎么知道你的判分器本身是对的?</summary>

三层。第一层,每个场景用参考引擎重算,差额必须等于 truth,这是数据层自检。第二层,参考解必须满分、什么都不做的空 Agent 必须零分,这是 Day 73 讲的任务自检。第三层,手造边界答案逐条断言,比如多写发票、金额差一分、贷记单开在原发票上。三层都进 CI。我还会抽错例人工看,判分器说错的,有没有其实是对的。

</details>

<details>
<summary>跑一次完整榜单要花多少钱,你怎么控制?</summary>

给算式:场景数乘 k 乘每次运行的 token 和单价。我用 Day 124 的实测做锚,先在 20 个场景上测出真实的 token 分布再外推。控制手段是先跑便宜模型、贵的模型先 k=1、依赖提示词缓存(实测命中率之后再算进去),以及运行器里有花费上限,超了就停,支持断点续跑。

</details>

## 前置知识

- Day 29:pass^k
- Day 33:模拟用户
- Day 69:评测统计与置信区间
- Day 73:benchmark 设计与 τ-bench 拆解
- Day 75:选模型与成本算式
- Day 121–128:BillSleuth 全套,尤其 Day 122 造数、Day 127 评测

## 参考资料

- [τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains](https://arxiv.org/abs/2406.12045)(Yao, Shinn, Razavi, Narasimhan,2024):模拟用户 + 数据库终态判分 + pass^k 的原型。
- [τ²-Bench: Evaluating Conversational Agents in a Dual-Control Environment](https://arxiv.org/abs/2506.07982)(Barres 等,2025):双控制环境的设计。
- [tau2-bench 仓库](https://github.com/sierra-research/tau2-bench) 和它的[榜单提交说明](https://github.com/sierra-research/tau2-bench/blob/main/docs/leaderboard-submission.md):照抄提交流程和「已验证」的判定条件。榜单在 [taubench.com](https://taubench.com)。
- [SWE-bench: Can Language Models Resolve Real-World GitHub Issues?](https://arxiv.org/abs/2310.06770)(Jimenez 等,2023)与 [SWE-bench/experiments](https://github.com/SWE-bench/experiments):提交要求、轨迹要求、验证机制。
- [Holistic Evaluation of Language Models](https://arxiv.org/abs/2211.09110)(Liang 等,2022)和 [HELM 网站](https://crfm.stanford.edu/helm/):多指标并列报告,不只看准确率。
- [LiveBench: A Challenging, Contamination-Limited LLM Benchmark](https://arxiv.org/abs/2406.19314)(White 等,2024):用持续更新题目限制污染。
- [Investigating Data Contamination in Modern Benchmarks for Large Language Models](https://arxiv.org/abs/2311.09783)(Deng 等,2023):污染检测方法,写报告时的威胁模型参考。
- [When Benchmarks are Targets: Revealing the Sensitivity of Large Language Model Leaderboards](https://arxiv.org/abs/2402.01781)(Alzahrani 等,2024):小改动就能让名次变化,支持「区间重叠就并列」。
- [Lessons from the Trenches on Reproducible Evaluation of Language Models](https://arxiv.org/abs/2405.14782)(Biderman 等,2024):可复现评测的工程细节。
- [Datasheets for Datasets](https://arxiv.org/abs/1803.09010)(Gebru 等,2018):数据卡模板。
- [Croissant](https://github.com/mlcommons/croissant):数据集元数据格式,评测类会议赛道要求附带。
- [NeurIPS 2026 Evaluations & Datasets Track 征稿](https://neurips.cc/Conferences/2026/CallForEvaluationsDatasets):看投稿对数据托管和代码的要求。
- [BIG-bench](https://github.com/google/BIG-bench):canary 字符串的做法(仓库已归档,只看做法)。
- [Inspect AI](https://github.com/UKGovernmentBEIS/inspect_ai):加分项里接入的评测框架。
- 价格页(2026-10-15 查证):[Claude](https://platform.claude.com/docs/en/about-claude/pricing)、[OpenAI](https://developers.openai.com/api/docs/pricing)、[DeepSeek](https://api-docs.deepseek.com/quick_start/pricing)、[OpenRouter 模型列表](https://openrouter.ai/models)。
