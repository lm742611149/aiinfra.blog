---
title: 'Day 126 · BillSleuth(五):贷记单草稿、人工审批与幂等'
description: '结论要冲正时，由代码(不是模型)起草贷记单，调查图在审批节点用 interrupt 暂停，主管在命令行或网页上批准或驳回，图从磁盘上的 checkpoint 恢复。给 Day 123 的 draft_credit_note 加显式幂等键和 BEGIN IMMEDIATE,补上 approved、issued、rejected 三个状态，两人审批门槛，签发前再查一次额度，驳回后改写给客户的话。11 个测试把权限边界钉死，其中一个证明了 Day 123 的「已有草稿就返回」挡不住批准之后的重放。'
pubDate: 2026-10-15
regime: none
tags: ['human-in-the-loop', 'idempotency', 'approval', 'billing', 'agent-60']
series: 'agent-60'
day: 126
lang: 'zh'
---

## 今天要解决的问题

Day 125 结束的时候,BillSleuth 已经能写出两份解释：客户版和内部版，里面每个金额都过了数字溯源校验，结论里的多收金额也单独查过出处(`overcharge_is_grounded`)。但到这一步，钱一分没动。Day 123 的 MCP server 里虽然有一个 `draft_credit_note` 工具，调查图却没把它放进 `READ_TOOLS`,模型根本看不到它。

今天把这最后一步接上：结论要冲正时起草一张贷记单，然后让图停下来，等人批。

这一步看着简单，实际上是整个项目里最容易出事故的地方。查错了账，最坏是回复不准确，客户再问一次；开错了贷记单，钱就真的出去了。所以今天的重点不在「能开」,而在「不该开的时候开不出来」「重放和并发时不会开两张」「没人批的时候签不出去」。

学完今天，你应该能做到：

1. 说清楚贷记单、退款、作废重开三种处理的区别，以及什么情况下只能解释、不能冲正。
2. 让**代码**而不是模型去起草贷记单：金额只能是过了溯源检查的那个数，发票号由证据决定。
3. 给 `draft_credit_note` 加显式幂等键，用 `BEGIN IMMEDIATE` 保证 8 个并发请求只生成一张，并用测试证明 Day 123 那套「已有草稿就返回」为什么不够。
4. 用 LangGraph 的 `interrupt` 让图在审批节点暂停，用 `SqliteSaver` 把暂停的状态存到磁盘，主管第二天在命令行或网页上批，图接着跑。
5. 写出审批规则:Agent 不能批，同一个人不能批两次，达到门槛要两个人批，签发前再查一次额度，驳回后改写给客户的话。

预计用时 4–5 小时。前置:Day 123(MCP 工具和审计日志)、Day 124(调查图)、Day 125(write_up 和数字溯源)。SupportPilot 在 Day 47 做过一次退款审批，Day 65 讲过持久化执行和重放语义，今天都会用到。

## 贷记单、退款、作废重开，先分清楚

很多人第一次做计费 Agent,会把「退钱」当成一个动作。账务上至少有三种处理，用错了会给财务同事留下很难对的账。

**贷记单(credit note)** 是挂在一张已开发票上的负数凭证，意思是「这张发票里有一部分我们不该收」。它可以退回原支付方式，也可以留在客户余额里抵下一期账单。发票本身不改，审计时能看到原来开了多少、后来冲了多少、为什么冲。在 Stripe 的计费产品里，贷记单是调整已定稿发票金额的常规做法，概念可以看文末链接的文档。

**退款(refund)** 是支付层面的操作，把某一笔付款退回去。重复扣款(`duplicate_charge`)就是典型：发票没错，是同一张发票被扣了两次，多出来的那笔在库里是 `PAY-…-R`。严格说这时候应该退掉那笔付款，而不是开贷记单。我们的项目不接真实支付，把它也简化成「对这张发票开一张等额贷记单」,面试里讲的时候要主动说明这个简化，做过支付的面试官一定会问。

**作废重开(void and reissue)** 只适用于还没付款的发票，钱没收，直接作废、按正确金额重开就行。我们的数据里发票都已付款，用不到，但你接真实系统时要先看发票状态。

决定冲多少的规则只有一条：**等于结论里的多收金额，一分不多，一分不少。** 客户情绪再激动、要求「多退点当补偿」,也不能答应，补偿是商务决策，走另一套流程。而结论里的 `overcharge` 在 Day 125 的 `write_up` 之前已经过了 `overcharge_is_grounded`:它必须等于证据链里某条证据的值，否则案件直接转人工，根本走不到今天这一步。

还有一类最容易被忽略：账单根本没错。Day 122 造数据时专门留了 20 个 `no_error` 场景，分四种：升级后的折算(`upgrade_proration`)、税(`tax_line`)、优惠券到期(`coupon_ended`)、年付续费(`annual_renewal`)。这些场景里结论的 `expected_action` 应该是 `explain_only`,图在 `write_up` 之后直接结束，不会进审批。如果 Agent 在这里判成了 `credit_note`,就是「误冲正」,Day 127 会单独统计它，它比漏冲正更严重。

## 谁来起草：代码，不是模型

Day 123 设计工具时，`draft_credit_note` 是作为 MCP 工具暴露的，带了 `read_only_hint=False` 和 `idempotent_hint=True` 的注解。Day 124 建图时，`READ_TOOLS` 只放了 7 个只读工具，模型看不到它。今天要决定：让模型调它，还是让代码调它？

我选了代码。理由很直接：起草贷记单需要的三个参数，发票号、金额、原因，在 `conclude` 节点之后全都已经有了，而且都是校验过的。金额是过了溯源检查的 `overcharge`,原因可以用结论里的 `root_cause` 和 `reasoning` 拼出来。剩下的只有「开在哪张发票上」,这个也可以由代码根据证据决定(下面会讲)。让模型再调一次工具，只会多一个出错的机会：它可能把金额写成 `174.9`,可能挑错发票，可能在同一轮里调两次。

所以 `draft_credit_note` 继续不进 `READ_TOOLS`,模型的工具表里永远没有写工具。起草由图里一个新节点 `request_approval` 完成，它通过同一个 MCP 桥(`BillingMCP`)调工具，这样审计日志、参数校验、额度检查都和 Day 123 一样，只是调用方从模型换成了代码。

## 状态机和新增的表

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="贷记单状态机：代码起草 draft,人工批准后 approved 并签发 issued;驳回则 rejected">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="28" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">credit_notes.status 的流转</text>
  <rect x="30" y="110" width="120" height="50" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="90" y="132" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">request_approval</text>
  <text x="90" y="150" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">代码起草</text>
  <line x1="150" y1="135" x2="205" y2="135" stroke="var(--ink-soft)" marker-end="url(#a126)"/>
  <rect x="210" y="110" width="100" height="50" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="260" y="140" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">draft</text>
  <line x1="310" y1="125" x2="385" y2="90" stroke="var(--compute)" marker-end="url(#a126)"/>
  <text x="312" y="88" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">够人数批准</text>
  <rect x="390" y="65" width="100" height="44" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="440" y="92" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--compute)">approved</text>
  <line x1="490" y1="87" x2="525" y2="87" stroke="var(--compute)" marker-end="url(#a126)"/>
  <rect x="530" y="65" width="90" height="44" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="575" y="92" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--compute)">issued</text>
  <line x1="310" y1="148" x2="385" y2="185" stroke="var(--ink-soft)" marker-end="url(#a126)"/>
  <text x="318" y="190" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">任一人驳回</text>
  <rect x="390" y="165" width="100" height="44" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="440" y="192" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink-soft)">rejected</text>
  <path d="M235 160 C 235 200, 285 200, 285 162" fill="none" stroke="var(--ink-faint)" marker-end="url(#a126)"/>
  <text x="180" y="222" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">≥ 门槛金额:第一人批准后仍是 draft</text>
  <text x="20" y="262" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">蓝色:图里的代码节点。琥珀色:只有人能触发。模型的工具表里没有任何写工具。</text>
  <defs><marker id="a126" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>图在 draft 之后暂停。往右的每一步都要人来做，审批节点恢复时才会调 decide 和 issue。</figcaption>
</figure>

Day 122 的 `schema.sql` 里 `credit_notes.status` 只允许 `draft`、`approved`、`issued`,今天**新增 `rejected`**。被驳回的草稿不删，留着做审计。另外新增两张表：`credit_note_requests` 记幂等键、它对应的贷记单和案件号(审批时靠案件号找到暂停的那张图);`approvals` 记每一次审批动作，两人审批时一张贷记单会有多条。

```sql
-- billsleuth/billsleuth/schema.sql(Day 126 改动)
    status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'issued', 'rejected'))  -- Day 126 新增 rejected
-- Day 126 新增:幂等键(同一个案件、同一张发票、同一金额只起草一张)和审批记录
CREATE TABLE IF NOT EXISTS credit_note_requests (
    idempotency_key TEXT PRIMARY KEY,   -- 案件号:发票号:金额
    case_id TEXT NOT NULL,              -- 调查图的 thread_id,审批时靠它恢复暂停的图
    credit_note_id TEXT NOT NULL REFERENCES credit_notes(id),
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    credit_note_id TEXT NOT NULL REFERENCES credit_notes(id),
    approver TEXT NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
    comment TEXT NOT NULL,
    decided_at TEXT NOT NULL
);
```

改了建表语句，要重新跑一次 `uv run python -m billsleuth.seed`,旧库里的 CHECK 约束不认 `rejected`。

## Day 123 的去重为什么不够

Day 123 给 `draft_credit_note` 写了一条去重规则：同一张发票已经有 `status='draft'` 的草稿，就直接返回那张。这条规则挡住了最常见的情况，模型在同一轮里调两次。但它只看 `draft`。

想一下这个顺序：图起草了一张草稿，暂停；主管批准了，状态变成 `approved`;这时候因为某种原因，起草那一步又执行了一次。去重规则一看，这张发票没有 `draft` 状态的草稿了，于是继续往下走。

「某种原因」在 Agent 系统里比你想的多：

| 来源 | 怎么发生的 |
| --- | --- |
| 流程重放 | LangGraph 从 checkpoint 恢复时，被中断的那个节点会从头再执行一遍(Day 65 讲过) |
| 超时重试 | 工具执行成功了，但返回前连接断了，调用方以为失败又调一次 |
| 客户追问 | Day 127 的模拟客户会追问，第二轮调查又走到起草这一步 |
| 人工重跑 | 同事觉得结论不对，手动把案件重跑一遍 |

我写了一个测试把它钉住，结果有两种。冲正金额等于实际扣款的(比如 `cancel_not_respected` 整张发票都不该开),第二次起草会撞上 Day 123 的额度检查，报「超过了这张发票的实际扣款合计」。钱没多出去，但案件会被**错误地转人工**,因为图以为起草失败了。冲正金额小于实际扣款的(部分多收，大多数场景都是这样),第二次起草会**悄悄多出一张**。这个测试在下面的测试清单里，叫 `test_day123_dedup_is_not_enough_after_approval`。

## 幂等键

修法是加一个显式的幂等键：`案件号:发票号:金额`。案件号就是调查图的 `thread_id`。同一个键，不管那张贷记单后来变成了什么状态，都返回原来那张。

为什么不让模型生成一个 uuid 当键？因为模型不记得自己上次传过什么，重放时会生成一个新的。何况今天起草的是代码，代码从图的配置里拿 `thread_id`,重放时拿到的还是同一个。

键里为什么有金额？如果同一个案件第一次结论是 13.93,后来发现应该是 25.87,两个键不同，会生成第二张草稿，摆在审批人面前由人判断。如果键里没有金额，第二次会返回第一张 13.93 的草稿，回复客户的数字就对不上了。

光有键还不够，查键和插入之间有竞争窗口：两个请求同时进来，都查到「键不存在」,都插入一张。SQLite 里最直接的办法是 `BEGIN IMMEDIATE`,开事务时就拿写锁，第二个请求在这一步排队，等第一个提交后再查键就能查到。Postgres 里对应的是唯一约束加 `INSERT ... ON CONFLICT`,Brandur 那篇讲 Stripe 式幂等键的长文写得很透，链接在文末。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="两个并发请求在 BEGIN IMMEDIATE 下串行：第二个请求查到幂等键，返回第一张草稿">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
  <text x="120" y="26" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">请求 A</text>
  <text x="320" y="26" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">SQLite</text>
  <text x="520" y="26" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">请求 B</text>
  <line x1="120" y1="36" x2="120" y2="240" stroke="var(--mem)" stroke-dasharray="4 4"/>
  <line x1="320" y1="36" x2="320" y2="240" stroke="var(--rule)" stroke-dasharray="4 4"/>
  <line x1="520" y1="36" x2="520" y2="240" stroke="var(--mem)" stroke-dasharray="4 4"/>
  <line x1="120" y1="60" x2="315" y2="60" stroke="var(--ink-soft)" marker-end="url(#b126)"/>
  <text x="130" y="54" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">BEGIN IMMEDIATE(拿到写锁)</text>
  <line x1="520" y1="78" x2="325" y2="78" stroke="var(--ink-soft)" marker-end="url(#b126)"/>
  <text x="370" y="94" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">B 在这里等锁</text>
  <line x1="120" y1="115" x2="315" y2="115" stroke="var(--compute)" marker-end="url(#b126)"/>
  <text x="130" y="109" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">查键:无 → 查额度 → 插草稿 + 键</text>
  <line x1="120" y1="145" x2="315" y2="145" stroke="var(--ink-soft)" marker-end="url(#b126)"/>
  <text x="130" y="139" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">COMMIT(释放锁)</text>
  <line x1="325" y1="170" x2="515" y2="170" stroke="var(--ink-soft)" marker-end="url(#b126)"/>
  <text x="335" y="164" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">B 拿到锁</text>
  <line x1="520" y1="200" x2="325" y2="200" stroke="var(--compute)" marker-end="url(#b126)"/>
  <text x="335" y="194" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">查键:有 → 返回 A 的那张</text>
  <text x="320" y="235" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">查键和插入在同一把锁里，中间没有窗口</text>
  <defs><marker id="b126" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>不加锁时，两个请求可能都在「查键:无」这一步通过。BEGIN IMMEDIATE 让「查」和「写」成为一个原子操作。</figcaption>
</figure>

改完的 `draft_credit_note` 是这样，在 Day 123 的基础上加了两个可选参数、一个事务、额度检查改成「已批准和已签发的加上这次」:

```python
@mcp.tool(annotations=DRAFT_ONLY)
@audited
def draft_credit_note(
    invoice_id: Annotated[str, Field(description="要冲正的发票号", pattern=ID)],
    amount: Annotated[str, Field(description="冲正金额,字符串,两位小数,如 \"23.40\"", pattern=r"^\d+\.\d{2}$")],
    reason: Annotated[str, Field(min_length=10, max_length=300, description="冲正原因,写清根因和算式")],
    idempotency_key: Annotated[str | None, Field(description="Day 126 新增:由调用方代码生成,形如 案件号:发票号:金额")] = None,
    case_id: Annotated[str | None, Field(description="Day 126 新增:调查图的 thread_id,审批时用来恢复")] = None,
) -> CreditNoteOut:
    """为多收的钱起草一张贷记单(credit note)。只生成 draft,不会退款,签发要人工审批。
    同一张发票已有草稿时直接返回那张草稿,不会重复创建。
    Day 126:带 idempotency_key 时,同一个键无论草稿后来被批准、签发还是驳回,都返回原来那张。"""
    amt = money(amount)
    if amt <= 0:
        raise ToolError("冲正金额必须大于 0。")
    conn = connect(db_path())
    conn.isolation_level = None          # 事务自己管:下面要用 BEGIN IMMEDIATE
    conn.execute("BEGIN IMMEDIATE")      # 一开始就拿写锁,并发的第二个请求在这里排队
    try:
        if idempotency_key:
            hit = conn.execute("SELECT c.* FROM credit_note_requests r JOIN credit_notes c ON c.id = r.credit_note_id "
                               "WHERE r.idempotency_key = ?", (idempotency_key,)).fetchone()
            if hit:
                conn.execute("COMMIT")
                return CreditNoteOut(credit_note_id=hit["id"], invoice_id=hit["invoice_id"], amount=hit["amount"],
                                     status=hit["status"], note="同一个幂等键已经起草过,返回原来那张")
        inv = must_invoice(conn, invoice_id)
        paid = sum((Decimal(p["amount"]) for p in conn.execute(
            "SELECT amount FROM payments WHERE invoice_id = ? AND status = 'succeeded'", (invoice_id,))), ZERO)
        existing = conn.execute("SELECT * FROM credit_notes WHERE invoice_id = ? AND status = 'draft'",
                                (invoice_id,)).fetchone()
        if existing:
            conn.execute("COMMIT")
            return CreditNoteOut(credit_note_id=existing["id"], invoice_id=invoice_id, amount=existing["amount"],
                                 status="draft", note="这张发票已有草稿,未重复创建")
        credited = sum((Decimal(r["amount"]) for r in conn.execute(
            "SELECT amount FROM credit_notes WHERE invoice_id = ? AND status IN ('approved', 'issued')",
            (invoice_id,))), ZERO)
        if amt + credited > paid:
            raise ToolError(f"冲正金额 {fmt(amt)} 加上已批准或已签发的 {fmt(credited)},"
                            f"超过了这张发票的实际扣款合计 {fmt(paid)}。")
        n = conn.execute("SELECT COUNT(*) FROM credit_notes").fetchone()[0] + 1
        cn_id = f"CN-{n:04d}"
        conn.execute("INSERT INTO credit_notes VALUES (?,?,?,?,?)", (cn_id, invoice_id, amt, reason, "draft"))
        if idempotency_key:
            conn.execute("INSERT INTO credit_note_requests VALUES (?,?,?,?)",
                         (idempotency_key, case_id or "", cn_id, datetime.now(timezone.utc).isoformat(timespec="seconds")))
        conn.execute("COMMIT")
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()
    return CreditNoteOut(credit_note_id=cn_id, invoice_id=inv["id"], amount=fmt(amt), status="draft",
                         note="已生成草稿,等待人工审批后才会签发")
```

几个细节。`conn.isolation_level = None` 是必须的：Python 的 sqlite3 默认会在写语句前偷偷 `BEGIN`,和手写的 `BEGIN IMMEDIATE` 冲突，报 `cannot start a transaction within a transaction`。`ToolError` 抛出前要回滚，`except BaseException` 里先看 `conn.in_transaction` 再回滚。两个新参数都是可选的，所以 Day 123 的测试和 Inspector 里的手动调用照样能用；MCP 的工具清单里会多出这两个参数，但模型看不到这个工具，没关系。

我把 `BEGIN IMMEDIATE` 临时改成普通的 `BEGIN` 跑了 10 次并发测试，挂了 6 次，报错都是 `database is locked`。原因是普通 `BEGIN` 是延迟事务：先读(拿共享锁),等到 INSERT 时才想升级成写锁。两个线程都读完了、都想升级，谁也等不到谁,SQLite 检测到这种情况会立刻返回 busy,`busy_timeout` 设多长都没用。这次表现是报错；换个数据库、换个隔离级别，表现可能是静悄悄地多出一张。并发 bug 不一定每次复现，这种测试要一直留在套件里。

## 审批和签发

`approval.py` 是新文件，只给人用：命令行、网页、图里的审批节点。它不是 MCP 工具，模型够不着。

```python
# billsleuth/billsleuth/approval.py
"""Day 126 新增:贷记单的审批和签发。只给人用(命令行、网页、图里的审批节点),不在模型的工具表里。

状态:draft →(够人数批准)→ approved → issued;draft →(任一人驳回)→ rejected。
"""
from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from decimal import Decimal

from billsleuth.money import ZERO, fmt

TWO_PERSON_THRESHOLD = Decimal(os.environ.get("TWO_PERSON_THRESHOLD", "300.00"))  # 达到这个金额要两个人批


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def approvals_needed(amount: str | Decimal) -> int:
    return 2 if Decimal(amount) >= TWO_PERSON_THRESHOLD else 1


def approvals_of(conn: sqlite3.Connection, cn_id: str) -> list[dict]:
    return [dict(r) for r in conn.execute("SELECT * FROM approvals WHERE credit_note_id = ? ORDER BY id", (cn_id,))]


def _begin(conn: sqlite3.Connection) -> None:
    conn.isolation_level = None
    conn.execute("BEGIN IMMEDIATE")


def decide(conn: sqlite3.Connection, cn_id: str, approver: str, decision: str, comment: str) -> dict:
    """记一次审批。驳回要写原因;Agent 和同一个人都不能批第二次。"""
    if decision not in ("approve", "reject"):
        raise ValueError("decision 只能是 approve 或 reject")
    if not approver or approver.lower() in ("agent", "billsleuth"):
        raise PermissionError("Agent 不能审批自己起草的贷记单")
    if decision == "reject" and not comment.strip():
        raise ValueError("驳回必须写原因")
    _begin(conn)
    try:
        cn = conn.execute("SELECT * FROM credit_notes WHERE id = ?", (cn_id,)).fetchone()
        if cn is None:
            raise LookupError(f"没有贷记单 {cn_id}")
        if cn["status"] != "draft":
            conn.execute("COMMIT")
            return {"credit_note_id": cn_id, "status": cn["status"], "note": "已经处理过,这次不变"}
        if any(a["approver"] == approver for a in approvals_of(conn, cn_id)):
            raise PermissionError(f"{approver} 已经审过这张,需要另一个人")
        conn.execute("INSERT INTO approvals (credit_note_id, approver, decision, comment, decided_at) VALUES (?,?,?,?,?)",
                     (cn_id, approver, decision, comment, _now()))
        if decision == "reject":
            status = "rejected"
        else:
            yes = sum(1 for a in approvals_of(conn, cn_id) if a["decision"] == "approve")
            status = "approved" if yes >= approvals_needed(cn["amount"]) else "draft"
        # 带上旧状态做条件:换成 Postgres 的读已提交隔离级别时,这一句能挡住并发覆盖
        conn.execute("UPDATE credit_notes SET status = ? WHERE id = ? AND status = 'draft'", (status, cn_id))
        conn.execute("COMMIT")
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    return {"credit_note_id": cn_id, "status": status,
            "approvals": len(approvals_of(conn, cn_id)), "needed": approvals_needed(cn["amount"])}


def issue(conn: sqlite3.Connection, cn_id: str) -> dict:
    """签发。钱真正出去的那一刻,再按已签发金额查一次额度。重复调用没有副作用。"""
    _begin(conn)
    try:
        cn = conn.execute("SELECT * FROM credit_notes WHERE id = ?", (cn_id,)).fetchone()
        if cn is None:
            raise LookupError(f"没有贷记单 {cn_id}")
        if cn["status"] == "issued":
            conn.execute("COMMIT")
            return {"credit_note_id": cn_id, "status": "issued", "note": "已签发,重复调用无副作用"}
        if cn["status"] != "approved":
            raise PermissionError(f"状态是 {cn['status']},只有 approved 的能签发")
        paid = sum((Decimal(p["amount"]) for p in conn.execute(
            "SELECT amount FROM payments WHERE invoice_id = ? AND status = 'succeeded'", (cn["invoice_id"],))), ZERO)
        issued = sum((Decimal(r["amount"]) for r in conn.execute(
            "SELECT amount FROM credit_notes WHERE invoice_id = ? AND status = 'issued'", (cn["invoice_id"],))), ZERO)
        if issued + Decimal(cn["amount"]) > paid:
            raise PermissionError(f"签发后贷记合计 {fmt(issued + Decimal(cn['amount']))} 会超过实际扣款 {fmt(paid)},已拦截")
        conn.execute("UPDATE credit_notes SET status = 'issued' WHERE id = ? AND status = 'approved'", (cn_id,))
        conn.execute("COMMIT")
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    return {"credit_note_id": cn_id, "status": "issued"}


def rejected_message(invoice_ids: list[str]) -> str:
    """驳回后给客户的话。不带金额、不提退款,只说复核了、谁在跟进。"""
    return (f"您好,我们复核了发票 {', '.join(invoice_ids)} 的账单,需要账务同事再做一次人工核对。"
            "核对结果会在 1 个工作日内邮件告诉您,给您添麻烦了。")


def approved_note(amount: str) -> str:
    return f"更正已审核通过,多收的 {amount} 美元会退回原支付方式或抵扣下期账单。"
```

展开说几处。

`decide` 拒绝 `agent` 和 `billsleuth` 这两个名字，防止哪天有人把审批接口暴露给 Agent。同一个人不能批两次，否则一个人点两下就绕过了两人审批。驳回必须写原因，这些原因攒多了是 Day 128 错误分析最好的素材。

`UPDATE ... WHERE id = ? AND status = 'draft'` 带着旧状态做条件。在 SQLite 加 `BEGIN IMMEDIATE` 的情况下这个条件是多余的，但你以后搬到 Postgres、用默认的读已提交隔离级别时，它能挡住两个审批人同时点「批准」造成的覆盖。

`issue` 里又按已签发金额查了一次额度，看起来和起草时的检查重复了，其实不是。起草时查的是「已批准加已签发」,但审批和签发之间可能有人手动改过状态，或者另一张贷记单先签发了。签发是钱真正出去的那一刻，在这一刻再算一次，是最后一道闸。测试里专门造了这个情况：手动插入一张已批准的贷记单，两张加起来超过实际扣款，第二张签发时被拦下。

`TWO_PERSON_THRESHOLD` 默认 300.00 美元，从环境变量读。云簿的数据里一张月付发票一般是几十到几百美元，年付的能到一两千。门槛定多少是业务决定，代码只负责执行。

## 图在审批节点暂停

调查图在 `write_up` 之后多了两个节点。改动集中在 `build_graph` 末尾：

```python
    # ---------- Day 126 新增:起草贷记单,暂停等人批 ----------

    def after_write_up(state: CaseState) -> Literal["request_approval", "__end__"]:
        f = state.get("findings") or {}
        if state.get("escalated") or f.get("expected_action") != "credit_note":
            return END
        return "request_approval"

    def request_approval(state: CaseState, config: RunnableConfig) -> dict:
        """代码起草,不是模型起草:金额只能是结论里过了溯源检查的那个数,幂等键由案件号推出。"""
        f = state["findings"]
        case_id = config["configurable"]["thread_id"]
        invoice_id = credit_target(f, state.get("evidence", []))
        key = f"{case_id}:{invoice_id}:{f['overcharge']}"
        reason = f"{f['root_cause']}:{f.get('reasoning', '')}"[:300].ljust(10, "。")
        ok, data = mcp.call("draft_credit_note", {"invoice_id": invoice_id, "amount": f["overcharge"], "reason": reason,
                                                   "idempotency_key": key, "case_id": case_id})
        if not ok:  # 比如金额超过实际扣款:不硬冲,转人工
            return {"escalated": True, "approval": {"status": "blocked", "error": data, "invoice_id": invoice_id}}
        return {"approval": {**data, "idempotency_key": key, "needed": approval.approvals_needed(data["amount"]),
                             "decisions": []}}

    def await_approval(state: CaseState) -> dict:
        """图在这里暂停。恢复时传 {"approver", "decision", "comment"}。
        注意:恢复时这个节点会从头再执行一遍,所以起草放在上一个节点,这里只做审批。"""
        a = state["approval"]
        resume = interrupt({"credit_note_id": a["credit_note_id"], "invoice_id": a["invoice_id"],
                            "amount": a["amount"], "needed": a["needed"], "decided": len(a["decisions"]),
                            "reasoning": state["findings"].get("reasoning", "")})
        conn = connect()
        try:
            out = approval.decide(conn, a["credit_note_id"], resume.get("approver", ""), resume.get("decision", ""),
                                  resume.get("comment", ""))
            if out["status"] == "approved":
                out = approval.issue(conn, a["credit_note_id"])
        finally:
            conn.close()
        reply = dict(state.get("reply") or {})
        if out["status"] == "rejected":
            reply["customer_message"] = approval.rejected_message(state["findings"]["invoice_ids"])
        elif out["status"] == "issued":
            reply["customer_message"] = reply.get("customer_message", "").rstrip() + "\n\n" + approval.approved_note(a["amount"])
        return {"approval": {**a, "status": out["status"], "decisions": a["decisions"] + [resume]}, "reply": reply}

    def after_approval(state: CaseState) -> Literal["await_approval", "__end__"]:
        return "await_approval" if state["approval"]["status"] == "draft" else END  # 两人审批:还差一个人
```

```python
    if checkpointer is None:
        # 没有 checkpointer 图就没法暂停等人批:到 write_up 为止(Day 124、125 的测试和 run.py 都是这样跑的)
        g.add_edge("write_up", END)
    else:
        g.add_conditional_edges("write_up", after_write_up, ["request_approval", END])
        g.add_edge("request_approval", "await_approval")
        g.add_conditional_edges("await_approval", after_approval, ["await_approval", END])
    return g.compile(checkpointer=checkpointer)


def credit_target(findings: dict, evidence: list[dict]) -> str:
    """Day 126 新增:贷记单开在哪张发票上。结论可能列了好几张(比如重复开票时原发票和多开的那张都写上),
    优先选「多收」证据等于结论金额的那张,其次选结论里的最后一张。"""
    over, ids = findings["overcharge"], findings["invoice_ids"]
    for e in evidence:
        if e["source_ref"] in ids and e["value"] == over and "多收" in e["claim"]:
            return e["source_ref"]
    return ids[-1]
```

**为什么起草和审批分成两个节点。** `interrupt()` 的语义是：图停在这里，状态存进 checkpoint;恢复时，**这个节点从头再执行一遍**,执行到 `interrupt()` 那一行时直接返回恢复值。所以 `interrupt()` 之前的代码会执行两次。如果把起草放在 `await_approval` 里、`interrupt()` 之前，每次恢复都会再起草一次。幂等键能挡住，但没必要让它去挡。分成两个节点，起草只在 `request_approval` 里执行一次，恢复时只重跑 `await_approval`。

**没有 checkpointer 就没有审批。** `interrupt` 需要 checkpointer 才能保存暂停的状态。Day 124、125 的测试和 `run.py` 调 `build_graph` 时有的没传 checkpointer,图在 `write_up` 后直接结束，和以前一样。传了 checkpointer,才会走审批分支。

**贷记单开在哪张发票上。** 结论里的 `invoice_ids` 可能不止一张。Day 124 跑 S023(重复开票)时就遇到了：模型把原发票 `INV-0023-04` 和多开的 `INV-0023-04D` 都写进了结论。冲正应该冲多开的那张。`credit_target` 先在证据里找「多收」这一类、值等于结论金额、来源是结论里某张发票的那条，用它的发票号；找不到就用结论里的最后一张。Day 127 判分时，贷记单开在哪张发票上是单独判的。

**两人审批靠循环。** `after_approval` 看状态还是 `draft`,就回到 `await_approval` 再暂停一次，等第二个人。

**驳回之后改写给客户的话。** 钱没动，财务上不用回滚，Day 65 讲的 saga 补偿在这里用不上：我们的设计让 Agent 能触发的动作全部可撤销，不可撤销的动作全部在人手里。但给客户的话要改：Day 125 写的客户版说的是「已提交更正申请，审核通过后会退回或抵扣」,如果驳回了还发这句话，客户几天后会来要钱。所以驳回时把客户版整段换成 `rejected_message`,不带金额、不提退款，只说复核了、谁在跟进。批准时在客户版末尾加一句 `approved_note`。

## 暂停的图存在哪

`InMemorySaver` 只在一个进程里有效，进程退出，暂停的图就没了。真实的审批可能隔天才做，所以要把 checkpoint 存到磁盘。`langgraph-checkpoint-sqlite` 提供了 `SqliteSaver`:

```bash
uv add langgraph-checkpoint-sqlite
```

```python
# billsleuth/billsleuth/cases.py
"""Day 126 新增:用持久化的 checkpointer 跑案件。调查停在审批节点后,进程可以退出,
主管第二天在命令行或网页上批,图从 checkpoints.db 里恢复。

开案件:uv run python -m billsleuth.cases S017
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import Command

from billsleuth.db import ROOT
from billsleuth.graph import build_graph
from billsleuth.mcp_bridge import BillingMCP


def checkpoints_path() -> Path:
    return Path(os.environ.get("BILLSLEUTH_CHECKPOINTS", ROOT / "checkpoints.db"))


@contextmanager
def case_graph(llm=None) -> Iterator:
    conn = sqlite3.connect(checkpoints_path(), check_same_thread=False)
    try:
        yield build_graph(llm=llm, mcp=BillingMCP(in_process=True), checkpointer=SqliteSaver(conn))
    finally:
        conn.close()


def cfg(case_id: str) -> dict:
    return {"recursion_limit": 60, "configurable": {"thread_id": case_id}}


def open_case(customer_id: str, question: str, llm=None) -> tuple[str, dict]:
    case_id = "case-" + uuid.uuid4().hex[:8]
    os.environ["BILLSLEUTH_SESSION"] = case_id  # 审计日志里的 session_id 就是案件号
    with case_graph(llm) as g:
        g.invoke({"customer_id": customer_id, "question": question}, cfg(case_id))
        return case_id, g.get_state(cfg(case_id)).values


def resume_case(case_id: str, approver: str, decision: str, comment: str = "", llm=None) -> dict:
    """主管审批:把决定交给暂停的图。图里的 await_approval 节点调 approval.decide / issue。"""
    with case_graph(llm) as g:
        state = g.get_state(cfg(case_id))
        if "await_approval" not in state.next:
            raise LookupError(f"案件 {case_id} 没有在等审批(当前位置:{state.next or '已结束'})")
        g.invoke(Command(resume={"approver": approver, "decision": decision, "comment": comment}), cfg(case_id))
        return g.get_state(cfg(case_id)).values


if __name__ == "__main__":
    for sid in sys.argv[1:]:
        sc = json.loads((ROOT / "scenarios" / f"{sid}.json").read_text())
        case_id, st = open_case(sc["customer_id"], sc["question"])
        a = st.get("approval") or {}
        print(f"{sid} → 案件 {case_id}:结论 {st.get('findings', {}).get('root_cause')} "
              f"多收 {st.get('findings', {}).get('overcharge')};贷记单 {a.get('credit_note_id', '无')} {a.get('status', '')}")
```

`open_case` 开一个案件：生成案件号，设成审计日志的会话号(Day 123 的 `audited` 从 `BILLSLEUTH_SESSION` 读),跑到暂停为止。`resume_case` 先确认这个案件确实停在 `await_approval`,再用 `Command(resume=...)` 把审批决定交进去。checkpoint 存在 `checkpoints.db`,和计费库 `billing.db` 分开：一个是业务数据，一个是 Agent 的运行状态，备份和清理策略都不一样。

## 审批人看什么

审批界面最常见的错误设计，是把 Agent 的结论原样摆给审批人：「Agent 说多收了 174.90,批不批?」审批人看了一眼觉得合理，点了批准，审批就成了橡皮图章。审批人应该看的是**证据**,而且是系统重新取的证据。

```python
# billsleuth/billsleuth/approve.py
"""Day 126 新增:审批命令行。审批人看到的是系统重新复算的证据,不是 Agent 写的结论。

uv run python -m billsleuth.approve list
uv run python -m billsleuth.approve show CN-0001
uv run python -m billsleuth.approve approve CN-0001 --as alice [-m 备注]
uv run python -m billsleuth.approve reject  CN-0001 --as alice -m 原因
"""
from __future__ import annotations

import argparse
import json
import os

from billsleuth import approval
from billsleuth.cases import resume_case
from billsleuth.db import connect
from billsleuth.mcp_bridge import BillingMCP


def case_of(conn, cn_id: str) -> str:
    r = conn.execute("SELECT case_id FROM credit_note_requests WHERE credit_note_id = ?", (cn_id,)).fetchone()
    if r is None or not r["case_id"]:
        raise SystemExit(f"{cn_id} 不是由调查案件起草的,找不到要恢复的图")
    return r["case_id"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["list", "show", "approve", "reject"])
    ap.add_argument("cn_id", nargs="?")
    ap.add_argument("--as", dest="approver", default="")
    ap.add_argument("-m", dest="comment", default="")
    a = ap.parse_args()
    conn = connect()
    if a.cmd == "list":
        for r in conn.execute("SELECT c.*, q.case_id FROM credit_notes c JOIN credit_note_requests q "
                              "ON q.credit_note_id = c.id WHERE c.status = 'draft' ORDER BY c.id"):
            n = len(approval.approvals_of(conn, r["id"]))
            print(f"{r['id']}  {r['invoice_id']}  {r['amount']:>9}  已批 {n}/{approval.approvals_needed(r['amount'])}"
                  f"  案件 {r['case_id']}")
        return
    if a.cmd == "show":
        cn = dict(conn.execute("SELECT * FROM credit_notes WHERE id = ?", (a.cn_id,)).fetchone())
        case_id = case_of(conn, a.cn_id)
        os.environ["BILLSLEUTH_SESSION"] = f"approver:{a.approver or 'unknown'}"  # 审计里和 Agent 的调用区分开
        ok, proof = BillingMCP(in_process=True).call("recompute_invoice", {"invoice_id": cn["invoice_id"]})
        calls = [dict(r) for r in conn.execute(
            "SELECT at, tool, ok, args_json FROM audit_log WHERE session_id = ? ORDER BY id", (case_id,))]
        print(json.dumps({"credit_note": cn, "recompute": proof if ok else {"error": proof},
                          "approvals": approval.approvals_of(conn, a.cn_id), "agent_calls": calls},
                         ensure_ascii=False, indent=2))
        return
    st = resume_case(case_of(conn, a.cn_id), a.approver, a.cmd, a.comment)
    print(f"{a.cn_id} → {st['approval']['status']}")
    print("给客户的回复:", st.get("reply", {}).get("customer_message", ""))


if __name__ == "__main__":
    main()
```

`show` 做了三件事：用 MCP 重新跑一遍 `recompute_invoice`,会话号设成 `approver:名字`,审计日志里和 Agent 的调用区分开；列出已有的审批记录；按案件号从审计日志里捞出 Agent 在这个案件里调过的全部工具。批准和驳回不直接改库，而是恢复暂停的图，让 `await_approval` 节点去调 `decide` 和 `issue`,这样状态、回复、审计都在一条路径上。

网页审批用的是同一套，给 Day 129 的服务挂上：

```python
# billsleuth/billsleuth/approval_api.py
"""Day 126 新增:审批的 HTTP 接口,Day 129 的 web.py 会把它挂上去。
审批人身份从请求头的令牌换出来,不信请求体里自报的名字。"""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from billsleuth import approval
from billsleuth.cases import resume_case
from billsleuth.db import connect

router = APIRouter(prefix="/api/approvals")


def approver(x_approver_token: str = Header(default="")) -> str:
    # APPROVER_TOKENS="alice:长随机串,bob:另一个长随机串"
    table = dict(p.split(":", 1) for p in os.environ.get("APPROVER_TOKENS", "").split(",") if ":" in p)
    for name, tok in table.items():
        if tok and tok == x_approver_token:
            return name
    raise HTTPException(401, "需要审批人令牌")


class Decision(BaseModel):
    decision: str  # approve | reject
    comment: str = ""


@router.get("")
def pending(who: str = Depends(approver)):
    with connect() as conn:
        rows = conn.execute("SELECT c.*, q.case_id FROM credit_notes c JOIN credit_note_requests q "
                            "ON q.credit_note_id = c.id WHERE c.status = 'draft' ORDER BY c.id").fetchall()
        return [{**dict(r), "approvals": approval.approvals_of(conn, r["id"]),
                 "needed": approval.approvals_needed(r["amount"])} for r in rows]


@router.post("/{cn_id}")
def decide(cn_id: str, body: Decision, who: str = Depends(approver)):
    with connect() as conn:
        r = conn.execute("SELECT case_id FROM credit_note_requests WHERE credit_note_id = ?", (cn_id,)).fetchone()
    if r is None:
        raise HTTPException(404, f"{cn_id} 不是调查案件起草的")
    try:
        st = resume_case(r["case_id"], who, body.decision, body.comment)
    except PermissionError as e:
        raise HTTPException(403, str(e)) from None
    except (LookupError, ValueError) as e:
        raise HTTPException(400, str(e)) from None
    return {"credit_note_id": cn_id, "status": st["approval"]["status"],
            "customer_message": (st.get("reply") or {}).get("customer_message", "")}
```

审批人身份从请求头的令牌换出来，不信请求体里的名字，否则谁都能写 `"approver": "alice"`。令牌放在环境变量 `APPROVER_TOKENS` 里，真实系统应该接公司的单点登录。

## 用真模型走一遍

我用 DeepSeek(`deepseek-flash`,关闭思考模式)开了两个案件：S017 是重复扣款，S001 是取消后仍开票。

```bash
uv run python -m billsleuth.cases S017 S001
```

```text
S017 → 案件 case-189d712e:结论 duplicate_charge 多收 123.60;贷记单 CN-0001 draft
S001 → 案件 case-f7e32e82:结论 cancel_not_respected 多收 174.90;贷记单 CN-0002 draft
```

两个案件的结论都和标准答案一致，图都停在审批节点，进程退出。然后换一个终端当主管：

```bash
uv run python -m billsleuth.approve list
```

```text
CN-0001  INV-0017-05     123.60  已批 0/1  案件 case-189d712e
CN-0002  INV-0001-05     174.90  已批 0/1  案件 case-f7e32e82
```

`show CN-0001` 里，系统重新复算的结果是这样(节选):`difference` 是 `0.00`,`reason` 是「金额与参考引擎一致」,`paid_total` 是 `247.20`,`successful_payments` 是 `2`。审批人一眼能看出来：发票本身没错，错在扣了两次。审计日志里这个案件的调用顺序是 `list_invoices → get_customer → list_payments → recompute_invoice → draft_credit_note`,最后一条是图里的代码起草的，不是模型。

批准 CN-0001,驳回 CN-0002:

```bash
uv run python -m billsleuth.approve approve CN-0001 --as alice -m "扣款记录核对过"
uv run python -m billsleuth.approve reject  CN-0002 --as alice -m "客户取消记录待客服确认"
```

S017 的客户版末尾多了一句「更正已审核通过，多收的 123.60 美元会退回原支付方式或抵扣下期账单。」S001 的客户版被整段换成了:「您好，我们复核了发票 INV-0001-05 的账单，需要账务同事再做一次人工核对。核对结果会在 1 个工作日内邮件告诉您，给您添麻烦了。」库里两张贷记单分别是 `issued` 和 `rejected`。

这时再让 bob 去批 CN-0001,`resume_case` 直接报错:「案件 case-189d712e 没有在等审批(当前位置：已结束)」。图已经走完，不会再恢复一次。

有一个坑是我自己踩的：开这两个案件时，Day 127 的评测正在后台跑，而案件写的是同一个 `billing.db`,评测的子进程也从这个库复制快照。后面开始的几个评测场景就带着这两张贷记单出发了。我停掉评测、重新 seed、把评测改成开始时先冻结一份母版库，才重新跑。演示、审批和评测，不要共用一个库文件。


## 测试

审批流的正常路径很好写，值钱的是边界。`tests/conftest.py` 新增了两个 fixture:整个测试会话只造一次种子库，每个测试复制一份。

```python
# billsleuth/tests/conftest.py
"""Day 126 新增:几个测试文件共用的种子库。每个测试一份干净副本。"""
import shutil

import pytest

from billsleuth import seed


@pytest.fixture(scope="session")
def seeded_db(tmp_path_factory):
    path = tmp_path_factory.mktemp("seed") / "master.db"
    mp = pytest.MonkeyPatch()
    mp.setenv("BILLSLEUTH_DB", str(path))
    seed.main()
    mp.undo()
    return path


@pytest.fixture
def billing_db(seeded_db, tmp_path, monkeypatch):
    path = tmp_path / "billing.db"
    shutil.copy(seeded_db, path)
    monkeypatch.setenv("BILLSLEUTH_DB", str(path))
    return path
```

```python
# billsleuth/tests/test_approval.py
"""Day 126:审批流的权限边界。前 7 个直接测函数,后 3 个走完整的图(假模型 + InMemorySaver)。"""
import threading

import pytest
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from billsleuth import approval
from billsleuth.db import connect
from billsleuth.explain import Explanation
from billsleuth.graph import Intake, build_graph
from billsleuth.mcp_bridge import BillingMCP
from billsleuth.server import draft_credit_note
from tests.test_graph import ScriptedLLM, call

ARGS = {"invoice_id": "INV-0001-05", "amount": "174.90", "reason": "订阅已到期取消,这张发票不应开出,全额冲正"}


def draft(key=None):
    return draft_credit_note(**ARGS, idempotency_key=key, case_id="case-t")


def count(status=None):
    with connect() as c:
        sql = "SELECT COUNT(*) FROM credit_notes" + (" WHERE status = ?" if status else "")
        return c.execute(sql, (status,) if status else ()).fetchone()[0]


def test_day123_dedup_is_not_enough_after_approval(billing_db):
    """Day 123 的去重只看 draft。草稿被批准后同一个请求再来一次:
    全额冲正会撞上额度校验报错(案件被误转人工),部分冲正会悄悄多出一张。"""
    first = draft()
    with connect() as c:
        approval.decide(c, first["credit_note_id"], "alice", "approve", "")
    with pytest.raises(Exception, match="超过了这张发票的实际扣款合计"):
        draft()
    part = {**ARGS, "invoice_id": "INV-0002-03"}
    with connect() as c:
        paid = c.execute("SELECT amount FROM payments WHERE invoice_id = ?", (part["invoice_id"],)).fetchone()[0]
    part["amount"] = "10.00"
    a = draft_credit_note(**part)
    with connect() as c:
        approval.decide(c, a["credit_note_id"], "alice", "approve", "")
    b = draft_credit_note(**part)
    assert b["credit_note_id"] != a["credit_note_id"] and float(paid) > 20  # 同一个请求,两张贷记单


def test_idempotency_key_survives_status_change(billing_db):
    first = draft("case-t:INV-0001-05:174.90")
    with connect() as c:
        approval.decide(c, first["credit_note_id"], "alice", "approve", "")
    again = draft("case-t:INV-0001-05:174.90")
    assert again["credit_note_id"] == first["credit_note_id"] and again["status"] == "approved"
    assert count() == 1


def test_concurrent_drafts_make_one(billing_db):
    got, errors = [], []

    def worker():
        try:
            got.append(draft("case-t:INV-0001-05:174.90")["credit_note_id"])
        except Exception as e:  # noqa: BLE001
            errors.append(e)

    ts = [threading.Thread(target=worker) for _ in range(8)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert not errors and len(set(got)) == 1 and count() == 1


def test_agent_and_same_person_cannot_approve(billing_db, monkeypatch):
    monkeypatch.setattr(approval, "TWO_PERSON_THRESHOLD", approval.Decimal("100.00"))  # 要两个人,第一个批完还是 draft
    cn = draft("k")["credit_note_id"]
    with connect() as c:
        with pytest.raises(PermissionError):
            approval.decide(c, cn, "agent", "approve", "")
        approval.decide(c, cn, "alice", "approve", "")
        with pytest.raises(PermissionError):
            approval.decide(c, cn, "alice", "approve", "")


def test_two_person_rule(billing_db, monkeypatch):
    monkeypatch.setattr(approval, "TWO_PERSON_THRESHOLD", approval.Decimal("100.00"))
    cn = draft("k")["credit_note_id"]
    with connect() as c:
        assert approval.decide(c, cn, "alice", "approve", "")["status"] == "draft"
        assert approval.decide(c, cn, "bob", "approve", "")["status"] == "approved"
        assert approval.issue(c, cn)["status"] == "issued"
        assert "无副作用" in approval.issue(c, cn)["note"]


def test_reject_needs_reason_and_blocks_issue(billing_db):
    cn = draft("k")["credit_note_id"]
    with connect() as c:
        with pytest.raises(ValueError):
            approval.decide(c, cn, "alice", "reject", "")
        approval.decide(c, cn, "alice", "reject", "取消记录待核实")
        with pytest.raises(PermissionError):
            approval.issue(c, cn)


def test_issue_rechecks_paid_total(billing_db):
    """两张草稿分别被批准:签发第二张时合计超过实际扣款,拦下。"""
    a = draft("k1")["credit_note_id"]
    with connect() as c:
        approval.decide(c, a, "alice", "approve", "")
        c.execute("INSERT INTO credit_notes VALUES ('CN-9999', 'INV-0001-05', '174.90', '人工补录的一张', 'approved')")
        c.commit()
        approval.issue(c, a)
        with pytest.raises(PermissionError, match="超过实际扣款"):
            approval.issue(c, "CN-9999")


SCRIPT = [
    AIMessage("", tool_calls=[call("recompute_invoice", {"invoice_id": "INV-0001-05"}, 1)]),
    AIMessage("", tool_calls=[call("SubmitFindings", {
        "root_cause": "cancel_not_respected", "invoice_ids": ["INV-0001-05"], "overcharge": "174.90",
        "expected_action": "credit_note", "reasoning": "该周期不应开票,实际扣款 174.90"}, 2)]),
]
GOOD = Explanation(customer_message="您好,这张发票多收了 174.90 美元 [E9]。已提交更正申请,审核通过后会退回或抵扣。",
                   internal_note="cancel_not_respected:多收 174.90 [E9]。")


def open_case():
    llm = ScriptedLLM(Intake(complaint="取消后仍扣款", amount="174.90", month=9), list(SCRIPT), explanation=GOOD)
    g = build_graph(llm=llm, mcp=BillingMCP(in_process=True), checkpointer=InMemorySaver())
    cfg = {"recursion_limit": 40, "configurable": {"thread_id": "case-test"}}
    g.invoke({"customer_id": "C-0001", "question": "我们早就取消了,怎么 9 月还扣了 174.90 美元?"}, cfg)
    return g, cfg, llm


def test_graph_pauses_with_one_draft_and_agent_never_sees_write_tool(billing_db):
    g, cfg, llm = open_case()
    st = g.get_state(cfg)
    assert st.next == ("await_approval",)
    assert st.values["approval"]["idempotency_key"] == "case-test:INV-0001-05:174.90"
    assert count("draft") == 1
    assert all("draft_credit_note" not in str(m) for m in llm.seen)  # 模型看到的工具表里没有写工具


def test_resume_reject_rewrites_customer_message(billing_db):
    g, cfg, _ = open_case()
    g.invoke(Command(resume={"approver": "alice", "decision": "reject", "comment": "取消记录待核实"}), cfg)
    v = g.get_state(cfg).values
    assert v["approval"]["status"] == "rejected" and count("rejected") == 1
    assert "退" not in v["reply"]["customer_message"]  # 驳回后不再提退款


def test_resume_approve_issues_once(billing_db):
    g, cfg, _ = open_case()
    g.invoke(Command(resume={"approver": "alice", "decision": "approve", "comment": ""}), cfg)
    v = g.get_state(cfg).values
    assert v["approval"]["status"] == "issued" and count("issued") == 1 and count() == 1
    assert g.get_state(cfg).next == ()


def test_cases_and_http_approval_resume_from_disk(billing_db, tmp_path, monkeypatch):
    """案件开在一个进程里、审批在另一个请求里:图从 checkpoints.db 恢复。"""
    from fastapi.testclient import TestClient

    from billsleuth import cases
    from billsleuth.web import app
    monkeypatch.setenv("BILLSLEUTH_CHECKPOINTS", str(tmp_path / "cp.db"))
    monkeypatch.setenv("APPROVER_TOKENS", "alice:tok-a")
    llm = ScriptedLLM(Intake(complaint="取消后仍扣款", amount="174.90", month=9), list(SCRIPT), explanation=GOOD)
    case_id, st = cases.open_case("C-0001", "9 月还扣了 174.90", llm=llm)
    cn = st["approval"]["credit_note_id"]
    cl = TestClient(app)
    assert cl.get("/api/approvals").status_code == 401
    assert [r["id"] for r in cl.get("/api/approvals", headers={"x-approver-token": "tok-a"}).json()] == [cn]
    r = cl.post(f"/api/approvals/{cn}", json={"decision": "approve"}, headers={"x-approver-token": "tok-a"})
    assert r.json()["status"] == "issued" and "更正已审核通过" in r.json()["customer_message"]
```

11 个测试，前 7 个直接测函数，后 4 个走完整的图。最后一个最接近真实用法：用 `cases.open_case` 在磁盘 checkpoint 上开案件，再通过 HTTP 接口用令牌审批，图从磁盘恢复，签发后客户版末尾多了「更正已审核通过」。`test_graph_pauses_with_one_draft_and_agent_never_sees_write_tool` 检查了模型收到的全部消息里都没有 `draft_credit_note` 这个名字。

`uv run pytest -q`,我这边 Day 121–125 原有的 230 个加上今天的，全部通过。

## 动手练习

1. 改 `schema.sql`(`rejected` 和两张新表),重新 `uv run python -m billsleuth.seed`。
2. 改 `server.py` 里的 `draft_credit_note`:加 `idempotency_key`、`case_id` 两个参数，加 `BEGIN IMMEDIATE` 事务。
3. 写 `approval.py`,在 `graph.py` 里加 `request_approval`、`await_approval` 两个节点和 `credit_target`。
4. `uv add langgraph-checkpoint-sqlite`,写 `cases.py`、`approve.py`、`approval_api.py`。
5. 写 `tests/conftest.py` 和 `tests/test_approval.py`,`uv run pytest -q` 全过。
6. 把 `draft_credit_note` 里的 `BEGIN IMMEDIATE` 换成 `BEGIN`,循环跑 10 次 `uv run pytest -q tests/test_approval.py -k concurrent`,记下挂了几次和报错，再改回来。
7. 用真模型开一个案件，用命令行走完 show → approve;再开一个，走 show → reject,对比两次的客户版。

**验收标准:**全部测试通过；第 6 步能复现 `database is locked` 并说清楚原因；第 7 步审计日志里能看到案件号和 `approver:名字` 两种会话号；Agent 的工具表里搜不到 `draft_credit_note`;驳回后的客户版里没有「退」字。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 贷记单(credit note) | 挂在已开发票上的负数凭证，表示这张发票有一部分不该收 |
| 作废重开(void and reissue) | 未付款的发票直接作废，按正确金额重开 |
| 幂等(idempotency) | 同一个请求执行一次和执行多次，结果一样 |
| 幂等键 | 识别「这是同一个请求」的键，本项目是 `案件号:发票号:金额` |
| BEGIN IMMEDIATE | SQLite 开事务时立即拿写锁，其他写事务要等它提交 |
| 四眼原则(two-person rule) | 高风险操作需要两个不同的人批准 |
| interrupt | LangGraph 暂停图执行、等外部输入的函数；恢复时所在节点从头重跑 |
| Command(resume=...) | 恢复暂停的图，并把值交给 `interrupt()` 作为返回值 |
| checkpointer / SqliteSaver | 保存图每一步状态的组件；SqliteSaver 存到 SQLite 文件，进程退出后还能恢复 |
| 案件号(case_id) | 调查图的 thread_id,也是审计日志里的会话号 |

## 常见误区

**让模型去起草贷记单。** 起草需要的参数在结论之后都已经有了，而且校验过。再让模型调一次工具，只是多一个把金额写错、把发票挑错的机会。

**以为「已有草稿就返回」就是幂等。** 它只看 draft,草稿被批准以后再来一次就漏了。幂等要按请求的身份判断，不按记录当前的状态判断。

**让模型生成幂等键。** 模型不记得上次传过什么，重放时会生成新键。键要从业务字段推出来。

**先查后插，不加锁。** 单线程测试里永远是对的，并发时就会出两张。

**在 interrupt 之前做有副作用的事。** 恢复时节点从头重跑,`interrupt()` 之前的代码会执行两次。把副作用放到前一个节点。

**用 InMemorySaver 做审批。** 进程一退，暂停的图就没了，主管第二天来批时找不到案件。

**把 Agent 的结论给审批人看。** 写得有道理的话很容易被批。给他看系统重新复算的结果和审计日志。

**驳回了就不管客户。** 财务上不用回滚，但客户版里「审核通过后会退回」那句话要收回来。

## 学习资料

### 文档与文章

- [Stripe · Idempotent requests](https://docs.stripe.com/api/idempotent_requests):Stripe 的幂等键规则，重点看「同一个键、参数却不一样」时怎么处理，15 分钟。
- [Brandur Leach · Implementing Stripe-like Idempotency Keys in Postgres](https://brandur.org/idempotency-keys):讲幂等最好的一篇长文，把请求拆成多个原子阶段、每阶段记恢复点，1 小时。读完你会明白我们这个单事务版本省略了什么。
- [Stripe · Credit notes](https://docs.stripe.com/invoicing/dashboard/credit-notes):贷记单的业务语义，20 分钟。
- [LangGraph · Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts):interrupt 的用法，以及「恢复时节点从头执行」,读完就明白为什么起草要单独一个节点，20 分钟。
- [SQLite · BEGIN TRANSACTION](https://www.sqlite.org/lang_transaction.html):DEFERRED、IMMEDIATE、EXCLUSIVE 三种事务的区别，10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1CXarehE8k&autoplay=0&high_quality=1" title="跪求兄弟们了，写接口一定要支持幂等呀！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员知正 · 跪求兄弟们了，写接口一定要支持幂等呀!· 12 分钟，从重复下单讲到 token、唯一索引、状态机几种做法，对应今天的幂等键和带状态条件的更新。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1fykHY6EAF&autoplay=0&high_quality=1" title="LangGraph Interrupt:Human-In-The-Loop 人机交互手到擒来！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>沧海九粟 · LangGraph Interrupt:Human-In-The-Loop 人机交互手到擒来!· 22 分钟，演示 interrupt 暂停和 Command 恢复，正好是今天审批节点的写法。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/m6DtqSb1BDM" title="Build a robust Payments service using Idempotency Keys" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Arpit Bhayani · Build a robust Payments service using Idempotency Keys · 用支付服务讲幂等键的完整设计，键存在哪、过期多久、并发怎么处理，英文。</figcaption>
</figure>

- LangChain 官方《LangGraph interrupt: Making it easier to build human-in-the-loop agents》(YouTube `6t7YJcEFUIY`):官方讲 interrupt 设计动机的短视频。

### 书籍

- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly, 2017;中文版《数据密集型应用系统设计》,中国电力出版社，2018):第 7 章「事务」讲隔离级别和写偏斜，读完你会明白为什么要 `BEGIN IMMEDIATE` 和带状态条件的 UPDATE;第 11 章提到的幂等和「恰好一次」也值得看。

### 开源项目与代码

- [brandur/rocket-rides-atomic](https://github.com/brandur/rocket-rides-atomic):上面那篇长文的配套代码，看幂等键表和原子阶段的实现，30 分钟。
- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):搜 `interrupt` 和 `SqliteSaver`,看暂停和持久化是怎么实现的。

## 自测

1. 为什么起草贷记单由代码完成，而不是把 `draft_credit_note` 放进模型的工具表？

<details><summary>答案</summary>

起草需要的发票号、金额、原因在 conclude 之后都已经有了：金额是过了 overcharge_is_grounded 的结论值，原因来自结论，发票号可以由证据决定。让模型再调一次工具只会多出错的机会(金额格式、挑错发票、同一轮调两次),而且模型工具表里一旦有写工具，提示词注入之类的攻击就多了一个目标。

</details>

2. Day 123 的「同一张发票已有 draft 就返回」为什么不够？举一个它漏掉的顺序。

<details><summary>答案</summary>

它只看 draft 状态。顺序：起草 → 主管批准(状态变 approved)→ 起草那一步因为重放、重试或人工重跑又执行了一次。这时没有 draft 状态的草稿，去重不生效。全额冲正时会撞上额度检查报错，案件被误转人工；部分冲正时会多出一张。幂等键按请求身份判断，不看记录当前状态，就能挡住。

</details>

3. `request_approval` 和 `await_approval` 为什么要分成两个节点？

<details><summary>答案</summary>

`interrupt()` 恢复时，所在节点会从头再执行一遍，`interrupt()` 之前的代码会执行两次。如果起草和暂停在同一个节点，每次恢复都会再起草一次。分成两个节点，起草只执行一次，恢复时只重跑审批节点。幂等键是第二道保险。

</details>

4. S023 是重复开票，结论里写了原发票和多开的那张。贷记单该开在哪张？代码怎么决定？

<details><summary>答案</summary>

开在多开的那张(INV-0023-04D),原发票是正常的。`credit_target` 先在证据里找「多收」类、值等于结论金额、来源在结论发票列表里的那条，用它的发票号；找不到才用结论里的最后一张。

</details>

5. 资深面试题：你们的退款 Agent 用 LangGraph 实现，审批节点用 interrupt 暂停。上线一个月后发现偶尔同一个工单有两张一样的退款草稿。你怎么排查，怎么修？

<details><summary>答案</summary>

排查：用审计日志和 trace 找出重复的那几单，看两张草稿的创建时间间隔和前后事件。重点怀疑三个来源:interrupt 恢复时节点从头执行而起草在 interrupt 之前；模型在同一轮里并行调了两次；超时重试。修法：起草本身做幂等，键从业务字段(工单、发票、金额)推出，不依赖模型或执行次数；查键和插入放在同一个事务里加锁，或用唯一约束加 ON CONFLICT;把有副作用的调用挪到 interrupt 之前的独立节点；最好让代码而不是模型去起草。然后补并发测试和「恢复后重放」测试进回归集，加监控：同一工单同一发票出现两张非 rejected 贷记单就告警。取舍上要说明，键里带金额会让「改金额」产生新草稿，这是有意的，靠审批人兜底。

</details>

6. 贷记单被驳回以后，系统做了什么、没做什么？

<details><summary>答案</summary>

没做：财务回滚，因为钱没动，贷记单停在 rejected。做了：保留被驳回的记录和必填的驳回原因；把客户版整段换成不带金额、不提退款的说明(复核了、账务同事跟进、多久回复);审计日志里能查到谁在什么时候驳回。驳回原因收集起来做错误分析。

</details>

## 明天预告

到今天,BillSleuth 已经能查、能解释、能起草、能等人批了。但它到底准不准？在几个手挑的场景上跑通不算数。明天(Day 127)做 **100 个场景的评测与模拟客户**:用一个会着急、会记错数字、会追问的 LLM 扮演客户，按根因、多收金额、发票号、动作、数字幻觉、误冲正几个指标打分，每题跑多次算 pass^k,每个比例带上置信区间。顺便回答 Day 124 留下的问题：S023 的结论多写了原发票号，算不算对。
