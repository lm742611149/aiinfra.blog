---
title: 'Day 321 · 第 46 周复习:MCP 与编排(Day 315–320)'
description: '这一周把 LangGraph 的持久化和人工审批从零件拼成了退款审批。今天用一张知识地图把 checkpoint、checkpointer、thread_id、快照、SqliteSaver、interrupt 串起来,默写两段核心代码,再只用本周的东西从零写一个不调模型的发票抬头修改审批,顺手踩一个重复启动的坑。'
pubDate: 2026-10-22
regime: none
tags: ['langgraph', 'review', 'agent-zero']
series: 'agent-zero'
day: 321
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 320](/blog/agent-zero/day-320-lg-refund-approval/) 拼出了退款审批图:load 读工单和发票,draft 让模型起草方案,approval 用 `interrupt()` 停下来等主管,批了走 execute 写业务库,驳回走 reject。start、status、approve 三个命令是三个独立进程,靠 `refund-T1041` 这个 thread_id 和 `checkpoints.db` 接上同一次执行。那一课还撞见了一个挺吓人的现象:一张和扣款无关的工单,模型照样起草了 495 元的退款,第二次还编出一个不存在的重复扣款,审批这道闸拦住了它。

这一周新名词特别多,而且长得像:checkpoint 和 checkpointer、thread 和 thread_id、snapshot 和 history。今天停一天,把它们放回各自的位置,再自己从零写一张审批图。

## 今天要解决的问题

学完今天,你应该能做到:

1. 合上文章,说出 checkpoint、checkpointer、thread_id、StateSnapshot、`next` 各是什么,谁包含谁。
2. 默写一个带 SqliteSaver 的计数器图,用两个不同的 thread_id 跑出「接着数」和「从头数」。
3. 默写一个带 `response_schema` 的 interrupt 节点,并用 `Command(resume=...)` 恢复。
4. 只用本周的知识写出 `title_approval.py`:批量启动多张工单、列出待审批、逐张批准或驳回,而且重复启动不会把已经审完的工单重新拉回审批。

预计用时 3 小时:地图和回顾 30 分钟,两段默写各 30 分钟,小项目 1 小时,剩下做练习和自测。前置:[Day 315](/blog/agent-zero/day-315-lg-checkpoint-why/) 到 [Day 320](/blog/agent-zero/day-320-lg-refund-approval/) 全部,外加 [Day 280](/blog/agent-zero/day-280-mcp-seed/) 的 `cloudledger.db`。今天所有脚本都不调模型,一分钱不花。

学法和平时一样:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章把两段默写代码再写一遍;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 320" role="img" aria-label="第 46 周知识地图:checkpointer 是存储后端,里面按 thread_id 分组,每组是一串 checkpoint 快照;interrupt 让图停在某个快照,Command resume 从那里接着跑">
  <rect x="0" y="0" width="640" height="320" fill="var(--paper-raised)"/>
  <rect x="16" y="16" width="608" height="196" rx="6" fill="none" stroke="var(--ink-soft)"/>
  <text x="28" y="36" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">checkpointer:InMemorySaver(Day 316)/ SqliteSaver(Day 318)</text>
  <rect x="32" y="50" width="576" height="66" rx="4" fill="none" stroke="var(--rule)"/>
  <text x="42" y="68" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">thread_id = refund-T1041(Day 316)</text>
  <g font-family="var(--font-mono)" font-size="11" text-anchor="middle">
    <rect x="42" y="78" width="80" height="28" rx="3" fill="none" stroke="var(--ink-faint)"/><text x="82" y="96" fill="var(--ink-soft)">-1 start</text>
    <rect x="132" y="78" width="80" height="28" rx="3" fill="none" stroke="var(--ink-faint)"/><text x="172" y="96" fill="var(--ink-soft)">0 load</text>
    <rect x="222" y="78" width="80" height="28" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="262" y="96" fill="var(--ink)">1 draft</text>
    <rect x="312" y="78" width="110" height="28" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="367" y="96" fill="var(--ink)">2 approval ⏸</text>
    <rect x="432" y="78" width="80" height="28" rx="3" fill="none" stroke="var(--ink-faint)"/><text x="472" y="96" fill="var(--ink-soft)">3 execute</text>
    <rect x="522" y="78" width="76" height="28" rx="3" fill="none" stroke="var(--ink-faint)"/><text x="560" y="96" fill="var(--ink-soft)">4 end</text>
  </g>
  <rect x="32" y="128" width="576" height="40" rx="4" fill="none" stroke="var(--rule)"/>
  <text x="42" y="152" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">thread_id = refund-T1001:另一条线,互不影响</text>
  <text x="28" y="196" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">每个方块 = 一个 checkpoint;get_state 拿最新一个,get_state_history 从新到旧拿全部(Day 317)</text>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="16" y="232" width="190" height="72" rx="5" fill="none" stroke="var(--ink-soft)"/>
    <text x="26" y="252" fill="var(--ink)">Day 315 为什么要存</text>
    <text x="26" y="270" fill="var(--ink-soft)">进程一退,状态全没</text>
    <text x="26" y="288" fill="var(--ink-soft)">停下来等人就无从谈起</text>
    <rect x="224" y="232" width="190" height="72" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="234" y="252" fill="var(--ink)">Day 319 interrupt</text>
    <text x="234" y="270" fill="var(--ink-soft)">停在节点里,交出问题</text>
    <text x="234" y="288" fill="var(--ink-soft)">resume 时节点从头重跑</text>
    <rect x="432" y="232" width="192" height="72" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="442" y="252" fill="var(--ink)">Day 320 退款审批</text>
    <text x="442" y="270" fill="var(--ink-soft)">五个节点 + 两个库</text>
    <text x="442" y="288" fill="var(--ink-soft)">response_schema 校验答复</text>
  </g>
  <line x1="367" y1="106" x2="319" y2="232" stroke="var(--compute)" stroke-dasharray="3 3"/>
</svg>
<figcaption>外层大框是 checkpointer(存在哪),里面按 thread_id 分成一条条线,每条线是一串 checkpoint。方块里的数字是快照的 step。interrupt 让一条线停在某个快照上,`next` 就是 `('approval',)`。</figcaption>
</figure>

用一句话把它们的关系说清楚:**checkpointer 是仓库,thread_id 是仓库里的一个抽屉,checkpoint 是抽屉里按时间叠起来的一张张快照,`get_state` 取最上面那张,快照上的 `next` 写着下一步该跑谁。** 这句话能脱口而出,这周就算过关了一半。

## 本周每天一句话

- [Day 315 · 没有 checkpoint 会怎样](/blog/agent-zero/day-315-lg-checkpoint-why/):图的状态只活在一次 `invoke` 里,进程一退全没了,「停下来等人明天再批」根本做不到。
- [Day 316 · checkpointer 和 thread_id](/blog/agent-zero/day-316-lg-checkpointer/):编译时传 checkpointer,调用时传 thread_id;同一个 id 状态接着累积,换一个 id 就是一张白纸。
- [Day 317 · get_state 和历史快照](/blog/agent-zero/day-317-lg-state-history/):每跑完一步存一张快照,`get_state` 看最新一张,`get_state_history` 从新到旧列全部,`next` 告诉你停在哪。
- [Day 318 · SqliteSaver](/blog/agent-zero/day-318-lg-sqlite-saver/):把 InMemorySaver 换成 SqliteSaver,一个参数的事,状态进了磁盘,两个进程能接上;连接要加 `check_same_thread=False`。
- [Day 319 · interrupt 和 Command(resume)](/blog/agent-zero/day-319-lg-interrupt/):节点里调 `interrupt()` 暂停并交出一个值,`Command(resume=...)` 带着人的答复恢复;恢复时这个节点从第一行重跑。
- [Day 320 · 实现退款审批](/blog/agent-zero/day-320-lg-refund-approval/):五个节点、两个 SQLite 库、四个命令;`response_schema` 校验主管答复,State 里只放字典,时间在 Python 里生成。

## 默写一:带 SqliteSaver 的计数器

这段把 Day 316 和 Day 318 合在一起。目标是合上文章能写出来,并且跑出下面一模一样的输出。写之前先自己想三件事:checkpointer 在哪一步传、thread_id 在哪一步传、为什么 `State` 要 `total=False`。

```python
# agent-zero-lab/part05/review46/recall_counter.py
import sqlite3
import sys
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

with sqlite3.connect("recall.db", check_same_thread=False) as conn:
    graph = builder.compile(checkpointer=SqliteSaver(conn))
    config: RunnableConfig = {"configurable": {"thread_id": sys.argv[1]}}
    print(sys.argv[1], "count =", graph.invoke({}, config)["count"])
    print("快照数:", len(list(graph.get_state_history(config))))
```

<div class="line-notes">

- `class State(TypedDict, total=False):` `total=False` 让 `count` 可以不填,所以 `invoke({}, config)` 传空字典也不会被类型检查器标红。节点里用 `.get` 读,不用 `["count"]`,两边都不报错。
- `return {"count": state.get("count", 0) + 1}` 第一次进来没有 count,拿默认值 0,返回 1。同一个 thread 第二次进来,LangGraph 已经从库里读回了 `{'count': 1}`,返回 2。
- `with sqlite3.connect("recall.db", check_same_thread=False) as conn:` 库文件建在你运行命令的目录里。`check_same_thread=False` 是 Day 318 的那个坑:LangGraph 可能在别的线程写 checkpoint。
- `graph = builder.compile(checkpointer=SqliteSaver(conn))` checkpointer 在**编译**时传。
- `config: RunnableConfig = {"configurable": {"thread_id": sys.argv[1]}}` thread_id 在**调用**时传,这里从命令行拿,`A` 或 `B`。
- `print(sys.argv[1], "count =", graph.invoke({}, config)["count"])` 实跑 A 第一次是 1,A 第二次是 2,B 第一次是 1。
- `print("快照数:", len(list(graph.get_state_history(config))))` 每次 invoke 产生 3 张快照:step -1 收到输入、step 0 准备跑 bump、step 1 跑完。所以 A 跑两次是 6 张。`get_state_history` 返回的是生成器,要 `list()` 一下才能 `len`。

</div>

```bash
cd agent-zero-lab/part05/review46
rm -f recall.db
uv run python recall_counter.py A
uv run python recall_counter.py A
uv run python recall_counter.py B
```

```text
A count = 1
快照数: 3
A count = 2
快照数: 6
B count = 1
快照数: 3
```

三次运行是三个进程。A 第二次能数到 2,是因为 `recall.db` 里存着 A 上一次的结果;B 是新抽屉,从 0 开始。默写时最常错的两处:把 checkpointer 传给了 `invoke`(它属于 `compile`),以及 config 少套一层 `configurable`。少套那一层的话,LangGraph 会报 `ValueError`,提示 checkpointer 需要 `thread_id`。

## 默写二:带 response_schema 的审批节点

这段把 Day 319 和 Day 320 的第 3 步合在一起,不调模型。写之前先想:节点里的 print 会打几次?

```python
# agent-zero-lab/part05/review46/recall_interrupt.py
from typing import NotRequired, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import START, StateGraph
from langgraph.types import Command, interrupt
from pydantic import BaseModel


class Decision(BaseModel):
    approved: bool
    note: str = ""


class State(TypedDict):
    amount: int
    decision: NotRequired[dict]


def approval(state: State) -> dict:
    print("  [approval 执行]")
    d = interrupt(f"批准退款 {state['amount']} 元吗?", response_schema=Decision)
    return {"decision": d.model_dump()}


builder = StateGraph(State)
builder.add_node("approval", approval)
builder.add_edge(START, "approval")
graph = builder.compile(checkpointer=InMemorySaver())
config: RunnableConfig = {"configurable": {"thread_id": "R1"}}

r = graph.invoke({"amount": 2392}, config)
print("问:", r["__interrupt__"][0].value, "| next =", graph.get_state(config).next)
print("答:", graph.invoke(Command(resume={"approved": False, "note": "金额不对"}), config))
```

<div class="line-notes">

- `class Decision(BaseModel):` 人答复的格式。`approved` 必填。
- `decision: NotRequired[dict]` 开始时没有,等人给。和默写一的 `total=False` 是两种写法:这里只有 `decision` 可以没有,`amount` 仍然必填。
- `print("  [approval 执行]")` 放在 interrupt 前面,数执行次数。实跑两次。
- `d = interrupt(f"批准退款 {state['amount']} 元吗?", response_schema=Decision)` 交出去的值可以是任何能序列化的东西,这里是一句话 `批准退款 2392 元吗?`。恢复时 resume 的字典按 `Decision` 校验,返回 `Decision` 实例。
- `graph = builder.compile(checkpointer=InMemorySaver())` interrupt 必须有 checkpointer,不然恢复时没有地方读状态。同一个进程里暂停再恢复,用内存版就够了。
- `print("问:", r["__interrupt__"][0].value, "| next =", graph.get_state(config).next)` 暂停时 `invoke` 正常返回,`__interrupt__` 里装着问题;`next` 是 `('approval',)`。
- `print("答:", graph.invoke(Command(resume={"approved": False, "note": "金额不对"}), config))` 恢复。输入位置放的是 `Command`,不是状态字典。

</div>

```text
  [approval 执行]
问: 批准退款 2392 元吗? | next = ('approval',)
  [approval 执行]
答: {'amount': 2392, 'decision': {'approved': False, 'note': '金额不对'}}
```

「执行」打了两次,这是本周最重要的一个现象,面试也最爱问。默写时如果你把 print 放到 interrupt 后面,它就只打一次,可以自己试试。

## 小项目:发票抬头修改审批

只用本周学的东西做一个新场景。`cloudledger.db` 里有 5 张主题是「发票抬头修改」的工单,正文都长这样:`上个月的发票抬头写错了,应该是「启明科技有限公司」,能重开吗?` 财务要逐张确认后才能重开发票。需求:

- `start-all`:找出所有这类工单,每张各开一条线跑到审批点。新抬头直接用正则从「」里抠出来,不调模型。
- `pending`:列出所有在等审批的工单。
- `approve` / `reject`:按工单号批准或驳回,带一句备注。
- 状态落盘,四个命令可以分开在不同进程里跑。

先看一眼数据:

```bash
cd agent-zero-lab
uv run python cloudledger/seed.py
sqlite3 cloudledger/cloudledger.db "select t.id, t.customer_id, c.company from tickets t join customers c on c.id=t.customer_id where subject='发票抬头修改'"
```

```text
已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}
T1008|C005|启明科技
T1019|C024|北辰贸易二店
T1029|C011|知行咨询
T1037|C001|星河餐饮
T1039|C005|启明科技
```

注意 T1008 和 T1039 是同一个客户 C005 提的,一会儿练习里会用到。

动手前对照表想一下每块该用本周哪一天的东西:

| 需求 | 用到的知识 |
| --- | --- |
| 每张工单一条线 | Day 316 thread_id,命名 `title-T1008` |
| 四个命令分开跑 | Day 318 SqliteSaver |
| 停下来等财务 | Day 319 interrupt + Command(resume) |
| 答复格式校验 | Day 320 response_schema |
| 列出待审批 | Day 317 get_state 的 `next`,Day 320 练习 3 的 `saver.list(None)` |
| 批准/驳回分两路 | Day 306 条件边(上上周) |

```python
# agent-zero-lab/part05/review46/title_approval.py
"""发票抬头修改审批:不调模型,只用第 46 周学的东西。

用法(在 agent-zero-lab/part05/review46 目录下):
  uv run python title_approval.py start-all          # 把所有「发票抬头修改」工单跑到审批点
  uv run python title_approval.py pending            # 列出待审批
  uv run python title_approval.py approve T1008 "已核对营业执照"
  uv run python title_approval.py reject T1039 "和 T1008 重复"
"""
import re
import sqlite3
import sys
from pathlib import Path
from typing import NotRequired, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from pydantic import BaseModel

BIZ_DB = Path(__file__).parents[2] / "cloudledger" / "cloudledger.db"
CKPT_DB = Path(__file__).with_name("title_ckpt.db")


class Decision(BaseModel):
    approved: bool
    note: str = ""


class TitleState(TypedDict):
    ticket_id: str
    customer_id: NotRequired[str]
    new_title: NotRequired[str]
    decision: NotRequired[dict]
    outcome: NotRequired[str]


def load(state: TitleState) -> dict:
    with sqlite3.connect(BIZ_DB) as conn:
        cid, body = conn.execute(
            "SELECT customer_id, body FROM tickets WHERE id = ?", (state["ticket_id"],)
        ).fetchone()
    m = re.search(r"「(.+?)」", body)
    return {"customer_id": cid, "new_title": m.group(1) if m else ""}


def approval(state: TitleState) -> dict:
    d = interrupt(
        {"question": "同意按新抬头重开发票吗?", "customer_id": state.get("customer_id"), "new_title": state.get("new_title")},
        response_schema=Decision,
    )
    return {"decision": d.model_dump()}


def route(state: TitleState) -> str:
    return "reissue" if state.get("decision", {}).get("approved") else "refuse"


def reissue(state: TitleState) -> dict:
    return {"outcome": f"已重开:{state.get('customer_id')} 新抬头「{state.get('new_title')}」"}


def refuse(state: TitleState) -> dict:
    return {"outcome": f"不重开:{state.get('decision', {}).get('note')}"}


builder = StateGraph(TitleState)
builder.add_node("load", load)
builder.add_node("approval", approval)
builder.add_node("reissue", reissue)
builder.add_node("refuse", refuse)
builder.add_edge(START, "load")
builder.add_edge("load", "approval")
builder.add_conditional_edges("approval", route, ["reissue", "refuse"])
builder.add_edge("reissue", END)
builder.add_edge("refuse", END)


def cfg(ticket_id: str) -> RunnableConfig:
    return {"configurable": {"thread_id": f"title-{ticket_id}"}}


def main() -> None:
    action = sys.argv[1]
    with sqlite3.connect(CKPT_DB, check_same_thread=False) as conn:
        saver = SqliteSaver(conn)
        graph = builder.compile(checkpointer=saver)
        if action == "start-all":
            with sqlite3.connect(BIZ_DB) as biz:
                ids = [r[0] for r in biz.execute("SELECT id FROM tickets WHERE subject = '发票抬头修改' ORDER BY id")]
            for tid in ids:
                graph.invoke({"ticket_id": tid}, cfg(tid))
            print("已启动:", ids)
        elif action == "pending":
            threads = sorted({c.config.get("configurable", {})["thread_id"] for c in saver.list(None)})
            for th in threads:
                snap = graph.get_state({"configurable": {"thread_id": th}})
                if snap.next == ("approval",):
                    print("待审批", th, snap.values.get("customer_id"), snap.values.get("new_title"))
        elif action in ("approve", "reject"):
            tid, note = sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else ""
            r = graph.invoke(Command(resume={"approved": action == "approve", "note": note}), cfg(tid))
            print(r["outcome"])


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `BIZ_DB = Path(__file__).parents[2] / "cloudledger" / "cloudledger.db"` 和 Day 320 一样的算法:`review46` → `part05` → `agent-zero-lab`。
- `CKPT_DB = Path(__file__).with_name("title_ckpt.db")` 单独一个 checkpoint 库,不和退款审批的 `checkpoints.db` 混。
- `class TitleState(TypedDict):` 只有 `ticket_id` 必填,其他都 `NotRequired`。这样 `invoke({"ticket_id": tid})` 不会被标红;代价是节点里读这些字段要用 `.get`。Day 320 走的是另一条路(字段全必填,再加 `input_schema`),两种都对,这里选更短的那种。
- `cid, body = conn.execute(` `fetchone()` 返回一个两列的元组,直接解构成两个变量,相当于 JS 的 `const [cid, body] = row`。这里没判空,因为工单号都是从库里查出来的,不会不存在。
- `m = re.search(r"「(.+?)」", body)` 正则抠出书名号里的内容。`(.+?)` 是非贪婪匹配,遇到第一个「」」就停。实跑 T1008 得到 `启明科技有限公司`。`r"..."` 是原始字符串,反斜杠不转义,写正则习惯加上。
- `return {"customer_id": cid, "new_title": m.group(1) if m else ""}` `group(1)` 是第一个括号捕获到的内容。没匹配到给空字符串,财务在审批时能看到。
- `d = interrupt(` 交出去一个字典:问题、客户、新抬头。interrupt 前面什么都没有,没有副作用重跑的问题。
- `response_schema=Decision,` 答复格式校验,和退款审批一样。
- `return "reissue" if state.get("decision", {}).get("approved") else "refuse"` 两层 `.get`:没有 decision 时拿空字典,再拿 approved 是 `None`,算作没批。
- `def cfg(ticket_id: str) -> RunnableConfig:` 把 thread_id 的拼法收进一个函数,四个命令都用它,不会出现这里写 `title-T1008`、那里写 `T1008` 的情况。
- `saver = SqliteSaver(conn)` 先存进变量,`pending` 要直接用 `saver.list`。
- `ids = [r[0] for r in biz.execute("SELECT id FROM tickets WHERE subject = '发票抬头修改' ORDER BY id")]` `execute` 返回的游标可以直接遍历,`r[0]` 是第一列。实跑得到 5 个工单号。
- `graph.invoke({"ticket_id": tid}, cfg(tid))` 每张工单一条线,跑到 interrupt 停下。返回值没接,暂停不会报错。
- `threads = sorted({c.config.get("configurable", {})["thread_id"] for c in saver.list(None)})` Day 320 练习 3 的写法:遍历库里所有 checkpoint,集合去重拿到全部 thread_id。
- `if snap.next == ("approval",):` 停在审批点的才算待审批。
- `tid, note = sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else ""` 一行解构两个值。注意条件表达式只作用在第二个值上。
- `r = graph.invoke(Command(resume={"approved": action == "approve", "note": note}), cfg(tid))` 按工单号找到对应的线恢复。

</div>

跑一遍:

```bash
cd agent-zero-lab/part05/review46
rm -f title_ckpt.db
uv run python title_approval.py start-all
uv run python title_approval.py pending
uv run python title_approval.py approve T1008 "已核对营业执照"
uv run python title_approval.py reject T1039 "和 T1008 重复"
uv run python title_approval.py pending
```

```text
已启动: ['T1008', 'T1019', 'T1029', 'T1037', 'T1039']
待审批 title-T1008 C005 启明科技有限公司
待审批 title-T1019 C024 北辰贸易二店有限公司
待审批 title-T1029 C011 知行咨询有限公司
待审批 title-T1037 C001 星河餐饮有限公司
待审批 title-T1039 C005 启明科技有限公司
已重开:C005 新抬头「启明科技有限公司」
不重开:和 T1008 重复
待审批 title-T1019 C024 北辰贸易二店有限公司
待审批 title-T1029 C011 知行咨询有限公司
待审批 title-T1037 C001 星河餐饮有限公司
```

五条线各自独立,批了两张,剩三张还在等。`title_ckpt.db` 此时 48 KB。

### 一个坑:再跑一次 start-all

想象一下,财务第二天上班,有人又点了一次「启动」(或者定时任务每天早上跑一次 start-all)。接着上面的状态,再跑一次:

```bash
uv run python title_approval.py start-all
uv run python title_approval.py pending
```

```text
已启动: ['T1008', 'T1019', 'T1029', 'T1037', 'T1039']
待审批 title-T1008 C005 启明科技有限公司
待审批 title-T1019 C024 北辰贸易二店有限公司
待审批 title-T1029 C011 知行咨询有限公司
待审批 title-T1037 C001 星河餐饮有限公司
待审批 title-T1039 C005 启明科技有限公司
```

已经批完的 T1008、驳回的 T1039 又回到了待审批列表。我又写了几行代码看 T1008 和 T1019 的状态:

```text
T1008 ('approval',) 已重开:C005 新抬头「启明科技有限公司」 8
T1019 ('approval',) None 6
```

三列分别是 `next`、`outcome`、快照数。T1008 的 `next` 又是 `('approval',)`,`outcome` 却还是上一轮的「已重开」,快照从 5 张变成 8 张;T1019 从 3 张变成 6 张。

原因是 Day 316 那条规则:**对同一个 thread_id 传一个新的输入字典,就是在这条线上再跑一次**,LangGraph 从 START 开始,把新输入合进上一次的最终状态。它不会帮你判断「这张工单已经处理过了」。T1019 那种本来就在等审批的线也一样,原来那个中断被丢下,图从头跑了一遍,又停在审批点。这次只是多了几张快照,如果 load 后面接的是一个调模型或者发通知的节点,每重复启动一次就多花一次钱、多发一条通知。修法在练习 1。

## 本周错题与坑清单

| 坑 | 现象 | 修法 | 出处 |
| --- | --- | --- | --- |
| 没有 checkpointer 就用 interrupt | 恢复时报错,没有地方读状态 | 至少用 InMemorySaver | Day 319 |
| config 少套一层 `configurable` | ValueError,说 checkpointer 需要 thread_id | `{"configurable": {"thread_id": ...}}` | Day 316 |
| interrupt 前面放副作用 | 恢复时重跑,通知发两次;校验失败的恢复也算一次 | 挪到前一个节点或 interrupt 之后,或做成幂等 | Day 319、320 |
| 跨进程用 InMemorySaver | 新进程里 `next` 为空,approve 时从 START 重跑,KeyError | 用 SqliteSaver | Day 318、320 |
| SQLite 连接没加 `check_same_thread=False` | 偶发 ProgrammingError | 加上 | Day 318 |
| pydantic 对象放进 State | 读回时 `Deserializing unregistered type` 警告 | `model_dump()` 成字典 | Day 320 |
| SQL 里写 `datetime('now')` | 记成 UTC,差 8 小时 | Python 里生成本地时间 | Day 320 |
| 对已结束的 thread 再 resume | 什么都不执行,返回旧结果 | 时间旅行(Day 322) | Day 320 |
| 对已存在的 thread 再传新输入 | 已审完的工单重新进审批 | 启动前先 `get_state` 看有没有快照 | 今天 |
| schema 逼模型必须给金额 | 不该退的工单也起草了退款,甚至编理由 | schema 留「不需要」的出路,审批不能省 | Day 320 |

## 动手练习

**练习 1:让 start-all 可以安全地重复跑。** 改 `title_approval.py`,存成 `title_approval_v2.py`:已经有快照的工单跳过,只启动新的;打印「已启动」和「跳过」两个列表。验证:start-all、approve T1008、再 start-all,第二次应该全部跳过,pending 只剩 4 条。

<details><summary>参考答案</summary>

只改 `start-all` 那个分支:

```python
        if action == "start-all":
            with sqlite3.connect(BIZ_DB) as biz:
                ids = [r[0] for r in biz.execute("SELECT id FROM tickets WHERE subject = '发票抬头修改' ORDER BY id")]
            started, skipped = [], []
            for tid in ids:
                if graph.get_state(cfg(tid)).values:  # 这个 thread 已经有快照了,别再从头跑
                    skipped.append(tid)
                    continue
                graph.invoke({"ticket_id": tid}, cfg(tid))
                started.append(tid)
            print("已启动:", started, "跳过:", skipped)
```

<div class="line-notes">

- `started, skipped = [], []` 两个空列表一起建。
- `if graph.get_state(cfg(tid)).values:  # 这个 thread 已经有快照了,别再从头跑` 没跑过的 thread,`get_state` 不报错,返回的快照 `values` 是空字典 `{}`,在 if 里算假;跑过的有内容,算真。实跑练习 2 的 `status T9999` 时能看到这个现象:快照数 0、`outcome = None`。
- `continue` 跳过这一轮,相当于 JS 的 `continue`。
- `print("已启动:", started, "跳过:", skipped)` 第一次 5 个全启动,第二次 5 个全跳过。

</div>

```bash
rm -f title_ckpt.db
uv run python title_approval_v2.py start-all
uv run python title_approval_v2.py approve T1008 ok
uv run python title_approval_v2.py start-all
uv run python title_approval_v2.py pending | wc -l
```

```text
已启动: ['T1008', 'T1019', 'T1029', 'T1037', 'T1039'] 跳过: []
已重开:C005 新抬头「启明科技有限公司」
已启动: [] 跳过: ['T1008', 'T1019', 'T1029', 'T1037', 'T1039']
       4
```

T1008 批完以后不会再回到列表,pending 剩 4 条。这里用「有没有快照」判断,是最粗的一种;真实系统通常在业务表里记一个状态(`pending_approval` / `done`),启动前查业务表。

</details>

**练习 2:加一个 status 命令。** 在练习 1 的基础上加 `status T1008`:打印这张工单的 `next`、快照总数和 `outcome`。分别在批准前、批准后,以及对一个不存在的 `T9999` 各跑一次,解释快照数为什么是这几个数。

<details><summary>参考答案</summary>

在 `main()` 里加一个分支(我和练习 4 一起存成了 `title_approval_v3.py`):

```python
        elif action == "status":
            snap = graph.get_state(cfg(sys.argv[2]))
            n = len(list(graph.get_state_history(cfg(sys.argv[2]))))
            print("next =", snap.next, "| 快照数 =", n, "| outcome =", snap.values.get("outcome"))
```

<div class="line-notes">

- `snap = graph.get_state(cfg(sys.argv[2]))` 只读不跑,Day 317 的用法。
- `n = len(list(graph.get_state_history(cfg(sys.argv[2]))))` 从新到旧所有快照,数一数。
- `print("next =", snap.next, "| 快照数 =", n, "| outcome =", snap.values.get("outcome"))` 用 `.get` 是因为还没跑到最后时没有 outcome。

</div>

```bash
rm -f title_ckpt.db
uv run python title_approval_v3.py start-all
uv run python title_approval_v3.py status T1008
uv run python title_approval_v3.py approve T1008 "已核对营业执照"
uv run python title_approval_v3.py status T1008
uv run python title_approval_v3.py status T9999
```

```text
已启动: ['T1008', 'T1019', 'T1029', 'T1037', 'T1039'] 跳过: []
next = ('approval',) | 快照数 = 3 | outcome = None
已重开:C005 新抬头「启明科技有限公司」
next = () | 快照数 = 5 | outcome = 已重开:C005 新抬头「启明科技有限公司」
next = () | 快照数 = 0 | outcome = None
```

批准前 3 张:step -1 收到输入(next 是 `__start__`)、step 0 准备跑 load、step 1 load 跑完准备跑 approval,停在这里。批准后多 2 张:approval 跑完准备跑 reissue、reissue 跑完。`T9999` 从没跑过,0 张,`next` 也是空的。注意最后两行的 `next` 都是 `()`,一个是「跑完了」,一个是「根本没开始」,只看 `next` 分不出来,要配合快照数或 `values` 一起看。

</details>

**练习 3:说出这段代码会打印什么。** 不运行,先写下答案,再运行验证。

```python
# agent-zero-lab/part05/review46/quiz_thread.py
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
g1 = builder.compile(checkpointer=InMemorySaver())
g2 = builder.compile(checkpointer=InMemorySaver())
c: RunnableConfig = {"configurable": {"thread_id": "X"}}
print(g1.invoke({}, c), g1.invoke({}, c), g2.invoke({}, c))
```

<div class="line-notes">

- `g1 = builder.compile(checkpointer=InMemorySaver())` 第一个图,自己的内存仓库。
- `g2 = builder.compile(checkpointer=InMemorySaver())` 第二个图,又一个新的内存仓库,和 g1 的不是同一个对象。
- `print(g1.invoke({}, c), g1.invoke({}, c), g2.invoke({}, c))` thread_id 都是 X,但仓库不同。

</div>

<details><summary>参考答案</summary>

```text
{'count': 1} {'count': 2} {'count': 1}
```

g1 的两次调用落在同一个仓库的同一个抽屉里,所以数到 2。g2 用的是另一个 `InMemorySaver()`,同名的抽屉 X 在那个仓库里是空的,从 1 开始。thread_id 只在同一个 checkpointer 里有意义,这也是为什么生产里多个服务实例必须共用同一个 Postgres,而不是各自用内存。

</details>

**练习 4(开放题):同一个客户的重复申请。** T1008 和 T1039 都是 C005 提的同一个新抬头。让 `pending` 在同一客户有多条待审批时做个标记,提醒财务别批两次。

<details><summary>参考答案</summary>

示范解法:先把待审批的都收集起来,再按客户数一遍。`title_approval_v3.py` 文件开头加 `from collections import Counter`,`pending` 分支改成:

```python
        elif action == "pending":
            threads = sorted({c.config.get("configurable", {})["thread_id"] for c in saver.list(None)})
            waiting = []
            for th in threads:
                snap = graph.get_state({"configurable": {"thread_id": th}})
                if snap.next == ("approval",):
                    waiting.append((th, snap.values.get("customer_id"), snap.values.get("new_title")))
            per_customer = Counter(cid for _, cid, _ in waiting)
            for th, cid, title in waiting:
                flag = "  ← 同一客户有多条" if per_customer[cid] > 1 else ""
                print("待审批", th, cid, title, flag)
```

<div class="line-notes">

- `waiting = []` 先不打印,收集成 `(thread_id, 客户, 新抬头)` 元组的列表。
- `waiting.append((th, snap.values.get("customer_id"), snap.values.get("new_title")))` 双层括号:外层是函数调用,内层是元组。
- `per_customer = Counter(cid for _, cid, _ in waiting)` `Counter` 是计数用的字典,相当于 JS 里 `reduce` 出一个 `{C005: 2, C024: 1, ...}`。`_` 表示这个位置的值不用。实跑 `per_customer["C005"]` 是 2。
- `flag = "  ← 同一客户有多条" if per_customer[cid] > 1 else ""` 多于一条才标记。

</div>

```text
待审批 title-T1008 C005 启明科技有限公司   ← 同一客户有多条
待审批 title-T1019 C024 北辰贸易二店有限公司 
待审批 title-T1029 C011 知行咨询有限公司 
待审批 title-T1037 C001 星河餐饮有限公司 
待审批 title-T1039 C005 启明科技有限公司   ← 同一客户有多条
```

改之前五行看起来一样,财务很可能两张都批了,给同一个客户重开两次发票。这种「跨 thread 的检查」LangGraph 管不了,每条线只知道自己的状态,得靠业务层来做。

</details>

**验收标准**:两段默写合上文章能写出来,输出和文中一致;`title_approval_v2.py` 重复 start-all 时全部跳过;能用「仓库、抽屉、快照」那句话讲清本周五个名词的关系;练习 3 的答案先写后跑,写对。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| checkpoint(快照) | 图跑完一步后整个 State 的存档,带着 step、`next` 和自己的 checkpoint_id(Day 316 首次出现) |
| checkpointer | 存快照的仓库,InMemorySaver 存内存,SqliteSaver 存 SQLite 文件(Day 316、318) |
| thread_id | 仓库里一个抽屉的名字,一次独立的执行(一张工单、一段会话)用一个(Day 316) |
| StateSnapshot | `get_state` 返回的对象,`values` 是状态,`next` 是下一步要跑的节点(Day 317) |
| interrupt / Command(resume) | 暂停并交出问题 / 带着答复恢复(Day 319) |
| 非贪婪匹配 | 正则里 `.+?` 尽量少匹配,遇到第一个结束符就停;`.+` 是贪婪的,会一直吃到最后一个 |
| Counter | Python 标准库 `collections` 里的计数字典,`Counter(列表)` 直接数出每个值出现几次 |

## 常见误区

**以为 thread_id 全局唯一就够了。** 练习 3 演示过,两个不同的 InMemorySaver 里同名的 thread 互不相干。thread_id 只在同一个 checkpointer 里有意义,多实例部署要共用一个持久化后端。

**以为 LangGraph 会帮你防重复启动。** 它不会。对已有的 thread 传新输入就是再跑一次,已经审完的也会重新进审批。是否该启动是业务判断,要你自己查。

**只看 `next` 判断有没有跑过。** `next == ()` 既可能是跑完了,也可能是这个 thread 根本不存在。要配合 `values` 是否为空或快照数一起看。

**把 interrupt 当成 `input()`。** 很多人第一次以为 `interrupt()` 会像终端里的 `input()` 那样卡住等你敲字。它其实是让这次 `invoke` 直接返回,进程可以退出,等人答复时再用另一次 `invoke` 恢复。

**默写时把 checkpointer 传给 invoke。** checkpointer 属于 `compile`,thread_id 属于 `invoke` 的 config。记法:仓库建一次,抽屉每次挑。

## 学习资料

### 文档与文章

- [LangGraph · Persistence](https://docs.langchain.com/oss/python/langgraph/persistence):本周所有概念的官方总说明,复习日从头到尾读一遍,看自己有没有哪一段读不懂,1 小时。
- [LangGraph · Checkpointers](https://docs.langchain.com/oss/python/langgraph/checkpointers):各种 checkpointer 的对比和安装方式,20 分钟。
- [LangGraph · Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts):重读「Rules of interrupts」一节,对照今天的坑清单,20 分钟。
- [Python 文档 · sqlite3](https://docs.python.org/zh-cn/3.12/library/sqlite3.html):中文版,看「如何使用连接上下文管理器」和 `check_same_thread` 参数说明,15 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1g61fBFEKY&autoplay=0&high_quality=1" title="最新 Langchain1.0 入门【17】langgraph 状态管理器 checkpointer 详细解析" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>强哥学编程 · 最新 Langchain1.0 入门【17】langgraph 状态管理器 checkpointer 详细解析 · 32 分钟,2025 年 11 月录的,换一个人的讲法再过一遍 checkpointer 和 thread,看你能不能边听边在脑子里对上本周的代码。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1z3NY66EY1&p=91&autoplay=0&high_quality=1" title="尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>尚硅谷 · LangGraph 教程 · 复习日看第 91 集「触发中断时检查点信息」(12 分钟),它把中断时 checkpoint 里存了什么一项项打出来,正好对应今天练习 2 的快照数。</figcaption>
</figure>

### 其他经典视频

- LangChain Academy [Introduction to LangGraph](https://academy.langchain.com/courses/intro-to-langgraph):Module 2(状态与记忆)和 Module 3(人工介入)的视频,英文,和本周内容一一对应,复习时挑没看懂的那一节看。

### 书籍

- Mayo Oshin、Nuno Campos《Learning LangChain》(O'Reilly,2025):讲 LangGraph 记忆和持久化的那一章,复习时对照本周的知识地图读。英文原版。

### 开源项目与代码

- [langchain-ai/langchain-academy](https://github.com/langchain-ai/langchain-academy):`module-3` 目录下的 breakpoints、edit-state-human-feedback 两个 notebook,和本周的 interrupt、状态查看对应,可以当额外的默写题。

## 自测

1. 用一句话说清 checkpointer、thread_id、checkpoint 三者的关系。

<details><summary>答案</summary>

checkpointer 是存快照的仓库,thread_id 是仓库里一个抽屉,checkpoint 是抽屉里按时间叠起来的一张张快照;`get_state` 取最上面那张。

</details>

2. 默写一里 A 跑两次以后有几张快照?为什么不是 2 张?

<details><summary>答案</summary>

6 张。每次 invoke 产生 3 张:step -1 收到输入、step 0 准备跑 bump、step 1 跑完。快照是按「步」存的,不是按「调用」存的。

</details>

3. 审批节点长这样,从 start 到批准完成,`count_calls()` 会被调几次?

```python
def approval(state):
    count_calls()
    d = interrupt("批吗?")
    return {"decision": d}
```

<details><summary>答案</summary>

至少 2 次:暂停时一次,恢复时节点从头重跑又一次。如果中间有一次恢复因为 `response_schema` 校验失败,还要再多一次。

</details>

4. 对一个已经批准完成的 thread 传 `{"ticket_id": "T1008"}` 再 invoke 一次,会发生什么?

<details><summary>答案</summary>

LangGraph 把它当成这条线上的新一轮执行,从 START 开始跑,新输入合进上一轮的最终状态,又停在审批点;上一轮的 outcome 还留在状态里。今天小项目里实测快照从 5 张变成 8 张。要防止,启动前先 `get_state` 查一下。

</details>

5. **面试题**:「你的审批 Agent 部署了 3 个实例,用户的审批请求随机打到其中一个上。checkpointer 怎么选?」

<details><summary>答案</summary>

不能用 InMemorySaver,每个实例的内存是各自的仓库,请求打到另一个实例就找不到那条线(今天练习 3 的现象)。SqliteSaver 是本机文件,多台机器也共享不了。要用所有实例共同连接的持久化后端,LangGraph 现成的是 PostgresSaver(或 Redis 等)。再补两点:同一个 thread 被两个实例同时恢复的并发问题要靠业务层加锁或状态字段控制;thread_id 要用业务主键,任何实例都能算出来。

</details>

## 明天预告

明天是 [Day 322 · LangGraph(二十):时间旅行,回到审批前重来](/blog/agent-zero/day-322-lg-time-travel/)。Day 320 留了一个尾巴:驳回以后改主意了,再发 resume 没用。明天用本周天天在看的那串历史快照,回到审批之前那一刻重新来过,还可以改一下金额再审,原来那条驳回记录一个字都不丢。
