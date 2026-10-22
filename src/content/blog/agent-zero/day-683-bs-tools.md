---
title: 'Day 683 · BillSleuth(四):MCP 工具层、复算工具、Inspector 和测试'
description: '在 billing.db 和 Agent 之间搭一层 MCP server:按查账的动作切出 6 个只读工具、1 个调用参考引擎逐类对比的 recompute_invoice、1 个只写草稿且重复调用不重复创建的 draft_credit_note,每次调用都写审计日志。用 Inspector CLI 把六步检查跑一遍,顺手踩到两个真坑(-m 被吞、26.02 被当成浮点数);最后用内存客户端写 107 条测试,其中 100 条证明每个场景用这些工具都算得出标准答案。'
pubDate: 2026-10-22
regime: none
tags: ['billsleuth', 'mcp', 'tool-design', 'mcp-inspector', 'agent-zero']
series: 'agent-zero'
day: 683
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 682](/blog/agent-zero/day-682-bs-faults/) 造好了题目:12 个按真实 bug 机制改坏账的注入函数,一个固定种子的造数脚本,100 个场景(80 个有错、20 个没错)写进 `billing.db`,标准答案写进 `scenarios/`。自检测试不信注入函数,自己拿引擎重算再用客户实付去减,100 个分毫不差;把扣款挪到注入之前,80 个场景当场全红。

现在有了账,也有了答案,中间还缺一层:Agent 怎么查这些账?它不能直接读数据库,也不该自己算钱。今天写 BillSleuth 的 MCP server,这是 Agent 唯一能碰到数据的地方。[Day 281](/blog/agent-zero/day-281-mcp-first-tool/) 到 [Day 287](/blog/agent-zero/day-287-mcp-test/) 给 CloudLedger 写过一个 MCP server,今天的 SDK 写法一样,但工具设计要讲究得多:计费 Agent 一旦拿到不好用的工具,就会开始自己算账,那正是我们最不想看到的。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说出给计费 Agent 设计工具的五个判断(按动作切、列表只给表头、金额是字符串、报错告诉模型下一步、能在工具里算的别让模型算),并能拿 BillSleuth 的 8 个工具逐个举例。
2. 写出 `repo.py` 和 `server.py`,其中 `recompute_invoice` 调用参考引擎,把应收和实收按类别逐项对比,`draft_credit_note` 只写草稿、超额拒绝、重复调用返回同一张。
3. 用一个装饰器给每次工具调用写审计日志,成功失败都记,并说清楚哪一类失败根本到不了这个装饰器。
4. 用 Inspector CLI 调工具、看注解,用内存客户端写「可解性测试」:证明 100 个场景每个都能用这些工具算出标准答案。

预计用时 3 小时。前置:[Day 682](/blog/agent-zero/day-682-bs-faults/)(造数和 `scenarios/`)、[Day 681](/blog/agent-zero/day-681-bs-engine-2/)(引擎、`expected_for_period`)、[Day 281](/blog/agent-zero/day-281-mcp-first-tool/) 到 [Day 285](/blog/agent-zero/day-285-mcp-inspector/)(MCP server、`ToolError`、读写分离和 `ToolAnnotations`、Inspector)、[Day 287](/blog/agent-zero/day-287-mcp-test/)(内存客户端测试)、[Day 182](/blog/agent-zero/day-182-tool-design-2/)(好工具的六条原则)、[Day 96](/blog/agent-zero/day-096-decorators/)(装饰器)、[Day 47](/blog/agent-zero/day-047-type-hints-3/)(TypedDict)。今天不调模型,花费 0 元。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `audited` 装饰器和 `recompute_invoice` 的返回结构默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先想清楚:工具是给模型用的 API

[Day 180](/blog/agent-zero/day-180-tool-design-1/) 说过一句话:工具不是 API,使用者变了。给人用的接口,调用方会读文档、写单元测试;给模型用的工具,模型只看名字、描述、参数 schema 和返回结果,然后就开始用了。Anthropic 那篇《Writing effective tools for agents》说得更直白:工具是你和一个非确定性的使用者之间的契约。设计时要假设使用者聪明但粗心、不会追问、看到什么就信什么。

落到 BillSleuth 上,我做了五个判断。

**粒度跟着查账的动作走,不跟着表走。** 最自然的设计是一张表一个工具(`query_invoices`、`query_invoice_lines`、`query_payments`),甚至干脆给一个 `run_sql`。这对模型很不友好:它得自己知道表怎么关联,发票表头和行项目要分两次查;`run_sql` 还能读任何客户的任何表,一次提示注入就是数据泄露([Day 411](/blog/agent-zero/day-411-permissions-1/) 讲过过度授权的账)。我按客服查账时的动作来切:看客户、看发票列表、看一张发票的明细、看扣款、看订阅变化、看税率、复算。每个工具回答一个查账时会问的问题。

**列表只给表头,明细单独查。** `list_invoices` 只返回周期、合计、状态,不带行项目;要看明细再调 `get_invoice`。一个客户五张发票、每张四五行,全塞进一个结果里上下文就满了。

**金额全是字符串。** 返回 JSON 数字的话,`1438.44` 在序列化的某个环节可能变成浮点数;返回 `"1438.44"` 就没有这个问题,也顺便提醒模型:这是精确值,照抄,别拿去心算。今天在 Inspector 里你会亲眼看到一个数字被当成 float 的现场。

**报错写给模型看,告诉它下一步。** 「发票不存在」对人够了,对模型不够。我们的报错是「发票 INV-0011-09 不存在。发票号形如 INV-0007-03,先用 list_invoices 查这个客户有哪些发票。」模型读到这句,下一步大概率就是去调 `list_invoices`。[Day 282](/blog/agent-zero/day-282-mcp-errors/) 讲过这一条。

**能在工具里算的,就别让模型算。** 这是最重要的一条。时区换算、税率有效期、应收金额,全在工具里算好给出结果。`get_subscription_timeline` 不只返回 UTC 时间,还返回换算好的客户本地日期;`recompute_invoice` 直接告诉模型差了多少、差在哪一类。模型的工作是判断「为什么差」,不是算「差多少」。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="BillSleuth 工具分层:最上面是 Agent;中间是 6 个只读查询工具、1 个复算工具、1 个只写草稿的工具;下面是每次调用都经过的审计装饰器;最底下是 billing.db 和参考引擎">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="20" y="16" width="600" height="38" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="320" y="40" text-anchor="middle" font-size="12" fill="var(--mem)">Agent(只看工具名、描述、schema、返回值)</text>
    <rect x="20" y="72" width="300" height="114" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="170" y="92" text-anchor="middle" font-size="12" fill="var(--compute)">只读查询(6)</text>
    <text x="34" y="116" fill="var(--compute)">get_customer   list_invoices</text>
    <text x="34" y="136" fill="var(--compute)">get_invoice    list_payments</text>
    <text x="34" y="156" fill="var(--compute)">get_subscription_timeline</text>
    <text x="34" y="176" fill="var(--compute)">get_tax_rate</text>
    <rect x="334" y="72" width="140" height="114" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="404" y="92" text-anchor="middle" font-size="12" fill="var(--compute)">复算(1)</text>
    <text x="404" y="122" text-anchor="middle" fill="var(--compute)">recompute_</text>
    <text x="404" y="138" text-anchor="middle" fill="var(--compute)">invoice</text>
    <text x="404" y="166" text-anchor="middle" fill="var(--compute)">调参考引擎</text>
    <rect x="488" y="72" width="132" height="114" rx="4" fill="none" stroke="var(--compute)" stroke-dasharray="5 3"/>
    <text x="554" y="92" text-anchor="middle" font-size="12" fill="var(--compute)">写草稿(1)</text>
    <text x="554" y="122" text-anchor="middle" fill="var(--compute)">draft_credit_</text>
    <text x="554" y="138" text-anchor="middle" fill="var(--compute)">note</text>
    <text x="554" y="166" text-anchor="middle" fill="var(--compute)">只到 draft</text>
    <rect x="20" y="202" width="600" height="34" rx="4" fill="none" stroke="var(--rule)"/>
    <text x="320" y="224" text-anchor="middle" fill="var(--ink)">@audited:每次调用写 audit_log(时间、会话、工具、参数、成败、摘要)</text>
    <rect x="20" y="250" width="600" height="34" rx="4" fill="none" stroke="var(--ink-soft)"/>
    <text x="320" y="272" text-anchor="middle" fill="var(--ink-soft)">billing.db  +  engine.py(经 repo.py 读回对象)    scenarios/ 不在这里</text>
  </g>
</svg>
<figcaption>虚线框是唯一的写工具,它只能把贷记单写成草稿。所有工具都经过同一个审计装饰器。标准答案目录不在工具能碰到的范围里。</figcaption>
</figure>

## 第一步:从库里读回引擎对象

复算工具要调参考引擎,引擎吃的是内存里的 `Customer`、`Subscription`、`Event` 对象,库里存的是字符串。先写一个读库的小模块,把一行行数据变回对象:

```python
# billsleuth/billsleuth/repo.py  从 billing.db 把数据读回引擎用的对象,复算工具和评测都靠它
import json
import sqlite3
from datetime import date, datetime
from decimal import Decimal

from billsleuth.engine import Coupon, Customer, Event, Invoice, Plan, Subscription, TaxRate, expected_for_period


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
    """返回(库里那张发票, 参考引擎认为这个周期应该开出的发票,本不该开就是 None)。"""
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

<div class="line-notes">

- `from billsleuth.engine import Coupon, Customer, Event, Invoice, Plan, Subscription, TaxRate, expected_for_period` repo 只负责「库 → 对象」,算账全交给引擎。
- `return {r["id"]: Plan(r["id"], r["name"], r["interval"], Decimal(r["unit_price"]))` 库里的 `'39.00'` 在这里变回 `Decimal("39.00")`。Day 680 定的规矩:存 TEXT,算 Decimal。`r["id"]` 能按列名取,是 `db.py` 里 `row_factory = sqlite3.Row` 的功劳。
- `date.fromisoformat(r["valid_to"]) if r["valid_to"] else None)` 没有结束日的税率,库里是 NULL,读回来是 Python 的 None。
- `return Customer(r["id"], r["name"], r["country"], r["currency"], r["tax_region"]) if r else None` 找不到客户返回 None,让调用方决定怎么报错。
- `events = [Event(e["id"], e["type"], datetime.fromisoformat(e["effective_at"]), json.loads(e["payload_json"]))` 事件时间从 UTC 字符串变回带时区的 datetime,payload 从 JSON 字符串变回字典,[Day 39](/blog/agent-zero/day-039-json/) 的 `json.loads`,相当于 `JSON.parse`。
- `if s["coupon_id"]:` 订阅绑了券才去查券表。
- `sub = Subscription(s["id"], s["customer_id"], date.fromisoformat(s["start_date"]), s["billing_anchor_day"],` 注意这里**没有**读订阅表的 `plan_id` 和 `quantity`:那是快照,引擎不认。
- `def expected_invoice(conn: sqlite3.Connection, invoice_id: str) -> tuple[sqlite3.Row, Invoice | None]:` 复算工具的核心:给一张发票号,返回库里那张和引擎认为同一周期应该开的那张。
- `raise KeyError(invoice_id)` 发票不存在就抛 KeyError,工具层再把它翻译成给模型看的话。repo 不知道 MCP 的存在,这样它也能给评测脚本用。
- `assert customer is not None` 发票指向的客户一定存在,Day 680 的外键保证了这一点;这一行主要是告诉类型检查器。
- `date.fromisoformat(inv["period_start"]))` 按周期开始日找应收,不按发票号。重复开票那张 `INV-0023-04D` 的号码引擎不认识,按周期就能对上。

</div>

在仓库根目录试一下(先确认跑过 Day 682 的 `uv run python -m billsleuth.seed`):

```python
# billsleuth/scratch/try_repo.py  从库里读回对象,让引擎重算 S011 那张发票
from billsleuth.db import connect
from billsleuth.repo import expected_invoice, load_subscription

conn = connect()
sub, coupon = load_subscription(conn, "SUB-0011")
print("事件:", [(e.type, e.effective_at.isoformat(), e.payload) for e in sub.events], "券:", coupon)
row, exp = expected_invoice(conn, "INV-0011-03")
print("库里:", row["id"], row["total"], type(row["total"]).__name__)
assert exp is not None
print("应收:", exp.id, exp.total, type(exp.total).__name__)
for ln in exp.lines:
    print(f"   {ln.kind:<10} {ln.amount:>8}  {ln.description}")
row, exp = expected_invoice(conn, "INV-0001-05")
print("S001 那张:", row["id"], row["total"], "应收:", exp)
```

<div class="line-notes">

- `conn = connect()` 不传路径就用默认的 `billing.db`,或者环境变量 `BILLSLEUTH_DB` 指定的库。
- `print("库里:", row["id"], row["total"], type(row["total"]).__name__)` 看看库里读出来的合计是什么类型。
- `assert exp is not None` S011 那期应该有发票,这里断言一下,下面才能放心用 `exp.total`。
- `row, exp = expected_invoice(conn, "INV-0001-05")` S001:取消以后多开的那期。

</div>

```bash
uv run python -m scratch.try_repo
```

```text
事件: [('create', '2026-06-01T02:00:00+00:00', {'plan_id': 'starter', 'quantity': 10}), ('upgrade', '2026-07-14T22:50:00+00:00', {'plan_id': 'business'})] 券: None
库里: INV-0011-03 1438.44 str
应收: INV-0011-03 1412.42 Decimal
   proration    -82.26  未使用时间退还:入门版 × 10(2026-07-15 至 2026-08-01)
   proration    488.06  剩余时间:商业版 × 10(2026-07-15 至 2026-08-01)
   recurring    890.00  商业版 × 10 席位
   tax          116.62  税 SG-GST9(9%)
S001 那张: INV-0001-05 174.90 应收: None
```

库里的 1438.44 是字符串,引擎算出来的 1412.42 是 Decimal,两者差 26.02,就是 S011 的标准答案。引擎这边的折算行从 7 月 15 日起(新加坡本地日期),库里那张从 7 月 14 日起。S001 那张发票,引擎说这一期本不该有,返回 None。复算工具要做的,就是把这些对比整理成模型一眼能看懂的样子。

## 第二步:server 骨架和审计日志

先给 `schema.sql` 末尾追加一张审计表:

```sql
-- billsleuth/billsleuth/schema.sql(追加在文件末尾)
-- Day 683 新增:工具调用审计日志。哪个会话、什么时候、用什么参数调了哪个工具、成没成
CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,               -- UTC 时间
    session_id TEXT,                -- 一次调查一个会话号,从环境变量 BILLSLEUTH_SESSION 读
    tool TEXT NOT NULL,
    args_json TEXT NOT NULL,
    ok INTEGER NOT NULL,            -- 1 成功,0 失败
    summary TEXT NOT NULL           -- 结果或报错的前 300 个字符
);
```

<div class="line-notes">

- `id INTEGER PRIMARY KEY AUTOINCREMENT,` 自增主键,插入时不用给 id,按插入顺序递增。
- `session_id TEXT,                -- 一次调查一个会话号` 可以为空。明天起每次调查设一个新的会话号,审计日志就能按「哪一次调查」分组看。
- `args_json TEXT NOT NULL,` 参数存成 JSON 字符串。
- `summary TEXT NOT NULL           -- 结果或报错的前 300 个字符` 不存完整结果,一个复算结果几 KB,全存的话审计表会比账本还大。

</div>

改了表结构要重新造数:`uv run python -m billsleuth.seed`。`init_db` 会删库重建,新库里就有审计表了。

然后新建 `billsleuth/server.py`,第一段是导入和 server 对象:

```python
# billsleuth/billsleuth/server.py  BillSleuth 的 MCP server:6 个只读工具 + 1 个复算工具 + 1 个只写草稿的工具
import functools
import json
import os
import sqlite3
from collections.abc import Callable
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Annotated, Any, TypedDict

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import Field

from billsleuth.db import connect, db_path
from billsleuth.engine import COUNTRY_TZ, Line, local_date
from billsleuth.money import ZERO, fmt, money
from billsleuth.repo import expected_invoice

mcp = MCPServer(
    "billsleuth",
    instructions=("云簿 CloudLedger 的计费数据查询工具。查账顺序建议:get_customer → list_invoices → "
                  "get_invoice / list_payments → get_subscription_timeline → recompute_invoice。"
                  "金额都是字符串,单位是发票币种。recompute_invoice 是判断账算没算错的唯一依据,不要自己心算。"),
    log_level="WARNING",
)
READ_ONLY = ToolAnnotations(read_only_hint=True, open_world_hint=False)
DRAFT_ONLY = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=True, open_world_hint=False)
CUSTOMER_ID = r"^C-\d{4}$"
INVOICE_ID = r"^INV-\d{4}-\d{2}D?$"
```

<div class="line-notes">

- `from collections.abc import Callable` 类型标注里表示「一个函数」,装饰器要用。
- `from typing import Annotated, Any, TypedDict` `Annotated` 给参数附加说明和约束,`TypedDict` 声明返回值的形状,[Day 47](/blog/agent-zero/day-047-type-hints-3/) 学过。
- `from mcp.server import MCPServer` Day 281 用过的 server 类。2026 年 10 月查 PyPI,mcp 最新是 2.3.0(10 月 2 日发布),今天 `uv add "mcp==2.3.0"` 装的就是它。
- `from mcp.server.mcpserver.exceptions import ToolError` 工具里「模型传错了、可以改正」的情况抛它,SDK 会把它变成 `isError: true` 的结果交给模型,而不是让 server 崩掉。
- `from pydantic import Field` 参数的描述、正则、取值范围都写在 `Field` 里,SDK 据此生成 inputSchema,[Day 52](/blog/agent-zero/day-052-pydantic-2/) 学过。
- `from billsleuth.engine import COUNTRY_TZ, Line, local_date` 时间线工具要给出本地日期,直接用引擎的小工具,保证和引擎的算法一模一样。
- `instructions=("云簿 CloudLedger 的计费数据查询工具。查账顺序建议:` server 级别的说明,客户端连上时会拿到,一般会放进模型的系统提示。这里写了建议的查账顺序,和「不要自己心算」。
- `log_level="WARNING",` SDK 默认 INFO,每个请求打一行日志。明天 Agent 和 server 在同一个进程里跑时,INFO 会刷屏。
- `READ_ONLY = ToolAnnotations(read_only_hint=True, open_world_hint=False)` 只读、不访问外部世界。Day 283 讲过:注解只是提示,客户端据此决定要不要弹确认框,真正的保护在工具内部。
- `DRAFT_ONLY = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=True, open_world_hint=False)` 写草稿的工具:会写库,但不破坏已有数据,而且重复调用等价(幂等)。幂等这个承诺下面要在代码里兑现。
- `CUSTOMER_ID = r"^C-\d{4}$"` 客户号的正则,`C-0007` 这种。`r"..."` 是原始字符串,反斜杠不转义,写正则时都这么写。
- `INVOICE_ID = r"^INV-\d{4}-\d{2}D?$"` 发票号的正则。`D?` 表示末尾可以有一个 D,Day 682 重复开票那张 `INV-0023-04D` 要能查。

</div>

第二段是连库和审计装饰器:

```python
# ---------- 公共:连接、审计 ----------

def db() -> sqlite3.Connection:
    path = db_path()
    if not path.exists():
        raise ToolError("计费库不存在,请先运行 uv run python -m billsleuth.seed")
    return connect(path)


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
```

<div class="line-notes">

- `def db() -> sqlite3.Connection:` 每个工具调用都现开一个连接。SQLite 打开很快,这样不用操心多线程共用连接的问题。
- `raise ToolError("计费库不存在,请先运行 uv run python -m billsleuth.seed")` 库不在时给一句能照着做的话。不检查的话,`sqlite3.connect` 会悄悄新建一个空库,工具全返回「找不到」,很难查。
- `def audited(fn: Callable[..., Any]) -> Callable[..., Any]:` 装饰器就是「吃一个函数、吐一个新函数」的函数,[Day 96](/blog/agent-zero/day-096-decorators/) 讲过。`Callable[..., Any]` 表示任意参数、任意返回值的函数。
- `@functools.wraps(fn)` 把原函数的名字、docstring、**参数签名和类型标注**复制到 wrapper 上。这一行对 MCP 很要紧:SDK 是读函数签名来生成参数 schema 的,少了它,SDK 看到的是 `wrapper(*args, **kwargs)`,所有参数说明和正则都没了。
- `def wrapper(*args: Any, **kwargs: Any) -> Any:` 接住任何参数原样转给原函数。
- `summary = json.dumps(result, ensure_ascii=False, default=str)[:300]` 结果转成 JSON 截前 300 个字符。`default=str` 遇到 JSON 不认识的类型(比如万一混进来的 Decimal)就先转字符串,不报错。
- `except ToolError as e:` 只接业务错误。别的异常(程序 bug)不在这里处理,但 `finally` 照样会执行。
- `raise` 记下来以后原样抛出去,让 SDK 把它变成 `isError` 结果。装饰器只旁观,不改变工具的行为。
- `finally:` 不管成功还是失败都会执行,和 JS 的 `finally` 一样。审计日志写在这里,失败的调用也会被记下来。
- `with db() as conn:` sqlite3 连接的 with 语句:正常结束自动 commit,出错自动 rollback,[Day 93](/blog/agent-zero/day-093-python-sqlite-2/) 讲过。注意它不会关闭连接。
- `(datetime.now(timezone.utc).isoformat(timespec="seconds"),` 审计时间也用 UTC,精确到秒。
- `os.environ.get("BILLSLEUTH_SESSION"), fn.__name__,` 会话号从环境变量读;工具名就是函数名。
- `json.dumps(kwargs, ensure_ascii=False, default=str), int(ok), summary))` SDK 调工具时总是用关键字参数,所以参数都在 `kwargs` 里。

</div>

为什么失败也要记?因为最能说明问题的往往是失败。一个 Agent 连续五次用编造的发票号调 `get_invoice`,在审计日志里一眼就能看出来;只记成功的话,这五次就消失了。计费系统的审计日志还有合规上的意义:客户来问「你们的 AI 看过我哪些数据」,你要答得上来,[Day 416](/blog/agent-zero/day-416-pii-audit/) 讲过审计日志该记什么。

## 第三步:返回结构

每个工具的返回值都用 `TypedDict` 声明形状。SDK 看到返回类型是 TypedDict,就会生成 outputSchema,并把结果放进 `structuredContent`,客户端拿到的是一个结构化的对象,而不是一段要自己解析的文字。

```python
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
    difference: str  # 实际 - 应收,正数表示多收
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
```

<div class="line-notes">

- `class CustomerOut(TypedDict):` TypedDict 相当于 TS 的 `type CustomerOut = { id: string; ... }`,运行时就是普通字典,只给类型检查器和 SDK 看。
- `timezone: str` 客户表里没有这一列,工具直接把国家换成时区名给出来。模型不用记「SG 是 UTC+8」。
- `subscription_id: str | None` 顺手给出订阅号,模型下一步查时间线不用再猜。
- `class InvoiceHeader(TypedDict):` 发票表头,`list_invoices` 只返回这个。
- `subtotal: str` 金额字段全是 `str`。
- `class InvoiceDetail(InvoiceHeader):` TypedDict 可以继承,在表头的基础上多三个字段,相当于 TS 的 `type InvoiceDetail = InvoiceHeader & {...}`。
- `class EventOut(TypedDict):` 一条订阅事件。
- `effective_local_date: str` 第五个判断的体现:UTC 时间和客户本地日期都给,本地日期是工具算好的。
- `class TaxAnswer(TypedDict):` 不光给当天有效的税率,还给这个地区的税率历史,模型才看得出「发票上用的那个税率已经过期了」。
- `class KindDiff(TypedDict):` 按类别(订阅费、折算、折扣、税)对比的一行。
- `class Recompute(TypedDict):` 复算结果,字段最多的一个,下面第五步逐个讲。
- `difference: str  # 实际 - 应收,正数表示多收` 符号约定写在注释里,也写在工具的 docstring 里,模型看得到。
- `def header(r: sqlite3.Row) -> InvoiceHeader:` 一行发票表头转成 TypedDict。库里的金额本来就是字符串,原样给出,不用转来转去。
- `def must_invoice(conn: sqlite3.Connection, invoice_id: str) -> sqlite3.Row:` 「必须存在」的发票查询,好几个工具共用。
- `raise ToolError(f"发票 {invoice_id} 不存在。发票号形如 INV-0007-03,先用 list_invoices 查这个客户有哪些发票。")` 报错三件事:哪里错了、正确的长什么样、下一步调什么。

</div>

## 第四步:六个只读工具

```python
# ---------- 只读工具 ----------

@mcp.tool(annotations=READ_ONLY)
@audited
def get_customer(customer_id: Annotated[str, Field(description="客户编号,如 C-0007", pattern=CUSTOMER_ID)]) -> CustomerOut:
    """查客户基本信息:国家(决定时区)、币种、税务地区,以及订阅编号。"""
    with db() as conn:
        c = conn.execute("SELECT * FROM customers WHERE id = ?", (customer_id,)).fetchone()
        if c is None:
            raise ToolError(f"客户 {customer_id} 不存在。客户编号形如 C-0007。")
        s = conn.execute("SELECT id FROM subscriptions WHERE customer_id = ?", (customer_id,)).fetchone()
    return CustomerOut(id=c["id"], name=c["name"], country=c["country"], timezone=COUNTRY_TZ[c["country"]],
                       currency=c["currency"], tax_region=c["tax_region"], subscription_id=s["id"] if s else None)


@mcp.tool(annotations=READ_ONLY)
@audited
def list_invoices(
    customer_id: Annotated[str, Field(description="客户编号,如 C-0007", pattern=CUSTOMER_ID)],
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
def get_invoice(invoice_id: Annotated[str, Field(description="发票号,如 INV-0007-03", pattern=INVOICE_ID)]) -> InvoiceDetail:
    """查一张发票的表头和全部行项目(订阅费、折算、折扣、税)。"""
    with db() as conn:
        r = must_invoice(conn, invoice_id)
        lines = conn.execute("SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id", (invoice_id,)).fetchall()
    return InvoiceDetail(**header(r), customer_id=r["customer_id"], subscription_id=r["subscription_id"],
                         lines=[line_row(ln) for ln in lines])


@mcp.tool(annotations=READ_ONLY)
@audited
def list_payments(
    customer_id: Annotated[str, Field(description="客户编号,如 C-0007", pattern=CUSTOMER_ID)],
    invoice_id: Annotated[str | None, Field(description="只看某张发票的扣款;不填则看这个客户全部扣款")] = None,
) -> list[PaymentOut]:
    """列出扣款记录(含失败的),按时间倒序。同一张发票出现两笔 succeeded 就是重复扣款。"""
    sql = "SELECT p.* FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.customer_id = ?"
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
    customer_id: Annotated[str, Field(description="客户编号,如 C-0007", pattern=CUSTOMER_ID)],
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
        raise ToolError(f"没有地区 {region} 的税率。地区来自 get_customer 返回的 tax_region。")
    hist = [TaxRateOut(code=r["code"], region=r["region"], rate=r["rate"], valid_from=r["valid_from"],
                       valid_to=r["valid_to"]) for r in rows]
    eff = [h for h in hist if h["valid_from"] <= on and (h["valid_to"] is None or on <= h["valid_to"])]
    if not eff:
        raise ToolError(f"{region} 在 {day} 没有有效税率。")
    return TaxAnswer(effective=eff[0], history=hist)
```

<div class="line-notes">

- `@mcp.tool(annotations=READ_ONLY)` 把函数注册成 MCP 工具。装饰器的顺序有讲究:`@mcp.tool` 在外,`@audited` 在内。装饰器从下往上套,先套审计,再把「带审计的函数」注册给 SDK。反过来写,SDK 注册的是没有审计的原函数,审计永远不会被调用。
- `def get_customer(customer_id: Annotated[str, Field(description="客户编号,如 C-0007", pattern=CUSTOMER_ID)]) -> CustomerOut:` 参数的类型、描述、正则全在签名里。模型传 `"0007"` 这种格式不对的号,SDK 在调用函数之前就拒绝了。
- `"""查客户基本信息:国家(决定时区)、币种、税务地区,以及订阅编号。"""` docstring 就是工具描述,模型靠它决定什么时候调这个工具。写清楚它返回什么、能帮你回答什么问题。
- `raise ToolError(f"客户 {customer_id} 不存在。客户编号形如 C-0007。")` 格式对但不存在的客户号,到这里才会被发现。
- `limit: Annotated[int, Field(ge=1, le=24, description="最多返回几张,按计费周期倒序")] = 12,` `ge`/`le` 是大于等于、小于等于。默认 12 张,一年的月付账单。限制上限是为了保护上下文。
- `"SELECT * FROM invoices WHERE customer_id = ? ORDER BY period_start DESC, id DESC LIMIT ?"` 最新的在前。同一周期两张发票(重复开票)时按 id 再排一次,结果稳定。
- `raise ToolError(f"客户 {customer_id} 没有发票,确认客户编号是否正确。")` 空列表也报错,而不是返回 `[]`。模型看到 `[]` 可能会得出「这个客户没被扣过钱」的错误结论。
- `return [header(r) for r in rows]` 返回的是列表。MCP 规范要求结构化结果是一个对象,SDK 会自动包一层 `{"result": [...]}`,下面的输出能看到。Day 684 写桥接代码时要记得拆开。
- `return InvoiceDetail(**header(r), customer_id=r["customer_id"], subscription_id=r["subscription_id"],` `**header(r)` 把表头字典展开成关键字参数,再加三个字段,相当于 JS 的 `{...header(r), customerId: ...}`。
- `invoice_id: Annotated[str | None, Field(description="只看某张发票的扣款;不填则看这个客户全部扣款")] = None,` 可选参数,默认 None。
- `"""列出扣款记录(含失败的),按时间倒序。同一张发票出现两笔 succeeded 就是重复扣款。"""` 描述里直接告诉模型怎么看出重复扣款。这算不算「把答案告诉模型」?我觉得不算:这是一个客服都知道的常识,写进描述能省模型好几步推理。
- `sql = "SELECT p.* FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.customer_id = ?"` 扣款表没有客户列,要 JOIN 发票表才能按客户过滤,[Day 87](/blog/agent-zero/day-087-sql-3/) 讲过 JOIN。这正是「不要让模型自己知道表怎么关联」的例子。
- `args: list[Any] = [customer_id]` SQL 参数按需追加,条件多一个就多一个 `?` 和一个参数。永远不要用字符串拼接把参数塞进 SQL。
- `"""查订阅当前状态和全部变更事件(开通、升降级、改席位、取消)。` docstring 可以写多行,第二行强调「计费规则按本地日期算」。
- `coupon = conn.execute("SELECT * FROM coupons WHERE id = ?", (s["coupon_id"],)).fetchone() if s["coupon_id"] else None` 有券就把券的内容一起给出,模型不用再查一次。
- `coupon=dict(coupon) if coupon else None, customer_timezone=COUNTRY_TZ[c["country"]],` `sqlite3.Row` 不能直接转 JSON,`dict(...)` 变成普通字典。
- `effective_local_date=local_date(datetime.fromisoformat(e["effective_at"]), c["country"]).isoformat(),` 用引擎同一个函数算本地日期。工具和引擎要是各算各的,迟早会有一处不一致。
- `raise ToolError(f"日期格式不对:{on},要 YYYY-MM-DD") from None` `from None` 让报错里不再附带原来那个 ValueError 的调用栈,模型只看到这一句。
- `eff = [h for h in hist if h["valid_from"] <= on and (h["valid_to"] is None or on <= h["valid_to"])]` 这里直接比较日期字符串,`YYYY-MM-DD` 格式的字符串字典序和日期顺序一致,Day 680 讲过。

</div>

接上第五步和第六步之前,先用一个小脚本在同一个进程里调一下工具。[Day 287](/blog/agent-zero/day-287-mcp-test/) 讲过,`Client` 传 server 对象就走内存,不起子进程:

```python
# billsleuth/scratch/peek.py  在同一个进程里调一次工具,打印结构化结果。用法见下面的命令
import json
import sys

import anyio
from mcp import Client

from billsleuth.server import mcp


async def main(tool: str, args: dict) -> None:
    async with Client(mcp) as client:
        r = await client.call_tool(tool, args)
    if r.is_error:
        print("isError:", r.content[0].text)  # pyright: ignore[reportAttributeAccessIssue]
    else:
        print(json.dumps(r.structured_content, ensure_ascii=False, indent=2))


anyio.run(main, sys.argv[1], json.loads(sys.argv[2]))
```

<div class="line-notes">

- `from billsleuth.server import mcp` 导入 server 对象本身。
- `async with Client(mcp) as client:` 内存连接,握手、调用都在本进程里完成,十几毫秒。
- `r = await client.call_tool(tool, args)` 发一次 `tools/call`。
- `print("isError:", r.content[0].text)  # pyright: ignore[reportAttributeAccessIssue]` 出错时内容是一段文字。`content` 的类型是好几种内容块的联合(文字、图片……),类型检查器不确定它有 `.text`,这一行我知道一定是文字,所以压掉红线。
- `print(json.dumps(r.structured_content, ensure_ascii=False, indent=2))` 成功时打结构化结果。
- `anyio.run(main, sys.argv[1], json.loads(sys.argv[2]))` 命令行第一个参数是工具名,第二个是 JSON 格式的参数。`anyio.run` 跑异步函数,Day 287 用过。

</div>

```bash
uv run python -m scratch.peek list_invoices '{"customer_id": "C-0011", "limit": 2}'
uv run python -m scratch.peek get_invoice '{"invoice_id": "INV-0011-09"}'
uv run python -m scratch.peek get_invoice '{"invoice_id": "12345"}'
```

<div class="line-notes">

- `'{"customer_id": "C-0011", "limit": 2}'` 参数用单引号包住整段 JSON,shell 才不会动里面的双引号。
- `'{"invoice_id": "INV-0011-09"}'` 格式对、但不存在的发票号。
- `'{"invoice_id": "12345"}'` 格式不对的发票号。

</div>

```text
{
  "result": [
    {
      "id": "INV-0011-05",
      "period_start": "2026-10-01",
      "period_end": "2026-11-01",
      "issued_at": "2026-10-01",
      "status": "paid",
      "subtotal": "890.00",
      "discount": "0.00",
      "tax": "80.10",
      "total": "970.10",
      "currency": "USD"
    },
    {
      "id": "INV-0011-04",
      "period_start": "2026-09-01",
      "period_end": "2026-10-01",
      "issued_at": "2026-09-01",
      "status": "paid",
      "subtotal": "890.00",
      "discount": "0.00",
      "tax": "80.10",
      "total": "970.10",
      "currency": "USD"
    }
  ]
}
isError: Error executing tool get_invoice: 发票 INV-0011-09 不存在。发票号形如 INV-0007-03,先用 list_invoices 查这个客户有哪些发票。
isError: Error executing tool get_invoice: 1 validation error for get_invoiceArguments
invoice_id
  String should match pattern '^INV-\d{4}-\d{2}D?$' [type=string_pattern_mismatch, input_value='12345', input_type=str]
    For further information visit https://errors.pydantic.dev/2.14/v/string_pattern_mismatch
```

三种结果各不相同。列表被包成了 `{"result": [...]}`,只有表头。格式对但不存在的发票号,得到我们写的那句话。格式不对的,根本没进到函数里,是 SDK 用 pydantic 按 schema 拒绝的,报错是英文的校验信息,不过模型也看得懂 `String should match pattern`。练习 2 会看到,这一类失败审计日志里没有记录。

## 第五步:复算工具

`recompute_invoice` 的返回结构是 BillSleuth 里我最在意的一处设计。最省事的版本只返回 `expected_total` 和 `actual_total`,模型拿到两个数以后会自己相减、自己猜差在哪,算错的概率不小。现在的版本把模型可能要做的计算全做了:

```python
# ---------- 复算工具 ----------

def _line_out(ln: Line) -> LineOut:
    return LineOut(kind=ln.kind, description=ln.description, quantity=ln.quantity, unit_amount=fmt(ln.unit_amount),
                   amount=fmt(ln.amount), period_start=ln.period_start and ln.period_start.isoformat(),
                   period_end=ln.period_end and ln.period_end.isoformat(), tax_code=ln.tax_code)


@mcp.tool(annotations=READ_ONLY)
@audited
def recompute_invoice(invoice_id: Annotated[str, Field(description="要复算的发票号", pattern=INVOICE_ID)]) -> Recompute:
    """用参考计费引擎重算这张发票所在周期「应该」收多少,和实际发票逐类对比。
    difference = 实际 - 应收,正数就是多收。should_exist=false 表示这个周期本不该开票。
    同时给出这张发票的实际扣款合计,以及同一周期的其他发票(查重复开票)。"""
    with db() as conn:
        try:
            inv, exp = expected_invoice(conn, invoice_id)
        except KeyError:
            raise ToolError(f"发票 {invoice_id} 不存在。先用 list_invoices 查这个客户有哪些发票。") from None
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
```

<div class="line-notes">

- `def _line_out(ln: Line) -> LineOut:` 引擎的 `Line` 对象转成返回结构,金额用 `fmt` 变成两位小数的字符串。
- `period_start=ln.period_start and ln.period_start.isoformat(),` 和 Day 682 写库时一样的短路写法,None 保持 None。
- `"""用参考计费引擎重算这张发票所在周期「应该」收多少,和实际发票逐类对比。` docstring 写清楚每个关键字段的意思,模型就是靠它读懂结果的。
- `inv, exp = expected_invoice(conn, invoice_id)` 第一步写的 repo 函数:库里那张 + 引擎的那张。
- `raise ToolError(f"发票 {invoice_id} 不存在。先用 list_invoices 查这个客户有哪些发票。") from None` repo 抛的 KeyError 在这里翻译成给模型看的话。
- `pays = conn.execute("SELECT amount FROM payments WHERE invoice_id = ? AND status = 'succeeded'",` 这张发票实际成功扣了几笔。重复扣款的场景,发票本身没错,错在这里。
- `same = [r["id"] for r in conn.execute(` 同一订阅、同一周期的其他发票,专门对付重复开票。
- `kinds = ["recurring", "proration", "discount", "tax", "adjustment"]` 五种行类型,按这个顺序对比。
- `act_by = {k: money(sum((Decimal(r["amount"]) for r in actual_lines if r["kind"] == k), ZERO)) for k in kinds}` 实际发票按类别求和。字符串转 Decimal 再加,不用 SQL 的 SUM。
- `exp_by = {k: money(sum((ln.amount for ln in exp.lines if ln.kind == k), ZERO)) if exp else ZERO for k in kinds}` 应收按类别求和;这一期本不该开票时全是 0。
- `if exp is None:` 下面四个分支给出一句人话的 `reason`。模型先读这一句,再看数字。
- `reason = f"这个周期还有其他发票:{', '.join(same)},可能重复开票"` 重复开票时两张发票金额都和应收一致,difference 是 0,没有这句提示模型很可能得出「账没错」。练习 3 会看到。
- `difference=fmt(actual_total - expected_total),` 模型不用做减法。
- `by_kind=[KindDiff(kind=k, expected=fmt(exp_by[k]), actual=fmt(act_by[k]), difference=fmt(act_by[k] - exp_by[k]))` 每一类的应收、实收、差额。
- `for k in kinds if exp_by[k] != ZERO or act_by[k] != ZERO],` 两边都是 0 的类别不列,少占上下文。
- `expected_lines=[_line_out(ln) for ln in exp.lines] if exp else [],` 应收的每一行也给出来,模型要给客户解释折算时可以引用。
- `paid_total=fmt(sum((Decimal(p["amount"]) for p in pays), ZERO)), successful_payments=len(pays),` 扣了几笔、一共多少。

</div>

拿 S011 试一下(长列表我用 `python3 -c` 去掉了):

```bash
uv run python -m scratch.peek recompute_invoice '{"invoice_id": "INV-0011-03"}' | python3 -c "import json,sys; d=json.load(sys.stdin); [d.pop(k) for k in ('expected_lines','actual_lines')]; print(json.dumps(d, ensure_ascii=False, indent=2))"
```

<div class="line-notes">

- `| python3 -c "import json,sys; d=json.load(sys.stdin);` 管道把上一个命令的输出交给下一个命令,[Day 5](/blog/agent-zero/day-005-terminal-3/) 讲过。这里用系统自带的 python3 读 JSON、删掉两个长列表再打印。

</div>

```text
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
    {
      "kind": "recurring",
      "expected": "890.00",
      "actual": "890.00",
      "difference": "0.00"
    },
    {
      "kind": "proration",
      "expected": "405.80",
      "actual": "429.67",
      "difference": "23.87"
    },
    {
      "kind": "tax",
      "expected": "116.62",
      "actual": "118.77",
      "difference": "2.15"
    }
  ],
  "paid_total": "1438.44",
  "successful_payments": 1,
  "other_invoices_same_period": []
}
```

差额 26.02 里,23.87 来自折算,2.15 是跟着多出来的税。模型接下来该做的就是查时间线:升级事件的 UTC 时间是 7 月 14 日 22:50,本地日期是 7 月 15 日;而发票折算行写的是从 7 月 14 日起。差了一天,原因就清楚了。整个推理过程模型一次减法都不用做。

你可能会担心:这样是不是把答案直接喂给 Agent 了?是,也不是。差多少确实给了,但「为什么差」还要 Agent 自己查、自己对比;根因选哪个、要不要冲正、怎么和客户解释,都还是 Agent 的工作。更重要的是,真实公司里也应该这么设计工具,让 Agent 去做计算器能做的事,既慢又不可靠。代价是评测会偏简单,Day 682 的局限一节写过,Day 693 会正面处理。

## 第六步:唯一的写工具

```python
# ---------- 写工具:只生成草稿 ----------

@mcp.tool(annotations=DRAFT_ONLY)
@audited
def draft_credit_note(
    invoice_id: Annotated[str, Field(description="要冲正的发票号", pattern=INVOICE_ID)],
    amount: Annotated[str, Field(description="冲正金额,字符串,两位小数,如 \"23.40\"", pattern=r"^\d+\.\d{2}$")],
    reason: Annotated[str, Field(min_length=10, max_length=300, description="冲正原因,写清根因和算式")],
) -> CreditNoteOut:
    """为多收的钱起草一张贷记单(credit note)。只生成 draft,不会退款,签发要人工审批。
    同一张发票已有草稿时直接返回那张草稿,不会重复创建。"""
    amt = money(amount)
    with db() as conn:
        must_invoice(conn, invoice_id)
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
    return CreditNoteOut(credit_note_id=cn_id, invoice_id=invoice_id, amount=fmt(amt), status="draft",
                         note="已生成草稿,等待人工审批后才会签发")


if __name__ == "__main__":
    mcp.run()
```

<div class="line-notes">

- `@mcp.tool(annotations=DRAFT_ONLY)` 唯一不是只读的工具,注解是 `DRAFT_ONLY`。
- `amount: Annotated[str, Field(description="冲正金额,字符串,两位小数,如 \"23.40\"", pattern=r"^\d+\.\d{2}$")],` 金额参数也是字符串,而且正则限定必须是两位小数。`"26.1"` 这样的值在函数执行前就被拒绝。
- `reason: Annotated[str, Field(min_length=10, max_length=300, description="冲正原因,写清根因和算式")],` 原因至少 10 个字。模型偷懒只写「多收了」会被拒绝。这些原因 Day 690 审批时给人看。
- `"""为多收的钱起草一张贷记单(credit note)。只生成 draft,不会退款,签发要人工审批。` 描述里写明它的能力边界,模型不会以为调了它钱就退出去了。
- `amt = money(amount)` 字符串变 Decimal 并规整,Day 680 的 `money()`。
- `must_invoice(conn, invoice_id)` 发票必须存在。
- `paid = sum((Decimal(p["amount"]) for p in conn.execute(` 这张发票实际成功扣了多少。
- `if amt <= 0:` 第一道检查:金额必须大于 0。正则其实挡住了负数,但 `"0.00"` 能过正则,这一条兜住它。
- `if amt > paid:` 第二道检查:不能冲正超过客户实际付的钱。Stripe 的贷记单也有类似的上限。
- `existing = conn.execute("SELECT * FROM credit_notes WHERE invoice_id = ? AND status = 'draft'",` 第三道检查:这张发票已经有草稿了,直接返回那一张。
- `note="这张发票已有草稿,未重复创建")` 返回同一个编号,并说明没有新建。Agent 在循环里可能因为超时没看到结果、或者被打断后重来,同一个写操作被调两次很常见。写工具必须经得起重复,这就是注解里 `idempotent_hint=True` 的承诺,[Day 390](/blog/agent-zero/day-390-idempotency/) 讲过幂等。Day 691 会换成显式的幂等键,做得更完整。
- `n = conn.execute("SELECT COUNT(*) FROM credit_notes").fetchone()[0] + 1` 贷记单编号按现有数量加一,`CN-0001`。并发写入时会撞号,单机演示够用,Day 691 一起改。
- `conn.execute("INSERT INTO credit_notes VALUES (?,?,?,?,?)", (cn_id, invoice_id, amt, reason, "draft"))` 状态写死 `"draft"`,不从参数来。模型没有任何办法写出一张 approved 的贷记单,Day 283 讲读写分离时也是这么做的。
- `if __name__ == "__main__":` 直接运行这个文件时,用 stdio 启动 server。
- `mcp.run()` 默认 stdio 传输:从标准输入读 JSON-RPC,往标准输出写。

</div>

## 在 Inspector 里调试

### 第一个坑:`-m` 被吞掉了

[Day 285](/blog/agent-zero/day-285-mcp-inspector/) 用固定版本的 Inspector 2.10.1 调试过 CloudLedger。我们的 server 在包里,照 Day 680 的习惯用 `-m` 启动:

```bash
npx -y @modelcontextprotocol/inspector@2.10.1 --cli uv run python -m billsleuth.server --method tools/list
echo "exit $?"
```

<div class="line-notes">

- `--cli` CLI 模式,必须紧跟在包名后面,Day 285 讲过。后面的 `uv run python -m billsleuth.server` 是我们想让 Inspector 用来拉起 server 的命令,`--method tools/list` 表示发一次 `tools/list`、打印结果就退出。
- `echo "exit $?"` 打印上一条命令的退出码。

</div>

```text
Traceback (most recent call last):
  File "<stdin>", line 1, in <module>
NameError: name 'true' is not defined. Did you mean: 'True'?
{"error":{"code":"unreachable","message":"Connection timed out after 15000 ms. To accommodate a slower server, you may increase the timeout value in Server Settings."}}
exit 4
```

等了 15 秒,超时。上面那行 `NameError: name 'true' is not defined` 是破案的关键:它来自一个 Python 交互解释器,读到了 Inspector 发来的 JSON(JSON 里的 `true` 在 Python 里不是合法的名字)。也就是说,子进程启动的是不带参数的 `python`,`-m billsleuth.server` 不见了。我的判断是 Inspector 的命令行解析把 `-m` 这种短选项当成了它自己的参数拿走了(它自己的选项里就有 `-e` 这样的短选项),但我没去翻它的源码确认。直接在终端跑 `uv run python -m billsleuth.server` 是好的,问题出在中间这层。

绕法是不用 `-m`,改用文件路径启动,再用 Inspector 的 `-e` 给子进程设一个环境变量 `PYTHONPATH=.`,让 Python 能从仓库根目录找到 `billsleuth` 包:

```bash
npx -y @modelcontextprotocol/inspector@2.10.1 --cli uv run python billsleuth/server.py -e PYTHONPATH=. --method tools/list > scratch/tools.json
uv run python -c "
import json
for t in json.load(open('scratch/tools.json'))['tools']:
    print(t['name'], t['annotations'])
"
```

<div class="line-notes">

- `uv run python billsleuth/server.py -e PYTHONPATH=.` 两处改动。一是按文件路径运行:这时 Python 只把 `billsleuth/billsleuth/` 加进搜索路径,`from billsleuth.db import ...` 本来会找不到。二是 `-e KEY=VALUE`,给 server 子进程设环境变量:`PYTHONPATH` 是额外的模块搜索路径,设成 `.` 也就是仓库根目录,包就找得到了。实测 `-e` 要写在启动命令**后面**,写在前面会被当成别的东西,报 `No servers found in config file`。行尾的 `> scratch/tools.json` 把很长的输出存进文件,再挑着看。
- `print(t['name'], t['annotations'])` 只打工具名和注解。

</div>

```text
get_customer {'readOnlyHint': True, 'openWorldHint': False}
list_invoices {'readOnlyHint': True, 'openWorldHint': False}
get_invoice {'readOnlyHint': True, 'openWorldHint': False}
list_payments {'readOnlyHint': True, 'openWorldHint': False}
get_subscription_timeline {'readOnlyHint': True, 'openWorldHint': False}
get_tax_rate {'readOnlyHint': True, 'openWorldHint': False}
recompute_invoice {'readOnlyHint': True, 'openWorldHint': False}
draft_credit_note {'readOnlyHint': False, 'destructiveHint': False, 'idempotentHint': True, 'openWorldHint': False}
```

8 个工具都在,前 7 个只读,`draft_credit_note` 的四个提示正好是我们在 `DRAFT_ONLY` 里写的。

### 第二个坑:26.02 变成了浮点数

接着按顺序过一遍查账的六步。我先写了一个脚本,结果最后两次调用都失败了:

```bash
npx -y @modelcontextprotocol/inspector@2.10.1 --cli uv run python billsleuth/server.py -e PYTHONPATH=. \
  --method tools/call --tool-name draft_credit_note \
  --tool-arg invoice_id=INV-0011-03 amount=26.02 reason="升级日按 UTC 算早了一天,折算多收 23.87,税跟着多 2.15"
```

<div class="line-notes">

- `--tool-arg invoice_id=INV-0011-03 amount=26.02` 三个参数写在同一个 `--tool-arg` 后面,空格隔开,`key=value` 形式。行尾的 `\` 表示命令没完。

</div>

```text
"text": "Error executing tool draft_credit_note: 1 validation error for draft_credit_noteArguments\namount\n  Input should be a valid string [type=string_type, input_value=26.02, input_type=float]\n    For further information visit https://errors.pydantic.dev/2.14/v/string_type"
{"error":{"code":"tool_is_error","message":"Tool 'draft_credit_note' returned isError:true."}}
```

`input_value=26.02, input_type=float`:Inspector 的 CLI 看到 `26.02` 长得像数字,就当成数字发了过去,到了 Python 这边是 float。我们的 schema 要求字符串,pydantic 拒绝了。这正好是「金额全是字符串」那条判断要防的事:如果 schema 写的是 `float`,这一笔就会悄悄以 26.02 的浮点数进到系统里。前面 `customer_id=C-0011` 没问题,因为它不像数字。修法是把值写成 JSON 字符串:`'amount="26.02"'`,外面单引号给 shell,里面双引号给 Inspector。

### 六步检查脚本

改好以后的完整脚本:

```bash
#!/bin/sh
# billsleuth/scripts/inspect_smoke.sh  用 Inspector CLI 把六步检查跑一遍,在仓库根目录执行
I="npx -y @modelcontextprotocol/inspector@2.10.1 --cli"
S="uv run python billsleuth/server.py -e PYTHONPATH=. -e BILLSLEUTH_SESSION=inspector-demo"
$I $S --method tools/call --tool-name get_customer --tool-arg customer_id=C-0011
$I $S --method tools/call --tool-name get_subscription_timeline --tool-arg customer_id=C-0011
$I $S --method tools/call --tool-name recompute_invoice --tool-arg invoice_id=INV-0011-03
$I $S --method tools/call --tool-name get_invoice --tool-arg invoice_id=INV-0011-09
$I $S --method tools/call --tool-name draft_credit_note --tool-arg invoice_id=INV-0011-03 'amount="26.02"' reason="升级日按 UTC 算早了一天,折算多收 23.87,税跟着多 2.15"
$I $S --method tools/call --tool-name draft_credit_note --tool-arg invoice_id=INV-0011-03 'amount="26.02"' reason="升级日按 UTC 算早了一天,折算多收 23.87,税跟着多 2.15"
```

<div class="line-notes">

- `#!/bin/sh` 第一行告诉系统用哪个 shell 执行。
- `I="npx -y @modelcontextprotocol/inspector@2.10.1 --cli"` 把长命令存进变量,下面用 `$I` 引用,不加引号让它按空格拆开。
- `S="uv run python billsleuth/server.py -e PYTHONPATH=. -e BILLSLEUTH_SESSION=inspector-demo"` 多设一个会话号,审计日志里能看到这六次调用属于同一个会话。
- `--tool-arg customer_id=C-0011` 第一步:看客户,时区是什么。
- `--tool-name get_subscription_timeline` 第二步:看升级事件的 UTC 时间和本地日期。
- `--tool-name recompute_invoice --tool-arg invoice_id=INV-0011-03` 第三步:复算。
- `--tool-arg invoice_id=INV-0011-09` 第四步:不存在的发票,看报错文案。
- `'amount="26.02"'` 第五、六步:同样的参数起草两次,看第二次返回什么。

</div>

```bash
uv run python -m billsleuth.seed
sh scripts/inspect_smoke.sh > scratch/smoke.txt
uv run python scripts/pick_structured.py < scratch/smoke.txt
```

<div class="line-notes">

- `uv run python -m billsleuth.seed` 先重置库。脚本会写草稿和审计日志,调试前后都建议重置一次。
- `sh scripts/inspect_smoke.sh > scratch/smoke.txt` 六次调用的输出全存进文件。每次调用都要重新拉起 Inspector 和 server,在我的 2019 款 MacBook 上一次大约 5 到 6 秒。
- `uv run python scripts/pick_structured.py < scratch/smoke.txt` `<` 把文件内容当作标准输入喂给脚本。

</div>

`pick_structured.py` 从 Inspector 的输出里把每次调用的结构化结果摘成一行:

```python
# billsleuth/scripts/pick_structured.py  从 Inspector CLI 的输出里摘出每次调用的结构化结果,长列表省略
import json
import sys

text = sys.stdin.read()
decoder, i = json.JSONDecoder(), 0
while i < len(text):
    if text[i].isspace():
        i += 1
        continue
    doc, i = decoder.raw_decode(text, i)
    if doc.get("isError"):
        print("isError:", doc["content"][0]["text"])
        continue
    sc = doc["structuredContent"]
    for key in ("expected_lines", "actual_lines"):
        sc.pop(key, None)
    print(json.dumps(sc, ensure_ascii=False))
```

<div class="line-notes">

- `decoder, i = json.JSONDecoder(), 0` Inspector 每次调用打印一个 JSON 对象,六个对象首尾相接,不是一个合法的 JSON 数组,`json.load` 读不了。
- `doc, i = decoder.raw_decode(text, i)` `raw_decode` 从位置 i 开始解析一个 JSON 对象,返回对象和它结束的位置,循环着一个一个读。
- `if doc.get("isError"):` 失败的调用打出错误文字。
- `sc.pop(key, None)` 去掉两个长列表。`pop` 的第二个参数是找不到时的默认值,不会报错。

</div>

```text
{"id": "C-0011", "name": "鲸落科技-011", "country": "SG", "timezone": "Asia/Singapore", "currency": "USD", "tax_region": "SG", "subscription_id": "SUB-0011"}
{"subscription_id": "SUB-0011", "plan_id": "business", "quantity": 10, "status": "active", "start_date": "2026-06-01", "billing_anchor_day": 1, "current_period_start": "2026-10-01", "current_period_end": "2026-11-01", "coupon": null, "customer_timezone": "Asia/Singapore", "events": [{"id": "EV-0011-1", "type": "create", "effective_at_utc": "2026-06-01T02:00:00+00:00", "effective_local_date": "2026-06-01", "payload": {"plan_id": "starter", "quantity": 10}}, {"id": "EV-0011-2", "type": "upgrade", "effective_at_utc": "2026-07-14T22:50:00+00:00", "effective_local_date": "2026-07-15", "payload": {"plan_id": "business"}}]}
{"invoice_id": "INV-0011-03", "period_start": "2026-08-01", "period_end": "2026-09-01", "should_exist": true, "reason": "金额与参考引擎不一致,看 by_kind 找差在哪一类", "expected_total": "1412.42", "actual_total": "1438.44", "difference": "26.02", "by_kind": [{"kind": "recurring", "expected": "890.00", "actual": "890.00", "difference": "0.00"}, {"kind": "proration", "expected": "405.80", "actual": "429.67", "difference": "23.87"}, {"kind": "tax", "expected": "116.62", "actual": "118.77", "difference": "2.15"}], "paid_total": "1438.44", "successful_payments": 1, "other_invoices_same_period": []}
isError: Error executing tool get_invoice: 发票 INV-0011-09 不存在。发票号形如 INV-0007-03,先用 list_invoices 查这个客户有哪些发票。
{"credit_note_id": "CN-0001", "invoice_id": "INV-0011-03", "amount": "26.02", "status": "draft", "note": "已生成草稿,等待人工审批后才会签发"}
{"credit_note_id": "CN-0001", "invoice_id": "INV-0011-03", "amount": "26.02", "status": "draft", "note": "这张发票已有草稿,未重复创建"}
```

第二行时间线里,升级那条事件的 `effective_at_utc` 是 `2026-07-14T22:50:00+00:00`,`effective_local_date` 是 `2026-07-15`。第四行是我们写的报错;最后两行编号都是 `CN-0001`,第二次的 note 是「已有草稿,未重复创建」。脚本执行时终端里还打了一行 `{"error":{"code":"tool_is_error",...}}`,那是 Inspector 在告诉你第四次调用返回了 `isError`,CLI 模式下这次调用的退出码不是 0。

最后看审计日志:

```bash
sqlite3 billing.db "SELECT at, session_id, tool, ok, substr(summary, 1, 40) FROM audit_log ORDER BY id"
```

<div class="line-notes">

- `substr(summary, 1, 40)` SQL 的截取函数,从第 1 个字符开始取 40 个。

</div>

```text
2026-10-22T12:00:21+00:00|inspector-demo|get_customer|1|{"id": "C-0011", "name": "鲸落科技-011", "co
2026-10-22T12:00:27+00:00|inspector-demo|get_subscription_timeline|1|{"subscription_id": "SUB-0011", "plan_id
2026-10-22T12:00:33+00:00|inspector-demo|recompute_invoice|1|{"invoice_id": "INV-0011-03", "period_st
2026-10-22T12:00:38+00:00|inspector-demo|get_invoice|0|发票 INV-0011-09 不存在。发票号形如 INV-0007-03,先用 
2026-10-22T12:00:45+00:00|inspector-demo|draft_credit_note|1|{"credit_note_id": "CN-0001", "invoice_i
2026-10-22T12:00:51+00:00|inspector-demo|draft_credit_note|1|{"credit_note_id": "CN-0001", "invoice_i
```

六次调用都在,会话号一样,失败的那次 `ok` 是 0,摘要就是给模型的那句话。

Inspector 的界面模式也能用同样的绕法打开:`npx -y @modelcontextprotocol/inspector@2.10.1 -e PYTHONPATH=. uv run python billsleuth/server.py`(界面模式下我把 `-e` 写在前面,实测能启动并打印出带 token 的地址,但我没有在界面里点连接验证)。界面怎么点、Protocol 面板怎么看,Day 285 讲得很细,这里不再重复。这一段没有实跑界面里的点击操作,也没有截图。

## 用内存客户端测试

Inspector 适合「先点点看」,测试才能每次改完代码都跑一遍。用 Day 287 的写法:

```python
# billsleuth/tests/test_server.py  用内存客户端测 MCP server,主角是 100 个场景的可解性测试
import json
import shutil
import sqlite3
from decimal import Decimal

import pytest
from mcp import Client

from billsleuth import seed
from billsleuth.server import mcp

pytestmark = pytest.mark.anyio
SCENARIOS = sorted(seed.SCENARIO_DIR.glob("S*.json"))


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
    shutil.copy(master_db, path)  # 每条测试一份干净副本,写操作互不影响
    monkeypatch.setenv("BILLSLEUTH_DB", str(path))
    return path


@pytest.fixture
async def client():
    async with Client(mcp) as c:
        yield c


async def call(client, name, args):
    r = await client.call_tool(name, args)
    assert not r.is_error, r.content[0].text
    return r.structured_content


async def test_tool_list(client):
    names = {t.name for t in (await client.list_tools()).tools}
    assert names == {"get_customer", "list_invoices", "get_invoice", "list_payments", "get_subscription_timeline",
                     "get_tax_rate", "recompute_invoice", "draft_credit_note"}


@pytest.mark.parametrize("path", SCENARIOS, ids=[p.stem for p in SCENARIOS])
async def test_recompute_finds_every_overcharge(client, path):
    truth = json.loads(path.read_text(encoding="utf-8"))["truth"]
    r = await call(client, "recompute_invoice", {"invoice_id": truth["invoice_ids"][0]})
    if truth["variant"] == "duplicate_invoice":
        assert r["other_invoices_same_period"]  # 工具点出了同周期还有一张
        found = Decimal(r["actual_total"])
    else:
        found = Decimal(r["paid_total"]) - Decimal(r["expected_total"])
    assert found == Decimal(truth["overcharge"])


async def test_bad_invoice_id_is_rejected_by_schema(client):
    r = await client.call_tool("get_invoice", {"invoice_id": "12345"})
    assert r.is_error


async def test_unknown_invoice_message_tells_model_what_to_do(client):
    r = await client.call_tool("get_invoice", {"invoice_id": "INV-9999-01"})
    assert r.is_error and "list_invoices" in r.content[0].text


async def test_timeline_gives_local_date(client):
    t = await call(client, "get_subscription_timeline", {"customer_id": "C-0011"})
    up = next(e for e in t["events"] if e["type"] == "upgrade")
    assert (up["effective_at_utc"][:10], up["effective_local_date"]) == ("2026-07-14", "2026-07-15")


async def test_credit_note_is_draft_and_idempotent(client, fresh_db):
    args = {"invoice_id": "INV-0001-05", "amount": "174.90", "reason": "订阅已到期取消,这张发票不应开出,全额冲正"}
    a = await call(client, "draft_credit_note", args)
    b = await call(client, "draft_credit_note", args)
    assert a["status"] == "draft" and a["credit_note_id"] == b["credit_note_id"]
    with sqlite3.connect(fresh_db) as conn:
        assert conn.execute("SELECT COUNT(*) FROM credit_notes").fetchone()[0] == 1


async def test_credit_note_cannot_exceed_paid(client):
    r = await client.call_tool("draft_credit_note",
                               {"invoice_id": "INV-0001-05", "amount": "9999.00", "reason": "测试超额冲正会被拒绝"})
    assert r.is_error and "超过" in r.content[0].text


async def test_every_call_is_audited(client, fresh_db):
    await call(client, "get_customer", {"customer_id": "C-0001"})
    await client.call_tool("get_invoice", {"invoice_id": "INV-9999-01"})
    with sqlite3.connect(fresh_db) as conn:
        rows = conn.execute("SELECT tool, ok FROM audit_log ORDER BY id").fetchall()
    assert rows == [("get_customer", 1), ("get_invoice", 0)]
```

<div class="line-notes">

- `pytestmark = pytest.mark.anyio` 整个文件的测试都交给 anyio 插件跑,不用每条贴标记,Day 287 讲过。
- `SCENARIOS = sorted(seed.SCENARIO_DIR.glob("S*.json"))` 在模块加载时就列出 100 个场景文件,所以**跑测试前必须先跑过造数脚本**,下面「常见误区」里有实测。
- `@pytest.fixture(scope="module")` 这个 fixture 整个文件只执行一次。造一次数要零点几秒,100 条测试每条都造一遍太浪费。
- `path = tmp_path_factory.mktemp("db") / "master.db"` `tmp_path` 是每条测试一个临时目录,模块级的 fixture 要用 `tmp_path_factory` 自己建。
- `mp = pytest.MonkeyPatch()` 模块级 fixture 不能用函数级的 `monkeypatch`,自己建一个,用完 `undo()` 还原环境变量。[Day 74](/blog/agent-zero/day-074-pytest-4/) 讲过 monkeypatch。
- `seed.main()` 在临时目录里造一份完整的库。注意它同时会重写仓库里的 `scenarios/`,随机种子固定,写出来的内容不变。
- `@pytest.fixture(autouse=True)` `autouse` 让每条测试自动用上这个 fixture,不用写进参数。
- `shutil.copy(master_db, path)  # 每条测试一份干净副本,写操作互不影响` 写草稿、写审计的测试改了库,下一条测试拿到的还是干净的。
- `monkeypatch.setenv("BILLSLEUTH_DB", str(path))` 让 server 的 `db_path()` 指向这份副本,Day 680 留的那个环境变量。
- `async with Client(mcp) as c:` 内存客户端。fixture 也可以是异步的生成器,`yield` 之后的部分在测试结束时执行(关连接)。
- `assert not r.is_error, r.content[0].text` 出错时把错误文字打出来,失败原因一目了然。
- `async def test_tool_list(client):` 8 个工具的名字一个不多一个不少。以后有人加了工具没更新这里,测试会提醒他。
- `async def test_recompute_finds_every_overcharge(client, path):` 今天的主角,对 100 个场景各跑一次。
- `if truth["variant"] == "duplicate_invoice":` 重复开票的场景,difference 是 0,所以检查的是「工具点出了同周期还有一张」并且这张多出来的发票的合计就是多收金额。
- `found = Decimal(r["paid_total"]) - Decimal(r["expected_total"])` 其余场景:实际扣款合计 − 应收,必须等于标准答案。注意用的是 `paid_total` 不是 `actual_total`,重复扣款时发票金额是对的,多出来的在扣款上。
- `r = await client.call_tool("get_invoice", {"invoice_id": "12345"})` 格式不对的发票号被 schema 拒绝。
- `assert r.is_error and "list_invoices" in r.content[0].text` 报错里必须提到下一步该调的工具。这条测试守的是报错文案,有人把它改成「not found」就会红。
- `assert (up["effective_at_utc"][:10], up["effective_local_date"]) == ("2026-07-14", "2026-07-15")` S011 的升级事件,UTC 日期和本地日期差一天。
- `a = await call(client, "draft_credit_note", args)` 同样的参数调两次。
- `assert a["status"] == "draft" and a["credit_note_id"] == b["credit_note_id"]` 两次拿到同一个编号。
- `assert conn.execute("SELECT COUNT(*) FROM credit_notes").fetchone()[0] == 1` 再直接查库,确认真的只有一张。只看返回值不够,返回值可能撒谎。
- `{"invoice_id": "INV-0001-05", "amount": "9999.00", "reason": "测试超额冲正会被拒绝"})` 冲正金额远超实付。
- `assert rows == [("get_customer", 1), ("get_invoice", 0)]` 一次成功、一次失败,审计表里两行都在。

</div>

```bash
uv run pytest tests/test_server.py -v
```

```text
tests/test_server.py::test_tool_list[asyncio] PASSED                     [  0%]
tests/test_server.py::test_recompute_finds_every_overcharge[asyncio-S001] PASSED [  1%]
tests/test_server.py::test_recompute_finds_every_overcharge[asyncio-S002] PASSED [  2%]
tests/test_server.py::test_recompute_finds_every_overcharge[asyncio-S099] PASSED [ 93%]
tests/test_server.py::test_recompute_finds_every_overcharge[asyncio-S100] PASSED [ 94%]
tests/test_server.py::test_bad_invoice_id_is_rejected_by_schema[asyncio] PASSED [ 95%]
tests/test_server.py::test_unknown_invoice_message_tells_model_what_to_do[asyncio] PASSED [ 96%]
tests/test_server.py::test_timeline_gives_local_date[asyncio] PASSED     [ 97%]
tests/test_server.py::test_credit_note_is_draft_and_idempotent[asyncio] PASSED [ 98%]
tests/test_server.py::test_credit_note_cannot_exceed_paid[asyncio] PASSED [ 99%]
tests/test_server.py::test_every_call_is_audited[asyncio] PASSED         [100%]
============================= 107 passed in 7.50s ==============================
```

(中间 96 行省略。)107 条全绿。名字后面的 `[asyncio]` 表示 anyio 插件接管了,Day 287 解释过。现在 `uv run pytest` 一共 232 条:昨天的 125 条加今天 107 条,我的机器上 8 秒左右跑完。

`test_recompute_finds_every_overcharge` 这类测试,我叫它**可解性测试**:在评测 Agent 之前,先证明每道题对一个会用工具的人来说是可解的。100 条全过,说明只要 Agent 用对了工具,答案就在那里;某个场景在这里就过不了,那是工具或数据的问题,不该让 Agent 背锅。[Day 558](/blog/agent-zero/day-558-bench-1/) 拆 SWE-bench 时讲过,原版里有相当一部分题目描述不清或测试有问题,人工筛过一遍才有了 Verified 版本。我们的数据是合成的,这一步可以直接用代码完成。

## 今天的文件

| 零件 | 文件 | 新建还是修改 | 后面哪天用到 |
| --- | --- | --- | --- |
| 库 → 引擎对象 | `billsleuth/repo.py` | 新建 | Day 693 评测 |
| 审计表 | `billsleuth/schema.sql` 末尾 `audit_log` | 修改 | Day 697 面板 |
| 导入、server 对象、注解、ID 正则 | `billsleuth/server.py` 第一段 | 新建 | Day 684 桥接 |
| 连库、`@audited` | `server.py` 第二段 | 新建 | 全程 |
| 返回结构 | `server.py` 第三段 | 新建 | Day 686 证据抽取 |
| 6 个只读工具 | `server.py` 第四段 | 新建 | Day 684 起 |
| `recompute_invoice` | `server.py` 第五段 | 新建 | Day 686 调查图 |
| `draft_credit_note` | `server.py` 第六段 | 新建 | Day 690 审批 |
| 工具测试 | `tests/test_server.py` | 新建 | 每次改工具 |
| Inspector 检查 | `scripts/inspect_smoke.sh`、`scripts/pick_structured.py` | 新建 | 调试时 |
| 草稿 | `scratch/try_repo.py`、`scratch/peek.py` | 新建 | |

依赖多了一个 `uv add "mcp==2.3.0"`。今天不调模型,花费 0 元。

## 动手练习

**练习 1:重复扣款长什么样。** S017 的客户说信用卡上有两笔一样的扣款。用 `peek.py` 调 `list_payments` 只看 `INV-0017-05`,再调 `recompute_invoice`,说出模型应该从哪两个字段看出重复扣款。

<details><summary>参考答案</summary>

```bash
uv run python -m scratch.peek list_payments '{"customer_id": "C-0017", "invoice_id": "INV-0017-05"}'
uv run python -m scratch.peek recompute_invoice '{"invoice_id": "INV-0017-05"}' | python3 -c "import json,sys; d=json.load(sys.stdin); print({k: d[k] for k in ('difference', 'actual_total', 'paid_total', 'successful_payments')})"
```

<div class="line-notes">

- `'{"customer_id": "C-0017", "invoice_id": "INV-0017-05"}'` 两个参数都给,只看这一张发票的扣款。
- `print({k: d[k] for k in ('difference', 'actual_total', 'paid_total', 'successful_payments')})` 只挑四个字段看。

</div>

```text
{
  "result": [
    {
      "id": "PAY-0017-05-R",
      "invoice_id": "INV-0017-05",
      "amount": "123.60",
      "status": "succeeded",
      "attempted_at": "2026-09-14T02:03:00+00:00",
      "gateway_ref": "gw_001705r"
    },
    {
      "id": "PAY-0017-05",
      "invoice_id": "INV-0017-05",
      "amount": "123.60",
      "status": "succeeded",
      "attempted_at": "2026-09-14T02:00:00+00:00",
      "gateway_ref": "gw_001705"
    }
  ]
}
{'difference': '0.00', 'actual_total': '123.60', 'paid_total': '247.20', 'successful_payments': 2}
```

两笔都是 succeeded,金额一样,时间差 3 分钟,流水号一个带 `r`。复算结果里 `difference` 是 0.00,发票本身一点没错;看出问题要靠 `successful_payments` 是 2、`paid_total` 是发票合计的两倍。所以 `list_payments` 的描述里那句「同一张发票出现两笔 succeeded 就是重复扣款」和复算结果里的 `paid_total` 都不是多余的,只看 difference 的 Agent 会得出「账没错」。

</details>

**练习 2:观察会发生什么。** 重新造数,用 `peek.py` 依次调三次:`list_invoices`(正常)、`get_invoice` 发票号 `12345`(格式不对)、`get_invoice` 发票号 `INV-0011-09`(不存在)。然后查审计表,有几行?为什么?

<details><summary>参考答案</summary>

```bash
uv run python -m billsleuth.seed
uv run python -m scratch.peek list_invoices '{"customer_id": "C-0011", "limit": 2}' > /dev/null
uv run python -m scratch.peek get_invoice '{"invoice_id": "12345"}' > /dev/null
uv run python -m scratch.peek get_invoice '{"invoice_id": "INV-0011-09"}' > /dev/null
sqlite3 billing.db "SELECT id, tool, ok, args_json FROM audit_log"
```

<div class="line-notes">

- `> /dev/null` 把输出扔掉,这里只关心审计表。

</div>

```text
1|list_invoices|1|{"customer_id": "C-0011", "limit": 2}
2|get_invoice|0|{"invoice_id": "INV-0011-09"}
```

只有两行,`12345` 那次没有记录。参数校验发生在 SDK 里、在我们的函数被调用之前,`@audited` 包的是函数本身,根本没机会执行。这意味着「模型连续五次传格式错误的参数」这种模式,我们的审计日志是看不到的。要记下来有两个办法:把参数正则从 schema 挪到函数里自己检查(代价是模型看不到 schema 上的约束);或者在 SDK 的更外层(比如 Day 684 的桥接代码)也记一份调用日志。我倾向后者,两层日志各管各的:server 记「执行了什么」,客户端记「模型想干什么」。

</details>

**练习 3:两种特殊的复算结果。** 调 `recompute_invoice` 看三张发票:S001 的 `INV-0001-05`(取消后多开的)、S023 的 `INV-0023-04D`(重复开票多出来的)和它的原件 `INV-0023-04`。`should_exist`、`difference`、`reason` 各是什么?

<details><summary>参考答案</summary>

```bash
for inv in INV-0001-05 INV-0023-04D INV-0023-04; do
  uv run python -m scratch.peek recompute_invoice "{\"invoice_id\": \"$inv\"}" | python3 -c "import json,sys; d=json.load(sys.stdin); print({k: d[k] for k in ('invoice_id', 'should_exist', 'difference', 'reason', 'other_invoices_same_period')})"
done
```

<div class="line-notes">

- `"{\"invoice_id\": \"$inv\"}"` 这次 JSON 外面用双引号,因为要让 shell 替换 `$inv`;里面的双引号用 `\"` 转义。

</div>

```text
{'invoice_id': 'INV-0001-05', 'should_exist': False, 'difference': '174.90', 'reason': '按订阅事件,这个周期不应该开票(订阅已到期取消或处于暂停)', 'other_invoices_same_period': []}
{'invoice_id': 'INV-0023-04D', 'should_exist': True, 'difference': '0.00', 'reason': '这个周期还有其他发票:INV-0023-04,可能重复开票', 'other_invoices_same_period': ['INV-0023-04']}
{'invoice_id': 'INV-0023-04', 'should_exist': True, 'difference': '0.00', 'reason': '这个周期还有其他发票:INV-0023-04D,可能重复开票', 'other_invoices_same_period': ['INV-0023-04D']}
```

取消后多开的那张:`should_exist` 是 false,应收 0,difference 就是整张的金额 174.90,reason 直接说这一期不该开。重复开票的两张:**difference 都是 0.00**,每一张单独看都和应收一模一样。如果复算工具只返回 difference,Agent 会认定「账没错」。救场的是 `other_invoices_same_period` 和 reason 里那句「可能重复开票」。这也是可解性测试里要给 `duplicate_invoice` 单独写一个分支的原因。

</details>

**练习 4:把复算结果削薄。** 把 `Recompute` 里的 `difference` 和 `by_kind` 两个字段删掉(TypedDict 和返回值里都删),跑可解性测试,再看 S011 的复算结果。测试还过吗?模型拿到这个结果要多做什么?

<details><summary>参考答案</summary>

删掉 TypedDict 里的两行:

```python
    difference: str  # 实际 - 应收,正数表示多收
    by_kind: list[KindDiff]
```

<div class="line-notes">

- `difference: str` 和 `by_kind: list[KindDiff]` 两行都删。返回值里 `difference=...` 和 `by_kind=[...]` 那三行也一起删,否则类型检查器会报多了字段。

</div>

```bash
uv run pytest -q tests/test_server.py
uv run python -m scratch.peek recompute_invoice '{"invoice_id": "INV-0011-03"}' | python3 -c "import json,sys; d=json.load(sys.stdin); [d.pop(k) for k in ('expected_lines','actual_lines')]; print(json.dumps(d, ensure_ascii=False))"
```

```text
107 passed in 6.20s
{"invoice_id": "INV-0011-03", "period_start": "2026-08-01", "period_end": "2026-09-01", "should_exist": true, "reason": "金额与参考引擎不一致,看 by_kind 找差在哪一类", "expected_total": "1412.42", "actual_total": "1438.44", "paid_total": "1438.44", "successful_payments": 1, "other_invoices_same_period": []}
```

107 条照样全过:可解性测试只用到 `paid_total`、`expected_total` 和 `actual_total`,信息还在。但模型要多做两件事:自己算 1438.44 − 1412.42,再自己把 `expected_lines` 和 `actual_lines` 逐行对齐找出差在折算。还有一个更隐蔽的问题:reason 里还写着「看 by_kind 找差在哪一类」,可 by_kind 已经没了。改了返回结构却忘了改描述文字,模型会去找一个不存在的字段。可解性测试管的是「信息够不够」,管不到「好不好用」,后者要等 Day 687 接上真模型,数步数和准确率才知道。看完把两个字段改回来。

</details>

**验收标准:** `uv run pytest` 232 条全绿;`scripts/inspect_smoke.sh` 跑完能看到 8 个工具的注解、S011 复算差额 26.02、同样参数两次起草得到同一个 `CN-0001`;能说出五个工具设计判断各对应哪个工具;能解释为什么格式错误的参数不进审计日志;能说出重复扣款和重复开票这两个场景里 difference 为什么都看不出问题。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 工具粒度 | 一个工具做多大一件事;按查账动作切,不按表切,例子:`list_invoices` 只给表头 |
| repo(仓储) | 只负责「库 ↔ 对象」转换的一层代码,例子:`repo.py` 把一行行数据读回引擎的对象 |
| 结构化结果(structuredContent) | 工具按 outputSchema 返回的 JSON 对象;返回列表时 SDK 包成 `{"result": [...]}` |
| 工具注解(tool annotations) | `read_only_hint`、`destructive_hint`、`idempotent_hint` 等提示,客户端据此决定要不要让用户确认 |
| `ToolError` | 业务错误,SDK 把它变成 `isError: true` 的结果交给模型,server 不会崩 |
| 复算(recompute) | 用参考引擎重算某一期的应收,和实际发票按类别逐项对比 |
| 审计日志(audit log) | 记录谁在什么时候用什么参数调了什么工具、成没成,失败也记 |
| `functools.wraps` | 让装饰器返回的函数保留原函数的名字、docstring 和参数签名,SDK 靠签名生成 schema |
| `PYTHONPATH` | 额外的模块搜索路径环境变量,设成 `.` 让按文件路径启动的脚本也能 import 仓库里的包 |
| 可解性测试 | 评测之前先证明每道题用现有工具能算出标准答案 |
| 幂等(idempotent) | 同样的请求执行一次和多次效果一样,例子:同一张发票两次起草得到同一张草稿 |

## 常见误区

**给 Agent 一个 `run_sql` 最省事。** 省的是写工具的时间,费的是模型的推理和安全审计。SQL 能读任何客户的任何表,按动作切的工具每个都能加范围检查。

**金额用 JSON 数字返回,参数也收数字。** 实测 Inspector CLI 把 `26.02` 当 float 发过来。参数和返回值都用字符串,schema 上加两位小数的正则。

**装饰器顺序写反。** `@audited` 写在 `@mcp.tool` 外面,SDK 注册的是没审计的原函数,审计表永远是空的。`@mcp.tool` 在外,`@audited` 在内,并且 wrapper 上要有 `functools.wraps`。

**以为审计日志记下了所有调用。** schema 校验失败的调用到不了函数,练习 2 实测审计表里没有那一行。

**只看 difference 判断账对不对。** 重复扣款和重复开票的 difference 都是 0.00。要看 `paid_total`、`successful_payments` 和 `other_invoices_same_period`。

**写工具不做幂等。** Agent 循环里重复调用很常见,不幂等就是两张贷记单。同一张发票已有草稿就返回那一张。

**在 Inspector CLI 里用 `python -m` 启动 server。** 实测 `-m billsleuth.server` 被吞,子进程变成交互解释器,15 秒后超时。改用文件路径加 `-e PYTHONPATH=.`。

**`-e` 写在启动命令前面。** CLI 模式下实测报 `No servers found in config file`。写在启动命令后面。

**没造数就跑工具测试。** 我把 `scenarios/` 挪走再跑,输出是 `7 passed, 1 skipped`,跳过原因 `got empty parameter set for (path)`,100 条可解性测试一条都没跑,却没有一条红的。看到 skipped 要去看原因,先 `uv run python -m billsleuth.seed`。

**改了返回结构忘了改描述。** 练习 4 删掉 by_kind 以后 reason 里还在叫模型「看 by_kind」。描述、docstring、返回结构要一起改。

## 学习资料

### 文档与文章

- [Anthropic · Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents):工具设计最好的一篇实践文章,重点看「返回有意义的上下文」和「写好报错」两节,30 分钟。
- [MCP 规范 · Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools):工具定义、structuredContent、outputSchema 和 annotations 的正式规定,今天用到的四个提示都在这里,20 分钟。
- [MCP 文档 · Inspector](https://modelcontextprotocol.io/docs/tools/inspector):Inspector 的用法,对照今天的 CLI 命令看,10 分钟。
- [Stripe · Programmatic credit notes](https://docs.stripe.com/invoicing/integration/programmatic-credit-notes):真实系统里贷记单有哪些字段和限制(比如金额上限),对照 `draft_credit_note` 的三道检查,15 分钟。
- [Stripe API · Idempotent requests](https://docs.stripe.com/api/idempotent_requests):Stripe 怎么用幂等键防止重复扣款,Day 691 会照这个思路改草稿工具,10 分钟。
- [Python 文档 · functools](https://docs.python.org/zh-cn/3.12/library/functools.html):看 `wraps` 那一节,中文,5 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Y854zmEg9&autoplay=0&high_quality=1" title="MCP终极指南 - 带你深入掌握MCP(进阶篇)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>马克的技术工作坊 · MCP终极指南 - 带你深入掌握MCP(进阶篇) · 27 分钟,讲 server 开发和 host 怎么调用工具。视频里是 2025 年的 FastMCP 写法,和今天的 MCPServer 不完全一样,代码以本文为准,看它讲 host 怎么把工具结果交给模型的那段。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV136My6AEue&autoplay=0&high_quality=1" title="什么是幂等?为什么支付接口必须做到幂等?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>计算机大白话 · 什么是幂等?为什么支付接口必须做到幂等? · 3 分钟,用支付的例子讲幂等,对照 `draft_credit_note` 第三道检查。</figcaption>
</figure>

- 程序猿DD《2分钟使用Python构建MCP Server》(BV1CUdZYDE8k,3 分钟):忘了 MCP server 基本结构的可以先看这个快速回顾。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/kQmXtrmQ5Zg" title="Building Agents with Model Context Protocol - Full Workshop with Mahesh Murag of Anthropic" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · Building Agents with Model Context Protocol - Full Workshop with Mahesh Murag of Anthropic · MCP 团队成员的工作坊,前 40 分钟讲设计理念,其中讲工具描述和返回结构的部分和今天最相关。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章 Agents 里工具那一节,讲只读工具和写工具的区别、给写操作加人工确认,和今天的读写分离对应。
- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly, 2017;中国电力出版社有中译本《数据密集型应用系统设计》):第 11 章讲幂等和「恰好一次」语义,写 Day 691 的幂等键之前读一下。
- Agent 工具设计目前没有比上面那篇 Anthropic 文章更系统的书,先以文章为主。

### 开源项目与代码

- [modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk):SDK 源码,想弄清 structuredContent 怎么生成、列表为什么被包一层,看 server 里处理工具返回值的那部分。
- [modelcontextprotocol/inspector](https://github.com/modelcontextprotocol/inspector):Inspector 源码,CLI 的参数解析在 cli 目录下,想确认 `-m` 为什么被吞可以从这里查。
- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench):看它给航空和零售场景设计的工具,粒度和返回结构都值得参考,Day 693 的模拟客户也会参考它。

## 自测

1. 为什么 BillSleuth 按「查账动作」切工具,而不是一张表一个工具,或者干脆给一个 `run_sql`?

<details><summary>答案</summary>

按表切,模型得自己知道表怎么关联(扣款要 JOIN 发票才能按客户查)、表头和明细分两次查,多走很多步还容易错;`run_sql` 能读任何客户的任何表,一次提示注入就是数据泄露,也没法加范围检查。按动作切,每个工具回答一个客服查账时会问的问题,返回模型直接用得上的结构,还能在工具里把时区、税率有效期、应收金额都算好。

</details>

2. `recompute_invoice` 为什么同时返回 `difference`、`by_kind`、`paid_total` 和 `other_invoices_same_period`?各自防的是什么?

<details><summary>答案</summary>

`difference` 让模型不用做减法;`by_kind` 告诉它差在订阅费、折算、折扣还是税,顺着哪条线查;`paid_total` 和 `successful_payments` 防重复扣款,那种场景发票本身没错,difference 是 0,错在扣了两次;`other_invoices_same_period` 防重复开票,两张发票各自和应收一致,difference 也是 0。少了后两个,Agent 在这两类场景里会得出「账没错」。

</details>

3. `@audited` 和 `@mcp.tool` 的顺序为什么不能反?`functools.wraps` 起什么作用?

<details><summary>答案</summary>

装饰器从下往上套:`@audited` 在下,先把原函数包成带审计的函数,`@mcp.tool` 再把这个带审计的函数注册给 SDK。反过来写,SDK 注册的是原函数,外面那层审计永远不会被调用。`functools.wraps` 把原函数的名字、docstring 和参数签名复制到 wrapper 上,SDK 靠签名里的 `Annotated[..., Field(...)]` 生成参数 schema;没有它,SDK 看到的是 `wrapper(*args, **kwargs)`,描述和正则全丢了。

</details>

4. `draft_credit_note` 有哪三道检查?为什么它要幂等?

<details><summary>答案</summary>

金额必须大于 0;不能超过这张发票实际成功扣款的合计;同一张发票已有草稿时直接返回那张草稿,不新建。另外金额参数用正则限定为两位小数的字符串,状态在代码里写死为 draft。要幂等是因为 Agent 在循环里经常重复调用同一个工具(超时没看到结果、被打断后重来),不幂等的写工具重复一次就是两张贷记单。

</details>

5. 什么是可解性测试?它通过了能说明什么,不能说明什么?

<details><summary>答案</summary>

在评测 Agent 之前,先证明每道题用现有工具能得到正确答案:对 100 个场景各调一次复算工具,用返回的信息算出的多收金额必须等于标准答案。通过说明「答案就在工具里」,Agent 失败不是题目或工具的锅。它说明不了工具好不好用:练习 4 把 difference 和 by_kind 删掉,107 条照样全过,但模型要多做减法、多对齐行项目。好不好用要接上真模型,看步数和准确率。

</details>

6. 面试题:「你给 Agent 设计工具时,最重要的原则是什么?举一个你项目里的例子。」

<details><summary>答案</summary>

我最看重的是「能在工具里确定地算出来的,就别让模型算」。BillSleuth 的复算工具是例子:第一版只返回应收和实收两个总数,模型要自己相减、自己猜差在哪。现在的版本直接给出差额、按订阅费、折算、税分类的差额、实际扣款合计和同周期的其他发票,模型的工作只剩判断「为什么差」。比如 S011 那个时区场景,工具说差 26.02,其中折算 23.87、税 2.15,时间线工具同时给出升级事件的 UTC 时间和客户本地日期,模型一对就看出差了一天,一次减法都不用做。配套的几条:金额一律是字符串,参数上加两位小数的正则,我在 Inspector 里真遇到过 26.02 被 CLI 当成浮点数发过来、被 schema 拦下;报错要告诉模型下一步调什么;写工具只能写草稿、要幂等;每次调用都记审计日志。最后用可解性测试证明 100 个场景每个都能用这些工具算出标准答案。代价是评测会偏简单,我在评测报告里单独写了这一条局限。

</details>

## 明天预告

明天是 Day 684 · BillSleuth(五):流程为什么拆段,模型对象和 MCP 桥接。工具层有了,明天开始接模型:先想清楚为什么调查流程要拆成理解问题、定位发票、取证、复算、下结论几段,而不是一个大循环让模型自己转;再写模型对象和 MCP 桥接,把今天这 8 个工具变成模型能调用的函数,顺手处理掉 `{"result": [...]}` 那一层包装。
