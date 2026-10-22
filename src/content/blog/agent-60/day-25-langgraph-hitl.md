---
title: 'Day 25 · LangGraph 进阶:checkpoint、人工审批、流式与中断恢复'
description: '给图接上 SQLite checkpointer,让状态落盘;用 interrupt 实现 CloudLedger 的退款人工审批,Agent 起草方案后停下来等主管,进程退出也不丢;再演示时间旅行、三种流式模式和子图。这是 LangGraph 真正比手写循环值钱的地方。'
pubDate: 2026-10-12
regime: none
tags: ['langgraph', 'checkpoint', 'human-in-the-loop', 'interrupt', 'agent-60']
series: 'agent-60'
day: 25
lang: 'zh'
---

## 今天要解决的问题

昨天结尾说过,LangGraph 的价值不在画图本身,而在持久化、人工介入、流式这些「手写很麻烦」的能力。今天就把这几样逐个拿下,场景是 CloudLedger 的退款审批:Agent 读工单、查发票、起草一个退款方案,然后**停下来**,等客服主管批准或驳回。主管可能五分钟后批,也可能第二天早上才批,中间服务可能重启过。批了才真正写库,驳回就转人工。

学完今天,你要能做到:

1. 解释 checkpointer 和 thread_id 是什么,为什么人工审批离不开它们。
2. 用 `interrupt()` 让图在节点中间暂停,用 `Command(resume=...)` 带着人的决定恢复。
3. 演示「进程退出后用同一个 thread_id 接着跑」,并说清楚恢复时节点会从头重新执行意味着什么。
4. 用 `get_state` / `get_state_history` 查看状态和历史,做一次「时间旅行」回到审批前重来。
5. 用三种 `stream_mode` 拿到流式输出,知道 LangGraph 1.2 新出的 `stream_events` 是干什么的。

预计用时 5–7 小时(「先用玩具图把每个零件单独跑一遍」那节占 1–2 小时,觉得后面代码跳得快就别跳过它)。前置:Day 23 的 `cloudledger.db`、Day 24 的 `llm.py` 和 State/节点/边概念。

## 没有 checkpoint 会怎样

先想想不用框架怎么实现「停下来等审批」。最直接的办法是:Agent 跑到审批点,把当前的所有上下文(工单、查到的发票、起草的方案、对话历史)序列化存进数据库,返回一个「待审批」状态;主管点批准时,从数据库读出上下文,重建对象,从审批之后的那一步继续跑。

听起来不难,做起来全是细节:哪些字段要存?Agent 跑到一半的消息历史怎么存?代码升级后旧的存档还能不能读?如果审批后又要走好几步,中途又要暂停呢?每个需要暂停的地方都得手写一套「存档 + 读档 + 跳到正确位置」。

LangGraph 把这件事做成了基础设施:**每执行完一个节点(准确说是每个「超步」),都自动把整个 State 存一份快照,叫 checkpoint**。存在哪由 checkpointer 决定:内存、SQLite、Postgres、Redis 都有现成实现。快照按 `thread_id` 分组,一个 thread 就是一次独立的执行(一张工单的处理过程、一个用户的一段会话)。

有了这个,「暂停」就变成了:跑到某处不往下走了,状态反正已经存着;「恢复」就变成了:按 thread_id 读出最新快照,从下一个节点接着跑。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="一个 thread 的执行时间线:load、draft 节点各产生一个 checkpoint,approval 节点处 interrupt 暂停,进程退出;之后用同一 thread_id 恢复,执行 approval、execute,每一步都写入 SQLite">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">thread_id = refund-T1041</text>
  <line x1="30" y1="80" x2="620" y2="80" stroke="var(--rule)"/>
  <g font-family="var(--font-mono)" font-size="12" text-anchor="middle">
    <rect x="40" y="62" width="70" height="36" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/><text x="75" y="85" fill="var(--ink)">load</text>
    <rect x="135" y="62" width="70" height="36" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="170" y="85" fill="var(--ink)">draft</text>
    <rect x="230" y="62" width="90" height="36" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="275" y="85" fill="var(--ink)">approval ⏸</text>
    <rect x="430" y="62" width="90" height="36" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="475" y="85" fill="var(--ink)">approval ▶</text>
    <rect x="540" y="62" width="70" height="36" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/><text x="575" y="85" fill="var(--ink)">execute</text>
  </g>
  <rect x="330" y="50" width="90" height="60" fill="none" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
  <text x="375" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">进程退出</text>
  <text x="375" y="88" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">几小时后</text>
  <text x="375" y="104" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">主管点批准</text>
  <rect x="40" y="170" width="570" height="56" rx="4" fill="none" stroke="var(--rule)"/>
  <text x="325" y="190" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">SqliteSaver(checkpoints.db)</text>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">
    <text x="75" y="212">ckpt 1</text><text x="170" y="212">ckpt 2</text><text x="275" y="212">ckpt 3 + 待处理中断</text><text x="520" y="212">ckpt 4、5</text>
  </g>
  <g stroke="var(--rule)" stroke-dasharray="2 3">
    <line x1="75" y1="98" x2="75" y2="170"/><line x1="170" y1="98" x2="170" y2="170"/><line x1="275" y1="98" x2="275" y2="170"/><line x1="475" y1="98" x2="475" y2="170"/><line x1="575" y1="98" x2="575" y2="170"/>
  </g>
  <path d="M275 140 Q375 160 475 140" stroke="var(--compute)" fill="none"/>
  <text x="375" y="150" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">同一 thread_id 读回</text>
</svg>
<figcaption>每个节点执行完都会落一个 checkpoint。interrupt 发生时,状态和「待处理的中断」一起存进库,进程可以放心退出。恢复时按 thread_id 读回,从 approval 节点重新开始执行。</figcaption>
</figure>

## 三个必需品:checkpointer、thread_id、interrupt

**checkpointer** 在 `compile` 时传入:

```python
from langgraph.checkpoint.memory import InMemorySaver
graph = builder.compile(checkpointer=InMemorySaver())
```

`InMemorySaver` 只存在内存里,进程一退就没了,只适合测试。要真正持久化,用 `langgraph-checkpoint-sqlite` 包里的 `SqliteSaver`,生产环境用 `langgraph-checkpoint-postgres` 的 `PostgresSaver`。它们接口一样,换一行代码的事。

**thread_id** 在每次调用时通过 config 传入:

```python
config = {"configurable": {"thread_id": "refund-T1041"}}
graph.invoke(inputs, config)
```

这个 id 是你自己定的,要有业务含义且稳定。我习惯用「业务类型 + 业务主键」,比如 `refund-T1041`,这样从工单号就能直接找到它的执行状态。用同一个 thread_id 再次调用,LangGraph 会接着这个 thread 的最新状态继续;换一个新 id,就是一次全新的执行。

**interrupt** 在节点函数里调用:

```python
from langgraph.types import interrupt

def human_approval(state):
    decision = interrupt({"question": "是否批准这笔退款?", **state["proposal"]})
    return {"decision": decision}
```

执行到 `interrupt(...)` 时,图会暂停,传给 interrupt 的那个值会返回给调用方(用 `invoke` 时放在结果的 `__interrupt__` 字段里)。调用方拿去展示给主管。主管做出决定后,调用方用 `Command(resume=决定)` 再调一次图,这个决定就成了 `interrupt()` 的返回值,节点继续往下走。

整个机制里最反直觉的一点,也是面试官最喜欢追问的一点:**恢复时,被中断的那个节点会从头重新执行一遍**,不是从 `interrupt()` 那一行接着往下跑。第二次执行到 `interrupt()` 时,它发现已经有 resume 值了,就直接返回这个值,不再暂停。

这意味着:**interrupt 之前的代码会执行两次**。如果你在 interrupt 前面写了「发一条企业微信通知给主管」,主管会收到两条;如果写了「往库里插一条审批记录」,就会插两条。所以 interrupt 之前只放没有副作用的代码,有副作用的操作要么放到前一个节点,要么放到 interrupt 之后,要么做成幂等的。

## 先用玩具图把每个零件单独跑一遍

这节是给觉得后面代码跳太快的人准备的。下面「实现退款审批」那个文件有两百多行,checkpointer、thread_id、interrupt、Command、get_state、时间旅行全搅在一起,还要调模型、读业务库,第一次看很容易不知道哪一行在管哪件事。尚硅谷那套课光这部分就录了五六十集,我们这里换个办法:拆成 9 个小脚本,每个只演示一个零件,节点全是纯函数,不调模型、不花钱、一秒跑完。跑完这些再看退款审批会轻松很多。

准备工作只有两步。Day 24 已经 `uv add langgraph` 过了,第 3 步要用 SQLite,先把 checkpointer 包装上(后面「实现退款审批」那一步也要装它,现在装了到时候就不用再装):

```bash
cd agent-60-lab
uv add langgraph-checkpoint-sqlite
mkdir -p w4/lg_steps
```

脚本都放 `w4/lg_steps/`,在 `agent-60-lab` 根目录用 `uv run python w4/lg_steps/25_01_thread.py` 这样按路径跑。下面的输出是我用 langgraph 1.2.16、langgraph-checkpoint-sqlite 3.1.2 实跑的,Zed 里的 basedpyright(standard 档)对这 9 个文件是 0 条红线。

### 第 1 步:thread_id 决定「接着跑」还是「从头来」

最小的一张图:一个节点,把 `count` 加 1。编译时塞一个 `InMemorySaver`,然后用两个不同的 thread_id 调三次。

```python
# agent-60-lab/w4/lg_steps/25_01_thread.py
from typing import TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import START, StateGraph


class State(TypedDict, total=False):
    count: int


def bump(state: State) -> State:
    return {"count": state.get("count", 0) + 1}


builder = StateGraph(State)
builder.add_node("bump", bump)
builder.add_edge(START, "bump")
graph = builder.compile(checkpointer=InMemorySaver())

a: RunnableConfig = {"configurable": {"thread_id": "A"}}
b: RunnableConfig = {"configurable": {"thread_id": "B"}}
print("A 第 1 次:", graph.invoke({}, a))
print("A 第 2 次:", graph.invoke({}, a))
print("B 第 1 次:", graph.invoke({}, b))
```

<div class="line-notes">

- `class State(TypedDict, total=False):` `total=False` 表示字段可以不填,所以第一次 `invoke({}, a)` 传空字典也合法。
- `return {"count": state.get("count", 0) + 1}` 第一次进来状态里还没有 count,`get` 拿到默认值 0,返回 1;A 的第二次进来时状态里已经是 1 了,返回 2。
- `graph = builder.compile(checkpointer=InMemorySaver())` 有了 checkpointer,每次 invoke 结束都会把状态按 thread_id 存下来。去掉这个参数再跑,三行都会是 `{'count': 1}`。
- `a: RunnableConfig = {"configurable": {"thread_id": "A"}}` 标成 `RunnableConfig` 是为了让类型检查认识这个字典;不标也能跑,只是 Zed 里会飘红。
- `print("A 第 2 次:", graph.invoke({}, a))` 同一个 thread A,LangGraph 先读出上次存的 `{'count': 1}`,再把这次的输入 `{}` 合进去,所以节点看到的 count 是 1,结果是 2。
- `print("B 第 1 次:", graph.invoke({}, b))` 换成 thread B,库里没有它的记录,从空状态开始,结果又是 1。

</div>

输出:

```text
A 第 1 次: {'count': 1}
A 第 2 次: {'count': 2}
B 第 1 次: {'count': 1}
```

就这么简单:**同一个 thread_id 是同一次「会话」,状态会累积;换一个 id 就是一张白纸**。退款审批里用 `refund-T1041` 当 thread_id,就是为了让「起草」和「第二天批准」落在同一张纸上。对应尚硅谷第 56–60 集(可恢复执行的含义、内存持久化)。

### 第 2 步:每一步都有一张快照

checkpointer 存的不只是最后的状态,而是每个节点跑完之后的样子。两个节点 `load → draft`,跑完后把历史全打出来。

```python
# agent-60-lab/w4/lg_steps/25_02_snapshots.py
from typing import TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import START, StateGraph


class State(TypedDict):
    log: str


def load(state: State) -> State:
    return {"log": state["log"] + " → load"}


def draft(state: State) -> State:
    return {"log": state["log"] + " → draft"}


builder = StateGraph(State)
builder.add_node("load", load)
builder.add_node("draft", draft)
builder.add_edge(START, "load")
builder.add_edge("load", "draft")
graph = builder.compile(checkpointer=InMemorySaver())

config: RunnableConfig = {"configurable": {"thread_id": "T1"}}
graph.invoke({"log": "start"}, config)

now = graph.get_state(config)
print("最新:", now.values, "next =", now.next)
for snap in graph.get_state_history(config):
    print((snap.metadata or {}).get("step"), snap.next, snap.values)
```

<div class="line-notes">

- `return {"log": state["log"] + " → load"}` 每个节点在 log 后面追加自己的名字,这样从快照里一眼就能看出跑到了哪一步。
- `graph.invoke({"log": "start"}, config)` 一次 invoke 跑完整张图,中间自动存了好几张快照,这里不需要接返回值。
- `now = graph.get_state(config)` 拿 thread T1 的最新快照,是一个 `StateSnapshot` 对象。
- `print("最新:", now.values, "next =", now.next)` `values` 是当时的状态 `{'log': 'start → load → draft'}`;`next` 是「下一步要跑的节点」,图已经跑完,所以是空元组 `()`。
- `for snap in graph.get_state_history(config):` 历史是倒序的,最新的在最前面,一共 4 张。
- `print((snap.metadata or {}).get("step"), snap.next, snap.values)` `step` 从 -1 开始:-1 是还没收到输入的空状态,0 是收到输入、准备跑 load,1 是 load 跑完、准备跑 draft,2 是全部跑完。`metadata` 类型上可能是 None,所以先 `or {}` 再 `.get`。

</div>

输出:

```text
最新: {'log': 'start → load → draft'} next = ()
2 () {'log': 'start → load → draft'}
1 ('draft',) {'log': 'start → load'}
0 ('load',) {'log': 'start'}
-1 ('__start__',) {}
```

记住 `next` 这个字段,它是后面所有东西的钥匙:图停在审批点时,`next` 就是 `('approval',)`;做审批后台的「待处理列表」,查的就是 `next` 不为空的 thread。对应尚硅谷第 68–70 集(查看历史检查点、查询单个检查点)。

### 第 3 步:换成 SQLite,进程退出也不丢

`InMemorySaver` 存在内存里,脚本一结束就没了。换成 `SqliteSaver`,同一个脚本连跑两次:

```python
# agent-60-lab/w4/lg_steps/25_03_sqlite.py
import sqlite3
from typing import TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import START, StateGraph


class State(TypedDict, total=False):
    count: int


def bump(state: State) -> State:
    return {"count": state.get("count", 0) + 1}


builder = StateGraph(State)
builder.add_node("bump", bump)
builder.add_edge(START, "bump")

conn = sqlite3.connect("steps.db", check_same_thread=False)
graph = builder.compile(checkpointer=SqliteSaver(conn))
config: RunnableConfig = {"configurable": {"thread_id": "counter"}}
print("这次运行后 count =", graph.invoke({}, config)["count"])
```

<div class="line-notes">

- `conn = sqlite3.connect("steps.db", check_same_thread=False)` 在你运行命令的目录(这里是 `agent-60-lab` 根目录)生成 `steps.db`。`check_same_thread=False` 的原因和退款审批那节说的一样:LangGraph 可能在别的线程写 checkpoint。
- `graph = builder.compile(checkpointer=SqliteSaver(conn))` 和第 1 步比只换了这一个参数,图的写法一个字没动。
- `config: RunnableConfig = {"configurable": {"thread_id": "counter"}}` thread_id 写死成 `counter`,两次运行是两个独立的进程,但用的是同一个 id。
- `print("这次运行后 count =", graph.invoke({}, config)["count"])` 第一次运行库是空的,得到 1;第二个进程启动后从 `steps.db` 读回 `{'count': 1}`,得到 2。想重来就 `rm steps.db`(建议顺手把 `steps.db` 加进 `.gitignore`)。

</div>

```bash
uv run python w4/lg_steps/25_03_sqlite.py
uv run python w4/lg_steps/25_03_sqlite.py
```

输出:

```text
这次运行后 count = 1
这次运行后 count = 2
```

这就是「主管第二天才批」能成立的前提:状态在磁盘上,和进程活不活没关系。生产里把 `SqliteSaver` 换成 `PostgresSaver`,道理一样。对应尚硅谷第 65–67 集(数据库检查点、表结构、持久化模式)和 71–74 集(失败后恢复运行);第 61–64 集是装 PostgreSQL,Day 17 装过了可以跳。

### 第 4 步:interrupt 暂停,Command 恢复,节点会从头再跑一遍

这一步最重要。一个只有 `approval` 节点的图,节点里在 interrupt 前后各打一行字。

```python
# agent-60-lab/w4/lg_steps/25_04_interrupt.py
from typing import NotRequired, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import START, StateGraph
from langgraph.types import Command, interrupt


class State(TypedDict):
    amount: int
    decision: NotRequired[str]


def approval(state: State) -> dict:
    print("  [approval 节点开始执行]")
    decision = interrupt(f"批准退款 {state['amount']} 元吗?")
    print("  [interrupt 之后] 拿到决定:", decision)
    return {"decision": decision}


builder = StateGraph(State)
builder.add_node("approval", approval)
builder.add_edge(START, "approval")
graph = builder.compile(checkpointer=InMemorySaver())
config: RunnableConfig = {"configurable": {"thread_id": "R1"}}

print("第一次 invoke:")
r1 = graph.invoke({"amount": 2392}, config)
print("返回:", r1)
print("next =", graph.get_state(config).next)

print("恢复:")
r2 = graph.invoke(Command(resume="同意"), config)
print("返回:", r2)
```

<div class="line-notes">

- `decision: NotRequired[str]` 一开始调用时只有 amount,decision 要等人给,所以标成可以没有。
- `print("  [approval 节点开始执行]")` 这一行在 interrupt 之前,看输出:它一共打印了**两次**。
- `decision = interrupt(f"批准退款 {state['amount']} 元吗?")` 第一次执行到这里,图暂停,字符串 `批准退款 2392 元吗?` 被带出去给调用方;恢复那次执行到这里不再暂停,直接返回 `"同意"`。
- `print("  [interrupt 之后] 拿到决定:", decision)` 这一行只在恢复时打印了一次。
- `r1 = graph.invoke({"amount": 2392}, config)` invoke 没报错、正常返回了,结果里多了一个 `__interrupt__` 键,装着刚才那句问话,这就是「暂停」在调用方眼里的样子。
- `print("next =", graph.get_state(config).next)` 停在 `('approval',)`:approval 没跑完,下次从它开始。
- `r2 = graph.invoke(Command(resume="同意"), config)` 输入不再是状态字典,而是一个 `Command`,`resume` 的值会变成 interrupt() 的返回值。同一个 config,所以接的是 R1 这条线。

</div>

输出(`id` 每次运行都不一样):

```text
第一次 invoke:
  [approval 节点开始执行]
返回: {'amount': 2392, '__interrupt__': [Interrupt(value='批准退款 2392 元吗?', id='cab5c0de898be06ed8ed63bda7e9c075', response_schema=None)]}
next = ('approval',)
恢复:
  [approval 节点开始执行]
  [interrupt 之后] 拿到决定: 同意
返回: {'amount': 2392, 'decision': '同意'}
```

两次「开始执行」就是前面那条警告的现场版:恢复时节点从第一行重新跑,不是从 interrupt 那一行接着跑。所以发通知、写库这种有副作用的事,不要放在同一个节点的 interrupt 前面。动手练习第 3 题会让你在真的退款图里再验证一次。对应尚硅谷第 84–86 集(两种中断机制、主动中断、HITL 案例)和第 90 集(使用规范)。

### 第 5 步:两个人同时审批,resume 传字典

退款金额大的时候可能要财务和主管都点头。两个节点从 START 同时出发,各自 interrupt 一次:

```python
# agent-60-lab/w4/lg_steps/25_05_multi.py
import operator
from typing import Annotated, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import START, StateGraph
from langgraph.types import Command, interrupt


class State(TypedDict):
    votes: Annotated[list[str], operator.add]


def finance(state: State) -> State:
    return {"votes": ["财务:" + interrupt("财务是否同意?")]}


def manager(state: State) -> State:
    return {"votes": ["主管:" + interrupt("主管是否同意?")]}


builder = StateGraph(State)
builder.add_node("finance", finance)
builder.add_node("manager", manager)
builder.add_edge(START, "finance")
builder.add_edge(START, "manager")
graph = builder.compile(checkpointer=InMemorySaver())
config: RunnableConfig = {"configurable": {"thread_id": "R2"}}

r = graph.invoke({"votes": []}, config)
for it in r["__interrupt__"]:
    print(it.id[:8], it.value)

answers = {it.id: ("同意" if "财务" in it.value else "驳回") for it in r["__interrupt__"]}
print(graph.invoke(Command(resume=answers), config))
```

<div class="line-notes">

- `votes: Annotated[list[str], operator.add]` 两个节点在同一步里都要往 votes 写,必须配 reducer 把两份拼起来。我把 `operator.add` 去掉试了一下,恢复时直接抛 `InvalidUpdateError: At key 'votes': Can receive only one value per step`。
- `return {"votes": ["财务:" + interrupt("财务是否同意?")]}` interrupt 返回的是人给的值,拼上前缀放进列表。
- `builder.add_edge(START, "manager")` START 连出两条边,finance 和 manager 在同一个超步里并行跑,于是同时产生两个中断。
- `for it in r["__interrupt__"]:` 这次 `__interrupt__` 里有两个 `Interrupt`,每个都有自己的 `id` 和 `value`。
- `answers = {it.id: ("同意" if "财务" in it.value else "驳回") for it in r["__interrupt__"]}` 按 id 一一给出答复:财务那个回「同意」,主管那个回「驳回」。
- `print(graph.invoke(Command(resume=answers), config))` resume 传字典,LangGraph 按 id 把答复分别送回两个节点,最终 votes 是 `['财务:同意', '主管:驳回']`。

</div>

输出(id 只打了前 8 位,每次不同):

```text
81ad7c23 财务是否同意?
20de8067 主管是否同意?
{'votes': ['财务:同意', '主管:驳回']}
```

只有一个中断时 `resume` 直接给值就行;同时有多个时就要用「中断 id → 答复」的字典,不然它不知道哪个答复给谁。对应尚硅谷第 87 集(并行执行多个中断)和第 92–93 集(并行中断时的检查点)。

### 第 6 步:不改节点代码,在某个节点前停下

interrupt 要写进节点函数里。还有一种不碰节点的办法:编译时说「跑到 execute 之前停一下」,叫静态断点。

```python
# agent-60-lab/w4/lg_steps/25_06_breakpoint.py
from typing import TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import START, StateGraph


class State(TypedDict):
    log: str


def draft(state: State) -> State:
    return {"log": state["log"] + " → draft"}


def execute(state: State) -> State:
    return {"log": state["log"] + " → execute"}


builder = StateGraph(State)
builder.add_node("draft", draft)
builder.add_node("execute", execute)
builder.add_edge(START, "draft")
builder.add_edge("draft", "execute")
graph = builder.compile(checkpointer=InMemorySaver(), interrupt_before=["execute"])
config: RunnableConfig = {"configurable": {"thread_id": "B1"}}

print(graph.invoke({"log": "start"}, config))
print("next =", graph.get_state(config).next)
print(graph.invoke(None, config))
```

<div class="line-notes">

- `graph = builder.compile(checkpointer=InMemorySaver(), interrupt_before=["execute"])` 在 execute 执行之前停。也有 `interrupt_after`,在某节点执行完之后停。断点同样要靠 checkpointer 存状态。
- `print(graph.invoke({"log": "start"}, config))` 只跑了 draft,返回 `{'log': 'start → draft'}`,没有 `__interrupt__` 键,停得很安静。
- `print("next =", graph.get_state(config).next)` 看 next 才知道它停在了 `('execute',)` 前面。
- `print(graph.invoke(None, config))` 输入传 `None` 表示「别给新输入,从停的地方接着跑」,于是 execute 跑完,log 多了 ` → execute`。

</div>

输出:

```text
{'log': 'start → draft'}
next = ('execute',)
{'log': 'start → draft → execute'}
```

静态断点适合调试:想看某一步之前的状态长什么样,不用改业务代码。正式的审批流程还是用 interrupt,因为它能把「要问人什么」一起带出去,恢复时还能把人的答复带回来;静态断点只会停,不会问。对应尚硅谷第 94–97 集。

### 第 7 步:时间旅行,从历史某一步分叉

先正常跑完 `draft → execute`(起草 2392 元、执行),然后回到 execute 之前那一刻,把金额改成 1196 再跑一次。

```python
# agent-60-lab/w4/lg_steps/25_07_fork.py
from typing import TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import START, StateGraph


class State(TypedDict):
    amount: int
    result: str


def draft(state: State) -> dict:
    return {"amount": 2392}


def execute(state: State) -> dict:
    return {"result": f"已退 {state['amount']} 元"}


builder = StateGraph(State)
builder.add_node("draft", draft)
builder.add_node("execute", execute)
builder.add_edge(START, "draft")
builder.add_edge("draft", "execute")
graph = builder.compile(checkpointer=InMemorySaver())
config: RunnableConfig = {"configurable": {"thread_id": "F1"}}

print("原始:", graph.invoke({"amount": 0, "result": ""}, config))

before = next(s for s in graph.get_state_history(config) if s.next == ("execute",))
forked = graph.update_state(before.config, {"amount": 1196})
print("分叉:", graph.invoke(None, forked))

print("最新:", graph.get_state(config).values)
print("历史一共", len(list(graph.get_state_history(config))), "个快照")
```

<div class="line-notes">

- `print("原始:", graph.invoke({"amount": 0, "result": ""}, config))` 正常跑完一遍,draft 把金额定为 2392,execute 写出 `已退 2392 元`。
- `before = next(s for s in graph.get_state_history(config) if s.next == ("execute",))` 在历史里找「下一步是 execute」的那张快照,也就是 draft 刚跑完、还没执行退款的那一刻。
- `forked = graph.update_state(before.config, {"amount": 1196})` 基于那张旧快照改状态。它不会改动旧快照,而是在它后面新长出一张快照,返回新快照的 config(里面带着新的 checkpoint_id)。
- `print("分叉:", graph.invoke(None, forked))` 从新快照往下跑,execute 看到的金额是 1196。
- `print("最新:", graph.get_state(config).values)` 只按 thread_id 查,拿到的是分叉后的结果,说明「最新」指的是最后写进去的那条线。
- `print("历史一共", len(list(graph.get_state_history(config))), "个快照")` 原来 4 张,update_state 加 1 张,分叉后 execute 跑完再加 1 张,一共 6 张。原来那条 `已退 2392 元` 的记录还在里面,没有被覆盖。

</div>

输出:

```text
原始: {'amount': 2392, 'result': '已退 2392 元'}
分叉: {'amount': 1196, 'result': '已退 1196 元'}
最新: {'amount': 1196, 'result': '已退 1196 元'}
历史一共 6 个快照
```

这就是 refund_approval.py 里 `rewind` 命令的原理,也是调试 Agent 时最省 token 的手段:第 7 步出错,回到第 6 步改一下状态重跑,不用从头调一遍模型。对应尚硅谷第 74–77 集(检查点重新运行、fork)。

### 第 8 步:三种 stream_mode 各吐什么

流式要看到逐 token 输出得有模型。这里用 langchain-core 自带的假模型 `GenericFakeChatModel`,它会把一句写死的话按空格切开一段段吐出来,不联网、不花钱。

```python
# agent-60-lab/w4/lg_steps/25_08_stream.py
from itertools import cycle
from typing import Annotated, Any, TypedDict, cast

from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, AnyMessage, BaseMessage, HumanMessage
from langgraph.graph import START, StateGraph
from langgraph.graph.message import add_messages

fake = GenericFakeChatModel(messages=cycle([AIMessage(content="已查到 INV-2026-0123 重复扣款")]))


class State(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]


def load(state: State) -> dict:
    return {"messages": [AIMessage(content="读到工单 T1041")]}


def llm(state: State) -> dict:
    return {"messages": [fake.invoke(state["messages"])]}


builder = StateGraph(State)
builder.add_node("load", load)
builder.add_node("llm", llm)
builder.add_edge(START, "load")
builder.add_edge("load", "llm")
graph = builder.compile()
inputs: State = {"messages": [HumanMessage(content="帮我查一下重复扣款")]}

print("== updates")
for chunk in graph.stream(inputs, stream_mode="updates"):
    print({node: upd["messages"][-1].content for node, upd in chunk.items()})

print("== values")
for state in graph.stream(inputs, stream_mode="values"):
    print(len(state["messages"]), state["messages"][-1].content)

print("== messages")
for item in graph.stream(inputs, stream_mode="messages"):
    token, meta = cast(tuple[BaseMessage, dict[str, Any]], item)
    print(repr(token.content), meta["langgraph_node"])
```

<div class="line-notes">

- `fake = GenericFakeChatModel(messages=cycle([AIMessage(content="已查到 INV-2026-0123 重复扣款")]))` 假模型每被调用一次就从 `messages` 里取下一条回复。用 `cycle` 是因为下面要跑三遍图,用普通的 `iter` 第二遍就取空了,会抛 `StopIteration`(我第一次就是这么错的)。
- `return {"messages": [AIMessage(content="读到工单 T1041")]}` load 节点不调模型,直接塞一条现成的消息。
- `return {"messages": [fake.invoke(state["messages"])]}` llm 节点里用的是 `invoke` 不是 `stream`,但 messages 模式照样能拿到逐段输出,LangGraph 会自己挂上回调去截模型的流。
- `for chunk in graph.stream(inputs, stream_mode="updates"):` updates 每个节点跑完吐一次,内容是「节点名 → 它返回的更新」,一共 2 次。
- `for state in graph.stream(inputs, stream_mode="values"):` values 每一步吐完整状态,包括最开始的输入,所以消息数是 1、2、3。
- `token, meta = cast(tuple[BaseMessage, dict[str, Any]], item)` messages 模式每项是「消息片段, 元数据」的元组。stream 的返回类型写得很宽,不 cast 的话 `token.content` 和 `meta["langgraph_node"]` 会各有一条红线,运行没问题。
- `print(repr(token.content), meta["langgraph_node"])` llm 节点吐了 5 段(假模型按空格切的,真模型是按 token 切);load 节点那条现成消息也出现了,而且是整条出来的。所以做打字机效果时要按 `langgraph_node` 过滤,只显示模型节点的输出。

</div>

输出:

```text
== updates
{'load': '读到工单 T1041'}
{'llm': '已查到 INV-2026-0123 重复扣款'}
== values
1 帮我查一下重复扣款
2 读到工单 T1041
3 已查到 INV-2026-0123 重复扣款
== messages
'读到工单 T1041' load
'已查到' llm
' ' llm
'INV-2026-0123' llm
' ' llm
'重复扣款' llm
```

真模型的效果在下面「流式输出」那节有实测(Day 24 的天气 Agent,messages 模式吐了 75 段)。对应尚硅谷第 107–113 集。

### 第 9 步:子图当节点用,它的状态在哪看

最后一个零件。把一个带 interrupt 的小图编译好,直接 `add_node` 进主图,看暂停时父图和子图的状态各在哪。

```python
# agent-60-lab/w4/lg_steps/25_09_subgraph.py
from typing import TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import START, StateGraph
from langgraph.types import Command, StateSnapshot, interrupt


class State(TypedDict):
    ticket: str
    decision: str


def ask(state: State) -> dict:
    return {"decision": interrupt(f"{state['ticket']} 批不批?")}


def classify(state: State) -> dict:
    return {"ticket": state["ticket"] + "(退款类)"}


sub = StateGraph(State)
sub.add_node("ask", ask)
sub.add_edge(START, "ask")
refund_flow = sub.compile()

main = StateGraph(State)
main.add_node("classify", classify)
main.add_node("refund_flow", refund_flow)
main.add_edge(START, "classify")
main.add_edge("classify", "refund_flow")
graph = main.compile(checkpointer=InMemorySaver())
config: RunnableConfig = {"configurable": {"thread_id": "S1"}}

graph.invoke({"ticket": "T1041", "decision": ""}, config)
parent = graph.get_state(config)
print("父图 next =", parent.next)
print("不带 subgraphs:", parent.tasks[0].state)
child = graph.get_state(config, subgraphs=True).tasks[0].state
if isinstance(child, StateSnapshot):
    print("带 subgraphs:", child.values, "子图 next =", child.next)

print(graph.invoke(Command(resume="批"), config))
```

<div class="line-notes">

- `refund_flow = sub.compile()` 子图编译时不传 checkpointer,会自动用父图的。
- `main.add_node("refund_flow", refund_flow)` 编译好的图本身就能当节点,和普通函数一样加进去。父子图的 State 是同一个类型,同名字段直接共享。
- `graph.invoke({"ticket": "T1041", "decision": ""}, config)` classify 先把工单号改成 `T1041(退款类)`,然后进子图,在 ask 节点里 interrupt 停住。
- `print("父图 next =", parent.next)` 父图只知道「卡在 refund_flow 这个节点」,不知道里面停在哪。
- `print("不带 subgraphs:", parent.tasks[0].state)` 默认只给一个指向子图的 config,`checkpoint_ns` 是子图快照的命名空间,格式是「节点名:任务 id」。
- `child = graph.get_state(config, subgraphs=True).tasks[0].state` 加上 `subgraphs=True`,才会把子图的完整快照展开放进来。
- `if isinstance(child, StateSnapshot):` 这个字段类型上可能是 config 也可能是快照,判断一下类型检查才放心。
- `print("带 subgraphs:", child.values, "子图 next =", child.next)` 子图内部停在 `('ask',)`,状态里已经有 classify 改过的工单号。
- `print(graph.invoke(Command(resume="批"), config))` 恢复照样对父图调,用父图的 config,LangGraph 自己找到子图里那个中断。

</div>

输出(checkpoint_ns 后面那串每次不同):

```text
父图 next = ('refund_flow',)
不带 subgraphs: {'configurable': {'thread_id': 'S1', 'checkpoint_ns': 'refund_flow:38fa1528-edd4-e067-546d-cdf9eede53e6'}}
带 subgraphs: {'ticket': 'T1041(退款类)', 'decision': ''} 子图 next = ('ask',)
{'ticket': 'T1041(退款类)', 'decision': '批'}
```

做审批后台时如果审批节点在子图里,列表页要查 `subgraphs=True` 才知道具体停在哪一步。子图的持久化策略还有几种细分(每次调用都是全新的、还是记住上次的状态),尚硅谷第 117–124 集讲得很细,做多轮会话时再回去看;这一步对应第 114–116 集。

到这里,退款审批要用的零件你都单独摸过一遍了:thread_id(第 1 步)、get_state 和 next(第 2 步)、SqliteSaver(第 3 步)、interrupt 加 Command 以及「节点重跑」(第 4 步)、时间旅行(第 7 步)。下面把它们装到一起,再加上模型和业务库。

## 实现退款审批

把前面的东西组合起来。流程是五个节点:`load` 从业务库读工单和该客户最近的发票;`draft` 让模型起草退款方案(结构化输出);`approval` 中断等人;`execute` 写库;`reject` 驳回。

<figure>
<svg viewBox="0 0 640 170" role="img" aria-label="退款审批图:START、load、draft、approval,approval 条件边到 execute 或 reject,两者都到 END">
  <rect x="0" y="0" width="640" height="170" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12" text-anchor="middle">
    <rect x="15" y="68" width="60" height="26" rx="13" fill="none" stroke="var(--ink-soft)"/><text x="45" y="85" fill="var(--ink-soft)">START</text>
    <rect x="100" y="64" width="70" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/><text x="135" y="85" fill="var(--ink)">load</text>
    <rect x="195" y="64" width="70" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="230" y="85" fill="var(--ink)">draft</text>
    <rect x="290" y="64" width="90" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="335" y="85" fill="var(--ink)">approval</text>
    <rect x="430" y="22" width="80" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/><text x="470" y="43" fill="var(--ink)">execute</text>
    <rect x="430" y="108" width="80" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/><text x="470" y="129" fill="var(--ink)">reject</text>
    <rect x="560" y="68" width="60" height="26" rx="13" fill="none" stroke="var(--ink-soft)"/><text x="590" y="85" fill="var(--ink-soft)">END</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="75" y1="81" x2="100" y2="81"/><line x1="170" y1="81" x2="195" y2="81"/><line x1="265" y1="81" x2="290" y2="81"/>
    <line x1="510" y1="39" x2="560" y2="76"/><line x1="510" y1="125" x2="560" y2="86"/>
  </g>
  <g stroke="var(--compute)" stroke-dasharray="4 3" fill="none">
    <line x1="380" y1="75" x2="430" y2="42"/><line x1="380" y1="87" x2="430" y2="122"/>
  </g>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
    <text x="395" y="50">批准</text><text x="395" y="120">驳回</text>
    <text x="335" y="118" text-anchor="middle">interrupt 等人</text>
  </g>
</svg>
<figcaption>只有 draft 调用模型。approval 是人,不是模型:这张图里最关键的决策交给了人。</figcaption>
</figure>

先装 SQLite checkpointer(上一节第 3 步装过就跳过):

```bash
cd agent-60-lab
uv add langgraph-checkpoint-sqlite
```

```python
# agent-60-lab/w4/lgdemo/refund_approval.py
"""退款人工审批:Agent 起草退款方案 → interrupt 暂停等主管 → 批了才写库。
状态存在 SQLite 里,进程退出后用同一个 thread_id 还能接着跑。

用法:
  uv run python refund_approval.py start T1041          # 跑到审批点停下
  uv run python refund_approval.py status T1041         # 看停在哪
  uv run python refund_approval.py approve T1041 "核实无误"
  uv run python refund_approval.py reject T1041 "金额不对"
  uv run python refund_approval.py history T1041        # 列出所有 checkpoint
  uv run python refund_approval.py rewind T1041         # 回到审批前重新来一次
"""
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from pydantic import BaseModel, Field
from typing_extensions import TypedDict

from llm import get_llm

BIZ_DB = Path(__file__).parents[1] / "cloudledger" / "cloudledger.db"
CKPT_DB = Path(__file__).with_name("checkpoints.db")


class Proposal(BaseModel):
    invoice_id: str = Field(description="要退款的发票号,必须是工单里或发票列表里出现过的")
    amount_yuan: float = Field(gt=0, description="退款金额(元)")
    reason: str = Field(description="退款依据,一句话")


class Decision(BaseModel):
    approved: bool
    note: str = ""


class RefundState(TypedDict, total=False):
    ticket_id: str
    ticket_text: str
    invoices: str
    proposal: dict   # Proposal.model_dump();state 里只放能直接序列化的数据
    decision: dict   # Decision.model_dump()
    outcome: str


def biz() -> sqlite3.Connection:
    conn = sqlite3.connect(BIZ_DB)
    conn.row_factory = sqlite3.Row
    return conn


def load_ticket(state: RefundState) -> dict:
    with biz() as conn:
        t = conn.execute("SELECT * FROM tickets WHERE id = ?", (state["ticket_id"],)).fetchone()
        invs = conn.execute(
            "SELECT id, amount_cents, status, issued_at FROM invoices WHERE customer_id = ? "
            "ORDER BY issued_at DESC, id DESC LIMIT 5",
            (t["customer_id"],),
        ).fetchall()
    lines = [f"{r['id']} {r['amount_cents'] / 100:.2f}元 {r['status']} {r['issued_at']}" for r in invs]
    return {"ticket_text": t["body"], "invoices": "\n".join(lines)}


def draft_proposal(state: RefundState) -> dict:
    llm = get_llm().with_structured_output(Proposal, method="function_calling")
    proposal = llm.invoke(
        "你是云簿的账务专员。根据工单和发票记录起草退款方案。"
        "重复扣款只退重复的那一笔(通常是开票日期相同、较晚生成的那张)。\n\n"
        f"工单:{state['ticket_text']}\n\n最近发票:\n{state['invoices']}"
    )
    return {"proposal": proposal.model_dump()}


def human_approval(state: RefundState) -> dict:
    p = state["proposal"]
    # 这里会暂停。恢复时 Command(resume=...) 的值会变成 interrupt() 的返回值。
    # 注意:恢复后这个节点会从头重新执行一遍,所以 interrupt 之前不要放有副作用的代码。
    decision = interrupt(
        {
            "question": "是否批准这笔退款?",
            **p,
        },
        response_schema=Decision,  # 恢复值会按 Decision 校验,返回的是 Decision 实例
    )
    return {"decision": decision.model_dump()}


def after_approval(state: RefundState) -> str:
    return "execute" if state["decision"]["approved"] else "reject"


def execute_refund(state: RefundState) -> dict:
    p = state["proposal"]
    now = datetime.now().isoformat(timespec="seconds")  # 和 Day 23 server.py 一样用本地时间;SQLite 的 datetime('now') 是 UTC
    with biz() as conn:
        conn.execute(
            "INSERT INTO refund_requests (invoice_id, amount_cents, reason, status, created_at, decided_at, decided_by) "
            "VALUES (?, ?, ?, 'approved', ?, ?, 'supervisor')",
            (p["invoice_id"], round(p["amount_yuan"] * 100), p["reason"], now, now),
        )
    return {"outcome": f"已批准:{p['invoice_id']} 退 {p['amount_yuan']:.2f} 元。审批备注:{state['decision']['note']}"}


def reject_refund(state: RefundState) -> dict:
    return {"outcome": f"已驳回,转人工跟进。原因:{state['decision']['note']}"}


builder = StateGraph(RefundState)
builder.add_node("load", load_ticket)
builder.add_node("draft", draft_proposal)
builder.add_node("approval", human_approval)
builder.add_node("execute", execute_refund)
builder.add_node("reject", reject_refund)
builder.add_edge(START, "load")
builder.add_edge("load", "draft")
builder.add_edge("draft", "approval")
builder.add_conditional_edges("approval", after_approval, ["execute", "reject"])
builder.add_edge("execute", END)
builder.add_edge("reject", END)


def main() -> None:
    action, ticket_id = sys.argv[1], sys.argv[2]
    note = sys.argv[3] if len(sys.argv) > 3 else ""
    config = {"configurable": {"thread_id": f"refund-{ticket_id}"}}

    # check_same_thread=False:LangGraph 可能在别的线程里写 checkpoint
    with sqlite3.connect(CKPT_DB, check_same_thread=False) as conn:
        graph = builder.compile(checkpointer=SqliteSaver(conn))

        if action == "start":
            result = graph.invoke({"ticket_id": ticket_id}, config)
            if "__interrupt__" in result:
                payload = result["__interrupt__"][0].value
                print("已暂停,等待审批:", payload)
        elif action == "status":
            snap = graph.get_state(config)
            print("下一步要执行的节点:", snap.next)
            print("当前方案:", snap.values.get("proposal"))
        elif action in ("approve", "reject"):
            result = graph.invoke(Command(resume={"approved": action == "approve", "note": note}), config)
            print(result["outcome"])
        elif action == "rewind":
            # 时间旅行:找到「停在审批前」的那个 checkpoint,从那里重新跑一遍(会再次停在 interrupt)
            target = next(s for s in graph.get_state_history(config) if s.next == ("approval",))
            result = graph.invoke(None, target.config)
            print("已回到审批点,重新等待审批:", result["__interrupt__"][0].value)
        elif action == "history":
            for s in graph.get_state_history(config):
                print(s.config["configurable"]["checkpoint_id"], "next =", s.next)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `"""退款人工审批:` docstring 里列了六个子命令。下面每条注释用的数据,都是按这个顺序在一份种子 42 的 `cloudledger.db` 上实跑出来的。
- `import sqlite3` 这个文件要连两个 SQLite 库:业务库 `cloudledger.db` 和存执行状态的 `checkpoints.db`。
- `from langgraph.checkpoint.sqlite import SqliteSaver` 来自 `langgraph-checkpoint-sqlite` 包。实测版本是 3.1.2,配 langgraph 1.2.16。
- `from langgraph.types import Command, interrupt` `interrupt` 用来暂停,`Command(resume=...)` 用来恢复。
- `BIZ_DB = Path(__file__).parents[1] / "cloudledger" / "cloudledger.db"` `parents[0]` 是 `lgdemo` 目录,`parents[1]` 是 `w4`,拼起来就是 `w4/cloudledger/cloudledger.db`,也就是 Day 23 造的那个库。
- `CKPT_DB = Path(__file__).with_name("checkpoints.db")` checkpoint 库放在脚本旁边。实测跑完 start、approve、rewind、reject 一整套之后,这个文件是 53 KB,里面有 `checkpoints` 和 `writes` 两张表,分别是 9 行和 20 行。
- `class Proposal(BaseModel):` 让模型起草的退款方案。
- `invoice_id: str = Field(description="要退款的发票号,必须是工单里或发票列表里出现过的")` description 里写了约束,降低模型编造发票号的概率。
- `amount_yuan: float = Field(gt=0, description="退款金额(元)")` `gt=0` 在 schema 里变成 `"exclusiveMinimum": 0`,模型和 pydantic 两边都会看到这个约束。
- `class Decision(BaseModel):` 主管给出的决定:批不批,加一句备注。
- `class RefundState(TypedDict, total=False):` 字段一步步填,所以 `total=False`。
- `proposal: dict   # Proposal.model_dump()` 存字典,不存 pydantic 对象,原因见正文「State 里只放能直接序列化的数据」。
- `def biz() -> sqlite3.Connection:` 业务库连接,写法和 Day 23 的 `db()` 一样。
- `def load_ticket(state: RefundState) -> dict:` 第一个节点:读工单和这个客户最近的发票,不调模型。
- `t = conn.execute("SELECT * FROM tickets WHERE id = ?", (state["ticket_id"],)).fetchone()` 实测 T1041 的正文是 `你好,10 月 8 号我被扣了两次款,INV-2026-0026 和 INV-2026-0123 金额一模一样,麻烦把多扣的那笔退给我。`
- `"ORDER BY issued_at DESC, id DESC LIMIT 5",` 取最近 5 张,同一天的按 id 倒序,所以 0123 排在 0026 前面。
- `lines = [f"{r['id']} {r['amount_cents'] / 100:.2f}元 {r['status']} {r['issued_at']}" for r in invs]` 把每张发票压成一行文字给模型看。实测 5 行里前两行是 `INV-2026-0123 2392.00元 paid 2026-10-08` 和 `INV-2026-0026 2392.00元 paid 2026-10-08`,后三行是 9、8、7 月的。
- `return {"ticket_text": t["body"], "invoices": "\n".join(lines)}` 两个字段写进 State,下一个节点直接用。
- `def draft_proposal(state: RefundState) -> dict:` 整张图里唯一调模型的节点。
- `llm = get_llm().with_structured_output(Proposal, method="function_calling")` 和昨天的分类器同一个用法。要用昨天修好的、带 `extra_body` 的 `llm.py`,否则 DeepSeek 在这里会报 400。
- `"重复扣款只退重复的那一笔(通常是开票日期相同、较晚生成的那张)。\n\n"` 把业务规则写进提示词。这次实跑模型选了 `INV-2026-0123`,理由原文是:`与 INV-2026-0026 为同日(2026-10-08)同额 2392.00 元的重复扣款,INV-2026-0123 为较晚生成的一张,退还该笔重复款项。`
- `return {"proposal": proposal.model_dump()}` 实测存进 State 的是 `{'invoice_id': 'INV-2026-0123', 'amount_yuan': 2392.0, 'reason': '…'}`。
- `def human_approval(state: RefundState) -> dict:` 审批节点。下面这个「会重复执行」的现象是今天的重点。
- `decision = interrupt(` 第一次执行到这里,图暂停,传进去的字典交给调用方。我在节点开头加了一行打印做实验:start 时打印 1 次;拿缺字段的数据恢复(校验失败)又打印 1 次;拿正确数据恢复再打印 1 次。**每次恢复,这个节点都从第一行重新执行**,所以 interrupt 前面不能放发通知、写库这类有副作用的代码。
- `**p,` 把方案的三个字段摊进暂停时交出去的数据里。实测 start 打印的就是 `{'question': '是否批准这笔退款?', 'invoice_id': 'INV-2026-0123', 'amount_yuan': 2392.0, 'reason': '…'}`。
- `response_schema=Decision,  # 恢复值会按 Decision 校验,返回的是 Decision 实例` 实测恢复时传 `{"note": "缺 approved"}`,抛 `ValidationError: 1 validation error for Decision / approved / Field required`。传 `{"approved": True, "note": "核实无误"}` 时,`interrupt()` 返回 `Decision(approved=True, note='核实无误')`。
- `return {"decision": decision.model_dump()}` 转回字典再存进 State。
- `def after_approval(state: RefundState) -> str:` 条件边:批了去 `execute`,没批去 `reject`。
- `def execute_refund(state: RefundState) -> dict:` 只有主管批准后才会走到这里,真正写业务库。
- `now = datetime.now().isoformat(timespec="seconds")` 审批时间在 Python 里生成本地时间,和 Day 23 `server.py` 写 `created_at` 的方式一致。最早的版本在 SQL 里写 `datetime('now')`,实测北京时间 22 日早上 7:53 批的单,库里记成了 21 日 23:53,因为 SQLite 的 `datetime('now')` 是 **UTC**,和 Day 23 写进去的本地时间混在一张表里,排序和对账都会乱。
- `"VALUES (?, ?, ?, 'approved', ?, ?, 'supervisor')",` 时间也走占位符。实测写进去的一行是 `1|INV-2026-0123|239200|…|approved|2026-10-22T08:02:05|2026-10-22T08:02:05|supervisor`,和本机时间 08:02:05 一致。
- `(p["invoice_id"], round(p["amount_yuan"] * 100), p["reason"], now, now),` 元转分用 `round`,原因和 Day 23 一样:浮点乘 100 可能差一点点。`created_at` 和 `decided_at` 都用同一个 `now`。
- `return {"outcome": f"已批准:{p['invoice_id']} 退 {p['amount_yuan']:.2f} 元。审批备注:{state['decision']['note']}"}` 实测打印 `已批准:INV-2026-0123 退 2392.00 元。审批备注:核实无误`。
- `def reject_refund(state: RefundState) -> dict:` 驳回分支,不碰业务库。实测 `reject T1041 "金额不对"` 打印 `已驳回,转人工跟进。原因:金额不对`。
- `builder.add_edge("draft", "approval")` 起草完一定进审批,没有绕过人的路径。
- `builder.add_conditional_edges("approval", after_approval, ["execute", "reject"])` 审批之后分两路。
- `action, ticket_id = sys.argv[1], sys.argv[2]` 命令行参数。`sys.argv[0]` 是脚本名,所以从 1 开始取。
- `note = sys.argv[3] if len(sys.argv) > 3 else ""` 备注可以不写。
- `config = {"configurable": {"thread_id": f"refund-{ticket_id}"}}` 同一张工单永远是同一个 thread_id(`refund-T1041`),所以不同进程能接上同一次执行。
- `with sqlite3.connect(CKPT_DB, check_same_thread=False) as conn:` 每个子命令都是一个新进程,各自打开 checkpoint 库。
- `graph = builder.compile(checkpointer=SqliteSaver(conn))` 带上 checkpointer 编译,每个节点执行完都会存一个快照。
- `result = graph.invoke({"ticket_id": ticket_id}, config)` start:从头跑,跑到 interrupt 停下。实测返回值的键是 `['ticket_id', 'ticket_text', 'invoices', 'proposal', '__interrupt__']`,还没有 `decision` 和 `outcome`。
- `payload = result["__interrupt__"][0].value` `__interrupt__` 是一个列表,因为并行分支可能同时有多个中断。这里只有一个,实测元素类型是 `Interrupt`,`.value` 就是传给 `interrupt()` 的那个字典。
- `snap = graph.get_state(config)` status:不执行任何节点,只读最新快照。
- `print("下一步要执行的节点:", snap.next)` 实测 `('approval',)`。`snap.interrupts` 里有 1 个待处理中断,`snap.values` 的键是 `['ticket_id', 'ticket_text', 'invoices', 'proposal']`。
- `result = graph.invoke(Command(resume={"approved": action == "approve", "note": note}), config)` approve/reject 共用这一行,`action == "approve"` 算出 True 或 False。**对已经跑完的 thread 再 approve 一次**:实测打印的还是上一次的 `…审批备注:核实无误`(不是新备注「再批一次」),业务库仍然只有 1 行,没有重复写入。
- `target = next(s for s in graph.get_state_history(config) if s.next == ("approval",))` rewind:从新到旧找第一个「下一步是 approval」的快照。`next(生成器)` 取第一个满足条件的元素。
- `result = graph.invoke(None, target.config)` 输入传 `None` 表示不加新输入,从那个快照接着跑。实测又停在了审批点,打印出和第一次一样的方案(方案是从快照里读的,不会重新调模型)。
- `for s in graph.get_state_history(config):` history:列出所有快照,最新的在前。实测 start 之后有 4 个:`next` 依次是 `('approval',)`、`('draft',)`、`('load',)`、`('__start__',)`。approve 之后又多了 `('execute',)` 和 `()` 两个。rewind 再 reject 之后一共 9 个:最上面 3 个是新分叉出来的(`()`、`('reject',)`、`('approval',)`),原来那条批准的执行记录还在下面,没有被覆盖。
- `print(s.config["configurable"]["checkpoint_id"], "next =", s.next)` checkpoint_id 是按时间递增的 UUID,所以大致能看出先后。实测某个快照的完整 config 是 `{'configurable': {'thread_id': 'refund-T1041', 'checkpoint_ns': '', 'checkpoint_id': '1f1cdaab-…'}}`。

</div>

几处设计说明:

**State 里只放能直接序列化的数据。** 我最初把 pydantic 的 `Proposal` 对象直接放进 State,能跑,但每次从 SQLite 读回时都会打一行警告:`Deserializing unregistered type refund_approval.Proposal from checkpoint. This will be blocked in a future version.` 意思是 checkpoint 反序列化任意 Python 类有安全风险,未来版本默认会拒绝。最省心的做法是在节点里 `model_dump()` 成字典再放进 State。如果确实要存自定义类型,可以配置序列化器的白名单,但我不推荐给自己找这个麻烦。

**`response_schema=Decision`。** 这是 LangGraph 1.2.12 新增的参数,声明恢复时人要提供什么格式的数据。恢复值会按 `Decision` 校验(少了 `approved` 字段会报错),`interrupt()` 返回的直接是 `Decision` 实例。LangGraph Studio 这类界面还能根据它自动渲染出审批表单。版本低于 1.2.12 的话去掉这个参数,自己校验。

**`check_same_thread=False`。** SQLite 的 Python 驱动默认禁止跨线程使用连接,而 LangGraph 可能在后台线程里写 checkpoint,不加这个参数会偶发 `ProgrammingError`。

**业务库和 checkpoint 库分开。** `cloudledger.db` 是业务数据,`checkpoints.db` 是执行状态。生产里通常也是这样:checkpoint 放一个独立的 Postgres schema,业务库不受影响。

## 跑一遍,中间退出进程

```bash
cd w4/lgdemo
uv run python refund_approval.py start T1041
```

```text
已暂停,等待审批: {'question': '是否批准这笔退款?', 'invoice_id': 'INV-2026-0123', 'amount_yuan': 2392.0, 'reason': '10月8日与INV-2026-0026同日同额,重复扣款'}
```

命令结束了,进程退出了。这时候去喝杯咖啡,甚至重启电脑都行。回来后,先看看它停在哪:

```bash
uv run python refund_approval.py status T1041
```

```text
下一步要执行的节点: ('approval',)
当前方案: {'invoice_id': 'INV-2026-0123', 'amount_yuan': 2392.0, 'reason': '10月8日与INV-2026-0026同日同额,重复扣款'}
```

`get_state(config)` 返回的 `StateSnapshot` 里,`next` 告诉你下一步要执行哪个节点,`values` 是当前状态。这就是你以后做审批后台时,列表页「待审批工单」的数据来源。

主管看了方案,批准:

```bash
uv run python refund_approval.py approve T1041 "核实无误"
```

```text
已批准:INV-2026-0123 退 2392.00 元。审批备注:核实无误
```

一个新进程,读回 checkpoint,从 approval 节点接着跑完。去业务库里看看:

```bash
sqlite3 ../cloudledger/cloudledger.db "select id, invoice_id, amount_cents, status, decided_by from refund_requests"
```

模型起草的方案每次措辞会有些差别,但只要它把重复的那张 `INV-2026-0123` 找出来就是对的。如果它选成了 `INV-2026-0026`(另一张同日同额的发票),从业务上讲也说得通,退哪张都是退重复的那一笔。这类「有多个正确答案」的情况,W5 写评测时要专门处理。

这里还有一个容易被忽视的问题:如果对一个**已经跑完**的 thread 再发一次 `approve`,会发生什么?我试了一下,LangGraph 不会报错,也不会重复执行,直接返回已完成的最终状态。所以我们的命令行里重复批准是安全的。但如果你的审批系统允许「驳回后再改成批准」,就不能靠这个行为,得用下面的时间旅行。

## 时间旅行:回到审批前重来

checkpointer 存的不只是最新状态,而是每一步的快照。`get_state_history` 能把它们全列出来:

```bash
uv run python refund_approval.py history T1041
```

```text
1f1c60c9-ec87-633c-8004-385cf381da68 next = ()
1f1c60c9-ec84-6966-8003-2334aa13b691 next = ('execute',)
1f1c60c9-cbb6-6432-8002-c688f27c5583 next = ('approval',)
1f1c60c9-cbb0-6fb4-8001-187b3cd09d3a next = ('draft',)
1f1c60c9-cba8-6936-8000-5010c5631d0d next = ('load',)
1f1c60c9-cb9e-6b98-bfff-0960e76d2cba next = ('__start__',)
```

最新的在最上面。每个快照都有自己的 `checkpoint_id`。把某个快照的 config(里面同时带着 thread_id 和 checkpoint_id)传给 `invoke`,输入写 `None`,图就会**从那个时刻重新往下跑**:

```python
target = next(s for s in graph.get_state_history(config) if s.next == ("approval",))
result = graph.invoke(None, target.config)
```

`rewind` 命令就是这么实现的。它会回到「起草完、待审批」的那一刻,重新触发 interrupt,你可以给出不同的决定。之后再看 history,会发现原来的那条执行记录还在,新的执行从审批点分叉出来,像 git 的分支一样。官方把这叫 fork。

时间旅行在实际工作里有三个用处。一是调试:Agent 在第 7 步出错,你可以回到第 6 步,改一下状态(用 `graph.update_state(config, {...})`)再跑,不用从头重来,省时间也省 token。二是审批流程里的「撤回重审」。三是做评测时从同一个中间状态出发,比较不同提示词或模型的表现。

## 流式输出:三种 stream_mode

Day 24 简单提过 `stream`,今天把三种常用模式说完整。拿昨天的 `agent_graph` 举例:

```python
# 1) updates:每个节点执行完吐一次,内容是该节点返回的更新
for chunk in graph.stream(inputs, stream_mode="updates"):
    print(chunk)          # {'llm': {'messages': [...], 'llm_calls': 1}}

# 2) values:每一步吐一次完整状态
for state in graph.stream(inputs, stream_mode="values"):
    print(len(state["messages"]))

# 3) messages:逐 token 吐模型输出,还附带是哪个节点产生的
for token, meta in graph.stream(inputs, stream_mode="messages"):
    if meta["langgraph_node"] == "llm" and token.content:
        print(token.content, end="", flush=True)
```

<div class="line-notes">

- `for chunk in graph.stream(inputs, stream_mode="updates"):` 下面三种模式都用 Day 24 的 `agent_graph` 和「上海和北京现在温差几度?」实跑。updates 模式实测吐了 5 次:`llm`(1 条消息,llm_calls=1)→ `tools`(2 条)→ `llm`(1 条,llm_calls=2)→ `tools`(1 条)→ `llm`(1 条,llm_calls=3)。
- `print(chunk)          # {'llm': {'messages': [...], 'llm_calls': 1}}` 每个 chunk 都是「节点名 → 该节点返回的那个字典」,只有增量,看不到完整状态。
- `for state in graph.stream(inputs, stream_mode="values"):` values 模式每一步吐完整状态,包括最开始的输入。
- `print(len(state["messages"]))` 实测依次打印 `1, 2, 4, 5, 6, 7`:输入 1 条 → 模型回 1 条 → 两个工具结果 → 模型调 calculate → 工具结果 → 最终回答。
- `for token, meta in graph.stream(inputs, stream_mode="messages"):` messages 模式逐 token 吐,每项是 `(消息片段, 元数据)` 元组。实测整轮一共吐了 75 项,片段类型是 `AIMessageChunk`;`tools` 节点的工具结果也会出现在这里。
- `if meta["langgraph_node"] == "llm" and token.content:` `meta` 里有 `langgraph_node`、`langgraph_step` 等字段。按节点过滤掉工具结果,`token.content` 判空是为了跳过只有工具调用、没有文字的片段。
- `print(token.content, end="", flush=True)` `end=""` 不换行,`flush=True` 立刻刷到终端,打字机效果就靠这两个参数。实测最后一轮回答是一小段一小段到的:`现在|上海| |19|°|C|(|小雨|),|北京|…|两地|温差| **|4|°|C|**|…`(竖线是我加的分隔)。

</div>

`updates` 用来做后台日志和进度展示(「正在查发票……」);`values` 用来调试,看状态怎么一步步变;`messages` 用来做打字机效果,用户不用干等整段回复生成完。三种可以组合:`stream_mode=["updates", "messages"]`,这时每个 chunk 是一个 `(模式, 数据)` 元组。

带 interrupt 的图也能流式。流跑到 interrupt 就结束了,在 `updates` 模式里会看到一个 `__interrupt__` 键;流结束后也可以查 `graph.get_state(config).interrupts`,里面是待处理的中断元组,`next` 是被中断的节点名。

LangGraph 1.2 还推出了一套新的流式 API:`graph.stream_events(input, config, version="v3")`。它返回一个对象,你可以分别迭代 `stream.messages`(token)、`stream.values`(状态快照),跑完后读 `stream.interrupted` 判断是否暂停、`stream.interrupts` 拿中断内容、`stream.output` 拿最终状态。官方文档现在推荐新项目用它,因为不用再在一堆 chunk 里按类型分支判断。不过 `stream` 和 `invoke` 仍然完全可用,网上的绝大多数例子也都是老写法,我们这门课两种都会出现。

## 子图:把一段流程封装起来

最后简单说一下子图。一个编译好的图可以直接当另一个图的节点:

```python
refund_graph = refund_builder.compile()            # 子图不用单独传 checkpointer
main_builder.add_node("refund_flow", refund_graph)  # 当成一个普通节点
```

父图和子图共享状态里同名的字段。父图编译时传的 checkpointer 会自动传给子图,子图里的 interrupt 也能正常工作。它的用处是拆分复杂流程:毕业项目里,「退款处理」「技术问题排查」「账号问题」各是一个子图,主图只负责分类和路由,每个子图可以独立开发和测试。Day 26 讲多 Agent 时,子图也是实现「每个 Agent 有自己的私有状态」的主要手段。

## 放到真实系统里长什么样

命令行演示把审批人和 Agent 放在了同一个终端里,真实系统当然不是这样。做过 OA 或工单审批的后端同学对下面这个形状不会陌生,W6 做服务化时我们会真的把它写出来。

Agent 服务对外提供两个接口。一个是「处理工单」:收到工单后用 `refund-{工单号}` 作为 thread_id 调用 `graph.invoke`,如果结果里有 `__interrupt__`,就把 thread_id 和中断内容(发票号、金额、理由)写进一张 `pending_approvals` 表,然后给主管推一条消息。另一个是「提交审批」:主管在后台点批准或驳回,前端调这个接口,接口从表里查出 thread_id,用 `Command(resume=...)` 恢复图,跑完后更新表里的状态。

这里有三个细节,第一次做很容易漏。第一是超时:主管三天没处理怎么办?需要一个定时任务扫描超时的待审批记录,按规则自动驳回或者升级给更高一级。第二是并发:两个主管同时点了批准,同一个 thread 会被恢复两次,所以「提交审批」接口要先在表上加锁或者用状态字段做乐观锁,只让第一个请求生效。第三是审计:谁在什么时候批了什么,要留痕。LangGraph 的 checkpoint 历史本身就是一份很详细的执行记录,但它不是给审计人员看的,业务表里还是要单独记一笔。

这三个问题和 LangGraph 无关,换任何框架都得处理。框架帮你省掉的是「状态怎么存、执行位置怎么恢复」这部分最容易出错的底层工作,业务规则还得自己想清楚。面试时能把这几点说出来,面试官会知道你真的做过,而不是只跑过教程。

## 动手练习

1. 跑通 `refund_approval.py` 的完整流程:start → status → 关掉终端重开 → approve,确认业务库里出现 approved 记录。
2. 重新 seed 业务库,换一个 thread 跑一遍,这次 reject,然后用 `rewind` 回到审批点改成 approve。用 `history` 看分叉。
3. 做一个「副作用重复」实验:在 `human_approval` 里 `interrupt` 之前加一行 `print("已通知主管")`,完整跑一次 start + approve,数一数这行字打印了几次,用今天学的原理解释。然后把通知挪到 `draft` 节点末尾,再验证一次。
4. 把 Day 24 的 `agent_graph` 接上 `InMemorySaver`,用同一个 thread_id 连续 invoke 两次(第一次问「上海天气」,第二次问「那北京呢」),确认第二次模型记得上一轮的上下文。这就是多轮会话的实现方式。
5. 用 `stream_mode="messages"` 给 `agent_graph` 加上打字机效果输出。
6. 加分题:把 `SqliteSaver` 换成 `InMemorySaver`,重复第 1 题的「关掉终端重开」,观察失败现象,写一句话解释。

**验收标准**:第 1、2 题业务库里的记录和 history 输出都对得上;第 3 题能说清楚「打印两次」的原因和修法;第 4 题第二轮回答里正确引用了第一轮的信息;能不看代码说出 checkpointer、thread_id、interrupt、Command(resume) 四者的关系。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| checkpoint | 图在某一步执行完后的完整状态快照 |
| checkpointer | 负责保存和读取 checkpoint 的组件,如 InMemorySaver、SqliteSaver、PostgresSaver |
| thread_id | 一次独立执行(一段会话、一张工单)的标识,checkpoint 按它分组 |
| interrupt() | 在节点内暂停执行、把一个值交给调用方等待人工输入的函数 |
| Command(resume=...) | 恢复被中断的图,resume 的值成为 interrupt() 的返回值 |
| response_schema | interrupt 的参数,声明恢复值的格式并做校验(langgraph ≥ 1.2.12) |
| StateSnapshot | `get_state` 返回的快照对象,含 values、next、config、interrupts 等 |
| get_state_history | 列出一个 thread 的所有历史快照,最新在前 |
| 时间旅行 / fork | 从某个历史 checkpoint 重新执行,产生一条新的执行分支 |
| update_state | 手动修改某个 thread 的状态,生成一个新 checkpoint |
| stream_mode | 流式模式:updates、values、messages,可组合 |
| stream_events | LangGraph 1.2 新增的类型化流式 API,按 messages、values、interrupts 分别迭代 |
| 子图(subgraph) | 编译好的图作为另一张图的一个节点 |
| human-in-the-loop | 在自动化流程中让人参与关键决策的设计模式 |

## 常见误区

**以为恢复时从 interrupt 那一行接着执行。** 实际上被中断的节点会从头重新执行,interrupt 之前的代码会跑两次。发通知、写库、扣费这类副作用不要放在 interrupt 前面。

**生产里用 InMemorySaver。** 进程一重启所有待审批的流程全部丢失,而且多个实例之间不共享。生产用 PostgresSaver,开发用 SqliteSaver。

**thread_id 随手用随机 UUID 又不记录。** 审批恢复时你得能找回这个 id。用有业务含义的 id(如 `refund-T1041`),或者把 id 存进业务表。

**把 pydantic 对象、自定义类直接塞进 State。** 能跑,但反序列化会告警,未来版本会默认拒绝。State 里放字典和基本类型。

**一个 thread 里塞多个用户的对话。** thread 就是一段独立的上下文,串了会互相看到对方的历史,是数据泄露问题。按用户、按会话分 thread。

**用 `Command(update=...)` 当输入来续聊。** 官方文档明确说,作为 invoke 输入的 Command 只该用 `resume`。多轮对话直接传普通的输入字典,checkpointer 会把它接到历史后面。

## 学习资料

### 文档与文章

- [LangGraph · Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts):今天的核心文档,「Resuming interrupts」和「Common patterns」两节精读,特别是关于「节点会重新执行」的警告,1 小时。
- [LangGraph · Persistence](https://docs.langchain.com/oss/python/langgraph/persistence) 和 [Checkpointers](https://docs.langchain.com/oss/python/langgraph/checkpointers):checkpointer 与 store 的区别、各种实现、序列化与加密,40 分钟。
- [LangGraph · Time travel](https://docs.langchain.com/oss/python/langgraph/use-time-travel):replay 和 fork 的官方示例,20 分钟。
- [LangGraph · Streaming](https://docs.langchain.com/oss/python/langgraph/streaming) 与 [Event streaming](https://docs.langchain.com/oss/python/langgraph/event-streaming):先读老的 Streaming 页理解 stream_mode,再读 Event streaming 了解 v3 新 API。
- [LangGraph · Subgraphs](https://docs.langchain.com/oss/python/langgraph/use-subgraphs):子图的状态共享规则,15 分钟。
- [LangChain · Human-in-the-loop](https://docs.langchain.com/oss/python/langchain/human-in-the-loop):如果用高层 `create_agent`,这里的 `HumanInTheLoopMiddleware` 能在指定工具调用前自动插入审批,原理就是今天的 interrupt。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1z3NY66EY1&p=56&autoplay=0&high_quality=1" title="尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>尚硅谷 · LangGraph 教程(Day 24 推荐过的同一套) · 今天看第 56–60、65–77 集(checkpoint、Postgres 检查点、时间旅行和 fork)、84–93 集(interrupt 和审批)、107–116 集(流式和子图入门),共约 6.6 小时,不用一次看完。第 61–64 集装 PostgreSQL 可以跳过。分集清单见 Day 24 的学习资料。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1fykHY6EAF&autoplay=0&high_quality=1" title="LangGraph Interrupt:Human-In-The-Loop 人机交互手到擒来!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>沧海九粟 · LangGraph Interrupt:Human-In-The-Loop 人机交互手到擒来! · 21 分钟,讲 interrupt 刚推出时的设计和用法。2024 年 12 月录制,API 主体没变,但没有 response_schema 等新参数。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1PaWgz1Eu6&autoplay=0&high_quality=1" title="3小时完整教程:LangGraph从入门到实战-基础&进阶" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AIDeepCoder · 3小时完整教程:LangGraph从入门到实战-基础&进阶 · 进阶部分讲 checkpoint、记忆和人工介入,挑这几段看,大约 1 小时。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/6t7YJcEFUIY" title="LangGraph interrupt: Making it easier to build human-in-the-loop agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · LangGraph interrupt: Making it easier to build human-in-the-loop agents · 8 分钟,官方介绍 interrupt 的设计动机,重点听为什么恢复时节点要重新执行。</figcaption>
</figure>

- LangChain Academy [Introduction to LangGraph](https://academy.langchain.com/courses/intro-to-langgraph) 的 Module 2(状态与记忆)和 Module 3(人工介入、时间旅行):有视频有 notebook,和今天内容一一对应,约 2 小时。
- DeepLearning.AI 短课 [Long-Term Agentic Memory with LangGraph](https://www.deeplearning.ai/short-courses/long-term-agentic-memory-with-langgraph/):讲跨 thread 的长期记忆(store),和 checkpointer 的短期记忆互补,Day 48 做毕业项目记忆模块时会用到,今天可以先看前两节。

### 书籍

- Mayo Oshin、Nuno Campos《Learning LangChain》(O'Reilly, 2025):第 4 章讲用 LangGraph 加记忆(checkpointer),和今天前半部分对应;后面讲 Agent 架构的章节里有人工介入的模式讨论。
- Chip Huyen《AI Engineering》(O'Reilly, 2025)第 6 章 Agents 部分关于「什么操作需要人确认」的讨论,结合今天的退款审批思考你会把哪些操作设为需审批。

### 开源项目与代码

- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):`libs/checkpoint-sqlite` 目录是 SqliteSaver 的源码,看一下它建了哪几张表,就知道 checkpoint 存了什么。
- [langchain-ai/langchain-academy](https://github.com/langchain-ai/langchain-academy):`module-3` 下的 breakpoints、edit-state、time-travel 几个 notebook。

## 自测

1. 不用 checkpointer,只用 `interrupt()`,会发生什么?

<details><summary>答案</summary>

第一次调用不会报错,`invoke` 照样返回带 `__interrupt__` 的结果,看起来像是暂停成功了,这正是坑人的地方。但状态没有地方存,等你用 `Command(resume=...)` 恢复时,我实测在 langgraph 1.2.14 上直接抛 `RuntimeError: Cannot use Command(resume=...) without checkpointer`。所以 interrupt 必须配 checkpointer,开发时至少用 InMemorySaver。

</details>

2. 下面这个节点,从开始到审批完成,`send_wecom_notice` 会被调用几次?怎么改?

```python
def human_approval(state):
    send_wecom_notice(f"有一笔退款待审批:{state['proposal']}")
    decision = interrupt({"question": "批准吗?"})
    return {"decision": decision}
```

<details><summary>答案</summary>

两次。第一次执行到 interrupt 暂停;恢复时节点从头重新执行,又发了一次通知,然后 interrupt 直接返回 resume 值。改法:把通知挪到前一个节点(比如 draft 的末尾)或单独做一个 notify 节点放在 approval 前面;或者让通知幂等(按 thread_id 去重)。

</details>

3. 两个用户同时在用你的客服 Agent,你用了同一个 thread_id。会出什么问题?

<details><summary>答案</summary>

两个人的消息会被追加到同一份状态里,模型会看到对方的对话历史,既会答非所问,也是严重的数据泄露。thread_id 必须按会话隔离,通常是「用户 id + 会话 id」。

</details>

4. 主管驳回了一笔退款,第二天发现驳回错了,想改成批准。用 LangGraph 怎么做?直接再发一次 `Command(resume={"approved": True})` 行吗?

<details><summary>答案</summary>

不行。thread 已经执行完了,再发 resume 不会重新执行审批节点,只会返回已完成的最终状态。正确做法是时间旅行:用 `get_state_history` 找到 `next == ("approval",)` 的那个 checkpoint,用它的 config 调用 `invoke(None, config)` 重新触发 interrupt,再用 resume 给出新决定。这会产生一条新的执行分支,原来的驳回记录保留在历史里,方便审计。

</details>

5. 你要在前端展示「Agent 正在查询发票……」「Agent 正在起草回复……」这样的进度,同时逐字显示最终回复。用哪种 stream_mode?

<details><summary>答案</summary>

组合使用 `stream_mode=["updates", "messages"]`。updates 告诉你哪个节点刚执行完(据此显示进度文案),messages 逐 token 推送模型输出(打字机效果)。用新 API 的话,`stream_events(..., version="v3")` 分别迭代 `stream.values` 和 `stream.messages`。

</details>

6. **面试题**:「你的 Agent 有一步需要人工审批,审批可能要等几个小时,期间服务会重启。你怎么设计?」

<details><summary>答案</summary>

参考要点:用持久化的状态机思路。LangGraph 的做法是 checkpointer(生产用 Postgres)在每一步保存状态,审批节点调用 interrupt 暂停,把待审批内容返回给业务系统;业务系统把 thread_id 和待审批数据存进审批表,推送给审批人;审批结果通过 API 回来后,用同一个 thread_id 和 `Command(resume=...)` 恢复。注意点:interrupt 前不放副作用(恢复时节点会重跑);thread_id 要有业务含义并持久化;执行写操作的节点要幂等;设置审批超时(定时任务扫描超时未审批的 thread 自动驳回或升级);保留历史快照用于审计和撤回重审。不用 LangGraph 也能做,本质是「状态持久化 + 可恢复的执行位置」,可以对比 Temporal 这类 durable execution 引擎。

</details>

## 明天预告

Day 26 · 多 Agent:orchestrator-worker、handoff、上下文隔离,以及什么时候不该用。多 Agent 是这两年最热的词,也是最容易被滥用的架构。明天先看 Anthropic 和 Cognition 两篇观点相反的文章,算清楚多 Agent 的 token 账,然后在 CloudLedger 上实现两种拓扑:主管 Agent 把子 Agent 当工具调用,以及账务 Agent 和技术 Agent 之间的交接。
