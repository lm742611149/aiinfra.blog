---
title: 'Day 57 · 面试(一):高频基础题 60 道'
description: 'Agent 岗技术一面的高频题,按模型与提示词、工具调用、RAG、Agent 架构与框架原理、上下文工程、MCP 与 Skills、评测、安全与工程化分组,一共 60 道。每道题给答题要点,答案折叠,先自己说一遍再展开。题目的侧重按 880 条真实 JD 的技能频次分配。'
pubDate: 2026-10-12
regime: none
tags: ['interview', 'fundamentals', 'rag', 'agent', 'mcp', 'evals', 'agent-60']
series: 'agent-60'
day: 57
lang: 'zh'
---

## 今天要解决的问题

简历投出去,第一轮技术面基本是两块:基础概念,加上围绕你简历项目的追问。项目追问你已经在 Day 54 和 Day 56 准备过了,今天专攻基础题。

今天结束时你应该:

1. 把 60 道题每道都**出声**答一遍,再展开对照要点,标出答得不好的题。
2. 对标出来的题,回到对应的课程那天重读,第二轮再答。
3. 每道题都能在答完概念之后接一句「在我的 SupportPilot 里是这样做的……」。
4. 能在白板或在线编辑器上 10 分钟内手写一个不用框架的 Agent 循环。

预计用时 5–8 小时,建议分两到三次做完。前置是整门课程,题目后面都标了对应的 Day,答不上来就回去看。

## 题目怎么选的、怎么答

题目的分布参考了站长 2026 年 10 月整理的 880 条 Agent 岗 JD 的技能频次。国内有正文的 334 条里,工具调用(55%)、上下文工程(52%)、RAG(51%)、评测(48%)、框架与 Prompt(各 46%)、多 Agent(37%)出现最多,熟练使用 Coding Agent 约两成,MCP 17%,还有约一成提到 Skills,好几个大厂岗位直接叫「Agent Harness」;海外评测(62%)和 RAG(54%)最高。所以这 60 题里,工具调用、RAG、架构、上下文工程、评测占了大头,并且专门加了「框架底层原理」「什么时候不用框架」「Skills、MCP 和子 Agent 怎么分工」这几类近一年明显变多的题。

另外几个公开的真实面经也印证了这个方向:B 站上一位候选人复盘的腾讯 AI Agent 实习一面,篇幅最大的就是 Agent 和 RAG,其中 Agent 部分问得很细;另一个汇总 2026 年 5 月面经的合集里,高频题包括「Agent 如何保证工具调用的可靠性」「上下文怎么取舍」「Multi-Agent 中主 Agent 如何派生子 Agent」。

答题时我推荐一个四步结构,几乎每道题都能套:

<figure>
<svg viewBox="0 0 640 170" role="img" aria-label="基础题的四步答题结构">
  <rect x="0" y="0" width="640" height="170" fill="var(--paper-raised)"/>
  <rect x="16" y="50" width="134" height="56" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="28" y="74" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">1 一句话定义</text>
  <text x="28" y="92" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">先给结论</text>
  <rect x="170" y="50" width="134" height="56" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="182" y="74" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">2 机制</text>
  <text x="182" y="92" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">它怎么工作</text>
  <rect x="324" y="50" width="134" height="56" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="336" y="74" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">3 取舍</text>
  <text x="336" y="92" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">代价和边界</text>
  <rect x="478" y="50" width="146" height="56" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="490" y="74" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">4 我的项目里</text>
  <text x="490" y="92" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">一个具体例子</text>
  <line x1="150" y1="78" x2="170" y2="78" stroke="var(--ink-faint)"/>
  <line x1="304" y1="78" x2="324" y2="78" stroke="var(--ink-faint)"/>
  <line x1="458" y1="78" x2="478" y2="78" stroke="var(--ink-faint)"/>
  <text x="16" y="146" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">前两步证明你懂,后两步证明你做过。只背前两步的人很多,能讲后两步的人少</text>
</svg>
<figcaption>一道基础题的答题结构。面试官对「背过」和「做过」的区分,主要看第 3、4 步。</figcaption>
</figure>

一道题答一到两分钟。答太短显得只背了定义,答太长面试官会打断。第 4 步是你的主场,讲完自然会引出项目追问,而项目追问你准备得最充分。

下面每题后面的答案是要点,不是标准答案,用你自己的话和你自己项目里的例子讲出来。

## 题库(一):模型、提示词与结构化输出

### 大模型基础

**1. token 是什么?为什么中文常常比英文更费 token?(Day 1)**

<details><summary>答案</summary>

token 是模型处理文本的最小单位,由 tokenizer(多数是 BPE 一类的子词算法)把文本切出来。上下文窗口、计费、延迟都按 token 算。中文在很多以英文为主训练的 tokenizer 里,一个汉字可能被切成一个甚至多个 token,而英文常见词往往一个词一个 token,所以同样意思的中文可能更费 token;国产模型的 tokenizer 对中文做了优化,差距会小很多。实际项目里估成本要用目标模型的 tokenizer 或者直接看 API 返回的 usage。

</details>

**2. temperature 和 top_p 分别控制什么?Agent 场景一般怎么设?(Day 1)**

<details><summary>答案</summary>

两者都控制采样随机性。temperature 改变概率分布的平滑程度,越低越倾向于选最高概率的 token;top_p 只在累计概率达到 p 的候选里采样。一般只调一个。Agent 里的工具调用、分类、结构化抽取要稳定,用低温;起草回复可以稍高。评测时温度要固定,否则分数波动大。部分推理模型不允许改这些参数,以官方文档为准。

</details>

**3. 大模型为什么会幻觉?工程上有哪些降低手段?(Day 1、Day 16)**

<details><summary>答案</summary>

模型本质是根据上下文预测下一个 token,它没有「不知道」的内在机制,缺知识时也会生成看起来合理的内容。工程手段:用 RAG 提供依据并要求引用出处;用工具查真实数据而不是让模型记;在提示词里允许「不知道」并给出转人工路径;对输出做结构化校验和事实核对(比如回复里的发票号必须来自工具结果);用评测集量化幻觉率。在 SupportPilot 里,回复中的金额和发票号都要能在工具结果里找到,找不到就判为不通过。

</details>

**4. 模型支持 128K 上下文,是不是把资料都塞进去就行了?(Day 20)**

<details><summary>答案</summary>

不是。一是成本和延迟随输入线性增长;二是长上下文下模型对中间位置信息的利用变差(lost in the middle),上下文越长、无关内容越多,效果越容易下降(常被称为 context rot);三是噪音会干扰工具选择。正确做法是按任务挑选最相关的内容,控制每部分的 token 预算。

</details>

**5. 推理模型(会先「思考」的模型)和普通模型在 Agent 里怎么选?(Day 1、Day 52)**

<details><summary>答案</summary>

推理模型在多步规划、复杂判断、需要严谨推导的任务上更好,代价是延迟高、token 多、成本高。简单的分类、抽取、格式转换用普通模型或小模型就够。常见做法是模型路由:规划或高风险判断用推理模型,其余用便宜模型。选择要用评测数据支持,不能只凭感觉。

</details>

**6. 预训练、指令微调、RLHF 分别带来了什么?Agent 工程师为什么要知道这些?(Day 1)**

<details><summary>答案</summary>

预训练让模型学到语言和世界知识;指令微调(SFT)让它学会按指令回答、按格式输出、调用工具;基于人类或 AI 反馈的强化学习让它更符合偏好,比如更有帮助、更愿意拒绝有害请求。工程上的意义:模型「尽量满足用户」的倾向来自后训练,这正是 prompt injection 容易成功的原因之一;工具调用能力的强弱也主要取决于后训练,所以不同模型的工具调用可靠性差别很大,要实测。

</details>

**7. 什么时候该考虑微调,而不是继续改 prompt 或加 RAG?**

<details><summary>答案</summary>

缺知识用 RAG,知识会更新的更要用 RAG。微调适合:需要稳定的特定输出格式或风格、想让小模型在窄任务上替代大模型以降低成本和延迟、prompt 已经很长且仍不稳定。前提是先有评测集,能量化微调前后的差异,以及训练数据的来源和质量。轻量方式通常是 LoRA。国内约两成 Agent 岗 JD 提到微调,中小公司常要求「独立做过一次轻量微调」。

</details>

### 提示词与结构化输出

**8. 一个好的 system prompt 一般包含哪些部分?(Day 5)**

<details><summary>答案</summary>

角色和任务目标;输入是什么、来自哪里(哪些内容是不可信数据);输出格式和长度;明确的规则与边界(能做什么、不能做什么、不确定时怎么办);必要的示例;对工具的使用说明。写法上要清晰直接,用 XML 标签或标题分隔不同部分,固定部分放前面以便缓存。改动要进版本管理并跑回归评测。

</details>

**9. few-shot 示例有哪些坑?(Day 5)**

<details><summary>答案</summary>

模型会过度模仿示例的长度、语气、甚至具体内容;示例分布单一会导致偏置(比如示例全是退款,分类就偏向退款);示例里的错误会被学走;示例占 token。做法是示例覆盖不同类别和边界情况,数量够用即可,并用评测确认加示例确实有收益。

</details>

**10. 推理模型时代,还需要在 prompt 里写「请一步一步思考」吗?(Day 5)**

<details><summary>答案</summary>

对推理模型,显式要求逐步思考的收益通常很小,甚至可能干扰。对普通模型在复杂任务上仍有帮助。工程上更有用的做法是在结构化输出里加一个理由字段,比如分类时同时输出 reason,方便排查和让 judge 评估,但要注意它会增加输出 token。

</details>

**11. 怎么保证模型输出一定是合法、符合 schema 的 JSON?(Day 6)**

<details><summary>答案</summary>

分层保证:能用 Structured Outputs(按 JSON Schema 约束解码)的就用,只有 JSON mode 的至少保证是合法 JSON;应用层用 pydantic 校验字段和取值;校验失败时把错误信息回传让模型重试一两次;仍失败就走兜底(默认值、转人工)。不要只靠 prompt 里写「请输出 JSON」。

</details>

**12. prompt 怎么做版本管理?(Day 5、Day 35)**

<details><summary>答案</summary>

prompt 和代码一样进 git(或者进 prompt 管理平台但要有版本号),每次改动跑回归评测集并记录分数;线上 trace 里记录每次调用用的 prompt 版本,便于定位问题和回滚。改动一次只动一处,便于归因。

</details>

**13. 改 prompt 修好了 A 类问题,B 类又坏了,怎么办?(Day 30、Day 51)**

<details><summary>答案</summary>

这是没有回归评测的典型症状。先建覆盖 A、B 两类的测试集,每次改动全量跑;如果两类需求冲突,考虑路由拆开,让不同类别走不同的 prompt 或节点;不要追着单个失败样本改 prompt,先做错误分析,按失败类别的数量排优先级。

</details>

## 题库(二):工具调用与 RAG

### 工具调用

**14. function calling 的原理是什么?模型真的「执行」了函数吗?(Day 8)**

<details><summary>答案</summary>

没有。应用把工具的名称、描述、参数 JSON Schema 发给模型;模型判断需要调用时,输出一段结构化的调用请求(工具名和参数);应用解析后自己执行函数,把结果作为 tool 消息(带对应的调用 ID)放回 messages,再请求模型继续。模型能输出这种格式,是后训练学会的。所以执行、权限、校验全部在应用侧,这也是安全设计的抓手。

</details>

**15. 不用框架,手写一个 Agent 循环,说说关键结构。(Day 9)**

<details><summary>答案</summary>

一个 while 循环:把 messages 和 tools 发给模型;如果返回里没有工具调用,输出最终回答并结束;如果有,逐个解析参数、校验、执行,把结果作为 tool 消息追加,继续循环。必须有的保护:最大步数、单步超时、工具执行异常转成可读错误回传、总 token 或成本上限、日志记录每一步。面试常要求现场写,15 到 30 行就能写出骨架,重点说清楚这些保护。

</details>

**16. 工具描述应该怎么写?(Day 11)**

<details><summary>答案</summary>

写给模型看的,要说清楚什么时候用、什么时候不用、参数含义和取值范围、返回什么;名字有区分度,避免两个工具功能重叠;参数尽量用枚举约束;描述里可以给一个简短示例。返回值要精简,只给模型需要的字段;报错信息要能指导模型自我纠正,比如「日期格式应为 YYYY-MM-DD」。

</details>

**17. 工具有上百个时怎么办?(Day 11、Day 26)**

<details><summary>答案</summary>

全部塞给模型会导致选错工具、上下文膨胀、成本上升。做法:合并功能相近的工具;按领域分组,先路由到某一组;按需检索工具(根据任务语义找出相关的少数工具再暴露);或者让不同子 Agent 各持一组工具。注意动态改变工具列表会破坏 prompt 缓存前缀,要权衡。

</details>

**18. 并行工具调用要注意什么?(Day 8)**

<details><summary>答案</summary>

只有互不依赖的调用才能并行,比如同时查发票和查订阅;有依赖的(先查客户再查他的发票)必须串行。有副作用的工具要幂等,避免并行或重试导致重复执行。结果要按调用 ID 对应回传。并行能明显降低延迟,但也可能同时触发多个外部系统的限流。

</details>

**19. 模型调用了不存在的工具,或者参数格式错了,怎么处理?(Day 12)**

<details><summary>答案</summary>

用 schema 在执行前校验;不存在的工具名、类型错误、取值越界都返回一条清晰的错误信息作为 tool 结果,让模型自己纠正;限制重试次数,超过就终止或转人工;从源头减少,比如用枚举、给参数示例、减少工具数量。把这类错误记进 trace 和指标,作为评测里的工具调用错误率。

</details>

**20. 工具返回结果太长(比如查出 500 条记录)怎么办?(Day 11、Day 20)**

<details><summary>答案</summary>

工具层就控制:分页、限制条数、只返回必要字段;返回摘要和统计,而不是原始数据;返回一个引用 ID,让模型需要时再取详情。长结果直接塞进上下文既贵又会干扰模型。

</details>

### RAG

**21. 讲一下 RAG 的完整流程。(Day 16)**

<details><summary>答案</summary>

离线:文档解析、清洗、切块、向量化、写入索引(向量库,加上关键词索引和元数据)。在线:query 改写或扩展,混合检索召回候选,rerank 排序,取前 k 段按 token 预算拼进 prompt,要求模型基于资料回答并引用来源,最后可做引用校验。还有一条持续的链路:评测与更新,文档变了要增量更新索引。

</details>

**22. 切块大小怎么定?有哪些策略?(Day 16)**

<details><summary>答案</summary>

块太小上下文不完整,太大噪音多、检索不精准。策略有固定长度加重叠、按标题或段落等文档结构切、按语义切。没有通用最佳值,用检索评测集比较几种配置的 recall。帮助中心类文档按标题层级切通常效果好,并在块里保留标题路径作为上下文。

</details>

**23. 为什么要做混合检索?(Day 18)**

<details><summary>答案</summary>

向量检索擅长语义相似,但对专有名词、产品型号、错误码、发票号这类精确字符串不敏感;BM25 关键词检索正好相反。两路召回后用 RRF 等方法融合,通常比单路更稳。客服场景里用户经常直接贴错误码,这时 BM25 很关键。

</details>

**24. rerank 是做什么的?为什么不直接用 rerank 模型做检索?(Day 18)**

<details><summary>答案</summary>

rerank 模型(通常是交叉编码器)把 query 和每个候选一起输入打分,比向量相似度更准。但它要对每个候选单独计算,没法像向量那样预先建索引,对全库计算太慢太贵。所以先用便宜的召回拿几十个候选,再用 rerank 精排取前几个。

</details>

**25. RAG 回答不准,怎么排查?(Day 19)**

<details><summary>答案</summary>

先把检索和生成分开看:用检索评测集看 recall@k,相关文档有没有被召回。没召回,查切块、embedding 模型、query 改写、元数据过滤条件是不是写错了;召回了但答错,看是不是被排在后面没进上下文、上下文太长被淹没,或者 prompt 没有要求基于资料回答。用 trace 看具体样本,不要凭感觉改。

</details>

**26. RAG 怎么评估?(Day 19)**

<details><summary>答案</summary>

检索侧:recall@k、MRR、nDCG,需要标注每个问题对应的相关文档。生成侧:忠实度(回答是否被检索内容支持)、答案相关性、引用正确率,可以用 LLM-as-judge 并与人工抽检校准。测试集要包含无答案的问题,检查模型会不会编。

</details>

**27. 向量库怎么选?(Day 17)**

<details><summary>答案</summary>

看数据规模、团队运维能力、是否需要强元数据过滤和混合检索、是否已有数据库。百万级以内、已经用 Postgres 的团队,pgvector 最省事,事务和权限过滤都能复用;更大规模、高并发的专用场景考虑 Milvus、Qdrant;已有 Elasticsearch 的团队可以直接用它的向量和全文检索。选型理由比选哪个更重要。

</details>

**28. RAG、长上下文、Agentic RAG 怎么取舍?(Day 20)**

<details><summary>答案</summary>

知识量小而且相对固定,可以直接放上下文(配合缓存);知识量大或经常更新,用 RAG;问题需要多跳、需要判断要不要查、查什么,用 Agentic RAG,把检索做成工具让 Agent 决定何时调用、可以多次调用。Agentic RAG 更灵活但更慢更贵,也更难评测。

</details>

## 题库(三):Agent 架构、框架原理与上下文工程

### 架构与框架原理

**29. Workflow 和 Agent 有什么区别?怎么选?(Day 13)**

<details><summary>答案</summary>

按 Anthropic 的定义,workflow 是由代码预先定义执行路径、在其中调用模型;agent 是由模型动态决定流程和工具使用。能用 workflow 解决就用 workflow,它更可预测、更便宜、更好评测;只有步骤无法预先确定、需要模型根据中间结果决定下一步时才用 agent。实际系统常常是 workflow 里嵌一个 agent 节点。

</details>

**30. 常见的 workflow 模式有哪几种?(Day 13)**

<details><summary>答案</summary>

prompt chaining(串行多步)、routing(先分类再分发)、parallelization(分段并行或多次投票)、orchestrator-workers(中心模型动态拆分子任务给 worker)、evaluator-optimizer(生成、评估、改进循环)。SupportPilot 用到了 routing(按类别选路径和模型)和 evaluator-optimizer(自检不通过就重写)。

</details>

**31. ReAct 是什么?在原生 function calling 普及后它还重要吗?(Day 10)**

<details><summary>答案</summary>

ReAct 让模型交替输出思考(Thought)、行动(Action)、观察(Observation),把推理和工具使用结合起来。原生 function calling 普及后,不再需要用文本格式解析 Action,但「想一下、调工具、看结果、再决定」这个循环就是今天 Agent 循环的基本形态,推理模型则把 Thought 部分内化了。面试答 ReAct 时说清这层演变会加分。

</details>

**32. LangGraph 底层是怎么实现的?(Day 24、Day 25)**

<details><summary>答案</summary>

你定义一个状态结构、若干节点函数和边(含条件边),编译后由一个受 Pregel 启发的运行时执行:按「超步」推进,每个超步里被激活的节点读取当前状态、返回状态更新,更新通过每个字段的 reducer 合并(比如消息列表是追加而不是覆盖);边决定下一步激活哪些节点。配置了 checkpointer 时,每个超步结束都按 thread_id 保存一份状态快照,所以能断点恢复、回放历史;interrupt 本质是在节点里暂停执行并把状态存下,恢复时带着人的输入从该点继续。能讲出「状态 + reducer + 超步 + checkpoint」这几个词,比只会背 API 有说服力得多。

</details>

**33. 什么时候不应该用 Agent 框架?(Day 27)**

<details><summary>答案</summary>

逻辑简单、一个循环就能搞定时;需要对每一步完全控制、框架的抽象反而碍事时;框架版本变动快、团队没精力跟进时;调试时需要穿透多层抽象才能看到真实 prompt 时。Anthropic 的建议是先直接用模型 API,很多模式几十行代码就能实现。需要持久化、人工审批、流式、断点续跑这些能力时,框架的价值才明显。面试官问这题,是在看你懂不懂框架帮你做了什么。

</details>

**34. 长任务里,怎么让 Agent 不跑偏?(Day 10、Day 12)**

<details><summary>答案</summary>

先规划再执行,把计划写成 todo 列表并逐项更新状态;每个子任务设验收条件;关键节点设检查点,必要时让人确认;步数和预算上限;定期把目标和当前进度重新放进上下文;子任务交给独立上下文的子 Agent,只回传结论。并用轨迹评测发现偏移模式。

</details>

**35. Agent 常见的失败模式有哪些?分别怎么处理?(Day 12)**

<details><summary>答案</summary>

死循环(反复调同一个工具):步数上限加重复检测;乱调工具或幻觉工具名:schema 校验、减少工具数量、清晰描述;参数错误:校验后返回可读错误让其自纠;工具超时或报错:重试加退避,超过次数降级;上下文过长导致遗忘:压缩和摘要;提前宣布完成:用验收条件或自检节点检查;最终兜底是转人工。

</details>

**36. 多 Agent 什么时候值得用,什么时候不该用?(Day 26)**

<details><summary>答案</summary>

值得用:任务能拆成可并行的独立子任务,或者子任务需要大量独立上下文(比如广泛搜索),用子 Agent 隔离上下文能提升效果。Anthropic 的多 Agent 研究系统在内部评测上比单 Agent 高 90.2%,但 token 消耗约是普通对话的 15 倍。不该用:子任务之间强依赖、需要频繁共享上下文(比如大多数写代码任务),或者预算敏感的场景。多 Agent 还会引入协调失败,调试更难。

</details>

### 上下文工程与记忆

**37. 什么是上下文工程?和提示词工程有什么区别?(Day 20)**

<details><summary>答案</summary>

提示词工程关注怎么写指令;上下文工程关注每一次调用模型时,上下文窗口里到底放什么:系统提示、工具定义、检索结果、工具返回、对话历史、记忆,各占多少、按什么顺序、何时压缩或清理。Agent 多轮运行时上下文会不断膨胀,上下文工程决定了它能不能长时间保持效果。国内 JD 里约一半(52%)提到这一项,海外只有 25%,是国内比海外明显更看重的方向。

</details>

**38. 为什么上下文越长效果可能越差?(Day 20)**

<details><summary>答案</summary>

模型的注意力是有限资源,无关内容越多,关键信息越容易被忽略;放在中间的信息利用率更低;过时的工具结果、错误的中间尝试留在上下文里会误导后续决策。所以要主动管理:只保留有用的内容,而不是能塞多少塞多少。

</details>

**39. 长对话或长任务的上下文怎么压缩?(Day 20、Day 48)**

<details><summary>答案</summary>

保留系统提示和最近几轮原文,较早的对话摘要化;清理已经用过的工具结果,只留结论;接近窗口上限时做一次整体压缩,把关键决策、未完成事项、重要事实写成精简摘要后重新开始;把需要长期保留的信息写到外部(笔记文件、数据库),需要时再读回。压缩要注意别破坏缓存前缀,并用评测检查压缩后任务成功率有没有下降。

</details>

**40. 短期记忆和长期记忆怎么设计?(Day 20、Day 48)**

<details><summary>答案</summary>

短期记忆是当前会话状态,用 checkpoint 按会话 ID 持久化。长期记忆是跨会话的事实和偏好,比如客户的历史工单摘要、套餐信息。要设计写入时机(会话结束时抽取)、检索方式(按客户 ID 精确取或按语义检索)、冲突和过期处理、以及隐私(哪些能存、存多久)。别把所有历史都塞进去。

</details>

**41. 在 SupportPilot 这样的系统里,上下文预算怎么分配?(Day 52)**

<details><summary>答案</summary>

按「固定前缀 + 动态内容」分:系统提示、政策、工具定义、示例作为稳定前缀放最前面以命中缓存;动态部分里给检索结果一个上限(比如 5 段、约 2,000 token),工具结果只保留需要的字段,对话历史保留最近几轮加摘要,客户画像精简成几行。每部分的上限用评测调出来,不是拍脑袋。

</details>

**42. 子 Agent 怎么帮助上下文管理?(Day 26)**

<details><summary>答案</summary>

把需要读大量材料的子任务(比如翻 20 份文档找答案)交给子 Agent,它在自己独立的上下文里完成,只把精简结论返回给主 Agent,主 Agent 的上下文就不会被中间过程淹没。代价是额外的 token 和协调成本,以及子 Agent 可能缺少主任务的背景,所以派发任务时要写清目标、边界和返回格式。

</details>

## 题库(四):MCP 与 Skills、评测、安全与工程化

### MCP、Skills 与分工

**43. MCP 是什么?解决什么问题?(Day 22)**

<details><summary>答案</summary>

Model Context Protocol,一个让 AI 应用和外部工具、数据源对接的开放协议。解决 M 个应用乘以 N 个工具都要单独集成的问题:工具方写一个 MCP server,任何支持 MCP 的应用(host 里的 client)都能接。server 可以暴露 tools(可执行操作)、resources(可读数据)、prompts(模板);消息格式基于 JSON-RPC,传输方式有本地 stdio 和远程的 Streamable HTTP。

</details>

**44. MCP 和 function calling 是什么关系?(Day 22)**

<details><summary>答案</summary>

不是一个层面的东西。function calling 是模型 API 的能力,规定模型如何表达「我要调这个函数」;MCP 是应用和工具提供方之间的协议,规定工具如何被发现和调用。典型链路是:应用通过 MCP 拿到工具列表,转成 function calling 的工具定义发给模型,模型输出调用请求,应用再通过 MCP 让 server 执行。

</details>

**45. 接入第三方 MCP server 有什么安全风险?(Day 23、Day 39)**

<details><summary>答案</summary>

工具描述本身可能包含恶意指令(工具投毒),会进入模型上下文;server 返回的内容是不可信输入,可能带间接注入;server 权限过大或保存了你的凭据;server 更新后行为改变。对策:只用可信来源并锁定版本,审查工具描述,最小权限,敏感操作人工确认,把 MCP 返回内容当作不可信数据处理。

</details>

**46. Skills 是什么?和 MCP 工具、prompt 有什么区别?(Day 27)**

<details><summary>答案</summary>

Skill 是一个按需加载的能力包,通常是一个目录:一份说明文件(带名称和简短描述的元信息,加上详细的操作步骤),外加可能用到的脚本、模板、参考资料。Agent 平时只在上下文里保留每个 Skill 的名称和描述,判断需要时才把完整内容读进来,这叫渐进式披露,能在不撑爆上下文的前提下给 Agent 很多种专业能力。区别:MCP 工具提供「能连接和操作什么」,Skill 提供「某类事情应该怎么做」的流程知识;和写死在系统提示里的 prompt 相比,Skill 是按需加载、可复用、可单独维护的。国内约一成 JD 提到 Skills。

</details>

**47. 国内很多岗位叫「Agent Harness 工程师」,Harness 指什么?**

<details><summary>答案</summary>

指 Agent 的运行底座,也就是模型之外的那一整套工程:agent loop 的调度、工具和 Skill 的抽象与注册、上下文的组装与压缩、长任务状态持久化与 checkpoint 恢复、子 Agent 并发编排、沙箱隔离与权限控制,再加上全链路 tracing 和评测。腾讯一个 Agent Harness 岗位的职责几乎就是按这个清单写的。你在课程里手写 Agent 循环、做 checkpoint、做 tracing 和评测,都是 Harness 的组成部分,答题时可以这样串起来。

</details>

**48. 主 Agent、子 Agent、Skill、MCP 工具,在一个系统里怎么分工?举例说明。**

<details><summary>答案</summary>

主 Agent 负责理解用户目标、规划、对最终结果负责;子 Agent 处理可以独立完成、需要大量上下文的子任务,只返回结论;Skill 封装可复用的做事方法(比如「处理退款工单的标准流程和话术」),按需加载;MCP 工具负责访问外部系统(查发票、建审批单)。以 SupportPilot 为例:主工作流处理工单,一个「历史工单调研」子 Agent 去翻客户过往工单并汇总,退款流程写成 Skill,账单查询和退款申请是 MCP 工具。判断标准:需要隔离上下文的用子 Agent,需要复用知识的用 Skill,需要访问外部系统的用工具。

</details>

### 评测与可观测

**49. 为什么说 Agent 必须有评测?你的评测体系怎么搭的?(Day 29、Day 35)**

<details><summary>答案</summary>

没有评测就没法判断一次改动是变好还是变坏,模型输出的不确定性让「看几个例子觉得不错」极不可靠。体系分层:规则断言(格式、必含字段、禁止内容)、LLM-as-judge(质量、忠实度)、轨迹检查(工具选择、步数)、人工抽检校准 judge;测试集包含常规、边界、对抗用例;接入 CI 作为回归门禁。最后讲你项目里的测试集规模和分数变化。

</details>

**50. LLM-as-judge 有哪些偏差?怎么校准?(Day 32)**

<details><summary>答案</summary>

位置偏差(两两比较时偏向某个位置)、冗长偏差(偏好更长的回答)、自我偏好(偏好同家族模型的输出)、对评分标准理解不一致。校准:尽量用二元判断和明确的评分细则而不是 1 到 10 分;交换顺序做两次;用一批人工标注样本计算一致率,不够高就改 judge 的 prompt;judge 本身也要版本化和评测。

</details>

**51. 怎么评估 Agent 的轨迹,而不只是最终结果?(Day 33)**

<details><summary>答案</summary>

检查工具选择是否正确、参数是否正确、有没有多余或危险的调用、步数和成本、是否在应该转人工时转人工。可以和参考轨迹比对,也可以用规则(比如「退款类工单必须调用 request_refund 而不是其他写操作」)或 judge 评估。多轮场景可以用模拟用户驱动对话来测。

</details>

**52. 测试集从哪来?怎么防止它变得没用?(Day 31)**

<details><summary>答案</summary>

来源:真实线上样本(脱敏)、按维度用模型合成、人工编写的边界和对抗用例、线上失败的 trace 回流。防止失效:定期从线上补新样本,失败案例加进去,区分开发集和保留集避免对测试集过拟合,测试集要版本化。

</details>

**53. Agent 上线后,线上监控看哪些指标?(Day 34、Day 52)**

<details><summary>答案</summary>

任务成功率或用户满意度、转人工率、各节点延迟和 P95、单任务成本、工具调用错误率、安全拦截次数、缓存命中率;再加上 trace 抽样复查和用户反馈收集,异常时告警。这些指标最好按版本对比,便于判断某次发布的影响。国内部分岗位还会要求用 OpenTelemetry 统一埋点。

</details>

**54. pass@k 和 pass^k 有什么区别?**

<details><summary>答案</summary>

pass@k 是同一个任务跑 k 次,至少有一次成功的概率,衡量「有没有能力做到」;pass^k 是 k 次全部成功的概率,衡量稳定性,在 τ-bench 这类 Agent 基准里用得多。生产环境更关心 pass^k,因为用户不会接受一个时灵时不灵的系统。

</details>

**55. 离线评测和线上 A/B 测试是什么关系?**

<details><summary>答案</summary>

离线评测在发布前把关,快、便宜、可重复,但测试集有限,不一定代表真实分布;线上 A/B 在真实流量上比较新旧版本,结论更可信但慢、有风险。通常流程是:离线评测不退化才进入灰度或 A/B,线上指标确认后全量。线上发现的问题样本再回流到离线测试集。

</details>

### 安全与工程化

**56. 怎么防 prompt injection?(Day 39、Day 53)**

<details><summary>答案</summary>

先承认没有能百分之百防住的 prompt 写法,重点放在限制被骗之后的损失:最小权限,身份不由模型传入;敏感操作只能申请,由人或确定性代码执行;输出检查(拒绝外链、拒绝非当前用户数据);前端不渲染模型输出的图片和链接;不可信内容加标签隔离作为辅助;维护一套注入测试集接入 CI。可以引用致命三要素(私有数据、不可信内容、对外通信)来解释风险来源。

</details>

**57. Agent 的权限怎么设计?(Day 40、Day 53)**

<details><summary>答案</summary>

工具按读、可逆写、敏感操作分级;只暴露完成任务必需的工具;操作对象的身份从服务端会话取,不作为模型参数;敏感操作加人工审批和金额等硬上限;所有写操作记审计日志;代码执行放沙箱,限制网络和文件访问。上线前用一张工具权限表做审计。

</details>

**58. 降低 Agent 成本和延迟的手段有哪些?(Day 38、Day 52)**

<details><summary>答案</summary>

成本:稳定前缀吃 prompt 缓存、大小模型路由、精简上下文和工具返回、批处理和错峰价格。延迟:流式输出降低感知延迟、并行独立的工具调用、小模型做简单步骤、减少不必要的模型调用轮次。还要能讲 ROI:模型费用往往只占 Agent 综合成本的一小部分,转人工率和出错率影响更大。

</details>

**59. 长时间运行的 Agent 任务怎么保证可靠?(Day 37)**

<details><summary>答案</summary>

状态持久化(checkpoint),进程挂了可以从断点继续;任务放队列由 worker 执行,而不是绑在一个 HTTP 请求上;工具调用带幂等键,重试不会重复扣款;每步超时和整体超时;可取消;失败分类处理(可重试的退避重试,不可重试的记录并通知)。更重的场景可以用 Temporal 这类持久化执行框架。

</details>

**60. Agent 的流式接口为什么常用 SSE?要推哪些事件?(Day 36)**

<details><summary>答案</summary>

Agent 一次处理可能十几秒,流式能大幅降低感知等待;SSE 基于普通 HTTP、单向推送、实现简单、穿透代理容易,正好匹配「服务端持续推、客户端偶尔发」的模式,WebSocket 在需要双向频繁通信时才更合适。事件类型一般包括:文本增量、工具调用开始和结果、审批请求、错误、结束;每个事件带类型字段,前端按类型渲染。

</details>

## 现场编码题:10 分钟手写 Agent 循环

技术面里另一类常见题是现场写代码,最常见的就是第 15 题的手写版。下面是一个参考答案,面试时用你最熟的语言写,伪代码风格也可以,关键是结构和保护措施要全:

```python
# agent-60-lab/interview/mini_agent.py
import json

from openai import OpenAI

client = OpenAI()
TOOLS = {}  # name -> (python 函数, JSON Schema)


def tool(schema: dict):
    def deco(fn):
        TOOLS[fn.__name__] = (fn, {"type": "function", "function": {"name": fn.__name__, **schema}})
        return fn
    return deco


def run(user_msg: str, model: str, max_steps: int = 8) -> str:
    messages = [{"role": "user", "content": user_msg}]
    specs = [spec for _, spec in TOOLS.values()]
    for _ in range(max_steps):
        resp = client.chat.completions.create(model=model, messages=messages, tools=specs)
        msg = resp.choices[0].message
        messages.append(msg.model_dump(exclude_none=True))
        if not msg.tool_calls:
            return msg.content or ""
        for call in msg.tool_calls:
            name = call.function.name
            try:
                fn, _ = TOOLS[name]  # try 只包查找这一步,工具自己抛的 KeyError 不会被说成「没有这个工具」
            except KeyError:
                result = {"error": f"没有名为 {name} 的工具"}
            else:
                try:
                    result = fn(**json.loads(call.function.arguments))
                except Exception as e:  # 参数错误或执行失败,把原因告诉模型让它纠正
                    result = {"error": f"{type(e).__name__}: {e}"}
            messages.append({
                "role": "tool",
                "tool_call_id": call.id,
                "content": json.dumps(result, ensure_ascii=False)[:4000],
            })
    return "步数超限,已转人工"
```

<div class="line-notes">

- `client = OpenAI()` 不传参数时,SDK 从环境变量 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL` 读配置。面试时这样写最省事。实测时我把这两个变量设成练习仓 `.env` 里的 DeepSeek 地址和 key,模型用 `deepseek-flash`。
- `TOOLS = {}  # name -> (python 函数, JSON Schema)` 工具注册表:名字对应一个二元组,一份给 Python 调用,一份给模型看。
- `def tool(schema: dict):` 带参数的装饰器,有三层:`tool(schema)` 先返回 `deco`,`deco(fn)` 才真正处理函数。用法是 `@tool({...})`。
- `TOOLS[fn.__name__] = (fn, {"type": "function", "function": {"name": fn.__name__, **schema}})` `**schema` 把传进来的 description、parameters 展开合并进去。实测我注册了一个 `get_temp`,生成的 spec 是 `{"type": "function", "function": {"name": "get_temp", "description": "查城市当前气温(摄氏度)", "parameters": {...}}}`。
- `return fn` 原函数原样返回,加了装饰器以后照样能直接调用。
- `messages = [{"role": "user", "content": user_msg}]` 实测问的是「北京和上海哪个更冷?差几度?」。
- `specs = [spec for _, spec in TOOLS.values()]` `_` 表示这个位置的值(Python 函数)用不上。只把 schema 列表发给模型。
- `for _ in range(max_steps):` 步数上限,默认 8。模型一直要调工具也最多转 8 圈,这是面试官最想看到的保护措施之一。
- `resp = client.chat.completions.create(model=model, messages=messages, tools=specs)` 实测第 1 步只发了 1 条消息,模型一次返回两个工具调用:`get_temp({"city": "北京"})` 和 `get_temp({"city": "上海"})`,content 是「我先查一下两地当前气温。」。用量 299/89。
- `messages.append(msg.model_dump(exclude_none=True))` 把 SDK 对象转成 dict 再放回历史,`exclude_none` 去掉值为 None 的字段。实测 DeepSeek 返回的 dict 有 `content`、`role`、`tool_calls`、`reasoning_content` 四个键。`reasoning_content` 也一起带回去了:DeepSeek 开着思考模式做工具调用时,下一轮要把这段思考原样传回去,`model_dump` 正好替你做了这件事。
- `if not msg.tool_calls:` 模型不再调工具,就把它的文字回答当成最终结果。实测第 2 步(此时消息有 4 条:user、assistant、两条 tool)返回「北京更冷……北京比上海低 **11.7°C**。」,`finish_reason` 是 `stop`。
- `for call in msg.tool_calls:` 同一轮的多个调用按顺序逐个执行。Day 58 会改成并行。
- `fn, _ = TOOLS[name]  # try 只包查找这一步` 这个 `try` 只包住「按名字找工具」这一步,工具名不存在才会抛 `KeyError`。用假客户端让模型调一个不存在的 `get_weather`,得到 `{"error": "没有名为 get_weather 的工具"}`。
- `else:` `try/except/else` 的写法:`try` 里没出异常才走 `else`,也就是工具找到了才去执行它。这样做是为了避开一个坑:原来 `try` 把执行也包了进去,工具自己内部抛的 `KeyError` 也会被误报成「没有这个工具」。实测一个查字典的 `get_temp(city="拉萨")`(字典里只有北京),现在返回的是如实的 `{"error": "KeyError: '拉萨'"}`,不会再变成「没有名为 get_temp 的工具」让模型以为工具不存在。
- `result = fn(**json.loads(call.function.arguments))` 模型给的参数是 JSON 字符串,解析成 dict 后用 `**` 展开成关键字参数。实测 `{"city": "北京"}` 变成 `get_temp(city="北京")`,返回 `{"city": "北京", "temp_c": 4.5}`。
- `except Exception as e:  # 参数错误或执行失败,把原因告诉模型让它纠正` 实测两种情况。参数名写错 `{"town": "北京"}`,得到 `TypeError: get_temp() got an unexpected keyword argument 'town'`;JSON 只写了一半 `{"city":`,得到 `JSONDecodeError: Expecting value: line 1 column 9 (char 8)`。都变成 `{"error": ...}` 交给模型,循环不会崩。
- `"tool_call_id": call.id,` 每条工具结果必须带上对应调用的 id。实测 DeepSeek 给的 id 形如 `call_00_JD8GDdMV4Xgh7a8DLz580674`。漏了或者写错,下一次请求会直接 400。
- `"content": json.dumps(result, ensure_ascii=False)[:4000],` `ensure_ascii=False` 让中文原样输出,而不是 `北` 这种转义,能省不少 token。`[:4000]` 截断超长结果,防止一个工具把上下文撑爆。
- `return "步数超限,已转人工"` 实测用假客户端让模型每轮都调工具、`max_steps=2`,两圈之后返回这句话。此时消息有 9 条:1 条 user,加上两轮各 1 条 assistant 和 3 条 tool。

</div>

写完主动补充三点没写进代码的东西:超时(每次模型调用和工具调用都应该有)、成本上限、日志或 tracing。面试官通常会顺着问「如果工具很慢怎么办」「如果模型一直重复调同一个工具怎么办」,对应第 18 题和第 35 题。

## 动手练习

**步骤**

1. 找一个安静的地方,准备一个计时器,对着 60 道题逐题出声回答,每题不超过两分钟,答完展开要点对照。
2. 每题打一个标记:✓(答得完整)、△(要点漏了一半)、✗(答不上来)。
3. 对所有 △ 和 ✗ 的题,回到对应的 Day 重读,然后第二轮重答。
4. 每一道题都补一句「在我的项目里……」,写在你自己的笔记里。
5. 在纯文本编辑器里(不开自动补全、不用 Coding Agent)计时手写 Agent 循环,10 分钟内完成。
6. 找朋友或开一个新的 Claude 会话做一次 30 分钟模拟面试:让它从这 60 题里随机抽 8 题,并针对你的回答追问两层。

**验收标准**

- 第二轮后 ✗ 为零,△ 不超过 10 道。
- 每道题都有你自己项目里的一个例子。
- 手写 Agent 循环在 10 分钟内完成,包含步数上限和工具异常处理。
- 模拟面试里被追问两层时,至少六成的题能接得住。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| BPE | 一种子词切分算法,按出现频率合并字符对,得到 tokenizer 的词表 |
| lost in the middle | 长上下文中位于中间位置的信息更容易被模型忽略的现象 |
| context rot | 上下文越长、无关内容越多,模型表现越下降的现象 |
| RRF | Reciprocal Rank Fusion,按排名倒数融合多路检索结果 |
| 超步(super-step) | LangGraph 运行时的一个执行回合,本回合激活的节点执行后统一合并状态 |
| reducer | 定义状态字段如何合并更新的函数,比如消息列表用追加 |
| 渐进式披露 | Skill 只先暴露名称和描述,需要时才加载完整内容 |
| Agent Harness | 模型之外的 Agent 运行底座:循环、工具注册、上下文、持久化、沙箱、观测 |
| pass^k | 同一任务 k 次全部成功的概率,衡量稳定性 |
| 工具投毒 | 在工具描述或返回中埋入恶意指令,借此影响模型行为 |

## 常见误区

**只背定义。** 面试官一句「那你项目里怎么做的」就能区分背过和做过,每题都要准备第 4 步。

**把框架 API 当原理。** 「我调用 `add_conditional_edges`」不是原理,「状态、reducer、超步、checkpoint」才是。国内近一半 JD 点名框架,并且越来越多会追问底层。

**对多 Agent 只讲好处。** 能讲出 token 成本、协调失败、什么场景不适合,比讲十个好处更显成熟。

**把安全答成「在 prompt 里告诉它不要做」。** 这是面试里最常见的减分回答之一。

**一题讲五分钟。** 给结论、讲机制、讲取舍、举例子,两分钟内收住,让面试官决定往哪追问。

**觉得 60 题背完就够了。** 这只是一面的基础部分。项目追问和系统设计是明天的内容,往往才是决定性的。

## 学习资料

### 文档与文章

- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):第 29、30、33 题的出处,面试前重读一遍,30 分钟。
- [Anthropic · Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents):第 37 到 42 题的核心材料。
- [Anthropic · Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) 和 [Agent Skills 文档](https://docs.anthropic.com/en/docs/agents-and-tools/agent-skills/overview):第 46 题,弄清渐进式披露的设计。
- [Anthropic · How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system):第 36 题的数据出处,明天的系统设计还会用到。
- [LangGraph · Pregel 运行时](https://docs.langchain.com/oss/python/langgraph/pregel) 与 [持久化](https://docs.langchain.com/oss/python/langgraph/persistence):第 32 题,看超步、channel、checkpoint 的官方说明,40 分钟。
- [MCP 规范](https://modelcontextprotocol.io/specification/latest):第 43 到 45 题,看架构和传输两节。
- [Hamel Husain · LLM Evals FAQ](https://hamel.dev/blog/posts/evals-faq/):评测类题目的大量实战问答。
- [Lilian Weng · LLM Powered Autonomous Agents](https://lilianweng.github.io/posts/2023-06-23-agent/):经典综述,规划、记忆、工具三部分的框架至今常被面试官引用。
- 论文:[ReAct](https://arxiv.org/abs/2210.03629)(第 31 题)、[Lost in the Middle](https://arxiv.org/abs/2307.03172)(第 4、38 题)、[τ-bench](https://arxiv.org/abs/2406.12045)(第 54 题),各读摘要和图表即可。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ASuU6iEyH&autoplay=0&high_quality=1" title="腾讯AIAgent暑期实习一面" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>不转到大模型不改名 · 腾讯AIAgent暑期实习一面 · 约 38 分钟,2026 年 8 月发布的面试实录。边看边暂停,先自己答再听候选人怎么答。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1sV2PYCEo3&autoplay=0&high_quality=1" title="【沉浸式大模型面试】RAG项目拷问" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>丁师兄大模型 · 【沉浸式大模型面试】RAG项目拷问 · 4 分钟,看面试官怎么围绕一个 RAG 项目连续追问,对照第 21 到 28 题。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV15kRsBAEYe&autoplay=0&high_quality=1" title="2026年5月最新AI大模型应用开发岗面试必问50题,全是大厂真实面经整理,基础+原理+项目,一次讲清!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI大模型-阿水 · 2026年5月最新AI大模型应用开发岗面试必问50题 · 52 个分 P,当题库对照用,挑和今天 60 题不重合的看。标题有营销味,答案要自己判断。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/D7_ipDqhtwk" title="How We Build Effective Agents: Barry Zhang, Anthropic" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · How We Build Effective Agents: Barry Zhang, Anthropic · 《Building effective agents》作者之一的演讲,15 分钟左右,很多面试官的问题就来自这里。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 3、4 章(评测方法与评测 AI 系统)、第 5 章(提示工程)、第 6 章(RAG and Agents),面试前按需翻,覆盖题库约一半的题。
- Michael Albada《Building Applications with AI Agents》(O'Reilly, 2025):第 4 章 Tool Use、第 5 章 Orchestration、第 6 章 Knowledge and Memory、第 8 章 From One Agent to Many,对应第 14 到 42 题。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly, 2024):第 2 章 Tokens and Embeddings、第 8 章 Semantic Search and Retrieval-Augmented Generation,补第 1 题和 RAG 部分的底层直觉。

### 开源项目与代码

- [datawhalechina/hello-agents](https://github.com/datawhalechina/hello-agents):中文 Agent 教程,章节后面的习题可以当补充题库。
- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):想把第 32 题答得更深,读 `pregel` 目录下的核心实现。

## 自测

1. 用四步结构回答「什么是 MCP」,写下你的第 4 步。

<details><summary>答案</summary>

第 4 步示例:「在 SupportPilot 里,我把客户、订阅、发票、退款申请做成一个 MCP server,工作流通过 MCP client 拿到工具列表再交给模型;客户身份不作为工具参数,而是在建立会话时由服务端注入,这样模型被注入攻击也查不到别人的数据。」重点是有具体设计决定。

</details>

2. 面试官问「LangGraph 的 checkpoint 是怎么实现断点恢复的」,你只记得「它会保存状态」。还应该补充哪些关键词?

<details><summary>答案</summary>

按 thread_id 区分会话;每个超步结束保存一次状态快照;状态更新通过 reducer 合并;恢复时从最近快照继续执行;interrupt 暂停时状态被保存,用户输入后从中断点继续;checkpointer 可以是内存、SQLite、Postgres 等后端。

</details>

3. 「多 Agent 效果更好,所以复杂任务都应该用多 Agent」,这句话错在哪?

<details><summary>答案</summary>

忽略了代价和适用条件:多 Agent 消耗的 token 可能是普通对话的十几倍,协调失败和调试难度都会增加;它适合可并行、需要上下文隔离的任务,对子任务强依赖、需要频繁共享上下文的任务(比如大部分写代码任务)不一定更好。是否使用要看评测数据和成本。

</details>

4. (面试题)「Skill 和 MCP 工具有什么区别?你会怎么在一个系统里同时用它们?」

<details><summary>答案</summary>

MCP 工具解决「能连接、能操作什么」,Skill 解决「某类事情该怎么做」的流程知识,按需加载以节省上下文。同时使用的例子:退款处理的判断步骤、话术和注意事项写成 Skill,只在遇到退款工单时加载;查询发票、创建退款申请是 MCP 工具,Skill 里描述何时调用哪个工具。

</details>

5. 手写 Agent 循环时,哪三种情况必须处理,否则面试官一定会追问?

<details><summary>答案</summary>

模型调用了不存在的工具或参数解析失败(要返回错误让它纠正而不是崩溃);工具执行抛异常(同上);循环不终止(最大步数)。再加分的是超时、成本上限和日志。

</details>

6. 你答第 3 题(幻觉)时,怎么自然地引到自己的项目?

<details><summary>答案</summary>

讲完通用手段后接一句具体做法,例如:「在我的客服 Agent 里,回复中出现的金额和发票号必须能在本次工具结果里找到,出口检查会拦截不匹配的回复并转人工;评测集里也专门统计了这类事实错误的比例。」这会自然引出面试官对出口检查和评测的追问。

</details>

## 明天预告

Day 58 · 面试(二):系统设计题——设计企业客服 Agent 与 Deep Research Agent。基础题之后通常是一道开放的系统设计题。明天给出一套答题框架(需求、指标、架构、数据、评测、风险、成本与 ROI),用两道最常见的题完整示范一遍,并整理面试官的追问清单。
