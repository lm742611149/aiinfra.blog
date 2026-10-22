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

1. 说清 LangGraph 里 State、节点、边、条件边、reducer 这五个概念各自是什么,并且每个都亲手用一个小脚本跑过(包括并行、循环、Command 和 Send)。
2. 用 LangGraph 把 Day 9 的 Agent 循环重写一遍,并且能指着图说出它和 while 循环一一对应在哪。
3. 写一个没有循环的工作流图:工单分类后按类别走不同分支,再汇合。
4. 用结构化输出驱动路由,知道兼容 OpenAI 协议的国产模型该用哪种结构化输出方式。
5. 回答「什么时候用 LangGraph、什么时候手写循环就够」。

预计用时 6–7 小时,其中「先慢下来」那一节的十一个小脚本约 2 小时,觉得概念吃力就先做它。前置:Day 6(结构化输出)、Day 9(Agent 循环)、Day 13(workflow 模式)。

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

## 先慢下来:十一个小脚本,一次只学一个零件

如果你看了下面「用图重写 Day 9」那段 260 行的代码觉得一下子接不住,先做这一节。尚硅谷那套 LangGraph 课光是 state、边、循环就讲了四十集,我们不必那么细,但每个零件至少要亲手跑一次、看一次输出,后面的大代码才读得进去。

这一节的脚本全都**不调模型**,节点就是普通 Python 函数,跑起来不花钱,一秒出结果。每个脚本只多一个新东西。建议的做法是:先看我写的那一两段话,再自己敲一遍(别复制),跑出来和我贴的输出对一下,对不上就停下来想为什么。

准备工作只有一步。还没装 LangGraph 的话先装,然后建个目录放这些脚本:

```bash
cd agent-60-lab
uv add langgraph langchain-openai python-dotenv
mkdir -p w4/lg_steps
```

下面所有命令都在 `agent-60-lab` 根目录跑,形如 `uv run python w4/lg_steps/s01_one_node.py`。我用的是 langgraph 1.2.14,你装到更新的 1.x 版本,输出应该一样。

### 第 1 步:只有一个节点的图

先把骨架记住:定义 State → 建 `StateGraph` → 加节点 → 连边 → `compile()` → `invoke()`。不管多复杂的图都是这六步。

```python
# agent-60-lab/w4/lg_steps/s01_one_node.py
from typing import TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    ticket: str
    category: str


def classify(state: State) -> dict:
    print("classify 收到:", state)
    text = state["ticket"]
    return {"category": "billing" if "发票" in text else "other"}


builder = StateGraph(State)
builder.add_node("classify", classify)
builder.add_edge(START, "classify")
builder.add_edge("classify", END)
graph = builder.compile()

result = graph.invoke({"ticket": "上个月的发票开错了"})
print("最终状态:", result)
```

<div class="line-notes">

- `class State(TypedDict):` State 就是一张「表单」,写清楚整张图里有哪些字段。这里两个字段:`ticket` 是工单原文,`category` 是分类结果。TypedDict 只是类型提示,运行时它就是一个普通 dict。
- `def classify(state: State) -> dict:` 节点就是一个函数:参数是当前 State,返回值是「我要改哪些字段」。
- `print("classify 收到:", state)` 打印看看节点拿到的是什么。输出里是 `{'ticket': '上个月的发票开错了'}`,注意没有 `category`:你没传的字段,一开始就不存在。
- `return {"category":` 只返回 `category` 一个字段。LangGraph 会把它合并进状态,`ticket` 原样保留。这就是「返回的是更新,不是整个状态」。
- `builder = StateGraph(State)` 建一个图的「施工图纸」,告诉它状态长什么样。此时还不能跑。
- `builder.add_node("classify", classify)` 登记一个节点,名字叫 `"classify"`,对应函数 `classify`。名字是给边用的。
- `builder.add_edge(START, "classify")` `START` 是入口。这条边的意思是:一进图就先跑 classify。
- `builder.add_edge("classify", END)` `END` 是出口。classify 跑完就结束。少了这条边,compile 会报节点没有出路。
- `graph = builder.compile()` 把图纸编译成能执行的图。会检查有没有孤立节点、边指向不存在的节点之类的错。
- `result = graph.invoke(` 传入初始状态,跑完整张图,返回最终状态。
- `print("最终状态:", result)` 最终状态里多了 `category: 'billing'`,因为工单里有「发票」两个字。

</div>

输出(实跑,langgraph 1.2.14):

```text
classify 收到: {'ticket': '上个月的发票开错了'}
最终状态: {'ticket': '上个月的发票开错了', 'category': 'billing'}
```

对应尚硅谷第 9–12 集(三要素、图运行过程、完成基础的 graph 流程)。

### 第 2 步:两个节点串起来,用 stream 看每一步

真实流程不会只有一步。这里加一个 `draft` 节点,并且换用 `stream` 代替 `invoke`:`invoke` 只给你最后的结果,`stream(..., stream_mode="updates")` 每跑完一个节点就吐出这个节点改了什么。调试的时候它比 print 好用得多。

```python
# agent-60-lab/w4/lg_steps/s02_sequence.py
from typing import TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    ticket: str
    category: str
    reply: str


def classify(state: State) -> dict:
    return {"category": "billing" if "发票" in state["ticket"] else "other"}


def draft(state: State) -> dict:
    return {"reply": f"[{state['category']}] 已收到:{state['ticket']}"}


builder = StateGraph(State)
builder.add_sequence([classify, draft])  # 等于 add_node×2 + add_edge("classify","draft")
builder.add_edge(START, "classify")
builder.add_edge("draft", END)
graph = builder.compile()

for step in graph.stream({"ticket": "发票抬头写错了"}, stream_mode="updates"):
    print(step)
```

<div class="line-notes">

- `def draft(state: State) -> dict:` 第二个节点读了第一个节点写进去的 `category`。节点之间不直接传参,全靠共享的 State。
- `builder.add_sequence([classify, draft])` 一次登记两个节点并按顺序连起来,节点名自动取函数名。等价于两次 `add_node` 加一条 `add_edge("classify", "draft")`,线性流程用它能少写几行。
- `builder.add_edge(START, "classify")` 入口还是要自己连。
- `for step in graph.stream(` `stream` 返回一个迭代器,每个元素是 `{节点名: 这个节点返回的更新}`。

</div>

输出(实跑,langgraph 1.2.14):

```text
{'classify': {'category': 'billing'}}
{'draft': {'reply': '[billing] 已收到:发票抬头写错了'}}
```

两行输出就是两个节点各自的「改动记录」。后面调复杂的图,第一件事就是用这个模式看它到底走了哪些节点。对应尚硅谷第 28–29 集(边的简单使用、add_sequence)。

### 第 3 步:State 的三种写法

State 除了 TypedDict,还能用 dataclass 和 pydantic。区别主要在两点:节点里拿到的是 dict 还是对象;要不要在运行时校验类型。

```python
# agent-60-lab/w4/lg_steps/s03_state_styles.py
from dataclasses import dataclass
from typing import TypedDict

from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel


class TDState(TypedDict):
    amount: float


@dataclass
class DCState:
    amount: float
    currency: str = "CNY"


class PDState(BaseModel):
    amount: float


def double(state) -> dict:
    amount = state["amount"] if isinstance(state, dict) else state.amount
    print("  节点里拿到的 state 类型:", type(state).__name__)
    return {"amount": amount * 2}


def build(schema):
    b = StateGraph(schema)
    b.add_node("double", double)
    b.add_edge(START, "double")
    b.add_edge("double", END)
    return b.compile()


print("TypedDict:", build(TDState).invoke({"amount": 10}))
print("dataclass:", build(DCState).invoke({"amount": 10}))
print("pydantic :", build(PDState).invoke({"amount": "10"}))
try:
    build(PDState).invoke({"amount": "十块"})
except Exception as e:
    print("pydantic 拦下了:", type(e).__name__)
```

<div class="line-notes">

- `class TDState(TypedDict):` TypedDict:最常用,官方示例基本都用它。运行时不做任何检查。
- `@dataclass` dataclass:可以给字段写默认值,比如 `currency` 默认 CNY,初始状态里不传也行。
- `class PDState(BaseModel):` pydantic:运行时会校验和转换类型,Day 6 学过它。
- `amount = state["amount"] if isinstance(state, dict) else state.amount` TypedDict 时节点拿到 dict,要用 `state["amount"]`;另外两种拿到的是对象,要用 `state.amount`。这行同时兼容两种,只是为了一个函数演示三种写法,自己写项目时选定一种就别混用。
- `print("  节点里拿到的 state 类型:"` 输出依次是 `dict`、`DCState`、`PDState`,证实了上一条。
- `print("pydantic :", build(PDState).invoke({"amount": "10"}))` 传入的是字符串 `"10"`,pydantic 自动转成了 10.0,所以结果是 `20.0`(注意是浮点)。
- `build(PDState).invoke({"amount": "十块"})` 「十块」转不成数字,pydantic 直接抛 `ValidationError`,节点根本不会被执行。

</div>

输出(实跑,langgraph 1.2.14):

```text
  节点里拿到的 state 类型: dict
TypedDict: {'amount': 20}
  节点里拿到的 state 类型: DCState
dataclass: {'amount': 20}
  节点里拿到的 state 类型: PDState
pydantic : {'amount': 20.0}
pydantic 拦下了: ValidationError
```

本课后面统一用 TypedDict,因为官方文档和大多数开源项目都这么写,读别人代码时不用切换。外部输入不可信、想在入口就拦住脏数据时,再考虑 pydantic。对应尚硅谷第 14–15 集。

### 第 4 步:不加 reducer,列表会被覆盖

这一步专门演示一个坑。两个节点都往 `notes` 里写一条记录,你可能以为最后会有三条。

```python
# agent-60-lab/w4/lg_steps/s04_overwrite.py
from typing import TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    notes: list[str]
    steps: int


def a(state: State) -> dict:
    return {"notes": ["a 查了客户"], "steps": state["steps"] + 1}


def b(state: State) -> dict:
    return {"notes": ["b 查了发票"]}  # 没返回 steps,steps 保持原值


builder = StateGraph(State)
builder.add_sequence([a, b])
builder.add_edge(START, "a")
builder.add_edge("b", END)
graph = builder.compile()

print(graph.invoke({"notes": ["用户来信"], "steps": 0}))
```

<div class="line-notes">

- `notes: list[str]` 普通字段,没有任何合并规则。
- `return {"notes": ["a 查了客户"], "steps": state["steps"] + 1}` a 返回了一个只有一条的新列表。
- `return {"notes": ["b 查了发票"]}` b 也返回一个新列表,并且没返回 `steps`。
- `print(graph.invoke(` 结果 `notes` 只剩 `['b 查了发票']`:初始的「用户来信」和 a 写的都被覆盖了。`steps` 是 1,因为 b 没提它,保留了 a 写的值。

</div>

输出:

```text
{'notes': ['b 查了发票'], 'steps': 1}
```

规则就一句:**没有 reducer 的字段,谁最后写谁说了算**。这正是开头说的「忘了 add_messages,模型只记得最后一条」那个坑,而且程序不报错。

### 第 5 步:用 reducer 让字段累积

给字段配上合并函数,写法是 `Annotated[类型, 合并函数]`。`operator.add` 对列表是拼接,对数字是相加;`add_messages` 是专门给消息列表用的,多一个本事:id 相同的消息会被替换而不是重复追加。

```python
# agent-60-lab/w4/lg_steps/s05_reducer.py
import operator
from typing import Annotated, TypedDict

from langchain_core.messages import AIMessage, AnyMessage, HumanMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages


class State(TypedDict):
    notes: Annotated[list[str], operator.add]
    cost: Annotated[float, operator.add]
    messages: Annotated[list[AnyMessage], add_messages]


def a(state: State) -> dict:
    return {"notes": ["a 查了客户"], "cost": 0.01,
            "messages": [AIMessage("草稿 v1", id="draft")]}


def b(state: State) -> dict:
    return {"notes": ["b 查了发票"], "cost": 0.02,
            "messages": [AIMessage("草稿 v2", id="draft")]}  # 同 id:替换而不是追加


builder = StateGraph(State)
builder.add_sequence([a, b])
builder.add_edge(START, "a")
builder.add_edge("b", END)
graph = builder.compile()

out = graph.invoke({"notes": ["用户来信"], "cost": 0.0,
                    "messages": [HumanMessage("发票开错了", id="q1")]})
print("notes:", out["notes"])
print("cost :", round(out["cost"], 2))
print("messages:", [(m.id, m.content) for m in out["messages"]])
```

<div class="line-notes">

- `notes: Annotated[list[str], operator.add]` `notes` 的合并规则是 `旧值 + 新值`,也就是列表拼接。
- `cost: Annotated[float, operator.add]` 数字也能累加。用来统计整次运行的花费很方便:每个节点只报自己这一步花了多少。
- `messages: Annotated[list[AnyMessage], add_messages]` 消息列表用 `add_messages`。
- `"messages": [AIMessage("草稿 v1", id="draft")]}` a 写了一条 id 为 `draft` 的消息。
- `"messages": [AIMessage("草稿 v2", id="draft")]}` b 写了同一个 id 的消息。`add_messages` 看到 id 重复,就用 v2 替换 v1,而不是追加成两条。
- `print("notes:", out["notes"])` 三条都在:`['用户来信', 'a 查了客户', 'b 查了发票']`。
- `print("cost :", round(out["cost"], 2))` 0 + 0.01 + 0.02 = 0.03。用 round 是因为浮点相加会出现 0.030000000000000002 这种尾巴。
- `print("messages:"` 只有两条:用户的 `q1` 和最终版 `draft`(内容是「草稿 v2」)。

</div>

输出(实跑,langgraph 1.2.14):

```text
notes: ['用户来信', 'a 查了客户', 'b 查了发票']
cost : 0.03
messages: [('q1', '发票开错了'), ('draft', '草稿 v2')]
```

`add_messages` 按 id 替换这个特性,后面做「改写上一条回复」「人工修改草稿后放回去」时会用到。对应尚硅谷第 16–18 集(reducer)和第 26–27 集(预定义状态、MessagesState)。

### 第 6 步:两个节点同时跑,这时 reducer 是必需的

客服 Agent 常见的需求:查知识库和查订单库互不依赖,应该同时做。LangGraph 里让 START 连出两条边,两个节点就会在同一步并行执行;再用 `add_edge([a, b], c)` 表示「a 和 b 都跑完才进 c」。

```python
# agent-60-lab/w4/lg_steps/s06_parallel.py
import operator
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph


class Bad(TypedDict):
    found: list[str]


class Good(TypedDict):
    found: Annotated[list[str], operator.add]


def search_kb(state) -> dict:
    return {"found": ["kb-003 退款政策"]}


def query_db(state) -> dict:
    return {"found": ["INV-0042 已付款"]}


def merge(state) -> dict:
    print("  merge 看到:", state["found"])
    return {}


def build(schema):
    b = StateGraph(schema)
    b.add_node("search_kb", search_kb)
    b.add_node("query_db", query_db)
    b.add_node("merge", merge)
    b.add_edge(START, "search_kb")
    b.add_edge(START, "query_db")          # START 连两条边 = 两个节点同时跑
    b.add_edge(["search_kb", "query_db"], "merge")  # 两个都跑完才进 merge
    b.add_edge("merge", END)
    return b.compile()


print("有 reducer:")
build(Good).invoke({"found": []})
print("没有 reducer:")
try:
    build(Bad).invoke({"found": []})
except Exception as e:
    print(" ", type(e).__name__, str(e).splitlines()[0])
```

<div class="line-notes">

- `class Bad(TypedDict):` 不带 reducer 的版本,用来演示报错。
- `class Good(TypedDict):` 带 `operator.add` 的版本。
- `print("  merge 看到:", state["found"])` 有 reducer 时两个结果都在。顺序是 `INV-0042` 在前,这一次的合并顺序不代表谁先跑完,别依赖它。
- `b.add_edge(START, "search_kb")` 入口连出第一条边。
- `b.add_edge(START, "query_db")` 入口再连出第二条边。一个节点后面连了两条普通边,两个目标就在同一步一起跑。
- `b.add_edge(["search_kb", "query_db"], "merge")` 第一个参数是列表:等两个都完成才进 merge,这叫扇入。只写两条单独的 `add_edge("search_kb", "merge")` 也能跑,但语义变成「谁先完成谁触发」,在更复杂的图里会让 merge 跑两次。
- `build(Bad).invoke({"found": []})` 同一步里两个节点都想写 `found`,又没有合并规则,LangGraph 不知道听谁的,直接抛 `InvalidUpdateError`。

</div>

输出(实跑,langgraph 1.2.14):

```text
有 reducer:
  merge 看到: ['INV-0042 已付款', 'kb-003 退款政策']
没有 reducer:
  InvalidUpdateError At key 'found': Can receive only one value per step. Use an Annotated key to handle multiple values.
```

对比第 4 步:串行时没 reducer 是**静悄悄地覆盖**,并行时没 reducer 是**直接报错**。报错反而是好事。错误信息里那句 `Use an Annotated key` 就是在提示你加 reducer。对应尚硅谷第 21 集(节点的并行执行)、第 30–31 集和第 38 集(静态扇入)。

### 第 7 步:条件边,按状态走不同分支

普通边是写死的,条件边是「跑完这个节点后,调一个函数决定下一站」。这就是工单分流的核心。

```python
# agent-60-lab/w4/lg_steps/s07_conditional.py
from typing import Literal, TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    ticket: str
    category: str
    reply: str


def classify(state: State) -> dict:
    t = state["ticket"]
    cat = "billing" if "发票" in t else "refund" if "退款" in t else "other"
    return {"category": cat}


def billing(state: State) -> dict:
    return {"reply": "转账单组"}


def refund(state: State) -> dict:
    return {"reply": "走退款审批"}


def human(state: State) -> dict:
    return {"reply": "转人工"}


def route(state: State) -> Literal["billing", "refund", "other"]:
    return state["category"]


builder = StateGraph(State)
for fn in (classify, billing, refund, human):
    builder.add_node(fn.__name__, fn)
builder.add_edge(START, "classify")
builder.add_conditional_edges(
    "classify", route,
    {"billing": "billing", "refund": "refund", "other": "human"},  # path_map:返回值 → 节点名
)
for n in ("billing", "refund", "human"):
    builder.add_edge(n, END)
graph = builder.compile()

for t in ["发票开错了", "我要退款", "怎么改密码"]:
    print(t, "→", graph.invoke({"ticket": t})["reply"])
```

<div class="line-notes">

- `def classify(state: State) -> dict:` 用关键词粗分三类,真实项目里换成模型分类(本篇后面「第二张图」就是这么做的)。
- `def route(state: State) -> Literal["billing", "refund", "other"]:` 路由函数:只读状态、返回一个字符串,**不要在这里改状态**,它的返回值不会写进 State。返回类型标成 Literal,LangGraph 画图时能知道有哪几条出路。
- `for fn in (classify, billing, refund, human):` 四个节点用循环登记,名字取函数名。
- `builder.add_conditional_edges(` 三个参数:从哪个节点出发、路由函数、path_map。
- `{"billing": "billing", "refund": "refund", "other": "human"},` path_map 把路由函数的返回值翻译成节点名。`other` 被映射到 `human` 节点,这样路由函数里可以用业务词,节点名可以另起。不需要翻译时可以只传节点名列表。
- `for n in ("billing", "refund", "human"):` 三个分支各自连到 END。
- `print(t, "→", graph.invoke({"ticket": t})["reply"])` 三张工单走了三条不同的路。

</div>

输出(实跑,langgraph 1.2.14):

```text
发票开错了 → 转账单组
我要退款 → 走退款审批
怎么改密码 → 转人工
```

对应尚硅谷第 32–34 集(条件分支、path_map、映射多节点)。

### 第 8 步:循环,以及怎么防死循环

Agent 循环本质上就是一条指回自己(或指回上一个节点)的边。下面的 `write` 节点每次多加一个感叹号,`check` 看够不够三个,不够就回去重写。第二段故意写一个永远不满意的路由,看 LangGraph 怎么兜底。

```python
# agent-60-lab/w4/lg_steps/s08_loop.py
from typing import TypedDict

from langgraph.errors import GraphRecursionError
from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    draft: str
    tries: int


def write(state: State) -> dict:
    tries = state["tries"] + 1
    return {"draft": "您好" + "!" * tries, "tries": tries}


def check(state: State) -> str:
    return "done" if state["tries"] >= 3 else "again"


def broken_check(state: State) -> str:
    return "again"  # 永远不满意:故意写出一个死循环


def build(route):
    b = StateGraph(State)
    b.add_node("write", write)
    b.add_edge(START, "write")
    b.add_conditional_edges("write", route, {"again": "write", "done": END})
    return b.compile()


print(build(check).invoke({"draft": "", "tries": 0}))

try:
    build(broken_check).invoke({"draft": "", "tries": 0}, config={"recursion_limit": 5})
except GraphRecursionError as e:
    print("死循环被拦下:", str(e).splitlines()[0])
```

<div class="line-notes">

- `tries = state["tries"] + 1` 每进一次节点计数加一。业务里的「最多重试几次」就靠这种计数字段。
- `def check(state: State) -> str:` 正常的退出条件:写够 3 次就结束。
- `def broken_check(state: State) -> str:` 故意的 bug:永远返回 again。
- `b.add_conditional_edges("write", route, {"again": "write", "done": END})` `again` 指回 `write` 自己,这就是循环;`done` 指向 END。
- `print(build(check).invoke(` 跑了 3 次 write 后正常结束,`draft` 是「您好!!!」。
- `config={"recursion_limit": 5}` `recursion_limit` 是整张图最多跑多少步(一个节点执行一次算一步)。设成 5,跑到第 5 步还没结束就抛错。
- `except GraphRecursionError as e:` 抛的是 `GraphRecursionError`。前面说过 1.2.14 的默认上限已经是 10007,真遇到失控的 Agent 基本等于没拦,所以业务层要有自己的计数(像 `check` 那样),recursion_limit 只当最后一道保险。

</div>

输出(实跑,langgraph 1.2.14):

```text
{'draft': '您好!!!', 'tries': 3}
死循环被拦下: Recursion limit of 5 reached without hitting a stop condition. You can increase the limit by setting the `recursion_limit` config key.
```

对应尚硅谷第 40–47 集(循环结构、限制循环步数、主动退出和被动退出)。

### 第 9 步:Command,在节点里同时改状态和指定下一站

条件边要写两个东西:节点改状态,路由函数选去向。有时候判断逻辑和改状态是一回事,拆成两处反而别扭。`Command` 让节点一次返回两样:`update` 是要改的字段,`goto` 是下一个节点。

```python
# agent-60-lab/w4/lg_steps/s09_command.py
from typing import Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Command


class State(TypedDict):
    amount: float
    reply: str


def check(state: State) -> Command[Literal["auto_refund", "need_approval"]]:
    if state["amount"] <= 100:
        return Command(update={"reply": "小额,自动退"}, goto="auto_refund")
    return Command(update={"reply": "大额,要审批"}, goto="need_approval")


def auto_refund(state: State) -> dict:
    return {"reply": state["reply"] + " → 已退款"}


def need_approval(state: State) -> dict:
    return {"reply": state["reply"] + " → 已提交审批"}


builder = StateGraph(State)
builder.add_node("check", check)
builder.add_node("auto_refund", auto_refund)
builder.add_node("need_approval", need_approval)
builder.add_edge(START, "check")
builder.add_edge("auto_refund", END)
builder.add_edge("need_approval", END)
graph = builder.compile()

print(graph.invoke({"amount": 59, "reply": ""})["reply"])
print(graph.invoke({"amount": 6578, "reply": ""})["reply"])
```

<div class="line-notes">

- `def check(state: State) -> Command[Literal["auto_refund", "need_approval"]]:` 返回类型写成 `Command[Literal[...]]`,列出可能去的节点。LangGraph 靠这个标注知道图的形状,能画出来,也能在 compile 时检查节点名。
- `return Command(update={"reply": "小额,自动退"}, goto="auto_refund")` 100 元以内:写一句说明,直接去自动退款。
- `return Command(update={"reply": "大额,要审批"}, goto="need_approval")` 超过 100 元去审批。明天 Day 25 的人工审批就会接在这种节点后面。
- `builder.add_edge(START, "check")` 注意 `check` 后面**没有**连任何边,去向全由它返回的 Command 决定。
- `print(graph.invoke({"amount": 59, "reply": ""})["reply"])` 59 元走了自动退款。
- `print(graph.invoke({"amount": 6578, "reply": ""})["reply"])` 6578 元(Day 23 里 C023 年付降级的退款额)走了审批。

</div>

输出(实跑,langgraph 1.2.14):

```text
小额,自动退 → 已退款
大额,要审批 → 已提交审批
```

什么时候用条件边、什么时候用 Command?我的习惯是:路由只看状态、和节点逻辑无关时用条件边,图结构一眼能看清;路由判断本身就是这个节点的主要工作时用 Command。两种别在同一个节点上混用。对应尚硅谷第 37 集。

### 第 10 步:Send,数量不固定的并行

第 6 步的并行是写死的两条边。如果要并行检查的发票有 3 张还是 30 张,运行时才知道,就用 `Send`:路由函数返回一组 `Send(节点名, 给这个节点的输入)`,每个 Send 起一个独立的任务。这就是 map-reduce。

```python
# agent-60-lab/w4/lg_steps/s10_send.py
import operator
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send


class State(TypedDict):
    invoices: list[str]
    checked: Annotated[list[str], operator.add]


class OneInvoice(TypedDict):
    invoice: str


def fan_out(state: State) -> list[Send]:
    return [Send("check_one", {"invoice": inv}) for inv in state["invoices"]]


def check_one(state: OneInvoice) -> dict:
    return {"checked": [f"{state['invoice']} ok"]}


builder = StateGraph(State)
builder.add_node("check_one", check_one)
builder.add_conditional_edges(START, fan_out, ["check_one"])
builder.add_edge("check_one", END)
graph = builder.compile()

print(graph.invoke({"invoices": ["INV-1", "INV-2", "INV-3"], "checked": []}))
```

<div class="line-notes">

- `checked: Annotated[list[str], operator.add]` 多个任务的结果要汇总到这里,所以必须配 reducer,第 6 步学过。
- `class OneInvoice(TypedDict):` `check_one` 节点用的是另一个更小的状态,只有一张发票。Send 允许给目标节点传任意形状的输入。
- `return [Send("check_one", {"invoice": inv}) for inv in state["invoices"]]` 有几张发票就生成几个 Send。这里 3 张,就并行跑 3 次 `check_one`。
- `builder.add_conditional_edges(START, fan_out, ["check_one"])` Send 是通过条件边发出去的。第三个参数列出可能的目标节点,用于画图。
- `print(graph.invoke(` 3 个任务的结果都进了 `checked`。

</div>

输出(实跑,langgraph 1.2.14):

```text
{'invoices': ['INV-1', 'INV-2', 'INV-3'], 'checked': ['INV-1 ok', 'INV-2 ok', 'INV-3 ok']}
```

这一步属于选学,今天用不到,Day 92 做 Deep Research 时要并行查一批子问题,会再见到它。对应尚硅谷第 36 集(动态分支)和第 39 集(动态扇入)。

### 第 11 步:把图画出来

最后一个小工具:`graph.get_graph().draw_mermaid()` 输出 Mermaid 格式的图,贴到 [mermaid.live](https://mermaid.live) 就能看到。图一复杂,先画出来对一眼结构,比读代码快。

```python
# agent-60-lab/w4/lg_steps/s11_draw.py
from s07_conditional import builder

graph = builder.compile()
print(graph.get_graph().draw_mermaid())
```

<div class="line-notes">

- `from s07_conditional import builder` 直接复用第 7 步的图纸。注意 import 会把 s07 整个文件执行一遍,所以输出最前面会先出现那三行分流结果。这是 Python import 的正常行为,真实项目里会把「建图」和「运行」分到不同文件,或者用 `if __name__ == "__main__":` 包住运行部分。
- `print(graph.get_graph().draw_mermaid())` 输出 Mermaid 文本。实线箭头是普通边,虚线是条件边;`other` 那条虚线上标着 path_map 里的名字。

</div>

运行时要在 `w4/lg_steps` 目录里跑(`cd w4/lg_steps && uv run python s11_draw.py`),因为它要 import 同目录的 s07。输出的后半段(实跑,省略了开头三行和样式行):

```text
graph TD;
	__start__([<p>__start__</p>]):::first
	classify(classify)
	billing(billing)
	refund(refund)
	human(human)
	__end__([<p>__end__</p>]):::last
	__start__ --> classify;
	classify -.-> billing;
	classify -. &nbsp;other&nbsp; .-> human;
	classify -.-> refund;
	billing --> __end__;
	human --> __end__;
	refund --> __end__;
```

在 Jupyter 里可以直接 `graph.get_graph().draw_mermaid_png()` 出图片,不过那个方法默认要联网调 mermaid.ink 的接口渲染。对应尚硅谷第 13 集。

### 十一步走完,回头对一下

| 你刚跑过的 | 下面 Agent 循环里对应哪一段 |
| --- | --- |
| 第 1–2 步的骨架和 stream | 从 `builder = StateGraph(State)` 到 `compile()` 那几行,以及「图编译之后是什么」里的 `stream` 打印 |
| 第 5 步的 `add_messages` | `messages: Annotated[list[AnyMessage], add_messages]` |
| 第 7 步的条件边 | `add_conditional_edges("llm", route, ["tools", END])` |
| 第 8 步的循环和计数 | `tools → llm` 那条边,以及 `llm_calls < MAX_LLM_CALLS` |
| 第 6、10 步的并行 | 下面的 `tools` 节点用 for 循环一个个执行工具调用;想让多个工具调用真并行,就用第 10 步的 Send 每个调用发一个任务(今天不要求) |

带着这张表往下读,260 行的代码就只是把这些零件拼在一起,再把「节点函数」从玩具换成真的调模型和调工具。

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
import json
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
        # Day 3 的 LLM_EXTRA_BODY:DeepSeek 要靠它关掉思考模式,否则下面的结构化输出会报 400
        extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}")),
    )
```

<div class="line-notes">

- `import json` 下面要把 `.env` 里 `LLM_EXTRA_BODY` 这段 JSON 字符串解析成字典。
- `from langchain_openai import ChatOpenAI` LangChain 对 OpenAI 兼容协议的封装。LangGraph 节点里调模型、`bind_tools`、`with_structured_output` 都靠它,所以这几天不再用 Day 4 的 `common/llm.py`。
- `load_dotenv()` 从当前目录往上找 `.env` 读进环境变量。在 `w4/lgdemo` 下运行时,它会一路找到 `agent-60-lab/.env`。
- `def get_llm(temperature: float = 0) -> ChatOpenAI:` 做成函数而不是模块级变量,是为了不同节点可以要不同的温度。默认 0,分类、路由这类要稳定的场景用 0。
- `model=os.environ["LLM_MODEL"],` 实测打印 `get_llm()` 的属性:`model_name='deepseek-flash'`、`temperature=0.0`。
- `base_url=os.environ["LLM_BASE_URL"],` 换厂商只改 `.env`,代码一行不动,和 Day 3 的约定一样。
- `extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}")),` 实测解析出来是 `{'thinking': {'type': 'disabled'}}`,会原样放进每次请求体。**这一行不能省**:我第一次照没有这行的版本跑 `triage_graph.py`,三张工单全挂在 classify 节点,报 `400 Thinking mode does not support this tool_choice`。原因是 `with_structured_output(method="function_calling")` 会强制模型调用那个「伪装成工具的 schema」(tool_choice 指定了工具),DeepSeek 开着思考模式时不接受这种 tool_choice。`agent_graph.py` 不受影响,因为它让模型自己决定调不调工具;但缺了这行,它每次调用会多出十几个思考 token。用 Claude 等别的厂商时,`.env` 里写 `LLM_EXTRA_BODY={}` 就行。

</div>

`extra_body` 那一行是今天最容易漏的:用 DeepSeek 时它负责关掉思考模式,漏了的话,后面用 `with_structured_output` 的分类节点会直接报 400。

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

<div class="line-notes">

- `from typing import Annotated, Literal` `Annotated` 用来给 `messages` 字段挂 reducer,`Literal` 用来标注 `route` 可能返回哪几个节点名。
- `from langchain_core.messages import AnyMessage, SystemMessage, ToolMessage` LangChain 的消息类型。`AnyMessage` 是所有消息类型的联合(Human/AI/Tool/System),State 里的消息列表就用它标注。
- `from langchain_core.tools import tool` `@tool` 装饰器,从函数签名和 docstring 生成工具定义。
- `from langgraph.graph import END, START, StateGraph` `START`、`END` 是两个特殊节点,实测它们的值就是字符串 `"__start__"` 和 `"__end__"`,所以下面 `route` 的返回类型里写的是 `"__end__"`。
- `from langgraph.graph.message import add_messages` 消息列表的 reducer:新消息追加到末尾,id 相同的替换。
- `from typing_extensions import TypedDict` 和 `typing.TypedDict` 用法一样。LangGraph 文档的示例都从 `typing_extensions` 导入,因为 Python 3.12 以下,pydantic 解析 TypedDict 时要求用这个版本;统一这样写,换 Python 版本也不出问题。
- `from llm import get_llm` 同目录的 `llm.py`。这是裸导入,所以要 `cd w4/lgdemo` 再按文件路径运行。
- `MAX_LLM_CALLS = 6` 业务层的步数上限,下面 `route` 用它。
- `@tool` 装饰之后 `get_weather` 不再是普通函数,实测类型是 `StructuredTool`,`.name` 是 `'get_weather'`,`.description` 就是 docstring 那句话。
- `def get_weather(city: str) -> str:` 签名决定参数 schema。实测 `bind_tools` 发给模型的定义是 `{"name": "get_weather", "description": "查询城市当前天气。city 用中文城市名,如「上海」。", "parameters": {"properties": {"city": {"type": "string"}}, "required": ["city"], "type": "object"}}`。
- `fake = {"上海": "小雨 19°C"` 写死的假数据,保证你我跑出来的工具结果一样,方便对照。
- `return fake.get(city, f"没有 {city} 的天气数据")` 查不到也返回一句模型能读懂的话,不抛异常。实测 `get_weather.invoke({"city": "深圳"})` 返回 `没有 深圳 的天气数据`。
- `if not set(expression) <= set("0123456789+-*/(). "):` 集合的 `<=` 是「是否子集」:算式里出现的每个字符都必须在白名单里。实测 `"19 - 15"` 通过;`"__import__('os')"` 里有字母和引号,返回 `表达式里有不允许的字符`。
- `return str(eval(expression))` 字符集已经限死,`eval` 在这里只能算四则运算。实测 `"19 - 15"` → `'4'`,`"1/3"` → `'0.3333333333333333'`。真项目里用 Day 8 那个基于 `ast` 的 `calculate` 更稳。
- `TOOLS = [get_weather, calculate]` 工具列表,既用来 `bind_tools`,也用来建下面的名字索引。
- `TOOLS_BY_NAME = {t.name: t for t in TOOLS}` 字典推导式,实测得到 `{'get_weather': ..., 'calculate': ...}`。`run_tools` 按模型给的工具名在这里找函数。
- `class State(TypedDict):` 整张图共享的状态。每个节点读它,返回一个字典表示要改哪些字段。
- `messages: Annotated[list[AnyMessage], add_messages]` 带 reducer 的字段:节点返回 `{"messages": [reply]}` 时是**追加**。实测一次完整运行后 `messages` 有 7 条:`Human, AI, Tool, Tool, AI, Tool, AI`。
- `llm_calls: int` 没有 reducer,节点返回什么就**覆盖**成什么。
- `llm_with_tools = get_llm().bind_tools(TOOLS)` 把两个工具的定义绑在模型上,之后每次 `invoke` 都会带上 `tools` 参数。实测返回的是一个 `_ChatModelBinding` 对象,用法和模型本身一样。放在模块级只建一次,不要放进节点函数里每次都建。
- `def call_llm(state: State) -> dict:` 第一个节点:调模型。
- `system = SystemMessage("你是一个助手。需要事实或计算时调用工具,不要心算。")` 系统提示词每次现拼,不存进 State。这样 State 里只有真实的对话,存档和恢复时干净。
- `reply = llm_with_tools.invoke([system] + state["messages"])` 列表相加拼出本次请求。第一次调用时是 `[System, Human]`;实测模型回的 `reply` 是 `AIMessage`,`content=''`,`tool_calls` 里有两个调用,分别是 `{'name': 'get_weather', 'args': {'city': '上海'}, 'id': 'call_00_…', 'type': 'tool_call'}` 和北京那个。这次的用量是 `input_tokens 357, output_tokens 67`。
- `return {"messages": [reply], "llm_calls": state.get("llm_calls", 0) + 1}` 只返回要更新的两个字段。`messages` 走 reducer 追加这条回复;`llm_calls` 从 0 变成 1。`state.get(..., 0)` 是防止调用方忘了传初始值。
- `def run_tools(state: State) -> dict:` 第二个节点:执行上一条 AI 消息里的所有工具调用。
- `for call in state["messages"][-1].tool_calls:` 最后一条一定是刚才那条 AI 消息。LangChain 已经把 OpenAI 格式的 `tool_calls` 转成了字典,`args` 是解析好的 dict,不用再 `json.loads`。实测第一轮这里循环两次(上海、北京)。
- `output = TOOLS_BY_NAME[call["name"]].invoke(call["args"])` 工具对象用 `.invoke(参数字典)` 调用。第一次 `call["args"]` 是 `{'city': '上海'}`,`output` 是 `'小雨 19°C'`。
- `results.append(ToolMessage(content=str(output), tool_call_id=call["id"]))` 每个结果都要带上对应调用的 id,模型才知道哪个结果对应哪个调用。实测两条 ToolMessage 的 `tool_call_id` 分别是 `call_00_…` 和 `call_01_…`。
- `return {"messages": results}` 两条 ToolMessage 一起追加,`llm_calls` 不动。
- `def route(state: State) -> Literal["tools", "__end__"]:` 条件边的判断函数,返回下一个节点的名字。
- `if getattr(last, "tool_calls", None) and state["llm_calls"] < MAX_LLM_CALLS:` `getattr(..., None)` 是因为最后一条可能不是 AI 消息,没有这个属性。实测:最后一条带工具调用、`llm_calls=2` → `'tools'`;同样的消息但 `llm_calls=6` → `'__end__'`(撞上限就结束);最后一条是纯文字回答 → `'__end__'`。
- `return END` 结束。`END` 就是字符串 `"__end__"`。
- `builder = StateGraph(State)` 用 State 类型建一个图构造器。
- `builder.add_node("llm", call_llm)` 注册节点:名字 + 函数。
- `builder.add_edge(START, "llm")` 入口固定先进 `llm`。
- `builder.add_conditional_edges("llm", route, ["tools", END])` `llm` 执行完调 `route` 决定去向。第三个参数列出所有可能的去向,画图用。
- `builder.add_edge("tools", "llm")` 工具执行完一定回到模型,循环就是这条边形成的。
- `graph = builder.compile()` 编译成可执行的图,检查节点和边是否连得通。
- `print(graph.get_graph().draw_mermaid())` 打印 Mermaid 图定义。实测输出里的关键几行是 `__start__ --> llm;`、`llm -.-> __end__;`、`llm -.-> tools;`、`tools --> llm;`,虚线 `-.->` 表示条件边。
- `out = graph.invoke({"messages": [("user", "上海和北京现在温差几度?")], "llm_calls": 0})` 初始状态里的 `("user", "…")` 元组会被 `add_messages` 自动转成 `HumanMessage`。这次实跑的完整路径:`llm`(并行查上海、北京)→ `tools` → `llm`(调 `calculate`,参数 `"19 - 15"`)→ `tools`(返回 `'4'`)→ `llm`(回答「当前温差是 **4°C**……」)→ 结束。
- `m.pretty_print()` LangChain 消息自带的格式化打印,就是正文示例里那种带 `====` 分隔线的输出。
- `print("LLM 调用次数:", out["llm_calls"])` 实测打印 `LLM 调用次数: 3`。三次调用的输入 token 依次是 357、454、506,每次都比上次多,因为消息越积越多。

</div>

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

<div class="line-notes">

- `from pydantic import BaseModel, Field` 分类结果用 pydantic 模型描述,和 Day 6 的结构化输出是同一套。
- `class Triage(BaseModel):` 要求模型返回的结构:类别、紧急程度、一句话摘要。
- `category: Literal["billing", "technical", "account", "other"] = Field(description="工单类别")` `Literal` 在 schema 里变成 `enum`。实测发给模型的工具定义里,这个字段是 `{"description": "工单类别", "enum": ["billing", "technical", "account", "other"], "type": "string"}`。模型只能四选一,下游路由才不会拿到意料之外的值。
- `urgency: Literal["low", "normal", "high"] = Field(description="紧急程度,影响付款或无法登录算 high")` description 里写了判定规则,模型会照着执行。这次实跑「被扣了两次款」被判成 `high`,因为它碰到了「影响付款」这一条;正文示例里是 `normal`,不同次运行可能不一样。
- `summary: str = Field(description="一句话概括客户诉求,不超过 30 字")` 实测返回 `'10月8日被重复扣款两次,要求退还一笔'`。
- `class TicketState(TypedDict, total=False):` `total=False` 让所有字段都变成可选。实测 `TicketState.__required_keys__` 是空集合,所以初始只传 `{"ticket": ...}` 也不会被类型检查拦下。
- `triage: Triage` State 里直接放了 pydantic 对象。今天没有 checkpointer 所以没问题;明天加了 checkpointer 会看到反序列化警告,那时改成存字典。
- `classifier = get_llm().with_structured_output(Triage, method="function_calling")` 把 `Triage` 转成一个名叫 `Triage` 的工具,并强制模型调用它,再把参数解析回 `Triage` 对象。**强制调用工具**这一点,就是 `llm.py` 里必须带 `extra_body` 关掉 DeepSeek 思考模式的原因,不关会报 400。
- `def classify(state: TicketState) -> dict:` 整张图里唯一调模型的节点。
- `result = classifier.invoke(` 输入直接传一个字符串,LangChain 会把它当成一条 user 消息。
- `"billing=扣款/退款/发票/价格;technical=报错/功能异常;account=登录/权限/注销;其余 other。\n\n"` 类别定义写进提示词,比只靠 description 更稳。分类不稳定时,先改这里的定义。
- `f"工单:{state['ticket']}"` f-string 里取字典值用单引号,因为外层已经是双引号。
- `return {"triage": result}` 实测第一张工单返回 `Triage(category='billing', urgency='high', summary='10月8日被重复扣款两次,要求退还一笔')`,stream 的 updates 模式里这一步打印为 `{'classify': {'triage': Triage(...)}}`。
- `def to_billing(state: TicketState) -> dict:` 三个分支节点都是普通函数,不调模型,只填 `owner` 和 `note`。
- `def pick_branch(state: TicketState) -> Literal["billing", "technical", "human"]:` 条件边函数,把四个类别映射到三个分支。
- `c = state["triage"].category` `triage` 是 pydantic 对象,用属性访问。
- `return "human"` `account` 和 `other` 都走一线客服。实测「验证码一直过期」被分成 `account`,走的就是这里。
- `def escalate_if_urgent(state: TicketState) -> dict:` 汇合节点,三个分支都会走到这里。
- `return {"note": state["note"] + ";紧急,30 分钟内响应"}` `note` 没有 reducer,所以这里要自己把旧值拼上再整体覆盖。实测第一张工单的 note 从 `需要查发票和订阅,W4 后面会接 MCP 工具` 变成了末尾加上 `;紧急,30 分钟内响应`。
- `return {}` 不紧急就返回空字典,表示什么都不改。实测传 `urgency="low"` 返回 `{}`。
- `builder = StateGraph(TicketState)` 第二张图,结构是 classify → 三选一 → escalate → END。
- `builder.add_conditional_edges("classify", pick_branch, ["billing", "technical", "human"])` `pick_branch` 返回的字符串必须是这里列出的节点名之一。
- `for branch in ["billing", "technical", "human"]:` 用循环给三个分支各加一条到 `escalate` 的普通边,省得写三行。
- `out = graph.invoke({"ticket": text})` 初始状态只有 `ticket`。用 `stream_mode="values"` 跑「验证码」那张,能看到状态一步步变长:先只有 `ticket` → 加上 `triage`(`account`/`high`)→ 加上 `owner: '一线客服'` 和 `note` → `note` 被追加「紧急」。
- `print(f"{text[:16]:<18} → {t.category:<9} {t.urgency:<6} {out['owner']} | {out['note']}")` `text[:16]` 截前 16 个字符,`:<18` 左对齐补空格到 18 宽。中文字符在终端里占两格宽,所以输出看起来没对齐。这次三张工单的实跑结果:<br>`10 月 8 号被扣了两次款,麻 → billing high 账务组 | …;紧急,30 分钟内响应`<br>`导出年度报表一直提示 ERR_E → technical normal 技术支持 | 先查知识库里的报错码文章`<br>`验证码一直过期,登录不了,急! → account high 一线客服 | …;紧急,30 分钟内响应`

</div>

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

<div class="line-notes">

- `for chunk in graph.stream({"messages": [("user", "上海天气?")], "llm_calls": 0}, stream_mode="updates"):` `stream` 边跑边吐。`updates` 模式下每个节点跑完吐一次,`chunk` 是 `{节点名: 该节点返回的更新}`。实测三次 chunk 的键依次是 `['llm']`、`['tools']`、`['llm']`。
- `for node, update in chunk.items():` 一个 chunk 一般只有一个节点;如果有并行分支同时完成,会有多个。
- `print(f"[{node}]", update["messages"][-1].content or update["messages"][-1].tool_calls)` 有文字就打文字,没有就打工具调用。实测输出:<br>`[llm] [{'name': 'get_weather', 'args': {'city': '上海'}, 'id': 'call_00_…', 'type': 'tool_call'}]`<br>`[tools] 小雨 19°C`<br>`[llm] 上海现在是小雨,气温 19°C。出门记得带伞,路面可能有点湿滑。`

</div>

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

<details><summary>参考答案</summary>

这题没有新代码,就是把正文的 `agent_graph.py` 跑起来:

```bash
cd agent-60-lab/w4/lgdemo
uv run python agent_graph.py
```

输出分两段。前半段是 Mermaid 文本(我实跑的,langgraph 1.2.16):

```text
---
config:
  flowchart:
    curve: linear
---
graph TD;
	__start__([<p>__start__</p>]):::first
	llm(llm)
	tools(tools)
	__end__([<p>__end__</p>]):::last
	__start__ --> llm;
	llm -.-> __end__;
	llm -.-> tools;
	tools --> llm;
	classDef default fill:#f2f0ff,line-height:1.2
	classDef first fill-opacity:0
	classDef last fill:#bfb6fc
```

从 `---` 那行一直复制到 `classDef last` 那行,贴进 [mermaid.live](https://mermaid.live) 左边的编辑框,右边就出图了。看图时对着读:`__start__ --> llm` 是实线,说明一进来一定先调模型;`llm -.-> tools` 和 `llm -.-> __end__` 是两条虚线,虚线就是条件边,跑的时候只会走其中一条;`tools --> llm` 是实线,工具跑完一定回模型,循环就是这条线。

后半段是对话过程。实跑这一次模型一共调了 3 次:第 1 次同时要了上海和北京的天气(一条 AI 消息里两个 `get_weather`),第 2 次调 `calculate` 算 `19 - 15`,第 3 次给出最终回答「两地温差 4°C」,最后打印 `LLM 调用次数: 3`。模型有时会心算温差、只调 2 次,这也算对,只要最终数字对。

</details>
2. 把 `add_messages` 那一行改成 `messages: list[AnyMessage]`(去掉 reducer),再跑一次,观察会发生什么,解释原因。改回来。

<details><summary>参考答案</summary>

改法:把 `agent_graph.py` 里 State 的那一行换成下面这样,其他一个字都别动。

```python
    messages: list[AnyMessage]  # 练习 2:去掉 reducer
```

直接跑 `agent_graph.py` 会看到一大串报错。为了看清楚报错之前状态里发生了什么,我写了一个观察脚本,每跑完一个节点打印一次状态里的消息类型:

```python
# agent-60-lab/w4/lgdemo/ex24_2_probe.py
"""练习 2 的观察脚本:每跑完一个节点,打印一次状态里有哪些消息。"""
from agent_graph import graph

inputs = {"messages": [("user", "上海和北京现在温差几度?")], "llm_calls": 0}
try:
    for state in graph.stream(inputs, stream_mode="values"):
        kinds = [type(m).__name__ if not isinstance(m, tuple) else "tuple" for m in state["messages"]]
        print(f"llm_calls={state['llm_calls']}  messages={kinds}")
except Exception as e:
    print("出错:", type(e).__name__, str(e)[:120])
```

<div class="line-notes">

- `from agent_graph import graph` 直接用 `agent_graph.py` 里编译好的图。你改了哪个版本的 State,这里拿到的就是哪个版本。
- `inputs = {` 和正文一样的问题,`llm_calls` 从 0 开始。
- `for state in graph.stream(inputs, stream_mode="values"):` `values` 模式每一步都吐出**完整状态**,最适合看「状态里现在到底有什么」。
- `kinds = [` 只打印每条消息的类型名,内容太长看不清。输入里的 `("user", "...")` 是元组,单独标成 `tuple`。
- `print(f"llm_calls=` 去掉 reducer 后实测打印了三行:`['tuple']` → `['AIMessage']` → `['ToolMessage', 'ToolMessage']`,然后报错。
- `except Exception as e:` 把报错接住,只打印前 120 个字,不然满屏堆栈。

</div>

去掉 reducer 时的输出(实跑):

```text
llm_calls=0  messages=['tuple']
llm_calls=1  messages=['AIMessage']
llm_calls=1  messages=['ToolMessage', 'ToolMessage']
出错: OpenAIInvalidRequestError Error code: 400 - {'error': {'message': "Messages with role 'tool' must be a response to a preceding message with 'tool_
```

改回 `add_messages` 后的输出(实跑):

```text
llm_calls=0  messages=['HumanMessage']
llm_calls=1  messages=['HumanMessage', 'AIMessage']
llm_calls=1  messages=['HumanMessage', 'AIMessage', 'ToolMessage', 'ToolMessage']
llm_calls=2  messages=['HumanMessage', 'AIMessage', 'ToolMessage', 'ToolMessage', 'AIMessage']
llm_calls=2  messages=['HumanMessage', 'AIMessage', 'ToolMessage', 'ToolMessage', 'AIMessage', 'ToolMessage']
llm_calls=3  messages=['HumanMessage', 'AIMessage', 'ToolMessage', 'ToolMessage', 'AIMessage', 'ToolMessage', 'AIMessage']
```

对比两段就能看出发生了什么。没有 reducer 时,`llm` 节点返回 `{"messages": [reply]}`,整个列表被换成只有这一条 AI 消息,用户的问题没了;接着 `tools` 节点返回两条工具结果,又把列表整个换掉,AI 消息也没了。第二次调模型时发出去的是「系统提示 + 两条 tool 消息」,前面没有发起工具调用的 assistant 消息,DeepSeek 直接回 400:`tool` 角色的消息必须跟在带 `tool_calls` 的消息后面。

还有个小细节:有 reducer 时第一行是 `HumanMessage`,没有时是 `tuple`。`add_messages` 除了追加,还会把 `("user", "...")` 这种简写转成正式的消息对象。

一句话说清 reducer 的作用:**它决定节点返回的新值怎么和旧值合并;没写就是直接覆盖**。这次因为有工具调用,覆盖之后消息顺序不合法,接口报错了,算是运气好。纯聊天的图没有这个约束,覆盖之后不会报任何错,模型只是悄悄忘掉前面说过的话,那才难查。验完记得改回来。

</details>
3. 用 `langgraph.prebuilt` 里的 `ToolNode(TOOLS)` 和 `tools_condition` 替换手写的 `run_tools` 和 `route`,确认行为一致。注意 `tools_condition` 返回的节点名是 `"tools"`,所以工具节点要叫这个名字。

<details><summary>参考答案</summary>

新建一个文件,复用 `agent_graph.py` 里的 State、工具列表和 `call_llm`,只把工具节点和路由换成官方现成的:

```python
# agent-60-lab/w4/lgdemo/agent_graph_prebuilt.py
"""练习 3:用 LangGraph 自带的 ToolNode 和 tools_condition 换掉手写的 run_tools 和 route。"""
from langgraph.graph import START, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition

from agent_graph import TOOLS, State, call_llm

builder = StateGraph(State)
builder.add_node("llm", call_llm)
builder.add_node("tools", ToolNode(TOOLS))  # 名字必须叫 "tools",tools_condition 只认这个
builder.add_edge(START, "llm")
builder.add_conditional_edges("llm", tools_condition)  # 有工具调用 → "tools",否则 → END
builder.add_edge("tools", "llm")
graph = builder.compile()

if __name__ == "__main__":
    out = graph.invoke({"messages": [("user", "上海和北京现在温差几度?")], "llm_calls": 0})
    for m in out["messages"]:
        calls = [(c["name"], c["args"]) for c in getattr(m, "tool_calls", [])]
        print(f"{type(m).__name__:<12} {calls or m.content}")
    print("LLM 调用次数:", out["llm_calls"])
```

<div class="line-notes">

- `from langgraph.prebuilt import ToolNode, tools_condition` `prebuilt` 是 LangGraph 自带的现成零件。本机装的 langgraph-prebuilt 是 1.1.1,装 langgraph 时会一起装上。
- `from agent_graph import TOOLS, State, call_llm` 不重复造轮子:State 和调模型的节点直接拿 Day 24 的。import 时 `agent_graph.py` 末尾的 `if __name__ == "__main__":` 不会执行,所以不会顺带跑一遍对话。
- `builder.add_node("tools", ToolNode(TOOLS))` `ToolNode` 干的事和我们手写的 `run_tools` 一样:读最后一条 AI 消息里的 `tool_calls`,逐个执行,包成 `ToolMessage`。两点不同:多个工具调用它会放进线程池**并发**执行(源码里用的是 `executor.map`);工具抛异常时它默认把错误信息变成一条 ToolMessage 还给模型,而不是让整张图崩掉。
- `builder.add_conditional_edges("llm", tools_condition)` `tools_condition` 看最后一条消息有没有工具调用,有就返回 `"tools"`,没有就返回 END。它把返回值写死成 `"tools"`,所以上一行的节点名必须叫 `tools`,叫别的名字 compile 时会报找不到节点。
- `for m in out["messages"]:` 把每条消息压成一行打印:有工具调用就打印 (工具名, 参数),没有就打印正文。
- `print("LLM 调用次数:", out["llm_calls"])` 实测还是 3,`call_llm` 没换,计数照旧。

</div>

输出(实跑):

```text
HumanMessage 上海和北京现在温差几度?
AIMessage    [('get_weather', {'city': '上海'}), ('get_weather', {'city': '北京'})]
ToolMessage  小雨 19°C
ToolMessage  晴 15°C
AIMessage    [('calculate', {'expression': '19 - 15'})]
ToolMessage  4
AIMessage    现在上海 19°C（小雨），北京 15°C（晴），两地温差 **4°C**，上海更暖一些。
LLM 调用次数: 3
```

消息顺序、工具调用、最终答案都和手写版一致,行为一致。

但有一处不一样要注意:我们手写的 `route` 里有 `llm_calls < MAX_LLM_CALLS` 这道步数上限,`tools_condition` 没有。换成现成零件后,步数上限就只剩 `recursion_limit` 了。真实项目里我会保留手写的 `route`(三行代码,换来一个能优雅结束的上限),工具节点用 `ToolNode`(省掉错误处理和并发)。现成零件不是全换或全不换,哪个省事用哪个。

</details>
4. 跑通 `triage_graph.py`。然后写一个小脚本,从 Day 23 的 `cloudledger.db` 里读出全部 41 张工单,逐张跑分类,统计四个类别各多少张,把你认为分错的挑出来,修改 `classify` 里的类别定义,再跑一遍对比。

<details><summary>参考答案</summary>

分两步做。第一步,把库里 41 张工单全跑一遍,看看分布:

```python
# agent-60-lab/w4/lgdemo/triage_all.py
"""练习 4:把 cloudledger.db 里的 41 张工单全部过一遍 triage_graph,按类别和主题统计。"""
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path

import importlib

MODULE = next((a for a in sys.argv[1:] if not a.startswith("-")), "triage_graph")
graph = importlib.import_module(MODULE).graph

DB = Path(__file__).resolve().parent.parent / "cloudledger" / "cloudledger.db"

with sqlite3.connect(DB) as conn:
    rows = conn.execute("SELECT id, subject, body FROM tickets ORDER BY id").fetchall()

inputs = [{"ticket": f"{subject}\n{body}"} for _, subject, body in rows]
outs = graph.batch(inputs, config={"max_concurrency": 8})  # 8 张一起跑,41 张十几秒

by_cat = Counter(o["triage"].category for o in outs)
print("类别统计:", dict(by_cat))

by_subject: dict[str, Counter] = defaultdict(Counter)
for (tid, subject, _), o in zip(rows, outs):
    by_subject[subject][o["triage"].category] += 1
print(f"\n{'主题':<14}{'张数':>4}  分到的类别")
for subject, cats in sorted(by_subject.items(), key=lambda kv: -sum(kv[1].values())):
    print(f"{subject:<14}{sum(cats.values()):>4}  {dict(cats)}")

if "-v" in sys.argv:  # 加 -v 把每张单子的结果都打出来,方便挑错
    for (tid, subject, body), o in zip(rows, outs):
        print(tid, subject, "→", o["triage"].category, o["triage"].urgency, "|", body[:30])
```

<div class="line-notes">

- `import importlib` 后面要比较好几个版本的分类定义,所以用 `importlib` 按名字导入模块,版本名从命令行传。
- `MODULE = next(` 取命令行里第一个不以 `-` 开头的参数当模块名,没给就用 `triage_graph`。比如 `uv run python triage_all.py triage_graph_v3 -v`。
- `graph = importlib.import_module(MODULE).graph` 等价于 `from triage_graph import graph`,只是模块名是变量。
- `DB = Path(__file__).resolve().parent.parent / "cloudledger" / "cloudledger.db"` 从 `w4/lgdemo/` 往上一层到 `w4/`,再进 `cloudledger/`。这个库是 Day 23 的 `seed.py` 生成的,实测 41 张工单。
- `rows = conn.execute(` 只取 id、主题、正文三列,按 id 排序。
- `inputs = [{"ticket": f"{subject}\n{body}"}` 主题和正文拼在一起交给分类节点,和真实客服系统里看到的一样。
- `outs = graph.batch(inputs, config={"max_concurrency": 8})` `batch` 一次跑一批输入,`max_concurrency` 控制同时最多 8 个。41 张实测十几秒跑完,一张张 `invoke` 要一分多钟。
- `by_cat = Counter(` `Counter` 是计数用的字典,类似 JS 里自己写 `counts[k] = (counts[k] ?? 0) + 1`。
- `by_subject: dict[str, Counter] = defaultdict(Counter)` 按工单主题再分一层:同一个主题的工单分到了哪些类别。库里的工单是按 8 个主题模板造的,同主题的正文几乎一样,如果同主题被分到两个类别,说明模型不稳定。
- `if "-v" in sys.argv:` 加 `-v` 把 41 张逐张打出来,方便挑错。

</div>

输出(实跑,不带 `-v`):

```text
类别统计: {'technical': 6, 'billing': 26, 'account': 9}

主题              张数  分到的类别
登录不了             9  {'account': 9}
重复扣款             8  {'billing': 8}
导出报表报错           6  {'technical': 6}
申请退款             5  {'billing': 5}
发票抬头修改           5  {'billing': 5}
升级套餐             4  {'billing': 4}
取消订阅             3  {'billing': 3}
席位数量不对           1  {'billing': 1}
```

老实说,我找不到分错的。我把类别定义那一行整个删掉再跑两次,结果一张都没变。库里这 41 张是按模板造的,每一类都很典型,模型闭着眼都能分对。这本身就是一个结论:**测试集太简单,改提示词改不出差别**,Day 5 遇到过同样的情况。

所以第二步,自己写 8 张「两边都沾」的难工单,每张跑 3 次:

```python
# agent-60-lab/w4/lgdemo/triage_edge.py
"""练习 4 的第二步:库里的 41 张都太好分,自己写 8 张「两边都沾」的难工单,每张跑 3 次看稳不稳。"""
import importlib
import sys
from collections import Counter

MODULE = sys.argv[1] if len(sys.argv) > 1 else "triage_graph"
graph = importlib.import_module(MODULE).graph

# (工单, 我认为正确的类别)。规则:只要客户要的是钱上的处理,就算 billing
EDGE = [
    ("员工离职了,他的账号怎么删?删了以后席位费会少收吗", "billing"),
    ("想把公司账户注销掉,剩下的年费能退吗", "billing"),
    ("导出发票 PDF 的时候一直转圈,导不出来", "technical"),
    ("升级企业版的钱扣了,但功能还是基础版的", "billing"),
    ("开发票的邮件一直收不到,查了垃圾箱也没有", "billing"),
    ("你们的 API 文档在哪里看", "other"),
    ("管理员权限被别人改掉了,现在我进不了设置页", "account"),
    ("登录页一直报 500 错误,同事也一样", "technical"),
]
RUNS = 3

inputs = [{"ticket": t} for t, _ in EDGE for _ in range(RUNS)]
outs = graph.batch(inputs, config={"max_concurrency": 8})

right = 0
for i, (ticket, want) in enumerate(EDGE):
    got = Counter(o["triage"].category for o in outs[i * RUNS:(i + 1) * RUNS])
    right += got[want]
    mark = "✓" if got[want] == RUNS else "✗"
    print(f"{mark} {ticket[:22]:<24} 期望 {want:<9} 实际 {dict(got)}")
print(f"{MODULE}: {right}/{len(EDGE) * RUNS} 次分对")
```

<div class="line-notes">

- `MODULE = sys.argv[1] if len(sys.argv) > 1 else "triage_graph"` 同样按名字选要测的版本。
- `EDGE = [` 每条是 (工单, 我认为正确的类别)。正确答案是我按一条规则定的:客户最终要的是钱上的处理,就算 billing。这条规则是业务决定,不是模型决定,你们公司可以定成别的。
- `("员工离职了,他的账号怎么删?删了以后席位费会少收吗", "billing"),` 同时沾 account(删账号)和 billing(席位费)。
- `("想把公司账户注销掉,剩下的年费能退吗", "billing"),` 注销是 account 的关键词,但客户真正关心的是退钱。
- `("导出发票 PDF 的时候一直转圈,导不出来", "technical"),` 有「发票」两个字,但这是功能故障。
- `("登录页一直报 500 错误,同事也一样", "technical"),` 有「登录」,但 500 是服务端报错,不是账号问题。
- `RUNS = 3` 每张跑 3 次。只跑一次看不出模型稳不稳。
- `inputs = [{"ticket": t} for t, _ in EDGE for _ in range(RUNS)]` 8 张 × 3 次 = 24 个输入,按顺序排好,一次 `batch` 跑完。
- `got = Counter(o["triage"].category for o in outs[i * RUNS:(i + 1) * RUNS])` 第 i 张工单的 3 次结果在 `outs` 里是连着的,切片取出来计数。
- `mark = "✓" if got[want] == RUNS else "✗"` 3 次全对才打勾。

</div>

用原版定义跑(实跑两次,结果相同):

```text
✗ 员工离职了,他的账号怎么删?删了以后席位费会   期望 billing   实际 {'account': 3}
✗ 想把公司账户注销掉,剩下的年费能退吗       期望 billing   实际 {'account': 3}
✓ 导出发票 PDF 的时候一直转圈,导不出来    期望 technical 实际 {'technical': 3}
✓ 升级企业版的钱扣了,但功能还是基础版的      期望 billing   实际 {'billing': 3}
✓ 开发票的邮件一直收不到,查了垃圾箱也没有     期望 billing   实际 {'billing': 3}
✓ 你们的 API 文档在哪里看           期望 other     实际 {'other': 3}
✓ 管理员权限被别人改掉了,现在我进不了设置页    期望 account   实际 {'account': 3}
✓ 登录页一直报 500 错误,同事也一样      期望 technical 实际 {'technical': 3}
triage_graph: 18/24 次分对
```

错的两张都是「注销/删账号 + 钱」,模型看到注销就分给了 account。于是我把 `triage_graph.py` 复制成 `triage_graph_v2.py`,在类别定义后面加一句消歧规则:

```python
        "billing=扣款/退款/发票/价格;technical=报错/功能异常;account=登录/权限/注销;其余 other。\n"
        "两类都沾时按客户最终要的结果分:要退钱、少收钱、核对费用的一律 billing,哪怕同时提到注销或删账号;"
        "登录页、导出等功能报错码算 technical,哪怕发生在登录或发票页面。\n\n"
```

难工单变成 24/24。但再跑一遍那 41 张,出事了:

```text
类别统计: {'technical': 15, 'billing': 26}
登录不了             9  {'technical': 9}
```

「验证码一直过期,登录不了」9 张全被分成了 technical,account 一张都没了。原因是我那句「登录页……算 technical」写得太宽,模型把所有登录问题都当成了技术故障。**修好一处,弄坏另一处**,这就是为什么改完提示词一定要把原来的测试集也重跑一遍。

`triage_graph_v3.py` 把那半句收窄:

```python
        "两类都沾时按客户最终要的结果分:要退钱、少收钱、核对费用的一律 billing,哪怕同时提到注销或删账号;"
        "出现具体报错码(如 500、ERR_ 开头)或页面卡住转圈的算 technical;"
        "验证码收不到或过期、密码、权限这类登录问题仍是 account。\n\n"
```

三个版本放在一起(都是实跑):

| 版本 | 难工单 24 次 | 库里 41 张的类别分布 | 结论 |
| --- | --- | --- | --- |
| 原版 | 18/24 | billing 26、account 9、technical 6 | 注销 + 退钱分错 |
| v2 | 24/24 | billing 26、technical 15、account 0 | 难题修好了,登录类 9 张全被带偏 |
| v3 | 24/24(跑了两次) | billing 26、account 9、technical 6 | 两边都对 |

运行命令:

```bash
cd agent-60-lab/w4/lgdemo
uv run python triage_all.py                  # 原版,41 张
uv run python triage_edge.py                 # 原版,难工单
uv run python triage_edge.py triage_graph_v3
uv run python triage_all.py triage_graph_v3
```

这一轮总共调了大约 300 次模型,按 deepseek-flash 的价格不到一块钱。

</details>
5. 加分题:给 `triage_graph` 加一个 `billing` 分支下的子步骤,当分类是 billing 且工单正文里出现「退」字时,在 note 里追加「可能涉及退款,需审批」。想一想,这个判断应该放在条件边里还是节点里?

<details><summary>参考答案</summary>

答案是**放在节点里**。判断「要不要追加备注」会改 State 里的 `note`,而条件边的路由函数只能返回「下一站去哪」,它的返回值不会写进状态(正文第 7 步讲过)。所以这里加一个 `refund_check` 节点,接在 `billing` 后面:

```python
# agent-60-lab/w4/lgdemo/triage_refund.py
"""练习 5:billing 分支下加一个子步骤,工单里提到「退」就在 note 里标出需要审批。"""
from langgraph.graph import END, START, StateGraph

from triage_graph import (TicketState, classify, escalate_if_urgent, pick_branch,
                          to_billing, to_human, to_technical)


def refund_check(state: TicketState) -> dict:
    if "退" in state.get("ticket", ""):
        return {"note": state.get("note", "") + ";可能涉及退款,需审批"}
    return {}


builder = StateGraph(TicketState)
builder.add_node("classify", classify)
builder.add_node("billing", to_billing)
builder.add_node("refund_check", refund_check)
builder.add_node("technical", to_technical)
builder.add_node("human", to_human)
builder.add_node("escalate", escalate_if_urgent)
builder.add_edge(START, "classify")
builder.add_conditional_edges("classify", pick_branch, ["billing", "technical", "human"])
builder.add_edge("billing", "refund_check")  # billing 先定负责人,再做退款检查
builder.add_edge("refund_check", "escalate")
builder.add_edge("technical", "escalate")
builder.add_edge("human", "escalate")
builder.add_edge("escalate", END)
graph = builder.compile()

if __name__ == "__main__":
    for text in ["10 月 8 号被扣了两次款,麻烦退一笔", "上个月的发票抬头写错了,能重开吗"]:
        out = graph.invoke({"ticket": text})
        print(f"{text[:16]:<18} → {out['triage'].category:<8} {out['owner']} | {out['note']}")
```

<div class="line-notes">

- `from triage_graph import (TicketState, classify, escalate_if_urgent, pick_branch,` 节点函数和 State 全部复用 `triage_graph.py` 的,这个文件只负责重新连线。
- `def refund_check(state: TicketState) -> dict:` 新节点。只有走到 billing 分支的工单才会经过它。
- `if "退" in state.get("ticket", ""):` 题目要求的规则:工单原文里有「退」字。用 `.get` 而不是 `state["ticket"]`,是因为 `TicketState` 写了 `total=False`(所有字段都可以没有),直接用方括号取值 Zed 会标红。
- `return {"note": state.get("note", "") + ";可能涉及退款,需审批"}` 在 billing 节点写好的备注后面追加。`note` 没有 reducer,所以要自己把旧值拼上再返回,直接返回新句子会把旧备注覆盖掉。
- `return {}` 没有「退」字就什么都不改。返回空字典是合法的。
- `builder.add_edge("billing", "refund_check")` billing 跑完先进 refund_check,再去 escalate。原来 `billing → escalate` 那条边就不要了。
- `builder.add_edge("technical", "escalate")` 另外两个分支照旧直接去 escalate。

</div>

输出(实跑):

```text
10 月 8 号被扣了两次款,麻   → billing  账务组 | 需要查发票和订阅,W4 后面会接 MCP 工具;可能涉及退款,需审批;紧急,30 分钟内响应
上个月的发票抬头写错了,能重开吗   → billing  账务组 | 需要查发票和订阅,W4 后面会接 MCP 工具
```

第一张有「退」字,备注里多了一句;第二张没有,原样通过。三段备注的顺序正好就是节点执行的顺序:billing → refund_check → escalate。

也可以不加新节点,直接把这个判断写进 `to_billing` 函数里。两种都对。单独成一个节点的好处是在 stream 和图里都看得见这一步,后面 Day 25 想在这里加人工审批时,也有地方接。

</details>

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
<figcaption>尚硅谷 · 尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战 · 2026 年 7 月发布,132 集共约 21 小时。只讲 LangGraph 本身,讲得很细,今天看第 8–34、37、40–47 集,分集清单见下面。</figcaption>
</figure>

这套课我按目录过了一遍(2026-10-22 查,B 站播放 83 万、收藏 1.4 万),值得看,但别从头刷到尾。它的长处是把 LangGraph 的 API 一个个拆开讲透:state 和 reducer 讲了十几集,`Send` 动态扇出、`Command`、重试/超时/节点缓存、Postgres checkpoint 的表结构、fork 回放、并行中断时的检查点、子图的持久化策略,这些很多教程一笔带过的地方它都单独录了一集。短处也明显:标题写「项目实战」,其实没有一个完整项目,部署只有 3 集、设计模式 5 集几分钟带过;**多 Agent(supervisor、handoff)、MCP 接入、评测都没讲**,这些还是看本课 Day 26、Day 23 和 W5。环境用的是 miniconda + Jupyter,和本课的 uv 不一样,第 1–7 集直接跳过。

| 集数 | 内容 | 时长 | 对应本课 | 建议 |
| --- | --- | --- | --- | --- |
| 1–7 | 装 miniconda、Jupyter、配 key | 1 小时 | Day 0 | 跳过,我们用 uv |
| 8–34、37、40–47 | 三要素、state/reducer、边、条件分支、Command、循环和退出 | 5.5 小时 | **Day 24** | 今天看 |
| 35–36、38–39、48–55 | 延时节点、动态分支和扇入(Send)、重试、超时、缓存 | 2.2 小时 | Day 24 / Day 37 | 选看,写并行和容错时回来查 |
| 56–60、65–77、84–93、107–116 | checkpoint、Postgres 检查点、时间旅行和 fork、interrupt 审批、流式、子图入门 | 6.6 小时 | **Day 25** | 明天看 |
| 61–64 | 装 PostgreSQL 和 SQL 基础 | 0.5 小时 | Day 17 | 跳过,Day 17 装过了 |
| 78–83、94–97、117–127 | 长期记忆 store、静态断点、子图持久化细节 | 3.2 小时 | Day 25 / Day 48 | 选看 |
| 98–106 | LangSmith 调试、部署、ToolNode、`wrap_tool_call` | 1.9 小时 | Day 34 / Day 41 | 选看,`wrap_tool_call` 那集值得看 |
| 128–132 | 提示词链、路由、编排者-工作者、评估-优化、agent | 0.5 小时 | Day 13 | 当 Day 13 的 LangGraph 版复习 |


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
