---
title: 'Day 331 · 多 Agent(三):专员交接 handoff'
description: '第二种拓扑没有主管:账务和技术轮流「接电话」,不归自己管就调用 transfer 工具转给同事,接手的人看得到完整对话。先用不调模型的玩具图看清 Command(goto)、共享 messages 和 active,再接上真模型;顺手撞一次漏回 ToolMessage 的 400、一次「接手的人以为自己是转出方」和一次踢皮球。最后用一句话认识 router、skills、custom workflow 和 A2A。'
pubDate: 2026-10-23
regime: none
tags: ['multi-agent', 'handoff', 'langgraph', 'agent-zero']
series: 'agent-zero'
day: 331
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 330](/blog/agent-zero/day-330-multi-agent-2/) 搭了主管派活:主管把账务专员和技术支持包装成两个工具,同时派活,专员只看得到主管写的一句任务,只把结论交回。实跑下来,两个专员确实并行,但同一个问题比单 Agent 多花约 2.4 倍 token、慢一倍;更要紧的是主管在交接处编了年份、抄错了发票号、补出了没有依据的到账天数。

主管模式还有一个结构上的限制:专员从不直接面对客户。客户想跟账务专员来回聊几句(「哪张是多扣的?」「那退款什么时候到?」),每一句都得经过主管转述一次。今天换一种没有主管的拓扑,让专员自己接电话。

## 今天要解决的问题

学完今天,你要能做到:

1. 说清专员交接(handoff)和主管派活的根本区别:谁面对用户、接手的人能看到什么、适合什么场景。
2. 用 LangGraph 的 `Command(goto=...)`、共享的 `messages` 和一个 `active` 字段实现交接,并配合 checkpointer 跨多轮对话记住「现在是谁在接电话」。
3. 亲手撞出并修好交接的三个典型问题:漏回 ToolMessage 的 400、接手的 Agent 以为自己是转出方、两个 Agent 互相踢皮球。
4. 用一句话说出 router、skills、custom workflow 三种模式和 A2A 协议各解决什么问题。

预计用时 2.5–3 小时:玩具图 40 分钟,真模型和三个坑 1 小时,其他模式 20 分钟,练习 1 小时。前置:[Day 304](/blog/agent-zero/day-304-lg-reducer/) 的 `add_messages`,[Day 306](/blog/agent-zero/day-306-lg-conditional/) 的条件边,[Day 308](/blog/agent-zero/day-308-lg-loop/) 的 `recursion_limit` 和 `GraphRecursionError`,[Day 309](/blog/agent-zero/day-309-lg-command/) 的 `Command`,[Day 316](/blog/agent-zero/day-316-lg-checkpointer/) 的 checkpointer 和 thread_id,[Day 311](/blog/agent-zero/day-311-lg-agent-loop/) 的 `part05/lgdemo/llm.py`(`get_llm()`)和 `bind_tools`,[Day 161](/blog/agent-zero/day-161-missing-result/) 漏回 tool 消息的报错,以及昨天的 `supervisor.py`。今天调模型的实跑一共约 0.08 元,算式在练习 2。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `make_agent_node()` 里的 `node` 函数默写出来;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 交接和派活差在哪

交接(handoff)就是电话客服里那句「我帮您转接技术部门」。几个专员轮流接电话,当前在线的那个直接和用户对话;发现问题不归自己管,就调用一个 `transfer_to_xxx` 工具,把对话整个转给同事。OpenAI Agents SDK 和 LangChain 文档都管它叫 handoff。

它和昨天的主管模式差在三件事上:

- **谁面对用户。** 主管模式里只有主管面对用户,专员是幕后的;交接模式里没有主管,谁在线谁直接回复用户。
- **接手的人能看到什么。** 主管模式里专员只看到主管写的一句任务;交接模式里接手的专员看到的是**完整的对话历史**,客户说过什么、同事查过什么,一清二楚。OpenAI Agents SDK 的文档原话是,接手的 Agent「就像接管了这段对话,能看到之前全部的对话历史」。
- **适合什么场景。** 主管模式适合一次性的查询:用户问一句,系统查完回一句。交接模式适合多轮对话:用户要和某个专员来回聊好几句,中途话题可能跳到另一个领域。

回头看 [Day 329](/blog/agent-zero/day-329-multi-agent-1/) Cognition 的第一条原则「共享完整的上下文」,交接模式天然满足它:两个专员共享同一份消息历史,不存在「转述」这一步,也就少了昨天那种在转述时补出来的错。代价是没有上下文隔离:历史越聊越长,每个专员每次都要读全部。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="账务专员和技术支持两个节点共享同一份消息历史,通过 transfer 工具互相交接,任何一方都可以直接回复用户结束本轮">
  <rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)"/>
  <rect x="40" y="20" width="560" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="320" y="42" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">共享的 messages(add_messages 追加) + active = 现在谁在接电话</text>
  <rect x="90" y="96" width="150" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="165" y="126" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">billing 节点</text>
  <rect x="400" y="96" width="150" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="475" y="126" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">tech 节点</text>
  <path d="M240 110 L400 110" stroke="var(--mem)" fill="none"/>
  <path d="M400 132 L240 132" stroke="var(--mem)" fill="none"/>
  <text x="320" y="103" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">transfer_to_tech → goto="tech"</text>
  <text x="320" y="150" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">transfer_to_billing → goto="billing"</text>
  <g stroke="var(--ink-faint)" stroke-dasharray="3 3"><line x1="165" y1="54" x2="165" y2="96"/><line x1="475" y1="54" x2="475" y2="96"/></g>
  <text x="165" y="180" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">不调工具 → 直接回复用户</text>
  <text x="475" y="180" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">不调工具 → 直接回复用户</text>
  <text x="320" y="208" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">下一轮用户消息从 active 记录的那个节点开始</text>
</svg>
<figcaption>交接没有中心节点。两个专员读写同一份历史,交接靠节点返回 Command(goto=对方),checkpointer 记住这一轮停在谁那里。</figcaption>
</figure>

## 准备

在练习仓库根目录装依赖、造数。`llm.py` 是 [Day 311](/blog/agent-zero/day-311-lg-agent-loop/) 建在 `part05/lgdemo/` 里的,`supervisor.py` 是昨天建在 `part05/multi/` 里的,今天都直接 import:

```bash
cd ~/agent-zero-lab
uv add langgraph langchain-openai
uv run python cloudledger/seed.py
cd part05/multi
```

我用的版本是 2026 年 10 月查到的 PyPI 最新版:`langgraph` 1.2.16、`langchain-openai` 1.7.2(带进来的 `langchain-core` 是 1.6.13),和 Day 320 一致。

## 第 1 步:不调模型的玩具交接

照老规矩,先用一个不调模型的玩具把机制看清楚,再接真模型。两个「专员」不问模型,只按关键词判断:问题里有自己管的词就回答,没有就转给同事。

```python
# agent-zero-lab/part05/multi/handoff_toy.py
"""不调模型的交接玩具:两个「专员」按关键词决定自己答还是转给同事。
看三件事:messages 是共享的,active 记住谁在接电话,交接靠 Command(goto=...)。"""
import operator
from typing import Annotated, Literal

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import START, StateGraph
from langgraph.types import Command
from typing_extensions import NotRequired, TypedDict

MINE = {"billing": ["扣", "发票", "退款"], "tech": ["报错", "导出", "登录"]}
Goto = Literal["billing", "tech", "__end__"]
OTHER: dict[str, Goto] = {"billing": "tech", "tech": "billing"}


class State(TypedDict):
    messages: Annotated[list[str], operator.add]
    active: NotRequired[str]


def make_node(name: str):
    def node(state: State) -> Command[Goto]:
        question = [m for m in state["messages"] if m.startswith("用户:")][-1]
        if any(w in question for w in MINE[name]):
            reply = f"{name}:这个归我,我来处理「{question[3:]}」"
            return Command(goto="__end__", update={"messages": [reply], "active": name})
        other = OTHER[name]
        return Command(goto=other, update={"messages": [f"{name}:不归我管,转给 {other}"], "active": other})
    return node


builder = StateGraph(State)
builder.add_node("billing", make_node("billing"))
builder.add_node("tech", make_node("tech"))
builder.add_conditional_edges(START, lambda s: s.get("active") or "billing", ["billing", "tech"])
graph = builder.compile(checkpointer=InMemorySaver())

if __name__ == "__main__":
    config: RunnableConfig = {"configurable": {"thread_id": "toy-1"}}
    for text in ["10 月多扣了一笔", "导出报表报错", "那张发票呢"]:
        out = graph.invoke({"messages": [f"用户:{text}"]}, config)
        print(f"本轮结束 active={out['active']},共 {len(out['messages'])} 条")
    for m in out["messages"]:
        print("  ", m)
```

<div class="line-notes">

- `import operator` 下面要用 `operator.add` 做 reducer,也就是「新消息追加到列表后面」。[Day 304](/blog/agent-zero/day-304-lg-reducer/) 学的。
- `from langgraph.types import Command` 节点直接返回 `Command(goto=..., update=...)`,同时改状态和指定下一站,不用画条件边。[Day 309](/blog/agent-zero/day-309-lg-command/) 学的。
- `from typing_extensions import NotRequired, TypedDict` `NotRequired` 标记 TypedDict 里「可以没有」的键,相当于 TS interface 里的 `active?: string`。
- `MINE = {"billing": ["扣", "发票", "退款"], "tech": ["报错", "导出", "登录"]}` 每个专员认哪些词。真模型版里这一步换成模型自己判断。
- `Goto = Literal["billing", "tech", "__end__"]` 一个类型别名:节点只可能跳到这三个地方。`"__end__"` 就是 LangGraph 的 `END` 常量的值。
- `OTHER: dict[str, Goto] = {"billing": "tech", "tech": "billing"}` 不归我管时转给谁。标注成 `Goto` 是为了让 `Command[Goto]` 的类型检查通过:如果写成普通的 `dict[str, str]`,basedpyright 会报 `"Command[str]" is not assignable to "Command[Goto]"`。
- `messages: Annotated[list[str], operator.add]` 两个专员共享的历史。玩具里用纯字符串,真模型版换成消息对象和 `add_messages`。
- `active: NotRequired[str]` 现在谁在接电话。第一轮还没有,所以是可选的;写成必填的话,`graph.invoke({"messages": [...]})` 只传一个键,类型检查会报缺少 `active`。
- `def make_node(name: str):` 工厂函数,按名字造一个节点函数。两个专员逻辑一样,只是认的词和转给的人不同。
- `question = [m for m in state["messages"] if m.startswith("用户:")][-1]` 在共享历史里找最后一条用户消息。`[-1]` 是最后一个元素,相当于 JS 的 `.at(-1)`。第二轮 tech 被转过来时,它看到的历史里已经有第一轮的两条和 billing 刚写的「不归我管」,它照样能找到用户最新那句话。这就是「接手的人看得到完整历史」。
- `if any(w in question for w in MINE[name]):` 问题里有任一个自己认的词,就归我。
- `return Command(goto="__end__", update={"messages": [reply], "active": name})` 回复用户,本轮结束,同时记下「现在是我在接电话」。这里写字符串 `"__end__"` 而不是 `END`,是因为 `END` 在类型上只是 `str`,不满足 `Goto`。
- `return Command(goto=other, update={"messages": [f"{name}:不归我管,转给 {other}"], "active": other})` 交接:往历史里写一句转接记录,`active` 改成对方,然后直接跳到对方节点。
- `builder.add_conditional_edges(START, lambda s: s.get("active") or "billing", ["billing", "tech"])` 每轮从谁开始:上一轮停在谁那里就从谁开始,第一轮没有 `active`,默认账务。`lambda` 是一行的匿名函数,相当于 JS 的箭头函数。
- `graph = builder.compile(checkpointer=InMemorySaver())` 有了 checkpointer,同一个 thread_id 的多次 `invoke` 会接着上一次的状态,`messages` 和 `active` 都记得。[Day 316](/blog/agent-zero/day-316-lg-checkpointer/) 学的。
- `config: RunnableConfig = {"configurable": {"thread_id": "toy-1"}}` 三轮对话共用一个 thread。
- `out = graph.invoke({"messages": [f"用户:{text}"]}, config)` 每轮只传新的那句话,历史由 checkpointer 补上,`operator.add` 把它追加到最后。
- `print(f"本轮结束 active={out['active']},共 {len(out['messages'])} 条")` 实测三轮依次是 billing 2 条、tech 5 条、billing 8 条。

</div>

```bash
uv run python handoff_toy.py
```

```text
本轮结束 active=billing,共 2 条
本轮结束 active=tech,共 5 条
本轮结束 active=billing,共 8 条
   用户:10 月多扣了一笔
   billing:这个归我,我来处理「10 月多扣了一笔」
   用户:导出报表报错
   billing:不归我管,转给 tech
   tech:这个归我,我来处理「导出报表报错」
   用户:那张发票呢
   tech:不归我管,转给 billing
   billing:这个归我,我来处理「那张发票呢」
```

一步步看。第一轮从默认的 billing 开始,「多扣」里有「扣」,billing 自己答,`active` 记成 billing。第二轮从 billing 开始(上一轮停在它那里),「导出报表报错」不归它,它写一句转接,跳到 tech,tech 认领,`active` 变成 tech。第三轮从 tech 开始,「那张发票呢」又不归 tech,转回 billing。

注意第三轮:用户只说了「那张发票呢」,没说是哪张。真实的 billing 能回答这句话,靠的是它看得到第一轮自己和客户的完整对话。主管模式里这句话会被主管转述成一个新任务,专员要从零开始查。

### 踢皮球

两个专员都觉得「不归我管」会怎样?用玩具图试一下。把 `recursion_limit` 设小一点,省得等:

```python
# agent-zero-lab/part05/multi/handoff_pingpong.py
"""两个专员都觉得「不归我管」时会怎样:互相踢皮球,直到撞上 recursion_limit。"""
from langchain_core.runnables import RunnableConfig

from handoff_toy import graph

config: RunnableConfig = {"configurable": {"thread_id": "toy-pingpong"}, "recursion_limit": 6}
try:
    graph.invoke({"messages": ["用户:你好,在吗"]}, config)
except Exception as e:
    print(type(e).__name__, ":", str(e).splitlines()[0])
    for m in graph.get_state(config).values["messages"]:
        print("  ", m)
```

<div class="line-notes">

- `from handoff_toy import graph` 直接复用玩具图。`handoff_toy.py` 有 main guard,import 时不会跑那三轮对话。
- `config: RunnableConfig = {"configurable": {"thread_id": "toy-pingpong"}, "recursion_limit": 6}` 最多走 6 步。默认是 25,`recursion_limit` 是 [Day 308](/blog/agent-zero/day-308-lg-loop/) 学的。
- `graph.invoke({"messages": ["用户:你好,在吗"]}, config)` 「你好,在吗」里没有任何一方认的词。
- `for m in graph.get_state(config).values["messages"]:` 报错之后,checkpointer 里还存着撞墙之前的状态,用 `get_state` 取出来看看它们转了几次。

</div>

```text
GraphRecursionError : Recursion limit of 6 reached without hitting a stop condition. You can increase the limit by setting the `recursion_limit` config key.
   用户:你好,在吗
   billing:不归我管,转给 tech
   tech:不归我管,转给 billing
   billing:不归我管,转给 tech
   tech:不归我管,转给 billing
   billing:不归我管,转给 tech
   tech:不归我管,转给 billing
```

六步全在互相转。这是交接模式最典型的失败:**踢皮球**。真模型也会这样,比如客户问一个两边都沾一点的问题(「发票导出报错」),或者两个专员的职责描述有重叠又有空白。`recursion_limit` 只是最后一道保险,撞上它时用户什么回复都拿不到。更好的做法是在状态里记交接次数,同一轮转了两次还没人接,就转人工,练习 1 实现它。

## 第 2 步:换成真模型

玩具图里的「按关键词判断」换成模型,「转接」换成模型调用一个 `transfer_to_xxx` 工具。其余的骨架(共享 messages、`active`、`Command(goto)`、checkpointer)完全不变。

```python
# agent-zero-lab/part05/multi/handoff_graph.py
"""专员交接(handoff):账务和技术轮流「接电话」,谁在线谁直接回复客户。
交接靠 transfer_to_xxx 工具,节点返回 Command(goto=...) 跳到对方;两个专员共享同一份消息历史。"""
import sys
from pathlib import Path
from typing import Annotated, Literal

from langchain_core.messages import AnyMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.types import Command
from typing_extensions import NotRequired, TypedDict

sys.path.insert(0, str(Path(__file__).parents[1] / "lgdemo"))
sys.path.insert(0, str(Path(__file__).parents[2] / "cloudledger"))
from llm import get_llm  # noqa: E402  # pyright: ignore[reportMissingImports]
from server import find_customer, list_invoices  # noqa: E402  # pyright: ignore[reportMissingImports]

from supervisor import search_help_center  # noqa: E402

REMIND_ON_ARRIVAL = True  # 刚被转接过来时提醒一句「现在由你处理」


@tool
def transfer_to_tech() -> str:
    """把对话转给技术支持。客户问的是报错、功能使用、登录问题时调用。"""
    return "已转接技术支持"


@tool
def transfer_to_billing() -> str:
    """把对话转给账务专员。客户问的是扣款、发票、订阅、退款时调用。"""
    return "已转接账务专员"


AGENTS = {
    "billing": {
        "system": "你是云簿账务专员,只处理扣款、发票、订阅、退款。遇到技术问题调用 transfer_to_tech。",
        "tools": [tool(find_customer), tool(list_invoices), transfer_to_tech],
    },
    "tech": {
        "system": "你是云簿技术支持,只处理报错、功能、登录问题。遇到账务问题调用 transfer_to_billing。",
        "tools": [tool(search_help_center), transfer_to_billing],
    },
}
Goto = Literal["billing", "tech", "__end__"]
HANDOFFS: dict[str, Goto] = {"transfer_to_tech": "tech", "transfer_to_billing": "billing"}


class State(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
    active: NotRequired[str]  # 当前「接电话」的是谁,下一轮用户消息从它开始


def make_agent_node(name: Goto):
    cfg = AGENTS[name]
    llm = get_llm().bind_tools(cfg["tools"])
    tools_by_name = {t.name: t for t in cfg["tools"]}

    def node(state: State) -> Command[Goto]:
        prompt = [SystemMessage(cfg["system"]), *state["messages"]]
        last = state["messages"][-1]
        if REMIND_ON_ARRIVAL and isinstance(last, ToolMessage) and last.content == f"已转接给 {name}":
            prompt.append(SystemMessage(f"客户刚被转接给你({name})。现在由你直接处理客户最新的问题,该用工具就用工具。"))
        reply = llm.invoke(prompt)
        if not reply.tool_calls:
            return Command(goto="__end__", update={"messages": [reply], "active": name})
        results: list[ToolMessage] = []
        goto: Goto = name  # 默认执行完工具回到自己
        for call in reply.tool_calls:
            if call["name"] in HANDOFFS:
                goto = HANDOFFS[call["name"]]
                results.append(ToolMessage(content=f"已转接给 {goto}", tool_call_id=call["id"]))
            else:
                try:
                    out = tools_by_name[call["name"]].invoke(call["args"])
                except Exception as e:
                    out = f"[工具报错] {e}"
                results.append(ToolMessage(content=str(out), tool_call_id=call["id"]))
        return Command(goto=goto, update={"messages": [reply, *results], "active": goto})

    return node


def route_entry(state: State) -> str:
    return state.get("active") or "billing"


def build():
    builder = StateGraph(State)
    builder.add_node("billing", make_agent_node("billing"))
    builder.add_node("tech", make_agent_node("tech"))
    builder.add_conditional_edges(START, route_entry, ["billing", "tech"])
    return builder.compile(checkpointer=InMemorySaver())


TURNS = ["我是 user007@example.com,10 月是不是扣了我两次钱?",
         "另外导出年度报表一直 ERR_EXPORT_TIMEOUT 怎么办"]

if __name__ == "__main__":
    graph = build()
    config: RunnableConfig = {"configurable": {"thread_id": "chat-user007"}, "recursion_limit": 20}
    for text in TURNS:
        out = graph.invoke({"messages": [("user", text)]}, config)  # pyright: ignore[reportArgumentType]
        print(f"用户:{text}\n[{out['active']}]({len(out['messages'])} 条消息):{out['messages'][-1].content}\n")
```

<div class="line-notes">

- `from langchain_core.messages import AnyMessage, SystemMessage, ToolMessage` 真模型版的历史里放的是 LangChain 的消息对象:用户消息、AI 消息(可能带工具调用)、工具结果消息。
- `from langchain_core.tools import tool` `@tool` 把一个函数变成 LangChain 工具,docstring 变成工具描述,参数变成 schema。
- `from langgraph.graph.message import add_messages` 专门给消息列表用的 reducer:追加新消息,遇到 id 相同的就替换。[Day 304](/blog/agent-zero/day-304-lg-reducer/) 学的。
- `sys.path.insert(0, str(Path(__file__).parents[1] / "lgdemo"))` `parents[1]` 是 `part05`,拼上 `lgdemo`,下面才能 `from llm import get_llm`。
- `from llm import get_llm  # noqa: E402  # pyright: ignore[reportMissingImports]` Day 311 的 `get_llm()`,返回一个读 `.env` 配置、带 `extra_body` 的 `ChatOpenAI`。
- `from supervisor import search_help_center  # noqa: E402` 复用昨天的帮助中心函数。import `supervisor` 会执行它的模块级代码,建好三个 MiniAgent,但不调模型。
- `REMIND_ON_ARRIVAL = True  # 刚被转接过来时提醒一句「现在由你处理」` 一个开关,下面「坑二」会把它关掉做对比。
- `@tool` 两个交接工具都没有参数。实测 `transfer_to_tech` 发给模型的定义是 `{"name": "transfer_to_tech", "description": "把对话转给技术支持。客户问的是报错、功能使用、登录问题时调用。", "parameters": {"properties": {}, "type": "object"}}`。名字照 OpenAI Agents SDK 的惯例起成 `transfer_to_<谁>`。
- `return "已转接技术支持"` 这个返回值其实用不上:下面节点里遇到交接工具不会真的调这个函数,而是自己拼一条 ToolMessage。定义成工具只是为了让模型知道「有这么个动作可以做」。
- `"system": "你是云簿账务专员,只处理扣款、发票、订阅、退款。遇到技术问题调用 transfer_to_tech。",` 系统提示词里写清边界和转给谁。职责划分写得模糊,就是踢皮球的源头。
- `"tools": [tool(find_customer), tool(list_invoices), transfer_to_tech],` `tool(函数)` 把 Day 281 的普通函数现场包成 LangChain 工具。实测 `tool(find_customer)` 是 `StructuredTool`,参数 schema 连 Day 281 写的说明都带过来了:`{"query": {"description": "客户邮箱、姓名、公司名或客户编号(如 C007),支持部分匹配", "title": "Query", "type": "string"}}`。
- `HANDOFFS: dict[str, Goto] = {"transfer_to_tech": "tech", "transfer_to_billing": "billing"}` 交接工具名 → 要跳去的节点名。
- `messages: Annotated[list[AnyMessage], add_messages]` 两个专员共享的完整历史。
- `active: NotRequired[str]  # 当前「接电话」的是谁,下一轮用户消息从它开始` 没有 reducer,每次直接覆盖。
- `def make_agent_node(name: Goto):` 工厂函数,和玩具图里的 `make_node` 是同一个思路。
- `llm = get_llm().bind_tools(cfg["tools"])` 每个专员只绑自己的工具。billing 看不到 `search_help_center`,tech 看不到发票工具,想用就只能转接。
- `tools_by_name = {t.name: t for t in cfg["tools"]}` 闭包变量,下面的 `node` 一直能用到它。闭包和 JS 的闭包是一回事。
- `prompt = [SystemMessage(cfg["system"]), *state["messages"]]` 自己的系统提示词加上共享的完整历史。系统提示词不存进 `messages`,每次调用现拼,所以两个专员读同一份历史时各自戴着自己的「工牌」。
- `if REMIND_ON_ARRIVAL and isinstance(last, ToolMessage) and last.content == f"已转接给 {name}":` 判断「我是不是刚被转接过来的」:历史最后一条是一条写着「已转接给我」的 ToolMessage。
- `prompt.append(SystemMessage(f"客户刚被转接给你({name})。现在由你直接处理客户最新的问题,该用工具就用工具。"))` 这一行是实跑后补的,没有它会出「坑二」那个怪现象。注意它只加在这次调用的 prompt 里,不写进共享历史。
- `reply = llm.invoke(prompt)` 实测第一轮 billing 先调 `find_customer(query="user007@example.com")`,再调 `list_invoices(customer_id="C007", limit=20)`,最后用一张表列出两笔 2392.00 元。
- `return Command(goto="__end__", update={"messages": [reply], "active": name})` 不调工具就是在回复用户,本轮结束,同时记下现在是谁在接电话。
- `goto: Goto = name  # 默认执行完工具回到自己` 普通工具执行完,下一步回到本节点,把工具结果交给模型继续。这就是每个专员节点内部的 Agent 循环:节点跳回自己,相当于循环的下一轮。
- `if call["name"] in HANDOFFS:` 交接工具不执行函数,只改跳转目标。
- `results.append(ToolMessage(content=f"已转接给 {goto}", tool_call_id=call["id"]))` 交接也必须回一条 ToolMessage,不回就是「坑一」的 400。上面判断「刚被转接」比较的就是这段文字。
- `out = tools_by_name[call["name"]].invoke(call["args"])` 普通工具照常执行。
- `except Exception as e:` Day 282 的函数查不到客户会抛 `ToolError`,这里接住变成文字,不让整张图崩掉。
- `return Command(goto=goto, update={"messages": [reply, *results], "active": goto})` `[reply, *results]` 把 AI 消息和它的所有工具结果拼成一个列表追加,相当于 JS 的 `[reply, ...results]`。实测第二轮:billing 调 `transfer_to_tech` → 返回 `Command(goto="tech")`,`active` 变成 tech → tech 节点调 `search_help_center`。
- `def route_entry(state: State) -> str:` 每轮从谁开始。实测空状态返回 `'billing'`,`active` 是 tech 时返回 `'tech'`。
- `def build():` 把建图包成函数,后面几个脚本每次都要一张新图(新的内存 checkpointer)。
- `config: RunnableConfig = {"configurable": {"thread_id": "chat-user007"}, "recursion_limit": 20}` 两轮对话共用一个 thread。`recursion_limit` 设 20 防踢皮球。
- `out = graph.invoke({"messages": [("user", text)]}, config)  # pyright: ignore[reportArgumentType]` `("user", text)` 是 LangChain 认的简写,会被转成一条用户消息。类型检查不认这种元组写法,所以加了 ignore。
- `print(f"用户:{text}\n[{out['active']}]({len(out['messages'])} 条消息):{out['messages'][-1].content}\n")` 方括号里是这一轮最后接电话的人。实测第一轮 `[billing]` 6 条,第二轮 `[tech]` 12 条。

</div>

```bash
uv run python handoff_graph.py
```

如果你像我一样在终端里开着代理(设了 `HTTPS_PROXY` 之类的环境变量),开头会先冒出一段 `langchain-openai detected HTTP_PROXY ...` 的 INFO 日志,来源和昨天一样:import server 时装上的 Rich 处理器把 `langchain_openai` 的 INFO 也打出来了。不影响结果,下面几个脚本里我用 `logging.getLogger("langchain_openai").setLevel(logging.WARNING)` 关掉了它。去掉日志后的输出:

```text
用户:我是 user007@example.com,10 月是不是扣了我两次钱?
[billing](6 条消息):刘静您好,我查了半岛咖啡(C007)的发票记录,确实存在重复扣款的情况:

**10 月有两笔相同金额的扣款:**
| 发票号 | 金额 | 开票日期 | 支付日期 | 状态 |
|---|---|---|---|---|
| INV-2026-0123 | 2392.00 元 | 2026-10-08 | 2026-10-08 | 已支付 |
| INV-2026-0026 | 2392.00 元 | 2026-10-08 | 2026-10-08 | 已支付 |

这两笔发票金额、开票日期和支付日期完全一致,属于同一天重复扣款,多扣了 **2392.00 元**。

**其他月份正常:** 9 月(INV-2026-0027)、8 月(INV-2026-0028)、7 月(INV-2026-0029)各只有一笔 2392.00 元,没有异常。

需要我为您提交这笔 2392.00 元的退款申请吗?确认后我会按原支付渠道办理。

用户:另外导出年度报表一直 ERR_EXPORT_TIMEOUT 怎么办
[tech](12 条消息):关于导出报错,我查到了官方说明:

**ERR_EXPORT_TIMEOUT 原因:** 年度报表数据量较大时,导出会超过系统 60 秒的限制,因此报超时。

**两种解决办法:**
1. **按季度分四次导出**:把年度报表拆成 Q1、Q2、Q3、Q4 分别导出,每次数据量小,不会超时。
2. **开启后台导出**:进入「设置 → 导出」,打开后台导出开关。系统会在后台生成报表,完成后通过邮件通知您下载,不受 60 秒限制。

建议您优先用第 2 种方式,一次就能拿到完整年度报表。

另外,刚才 10 月重复扣款 2392.00 元的退款,还需要我帮您提交吗?
```

两个专员各自直接回复客户。发票号全对,没有主管转述那一步,也就没出现昨天的 INV-2026-0126。

但也有新问题。两边都问客户「需要我帮您提交退款吗」,其实谁手上都没有 `create_refund_request` 工具,这是一个兑现不了的承诺。tech 的最后一句更说明了交接模式的一个副作用:它看得到完整历史,于是也想顺手处理历史里的账务问题,越过了自己的职责边界。共享上下文让接手的人「什么都知道」,也让它「什么都想管」。

## 看一眼共享历史

上面只打印了每轮最后一条。把三轮对话之后的完整历史逐条打出来,看交接在消息里留下了什么痕迹:

```python
# agent-zero-lab/part05/multi/handoff_trace.py
"""把三轮对话后的共享历史逐条打出来,看交接在消息里留下了什么。"""
import logging

from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig

import handoff_graph as hg

logging.getLogger("langchain_openai").setLevel(logging.WARNING)  # 开着代理时它会打一段 INFO

graph = hg.build()
config: RunnableConfig = {"configurable": {"thread_id": "trace-1"}, "recursion_limit": 20}
for text in [*hg.TURNS, "那多扣的钱什么时候能退回来?"]:
    out = graph.invoke({"messages": [("user", text)]}, config)  # pyright: ignore[reportArgumentType]
    print(f"--- 用户:{text} → 结束时 active={out['active']},共 {len(out['messages'])} 条")
for i, m in enumerate(graph.get_state(config).values["messages"], 1):
    if isinstance(m, AIMessage) and m.tool_calls:
        body = "调用 " + ", ".join(f"{c['name']}({c['args']})" for c in m.tool_calls)
    else:
        body = str(m.content).replace("\n", " ")[:60]
    print(f"{i:>2} {m.type:<5} {body}")
```

<div class="line-notes">

- `import handoff_graph as hg` 复用建图函数和两轮问题。
- `for text in [*hg.TURNS, "那多扣的钱什么时候能退回来?"]:` 在两轮之后加第三轮:又回到账务问题。`[*a, b]` 相当于 JS 的 `[...a, b]`。
- `for i, m in enumerate(graph.get_state(config).values["messages"], 1):` 从 checkpointer 里取出最终的完整历史,序号从 1 开始。
- `if isinstance(m, AIMessage) and m.tool_calls:` AI 消息如果带工具调用,打印调了什么;否则打印内容的前 60 个字。
- `print(f"{i:>2} {m.type:<5} {body}")` `m.type` 是消息类型,`human`、`ai`、`tool` 三种。

</div>

```text
--- 用户:我是 user007@example.com,10 月是不是扣了我两次钱? → 结束时 active=billing,共 6 条
--- 用户:另外导出年度报表一直 ERR_EXPORT_TIMEOUT 怎么办 → 结束时 active=tech,共 12 条
--- 用户:那多扣的钱什么时候能退回来? → 结束时 active=billing,共 18 条
 1 human 我是 user007@example.com,10 月是不是扣了我两次钱?
 2 ai    调用 find_customer({'query': 'user007@example.com'})
 3 tool  [{'id': 'C007', 'name': '刘静', 'email': 'user007@example.com'
 4 ai    调用 list_invoices({'customer_id': 'C007', 'limit': 20})
 5 tool  [{'id': 'INV-2026-0123', 'amount_cents': 239200, 'status': '
 6 ai    刘静您好,我查了半岛咖啡(C007)的发票记录,确实存在两笔 10 月 8 日的扣款:  | 发票号 | 金额 | 开票
 7 human 另外导出年度报表一直 ERR_EXPORT_TIMEOUT 怎么办
 8 ai    调用 transfer_to_tech({})
 9 tool  已转接给 tech
10 ai    调用 search_help_center({'keyword': 'ERR_EXPORT_TIMEOUT 导出超时'})
11 tool  【ERR_EXPORT_TIMEOUT】导出超时:年度报表数据量大时会超过 60 秒限制。解决:按季度分四次导出,或在「
12 ai    关于导出报错,我查到原因和解决办法:  **ERR_EXPORT_TIMEOUT** 是导出超时——年度报表数据量大,超
13 human 那多扣的钱什么时候能退回来?
14 ai    调用 transfer_to_billing({})
15 tool  已转接给 billing
16 ai    调用 list_invoices({'customer_id': 'C007', 'status': 'paid', 'limit': 20})
17 tool  [{'id': 'INV-2026-0123', 'amount_cents': 239200, 'status': '
18 ai    目前两笔 10 月 8 日的扣款(INV-2026-0123 和 INV-2026-0026,各 2392 元)状态都还
```

每轮 6 条,很规整:用户一条,中间若干对「AI 调工具 + 工具结果」,最后一条 AI 回复。第 8、9 条和第 14、15 条就是交接留下的痕迹:一次没有参数的工具调用,加一条「已转接给 xxx」。

第 16 条值得注意:billing 第三轮接手后,直接用 `customer_id="C007"` 查发票,没有再调 `find_customer`。C007 这个编号它是从第 3 条历史里看到的,那是第一轮它自己查出来的。这就是共享历史的好处。我又跑了一次同样的三轮,那次 billing 接手后还是重新调了一次 `find_customer`,两种都会出现;但至少它**有机会**复用,主管模式里的专员连这个机会都没有。

那次重跑的第三轮回复里,billing 写了「一般到账时效为提交后 3–5 个工作日」。昨天的问题在这里一样存在:账务专员手上没有退款政策,就自己补了一个数。交接解决了「转述出错」,解决不了「专员缺工具时自己编」。

## 坑一:交接也要回 ToolMessage

`node` 里遇到交接工具时,我们没有执行函数,但还是往历史里补了一条 `ToolMessage(content="已转接给 tech", tool_call_id=...)`。如果不补会怎样?不用跑整张图,直接拼一段「AI 发出交接调用,但后面没有工具结果」的历史,丢给模型:

```python
# agent-zero-lab/part05/multi/handoff_400.py
"""故意制造新手写 handoff 最常见的报错:交接调用之后没有回 ToolMessage。"""
import sys
from pathlib import Path

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

sys.path.insert(0, str(Path(__file__).parents[1] / "lgdemo"))
from llm import get_llm  # noqa: E402  # pyright: ignore[reportMissingImports]

history = [
    SystemMessage("你是云簿技术支持。"),
    HumanMessage("导出年度报表一直 ERR_EXPORT_TIMEOUT 怎么办"),
    AIMessage("", tool_calls=[{"name": "transfer_to_tech", "args": {}, "id": "call_1"}]),
    # 少了这一条:ToolMessage(content="已转接给 tech", tool_call_id="call_1")
]
try:
    get_llm().invoke(history)
except Exception as e:
    print(type(e).__name__, str(e)[:300])
```

<div class="line-notes">

- `AIMessage("", tool_calls=[{"name": "transfer_to_tech", "args": {}, "id": "call_1"}]),` 模拟 billing 刚刚发出的交接调用。`id` 是这次调用的编号,对应的工具结果必须带上同一个编号。
- `# 少了这一条:ToolMessage(content="已转接给 tech", tool_call_id="call_1")` 这就是我们在 `node` 里补的那一条。
- `get_llm().invoke(history)` 这时 tech 节点拿着这份历史去调模型。
- `print(type(e).__name__, str(e)[:300])` 打印异常类名和前 300 个字。

</div>

```bash
uv run python handoff_400.py
```

```text
OpenAIInvalidRequestError Error code: 400 - {'error': {'message': "An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. (insufficient tool messages following tool_calls message) (request_id: c83debb0-6a23-42a3-ac51-5e5e05900a10)", 'type': 'invalid_request_error', 'param'
```

和 [Day 161](/blog/agent-zero/day-161-missing-result/) 演示过的是同一个报错:**带 tool_calls 的 assistant 消息后面,必须跟着回应每个 tool_call_id 的 tool 消息**。交接调用在模型眼里也是一次工具调用,它不关心你有没有真的执行函数,只关心历史格式对不对。这是写 handoff 时最常见的报错,因为交接「看起来不像工具」,很容易忘了回结果。

## 坑二:接手的人以为自己是转出方

`node` 里那段「刚被转接过来就提醒一句」是我实跑后补的。把开关关掉,第二轮跑 3 次,看 tech 接手后会不会去查帮助中心:

```python
# agent-zero-lab/part05/multi/handoff_no_remind.py
"""去掉「刚被转接」那句提醒,第二轮跑 3 次,看技术支持接手后会不会去查帮助中心。"""
import logging

from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig

import handoff_graph as hg

logging.getLogger("langchain_openai").setLevel(logging.WARNING)
hg.REMIND_ON_ARRIVAL = False

for i in range(1, 4):
    graph = hg.build()
    config: RunnableConfig = {"configurable": {"thread_id": f"no-remind-{i}"}, "recursion_limit": 20}
    for text in hg.TURNS:
        graph.invoke({"messages": [("user", text)]}, config)  # pyright: ignore[reportArgumentType]
    messages = graph.get_state(config).values["messages"]
    calls = [c["name"] for m in messages[6:] if isinstance(m, AIMessage) for c in m.tool_calls]
    last = str(messages[-1].content).replace("\n", " ")[:70]
    print(f"第 {i} 次:第二轮的工具调用 {calls}\n  最后一句:{last}")
```

<div class="line-notes">

- `hg.REMIND_ON_ARRIVAL = False` 改模块里的全局变量。`node` 每次被调用时才读它,所以在 `build()` 之前或之后改都生效。
- `graph = hg.build()` 每次都建一张新图,三次之间互不影响。
- `calls = [c["name"] for m in messages[6:] if isinstance(m, AIMessage) for c in m.tool_calls]` 两层推导式:先遍历第二轮的消息,再遍历每条 AI 消息里的工具调用,收集工具名。`messages[6:]` 是从第 7 条开始,因为我实跑的第一轮都正好是 6 条;你的第一轮如果不是 6 条,这里要改。
- `last = str(messages[-1].content).replace("\n", " ")[:70]` 第二轮最后一条回复的前 70 个字。

</div>

```text
第 1 次:第二轮的工具调用 ['transfer_to_tech']
  最后一句:已为您转接技术支持,他们会跟进 ERR_EXPORT_TIMEOUT 导出超时的问题。  另外提醒一下,刚才 10 月重复扣款 2392.0
第 2 次:第二轮的工具调用 ['transfer_to_tech']
  最后一句:已为您转接技术支持,他们会跟进 ERR_EXPORT_TIMEOUT 导出超时的问题。  另外提醒一下,刚才 10 月重复扣款 **2392
第 3 次:第二轮的工具调用 ['transfer_to_tech']
  最后一句:已为您转接技术支持,他们会跟进 ERR_EXPORT_TIMEOUT 导出超时的问题。  另外提醒一下,刚才 10 月重复扣款 2392.0
```

三次全一样:billing 转出之后,tech 接手,却一个工具都没调,只回了一句「已为您转接技术支持,他们会跟进」,然后本轮结束。客户的问题没人回答。

原因要从 tech 看到的历史里找。它的 prompt 是自己的系统提示词,加上共享历史;历史最后两条是「AI 调用 transfer_to_tech」和「已转接给 tech」。那条 AI 消息是 billing 发的,但历史里的 AI 消息不标记是谁发的,在 tech 眼里,「刚才调用转接的那个 AI」就是它自己。于是它顺理成章地以为自己刚把客户转走了,该做的就是告诉客户「已为您转接」。

把开关打开,同样跑 3 次:

```text
第 1 次:第二轮的工具调用 ['transfer_to_tech', 'search_help_center']
  最后一句:关于导出年度报表报 **ERR_EXPORT_TIMEOUT**,原因和解决办法如下:  **原因:** 年度报表数据量较大,导出耗时超过系
第 2 次:第二轮的工具调用 ['transfer_to_tech', 'search_help_center']
  最后一句:关于导出报错,帮您查到原因和解决办法:  **ERR_EXPORT_TIMEOUT 原因**:年度报表数据量大,导出耗时超过系统 60 秒限
第 3 次:第二轮的工具调用 ['transfer_to_tech', 'search_help_center']
  最后一句:关于导出年度报表报 **ERR_EXPORT_TIMEOUT**,原因和解决办法如下:  **原因**:年度报表数据量大,导出任务超过了 6
```

三次都正常查了帮助中心。我先试过把这句提醒写进 tech 开头的系统提示词里,没用;放到消息列表**末尾**才管用。模型对最靠近末尾的指令最敏感,一句「现在由你处理」放在最后,压过了历史里那条「我刚转接了」的错觉。

这个坑的根子是:**多个 Agent 共享一份历史时,历史里的 AI 消息不带身份。** 框架们的解法各不相同:有的在交接时给历史加一条说明,有的把别的 Agent 的消息改写成「某某说:」的形式,OpenAI Agents SDK 提供了 `input_filter`,让你在交接时改写接手方看到的历史。思路都一样,让接手的人知道「哪些话不是我说的」。

## 和主管派活比一比

把两种拓扑放在一起:

| | 主管派活(Day 330) | 专员交接(今天) |
| --- | --- | --- |
| 谁面对用户 | 只有主管 | 当前接电话的专员 |
| 专员看到什么 | 主管写的一句任务 | 完整对话历史 |
| 有没有转述 | 有,两次(派活、汇总) | 没有 |
| 上下文隔离 | 有 | 没有,历史越聊越长 |
| 并行 | 能同时派两个活 | 一次只有一个人在线 |
| 典型失败 | 转述时编造、漏信息 | 踢皮球、接手方身份混乱、越界 |
| 适合 | 一次性查询、能拆开的调研 | 多轮对话、话题会在领域之间跳 |

练习 2 会给交接版记账。我实跑同样两件事(分两轮问),交接版是 6 次调用、6615 token、约 0.0075 元;昨天主管版是 7 次调用、7854 token、0.0234 元。token 只少了一点,钱却便宜了三倍,原因是共享历史的前缀一直不变,DeepSeek 的缓存命中了 4736 个输入 token,而主管版每个专员都从一份新 messages 开始,缓存命中少。LangChain 的多 Agent 文档里有一张对比表,同样的结论:一次性请求两者差不多,同一个用户接着问时交接模式更省,因为不用再经过主管。

## 其他几种模式,一句话版

LangChain 的多 Agent 文档把常见做法分成五类。昨天的主管派活它叫 subagents,今天的是 handoffs,另外三种只需要知道名字和用途:

**Router(路由)。** 先有一个分类步骤决定把请求交给哪个(或哪几个)专门的 Agent,再把结果合起来。分类可以是规则,也可以是一次模型调用。[Day 312](/blog/agent-zero/day-312-lg-workflow/) 的工单分类图就是一个 router,只是分支里还没放 Agent。和主管模式的区别是,路由那一步不是一个会循环、会写任务描述的 Agent,所以更便宜,也更死板。练习 3 写一个。

**Skills(技能)。** 只有一个 Agent,它按需加载不同领域的提示词和资料。效果上像多 Agent(有「账务模式」「技术模式」),成本上像单 Agent。[Day 296](/blog/agent-zero/day-296-skills-1/) 和 [Day 297](/blog/agent-zero/day-297-skills-2/) 讲的 Agent Skills 就是这个思路。很多人以为要多 Agent 的场景,其实一个会加载 skill 的单 Agent 就够了。

**Custom workflow(自定义流程)。** 用 LangGraph 自己编排,确定性步骤和 Agent 步骤混着用。第五部分末尾的工单分流小项目和第八部分的毕业项目 SupportPilot 都是这一类。实际上线的系统,大多数最后都长成这个样子。

还有一个常被一起问的词:**A2A(Agent2Agent)协议**。它解决的是「不同公司、不同框架做的 Agent 之间怎么通信」:每个 Agent 发布一张 Agent Card,声明自己能干什么、怎么调用,其他 Agent 按协议发任务、收结果。Google 2025 年 4 月发起,同年 6 月捐给 Linux 基金会;2026 年 3 月发布了第一个稳定版 1.0。Linux 基金会 2026 年 4 月的新闻稿说已有 150 多家组织支持,微软 Azure AI Foundry、亚马逊 Bedrock AgentCore 等平台已经集成(这是二手的新闻稿口径,以 [a2a-protocol.org](https://a2a-protocol.org/) 为准)。今天和昨天的拓扑都在同一个进程里,用不到 A2A;等你要调用别的团队、别的公司部署的 Agent 时才轮到它。面试里能说清「MCP 连工具和数据,A2A 连 Agent 和 Agent」就够了。

## 动手练习

**练习 1:交接次数上限。** 在玩具图的基础上写 `ex331_hops.py`:状态里加一个 `hops` 字段记这一轮转了几次;某个专员要转出时,如果这一轮已经转过 2 次,就不再转,回复「帮您转人工客服」并结束本轮;有人认领或转人工时把 `hops` 清零。用「你好,在吗」和「导出报表报错」两轮验证。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/multi/ex331_hops.py
"""练习 1:给玩具交接图加「交接次数」,同一轮里转了 2 次还没人接,就转人工。"""
import operator
from typing import Annotated

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import START, StateGraph
from langgraph.types import Command
from typing_extensions import NotRequired, TypedDict

from handoff_toy import MINE, OTHER, Goto

MAX_HOPS = 2


class State(TypedDict):
    messages: Annotated[list[str], operator.add]
    active: NotRequired[str]
    hops: NotRequired[int]  # 这一轮已经转了几次


def make_node(name: Goto):
    def node(state: State) -> Command[Goto]:
        question = [m for m in state["messages"] if m.startswith("用户:")][-1]
        if any(w in question for w in MINE[name]):
            reply = f"{name}:这个归我,我来处理「{question[3:]}」"
            return Command(goto="__end__", update={"messages": [reply], "active": name, "hops": 0})
        hops = state.get("hops", 0) + 1
        if hops > MAX_HOPS:
            msg = f"{name}:已经转了 {MAX_HOPS} 次还没人能接,帮您转人工客服"
            return Command(goto="__end__", update={"messages": [msg], "active": "billing", "hops": 0})
        other = OTHER[name]
        return Command(goto=other, update={"messages": [f"{name}:不归我管,转给 {other}"], "active": other, "hops": hops})
    return node


builder = StateGraph(State)
builder.add_node("billing", make_node("billing"))
builder.add_node("tech", make_node("tech"))
builder.add_conditional_edges(START, lambda s: s.get("active") or "billing", ["billing", "tech"])
graph = builder.compile(checkpointer=InMemorySaver())

config: RunnableConfig = {"configurable": {"thread_id": "toy-hops"}, "recursion_limit": 6}
for text in ["你好,在吗", "导出报表报错"]:
    out = graph.invoke({"messages": [f"用户:{text}"]}, config)
    print(f"本轮结束 active={out['active']} hops={out['hops']}")
for m in out["messages"]:
    print("  ", m)
```

<div class="line-notes">

- `from handoff_toy import MINE, OTHER, Goto` 复用玩具图的词表、转给谁和类型别名。
- `hops: NotRequired[int]  # 这一轮已经转了几次` 没有 reducer,每次覆盖。
- `return Command(goto="__end__", update={"messages": [reply], "active": name, "hops": 0})` 有人认领时清零。不清零的话,下一轮一开始就带着上一轮的次数,转一次就触发转人工。
- `hops = state.get("hops", 0) + 1` 要转出了,先算这是第几次。`get` 带默认值,第一轮没有这个键时当 0。
- `if hops > MAX_HOPS:` 第 3 次要转时拦下。所以一轮里最多出现两条「不归我管」。
- `return Command(goto="__end__", update={"messages": [msg], "active": "billing", "hops": 0})` 转人工后本轮结束。`active` 设回默认的 billing,下一轮重新从账务开始;真实系统里这里应该把会话标记成「等人工」,并通知人工客服。
- `"active": other, "hops": hops})` 正常转出时把次数写回状态,下一个节点读得到。

</div>

```bash
uv run python ex331_hops.py
```

```text
本轮结束 active=billing hops=0
本轮结束 active=tech hops=0
   用户:你好,在吗
   billing:不归我管,转给 tech
   tech:不归我管,转给 billing
   billing:已经转了 2 次还没人能接,帮您转人工客服
   用户:导出报表报错
   billing:不归我管,转给 tech
   tech:这个归我,我来处理「导出报表报错」
```

第一轮转了两次之后停下来转人工,没有撞 `recursion_limit`;第二轮从清零开始,正常转一次就被 tech 认领。真模型版本可以照这个改:`hops` 放进 `State`,在 `node` 里处理交接工具的地方判断。

</details>

**练习 2:给交接版记账。** 写 `ex331_ledger.py`:用 `handoff_graph.py` 跑同样两轮,然后遍历最终历史里的每条 `AIMessage`,把 `usage_metadata` 里的输入、输出、缓存命中加起来,按 `mini_agent.py` 的三档价格算钱。和昨天 `supervisor.py` 的 7854 token、0.0234 元比。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/multi/ex331_ledger.py
"""练习 2:给交接版记账。每条 AIMessage 上都挂着 usage_metadata,加起来就是总账。"""
import logging

from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig

import handoff_graph as hg
from mini_agent import HIT, MISS, OUT

logging.getLogger("langchain_openai").setLevel(logging.WARNING)

graph = hg.build()
config: RunnableConfig = {"configurable": {"thread_id": "ledger-1"}, "recursion_limit": 20}
for text in hg.TURNS:
    graph.invoke({"messages": [("user", text)]}, config)  # pyright: ignore[reportArgumentType]

calls = inp = hit = out = 0
for m in graph.get_state(config).values["messages"]:
    if isinstance(m, AIMessage) and m.usage_metadata:
        u = m.usage_metadata
        calls += 1
        inp += u["input_tokens"]
        out += u["output_tokens"]
        hit += u.get("input_token_details", {}).get("cache_read", 0)
cost = (hit * HIT + (inp - hit) * MISS + out * OUT) / 1_000_000
print(f"交接版两轮:{calls} 次调用,输入 {inp}(命中缓存 {hit}),输出 {out},合计 {inp + out} token,约 {cost:.4f} 元")
```

<div class="line-notes">

- `from mini_agent import HIT, MISS, OUT` 复用昨天从 `.env` 读出来的三档价格,0.04、2、8。
- `if isinstance(m, AIMessage) and m.usage_metadata:` 每次调模型产生一条 AIMessage,LangChain 把那次调用的用量挂在它的 `usage_metadata` 上。数 AIMessage 就是数调用次数。
- `inp += u["input_tokens"]` 实测每条的形状是 `{'input_tokens': 556, 'output_tokens': 50, 'total_tokens': 606, 'input_token_details': {'cache_read': 384}, ...}`。
- `hit += u.get("input_token_details", {}).get("cache_read", 0)` 缓存命中藏在 `input_token_details.cache_read` 里,不一定有,所以两层都用 `get` 带默认值。
- `cost = (hit * HIT + (inp - hit) * MISS + out * OUT) / 1_000_000` 和 `Usage.cost` 同一个公式。

</div>

两次实跑:

```text
交接版两轮:6 次调用,输入 6020(命中缓存 4736),输出 595,合计 6615 token,约 0.0075 元
交接版两轮:6 次调用,输入 6036(命中缓存 4992),输出 595,合计 6631 token,约 0.0070 元
```

第一次的算式:4736 × 0.04 + (6020 − 4736) × 2 + 595 × 8 = 189 + 2568 + 4760 = 7517,除以一百万约 0.0075 元。和主管版比,token 少了 16%(6615 对 7854),钱少了三分之二(0.0075 对 0.0234)。主要差在缓存:交接版的 6 次调用读的是同一份不断追加的历史,前缀稳定,4736 / 6020 ≈ 79% 的输入命中缓存;主管版每个专员的 messages 都是新建的,命中少得多。今天调模型的所有实跑(`handoff_graph.py` 一次、`handoff_trace.py` 两次、坑一一次、坑二六次、这个练习两次、练习 3 一次)加起来约 0.08 元。

</details>

**练习 3:写一个 router。** 不要主管,也不要交接:先用关键词规则判断问题属于 billing、tech 还是两者都有,再把**客户原话**直接交给对应的专员(用昨天 `supervisor.py` 里的 `billing` 和 `tech` 两个 `MiniAgent`),两边并行,最后把两段回答拼起来。跑一次,看拼出来的东西能不能直接发给客户。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/multi/ex331_router.py
"""练习 3:Router 模式。不要主管,先用规则分类,再把原话直接交给对应专员,结果拼起来。"""
import asyncio

import supervisor as sv

RULES = {"billing": ["扣", "发票", "退款", "订阅"], "tech": ["报错", "导出", "登录", "ERR_"]}


def route(question: str) -> list[str]:
    return [name for name, words in RULES.items() if any(w in question for w in words)]


async def main(question: str) -> None:
    targets = route(question)
    print("分给:", targets)
    agents = {"billing": sv.billing, "tech": sv.tech}
    answers = await asyncio.gather(*(agents[t].run(question) for t in targets))
    for t, a in zip(targets, answers):
        print(f"\n【{t}】{a[:120]}……")
    print()
    sv.print_ledger(tuple(agents[t] for t in targets))


if __name__ == "__main__":
    asyncio.run(main(sv.QUESTION))
```

<div class="line-notes">

- `RULES = {"billing": ["扣", "发票", "退款", "订阅"], "tech": ["报错", "导出", "登录", "ERR_"]}` 路由规则。真实系统里这一步常换成一次便宜模型的分类调用,[Day 312](/blog/agent-zero/day-312-lg-workflow/) 用的就是结构化输出分类。
- `def route(question: str) -> list[str]:` 返回命中的所有专员。客户的问题两类都有,结果是 `['billing', 'tech']`。
- `answers = await asyncio.gather(*(agents[t].run(question) for t in targets))` 两个专员并行,收到的都是**客户原话**,不是主管写的任务。
- `sv.print_ledger(tuple(agents[t] for t in targets))` `tuple(生成器)` 把生成器转成元组,`print_ledger` 要的是元组。

</div>

```bash
uv run python ex331_router.py
```

```text
分给: ['billing', 'tech']

【billing】## 一、10 月扣款情况:确实被扣了两次

我查了发票记录,10 月份有两张发票,都是已支付状态,金额相同、开票日期和支付日期也相同:

| 发票号 | 金额 | 状态 | 开票日期 | 支付日期 |
|---|---|---|---|-……

【tech】两件事的结论如下:

**1. 10 月重复扣费——我这边查不了,需要转二线**

帮助中心没有关于扣费、账单核对的相关文档,而且我作为技术支持也没有权限查询账户的扣款记录。这类问题需要转二线处理。

麻烦你提供一下,方便二线核实:
- 注……

agent    calls  tokens        元
billing      3    2958    0.0079
tech         2    1273    0.0038
合计         5    4231    0.0117
```

账很好看:5 次调用、4231 token、0.0117 元,比主管版便宜一半,因为省掉了主管的两次调用。但拼出来的东西不能直接发给客户:两个专员拿到的都是客户的完整原话,tech 也认真地回答了扣款那一半,说「我这边查不了,需要转二线」,和 billing 的「确实被扣了两次」放在一起,客户会以为两个客服说法打架。

这就是 router 便宜的代价:没有人把问题拆开,也没有人把答案合起来。改法有两种:路由时顺便把问题拆成两段,只把属于各自的那段交过去;或者最后加一次模型调用做汇总。前者需要分类器多输出一点东西,后者又慢慢长回了主管模式。

</details>

**练习 4:选拓扑。** 下面三个场景,各选主管派活、专员交接、router、单 Agent 加 skills 中的哪一种,写一两句理由。(1)云簿网页右下角的在线客服,客户经常聊十几轮,话题在账单和功能之间来回跳。(2)客户成功团队每周一要一份报告:分别汇总 30 个大客户上周的用量、工单和发票异常。(3)一个内部工具,员工输入一句话,系统要么查发票、要么查帮助中心,两类问题几乎不会同时出现。

<details><summary>参考答案</summary>

(1)专员交接。多轮、客户直接和专员来回聊、话题会跳,正是交接的场景;需要做好交接次数上限(练习 1)、接手提醒(坑二)和每个专员的职责边界。如果两个领域的工具加起来不多,单 Agent 加 skills 也可以,还能省掉身份混乱的问题。

(2)主管派活。30 个客户互不依赖,是典型的「能拆开的调研」:主管把客户分批派给几个子 Agent 并行汇总,每个子 Agent 读大量用量和工单数据,只交回几行结论,主管的上下文保持干净。这正是 Anthropic 研究系统那种形状,多花的 token 换来的是并行和上下文隔离。

(3)Router。两类问题几乎不会同时出现,一次分类就能决定交给谁,不需要主管来回调度;规则或一次便宜的分类调用就够了,出错时也容易查。如果后来发现两类问题经常混在一起,再考虑升级。

</details>

验收标准:`handoff_toy.py`、`handoff_pingpong.py`、`ex331_hops.py` 三个不调模型的脚本输出和上面完全一致;`handoff_graph.py` 两轮分别停在 billing 和 tech;能复现坑一的 400 原文,能用 `REMIND_ON_ARRIVAL` 开关复现坑二并修好。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 专员交接(handoff) | 当前 Agent 调用一个 `transfer_to_xxx` 工具,把整个对话转给另一个 Agent,接手方看得到完整历史并直接回复用户 |
| `transfer_to_xxx` 工具 | 没有参数的「转接」工具,模型调用它表示要交接。OpenAI Agents SDK 默认按 `transfer_to_<Agent 名>` 命名 |
| `active` | 状态里记「现在是谁在接电话」的字段,配合 checkpointer,下一轮从它开始 |
| 踢皮球(ping-pong) | 两个 Agent 都觉得不归自己管,互相转来转去,最后撞上 `recursion_limit` |
| `GraphRecursionError` | LangGraph 走的步数超过 `recursion_limit` 时抛的异常,[Day 308](/blog/agent-zero/day-308-lg-loop/) 见过 |
| `usage_metadata` | LangChain 挂在每条 AIMessage 上的用量:输入、输出 token,`input_token_details.cache_read` 是缓存命中 |
| Router(路由) | 先分类再分发给专门的 Agent,分类那一步不是 Agent。便宜但死板 |
| Skills | 单个 Agent 按需加载不同领域的提示词和资料,像多 Agent,成本像单 Agent |
| Custom workflow | 用 LangGraph 自己编排,确定性步骤和 Agent 步骤混用 |
| A2A(Agent2Agent)协议 | 不同公司、不同框架的 Agent 之间通信的开放协议,靠 Agent Card 声明能力;2026 年 3 月出了 1.0 |
| Agent Card | A2A 里每个 Agent 发布的「名片」,写明自己能做什么、怎么调用 |
| `input_filter` | OpenAI Agents SDK 交接时用来改写接手方看到的历史的函数 |

## 常见误区

**交接工具没有真的执行,就不回 ToolMessage。** 模型只认历史格式:带 tool_calls 的 assistant 消息后面必须跟着每个 tool_call_id 的结果。漏了就是 `insufficient tool messages following tool_calls message` 的 400。

**以为共享了历史,接手的 Agent 自然知道自己是谁。** 历史里的 AI 消息不带身份,tech 接手后把 billing 的转接动作当成自己的,3 次里 3 次只回「已为您转接」。在接手那次调用的消息末尾加一句「现在由你处理」,或者在交接时改写历史。

**把提醒写进系统提示词开头就以为够了。** 我试过,没用。模型更听最靠近末尾的那句话,提醒要放在 prompt 的最后。

**只靠 `recursion_limit` 防踢皮球。** 撞上它时用户什么都拿不到,只有一个异常。要在状态里记交接次数,超过上限转人工。

**以为交接模式没有编造问题。** 交接去掉了「转述」这一步,发票号不再抄错;但专员缺工具时照样自己编,第三轮账务专员写了「3–5 个工作日」。编造的根子是缺事实来源,不是拓扑。

**Router 把客户原话原样分给每个专员。** 每个专员都会回答整句话,tech 也去回答扣款问题,拼起来互相矛盾。要么路由时拆分问题,要么最后汇总。

**把 A2A 和 MCP 当成竞争关系。** MCP 让一个 Agent 连上工具和数据,A2A 让 Agent 和别的 Agent 通信,一个系统里两个可以同时用。

## 学习资料

### 文档与文章

- [LangChain · Handoffs](https://docs.langchain.com/oss/python/langchain/multi-agent/handoffs):LangChain 对交接模式的说明,用的也是「工具调用改状态」的思路,和今天的 `Command(goto)` 对照看,15 分钟。
- [LangChain · Multi-agent](https://docs.langchain.com/oss/python/langchain/multi-agent):五种模式的总览和那张调用次数、token 对比表,读完能把今天「其他几种模式」那一节补全,15 分钟。
- [LangChain · Router](https://docs.langchain.com/oss/python/langchain/multi-agent/router):练习 3 的正式版,看它怎么处理「多个专员的结果怎么合」,10 分钟。
- [OpenAI Agents SDK · Handoffs](https://openai.github.io/openai-agents-python/handoffs/):`transfer_to_<名字>` 的命名惯例、接手方默认看到全部历史、`input_filter` 怎么改写历史,都在这一页,15 分钟。
- [LangGraph · Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api):找到 Command 那一节,复习「返回类型标注告诉框架可能跳到哪」,10 分钟。
- [A2A Protocol](https://a2a-protocol.org/):A2A 官方站,先看首页的概念介绍和 Agent Card 的样子,不用读规范全文,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ajXkY2Edx&autoplay=0&high_quality=1" title="OpenAI Agents SDK 轻量级多智能体框架 基于大模型构建多智能体工作流" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>唐国梁Tommy · OpenAI Agents SDK 轻量级多智能体框架 基于大模型构建多智能体工作流 · 17 分钟,用 OpenAI Agents SDK 演示多智能体,看它的 handoff 是怎么声明的,和今天手写的 transfer 工具对照。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1yCaw6YECn&autoplay=0&high_quality=1" title="面试官问:A2A协议和MCP的区别是什么?在多Agent系统中它们分别负责什么?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>图灵诸葛讲Java · 面试官问:A2A协议和MCP的区别是什么?在多Agent系统中它们分别负责什么? · 5 分钟,面试向,正好对应今天最后那句「MCP 连工具,A2A 连 Agent」。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/WTr6mHTw5cM" title="Understanding multi-agent handoffs" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Understanding multi-agent handoffs · 英文,LangChain 官方讲交接的原理,看它怎么用 Command 在 Agent 之间跳转、交接时历史怎么处理。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LuarehusOWU" title="OpenAI Agents SDK Handoffs | Deep Dive Tutorial" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>James Briggs · OpenAI Agents SDK Handoffs | Deep Dive Tutorial · 英文,把 OpenAI Agents SDK 的 handoff 和「把 Agent 当工具」放在一起比,正好是昨天和今天两种拓扑的对照。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):第 6 章 Agent 部分讲工具和规划,读的时候想一想「交接工具」算哪一类工具,英文原版。
- Michael Wooldridge《An Introduction to MultiAgent Systems》(第 2 版,Wiley,2009):Agent 之间怎么通信、怎么分配任务是这门老学科的核心问题,A2A 这类协议在里面能找到不少前身。翻目录挑「通信」相关章节,英文原版。

### 开源项目与代码

- [langchain-ai/langgraph-swarm-py](https://github.com/langchain-ai/langgraph-swarm-py):LangChain 的 swarm 库,就是今天这种「专员互相交接、记住最后是谁在线」的封装,看它的 `create_handoff_tool` 和今天手写的 transfer 工具差在哪。
- [openai/openai-agents-python](https://github.com/openai/openai-agents-python):搜 `handoff` 和 `input_filter`,看官方怎么处理「接手方看到什么历史」这个问题,也就是今天的坑二。
- [openai/swarm](https://github.com/openai/swarm):OpenAI 2024 年的教学项目,handoff 这个说法就是它带火的,代码很短;现在 OpenAI 推荐用 Agents SDK 代替它,只用来读思路。

## 自测

1. 专员交接和主管派活,在「专员能看到什么」「谁面对用户」两点上有什么区别?各适合什么场景?

<details><summary>答案</summary>

主管派活里专员只看到主管写的一句任务,只有主管面对用户,适合一次性查询和能拆开的调研。交接里接手的专员看到完整对话历史,并且直接回复用户,适合多轮对话、话题会在领域之间跳的场景。

</details>

2. `node` 里遇到 `transfer_to_tech` 时没有执行函数,为什么还要往历史里加一条 ToolMessage?不加会怎样?

<details><summary>答案</summary>

对模型来说,交接也是一次工具调用。OpenAI 兼容接口要求带 tool_calls 的 assistant 消息后面,每个 tool_call_id 都要有对应的 tool 消息。不加的话,下一次调模型直接 400:`An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'`。

</details>

3. 去掉「刚被转接」的提醒后,tech 接手为什么只回「已为您转接技术支持」?你会怎么修?

<details><summary>答案</summary>

共享历史里的 AI 消息不带身份,tech 看到最后两条是「AI 调用 transfer_to_tech」和「已转接给 tech」,以为调用转接的是自己,于是告诉客户已转接。修法是在接手那次调用的 prompt **末尾**加一句「客户刚被转接给你,现在由你处理」;或者在交接时改写历史,把别的 Agent 的消息标上身份(OpenAI Agents SDK 的 `input_filter` 就是干这个的)。

</details>

4. 同样两件事,交接版 6615 token 约 0.0075 元,主管版 7854 token 约 0.0234 元。token 只差 16%,钱为什么差三倍?

<details><summary>答案</summary>

差在缓存命中。交接版的每次调用都读同一份不断追加的历史,前缀稳定,79% 的输入命中了 DeepSeek 的缓存,命中价 0.04 元每百万,是未命中的五十分之一。主管版每个专员每次 `run` 都从新的 messages 开始,不同 Agent 的前缀也不一样,命中少。

</details>

5. 面试题:「你们的客服 Agent 为什么用 handoff 而不是 supervisor?handoff 上线后遇到过什么问题?」怎么回答?

<details><summary>答案</summary>

选 handoff 是因为客服是多轮对话,客户要和账务、技术直接来回聊,话题会跳;handoff 让接手的专员看到完整历史,不用主管每轮转述,也就没有转述时编造和抄错的问题,而且共享历史前缀稳定,缓存命中高,成本更低。遇到过的问题有三个:交接工具忘了回 ToolMessage 导致 400;接手方把同事的转接动作当成自己的,只回「已为您转接」,靠在 prompt 末尾加接手提醒解决;两个专员职责有重叠时会踢皮球,靠状态里记交接次数、超过两次转人工兜底。另外接手方看得到全部历史,会越界处理别人领域的问题,要在系统提示词里写清边界。

</details>

6. MCP 和 A2A 分别解决什么问题?今天的 handoff 需要 A2A 吗?

<details><summary>答案</summary>

MCP 让一个 Agent 用统一的方式连接工具和数据源;A2A 让不同公司、不同框架、分开部署的 Agent 之间按统一协议互相发任务、收结果,靠 Agent Card 发现彼此的能力。今天的两个专员在同一个进程、同一张图里,直接共享状态,不需要 A2A;只有要调用别的团队或别的公司部署的 Agent 时才用得上。

</details>

## 明天预告

明天是 [Day 332 · 多 Agent(四):subagent 是为了省上下文,什么时候不该用多 Agent](/blog/agent-zero/day-332-multi-agent-4/)。这三天的多 Agent 都是「按领域分工」:账务一个、技术一个。但 2026 年用得最多的那种子 Agent(Claude Code、Codex 里的 subagent)出发点完全不同,它不是为了分工,而是为了把一大堆中间过程扔掉,只留结论。明天讲清这两者的区别,再把这周的判断收成一张「什么时候不该用多 Agent」的清单。
