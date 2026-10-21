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

### 3.1 逐行解释:挂在代码块上,悬停弹出

完整代码块的逐行讲解不要另起一大段往下堆,写成紧跟在代码块后面的注释列表,读者把鼠标悬停在某一行上(手机上点一下),解释就会在这一行下面弹出来:

````markdown
```python
DB_PATH = Path(os.environ.get(...))
...
```

<div class="line-notes">

- `DB_PATH = Path(` 从里往外读……代入真实值……
- `with db() as conn:` 第二次出现的那一行也能单独解释

</div>
````

- 每条开头的 inline code 是 key,会**按顺序**去匹配上面代码块里第一个包含它的行(从上一条匹配到的位置往后找),所以重复出现的行可以一处写一条。key 取那一行里有辨识度的一小段就行。
- 代码块的 ``` 和 `<div class="line-notes">` 之间空一行,div 内首尾也各空一行,否则 markdown 不渲染。
- 正文支持 inline code、加粗、`<br>` 换行。按「逐行讲+代入真实数据」写,数据要实跑得来。
- 「展开全部解释」会把每条解释插到对应行下面(代码块内部),提示条吸顶方便收起。
- `python3 scripts/check-course.py` 会检查每个 key 都能在代码块里按顺序找到;浏览器控制台里 `[line-notes]` 开头的警告也表示有 key 没挂上。没有 JS 时注释列表会直接显示在代码块下面。
- 实现在 `src/scripts/line-notes.ts`,样式在 `global.css` 的 Line notes 段。

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


## 5B. 进阶篇:资深 Agent 工程师(Day 61–110)

**定位**:接在 Day 60 之后,目标是资深 / Staff 级别(国内 JD 年包 P75 68 万以上那一档、海外 Senior/Staff)。读者已经学完 Day 0–60、做完 SupportPilot。进阶篇不再手把手教语法和 API,重点是**判断力、规模、深度和影响力**:为什么这样设计、在 10 倍流量和 10 个团队下还成不成立、怎么用数据说服别人、怎么带人。每篇仍用同一骨架(第 2 节),「动手练习」可以是设计题、实验、读源码、写设计文档,不一定是写代码;复习日(Day 67/74/81/88/95/110)同基础篇。

**资深的标准**(每篇都要往这几条上靠):能在不确定里做取舍并写清楚理由;能设计评测证明自己是对的;能估算成本、延迟、风险;能把系统做成别人能复用的平台;能读论文和源码自己找答案;能写设计文档、能面对 Staff 级系统设计面试。

**贯穿项目**:进阶毕业项目 **AgentOps 平台**(仓库 `agentops/`):把 SupportPilot 升级成一个多租户 Agent 平台:统一模型网关(路由、限流、配额、成本归因)、MCP 网关(工具注册、OAuth 鉴权、权限审计)、持久化执行(长任务、断点续跑)、评测平台(离线回归 + 线上 A/B)、可观测(OTel 全链路 + 成本看板),再加一个用 SupportPilot 的数据微调出来的小模型做分类路由。W10–W14 每周的练习都为它准备零件。

### W10 · Agent 架构深水区(Day 61–67)

| Day | slug | 标题 | 内容要点 |
| --- | --- | --- | --- |
| 61 | day-61-senior-overview | Day 61 · 进阶开学:资深 Agent 工程师和中级差在哪 | 用 JD 数据(5–10 年中位 54 万、P75 68 万、15% ≥ 80 万;海外 Staff 8 年以上)讲资深岗位要什么;中级 vs 资深能力对照表;进阶 50 天地图;AgentOps 平台项目介绍;学习方式变化(读论文、读源码、写设计文档)。 |
| 62 | day-62-harness-design | Day 62 · Agent Harness 设计:把循环做成可复用的运行时 | harness 的组成(循环、工具层、上下文管理、权限、钩子、子 Agent、状态持久化);读 Claude Agent SDK / OpenAI Agents SDK / LangGraph 的运行时设计(查当前源码);自己设计一个 harness 接口;扩展点和约束。 |
| 63 | day-63-context-at-scale | Day 63 · 上下文工程进阶:长任务里的压缩、外部记忆和缓存命中 | 上下文腐烂实证与评测;分层压缩策略;笔记文件/外部记忆(scratchpad、todo、NOTES.md 模式);prompt caching 友好的上下文布局(前缀稳定);工具结果分页与引用;实验:同任务不同策略的成功率与成本对比设计。 |
| 64 | day-64-memory-systems | Day 64 · 记忆系统:短期、长期、情景、语义,怎么写、怎么忘 | 记忆分类;写入策略(何时写、写什么、谁来写);检索与冲突;遗忘与过期;隐私和用户可控;对比 mem0、Letta(MemGPT)、LangGraph store 等(查证现状);设计 SupportPilot 的客户记忆。 |
| 65 | day-65-durable-execution | Day 65 · 持久化执行:跑几小时的 Agent 怎么不怕重启 | durable execution 概念;Temporal / Restate / LangGraph checkpoint / DBOS 对比(查证);幂等、补偿(saga)、人工步骤;Agent 步骤的确定性与重放问题;实现一个能断点续跑的长任务。 |
| 66 | day-66-orchestration-patterns | Day 66 · 编排模式的取舍:单 Agent、工作流、多 Agent、混合 | 用评测数据比较几种架构;Anthropic 多 Agent 研究系统、Cognition「Don't build multi-agents」两种观点对照;任务分解粒度;共享状态 vs 消息传递;失败隔离;给出决策树。 |
| 67 | day-67-w10-review | Day 67 · W10 复习:写一份 Agent 运行时的设计文档 | 知识地图;按设计文档模板(背景、目标/非目标、方案、取舍、风险、评测计划)写 AgentOps 运行时设计;资深面试题;坑清单。 |

### W11 · 评测科学(Day 68–74)

| Day | slug | 标题 | 内容要点 |
| --- | --- | --- | --- |
| 68 | day-68-eval-as-product | Day 68 · 评测是产品:评测体系的组织、流程和所有权 | 评测在团队里的位置;谁写用例、谁维护、怎么评审;评测与 PRD 绑定;eval-driven development 在多人团队里怎么落地;评测平台需求。 |
| 69 | day-69-statistics-for-evals | Day 69 · 评测里的统计学:样本量、置信区间、显著性 | 为什么 50 条用例上 2 个点的提升不算数;二项分布置信区间;配对比较(McNemar);bootstrap;多次采样与方差;最小可检测差异;Python 实现。 |
| 70 | day-70-judge-at-scale | Day 70 · 大规模 LLM 评审:校准、一致性、成本 | judge 与人工一致率(Cohen's kappa);偏差测量与纠正;多 judge 投票;judge 版本管理;成本控制(抽样、小模型 judge);judge 漂移监控。 |
| 71 | day-71-online-eval-ab | Day 71 · 线上评测:A/B 实验、灰度、隐式反馈 | 离线分数和线上指标脱节的原因;A/B 实验设计(分流单位、护栏指标、实验时长);灰度与回滚;隐式反馈(转人工率、重问率、采纳率);实验平台最小实现。 |
| 72 | day-72-red-teaming | Day 72 · 自动化红队:用 Agent 攻击 Agent | 攻击分类(注入、越权、数据外泄、拒绝服务、有害输出);自动化红队工具(查证:promptfoo、garak、PyRIT 等);攻击用例生成;把红队结果纳入回归;安全评测指标。 |
| 73 | day-73-benchmark-design | Day 73 · 设计自己的 benchmark:从 τ-bench、SWE-bench 学方法 | 公开 benchmark 怎么构造(环境、任务、判定、污染防护);τ-bench 的用户模拟与 pass^k;SWE-bench Verified 的人工筛选;给 SupportPilot 设计一个可复现的 benchmark。 |
| 74 | day-74-w11-review | Day 74 · W11 复习:给 AgentOps 设计评测平台 | 知识地图;评测平台设计文档;统计检验脚本整合;资深面试题(「怎么证明你的改动有效」);坑清单。 |

### W12 · 模型层:自部署、微调与强化学习(Day 75–81)

| Day | slug | 标题 | 内容要点 |
| --- | --- | --- | --- |
| 75 | day-75-model-selection | Day 75 · 选模型是工程决策:闭源、开源、大小模型怎么搭 | 选型维度(能力、工具调用可靠性、延迟、价格、数据合规、可控性);用自己的评测集选型而不是看榜;多模型路由策略;开源模型现状(2026,查证:Qwen、DeepSeek、Llama、GLM 等);总拥有成本算式。 |
| 76 | day-76-self-hosting | Day 76 · 自部署推理:vLLM / SGLang 上线一个开源模型 | 什么时候值得自部署(成本拐点算式、合规);vLLM/SGLang 部署与 OpenAI 兼容接口;KV cache、批处理、吞吐和延迟直觉(不深入 CUDA);量化(AWQ/GPTQ/FP8)对效果和成本的影响;云 GPU 价格(查证);压测方法。 |
| 77 | day-77-fine-tuning-lora | Day 77 · 微调入门:什么时候该微调,LoRA SFT 跑一遍 | 提示词 vs RAG vs 微调的决策;数据准备(从 SupportPilot trace 造训练集);LoRA/QLoRA 原理直觉;用 Unsloth / TRL / LLaMA-Factory 跑一次 SFT(查证当前用法,给 Colab/云 GPU 方案);评测微调效果。 |
| 78 | day-78-preference-tuning | Day 78 · 偏好优化:DPO 让模型学会「更好的回答」 | RLHF/DPO/ORPO/KTO 直觉对比;偏好数据从哪来(人工标注、judge、线上反馈);DPO 实操;过拟合与能力退化检查。 |
| 79 | day-79-distillation-routing | Day 79 · 蒸馏与路由:让小模型接住八成流量 | 用大模型输出蒸馏小模型;分类/路由小模型;置信度与回退大模型;成本与质量的帕累托曲线;实验设计。 |
| 80 | day-80-rl-for-agents | Day 80 · 强化学习与 Agent:RLVR、GRPO 和工具使用训练 | 为什么 2025 年后推理模型和 Agent 能力靠 RL 提升;可验证奖励(RLVR);GRPO 直觉;Agent 环境与奖励设计;开源框架现状(查证:verl、OpenRLHF、TRL 等);一个最小可跑的 GRPO 玩具实验;这块对应用工程师的意义边界。 |
| 81 | day-81-w12-review | Day 81 · W12 复习:给 AgentOps 训练一个路由小模型 | 知识地图;完整流程:数据 → LoRA → 评测 → 部署 → 路由;成本对比表(留空);资深面试题;坑清单。 |

### W13 · 平台化与规模(Day 82–88)

| Day | slug | 标题 | 内容要点 |
| --- | --- | --- | --- |
| 82 | day-82-platform-architecture | Day 82 · 从一个 Agent 到一个平台:多租户 Agent 平台架构 | 平台化的动机(N 个团队重复造轮子);多租户隔离(数据、配额、密钥、模型);控制面与数据面;平台 API 设计;架构图;和 Dify/Coze 这类平台的差异。 |
| 83 | day-83-model-gateway | Day 83 · 模型网关:路由、限流、配额、降级、成本归因 | 网关职责;LiteLLM / Portkey / 自研对比(查证);多供应商故障切换;令牌桶限流;租户配额;成本按租户/功能归因;缓存层;实现一个最小网关。 |
| 84 | day-84-mcp-gateway-auth | Day 84 · MCP 网关与鉴权:OAuth、工具注册、权限审计 | 远程 MCP 的 OAuth 2.1 流程(查证当前规范);工具注册中心;按租户/用户授权;审计日志;MCP 安全风险(工具投毒、rug pull、混淆代理);企业内 MCP 治理。 |
| 85 | day-85-observability-at-scale | Day 85 · 规模化可观测:OTel 全链路、采样、成本看板、告警 | 高流量下 trace 采样策略;GenAI 语义约定落地;指标体系(成功率、转人工率、P95、单任务成本);告警设计;日志里的隐私;看板示例。 |
| 86 | day-86-governance-compliance | Day 86 · 治理与合规:数据驻留、PII、审计、模型备案 | 企业客户问的安全问卷;数据驻留与跨境(国内《生成式人工智能服务管理暂行办法》与备案,查证当前要求);PII 处理;审计与留存;EU AI Act 一句话(查证);对技术方案的影响。 |
| 87 | day-87-incident-response | Day 87 · Agent 事故复盘:线上出事了怎么查、怎么防 | Agent 事故类型(批量错误回复、越权操作、成本暴涨、注入攻击);on-call 手册;用 trace 定位根因;复盘模板(无责复盘);防再发机制(评测用例、护栏、熔断)。 |
| 88 | day-88-w13-review | Day 88 · W13 复习:AgentOps 平台架构评审 | 知识地图;完整平台设计文档 + 架构评审清单;资深面试题;坑清单。 |

### W14 · 前沿形态(Day 89–95)

| Day | slug | 标题 | 内容要点 |
| --- | --- | --- | --- |
| 89 | day-89-coding-agents-internals | Day 89 · Coding Agent 内部:读 SWE-agent / OpenHands / Codex 的设计 | 代码 Agent 的工具集(编辑、搜索、执行、测试);ACI(agent-computer interface)设计;仓库上下文检索;沙箱;评测(SWE-bench);读一个开源实现的关键代码(查证当前仓库)。 |
| 90 | day-90-computer-browser-use | Day 90 · Computer Use 与 Browser Agent:让 Agent 用图形界面 | 截图坐标 vs DOM/可访问性树;各家 computer use 能力现状(查证);Playwright/browser-use 实现;可靠性和安全问题;适用和不适用的场景。 |
| 91 | day-91-voice-agents | Day 91 · 语音 Agent:实时对话的延迟预算 | 级联(ASR→LLM→TTS)vs 端到端实时模型;延迟预算拆解;打断与轮次检测;LiveKit/Pipecat 等框架(查证);国内方案;电话客服场景。 |
| 92 | day-92-deep-research-agents | Day 92 · Deep Research Agent:长链路检索、规划和写作 | 架构(规划、并行搜索、阅读、综合、引用);开源实现对照(查证);质量评测(事实性、覆盖度、引用准确);成本控制。 |
| 93 | day-93-agent-protocols | Day 93 · Agent 互联:A2A、MCP 与 Agent 间协作的协议之争 | A2A 协议现状(查证);与 MCP 的分工;Agent 身份与授权;跨组织 Agent 协作的信任问题;判断哪些会成为标准。 |
| 94 | day-94-agent-product-ux | Day 94 · Agent 的产品与交互:人在回路里的体验设计 | 自主程度分级;透明度(展示计划、步骤、引用);可中断、可撤销;信任建立;失败时的体验;和 PM、设计师协作。 |
| 95 | day-95-w14-review | Day 95 · W14 复习:前沿技术选型报告 | 知识地图;写一份「我们团队明年该不该做 X」的技术选型报告模板;资深面试题;坑清单。 |

### W15–W16 · 进阶毕业项目 AgentOps 平台(Day 96–105)

| Day | slug | 标题 | 内容要点 |
| --- | --- | --- | --- |
| 96 | day-96-agentops-kickoff | Day 96 · AgentOps 开题:设计文档、里程碑、验收指标 | 完整设计文档;从 SupportPilot 迁移的范围;仓库结构;里程碑;验收指标(多租户隔离测试、网关 P95、评测平台可用、成本归因准确)。 |
| 97 | day-97-agentops-gateway | Day 97 · AgentOps(一):模型网关与多租户 | 实现网关:路由、限流、配额、故障切换、成本归因;租户模型;测试。 |
| 98 | day-98-agentops-mcp-hub | Day 98 · AgentOps(二):MCP 工具中心与鉴权 | 工具注册、OAuth、按租户授权、审计日志;把 SupportPilot 的工具迁进来。 |
| 99 | day-99-agentops-runtime | Day 99 · AgentOps(三):持久化运行时与长任务 | harness + durable execution;任务队列;断点续跑;人工步骤。 |
| 100 | day-100-agentops-eval-platform | Day 100 · AgentOps(四):评测平台与线上实验 | 离线回归、统计检验、judge 校准、A/B 分流、报告页。 |
| 101 | day-101-agentops-router-model | Day 101 · AgentOps(五):接入微调小模型做路由 | 把 Day 81 的小模型部署进网关;置信度回退;成本质量对比。 |
| 102 | day-102-agentops-observability | Day 102 · AgentOps(六):全链路可观测与成本看板 | OTel、采样、看板、告警。 |
| 103 | day-103-agentops-security | Day 103 · AgentOps(七):安全加固与红队回归 | 自动化红队接入 CI;权限与审计核查;事故演练。 |
| 104 | day-104-agentops-load-test | Day 104 · AgentOps(八):压测、容量规划与上线 | 压测方法与工具;容量估算;部署(K8s 或 compose,给两种);上线清单。 |
| 105 | day-105-agentops-showcase | Day 105 · AgentOps(九):包装成资深级作品 | 设计文档、架构决策记录(ADR)、评测报告、成本分析、演示视频、技术博客;招聘方怎么看资深作品。 |

### W17 · 资深求职与影响力(Day 106–110)

| Day | slug | 标题 | 内容要点 |
| --- | --- | --- | --- |
| 106 | day-106-design-docs-adr | Day 106 · 写设计文档和 ADR:资深工程师的主要产出 | 设计文档结构与范例;ADR;怎么写取舍;评审时怎么应对质疑;用 AgentOps 的文档做示范。 |
| 107 | day-107-staff-system-design | Day 107 · Staff 级系统设计面试:三道真题完整示范 | 题目(设计企业级 Agent 平台、设计十万并发客服 Agent、设计代码 Agent 的评测体系);资深答题框架(从业务目标、约束、规模出发,讲取舍和演进);追问清单。 |
| 108 | day-108-lead-and-influence | Day 108 · 带人和推动:技术方案怎么说服老板和其他团队 | 用 ROI 和评测数据说话;写给管理层的一页纸;带新人做 Agent 项目;跨团队平台推广;处理「AI 不靠谱」的质疑。 |
| 109 | day-109-open-source-brand | Day 109 · 开源与技术影响力:贡献、写作、演讲 | 给 Agent 框架/MCP 生态提 PR 的路径;写技术博客;分享与演讲;GitHub 作品集;影响力对资深面试和远程岗的作用(引用 JD 数据)。 |
| 110 | day-110-senior-graduation | Day 110 · 进阶结业:资深自检清单、谈薪和下一步 | 资深能力自检表;资深岗位渠道与谈薪(国内 P75/80 万+ 档、新加坡、海外远程的现实限制,用 docs/jd-research 数据);保持前沿的信息源;之后的方向(专精某领域、转 AI 平台/infra、做产品)。 |

**进阶篇的写作要求补充**:
- 读者已有基础,可以省略基础解释,但新名词仍要首次解释。
- 多引用一手资料:论文(arXiv,给链接并验证)、官方工程博客、开源仓库源码(给到具体文件路径)。
- 「动手练习」允许是设计文档、实验报告、源码阅读笔记;每篇都要有明确的产出物和验收标准。
- 每篇至少一道「资深面试题」(标「资深面试题」),答案要体现取舍和规模思维。
- 需要 GPU 的实验(微调、自部署、RL)给 Colab 免费方案和云 GPU 方案两条路,价格查证;不能编造训练结果,结果表留空。
- Day 60 的「明天预告」改为预告 Day 61 进阶篇。

## 5C. 作品篇:两个能放进作品集的复杂项目(Day 111–130)

**定位**:学完进阶篇以后,做两个「只有你做得出来、招聘方能在线点开试用」的作品,挂在网站上当作品集。读者水平同进阶篇,骨架同第 2 节(8 节、学习资料五组、自测含「资深面试题」)。每篇以**写代码**为主,代码要完整可跑,篇幅可以比进阶篇长;**不编造运行结果、性能数字和评测分数**,需要实测的写成「输出大致长这样」或留空表让读者回填。pubDate 统一 `2026-10-15`。

**两个作品各自独立成仓库**,但作品二的 trace 可以导入作品一查看(第 129 天打通)。

### 作品一:Agent Loupe · Agent 运行记录调试器(Day 111–120)

一句话:一个网页工具,导入 Agent 的运行记录(trace),按时间轴回放每一步,两次运行逐步对比,从任意一步改参数重跑,把失败步骤一键存成评测用例。对标/参照:Langfuse、LangSmith、Arize Phoenix、OpenAI Traces 面板(写之前查证当前功能,只写查到的)。卖点是**前端工程能力 + 对 Agent 内部的理解**,适合有前端背景的读者。

**统一技术规格(所有写手必须遵守,保证 10 天代码能拼起来)**:
- 仓库 `agent-loupe/`,monorepo:`server/`(Python 3.12 + uv + FastAPI + SQLite,单文件库 `loupe.db`)、`web/`(React 18 + TypeScript + Vite,包管理 pnpm;状态用 Zustand;虚拟列表用 `@tanstack/react-virtual`;图表手写 SVG 或 `d3-scale`,不用重型图表库)、`samples/`(样例 trace JSON)、`docs/`。
- **内部统一数据模型**(Day 112 定义,后面不许改名):`Run { id, name, started_at, ended_at, status: 'ok'|'error', model, total_input_tokens, total_output_tokens, total_cost_usd, tags: string[], parent_run_id?: string /* 重跑时指向原 run */, forked_from_step?: number }`;`Step { run_id, idx, parent_idx?: number, kind: 'llm'|'tool'|'agent'|'retrieval'|'other', name, started_at, ended_at, input: json, output: json, error?: string, input_tokens?, output_tokens?, cost_usd?, model? }`。LLM 步的 `input` 存完整 messages + tools,`output` 存 assistant message(含 tool_calls、reasoning_content)。
- 导入器(Day 112):① OTLP JSON(OpenTelemetry GenAI 语义约定 `gen_ai.*` 属性,查证当前约定版本)② Langfuse 导出 JSON ③ 自带的轻量 SDK `loupe_sdk.py`(装饰器 `@trace_step` + `with loupe.run():`,写本地 JSONL)。样例数据用 Day 9 的 agent_loop / SupportPilot 跑出来。
- 后端 API(Day 113):`POST /api/import`、`GET /api/runs?tag=&status=&q=&cursor=`、`GET /api/runs/{id}`、`GET /api/runs/{id}/steps?from=&limit=`、`GET /api/diff?a=&b=`、`POST /api/runs/{id}/replay`、`POST /api/eval-cases`。分页用游标。
- 前端页面:运行列表 → 运行详情(左:步骤树/瀑布时间轴;右:步骤详情面板;上:token/成本/上下文占用条)→ 对比页 → 评测用例页。
- 重跑(Day 117):录制-回放(cassette)机制:原 run 的工具结果按 `(tool_name, canonical_args_hash)` 存档,重跑时工具默认走回放,可勾选「真实执行」;LLM 调用走 `LLM_BASE_URL` 等环境变量(全课统一);新 run 的 `parent_run_id`/`forked_from_step` 记来源。
- 对比算法(Day 116):步骤签名 = `kind + name + 规范化参数摘要`,用 LCS/编辑距离对齐两条序列,标出 same/changed/added/removed;文本用 `diff-match-patch` 或 `jsdiff` 做逐词 diff。
- 公开演示(Day 119):只读演示模式(预置脱敏样例)、重跑接口加限流 + 每日花费上限(环境变量 `DAILY_BUDGET_USD`)、前端部署 Cloudflare Pages、后端部署一台小云服务器或 Fly.io/Render(给两种);性能指标(1 万步 trace 的首屏时间、滚动帧率)写测量方法,数字留空回填。

| Day | slug | 标题 | 内容要点 |
| --- | --- | --- | --- |
| 111 | day-111-loupe-kickoff | Day 111 · 作品一开题:Agent Loupe,一个给 Agent 用的调试器 | 为什么做调试器(调 Agent 最痛的是看不清每一步);竞品调研(查证 Langfuse/LangSmith/Phoenix/OpenAI Traces 现有功能,找它们没做好的点:逐步对比、从中间重跑、上下文占用可视化);PRD(用户故事、功能清单、非目标);架构图;仓库结构;10 天里程碑;验收指标;招聘方会怎么看这个项目。 |
| 112 | day-112-loupe-trace-model | Day 112 · Agent Loupe(一):trace 数据模型与三种导入器 | OTel GenAI 语义约定(查证);统一 Run/Step 模型;OTLP JSON、Langfuse 导出、自研轻量 SDK 三个导入器;用 Day 9 agent_loop 产生样例 trace;导入器的单元测试。 |
| 113 | day-113-loupe-server | Day 113 · Agent Loupe(二):FastAPI 存储与查询接口 | SQLite 表设计与索引;导入接口;列表筛选与游标分页;大 trace 的分段加载;成本计算(价格表配置);pytest 覆盖。 |
| 114 | day-114-loupe-timeline | Day 114 · Agent Loupe(三):React 时间轴与一万步的渲染性能 | Vite+React+TS 起项目;运行列表页;步骤树 + 瀑布时间轴(SVG,时间比例尺);虚拟滚动;一万步样例的性能测量方法(Performance 面板、长任务、帧率),数字留空回填;键盘导航。 |
| 115 | day-115-loupe-step-inspector | Day 115 · Agent Loupe(四):步骤详情、token 成本与上下文占用 | messages/tool_calls/reasoning 的渲染(长文本折叠、JSON 树);每步上下文构成堆叠条(system/历史/工具结果/本轮各占多少 token,怎么估算);成本火焰图;找出「哪一步把上下文撑爆了」。 |
| 116 | day-116-loupe-diff | Day 116 · Agent Loupe(五):两次运行逐步对比 | 为什么要对比(改了提示词以后从哪一步开始不一样);步骤签名与规范化;LCS 对齐实现与测试;并排视图与逐词 diff;指标对比(步数、token、成本、耗时、成败)。 |
| 117 | day-117-loupe-replay | Day 117 · Agent Loupe(六):从任意一步改参数重跑 | 录制-回放(cassette)机制;重建第 N 步的 messages;改系统提示词/模型/temperature 后 fork;工具真实执行 vs 回放的取舍与安全;非确定性(同样输入不同输出)怎么在界面上讲清楚;重跑结果自动进入对比页。 |
| 118 | day-118-loupe-eval-bridge | Day 118 · Agent Loupe(七):把失败步骤变成评测用例 | 一键存为评测用例(输入快照 + 期望/断言);用例导出成 Day 35 的评测集格式;批量重跑用例并看通过率;回归对比看板。 |
| 119 | day-119-loupe-deploy | Day 119 · Agent Loupe(八):公开演示、脱敏、限流与部署 | 只读演示模式;样例脱敏;重跑限流与每日花费上限;CORS 与鉴权;Cloudflare Pages + 后端部署(两种方案);上线检查清单;性能测量回填表。 |
| 120 | day-120-loupe-showcase | Day 120 · Agent Loupe(九):开源发布与作品包装 | README(动图、快速开始、架构)、ADR 两三篇、性能与可用性数据、2 分钟演示视频脚本、网站案例页模板;开源发布(License、贡献指南、npm/PyPI 可选);面试里怎么讲这个项目(问题→设计取舍→数据)。 |

### 作品二:BillSleuth · 计费争议调查 Agent(Day 121–130)

一句话:客户问「为什么这个月多扣了钱」,Agent 自己查订阅、发票、付款和税,复算金额,找出原因(按天折算错、重复扣款、税码过期、优惠券叠加错、升降级时间错、跨时区月末……),给出带证据的解释,需要冲正时起草贷记单并走人工审批。卖点是 **FDE 式的业务落地能力 + 多步推理的可靠性 + 严格评测**。**全部数据虚构**(虚构公司沿用「云簿 CloudLedger」),不引用任何真实公司代码或客户数据。

**统一技术规格**:
- 仓库 `billsleuth/`:Python 3.12 + uv;金额一律 `decimal.Decimal`,两位小数 `ROUND_HALF_UP`,禁止 float;数据库 SQLite(`billing.db`)。
- 计费领域模型(Day 122 定义,后面不许改名):`customers(id, name, country, currency, tax_region)`、`plans(id, name, interval: month|year, unit_price)`、`subscriptions(id, customer_id, plan_id, quantity, status, start_date, current_period_start, current_period_end, billing_anchor_day)`、`subscription_events(id, subscription_id, type: create|upgrade|downgrade|quantity_change|cancel|pause|resume, effective_at, payload_json)`、`coupons(id, kind: percent|amount, value, duration_months)`、`invoices(id, customer_id, subscription_id, period_start, period_end, issued_at, status, subtotal, discount, tax, total, currency)`、`invoice_lines(id, invoice_id, kind: recurring|proration|discount|tax|adjustment, description, quantity, unit_amount, amount, period_start, period_end, tax_code)`、`payments(id, invoice_id, amount, status, attempted_at, gateway_ref)`、`credit_notes(id, invoice_id, amount, reason, status: draft|approved|issued)`、`tax_rates(code, region, rate, valid_from, valid_to)`。
- **参考计费引擎** `engine.py`(Day 122):给定订阅和事件,按「按天折算、计费锚点日、优惠券、税率生效区间」算出**应收**发票;造数脚本先用引擎生成正确数据,再按 12 类故障模式注入错误,每个场景存 ground truth(`scenarios/*.json`:客户问题原文、根因类别、涉及发票、正确差额、期望动作)。
- 工具层(Day 123):MCP server(FastMCP),只读工具 `get_customer`、`list_invoices`、`get_invoice`(含行项目)、`list_payments`、`get_subscription_timeline`、`get_tax_rate`;计算工具 `recompute_invoice(invoice_id)` 调参考引擎返回逐行对比;写工具只有 `draft_credit_note`(只生成草稿)。每次工具调用写审计日志。
- Agent(Day 124):LangGraph 状态机:理解问题 → 定位相关发票 → 取证 → 复算 → 提出假设并验证 → 结论;状态里维护「证据链」`Evidence { claim, source_tool, source_ref, value }`,结论里的每个数字必须能追溯到某条证据(Day 125 做校验器:正则抽出回答中的金额,逐个在证据里找,找不到就打回重写)。
- 审批(Day 126):贷记单草稿 → 人工审批(CLI 和 Web 两种)→ 签发;幂等键;拒绝后的补偿。
- 评测(Day 127):100 个场景(12 类根因 + 20% 无错误的「客户误解」场景,Agent 应该解释清楚而不是乱冲正);用模拟用户(τ-bench 风格,LLM 扮演客户、会追问);指标 = 根因准确率、差额精确匹配率、数字幻觉率、误冲正率、pass^k、单场景成本与耗时;结果表留空回填。
- 演示(Day 129):Web 界面(复用作品一的前端风格,FastAPI + SSE 实时展示调查步骤和证据链);trace 导出成作品一能导入的格式;限流与花费上限;部署同作品一。

| Day | slug | 标题 | 内容要点 |
| --- | --- | --- | --- |
| 121 | day-121-billsleuth-kickoff | Day 121 · 作品二开题:BillSleuth,一个会查账的 Agent | 为什么选计费争议(FDE 日常、出错代价高、可严格评测);订阅计费入门(计费周期、锚点日、按天折算、升降级、优惠券、税、贷记单、催缴);常见争议类型;PRD 与非目标(不碰真实支付);架构图;10 天里程碑;验收指标。 |
| 122 | day-122-billsleuth-engine-data | Day 122 · BillSleuth(一):计费参考引擎与 12 类故障造数 | 领域模型与建表;Decimal 规则;参考引擎实现(按天折算、锚点、优惠券、税率区间)与单元测试;12 类故障模式的注入函数;场景 ground truth 格式;造 100 个场景的脚本。 |
| 123 | day-123-billsleuth-tools | Day 123 · BillSleuth(二):MCP 工具层、复算工具与审计日志 | 工具设计(粒度、返回结构、分页、错误信息写给模型看);只读与写工具分离;`recompute_invoice` 逐行对比;审计日志;MCP Inspector 调试;工具单元测试。 |
| 124 | day-124-billsleuth-investigator | Day 124 · BillSleuth(三):LangGraph 调查流程与证据链 | 状态机设计;每个节点的提示词与工具集;假设-验证循环;证据链数据结构;步数和成本上限;跑通 5 个场景。 |
| 125 | day-125-billsleuth-grounded-answer | Day 125 · BillSleuth(四):有据可查的解释,不许编数字 | 客户版与内部版两种解释;数字溯源校验器(抽金额→在证据里找→打回);引用格式;语气与合规(不承诺退款);数字幻觉的测试用例。 |
| 126 | day-126-billsleuth-approval | Day 126 · BillSleuth(五):贷记单草稿、人工审批与幂等 | 什么时候该冲正、冲多少;草稿生成;审批流(CLI + Web);幂等键与重复提交;拒绝后的处理;权限边界测试。 |
| 127 | day-127-billsleuth-eval | Day 127 · BillSleuth(六):100 个场景的评测与模拟客户 | 评测集结构;模拟客户(会追问、会给错信息);六个指标的计算;pass^k;统计置信区间(用 Day 69 的方法);结果表留空回填;怎么读错例。 |
| 128 | day-128-billsleuth-iterate | Day 128 · BillSleuth(七):错误分析与迭代 | 错例分桶;针对性改进(工具返回结构、提示词、加专用工具如 `explain_proration`);模型对比(两三个模型的准确率/成本,留空回填);每次改动跑回归、只认统计显著的提升。 |
| 129 | day-129-billsleuth-demo | Day 129 · BillSleuth(八):在线演示、实时调查面板与部署 | FastAPI + SSE;前端调查面板(步骤、证据链、复算对比表);导出 trace 到 Agent Loupe;限流与花费上限;部署。 |
| 130 | day-130-portfolio-graduation | Day 130 · 作品篇结业:案例页、FDE 面试故事和投递 | BillSleuth 案例页与演示视频脚本;FDE 面试怎么讲(客户场景→方案→指标→取舍);两个作品在简历和网站上的摆法;用 docs/jd-research 的 FDE/外企数据说明投哪些岗位;作品篇自检清单。 |

**作品篇写作要求补充**:
- 前一天的代码后一天直接用,文件路径、函数名、表名、接口路径严格按上面的规格;需要新增的东西在当天说明「新增」。
- 每篇「动手练习」给出当天的完整代码(可以分文件给),以及能跑的验证命令(`uv run pytest`、`pnpm dev` 等)。
- 前端代码给完整组件,不要只给片段;TS 类型写全。
- 资料优先一手:OTel 规范、Langfuse/Phoenix 文档、React/Vite 文档、Stripe 计费文档(按天折算、发票、贷记单的概念,查证链接)、τ-bench 论文。
- Day 120 的「明天预告」预告 Day 121;Day 130 的「明天预告」写作品篇之后的安排(没有 Day 131,写「下一步」即可,但要包含 `Day 131` 字样以免校验报错可写「没有 Day 131 了」)。

## 6. 完成后自检(每篇)

- [ ] frontmatter 齐全,`day`、`title` 与规划表一致,`pubDate: 2026-10-12`(作品篇 2026-10-15),tags 最后一个 `agent-60`。
- [ ] 8 个骨架章节齐全、顺序对;「学习资料」五个三级标题齐全;明天预告提到下一天。
- [ ] 1–3 张 SVG;2–4 个视频嵌入且 B 站至少 1 个,全部 API 验证过,figcaption 写验证到的标题。
- [ ] 所有 URL curl 通过;书籍查证过;模型名/价格写了查证日期。
- [ ] 纯汉字 ≥ 5,000(`python3 -c "import re,sys;print(len(re.findall(r'[一-鿿]',open(sys.argv[1]).read())))" FILE`)。
- [ ] `<details>` 内前后空行;HTML 块前后空行。
- [ ] 不要跑 `npm run build`(主会话统一构建),不要 git commit。
