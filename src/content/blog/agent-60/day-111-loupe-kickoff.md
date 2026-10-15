---
title: 'Day 111 · 作品一开题:Agent Loupe,一个给 Agent 用的调试器'
description: '作品篇开工。先回答为什么要做一个 Agent 调试器、现有的 Langfuse、LangSmith、Phoenix 已经做到哪一步、还缺什么,再把 PRD、架构、仓库骨架和十天里程碑定下来。今天写的代码不多,但后面九天都照着它施工。'
pubDate: 2026-10-15
regime: none
tags: ['agent-loupe', 'portfolio', 'devtools', 'observability', 'agent-60']
series: 'agent-60'
day: 111
lang: 'zh'
---

## 今天要解决的问题

进阶篇学完,你手里有 SupportPilot 和 AgentOps 两个项目。它们证明了你学会了课程里的东西,但它们有一个共同的弱点:跟着这门课走的每个人都能做出差不多的版本。招聘方看十份简历,七份写着「智能客服 Agent」,这时候你的项目再好也很难被记住。

作品篇的两个项目就是冲着这个问题来的。第一个叫 **Agent Loupe**,一个给 Agent 用的调试器。loupe 是珠宝师和钟表匠夹在眼睛上的那种放大镜,我们要做的就是一个能把 Agent 每一步看清楚的放大镜。

今天不急着写功能,先把下面几件事做完:

1. 说清楚调试 Agent 到底痛在哪,用一条真实的运行记录做例子。
2. 查清楚 Langfuse、LangSmith、Arize Phoenix、OpenAI Traces 现在已经能做什么,找出它们没做好、而我们十天内做得完的那几个点。
3. 写一份 PRD:用户故事、功能清单、非目标、验收指标。
4. 画出架构图,定下仓库结构,把后端和前端的空骨架跑起来。
5. 排出 Day 111 到 Day 120 的里程碑,并且想清楚招聘方点开这个项目时会看什么。

预计用时 4 到 5 小时,一半时间在读竞品文档和写 PRD。前置:Day 9 的 `agent_loop.py` 和 `day09_demo.py`(Day 112 要用它们产出第一条 trace),Day 34 的 Langfuse 接入(你需要知道 trace、span、generation 这些词),Day 49 用过的 React 基础。没写过 React 也没关系,前端从 Day 114 才开始,到时候每个组件都会给完整代码。

## 调试 Agent,痛在看不清每一步

先说一件我自己碰到的事。写这一篇之前,我把 Day 9 的 Agent 用 DeepSeek 跑了一遍,任务还是那个:读 `cities.txt`,查三个城市的气温,算平均值。结果对了,总共 24.1 秒。

24 秒对一个查天气的任务来说太慢了。问题出在哪?终端里那几行日志只告诉你调用了什么,没告诉你每一步花了多久、模型每次看到了什么。我把这次运行的记录导进了这个项目做出来的界面(就是你 Day 114 会写完的那个时间轴),一眼就看到了原因:

- 4 次模型调用加起来大约 8 秒。
- 3 次 `get_weather` 分别是 5.0、5.3、5.6 秒,**一个接一个跑的**,加起来接近 16 秒。

模型在第二轮已经一次给出了三个工具调用(Day 8 讲的并行工具调用),但 Day 9 的循环是 `for tc in msg.tool_calls` 顺序执行的。换成 Day 8 学的 `asyncio.gather`,这 16 秒能压到 6 秒左右。这个改动本身很简单,难的是**发现**它。

再往下看,点开第二次模型调用,上下文构成那条横条显示:这一步一共 639 个输入 token,其中工具定义大约占了 68%。三个工具的 JSON Schema 比用户的问题、系统提示词、上一轮的结果加起来还长。这也不是 bug,但如果你在做一个有 20 个工具的 Agent,这个比例就值得警惕了,Day 11 讲工具数量太多的问题,在这里能直接看到。

这就是调试 Agent 和调试普通程序最不一样的地方。普通程序出错,你有堆栈、断点、单步执行;Agent 出错,往往没有报错,只是慢了、贵了、绕路了、答偏了。你需要的是:**把每一步的输入、输出、耗时、token 摆在一个时间轴上,能点开看任意一步模型到底看到了什么**。再进一步:改了提示词以后,两次运行从哪一步开始分叉;能不能从第 5 步开始改个参数重跑,而不用从头再来一遍。

## 已经有的工具做到了哪一步

动手之前得先查一圈。做一个别人已经做好的东西,作品集里是减分的。下面是我 2026 年 10 月查官方文档得到的情况,只写查到的,没查到的不猜。

**Langfuse**。开源、可以自己部署,Day 34 我们已经接过。trace 详情页能看到嵌套的 observation 树,每个 generation 有输入输出和 token、成本。2025 年起支持了 agent、tool、retriever 等十种 observation 类型。它的 [Playground 文档](https://langfuse.com/docs/playground)写得很清楚:在 generation 详情页点「Open in Playground」,可以把这一次模型调用搬进 playground,改提示词和参数重新跑,多个版本并排比较。注意它搬的是**单次模型调用**,不是整条 Agent 运行。

**LangSmith**。LangChain 家的商业平台,tracing、评测、数据集都有。和 LangGraph 结合时有一个重要能力:[time travel](https://docs.langchain.com/oss/python/langgraph/use-time-travel)。LangGraph 每一步都存 checkpoint,你可以回到任意一个 checkpoint,原样重放(replay)或者改了状态之后分叉(fork)继续跑,分叉出来的运行会保存在历史里。文档特别提醒:checkpoint 之后的节点会真的重新执行,包括模型调用和 API 请求,所以结果可能和原来不一样。这正是我们 Day 117 要处理的问题,而它的前提是你的 Agent 写在 LangGraph 里。

**Arize Phoenix**。基于 OpenTelemetry 的可观测工具,可以自己部署。它有一个叫 [Span Replay](https://arize.com/docs/phoenix/prompt-engineering/overview-prompts/span-replay) 的功能:把一个已经记录下来的 LLM span 加载进 prompt playground,换模型、改参数、改提示词重新跑。和 Langfuse 一样,粒度是一次模型调用。

**OpenAI Traces**。OpenAI Agents SDK [默认开启 tracing](https://openai.github.io/openai-agents-python/tracing/),会记录模型生成、工具调用、handoff、guardrail 等事件,在 OpenAI 平台的 Traces 面板里看。它主要服务于用 Agents SDK、调 OpenAI 模型的项目,而且对开了零数据保留(ZDR)的组织不可用。

把这四家放在一起看,它们都把「记录」和「看」做得很好,在下面三件事上留了空间:

1. **两条运行逐步对比**。它们普遍能比较评测实验的分数,或者并排比较几个 prompt 版本的单次输出,但「同一个任务跑两次,第几步开始不一样、不一样在哪」这种逐步对齐的视图,我在文档里没有找到现成的。
2. **从中间某一步重跑整条 Agent**。Langfuse 和 Phoenix 的重跑粒度是单次模型调用;LangGraph 的 time travel 能从中间分叉整条运行,但要求 Agent 写在 LangGraph 里并且有 checkpointer。对一个手写循环的 Agent(比如你 Day 9 写的那个),从第 N 步改参数接着跑,还没有顺手的工具。
3. **上下文占用的可视化**。它们会告诉你一次调用用了多少 token,但「这 639 个 token 里,工具定义、历史、工具结果各占多少,是哪一步把上下文撑大的」,需要你自己点开 JSON 去数。

这三点就是 Agent Loupe 的卖点。我们不和它们比谁的 tracing 更全、谁的评测功能更多,我们只把这三件事做到好用。这个判断很重要,面试官十有八九会问「为什么不直接用 Langfuse」,你要能说出上面这三点,并且承认在其他方面它们比你做得好。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="Agent Loupe 和现有工具的能力对照:记录和查看已经很成熟,逐步对比、中途重跑、上下文可视化是空白">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="28" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">调试一条 Agent 运行需要的能力</text>
  <rect x="20" y="45" width="190" height="44" fill="none" stroke="var(--rule)"/>
  <text x="115" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">记录每一步</text>
  <rect x="225" y="45" width="190" height="44" fill="none" stroke="var(--rule)"/>
  <text x="320" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">树状/时间轴查看</text>
  <rect x="430" y="45" width="190" height="44" fill="none" stroke="var(--rule)"/>
  <text x="525" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">单次调用改了重跑</text>
  <text x="320" y="112" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">↑ Langfuse / LangSmith / Phoenix / OpenAI Traces 都已经做得很好</text>
  <rect x="20" y="140" width="190" height="56" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="115" y="164" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">两次运行逐步对比</text>
  <text x="115" y="183" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">Day 116</text>
  <rect x="225" y="140" width="190" height="56" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="320" y="164" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">从第 N 步改参数重跑</text>
  <text x="320" y="183" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">Day 117</text>
  <rect x="430" y="140" width="190" height="56" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="525" y="164" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">上下文构成可视化</text>
  <text x="525" y="183" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">Day 115</text>
  <text x="320" y="222" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">↑ Agent Loupe 主攻这三块,前三块做到够用即可</text>
  <rect x="120" y="244" width="400" height="36" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="320" y="267" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">失败步骤一键变评测用例(Day 118)</text>
</svg>
<figcaption>前三块是基础设施,我们做到够用;蓝色三块是这个项目存在的理由。琥珀色那块把调试器和 W5 学的评测接起来。</figcaption>
</figure>

## PRD:写给自己,也写给面试官

PRD 不用长,但必须写。它有两个读者:一个是十天后快要失去耐心的你,另一个是面试时问「你这个项目的目标用户是谁、为什么这么设计」的面试官。下面这份是我写的,你可以直接改成自己的。

**一句话**:Agent Loupe 是一个本地或自托管的网页工具,导入 Agent 的运行记录,按时间轴回放每一步,支持两次运行逐步对比、从任意一步改参数重跑、把失败步骤存成评测用例。

**目标用户**:正在开发 Agent 的工程师,自己写循环或者用轻量框架,手头已经有一些 trace(Langfuse 导出、OpenTelemetry、或者干脆是自己打的日志),想搞清楚「这一次为什么慢 / 为什么贵 / 为什么答偏了」。

**用户故事**(每一条对应一个能演示的功能):

1. 作为开发者,我把一份 trace 文件拖进来,马上看到一条时间轴,哪一步最慢、哪一步报错,一眼可见。
2. 我点开任意一步,能看到这一次模型调用收到的完整 messages、工具定义、它返回的 tool_calls 和思考内容。
3. 我能看到每次模型调用的上下文里,系统提示词、工具定义、历史对话、工具结果各占多少 token,以及上下文是在哪一步突然变大的。
4. 我改了系统提示词又跑了一次,想知道两次运行从第几步开始不一样、每一步差在哪。
5. 我想从第 5 步开始换个模型重跑,前 4 步的工具结果直接复用,不要真的再查一遍天气。
6. 我发现第 7 步答错了,想一键把它存成评测用例,以后每次改代码都跑一遍。
7. 我想把这个工具公开给别人试用,但不能让陌生人用我的 API key 跑出一大笔账单。

**非目标**(这一节比功能清单更重要):

- 不做生产环境的实时监控和告警。那是 Langfuse 和 Day 85 规模化可观测的事,我们只处理已经导出的 trace。
- 不做多用户、权限、团队协作。一个人用,或者公开一个只读演示。
- 不做 prompt 管理、数据集管理、在线评测打分。评测只做到「把用例导出成 Day 35 的格式」。
- 不支持流式输出的逐 token 回放。
- 不追求兼容所有 trace 格式,只做三种:OpenTelemetry GenAI 约定的 OTLP JSON、Langfuse 公开 API 的导出、我们自己的轻量 SDK。

**验收指标**(先定目标,做完以后实测回填,不达标就在 README 里如实写):

| 指标 | 目标 | 实测(Day 119 回填) |
| --- | --- | --- |
| 1 万步 trace 打开到首屏可交互 | 2 秒内(本地,开发机) | |
| 1 万步 trace 时间轴滚动 | 不出现明显掉帧,Performance 面板里没有超过 50ms 的长任务 | |
| 两次 30 步运行的对比 | 1 秒内出结果,对齐结果和人工判断一致 | |
| 从第 N 步重跑 | 前 N-1 步的工具调用 100% 走回放,不产生真实请求 | |
| 公开演示 | 每日花费有硬上限,超出后重跑接口返回 429 | |
| 测试 | 后端 pytest 全绿;前端 `tsc --noEmit` 和 `build` 通过 | |

目标里写「本地,开发机」是因为性能数字离开机器就没意义。我的机器是一台 2019 年的 13 寸 Intel MacBook Pro,如果它能达标,招聘方的电脑一般也没问题。

## 架构:三层,两个进程

<figure>
<svg viewBox="0 0 640 360" role="img" aria-label="Agent Loupe 架构图:三种 trace 来源经导入器进入 SQLite,FastAPI 提供接口,React 前端展示时间轴、详情、对比和重跑">
  <rect x="0" y="0" width="640" height="360" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">trace 来源</text>
  <rect x="20" y="38" width="150" height="34" fill="none" stroke="var(--rule)"/>
  <text x="95" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">loupe_sdk JSONL</text>
  <rect x="20" y="80" width="150" height="34" fill="none" stroke="var(--rule)"/>
  <text x="95" y="102" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">OTLP JSON(gen_ai.*)</text>
  <rect x="20" y="122" width="150" height="34" fill="none" stroke="var(--rule)"/>
  <text x="95" y="144" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">Langfuse 导出</text>
  <line x1="170" y1="97" x2="215" y2="97" stroke="var(--ink-soft)" marker-end="url(#a111)"/>
  <rect x="215" y="38" width="200" height="190" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="315" y="58" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">server/(FastAPI)</text>
  <text x="230" y="84" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">importers → 统一 Run/Step</text>
  <text x="230" y="106" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">pricing → 补成本</text>
  <text x="230" y="128" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">db → SQLite loupe.db</text>
  <text x="230" y="150" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">diff → 步骤对齐</text>
  <text x="230" y="172" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">replay → 回放/重跑</text>
  <text x="230" y="194" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">eval-cases → 导出用例</text>
  <text x="230" y="216" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">/api/* JSON 接口</text>
  <line x1="415" y1="133" x2="460" y2="133" stroke="var(--ink-soft)" marker-end="url(#a111)"/>
  <line x1="460" y1="150" x2="415" y2="150" stroke="var(--ink-soft)" marker-end="url(#a111)"/>
  <rect x="460" y="38" width="160" height="190" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="540" y="58" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">web/(React)</text>
  <text x="472" y="84" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">运行列表</text>
  <text x="472" y="106" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">时间轴 + 详情面板</text>
  <text x="472" y="128" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">上下文/成本图</text>
  <text x="472" y="150" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">对比页</text>
  <text x="472" y="172" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">重跑表单</text>
  <text x="472" y="194" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">评测用例页</text>
  <rect x="215" y="262" width="200" height="40" fill="none" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
  <text x="315" y="287" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">LLM_BASE_URL(只在重跑时用)</text>
  <line x1="315" y1="228" x2="315" y2="262" stroke="var(--ink-soft)" stroke-dasharray="3 3" marker-end="url(#a111)"/>
  <text x="320" y="335" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">开发时两个进程:uvicorn :8000 + vite :5173,vite 把 /api 转发给后端</text>
  <defs><marker id="a111" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>琥珀色的后端负责「把各种格式变成同一种数据并存起来」,蓝色的前端负责「看」。只有重跑会去调模型,其他功能完全离线。</figcaption>
</figure>

几个关键决定,每一个我都写一下为什么。

**统一数据模型,导入时转换**。三种来源格式差别很大:OTLP 的属性是一个 key-value 数组,消息是 `{role, parts: [...]}` 的结构;Langfuse 的 observation 用 `parentObservationId` 指向父节点;我们自己的 SDK 是一行一条记录。如果前端要同时认识三种格式,每个组件都会塞满 if-else。所以导入器负责把它们统一成两张表:`Run`(一次运行)和 `Step`(其中的一步),前端只认这一种。模型调用的输入统一成 OpenAI 的 messages 格式,因为这门课从 Day 3 起一直用它。

**SQLite,不用 Postgres**。这是一个单人工具,数据是导入的,写入少、读取多。SQLite 一个文件、零配置,`git clone` 下来就能跑,对想试用的招聘方最友好。它的 WAL 模式也足以让「导入大文件」和「浏览列表」同时进行。如果以后真要多人用,把 `db.py` 换成 Postgres 实现就行,接口不变。

**列表接口返回「轻」步骤**。一条 1 万步的 trace,如果每一步都带着完整的 messages,前端一次要拉几百 MB。所以步骤列表默认只返回名字、类型、时间、token 这些小字段,用户点开某一步时再单独请求完整内容。Day 113 会实测这个差距。

**前端自己画时间轴,不用图表库**。时间轴本质上是一堆按时间比例定位的长条,用 CSS 百分比定位就够了,难点在一万行的虚拟滚动,这个交给 `@tanstack/react-virtual`。不引入重型图表库,打包体积小,也更能体现前端功底。

**技术栈全课统一**:后端 Python 3.12 + uv + FastAPI;前端 React 18 + TypeScript + Vite,包管理用 pnpm,状态用 Zustand。重跑时调模型,沿用 Day 3 的 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL` 三个环境变量。

## 仓库结构

```text
agent-loupe/
├── server/                 # Python 后端(uv 项目)
│   ├── pyproject.toml
│   ├── prices.json         # 模型价格表(Day 113)
│   ├── loupe_sdk.py        # 单文件轻量 SDK,可以复制到任何 Agent 项目里(Day 112)
│   ├── loupe/
│   │   ├── models.py       # Run / Step 数据模型(Day 112)
│   │   ├── importers/      # otlp.py / langfuse.py / sdk_jsonl.py(Day 112)
│   │   ├── db.py           # SQLite 读写(Day 113)
│   │   ├── pricing.py      # 补成本(Day 113)
│   │   └── app.py          # FastAPI 接口(Day 113 起)
│   └── tests/
├── web/                    # React 前端(pnpm 项目)
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
├── samples/                # 样例 trace 和造数脚本
└── docs/                   # PRD、ADR、性能记录
```

`server/` 和 `web/` 各自是独立的项目,有各自的依赖文件,没有用 monorepo 工具串起来。对这个规模,两个终端各跑一个命令最简单,也最不容易出怪问题。

## 十天里程碑

| Day | 做完以后能演示什么 |
| --- | --- |
| 111 | PRD、架构图、空骨架能跑(今天) |
| 112 | 三种格式的 trace 都能转成统一模型;Day 9 的 Agent 加三行代码就能产出 trace |
| 113 | `curl` 上传一个文件,能分页查到运行列表和步骤 |
| 114 | 浏览器里看到运行列表和时间轴,一万步能顺畅滚动 |
| 115 | 点开任意一步看完整消息;上下文构成条、上下文增长图、成本火焰图 |
| 116 | 两条运行逐步对齐,并排看差异 |
| 117 | 从任意一步改参数重跑,前面的工具结果走回放 |
| 118 | 失败步骤一键存成评测用例,批量重跑看通过率 |
| 119 | 公开部署:只读演示、脱敏、限流、每日花费上限 |
| 120 | README、ADR、演示视频脚本、开源发布 |

一个经验:每天结束时都要有能演示的东西。如果某一天卡住了,宁可砍功能也要保证当天能演示,十天里任何一天你都可能被拉去做别的事,手里有一个能跑的版本最重要。

## 招聘方会怎么看这个项目

招聘方和面试官点开一个候选人的作品,花的时间通常不会超过五分钟。站在他们的位置想一想,这五分钟里他们能看什么、会看什么,大概就是下面这几样:

**能不能马上用起来**。有在线演示最好;没有的话,README 第一屏要有一张动图和三行以内的启动命令。要求先装 Docker、再配五个环境变量的项目,大多数人直接关掉。所以 Day 119 的只读演示和预置样例很重要。

**有没有判断**。README 里有没有写「为什么不直接用 Langfuse」,有没有非目标,有没有 ADR 记录关键取舍。这是区分「跟着教程做了一遍」和「自己想清楚了」的地方。

**有没有数字**。一万步多久打开,对比算法在什么情况下会对错,重跑一次花多少钱。数字可以不漂亮,但要真实,写清楚怎么测的。

**代码是不是干净**。类型写全没有,测试有没有,提交历史是不是一天一个巨型提交。

对前端出身的人,这个项目还有一个额外的好处:做 Agent 的岗位里,能把复杂数据做成好用界面的人不多。面试时你可以从 Agent 原理一路讲到虚拟滚动和渲染性能,这个跨度本身就是记忆点。

## 动手练习

**练习 1:建仓库骨架。** 在你放项目的目录下:

```bash
mkdir -p agent-loupe/{server/loupe/importers,server/tests,web/src,samples,docs}
cd agent-loupe
git init
```

后端的 `server/pyproject.toml`:

```toml
[project]
name = "loupe-server"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn>=0.30",
    "pydantic>=2.7",
    "python-multipart>=0.0.9",
]

[dependency-groups]
dev = ["pytest>=8", "httpx>=0.27"]

[tool.pytest.ini_options]
pythonpath = ["."]
```

```bash
cd server
touch loupe/__init__.py
uv sync
uv run python -c "import fastapi, pydantic; print(fastapi.__version__, pydantic.__version__)"
```

能打印出两个版本号就行。我 2026 年 10 月装到的是 FastAPI 0.143、pydantic 2.14,你装到更新的版本也没关系。`python-multipart` 是 FastAPI 处理文件上传要用的,Day 113 会用到。

前端需要 Node 22 和 pnpm。没有 pnpm 的话 `npm i -g pnpm@9`。`web/package.json`:

```json
{
  "name": "loupe-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "typecheck": "tsc --noEmit",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@tanstack/react-virtual": "^3.10.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "~5.6.0",
    "vite": "^6.0.0"
  }
}
```

`web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`web/vite.config.ts` 和 `web/index.html`:

```ts
// agent-loupe/web/vite.config.ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // 开发时 /api 转发到 FastAPI,前端代码里只写相对路径,部署时不用改
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
});
```

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Agent Loupe</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

再放一个占位的入口,Day 114 会换成正式的:

```tsx
// agent-loupe/web/src/main.tsx(Day 111 占位版,Day 114 换成正式的)
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')!).render(<h1>Agent Loupe:骨架搭好了</h1>);
```

```bash
cd ../web
pnpm install
pnpm typecheck      # 不输出任何东西就是通过
pnpm dev            # 打开 http://localhost:5173 看到那行标题
```

`tsconfig.json` 里我打开了 `strict`、`noUnusedLocals` 这几个严格选项。一开始就开,后面不会攒下一堆类型债。React 和 react-router 我固定在 18 和 6 这两个大版本上(装的时候 pnpm 会提示有 19 和 7),原因是后面几天的代码按这两个版本写、验证过,你跟着做不会碰到升级带来的破坏性改动。

**练习 2:写 PRD。** 在 `docs/prd.md` 里写你自己的 PRD,可以从上面那份改。至少要有:一句话定位、目标用户、5 条以上用户故事、4 条以上非目标、验收指标表。写完以后问自己一个问题:如果只能做三个功能,做哪三个?把答案写在 PRD 最后。

**练习 3:亲手体验一个竞品。** 选 Langfuse(Day 34 已经接过)或 Phoenix,把 Day 9 的 Agent 跑一次,在它的界面里找出这三件事分别要点几下才能做到:看第二次模型调用的完整输入;比较两次运行的差异;从中间某一步换个模型重跑。记在 `docs/competitors.md` 里,做不到的写「做不到」,并附上你查的是哪一页文档。这份笔记 Day 120 写 README 时会直接用上。

**验收标准**:`uv run python -c "import fastapi"` 和 `pnpm typecheck` 都通过,`pnpm dev` 能打开页面;`docs/prd.md` 有完整的五个部分;`docs/competitors.md` 记录了至少一个竞品的三项体验结果,每项都有文档出处;仓库有第一个提交。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| trace / 运行记录 | 一次 Agent 运行从开始到结束的完整记录,由很多步组成 |
| span / step / observation | trace 里的一步。OpenTelemetry 叫 span,Langfuse 叫 observation,我们统一叫 step |
| replay(回放) | 用记录下来的结果代替真实执行,让运行能确定地重现 |
| fork(分叉) | 从某一步开始改了参数后继续跑,产生一条新的运行 |
| time travel | LangGraph 的功能,回到某个 checkpoint 重放或分叉 |
| Span Replay | Phoenix 的功能,把一次记录下来的模型调用搬进 playground 重跑 |
| PRD | 产品需求文档,写清楚给谁用、做什么、不做什么、怎么算做完 |
| 非目标(non-goals) | 明确不做的事,防止范围失控 |
| WAL | SQLite 的预写日志模式,读和写可以同时进行 |
| 虚拟滚动 | 只渲染视口内的几十行,其余用空白占位,让一万行的列表也不卡 |

## 常见误区

**一上来就写代码。** 十天的项目,第一天花半天写 PRD 和看竞品,后面九天能省下不止半天。最常见的结局是做到第六天发现 Langfuse 早就有这个功能,或者发现自己的数据模型撑不起对比功能,只能推倒重来。

**想做一个「更好的 Langfuse」。** 一个人十天,不可能在 tracing、评测、prompt 管理上全面超过一个几十人的团队。作品集要的是在一个点上做深,并且能说清楚为什么选这个点。

**把非目标当成以后要做的功能。** 非目标就是不做。写成「暂不支持,以后做」,面试官会追问「那什么时候做」,不如直接说「这是 Langfuse 的事,我们不重复造」。

**性能目标写成实测结果。** 没测之前,表格里只能写目标。Day 119 测完,达到了填数字,没达到也填数字,再写一句为什么。编出来的数字一问就露馅。

**前端和后端一起上。** 先把数据模型和接口定死(Day 112、113),再写界面。界面最容易反复改,数据模型一改,前后端都得跟着动。

## 学习资料

### 文档与文章

- [Langfuse Playground 文档](https://langfuse.com/docs/playground):看「从 generation 打开 playground」那一段,弄清楚它的重跑粒度,15 分钟。
- [Langfuse Observation Types](https://langfuse.com/docs/observability/features/observation-types):十种 observation 类型的定义,Day 112 写 Langfuse 导入器时要用,10 分钟。
- [LangGraph:Use time travel](https://docs.langchain.com/oss/python/langgraph/use-time-travel):replay 和 fork 的区别、为什么重放后结果可能不同,和 Day 117 直接相关,20 分钟。
- [Arize Phoenix:Span Replay](https://arize.com/docs/phoenix/prompt-engineering/overview-prompts/span-replay):另一种「单次调用重跑」的实现,10 分钟。
- [OpenAI Agents SDK:Tracing](https://openai.github.io/openai-agents-python/tracing/):看它把一次运行分成哪几类 span,和我们的 kind 设计对照,15 分钟。
- [OpenTelemetry GenAI 语义约定:span 部分](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md):今天扫一眼目录,明天细读,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1EFtd6ZEVH&autoplay=0&high_quality=1" title="Agent 可观测性全解:Run、Trace、Thread 与生产评估闭环" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>老纪的技术唠嗑局 · Agent 可观测性全解:Run、Trace、Thread 与生产评估闭环 · 9 分钟,把 run、trace、thread 几个层级讲清楚,和我们的 Run/Step 模型对照着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1nZ3Q6yEzk&autoplay=0&high_quality=1" title="Langfuse 到底是什么?LLM 监控、Trace 与历史记录一次讲清" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>前端屎不了 · Langfuse 到底是什么?LLM 监控、Trace 与历史记录一次讲清 · 11 分钟,快速回顾 Langfuse 能做什么,做练习 3 之前看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/2E8iTvGo9Hs" title="10 min Walkthrough of Langfuse – Open Source LLM Observability, Evaluation, and Prompt Management" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Langfuse 官方 · 10 min Walkthrough of Langfuse · 官方十分钟演示,注意看它的 trace 详情页长什么样,我们的界面会借鉴它的布局,但把时间轴和上下文放到更显眼的位置。</figcaption>
</figure>

### 书籍

- **Observability Engineering**,Charity Majors、Liz Fong-Jones、George Miranda,O'Reilly,2022。可观测性领域的标准读物。今天读第 1 章(什么是可观测性),理解为什么「能回答你事先没想到的问题」才是可观测,约 40 分钟。
- **AI Engineering**,Chip Huyen,O'Reilly,2025。第 10 章讲 AI 应用的架构和用户反馈,其中监控与可观测一节列了 AI 应用该看哪些指标,可以和我们的 PRD 对照,约 30 分钟。

### 开源项目与代码

- [langfuse/langfuse](https://github.com/langfuse/langfuse):看 README 的功能列表和截图,今天的竞品调研从这里开始。
- [Arize-ai/phoenix](https://github.com/Arize-ai/phoenix):另一个可以自己部署的竞品,README 里有快速启动命令,练习 3 选它的话照着装。

## 自测

1. 用一句话说出 Agent Loupe 和 Langfuse 的区别,要让一个没用过 Langfuse 的面试官也听得懂。

<details><summary>答案</summary>

Langfuse 擅长把 Agent 在生产环境的每一步记录下来、能查能看能评测;Agent Loupe 只做开发时调试的三件事:两次运行逐步对比、从中间任意一步改参数重跑、把上下文里每部分占多少 token 画出来。它不替代 Langfuse,可以直接导入 Langfuse 导出的数据。

</details>

2. Langfuse 和 Phoenix 都能「改了参数重跑」,为什么我们还说「从第 N 步重跑」是空白?

<details><summary>答案</summary>

它们重跑的是一次模型调用:把那一次的输入搬进 playground,改了再调一次模型,看这一次的输出。Agent 的问题往往是连锁的,第 5 步换了模型,第 6 步调的工具就不一样了,后面整条路都会变。我们要的是从第 5 步开始让整个 Agent 接着跑下去,前 4 步的工具结果用记录的值回放。LangGraph 的 time travel 能做到整条分叉,但要求 Agent 写在 LangGraph 里并且有 checkpoint。

</details>

3. 为什么列表接口默认不返回每一步的 input 和 output?

<details><summary>答案</summary>

模型调用的 input 是当时完整的 messages,越往后越长,一条 1 万步的 trace 全部带上可能有几百 MB。时间轴只需要名字、时间、token 这些小字段就能画出来;用户点开某一步时,再单独请求那一步的完整内容。这样首屏快,内存也省。

</details>

4. 「不做多用户和权限」是非目标。如果面试官问:那公开演示时别人乱用怎么办?

<details><summary>答案</summary>

公开演示是只读模式,预置脱敏样例,用户不能上传、不能改数据;唯一会花钱的重跑接口加了限流和每日花费上限,超出就返回 429。这不需要账号体系,用几十行代码就能解决公开演示的风险,和「多用户协作」是两回事。

</details>

5. 资深面试题:你只有十天,PRD 里列了 7 个用户故事。第 5 天时你发现进度只有计划的一半,你会怎么调整?说出你的判断依据。

<details><summary>答案</summary>

先看哪些故事是这个项目存在的理由:逐步对比、中途重跑、上下文可视化,这三个保留;时间轴和详情面板是它们的前提,也保留。可以砍的是评测用例导出(可以降级成「导出 JSON」)和公开部署的完善程度(先做只读演示,限流用最简单的固定窗口)。判断依据是:演示时最能让人记住的是什么,哪些功能缺了整个项目就讲不通。砍掉的部分写进 README 的「已知限制」,不藏着。

</details>

6. 为什么选 SQLite 而不是 Postgres?什么情况下你会换?

<details><summary>答案</summary>

这是单人使用的调试工具,数据是一次性导入的,写少读多;SQLite 一个文件、零配置,别人 clone 下来就能跑,对试用者最友好。WAL 模式下导入和浏览可以并行,也够用。如果要支持多人同时写入、需要横向扩展,或者部署环境的文件系统不持久(比如某些无状态容器平台),就换 Postgres。因为所有数据库访问都封装在 `db.py` 里,换起来只动一个文件。

</details>

## 明天预告

骨架有了,明天(Day 112)定数据:**trace 数据模型与三种导入器**。我们会细读 OpenTelemetry 的 GenAI 语义约定,写出 `Run` 和 `Step` 两个模型,再写 OTLP JSON、Langfuse 导出、自研轻量 SDK 三个导入器,最后给 Day 9 的 Agent 加三行代码,产出第一条真实的 trace。
