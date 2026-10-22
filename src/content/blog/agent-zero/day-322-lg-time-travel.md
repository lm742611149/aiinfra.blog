---
title: 'Day 322 · LangGraph(二十):时间旅行,回到审批前重来'
description: 'checkpointer 存的不只是最新状态,而是每一步的快照。今天学两件事:拿一张旧快照的 config 重新 invoke(重放),以及先用 update_state 改一下旧快照再跑(分叉)。先在两节点的玩具图上看清楚谁会重跑、历史怎么长,再给退款审批加上 history、rewind、fork 三个命令,最后踩一个时间旅行不会帮你撤销的坑:业务库里重复退款。'
pubDate: 2026-10-22
regime: none
tags: ['langgraph', 'time-travel', 'checkpoint', 'agent-zero']
series: 'agent-zero'
day: 322
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 321](/blog/agent-zero/day-321-week46-review/) 是复习日,用「仓库、抽屉、快照」那句话把本周的名词串了起来:checkpointer 是仓库,thread_id 是抽屉,checkpoint 是抽屉里按时间叠起来的一张张快照,`get_state` 拿最上面那张。那天的小项目还撞见一个坑,对一条已经存在的线再传新输入,LangGraph 会从 START 再跑一遍。

[Day 320](/blog/agent-zero/day-320-lg-refund-approval/) 留了一个尾巴:主管驳回了 T1041 的退款,过了一会儿又想改主意,结果再发 `approve` 什么都没发生,返回的还是「已驳回」。原因是那条线已经跑完了,`next` 是空的,没有可以恢复的中断。今天就来解决它。办法就藏在 Day 317 天天打印的那串历史快照里:既然每一步都存了,能不能回到「起草完、还没审批」那一张,从那里重新来?

## 今天要解决的问题

学完今天,你要能做到:

1. 从 `get_state_history` 里挑出一张旧快照,用它的 config 重新 `invoke(None, ...)`,并说出哪些节点会重跑、哪些不会(重放)。
2. 用 `update_state` 在旧快照上改一个字段再往下跑,说清楚它为什么不会覆盖原来的历史(分叉)。
3. 给退款审批加上 `history`、`rewind`、`fork` 三个命令:驳回后回到审批前重审,或者把金额改成 1196 元再审。
4. 说出时间旅行管不到的地方:它只倒回 LangGraph 的状态,已经写进业务库的退款不会跟着消失。

预计用时 2.5 小时。前置:[Day 317](/blog/agent-zero/day-317-lg-state-history/) 的 `get_state_history`,[Day 318](/blog/agent-zero/day-318-lg-sqlite-saver/) 的 SqliteSaver,[Day 319](/blog/agent-zero/day-319-lg-interrupt/) 的 interrupt,以及 Day 320 的 `refund_approval.py` 和 `checkpoints.db`。另外用到 [Day 57](/blog/agent-zero/day-057-git-2/) 的 git 分支做类比。今天的玩具图不调模型;退款审批部分每次 `start` 调一次模型,全天连练习大约调 7 次,算式在最后一步。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章把 `refund_tt.py` 里找快照、`update_state`、`invoke(None, ...)` 那三行默写出来;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 先看图:历史不是一条线,是一棵树

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="退款审批的快照历史:主线从 start 到 load、draft、approval、reject、结束;从 approval 那张快照分出一条新线,经过 fork 快照、execute、结束">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11" text-anchor="middle">
    <rect x="14" y="56" width="70" height="40" rx="4" fill="none" stroke="var(--ink-faint)"/>
    <text x="49" y="72" fill="var(--ink-soft)">d7b5 -1</text><text x="49" y="88" fill="var(--ink-faint)">输入</text>
    <rect x="100" y="56" width="70" height="40" rx="4" fill="none" stroke="var(--ink-faint)"/>
    <text x="135" y="72" fill="var(--ink-soft)">eee0 0</text><text x="135" y="88" fill="var(--ink-faint)">→load</text>
    <rect x="186" y="56" width="70" height="40" rx="4" fill="none" stroke="var(--ink-faint)"/>
    <text x="221" y="72" fill="var(--ink-soft)">d190 1</text><text x="221" y="88" fill="var(--ink-faint)">→draft</text>
    <rect x="272" y="56" width="84" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="314" y="72" fill="var(--ink)">e706 2</text><text x="314" y="88" fill="var(--ink)">→approval</text>
    <rect x="384" y="56" width="76" height="40" rx="4" fill="none" stroke="var(--ink-faint)"/>
    <text x="422" y="72" fill="var(--ink-soft)">8792 3</text><text x="422" y="88" fill="var(--ink-faint)">→reject</text>
    <rect x="476" y="56" width="76" height="40" rx="4" fill="none" stroke="var(--ink-faint)"/>
    <text x="514" y="72" fill="var(--ink-soft)">4ce8 4</text><text x="514" y="88" fill="var(--ink-faint)">已驳回</text>
    <rect x="384" y="150" width="76" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="422" y="166" fill="var(--ink)">858a 3</text><text x="422" y="182" fill="var(--ink)">fork</text>
    <rect x="476" y="150" width="76" height="40" rx="4" fill="none" stroke="var(--ink-soft)"/>
    <text x="514" y="166" fill="var(--ink)">22f6 4</text><text x="514" y="182" fill="var(--ink-soft)">→execute</text>
    <rect x="566" y="150" width="64" height="40" rx="4" fill="none" stroke="var(--ink-soft)"/>
    <text x="598" y="166" fill="var(--ink)">8095 5</text><text x="598" y="182" fill="var(--ink-soft)">已批准</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="84" y1="76" x2="100" y2="76"/><line x1="170" y1="76" x2="186" y2="76"/><line x1="256" y1="76" x2="272" y2="76"/>
    <line x1="356" y1="76" x2="384" y2="76"/><line x1="460" y1="76" x2="476" y2="76"/>
    <line x1="460" y1="170" x2="476" y2="170"/><line x1="552" y1="170" x2="566" y2="170"/>
  </g>
  <path d="M314 96 L314 170 L384 170" fill="none" stroke="var(--compute)" stroke-dasharray="4 3"/>
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">
    <text x="20" y="30">每个方块 = 一张快照:checkpoint_id 末 4 位 + step;箭头 = 父快照指向子快照</text>
    <text x="20" y="130">主线:start → reject(Day 320 的结局)</text>
    <text x="20" y="226">rewind 从 e706 分出新线,旧的驳回记录原样留着;get_state 拿的是最新写入的 8095</text>
  </g>
</svg>
<figcaption>这是今天第 3 步实跑出来的真实历史(id 取末 4 位)。从 e706「准备审批」那张快照分出了第二条线。和 git 一样:切回旧提交再提交,长出的是新分支,旧分支一个字都不会少。</figcaption>
</figure>

如果你在 Day 57 用过 `git switch -c` 从一个旧提交拉分支,今天的东西会很眼熟。区别是 git 的分支有名字,LangGraph 的分叉没有名字,它只是让新快照的「父快照」指向一张旧的,`get_state` 永远拿最新写进去的那张。

今天就两个新概念:

- **重放(replay)**:把一张旧快照的 config 交给 `invoke`,输入写 `None`,图从那一刻往下重新执行。
- **分叉(fork)**:先用 `update_state` 在旧快照上改点东西(会生成一张新快照),再从新快照往下跑。

两个都先在玩具图上跑,然后才碰退款审批。

## 第 1 步:重放,从旧快照往下重新跑

玩具图就是 Day 317 用过的两节点图:draft 把金额定成 2392,execute 写一句「已退多少元」。每个节点开头打一行,方便数谁执行了。

```python
# agent-zero-lab/part05/lg_steps/tt_replay.py
from typing import TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import START, StateGraph


class State(TypedDict):
    amount: int
    result: str


def draft(state: State) -> dict:
    print("  [draft 执行]")
    return {"amount": 2392}


def execute(state: State) -> dict:
    print("  [execute 执行]")
    return {"result": f"已退 {state['amount']} 元"}


builder = StateGraph(State)
builder.add_node("draft", draft)
builder.add_node("execute", execute)
builder.add_edge(START, "draft")
builder.add_edge("draft", "execute")
graph = builder.compile(checkpointer=InMemorySaver())
config: RunnableConfig = {"configurable": {"thread_id": "F1"}}

print("原始:")
print(graph.invoke({"amount": 0, "result": ""}, config))

history = list(graph.get_state_history(config))
print("历史", len(history), "张:", [s.next for s in history])
before = next(s for s in history if s.next == ("execute",))
print("选中的快照:", before.values)

print("重放:")
print(graph.invoke(None, before.config))
print("历史", len(list(graph.get_state_history(config))), "张")
```

<div class="line-notes">

- `class State(TypedDict):` 两个字段都必填,所以第一次 invoke 要把 `amount` 和 `result` 都给上。
- `print("  [draft 执行]")` 数执行次数用的。看输出,重放时它不会出现。
- `graph = builder.compile(checkpointer=InMemorySaver())` 时间旅行靠的就是 checkpointer 存下的历史,同一个进程里玩,内存版就够了。
- `print(graph.invoke({"amount": 0, "result": ""}, config))` 正常跑一遍:draft 把金额改成 2392,execute 写出 `已退 2392 元`。
- `history = list(graph.get_state_history(config))` Day 317 学过:从新到旧列出这条线上所有快照。它返回的是生成器,`list()` 一下才能取长度、反复遍历,相当于 JS 里把迭代器 `Array.from` 一下。
- `print("历史", len(history), "张:", [s.next for s in history])` 实跑 4 张,`next` 从新到旧是 `()`、`('execute',)`、`('draft',)`、`('__start__',)`。
- `before = next(s for s in history if s.next == ("execute",))` 内置函数 `next(生成器)` 取出第一个符合条件的元素,相当于 JS 的 `history.find(s => ...)`。注意这个 `next()` 是 Python 内置函数,和快照上的 `.next` 属性同名但毫无关系。挑到的是「draft 跑完、execute 还没跑」那一张。
- `print("选中的快照:", before.values)` 那一刻的状态是 `{'amount': 2392, 'result': ''}`,金额已经定了,结果还没写。
- `print(graph.invoke(None, before.config))` 今天的核心一行。`before.config` 里除了 `thread_id` 还多一个 `checkpoint_id`,告诉 LangGraph「从这一张开始」;输入写 `None` 表示不给新输入。和 Day 321 那个坑对比:那天传的是新字典,所以从 START 重跑;今天传 `None` 加一个指定的快照,从快照处接着跑。
- `print("历史", len(list(graph.get_state_history(config))), "张")` 重放后变成 6 张,原来的 4 张一张没少。

</div>

```bash
cd agent-zero-lab/part05/lg_steps
uv run python tt_replay.py
```

```text
原始:
  [draft 执行]
  [execute 执行]
{'amount': 2392, 'result': '已退 2392 元'}
历史 4 张: [(), ('execute',), ('draft',), ('__start__',)]
选中的快照: {'amount': 2392, 'result': ''}
重放:
  [execute 执行]
{'amount': 2392, 'result': '已退 2392 元'}
历史 6 张
```

重放那一段只打了 `[execute 执行]`。快照之前的 draft 不会重跑,它的结果已经存在快照里了;快照之后的 execute **会真的再执行一遍**,不是从缓存里读出上次的结果。官方文档的原话是 Replay re-executes nodes, it doesn't just read from cache。所以如果快照后面是调模型的节点,重放就要再花一次钱,而且模型可能给出不一样的答案。练习 1 会在退款图上验证这一点。

多出来的 2 张是什么?再写一个小脚本,把每张快照的 `metadata` 和父快照打出来:

```python
# agent-zero-lab/part05/lg_steps/tt_replay_tree.py
from tt_replay import config, graph

print("每张快照:step、source、next、values、自己和父快照的 id 末 6 位")
for s in graph.get_state_history(config):
    m = s.metadata or {}
    me = s.config.get("configurable", {})["checkpoint_id"][-6:]
    parent = (s.parent_config or {}).get("configurable", {}).get("checkpoint_id", "")[-6:]
    print(m.get("step"), m.get("source"), s.next, s.values, me, parent)
```

<div class="line-notes">

- `from tt_replay import config, graph` 导入 `tt_replay.py` 会把它从头执行一遍(它没有 `if __name__ == "__main__":` 保护),所以上面那段输出会再打一次,导入完成时重放也已经做完了。这里正好借它的结果。
- `m = s.metadata or {}` `metadata` 类型上可能是 `None`,`or {}` 兜底,相当于 JS 的 `s.metadata ?? {}`。
- `me = s.config.get("configurable", {})["checkpoint_id"][-6:]` 自己的 checkpoint_id,`[-6:]` 取末 6 个字符,相当于 JS 的 `.slice(-6)`。
- `parent = (s.parent_config or {}).get("configurable", {}).get("checkpoint_id", "")[-6:]` `parent_config` 指向上一张快照,最早那张没有父亲(是 `None`),一路用 `or {}` 和 `.get` 兜底,最后得到空字符串。
- `print(m.get("step"), m.get("source"), s.next, s.values, me, parent)` 六列:step、来源、下一步、状态、自己、父亲。

</div>

```bash
uv run python tt_replay_tree.py
```

```text
原始:
  [draft 执行]
  [execute 执行]
{'amount': 2392, 'result': '已退 2392 元'}
历史 4 张: [(), ('execute',), ('draft',), ('__start__',)]
选中的快照: {'amount': 2392, 'result': ''}
重放:
  [execute 执行]
{'amount': 2392, 'result': '已退 2392 元'}
历史 6 张
每张快照:step、source、next、values、自己和父快照的 id 末 6 位
3 loop () {'amount': 2392, 'result': '已退 2392 元'} d79dd1 8e58ba
2 fork ('execute',) {'amount': 2392, 'result': ''} 8e58ba 9d686c
2 loop () {'amount': 2392, 'result': '已退 2392 元'} 874fcf 9d686c
1 loop ('execute',) {'amount': 2392, 'result': ''} 9d686c c1193f
0 loop ('draft',) {'amount': 0, 'result': ''} c1193f 9119e3
-1 input ('__start__',) {} 9119e3 
```

第一列是 step,第二列是 `source`(这张快照是怎么来的:`input` 收到输入,`loop` 节点跑完,`fork` 从旧快照复制)。看最后一列:原来那张结局 `874fcf` 的父亲是 `9d686c`,新的 `8e58ba` 父亲**也是** `9d686c`。也就是说,重放时 LangGraph 先把你选的那张快照复制一份(source 是 `fork`),再从副本往下跑。两条线从 `9d686c` 分了叉,和上面那张图一个形状。

## 第 2 步:分叉,先改状态再往下跑

重放只能「原样再来一次」。审批场景里更常见的需求是改一点东西再来,比如主管说金额改成一半。这就是 `update_state`:在一张旧快照的基础上写入新值,生成一张新快照,返回新快照的 config。

```python
# agent-zero-lab/part05/lg_steps/tt_fork.py
from typing import TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import START, StateGraph


class State(TypedDict):
    amount: int
    result: str


def draft(state: State) -> dict:
    print("  [draft 执行]")
    return {"amount": 2392}


def execute(state: State) -> dict:
    print("  [execute 执行]")
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
print("update_state 返回:", forked.get("configurable"))
print("分叉后 next =", graph.get_state(forked).next)
print("分叉:", graph.invoke(None, forked))

print("最新:", graph.get_state(config).values)
for s in graph.get_state_history(config):
    m = s.metadata or {}
    print(m.get("step"), m.get("source"), s.next, s.values)
```

<div class="line-notes">

- `class State(TypedDict):` 图和第 1 步一模一样,只有下半段不同。
- `print("原始:", graph.invoke({"amount": 0, "result": ""}, config))` 先正常跑完,得到 `已退 2392 元`。
- `before = next(s for s in graph.get_state_history(config) if s.next == ("execute",))` 和第 1 步一样,找到 execute 之前那一刻。
- `forked = graph.update_state(before.config, {"amount": 1196})` 第一个参数说「在哪张快照上改」,第二个参数是要写入的字段,写法和节点的返回值一样,只写要改的字段。它**不改** `before` 那张快照本身,而是在它后面新长出一张,返回新那张的 config。
- `print("update_state 返回:", forked.get("configurable"))` 返回值是一个 config 字典,里面的 `checkpoint_id` 是新快照的 id。用 `.get` 是因为类型上 `configurable` 是可选键,直接 `["configurable"]` 会被 basedpyright 标红。
- `print("分叉后 next =", graph.get_state(forked).next)` 新快照的 `next` 还是 `('execute',)`。`update_state` 只写状态,不执行任何节点。LangGraph 会推断这次修改「算是哪个节点写的」(这里推断成 draft),所以下一步仍然是 draft 的后继 execute。
- `print("分叉:", graph.invoke(None, forked))` 从新快照往下跑,execute 看到的金额是 1196。
- `print("最新:", graph.get_state(config).values)` 只按 thread_id 查(不带 checkpoint_id),拿到的是分叉线的结果。「最新」指的是最后写进去的那张,不管它在哪条线上。
- `m = s.metadata or {}` 和上面 `tt_replay_tree.py` 一样的兜底。
- `print(m.get("step"), m.get("source"), s.next, s.values)` 每张快照打出 step、来源、`next` 和状态。

</div>

```bash
uv run python tt_fork.py
```

```text
  [draft 执行]
  [execute 执行]
原始: {'amount': 2392, 'result': '已退 2392 元'}
update_state 返回: {'thread_id': 'F1', 'checkpoint_ns': '', 'checkpoint_id': '1f1cdd48-c1b8-65ec-8002-97948ba38e1e'}
分叉后 next = ('execute',)
  [execute 执行]
分叉: {'amount': 1196, 'result': '已退 1196 元'}
最新: {'amount': 1196, 'result': '已退 1196 元'}
3 loop () {'amount': 1196, 'result': '已退 1196 元'}
2 update ('execute',) {'amount': 1196, 'result': ''}
2 loop () {'amount': 2392, 'result': '已退 2392 元'}
1 loop ('execute',) {'amount': 2392, 'result': ''}
0 loop ('draft',) {'amount': 0, 'result': ''}
-1 input ('__start__',) {}
```

从下往上读。最下面 4 张是原始执行;倒数第三张 `2 loop` 就是原来那个 `已退 2392 元` 的结局,还在;`2 update` 是 `update_state` 新建的那张,source 是 `update`,金额已经是 1196、结果还空着;最上面是分叉线跑完的结局。`checkpoint_id` 那一串 `1f1cdd48-...` 是按时间递增生成的,所以「最新」的判断不会乱。

和第 1 步比,分叉只多了一步 `update_state`,draft 照样没有重跑。官方文档对这一点讲得很直白:`update_state` does not roll back a thread,它不是回滚,是从指定的点长出一个分支。

## 第 3 步:给退款审批加上 history 和 rewind

现在回到 Day 320 的退款图。不改 `refund_approval.py`,另写一个 `refund_tt.py`,直接导入那边的 `builder` 和 `CKPT_DB`,所以两个文件读写的是同一个 `checkpoints.db`。批准和驳回还是用原来的 `refund_approval.py approve/reject`。

```python
# agent-zero-lab/part05/lgdemo/refund_tt.py
"""退款审批的时间旅行:看历史、回到审批前重审、改金额再审。
图和 checkpoint 库都用 Day 320 的 refund_approval.py,这个文件只加三个命令。

用法(在 agent-zero-lab/part05/lgdemo 目录下):
  uv run python refund_tt.py history T1041        # 列出这条线上的所有快照
  uv run python refund_tt.py rewind T1041         # 回到审批前,重新等审批
  uv run python refund_tt.py fork T1041 1196      # 回到审批前,金额改成 1196 再等审批
批准/驳回还是用 refund_approval.py approve / reject。
"""
import sqlite3
import sys

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite import SqliteSaver

from refund_approval import CKPT_DB, builder


def short(c: RunnableConfig | None) -> str:
    if c is None:
        return "-"
    return c.get("configurable", {})["checkpoint_id"][-4:]


def main() -> None:
    action, ticket_id = sys.argv[1], sys.argv[2]
    config: RunnableConfig = {"configurable": {"thread_id": f"refund-{ticket_id}"}}

    with sqlite3.connect(CKPT_DB, check_same_thread=False) as conn:
        graph = builder.compile(checkpointer=SqliteSaver(conn))

        if action == "history":
            for s in graph.get_state_history(config):
                m = s.metadata or {}
                print(short(s.config), "<-", short(s.parent_config), m.get("step"), m.get("source"), "next =", s.next)
            return

        target = next(s for s in graph.get_state_history(config) if s.next == ("approval",))
        print("回到快照", short(target.config), "当时的方案金额:", target.values["proposal"]["amount_yuan"])
        run_from = target.config
        if action == "fork":
            new_proposal = {**target.values["proposal"], "amount_yuan": float(sys.argv[3])}
            run_from = graph.update_state(target.config, {"proposal": new_proposal})
            print("update_state 新建快照", short(run_from))
        result = graph.invoke(None, run_from)
        print("重新等待审批:", result["__interrupt__"][0].value)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from refund_approval import CKPT_DB, builder` Day 320 的图定义和 checkpoint 库路径。`refund_approval.py` 末尾有 `if __name__ == "__main__":`,被导入时不会执行它的 `main()`。
- `def short(c: RunnableConfig | None) -> str:` 只是为了打印好看:checkpoint_id 有 36 个字符,取末 4 位就够区分了。`RunnableConfig | None` 相当于 TS 的 `RunnableConfig | null`。
- `return "-"` 最早那张快照没有父亲,`parent_config` 是 `None`,打一个短横。
- `return c.get("configurable", {})["checkpoint_id"][-4:]` `[-4:]` 是字符串切片,取最后 4 个字符,相当于 JS 的 `.slice(-4)`。
- `config: RunnableConfig = {"configurable": {"thread_id": f"refund-{ticket_id}"}}` 和 Day 320 一样的拼法,T1041 对应 `refund-T1041`。
- `print(short(s.config), "<-", short(s.parent_config), m.get("step"), m.get("source"), "next =", s.next)` 每行五样东西:自己的 id、父快照的 id、step、来源、下一步。`parent_config` 是快照对象上的属性,指向它的上一张,有了它才能看出哪里分了叉。
- `return` history 打印完就结束,下面是 rewind 和 fork 共用的部分。
- `target = next(s for s in graph.get_state_history(config) if s.next == ("approval",))` 从新到旧找第一张「下一步是 approval」的快照,也就是「起草完、还没审批」那一刻。注意是**从新到旧**找第一张,后面会看到这个细节的影响。
- `print("回到快照", short(target.config), "当时的方案金额:", target.values["proposal"]["amount_yuan"])` 打印选中了哪一张、那时候方案是多少钱。实跑 rewind 时是 `e706` 和 `2392.0`。
- `run_from = target.config` rewind 就从这张旧快照本身往下跑,也就是第 1 步的重放。
- `new_proposal = {**target.values["proposal"], "amount_yuan": float(sys.argv[3])}` fork 时复制一份旧方案,只换掉金额。`{**a, "k": v}` 相当于 JS 的 `{...a, k: v}`。`sys.argv[3]` 是字符串 `"1196"`,`float` 转成 `1196.0`。不原地改 `target.values["proposal"]`,Day 320 讲过原地改 state 是坏习惯。
- `run_from = graph.update_state(target.config, {"proposal": new_proposal})` 第 2 步的分叉:在旧快照上写入新方案,拿到新快照的 config。
- `result = graph.invoke(None, run_from)` 从选中的(或新建的)快照往下跑。快照的 `next` 是 approval,所以跑的第一个节点就是 approval,它调 `interrupt()`,图又停下来。load 和 draft 都不会重跑,**不调模型,不花钱**。
- `print("重新等待审批:", result["__interrupt__"][0].value)` 又拿到了交给主管的那个字典,说明重新进入了等审批的状态。

</div>

先把 Day 320 的「驳回」场景复现一遍,再看历史:

```bash
cd agent-zero-lab && uv run python cloudledger/seed.py && cd part05/lgdemo
rm -f checkpoints.db
uv run python refund_approval.py start T1041
uv run python refund_approval.py reject T1041 "金额不对"
uv run python refund_tt.py history T1041
```

```text
已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}
已暂停,等待审批: {'question': '是否批准这笔退款?', 'invoice_id': 'INV-2026-0123', 'amount_yuan': 2392.0, 'reason': '与 INV-2026-0026 为 2026-10-08 同日同额重复扣款，INV-2026-0123 为较晚生成的一张，退还该笔重复款项'}
已驳回,转人工跟进。原因:金额不对
4ce8 <- 8792 4 loop next = ()
8792 <- e706 3 loop next = ('reject',)
e706 <- d190 2 loop next = ('approval',)
d190 <- eee0 1 loop next = ('draft',)
eee0 <- d7b5 0 loop next = ('load',)
d7b5 <- - -1 input next = ('__start__',)
```

6 张快照,一条直线,每张的父亲都是它下面那一张。`e706` 那张的 `next` 是 `('approval',)`,就是我们要回去的地方。主管说「我改主意了,回去重审」:

```bash
uv run python refund_tt.py rewind T1041
uv run python refund_approval.py status T1041
uv run python refund_tt.py history T1041
```

```text
回到快照 e706 当时的方案金额: 2392.0
重新等待审批: {'question': '是否批准这笔退款?', 'invoice_id': 'INV-2026-0123', 'amount_yuan': 2392.0, 'reason': '与 INV-2026-0026 为 2026-10-08 同日同额重复扣款，INV-2026-0123 为较晚生成的一张，退还该笔重复款项'}
下一步要执行的节点: ('approval',)
当前方案: {'invoice_id': 'INV-2026-0123', 'amount_yuan': 2392.0, 'reason': '与 INV-2026-0026 为 2026-10-08 同日同额重复扣款，INV-2026-0123 为较晚生成的一张，退还该笔重复款项'}
858a <- e706 3 fork next = ('approval',)
4ce8 <- 8792 4 loop next = ()
8792 <- e706 3 loop next = ('reject',)
e706 <- d190 2 loop next = ('approval',)
d190 <- eee0 1 loop next = ('draft',)
eee0 <- d7b5 0 loop next = ('load',)
d7b5 <- - -1 input next = ('__start__',)
```

三件事值得看。第一,方案的理由一个字没变,说明 draft 没有重跑,模型没被调用。第二,`status` 用的是 Day 320 原封不动的代码,只按 thread_id 查,它看到的「最新」已经是新的 `858a`,`next` 又是 `('approval',)`。第三,最上面多了一张 `858a`,source 是 `fork`,父亲是 `e706`;而 `8792` 的父亲也是 `e706`。树在这里分了叉。

现在 thread 又停在审批点了,原来的 `approve` 命令就能用:

```bash
uv run python refund_approval.py approve T1041 "复核后同意"
uv run python refund_tt.py history T1041
sqlite3 ../../cloudledger/cloudledger.db "select id, invoice_id, amount_cents, status from refund_requests"
```

```text
已批准:INV-2026-0123 退 2392.00 元。审批备注:复核后同意
8095 <- 22f6 5 loop next = ()
22f6 <- 858a 4 loop next = ('execute',)
858a <- e706 3 fork next = ('approval',)
4ce8 <- 8792 4 loop next = ()
8792 <- e706 3 loop next = ('reject',)
e706 <- d190 2 loop next = ('approval',)
d190 <- eee0 1 loop next = ('draft',)
eee0 <- d7b5 0 loop next = ('load',)
d7b5 <- - -1 input next = ('__start__',)
1|INV-2026-0123|239200|approved
```

9 张快照,两个结局:`4ce8` 是驳回,`8095` 是批准。这就是开头那张图。驳回那条记录没被删,谁在什么时候驳回过、备注写了什么,都还能查到,练习 4 会把它读出来。做审批系统时这一点很重要,审计要的就是「发生过什么」,而不只是「现在是什么」。

## 第 4 步:fork 改金额,以及时间旅行管不到的地方

接着上面的状态(T1041 已经批准、业务库里有一行 2392 元的退款),主管又说「其实只该退一半」。用 fork 回到审批前,把金额改成 1196:

```bash
uv run python refund_tt.py fork T1041 1196
uv run python refund_approval.py approve T1041 "只退一半"
sqlite3 ../../cloudledger/cloudledger.db "select id, invoice_id, amount_cents, status from refund_requests"
uv run python refund_tt.py history T1041 | head -4
```

```text
回到快照 858a 当时的方案金额: 2392.0
update_state 新建快照 2a6c
重新等待审批: {'question': '是否批准这笔退款?', 'invoice_id': 'INV-2026-0123', 'amount_yuan': 1196.0, 'reason': '与 INV-2026-0026 为 2026-10-08 同日同额重复扣款，INV-2026-0123 为较晚生成的一张，退还该笔重复款项'}
已批准:INV-2026-0123 退 1196.00 元。审批备注:只退一半
1|INV-2026-0123|239200|approved
2|INV-2026-0123|119600|approved
21b5 <- 5520 6 loop next = ()
5520 <- 2a6c 5 loop next = ('execute',)
2a6c <- 858a 4 update next = ('approval',)
8095 <- 22f6 5 loop next = ()
```

先看一个小细节:这次选中的是 `858a`,不是 `e706`。`refund_tt.py` 是从新到旧找第一张 `next == ('approval',)` 的快照,上一步 rewind 生成的 `858a` 比 `e706` 新,所以先被找到。两张的状态一样,这里选哪张结果都对;但如果你在分叉线上改过状态,「从新到旧第一张」就不一定是你想回去的那张了,真实系统里应该按 checkpoint_id 精确指定。

再看业务库,**出事了**:同一张发票 INV-2026-0123 退了两次,一次 2392 元、一次 1196 元,一共退出去 3588 元,比客户多扣的那 2392 元还多。主管的本意是「改成只退一半」,结果变成了「再多退一半」。

原因很简单:时间旅行倒回的只是 LangGraph 自己的状态(`checkpoints.db`),它不知道、也管不了 execute 节点往 `cloudledger.db` 里写过什么。第一次批准写进去的那一行,不会因为你回到了审批之前就消失。前端同学可以这么理解:你在 Redux DevTools 里把 store 倒回之前的某个 action,页面状态回去了,但那期间已经发出去的 `fetch('/api/refund', {method: 'POST'})` 收不回来。

所以带写库节点的图要做时间旅行,写库那一步必须自己判断「这件事是不是已经做过了」,这叫**幂等**:同一个操作做一次和做很多次,结果一样。练习 2 给 `execute_refund` 加上这个判断。更完整的做法是把「改金额」当成业务上的一次冲正(先撤销原退款再新建),那是业务规则的事,LangGraph 帮不了。

### 这一天的花费

今天真调模型的只有 `start`(draft 节点)和练习 1 的重放。rewind 和 fork 都是从审批前的快照往下跑,draft 不重跑,一分钱不花。我写这篇时 `start` 一共跑了 6 次,练习 1 重放 1 次,共 7 次。按 Day 320 第 2 步算出的单次约 0.00125 元:7 × 0.00125 ≈ 0.009 元,不到一分钱。

## 动手练习

**练习 1:从 draft 之前重放,模型会给出一样的方案吗?** 写 `redraft.py`:找到 T1041 那条线上 `next == ('draft',)` 的快照,从它重放,把重放前后的 `reason` 打出来比较。先 seed、删 `checkpoints.db`、跑一次 `start`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lgdemo/redraft.py
import sqlite3
import sys

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite import SqliteSaver

from refund_approval import CKPT_DB, builder

config: RunnableConfig = {"configurable": {"thread_id": f"refund-{sys.argv[1]}"}}
with sqlite3.connect(CKPT_DB, check_same_thread=False) as conn:
    graph = builder.compile(checkpointer=SqliteSaver(conn))
    old = graph.get_state(config).values["proposal"]["reason"]
    target = next(s for s in graph.get_state_history(config) if s.next == ("draft",))
    result = graph.invoke(None, target.config)
    new = result["__interrupt__"][0].value["reason"]
    print("旧理由:", old)
    print("新理由:", new)
    print("一样吗:", old == new)
```

<div class="line-notes">

- `old = graph.get_state(config).values["proposal"]["reason"]` 重放之前,先记下 start 时模型写的理由。
- `target = next(s for s in graph.get_state_history(config) if s.next == ("draft",))` 这次找的是 load 跑完、draft 还没跑的那一张。
- `result = graph.invoke(None, target.config)` 从这里重放,draft 会**真的再调一次模型**,然后 approval 又 interrupt 停下。
- `new = result["__interrupt__"][0].value["reason"]` 新方案在 interrupt 交出来的字典里。
- `print("一样吗:", old == new)` 实跑是 `False`。

</div>

```bash
cd agent-zero-lab && uv run python cloudledger/seed.py && cd part05/lgdemo
rm -f checkpoints.db
uv run python refund_approval.py start T1041
uv run python redraft.py T1041
uv run python refund_tt.py history T1041
```

```text
已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}
已暂停,等待审批: {'question': '是否批准这笔退款?', 'invoice_id': 'INV-2026-0123', 'amount_yuan': 2392.0, 'reason': '与 INV-2026-0026 同为 2026-10-08 扣款、金额相同，属重复扣款，退回较晚生成的 INV-2026-0123 一笔'}
旧理由: 与 INV-2026-0026 同为 2026-10-08 扣款、金额相同，属重复扣款，退回较晚生成的 INV-2026-0123 一笔
新理由: 与 INV-2026-0026 为同日同额重复扣款，INV-2026-0123 为较晚生成的一张，退还该笔重复款项
一样吗: False
41fa <- e270 3 loop next = ('approval',)
e270 <- 54a0 2 fork next = ('draft',)
5bac <- 54a0 2 loop next = ('approval',)
54a0 <- 0078 1 loop next = ('draft',)
0078 <- 9742 0 loop next = ('load',)
9742 <- - -1 input next = ('__start__',)
```

挑的发票和金额一样,理由的措辞变了。这证明重放会真的重新执行快照之后的节点,包括调模型,而 `temperature=0` 也不保证每次输出一字不差。这个特性有好有坏:调试时你可以回到 draft 之前,改一下提示词再重放,不用重新 load;但如果你以为重放是「把上次的结果再看一遍」,就会多花钱,还会拿到不一样的结果。历史里 `54a0` 下面长出了两个孩子 `5bac` 和 `e270`,又是一次分叉。

</details>

**练习 2:让 execute 不会重复退款。** 改 Day 320 的 `refund_approval.py`,在 `execute_refund` 写库前先查 `refund_requests` 里这张发票有没有 approved 的记录,有就跳过并在 outcome 里说明。然后重现第 4 步:seed、start、approve、fork 1196、再 approve,确认业务库只有一行。

<details><summary>参考答案</summary>

只改 `execute_refund` 的 `with` 块,其他都不动(原来的用法全部照旧,所以直接改原文件就行):

```python
def execute_refund(state: RefundState) -> dict:
    p = state["proposal"]
    now = datetime.now().isoformat(timespec="seconds")  # 本地时间;SQLite 的 datetime('now') 是 UTC
    with biz() as conn:
        done = conn.execute(
            "SELECT id, amount_cents FROM refund_requests WHERE invoice_id = ? AND status = 'approved'",
            (p["invoice_id"],),
        ).fetchone()
        if done is not None:
            return {"outcome": f"跳过:{p['invoice_id']} 已经退过 {done['amount_cents'] / 100:.2f} 元(记录 {done['id']}),没有重复写库"}
        conn.execute(
            "INSERT INTO refund_requests (invoice_id, amount_cents, reason, status, created_at, decided_at, decided_by) "
            "VALUES (?, ?, ?, 'approved', ?, ?, 'supervisor')",
            (p["invoice_id"], round(p["amount_yuan"] * 100), p["reason"], now, now),
        )
    return {"outcome": f"已批准:{p['invoice_id']} 退 {p['amount_yuan']:.2f} 元。审批备注:{state['decision']['note']}"}
```

<div class="line-notes">

- `done = conn.execute(` 写库前先查一次。按发票号查,因为业务上「一张发票只退一次」;不能按 thread_id 查,分叉线和主线是同一个 thread。
- `"SELECT id, amount_cents FROM refund_requests WHERE invoice_id = ? AND status = 'approved'",` 只算已批准的记录。实跑第二次 approve 时查到 `(1, 239200)`。
- `if done is not None:` 查到了就不再插入。`fetchone()` 查不到返回 `None`,Day 320 第 1 步见过。
- `return {"outcome": f"跳过:{p['invoice_id']} 已经退过 {done['amount_cents'] / 100:.2f} 元(记录 {done['id']}),没有重复写库"}` 提前返回,outcome 写清楚为什么跳过。`239200 / 100` 格式化成 `2392.00`。
- `conn.execute(` 没退过才插入,和原来一样。

</div>

```bash
cd agent-zero-lab && uv run python cloudledger/seed.py && cd part05/lgdemo
rm -f checkpoints.db
uv run python refund_approval.py start T1041
uv run python refund_approval.py approve T1041 "核实无误"
uv run python refund_tt.py fork T1041 1196
uv run python refund_approval.py approve T1041 "只退一半"
sqlite3 ../../cloudledger/cloudledger.db "select id, invoice_id, amount_cents, status from refund_requests"
```

```text
已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}
已暂停,等待审批: {'question': '是否批准这笔退款?', 'invoice_id': 'INV-2026-0123', 'amount_yuan': 2392.0, 'reason': '与 INV-2026-0026 同为 2026-10-08 扣款、金额相同，属重复扣款，且该张为较晚生成的发票，退还重复的一笔'}
已批准:INV-2026-0123 退 2392.00 元。审批备注:核实无误
回到快照 e89f 当时的方案金额: 2392.0
update_state 新建快照 373b
重新等待审批: {'question': '是否批准这笔退款?', 'invoice_id': 'INV-2026-0123', 'amount_yuan': 1196.0, 'reason': '与 INV-2026-0026 同为 2026-10-08 扣款、金额相同，属重复扣款，且该张为较晚生成的发票，退还重复的一笔'}
跳过:INV-2026-0123 已经退过 2392.00 元(记录 1),没有重复写库
1|INV-2026-0123|239200|approved
```

业务库只剩一行。注意这个修法挡住了重复,但「改成只退一半」这个需求并没有实现,它需要业务层先把 2392 那笔冲掉再写 1196,这不是图能替你决定的。还要说一句:「先查再插」在两个进程同时 approve 时仍可能都查到「没有」,真正的保险是在表上给 `invoice_id` 加唯一约束,让数据库替你拦,[Day 390](/blog/agent-zero/day-390-idempotency/) 讲「至少执行一次和幂等」时会专门做。

</details>

**练习 3:观察 `update_state` 的 `as_node`。** 在一条**全新**的 thread 上(没跑过任何节点)直接 `update_state` 写入 `{"amount": 500, "result": ""}`,再 `invoke(None, ...)`。分别试不带 `as_node` 和带 `as_node="draft"` 两种,看 `next` 和最终结果有什么不同。用第 1 步的玩具图。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg_steps/tt_as_node.py
from typing import TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import START, StateGraph


class State(TypedDict):
    amount: int
    result: str


def draft(state: State) -> dict:
    print("  [draft 执行]")
    return {"amount": 2392}


def execute(state: State) -> dict:
    print("  [execute 执行]")
    return {"result": f"已退 {state['amount']} 元"}


builder = StateGraph(State)
builder.add_node("draft", draft)
builder.add_node("execute", execute)
builder.add_edge(START, "draft")
builder.add_edge("draft", "execute")
graph = builder.compile(checkpointer=InMemorySaver())

a: RunnableConfig = {"configurable": {"thread_id": "A"}}
graph.update_state(a, {"amount": 500, "result": ""})
print("不写 as_node:next =", graph.get_state(a).next)
print(graph.invoke(None, a))

b: RunnableConfig = {"configurable": {"thread_id": "B"}}
graph.update_state(b, {"amount": 500, "result": ""}, as_node="draft")
print("as_node='draft':next =", graph.get_state(b).next)
print(graph.invoke(None, b))
```

<div class="line-notes">

- `graph.update_state(a, {"amount": 500, "result": ""})` thread A 从没跑过,没有历史可以推断「这次修改算谁写的」,LangGraph 就把它当成图的输入。
- `print("不写 as_node:next =", graph.get_state(a).next)` 实跑 `('draft',)`,下一步从第一个节点开始。
- `print(graph.invoke(None, a))` draft 照常执行,把金额覆盖成 2392,你写的 500 白写了。
- `graph.update_state(b, {"amount": 500, "result": ""}, as_node="draft")` `as_node="draft"` 告诉 LangGraph「就当这次修改是 draft 节点写的」。
- `print("as_node='draft':next =", graph.get_state(b).next)` 于是下一步是 draft 的后继 `('execute',)`。
- `print(graph.invoke(None, b))` draft 被跳过,execute 用的是 500。

</div>

```bash
cd agent-zero-lab/part05/lg_steps
uv run python tt_as_node.py
```

```text
不写 as_node:next = ('draft',)
  [draft 执行]
  [execute 执行]
{'amount': 2392, 'result': '已退 2392 元'}
as_node='draft':next = ('execute',)
  [execute 执行]
{'amount': 500, 'result': '已退 500 元'}
```

不写 `as_node` 时,你精心准备的 500 被 draft 覆盖了;写了 `as_node="draft"`,图以为 draft 已经跑过,直接从 execute 开始。这个用法在写测试时很顺手:想单独测 execute,就伪造一张「draft 刚跑完」的快照,不用真的调模型。在已有历史的快照上分叉(第 2、3 步那样),LangGraph 自己推断的 `as_node` 基本都对,不用写。

</details>

**练习 4(开放题):把两个结局都查出来。** 主管的领导想知道 T1041 的完整经过。写 `audit.py`,列出这条线上所有「已结束」的快照(`next` 为空)各自的决定和结局,再对比 `get_state` 拿到的是哪一个。数据用第 3 步的「start → reject → rewind → approve」。

<details><summary>参考答案</summary>

示范解法:在历史里筛出 `next` 为空的快照,每一张都是一个结局。

```python
# agent-zero-lab/part05/lgdemo/audit.py
import sqlite3
import sys

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite import SqliteSaver

from refund_approval import CKPT_DB, builder

config: RunnableConfig = {"configurable": {"thread_id": f"refund-{sys.argv[1]}"}}
with sqlite3.connect(CKPT_DB, check_same_thread=False) as conn:
    graph = builder.compile(checkpointer=SqliteSaver(conn))
    history = list(graph.get_state_history(config))
    ends = [s for s in history if not s.next]
    print("这条线上一共", len(history), "张快照,其中", len(ends), "个结局(从新到旧):")
    for s in ends:
        print(" ", (s.created_at or "")[:19], s.values["decision"], "→", s.values["outcome"])
    latest = graph.get_state(config)
    print("get_state 拿到的是:", latest.values.get("outcome"))
```

<div class="line-notes">

- `history = list(graph.get_state_history(config))` 这条线上的全部快照,包括所有分叉。
- `ends = [s for s in history if not s.next]` 空元组 `()` 在 if 里算假,`not s.next` 就是「已经跑完」,相当于 JS 的 `history.filter(s => s.next.length === 0)`。实跑筛出 2 张。
- `print(" ", (s.created_at or "")[:19], s.values["decision"], "→", s.values["outcome"])` `created_at` 是快照的生成时间,类型上可能是 `None`,`or ""` 兜底让类型检查器满意;`[:19]` 截到秒。
- `latest = graph.get_state(config)` 对比一下,不带 checkpoint_id 时拿到哪个结局。

</div>

```bash
cd agent-zero-lab && uv run python cloudledger/seed.py && cd part05/lgdemo
rm -f checkpoints.db
uv run python refund_approval.py start T1041
uv run python refund_approval.py reject T1041 "金额不对"
uv run python refund_tt.py rewind T1041
uv run python refund_approval.py approve T1041 "复核后同意"
uv run python audit.py T1041
```

最后一条命令的输出:

```text
这条线上一共 9 张快照,其中 2 个结局(从新到旧):
  2026-10-22T04:57:21 {'approved': True, 'note': '复核后同意'} → 已批准:INV-2026-0123 退 2392.00 元。审批备注:复核后同意
  2026-10-22T04:57:08 {'approved': False, 'note': '金额不对'} → 已驳回,转人工跟进。原因:金额不对
get_state 拿到的是: 已批准:INV-2026-0123 退 2392.00 元。审批备注:复核后同意
```

两个结局都在,`get_state` 只告诉你最新那个。顺便又见到了 Day 320 的老朋友:我是北京时间 12:57 跑的,`created_at` 却是 `04:57`,LangGraph 记的快照时间是 UTC。给领导看之前要换成本地时间。

这个解法够用来查一张工单,但真要做审计,不要依赖 checkpoint 库:LangGraph 的内部格式可能随版本变化,很多团队还会定期清理老的 checkpoint。正经做法是在 approval 之后、写库的节点里,往业务库的审批日志表里记一行,checkpoint 只负责「能接着跑」。

</details>

**验收标准**:能说出重放时快照前后的节点谁重跑、谁不重跑,并用第 1 步的输出证明;`refund_tt.py` 跑通「start → reject → rewind → approve」,history 里能指出分叉点;能解释第 4 步为什么会退两次款,并用练习 2 的修法挡住;能说清 `update_state` 不是回滚。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 时间旅行(time travel) | LangGraph 里从历史上某张快照重新往下执行的统称,分重放和分叉两种 |
| 重放(replay) | `graph.invoke(None, 旧快照.config)`,快照之后的节点真的重新执行,之前的不跑 |
| 分叉(fork) | 先 `update_state` 在旧快照上写入新值(生成新快照),再从新快照往下跑;原来的历史保留 |
| update_state | `graph.update_state(config, 新值, as_node=...)`,在指定快照上写一次状态,返回新快照的 config,不执行节点 |
| checkpoint_id | 每张快照的唯一 id,按时间递增;放进 config 里就表示「从这一张开始」 |
| parent_config | 快照对象上指向上一张快照的 config,靠它才看得出历史在哪里分了叉 |
| metadata.source | 快照是怎么来的:`input` 收到输入,`loop` 节点跑完,`update` 来自 update_state,`fork` 来自重放时的复制 |
| as_node | `update_state` 的参数,声明「这次修改算是哪个节点写的」,决定下一步从哪个节点开始 |
| 幂等 | 同一个操作做一次和做多次结果一样。比如「这张发票没退过才退」 |

## 常见误区

**以为时间旅行能撤销已经发生的事。** 它只倒回 `checkpoints.db` 里的状态。第 4 步实测,批准后 fork 改金额再批,业务库里同一张发票退了两次,共 3588 元。写库、发通知、调第三方接口这些副作用,回到过去也收不回来,写库的节点要自己做幂等检查。

**以为重放是「把上次的结果再拿一遍」。** 快照之后的节点会真的重新执行。练习 1 从 draft 之前重放,模型又被调用一次,理由的措辞也变了。想只看旧结果,用 `get_state(旧快照.config)` 读,不要 invoke。

**以为 `update_state` 会把那条线回滚。** 官方文档原话 `update_state` does not roll back a thread。它在旧快照后面长出一张新快照,原来的结局还在历史里,`get_state` 只是默认拿最新那张。

**在全新的 thread 上 `update_state` 不写 `as_node`。** 练习 3 实测,写进去的 `amount: 500` 被当成了输入,第一个节点照常执行,把它覆盖成 2392。没有历史可以推断时,要明确写 `as_node`。

**按「从新到旧第一张」找回退点。** `next(s for s in history if s.next == ("approval",))` 在分叉过一次之后,找到的就是分叉线上的那张(第 4 步选中了 `858a` 而不是 `e706`)。这次两张状态一样所以没出错,真实系统里要按 checkpoint_id 精确指定回到哪一张。

**把 `next()` 和 `.next` 搞混。** `next(生成器)` 是 Python 内置函数,取第一个元素;`snapshot.next` 是快照属性,下一步要跑的节点。同一行里同时出现,第一次读很容易看岔。

## 学习资料

### 文档与文章

- [LangGraph · Use time-travel](https://docs.langchain.com/oss/python/langgraph/use-time-travel):今天的主文档,Replay、Fork、From a specific node(就是 `as_node`)、Interrupts 四节对应今天的四段内容,30 分钟。最后的 Subgraphs 一节先跳过,[Day 324](/blog/agent-zero/day-324-lg-subgraph/) 讲子图时再回来读。
- [LangGraph · Persistence](https://docs.langchain.com/oss/python/langgraph/persistence):Day 321 复习时读过,今天重读 Replay 和 Update state 两小节,10 分钟。
- [LangGraph · Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts):回顾「Side effects called before interrupt must be idempotent」那一段,和今天的幂等是同一个道理换个位置,10 分钟。
- [Pro Git · 分支简介](https://git-scm.com/book/zh/v2/Git-%E5%88%86%E6%94%AF-%E5%88%86%E6%94%AF%E7%AE%80%E4%BB%8B):中文版。如果 Day 57 的分支概念有点忘了,看里面那几张「提交对象指向父对象」的图,和今天的 `parent_config` 一个思路,15 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1z3NY66EY1&p=74&autoplay=0&high_quality=1" title="尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>尚硅谷 · LangGraph 教程 · 第 74 集「持久化_检查点重新运行」(10 分钟),对应今天第 1 步的重放。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1z3NY66EY1&p=77&autoplay=0&high_quality=1" title="尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>尚硅谷 · LangGraph 教程 · 第 77 集「持久化_fork实现演示」(17 分钟),对应第 2 步的分叉。第 75、76 集是同一个例子的代码讲解,时间充裕可以从 75 集看起。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV17UKd6zEgH&autoplay=0&high_quality=1" title="Agent实践——2.9.2 langgraph框架checkpoint,人机协作,时间旅行等问题探究" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>不如语冰 · Agent实践——2.9.2 langgraph框架checkpoint,人机协作,时间旅行等问题探究 · 23 分钟,把 checkpoint、interrupt、时间旅行放在一起讲,适合当本周后半段的串讲。播放量不高,当作换个角度听一遍。</figcaption>
</figure>

### 其他经典视频

- LangChain Academy [Introduction to LangGraph](https://academy.langchain.com/courses/intro-to-langgraph):Module 3 里的 Time Travel 一课,演示 replay 和 fork,英文,和今天第 1、2 步一一对应。

### 书籍

- Mayo Oshin、Nuno Campos《Learning LangChain》(O'Reilly,2025):讲 LangGraph 的章节涉及持久化和人工介入。我没查到书里有没有专门讲时间旅行,读的时候注意它对应的 LangGraph 版本,API 名字以今天的文档为准。英文原版。

### 开源项目与代码

- [langchain-ai/langchain-academy](https://github.com/langchain-ai/langchain-academy) 的 [module-3](https://github.com/langchain-ai/langchain-academy/tree/main/module-3) 目录:`time-travel.ipynb` 是上面那节视频的 notebook,可以把它的例子改写成今天的 `tt_fork.py` 风格当默写题。

## 自测

1. 一张图 A → B → C,跑完以后用「B 跑完、C 还没跑」那张快照的 config 调 `invoke(None, ...)`。A、B、C 各执行几次(包括第一次完整执行)?

<details><summary>答案</summary>

A 1 次,B 1 次,C 2 次。快照之前的节点结果已经存在快照里,不重跑;快照之后的 C 真的再执行一次。第 1 步的输出里重放那段只有 `[execute 执行]`,就是这个现象。

</details>

2. `graph.update_state(old.config, {"amount": 1196})` 之后,`old` 那张快照里的 amount 是多少?`graph.get_state(config)` 拿到的又是多少?

<details><summary>答案</summary>

`old` 里还是原来的 2392,`update_state` 不改旧快照,只在它后面新建一张。`get_state(config)` 只按 thread_id 查,拿最新写入的那张,也就是新建的 1196。

</details>

3. 退款图 rewind 回到审批前,会再调一次模型吗?为什么?

<details><summary>答案</summary>

不会。回到的那张快照 `next` 是 `('approval',)`,draft 已经跑完、结果在快照里,往下跑的第一个节点是 approval,它调 `interrupt()` 就停了。实跑 rewind 前后方案理由一字不差。只有从 `next == ('draft',)` 或更早的快照重放才会再调模型(练习 1)。

</details>

4. 第 4 步为什么会退两次款?除了练习 2 的「先查再插」,还有什么更稳的办法?

<details><summary>答案</summary>

时间旅行只倒回 LangGraph 的 checkpoint,第一次批准时 execute 写进业务库的那一行不会消失;分叉线再批准,execute 又执行一次,又插一行。「先查再插」在并发时两个请求可能都查到「没有」,更稳的是在 `refund_requests.invoice_id` 上加唯一约束,让数据库拒绝第二行;业务上「改金额」应该做成冲正,而不是再退一笔。

</details>

5. **面试题**:「你们的 Agent 在第 7 步出错了,怎么排查和修复,又不想从头再调一遍模型?」

<details><summary>答案</summary>

参考要点:图编译时带持久化的 checkpointer,每一步都有快照;用 `get_state_history` 找到第 6 步跑完的那张(看 `next` 和 `values`),先读它的状态定位问题;如果是状态里某个字段错了,用 `update_state` 在那张快照上改掉,再 `invoke(None, 新config)` 从第 7 步往下跑,前面 6 步不重跑,不花钱;如果是第 7 步的提示词或代码有问题,改完代码直接从那张快照重放。要说出的坑:重放会真的重新执行后续节点,调模型要花钱且结果可能不同;快照之后如果有写库、发消息等副作用,回到过去收不回来,这些节点要幂等;`update_state` 是分叉不是回滚,原历史还在,可以拿来对比两次的结果。能补一句「评测时也可以从同一张中间快照出发,比较不同提示词的效果」会更好。

</details>

## 明天预告

明天是 [Day 323 · LangGraph(二十一):三种 stream_mode](/blog/agent-zero/day-323-lg-stream-modes/)。到今天为止我们都是 `invoke` 跑完一整段再看结果,看历史也是事后去翻快照。真做审批后台,前端希望图每跑完一个节点就推一条进度过来,模型起草方案时还能一个字一个字地显示。明天看 `stream` 的 updates、values、messages 三种模式各吐出什么,它们吐出来的东西其实就是今天这些快照之间的差异。
