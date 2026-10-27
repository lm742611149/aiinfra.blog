---
title: 'Day 691 · BillSleuth(十一):幂等键、审批签发、图在审批节点暂停'
description: '先用 Day 683 的老代码证明「已有草稿就返回」挡不住批准之后的重放:同一个请求发两次,贷记单变两张。加上幂等键和 BEGIN IMMEDIATE,用 8 个线程并发实测:普通 BEGIN 十轮里有五轮 database is locked。再让调查图在审批节点用 interrupt 暂停,checkpoint 存进磁盘,审批人隔天用命令行批,图接着跑。写测试时抓出两个 bug,用真模型跑案件时又发现 credit_target 在重复开票上选错了发票。'
pubDate: 2026-10-27
regime: none
tags: ['billsleuth', 'idempotency', 'human-in-the-loop', 'langgraph', 'agent-zero']
series: 'agent-zero'
day: 691
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 690](/blog/agent-zero/day-690-bs-credit-1/) 讲了三种冲正方式,决定由代码而不是模型来起草贷记单,写出了 `credit.py`(`credit_target` 和 `draft_args`);又把贷记单的生命周期写成一张 4×3 的状态机表 `RULES`,在 `approval.py` 里实现了 `decide` 和 `issue`,12 个格子逐个用测试钉死,323 条测试全绿。

但那是「单子在库里怎么变」。还没有谁真的起草过一张,没有图会停下来等人批,审批人也没有地方去批。今天把这些接上:先让起草本身经得住重放和并发,再让调查图在审批节点停下,最后用真模型和命令行走一遍。

## 今天要解决的问题

1. 用 Day 683 的老代码做一个实验,证明「已有草稿就返回」挡不住批准之后的重放;加上幂等键,再用 8 个线程并发实测 `BEGIN` 和 `BEGIN IMMEDIATE` 的区别。
2. 给调查图接上 `request_approval` 和 `await_approval` 两个节点,用 `interrupt` 暂停、`Command(resume=...)` 恢复,说清为什么起草和暂停必须是两个节点。
3. 用 `SqliteSaver` 把暂停的图存到磁盘,写 `cases.py`(开案件、恢复案件)和 `approve.py`(审批命令行),用真模型开 5 个案件,审批人用命令行批、驳回。
4. 看真实证据链把 Day 690 的 `credit_target` 打脸一次,修掉它,并说清楚为什么「代码不替人选」是对的。

预计用时 4 小时,项目日偏长。前置:[Day 690](/blog/agent-zero/day-690-bs-credit-1/)(`approval.py`、`credit.py`、`db.immediate`)、[Day 689](/blog/agent-zero/day-689-bs-grounded-2/)(`write_up`、`reply["fallback"]`)、[Day 687](/blog/agent-zero/day-687-bs-run/)(`ScriptedLLM`)、[Day 683](/blog/agent-zero/day-683-bs-tools/)(`draft_credit_note`、审计日志)、[Day 319](/blog/agent-zero/day-319-lg-interrupt/)(`interrupt` 和 `Command(resume)`)、[Day 322](/blog/agent-zero/day-322-lg-time-travel/)(checkpoint 历史)。真模型约 ¥0.33,算式在「今天的文件」。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `request_approval` 和 `await_approval` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 概念一:幂等键

### Day 683 的去重为什么不够

Day 683 给 `draft_credit_note` 写过一条去重规则:同一张发票已经有 `status='draft'` 的草稿,就直接返回那张。它挡住了最常见的情况,模型在同一轮里调两次。但它只看 `draft`。

想一下这个顺序:图起草了一张草稿,暂停;主管批准了,状态变成 `approved`;这时候因为某种原因,起草那一步又执行了一次。去重规则一看,这张发票没有 `draft` 状态的草稿了,于是继续往下走。

「某种原因」在 Agent 系统里比想象的多。

| 来源 | 怎么发生的 |
| --- | --- |
| 流程重放 | LangGraph 从 checkpoint 恢复时,被中断的那个节点会从头再执行一遍 |
| 超时重试 | 工具执行成功了,但返回前连接断了,调用方以为失败又调一次 |
| 客户追问 | 模拟客户会追问,第二轮调查又走到起草这一步 |
| 人工重跑 | 同事觉得结论不对,手动把案件重跑一遍 |

不用猜,用 Day 683 的老代码直接复现。下面的脚本在库的临时副本上跑,不动 `billing.db`:

```python
# billsleuth/scratch/dedupe_gap.py  Day 683 的「已有草稿就返回」:草稿被批准之后,同一个请求再来一次会怎样
import os
import shutil
import tempfile

from billsleuth import approval
from billsleuth.db import ROOT, connect
from billsleuth.server import draft_credit_note

tmp = tempfile.mkdtemp()                       # 在临时目录里用库的副本,不动 billing.db
shutil.copy(ROOT / "billing.db", f"{tmp}/b.db")
os.environ["BILLSLEUTH_DB"] = f"{tmp}/b.db"
REASON = "订阅已到期取消,这张发票不应开出,全额冲正"


def approve(cn_id: str) -> None:
    with connect() as c:
        approval.decide(c, cn_id, "alice", "approve", "")


def show(tag: str, r: dict) -> None:
    print(f"  {tag}:{r['credit_note_id']} {r['amount']} {r['status']}  {r['note']}")


for label, inv, amount in [("部分冲正", "INV-0002-03", "10.00"), ("全额冲正", "INV-0001-05", "174.90")]:
    print(f"--- {label}:同一个请求({inv}, {amount})发两次,中间批准了一次")
    a = draft_credit_note(inv, amount, REASON)
    show("第一次", a)
    approve(a["credit_note_id"])
    show("第二次", draft_credit_note(inv, amount, REASON))
with connect() as c:
    rows = c.execute("SELECT invoice_id, SUM(amount) FROM credit_notes GROUP BY 1").fetchall()
print("贷记合计 vs 实际扣款:", [(r[0], r[1]) for r in rows])
shutil.rmtree(tmp)
```

<div class="line-notes">

- `shutil.copy(ROOT / "billing.db", f"{tmp}/b.db")` 先把库复制到临时目录,下面所有的写入都落在副本上。
- `os.environ["BILLSLEUTH_DB"] = f"{tmp}/b.db"` `connect()` 读这个变量,设在 import 之后也来得及,因为 `db_path()` 每次调用才去读。
- `def approve(cn_id: str) -> None:` 用 Day 690 的 `decide` 模拟「主管批准了」,名字是 `alice`。
- `def show(tag: str, r: dict) -> None:` 把返回的 `credit_note_id`、金额、状态、说明打成一行。
- `for label, inv, amount in [("部分冲正", "INV-0002-03", "10.00"), ("全额冲正", "INV-0001-05", "174.90")]:` 两种情况:`INV-0002-03` 实际扣款 1650.06,冲 10.00 是部分冲正;`INV-0001-05` 实际扣款 174.90,冲 174.90 是全额。
- `a = draft_credit_note(inv, amount, REASON)` 第一次起草。
- `approve(a["credit_note_id"])` 中间批准了一次,状态从 `draft` 变 `approved`。
- `show("第二次", draft_credit_note(inv, amount, REASON))` 同一个请求再来一次,和第一次的参数一模一样。
- `rows = c.execute("SELECT invoice_id, SUM(amount) FROM credit_notes GROUP BY 1").fetchall()` 最后按发票汇总贷记金额。SQLite 里金额存的是文本,`SUM` 会转成浮点,这里只是打印看看,不参与计算。

</div>

```bash
cd /Users/你/billsleuth
uv run python -m scratch.dedupe_gap
```

```text
--- 部分冲正:同一个请求(INV-0002-03, 10.00)发两次,中间批准了一次
  第一次:CN-0001 10.00 draft  已生成草稿,等待人工审批后才会签发
  第二次:CN-0002 10.00 draft  已生成草稿,等待人工审批后才会签发
--- 全额冲正:同一个请求(INV-0001-05, 174.90)发两次,中间批准了一次
  第一次:CN-0003 174.90 draft  已生成草稿,等待人工审批后才会签发
  第二次:CN-0004 174.90 draft  已生成草稿,等待人工审批后才会签发
贷记合计 vs 实际扣款: [('INV-0001-05', 349.8), ('INV-0002-03', 20.0)]
```

同一个请求,两张贷记单。更糟的是全额那一组:174.90 的发票上贷记了 349.8,是实际扣款的两倍,Day 683 的额度检查只比较「这次的金额」和「实际扣款」,完全没看已经批准过的那一张。两张草稿如果都被批准、都签发,钱就多退了一倍。

### 幂等键

幂等(idempotency)的意思是:同一个请求执行一次和执行多次,结果一样。修法是加一个显式的**幂等键**,`案件号:发票号:金额`,例如 `case-4bcd4a9c:INV-0017-05:123.60`。同一个键,不管那张贷记单后来变成了什么状态,都返回原来那张。

几个设计选择:

- **键由调用方的代码生成,不让模型生成。** 模型不记得自己上次传过什么,重放时会生成一个新键。图的 `request_approval` 节点从配置里拿 `thread_id` 当案件号,重放时拿到的还是同一个。
- **键里带金额。** 同一个案件第一次结论是 13.93,后来发现应该是 25.87,键不同,就是另一个请求。
- **光有键还不够,查键和插入之间有竞争窗口。** 两个请求同时进来,都查到「键不存在」,都去插入。所以「查键、查额度、插草稿」要放进同一把写锁里,这就是 Day 690 的 `immediate` 的用处。

先给库加一张表,存键、案件号和它对应的贷记单:

```sql
-- billsleuth/billsleuth/schema.sql(Day 691 追加在文件末尾)
-- Day 691 追加:幂等键。同一个案件、同一张发票、同一金额只起草一张
CREATE TABLE credit_note_requests (
    idempotency_key TEXT PRIMARY KEY,   -- 案件号:发票号:金额
    case_id TEXT NOT NULL,              -- 调查图的 thread_id,审批时靠它找到暂停的那张图
    credit_note_id TEXT NOT NULL REFERENCES credit_notes(id),
    created_at TEXT NOT NULL
);
```

<div class="line-notes">

- `idempotency_key TEXT PRIMARY KEY,` 主键,所以数据库自己保证键唯一:就算代码里的检查有漏洞,第二次 `INSERT` 同一个键会直接报 `UNIQUE constraint failed`。这是第二道保险,第一道是下面的事务里先查后写。
- `case_id TEXT NOT NULL,` 键里已经有案件号了,为什么还单存一列?因为审批命令行要「按贷记单号找案件号」,存一列比从字符串里切方便,也不怕以后键的格式变。
- `credit_note_id TEXT NOT NULL REFERENCES credit_notes(id),` 外键指向它起草出来的那张。
- `created_at TEXT NOT NULL` 起草时间,UTC。

</div>

改了建表,重新造库:`uv run python -m billsleuth.seed`。然后改 `draft_credit_note`,在 Day 683 的基础上加了两个可选参数、一个事务,额度检查改成「已批准和已签发的加上这次」:

```python
# billsleuth/billsleuth/server.py(Day 691:替换 Day 683 的 draft_credit_note;文件开头 from billsleuth.db import 那行补上 immediate)
@mcp.tool(annotations=DRAFT_ONLY)
@audited
def draft_credit_note(
    invoice_id: Annotated[str, Field(description="要冲正的发票号", pattern=INVOICE_ID)],
    amount: Annotated[str, Field(description="冲正金额,字符串,两位小数,如 \"23.40\"", pattern=r"^\d+\.\d{2}$")],
    reason: Annotated[str, Field(min_length=10, max_length=300, description="冲正原因,写清根因和算式")],
    idempotency_key: Annotated[str | None, Field(description="Day 691 新增:由调用方的代码生成,形如 案件号:发票号:金额")] = None,
    case_id: Annotated[str | None, Field(description="Day 691 新增:调查图的 thread_id,审批时用来恢复")] = None,
) -> CreditNoteOut:
    """为多收的钱起草一张贷记单(credit note)。只生成 draft,不会退款,签发要人工审批。
    同一张发票已有草稿时直接返回那张草稿,不会重复创建。
    带 idempotency_key 时:同一个键无论草稿后来被批准、签发还是驳回,都返回原来那张。"""
    amt = money(amount)
    if amt <= 0:
        raise ToolError("冲正金额必须大于 0。")
    conn = db()
    try:
        with immediate(conn):    # 查键、查额度、插草稿在同一把写锁里,并发的第二个请求在这里排队
            if idempotency_key:
                hit = conn.execute("SELECT c.* FROM credit_note_requests r JOIN credit_notes c ON c.id = r.credit_note_id "
                                   "WHERE r.idempotency_key = ?", (idempotency_key,)).fetchone()
                if hit:
                    return CreditNoteOut(credit_note_id=hit["id"], invoice_id=hit["invoice_id"], amount=hit["amount"],
                                         status=hit["status"], note="同一个幂等键已经起草过,返回原来那张")
            must_invoice(conn, invoice_id)
            paid = sum((Decimal(p["amount"]) for p in conn.execute(
                "SELECT amount FROM payments WHERE invoice_id = ? AND status = 'succeeded'", (invoice_id,))), ZERO)
            existing = conn.execute("SELECT * FROM credit_notes WHERE invoice_id = ? AND status = 'draft'",
                                    (invoice_id,)).fetchone()
            if existing:
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
    finally:
        conn.close()
    return CreditNoteOut(credit_note_id=cn_id, invoice_id=invoice_id, amount=fmt(amt), status="draft",
                         note="已生成草稿,等待人工审批后才会签发")
```

<div class="line-notes">

- `idempotency_key: Annotated[str | None, Field(description="Day 691 新增:由调用方的代码生成,形如 案件号:发票号:金额")] = None,` 新增的可选参数,默认 `None`。Day 683 的测试和 Inspector 里的手动调用不传它,照样能用,走的是老逻辑。
- `case_id: Annotated[str | None, Field(description="Day 691 新增:调查图的 thread_id,审批时用来恢复")] = None,` 同上。MCP 的工具清单里会多出这两个参数,但模型看不到这个工具,没有影响。
- `amt = money(amount)` 字符串转 `Decimal`,Day 680 的规矩。
- `conn = db()` 自己管连接,因为下面的 `immediate` 要接管事务。
- `with immediate(conn):` 一进来就拿写锁。并发的第二个请求在这里排队,等第一个提交了才能进来,它读到的就是第一个写完以后的库。
- `if idempotency_key:` 带键才走幂等分支。
- `hit = conn.execute("SELECT c.* FROM credit_note_requests r JOIN credit_notes c ON c.id = r.credit_note_id "` 用键查出以前起草的那张贷记单,连同它**现在**的状态。
- `return CreditNoteOut(credit_note_id=hit["id"], invoice_id=hit["invoice_id"], amount=hit["amount"],` 命中就直接返回,状态可能是 `draft`、`approved`、`issued`、`rejected` 任何一个,不重新起草。从 `with` 块里 `return` 会正常提交事务(这时什么也没改)。
- `must_invoice(conn, invoice_id)` Day 683 的老检查:发票存在。
- `existing = conn.execute("SELECT * FROM credit_notes WHERE invoice_id = ? AND status = 'draft'",` Day 683 的老规则还留着。没带键的调用(比如 Inspector 里手动试)仍受它保护。
- `credited = sum((Decimal(r["amount"]) for r in conn.execute(` 这张发票上已批准、已签发的贷记合计,草稿和驳回的不算。
- `if amt + credited > paid:` 今天改的额度检查。比如实际扣款 174.90,已批准了 174.90,这次又要冲 174.90,合计 349.80 大于 174.90,报错。这样 `dedupe_gap` 里那个「翻倍」不会再出现。
- `conn.execute("INSERT INTO credit_notes VALUES (?,?,?,?,?)", (cn_id, invoice_id, amt, reason, "draft"))` 插草稿。
- `conn.execute("INSERT INTO credit_note_requests VALUES (?,?,?,?)",` 和草稿在同一个事务里插键,要么都在,要么都不在。
- `finally:` 无论成败都关连接。

</div>

### 并发:为什么非要 IMMEDIATE

Day 690 说「为什么用 `BEGIN IMMEDIATE` 明天讲」。用一个实验讲:8 个线程同时起草同一张贷记单,同一个幂等键。分别用普通 `BEGIN` 和 `BEGIN IMMEDIATE`,各跑 10 轮。普通 `BEGIN` 是延迟事务:开始时不拿任何锁,先读(拿共享锁),等到第一次写才想升级成写锁。

```python
# billsleuth/scratch/lock_experiment.py  8 个线程同时起草同一张贷记单:普通 BEGIN 和 BEGIN IMMEDIATE 各跑 10 轮,数一数出了什么事
import os
import shutil
import tempfile
import threading
from contextlib import contextmanager

from billsleuth import server
from billsleuth.db import ROOT, connect, immediate

REASON = "订阅已到期取消,这张发票不应开出,全额冲正"


@contextmanager
def deferred(conn):
    """和 immediate 一样,只是开事务用普通 BEGIN:先拿读锁,第一次写的时候才想升级成写锁。"""
    conn.isolation_level = None
    conn.execute("BEGIN")
    try:
        yield conn
        conn.execute("COMMIT")
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise


def one_round(tmp: str) -> tuple[int, int, set[str]]:
    shutil.copy(ROOT / "billing.db", f"{tmp}/b.db")
    os.environ["BILLSLEUTH_DB"] = f"{tmp}/b.db"
    errors: list[str] = []

    def worker() -> None:
        try:
            server.draft_credit_note("INV-0001-05", "174.90", REASON, idempotency_key="case-x:INV-0001-05:174.90")
        except Exception as e:  # noqa: BLE001
            errors.append(f"{type(e).__name__}: {str(e)[:60]}")

    threads = [threading.Thread(target=worker) for _ in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    with connect() as c:
        n = c.execute("SELECT COUNT(*) FROM credit_notes").fetchone()[0]
    return n, len(errors), set(errors)


if __name__ == "__main__":
    tmp = tempfile.mkdtemp()
    for name, impl in [("普通 BEGIN", deferred), ("BEGIN IMMEDIATE", immediate)]:
        server.immediate = impl
        rounds = [one_round(tmp) for _ in range(10)]
        msgs = set().union(*(r[2] for r in rounds))
        print(f"{name:<16} 10 轮里报错的轮数 {sum(1 for r in rounds if r[1])},"
              f"多出贷记单的轮数 {sum(1 for r in rounds if r[0] > 1)},每轮贷记单数 {[r[0] for r in rounds]}")
        for m in sorted(msgs):
            print("    报错:", m)
    shutil.rmtree(tmp)
```

<div class="line-notes">

- `from billsleuth import server` 这里导入整个 `server` 模块,为了下面能换掉它里面的 `immediate`。
- `@contextmanager` 和 Day 690 的 `immediate` 一样,是个带 `yield` 的函数。
- `def deferred(conn):` 和 `immediate` 完全一样,只有一处不同。
- `conn.execute("BEGIN")` 普通 `BEGIN`,延迟事务。
- `def one_round(tmp: str) -> tuple[int, int, set[str]]:` 一轮:造一份干净的库副本,起 8 个线程同时起草,返回(最后库里有几张贷记单,几个线程报错,报错内容)。
- `shutil.copy(ROOT / "billing.db", f"{tmp}/b.db")` 每一轮开始前恢复一份干净的库。
- `server.draft_credit_note("INV-0001-05", "174.90", REASON, idempotency_key="case-x:INV-0001-05:174.90")` 8 个线程用的是同一个键,期望结果是库里只有 1 张。
- `threads = [threading.Thread(target=worker) for _ in range(8)]` 8 个线程。
- `[t.start() for t in threads]` 几乎同时启动。
- `[t.join() for t in threads]` 等全部结束。
- `server.immediate = impl` 直接把 `server` 模块里的 `immediate` 换成要试的那个实现,`draft_credit_note` 运行时才去查这个名字,所以换了就生效。
- `rounds = [one_round(tmp) for _ in range(10)]` 每种实现跑 10 轮。

</div>

```bash
uv run python -m scratch.lock_experiment
```

```text
普通 BEGIN         10 轮里报错的轮数 5,多出贷记单的轮数 0,每轮贷记单数 [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    报错: OperationalError: database is locked
BEGIN IMMEDIATE  10 轮里报错的轮数 0,多出贷记单的轮数 0,每轮贷记单数 [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
```

两点要看。一,普通 `BEGIN` 十轮里有五轮报错,全是 `database is locked`:两个线程都读完了、都想把共享锁升级成写锁,谁也等不到谁,SQLite 检测到这种死锁会立刻返回 busy,`busy_timeout` 设多长都没用。`BEGIN IMMEDIATE` 一开始就拿写锁,其他线程在入口排队,0 轮报错。二,两种实现「多出贷记单的轮数」都是 0,因为 `idempotency_key` 是主键,第二次插入同一个键数据库直接拒绝,这是前面说的第二道保险。所以并发在这里造成的是**报错**,不是多出一张;换个没有唯一约束的设计,表现可能就是静悄悄地多出一张。线程数换成 2 和 16 再试(练习 1),报错的轮数每次都不一样,并发 bug 不是每次都能复现,这类测试要一直留在套件里。

### 测试

```python
# billsleuth/tests/test_draft.py  draft_credit_note 的幂等:同一个请求不管重来几次、中间批准过没有,都只有一张
import threading

import pytest

from billsleuth import approval
from billsleuth.db import connect
from billsleuth.server import draft_credit_note

ARGS = {"invoice_id": "INV-0001-05", "amount": "174.90", "reason": "订阅已到期取消,这张发票不应开出,全额冲正"}
KEY = "case-t:INV-0001-05:174.90"


@pytest.fixture(autouse=True)
def _db(fresh_db):
    """本文件每条测试都用一份干净的库。"""


def draft(key=None, **over):
    return draft_credit_note(**{**ARGS, **over}, idempotency_key=key, case_id="case-t")


def count() -> int:
    with connect() as c:
        return c.execute("SELECT COUNT(*) FROM credit_notes").fetchone()[0]


def approve(cn_id: str) -> None:
    with connect() as c:
        approval.decide(c, cn_id, "alice", "approve", "")


def test_old_dedup_misses_after_approval_when_no_key():
    """没带幂等键走老路径:草稿批准之后同一个请求再来,只剩额度检查能拦。部分冲正会多出一张。"""
    a = draft(amount="10.00")
    approve(a["credit_note_id"])
    b = draft(amount="10.00")
    assert b["credit_note_id"] != a["credit_note_id"] and count() == 2


def test_key_returns_same_note_after_any_status_change():
    first = draft(KEY)
    approve(first["credit_note_id"])
    again = draft(KEY)
    assert again["credit_note_id"] == first["credit_note_id"] and again["status"] == "approved" and count() == 1


def test_key_returns_same_note_after_reject():
    first = draft(KEY)
    with connect() as c:
        approval.decide(c, first["credit_note_id"], "alice", "reject", "待核实")
    again = draft(KEY)
    assert again["credit_note_id"] == first["credit_note_id"] and again["status"] == "rejected"


def test_new_amount_while_a_draft_is_open_returns_that_draft():
    """键里带着金额,金额变了就是另一个请求;但这张发票还有一张没处理的草稿,Day 683 那条规则照样生效,返回旧草稿。"""
    a = draft("case-t:INV-0002-03:10.00", invoice_id="INV-0002-03", amount="10.00")
    b = draft("case-t:INV-0002-03:25.87", invoice_id="INV-0002-03", amount="25.87")
    assert b["credit_note_id"] == a["credit_note_id"] and "已有草稿" in b["note"] and count() == 1


def test_new_amount_after_rejection_makes_a_new_draft():
    a = draft("case-t:INV-0002-03:10.00", invoice_id="INV-0002-03", amount="10.00")
    with connect() as c:
        approval.decide(c, a["credit_note_id"], "alice", "reject", "金额待复核")
    b = draft("case-t:INV-0002-03:25.87", invoice_id="INV-0002-03", amount="25.87")
    assert b["credit_note_id"] != a["credit_note_id"] and b["amount"] == "25.87" and count() == 2


def test_quota_counts_approved_notes():
    """批准过的全额贷记单已经占满额度,不带键的第二个请求要报错,而不是再开一张。"""
    first = draft()
    approve(first["credit_note_id"])
    with pytest.raises(Exception, match="超过了这张发票的实际扣款合计"):
        draft()


def test_concurrent_drafts_make_one():
    got, errors = [], []

    def worker():
        try:
            got.append(draft(KEY)["credit_note_id"])
        except Exception as e:  # noqa: BLE001
            errors.append(e)

    ts = [threading.Thread(target=worker) for _ in range(8)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert not errors and len(set(got)) == 1 and count() == 1


def test_request_row_records_case_id():
    cn = draft(KEY)["credit_note_id"]
    with connect() as c:
        r = c.execute("SELECT * FROM credit_note_requests WHERE idempotency_key = ?", (KEY,)).fetchone()
    assert r["credit_note_id"] == cn and r["case_id"] == "case-t"
```

<div class="line-notes">

- `ARGS = {"invoice_id": "INV-0001-05", "amount": "174.90", "reason": "订阅已到期取消,这张发票不应开出,全额冲正"}` 所有测试共用的请求参数。
- `KEY = "case-t:INV-0001-05:174.90"` 对应的幂等键。
- `def draft(key=None, **over):` 小封装:可以带键、可以覆盖任何参数。比如 `draft(KEY)` 是带键的全额请求,`draft(amount="10.00")` 是不带键的部分冲正。
- `def test_old_dedup_misses_after_approval_when_no_key():` 没带键走老路径:这条测试是把前面的实验固定下来,证明「不带键」的老行为还在,所以以后调用方一定要带键。
- `assert b["credit_note_id"] != a["credit_note_id"] and count() == 2` 部分冲正时,同一个请求批准后再来,确实多出一张。
- `def test_key_returns_same_note_after_any_status_change():` 批准以后再用同一个键,返回原来那张,状态是 `approved`,库里只有 1 张。
- `def test_key_returns_same_note_after_reject():` 驳回以后同样。
- `def test_new_amount_while_a_draft_is_open_returns_that_draft():` 键里有金额,金额变了是另一个请求,但这张发票上还有一张没处理的草稿,Day 683 的规则照样生效,返回旧草稿。两层保护叠在一起。
- `def test_new_amount_after_rejection_makes_a_new_draft():` 旧草稿被驳回以后,换金额的请求才真的产生新草稿。
- `def test_quota_counts_approved_notes():` 批准过的全额贷记单已经占满额度,不带键的第二个请求要报错。
- `ts = [threading.Thread(target=worker) for _ in range(8)]` 8 个线程并发,断言没有报错、只有一个贷记单号、库里 1 张。
- `def test_request_row_records_case_id():` 键对应的那一行里,案件号和贷记单号都对。

</div>

```bash
uv run pytest tests/test_draft.py -q
```

```text
........                                                                 [100%]
8 passed in 1.00s
```

## 概念二:图在审批节点暂停

### 先想清楚为什么是两个节点

LangGraph 的 `interrupt()` 让图停在某个节点里,状态存进 checkpoint([Day 319](/blog/agent-zero/day-319-lg-interrupt/) 讲过)。恢复时,**这个节点会从头再执行一遍**,执行到 `interrupt()` 那一行时直接返回恢复的值。所以 `interrupt()` 之前的代码会执行两次。

如果把「起草」放在 `await_approval` 里、`interrupt()` 之前,每次恢复都会再起草一次。幂等键能挡住,但没必要让它去挡。分成两个节点:起草只在 `request_approval` 里执行一次,恢复时只重跑 `await_approval`。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="调查图新增部分:write_up 之后按结论分流;账没错或已转人工结束;要冲正进 request_approval 由代码起草;起草失败结束;成功进 await_approval 在 interrupt 处暂停,恢复后 decide 和 issue,还差一人则回到自己再等,否则结束">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
  <rect x="15" y="100" width="90" height="44" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="60" y="127" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">write_up</text>
  <line x1="105" y1="122" x2="150" y2="122" stroke="var(--ink-soft)" marker-end="url(#a691)"/>
  <rect x="155" y="95" width="130" height="54" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="220" y="118" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">request_approval</text>
  <text x="220" y="136" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">代码起草,只跑一次</text>
  <line x1="285" y1="122" x2="335" y2="122" stroke="var(--ink-soft)" marker-end="url(#a691)"/>
  <rect x="340" y="95" width="140" height="54" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="410" y="118" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">await_approval</text>
  <text x="410" y="136" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">interrupt:暂停等人</text>
  <path d="M440 95 C 440 55, 380 55, 380 93" fill="none" stroke="var(--compute)" marker-end="url(#a691)"/>
  <text x="330" y="48" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">还差一个人 / 批错了:接着等</text>
  <line x1="480" y1="122" x2="540" y2="122" stroke="var(--ink-soft)" marker-end="url(#a691)"/>
  <rect x="545" y="100" width="80" height="44" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="585" y="127" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">END</text>
  <line x1="60" y1="144" x2="60" y2="195" stroke="var(--ink-faint)"/>
  <line x1="60" y1="195" x2="585" y2="195" stroke="var(--ink-faint)" stroke-dasharray="4 4"/>
  <line x1="585" y1="195" x2="585" y2="146" stroke="var(--ink-faint)" marker-end="url(#a691)"/>
  <text x="70" y="212" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">账没错、已转人工:直接结束</text>
  <line x1="220" y1="149" x2="220" y2="195" stroke="var(--ink-faint)"/>
  <text x="230" y="180" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">起草不成(无证据、兜底、超额度):转人工结束</text>
  <text x="20" y="240" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">没有 checkpointer:图到 write_up 为止,和 Day 689 一样</text>
  <defs><marker id="a691" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>三条分岔都在条件边里:`after_write_up`、`after_request`、`after_approval`。`interrupt` 需要 checkpointer,没有它就没有审批分支。</figcaption>
</figure>

### 接进 graph.py

先在文件开头补三行 import(`RunnableConfig`、`interrupt`、`approval`、`draft_args`、`connect`),`CaseState` 里加一个字段 `approval: dict`。然后把 `build_graph` 里 `g.add_edge("write_up", END)` 那一行换成下面这一整段:

```python
# billsleuth/billsleuth/graph.py(Day 691:build_graph 里,把 write_up 后面原来的 g.add_edge("write_up", END) 换成下面这一整段)
    # ---------- Day 691 新增:代码起草贷记单,图暂停等人批 ----------

    def after_write_up(state: CaseState) -> Literal["request_approval", "__end__"]:
        f = state.get("findings") or {}
        if state.get("escalated") or f.get("expected_action") != "credit_note":
            return "__end__"
        return "request_approval"

    def request_approval(state: CaseState, config: RunnableConfig) -> dict:
        """代码起草:金额只能是过了溯源检查的结论值,发票由证据决定,幂等键由案件号推出。"""
        f, case_id = state.get("findings") or {}, config.get("configurable", {})["thread_id"]
        if (state.get("reply") or {}).get("fallback"):  # 解释是模板兜底出来的:先让人看,不自动起草
            return {"escalated": True, "approval": {"status": "blocked", "error": "解释由模板兜底,转人工"}}
        args = draft_args(f, state.get("evidence", []))
        if args is None:
            return {"escalated": True, "approval": {"status": "blocked", "error": "没有证据能说明贷记单该开在哪张发票上"}}
        key = f"{case_id}:{args['invoice_id']}:{args['amount']}"
        ok, data = mcp.call("draft_credit_note", {**args, "idempotency_key": key, "case_id": case_id})
        if not ok:  # 比如金额超过实际扣款:不硬冲,转人工
            return {"escalated": True, "approval": {"status": "blocked", "error": data, "invoice_id": args["invoice_id"]}}
        return {"approval": {**data, "idempotency_key": key, "needed": approval.approvals_needed(data["amount"]),
                             "decisions": []}}

    def after_request(state: CaseState) -> Literal["await_approval", "__end__"]:
        return "__end__" if (state.get("approval") or {}).get("status") == "blocked" else "await_approval"  # 没起草成,就没有可等的东西

    def await_approval(state: CaseState) -> dict:
        """图在这里暂停。恢复时传 {"approver", "decision", "comment"}。
        恢复时这个节点会从头再执行一遍,所以起草放在上一个节点,这里只做审批。"""
        a = state.get("approval") or {}
        resume = interrupt({"credit_note_id": a["credit_note_id"], "invoice_id": a["invoice_id"],
                            "amount": a["amount"], "needed": a["needed"], "decided": len(a["decisions"]),
                            "reasoning": (state.get("findings") or {}).get("reasoning", "")})
        conn = connect()
        try:
            try:
                out = approval.decide(conn, a["credit_note_id"], resume.get("approver", ""), resume.get("decision", ""),
                                      resume.get("comment", ""))
            except (PermissionError, ValueError) as e:
                # 审批人的错(同一个人批两次、Agent 冒充、驳回没写原因)不能在节点里抛出去:
                # 抛了以后这条决定会被当成「已经交给 interrupt 的恢复值」存进 checkpoint,下一个人来批时被重放
                return {"approval": {**a, "error": str(e)}}
            if out["status"] == "approved":
                try:
                    out = approval.issue(conn, a["credit_note_id"])
                except PermissionError as e:  # 批准了但签发被额度检查拦下:停在 approved,转人工
                    return {"escalated": True, "approval": {**a, "status": "approved", "error": str(e),
                                                            "decisions": a["decisions"] + [resume]}}
        finally:
            conn.close()
        reply = dict(state.get("reply") or {})
        if out["status"] == "rejected":
            reply["customer_message"] = approval.rejected_message((state.get("findings") or {}).get("invoice_ids", []))
        elif out["status"] == "issued":
            reply["customer_message"] = reply.get("customer_message", "").rstrip() + "\n\n" + approval.approved_note(a["amount"])
        return {"approval": {**a, "status": out["status"], "error": None, "decisions": a["decisions"] + [resume]}, "reply": reply}

    def after_approval(state: CaseState) -> Literal["await_approval", "__end__"]:
        return "await_approval" if (state.get("approval") or {}).get("status") == "draft" else "__end__"  # 还差一个人,或上一个人批错了,接着等

    if checkpointer is None:
        g.add_edge("write_up", END)      # 没有 checkpointer 图就没法暂停:到 write_up 为止,和 Day 689 一样
    else:
        g.add_node("request_approval", request_approval)
        g.add_node("await_approval", await_approval)
        g.add_conditional_edges("write_up", after_write_up, ["request_approval", END])
        g.add_conditional_edges("request_approval", after_request, ["await_approval", END])
        g.add_conditional_edges("await_approval", after_approval, ["await_approval", END])
```

<div class="line-notes">

- `def after_write_up(state: CaseState) -> Literal["request_approval", "__end__"]:` 条件边的路由函数:`write_up` 之后去哪。
- `if state.get("escalated") or f.get("expected_action") != "credit_note":` 已经转人工的(比如溯源检查没过),或者结论说账没错的,直接结束。这是 Day 690 说的「误冲正」的第一道闸。
- `def request_approval(state: CaseState, config: RunnableConfig) -> dict:` 节点函数可以多收一个 `config` 参数,里面有 `thread_id`。
- `f, case_id = state.get("findings") or {}, config.get("configurable", {})["thread_id"]` 案件号取自 `thread_id`:重放时同一个案件拿到的是同一个值,所以键稳定。
- `if (state.get("reply") or {}).get("fallback"):` Day 689 留下的伏笔:解释是模板兜底出来的,意味着模型三稿都没写出合格的解释,这个案件不该自动进入起草。
- `return {"escalated": True, "approval": {"status": "blocked", "error": "解释由模板兜底,转人工"}}` 用 `status = "blocked"` 记下卡在这里,`escalated` 置位,让外层知道要人来看。
- `args = draft_args(f, state.get("evidence", []))` Day 690 的 `credit.py`。
- `if args is None:` 账没错,或者证据撑不住「开在哪张发票上」。后一种明天看真实案例。
- `key = f"{case_id}:{args['invoice_id']}:{args['amount']}"` 比如 `case-55918414:INV-0017-05:123.60`。
- `ok, data = mcp.call("draft_credit_note", {**args, "idempotency_key": key, "case_id": case_id})` 通过同一个 MCP 桥调工具,审计日志、参数校验、额度检查和 Day 683 一样,调用方从模型换成了代码。
- `if not ok:` 工具报错,比如超过实际扣款:不硬冲,转人工。
- `return {"approval": {**data, "idempotency_key": key, "needed": approval.approvals_needed(data["amount"]),` 状态里存下贷记单号、金额、需要几个人批。
- `def after_request(state: CaseState) -> Literal["await_approval", "__end__"]:` 起草成功才去等审批。这个函数是写测试时才发现缺的,下面讲。
- `def await_approval(state: CaseState) -> dict:` 暂停和恢复都在这个节点。
- `resume = interrupt({"credit_note_id": a["credit_note_id"], "invoice_id": a["invoice_id"],` 第一次执行到这里,图暂停,这个字典是给审批界面的展示内容。恢复后再执行到这里,`interrupt()` 直接返回审批人交进来的 `{"approver", "decision", "comment"}`。
- `out = approval.decide(conn, a["credit_note_id"], resume.get("approver", ""), resume.get("decision", ""),` 调 Day 690 的 `decide`。
- `except (PermissionError, ValueError) as e:` 审批人的错在这里接住,不往外抛。为什么,下面有实验。
- `return {"approval": {**a, "error": str(e)}}` 状态不变,只记一条 `error`。因为状态还是 `draft`,`after_approval` 会让图回到 `await_approval` 再暂停一次。
- `if out["status"] == "approved":` 够人数批准了。
- `out = approval.issue(conn, a["credit_note_id"])` 批准以后图自己接着签发,没有单独的「签发人」。
- `except PermissionError as e:  # 批准了但签发被额度检查拦下:停在 approved,转人工` 签发时额度检查没过,单子停在 `approved`,图结束并标记转人工。钱没出去。
- `reply["customer_message"] = approval.rejected_message(` 驳回:客户版整段换成 Day 690 的 `rejected_message`。
- `elif out["status"] == "issued":` 批准并签发:在客户版末尾加一句 `approved_note`。
- `def after_approval(state: CaseState) -> Literal["await_approval", "__end__"]:` 状态还是 `draft` 就回到自己再等。两人审批要等第二个人,第一个人批错了也是回到这里。
- `if checkpointer is None:` 没有 checkpointer 图就没法暂停,所以老测试和 `run.py` 不传 checkpointer 时,图到 `write_up` 为止,和 Day 689 完全一样。
- `g.add_node("request_approval", request_approval)` 新节点只在有 checkpointer 时才加。Day 686 的 `test_graph_shape` 检查的是没有 checkpointer 的图的节点集合,所以它不用改。
- `g.add_conditional_edges("await_approval", after_approval, ["await_approval", END])` 条件边的第三个参数列出可能的去向,用来画图和检查。

</div>

### 写测试时抓出的两个 bug

上面这一段是改过两次的结果。第一版的两处写法,是我一边写测试一边发现不对的。

**第一处,起草不成,图还是去了 `await_approval`。** 第一版里我写的是无条件的 `g.add_edge("request_approval", "await_approval")`。`request_approval` 在「兜底」「没证据」「超额度」时返回 `approval.status = "blocked"`,里面没有 `credit_note_id`,图却照样进 `await_approval`:

```text
    def await_approval(state: CaseState) -> dict:
        a = state["approval"]
>       resume = interrupt({"credit_note_id": a["credit_note_id"], "invoice_id": a["invoice_id"],
                                              ^^^^^^^^^^^^^^^^^^^
E       KeyError: 'credit_note_id'
E       During task with name 'await_approval' and id 'dc30c1c2-d7cc-767b-dfe4-a1bdb87dc1c3'

FAILED tests/test_approval_flow.py::test_two_person_case_waits_for_the_second_person
FAILED tests/test_approval_flow.py::test_template_fallback_is_not_drafted - K...
FAILED tests/test_approval_flow.py::test_no_supporting_evidence_means_no_draft
3 failed, 15 passed in 6.25s
```

三条红:两条是这个 `KeyError`,第三条是下面的问题。修法就是 `after_request` 那个条件边。要是没有「兜底不起草」「没证据不起草」这两条测试,这个 bug 会一直藏到线上第一次遇到兜底的案件。

**第二处,审批人批错了,抛出异常,下一个人就批不进去了。** 第一版的 `await_approval` 没有那个 `try ... except`,`decide` 抛出的 `PermissionError` 直接往外冒。测试 `test_two_person_case_waits_for_the_second_person` 是这样写的:alice 批了一次,alice 又批一次(应该被拦),然后 bob 批。bob 那一步红了,报的错居然是「alice 已经审过这张」。

这个现象值得单独复现一下,因为它不是我代码里的 if 写错了:

```python
# billsleuth/scratch/poison_resume.py  审批节点里抛了错以后,图还能不能收下下一个人的决定
import os
import shutil
import tempfile

from langchain_core.runnables import RunnableConfig
from langgraph.types import Command

from billsleuth import approval
from billsleuth.db import ROOT
from tests.test_approval_flow import QUESTION, SCRIPT
from tests.test_graph import INTAKE, ScriptedLLM

from langgraph.checkpoint.memory import InMemorySaver

from billsleuth.graph import build_graph
from billsleuth.mcp_bridge import BillingMCP

tmp = tempfile.mkdtemp()
shutil.copy(ROOT / "billing.db", f"{tmp}/b.db")
os.environ["BILLSLEUTH_DB"] = f"{tmp}/b.db"
approval.TWO_PERSON_THRESHOLD = approval.Decimal("100.00")
g = build_graph(llm=ScriptedLLM(INTAKE, list(SCRIPT)), mcp=BillingMCP(in_process=True), checkpointer=InMemorySaver())
cfg: RunnableConfig = {"recursion_limit": 40, "configurable": {"thread_id": "case-p"}}
g.invoke({"customer_id": "C-0001", "question": QUESTION}, cfg)


def resume(who: str) -> None:
    try:
        g.invoke(Command(resume={"approver": who, "decision": "approve", "comment": ""}), cfg)
        print(f"{who} 批准 → 图在 {g.get_state(cfg).next or '结束'}")
    except Exception as e:  # noqa: BLE001
        print(f"{who} 批准 → {type(e).__name__}: {e}")


resume("alice")
resume("alice")   # 同一个人再批,节点里抛 PermissionError
resume("bob")     # 真正的第二个人
shutil.rmtree(tmp)
```

<div class="line-notes">

- `approval.TWO_PERSON_THRESHOLD = approval.Decimal("100.00")` 把门槛降到 100,174.90 的单子要两个人批。
- `g = build_graph(llm=ScriptedLLM(INTAKE, list(SCRIPT)), mcp=BillingMCP(in_process=True), checkpointer=InMemorySaver())` 假模型加内存里的 checkpointer,不花钱。
- `g.invoke({"customer_id": "C-0001", "question": QUESTION}, cfg)` 开案件,图停在 `await_approval`。
- `g.invoke(Command(resume={"approver": who, "decision": "approve", "comment": ""}), cfg)` 恢复:把审批人的决定交给暂停的 `interrupt()`。
- `except Exception as e:  # noqa: BLE001` 把节点里抛的错接住,打印出来,脚本继续往下走。
- `resume("alice")` 第一个人批准,金额要两个人,所以图仍在等。
- `resume("alice")   # 同一个人再批,节点里抛 PermissionError` 第二次用同一个名字。
- `resume("bob")     # 真正的第二个人` 看第二个人能不能批进去。

</div>

用第一版(节点里不接异常)跑:

```text
alice 批准 → 图在 ('await_approval',)
alice 批准 → PermissionError: alice 已经审过这张,需要另一个人
bob 批准 → PermissionError: alice 已经审过这张,需要另一个人
```

bob 明明是新的审批人,收到的却是 alice 的错。原因:节点抛错失败时,LangGraph 会把已经交给 `interrupt()` 的恢复值存进 checkpoint(因为那是用户给的输入,不该丢),下一次恢复时,重新执行这个节点,`interrupt()` 直接读到存下来的那个值,也就是 alice 的决定,bob 交进去的新值没有用上。

教训有两条。**审批人的操作错误不能在节点里抛出去**,要接住,变成状态里的一条 `error`,让图正常结束这一次节点执行、再回来等下一个人。也就是上面 `await_approval` 里的 `try ... except (PermissionError, ValueError)`。**图里的节点函数不能把用户输入错误当成程序异常。** 程序异常(比如数据库坏了)才应该抛,抛了要靠人修。

改完以后同一个脚本:

```text
alice 批准 → 图在 ('await_approval',)
alice 批准 → 图在 ('await_approval',)
bob 批准 → 图在 结束
```

第二行不再抛错,图在原地继续等,`approval.error` 里记着「alice 已经审过这张」;bob 的批准正常进来,图结束。

### cases.py:把案件存到磁盘

`InMemorySaver` 只在一个进程里有效,进程退出,暂停的图就没了。真实的审批可能隔天才做,所以要把 checkpoint 存到磁盘:

```bash
uv add langgraph-checkpoint-sqlite
```

(2026 年 10 月查到最新版 3.1.2。)

```python
# billsleuth/billsleuth/cases.py  用磁盘上的 checkpointer 跑案件:调查停在审批节点,进程可以退出,审批人隔天再来
"""开案件:uv run python -m billsleuth.cases S017 S001"""
import json
import os
import sqlite3
import sys
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from langchain_core.runnables import RunnableConfig
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


def cfg(case_id: str) -> RunnableConfig:
    return {"recursion_limit": 60, "configurable": {"thread_id": case_id}}


def open_case(customer_id: str, question: str, llm=None) -> tuple[str, dict]:
    case_id = "case-" + uuid.uuid4().hex[:8]
    os.environ["BILLSLEUTH_SESSION"] = case_id  # 审计日志里的 session_id 就是案件号
    with case_graph(llm) as g:
        g.invoke({"customer_id": customer_id, "question": question}, cfg(case_id))
        return case_id, g.get_state(cfg(case_id)).values


def resume_case(case_id: str, approver: str, decision: str, comment: str = "", llm=None) -> dict:
    """审批人的决定交给暂停的图。图里的 await_approval 节点去调 approval.decide / issue。"""
    with case_graph(llm) as g:
        state = g.get_state(cfg(case_id))
        if "await_approval" not in state.next:
            raise LookupError(f"案件 {case_id} 没有在等审批(当前位置:{state.next or '已结束'})")
        g.invoke(Command(resume={"approver": approver, "decision": decision, "comment": comment}), cfg(case_id))
        return g.get_state(cfg(case_id)).values


if __name__ == "__main__":
    for sid in sys.argv[1:]:
        sc = json.loads((ROOT / "scenarios" / f"{sid}.json").read_text(encoding="utf-8"))
        cid, st = open_case(sc["customer_id"], sc["question"])
        a, f = st.get("approval") or {}, st.get("findings") or {}
        print(f"{sid} → 案件 {cid}:结论 {f.get('root_cause')} 多收 {f.get('overcharge')};"
              f"贷记单 {a.get('credit_note_id', '无')} {a.get('status', '')}{'  转人工' if st.get('escalated') else ''}")
```

<div class="line-notes">

- `def checkpoints_path() -> Path:` checkpoint 存在 `checkpoints.db`,和计费库 `billing.db` 分开:一个是业务数据,一个是 Agent 的运行状态,备份和清理的规矩都不一样。
- `@contextmanager` 又一个带 `yield` 的函数,这里用来保证用完关连接。
- `def case_graph(llm=None) -> Iterator:` 每次用的时候现开一个连接、现建一个图。开案件和审批可能在不同进程里,所以不缓存图对象。
- `conn = sqlite3.connect(checkpoints_path(), check_same_thread=False)` `check_same_thread=False`:LangGraph 可能在别的线程里用这个连接,SQLite 默认只许创建它的线程用。
- `yield build_graph(llm=llm, mcp=BillingMCP(in_process=True), checkpointer=SqliteSaver(conn))` 传了 `checkpointer`,审批分支才会被加进图。
- `def cfg(case_id: str) -> RunnableConfig:` `thread_id` 就是案件号,`recursion_limit` 是 60 步。
- `case_id = "case-" + uuid.uuid4().hex[:8]` 比如 `case-55918414`。
- `os.environ["BILLSLEUTH_SESSION"] = case_id  # 审计日志里的 session_id 就是案件号` Day 683 的 `audited` 从这个环境变量读会话号。所以日志里这个案件的每次工具调用都带着案件号,包括代码起草的那一次。
- `g.invoke({"customer_id": customer_id, "question": question}, cfg(case_id))` 跑到暂停为止。
- `def resume_case(case_id: str, approver: str, decision: str, comment: str = "", llm=None) -> dict:` 审批人的决定交给暂停的图。
- `if "await_approval" not in state.next:` 先确认这个案件确实停在审批节点。已经结束的案件(批过了、驳回了)再批会走到这里,报「没有在等审批」。
- `g.invoke(Command(resume={"approver": approver, "decision": decision, "comment": comment}), cfg(case_id))` 恢复:`Command(resume=...)` 里的字典就是 `interrupt()` 的返回值。
- `cid, st = open_case(sc["customer_id"], sc["question"])` 命令行入口:从场景文件里读客户号和原话,开案件。
- `print(f"{sid} → 案件 {cid}:结论 {f.get('root_cause')} 多收 {f.get('overcharge')};"` 打印一行摘要。

</div>

### approve.py:审批命令行

审批界面最常见的错误设计,是把 Agent 的结论原样摆给审批人:「Agent 说多收了 174.90,批不批?」审批人看了一眼觉得合理,点了批准,审批就成了橡皮图章。审批人应该看的是**证据**,而且是**系统重新取的证据**:

```python
# billsleuth/billsleuth/approve.py  审批命令行。审批人看到的是系统重新复算的证据,不是 Agent 写的结论
"""
uv run python -m billsleuth.approve list
uv run python -m billsleuth.approve show CN-0001
uv run python -m billsleuth.approve approve CN-0001 --as alice [-m 备注]
uv run python -m billsleuth.approve reject  CN-0001 --as alice -m 原因
"""
import argparse
import json
import os
import sqlite3

from billsleuth import approval
from billsleuth.cases import resume_case
from billsleuth.db import connect
from billsleuth.mcp_bridge import BillingMCP


def case_of(conn: sqlite3.Connection, cn_id: str) -> str:
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
        keep = ("invoice_id", "expected_total", "actual_total", "difference", "reason", "paid_total", "successful_payments")
        print(json.dumps({"credit_note": cn, "recompute": {k: proof.get(k) for k in keep} if ok else {"error": proof},
                          "approvals": approval.approvals_of(conn, a.cn_id), "agent_calls": calls},
                         ensure_ascii=False, indent=2))
        return
    try:
        st = resume_case(case_of(conn, a.cn_id), a.approver, a.cmd, a.comment)
    except LookupError as e:     # 案件已经结束:说人话,不甩一屏 Traceback
        raise SystemExit(f"没有生效:{e}") from None
    print(f"{a.cn_id} → {st['approval']['status']}")
    if st["approval"].get("error"):
        print("没有生效:", st["approval"]["error"])
    print("给客户的回复:", st.get("reply", {}).get("customer_message", ""))


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `def case_of(conn: sqlite3.Connection, cn_id: str) -> str:` 贷记单号到案件号,查的是 `credit_note_requests` 那张表。这就是前面为什么单存一列 `case_id`。
- `raise SystemExit(f"{cn_id} 不是由调查案件起草的,找不到要恢复的图")` 手工建的贷记单没有案件号,没法走命令行审批。`SystemExit` 带字符串会把它打印到 stderr 并以非零状态码退出。
- `ap.add_argument("--as", dest="approver", default="")` 审批人的名字。真实系统里应该是登录身份,不是自己填;网页版会用令牌换出来。
- `for r in conn.execute("SELECT c.*, q.case_id FROM credit_notes c JOIN credit_note_requests q "` `list` 列出所有等审批的草稿。
- `print(f"{r['id']}  {r['invoice_id']}  {r['amount']:>9}  已批 {n}/{approval.approvals_needed(r['amount'])}"` 已批几个、需要几个,一眼看出还差谁。
- `os.environ["BILLSLEUTH_SESSION"] = f"approver:{a.approver or 'unknown'}"  # 审计里和 Agent 的调用区分开` `show` 要重新复算一次,会话号设成 `approver:alice`,审计日志里和 Agent 的调用分得开。
- `ok, proof = BillingMCP(in_process=True).call("recompute_invoice", {"invoice_id": cn["invoice_id"]})` 系统重新复算这张发票,而不是读 Agent 的结论。
- `calls = [dict(r) for r in conn.execute(` 按案件号从审计日志里捞出 Agent 在这个案件里调过的全部工具。
- `keep = ("invoice_id", "expected_total", "actual_total", "difference", "reason", "paid_total", "successful_payments")` 复算结果里只留审批人最需要看的七项。
- `st = resume_case(case_of(conn, a.cn_id), a.approver, a.cmd, a.comment)` 批准和驳回不直接改库,而是恢复暂停的图,让 `await_approval` 节点去调 `decide` 和 `issue`。这样状态、客户回复、审计都在一条路径上。
- `if st["approval"].get("error"):` 批错了(同一个人、Agent 名字、驳回没写原因),图没有抛错,`error` 里有原因,命令行把它打印出来。

</div>

## 用真模型走一遍

我用 DeepSeek(`deepseek-flash`,关闭思考模式)开 4 个案件:S017 重复扣款、S001 取消后仍开票、S023 重复开票、S003 账没错。命令行里先 `rm -f checkpoints.db` 再重新 `seed`,保证从干净的状态开始:

```bash
uv run python -m billsleuth.cases S017 S001 S023 S003
```

```text
S017 → 案件 case-4bcd4a9c:结论 duplicate_charge 多收 123.60;贷记单 CN-0001 draft
S001 → 案件 case-2f6a2383:结论 cancel_not_respected 多收 174.90;贷记单 CN-0002 draft
S023 → 案件 case-dccd5505:结论 duplicate_invoice 多收 139.05;贷记单 CN-0003 draft
S003 → 案件 case-b77a8259:结论 no_error 多收 0.00;贷记单 无
```

三个案件停在了审批节点,S003 账没错,没有进审批。换一个终端当主管,先看 S023 那张,它是第三张,`CN-0003`:

```bash
uv run python -m billsleuth.approve show CN-0003 --as alice
```

输出很长,摘出审批人最该看的部分:

```text
"credit_note": {"id": "CN-0003", "invoice_id": "INV-0023-04", "amount": "139.05",
                "reason": "duplicate_invoice:9 月周期 2026-09-15~2026-10-15 存在两张内容完全相同的发票 INV-0023-04 与 INV-0023-04D ... ", "status": "draft"}
"recompute": {"invoice_id": "INV-0023-04", "expected_total": "139.05", "actual_total": "139.05",
              "difference": "0.00", "reason": "这个周期还有其他发票:INV-0023-04D,可能重复开票",
              "paid_total": "139.05", "successful_payments": 1}
```

贷记单开在了 `INV-0023-04`,金额 139.05。系统重新复算:这张发票本身没有多收(`difference` 是 0.00),只扣了一笔,真正重复的是它的孪生兄弟 `INV-0023-04D`。**这张贷记单开错了发票。** 如果审批人只看 Agent 的结论和起草时的原因,「重复开票,多收 139.05」听着完全合理,很可能就批了。这就是审批人要看系统重新复算证据的原因。

### 为什么选错了

回头看 `credit_target` 是怎么选的。这个案件模型的结论是 `invoice_ids = ['INV-0023-04', 'INV-0023-04D']`、多收 139.05。证据链里:`INV-0023-04D` 的「多收(实际 - 应收)」是 0.00,`INV-0023-04` 的也是 0.00,因为两张发票各自单独复算都没错,重复是两张之间的关系。第一条规则「多收证据等于结论金额」两张都找不到。于是落到第二条规则:「扣款」证据值等于结论金额。`INV-0023-04` 有一笔 139.05 的扣款,`INV-0023-04D` 也有一笔 139.05,两张都满足,`for` 循环按编号从小到大扫,先碰到 `INV-0023-04`,就返回了它。

问题在第二条规则太松:它不看这是不是「重复扣款」。重复扣款的特征是**同一张发票成功扣了两笔以上**;而 S023 的两张发票各自只扣了一笔。更根本的问题:这里的证据对两张发票完全对称,连开票时间、扣款时间都一样(`PAY-0023-04` 和 `PAY-0023-04D` 都是 2026-09-15T02:00:00),没有任何数据能说明哪张是「多出来的那张」。选哪张是业务判断,不该由代码来猜,更不该靠 `for` 循环的顺序来决定。

修法有两处,都在 `credit.py`:

```python
# billsleuth/billsleuth/credit.py  谁来起草:贷记单开在哪张发票、写什么原因、什么情况下不起草,全由代码决定
"""模型只给结论(根因、发票号、多收金额)。从结论到「一张贷记单草稿」这几步没有模型参与。"""


def credit_target(findings: dict, evidence: list[dict]) -> str | None:
    """贷记单开在哪张发票上。结论里的发票号可能有好几张。只认能唯一确定的,否则返回 None,交给人。
    1. 某张发票有「多收」证据,值正好等于结论金额;
    2. 重复扣款:发票本身没错,是同一张发票成功扣了两笔以上,其中一笔的金额等于结论金额。"""
    over, ids = findings["overcharge"], findings["invoice_ids"]
    hit = {e["source_ref"] for e in evidence if e["source_ref"] in ids and e["value"] == over and "多收" in e["claim"]}
    if not hit and findings.get("root_cause") == "duplicate_charge":
        pays = [e for e in evidence if e["claim"].startswith("扣款") and "succeeded" in e["claim"] and e["source_ref"] in ids]
        hit = {e["source_ref"] for e in pays
               if e["value"] == over and sum(1 for p in pays if p["source_ref"] == e["source_ref"]) >= 2}
    return next(iter(hit)) if len(hit) == 1 else None


def draft_args(findings: dict, evidence: list[dict]) -> dict | None:
    """起草需要的三个参数。不该起草(账没错、证据撑不住)返回 None。"""
    if findings.get("expected_action") != "credit_note":
        return None
    invoice_id = credit_target(findings, evidence)
    if invoice_id is None:
        return None
    reason = f"{findings['root_cause']}:{findings.get('reasoning', '')}"[:300].ljust(10, "。")
    return {"invoice_id": invoice_id, "amount": findings["overcharge"], "reason": reason}
```

<div class="line-notes">

- `hit = {e["source_ref"] for e in evidence if e["source_ref"] in ids and e["value"] == over and "多收" in e["claim"]}` 第一条规则改成收集一个集合,而不是返回第一个命中的。如果两张发票都有「多收」证据等于结论金额,`hit` 里有两个元素。
- `if not hit and findings.get("root_cause") == "duplicate_charge":` 第二条规则现在只在根因判的就是重复扣款时才用,不再是兜底。
- `pays = [e for e in evidence if e["claim"].startswith("扣款") and "succeeded" in e["claim"] and e["source_ref"] in ids]` 只取结论里这几张发票名下、成功的扣款。
- `if e["value"] == over and sum(1 for p in pays if p["source_ref"] == e["source_ref"]) >= 2}` 金额匹配,并且这张发票成功的扣款至少有两笔。S017 的 `INV-0017-05` 有两笔 123.60,满足;S023 的每张发票只有一笔,不满足。
- `return next(iter(hit)) if len(hit) == 1 else None` 只在**恰好一张**满足时才返回。零张、两张都返回 `None`。`next(iter(hit))` 是从只有一个元素的集合里取出那个元素。

</div>

测试补上这几种情况(替换 Day 690 的 `test_duplicate_charge_falls_back_to_payment_evidence`,并新增三条):

```python
# billsleuth/tests/test_credit.py(Day 691:替换第二条规则的测试,新增三条)
DUP_CHARGE = {**FINDINGS, "root_cause": "duplicate_charge", "invoice_ids": ["INV-0017-05"], "overcharge": "123.60"}


def test_duplicate_charge_uses_payment_evidence_when_two_payments_succeeded():
    evidence = [ev(1, "INV-0017-05 多收(实际 - 应收)", "INV-0017-05", "0.00"),
                ev(2, "扣款 PAY-17(succeeded,2026-09-14T02:00:00+00:00)", "INV-0017-05", "123.60"),
                ev(3, "扣款 PAY-17-R(succeeded,2026-09-14T02:03:00+00:00)", "INV-0017-05", "123.60")]
    assert credit_target(DUP_CHARGE, evidence) == "INV-0017-05"


def test_one_payment_is_not_a_duplicate_charge():
    evidence = [ev(2, "扣款 PAY-17(succeeded,2026-09-14T02:00:00+00:00)", "INV-0017-05", "123.60")]
    assert credit_target(DUP_CHARGE, evidence) is None


def test_failed_payment_does_not_count():
    evidence = [ev(2, "扣款 PAY-17(succeeded,2026-09-14T02:00:00+00:00)", "INV-0017-05", "123.60"),
                ev(3, "扣款 PAY-17-R(failed,2026-09-14T02:03:00+00:00)", "INV-0017-05", "123.60")]
    assert credit_target(DUP_CHARGE, evidence) is None


def test_two_equally_supported_invoices_means_no_target():
    """重复开票:两张一模一样的发票,证据都撑得住,哪张是多出来的是业务判断,代码不替人选。"""
    evidence = [ev(1, "INV-0023-04 多收(实际 - 应收)", "INV-0023-04", "139.05"),
                ev(2, "INV-0023-04D 多收(实际 - 应收)", "INV-0023-04D", "139.05")]
    assert credit_target(FINDINGS, evidence) is None
```

<div class="line-notes">

- `DUP_CHARGE = {**FINDINGS, "root_cause": "duplicate_charge", "invoice_ids": ["INV-0017-05"], "overcharge": "123.60"}` 复用 `FINDINGS` 的其余字段,只改这三项。`{**a, ...}` 相当于 JS 里的 `{...a, ...}`。
- `ev(3, "扣款 PAY-17-R(succeeded,2026-09-14T02:03:00+00:00)", "INV-0017-05", "123.60")]` 同一张发票第二笔成功的扣款,相隔 3 分钟,和 S017 的真实数据一样。
- `def test_one_payment_is_not_a_duplicate_charge():` 只有一笔,哪怕根因被模型判成了重复扣款,代码也不认。
- `def test_failed_payment_does_not_count():` 第二笔是 `failed`,没有拿到钱,不能算成两笔。
- `def test_two_equally_supported_invoices_means_no_target():` 两张都有「多收」证据等于 139.05,`len(hit) == 2`,返回 `None`。

</div>

另外 Day 690 的 `test_every_scenario_gets_the_right_target` 要改:重复开票的 7 个场景现在应该是 `None`:

```python
        if truth["expected_action"] == "explain_only" or truth["root_cause"] == "duplicate_invoice":
            assert args is None, sid
```

这一改要老实记下:Day 690 在理想证据链上是 80/80,现在 73/73 加 7 个明确留给人的。**数字变小了,系统变好了**,因为那 7 个里原来有不少是「蒙对的」。

修好以后重新 `seed`、清掉 `checkpoints.db`、再开 5 个案件,加一个 S024(444.14,要两个人批):

```bash
rm -f checkpoints.db && uv run python -m billsleuth.seed
uv run python -m billsleuth.cases S017 S001 S023 S003 S024
```

```text
S017 → 案件 case-55918414:结论 duplicate_charge 多收 123.60;贷记单 CN-0001 draft
S001 → 案件 case-733c7e96:结论 cancel_not_respected 多收 174.90;贷记单 CN-0002 draft
S023 → 案件 case-1c584dbe:结论 duplicate_invoice 多收 139.05;贷记单 无 blocked  转人工
S003 → 案件 case-247a3e79:结论 no_error 多收 0.00;贷记单 无 
S024 → 案件 case-07ac1166:结论 duplicate_charge 多收 444.14;贷记单 CN-0003 draft
```

S023 现在 `blocked`、转人工,库里没有为它生成任何贷记单。S024 是重复扣款,444.14 的单子。

### 审批人用命令行批

```bash
uv run python -m billsleuth.approve list
```

```text
CN-0001  INV-0017-05     123.60  已批 0/1  案件 case-55918414
CN-0002  INV-0001-05     174.90  已批 0/1  案件 case-733c7e96
CN-0003  INV-0024-03     444.14  已批 0/2  案件 case-07ac1166
```

`show CN-0001` 里的复算是(节选):

```text
{"invoice_id": "INV-0017-05", "expected_total": "123.60", "actual_total": "123.60", "difference": "0.00", "reason": "金额与参考引擎一致", "paid_total": "247.20", "successful_payments": 2}
['list_invoices', 'get_customer', 'list_payments', 'recompute_invoice', 'get_invoice', 'draft_credit_note']
```

发票本身没错(差额 0.00),但这张发票成功扣了 2 笔,合计 247.20。审批人一眼看得出来:错在重复扣款。审计日志里这个案件的工具调用顺序最后一条是 `draft_credit_note`,是图里的代码调的,不是模型。接下来用命令行批:

```bash
uv run python -m billsleuth.approve approve CN-0001 --as alice -m "扣款记录核对过"
uv run python -m billsleuth.approve reject  CN-0002 --as alice -m "客户取消记录待客服确认"
uv run python -m billsleuth.approve approve CN-0003 --as alice
uv run python -m billsleuth.approve approve CN-0003 --as alice
uv run python -m billsleuth.approve approve CN-0003 --as agent
uv run python -m billsleuth.approve approve CN-0003 --as bob
```

(CN-0002 驳回只是演示:假装客服还没确认取消记录。)

```text
CN-0001 → issued
给客户的回复: 您好,经核对,9 月 14 日确实多扣了一笔 123.60 美元。(……中间省略……)

更正已审核通过,多收的 123.60 美元会退回原支付方式或抵扣下期账单。
CN-0002 → rejected
给客户的回复: 您好,我们复核了发票 INV-0001-05 的账单,需要账务同事再做一次人工核对。核对结果会在 1 个工作日内邮件告诉您,给您添麻烦了。
CN-0003 → draft
给客户的回复: 您好,确实多扣了一笔:8 月 28 日同一张账单被扣了两次,各 444.14 美元,……
CN-0003 → draft
没有生效: alice 已经审过这张,需要另一个人
CN-0003 → draft
没有生效: Agent 不能审批自己起草的贷记单
CN-0003 → issued
给客户的回复: (……)更正已审核通过,多收的 444.14 美元会退回原支付方式或抵扣下期账单。
```

逐条对一遍:CN-0001 一个人批就 `issued`,客户版末尾多了「更正已审核通过」。CN-0002 被驳回,客户版整段换成不带金额、不提退款的复核说明。CN-0003(444.14,达到门槛)alice 第一次批,状态还是 `draft`;alice 再批,没有生效,图继续等;`agent` 冒充,没有生效;bob 批了,变成 `issued`。再让 bob 去批已经结束的 CN-0001:

```text
Traceback (most recent call last):
  ...
LookupError: 案件 case-55918414 没有在等审批(当前位置:已结束)
```

图已经走完,不会再恢复一次。这一屏 Traceback 太吓人,练习 4 会把它改成人话。库里的最终状态:

```bash
sqlite3 billing.db "select id,status from credit_notes; select credit_note_id,approver,decision from approvals"
```

```text
CN-0001|issued
CN-0002|rejected
CN-0003|issued
CN-0001|alice|approve
CN-0002|alice|reject
CN-0003|alice|approve
CN-0003|bob|approve
```

被拦下的几次(alice 重复、agent)没有在 `approvals` 里留任何记录:被拒绝的审批没有生效,不该留痕在「审批记录」里。

### 整条流程的测试

`tests/test_approval_flow.py`:假模型加内存 checkpointer,不花钱。

```python
# billsleuth/tests/test_approval_flow.py  整条审批流:代码起草、图暂停、审批恢复。假模型 + 假审批人,不花钱
import pytest
from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from billsleuth import approval, cases
from billsleuth.db import connect
from billsleuth.explain import Explanation
from billsleuth.graph import Intake, build_graph
from billsleuth.mcp_bridge import BillingMCP
from tests.test_graph import GOOD, INTAKE, ScriptedLLM, call, submit

QUESTION = "我们早就取消了,怎么 9 月还扣了 174.90 美元?"
SCRIPT = [AIMessage("", tool_calls=[call("recompute_invoice", {"invoice_id": "INV-0001-05"}, 1)]),
          AIMessage("", tool_calls=[submit(2)])]
BAD = Explanation(customer_message="多收了 999.99 美元 [E1]。", internal_note="多收 999.99 [E1]。")


@pytest.fixture(autouse=True)
def _db(fresh_db):
    """本文件每条测试都用一份干净的库。"""


def count(status: str | None = None) -> int:
    with connect() as c:
        sql = "SELECT COUNT(*) FROM credit_notes" + (" WHERE status = ?" if status else "")
        return c.execute(sql, (status,) if status else ()).fetchone()[0]


def open_case(drafts=None, script=None, case_id="case-test", customer="C-0001", question=QUESTION, intake=INTAKE):
    llm = ScriptedLLM(intake, list(script or SCRIPT), drafts=drafts)
    g = build_graph(llm=llm, mcp=BillingMCP(in_process=True), checkpointer=InMemorySaver())
    cfg: RunnableConfig = {"recursion_limit": 40, "configurable": {"thread_id": case_id}}
    g.invoke({"customer_id": customer, "question": question}, cfg)
    return g, cfg, llm


def resume(g, cfg: RunnableConfig, who, decision, comment=""):
    g.invoke(Command(resume={"approver": who, "decision": decision, "comment": comment}), cfg)
    return g.get_state(cfg)


def test_graph_pauses_with_one_draft_and_model_never_sees_the_write_tool():
    g, cfg, llm = open_case()
    st = g.get_state(cfg)
    assert st.next == ("await_approval",)
    assert st.values["approval"]["idempotency_key"] == "case-test:INV-0001-05:174.90"
    assert count("draft") == 1
    assert all("draft_credit_note" not in str(m) for m in llm.seen)


def test_approve_issues_once_and_ends():
    g, cfg, _ = open_case()
    st = resume(g, cfg, "alice", "approve")
    assert st.values["approval"]["status"] == "issued" and count("issued") == 1 and count() == 1 and st.next == ()
    assert "更正已审核通过" in st.values["reply"]["customer_message"]


def test_reject_rewrites_the_customer_message():
    g, cfg, _ = open_case()
    st = resume(g, cfg, "alice", "reject", "取消记录待核实")
    assert st.values["approval"]["status"] == "rejected" and count("rejected") == 1
    assert "退" not in st.values["reply"]["customer_message"] and "174.90" not in st.values["reply"]["customer_message"]


def test_two_person_case_waits_for_the_second_person(monkeypatch):
    monkeypatch.setattr(approval, "TWO_PERSON_THRESHOLD", approval.Decimal("100.00"))
    g, cfg, _ = open_case()
    st = resume(g, cfg, "alice", "approve")
    assert st.next == ("await_approval",) and st.values["approval"]["status"] == "draft" and count("draft") == 1
    st = resume(g, cfg, "alice", "approve")                 # 同一个人再批:不抛错,记一条 error,图接着等
    assert "已经审过" in st.values["approval"]["error"] and st.next == ("await_approval",)
    st = resume(g, cfg, "bob", "approve")                   # 真正的第二个人不会被前一次的错连累
    assert st.values["approval"]["status"] == "issued" and st.next == ()


def test_agent_cannot_approve_through_the_graph():
    g, cfg, _ = open_case()
    st = resume(g, cfg, "agent", "approve")
    assert "Agent 不能审批" in st.values["approval"]["error"] and count("draft") == 1 and st.next == ("await_approval",)
    assert resume(g, cfg, "alice", "approve").values["approval"]["status"] == "issued"


def test_reject_without_reason_keeps_waiting():
    g, cfg, _ = open_case()
    st = resume(g, cfg, "alice", "reject", "")
    assert "原因" in st.values["approval"]["error"] and st.next == ("await_approval",) and count("draft") == 1


def test_issue_blocked_by_quota_ends_in_approved_and_escalates():
    """批准那一刻额度还够,签发那一刻同一张发票上多了一张已签发的:停在 approved,不放钱出去。"""
    g, cfg, _ = open_case()
    with connect() as c:
        c.execute("INSERT INTO credit_notes VALUES ('CN-9999', 'INV-0001-05', '100.00', '人工补录的一张已签发', 'issued')")
    st = resume(g, cfg, "alice", "approve")
    assert st.values["approval"]["status"] == "approved" and "超过实际扣款" in st.values["approval"]["error"]
    assert st.values["escalated"] and count("issued") == 1 and st.next == ()


def test_template_fallback_is_not_drafted():
    g, cfg, _ = open_case(drafts=[BAD] * 3)
    v = g.get_state(cfg).values
    assert v["reply"]["fallback"] and v["escalated"] and v["approval"]["status"] == "blocked" and count() == 0
    assert g.get_state(cfg).next == ()


def test_no_supporting_evidence_means_no_draft():
    """模型没调 recompute_invoice 就交卷,证据里没有「多收」也没有扣款,代码不猜发票,转人工。"""
    llm_script = [AIMessage("", tool_calls=[submit(1)])]
    g, cfg, _ = open_case(script=llm_script)
    v = g.get_state(cfg).values
    assert v["escalated"] and v["approval"]["status"] == "blocked" and "没有证据" in v["approval"]["error"]
    assert count() == 0 and g.get_state(cfg).next == ()


def test_duplicate_invoice_is_left_to_a_human():
    """重复开票:两张发票都有证据,代码不替人选。图转人工,库里一张贷记单都没有。"""
    script = [AIMessage("", tool_calls=[call("recompute_invoice", {"invoice_id": "INV-0023-04"}, 1),
                                        call("recompute_invoice", {"invoice_id": "INV-0023-04D"}, 2)]),
              AIMessage("", tool_calls=[submit(3, root_cause="duplicate_invoice", overcharge="139.05",
                                               invoice_ids=["INV-0023-04", "INV-0023-04D"])])]
    msg = Explanation(customer_message="您好,9 月周期开了两张相同的发票,多收了 139.05 美元。已提交更正申请,审核通过后会把多收的金额退回或抵扣。",
                      internal_note="duplicate_invoice:同一周期两张发票,多收 139.05。")
    g, cfg, _ = open_case(script=script, drafts=[msg] * 3, customer="C-0023", question="9 月这张发票金额 139.05,对不上账",
                          intake=Intake(complaint="金额不对", amount="139.05", month=9))
    v = g.get_state(cfg).values
    assert v["escalated"] and v["approval"]["status"] == "blocked" and count() == 0 and g.get_state(cfg).next == ()


def test_explain_only_never_reaches_approval():
    script = [AIMessage("", tool_calls=[call("recompute_invoice", {"invoice_id": "INV-0001-05"}, 1)]),
              AIMessage("", tool_calls=[submit(2, root_cause="no_error", overcharge="0.00", expected_action="explain_only")])]
    explanation = Explanation(customer_message="您好,我们核对了这张发票,金额没有错误。", internal_note="no_error。")
    g, cfg, _ = open_case(script=script, drafts=[explanation] * 3)
    assert g.get_state(cfg).next == () and "approval" not in g.get_state(cfg).values and count() == 0


def test_without_checkpointer_the_graph_stops_at_write_up():
    llm = ScriptedLLM(INTAKE, list(SCRIPT))
    out = build_graph(llm=llm, mcp=BillingMCP(in_process=True)).invoke(
        {"customer_id": "C-0001", "question": QUESTION}, {"recursion_limit": 40})
    assert "approval" not in out and count() == 0


def test_cases_resume_from_disk(tmp_path, monkeypatch):
    """案件开在一次连接里,审批在另一次连接里:图从 checkpoints.db 恢复。恢复第二次报错。"""
    monkeypatch.setenv("BILLSLEUTH_CHECKPOINTS", str(tmp_path / "cp.db"))
    llm = ScriptedLLM(INTAKE, list(SCRIPT))
    case_id, st = cases.open_case("C-0001", QUESTION, llm=llm)
    assert st["approval"]["status"] == "draft" and (tmp_path / "cp.db").exists()
    st = cases.resume_case(case_id, "alice", "approve")
    assert st["approval"]["status"] == "issued"
    with pytest.raises(LookupError, match="没有在等审批"):
        cases.resume_case(case_id, "bob", "approve")
```

<div class="line-notes">

- `from tests.test_graph import GOOD, INTAKE, ScriptedLLM, call, submit` 复用 Day 687 的 `ScriptedLLM` 和辅助函数。
- `SCRIPT = [AIMessage("", tool_calls=[call("recompute_invoice", {"invoice_id": "INV-0001-05"}, 1)]),` 假模型的台词:先复算 S001 那张发票,再交卷。
- `BAD = Explanation(customer_message="多收了 999.99 美元 [E1]。", internal_note="多收 999.99 [E1]。")` 一份必然过不了溯源校验的解释:999.99 在证据里找不到。三份这样的稿子写完,图会走模板兜底。
- `def open_case(drafts=None, script=None, case_id="case-test", customer="C-0001", question=QUESTION, intake=INTAKE):` 开一个案件,图停在审批节点。参数让后面的测试可以换场景。
- `g = build_graph(llm=llm, mcp=BillingMCP(in_process=True), checkpointer=InMemorySaver())` 传了 checkpointer 才有审批分支。
- `def resume(g, cfg: RunnableConfig, who, decision, comment=""):` 模拟审批人的操作,返回恢复之后的图状态。
- `assert st.next == ("await_approval",)` `st.next` 是图接下来要执行的节点,停在 `await_approval` 说明在等人。
- `assert all("draft_credit_note" not in str(m) for m in llm.seen)` 模型收到的所有消息里都没有这个工具名:它的工具表里没有写工具。
- `assert st.values["approval"]["status"] == "issued" and count("issued") == 1 and count() == 1 and st.next == ()` 批准一次:`issued`,库里只有 1 张,图结束。
- `assert "退" not in st.values` 驳回后的客户版不带金额、不提退款。
- `monkeypatch.setattr(approval, "TWO_PERSON_THRESHOLD", approval.Decimal("100.00"))` 把门槛降到 100,174.90 要两个人。
- `st = resume(g, cfg, "alice", "approve")                 # 同一个人再批:不抛错,记一条 error,图接着等` 对应前面那个 bug 的修复。
- `st = resume(g, cfg, "bob", "approve")                   # 真正的第二个人不会被前一次的错连累` 这一条以前是红的。
- `def test_issue_blocked_by_quota_ends_in_approved_and_escalates():` 批准那一刻额度够,签发那一刻同一张发票上多了一张已签发的 100.00:停在 `approved`,`escalated` 置位,`issued` 只有人工补录的那 1 张,钱没有多出去。
- `g, cfg, _ = open_case(drafts=[BAD] * 3)` 三稿都过不了校验,走模板兜底。
- `assert v["reply"]["fallback"] and v["escalated"] and v["approval"]["status"] == "blocked" and count() == 0` 兜底的案件不起草:库里一张贷记单都没有。
- `def test_duplicate_invoice_is_left_to_a_human():` S023 这类重复开票,代码不替人选,转人工,库里没有贷记单。
- `def test_without_checkpointer_the_graph_stops_at_write_up():` 老用法(不传 checkpointer)的行为没变:没有 `approval` 字段,库里没有贷记单。
- `monkeypatch.setenv("BILLSLEUTH_CHECKPOINTS", str(tmp_path / "cp.db"))` 把 checkpoint 文件放进测试的临时目录。
- `case_id, st = cases.open_case("C-0001", QUESTION, llm=llm)` 用 `cases.py` 开案件,存在磁盘上。
- `with pytest.raises(LookupError, match="没有在等审批"):` 案件已经结束,第二次恢复要报这个错。

</div>

```bash
uv run pytest -q
```

```text
........................................................................ [ 82%]
...........................................................              [100%]
347 passed in 22.55s
```

## 今天的文件

| 文件 | 做什么 | 零件对应 |
| --- | --- | --- |
| `scratch/dedupe_gap.py` | 老去重的缺口实验 | 幂等键 |
| `billsleuth/schema.sql` | 加 `credit_note_requests` | 幂等键 |
| `billsleuth/server.py` | `draft_credit_note` 加键、事务、新额度检查 | 幂等键 |
| `scratch/lock_experiment.py` | 并发实验 | 并发 |
| `tests/test_draft.py` | 8 条幂等和并发测试 | 幂等键 |
| `billsleuth/graph.py` | `request_approval`、`await_approval` 和三条条件边 | 暂停 |
| `scratch/poison_resume.py` | 节点抛错污染恢复值的复现 | 暂停 |
| `billsleuth/cases.py` | 开案件、恢复案件 | 暂停 |
| `billsleuth/approve.py` | 审批命令行 | 审批 |
| `billsleuth/credit.py` | `credit_target` 改成「恰好一张」 | 起草 |
| `tests/test_approval_flow.py` | 13 条整流程测试 | 暂停 |

测试总数:347 条(Day 690 的 323,加 8 条幂等、13 条流程,`test_credit.py` 多了 3 条)。HTTP 审批接口留到做 web 服务的那一天,今天只做命令行。

真模型花费:第一轮 4 个案件约 ¥0.15(按第二轮每个案件约 ¥0.037 估);第二轮 5 个案件,调查阶段输入 9238 + 8268 + 10064 + 12314 + 9015 = 48899、输出 583 + 603 + 623 + 832 + 629 = 3270,48899 × 2 + 3270 × 8 = 123958,约 ¥0.124,加 5 次 intake 约 ¥0.007、5 次写作约 ¥0.053,合计约 ¥0.18。两轮合计约 ¥0.33。

## 动手练习

1. 把 `lock_experiment.py` 里的线程数从 8 改成 2 和 16,各跑一次,记下普通 `BEGIN` 报错的轮数。
2. 同一个起草请求连发 3 次(模拟重放和重试),再换一个金额发一次,看每次返回的是哪张。
3. 不花钱(用假模型)开一个案件、批准它,然后用 `get_state_history` 把这个案件在 `checkpoints.db` 里走过的每一步打印出来。
4. 对已经结束的案件再批一次,现在是一屏 Traceback。改 `approve.py`,让它打印一句人话并以非零状态退出。

<details><summary>参考答案</summary>

**练习 1**

不用改文件,用 `sed` 在命令里临时替换线程数:

```bash
for n in 2 16; do sed "s/range(8)/range($n)/" scratch/lock_experiment.py > scratch/lock_n.py; echo "== $n threads"; uv run python -m scratch.lock_n; done; rm scratch/lock_n.py
```

```text
== 2 threads
普通 BEGIN         10 轮里报错的轮数 10,多出贷记单的轮数 0,每轮贷记单数 [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    报错: OperationalError: database is locked
BEGIN IMMEDIATE  10 轮里报错的轮数 0,多出贷记单的轮数 0,每轮贷记单数 [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
== 16 threads
普通 BEGIN         10 轮里报错的轮数 7,多出贷记单的轮数 0,每轮贷记单数 [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    报错: OperationalError: database is locked
BEGIN IMMEDIATE  10 轮里报错的轮数 0,多出贷记单的轮数 0,每轮贷记单数 [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
```

2 个线程 10 轮全报错,8 个线程 5 轮,16 个线程 7 轮:没有规律,这正是并发 bug 的特点,线程数多不一定更容易出错。只有 `BEGIN IMMEDIATE` 在每种线程数下都是 0。你的数字大概率和我的不同,这是正常的,关键是普通 `BEGIN` 会出现报错而 `IMMEDIATE` 不会。

**练习 2**

```python
# billsleuth/scratch/ex2_replay.py  练习 2:同一个起草请求连发 3 次(重放、重试),再换一个金额发一次
import os
import shutil
import tempfile

from billsleuth.db import ROOT, connect
from billsleuth.server import draft_credit_note

tmp = tempfile.mkdtemp()
shutil.copy(ROOT / "billing.db", f"{tmp}/b.db")
os.environ["BILLSLEUTH_DB"] = f"{tmp}/b.db"
REASON = "订阅已到期取消,这张发票不应开出,全额冲正"
KEY = "case-demo:INV-0001-05:174.90"
for i in range(3):
    r = draft_credit_note("INV-0001-05", "174.90", REASON, idempotency_key=KEY, case_id="case-demo")
    print(f"第 {i + 1} 次:{r['credit_note_id']} {r['status']}  {r['note']}")
r = draft_credit_note("INV-0001-05", "100.00", REASON, idempotency_key="case-demo:INV-0001-05:100.00", case_id="case-demo")
print(f"换金额:{r['credit_note_id']} {r['amount']}  {r['note']}")
with connect() as c:
    print("库里:", [tuple(x) for x in c.execute("SELECT id, amount, status FROM credit_notes")])
shutil.rmtree(tmp)
```

<div class="line-notes">

- `KEY = "case-demo:INV-0001-05:174.90"` 手写一个键,格式和图里生成的一样。
- `for i in range(3):` 同一个请求连发 3 次。
- `r = draft_credit_note("INV-0001-05", "174.90", REASON, idempotency_key=KEY, case_id="case-demo")` 带键调用,不经过 MCP,直接调函数。
- `print(f"第 {i + 1} 次:{r['credit_note_id']} {r['status']}  {r['note']}")` 打印返回的单号、状态和说明,说明里的文字告诉你走的是哪条分支。
- `r = draft_credit_note("INV-0001-05", "100.00", REASON, idempotency_key="case-demo:INV-0001-05:100.00", case_id="case-demo")` 键不同(金额变了)。
- `print("库里:", [tuple(x) for x in c.execute("SELECT id, amount, status FROM credit_notes")])` `sqlite3.Row` 转成元组才能直接打印出值。

</div>

```text
第 1 次:CN-0001 draft  已生成草稿,等待人工审批后才会签发
第 2 次:CN-0001 draft  同一个幂等键已经起草过,返回原来那张
第 3 次:CN-0001 draft  同一个幂等键已经起草过,返回原来那张
换金额:CN-0001 174.90  这张发票已有草稿,未重复创建
库里: [('CN-0001', '174.90', 'draft')]
```

重发的两次返回的都是 CN-0001,说明写的是「同一个幂等键已经起草过」。最后一行有点反直觉:键不同,但仍返回了 CN-0001,金额是 174.90 而不是 100.00,说明是 Day 683 的老规则「这张发票已有草稿」生效了。两道保护叠在一起。想真的得到 100.00 的新草稿,要先把 CN-0001 驳回(`test_new_amount_after_rejection_makes_a_new_draft` 测的就是这个)。

**练习 3**

```python
# billsleuth/scratch/ex3_history.py  练习 3:不花钱开一个案件,把 checkpoints.db 里这个案件走过的每一步打印出来
import os
import shutil
import tempfile

from langchain_core.messages import AIMessage

from billsleuth import cases
from billsleuth.db import ROOT
from tests.test_graph import INTAKE, ScriptedLLM, call, submit

tmp = tempfile.mkdtemp()
shutil.copy(ROOT / "billing.db", f"{tmp}/b.db")
os.environ["BILLSLEUTH_DB"] = f"{tmp}/b.db"
os.environ["BILLSLEUTH_CHECKPOINTS"] = f"{tmp}/cp.db"
script = [AIMessage("", tool_calls=[call("recompute_invoice", {"invoice_id": "INV-0001-05"}, 1)]),
          AIMessage("", tool_calls=[submit(2)])]
case_id, _ = cases.open_case("C-0001", "我们早就取消了,怎么 9 月还扣了 174.90 美元?", llm=ScriptedLLM(INTAKE, script))
cases.resume_case(case_id, "alice", "approve")
with cases.case_graph() as g:
    for snap in reversed(list(g.get_state_history(cases.cfg(case_id)))):
        print(f"step {snap.metadata['step']:>2}  下一步 {str(snap.next):<22} 来源 {snap.metadata['source']}")
shutil.rmtree(tmp)
```

<div class="line-notes">

- `os.environ["BILLSLEUTH_CHECKPOINTS"] = f"{tmp}/cp.db"` 把 checkpoint 也放进临时目录,脚本跑完一起删掉。
- `script = [AIMessage("", tool_calls=[call("recompute_invoice", {"invoice_id": "INV-0001-05"}, 1)]),` 假模型的台词,和测试里一样。
- `case_id, _ = cases.open_case(` 开案件,图停在审批节点。传入 `llm=ScriptedLLM(...)`,不会调真模型。
- `cases.resume_case(case_id, "alice", "approve")` 批准,图走完。
- `for snap in reversed(list(g.get_state_history(cases.cfg(case_id)))):` `get_state_history` 返回这个案件所有 checkpoint 的快照,从最新到最旧;`reversed` 反过来,从最旧到最新打印。
- `print(f"step {snap.metadata['step']:>2}  下一步 {str(snap.next):<22} 来源 {snap.metadata['source']}")` 第几步(`-1` 是输入进来的那一刻),以及这个快照之后图要去执行的节点。

</div>

```text
step -1  下一步 ('__start__',)         来源 input
step  0  下一步 ('intake',)            来源 loop
step  1  下一步 ('locate',)            来源 loop
step  2  下一步 ('investigate',)       来源 loop
step  3  下一步 ('tools',)             来源 loop
step  4  下一步 ('investigate',)       来源 loop
step  5  下一步 ('conclude',)          来源 loop
step  6  下一步 ('write_up',)          来源 loop
step  7  下一步 ('request_approval',)  来源 loop
step  8  下一步 ('await_approval',)    来源 loop
step  9  下一步 ()                     来源 loop
```

整张图的路径一目了然:`intake → locate → investigate → tools → investigate → conclude → write_up → request_approval → await_approval`,最后 `下一步` 为空,图结束。第 8 步是暂停的那一刻,进程这时候可以退出,checkpoint 就在 `cp.db` 里。每一步都存一份快照,所以要是恢复时出了问题,还可以回到某一步重来。

**练习 4**

```python
# billsleuth/billsleuth/approve.py(main 里,把原来的 st = resume_case(...) 一行换成下面这段)
    try:
        st = resume_case(case_of(conn, a.cn_id), a.approver, a.cmd, a.comment)
    except LookupError as e:     # 案件已经结束:说人话,不甩一屏 Traceback
        raise SystemExit(f"没有生效:{e}") from None
```

<div class="line-notes">

- `try:` 只包住恢复这一行,别的错误(比如数据库坏了)仍然应该抛出来让人看到 Traceback。
- `except LookupError as e:` `resume_case` 在案件没有在等审批时抛的是 `LookupError`(Day 690 `approval._load` 找不到贷记单抛的也是它,这里一并接住)。
- `raise SystemExit(f"没有生效:{e}") from None` `SystemExit` 带字符串:打印到 stderr,退出码是 1。`from None` 去掉「During handling of the above exception」那一串,免得又是一屏。

</div>

要验证它,需要一个已经结束的案件。`ex4_open_scripted.py` 不花钱开一个(假模型,落在默认的 `billing.db` 和 `checkpoints.db`):

```python
# billsleuth/scratch/ex4_open_scripted.py  练习 4 的准备:不花钱开一个案件(假模型),落在默认的 billing.db 和 checkpoints.db 里
from langchain_core.messages import AIMessage

from billsleuth import cases
from tests.test_graph import INTAKE, ScriptedLLM, call, submit

script = [AIMessage("", tool_calls=[call("recompute_invoice", {"invoice_id": "INV-0001-05"}, 1)]),
          AIMessage("", tool_calls=[submit(2)])]
case_id, st = cases.open_case("C-0001", "我们早就取消了,怎么 9 月还扣了 174.90 美元?", llm=ScriptedLLM(INTAKE, script))
print(case_id, st["approval"]["credit_note_id"], st["approval"]["status"])
```

<div class="line-notes">

- `script = [AIMessage("", tool_calls=[call("recompute_invoice", {"invoice_id": "INV-0001-05"}, 1)]),` 同样的台词。
- `case_id, st = cases.open_case("C-0001", "我们早就取消了,怎么 9 月还扣了 174.90 美元?", llm=ScriptedLLM(INTAKE, script))` 没传环境变量,所以案件落在默认位置,命令行才找得到它。
- `print(case_id, st["approval"]["credit_note_id"], st["approval"]["status"])` 打印案件号、贷记单号、状态。

</div>

```bash
uv run python -m scratch.ex4_open_scripted
uv run python -m billsleuth.approve approve CN-0001 --as alice
uv run python -m billsleuth.approve approve CN-0001 --as bob; echo "exit=$?"
```

```text
case-85fe57e2 CN-0001 draft
CN-0001 → issued
给客户的回复: 您好,订阅在 9 月到期后不应再开票,这张发票多收了 174.90 美元。已提交更正申请,审核通过后会把多收的金额退回或抵扣。
没有生效:案件 case-85fe57e2 没有在等审批(当前位置:已结束)
exit=1
```

alice 的批准正常签发;bob 再批,变成一行人话,退出码是 1,脚本和监控能据此判断失败。注意这里批的是第一个案件的贷记单,所以号码是 `CN-0001`,在一个刚 seed 的库里才会是这个号。

</details>

**验收标准:** `uv run pytest -q` 全绿(347 条);能不看文章说出「起草和暂停为什么是两个节点」;能复现节点里抛错导致下一个审批人收到上一个人的错,并说出修法;真模型开 5 个案件,命令行批、驳回、被拦各走一遍,和文章里的现象一致;S023 现在被转人工而不是开错发票。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 幂等(idempotency) | 同一个请求执行一次和执行多次,结果一样。相当于 HTTP 里的 PUT 和 DELETE 的性质 |
| 幂等键(idempotency key) | 标识「这是同一个请求」的键,由调用方生成。本项目是 `案件号:发票号:金额` |
| 重放(replay) | 同一个操作被再执行一遍,原因可能是重试、从 checkpoint 恢复、人工重跑 |
| 竞争窗口 | 「先检查、后动手」两步之间的空隙。别的请求能在这个空隙里改变检查的前提 |
| 延迟事务(DEFERRED) | SQLite 普通 `BEGIN`,开始时不拿锁,第一次读拿共享锁,第一次写才去升级写锁 |
| 写锁 | 一个数据库同一时刻只允许一个连接持有的写权限。别的写者要等 |
| 唯一约束 / 主键 | 数据库自己保证某一列(或几列)的值不重复,重复插入直接报错 |
| interrupt | LangGraph 里让图在某个节点暂停、等外部输入的函数。恢复时所在节点从头重跑 |
| `Command(resume=...)` | 恢复暂停的图,并把值交给 `interrupt()` 作为它的返回值 |
| checkpointer / SqliteSaver | 保存图每一步状态的组件。`SqliteSaver` 存到 SQLite 文件,进程退出后还能恢复 |
| 案件号(case_id) | 调查图的 `thread_id`,也是审计日志里的会话号 |
| 橡皮图章 | 审批人只看 Agent 的结论就点批准,审批形同虚设 |
| 条件边 | LangGraph 里按状态决定下一步去哪个节点的边,相当于路由函数 |

## 常见误区

**以为「已有草稿就返回」就是幂等。** 它只看 `draft` 状态,草稿被批准以后再来一次就漏了。幂等要按「这是不是同一个请求」判断,不按记录当前的状态判断。

**让模型生成幂等键。** 模型不记得上次传过什么,重放时会生成新键。键要从业务字段推出来:案件号、发票号、金额。

**先查后插,不加锁。** 单线程测试里永远是对的,并发时就会出问题。表现可能是报错,也可能是悄悄多一张,取决于数据库和有没有唯一约束。并发测试要一直留在套件里。

**在 interrupt 之前做有副作用的事。** 恢复时节点从头重跑,`interrupt()` 之前的代码会执行两次。把副作用放到前一个节点。

**在节点里把用户输入错误当异常抛。** 抛出去以后恢复值会被存进 checkpoint,下一个审批人的决定会被前一个人的错覆盖。要接住、写进状态,让图回到原地继续等。

**条件分支漏了「失败」那条出路。** `request_approval` 失败时图还是进了 `await_approval`,KeyError。图里每个会失败的节点,后面都要有一条不进下一步的边。写测试时「失败的路径也各测一遍」才抓得出来。

**把 Agent 的结论给审批人看。** 写得有道理的话很容易被批。给他看系统重新复算的结果和审计日志。今天 S023 那张开错发票的贷记单,就是看复算才看得出来的。

**用 InMemorySaver 做审批。** 进程一退,暂停的图就没了,主管第二天来批时找不到案件。

**代码替人做没有依据的选择。** 两张一模一样的发票,选哪张是业务判断,代码拿 `for` 循环的顺序去选,就是在悄悄做一个没人审过的决定。证据不能唯一确定,就转人工。

## 学习资料

### 文档与文章

- [Stripe · Idempotent requests](https://docs.stripe.com/api/idempotent_requests):Stripe 的幂等键规则,重点看「同一个键、参数却不一样」时怎么处理,15 分钟。
- [Brandur Leach · Implementing Stripe-like Idempotency Keys in Postgres](https://brandur.org/idempotency-keys):讲幂等最好的一篇长文,把请求拆成多个原子阶段、每阶段记恢复点,1 小时。读完你会明白我们这个单事务版本省略了什么。
- [LangGraph · Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts):interrupt 的用法,以及「恢复时节点从头执行」,读完就明白为什么起草要单独一个节点,20 分钟。
- [LangGraph · Persistence](https://docs.langchain.com/oss/python/langgraph/persistence):checkpoint 和 thread 的概念,`get_state_history` 在这里,20 分钟。
- [SQLite · BEGIN TRANSACTION](https://www.sqlite.org/lang_transaction.html):DEFERRED、IMMEDIATE、EXCLUSIVE 三种事务的区别,今天实验里的 `database is locked` 就是它,10 分钟。
- [Python 文档 · sqlite3 事务控制](https://docs.python.org/zh-cn/3.12/library/sqlite3.html#sqlite3-transaction-control):中文,讲 `isolation_level` 和 Python 默认偷偷 `BEGIN` 的行为,15 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1CXarehE8k&autoplay=0&high_quality=1" title="跪求兄弟们了，写接口一定要支持幂等呀！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员知正 · 跪求兄弟们了,写接口一定要支持幂等呀! · 12 分钟,从重复下单讲到 token、唯一索引、状态机几种做法,对应今天的幂等键和带状态条件的更新。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1fykHY6EAF&autoplay=0&high_quality=1" title="LangGraph Interrupt：Human-In-The-Loop 人机交互手到擒来！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>沧海九粟 · LangGraph Interrupt:Human-In-The-Loop 人机交互手到擒来! · 22 分钟,演示 interrupt 暂停和 Command 恢复,正好是今天审批节点的写法。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/m6DtqSb1BDM" title="Build a robust Payments service using Idempotency Keys" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Arpit Bhayani · Build a robust Payments service using Idempotency Keys · 用支付服务讲幂等键的完整设计,键存在哪、过期多久、并发怎么处理,英文。</figcaption>
</figure>

- LangChain 官方《LangGraph interrupt: Making it easier to build human-in-the-loop agents》(YouTube `6t7YJcEFUIY`):官方讲 interrupt 设计动机的短视频,英文。

### 书籍

- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly, 2017;中文版《数据密集型应用系统设计》,中国电力出版社,2018):第 7 章「事务」讲隔离级别和写偏斜,读完你会明白为什么要 `BEGIN IMMEDIATE` 和带状态条件的 `UPDATE`;第 11 章提到的幂等和「恰好一次」也值得看。

### 开源项目与代码

- [brandur/rocket-rides-atomic](https://github.com/brandur/rocket-rides-atomic):上面那篇长文的配套代码,看幂等键表和原子阶段的实现,30 分钟。
- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):搜 `interrupt` 和 `SqliteSaver`,看暂停和持久化是怎么实现的。

## 自测

1. Day 683 的「同一张发票已有 draft 就返回」为什么不够?举一个它漏掉的顺序。

<details><summary>答案</summary>

它只看 `draft` 状态。顺序:起草,主管批准(状态变 `approved`),起草那一步因为重放、重试或人工重跑又执行了一次。这时没有 `draft` 状态的草稿,去重不生效。实测同一个请求发两次,部分冲正多出一张,全额冲正时同一张发票上贷记合计翻倍(174.90 的发票贷记了 349.8)。幂等键按请求身份判断,不看记录当前状态,就能挡住。

</details>

2. 并发实验里,普通 `BEGIN` 为什么会报 `database is locked`,而不是多出一张贷记单?

<details><summary>答案</summary>

两个线程都用延迟事务:先读(拿共享锁),等到要写时才想升级成写锁,两边都拿着共享锁等对方放,谁也升不上去,SQLite 检测到这种互相等待就立刻返回 busy,`busy_timeout` 设多长都没用。没有多出一张是因为 `idempotency_key` 是主键,第二次插入会被数据库拒绝。换一个没有唯一约束的设计,表现可能就是静悄悄地多一张。`BEGIN IMMEDIATE` 一开始就拿写锁,别的线程在入口排队,没有这个问题。

</details>

3. `request_approval` 和 `await_approval` 为什么要分成两个节点?

<details><summary>答案</summary>

`interrupt()` 恢复时,所在节点会从头再执行一遍,`interrupt()` 之前的代码会执行两次。如果起草和暂停在同一个节点,每次恢复都会再起草一次。分成两个节点,起草只执行一次,恢复时只重跑审批节点。幂等键是第二道保险。

</details>

4. 同一个人批了两次,在节点里直接抛 `PermissionError` 会有什么后果?正确做法是什么?

<details><summary>答案</summary>

节点失败时,LangGraph 会把已交给 `interrupt()` 的恢复值存进 checkpoint,下一次恢复时重新执行这个节点,`interrupt()` 直接读到存下来的旧值,新审批人交进去的决定用不上,他收到的是上一个人的错误。正确做法是在节点里接住 `PermissionError`、`ValueError`,把错误写进状态的 `error` 字段,状态保持不变,让条件边把图送回 `await_approval` 再暂停一次。程序异常才抛,用户输入错误不抛。

</details>

5. S023 的结论里列了两张发票,现在 `credit_target` 返回 `None`,图转人工。为什么不让代码选「编号靠后的」或者「带 D 的」那张?

<details><summary>答案</summary>

因为证据对两张完全对称,连开票时间和扣款时间都一样,没有任何数据能说明哪张是多出来的。按编号、按后缀选,只是借用了造数据时的命名习惯,换一个系统就不成立;`for` 循环按顺序碰到哪个选哪个更糟,Day 691 第一版就这样把贷记单开在了没有错的那张上。选哪张是业务判断,要让人看着两张发票选,代码替人选就是做了一个没有依据、没人审过的决定。

</details>

6. 面试题:你的 Agent 做退款审批,用 LangGraph 的 `interrupt` 暂停。上线一个月后发现偶尔同一个工单有两张一样的退款草稿。你怎么排查,怎么修?

<details><summary>答案</summary>

排查:用审计日志和 trace 找出重复的那几单,看两张草稿的创建时间间隔和前后事件。重点怀疑三个来源:`interrupt` 恢复时节点从头执行,而起草在 `interrupt` 之前;模型在同一轮里并行调了两次;超时重试。修法:起草本身做幂等,键从业务字段(工单、发票、金额)推出,不依赖模型或执行次数;查键和插入放在同一个事务里加写锁,再加唯一约束兜底;把有副作用的调用挪到 `interrupt` 之前的独立节点;最好让代码而不是模型来起草。然后补并发测试和「恢复后重放」测试进回归集,加监控:同一工单同一发票出现两张非驳回的贷记单就告警。取舍上要说明:键里带金额会让「改金额」产生新草稿,这是有意的,靠审批人兜底。

</details>

## 明天预告

明天是 Day 692 · 第 99 周复习:作品(Day 686–691)。这一周从证据链、调查图,一路做到写作校验和审批,代码、测试、踩过的坑都不少。明天先画一张本周的知识地图,把六天串起来;然后做一个只用本周知识的小项目:一个不信任流程代码、只看库里结果的「贷记单体检」脚本,加上用假模型把 6 个场景完整跑一遍,再故意做 6 种破坏看体检能不能抓出来;最后默写 `decide`,用 19 条测试判卷,并整理一份本周的错题和坑清单。
