---
title: 'Day 303 · LangGraph(四):不加 reducer 会被覆盖'
description: '两个节点往同一个列表字段里各写一条,最后只剩一条,而且不报错。今天把这条覆盖规则踩实:没提到的键保持原值,返回空字典、None、拼错的键都不改状态,原地 append 会绕开框架还弄脏调用者的数据;再看手动把旧值拼上去的办法为什么能用、什么时候会失效,最后拿 messages 做一次「模型只记得最后一条」的事故演示。'
pubDate: 2026-10-27
regime: none
tags: ['langgraph', 'state-graph', 'reducer', 'overwrite', 'python', 'agent-zero']
series: 'agent-zero'
day: 303
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 302](/blog/agent-zero/day-302-lg-state-styles/) 把「分类、起草」那张图的状态分别写成 TypedDict、dataclass、pydantic:节点收到字典还是对象、没写过的字段是缺键还是默认值、传错类型在哪里炸,以及 `invoke` 返回的永远是字典。那三天的图里有个共同点,每个字段只有**一个**节点写:`category` 归 `classify`,`reply` 归 `draft`。

真实的流程不会这么整齐。想想你前端的 `useReducer`:多个动作都可能改同一个 `list`,「新值怎么跟旧值合并」得有个说法。LangGraph 里这个说法叫 reducer,从明天开始讲。今天先看**没有**这个说法时会发生什么:两个节点写同一个字段,后写的把先写的盖掉,而且不报错。这个坑是 LangGraph 新手最常踩的一个,弄清它,明天的 reducer 才知道在补什么。依旧不调模型,花费 ¥0。

## 今天要解决的问题

学完今天,你要能做到:

1. 说出 LangGraph 默认的合并规则(没配 reducer 的字段,谁最后写谁说了算),并能预测一张图跑完每个字段的最终值。
2. 说出节点没提到的键、返回 `{}`、返回 `None`、返回拼错的键名,各会怎样;说出返回列表为什么报错。
3. 用「读旧值、拼新值、整个写回」的手动办法累积一个列表,并说出两个陷阱:原地 `append` 不 `return`、两个节点同时跑。
4. 复现并解释「messages 没配 reducer,模型只看得到最新一条」。

预计用时 2 小时。今天不调模型,花费 ¥0。前置:[Day 302](/blog/agent-zero/day-302-lg-state-styles/)(TypedDict 状态)、[Day 301](/blog/agent-zero/day-301-lg-sequence/)(`add_sequence`、`stream`)、[Day 299](/blog/agent-zero/day-299-lg-one-node/)(`part05/lg/s01_tickets.py` 里的 `load_tickets`)、[Day 21](/blog/agent-zero/day-021-lists/)(列表,`b = a` 不是复制)、[Day 87](/blog/agent-zero/day-087-sql-3/)(`JOIN`)、[Day 88](/blog/agent-zero/day-088-sql-4/)(`COUNT`)、[Day 92](/blog/agent-zero/day-092-python-sqlite-1/)(用 Python 查 SQLite)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `s04_overwrite.py` 里的状态和两个节点,并说出最后 `notes` 剩什么;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

所有命令在 `agent-zero-lab/` 根目录跑(我的是 `/Users/你/agent-zero-lab`)。先重置业务库:

```bash
cd /Users/你/agent-zero-lab
uv run python cloudledger/seed.py
```

<div class="line-notes">

- `uv run python cloudledger/seed.py` 删库重建,输出 `已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}`。今天用工单表、客户表和发票表。我这次用的是 langgraph 1.2.18(2026 年 10 月 27 日装到的最新版,PyPI 上 10 月 26 日发布)。

</div>

## 先看现象:两个节点写同一个字段

场景:客户来了一张工单,先查客户资料、再查发票,每一步把「查到了什么」记一条到 `notes` 里。初始 `notes` 里已经有一条「用户来信」。如果两个节点都往里加,最后应该有三条。

```python
# agent-zero-lab/part05/lg/s04_overwrite.py
"""两个节点各往 notes 里写一条,最后剩几条?用法:uv run python -m part05.lg.s04_overwrite"""
from typing import TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    notes: list[str]
    steps: int


def look_customer(state: State) -> dict:
    return {"notes": ["查了客户"], "steps": state["steps"] + 1}


def look_invoices(state: State) -> dict:
    return {"notes": ["查了发票"]}  # 没提 steps


builder = StateGraph(State)
builder.add_sequence([look_customer, look_invoices])
builder.add_edge(START, "look_customer")
builder.add_edge("look_invoices", END)
graph = builder.compile()

if __name__ == "__main__":
    print(graph.invoke({"notes": ["用户来信"], "steps": 0}))
    print("--- 用 stream 看每一步之后状态里有什么 ---")
    for chunk in graph.stream({"notes": ["用户来信"], "steps": 0}, stream_mode="values"):
        print(chunk)
```

<div class="line-notes">

- `from typing import TypedDict` 今天状态都用 TypedDict,理由和 [Day 302](/blog/agent-zero/day-302-lg-state-styles/) 说的一样:官方示例都这么写。
- `class State(TypedDict):` 两个字段,都**没有任何合并规则**。
- `notes: list[str]` 一个字符串列表,记查证结果。
- `steps: int` 一个计数器,记走了几步。
- `def look_customer(state: State) -> dict:` 第一个节点,假装「查了客户」。
- `return {"notes": ["查了客户"], "steps": state["steps"] + 1}` 返回的 `notes` 是一个**只有一条的新列表**,`steps` 是读到的旧值加 1:代入 `state["steps"]` 是 0,得 1。
- `def look_invoices(state: State) -> dict:` 第二个节点,假装「查了发票」。
- `return {"notes": ["查了发票"]}  # 没提 steps` 也返回一个只有一条的新列表,没有提 `steps`。
- `builder.add_sequence([look_customer, look_invoices])` 两个节点依次跑。
- `builder.add_edge(START, "look_customer")` 入口和出口自己连,Day 301 讲过。
- `print(graph.invoke({"notes": ["用户来信"], "steps": 0}))` 初始状态:`notes` 一条,`steps` 是 0。
- `for chunk in graph.stream(` `stream_mode="values"` 每个节点跑完后吐出**完整状态**(Day 301 的 `updates` 吐的是更新),这样能看到每一步之后状态是什么。

</div>

```bash
uv run python -m part05.lg.s04_overwrite
```

```text
{'notes': ['查了发票'], 'steps': 1}
--- 用 stream 看每一步之后状态里有什么 ---
{'notes': ['用户来信'], 'steps': 0}
{'notes': ['查了客户'], 'steps': 1}
{'notes': ['查了发票'], 'steps': 1}
```

最终 `notes` 只有 `['查了发票']` 一条,「用户来信」和「查了客户」都没了,没有任何报错。`stream` 的三行把过程摊开了:

1. 第一行是初始状态,`notes` 有「用户来信」。
2. `look_customer` 跑完,`notes` 变成 `['查了客户']`。**不是**「用户来信」加「查了客户」,是整个列表被换了。
3. `look_invoices` 跑完,`notes` 又被换成 `['查了发票']`。

规则就一句:**没有配 reducer 的字段,节点返回什么,字段就变成什么,旧值直接被替换**。官方文档的原话是默认的合并方式「忽略左边的参数,用右边的替换状态里的值」(左边是旧值,右边是新值)。

再看 `steps`:最终是 1。`look_customer` 把它从 0 改成 1,`look_invoices` 没提它,于是保持原值 1。这也是同一条规则:**节点只改它返回的键,没返回的键不动**。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="覆盖规则的时间线:初始状态 notes 是用户来信、steps 是 0;look_customer 返回 notes 为查了客户、steps 为 1,状态变成 notes 为查了客户、steps 为 1;look_invoices 只返回 notes 为查了发票,状态变成 notes 为查了发票、steps 仍为 1;每一步 notes 都被整个替换,steps 没被提到就保持原值">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="170" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="105" y="22" fill="var(--ink-faint)" text-anchor="middle" font-size="11">初始状态</text>
<text x="32" y="56" fill="var(--ink)">notes: [用户来信]</text>
<text x="32" y="78" fill="var(--ink)">steps: 0</text>
<rect x="235" y="30" width="170" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="22" fill="var(--ink-faint)" text-anchor="middle" font-size="11">look_customer 之后</text>
<text x="247" y="56" fill="var(--ink)">notes: [查了客户]</text>
<text x="247" y="78" fill="var(--ink)">steps: 1</text>
<rect x="450" y="30" width="170" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="535" y="22" fill="var(--ink-faint)" text-anchor="middle" font-size="11">look_invoices 之后</text>
<text x="462" y="56" fill="var(--ink)">notes: [查了发票]</text>
<text x="462" y="78" fill="var(--ink)">steps: 1</text>
<line x1="190" y1="65" x2="233" y2="65" stroke="var(--ink-soft)"/>
<polygon points="235,65 227,61 227,69" fill="var(--ink-soft)"/>
<line x1="405" y1="65" x2="448" y2="65" stroke="var(--ink-soft)"/>
<polygon points="450,65 442,61 442,69" fill="var(--ink-soft)"/>
<rect x="235" y="130" width="170" height="60" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="247" y="154" fill="var(--ink)" font-size="11">返回 notes: [查了客户]</text>
<text x="247" y="174" fill="var(--ink)" font-size="11">返回 steps: 1</text>
<rect x="450" y="130" width="170" height="60" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="462" y="154" fill="var(--ink)" font-size="11">返回 notes: [查了发票]</text>
<text x="462" y="174" fill="var(--ink-soft)" font-size="11">没返回 steps</text>
<line x1="320" y1="130" x2="320" y2="102" stroke="var(--ink-soft)" stroke-dasharray="3 3"/>
<line x1="535" y1="130" x2="535" y2="102" stroke="var(--ink-soft)" stroke-dasharray="3 3"/>
<text x="20" y="222" fill="var(--ink-soft)" font-size="11">notes 每一步都被整个换掉;steps 在第二步没被提到,保持 1</text>
<text x="20" y="242" fill="var(--ink-faint)" font-size="11">虚线是「节点返回的更新」写进状态</text>
</g>
</svg>
<figcaption>覆盖规则的两半:被返回的键,新值替换旧值;没被返回的键,原样保留。</figcaption>
</figure>

对前端的你来说,这像 React 里 `setState({ notes: [...] })` 整个替换,而不是 `setState(s => ({ notes: [...s.notes, x] }))`。区别是 React 里你一眼就看得出自己在替换还是追加,LangGraph 里「替换」是默认,追加要额外声明,写的时候不留神就掉进去了。

## 节点返回值的几种「不完整」

既然「只改返回的键」,那返回值不完整的情况就值得单独试一遍:返回空字典、返回 `None`、键名拼错、返回的根本不是字典。

```python
# agent-zero-lab/part05/lg/s04_partial.py
"""节点返回值的几种「不完整」:空字典、None、拼错的键、不是字典。
用法:uv run python -m part05.lg.s04_partial"""
from typing import TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    notes: list[str]
    steps: int


def returns_empty(state: State) -> dict:
    return {}


def returns_none(state: State) -> None:
    return None


def returns_typo(state: State) -> dict:
    return {"nots": ["拼错了键名"]}


def returns_list(state: State):
    return ["我是个列表"]


def run(node) -> None:
    b = StateGraph(State)
    b.add_node("n", node)
    b.add_edge(START, "n")
    b.add_edge("n", END)
    try:
        print(f"{node.__name__:<14}", b.compile().invoke({"notes": ["x"], "steps": 0}))
    except Exception as e:
        print(f"{node.__name__:<14} {type(e).__name__}: {str(e).splitlines()[0]}")


for n in (returns_empty, returns_none, returns_typo, returns_list):
    run(n)
```

<div class="line-notes">

- `def returns_empty(state: State) -> dict:` 一个什么也不改的节点,返回 `{}`。
- `def returns_none(state: State) -> None:` 没有 `return` 语句的函数默认返回 `None`,这里显式写了出来。
- `return {"nots": ["拼错了键名"]}` 键名拼成了 `nots`,不是状态里声明的 `notes`。
- `def returns_list(state: State):` 返回一个列表而不是字典,故意写错。
- `def run(node) -> None:` 把一个节点放进只有它的图里跑,看结果。
- `b.add_node("n", node)` 节点名统一叫 `n`,这里不关心名字。
- `print(f"{node.__name__:<14}", b.compile().invoke({"notes": ["x"], "steps": 0}))` 初始状态是 `notes=['x']`,`steps=0`,打印函数名和最终状态。`:<14` 左对齐占 14 格。
- `except Exception as e:` 报错的话打印异常类型和第一行。
- `for n in (returns_empty, returns_none, returns_typo, returns_list):` 四个节点各跑一遍。

</div>

```bash
uv run python -m part05.lg.s04_partial
```

```text
returns_empty  {'notes': ['x'], 'steps': 0}
returns_none   {'notes': ['x'], 'steps': 0}
returns_typo   {'notes': ['x'], 'steps': 0}
returns_list   InvalidUpdateError: Expected dict, got ['我是个列表']
```

前三个的结果一模一样:状态没变,`{'notes': ['x'], 'steps': 0}`,**没有报错**。逐个看:

- **返回 `{}`**:没有任何键要改,状态不动。
- **返回 `None`**:效果和 `{}` 一样。所以「忘了写 `return`」不会报错,只会让这个节点什么都没干,这个坑在节点逻辑写得长的时候很难发现。
- **返回拼错的键**:`nots` 不是状态里的字段,被悄悄丢弃了(Day 299 提过这种「悄悄丢数据」)。你以为写进去了,实际没有。
- **返回列表**:这个会报错,`InvalidUpdateError: Expected dict, got ['我是个列表']`。节点返回值只能是字典(或者 `None`,和后面会学的 `Command`)。

前三种的共同点是**不报错但什么都没改**,查起来最费劲。我的习惯是调新图时用 `stream_mode="updates"` 看每个节点到底写了什么,和心里想的对一遍。

## 不 return、直接改 state:会绕开框架

有人会想,既然 `state["notes"]` 是个列表,那我在节点里直接 `append` 不就行了,不用返回整个列表。试一下:

```python
# agent-zero-lab/part05/lg/s04_mutate.py
"""不 return、直接在节点里改 state 里的列表,会发生什么?用法:uv run python -m part05.lg.s04_mutate"""
from typing import TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    notes: list[str]
    steps: int


def sneaky(state: State) -> dict:
    state["notes"].append("偷偷 append 的")  # 没有写进 return
    return {"steps": 5}


builder = StateGraph(State)
builder.add_node("sneaky", sneaky)
builder.add_edge(START, "sneaky")
builder.add_edge("sneaky", END)
graph = builder.compile()

init: State = {"notes": ["用户来信"], "steps": 0}
out = graph.invoke(init)
print("返回的状态:", out)
print("调用者手里的 init:", init)
print("notes 是同一个列表吗:", out["notes"] is init["notes"])
```

<div class="line-notes">

- `def sneaky(state: State) -> dict:` 一个「偷偷」改状态的节点。
- `state["notes"].append("偷偷 append 的")  # 没有写进 return` 直接在收到的列表上追加。这一行改的是列表对象本身,不经过框架的合并。
- `return {"steps": 5}` 返回里只有 `steps`,没提 `notes`。
- `init: State = {"notes": ["用户来信"], "steps": 0}` 把初始状态存进一个变量,为了后面看它有没有被动。
- `out = graph.invoke(init)` 调用。
- `print("返回的状态:", out)` 输出 `notes` 里居然有「偷偷 append 的」。
- `print("调用者手里的 init:", init)` 看调用者的那份数据有没有被动。
- `print("notes 是同一个列表吗:", out["notes"] is init["notes"])` `is` 问是不是同一个对象([Day 21](/blog/agent-zero/day-021-lists/) 的 `b = a`),答案是 `True`。

</div>

```bash
uv run python -m part05.lg.s04_mutate
```

```text
返回的状态: {'notes': ['用户来信', '偷偷 append 的'], 'steps': 5}
调用者手里的 init: {'notes': ['用户来信', '偷偷 append 的'], 'steps': 0}
notes 是同一个列表吗: True
```

三个现象。一,返回的 `notes` 里有「偷偷 append 的」,看起来成功了。二,**调用者手里的 `init` 也被改了**:`init["notes"]` 变成了 `['用户来信', '偷偷 append 的']`,而 `init["steps"]` 还是 0(因为 `steps` 是通过返回值正常更新的,没有碰原来的字典)。三,`out["notes"] is init["notes"]` 是 `True`,说明框架根本没有复制这个列表,节点收到的就是调用者传进来的那一个。

所以它「碰巧能用」,代价是你在不知情的情况下改了调用者的数据:同一份 `init` 用来跑第二次,里面已经带着上一次的东西。后面学 checkpoint(保存状态)以后,这种绕开框架的修改还可能存不进去、恢复不出来。规矩只有一条:**节点不要改收到的 `state`,要改就通过返回值**。

## 手动追加:读旧值,拼上新的,整个写回

那 `notes` 要累积怎么办?最直接的办法:节点自己把旧列表读出来,拼上新的,整个返回。

```python
# agent-zero-lab/part05/lg/s04_manual.py
"""手动追加:每个节点自己把旧列表读出来、拼上新的再整个写回。用法:uv run python -m part05.lg.s04_manual"""
from typing import TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    notes: list[str]


def look_customer(state: State) -> dict:
    return {"notes": [*state["notes"], "查了客户"]}


def look_invoices(state: State) -> dict:
    return {"notes": [*state["notes"], "查了发票"]}


builder = StateGraph(State)
builder.add_sequence([look_customer, look_invoices])
builder.add_edge(START, "look_customer")
builder.add_edge("look_invoices", END)
graph = builder.compile()

if __name__ == "__main__":
    init: State = {"notes": ["用户来信"]}
    print(graph.invoke(init))
    print("调用者手里的 init 没被动:", init)
```

<div class="line-notes">

- `class State(TypedDict):` 这次只留 `notes`。
- `def look_customer(state: State) -> dict:` 第一个节点。
- `return {"notes": [*state["notes"], "查了客户"]}` `[*state["notes"], "查了客户"]` 是**新语法**:星号把列表「展开」放进新列表里,≈ JS 的 `[...arr, "查了客户"]`。代入初始值 `['用户来信']`,得到 `['用户来信', '查了客户']`,是一个**新**列表,没有改旧的。
- `def look_invoices(state: State) -> dict:` 第二个节点。
- `return {"notes": [*state["notes"], "查了发票"]}` 这时 `state["notes"]` 已经是 `['用户来信', '查了客户']`,展开再加一条,得到三条。
- `init: State = {"notes": ["用户来信"]}` 初始状态存进变量。
- `print(graph.invoke(init))` 输出三条。
- `print("调用者手里的 init 没被动:", init)` 这次 `init` 还是一条,因为是拼出新列表而不是原地改。

</div>

```bash
uv run python -m part05.lg.s04_manual
```

```text
{'notes': ['用户来信', '查了客户', '查了发票']}
调用者手里的 init 没被动: {'notes': ['用户来信']}
```

这次三条都在,调用者的 `init` 也没被碰。串行的两个节点,这样写完全够用。它的缺点也很明显:

- **每个节点都要记得带旧值**。忘一次,前面的就丢一次,而且不报错。练习 1 专门演示一次。
- **节点的返回值和「新增了什么」混在一起**。想看「这个节点到底加了什么」,得拿返回的列表去和输入的列表比。
- **两个节点同时跑时直接失效**。这一条不是推测,下面实跑一遍。

### 同时跑的两个节点

「同时跑」指的是两个节点没有先后关系,从同一个出发点分叉出去,在同一步里一起执行。并行是 Day 305 的主题,今天只拿它的报错来说明手动追加撑不住:

```python
# agent-zero-lab/part05/lg/s04_parallel_teaser.py
"""预告:手动追加在两个节点「同时」跑时行不通。并行本身 Day 305 才讲,今天只看它的报错。
用法:uv run python -m part05.lg.s04_parallel_teaser"""
from typing import TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    notes: list[str]


def look_customer(state: State) -> dict:
    return {"notes": [*state["notes"], "查了客户"]}


def look_invoices(state: State) -> dict:
    return {"notes": [*state["notes"], "查了发票"]}


builder = StateGraph(State)
builder.add_node("look_customer", look_customer)
builder.add_node("look_invoices", look_invoices)
builder.add_edge(START, "look_customer")  # 两条边都从 START 出发
builder.add_edge(START, "look_invoices")  # 所以两个节点在同一步里一起跑
builder.add_edge("look_customer", END)
builder.add_edge("look_invoices", END)
graph = builder.compile()

try:
    graph.invoke({"notes": ["用户来信"]})
except Exception as e:
    print(f"{type(e).__name__}: {e}")
```

<div class="line-notes">

- `def look_customer(state: State) -> dict:` 两个节点都用手动追加的写法,和上一段一样。
- `return {"notes": [*state["notes"], "查了客户"]}` 读旧值、拼新的。
- `builder.add_node("look_customer", look_customer)` 这次不用 `add_sequence`,因为不是顺序执行。
- `builder.add_edge(START, "look_customer")  # 两条边都从 START 出发` 入口连到第一个节点。
- `builder.add_edge(START, "look_invoices")  # 所以两个节点在同一步里一起跑` 入口也连到第二个节点,两个节点都从入口直接出发,没有先后。
- `builder.add_edge("look_customer", END)` 两个节点各自连到出口。
- `graph.invoke({"notes": ["用户来信"]})` 调用,预期会报错。
- `print(f"{type(e).__name__}: {e}")` 打印异常类型和完整信息。

</div>

```bash
uv run python -m part05.lg.s04_parallel_teaser
```

```text
InvalidUpdateError: At key 'notes': Can receive only one value per step. Use an Annotated key to handle multiple values.
For troubleshooting, visit: https://docs.langchain.com/oss/python/langgraph/errors/INVALID_CONCURRENT_GRAPH_UPDATE
```

报错说得很直白:`At key 'notes': Can receive only one value per step. Use an Annotated key to handle multiple values.`(同一步里 `notes` 这个键只能收到一个值,要处理多个值请用 `Annotated` 的键)。两个节点同时给 `notes` 一个新列表,框架不知道该听谁的,只好报错。「`Annotated` 的键」指的就是明天要学的 reducer 的写法(Day 298 见过 `Annotated`,明天再讲它在状态里怎么用)。这就是为什么手动追加只是权宜之计:顺序执行能凑合,并行就不行。

## 真数据:41 张工单

前面的「查了客户」是我编的句子。用 CloudLedger 的真数据再跑一遍:每张工单先查客户所在的公司,再查这个客户有几张未付发票,各记一条到 `notes`。

```python
# agent-zero-lab/part05/lg/s04_tickets.py
"""41 张真工单:两个查证节点各写一条 notes。覆盖版只剩一条,手动追加版有两条。
用法:uv run python -m part05.lg.s04_tickets"""
import sqlite3
from collections import Counter
from pathlib import Path
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from part05.lg.s01_tickets import load_tickets

DB = Path(__file__).resolve().parents[2] / "cloudledger" / "cloudledger.db"


class State(TypedDict):
    ticket_id: str
    notes: list[str]


def query_one(sql: str, params: tuple) -> tuple:
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    try:
        return conn.execute(sql, params).fetchone()
    finally:
        conn.close()


def customer_note(ticket_id: str) -> str:
    company, = query_one(
        "SELECT c.company FROM tickets t JOIN customers c ON c.id = t.customer_id WHERE t.id = ?",
        (ticket_id,),
    )
    return f"客户:{company}"


def invoice_note(ticket_id: str) -> str:
    n, = query_one(
        "SELECT COUNT(*) FROM invoices i JOIN tickets t ON t.customer_id = i.customer_id "
        "WHERE t.id = ? AND i.status = 'open'",
        (ticket_id,),
    )
    return f"未付发票:{n} 张"


# 覆盖版:只返回自己这一条
def look_customer(state: State) -> dict:
    return {"notes": [customer_note(state["ticket_id"])]}


def look_invoices(state: State) -> dict:
    return {"notes": [invoice_note(state["ticket_id"])]}


# 手动追加版:把旧的读出来,拼上新的
def look_customer_m(state: State) -> dict:
    return {"notes": [*state["notes"], customer_note(state["ticket_id"])]}


def look_invoices_m(state: State) -> dict:
    return {"notes": [*state["notes"], invoice_note(state["ticket_id"])]}


def build(nodes: list):
    b = StateGraph(State)
    b.add_sequence(nodes)
    b.add_edge(START, nodes[0].__name__)
    b.add_edge(nodes[-1].__name__, END)
    return b.compile()


overwrite_graph = build([look_customer, look_invoices])
manual_graph = build([look_customer_m, look_invoices_m])

if __name__ == "__main__":
    ids = [ticket_id for ticket_id, _ in load_tickets()]
    for name, graph in (("覆盖版", overwrite_graph), ("手动追加版", manual_graph)):
        results = [graph.invoke({"ticket_id": i, "notes": []}) for i in ids]
        sizes = Counter(len(r["notes"]) for r in results)
        print(f"{name}:最终 notes 条数分布 {dict(sizes)}")
        print("  T1001 ->", results[0]["notes"])
```

<div class="line-notes">

- `import sqlite3` 标准库,Day 92 学的。
- `from collections import Counter` 数每种情况各有几个。
- `from part05.lg.s01_tickets import load_tickets` Day 299 的函数,今天只取工单号。
- `DB = Path(__file__).resolve().parents[2] / "cloudledger" / "cloudledger.db"` 业务库路径,写法和 Day 299 一样。
- `class State(TypedDict):` 状态:工单号、记录列表。这回初始状态只给工单号,节点自己去库里查。
- `def query_one(sql: str, params: tuple) -> tuple:` 一个小帮手:只读打开库,执行一条查询,返回第一行。
- `conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)` `mode=ro` 是只读,不会改库。
- `return conn.execute(sql, params).fetchone()` `?` 是占位符,`params` 里的值会被安全地填进去,不要用字符串拼 SQL。
- `company, = query_one(` 结果是只有一个元素的元组,`company,` 带逗号是「解包出这一个」([Day 22](/blog/agent-zero/day-022-tuples-unpack/))。
- `JOIN customers c ON c.id = t.customer_id WHERE t.id = ?` 从工单表连到客户表,按工单号找到公司名。
- `return f"客户:{company}"` 例如 T1001 得到 `客户:白塔印务`。
- `"WHERE t.id = ? AND i.status = 'open'"` 数这个客户 `open`(未付)状态的发票。
- `return f"未付发票:{n} 张"` T1001 得到 `未付发票:0 张`。
- `def look_customer(state: State) -> dict:` 覆盖版的第一个节点。
- `return {"notes": [customer_note(state["ticket_id"])]}` 只返回自己这一条。
- `def look_customer_m(state: State) -> dict:` 手动追加版,函数名多个 `_m`。
- `return {"notes": [*state["notes"], customer_note(state["ticket_id"])]}` 带上旧值。
- `def build(nodes: list):` 一个小帮手,把传进来的节点串成图。
- `b.add_edge(START, nodes[0].__name__)` 入口连到第一个节点。
- `overwrite_graph = build([look_customer, look_invoices])` 覆盖版。
- `manual_graph = build([look_customer_m, look_invoices_m])` 手动追加版。
- `ids = [ticket_id for ticket_id, _ in load_tickets()]` 列表推导式,取出 41 个工单号。
- `results = [graph.invoke({"ticket_id": i, "notes": []}) for i in ids]` 初始 `notes` 是空列表,41 次调用。
- `sizes = Counter(len(r["notes"]) for r in results)` 数最终 `notes` 的长度,各有几张。
- `print(f"{name}:最终 notes 条数分布 {dict(sizes)}")` 例如 `{1: 41}` 表示 41 张的 `notes` 都只有 1 条。
- `print("  T1001 ->", results[0]["notes"])` 看第一张工单具体的内容。

</div>

```bash
uv run python -m part05.lg.s04_tickets
```

```text
覆盖版:最终 notes 条数分布 {1: 41}
  T1001 -> ['未付发票:0 张']
手动追加版:最终 notes 条数分布 {2: 41}
  T1001 -> ['客户:白塔印务', '未付发票:0 张']
```

覆盖版 41 张**全都只剩一条**(`{1: 41}`),而且剩的是最后一个节点写的「未付发票」,客户那条丢了;手动追加版 41 张全是两条。41 张结果完全一致,说明这是规则,不是偶然。

## 最常见的事故:messages 没配 reducer

Agent 的状态里最重要的字段是消息列表 `messages`。要是它没配合并规则,每一轮节点返回的消息会把整个列表换掉。下面用一个假模型(不调 API)演示:它每次回复「我这一轮看到了几条消息」。消息先用普通字典 `{"role": ..., "content": ...}` 表示,明天再换成 LangGraph 的消息类。

```python
# agent-zero-lab/part05/lg/s04_messages.py
"""最常见的覆盖事故:messages 没配 reducer,「模型」每一轮只看得到最新一条。
用法:uv run python -m part05.lg.s04_messages"""
from typing import TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    messages: list[dict]


def fake_model(state: State) -> dict:
    seen = [m["content"] for m in state["messages"]]
    print(f"  模型这一轮看到 {len(seen)} 条:", seen)
    return {"messages": [{"role": "assistant", "content": f"(看到了 {len(seen)} 条)"}]}


builder = StateGraph(State)
builder.add_node("model", fake_model)
builder.add_edge(START, "model")
builder.add_edge("model", END)
graph = builder.compile()

history: list[dict] = [{"role": "user", "content": "发票开错了"}]
for turn, question in enumerate(["能重开吗?", "多久到账?"], start=1):
    out = graph.invoke({"messages": history})
    print(f"第 {turn} 轮之后,状态里有 {len(out['messages'])} 条")
    history = [*out["messages"], {"role": "user", "content": question}]
```

<div class="line-notes">

- `class State(TypedDict):` 只有一个字段。
- `messages: list[dict]` 一个字典列表,没配任何合并规则。
- `def fake_model(state: State) -> dict:` 假模型节点:数一数它收到几条消息。
- `seen = [m["content"] for m in state["messages"]]` 取出每条消息的文字。
- `print(f"  模型这一轮看到 {len(seen)} 条:", seen)` 把它「看到」的打印出来。
- `return {"messages": [{"role": "assistant", "content": f"(看到了 {len(seen)} 条)"}]}` 返回一条新回复,只有这一条。这就是坑:它返回的是一个只含新回复的列表,会替换掉整个 `messages`。
- `history: list[dict] = [{"role": "user", "content": "发票开错了"}]` 对话历史,调用者自己保管,一开始只有一条用户消息。
- `for turn, question in enumerate(["能重开吗?", "多久到账?"], start=1):` 模拟两个后续追问,`turn` 从 1 数起。
- `out = graph.invoke({"messages": history})` 把历史交给图。
- `print(f"第 {turn} 轮之后,状态里有 {len(out['messages'])} 条")` 看图跑完以后状态里有几条。
- `history = [*out["messages"], {"role": "user", "content": question}]` 调用者把图返回的消息加上新问题,作为下一轮的历史。这里用的是刚学的 `[*列表, 新项]`。

</div>

```bash
uv run python -m part05.lg.s04_messages
```

```text
  模型这一轮看到 1 条: ['发票开错了']
第 1 轮之后,状态里有 1 条
  模型这一轮看到 2 条: ['(看到了 1 条)', '能重开吗?']
第 2 轮之后,状态里有 1 条
```

第 1 轮,模型看到 1 条(那条用户消息),没问题。跑完以后状态里却只有 **1 条**:回复把原来那条用户消息换掉了,留下的只有回复本身。于是调用者拿 `out["messages"]` 拼下一轮的历史时,拼出来的是「回复、新问题」,**第一个问题「发票开错了」不见了**。第 2 轮模型看到 2 条:`'(看到了 1 条)'` 和 `'能重开吗?'`,最开始的「发票开错了」它根本不知道。

这就是「模型不记得前面说过什么」的一种成因:不报错、输出看着也正常,只是每一步都在丢上下文。真实的 Agent 循环里,这个坑会让模型每一轮都只看得到最新的工具结果,找不出前因后果。后面所有「对话类」的图,第一件事就是给 `messages` 配 reducer(明天讲)。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="messages 没配 reducer 的两轮对话:第一轮图开始时 messages 有一条用户消息发票开错了;模型节点返回只有一条回复的列表,把整个 messages 换成只有回复一条;调用者拿这一条加上新问题作为第二轮历史,于是第二轮模型只看到回复和新问题,原来那条用户消息已经丢失">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="22" fill="var(--ink-faint)" font-size="11">第 1 轮</text>
<rect x="20" y="32" width="170" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="105" y="52" fill="var(--ink)" text-anchor="middle" font-size="11">messages 进图</text>
<text x="105" y="68" fill="var(--ink-soft)" text-anchor="middle" font-size="11">[发票开错了]</text>
<rect x="235" y="32" width="170" height="44" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="52" fill="var(--ink)" text-anchor="middle" font-size="11">fake_model</text>
<text x="320" y="68" fill="var(--ink-soft)" text-anchor="middle" font-size="11">返回 [回复1]</text>
<rect x="450" y="32" width="170" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="535" y="52" fill="var(--ink)" text-anchor="middle" font-size="11">messages 出图</text>
<text x="535" y="68" fill="var(--ink-soft)" text-anchor="middle" font-size="11">[回复1]  只剩 1 条</text>
<line x1="190" y1="54" x2="233" y2="54" stroke="var(--ink-soft)"/>
<polygon points="235,54 227,50 227,58" fill="var(--ink-soft)"/>
<line x1="405" y1="54" x2="448" y2="54" stroke="var(--ink-soft)"/>
<polygon points="450,54 442,50 442,58" fill="var(--ink-soft)"/>
<text x="20" y="116" fill="var(--ink-faint)" font-size="11">第 2 轮:调用者拿「回复1」加上新问题当历史</text>
<rect x="20" y="126" width="170" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="105" y="146" fill="var(--ink)" text-anchor="middle" font-size="11">messages 进图</text>
<text x="105" y="162" fill="var(--ink-soft)" text-anchor="middle" font-size="11">[回复1, 能重开吗?]</text>
<rect x="235" y="126" width="385" height="44" rx="6" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="427" y="146" fill="var(--ink)" text-anchor="middle" font-size="11">模型看到 2 条,「发票开错了」已经丢了</text>
<text x="427" y="162" fill="var(--ink-soft)" text-anchor="middle" font-size="11">没有报错,只是上下文悄悄变少</text>
<line x1="190" y1="148" x2="233" y2="148" stroke="var(--ink-soft)"/>
<polygon points="235,148 227,144 227,152" fill="var(--ink-soft)"/>
<text x="20" y="206" fill="var(--ink-soft)" font-size="11">节点返回的是「只含新回复」的列表,默认规则把整个 messages 换成了它</text>
</g>
</svg>
<figcaption>messages 事故的全过程:每一轮都只留下最后写进去的那一条。</figcaption>
</figure>

## 零件 → 大代码对照表

| 零件 | 在哪个脚本 | 说明 |
| --- | --- | --- |
| 两个节点写同一个字段,后写的盖掉先写的 | `s04_overwrite.py` | 没返回的 `steps` 保持原值 |
| 返回 `{}`、`None`、拼错的键、列表 | `s04_partial.py` | 前三个不改状态也不报错,列表报 `InvalidUpdateError` |
| 原地 `append`、不 return | `s04_mutate.py` | 绕开框架,调用者的数据也被改 |
| 手动读旧值、拼新值 | `s04_manual.py` | 串行可用,忘一次丢一次 |
| 两个节点同时写 | `s04_parallel_teaser.py` | 预告:`Can receive only one value per step` |
| 41 张真工单,覆盖版对比手动版 | `s04_tickets.py` | `{1: 41}` 对 `{2: 41}` |
| messages 没配 reducer | `s04_messages.py` | 每一轮只剩最后一条 |

## 动手练习

四道题,都在 `part05/lg/` 下新建文件。每题后面是参考答案,先自己做。

### 练习 1:三个节点,谁忘了带旧值

三个节点依次往 `notes` 里加记录,手动追加,但其中一个忘了带旧值。用 `stream_mode="updates"` 找出是谁,最终 `notes` 是什么。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex303_three_nodes.py
"""练习 1:三个节点手动追加,其中一个忘了带旧值。用 stream 找出是谁。
用法:uv run python -m part05.lg.ex303_three_nodes"""
from typing import TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    notes: list[str]


def a(state: State) -> dict:
    return {"notes": [*state["notes"], "a 查了客户"]}


def b(state: State) -> dict:
    return {"notes": ["b 查了发票"]}  # 忘了带旧值


def c(state: State) -> dict:
    return {"notes": [*state["notes"], "c 查了订阅"]}


builder = StateGraph(State)
builder.add_sequence([a, b, c])
builder.add_edge(START, "a")
builder.add_edge("c", END)
graph = builder.compile()

for chunk in graph.stream({"notes": ["用户来信"]}, stream_mode="updates"):
    for node, update in chunk.items():
        print(f"{node} 写入 {update['notes']}")
```

<div class="line-notes">

- `def a(state: State) -> dict:` 第一个节点,正确写法。
- `return {"notes": [*state["notes"], "a 查了客户"]}` 带旧值。
- `def b(state: State) -> dict:` 第二个节点,故意写错。
- `return {"notes": ["b 查了发票"]}  # 忘了带旧值` 少了 `*state["notes"]`。
- `def c(state: State) -> dict:` 第三个节点,正确写法。
- `builder.add_sequence([a, b, c])` 三个节点依次跑。
- `for chunk in graph.stream({"notes": ["用户来信"]}, stream_mode="updates"):` 用 `updates` 看每个节点写了什么。
- `for node, update in chunk.items():` 取出节点名和它的更新。
- `print(f"{node} 写入 {update['notes']}")` 打印每个节点写进去的完整列表。

</div>

```text
a 写入 ['用户来信', 'a 查了客户']
b 写入 ['b 查了发票']
c 写入 ['b 查了发票', 'c 查了订阅']
```

看每个节点**写入**的列表长度:`a` 写入两条,`b` 写入**一条**,列表变短了,这就是出事的地方,「用户来信」和「a 查了客户」在 `b` 之后没了。`c` 带了旧值,但旧值已经是被 `b` 弄丢过的。最终 `notes` 是 `['b 查了发票', 'c 查了订阅']`,看起来还像回事,不仔细数不会发现丢了两条。排查办法就是这里用的:`updates` 模式下每个节点写入的列表,长度应该是单调增加的,谁让它变短谁有问题。

</details>

### 练习 2:覆盖有时恰恰是想要的

`draft` 先起草一句回复,`polish` 在它的基础上润色(加一句话)。`reply` 这个字段就该被后面的覆盖,不需要累积。写出来,用 `stream_mode="values"` 看每一步。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex303_polish.py
"""练习 2:覆盖有时正是想要的。draft 起草,polish 润色,reply 就该被后者盖掉。
用法:uv run python -m part05.lg.ex303_polish"""
from typing import NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    ticket: str
    reply: NotRequired[str]


def draft(state: State) -> dict:
    return {"reply": "您好,已收到,我们会尽快处理。"}


def polish(state: State) -> dict:
    return {"reply": state.get("reply", "") + "如有补充材料,直接回复本邮件即可。"}


builder = StateGraph(State)
builder.add_sequence([draft, polish])
builder.add_edge(START, "draft")
builder.add_edge("polish", END)
graph = builder.compile()

for chunk in graph.stream({"ticket": "发票开错了"}, stream_mode="values"):
    print(chunk)
```

<div class="line-notes">

- `class State(TypedDict):` 两个字段:`ticket` 必填,`reply` 先没有。
- `reply: NotRequired[str]` 一开始没有这个键,`draft` 写入后才有。
- `def draft(state: State) -> dict:` 起草。
- `return {"reply": "您好,已收到,我们会尽快处理。"}` 写入第一版。
- `def polish(state: State) -> dict:` 润色。
- `return {"reply": state.get("reply", "") + "如有补充材料,直接回复本邮件即可。"}` 读旧的 `reply`,在后面拼一句,整个写回。`.get("reply", "")` 是因为 `reply` 是 `NotRequired`,编辑器不让直接用方括号读。
- `builder.add_sequence([draft, polish])` 起草之后润色。
- `for chunk in graph.stream({"ticket": "发票开错了"}, stream_mode="values"):` 每一步后看完整状态。
- `print(chunk)` 打印三次:初始、起草后、润色后。

</div>

```text
{'ticket': '发票开错了'}
{'ticket': '发票开错了', 'reply': '您好,已收到,我们会尽快处理。'}
{'ticket': '发票开错了', 'reply': '您好,已收到,我们会尽快处理。如有补充材料,直接回复本邮件即可。'}
```

三行:初始没有 `reply`,起草后有一句,润色后是**同一个字段**里更长的一句,第一版被替换掉了。这里替换正是想要的:`reply` 在任何时刻只应该有一个「当前最好的版本」,不需要保留历史。所以覆盖规则本身不是缺陷,**它是「默认」,而你得清楚每个字段想要的是替换还是累积**:当前最新的结果用覆盖,过程记录和对话历史要累积。

</details>

### 练习 3:修好 messages 事故(手动版)

改 `s04_messages.py`,让假模型把旧消息读出来、拼上自己的回复再返回。跑两轮,模型看到的条数应该是 1、3。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex303_messages_fix.py
"""练习 3:在节点里手动把旧消息拼上,修好 s04_messages 的事故。
用法:uv run python -m part05.lg.ex303_messages_fix"""
from typing import TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    messages: list[dict]


def fake_model(state: State) -> dict:
    seen = [m["content"] for m in state["messages"]]
    print(f"  模型这一轮看到 {len(seen)} 条")
    reply = {"role": "assistant", "content": f"(看到了 {len(seen)} 条)"}
    return {"messages": [*state["messages"], reply]}


builder = StateGraph(State)
builder.add_node("model", fake_model)
builder.add_edge(START, "model")
builder.add_edge("model", END)
graph = builder.compile()

history: list[dict] = [{"role": "user", "content": "发票开错了"}]
for turn, question in enumerate(["能重开吗?", "多久到账?"], start=1):
    out = graph.invoke({"messages": history})
    print(f"第 {turn} 轮之后,状态里有 {len(out['messages'])} 条")
    history = [*out["messages"], {"role": "user", "content": question}]
```

<div class="line-notes">

- `def fake_model(state: State) -> dict:` 和事故版同名,只改最后一行。
- `seen = [m["content"] for m in state["messages"]]` 取出收到的消息文字。
- `print(f"  模型这一轮看到 {len(seen)} 条")` 只打印条数。
- `reply = {"role": "assistant", "content": f"(看到了 {len(seen)} 条)"}` 先把回复造出来。
- `return {"messages": [*state["messages"], reply]}` 关键的一行:旧消息全部带上,再加回复。
- `history: list[dict] = [{"role": "user", "content": "发票开错了"}]` 起始历史。
- `for turn, question in enumerate(["能重开吗?", "多久到账?"], start=1):` 两个追问。
- `history = [*out["messages"], {"role": "user", "content": question}]` 把图返回的完整消息加上新问题。

</div>

```text
  模型这一轮看到 1 条
第 1 轮之后,状态里有 2 条
  模型这一轮看到 3 条
第 2 轮之后,状态里有 4 条
```

第 1 轮模型看到 1 条,跑完状态里有 2 条(用户消息加回复)。第 2 轮调用者追加一个问题,模型看到 3 条,跑完状态里有 4 条。每一轮都比事故版多保留了前文。这能用,但每个节点都得记得这样写;而且在带工具调用的循环里,节点不止一个、有的还并行,这种手写会越来越吃力。明天的 `add_messages` 就是把这件事交给框架。

</details>

### 练习 4:把覆盖写成一条会失败的断言

给覆盖版和手动追加版各写一条检查:同一张工单最终必须有 2 条记录。覆盖版应该被抓住。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex303_lost_data_test.py
"""练习 4:把「数据被覆盖」写成一条断言,覆盖版会被抓住,手动追加版通过。
用法:uv run python -m part05.lg.ex303_lost_data_test"""
from part05.lg.s04_tickets import manual_graph, overwrite_graph


def check_two_notes(graph, ticket_id: str) -> None:
    notes = graph.invoke({"ticket_id": ticket_id, "notes": []})["notes"]
    assert len(notes) == 2, f"{ticket_id} 应该有 2 条记录,实际 {len(notes)} 条:{notes}"


check_two_notes(manual_graph, "T1001")
print("手动追加版:通过")
try:
    check_two_notes(overwrite_graph, "T1001")
except AssertionError as e:
    print("覆盖版:", e)
```

<div class="line-notes">

- `from part05.lg.s04_tickets import manual_graph, overwrite_graph` 复用真数据那一段建好的两张图。
- `def check_two_notes(graph, ticket_id: str) -> None:` 检查函数:跑一张工单,看记录是不是两条。
- `notes = graph.invoke({"ticket_id": ticket_id, "notes": []})["notes"]` 调用后直接取出 `notes`。
- `assert len(notes) == 2, f"` `assert 条件, 信息`:条件为假就抛 `AssertionError`,后面的字符串是附带的信息。
- `check_two_notes(manual_graph, "T1001")` 手动追加版,条件成立,什么也不抛。
- `print("手动追加版:通过")` 走到这里说明通过。
- `check_two_notes(overwrite_graph, "T1001")` 覆盖版,条件不成立。
- `except AssertionError as e:` 接住并打印信息。

</div>

```text
手动追加版:通过
覆盖版: T1001 应该有 2 条记录,实际 1 条:['未付发票:0 张']
```

手动追加版通过;覆盖版被抓住,信息直接写明「应该有 2 条,实际 1 条」和剩下的内容。覆盖事故本身不会报错,所以要靠测试把它变成会报错的东西:凡是「应该累积」的字段,写一条断言数一数条数。后面评测一章会把这样的断言整理成正式的测试集。

</details>

**验收标准:** 四个练习的脚本都能跑通,输出和参考答案一致;不看文章能默写出 `s04_overwrite.py` 里的状态和两个节点,并说出最终 `notes` 和 `steps` 是什么、为什么;能口头解释「为什么返回 `None` 不报错」「为什么原地 `append` 不该用」「为什么手动追加遇到并行会报错」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 覆盖(overwrite) | 没配合并规则的字段,节点返回什么,字段就变成什么,旧值被换掉。LangGraph 的默认行为 |
| reducer | 规定「旧值和新值怎么合并」的函数。明天正式讲;今天只需要知道没配它的字段是覆盖 |
| 更新(update) | 节点返回的字典,只含它想改的字段。没提到的字段保持原值 |
| `stream_mode="values"` | `stream` 的一种模式,每个节点跑完后吐出**完整的状态**。Day 301 的 `updates` 吐的是更新 |
| 展开 `[*列表, 新项]` | 把列表里的项展开放进新列表,≈ JS 的 `[...arr, x]`。得到新列表,不改原来的 |
| 原地修改(mutate) | 直接改一个已有对象的内容(`list.append`),而不是造一个新的。会影响所有指向它的名字 |
| `is` | 问两个名字是不是指向同一个对象,不是问内容一样不一样([Day 21](/blog/agent-zero/day-021-lists/)) |
| `InvalidUpdateError` | LangGraph 对不合规的更新抛的异常。今天见过两种:节点返回列表、两个并行节点同时写没配 reducer 的键 |
| `assert` | 断言:条件不成立就抛 `AssertionError`。≈ 一个很简陋的 `expect(...)` |
| 查证节点 | 本课里查数据、把发现记下来的节点,`look_customer` 一类 |

## 常见误区

**以为节点返回的列表会「追加」到状态里。**默认是替换。返回 `["查了发票"]`,状态里就变成 `["查了发票"]`,前面的全没了,零报错。这是今天最重要的一条,也是后面几天要补的洞。

**忘了写 `return`,或者 `return` 的是 `None`。**节点什么也没改,图照样往下走,不报错。逻辑长的节点,一定要用 `stream` 看它到底写了什么。

**键名拼错。**`{"nots": [...]}` 悄悄被丢掉,你以为写进去了,其实没有。我第一次碰到时是把 `notes` 写成 `note`,跑完发现状态没变,查了十分钟。

**在节点里直接 `state["notes"].append(...)`。**今天实测:它会同时改掉调用者传进来的那一份数据,第二次用同一个初始状态跑时,里面已经带着上一次的内容。要改就返回新列表。

**手动追加时有一个节点忘了带旧值。**前面累积的会在这个节点丢掉,而且最终结果看起来「像回事」,不数条数不容易发现。

**以为手动追加可以一直用下去。**两个节点同时写同一个键,报 `Can receive only one value per step`。顺序执行能凑合,并行不行。

**把覆盖当成 bug 一律要改。**练习 2 里 `reply` 就该被后面的覆盖。每个字段想要「当前最新值」还是「累积历史」,是设计问题,不是对错问题。

**messages 不配 reducer。**每一轮模型只看得到最后一次写进去的消息。对话类的图,这一条要最先检查。

## 学习资料

### 文档与文章

- [LangGraph 文档 · Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api):讲 reducer 的那一节,第一句就是默认规则「没有 reducer 的键,更新会覆盖」。今天的现象在这里是一句话,读 Reducers 一节,10 分钟。
- [LangGraph 文档 · Use the graph API](https://docs.langchain.com/oss/python/langgraph/use-graph-api):有「Process state updates with reducers」的完整示例,明天会用。今天先扫一眼有哪些写法。
- [LangGraph 文档 · INVALID_CONCURRENT_GRAPH_UPDATE](https://docs.langchain.com/oss/python/langgraph/errors/INVALID_CONCURRENT_GRAPH_UPDATE):今天预告里那个报错的官方说明和修法,Day 305 会正式用到。
- [LangGraph 文档 · INVALID_GRAPH_NODE_RETURN_VALUE](https://docs.langchain.com/oss/python/langgraph/errors/INVALID_GRAPH_NODE_RETURN_VALUE):节点返回了不是字典的东西时的说明。
- [Python 文档 · 数据结构,列表](https://docs.python.org/3/tutorial/datastructures.html#more-on-lists):`list.append` 原地修改、返回 `None` 的官方说明,对照 `s04_mutate.py` 看。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1z3NY66EY1&autoplay=0&high_quality=1" title="尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>尚硅谷 · 尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战 · 全套约 21 小时(2026 年 10 月查)。我没有逐集看。按旧课笔记里的对应关系,讲 reducer 的在第 16–18 集前后,这个对应来自我之前的整理,没有重新核对,按标题找「reducer」「覆盖」几集即可。</figcaption>
</figure>

- 吴恩达&LangChain《用LangGraph搭建智能体》(BV1bi421v7oD,约 92 分钟,字幕搬运):录于 2024 年,API 有些旧,看他怎么讲「状态里的列表要累积」。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/aHCDrAbH_go" title="Building Effective Agents with LangGraph" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Building Effective Agents with LangGraph · 官方频道,英文,开字幕。我只核对了标题和频道,没有逐段看完。里面的例子里状态在节点之间累积,可以对照今天的覆盖现象看它是怎么避免的。</figcaption>
</figure>

### 书籍

- Mayo Oshin、Nuno Campos,《Learning LangChain: Building AI and LLM Applications with LangChain and LangGraph》,O'Reilly,2025。讲状态和 reducer 的章节可以对照今天和明天的内容。我没有核实有无中文版。

### 开源项目与代码

- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):搜 `LastValue`,它是「没配 reducer 的键」背后的那个通道,行为就是「保留最后一次写入的值」,今天的所有现象都出自它。我没读过源码实现细节,这个对应是从官方文档的描述推断的。

## 自测

1. 初始 `notes=['用户来信']`、`steps=0`,两个节点各返回 `{"notes": [一条新的]}`(第一个同时返回 `steps+1`),没配任何 reducer。最终 `notes` 和 `steps` 是什么?

<details><summary>答案</summary>

`notes` 是第二个节点返回的那一条(只剩一条,「用户来信」和第一个节点写的都没了);`steps` 是 1(第一个节点写成 1,第二个节点没提它,保持原值)。实测输出 `{'notes': ['查了发票'], 'steps': 1}`。

</details>

2. 节点返回 `{}`、返回 `None`、返回键名拼错的字典、返回列表,各会怎样?

<details><summary>答案</summary>

前三种状态都不变,不报错(`None` 等价于没有更新,拼错的键名被悄悄丢掉);返回列表会抛 `InvalidUpdateError: Expected dict, got [...]`。

</details>

3. 节点里直接 `state["notes"].append("x")` 然后 `return {"steps": 5}`,`notes` 里会有 `"x"` 吗?有什么副作用?

<details><summary>答案</summary>

会有,因为节点拿到的是调用者传进来的那同一个列表对象,`append` 直接改了它。副作用:调用者手里的初始状态也被改了(实测 `out["notes"] is init["notes"]` 是 `True`),同一份初始状态再用一次就带着上次的内容;而且这种修改绕开了框架,以后用 checkpoint 保存状态时不一定能存下来。要改就通过返回值返回新列表。

</details>

4. 手动追加 `[*state["notes"], "新的"]` 能解决什么、不能解决什么?

<details><summary>答案</summary>

能解决串行节点的累积:每个节点把旧值带上再加新的,最终是全部。不能解决:一,每个节点都得记得带旧值,忘了就丢,而且不报错;二,两个节点在同一步里并行写同一个键时,框架报 `InvalidUpdateError: At key 'notes': Can receive only one value per step`,要靠 reducer(明天)解决。

</details>

5. 面试题:你的 Agent 线上表现「聊几轮之后好像忘了前面说过什么」,图是用 LangGraph 写的,你第一步查什么?

<details><summary>答案</summary>

先看 `messages` 这个字段有没有配 reducer(`Annotated[list, add_messages]`)。没配的话默认是覆盖,每个节点返回的消息会把整个列表换掉,模型每一轮只看得到最新写进去的那一条,不报错。验证办法:用 `stream_mode="values"` 或者在节点里打印 `len(state["messages"])`,看每一轮是不是应该逐步增加却始终是一两条。如果配了,再查别的:有没有哪个节点在裁剪消息、检查点有没有正确恢复、历史是否被调用者每次重新拼接(像今天的 `history` 那样)而漏了东西。

</details>

6. 为什么说「覆盖」不一定是 bug?举一个想要覆盖的字段和一个想要累积的字段。

<details><summary>答案</summary>

覆盖是默认规则,每个字段想要什么要看设计。想要覆盖:`reply`(当前最新的草稿,润色之后旧版本不需要保留)、`category`(以最后一次分类为准)。想要累积:`notes`(过程记录,每个节点贡献一条)、`messages`(对话历史)、花费(每个节点报自己这一步的,总和才是整次运行的花费)。

</details>

## 明天预告

Day 304 · LangGraph(五):reducer 和 add_messages。今天手动拼旧值的办法,在串行时凑合,并行时直接报错。明天换成正路:给字段配 reducer,写成 `Annotated[list[str], operator.add]`,节点只需要返回「这一步新增的」,合并交给框架;再看 `add_messages` 在拼接之外多做了什么(按 id 替换、字典自动变消息),今天那个 messages 事故用它一行就修好。
