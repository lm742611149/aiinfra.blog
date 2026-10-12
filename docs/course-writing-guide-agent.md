# agent-60 · 60 天 AI Agent 工程师速成课 · 写作规范与逐日规划

所有写手(子代理)必须读完本文件再动笔。文件路径:`~/Documents/blog/src/content/blog/agent-60/day-NN-<slug>.md`(NN 两位数,Day 0 = `day-00-...`)。校验:`python3 scripts/check-course.py [--links]`。

## 0. 这门课是给谁的、要达到什么

- 读者:**有 1 年以上编程经验的工程师**(后端/前端/测试/数据都行,不要求会 Python、不要求懂机器学习)。站长把它分享给朋友,所以写成「课程」而不是个人日记:第二人称「你」为主,可以偶尔用「我」讲踩坑经验。
- 学习节奏:**每天不限时,有空就学**。每篇的「今天要解决的问题」里给出预计用时(一般 3–6 小时,项目日可以更长)。
- 终点:**60 天后,学完站内全部内容 + 做完毕业项目的人,能投 AI Agent 工程师 / 大模型应用工程师岗位,并拿到不低于市场中位的薪资**。所以内容要对准招聘 JD 和面试真题,不教用不上的东西(不教模型训练、深度学习数学、CUDA)。
- 诚实:可以说「两个月能拿到入场券」,不能说「两个月包你高薪」。薪资数字给区间和出处/口径,不编造。

## 1. 统一技术栈(全课一致,后面的天依赖前面的代码)

- Python 3.12 + **uv**(项目管理);`openai` SDK 走 **OpenAI 兼容协议**,用环境变量切厂商:`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`。
  - 默认示例厂商:**DeepSeek**(国内直连、便宜、支持 function calling);备选:阿里云百炼(通义千问)、Kimi、智谱、OpenAI、Claude(Anthropic 也提供 OpenAI 兼容端点,但 Claude 专属能力用 `anthropic` SDK 讲)。
  - **模型名和价格写之前用 WebSearch 查当前(2026-10)官方文档**,写「2026 年 10 月查到」并给链接;拿不准的不写死,写成 `LLM_MODEL` 环境变量。
- Embedding:默认 OpenAI 兼容的 embedding 接口(如硅基流动的 `BAAI/bge-m3`、阿里百炼 text-embedding 系列、OpenAI `text-embedding-3-small`),同样用 `EMB_BASE_URL/EMB_API_KEY/EMB_MODEL` 切换。写前查证。
- 向量库:W3 先 numpy 暴力检索,再 **pgvector**(Docker 起 Postgres);BM25 用 `rank_bm25` 或 Postgres 全文检索;rerank 用 bge-reranker(API 或本地)。
- MCP:官方 Python SDK(`mcp`,FastMCP 写法)。
- 编排框架:**LangGraph** 为主;OpenAI Agents SDK / Claude Agent SDK 做对照。
- 评测与可观测:pytest + 自写 eval 脚本 + LLM-as-judge;tracing 用 **Langfuse**(可 Docker 自托管或云版)。
- 服务化:FastAPI + SSE;前端用 Streamlit(毕业项目)。部署:Docker + 一台云服务器(国内轻量云或海外 Render/Fly.io 均可,给两种)。
- 课程代码仓库约定名:`agent-60-lab/`,每周一个目录 `w1/ … w6/`,毕业项目单独仓库 `supportpilot/`。代码块第一行用注释标文件路径,如 `# agent-60-lab/w2/agent_loop.py`。

### 贯穿全课的项目线(每周小项目最终拼成毕业项目)

| 周 | 小项目 | 进入毕业项目的部分 |
| --- | --- | --- |
| W1 | 带流式输出和成本统计的命令行聊天机器人 | LLM 客户端封装、成本统计 |
| W2 | 手写 Agent 循环的命令行助手(查天气/算数/读文件/搜网页) | Agent 循环、工具注册、失败处理 |
| W3 | 带引用出处的文档问答 | 知识库 RAG |
| W4 | MCP + LangGraph 的工单分流 Agent | 业务工具 MCP server、主工作流 |
| W5 | 给 W4 的 Agent 加评测集和 CI 回归门禁 | 评测体系 |
| W6 | 把 Agent 部署成公网服务 | 服务化、安全、部署 |
| W7–8 | **毕业项目 SupportPilot:智能客服工单 Agent** | 全部整合 + 包装 |
| W9 | 选做第二作品:代码审查 Agent;求职 | 简历、面试 |

**SupportPilot 设定**(W4 起所有示例统一用这个虚构公司):虚构 SaaS 公司「云簿 CloudLedger」(在线记账/订阅软件)。知识库 = 帮助中心文章(产品功能、计费规则、退款政策、常见报错);业务库 = SQLite/Postgres 里的 customers / subscriptions / invoices / tickets 表;能力 = 自动分类工单 → 检索知识库 → 查询订单/账单 → 起草回复(带引用)→ 退款等敏感操作走人工审批 → 无法处理时转人工。数据全部自己造,写手可以给造数脚本。

## 2. 每篇骨架(二级标题 `##`,顺序固定,一个不能少)

frontmatter:

```yaml
---
title: 'Day N · 标题'          # 必须以 “Day N · ” 开头,与下方规划表一致
description: '一两句话,出现在目录页和 RSS。'
pubDate: 2026-10-12
regime: none
tags: ['tool-use', 'agent-loop', 'agent-60']   # 最后一个固定 'agent-60'
series: 'agent-60'
day: N
lang: 'zh'
---
```

正文章节顺序:

1. `## 今天要解决的问题` —— 学完要会什么(3–5 条可验证的目标)+ 预计用时 + 前置(依赖哪天)。
2. 正文若干节(自由命名,3–8 节):讲概念 → 看图 → 看代码 → 讲为什么。
3. `## 动手练习` —— 具体步骤 + 完整可运行代码 + **验收标准**(做到什么算过)。
4. `## 名词解释` —— 表格「名词 | 意思」。
5. `## 常见误区` —— 每条加粗一句话开头再解释。
6. `## 学习资料` —— 必须按这五个三级标题分组(某组确实没有合适的可以写「今天这组不需要」,但「文档」「视频」两组每篇必须有):
   - `### 文档与文章`(官方文档、经典博文、论文)
   - `### B 站视频`
   - `### 其他经典视频`(YouTube、DeepLearning.AI 短课、官方课程等)
   - `### 书籍`(书名、作者、出版社/年份、**读哪一章**)
   - `### 开源项目与代码`
   每条一句话说清「它有什么用、看哪部分、花多久」。
7. `## 自测` —— 5–6 题,含至少 1 道面试风格的题(标「面试题」)。答案放 `<details><summary>答案</summary>`,summary 后与 `</details>` 前各留一个空行。
8. `## 明天预告` —— 必须提到下一天的标题关键词(或写 `Day N+1`)。复习日也用「明天预告」。

复习日(Day 7/14/21/28/35/42)骨架同上,正文换成:一页知识地图 + 本周小项目完整实现 + 面试题汇总 + 错题/坑清单。

## 3. 语气、长度、代码

### 3.0 用人类的语气写(站长特别强调,优先级最高)

读起来要像一个做过这事的工程师在给朋友讲,不能一眼看出是 AI 写的。硬规则:
- 禁用词句:「总结来说」「综上所述」「值得注意的是」「需要指出的是」「让我们」「深入探讨」「至关重要」「赋能」「不仅……更……」「在当今……时代」「一站式」「无缝」「全方位」「旨在」「助力」「这不仅仅是 X,而是 Y」;段尾不要升华和金句。
- 不要三连排比、不要每段都「首先/其次/最后」、不要每个小标题都配一句加粗口号;加粗全文只给真正关键的几处。
- 少用破折号(——),一段最多一个;少用冒号引出列表。能用一句话说清就别列清单,正文以自然段为主,列表只在步骤/对比时用。
- 句子长短交错,允许口语(「说白了」「这里很容易踩坑」「我第一次就错在这」),允许有观点和取舍(「我不推荐一上来就用 LangChain,原因是……」)。
- 举例要具体:具体的报错信息、具体的数字、具体的场景,不要「某些情况下」「在实际应用中」这种空话。
- 写完通读一遍,把读起来像宣传稿或说明书的句子改成人话。

- 中文正文,术语保留英文(首次出现给中文解释)。**不要 AI 报告腔**:不用「总结来说」「值得注意的是」「让我们」「深入探讨」;不堆排比;不滥用加粗。像一个做过这件事的工程师在带朋友。
- **一次一小块**:新概念先假设读者没听过,用前面学过的东西做锚点;给类比再给精确定义。
- 长度:每篇 **5,000–8,000 纯汉字**(`[一-鿿]` 口径,不含代码),项目日和复习日可以更长;代码另算,越完整越好。
- 代码:能直接跑,标明文件路径、依赖(`uv add ...`)、环境变量;不调 API 的部分写完用 `python3 -c "import ast,sys;ast.parse(open(sys.argv[1]).read())"` 之类做语法检查(本机 python 3.10;用 3.12 新语法的代码可以只做肉眼检查)。**不能编造运行输出**:示例输出要写成「输出大致长这样」,并保证和代码逻辑一致。
- 成本:涉及花钱的地方给估算算式(token 数 × 单价),价格注明查证日期和链接。

## 4. 图、视频、链接

### 4.1 图:内联 SVG,每篇 1–3 张

- `<figure>` 包 `<svg viewBox="0 0 640 H" role="img" aria-label="…">`,下方 `<figcaption>` 中文说明。HTML 块前后留空行,`<figure>` 内部不写 markdown。
- 只用站点 token 上色:文字 `var(--ink)` / `var(--ink-soft)` / `var(--ink-faint)`,线 `var(--rule)`,底 `var(--paper-raised)`,两种强调色 `var(--mem)`+`var(--mem-wash)`(蓝,用于「模型/LLM 侧」)和 `var(--compute)`+`var(--compute-wash)`(琥珀,用于「工具/外部系统侧」)。不出现其他颜色。
- `<text>` 写 `font-family="var(--font-mono)"`,字号 11–13,文字短。图要讲机制:Agent 循环、消息结构、RAG 流水线、状态图、架构图、时序图。坐标手工摆好不重叠。
- 不热链外站图片。

### 4.2 视频:每篇 2–4 个嵌入,**B 站至少 1 个**,只嵌已验证的

B 站搜索(无需登录):

```bash
curl -s -A "Mozilla/5.0" "https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' '吴恩达 Agentic AI')" | python3 -c 'import json,sys;[print(r["bvid"],r["play"],r["duration"],r["author"],r["title"]) for r in json.load(sys.stdin)["data"]["result"][:15]]'
# 验证:code 为 0 才算通过,把返回的 title 写进 figcaption
curl -s -A "Mozilla/5.0" "https://api.bilibili.com/x/web-interface/view?bvid=BVxxxxxxxxxx" | head -c 400
```

优先选:播放量高、作者可信(原作者官方号、知名 UP、正规课程搬运带字幕)、时长合适、2024 年以后的(Agent 领域变化快,MCP/Agent 内容尽量 2025 年后)。title 里的 HTML 标签(`<em class="keyword">`)要去掉。

```html
<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BVxxxxxxxxxx&autoplay=0&high_quality=1" title="视频标题" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>UP 主 · 标题 · 看哪一段、看什么。</figcaption>
</figure>
```

YouTube:

```html
<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/VIDEO_ID" title="视频标题" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>作者 · 标题 · 看哪一段、看什么。</figcaption>
</figure>
```

```bash
curl -s "https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=VIDEO_ID&format=json"   # 有 title 才算通过
curl -s "https://www.youtube.com/results?search_query=..." | grep -o '"videoId":"[^"]*"' | sort | uniq -c | sort -rn | head   # 找 ID
```

多集合集(B 站分 P、YouTube playlist)在「学习资料」里给链接并写「看第几 P/第几集」。

### 4.3 外链与书籍

- 每个 URL 都要 `curl -s -o /dev/null -w "%{http_code}" -L -m 20 URL` 得到 2xx/3xx(对爬虫返回 403 的站注明「需浏览器打开」;能找到替代链接就换)。拿不准的不写 URL,写「按标题搜索」。
- **书籍必须真实存在**:用 WebSearch 确认书名、作者、出版年;中文版写出版社。不确定有无中译本就只写英文原版。
- 可用 WebSearch / WebFetch 查最新资料(用 ToolSearch 加载)。写 2026 年的现状,不要停留在 2024。

### 4.4 推荐的核心资料池(写手按当天主题挑,仍需逐条验证链接/ID)

- 文档:Anthropic《Building effective agents》《Effective context engineering for AI agents》《Writing effective tools for agents》、Anthropic 工具调用与提示词文档、`anthropics/courses` 仓库;OpenAI《A practical guide to building agents》、Function calling / Structured Outputs 文档、Agents SDK 文档;MCP 官方 modelcontextprotocol.io;LangGraph 文档与 LangChain Academy;Lilian Weng《LLM Powered Autonomous Agents》;Hamel Husain 关于 evals 的文章;Eugene Yan《Patterns for Building LLM-based Systems & Products》;OWASP Top 10 for LLM Applications;Simon Willison 关于 prompt injection 的文章。
- 中文开源教程:Datawhale《hello-agents》、Datawhale《llm-universe》、微软《AI Agents for Beginners》(有中文翻译)、Hugging Face Agents Course。
- 视频:Karpathy《Intro to Large Language Models》《Deep Dive into LLMs like ChatGPT》《How I use LLMs》;3Blue1Brown 深度学习系列(B 站官方中配);李宏毅 2025 机器学习课 AI Agent 相关讲;吴恩达 DeepLearning.AI 短课与《Agentic AI》课(B 站有字幕搬运);Anthropic / LangChain 官方频道的讲座。
- 书:Chip Huyen《AI Engineering》(O'Reilly, 2025);Jay Alammar & Maarten Grootendorst《Hands-On Large Language Models》;John Berryman & Albert Ziegler《Prompt Engineering for LLMs》;其余写手自行查证后补充。

## 5. 逐日规划(标题已定,不要改;内容要点是最低要求,可以扩充)

### 序章

| Day | slug | 标题 | 内容要点 |
| --- | --- | --- | --- |
| 0 | day-00-overview | Day 0 · 开学第一课:AI Agent 工程师做什么、两个月怎么学 | 岗位定义(Agent 工程师 vs 算法 vs 产品 vs 「AI 训练师」),日常工作清单,JD 关键词统计(查真实 JD),2026 年薪资区间(国内大厂/创业/新加坡/香港/海外远程,注明口径与「估计」);60 天地图(9 周、贯穿项目线、毕业项目);每天怎么用这个站(读→看视频→动手→自测);准备工作:装 uv、注册 DeepSeek 等 API、预算(整门课 API 花费估算,目标 ¥100–300 以内,给算式);诚实预期:两个月能拿到什么、拿不到什么;学习方法(每天必须写代码,不只看视频)。 |

### W1 · 地基:大模型与 API(Day 1–7)

| Day | slug | 标题 | 内容要点 |
| --- | --- | --- | --- |
| 1 | day-01-what-llm-does | Day 1 · 大模型到底在干什么:token、上下文窗口、下一个词预测 | 下一个 token 预测与自回归;tokenizer 与 BPE(中文费 token);上下文窗口;temperature/top_p 采样;预训练→指令微调→RLHF 一句话版;幻觉的来源;推理模型(thinking)是什么;只讲 Agent 工程师需要的直觉,不讲数学。 |
| 2 | day-02-python-for-backend-devs | Day 2 · 写给后端工程师的 Python 速成:uv、类型标注、async、pydantic | 用 Java/Go/JS 对照讲;uv 建项目、依赖、虚拟环境;类型标注;dataclass vs pydantic;async/await 与 asyncio.gather;httpx;dotenv 管密钥;pytest 一分钟入门。目标是够写 Agent,不是学全 Python。 |
| 3 | day-03-first-api-call | Day 3 · 第一次调用大模型 API:OpenAI 兼容协议,一份代码切换 DeepSeek/通义/Claude | 各家 API 注册与充值(国内/海外);OpenAI 兼容协议是什么、为什么成了事实标准;chat.completions 请求和响应逐字段讲;用环境变量切厂商;Anthropic Messages API 的差异;usage 字段与计费算式;错误码(401/429/500)与重试;Responses API 一句话说明。 |
| 4 | day-04-messages-and-streaming | Day 4 · messages、system prompt 与流式输出:对话状态握在你手里 | API 无状态,多轮对话靠自己拼 messages;system/user/assistant 角色;上下文越聊越长的成本问题;streaming(SSE)原理与代码;首 token 延迟;封装一个 `LLMClient` 类(后面全课复用)。 |
| 5 | day-05-prompt-engineering | Day 5 · 提示词工程:清晰指令、示例、思维链、结构化标签 | 清晰直接、给角色、few-shot、让模型先思考、XML/Markdown 分隔、预填、长文档放前面;提示词模板化与版本管理;什么时候提示词救不了你(该换工具/RAG/评测)。对照 Anthropic 与 OpenAI 的提示词指南。 |
| 6 | day-06-structured-output | Day 6 · 结构化输出:JSON mode、JSON Schema、pydantic 校验与重试 | 为什么 Agent 离不开结构化输出;JSON mode vs Structured Outputs(schema 约束);各家支持情况(查证);pydantic 定义 schema + 校验失败重试;`instructor` 库;抽取类任务实战(从工单文本抽字段)。 |
| 7 | day-07-week1-review-cli-chatbot | Day 7 · W1 复习 + 小项目:带流式输出和成本统计的命令行聊天机器人 | 一页知识地图;小项目完整代码(多轮、流式、切换厂商、每轮 token 与花费统计、对话保存);W1 面试题;坑清单。 |

### W2 · 工具调用与 Agent 循环(Day 8–14)

| Day | slug | 标题 | 内容要点 |
| --- | --- | --- | --- |
| 8 | day-08-function-calling | Day 8 · Function calling:模型怎么「调用」函数(它其实只写了一段 JSON) | tools 定义(JSON Schema);tool_calls 响应;执行后把结果作为 tool 消息回传;完整一来一回的消息时序图;并行工具调用;tool_choice;OpenAI 与 Anthropic 格式对照。 |
| 9 | day-09-agent-loop-from-scratch | Day 9 · 不用框架,100 行手写一个 Agent 循环 | while 循环:调模型→有 tool_calls 就执行→回传→直到没有工具调用;工具注册表与装饰器自动生成 schema;最大步数;日志打印每一步;这是面试最常考的手写题。 |
| 10 | day-10-react-and-planning | Day 10 · ReAct 与规划:先想再做,边做边看 | ReAct 论文思想(Thought/Action/Observation);原生 function calling 时代 ReAct 变成了什么;plan-and-execute;反思(Reflexion)一句话版;推理模型下还要不要显式规划;todo list 式规划(像 Claude Code 那样)。 |
| 11 | day-11-tool-design | Day 11 · 好工具怎么设计:命名、描述、参数、返回值和报错 | Anthropic《Writing effective tools for agents》要点;工具粒度(少而精 vs 多而碎);描述写给模型看;参数用枚举约束;返回值精简、带分页;报错信息要能指导模型自我纠正;工具数量太多怎么办。 |
| 12 | day-12-failure-modes | Day 12 · Agent 的失败模式:死循环、乱调工具、参数错误怎么治 | 失败分类表;重试与指数退避;超时;步数/预算上限;工具结果过长截断;幻觉工具名;循环检测;优雅降级与转人工;每种给代码。 |
| 13 | day-13-workflows-vs-agents | Day 13 · Workflow 还是 Agent:《Building effective agents》五种模式逐个实现 | prompt chaining、routing、parallelization、orchestrator-workers、evaluator-optimizer 各写一个最小实现;什么时候用 workflow、什么时候才需要 agent;面试必问。 |
| 14 | day-14-week2-review-cli-agent | Day 14 · W2 复习 + 小项目:能查天气、算数、读文件、搜网页的命令行 Agent | 知识地图;小项目完整代码(工具注册、循环、失败处理、成本统计,搜索用免费 API 或 DuckDuckGo 库,查证可用性);W2 面试题;坑清单。 |

### W3 · 上下文工程与 RAG(Day 15–21)

| Day | slug | 标题 | 内容要点 |
| --- | --- | --- | --- |
| 15 | day-15-embeddings | Day 15 · Embedding:把文字变成向量,余弦相似度手算一遍 | 向量与语义相似的直觉;调用 embedding API;余弦相似度手算 + numpy;维度与成本;中文 embedding 模型选择(bge-m3 等,查证);MTEB/C-MTEB 榜单怎么看。 |
| 16 | day-16-first-rag | Day 16 · 第一个 RAG:切块、向量化、检索、拼 prompt(numpy 暴力版) | RAG 为什么存在(知识更新、私有数据、减少幻觉);完整流水线图;切块策略(固定长度/按标题/重叠);numpy 实现;prompt 里怎么放检索结果并要求引用;用 CloudLedger 帮助中心数据(给造数脚本)。 |
| 17 | day-17-pgvector | Day 17 · 向量数据库:pgvector 上手、HNSW 索引与元数据过滤 | 为什么推荐 pgvector(后端友好);Docker 起 Postgres+pgvector;建表、插入、查询;HNSW vs IVFFlat;元数据过滤;与 Milvus/Qdrant/Chroma/Elasticsearch 的取舍表。 |
| 18 | day-18-retrieval-quality | Day 18 · 检索质量:混合检索、rerank、query 改写 | 纯向量检索的短板(专有名词、编号、错误码);BM25;混合检索与 RRF 融合;rerank 模型;query 改写/HyDE/多路查询;contextual retrieval(Anthropic 文章)。 |
| 19 | day-19-rag-evaluation | Day 19 · RAG 怎么评估:召回率、MRR、忠实度,建第一份检索测试集 | 检索指标(recall@k、MRR、nDCG 直觉版)与生成指标(faithfulness、answer relevance);造 30 条问答测试集;写评估脚本;RAGAS 等工具一句话;改一个参数看分数变化。 |
| 20 | day-20-context-engineering-memory | Day 20 · 上下文工程与记忆:窗口预算、压缩、长期记忆、Agentic RAG | context engineering 是什么(Anthropic 文章);上下文腐烂;token 预算分配;对话摘要压缩;短期/长期记忆;记忆写入与检索;Agentic RAG(检索作为工具由 Agent 决定)。 |
| 21 | day-21-week3-review-doc-qa | Day 21 · W3 复习 + 小项目:带引用出处的文档问答 Agent | 知识地图;小项目完整代码(导入、pgvector、混合检索、引用、评估脚本);W3 面试题;坑清单。 |

### W4 · MCP、框架与多 Agent(Day 22–28)

| Day | slug | 标题 | 内容要点 |
| --- | --- | --- | --- |
| 22 | day-22-mcp-explained | Day 22 · MCP 是什么:为什么大家都在接 MCP,协议里有什么 | 解决 M×N 集成问题;host/client/server;tools/resources/prompts;stdio 与 Streamable HTTP 传输;JSON-RPC 消息长什么样;生态现状(2026,查证);MCP 与 function calling 的关系。 |
| 23 | day-23-build-mcp-server | Day 23 · 动手写 MCP server:把 CloudLedger 业务库包成工具 | FastMCP 写 server(查客户、查订阅、查发票、创建退款申请);MCP Inspector 调试;接入 Claude Desktop / Cursor / Claude Code;自己写一个 MCP client 接到 Day 9 的循环里;鉴权与远程 server 简介。 |
| 24 | day-24-langgraph-basics | Day 24 · LangGraph 入门:状态、节点、边、条件路由 | 为什么需要图(显式控制流);State 定义;节点函数;条件边;用 LangGraph 重写 Day 9 的 Agent;预置 ReAct agent;画图可视化。 |
| 25 | day-25-langgraph-hitl | Day 25 · LangGraph 进阶:checkpoint、人工审批、流式与中断恢复 | checkpointer(内存/SQLite/Postgres);thread_id;interrupt 实现退款人工审批;时间旅行与恢复;流式模式;子图。 |
| 26 | day-26-multi-agent | Day 26 · 多 Agent:orchestrator-worker、handoff、上下文隔离,以及什么时候不该用 | 多 Agent 的真实收益(并行、上下文隔离)与代价(token 成本数倍、协调失败);Anthropic multi-agent research system 文章;supervisor 与 handoff 两种拓扑实现;Agent2Agent(A2A)协议一句话(查证现状)。 |
| 27 | day-27-frameworks-compared | Day 27 · 框架横评:LangGraph、OpenAI Agents SDK、Claude Agent SDK、LlamaIndex、Dify/Coze | 同一个小任务用 2–3 个框架各写一遍;取舍表(控制力、生态、学习成本、生产可用性);低代码平台的定位;面试里「为什么选这个框架」怎么答;什么时候不用框架。 |
| 28 | day-28-week4-review-ticket-router | Day 28 · W4 复习 + 小项目:MCP + LangGraph 的工单分流 Agent | 知识地图;小项目完整代码(工单分类→检索→调 MCP 工具→起草→退款审批);W4 面试题;坑清单。 |

### W5 · 评测与可观测(Day 29–35)

| Day | slug | 标题 | 内容要点 |
| --- | --- | --- | --- |
| 29 | day-29-why-evals | Day 29 · 为什么 Eval 是分水岭:没有评测的 Agent 只是 demo | 改了 prompt 怎么知道变好了;评测金字塔(单元断言→LLM 评分→人工);离线 vs 在线评测;招聘方为什么看重;评测驱动开发流程图。 |
| 30 | day-30-error-analysis | Day 30 · 错误分析:读 100 条 trace,给失败分类 | Hamel Husain 的方法:开放编码→归类→计数→排优先级;做一个简易标注界面(Streamlit 或 Jupyter);从失败分类推出该加什么评测。 |
| 31 | day-31-test-sets | Day 31 · 建测试集:黄金集、合成数据、边界用例 | 测试集结构(输入、期望、标签);用 LLM 按维度合成测试数据;边界与对抗用例;版本管理;测试集大小怎么定;防止测试集过拟合。 |
| 32 | day-32-llm-as-judge | Day 32 · LLM-as-judge:写评分 prompt、与人工对齐、偏差校准 | 二元判断优于 1–10 分;评分 prompt 模板;与人工标注算一致率;位置偏差、冗长偏差、自我偏好;judge 也要被评测。 |
| 33 | day-33-trajectory-eval | Day 33 · 评估 Agent 的轨迹:工具选对没、步数多不多、任务成没成 | 最终结果评测 vs 轨迹评测;工具调用准确率、参数正确率、步数与成本;模拟用户(user simulator)做多轮评测;τ-bench 等基准思想(查证)。 |
| 34 | day-34-tracing-observability | Day 34 · Tracing 与可观测:Langfuse 接入,每一步都看得见 | trace/span/generation 概念;Langfuse 自托管或云版接入 Day 28 的 Agent;看延迟、token、成本、错误;线上反馈收集;OpenTelemetry GenAI 语义约定一句话;LangSmith/Phoenix 对照。 |
| 35 | day-35-week5-review-eval-ci | Day 35 · W5 复习 + 小项目:给工单 Agent 加评测集和 CI 回归门禁 | 知识地图;小项目完整代码(50 条测试集、规则断言 + LLM judge + 轨迹检查、pytest、GitHub Actions 门禁、分数报告);W5 面试题;坑清单。 |

### W6 · 生产化(Day 36–42)

| Day | slug | 标题 | 内容要点 |
| --- | --- | --- | --- |
| 36 | day-36-agent-as-service | Day 36 · 把 Agent 做成服务:FastAPI、SSE 流式接口、会话管理 | API 设计;SSE 推送 token 与工具调用事件;会话存储(Redis/Postgres);并发与 async;前端怎么接。 |
| 37 | day-37-long-running-reliability | Day 37 · 长任务与可靠性:队列、重试、幂等、超时、断点续跑 | 任务队列(Celery/RQ/arq 选一个讲);状态持久化;工具调用幂等键;超时与取消;durable execution 概念(Temporal 一句话)。 |
| 38 | day-38-cost-and-latency | Day 38 · 成本与延迟:prompt caching、模型路由、并行、批处理 | 成本拆解算式;prompt caching 原理与各家价格(查证);大小模型路由;并行工具调用;流式降低感知延迟;语义缓存;批处理 API。 |
| 39 | day-39-prompt-injection | Day 39 · 安全(一):prompt injection 怎么打、怎么防 | 直接/间接注入;致命三要素(私有数据+不可信内容+外发能力,Simon Willison);真实案例;防御层次(隔离、权限、输出过滤、人工确认);写几条注入测试用例加进评测集。 |
| 40 | day-40-permissions-sandbox | Day 40 · 安全(二):最小权限、沙箱、人工确认与数据脱敏 | 工具权限分级;只读/写操作分离;代码执行沙箱(Docker/E2B 等,查证);PII 脱敏;审计日志;OWASP LLM Top 10 对照。 |
| 41 | day-41-deploy | Day 41 · 部署上线:Docker、密钥管理、云服务器,以及本地开源模型 | Dockerfile 与 compose(app+postgres+langfuse);密钥管理;部署到云(国内轻量云 / Render 或 Fly.io 二选一,给步骤);HTTPS;Ollama 本地跑开源模型、vLLM 速览,何时自部署。 |
| 42 | day-42-week6-review-production | Day 42 · W6 复习 + 生产化清单:把工单 Agent 部署成公网服务 | 知识地图;上线 checklist;小项目完整代码与部署步骤;W6 面试题;坑清单。 |

### W7–W8 · 毕业项目 SupportPilot(Day 43–54)

| Day | slug | 标题 | 内容要点 |
| --- | --- | --- | --- |
| 43 | day-43-capstone-kickoff | Day 43 · 毕业项目开题:为什么做 SupportPilot、需求文档与架构图 | 选题标准(贴近 JD 高频场景:客服/工单/知识库);PRD 精简版;功能清单与非目标;架构图;目录结构;里程碑(Day 43–54 排期);验收指标(评测分数、P95 延迟、单工单成本)。 |
| 44 | day-44-capstone-skeleton-data | Day 44 · 搭骨架:仓库结构、配置、造数据 | 仓库初始化(uv、ruff、pytest、pre-commit);配置管理;造 CloudLedger 帮助中心 60+ 篇文章与业务库(脚本);README 雏形。 |
| 45 | day-45-capstone-rag | Day 45 · 知识库模块:导入、切块、混合检索、引用 | 复用 W3 并产品化:增量导入、元数据、混合检索 + rerank、引用格式、检索评测基线。 |
| 46 | day-46-capstone-tools-mcp | Day 46 · 业务工具:订单/账单 MCP server 与退款审批 | 工具清单与权限分级;MCP server;退款需审批;工具单元测试。 |
| 47 | day-47-capstone-workflow | Day 47 · 主工作流:LangGraph 编排分类、检索、执行、起草、自检 | 状态设计;节点实现;路由;自检(evaluator)节点;转人工条件;端到端跑通 10 张工单。 |
| 48 | day-48-capstone-memory | Day 48 · 多轮与记忆:会话状态、客户画像、上下文压缩 | 会话持久化;客户历史工单摘要;上下文预算;多轮追问测试。 |
| 49 | day-49-capstone-ui | Day 49 · 界面与流式体验:Streamlit 前端、展示工具调用与审批 | FastAPI 后端 + Streamlit 前端;流式显示;工具调用卡片;客服审批面板;演示数据。 |
| 50 | day-50-capstone-eval | Day 50 · 评测体系:100 条测试集、LLM-judge、轨迹评测,跑出第一份分数 | 测试集构成;三层评测;报告格式;基线分数记录表(留空让学员填)。 |
| 51 | day-51-capstone-iterate | Day 51 · 迭代:按错误分析改 prompt、工具和检索,把分数提上去 | 错误分析→假设→改动→回归的循环;改动日志模板;常见提分手段清单;避免对测试集过拟合。 |
| 52 | day-52-capstone-observability-cost | Day 52 · 可观测与成本:接 Langfuse、算单工单成本、缓存与模型路由 | 接 tracing;成本看板;prompt caching;小模型做分类大模型做起草;优化前后对比表(留空)。 |
| 53 | day-53-capstone-security-deploy | Day 53 · 安全加固与上线:注入测试、权限、Docker 部署 | 注入测试集;权限审计;compose 部署;公网 demo 的防滥用(限流、额度、演示账号)。 |
| 54 | day-54-capstone-packaging | Day 54 · 作品包装:README、架构图、演示视频、技术博客 | 招聘方 5 分钟看什么;README 模板;录 2–3 分钟演示视频脚本;技术博客大纲(踩坑+数据);GitHub 主页整理。 |

### W9 · 第二作品与求职(Day 55–60)

| Day | slug | 标题 | 内容要点 |
| --- | --- | --- | --- |
| 55 | day-55-second-project-code-review-agent | Day 55 · 选做第二作品:一天做出代码审查 Agent | GitHub PR/GitLab MR 审查机器人 MVP:拿 diff→分块→审查→发评论;工具设计;评测怎么做;和 Coding Agent(Claude Code、Codex 等)的关系;作为第二作品的价值。 |
| 56 | day-56-resume | Day 56 · 简历:AI Agent 岗的简历怎么写 | JD 关键词对照;项目经历写法(问题→方案→数据);把原来的工作经历往 AI 方向改写(诚实,不造假);模板;中英文版;GitHub/博客链接放法。 |
| 57 | day-57-interview-fundamentals | Day 57 · 面试(一):高频基础题 60 道 | 分 LLM 基础、提示词、工具调用、RAG、Agent 架构、MCP、评测、安全、工程化;每题给答题要点(折叠答案)。 |
| 58 | day-58-interview-system-design | Day 58 · 面试(二):系统设计题——设计企业客服 Agent 与 Deep Research Agent | 系统设计答题框架(需求→指标→架构→数据→评测→风险→成本);两道题完整示范;追问清单;手写 Agent 循环的现场编码题。 |
| 59 | day-59-job-search-salary | Day 59 · 求职渠道与薪资:国内、新加坡、海外远程,怎么找、怎么谈 | 渠道(Boss/猎聘/脉脉/LinkedIn/远程岗网站,查证);2026 薪资区间(给口径与出处,标估计);面试流程;谈薪技巧;offer 比较;避坑(假 AI 岗、外包、培训贷)。 |
| 60 | day-60-graduation | Day 60 · 结业:60 天回顾、能力自检清单、接下来怎么进阶 | 能力自检表(对照 JD 打勾);作品清单;没达标怎么补;后续 3 个月进阶方向(深入评测、语音 Agent、Computer Use/浏览器 Agent、微调入门、开源贡献);保持更新的信息源。 |

## 6. 完成后自检(每篇)

- [ ] frontmatter 齐全,`day`、`title` 与规划表一致,`pubDate: 2026-10-12`,tags 最后一个 `agent-60`。
- [ ] 8 个骨架章节齐全、顺序对;「学习资料」五个三级标题齐全;明天预告提到下一天。
- [ ] 1–3 张 SVG;2–4 个视频嵌入且 B 站至少 1 个,全部 API 验证过,figcaption 写验证到的标题。
- [ ] 所有 URL curl 通过;书籍查证过;模型名/价格写了查证日期。
- [ ] 纯汉字 ≥ 5,000(`python3 -c "import re,sys;print(len(re.findall(r'[一-鿿]',open(sys.argv[1]).read())))" FILE`)。
- [ ] `<details>` 内前后空行;HTML 块前后空行。
- [ ] 不要跑 `npm run build`(主会话统一构建),不要 git commit。
