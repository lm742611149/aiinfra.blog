---
title: 'Day 462 · 主工作流(五):图、路由,为什么不用预置 agent'
description: '把 Day 460 的九个节点连成一张 LangGraph 图:三个路由函数先当普通函数调一遍,再编译、画图,故意写错三次看报错;最后用 create_agent 跑一个预置 agent,对比为什么 act 节点要自己写。'
pubDate: 2026-10-22
regime: none
tags: ['langgraph', 'workflow', 'supportpilot', 'python', 'agent-zero']
series: 'agent-zero'
day: 462
lang: 'zh'
draft: true
---

## 上一课回顾

Day 460 你在 `agent/nodes.py` 里写完了九个节点:`load_customer`、`classify`、`retrieve`、`act`、`draft`、`check`、`approval`、`handoff`、`finalize`。昨天(Day 461)是复习日,把这一周的 LLMClient、状态、提示词、依赖注入、节点串着过了一遍。

但到现在为止,九个节点还是九个各自独立的函数。谁先跑、谁后跑、跑完 `check` 是回去重写还是去审批,这些都还没写。今天就补上这一块:用路由函数决定分支,用 `StateGraph` 把节点连成图,编译以后它才是一个能 `invoke` 的东西。顺带回答一个面试常问的问题:LangGraph 明明有现成的预置 agent,为什么 act 节点要自己写循环。

## 今天要解决的问题

学完今天你应该能做到:

1. 写出 SupportPilot 的三个路由函数,不建图、不调模型,直接用手写的状态字典把每条分支都调出来,打印成一张路由表。
2. 写出 `agent/graph.py` 里的 `build_graph()`,编译后用 `get_graph()` 打印出 11 个节点、15 条边,并把 mermaid 图贴进在线编辑器看。
3. 能说清楚 `add_conditional_edges` 第三个参数(可能去处列表)为什么一定要写:写了,路由名字拼错会立刻报 `KeyError`;不写,只打一行警告,图悄悄结束。
4. 跑一次 `create_agent` 预置 agent,讲出它和我们自己写的 act 循环各自适合什么场景。

预计用时 2 小时。前置:Day 306(条件边和 path_map)、Day 310(画图)、Day 311(用图重写 Agent 循环)、Day 298(LangChain 和 LangGraph 的关系,`create_agent`)、Day 457–460(状态、提示词、依赖注入、九个节点)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `graph.py` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 今天的代码放在哪

今天所有代码都在毕业项目仓库 `supportpilot/` 里(Day 441 建的那个),只有最后一节的预置 agent 实验放在练习仓库 `agent-zero-lab/part08/`,因为它要额外装 `langchain` 和 `langchain-openai`,这两个包毕业项目用不上,别把它们装进 `supportpilot` 的依赖里。

用到前面几天建的文件:

| 文件 | 哪天建的 | 今天用它干什么 |
| --- | --- | --- |
| `src/supportpilot/agent/state.py` | Day 457 | `SupportState`,路由函数读它 |
| `src/supportpilot/agent/deps.py` | Day 459 | `Deps`,`build_graph` 要它 |
| `src/supportpilot/agent/nodes.py` | Day 460 | `make_nodes(deps)` 返回九个节点 |
| `src/supportpilot/db.py` | Day 443 | `connect()`,画图脚本组装 Deps 时用 |

本机实测版本(2026 年 10 月查到,`uv.lock` 里锁的):`langgraph 1.2.16`、`langgraph-checkpoint 4.3.0`、`langchain 1.4.7`、`langchain-openai 1.7.2`、Python 3.12。你的小版本号不同没关系,只要大版本一样,今天的代码都能跑。

在新建文件之前,先在 `supportpilot/` 根目录建一个放实验脚本的目录,今天的几个小脚本都放这里:

```bash
cd supportpilot
mkdir -p scratch
```

`scratch/` 里放的是「看一眼就扔」的探针脚本,和 `src/`、`tests/` 分开,读代码的人一眼就知道哪些是产品代码。

## 第一步:路由函数就是普通函数

先别想图。路由函数(router)说白了就是一个函数:收一个状态字典,返回一个字符串,这个字符串是下一个节点的名字。它不调模型,不连数据库,不改状态。Day 306 你写过玩具版,今天写 SupportPilot 真正要用的三个。

把它想成前端路由:React Router 根据 URL 决定渲染哪个页面组件,LangGraph 的路由函数根据状态决定下一个跑哪个节点。区别只是输入从 URL 换成了状态字典。

SupportPilot 有三个岔路口:

- `classify` 之后:客户要人工(投诉、威胁、明确要求人工)就去 `handoff`,否则去 `retrieve`。
- `retrieve` 之后:这张工单需要查客户自己的账户数据,并且确实找到了这个客户,才进 `act` 调工具;否则直接 `draft`。
- `check` 之后:质检通过,有待审批的退款申请就去 `approval`,没有就 `finalize`;质检没过,还有重写次数就回 `draft`,次数用完就 `handoff`。

新建 `agent/graph.py`,先只写三个路由函数:

```python
# supportpilot/src/supportpilot/agent/graph.py(第一部分)
from collections.abc import Callable

from .state import SupportState


def after_classify(state: SupportState) -> str:
    triage = state.get("triage", {})
    return "handoff" if triage.get("needs_human") else "retrieve"


def after_retrieve(state: SupportState) -> str:
    triage = state.get("triage", {})
    if triage.get("needs_account_data") and state.get("customer"):
        return "act"
    return "draft"


def make_after_check(max_revisions: int) -> Callable[[SupportState], str]:
    def after_check(state: SupportState) -> str:
        if state.get("review", {}).get("passed"):
            rr = state.get("refund_request")
            return "approval" if rr and rr.get("status") == "pending" else "finalize"
        if state.get("revisions", 0) <= max_revisions:
            return "draft"
        return "handoff"

    return after_check
```

<div class="line-notes">

- `from collections.abc import Callable` 给 `make_after_check` 的返回值标类型用。`Callable[[SupportState], str]` 读作「一个函数,收一个 SupportState,返回 str」,相当于 TS 里的 `(state: SupportState) => string`。
- `from .state import SupportState` 点开头是包内相对导入,指同目录的 `state.py`(Day 457 写的)。
- `def after_classify(state: SupportState) -> str:` 路由函数的签名永远是这样:一个参数 state,返回下一个节点的名字。
- `triage = state.get("triage", {})` `SupportState` 是 `total=False` 的 TypedDict,每个键都可能不存在,用 `.get(键, 默认值)` 取,键不存在时拿到 `{}`,不会抛 KeyError。用 `state["triage"]` 也能跑,但 basedpyright 会画红线 `Could not access item in TypedDict`。
- `return "handoff" if triage.get("needs_human") else "retrieve"` Python 的三元表达式,顺序是「值1 if 条件 else 值2」,相当于 JS 的 `cond ? a : b`。实测 `needs_human=True` 返回 `handoff`。
- `if triage.get("needs_account_data") and state.get("customer"):` 两个条件都为真才进 act。`state.get("customer")` 是 None(没查到客户)时为假。实测「要查账+没客户」返回 `draft`。
- `def make_after_check(max_revisions: int)` 外层函数只收一个配置数字,返回真正的路由函数。为什么要包一层,下一节专门讲。
- `def after_check(state: SupportState) -> str:` 定义在函数里面的函数,能读到外层的 `max_revisions`。
- `if state.get("review", {}).get("passed"):` 链式 `.get`:先取 review(没有就是 `{}`),再取 passed(没有就是 None,为假)。
- `return "approval" if rr and rr.get("status") == "pending" else "finalize"` 质检过了:有一条 pending 的退款申请就去审批,否则定稿。实测 `{'status': 'pending'}` → `approval`,`None` → `finalize`。
- `if state.get("revisions", 0) <= max_revisions:` revisions 是质检打回的次数,`check` 节点每打回一次加 1。实测 max_revisions=1 时,revisions=1 → `draft`,revisions=2 → `handoff`。
- `return after_check` 返回的是函数本身,没有括号。带括号就变成「调用它」了。

</div>

你会注意到我用的全是 `state.get(...)`,而 Day 460 的节点里有不少 `state["ticket"]`。两种写法运行时效果一样,区别在类型检查:节点函数被调用时 `ticket` 一定在,用方括号省事;路由函数要面对各种半成品状态(测试里手写的状态只有一两个键),用 `.get` 更稳。

现在不建图,直接调这三个函数。新建一个探针脚本:

```python
# supportpilot/scratch/routes_table.py
"""不连库、不调模型:直接调三个路由函数,看它们各自返回什么。"""

from supportpilot.agent.graph import after_classify, after_retrieve, make_after_check
from supportpilot.agent.state import SupportState

print("after_classify")
print("  要人工 ->", after_classify({"triage": {"needs_human": True}}))
print("  不要人工 ->", after_classify({"triage": {"needs_human": False}}))

print("after_retrieve")
print("  要查账+有客户 ->", after_retrieve({"triage": {"needs_account_data": True}, "customer": {"id": "C0002"}}))
print("  要查账+没客户 ->", after_retrieve({"triage": {"needs_account_data": True}, "customer": None}))
print("  不用查账 ->", after_retrieve({"triage": {"needs_account_data": False}, "customer": {"id": "C0001"}}))

after_check = make_after_check(1)
cases: list[SupportState] = [
    {"review": {"passed": True}, "refund_request": {"status": "pending"}},
    {"review": {"passed": True}, "refund_request": None},
    {"review": {"passed": False}, "revisions": 1},
    {"review": {"passed": False}, "revisions": 2},
]
print("after_check(max_revisions=1)")
for s in cases:
    print(" ", s, "->", after_check(s))
```

<div class="line-notes">

- `from supportpilot.agent.graph import` 从包名开始的绝对导入。Day 441 用 `uv init --package` 建的项目会把 `supportpilot` 以可编辑模式装进 `.venv`,所以在 `scratch/` 里也能这么导入。
- `print("  要人工 ->", after_classify({"triage": {"needs_human": True}}))` 手写一个只有 triage 的状态字典,别的字段一概不给。路由函数只看它关心的那一两个键,这也是它好测的原因。
- `"customer": {"id": "C0002"}` 客户档案随便给一个 id 就够了,`after_retrieve` 只判断它是不是空。
- `after_check = make_after_check(1)` 调一次外层函数,拿到 max_revisions=1 的路由函数。
- `cases: list[SupportState] = [` 给列表标上元素类型,basedpyright 才知道里面每个字典都是 SupportState,不会在下面调用时画红线。
- `for s in cases:` 四种情况各跑一遍,对应 `check` 之后的四个去处。

</div>

在 `supportpilot/` 根目录跑:

```bash
uv run python scratch/routes_table.py
```

真实输出:

```text
after_classify
  要人工 -> handoff
  不要人工 -> retrieve
after_retrieve
  要查账+有客户 -> act
  要查账+没客户 -> draft
  不用查账 -> draft
after_check(max_revisions=1)
  {'review': {'passed': True}, 'refund_request': {'status': 'pending'}} -> approval
  {'review': {'passed': True}, 'refund_request': None} -> finalize
  {'review': {'passed': False}, 'revisions': 1} -> draft
  {'review': {'passed': False}, 'revisions': 2} -> handoff
```

九行输出覆盖了所有分支。这张表就是整张图的「交通规则」,以后有人问「为什么这张工单转人工了」,先看它的状态里 triage、review、revisions 是什么,对着这张表就能答。

`after_check` 那四行值得多看一眼。`revisions <= max_revisions`:第一次质检不过,`check` 把 revisions 从 0 改成 1,1 ≤ 1,回去重写;第二次还不过,revisions 变成 2,2 > 1,转人工。所以 max_revisions=1 的意思是「最多重写一次」。为什么不多给几次?同一个模型、同一份资料,第三次写出来的通常和第二次差不多,多重试只是多花钱。两次都过不了,一般是资料不够或者问题超出了能力范围,交给人更划算。

小结:路由函数是纯函数(给同样的输入永远返回同样的输出,也不改外面任何东西),可以脱离图单独调。图出了问题,先在这一层排查。

## 第二步:为什么 after_check 要包一层

`after_classify` 和 `after_retrieve` 只看状态就够了。`after_check` 不行,它还要知道「最多重写几次」,这个数字在配置里(`deps.settings.max_revisions`,Day 442 的 Settings 里默认是 1)。

问题在于:LangGraph 调用路由函数时只传一个参数 state,你没法让它多传一个 max_revisions。解决办法就是闭包(closure):外层函数收配置,里面定义真正的路由函数,里面的函数「记住」外层的变量。Day 30 讲作用域时提过,内层函数能读外层函数的局部变量。

JS 里你天天在用这个模式:

```ts
// 对照:JS 里的同一个写法
const makeAfterCheck = (maxRevisions: number) => (state: SupportState) =>
  state.revisions <= maxRevisions ? "draft" : "handoff";
```

`make_after_check(1)` 就是 `makeAfterCheck(1)`,返回一个已经「装好」了 1 的函数。

旧版写法是 `after_check(deps)`,把整个 Deps 传进去。我改成只传 `max_revisions: int`,原因是测试的时候不用造一个 Deps 对象,`make_after_check(1)` 一行就有了,上一节的路由表就是这么跑的。路由函数需要什么就只给它什么,依赖越少越好测。

这里有个很容易犯的错:注册条件边时写成 `make_after_check`,忘了加括号和参数。后面第四步会故意犯一次,看它报什么错。

## 第三步:build_graph,把九个节点连起来

现在把 `graph.py` 写完整。下面是全文,第一部分就是上面那三个路由函数:

```python
# supportpilot/src/supportpilot/agent/graph.py
"""把九个节点连成一张图。路由函数只读状态、不调模型,出了问题看状态就知道为什么走这条路。"""

from collections.abc import Callable

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph

from .deps import Deps
from .nodes import make_nodes
from .state import SupportState


def after_classify(state: SupportState) -> str:
    triage = state.get("triage", {})
    return "handoff" if triage.get("needs_human") else "retrieve"


def after_retrieve(state: SupportState) -> str:
    triage = state.get("triage", {})
    if triage.get("needs_account_data") and state.get("customer"):
        return "act"
    return "draft"


def make_after_check(max_revisions: int) -> Callable[[SupportState], str]:
    def after_check(state: SupportState) -> str:
        if state.get("review", {}).get("passed"):
            rr = state.get("refund_request")
            return "approval" if rr and rr.get("status") == "pending" else "finalize"
        if state.get("revisions", 0) <= max_revisions:
            return "draft"
        return "handoff"

    return after_check


def build_graph(deps: Deps, checkpointer: BaseCheckpointSaver | None = None):
    nodes = make_nodes(deps)
    g = StateGraph(SupportState)
    for name, fn in nodes.items():
        g.add_node(name, fn)
    g.add_edge(START, "load_customer")
    g.add_edge("load_customer", "classify")
    g.add_conditional_edges("classify", after_classify, ["retrieve", "handoff"])
    g.add_conditional_edges("retrieve", after_retrieve, ["act", "draft"])
    g.add_edge("act", "draft")
    g.add_edge("draft", "check")
    g.add_conditional_edges("check", make_after_check(deps.settings.max_revisions),
                            ["approval", "finalize", "draft", "handoff"])
    g.add_edge("approval", "finalize")
    g.add_edge("finalize", END)
    g.add_edge("handoff", END)
    return g.compile(checkpointer=checkpointer)
```

<div class="line-notes">

- `from langgraph.checkpoint.base import BaseCheckpointSaver` 所有 checkpointer(内存版 InMemorySaver、Day 464 要用的 PostgresSaver)的共同父类,拿来给参数标类型。
- `from langgraph.graph import END, START, StateGraph` START、END 是两个特殊的节点名,分别代表入口和出口,实际值是字符串 `"__start__"` 和 `"__end__"`。
- `from .deps import Deps` Day 459 的依赖容器,里面有 llm、retriever、call_tool 这些。
- `from .nodes import make_nodes` Day 460 的工厂函数,返回 `{节点名: 函数}`。
- `def build_graph(deps: Deps, checkpointer: BaseCheckpointSaver | None = None):` checkpointer 默认 None:不传也能编译,只是遇到审批的 interrupt 停下来以后没地方存状态,无法恢复。明天的单测和端到端脚本会传 `InMemorySaver()`。
- `nodes = make_nodes(deps)` 九个节点函数在这里拿到 deps(闭包),图本身不关心依赖从哪来。
- `g = StateGraph(SupportState)` 用状态类型建图。LangGraph 从 `SupportState` 里读出 `tool_log`、`cost_cny` 这两个字段挂着的 `operator.add`(Day 457 写的 reducer),以后节点返回这两个字段时自动累加而不是覆盖。
- `for name, fn in nodes.items():` 遍历字典的键值对,相当于 JS 的 `for (const [name, fn] of Object.entries(nodes))`。
- `g.add_node(name, fn)` 注册节点。节点名就是以后路由函数返回的那个字符串。
- `g.add_edge(START, "load_customer")` 普通边:固定走向,没有判断。
- `g.add_conditional_edges("classify", after_classify, ["retrieve", "handoff"])` 条件边:classify 跑完,调 `after_classify(state)`,按返回的名字走。第三个参数列出所有可能的去处,第五步会演示不写它的后果。
- `g.add_edge("act", "draft")` act 跑完一定去起草,不用判断。
- `g.add_edge("draft", "check")` 起草完一定质检。
- `g.add_conditional_edges("check", make_after_check(deps.settings.max_revisions),` 注意括号:先调 `make_after_check(1)` 拿到真正的路由函数,再交给 LangGraph。
- `["approval", "finalize", "draft", "handoff"])` check 之后的四个去处,正好对应路由表最后四行。其中 `draft` 是往回走的边,图里因此有了一个环:draft → check → draft。
- `g.add_edge("approval", "finalize")` 审批完(不管通过还是驳回)都去定稿,定稿时把审批结果的补充说明拼进回复。
- `g.add_edge("finalize", END)` 两条出口之一。
- `g.add_edge("handoff", END)` 另一条出口。图一共只有这两个结局:resolved 或 escalated。
- `return g.compile(checkpointer=checkpointer)` 编译:检查每条边两头的节点都存在,然后返回一个 `CompiledStateGraph`,它才有 `invoke`、`stream`、`get_state` 这些方法。

</div>

这里没有一条边是模型决定的。九个节点里只有 `act` 内部是一个由模型决定「还要不要再调工具」的循环,其余流转全写死在代码里。Day 313 讲过 workflow 和 agent 的区别,SupportPilot 是典型的「workflow 套一个小 agent」:大流程可预测、可测试,只在需要灵活的那一步放手给模型。

## 第四步:编译,打印,画出来

写完了先确认它能编译、结构和你脑子里的一样。新建 `scratch/draw_graph.py`:

```python
# supportpilot/scratch/draw_graph.py
"""编译主工作流,打印节点、边和 mermaid 图。只建对象,不调模型,不花钱。"""

from supportpilot.agent.deps import Deps
from supportpilot.agent.graph import build_graph
from supportpilot.db import connect

conn = connect()
graph = build_graph(Deps.from_conn(conn))
print(type(graph).__name__)

g = graph.get_graph()
print("节点:", list(g.nodes))
print("边数:", len(g.edges))
for e in g.edges:
    print(f"  {e.source} -> {e.target}{'  (条件)' if e.conditional else ''}")
print(g.draw_mermaid())
```

<div class="line-notes">

- `from supportpilot.db import connect` Day 443 的连接函数。组装 Deps 要一条数据库连接(检索器、工具都要),但今天只建对象,一条 SQL 都不会发。
- `conn = connect()` 本机 Postgres.app 要开着,否则这一行就报 `connection refused`。
- `graph = build_graph(Deps.from_conn(conn))` `Deps.from_conn` 会建一个真的 `LLMClient`,但建客户端不发请求,所以不花钱。
- `print(type(graph).__name__)` 实测是 `CompiledStateGraph`。`type(x).__name__` 取对象的类名,相当于 JS 的 `x.constructor.name`。
- `g = graph.get_graph()` 拿到图的结构描述(节点和边),画图、检查都用它。
- `print("节点:", list(g.nodes))` 实测 11 个:九个业务节点加 `__start__` 和 `__end__`。
- `for e in g.edges:` 每条边有 source、target、conditional 三个属性。
- `print(f"  {e.source} -> {e.target}{'  (条件)' if e.conditional else ''}")` f-string 里套一个三元表达式:条件边后面加个标记。
- `print(g.draw_mermaid())` 生成 mermaid 文本。mermaid 是一种用文字描述流程图的格式,GitHub 的 markdown 和很多文档站都能直接渲染。

</div>

```bash
uv run python scratch/draw_graph.py
```

真实输出(前半段):

```text
CompiledStateGraph
节点: ['__start__', 'load_customer', 'classify', 'retrieve', 'act', 'draft', 'check', 'approval', 'handoff', 'finalize', '__end__']
边数: 15
  __start__ -> load_customer
  act -> draft
  approval -> finalize
  check -> approval  (条件)
  check -> draft  (条件)
  check -> finalize  (条件)
  check -> handoff  (条件)
  classify -> handoff  (条件)
  classify -> retrieve  (条件)
  draft -> check
  load_customer -> classify
  retrieve -> act  (条件)
  retrieve -> draft  (条件)
  finalize -> __end__
  handoff -> __end__
```

数一下:普通边 7 条(START→load_customer、load_customer→classify、act→draft、draft→check、approval→finalize、finalize→END、handoff→END),条件边 2 + 2 + 4 = 8 条,合计 15,和打印的一致。第一次跑如果终端先刷出几行 jieba 的 `SyntaxWarning: invalid escape sequence`,别慌,那是检索器依赖的分词库在 Python 3.12 下编译时的老警告,只在第一次出现,不影响结果。

后半段是 mermaid 文本,节选:

```text
graph TD;
	__start__([<p>__start__</p>]):::first
	load_customer(load_customer)
	...
	check -.-> approval;
	check -.-> draft;
	classify -.-> handoff;
	draft --> check;
	...
```

`-->` 是实线(普通边),`-.->` 是虚线(条件边)。把整段复制到 [mermaid.live](https://mermaid.live) 的左侧编辑框,右边就能看到图。我按同样的结构画了一张,标上了哪些节点调模型:

<figure>
<svg viewBox="0 0 640 420" role="img" aria-label="SupportPilot 主工作流:九个节点和四个条件分支">
<g font-family="var(--font-mono)" font-size="12">
<rect x="250" y="10" width="140" height="28" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="320" y="29" text-anchor="middle" fill="var(--ink)">load_customer</text>
<rect x="250" y="62" width="140" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="320" y="81" text-anchor="middle" fill="var(--ink)">classify</text>
<rect x="250" y="122" width="140" height="28" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="320" y="141" text-anchor="middle" fill="var(--ink)">retrieve</text>
<rect x="70" y="182" width="130" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="135" y="201" text-anchor="middle" fill="var(--ink)">act(循环)</text>
<rect x="250" y="236" width="140" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="320" y="255" text-anchor="middle" fill="var(--ink)">draft</text>
<rect x="250" y="296" width="140" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="320" y="315" text-anchor="middle" fill="var(--ink)">check</text>
<rect x="70" y="350" width="130" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="135" y="369" text-anchor="middle" fill="var(--ink)">approval 暂停</text>
<rect x="250" y="384" width="140" height="28" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="320" y="403" text-anchor="middle" fill="var(--ink)">finalize → END</text>
<rect x="470" y="330" width="140" height="28" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="540" y="349" text-anchor="middle" fill="var(--ink)">handoff → END</text>
</g>
<g stroke="var(--ink-faint)" stroke-width="1.3" fill="none" font-family="var(--font-mono)" font-size="11">
<line x1="320" y1="38" x2="320" y2="60"/>
<line x1="320" y1="90" x2="320" y2="120" stroke-dasharray="4 3"/>
<text x="326" y="110" fill="var(--ink-soft)" stroke="none">否则</text>
<path d="M390 76 C 480 76, 540 200, 540 328" stroke-dasharray="4 3"/>
<text x="470" y="120" fill="var(--ink-soft)" stroke="none">needs_human</text>
<path d="M260 150 L 170 180" stroke-dasharray="4 3"/>
<text x="90" y="166" fill="var(--ink-soft)" stroke="none">要查账且有客户</text>
<line x1="320" y1="150" x2="320" y2="234" stroke-dasharray="4 3"/>
<text x="326" y="196" fill="var(--ink-soft)" stroke="none">否则</text>
<path d="M200 204 L 266 234"/>
<line x1="320" y1="264" x2="320" y2="294"/>
<path d="M390 310 C 440 310, 440 250, 392 250" stroke-dasharray="4 3"/>
<text x="446" y="284" fill="var(--ink-soft)" stroke="none">没过,还能重写</text>
<path d="M390 318 L 470 340" stroke-dasharray="4 3"/>
<text x="412" y="372" fill="var(--ink-soft)" stroke="none">次数用完</text>
<path d="M260 324 L 180 348" stroke-dasharray="4 3"/>
<text x="56" y="340" fill="var(--ink-soft)" stroke="none">通过且有待审批</text>
<line x1="320" y1="324" x2="320" y2="382" stroke-dasharray="4 3"/>
<text x="326" y="356" fill="var(--ink-soft)" stroke="none">通过</text>
<path d="M200 372 L 260 392"/>
</g>
</svg>
<figcaption>虚线是条件边(由路由函数决定),实线是固定边。蓝色节点调大模型,琥珀色的 approval 会停下来等人。整张图只有 act 内部由模型决定走几轮。</figcaption>
</figure>

小结:编译成功不等于图对了,但打印边列表能帮你核对「我以为的结构」和「实际的结构」是不是一回事。每次改了 `build_graph`,都值得跑一遍这个脚本。

## 第五步:故意写错三次

路由这一层最常见的错就三类:名字拼错、忘了列去处、把工厂函数当路由函数传进去。在真图上演示要组装一堆依赖,所以写一个三节点的玩具图,专门用来犯错:

```python
# supportpilot/scratch/route_mistakes.py
"""三个故意写错的路由,看 LangGraph 各报什么错。玩具图,不调模型。"""

import sys
from typing import TypedDict

from langgraph.graph import END, START, StateGraph


class S(TypedDict, total=False):
    passed: bool
    path: str


def check(state: S) -> dict:
    return {}


def finalize(state: S) -> dict:
    return {"path": "finalize"}


def handoff(state: S) -> dict:
    return {"path": "handoff"}


def route_typo(state: S) -> str:
    return "finalise" if state.get("passed") else "handoff"


def make_route(limit: int):
    def route(state: S) -> str:
        return "finalize" if state.get("passed") else "handoff"
    return route


def build(mode: str):
    g = StateGraph(S)
    g.add_node("check", check)
    g.add_node("finalize", finalize)
    g.add_node("handoff", handoff)
    g.add_edge(START, "check")
    if mode == "typo":
        g.add_conditional_edges("check", route_typo, ["finalize", "handoff"])
    elif mode == "typo_nolist":
        g.add_conditional_edges("check", route_typo)
    elif mode == "forgot_call":
        g.add_conditional_edges("check", make_route, ["finalize", "handoff"])
    elif mode == "nolist":
        g.add_conditional_edges("check", make_route(1))
    g.add_edge("finalize", END)
    g.add_edge("handoff", END)
    return g.compile()


mode = sys.argv[1]
graph = build(mode)
if mode == "nolist":
    print(graph.get_graph().draw_mermaid().split("graph TD;")[1])
else:
    print(graph.invoke({"passed": True}))
```

<div class="line-notes">

- `import sys` 下面用 `sys.argv[1]` 读命令行参数,选演示哪种错。相当于 Node 的 `process.argv[2]`。
- `class S(TypedDict, total=False):` 玩具状态只有两个字段:质检过没过、最后走了哪条路。
- `def check(state: S) -> dict:` 什么都不改的节点,只是一个岔路口。
- `return {"path": "finalize"}` 走到哪个出口就把名字写进状态,方便看结果。
- `return "finalise" if state.get("passed") else "handoff"` 故意把 finalize 拼成英式的 finalise,少一个字母 z,肉眼很难发现。
- `def make_route(limit: int):` 和 `make_after_check` 一样的工厂函数。
- `g.add_conditional_edges("check", route_typo, ["finalize", "handoff"])` 错误一:拼错,但列了去处。
- `g.add_conditional_edges("check", route_typo)` 错误二:拼错,而且没列去处。
- `g.add_conditional_edges("check", make_route, ["finalize", "handoff"])` 错误三:传的是工厂函数本身,忘了写 `make_route(1)`。
- `g.add_conditional_edges("check", make_route(1))` 拼写正确,只是不列去处,看画出来的图什么样。
- `print(graph.get_graph().draw_mermaid().split("graph TD;")[1])` 只打印 mermaid 里节点和边那部分,开头的配置段跳过。
- `print(graph.invoke({"passed": True}))` 传 passed=True,正确的路由应该走到 finalize。

</div>

先跑错误一:

```bash
uv run python scratch/route_mistakes.py typo
```

报错的最后几行(真实输出,前面的调用栈省略):

```text
  File ".../langgraph/graph/_branch.py", line 203, in _finish
    r if isinstance(r, Send) else self.ends[r] for r in result
                                  ~~~~~~~~~^^^
KeyError: 'finalise'
During task with name 'check' and id '1d0190f2-f1bd-7a85-e8c1-d18cd2571250'
```

`self.ends` 就是你传的第三个参数变成的字典,路由返回 `'finalise'`,在里面查不到,直接 KeyError,而且告诉你是在 `check` 这个任务里出的事。响亮、立刻、指名道姓,这是好的报错。

错误二,同样拼错,但不列去处:

```bash
uv run python scratch/route_mistakes.py typo_nolist
```

```text
Task check with path ('__pregel_pull', 'check') wrote to unknown channel branch:to:finalise, ignoring it.
{'passed': True}
```

没有异常。只打了一行警告「写到了一个不存在的通道,忽略」,然后图就结束了,返回的状态里连 `path` 都没有。想象一下这发生在 SupportPilot 里:质检通过的工单既没定稿也没转人工,静悄悄地停在半路,客户永远等不到回复,日志里只有一行很容易被淹没的警告。**第三个参数一定要写**,这是我今天最想让你记住的一句。

错误三,忘了调用工厂函数:

```bash
uv run python scratch/route_mistakes.py forgot_call
```

```text
KeyError: <function make_route.<locals>.route at 0x112cec900>
During task with name 'check' and id 'e65d1914-c09a-2fc4-4d15-f983a8eb00ce'
```

LangGraph 把状态字典当成 `limit` 传给了 `make_route`,`make_route` 返回了一个函数,LangGraph 拿这个函数去去处列表里查,当然查不到。看到 `KeyError: <function ...>` 这种「键是一个函数」的报错,第一反应就该是:是不是哪里少写了一对括号。

最后看不列去处时画出来的图:

```bash
uv run python scratch/route_mistakes.py nolist
```

```text
	__start__(<p>__start__</p>)
	check(check)
	finalize(finalize)
	handoff(handoff)
	__end__(<p>__end__</p>)
	__start__ --> check;
	check --> __end__;
	...
```

路由函数本身是对的,图也能正常跑,但画出来的图是错的:`check` 直接连到了 `__end__`,`finalize` 和 `handoff` 成了两个孤岛。原因是 LangGraph 编译时看不到路由函数里面会返回什么,你不告诉它,它就不知道有哪些去处。Day 310 讲过,画图是给人看结构用的,图画错了,review 的人就会被误导。

小结:三类错误里,列了去处的都会立刻 KeyError;没列去处的,拼错时静默失败,拼对时画图失真。所以 SupportPilot 的三条条件边全都写了第三个参数。

## 第六步:为什么不用现成的预置 agent

Day 298 介绍过 LangChain 1.x 的 `create_agent`:给它一个模型和几个工具,它就返回一个编译好的 LangGraph 图,里面是「调模型 → 有工具调用就执行 → 结果喂回 → 直到模型不再调工具」的循环,也就是 Day 166 你手写的那 25 行。LangGraph 早期的 `langgraph.prebuilt.create_react_agent` 是同一个东西,1.x 之后官方文档推荐用 `create_agent`。

既然有现成的,act 节点为什么要自己写?先跑一次预置版,看看它到底给了你什么。这个实验放在练习仓库,先装依赖:

```bash
cd agent-zero-lab
uv add langchain langchain-openai python-dotenv
mkdir -p part08
```

`.env` 用的还是 Day 135 起一直在用的那份(`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`LLM_EXTRA_BODY`)。

```python
# agent-zero-lab/part08/prebuilt_agent.py
"""预置 agent 长什么样:10 行得到一个「模型 + 工具」循环。工具是假的,只演示循环本身。"""

import json
import os

from dotenv import load_dotenv
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from pydantic import SecretStr

load_dotenv()


def list_invoices(customer_id: str) -> str:
    """列出客户最近的账单。"""
    return json.dumps({"invoices": [{"id": "INV-202609-0002", "amount_cny": 950.0, "status": "paid"}]})


def check_refund_eligibility(invoice_id: str) -> str:
    """判断一张账单能不能退、能退多少。"""
    return json.dumps({"invoice_id": invoice_id, "eligible": True, "refund_amount_cny": 950.0})


model = ChatOpenAI(model=os.environ["LLM_MODEL"], base_url=os.environ["LLM_BASE_URL"],
                   api_key=SecretStr(os.environ["LLM_API_KEY"]), temperature=0,
                   extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}")))
agent = create_agent(model, tools=[list_invoices, check_refund_eligibility],
                     system_prompt="你是客服后台调查员。客户 ID 是 C0002。查清能不能退款,最后用一句话写结论。")

if __name__ == "__main__":
    out = agent.invoke({"messages": [{"role": "user", "content": "上周买的年付,能退吗?"}]})
    for m in out["messages"]:
        calls = [c["name"] for c in getattr(m, "tool_calls", [])]
        print(f"{m.type:<6} calls={calls} text={str(m.content)[:60]!r}")
    usage = [m.usage_metadata for m in out["messages"] if getattr(m, "usage_metadata", None)]
    print("模型调用次数:", len(usage))
    print("输入 token:", sum(u["input_tokens"] for u in usage), "输出 token:", sum(u["output_tokens"] for u in usage))
```

<div class="line-notes">

- `from langchain.agents import create_agent` LangChain 1.x 的预置 agent 入口,返回值是一个编译好的 LangGraph 图。
- `from langchain_openai import ChatOpenAI` LangChain 包装的 OpenAI 兼容客户端,换 base_url 就能接 DeepSeek。
- `from pydantic import SecretStr` ChatOpenAI 的 api_key 参数要求是 SecretStr(打印时显示成 `**********`,防止密钥进日志)。直接传 str 运行时也行,但 basedpyright 会报类型错。
- `load_dotenv()` 从当前目录往上找 `.env`,把里面的键值放进环境变量。
- `def list_invoices(customer_id: str) -> str:` 假工具,永远返回同一张 950 元的账单。函数的 docstring 会被 create_agent 当成工具描述发给模型,所以必须写。
- `def check_refund_eligibility(invoice_id: str) -> str:` 假工具,永远判「可退,950 元」。
- `model = ChatOpenAI(model=os.environ["LLM_MODEL"]` 实测 `.env` 里是 `deepseek-flash`。`os.environ["X"]` 取不到会抛 KeyError,相当于 Node 里 `process.env.X` 但更严格。
- `extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}")))` 和 Day 457 的 LLMClient 一样透传 `{"thinking": {"type": "disabled"}}`,关掉 deepseek-flash 的思考。
- `agent = create_agent(model, tools=[list_invoices, check_refund_eligibility],` 普通 Python 函数直接当工具传,框架自己从类型注解和 docstring 生成 JSON Schema(Day 169 手写过这件事)。
- `if __name__ == "__main__":` 只有直接运行这个文件时才执行下面的代码;被别的文件 import 时不执行。下一个脚本要 import 这里的 agent,所以必须有这一行。
- `out = agent.invoke({"messages": [{"role": "user"` 预置 agent 的状态只有一个 `messages` 列表。实测返回 6 条消息。
- `calls = [c["name"] for c in getattr(m, "tool_calls", [])]` 只有 AI 消息有 tool_calls 属性,`getattr` 给别的消息兜底成空列表。
- `print(f"{m.type:<6} calls={calls}` `:<6` 左对齐占 6 格。`!r` 用 repr 打印,能看出字符串的引号和转义。
- `usage = [m.usage_metadata for m in out["messages"]` 每条 AI 消息带一份 token 用量,实测 3 条。
- `print("输入 token:", sum(u["input_tokens"] for u in usage)` 实测输入 1353、输出 161。

</div>

```bash
cd part08
uv run python prebuilt_agent.py
```

真实输出:

```text
human  calls=[] text='上周买的年付,能退吗?'
ai     calls=['list_invoices'] text="I'll look up the customer's invoices first."
tool   calls=[] text='{"invoices": [{"id": "INV-202609-0002", "amount_cny": 950.0,'
ai     calls=['check_refund_eligibility'] text=''
tool   calls=[] text='{"invoice_id": "INV-202609-0002", "eligible": true, "refund_'
ai     calls=[] text='客户 C0002 只有一张已支付的账单 INV-202609-0002（950 元），退款资格检查结果为可退，可全额退还'
模型调用次数: 3
输入 token: 1353 输出 token: 161
```

三轮模型调用,两次工具调用,最后一句结论。和 Day 460 act 节点的流程一模一样。有个小插曲:第二行模型冒出一句英文「I'll look up the customer's invoices first.」,我第一次跑时那句是中文「我先查一下客户 C0002 的账单记录」。同样的输入、temperature=0,两次措辞也不一样,这对明天写测试很有启发:断言不能写死模型的原话。

花费按 2026 年 10 月在 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) 查到的 deepseek-flash 高峰价(输入未命中 2 元/百万 token,输出 8 元/百万 token)算:1353 × 2 / 1,000,000 + 161 × 8 / 1,000,000 = 0.0027 + 0.0013 = 约 0.004 元。

再试一下步数上限。预置 agent 用 LangGraph 的 `recursion_limit` 限制总步数(Day 308 讲过),超了会怎样:

```python
# agent-zero-lab/part08/prebuilt_limit.py
"""给预置 agent 一个很紧的步数上限,看超限时会发生什么。接着 prebuilt_agent.py 用。"""

from langgraph.errors import GraphRecursionError

from prebuilt_agent import agent

try:
    agent.invoke({"messages": [{"role": "user", "content": "上周买的年付,能退吗?"}]},
                 {"recursion_limit": 3})
except GraphRecursionError as e:
    print(type(e).__name__, "|", str(e)[:120])
```

<div class="line-notes">

- `from langgraph.errors import GraphRecursionError` 超过 recursion_limit 时抛的异常类型。
- `from prebuilt_agent import agent` 复用上一个文件建好的 agent。因为那边有 `if __name__ == "__main__":`,导入时不会把上一个实验再跑一遍。
- `{"recursion_limit": 3})` 第二个参数是运行配置。3 步大概够「模型 → 工具 → 模型」,不够跑完全程。
- `except GraphRecursionError as e:` 超限直接抛异常,前面已经调过的工具结果都在图内部,拿不到。
- `print(type(e).__name__, "|", str(e)[:120])` 只打印前 120 个字符。

</div>

```bash
uv run python prebuilt_limit.py
```

```text
GraphRecursionError | Recursion limit of 3 reached without hitting a stop condition. You can increase the limit by setting the `recursion_limi
```

对比 Day 460 我们的 act 节点:`for step in range(max_act_steps): ... else:` 五轮用完时不抛异常,而是把已经查到的工具结果拼成一段「调查结论」交给 draft,前面花的钱不白花,工单照样往下走。预置 agent 超限就是一个异常,你得自己在外面 try/except,而且异常里拿不到中间结果。

所以 act 自己写,理由是这几条:

| 需求 | 自己写的 act(二十几行) | 预置 create_agent |
| --- | --- | --- |
| 工具之间插日志、推前端事件 | 循环里直接加一行 `_emit(...)` | 要找中间件或回调,翻文档确认支持 |
| 识别出 `create_refund_request` 成功,存进 `refund_request` 给路由用 | 一个 if | 要从 messages 里事后解析 |
| 步数用完时把已查到的结果整理成结论 | `for ... else` | 抛 `GraphRecursionError`,中间结果拿不到 |
| 只给 READ 和 PROPOSE 两级工具 | `openai_tools({Level.READ, Level.PROPOSE})` | 传工具列表时自己筛,可以做到 |
| 面试被问「循环怎么实现的」 | 指着二十行讲 | 「我调了一个函数」 |
| 代码量 | 多二十行 | 少 |

最后一行要诚实:预置的代码量确实少,而且 `create_agent` 这一年加了很多中间件(middleware)能力,上表第一行很多场景它也能做,只是每加一样都要去确认一遍它支持不支持、怎么配。如果你的需求就是标准的「模型加几个工具,问完就答」,用预置的完全没问题。SupportPilot 的 act 夹在一张大图中间,前后节点要读它产出的 `findings`、`refund_request`、`tool_log`,自己写反而更直接。框架是工具,不是信仰。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1HVFLzfEeS&autoplay=0&high_quality=1" title="挑战19分钟搞定,LangGraph快速入门与原理剖析" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>敲代码的码农 · 挑战 19 分钟搞定,LangGraph 快速入门与原理剖析 · 如果 Day 299–313 的状态、节点、条件边有点忘了,用这个快速复习一遍,重点看条件边那一段。</figcaption>
</figure>

## 零件和大代码的对照

| 今天的小脚本 | 对应 `graph.py` 里哪一段 | 验证了什么 |
| --- | --- | --- |
| `scratch/routes_table.py` | 三个路由函数 | 九条分支各自返回什么 |
| 第二步的 JS 对照 | `make_after_check` | 闭包怎么把配置带进路由函数 |
| `scratch/draw_graph.py` | `build_graph` 全部 | 11 个节点、15 条边,和设计一致 |
| `scratch/route_mistakes.py` | 每一行 `add_conditional_edges` | 第三个参数为什么必须写 |
| `part08/prebuilt_agent.py`、`prebuilt_limit.py` | 不进项目,对照 Day 460 的 act | 预置 agent 能做什么、超限时的行为 |

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/aHCDrAbH_go" title="Building Effective Agents with LangGraph" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Building Effective Agents with LangGraph · 官方用 LangGraph 把 Anthropic 那篇文章里的几种 workflow 模式各实现一遍,看路由(routing)和 evaluator-optimizer 那两段,正好对应我们的 classify 分支和 draft/check 回环。</figcaption>
</figure>

## 动手练习

**练习 1:把重写次数改成 2。** 写一个脚本,分别用 `make_after_check(1)` 和 `make_after_check(2)`,对「质检没过、revisions 是 1/2/3」三种状态各调一次,打印结果,说说 max_revisions 的含义。

<details><summary>参考答案</summary>

```python
# supportpilot/scratch/ex1_revisions.py
"""练习 1:max_revisions 从 1 改成 2,打回几次才转人工?"""

from supportpilot.agent.graph import make_after_check

for limit in (1, 2):
    route = make_after_check(limit)
    row = [route({"review": {"passed": False}, "revisions": n}) for n in (1, 2, 3)]
    print(f"max_revisions={limit}: revisions=1/2/3 ->", row)
```

<div class="line-notes">

- `for limit in (1, 2):` 元组也能遍历,相当于 `for (const limit of [1, 2])`。
- `route = make_after_check(limit)` 每次拿到一个装着不同 limit 的路由函数。
- `row = [route({"review": {"passed": False}, "revisions": n}) for n in (1, 2, 3)]` 列表推导式,对三个 revisions 各调一次,结果收成列表。

</div>

```bash
uv run python scratch/ex1_revisions.py
```

```text
max_revisions=1: revisions=1/2/3 -> ['draft', 'handoff', 'handoff']
max_revisions=2: revisions=1/2/3 -> ['draft', 'draft', 'handoff']
```

max_revisions 就是「允许重写几次」:1 表示打回一次还能重写,第二次不过就转人工;2 表示能重写两次。改它不用动图,只改 Day 442 的配置(`.env` 里写 `MAX_REVISIONS=2`)。

</details>

**练习 2:VIP 紧急工单直接转人工。** 运营提了个需求:VIP 客户(`customer["is_vip"]` 为 true)的紧急工单(`triage["urgency"] == "high"`),分诊完不走自动流程,直接转人工。只改路由函数,写成一个新函数 `after_classify_vip`,用四个手写状态测一下:VIP+紧急、VIP+普通、非 VIP+紧急、没找到客户+紧急。

<details><summary>参考答案</summary>

```python
# supportpilot/scratch/ex2_vip.py
"""练习 2:VIP 客户的紧急工单,分诊完直接转人工。只改路由函数,节点一行不动。"""

from supportpilot.agent.state import SupportState


def after_classify_vip(state: SupportState) -> str:
    triage = state.get("triage", {})
    customer = state.get("customer") or {}
    if triage.get("needs_human"):
        return "handoff"
    if customer.get("is_vip") and triage.get("urgency") == "high":
        return "handoff"
    return "retrieve"


cases: list[SupportState] = [
    {"triage": {"needs_human": False, "urgency": "high"}, "customer": {"id": "C0010", "is_vip": True}},
    {"triage": {"needs_human": False, "urgency": "normal"}, "customer": {"id": "C0010", "is_vip": True}},
    {"triage": {"needs_human": False, "urgency": "high"}, "customer": {"id": "C0002", "is_vip": False}},
    {"triage": {"needs_human": False, "urgency": "high"}, "customer": None},
]
for s in cases:
    print(s.get("triage", {}).get("urgency"), (s.get("customer") or {}).get("is_vip"), "->", after_classify_vip(s))
```

<div class="line-notes">

- `customer = state.get("customer") or {}` customer 可能是 None(没找到客户),`None or {}` 得到 `{}`,下面 `.get` 就不会报 `'NoneType' object has no attribute 'get'`。
- `if triage.get("needs_human"):` 原来的规则放最前面,不能因为加新规则把它弄丢。
- `if customer.get("is_vip") and triage.get("urgency") == "high":` 新规则。C0010 吴刚在 Day 445 的种子数据里是 VIP。
- `"customer": None},` 第四种情况专门测「没客户」,这是最容易漏的边界。
- `print(s.get("triage", {}).get("urgency")` 打印时也用 `.get`,保持 0 类型报错。

</div>

```text
high True -> handoff
normal True -> retrieve
high False -> retrieve
high None -> retrieve
```

想真正接进图,把 `build_graph` 里的 `after_classify` 换成它就行,去处列表 `["retrieve", "handoff"]` 不用变,因为新函数没有新的去处。这就是路由和节点分开的好处:业务规则变了,改的是十行纯函数,不碰任何调模型的代码。

</details>

**练习 3:把图贴进 mermaid.live。** 跑 `scratch/draw_graph.py`,把输出里从 `---` 开始的 mermaid 文本整段复制到 [mermaid.live](https://mermaid.live),截图。然后回答:图里哪一条边让它成了一张「有环的图」?

<details><summary>参考答案</summary>

在 mermaid.live 里能看到从 `__start__` 到 `__end__` 的完整流程,条件边是虚线。造成环的是 `check -.-> draft` 这条:check 之后可能回到 draft,draft 又固定连到 check,形成 draft → check → draft 的回环。这个环靠 `revisions` 计数和 `max_revisions` 保证一定会退出,所以不会撞上 Day 308 讲的 `GraphRecursionError`(默认上限 25 步,我们这张图最长的一条路径是 START、load_customer、classify、retrieve、act、draft、check、draft、check、approval、finalize,远没到)。

</details>

**练习 4(开放题):你会怎么用预置 agent 实现 act?** 假设领导要求「能用框架的就用框架」,你要把 act 节点换成 `create_agent`。列出至少两件你得额外处理的事。

<details><summary>参考答案</summary>

一个示范答案:

1. `refund_request` 从哪来。自己写的循环里一个 if 就记下了;换成预置 agent 后,要在它跑完以后遍历 `out["messages"]`,找到名字是 `create_refund_request` 的 ToolMessage,解析里面的 JSON,而且要判断它不是报错文本。
2. 步数超限。实测 `recursion_limit=3` 时直接抛 `GraphRecursionError`,act 节点要包 try/except,超限时只能给 draft 一句「调查失败」,之前查到的工具结果拿不到(除非你另外给它加 checkpointer 去读中间状态)。
3. 前端事件。我们的 `_emit({"type": "tool", ...})` 要改成订阅预置 agent 的 stream 输出再转发。

做完这几件,代码量大概和自己写的循环差不多。我的结论是这个场景不值得换,但如果 act 前后没有节点依赖它的副产物,换成预置的会更省事。

</details>

验收标准:`scratch/routes_table.py` 输出九行且和文中一致;`scratch/draw_graph.py` 打印 11 个节点、15 条边;`route_mistakes.py` 四种模式你都亲手跑过,能说出每种为什么是这个结果;`prebuilt_agent.py` 跑通,花费在 1 分钱以内。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 路由函数(router) | 收状态、返回下一个节点名字的函数。例:`after_classify` 返回 `"handoff"` 或 `"retrieve"`。 |
| 纯函数 | 同样的输入永远得到同样的输出,也不改外部任何东西。路由函数应该是纯函数,所以能脱离图单测。 |
| 条件边(conditional edge) | 走向由路由函数决定的边,用 `add_conditional_edges` 注册,画图时是虚线。 |
| 去处列表(path_map) | `add_conditional_edges` 的第三个参数,列出路由可能返回的所有节点名。写了才能在拼错时立刻报 KeyError,画图才正确。 |
| 闭包(closure) | 定义在函数里面的函数,能记住外层函数的变量。例:`make_after_check(1)` 返回的函数记住了 1。 |
| 工厂函数 | 专门用来生成另一个函数或对象的函数。`make_after_check`、`make_nodes` 都是。 |
| 编译(compile) | `StateGraph.compile()`,检查节点和边,返回能运行的 `CompiledStateGraph`。 |
| mermaid | 用文字描述流程图的格式,`draw_mermaid()` 输出它,mermaid.live 能在线渲染。 |
| 预置 agent | 框架提供的现成「模型 + 工具」循环。2026 年 LangChain 里是 `create_agent`。 |
| recursion_limit | LangGraph 一次运行最多跑多少步,超了抛 `GraphRecursionError`,默认 25。 |
| SecretStr | pydantic 的字符串包装类型,打印时显示成星号,用来装密钥。 |

## 常见误区

**路由函数里调模型。** 有人想在 `after_classify` 里再问一次模型「这单要不要转人工」。别这么做:路由函数一旦调模型,它就不再是纯函数,单测要花钱,结果还不稳定。要模型判断的事放进节点(classify 已经输出了 needs_human),路由只读节点的结论。

**不写 add_conditional_edges 的第三个参数。** 第五步实测过:拼错名字时不报错,只打一行 `wrote to unknown channel branch:to:finalise, ignoring it.`,图悄悄结束;拼对了画出来的图也是错的。每条条件边都写上去处列表。

**把工厂函数本身传进去。** 写成 `add_conditional_edges("check", make_after_check, [...])`,运行时报 `KeyError: <function make_route.<locals>.route at 0x...>`。看到「键是一个函数」,就去找少写的那对括号。

**路由函数用方括号取可能不存在的键。** `state["review"]["passed"]` 在第一次进 check 之前 review 根本不存在,单测里手写半成品状态时会直接 KeyError,basedpyright 也会画红线。用 `.get(键, 默认值)`。

**以为编译过了图就对了。** compile 只检查边两头的节点存不存在,不检查你的分支逻辑。改了 `build_graph` 就跑一次 `draw_graph.py` 对一下边列表。

**断言模型的原话。** 同一个预置 agent、temperature=0,两次跑出来第一句话一次是中文一次是英文。测流程的时候断言工具调用顺序、路由结果这类结构化的东西,别断言模型说了哪句话。明天的单测就是按这个原则写的。

**把 langchain 装进毕业项目。** 预置 agent 的实验只是对照,`langchain`、`langchain-openai` 装在 `agent-zero-lab` 里。毕业项目多一个用不上的依赖,就多一份升级和安全扫描的负担。

## 学习资料

### 文档与文章

- [LangGraph Graph API 概念](https://docs.langchain.com/oss/python/langgraph/graph-api):官方文档,看 Edges 一节里 Conditional edges 的写法和 path map 的说明,20 分钟。
- [LangGraph 使用 Graph API](https://docs.langchain.com/oss/python/langgraph/use-graph-api):how-to 合集,看「Create branches」和「Visualize your graph」两段,和今天第三、四步一一对应。
- [LangChain Agents(create_agent)](https://docs.langchain.com/oss/python/langchain/agents):预置 agent 的官方文档,看它支持哪些参数和中间件,做练习 4 时有用,30 分钟。
- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):讲 workflow 和 agent 的区别、routing 和 evaluator-optimizer 模式,SupportPilot 的整体设计就是照这个思路来的,中文读者可以配合浏览器翻译,40 分钟。

### B 站视频

- 敲代码的码农《挑战 19 分钟搞定,LangGraph 快速入门与原理剖析》:上面嵌入的那个,复习状态、节点、条件边。
- 大模型-小星《LangGraph 核心 4 件套!节点 / 边 / StateGraph 秒懂指南》:5 分钟的短视频,如果你对「普通边和条件边的区别」还有点模糊,看这个就够。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ftBMBSEqA&autoplay=0&high_quality=1" title="LangGraph 核心 4 件套!节点 / 边 / StateGraph 秒懂指南" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>大模型-小星 · LangGraph 核心 4 件套!节点 / 边 / StateGraph 秒懂指南 · 5 分钟,把节点、边、StateGraph、编译四个概念过一遍,适合做完今天的练习后复盘。</figcaption>
</figure>

### 其他经典视频

- LangChain《Building Effective Agents with LangGraph》:上面嵌入的那个,看 routing 和 evaluator-optimizer 两段。
- IBM Technology《LangChain vs LangGraph: A Tale of Two Frameworks》:10 分钟讲清楚两者的分工,回答「预置 agent 属于哪一层」这类问题。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/qAF1NjEVHhY" title="LangChain vs LangGraph: A Tale of Two Frameworks" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>IBM Technology · LangChain vs LangGraph: A Tale of Two Frameworks · 看两者各管哪一层,对照今天「create_agent 其实返回的就是一张 LangGraph 图」这个结论。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章 Agents 部分讲 planning 和 control flow,其中「什么时候用固定流程、什么时候让模型决定下一步」那几页,和今天第六步的取舍是同一个问题。

### 开源项目与代码

- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):看 [libs/langgraph/langgraph/graph/state.py](https://github.com/langchain-ai/langgraph/blob/main/libs/langgraph/langgraph/graph/state.py) 里 `add_conditional_edges` 的实现,能看到 path 参数是怎么变成 `ends` 字典的,第五步那个 `KeyError` 就是从那来的,20 分钟。
- [datawhalechina/hello-agents](https://github.com/datawhalechina/hello-agents):中文开源 Agent 教程,里面用框架和手写两种方式实现过 agent 循环,可以对照今天的取舍看。

## 自测

1. 路由函数的签名是什么样的?为什么说它应该是纯函数?

<details><summary>答案</summary>

收一个参数 state,返回一个字符串(下一个节点名)。它只读状态里的几个字段做判断,不调模型、不写库、不改状态,所以同样的状态永远走同一条路。好处是能脱离图直接调(`routes_table.py` 就是这么测的),出了问题看状态就能还原当时为什么走了这条分支。

</details>

2. `make_after_check(1)` 和 `make_after_check` 有什么区别?把后者传给 `add_conditional_edges` 会怎样?

<details><summary>答案</summary>

`make_after_check(1)` 是调用工厂函数,得到一个记住了 max_revisions=1 的路由函数;`make_after_check` 是工厂函数本身。传后者时,LangGraph 会把状态字典当成 max_revisions 传进去,拿到的返回值是一个函数而不是节点名,于是报 `KeyError: <function ...>`。

</details>

3. max_revisions=1 时,一张草稿最多会被生成几次?质检最多跑几次?

<details><summary>答案</summary>

草稿最多 2 次(第一次加重写一次),质检也最多 2 次。第一次质检不过 revisions 变 1,1 ≤ 1 回 draft;第二次不过 revisions 变 2,2 > 1 去 handoff。

</details>

4. 面试题:你的 Agent 用了 LangGraph,为什么不直接用它的预置 agent?

<details><summary>答案</summary>

示范回答:整个流程我用 LangGraph 编排,九个节点里只有调查那一步是自主循环。这一步我自己写了二十几行,没用预置的 `create_agent`,原因有三:一是要在工具调用之间插事件和日志,并把「退款申请创建成功」这个副产物存进状态给后面的路由用;二是步数用完时要把已查到的结果整理成结论继续往下走,预置 agent 超限直接抛 `GraphRecursionError`,中间结果拿不到;三是这段循环要能讲清楚、能单测。如果场景只是标准的「模型加几个工具问答」,我会直接用预置的,代码更少。

</details>

5. 不写 `add_conditional_edges` 的第三个参数,会出哪两类问题?

<details><summary>答案</summary>

一是路由返回的名字拼错时不报错,只打一行 `wrote to unknown channel ... ignoring it` 的警告,图悄悄结束,工单卡在半路;二是画图时 LangGraph 不知道有哪些去处,画出来的图把分支节点画成孤岛,结构是错的。

</details>

## 明天预告

明天是 Day 463,主工作流(六):不花钱的单测和端到端 10 张工单。今天的图能编译、能画,但还没真正跑过一张工单。明天先写一套假 LLM、假检索、假工具,不连库、不花一分钱,把退款审批停下再恢复、转人工时作废申请、质检两次不过这几条路全测一遍;然后接上真模型和真数据库,在终端里跑 10 张演示工单,看每一步在干什么、每张花多少钱。
