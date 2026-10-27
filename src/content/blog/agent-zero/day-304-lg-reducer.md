---
title: 'Day 304 · LangGraph(五):reducer 和 add_messages'
description: '昨天踩了覆盖的坑,今天补洞:用 Annotated 给字段挂上 operator.add,节点只返回这一步新增的内容;实测配了 reducer 的字段从空值起步、初始输入也会走一遍 reducer、类型不对会怎样、想清空要用 Overwrite;自己写 reducer 时内置 max 会报错;再看 add_messages 在拼接之外的按 id 替换、字典转消息、RemoveMessage,以及怎么一行修好昨天的 messages 事故。'
pubDate: 2026-10-27
regime: none
tags: ['langgraph', 'state-graph', 'reducer', 'add-messages', 'python', 'agent-zero']
series: 'agent-zero'
day: 304
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 303](/blog/agent-zero/day-303-lg-overwrite/) 踩了 LangGraph 最常见的坑:字段没配合并规则时,节点返回什么,字段就变成什么,旧值被覆盖,不报错。两个节点往 `notes` 里各写一条,最后只剩一条;`messages` 不配规则,模型每一轮只看得到最新一条。手动「读旧值、拼新的」的办法在串行时勉强能用,两个节点并行写同一个键就直接报 `Can receive only one value per step`,提示里写着「用 `Annotated` 的键」。

今天就用它。这个「合并规则」叫 reducer,名字和你在 JS 里用的 `reduce` 是一回事:`arr.reduce((旧, 新) => 合并, 初始值)`。LangGraph 把每个节点的更新依次「reduce」进状态里,你只需要说清楚两个值怎么合。依旧不调模型,花费 ¥0。

## 今天要解决的问题

学完今天,你要能做到:

1. 用 `Annotated[类型, operator.add]` 给字段配 reducer,让节点只返回「这一步新增的」,并能预测列表、数字、字符串三种类型配 `operator.add` 的结果。
2. 说出配了 reducer 的字段有哪些特点:从空值起步、初始输入也会走 reducer、类型不对会怎样、想清空要用 `Overwrite`。
3. 自己写一个 reducer(两个参数 旧值、新值,返回合并后的值),并说出为什么不能直接把内置的 `max` 传进去。
4. 说出 `add_messages` 比 `operator.add` 多做的几件事(按 id 替换、字典转消息、自动补 id、`RemoveMessage`),会用 `MessagesState`,并用它修好昨天的 messages 事故。

预计用时 2.5 小时。今天不调模型,花费 ¥0。前置:[Day 303](/blog/agent-zero/day-303-lg-overwrite/)(覆盖规则、`stream_mode="values"`、`[*列表, 新项]`)、[Day 302](/blog/agent-zero/day-302-lg-state-styles/)(TypedDict 状态)、[Day 298](/blog/agent-zero/day-298-langchain-vs-langgraph/)(`Annotated` 的写法)、[Day 30](/blog/agent-zero/day-030-functions-3/)(函数可以当参数传)、[Day 301](/blog/agent-zero/day-301-lg-sequence/)(`stream`)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `s05_add.py` 里的状态定义和 `s05_custom.py` 里的 `merge_unique`;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

所有命令在 `agent-zero-lab/` 根目录跑(我的是 `/Users/你/agent-zero-lab`)。今天会 import `langchain_core` 里的消息类,它是装 `langgraph` 时顺带装上的,但直接 import 的东西最好显式声明依赖,先加一行:

```bash
cd /Users/你/agent-zero-lab
uv add langchain-core
uv run python cloudledger/seed.py
```

<div class="line-notes">

- `uv add langchain-core` 把 `langchain-core` 写进 `pyproject.toml`(≈ `npm install` 并写进 `package.json`)。它已经因为 `langgraph` 装好了,所以我这里只是登记,输出 `Checked 38 packages`。我装到的是 `langchain-core 1.7.0`,`langgraph 1.2.18`(2026 年 10 月 27 日查到的最新版)。
- `uv run python cloudledger/seed.py` 删库重建,输出 `已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}`。

</div>

## 第 1 步:operator.add,节点只返回新增的

把昨天的 `s04_overwrite.py` 改一处:`notes` 的类型从 `list[str]` 改成 `Annotated[list[str], operator.add]`。`Annotated[类型, 备注]` 在 [Day 298](/blog/agent-zero/day-298-langchain-vs-langgraph/) 见过:类型仍然是第一个参数,后面挂一份给别的工具看的备注。这里的备注是一个函数,LangGraph 读到它就知道「这个字段更新时用它来合并」。`operator.add` 是标准库里 `+` 的函数形式,`operator.add(a, b)` 等于 `a + b`,列表相加就是拼接。

```python
# agent-zero-lab/part05/lg/s05_add.py
"""给 notes 配上 operator.add:节点只返回「这一步新增的」,框架负责拼。
用法:uv run python -m part05.lg.s05_add"""
import operator
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    notes: Annotated[list[str], operator.add]
    steps: int


def look_customer(state: State) -> dict:
    return {"notes": ["查了客户"], "steps": state["steps"] + 1}


def look_invoices(state: State) -> dict:
    return {"notes": ["查了发票"]}  # steps 没写,没配 reducer,保持原值


builder = StateGraph(State)
builder.add_sequence([look_customer, look_invoices])
builder.add_edge(START, "look_customer")
builder.add_edge("look_invoices", END)
graph = builder.compile()

if __name__ == "__main__":
    init: State = {"notes": ["用户来信"], "steps": 0}
    for chunk in graph.stream(init, stream_mode="values"):
        print(chunk)
    print("调用者手里的 init 没被动:", init)
```

<div class="line-notes">

- `import operator` 标准库,里面有 `add`、`mul` 等运算符的函数版本。
- `from typing import Annotated, TypedDict` `Annotated` 是新加的。
- `notes: Annotated[list[str], operator.add]` 类型是 `list[str]`,合并规则是 `operator.add`。以后每次有节点返回 `notes`,框架做的是 `旧的 notes + 返回的 notes`。
- `steps: int` 这一个**故意不配**,和昨天一样,拿来对比。
- `return {"notes": ["查了客户"], "steps": state["steps"] + 1}` 节点现在只返回「这一步新增的」一条。代入:旧 `notes` 是 `['用户来信']`,框架算 `['用户来信'] + ['查了客户']`。`steps` 没配 reducer,所以这里仍然要自己读旧值加 1,得到 1。
- `return {"notes": ["查了发票"]}  # steps 没写,没配 reducer,保持原值` `notes` 再加一条;`steps` 没提,保持 1。
- `builder.add_sequence([look_customer, look_invoices])` 和昨天完全一样的图,只有状态那一行变了。
- `for chunk in graph.stream(init, stream_mode="values"):` 每一步后看完整状态。
- `print("调用者手里的 init 没被动:", init)` 框架合并时造的是新列表,调用者的列表不会被改。

</div>

```bash
uv run python -m part05.lg.s05_add
```

```text
{'notes': ['用户来信'], 'steps': 0}
{'notes': ['用户来信', '查了客户'], 'steps': 1}
{'notes': ['用户来信', '查了客户', '查了发票'], 'steps': 1}
调用者手里的 init 没被动: {'notes': ['用户来信'], 'steps': 0}
```

对比昨天:最终 `notes` 是 `['用户来信', '查了客户', '查了发票']`,三条都在。`steps` 还是 1,和昨天一样,因为它没配 reducer。节点代码里没有 `*state["notes"]`,也不用担心忘了带旧值。最后一行说明调用者的 `init` 没被碰,和昨天原地 `append` 的事故正相反。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="reducer 的工作方式:节点返回更新,框架取出状态里的旧值,把旧值和更新交给 reducer,reducer 返回的合并结果写回状态;以 notes 为例,旧值是用户来信加查了客户两条,节点返回查了发票,operator.add 拼接成三条;steps 没有 reducer 所以新值直接替换旧值">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="22" fill="var(--ink-faint)" font-size="11">配了 reducer 的 notes</text>
<rect x="20" y="32" width="150" height="54" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="95" y="52" fill="var(--ink-soft)" text-anchor="middle" font-size="11">旧值 old</text>
<text x="95" y="72" fill="var(--ink)" text-anchor="middle" font-size="11">[来信, 查了客户]</text>
<rect x="20" y="104" width="150" height="40" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="95" y="120" fill="var(--ink-soft)" text-anchor="middle" font-size="11">节点返回 new</text>
<text x="95" y="136" fill="var(--ink)" text-anchor="middle" font-size="11">[查了发票]</text>
<rect x="240" y="60" width="160" height="56" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="320" y="82" fill="var(--ink)" text-anchor="middle">reducer(old, new)</text>
<text x="320" y="102" fill="var(--ink-soft)" text-anchor="middle" font-size="11">operator.add: old + new</text>
<rect x="470" y="60" width="150" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="545" y="82" fill="var(--ink-soft)" text-anchor="middle" font-size="11">新状态</text>
<text x="545" y="102" fill="var(--ink)" text-anchor="middle" font-size="11">[来信, 查了客户, 查了发票]</text>
<line x1="170" y1="59" x2="238" y2="80" stroke="var(--ink-soft)"/>
<line x1="170" y1="124" x2="238" y2="98" stroke="var(--ink-soft)"/>
<line x1="400" y1="88" x2="468" y2="88" stroke="var(--ink-soft)"/>
<polygon points="470,88 462,84 462,92" fill="var(--ink-soft)"/>
<text x="20" y="182" fill="var(--ink-faint)" font-size="11">没配 reducer 的 steps</text>
<rect x="20" y="192" width="380" height="36" rx="6" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="210" y="215" fill="var(--ink-soft)" text-anchor="middle" font-size="11">默认规则:new 直接替换 old(Day 303)</text>
<text x="420" y="215" fill="var(--ink-faint)" font-size="11">reducer 是被换掉的这一环</text>
</g>
</svg>
<figcaption>reducer 就是「旧值和新值怎么合」这一个函数。不配的字段用默认规则,新值替换旧值。</figcaption>
</figure>

## 第 2 步:配了 reducer 的字段有哪些脾气

reducer 不只是一个加号。下面几个行为,第一次用时我都很意外,逐个实测:没给初始值是什么样、类型对不上怎么样、想清空怎么办。

```python
# agent-zero-lab/part05/lg/s05_defaults.py
"""配了 reducer 的字段有哪些行为:初始值、类型不匹配、想清空怎么办。
用法:uv run python -m part05.lg.s05_defaults"""
import operator
from typing import Annotated, NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Overwrite


class State(TypedDict):
    notes: Annotated[list[str], operator.add]
    cost: NotRequired[Annotated[float, operator.add]]
    label: NotRequired[Annotated[str, operator.add]]


def run(node, init: State) -> None:
    b = StateGraph(State)
    b.add_node("n", node)
    b.add_edge(START, "n")
    b.add_edge("n", END)
    try:
        print(f"  {node.__name__:<12}", b.compile().invoke(init))
    except Exception as e:
        print(f"  {node.__name__:<12} {type(e).__name__}: {e}")


def peek(state: State) -> dict:
    print("  节点收到:", state)
    return {}


def add_str(state: State) -> dict:
    return {"label": "A"}


def add_none(state: State) -> dict:
    return {"notes": None}


def add_wrong_type(state: State) -> dict:
    return {"notes": "abc"}


def clear_with_empty(state: State) -> dict:
    return {"notes": []}


def clear_with_overwrite(state: State) -> dict:
    return {"notes": Overwrite([])}


print("1. 初始状态只给 notes,cost 和 label 没给:")
run(peek, {"notes": ["x"]})
print("2. 往 str 字段上 add:")
run(add_str, {"notes": []})
print("3. 往 list 字段 add 一个 None 或字符串:")
run(add_none, {"notes": ["x"]})
run(add_wrong_type, {"notes": ["x"]})
print("4. 想清空:")
run(clear_with_empty, {"notes": ["x", "y"]})
run(clear_with_overwrite, {"notes": ["x", "y"]})
```

<div class="line-notes">

- `from langgraph.types import Overwrite` 绕开 reducer 的专用类型,第 4 点用。
- `notes: Annotated[list[str], operator.add]` 列表,拼接。
- `cost: NotRequired[Annotated[float, operator.add]]` 浮点数相加,可以没有初始值。注意 `NotRequired` 包在最外面。
- `label: NotRequired[Annotated[str, operator.add]]` 字符串也能 `add`,效果是拼接字符串,这里故意拿来看边界。
- `def run(node, init: State) -> None:` 小帮手:把一个节点放进只有它的图,跑一次,打印结果或者报错。
- `print(f"  {node.__name__:<12}", b.compile().invoke(init))` 正常就打印节点名和最终状态。
- `print(f"  {node.__name__:<12} {type(e).__name__}: {e}")` 报错就打印异常类型和信息。
- `def peek(state: State) -> dict:` 一个只打印、不改任何东西的节点。
- `print("  节点收到:", state)` 看节点收到的状态长什么样。
- `def add_str(state: State) -> dict:` 往字符串字段 `label` 里「加」一个 `"A"`。
- `def add_none(state: State) -> dict:` 往列表字段 `notes` 里加 `None`。
- `def add_wrong_type(state: State) -> dict:` 往列表字段里加一个字符串 `"abc"`。
- `def clear_with_empty(state: State) -> dict:` 想清空,返回空列表。
- `def clear_with_overwrite(state: State) -> dict:` 想清空,返回 `Overwrite([])`。
- `run(peek, {"notes": ["x"]})` 初始状态只给 `notes`,`cost` 和 `label` 没给。
- `run(add_none, {"notes": ["x"]})` 往 `['x']` 里加 `None`。
- `run(clear_with_empty, {"notes": ["x", "y"]})` 用空列表去清空 `['x', 'y']`。

</div>

```bash
uv run python -m part05.lg.s05_defaults
```

```text
1. 初始状态只给 notes,cost 和 label 没给:
  节点收到: {'notes': ['x'], 'cost': 0.0, 'label': ''}
  peek         {'notes': ['x'], 'cost': 0.0, 'label': ''}
2. 往 str 字段上 add:
  add_str      {'notes': [], 'cost': 0.0, 'label': 'A'}
3. 往 list 字段 add 一个 None 或字符串:
  add_none     TypeError: can only concatenate list (not "NoneType") to list
  add_wrong_type TypeError: can only concatenate list (not "str") to list
4. 想清空:
  clear_with_empty {'notes': ['x', 'y'], 'cost': 0.0, 'label': ''}
  clear_with_overwrite {'notes': [], 'cost': 0.0, 'label': ''}
```

四个现象。

**从「空值」起步。**第 1 点,我没给 `cost` 和 `label`,节点收到的是 `'cost': 0.0, 'label': ''`:`float` 的空值是 `0.0`,`str` 是 `''`,列表是 `[]`。所以配了 `operator.add` 的字段,**不给初始值也能累积**,节点里读 `state["cost"]` 也不会 `KeyError`。这和 Day 302 里 TypedDict 的 `NotRequired` 字段「没写就缺键」不一样:有 reducer 的字段,框架一开始就替你放好了空值。

**类型对不上,是普通的 Python 报错。**第 3 点,往列表里加 `None` 或者字符串,报的是 `TypeError: can only concatenate list (not "NoneType") to list`。`operator.add` 就是 `+`,列表加不了别的东西,没有额外的保护。往 `label` 里「加」`"A"` 倒是成功了,结果 `'A'`,字符串 `+` 是拼接。

**想清空,返回空列表没用。**第 4 点:返回 `{"notes": []}`,`notes` 还是 `['x', 'y']`。因为合并是 `['x', 'y'] + []`,结果当然没变。官方文档对此的说法是「一个合并型 reducer 没法清空字段,因为空的更新也会被合并进去」。要清空得用 `Overwrite([])`:它告诉框架这一次别走 reducer,直接把值换成我给的。实测 `notes` 变成了 `[]`。

**`Overwrite` 要克制。**它是个逃生口,用多了就回到手动管理。常见的正当用途:一轮对话结束后重置累积的记录,练习 4 会写。

## 第 3 步:自己写 reducer

`operator.add` 对列表只会拼接。想要「拼接并且去重」「取最大值」这类规则,自己写函数。reducer 的格式固定:两个参数(旧值、新值),返回合并后的值。

```python
# agent-zero-lab/part05/lg/s05_custom.py
"""自己写 reducer:两个参数 (旧值, 新值),返回合并后的值。用法:uv run python -m part05.lg.s05_custom"""
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph

calls: list[tuple] = []


def merge_unique(old: list[str], new: list[str]) -> list[str]:
    calls.append((list(old), list(new)))
    return old + [x for x in new if x not in old]


def take_max(old: int, new: int) -> int:
    return max(old, new)


class State(TypedDict):
    tags: Annotated[list[str], merge_unique]
    worst: Annotated[int, take_max]


def first(state: State) -> dict:
    return {"tags": ["billing", "vip"], "worst": 3}


def second(state: State) -> dict:
    return {"tags": ["vip", "urgent"], "worst": 1}


builder = StateGraph(State)
builder.add_sequence([first, second])
builder.add_edge(START, "first")
builder.add_edge("second", END)
graph = builder.compile()

if __name__ == "__main__":
    print(graph.invoke({"tags": ["billing"], "worst": 0}))
    print("merge_unique 被调用的每一次 (old, new):")
    for old, new in calls:
        print("  ", old, new)

    print("--- 直接把内置 max 当 reducer ---")
    try:
        class Bad(TypedDict):
            worst: Annotated[int, max]

        StateGraph(Bad)
    except Exception as e:
        print(f"{type(e).__name__}: {e}")
```

<div class="line-notes">

- `calls: list[tuple] = []` 一个记录本,记下 `merge_unique` 每次被调用时收到的参数,方便观察框架到底怎么调它。
- `def merge_unique(old: list[str], new: list[str]) -> list[str]:` 两个参数,旧列表和新列表,返回合并后的列表。
- `calls.append((list(old), list(new)))` 把收到的两个列表**复制一份**记下来(用 `list(...)` 复制,否则记下的是会被后面改动的同一个对象)。
- `return old + [x for x in new if x not in old]` 旧列表加上「新的里面旧的没有的」。`old + [...]` 是造新列表,没有改 `old`:reducer 不要改收到的参数。
- `def take_max(old: int, new: int) -> int:` 第二个 reducer:取两个数里大的。
- `return max(old, new)` 内置的 `max` 包在自己的函数里。
- `tags: Annotated[list[str], merge_unique]` 备注位置换成自己的函数。
- `worst: Annotated[int, take_max]` 数字字段配取最大。
- `return {"tags": ["billing", "vip"], "worst": 3}` 第一个节点。
- `return {"tags": ["vip", "urgent"], "worst": 1}` 第二个节点,其中 `vip` 重复了,`worst` 比前面小。
- `print(graph.invoke({"tags": ["billing"], "worst": 0}))` 初始状态也有 `tags` 和 `worst`。
- `for old, new in calls:` 打印每一次调用收到的 `(old, new)`。
- `class Bad(TypedDict):` 在 `try` 里临时定义一个坏状态。
- `worst: Annotated[int, max]` 直接把内置 `max` 当 reducer。
- `StateGraph(Bad)` 建图的时候(不用跑)就会读状态,报错就在这里出现。

</div>

```bash
uv run python -m part05.lg.s05_custom
```

```text
{'tags': ['billing', 'vip', 'urgent'], 'worst': 3}
merge_unique 被调用的每一次 (old, new):
   [] ['billing']
   ['billing'] ['billing', 'vip']
   ['billing', 'vip'] ['vip', 'urgent']
--- 直接把内置 max 当 reducer ---
ValueError: no signature found for builtin <built-in function max>
```

最终 `tags` 是 `['billing', 'vip', 'urgent']`:`vip` 只出现一次,去重生效;`worst` 是 3,取了最大。重点看 `merge_unique` 被调用的记录,有三次:

- 第一次 `old=[]、new=['billing']`:这是**初始输入**。调用者传进来的 `tags: ['billing']` 也要走一遍 reducer,而此时 `old` 是空值 `[]`(第 2 步说的「从空值起步」)。所以 reducer 要能接受空的 `old`,而且**初始输入也会被它处理**,不是直接原样放进去。
- 第二次 `old=['billing']、new=['billing', 'vip']`:第一个节点的更新。
- 第三次 `old=['billing', 'vip']、new=['vip', 'urgent']`:第二个节点的更新,`vip` 在旧的里已经有了,被滤掉。

最后一个实验,直接把内置的 `max` 当 reducer,建图就报错:`ValueError: no signature found for builtin <built-in function max>`。LangGraph 要检查 reducer 的参数个数,而内置的 `max` 是用 C 写的,看不到参数签名,所以读不出来。包一层自己的 `def take_max(old, new): return max(old, new)` 就好了。这是我第一次想「取最大值」时直接写了 `Annotated[int, max]` 撞到的,错误信息一点没提 reducer,容易懵。

## 第 4 步:add_messages,专门给消息列表用的 reducer

消息列表是最常配 reducer 的字段,所以 LangGraph 提供了现成的 `add_messages`。它和 `operator.add` 比,多做了几件事:

- 每条消息有 `id`,**`id` 相同的消息替换,不是追加**。
- 没写 `id` 的消息,会自动补一个。
- 传进来的字典、元组、纯字符串,会自动转成消息对象。
- 有一种特殊的消息 `RemoveMessage(id=...)`,表示「把这个 id 的消息删掉」。

```python
# agent-zero-lab/part05/lg/s05_messages.py
"""add_messages:追加、按 id 替换、自动补 id、字典也认、RemoveMessage 删除、MessagesState。
用法:uv run python -m part05.lg.s05_messages"""
from typing import Annotated, TypedDict

from langchain_core.messages import AIMessage, AnyMessage, HumanMessage, RemoveMessage
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.graph.message import add_messages


class State(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]


def draft_v1(state: State) -> dict:
    return {"messages": [AIMessage("草稿 v1", id="draft")]}


def draft_v2(state: State) -> dict:
    return {"messages": [AIMessage("草稿 v2", id="draft")]}  # 同 id,替换


def drop_question(state: State) -> dict:
    return {"messages": [RemoveMessage(id="q1")]}


def run(schema, nodes: list, init: dict) -> list:
    b = StateGraph(schema)
    b.add_sequence(nodes)
    b.add_edge(START, nodes[0].__name__)
    b.add_edge(nodes[-1].__name__, END)
    return b.compile().invoke(init)["messages"]


def show(messages: list) -> None:
    for m in messages:
        shown = m.id if m.id and len(m.id) != 36 else "(自动生成)"  # 自动生成的是 36 位 uuid,每次不一样
        print(f"  {type(m).__name__:<13} id={shown:<10} {m.content}")


print("1. 追加,同 id 替换,没写 id 的会被补一个:")
show(run(State, [draft_v1, draft_v2], {"messages": [HumanMessage("发票开错了")]}))

print("2. 字典、元组、纯字符串都会被转成消息对象:")
show(run(State, [draft_v1], {"messages": [{"role": "user", "content": "你好"}, ("assistant", "您好"), "纯字符串"]}))

print("3. RemoveMessage 按 id 删除:")
show(run(State, [drop_question], {"messages": [HumanMessage("旧问题", id="q1"), HumanMessage("新问题", id="q2")]}))

print("4. 删一个不存在的 id:")
try:
    run(State, [drop_question], {"messages": [HumanMessage("只有 q2", id="q2")]})
except Exception as e:
    print(f"  {type(e).__name__}: {e}")

print("5. MessagesState:同样的字段已经配好了")
show(run(MessagesState, [draft_v1], {"messages": "你好"}))
```

<div class="line-notes">

- `from langchain_core.messages import AIMessage, AnyMessage, HumanMessage, RemoveMessage` 四个来自 `langchain-core` 的类:`HumanMessage` 是用户说的,`AIMessage` 是模型说的,`AnyMessage` 是「任意一种消息」的类型标注,`RemoveMessage` 是删除指令。
- `from langgraph.graph import END, START, MessagesState, StateGraph` 多了一个 `MessagesState`,第 5 点用。
- `from langgraph.graph.message import add_messages` 今天的主角。
- `messages: Annotated[list[AnyMessage], add_messages]` 类型是消息列表,合并规则是 `add_messages`。
- `return {"messages": [AIMessage("草稿 v1", id="draft")]}` 写一条 `id` 是 `draft` 的消息。
- `return {"messages": [AIMessage("草稿 v2", id="draft")]}  # 同 id,替换` 同样的 `id`,内容不同。
- `return {"messages": [RemoveMessage(id="q1")]}` 要删掉 `id` 是 `q1` 的消息。
- `def run(schema, nodes: list, init: dict) -> list:` 小帮手:建图、跑,返回最终的 `messages`。
- `return b.compile().invoke(init)["messages"]` 直接取出 `messages` 字段。
- `shown = m.id if m.id and len(m.id) != 36 else "(自动生成)"` 自动补的 `id` 是 36 位的随机字符串(uuid),每次跑都不一样,所以把它显示成「(自动生成)」,自己写的短 id 原样显示。
- `show(run(State, [draft_v1, draft_v2], {"messages": [HumanMessage("发票开错了")]}))` 第 1 点:初始一条没写 id 的用户消息,两个节点写同 id 的草稿。
- `{"messages": [{"role": "user", "content": "你好"}, ("assistant", "您好"), "纯字符串"]}` 第 2 点:三种不是消息对象的写法:字典、元组、字符串。
- `show(run(State, [drop_question], {"messages": [HumanMessage("旧问题", id="q1"), HumanMessage("新问题", id="q2")]}))` 第 3 点:初始两条,一个节点删 `q1`。
- `run(State, [drop_question], {"messages": [HumanMessage("只有 q2"` 第 4 点:要删的 `q1` 根本不存在。
- `except Exception as e:` 接住并打印。
- `show(run(MessagesState, [draft_v1], {"messages": "你好"}))` 第 5 点:不自己写状态类,直接用 `MessagesState`,初始消息也可以直接传一个字符串。

</div>

```bash
uv run python -m part05.lg.s05_messages
```

```text
1. 追加,同 id 替换,没写 id 的会被补一个:
  HumanMessage  id=(自动生成)     发票开错了
  AIMessage     id=draft      草稿 v2
2. 字典、元组、纯字符串都会被转成消息对象:
  HumanMessage  id=(自动生成)     你好
  AIMessage     id=(自动生成)     您好
  HumanMessage  id=(自动生成)     纯字符串
  AIMessage     id=draft      草稿 v1
3. RemoveMessage 按 id 删除:
  HumanMessage  id=q2         新问题
4. 删一个不存在的 id:
  ValueError: Attempting to delete a message with an ID that doesn't exist ('q1')
5. MessagesState:同样的字段已经配好了
  HumanMessage  id=(自动生成)     你好
  AIMessage     id=draft      草稿 v1
```

逐点看:

**1. 追加加替换。**初始那条没写 id 的用户消息被补了 id(显示为「自动生成」)。`draft_v1` 追加了一条 id 为 `draft` 的草稿,`draft_v2` 来的时候发现已经有 id 是 `draft` 的了,**替换**成 v2。最终只有两条:用户消息和 `草稿 v2`。要是用 `operator.add`,会是三条,v1 和 v2 都在。

**2. 字典、元组、字符串都认。**`{"role": "user", "content": "你好"}` 变成 `HumanMessage`,`("assistant", "您好")` 变成 `AIMessage`,纯字符串当成用户消息。所以调用 `invoke` 时可以直接传最简单的写法,不必先包成消息类。注意输出里最后一条还是 `草稿 v1`,是图里的节点追加的。

**3. 按 id 删除。**`RemoveMessage(id="q1")` 把 `q1` 那条删掉,只剩 `q2`。这是裁剪对话历史的标准办法,练习 3 会写。

**4. 删不存在的 id 会报错。**`ValueError: Attempting to delete a message with an ID that doesn't exist ('q1')`。所以删之前,id 最好从当前状态里取,别凭印象写。

**5. `MessagesState`。**它就是一个现成的状态类,只有一个字段 `messages`,已经配好了 `add_messages`。直接用最省事,要加别的字段就继承它再加。

## 第 5 步:一行修好昨天的事故

昨天的 `s04_messages.py` 里,假模型每轮返回只含自己那条回复的列表,把整个 `messages` 换掉了。现在改两处:`messages` 的类型换成 `Annotated[list[AnyMessage], add_messages]`,节点返回的字典几乎不用改,依旧只返回新回复。

```python
# agent-zero-lab/part05/lg/s05_fix_messages.py
"""Day 303 的事故现场,只改一行:messages 配上 add_messages,节点只返回新回复。
用法:uv run python -m part05.lg.s05_fix_messages"""
from typing import Annotated, TypedDict

from langchain_core.messages import AIMessage, AnyMessage, HumanMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages


class State(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]


def fake_model(state: State) -> dict:
    seen = [m.content for m in state["messages"]]
    print(f"  模型这一轮看到 {len(seen)} 条:", seen)
    return {"messages": [AIMessage(f"(看到了 {len(seen)} 条)")]}  # 只返回新回复


builder = StateGraph(State)
builder.add_node("model", fake_model)
builder.add_edge(START, "model")
builder.add_edge("model", END)
graph = builder.compile()

history: list[AnyMessage] = [HumanMessage("发票开错了")]
for turn, question in enumerate(["能重开吗?", "多久到账?"], start=1):
    out = graph.invoke({"messages": history})
    print(f"第 {turn} 轮之后,状态里有 {len(out['messages'])} 条")
    history = [*out["messages"], HumanMessage(question)]
```

<div class="line-notes">

- `messages: Annotated[list[AnyMessage], add_messages]` 唯一的结构改动:合并规则。
- `seen = [m.content for m in state["messages"]]` 现在 `messages` 里是消息对象,文字用 `.content` 取。
- `return {"messages": [AIMessage(f"(看到了 {len(seen)} 条)")]}  # 只返回新回复` 和昨天事故版一样,只返回新回复,**不用**再带旧消息。
- `history: list[AnyMessage] = [HumanMessage("发票开错了")]` 起始历史。
- `out = graph.invoke({"messages": history})` 把历史交给图。
- `history = [*out["messages"], HumanMessage(question)]` 调用者的拼接和昨天一样。

</div>

```bash
uv run python -m part05.lg.s05_fix_messages
```

```text
  模型这一轮看到 1 条: ['发票开错了']
第 1 轮之后,状态里有 2 条
  模型这一轮看到 3 条: ['发票开错了', '(看到了 1 条)', '能重开吗?']
第 2 轮之后,状态里有 4 条
```

第 1 轮模型看到 1 条,跑完状态里有 **2 条**(用户消息加回复,昨天只剩 1 条)。第 2 轮模型看到 3 条:`['发票开错了', '(看到了 1 条)', '能重开吗?']`,最开始的问题还在。昨天的事故版第 2 轮只看到 2 条且缺了第一个问题。节点里没有一个 `*state["messages"]`,合并交给了 `add_messages`。

## 第 6 步:41 张真工单,reducer 都用上

回到昨天的 41 张工单,两个查证节点各返回一条记录。这次状态里配三个 reducer:`notes` 用 `operator.add`;`tags` 用去重的 `merge_unique`(两个节点都会打上 `has_customer` 标签,看去重);`seconds` 用 `operator.add` 累加每个节点的耗时。节点只报「自己这一步」,不再有任何读旧值的代码。

```python
# agent-zero-lab/part05/lg/s05_tickets.py
"""41 张真工单:两个查证节点用 reducer 累积 notes、累加耗时、去重打标签。
用法:uv run python -m part05.lg.s05_tickets"""
import operator
import time
from collections import Counter
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph

from part05.lg.s01_tickets import load_tickets
from part05.lg.s04_tickets import customer_note, invoice_note


def merge_unique(old: list[str], new: list[str]) -> list[str]:
    return old + [x for x in new if x not in old]


class State(TypedDict):
    ticket_id: str
    notes: Annotated[list[str], operator.add]
    tags: Annotated[list[str], merge_unique]
    seconds: Annotated[float, operator.add]


def look_customer(state: State) -> dict:
    start = time.perf_counter()
    note = customer_note(state["ticket_id"])
    return {"notes": [note], "tags": ["has_customer"], "seconds": time.perf_counter() - start}


def look_invoices(state: State) -> dict:
    start = time.perf_counter()
    note = invoice_note(state["ticket_id"])
    tags = ["has_customer"] + ([] if note == "未付发票:0 张" else ["has_open_invoice"])
    return {"notes": [note], "tags": tags, "seconds": time.perf_counter() - start}


builder = StateGraph(State)
builder.add_sequence([look_customer, look_invoices])
builder.add_edge(START, "look_customer")
builder.add_edge("look_invoices", END)
graph = builder.compile()

if __name__ == "__main__":
    ids = [ticket_id for ticket_id, _ in load_tickets()]
    results = [graph.invoke({"ticket_id": i, "notes": [], "tags": [], "seconds": 0.0}) for i in ids]
    print("notes 条数分布:", dict(Counter(len(r["notes"]) for r in results)))
    print("tags 的组合:", dict(Counter(tuple(r["tags"]) for r in results)))
    print(f"41 张查库总耗时 {sum(r['seconds'] for r in results) * 1000:.0f} 毫秒")
    print("T1001:", {k: v for k, v in results[0].items() if k != "seconds"})
```

<div class="line-notes">

- `from part05.lg.s04_tickets import customer_note, invoice_note` 昨天建的两个查库函数,直接复用:`customer_note(工单号)` 返回 `客户:公司名`,`invoice_note(工单号)` 返回 `未付发票:N 张`。
- `def merge_unique(old: list[str], new: list[str]) -> list[str]:` 和第 3 步同一个写法,这里重写一遍让文件自己能跑。
- `notes: Annotated[list[str], operator.add]` 记录:拼接。
- `tags: Annotated[list[str], merge_unique]` 标签:拼接并去重。
- `seconds: Annotated[float, operator.add]` 耗时:累加。
- `start = time.perf_counter()` 节点开始时计时。
- `note = customer_note(state["ticket_id"])` 查库。
- `return {"notes": [note], "tags": ["has_customer"], "seconds": time.perf_counter() - start}` 节点只返回三样「这一步的」:一条记录、一个标签、这一步花的秒数。
- `tags = ["has_customer"] + ([] if note == "未付发票:0 张" else ["has_open_invoice"])` 发票节点也打 `has_customer`(故意重复,看去重);未付发票不是 0 张才多打一个 `has_open_invoice`。
- `results = [graph.invoke({"ticket_id": i, "notes": [], "tags": [], "seconds": 0.0}) for i in ids]` 初始值给空,41 次调用。
- `print("notes 条数分布:", dict(Counter(len(r["notes"]) for r in results)))` 期望 `{2: 41}`。
- `print("tags 的组合:", dict(Counter(tuple(r["tags"]) for r in results)))` 列表不能当字典的键,先转成元组再数。
- `print(f"41 张查库总耗时 {sum(r['seconds'] for r in results) * 1000:.0f} 毫秒")` 41 张的 `seconds` 加起来,乘 1000 变毫秒。
- `print("T1001:", {k: v for k, v in results[0].items() if k != "seconds"})` 看第一张,把每次不一样的耗时去掉。

</div>

```bash
uv run python -m part05.lg.s05_tickets
```

```text
notes 条数分布: {2: 41}
tags 的组合: {('has_customer',): 33, ('has_customer', 'has_open_invoice'): 8}
41 张查库总耗时 24 毫秒
T1001: {'ticket_id': 'T1001', 'notes': ['客户:白塔印务', '未付发票:0 张'], 'tags': ['has_customer']}
```

`notes` 41 张全是 2 条(昨天覆盖版是 1 条)。`tags` 里 `has_customer` 只出现一次(去重生效),另外 8 张工单的客户有未付发票,多了 `has_open_invoice`。总耗时每次跑都不同,这次 35 毫秒(开头 41 张里每张两次查库,主要是打开关闭数据库连接的开销)。注意节点里**没有任何一处读旧值**,每个节点只返回自己这一步的数据,这是 reducer 的价值:节点之间互不知道对方,加一个节点不用改别的节点。

## 零件 → 大代码对照表

| 零件 | 在哪个脚本 | 说明 |
| --- | --- | --- |
| `Annotated[list[str], operator.add]` | `s05_add.py` | 节点只返回新增;没配的 `steps` 仍是覆盖 |
| 空值起步、类型报错、`Overwrite` 清空 | `s05_defaults.py` | 返回 `[]` 清不掉,`Overwrite([])` 才行 |
| 自己写的 reducer、内置 `max` 报错 | `s05_custom.py` | `(old, new)` 两个参数;初始输入也走一遍 |
| `add_messages` 的几种行为 | `s05_messages.py` | 同 id 替换、自动补 id、字典转消息、`RemoveMessage` |
| 修好 messages 事故 | `s05_fix_messages.py` | 模型看到 1 条、3 条 |
| 41 张真工单 | `s05_tickets.py` | 三种 reducer 同时用 |

## 动手练习

四道题,都在 `part05/lg/` 下新建文件。每题后面是参考答案,先自己做。

### 练习 1:数步数

三个节点各返回 `{"steps": 1}`,`steps` 配 `operator.add`。初始 `steps` 分别是 0 和 10 时,最终各是多少?先预测再跑。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex304_step_counter.py
"""练习 1:用 operator.add 数「一共走了几步」,每个节点只返回 1。
用法:uv run python -m part05.lg.ex304_step_counter"""
import operator
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    steps: Annotated[int, operator.add]


def a(state: State) -> dict:
    return {"steps": 1}


def b(state: State) -> dict:
    return {"steps": 1}


def c(state: State) -> dict:
    return {"steps": 1}


builder = StateGraph(State)
builder.add_sequence([a, b, c])
builder.add_edge(START, "a")
builder.add_edge("c", END)
graph = builder.compile()

print("初始 steps=0:", graph.invoke({"steps": 0}))
print("初始 steps=10:", graph.invoke({"steps": 10}))
```

<div class="line-notes">

- `steps: Annotated[int, operator.add]` 整数配加法。
- `return {"steps": 1}` 三个节点都只报「我走了 1 步」。
- `builder.add_sequence([a, b, c])` 依次跑。
- `print("初始 steps=0:", graph.invoke({"steps": 0}))` 初始 0,加三个 1。
- `print("初始 steps=10:", graph.invoke({"steps": 10}))` 初始 10,同样加三个 1。

</div>

```text
初始 steps=0: {'steps': 3}
初始 steps=10: {'steps': 13}
```

初始 0 得 3,初始 10 得 13:初始值也参与加法,3 是每个节点各加 1。节点里没有 `state["steps"] + 1` 这种读旧值的写法了,对比第 1 步里没配 reducer 的 `steps`。

</details>

### 练习 2:只升不降的优先级

写一个 reducer `higher(old, new)`,让 `priority` 只能从低往高变(`low < normal < high`)。一个节点写 `high`,下一个写 `low`,最终应该是 `high`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex304_priority.py
"""练习 2:自己写一个 reducer,让 priority 只升不降(low < normal < high)。
用法:uv run python -m part05.lg.ex304_priority"""
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph

RANK = {"low": 0, "normal": 1, "high": 2}


def higher(old: str, new: str) -> str:
    return new if RANK[new] > RANK.get(old, -1) else old


class State(TypedDict):
    priority: Annotated[str, higher]


def mark_vip(state: State) -> dict:
    return {"priority": "high"}


def mark_routine(state: State) -> dict:
    return {"priority": "low"}


builder = StateGraph(State)
builder.add_sequence([mark_vip, mark_routine])
builder.add_edge(START, "mark_vip")
builder.add_edge("mark_routine", END)
graph = builder.compile()

print(graph.invoke({"priority": "normal"}))
```

<div class="line-notes">

- `RANK = {"low": 0, "normal": 1, "high": 2}` 给三个级别排个序号。
- `def higher(old: str, new: str) -> str:` reducer:两个参数,旧级别和新级别。
- `return new if RANK[new] > RANK.get(old, -1) else old` 新的序号更大就用新的,否则保留旧的。`RANK.get(old, -1)` 是因为框架第一次调用时 `old` 是字符串的空值 `''`(第 2 步),不在表里,给它 `-1` 保证任何真实级别都比它高。
- `priority: Annotated[str, higher]` 字符串字段配自己的 reducer。
- `return {"priority": "high"}` 第一个节点升到 high。
- `return {"priority": "low"}` 第二个节点想降到 low。
- `print(graph.invoke({"priority": "normal"}))` 初始 `normal`。

</div>

```text
{'priority': 'high'}
```

最终 `high`:初始 `normal` 先和空值合并成 `normal`;`mark_vip` 的 `high` 序号 2 大于 1,升级;`mark_routine` 的 `low` 序号 0 小于 2,被拒绝,保留 `high`。「某个状态只能前进不能后退」这类规则,放在 reducer 里比每个节点各自判断可靠。

</details>

### 练习 3:裁剪消息到最后两条

初始 5 条消息,写一个 `trim` 节点,用 `RemoveMessage` 删掉除最后两条之外的所有消息。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex304_trim.py
"""练习 3:用 RemoveMessage 把消息裁到只剩最后两条。
用法:uv run python -m part05.lg.ex304_trim"""
from langchain_core.messages import HumanMessage, RemoveMessage
from langgraph.graph import END, START, MessagesState, StateGraph


def trim(state: MessagesState) -> dict:
    old = state["messages"][:-2]
    return {"messages": [RemoveMessage(id=m.id) for m in old if m.id]}


builder = StateGraph(MessagesState)
builder.add_node("trim", trim)
builder.add_edge(START, "trim")
builder.add_edge("trim", END)
graph = builder.compile()

init: MessagesState = {"messages": [HumanMessage(f"第 {i} 条", id=f"m{i}") for i in range(1, 6)]}
out = graph.invoke(init)
print([m.content for m in out["messages"]])
```

<div class="line-notes">

- `from langgraph.graph import END, START, MessagesState, StateGraph` 直接用现成的 `MessagesState`。
- `old = state["messages"][:-2]` 切片取「除了最后两条」,`[:-2]` 是从头到倒数第二条之前([Day 21](/blog/agent-zero/day-021-lists/) 的切片)。代入 5 条,取前 3 条。
- `return {"messages": [RemoveMessage(id=m.id) for m in old if m.id]}` 对每一条旧消息生成一个删除指令。`if m.id` 是因为 `id` 的类型是「可能为 `None`」,没有 id 的删不了。
- `init: MessagesState = {"messages": [HumanMessage(f"第 {i} 条", id=f"m{i}") for i in range(1, 6)]}` 造 5 条,id 是 `m1` 到 `m5`。
- `out = graph.invoke(init)` 跑。
- `print([m.content for m in out["messages"]])` 看剩下哪些。

</div>

```text
['第 4 条', '第 5 条']
```

剩下第 4、5 条。真实的 Agent 里,对话越来越长,超过上下文窗口之前用这种办法裁掉旧消息。注意要成对删(工具调用和它的结果不能拆开),这个坑留到上下文管理那一章再讲。

</details>

### 练习 4:一轮结束后清空记录

`first` 写一条记录,`reset` 把记录清空,`second` 再写一条。最终应该只剩第二轮的。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex304_reset.py
"""练习 4:加一个 reset 节点,把累积的 notes 清空重来。
用法:uv run python -m part05.lg.ex304_reset"""
import operator
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Overwrite


class State(TypedDict):
    notes: Annotated[list[str], operator.add]


def first(state: State) -> dict:
    return {"notes": ["第一轮的发现"]}


def reset(state: State) -> dict:
    return {"notes": Overwrite([])}


def second(state: State) -> dict:
    return {"notes": ["第二轮的发现"]}


builder = StateGraph(State)
builder.add_sequence([first, reset, second])
builder.add_edge(START, "first")
builder.add_edge("second", END)
graph = builder.compile()

for chunk in graph.stream({"notes": []}, stream_mode="updates"):
    print(chunk)
print("最终:", graph.invoke({"notes": []}))
```

<div class="line-notes">

- `from langgraph.types import Overwrite` 绕开 reducer 的类型。
- `return {"notes": ["第一轮的发现"]}` 正常追加。
- `return {"notes": Overwrite([])}` 用 `Overwrite` 把 `notes` 直接换成空列表,不走 `operator.add`。
- `return {"notes": ["第二轮的发现"]}` 清空之后再追加。
- `for chunk in graph.stream({"notes": []}, stream_mode="updates"):` 看每个节点写了什么。
- `print("最终:", graph.invoke({"notes": []}))` 最后的结果。

</div>

```text
{'first': {'notes': ['第一轮的发现']}}
{'reset': {'notes': Overwrite(value=[], type='__overwrite__')}}
{'second': {'notes': ['第二轮的发现']}}
最终: {'notes': ['第二轮的发现']}
```

`updates` 里 `reset` 写的是 `Overwrite(value=[], type='__overwrite__')`,是个特殊对象,不是普通空列表;最终 `notes` 只有第二轮的。如果 `reset` 返回的是普通 `[]`,`notes` 会保留第一轮的内容(第 2 步实测)。

</details>

**验收标准:** 四个练习的脚本都能跑通,输出和参考答案一致;不看文章能默写出 `Annotated[list[str], operator.add]` 的状态定义和 `merge_unique`;能口头回答「为什么配了 reducer 的字段不用给初始值」「为什么返回空列表清不掉」「为什么不能直接传内置 `max`」「`add_messages` 比 `operator.add` 多做了什么」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| reducer | 规定「状态里的旧值和节点返回的新值怎么合并」的函数,签名 `(旧值, 新值) -> 合并后的值`。≈ JS `reduce` 的回调、React `useReducer` 里的 reducer |
| `Annotated[类型, 备注]` | 在类型后面挂一份备注。LangGraph 读到备注是函数,就把它当这个字段的 reducer([Day 298](/blog/agent-zero/day-298-langchain-vs-langgraph/) 用它给工具参数写说明) |
| `operator.add` | 标准库里 `+` 的函数版本。列表相加是拼接,数字是求和,字符串是连接 |
| 空值起步 | 配了 reducer 的字段,框架一开始放的类型的空值:列表 `[]`、`float` `0.0`、`str` `''` |
| `Overwrite` | `langgraph.types` 里的类型,返回 `Overwrite(值)` 表示这一次绕开 reducer,直接把字段换成这个值 |
| `add_messages` | 专门合并消息列表的 reducer:追加、同 id 替换、字典转消息、识别 `RemoveMessage` |
| `MessagesState` | LangGraph 自带的状态类,只有 `messages` 一个字段,已配好 `add_messages` |
| `HumanMessage` / `AIMessage` | `langchain-core` 里的消息类,分别表示用户说的和模型说的,有 `content`(文字)和 `id` |
| `AnyMessage` | 「任意一种消息」的类型标注,给编辑器看 |
| `RemoveMessage` | 一种特殊消息,放进更新里表示「删掉这个 id 的消息」 |
| uuid | 一种随机生成、几乎不会重复的 36 位字符串,自动生成的消息 id 就是它 |

## 常见误区

**配了 `operator.add` 还在节点里带旧值。**`return {"notes": [*state["notes"], "新的"]}` 会让旧值被加两遍:框架已经替你拼了。配了 reducer 就只返回「这一步新增的」。这是从昨天的手动写法转过来时最容易犯的错。

**以为返回空列表能清空。**`[]` 加上去什么也没变。清空要用 `Overwrite([])`。

**直接把内置函数(比如 `max`)当 reducer。**报 `ValueError: no signature found for builtin <built-in function max>`,信息里完全没提 reducer。包一层自己写的函数。

**reducer 里改了收到的参数。**`old.append(...)` 然后 `return old` 会和昨天的原地修改一样污染调用者的数据。要 `return old + [...]` 造新的。

**不知道初始输入也会走 reducer。**调用者传的 `tags: ['billing']` 先和空值合并才进状态,所以自己写的 reducer 要能处理空的 `old`,上面练习 2 的 `RANK.get(old, -1)` 就是为了这个。

**用 `operator.add` 合并消息列表,然后发现同一条消息重复了。**`operator.add` 只会拼接,不会按 id 去重。消息列表用 `add_messages`。

**删消息时 id 写错。**`RemoveMessage` 指向不存在的 id 会抛 `ValueError`。id 从当前状态里取。

**没写 id 就想以后按 id 替换。**自动生成的 id 每次不一样,拿不到就没法替换。要替换的消息,创建时自己给 id(`id="draft"`)。

**`AnyMessage` 和具体消息类混为一谈。**`AnyMessage` 只是类型标注,创建消息要用 `HumanMessage`、`AIMessage`。

**所有字段都配 reducer。**该覆盖的(最新的草稿、当前类别)就别配。昨天练习 2 讲过:每个字段想要「当前值」还是「累积历史」是设计决定。

## 学习资料

### 文档与文章

- [LangGraph 文档 · Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api):Reducers、`Overwrite`、`add_messages`、`MessagesState` 都在这一页。今天所有的行为都能在这里找到官方说法,读 Reducers 和 Working with messages 两节,20 分钟。
- [LangGraph 文档 · Use the graph API](https://docs.langchain.com/oss/python/langgraph/use-graph-api):「Process state updates with reducers」和消息相关的完整示例。
- [LangGraph 文档 · INVALID_CHAT_HISTORY](https://docs.langchain.com/oss/python/langgraph/errors/INVALID_CHAT_HISTORY):消息列表出问题时的官方排查说明,明天以后做 Agent 循环时可能遇到。
- [Python 文档 · operator 模块](https://docs.python.org/3/library/operator.html):`operator.add` 是怎么回事,第一张表就能看到它对应 `a + b`。
- [Python 文档 · functools.reduce](https://docs.python.org/3/library/functools.html#functools.reduce):Python 自己的 `reduce`,和今天的 reducer 是同一个思想,对照 JS 的 `Array.prototype.reduce`。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1z3NY66EY1&autoplay=0&high_quality=1" title="尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>尚硅谷 · 尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战 · 全套约 21 小时(2026 年 10 月查)。我没有逐集看。按旧课笔记里的对应关系,reducer 在第 16–18 集,预定义状态和 MessagesState 在第 26–27 集,这个对应来自我之前的整理,没有重新核对,按标题找「reducer」「MessagesState」几集即可。</figcaption>
</figure>

- 吴恩达&LangChain《用LangGraph搭建智能体》(BV1bi421v7oD,约 92 分钟,字幕搬运):录于 2024 年,API 有些旧,里面讲状态里 `operator.add` 累积消息的那一段和今天第 1 步是一个意思。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/aHCDrAbH_go" title="Building Effective Agents with LangGraph" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Building Effective Agents with LangGraph · 官方频道,英文,开字幕。我只核对了标题和频道,没有逐段看完。里面的代码用到了带 reducer 的状态,可以对照今天的写法看。</figcaption>
</figure>

### 书籍

- Mayo Oshin、Nuno Campos,《Learning LangChain: Building AI and LLM Applications with LangChain and LangGraph》,O'Reilly,2025。讲 LangGraph 状态和 reducer 的章节对应今天的内容,出版时 API 和现在有出入。我没有核实有无中文版。

### 开源项目与代码

- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):搜 `def add_messages`,看它怎么处理 id、`RemoveMessage`;搜 `_is_field_binop`,就是第 3 步里内置 `max` 报错的那个检查函数(我从报错堆栈里读到的函数名,没有细读实现)。

## 自测

1. `notes: Annotated[list[str], operator.add]`,旧值 `['来信', '查了客户']`,节点返回 `{"notes": ["查了发票"]}`,新值是什么?节点里需要读 `state["notes"]` 吗?

<details><summary>答案</summary>

新值是 `['来信', '查了客户', '查了发票']`(框架算 `旧 + 返回`)。不需要读旧值,节点只返回「这一步新增的」。

</details>

2. 配了 `operator.add` 的 `cost: float` 字段,初始状态里没给 `cost`,节点里读 `state["cost"]` 会怎样?

<details><summary>答案</summary>

读到 `0.0`,不报错。配了 reducer 的字段从类型的空值起步(`float` 是 `0.0`,`str` 是 `''`,列表是 `[]`)。这和 TypedDict 里没配 reducer 的 `NotRequired` 字段(没写就缺键)不一样。

</details>

3. 想把 `notes` 清空,节点返回 `{"notes": []}` 行吗?怎么办?

<details><summary>答案</summary>

不行,合并是 `旧 + []`,结果不变(实测 `['x', 'y']` 仍是 `['x', 'y']`)。要返回 `{"notes": Overwrite([])}`,它让这一次更新绕开 reducer,直接把值换成 `[]`。

</details>

4. `Annotated[int, max]` 为什么报错?怎么写才对?

<details><summary>答案</summary>

报 `ValueError: no signature found for builtin <built-in function max>`。LangGraph 要检查 reducer 的参数签名,内置 `max` 是 C 实现的,读不出签名。包一层:`def take_max(old: int, new: int) -> int: return max(old, new)`,再写 `Annotated[int, take_max]`。

</details>

5. `add_messages` 比 `operator.add` 多做了哪几件事?各举一个用途。

<details><summary>答案</summary>

一,同 id 的消息替换而不是追加(「人工修改 AI 草稿后放回去」「改写上一条回复」);二,没写 id 的消息自动补 id;三,字典、元组、字符串自动转成消息对象(调用 `invoke` 时可以直接传 `{"role": "user", "content": "..."}`);四,识别 `RemoveMessage(id=...)` 把指定 id 的消息删掉(裁剪过长的对话历史)。

</details>

6. 面试题:同一个 LangGraph 图里,三个并行的节点都要往 `messages` 里追加自己的结果。不配 reducer 会怎样?配了 `add_messages` 就万事大吉了吗?

<details><summary>答案</summary>

不配 reducer,同一步里多个节点写同一个键,框架抛 `InvalidUpdateError: Can receive only one value per step`。配上 `add_messages` 后三个节点的消息都会合并进去,不再报错。但不是万事大吉:一,同一步里并行的三个节点读到的都是「并行开始前」的状态,看不到彼此刚写的消息;二,三条消息在列表里的先后顺序,我今天没有实测,下游如果依赖顺序,要自己验证或者显式处理;三,工具调用和工具结果的配对(带 `tool_call_id` 的消息)要保持完整,拆开了会让下一次调模型报错(这一条我也没实测,是官方 INVALID_CHAT_HISTORY 文档的说法)。并行细节留到明天。

</details>

## 明天预告

Day 305 · LangGraph(六):并行节点和扇入。今天的 reducer 是为并行准备的:两个节点从同一个出发点分叉、各自写同一个字段,最后汇合到一个节点。明天先让并行真的跑起来,看 reducer 怎么把两个分支的结果拼到一起,再看去掉 reducer 以后,昨天预告里那个 `InvalidUpdateError` 在什么情况下出现。
