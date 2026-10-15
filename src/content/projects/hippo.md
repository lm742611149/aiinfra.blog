---
title: 'Hippo · Agent 长期记忆系统,在公开基准上对比'
name: 'Hippo'
tagline: '自己实现记忆的写入、合并、冲突更新、遗忘和检索,上公开基准比'
summary: '从零写一个 Agent 长期记忆服务,处理「用户搬家了」「请忘掉这件事」这类问题。在 LongMemEval、LoCoMo 上和全量上下文、朴素 RAG、Mem0、Graphiti 同条件对比,并讲清各家公开分数的口径差异。'
order: 9
difficulty: 4
level: '资深'
duration: '6–8 周(业余时间)'
cost: '约 $60–120 API 费(2026-10 估算,算式见正文)'
gpu: false
targets: ['Agent 平台工程师', 'AI 应用工程师', 'AI 评测工程师']
stack: ['Python', 'SQLite', 'FTS5', 'numpy', 'Mem0', 'Graphiti', 'FastAPI']
recognition: 'LongMemEval 官方评测脚本跑出的分项准确率 + 同条件对比报告,方法和代码公开可复现'
depends: []
status: 'spec'
---

## 这个项目是什么

Day 64 讲过记忆系统的四个问题:什么时候写、写什么、冲突了听谁的、怎么忘。讲的时候用的是 SupportPilot 的客户记忆,规模小,也没有拿公开基准量过。Hippo 把这件事做成一个独立的记忆服务,接口只有三个:`write(user_id, turns, session_time)`、`search(user_id, query, now)`、`forget(user_id, selector)`,任何 Agent 都能接。

难点不在存和取,在中间那几步。用户三月说「我在北京」,六月说「我搬到上海了」,九月问「我之前住哪」,系统要知道两条记录都是真的,只是有效期不同。用户说「把我女儿的名字忘掉」,系统不光要删那一条,还要删从它推出来的其他记忆。用户问一个从没提过的事,系统要能答「你没告诉过我」,而不是从相似的记忆里编一个。

做完的样子:一个 Python 包加一个 FastAPI 服务,一套评测外壳能把 Hippo、Mem0、Graphiti、全量上下文、朴素 RAG、文件系统 Agent 六种方案接到同一个回答模型和同一个评审上,在 LongMemEval 和 LoCoMo 上跑出分项结果,外加一份报告,讲清楚自己的分数和各家公开分数为什么不能直接比。

## 为什么值得做

记忆是 Agent 产品从「一次性对话」走向「长期助手」的那一步,几家专门做记忆层的公司(Mem0、Zep、Letta)都在这上面竞争,而且公开吵过架。这一点恰好是这个项目的价值:你能看懂并复现这场争论,面试官就知道你会读论文、会做评测、不会被一个数字带着走。

查到的争论是这样的(2026-10-15 查证)。Mem0 的论文用 GPT-4o-mini 在 LoCoMo 上报告 LLM 评审分(J)Mem0 66.88、图版本 68.44、Zep 65.99,而全量上下文是 72.90。Zep 随后发博客说 Mem0 跑 Zep 的方式不对:把对话双方都当成 user 角色、把时间戳拼在消息文本里而没用 `created_at` 字段、搜索串行执行抬高了延迟,修正后 Zep 自测 75.14 ± 0.17;同一篇里也批评 LoCoMo 本身对话太短、没有考「知识更新」、第 5 类没有标准答案、部分题目说话人标错。Letta 则发文说,用 GPT-4o-mini 加最简单的文件工具(grep、语义搜索文件)就拿到 74.0,高于 Mem0 报告的 68.5,并说 Mem0 没回应他们关于 MemGPT 跑分方法的询问,结论是现有记忆基准可能没那么有意义。到 2026 年,Mem0 的 PyPI 页面又写着新算法 LoCoMo 92.5、LongMemEval 94.4,但注明这是托管平台的分数,含开源 SDK 里没有的专有优化。这些都是厂商自测,口径各不相同。

我的判断是,招聘方看这个项目会关注两件事:你的冲突更新和遗忘是不是真的设计过(而不是只调了一个向量库),以及你的对比是不是同条件、有区间、讲了口径。这两件事做到,比分数高几个点更有说服力。

## 要做出什么

必做:

- 写入:按轮或按会话抽取原子事实,带说话人、事件时间、来源会话和轮次。
- 合并与冲突更新:新事实先和已有记忆对齐,决定新增、合并、取代或忽略;取代时旧记录不删,填上失效时间,保留时间线(参考 Graphiti 的双时间模型)。
- 遗忘:三种机制分开实现,过期失效、按重要性和最近访问的衰减排序、用户发起的硬删除(连同派生记忆一起删)。
- 检索:BM25(SQLite FTS5)加向量混合检索,问题里的时间表达先解析成时间范围再过滤,返回的每条记忆带日期。
- 评测外壳:六种方案同一个回答模型、同一个评审;LongMemEval 用官方 `evaluate_qa.py`;LoCoMo 用 J 分和 F1。
- 自建遗忘小测试集:50 道题,先告诉系统一件事,再要求忘掉,再问,正确行为是答「不知道」。

加分:

- 消融实验:LongMemEval 论文提出的按轮拆分、事实扩展索引键、时间感知查询扩展,逐个开关看贡献。
- A-Mem 式的记忆互链:新记忆写入时更新相关旧记忆的描述,看对多会话推理题有没有帮助。
- 跑 LongMemEval_M(每题约 500 个会话)的一个子集,看记忆系统和全量上下文的差距是否随历史变长而拉开。

不做什么:不做多模态记忆(LoCoMo 里的图片题只用文字描述);不做多 Agent 共享记忆和权限;不追任何厂商的榜单数字。

## 架构

<figure>
<svg viewBox="0 0 640 420" role="img" aria-label="Hippo 架构:写入路径抽取事实并与已有记忆对齐后决定新增、合并、取代;存储层带双时间字段;读取路径解析时间后混合检索;遗忘任务在后台运行;评测外壳把六种方案接到同一回答模型和评审">
  <rect x="0" y="0" width="640" height="420" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">写入路径</text>
  <rect x="20" y="36" width="130" height="40" fill="none" stroke="var(--rule)"/>
  <text x="85" y="61" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">对话 + 会话时间</text>
  <line x1="150" y1="56" x2="170" y2="56" stroke="var(--ink-soft)" marker-end="url(#ahp)"/>
  <rect x="170" y="36" width="130" height="40" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="235" y="61" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">抽取原子事实</text>
  <line x1="300" y1="56" x2="320" y2="56" stroke="var(--ink-soft)" marker-end="url(#ahp)"/>
  <rect x="320" y="36" width="130" height="40" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="385" y="61" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">对齐已有记忆</text>
  <line x1="450" y1="56" x2="470" y2="56" stroke="var(--ink-soft)" marker-end="url(#ahp)"/>
  <rect x="470" y="36" width="150" height="40" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="545" y="54" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">决策</text>
  <text x="545" y="69" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">新增/合并/取代/忽略</text>
  <line x1="545" y1="76" x2="545" y2="110" stroke="var(--ink-soft)" marker-end="url(#ahp)"/>
  <rect x="160" y="110" width="460" height="92" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="176" y="132" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">存储:SQLite hippo.db</text>
  <text x="176" y="154" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">memories: text, subject, valid_from, valid_to,</text>
  <text x="176" y="172" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">observed_at, source_session, superseded_by</text>
  <text x="176" y="190" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">FTS5 全文索引 · 向量(numpy 暴力检索)</text>
  <rect x="20" y="110" width="124" height="92" fill="none" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
  <text x="82" y="134" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">遗忘任务</text>
  <text x="82" y="156" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">过期失效</text>
  <text x="82" y="174" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">衰减排序</text>
  <text x="82" y="192" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">用户硬删除</text>
  <line x1="144" y1="156" x2="160" y2="156" stroke="var(--ink-soft)" stroke-dasharray="3 3" marker-end="url(#ahp)"/>
  <text x="20" y="232" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">读取路径</text>
  <rect x="20" y="242" width="130" height="40" fill="none" stroke="var(--rule)"/>
  <text x="85" y="267" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">问题 + 提问时间</text>
  <line x1="150" y1="262" x2="170" y2="262" stroke="var(--ink-soft)" marker-end="url(#ahp)"/>
  <rect x="170" y="242" width="130" height="40" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="235" y="267" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">解析时间范围</text>
  <line x1="300" y1="262" x2="320" y2="262" stroke="var(--ink-soft)" marker-end="url(#ahp)"/>
  <rect x="320" y="242" width="130" height="40" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="385" y="267" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">BM25 + 向量</text>
  <line x1="385" y1="242" x2="385" y2="202" stroke="var(--ink-soft)" marker-end="url(#ahp)"/>
  <line x1="450" y1="262" x2="470" y2="262" stroke="var(--ink-soft)" marker-end="url(#ahp)"/>
  <rect x="470" y="242" width="150" height="40" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="545" y="267" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">带日期的记忆 → 回答</text>
  <rect x="20" y="314" width="600" height="86" fill="none" stroke="var(--ink-soft)"/>
  <text x="320" y="338" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">评测外壳(同一回答模型、同一评审)</text>
  <text x="320" y="360" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">Hippo · Mem0 开源版 · Graphiti · 全量上下文 · 朴素 RAG · 文件系统 Agent</text>
  <text x="320" y="382" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">LongMemEval_S(官方 evaluate_qa.py)· LoCoMo 第 1–4 类 · 自建遗忘集</text>
  <defs><marker id="ahp" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>蓝色是调用模型的步骤,琥珀色是确定性的代码和存储。冲突更新发生在「对齐」和「决策」两步之间,取代旧记忆只填失效时间,不删记录。</figcaption>
</figure>

最重要的取舍是冲突时「改写」还是「只追加」。Day 64 介绍过 Mem0 早期的做法:抽取后让模型对每条已有记忆选 ADD、UPDATE、DELETE 或 NOOP。到 2026 年 4 月,Mem0 PyPI 页面描述的新算法改成了单次 ADD-only 抽取,不再 UPDATE 和 DELETE,记忆只增不覆盖,靠检索去挑。Graphiti 走的是第三条路:新事实让旧事实失效但保留,每条边有有效区间。Hippo 选 Graphiti 那条,理由是 LongMemEval 专门考「知识更新」和「时间推理」两类题,只追加会让检索同时拿到新旧两条而回答模型分不清;直接改写又答不了「我之前住哪」。代价是对齐和决策这一步要多一次模型调用,写入更慢更贵。

第二个取舍是存储。本机没有 Docker,也不需要:LongMemEval 每道题是一个独立用户的历史,一个用户最多几千条记忆,numpy 暴力算余弦足够快,全文检索用 SQLite 自带的 FTS5。Graphiti 需要图数据库,它的 README 里 Kuzu 后端已标为弃用,可以用嵌入式的 `falkordblite`(要求 Python 3.12+),同样不用 Docker。

## 分阶段计划

| 周 | 目标 | 产出 | 怎么算完成 |
| --- | --- | --- | --- |
| 1 | 数据和评测外壳 | 下载 LongMemEval cleaned 版和 locomo10,统一的 `System` 接口,全量上下文和朴素 RAG 两个基线 | 两个基线在 100 题开发子集上出分,官方评测脚本能跑通 |
| 2 | 写入 | 事实抽取、记忆表、FTS5 和向量索引 | 抽 30 个会话人工核对抽取结果,漏抽和错抽都有记录 |
| 3 | 合并与冲突更新 | 对齐、四种决策、双时间字段 | 开发子集里 knowledge-update 类题目单独出分 |
| 4 | 检索 | 时间解析、混合检索、消融开关 | temporal-reasoning 类题目单独出分,消融表填满 |
| 5 | 遗忘与删除 | 衰减排序、过期、硬删除连带派生记忆、50 题遗忘集 | 遗忘集全部跑通,删除后数据库里查不到原文和派生记录 |
| 6 | 接入对照系统 | Mem0 开源版、Graphiti、文件系统 Agent 三个适配器 | 三者都能在开发子集上出分,版本号写进结果 |
| 7 | 全量评测 | LongMemEval_S 500 题和 LoCoMo 1,540 题,各跑 3 次 | 结果表带区间,评审校准完成 |
| 8 | 报告与演示 | 技术报告、口径对照表、简单的记忆浏览页面 | 别人按 README 能复现 LongMemEval 结果 |

开发子集要提前定死:从 LongMemEval 500 题里按六种题型分层抽 100 题做开发,调参只看这 100 题和 LoCoMo;最终报告同时给剩下 400 题和全部 500 题的分数,并注明哪部分参与过调参。

## 验收指标

| 指标 | 怎么测 | 目标 |
| --- | --- | --- |
| LongMemEval_S 总准确率 | 官方 `evaluate_qa.py`,评审 gpt-4o,3 次运行 | 高于同回答模型下的朴素 RAG,配对 bootstrap 区间不含 0 |
| 知识更新、时间推理、拒答三类分项 | 同上,按 `question_type` 和 `_abs` 后缀拆分 | 方向上高于 Mem0 开源版和朴素 RAG,如实报告 |
| 和全量上下文比 | 同回答模型 | 如实报告;LongMemEval_S 历史约 11.5 万 token,记忆系统的价值主要在每题上下文 token 和延迟 |
| LoCoMo J 分和 F1 | 第 1–4 类共 1,540 题,第 5 类无标准答案剔除 | 如实报告,并和全量上下文对比 |
| 遗忘集通过率 | 自建 50 题 | 硬删除类 100%;其他类给出数字和错例 |
| 评审误判率 | 给评审 100 个故意答错的答案,看判对的比例;再人工标 100 题算一致率 | 写进报告;误判率高就换评审或改提示词 |
| 每题成本和检索延迟 | 写入 token、回答 token、检索 p50/p95 | 记录,和全量上下文对比 |

可以引用的公开数字(都在 2026-10-15 查证,口径各不相同,只做背景):Zep 论文在 LongMemEval_S 上报告 gpt-4o 全量上下文 60.2%、Zep 71.2%,平均上下文从 115k 降到 1.6k token;Mem0 论文在 LoCoMo 上的 J 分见上文;Zep 博客修正后 LoCoMo 75.14;Letta 文件系统方案 LoCoMo 74.0;Mem0 新算法托管平台 LoCoMo 92.5、LongMemEval 94.4。LongMemEval 仓库在 2025 年 9 月发布了清洗版数据,用旧版和新版的分数也不可比。

成本算式(价格 2026-10-15 查):LongMemEval_S 每题自带一份约 11.5 万 token 的历史(README 按 Llama 3 分词器估),500 题合计约 5,750 万 token。Hippo 写入时要把历史读一遍,加上提示词和已有记忆,按 1.5 倍算约 8,600 万输入 token;用 [DeepSeek](https://api-docs.deepseek.com/quick_start/pricing) `deepseek-flash` 闲时未命中价 $0.15/百万,约 $13,输出按输入的 5% 算再加约 $2.6。回答每题约 5 千 token,500 题不到 $1。官方评审用 gpt-4o,[OpenAI 价格页](https://developers.openai.com/api/docs/pricing)标准价输入 $2.50、输出 $10,Batch 减半,500 题每题约 1 千 token,约 $1.3。全量上下文基线 5,750 万输入 token 用 deepseek-flash 约 $8.6,换成 gpt-4o 就是 $144,所以别用 gpt-4o 跑全量上下文。Graphiti 每段对话的写入会调用多次模型,成本可能是 Hippo 的几倍,建议它只跑开发子集。LoCoMo 很便宜:Mem0 论文里全量上下文约 2.6 万 token,1,540 题 × 2.6 万 ≈ 4,000 万 token,闲时约 $6。公式写成:总成本 ≈ 方案数 × 运行次数 × (写入 token × 输入价 + 回答 token × 输入价 + 评审费用),写入只需做一次,缓存好就能反复评测。

## 最终产出

- 仓库 `hippo/`:记忆服务、六个方案的适配器、评测外壳,一条命令复现。
- 技术报告:设计取舍、分项结果、消融表、遗忘集结果、评审校准,以及一张「各家公开分数口径对照表」。
- 记忆浏览页:选一个 LongMemEval 用户,看每条记忆的来源会话、有效区间、被谁取代。
- 一篇博客:用这个项目复盘 Mem0、Zep、Letta 那场争论,讲同条件对比要控制哪些变量。

## 难点和坑

各家分数直接放一张表是最大的坑。回答模型不同(GPT-4o-mini 还是 gpt-4o)、评审不同、检索条数不同(Mem0 新算法写的是 top_200)、数据版本不同(LongMemEval 清洗版)、LoCoMo 是否剔除第 5 类,任何一项不同,数字就没法比。你的报告里每个外部数字都要标这几项。

LoCoMo 的题目数要自己数。公开的 `locomo10.json` 只有 10 段对话,我数出来是 1,986 道题,其中第 5 类 446 道没有标准答案,剔除后是 1,540 道。每段对话 19 到 32 个会话。数据量这么小,一两道题判错就能动零点几个点。

说话人和时间戳的处理会直接改变结果,这正是 Zep 批评 Mem0 的两点。LoCoMo 是两个人聊天,不是用户和助手,你要决定怎么映射角色,并且对六种方案用同一种映射。事件时间一定用会话日期,不要用写入时刻,否则「上周」「去年夏天」全都算错。

全量上下文在 LoCoMo 上很强。Mem0 自己的论文里全量上下文 72.90 高于它的最好方案 68.44,原因是对话只有两万多 token,现在的模型直接读得下。想证明记忆系统有价值,主战场是 LongMemEval_S 甚至 _M,并且要同时报 token 和延迟。

LLM 评审偏宽。「她大概是去年搬的家」这种含糊回答经常被判对。第 7 周的评审校准就是为此设计的,误判率不测清楚,两个方案差 2 个点没有意义。

写入成本会在调试时失控。每改一次抽取提示词,全部历史都要重新写入一遍,LongMemEval_S 一遍就是上千万 token。抽取结果按「会话内容哈希 + 提示词版本」缓存;如果不同题目的历史里有重复会话,先用会话 id 查一下能不能去重。批量任务排在 DeepSeek 闲时跑,忙时价格翻倍。

对照系统的版本和形态要写清楚。Mem0 开源 SDK 不等于它的托管平台(PyPI 页面明说托管版有专有优化),你跑出的 Mem0 分数大概率和它公布的不一样,这不是你的错,但要写明版本。Letta 的主仓库已经迁到 `letta-ai/letta-code`(npm 安装的终端工具和 App Server),旧的 V1 API 服务在 archive 分支;与其硬接 Letta,不如按 Letta 那篇文章自己实现一个「文件 + grep + 语义搜索」的 Agent 基线,更可控。

硬删除容易删不干净。用户说「忘掉我女儿的名字」,原始事实删了,但合并时生成的「用户有一个女儿叫某某,在读小学」这条派生记忆还在。每条记忆记录 `derived_from`,删除时沿着来源链一起删,遗忘集里专门放这种题。

## 面试里怎么讲

示范讲法:「我做了一个 Agent 长期记忆服务,主要解决信息会变的问题:用户搬家、改主意、要求删除。设计上我没用覆盖写,也没用只追加,而是参考 Graphiti 的双时间模型,新事实让旧事实失效但保留时间线,这样『现在住哪』和『之前住哪』都能答。评测上我把六种方案接到同一个回答模型和评审上,在 LongMemEval_S 上跑官方脚本,每个方案跑三次。结果(填你的数):总分 X,知识更新类比朴素 RAG 高 Y 个点,区间 [a, b];和全量上下文比分数接近,但每题上下文从 11.5 万 token 降到 Z。取舍是写入多一次模型调用,成本高了 W%。另外我发现评审会把含糊答案判对,测出来误判率是 V%,所以小于这个量级的差异我都不下结论。」

<details><summary>Mem0、Zep、Letta 都说自己在 LoCoMo 上最好,你怎么看?</summary>

它们的数字不是同条件测的。回答模型、评审、检索条数、数据处理(说话人映射、时间戳、是否剔除第 5 类)都不一样,而且全是自测。Zep 指出 Mem0 跑 Zep 时把双方都设成 user、时间戳放在文本里;Letta 用最简单的文件工具就拿到 74.0,说明 LoCoMo 对话太短,区分不出记忆系统的好坏。我的做法是自己用同一套条件把它们重跑一遍,并把主要结论放在更长的 LongMemEval 上。

</details>

<details><summary>冲突更新为什么不直接覆盖旧记忆?</summary>

覆盖会丢时间线,「我之前住哪」答不了,用户纠正错误时也没法回滚。只追加又会让检索同时拿到新旧两条,回答模型经常挑错。给每条记忆加有效区间是中间方案:旧记忆填上失效时间,检索默认只取当前有效的,问到过去时再按时间范围取。代价是写入时要多做一次对齐和判断。

</details>

<details><summary>遗忘在基准里几乎没考,你为什么还要做?</summary>

LongMemEval 有知识更新和拒答两类,沾一点边;LoCoMo 没有考知识更新,Zep 的博客也批评过这一点。但产品里遗忘是硬需求:隐私法规要求能删,过期信息要降权,记忆多了检索噪声会变大。所以我自建了 50 题的遗忘集,专门测删除后是否还能被问出来,包括从被删事实推出来的派生记忆。

</details>

## 前置知识

- Day 17、Day 18:pgvector、混合检索、rerank(Hippo 用 SQLite 实现同样的思路)
- Day 19:检索评测,召回率与 MRR
- Day 20、Day 48:上下文工程与长期记忆、SupportPilot 的客户记忆
- Day 32、Day 70:LLM-as-judge 与评审校准
- Day 63:长任务里的外部记忆
- Day 64:记忆系统的分类、写入、冲突、遗忘,以及 Mem0、Letta、Zep 的初步对比
- Day 69:置信区间与配对检验

## 参考资料

- [LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory](https://arxiv.org/abs/2410.10813)(Wu 等,2024):主基准,五种记忆能力的定义和索引、检索、阅读三段式设计建议。
- [LongMemEval 仓库](https://github.com/xiaowu0162/LongMemEval):数据、官方评测脚本 `evaluate_qa.py`,2026 年仍有更新。
- [LongMemEval 清洗版数据](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned):2025 年 9 月发布,用它跑并在报告里注明。
- [Evaluating Very Long-Term Conversational Memory of LLM Agents](https://arxiv.org/abs/2402.17753)(Maharana 等,2024):LoCoMo 论文。
- [snap-research/locomo](https://github.com/snap-research/locomo):`locomo10.json` 数据,仓库 2024 年 8 月后没再更新,只当数据源用。
- [Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory](https://arxiv.org/abs/2504.19413)(Chhikara 等,2025):Mem0 的 LoCoMo 对比表和全量上下文基线。
- [mem0ai/mem0](https://github.com/mem0ai/mem0) 和 [PyPI 页面](https://pypi.org/project/mem0ai/):开源 SDK;PyPI 页面写着 2026 年 4 月新算法的说明和托管平台口径。
- [Zep: A Temporal Knowledge Graph Architecture for Agent Memory](https://arxiv.org/abs/2501.13956)(Rasmussen 等,2025):双时间知识图谱和 LongMemEval_S 结果。
- [getzep/graphiti](https://github.com/getzep/graphiti):Zep 开源的图谱引擎,冲突时让旧事实失效而不删除,活跃维护。
- [Zep 博客:Is Mem0 Really SOTA in Agent Memory?](https://www.getzep.com/blog/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/):对 Mem0 评测方法和 LoCoMo 本身的批评。
- [Letta 博客:Benchmarking AI Agent Memory](https://www.letta.com/blog/benchmarking-ai-agent-memory):文件系统 Agent 在 LoCoMo 上的 74.0,本项目的一个基线照它实现。
- [MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560)(Packer 等,2023):分层上下文和 Agent 自管记忆的思路来源。
- [letta-ai/letta-code](https://github.com/letta-ai/letta-code):Letta 当前的主仓库,了解现状用。
- [A-MEM: Agentic Memory for LLM Agents](https://arxiv.org/abs/2502.12110)(Xu 等,2025):Zettelkasten 式记忆互链和记忆演化,加分项参考;系统实现在 [A-mem-sys](https://github.com/WujiangXu/A-mem-sys)。
