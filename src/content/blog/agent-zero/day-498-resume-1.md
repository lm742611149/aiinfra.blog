---
title: 'Day 498 · 简历(一):招聘方要什么,关键词对照表'
description: '求职部分第一天。先用真实 JD 看招聘方到底在找什么,再写一个小脚本数关键词,顺手踩一遍子串误伤、中文词边界这些坑,最后生成一张「JD 关键词 → 我的证据 → 简历哪一行」的对照表。'
pubDate: 2026-10-22
regime: none
tags: ['resume', 'job-search', 'jd', 'regex', 'agent-zero']
series: 'agent-zero'
day: 498
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 497](/blog/agent-zero/day-497-code-review-3/) 把代码审查机器人升级成了能自己翻代码的 Agent,也聊了它和 Claude Code 这类 Coding Agent 是什么关系。到这里,毕业项目 SupportPilot 和第二作品都做完了,手里有两个能演示、带评测数字的东西。

作品做完不等于有人看。接下来二十天是求职部分,第一件事是简历,因为简历决定了你有没有机会把作品讲给面试官听。今天不急着动笔写简历,先搞清楚招聘方在找什么。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说出国内和海外 Agent 岗 JD 最常出现的几类要求,以及它们分别对应你在这门课里哪几天学的东西。
2. 写一个 Python 脚本,数出几份 JD 里每个技能各出现了几次,并且知道子串匹配会在哪里误伤、在哪里漏掉。
3. 生成一张三列的「关键词对照表」:JD 关键词、你的证据、简历哪一行,空着的那几行要能说清是「会但没写」还是「真不会」。

预计用时 2.5 小时。前置:[Day 147](/blog/agent-zero/day-147-structured-1/) 起的结构化输出(今天最后一步要让模型吐 JSON)、[Day 135](/blog/agent-zero/day-135-llm-client-1/) 封装的 `common/llm.py`,以及整个毕业项目(Day 435–497),对照表里的证据全来自那里。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `count_skills` 和对照表那段默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先看招聘方到底要什么

写简历之前先读 JD。JD 是 Job Description 的缩写,就是招聘页面上那段「岗位职责 + 任职要求」。读一两份没用,要读一批,因为单看一份你分不出哪些是这家公司的特殊口味,哪些是整个行业的共识。

站长在 2026 年 10 月 12 日做过一次调研,一共收了 880 条 AI Agent 相关岗位:国内 695 条,海外 185 条。国内的来源有腾讯、字节、美团、百度、网易、京东的招聘官网,智联招聘,还有用站长自己账号登录后抓的 Boss 直聘 435 条和猎聘 140 条;海外来自 LinkedIn、新加坡政府职位库 MyCareersFuture、Hacker News 十月招聘帖,以及 OpenAI、Anthropic、Sierra、Decagon 这些公司在 Ashby、Greenhouse、Lever 上的公开职位。Boss 列表大多只有标题和薪资,能拿来算技能比例的、带 JD 正文的,国内是 334 条,海外 185 条。

下面这张表是站长用关键词规则在第一批 305 条(国内 120 条大厂和智联、海外 185 条)正文里匹配出来的。规则匹配不是人工标注,只用来看方向,差五个百分点以内的别当回事。最后一列换成了这门课里对应的天:

| 技能 | 国内(120 条) | 海外(185 条) | 你在这门课哪里学的 |
| --- | --- | --- | --- |
| Python | 65% | 63% | 第一部分起全程 |
| 工具调用 / Function Calling | 63% | 39% | [Day 156](/blog/agent-zero/day-156-fc-idea/) 起 |
| 上下文工程 / 记忆 | 66% | 25% | [Day 262–264](/blog/agent-zero/day-262-context-budget/)、Day 464–466 |
| 评测 Eval | 56% | 62% | 第六部分、Day 476–483 |
| RAG / 检索 | 52% | 54% | 第四部分、Day 448–451 |
| Agent 框架(LangGraph 等) | 46% | 36% | [Day 298](/blog/agent-zero/day-298-langchain-vs-langgraph/) 起 |
| 多 Agent | 42% | 22% | [Day 329–332](/blog/agent-zero/day-329-multi-agent-1/) |
| 部署 / Docker / 云 | 41% | 53% | Day 100–102、Day 422–427、Day 490 |
| 面向客户 / 交付 | 33% | 46% | [Day 436](/blog/agent-zero/day-436-fde-requirements/) 像 FDE 那样拆需求 |
| 全栈 / 前端 | 35% | 29% | 你原来的工作 + Day 467–474 |
| 可观测 / Tracing | 33% | 31% | Day 364–367、Day 484 |
| MCP | 26% | 16% | 第五部分、Day 456 |
| 熟练用 Coding Agent | 26% | 15% | [Day 210–211](/blog/agent-zero/day-210-coding-agent-1/)、Day 497 |
| 微调 / RL | 23% | 19% | 普通篇不涉及 |
| Go | 34% | 14% | 课程不涉及 |

我读这张表会看三样东西。

第一,国内更关心 Agent 内部是怎么转起来的。上下文工程 66% 对 25%,工具调用 63% 对 39%,多 Agent 42% 对 22%,差距都很大。腾讯、美团、字节好几个岗位标题直接叫「Agent Harness 工程师」,Harness 指的是 Agent 的运行底座:循环调度、工具注册、上下文组装、沙箱、checkpoint。所以投国内岗,简历里光写「用 LangGraph 搭了一个 Agent」不够,要写出你处理过上下文压缩、工具失败重试、审批中断这些具体问题。

第二,评测在两边都是硬通货。腾讯 Agent Harness 岗的原话是「使每次 Prompt、模型、工具变更都有量化的收益与回归判定」;智联上一家郑州公司写得更直白:「能讲清上线后效果指标是多少、是怎么测出来的」。项目经历里没有一个带口径的评测数字,基本等于没写,明天整天都在讲这个。

第三,前端在这里不是短板。国内 35%、海外 29% 的 JD 提到全栈或前端,海外提 TypeScript/JS 的有 34%。你原来做的流式渲染、表单、E2E 测试,在 Agent 岗里都能找到对应的位置,Day 500 会专门讲怎么把工作经历换个角度写。真正的空白是 Go 和微调,这两样课程没教,后面你会看到对照表里它们就该空着。

## 关键词对照表:先找证据,再写句子

拿到一份想投的 JD,先别急着改简历。做一张三列的表:左边是 JD 里的关键词,中间是你的证据,右边是这条证据写在简历哪一行。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="JD 关键词到简历证据的对照方法">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <text x="20" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">JD 关键词</text>
  <text x="230" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">我的证据(经得起追问)</text>
  <text x="460" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">简历哪一行</text>
  <rect x="16" y="44" width="180" height="36" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="26" y="67" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">评测</text>
  <rect x="226" y="44" width="200" height="36" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="236" y="67" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">三层评测+CI 门禁 Day 476</text>
  <rect x="456" y="44" width="168" height="36" fill="none" stroke="var(--rule)"/>
  <text x="466" y="67" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">项目 1 第 2 条</text>
  <line x1="196" y1="62" x2="226" y2="62" stroke="var(--rule)"/>
  <line x1="426" y1="62" x2="456" y2="62" stroke="var(--rule)"/>
  <rect x="16" y="94" width="180" height="36" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="26" y="117" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Coding Agent</text>
  <rect x="226" y="94" width="200" height="36" fill="none" stroke="var(--compute)" stroke-dasharray="4 3"/>
  <text x="236" y="117" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">会,但还没写进简历</text>
  <rect x="456" y="94" width="168" height="36" fill="none" stroke="var(--rule)"/>
  <text x="466" y="117" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">补一行</text>
  <line x1="196" y1="112" x2="226" y2="112" stroke="var(--rule)"/>
  <line x1="426" y1="112" x2="456" y2="112" stroke="var(--rule)"/>
  <rect x="16" y="144" width="180" height="36" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="26" y="167" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Go</text>
  <rect x="226" y="144" width="200" height="36" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
  <text x="236" y="167" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">没有</text>
  <rect x="456" y="144" width="168" height="36" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
  <text x="466" y="167" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">不写,面试如实说</text>
  <line x1="196" y1="162" x2="226" y2="162" stroke="var(--rule)"/>
  <text x="20" y="212" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">中间一列空着:先问自己「会但没写」还是「真不会」</text>
  <text x="20" y="232" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">前者补进简历,后者宁可不写也不要硬凑</text>
</svg>
<figcaption>简历上每一个技能词,都应该能在中间那列找到一个经得起三层追问的证据。找不到证据的词写上去,等于给面试官递刀。</figcaption>
</figure>

为什么要先找证据再写句子?因为简历上每个词都是一个追问点。你写了「熟悉 RAG」,面试官下一句就是「你的切块策略是什么,召回率多少,怎么测的」。证据是指那些你能当场打开代码、打开记录表给人看的东西:哪个项目、哪个模块、哪个数字、哪一天做的。

关键词要用 JD 原文的写法。它写「Context Engineering」,你就别写成「上下文管理」;它写「检索增强生成」,技能栏里就别只写「RAG」。原因很现实:很多公司初筛靠关键词搜索,Boss 直聘上招聘方搜人也是按词搜的,词对不上,人不会替你翻译。

手工做三五份 JD 的对照表不难,但做多了你会想让程序帮你数。接下来就写这个程序,顺带看看规则匹配的边界在哪里,这对你以后做任何「关键词规则」类的东西都有用(Day 477 的规则检查是同一类东西)。

## 第一步:准备五份 JD 样本

在练习仓库里建今天的目录。如果你一路跟下来,`agent-zero-lab/` 已经在了;第九部分的代码都放在 `part09/` 里:

```bash
cd agent-zero-lab
mkdir -p part09
touch part09/__init__.py
```

`__init__.py` 是空文件,它让 `part09` 变成一个包,后面的脚本才能写 `from part09.kw_count_v2 import ...`。这件事在第一部分讲包的那天学过,相当于 JS 里一个目录有了 `index.js` 就能被当成模块导入。

然后建 `part09/jds.json`。这是数据不是代码,可以直接复制。里面是五份真实 JD 的「任职要求」片段,来自 2026 年 10 月 12 日站长的抓取,链接都在 `url` 字段里,四份国内一份海外:

```json
[
 {"id": "tencent", "company": "腾讯", "title": "Agent Harness 工程师",
  "url": "http://careers.tencent.com/jobdesc.html?postId=2098332758412804096",
  "text": "要求:1.计算机及相关专业本科及以上学历;精通 Python,熟悉 TypeScript / Go 之一,具备扎实的工程实现能力与系统设计功底,能独立完成从架构设计到上线运维的全链路交付; 2.重度使用 Cursor / Claude Code / Codex 等 agentic coding 工具进行日常编程,对 Agent 的能力边界、典型 failure mode(上下文丢失、工具误用、多轮偏移、幻觉式收敛)有切身的体感和自己的方法论; 3.熟悉 AI / Agent 技术栈,理解 LLM 推理服务与采样参数、主流 Agent Framework(LangGraph / AutoGen / MCP 等)、Tool Calling 与 Function Schema 设计、Prompt 与 Context Engineering、RAG 与记忆机制; 4.具备可观测性或评测基础设施建设经验,熟悉 OpenTelemetry / Trace 存储与查询、指标体系与看板设计、离线数据处理链路;熟悉分布式系统、高并发服务与异步编程,有大规模任务调度经验者优先;"},
 {"id": "netease", "company": "网易", "title": "Agent应用开发工程师",
  "url": "https://hr.163.com/job-detail.html?id=76697",
  "text": "要求:1. 本科及以上计算机、AI 相关专业,2 年以上大模型 / 智能体开发经验,精通 Python; 2. 有对话智能体、决策智能体、多智能体系统落地经验,可对接业务团队梳理流程、输出智能体解决方案; 3. 熟悉 LangGraph、Anthropic Agent SDK 等主流 Agent 开发框架,能够独立完成感知、规划、记忆、行动模块开发; 4. 掌握 检索增强生成、工具调用、提示词工程等技术,具备基础前后端开发能力,能依托 AI 编码工具完成业务接口开发; 5. 能够将智能体能力集成至智能客服、自动化运营、流程机器人场景,搭建效果指标体系持续优化准确率、安全性与可控性; 6. 逻辑清晰,擅长跨团队协作,具备线上 AI 应用问题排查与工程迭代能力。"},
 {"id": "zhaopin_rag", "company": "大国智能网天", "title": "AI大模型应用开发工程师",
  "url": "https://www.zhaopin.com/jobdetail/CCL1269552950J40849301316.htm",
  "text": "二、任职要求 1 3-5 年软件开发或算法工程经验,能独立写生产级服务(FastAPI / Flask、异步并发、异常与日志规范,而非只跑 notebook)。 2 至少 1 个已经上线的大模型应用项目,本人承担主要开发职责,并且能讲清\"上线后效果指标是多少、是怎么测出来的\"。 3 RAG 实操经验:用过主流 embedding 模型 + 向量库,亲手处理过切片策略、召回率调优、多路召回与重排,不是只跟过教程。 4 微调实操经验:独立完成过至少一次开源模型的轻量微调,会自己构造训练数据与评测集,能说明微调前后的量化差异以及付出的代价(时间、算力、副作用)。 5 可在郑州全职到岗,并能直接面对业务部门沟通需求——本岗位不设中间产品经理转译需求。"},
 {"id": "zhaopin_fde", "company": "中兵数字", "title": "AI智能体(FDE)工程师",
  "url": "https://www.zhaopin.com/jobdetail/CCL1276161630J40883543101.htm",
  "text": "三、任职要求 1.学历背景 计算机、软件工程、人工智能等相关专业本科及以上学历。 2.工作经验 1–3 年开发工作经验,其中至少 1 年与 AI 应用 / Agent 开发 / 大模型落地相关 3.技术技能 熟练掌握 Python / Go,具备扎实的编程能力和良好的工程习惯; 熟悉至少一种大模型应用框架(如 LangChain、LlamaIndex、Claude Agent SDK、OpenWork 等),理解 Agent 工作流设计的基本范式; 熟练使用 AI 编程辅助工具(如 Claude Code、Cursor、Codex、GitHub Copilot 等),能以 vibe coding 方式高效开发; 了解容器化部署(Docker、Docker Compose)及基本 CI/CD 流程,能与工程团队顺畅协作;"},
 {"id": "intercom_fde", "company": "Intercom", "title": "Forward Deployed Engineer",
  "url": "https://job-boards.greenhouse.io/intercom/jobs/8201208",
  "text": "As a Forward Deployed Engineer, you'll work hands-on with strategic customers, partnering closely with our R&D and Go-to-Market teams to design and deliver high-impact solutions. You'll go beyond implementation - helping shape product direction, influence roadmap decisions and ensure Fin delivers real, measurable business outcomes in complex, real-world environments. If you're excited by ownership, creativity and solving ambiguous problems, and want to work at the frontier of applied AI while collaborating with Product, Engineering and Go-to-Market teams, this role offers a rare opportunity to combine technical excellence with real customer impact. What skills do I need? A strong engineering background and experience building software with real-world usage. Experience building a SaaS product is a plus, but not a requirement. Interest in AI and machine learning, and the ability to quickly build an understanding of novel problems, capabilities and architectures - including their trade-offs and limitations. Strong cross-functional collaboration skills, with the ability to navigate organisational boundaries and bring people together to achieve the best outcomes for our customers. Deep knowledge of at least one high-level programming language, such as JavaScript, Python or Ruby. It doesn't need to be a language we use today - great people learn quickly and can introduce us to better ways of working. The ability to prototype and ship software quickly while maintaining a high bar for quality and a clear focus on business goals and outcomes. Proficiency using and writing REST APIs to integrate systems effectively."}
]
```

我实跑用的文件里中文标点是全角的(原 JD 就是全角),上面为了排版统一换成了半角,对后面的结果没有影响。挑这五份是有原因的:腾讯那份是国内大厂 Agent 岗写得最细的之一;网易那份要「集成至智能客服」,和 SupportPilot 几乎一一对应;智联两份代表中小公司;Intercom 那份是海外 FDE 岗,FDE 是 Forward Deployed Engineer,驻在客户那边做交付的工程师,Day 512 会专门讲。

## 第二步:最朴素的版本,用 in 数关键词

先写一个最简单的:给每个技能列几个「别名」,只要 JD 正文(转成小写)里包含任何一个别名,就算这份 JD 提到了这个技能。

```python
# agent-zero-lab/part09/kw_count_v1.py
import json
from pathlib import Path

KEYWORDS: dict[str, list[str]] = {
    "Python": ["python"],
    "评测": ["评测", "评估", "eval", "指标"],
    "RAG / 检索": ["rag", "检索", "召回", "向量"],
    "工具调用": ["tool calling", "工具调用", "function"],
    "上下文 / 记忆": ["上下文", "context", "记忆", "memory"],
    "Agent 框架": ["langgraph", "langchain", "agent sdk", "autogen"],
    "MCP": ["mcp"],
    "Coding Agent": ["claude code", "cursor", "codex"],
    "部署 / Docker": ["docker", "部署", "ci/cd"],
    "面向客户 / 交付": ["客户", "业务", "customer"],
    "Go": ["go"],
}

jds = json.loads(Path("part09/jds.json").read_text(encoding="utf-8"))
print(f"一共 {len(jds)} 份 JD\n")

for skill, aliases in KEYWORDS.items():
    hits = [jd["id"] for jd in jds if any(a in jd["text"].lower() for a in aliases)]
    print(f"{skill:<16}{len(hits)}/{len(jds)}  {hits}")
```

<div class="line-notes">

- `KEYWORDS: dict[str, list[str]] = {` 一个字典,键是技能名,值是这个技能的别名列表。相当于 TS 里的 `const KEYWORDS: Record<string, string[]> = {...}`。别名全部写小写,因为后面会把 JD 也转成小写再比。
- `"工具调用": ["tool calling", "工具调用", "function"],` 这里故意写了一个太宽的别名 `function`,等会儿看它闯的祸。
- `"Go": ["go"],` 同样故意的,两个字母的别名最容易误伤。
- `jds = json.loads(Path("part09/jds.json").read_text(encoding="utf-8"))` 从里往外读:`Path(...)` 指向文件,`.read_text(encoding="utf-8")` 读成字符串,`json.loads` 把字符串解析成 Python 对象。实跑得到一个 5 个元素的 list,每个元素是 dict。相当于 JS 的 `JSON.parse(fs.readFileSync(path, "utf8"))`。
- `print(f"一共 {len(jds)} 份 JD\n")` 实跑打印「一共 5 份 JD」,`\n` 多空一行。
- `for skill, aliases in KEYWORDS.items():` `.items()` 一次拿出键和值,第一轮 `skill="Python"`、`aliases=["python"]`。相当于 JS 的 `for (const [skill, aliases] of Object.entries(KEYWORDS))`。
- `hits = [jd["id"] for jd in jds if any(a in jd["text"].lower() for a in aliases)]` 列表推导式,读法是「对每一份 jd,如果它的正文里包含任一别名,就把它的 id 收进来」。`a in s` 是子串判断,相当于 JS 的 `s.includes(a)`;`any(...)` 相当于 `aliases.some(...)`。Python 这一轮得到 `['tencent', 'netease', 'zhaopin_fde', 'intercom_fde']`,智联那份 RAG 岗正文里没写 Python。
- `print(f"{skill:<16}{len(hits)}/{len(jds)}  {hits}")` `:<16` 是左对齐、占 16 个字符宽。下面的输出里你会看到中文那几行没对齐,因为一个汉字在终端里占两个英文字符的宽度,而 Python 按「字符个数」算。不影响结果,v2 会把数字挪到最前面绕开它。

</div>

在 `agent-zero-lab/` 目录下运行:

```bash
uv run python part09/kw_count_v1.py
```

我实跑的输出:

```text
一共 5 份 JD

Python          4/5  ['tencent', 'netease', 'zhaopin_fde', 'intercom_fde']
评测              3/5  ['tencent', 'netease', 'zhaopin_rag']
RAG / 检索        3/5  ['tencent', 'netease', 'zhaopin_rag']
工具调用            3/5  ['tencent', 'netease', 'intercom_fde']
上下文 / 记忆        2/5  ['tencent', 'netease']
Agent 框架        3/5  ['tencent', 'netease', 'zhaopin_fde']
MCP             1/5  ['tencent']
Coding Agent    2/5  ['tencent', 'zhaopin_fde']
部署 / Docker     1/5  ['zhaopin_fde']
面向客户 / 交付       3/5  ['netease', 'zhaopin_rag', 'intercom_fde']
Go              3/5  ['tencent', 'zhaopin_fde', 'intercom_fde']
```

看起来挺像回事,但拿原文一对就有问题了。我挑三行和 JD 原文对:

**Go 那行有 Intercom。** 回去翻 Intercom 那段英文,根本没提 Go 语言。命中的是「Go-to-Market teams」(市场团队)和「go beyond implementation」。`"go" in text` 只管有没有这两个字母挨着,不管它是不是一个词。

**工具调用那行有 Intercom。** 它命中的是 `function`,出处是「cross-functional collaboration」(跨职能协作),跟函数调用没关系。

**Coding Agent 那行少了网易。** 网易原文写的是「能依托 AI 编码工具完成业务接口开发」,意思就是要会用 Coding Agent,但它没写 Cursor 也没写 Claude Code,别名表里没有「AI 编码」,于是漏掉了。

前两个叫误伤(不该算的算了),第三个叫漏掉(该算的没算)。做任何规则匹配都躲不开这两类错误,所以每次跑完都要抽几条回原文核对,别直接拿数字下结论。

## 第三步:先故意踩一次「词边界」的坑

修误伤的第一反应是:只匹配「完整的词」。正则表达式里有个 `\b`,表示词边界。正则在第一部分处理字符串时简单碰过,这里只用到两个写法,我先用一个小脚本把它们的行为跑出来,不然你会在中文上栽跟头。

正则表达式(regular expression)是描述「什么样的字符串」的一种小语言。JS 里你见过 `/go/i`,Python 里写成 `re.search(r"go", text, re.I)`,`re.I` 就是那个 `i`,忽略大小写。

```python
# agent-zero-lab/part09/boundary_demo.py
import re

samples = [
    ("go", "熟悉Go语言"),
    ("go", "TypeScript / Go 之一"),
    ("go", "Go-to-Market teams"),
    ("function", "cross-functional collaboration"),
    ("rag", "有RAG检索经验"),
]
for alias, text in samples:
    a = alias in text.lower()
    b = re.search(rf"\b{alias}\b", text, re.I) is not None
    c = re.search(rf"(?<![a-z0-9]){alias}(?![a-z0-9])", text, re.I) is not None
    print(f"{alias:<9}{text!r:<34} in={a!s:<6} 词边界={b!s:<6} 前后不是字母={c}")
```

<div class="line-notes">

- `import re` Python 自带的正则模块,不用 `uv add`。
- `samples = [` 五组「别名, 文本」,每组是一个元组。前三组测 Go,后两组测 function 和 rag。
- `for alias, text in samples:` 元组拆包,第一轮 `alias="go"`、`text="熟悉Go语言"`。
- `a = alias in text.lower()` 第二步的老办法,子串判断。五组全是 True。
- `b = re.search(rf"\b{alias}\b", text, re.I) is not None` `rf"..."` 是 r 和 f 两个前缀叠在一起:r 表示反斜杠不转义(`\b` 原样交给正则),f 表示可以用 `{alias}` 插值。第一轮实际的正则是 `\bgo\b`。`re.search` 找到就返回一个匹配对象,找不到返回 None,`is not None` 把它变成 True/False。
- `c = re.search(rf"(?<![a-z0-9]){alias}(?![a-z0-9])", text, re.I) is not None` 换一种写法:`(?<![a-z0-9])` 意思是「前面那个字符不是英文字母或数字」,`(?![a-z0-9])` 意思是「后面那个字符不是英文字母或数字」。这两个叫「环视」,JS 的正则也支持,写法一模一样。
- `print(f"{alias:<9}{text!r:<34} in={a!s:<6} 词边界={b!s:<6} 前后不是字母={c}")` `!r` 打印带引号的样子,方便看清空格;`!s` 把 True/False 转成字符串再对齐。

</div>

```bash
uv run python part09/boundary_demo.py
```

```text
go       '熟悉Go语言'                           in=True   词边界=False  前后不是字母=True
go       'TypeScript / Go 之一'               in=True   词边界=True   前后不是字母=True
go       'Go-to-Market teams'               in=True   词边界=True   前后不是字母=True
function 'cross-functional collaboration'   in=True   词边界=False  前后不是字母=False
rag      '有RAG检索经验'                         in=True   词边界=False  前后不是字母=True
```

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="词边界在中文和英文里的区别">
  <rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)"/>
  <text x="20" y="30" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">\b 只在「单词字符 | 非单词字符」之间成立(汉字算单词字符)</text>
  <rect x="20" y="50" width="40" height="36" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="32" y="73" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">悉</text>
  <rect x="60" y="50" width="40" height="36" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="74" y="73" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">G</text>
  <rect x="100" y="50" width="40" height="36" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="114" y="73" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">o</text>
  <rect x="140" y="50" width="40" height="36" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="152" y="73" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">语</text>
  <text x="200" y="73" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">两边都是单词字符 → 没有 \b → 匹配失败</text>
  <rect x="20" y="110" width="40" height="36" fill="none" stroke="var(--rule)"/>
  <text x="36" y="133" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">/</text>
  <rect x="60" y="110" width="40" height="36" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="74" y="133" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">G</text>
  <rect x="100" y="110" width="40" height="36" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="114" y="133" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">o</text>
  <rect x="140" y="110" width="40" height="36" fill="none" stroke="var(--rule)"/>
  <text x="156" y="133" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">-</text>
  <text x="200" y="133" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">两边都不是字母 → 两种写法都命中(Go-to-Market 也中)</text>
  <text x="20" y="180" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">(?&lt;![a-z0-9]) 只问「前一个是不是英文字母或数字」,汉字不算,所以第一行也能命中</text>
</svg>
<figcaption>同一个「Go」,夹在汉字中间时 \b 认为它不是独立的词;环视写法只看英文字母,中英混排时更靠谱,但分不出 Go-to-Market。</figcaption>
</figure>

第一行和最后一行就是那个坑。`\b` 的意思是「一边是单词字符、另一边不是」,而 Python 3 的正则默认按 Unicode 算,**汉字也算单词字符**。「熟悉Go语言」里 G 前面是「悉」、o 后面是「语」,两边都是单词字符,所以根本不存在词边界,`\bgo\b` 匹配失败。中文 JD 里「RAG检索」「Go语言」这种中英文挨着写的情况到处都是,用 `\b` 会成片漏掉。

「前后不是字母」那一列只看英文字母和数字,汉字不算,所以中文挨着写也能匹配上;同时 `cross-functional` 里 function 后面紧跟着 `a`,被正确排除。

但第三行还是 True。「Go-to-Market」里 Go 后面是连字符,连字符不是字母,规则认为这是一个独立的 Go。规则在这里已经到头了:从字面上,「Go-to-Market」的 Go 和「Python / Go」的 Go 没有区别,区别在语义。我的处理办法很土:把已知会误伤的短语列出来,匹配之前先从文本里删掉。

## 第四步:v2,把匹配逻辑抽成函数

把上面的结论写进 v2。这次把计数逻辑封装成 `count_skills` 函数,因为后面的对照表脚本、明天的脚本都要复用它。

```python
# agent-zero-lab/part09/kw_count_v2.py
import json
import re
from pathlib import Path

KEYWORDS: dict[str, list[str]] = {
    "Python": ["python"],
    "评测": ["评测", "评估", "eval", "指标"],
    "RAG / 检索": ["rag", "检索", "召回", "向量"],
    "工具调用": ["tool calling", "工具调用", "function calling", "function schema"],
    "上下文 / 记忆": ["上下文", "context", "记忆", "memory"],
    "Agent 框架": ["langgraph", "langchain", "agent sdk", "autogen"],
    "MCP": ["mcp"],
    "Coding Agent": ["claude code", "cursor", "codex", "ai 编码", "ai 编程"],
    "部署 / Docker": ["docker", "部署", "ci/cd"],
    "面向客户 / 交付": ["客户", "业务", "customer"],
    "Go": ["go", "golang"],
}
NOISE = ["go-to-market", "go beyond"]


def has_alias(text: str, alias: str) -> bool:
    if alias.isascii():
        pattern = rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])"
        return re.search(pattern, text) is not None
    return alias in text


def count_skills(jds: list[dict[str, str]]) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    for skill, aliases in KEYWORDS.items():
        hits: list[str] = []
        for jd in jds:
            text = jd["text"].lower()
            for noise in NOISE:
                text = text.replace(noise, " ")
            if any(has_alias(text, a) for a in aliases):
                hits.append(jd["id"])
        result[skill] = hits
    return result


def load_jds() -> list[dict[str, str]]:
    return json.loads(Path("part09/jds.json").read_text(encoding="utf-8"))


if __name__ == "__main__":
    jds = load_jds()
    counts = count_skills(jds)
    for skill, hits in sorted(counts.items(), key=lambda kv: -len(kv[1])):
        print(f"{len(hits)}/{len(jds)}  {skill}  {hits}")
```

<div class="line-notes">

- `"工具调用": ["tool calling", "工具调用", "function calling", "function schema"],` 把太宽的 `function` 换成两个更具体的词组。腾讯原文里有「Function Schema 设计」,所以加上 `function schema`。
- `"Coding Agent": ["claude code", "cursor", "codex", "ai 编码", "ai 编程"],` 补上网易用的「AI 编码」。注意中间有空格,因为网易原文是「AI 编码工具」,转小写后是 `ai 编码工具`。
- `NOISE = ["go-to-market", "go beyond"]` 已知误伤短语。这张表只会越来越长,每次抽查发现新的误伤就加一条。
- `def has_alias(text: str, alias: str) -> bool:` 判断一段文本里有没有某个别名。
- `if alias.isascii():` 别名全是英文字符时(比如 `go`、`mcp`)才用正则加「前后不是字母」;`isascii()` 对 `"go"` 返回 True,对 `"评测"` 返回 False。
- `pattern = rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])"` `re.escape` 把别名里有特殊含义的字符转义。`ci/cd` 里的 `/` 没事,但如果哪天你加了 `c++`,`+` 在正则里表示「一个或多个」,不转义就会错。`re.escape("ci/cd")` 得到 `ci/cd`,`re.escape("c++")` 得到 `c\+\+`。
- `return re.search(pattern, text) is not None` 这里没写 `re.I`,因为调用前 `text` 已经转成小写了。
- `return alias in text` 中文别名照旧用子串判断。中文没有空格分词,「评测」出现在「评测集」里也算提到评测,这是我们想要的。
- `def count_skills(jds: list[dict[str, str]]) -> dict[str, list[str]]:` 输入 JD 列表,返回「技能 → 命中的 JD id 列表」。
- `text = jd["text"].lower()` 每份 JD 先转小写。
- `text = text.replace(noise, " ")` 把误伤短语替换成空格。Intercom 那份里两处 `go-to-market` 和一处 `go beyond` 都被抹掉,剩下的文本里再也没有独立的 go。
- `if any(has_alias(text, a) for a in aliases):` 和 v1 一样用 `any`,只是判断换成了 `has_alias`。
- `def load_jds() -> list[dict[str, str]]:` 读文件也抽成函数,别的脚本 import 它就行,不用重复写路径。
- `if __name__ == "__main__":` 只有直接运行这个文件时才执行下面的代码;被别的文件 import 时不执行。相当于 Node 里的 `if (require.main === module)`。明天你会看到忘了写它会出什么事。
- `for skill, hits in sorted(counts.items(), key=lambda kv: -len(kv[1])):` 按命中数从多到少排序。`kv` 是 `("Python", [...])` 这样的元组,`kv[1]` 是命中列表,取负号就是倒序。相当于 JS 的 `.sort((a, b) => b[1].length - a[1].length)`。
- `print(f"{len(hits)}/{len(jds)}  {skill}  {hits}")` 数字放最前面,中文宽度问题就不影响阅读了。

</div>

```bash
uv run python part09/kw_count_v2.py
```

```text
4/5  Python  ['tencent', 'netease', 'zhaopin_fde', 'intercom_fde']
3/5  评测  ['tencent', 'netease', 'zhaopin_rag']
3/5  RAG / 检索  ['tencent', 'netease', 'zhaopin_rag']
3/5  Agent 框架  ['tencent', 'netease', 'zhaopin_fde']
3/5  Coding Agent  ['tencent', 'netease', 'zhaopin_fde']
3/5  面向客户 / 交付  ['netease', 'zhaopin_rag', 'intercom_fde']
2/5  工具调用  ['tencent', 'netease']
2/5  上下文 / 记忆  ['tencent', 'netease']
2/5  Go  ['tencent', 'zhaopin_fde']
1/5  MCP  ['tencent']
1/5  部署 / Docker  ['zhaopin_fde']
```

和 v1 比:Go 从 3 变 2,Intercom 没了;工具调用从 3 变 2,Intercom 没了;Coding Agent 从 2 变 3,网易补上了。三处都和原文对得上。

### 拿全量数据再跑一次,又冒出两个问题

五份 JD 的结果对了,不代表规则就对了。我用同一个 `count_skills` 去跑了站长调研里全部带正文的 JD(国内 334 条、海外 185 条,这份数据没有公开,你跑不了,我把结果贴出来):

```text
domestic 334
面向客户 / 交付 68%  Python 64%  RAG / 检索 62%  上下文 / 记忆 52%  评测 49%  工具调用 47%  部署 / Docker 37%  Agent 框架 34%  Go 28%  MCP 23%  Coding Agent 16%
overseas 185
Python 57%  RAG / 检索 40%  面向客户 / 交付 35%  上下文 / 记忆 34%  Agent 框架 28%  部署 / Docker 23%  工具调用 16%  MCP 13%  Go 11%  Coding Agent 8%  评测 5%
```

两个数一眼就不对。

**海外评测只有 5%。** 前面那张调研表里海外评测是 62%,是两边最看重的技能之一。原因出在第三步那个「前后不是字母」:英文 JD 写的是 evaluation、evaluations、evals,`eval` 后面紧跟着字母 `u` 或 `s`,全被排除了。修 Go 的规则把 eval 弄坏了。这就是规则的典型脾气:为一个词加的限制,会悄悄伤到另一个词。动手练习第 1 题让你修它。

**国内「面向客户」68%,比 Python 还高。** 原因是别名里有「业务」,国内 JD 里「业务场景」「业务价值」几乎每份都有,但大多数和「直接对接客户」没关系。别名太宽了。练习第 2 题让你去掉它看看会怎样。

所以我的结论是:关键词统计能帮你省掉读几百份 JD 的时间,但数字只能看方向。真正写进简历之前,还是要回到你想投的那三五份 JD 原文。

## 第五步:生成对照表

现在把「我的证据」接上去。下面这份证据表是按这门课的毕业项目写的,你要换成你自己的:证据写到「哪个项目、哪几天、做了什么」这个粒度,简历哪一行先按你打算的位置写(明天写项目经历时会定下来)。

```python
# agent-zero-lab/part09/evidence_map.py
from pathlib import Path

from part09.kw_count_v2 import count_skills, load_jds

EVIDENCE: dict[str, tuple[str, str]] = {
    "Python": ("整门课的代码,SupportPilot 全部用 Python 写", "技能栏第 1 行"),
    "评测": ("SupportPilot 三层评测 + CI 门禁(Day 476–483)", "项目 1 第 2 条"),
    "RAG / 检索": ("帮助中心混合检索 + 引用(Day 448–451)", "项目 1 第 1 条"),
    "工具调用": ("业务工具注册表、权限分级(Day 452–453)", "项目 1 第 1 条"),
    "上下文 / 记忆": ("对话压缩 + 客户画像(Day 464–466)", "项目 1 第 3 条"),
    "Agent 框架": ("LangGraph 九个节点 + interrupt 审批(Day 460–462)", "项目 1 第 1 条"),
    "MCP": ("业务工具包成 MCP server(Day 456)", "项目 1 第 1 条"),
    "Coding Agent": ("", ""),
    "部署 / Docker": ("Docker 化 + 公网 demo 三道闸(Day 490)", "项目 1 第 4 条"),
    "面向客户 / 交付": ("", ""),
    "Go": ("", ""),
}

jds = load_jds()
counts = count_skills(jds)
rows = sorted(counts.items(), key=lambda kv: -len(kv[1]))

lines = ["| JD 关键词 | 出现 | 我的证据 | 简历哪一行 |", "| --- | --- | --- | --- |"]
gaps: list[str] = []
for skill, hits in rows:
    proof, where = EVIDENCE.get(skill, ("", ""))
    if not proof:
        gaps.append(skill)
        proof, where = "(空)", "先别写"
    lines.append(f"| {skill} | {len(hits)}/{len(jds)} | {proof} | {where} |")

out = Path("part09/keyword_table.md")
out.write_text("\n".join(lines) + "\n", encoding="utf-8")
print("\n".join(lines))
print(f"\n已写入 {out},没有证据的关键词:{gaps}")
```

<div class="line-notes">

- `from part09.kw_count_v2 import count_skills, load_jds` 复用上一步的两个函数。因为 v2 写了 `if __name__ == "__main__":`,import 时不会把 v2 的打印也跑一遍。
- `EVIDENCE: dict[str, tuple[str, str]] = {` 值是一个二元组:(证据, 简历哪一行)。元组相当于 TS 里的 `[string, string]`。
- `"Coding Agent": ("", ""),` 先空着。其实你从 [Day 103](/blog/agent-zero/day-103-coding-agent-for-learning/) 就开始用 Coding Agent 学编程,[Day 210–211](/blog/agent-zero/day-210-coding-agent-1/) 写过 AGENTS.md 和 hooks,Day 497 还专门讲了怎么审 AI 写的代码。这一行属于「会但没写」,练习第 3 题补上。
- `"面向客户 / 交付": ("", ""),` 也先空着。Day 436 你像 FDE 那样做过需求访谈,但那是模拟的,算不算证据要你自己判断,Day 500 会从工作经历里找。
- `"Go": ("", ""),` 真不会,就空着。
- `rows = sorted(counts.items(), key=lambda kv: -len(kv[1]))` 和 v2 一样按出现次数排序,高频的排前面,先处理它们。
- `lines = ["| JD 关键词 | 出现 | 我的证据 | 简历哪一行 |", "| --- | --- | --- | --- |"]` 先放 Markdown 表格的表头两行。最后生成的是一个 `.md` 文件,在 Zed 或 GitHub 上打开就是表格。
- `proof, where = EVIDENCE.get(skill, ("", ""))` `dict.get(key, 默认值)`,找不到这个技能就返回两个空字符串,不会报 KeyError。相当于 JS 的 `EVIDENCE[skill] ?? ["", ""]`。
- `if not proof:` 空字符串是假值。实跑有三个技能进了这个分支。
- `lines.append(f"| {skill} | {len(hits)}/{len(jds)} | {proof} | {where} |")` 拼一行表格。第一行是 `| Python | 4/5 | 整门课的代码,SupportPilot 全部用 Python 写 | 技能栏第 1 行 |`。
- `out.write_text("\n".join(lines) + "\n", encoding="utf-8")` 用换行把所有行连起来写进文件。`"\n".join(lines)` 相当于 JS 的 `lines.join("\n")`。
- `print(f"\n已写入 {out},没有证据的关键词:{gaps}")` 最后把空白列出来,这是今天最有用的一行输出。

</div>

这个脚本要从 `agent-zero-lab/` 目录用 `-m` 方式运行,因为它要 import `part09` 这个包:

```bash
uv run python -m part09.evidence_map
```

```text
| JD 关键词 | 出现 | 我的证据 | 简历哪一行 |
| --- | --- | --- | --- |
| Python | 4/5 | 整门课的代码,SupportPilot 全部用 Python 写 | 技能栏第 1 行 |
| 评测 | 3/5 | SupportPilot 三层评测 + CI 门禁(Day 476–483) | 项目 1 第 2 条 |
| RAG / 检索 | 3/5 | 帮助中心混合检索 + 引用(Day 448–451) | 项目 1 第 1 条 |
| Agent 框架 | 3/5 | LangGraph 九个节点 + interrupt 审批(Day 460–462) | 项目 1 第 1 条 |
| Coding Agent | 3/5 | (空) | 先别写 |
| 面向客户 / 交付 | 3/5 | (空) | 先别写 |
| 工具调用 | 2/5 | 业务工具注册表、权限分级(Day 452–453) | 项目 1 第 1 条 |
| 上下文 / 记忆 | 2/5 | 对话压缩 + 客户画像(Day 464–466) | 项目 1 第 3 条 |
| Go | 2/5 | (空) | 先别写 |
| MCP | 1/5 | 业务工具包成 MCP server(Day 456) | 项目 1 第 1 条 |
| 部署 / Docker | 1/5 | Docker 化 + 公网 demo 三道闸(Day 490) | 项目 1 第 4 条 |

已写入 part09/keyword_table.md,没有证据的关键词:['Coding Agent', '面向客户 / 交付', 'Go']
```

如果你直接 `uv run python part09/evidence_map.py`(不带 `-m`),会看到这个报错:

```text
ModuleNotFoundError: No module named 'part09'
```

原因是不带 `-m` 时,Python 把脚本所在的 `part09/` 目录当成搜索起点,在 `part09/` 里面当然找不到一个叫 `part09` 的包。带 `-m` 时搜索起点是你当前所在的 `agent-zero-lab/`。第一部分讲模块那天见过同一个错误。

看输出最后一行。三个空白要分开对待:Coding Agent 是「会但没写」,补一行证据就行;面向客户要想一想你有没有真实经历;Go 是「真不会」,简历上不写,面试被问就直说没用过、但 Python 和 TypeScript 写得熟。在 3/5 的 JD 里出现的 Coding Agent 却空着,这是这张表帮你抓到的最值钱的一处。

## 第六步:让模型帮你读 JD,但别让它替你判断

规则词典的毛病是你没想到的词它永远抓不到。网易那份 JD 里还有「提示词工程」「基础前后端开发能力」「智能客服」,我的词典里一个都没有。这类「我不知道我漏了什么」的问题,交给大模型读一遍比自己想更快。

这一步用到 [Day 147–151](/blog/agent-zero/day-147-structured-1/) 的结构化输出:让模型只回 JSON,再用 pydantic 校验。`common/llm.py` 是 Day 135 起封装的 LLMClient,`chat()` 返回的结果里有 `.content`(回复文本)、`.prompt_tokens`、`.completion_tokens`、`.cost`(按 `.env` 里的价格算出的人民币)。

```python
# agent-zero-lab/part09/jd_extract.py
import json

from pydantic import BaseModel

from common.llm import LLMClient
from part09.kw_count_v2 import KEYWORDS, has_alias, load_jds


class Keyword(BaseModel):
    phrase: str
    kind: str


class Extraction(BaseModel):
    keywords: list[Keyword]


SYSTEM = (
    "你是招聘方的技术面试官。从 JD 里抽出候选人简历上应该出现的技能和经历关键词。"
    "phrase 必须是 JD 原文里出现过的写法,一个字都不要改;"
    "kind 只能是 技能、经历、软素质 三选一。"
    '只输出 JSON:{"keywords": [{"phrase": "...", "kind": "..."}]}'
)

jd = next(j for j in load_jds() if j["id"] == "netease")
llm = LLMClient()
r = llm.chat(
    [{"role": "system", "content": SYSTEM}, {"role": "user", "content": jd["text"]}],
    response_format={"type": "json_object"},
    temperature=0,
)
data = Extraction.model_validate(json.loads(r.content))

all_aliases = [a for aliases in KEYWORDS.values() for a in aliases]
for k in data.keywords:
    in_jd = k.phrase in jd["text"]
    covered = any(has_alias(k.phrase.lower(), a) for a in all_aliases)
    print(f"{k.kind:<4} 原文里有={in_jd!s:<6} 词典覆盖={covered!s:<6} {k.phrase}")
print(f"\n{len(data.keywords)} 个关键词 | {r.prompt_tokens} 输入 / {r.completion_tokens} 输出 | ¥{r.cost:.5f}")
```

<div class="line-notes">

- `class Keyword(BaseModel):` pydantic 模型,定义一个关键词长什么样:原文短语和类别。相当于用 zod 写 `z.object({ phrase: z.string(), kind: z.string() })`。
- `class Extraction(BaseModel):` 外层只有一个字段 `keywords`,是 Keyword 的列表。
- `"phrase 必须是 JD 原文里出现过的写法,一个字都不要改;"` 这句很关键。我们要的是 JD 的原话,好直接搬进简历技能栏;模型很爱「总结」成它自己的说法,得明说不许改。
- `'只输出 JSON:{"keywords": [{"phrase": "...", "kind": "..."}]}'` DeepSeek 的 JSON 模式要求提示词里出现「json」字样并给出样例格式,不然可能报错或输出空内容。
- `jd = next(j for j in load_jds() if j["id"] == "netease")` 从五份里挑出网易那份。`next(生成器)` 拿第一个满足条件的,相当于 JS 的 `.find(j => j.id === "netease")`。
- `llm = LLMClient()` 读 `.env` 里的 `LLM_MODEL`,我实跑是 `deepseek-flash`。
- `response_format={"type": "json_object"},` 打开 JSON 模式,模型保证输出能被 `json.loads` 解析。
- `temperature=0,` 让输出尽量稳定。注意是「尽量」,明天你会看到 temperature=0 两次跑出来也不完全一样。
- `data = Extraction.model_validate(json.loads(r.content))` 先解析 JSON,再用 pydantic 校验结构。字段缺了或类型不对会抛 ValidationError,不会悄悄往下走。
- `all_aliases = [a for aliases in KEYWORDS.values() for a in aliases]` 嵌套推导式,把字典里所有别名摊平成一个列表,一共 37 个。读法是从左到右:先遍历每个 `aliases` 列表,再遍历里面每个 `a`。
- `in_jd = k.phrase in jd["text"]` 校验模型说的「原文」是不是真在原文里。模型说不改,你要验证。
- `covered = any(has_alias(k.phrase.lower(), a) for a in all_aliases)` 这个短语能不能被我们的词典抓到。False 的就是词典的盲区。
- `print(f"\n{len(data.keywords)} 个关键词 | {r.prompt_tokens} 输入 / {r.completion_tokens} 输出 | ¥{r.cost:.5f}")` 打印花费,每次调模型都要知道花了多少钱。

</div>

```bash
uv run python -m part09.jd_extract
```

我实跑的输出:

```text
经历   原文里有=True   词典覆盖=False  本科及以上计算机、AI 相关专业
经历   原文里有=True   词典覆盖=False  2 年以上大模型 / 智能体开发经验
技能   原文里有=True   词典覆盖=True   精通 Python
经历   原文里有=True   词典覆盖=False  对话智能体
经历   原文里有=True   词典覆盖=False  决策智能体
经历   原文里有=True   词典覆盖=False  多智能体系统落地经验
经历   原文里有=True   词典覆盖=True   对接业务团队梳理流程
经历   原文里有=True   词典覆盖=False  输出智能体解决方案
技能   原文里有=True   词典覆盖=True   LangGraph
技能   原文里有=True   词典覆盖=True   Anthropic Agent SDK
技能   原文里有=True   词典覆盖=True   感知、规划、记忆、行动模块开发
技能   原文里有=True   词典覆盖=True   检索增强生成
技能   原文里有=True   词典覆盖=True   工具调用
技能   原文里有=True   词典覆盖=False  提示词工程
技能   原文里有=True   词典覆盖=False  基础前后端开发能力
技能   原文里有=True   词典覆盖=True   AI 编码工具
技能   原文里有=True   词典覆盖=True   业务接口开发
经历   原文里有=True   词典覆盖=False  智能客服
经历   原文里有=True   词典覆盖=False  自动化运营
经历   原文里有=True   词典覆盖=False  流程机器人
技能   原文里有=True   词典覆盖=True   效果指标体系
技能   原文里有=True   词典覆盖=False  准确率、安全性与可控性
软素质  原文里有=True   词典覆盖=False  逻辑清晰
软素质  原文里有=True   词典覆盖=False  擅长跨团队协作
软素质  原文里有=True   词典覆盖=False  线上 AI 应用问题排查与工程迭代能力

25 个关键词 | 288 输入 / 393 输出 | ¥0.00372
```

花费是 ¥0.00372。按 2026 年 10 月查到的 [DeepSeek 定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing),deepseek-flash 高峰时段输入未命中 2 元/百万 token、输出 8 元/百万 token,算式是 288 × 2 / 1,000,000 + 393 × 8 / 1,000,000 = 0.000576 + 0.003144 ≈ ¥0.0037,和脚本打印的对得上。

25 个短语全部能在原文里找到,这次模型守住了「不改原文」。词典覆盖为 False 的里面,我会挑出三个对我有用的:「提示词工程」(词典漏了一整组 Prompt)、「基础前后端开发能力」(这是你的老本行,必须写进简历)、「智能客服」(SupportPilot 就是智能客服,这个词要原样出现在项目标题里)。「对话智能体」「多智能体系统」我暂时没有证据,「本科」「2 年以上」是门槛,Day 500 处理。

模型在这里干的活是「读」,不是「判断」。它找到的词要不要进简历、算不算你有的能力,还是你自己对着证据表决定。别让模型直接给你写一份「匹配度 90% 的简历」,那样它会把你没有的东西也写进去。

## 动手练习

**练习 1:让 `eval` 也能匹配 evaluation。** 给别名加一个小语法:以 `*` 结尾表示「前缀匹配」,`eval*` 能匹配 eval、evals、evaluation,但不能匹配 medieval。改写 `has_alias`,用五个测试句验证。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex498_prefix.py
import re


def has_alias(text: str, alias: str) -> bool:
    prefix = alias.endswith("*")
    word = alias.rstrip("*")
    if word.isascii():
        tail = "" if prefix else r"(?![a-z0-9])"
        pattern = rf"(?<![a-z0-9]){re.escape(word)}{tail}"
        return re.search(pattern, text) is not None
    return word in text


tests = [
    ("eval", "run evaluations on the latest models"),
    ("eval*", "run evaluations on the latest models"),
    ("eval*", "we ship evals in ci"),
    ("eval*", "medieval history"),
    ("go", "go-to-market"),
]
for alias, text in tests:
    print(f"{alias:<7}{text!r:<40}{has_alias(text, alias)}")
```

<div class="line-notes">

- `prefix = alias.endswith("*")` `"eval*".endswith("*")` 是 True,`"go"` 是 False。
- `word = alias.rstrip("*")` 去掉结尾的星号,`"eval*"` 变成 `"eval"`。相当于 JS 的 `alias.replace(/\*+$/, "")`。
- `tail = "" if prefix else r"(?![a-z0-9])"` 前缀匹配就不检查后面是什么字母,普通别名照旧检查。Python 的 `a if 条件 else b` 相当于 JS 的 `条件 ? a : b`。
- `pattern = rf"(?<![a-z0-9]){re.escape(word)}{tail}"` 前面的限制保留,所以 medieval 里的 eval(前面是 i)不会命中。
- `("go", "go-to-market"),` 最后一组提醒你:这个函数本身不处理 NOISE,go-to-market 还得靠 `count_skills` 里的替换。

</div>

新建 `part09/ex/` 目录并放一个空的 `__init__.py`,然后 `uv run python -m part09.ex.ex498_prefix`:

```text
eval   'run evaluations on the latest models'  False
eval*  'run evaluations on the latest models'  True
eval*  'we ship evals in ci'                   True
eval*  'medieval history'                      False
go     'go-to-market'                          True
```

第一行 False 正是正文里那个 bug:不带星号的 `eval` 碰到 evaluations 不算。我把 `KEYWORDS["评测"]` 里的 `eval` 换成 `eval*`,再用全量海外 185 条跑,评测从 5% 回到 56%。站长调研表里是 62%,差的那几个点是因为调研用的规则还包括 benchmark、LLM-as-judge 等词,我们的词典没有。

</details>

**练习 2:观察题。** 把「面向客户 / 交付」的别名去掉「业务」,只留 `客户` 和 `customer`,五份 JD 的命中会怎么变?变化是好是坏?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex498_business.py
from part09.kw_count_v2 import KEYWORDS, count_skills, load_jds

jds = load_jds()
before = count_skills(jds)["面向客户 / 交付"]
KEYWORDS["面向客户 / 交付"] = ["客户", "customer"]
after = count_skills(jds)["面向客户 / 交付"]
print("带「业务」:", before)
print("去掉之后:", after)
```

<div class="line-notes">

- `before = count_skills(jds)["面向客户 / 交付"]` 先用原词典数一次。
- `KEYWORDS["面向客户 / 交付"] = ["客户", "customer"]` 直接改 import 进来的字典。`count_skills` 每次调用都现读 `KEYWORDS`,所以改完再调用就生效。这招只适合做实验,正式代码里别去改别的模块的全局变量。
- `after = count_skills(jds)["面向客户 / 交付"]` 改完再数一次。

</div>

```text
带「业务」: ['netease', 'zhaopin_rag', 'intercom_fde']
去掉之后: ['intercom_fde']
```

只剩 Intercom。这个结果有好有坏。网易那份被去掉说得过去,它的「对接业务团队梳理流程」是对内的业务方;但智联那份写的是「能直接面对业务部门沟通需求,本岗位不设中间产品经理转译需求」,这其实是很强的「面向客户」要求,去掉「业务」后漏了。更好的做法是用更具体的词组,比如「业务部门」「面对业务」「对接客户」,而不是一刀切。没有完美的词典,只有抽查过的词典。

</details>

**练习 3:开放题。** 把对照表里 Coding Agent 那一行的证据补上(用你自己真实做过的事),再给词典加上第六步发现的三组词:Prompt、前端 / 全栈、智能客服,看它们在五份 JD 里各出现几次。

<details><summary>参考答案</summary>

示范解法。证据那一行,我会在 `evidence_map.py` 的 `EVIDENCE` 里改成:

```python
    "Coding Agent": ("Day 210–211 写 AGENTS.md 和 hooks;Day 497 审 AI 生成代码的清单", "技能栏第 3 行"),
```

词典扩充单独写个脚本试,不动 v2 原文件:

```python
# agent-zero-lab/part09/ex/ex498_extend.py
from part09.kw_count_v2 import KEYWORDS, count_skills, load_jds

KEYWORDS["Prompt"] = ["prompt", "提示词"]
KEYWORDS["前端 / 全栈"] = ["前端", "前后端", "全栈", "javascript", "typescript"]
KEYWORDS["智能客服"] = ["智能客服", "客服", "customer support"]

jds = load_jds()
counts = count_skills(jds)
for skill in ["Prompt", "前端 / 全栈", "智能客服"]:
    print(f"{len(counts[skill])}/{len(jds)}  {skill}  {counts[skill]}")
```

<div class="line-notes">

- `KEYWORDS["Prompt"] = ["prompt", "提示词"]` 腾讯写的是「Prompt 与 Context Engineering」,网易写的是「提示词工程」,两种写法都要有。
- `KEYWORDS["前端 / 全栈"] = ["前端", "前后端", "全栈", "javascript", "typescript"]` 「前后端」其实已经包含「前端」两个字吗?不包含,「前后端」是「前」「后」「端」,中间隔了一个「后」,所以要单独列。
- `for skill in ["Prompt", "前端 / 全栈", "智能客服"]:` 只打印新加的三组。

</div>

```text
2/5  Prompt  ['tencent', 'netease']
3/5  前端 / 全栈  ['tencent', 'netease', 'intercom_fde']
1/5  智能客服  ['netease']
```

前端 / 全栈在 3/5 里出现(腾讯是 TypeScript,网易是前后端,Intercom 是 JavaScript),这是你最容易被忽略的强项,对照表里它的证据就是你的工作经历。补完之后 `evidence_map.py` 的空白只剩「面向客户 / 交付」和 Go。

</details>

**验收标准**

- `kw_count_v2.py` 在五份 JD 上的输出和上面一致,你能指着原文说出 v1 那三处误伤和漏掉分别是哪一句。
- 你能讲清 `\b` 为什么在「熟悉Go语言」上失败。
- 你有一份自己的 `keyword_table.md`,至少用三份你真想投的 JD 做过,每个空白都标了「会但没写」或「真不会」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| JD | Job Description,职位描述,招聘页上的岗位职责和任职要求 |
| 关键词对照表 | 把 JD 里的技能词逐一对到你的具体证据和简历上的位置,例:评测 → 三层评测+CI 门禁 → 项目 1 第 2 条 |
| 证据 | 能当场打开给面试官看的东西:哪个项目、哪个模块、哪个数字 |
| 误伤 | 规则把不该算的算进来,例:`go` 命中 Go-to-Market |
| 漏掉 | 规则把该算的没算,例:网易的「AI 编码工具」没被 Coding Agent 抓到 |
| 正则表达式 | 描述字符串模式的小语言,Python 用 `re` 模块,JS 用 `/.../` |
| 词边界 `\b` | 正则里「单词字符和非单词字符之间」的位置;Python 默认把汉字也算单词字符 |
| 环视 | `(?<!...)`、`(?!...)` 这类只检查前后字符、不吃掉字符的写法 |
| Agent Harness | 国内大厂常见的岗位方向,指 Agent 的运行底座:循环调度、工具注册、上下文组装、沙箱、checkpoint |
| FDE | Forward Deployed Engineer,驻在客户那边做交付的工程师 |
| 简历初筛 | HR 或系统按学历、年限、关键词过滤简历的环节 |

## 常见误区

**技术栈列得越长越好。** 列了 K8s,面试官就会问 K8s。每个词都是一个追问点,写你答不上来的词等于给自己挖坑。对照表中间列空着的词,不写。

**关键词统计的数字直接当结论。** 本文全量跑出「海外评测 5%」「国内面向客户 68%」,两个都是规则的错,不是市场的真相。规则跑完要抽原文核对,差几个百分点的别当回事。

**用 `\b` 匹配中英混排的文本。** Python 3 的 `re` 把汉字算作单词字符,「RAG检索」「Go语言」上的 `\bRAG\b`、`\bgo\b` 全部匹配失败,而且不报错,只是悄悄漏掉。中英混排用 `(?<![a-z0-9])` 这类只看英文字母的环视。

**别名越短越省事。** `go`、`function`、`rag` 这种短词在英文里到处都是(Go-to-Market、cross-functional、leverage 里的 rag 虽然被环视挡住了,但你得知道它在那)。别名尽量写成词组。

**让模型直接给你写一份匹配 JD 的简历。** 模型会把 JD 要求的东西往你身上套,包括你没有的。让它读 JD、找词,判断留给自己和证据表。

**不带 `-m` 运行要 import 包的脚本。** 会报 `ModuleNotFoundError: No module named 'part09'`。在 `agent-zero-lab/` 下用 `uv run python -m part09.evidence_map`。

## 学习资料

### 文档与文章

- [腾讯 · Agent Harness 工程师](http://careers.tencent.com/jobdesc.html?postId=2098332758412804096):国内大厂 Agent 岗写得最细的 JD 之一,职责里的 tracing、评测、调试工具链,要求里的「Coding Agent 典型 failure mode」,对照你的对照表逐条看,20 分钟。
- [网易 · Agent 应用开发工程师](https://hr.163.com/job-detail.html?id=76697):「集成至智能客服」「搭建效果指标体系」和 SupportPilot 几乎一一对应,适合当第一份练手的 JD。
- [智联招聘 · AI 大模型应用开发工程师(大国智能网天)](https://www.zhaopin.com/jobdetail/CCL1269552950J40849301316.htm):中小公司 JD 的典型,要求写得非常具体,Day 501 的「代表项目说明」四个问题也来自这里。
- [Intercom · Forward Deployed Engineer](https://job-boards.greenhouse.io/intercom/jobs/8201208):海外 FDE 岗怎么写要求,注意它几乎不点名框架,看重的是 shipping 和 customer impact。
- [Python 文档 · 正则表达式指南](https://docs.python.org/zh-cn/3.12/howto/regex.html):中文版,读「简单模式」和「更多元字符」两节就够今天用,30 分钟。
- [regex101](https://regex101.com/):在线调试正则,左边选 Python 风格,把今天的几个模式贴进去,看每个字符匹配了什么。
- [Tech Interview Handbook · Resume](https://www.techinterviewhandbook.org/resume/):英文,前 Meta 工程师写的技术简历指南,「ATS 怎么筛简历」那段讲了为什么要用 JD 原词。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1NS421R7xJ&autoplay=0&high_quality=1" title="原来BOSS上HR都是在看这些!这下知道要好好写在线简历了吧?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>苏苏的职场日记 · 原来BOSS上HR都是在看这些!这下知道要好好写在线简历了吧? · 2 分半,从招聘方后台看 Boss 直聘的在线简历,印证「按关键词搜人」这件事。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV18M4y1C7tS&autoplay=0&high_quality=1" title="手把手带你写简历!HR最喜欢的简历套路有哪些?| 职场对谈01" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>杨真直 · 手把手带你写简历!HR最喜欢的简历套路有哪些?| 职场对谈01 · 10 分钟,和 HR 对谈,听 HR 第一眼看什么。不是技术岗专门的,但「HR 怎么扫简历」那部分通用。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/ck5nw7R1uEs" title="Ex-Google Recruiter Teaches Resume Masterclass to get FAANG Interviews" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Farah Sharghi · Ex-Google Recruiter Teaches Resume Masterclass to get FAANG Interviews · 前 Google 招聘官讲招聘方怎么读技术简历,准备投海外岗时看。</figcaption>
</figure>

### 书籍

- Gergely Orosz《The Tech Resume Inside Out》(自出版,2020):约 200 页,作者是前 Uber 工程经理,前几章讲招聘流程里简历被谁、用多长时间、按什么看,今天读这部分,1 小时。没有确认到中译本,读英文版。

### 开源项目与代码

- [yangshun/tech-interview-handbook](https://github.com/yangshun/tech-interview-handbook):上面那个简历指南的源码仓库,求职部分后面几天还会用到。
- 站长的 JD 调研数据和打标规则没有公开,今天的 `jds.json` 是从里面摘出来的五份,足够把脚本跑通。

## 自测

1. 根据今天的调研数据,国内和海外 Agent 岗 JD 侧重点最大的差别是什么?对你写简历有什么影响?

<details><summary>答案</summary>

国内更看重 Agent 内部机制:上下文工程(66% 对 25%)、工具调用(63% 对 39%)、多 Agent(42% 对 22%)明显更高,大厂常见 Agent Harness 方向;海外更看重上线、交付和面向客户,部署、面向客户的比例更高。所以投国内岗,项目经历要写出你处理了哪些 Agent 内部问题;投海外岗,突出上线、结果数字和与业务方协作。

</details>

2. `re.search(r"\bgo\b", "熟悉Go语言", re.I)` 返回什么?为什么?

<details><summary>答案</summary>

返回 None。Python 3 的正则默认按 Unicode 判断单词字符,汉字算单词字符。「悉」和 G 之间、o 和「语」之间都不是词边界,所以 `\bgo\b` 匹配不上。改用 `(?<![a-z0-9])go(?![a-z0-9])` 就能匹配。

</details>

3. 对照表中间列为空的关键词,有哪两种情况?分别怎么处理?

<details><summary>答案</summary>

一种是「会但没写」,比如你一直在用 Coding Agent 却没写进简历,补一行证据进去;另一种是「真不会」,比如 Go,简历上不写,面试被问到如实说没用过,并说明你会什么。不要为了对上关键词硬写。

</details>

4. 为什么建议用 JD 原文的写法,而不是自己的说法?

<details><summary>答案</summary>

很多公司的初筛靠关键词搜索,包括 HR 在 Boss 直聘上搜人和 ATS 系统过滤。你写「上下文管理」而 JD 写「Context Engineering」,搜索时就对不上,没人会替你翻译。

</details>

5. (面试题)「你是怎么判断自己适不适合这个岗位的?」用今天的方法回答。

<details><summary>答案</summary>

参考答法:我把 JD 的要求拆成关键词,逐条对到我做过的东西上。比如你们写的评测和回归判定,我在 SupportPilot 里做了三层评测并接了 CI 门禁,test 集成功率有记录;工具调用和 MCP 也有对应的模块。我对不上的是 Go,我没在生产里写过,但 Python 和 TypeScript 是主力。说完具体对上了哪几条、哪条是短板,比一句「我觉得很匹配」可信得多。

</details>

## 明天预告

Day 499 · 简历(二):项目经历,问题、方案、数据。今天的对照表告诉你每个关键词要写在「项目 1 第几条」,明天就把这几条真正写出来:先看一段典型的坏写法,写一个检查空话和口径的小脚本,再让模型按记录表改写,并且抓它编出来的数字。
