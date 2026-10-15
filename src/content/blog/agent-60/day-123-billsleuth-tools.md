---
title: 'Day 123 · BillSleuth(二):MCP 工具层、复算工具与审计日志'
description: '把计费库和参考引擎包成 Agent 能用的 MCP 工具:6 个只读查询工具、1 个复算工具 recompute_invoice、1 个只能写草稿的 draft_credit_note。讲清楚工具粒度、返回结构、写给模型看的报错、读写分离和审计日志,最后用测试证明 100 个场景的差额都能被复算工具找出来。'
pubDate: 2026-10-15
regime: none
tags: ['mcp', 'tool-design', 'audit-log', 'billing', 'agent-60']
series: 'agent-60'
day: 123
lang: 'zh'
---

## 今天要解决的问题

昨天我们有了账(`billing.db`)和标准答案(`scenarios/`)。今天在两者之间搭一层 Agent 能用的接口,也就是 MCP server。Day 23 你已经写过一个 CloudLedger 的 MCP server,今天用同样的 SDK 写法,但工具设计要讲究得多,因为计费 Agent 一旦拿到不好用的工具,就会开始自己算账,而那正是我们最不想看到的。学完你应该能:

1. 说出给 Agent 设计工具时的五个判断:粒度、返回结构、金额格式、报错写给谁看、哪些计算要放进工具里替模型做。
2. 写出 BillSleuth 的 8 个工具,其中最关键的是 `recompute_invoice`:调用参考引擎,把「应收」和「实收」逐类对比给 Agent 看。
3. 把写操作限制成「只能起草、重复调用不重复创建」,并用工具注解(annotations)告诉客户端哪些工具会改数据。
4. 给每次工具调用写审计日志,成功和失败都记,能按会话追溯 Agent 查过什么。
5. 用 MCP 内存客户端写测试,证明对 100 个场景中的每一个,复算工具都能算出标准答案里的多收金额。

预计用时 4–5 小时。前置:Day 23(MCP server 和内存客户端测试)、Day 122(引擎和造数)。

## 先想清楚:工具是给模型用的 API

Anthropic 那篇《Writing tools for agents》里有个观点我很认同:**工具是你和一个非确定性的使用者之间的契约**。给人用的 API,调用方会读文档、会写单元测试;给模型用的工具,模型只看名字、描述、参数 schema 和返回结果,然后就开始用了。所以设计的时候,你要假设使用者聪明但粗心、不会追问、看到什么就信什么。

落到 BillSleuth 上,我做了五个判断。

**粒度跟着「查账的动作」走,不跟着表走**。一种很自然的设计是一张表一个工具:`query_invoices`、`query_invoice_lines`、`query_payments`……甚至直接给一个 `run_sql`。这对模型很不友好:它得自己知道表怎么关联、发票表头和行项目要分两次查。我按客服查账时的动作来切:看客户、看发票列表、看一张发票的全部明细、看扣款、看订阅变化、看税率、复算。每个工具回答一个查账时会问的问题。

**列表只给表头,明细单独查**。`list_invoices` 只返回表头(周期、总额、状态),不带行项目;要看行项目再调 `get_invoice`。一个客户五张发票、每张五六行,全塞进一个结果里上下文就撑满了。这和 Day 63 讲的工具结果分页是一个道理。

**金额全部是字符串**。如果返回 JSON 数字,`1438.44` 在某些环节会变成 float,模型看到的可能是 `1438.4400000000001`。返回 `"1438.44"` 就没有这个问题,也顺便提醒模型这是一个精确的值,不要拿去心算。

**报错写给模型看,告诉它下一步该干嘛**。「发票不存在」对人够了,对模型不够。我们的报错是「发票 INV-0011-09 不存在。发票号形如 INV-0007-03,先用 list_invoices 查这个客户有哪些发票」。模型看到这句话,下一步大概率就是去调 `list_invoices`。

**能在工具里算的,就别让模型算**。这是最重要的一条。时区换算、税率有效期判断、应收金额,全部在工具里做好,直接给出结果。`get_subscription_timeline` 不只返回 UTC 时间,还返回换算好的客户本地日期;`recompute_invoice` 直接告诉模型差了多少、差在哪一类。模型的工作是判断「为什么差」,不是算「差多少」。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="BillSleuth 工具分层:查询工具、复算工具、写草稿工具,底下是计费库、参考引擎和审计日志">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
  <rect x="20" y="20" width="600" height="40" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="320" y="45" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">Agent(只看工具名、描述、schema、返回值)</text>
  <rect x="20" y="80" width="300" height="110" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="170" y="100" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">只读查询(6)</text>
  <text x="35" y="122" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">get_customer  list_invoices</text>
  <text x="35" y="142" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">get_invoice  list_payments</text>
  <text x="35" y="162" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">get_subscription_timeline</text>
  <text x="35" y="182" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">get_tax_rate</text>
  <rect x="335" y="80" width="140" height="110" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="405" y="100" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">复算(1)</text>
  <text x="405" y="130" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">recompute_</text>
  <text x="405" y="146" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">invoice</text>
  <text x="405" y="174" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">调参考引擎</text>
  <rect x="490" y="80" width="130" height="110" fill="none" stroke="var(--compute)" stroke-dasharray="5 3" rx="4"/>
  <text x="555" y="100" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">写草稿(1)</text>
  <text x="555" y="130" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">draft_credit_</text>
  <text x="555" y="146" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">note</text>
  <text x="555" y="174" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">只到 draft</text>
  <rect x="20" y="210" width="600" height="34" fill="none" stroke="var(--rule)" rx="4"/>
  <text x="320" y="232" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">@audited:每次调用写 audit_log(时间、会话、工具、参数、成败、摘要)</text>
  <rect x="20" y="256" width="600" height="34" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="320" y="278" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">billing.db  +  engine.py(参考引擎)</text>
</svg>
<figcaption>虚线框是唯一的写工具,它只能把贷记单写成草稿。所有工具都经过同一个审计装饰器。</figcaption>
</figure>

## 从库里读回引擎对象

复算工具要调用参考引擎,引擎吃的是内存里的 `Customer`、`Subscription`、`Event` 这些对象,所以先写一个读库的小模块:

```python
# billsleuth/billsleuth/repo.py
"""从 billing.db 把数据读回引擎用的对象。recompute_invoice 工具和评测都靠它。"""
from __future__ import annotations

import json
import sqlite3
from datetime import date, datetime
from decimal import Decimal

from billsleuth.engine import (
    Coupon,
    Customer,
    Event,
    Invoice,
    Plan,
    Subscription,
    TaxRate,
    expected_for_period,
)


def load_plans(conn: sqlite3.Connection) -> dict[str, Plan]:
    return {r["id"]: Plan(r["id"], r["name"], r["interval"], Decimal(r["unit_price"]))
            for r in conn.execute("SELECT * FROM plans")}


def load_rates(conn: sqlite3.Connection) -> list[TaxRate]:
    return [TaxRate(r["code"], r["region"], Decimal(r["rate"]), date.fromisoformat(r["valid_from"]),
                    date.fromisoformat(r["valid_to"]) if r["valid_to"] else None)
            for r in conn.execute("SELECT * FROM tax_rates")]


def load_customer(conn: sqlite3.Connection, customer_id: str) -> Customer | None:
    r = conn.execute("SELECT * FROM customers WHERE id = ?", (customer_id,)).fetchone()
    return Customer(r["id"], r["name"], r["country"], r["currency"], r["tax_region"]) if r else None


def load_subscription(conn: sqlite3.Connection, sub_id: str) -> tuple[Subscription, Coupon | None]:
    s = conn.execute("SELECT * FROM subscriptions WHERE id = ?", (sub_id,)).fetchone()
    events = [Event(e["id"], e["type"], datetime.fromisoformat(e["effective_at"]), json.loads(e["payload_json"]))
              for e in conn.execute("SELECT * FROM subscription_events WHERE subscription_id = ? ORDER BY effective_at",
                                    (sub_id,))]
    coupon = None
    if s["coupon_id"]:
        c = conn.execute("SELECT * FROM coupons WHERE id = ?", (s["coupon_id"],)).fetchone()
        coupon = Coupon(c["id"], c["kind"], Decimal(c["value"]), c["duration_months"])
    sub = Subscription(s["id"], s["customer_id"], date.fromisoformat(s["start_date"]), s["billing_anchor_day"],
                       s["coupon_id"], events)
    return sub, coupon


def expected_invoice(conn: sqlite3.Connection, invoice_id: str) -> tuple[sqlite3.Row, Invoice | None]:
    """返回(库里那张发票, 参考引擎认为这个周期应该开出的发票或 None)。"""
    inv = conn.execute("SELECT * FROM invoices WHERE id = ?", (invoice_id,)).fetchone()
    if inv is None:
        raise KeyError(invoice_id)
    customer = load_customer(conn, inv["customer_id"])
    assert customer is not None
    sub, coupon = load_subscription(conn, inv["subscription_id"])
    expected = expected_for_period(customer, sub, load_plans(conn), coupon, load_rates(conn),
                                   date.fromisoformat(inv["period_start"]))
    return inv, expected
```

`expected_invoice` 就是复算工具的核心:找到这张发票所属的客户和订阅,从事件回放,算出同一个周期「应该」开出的发票。注意它按 `period_start` 去找,而不是按发票号。重复开票那类故障里,多出来的那张发票和原来那张周期一样,引擎只会算出一张应收发票,这正好能让工具发现「这个周期多了一张」。

## 完整的 server

先给审计日志加一张表。在 `schema.sql` 末尾追加:

```sql
-- billsleuth/billsleuth/schema.sql(追加在文件末尾)
-- Day 123 新增:工具调用审计日志。谁(哪个会话)在什么时候用什么参数调了哪个工具、结果如何
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    session_id TEXT,
    tool TEXT NOT NULL,
    args_json TEXT NOT NULL,
    ok INTEGER NOT NULL,
    summary TEXT NOT NULL
);
```

然后是 server 本身,比 Day 23 的长不少,大部分是返回结构的定义:

```python
# billsleuth/billsleuth/server.py
"""BillSleuth 的 MCP server:6 个只读工具 + 1 个复算工具 + 1 个只生成草稿的写工具。

运行:uv run python -m billsleuth.server   (stdio)
调试:uv run mcp dev billsleuth/server.py  (MCP Inspector)
金额在工具返回里一律是字符串(如 "123.45"),单位是发票币种,避免 JSON 里出现浮点数。
"""
from __future__ import annotations

import functools
import json
import os
import sqlite3
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Annotated, Any, Callable, TypedDict

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import Field

from billsleuth.db import connect, db_path
from billsleuth.engine import COUNTRY_TZ, local_date
from billsleuth.money import ZERO, fmt, money
from billsleuth.repo import expected_invoice

mcp = MCPServer(
    "billsleuth",
    instructions=("云簿 CloudLedger 的计费数据查询工具。查账顺序建议:get_customer → list_invoices → "
                  "get_invoice / list_payments → get_subscription_timeline → recompute_invoice。"
                  "金额都是字符串,单位是发票币种。recompute_invoice 是判断「账算没算错」的唯一依据,不要自己心算。"),
    log_level="WARNING",  # 默认 INFO 会把每个 HTTP 请求都打出来,同进程跑 Agent 时刷屏
)
READ_ONLY = ToolAnnotations(read_only_hint=True, open_world_hint=False)
DRAFT_ONLY = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=True, open_world_hint=False)
ID = r"^[A-Z]+-\d{4}(-\d{2}D?)?$"


# ---------- 公共:连接、审计 ----------

AUDIT_DDL = """CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, session_id TEXT, tool TEXT NOT NULL,
    args_json TEXT NOT NULL, ok INTEGER NOT NULL, summary TEXT NOT NULL)"""


def db() -> sqlite3.Connection:
    path = db_path()
    if not path.exists():
        raise ToolError("计费库不存在,请先运行 uv run python -m billsleuth.seed")
    conn = connect(path)
    conn.execute(AUDIT_DDL)  # 旧库里可能还没有审计表(Day 122 生成的库),用到时补建
    return conn


def audited(fn: Callable[..., Any]) -> Callable[..., Any]:
    """每次调用写一行审计日志:时间、会话、工具名、参数、成败、结果摘要。失败也记。"""
    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        ok, summary = True, ""
        try:
            result = fn(*args, **kwargs)
            summary = json.dumps(result, ensure_ascii=False, default=str)[:300]
            return result
        except ToolError as e:
            ok, summary = False, str(e)
            raise
        finally:
            with db() as conn:
                conn.execute("INSERT INTO audit_log (at, session_id, tool, args_json, ok, summary) VALUES (?,?,?,?,?,?)",
                             (datetime.now(timezone.utc).isoformat(timespec="seconds"),
                              os.environ.get("BILLSLEUTH_SESSION"), fn.__name__,
                              json.dumps(kwargs, ensure_ascii=False, default=str), int(ok), summary))
    return wrapper


# ---------- 返回结构 ----------

class CustomerOut(TypedDict):
    id: str
    name: str
    country: str
    timezone: str
    currency: str
    tax_region: str
    subscription_id: str | None


class InvoiceHeader(TypedDict):
    id: str
    period_start: str
    period_end: str
    issued_at: str
    status: str
    subtotal: str
    discount: str
    tax: str
    total: str
    currency: str


class LineOut(TypedDict):
    kind: str
    description: str
    quantity: int
    unit_amount: str
    amount: str
    period_start: str | None
    period_end: str | None
    tax_code: str | None


class InvoiceDetail(InvoiceHeader):
    customer_id: str
    subscription_id: str
    lines: list[LineOut]


class PaymentOut(TypedDict):
    id: str
    invoice_id: str
    amount: str
    status: str
    attempted_at: str
    gateway_ref: str


class EventOut(TypedDict):
    id: str
    type: str
    effective_at_utc: str
    effective_local_date: str
    payload: dict


class Timeline(TypedDict):
    subscription_id: str
    plan_id: str
    quantity: int
    status: str
    start_date: str
    billing_anchor_day: int
    current_period_start: str
    current_period_end: str
    coupon: dict | None
    customer_timezone: str
    events: list[EventOut]


class TaxRateOut(TypedDict):
    code: str
    region: str
    rate: str
    valid_from: str
    valid_to: str | None


class TaxAnswer(TypedDict):
    effective: TaxRateOut
    history: list[TaxRateOut]


class KindDiff(TypedDict):
    kind: str
    expected: str
    actual: str
    difference: str


class Recompute(TypedDict):
    invoice_id: str
    period_start: str
    period_end: str
    should_exist: bool
    reason: str
    expected_total: str
    actual_total: str
    difference: str          # actual - expected,正数表示多收
    by_kind: list[KindDiff]
    expected_lines: list[LineOut]
    actual_lines: list[LineOut]
    paid_total: str
    successful_payments: int
    other_invoices_same_period: list[str]


class CreditNoteOut(TypedDict):
    credit_note_id: str
    invoice_id: str
    amount: str
    status: str
    note: str


def header(r: sqlite3.Row) -> InvoiceHeader:
    return InvoiceHeader(id=r["id"], period_start=r["period_start"], period_end=r["period_end"],
                         issued_at=r["issued_at"], status=r["status"], subtotal=r["subtotal"],
                         discount=r["discount"], tax=r["tax"], total=r["total"], currency=r["currency"])


def line_row(r: sqlite3.Row) -> LineOut:
    return LineOut(kind=r["kind"], description=r["description"], quantity=r["quantity"],
                   unit_amount=r["unit_amount"], amount=r["amount"], period_start=r["period_start"],
                   period_end=r["period_end"], tax_code=r["tax_code"])


def must_invoice(conn: sqlite3.Connection, invoice_id: str) -> sqlite3.Row:
    r = conn.execute("SELECT * FROM invoices WHERE id = ?", (invoice_id,)).fetchone()
    if r is None:
        raise ToolError(f"发票 {invoice_id} 不存在。发票号形如 INV-0007-03,先用 list_invoices 查这个客户有哪些发票。")
    return r


# ---------- 只读工具 ----------

@mcp.tool(annotations=READ_ONLY)
@audited
def get_customer(customer_id: Annotated[str, Field(description="客户编号,如 C-0007", pattern=r"^C-\d{4}$")]) -> CustomerOut:
    """查客户基本信息:国家(决定时区)、币种、税务地区,以及订阅编号。"""
    with db() as conn:
        c = conn.execute("SELECT * FROM customers WHERE id = ?", (customer_id,)).fetchone()
        if c is None:
            raise ToolError(f"客户 {customer_id} 不存在。")
        s = conn.execute("SELECT id FROM subscriptions WHERE customer_id = ?", (customer_id,)).fetchone()
    return CustomerOut(id=c["id"], name=c["name"], country=c["country"], timezone=COUNTRY_TZ[c["country"]],
                       currency=c["currency"], tax_region=c["tax_region"], subscription_id=s["id"] if s else None)


@mcp.tool(annotations=READ_ONLY)
@audited
def list_invoices(
    customer_id: Annotated[str, Field(description="客户编号,如 C-0007", pattern=r"^C-\d{4}$")],
    limit: Annotated[int, Field(ge=1, le=24, description="最多返回几张,按计费周期倒序")] = 12,
) -> list[InvoiceHeader]:
    """列出客户的发票表头(不含行项目),最新的在前。要看行项目用 get_invoice。"""
    with db() as conn:
        rows = conn.execute("SELECT * FROM invoices WHERE customer_id = ? ORDER BY period_start DESC, id DESC LIMIT ?",
                            (customer_id, limit)).fetchall()
    if not rows:
        raise ToolError(f"客户 {customer_id} 没有发票,确认客户编号是否正确。")
    return [header(r) for r in rows]


@mcp.tool(annotations=READ_ONLY)
@audited
def get_invoice(invoice_id: Annotated[str, Field(description="发票号,如 INV-0007-03", pattern=ID)]) -> InvoiceDetail:
    """查一张发票的表头和全部行项目(订阅费、折算、折扣、税)。"""
    with db() as conn:
        r = must_invoice(conn, invoice_id)
        lines = conn.execute("SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id", (invoice_id,)).fetchall()
    return InvoiceDetail(**header(r), customer_id=r["customer_id"], subscription_id=r["subscription_id"],
                         lines=[line_row(ln) for ln in lines])


@mcp.tool(annotations=READ_ONLY)
@audited
def list_payments(
    customer_id: Annotated[str, Field(description="客户编号,如 C-0007", pattern=r"^C-\d{4}$")],
    invoice_id: Annotated[str | None, Field(description="只看某张发票的扣款;不填则看这个客户全部扣款")] = None,
) -> list[PaymentOut]:
    """列出扣款记录(含失败的),按时间倒序。同一张发票出现两笔 succeeded 就是重复扣款。"""
    sql = ("SELECT p.* FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.customer_id = ?")
    args: list[Any] = [customer_id]
    if invoice_id:
        sql += " AND p.invoice_id = ?"
        args.append(invoice_id)
    with db() as conn:
        rows = conn.execute(sql + " ORDER BY p.attempted_at DESC", args).fetchall()
    return [PaymentOut(id=r["id"], invoice_id=r["invoice_id"], amount=r["amount"], status=r["status"],
                       attempted_at=r["attempted_at"], gateway_ref=r["gateway_ref"]) for r in rows]


@mcp.tool(annotations=READ_ONLY)
@audited
def get_subscription_timeline(
    customer_id: Annotated[str, Field(description="客户编号,如 C-0007", pattern=r"^C-\d{4}$")],
) -> Timeline:
    """查订阅当前状态和全部变更事件(开通、升降级、改席位、取消)。
    每个事件同时给 UTC 时间和客户本地日期;计费规则按本地日期算。"""
    with db() as conn:
        c = conn.execute("SELECT * FROM customers WHERE id = ?", (customer_id,)).fetchone()
        s = conn.execute("SELECT * FROM subscriptions WHERE customer_id = ?", (customer_id,)).fetchone()
        if c is None or s is None:
            raise ToolError(f"客户 {customer_id} 没有订阅。")
        evs = conn.execute("SELECT * FROM subscription_events WHERE subscription_id = ? ORDER BY effective_at",
                           (s["id"],)).fetchall()
        coupon = conn.execute("SELECT * FROM coupons WHERE id = ?", (s["coupon_id"],)).fetchone() if s["coupon_id"] else None
    return Timeline(
        subscription_id=s["id"], plan_id=s["plan_id"], quantity=s["quantity"], status=s["status"],
        start_date=s["start_date"], billing_anchor_day=s["billing_anchor_day"],
        current_period_start=s["current_period_start"], current_period_end=s["current_period_end"],
        coupon=dict(coupon) if coupon else None, customer_timezone=COUNTRY_TZ[c["country"]],
        events=[EventOut(id=e["id"], type=e["type"], effective_at_utc=e["effective_at"],
                         effective_local_date=local_date(datetime.fromisoformat(e["effective_at"]), c["country"]).isoformat(),
                         payload=json.loads(e["payload_json"])) for e in evs])


@mcp.tool(annotations=READ_ONLY)
@audited
def get_tax_rate(
    region: Annotated[str, Field(description="税务地区,如 CN、SG、DE、US,来自 get_customer 的 tax_region")],
    on: Annotated[str, Field(description="哪一天的税率,YYYY-MM-DD,一般填发票的 period_start")],
) -> TaxAnswer:
    """查某地区某一天有效的税率,同时返回这个地区的税率历史(看有没有用到过期税率)。"""
    try:
        day = date.fromisoformat(on)
    except ValueError:
        raise ToolError(f"日期格式不对:{on},要 YYYY-MM-DD") from None
    with db() as conn:
        rows = conn.execute("SELECT * FROM tax_rates WHERE region = ? ORDER BY valid_from", (region,)).fetchall()
    if not rows:
        raise ToolError(f"没有地区 {region} 的税率。")
    hist = [TaxRateOut(code=r["code"], region=r["region"], rate=r["rate"], valid_from=r["valid_from"],
                       valid_to=r["valid_to"]) for r in rows]
    eff = [h for h in hist if h["valid_from"] <= on and (h["valid_to"] is None or on <= h["valid_to"])]
    if not eff:
        raise ToolError(f"{region} 在 {day} 没有有效税率。")
    return TaxAnswer(effective=eff[0], history=hist)


# ---------- 复算工具 ----------

def _line_out(ln: Any) -> LineOut:
    return LineOut(kind=ln.kind, description=ln.description, quantity=ln.quantity, unit_amount=fmt(ln.unit_amount),
                   amount=fmt(ln.amount), period_start=ln.period_start and ln.period_start.isoformat(),
                   period_end=ln.period_end and ln.period_end.isoformat(), tax_code=ln.tax_code)


@mcp.tool(annotations=READ_ONLY)
@audited
def recompute_invoice(invoice_id: Annotated[str, Field(description="要复算的发票号", pattern=ID)]) -> Recompute:
    """用参考计费引擎重算这张发票所在周期「应该」收多少,和实际发票逐类对比。
    difference = 实际 - 应收,正数就是多收。should_exist=false 表示这个周期本不该开票。
    同时给出这张发票的实际扣款合计,以及同一周期的其他发票(查重复开票)。"""
    with db() as conn:
        try:
            inv, exp = expected_invoice(conn, invoice_id)
        except KeyError:
            raise ToolError(f"发票 {invoice_id} 不存在。") from None
        actual_lines = conn.execute("SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id", (invoice_id,)).fetchall()
        pays = conn.execute("SELECT amount FROM payments WHERE invoice_id = ? AND status = 'succeeded'",
                            (invoice_id,)).fetchall()
        same = [r["id"] for r in conn.execute(
            "SELECT id FROM invoices WHERE subscription_id = ? AND period_start = ? AND id != ? ORDER BY id",
            (inv["subscription_id"], inv["period_start"], invoice_id))]
    kinds = ["recurring", "proration", "discount", "tax", "adjustment"]
    act_by = {k: money(sum((Decimal(r["amount"]) for r in actual_lines if r["kind"] == k), ZERO)) for k in kinds}
    exp_by = {k: money(sum((ln.amount for ln in exp.lines if ln.kind == k), ZERO)) if exp else ZERO for k in kinds}
    expected_total = exp.total if exp else ZERO
    actual_total = Decimal(inv["total"])
    if exp is None:
        reason = "按订阅事件,这个周期不应该开票(订阅已到期取消或处于暂停)"
    elif same:
        reason = f"这个周期还有其他发票:{', '.join(same)},可能重复开票"
    elif actual_total == expected_total:
        reason = "金额与参考引擎一致"
    else:
        reason = "金额与参考引擎不一致,看 by_kind 找差在哪一类"
    return Recompute(
        invoice_id=invoice_id, period_start=inv["period_start"], period_end=inv["period_end"],
        should_exist=exp is not None, reason=reason,
        expected_total=fmt(expected_total), actual_total=fmt(actual_total), difference=fmt(actual_total - expected_total),
        by_kind=[KindDiff(kind=k, expected=fmt(exp_by[k]), actual=fmt(act_by[k]), difference=fmt(act_by[k] - exp_by[k]))
                 for k in kinds if exp_by[k] != ZERO or act_by[k] != ZERO],
        expected_lines=[_line_out(ln) for ln in exp.lines] if exp else [],
        actual_lines=[line_row(r) for r in actual_lines],
        paid_total=fmt(sum((Decimal(p["amount"]) for p in pays), ZERO)), successful_payments=len(pays),
        other_invoices_same_period=same,
    )


# ---------- 写工具:只生成草稿 ----------

@mcp.tool(annotations=DRAFT_ONLY)
@audited
def draft_credit_note(
    invoice_id: Annotated[str, Field(description="要冲正的发票号", pattern=ID)],
    amount: Annotated[str, Field(description="冲正金额,字符串,两位小数,如 \"23.40\"", pattern=r"^\d+\.\d{2}$")],
    reason: Annotated[str, Field(min_length=10, max_length=300, description="冲正原因,写清根因和算式")],
) -> CreditNoteOut:
    """为多收的钱起草一张贷记单(credit note)。只生成 draft,不会退款,签发要人工审批。
    同一张发票已有草稿时直接返回那张草稿,不会重复创建。"""
    amt = money(amount)
    with db() as conn:
        inv = must_invoice(conn, invoice_id)
        paid = sum((Decimal(p["amount"]) for p in conn.execute(
            "SELECT amount FROM payments WHERE invoice_id = ? AND status = 'succeeded'", (invoice_id,))), ZERO)
        if amt <= 0:
            raise ToolError("冲正金额必须大于 0。")
        if amt > paid:
            raise ToolError(f"冲正金额 {fmt(amt)} 超过了这张发票的实际扣款合计 {fmt(paid)}。")
        existing = conn.execute("SELECT * FROM credit_notes WHERE invoice_id = ? AND status = 'draft'",
                                (invoice_id,)).fetchone()
        if existing:
            return CreditNoteOut(credit_note_id=existing["id"], invoice_id=invoice_id, amount=existing["amount"],
                                 status="draft", note="这张发票已有草稿,未重复创建")
        n = conn.execute("SELECT COUNT(*) FROM credit_notes").fetchone()[0] + 1
        cn_id = f"CN-{n:04d}"
        conn.execute("INSERT INTO credit_notes VALUES (?,?,?,?,?)", (cn_id, invoice_id, amt, reason, "draft"))
    return CreditNoteOut(credit_note_id=cn_id, invoice_id=inv["id"], amount=fmt(amt), status="draft",
                         note="已生成草稿,等待人工审批后才会签发")


if __name__ == "__main__":
    mcp.run()
```

这段代码的写法和 Day 23 一样:`MCPServer`、`@mcp.tool(annotations=...)`、返回值用 `TypedDict` 声明,SDK 据此生成 outputSchema 并把结果放进 `structured_content`。下面挑几处新东西讲。

### 复算工具的返回结构

`recompute_invoice` 的返回值是我反复改过几版的。第一版只返回 `expected_total` 和 `actual_total`,模型拿到两个数以后,开始自己相减、自己猜原因,有时候减错。现在的版本是这样设计的:

- `difference` 直接给出「实际 − 应收」,正数就是多收,模型不用做减法。
- `by_kind` 按订阅费、折算、折扣、税分类给出应收、实收和差额,模型一眼就知道该顺着哪条线查。
- `should_exist` 和 `reason` 处理「这个周期根本不该开票」的情况,比如订阅已取消。
- `paid_total` 和 `successful_payments` 顺带给出这张发票实际扣了几笔、多少钱,重复扣款的场景里,发票本身没错,但扣款合计是发票金额的两倍。
- `other_invoices_same_period` 列出同一订阅同一周期的其他发票,专门对付重复开票。

拿 S011(时区那个场景)看一下实际返回:

```json
{
  "invoice_id": "INV-0011-03",
  "period_start": "2026-08-01",
  "period_end": "2026-09-01",
  "should_exist": true,
  "reason": "金额与参考引擎不一致,看 by_kind 找差在哪一类",
  "expected_total": "1412.42",
  "actual_total": "1438.44",
  "difference": "26.02",
  "by_kind": [
    {"kind": "recurring", "expected": "890.00", "actual": "890.00", "difference": "0.00"},
    {"kind": "proration", "expected": "405.80", "actual": "429.67", "difference": "23.87"},
    {"kind": "tax", "expected": "116.62", "actual": "118.77", "difference": "2.15"}
  ],
  "paid_total": "1438.44",
  "successful_payments": 1,
  "other_invoices_same_period": []
}
```

(省略了 `expected_lines` 和 `actual_lines` 两个列表。)差额 26.02 里 23.87 来自折算,2.15 是跟着多出来的税。模型接下来该做的就是查订阅事件:`get_subscription_timeline` 显示升级事件的 UTC 时间是 `2026-07-14T22:50:00+00:00`,客户本地日期是 `2026-07-15`;而发票上折算行写的是「2026-07-14 至 2026-08-01」。本地日期和折算起始日差了一天,原因就清楚了。整个推理过程模型一次减法都不用做。

你可能会担心:这样是不是把答案直接喂给 Agent 了?是,也不是。差多少确实直接给了,但「为什么差」还要 Agent 自己去查、去对比,而且根因分类、要不要冲正、怎么跟客户解释,都还是 Agent 的工作。更重要的是,在真实公司里你也应该这样设计工具。让 Agent 去做计算器能做的事,既慢又不可靠。代价是评测会偏简单,这个我们在 Day 127 正面处理。

### 读写分离和工具注解

`READ_ONLY` 和 `DRAFT_ONLY` 两个注解对应 MCP 规范里的工具提示:`read_only_hint` 说明工具不改数据,`destructive_hint` 说明会不会破坏已有数据,`idempotent_hint` 说明重复调用是否等价。这些提示本身不会阻止任何事,但支持 MCP 的客户端(比如 Claude Desktop、各种 IDE)会根据它们决定是否需要用户确认。

真正的保护在工具内部。`draft_credit_note` 有三道检查:金额必须大于 0;不能超过这张发票的实际扣款合计;同一张发票已经有草稿时,直接返回那张草稿,不重复创建。第三条就是最朴素的幂等。Agent 在循环里可能因为没看到结果或者被打断而重复调用同一个工具,写操作必须经得起重复。Day 126 会把幂等做得更完整,用显式的幂等键。

金额参数也是字符串,而且 schema 里用正则限定为两位小数,`"174.9"` 这样的值在函数执行前就会被 SDK 拦下来。

### 审计日志

`@audited` 装饰器给每个工具加了一层:调用结束后(不管成功还是抛了 `ToolError`)写一行 `audit_log`,记录时间、会话 ID、工具名、参数、成败和结果摘要。会话 ID 从环境变量 `BILLSLEUTH_SESSION` 读,明天建图的时候每次调查设一个新的。

为什么失败也要记?因为最能说明问题的往往是失败。一个 Agent 连续五次用编造的发票号调 `get_invoice`,在审计日志里是一眼就能看出来的模式;如果只记成功,这五次就消失了。计费系统的审计日志还有合规上的意义:客户来问「你们的 AI 看过我的哪些数据」,你要能答得上来。

装饰器的顺序有讲究:`@mcp.tool` 在外,`@audited` 在内。`functools.wraps` 会保留原函数的签名和类型标注,SDK 就能照常生成参数 schema。如果把两个装饰器反过来,SDK 注册的是没有审计的原函数。

`db()` 里每次连库都执行一遍 `CREATE TABLE IF NOT EXISTS`,是为了兼容昨天生成的旧库。代价很小,好处是不用要求读者重新造数。

### 返回列表时的一个小坑

`list_invoices` 和 `list_payments` 返回的是列表。MCP 规范要求结构化结果是一个对象,所以 SDK 会自动包一层 `{"result": [...]}`。客户端读的时候要记得拆开,明天的 `mcp_bridge.py` 里会处理。这一点 Day 23 也提过,这里再提醒一次,因为它在评测里会变成一个很隐蔽的 bug:Agent 收到的是 `{"result": [...]}`,证据抽取代码却按列表去遍历。

## 在 Inspector 里调试

```bash
npx @modelcontextprotocol/inspector uv run python -m billsleuth.server
```

用 `python -m` 的方式启动,是因为我们的 server 是包里的一个模块,要以包的方式导入 `billsleuth.engine` 等兄弟模块。Day 23 用的 `uv run mcp dev server.py` 适合单文件 server,这里直接传文件路径的话,`from billsleuth.db import …` 能不能找到包取决于启动时的工作目录和 sys.path,不如 `-m` 稳妥。

打开 Inspector 后,建议按这个顺序过一遍,每一步都想想「模型看到这个结果会怎么想」:

1. List Tools,确认 8 个工具都在,点开 `draft_credit_note` 看 `amount` 参数的 pattern,再看注解里的 `readOnlyHint` 和 `idempotentHint`。
2. 调 `get_customer`,填 `C-0011`,看返回里的 `timezone`。
3. 调 `get_subscription_timeline`,看升级事件的 `effective_at_utc` 和 `effective_local_date` 差了一天。
4. 调 `recompute_invoice`,填 `INV-0011-03`,对照上面的 JSON。
5. 调 `get_invoice`,填 `INV-0011-09`(不存在),看报错文案。
6. 调 `draft_credit_note` 两次,参数一样,看第二次返回的 `note`。

做完以后,在终端里看审计日志:

```bash
sqlite3 billing.db "SELECT at, tool, ok, substr(summary, 1, 60) FROM audit_log ORDER BY id DESC LIMIT 10;"
```

## 用内存客户端测试

```python
# billsleuth/tests/test_server.py
"""用内存客户端测 MCP server。最重要的一条:对 100 个场景,复算工具都能把标准答案里的差额算出来。"""
import json
import shutil
import sqlite3
from decimal import Decimal

import pytest
from mcp import Client

from billsleuth import seed
from billsleuth.db import ROOT
from billsleuth.server import mcp

SCENARIOS = sorted((ROOT / "scenarios").glob("S*.json"))


@pytest.fixture(scope="module")
def master_db(tmp_path_factory):
    path = tmp_path_factory.mktemp("db") / "master.db"
    mp = pytest.MonkeyPatch()
    mp.setenv("BILLSLEUTH_DB", str(path))
    seed.main()
    mp.undo()
    return path


@pytest.fixture(autouse=True)
def fresh_db(master_db, tmp_path, monkeypatch):
    path = tmp_path / "billing.db"
    shutil.copy(master_db, path)  # 每个测试一份干净副本,写操作互不影响
    monkeypatch.setenv("BILLSLEUTH_DB", str(path))
    return path


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    async with Client(mcp, raise_exceptions=True) as c:
        yield c


async def call(client, name, args):
    r = await client.call_tool(name, args)
    assert not r.is_error, r.content[0].text
    return r.structured_content


@pytest.mark.anyio
async def test_tool_list(client):
    names = {t.name for t in (await client.list_tools()).tools}
    assert names == {"get_customer", "list_invoices", "get_invoice", "list_payments", "get_subscription_timeline",
                     "get_tax_rate", "recompute_invoice", "draft_credit_note"}


@pytest.mark.anyio
@pytest.mark.parametrize("path", SCENARIOS, ids=[p.stem for p in SCENARIOS])
async def test_recompute_finds_every_overcharge(client, path):
    truth = json.loads(path.read_text())["truth"]
    r = await call(client, "recompute_invoice", {"invoice_id": truth["invoice_ids"][0]})
    if truth["variant"] == "duplicate_invoice":
        assert r["other_invoices_same_period"]  # 工具点出了同周期还有一张
        found = Decimal(r["actual_total"])
    else:
        found = Decimal(r["paid_total"]) - Decimal(r["expected_total"])
    assert found == Decimal(truth["overcharge"])


@pytest.mark.anyio
async def test_bad_invoice_id_is_rejected_by_schema(client):
    r = await client.call_tool("get_invoice", {"invoice_id": "12345"})
    assert r.is_error


@pytest.mark.anyio
async def test_unknown_invoice_message_tells_model_what_to_do(client):
    r = await client.call_tool("get_invoice", {"invoice_id": "INV-9999-01"})
    assert r.is_error and "list_invoices" in r.content[0].text


@pytest.mark.anyio
async def test_timeline_gives_local_date(client):
    t = await call(client, "get_subscription_timeline", {"customer_id": "C-0001"})
    assert all("effective_local_date" in e for e in t["events"])


@pytest.mark.anyio
async def test_credit_note_is_draft_and_idempotent(client, fresh_db):
    args = {"invoice_id": "INV-0001-05", "amount": "174.90", "reason": "订阅已到期取消,这张发票不应开出,全额冲正"}
    a = await call(client, "draft_credit_note", args)
    b = await call(client, "draft_credit_note", args)
    assert a["status"] == "draft" and a["credit_note_id"] == b["credit_note_id"]
    with sqlite3.connect(fresh_db) as conn:
        assert conn.execute("SELECT COUNT(*) FROM credit_notes").fetchone()[0] == 1


@pytest.mark.anyio
async def test_credit_note_cannot_exceed_paid(client):
    r = await client.call_tool("draft_credit_note",
                               {"invoice_id": "INV-0001-05", "amount": "9999.00", "reason": "测试超额冲正会被拒绝"})
    assert r.is_error and "超过" in r.content[0].text


@pytest.mark.anyio
async def test_every_call_is_audited(client, fresh_db):
    await call(client, "get_customer", {"customer_id": "C-0001"})
    await client.call_tool("get_invoice", {"invoice_id": "INV-9999-01"})
    with sqlite3.connect(fresh_db) as conn:
        rows = conn.execute("SELECT tool, ok FROM audit_log ORDER BY id").fetchall()
    assert rows == [("get_customer", 1), ("get_invoice", 0)]
```

```bash
uv run pytest -q tests/test_server.py
```

`test_recompute_finds_every_overcharge` 是今天的主角。它对 100 个场景逐个调用复算工具,验证工具给出的信息足以算出标准答案:重复开票的场景,工具必须点出同周期还有别的发票,且这张多出来的发票的总额就是多收金额;其余场景,「实际扣款合计 − 应收」必须等于标准答案。100 个全部通过,说明**只要 Agent 用对了工具,答案就在那里**。如果某个场景这里就过不了,那是工具或数据的问题,不该让 Agent 背锅。

这类测试我称为「可解性测试」:在评测 Agent 之前,先证明每道题对一个会用工具的人来说是可解的。Day 73 讲 SWE-bench Verified 时说过,原版 SWE-bench 里有相当一部分题目描述不清或测试有问题,人工筛过之后才有了 Verified 版本。我们的数据是合成的,可以直接用代码完成这一步。

`master_db` 这个 fixture 只造一次数据,每个测试再复制一份干净的库,写操作的测试(草稿、审计)互不影响。所有测试一共跑 5 秒左右。

## 动手练习

1. 写 `billsleuth/repo.py` 和 `billsleuth/server.py`,在 `schema.sql` 末尾追加审计表。
2. `uv run python -m billsleuth.seed` 重新造数(带上审计表),然后 `uv run pytest -q`,确认引擎、造数、server 三组测试全部通过(一共 217 个,其中 100 个是可解性测试)。
3. 用 Inspector 按上面的六步过一遍,截一张 `recompute_invoice` 的结果图,以后放进作品的案例页。
4. **改坏一个工具看看**:把 `recompute_invoice` 返回里的 `difference` 和 `by_kind` 删掉,只留 `expected_total` 和 `actual_total`。可解性测试还会过(信息还在),但你想想模型拿到这个结果后要多做几步。明天接上 Agent 以后,可以回来对比两种返回结构下的步数和准确率。
5. 选做:加一个 `explain_proration(invoice_id)` 工具,返回每条折算行的「整期金额、剩余天数、周期天数、算式」,让模型能直接引用算式给客户解释。Day 128 会讨论要不要加这类专用工具。

**验收标准**:全部测试通过;Inspector 里能看到 8 个工具和它们的注解;同样参数调两次 `draft_credit_note`,数据库里只有一张草稿;审计日志里能看到成功和失败的调用。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 工具粒度 | 一个工具做多大一件事;太细模型要调很多次,太粗结果太长、权限太大 |
| 结构化结果 structured_content | MCP 工具按 outputSchema 返回的 JSON 对象,列表会被包成 `{"result": [...]}` |
| 工具注解 tool annotations | `read_only_hint`、`destructive_hint`、`idempotent_hint` 等提示,供客户端决定是否要用户确认 |
| ToolError | 业务错误,以 `is_error=True` 的结果返回给模型,不是服务器崩溃 |
| 复算 recompute | 用参考引擎重算某个周期的应收,并与实际发票逐类对比 |
| 幂等 idempotent | 同样的请求执行一次和执行多次,效果相同 |
| 审计日志 audit log | 记录谁在什么时候用什么参数调用了什么、结果如何,失败也记 |
| 可解性测试 | 评测前先证明每道题用现有工具可以得到正确答案 |
| MCP Inspector | 官方的 MCP 调试工具,网页上手动列工具、调工具 |

## 常见误区

**给 Agent 一个 run_sql 工具最省事。** 省的是你写工具的时间,费的是模型的推理和你的安全审计。SQL 能读任何客户的任何表,一次注入攻击就是数据泄露。按动作切分的工具,每个都能加客户范围检查。

**金额用 JSON 数字返回。** 数字在序列化和反序列化中可能变成 float,模型也更倾向于把数字拿去算。字符串金额是对模型的一个提示:这是精确值,照抄。

**报错只写「失败」。** 模型看不懂错误就会重试同样的参数,或者干脆编一个结果。报错里写清楚哪里错、正确格式长什么样、下一步该调哪个工具。

**审计只记成功的调用。** 失败的调用恰恰最能暴露 Agent 的问题(编造 ID、越权尝试),也是合规审计最关心的部分。

**写工具不做幂等。** Agent 循环里重复调用很常见。不幂等的写工具,重复一次就是两张贷记单、两笔退款。

**工具里做的计算越少越「纯粹」。** 对 Agent 来说正好相反。能确定地算出来的东西,在工具里算好再返回,模型只负责需要判断的部分。

## 学习资料

### 文档与文章

- [Anthropic · Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents):工具设计最好的一篇实践文章,重点看「返回有意义的上下文」「写好报错」两节,30 分钟。
- [MCP 规范 · Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools):工具定义、结构化结果、annotations 的正式规定,20 分钟。
- [MCP Python SDK 文档 · Testing](https://py.sdk.modelcontextprotocol.io/get-started/testing/):内存客户端测试的官方写法,10 分钟。
- [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector):Inspector 的用法和启动参数,10 分钟。
- [Stripe · Credit notes(API 方式)](https://docs.stripe.com/invoicing/integration/programmatic-credit-notes):看真实系统里贷记单有哪些字段和限制(比如不能超过发票金额),对照我们的三道检查,15 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Y854zmEg9&autoplay=0&high_quality=1" title="MCP终极指南 - 带你深入掌握MCP(进阶篇)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>马克的技术工作坊 · MCP终极指南 - 带你深入掌握MCP(进阶篇) · 27 分钟,Day 23 推荐过,讲 server 开发和 host 如何调用。写完今天的 server 再看一遍,会有不同的体会。代码是旧版 FastMCP 写法,以本文为准。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1CUdZYDE8k&autoplay=0&high_quality=1" title="2分钟使用Python构建MCP Server" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序猿DD · 2分钟使用Python构建MCP Server · 3 分钟的快速回顾,忘了 MCP server 基本结构的可以先看这个。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/kQmXtrmQ5Zg" title="Building Agents with Model Context Protocol - Full Workshop with Mahesh Murag of Anthropic" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · Building Agents with Model Context Protocol - Full Workshop with Mahesh Murag of Anthropic · MCP 团队成员的工作坊,前 40 分钟讲设计理念,其中讲工具描述和返回结构的部分和今天最相关。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章 Agents 部分的工具一节,讲只读工具和写工具的区别,以及给写操作加人工确认,和今天的读写分离直接对应。
- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly, 2017):第 11 章讲幂等和「恰好一次」语义,写 `draft_credit_note` 的幂等之前读一下。
- 今天的主题(Agent 工具设计)目前没有比上面那篇 Anthropic 文章更系统的书,先以文章为主。

### 开源项目与代码

- [modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk):SDK 源码,想弄清 `structured_content` 怎么生成、列表为什么被包一层,看 server 里处理工具返回值的那部分。
- [modelcontextprotocol/inspector](https://github.com/modelcontextprotocol/inspector):Inspector 源码和 CLI 模式说明,CLI 模式可以在脚本里调工具。
- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench):看它给航空和零售场景设计的工具,每个工具的粒度和返回结构都值得参考。

## 自测

1. 为什么 BillSleuth 不提供 `run_sql` 工具?举两个理由。

<details><summary>答案</summary>

一是安全:SQL 能访问所有客户的所有表,没法做客户范围检查,也容易被注入攻击利用。二是好用:模型要自己知道表结构和关联关系,还要自己算金额,出错概率高。按查账动作切分的工具,每个都能做权限检查,返回结构也是为模型设计的。

</details>

2. `recompute_invoice` 为什么要返回 `difference` 和 `by_kind`,而不是只返回应收和实收两个总额?

<details><summary>答案</summary>

只给两个总额,模型要自己相减、自己猜差在哪,既多一步推理又可能算错。`difference` 直接给出多收金额,`by_kind` 告诉模型差在订阅费、折算、折扣还是税,模型下一步该查哪条线一目了然。原则是能确定计算的都在工具里算好。

</details>

3. 重复扣款的场景里,`recompute_invoice` 的 `difference` 是多少?Agent 怎么发现问题?

<details><summary>答案</summary>

`difference` 是 0.00,因为发票本身没算错。但 `successful_payments` 是 2,`paid_total` 是发票金额的两倍。Agent 也可以用 `list_payments` 看到同一张发票有两笔 succeeded 的扣款,相隔几分钟。

</details>

4. 装饰器写成 `@audited` 在外、`@mcp.tool` 在内,会发生什么?

<details><summary>答案</summary>

`@mcp.tool` 会先把原函数注册成工具,注册进 server 的是没有审计逻辑的原函数;外层的 `@audited` 只是包了一个新函数,而 server 根本不会调用它。结果是工具照常工作,但审计日志一行都不写,而且不会报任何错。

</details>

5. 什么是可解性测试?它和评测 Agent 有什么区别?

<details><summary>答案</summary>

可解性测试验证的是题目本身:用现有工具,一个会用工具的人能不能得到标准答案。它不涉及模型,确定性地跑,失败说明数据或工具有问题。评测 Agent 测的是模型能不能找到这条路。先保证题目可解,再评测 Agent,否则会把题目的错误算到 Agent 头上。

</details>

6. 资深面试题:你们公司要把内部的计费后台开放给一个 Agent 用,后台已经有几十个 REST 接口。你会直接把这些接口包成 MCP 工具吗?怎么设计?

<details><summary>答案</summary>

不会直接一比一包装。现有接口是给前端页面设计的,粒度、返回字段、分页方式、错误码都按页面需求来,对模型并不友好,而且权限通常按「登录用户」而不是按「这次调查涉及的客户」来控制。我会先整理客服或财务查账的真实流程,按动作设计十个以内的工具;每个工具内部组合调用现有接口,在工具里完成时区、税率、应收计算这类确定性逻辑;返回结构精简、金额用字符串、报错写清下一步;读写分离,写操作只开放起草类接口并强制幂等和人工审批;每个工具做客户范围检查;所有调用写审计日志,包括失败。上线前用一批历史工单做可解性检查,确认工具集合足以回答问题,再评测 Agent。最后说明维护成本:工具层是一个需要专人维护的产品,接口变化要有契约测试。

</details>

## 明天预告

明天(Day 124)把 Agent 接上来:用 LangGraph 搭调查流程,先读懂客户在抱怨什么,用代码定位候选发票,再进入「提出假设、调用工具验证」的循环,最后提交一份结构化结论。每次工具调用的结果会被代码自动抽成带编号的证据,存进证据链。我们会用真模型跑几个场景,看它怎么一步步查出时区那一天的差别。
