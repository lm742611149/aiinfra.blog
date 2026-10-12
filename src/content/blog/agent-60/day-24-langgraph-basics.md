---
title: 'Day 24 · LangGraph 入门:状态、节点、边、条件路由'
description: '把 Agent 的控制流从一个 while 循环搬到一张图上。用 LangGraph 1.x 重写 Day 9 的 Agent 循环,再写一个工单分类后分支处理的工作流,搞懂 State、reducer、节点、普通边和条件边,以及什么时候值得用图。'
pubDate: 2026-10-12
regime: none
tags: ['langgraph', 'state-graph', 'workflow', 'agent-60']
series: 'agent-60'
day: 24
lang: 'zh'
---

## 今天要解决的问题

Day 9 你用 100 行代码写了一个 Agent 循环,Day 13 又写了五种 workflow 模式。这些代码有个共同点:控制流全靠 if/while 嵌在函数里。只有三五步的时候这很清爽;等到毕业项目那种「分类 → 检索 → 调工具 → 起草 → 自检 → 可能要人审批 → 可能转人工」的流程,一个函数里套四层 if,再加上中途暂停、断点恢复、流式输出,代码会很快变得没人敢动。

LangGraph 的做法是把控制流画成一张图:每一步是一个节点,步骤之间的跳转是边,所有步骤共享一份状态。今天学完,你应该能:

1. 说清 LangGraph 里 State、节点、边、条件边、reducer 这五个概念各自是什么。
2. 用 LangGraph 把 Day 9 的 Agent 循环重写一遍,并且能指着图说出它和 while 循环一一对应在哪。
3. 写一个没有循环的工作流图:工单分类后按类别走不同分支,再汇合。
4. 用结构化输出驱动路由,知道兼容 OpenAI 协议的国产模型该用哪种结构化输出方式。
5. 回答「什么时候用 LangGraph、什么时候手写循环就够」。

预计用时 4–5 小时。前置:Day 6(结构化输出)、Day 9(Agent 循环)、Day 13(workflow 模式)。

## 先说清楚 LangChain 和 LangGraph 的关系

很多人第一次接触时会被这两个名字搞糊涂,面试也常问,先理一下。

LangChain 是 2022 年底出来的大模型应用框架,早期以「链」(chain)为核心,封装了大量模型接口、提示词模板、检索器。它在 2023 年火得一塌糊涂,也因为抽象层太多、版本变动太频繁被骂得很惨,「LangChain 太重」至今是很多工程师的第一印象。

LangGraph 是同一家公司 2024 年推出的底层编排库,专门解决「多步、有状态、可能循环、需要持久化」的流程。它不依赖 LangChain 的链,只借用了 langchain-core 里的消息类型和模型接口。2025 年 10 月两者同时发布 1.0,分工变得很清楚:LangChain 1.x 提供高层的 `create_agent`,底下跑的就是 LangGraph;想要细粒度控制,直接用 LangGraph 画图。

我的建议是:**学 LangGraph,别从 LangChain 的高层封装学起**。原因是 LangGraph 的概念很少(状态、节点、边),一旦理解,任何复杂流程你都能自己搭;而高层封装把这些都藏起来了,出了问题你不知道里面发生了什么。等 LangGraph 熟了,再去用 `create_agent` 省代码,心里是有底的。

还有一个版本提醒。网上 2024–2025 年的大量教程用 `from langgraph.prebuilt import create_react_agent`,这个函数在 LangGraph 1.0 被标记为弃用,官方推荐换成 `langchain.agents.create_agent`。今天我们手写节点,不用它,这样换版本也不受影响。

## 四个概念:State、节点、边、reducer

**State(状态)** 是整张图共享的一份数据,通常用 `TypedDict` 定义。比如一个 Agent 的状态就是消息列表加一个调用计数:

```python
class State(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
    llm_calls: int
```

**节点(node)** 是一个普通的 Python 函数,输入是当前 State,输出是一个字典,表示「我要更新状态里的哪些字段」。注意是更新,不是替换整个状态。节点只需要返回它关心的字段:

```python
def call_llm(state: State) -> dict:
    reply = llm_with_tools.invoke(state["messages"])
    return {"messages": [reply], "llm_calls": state["llm_calls"] + 1}
```

**边(edge)** 决定执行完一个节点后去哪。普通边是固定的:`add_edge("tools", "llm")`,工具执行完一定回到模型。**条件边**根据状态决定去向:`add_conditional_edges("llm", route, ["tools", END])`,其中 `route` 是一个函数,看最后一条消息有没有工具调用,返回下一个节点的名字。`START` 和 `END` 是两个特殊节点,表示图的入口和出口。

**reducer** 是最容易被忽略、也最容易踩坑的概念。节点返回 `{"messages": [reply]}` 时,LangGraph 要决定:是用这个新列表**替换**旧的 messages,还是**追加**到后面?默认是替换。`Annotated[list, add_messages]` 就是告诉它:这个字段用 `add_messages` 函数来合并,也就是追加(遇到相同 id 的消息则更新)。`llm_calls` 没有 reducer,所以直接覆盖。

这里是新手最常踩的坑:忘了加 `add_messages`,每个节点返回的消息就会把整个列表覆盖掉,模型只看得到最后一条,完全不记得前面问了什么,而程序不会报任何错。动手练习第 2 题会让你亲手制造一次这个问题。所以:**凡是要累积的字段,一定要配 reducer**。除了 `add_messages`,常见的还有 `operator.add`(列表拼接、数字相加)。

用后端的经验类比:State 像一个请求上下文对象,节点像中间件或处理器,边像路由表,reducer 像合并策略。区别是这个「请求」可能要跑几十步、中途停下来等人、第二天再接着跑,所以状态需要能完整保存下来,明天我们讲 checkpoint 时就会看到这一点。

## 用图重写 Day 9 的 Agent 循环

回忆一下 Day 9 的循环:

```python
while steps < MAX_STEPS:
    reply = call_model(messages, tools)       # 1. 调模型
    messages.append(reply)
    if not reply.tool_calls:                  # 2. 没有工具调用就结束
        break
    for call in reply.tool_calls:             # 3. 执行工具,结果追加
        messages.append(run_tool(call))
```

翻译成图:「调模型」是一个节点 `llm`,「执行工具」是一个节点 `tools`,第 2 步的判断是 `llm` 后面的条件边,循环本身就是 `tools → llm` 那条普通边。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="左边是 while 循环的三步,右边是对应的 LangGraph 图:START 到 llm,llm 条件边到 tools 或 END,tools 回到 llm">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <text x="20" y="28" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">Day 9 的 while 循环</text>
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">
    <text x="20" y="62">while 步数 &lt; 上限:</text>
    <text x="36" y="86" fill="var(--mem)">① reply = 调模型(messages)</text>
    <text x="36" y="110" fill="var(--ink)">② if 没有 tool_calls: break</text>
    <text x="36" y="134" fill="var(--compute)">③ for call: 执行工具,追加结果</text>
    <text x="20" y="170" fill="var(--ink-faint)">控制流藏在代码结构里</text>
  </g>
  <line x1="300" y1="40" x2="300" y2="230" stroke="var(--rule)" stroke-dasharray="4 4"/>
  <text x="330" y="28" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">LangGraph 的图</text>
  <g font-family="var(--font-mono)" font-size="12" text-anchor="middle">
    <rect x="420" y="45" width="80" height="26" rx="13" fill="none" stroke="var(--ink-soft)"/>
    <text x="460" y="62" fill="var(--ink-soft)">START</text>
    <rect x="420" y="100" width="80" height="32" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="460" y="121" fill="var(--ink)">① llm</text>
    <rect x="550" y="100" width="76" height="32" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="588" y="121" fill="var(--ink)">③ tools</text>
    <rect x="420" y="190" width="80" height="26" rx="13" fill="none" stroke="var(--ink-soft)"/>
    <text x="460" y="207" fill="var(--ink-soft)">END</text>
  </g>
  <line x1="460" y1="71" x2="460" y2="100" stroke="var(--ink-soft)"/>
  <path d="M500 110 L550 110" stroke="var(--compute)" stroke-dasharray="4 3" fill="none"/>
  <path d="M550 124 L500 124" stroke="var(--ink-soft)" fill="none"/>
  <line x1="460" y1="132" x2="460" y2="190" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
    <text x="525" y="104" text-anchor="middle">有工具调用</text>
    <text x="525" y="140" text-anchor="middle">回到 llm</text>
    <text x="468" y="166">② 条件边:没有工具调用</text>
  </g>
</svg>
<figcaption>虚线是条件边,实线是普通边。while 循环里的三步一一对应到两个节点和两种边,循环本身变成了一条从 tools 指回 llm 的边。</figcaption>
</figure>

先建一个共用的模型对象。LangGraph 本身不关心你用哪家模型,我们用 `langchain-openai` 里的 `ChatOpenAI`,它走 OpenAI 兼容协议,所以 DeepSeek、通义、Kimi 都能接,只改 `.env`:

```bash
cd agent-60-lab
uv add langgraph langchain-openai python-dotenv
mkdir -p w4/lgdemo
```

目录名我特意叫 `lgdemo`(LangGraph demo)。千万别叫 `langgraph`,那会和库本身重名,`import langgraph` 时 Python 会先找到你的目录,报一堆莫名其妙的 ImportError;也别叫 `graph`,Day 28 的小项目里会有一个 `w4/graph.py`,同名的目录和文件放在一起很容易导入错对象。

```python
# agent-60-lab/w4/lgdemo/llm.py
"""LangGraph 这几天共用的模型对象。走 OpenAI 兼容协议,换厂商只改 .env。"""
import os

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

load_dotenv()


def get_llm(temperature: float = 0) -> ChatOpenAI:
    return ChatOpenAI(
        model=os.environ["LLM_MODEL"],
        base_url=os.environ["LLM_BASE_URL"],
        api_key=os.environ["LLM_API_KEY"],
        temperature=temperature,
    )
```

然后是图本身:

```python
# agent-60-lab/w4/lgdemo/agent_graph.py
"""用 LangGraph 重写 Day 9 的 Agent 循环:两个节点(llm、tools)+ 一条条件边。"""
from typing import Annotated, Literal

from langchain_core.messages import AnyMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict

from llm import get_llm

MAX_LLM_CALLS = 6


@tool
def get_weather(city: str) -> str:
    """查询城市当前天气。city 用中文城市名,如「上海」。"""
    fake = {"上海": "小雨 19°C", "北京": "晴 15°C", "广州": "多云 27°C"}
    return fake.get(city, f"没有 {city} 的天气数据")


@tool
def calculate(expression: str) -> str:
    """计算一个只含数字和 + - * / ( ) 的算式,返回结果。"""
    if not set(expression) <= set("0123456789+-*/(). "):
        return "表达式里有不允许的字符"
    return str(eval(expression))  # 字符集已限制,这里只为演示


TOOLS = [get_weather, calculate]
TOOLS_BY_NAME = {t.name: t for t in TOOLS}


class State(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]  # reducer:新消息追加而不是覆盖
    llm_calls: int


llm_with_tools = get_llm().bind_tools(TOOLS)


def call_llm(state: State) -> dict:
    system = SystemMessage("你是一个助手。需要事实或计算时调用工具,不要心算。")
    reply = llm_with_tools.invoke([system] + state["messages"])
    return {"messages": [reply], "llm_calls": state.get("llm_calls", 0) + 1}


def run_tools(state: State) -> dict:
    results = []
    for call in state["messages"][-1].tool_calls:
        output = TOOLS_BY_NAME[call["name"]].invoke(call["args"])
        results.append(ToolMessage(content=str(output), tool_call_id=call["id"]))
    return {"messages": results}


def route(state: State) -> Literal["tools", "__end__"]:
    last = state["messages"][-1]
    if getattr(last, "tool_calls", None) and state["llm_calls"] < MAX_LLM_CALLS:
        return "tools"
    return END


builder = StateGraph(State)
builder.add_node("llm", call_llm)
builder.add_node("tools", run_tools)
builder.add_edge(START, "llm")
builder.add_conditional_edges("llm", route, ["tools", END])
builder.add_edge("tools", "llm")
graph = builder.compile()

if __name__ == "__main__":
    print(graph.get_graph().draw_mermaid())
    out = graph.invoke({"messages": [("user", "上海和北京现在温差几度?")], "llm_calls": 0})
    for m in out["messages"]:
        m.pretty_print()
    print("LLM 调用次数:", out["llm_calls"])
```

```bash
cd w4/lgdemo
uv run python agent_graph.py
```

开头会先打印一段 Mermaid 格式的图定义,把它贴到任何支持 Mermaid 的地方(GitHub 的 markdown、Typora、mermaid.live)就能看到图。然后是运行过程,输出大致长这样:

```text
================================ Human Message =================================
上海和北京现在温差几度?
================================== Ai Message ==================================
Tool Calls:
  get_weather (call_1)  Args: city: 上海
  get_weather (call_2)  Args: city: 北京
================================= Tool Message =================================
小雨 19°C
================================= Tool Message =================================
晴 15°C
================================== Ai Message ==================================
Tool Calls:
  calculate (call_3)  Args: expression: 19-15
================================= Tool Message =================================
4
================================== Ai Message ==================================
上海现在小雨 19°C,北京晴 15°C,温差 4 度。
LLM 调用次数: 3
```

第一次模型调用里出现了两个并行的 `get_weather`,`run_tools` 节点一次执行完两个,再回到 `llm`。不同模型的行为会有差别:有的模型会一次调完两个城市,有的会分两轮调;有的会老老实实调 `calculate`,有的会自己心算。这正是 Day 12 说的「Agent 行为不确定」,W5 的评测要解决的就是怎么在这种不确定性下衡量质量。

几个值得注意的细节:

- `@tool` 装饰器来自 langchain-core,和 MCP 的 `@mcp.tool()` 思路一样,从函数签名和 docstring 生成 schema。`bind_tools(TOOLS)` 把工具定义附在每次请求上。
- `route` 函数里我加了 `llm_calls < MAX_LLM_CALLS` 的判断,这就是 Day 12 讲的步数上限。LangGraph 自己还有一个 `recursion_limit`,超过会抛 `GraphRecursionError`。早期版本默认是 25 步,我在 langgraph 1.2.14 的源码里查到默认值已经变成 10007,基本挡不住一个失控的 Agent。所以一定要在业务层自己设一个小的上限,出了问题能优雅结束,而不是烧几千次调用之后抛异常。也可以在调用时传 `config={"recursion_limit": 20}` 做第二道保险。
- 返回值类型标注 `Literal["tools", "__end__"]` 不是必须的,但加上之后画图时 LangGraph 知道条件边可能去哪,图会画得更准。`add_conditional_edges` 的第三个参数传了目标列表,作用相同。
- 官方的 `langgraph.prebuilt` 里有现成的 `ToolNode` 和 `tools_condition`,可以替代我手写的 `run_tools` 和 `route`。它们还会帮你处理工具抛异常、并行执行等细节。今天手写是为了看清楚原理,项目里用现成的没问题。

## 第二张图:没有循环的工作流

Agent 循环只是 LangGraph 能画的图之一。实际项目里更多的是「workflow」:步骤基本固定,只在某些点做分支。Day 13 讲过,能用 workflow 解决的问题就别上 Agent,更可控、更便宜、更好测。

CloudLedger 客服的第一步就是一个典型的 workflow:来了一张工单,先分类,账务类交给账务组(后面要查发票和订阅),技术类交给技术支持(先查知识库),其他的交给一线客服;紧急的再加一个标记。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="工单工作流图:START 到 classify,条件边分到 billing、technical、human 三个分支,三个分支都汇合到 escalate,再到 END">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12" text-anchor="middle">
    <rect x="20" y="100" width="70" height="26" rx="13" fill="none" stroke="var(--ink-soft)"/><text x="55" y="117" fill="var(--ink-soft)">START</text>
    <rect x="130" y="96" width="90" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="175" y="118" fill="var(--ink)">classify</text>
    <rect x="290" y="30" width="100" height="32" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="340" y="51" fill="var(--ink)">billing</text>
    <rect x="290" y="97" width="100" height="32" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="340" y="118" fill="var(--ink)">technical</text>
    <rect x="290" y="164" width="100" height="32" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="340" y="185" fill="var(--ink)">human</text>
    <rect x="450" y="96" width="90" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/><text x="495" y="118" fill="var(--ink)">escalate</text>
    <rect x="570" y="100" width="56" height="26" rx="13" fill="none" stroke="var(--ink-soft)"/><text x="598" y="117" fill="var(--ink-soft)">END</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="90" y1="113" x2="130" y2="113"/>
    <line x1="390" y1="46" x2="450" y2="105"/><line x1="390" y1="113" x2="450" y2="113"/><line x1="390" y1="180" x2="450" y2="121"/>
    <line x1="540" y1="113" x2="570" y2="113"/>
  </g>
  <g stroke="var(--mem)" stroke-dasharray="4 3" fill="none">
    <line x1="220" y1="105" x2="290" y2="46"/><line x1="220" y1="113" x2="290" y2="113"/><line x1="220" y1="121" x2="290" y2="180"/>
  </g>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
    <text x="240" y="66">账务</text><text x="246" y="108">技术</text><text x="232" y="168">其他</text>
    <text x="495" y="150" text-anchor="middle">紧急则加标记</text>
  </g>
</svg>
<figcaption>只有 classify 调用模型,三个分支和 escalate 都是普通函数。条件边由分类结果驱动,模型的输出直接决定了走哪条路。</figcaption>
</figure>

```python
# agent-60-lab/w4/lgdemo/triage_graph.py
"""一个不带循环的工作流图:工单分类 → 按类别走不同分支 → 汇合。演示 State、结构化输出和条件路由。"""
from typing import Literal

from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field
from typing_extensions import TypedDict

from llm import get_llm


class Triage(BaseModel):
    category: Literal["billing", "technical", "account", "other"] = Field(description="工单类别")
    urgency: Literal["low", "normal", "high"] = Field(description="紧急程度,影响付款或无法登录算 high")
    summary: str = Field(description="一句话概括客户诉求,不超过 30 字")


class TicketState(TypedDict, total=False):
    ticket: str
    triage: Triage
    owner: str
    note: str


# DeepSeek 等兼容厂商不一定支持 json_schema 模式,用 function_calling 方式最稳
classifier = get_llm().with_structured_output(Triage, method="function_calling")


def classify(state: TicketState) -> dict:
    result = classifier.invoke(
        "把下面的客服工单分类。\n"
        "billing=扣款/退款/发票/价格;technical=报错/功能异常;account=登录/权限/注销;其余 other。\n\n"
        f"工单:{state['ticket']}"
    )
    return {"triage": result}


def to_billing(state: TicketState) -> dict:
    return {"owner": "账务组", "note": "需要查发票和订阅,W4 后面会接 MCP 工具"}


def to_technical(state: TicketState) -> dict:
    return {"owner": "技术支持", "note": "先查知识库里的报错码文章"}


def to_human(state: TicketState) -> dict:
    return {"owner": "一线客服", "note": "账号类或无法归类,一线客服先接"}


def pick_branch(state: TicketState) -> Literal["billing", "technical", "human"]:
    c = state["triage"].category
    if c == "billing":
        return "billing"
    if c == "technical":
        return "technical"
    return "human"


def escalate_if_urgent(state: TicketState) -> dict:
    if state["triage"].urgency == "high":
        return {"note": state["note"] + ";紧急,30 分钟内响应"}
    return {}


builder = StateGraph(TicketState)
builder.add_node("classify", classify)
builder.add_node("billing", to_billing)
builder.add_node("technical", to_technical)
builder.add_node("human", to_human)
builder.add_node("escalate", escalate_if_urgent)
builder.add_edge(START, "classify")
builder.add_conditional_edges("classify", pick_branch, ["billing", "technical", "human"])
for branch in ["billing", "technical", "human"]:
    builder.add_edge(branch, "escalate")
builder.add_edge("escalate", END)
graph = builder.compile()

if __name__ == "__main__":
    for text in [
        "10 月 8 号被扣了两次款,麻烦退一笔",
        "导出年度报表一直提示 ERR_EXPORT_TIMEOUT",
        "验证码一直过期,登录不了,急!",
    ]:
        out = graph.invoke({"ticket": text})
        t = out["triage"]
        print(f"{text[:16]:<18} → {t.category:<9} {t.urgency:<6} {out['owner']} | {out['note']}")
```

几个要点:

**用结构化输出驱动路由。** 分类节点不让模型自由发挥,而是用 Day 6 学的结构化输出,要求它返回一个 `Triage` 对象,`category` 是四选一的 `Literal`。这样条件边函数 `pick_branch` 拿到的一定是合法值,不会出现模型回一句「这应该算是账务问题吧」导致路由失败的情况。

**国产模型用 `method="function_calling"`。** `with_structured_output` 有几种实现方式:`json_schema` 依赖厂商支持 OpenAI 的 Structured Outputs(schema 严格约束),`function_calling` 是把 schema 伪装成一个工具让模型「调用」,`json_mode` 只保证输出是 JSON。DeepSeek 等兼容厂商对 `json_schema` 的支持情况不一,`function_calling` 是最稳的选择,因为只要支持工具调用就能用。这是一个面试时能体现实战经验的小细节。

**State 用 `total=False`。** 工作流里的字段是一步步填进去的,刚开始只有 `ticket`,`triage` 要等分类后才有。`total=False` 表示所有字段都是可选的,避免类型检查报错。

**分支汇合。** 三个分支都有一条普通边指向 `escalate`,LangGraph 会在任何一个分支完成后执行它。如果你让多个分支**同时**执行(比如从 START 同时连到两个节点),它们会并行跑,汇合节点会等所有分支都完成,这叫 fan-out / fan-in,Day 26 讲多 Agent 时会用到。

运行结果大致长这样:

```text
10 月 8 号被扣了两次款,麻   → billing   normal 账务组 | 需要查发票和订阅,W4 后面会接 MCP 工具
导出年度报表一直提示 ERR_E   → technical normal 技术支持 | 先查知识库里的报错码文章
验证码一直过期,登录不了,急!    → account   high   一线客服 | 账号类或无法归类,一线客服先接;紧急,30 分钟内响应
```

你可以多跑几次、多换几张工单(从 Day 23 的 `tickets` 表里取),看分类稳不稳定。如果发现「取消订阅」时而被分到 billing 时而被分到 account,说明分类标准本身有歧义,该改的是提示词里的类别定义,不是去调模型参数。

## 图编译之后是什么

`builder.compile()` 返回的是一个 `CompiledStateGraph`,它实现了 LangChain 的 Runnable 接口,所以有一组统一的方法:

- `invoke(input)`:同步跑完,返回最终状态;
- `stream(input, stream_mode=...)`:边跑边吐中间结果;
- `ainvoke` / `astream`:异步版本,节点用 `async def` 时用它们;
- `get_graph()`:拿到图结构,可以画图;
- `get_state(config)` / `get_state_history(config)`:查看持久化的状态,要配合 checkpointer,明天讲。

`stream` 很常用,它让你在长流程里实时看到每一步。最常用的模式是 `"updates"`,每执行完一个节点吐一次该节点的更新:

```python
for chunk in graph.stream({"messages": [("user", "上海天气?")], "llm_calls": 0}, stream_mode="updates"):
    for node, update in chunk.items():
        print(f"[{node}]", update["messages"][-1].content or update["messages"][-1].tool_calls)
```

输出类似:

```text
[llm] [{'name': 'get_weather', 'args': {'city': '上海'}, 'id': '...', 'type': 'tool_call'}]
[tools] 小雨 19°C
[llm] 上海小雨 19°C。
```

这对调试非常有用,也是 W6 做前端流式展示「Agent 正在调用什么工具」的基础。其他模式(`"values"` 每步吐完整状态、`"messages"` 逐 token 吐模型输出)明天再讲。

## 什么时候值得用 LangGraph

说实话,今天这两张图手写也就几十行,用 LangGraph 并没有省代码。它的价值不在今天,在后面这几件事:

- **持久化和断点恢复**:状态自动存到 SQLite/Postgres,进程挂了能从上一步接着跑,明天讲。
- **人工介入**:流程中间停下来等人审批,可能等几个小时,明天讲。
- **流式和可观测**:每一步的输入输出都能实时拿到,和 LangSmith、Langfuse 这类工具天然对接,W5 讲。
- **复杂流程的可读性**:十几个节点、多处分支和循环的流程,画成图比读嵌套 if 容易得多,新人接手也快。

反过来,这些情况我不建议上 LangGraph:一问一答的简单调用;固定三步、不需要持久化的流水线;团队里没人熟悉它、项目又很赶。框架是有学习和维护成本的。面试被问「为什么用 LangGraph」时,答出上面这几条具体收益,比说「它是业界主流」有说服力得多。Day 27 会把几个主流框架放在一起对比。

## 动手练习

1. 跑通 `agent_graph.py`,把打印的 Mermaid 贴到 [mermaid.live](https://mermaid.live) 看图。
2. 把 `add_messages` 那一行改成 `messages: list[AnyMessage]`(去掉 reducer),再跑一次,观察会发生什么,解释原因。改回来。
3. 用 `langgraph.prebuilt` 里的 `ToolNode(TOOLS)` 和 `tools_condition` 替换手写的 `run_tools` 和 `route`,确认行为一致。注意 `tools_condition` 返回的节点名是 `"tools"`,所以工具节点要叫这个名字。
4. 跑通 `triage_graph.py`。然后写一个小脚本,从 Day 23 的 `cloudledger.db` 里读出全部 41 张工单,逐张跑分类,统计四个类别各多少张,把你认为分错的挑出来,修改 `classify` 里的类别定义,再跑一遍对比。
5. 加分题:给 `triage_graph` 加一个 `billing` 分支下的子步骤,当分类是 billing 且工单正文里出现「退」字时,在 note 里追加「可能涉及退款,需审批」。想一想,这个判断应该放在条件边里还是节点里?

**验收标准**:两张图都能跑通;第 2 题能用一句话说清 reducer 的作用;第 4 题有一张统计表和至少一处你修改分类定义后的前后对比;能不看代码画出两张图的结构。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| LangGraph | LangChain 公司出的底层编排库,把多步流程表示为有状态的图,2025 年 10 月发布 1.0 |
| StateGraph | 以共享状态为中心的图构建器,`add_node`/`add_edge` 后 `compile()` |
| State | 整张图共享的数据结构,一般用 TypedDict 定义 |
| 节点(node) | 一个函数,输入当前状态,返回要更新的字段 |
| 普通边 | 固定的跳转,A 执行完一定到 B |
| 条件边 | 由函数根据状态决定下一个节点 |
| START / END | 图的入口和出口两个特殊节点 |
| reducer | 决定字段如何合并更新的函数,如 `add_messages` 追加消息、`operator.add` 拼接列表 |
| add_messages | 消息列表的 reducer,新消息追加,同 id 消息替换 |
| `@tool` | langchain-core 的装饰器,把函数变成带 schema 的工具 |
| bind_tools | 把工具定义绑定到模型上,每次调用都附带 |
| with_structured_output | 让模型按 pydantic 模型返回结构化结果,有 function_calling、json_schema、json_mode 几种方式 |
| recursion_limit | LangGraph 的最大步数保护,超过抛 GraphRecursionError |
| stream_mode | 流式输出的模式,`updates` 每节点一次、`values` 完整状态、`messages` 逐 token |

## 常见误区

**消息字段忘了加 reducer。** 默认是覆盖,不加 `add_messages` 每个节点返回的消息会把之前的全部替换掉,模型就「失忆」了。

**节点里直接修改 state。** `state["messages"].append(x)` 这种写法会绕过 reducer,在有 checkpoint 时还会导致状态和记录不一致。节点应该只返回要更新的字段,让 LangGraph 去合并。

**照抄老教程的 `create_react_agent`。** 1.0 起它被弃用,替代品是 `langchain.agents.create_agent`。新代码要么手写节点,要么用新 API。

**以为用了 LangGraph 就是 Agent。** 图里没有「模型决定下一步」的环节,它就是一个 workflow。今天的 `triage_graph` 就是 workflow,`agent_graph` 才是 Agent。两者都是正当的设计,别为了显得高级把 workflow 硬改成 Agent。

**用自由文本做路由。** 让模型输出「我觉得是账务类」再用字符串匹配,迟早会遇到它说「财务相关」导致匹配失败。路由用结构化输出加枚举。

**国产模型上用默认的 `with_structured_output`。** 默认方式依赖厂商对 json_schema 的支持,不支持时会报错或静默降级。兼容厂商显式写 `method="function_calling"`。

## 学习资料

### 文档与文章

- [LangGraph 官方 Overview](https://docs.langchain.com/oss/python/langgraph/overview) 和 [Quickstart](https://docs.langchain.com/oss/python/langgraph/quickstart):今天的起点。Quickstart 用计算器 Agent 演示了和本文几乎一样的结构,30 分钟。
- [Graph API 概念](https://docs.langchain.com/oss/python/langgraph/graph-api):State、reducer、节点、边、`Command` 的权威说明,reducer 那一节一定要读,40 分钟。
- [Workflows and agents](https://docs.langchain.com/oss/python/langgraph/workflows-agents):把 Anthropic《Building effective agents》里的五种模式全部用 LangGraph 实现了一遍,和你 Day 13 手写的版本对照着看,1 小时。
- [LangGraph v1 迁移说明](https://docs.langchain.com/oss/python/migrate/langgraph-v1):列出了 1.0 弃用的 API,看老教程之前先扫一眼。
- [LangChain Academy · Introduction to LangGraph](https://academy.langchain.com/courses/intro-to-langgraph):官方免费课,模块 1 对应今天的内容,有 notebook 可以跟着跑。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1z3NY66EY1&autoplay=0&high_quality=1" title="尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>尚硅谷 · 尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战 · 2026 年 7 月录制,版本较新,一共一百多集,今天只看讲 State、节点、边、条件边的前十几集,其余当工具书按需查。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1bi421v7oD&autoplay=0&high_quality=1" title="吴恩达&langchain《用LangGraph搭建智能体|AI Agents in LangGraph》【短课英字可关】" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>GPT中英字幕课程资源 · 吴恩达&langchain《用LangGraph搭建智能体|AI Agents in LangGraph》 · DeepLearning.AI 短课的字幕搬运,LangGraph 作者 Harrison Chase 主讲。第 2、3 集从零写 Agent 再用 LangGraph 重写,和今天的思路一致。课程录于 2024 年,API 有些旧,看思路。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/aHCDrAbH_go" title="Building Effective Agents with LangGraph" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Building Effective Agents with LangGraph · 32 分钟,官方把 workflow 和 agent 的几种模式逐个在 LangGraph 里实现,是今天第二张图的「完整版」。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/qAF1NjEVHhY" title="LangChain vs LangGraph: A Tale of Two Frameworks" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>IBM Technology · LangChain vs LangGraph: A Tale of Two Frameworks · 10 分钟,把两个框架的定位讲得很清楚,适合面试前复习。</figcaption>
</figure>

- freeCodeCamp《LangGraph Complete Course for Beginners – Complex AI Agents with Python》(YouTube,3 小时):想系统补的话看,按标题搜索。

### 书籍

- Mayo Oshin、Nuno Campos《Learning LangChain》(O'Reilly, 2025):第 5 章「Cognitive Architectures with LangGraph」讲 LLM 调用、链、路由三种架构,第 6 章「Agent Architecture」讲 Agent 循环。作者之一是 LangChain 的创始工程师,讲法比官方文档更有条理。书写于 1.0 之前,API 细节以文档为准。
- 黄佳《大模型应用开发 动手做AI Agent》(人民邮电出版社·异步图书, 2024):讲 ReAct 和 Agent 架构的章节可以作为中文对照,帮助理解「图」到底在表达什么。

### 开源项目与代码

- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):源码和 `examples/`,看 `libs/langgraph/langgraph/graph/message.py` 里 `add_messages` 函数的实现,核心逻辑就几十行,读完就彻底明白 reducer 了。
- [langchain-ai/langchain-academy](https://github.com/langchain-ai/langchain-academy):Academy 课程的全部 notebook。
- [datawhalechina/hello-agents](https://github.com/datawhalechina/hello-agents):中文 Agent 教程,里面有用框架和不用框架的对照章节。

## 自测

1. 下面这个 State,节点返回 `{"messages": [ai_msg], "llm_calls": 3}` 之后,两个字段分别怎么变?

```python
class State(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
    llm_calls: int
```

<details><summary>答案</summary>

`messages` 有 reducer `add_messages`,新消息追加到原列表末尾(如果 id 相同则替换那条);`llm_calls` 没有 reducer,直接被覆盖成 3。

</details>

2. 把 Day 9 的 while 循环翻译成 LangGraph,循环本身体现在图的哪里?「步数上限」可以放在哪几个地方?

<details><summary>答案</summary>

循环体现在 `tools → llm` 这条普通边,加上 `llm` 后面的条件边(有工具调用就去 tools)。步数上限可以放在条件边函数里(状态里记调用次数,超过就去 END,本文的做法),也可以在调用时传 `config={"recursion_limit": N}`,超限会抛 `GraphRecursionError`,适合做最后一道保险。注意 1.x 的默认 recursion_limit 很大,不能指望默认值。

</details>

3. 工单分类节点为什么要用 `with_structured_output(Triage, method="function_calling")`,而不是让模型直接回答类别名?

<details><summary>答案</summary>

路由依赖分类结果,必须是确定的几个值之一。结构化输出加 Literal 枚举能保证拿到合法值,自由文本可能出现同义词、多余解释,字符串匹配会失败。`function_calling` 方式只要求厂商支持工具调用,兼容性最好;DeepSeek 等厂商未必完整支持 OpenAI 的 json_schema 严格模式。

</details>

4. `triage_graph` 是 workflow 还是 Agent?判断依据是什么?

<details><summary>答案</summary>

是 workflow。流程的走向由代码里写好的条件边决定,模型只负责输出分类,不决定「接下来做什么、调哪个工具、要不要继续」。Agent 的特征是模型在循环中自己决定下一步动作,比如 `agent_graph` 里模型决定是否调用工具、调哪个。

</details>

5. 同事说:「LangGraph 太重了,我们的客服流程直接手写就行。」你怎么判断他说得对不对?

<details><summary>答案</summary>

看需求。如果流程只有固定几步、不需要中途暂停等人审批、不需要进程重启后接着跑、不需要逐步流式展示和追踪,手写确实更轻。但客服场景通常有退款审批(要暂停几小时)、多轮会话(要持久化状态)、需要追踪每一步做评测,这些手写都要自己实现 checkpoint、恢复、流式事件,工作量和出错概率都不小,这时用 LangGraph 是划算的。可以先手写一个最小版本,当出现第一个「需要暂停恢复」的需求时再迁移。

</details>

6. **面试题**:「LangChain 和 LangGraph 有什么区别?你为什么选 LangGraph?」

<details><summary>答案</summary>

参考要点:LangChain 是高层应用框架,提供模型接口、提示词、检索器等组件,1.x 里有 `create_agent` 这种开箱即用的 Agent;LangGraph 是底层编排库,把流程表示成有状态的图(状态、节点、边),原生支持循环、条件分支、持久化(checkpoint)、人工介入(interrupt)、流式输出。LangChain 1.x 的 Agent 本身就跑在 LangGraph 上。选 LangGraph 的理由要结合项目:比如流程里有退款审批要暂停等人、会话要跨请求持久化、需要逐步追踪做评测;同时说明代价(学习成本、多一层抽象),以及简单场景不用它。

</details>

## 明天预告

Day 25 · LangGraph 进阶:checkpoint、人工审批、流式与中断恢复。今天的图跑完状态就丢了。明天给它接上 SQLite checkpointer,让状态落盘;用 `interrupt` 实现 CloudLedger 的退款审批,Agent 起草方案后停下来等主管,主管可以隔几个小时再批;还会演示进程退出后用同一个 thread_id 接着跑,以及「时间旅行」回到审批前重来一次。
