---
title: 'Day 27 · 框架横评:LangGraph、OpenAI Agents SDK、Claude Agent SDK、LlamaIndex、Dify/Coze'
description: '同一个查重复扣款的小任务,用 LangChain create_agent、OpenAI Agents SDK、Claude Agent SDK 各写一遍,和手写版本对比。再把这两年新冒出来的概念理清:Agent Skills 是什么、它和 MCP、子 Agent 怎么分工,JD 里的 Agent Harness 指什么,以及面试里最难的那题:框架底层怎么实现、局限在哪、什么时候不用框架。'
pubDate: 2026-10-12
regime: none
tags: ['frameworks', 'agent-skills', 'agent-harness', 'openai-agents-sdk', 'claude-agent-sdk', 'agent-60']
series: 'agent-60'
day: 27
lang: 'zh'
---

## 今天要解决的问题

到今天为止,你手写过 Agent 循环,写过 MCP server,用过 LangGraph。市面上还有一大堆名字:LangChain、LlamaIndex、CrewAI、AutoGen、OpenAI Agents SDK、Claude Agent SDK、Dify、Coze,以及最近 JD 里频繁出现的 Skills 和 Harness。我们抓的国内 JD 里,46% 点名了某个 Agent 框架,而且不少写的是「理解 LangChain/LlamaIndex 原理」「能讲清框架局限和何时不用框架」。只会用不够,得能讲清楚。

今天学完,你要能做到:

1. 把这些名字放进一张分层图里,说清每一层解决什么问题。
2. 用三个框架实现同一个任务,和手写版本对比代码量和控制力。
3. 讲清 Agent Skills 的机制(SKILL.md、渐进式加载),写出一个自己的 Skill,并说清 Skills、MCP、子 Agent 三者怎么分工。
4. 解释 Agent Harness 是什么,为什么 Claude Code、Codex 这类产品被称为 harness。
5. 回答三个面试高频题:框架底层怎么实现的、局限在哪、什么时候不用框架。

预计用时 5–6 小时。前置:Day 9、Day 23、Day 24–26。

## 先分层,再比较

很多横评文章把 LangGraph 和 Dify 放在一张表里比,这其实是在比苹果和果汁。它们不在同一层。我把常见的东西分成五层,从下往上抽象程度越来越高:

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="Agent 技术栈五层:模型 API 与 SDK、协议层 MCP 与 A2A、编排框架、Agent SDK 与 Harness、低代码平台">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <rect x="20" y="20" width="600" height="44" rx="4" fill="none" stroke="var(--ink-soft)"/>
    <text x="34" y="40" fill="var(--ink)">⑤ 低代码平台</text>
    <text x="34" y="56" font-size="11" fill="var(--ink-soft)">Dify · Coze/扣子 · n8n:拖拽搭流程,给业务同学和快速验证用</text>
    <rect x="20" y="72" width="600" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="34" y="92" fill="var(--ink)">④ Agent SDK / Harness</text>
    <text x="34" y="108" font-size="11" fill="var(--ink-soft)">OpenAI Agents SDK · Claude Agent SDK · Claude Code / Codex:循环、工具、权限、会话都备好了</text>
    <rect x="20" y="124" width="600" height="44" rx="4" fill="none" stroke="var(--ink-soft)"/>
    <text x="34" y="144" fill="var(--ink)">③ 编排框架</text>
    <text x="34" y="160" font-size="11" fill="var(--ink-soft)">LangGraph · LangChain · LlamaIndex · CrewAI · Microsoft Agent Framework:你来设计流程</text>
    <rect x="20" y="176" width="600" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="34" y="196" fill="var(--ink)">② 协议与能力包</text>
    <text x="34" y="212" font-size="11" fill="var(--ink-soft)">MCP(连工具)· A2A(连 Agent)· Agent Skills(按需加载的知识和脚本)</text>
    <rect x="20" y="228" width="600" height="44" rx="4" fill="none" stroke="var(--ink-soft)"/>
    <text x="34" y="248" fill="var(--ink)">① 模型 API 与客户端 SDK</text>
    <text x="34" y="264" font-size="11" fill="var(--ink-soft)">openai / anthropic SDK · OpenAI 兼容协议:你自己写循环(Day 9 就在这一层)</text>
  </g>
  <text x="320" y="292" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">越往上越省代码,越往下越可控</text>
</svg>
<figcaption>横评要在同一层里比。选型的第一个问题不是「哪个框架最好」,而是「我需要在哪一层工作」。</figcaption>
</figure>

第 ① 层是你 W1–W2 一直在用的:直接调模型 API,循环自己写。第 ③ 层是编排框架,给你画流程的积木,流程本身由你设计。第 ④ 层更进一步,把「一个能干活的 Agent」整个做好了:循环、工具执行、权限、会话、上下文压缩都是现成的,你主要做配置和挂工具。第 ⑤ 层面向不写代码或少写代码的人。第 ② 层比较特殊,它不是框架,而是各层之间的接口标准。

选型时我会先问三个问题:流程是不是很固定(固定就往低层走,用 workflow);团队里谁来维护(业务同学维护就考虑低代码);需不需要一个「什么都能干」的通用 Agent(需要就看 harness)。

## 同一个任务,三种框架

任务很简单:「user007@example.com 这个客户 10 月有没有被重复扣款?列出相关发票号和金额。」两个工具:`find_customer` 和 `list_invoices`,直接复用 Day 23 server.py 里的函数(`@mcp.tool()` 装饰器返回的还是原函数,可以直接 import 调用)。

手写版本你已经有了,就是 Day 23 的 `mcp_agent.py`,或者 Day 26 的 `MiniAgent`,核心循环 20 行左右。下面是三个框架的写法。

```bash
cd agent-60-lab
uv add langchain openai-agents claude-agent-sdk
mkdir -p w4/frameworks
```

### LangChain 1.x:create_agent

```python
# agent-60-lab/w4/frameworks/fw_langchain.py
"""同一个任务 · LangChain 1.x 的 create_agent(底下跑的是 LangGraph)。"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from langchain.agents import create_agent
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI

sys.path.insert(0, str(Path(__file__).parents[1] / "cloudledger"))
from server import find_customer, list_invoices  # noqa: E402

load_dotenv()
TASK = "user007@example.com 这个客户 10 月有没有被重复扣款?列出相关发票号和金额。"

model = ChatOpenAI(model=os.environ["LLM_MODEL"], base_url=os.environ["LLM_BASE_URL"],
                   api_key=os.environ["LLM_API_KEY"], temperature=0)
agent = create_agent(
    model,
    tools=[tool(find_customer), tool(list_invoices)],
    system_prompt="你是云簿的账务专员。先用工具查事实,不要编造发票号和金额。",
)

if __name__ == "__main__":
    result = agent.invoke({"messages": [{"role": "user", "content": TASK}]})
    for m in result["messages"]:
        m.pretty_print()
```

`create_agent` 是 LangChain 1.0 推出的统一入口,替代了以前五花八门的 Agent 类和 LangGraph 的 `create_react_agent`。它返回的是一个编译好的 LangGraph 图(打印类型能看到 `CompiledStateGraph`),所以昨天学的 `stream`、checkpointer、interrupt 全都能用。它的特色是 **middleware**:在模型调用前后、工具调用前后插入逻辑,比如 `HumanInTheLoopMiddleware` 在指定工具执行前自动 interrupt 等人审批,还有做对话摘要、PII 脱敏、调用次数限制的现成中间件。

### OpenAI Agents SDK

```python
# agent-60-lab/w4/frameworks/fw_openai_agents.py
"""同一个任务 · OpenAI Agents SDK。用 Chat Completions 兼容模式接 DeepSeek 等厂商。"""
import os
import sys
from pathlib import Path

from agents import Agent, AsyncOpenAI, OpenAIChatCompletionsModel, Runner, function_tool, set_tracing_disabled
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).parents[1] / "cloudledger"))
import server  # noqa: E402

load_dotenv()
set_tracing_disabled(True)  # 没有 OpenAI 官方 key 时关掉 tracing,否则会尝试往 OpenAI 上传 trace 并报 401
TASK = "user007@example.com 这个客户 10 月有没有被重复扣款?列出相关发票号和金额。"


@function_tool
def find_customer(query: str) -> list[dict]:
    """按邮箱/姓名/公司/编号查找客户,返回客户编号等信息。"""
    return server.find_customer(query)


@function_tool
def list_invoices(customer_id: str, limit: int = 6) -> list[dict]:
    """列出客户最近的发票,customer_id 形如 C007。"""
    return server.list_invoices(customer_id, limit=limit)


client = AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
agent = Agent(
    name="账务专员",
    instructions="你是云簿的账务专员。先用工具查事实,不要编造发票号和金额。",
    model=OpenAIChatCompletionsModel(model=os.environ["LLM_MODEL"], openai_client=client),
    tools=[find_customer, list_invoices],
)

if __name__ == "__main__":
    result = Runner.run_sync(agent, TASK)
    print(result.final_output)
```

OpenAI Agents SDK 是 2025 年 3 月发布的,前身是实验项目 Swarm。核心概念只有几个:Agent(指令 + 工具 + 模型)、Runner(跑循环)、handoff(交接给另一个 Agent)、guardrail(输入输出检查)、session(会话记忆),外加内置的 tracing。它的设计哲学是「少而精」,代码读起来非常干净。

用它接 DeepSeek 这类厂商有两个坑,我在代码里都处理了。一是 SDK 默认走 OpenAI 的 Responses API,大多数兼容厂商只支持 Chat Completions,所以要用 `OpenAIChatCompletionsModel` 显式包一层,否则会 404。二是 tracing 默认会把执行轨迹上传到 OpenAI 平台,没有 OpenAI 官方 key 时会报 401,用 `set_tracing_disabled(True)` 关掉,或者接自己的 trace 处理器(W5 会接 Langfuse)。

### Claude Agent SDK

```python
# agent-60-lab/w4/frameworks/fw_claude_sdk.py
"""同一个任务 · Claude Agent SDK。它不是一个「框架」而是一个完整的 harness:
底下跑的是 Claude Code 本体,自带读写文件、执行命令等工具,我们只额外挂两个业务工具。
需要 ANTHROPIC_API_KEY;也可以把 ANTHROPIC_BASE_URL 指向兼容 Anthropic 协议的厂商(效果以实测为准)。"""
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

from claude_agent_sdk import ClaudeAgentOptions, create_sdk_mcp_server, query, tool

sys.path.insert(0, str(Path(__file__).parents[1] / "cloudledger"))
import server  # noqa: E402

TASK = "user007@example.com 这个客户 10 月有没有被重复扣款?列出相关发票号和金额。"


@tool("find_customer", "按邮箱/姓名/公司/编号查找客户,返回客户编号等信息", {"query": str})
async def find_customer(args: dict[str, Any]) -> dict[str, Any]:
    rows = server.find_customer(args["query"])
    return {"content": [{"type": "text", "text": json.dumps(rows, ensure_ascii=False)}]}


@tool("list_invoices", "列出客户最近的发票,customer_id 形如 C007", {"customer_id": str})
async def list_invoices(args: dict[str, Any]) -> dict[str, Any]:
    rows = server.list_invoices(args["customer_id"])
    return {"content": [{"type": "text", "text": json.dumps(rows, ensure_ascii=False)}]}


cloudledger = create_sdk_mcp_server(name="cloudledger", version="1.0.0", tools=[find_customer, list_invoices])
options = ClaudeAgentOptions(
    system_prompt="你是云簿的账务专员。先用工具查事实,不要编造发票号和金额。",
    mcp_servers={"cloudledger": cloudledger},
    tools=[],  # 内置工具(Bash、Read、Write……)一个都不开,只留下面 MCP server 里的两个业务工具
    # allowed_tools 的意思是「免确认自动执行」,不是「只允许这些」;工具全名是 mcp__{server 名}__{工具名}
    allowed_tools=["mcp__cloudledger__find_customer", "mcp__cloudledger__list_invoices"],
    max_turns=6,
)


async def main() -> None:
    async for message in query(prompt=TASK, options=options):
        print(type(message).__name__, getattr(message, "result", "") or "")


if __name__ == "__main__":
    asyncio.run(main())
```

Claude Agent SDK 和前两个性质不同。官方文档的说法是,它给你「驱动 Claude Code 的同一套工具、Agent 循环和上下文管理」,作为 Python/TypeScript 库来用。它在底下启动的就是 Claude Code 程序本身,所以开箱就有读写文件、执行命令、搜索网页这些内置工具,还有权限控制、hooks、会话恢复、子 Agent、Skills。你自己的业务工具用 `@tool` 定义、`create_sdk_mcp_server` 包成一个**进程内的 MCP server** 挂上去,这和 Day 23 学的 MCP 是同一个东西。

代码里有两个参数一定要搞清楚。`tools=[]` 表示一个内置工具都不开:一个只查账的客服 Agent 没有理由拥有执行 shell 命令的能力。`allowed_tools` 的含义是「这些工具免确认自动执行」,**不是**「只允许这些工具」。我第一次读文档时就理解反了,如果只写 `allowed_tools` 而不关内置工具,Agent 仍然能调用 Bash,只是需要走权限确认流程。

需要说明一下测试情况:LangChain 和 OpenAI Agents SDK 两个脚本,我用一个本地的假模型服务(按 OpenAI 协议返回预设的工具调用)完整跑通了,两边都正确地先调 `find_customer` 再调 `list_invoices`。Claude Agent SDK 版本需要 Anthropic 的 API key 和 Claude Code 运行环境,我只做了导入和参数构造检查,没有实际调用模型,你跑的时候如果遇到问题以官方文档为准。DeepSeek 提供了 Anthropic 兼容的接口(`https://api.deepseek.com/anthropic`),理论上可以通过 `ANTHROPIC_BASE_URL` 接上,但 Claude Agent SDK 依赖的一些 Claude 专有能力在兼容接口上可能不支持,效果要自己验证。

### 对比

| | 手写循环 | LangChain create_agent | OpenAI Agents SDK | Claude Agent SDK |
| --- | --- | --- | --- | --- |
| 所在层 | ① | ③(底下是 LangGraph) | ④ | ④(Claude Code 本体) |
| 本任务代码量 | 约 60 行 | 约 30 行 | 约 45 行 | 约 50 行 |
| 控制力 | 完全掌控 | 高,随时可以降到 LangGraph | 中,循环由 Runner 管 | 低,行为基本由 Claude Code 决定 |
| 模型绑定 | 无 | 无,几十家厂商 | 默认 OpenAI,兼容厂商要包一层 | 为 Claude 设计 |
| 自带能力 | 无 | middleware、持久化、interrupt | handoff、guardrail、session、tracing | 内置工具、权限、hooks、子 Agent、Skills、会话 |
| 学习成本 | 低 | 中(概念多,版本变化快) | 低 | 低到中(要懂 Claude Code 的配置体系) |
| 适合 | 学习、极简场景、强定制 | 复杂流程、需要持久化和人工介入 | 中等复杂、多 Agent 交接 | 要一个「什么都能干」的通用 Agent,如编码、文件处理、运维 |

代码量只是一个参考,差别其实不大。真正的差别在「出了问题你能不能改」:手写版本每一行都是你的;LangChain 的行为大部分可以通过 LangGraph 和 middleware 改;OpenAI Agents SDK 的循环是 Runner 写死的,但足够简单,读源码一个下午能读完;Claude Agent SDK 的核心是一个闭源的程序,你能配置但改不了它的内部逻辑。

### 其他几个名字

**LlamaIndex** 起家于 RAG,数据接入(各种文档解析器、索引结构)是它的强项,后来也做了 Agent 和 Workflow。如果你的场景以「接入大量异构文档」为主,它比 LangChain 顺手。

**CrewAI** 主打「角色扮演式」多 Agent:给每个 Agent 定义角色、目标、背景故事,组成一个「团队」。上手快,演示效果好,但控制粒度比 LangGraph 粗,复杂生产场景用的人少一些。

**AutoGen** 是微软研究院出的多 Agent 框架,2023 年很火。2025 年底到 2026 年初,微软把 AutoGen 和 Semantic Kernel 合并成了 **Microsoft Agent Framework**,据报道 2026 年 4 月正式发布 1.0,AutoGen 和 Semantic Kernel 本身进入维护模式。看到 AutoGen 的老教程,知道这层关系就行;新项目如果在微软技术栈上,看 Agent Framework。

**Dify 和 Coze(扣子)** 是低代码平台。Dify 开源,可以私有部署,许可证是在 Apache 2.0 基础上加了限制条款的自定义协议(商用多租户有条件,用之前读一下);Coze 是字节的产品,2025 年 7 月开源了核心的 Coze Studio(Apache 2.0)。它们的价值是让业务同学自己拖出一个知识库问答或审批机器人,也适合工程师做快速验证。缺点是复杂逻辑表达力有限,版本管理、测试、评测都不如代码方便。很多公司的实际做法是:Dify 做原型和内部小工具,核心产品用代码写。面试时别贬低低代码,说清楚它适合什么就好。

## Agent Skills:按需加载的能力包

Skills 是 Anthropic 在 2025 年 10 月推出的机制,同年 12 月作为开放标准发布(规范在 agentskills.io),之后被不少 Agent 产品采用。国内 JD 里有 11% 写了「Skills 体系」,通常和 MCP、Claude Code 并列出现。

一个 Skill 就是一个文件夹,里面至少有一个 `SKILL.md`。文件开头是 YAML 元数据,`name` 和 `description` 两个字段必填;正文是给 Agent 看的操作说明;文件夹里还可以放参考文档、模板和可执行脚本。

它最核心的设计是**渐进式加载(progressive disclosure)**,分三级:

1. **元数据,始终加载**。Agent 启动时,只把每个 Skill 的名字和描述放进系统提示词,官方文档给的量级是每个 Skill 约 100 个 token。所以装几十个 Skill 也不会把上下文撑爆。
2. **正文,触发时加载**。用户的请求和某个 Skill 的描述匹配时,Agent 用 bash 读取 `SKILL.md` 的正文进上下文。官方建议正文控制在 5k token 以内。
3. **资源和脚本,用到时才读**。正文里提到「表单填写见 FORMS.md」,Agent 需要时才去读那个文件;提到「运行 scripts/xxx.py」,Agent 直接执行脚本,**只有脚本的输出进上下文,脚本代码本身不进**。

这个设计解决的是一个很实际的问题:Agent 需要的领域知识越来越多(公司的退款政策、报表格式规范、部署流程),全塞进系统提示词会撑爆上下文、互相干扰;做成 RAG 又不适合「操作步骤」这类程序性知识。Skills 的做法像给新员工的入职手册:目录一直摆在桌上,用到哪章翻哪章。

给 CloudLedger 写一个退款处理 Skill。在 Claude Code 里,项目级 Skill 放在 `.claude/skills/` 下:

```text
agent-60-lab/.claude/skills/cloudledger-refund/
├── SKILL.md
├── policy.md
└── scripts/
    └── check_duplicates.py
```

```markdown
---
name: cloudledger-refund
description: 处理云簿 CloudLedger 客户的退款和重复扣款问题。当用户提到退款、多扣钱、重复扣款、扣了两次、年付退订时使用。会查发票、按退款政策计算可退金额,只提交申请不直接退款。
---

# 云簿退款处理

## 步骤

1. 用 cloudledger MCP server 的 `find_customer` 拿到客户编号,不要猜编号。
2. 判断是哪类退款:
   - 重复扣款:运行 `python scripts/check_duplicates.py <客户编号>`,脚本会列出同一天同金额的发票对。
   - 年付中途取消:读 `policy.md` 里的计算规则,按剩余整月数算,当月不退。
   - 月付:不支持中途退款,直接告诉客户取消后当期结束不再续费。
3. 用 `create_refund_request` 提交申请,reason 里写清依据(哪两张发票、按哪条政策)。
4. 回复客户时说明「已提交申请,需要主管审批,一般 3 个工作日内原路退回」,不要承诺具体到账时间。

## 不要做的事

- 不要在没有查到发票的情况下承诺退款。
- 不要对 open 或 refunded 状态的发票提交申请。
```

`policy.md` 里放 Day 23 那份退款政策原文加上年付的计算公式。脚本是确定性的查重逻辑:

```python
# .claude/skills/cloudledger-refund/scripts/check_duplicates.py
"""找出某个客户「同一天、同金额」的已付发票,疑似重复扣款。只读,不改库。"""
import os
import sqlite3
import sys
from pathlib import Path

DEFAULT_DB = Path(__file__).resolve().parents[4] / "w4" / "cloudledger" / "cloudledger.db"
DB = Path(os.environ.get("CLOUDLEDGER_DB", DEFAULT_DB))


def main(customer_id: str) -> None:
    conn = sqlite3.connect(DB)
    rows = conn.execute(
        "SELECT issued_at, amount_cents, GROUP_CONCAT(id, ', ') FROM invoices "
        "WHERE customer_id = ? AND status = 'paid' "
        "GROUP BY issued_at, amount_cents HAVING COUNT(*) > 1",
        (customer_id,),
    ).fetchall()
    if not rows:
        print(f"{customer_id} 没有同日同额的已付发票")
    for day, cents, ids in rows:
        print(f"{day} 金额 {cents / 100:.2f} 元 重复:{ids}")


if __name__ == "__main__":
    main(sys.argv[1])
```

```bash
python .claude/skills/cloudledger-refund/scripts/check_duplicates.py C007
# 2026-10-08 金额 2392.00 元 重复:INV-2026-0026, INV-2026-0123
```

写 Skill 有几个要点。`name` 只能用小写字母、数字和连字符,最长 64 个字符,不能包含 anthropic、claude 这类保留词。`description` 最长 1024 字符,**必须同时写「做什么」和「什么时候用」**,因为 Agent 就是拿用户请求去和它匹配的;我在描述里列了「多扣钱、扣了两次、年付退订」这些用户的真实说法,就是为了提高触发率。能用脚本做的确定性操作(查重、算金额)就写成脚本,比让模型每次现场推理更可靠,也更省 token。

Skills 的安全问题和 MCP server 一样:它等于给 Agent 装了一个带脚本的插件。官方文档明确建议只用自己写的或来源可信的 Skill,用第三方 Skill 之前把里面每个文件都审一遍,特别注意会访问外部网址的脚本。

### Skills、MCP、子 Agent 怎么分工

这三个东西都能「给 Agent 加能力」,面试很喜欢放在一起问。我的理解是它们解决的是三个不同的问题:

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="三栏对比:MCP 提供能做什么(连接外部系统),Skills 提供怎么做(流程知识和脚本),子 Agent 提供谁来做(独立上下文执行子任务)">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)">
    <rect x="20" y="20" width="190" height="190" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="115" y="46" text-anchor="middle" font-size="14" fill="var(--ink)">MCP</text>
    <text x="115" y="68" text-anchor="middle" font-size="12" fill="var(--ink)">能做什么</text>
    <g font-size="11" fill="var(--ink-soft)">
      <text x="34" y="100">连外部系统和数据</text><text x="34" y="122">查发票、建工单、读库</text><text x="34" y="144">工具定义常驻上下文</text><text x="34" y="166">跨应用复用</text><text x="34" y="188">像:接口</text>
    </g>
    <rect x="225" y="20" width="190" height="190" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="320" y="46" text-anchor="middle" font-size="14" fill="var(--ink)">Skills</text>
    <text x="320" y="68" text-anchor="middle" font-size="12" fill="var(--ink)">怎么做</text>
    <g font-size="11" fill="var(--ink-soft)">
      <text x="239" y="100">流程知识、规范、脚本</text><text x="239" y="122">退款怎么判、报表怎么排</text><text x="239" y="144">平时只占约 100 token</text><text x="239" y="166">用到才加载正文</text><text x="239" y="188">像:操作手册</text>
    </g>
    <rect x="430" y="20" width="190" height="190" rx="6" fill="none" stroke="var(--ink-soft)"/>
    <text x="525" y="46" text-anchor="middle" font-size="14" fill="var(--ink)">子 Agent</text>
    <text x="525" y="68" text-anchor="middle" font-size="12" fill="var(--ink)">谁来做</text>
    <g font-size="11" fill="var(--ink-soft)">
      <text x="444" y="100">独立上下文跑子任务</text><text x="444" y="122">翻 30 个网页再汇报</text><text x="444" y="144">中间过程不污染主上下文</text><text x="444" y="166">token 成本成倍</text><text x="444" y="188">像:派一个同事</text>
    </g>
  </g>
</svg>
<figcaption>三者常常一起用:主 Agent 加载退款 Skill 知道流程,通过 MCP 工具查发票,遇到需要大量检索的子任务时派子 Agent 去做。</figcaption>
</figure>

**MCP 回答「能做什么」**:连接外部系统的能力,没有它 Agent 碰不到你的数据库。**Skills 回答「怎么做」**:做某类事情的流程、规范、经验,以及辅助脚本;它本身通常不连新系统,而是告诉 Agent 怎么用已有的工具把事做对。**子 Agent 回答「谁来做」**:把一块工作交给一个有独立上下文的执行者,保护主 Agent 的上下文。

一个具体的判断方法:如果你发现自己在系统提示词里写了一大段「遇到退款要先……再……注意……」,这段该变成 Skill;如果你需要访问一个 Agent 碰不到的系统,该写 MCP server;如果某个子任务会产生大量中间信息而主流程只需要结论,该派子 Agent。还有一个细节:MCP 工具的定义(名字、描述、参数 schema)是常驻上下文的,工具一多就很占地方,这也是 Skills 和「按需加载工具」这类机制流行起来的原因之一。

## Agent Harness 是什么

国内大厂这一年有不少岗位标题直接叫「Agent Harness 工程师」或「Agent Infra」。harness 的字面意思是马具、挽具,在 Agent 语境里指**包在模型外面、让它能真正干活的那一整套运行框架**。模型是马,harness 决定它能拉什么车、往哪走、出了事怎么停。

具体包括这些部分:

- **Agent 循环**:调模型、执行工具、回传结果、判断何时停止;
- **工具和 Skill 的注册与加载**:内置工具、MCP 工具、Skills 的发现和按需加载;
- **上下文组装与压缩**:每一轮把系统提示词、记忆、工具结果、历史拼成上下文,长了要摘要压缩;
- **执行环境与权限**:沙箱、文件系统隔离、哪些操作要确认;
- **状态与恢复**:会话持久化、checkpoint、中断后接着跑;
- **hooks 与可观测**:在关键节点插入自定义逻辑,记录每一步。

Claude Code、OpenAI Codex、Cursor 的 Agent 模式都是 harness。Claude Agent SDK 就是把 Claude Code 这个 harness 作为库开放出来。Anthropic 2025 年 11 月有一篇工程文章《Effective harnesses for long-running agents》,讲怎么让 Agent 跨多个会话持续完成一个大任务:第一个会话做初始化(建进度文件、功能清单、初始 git 提交),之后每个会话先读进度文件接上,做完一个功能就提交,用浏览器自动化做端到端测试。这篇文章基本就是「harness 工程」的样子:模型能力不变,靠外面这套机制让它可靠地干长活。

你回头看会发现,这门课其实一直在教你搭 harness 的零件:Day 9 的循环、Day 12 的失败处理、Day 20 的上下文压缩、Day 23 的工具接入、Day 25 的状态持久化和人工介入,W6 还会讲沙箱和权限。面试官问「你理解的 Agent Harness 是什么」,你可以把这些串起来讲,再补一句:框架和 harness 的区别在于,框架给你积木,harness 是一个已经搭好、能直接干活的 Agent 运行时。

## 面试最难的那三题

JD 里「能讲清框架局限和何时不用框架」「理解 LangChain/LlamaIndex 原理」这类要求,对应的面试题基本是下面三个。

**框架底层是怎么实现的?** 以 LangChain 的 `create_agent` 为例,它构造了一张 LangGraph 图:一个模型节点、一个工具节点、一条「有工具调用就去工具节点,否则结束」的条件边,工具节点执行完回到模型节点;middleware 是在模型调用和工具调用前后插入的钩子。工具的 schema 是从函数签名和 docstring 用 pydantic 生成的。LangGraph 本身是一个按「超步」(super-step)执行的状态机,每一步结束按 reducer 合并状态、写 checkpoint。OpenAI Agents SDK 的 Runner 是一个 while 循环:调模型 → 如果输出了最终结果就结束,如果是工具调用就执行再循环,如果是 handoff 就换成另一个 Agent 继续循环,每轮检查 guardrail 和最大轮数。Claude Agent SDK 是启动 Claude Code 子进程,通过流式 JSON 和它通信。说到这个程度,面试官就知道你看过源码或者自己实现过。最有说服力的答法是:「我自己手写过一个,和框架的结构是一样的」,然后讲 Day 9 的那 100 行。

**局限在哪?** 我会说这几点,每点都带一个具体例子:
- 抽象泄漏:框架帮你拼的提示词你看不见,模型行为异常时很难定位。比如某些框架会在系统提示词里自动加一段工具使用说明,和你自己的指令冲突。
- 版本变动:LangGraph 1.0 弃用了 `create_react_agent`,MCP Python SDK 2.x 把 `FastMCP` 改名为 `MCPServer`,半年前的教程照抄就报错。依赖升级要有测试兜底。
- 模型绑定和兼容性:OpenAI Agents SDK 默认走 Responses API,兼容厂商要包一层;`with_structured_output` 的默认方式在国产模型上可能不工作。
- 性能和成本开销:多一层抽象就多一层序列化和日志,高并发场景要压测;有的框架默认开 tracing 上传数据,还涉及合规。
- 调试和评测:框架里的中间状态要靠它自己的工具(LangSmith 等)才看得清,迁移成本高。

**什么时候不用框架?** 流程简单(一问一答、固定两三步)时不用,手写更清楚;对延迟和成本极度敏感、需要精确控制每一个 token 时不用;团队没人熟悉框架、又没时间学时不用;框架的抽象和你的业务模型严重不匹配,天天在和框架作对时不用。反过来,需要持久化、人工介入、复杂分支、多人协作维护时,用框架是划算的。一个很好的实践是:**先手写最小版本把问题跑通,等出现第一个手写起来很痛苦的需求(比如暂停等审批),再引入框架**。这样你引入框架的理由是具体的,面试时也讲得出来。

## 动手练习

1. 跑通三个框架脚本中的至少两个(LangChain 和 OpenAI Agents SDK 用你的 DeepSeek key 就能跑),记录每个的模型调用次数和总 token。
2. 打开 LangChain 的调试输出(`create_agent(..., debug=True)` 或者用 `agent.stream(..., stream_mode="updates")`),找到它实际发给模型的完整消息,看看除了你写的 system_prompt,有没有框架自己加进去的内容。
3. 读源码:在虚拟环境里找到 OpenAI Agents SDK 的 `agents/run.py`,从 `Runner.run` 开始往下追(0.23 版把主循环的细节拆进了同级的 `run_internal/` 目录),找出主循环的位置,用三五句话写下它每一轮做了什么,和 Day 9 的循环对照。
4. 把 `cloudledger-refund` Skill 放进 `agent-60-lab/.claude/skills/`,在 Claude Code 里配好 Day 23 的 MCP server,然后问「user007 说 10 月扣了两次钱,帮我处理」。观察它是否加载了 Skill(会看到它读取 SKILL.md)、是否运行了查重脚本。再把 `description` 改成只有「退款」两个字,换个说法问(「我被多收钱了」),看还能不能触发。
5. 写一页「选型说明」:如果让你给 CloudLedger 的客服系统选技术栈,你选哪几层、哪个框架,理由是什么,不选什么,为什么。这页纸就是面试时的答题稿。
6. 加分题:用 Dify 或 Coze 拖一个最简单的「查发票」工作流,和代码版本比较开发速度和可维护性。

**验收标准**:至少两个框架跑通并有调用次数记录;第 2 题找到至少一处框架自动添加的内容(如果确实没有,写下你怎么确认的);第 3 题有对源码主循环的文字描述;第 4 题能说清 Skill 是在哪一步被加载的;第 5 题的选型说明能经得起「为什么不用 X」的追问。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| create_agent | LangChain 1.0 的统一 Agent 入口,返回 LangGraph 图 |
| middleware | 在模型调用、工具调用前后插入的钩子,用于审批、摘要、脱敏、限流等 |
| OpenAI Agents SDK | OpenAI 2025 年 3 月发布的轻量 Agent 框架,核心概念是 Agent、Runner、handoff、guardrail、session |
| OpenAIChatCompletionsModel | Agents SDK 里走 Chat Completions 协议的模型包装,用于接兼容厂商 |
| Claude Agent SDK | 把 Claude Code 的循环、工具、权限、会话作为库提供的 SDK |
| `@tool` / create_sdk_mcp_server | Claude Agent SDK 定义自定义工具并打包成进程内 MCP server 的方式 |
| allowed_tools | Claude Agent SDK 里「免确认自动执行」的工具列表,不限制可用范围 |
| Agent Skills | 以 SKILL.md 为核心的能力包,包含说明、资料和脚本,按需加载;2025 年 12 月成为开放标准 |
| 渐进式加载 | 先只加载元数据,触发时加载正文,用到时才读资源和执行脚本 |
| Agent Harness | 包在模型外面的运行框架:循环、工具/Skill 加载、上下文组装、沙箱权限、状态恢复、hooks |
| Microsoft Agent Framework | 微软合并 AutoGen 与 Semantic Kernel 后的新框架 |
| 低代码平台 | Dify、Coze 等,用可视化编排搭建 Agent 应用 |

## 常见误区

**横评时把不同层的东西放在一起比。** LangGraph 和 Dify、Claude Agent SDK 和 LangChain 都不在同一层。先确定你要在哪一层工作,再在同层里比较。

**以为用了框架就不用懂原理。** 框架帮你省的是代码,不是理解。模型行为异常、成本突然变高、版本升级报错时,你得能钻进去看。面试也一定会问。

**把 Claude Agent SDK 的 `allowed_tools` 当白名单。** 它只是免确认列表。要限制工具范围,用 `tools` 控制内置工具,用 `disallowed_tools` 显式禁用。

**Skill 的 description 写得太短。** 「退款」两个字很难匹配到「我被多收钱了」。描述要写清做什么、什么时候用,列出用户可能的说法。

**把 Skills 当成 MCP 的替代品。** Skill 不能凭空连上一个新系统,它是在已有工具和执行环境之上提供流程知识和脚本。需要访问新系统还得有 MCP server 或其他工具。

**照抄带版本号的老教程。** 这个领域半年一个大版本。看教程先看日期,遇到 import 报错先查迁移文档。

**贬低低代码平台。** 它们在原型验证、业务同学自助、内部小工具上很有价值。说清楚适用边界比一概否定更显得成熟。

## 学习资料

### 文档与文章

- [LangChain · Agents](https://docs.langchain.com/oss/python/langchain/agents):`create_agent` 和 middleware 的官方文档,40 分钟。
- [OpenAI Agents SDK 文档](https://openai.github.io/openai-agents-python/) 与 [Models](https://openai.github.io/openai-agents-python/models/):重点看接非 OpenAI 模型的那一节,30 分钟。
- [Claude Agent SDK · Python 参考](https://platform.claude.com/docs/en/agent-sdk/python) 与 [Custom tools](https://platform.claude.com/docs/en/agent-sdk/custom-tools):`ClaudeAgentOptions` 各字段的含义,特别是 tools、allowed_tools、disallowed_tools、permission_mode,40 分钟。
- [Anthropic · Agent Skills 概览](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview):三级加载、SKILL.md 字段规则、各产品里的用法和安全注意事项,今天必读,40 分钟。
- [Agent Skills 开放标准](https://agentskills.io):规范本身和支持它的客户端列表。
- [Anthropic · Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills):Skills 的设计思路,20 分钟。
- [Claude Code · Skills](https://code.claude.com/docs/en/skills):在 Claude Code 里创建和使用 Skill 的具体方法。
- [Anthropic · Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents):理解 harness 工程最好的一篇,30 分钟。
- [OpenAI · A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf):OpenAI 官方的 Agent 设计指南 PDF,里面关于「什么时候该做 Agent」和编排模式的部分可以和今天对照。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1cGigBQE6n&autoplay=0&high_quality=1" title="Agent Skill 从使用到原理,一次讲清" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>马克的技术工作坊 · Agent Skill 从使用到原理,一次讲清 · 17 分钟,讲 Skill 的加载机制和它与 MCP 的区别,和今天 Skills 一节完全对应。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1t55v6DE2v&autoplay=0&high_quality=1" title="Agent和Harness到底是什么?一个动画彻底搞懂!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>轩辕的编程宇宙 · Agent和Harness到底是什么?一个动画彻底搞懂! · 13 分钟动画,把模型、Agent、Harness 的关系讲得很直观。</figcaption>
</figure>

- 唐国梁Tommy《OpenAI Agents SDK 轻量级多智能体框架》(B 站 BV1ajXkY2Edx,17 分钟):SDK 发布时的中文讲解,概念部分仍然适用。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/CEvIs9y1uog" title="Don't Build Agents, Build Skills Instead – Barry Zhang & Mahesh Murag, Anthropic" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · Don't Build Agents, Build Skills Instead – Barry Zhang & Mahesh Murag, Anthropic · 16 分钟,Skills 设计者本人讲为什么「一个通用 Agent + 很多 Skill」比「很多专用 Agent」好,和 Day 26 的多 Agent 讨论正好接上。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/TqC1qOfiVcQ" title="Claude Agent SDK [Full Workshop] — Thariq Shihipar, Anthropic" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · Claude Agent SDK [Full Workshop] — Thariq Shihipar, Anthropic · 1 小时 52 分,Claude Code 团队讲 Agent SDK 和 harness 设计,今天看前 40 分钟。</figcaption>
</figure>

- Anthropic《Claude Agent Skills Explained》(YouTube,3 分钟):官方的 Skills 简介,按标题搜索。
- OpenAI《Build Hour: Agents SDK》(YouTube,48 分钟):OpenAI 官方讲 Agents SDK 的设计和用法,按标题搜索。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025)第 6 章:关于 Agent 的规划、工具选择和失败模式,是你讲「框架底层在做什么」的理论底子。
- Mayo Oshin、Nuno Campos《Learning LangChain》(O'Reilly, 2025):第 6 章「Agent Architecture」讲 LangGraph 里 Agent 的标准结构,对应 `create_agent` 底下的那张图。书出版于 1.0 之前,API 以官方文档为准。

### 开源项目与代码

- [openai/openai-agents-python](https://github.com/openai/openai-agents-python):从 `src/agents/run.py` 的 `Runner.run` 追到 `run_internal/` 里的主循环,动手练习第 3 题。
- [langchain-ai/langchain](https://github.com/langchain-ai/langchain):找到 `create_agent` 的实现,看它怎么把 middleware 织进图里。
- [anthropics/claude-agent-sdk-python](https://github.com/anthropics/claude-agent-sdk-python):看它怎么启动 Claude Code 子进程、怎么和它通信。
- [anthropics/skills](https://github.com/anthropics/skills):官方开源的 Skill 示例,学怎么写 description 和组织脚本。
- [langgenius/dify](https://github.com/langgenius/dify) 与 [coze-dev/coze-studio](https://github.com/coze-dev/coze-studio):两个低代码平台的开源仓库,README 里有私有部署方法。
- [run-llama/llama_index](https://github.com/run-llama/llama_index) 与 [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI):各看一个官方 example,感受风格差异。

## 自测

1. 把下列东西放进分层图的对应层:Dify、MCP、LangGraph、Claude Agent SDK、openai Python SDK、Agent Skills、OpenAI Agents SDK。

<details><summary>答案</summary>

① 模型 API 与客户端 SDK:openai Python SDK。② 协议与能力包:MCP、Agent Skills。③ 编排框架:LangGraph。④ Agent SDK / Harness:OpenAI Agents SDK、Claude Agent SDK。⑤ 低代码平台:Dify。OpenAI Agents SDK 也可以算在 ③ 和 ④ 之间,它比 Claude Agent SDK 轻得多,没有内置的文件和命令工具。

</details>

2. 用 OpenAI Agents SDK 接 DeepSeek,运行时报 404 和 401 两种错误,分别是什么原因?

<details><summary>答案</summary>

404:SDK 默认调用 Responses API(`/v1/responses`),DeepSeek 只支持 Chat Completions,要用 `OpenAIChatCompletionsModel` 包装模型,或者调用 `set_default_openai_api("chat_completions")`。401:默认的 tracing 会把执行轨迹上传到 OpenAI 平台,没有 OpenAI 官方 key 就会鉴权失败,用 `set_tracing_disabled(True)` 关掉或换成自己的 trace 处理器。

</details>

3. 你装了 30 个 Skill,系统提示词会因此增加多少 token?如果把这 30 个 Skill 的内容全写进系统提示词呢?

<details><summary>答案</summary>

按官方给的量级,每个 Skill 的元数据约 100 token,30 个约 3000 token。如果把正文全部写进系统提示词,按每个正文最多约 5k token 算,可能达到十几万 token,不仅贵,还会让模型在大量无关指令里迷失。渐进式加载的价值就在这里:只有被触发的 Skill 正文才进上下文,脚本代码永远不进,只有输出进。

</details>

4. 某同事说:「有了 Skills,MCP 就没用了。」你怎么回应?

<details><summary>答案</summary>

两者解决不同问题。MCP 让 Agent 能连接外部系统(数据库、SaaS、内部服务),Skill 告诉 Agent 做某类事情的流程和规范,并附带辅助脚本。Skill 本身不能凭空提供对一个新系统的访问,它通常要配合已有的工具(包括 MCP 工具)使用。比如退款 Skill 里的步骤就是在指导 Agent 怎么调用 MCP 的 `find_customer` 和 `create_refund_request`。可以补充一点:MCP 工具定义常驻上下文,工具很多时占用大,这是 Skills 这类按需加载机制受欢迎的原因之一,但不等于替代。

</details>

5. 什么是 Agent Harness?举两个具体的 harness 产品,并说出 harness 里至少四个组成部分。

<details><summary>答案</summary>

Harness 是包在模型外面、让模型能可靠完成任务的运行框架。产品如 Claude Code、OpenAI Codex、Cursor 的 Agent 模式,Claude Agent SDK 是把 Claude Code 这个 harness 以库的形式开放。组成部分包括:Agent 循环;工具、MCP、Skill 的注册与按需加载;上下文组装与压缩;沙箱与权限控制;会话持久化与中断恢复;hooks 与可观测。

</details>

6. **面试题**:「你用过 LangChain 吗?它底层是怎么实现的?有什么局限?什么情况下你不会用它?」

<details><summary>答案</summary>

参考要点:先说用过,并说明用的是 1.x 的 `create_agent` 和底层的 LangGraph。实现:`create_agent` 构建一张 LangGraph 图,模型节点和工具节点之间用条件边形成循环,middleware 是插在模型和工具调用前后的钩子;工具 schema 由 pydantic 从函数签名生成;LangGraph 按超步执行,每步用 reducer 合并状态、写 checkpoint。可以补一句「我自己手写过同样结构的循环」。局限:抽象泄漏(框架注入的提示词看不见)、版本变化快(举 `create_react_agent` 弃用的例子)、兼容厂商的结构化输出要指定方式、调试依赖它自家的工具、多一层开销。不用的场景:简单的一问一答或固定两三步的流程;对延迟和 token 极度敏感;团队不熟又赶工期;框架抽象和业务模型不匹配。最后给出原则:先手写最小版本,出现明确需要持久化、人工介入、复杂分支的需求时再引入。

</details>

## 明天预告

Day 28 · W4 复习 + 小项目:MCP + LangGraph 的工单分流 Agent。把这一周的东西拼起来:工单进来先分类,查知识库,通过 MCP 调 CloudLedger 的业务工具,起草带依据的回复,遇到退款就停下来等审批。这是毕业项目 SupportPilot 的第一个可运行版本,W5 的评测也会直接拿它开刀。
