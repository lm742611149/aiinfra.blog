# AI Agent 工程师:从零到资深 · 完整大纲(草案,2026-10-22)

状态:**草案,待站长审**。series 为 `agent-zero`,文件 `src/content/blog/agent-zero/day-NNN-xxx.md`,站内链接 `/blog/agent-zero/day-NNN-xxx/`。审完后从 Day 0 开始分批写,每批 2–4 周。写作规范沿用 `docs/course-writing-guide-agent.md`(骨架、语气、图、视频、链接、line-notes),另加第 5 节的「0 基础规则」。

## 1. 设计说明

**不定天数,越细越好**。这一版共 **711 天**(Day 0–710),其中 101 个复习日。天数是拆出来的结果,不是目标:凡是一天里超过两个新概念、来源小节代码超过约 60 行或讲解很重、或者对只会前端的读者跨度太大的,都拆成多天;缺台阶的地方补新写的过渡课。

**读者画像(定死)**:只会前端,熟悉 HTML/CSS/JS/TS/React,会 npm,会用浏览器 DevTools;除此之外完全 0 基础:不会 Python,没写过后端,不懂服务端、数据库和 SQL、Linux 服务器、Docker,git 只会基本的 commit/push,也不懂任何机器学习。所以 Python 每个知识点都用 JS/TS 做类比(list≈Array、dict≈Object/Map、async/await 对照 Promise、uv≈npm/pnpm、pyproject.toml≈package.json、pytest≈jest/vitest);后端概念(服务端、进程、端口、REST 服务端实现、数据库、事务、队列、缓存、鉴权)都从前端视角补前置课;数学和统计只讲到够用,先给直觉。

**前端不教**:不写 HTML/CSS/JS/React/Next.js 入门课。涉及界面的课(SupportPilot 工作台、TypeScript 写 Agent、生成式 UI、Agent Loupe 时间轴)只讲 Agent 相关的部分(流式事件、工具调用卡片、审批交互、协议与安全、渲染性能),默认读者会前端。除前端之外,0 基础前置、旧课 Day 0–130 全部内容、专题篇 Day 131–153、缺口清单 `docs/course-gap-2026-10.md` 的 A/B 两节全部并进来,一条不漏(第 3 节映射表里旧课每一篇都有去处)。

**每课的学习流程固定为三步**:①对照文章逐行敲一遍(不复制粘贴)并跑通;②第二天合上文章,把核心部分默写出来;③做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。所以每课的每道练习都附完整参考答案(第 5 节第 11 条)。

**分段**:

| 部分 | Day | 天数 |
| --- | --- | --- |
| 第一部分 · 0 基础与编程地基 | 0–105 | 106 |
| 第二部分 · 大模型与 API | 106–155 | 50 |
| 第三部分 · 工具调用与 Agent 循环 | 156–211 | 56 |
| 第四部分 · RAG 与上下文工程 | 212–270 | 59 |
| 第五部分 · MCP、编排框架与多 Agent | 271–340 | 70 |
| 第六部分 · 评测与可观测 | 341–377 | 37 |
| 第七部分 · 生产化与安全 | 378–434 | 57 |
| 第八部分 · 毕业项目 SupportPilot | 435–497 | 63 |
| 第九部分 · 求职 | 498–517 | 20 |
| 第十部分 · 进阶:资深 Agent 工程师 | 518–648 | 131 |
| 第十一部分 · 作品:Agent Loupe 和 BillSleuth | 649–701 | 53 |
| 第十二部分 · 总复习与结业 | 702–710 | 9 |
| 合计 | 0–710 | 711 |

**怎么排的**:
- **第一部分全是旧课没有的前置**。旧课 Day 2 一天讲完 uv、类型标注、pydantic、async、httpx、pytest、日志;现在 Python 按每类容器、每类语法一天拆开(数字、布尔与 None、字符串两天、if、for、while、列表、元组、推导式、字典、集合、嵌套数据、函数三天、模块、包、异常两天、路径、文件、JSON、类三天、类型标注四天、dataclass、pydantic 两天、装饰器、上下文管理器、生成器),HTTP 按请求的每个部分拆三天,SQL 按每类语句拆六天,另有终端四天、git 三天、FastAPI 三天、鉴权两天、Docker 三天、Python 操作数据库两天。每 3–4 周一个只用已学知识的小项目(工单分类器、工单记事本、带校验的录入工具、天气 CLI、迷你账单库)。
- **第二部分起按旧课顺序走,一个旧小节基本对应新课一天**,讲解重的再拆。框架概念一律先玩具、再实战:LangGraph 先用十一个不调模型的小脚本各占一天,checkpoint、interrupt、时间旅行、stream、子图也各占一天,最后才拼成 Agent 循环和退款审批。
- **专题篇不再单独成篇**,放回它该在的位置(工具检索、CodeAct、推理预算进第三部分;多模态、GraphRAG、代码检索、RLM 进第四部分;Text-to-SQL、Skills、后台 Agent、低代码平台进第五部分;DSPy/GEPA、数据飞轮进第六部分;Guardrails、供应链安全、托管运行时、Java/Go 进第七部分;TypeScript 写 Agent 进毕业项目;行业案例进求职;身份授权、国内合规、WebMCP、支付、生成式 UI 进进阶篇)。
- **复习日由脚本每 6 个内容日自动插一个**(第 7 天),周数顺延;复习日内容是知识地图、错题和默写本周核心代码。每部分末尾是小项目或总复习。项目线不变:CLI 聊天机器人 → CLI Agent → 文档问答 → 工单分流 → 评测 CI → 公网服务 → SupportPilot → AgentOps → Agent Loupe → BillSleuth。
- **进阶篇和作品篇**保留「判断力、规模、取舍」的写法,但同样一天一两个点:旧课一篇基本拆两到三天。

## 2. 逐日大纲

列说明:来源写旧课 Day 号和小节名(「新写」表示旧课没有);「要实跑」是写这一天时必须真跑并把输出写进文章的代码或数据,每一天都还包括动手练习每道题的参考答案。

### 第一部分 · 0 基础与编程地基(Day 0–105,106 天)

| Day | slug | 标题 | 今天只讲的知识点 | 来源 | 要实跑的代码/数据 |
| --- | --- | --- | --- | --- | --- |
| 0 | day-000-overview | Day 0 · 开学第一课:AI Agent 工程师做什么,这门课怎么学 | 岗位定义;课程地图与三步学法 | 旧 0「这个岗位到底在干什么」「这 60 天怎么安排」「每天怎么用这个站」(改写) | 每道练习的参考答案 |
| 1 | day-001-salary-honest | Day 1 · 岗位能拿多少钱,学完能做到什么 | 薪资口径;诚实预期 | 旧 0「2026 年大概能拿多少钱」「诚实地说」 | 读 jd-research 数据;每道练习的参考答案 |
| 2 | day-002-setup-budget | Day 2 · 准备工作:要装的软件、要注册的 API、整门课花多少钱 | 软件清单;预算算式 | 旧 0「准备工作」 | 算一遍 API 花费;每道练习的参考答案 |
| 3 | day-003-terminal-1 | Day 3 · 终端(一):打开终端,pwd、ls、cd 和路径 | 绝对/相对路径 | 新写 | 逐条敲;每道练习的参考答案 |
| 4 | day-004-terminal-2 | Day 4 · 终端(二):建目录、复制、移动、删除 | mkdir/cp/mv/rm;通配符 | 新写 | 整理一个练习目录;每道练习的参考答案 |
| 5 | day-005-terminal-3 | Day 5 · 终端(三):管道、重定向和 grep | \| 和 >;grep | 新写 | 统计目录文件数;每道练习的参考答案 |
| 6 | day-006-week01-review | Day 6 · 第 1 周复习:编程地基(Day 0–5) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 7 | day-007-terminal-4 | Day 7 · 终端(四):PATH、which 和 shell 配置文件 | 命令是怎么被找到的;.zshrc | 新写(和 npm 全局命令对照) | which python3 / node;每道练习的参考答案 |
| 8 | day-008-python-vs-node | Day 8 · 第一个 Python 程序:和 Node 比,Python 怎么跑 | 解释器;脚本运行 | 旧 2「先建立对照表」 | hello.py;每道练习的参考答案 |
| 9 | day-009-editor-setup | Day 9 · 编辑器准备:Zed/VS Code 的 Python 插件、格式化和类型检查 | basedpyright;Ruff | 旧 2 陪学记录(Zed 配置) | 故意写错看红线;每道练习的参考答案 |
| 10 | day-010-uv-1 | Day 10 · uv(一):init、add、run,对照 npm | uv≈npm/pnpm | 旧 2「uv:一个工具管完 Python 项目」前半 | uv init agent-zero-lab;每道练习的参考答案 |
| 11 | day-011-uv-2 | Day 11 · uv(二):虚拟环境、pyproject.toml 和 uv.lock | .venv≈node_modules;pyproject≈package.json;lock 文件 | 旧 2「uv」后半 | 删 .venv 再 uv sync;每道练习的参考答案 |
| 12 | day-012-numbers | Day 12 · 变量和数字:int、float 和运算 | 变量;整除/取余;浮点误差 | 新写(对照 JS 只有 number) | 算含税价,看 0.1+0.2;每道练习的参考答案 |
| 13 | day-013-week02-review | Day 13 · 第 2 周复习:编程地基(Day 7–12) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 14 | day-014-bool-none | Day 14 · 布尔、None 和类型转换 | True/False;None≈null;int()/str() | 新写 | 把用户输入转成数字;每道练习的参考答案 |
| 15 | day-015-strings-1 | Day 15 · 字符串(一):索引、切片和 f-string | 切片;f-string≈模板字符串 | 新写 | 截出工单号;每道练习的参考答案 |
| 16 | day-016-strings-2 | Day 16 · 字符串(二):常用方法、中文和编码 | split/strip/replace;UTF-8 | 新写 | 清洗一段工单文本;每道练习的参考答案 |
| 17 | day-017-if-else | Day 17 · 条件判断:if、elif、else 和布尔运算 | 分支;and/or/not;真值 | 新写 | 按关键词分类工单;每道练习的参考答案 |
| 18 | day-018-for-range | Day 18 · for 循环和 range | 遍历;range;enumerate | 新写(对照 for...of) | 批量处理 10 张工单;每道练习的参考答案 |
| 19 | day-019-while-break | Day 19 · while、break 和 continue | 退出条件;跳过 | 新写 | 重试三次的循环;每道练习的参考答案 |
| 20 | day-020-week03-review | Day 20 · 第 3 周复习:编程地基(Day 14–19) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 21 | day-021-lists | Day 21 · 列表:增删改查和排序 | list≈Array;append/pop/sort | 新写 | 工单列表按金额排序;每道练习的参考答案 |
| 22 | day-022-tuples-unpack | Day 22 · 元组和解包 | tuple;解包≈解构赋值 | 旧 2 补充「tuple+解包」 | 函数返回两个值;每道练习的参考答案 |
| 23 | day-023-comprehensions | Day 23 · 列表推导式 | [x for x in ...]≈map/filter | 新写 | 一行筛出退款工单;每道练习的参考答案 |
| 24 | day-024-dicts | Day 24 · 字典:键值对和 .items() | dict≈Object/Map;get;items | 旧 2 补充「dict .items()」 | 按类别计数;每道练习的参考答案 |
| 25 | day-025-sets | Day 25 · 集合:去重和集合运算 | set≈Set;交并差 | 旧 2 补充「set」 | 找两批工单的重复;每道练习的参考答案 |
| 26 | day-026-nested-data | Day 26 · 嵌套数据:列表套字典,读懂一份 JSON 长什么样 | 嵌套访问;字典推导式 | 新写 | 遍历工单 JSON 结构;每道练习的参考答案 |
| 27 | day-027-week04-review | Day 27 · 第 4 周复习:编程地基(Day 21–26) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 28 | day-028-functions-1 | Day 28 · 函数(一):def、参数和返回值 | def≈function;return | 新写 | 把分类写成函数;每道练习的参考答案 |
| 29 | day-029-functions-2 | Day 29 · 函数(二):默认参数、关键字参数和可变默认值陷阱 | 默认值;关键字传参 | 旧 2 补充「可变默认值」 | 复现陷阱;每道练习的参考答案 |
| 30 | day-030-functions-3 | Day 30 · 函数(三):*args、**kwargs、作用域和 lambda | 可变参数≈rest 参数;作用域;lambda≈箭头函数 | 新写 | 可配置的打分函数;每道练习的参考答案 |
| 31 | day-031-ticket-classifier-project | Day 31 · 小项目:纯 Python 工单分类器 | 综合运用 1–3 周 | 新写 | ticket_classifier.py 跑 20 条;每道练习的参考答案 |
| 32 | day-032-modules | Day 32 · 模块:import 和 from ... import | import≈ES Module;__name__ | 新写 | 拆成两个文件;每道练习的参考答案 |
| 33 | day-033-packages | Day 33 · 包:__init__.py、-m 运行和从根目录跑 | 包;-m;根目录运行 | 旧 2「课程仓库的目录约定」+ 旧 9/16 的 -m 坑 | w1/ 包结构跑通;每道练习的参考答案 |
| 34 | day-034-week05-review | Day 34 · 第 5 周复习:编程地基(Day 28–33) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 35 | day-035-exceptions-1 | Day 35 · 异常(一):try、except 和常见报错怎么读 | traceback 怎么读;捕获 | 新写(对照 try/catch) | 读坏文件不崩;每道练习的参考答案 |
| 36 | day-036-exceptions-2 | Day 36 · 异常(二):raise、自定义异常和 finally | 抛出;finally | 新写 | 自定义 TicketError;每道练习的参考答案 |
| 37 | day-037-pathlib | Day 37 · 路径:pathlib | Path;拼路径;存在判断 | 新写(对照 node:path) | 列出目录下所有 .json;每道练习的参考答案 |
| 38 | day-038-files-with | Day 38 · 读写文件和 with | open;with≈try/finally | 新写 | 把工单存成文本再读回;每道练习的参考答案 |
| 39 | day-039-json | Day 39 · JSON:Python 和 JSON 互转 | dumps/loads;ensure_ascii | 新写(对照 JSON.stringify/parse) | 工单存 JSON 再读回;每道练习的参考答案 |
| 40 | day-040-classes-1 | Day 40 · 类(一):class、__init__ 和 self | 对象;属性;方法(对照 JS class) | 新写 | Ticket 类;每道练习的参考答案 |
| 41 | day-041-week06-review | Day 41 · 第 6 周复习:编程地基(Day 35–40) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 42 | day-042-classes-2 | Day 42 · 类(二):继承和组合 | 继承 vs 组合 | 新写 | 两种通知渠道类;每道练习的参考答案 |
| 43 | day-043-classes-3 | Day 43 · 类(三):__repr__、@property 和类方法 | 魔术方法;property≈getter | 新写 | Ticket 打印更好看;每道练习的参考答案 |
| 44 | day-044-notebook-project | Day 44 · 小项目:命令行工单记事本 | 综合运用:类+文件+JSON | 新写 | 增删查工单并存 JSON;每道练习的参考答案 |
| 45 | day-045-type-hints-1 | Day 45 · 类型标注(一):基础写法和编辑器红线 | 注解语法对照 TS | 旧 2「类型标注」前半 | basedpyright 看红线;每道练习的参考答案 |
| 46 | day-046-type-hints-2 | Day 46 · 类型标注(二):X \| None、容器类型和 Any | Optional;list[str];dict[str,int] | 旧 2「类型标注」后半 | 修 3 条红线;每道练习的参考答案 |
| 47 | day-047-type-hints-3 | Day 47 · 类型标注(三):TypedDict 和 Literal | ≈TS interface/字面量类型 | 旧 2 补充「Literal」 | 工单类型定义;每道练习的参考答案 |
| 48 | day-048-week07-review | Day 48 · 第 7 周复习:编程地基(Day 42–47) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 49 | day-049-type-hints-4 | Day 49 · 类型标注(四):Protocol 和 TypeVar | ≈TS 结构类型/泛型 | 旧 2 补充「TypeVar」+ 旧 6「ChatClient Protocol」 | FakeClient 通过类型检查;每道练习的参考答案 |
| 50 | day-050-dataclass | Day 50 · dataclass:装数据的类 | dataclass;field | 旧 2「dataclass 和 pydantic」前半 + 「field vs Field」 | Ticket 改写成 dataclass;每道练习的参考答案 |
| 51 | day-051-pydantic-1 | Day 51 · pydantic(一):守大门的模型和校验报错 | BaseModel;ValidationError(≈zod) | 旧 2「dataclass 和 pydantic」后半 | 校验工单表单;每道练习的参考答案 |
| 52 | day-052-pydantic-2 | Day 52 · pydantic(二):Field、validator、model_dump 和 model_validate | 字段约束;自定义校验;导入导出 | 旧 2 + 旧 6「用 pydantic 定义 schema」前半 | 金额必须为正;每道练习的参考答案 |
| 53 | day-053-env-secrets | Day 53 · 环境变量和密钥:.env、python-dotenv、.gitignore | ≈前端 .env;密钥不进仓库 | 旧 2「密钥」+ 旧 0 key 报错表 | load_dotenv 读 key;每道练习的参考答案 |
| 54 | day-054-intake-project | Day 54 · 小项目:带校验的工单录入工具 | pydantic + JSON 存储 | 新写 | 录入 5 条,1 条被拦;每道练习的参考答案 |
| 55 | day-055-week08-review | Day 55 · 第 8 周复习:编程地基(Day 49–54) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 56 | day-056-git-1 | Day 56 · git(一):仓库、add、commit、log 和 diff | 暂存区;提交 | 旧 7「先 git add 再查密钥」 | 在 lab 第一次提交;每道练习的参考答案 |
| 57 | day-057-git-2 | Day 57 · git(二):分支、合并和冲突 | branch/merge;解决冲突 | 新写 | 故意制造一次冲突;每道练习的参考答案 |
| 58 | day-058-git-3 | Day 58 · git(三):GitHub、push、SSH key 和 PR | 远程;SSH;PR 流程 | 旧 7「GitHub 建仓步骤」+ cli-agent 推 GitHub 经验 | 推到自己的 GitHub;每道练习的参考答案 |
| 59 | day-059-http-1 | Day 59 · HTTP(一):URL、方法和一次请求的样子 | 请求行;GET/POST | 新写(从 DevTools Network 面板讲起) | curl -v 看请求;每道练习的参考答案 |
| 60 | day-060-http-2 | Day 60 · HTTP(二):状态码和 header | 2xx/4xx/5xx;常用 header | 新写 | curl 看 401 和 404;每道练习的参考答案 |
| 61 | day-061-http-3 | Day 61 · HTTP(三):请求体、JSON 和 Content-Type | body;JSON;表单 | 新写 | curl POST 一段 JSON;每道练习的参考答案 |
| 62 | day-062-week09-review | Day 62 · 第 9 周复习:编程地基(Day 56–61) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 63 | day-063-rest-api | Day 63 · REST API:读接口文档,query、path 和鉴权头 | REST 约定;Authorization | 新写 | curl 调 DeepSeek 余额接口;每道练习的参考答案 |
| 64 | day-064-httpx-1 | Day 64 · httpx(一):用 Python 发请求 | get/post;json() | 旧 2「httpx」前半(对照 fetch) | 请求 Open-Meteo;每道练习的参考答案 |
| 65 | day-065-httpx-2 | Day 65 · httpx(二):超时、raise_for_status 和错误处理 | 超时;异常类型 | 旧 2「httpx」后半 | 故意超时;每道练习的参考答案 |
| 66 | day-066-async-1 | Day 66 · async(一):为什么等网络要异步,对照 JS 的 Promise | 事件循环;协程 | 旧 2「async/await」前半 | 无(图解+小实验);每道练习的参考答案 |
| 67 | day-067-async-2 | Day 67 · async(二):async def、await 和 asyncio.run | 写第一个协程 | 旧 2「async/await」中段 | 串行 vs 异步计时;每道练习的参考答案 |
| 68 | day-068-async-3 | Day 68 · async(三):gather、return_exceptions 和限并发 | gather≈Promise.all/allSettled;Semaphore | 旧 2 补充「gather 返回 BaseException」 | 并发 10 个请求;每道练习的参考答案 |
| 69 | day-069-week10-review | Day 69 · 第 10 周复习:编程地基(Day 63–68) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 70 | day-070-weather-project | Day 70 · 小项目:命令行天气查询 | httpx + async + 错误处理 | 新写 | weather_cli.py;每道练习的参考答案 |
| 71 | day-071-pytest-1 | Day 71 · pytest(一):assert 和第一个测试 | pytest≈jest/vitest | 旧 2「pytest」前半 | test_cost.py;每道练习的参考答案 |
| 72 | day-072-pytest-2 | Day 72 · pytest(二):pythonpath、目录结构和只跑一个测试 | pyproject 配置;-k | 旧 4「pythonpath」坑 | 修 ModuleNotFoundError;每道练习的参考答案 |
| 73 | day-073-pytest-3 | Day 73 · pytest(三):fixture 和 parametrize | ≈beforeEach;参数化 | 新写 | 参数化 6 条用例;每道练习的参考答案 |
| 74 | day-074-pytest-4 | Day 74 · pytest(四):假对象和 monkeypatch | ≈jest.mock | 新写 + 旧 12「用假模型写离线测试」铺垫 | 假 HTTP 客户端;每道练习的参考答案 |
| 75 | day-075-logging | Day 75 · 日志:logging 和 getLogger(__name__) | 级别;格式 | 旧 2「日志:别只用 print」 | 给天气工具加日志;每道练习的参考答案 |
| 76 | day-076-week11-review | Day 76 · 第 11 周复习:编程地基(Day 70–75) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 77 | day-077-server-1 | Day 77 · 后端是什么(一):进程、端口和 localhost | 进程;端口;lsof | 新写(从「npm run dev 起了个 3000 端口」讲起) | python -m http.server;每道练习的参考答案 |
| 78 | day-078-server-2 | Day 78 · 后端是什么(二):一次请求在服务端走过的路 | 路由;处理函数;响应 | 新写 | 最小 http.server 处理器;每道练习的参考答案 |
| 79 | day-079-fastapi-1 | Day 79 · FastAPI(一):路由、路径参数和查询参数 | ≈Express 路由 | 新写 | GET /tickets/{id};每道练习的参考答案 |
| 80 | day-080-fastapi-2 | Day 80 · FastAPI(二):请求体、pydantic 校验和自动文档 | POST;422;/docs | 新写 | POST /tickets;每道练习的参考答案 |
| 81 | day-081-fastapi-3 | Day 81 · FastAPI(三):错误处理、依赖注入和中间件 | HTTPException;Depends | 新写(为服务化铺垫) | 统一错误格式;每道练习的参考答案 |
| 82 | day-082-auth-1 | Day 82 · 鉴权(一):API key 和 session/cookie,这回从服务端看 | 服务端怎么验 | 新写 | 给接口加 API key;每道练习的参考答案 |
| 83 | day-083-week12-review | Day 83 · 第 12 周复习:编程地基(Day 77–82) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 84 | day-084-auth-2 | Day 84 · 鉴权(二):JWT 是什么,签名怎么验 | header.payload.signature | 新写(为 OAuth/MCP 网关铺垫) | pyjwt 签发与校验;每道练习的参考答案 |
| 85 | day-085-sql-1 | Day 85 · SQL(一):SQLite、建表和 SELECT | 表;列;SELECT/WHERE/ORDER BY | 新写 | sqlite3 建 customers 表;每道练习的参考答案 |
| 86 | day-086-sql-2 | Day 86 · SQL(二):INSERT、UPDATE 和 DELETE | 改数据;WHERE 忘写的后果 | 新写 | 误删再恢复;每道练习的参考答案 |
| 87 | day-087-sql-3 | Day 87 · SQL(三):JOIN | 内连接;左连接 | 新写 | 客户和发票连表;每道练习的参考答案 |
| 88 | day-088-sql-4 | Day 88 · SQL(四):GROUP BY 和聚合函数 | COUNT/SUM;HAVING | 新写 | 按客户统计发票金额;每道练习的参考答案 |
| 89 | day-089-sql-5 | Day 89 · SQL(五):索引和 EXPLAIN | 索引为什么快 | 新写 | 有无索引对比;每道练习的参考答案 |
| 90 | day-090-week13-review | Day 90 · 第 13 周复习:编程地基(Day 84–89) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 91 | day-091-sql-6 | Day 91 · SQL(六):事务、主键外键和约束 | ACID 直觉;约束 | 新写 | 扣款中途失败回滚;每道练习的参考答案 |
| 92 | day-092-python-sqlite-1 | Day 92 · Python 操作 SQLite(一):查询和参数化防注入 | sqlite3;?占位符 | 新写 | 注入演示;每道练习的参考答案 |
| 93 | day-093-python-sqlite-2 | Day 93 · Python 操作 SQLite(二):事务、row_factory 和上下文管理器 | commit/rollback | 新写 | 封装 db();每道练习的参考答案 |
| 94 | day-094-ledger-project | Day 94 · 小项目:CloudLedger 迷你账单库 | 建表+造数+查询 | 新写(为第五部分 seed.py 铺垫) | customers/invoices 两表;每道练习的参考答案 |
| 95 | day-095-json-schema | Day 95 · JSON Schema:描述数据长什么样的标准 | type/properties/required | 新写(为 function calling 铺垫) | jsonschema 校验工单;每道练习的参考答案 |
| 96 | day-096-decorators | Day 96 · 装饰器:@ 到底干了什么 | 高阶函数;functools.wraps | 旧 2「读框架源码前要认识的几个写法」 | 计时装饰器;每道练习的参考答案 |
| 97 | day-097-week14-review | Day 97 · 第 14 周复习:编程地基(Day 91–96) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 98 | day-098-context-managers | Day 98 · 上下文管理器:with 背后的 __enter__/__exit__ | contextlib | 旧 2「读框架源码前要认识的几个写法」 | 计时 with;每道练习的参考答案 |
| 99 | day-099-generators | Day 99 · 生成器和 yield | 惰性;≈JS generator | 旧 2「读框架源码前要认识的几个写法」 | 逐行读大文件;每道练习的参考答案 |
| 100 | day-100-docker-1 | Day 100 · Docker(一):镜像、容器和 run | 容器是什么;没 Docker 用 OrbStack/云 | 新写 | 跑一个 hello 容器;每道练习的参考答案 |
| 101 | day-101-docker-2 | Day 101 · Docker(二):Dockerfile 和构建镜像 | 分层;缓存 | 新写 | 把天气工具打成镜像;每道练习的参考答案 |
| 102 | day-102-docker-3 | Day 102 · Docker(三):compose 拉起多个服务 | 服务;网络;卷 | 新写(为 pgvector/部署铺垫) | app + postgres;每道练习的参考答案 |
| 103 | day-103-coding-agent-for-learning | Day 103 · 用 Coding Agent 学编程:怎么问、怎么审它写的代码 | 提问;审查清单 | 旧 2「用 Coding Agent 学 Python、写代码」 | 让 AI 写函数再自己审;每道练习的参考答案 |
| 104 | day-104-week15-review | Day 104 · 第 15 周复习:编程地基(Day 98–103) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 105 | day-105-part1-review | Day 105 · 第一部分总复习:编程地基自检 | 知识地图;自测 30 题 | 新写 | 综合小测;每道练习的参考答案 |

### 第二部分 · 大模型与 API(Day 106–155,50 天)

| Day | slug | 标题 | 今天只讲的知识点 | 来源 | 要实跑的代码/数据 |
| --- | --- | --- | --- | --- | --- |
| 106 | day-106-next-token | Day 106 · 大模型只做一件事:猜下一个 token | 自回归生成 | 旧 1「模型只做一件事」 | 每道练习的参考答案 |
| 107 | day-107-tokens-1 | Day 107 · Token(一):模型看到的不是字 | tokenizer;BPE 直觉 | 旧 1「Token」前半 | 每道练习的参考答案 |
| 108 | day-108-tokens-2 | Day 108 · Token(二):动手数 token,中文为什么费 token | 计数;中英对比 | 旧 1「Token」后半 | w1/count_tokens.py;每道练习的参考答案 |
| 109 | day-109-context-window | Day 109 · 上下文窗口:模型能看到的全部世界 | 窗口;截断;长上下文 | 旧 1「上下文窗口」 | 算一本书要多少 token;每道练习的参考答案 |
| 110 | day-110-sampling-1 | Day 110 · 采样(一):概率分布和 temperature | 温度直觉 | 旧 1「采样」前半 | w1/temperature.py;每道练习的参考答案 |
| 111 | day-111-week16-review | Day 111 · 第 16 周复习:大模型与 API(Day 105–110) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 112 | day-112-sampling-2 | Day 112 · 采样(二):top_p、seed 和可复现 | 核采样;复现 | 旧 1「采样」后半 | 同题跑 5 次;每道练习的参考答案 |
| 113 | day-113-training | Day 113 · 模型怎么训出来:预训练、指令微调、RLHF 一句话版 | 三阶段 | 旧 1「模型是怎么训出来的」 | 每道练习的参考答案 |
| 114 | day-114-hallucination | Day 114 · 幻觉从哪来,怎么让它少一点 | 幻觉成因 | 旧 1(幻觉节) | w1/hallucination.py;每道练习的参考答案 |
| 115 | day-115-reasoning-models | Day 115 · 推理模型和思考模式 | thinking 是什么 | 旧 1「推理模型和思考模式」+ 旧 134 前两节 | 同题开/关思考;每道练习的参考答案 |
| 116 | day-116-attention | Day 116 · Transformer 和注意力:面试够用版 | 注意力直觉;因果遮罩 | 旧 1「Transformer、注意力和 MoE」前半 | 无(图解);每道练习的参考答案 |
| 117 | day-117-moe-kvcache | Day 117 · MoE 和 KV cache:总参数、激活参数,为什么能缓存 | MoE;KV cache | 旧 1「Transformer、注意力和 MoE」后半 | 每道练习的参考答案 |
| 118 | day-118-week17-review | Day 118 · 第 17 周复习:大模型与 API(Day 112–117) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 119 | day-119-local-models-intro | Day 119 · 哪些模型能本地跑,自己训一个要做什么 | 开源模型版图 | 旧 1「补充:哪些模型能本地部署」 | 每道练习的参考答案 |
| 120 | day-120-api-register | Day 120 · 注册 API、充值和第一次调用 | key;base_url | 旧 3「一次调用到底发了什么」前半 + 旧 0 key 报错表 | w1/ask.py;每道练习的参考答案 |
| 121 | day-121-api-request | Day 121 · 一次调用到底发了什么:请求逐字段 | model/messages/参数 | 旧 3「一次调用到底发了什么」后半 | 打印请求体;每道练习的参考答案 |
| 122 | day-122-api-response | Day 122 · 响应逐字段:choices、finish_reason、usage | 响应结构 | 旧 3 | 打印响应;每道练习的参考答案 |
| 123 | day-123-openai-compatible | Day 123 · OpenAI 兼容协议:一份代码切换多家 | 环境变量切厂商 | 旧 3「OpenAI 兼容协议」 | 切 DeepSeek/百炼;每道练习的参考答案 |
| 124 | day-124-cost | Day 124 · 算钱:从 usage 到人民币 | 计费算式;缓存价 | 旧 3「算钱」 | cost.py + 测试;每道练习的参考答案 |
| 125 | day-125-week18-review | Day 125 · 第 18 周复习:大模型与 API(Day 119–124) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 126 | day-126-error-codes | Day 126 · 错误码:401、429、5xx 谁的问题 | 错误分类 | 旧 3「错误码」前半 | 故意触发 401;每道练习的参考答案 |
| 127 | day-127-retry-backoff | Day 127 · 重试和指数退避 | 该不该重试;退避 | 旧 3「错误码」后半 | 模拟 429 重试;每道练习的参考答案 |
| 128 | day-128-rate-limit | Day 128 · 限速、并发和选厂商 | RPM/TPM;并发控制 | 旧 3「限速、并发和选厂商」 | 并发 5 个请求;每道练习的参考答案 |
| 129 | day-129-messages | Day 129 · messages:模型没有记忆,你的列表就是记忆 | 无状态;角色 | 旧 4「模型没有记忆」 | 手拼多轮;每道练习的参考答案 |
| 130 | day-130-system-prompt | Day 130 · system prompt 放什么,不放什么 | 角色;优先级 | 旧 4(system 部分) | 改 system 看变化;每道练习的参考答案 |
| 131 | day-131-conversation-cost | Day 131 · 对话越聊越贵:平方级增长 | 累计 token | 旧 4「聊得越久越贵」 | 20 轮成本曲线;每道练习的参考答案 |
| 132 | day-132-week19-review | Day 132 · 第 19 周复习:大模型与 API(Day 126–131) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 133 | day-133-sse-principle | Day 133 · 流式输出(一):SSE 原理和首 token 延迟 | 事件流格式 | 旧 4「流式输出」前半 | curl -N 看原始流;每道练习的参考答案 |
| 134 | day-134-streaming-code | Day 134 · 流式输出(二):Python 里读流 | stream=True;拼增量 | 旧 4「流式输出」后半 | w1/chat_stream.py;每道练习的参考答案 |
| 135 | day-135-llm-client-1 | Day 135 · 封装 LLMClient(一):为什么封装,接口长什么样 | chat/stream 接口 | 旧 4「封装 LLMClient」前半 | common/llm.py 骨架;每道练习的参考答案 |
| 136 | day-136-llm-client-2 | Day 136 · 封装 LLMClient(二):实现和三层读法 | 逐层读代码 | 旧 4 后半 + 陪学「三层读法」 | 跑通 chat();每道练习的参考答案 |
| 137 | day-137-llm-client-3 | Day 137 · 封装 LLMClient(三):给它写测试 | 假客户端;断言 | 旧 4 测试部分 | tests/test_conversation.py;每道练习的参考答案 |
| 138 | day-138-prompt-1 | Day 138 · 提示词(一):把模型当聪明的新同事 | 一条原则 | 旧 5「一条原则」 | 改写一条坏提示词;每道练习的参考答案 |
| 139 | day-139-week20-review | Day 139 · 第 20 周复习:大模型与 API(Day 133–138) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 140 | day-140-prompt-2 | Day 140 · 提示词(二):给背景、给定义、给理由 | 手段一 | 旧 5「手段一」 | 有无定义对比;每道练习的参考答案 |
| 141 | day-141-prompt-3 | Day 141 · 提示词(三):few-shot 示例 | 手段二 | 旧 5「手段二」 | 有无示例对比;每道练习的参考答案 |
| 142 | day-142-prompt-4 | Day 142 · 提示词(四):让模型先想再答 | 手段三;思维链 | 旧 5「手段三」 | CoT 前后对比;每道练习的参考答案 |
| 143 | day-143-prompt-5 | Day 143 · 提示词(五):用标签分隔,预填和固定开头 | 手段四、五 | 旧 5「手段四」「手段五」 | XML 标签版;每道练习的参考答案 |
| 144 | day-144-prompt-6 | Day 144 · 提示词(六):提示词是代码,模板化和版本管理 | 文件化;版本号 | 旧 5「提示词是代码」 | prompts/ 目录;每道练习的参考答案 |
| 145 | day-145-prompt-lab | Day 145 · 提示词实验:v1–v5 比成本和延迟 | 实验方法 | 旧 5「动手练习」+「什么时候提示词救不了你」 | w1/prompt_lab.py;每道练习的参考答案 |
| 146 | day-146-week21-review | Day 146 · 第 21 周复习:大模型与 API(Day 140–145) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 147 | day-147-structured-1 | Day 147 · 结构化输出(一):为什么 Agent 离不开它,三个层次 | 求它/约束它/逼它 | 旧 6「三个层次」 | 同题三种方式;每道练习的参考答案 |
| 148 | day-148-structured-2 | Day 148 · 结构化输出(二):JSON mode 和 JSON Schema 约束 | 各家支持 | 旧 6「三个层次」后半 | schema 约束实跑;每道练习的参考答案 |
| 149 | day-149-structured-3 | Day 149 · 结构化输出(三):用 pydantic 定义 schema | model_json_schema | 旧 6「用 pydantic 定义 schema」 | 生成 schema;每道练习的参考答案 |
| 150 | day-150-structured-4 | Day 150 · 结构化输出(四):校验失败把错误喂回去重试 | 重试循环 | 旧 6「校验失败怎么办」 | extract 重试;每道练习的参考答案 |
| 151 | day-151-structured-5 | Day 151 · 结构化输出(五):字段顺序、抽取的坑和 instructor | 字段顺序;instructor | 旧 6 后三节 | 从工单抽字段;每道练习的参考答案 |
| 152 | day-152-chatbot-1 | Day 152 · 小项目(一):命令行聊天机器人,多轮和流式 | 整合 | 旧 7「本周小项目」前段 | chatbot 跑通;每道练习的参考答案 |
| 153 | day-153-week22-review | Day 153 · 第 22 周复习:大模型与 API(Day 147–152) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 154 | day-154-chatbot-2 | Day 154 · 小项目(二):切换厂商和每轮成本统计 | 成本 | 旧 7 中段 | 每轮打印花费;每道练习的参考答案 |
| 155 | day-155-chatbot-3 | Day 155 · 小项目(三):保存对话、知识地图和面试题 | 会话保存;W1 面试题 | 旧 7 后段 | sessions/;每道练习的参考答案 |

### 第三部分 · 工具调用与 Agent 循环(Day 156–211,56 天)

| Day | slug | 标题 | 今天只讲的知识点 | 来源 | 要实跑的代码/数据 |
| --- | --- | --- | --- | --- | --- |
| 156 | day-156-fc-idea | Day 156 · Function calling:模型不会执行,它只写一段 JSON | 工具调用的本质 | 旧 8「先拆掉一个误会」 | 每道练习的参考答案 |
| 157 | day-157-tool-schema | Day 157 · 工具定义:写给模型看的 JSON Schema | name/description/parameters | 旧 8「工具定义」 | 写天气工具 schema;每道练习的参考答案 |
| 158 | day-158-fc-first-run | Day 158 · 第一次跑通:让模型查天气 | 请求→tool_calls | 旧 8「第一次跑通」 | w2/day08_weather.py;每道练习的参考答案 |
| 159 | day-159-tool-roundtrip | Day 159 · 一来一回:回传 tool 消息,消息时序图 | tool 消息;tool_call_id | 旧 8「逐字段读响应」 | 完整两轮;每道练习的参考答案 |
| 160 | day-160-week23-review | Day 160 · 第 23 周复习:工具与 Agent 循环(Day 154–159) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 161 | day-161-missing-result | Day 161 · 漏回 tool 消息会怎样 | 400 insufficient tool messages | 旧 8 练习 missing_result | 故意漏回;每道练习的参考答案 |
| 162 | day-162-parallel-tools | Day 162 · 并行工具调用 | 一次多个 tool_calls | 旧 8「并行工具调用」 | day08_parallel;每道练习的参考答案 |
| 163 | day-163-tool-choice | Day 163 · tool_choice 和思考模式的坑 | auto/none/required;强制工具 400 | 旧 8「tool_choice」「DeepSeek 思考模式的一个坑」 | 强制工具实验;每道练习的参考答案 |
| 164 | day-164-anthropic-tools | Day 164 · Anthropic 的写法,以及模型怎么学会调工具 | 格式对照;训练直觉 | 旧 8 后两节 | 只读对照;每道练习的参考答案 |
| 165 | day-165-agent-what | Day 165 · Agent 是什么:循环 = 调模型 + 执行工具 | 定义;退出条件 | 旧 9「Agent 到底是什么」 | 每道练习的参考答案 |
| 166 | day-166-agent-min | Day 166 · 25 行最小 Agent 循环 | while + tool_calls | 旧 9「先写一个 25 行的最小版」 | w2/agent_min.py;每道练习的参考答案 |
| 167 | day-167-week24-review | Day 167 · 第 24 周复习:工具与 Agent 循环(Day 161–166) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 168 | day-168-tool-registry-1 | Day 168 · 工具注册表(一):用装饰器登记工具 | 注册表模式 | 旧 9「工具注册表」前半 | @registry.tool;每道练习的参考答案 |
| 169 | day-169-tool-registry-2 | Day 169 · 工具注册表(二):函数签名自动变 schema | inspect;类型到 schema | 旧 9「工具注册表」后半 | 自动 schema 测试;每道练习的参考答案 |
| 170 | day-170-agent-full | Day 170 · 完整的 100 行 Agent | 步数上限;错误处理 | 旧 9「完整的 100 行」 | agent_loop.py;每道练习的参考答案 |
| 171 | day-171-agent-trace | Day 171 · 跑起来看它在想什么,Claude Code 的内部也是这个循环 | 打印轨迹 | 旧 9「跑起来看看」「Claude Code、Codex 的内部」「面试官想看什么」 | 轨迹打印;每道练习的参考答案 |
| 172 | day-172-react-1 | Day 172 · ReAct(一):论文在说什么 | Thought/Action/Observation | 旧 10「ReAct 论文在说什么」 | 每道练习的参考答案 |
| 173 | day-173-react-2 | Day 173 · ReAct(二):不用 function calling 手写一次 | 文本解析 | 旧 10「手写一次 ReAct」 | w2/react_prompt.py;每道练习的参考答案 |
| 174 | day-174-week25-review | Day 174 · 第 25 周复习:工具与 Agent 循环(Day 168–173) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 175 | day-175-react-3 | Day 175 · ReAct(三):Thought 去哪了,原生工具调用和推理模型 | 隐式推理 | 旧 10「Thought 去哪了」 | 对比两种;每道练习的参考答案 |
| 176 | day-176-plan-execute | Day 176 · Plan-and-Execute:先列计划再动手 | 计划;执行 | 旧 10「Plan-and-Execute」 | w2/plan_execute.py;每道练习的参考答案 |
| 177 | day-177-todo-reflection | Day 177 · 待办清单和做完再检查 | todo;反思 | 旧 10「待办清单」「反思」「什么时候需要显式规划」 | todo 工具;每道练习的参考答案 |
| 178 | day-178-thinking-budget | Day 178 · 推理预算:thinking 档位怎么调、怎么算钱 | 档位;思考 token 计费 | 旧 134 中段 | 五种配置对比;每道练习的参考答案 |
| 179 | day-179-self-consistency | Day 179 · 不靠推理模型的老办法:自洽投票和 best-of-N | 投票;验证器 | 旧 134「不靠推理模型的老办法」「在 Agent 里用」 | 投票实验;每道练习的参考答案 |
| 180 | day-180-tool-design-1 | Day 180 · 好工具(一):工具不是 API,使用者变了 | ACI 视角 | 旧 11「工具不是 API」「一组能用但难用的工具」 | 难用工具清单;每道练习的参考答案 |
| 181 | day-181-week26-review | Day 181 · 第 26 周复习:工具与 Agent 循环(Day 175–180) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 182 | day-182-tool-design-2 | Day 182 · 好工具(二):六条原则 | 命名/描述/参数/返回/报错/粒度 | 旧 11「六条原则」 | 逐条改;每道练习的参考答案 |
| 183 | day-183-tool-design-3 | Day 183 · 好工具(三):改造前后实测 | 成功率对比 | 旧 11「改造后的版本」「怎么知道工具改好了」 | 前后对比;每道练习的参考答案 |
| 184 | day-184-tool-search-1 | Day 184 · 工具多了怎么办(一):先量一下 60 个工具有多贵 | token 账 | 旧 133「先量一下」「先试便宜的办法」 | 4539 vs 481;每道练习的参考答案 |
| 185 | day-185-tool-search-2 | Day 185 · 工具多了怎么办(二):自己实现工具检索和评测 | BM25/embedding 选工具;recall@k | 旧 133 后三节 + 旧 11「工具太多怎么办」 | recall 0.73 vs 1.00;每道练习的参考答案 |
| 186 | day-186-codeact-1 | Day 186 · 代码即动作(一):JSON 工具调用卡在哪,CodeAct 在说什么 | 中间结果过上下文 | 旧 132 前三节 | 每道练习的参考答案 |
| 187 | day-187-codeact-2 | Day 187 · 代码即动作(二):工具桥加子进程,两种做法实测 | 实现;沙箱边界 | 旧 132 后五节 | 两种做法对比;每道练习的参考答案 |
| 188 | day-188-week27-review | Day 188 · 第 27 周复习:工具与 Agent 循环(Day 182–187) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 189 | day-189-failures-1 | Day 189 · 失败模式(一):三层九类 | 失败分类 | 旧 12「失败的三层九类」 | 分类表;每道练习的参考答案 |
| 190 | day-190-failures-2 | Day 190 · 失败模式(二):重试和 tenacity | @retry 四参数 | 旧 12「重试」 | 429 重试测试;每道练习的参考答案 |
| 191 | day-191-failures-3 | Day 191 · 失败模式(三):工具超时和结果截断 | 线程池超时;截断 | 旧 12「工具超时与结果截断」 | 超时演示;每道练习的参考答案 |
| 192 | day-192-failures-4 | Day 192 · 失败模式(四):循环检测和预算收尾 | 重复检测;优雅结束 | 旧 12「循环检测」「预算与优雅收尾」 | 死循环拦截;每道练习的参考答案 |
| 193 | day-193-failures-5 | Day 193 · 失败模式(五):完整实现和假模型离线测试 | robust_agent;FakeClient | 旧 12「完整实现」「用假模型写离线测试」 | 5 个离线测试;每道练习的参考答案 |
| 194 | day-194-failures-6 | Day 194 · 失败模式(六):失败了要留下什么 | 结构化日志 | 旧 12「失败了要留下什么」 | 日志落盘;每道练习的参考答案 |
| 195 | day-195-week28-review | Day 195 · 第 28 周复习:工具与 Agent 循环(Day 189–194) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 196 | day-196-workflow-vs-agent | Day 196 · Workflow 还是 Agent:两个定义和一个构件 | 定义;增强型 LLM | 旧 13「两个定义和一个构件」「准备」 | wf_common.py;每道练习的参考答案 |
| 197 | day-197-chaining | Day 197 · 模式一:提示链 | chaining;门控 | 旧 13「模式一」 | wf1;每道练习的参考答案 |
| 198 | day-198-routing | Day 198 · 模式二:路由 | 分类分流 | 旧 13「模式二」 | wf2;每道练习的参考答案 |
| 199 | day-199-parallelization | Day 199 · 模式三:并行 | 分段;投票 | 旧 13「模式三」 | wf3;每道练习的参考答案 |
| 200 | day-200-orchestrator | Day 200 · 模式四:编排者-工作者 | 动态拆任务 | 旧 13「模式四」 | wf4;每道练习的参考答案 |
| 201 | day-201-evaluator | Day 201 · 模式五:评估者-优化者 | 生成-评估循环 | 旧 13「模式五」 | wf5;每道练习的参考答案 |
| 202 | day-202-week29-review | Day 202 · 第 29 周复习:工具与 Agent 循环(Day 196–201) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 203 | day-203-external-feedback | Day 203 · 用外部反馈做 reflection:让数据库当评估者 | 外部反馈 vs 自评 | B 节 wf5b_sql_feedback(旧 13 新增节) | 空结果 1/3 vs 带样例 5/5;每道练习的参考答案 |
| 204 | day-204-when-agent | Day 204 · 什么时候才需要真正的 Agent,框架和 ACI | 选择标准 | 旧 13 后两节 | 每道练习的参考答案 |
| 205 | day-205-cli-agent-1 | Day 205 · 小项目(一):命令行 Agent 骨架 | 项目结构;--no-package | 旧 14「本周小项目」前段 | cli-agent 初始化;每道练习的参考答案 |
| 206 | day-206-cli-agent-2 | Day 206 · 小项目(二):四个工具 | 天气/算数/读文件/搜网页 | 旧 14「特性」 | 工具单测;每道练习的参考答案 |
| 207 | day-207-cli-agent-3 | Day 207 · 小项目(三):实测八题和设计取舍 | 评测;取舍 | 旧 14「实测」「设计取舍」 | 8/8;每道练习的参考答案 |
| 208 | day-208-cli-agent-4 | Day 208 · 小项目(四):README、demo 动图和上 GitHub | 包装 | 旧 14 + cli-agent 实际经验 | demo.gif;每道练习的参考答案 |
| 209 | day-209-week30-review | Day 209 · 第 30 周复习:工具与 Agent 循环(Day 203–208) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 210 | day-210-coding-agent-1 | Day 210 · 用 Coding Agent 干活(一):AGENTS.md 和 CLAUDE.md | 指令文件 | 旧 135 前两节 | 给 cli-agent 写 AGENTS.md;每道练习的参考答案 |
| 211 | day-211-coding-agent-2 | Day 211 · 用 Coding Agent 干活(二):hooks、权限、无人值守和规格驱动 | hooks;headless;Spec Kit | 旧 135 后半 | 两个 hook 脚本;每道练习的参考答案 |

### 第四部分 · RAG 与上下文工程(Day 212–270,59 天)

| Day | slug | 标题 | 今天只讲的知识点 | 来源 | 要实跑的代码/数据 |
| --- | --- | --- | --- | --- | --- |
| 212 | day-212-why-vectors | Day 212 · 关键词搜索为什么不够 | 同义;语义 | 旧 15「关键词搜索为什么不够」 | grep 搜不到的例子;每道练习的参考答案 |
| 213 | day-213-vectors-2d | Day 213 · 向量是什么:先从二维说起 | 向量;距离 | 旧 15「向量是什么」 | 画二维点;每道练习的参考答案 |
| 214 | day-214-numpy-basics | Day 214 · numpy 够用版:数组、点积和范数 | ndarray;向量化运算 | 新写(为 embedding 铺垫) | numpy 小实验;每道练习的参考答案 |
| 215 | day-215-cosine | Day 215 · 余弦相似度:手算一遍 | 点积;归一化 | 旧 15「余弦相似度」 | 手算 + numpy 验算;每道练习的参考答案 |
| 216 | day-216-week31-review | Day 216 · 第 31 周复习:RAG 与上下文(Day 210–215) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 217 | day-217-embed-service | Day 217 · 选 embedding 服务,写 embed 函数 | bge-m3;批量 | 旧 15「选一个 embedding 服务」「写一个 embed 函数」 | w3/embed.py;每道练习的参考答案 |
| 218 | day-218-sim-matrix | Day 218 · 实验:一张相似度矩阵 | 矩阵读法 | 旧 15「实验」 | sim_matrix;每道练习的参考答案 |
| 219 | day-219-embed-limits | Day 219 · embedding 的两个短板:否定句和错误码 | 反例 | 旧 15「两个短板」 | 0.906/0.651 vs 0.799;每道练习的参考答案 |
| 220 | day-220-embed-cost | Day 220 · 维度、存储、花多少钱,怎么挑模型 | 成本;榜单 | 旧 15 最后两节 | 算 1 万篇成本;每道练习的参考答案 |
| 221 | day-221-why-rag | Day 221 · RAG 为什么存在:两条流水线 | 索引线/查询线 | 旧 16「RAG 为什么存在」「两条流水线」 | 每道练习的参考答案 |
| 222 | day-222-kb-data | Day 222 · 造一份数据:CloudLedger 帮助中心 | 文章结构 | 旧 16「先造一份数据」 | data/kb/;每道练习的参考答案 |
| 223 | day-223-week32-review | Day 223 · 第 32 周复习:RAG 与上下文(Day 217–222) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 224 | day-224-chunking | Day 224 · 切块:为什么切、怎么切 | 按标题;重叠 | 旧 16「切块」 | 42 块;每道练习的参考答案 |
| 225 | day-225-numpy-index | Day 225 · 建索引:向量存成 numpy 文件 | npy;load_chunks | 旧 16「建索引」 | 索引文件;每道练习的参考答案 |
| 226 | day-226-retrieve-answer | Day 226 · 检索和回答:top-k 拼进 prompt | top-k;引用 | 旧 16「检索和回答」 | w3/rag_numpy.py;每道练习的参考答案 |
| 227 | day-227-rag-prompt | Day 227 · RAG 的 prompt 讲究,和什么时候不用 RAG | 引用格式;拒答 | 旧 16 最后两节 | 拒答测试;每道练习的参考答案 |
| 228 | day-228-postgres-basics | Day 228 · Postgres 入门:装 Postgres.app、psql 和建库 | 和 SQLite 的区别 | 旧 17「起一个 pgvector」+ 陪学 Postgres.app 经验 | createdb agent60;每道练习的参考答案 |
| 229 | day-229-pgvector-1 | Day 229 · pgvector(一):为什么选它,扩展和建表 | vector 类型 | 旧 17「为什么我推荐 pgvector」「建表」 | CREATE EXTENSION;每道练习的参考答案 |
| 230 | day-230-week33-review | Day 230 · 第 33 周复习:RAG 与上下文(Day 224–229) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 231 | day-231-pgvector-2 | Day 231 · pgvector(二):写入和增量更新 | sha 去重;sync | 旧 17「写入和增量更新」 | pg_sync.py;每道练习的参考答案 |
| 232 | day-232-pgvector-3 | Day 232 · pgvector(三):把 RAG 接到数据库上 | SQL 向量检索;sql.Literal | 旧 17「把 RAG 接到数据库上」 | pg_store.search;每道练习的参考答案 |
| 233 | day-233-hnsw | Day 233 · HNSW:为什么快,为什么会漏 | 近似最近邻 | 旧 17「HNSW」 | 删 HNSW 前后;每道练习的参考答案 |
| 234 | day-234-filter-pitfall | Day 234 · 过滤的坑和向量库选型 | 先过滤还是后过滤;选型 | 旧 17 最后两节 | 结果变少复现;每道练习的参考答案 |
| 235 | day-235-bm25 | Day 235 · BM25:老派但好用的关键词检索 | 词频;停用词 | 旧 18「BM25」 | bm25_index.py;每道练习的参考答案 |
| 236 | day-236-rrf | Day 236 · RRF:把两路结果合起来 | 按名次融合 | 旧 18「RRF」 | fusion;每道练习的参考答案 |
| 237 | day-237-week34-review | Day 237 · 第 34 周复习:RAG 与上下文(Day 231–236) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 238 | day-238-rerank | Day 238 · Rerank:先粗筛再精排 | cross-encoder | 旧 18「Rerank」 | rerank;每道练习的参考答案 |
| 239 | day-239-query-rewrite | Day 239 · Query 改写 | 改写规则 | 旧 18「Query 改写」 | rewrite 两条规则;每道练习的参考答案 |
| 240 | day-240-retrieval-pipeline | Day 240 · 串成一条流水线,四种模式对比 | vector/bm25/hybrid/rerank | 旧 18「把它们串成一条流水线」 | 对比表;每道练习的参考答案 |
| 241 | day-241-contextual-retrieval | Day 241 · Contextual Retrieval:把上下文写进每一块 | 块前缀 | 旧 18「Contextual Retrieval」 | 前后对比;每道练习的参考答案 |
| 242 | day-242-pdf-text | Day 242 · 文档解析(一):PDF 文字层和表格 | pdfplumber;表格转 Markdown | 旧 18「上游:文档解析」前半 | doc_parse.py;每道练习的参考答案 |
| 243 | day-243-pdf-ocr | Day 243 · 文档解析(二):扫描件和 OCR | RapidOCR;Intel onnxruntime<1.23 | 旧 18「上游:文档解析」后半 | OCR 实跑;每道练习的参考答案 |
| 244 | day-244-week35-review | Day 244 · 第 35 周复习:RAG 与上下文(Day 238–243) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 245 | day-245-vision-1 | Day 245 · 多模态(一):模型怎么「看」图,第一次发图 | image_url;detail 档位 | 旧 136 前两节 | 716 vs 195 token;每道练习的参考答案 |
| 246 | day-246-vision-2 | Day 246 · 多模态(二):读 PDF 的三条路,账单抽取和对账 | 文字层/OCR/VLM | 旧 136「读 PDF 的三条路」「账单抽取和对账」 | 改合计 89 的账单;每道练习的参考答案 |
| 247 | day-247-vision-3 | Day 247 · 多模态(三):截图进检索,解析工具和多模态 RAG | 截图→检索词;ColPali | 旧 136 后四节 | kb-011 命中;每道练习的参考答案 |
| 248 | day-248-code-retrieval | Day 248 · 代码库检索:AST 切块和 repo map | 代码不能按字数切 | 旧 18「代码库检索」 | code_chunks.py;每道练习的参考答案 |
| 249 | day-249-rlm | Day 249 · 递归语言模型 RLM:另一种处理超长输入的思路 | RLM vs RAG | B 节 RLM(旧 18 新增段) | 每道练习的参考答案 |
| 250 | day-250-kg-basics | Day 250 · 知识图谱三分钟入门:实体、关系和三元组 | 三元组 | 旧 137 前两节 | 每道练习的参考答案 |
| 251 | day-251-week36-review | Day 251 · 第 36 周复习:RAG 与上下文(Day 245–250) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 252 | day-252-graphrag-extract | Day 252 · GraphRAG(一):用大模型抽三元组 | 抽取;方向错误 | 旧 137「GraphRAG 的两种检索」「第一步」 | 抽取实跑;每道练习的参考答案 |
| 253 | day-253-graphrag-local | Day 253 · GraphRAG(二):local search 和混合检索比一比 | 图检索;对比 | 旧 137「第二步」「第三步」 | 6/9 vs 8/9;每道练习的参考答案 |
| 254 | day-254-graphrag-global | Day 254 · GraphRAG(三):社区摘要和 global search | 社区;全局汇总 | 旧 137「第四步」及之后 | 3/22→12/20;每道练习的参考答案 |
| 255 | day-255-rag-eval-1 | Day 255 · RAG 评估(一):为什么分两层 | 检索/生成两层 | 旧 19「为什么要分两层」 | 每道练习的参考答案 |
| 256 | day-256-rag-eval-2 | Day 256 · RAG 评估(二):手算三个检索指标 | recall/precision/MRR | 旧 19「检索指标」 | 手算;每道练习的参考答案 |
| 257 | day-257-rag-eval-3 | Day 257 · RAG 评估(三):建 30 条评估集,五种题型 | 评估集 | 旧 19「建评估集」 | make_eval_set;每道练习的参考答案 |
| 258 | day-258-week37-review | Day 258 · 第 37 周复习:RAG 与上下文(Day 252–257) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 259 | day-259-rag-eval-4 | Day 259 · RAG 评估(四):检索评估脚本 | eval_retrieval | 旧 19「检索评估脚本」 | vector 1.0/hybrid 0.923;每道练习的参考答案 |
| 260 | day-260-rag-eval-5 | Day 260 · RAG 评估(五):生成评估,让大模型当裁判 | 忠实/完整/拒答 | 旧 19「生成评估」 | eval_generation;每道练习的参考答案 |
| 261 | day-261-rag-eval-6 | Day 261 · RAG 评估(六):用评估集做实验,RAGAS 和其他框架 | 实验;框架 | 旧 19 最后两节 | 一次实验;每道练习的参考答案 |
| 262 | day-262-context-budget | Day 262 · 上下文工程(一):窗口大不等于该塞满,做预算 | 预算 | 旧 20「窗口大」「给上下文做预算」 | 预算表;每道练习的参考答案 |
| 263 | day-263-compaction | Day 263 · 上下文工程(二):压缩,别直接丢,先总结 | 总结压缩;keep_last_turns | 旧 20「压缩」 | compaction.py;每道练习的参考答案 |
| 264 | day-264-memory-short-long | Day 264 · 上下文工程(三):短期记忆和长期记忆 | user_memories 表 | 旧 20「记忆」 | 记忆写入读取;每道练习的参考答案 |
| 265 | day-265-week38-review | Day 265 · 第 38 周复习:RAG 与上下文(Day 259–264) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 266 | day-266-agentic-rag | Day 266 · Agentic RAG:让 Agent 自己决定查不查 | 检索当工具 | 旧 20「Agentic RAG」 | 真实轨迹三例;每道练习的参考答案 |
| 267 | day-267-subagent-isolation | Day 267 · 隔离:把翻资料的脏活交给子 Agent,harness 这一层 | subagent;harness | 旧 20「隔离」「Agent Harness」 | subagent 演示;每道练习的参考答案 |
| 268 | day-268-docqa-1 | Day 268 · 小项目(一):文档问答 Agent 骨架和检索 | 整合检索 | 旧 21「小项目」前段 | docqa.py;每道练习的参考答案 |
| 269 | day-269-docqa-2 | Day 269 · 小项目(二):引用出处和拒答校准 | 引用;calibrate | 旧 21「小项目」后段 | calibrate;每道练习的参考答案 |
| 270 | day-270-docqa-3 | Day 270 · 小项目(三):知识地图、面试题和坑清单 | 复盘 | 旧 21 后三节 | 每道练习的参考答案 |

### 第五部分 · MCP、编排框架与多 Agent(Day 271–340,70 天)

| Day | slug | 标题 | 今天只讲的知识点 | 来源 | 要实跑的代码/数据 |
| --- | --- | --- | --- | --- | --- |
| 271 | day-271-mcp-why | Day 271 · MCP 是什么:每个应用都在重复接线 | 痛点 | 旧 22「先说痛点」 | 每道练习的参考答案 |
| 272 | day-272-week39-review | Day 272 · 第 39 周复习:MCP 与编排(Day 266–271) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 273 | day-273-mcp-roles | Day 273 · 三个角色:host、client、server | 角色分工 | 旧 22「三个角色」 | 每道练习的参考答案 |
| 274 | day-274-mcp-primitives | Day 274 · server 能给的三样东西:tools、resources、prompts | 三种原语 | 旧 22「server 能给的三样东西」 | 每道练习的参考答案 |
| 275 | day-275-json-rpc | Day 275 · 线上传的是什么:JSON-RPC | 请求/响应/通知 | 旧 22「线上传的是什么」 | peek_time_server.py;每道练习的参考答案 |
| 276 | day-276-mcp-transports | Day 276 · 两种传输:stdio 和 Streamable HTTP | 进程管道 vs HTTP | 旧 22「两种传输」 | stdio 抓包;每道练习的参考答案 |
| 277 | day-277-mcp-spec-2026 | Day 277 · 2026-07-28 版规范改了什么 | Mcp-Method 头;Tasks;ttlMs;废弃项 | 旧 22「2026-07-28 版规范还改了什么」 | curl 演示 400/200;每道练习的参考答案 |
| 278 | day-278-mcp-vs-fc | Day 278 · MCP 和 function calling 的关系,2026 年的生态 | 关系;何时不值得写 | 旧 22 最后两节 | 每道练习的参考答案 |
| 279 | day-279-week40-review | Day 279 · 第 40 周复习:MCP 与编排(Day 273–278) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 280 | day-280-mcp-seed | Day 280 · 写 MCP server(一):先把 CloudLedger 业务库造出来 | seed.py;表结构 | 旧 23「先把数据造出来」 | w4/cloudledger/seed.py;每道练习的参考答案 |
| 281 | day-281-mcp-first-tool | Day 281 · 写 MCP server(二):第一个工具,一个函数加一个装饰器 | @mcp.tool | 旧 23「第一个工具」 | get_customer;每道练习的参考答案 |
| 282 | day-282-mcp-errors | Day 282 · 写 MCP server(三):出错时让模型看得懂 | 错误信息设计 | 旧 23「出错时让模型看得懂」 | 故意查不存在的客户;每道练习的参考答案 |
| 283 | day-283-mcp-read-write | Day 283 · 写 MCP server(四):读和写要分开对待 | 写操作确认 | 旧 23「读和写要分开对待」 | 退款工具;每道练习的参考答案 |
| 284 | day-284-mcp-resource-prompt | Day 284 · 写 MCP server(五):resource 和 prompt,完整的 server | resource;prompt | 旧 23「resource 和 prompt」「完整的 server」 | 完整 server;每道练习的参考答案 |
| 285 | day-285-mcp-inspector | Day 285 · 写 MCP server(六):在 Inspector 里调试 | Inspector(node) | 旧 23「在 Inspector 里调试」 | Inspector 实操;每道练习的参考答案 |
| 286 | day-286-week41-review | Day 286 · 第 41 周复习:MCP 与编排(Day 280–285) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 287 | day-287-mcp-test | Day 287 · 写 MCP server(七):用内存客户端写测试 | 内存传输 | 旧 23「用内存客户端写测试」 | pytest;每道练习的参考答案 |
| 288 | day-288-mcp-client | Day 288 · 写 MCP server(八):不接模型,先写一个最小 client | ClientSession | 旧 23「不接模型,先写一个最小 client」 | w4/mcp_probe.py;每道练习的参考答案 |
| 289 | day-289-mcp-host | Day 289 · 写 MCP server(九):接进现成 host,自己当 host | Claude Code/Desktop;接手写循环 | 旧 23「接进现成的 host」「自己当 host」 | 接入 agent_loop;每道练习的参考答案 |
| 290 | day-290-mcp-remote | Day 290 · 写 MCP server(十):远程 server、鉴权和 Gradio 公网演示 | 远程;鉴权;演示版 | 旧 23 最后两节 | Gradio 演示版;每道练习的参考答案 |
| 291 | day-291-text-to-sql-1 | Day 291 · 问数 Agent(一):给模型一份库说明书 | schema 描述;术语表 | 旧 138 前两节 | 说明书生成;每道练习的参考答案 |
| 292 | day-292-text-to-sql-2 | Day 292 · 问数 Agent(二):三道闸,让 SQL 只读、跑得完 | sqlglot;只读;超时 | 旧 138「第二步」 | 注入被拦;每道练习的参考答案 |
| 293 | day-293-week42-review | Day 293 · 第 42 周复习:MCP 与编排(Day 287–292) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 294 | day-294-text-to-sql-3 | Day 294 · 问数 Agent(三):问数循环和 10 道题评测 | 自修循环;评测 | 旧 138「第三步」「第四步」 | 7/10→10/10;每道练习的参考答案 |
| 295 | day-295-text-to-sql-4 | Day 295 · 问数 Agent(四):表多了怎么办,语义层和基准 | schema 检索;BIRD/Spider | 旧 138 后两节 | 每道练习的参考答案 |
| 296 | day-296-skills-1 | Day 296 · Agent Skills(一):Skill 是什么,写一个退款 skill | SKILL.md 结构 | 旧 131 前两节 + 旧 27「Agent Skills」 | 退款 skill;每道练习的参考答案 |
| 297 | day-297-skills-2 | Day 297 · Agent Skills(二):在 Claude Code 里跑,在自己的循环里实现加载器 | 渐进加载;token 对比 | 旧 131 后半 | 72/192/712/1437;每道练习的参考答案 |
| 298 | day-298-langchain-vs-langgraph | Day 298 · LangChain 和 LangGraph 是什么关系 | 定位;create_agent | 旧 24「先说清楚」 | 每道练习的参考答案 |
| 299 | day-299-lg-one-node | Day 299 · LangGraph(一):只有一个节点的图 | 骨架六步 | 旧 24「先慢下来」第 1 步 | s01;每道练习的参考答案 |
| 300 | day-300-week43-review | Day 300 · 第 43 周复习:MCP 与编排(Day 294–299) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 301 | day-301-lg-sequence | Day 301 · LangGraph(二):两个节点串起来,用 stream 看每一步 | add_sequence;stream updates | 旧 24 第 2 步 | s02;每道练习的参考答案 |
| 302 | day-302-lg-state-styles | Day 302 · LangGraph(三):State 的三种写法 | TypedDict/dataclass/pydantic | 旧 24 第 3 步 | s03;每道练习的参考答案 |
| 303 | day-303-lg-overwrite | Day 303 · LangGraph(四):不加 reducer 会被覆盖 | 覆盖规则 | 旧 24「四个概念」reducer 段 + 第 4 步 | s04;每道练习的参考答案 |
| 304 | day-304-lg-reducer | Day 304 · LangGraph(五):reducer 和 add_messages | operator.add;按 id 替换 | 旧 24 第 5 步 | s05;每道练习的参考答案 |
| 305 | day-305-lg-parallel | Day 305 · LangGraph(六):并行节点和扇入 | 扇出扇入;InvalidUpdateError | 旧 24 第 6 步 | s06;每道练习的参考答案 |
| 306 | day-306-lg-conditional | Day 306 · LangGraph(七):条件边和 path_map | 路由函数 | 旧 24 第 7 步 | s07;每道练习的参考答案 |
| 307 | day-307-week44-review | Day 307 · 第 44 周复习:MCP 与编排(Day 301–306) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 308 | day-308-lg-loop | Day 308 · LangGraph(八):循环和 recursion_limit | 循环边;GraphRecursionError | 旧 24 第 8 步 | s08;每道练习的参考答案 |
| 309 | day-309-lg-command | Day 309 · LangGraph(九):Command,改状态和指定下一站 | update+goto | 旧 24 第 9 步 | s09;每道练习的参考答案 |
| 310 | day-310-lg-send-draw | Day 310 · LangGraph(十):Send 动态并行和画图 | map-reduce;mermaid | 旧 24 第 10–11 步 | s10、s11;每道练习的参考答案 |
| 311 | day-311-lg-agent-loop | Day 311 · LangGraph(十一):用图重写 Agent 循环 | llm/tools 节点;route | 旧 24「用图重写 Day 9 的 Agent 循环」 | agent_graph.py;每道练习的参考答案 |
| 312 | day-312-lg-workflow | Day 312 · LangGraph(十二):没有循环的工作流和结构化输出路由 | 分类分支 | 旧 24「第二张图」 | ticket_flow.py;每道练习的参考答案 |
| 313 | day-313-lg-compiled | Day 313 · LangGraph(十三):图编译之后是什么,什么时候值得用 | Pregel 超步;选择标准 | 旧 24「图编译之后是什么」「什么时候值得用」 | 每道练习的参考答案 |
| 314 | day-314-week45-review | Day 314 · 第 45 周复习:MCP 与编排(Day 308–313) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 315 | day-315-lg-checkpoint-why | Day 315 · LangGraph(十四):没有 checkpoint 会怎样 | 进程一退全没 | 旧 25「没有 checkpoint 会怎样」 | 演示丢状态;每道练习的参考答案 |
| 316 | day-316-lg-checkpointer | Day 316 · LangGraph(十五):checkpointer 和 thread_id | 同线程接着跑/换线程从头 | 旧 25「三个必需品」+ 玩具图对应步 | 玩具图;每道练习的参考答案 |
| 317 | day-317-lg-state-history | Day 317 · LangGraph(十六):get_state 和历史快照 | 快照;history | 旧 25 玩具图对应步 | 玩具图;每道练习的参考答案 |
| 318 | day-318-lg-sqlite-saver | Day 318 · LangGraph(十七):SqliteSaver,进程重启后续跑 | 持久化后端 | 旧 25「跑一遍,中间退出进程」+ 玩具图 | kill 后续跑;每道练习的参考答案 |
| 319 | day-319-lg-interrupt | Day 319 · LangGraph(十八):interrupt 和 Command(resume) | 暂停/恢复;节点重跑 | 旧 25 玩具图 interrupt 步 | 玩具图;每道练习的参考答案 |
| 320 | day-320-lg-refund-approval | Day 320 · LangGraph(十九):实现退款审批 | 审批图 | 旧 25「实现退款审批」 | 退款审批图;每道练习的参考答案 |
| 321 | day-321-week46-review | Day 321 · 第 46 周复习:MCP 与编排(Day 315–320) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 322 | day-322-lg-time-travel | Day 322 · LangGraph(二十):时间旅行,回到审批前重来 | fork;update_state | 旧 25「时间旅行」 | 分叉重跑;每道练习的参考答案 |
| 323 | day-323-lg-stream-modes | Day 323 · LangGraph(二十一):三种 stream_mode | updates/values/messages | 旧 25「流式输出」 | 三种输出对比;每道练习的参考答案 |
| 324 | day-324-lg-subgraph | Day 324 · LangGraph(二十二):子图,把一段流程封装起来 | 子图;持久化策略 | 旧 25「子图」「放到真实系统里」 | 子图演示;每道练习的参考答案 |
| 325 | day-325-ambient-1 | Day 325 · 后台 Agent(一):聊天窗口之外,三种触发源,事件表 | webhook/邮件/cron;去重 | 旧 139 前四节 | 事件表;每道练习的参考答案 |
| 326 | day-326-ambient-2 | Day 326 · 后台 Agent(二):webhook 入口、处理图和 worker | 幂等;图 | 旧 139 中段 | webhook→图;每道练习的参考答案 |
| 327 | day-327-ambient-3 | Day 327 · 后台 Agent(三):收件箱式审批 | Agent Inbox | 旧 139「第五层:收件箱」及之后 | 收件箱;每道练习的参考答案 |
| 328 | day-328-week47-review | Day 328 · 第 47 周复习:MCP 与编排(Day 322–327) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 329 | day-329-multi-agent-1 | Day 329 · 多 Agent(一):两篇吵架的文章,多 Agent 带来什么 | 取舍 | 旧 26 前两节 | 每道练习的参考答案 |
| 330 | day-330-multi-agent-2 | Day 330 · 多 Agent(二):主管派活 | orchestrator-worker | 旧 26「拓扑一」 | 主管拓扑实跑;每道练习的参考答案 |
| 331 | day-331-multi-agent-3 | Day 331 · 多 Agent(三):专员交接 handoff | handoff | 旧 26「拓扑二」「其他几种模式」 | 交接实跑;每道练习的参考答案 |
| 332 | day-332-multi-agent-4 | Day 332 · 多 Agent(四):subagent 是为了省上下文,什么时候不该用多 Agent | 上下文隔离;反模式 | 旧 26「Subagent」「什么时候不该用」 | 每道练习的参考答案 |
| 333 | day-333-frameworks-1 | Day 333 · 框架横评(一):先分层,同一个任务三种框架 | 分层比较 | 旧 27「先分层」「同一个任务」 | 同任务三种实现;每道练习的参考答案 |
| 334 | day-334-frameworks-2 | Day 334 · 框架横评(二):2026-10 版本现状和面试三题 | ADK/MS Agent Framework/Pydantic AI/LangGraph 1.2 | 旧 27 B 节框架状态表 +「面试最难的那三题」 | 每道练习的参考答案 |
| 335 | day-335-week48-review | Day 335 · 第 48 周复习:MCP 与编排(Day 329–334) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 336 | day-336-low-code-1 | Day 336 · 低代码平台(一):Dify、扣子、百炼、n8n 现状,同一流程画 vs 写 | 平台现状 | 旧 140 前三节 | Dify 搭一遍;每道练习的参考答案 |
| 337 | day-337-low-code-2 | Day 337 · 低代码平台(二):接自有系统、跑评测,什么时候改成写代码 | 决策表 | 旧 140 后四节 | 平台应用评测;每道练习的参考答案 |
| 338 | day-338-router-project-1 | Day 338 · 小项目(一):工单分流 Agent 设计和 MCP 工具 | 整合 | 旧 28「小项目」前段 | 工具就绪;每道练习的参考答案 |
| 339 | day-339-router-project-2 | Day 339 · 小项目(二):LangGraph 主流程和审批 | 整合 | 旧 28「小项目」后段 | 端到端;每道练习的参考答案 |
| 340 | day-340-router-project-3 | Day 340 · 小项目(三):知识地图和坑清单 | 复盘 | 旧 28 其余 | 每道练习的参考答案 |

### 第六部分 · 评测与可观测(Day 341–377,37 天)

| Day | slug | 标题 | 今天只讲的知识点 | 来源 | 要实跑的代码/数据 |
| --- | --- | --- | --- | --- | --- |
| 341 | day-341-why-evals | Day 341 · 为什么评测是分水岭:「我试过了挺好的」不算数 | 评测的意义 | 旧 29 前两节 | 每道练习的参考答案 |
| 342 | day-342-week49-review | Day 342 · 第 49 周复习:评测与可观测(Day 336–341) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 343 | day-343-eval-pyramid | Day 343 · 评测金字塔:三层,越往上越贵 | 规则/模型/人工 | 旧 29「评测金字塔」 | 每道练习的参考答案 |
| 344 | day-344-eval-concepts | Day 344 · 几组概念一次分清,评测驱动开发 | 离线/在线/回归;EDD | 旧 29 后两节 | 每道练习的参考答案 |
| 345 | day-345-error-analysis-1 | Day 345 · 错误分析(一):为什么不能跳过,流程长什么样 | 开放编码 | 旧 30「为什么不能跳过」「整个流程」 | 读 30 条 trace;每道练习的参考答案 |
| 346 | day-346-error-analysis-2 | Day 346 · 错误分析(二):第一遍标注的规矩和标注页 | 标注规矩;Streamlit 标注页 | 旧 30「第一遍标注的几条规矩」 | 标注页实跑;每道练习的参考答案 |
| 347 | day-347-error-analysis-3 | Day 347 · 错误分析(三):给失败分类、数数、定优先级 | 轴向编码;计数 | 旧 30 后半 | 分类计数表;每道练习的参考答案 |
| 348 | day-348-testcase-structure | Day 348 · 测试集(一):一条用例里该有什么 | 输入/期望/元数据 | 旧 31「一条用例里该有什么」 | 用例 JSONL;每道练习的参考答案 |
| 349 | day-349-week50-review | Day 349 · 第 50 周复习:评测与可观测(Day 343–348) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 350 | day-350-judge-code | Day 350 · 测试集(二):期望值从哪来,写一个判题器 | 判题器 | 旧 31「期望值从哪来」 | judge.py;每道练习的参考答案 |
| 351 | day-351-synthetic-data | Day 351 · 测试集(三):维度组合生成合成数据 | 维度 tuple 两步法 | 旧 31「合成数据」 | synth.py;每道练习的参考答案 |
| 352 | day-352-adversarial-cases | Day 352 · 测试集(四):边界和对抗用例手写 | 边界;对抗 | 旧 31「边界和对抗用例」 | 10 条对抗用例;每道练习的参考答案 |
| 353 | day-353-stats-intuition | Day 353 · 统计直觉(够用版):平均数、方差、抽样误差和置信区间 | 区间直觉 | 新写(为测试集规模和评测统计铺垫) | 抛硬币模拟;每道练习的参考答案 |
| 354 | day-354-testset-size | Day 354 · 测试集(五):要多大,开发集和留出集 | 样本量算式;防过拟合 | 旧 31 后两节 | 算样本量;每道练习的参考答案 |
| 355 | day-355-llm-judge-1 | Day 355 · LLM-as-judge(一):什么时候需要 | 适用场景 | 旧 32「什么时候需要」 | 每道练习的参考答案 |
| 356 | day-356-week51-review | Day 356 · 第 51 周复习:评测与可观测(Day 350–355) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 357 | day-357-llm-judge-2 | Day 357 · LLM-as-judge(二):评分 prompt 怎么写 | 判定标准;例子 | 旧 32「评分 prompt 怎么写」 | judge prompt;每道练习的参考答案 |
| 358 | day-358-llm-judge-3 | Day 358 · LLM-as-judge(三):和人工对齐,TPR、TNR 和 kappa | 对齐集;修正通过率 | 旧 32「对齐」+ B 节标注工具 | 对齐实验;每道练习的参考答案 |
| 359 | day-359-llm-judge-4 | Day 359 · LLM-as-judge(四):偏差和成本 | 位置/长度偏差 | 旧 32「偏差」「成本」 | 交换顺序实验;每道练习的参考答案 |
| 360 | day-360-trajectory-1 | Day 360 · 轨迹评测(一):结果和轨迹各管什么 | 结果 vs 轨迹 | 旧 33「结果和轨迹」 | 每道练习的参考答案 |
| 361 | day-361-trajectory-2 | Day 361 · 轨迹评测(二):四种匹配模式和轨迹检查 | strict/unordered/subset/superset | 旧 33「四种模式」「写轨迹检查」 | 轨迹检查;每道练习的参考答案 |
| 362 | day-362-simulated-user | Day 362 · 轨迹评测(三):多轮,写一个模拟客户 | 模拟用户 | 旧 33「多轮」 | 模拟客户 5 轮;每道练习的参考答案 |
| 363 | day-363-week52-review | Day 363 · 第 52 周复习:评测与可观测(Day 357–362) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 364 | day-364-tracing-concepts | Day 364 · Tracing(一):trace、span 和概念对齐 | trace/span | 旧 34「先把概念对齐」 | 每道练习的参考答案 |
| 365 | day-365-langfuse | Day 365 · Tracing(二):半小时接入 Langfuse | 云版 vs 自托管 | 旧 34「选 Langfuse」「第一部分」 | Langfuse 接入;每道练习的参考答案 |
| 366 | day-366-otel-spans | Day 366 · Tracing(三):自己用 OpenTelemetry 打 span | OTel SDK | 旧 34「第二部分」 | otel span 实跑;每道练习的参考答案 |
| 367 | day-367-tracing-views | Day 367 · Tracing(四):看什么视图,隐私和合规 | 有用视图;脱敏 | 旧 34 最后两节 | 每道练习的参考答案 |
| 368 | day-368-prompt-opt-1 | Day 368 · 自动优化提示词(一):手调的天花板,DSPy、GEPA、ACE 是什么 | 三个名字 | 旧 143 前三节 | 每道练习的参考答案 |
| 369 | day-369-prompt-opt-2 | Day 369 · 自动优化提示词(二):自己写反思循环,用 DSPy 跑 GEPA | 反思优化 | 旧 143「自己写一个反思循环」「用 DSPy 跑 GEPA」 | 60 条工单前后;每道练习的参考答案 |
| 370 | day-370-week53-review | Day 370 · 第 53 周复习:评测与可观测(Day 364–369) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 371 | day-371-prompt-opt-3 | Day 371 · 自动优化提示词(三):ACE 和怎么上生产 | 增量手册 | 旧 143 后三节 | 对比表;每道练习的参考答案 |
| 372 | day-372-feedback-1 | Day 372 · 反馈闭环(一):显式和隐式反馈怎么采 | 点赞/改写/转人工 | 旧 144 前半 | 反馈表;每道练习的参考答案 |
| 373 | day-373-feedback-2 | Day 373 · 反馈闭环(二):badcase 分诊、聚类、进测试集 | 数据飞轮 | 旧 144 后半 | 聚类实跑;每道练习的参考答案 |
| 374 | day-374-eval-project-1 | Day 374 · 小项目(一):给工单 Agent 搭完整评测系统 | 三层评测整合 | 旧 35「小项目」前段 | 评测报告;每道练习的参考答案 |
| 375 | day-375-eval-project-2 | Day 375 · 小项目(二):CI 回归门禁 | GitHub Actions;阈值 | 旧 35「小项目」后段 | PR 上跑门禁;每道练习的参考答案 |
| 376 | day-376-eval-project-3 | Day 376 · 小项目(三):面试题和坑清单 | 复盘 | 旧 35 面试题与坑清单 | 每道练习的参考答案 |
| 377 | day-377-week54-review | Day 377 · 第 54 周复习:评测与可观测(Day 371–376) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |

### 第七部分 · 生产化与安全(Day 378–434,57 天)

| Day | slug | 标题 | 今天只讲的知识点 | 来源 | 要实跑的代码/数据 |
| --- | --- | --- | --- | --- | --- |
| 378 | day-378-agent-api | Day 378 · 把 Agent 做成服务:Agent 接口和普通接口差在哪 | 长任务;流式 | 旧 36「先想清楚」 | 每道练习的参考答案 |
| 379 | day-379-sse-server | Day 379 · SSE 服务端怎么写,为什么不用 WebSocket | StreamingResponse | 旧 36「SSE 是什么」 | FastAPI SSE 最小例子;每道练习的参考答案 |
| 380 | day-380-event-protocol | Day 380 · 设计事件协议:前端到底需要知道什么 | token/工具/审批事件 | 旧 36「设计事件协议」 | events.py;每道练习的参考答案 |
| 381 | day-381-service-skeleton | Day 381 · 搭服务骨架和事件模型 | 项目结构 | 旧 36「搭项目骨架」「事件模型」 | 骨架跑通;每道练习的参考答案 |
| 382 | day-382-langgraph-adapter | Day 382 · 适配层:把 LangGraph 输出翻译成事件 | astream_events→SSE | 旧 36「适配层」「主程序」 | curl 看事件流;每道练习的参考答案 |
| 383 | day-383-redis-basics | Day 383 · Redis 入门:键值、过期和常用命令 | ≈服务端的 localStorage | 新写(为会话管理铺垫) | redis-cli;每道练习的参考答案 |
| 384 | day-384-week55-review | Day 384 · 第 55 周复习:生产化与安全(Day 378–383) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 385 | day-385-session-mgmt | Day 385 · 会话管理:存什么、存在哪 | Redis vs Postgres | 旧 36「会话管理」 | 会话存取;每道练习的参考答案 |
| 386 | day-386-concurrency | Day 386 · 并发:一个进程扛得住多少人,第一次压测 | uvicorn workers;压测 | 旧 36「前端:60 行看到效果」「跑起来」「并发」 | 压测;每道练习的参考答案 |
| 387 | day-387-queue-basics | Day 387 · 队列是什么:什么样的活要进队列 | 生产者/消费者 | 旧 37「什么样的活要进队列」「选哪个队列」 | 每道练习的参考答案 |
| 388 | day-388-arq | Day 388 · arq 快速上手 | worker;任务 | 旧 37「arq 快速上手」 | arq worker;每道练习的参考答案 |
| 389 | day-389-retry-errors | Day 389 · 重试:先分清哪些错误值得重试 | 可重试错误 | 旧 37「重试」 | 分类测试;每道练习的参考答案 |
| 390 | day-390-idempotency | Day 390 · 至少执行一次和幂等 | 幂等键 | 旧 37「至少执行一次」 | 重复投递实验;每道练习的参考答案 |
| 391 | day-391-week56-review | Day 391 · 第 56 周复习:生产化与安全(Day 385–390) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 392 | day-392-timeouts | Day 392 · 超时:每一层都要有,而且要比上一层短 | 超时分层 | 旧 37「超时」 | 超时链实验;每道练习的参考答案 |
| 393 | day-393-resume | Day 393 · 断点续跑:让崩在半路的任务接着跑 | 检查点 | 旧 37「断点续跑」 | kill worker 后续跑;每道练习的参考答案 |
| 394 | day-394-ticket-worker | Day 394 · 工单处理 worker,上线和扩容 | 整合;扩容 | 旧 37「把它们拼起来」「worker 怎么上线」 | ticket worker;每道练习的参考答案 |
| 395 | day-395-temporal | Day 395 · Temporal 和持久化执行 | durable execution | 旧 37「Temporal」 | 每道练习的参考答案 |
| 396 | day-396-cost-1 | Day 396 · 成本(一):一张工单花多少钱 | 成本拆解 | 旧 38「先算账」 | 单工单账单;每道练习的参考答案 |
| 397 | day-397-prompt-caching | Day 397 · 成本(二):prompt caching 原理和命中规矩 | 前缀稳定 | 旧 38「Prompt caching」 | 命中率对比;每道练习的参考答案 |
| 398 | day-398-week57-review | Day 398 · 第 57 周复习:生产化与安全(Day 392–397) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 399 | day-399-model-routing | Day 399 · 成本(三):模型路由 | 大小模型分工 | 旧 38「模型路由」 | 路由实验;每道练习的参考答案 |
| 400 | day-400-advisor | Day 400 · 成本(四):Advisor 模式,便宜模型执行强模型顾问 | advisor tool | B 节 Advisor(旧 38 新增节) | Pydantic AI advisor 实跑;每道练习的参考答案 |
| 401 | day-401-latency | Day 401 · 延迟:时间花在哪 | 延迟拆解 | 旧 38「延迟」 | 分段计时;每道练习的参考答案 |
| 402 | day-402-batch-cache-roi | Day 402 · 批处理、语义缓存和 Agent 经济学 | 批处理;ROI | 旧 38 最后两节 | ROI 表;每道练习的参考答案 |
| 403 | day-403-injection-1 | Day 403 · 安全(一):注入的本质,直接和间接注入 | 指令与数据混在一条通道 | 旧 39 前两节 | 每道练习的参考答案 |
| 404 | day-404-lethal-trifecta | Day 404 · 安全(二):致命三要素 | 私有数据+不可信内容+外发 | 旧 39「致命三要素」 | 每道练习的参考答案 |
| 405 | day-405-week58-review | Day 405 · 第 58 周复习:生产化与安全(Day 399–404) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 406 | day-406-attack-yourself | Day 406 · 安全(三):先打一遍自己的 Agent | 攻击用例 | 旧 39「先打一遍」 | 注入测试集;每道练习的参考答案 |
| 407 | day-407-defense-layers | Day 407 · 安全(四):四层防御 | 架构/工具/标记/输出 | 旧 39 四个「防御」节 | 逐层验证;每道练习的参考答案 |
| 408 | day-408-injection-tests | Day 408 · 安全(五):更彻底的设计模式,把攻击变成测试 | 设计模式;回归 | 旧 39 最后两节 | 注入回归;每道练习的参考答案 |
| 409 | day-409-guardrails-1 | Day 409 · Guardrails(一):管什么,三种检查器 | 规则/分类器/LLM | 旧 145 前三节 | 每道练习的参考答案 |
| 410 | day-410-guardrails-2 | Day 410 · Guardrails(二):动手做三层,延迟预算和流式 | 误杀/漏放 | 旧 145 后四节 | 三层实测;每道练习的参考答案 |
| 411 | day-411-permissions-1 | Day 411 · 权限(一):过度授权的账和工具分级 | 分级 | 旧 40「先算清楚」「工具分级」 | 权限检查代码;每道练习的参考答案 |
| 412 | day-412-week59-review | Day 412 · 第 59 周复习:生产化与安全(Day 406–411) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 413 | day-413-least-privilege | Day 413 · 权限(二):最小权限落到凭证上 | 凭证 | 旧 40「最小权限」 | 只读账号;每道练习的参考答案 |
| 414 | day-414-approval-design | Day 414 · 权限(三):不会变成橡皮图章的审批 | 人工确认设计 | 旧 40「人工确认」 | 审批流程;每道练习的参考答案 |
| 415 | day-415-sandbox | Day 415 · 权限(四):沙箱,当 Agent 要执行代码 | 容器;E2B | 旧 40「沙箱」 | 沙箱跑代码;每道练习的参考答案 |
| 416 | day-416-pii-audit | Day 416 · 权限(五):数据脱敏和审计日志,对照 OWASP | PII;审计 | 旧 40 后四节 | 脱敏函数测试;每道练习的参考答案 |
| 417 | day-417-supply-chain-1 | Day 417 · 供应链安全(一):你装的是会跟模型说话的代码 | 事件;模型多听工具描述 | 旧 146 前三节 | 描述影响实验;每道练习的参考答案 |
| 418 | day-418-supply-chain-2 | Day 418 · 供应链安全(二):指纹、扫描、来源和最小影响 | rug pull 防线 | 旧 146 后五节 | 指纹代理;每道练习的参考答案 |
| 419 | day-419-week60-review | Day 419 · 第 60 周复习:生产化与安全(Day 413–418) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 420 | day-420-linux-1 | Day 420 · Linux 服务器(一):云服务器、SSH 和用户 | SSH key;sudo | 新写 | SSH 登上一台服务器;每道练习的参考答案 |
| 421 | day-421-linux-2 | Day 421 · Linux 服务器(二):进程、端口、systemd 和日志 | 守护进程;journalctl | 新写 | systemd 托管一个服务;每道练习的参考答案 |
| 422 | day-422-dockerfile-prod | Day 422 · 部署(一):Dockerfile 小、快、不用 root | 多阶段;非 root | 旧 41「Dockerfile」 | 镜像体积对比;每道练习的参考答案 |
| 423 | day-423-compose-prod | Day 423 · 部署(二):compose 拉起整个系统 | app+postgres+langfuse | 旧 41「Compose」 | compose up;每道练习的参考答案 |
| 424 | day-424-secrets-mgmt | Day 424 · 部署(三):密钥管理 | 环境变量;密钥服务 | 旧 41「密钥管理」 | 每道练习的参考答案 |
| 425 | day-425-deploy-route | Day 425 · 部署(四):选一条部署路线,HTTPS | 轻量云/Render/Fly | 旧 41「选一条部署路线」 | 上线;每道练习的参考答案 |
| 426 | day-426-week61-review | Day 426 · 第 61 周复习:生产化与安全(Day 420–425) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 427 | day-427-ci-cd | Day 427 · 部署(五):最小 CI/CD | 推送自动部署 | 旧 41「最小的 CI/CD」 | Actions 部署;每道练习的参考答案 |
| 428 | day-428-local-models | Day 428 · 自己跑开源模型:Ollama 和 vLLM 速览 | 何时自部署 | 旧 41「自己跑开源模型」 | ollama run qwen;每道练习的参考答案 |
| 429 | day-429-managed-runtimes | Day 429 · 托管 Agent 运行时:自建还是租 | 托管了什么;决策表 | 旧 147 | 托管 vs 自建;每道练习的参考答案 |
| 430 | day-430-java-go-1 | Day 430 · 用 Java 和 Go 写 Agent(一):全景和 Spring AI | ChatClient;tool calling | 旧 141 前三节 | Spring AI 版;每道练习的参考答案 |
| 431 | day-431-java-go-2 | Day 431 · 用 Java 和 Go 写 Agent(二):LangChain4j、Eino、ADK Go,什么时候拆服务 | AiServices;ChatModelAgent | 旧 141 后四节 | Eino 版;每道练习的参考答案 |
| 432 | day-432-prod-project-1 | Day 432 · 小项目(一):整合代码和上线检查清单 | 清单 | 旧 42「上线前检查清单」「整合后的代码」 | 清单逐项;每道练习的参考答案 |
| 433 | day-433-week62-review | Day 433 · 第 62 周复习:生产化与安全(Day 427–432) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 434 | day-434-prod-project-2 | Day 434 · 小项目(二):部署到公网和故障演练 | 故障演练 | 旧 42「故障演练」及之后 | 公网可访问;每道练习的参考答案 |

### 第八部分 · 毕业项目 SupportPilot(Day 435–497,63 天)

| Day | slug | 标题 | 今天只讲的知识点 | 来源 | 要实跑的代码/数据 |
| --- | --- | --- | --- | --- | --- |
| 435 | day-435-capstone-why | Day 435 · 开题:为什么做智能客服工单 | 选题标准 | 旧 43「为什么是智能客服工单」 | 每道练习的参考答案 |
| 436 | day-436-fde-requirements | Day 436 · 像 FDE 那样拆需求:先访谈,再写代码 | 访谈清单 | 旧 43「像 FDE 那样拆需求」 | 访谈记录;每道练习的参考答案 |
| 437 | day-437-prd | Day 437 · 一页 PRD:背景、用户、目标、非目标、指标、风险 | PRD | 旧 43「一页 PRD」 | PRD 文档;每道练习的参考答案 |
| 438 | day-438-architecture | Day 438 · 架构:每个方块后面是哪个文件 | 架构图 | 旧 43「架构」「目录结构」 | 架构图;每道练习的参考答案 |
| 439 | day-439-schedule-cost | Day 439 · 排期和成本估算 | 排期;评测成本 | 旧 43「12 天排期」「成本估算」 | 成本算式;每道练习的参考答案 |
| 440 | day-440-week63-review | Day 440 · 第 63 周复习:毕业项目(Day 434–439) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 441 | day-441-repo-init | Day 441 · 搭骨架(一):建仓库,uv、ruff、pytest、pre-commit | 工程化 | 旧 44「第一步」 | 仓库初始化;每道练习的参考答案 |
| 442 | day-442-config | Day 442 · 搭骨架(二):配置管理 | settings | 旧 44「第二步」 | 配置测试;每道练习的参考答案 |
| 443 | day-443-database | Day 443 · 搭骨架(三):数据库 | 表设计 | 旧 44「第三步」 | 迁移;每道练习的参考答案 |
| 444 | day-444-kb-generate | Day 444 · 搭骨架(四):造帮助中心 60+ 篇 | 造数脚本 | 旧 44「第四步」 | 文章生成;每道练习的参考答案 |
| 445 | day-445-bizdata | Day 445 · 搭骨架(五):造业务库 | 业务表 | 旧 44「第五步」 | seed;每道练习的参考答案 |
| 446 | day-446-makefile-readme | Day 446 · 搭骨架(六):Makefile、测试、README | make test | 旧 44 后两节 | make test;每道练习的参考答案 |
| 447 | day-447-week64-review | Day 447 · 第 64 周复习:毕业项目(Day 441–446) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 448 | day-448-kb-chunk | Day 448 · 知识库(一):按小标题切块,给每块戴帽子 | 帽子 | 旧 45「切块」 | 切块结果;每道练习的参考答案 |
| 449 | day-449-kb-ingest | Day 449 · 知识库(二):向量化和增量导入 | 增量 | 旧 45「向量化和增量导入」 | 导入脚本;每道练习的参考答案 |
| 450 | day-450-kb-hybrid | Day 450 · 知识库(三):混合检索 | RRF | 旧 45「混合检索」 | 检索测试;每道练习的参考答案 |
| 451 | day-451-kb-citation | Day 451 · 知识库(四):引用和检索基线 | 引用编号;基线 | 旧 45「引用」「检索基线」「上线以后」 | 基线分数;每道练习的参考答案 |
| 452 | day-452-tools-rules | Day 452 · 业务工具(一):工具层的四条规矩和业务函数 | 规矩 | 旧 46「先定原则」「业务函数」 | 业务函数单测;每道练习的参考答案 |
| 453 | day-453-tools-registry | Day 453 · 业务工具(二):权限分级和注册表 | 分级 | 旧 46「权限分级和注册表」 | 注册表测试;每道练习的参考答案 |
| 454 | day-454-week65-review | Day 454 · 第 65 周复习:毕业项目(Day 448–453) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 455 | day-455-tools-enterprise | Day 455 · 业务工具(三):审批通知推到群里,受控 text-to-SQL | 企业系统对接 | 旧 46「对接企业系统」两节 | 通知演示;每道练习的参考答案 |
| 456 | day-456-tools-mcp | Day 456 · 业务工具(四):包成 MCP server,退款审批时序 | MCP;时序 | 旧 46 最后两节 | MCP server 跑通;每道练习的参考答案 |
| 457 | day-457-flow-client-state | Day 457 · 主工作流(一):LLMClient 加三样东西,状态设计 | 状态 | 旧 47 前两节 | state.py;每道练习的参考答案 |
| 458 | day-458-flow-prompts | Day 458 · 主工作流(二):提示词集中放、带版本号 | 版本 | 旧 47「提示词」 | prompts/;每道练习的参考答案 |
| 459 | day-459-flow-di | Day 459 · 主工作流(三):依赖注入让节点可测 | DI | 旧 47「依赖注入」 | 节点单测;每道练习的参考答案 |
| 460 | day-460-flow-nodes | Day 460 · 主工作流(四):九个节点 | 节点实现 | 旧 47「九个节点」 | 逐个节点;每道练习的参考答案 |
| 461 | day-461-week66-review | Day 461 · 第 66 周复习:毕业项目(Day 455–460) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 462 | day-462-flow-graph | Day 462 · 主工作流(五):图、路由,为什么不用预置 agent | 路由 | 旧 47「图和路由」「为什么不用现成的预置 agent」 | 图编译;每道练习的参考答案 |
| 463 | day-463-flow-e2e | Day 463 · 主工作流(六):不花钱的单测和端到端 10 张工单 | 端到端 | 旧 47 最后两节 | 10 张工单;每道练习的参考答案 |
| 464 | day-464-memory-session | Day 464 · 记忆(一):工单内的对话状态 | 会话状态 | 旧 48 前两节 | 多轮测试;每道练习的参考答案 |
| 465 | day-465-memory-compact | Day 465 · 记忆(二):对话太长时压缩 | 压缩 | 旧 48「第二种」 | 压缩测试;每道练习的参考答案 |
| 466 | day-466-memory-profile | Day 466 · 记忆(三):跨工单的客户画像和新问题 | 画像;隐私 | 旧 48 后四节 | 画像写读;每道练习的参考答案 |
| 467 | day-467-ui-api | Day 467 · 界面(一):并发成本 bug、接口设计和 SSE 事件协议 | 接口;事件 | 旧 49 前三节 | 修并发 bug;每道练习的参考答案 |
| 468 | day-468-week67-review | Day 468 · 第 67 周复习:毕业项目(Day 462–467) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 469 | day-469-ui-stream | Day 469 · 界面(二):事件类型和读流,一次运行就是一个 reducer | 读流;状态(默认你会 React) | 旧 49「前端选型」「项目结构」「事件类型和读流」「状态」 | 假后端联调;每道练习的参考答案 |
| 470 | day-470-ui-components | Day 470 · 界面(三):过程、工具卡片、回复和引用,两个页面 | Agent 专有交互 | 旧 49「组件」「两个页面」 | 工作台;每道练习的参考答案 |
| 471 | day-471-ui-robust | Day 471 · 界面(四):停止和断线、可访问性、假后端 | 中断;重连 | 旧 49「停止和断线」「可访问性」「不花钱调界面」 | 断线重连;每道练习的参考答案 |
| 472 | day-472-ui-audience | Day 472 · 界面(五):三种用户三种信息密度,测试整条链路 | 信息密度;e2e | 旧 49 最后三节 | Playwright e2e;每道练习的参考答案 |
| 473 | day-473-ts-agents-1 | Day 473 · 用 TypeScript 写 Agent(一):选择、结构和 AI SDK 的 ToolLoopAgent | AI SDK 6;工具审批 | 旧 142 前五节 | ToolLoopAgent;每道练习的参考答案 |
| 474 | day-474-ts-agents-2 | Day 474 · 用 TypeScript 写 Agent(二):useChat 工具卡片、Mastra 版,Python 后端还是全 TS | Mastra;取舍 | 旧 142 后三节 | Mastra 版;每道练习的参考答案 |
| 475 | day-475-week68-review | Day 475 · 第 68 周复习:毕业项目(Day 469–474) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 476 | day-476-eval-scenarios | Day 476 · 评测(一):从验收指标到评测项,场景×说法 | 评测集 | 旧 50 前两节 | 100 条;每道练习的参考答案 |
| 477 | day-477-eval-rules | Day 477 · 评测(二):第一层规则检查 | 规则 | 旧 50「第一层」 | 规则检查;每道练习的参考答案 |
| 478 | day-478-eval-judge | Day 478 · 评测(三):第二层 LLM 评审,跑出第一份分数 | 评审;跑分 | 旧 50「第二层」「跑评测」「失败用例」 | 第一份分数;每道练习的参考答案 |
| 479 | day-479-eval-meta | Day 479 · 评测(四):评审本身准不准,测评测代码 | 元评测 | 旧 50 最后两节 | 对齐;每道练习的参考答案 |
| 480 | day-480-iterate-1 | Day 480 · 迭代(一):先读再分类再数,我踩到的四个坑 | 错误分析 | 旧 51 前两节 | 分类表;每道练习的参考答案 |
| 481 | day-481-iterate-2 | Day 481 · 迭代(二):一次改一处,改动日志,防过拟合 | 改动日志 | 旧 51 中三节 | 改动日志;每道练习的参考答案 |
| 482 | day-482-week69-review | Day 482 · 第 69 周复习:毕业项目(Day 476–481) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 483 | day-483-iterate-3 | Day 483 · 迭代(三):提分手段清单,最后跑一次 test | test 集 | 旧 51 最后两节 | test 分数;每道练习的参考答案 |
| 484 | day-484-obs-langfuse | Day 484 · 可观测(一):接 Langfuse,给节点套 observe | observe | 旧 52 前三节 | trace 可见;每道练习的参考答案 |
| 485 | day-485-cost-ledger | Day 485 · 可观测(二):自己的账本,先用算式估 | 账本 | 旧 52「账本」「先用算式估」 | 单工单成本;每道练习的参考答案 |
| 486 | day-486-cost-optimize | Day 486 · 可观测(三):前缀缓存和模型路由,值不值 | 两招;ROI | 旧 52 后四节 | 优化前后;每道练习的参考答案 |
| 487 | day-487-threat-model | Day 487 · 安全(一):画信任边界,注入测试集 | 信任边界 | 旧 53 前两节 | 注入测试集;每道练习的参考答案 |
| 488 | day-488-defenses | Day 488 · 安全(二):三道防御和权限审计 | 身份绑工具层;人触发;出口检查 | 旧 53 中四节 | 审计表;每道练习的参考答案 |
| 489 | day-489-week70-review | Day 489 · 第 70 周复习:毕业项目(Day 483–488) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 490 | day-490-deploy-demo | Day 490 · 安全(三):Docker 化,公网 demo 三道闸和上线 | 限流;额度;演示账号 | 旧 53 最后三节 | 上线;每道练习的参考答案 |
| 491 | day-491-readme-arch | Day 491 · 作品包装(一):面试官的 5 分钟,README 和架构图 | README | 旧 54 前四节 | README;每道练习的参考答案 |
| 492 | day-492-video-blog | Day 492 · 作品包装(二):演示视频脚本和技术博客 | 脚本;博客 | 旧 54「演示视频」「技术博客」 | 脚本;每道练习的参考答案 |
| 493 | day-493-online-demo | Day 493 · 作品包装(三):在线 demo 和仓库卫生 | Gradio/Streamlit/HF Spaces | 旧 54 最后两节 | 在线 demo;每道练习的参考答案 |
| 494 | day-494-code-review-1 | Day 494 · 第二作品(一):代码审查机器人,取 diff 算行号,结构化意见 | diff;行号 | 旧 55 前三节 | diff 解析;每道练习的参考答案 |
| 495 | day-495-code-review-2 | Day 495 · 第二作品(二):过滤、挂 Actions、用埋 bug 量召回 | 过滤;评测 | 旧 55 中三节 | 召回率;每道练习的参考答案 |
| 496 | day-496-week71-review | Day 496 · 第 71 周复习:毕业项目(Day 490–495) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 497 | day-497-code-review-3 | Day 497 · 第二作品(三):升级成 Agent,和 Coding Agent 的关系 | 翻代码;审 AI 代码 | 旧 55 最后三节 | Agent 版;每道练习的参考答案 |

### 第九部分 · 求职(Day 498–517,20 天)

| Day | slug | 标题 | 今天只讲的知识点 | 来源 | 要实跑的代码/数据 |
| --- | --- | --- | --- | --- | --- |
| 498 | day-498-resume-1 | Day 498 · 简历(一):招聘方要什么,关键词对照表 | 证据→句子 | 旧 56 前两节 | 关键词表;每道练习的参考答案 |
| 499 | day-499-resume-2 | Day 499 · 简历(二):项目经历,问题、方案、数据 | 项目写法 | 旧 56「项目经历」 | 改一段;每道练习的参考答案 |
| 500 | day-500-resume-3 | Day 500 · 简历(三):工作经历换角度,年限学历门槛 | 诚实改写 | 旧 56「工作经历」「年限和学历门槛」 | 改一段;每道练习的参考答案 |
| 501 | day-501-resume-4 | Day 501 · 简历(四):代表项目说明、一页结构、证书和英文版 | 结构;证书 | 旧 56 后四节 | 一页简历;每道练习的参考答案 |
| 502 | day-502-interview-1 | Day 502 · 面试(一):模型、提示词与结构化输出题 | 题库一 + 模型结构加题 | 旧 57 题库一 | 计时自测;每道练习的参考答案 |
| 503 | day-503-week72-review | Day 503 · 第 72 周复习:求职(Day 497–502) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 504 | day-504-interview-2 | Day 504 · 面试(二):工具调用与 RAG 题 | 题库二 | 旧 57 题库二 | 计时自测;每道练习的参考答案 |
| 505 | day-505-interview-3 | Day 505 · 面试(三):Agent 架构、框架原理与上下文工程题 | 题库三 | 旧 57 题库三 | 计时自测;每道练习的参考答案 |
| 506 | day-506-interview-4 | Day 506 · 面试(四):MCP、Skills、评测、安全与工程化题 | 题库四 | 旧 57 题库四 | 计时自测;每道练习的参考答案 |
| 507 | day-507-live-coding | Day 507 · 面试(五):10 分钟手写 Agent 循环 | 现场编码 | 旧 57「现场编码题」+ 旧 58「现场编码加强题」 | 计时手写;每道练习的参考答案 |
| 508 | day-508-sysdesign-1 | Day 508 · 系统设计(一):七步框架和企业客服 Agent | 框架 | 旧 58「七步框架」「第一题」 | 画架构图;每道练习的参考答案 |
| 509 | day-509-sysdesign-2 | Day 509 · 系统设计(二):Deep Research Agent 和追问清单 | 追问 | 旧 58「第二题」「追问清单」 | 画架构图;每道练习的参考答案 |
| 510 | day-510-week73-review | Day 510 · 第 73 周复习:求职(Day 504–509) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 511 | day-511-job-channels | Day 511 · 求职(一):数据从哪来,渠道和薪资 | 渠道;口径 | 旧 59 前三节 | 投递清单;每道练习的参考答案 |
| 512 | day-512-remote-fde | Day 512 · 求职(二):海外远程和 FDE 岗 | 远程现实;FDE | 旧 59「海外远程」「FDE」 | 每道练习的参考答案 |
| 513 | day-513-offer | Day 513 · 求职(三):面试流程、谈薪、避坑和投递节奏 | 谈薪 | 旧 59 后四节 | 每道练习的参考答案 |
| 514 | day-514-industry-1 | Day 514 · 行业里的 Agent(一):JD 行业分布和换行业的五样东西 | 框架 | 旧 153 前两节 | 行业统计;每道练习的参考答案 |
| 515 | day-515-industry-2 | Day 515 · 行业里的 Agent(二):SaaS 客服、金融、医疗、电商 | 四个行业 | 旧 153 后五节 | 讲稿;每道练习的参考答案 |
| 516 | day-516-basic-graduation | Day 516 · 普通篇结业:能力自检和接下来怎么进阶 | 自检 | 旧 60 全篇 | 对照 JD 打勾;每道练习的参考答案 |
| 517 | day-517-week74-review | Day 517 · 第 74 周复习:求职(Day 511–516) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |

### 第十部分 · 进阶:资深 Agent 工程师(Day 518–648,131 天)

| Day | slug | 标题 | 今天只讲的知识点 | 来源 | 要实跑的代码/数据 |
| --- | --- | --- | --- | --- | --- |
| 518 | day-518-senior-gap | Day 518 · 进阶开学(一):资深岗贵多少,中级和资深差在哪 | 能力对照 | 旧 61 前两节 | 每道练习的参考答案 |
| 519 | day-519-senior-map | Day 519 · 进阶开学(二):进阶地图和学习方式,第一份 ADR | 读论文/源码/写文档 | 旧 61 后半 | 写一份 ADR;每道练习的参考答案 |
| 520 | day-520-harness-parts | Day 520 · Harness(一):harness 包了哪些东西 | 循环/工具/上下文/权限/钩子/子 Agent/持久化 | 旧 62「harness 到底包了哪些东西」 | 每道练习的参考答案 |
| 521 | day-521-harness-sources | Day 521 · Harness(二):读三家的源码 | Claude Agent SDK/OpenAI Agents SDK/LangGraph | 旧 62「读三家的源码」 | 读源码笔记;每道练习的参考答案 |
| 522 | day-522-harness-long | Day 522 · Harness(三):Anthropic 的长任务 harness 和 harness engineering | planner/generator/evaluator | 旧 62「Anthropic 的长任务 harness」+ B 节 | 每道练习的参考答案 |
| 523 | day-523-deep-agents | Day 523 · Harness(四):Deep Agents,把约定做成库 | todo;虚拟文件系统;task 子 Agent | 旧 62「Deep Agents」 | deepagents 实跑;每道练习的参考答案 |
| 524 | day-524-week75-review | Day 524 · 第 75 周复习:进阶(Day 518–523) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 525 | day-525-harness-build | Day 525 · Harness(五):给 AgentOps 写一个 harness,扩展点和硬约束 | 接口设计 | 旧 62 最后两节 | harness 骨架;每道练习的参考答案 |
| 526 | day-526-context-rot | Day 526 · 上下文进阶(一):上下文腐烂 | 窗口大不等于看得清 | 旧 63「上下文腐烂」 | 每道练习的参考答案 |
| 527 | day-527-kv-cache-design | Day 527 · 上下文进阶(二):Manus 六条经验,围绕 KV 缓存设计 | 前缀稳定 | 旧 63「Manus 的六条经验」 | 缓存命中对比;每道练习的参考答案 |
| 528 | day-528-layered-compaction | Day 528 · 上下文进阶(三):三层压缩 | 按成本从低到高 | 旧 63「三层压缩」 | 每道练习的参考答案 |
| 529 | day-529-claude-context-tools | Day 529 · 上下文进阶(四):context editing、compaction、memory tool | 三件套分工 | 旧 63「Claude API 自带的三样」 | 参数核对(未实跑说明);每道练习的参考答案 |
| 530 | day-530-context-manager | Day 530 · 上下文进阶(五):写一个分层上下文管理器和对比实验 | 实验设计 | 旧 63 最后两节 | 管理器;每道练习的参考答案 |
| 531 | day-531-week76-review | Day 531 · 第 76 周复习:进阶(Day 525–530) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 532 | day-532-memory-taxonomy | Day 532 · 记忆系统(一):把记忆拆开,四个设计问题 | 短期/长期/情景/语义 | 旧 64 前两节 | 每道练习的参考答案 |
| 533 | day-533-memory-oss | Day 533 · 记忆系统(二):四个开源方案对比 | mem0/Letta/Zep/LangGraph store | 旧 64「四个开源方案对比」 | 每道练习的参考答案 |
| 534 | day-534-memory-build | Day 534 · 记忆系统(三):给 SupportPilot 写客户记忆并评测 | 写入/遗忘/评测 | 旧 64 后两节 | 记忆评测;每道练习的参考答案 |
| 535 | day-535-durable-1 | Day 535 · 持久化执行(一):记日志,然后重放 | 事件溯源 | 旧 65「原理」 | 每道练习的参考答案 |
| 536 | day-536-durable-2 | Day 536 · 持久化执行(二):Agent 让这件事变难的两个地方 | 非确定性;副作用 | 旧 65「Agent 让这件事变难」 | 每道练习的参考答案 |
| 537 | day-537-durable-3 | Day 537 · 持久化执行(三):自己写一个持久化运行器 | 运行器 | 旧 65「自己写一个」 | 运行器测试;每道练习的参考答案 |
| 538 | day-538-week77-review | Day 538 · 第 77 周复习:进阶(Day 532–537) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 539 | day-539-durable-4 | Day 539 · 持久化执行(四):四个现成方案 | Temporal/DBOS/Restate/LangGraph | 旧 65「四个现成方案」 | 每道练习的参考答案 |
| 540 | day-540-orch-1 | Day 540 · 编排取舍(一):三篇文章三种立场,四种架构 | 立场 | 旧 66 前两节 | 每道练习的参考答案 |
| 541 | day-541-orch-2 | Day 541 · 编排取舍(二):五个维度、状态和失败、对比实验 | 决策维度 | 旧 66 后四节 | 实验设计;每道练习的参考答案 |
| 542 | day-542-design-doc-1 | Day 542 · 设计文档(一):设计文档写什么 | 骨架 | 旧 67「设计文档写什么」 | 每道练习的参考答案 |
| 543 | day-543-design-doc-2 | Day 543 · 设计文档(二):示范 AgentOps 运行时设计文档和两份 ADR | 示范 | 旧 67 示范与 ADR | 写一份;每道练习的参考答案 |
| 544 | day-544-eval-org | Day 544 · 评测是产品(一):一个人和一个团队的评测,资产生命周期 | 生命周期 | 旧 68 前两节 | 每道练习的参考答案 |
| 545 | day-545-week78-review | Day 545 · 第 78 周复习:进阶(Day 539–544) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 546 | day-546-eval-process | Day 546 · 评测是产品(二):分工、钉进流程、预算和 registry | registry 检查 | 旧 68 后五节 | registry 工具;每道练习的参考答案 |
| 547 | day-547-eval-stats-1 | Day 547 · 评测统计学(一):通过率区间,别再用 p±1.96·SE | Wilson 区间 | 旧 69「先准备数据」「第一件事」 | 区间计算;每道练习的参考答案 |
| 548 | day-548-eval-stats-2 | Day 548 · 评测统计学(二):用例不独立和配对比较 | 聚类;配对 | 旧 69「第二件事」「第三件事」 | 配对检验;每道练习的参考答案 |
| 549 | day-549-eval-stats-3 | Day 549 · 评测统计学(三):bootstrap 和 Agent 自己在抖 | 重采样;方差 | 旧 69「第四件事」「第五件事」 | bootstrap;每道练习的参考答案 |
| 550 | day-550-eval-stats-4 | Day 550 · 评测统计学(四):样本量和多重比较,怎么跟老板说 | 功效;多重比较 | 旧 69 后四节 | 样本量计算;每道练习的参考答案 |
| 551 | day-551-judge-scale-1 | Day 551 · 大规模评审(一):校准集差评太少,校正后的通过率带区间 | 校准 | 旧 70 前三节 | 校正计算;每道练习的参考答案 |
| 552 | day-552-week79-review | Day 552 · 第 79 周复习:进阶(Day 546–551) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 553 | day-553-judge-scale-2 | Day 553 · 大规模评审(二):投票、评审漂移、钱和人、多人标注 | kappa;投票 | 旧 70 后四节 + B 节多人标注 | 评审模块;每道练习的参考答案 |
| 554 | day-554-online-ab-1 | Day 554 · 线上评测(一):离线和线上,实验五要素,指标 | 实验设计 | 旧 71 前三节 | 每道练习的参考答案 |
| 555 | day-555-online-ab-2 | Day 555 · 线上评测(二):分流、SRM、delta 方法、决策和偷看 | 分析 | 旧 71 后五节 | 分析脚本;每道练习的参考答案 |
| 556 | day-556-redteam-1 | Day 556 · 自动化红队(一):测什么,组合攻击,只看行为的检测器 | 攻击组合 | 旧 72 前三节 | 攻击生成;每道练习的参考答案 |
| 557 | day-557-redteam-2 | Day 557 · 自动化红队(二):带区间汇报、会学习的攻击者、工具和流程 | 持续红队 | 旧 72 后四节 | 红队跑分;每道练习的参考答案 |
| 558 | day-558-bench-1 | Day 558 · benchmark(一):拆解 τ-bench 和 SWE-bench | 有效性 | 旧 73 前三节 | 每道练习的参考答案 |
| 559 | day-559-week80-review | Day 559 · 第 80 周复习:进阶(Day 553–558) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 560 | day-560-bench-2 | Day 560 · benchmark(二):设计 CloudLedger-Bench,任务自检 | 参考解必过 | 旧 73 中三节 | 任务自检;每道练习的参考答案 |
| 561 | day-561-bench-3 | Day 561 · benchmark(三):2026 新基准和 GAIA 打榜 | Terminal-Bench/τ³/OSWorld 2.0 | 旧 73 最后两节 | GAIA dry-run;每道练习的参考答案 |
| 562 | day-562-eval-platform | Day 562 · 给 AgentOps 设计评测平台,MR 对比报告 | 设计文档 | 旧 74 全篇 | 对比报告;每道练习的参考答案 |
| 563 | day-563-model-selection-1 | Day 563 · 选模型(一):榜单为什么不能直接用,六个维度 | 硬约束/软指标 | 旧 75 前两节 | 每道练习的参考答案 |
| 564 | day-564-model-selection-2 | Day 564 · 选模型(二):2026-10 模型版图,用自己的评测集对比 | 实测对比 | 旧 75 中两节 | 对比表;每道练习的参考答案 |
| 565 | day-565-model-selection-3 | Day 565 · 选模型(三):多模型路由、顾问模式和总拥有成本 | TCO | 旧 75 最后两节 + B 节顾问模式 | TCO 表;每道练习的参考答案 |
| 566 | day-566-week81-review | Day 566 · 第 81 周复习:进阶(Day 560–565) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 567 | day-567-self-host-1 | Day 567 · 自部署(一):什么时候值得,显存账 | 显存;KV cache | 旧 76 前两节 | 显存计算;每道练习的参考答案 |
| 568 | day-568-self-host-2 | Day 568 · 自部署(二):Colab T4 和云 GPU 两条路线 | vLLM 上线 | 旧 76 中两节 | vLLM 跑起来;每道练习的参考答案 |
| 569 | day-569-self-host-3 | Day 569 · 自部署(三):压测和量化 | 产能;量化 | 旧 76 最后两节 | 压测数字;每道练习的参考答案 |
| 570 | day-570-finetune-1 | Day 570 · 微调(一):提示词、RAG、微调各管什么,造训练集 | 数据比参数重要 | 旧 77 前两节 | 训练集;每道练习的参考答案 |
| 571 | day-571-finetune-tools | Day 571 · 微调(二):工具调用的训练数据格式、chat template 和清洗 | hermes;去重 | 旧 77「如果要训的是工具调用」 | render_tool_sample.py;每道练习的参考答案 |
| 572 | day-572-finetune-2 | Day 572 · 微调(三):LoRA 原理,Unsloth 在 Colab 上训练 | LoRA | 旧 77「LoRA」「用 Unsloth」 | Colab 训练;每道练习的参考答案 |
| 573 | day-573-week82-review | Day 573 · 第 82 周复习:进阶(Day 567–572) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 574 | day-574-finetune-3 | Day 574 · 微调(四):挂到 vLLM 上和原版对比 | 对比 | 旧 77 最后一节 | 对比表;每道练习的参考答案 |
| 575 | day-575-dpo-1 | Day 575 · DPO(一):从 RLHF 到 DPO,变体,偏好数据从哪来 | 偏好数据 | 旧 78 前三节 | 每道练习的参考答案 |
| 576 | day-576-dpo-2 | Day 576 · DPO(二):用 TRL 跑一次,读指标,回归检查 | 训练指标 | 旧 78 后三节 | TRL DPO;每道练习的参考答案 |
| 577 | day-577-distill-1 | Day 577 · 蒸馏(一):三种蒸馏,规模化打标,学生选多大 | 打标 | 旧 79 前三节 | 打标;每道练习的参考答案 |
| 578 | day-578-distill-2 | Day 578 · 蒸馏(二):置信度和阈值曲线,其他路由方式 | 阈值 | 旧 79 后三节 | 阈值曲线;每道练习的参考答案 |
| 579 | day-579-rl-1 | Day 579 · 强化学习(一):模仿和试错,RLVR 和 GRPO | 可验证奖励 | 旧 80 前三节 | 每道练习的参考答案 |
| 580 | day-580-week83-review | Day 580 · 第 83 周复习:进阶(Day 574–579) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 581 | day-581-rl-2 | Day 581 · 强化学习(二):给 Agent 设计奖励,GRPO 训练分诊模型 | 奖励设计 | 旧 80 后三节 | GRPO 训练;每道练习的参考答案 |
| 582 | day-582-router-pipeline | Day 582 · 给 AgentOps 训练路由小模型:流水线、数据卡、模型卡 | 流水线 | 旧 81 全篇 | 数据卡+模型卡;每道练习的参考答案 |
| 583 | day-583-platform-1 | Day 583 · 平台(一):什么时候该做平台,平台给什么,租户是谁 | 多租户 | 旧 82 前三节 | 每道练习的参考答案 |
| 584 | day-584-platform-2 | Day 584 · 平台(二):隔离四维度,silo/pool/bridge,行级安全 | RLS | 旧 82 中三节 | RLS 演示;每道练习的参考答案 |
| 585 | day-585-platform-3 | Day 585 · 平台(三):控制面和数据面,中间件放在哪 | Redis/队列/检索库/对象存储 | 旧 82 最后两节 | 每道练习的参考答案 |
| 586 | day-586-gateway-1 | Day 586 · 模型网关(一):网关管什么,买还是写,按 token 限流 | token 限流 | 旧 83 前三节 | 每道练习的参考答案 |
| 587 | day-587-week84-review | Day 587 · 第 84 周复习:进阶(Day 581–586) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 588 | day-588-gateway-2 | Day 588 · 模型网关(二):预算配额、路由降级、成本归因,写一个最小网关 | 最小网关 | 旧 83 后五节 | 网关测试;每道练习的参考答案 |
| 589 | day-589-mcp-gw-1 | Day 589 · MCP 网关(一):2026 规范变化和远程授权流程 | OAuth;CIMD | 旧 84 前两节 | 授权流程;每道练习的参考答案 |
| 590 | day-590-mcp-gw-2 | Day 590 · MCP 网关(二):禁止令牌透传、注册中心、授权模型和审计 | 注册中心 | 旧 84 后五节 | 每道练习的参考答案 |
| 591 | day-591-identity-1 | Day 591 · Agent 身份(一):四种错误做法,工作负载身份 | SPIFFE/WIMSE | 旧 149 前两节 | 每道练习的参考答案 |
| 592 | day-592-identity-2 | Day 592 · Agent 身份(二):令牌交换、收窄、人在哪点头、审计 | OBO;act 声明 | 旧 149 后六节 | 六场景审计;每道练习的参考答案 |
| 593 | day-593-obs-scale-1 | Day 593 · 规模化可观测(一):trace 有多大,链路连起来,agent span 命名 | OTel GenAI | 旧 85 前三节 | agent_spans.py;每道练习的参考答案 |
| 594 | day-594-week85-review | Day 594 · 第 85 周复习:进阶(Day 588–593) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 595 | day-595-obs-scale-2 | Day 595 · 规模化可观测(二):采样、原文与元数据、指标、SLO 和看板 | 尾部采样;燃烧速率 | 旧 85 后五节 | 告警规则;每道练习的参考答案 |
| 596 | day-596-governance-1 | Day 596 · 治理合规(一):从安全问卷倒推,国内要求,欧盟 AI Act | 合规 | 旧 86 前三节 | 每道练习的参考答案 |
| 597 | day-597-governance-2 | Day 597 · 治理合规(二):数据流图、分级保留、删除到底 | 技术方案 | 旧 86 后四节 | 数据流图;每道练习的参考答案 |
| 598 | day-598-china-compliance-1 | Day 598 · 国内智能体合规(一):时间线和《实施意见》四条 | 条款→工程 | 旧 152 前两节 | 每道练习的参考答案 |
| 599 | day-599-china-compliance-2 | Day 599 · 国内智能体合规(二):拟人化办法、GB/Z 185、清朗,决策分级写成代码 | 分级策略 | 旧 152 后五节 | 策略模块测试;每道练习的参考答案 |
| 600 | day-600-incident-1 | Day 600 · 事故复盘(一):三起事故,六类事故,头 15 分钟 | 止血 | 旧 87 前三节 | 每道练习的参考答案 |
| 601 | day-601-week86-review | Day 601 · 第 86 周复习:进阶(Day 595–600) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 602 | day-602-incident-2 | Day 602 · 事故复盘(二):自动熔断、查原因、无责复盘,OpenClaw 案例 | 复盘模板 | 旧 87 后半 + B 节 OpenClaw | 复盘文档;每道练习的参考答案 |
| 603 | day-603-platform-review | Day 603 · 平台架构评审:AgentOps 平台设计文档 | 评审 | 旧 88 全篇 | 设计文档;每道练习的参考答案 |
| 604 | day-604-coding-agents-1 | Day 604 · Coding Agent 内部(一):五块拆解,SWE-agent 和 mini-swe-agent | ACI | 旧 89 前三节 | 读源码;每道练习的参考答案 |
| 605 | day-605-coding-agents-2 | Day 605 · Coding Agent 内部(二):OpenHands、Codex、SWE-bench、怎么找到要改的地方 | 定位 | 旧 89 后五节 | 读源码;每道练习的参考答案 |
| 606 | day-606-computer-use-1 | Day 606 · Computer Use(一):三条路线,2026 年的接口 | GUI Agent | 旧 90 前两节 + 旧 26「Computer Use」节 | 浏览器 Agent 跑一次;每道练习的参考答案 |
| 607 | day-607-computer-use-2 | Day 607 · Computer Use(二):可靠性、截图成本、网页注入和视觉 Agent | 成本;安全 | 旧 90 后五节 + B 节 | 截图 token 计算;每道练习的参考答案 |
| 608 | day-608-week87-review | Day 608 · 第 87 周复习:进阶(Day 602–607) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 609 | day-609-webmcp | Day 609 · WebMCP:让网站直接给浏览器 Agent 暴露工具 | document.modelContext | 旧 150 | 假 modelContext 调 5 次;每道练习的参考答案 |
| 610 | day-610-voice-1 | Day 610 · 语音 Agent(一):人说话的节奏,级联还是端到端,延迟花在哪 | 延迟预算 | 旧 91 前三节 | 延迟预算表;每道练习的参考答案 |
| 611 | day-611-voice-2 | Day 611 · 语音 Agent(二):打断、工具调用和电话、怎么评测 | 打断 | 旧 91 后三节 | 每道练习的参考答案 |
| 612 | day-612-deep-research-1 | Day 612 · Deep Research(一):和 RAG 差在哪,典型架构,读 open_deep_research | 架构 | 旧 92 前三节 | 跑一次研究任务;每道练习的参考答案 |
| 613 | day-613-deep-research-2 | Day 613 · Deep Research(二):其他实现、工程复盘数字、评测和成本 | 评测 | 旧 92 后四节 | 每道练习的参考答案 |
| 614 | day-614-a2a-1 | Day 614 · Agent 互联(一):三层协议,A2A 走到哪一步 | 协议分层 | 旧 93 前两节 | 每道练习的参考答案 |
| 615 | day-615-week88-review | Day 615 · 第 88 周复习:进阶(Day 609–614) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 616 | day-616-a2a-2 | Day 616 · Agent 互联(二):五个核心对象、传输绑定、身份与信任 | Agent Card;v1.0 变更 | 旧 93 后四节 | a2a-sdk 跑通;每道练习的参考答案 |
| 617 | day-617-payments-1 | Day 617 · Agent 支付(一):三层拆解,x402 | HTTP 402 | 旧 151 前两节 | 模拟 402 接口;每道练习的参考答案 |
| 618 | day-618-payments-2 | Day 618 · Agent 支付(二):AP2、ACP、UCP 和签名都对但决定不是用户的 | mandate | 旧 151 后四节 | 钱包授权框;每道练习的参考答案 |
| 619 | day-619-agent-ux-1 | Day 619 · Agent 产品(一):自主程度、动作分级、透明度 | 自主程度 | 旧 94 前三节 | 每道练习的参考答案 |
| 620 | day-620-agent-ux-2 | Day 620 · Agent 产品(二):可撤销、出错体验、逐步放权、和 PM 协作 | 放权 | 旧 94 后四节 | 每道练习的参考答案 |
| 621 | day-621-generative-ui | Day 621 · 生成式 UI:MCP Apps、A2UI、AG-UI 三条路线和安全(不讲前端框架) | 协议与沙箱 | 旧 148 | 退款审批 MCP App;每道练习的参考答案 |
| 622 | day-622-week89-review | Day 622 · 第 89 周复习:进阶(Day 616–621) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 623 | day-623-tech-selection | Day 623 · 前沿技术选型报告:打分矩阵和敏感性分析 | 选型报告 | 旧 95 全篇 | 选型报告;每道练习的参考答案 |
| 624 | day-624-agentops-kickoff-1 | Day 624 · AgentOps 开题(一):真的需要平台吗,包含什么,控制面数据面 | 范围 | 旧 96 前三节 | 每道练习的参考答案 |
| 625 | day-625-agentops-kickoff-2 | Day 625 · AgentOps 开题(二):隔离、仓库结构、接口约定、数据模型、API key | 接口约定 | 旧 96 后五节 | 仓库骨架;每道练习的参考答案 |
| 626 | day-626-agentops-gw-1 | Day 626 · AgentOps(一):网关里一个请求走过的路,价格表和供应商 | 计费 | 旧 97 前三节 | 供应商类;每道练习的参考答案 |
| 627 | day-627-agentops-gw-2 | Day 627 · AgentOps(二):路由表、令牌桶、记账预算、十个场景测试 | 令牌桶 | 旧 97 后五节 | 十个场景;每道练习的参考答案 |
| 628 | day-628-agentops-mcp-1 | Day 628 · AgentOps(三):MCP 代理,注册上游,默认拒绝 | 授权策略 | 旧 98 前三节 | 代理跑通;每道练习的参考答案 |
| 629 | day-629-week90-review | Day 629 · 第 90 周复习:进阶(Day 623–628) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 630 | day-630-agentops-mcp-2 | Day 630 · AgentOps(四):审计、一次性审批、HTTP 前端和端到端 | 一次性审批 | 旧 98 后五节 | 端到端;每道练习的参考答案 |
| 631 | day-631-agentops-rt-1 | Day 631 · AgentOps(五):持久化什么,数据层,租约漏洞 | 租约 | 旧 99 前三节 | 数据层;每道练习的参考答案 |
| 632 | day-632-agentops-rt-2 | Day 632 · AgentOps(六):RunContext、worker、任务 API、接 SupportPilot | 运行时 | 旧 99 后五节 | 接入测试;每道练习的参考答案 |
| 633 | day-633-agentops-eval | Day 633 · AgentOps(七):评测平台,数据集指纹、统计工具、A/B | 指纹;A/B | 旧 100 全篇 | 评测迁移;每道练习的参考答案 |
| 634 | day-634-agentops-router | Day 634 · AgentOps(八):级联路由进网关和 shadow 模式 | shadow | 旧 101 全篇 | shadow 报告;每道练习的参考答案 |
| 635 | day-635-agentops-obs | Day 635 · AgentOps(九):全链路可观测和成本看板 | Collector;告警 | 旧 102 全篇 | 全家桶;每道练习的参考答案 |
| 636 | day-636-week91-review | Day 636 · 第 91 周复习:进阶(Day 630–635) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 637 | day-637-agentops-sec | Day 637 · AgentOps(十):安全加固,隔离测试、指纹、哈希链、按钱熔断、红队进 CI | 五层 | 旧 103 全篇 | promptfoo 进 CI;每道练习的参考答案 |
| 638 | day-638-agentops-load | Day 638 · AgentOps(十一):压测、剖析、容量规划和部署 | 利特尔定律 | 旧 104 全篇 | 三组压测;每道练习的参考答案 |
| 639 | day-639-agentops-showcase | Day 639 · AgentOps(十二):包装成资深级作品 | 五秒跑起来 | 旧 105 全篇 | README;每道练习的参考答案 |
| 640 | day-640-design-docs-1 | Day 640 · 设计文档和 ADR:为什么是资深的主要产出,骨架和取舍 | 取舍写法 | 旧 106 前四节 | 一份设计文档;每道练习的参考答案 |
| 641 | day-641-build-vs-buy | Day 641 · AI 立项:该不该用 AI,自己做还是买,回本测算 | ROI | 旧 106「立项」节 | 回本测算;每道练习的参考答案 |
| 642 | day-642-staff-sd-1 | Day 642 · Staff 系统设计(一):面试官看什么,45 分钟框架,真题一 | 平台题 | 旧 107 前三节 | 画图;每道练习的参考答案 |
| 643 | day-643-week92-review | Day 643 · 第 92 周复习:进阶(Day 637–642) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 644 | day-644-staff-sd-2 | Day 644 · Staff 系统设计(二):真题二、真题三和追问清单 | 并发题;评测题 | 旧 107 后三节 | 画图;每道练习的参考答案 |
| 645 | day-645-influence | Day 645 · 带人和推动:一页纸、让别人自愿迁移、带新人、回应「AI 不靠谱」 | 影响力 | 旧 108 全篇 | 一页纸提案;每道练习的参考答案 |
| 646 | day-646-open-source-1 | Day 646 · 开源影响力(一):JD 怎么说,第一个 PR,贡献阶梯,AI 生成的 PR | 贡献 | 旧 109 前五节 | 提一个 PR;每道练习的参考答案 |
| 647 | day-647-open-source-2 | Day 647 · 开源影响力(二):自己的开源项目、技术写作和演讲 | 写作 | 旧 109 后三节 | 一篇文章大纲;每道练习的参考答案 |
| 648 | day-648-senior-graduation | Day 648 · 进阶结业:资深自检、市场数据、找岗位和谈薪 | 自检;谈薪 | 旧 110 全篇 | 自检表;每道练习的参考答案 |

### 第十一部分 · 作品:Agent Loupe 和 BillSleuth(Day 649–701,53 天)

| Day | slug | 标题 | 今天只讲的知识点 | 来源 | 要实跑的代码/数据 |
| --- | --- | --- | --- | --- | --- |
| 649 | day-649-loupe-why | Day 649 · Loupe 开题(一):调 Agent 痛在看不清每一步,现有工具做到哪 | 竞品 | 旧 111 前两节 | 竞品表;每道练习的参考答案 |
| 650 | day-650-week93-review | Day 650 · 第 93 周复习:作品(Day 644–649) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 651 | day-651-loupe-prd | Day 651 · Loupe 开题(二):PRD、架构、仓库、里程碑 | PRD | 旧 111 后五节 | PRD;每道练习的参考答案 |
| 652 | day-652-loupe-model | Day 652 · Loupe(一):两个数据模型,字段一个个想清楚 | Run/Step | 旧 112「两个模型」 | models.py;每道练习的参考答案 |
| 653 | day-653-loupe-otel | Day 653 · Loupe(二):OTel GenAI 语义约定 | 约定映射 | 旧 112「OpenTelemetry 的 GenAI 语义约定」 | 映射表;每道练习的参考答案 |
| 654 | day-654-loupe-import-otlp | Day 654 · Loupe(三):导入器一 OTLP JSON | 解析 | 旧 112「导入器一」 | 导入测试;每道练习的参考答案 |
| 655 | day-655-loupe-import-langfuse | Day 655 · Loupe(四):导入器二 Langfuse 导出,导入器三自研 SDK | 两种导入 | 旧 112「导入器二」「导入器三」 | 导入测试;每道练习的参考答案 |
| 656 | day-656-loupe-detect | Day 656 · Loupe(五):统一入口自动识别格式,给 Agent 加记录,造假数据 | 自动识别 | 旧 112 最后三节 | 假数据;每道练习的参考答案 |
| 657 | day-657-week94-review | Day 657 · 第 94 周复习:作品(Day 651–656) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 658 | day-658-loupe-schema | Day 658 · Loupe(六):先定接口再定表,表设计 | 表设计 | 旧 113 前两节 | 建表;每道练习的参考答案 |
| 659 | day-659-loupe-ingest | Day 659 · Loupe(七):导入事务、覆盖语义、游标分页 | 事务;分页 | 旧 113「导入」「列表的游标分页」 | 分页测试;每道练习的参考答案 |
| 660 | day-660-loupe-steps | Day 660 · Loupe(八):分段加载、轻步骤、价格表、接口和多线程连接 | 分段加载 | 旧 113 后四节 | 接口测试;每道练习的参考答案 |
| 661 | day-661-loupe-types | Day 661 · Loupe(九):前后端契约类型和三个小工具 | 契约 | 旧 114 前两节 | types.ts;每道练习的参考答案 |
| 662 | day-662-loupe-list-timeline | Day 662 · Loupe(十):运行列表页和时间轴(树+瀑布) | 瀑布图(默认你会 React) | 旧 114「运行列表页」「时间轴」「运行详情页」 | 详情页;每道练习的参考答案 |
| 663 | day-663-loupe-perf | Day 663 · Loupe(十一):测量一万步卡不卡 | 虚拟化;测量 | 旧 114「测量」 | 性能数字;每道练习的参考答案 |
| 664 | day-664-week95-review | Day 664 · 第 95 周复习:作品(Day 658–663) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 665 | day-665-loupe-messages | Day 665 · Loupe(十二):渲染消息和详情面板 | 可读可折叠 | 旧 115 前三节 | 详情面板;每道练习的参考答案 |
| 666 | day-666-loupe-context | Day 666 · Loupe(十三):上下文构成五块,增长图和成本冰柱 | 上下文可视化 | 旧 115 后四节 | 增长图;每道练习的参考答案 |
| 667 | day-667-loupe-diff-1 | Day 667 · Loupe(十四):为什么不能直接 diff,步骤签名 | 签名 | 旧 116 前两节 | 签名测试;每道练习的参考答案 |
| 668 | day-668-loupe-diff-2 | Day 668 · Loupe(十五):LCS 对齐,后端接口和并排对比页 | LCS | 旧 116 后四节 | 对比页;每道练习的参考答案 |
| 669 | day-669-loupe-replay-1 | Day 669 · Loupe(十六):重跑到底要「重」什么,磁带的键,重建上下文 | 磁带 | 旧 117 前三节 | 每道练习的参考答案 |
| 670 | day-670-loupe-replay-2 | Day 670 · Loupe(十七):replay.py、路由、测试和 DeepSeek 实测 | 非确定性 | 旧 117 后五节 | 三条路;每道练习的参考答案 |
| 671 | day-671-week96-review | Day 671 · 第 96 周复习:作品(Day 665–670) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 672 | day-672-loupe-eval-1 | Day 672 · Loupe(十八):步级和端到端两种用例,快照和断言 | 快照 | 旧 118 前三节 | 每道练习的参考答案 |
| 673 | day-673-loupe-eval-2 | Day 673 · Loupe(十九):evalcases.py、实测和导出到评测集 | 导出 | 旧 118 后五节 | 导出评测集;每道练习的参考答案 |
| 674 | day-674-loupe-deploy-1 | Day 674 · Loupe(二十):演示站开放什么,脱敏、限流、CORS | 防滥用 | 旧 119 前四节 | 限流测试;每道练习的参考答案 |
| 675 | day-675-loupe-deploy-2 | Day 675 · Loupe(二十一):部署前后端,性能表,上线清单 | 部署 | 旧 119 后四节 | 上线;每道练习的参考答案 |
| 676 | day-676-loupe-showcase | Day 676 · Loupe(二十二):开源发布与作品包装 | README;ADR | 旧 120 全篇 | 发布;每道练习的参考答案 |
| 677 | day-677-bs-why | Day 677 · BillSleuth 开题(一):为什么选计费争议,订阅计费十分钟入门 | 计费周期;按天折算 | 旧 121 前两节 | 每道练习的参考答案 |
| 678 | day-678-week97-review | Day 678 · 第 97 周复习:作品(Day 672–677) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 679 | day-679-bs-prd | Day 679 · BillSleuth 开题(二):客户会问的问题,PRD、架构、排期、指标 | PRD | 旧 121 后五节 | PRD;每道练习的参考答案 |
| 680 | day-680-bs-engine-1 | Day 680 · BillSleuth(一):金额只走一个函数,事件是事实订阅是快照 | 表结构 | 旧 122 前两节 | 建表;每道练习的参考答案 |
| 681 | day-681-bs-engine-2 | Day 681 · BillSleuth(二):参考引擎和用单测钉死规则,价目表和税率 | 规则测试 | 旧 122 中三节 | 引擎单测;每道练习的参考答案 |
| 682 | day-682-bs-faults | Day 682 · BillSleuth(三):故障注入、造数脚本和数据集自检 | 12 类故障 | 旧 122 后三节 | 数据集自检;每道练习的参考答案 |
| 683 | day-683-bs-tools | Day 683 · BillSleuth(四):MCP 工具层、复算工具、Inspector 和测试 | 工具层 | 旧 123 全篇 | Inspector;每道练习的参考答案 |
| 684 | day-684-bs-flow | Day 684 · BillSleuth(五):流程为什么拆段,模型对象和 MCP 桥接 | 拆段 | 旧 124 前两节 | 桥接测试;每道练习的参考答案 |
| 685 | day-685-week98-review | Day 685 · 第 98 周复习:作品(Day 679–684) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 686 | day-686-bs-evidence | Day 686 · BillSleuth(六):证据链由代码抽取,调查图 | 证据链 | 旧 124「证据链」「调查图」 | 图编译;每道练习的参考答案 |
| 687 | day-687-bs-run | Day 687 · BillSleuth(七):不花钱的流程测试和真模型跑 | 测试 | 旧 124 最后两节 | 真跑一次;每道练习的参考答案 |
| 688 | day-688-bs-grounded-1 | Day 688 · BillSleuth(八):两份解释两个读者,数字溯源校验器 | 溯源 | 旧 125 前两节 | 校验器测试;每道练习的参考答案 |
| 689 | day-689-bs-grounded-2 | Day 689 · BillSleuth(九):写作-校验-重写,校验器管不到的地方 | 重写循环 | 旧 125 后五节 | 接进调查图;每道练习的参考答案 |
| 690 | day-690-bs-credit-1 | Day 690 · BillSleuth(十):贷记单/退款/作废重开,谁来起草,状态机 | 状态机 | 旧 126 前三节 | 状态机测试;每道练习的参考答案 |
| 691 | day-691-bs-credit-2 | Day 691 · BillSleuth(十一):幂等键、审批签发、图在审批节点暂停 | 幂等;暂停 | 旧 126 后五节 | 审批恢复;每道练习的参考答案 |
| 692 | day-692-week99-review | Day 692 · 第 99 周复习:作品(Day 686–691) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 693 | day-693-bs-eval-1 | Day 693 · BillSleuth(十二):100 个场景和模拟客户 | 场景;模拟客户 | 旧 127 前两节 | 评测集;每道练习的参考答案 |
| 694 | day-694-bs-eval-2 | Day 694 · BillSleuth(十三):判分、跑评测、断点续跑、读报告 | 判分 | 旧 127 后五节 | 跑评测(留空回填);每道练习的参考答案 |
| 695 | day-695-bs-iterate-1 | Day 695 · BillSleuth(十四):先读再分桶再数,成功的运行也要读 | 错误分析 | 旧 128 前三节 | 分桶表;每道练习的参考答案 |
| 696 | day-696-bs-iterate-2 | Day 696 · BillSleuth(十五):组件级评测、改法、回归、判断提升是不是真的 | 回归 | 旧 128 后五节 | 回归对比;每道练习的参考答案 |
| 697 | day-697-bs-panel | Day 697 · BillSleuth(十六):子进程服务端、导出给 Loupe、调查面板 | 面板 | 旧 129 前五节 | 本地跑起来;每道练习的参考答案 |
| 698 | day-698-bs-deploy | Day 698 · BillSleuth(十七):两种部署方式 | Compose+Caddy;Fly.io | 旧 129 后三节 | 上线;每道练习的参考答案 |
| 699 | day-699-week100-review | Day 699 · 第 100 周复习:作品(Day 693–698) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 700 | day-700-bs-case-page | Day 700 · BillSleuth(十八):三种时长版本和案例页 | 案例页 | 旧 130 前两节 | 案例页;每道练习的参考答案 |
| 701 | day-701-fde-story | Day 701 · FDE 面试故事:两个作品怎么讲、怎么摆,作品篇结业 | 四段式 | 旧 130 后半 | 英文讲稿;每道练习的参考答案 |

### 第十二部分 · 总复习与结业(Day 702–710,9 天)

| Day | slug | 标题 | 今天只讲的知识点 | 来源 | 要实跑的代码/数据 |
| --- | --- | --- | --- | --- | --- |
| 702 | day-702-final-review-1 | Day 702 · 总复习(一):编程地基、LLM 与 API | 知识地图;错题重做 | 新写 | 重做 10 道旧练习;每道练习的参考答案 |
| 703 | day-703-final-review-2 | Day 703 · 总复习(二):工具调用、Agent 循环、RAG 与上下文 | 知识地图 | 新写 | 重跑检索评估;每道练习的参考答案 |
| 704 | day-704-final-review-3 | Day 704 · 总复习(三):MCP、LangGraph 与编排 | 知识地图 | 新写 | 10 分钟搭一张图;每道练习的参考答案 |
| 705 | day-705-final-review-4 | Day 705 · 总复习(四):评测、可观测、生产化与安全 | 知识地图 | 新写 | 跑一次全套门禁;每道练习的参考答案 |
| 706 | day-706-week101-review | Day 706 · 第 101 周复习:总复习(Day 700–705) | 知识地图;错题;默写本周核心代码 | 新写(汇总本周 6 天) | 默写一段本周核心代码并跑通;每道练习的参考答案 |
| 707 | day-707-final-review-5 | Day 707 · 总复习(五):进阶平台与模型层 | 知识地图 | 新写 | 画 AgentOps 全图;每道练习的参考答案 |
| 708 | day-708-mock-interview-1 | Day 708 · 模拟面试(一):基础题与现场编码 | 计时作答 | 新写 | 录音复盘;每道练习的参考答案 |
| 709 | day-709-mock-interview-2 | Day 709 · 模拟面试(二):系统设计与项目深挖 | 追问演练 | 新写 | 录音复盘;每道练习的参考答案 |
| 710 | day-710-graduation | Day 710 · 结业:回顾、作品、岗位和下一步 | 回顾 | 旧 130 结尾 + 旧 60/110 结业 | 自检表;每道练习的参考答案 |

## 3. 旧 → 新映射(用于 301)

旧路径 `/blog/agent-60/<旧文件名>/` 跳到新路径 `/blog/agent-zero/<新 slug>/`。一篇旧课拆成多天时跳到第一天。

| 旧文件 | 新路径 | 新标题 |
| --- | --- | --- |
| day-00-overview | /blog/agent-zero/day-000-overview/ | Day 0 · 开学第一课:AI Agent 工程师做什么,这门课怎么学 |
| day-01-what-llm-does | /blog/agent-zero/day-106-next-token/ | Day 106 · 大模型只做一件事:猜下一个 token |
| day-02-python-for-backend-devs | /blog/agent-zero/day-008-python-vs-node/ | Day 8 · 第一个 Python 程序:和 Node 比,Python 怎么跑 |
| day-03-first-api-call | /blog/agent-zero/day-120-api-register/ | Day 120 · 注册 API、充值和第一次调用 |
| day-04-messages-and-streaming | /blog/agent-zero/day-072-pytest-2/ | Day 72 · pytest(二):pythonpath、目录结构和只跑一个测试 |
| day-05-prompt-engineering | /blog/agent-zero/day-138-prompt-1/ | Day 138 · 提示词(一):把模型当聪明的新同事 |
| day-06-structured-output | /blog/agent-zero/day-049-type-hints-4/ | Day 49 · 类型标注(四):Protocol 和 TypeVar |
| day-07-week1-review-cli-chatbot | /blog/agent-zero/day-056-git-1/ | Day 56 · git(一):仓库、add、commit、log 和 diff |
| day-08-function-calling | /blog/agent-zero/day-156-fc-idea/ | Day 156 · Function calling:模型不会执行,它只写一段 JSON |
| day-09-agent-loop-from-scratch | /blog/agent-zero/day-033-packages/ | Day 33 · 包:__init__.py、-m 运行和从根目录跑 |
| day-10-react-and-planning | /blog/agent-zero/day-172-react-1/ | Day 172 · ReAct(一):论文在说什么 |
| day-11-tool-design | /blog/agent-zero/day-180-tool-design-1/ | Day 180 · 好工具(一):工具不是 API,使用者变了 |
| day-12-failure-modes | /blog/agent-zero/day-074-pytest-4/ | Day 74 · pytest(四):假对象和 monkeypatch |
| day-13-workflows-vs-agents | /blog/agent-zero/day-196-workflow-vs-agent/ | Day 196 · Workflow 还是 Agent:两个定义和一个构件 |
| day-14-week2-review-cli-agent | /blog/agent-zero/day-205-cli-agent-1/ | Day 205 · 小项目(一):命令行 Agent 骨架 |
| day-15-embeddings | /blog/agent-zero/day-212-why-vectors/ | Day 212 · 关键词搜索为什么不够 |
| day-16-first-rag | /blog/agent-zero/day-221-why-rag/ | Day 221 · RAG 为什么存在:两条流水线 |
| day-17-pgvector | /blog/agent-zero/day-228-postgres-basics/ | Day 228 · Postgres 入门:装 Postgres.app、psql 和建库 |
| day-18-retrieval-quality | /blog/agent-zero/day-235-bm25/ | Day 235 · BM25:老派但好用的关键词检索 |
| day-19-rag-evaluation | /blog/agent-zero/day-255-rag-eval-1/ | Day 255 · RAG 评估(一):为什么分两层 |
| day-20-context-engineering-memory | /blog/agent-zero/day-262-context-budget/ | Day 262 · 上下文工程(一):窗口大不等于该塞满,做预算 |
| day-21-week3-review-doc-qa | /blog/agent-zero/day-268-docqa-1/ | Day 268 · 小项目(一):文档问答 Agent 骨架和检索 |
| day-22-mcp-explained | /blog/agent-zero/day-271-mcp-why/ | Day 271 · MCP 是什么:每个应用都在重复接线 |
| day-23-build-mcp-server | /blog/agent-zero/day-280-mcp-seed/ | Day 280 · 写 MCP server(一):先把 CloudLedger 业务库造出来 |
| day-24-langgraph-basics | /blog/agent-zero/day-298-langchain-vs-langgraph/ | Day 298 · LangChain 和 LangGraph 是什么关系 |
| day-25-langgraph-hitl | /blog/agent-zero/day-315-lg-checkpoint-why/ | Day 315 · LangGraph(十四):没有 checkpoint 会怎样 |
| day-26-multi-agent | /blog/agent-zero/day-329-multi-agent-1/ | Day 329 · 多 Agent(一):两篇吵架的文章,多 Agent 带来什么 |
| day-27-frameworks-compared | /blog/agent-zero/day-296-skills-1/ | Day 296 · Agent Skills(一):Skill 是什么,写一个退款 skill |
| day-28-week4-review-ticket-router | /blog/agent-zero/day-338-router-project-1/ | Day 338 · 小项目(一):工单分流 Agent 设计和 MCP 工具 |
| day-29-why-evals | /blog/agent-zero/day-341-why-evals/ | Day 341 · 为什么评测是分水岭:「我试过了挺好的」不算数 |
| day-30-error-analysis | /blog/agent-zero/day-345-error-analysis-1/ | Day 345 · 错误分析(一):为什么不能跳过,流程长什么样 |
| day-31-test-sets | /blog/agent-zero/day-348-testcase-structure/ | Day 348 · 测试集(一):一条用例里该有什么 |
| day-32-llm-as-judge | /blog/agent-zero/day-355-llm-judge-1/ | Day 355 · LLM-as-judge(一):什么时候需要 |
| day-33-trajectory-eval | /blog/agent-zero/day-360-trajectory-1/ | Day 360 · 轨迹评测(一):结果和轨迹各管什么 |
| day-34-tracing-observability | /blog/agent-zero/day-364-tracing-concepts/ | Day 364 · Tracing(一):trace、span 和概念对齐 |
| day-35-week5-review-eval-ci | /blog/agent-zero/day-374-eval-project-1/ | Day 374 · 小项目(一):给工单 Agent 搭完整评测系统 |
| day-36-agent-as-service | /blog/agent-zero/day-378-agent-api/ | Day 378 · 把 Agent 做成服务:Agent 接口和普通接口差在哪 |
| day-37-long-running-reliability | /blog/agent-zero/day-387-queue-basics/ | Day 387 · 队列是什么:什么样的活要进队列 |
| day-38-cost-and-latency | /blog/agent-zero/day-396-cost-1/ | Day 396 · 成本(一):一张工单花多少钱 |
| day-39-prompt-injection | /blog/agent-zero/day-403-injection-1/ | Day 403 · 安全(一):注入的本质,直接和间接注入 |
| day-40-permissions-sandbox | /blog/agent-zero/day-411-permissions-1/ | Day 411 · 权限(一):过度授权的账和工具分级 |
| day-41-deploy | /blog/agent-zero/day-422-dockerfile-prod/ | Day 422 · 部署(一):Dockerfile 小、快、不用 root |
| day-42-week6-review-production | /blog/agent-zero/day-432-prod-project-1/ | Day 432 · 小项目(一):整合代码和上线检查清单 |
| day-43-capstone-kickoff | /blog/agent-zero/day-435-capstone-why/ | Day 435 · 开题:为什么做智能客服工单 |
| day-44-capstone-skeleton-data | /blog/agent-zero/day-441-repo-init/ | Day 441 · 搭骨架(一):建仓库,uv、ruff、pytest、pre-commit |
| day-45-capstone-rag | /blog/agent-zero/day-448-kb-chunk/ | Day 448 · 知识库(一):按小标题切块,给每块戴帽子 |
| day-46-capstone-tools-mcp | /blog/agent-zero/day-452-tools-rules/ | Day 452 · 业务工具(一):工具层的四条规矩和业务函数 |
| day-47-capstone-workflow | /blog/agent-zero/day-457-flow-client-state/ | Day 457 · 主工作流(一):LLMClient 加三样东西,状态设计 |
| day-48-capstone-memory | /blog/agent-zero/day-464-memory-session/ | Day 464 · 记忆(一):工单内的对话状态 |
| day-49-capstone-ui | /blog/agent-zero/day-467-ui-api/ | Day 467 · 界面(一):并发成本 bug、接口设计和 SSE 事件协议 |
| day-50-capstone-eval | /blog/agent-zero/day-476-eval-scenarios/ | Day 476 · 评测(一):从验收指标到评测项,场景×说法 |
| day-51-capstone-iterate | /blog/agent-zero/day-480-iterate-1/ | Day 480 · 迭代(一):先读再分类再数,我踩到的四个坑 |
| day-52-capstone-observability-cost | /blog/agent-zero/day-484-obs-langfuse/ | Day 484 · 可观测(一):接 Langfuse,给节点套 observe |
| day-53-capstone-security-deploy | /blog/agent-zero/day-487-threat-model/ | Day 487 · 安全(一):画信任边界,注入测试集 |
| day-54-capstone-packaging | /blog/agent-zero/day-491-readme-arch/ | Day 491 · 作品包装(一):面试官的 5 分钟,README 和架构图 |
| day-55-second-project-code-review-agent | /blog/agent-zero/day-494-code-review-1/ | Day 494 · 第二作品(一):代码审查机器人,取 diff 算行号,结构化意见 |
| day-56-resume | /blog/agent-zero/day-498-resume-1/ | Day 498 · 简历(一):招聘方要什么,关键词对照表 |
| day-57-interview-fundamentals | /blog/agent-zero/day-502-interview-1/ | Day 502 · 面试(一):模型、提示词与结构化输出题 |
| day-58-interview-system-design | /blog/agent-zero/day-507-live-coding/ | Day 507 · 面试(五):10 分钟手写 Agent 循环 |
| day-59-job-search-salary | /blog/agent-zero/day-511-job-channels/ | Day 511 · 求职(一):数据从哪来,渠道和薪资 |
| day-60-graduation | /blog/agent-zero/day-516-basic-graduation/ | Day 516 · 普通篇结业:能力自检和接下来怎么进阶 |
| day-61-senior-overview | /blog/agent-zero/day-518-senior-gap/ | Day 518 · 进阶开学(一):资深岗贵多少,中级和资深差在哪 |
| day-62-harness-design | /blog/agent-zero/day-520-harness-parts/ | Day 520 · Harness(一):harness 包了哪些东西 |
| day-63-context-at-scale | /blog/agent-zero/day-526-context-rot/ | Day 526 · 上下文进阶(一):上下文腐烂 |
| day-64-memory-systems | /blog/agent-zero/day-532-memory-taxonomy/ | Day 532 · 记忆系统(一):把记忆拆开,四个设计问题 |
| day-65-durable-execution | /blog/agent-zero/day-535-durable-1/ | Day 535 · 持久化执行(一):记日志,然后重放 |
| day-66-orchestration-patterns | /blog/agent-zero/day-540-orch-1/ | Day 540 · 编排取舍(一):三篇文章三种立场,四种架构 |
| day-67-w10-review | /blog/agent-zero/day-542-design-doc-1/ | Day 542 · 设计文档(一):设计文档写什么 |
| day-68-eval-as-product | /blog/agent-zero/day-544-eval-org/ | Day 544 · 评测是产品(一):一个人和一个团队的评测,资产生命周期 |
| day-69-statistics-for-evals | /blog/agent-zero/day-547-eval-stats-1/ | Day 547 · 评测统计学(一):通过率区间,别再用 p±1.96·SE |
| day-70-judge-at-scale | /blog/agent-zero/day-551-judge-scale-1/ | Day 551 · 大规模评审(一):校准集差评太少,校正后的通过率带区间 |
| day-71-online-eval-ab | /blog/agent-zero/day-554-online-ab-1/ | Day 554 · 线上评测(一):离线和线上,实验五要素,指标 |
| day-72-red-teaming | /blog/agent-zero/day-556-redteam-1/ | Day 556 · 自动化红队(一):测什么,组合攻击,只看行为的检测器 |
| day-73-benchmark-design | /blog/agent-zero/day-558-bench-1/ | Day 558 · benchmark(一):拆解 τ-bench 和 SWE-bench |
| day-74-w11-review | /blog/agent-zero/day-562-eval-platform/ | Day 562 · 给 AgentOps 设计评测平台,MR 对比报告 |
| day-75-model-selection | /blog/agent-zero/day-563-model-selection-1/ | Day 563 · 选模型(一):榜单为什么不能直接用,六个维度 |
| day-76-self-hosting | /blog/agent-zero/day-567-self-host-1/ | Day 567 · 自部署(一):什么时候值得,显存账 |
| day-77-fine-tuning-lora | /blog/agent-zero/day-570-finetune-1/ | Day 570 · 微调(一):提示词、RAG、微调各管什么,造训练集 |
| day-78-preference-tuning | /blog/agent-zero/day-575-dpo-1/ | Day 575 · DPO(一):从 RLHF 到 DPO,变体,偏好数据从哪来 |
| day-79-distillation-routing | /blog/agent-zero/day-577-distill-1/ | Day 577 · 蒸馏(一):三种蒸馏,规模化打标,学生选多大 |
| day-80-rl-for-agents | /blog/agent-zero/day-579-rl-1/ | Day 579 · 强化学习(一):模仿和试错,RLVR 和 GRPO |
| day-81-w12-review | /blog/agent-zero/day-582-router-pipeline/ | Day 582 · 给 AgentOps 训练路由小模型:流水线、数据卡、模型卡 |
| day-82-platform-architecture | /blog/agent-zero/day-583-platform-1/ | Day 583 · 平台(一):什么时候该做平台,平台给什么,租户是谁 |
| day-83-model-gateway | /blog/agent-zero/day-586-gateway-1/ | Day 586 · 模型网关(一):网关管什么,买还是写,按 token 限流 |
| day-84-mcp-gateway-auth | /blog/agent-zero/day-589-mcp-gw-1/ | Day 589 · MCP 网关(一):2026 规范变化和远程授权流程 |
| day-85-observability-at-scale | /blog/agent-zero/day-593-obs-scale-1/ | Day 593 · 规模化可观测(一):trace 有多大,链路连起来,agent span 命名 |
| day-86-governance-compliance | /blog/agent-zero/day-596-governance-1/ | Day 596 · 治理合规(一):从安全问卷倒推,国内要求,欧盟 AI Act |
| day-87-incident-response | /blog/agent-zero/day-600-incident-1/ | Day 600 · 事故复盘(一):三起事故,六类事故,头 15 分钟 |
| day-88-w13-review | /blog/agent-zero/day-603-platform-review/ | Day 603 · 平台架构评审:AgentOps 平台设计文档 |
| day-89-coding-agents-internals | /blog/agent-zero/day-604-coding-agents-1/ | Day 604 · Coding Agent 内部(一):五块拆解,SWE-agent 和 mini-swe-agent |
| day-90-computer-browser-use | /blog/agent-zero/day-606-computer-use-1/ | Day 606 · Computer Use(一):三条路线,2026 年的接口 |
| day-91-voice-agents | /blog/agent-zero/day-610-voice-1/ | Day 610 · 语音 Agent(一):人说话的节奏,级联还是端到端,延迟花在哪 |
| day-92-deep-research-agents | /blog/agent-zero/day-612-deep-research-1/ | Day 612 · Deep Research(一):和 RAG 差在哪,典型架构,读 open_deep_research |
| day-93-agent-protocols | /blog/agent-zero/day-614-a2a-1/ | Day 614 · Agent 互联(一):三层协议,A2A 走到哪一步 |
| day-94-agent-product-ux | /blog/agent-zero/day-619-agent-ux-1/ | Day 619 · Agent 产品(一):自主程度、动作分级、透明度 |
| day-95-w14-review | /blog/agent-zero/day-623-tech-selection/ | Day 623 · 前沿技术选型报告:打分矩阵和敏感性分析 |
| day-96-agentops-kickoff | /blog/agent-zero/day-624-agentops-kickoff-1/ | Day 624 · AgentOps 开题(一):真的需要平台吗,包含什么,控制面数据面 |
| day-97-agentops-gateway | /blog/agent-zero/day-626-agentops-gw-1/ | Day 626 · AgentOps(一):网关里一个请求走过的路,价格表和供应商 |
| day-98-agentops-mcp-hub | /blog/agent-zero/day-628-agentops-mcp-1/ | Day 628 · AgentOps(三):MCP 代理,注册上游,默认拒绝 |
| day-99-agentops-runtime | /blog/agent-zero/day-631-agentops-rt-1/ | Day 631 · AgentOps(五):持久化什么,数据层,租约漏洞 |
| day-100-agentops-eval-platform | /blog/agent-zero/day-633-agentops-eval/ | Day 633 · AgentOps(七):评测平台,数据集指纹、统计工具、A/B |
| day-101-agentops-router-model | /blog/agent-zero/day-634-agentops-router/ | Day 634 · AgentOps(八):级联路由进网关和 shadow 模式 |
| day-102-agentops-observability | /blog/agent-zero/day-635-agentops-obs/ | Day 635 · AgentOps(九):全链路可观测和成本看板 |
| day-103-agentops-security | /blog/agent-zero/day-637-agentops-sec/ | Day 637 · AgentOps(十):安全加固,隔离测试、指纹、哈希链、按钱熔断、红队进 CI |
| day-104-agentops-load-test | /blog/agent-zero/day-638-agentops-load/ | Day 638 · AgentOps(十一):压测、剖析、容量规划和部署 |
| day-105-agentops-showcase | /blog/agent-zero/day-639-agentops-showcase/ | Day 639 · AgentOps(十二):包装成资深级作品 |
| day-106-design-docs-adr | /blog/agent-zero/day-640-design-docs-1/ | Day 640 · 设计文档和 ADR:为什么是资深的主要产出,骨架和取舍 |
| day-107-staff-system-design | /blog/agent-zero/day-642-staff-sd-1/ | Day 642 · Staff 系统设计(一):面试官看什么,45 分钟框架,真题一 |
| day-108-lead-and-influence | /blog/agent-zero/day-645-influence/ | Day 645 · 带人和推动:一页纸、让别人自愿迁移、带新人、回应「AI 不靠谱」 |
| day-109-open-source-brand | /blog/agent-zero/day-646-open-source-1/ | Day 646 · 开源影响力(一):JD 怎么说,第一个 PR,贡献阶梯,AI 生成的 PR |
| day-110-senior-graduation | /blog/agent-zero/day-648-senior-graduation/ | Day 648 · 进阶结业:资深自检、市场数据、找岗位和谈薪 |
| day-111-loupe-kickoff | /blog/agent-zero/day-649-loupe-why/ | Day 649 · Loupe 开题(一):调 Agent 痛在看不清每一步,现有工具做到哪 |
| day-112-loupe-trace-model | /blog/agent-zero/day-652-loupe-model/ | Day 652 · Loupe(一):两个数据模型,字段一个个想清楚 |
| day-113-loupe-server | /blog/agent-zero/day-658-loupe-schema/ | Day 658 · Loupe(六):先定接口再定表,表设计 |
| day-114-loupe-timeline | /blog/agent-zero/day-661-loupe-types/ | Day 661 · Loupe(九):前后端契约类型和三个小工具 |
| day-115-loupe-step-inspector | /blog/agent-zero/day-665-loupe-messages/ | Day 665 · Loupe(十二):渲染消息和详情面板 |
| day-116-loupe-diff | /blog/agent-zero/day-667-loupe-diff-1/ | Day 667 · Loupe(十四):为什么不能直接 diff,步骤签名 |
| day-117-loupe-replay | /blog/agent-zero/day-669-loupe-replay-1/ | Day 669 · Loupe(十六):重跑到底要「重」什么,磁带的键,重建上下文 |
| day-118-loupe-eval-bridge | /blog/agent-zero/day-672-loupe-eval-1/ | Day 672 · Loupe(十八):步级和端到端两种用例,快照和断言 |
| day-119-loupe-deploy | /blog/agent-zero/day-674-loupe-deploy-1/ | Day 674 · Loupe(二十):演示站开放什么,脱敏、限流、CORS |
| day-120-loupe-showcase | /blog/agent-zero/day-676-loupe-showcase/ | Day 676 · Loupe(二十二):开源发布与作品包装 |
| day-121-billsleuth-kickoff | /blog/agent-zero/day-677-bs-why/ | Day 677 · BillSleuth 开题(一):为什么选计费争议,订阅计费十分钟入门 |
| day-122-billsleuth-engine-data | /blog/agent-zero/day-680-bs-engine-1/ | Day 680 · BillSleuth(一):金额只走一个函数,事件是事实订阅是快照 |
| day-123-billsleuth-tools | /blog/agent-zero/day-683-bs-tools/ | Day 683 · BillSleuth(四):MCP 工具层、复算工具、Inspector 和测试 |
| day-124-billsleuth-investigator | /blog/agent-zero/day-684-bs-flow/ | Day 684 · BillSleuth(五):流程为什么拆段,模型对象和 MCP 桥接 |
| day-125-billsleuth-grounded-answer | /blog/agent-zero/day-688-bs-grounded-1/ | Day 688 · BillSleuth(八):两份解释两个读者,数字溯源校验器 |
| day-126-billsleuth-approval | /blog/agent-zero/day-690-bs-credit-1/ | Day 690 · BillSleuth(十):贷记单/退款/作废重开,谁来起草,状态机 |
| day-127-billsleuth-eval | /blog/agent-zero/day-693-bs-eval-1/ | Day 693 · BillSleuth(十二):100 个场景和模拟客户 |
| day-128-billsleuth-iterate | /blog/agent-zero/day-695-bs-iterate-1/ | Day 695 · BillSleuth(十四):先读再分桶再数,成功的运行也要读 |
| day-129-billsleuth-demo | /blog/agent-zero/day-697-bs-panel/ | Day 697 · BillSleuth(十六):子进程服务端、导出给 Loupe、调查面板 |
| day-130-portfolio-graduation | /blog/agent-zero/day-700-bs-case-page/ | Day 700 · BillSleuth(十八):三种时长版本和案例页 |
| day-131-agent-skills | /blog/agent-zero/day-296-skills-1/ | Day 296 · Agent Skills(一):Skill 是什么,写一个退款 skill |
| day-132-code-as-action | /blog/agent-zero/day-186-codeact-1/ | Day 186 · 代码即动作(一):JSON 工具调用卡在哪,CodeAct 在说什么 |
| day-133-tool-search | /blog/agent-zero/day-184-tool-search-1/ | Day 184 · 工具多了怎么办(一):先量一下 60 个工具有多贵 |
| day-134-reasoning-models | /blog/agent-zero/day-115-reasoning-models/ | Day 115 · 推理模型和思考模式 |
| day-135-coding-agent-workflow | /blog/agent-zero/day-210-coding-agent-1/ | Day 210 · 用 Coding Agent 干活(一):AGENTS.md 和 CLAUDE.md |
| day-136-multimodal-doc-parsing | /blog/agent-zero/day-245-vision-1/ | Day 245 · 多模态(一):模型怎么「看」图,第一次发图 |
| day-137-graphrag | /blog/agent-zero/day-250-kg-basics/ | Day 250 · 知识图谱三分钟入门:实体、关系和三元组 |
| day-138-text-to-sql | /blog/agent-zero/day-291-text-to-sql-1/ | Day 291 · 问数 Agent(一):给模型一份库说明书 |
| day-139-ambient-agents | /blog/agent-zero/day-325-ambient-1/ | Day 325 · 后台 Agent(一):聊天窗口之外,三种触发源,事件表 |
| day-140-low-code-platforms | /blog/agent-zero/day-336-low-code-1/ | Day 336 · 低代码平台(一):Dify、扣子、百炼、n8n 现状,同一流程画 vs 写 |
| day-141-java-go-agents | /blog/agent-zero/day-430-java-go-1/ | Day 430 · 用 Java 和 Go 写 Agent(一):全景和 Spring AI |
| day-142-typescript-agents | /blog/agent-zero/day-473-ts-agents-1/ | Day 473 · 用 TypeScript 写 Agent(一):选择、结构和 AI SDK 的 ToolLoopAgent |
| day-143-prompt-optimization | /blog/agent-zero/day-368-prompt-opt-1/ | Day 368 · 自动优化提示词(一):手调的天花板,DSPy、GEPA、ACE 是什么 |
| day-144-feedback-flywheel | /blog/agent-zero/day-372-feedback-1/ | Day 372 · 反馈闭环(一):显式和隐式反馈怎么采 |
| day-145-guardrails | /blog/agent-zero/day-409-guardrails-1/ | Day 409 · Guardrails(一):管什么,三种检查器 |
| day-146-supply-chain-security | /blog/agent-zero/day-417-supply-chain-1/ | Day 417 · 供应链安全(一):你装的是会跟模型说话的代码 |
| day-147-managed-agent-runtimes | /blog/agent-zero/day-429-managed-runtimes/ | Day 429 · 托管 Agent 运行时:自建还是租 |
| day-148-generative-ui | /blog/agent-zero/day-621-generative-ui/ | Day 621 · 生成式 UI:MCP Apps、A2UI、AG-UI 三条路线和安全(不讲前端框架) |
| day-149-agent-identity | /blog/agent-zero/day-591-identity-1/ | Day 591 · Agent 身份(一):四种错误做法,工作负载身份 |
| day-150-webmcp | /blog/agent-zero/day-609-webmcp/ | Day 609 · WebMCP:让网站直接给浏览器 Agent 暴露工具 |
| day-151-agent-payments | /blog/agent-zero/day-617-payments-1/ | Day 617 · Agent 支付(一):三层拆解,x402 |
| day-152-china-agent-compliance | /blog/agent-zero/day-598-china-compliance-1/ | Day 598 · 国内智能体合规(一):时间线和《实施意见》四条 |
| day-153-industry-cases | /blog/agent-zero/day-514-industry-1/ | Day 514 · 行业里的 Agent(一):JD 行业分布和换行业的五样东西 |

## 4. 站长的学习安排

站长等全部写完后**从 Day 0 重新学**,按三步学法一天一课,不跳读。旧课里已经学过的内容(旧 Day 0–24)在新课里都还在,重新学时正好按「默写 + 做练习看参考答案」再过一遍。

## 5. 写作规范要新增的「0 基础规则」(草案)

1. **读者只会前端**:默认读者熟悉 HTML/CSS/JS/TS/React、npm、DevTools,其他全 0 基础。Python 语法和工具一律给 JS/TS 对照(写成一张小表或一句「相当于 JS 里的 …」);后端、数据库、运维概念先从前端看得到的现象讲起(DevTools 里看到的请求,在服务端是怎么被处理的),再讲原理;数学和统计先给直觉和一个能跑的模拟,公式放最后。前端知识不解释。
2. **每个术语第一次出现就解释**:一句大白话 + 一个具体例子;同一篇里第二次出现不再解释,但要进当天的「名词解释」表。前面某天学过的术语,第一次在新的一天用到时给一句话提醒并链接到它首次出现的那一天。
3. **一天最多两个新概念**:标题写的是什么,当天就只讲它;塞不下就拆天,不压缩。
4. **一步一个可跑脚本**:新概念先用 10–30 行、不花钱或只花几分钱的最小脚本演示,跑出真实输出;每一步只比上一步多一个新东西;完整的大代码放在最后一天拼,并附一张「零件 → 大代码哪一段」的对照表。
5. **每段代码都有 line-notes**:逐行(至少每个有意义的行)解释,代入实跑出来的具体值;跑不了的(没有 key、要 GPU)明确写「这段没实跑」并说明原因。输出贴真实结果,不编。
6. **开头和结尾的桥**:「今天要解决的问题」前加「上一课回顾」(三五句);「明天预告」写下一课标题关键词和为什么紧接着今天。
7. **不跳步**:命令写全(在哪个目录跑、先装什么);文件路径写全;每个依赖写 `uv add` 的那一行;前面某天建的文件,用到时写清「这是 Day N 建的 xxx.py」。
8. **报错先演示一次**:每个常见坑(忘了 reducer、漏回 tool 消息、路径不对)都故意制造一次,贴真实报错,再讲怎么修。
9. **用时写实**:每天 1.5–3 小时;超过 3 小时就拆天。复习日和项目日可以到 4 小时。
10. **长度讲透为止**:不设上下限;但一天只讲一两件事,长主要来自例子、输出和逐行讲解,而不是多塞概念。
11. **每道练习都有参考答案**:放在题目后面的 `<details><summary>参考答案</summary>` 里(先自己做再展开);代码完整可跑,带 line-notes 逐行讲解并代入实跑数据,附真实输出。开放题(比如「改一下分类定义」)给一个示范解法,并贴实跑的前后对比。
