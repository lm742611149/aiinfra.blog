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

预计用时 4–5 小时。前置:Day 23 的 `cloudledger.db`、Day 24 的 `llm.py` 和 State/节点/边概念。

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

先装 SQLite checkpointer:

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
