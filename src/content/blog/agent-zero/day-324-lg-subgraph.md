---
title: 'Day 324 · LangGraph(二十二):子图,把一段流程封装起来'
description: '一个编译好的图可以直接当另一个图的节点,这就是子图。今天先用玩具图看清两种接法(状态同名直接加、状态不同就包一层函数)和一个不报错的坑,再看子图里的 interrupt、快照和流式输出从父图怎么找到;然后讲子图的持久化策略 None、True、False 各自什么效果。最后把 Day 320 的退款审批整个装进一个先分类再路由的主图,并聊聊这套东西放到真实系统里还差什么。'
pubDate: 2026-10-22
regime: none
tags: ['langgraph', 'subgraph', 'checkpoint', 'agent-zero']
series: 'agent-zero'
day: 324
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 323](/blog/agent-zero/day-323-lg-stream-modes/) 学了 `stream` 的三种模式:updates 每个节点跑完推一次修改,values 每一步推完整状态,messages 把模型的输出一段段推出来。我们还开始用 `version="v2"`,每一项都是 `{"type", "ns", "data"}`。当时说 `ns` 一直是空元组,要等子图出场才有用。

今天子图就出场了。退款审批现在是一张独立的图,命令行直接 `start T1041`。可真实的客服系统里,进来的工单五花八门:导出报表报错、登录不了、发票抬头要改,退款只是其中一类。我们希望有一张「总调度」图先判断工单是哪一类,退款类交给退款审批,其他类转给别的流程。退款审批那张图已经写好、测好了,不想把它的五个节点拆开重新连一遍。子图就是干这个的。

## 今天要解决的问题

学完今天,你要能做到:

1. 把一个编译好的图当节点加进另一个图,说清楚什么时候直接加、什么时候要包一层函数,并演示「状态没有同名字段」时子图安静地收到空字典。
2. 子图里 interrupt 停下后,用 `get_state(config, subgraphs=True)` 找到子图停在哪,用 `stream(..., subgraphs=True)` 看子图内部每一步,并且照常对父图 `Command(resume=...)` 恢复。
3. 说出子图 `compile(checkpointer=None / True / False)` 三种持久化策略的区别,并用实跑说明 False 为什么会让退款审批多调一次模型。
4. 写出 `router.py`:按工单标题分类,退款类进 Day 320 的退款审批子图,其他转人工。

预计用时 3 小时。前置:[Day 306](/blog/agent-zero/day-306-lg-conditional/) 的条件边,[Day 316](/blog/agent-zero/day-316-lg-checkpointer/) 的 checkpointer 和 thread_id,[Day 319](/blog/agent-zero/day-319-lg-interrupt/) 的 interrupt,[Day 304](/blog/agent-zero/day-304-lg-reducer/) 的 reducer(第 4 步用 `operator.add`),Day 320 的 `refund_approval.py`(已按 Day 322 练习 2 加了「发票退过就跳过」),Day 323 的 v2 流格式。前四步玩具图不调模型;第 5 步和练习一共调了 5 次模型,算式在第 5 步末尾。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `router.py` 的建图部分(五行 `add_node`/`add_edge` 加一行条件边)和 `status` 分支默写出来;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 先看图:子图在父图里只是一个节点

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="父图 router:START 到 classify,classify 条件边分到 refund_flow 或 to_human。refund_flow 展开是退款审批子图:load、draft、approval,再分到 execute 或 reject。子图快照存在 refund_flow 开头的命名空间里">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12" text-anchor="middle">
    <rect x="16" y="40" width="70" height="32" rx="4" fill="none" stroke="var(--ink-faint)"/>
    <text x="51" y="61" fill="var(--ink-soft)">START</text>
    <rect x="110" y="40" width="90" height="32" rx="4" fill="none" stroke="var(--ink-soft)"/>
    <text x="155" y="61" fill="var(--ink)">classify</text>
    <rect x="240" y="20" width="110" height="32" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="295" y="41" fill="var(--ink)">refund_flow</text>
    <rect x="240" y="66" width="110" height="32" rx="4" fill="none" stroke="var(--ink-soft)"/>
    <text x="295" y="87" fill="var(--ink)">to_human</text>
    <rect x="380" y="40" width="60" height="32" rx="4" fill="none" stroke="var(--ink-faint)"/>
    <text x="410" y="61" fill="var(--ink-soft)">END</text>
    <rect x="40" y="140" width="580" height="86" rx="6" fill="var(--mem-wash)" stroke="var(--mem)" stroke-dasharray="4 3"/>
    <rect x="60" y="168" width="70" height="32" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="95" y="189" fill="var(--ink)">load</text>
    <rect x="150" y="168" width="70" height="32" rx="4" fill="var(--paper-raised)" stroke="var(--mem)"/>
    <text x="185" y="189" fill="var(--ink)">draft</text>
    <rect x="240" y="168" width="90" height="32" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="285" y="189" fill="var(--ink)">approval</text>
    <rect x="360" y="152" width="80" height="28" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="400" y="171" fill="var(--ink)">execute</text>
    <rect x="360" y="190" width="80" height="28" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="400" y="209" fill="var(--ink)">reject</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="86" y1="56" x2="110" y2="56"/><line x1="200" y1="56" x2="240" y2="36"/><line x1="200" y1="56" x2="240" y2="82"/>
    <line x1="350" y1="36" x2="380" y2="52"/><line x1="350" y1="82" x2="380" y2="62"/>
    <line x1="130" y1="184" x2="150" y2="184"/><line x1="220" y1="184" x2="240" y2="184"/>
    <line x1="330" y1="184" x2="360" y2="166"/><line x1="330" y1="184" x2="360" y2="204"/>
  </g>
  <path d="M295 52 L295 140" fill="none" stroke="var(--mem)" stroke-dasharray="4 3"/>
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">
    <text x="456" y="40">父图(命名空间 '')</text>
    <text x="456" y="58">只知道「卡在 refund_flow」</text>
    <text x="456" y="178">子图(命名空间</text>
    <text x="456" y="194">'refund_flow:任务id')</text>
    <text x="456" y="210">知道「卡在 approval」</text>
    <text x="40" y="248">蓝色虚线框 = Day 320 的退款图原样放进来;琥珀色 = interrupt 停下的地方</text>
  </g>
</svg>
<figcaption>今天第 5 步的 router.py。父图眼里 refund_flow 就是一个节点,点开它才是退款审批的五个节点。快照分两个命名空间存,这是第 3 步和练习 2 要看的东西。</figcaption>
</figure>

前端类比很直接:子图就是组件。父组件只管把 props 传进去、拿回结果,不关心组件内部有几个 state、几个 effect;组件可以单独写、单独测,在别的页面也能复用。

今天的两个新概念:

- **子图(subgraph)**:编译好的图当作另一个图的一个节点。接法有两种,状态里有同名字段就直接 `add_node`,没有就在一个普通节点函数里调用子图并自己转换输入输出。
- **子图的持久化策略**:子图 `compile` 时 `checkpointer` 参数写 `None`(默认)、`True` 还是 `False`,决定子图每次被调用时是从头来、接着上次、还是根本不存快照。

## 第 1 步:最小的子图,状态同名直接加

先做一个两节点的子图 `refund_flow`(check、draft),再放进一个两节点的父图(classify、refund_flow)。父子用同一个 State 类型。

```python
# agent-zero-lab/part05/lg_sub/sub_shared.py
from typing import TypedDict

from langgraph.graph import START, StateGraph


class State(TypedDict):
    ticket: str
    category: str
    proposal: str


def check(state: State) -> dict:
    return {"proposal": f"核对 {state['ticket']} 的发票"}


def draft(state: State) -> dict:
    return {"proposal": state["proposal"] + " → 建议退 2392 元"}


sub = StateGraph(State)
sub.add_node("check", check)
sub.add_node("draft", draft)
sub.add_edge(START, "check")
sub.add_edge("check", "draft")
refund_flow = sub.compile()


def classify(state: State) -> dict:
    return {"category": "refund"}


main = StateGraph(State)
main.add_node("classify", classify)
main.add_node("refund_flow", refund_flow)
main.add_edge(START, "classify")
main.add_edge("classify", "refund_flow")
graph = main.compile()
inputs: State = {"ticket": "T1041", "category": "", "proposal": ""}

if __name__ == "__main__":
    print("invoke:", graph.invoke(inputs))
    print("== 不带 subgraphs")
    for part in graph.stream(inputs, stream_mode="updates", version="v2"):
        print(part["ns"], part["data"])
    print("== subgraphs=True")
    for part in graph.stream(inputs, stream_mode="updates", subgraphs=True, version="v2"):
        print(part["ns"], part["data"])
```

<div class="line-notes">

- `class State(TypedDict):` 父图和子图共用的状态,三个字段。
- `return {"proposal": f"核对 {state['ticket']} 的发票"}` 子图第一个节点,读父图传进来的 `ticket`。
- `return {"proposal": state["proposal"] + " → 建议退 2392 元"}` 子图第二个节点,在上一步的基础上接着写。
- `sub = StateGraph(State)` 子图的建法和普通图完全一样,Day 299 那套骨架。
- `refund_flow = sub.compile()` 编译出来的就是一个图对象。注意这里没传 checkpointer,第 4 步会专门讲这个。
- `return {"category": "refund"}` 父图的分类节点,先写死。
- `main.add_node("refund_flow", refund_flow)` 今天的核心一行。第二个参数平时传函数,这里传一个编译好的图,LangGraph 认得,就把它当子图。
- `main.add_edge("classify", "refund_flow")` 连边的时候它和普通节点没有区别。
- `inputs: State = {"ticket": "T1041", "category": "", "proposal": ""}` 输入单独存一个变量,练习 1 要导入。
- `print("invoke:", graph.invoke(inputs))` 整张图跑一遍,看最终状态。
- `for part in graph.stream(inputs, stream_mode="updates", version="v2"):` Day 323 的 v2 写法,先不开 subgraphs。
- `print(part["ns"], part["data"])` 打出命名空间和数据。
- `for part in graph.stream(inputs, stream_mode="updates", subgraphs=True, version="v2"):` 多一个 `subgraphs=True`,子图内部的每一步也会推出来。

</div>

```bash
cd agent-zero-lab/part05
mkdir -p lg_sub && cd lg_sub
uv run python sub_shared.py
```

```text
invoke: {'ticket': 'T1041', 'category': 'refund', 'proposal': '核对 T1041 的发票 → 建议退 2392 元'}
== 不带 subgraphs
() {'classify': {'category': 'refund'}}
() {'refund_flow': {'ticket': 'T1041', 'category': 'refund', 'proposal': '核对 T1041 的发票 → 建议退 2392 元'}}
== subgraphs=True
() {'classify': {'category': 'refund'}}
('refund_flow:063a8de2-f897-ccc9-3472-48c1b2e482d1',) {'check': {'proposal': '核对 T1041 的发票'}}
('refund_flow:063a8de2-f897-ccc9-3472-48c1b2e482d1',) {'draft': {'proposal': '核对 T1041 的发票 → 建议退 2392 元'}}
() {'refund_flow': {'ticket': 'T1041', 'category': 'refund', 'proposal': '核对 T1041 的发票 → 建议退 2392 元'}}
```

三件事。

第一,子图读到了父图 classify 写的东西,也把 `proposal` 写回了父图。同名字段直接共享,官方文档的说法是子图「读写和父图相同的 channel」。channel 就是状态里的一个字段。

第二,不开 subgraphs 时,父图只看到 `refund_flow` 这一个节点跑完,它的「修改」是子图跑完后的**整份状态**(三个字段都在),不像普通节点只给它改过的字段。在父图眼里,子图就是一个返回了一大坨字典的节点。

第三,开了 subgraphs,子图里的 check 和 draft 也推了出来,`ns` 不再是空的,而是 `('refund_flow:063a8de2-...',)`:冒号前面是子图在父图里的节点名,后面是这次执行的任务 id,每次跑都不一样。父图自己的那几项 `ns` 还是 `()`。前端要做「流程进度」时,靠 `ns` 就能分出哪一行是外层、哪一行是子流程里的。`ns` 是一个元组,因为子图里还能再套子图,套几层就有几个元素。

## 第 2 步:状态没有同名字段,包一层函数

真实情况往往是父图和子图各有各的状态。退款图的状态叫 `ticket_id`、`proposal`、`decision`,路由图可能叫 `ticket`、`answer`。先直接加进去,看会发生什么:

```python
# agent-zero-lab/part05/lg_sub/sub_mismatch.py
from typing import TypedDict

from langgraph.graph import START, StateGraph


class RefundState(TypedDict):
    ticket_id: str
    proposal: str


def draft(state: RefundState) -> dict:
    print("  子图收到:", state)
    return {"proposal": f"{state.get('ticket_id')} 建议退 2392 元"}


sub = StateGraph(RefundState)
sub.add_node("draft", draft)
sub.add_edge(START, "draft")
refund_flow = sub.compile()


class RouterState(TypedDict):
    ticket: str
    answer: str


main = StateGraph(RouterState)
main.add_node("refund_flow", refund_flow)
main.add_edge(START, "refund_flow")
graph = main.compile()

if __name__ == "__main__":
    print(graph.invoke({"ticket": "T1041", "answer": ""}))
```

<div class="line-notes">

- `class RefundState(TypedDict):` 子图的状态,字段名是 `ticket_id` 和 `proposal`。
- `print("  子图收到:", state)` 把子图拿到的状态原样打出来。
- `return {"proposal": f"{state.get('ticket_id')} 建议退 2392 元"}` 用 `.get` 而不是 `["ticket_id"]`,不然下面会直接 KeyError,看不到「安静」的那个现象。`.get` 取不到返回 `None`,相当于 JS 的 `state.ticket_id`(拿到 undefined)。
- `class RouterState(TypedDict):` 父图状态,字段名是 `ticket` 和 `answer`,和子图一个都不重名。
- `main.add_node("refund_flow", refund_flow)` 照第 1 步的写法直接加。
- `print(graph.invoke({"ticket": "T1041", "answer": ""}))` 看最后父图状态。

</div>

```bash
uv run python sub_mismatch.py
```

```text
  子图收到: {}
{'ticket': 'T1041', 'answer': ''}
```

**没有任何报错。** 子图收到一个空字典,写出来的 `proposal` 父图没有这个字段,也被悄悄丢掉了。最后父图状态和输入一模一样,就像这个节点没跑过。这是今天最容易踩的坑:直接加子图时,父子之间只靠同名字段传数据,一个都不重名就什么都不传,LangGraph 也不提醒你。如果子图节点里写的是 `state["ticket_id"]`,你会看到一个 `KeyError: 'ticket_id'`,倒是比这安静的失败好查。

状态不同时的正确做法,是在父图里写一个普通节点函数,在函数里自己调用子图,并负责翻译:

```python
# agent-zero-lab/part05/lg_sub/sub_wrapped.py
from typing import TypedDict

from langgraph.graph import START, StateGraph

from sub_mismatch import RouterState, refund_flow


def run_refund(state: RouterState) -> dict:
    out = refund_flow.invoke({"ticket_id": state["ticket"], "proposal": ""})
    return {"answer": out["proposal"]}


main = StateGraph(RouterState)
main.add_node("refund", run_refund)
main.add_edge(START, "refund")
graph = main.compile()

print(graph.invoke({"ticket": "T1041", "answer": ""}))
```

<div class="line-notes">

- `from sub_mismatch import RouterState, refund_flow` 复用上一个文件里的子图和父图状态。上一个文件有 `if __name__ == "__main__":`,导入时不会跑它的 invoke。
- `def run_refund(state: RouterState) -> dict:` 一个普通的父图节点,参数是父图状态。
- `out = refund_flow.invoke({"ticket_id": state["ticket"], "proposal": ""})` 把父图的 `ticket` 翻译成子图要的 `ticket_id`,调子图。子图跑完返回它自己的完整状态。前端类比:父组件把自己的 `ticket` 作为 prop `ticketId` 传给子组件。
- `return {"answer": out["proposal"]}` 再把子图的 `proposal` 翻译回父图的 `answer`。
- `main.add_node("refund", run_refund)` 这次加的是函数,不是图。

</div>

```bash
uv run python sub_wrapped.py
```

```text
  子图收到: {'ticket_id': 'T1041', 'proposal': ''}
{'ticket': 'T1041', 'answer': 'T1041 建议退 2392 元'}
```

这次子图拿到了 `ticket_id`,父图也拿到了 `answer`。两种接法怎么选,官方文档讲得很简单:状态有共享字段就直接加,状态不同就在节点里调用。我自己的经验是,子图是别人写的、或者以后可能单独拿出去用,就倾向于包一层函数,父子之间传什么写得清清楚楚,改一边的字段名不会悄悄弄坏另一边。在节点函数里调子图,LangGraph 照样认得它是子图,下面讲的 interrupt、快照、持久化都一样生效。

## 第 3 步:子图里停下来,从父图找到它

退款审批的 approval 节点里有 interrupt。子图里停下时,父图看到的是什么?恢复时对谁发 `Command`?

```python
# agent-zero-lab/part05/lg_sub/sub_interrupt.py
from typing import TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import START, StateGraph
from langgraph.types import Command, StateSnapshot, interrupt


class State(TypedDict):
    ticket: str
    proposal: str
    decision: str


def draft(state: State) -> dict:
    print("  [draft 执行]")
    return {"proposal": f"{state['ticket']} 建议退 2392 元"}


def ask(state: State) -> dict:
    return {"decision": interrupt(f"{state['proposal']},批不批?")}


sub = StateGraph(State)
sub.add_node("draft", draft)
sub.add_node("ask", ask)
sub.add_edge(START, "draft")
sub.add_edge("draft", "ask")


def build(checkpointer: bool | None = None):
    main = StateGraph(State)
    main.add_node("refund_flow", sub.compile(checkpointer=checkpointer))
    main.add_edge(START, "refund_flow")
    return main.compile(checkpointer=InMemorySaver())


if __name__ == "__main__":
    graph = build()
    config: RunnableConfig = {"configurable": {"thread_id": "S1"}}
    result = graph.invoke({"ticket": "T1041", "proposal": "", "decision": ""}, config)
    print("中断内容:", result["__interrupt__"][0].value)

    parent = graph.get_state(config)
    print("父图 next =", parent.next)
    print("不带 subgraphs:", parent.tasks[0].state)
    child = graph.get_state(config, subgraphs=True).tasks[0].state
    if isinstance(child, StateSnapshot):
        print("带 subgraphs:", child.values, "子图 next =", child.next)

    print("恢复:", graph.invoke(Command(resume="批"), config))
```

<div class="line-notes">

- `from langgraph.types import Command, StateSnapshot, interrupt` `StateSnapshot` 就是 `get_state` 返回的快照类型,Day 317 天天打印的那种对象,下面要用它判断类型。
- `print("  [draft 执行]")` 数 draft 执行了几次,第 4 步要用。
- `return {"decision": interrupt(f"{state['proposal']},批不批?")}` 子图第二个节点停下等人。恢复时 `interrupt(...)` 的返回值就是 `Command(resume=...)` 里给的值,Day 319 学过。
- `def build(checkpointer: bool | None = None):` 把「建父图」包成一个函数,参数是子图的持久化策略,第 4 步会传不同的值进来。`bool | None` 就是 TS 的 `boolean | null`。今天这一步用默认的 `None`。
- `main.add_node("refund_flow", sub.compile(checkpointer=checkpointer))` 子图编译时传入策略。`None` 的意思不是「没有 checkpointer」,而是「跟着父图用」。
- `return main.compile(checkpointer=InMemorySaver())` 只有父图真正带了一个 checkpointer。interrupt 要能用,父图必须有 checkpointer。
- `result = graph.invoke({"ticket": "T1041", "proposal": "", "decision": ""}, config)` 跑到子图的 ask 停下。
- `print("中断内容:", result["__interrupt__"][0].value)` 中断照样冒到父图的返回值里,和普通节点里的 interrupt 一样取。
- `parent = graph.get_state(config)` 父图当前的快照。
- `print("父图 next =", parent.next)` 父图只知道下一步要跑 `refund_flow`,不知道里面停在哪。
- `print("不带 subgraphs:", parent.tasks[0].state)` `tasks` 是这一步要执行的任务列表,`tasks[0]` 就是 refund_flow。默认它的 `state` 只是一个指向子图快照的 config。
- `child = graph.get_state(config, subgraphs=True).tasks[0].state` 加 `subgraphs=True`,这个位置才会放进子图的完整快照。
- `if isinstance(child, StateSnapshot):` 类型上它可能是 config 字典也可能是快照,判断一下检查器才放心,运行时这里一定是快照。
- `print("带 subgraphs:", child.values, "子图 next =", child.next)` 子图的状态和它的 `next`。
- `print("恢复:", graph.invoke(Command(resume="批"), config))` 恢复照样对父图发,用父图的 config,LangGraph 自己找到子图里那个中断。

</div>

```bash
uv run python sub_interrupt.py
```

```text
  [draft 执行]
中断内容: T1041 建议退 2392 元,批不批?
父图 next = ('refund_flow',)
不带 subgraphs: {'configurable': {'thread_id': 'S1', 'checkpoint_ns': 'refund_flow:1b14429b-fbb1-13bc-2f60-442309a93d2e'}}
带 subgraphs: {'ticket': 'T1041', 'proposal': 'T1041 建议退 2392 元', 'decision': ''} 子图 next = ('ask',)
恢复: {'ticket': 'T1041', 'proposal': 'T1041 建议退 2392 元', 'decision': '批'}
```

父图 `next` 是 `('refund_flow',)`,子图 `next` 是 `('ask',)`,一外一内,和开头那张图对得上。不带 subgraphs 时那个 config 里的 `checkpoint_ns`,和第 1 步流里的 `ns` 是同一个格式。子图的快照就存在这个命名空间下,和父图的快照放在同一个 checkpointer 里,只是「抽屉里再分一个格子」。

恢复时 draft 没有再打印,说明子图从 ask 接着跑,而不是从头。这件事不是天经地义的,下一步就会看到它取决于子图的持久化策略。

做审批后台时这一点很实用:列表页想显示「这张单停在哪个审批环节」,只查 `get_state(config)` 只能看到「停在退款流程里」,要 `subgraphs=True` 才知道是哪一步。

## 第 4 步:子图的三种持久化策略

子图 `compile(checkpointer=...)` 可以写三个值。官方文档给它们起了名字:

| 写法 | 名字 | 一句话 |
| --- | --- | --- |
| `None`(默认) | per-invocation,每次调用独立 | 用父图的 checkpointer,一次调用之内能停能续;下次再调,从空状态开始 |
| `True` | per-thread,每条线记住 | 同一个 thread 上,这次调用接着上次的状态 |
| `False` | stateless,不存 | 不存任何快照,就像调一个普通函数 |

光看表很难有感觉,先用一个「记笔记」的子图看 None 和 True 的区别。子图的状态是一个用 `operator.add` 合并的列表(Day 304 的 reducer:每次返回的列表接到后面),父图同一个 thread 上跑三轮,每轮调一次子图。

```python
# agent-zero-lab/part05/lg_sub/sub_memory.py
import operator
from typing import Annotated, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import START, StateGraph


class SubState(TypedDict):
    notes: Annotated[list[str], operator.add]


def take_note(state: SubState) -> dict:
    print("    子图看到:", state["notes"])
    return {"notes": ["子图记了一笔"]}


sub = StateGraph(SubState)
sub.add_node("take_note", take_note)
sub.add_edge(START, "take_note")


class MainState(TypedDict):
    round: int


for mode in (None, True):
    notebook = sub.compile(checkpointer=mode)

    def call(state: MainState) -> dict:
        notebook.invoke({"notes": [f"第 {state['round']} 轮"]})
        return {}

    main = StateGraph(MainState)
    main.add_node("call", call)
    main.add_edge(START, "call")
    graph = main.compile(checkpointer=InMemorySaver())
    config: RunnableConfig = {"configurable": {"thread_id": "M1"}}

    print("checkpointer =", mode)
    for r in (1, 2, 3):
        graph.invoke({"round": r}, config)
```

<div class="line-notes">

- `notes: Annotated[list[str], operator.add]` 带 reducer 的字段:节点返回的列表会接在原列表后面,而不是覆盖。所以如果子图记得上次的状态,列表会越来越长。
- `print("    子图看到:", state["notes"])` 每次进子图时打印它看到的笔记。
- `return {"notes": ["子图记了一笔"]}` 子图每跑一次往笔记里加一条。
- `for mode in (None, True):` 两种策略各跑一遍。`(None, True)` 是元组,for 遍历它和遍历列表一样。
- `notebook = sub.compile(checkpointer=mode)` 同一个 builder 编译两次,只有策略不同。
- `def call(state: MainState) -> dict:` 第 2 步学的「在节点里调用子图」。
- `notebook.invoke({"notes": [f"第 {state['round']} 轮"]})` 每轮给子图一条新笔记。返回值这里不用。
- `return {}` 父图状态什么也不改。节点可以返回空字典。
- `graph = main.compile(checkpointer=InMemorySaver())` 父图每种策略各建一个新的内存 checkpointer,两种策略互不影响。
- `config: RunnableConfig = {"configurable": {"thread_id": "M1"}}` 三轮都用同一个 thread。
- `for r in (1, 2, 3):` 同一个 thread 上跑三次父图。
- `graph.invoke({"round": r}, config)` 每次传新的 `round`。Day 321 说过对已存在的线传新输入会从 START 再跑一遍,这里正是要它每轮都调一次子图。

</div>

```bash
uv run python sub_memory.py
```

```text
checkpointer = None
    子图看到: ['第 1 轮']
    子图看到: ['第 2 轮']
    子图看到: ['第 3 轮']
checkpointer = True
    子图看到: ['第 1 轮']
    子图看到: ['第 1 轮', '子图记了一笔', '第 2 轮']
    子图看到: ['第 1 轮', '子图记了一笔', '第 2 轮', '子图记了一笔', '第 3 轮']
```

`None` 时子图每次都只看到这一轮的输入,上一轮记的笔记没了;`True` 时笔记越积越多,同一个 thread 上子图记得之前所有调用。什么时候要 `True`?典型场景是子图本身是一个要多轮对话的 Agent,比如一个「研究助理」子 Agent,用户隔几轮又让它接着查,它要记得自己之前查过什么。退款审批每张工单一次性办完,用默认的 `None` 就对了。

`True` 有一个限制要记住:同一个子图在同一个 thread 上被并行调用(比如 Day 310 的 Send 同时派出好几份),它们会往同一个命名空间写快照,互相打架。官方文档明确说 per-thread 子图不支持这种并行调用。

再看 `False`。复用第 3 步的 `build`,分别传 `None` 和 `False`,都是跑到 interrupt、看子图快照、再恢复:

```python
# agent-zero-lab/part05/lg_sub/sub_stateless.py
from langchain_core.runnables import RunnableConfig
from langgraph.types import Command

from sub_interrupt import build

for mode in (None, False):
    print("checkpointer =", mode)
    graph = build(mode)
    config: RunnableConfig = {"configurable": {"thread_id": "S2"}}
    graph.invoke({"ticket": "T1041", "proposal": "", "decision": ""}, config)
    print("  子图快照:", type(graph.get_state(config, subgraphs=True).tasks[0].state).__name__)
    print("  恢复:", graph.invoke(Command(resume="批"), config))
```

<div class="line-notes">

- `from sub_interrupt import build` 第 3 步那个「按策略建父图」的函数。
- `graph = build(mode)` 每种策略建一张新图,父图各带一个新的内存 checkpointer。
- `graph.invoke({"ticket": "T1041", "proposal": "", "decision": ""}, config)` 跑到 ask 停下,draft 打印一次。
- `print("  子图快照:", type(graph.get_state(config, subgraphs=True).tasks[0].state).__name__)` `type(x).__name__` 拿到类型的名字,相当于 JS 的 `x.constructor.name`。只想知道有没有拿到快照,不打内容。
- `print("  恢复:", graph.invoke(Command(resume="批"), config))` 恢复,数一数 draft 又打印了几次。

</div>

```bash
uv run python sub_stateless.py
```

```text
checkpointer = None
  [draft 执行]
  子图快照: StateSnapshot
  恢复: {'ticket': 'T1041', 'proposal': 'T1041 建议退 2392 元', 'decision': '批'}
checkpointer = False
  [draft 执行]
  子图快照: NoneType
  [draft 执行]
  恢复: {'ticket': 'T1041', 'proposal': 'T1041 建议退 2392 元', 'decision': '批'}
```

`False` 时有两个不同:`subgraphs=True` 也拿不到子图快照(`NoneType` 就是 None),而且**恢复时 draft 又执行了一次**。子图不存快照,它不知道自己上次走到了哪,父图恢复时只能把整个子图从头跑一遍,一路跑到 ask,这时才把 `resume` 的值交给 interrupt。

官方文档的表格里写 stateless 子图不支持 interrupt。我实测是「能停也能恢复」,但代价就是上面这样,恢复时整个子图重跑。我的理解是文档说的「不支持」指的是不支持「从停下的地方接着跑」。玩具图里 draft 重跑无所谓,换成退款图,draft 是调模型的,重跑就要多花一次钱,而且模型可能写出一个和主管看到的不一样的方案。练习 3 会在真的退款图上验证这一点。

所以三种怎么选:带 interrupt 或者要「崩了能续」的子图,不要用 `False`;要跨调用记住东西的用 `True`,但注意并行;其他情况用默认 `None`。`False` 适合那种纯计算、很快、没有副作用、也不需要人介入的小流程。

## 第 5 步:把退款审批装进路由图

现在做真的。新建 `router.py`,放在 `lgdemo/` 下,和 `refund_approval.py` 同一个目录,直接导入它的 `builder`。主图先按工单标题分类(这里用关键词,不调模型,[Day 312](/blog/agent-zero/day-312-lg-workflow/) 讲过用模型做结构化输出分类,想换随时可以换),退款类进退款子图,其他转人工。

用哪种接法?退款图的状态是 `RefundState`(`ticket_id`、`ticket_text`、`invoices`、`proposal`、`decision`、`outcome`),输入只要 `ticket_id`。路由图只关心 `ticket_id` 进去、`outcome` 出来,让这两个字段同名,就可以直接加。

```python
# agent-zero-lab/part05/lgdemo/router.py
"""工单路由主图:先按标题分类,退款类交给 Day 320 的退款审批子图,其他转人工。

用法(在 agent-zero-lab/part05/lgdemo 目录下):
  uv run python router.py start T1041              # 退款类:进子图,停在审批点
  uv run python router.py start T1001              # 非退款类:直接转人工
  uv run python router.py status T1041             # 父图和子图各停在哪
  uv run python router.py approve T1041 "核实无误"
  uv run python router.py reject T1041 "金额不对"
"""
import sqlite3
import sys
from pathlib import Path
from typing import TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, StateSnapshot

from refund_approval import biz
from refund_approval import builder as refund_builder

ROUTER_DB = Path(__file__).with_name("router.db")
REFUND_WORDS = ("退款", "扣款")


class RouterState(TypedDict):
    ticket_id: str
    subject: str
    category: str
    outcome: str


class RouterInput(TypedDict):
    ticket_id: str


def classify(state: RouterState) -> dict:
    with biz() as conn:
        row = conn.execute("SELECT subject FROM tickets WHERE id = ?", (state["ticket_id"],)).fetchone()
    subject = row["subject"] if row else ""
    category = "refund" if any(w in subject for w in REFUND_WORDS) else "other"
    return {"subject": subject, "category": category}


def to_human(state: RouterState) -> dict:
    return {"outcome": f"「{state['subject']}」不是退款类,转人工客服"}


def route(state: RouterState) -> str:
    return "refund_flow" if state["category"] == "refund" else "to_human"


refund_flow = refund_builder.compile()

builder = StateGraph(RouterState, input_schema=RouterInput)
builder.add_node("classify", classify)
builder.add_node("refund_flow", refund_flow)
builder.add_node("to_human", to_human)
builder.add_edge(START, "classify")
builder.add_conditional_edges("classify", route, ["refund_flow", "to_human"])
builder.add_edge("refund_flow", END)
builder.add_edge("to_human", END)


def main() -> None:
    action, ticket_id = sys.argv[1], sys.argv[2]
    note = sys.argv[3] if len(sys.argv) > 3 else ""
    config: RunnableConfig = {"configurable": {"thread_id": f"router-{ticket_id}"}}

    with sqlite3.connect(ROUTER_DB, check_same_thread=False) as conn:
        graph = builder.compile(checkpointer=SqliteSaver(conn))

        if action == "start":
            for part in graph.stream({"ticket_id": ticket_id}, config, stream_mode="updates", subgraphs=True, version="v2"):
                if part["type"] != "updates":
                    continue
                where = "父图" if not part["ns"] else "子图 " + part["ns"][0].split(":")[0]
                for node, upd in part["data"].items():
                    print(f"[{where}] {node}:", list(upd) if isinstance(upd, dict) else "等待审批")
            print("结果:", graph.get_state(config).values.get("outcome", "(还没有,停在审批点)"))
        elif action == "status":
            snap = graph.get_state(config, subgraphs=True)
            print("父图 next =", snap.next)
            if snap.tasks and isinstance(snap.tasks[0].state, StateSnapshot):
                child = snap.tasks[0].state
                print("子图 next =", child.next, "方案:", child.values.get("proposal"))
        elif action in ("approve", "reject"):
            result = graph.invoke(Command(resume={"approved": action == "approve", "note": note}), config)
            print(result["outcome"])
        else:
            print("不认识的命令:", action)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from refund_approval import biz` Day 320 打开业务库的函数,路由图查工单标题也用它。
- `from refund_approval import builder as refund_builder` 退款图的 builder。两个文件里都叫 `builder`,`as` 给它起个别名,相当于 JS 的 `import { builder as refundBuilder }`。
- `ROUTER_DB = Path(__file__).with_name("router.db")` 路由图用一个新的 checkpoint 库,不和 Day 320 的 `checkpoints.db` 混在一起。两边的 thread_id 规则也不同(`router-T1041` 对 `refund-T1041`),分开放更清楚。
- `REFUND_WORDS = ("退款", "扣款")` 标题里带这两个词就算退款类。CloudLedger 的工单标题里有「申请退款」5 张、「重复扣款」8 张。
- `class RouterState(TypedDict):` 路由图的状态。`ticket_id` 和 `outcome` 与退款图同名,这是父子之间唯一的两条通道。
- `class RouterInput(TypedDict):` 输入只要 `ticket_id`,和 Day 320 的 `RefundInput` 一样的用法。
- `row = conn.execute("SELECT subject FROM tickets WHERE id = ?", (state["ticket_id"],)).fetchone()` 查工单标题。`?` 占位符防注入,Day 92 学过。
- `subject = row["subject"] if row else ""` 工单不存在时给空标题,会被分到 other。
- `category = "refund" if any(w in subject for w in REFUND_WORDS) else "other"` `any(...)` 只要有一个为真就是真,相当于 JS 的 `REFUND_WORDS.some(w => subject.includes(w))`。
- `return {"outcome": f"「{state['subject']}」不是退款类,转人工客服"}` 非退款类的出口。真系统里这里会建一张人工工单。
- `return "refund_flow" if state["category"] == "refund" else "to_human"` 条件边的路由函数,返回下一个节点的名字,Day 306 学过。
- `refund_flow = refund_builder.compile()` 子图编译,不传 checkpointer,也就是第 4 步的默认 `None`:跟着父图存,一次调用之内能停能续。
- `builder.add_node("refund_flow", refund_flow)` Day 320 那张五个节点的图,在这里是一个节点。
- `builder.add_conditional_edges("classify", route, ["refund_flow", "to_human"])` 第三个参数列出可能去的节点,画图时用得上。
- `builder.add_edge("refund_flow", END)` 子图跑完,父图也结束。
- `config: RunnableConfig = {"configurable": {"thread_id": f"router-{ticket_id}"}}` 父图的 thread_id。子图不需要自己的 thread_id,它的快照放在父图这条线的子命名空间里。
- `for part in graph.stream({"ticket_id": ticket_id}, config, stream_mode="updates", subgraphs=True, version="v2"):` start 用流式跑,把子图内部的步骤也打出来。
- `if part["type"] != "updates":` 只开了一种模式,这句是给类型检查器收窄用的,没有它下面 `.items()` 会标红。
- `where = "父图" if not part["ns"] else "子图 " + part["ns"][0].split(":")[0]` `ns` 为空就是父图;否则取第一个元素冒号前面的部分,就是子图的节点名 `refund_flow`。
- `for node, upd in part["data"].items():` `.items()` 同时遍历键和值,相当于 JS 的 `Object.entries(...)`。
- `print(f"[{where}] {node}:", list(upd) if isinstance(upd, dict) else "等待审批")` 普通节点的修改是字典,只打它改了哪些字段;`__interrupt__` 的值是元组,打「等待审批」。
- `print("结果:", graph.get_state(config).values.get("outcome", "(还没有,停在审批点)"))` 跑完或停下之后看父图的 `outcome`。
- `snap = graph.get_state(config, subgraphs=True)` status 要带 `subgraphs=True`,才看得到子图停在哪。
- `if snap.tasks and isinstance(snap.tasks[0].state, StateSnapshot):` 没停在子图里时 `tasks` 是空元组,先判空。
- `print("子图 next =", child.next, "方案:", child.values.get("proposal"))` 子图里的方案只在子图的快照里有,父图状态没有 `proposal` 字段。
- `result = graph.invoke(Command(resume={"approved": action == "approve", "note": note}), config)` 恢复对父图发,和第 3 步一样。
- `print(result["outcome"])` 子图 execute 写的 `outcome`,通过同名字段回到了父图。

</div>

先试一张不是退款的工单,再试 T1041:

```bash
cd agent-zero-lab && uv run python cloudledger/seed.py && cd part05/lgdemo
rm -f router.db
uv run python router.py start T1001
uv run python router.py start T1041
uv run python router.py status T1041
uv run python router.py approve T1041 "核实无误"
sqlite3 ../../cloudledger/cloudledger.db "select id, invoice_id, amount_cents, status from refund_requests"
```

```text
已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}
[父图] classify: ['subject', 'category']
[父图] to_human: ['outcome']
结果: 「导出报表报错」不是退款类,转人工客服
[父图] classify: ['subject', 'category']
[子图 refund_flow] load: ['ticket_text', 'invoices']
[子图 refund_flow] draft: ['proposal']
[子图 refund_flow] __interrupt__: 等待审批
[父图] __interrupt__: 等待审批
结果: (还没有,停在审批点)
父图 next = ('refund_flow',)
子图 next = ('approval',) 方案: {'invoice_id': 'INV-2026-0123', 'amount_yuan': 2392.0, 'reason': '与 INV-2026-0026 为同日同额重复扣款，INV-2026-0123 为较晚生成的一张，退还该笔重复款项'}
已批准:INV-2026-0123 退 2392.00 元。审批备注:核实无误
1|INV-2026-0123|239200|approved
```

T1001「导出报表报错」走了 to_human,一次模型都没调。T1041 进了子图,load、draft 都在子图里跑,停在审批点时 `__interrupt__` 推了两次:子图里一次,父图一次。中断是从子图里冒上来的,每一层都会看到它。

`status` 两层都看得到。approve 之后 `outcome` 回到了父图,业务库里有一行 2392 元的退款。整个过程中 `refund_approval.py` 一个字没改,它照样能单独 `start T1041` 用,也能作为子图用。这就是子图的价值:退款流程在一个地方写、一个地方测,主图只管分流。

### 这一天的花费

调模型的只有退款子图的 draft。我写这篇时调了 5 次:第 5 步 1 次,练习 3 两种策略共 3 次(False 那次恢复时重跑多调 1 次),练习 4 1 次。按 Day 320 第 2 步算出的约 0.00125 元一次:5 × 0.00125 ≈ 0.006 元。

## 放到真实系统里长什么样

命令行里审批人和 Agent 在同一个终端,真实系统当然不是这样。做过 OA 或工单审批的后端同学对下面这个形状不会陌生,第七部分做服务化时我们会真的把它写出来。

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="真实系统里的审批:Agent 服务的处理工单接口调 router 图,停在 interrupt 时写一行 pending_approvals 表并通知主管;主管在后台点批准,提交审批接口先在表上抢到这一行,再用 Command resume 恢复图;另有一个定时任务扫描超时记录">
  <rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12" text-anchor="middle">
    <rect x="16" y="30" width="120" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="76" y="55" fill="var(--ink)">POST 处理工单</text>
    <rect x="186" y="30" width="120" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="246" y="55" fill="var(--ink)">router 图</text>
    <rect x="356" y="30" width="140" height="40" rx="4" fill="none" stroke="var(--ink-soft)"/>
    <text x="426" y="55" fill="var(--ink)">pending_approvals</text>
    <rect x="530" y="30" width="94" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="577" y="55" fill="var(--ink)">通知主管</text>
    <rect x="356" y="120" width="140" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="426" y="145" fill="var(--ink)">POST 提交审批</text>
    <rect x="186" y="120" width="120" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="246" y="145" fill="var(--ink)">Command(resume)</text>
    <rect x="530" y="120" width="94" height="40" rx="4" fill="none" stroke="var(--ink-soft)"/>
    <text x="577" y="145" fill="var(--ink)">超时扫描</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="136" y1="50" x2="186" y2="50"/><line x1="306" y1="50" x2="356" y2="50"/><line x1="496" y1="50" x2="530" y2="50"/>
    <line x1="426" y1="70" x2="426" y2="120"/><line x1="356" y1="140" x2="306" y2="140"/>
    <line x1="577" y1="120" x2="496" y2="62"/>
  </g>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
    <text x="312" y="44">停在 interrupt 就写一行</text>
    <text x="432" y="100">先抢 pending → approved</text>
    <text x="16" y="196">并发:只有把 pending 改成 approved 成功的那个请求才去恢复图;超时:定时任务把放太久的记录自动驳回或升级</text>
  </g>
</svg>
<figcaption>Agent 服务对外两个接口。图在 interrupt 停下时,服务把 thread_id 和中断内容写进待审批表;主管点按钮时先改表,改成功了才恢复图。练习 4 会用命令行把这个表做出来。</figcaption>
</figure>

Agent 服务对外提供两个接口。一个是「处理工单」:收到工单后用 `router-{工单号}` 作为 thread_id 调用图,如果停在了 interrupt,就把 thread_id 和中断内容(发票号、金额、理由)写进一张 `pending_approvals` 表,然后给主管推一条消息。另一个是「提交审批」:主管在后台点批准或驳回,前端调这个接口,接口从表里查出 thread_id,用 `Command(resume=...)` 恢复图,跑完后更新表里的状态。

有三个细节第一次做很容易漏。

第一是**超时**:主管三天没处理怎么办?要有一个定时任务扫描超时的待审批记录,按规则自动驳回或者升级给上一级。定时任务明天就讲。

第二是**并发**:两个主管同时点了批准,同一个 thread 会被恢复两次。所以「提交审批」接口要先在表上做一个原子的状态切换,`UPDATE ... SET status='approved' WHERE thread_id=? AND status='pending'`,只有改到了一行的那个请求才去恢复图,另一个看到 0 行就直接返回「已有人处理」。这叫乐观锁,练习 4 会实跑。

第三是**审计**:谁在什么时候批了什么,要留痕。LangGraph 的 checkpoint 历史本身是一份很详细的执行记录(Day 322 练习 4 读过),但它的格式会随版本变,也可能被定期清理,不是给审计人员看的,业务表里还要单独记一笔。

这三个问题和 LangGraph 无关,换任何框架都得处理。框架省掉的是「状态怎么存、执行位置怎么恢复」这部分最容易出错的底层工作,业务规则还得自己想清楚。面试时能把这几点说出来,面试官会知道你真的做过,而不是只跑过教程。

## 动手练习

**练习 1:单独测试子图。** 子图的一个好处是能单独测。不经过父图,直接调用第 1 步的 `refund_flow`,用两个 `assert` 检查它的输出。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg_sub/test_refund_flow.py
from sub_shared import refund_flow

out = refund_flow.invoke({"ticket": "T2000", "category": "", "proposal": ""})
print(out)
assert out["proposal"] == "核对 T2000 的发票 → 建议退 2392 元"
assert out["category"] == ""
print("子图单测通过")
```

<div class="line-notes">

- `from sub_shared import refund_flow` 只导入子图,父图那段不用。
- `out = refund_flow.invoke({"ticket": "T2000", "category": "", "proposal": ""})` 编译好的子图本身就是一张完整的图,可以直接 invoke。用一个父图里不会出现的工单号,证明它不依赖父图。
- `assert out["proposal"] == "核对 T2000 的发票 → 建议退 2392 元"` `assert 条件` 条件为假就抛 `AssertionError`,相当于测试里的 `expect(...).toBe(...)`。
- `assert out["category"] == ""` 子图不碰 `category`,输入什么出来就是什么。没有 classify,这个字段保持空字符串。

</div>

```bash
cd agent-zero-lab/part05/lg_sub
uv run python test_refund_flow.py
```

```text
{'ticket': 'T2000', 'category': '', 'proposal': '核对 T2000 的发票 → 建议退 2392 元'}
子图单测通过
```

这两行 assert 挪到 pytest 里(Day 71 起学的)就是一个正式的单元测试。退款子图真要测的话,draft 调模型的那一步可以用 Day 322 练习 3 的 `as_node` 技巧跳过,或者换成 Day 323 的假模型。

</details>

**练习 2:子图的快照存在哪?** 接着第 5 步(T1041 已批准),写 `router_history.py`:打印父图 `get_state_history` 的快照数和每张的 `next`,再直接查 `router.db` 的 `checkpoints` 表,按 `checkpoint_ns` 分组数一数。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lgdemo/router_history.py
import sqlite3
import sys

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite import SqliteSaver

from router import ROUTER_DB, builder

config: RunnableConfig = {"configurable": {"thread_id": f"router-{sys.argv[1]}"}}
with sqlite3.connect(ROUTER_DB, check_same_thread=False) as conn:
    graph = builder.compile(checkpointer=SqliteSaver(conn))
    history = list(graph.get_state_history(config))
    print("父图历史", len(history), "张:", [s.next for s in history])
    rows = conn.execute(
        "SELECT checkpoint_ns, COUNT(*) FROM checkpoints WHERE thread_id = ? GROUP BY checkpoint_ns",
        (config["configurable"]["thread_id"],),
    ).fetchall()
    for ns, n in rows:
        print("命名空间", repr(ns) if ns else "''(父图)", "→", n, "张")
```

<div class="line-notes">

- `from router import ROUTER_DB, builder` 用第 5 步的父图和库路径。
- `history = list(graph.get_state_history(config))` 父图这条线的历史。
- `print("父图历史", len(history), "张:", [s.next for s in history])` 列表推导式取出每张的 `next`,相当于 JS 的 `history.map(s => s.next)`。
- `"SELECT checkpoint_ns, COUNT(*) FROM checkpoints WHERE thread_id = ? GROUP BY checkpoint_ns",` 直接查 SqliteSaver 建的表。按命名空间分组计数,Day 88 的 GROUP BY。表结构是 LangGraph 内部的,这里只读不写,看看就好。
- `(config["configurable"]["thread_id"],),` 参数元组只有一个元素时要写结尾的逗号。
- `for ns, n in rows:` 每行两列,直接拆开。
- `print("命名空间", repr(ns) if ns else "''(父图)", "→", n, "张")` 空字符串是父图的命名空间。

</div>

```bash
cd agent-zero-lab/part05/lgdemo
uv run python router_history.py T1041
```

```text
父图历史 4 张: [(), ('refund_flow',), ('classify',), ('__start__',)]
命名空间 ''(父图) → 4 张
命名空间 'refund_flow:f30d79d7-b511-6d70-8ccd-4fddf99cbfdf' → 6 张
```

父图只有 4 张快照,子图那 5 个节点的过程一张都不在父图历史里;它们存在另一个命名空间下,有 6 张。两边都在同一个文件、同一个 thread 里,只是命名空间不同。所以在父图上 `get_state_history` 做时间旅行,只能回到「进子图之前」或「子图跑完之后」,回不到子图内部的某一步。想回到子图里的审批前,得用子图那边的 config,这比 Day 322 复杂一截,一般不推荐这么用。这也是为什么 Day 322 学的 rewind 我们放在了退款图自己身上。

</details>

**练习 3:把退款子图改成 `checkpointer=False`,会发生什么?** 复用 `router.py` 里的节点函数,建一张一样的父图,只把退款子图编译成 `checkpointer=False`。分别用 `None` 和 `False` 跑 start 和 approve,比较「主管审批时看到的理由」和「写进业务库的理由」,再看 approve 用了多久。每次跑之前 seed 一下。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lgdemo/router_stateless.py
import sqlite3
import sys
import time

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command

from refund_approval import builder as refund_builder
from router import ROUTER_DB, RouterInput, RouterState, classify, route, to_human

mode = {"None": None, "False": False}[sys.argv[2]]
b = StateGraph(RouterState, input_schema=RouterInput)
b.add_node("classify", classify)
b.add_node("refund_flow", refund_builder.compile(checkpointer=mode))
b.add_node("to_human", to_human)
b.add_edge(START, "classify")
b.add_conditional_edges("classify", route, ["refund_flow", "to_human"])
b.add_edge("refund_flow", END)
b.add_edge("to_human", END)

config: RunnableConfig = {"configurable": {"thread_id": f"stateless-{sys.argv[1]}-{sys.argv[2]}"}}
with sqlite3.connect(ROUTER_DB, check_same_thread=False) as conn:
    graph = b.compile(checkpointer=SqliteSaver(conn))
    first = graph.invoke({"ticket_id": sys.argv[1]}, config)
    print("审批时看到的理由:", first["__interrupt__"][0].value["reason"])
    t0 = time.time()
    print(graph.invoke(Command(resume={"approved": True, "note": "ok"}), config)["outcome"])
    print(f"approve 用时 {time.time() - t0:.2f}s")
```

<div class="line-notes">

- `from router import ROUTER_DB, RouterInput, RouterState, classify, route, to_human` 节点函数和状态都从 router.py 拿,只重新拼图。
- `mode = {"None": None, "False": False}[sys.argv[2]]` 命令行传的是字符串,用一个字典把它映射成真正的 `None` 或 `False`。
- `b.add_node("refund_flow", refund_builder.compile(checkpointer=mode))` 唯一和 router.py 不同的一行。
- `config: RunnableConfig = {"configurable": {"thread_id": f"stateless-{sys.argv[1]}-{sys.argv[2]}"}}` 两种模式用不同的 thread,互不干扰。
- `first = graph.invoke({"ticket_id": sys.argv[1]}, config)` 跑到审批点。
- `print("审批时看到的理由:", first["__interrupt__"][0].value["reason"])` 主管在审批界面上看到的那个理由。
- `t0 = time.time()` approve 计时。
- `print(graph.invoke(Command(resume={"approved": True, "note": "ok"}), config)["outcome"])` 批准。
- `print(f"approve 用时 {time.time() - t0:.2f}s")` 如果子图从头重跑,这里会包含一次模型调用的时间。

</div>

```bash
cd agent-zero-lab
uv run python cloudledger/seed.py
cd part05/lgdemo && uv run python router_stateless.py T1041 None
sqlite3 ../../cloudledger/cloudledger.db "select id, amount_cents, reason from refund_requests"
cd ../.. && uv run python cloudledger/seed.py
cd part05/lgdemo && uv run python router_stateless.py T1041 False
sqlite3 ../../cloudledger/cloudledger.db "select id, amount_cents, reason from refund_requests"
```

```text
已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}
审批时看到的理由: 与 INV-2026-0026 为 2026-10-08 同额重复扣款，INV-2026-0123 为较晚生成的一张，退还该笔重复款项
已批准:INV-2026-0123 退 2392.00 元。审批备注:ok
approve 用时 0.01s
1|239200|与 INV-2026-0026 为 2026-10-08 同额重复扣款，INV-2026-0123 为较晚生成的一张，退还该笔重复款项
已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}
审批时看到的理由: 与 INV-2026-0026 为同日(2026-10-08)同额 2392.00 元的重复扣款,INV-2026-0123 为较晚生成的一张,退还该笔重复扣款。
已批准:INV-2026-0123 退 2392.00 元。审批备注:ok
approve 用时 0.95s
1|239200|与 INV-2026-0026 为 2026-10-08 同日同额重复扣款，INV-2026-0123 为较晚生成的一张，退还该笔重复款项
```

`None` 时 approve 只用了 0.01 秒,业务库里的理由和主管看到的一字不差。`False` 时 approve 用了 0.95 秒,因为子图从 load 开始重跑,draft 又调了一次模型;写进业务库的理由和主管看到的**不是同一句话**。这次金额碰巧一样,但如果模型第二次挑了另一张发票,主管批准的是 A,实际退的是 B。审批流程最怕的就是这个。带 interrupt 的子图,不要用 `False`。

</details>

**练习 4(开放题):做一张待审批表,挡住两个主管同时批。** 照「放到真实系统里」那一节,写 `pending_router.py`:`start` 停在审批点时往 `approvals.db` 的 `pending_approvals` 表写一行;`decide` 先用 `UPDATE ... WHERE status='pending'` 抢这一行,改成功了才恢复图。用两个主管先后 decide 同一张单来验证。

<details><summary>参考答案</summary>

示范解法:待审批表单独放一个库,主键是 thread_id。抢单靠 UPDATE 的条件里带 `status = 'pending'`,看 `rowcount`。

```python
# agent-zero-lab/part05/lgdemo/pending_router.py
"""在 router.py 外面包一层待审批表:start 停在审批点就记一行,decide 只让第一个审批生效。"""
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import Command

from router import ROUTER_DB, builder

APPROVALS_DB = Path(__file__).with_name("approvals.db")


def approvals() -> sqlite3.Connection:
    conn = sqlite3.connect(APPROVALS_DB)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS pending_approvals ("
        " thread_id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL,"
        " created_at TEXT NOT NULL, decided_by TEXT, decided_at TEXT)"
    )
    return conn


def main() -> None:
    action, ticket_id = sys.argv[1], sys.argv[2]
    thread_id = f"router-{ticket_id}"
    config: RunnableConfig = {"configurable": {"thread_id": thread_id}}
    now = datetime.now().isoformat(timespec="seconds")

    with sqlite3.connect(ROUTER_DB, check_same_thread=False) as conn:
        graph = builder.compile(checkpointer=SqliteSaver(conn))
        if action == "start":
            result = graph.invoke({"ticket_id": ticket_id}, config)
            if "__interrupt__" in result:
                payload = json.dumps(result["__interrupt__"][0].value, ensure_ascii=False)
                with approvals() as db:
                    db.execute(
                        "INSERT OR IGNORE INTO pending_approvals (thread_id, payload, status, created_at) VALUES (?, ?, 'pending', ?)",
                        (thread_id, payload, now),
                    )
                print("已进待审批表:", thread_id)
            else:
                print(result["outcome"])
        elif action == "decide":
            approved, who = sys.argv[3] == "approve", sys.argv[4]
            with approvals() as db:
                cur = db.execute(
                    "UPDATE pending_approvals SET status = ?, decided_by = ?, decided_at = ? WHERE thread_id = ? AND status = 'pending'",
                    ("approved" if approved else "rejected", who, now, thread_id),
                )
            if cur.rowcount == 0:
                print(f"{who}:这条已经有人处理过了,忽略")
                return
            result = graph.invoke(Command(resume={"approved": approved, "note": f"by {who}"}), config)
            print(f"{who}:", result["outcome"])


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `APPROVALS_DB = Path(__file__).with_name("approvals.db")` 待审批表是业务数据,不放进 LangGraph 的 checkpoint 库。
- `def approvals() -> sqlite3.Connection:` 打开库,顺手建表。`IF NOT EXISTS` 让它反复调用也没事。
- `" thread_id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL,"` 一条线只有一条待审批记录,主键就是 thread_id。`payload` 存中断内容的 JSON,给审批界面展示用。
- `now = datetime.now().isoformat(timespec="seconds")` 本地时间,和 Day 320 写退款记录时一样。
- `payload = json.dumps(result["__interrupt__"][0].value, ensure_ascii=False)` 中断内容转成 JSON 字符串,`ensure_ascii=False` 让中文原样保存,Day 39 讲过。
- `"INSERT OR IGNORE INTO pending_approvals (thread_id, payload, status, created_at) VALUES (?, ?, 'pending', ?)",` 主键冲突就跳过,同一张单 start 两次也只有一条记录。这个写法明天会细讲。
- `approved, who = sys.argv[3] == "approve", sys.argv[4]` 一行给两个变量赋值。命令行是 `decide T1041 approve 张主管`。
- `"UPDATE pending_approvals SET status = ?, decided_by = ?, decided_at = ? WHERE thread_id = ? AND status = 'pending'",` 抢单的关键:只改还是 pending 的那行。两个请求同时到,SQLite 一次只让一个写,先到的改成功,后到的再看时已经不是 pending 了。
- `if cur.rowcount == 0:` `rowcount` 是这条 UPDATE 改到的行数。0 说明别人已经处理过。
- `result = graph.invoke(Command(resume={"approved": approved, "note": f"by {who}"}), config)` 抢到了才恢复图。
- `print(f"{who}:", result["outcome"])` 打出结果。

</div>

```bash
cd agent-zero-lab && uv run python cloudledger/seed.py && cd part05/lgdemo
rm -f router.db approvals.db
uv run python pending_router.py start T1041
sqlite3 approvals.db "select thread_id, status, substr(payload,1,60) from pending_approvals"
uv run python pending_router.py decide T1041 approve 张主管
uv run python pending_router.py decide T1041 reject 李主管
sqlite3 approvals.db "select thread_id, status, decided_by from pending_approvals"
sqlite3 ../../cloudledger/cloudledger.db "select id, amount_cents, status from refund_requests"
```

```text
已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}
已进待审批表: router-T1041
router-T1041|pending|{"question": "是否批准这笔退款?", "invoice_id": "INV-2026-0123", "am
张主管: 已批准:INV-2026-0123 退 2392.00 元。审批备注:by 张主管
李主管:这条已经有人处理过了,忽略
router-T1041|approved|张主管
1|239200|approved
```

张主管先批,图恢复,退款写库;李主管晚到,UPDATE 改到 0 行,直接返回,图没有被第二次恢复。这里是两个命令先后跑的,不是真的同时;真的同时到时靠的是 SQLite 的写锁,先拿到锁的改成功。换成 Postgres 也是一样的写法。

这个解法还缺两样,留给第七部分:超时扫描(定时任务把 `created_at` 太早的 pending 记录改成 escalated),以及「改表成功了,但恢复图时崩了」怎么办(表里是 approved,图还停着)。后者的常见做法是先把状态改成 `processing`,图跑完再改成 `approved`,定时任务扫一下卡在 processing 太久的记录重新恢复。

</details>

**验收标准**:能用 `sub_mismatch.py` 的输出说明「直接加子图但没有同名字段」会发生什么,并用包函数的写法修好;能用 `subgraphs=True` 找到子图里停在哪一步;能说出 None、True、False 三种策略的区别,并用练习 3 说明为什么带审批的子图不能用 False;`router.py` 跑通退款和非退款两条路。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 子图(subgraph) | 一个编译好的图被当作另一个图的节点。可以直接 `add_node`(靠同名字段传数据),也可以在节点函数里 invoke(自己转换输入输出) |
| 父图 | 包含子图的那张图。interrupt 恢复、get_state 都对父图做 |
| channel | 状态里的一个字段。直接加的子图和父图读写同名的 channel |
| checkpoint_ns / ns | 快照的命名空间。父图是空字符串,子图是「节点名:任务 id」,流式 v2 的 `ns` 和它同一格式 |
| subgraphs=True | `get_state` 和 `stream` 的参数,打开后才能看到子图内部的快照和步骤 |
| tasks | 快照对象上这一步要执行的任务列表,停在子图里时 `tasks[0].state` 指向子图的快照 |
| per-invocation(`checkpointer=None`) | 子图默认策略:用父图的 checkpointer,一次调用之内能停能续,下次调用从空状态开始 |
| per-thread(`checkpointer=True`) | 同一个 thread 上子图记住历次调用的状态;不支持并行调用同一个子图 |
| stateless(`checkpointer=False`) | 子图不存快照,恢复时整个子图从头重跑,拿不到子图快照 |
| 乐观锁 | 更新时在条件里带上「我以为的旧状态」(`WHERE status='pending'`),改到 0 行就说明被别人抢先了 |

## 常见误区

**直接加子图,父子状态没有同名字段。** 第 2 步实测,子图收到 `{}`,写出的字段被丢掉,父图状态和输入一样,不报任何错。状态不同就在节点函数里调用子图,自己写转换。

**以为子图跑完只把改过的字段交回父图。** 第 1 步不开 subgraphs 时,`refund_flow` 那一项的修改是子图的整份状态。父图有的字段都会被这份状态写一遍,子图里如果把某个共享字段改坏了,父图也跟着坏。

**只查 `get_state(config)` 就以为知道停在哪。** 父图 `next` 只说 `('refund_flow',)`。审批页面要显示具体环节,得 `get_state(config, subgraphs=True)`,看 `tasks[0].state.next`。

**恢复时去找子图的 config。** 不需要。`Command(resume=...)` 照常对父图发、用父图的 thread_id,LangGraph 自己找到子图里的中断(第 3 步、第 5 步)。

**带审批的子图用 `checkpointer=False`。** 练习 3 实测,approve 时子图从头重跑,多调一次模型,写进库的理由和主管看到的不是同一句。`False` 只给纯计算、没有 interrupt 的小流程用。

**为了「记住东西」随手开 `checkpointer=True`。** 它在同一个 thread 上会把历次调用的状态累起来(第 4 步列表越来越长),并且同一个子图在同一 thread 上并行调用会互相冲突。退款这种一次办完的流程用默认的 None。

**想在父图上时间旅行到子图内部某一步。** 练习 2 看到,父图历史里只有 4 张,子图的 6 张在另一个命名空间。父图的 rewind 只能回到进子图之前。

## 学习资料

### 文档与文章

- [LangGraph · Subgraphs](https://docs.langchain.com/oss/python/langgraph/use-subgraphs):今天的主文档。「Call a subgraph inside a node」「Add a subgraph as a node」对应第 1、2 步,「Subgraph persistence」那张表对应第 4 步,30 分钟。
- [LangGraph · Persistence](https://docs.langchain.com/oss/python/langgraph/persistence):回顾 checkpoint 和 thread,读完再看 `checkpoint_ns` 就不陌生了,10 分钟。
- [LangGraph · Streaming](https://docs.langchain.com/oss/python/langgraph/streaming):昨天读过,今天读「Subgraph outputs」那一小节,看 `ns` 的格式说明,5 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1z3NY66EY1&p=116&autoplay=0&high_quality=1" title="尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>尚硅谷 · LangGraph 教程 · 第 116 集「子图_作为父图的节点」(5 分钟),对应第 1 步。第 114、115 集是「在节点中调用子图」和注意事项,对应第 2 步;第 117 集讲父图查看子图检查点,对应第 3 步。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1z3NY66EY1&p=118&autoplay=0&high_quality=1" title="尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>尚硅谷 · LangGraph 教程 · 第 118 集「子图_持久化策略」(4 分钟),对应第 4 步。第 119–124 集分别讲中断场景、多轮会话场景、多次调用同一子图、什么时候用 stateless 和总结,每集 4–7 分钟,可以连着看完。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/wcHcocpAoX4" title="How to build Subgraphs in LangGraph | CampusX" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>CampusX · How to build Subgraphs in LangGraph · 英语,有自动字幕。讲子图的两种接法,和今天第 1、2 步对应,看他怎么处理父子状态不一样的情况。</figcaption>
</figure>

### 书籍

- Mayo Oshin、Nuno Campos《Learning LangChain》(O'Reilly,2025):讲 Agent 架构的章节里有用子图拆分多 Agent 的写法,后天开始的多 Agent 会用到。API 以今天的文档为准。英文原版。

### 开源项目与代码

- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):`libs/checkpoint-sqlite` 是 SqliteSaver 的源码,练习 2 查的 `checkpoints` 表就是它建的,看建表语句能知道 `checkpoint_ns` 那一列是怎么用的。

## 自测

1. 父图状态 `{ticket, answer}`,子图状态 `{ticket_id, proposal}`,直接 `add_node("sub", 子图)`。跑完父图的 `answer` 是什么?会报错吗?

<details><summary>答案</summary>

`answer` 还是输入时的值,不报错。没有同名字段,子图收到空字典,它写的 `proposal` 父图没有这个字段,被丢掉。第 2 步 `sub_mismatch.py` 的实测就是这样。应该在节点函数里调用子图并转换字段。

</details>

2. 子图里的节点 interrupt 了。`graph.get_state(config).next` 是什么?要怎样才能知道子图停在哪个节点?恢复时 `Command` 发给谁?

<details><summary>答案</summary>

父图的 `next` 是子图在父图里的节点名(如 `('refund_flow',)`)。用 `graph.get_state(config, subgraphs=True).tasks[0].state.next` 看子图内部(如 `('approval',)`)。恢复对父图发,`graph.invoke(Command(resume=...), 父图config)`。

</details>

3. 子图 `compile(checkpointer=None)` 的意思是「这个子图没有 checkpointer」吗?

<details><summary>答案</summary>

不是。`None` 是默认值,意思是跟着父图用父图的 checkpointer,一次调用之内能停能续(per-invocation);只是每次新的调用从空状态开始。真正「不存」的是 `False`。

</details>

4. 同一个 thread 上调三次某个子图,想让它记得前两次的状态,该怎么写?有什么限制?

<details><summary>答案</summary>

子图 `compile(checkpointer=True)`(per-thread)。第 4 步实测列表越积越长。限制是同一个子图在同一个 thread 上不能并行调用(比如 Send 同时派出好几份),它们写同一个命名空间会冲突。

</details>

5. **面试题**:「你们的审批流程是 LangGraph 做的,两个审批人同时点了批准,会发生什么?你怎么防?」

<details><summary>答案</summary>

参考要点:两个请求都对同一个 thread 发 `Command(resume=...)`,可能都恢复成功,图被推进两次,写库节点执行两次,出现重复退款。防法分两层:入口层,用一张待审批表,提交审批时先 `UPDATE ... SET status='approved' WHERE thread_id=? AND status='pending'`,只有改到一行的请求才去恢复图(乐观锁),练习 4 实跑过;执行层,写库的节点本身做幂等(Day 322 练习 2 的「发票退过就跳过」,更稳的是唯一约束)。再补两点会更好:表里还要处理「改表成功但恢复图时崩了」的情况(加 processing 中间态加定时扫描);审批记录要写进业务表做审计,不要依赖 checkpoint 历史。如果审批节点在子图里,子图不能用 `checkpointer=False`,否则恢复会重跑前面的模型调用,批的方案和执行的方案可能不一致。

</details>

## 明天预告

明天是 [Day 325 · 后台 Agent(一):聊天窗口之外,三种触发源,事件表](/blog/agent-zero/day-325-ambient-1/)。今天「放到真实系统里」那一节,工单是有人在命令行里敲 `start` 才进来的。真实系统里,工单是工单系统推过来的 webhook、客服邮箱里的新邮件、每天早上定时扫出来的超期单,没有人坐在 Agent 对面。明天看这三种触发源各有什么脾气,为什么它们都应该先写进一张事件表,以及练习 4 里刚用过的 `INSERT OR IGNORE` 怎么挡住重复投递。
