---
title: 'Day 516 · 普通篇结业:能力自检和接下来怎么进阶'
description: '普通篇最后一个内容日。把九个部分走过的路清点一遍,写一个自检脚本:每项能力自评 1 到 5 分,但只有指向真实文件或链接的才能打勾,光写「做过」的一律不算;再写一个脚本拿一条虚构的 JD 逐条对照自检结果,看哪几条有证据、哪几条要补、哪几条课程压根没讲。最后讲没达标怎么排补课顺序、进阶篇的几个方向怎么选,以及怎么长期跟上这个领域。'
pubDate: 2026-10-27
regime: none
tags: ['graduation', 'self-assessment', 'job-search', 'python', 'agent-zero']
series: 'agent-zero'
day: 516
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 515](/blog/agent-zero/day-515-industry-2/) 把五项框架(知识源、工具、红线、验收指标、出错代价)用到了 SaaS 客服、金融、医疗、电商四个行业,每个行业配一个能跑的小演示,最后练了一段两分钟的迁移讲稿。再往前三天,[Day 511](/blog/agent-zero/day-511-job-channels/) 到 [Day 513](/blog/agent-zero/day-513-offer/) 讲了去哪找岗位、海外远程和 FDE、面试流程和谈薪,[Day 514](/blog/agent-zero/day-514-industry-1/) 讲了怎么换行业。

到这里,普通篇要讲的东西全讲完了。今天不学新概念,做一次清点:你手里到底有什么,哪些能当证据拿出来,哪些只是「感觉学过」。清点完再决定接下来是补课、继续投简历,还是往进阶篇走。明天([Day 517](/blog/agent-zero/day-517-week74-review/))是第 74 周复习,后天开始进阶。

## 今天要解决的问题

今天结束时你应该能:

1. 说出九个部分各留给你一个什么产出,在自己的仓库里找得到对应的文件。
2. 写出 `selfcheck.py`:每项能力一行,自评分加证据,证据必须指向磁盘上真有的文件或一个链接才打勾;跑一遍,得到一个带补课顺序的清单。
3. 写出 `jd_match.py`:拿任意一条 JD,逐条要求对照你的自检结果,分出「有证据」「证据不足」「没证据」「课程没覆盖」四类,并算出要补哪几项。
4. 说清楚自己接下来是补课、投递还是进阶,并选出一两个进阶方向,知道它们在进阶篇的哪几天讲。

预计用时 3 小时,其中一半时间花在填自己的证据表上,这部分没有代码,但最花力气。前置:[Day 498](/blog/agent-zero/day-498-resume-1/) 的关键词表(读 JD 的方法)、[Day 503](/blog/agent-zero/day-503-week72-review/) 练习 3 的按技能覆盖率给 JD 排序、[Day 513](/blog/agent-zero/day-513-offer/) 的漏斗(什么时候该补课、什么时候该继续投)。今天不调模型,花费 ¥0。

学法提示:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `judge`;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 九个部分走过的路

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="普通篇九个部分:地基、大模型与 API、工具与循环、RAG 与上下文、MCP 与编排、评测与观测、生产化、SupportPilot、求职,每个部分标出 Day 范围和一个产出">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <rect x="20" y="16" width="190" height="82" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="30" y="38" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一 地基 Day 0–105</text>
  <text x="30" y="58" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">Python HTTP SQL</text>
  <text x="30" y="76" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">产出:迷你账单库</text>
  <rect x="225" y="16" width="190" height="82" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="235" y="38" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">二 大模型与 API 106–155</text>
  <text x="235" y="58" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">token 账本 流式</text>
  <text x="235" y="76" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">产出:LLMClient</text>
  <rect x="430" y="16" width="190" height="82" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="440" y="38" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">三 工具与循环 156–211</text>
  <text x="440" y="58" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">function calling</text>
  <text x="440" y="76" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">产出:命令行 Agent</text>
  <rect x="20" y="108" width="190" height="82" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="30" y="130" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">四 RAG 上下文 212–270</text>
  <text x="30" y="150" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">切块 检索 评估</text>
  <text x="30" y="168" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">产出:文档问答 Agent</text>
  <rect x="225" y="108" width="190" height="82" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="235" y="130" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">五 MCP 与编排 271–340</text>
  <text x="235" y="150" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">MCP LangGraph 多 Agent</text>
  <text x="235" y="168" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">产出:工单分流 Agent</text>
  <rect x="430" y="108" width="190" height="82" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="440" y="130" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">六 评测观测 341–377</text>
  <text x="440" y="150" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">测试集 评审 tracing</text>
  <text x="440" y="168" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">产出:CI 回归门禁</text>
  <rect x="20" y="200" width="190" height="82" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="30" y="222" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">七 生产化 378–434</text>
  <text x="30" y="242" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">队列 成本 安全 部署</text>
  <text x="30" y="260" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">产出:公网上的服务</text>
  <rect x="225" y="200" width="190" height="82" fill="var(--paper)" stroke="var(--rule)"/>
  <text x="235" y="222" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">八 SupportPilot 435–497</text>
  <text x="235" y="242" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">把前七部分拼成一个</text>
  <text x="235" y="260" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">产出:毕业项目 + 代码审查机器人</text>
  <rect x="430" y="200" width="190" height="82" fill="var(--paper)" stroke="var(--rule)"/>
  <text x="440" y="222" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">九 求职 498–517</text>
  <text x="440" y="242" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">简历 面试 谈薪 行业</text>
  <text x="440" y="260" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">产出:简历、题库、漏斗</text>
</svg>
<figcaption>普通篇的九个部分。蓝色是「让模型动起来」的四块,琥珀色是「让它能上线」的三块,最后两块是把东西拼起来和拿出去。</figcaption>
</figure>

我回头看这九块,发现一条线一直在重复,就是每一个「它变好了」的说法都要有数字,每个数字都要说得清口径。[Day 145](/blog/agent-zero/day-145-prompt-lab/) 比提示词版本用的是成本和通过率,[Day 256](/blog/agent-zero/day-256-rag-eval-2/) 手算检索指标,[Day 375](/blog/agent-zero/day-375-eval-project-2/) 的 CI 门禁卡的是分数不能掉,[Day 511](/blog/agent-zero/day-511-job-channels/) 提醒你挂牌价不是成交价,[Day 513](/blog/agent-zero/day-513-offer/) 的漏斗在样本不到 5 条时拒绝下结论。如果你问我这门课里最值钱的是哪个习惯,就是这一条。招聘方区分「跟着教程搭过 demo」和「能在线上对一个 Agent 负责」的人,看的多半也是这个。

今天的自检脚本就是把这个习惯用在你自己身上:你说自己会 RAG,证据是哪个文件,里面有什么数。

## 能力自检:先列表,再脚本化

先把要查的能力列出来。下面十六项是我按普通篇的内容拆的,没有「JD 里出现几成」那种百分比,因为我手里没有一份能公开给你的、口径干净的统计。如果你想知道某一项在真实 JD 里多常见,用 [Day 498](/blog/agent-zero/day-498-resume-1/) 的关键词表和 [Day 503](/blog/agent-zero/day-503-week72-review/) 练习 3 的覆盖率脚本自己数一份,比信我给的数字可靠。

| 能力 | 回看哪几天 | 一份像样的证据 |
| --- | --- | --- |
| Python 工程 | [Day 66](/blog/agent-zero/day-066-async-1/)、[Day 71](/blog/agent-zero/day-071-pytest-1/)、[Day 149](/blog/agent-zero/day-149-structured-3/) | 一个小项目,pytest 通过的条数 |
| 大模型 API 与账本 | [Day 121](/blog/agent-zero/day-121-api-request/)、[Day 124](/blog/agent-zero/day-124-cost/)、[Day 136](/blog/agent-zero/day-136-llm-client-2/) | `LLMClient` 文件,账本里单次调用的花费 |
| 提示词与结构化输出 | [Day 141](/blog/agent-zero/day-141-prompt-3/)、[Day 150](/blog/agent-zero/day-150-structured-4/) | 抽取脚本和它在一批样本上的通过数 |
| 工具调用与 Agent 循环 | [Day 156](/blog/agent-zero/day-156-fc-idea/)、[Day 166](/blog/agent-zero/day-166-agent-min/)、[Day 507](/blog/agent-zero/day-507-live-coding/) | 手写的循环文件,默写判卷的成绩 |
| RAG | [Day 224](/blog/agent-zero/day-224-chunking/)、[Day 235](/blog/agent-zero/day-235-bm25/)、[Day 256](/blog/agent-zero/day-256-rag-eval-2/) | 检索代码加一个命中率 |
| 上下文工程与记忆 | [Day 262](/blog/agent-zero/day-262-context-budget/)、[Day 263](/blog/agent-zero/day-263-compaction/)、[Day 464](/blog/agent-zero/day-464-memory-session/)、[Day 465](/blog/agent-zero/day-465-memory-compact/) | 压缩前后同一批题的成功率对比 |
| MCP 与 Skills | [Day 271](/blog/agent-zero/day-271-mcp-why/)、[Day 280](/blog/agent-zero/day-280-mcp-seed/)、[Day 296](/blog/agent-zero/day-296-skills-1/) | 一个 server 文件,几个工具 |
| 编排框架与多 Agent | [Day 299](/blog/agent-zero/day-299-lg-one-node/)、[Day 311](/blog/agent-zero/day-311-lg-agent-loop/)、[Day 329](/blog/agent-zero/day-329-multi-agent-1/)、[Day 333](/blog/agent-zero/day-333-frameworks-1/) | 一张图的代码,说得出为什么用图 |
| 评测 | [Day 343](/blog/agent-zero/day-343-eval-pyramid/)、[Day 348](/blog/agent-zero/day-348-testcase-structure/)、[Day 355](/blog/agent-zero/day-355-llm-judge-1/)、[Day 375](/blog/agent-zero/day-375-eval-project-2/)、[Day 476](/blog/agent-zero/day-476-eval-scenarios/) | 评测集规模、评审和人工的一致率、CI 配置 |
| 可观测与 tracing | [Day 364](/blog/agent-zero/day-364-tracing-concepts/)、[Day 365](/blog/agent-zero/day-365-langfuse/)、[Day 484](/blog/agent-zero/day-484-obs-langfuse/) | 一条 trace 的链接或截图 |
| 服务化、队列与部署 | [Day 378](/blog/agent-zero/day-378-agent-api/)、[Day 388](/blog/agent-zero/day-388-arq/)、[Day 422](/blog/agent-zero/day-422-dockerfile-prod/)、[Day 425](/blog/agent-zero/day-425-deploy-route/) | 公网地址 |
| 成本、延迟与 ROI | [Day 396](/blog/agent-zero/day-396-cost-1/)、[Day 397](/blog/agent-zero/day-397-prompt-caching/)、[Day 399](/blog/agent-zero/day-399-model-routing/)、[Day 401](/blog/agent-zero/day-401-latency/) | 一份带算式的成本文档 |
| 安全与权限 | [Day 403](/blog/agent-zero/day-403-injection-1/)、[Day 407](/blog/agent-zero/day-407-defense-layers/)、[Day 411](/blog/agent-zero/day-411-permissions-1/)、[Day 415](/blog/agent-zero/day-415-sandbox/)、[Day 487](/blog/agent-zero/day-487-threat-model/) | 注入测试集和拦截率 |
| 数据库与 SQL | [Day 85](/blog/agent-zero/day-085-sql-1/)、[Day 87](/blog/agent-zero/day-087-sql-3/)、[Day 228](/blog/agent-zero/day-228-postgres-basics/)、[Day 292](/blog/agent-zero/day-292-text-to-sql-2/) | 一个 SQL 文件或 Postgres 里的表 |
| 需求拆解与客户沟通 | [Day 436](/blog/agent-zero/day-436-fde-requirements/)、[Day 437](/blog/agent-zero/day-437-prd/)、[Day 508](/blog/agent-zero/day-508-sysdesign-1/) | 一页 PRD 或一次访谈提纲 |
| 用 Coding Agent 干活并审查 | [Day 103](/blog/agent-zero/day-103-coding-agent-for-learning/)、[Day 210](/blog/agent-zero/day-210-coding-agent-1/)、[Day 211](/blog/agent-zero/day-211-coding-agent-2/)、[Day 494](/blog/agent-zero/day-494-code-review-1/) | AGENTS.md,或一个你审查并改过的 PR |

自评分的规矩我定三条。1 分是没接触过;3 分是做过,但被问「为什么这样做」会卡住;5 分是能讲给别人听,并且有作品放在那里。第二,**打勾要同时满足两件事:自评 4 分以上,并且证据能指到一个文件或一个链接**。第三,没写证据的项,不管你自评几分,都最多按 2 分算。

第三条看起来苛刻,不过你想想面试的场景:面试官问「你说你熟悉评测,做过什么」,你能答出的东西,恰好就是你写得出来的证据。写不出来的,面试时也答不出来。

### 第一版:写了字就算勾

先写最偷懒的版本,看它会出什么问题。我模拟了一个叫小林的学员,他的仓库放在 `agent-zero-lab` 旁边的 `me/` 目录里,证据存在 `me/evidence_bad.json`,每一项都只写了「做过」「会」「有」这种字。`me/` 里的十几个文件是我为了让证据里的路径能指到东西而造的,每个只有一行注释。你自己跑的时候不用造它们:把 `evidence.json` 里的路径换成你自己仓库里真有的文件,运行时第二个参数传仓库根目录(在仓库根目录里就是 `.`)。

```json
{"python":{"score":4,"evidence":"做过"},"llm_api":{"score":5,"evidence":"做过"},"prompt":{"score":4,"evidence":"会"},"loop":{"score":5,"evidence":"手写过"},"rag":{"score":4,"evidence":"做过"},"context":{"score":3,"evidence":"读过 Manus 那篇"},"mcp":{"score":4,"evidence":"写过"},"framework":{"score":4,"evidence":"做过 LangGraph"},"eval":{"score":5,"evidence":"有"},"obs":{"score":4,"evidence":"接过 Langfuse"},"prod":{"score":4,"evidence":"上线过"},"cost":{"score":4,"evidence":"算过"},"security":{"score":3,"evidence":"测过注入"},"sql":{"score":4,"evidence":"会"},"customer":{"score":3,"evidence":""},"coding_agent":{"score":4,"evidence":"天天用"}}
```

```python
# agent-zero-lab/part09/grad/caps.py
from dataclasses import dataclass


@dataclass(frozen=True)
class Cap:
    id: str
    name: str
    days: tuple[int, ...]  # 没达标时回去补哪几天
    keywords: str          # 在 JD 里认这项能力用的正则(中英都写)


CAPS = [
    Cap("python", "Python 工程(类型、异步、测试)", (66, 71, 149), r"Python|pytest|asyncio"),
    Cap("llm_api", "大模型 API 与账本", (121, 124, 127, 136), r"大模型调用|OpenAI|API 调用|token"),
    Cap("prompt", "提示词与结构化输出", (141, 150), r"提示词|prompt(?! injection)|结构化输出|JSON Schema|pydantic"),
    Cap("loop", "工具调用与 Agent 循环(能手写)", (156, 166, 170, 507), r"function calling|工具调用|tool use|Agent 循环|ReAct"),
    Cap("rag", "RAG(切块、混合检索、重排、评估)", (224, 235, 238, 256), r"RAG|检索|向量|embedding|rerank|知识库"),
    Cap("context", "上下文工程与记忆", (262, 263, 464, 465), r"上下文|记忆|context|memory"),
    Cap("mcp", "MCP 与 Skills", (271, 280, 296), r"MCP|Skills?\b|Model Context Protocol"),
    Cap("framework", "编排框架与多 Agent", (299, 311, 329, 333), r"LangGraph|LangChain|多 ?Agent|编排|工作流|workflow"),
    Cap("eval", "评测(测试集、评审、轨迹、CI 门禁)", (343, 348, 355, 375, 476), r"评测|\beval|测试集|LLM-as-judge|LLM 评审|回归"),
    Cap("obs", "可观测与 tracing", (364, 365, 484), r"可观测|tracing|trace|Langfuse|OpenTelemetry|监控"),
    Cap("prod", "服务化、队列与部署", (378, 388, 422, 425), r"部署|Docker|FastAPI|服务化|队列|Redis|CI/CD|上线"),
    Cap("cost", "成本、延迟与 ROI", (396, 397, 399, 401), r"成本|延迟|latency|缓存|ROI|降本"),
    Cap("security", "安全与权限", (403, 407, 411, 415, 487), r"安全|prompt injection|注入|权限|沙箱|guardrail"),
    Cap("sql", "数据库与 SQL", (85, 87, 228, 292), r"SQL|Postgres|MySQL|数据库|pgvector"),
    Cap("customer", "需求拆解与客户沟通", (436, 437, 508), r"需求|客户|沟通|PRD|FDE|交付"),
    Cap("coding_agent", "用 Coding Agent 干活并审查", (103, 210, 211, 494), r"Claude Code|Cursor|Copilot|Coding Agent|AI 编程"),
]
```

<div class="line-notes">

- `@dataclass(frozen=True)` 十六项能力每一项是一个不可变的小对象。`frozen=True` 之后字段不能再被改,放进集合或当字典的键也安全。相当于 TS 里把对象标成 `readonly`。
- `days: tuple[int, ...]` 没达标时回去看哪几天。`tuple[int, ...]` 是「任意长度的整数元组」,`(66, 71, 149)` 这种写法。
- `keywords: str` 一条正则,等一下对照 JD 时用它认出「这句话说的是哪项能力」。中英文都写进去,`|` 是「或」。
- `Cap("prompt", "提示词与结构化输出", (141, 150), r"提示词|prompt(?! injection)|` `(?! injection)` 是「后面不能紧跟 injection」,这样 JD 里的 Prompt Injection 不会被当成「提示词」能力,它属于「安全」。这个坑是我写第一遍时撞到的。
- `Cap("loop", "工具调用与 Agent 循环(能手写)", (156, 166, 170, 507),` 第一个参数 `loop` 是内部编号,证据文件里用它当键;第二个是显示的名字;第三个是回看的天数。
- `Cap("customer", "需求拆解与客户沟通", (436, 437, 508), r"需求|客户|沟通|PRD|FDE|交付")` 这一行我改过一次,下面对照 JD 时会讲为什么把「落地」「业务」拿掉了。

</div>

下面是第一版自检脚本。它读 `evidence.json`,哪一项有非空的证据字符串就打勾。

```python
# agent-zero-lab/part09/grad/selfcheck.py  (第一版)
import json
import sys
from pathlib import Path

from part09.grad.caps import CAPS

if __name__ == "__main__":
    mine = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    done = 0
    for cap in CAPS:
        e = mine.get(cap.id, {})
        ok = bool(e.get("evidence", "").strip())
        done += ok
        print(f"[{'x' if ok else ' '}] {cap.name}")
    print(f"{done}/{len(CAPS)}")
```

<div class="line-notes">

- `mine = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))` 证据文件从命令行传进来,读成字典。`sys.argv[1]` 相当于 Node 里的 `process.argv[2]`(Python 的第 0 个是脚本名本身)。
- `e = mine.get(cap.id, {})` 这一项没写就当空字典,不报错。
- `ok = bool(e.get("evidence", "").strip())` 证据字符串去掉首尾空白以后,非空就是 True。第一版的全部判断就这一行。
- `done += ok` 布尔值能直接加到整数上,True 当 1。
- `print(f"[{'x' if ok else ' '}] {cap.name}")` 打勾打成 `[x]`,没勾打成 `[ ]`,和 Markdown 的任务清单一个写法。

</div>

```bash
cd agent-zero-lab
uv run python -m part09.grad.selfcheck_v1 ../me/evidence_bad.json
```

```text
[x] Python 工程(类型、异步、测试)
[x] 大模型 API 与账本
[x] 提示词与结构化输出
[x] 工具调用与 Agent 循环(能手写)
[x] RAG(切块、混合检索、重排、评估)
[x] 上下文工程与记忆
[x] MCP 与 Skills
[x] 编排框架与多 Agent
[x] 评测(测试集、评审、轨迹、CI 门禁)
[x] 可观测与 tracing
[x] 服务化、队列与部署
[x] 成本、延迟与 ROI
[x] 安全与权限
[x] 数据库与 SQL
[ ] 需求拆解与客户沟通
[x] 用 Coding Agent 干活并审查
15/16
```

十六项里勾了十五项,只有「需求拆解」因为证据栏是空的没勾上。这就是问题:「做过」两个字不需要任何东西撑着,这张表在这里没有任何筛选作用。你拿着这个 15/16 去面试,第一个追问就会露馅。

### 第二版:证据要能核对

要让证据有分量,得让脚本能去核对它。能自动核对的东西有限:磁盘上有没有这个文件,字符串里有没有一个链接。链接能不能打开我们不查(要查的话可以像 [Day 512](/blog/agent-zero/day-512-remote-fde/) 那样用 `httpx` 发一次请求,练习里不展开),只看格式。再退一档,字符串里至少有个数字,说明你记得住一个量化的东西,这个只给半个勾。

四档证据合起来是这个判断:

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="自检判定规则:证据是文件或链接且自评不低于 4 分打勾;有证据但分数不够或只有数字给问号;没有证据一律打叉">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">证据档位 × 自评分 → 记号</text>
  <text x="170" y="56" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">自评 4 分以上</text>
  <text x="330" y="56" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">自评 3 分以下</text>
  <text x="20" y="88" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">文件(磁盘上真有)</text>
  <rect x="160" y="68" width="150" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="170" y="88" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">[x] 勾</text>
  <rect x="320" y="68" width="150" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="330" y="88" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">[?] 问号</text>
  <text x="20" y="126" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">链接(只看格式)</text>
  <rect x="160" y="106" width="150" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="170" y="126" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">[x] 勾</text>
  <rect x="320" y="106" width="150" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="330" y="126" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">[?] 问号</text>
  <text x="20" y="164" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">只有数字</text>
  <rect x="160" y="144" width="150" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="170" y="164" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">[?] 问号</text>
  <rect x="320" y="144" width="150" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="330" y="164" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">[?] 问号</text>
  <text x="20" y="202" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">没有证据</text>
  <rect x="160" y="182" width="310" height="30" fill="var(--paper)" stroke="var(--rule)"/>
  <text x="170" y="202" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">[ ] 叉,自评多高都一样</text>
</svg>
<figcaption>判定表。右下角那一格是整个规矩的重点:证据栏空着,自评 5 分也是叉。</figcaption>
</figure>

```python
# agent-zero-lab/part09/grad/selfcheck.py
import json
import re
import sys
from pathlib import Path

from part09.grad.caps import CAPS, Cap

PATH_RE = re.compile(r"[\w./-]+\.(?:py|md|json|jsonl|csv|sql|txt)")
URL_RE = re.compile(r"https?://[^\s,;]+")


def proof_level(evidence: str, root: Path) -> str:
    """证据分四档:文件(磁盘上真有)、链接(格式对,没验证能不能打开)、数字(只有数)、无。"""
    if any((root / p).is_file() for p in PATH_RE.findall(evidence)):
        return "文件"
    if URL_RE.search(evidence):
        return "链接"
    if re.search(r"\d", evidence):
        return "数字"
    return "无"


def judge(entry: dict, root: Path) -> tuple[str, str]:
    """返回 (记号, 证据档位)。勾要同时满足:自评 4 分以上,并且证据是文件或链接。"""
    level = proof_level(entry.get("evidence", ""), root)
    score = entry.get("score", 0)
    if level in ("文件", "链接") and score >= 4:
        return "x", level
    if level != "无":
        return "?", level
    return " ", level


def check(mine: dict, root: Path) -> list[tuple[Cap, str, str, int]]:
    rows = []
    for cap in CAPS:
        entry = mine.get(cap.id, {})
        mark, level = judge(entry, root)
        rows.append((cap, mark, level, entry.get("score", 0)))
    return rows


def gaps(rows: list[tuple[Cap, str, str, int]]) -> list[tuple[Cap, str, int]]:
    """没打勾的,叉排在问号前面,同一档里自评低的在前。"""
    order = {" ": 0, "?": 1}
    bad = [(cap, mark, score) for cap, mark, _, score in rows if mark != "x"]
    return sorted(bad, key=lambda g: (order[g[1]], g[2]))


def main() -> None:
    mine = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    root = Path(sys.argv[2])
    rows = check(mine, root)
    for cap, mark, level, score in rows:
        print(f"[{mark}] {cap.name:<22} 自评 {score}  证据:{level}")
    done = sum(1 for _, m, _, _ in rows if m == "x")
    print(f"打勾 {done}/{len(rows)}")
    print("补课顺序(前三):")
    for cap, mark, score in gaps(rows)[:3]:
        days = "、".join(f"Day {d}" for d in cap.days)
        print(f"  [{mark}] {cap.name}  回看 {days}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `PATH_RE = re.compile(r"[\w./-]+\.(?:py|md|json|jsonl|csv|sql|txt)")` 在证据字符串里找「像文件名」的片段:若干个字母数字、点、斜杠、横杠,最后跟一个已知的扩展名。小林的 `part09/live/mini_agent.py,Day 510 默写 8/8` 会抽出 `part09/live/mini_agent.py`。
- `URL_RE = re.compile(r"https?://[^\s,;]+")` 以 http 或 https 开头,一直取到空白、逗号或分号为止,不取证据字符串里后面的说明文字。
- `def proof_level(evidence: str, root: Path) -> str:` 返回「文件、链接、数字、无」四个字符串之一。`root` 是仓库根目录,文件按它拼路径去找。
- `if any((root / p).is_file() for p in PATH_RE.findall(evidence)):` `root / p` 是 `pathlib` 的路径拼接,`is_file()` 问磁盘上有没有这个文件。`any(...)` 只要有一个抽出来的路径是真的就够。小林的 `common/llm.py` 在 `../me/common/llm.py` 里真有,返回「文件」。
- `return "链接"` 抽不到真文件、但有链接时返回。`https://demo.example.com/trace/abc123` 会走到这里。这个域名是我编的,所以文章里的证据只是演示格式,没有真的检查它能不能打开。
- `if re.search(r"\d", evidence):` 前两档都没中,看有没有任何数字。「LangGraph 退款审批,图里 11 个节点」有 11,返回「数字」。「读过 Manus 那篇」一个数字都没有,落到最后返回「无」。
- `def judge(entry: dict, root: Path) -> tuple[str, str]:` 把档位和自评分合成一个记号。返回两个值:记号 `x`、`?` 或空格,以及证据档位,打印时两个都要。
- `if level in ("文件", "链接") and score >= 4:` 唯一打勾的条件。`score >= 4` 里的等号很关键:自评恰好 4 分的要算。
- `if level != "无":` 没打勾、但至少有点东西:文件配低分,或者只有数字,都给问号。
- `def check(mine: dict, root: Path)` 对十六项逐项判断,返回 `(能力, 记号, 档位, 自评分)` 的列表。
- `entry = mine.get(cap.id, {})` 小林没填的项当作空字典,最后落到「无」。
- `order = {" ": 0, "?": 1}` 排补课顺序用:叉排在问号前面。
- `return sorted(bad, key=lambda g: (order[g[1]], g[2]))` 先按记号排,叉在前;同一档里按自评分从低到高。排序键是一个元组,Python 会逐个元素比。同分的项保持原来的先后(排序是稳定的)。
- `root = Path(sys.argv[2])` 第二个命令行参数是你的仓库根目录。我演示时传 `../me`。
- `print(f"[{mark}] {cap.name:<22} 自评 {score}  证据:{level}")` `{cap.name:<22}` 想让名字左对齐占 22 格,但中文字符在终端里占两格宽,所以列对不齐。不影响结果,真想对齐可以改用 `wcwidth` 这类库,这里不值得为它加依赖。
- `for cap, mark, score in gaps(rows)[:3]:` 只取前三项,补课一次别贪多。

</div>

再看小林真实的证据文件,这次每项都写了东西:

```json
{
 "python": {"score": 4, "evidence": "part01/weather_cli.py,pytest 12 passed"},
 "llm_api": {"score": 5, "evidence": "common/llm.py 的 LLMClient,账本里单次调用 ¥0.0012"},
 "prompt": {"score": 4, "evidence": "part02/extract.py,40 条工单抽取通过 38 条"},
 "loop": {"score": 5, "evidence": "part09/live/mini_agent.py,Day 510 默写 8/8"},
 "rag": {"score": 4, "evidence": "supportpilot/kb/search.py,检索命中率 0.82"},
 "context": {"score": 3, "evidence": "读过 Manus 那篇"},
 "mcp": {"score": 4, "evidence": "cloudledger/server.py,四个工具"},
 "framework": {"score": 4, "evidence": "LangGraph 退款审批,图里 11 个节点"},
 "eval": {"score": 5, "evidence": "supportpilot/eval/report.md,100 条测试集,评审与人工一致率 87%"},
 "obs": {"score": 4, "evidence": "https://demo.example.com/trace/abc123"},
 "prod": {"score": 4, "evidence": "https://demo.example.com 已上线"},
 "cost": {"score": 4, "evidence": "supportpilot/docs/cost.md"},
 "security": {"score": 3, "evidence": "supportpilot/security/injection_cases.json,20 条"},
 "sql": {"score": 4, "evidence": "part_sql/mini_ledger.sql"},
 "customer": {"score": 3, "evidence": ""},
 "coding_agent": {"score": 4, "evidence": "AGENTS.md"}
}
```

先拿第一版那份「做过」的证据文件跑,看新规则怎么判:

```bash
uv run python -m part09.grad.selfcheck ../me/evidence_bad.json ../me
```

```text
[ ] Python 工程(类型、异步、测试)    自评 4  证据:无
[ ] 大模型 API 与账本            自评 5  证据:无
[ ] 提示词与结构化输出              自评 4  证据:无
[ ] 工具调用与 Agent 循环(能手写)    自评 5  证据:无
[ ] RAG(切块、混合检索、重排、评估)     自评 4  证据:无
[ ] 上下文工程与记忆               自评 3  证据:无
[ ] MCP 与 Skills           自评 4  证据:无
[ ] 编排框架与多 Agent           自评 4  证据:无
[ ] 评测(测试集、评审、轨迹、CI 门禁)    自评 5  证据:无
[ ] 可观测与 tracing           自评 4  证据:无
[ ] 服务化、队列与部署              自评 4  证据:无
[ ] 成本、延迟与 ROI             自评 4  证据:无
[ ] 安全与权限                  自评 3  证据:无
[ ] 数据库与 SQL               自评 4  证据:无
[ ] 需求拆解与客户沟通              自评 3  证据:无
[ ] 用 Coding Agent 干活并审查   自评 4  证据:无
打勾 0/16
补课顺序(前三):
  [ ] 上下文工程与记忆  回看 Day 262、Day 263、Day 464、Day 465
  [ ] 安全与权限  回看 Day 403、Day 407、Day 411、Day 415、Day 487
  [ ] 需求拆解与客户沟通  回看 Day 436、Day 437、Day 508
```

十六项全叉,打勾 0/16。刚才 15/16 的同一份文件,现在是零。补课顺序里前三项都是自评 3 分的,因为叉里面自评分最低的排最前。再用写了证据的那份:

```bash
uv run python -m part09.grad.selfcheck ../me/evidence.json ../me
```

```text
[x] Python 工程(类型、异步、测试)    自评 4  证据:文件
[x] 大模型 API 与账本            自评 5  证据:文件
[x] 提示词与结构化输出              自评 4  证据:文件
[x] 工具调用与 Agent 循环(能手写)    自评 5  证据:文件
[x] RAG(切块、混合检索、重排、评估)     自评 4  证据:文件
[ ] 上下文工程与记忆               自评 3  证据:无
[x] MCP 与 Skills           自评 4  证据:文件
[?] 编排框架与多 Agent           自评 4  证据:数字
[x] 评测(测试集、评审、轨迹、CI 门禁)    自评 5  证据:文件
[x] 可观测与 tracing           自评 4  证据:链接
[x] 服务化、队列与部署              自评 4  证据:链接
[x] 成本、延迟与 ROI             自评 4  证据:文件
[?] 安全与权限                  自评 3  证据:文件
[x] 数据库与 SQL               自评 4  证据:文件
[ ] 需求拆解与客户沟通              自评 3  证据:无
[x] 用 Coding Agent 干活并审查   自评 4  证据:文件
打勾 12/16
补课顺序(前三):
  [ ] 上下文工程与记忆  回看 Day 262、Day 263、Day 464、Day 465
  [ ] 需求拆解与客户沟通  回看 Day 436、Day 437、Day 508
  [?] 安全与权限  回看 Day 403、Day 407、Day 411、Day 415、Day 487
```

打勾 12/16。四个没勾的各有各的原因。「上下文工程与记忆」和「需求拆解与客户沟通」两项证据栏里一个能核对的东西都没有:一个写着「读过 Manus 那篇」,一个干脆空着。「编排框架」有 `11 个节点`,是数字,只给问号。「安全与权限」文件是真的,但自评才 3 分,也是问号。补课顺序把两个叉排在前面,问号排在后面。

这个脚本不聪明,它只看格式。小林要是在证据里写一个根本不存在的 `foo/bar.py`,脚本给他「无」(因为文件找不到);要是他往 `part09/live/mini_agent.py` 里放一个空文件,脚本还是给「文件」。练习 1 就是堵这个洞。**真正的核对还是在面试官那里**,脚本只是帮你在投简历之前自己先过一遍筛。

## 对照一条 JD 打勾

能力自检是「我有什么」,JD 是「对方要什么」,两边对上才知道一份具体的岗位你能答多少。[Day 503](/blog/agent-zero/day-503-week72-review/) 练习 3 做过一版按技能覆盖率给 JD 排序,今天换一个角度:不排序,逐条要求对照,告诉你每一条是哪一类。

下面是一条虚构的 JD,公司和岗位都是我编的,只用来演示:

```text
星河智能 · AI Agent 工程师(客服方向)——虚构公司,虚构岗位,只用来演示

岗位要求:
1. 熟悉 Python,有 pytest 单元测试习惯
2. 做过 RAG 系统落地,会评估检索效果
3. 熟悉 langgraph 或类似编排框架,做过多步工具调用的流程
4. 做过评测体系:测试集、LLM 评审、回归门禁
5. 了解 Prompt Injection 与权限控制
6. 有 K8s、Terraform 的生产运维经验
7. 能和客户沟通需求并推动落地
8. 有 MCP server 开发经验者优先
```

规则很简单。每个编号行是一条要求;每条要求去能力表里找关键词匹配的项;匹配到的项都有勾,这条要求就算「有证据」,有一项没勾就降级;一项都没匹配到,说明课程没覆盖。先写第一版,只做匹配这一步:

```python
# agent-zero-lab/part09/grad/jd_match.py  (第一版)
import re
import sys
from pathlib import Path

from part09.grad.caps import CAPS

if __name__ == "__main__":
    lines = [l for l in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines() if re.match(r"\d+\.", l)]
    for line in lines:
        hit = [c.name for c in CAPS if re.search(c.keywords, line)]
        print(line[:30], "->", hit)
```

<div class="line-notes">

- `lines = [l for l in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines() if re.match(r"\d+\.", l)]` 读整个文件,按行切开,只留以「数字加点」开头的行。`re.match` 只从字符串开头匹配,正好用来认编号行,标题行和空行都被丢掉。
- `hit = [c.name for c in CAPS if re.search(c.keywords, line)]` 对每条要求,把十六项能力的关键词正则都试一遍,列出命中的名字。`re.search` 在整行里任意位置找。
- `print(line[:30], "->", hit)` 行太长,只打前 30 个字符。

</div>

下面是它在虚构 JD 上跑出来的结果(我保存了这次的输出,因为后面我改了能力表里的一行关键词,现在再跑结果会不一样):

```text
1. 熟悉 Python,有 pytest 单元测试习惯 -> ['Python 工程(类型、异步、测试)']
2. 做过 RAG 系统落地,会评估检索效果 -> ['RAG(切块、混合检索、重排、评估)', '需求拆解与客户沟通']
3. 熟悉 langgraph 或类似编排框架,做过多步工具 -> ['工具调用与 Agent 循环(能手写)', '编排框架与多 Agent']
4. 做过评测体系:测试集、LLM 评审、回归门禁 -> ['评测(测试集、评审、轨迹、CI 门禁)']
5. 了解 Prompt Injection 与权限控制 -> ['安全与权限']
6. 有 K8s、Terraform 的生产运维经验 -> []
7. 能和客户沟通需求并推动落地 -> ['需求拆解与客户沟通']
8. 有 MCP server 开发经验者优先 -> ['MCP 与 Skills']
```

问题在第 2 行:「做过 RAG 系统落地,会评估检索效果」除了命中 RAG,还命中了「需求拆解与客户沟通」。原因是关键词表里有「落地」两个字,而这里的「落地」是「系统落地」,跟和客户沟通没关系。我把「落地」和「业务」两个词从那一项里删掉了,换成「沟通」,现在这一行只命中 RAG。这类误判和 [Day 498](/blog/agent-zero/day-498-resume-1/) 讲过的正则误伤是同一回事:词太泛,哪都能碰上。

第 3 行还藏着另一个坑。我写的是 `langgraph`(小写),而关键词里写的是 `LangGraph`。这一行靠「编排」两个字命中了框架那一项,没出事,但如果 JD 里只写「熟悉 langgraph」,不区分大小写的匹配和区分大小写的匹配结果是不一样的:

```bash
uv run python -c "import re; from part09.grad.caps import CAPS; c = [c for c in CAPS if c.id == 'framework'][0]; print(bool(re.search(c.keywords, '熟悉 langgraph')), bool(re.search(c.keywords, '熟悉 langgraph', re.I)))"
```

```text
False True
```

左边是不加 `re.I`,没命中;右边加了,命中。所以最终版要加 `re.I`。下面是完整的 `jd_match.py`,它还会去读自检结果,给每条要求一个状态。

```python
# agent-zero-lab/part09/grad/jd_match.py
import json
import re
import sys
from pathlib import Path

from part09.grad.caps import CAPS
from part09.grad.selfcheck import check

RANK = {"x": 0, "?": 1, " ": 2}


def requirements(text: str) -> list[str]:
    """只取「1. xxx」这种编号行,标题和空行不要。"""
    return [ln for ln in text.splitlines() if re.match(r"\d+\.\s", ln)]


def match(line: str) -> list[str]:
    return [c.id for c in CAPS if re.search(c.keywords, line, re.I)]


def main() -> None:
    jd = Path(sys.argv[1]).read_text(encoding="utf-8")
    mine = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    marks = {cap.id: mark for cap, mark, _, _ in check(mine, Path(sys.argv[3]))}
    names = {c.id: c.name.split("(")[0] for c in CAPS}
    covered = 0
    todo: list[str] = []
    for line in requirements(jd):
        ids = match(line)
        if not ids:
            print(f"课程没覆盖  {line}")
            continue
        worst = max((marks[i] for i in ids), key=lambda m: RANK[m])
        label = {"x": "有证据", "?": "证据不足", " ": "没证据"}[worst]
        if worst == "x":
            covered += 1
        todo += [names[i] for i in ids if marks[i] != "x" and names[i] not in todo]
        print(f"{label:<6}  {line}  <- {'、'.join(names[i] for i in ids)}")
    total = len(requirements(jd))
    print(f"\n{covered}/{total} 条有证据。要补:{'、'.join(todo) or '无'}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `RANK = {"x": 0, "?": 1, " ": 2}` 三种记号的「糟糕程度」,数字越大越糟。后面要从一条要求匹配到的多项能力里挑最糟的那个。
- `def requirements(text: str) -> list[str]:` 把「认编号行」单独拆成函数,第二个脚本(练习 2)也要用。
- `return [ln for ln in text.splitlines() if re.match(r"\d+\.\s", ln)]` 比第一版多了一个 `\s`:编号后面必须跟空白,「1.5 万」这种开头的行不会被误认成编号行。
- `def match(line: str) -> list[str]:` 对一行要求,返回命中的能力 id 列表(不再是名字)。
- `return [c.id for c in CAPS if re.search(c.keywords, line, re.I)]` 加上了 `re.I` 忽略大小写。
- `marks = {cap.id: mark for cap, mark, _, _ in check(mine, Path(sys.argv[3]))}` 把 `selfcheck.check` 的结果转成「能力 id → 记号」的字典。`_` 是不用的变量,`check` 返回四个值,这里只要前两个。
- `names = {c.id: c.name.split("(")[0] for c in CAPS}` 显示用的短名:名字里括号前面那一段,「评测(测试集、评审、轨迹、CI 门禁)」变成「评测」。
- `if not ids:` 一项都没匹配到。小林的第 6 行「有 K8s、Terraform 的生产运维经验」走到这里,打印「课程没覆盖」,然后 `continue` 跳过后面的统计。
- `worst = max((marks[i] for i in ids), key=lambda m: RANK[m])` 匹配到几项就看几项,取最糟的记号。第 3 行匹配到「工具调用」(勾)和「编排框架」(问号),最糟的是问号。
- `label = {"x": "有证据"` 把记号翻译成人话。
- `todo += [names[i] for i in ids if marks[i] != "x" and names[i] not in todo]` 没打勾的项加进「要补」清单,已经在清单里的不重复加。
- `print(f"\n{covered}/{total} 条有证据。要补:{'、'.join(todo) or '无'}")` `'、'.join(todo) or '无'` 里的 `or` 是说:字符串为空时用「无」。

</div>

```bash
uv run python -m part09.grad.jd_match part09/grad/jd_demo.txt ../me/evidence.json ../me
```

```text
有证据     1. 熟悉 Python,有 pytest 单元测试习惯  <- Python 工程
有证据     2. 做过 RAG 系统落地,会评估检索效果  <- RAG
证据不足    3. 熟悉 langgraph 或类似编排框架,做过多步工具调用的流程  <- 工具调用与 Agent 循环、编排框架与多 Agent
有证据     4. 做过评测体系:测试集、LLM 评审、回归门禁  <- 评测
证据不足    5. 了解 Prompt Injection 与权限控制  <- 安全与权限
课程没覆盖  6. 有 K8s、Terraform 的生产运维经验
没证据     7. 能和客户沟通需求并推动落地  <- 需求拆解与客户沟通
有证据     8. 有 MCP server 开发经验者优先  <- MCP 与 Skills

4/8 条有证据。要补:编排框架与多 Agent、安全与权限、需求拆解与客户沟通
```

八条要求里 4 条有证据。第 3 行证据不足,是因为「编排框架」那一项只有数字;第 5 行证据不足是安全那一项自评才 3 分;第 7 行没证据,对应小林空着的「需求拆解」。第 6 行是 K8s 和 Terraform:**这门课没有讲 Kubernetes,也没有讲 Terraform**。最接近的是 [Day 422](/blog/agent-zero/day-422-dockerfile-prod/) 到 [Day 425](/blog/agent-zero/day-425-deploy-route/) 的 Docker 和部署,但那不是 K8s。这种情况我的建议是不要硬往简历里凑。如果你想投的岗位里十条有七八条要 K8s,那是一个信号,说明你的目标其实是平台运维方向,该另外补一块;如果只是偶尔一条,面试时诚实说「没在生产里用过,但 Docker 和部署的流程我熟,可以学」,比往简历上写一个你没碰过的词强得多。

另外这个脚本有个盲区要记着:它只数关键词,不理解句子。「有 MCP server 开发经验者优先」里的「优先」是加分项,「熟悉 Python」是硬要求,脚本一视同仁。拿到结果以后你自己要再扫一遍,把硬要求和加分项分开。

## 没达标怎么办

先说一个判断:**不要等所有格子都打勾再开始投。** [Day 513](/blog/agent-zero/day-513-offer/) 的漏斗说明了,招聘过程本身就是最好的反馈:投出去四十家只回五家,你才知道问题在简历还是在渠道;光在家里补课,永远得不到这个信号。所以补课和投递并行,每周看一次漏斗,再看一次自检表。

补课顺序按「脚本排出来的前三项」走,但有几种情况值得单独说一下。

评测那一行没勾,优先级最高。回到 [Day 476](/blog/agent-zero/day-476-eval-scenarios/) 到 [Day 481](/blog/agent-zero/day-481-iterate-2/),把 SupportPilot 的评测集扩到 100 条左右,把评审和人工标注的一致率算出来,让 [Day 375](/blog/agent-zero/day-375-eval-project-2/) 的 CI 门禁真的在合并请求上跑一次。简历上其他东西的说服力,很大程度上取决于这一行能不能经得起追问。

上下文和记忆那一行只会背概念的,回 [Day 465](/blog/agent-zero/day-465-memory-compact/),给 SupportPilot 加一个真实的压缩机制:对话超过一定长度自动摘要,再用同一批多轮对话比压缩前后的成功率。有一个对比数,这一行就有了证据。

安全那一行不踏实的,把 [Day 487](/blog/agent-zero/day-487-threat-model/) 的注入测试集再扩一倍,再找一个朋友完全不看你的代码、只看你的演示地址,请他试着攻破它。你自己写的测试,你自己总是知道哪里不能碰。

需求拆解和客户沟通这类「软」的能力,脚本很难核对,能放进证据栏的就是文档:一页 PRD([Day 437](/blog/agent-zero/day-437-prd/))、一次访谈提纲([Day 436](/blog/agent-zero/day-436-fde-requirements/))。没有的话,就找一个真实的朋友或同事,问他工作里有什么重复的、能让 Agent 做的事,按 [Day 436](/blog/agent-zero/day-436-fde-requirements/) 的方法访谈一次,写成一页纸。这一项补起来的成本很低,面试里被问到的概率却不低,尤其是 FDE 方向([Day 512](/blog/agent-zero/day-512-remote-fde/))。

每一项补完,回到 `evidence.json` 改证据,重跑脚本,看 `[ ]` 变成 `[x]`。这个过程本身就有成就感,也避免了「感觉学过了」这种虚的状态。

## 接下来怎么走:进阶篇的地图

普通篇到此为止,下面是进阶篇(Day 518 到 648,一百三十一天)。它不再教你怎么做出东西,而是教你怎么做判断:选哪个、为什么、什么时候该换、证据是什么。按顺序是这样的:

- [Day 520](/blog/agent-zero/day-520-harness-parts/) 到 [Day 525](/blog/agent-zero/day-525-harness-build/):harness,也就是 Agent 循环外面那一层运行时。读 Claude Agent SDK、OpenAI Agents SDK、LangGraph 三家的源码,最后给自己写一个。
- [Day 526](/blog/agent-zero/day-526-context-rot/) 到 [Day 534](/blog/agent-zero/day-534-memory-build/):上下文进阶和记忆系统。上下文腐烂、KV 缓存、三层压缩,以及给 SupportPilot 写客户记忆并评测。
- [Day 535](/blog/agent-zero/day-535-durable-1/) 到 [Day 541](/blog/agent-zero/day-541-orch-2/):持久化执行和编排取舍。自己写一个能断点续跑的运行器,再比较几种架构。
- [Day 542](/blog/agent-zero/day-542-design-doc-1/) 到 [Day 562](/blog/agent-zero/day-562-eval-platform/):设计文档,然后是评测的统计学和大规模评审、线上评测、红队、benchmark。这一块是整个进阶篇最重的。
- [Day 563](/blog/agent-zero/day-563-model-selection-1/) 到 [Day 582](/blog/agent-zero/day-582-router-pipeline/):选模型、自部署、微调、DPO、蒸馏、强化学习,最后训练一个路由小模型。
- [Day 583](/blog/agent-zero/day-583-platform-1/) 到 [Day 603](/blog/agent-zero/day-603-platform-review/):平台化,多租户、模型网关、MCP 网关、Agent 身份、规模化可观测、合规、事故复盘。
- [Day 604](/blog/agent-zero/day-604-coding-agents-1/) 到 [Day 623](/blog/agent-zero/day-623-tech-selection/):前沿形态,Coding Agent 内部、Computer Use、语音、Deep Research、Agent 互联和支付、产品交互、生成式 UI。
- [Day 624](/blog/agent-zero/day-624-agentops-kickoff-1/) 到 [Day 639](/blog/agent-zero/day-639-agentops-showcase/):把上面的零件拼成 AgentOps 平台。
- [Day 640](/blog/agent-zero/day-640-design-docs-1/) 到 [Day 648](/blog/agent-zero/day-648-senior-graduation/):设计文档、立项、Staff 级系统设计面试、带人和开源影响力,最后一天是进阶结业。

如果你是从前面一路学过来的,我不建议五个方向都碰一点。拿两个维度选:一个是**岗位需求**(你想投的那批 JD 里哪块被提得多),一个是**和你现有能力的距离**(越近越容易做出成果)。后端或平台出身的人,平台那一块([Day 583](/blog/agent-zero/day-583-platform-1/) 起)和 harness([Day 520](/blog/agent-zero/day-520-harness-parts/) 起)衔接得最好;想往算法靠一点的人,可以先试 [Day 572](/blog/agent-zero/day-572-finetune-2/) 的 LoRA 微调;想做 FDE 的人,先把 [Day 436](/blog/agent-zero/day-436-fde-requirements/) 的访谈和 [Day 642](/blog/agent-zero/day-642-staff-sd-1/) 的系统设计面试练扎实;对 Computer Use([Day 606](/blog/agent-zero/day-606-computer-use-1/))和语音 Agent([Day 610](/blog/agent-zero/day-610-voice-1/))有兴趣的人可以排在后面,这两块的岗位目前还少一些。

还有一件事不依赖方向:**把你做过的东西写出来**。[Day 492](/blog/agent-zero/day-492-video-blog/) 讲过技术博客,每个月做一个小实验、在自己的评测集上跑一遍、写一篇带数字的短文,半年以后你有六篇文章,这比证书有用。进阶篇里我也会一直这么要求。

## 怎么跟上这个领域

Agent 这个领域半年一个样,今天学的框架 API 明年可能就变了。变得慢的是底层:评测、上下文管理、权限设计、成本意识。所以跟新东西我的习惯是只跟少数几个质量高的信息源,不刷所有新闻:

- Simon Willison 的博客,几乎天天更新,对新模型和新工具的上手实测、安全问题最敏锐。
- Anthropic Engineering 博客,还有 OpenAI、LangChain 的工程博客,是一手的工程实践。
- Hamel Husain 和 Chip Huyen 的博客,讲评测和 AI 工程的方法。
- Latent Space 播客和 smol.ai 的每日新闻汇总,扫一遍标题就行。
- 中文这边,Datawhale 的开源教程,以及 B 站上几个认真做原理讲解的 UP 主。

链接都放在下面「学习资料」里了。

## 动手练习

练习的主体是前面两个脚本加你自己的证据文件。三道题先做 1、2 两道(用我给的数据),再做第 3 道(排你自己的补课计划)。

### 练习 1:空文件不算证据

`proof_level` 只看文件存在,不看里面有没有东西。写一个新版本,文件大小为 0 字节的不算「文件」。我在 `me/` 里放了一个空的 `empty_notes.md`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex516_empty.py
import re
from pathlib import Path

from part09.grad.selfcheck import PATH_RE, URL_RE


def proof_level(evidence: str, root: Path) -> str:
    for p in PATH_RE.findall(evidence):
        f = root / p
        if f.is_file() and f.stat().st_size > 0:  # 空文件不算
            return "文件"
    if URL_RE.search(evidence):
        return "链接"
    if re.search(r"\d", evidence):
        return "数字"
    return "无"


if __name__ == "__main__":
    root = Path("../me")
    print(proof_level("empty_notes.md", root))
    print(proof_level("AGENTS.md", root))
    print(proof_level("empty_notes.md,写了 3 篇", root))
```

<div class="line-notes">

- `from part09.grad.selfcheck import PATH_RE, URL_RE` 两个正则直接拿今天写的用,不重写。
- `def proof_level(evidence: str, root: Path) -> str:` 签名和原来的完全一样,这样可以直接替换进 `selfcheck.py`。
- `for p in PATH_RE.findall(evidence):` 这里把原来的 `any(...)` 展开成 `for` 循环,因为要多做一个判断。
- `if f.is_file() and f.stat().st_size > 0:  # 空文件不算` `f.stat().st_size` 是文件的字节数。一个只有换行符的文件是 1 字节,也会通过,所以这个检查只拦得住「真的什么都没写」的文件。
- `print(proof_level("empty_notes.md,写了 3 篇", root))` 第三个例子:文件是空的,但字符串里有「3」,于是退到第三档「数字」。

</div>

```text
无
文件
数字
```

三行分别是:空文件得「无」;有内容的 `AGENTS.md` 得「文件」;空文件加一句「写了 3 篇」只能得「数字」。把这个函数拿去替换 `selfcheck.py` 里的 `proof_level`,小林那份证据文件的结果不会变,因为他的 11 个文件里都有内容;但谁要是用 `touch` 造一堆空文件来凑勾,这一版就拦住了。

</details>

### 练习 2:三份 JD 谁最值得先投

在 `jd_match` 的基础上,拿三份 JD(一份是今天那份,另外两份我写了几行),分别算「全部匹配项都有勾」的要求占多少,按比例排序。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex516_rank.py
import json
from pathlib import Path

from part09.grad.jd_match import match, requirements
from part09.grad.selfcheck import check

JDS = {
    "A 星河智能(客服 Agent)": Path("part09/grad/jd_demo.txt").read_text(encoding="utf-8"),
    "B 云岚(平台运维)": "1. 熟悉 Kubernetes 和 Terraform\n2. 有 Go 或 Rust 开发经验\n3. 做过 Docker 镜像和 CI/CD\n4. 有监控告警经验\n",
    "C 北辰(评测与检索)": "1. 做过 RAG 检索评估\n2. 搭过评测集和回归门禁\n3. 熟悉 Python\n4. 会写 SQL 做数据分析\n",
}

if __name__ == "__main__":
    mine = json.loads(Path("../me/evidence.json").read_text(encoding="utf-8"))
    marks = {cap.id: mark for cap, mark, _, _ in check(mine, Path("../me"))}
    scores = []
    for name, text in JDS.items():
        reqs = requirements(text)
        ok = sum(1 for r in reqs if (ids := match(r)) and all(marks[i] == "x" for i in ids))
        miss = sum(1 for r in reqs if not match(r))
        scores.append((ok / len(reqs), name, ok, len(reqs), miss))
    for rate, name, ok, n, miss in sorted(scores, reverse=True):
        print(f"{rate:>4.0%}  {ok}/{n}  课程没覆盖 {miss} 条  {name}")
```

<div class="line-notes">

- `from part09.grad.jd_match import match, requirements` 直接复用今天写的两个函数,这就是当初把 `requirements` 单独拆出来的原因。
- `JDS = {` 字典:名字对应 JD 文本。第一份从文件读,后两份我直接写成带 `\n` 的字符串。`B 云岚` 偏平台运维,`C 北辰` 偏评测和检索。
- `marks = {cap.id: mark for cap, mark, _, _ in check(mine, Path("../me"))}` 和 `jd_match` 里同一句,得到「能力 id → 记号」。
- `ok = sum(1 for r in reqs if (ids := match(r)) and all(marks[i] == "x" for i in ids))` 这一行用了海象运算符 `:=`,在条件里先把 `match(r)` 的结果存进 `ids`,再检查「非空且全部是勾」。`ids` 为空列表时 `and` 左边就是假,所以「课程没覆盖」的要求不会算进 ok。
- `miss = sum(1 for r in reqs if not match(r))` 单独统计课程没覆盖的条数,打印出来,不让它们悄悄消失在分母里。
- `for rate, name, ok, n, miss in sorted(scores, reverse=True):` 元组按第一个元素(比例)从大到小排。

</div>

```text
100%  4/4  课程没覆盖 0 条  C 北辰(评测与检索)
 50%  2/4  课程没覆盖 2 条  B 云岚(平台运维)
 50%  4/8  课程没覆盖 1 条  A 星河智能(客服 Agent)
```

C 北辰四条全有证据,排第一;A 和 B 都是一半。但这一半的含义不一样:B 的两条「没覆盖」是 K8s 和 Go,小林补课补不到,A 的四条没勾是他自己能补的(编排、安全、客户沟通)。**所以光看比例排序还不够**,「没覆盖」多的那份,分母里有一部分是你短期内补不上的。我的做法是先投 C,同时把 A 的三项补掉再投,B 放最后。

</details>

### 练习 3:补课计划排到几天

`selfcheck` 给了补课顺序,但没说要多久。写一个 `schedule`:每个要回看的天数按 2.5 小时算(课程每天 1.5 到 3 小时,取中间),给定每天能用的小时数,把前三项能力的回看天数排进日历,打印要几天。分别试每天 2 小时和每天 5 小时。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex516_schedule.py
import json
import sys
from pathlib import Path

from part09.grad.selfcheck import check, gaps

HOURS_PER_REVIEW = 2.5  # 回看并重做一天的内容,按课程里 1.5 到 3 小时取中间


def schedule(todo: list[tuple[str, int]], hours_per_day: float) -> list[list[str]]:
    """todo 是 [(能力名, Day 号)],按顺序往每天的时间预算里塞。"""
    days: list[list[str]] = [[]]
    left = hours_per_day
    for name, d in todo:
        if left < HOURS_PER_REVIEW and days[-1]:
            days.append([])
            left = hours_per_day
        days[-1].append(f"Day {d}({name})")
        left -= HOURS_PER_REVIEW
    return days


if __name__ == "__main__":
    mine = json.loads(Path("../me/evidence.json").read_text(encoding="utf-8"))
    todo = [(cap.name.split("(")[0], d) for cap, _, _ in gaps(check(mine, Path("../me")))[:3] for d in cap.days]
    hours = float(sys.argv[1])
    plan = schedule(todo, hours)
    print(f"共 {len(todo)} 个回看项,每天 {hours:g} 小时,排 {len(plan)} 天")
    for i, items in enumerate(plan, 1):
        print(f"第 {i} 天:{'、'.join(items)}")
```

<div class="line-notes">

- `HOURS_PER_REVIEW = 2.5` 一天内容回看并重做的时长,是个估算,不是量出来的。你自己的数字可以改。
- `def schedule(todo: list[tuple[str, int]], hours_per_day: float) -> list[list[str]]:` 输入是 `(能力名, Day 号)` 的列表,输出是「每天要做的事」的列表的列表。
- `days: list[list[str]] = [[]]` 先放一个空的「第 1 天」。
- `if left < HOURS_PER_REVIEW and days[-1]:` 今天剩的时间不够再塞一项,并且今天已经塞过东西了,就开新的一天。`and days[-1]` 防止「每天 2 小时 &lt; 2.5」时,第一项之前就空开一天。
- `days[-1].append(f"Day {d}({name})")` 往最后一天里加一项。
- `left -= HOURS_PER_REVIEW` 扣掉这一项用的时间。每天 2 小时的情况,`left` 变成 -0.5,下一轮必然开新的一天,所以一天一项。
- `todo = [(cap.name.split("(")[0], d) for cap, _, _ in gaps(check(mine, Path("../me")))[:3] for d in cap.days]` 两层 `for` 的推导式:外层取前三个没达标的能力,内层把每个能力的回看天数展开。注意里面的 `cap` 是外层 `for` 的变量,内层 `for d in cap.days` 能直接用。
- `hours = float(sys.argv[1])` 每天几小时从命令行传。

</div>

```text
共 12 个回看项,每天 2 小时,排 12 天
第 1 天:Day 262(上下文工程与记忆)
第 2 天:Day 263(上下文工程与记忆)
第 3 天:Day 464(上下文工程与记忆)
第 4 天:Day 465(上下文工程与记忆)
第 5 天:Day 436(需求拆解与客户沟通)
第 6 天:Day 437(需求拆解与客户沟通)
第 7 天:Day 508(需求拆解与客户沟通)
第 8 天:Day 403(安全与权限)
第 9 天:Day 407(安全与权限)
第 10 天:Day 411(安全与权限)
第 11 天:Day 415(安全与权限)
第 12 天:Day 487(安全与权限)
```

```text
共 12 个回看项,每天 5 小时,排 6 天
第 1 天:Day 262(上下文工程与记忆)、Day 263(上下文工程与记忆)
第 2 天:Day 464(上下文工程与记忆)、Day 465(上下文工程与记忆)
第 3 天:Day 436(需求拆解与客户沟通)、Day 437(需求拆解与客户沟通)
第 4 天:Day 508(需求拆解与客户沟通)、Day 403(安全与权限)
第 5 天:Day 407(安全与权限)、Day 411(安全与权限)
第 6 天:Day 415(安全与权限)、Day 487(安全与权限)
```

十二个回看项,每天 2 小时要排十二天,每天 5 小时只要六天。这是个粗估,但它让「我准备补课」变成了一个有日期的计划:你可以反过来问自己,每天能挤出几小时,三项补完大概是哪一天。如果一项要拖到下个月,说明你的前三项选得太多了,先只补第一项。

</details>

学完以后,验收标准是:

- 你有一份自己的 `evidence.json`,十六项每项都有自评和一句证据,打勾的项能指到真实的文件或链接。
- 你对着一条真实的、你想投的 JD 跑过 `jd_match`,知道要补哪几项。
- 补课计划排到了日期,前三项以外的先不管。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 自检 | 对照一份能力清单逐项检查自己,每一项要有可核对的证据,不靠感觉 |
| 证据档位 | 本文脚本把证据分成文件、链接、数字、无四档,档位越靠前越容易被别人核对 |
| 补课顺序 | 没达标的项按「没证据在前、自评低在前」排出来的先后,不是重要性排序 |
| `dataclass(frozen=True)` | 让 `dataclass` 的实例不可修改,和 TS 里 `readonly` 对象相近 |
| 海象运算符 `:=` | 在表达式里先赋值再使用,练习 2 里用它避免把 `match(r)` 算两遍 |
| ADR | 架构决策记录,一页纸记下一个决定的背景、方案、理由和代价,进阶篇 [Day 519](/blog/agent-zero/day-519-senior-map/) 会写第一份 |
| 进阶篇 | Day 518 到 648,从「做出来」转到「做判断」,毕业项目是 AgentOps 平台 |

## 常见误区

**以为自评分高就等于达标。** 自评 5 分、证据栏写「做过」,这张表里是叉。分数是你的感觉,证据才是别人能核对的东西。

**等全部打勾再开始投。** 永远不会有「全部学完」的那天。边投边补,每周看一次漏斗([Day 513](/blog/agent-zero/day-513-offer/))和一次自检表。

**把「课程没覆盖」的要求往简历里硬凑。** 没在生产里用过 K8s 就别写。面试官追问两句就露,而且显得其他地方的内容也不可信。诚实说「没用过,我学过 Docker 和部署的流程」更稳。

**关键词匹配当成理解。** `jd_match` 只数词,分不出「必须」和「优先」,也分不出「RAG 系统落地」里的「落地」不是「客户落地」。结果是个初筛,不是结论。

**进阶方向贪多。** 五个方向各浅尝一下,三个月后每个都讲不深。选一到两个,做出带数字的东西。

**觉得微调或训练是「更高级」的方向。** 对 Agent 工程师,它是工具箱里的一个工具,不是升级路线。[Day 570](/blog/agent-zero/day-570-finetune-1/) 会先讲什么时候不该微调。

**学完就不再公开输出。** 带数字的博客、开源 PR、能在线试用的作品,会随时间复利。只留在本地的东西不会。

## 学习资料

### 文档与文章

- [Hamel Husain · Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/):评测这一项没勾的话先读它,讲怎么从看数据开始建评测。
- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):普通篇的总纲,结业再读一遍,会注意到它反复强调「先用最简单的方案」。
- [humanlayer/12-factor-agents](https://github.com/humanlayer/12-factor-agents):把生产级 Agent 的原则写成十二条,进阶篇会反复用到。
- 信息源:[Simon Willison](https://simonwillison.net/)、[Anthropic Engineering](https://www.anthropic.com/engineering)、[Chip Huyen](https://huyenchip.com/blog/)、[Latent Space](https://www.latent.space/)、[AI News by smol.ai](https://news.smol.ai/)。
- 中文教程:[Datawhale hello-agents](https://github.com/datawhalechina/hello-agents),想用另一个角度把普通篇再过一遍时看。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1MDsgzxEfS&autoplay=0&high_quality=1" title="（中英字幕完结）吴恩达最新课程：智能体AI（Agentic AI）| 2025年最新 | 吴恩达机器学习_StanFord" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>吴恩达 · Agentic AI 中英字幕版 · 一共 31 集。学完普通篇再回看,会发现他讲的反思、工具使用、规划、多 Agent 四种模式你都亲手写过,这次重点听他怎么讲评测和错误分析。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1hubZ6WEfU&autoplay=0&high_quality=1" title="我的AI Agent面试复盘。纯是个人的分享和总结,未必准确,期待大家交流指正哈哈哈哈！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>假如今天可以躺平 · 我的AI Agent面试复盘 · 36 分钟,一个人的面试经历复盘,作者自己说「未必准确」,拿来对照你自己的自检表,看他被追问的地方你有没有证据。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LCEmiRjPEtQ" title="Andrej Karpathy: Software Is Changing (Again)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Y Combinator · Andrej Karpathy: Software Is Changing (Again) · 讲软件进入 3.0 和「部分自主」的产品形态。学完普通篇再听,能听懂他为什么一直强调人要留在环路里。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/4pYzYmSdSH4" title="Andrew Ng: State of AI Agents | LangChain Interrupt" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Andrew Ng: State of AI Agents · 吴恩达讲 Agent 的现状,其中关于评测和「Agent 工程师需要什么」的部分和这门课的主线一致。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):整本书值得在接下来三个月里通读,评测和架构两章尤其对得上进阶篇。
- Michael Albada《Building Applications with AI Agents》(O'Reilly, 2025):讲 Agent 系统的设计和改进循环,是普通篇之后自然的延伸。

### 开源项目与代码

- 你自己的 SupportPilot 仓库:今天把 `evidence.json` 放进去,证据栏里的路径指向的就是它。
- [datawhalechina/hello-agents](https://github.com/datawhalechina/hello-agents):中文开源的 Agent 教程,代码和文字都能拿来对照。

## 自测

1. 自检脚本第一版为什么「几乎没有用」?第二版改了哪个判断?

<details><summary>答案</summary>

第一版只看证据字符串是不是空的,「做过」两个字就能打勾,16 项里勾了 15 项。第二版把证据分成文件、链接、数字、无四档,只有文件或链接并且自评 4 分以上才打勾,没有证据的项自评多高都是叉。

</details>

2. `judge` 里 `score >= 4` 如果误写成 `score > 4` 会出什么问题?

<details><summary>答案</summary>

自评恰好 4 分的项永远得不到勾,只能得问号。因为自评用 1 到 5 的整数,`> 4` 等于只有 5 分才能打勾。这是默写时很常见的边界错误。

</details>

3. JD 对照里「做过 RAG 系统落地」为什么会被误判成需要「客户沟通」?怎么修?

<details><summary>答案</summary>

因为客户沟通那一项的关键词里有「落地」,而这里的「落地」只是「系统上线」的意思。修法是把过于泛的词(落地、业务)从关键词里删掉,换成更具体的「沟通」。关键词越泛,误报越多,每改一次都要在几条 JD 上重新跑一遍看有没有新的误判。

</details>

4. 一条要求「有 K8s 和 Terraform 的生产运维经验」,脚本报「课程没覆盖」。你会怎么处理?

<details><summary>答案</summary>

先看自己想投的岗位里这类要求多不多。偶尔一条的话,面试时诚实说没在生产里用过、但 Docker 和部署的流程熟悉,不要写进简历。如果大多数目标岗位都要,说明目标其实偏平台运维,要另外安排时间补这块,而不是靠这门课。

</details>

5. (面试题)「你说你熟悉评测,具体做过什么?」请用一分钟回答,每一句尽量带一个数字或一个文件。

<details><summary>答案</summary>

示范:「我给 SupportPilot 搭了 100 条的评测集,按场景和说法两个维度生成,代码在 `supportpilot/eval/`。用 LLM 评审打分,先拿 40 条人工标注的校准,评审和人工的一致率是 87%,不一致的我逐条看过,主要是评审偏爱长回答,后来改了评分提示。每次合并请求都跑一遍,分数下降超过阈值就拦截。上线以后发现过一次新问题类型,加进了回归集。」重点不是这些具体数字,而是每一句都有东西可以让对方追问下去:文件在哪、一致率怎么算、后来怎么改的。

</details>

6. 进阶方向怎么选?按今天的两个维度给自己选一个并说理由。

<details><summary>答案</summary>

两个维度:岗位需求(你要投的那批 JD 里哪块提得多)和衔接度(和你已有能力的距离)。比如后端出身、要投平台类岗位,选平台化加 harness 两块,理由是需求高、衔接近,三个月能做出可展示的东西。没有标准答案,关键是能用两个维度说出理由,而不是「听说这个火」。

</details>

## 明天预告

明天是 Day 517,第 74 周复习:求职(Day 511–516)。不学新东西,画一张本周知识地图,计时默写年包折算、offer 拆分和今天的 `judge` 三个核心函数,用判卷脚本打分,再把整周的脚本拼成一份「求职周报」:岗位筛选、薪资、offer 对比、投递漏斗、能力自检,一个命令出一页。后天(Day 518)进入进阶篇,先讲资深岗和中级到底差在哪。
