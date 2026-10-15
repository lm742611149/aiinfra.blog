---
title: 'Agent Loupe · Agent 运行记录调试器'
name: 'Agent Loupe'
tagline: '导入 Agent 的运行记录,逐步回放、两次运行对比、从任意一步改参数重跑'
summary: '一个网页调试器:按时间轴回放 Agent 每一步,看上下文是被哪一步撑大的,两次运行逐步对齐找出分歧点,从第 N 步分叉重跑,失败步骤一键存成评测用例。最能发挥前端功底的一个。'
order: 1
difficulty: 3
level: '资深'
duration: '3–4 周(有逐日教程,10 天正文)'
cost: '几美元 API 费,演示站可免费部署'
gpu: false
targets: ['Agent 平台工程师', 'AI 开发者工具', '全栈 AI 工程师']
stack: ['React', 'TypeScript', 'Vite', 'FastAPI', 'SQLite', 'OpenTelemetry']
recognition: '开源仓库 + 能在线试用的演示站 + 万步渲染的性能数据'
depends: []
status: 'tutorial'
tutorial: '/blog/agent-60/day-111-loupe-kickoff/'
---

## 这个项目是什么

调 Agent 最难受的地方是看不清。一条运行跑了四十步,最后答错了,你得在一大坨 JSON 里翻:第几步的工具结果不对,哪一步开始模型理解偏了,上下文是不是早就被某个工具返回撑满了。Agent Loupe 做的就是把这件事变成点几下鼠标:导入运行记录(trace),按时间轴一步步回放,两条运行并排逐步对齐,从中间任意一步改了提示词或模型接着跑,再把出错的那一步一键存成评测用例。

这个项目课程里有完整的逐日教程(Day 111–120),每天的代码都实际跑过。这一页是它的项目说明,方便和其他项目放在一起比较。

## 为什么值得做

Langfuse、LangSmith、Phoenix、OpenAI Traces 把「记录」和「查看」做得已经很好了。我在 2026 年 10 月查它们的文档时,发现三件事还有空间:两次运行的逐步对齐对比;对一个不是用 LangGraph 写的 Agent,从中间某一步分叉重跑整条运行;上下文构成的可视化。Agent Loupe 只把这三件事做好,其他方面坦白承认不如它们。面试官十有八九会问「为什么不直接用 Langfuse」,这就是答案。

对前端出身的人,它还有一个额外好处:做 Agent 的人很多,能把复杂数据做成好用界面的人不多。面试时你可以从 Agent 原理一路讲到虚拟滚动和渲染性能。

## 要做出什么

必做的是三种导入器(OTLP JSON、Langfuse 导出、自带的轻量 SDK)、运行列表和筛选、步骤树加瀑布时间轴、步骤详情和上下文占用条、两次运行逐步对比、从第 N 步分叉重跑(工具默认走录制回放)、失败步骤存成评测用例,以及一个带限流和每日花费上限的公开演示站。

不做的是实时采集、告警、多人协作和权限体系。这些 Langfuse 们做得好,我们导入它们的数据就够了。

## 架构

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

后端是 FastAPI 加 SQLite,单文件数据库,`git clone` 下来就能跑。前端 React 18 + TypeScript + Vite,时间轴自己用 CSS 和 SVG 画,一万行的列表交给 `@tanstack/react-virtual`。列表接口只返回轻量字段,点开某一步再拉完整内容。重跑用录制回放机制:原运行的工具结果按工具名和参数哈希存档,重跑时默认回放,勾选后才真实执行。

## 分阶段计划

| 周 | 目标 | 产出 | 怎么算完成 |
| --- | --- | --- | --- |
| 1 | 数据模型和后端 | Run/Step 模型、三种导入器、查询接口 | 三种样例都能导入,pytest 全绿 |
| 2 | 时间轴和详情 | 列表页、瀑布时间轴、步骤详情、上下文占用条 | 一万步样例能流畅滚动,测量方法写进文档 |
| 3 | 对比、重跑、评测 | LCS 对齐对比、cassette 重跑、评测用例导出 | 改提示词重跑后,对比页能指出分歧的第一步 |
| 4 | 上线和包装 | 只读演示、限流、部署、README、ADR、演示视频 | 陌生人能在两分钟内看懂并点开试用 |

## 验收指标

| 指标 | 怎么测 | 目标 |
| --- | --- | --- |
| 一万步 trace 首屏时间 | Chrome Performance 面板,冷启动三次取中位数 | 你自己测,写进 README |
| 滚动帧率 | 连续滚动 10 秒的掉帧比例 | 你自己测 |
| 对比对齐正确率 | 手工标注 20 对运行的分歧点,看算法是否对上 | 写出对错几对 |
| 单次重跑成本 | 重跑消耗的 token × 单价 | 写进演示页 |

## 最终产出

开源仓库(带动图的 README、快速开始、两三篇 ADR)、一个只读的在线演示站、性能测量记录、两分钟演示视频,以及网站上的案例页。

## 难点和坑

一万步的渲染是第一个坑,列表接口如果带上完整 messages,前端一次要拉几百 MB。对比算法容易被字段顺序这种无关差异骗,签名要先规范化。重跑时工具如果真实执行,可能会重复下单、重复发邮件,所以默认必须回放。模型输出本身有随机性,界面上要讲清楚「重跑结果不同」不一定是你的改动造成的。公开演示要防被刷,限流和每日花费上限一个都不能少。

## 面试里怎么讲

示范讲法:调 Agent 时我发现最费时间的是定位第几步出了问题,现有工具能看但不能逐步对比,也不能从中间重跑手写的 Agent。我做了 Agent Loupe,核心是统一的 trace 模型、LCS 对齐的逐步对比和录制回放式重跑;一万步的 trace 首屏多少秒,对比在标注集上对了多少对。取舍上我没做实时采集,因为 Langfuse 已经做得很好,我选择兼容它的导出格式。

<details><summary>追问:为什么重跑默认回放工具结果,而不是真实执行?</summary>

真实执行有副作用,而且外部数据会变,重跑结果的差异就分不清是改动造成的还是环境变了。回放让对比只反映模型侧的变化;需要验证工具本身时再勾选真实执行,并且只对只读工具开放。

</details>

<details><summary>追问:对比时两条运行步数不一样怎么对齐?</summary>

把每一步变成签名(类型 + 名字 + 规范化参数摘要),对两条签名序列跑 LCS,得到 same、changed、added、removed 四类。签名要先规范化,比如参数里的键排序、去掉时间戳,否则大片误报。

</details>

<details><summary>追问:如果要支持多人团队使用,你会改哪里?</summary>

SQLite 换 Postgres(数据访问层已经隔离),加鉴权和项目隔离,导入改成异步任务队列,大字段放对象存储。前端基本不用动,因为它只认统一的 Run/Step 接口。

</details>

## 前置知识

Day 9 手写 Agent 循环,Day 34 Langfuse 接入,Day 35 评测集格式,Day 85 大规模可观测。

## 参考资料

- [Langfuse Playground 文档](https://langfuse.com/docs/playground):单次调用搬进 playground 重跑的做法,对照我们的整条运行重跑。
- [LangGraph time travel](https://docs.langchain.com/oss/python/langgraph/use-time-travel):基于 checkpoint 的重放和分叉。
- [Phoenix Span Replay](https://arize.com/docs/phoenix/prompt-engineering/overview-prompts/span-replay):另一种单次调用重跑。
- [OpenAI Agents SDK tracing](https://openai.github.io/openai-agents-python/tracing/):Agents SDK 记录了哪些事件。
- 课程 Day 111–120:完整的逐日实现。
