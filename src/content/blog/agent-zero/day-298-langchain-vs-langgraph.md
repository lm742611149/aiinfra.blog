---
title: 'Day 298 · LangChain 和 LangGraph 是什么关系'
description: '两个名字,五六个包,网上教程新旧混着写。今天不画图,先把定位弄清:用依赖关系证明 LangChain 1.x 建在 LangGraph 上,用同一个账单任务把手写循环和 create_agent 各写一遍,再打开 create_agent 返回的东西看里面的图,最后实测一个手写版和框架版行为不一样的地方:工具抛异常。'
pubDate: 2026-10-23
regime: none
tags: ['langchain', 'langgraph', 'create-agent', 'orchestration', 'agent-zero']
series: 'agent-zero'
day: 298
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 297](/blog/agent-zero/day-297-skills-2/) 在自己的循环里实现了 Skills 加载器:三个按需取内容的工具、路径防护、不经 shell、环境变量过滤,还量了「目录」和「全文塞进去」差多少 token。那一课里所有的循环都是我们自己写的 `run_agent`,它来自 [Day 166](/blog/agent-zero/day-166-agent-min/) 到 [Day 170](/blog/agent-zero/day-170-agent-full/):一个 `while`、一个工具注册表、一个步数上限。

第五部分接下来要讲编排框架。你一旦去搜「Agent 框架」,铺天盖地的是两个名字:LangChain 和 LangGraph。教程新旧混在一起,同一个函数在不同文章里导入路径不同,面试也爱问「它们什么关系」。今天先不写图,用实测把关系讲清楚,明天开始才进 LangGraph 的第一个脚本。

## 今天要解决的问题

学完今天,你要能做到:

1. 说清 `langchain-core`、`langgraph`、`langchain`、`langchain-openai` 四个包各管什么,并用代码证明谁依赖谁。
2. 用同一份账单查询函数,分别写出手写版和 `create_agent` 版的 Agent,说出两版逐项对应在哪。
3. 打开 `create_agent` 返回的对象,看到它就是一张 LangGraph 图,并和手写的 `while` 循环对上。
4. 认出 2025 年以前教程里的 `create_react_agent`,把它迁到 `create_agent`。
5. 说得出框架版和手写版有哪些行为不一样(今天实测一个:工具抛异常),以及什么时候用哪一种。

预计用时 2 小时。前置:[Day 166](/blog/agent-zero/day-166-agent-min/) 到 [Day 170](/blog/agent-zero/day-170-agent-full/)(手写循环和 `ToolRegistry`)、[Day 297](/blog/agent-zero/day-297-skills-2/)(`part03/agent_loop.py` 的用法)、[Day 280](/blog/agent-zero/day-280-mcp-seed/)(CloudLedger 业务库)。实跑花费约 ¥0.05。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `lc_agent.py` 里创建 `ChatOpenAI` 和 `create_agent` 的那几行,再说出 `get_graph()` 里四个节点各是什么;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

所有命令在 `agent-zero-lab/` 根目录跑(我的是 `/Users/你/agent-zero-lab`)。先装依赖。**这一步会装很多包**,别在意数量,下面马上用 `uv tree` 看它们是什么关系:

```bash
cd /Users/你/agent-zero-lab
uv run python cloudledger/seed.py
uv add langchain langchain-openai
```

<div class="line-notes">

- `uv run python cloudledger/seed.py` 重置业务库,今天的查询都读它。
- `uv add langchain langchain-openai` 装两个包,`uv` 自动把它们的依赖(包括 `langgraph`)一起装上,并写进 `pyproject.toml` 和 `uv.lock`(和 `npm install` 写 `package.json` 与 lock 文件一回事)。我装到的是 `langchain 1.4.7`、`langchain-openai 1.7.2`,是 2026 年 10 月 21 日前后 PyPI 上的最新版,你装到的更新也没关系,这一课用到的接口 1.x 里是稳定的。

</div>

## 两个名字,是同一家公司的两个库

LangChain 是 2022 年底出来的大模型应用框架。早期它以「链」(chain)为中心,把模型调用、提示词模板、检索器一环扣一环串起来,封装了大量现成的模块。2023 年它火得一塌糊涂,也因为抽象层太多、版本变动太快被骂得很惨,「LangChain 太重」至今是很多工程师的第一印象。

LangGraph 是同一家公司 2024 年初推出的另一个库,专门解决「多步、有状态、可能循环、可能要停下来等人、断了要能接着跑」的流程。它的思路是把控制流画成一张图:每一步是一个节点,跳转是边。它不依赖 LangChain 的链,下一节会用代码证明这一点。

两个库后来在同一天长到了 1.0。我从 PyPI 的发布记录里查了几个包的时间(2026 年 10 月查,日期是上传到 PyPI 的日期,官方宣布可能晚几天):

| 包 | 第一次上 PyPI | 1.0.0 | 我装到的版本 |
| --- | --- | --- | --- |
| `langchain` | 2022-10-25(0.0.1) | 2025-10-17 | 1.4.7 |
| `langgraph` | 2024-01-08(能看到的最早是 0.0.8) | 2025-10-17 | 1.2.16 |
| `langchain-core` | 2023-11-20(0.0.1) | 2025-10-17 | 1.7.0 |
| `langchain-openai` | 2024-01-05(0.0.1) | 2025-10-17 | 1.7.2 |

四个包 1.0.0 的上传日期是同一天,这不是巧合。1.0 做的最大一件事,就是**重新划分了谁管什么**。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="包的分层:你的代码在最上面,往下依次是 langchain(create_agent、middleware)、langgraph(StateGraph、checkpoint、stream)、langchain-core(消息类型、工具、模型接口);langchain-openai 通过 langchain-core 的接口接入 openai SDK">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <rect x="20" y="16" width="400" height="40" rx="6" fill="none" stroke="var(--rule)" stroke-dasharray="5 3"/>
  <text x="34" y="41" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">你的代码:工具函数、system prompt、业务逻辑</text>
  <rect x="20" y="70" width="400" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="34" y="94" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">langchain 1.x</text>
  <text x="34" y="113" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">create_agent、middleware:预先搭好的 Agent</text>
  <rect x="20" y="140" width="400" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="34" y="164" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">langgraph 1.x</text>
  <text x="34" y="183" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">StateGraph、节点和边、checkpoint、stream:运行时</text>
  <rect x="20" y="210" width="400" height="56" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="34" y="234" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">langchain-core 1.x</text>
  <text x="34" y="253" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">消息类型、@tool、模型接口:共用的积木</text>
  <rect x="450" y="210" width="170" height="56" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="535" y="234" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">langchain-openai</text>
  <text x="535" y="253" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">ChatOpenAI → openai SDK</text>
  <line x1="420" y1="238" x2="450" y2="238" stroke="var(--ink-soft)"/>
  <line x1="220" y1="126" x2="220" y2="140" stroke="var(--ink-soft)"/>
  <line x1="220" y1="196" x2="220" y2="210" stroke="var(--ink-soft)"/>
  <line x1="220" y1="56" x2="220" y2="70" stroke="var(--ink-soft)"/>
  <text x="20" y="290" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">箭头是「依赖」:上面的包用下面的包;langgraph 不依赖 langchain</text>
</svg>
<figcaption>2026 年 10 月的分层。琥珀色是共用的积木和模型接入,蓝色是编排的两层。图里的依赖方向下一节用代码验证。</figcaption>
</figure>

## 用依赖关系证明谁建在谁上面

网上的说法很多,我更信包管理器。`uv tree` 能列出一个包直接依赖哪些包:

```bash
uv tree --package langchain --depth 1
uv tree --package langgraph --depth 1
uv tree --package langchain-openai --depth 1
```

<div class="line-notes">

- `uv tree --package langchain --depth 1` 只看 `langchain` 这一个包,`--depth 1` 只展开一层(直接依赖),不往下递归。
- `uv tree --package langgraph --depth 1` 同样看 `langgraph`。
- `uv tree --package langchain-openai --depth 1` 再看模型接入包。

</div>

```text
langchain v1.4.7
├── langchain-core v1.7.0
├── langgraph v1.2.16
└── pydantic v2.14.1

langgraph v1.2.16
├── langchain-core v1.7.0
├── langgraph-checkpoint v4.3.0
├── langgraph-prebuilt v1.1.1
├── langgraph-sdk v0.4.8
├── pydantic v2.14.1
└── xxhash v4.0.2

langchain-openai v1.7.2
├── certifi v2026.10.19
├── langchain-core v1.7.0
├── openai v3.37.0
└── tiktoken v0.14.0
```

三棵树读出四件事:

1. **`langchain` 直接依赖 `langgraph`。** 装 LangChain 1.x 就一定装上 LangGraph,`create_agent` 这类高层函数跑的就是它。这是「LangChain 1.x 建在 LangGraph 上」最硬的证据,比任何一篇文章里的说法都硬。
2. **`langgraph` 的依赖里没有 `langchain`。** 只有 `langchain-core`。所以 LangGraph 可以**单独用**,不用 LangChain 的任何高层封装,官方文档也明确写了「you don't need to use LangChain to use LangGraph」。
3. **`langchain-core` 是两边共用的底层。** 消息类型(`HumanMessage`、`AIMessage`、`ToolMessage`)、`@tool` 装饰器、模型的统一接口都在这里。两个库的节点之间传的消息是同一种东西,所以能直接配合。
4. **`langchain-openai` 把 OpenAI SDK 接进这套积木。** 它依赖的是 `langchain-core` 和 `openai`,不依赖 `langgraph`。DeepSeek、通义这类走 OpenAI 兼容协议的模型,都可以通过它接入,下面就用它连 DeepSeek。

每个包的分工整理一下,再多说两个你会遇到的名字:

| 包 | 管什么 |
| --- | --- |
| `langchain-core` | 共用的积木:消息类型、`@tool`、模型和工具的统一接口、`Runnable` |
| `langgraph` | 编排运行时:状态图(节点、边、条件边)、checkpoint 持久化、人工中断、流式输出、时间旅行 |
| `langchain` | 高层:`create_agent`,以及可插拔的中间件(middleware),比如压缩历史、人工审批、工具调用次数上限 |
| `langchain-openai` | 把 OpenAI 或兼容 OpenAI 的模型接进来:`ChatOpenAI`、`OpenAIEmbeddings` |
| `langchain-classic` | 1.0 时把旧的链(chain)、检索器、`langchain-community` 里的老东西搬到这里,让核心包保持精简(官方发布说明里的说法) |
| `deepagents` | 官方的另一个高层:带规划、子 Agent、文件系统工具的 agent harness,同样建在 LangGraph 上。2026 年 10 月 PyPI 最新是 0.7.30 |

另外还有 LangSmith,是 LangChain 公司的观测和评测平台(闭源的产品),它的 Python SDK 会作为依赖被装进来,第六部分讲追踪时会碰到它。

**所以今天的结论是一句话:LangGraph 是底下的运行时,LangChain 1.x 是上面预先搭好的一套 Agent,两者不是二选一。** 如果你读到过说它们是两条互相独立的路的文章,多半写于 1.0 之前:那时 LangChain 自己有一套老的 Agent 实现,和 LangGraph 各走各的;1.0 把高层的 `create_agent` 改成跑在 LangGraph 上,才变成上面这个分层。

## 同一个任务写两遍

光看依赖树还是抽象。拿一个具体任务,手写一遍,再用 `create_agent` 写一遍,看两边逐项对应。任务和 [Day 297](/blog/agent-zero/day-297-skills-2/) 的重复扣款一样:客户 C007 说 10 月 8 号被扣了两次款,让 Agent 去查。

先写两个只读的查询函数,**两版共用**,谁也不用改函数本身:

```python
# agent-zero-lab/part05/lg/billing_tools.py
"""两个只读的账单查询函数。今天手写版和 create_agent 版共用这一份,谁也不用改函数本身。"""
import os
import sqlite3
from pathlib import Path
from typing import Annotated

DB = Path(os.environ.get("CLOUDLEDGER_DB", Path(__file__).resolve().parents[2] / "cloudledger" / "cloudledger.db"))


def _rows(sql: str, params: tuple[object, ...]) -> list[sqlite3.Row]:
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)  # 只读打开
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def list_invoices(
    customer_id: Annotated[str, "客户编号,例如 C007"],
    limit: Annotated[int, "最多返回几张,默认 5"] = 5,
) -> list[dict[str, object]]:
    """列出某个客户最近的发票,按开票日期从新到旧。"""
    rows = _rows(
        "SELECT id, amount_cents, status, issued_at FROM invoices WHERE customer_id = ? "
        "ORDER BY issued_at DESC, id LIMIT ?", (customer_id, limit))
    return [{"id": r["id"], "amount_yuan": r["amount_cents"] / 100, "status": r["status"], "issued_at": r["issued_at"]}
            for r in rows]


def find_duplicates(customer_id: Annotated[str, "客户编号,例如 C007"]) -> dict[str, object]:
    """找出某个客户同一天、同金额的已付发票,这是疑似重复扣款。没找到时 duplicates 是空列表。"""
    rows = _rows(
        "SELECT issued_at, amount_cents, GROUP_CONCAT(id, ',') AS ids FROM invoices "
        "WHERE customer_id = ? AND status = 'paid' GROUP BY issued_at, amount_cents HAVING COUNT(*) > 1",
        (customer_id,))
    return {"customer_id": customer_id,
            "duplicates": [{"issued_at": r["issued_at"], "amount_yuan": r["amount_cents"] / 100,
                            "invoice_ids": r["ids"].split(",")} for r in rows]}
```

<div class="line-notes">

- `DB = Path(os.environ.get("CLOUDLEDGER_DB", Path(__file__).resolve().parents[2] / "cloudledger" / "cloudledger.db"))` 这个文件在 `part05/lg/` 下,`parents[0]` 是 `lg`,`[1]` 是 `part05`,`[2]` 是仓库根,再拼 `cloudledger/cloudledger.db`。设了环境变量 `CLOUDLEDGER_DB` 就用它。
- `def _rows(sql: str, params: tuple[object, ...]) -> list[sqlite3.Row]:` 一个小帮手:执行一条查询,返回所有行。下划线开头表示「模块内部用的,别从外面导入」。
- `conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)  # 只读打开` `mode=ro` 保证这两个工具改不了库。工具给模型用,默认只读最稳妥。
- `conn.row_factory = sqlite3.Row` 查出来的行能用列名取值。
- `finally:` 不管查询成功还是抛异常,`finally` 里的 `conn.close()` 都会执行。
- `customer_id: Annotated[str, "客户编号,例如 C007"],` 类型是 `str`,后面那句话是给模型看的参数说明。手写注册表和 LangChain 都能读到它,**两边的参数说明来自同一处**。
- `limit: Annotated[int, "最多返回几张,默认 5"] = 5,` 有默认值的参数不在 `required` 里,模型可以不填。
- `"""列出某个客户最近的发票,按开票日期从新到旧。"""` 函数的文档字符串,就是发给模型的工具描述。
- `"ORDER BY issued_at DESC, id LIMIT ?", (customer_id, limit))` 同一天的两张发票再按 `id` 排,顺序固定。`?` 占位符配元组,[Day 92](/blog/agent-zero/day-092-python-sqlite-1/) 讲过。
- `return [{"id": r["id"], "amount_yuan": r["amount_cents"] / 100,` 分换成元。C007 查到 5 张,最新两张是 `INV-2026-0026` 和 `INV-2026-0123`,都是 2392.0 元、`2026-10-08`。
- `def find_duplicates(customer_id: Annotated[str, "客户编号,例如 C007"]) -> dict[str, object]:` 和 Day 296 的 `find_duplicates.py` 是同一个查询,这次写成能被导入的函数。
- `"WHERE customer_id = ? AND status = 'paid' GROUP BY issued_at, amount_cents HAVING COUNT(*) > 1",` 同一天、同金额、已付款,出现不止一次的分组。
- `"invoice_ids": r["ids"].split(",")` `GROUP_CONCAT` 拼出来的 `"INV-2026-0026,INV-2026-0123"` 切回列表。

</div>

### 手写版

用 Day 168 的注册表和 Day 170 的循环。整个文件只有登记工具这两行:

```python
# agent-zero-lab/part05/lg/hand_agent.py
"""手写版:用 Day 168–170 的注册表和循环。用法:uv run python -m part05.lg.hand_agent"""
from part03.agent_loop import ToolRegistry, run_agent
from part05.lg.billing_tools import find_duplicates, list_invoices

SYSTEM = "你是云簿 CloudLedger 的客服助手。查数据要用工具,回答简短,金额写到元。"
QUESTION = "客户 C007 说 10 月 8 号被扣了两次款,帮忙看看。"

reg = ToolRegistry()
reg.tool(find_duplicates)  # 装饰器的本质就是这个调用:@reg.tool 等于 reg.tool(函数)
reg.tool(list_invoices)

if __name__ == "__main__":
    answer, llm = run_agent(reg, SYSTEM, QUESTION)
    print(answer)
    print(llm.ledger)
```

<div class="line-notes">

- `from part03.agent_loop import ToolRegistry, run_agent` Day 168 到 170 建的注册表和循环,Day 297 已经用过。
- `SYSTEM = "你是云簿 CloudLedger 的客服助手。查数据要用工具,回答简短,金额写到元。"` 系统提示词。下面的 LangChain 版会原样导入这一句,两边同一个。
- `QUESTION = "客户 C007 说 10 月 8 号被扣了两次款,帮忙看看。"` 同样,两版问同一个问题。
- `reg = ToolRegistry()` 空注册表。
- `reg.tool(find_duplicates)  # 装饰器的本质就是这个调用:@reg.tool 等于 reg.tool(函数)` `@reg.tool` 写在函数上面,和直接把函数传给 `reg.tool(...)` 是一回事。这里函数定义在别的文件里,所以用调用的写法。
- `answer, llm = run_agent(reg, SYSTEM, QUESTION)` 跑完整的循环,返回回答和带账本的 `LLMClient`。

</div>

```bash
uv run python -m part05.lg.hand_agent
```

```text
[step 1] 输入 436 tok | 输出 91 tok
    调用 find_duplicates({"customer_id": "C007"}) -> 返回 142 字符
    调用 list_invoices({"customer_id": "C007", "limit": 10}) -> 返回 465 字符
[step 2] 输入 819 tok | 输出 170 tok
确认了，客户说得对：

**2026 年 10 月 8 日有两笔已付发票，金额都是 2392 元**
- INV-2026-0026（2392 元，已付）
- INV-2026-0123（2392 元，已付）

同一天、同金额，属于疑似重复扣款，需退还 2392 元。

另外说明一下：该客户每月一张 2392 元的发票（7/9、8/8、9/7 各一张，均正常），10 月这笔属于多收的一次。建议先跟客户确认，再走退款流程，并核对 INV-2026-0123 这张是怎么产生的（重复开票还是重试扣款）。需要我发起退款吗？
2 次调用 | 输入 1255 / 输出 261 tokens | 约 ¥0.0028
```

两步:第一步模型一口气调了两个工具(`find_duplicates` 和 `list_invoices`,这叫并行工具调用),第二步看着两份结果写回答。第一步输入 436 个 token,第二步 819 个,因为历史里多了两份工具结果。

### create_agent 版

同样的函数、同样的问题、同样的系统提示词,换成 LangChain:

```python
# agent-zero-lab/part05/lg/lc_agent.py
"""LangChain 版:同样两个函数、同样一句问题,只换成 create_agent。用法:uv run python -m part05.lg.lc_agent"""
import os

from dotenv import load_dotenv
from langchain.agents import create_agent
from langchain_core.messages import AIMessage
from langchain_openai import ChatOpenAI
from pydantic import SecretStr

from part05.lg.billing_tools import find_duplicates, list_invoices
from part05.lg.hand_agent import QUESTION, SYSTEM

load_dotenv()

model = ChatOpenAI(
    model=os.environ["LLM_MODEL"],
    base_url=os.environ["LLM_BASE_URL"],
    api_key=SecretStr(os.environ["LLM_API_KEY"]),  # 类型上要求 SecretStr:包一层,日志里不会打印出明文
    extra_body={"thinking": {"type": "disabled"}},  # 和 .env 里的 LLM_EXTRA_BODY 同一个意思:关思考
)
agent = create_agent(model, tools=[find_duplicates, list_invoices], system_prompt=SYSTEM)

if __name__ == "__main__":
    result = agent.invoke({"messages": [{"role": "user", "content": QUESTION}]})
    for m in result["messages"]:
        calls = [c["name"] for c in getattr(m, "tool_calls", [])]
        print(f"{type(m).__name__:<13} {calls or ''} {str(m.content)[:60]!r}")
    usage = [m.usage_metadata for m in result["messages"] if isinstance(m, AIMessage) and m.usage_metadata]
    print(f"{len(usage)} 次模型调用 | 输入 {sum(u['input_tokens'] for u in usage)} / 输出 {sum(u['output_tokens'] for u in usage)} tokens")
    print(result["messages"][-1].content)
```

<div class="line-notes">

- `from dotenv import load_dotenv` 读 `.env`,和前面所有天一样。
- `from langchain.agents import create_agent` 1.x 里创建 Agent 的入口函数。旧教程里的 `langgraph.prebuilt.create_react_agent` 已经被它取代,后面单独讲。
- `from langchain_core.messages import AIMessage` 消息类型来自 `langchain-core`,下面要用它判断「这是不是模型发的消息」。
- `from langchain_openai import ChatOpenAI` 模型接入。名字叫 OpenAI,但它走的是 OpenAI 兼容协议,所以能连 DeepSeek。
- `from pydantic import SecretStr` 密钥专用的字符串类型,打印出来是 `**********`,不会把 key 泄露到日志里。
- `from part05.lg.hand_agent import QUESTION, SYSTEM` 直接导入手写版的问题和系统提示词,保证两边完全一样。
- `load_dotenv()` 把 `.env` 里的变量放进环境。
- `model = ChatOpenAI(` 创建一个模型对象。
- `model=os.environ["LLM_MODEL"],` 模型名,`.env` 里是 `deepseek-flash`。
- `base_url=os.environ["LLM_BASE_URL"],` 接口地址,`https://api.deepseek.com`。
- `api_key=SecretStr(os.environ["LLM_API_KEY"]),` 类型检查器要求这里是 `SecretStr`,包一层。
- `extra_body={"thinking": {"type": "disabled"}},` 和 `.env` 里的 `LLM_EXTRA_BODY` 是同一个意思:关掉思考。`extra_body` 里的内容会原样附加到请求体上,这样不用等 `langchain-openai` 为 DeepSeek 的专有参数单独加字段。
- `agent = create_agent(model, tools=[find_duplicates, list_invoices], system_prompt=SYSTEM)` **整个 Agent 就这一行。** 三个参数:模型、工具列表(直接放普通函数)、系统提示词。函数的类型标注、`Annotated` 说明和文档字符串会被自动变成工具定义。
- `result = agent.invoke({"messages": [{"role": "user", "content": QUESTION}]})` 调用的时候传一个字典,键是 `messages`,值是消息列表。写成 `{"role": "user", "content": ...}` 的字典它会自动转成 `HumanMessage`。返回值同样是一个带 `messages` 的字典,里面是**整个对话**。
- `for m in result["messages"]:` 一条一条看消息。
- `calls = [c["name"] for c in getattr(m, "tool_calls", [])]` `HumanMessage` 没有 `tool_calls` 这个属性,`getattr(对象, 名字, 默认值)` 取不到就用默认的空列表,不会报错。
- `print(f"{type(m).__name__:<13} {calls or ''} {str(m.content)[:60]!r}")` 打印消息的类名、它发起的工具调用、内容的前 60 个字符。`!r` 是带引号的原样显示。
- `usage = [m.usage_metadata for m in result["messages"] if isinstance(m, AIMessage) and m.usage_metadata]` 只有模型发的消息带用量。把每次模型调用的用量收集起来。
- `print(f"{len(usage)} 次模型调用 | 输入 {sum(u['input_tokens'] for u in usage)} / 输出 {sum(u['output_tokens'] for u in usage)} tokens")` 累加得到整次任务的 token。

</div>

```bash
uv run python -m part05.lg.lc_agent
```

```text
HumanMessage   '客户 C007 说 10 月 8 号被扣了两次款,帮忙看看。'
AIMessage     ['find_duplicates', 'list_invoices'] '我来帮你查一下 C007 的情况。'
ToolMessage    '{"customer_id": "C007", "duplicates": [{"issued_at": "2026-1'
ToolMessage    '[{"id": "INV-2026-0026", "amount_yuan": 2392.0, "status": "p'
AIMessage      '确实有重复扣款：\n\n- 2026-10-08 有两张已付发票，金额都是 **2,392 元**\n  - INV-2026'
2 次模型调用 | 输入 1272 / 输出 211 tokens
确实有重复扣款：

- 2026-10-08 有两张已付发票，金额都是 **2,392 元**
  - INV-2026-0026
  - INV-2026-0123

客户反映的情况属实，多扣了 2,392 元。另外这个客户每月都有一张 2,392 元的扣款（7、8、9 月各一张），属于正常续费，10 月这两张里应只保留一张。

需要我帮你发起退款流程吗？
```

对着手写版看,几乎一样:第一步调两个工具,第二步回答,模型调用 2 次。LangChain 这次输入 1272、输出 211,手写那次是 1255 和 261,差别来自两次回答的措辞不同,第二步要带上的历史长度不同。**同样的函数,生成给模型看的工具定义也几乎一样**,我把两边的定义打印出来对比过:

```python
# agent-zero-lab/part05/lg/schema_diff.py
"""同一个函数,手写注册表和 LangChain 各自生成的工具定义,发给模型的字节数差多少。"""
import json

from langchain_core.tools import tool
from langchain_core.utils.function_calling import convert_to_openai_tool

from part05.lg.billing_tools import find_duplicates
from part05.lg.hand_agent import reg

mine = next(s for s in reg.schemas if s["function"]["name"] == "find_duplicates")
theirs = convert_to_openai_tool(tool(find_duplicates))
for label, s in (("手写注册表", mine), ("LangChain", theirs)):
    text = json.dumps(s, ensure_ascii=False)
    print(f"{label}:{len(text)} 字符\n  {text}")
```

<div class="line-notes">

- `from langchain_core.tools import tool` LangChain 的 `@tool`,这里当普通函数用:`tool(find_duplicates)` 把函数包成一个 LangChain 工具对象。
- `from langchain_core.utils.function_calling import convert_to_openai_tool` 把 LangChain 工具转成 OpenAI 格式的工具定义,也就是真正发给模型的那份 JSON。
- `mine = next(s for s in reg.schemas if s["function"]["name"] == "find_duplicates")` 从手写注册表的 schema 列表里找到同一个函数。`next(生成器)` 取第一个符合的。
- `theirs = convert_to_openai_tool(tool(find_duplicates))` 同一个函数,LangChain 生成的。
- `text = json.dumps(s, ensure_ascii=False)` 序列化成字符串,量字符数。

</div>

```text
手写注册表:274 字符
  {"type": "function", "function": {"name": "find_duplicates", "description": "找出某个客户同一天、同金额的已付发票,这是疑似重复扣款。没找到时 duplicates 是空列表。", "parameters": {"type": "object", "properties": {"customer_id": {"type": "string", "description": "客户编号,例如 C007"}}, "required": ["customer_id"]}}}
LangChain:274 字符
  {"type": "function", "function": {"name": "find_duplicates", "description": "找出某个客户同一天、同金额的已付发票,这是疑似重复扣款。没找到时 duplicates 是空列表。", "parameters": {"properties": {"customer_id": {"description": "客户编号,例如 C007", "type": "string"}}, "required": ["customer_id"], "type": "object"}}}
```

两边都是 274 个字符,内容一样,只有 JSON 里键的顺序不同。所以框架没有对你的工具「加料」,真正的差别不在这里。

对应关系整理成表:

| 要做的事 | 手写版(Day 168–170) | `create_agent` 版 |
| --- | --- | --- |
| 登记工具 | `reg.tool(函数)` | `tools=[函数]` |
| 生成工具定义 | 注册表读签名和 `Annotated` | 自动,结果等价 |
| 系统提示词 | `run_agent(reg, SYSTEM, ...)` | `system_prompt=SYSTEM` |
| 消息的样子 | 字典 `{"role": ..., "content": ...}` | 消息对象 `HumanMessage` / `AIMessage` / `ToolMessage` |
| 循环 | `run_agent` 里的 `for` | 一张图,下一节看 |
| 步数上限 | `max_steps` | LangGraph 的递归上限(默认值我今天没有核实) |
| 接模型 | 自己的 `LLMClient` | `ChatOpenAI`,来自 `langchain-openai` |

## 打开 create_agent 看里面

`create_agent` 返回的是个什么东西?打印出来:

```python
# agent-zero-lab/part05/lg/peek_graph.py
"""打开 create_agent 返回的东西看一眼:它是一张 LangGraph 图。用法:uv run python -m part05.lg.peek_graph"""
from part05.lg.lc_agent import agent

print("类型:", f"{type(agent).__module__}.{type(agent).__name__}")
graph = agent.get_graph()
print("节点:", list(graph.nodes))
for e in graph.edges:
    print(f"  {e.source} -> {e.target}" + ("  (条件边)" if e.conditional else ""))
print(graph.draw_mermaid())
```

<div class="line-notes">

- `from part05.lg.lc_agent import agent` 直接用上一节建好的 `agent`。导入时不会重新调模型,因为问问题的部分在 `if __name__ == "__main__":` 里面。
- `print("类型:", f"{type(agent).__module__}.{type(agent).__name__}")` `type(agent)` 是它的类,`__module__` 是类所在的模块,`__name__` 是类名。
- `graph = agent.get_graph()` 取出图的结构,不是执行,只是看它长什么样。
- `print("节点:", list(graph.nodes))` 列出所有节点的名字。
- `for e in graph.edges:` 列出每一条边。
- `print(f"  {e.source} -> {e.target}" + ("  (条件边)" if e.conditional else ""))` 起点、终点,以及是不是条件边。条件边的意思是「走不走这条,要看当时的状态」。
- `print(graph.draw_mermaid())` 把图转成 Mermaid 文本(一种用文字画流程图的语言),贴到支持 Mermaid 的编辑器里就能看到图。

</div>

```bash
uv run python -m part05.lg.peek_graph
```

```text
类型: langgraph.graph.state.CompiledStateGraph
节点: ['__start__', 'model', 'tools', '__end__']
  __start__ -> model
  model -> __end__  (条件边)
  model -> tools  (条件边)
  tools -> model  (条件边)
---
config:
  flowchart:
    curve: linear
---
graph TD;
	__start__([<p>__start__</p>]):::first
	model(model)
	tools(tools)
	__end__([<p>__end__</p>]):::last
	__start__ --> model;
	model -.-> __end__;
	model -.-> tools;
	tools -.-> model;
	classDef default fill:#f2f0ff,line-height:1.2
	classDef first fill-opacity:0
	classDef last fill:#bfb6fc
```

三个发现。

**一,它是 `langgraph.graph.state.CompiledStateGraph`。** `create_agent` 在 `langchain` 包里,返回的却是 `langgraph` 里的类。这和前面依赖树的结论完全一致:LangChain 的高层 Agent,本体是一张编译好的 LangGraph 图。

**二,图里只有四个节点,两个是首尾。** `__start__` 和 `__end__` 是 LangGraph 里表示入口和出口的特殊节点,真正干活的只有两个:`model`(调一次模型)和 `tools`(执行模型要求的工具)。

**三,边的走法就是你手写的循环。** `__start__ → model`;`model → tools` 或 `model → __end__`,看模型这一步有没有要求调工具;`tools → model`,工具跑完回去让模型接着看。输出里虚线(`-.->`)是条件边。把它翻成你写过的代码:

```text
手写版                                  图里的位置
for step in range(max_steps):          整个 model ↔ tools 的循环
    r = llm.chat(messages, tools=...)  model 节点
    if not tool_calls: return          model → __end__ 这条边
    for tc in tool_calls:              tools 节点
        out = registry.call(...)
        messages.append(tool_msg)      tools → model 这条边
```

**所以 `create_agent` 干的事,你已经亲手写过一遍。** 它多出来的东西在别处:可以往这个循环的各个位置插中间件、能存档、能中途暂停等人、能流式吐出每一步。这些是 LangGraph 运行时给的,不是 `create_agent` 自己的本事,往后十几天会一样一样拆开讲。

## 旧教程里的 create_react_agent

网上 2024 到 2025 年的大量教程写的是:

```python
from langgraph.prebuilt import create_react_agent
agent = create_react_agent(model, tools, prompt="...")
```

在 1.x 里这个函数还在,还能跑,但会被提示换掉:

```python
# agent-zero-lab/part05/lg/old_react.py
"""旧教程里的写法:langgraph.prebuilt.create_react_agent。看看 2026 年 10 月它还在不在、会说什么。"""
import warnings

with warnings.catch_warnings(record=True) as caught:
    warnings.simplefilter("always")
    from langgraph.prebuilt import create_react_agent  # noqa: F401  旧写法
    from part05.lg.lc_agent import model
    from part05.lg.billing_tools import find_duplicates

    old = create_react_agent(model, [find_duplicates])

print("还能 import,也能建出来:", type(old).__name__)
for w in caught:
    print(f"{w.category.__name__}: {w.message}")
```

<div class="line-notes">

- `import warnings` Python 标准库里管警告的模块。
- `with warnings.catch_warnings(record=True) as caught:` 临时把这一段代码里发出的警告**记录**下来,放进 `caught` 列表,不直接打印到屏幕。
- `warnings.simplefilter("always")` 不管同一个警告发过没有,每次都记录。默认情况下同一处的警告只显示一次。
- `from langgraph.prebuilt import create_react_agent  # noqa: F401  旧写法` 旧导入。`noqa: F401` 是告诉 Ruff「这行导入看着没用但我是故意的」。
- `from part05.lg.lc_agent import model` 复用上一节的模型对象。
- `old = create_react_agent(model, [find_duplicates])` 旧函数能建出同样的图,警告在这一行被触发。
- `print("还能 import,也能建出来:", type(old).__name__)` 看它建出来的是什么:`CompiledStateGraph`,和 `create_agent` 返回的是同一种东西。
- `for w in caught:` 逐条打印记录下来的警告。
- `print(f"{w.category.__name__}: {w.message}")` 警告的类别和内容。

</div>

```bash
uv run python -m part05.lg.old_react
```

```text
还能 import,也能建出来: CompiledStateGraph
LangGraphDeprecatedSinceV10: create_react_agent has been moved to `langchain.agents`. Please update your import to `from langchain.agents import create_agent`. Deprecated in LangGraph V1.0 to be removed in V2.0.
```

警告原文说得很清楚:`create_react_agent` 已经搬到 `langchain.agents`,请改用 `create_agent`,在 LangGraph V1.0 里弃用,**计划在 V2.0 移除**。两个函数建出来的都是 `CompiledStateGraph`,所以迁移几乎只是改导入和一个参数名。参数名的差别我用 `inspect.signature` 看过:旧的叫 `prompt`,新的叫 `system_prompt`;新函数还多了 `middleware`、`checkpointer`、`interrupt_before` 这些参数,是 1.x 加的能力。练习 3 会让你做一次迁移。

读 2025 年以前的资料,碰到下面这些要有数:`create_react_agent`(现在是 `create_agent`)、`AgentExecutor`(老的 Agent 实现)、`LLMChain` 和各种 `Chain`(1.0 以后搬进了 `langchain-classic`)。它们不是错的,是旧的。

## 工具抛了异常,两边行为不一样

「框架版和手写版有哪些区别」这个问题,最好的回答是拿一个具体的东西测。我选工具抛异常:Day 189 以来我们反复在讲,工具里什么错都可能出,不能让一个错弄崩整个循环。Day 168 的注册表在 `call` 里接住所有异常,变成 `{"error": ...}` 交回模型。`create_agent` 呢?

```python
# agent-zero-lab/part05/lg/ex298_errors.py
"""练习 4:同一个会抛异常的工具,手写注册表和 create_agent 各怎么处理。用法:uv run python -m part05.lg.ex298_errors"""
from typing import Annotated

from langchain.agents import create_agent
from langchain.agents.middleware import ToolCallRequest, ToolErrorMiddleware

from part03.agent_loop import ToolRegistry, run_agent
from part05.lg.lc_agent import model

SYSTEM = "你是客服助手。要查数据就用工具。工具出错了就如实告诉用户。"
QUESTION = "帮我查一下 C007 的账单状态。"


def billing_status(customer_id: Annotated[str, "客户编号,例如 C007"]) -> str:
    """查询某个客户的账单状态。"""
    raise ConnectionError("billing 服务连不上(演示用)")


def describe(error: Exception, request: ToolCallRequest) -> str:
    """出错时交给模型的内容。只写异常的类型和工具名,不把原始异常信息整段交出去(里面可能有内部细节)。"""
    return f"工具 {request.tool_call['name']} 执行失败:{type(error).__name__}。可以如实告诉用户暂时查不到。"


print("== 手写注册表")
reg = ToolRegistry()
reg.tool(billing_status)
answer, _ = run_agent(reg, SYSTEM, QUESTION, max_steps=4)
print(answer[:80])

print("== create_agent 默认设置")
agent = create_agent(model, tools=[billing_status], system_prompt=SYSTEM)
try:
    agent.invoke({"messages": [{"role": "user", "content": QUESTION}]})
except Exception as e:  # noqa: BLE001  就是要看它抛的是什么
    print(f"整个 invoke 抛出了 {type(e).__name__}: {e}")

print("== create_agent + ToolErrorMiddleware")
safe = create_agent(model, tools=[billing_status], system_prompt=SYSTEM,
                    middleware=[ToolErrorMiddleware(on_error=describe)])
result = safe.invoke({"messages": [{"role": "user", "content": QUESTION}]})
print(result["messages"][-1].content[:80])
```

<div class="line-notes">

- `from langchain.agents.middleware import ToolCallRequest, ToolErrorMiddleware` 中间件是 1.x 的主要扩展方式。`ToolErrorMiddleware` 是官方自带的一个:把工具抛的异常变成交给模型的消息。
- `def billing_status(customer_id: Annotated[str, "客户编号,例如 C007"]) -> str:` 一个**永远抛异常**的工具,模拟下游服务挂了。
- `raise ConnectionError("billing 服务连不上(演示用)")` 抛出的是一个普通的连接错误,不是参数不对之类。
- `def describe(error: Exception, request: ToolCallRequest) -> str:` 出错时交给模型什么内容。`request.tool_call['name']` 是出错的工具名。
- `return f"工具 {request.tool_call['name']} 执行失败:{type(error).__name__}。可以如实告诉用户暂时查不到。"` 只交出异常的**类型**,不把原始异常信息整段交出去(里面可能有主机名、路径之类的内部细节)。官方文档也是这么建议的。还顺手告诉模型下一步怎么办,和 Day 182 的原则一样。
- `reg.tool(billing_status)` 手写注册表登记这个工具。
- `answer, _ = run_agent(reg, SYSTEM, QUESTION, max_steps=4)` 手写版跑一遍。
- `agent = create_agent(model, tools=[billing_status], system_prompt=SYSTEM)` 没有任何额外设置的 `create_agent`。
- `agent.invoke({"messages": [{"role": "user", "content": QUESTION}]})` 把调用包在 `try` 里,因为我们预期它会抛。
- `print(f"整个 invoke 抛出了 {type(e).__name__}: {e}")` 看它抛了什么。
- `middleware=[ToolErrorMiddleware(on_error=describe)])` 在 `create_agent` 里加一个中间件,`on_error` 传我们写的 `describe`。

</div>

```bash
uv run python -m part05.lg.ex298_errors
```

```text
== 手写注册表
[step 1] 输入 305 tok | 输出 40 tok
    调用 billing_status({"customer_id": "C007"}) -> 返回 48 字符
[step 2] 输入 373 tok | 输出 66 tok
抱歉，账单查询工具这次没能连上后端服务（报错：ConnectionError，billing 服务连不上），所以暂时无法获取 C007 的账单状态。

建议您稍
== create_agent 默认设置
整个 invoke 抛出了 ConnectionError: billing 服务连不上(演示用)
== create_agent + ToolErrorMiddleware
抱歉，查询工具出错了（连接错误），所以暂时没能查到 C007 的账单状态，不是这个客户没有记录，而是系统这边没连上。

你可以稍后再让我试一次，或者如果方便的话
```

三种情形看清楚:

- **手写注册表**:工具抛了异常,被 `call` 接住变成错误消息,模型照实告诉用户「连不上」,循环正常结束。
- **`create_agent` 默认设置**:**整个 `invoke` 抛出了 `ConnectionError`**,一个字的回答都没有。工具里的异常原样冒出来,把整次调用终止了。
- **加上 `ToolErrorMiddleware`**:行为和手写版一样,模型照实说「查询工具出错了(连接错误)」。

这不是框架的 bug,是默认策略不同:它把「工具执行时的异常」当作程序出错,要不要交给模型,由你选择(官方文档的设计是 opt-in,不返回内容的异常继续往外抛,这样内部异常不会被悄悄序列化给模型或用户)。**但它说明一件事:换了框架,你手写时顺手做对的那些防护,要一条一条核对它的默认值。** 框架替你省了循环,没有替你做生产级的防护。

## 三个层次,什么时候用哪个

到现在能看清三种写法了。我的看法:

| 写法 | 你写什么 | 适合 |
| --- | --- | --- |
| 手写循环(Day 166–170) | 循环、注册表、历史管理、防护全自己写 | 学习阶段;流程简单、要完全掌控;依赖越少越好的小服务 |
| `create_agent` | 模型、工具、提示词,再按需加中间件 | 标准的「模型调工具直到做完」;想要持久化、人工审批、流式、压缩历史这些现成能力,又不想自己写图 |
| 直接用 LangGraph 画图 | 状态、节点、边,每一步自己决定 | 流程不是简单的循环:要分支、并行、多个 Agent 配合、中途等人审批、失败后从某一步重来 |

我自己的建议是:**学 LangGraph,别从 LangChain 的高层封装学起。** 原因很具体:LangGraph 的概念很少(状态、节点、边),弄懂以后任何复杂流程你都能自己搭;而 `create_agent` 把这些全藏起来了,出了问题(比如今天看到的整个 `invoke` 被一个异常终止)你得知道里面是一张什么样的图才有办法下手。熟了之后再用 `create_agent` 省代码,心里有底。这也是后面十几天的安排:先用十一个不调模型的小脚本,一个零件一个零件认 LangGraph,最后才回到 Agent 循环和退款审批。

也别把「用框架」当目标。如果你的 Agent 就是一个循环加三个工具,手写 50 行比多装三十个上下的包(我数了一下,`langchain` 和 `langchain-openai` 带进来的、之前项目里没有的依赖大约是这个数)更好懂、更好调试。框架的价值在你需要它的那些能力的时候才出现。

## 零件对照表

| 文件 | 干什么 |
| --- | --- |
| `part05/lg/billing_tools.py` | 两个只读查询函数,手写版和 LangChain 版共用 |
| `part05/lg/hand_agent.py` | 手写版:注册表加 `run_agent`,导出 `SYSTEM` 和 `QUESTION` |
| `part05/lg/lc_agent.py` | `create_agent` 版,导出 `model` 和 `agent` |
| `part05/lg/schema_diff.py` | 对比两边生成的工具定义 |
| `part05/lg/peek_graph.py` | 打印 `create_agent` 返回的图的节点和边 |
| `part05/lg/old_react.py` | 触发旧函数的弃用警告 |
| `part05/lg/ex298_errors.py` | 工具抛异常时三种处理的对比 |

## 动手练习

**练习 1:不看文档,用代码证明谁依赖谁。** 用 `importlib.metadata` 读已安装包的依赖声明,打印 `langchain-core`、`langgraph`、`langchain`、`langchain-openai` 各自的直接依赖,并写两条断言:`langchain` 依赖 `langgraph`,`langgraph` 不依赖 `langchain`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex298_deps.py
"""练习 1:不看文档,用代码证明谁依赖谁。用法:uv run python -m part05.lg.ex298_deps"""
import re
from importlib.metadata import requires, version

PACKAGES = ["langchain-core", "langgraph", "langchain", "langchain-openai"]


def direct_deps(pkg: str) -> list[str]:
    """读已安装包的元数据里的依赖声明,只留名字(去掉版本要求和 extra 条件)。"""
    names = []
    for line in requires(pkg) or []:
        if "extra ==" in line:  # 可选依赖,不装 extra 就不会进来
            continue
        names.append(re.split(r"[ ;<>=!~\[(]", line, maxsplit=1)[0])
    return sorted(set(names))


for pkg in PACKAGES:
    print(f"{pkg} {version(pkg)} 直接依赖:{', '.join(direct_deps(pkg))}")

assert "langgraph" in direct_deps("langchain"), "langchain 应该依赖 langgraph"
assert "langchain" not in direct_deps("langgraph"), "langgraph 不应该依赖 langchain"
print("断言通过:langchain 依赖 langgraph,langgraph 不依赖 langchain")
```

<div class="line-notes">

- `from importlib.metadata import requires, version` Python 标准库,能读已安装包的元数据,不用额外装。`requires("包名")` 返回依赖声明的字符串列表,`version("包名")` 返回版本。
- `PACKAGES = ["langchain-core", "langgraph", "langchain", "langchain-openai"]` 按「从底到顶」的顺序排,打印出来像一张分层表。
- `def direct_deps(pkg: str) -> list[str]:` 返回直接依赖的名字列表。
- `for line in requires(pkg) or []:` `requires` 可能返回 `None`(包没有依赖),`or []` 变成空列表。每一行形如 `langgraph>=1.2.0,<1.3.0` 或 `grandalf>=0.8; extra == 'visualization'`。
- `if "extra ==" in line:  # 可选依赖,不装 extra 就不会进来` 带 `extra ==` 的是可选依赖,只有 `pip install 包[extra名]` 时才装,不算直接依赖。
- `names.append(re.split(r"[ ;<>=!~\[(]", line, maxsplit=1)[0])` 从这一行里只留下包名:遇到空格、分号、比较符号、方括号、左括号就切,取前面那一段。`maxsplit=1` 只切一次。
- `return sorted(set(names))` 去重、排序,打印出来整齐。
- `print(f"{pkg} {version(pkg)} 直接依赖:{', '.join(direct_deps(pkg))}")` 一行一个包。
- `assert "langgraph" in direct_deps("langchain"), "langchain 应该依赖 langgraph"` 断言失败时会打印后面那句话。
- `assert "langchain" not in direct_deps("langgraph"), "langgraph 不应该依赖 langchain"` 注意 `"langchain"` 和 `"langchain-core"` 是不同的字符串,列表里有后者不影响这条。

</div>

```bash
uv run python -m part05.lg.ex298_deps
```

```text
langchain-core 1.7.0 直接依赖:httpx, jsonpatch, langchain-protocol, langsmith, packaging, pydantic, pyyaml, tenacity, typing-extensions, uuid-utils
langgraph 1.2.16 直接依赖:langchain-core, langgraph-checkpoint, langgraph-prebuilt, langgraph-sdk, pydantic, xxhash
langchain 1.4.7 直接依赖:langchain-core, langgraph, pydantic
langchain-openai 1.7.2 直接依赖:certifi, langchain-core, openai, tiktoken
断言通过:langchain 依赖 langgraph,langgraph 不依赖 langchain
```

和 `uv tree` 的结果一致。以后遇到「A 是不是基于 B」这类说法,用这个办法一分钟就能自己验证,不用相信任何文章,包括这一篇。

</details>

**练习 2:看消息序列。** 用 `create_agent` 版问三个问题:「你好」「C007 一共有几张发票?只数最近 5 张就行」「C007 有没有重复扣款?如果有,告诉我多扣了多少钱」。每个问题打印消息类型的序列和模型调用次数,说出每种情况下图里走了哪几步。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex298_messages.py
"""练习 2:三个问题,看 create_agent 的消息序列和模型调用次数。用法:uv run python -m part05.lg.ex298_messages"""
from langchain_core.messages import AIMessage

from part05.lg.lc_agent import agent

QUESTIONS = ["你好", "C007 一共有几张发票?只数最近 5 张就行", "C007 有没有重复扣款?如果有,告诉我多扣了多少钱"]

for q in QUESTIONS:
    result = agent.invoke({"messages": [{"role": "user", "content": q}]})
    msgs = result["messages"]
    kinds = " → ".join(
        f"AI[{'+'.join(c['name'] for c in m.tool_calls)}]" if isinstance(m, AIMessage) and m.tool_calls
        else type(m).__name__.removesuffix("Message")
        for m in msgs)
    model_calls = sum(isinstance(m, AIMessage) for m in msgs)
    print(f"问:{q}\n  {kinds}\n  模型调用 {model_calls} 次,工具消息 {sum(type(m).__name__ == 'ToolMessage' for m in msgs)} 条")
```

<div class="line-notes">

- `QUESTIONS = [` 三个问题:不需要工具的、需要一个工具的、需要查了再判断的。
- `result = agent.invoke({"messages": [{"role": "user", "content": q}]})` 每个问题单独调一次,互不影响。
- `msgs = result["messages"]` 整个对话的消息列表。
- `kinds = " → ".join(` 把每条消息变成一个简短的标签,用箭头连起来。
- `f"AI[{'+'.join(c['name'] for c in m.tool_calls)}]" if isinstance(m, AIMessage) and m.tool_calls` 如果是模型发的、而且带工具调用,标成 `AI[工具名]`;调了多个工具用加号连。
- `else type(m).__name__.removesuffix("Message")` 其他消息用类名去掉 `Message` 后缀:`HumanMessage` 变 `Human`,`ToolMessage` 变 `Tool`。`removesuffix` 是 Python 3.9 加的字符串方法。
- `model_calls = sum(isinstance(m, AIMessage) for m in msgs)` 模型发了几条消息,就是调用了几次模型。
- `sum(type(m).__name__ == 'ToolMessage' for m in msgs)` 工具消息的条数。

</div>

```bash
uv run python -m part05.lg.ex298_messages
```

```text
问:你好
  Human → AI
  模型调用 1 次,工具消息 0 条
问:C007 一共有几张发票?只数最近 5 张就行
  Human → AI[list_invoices] → Tool → AI
  模型调用 2 次,工具消息 1 条
问:C007 有没有重复扣款?如果有,告诉我多扣了多少钱
  Human → AI[find_duplicates] → Tool → AI
  模型调用 2 次,工具消息 1 条
```

对着图读:

- 「你好」:`Human → AI`。`__start__ → model`,模型没要求调工具,走 `model → __end__`。模型调用 1 次。
- 「C007 一共有几张发票」:`Human → AI[list_invoices] → Tool → AI`。`model` 要求调工具,走 `model → tools`,工具跑完走 `tools → model`,模型这次没再要工具,走 `model → __end__`。模型调用 2 次。
- 「C007 有没有重复扣款」:同样 2 次。这一次模型**只**调了 `find_duplicates`,没有再多调 `list_invoices`,和前面完整的示例(并行调了两个)不一样。模型每次的选择不完全一样,图的结构不变。

注意模型调用次数 = 图里 `model` 节点执行的次数 = 你手写循环里调 `llm.chat` 的次数,Day 131 讲过的「每多一轮历史重发一遍」同样适用。

</details>

**练习 3:把旧写法迁到 1.x。** 把 `create_react_agent(model, [find_duplicates], prompt=SYSTEM)` 改成 `create_agent`,确认两边对同一个问题都调了 `find_duplicates`、都是 4 条消息(Human、AI、Tool、AI),并记录旧函数发出的警告类别。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex298_migrate.py
"""练习 3:把 2025 年以前教程里的写法迁到 1.x。用法:uv run python -m part05.lg.ex298_migrate"""
import warnings

from langchain.agents import create_agent
from langchain_core.messages import AIMessage
from langgraph.prebuilt import create_react_agent  # 旧写法,导入时就会发出弃用警告

from part05.lg.billing_tools import find_duplicates
from part05.lg.hand_agent import QUESTION, SYSTEM
from part05.lg.lc_agent import model

with warnings.catch_warnings(record=True) as caught:
    warnings.simplefilter("always")
    old = create_react_agent(model, [find_duplicates], prompt=SYSTEM)  # 旧:参数叫 prompt
print("旧写法的警告:", caught[0].category.__name__ if caught else "没有")

new = create_agent(model, [find_duplicates], system_prompt=SYSTEM)  # 新:参数叫 system_prompt,别的不变

for label, agent in (("旧 create_react_agent", old), ("新 create_agent", new)):
    msgs = agent.invoke({"messages": [{"role": "user", "content": QUESTION}]})["messages"]
    tools = [c["name"] for m in msgs if isinstance(m, AIMessage) for c in m.tool_calls]
    print(f"{label}:{len(msgs)} 条消息,调用工具 {tools},最后一句:{msgs[-1].content[:30]!r}")
```

<div class="line-notes">

- `from langgraph.prebuilt import create_react_agent  # 旧写法,导入时就会发出弃用警告` 注释写的是「导入时」,实际上我实测警告是在**调用** `create_react_agent(...)` 的那一行才触发的,所以下面把调用包进了 `catch_warnings`。
- `old = create_react_agent(model, [find_duplicates], prompt=SYSTEM)  # 旧:参数叫 prompt` 旧参数名。
- `print("旧写法的警告:", caught[0].category.__name__ if caught else "没有")` 如果记录到了警告,打印第一条的类别;一条都没有就打印「没有」。
- `new = create_agent(model, [find_duplicates], system_prompt=SYSTEM)  # 新:参数叫 system_prompt,别的不变` 迁移的全部内容:改函数名、改导入、`prompt` 改成 `system_prompt`。
- `for label, agent in (("旧 create_react_agent", old), ("新 create_agent", new)):` 同一段验证代码对两个 Agent 各跑一遍。
- `tools = [c["name"] for m in msgs if isinstance(m, AIMessage) for c in m.tool_calls]` 双层推导式:先在所有消息里挑模型发的,再在每条里把工具调用的名字都收集起来。读法是从左往右:`for m in msgs`,`for c in m.tool_calls`。
- `print(f"{label}:{len(msgs)} 条消息,调用工具 {tools},最后一句:{msgs[-1].content[:30]!r}")` 消息条数、工具名、最后一句话的开头。

</div>

```bash
uv run python -m part05.lg.ex298_migrate
```

```text
旧写法的警告: LangGraphDeprecatedSinceV10
旧 create_react_agent:4 条消息,调用工具 ['find_duplicates'],最后一句:'已核实：C007 在 10 月 8 日有两笔各 2392 元'
新 create_agent:4 条消息,调用工具 ['find_duplicates'],最后一句:'查到了,C007 确实有一笔疑似重复扣款:\n\n- 日期:20'
```

两个 Agent 行为一致:都是 4 条消息、都调了 `find_duplicates`。警告类别叫 `LangGraphDeprecatedSinceV10`,名字里就带着「自 1.0 起弃用」。迁移改动一共三处:导入、函数名、参数名 `prompt` 变 `system_prompt`。

</details>

**练习 4:让默认的 create_agent 在工具出错时也能优雅地回答。** 正文里的 `ex298_errors.py` 已经演示了 `ToolErrorMiddleware`。这道题请你在**不使用** `ToolErrorMiddleware` 的前提下,自己写一个工具包装函数,让任何工具抛的异常都变成一个返回 `{"error": ...}` 的字符串,和手写注册表的行为一样,再给 `create_agent` 用。

<details><summary>参考答案</summary>

思路:不改框架,改工具。写一个装饰器 `safe`,包住原函数,出错就返回错误字符串;关键是**保持函数的名字、签名和文档字符串不变**,否则 LangChain 读不到参数说明。`functools.wraps` 就是干这个的:

```python
# agent-zero-lab/part05/lg/ex298_safe_tool.py
"""练习 4:自己写一个让工具永不抛异常的装饰器,代替 ToolErrorMiddleware。用法:uv run python -m part05.lg.ex298_safe_tool"""
import functools
import json
from collections.abc import Callable
from typing import Annotated, Any

from langchain.agents import create_agent

from part05.lg.lc_agent import model

SYSTEM = "你是客服助手。要查数据就用工具。工具出错了就如实告诉用户。"
QUESTION = "帮我查一下 C007 的账单状态。"


def safe(fn: Callable[..., Any]) -> Callable[..., Any]:
    """工具里出任何错,都变成 {"error": "类型: 说明"} 交回去,不让它终止整个调用。"""

    @functools.wraps(fn)  # 把原函数的名字、文档字符串、类型标注复制到包装函数上
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        try:
            return fn(*args, **kwargs)
        except Exception as e:  # noqa: BLE001
            return json.dumps({"error": f"{type(e).__name__}: 工具执行失败"}, ensure_ascii=False)

    return wrapper


@safe
def billing_status(customer_id: Annotated[str, "客户编号,例如 C007"]) -> str:
    """查询某个客户的账单状态。"""
    raise ConnectionError("billing 服务连不上(演示用)")


agent = create_agent(model, tools=[billing_status], system_prompt=SYSTEM)
result = agent.invoke({"messages": [{"role": "user", "content": QUESTION}]})
print(result["messages"][-1].content[:80])
```

<div class="line-notes">

- `import functools` 标准库里放装饰器辅助工具的模块。
- `SYSTEM = "你是客服助手。要查数据就用工具。工具出错了就如实告诉用户。"` 常量在这个文件里自己定义,没有从正文的 `ex298_errors.py` 导入:导入那个文件会把它里面的演示代码整个重跑一遍(包括调模型)。
- `def safe(fn: Callable[..., Any]) -> Callable[..., Any]:` 装饰器就是「接收一个函数、返回一个新函数」的函数,[Day 96](/blog/agent-zero/day-096-decorators/) 讲过。`Callable[..., Any]` 表示接收任意参数、返回任意值的函数。
- `@functools.wraps(fn)  # 把原函数的名字、文档字符串、类型标注复制到包装函数上` 没有这一行,包装后的函数名字变成 `wrapper`、文档字符串没了,模型就看不到工具说明。LangChain 靠这些信息生成工具定义。
- `def wrapper(*args: Any, **kwargs: Any) -> Any:` 接收原函数的所有参数,原样转给它。`*args` 收位置参数,`**kwargs` 收关键字参数,和 JS 里的 `...args` 类似。
- `return fn(*args, **kwargs)` 正常情况下原样返回原函数的结果。
- `return json.dumps({"error": f"{type(e).__name__}: 工具执行失败"}, ensure_ascii=False)` 出错时只交出异常类型,不交原始信息,理由和正文里 `describe` 一样。
- `@safe` 装饰器写在函数上面。装饰之后的 `billing_status` 实际上是 `wrapper`,但名字和说明都还是原来的。
- `agent = create_agent(model, tools=[billing_status], system_prompt=SYSTEM)` 这次**没有**加任何中间件,和正文里「默认设置」那一版的差别只有工具本身。
- `print(result["messages"][-1].content[:80])` 最后一条消息的开头。

</div>

```bash
uv run python -m part05.lg.ex298_safe_tool
```

```text
抱歉，查询 C007 账单状态的工具执行失败了，返回的是连接错误（ConnectionError: 工具执行失败），我这边暂时没有拿到任何数据。

这可能是临时
```

没有中间件,`invoke` 也没有抛异常,模型如实告诉了用户。两种做法的取舍:中间件是官方扩展点,一处配置对所有工具生效,也能按工具名筛选;装饰器是你自己的代码,最直白,但每个工具都得记得加,漏一个就是一个会终止整次调用的漏洞。

</details>

**验收标准**:`uv tree` 显示 `langchain` 依赖 `langgraph`、`langgraph` 不依赖 `langchain`;`hand_agent.py` 和 `lc_agent.py` 对同一个问题各调用 2 次模型、都调了 `find_duplicates`;`peek_graph.py` 输出类型 `langgraph.graph.state.CompiledStateGraph` 和 `model`、`tools` 两个节点;`old_react.py` 输出 `LangGraphDeprecatedSinceV10`;`ex298_errors.py` 里默认 `create_agent` 抛 `ConnectionError`、手写注册表和加了中间件的版本都能正常回答;你能讲出为什么「学 LangGraph,别从高层封装学起」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| LangChain | 大模型应用框架,2022 年出现。1.x 里主要提供高层的 `create_agent` 和中间件;旧的链搬去了 `langchain-classic` |
| LangGraph | 编排运行时:把流程画成状态图,有持久化、人工中断、流式输出。可以不依赖 LangChain 单独用 |
| `langchain-core` | 两个库共用的底层:消息类型、`@tool`、模型接口 |
| `langchain-openai` | 把 OpenAI 或兼容 OpenAI 协议的模型接进 LangChain,提供 `ChatOpenAI` |
| `create_agent` | LangChain 1.x 创建 Agent 的入口函数,返回一张编译好的 LangGraph 图 |
| `create_react_agent` | 2025 年以前教程里的旧函数,在 `langgraph.prebuilt`,1.0 起弃用,计划 2.0 移除 |
| `CompiledStateGraph` | 编译好的、可以执行的 LangGraph 图的类 |
| 节点(node)、边(edge) | 图里的一步,和步与步之间的跳转。条件边是「看状态决定走不走」 |
| 中间件(middleware) | `create_agent` 的扩展方式:在循环的某些位置(调模型前后、调工具前后)插一段你的逻辑 |
| `ToolErrorMiddleware` | 官方自带的中间件,把工具抛的异常变成交给模型的错误消息 |
| 弃用警告(deprecation warning) | 告诉你「这个写法还能用,但将来会删」的提示 |
| `Annotated` | Python 的类型标注工具,给类型附一段说明。手写注册表和 LangChain 都读它当参数说明 |
| `functools.wraps` | 写装饰器时用来保留原函数名字和说明的辅助工具 |
| `uv tree` | 列出项目依赖树的命令,看一个包直接依赖哪些包 |

## 常见误区

**以为 LangChain 和 LangGraph 二选一。** 装了 LangChain 1.x 就一定装了 LangGraph,`create_agent` 本身就是一张 LangGraph 图。它们是上下两层。

**以为 LangGraph 必须配 LangChain 用。** 依赖树里 `langgraph` 的依赖没有 `langchain`,官方文档也说可以单独用。它借用的只是 `langchain-core` 里的消息和工具类型。

**照着 2025 年以前的教程抄 `create_react_agent`。** 现在还能跑,但会有弃用警告,计划在 2.0 移除。新代码直接写 `create_agent`,参数 `prompt` 改叫 `system_prompt`。

**以为换成框架,你手写时做对的防护它都替你做了。** 实测:工具抛 `ConnectionError`,手写注册表把它变成错误消息交给模型,默认的 `create_agent` 整个调用都抛出来了。要加 `ToolErrorMiddleware`,或者自己在工具上包一层。换框架后,要一条一条核对它的默认值。

**以为框架一定更省事。** 一个循环加三个工具,手写 50 行比多装三十个上下的包更好懂、更好调试。框架的价值在你需要它那些能力的时候才出现:持久化、人工审批、复杂分支。

**从高层封装开始学。** `create_agent` 把图藏起来了,出问题时你不知道里面发生了什么。先弄懂图,再用封装省代码。

**用旧版本的文章当事实。** 这个领域变得太快。判断「谁依赖谁」「哪个函数还在」,用 `uv tree`、`importlib.metadata`、`inspect.signature` 自己查,别只信文章,包括这一篇。

## 学习资料

### 文档与文章

- [LangChain 文档 · 概览](https://docs.langchain.com/oss/python/langchain/overview):官方对 `create_agent`、中间件的说明,以及它和 LangGraph 的关系。
- [LangChain v1 发布说明](https://docs.langchain.com/oss/python/releases/langchain-v1):1.0 改了什么:`create_agent`、中间件、`langchain-classic`、`create_react_agent` 的去向。读「at a glance」那一节,15 分钟。
- [LangGraph 文档 · 概览](https://docs.langchain.com/oss/python/langgraph/overview):LangGraph 怎么介绍自己:低层的编排框架和运行时,可以不依赖 LangChain 单独用。
- [LangChain 与 LangGraph 1.0 发布博客](https://blog.langchain.com/langchain-langgraph-1dot0/):官方对 1.0 的说明,看它怎么描述「两个库的分工」。
- [LangChain 文档 · Agents](https://docs.langchain.com/oss/python/langchain/agents):`create_agent` 的参数、工具、中间件怎么写,明天之后会常翻。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1AkMB6qEV1&autoplay=0&high_quality=1" title="LangChain、LangGraph、LangSmith 到底啥区别?一个视频讲清三者分工｜别再当成三选一" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Summer热夏 · LangChain、LangGraph、LangSmith 到底啥区别?一个视频讲清三者分工 · 16 分钟。把三个名字的分工讲了一遍,多出来的 LangSmith 是观测平台,第六部分会用到,先对号入座。</figcaption>
</figure>

- AI大模型元元《LangChain和LangGraph有什么区别?12分钟讲清楚!》(BV1tiKU6eEuU,12 分钟):另一个讲法,可以对照今天的依赖树结论看讲得对不对。
- LangChain-V1《LangGraph 1.0 官方教程》(BV1UzyzBNEB6,61 分钟):搬运官方教程,明天以后进入 LangGraph 时可以挑着看。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/aHCDrAbH_go" title="Building Effective Agents with LangGraph" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Building Effective Agents with LangGraph · LangChain 官方频道,英文,开字幕。我只核实了标题和频道,没有逐段看完,用来看官方怎么讲「为什么要有 LangGraph」。</figcaption>
</figure>

- NeuralNine《LangGraph Crash Course - Agent Workflows in Python》(YouTube `uWLJAtMOVT0`,英文):实操向的入门,明天开始学 LangGraph 时可以对照看。注意它可能用的是 1.0 以前的写法,导入路径以我们今天的为准。

### 书籍

- Mayo Oshin、Nuno Campos,《Learning LangChain: Building AI and LLM Applications with LangChain and LangGraph》,O'Reilly,2025。作者之一是 LangChain 公司的工程师。这本书出版时 1.0 还没发布,里面的 API 要和今天对照着看(比如 `create_react_agent`),我没有核实有无中文版。

### 开源项目与代码

- [langchain-ai/langchain](https://github.com/langchain-ai/langchain):LangChain 仓库,看 `langchain` 包里的 `agents` 目录,`create_agent` 的实现不长,读完会发现它就是在拼一张图。
- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):LangGraph 仓库,后面十几天都会用到。
- [langchain-ai/deepagents](https://github.com/langchain-ai/deepagents):建在 LangGraph 上的另一个高层封装,带规划、子 Agent 和文件系统工具。

## 自测

1. 用一句话说明 LangChain 1.x 和 LangGraph 的关系,并说出你用什么证据。

<details><summary>答案</summary>

LangChain 1.x 的 `create_agent` 建在 LangGraph 上,LangGraph 是底下的运行时。证据有两个:一是 `uv tree --package langchain --depth 1` 里 `langchain` 的直接依赖有 `langgraph`,而 `langgraph` 的直接依赖里没有 `langchain`;二是 `create_agent` 返回的对象类型是 `langgraph.graph.state.CompiledStateGraph`,`get_graph()` 里能看到 `model` 和 `tools` 两个节点。

</details>

2. `create_agent` 返回的图里有几个节点?它们和你手写的循环怎么对应?

<details><summary>答案</summary>

四个:`__start__` 和 `__end__` 是入口出口的特殊节点,真正干活的是 `model` 和 `tools`。`model` 对应手写循环里调一次 `llm.chat`;`tools` 对应执行模型要求的所有工具并把结果追加进消息;`model → tools` 和 `model → __end__` 两条条件边对应「有没有 tool_calls」的 `if`;`tools → model` 对应下一轮循环。

</details>

3. 2025 年以前的教程里写 `from langgraph.prebuilt import create_react_agent`,现在应该怎么写?

<details><summary>答案</summary>

`from langchain.agents import create_agent`。函数还叫类似的参数:模型、工具列表照旧,系统提示词的参数从 `prompt` 改成 `system_prompt`。旧函数在 LangGraph 1.x 里还能跑,但会发出 `LangGraphDeprecatedSinceV10` 警告,计划在 2.0 移除。

</details>

4. 同一个工具抛了 `ConnectionError`,手写的注册表和默认的 `create_agent` 各会怎样?怎么让后者也优雅地回答?

<details><summary>答案</summary>

手写注册表的 `call` 接住所有异常,变成 `{"error": ...}` 交回模型,模型照实告诉用户,循环正常结束。默认的 `create_agent` 不接,异常原样冒出来,整个 `invoke` 抛出 `ConnectionError`,没有任何回答。让它优雅回答有两种办法:给 `create_agent` 加 `ToolErrorMiddleware(on_error=...)`,返回要交给模型的内容;或者自己写装饰器包住工具,出错返回错误字符串。注意只交出异常类型和必要的说明,别把原始异常信息整段交给模型。

</details>

5. (面试题)「你们为什么用 LangGraph 而不是 LangChain?」这个问题有什么问题?你怎么回答?

<details><summary>答案</summary>

问题在于它把两者当成了二选一。LangChain 1.x 的 Agent 本身就跑在 LangGraph 上,两者是上下两层。我会先纠正这一点,再回答真正的问题:什么时候用高层的 `create_agent`,什么时候直接用 LangGraph 画图。标准的「模型调工具直到做完」,`create_agent` 加中间件就够,省代码;流程里有分支、并行、多个 Agent 配合、中途等人审批、失败后要从某一步重来,就直接用 LangGraph 把状态和每一步写清楚,出了问题也知道里面是什么。再补一句取舍:框架替你省了循环,但没替你做生产级的防护,比如我实测过工具抛异常时,默认的 `create_agent` 会让整个调用失败,手写时顺手做的防护要逐条核对。

</details>

6. (面试题)「什么时候你会不用框架,自己手写 Agent 循环?」

<details><summary>答案</summary>

流程就是「模型调工具直到做完」,工具不超过几个,不需要持久化、人工审批这类能力的时候,手写 50 行左右最清楚:依赖少、出了问题好调试、每个防护(超时、截断、异常处理、步数上限)都在自己手里。还有两种情形:一是做学习或者原型,为了弄懂机制;二是对依赖和启动时间很敏感的小服务。反过来,一旦需要中途暂停等人、断点续跑、复杂分支或者多 Agent 协作,自己写这些就等于重造 LangGraph,这时候该用框架。我会用一个具体的判断:如果我发现自己在手写循环里加第二个状态字段和第三层 `if`,就是该画图的信号。

</details>

## 明天预告

Day 299 · LangGraph(一):只有一个节点的图。今天看到了 `create_agent` 返回的图里有 `model` 和 `tools` 两个节点,明天不调模型、不调工具,从最小的开始:定义一个状态,写一个只有一个节点的图,走完「定义状态、建图、加节点、连边、编译、调用」六步骨架。以后的任何一张图,都是这六步加上更多的节点和边。
