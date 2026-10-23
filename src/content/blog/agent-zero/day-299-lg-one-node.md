---
title: 'Day 299 · LangGraph(一):只有一个节点的图'
description: '昨天证明了 create_agent 就是一张 LangGraph 图。今天不调模型、不调工具,从最小的图开始:一个状态、一个节点、两条边,走完「定义状态、建图纸、加节点、连边、编译、调用」六步。再把图打开看,故意传错输入、故意写错节点返回值,看哪些会报错、哪些悄悄丢数据,最后拿 41 张真工单过一遍。'
pubDate: 2026-10-23
regime: none
tags: ['langgraph', 'state-graph', 'orchestration', 'python', 'agent-zero']
series: 'agent-zero'
day: 299
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 298](/blog/agent-zero/day-298-langchain-vs-langgraph/) 用 `uv tree` 证明了 LangChain 1.x 的 `langchain` 包直接依赖 `langgraph`,而 `langgraph` 不依赖 `langchain`;又把同一个账单任务写了两遍,手写版和 `create_agent` 版逐项对得上;打开 `create_agent` 返回的对象,发现它的类型叫 `CompiledStateGraph`,里面有 `model` 和 `tools` 两个节点。最后实测了一个行为差异:工具抛 `ConnectionError`,手写注册表会把它变成错误消息交给模型,默认的 `create_agent` 整个调用都抛出来。

昨天只是「看」了那张图,没有自己画过。今天从最小的开始:一个节点、不调模型、不调工具,把画一张图的六个步骤走一遍。以后碰到的所有图,不管多复杂,都是这六步加上更多的节点和边。

## 今天要解决的问题

学完今天,你要能做到:

1. 说清状态(State)、节点(node)、边(edge)各是什么,以及一次 `invoke` 里数据是怎么在它们之间流动的。
2. 对着六步骨架写出 `part05/lg/s01_one_node.py` 并跑通,指着每一行说出它属于第几步。
3. 说出节点的返回值是怎么合并进状态的,并知道返回 `None`、返回不存在的键、原地修改 `state` 各自会发生什么。
4. 认出建图时的报错和运行时的报错各长什么样,知道哪些写错了**不会**报错。

预计用时 2 小时。今天不调模型,花费 ¥0。前置:[Day 298](/blog/agent-zero/day-298-langchain-vs-langgraph/)(`langgraph` 已经随 `langchain` 装好)、[Day 47](/blog/agent-zero/day-047-type-hints-3/)(`TypedDict`)、[Day 24](/blog/agent-zero/day-024-dicts/)(字典)、[Day 28](/blog/agent-zero/day-028-functions-1/)(函数的参数和返回值)、[Day 32](/blog/agent-zero/day-032-modules/)(`if __name__ == "__main__"`)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `s01_one_node.py` 的六步,再说出每一步对应 JS 里的什么;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

所有命令在 `agent-zero-lab/` 根目录跑(我的是 `/Users/你/agent-zero-lab`)。先重置业务库,再确认 LangGraph 在:

```bash
cd /Users/你/agent-zero-lab
uv run python cloudledger/seed.py
uv run python -c "import importlib.metadata as m; print('langgraph', m.version('langgraph'))"
mkdir -p part05/lg
```

<div class="line-notes">

- `uv run python cloudledger/seed.py` 删库重建,输出 `已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}`。今天的真数据是里面的 41 张工单。
- `uv run python -c "import importlib.metadata as m; print('langgraph', m.version('langgraph'))"` 用标准库读已安装包的版本号,和 [Day 298](/blog/agent-zero/day-298-langchain-vs-langgraph/) 查依赖是同一套工具。我这里输出 `langgraph 1.2.16`,你装到的更新也行,今天用到的接口在 1.x 里是稳定的。
- `mkdir -p part05/lg` 昨天建过的话什么也不会发生(`-p` 的意思是已经存在就不报错)。

</div>

## 先不用图:一个普通函数

先把今天要做的事用你已经会的东西写一遍。任务很小:拿到一句客户的话,判断它是不是账单问题。

```python
# agent-zero-lab/part05/lg/s00_plain.py
"""先不用图:一个普通函数给工单分类。用法:uv run python -m part05.lg.s00_plain"""


def classify(ticket: str) -> str:
    return "billing" if "发票" in ticket else "other"


ticket = "上个月的发票开错了"
category = classify(ticket)
state = {"ticket": ticket, "category": category}
print("最终状态:", state)
```

<div class="line-notes">

- `def classify(ticket: str) -> str:` 一个普通函数,收一个字符串,返回一个字符串。相当于 JS 里的 `const classify = (ticket) => ...`。
- `return "billing" if "发票" in ticket else "other"` 条件表达式,相当于 JS 的 `ticket.includes("发票") ? "billing" : "other"`。代入 `"上个月的发票开错了"`:`"发票"` 在里面,所以返回 `"billing"`。
- `ticket = "上个月的发票开错了"` 一条工单的原文。
- `category = classify(ticket)` 调用函数,`category` 得到 `"billing"`。
- `state = {"ticket": ticket, "category": category}` 手工把「到目前为止知道的所有事」装进一个字典。注意这一行是**我们自己写的**:谁来保管这份数据、什么时候更新它,全靠自己记着。
- `print("最终状态:", state)` 打印出来。

</div>

```bash
uv run python -m part05.lg.s00_plain
```

```text
最终状态: {'ticket': '上个月的发票开错了', 'category': 'billing'}
```

这段代码里有两件事是你手工做的:一是把中间结果攒进 `state` 这个字典,二是决定函数按什么顺序调。只有一个函数的时候这两件事轻得看不见。真实的客服流程是「分类 → 查客户 → 查发票 → 起草回复 → 检查」,每一步都要读前面几步的结果、写下自己的结果,有的还要看结果决定走哪一步。LangGraph 想接管的就是这两件事:**状态由框架保管,步骤的顺序画成一张图**。

说句实话,只有一个节点的图比上面这个普通函数没有任何优势,下面还会实测它慢了多少。今天写它不是因为它有用,是因为它是最小的骨架,每个零件只出现一次,看得清。

## 三个零件

LangGraph 里的图由三样东西组成,先各给一个 JS 里的对应物:

| 零件 | 是什么 | JS/TS 里最像的东西 |
| --- | --- | --- |
| 状态(State) | 整张图共享的一份数据,写清楚有哪些字段 | 一个 TS `interface`,运行时是一个对象 |
| 节点(node) | 一个函数:收到当前状态,返回「我要改哪些字段」 | `(state) => Partial<State>`,像 Redux 里只返回变化部分的处理函数 |
| 边(edge) | 一个节点跑完以后去哪 | 路由表里的一条规则 |

最容易想错的是节点的返回值。**节点返回的不是新的完整状态,而是一份更新**,框架负责把更新合并进状态。如果你写过 React 的 `setState({ category: "billing" })`,或者 JS 里的 `state = { ...state, ...update }`,就是这个意思:只写你改的那几个键,没写的键原样保留。默认的合并规则就是「同名的键,新值盖掉旧值」;后面几天会讲怎么改这条规则(reducer),今天只用默认的。

还有两个特殊的节点名,`START` 是图的入口,`END` 是出口。它们不是真的函数,只是两个路标:「从这里进来」「到这里结束」。在代码里它们就是两个字符串常量,`START` 是 `'__start__'`,`END` 是 `'__end__'`,我在本机打印验证过。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="一次 invoke 的数据流:初始状态只有 ticket,经过 START 进入 classify 节点,节点返回只含 category 的更新,框架把更新合并进状态,到 END 时状态里有 ticket 和 category 两个字段">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="90" height="40" rx="20" fill="none" stroke="var(--rule)"/>
<text x="65" y="55" fill="var(--ink-soft)" text-anchor="middle">START</text>
<rect x="260" y="30" width="120" height="40" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="55" fill="var(--ink)" text-anchor="middle">classify</text>
<rect x="530" y="30" width="90" height="40" rx="20" fill="none" stroke="var(--rule)"/>
<text x="575" y="55" fill="var(--ink-soft)" text-anchor="middle">END</text>
<line x1="110" y1="50" x2="260" y2="50" stroke="var(--ink-soft)"/>
<polygon points="260,50 252,46 252,54" fill="var(--ink-soft)"/>
<line x1="380" y1="50" x2="530" y2="50" stroke="var(--ink-soft)"/>
<polygon points="530,50 522,46 522,54" fill="var(--ink-soft)"/>
<rect x="20" y="130" width="190" height="86" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="115" y="150" fill="var(--ink-soft)" text-anchor="middle" font-size="11">进图时的状态</text>
<text x="32" y="174" fill="var(--ink)" font-size="11">ticket: "上个月的发票…"</text>
<text x="32" y="194" fill="var(--ink-faint)" font-size="11">category: (还没有)</text>
<rect x="225" y="130" width="190" height="86" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="150" fill="var(--ink-soft)" text-anchor="middle" font-size="11">节点返回的更新</text>
<text x="237" y="184" fill="var(--ink)" font-size="11">category: "billing"</text>
<text x="237" y="203" fill="var(--ink-faint)" font-size="11">(只写改了的键)</text>
<rect x="430" y="130" width="190" height="86" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="525" y="150" fill="var(--ink-soft)" text-anchor="middle" font-size="11">出图时的状态</text>
<text x="442" y="174" fill="var(--ink)" font-size="11">ticket: "上个月的发票…"</text>
<text x="442" y="194" fill="var(--ink)" font-size="11">category: "billing"</text>
<line x1="65" y1="70" x2="115" y2="130" stroke="var(--rule)" stroke-dasharray="4 3"/>
<line x1="320" y1="70" x2="320" y2="130" stroke="var(--rule)" stroke-dasharray="4 3"/>
<line x1="575" y1="70" x2="525" y2="130" stroke="var(--rule)" stroke-dasharray="4 3"/>
<line x1="210" y1="173" x2="225" y2="173" stroke="var(--ink-soft)"/>
<line x1="415" y1="173" x2="430" y2="173" stroke="var(--ink-soft)"/>
<text x="320" y="240" fill="var(--ink-faint)" text-anchor="middle" font-size="11">上排是步骤的顺序(边),下排是同一时刻的数据(状态)</text>
</g>
</svg>
<figcaption>一次 <code>invoke</code> 里发生的事。上排是跑的顺序,下排是数据:节点只交出「我改了什么」,框架把它并进状态。</figcaption>
</figure>

## 六步骨架

不管图多复杂,写法都是这六步。先看图,再看代码:

<figure>
<svg viewBox="0 0 640 170" role="img" aria-label="六步骨架:第一步定义 State,第二步 StateGraph(State) 建图纸,第三步 add_node 登记节点,第四步 add_edge 连边,这四步属于图纸阶段;第五步 compile 编译,第六步 invoke 调用,这两步属于运行阶段">
<rect x="0" y="0" width="640" height="170" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="14" y="22" fill="var(--ink-soft)" font-size="11">图纸阶段:还不能跑,可以随便改</text>
<text x="438" y="22" fill="var(--ink-soft)" font-size="11">运行阶段</text>
<rect x="14" y="34" width="92" height="64" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="60" y="56" fill="var(--ink)" text-anchor="middle">① 状态</text>
<text x="60" y="78" fill="var(--ink-soft)" text-anchor="middle" font-size="11">class State</text>
<rect x="120" y="34" width="92" height="64" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="166" y="56" fill="var(--ink)" text-anchor="middle">② 图纸</text>
<text x="166" y="78" fill="var(--ink-soft)" text-anchor="middle" font-size="11">StateGraph</text>
<rect x="226" y="34" width="92" height="64" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="272" y="56" fill="var(--ink)" text-anchor="middle">③ 节点</text>
<text x="272" y="78" fill="var(--ink-soft)" text-anchor="middle" font-size="11">add_node</text>
<rect x="332" y="34" width="92" height="64" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="378" y="56" fill="var(--ink)" text-anchor="middle">④ 边</text>
<text x="378" y="78" fill="var(--ink-soft)" text-anchor="middle" font-size="11">add_edge</text>
<rect x="438" y="34" width="92" height="64" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="484" y="56" fill="var(--ink)" text-anchor="middle">⑤ 编译</text>
<text x="484" y="78" fill="var(--ink-soft)" text-anchor="middle" font-size="11">compile()</text>
<rect x="544" y="34" width="82" height="64" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="585" y="56" fill="var(--ink)" text-anchor="middle">⑥ 调用</text>
<text x="585" y="78" fill="var(--ink-soft)" text-anchor="middle" font-size="11">invoke()</text>
<line x1="106" y1="66" x2="120" y2="66" stroke="var(--ink-soft)"/>
<line x1="212" y1="66" x2="226" y2="66" stroke="var(--ink-soft)"/>
<line x1="318" y1="66" x2="332" y2="66" stroke="var(--ink-soft)"/>
<line x1="424" y1="66" x2="438" y2="66" stroke="var(--ink-soft)"/>
<line x1="530" y1="66" x2="544" y2="66" stroke="var(--ink-soft)"/>
<text x="14" y="130" fill="var(--ink-soft)" font-size="11">类比 JS:前四步像一路 app.use / app.get 把路由登记在 Express 的 app 上,</text>
<text x="14" y="148" fill="var(--ink-soft)" font-size="11">compile() 像检查完配置、交出一个能跑的东西,invoke() 才是真的请求进来。</text>
</g>
</svg>
<figcaption>前四步都在改「图纸」(<code>builder</code>),第五步才得到能执行的图,第六步才真的跑。顺序固定,少一步要么报错,要么跑不起来。</figcaption>
</figure>

```python
# agent-zero-lab/part05/lg/s01_one_node.py
"""只有一个节点的图:六步骨架。用法:uv run python -m part05.lg.s01_one_node"""
from typing import NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph


# 第 1 步:定义状态。整张图共享的一张"表单",写清楚有哪些字段
class State(TypedDict):
    ticket: str
    category: NotRequired[str]  # 开头还没有,等节点算出来再写进去


# 节点:一个普通函数,收到当前状态,返回"我要改哪些字段"
def classify(state: State) -> dict:
    print("classify 收到:", state)
    text = state["ticket"]
    return {"category": "billing" if "发票" in text else "other"}


builder = StateGraph(State)  # 第 2 步:建图纸,告诉它状态长什么样
builder.add_node("classify", classify)  # 第 3 步:登记节点,起名叫 "classify"
builder.add_edge(START, "classify")  # 第 4 步:连边,入口 → classify
builder.add_edge("classify", END)  # 第 4 步:连边,classify → 出口
graph = builder.compile()  # 第 5 步:编译成能跑的图

if __name__ == "__main__":
    result = graph.invoke({"ticket": "上个月的发票开错了"})  # 第 6 步:调用,传入初始状态
    print("最终状态:", result)
```

<div class="line-notes">

- `from typing import NotRequired, TypedDict` 两个都是标准库 `typing` 里的类型工具。`TypedDict` 用来描述「一个字典有哪些键、每个键是什么类型」,`NotRequired` 标记「这个键可以不存在」,Python 3.11 起自带。
- `from langgraph.graph import END, START, StateGraph` 今天要用的三样:出口路标、入口路标、建图纸的类。
- `class State(TypedDict):` 状态的定义。`TypedDict` 只是类型提示,运行时 `State` 的实例就是一个普通字典,不会检查类型(下面会实测)。相当于 TS 里的 `interface State`。
- `ticket: str` 第一个字段:工单原文。必填,所以调用时必须给。
- `category: NotRequired[str]  # 开头还没有,等节点算出来再写进去` 第二个字段:分类结果。**为什么要 `NotRequired`**:调用 `invoke` 时我们只会传 `ticket`,`category` 是节点算出来的。不标的话,编辑器会指着 `graph.invoke({"ticket": ...})` 报红线,说少了 `category`。相当于 TS 的 `category?: string`。
- `def classify(state: State) -> dict:` 节点函数。参数 `state` 是当前状态,返回值是「更新」,是一个字典。
- `print("classify 收到:", state)` 把节点收到的东西打出来。输出是 `{'ticket': '上个月的发票开错了'}`,注意**没有 `category`**:没传过的字段,一开始就不存在。
- `text = state["ticket"]` 用方括号取字段,取到 `"上个月的发票开错了"`。
- `return {"category": "billing" if "发票" in text else "other"}` 只返回 `category` 一个键。代入:`"发票"` 在 `text` 里,所以返回 `{"category": "billing"}`。`ticket` 我们没提,框架会原样保留。
- `builder = StateGraph(State)` 第 2 步,建一份图纸。把 `State` 交给它,它会读出有 `ticket` 和 `category` 两个字段。此时还不能跑。
- `builder.add_node("classify", classify)` 第 3 步,登记节点:名字叫 `"classify"`,对应的函数是 `classify`。**名字是给边引用的字符串**,不必和函数名相同,但相同最省事。
- `builder.add_edge(START, "classify")` 第 4 步的第一条边:一进图先跑 `"classify"`。
- `builder.add_edge("classify", END)` 第二条边:`"classify"` 跑完就结束。
- `graph = builder.compile()` 第 5 步,编译。会检查图纸能不能成立(比如有没有入口),通过了返回一个能执行的对象。我用 `time.perf_counter()` 量过,这一步不到 1 毫秒。
- `if __name__ == "__main__":` 只有直接运行这个文件时才执行下面两行;被别的文件 `import` 时不执行。后面几个脚本要 `from part05.lg.s01_one_node import graph`,有了这行,导入时就不会重复跑一遍。[Day 32](/blog/agent-zero/day-032-modules/) 讲过。
- `result = graph.invoke({"ticket": "上个月的发票开错了"})  # 第 6 步:调用,传入初始状态` 第 6 步。传进去的字典就是初始状态,跑完整张图,返回最终状态。
- `print("最终状态:", result)` 输出里多了 `category: 'billing'`。

</div>

```bash
uv run python -m part05.lg.s01_one_node
```

```text
classify 收到: {'ticket': '上个月的发票开错了'}
最终状态: {'ticket': '上个月的发票开错了', 'category': 'billing'}
```

把 `invoke` 里发生的事按时间排一遍,就是上面第一张图:

| 时刻 | 谁在跑 | 状态 |
| --- | --- | --- |
| 调用时 | (还没开始) | `{"ticket": "上个月的发票开错了"}` |
| 经过 `START → classify` 这条边 | `classify` 开始执行 | 它收到的就是上面这份,所以打印里没有 `category` |
| `classify` 返回 | 框架合并更新 | `{"ticket": "上个月的发票开错了", "category": "billing"}` |
| 经过 `classify → END` 这条边 | 图结束 | 这份状态作为 `invoke` 的返回值交给你 |

读代码的时候可以反着用这张表:任何一张图,你都能问自己三个问题。这个节点开始时状态长什么样?它返回了什么更新?合并之后状态长什么样?图再复杂,每一步都是这三问。

## 打开编译好的图看一眼

昨天打开过 `create_agent` 返回的图,今天打开自己的。`peek` 脚本只看,不改:

```python
# agent-zero-lab/part05/lg/s01_peek.py
"""打开编译好的图看一眼:它是什么类型、有哪些节点、长什么样,invoke 对传进去的字典做了什么。用法:uv run python -m part05.lg.s01_peek"""
from part05.lg.s01_one_node import State, builder, graph

print("类型:", type(graph).__name__)
print("节点:", list(graph.nodes))
print("状态里的字段:", {name: type(ch).__name__ for name, ch in builder.channels.items()})
print("图里的节点和边:", list(graph.get_graph().nodes), [(e.source, e.target) for e in graph.get_graph().edges])
print(graph.get_graph().draw_mermaid())

init: State = {"ticket": "上个月的发票开错了"}
result = graph.invoke(init)
print("传进去的:", init)
print("返回的  :", result)
print("是同一个字典吗:", result is init)
```

<div class="line-notes">

- `from part05.lg.s01_one_node import State, builder, graph` 从刚才的文件里直接拿三样现成的。因为有 `if __name__` 那一行,导入时不会触发 `invoke`。
- `print("类型:", type(graph).__name__)` 打印类名,输出 `CompiledStateGraph`,和昨天 `create_agent` 返回的是同一个类。
- `print("节点:", list(graph.nodes))` `graph.nodes` 是节点名到节点的映射,取出名字是 `['__start__', 'classify']`。
- `print("状态里的字段:", {name: type(ch).__name__ for name, ch in builder.channels.items()})` 字典推导式([Day 26](/blog/agent-zero/day-026-nested-data/))。`builder.channels` 是图纸里登记的每个状态字段,`type(ch).__name__` 取出它的类名。输出 `{'ticket': 'LastValue', 'category': 'LastValue'}`:`LastValue` 的意思是「只记最后一次写入的值」,正是前面说的默认合并规则。Day 303 讲覆盖、Day 304 讲怎么改这个规则时会回到它。
- `print("图里的节点和边:", list(graph.get_graph().nodes), [(e.source, e.target) for e in graph.get_graph().edges])` `get_graph()` 返回一份能画图的描述。节点有三个(多出一个 `__end__`),边有两条:`('__start__', 'classify')` 和 `('classify', '__end__')`,正好是我们连的两条。
- `print(graph.get_graph().draw_mermaid())` 把图变成 Mermaid 文本(一种用文字画流程图的语法,贴进支持它的文档就能渲染)。
- `init: State = {"ticket": "上个月的发票开错了"}` 把初始状态先存进变量,后面才能对比。标注 `State` 让编辑器知道这个字典合格。
- `result = graph.invoke(init)` 调用。
- `print("传进去的:", init)` 输出还是只有 `ticket`:`invoke` 没有改你传进去的字典。
- `print("返回的  :", result)` 返回的是一个**新字典**,有两个字段。
- `print("是同一个字典吗:", result is init)` `is` 判断是不是同一个对象,输出 `False`。

</div>

```bash
uv run python -m part05.lg.s01_peek
```

```text
类型: CompiledStateGraph
节点: ['__start__', 'classify']
状态里的字段: {'ticket': 'LastValue', 'category': 'LastValue'}
图里的节点和边: ['__start__', 'classify', '__end__'] [('__start__', 'classify'), ('classify', '__end__')]
---
config:
  flowchart:
    curve: linear
---
graph TD;
    __start__([<p>__start__</p>]):::first
    classify(classify)
    __end__([<p>__end__</p>]):::last
    __start__ --> classify;
    classify --> __end__;
    classDef default fill:#f2f0ff,line-height:1.2
    classDef first fill-opacity:0
    classDef last fill:#bfb6fc

classify 收到: {'ticket': '上个月的发票开错了'}
传进去的: {'ticket': '上个月的发票开错了'}
返回的  : {'ticket': '上个月的发票开错了', 'category': 'billing'}
是同一个字典吗: False
```

(Mermaid 文本里的缩进原本是制表符,这里为了显示换成了空格。)

两点值得记。第一,`invoke` 不动你传进去的字典,每次调用状态都是从你给的初始值重新开始,所以同一张编译好的图可以反复 `invoke`,互不干扰。第二,Mermaid 那几行就是图的「源码」形状:`__start__ --> classify --> __end__`。以后图大了,打印这一段贴进能渲染的地方,比在脑子里想清楚快得多。

## 状态和节点出错时是什么样

说了「节点只返回更新」,下面把几种容易写歪的情况一次跑出来看。先说明约定:每一行输出前面是我做了什么,后面是 `invoke` 给我的结果或异常。这个脚本把八种情况放在一起,方便对比:

```python
# agent-zero-lab/part05/lg/s01_runtime_traps.py
"""invoke 时的八种情况:传错类型、少字段、多字段、节点返回各种怪东西。用法:uv run python -m part05.lg.s01_runtime_traps"""
from typing import Any

from langgraph.graph import END, START, StateGraph

from part05.lg.s01_one_node import State, graph


def try_invoke(label: str, g: Any, init: dict) -> None:
    try:
        print(f"{label} →", g.invoke(init))
    except Exception as e:
        print(f"{label} → {type(e).__name__}: {str(e).splitlines()[0]}")


def build(node) -> Any:
    b = StateGraph(State)
    b.add_node("n", node)
    b.add_edge(START, "n")
    b.add_edge("n", END)
    return b.compile()


def returns_unknown_key(state: State) -> dict:
    return {"colour": "red"}


def returns_none(state: State) -> None:
    return None


def returns_str(state: State) -> str:
    return "billing"


def mutates_in_place(state: State) -> None:
    state["category"] = "billing"


try_invoke("传错类型", graph, {"ticket": 123})
try_invoke("少一个字段", graph, {})
try_invoke("多一个字段", graph, {"ticket": "发票", "colour": "red"})
try_invoke("预先填好 category", graph, {"ticket": "你好", "category": "preset"})
try_invoke("返回不存在的键", build(returns_unknown_key), {"ticket": "发票"})
try_invoke("返回 None", build(returns_none), {"ticket": "发票"})
try_invoke("返回字符串", build(returns_str), {"ticket": "发票"})
try_invoke("原地修改 state", build(mutates_in_place), {"ticket": "发票"})
```

<div class="line-notes">

- `from part05.lg.s01_one_node import State, graph` 复用刚才的状态和图。
- `def try_invoke(label: str, g: Any, init: dict) -> None:` 一个小帮手:调用图,成功就打印结果,抛异常就打印「异常类名: 第一行信息」。`Any` 表示不限类型(因为我们故意传各种奇怪的东西)。
- `print(f"{label} →", g.invoke(init))` 成功时的输出。`f"{label} →"` 是 f-string,把 `label` 嵌进字符串([Day 15](/blog/agent-zero/day-015-strings-1/))。
- `print(f"{label} → {type(e).__name__}: {str(e).splitlines()[0]}")` 失败时的输出。`type(e).__name__` 是异常的类名,`str(e).splitlines()[0]` 是错误信息的第一行(LangGraph 的某些错误后面还跟一行「去哪看排查文档」,这里不要)。
- `def build(node) -> Any:` 又一个小帮手:把任何一个函数当作唯一的节点,走同样的六步,返回编译好的图。这样下面每种「怪节点」只要写函数本身。
- `b.add_node("n", node)` 节点名统一叫 `"n"`,不重要。
- `def returns_unknown_key(state: State) -> dict:` 返回一个 `State` 里没有的键 `colour`。
- `def returns_none(state: State) -> None:` 什么也不返回。Python 里不写 `return` 的函数就返回 `None`。
- `def returns_str(state: State) -> str:` 返回字符串,不是字典。
- `def mutates_in_place(state: State) -> None:` 不返回,而是直接往收到的 `state` 里写 `category`。
- `try_invoke("传错类型", graph, {"ticket": 123})` 工单字段传了个整数。节点里 `"发票" in 123` 会炸。
- `try_invoke("少一个字段", graph, {})` 一个字段也不传。
- `try_invoke("多一个字段", graph, {"ticket": "发票", "colour": "red"})` 传了 `State` 里没有的 `colour`。
- `try_invoke("预先填好 category", graph, {"ticket": "你好", "category": "preset"})` 初始状态里就带了 `category`。
- `try_invoke("返回不存在的键", build(returns_unknown_key), {"ticket": "发票"})` 节点返回 `{"colour": "red"}`。
- `try_invoke("原地修改 state", build(mutates_in_place), {"ticket": "发票"})` 最后一种:直接改。

</div>

```bash
uv run python -m part05.lg.s01_runtime_traps
```

```text
classify 收到: {'ticket': 123}
传错类型 → TypeError: argument of type 'int' is not iterable
classify 收到: {}
少一个字段 → KeyError: 'ticket'
classify 收到: {'ticket': '发票'}
多一个字段 → {'ticket': '发票', 'category': 'billing'}
classify 收到: {'ticket': '你好', 'category': 'preset'}
预先填好 category → {'ticket': '你好', 'category': 'other'}
返回不存在的键 → {'ticket': '发票'}
返回 None → {'ticket': '发票'}
返回字符串 → InvalidUpdateError: Expected dict, got billing
原地修改 state → {'ticket': '发票'}
```

逐条读:

1. **传错类型**:`TypedDict` 只是给编辑器看的,运行时不检查。`ticket` 明明声明是 `str`,传整数 `123` 照样进图,直到节点里 `"发票" in 123` 才炸,报错说「`int` 不可迭代」,和图本身没关系。这件事 [Day 51](/blog/agent-zero/day-051-pydantic-1/) 的 pydantic 是能管的,Day 302 会把 State 换成 pydantic 看看。
2. **少一个字段**:`classify 收到: {}`,节点里 `state["ticket"]` 抛 `KeyError`。框架不会提前告诉你「缺 ticket」,是你的代码取字段时才炸。
3. **多一个字段**:`colour` 悄悄不见了,输出里没有它,也没有任何警告。状态里只有 `State` 声明过的字段。
4. **预先填好 `category`**:初始值进得去(`classify 收到` 里能看到 `'category': 'preset'`),但节点返回的新值把它盖掉了,最后是 `'other'`。这就是默认的「新值盖旧值」。
5. **返回不存在的键**:这是今天要你记住的一条。节点返回 `{"colour": "red"}`,**没有报错**,最终状态里也没有 `colour`,这次更新被整个丢了。你要是把 `category` 打成 `catagory`,会得到一个看起来一切正常、却缺了分类的结果。
6. **返回 `None`**:合法,等于「我没有要改的」。状态原样往下走。
7. **返回字符串**:报 `InvalidUpdateError: Expected dict, got billing`。节点的返回值必须是字典(或者后面几天讲的几种特殊值),这一条是框架拦得住的。
8. **原地修改 `state`**:`state["category"] = "billing"` 之后什么也不返回,最终状态里**没有** `category`。节点收到的 `state` 是框架给的一份视图,改它不算数,只有「返回」才算。写过 React 的人对这一条应该不陌生,和「直接改 `state` 不会触发更新」是同一种坑。

第 5 和第 8 条都是悄悄出错,没有异常。写节点时养成一个习惯:返回的键名从 `State` 里复制,别手打;跑完用 `print` 看一眼最终状态。

Zed 里其实能提前看到一部分:`State` 是 `TypedDict`,你写 `state["tickets"]`(键名拼错)编辑器会画红线;但**返回值**是个裸字典,键名对不对编辑器看不出来(上面第 5 条)。这是 Day 302 讲 State 三种写法时要比的一个点。

## 建图时的报错

上面是 `invoke` 时的事。图纸阶段(前四步)和 `compile()` 也会报错,而且有一个我实测之前想错了的地方:

```python
# agent-zero-lab/part05/lg/s01_compile_traps.py
"""建图时的四种错:忘了入口、边指向不存在的节点、节点重名、没连出口。用法:uv run python -m part05.lg.s01_compile_traps"""
from langgraph.graph import END, START, StateGraph

from part05.lg.s01_one_node import State, classify


def attempt(label: str, wire) -> None:
    builder = StateGraph(State)
    try:
        wire(builder)
        graph = builder.compile()
    except Exception as e:
        print(f"{label} → {type(e).__name__}: {e}")
        return
    print(f"{label} → 编译通过,invoke 结果:", graph.invoke({"ticket": "发票抬头写错了"}))


def no_start(b: StateGraph) -> None:
    b.add_node("classify", classify)
    b.add_edge("classify", END)


def ghost_node(b: StateGraph) -> None:
    b.add_node("classify", classify)
    b.add_edge(START, "classify")
    b.add_edge("classify", "nowhere")


def duplicate(b: StateGraph) -> None:
    b.add_node("classify", classify)
    b.add_node("classify", classify)


def no_end(b: StateGraph) -> None:
    b.add_node("classify", classify)
    b.add_edge(START, "classify")


attempt("没连入口", no_start)
attempt("边指向幽灵", ghost_node)
attempt("节点重名", duplicate)
attempt("没连出口", no_end)
```

<div class="line-notes">

- `def attempt(label: str, wire) -> None:` 一个小帮手:新建一份图纸,交给 `wire`(一个会往图纸上连线的函数)去连,然后 `compile()`。函数当参数传是 [Day 30](/blog/agent-zero/day-030-functions-3/) 的内容,和 JS 里传回调一回事。
- `wire(builder)` 把图纸交给传进来的函数去连线。
- `graph = builder.compile()` 编译也放在 `try` 里,因为有的错要到这一步才暴露。
- `print(f"{label} → {type(e).__name__}: {e}")` 出错时打印异常类名和完整信息。
- `print(f"{label} → 编译通过,invoke 结果:", graph.invoke({"ticket": "发票抬头写错了"}))` 没出错时顺便跑一次,看结果对不对。这一行是为了最后一种情况准备的。
- `def no_start(b: StateGraph) -> None:` 第一种:只有 `classify → END`,忘了从 `START` 连进来。
- `b.add_edge("classify", "nowhere")` 第二种:边指向一个从没登记过的节点名 `"nowhere"`。
- `b.add_node("classify", classify)` 第三种里连登记了两次同名节点。
- `def no_end(b: StateGraph) -> None:` 第四种:只有 `START → classify`,没有连 `END`。

</div>

```bash
uv run python -m part05.lg.s01_compile_traps
```

```text
没连入口 → ValueError: Graph must have an entrypoint: add at least one edge from START to another node
边指向幽灵 → ValueError: Found edge ending at unknown node `nowhere`
节点重名 → ValueError: Node `classify` already present.
classify 收到: {'ticket': '发票抬头写错了'}
没连出口 → 编译通过,invoke 结果: {'ticket': '发票抬头写错了', 'category': 'billing'}
```

前三种都是预期中的报错,而且信息写得很直白,看一眼就知道缺什么。

**第四种我没想到。** 我原以为「节点没有出路」会在 `compile()` 时报错,实测不会:只连了 `START → classify`、没连 `END`,编译通过,`invoke` 也正常返回,和连了 `END` 的结果一模一样。道理是,一个节点后面没有任何边,框架就当作「跑到这儿就结束」。旧教程里有写「少了这条边 `compile` 会报错」的,放到 langgraph 1.2.16 上不成立。

所以这条要不要连 `END`?我的做法是**一律连上**。今天这张图没区别,但等图里有了分支,「这条路到哪结束」不写清楚,读图的人(包括三个月后的你)得去猜;Mermaid 图上也会少一个箭头。多一行代码买清晰,值。

## 用真数据过一遍

前面的句子都是我编的。CloudLedger 的业务库里有 41 张真工单,下面让这张单节点图把它们都分一遍类。规则放在一张表里,按顺序匹配,先命中的算数:

```python
# agent-zero-lab/part05/lg/s01_tickets.py
"""把单节点图用到真数据上:41 张工单过一遍,和普通函数对账,再量一下开销。用法:uv run python -m part05.lg.s01_tickets"""
import sqlite3
import time
from collections import Counter
from pathlib import Path
from typing import NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph

DB = Path(__file__).resolve().parents[2] / "cloudledger" / "cloudledger.db"

# 规则表:按顺序匹配,先命中的算数。关键词来自业务同事的口述
RULES: list[tuple[str, tuple[str, ...]]] = [
    ("billing", ("发票", "扣", "退款")),
    ("subscription", ("套餐", "订阅", "席位")),
    ("technical", ("报错", "ERR_")),
    ("account", ("登录", "验证码")),
]


def classify_text(text: str) -> str:
    for category, words in RULES:
        if any(w in text for w in words):
            return category
    return "other"


class State(TypedDict):
    ticket: str
    category: NotRequired[str]


def classify(state: State) -> dict:
    return {"category": classify_text(state["ticket"])}


builder = StateGraph(State)
builder.add_node("classify", classify)
builder.add_edge(START, "classify")
builder.add_edge("classify", END)
graph = builder.compile()


def load_tickets() -> list[tuple[str, str]]:
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    try:
        return conn.execute("SELECT id, subject || ':' || body FROM tickets ORDER BY id").fetchall()
    finally:
        conn.close()


if __name__ == "__main__":
    tickets = load_tickets()
    print(f"读到 {len(tickets)} 张工单,第一张:{tickets[0]}")

    # 一张一张过图:graph 编译一次,invoke 调 41 次
    start = time.perf_counter()
    results = [graph.invoke({"ticket": text}) for _, text in tickets]
    graph_ms = (time.perf_counter() - start) * 1000

    start = time.perf_counter()
    plain = [classify_text(text) for _, text in tickets]
    plain_ms = (time.perf_counter() - start) * 1000

    counts = Counter(r["category"] for r in results)
    print("按类别计数:", dict(counts))
    print("和普通函数结果一致:", [r["category"] for r in results] == plain)
    print(f"41 次 invoke 共 {graph_ms:.0f} 毫秒(每次 {graph_ms / 41:.1f}),普通函数共 {plain_ms:.3f} 毫秒")
    print("T1007 的最终状态:", results[6])
```

<div class="line-notes">

- `DB = Path(__file__).resolve().parents[2] / "cloudledger" / "cloudledger.db"` 业务库路径。文件在 `part05/lg/` 下,`parents[2]` 是仓库根,和昨天 `billing_tools.py` 的写法一样([Day 37](/blog/agent-zero/day-037-pathlib/))。
- `RULES: list[tuple[str, tuple[str, ...]]] = [` 规则表:一个列表,每项是(类别名, 关键词元组)。类型标注读作「列表,里面是元组,元组里一个字符串加一个若干字符串的元组」。
- `("billing", ("发票", "扣", "退款")),` 第一条:出现「发票」「扣」「退款」任何一个就算账单类。**顺序有意义**:「重复扣款」同时不含别的类的词,没问题;但如果一张工单既提退款又提登录,会先算账单。
- `def classify_text(text: str) -> str:` 纯函数,不碰图,只做判断。把判断逻辑和「怎么放进图」分开,后面既能给图用,也能给普通调用用,还方便单独写测试。
- `for category, words in RULES:` 依次取出每条规则,同时拆开成类别名和关键词。
- `if any(w in text for w in words):` `any(...)` 是「有一个为真就为真」,里面是生成器表达式,等价于 JS 的 `words.some(w => text.includes(w))`。
- `return "other"` 四条规则都没命中的兜底。
- `class State(TypedDict):` 和 `s01_one_node.py` 里同一份定义,这里重写一遍,为的是这个文件自己能跑。
- `def classify(state: State) -> dict:` 节点只剩一行:调 `classify_text`,把结果放进 `category` 返回。
- `graph = builder.compile()` 同样的六步。**编译只做一次**,下面调 41 次 `invoke`。
- `conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)` 只读打开业务库([Day 92](/blog/agent-zero/day-092-python-sqlite-1/))。今天只读不写。
- `"SELECT id, subject || ':' || body FROM tickets ORDER BY id"` `||` 是 SQLite 的字符串拼接,把主题和正文拼成一段。`ORDER BY id` 让顺序固定。返回 `[(工单号, 文本), ...]`。
- `finally:` 不管查询成功还是出错,都要关连接。
- `print(f"读到 {len(tickets)} 张工单,第一张:{tickets[0]}")` 读到 41 张。第一张是 `T1001`,主题「导出报表报错」。
- `results = [graph.invoke({"ticket": text}) for _, text in tickets]` 列表推导式([Day 23](/blog/agent-zero/day-023-comprehensions/)):对每张工单调一次 `invoke`。`for _, text in tickets` 把元组拆开,`_` 表示工单号这里用不上。
- `counts = Counter(r["category"] for r in results)` `Counter` 数每个类别出现几次([Day 24](/blog/agent-zero/day-024-dicts/) 的「按类别计数」就是它的手写版)。
- `print("和普通函数结果一致:", [r["category"] for r in results] == plain)` 两个列表逐项相等才是 `True`。这是对账:图只是换了个跑法,分类结果不该变。
- `print("T1007 的最终状态:", results[6])` 第 7 张(下标 6)是 `T1007`,一张申请退款的工单。

</div>

```bash
uv run python -m part05.lg.s01_tickets
```

```text
读到 41 张工单,第一张:('T1001', '导出报表报错:导出年度报表的时候一直提示 ERR_EXPORT_TIMEOUT,换了浏览器也一样。')
按类别计数: {'technical': 6, 'subscription': 8, 'billing': 18, 'account': 9}
和普通函数结果一致: True
41 次 invoke 共 104 毫秒(每次 2.5),普通函数共 0.177 毫秒
T1007 的最终状态: {'ticket': '申请退款:我们公司下个月起不再使用云簿了,年付还剩几个月,想问能不能退剩下的钱?发票号 INV-2026-0116。', 'category': 'billing'}
```

对一下账:41 张分成 18 + 8 + 6 + 9,加起来 41。账单类 18 张是「重复扣款」8 + 「申请退款」5 + 「发票抬头修改」5;订阅类 8 张是「升级套餐」4 + 「取消订阅」3 + 「席位数量不对」1;技术类 6 张是「导出报表报错」;账号类 9 张是「登录不了」。和我在 SQL 里按 `subject` 分组数出来的一样(重复扣款 8、登录不了 9、导出报表报错 6、申请退款 5、发票抬头修改 5、升级套餐 4、取消订阅 3、席位数量不对 1)。

最后一行的时间要看清:41 次 `invoke` 花了 104 毫秒,平均每次 2.5 毫秒;同样的事用普通函数,总共 0.177 毫秒,差了几百倍。这是我这台 2019 款 MacBook Pro 上跑的数字,多跑几次在每次 1.8 到 5 毫秒之间晃,你的机器会不一样,但量级相同。框架每次 `invoke` 要建运行环境、调度节点、合并状态,这些都有成本。

这笔开销要不要在意?对今天的单节点图来说,是白白多付的。但图里的节点一旦换成「调一次模型」,一次要几百毫秒到几秒,2.5 毫秒就淹没在里面看不见了。所以别拿一个纯规则判断的节点去评价框架快不快,也别因为这个数字就放弃用图。它只是提醒你:图是为了管流程,不是为了加速。

## 零件 → 大代码对照表

| 零件 | 在哪个脚本 | 对应六步 |
| --- | --- | --- |
| 普通函数写法,手工攒 `state` | `s00_plain.py` | 没有步骤,对照用 |
| `State`、`classify`、`builder`、`graph` | `s01_one_node.py` | 第 1–5 步,最后的 `invoke` 是第 6 步 |
| 看图的类型、节点、字段、Mermaid | `s01_peek.py` | 打开第 5 步的产物 |
| 八种 `invoke` 情况 | `s01_runtime_traps.py` | 第 6 步会出的事 |
| 四种建图错误 | `s01_compile_traps.py` | 第 2–5 步会出的事 |
| 41 张真工单 | `s01_tickets.py` | 同样六步,多了规则表和对账 |

## 动手练习

**练习 1:状态里再加一个字段。** 在 `s01_tickets.py` 的基础上,给 `State` 加一个 `urgent` 字段(布尔值):工单里出现「急」「马上」「立刻」任何一个就是 `True`。让**同一个节点**同时返回 `category` 和 `urgent`,对 41 张工单跑一遍,说出有几张是紧急的,并打印第一张紧急工单的完整最终状态。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex299_urgent.py
"""练习 1:状态里再加一个字段 urgent,一个节点同时写两个字段。用法:uv run python -m part05.lg.ex299_urgent"""
from typing import NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph

from part05.lg.s01_tickets import classify_text, load_tickets

URGENT_WORDS = ("急", "马上", "立刻")


class State(TypedDict):
    ticket: str
    category: NotRequired[str]
    urgent: NotRequired[bool]


def classify(state: State) -> dict:
    text = state["ticket"]
    return {
        "category": classify_text(text),
        "urgent": any(w in text for w in URGENT_WORDS),
    }


builder = StateGraph(State)
builder.add_node("classify", classify)
builder.add_edge(START, "classify")
builder.add_edge("classify", END)
graph = builder.compile()

if __name__ == "__main__":
    tickets = load_tickets()
    results = [(tid, graph.invoke({"ticket": text})) for tid, text in tickets]
    urgent = [(tid, r["category"]) for tid, r in results if r["urgent"]]
    print(f"共 {len(results)} 张,urgent 为 True 的有 {len(urgent)} 张")
    print("前三张:", urgent[:3])
    print("第一张 urgent 工单的完整状态:", next(r for _, r in results if r["urgent"]))
```

<div class="line-notes">

- `from part05.lg.s01_tickets import classify_text, load_tickets` 直接复用上面写好的分类函数和读库函数,不重写。因为 `s01_tickets.py` 有 `if __name__` 保护,导入不会重复跑一遍 41 张工单。
- `URGENT_WORDS = ("急", "马上", "立刻")` 三个关键词放在模块顶部,改规则只改这一处。
- `urgent: NotRequired[bool]` 新字段,和 `category` 一样由节点算出来,所以也标 `NotRequired`。
- `text = state["ticket"]` 取出原文,后面两次用到。
- `"category": classify_text(text),` 一个节点返回的字典里放两个键。框架把两个键各自合并进状态,互不影响。
- `"urgent": any(w in text for w in URGENT_WORDS),` 有一个关键词出现就是 `True`,否则 `False`。代入 `T1012`「登录不了:……已经试了五六次了,急!」,里面有「急」,所以是 `True`。
- `results = [(tid, graph.invoke({"ticket": text})) for tid, text in tickets]` 这次把工单号一起留着,方便后面打印是哪几张。每项是 `(工单号, 最终状态)`。
- `urgent = [(tid, r["category"]) for tid, r in results if r["urgent"]]` 推导式里的 `if` 过滤:只留 `urgent` 为真的,每项取工单号和类别。
- `print("前三张:", urgent[:3])` 切片取前三个([Day 21](/blog/agent-zero/day-021-lists/))。
- `next(r for _, r in results if r["urgent"])` `next(...)` 取生成器的第一个元素,也就是第一张紧急工单的完整最终状态。

</div>

```bash
uv run python -m part05.lg.ex299_urgent
```

```text
共 41 张,urgent 为 True 的有 9 张
前三张: [('T1012', 'account'), ('T1013', 'account'), ('T1015', 'account')]
第一张 urgent 工单的完整状态: {'ticket': '登录不了:收到的验证码一直提示过期,已经试了五六次了,急!', 'category': 'account', 'urgent': True}
```

9 张紧急的,全是「登录不了」那一类(9 张登录工单正文里都带「急」),和前面数出来的 `account: 9` 对得上。完整状态里三个字段都在:`ticket` 是初始的,`category` 和 `urgent` 是同一个节点一次写进去的。

</details>

**练习 2:节点把结果交出去的四种写法,哪几种有效?** 写四个节点,都想把 `category` 设成 `"billing"`:A 返回 `{"category": "billing"}`;B 不返回,直接改 `state["category"]`;C 返回 `{**state, "category": "billing"}`(把整个状态展开再覆盖一个键);D 先 `state.copy()`,改副本,返回副本。先写下你的预测,再实跑核对。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex299_return_styles.py
"""练习 2:节点把结果交出去的四种写法,哪几种真的写进了最终状态。用法:uv run python -m part05.lg.ex299_return_styles"""
from typing import Any

from langgraph.graph import END, START, StateGraph

from part05.lg.s01_one_node import State


def a_return_update(state: State) -> dict:
    return {"category": "billing"}


def b_mutate_state(state: State) -> None:
    state["category"] = "billing"


def c_return_whole(state: State) -> dict:
    return {**state, "category": "billing"}


def d_return_copy_mutated(state: State) -> State:
    new = state.copy()
    new["category"] = "billing"
    return new


def run(node: Any) -> dict:
    b = StateGraph(State)
    b.add_node("n", node)
    b.add_edge(START, "n")
    b.add_edge("n", END)
    return b.compile().invoke({"ticket": "发票抬头写错了"})


for fn in (a_return_update, b_mutate_state, c_return_whole, d_return_copy_mutated):
    print(f"{fn.__name__}: {run(fn)}")
```

<div class="line-notes">

- `def a_return_update(state: State) -> dict:` A:只返回要改的键,标准写法。
- `def b_mutate_state(state: State) -> None:` B:原地改,不返回。上面 `s01_runtime_traps` 的第 8 条已经见过结果,这里放进来对照。
- `return {**state, "category": "billing"}` C:`{**state, ...}` 是字典展开,等价于 JS 的 `{ ...state, category: "billing" }`。代入 `state = {"ticket": "发票抬头写错了"}`,展开得到 `{"ticket": "发票抬头写错了"}`,再加上 `category`,返回含两个键的字典。
- `def d_return_copy_mutated(state: State) -> State:` D:返回类型标 `State`,因为 `state.copy()` 得到的还是 `State`。
- `new = state.copy()` 复制一份(浅拷贝),改它不会动原来那份。
- `new["category"] = "billing"` 改的是副本。
- `return new` 把改过的副本整个返回。
- `def run(node: Any) -> dict:` 和前面一样的小帮手:把一个函数当唯一的节点,走六步,调一次。
- `return b.compile().invoke({"ticket": "发票抬头写错了"})` 编译和调用写在一行里,直接返回最终状态。
- `for fn in (a_return_update, b_mutate_state, c_return_whole, d_return_copy_mutated):` 把四个函数依次放进去跑。函数也是对象,可以放进元组遍历。
- `print(f"{fn.__name__}: {run(fn)}")` `fn.__name__` 是函数名字符串,输出时当标签用。

</div>

```bash
uv run python -m part05.lg.ex299_return_styles
```

```text
a_return_update: {'ticket': '发票抬头写错了', 'category': 'billing'}
b_mutate_state: {'ticket': '发票抬头写错了'}
c_return_whole: {'ticket': '发票抬头写错了', 'category': 'billing'}
d_return_copy_mutated: {'ticket': '发票抬头写错了', 'category': 'billing'}
```

A、C、D 有效,B 无效。C 和 D 把整个状态返回,框架把它当作「这些键都更新成这个值」,`ticket` 被覆盖成了和原来一样的值,所以看不出区别。**今天能这么写是因为用的是默认的覆盖规则**;等到明后天讲 reducer、给某个字段配了「追加」的规则以后,返回整个状态会让那个字段把旧值又追加一遍,出现重复。所以养成 A 的习惯:只返回自己改的键。

</details>

**练习 3:把 Day 296 的格式检查器包成单节点图。** `part05/skills/skill_check.py` 里有 `check(skill_dir: Path) -> list[str]`,返回问题列表,空列表是通过。写一张单节点图:状态有 `skill_dir`(输入)、`problems`(问题列表)、`verdict`(一句话结论,「通过」或「有 N 个问题」)。对 `.claude/skills/refund-policy`、`.claude/skills/invoice-title-change` 和一个不存在的目录 `.claude/skills/not-exist` 各跑一次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex299_skill_node.py
"""练习 3:把 Day 296 的 skill_check.check 包成单节点图。用法:uv run python -m part05.lg.ex299_skill_node"""
from pathlib import Path
from typing import NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph

from part05.skills.skill_check import check


class State(TypedDict):
    skill_dir: str
    problems: NotRequired[list[str]]
    verdict: NotRequired[str]


def audit(state: State) -> dict:
    problems = check(Path(state["skill_dir"]))
    return {"problems": problems, "verdict": "通过" if not problems else f"有 {len(problems)} 个问题"}


builder = StateGraph(State)
builder.add_node("audit", audit)
builder.add_edge(START, "audit")
builder.add_edge("audit", END)
graph = builder.compile()

if __name__ == "__main__":
    for d in (".claude/skills/refund-policy", ".claude/skills/invoice-title-change", ".claude/skills/not-exist"):
        out = graph.invoke({"skill_dir": d})
        print(d, "→", out["verdict"], out["problems"])
```

<div class="line-notes">

- `from part05.skills.skill_check import check` Day 296 写的检查器。它是个普通函数,不知道图的存在,我们只是在外面套一层。
- `skill_dir: str` 输入字段用字符串,不用 `Path`:状态里放简单类型,打印和以后存档都方便。进节点后再转成 `Path`。
- `problems: NotRequired[list[str]]` 节点算出来的问题列表。
- `def audit(state: State) -> dict:` 节点函数,名字换成 `audit`,表示它做的事,而不是「classify」。
- `problems = check(Path(state["skill_dir"]))` 取出目录字符串,转成 `Path`,交给 `check`。对不存在的目录,`check` 会先找 `SKILL.md`,找不到就返回 `["缺少 SKILL.md"]`。
- `return {"problems": problems, "verdict": "通过" if not problems else f"有 {len(problems)} 个问题"}` 同一个节点写两个字段。空列表在条件里是假,所以 `not problems` 为真时就是「通过」。
- `builder.add_node("audit", audit)` 节点名也换成 `"audit"`,第 4 步的两条边里的名字要一起换。
- `for d in (".claude/skills/refund-policy"` 三个目录依次跑:前两个是 Day 296 建的 skill,第三个根本不存在。
- `print(d, "→", out["verdict"], out["problems"])` 打印目录、结论和问题列表。

</div>

```bash
uv run python -m part05.lg.ex299_skill_node
```

```text
.claude/skills/refund-policy → 通过 []
.claude/skills/invoice-title-change → 通过 []
.claude/skills/not-exist → 有 1 个问题 ['缺少 SKILL.md']
```

这个练习想说明的是:**节点就是把你已有的函数包一层**。`check` 本身没有改一个字,放进图里它就成了一个可以和别的节点连起来的步骤。后天两个节点串起来时,就是把这样的函数一个接一个登记进去。

</details>

**练习 4:读报错,找到出错的节点。** 下面的节点里把 `state["ticket"]` 手滑写成了 `state["tickets"]`。写一个脚本调用它,捕获异常,打印异常类型、报错信息的最后两段,并从 traceback 里找出**你自己代码**的文件名、行号、函数名和那一行的内容。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex299_traceback.py
"""练习 4:节点里把字段名写错了,从报错里找到是哪个节点、哪一行。用法:uv run python -m part05.lg.ex299_traceback"""
import traceback
from pathlib import Path
from typing import NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    ticket: str
    category: NotRequired[str]


def classify(state: State) -> dict:
    text = state["tickets"]  # pyright: ignore[reportGeneralTypeIssues]  手滑:State 里叫 ticket,这里多打了一个 s
    return {"category": "billing" if "发票" in text else "other"}


builder = StateGraph(State)
builder.add_node("classify", classify)
builder.add_edge(START, "classify")
builder.add_edge("classify", END)
graph = builder.compile()

try:
    graph.invoke({"ticket": "发票抬头写错了"})
except Exception as e:
    print("异常:", type(e).__name__, e)
    for line in traceback.format_exception(e)[-2:]:  # 报错信息最后两段
        print("报错尾部:", line.strip())
    frames = traceback.extract_tb(e.__traceback__)
    mine = [f for f in frames if f.filename == __file__][-1]
    print(f"你的代码在 {Path(mine.filename).name} 第 {mine.lineno} 行的 {mine.name},那一行是:{mine.line}")
```

<div class="line-notes">

- `import traceback` 标准库里处理报错现场的模块([Day 35](/blog/agent-zero/day-035-exceptions-1/) 的异常)。
- `text = state["tickets"]` 故意写错的那一行。Zed 里这一行本来有红线,`TypedDict` 的好处就是能在运行前发现键名拼错;这里我用注释让检查器闭嘴,为的是演示运行时的样子。
- `except Exception as e:` 接住 `invoke` 抛出的任何异常。
- `print("异常:", type(e).__name__, e)` 输出 `异常: KeyError 'tickets'`。
- `for line in traceback.format_exception(e)[-2:]:` `format_exception(e)` 把完整报错拆成一段一段的字符串列表,`[-2:]` 取最后两段。
- `frames = traceback.extract_tb(e.__traceback__)` 取出调用栈,每一帧是「哪个文件、第几行、哪个函数、那行代码」。栈里除了你的代码,还有一大串 LangGraph 内部的帧。
- `mine = [f for f in frames if f.filename == __file__][-1]` 只留文件名等于当前文件(`__file__`)的帧,取最后一个,就是最靠近出错点的、你自己写的那一帧。
- `print(f"你的代码在 {Path(mine.filename).name} 第 {mine.lineno} 行的 {mine.name},那一行是:{mine.line}")` 只打印文件名(不打印完整路径),行号、函数名、那一行的内容。

</div>

```bash
uv run python -m part05.lg.ex299_traceback
```

```text
异常: KeyError 'tickets'
报错尾部: KeyError: 'tickets'
报错尾部: During task with name 'classify' and id '7bd8a72c-07fa-00a6-2b04-2785cb9cad9d'
你的代码在 ex299_traceback.py 第 16 行的 classify,那一行是:text = state["tickets"]  # pyright: ignore[reportGeneralTypeIssues]  手滑:State 里叫 ticket,这里多打了一个 s
```

报错的最后一段 `During task with name 'classify' ...` 是 LangGraph 加的,告诉你**是哪个节点**出的事,`id` 每次都不一样(是这次运行的任务编号,不用管)。完整的 traceback 有二十来行,绝大部分是框架内部的帧,从上往下看不出重点;从下往上找第一个你自己的文件,就是出错的位置。以后图里有了十个节点,「节点名」这一段就是定位的第一线索。

</details>

**验收标准:** 四个练习的脚本都能跑通,输出和参考答案一致;不看文章能默写出六步骨架,并说出每一步在 JS 里最像什么;能口头解释「为什么 `state["category"] = ...` 不算数」和「为什么今天的图比普通函数慢」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 图(graph) | 把一个流程画成「节点 + 边」。LangGraph 里的图带一份共享状态,节点是步骤,边是步骤之间的跳转 |
| 状态(State) | 整张图共享的一份数据,用 `TypedDict` 之类声明有哪些字段。例:`{"ticket": "...", "category": "billing"}` |
| 节点(node) | 图里的一步,一个函数:收当前状态,返回要更新的字段。例:`classify` |
| 边(edge) | 一个节点跑完后去哪。例:`add_edge("classify", END)` |
| `START` / `END` | 图的入口和出口路标,不是真函数,值是 `'__start__'` 和 `'__end__'` |
| `StateGraph` | 建图纸用的类,`StateGraph(State)` 之后可以 `add_node`、`add_edge` |
| 编译(compile) | `builder.compile()` 检查图纸并得到能执行的图,类型是 `CompiledStateGraph` |
| `invoke` | 调用编译好的图:传入初始状态,跑完整张图,返回最终状态 |
| 更新(update) | 节点返回的字典,只含它改了的键,由框架合并进状态 |
| `TypedDict` | 描述「字典有哪些键、各是什么类型」的类型提示,运行时就是普通字典,不检查。像 TS 的 `interface` |
| `NotRequired` | 标记 `TypedDict` 里某个键可以不存在,像 TS 的 `category?: string` |
| `LastValue` | 默认的合并规则:同一个字段只记最后一次写入的值,新值盖旧值 |
| Mermaid | 用文字描述流程图的语法,`draw_mermaid()` 能把图导出成这种文字 |
| 条件表达式 | `A if 条件 else B`,Python 里的三元运算,像 JS 的 `条件 ? A : B` |

## 常见误区

**以为 `TypedDict` 会在运行时检查类型。** 它只给编辑器看。实测传 `{"ticket": 123}` 照样进图,直到节点里 `"发票" in 123` 才炸,报的是 `TypeError`,和图毫无关系。想在入口就拦住脏数据,要换成 pydantic,Day 302 讲。

**节点返回了不存在的键,以为会报错。** 不会。`{"colour": "red"}` 被悄悄丢掉,最终状态里没有它,也没有警告。键名拼错的后果是「缺了一个字段」而不是「报错」,最容易在很晚才发现。键名从 `State` 里复制,别手打。

**在节点里直接改 `state`。** `state["category"] = "billing"` 然后什么也不返回,最终状态里没有 `category`。和 React 里直接改 `state` 不触发更新一样,只有返回值算数。

**以为没连 `END` 会报错,或者以为不连也无所谓。** 实测 langgraph 1.2.16 里只连 `START → 节点` 编译和运行都正常。但我一律连上,图有了分支以后「这条路在哪结束」才写得清楚。

**以为 `compile()` 要每次调用前都做一遍。** 编译一次,`invoke` 随便调。每次 `invoke` 都是从你给的初始状态重新开始,互不影响,传进去的字典也不会被改。

**忘了给计算出来的字段标 `NotRequired`。** 运行没问题,但编辑器会对 `graph.invoke({"ticket": ...})` 画红线,说少了 `category`。红线多了,真正的问题就看不见了。

**把一个纯规则的节点拿去评价框架的性能。** 今天实测每次 `invoke` 约 2.5 毫秒,普通函数只要几微秒,差几百倍。但节点里一旦调模型(几百毫秒起),这点开销看不见。别用单节点图的耗时下结论。

**用旧教程里的说法。** 我原来也以为「节点没出路,`compile()` 会报错」,实测不对。同样的,`TypedDict` 要不要 `total=False`、节点返回什么算合法,这些细节每个版本都可能变。判断某个行为,自己写十行脚本跑一遍,比读三篇文章快。

## 学习资料

### 文档与文章

- [LangGraph 文档 · Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api):State、节点、边、`START`/`END` 的权威说明,今天的内容是它前几节的最小版本。读「State」「Nodes」「Edges」三节,30 分钟,reducer 那一节先跳过,Day 303–304 再回来。
- [LangGraph 文档 · Quickstart](https://docs.langchain.com/oss/python/langgraph/quickstart):官方的入门,用计算器 Agent 演示同样的结构,今天看懂了之后读它会轻松很多。
- [LangGraph 文档 · Thinking in LangGraph](https://docs.langchain.com/oss/python/langgraph/thinking-in-langgraph):官方写的「怎么把一个流程拆成节点和状态」,讲思路不讲 API,适合装完今天的骨架后读。
- [Python 文档 · typing](https://docs.python.org/3/library/typing.html):`TypedDict`、`NotRequired` 的官方条目,搜页面里的这两个名字即可。
- [typing 规范 · TypedDict](https://typing.python.org/en/latest/spec/typeddict.html):更严格的说法,想弄清「必填和可选」的细则时查。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1z3NY66EY1&autoplay=0&high_quality=1" title="尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>尚硅谷 · 尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战 · 全套约 21 小时(B 站播放 83 万,2026 年 10 月查)。我没有逐集看,只核对过标题和时长;从目录判断,三要素、图的运行过程在第 9–12 集前后,但环境用的是 miniconda 加 Jupyter,和本课的 uv 不一样,装环境那几集跳过。</figcaption>
</figure>

- 吴恩达&LangChain《用LangGraph搭建智能体》(BV1bi421v7oD,约 92 分钟,字幕搬运):录于 2024 年,API 有些旧,看「状态、节点、边」的思路。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/aHCDrAbH_go" title="Building Effective Agents with LangGraph" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Building Effective Agents with LangGraph · 官方频道,英文,开字幕。我只核对了标题和频道,没有逐段看完。看它怎么把「一步一步的流程」画成图,今天的单节点图是它的最小切片。</figcaption>
</figure>

- NeuralNine《LangGraph Crash Course - Agent Workflows in Python》(YouTube `uWLJAtMOVT0`,英文):实操向入门。注意它可能还是 1.0 以前的写法,导入路径和今天不同时以今天为准。

### 书籍

- Mayo Oshin、Nuno Campos,《Learning LangChain: Building AI and LLM Applications with LangChain and LangGraph》,O'Reilly,2025。有讲 LangGraph 的章节,出版时 1.0 还没发布,API 要和今天对照着看。我没有核实有无中文版。
- Luciano Ramalho,《Fluent Python》第 2 版,O'Reilly,2022。想系统弄懂 `TypedDict` 和类型标注的话,按目录找讲类型提示的章节,有中文译本,出版社和译者我没有核实,不写。

### 开源项目与代码

- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):LangGraph 仓库。想看 `StateGraph` 怎么实现,可以读 `libs/langgraph/langgraph/graph/state.py`,不用全懂,先找 `add_node`、`add_edge`、`compile` 三个方法在哪。
- [LangChain Academy · Introduction to LangGraph](https://academy.langchain.com/courses/intro-to-langgraph):官方免费课,有 notebook 可以跟着跑,模块 1 对应今天的内容。

## 自测

1. 一次 `invoke` 里,节点收到的 `state` 是什么,返回的东西又是怎么变成最终状态的?

<details><summary>答案</summary>

节点收到的是此刻的完整状态(一个字典,里面只有已经存在的字段)。节点返回的字典是一份「更新」,框架把它合并进状态:默认规则是同名的键新值盖旧值,没提到的键原样保留。所以今天的 `classify` 收到 `{"ticket": "..."}`,返回 `{"category": "billing"}`,合并后最终状态是 `{"ticket": "...", "category": "billing"}`。

</details>

2. 六步骨架是哪六步?哪几步是「图纸阶段」,哪几步是「运行阶段」?

<details><summary>答案</summary>

定义状态(`class State`)、建图纸(`StateGraph(State)`)、登记节点(`add_node`)、连边(`add_edge`)、编译(`compile()`)、调用(`invoke()`)。前四步改的是 `builder`(图纸),还不能跑;第五步得到能执行的 `CompiledStateGraph`;第六步才真的执行。

</details>

3. 节点返回 `{"catagory": "billing"}`(键名拼错了),会报错吗?最终状态是什么?

<details><summary>答案</summary>

不会报错。`catagory` 不是 `State` 里的字段,这次更新被悄悄丢掉,最终状态里只有 `ticket`,缺 `category`。这是运行 `s01_runtime_traps.py` 实测的:`返回不存在的键 → {'ticket': '发票'}`。防法是键名从 `State` 里复制,并且开发时打印一眼最终状态。

</details>

4. 节点里写 `state["category"] = "billing"` 然后什么都不返回,最终状态里有 `category` 吗?为什么?

<details><summary>答案</summary>

没有。节点收到的 `state` 只是框架交给它看的一份,直接改它不会被合并进最终状态,只有节点的返回值才算更新。实测输出 `原地修改 state → {'ticket': '发票'}`。想让字段生效,必须写 `return {"category": "billing"}`。

</details>

5. 面试题:你的团队里有人说「一个只有一个节点的 LangGraph 图,和直接调一个函数没区别,用它是浪费」。你同意吗?

<details><summary>答案</summary>

对今天这个规则判断的节点,基本同意,实测每次 `invoke` 要 2.5 毫秒左右,普通函数只要几微秒,图没带来任何好处。但图的价值不在单个节点,在于流程变复杂以后:多个节点共享一份状态、条件分支、循环、中途暂停等人审批、断点恢复、流式输出这些能力框架替你管。所以判断标准是「这条流程需不需要这些能力」,而不是节点数量。一个固定三步的流水线用普通函数串起来更简单;有分支、有循环、要持久化的才值得上图。

</details>

## 明天预告

Day 300 · 第 43 周复习:MCP 与编排(Day 294–299)。这一周先后讲了问数 Agent 的循环和评测、表多了怎么办、Agent Skills 的格式和加载器、LangChain 和 LangGraph 的关系,今天又画了第一张图。明天不学新东西:画知识地图、把每天的坑重新过一遍,再做一个只用本周知识的小项目,把 Day 296 的 skill 检查和 Day 292 的 SQL 闸门都装进今天学的单节点图里,并默写本周的核心代码。Day 301 才会学两个节点怎么串起来。
