---
title: 'Day 46 · 业务工具:订单/账单 MCP server 与退款审批'
description: '写 SupportPilot 的业务工具:查客户、订阅、账单,退款规则写死在代码里并用剧情客户测试,退款只能创建待审批申请。按权限分级注册给模型。对接企业系统:审批通知推到飞书/钉钉/企业微信群,加一个只读、带 SQL 校验和行级隔离的 text-to-SQL 工具。最后包成 MCP server,在 Claude Desktop 里查账单。'
pubDate: 2026-10-12
regime: none
tags: ['capstone', 'tool-use', 'mcp', 'text-to-sql', 'human-in-the-loop', 'enterprise-integration', 'supportpilot', 'agent-60']
series: 'agent-60'
day: 46
lang: 'zh'
---

## 今天要解决的问题

Day 43 访谈里老周说客服"要开三个系统:工单系统、计费后台、财务的退款审批"。今天就把这三个系统变成 Agent 能用的工具。这是 Agent 工程师在企业里最常干的活:一个 Boss 直聘上的企业 AI 落地岗原话是"对接数据平台、业务系统、知识库、审批系统、企业协作工具,熟练 SQL"。新加坡和香港的 JD 样本里,64% 提到 SQL 或数据系统。

今天结束时你应该做到:

1. 业务函数能查客户、订阅、账单,能按规则判断退款资格和金额;7 个剧情客户的退款规则各有一个测试。
2. 工具按权限分三级:只读、产生待审批、根本不给模型。执行退款的函数模型连名字都看不到。
3. 退款申请创建后自动推送到飞书/钉钉/企业微信群(没配 webhook 就打印到终端)。
4. 一个 text-to-SQL 工具:模型写 SQL 回答"我今年一共付了多少钱"这类统计问题,但只能读、只能读当前客户的数据,危险语句在执行前就被拦下。
5. 同一套函数包成 MCP server,在 Claude Desktop 或 Claude Code 里能直接用。

预计用时 5–6 小时。前置:Day 8–12(工具调用、工具设计、失败处理),Day 22–23(MCP),Day 25(人工审批),Day 40(权限与沙箱)。

## 先定原则:工具层的四条规矩

写代码之前,先把这一层的规矩说清楚,后面每个函数都按这几条来。

**规矩一:业务函数不知道 LLM 的存在。** `business.py` 里的函数只接收一条数据库连接和普通参数,返回字典。它不关心调用它的是模型、MCP 客户端还是单元测试。这样同一套函数可以被三个地方复用,测试也不需要 mock 模型。

**规矩二:有明确规则的判断写在代码里。** 退款资格、退款金额、是否重复扣款,这些都是 if-else 能写清楚的事。模型的工作是选对工具、传对参数、把结果讲给客户听。Day 43 说过,让模型算"950 × 7 / 12 × 0.9"它大多数时候对,但钱的事不接受"大多数时候"。

**规矩三:写操作只能"提议",不能"执行"。** 模型能调用的写工具只有 `create_refund_request`,它创建一条状态为 pending 的申请。把 pending 变成 executed 的函数 `decide_refund` 不注册给模型,只有人在审批界面点按钮才会调用。就算模型被注入攻击骗得团团转,它能做的最坏的事也只是多创建一条待审批申请。

**规矩四:错误信息是写给模型看的。** 工具出错时,返回的不是 Python 异常栈,而是一句模型能理解、能据此改正的话:"账单 INV-2026-001 不存在。账单号格式是 INV-年月-四位序号,可以先调 list_invoices 查。"Anthropic 的《Writing effective tools for agents》专门强调过这一点,好的错误信息能让模型自己纠正,省掉一次失败。

## 业务函数

```python
# supportpilot/src/supportpilot/tools/business.py
"""业务工具的真正实现。纯函数 + 一条数据库连接,不知道 LLM 和 MCP 的存在,所以好测。
退款资格这种有明确规则的判断写死在代码里,不交给模型算。"""

import json
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from ..config import get_settings


class ToolError(Exception):
    """给模型看的错误:信息要写清楚下一步该怎么做。"""


def _audit(conn, actor: str, action: str, payload: dict) -> None:
    conn.execute("INSERT INTO biz.audit_log (actor, action, payload) VALUES (%s, %s, %s)",
                 (actor, action, json.dumps(payload, ensure_ascii=False, default=str)))


def _jsonable(row: dict) -> dict:
    return {k: (float(v) if isinstance(v, Decimal) else v.isoformat() if isinstance(v, date) else v)
            for k, v in row.items()}


# ---------------- 只读工具 ----------------

def get_customer(conn, email: str) -> dict:
    row = conn.execute(
        "SELECT id, name, email, company, region, is_vip, created_at FROM biz.customers WHERE email = %s",
        (email.strip().lower(),)).fetchone()
    if not row:
        raise ToolError(f"没有找到邮箱为 {email} 的客户。请确认邮箱;如果客户用的是别的邮箱注册,请让客户提供注册邮箱。")
    return _jsonable(row)


def list_subscriptions(conn, customer_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT id, plan, billing_cycle, status, seats, price_cny, started_at, current_period_end, auto_renew "
        "FROM biz.subscriptions WHERE customer_id = %s ORDER BY started_at DESC", (customer_id,)).fetchall()
    return [_jsonable(r) for r in rows]


def list_invoices(conn, customer_id: str, status: str | None = None, limit: int = 6) -> dict:
    limit = max(1, min(limit, 20))
    sql = ("SELECT id, subscription_id, amount_cny, status, issued_at, paid_at, period_start, period_end, "
           "is_first_purchase FROM biz.invoices WHERE customer_id = %s")
    params: list = [customer_id]
    if status:
        sql += " AND status = %s"
        params.append(status)
    total = conn.execute(f"SELECT count(*) AS n FROM ({sql}) t", params).fetchone()["n"]
    rows = conn.execute(sql + " ORDER BY issued_at DESC, id DESC LIMIT %s", [*params, limit]).fetchall()
    # 返回值带上"一共几条、这次给了几条",模型才知道要不要翻页,不会以为这就是全部
    return {"total": total, "returned": len(rows), "invoices": [_jsonable(r) for r in rows]}


def _months_left(today: date, end: date) -> int:
    n = 0
    while True:
        m = today.month - 1 + n + 1
        y, m = today.year + m // 12, m % 12 + 1
        try:
            nxt = date(y, m, today.day)
        except ValueError:  # 比如 1 月 31 日加一个月
            nxt = date(y, m, 28)
        if nxt > end:
            return n
        n += 1


def check_refund_eligibility(conn, invoice_id: str) -> dict:
    """按《退款政策总览》判断一张账单能不能退、退多少。返回 rule 字段,审批人一眼能看到依据。"""
    today = get_settings().sp_today
    inv = conn.execute(
        "SELECT i.*, s.plan, s.billing_cycle FROM biz.invoices i JOIN biz.subscriptions s "
        "ON s.id = i.subscription_id WHERE i.id = %s", (invoice_id,)).fetchone()
    if not inv:
        raise ToolError(f"账单 {invoice_id} 不存在。账单号格式是 INV-年月-四位序号,可以先调 list_invoices 查。")
    amount = Decimal(inv["amount_cny"])

    def result(eligible: bool, rule: str, reason: str, refund: Decimal = Decimal(0)) -> dict:
        return {"invoice_id": invoice_id, "eligible": eligible, "rule": rule, "reason": reason,
                "refund_amount_cny": float(refund.quantize(Decimal("0.01"), ROUND_HALF_UP)),
                "invoice_amount_cny": float(amount)}

    if inv["status"] != "paid":
        return result(False, "not_paid", f"账单状态是 {inv['status']},只有已支付的账单可以退款。")
    pending = conn.execute("SELECT id, status FROM biz.refund_requests WHERE invoice_id = %s "
                           "AND status IN ('pending','approved','executed')", (invoice_id,)).fetchone()
    if pending:
        return result(False, "already_requested", f"这张账单已有退款申请 {pending['id']}(状态 {pending['status']}),不要重复申请。")
    dup = conn.execute(
        "SELECT id FROM biz.invoices WHERE subscription_id = %s AND period_start = %s AND status = 'paid' "
        "AND id <> %s", (inv["subscription_id"], inv["period_start"], invoice_id)).fetchone()
    if dup:
        return result(True, "duplicate_charge", f"与账单 {dup['id']} 属于同一订阅同一周期,是重复扣款,全额退还。", amount)
    if inv["plan"] == "enterprise":
        return result(False, "enterprise_contract", "企业版是合同订单,不适用自助退款规则,需要转人工由客户成功经理处理。")
    if inv["billing_cycle"] == "monthly":
        return result(False, "monthly_no_refund", "月付订阅不支持退款,可以关闭自动续费,当期结束后停止。")
    days = (today - inv["paid_at"]).days
    if inv["is_first_purchase"] and days <= 14:
        return result(True, "annual_first_14_days", f"年付首次购买第 {days} 天,在 14 天内,全额退款。", amount)
    if not inv["is_first_purchase"] and days <= 7:
        return result(True, "annual_renewal_7_days", f"年付续费第 {days} 天,在 7 天内,全额退款。", amount)
    months = _months_left(today, inv["period_end"])
    refund = amount * months / 12 * Decimal("0.9")
    if months == 0:
        return result(False, "annual_no_full_month_left", "剩余不足一个完整月,按规则没有可退金额。")
    return result(True, "annual_prorated",
                  f"年付已过退款全额期,剩余完整月份 {months} 个,退 {amount} × {months}/12 × 90%。", refund)


def search_past_tickets(conn, customer_id: str, limit: int = 5) -> list[dict]:
    rows = conn.execute(
        "SELECT id, subject, category, created_at, resolution_summary FROM biz.tickets "
        "WHERE customer_id = %s AND status = 'resolved' ORDER BY created_at DESC LIMIT %s",
        (customer_id, limit)).fetchall()
    return [_jsonable(r) for r in rows]


# ---------------- 写工具:只产生"待审批",不直接动钱 ----------------

def create_refund_request(conn, invoice_id: str, reason: str, ticket_id: str) -> dict:
    elig = check_refund_eligibility(conn, invoice_id)  # 不信任模型传来的金额,服务端重新算
    if not elig["eligible"]:
        raise ToolError(f"这张账单不符合退款条件:{elig['reason']} 不要创建退款申请,按规则向客户解释。")
    inv = conn.execute("SELECT customer_id FROM biz.invoices WHERE id = %s", (invoice_id,)).fetchone()
    req_id = f"RF-{ticket_id}-{invoice_id}"  # 幂等键:同一工单同一账单重复调用只会有一条
    conn.execute(
        "INSERT INTO biz.refund_requests (id, invoice_id, customer_id, ticket_id, amount_cny, reason, rule) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING",
        (req_id, invoice_id, inv["customer_id"], ticket_id, elig["refund_amount_cny"], reason, elig["rule"]))
    _audit(conn, "agent", "create_refund_request", {"id": req_id, **elig})
    row = conn.execute("SELECT * FROM biz.refund_requests WHERE id = %s", (req_id,)).fetchone()
    return {**_jsonable(row), "note": "已创建待审批的退款申请。不要告诉客户退款已完成,只能说已提交审核。"}


def escalate_to_human(conn, ticket_id: str, reason: str) -> dict:
    conn.execute("UPDATE biz.tickets SET status = 'escalated' WHERE id = %s", (ticket_id,))
    _audit(conn, "agent", "escalate", {"ticket_id": ticket_id, "reason": reason})
    return {"ticket_id": ticket_id, "status": "escalated"}


# ---------------- 只给人用:审批通过后执行。不注册给模型 ----------------

def decide_refund(conn, request_id: str, approved: bool, approver: str, note: str = "") -> dict:
    with conn.transaction():
        row = conn.execute("SELECT * FROM biz.refund_requests WHERE id = %s FOR UPDATE", (request_id,)).fetchone()
        if not row:
            raise ToolError(f"退款申请 {request_id} 不存在")
        if row["status"] != "pending":
            return _jsonable(row)  # 已经处理过,重复点击直接返回原结果
        status = "executed" if approved else "rejected"
        conn.execute("UPDATE biz.refund_requests SET status = %s, decided_by = %s, decided_at = now(), note = %s "
                     "WHERE id = %s", (status, approver, note, request_id))
        if approved:  # 演示项目里"执行退款"就是把账单标成已退款;真实系统这里调支付网关
            conn.execute("UPDATE biz.invoices SET status = 'refunded' WHERE id = %s", (row["invoice_id"],))
        _audit(conn, f"human:{approver}", "decide_refund", {"id": request_id, "approved": approved, "note": note})
        return _jsonable(conn.execute("SELECT * FROM biz.refund_requests WHERE id = %s", (request_id,)).fetchone())


# ---------------- 工单本身的读写(给 API 和工作流用,不注册给模型) ----------------

def create_ticket(conn, customer_email: str, subject: str, body: str) -> str:
    cust = conn.execute("SELECT id FROM biz.customers WHERE email = %s", (customer_email.strip().lower(),)).fetchone()
    # 编号 = 现有最大编号 + 1,在同一条 INSERT 里算出来。两个请求同时算出同一个号时,
    # 后到的那条撞主键被 DO NOTHING 跳过、RETURNING 拿不到行,就重算一次
    for _ in range(5):
        row = conn.execute(
            "INSERT INTO biz.tickets (id, customer_id, customer_email, subject, body) "
            "SELECT 'T' || lpad((coalesce(max(substring(id from 2)::int), 0) + 1)::text, 6, '0'), %s, %s, %s, %s "
            "FROM biz.tickets ON CONFLICT (id) DO NOTHING RETURNING id",
            (cust["id"] if cust else None, customer_email, subject, body)).fetchone()
        if row:
            return row["id"]
    raise RuntimeError("工单编号连续冲突 5 次,数据库可能有大量并发写入")


def finish_ticket(conn, ticket_id: str, status: str, category: str | None, summary: str) -> None:
    conn.execute("UPDATE biz.tickets SET status = %s, category = %s, resolution_summary = %s, "
                 "resolved_at = CASE WHEN %s = 'resolved' THEN now() ELSE resolved_at END WHERE id = %s",
                 (status, category, summary, status, ticket_id))
```

<div class="line-notes">

- `"""业务工具的真正实现` 模块 docstring 把这一层的定位写死:纯函数 + 一条连接,不认识 LLM 和 MCP。后面 registry、mcp_server、测试三处都直接 import 这里的函数。
- `from decimal import ROUND_HALF_UP, Decimal` `Decimal` 是十进制精确小数,`ROUND_HALF_UP` 是「四舍五入」的舍入方式(Python 内置 `round` 用的是银行家舍入,`round(0.125, 2)` 得 0.12)。退款金额最后一步要用它保留两位。
- `from ..config import get_settings` 两个点是「上一级包」:当前文件在 `supportpilot/tools/` 里,`..config` 就是 `supportpilot/config.py`。这里只用它拿 `sp_today`(固定成 2026-10-01 的「今天」)。
- `class ToolError(Exception):` 自定义异常类,只用来装「给模型看的错误」。`registry.call_tool` 只捕获这一种,把它变成一句话交给模型;其他异常说明是代码 bug,不该被吞掉。
- `def _audit(conn, actor: str, action: str, payload: dict) -> None:` 写审计日志的小工具,前缀 `_` 表示模块内部用,不对外。
- `(actor, action, json.dumps(payload, ensure_ascii=False, default=str)))` `ensure_ascii=False` 让中文原样存进去,不变成 `年`;`default=str` 是兜底:遇到 json 不认识的类型(日期、Decimal)就转成字符串。实测创建李娜的退款申请后,`audit_log` 里多了一行:actor `agent`、action `create_refund_request`,payload 是 `{"id": "RF-T000001-INV-202609-0002", "rule": "annual_first_14_days", "refund_amount_cny": 950.0, ...}`。
- `def _jsonable(row: dict) -> dict:` 数据库查出来的行里有 `Decimal('950.00')` 和 `datetime.date(2026, 9, 24)`,`json.dumps` 不认识,这里统一转成 `950.0` 和 `"2026-09-24"`。
- `return {k: (float(v) if isinstance(v, Decimal) else v.isoformat() if isinstance(v, date) else v)` 字典推导式里套了两层条件表达式,读法是:「是 Decimal 就转 float,否则是 date 就转 ISO 字符串,否则原样」。注意 `datetime` 是 `date` 的子类,所以时间戳也会走 `isoformat()`,实测 `created_at` 变成了 `"2026-10-22T07:49:27.554428+08:00"`。
- `def get_customer(conn, email: str) -> dict:` 第一个只读工具。参数第一个永远是 `conn`,由调用方传进来,函数自己不建连接,这样测试可以传测试库的连接。
- `(email.strip().lower(),)).fetchone()` 先去空格再转小写,库里存的邮箱都是小写。实测传 `"  LiuYang@Example.com "` 照样查到 `{'id': 'C0004', 'name': '刘洋', 'email': 'liuyang@example.com', 'company': '洋帆科技', 'region': '上海', 'is_vip': False, 'created_at': '2025-06-01'}`。`(x,)` 末尾的逗号不能省,单元素元组要靠它。`%s` 是 psycopg 的参数占位符,值单独传,能防 SQL 注入。
- `raise ToolError(f"没有找到邮箱为 {email} 的客户。` 错误信息里带下一步怎么做(让客户提供注册邮箱)。实测传 `nobody@x.com` 抛出的就是这句话,模型读到会去问客户,而不是瞎猜一个客户 ID。
- `def list_subscriptions(conn, customer_id: str) -> list[dict]:` 实测 C0004 刘洋只有一条订阅:`{'id': 'S0004', 'plan': 'standard', 'billing_cycle': 'monthly', 'status': 'active', 'seats': 1, 'price_cny': 39.0, 'current_period_end': '2026-10-12', 'auto_renew': True, ...}`。
- `limit = max(1, min(limit, 20))` 把模型传来的 limit 夹在 1 到 20 之间。实测传 `limit=100`,C0004 也只返回 5 条(他一共就 5 张账单);传 0 或负数会变成 1。
- `params: list = [customer_id]` 参数列表和 SQL 一起拼:有 status 就在 SQL 后面加 `AND status = %s`,同时往 params 里追加值,两边一一对应。
- `total = conn.execute(f"SELECT count(*) AS n FROM ({sql}) t", params).fetchone()["n"]` 把上面的查询当子查询包一层数总数,过滤条件完全一致。这里用 f-string 拼的是我们自己写的 SQL 片段,不是用户输入,所以安全。实测 C0004 `total = 5`。
- `rows = conn.execute(sql + " ORDER BY issued_at DESC, id DESC LIMIT %s", [*params, limit]).fetchall()` `[*params, limit]` 是把列表展开再追加一个元素,得到 `["C0004", 2]`。同一天开的两张账单靠 `id DESC` 排出稳定顺序。
- `return {"total": total, "returned": len(rows), "invoices": [_jsonable(r) for r in rows]}` 实测 `list_invoices(conn, "C0004", limit=2)` 返回 `{"total": 5, "returned": 2, "invoices": [INV-202609-0004, INV-202609-0003]}`,两张都是 39 元、2026-09-12、同一个周期 09-12 到 10-12,这就是刘洋的重复扣款。
- `def _months_left(today: date, end: date) -> int:` 数「从今天起还剩几个完整月」:从今天开始一个月一个月往后数,数到超过到期日为止。
- `m = today.month - 1 + n + 1` 和下一行一起,是「给日期加 n+1 个月」的标准写法:先把月份转成从 0 开始,加上偏移,`m // 12` 算进了几年,`m % 12 + 1` 再转回 1–12。比如 2026-10 加 3 个月:`m = 9 + 3 = 12` → 年份 `2026 + 1 = 2027`,月份 `12 % 12 + 1 = 1`,得到 2027-01。
- `except ValueError:  # 比如 1 月 31 日加一个月` `date(2026, 2, 31)` 不存在会抛 ValueError,退到 28 日。实测 `_months_left(date(2026,1,31), date(2026,3,1))` 返回 1:2 月 31 日不存在退成 2 月 28 日,没超过 3 月 1 日,算一个整月。
- `if nxt > end:` 第 n+1 个月的同一天超过了到期日,说明只剩 n 个完整月。实测 `_months_left(date(2026,10,1), date(2027,3,15))` 返回 5(11 月、12 月、1 月、2 月、3 月 1 日都没超过 3 月 15 日,4 月 1 日超过了)。
- `def check_refund_eligibility(conn, invoice_id: str) -> dict:` 全项目最重要的函数。下面用 Day 44 的剧情客户逐个代入,`today` 固定是 2026-10-01。
- `today = get_settings().sp_today` 不用 `date.today()`,否则评测结果会随真实日期漂移(Day 44 讲过)。
- `"SELECT i.*, s.plan, s.billing_cycle FROM biz.invoices i JOIN biz.subscriptions s "` 账单表没有套餐和付费周期,要 JOIN 订阅表拿到。`i.*` 是账单的全部列。
- `raise ToolError(f"账单 {invoice_id} 不存在。账单号格式是` 实测传 `INV-2026-001`(模型常见的瞎编格式)得到这句,里面告诉它正确格式是 `INV-年月-四位序号`,真实的长这样:`INV-202609-0002`。
- `amount = Decimal(inv["amount_cny"])` psycopg 把 numeric 列读成 `Decimal('950.00')`,这里再包一层确保是 Decimal。
- `def result(eligible: bool, rule: str, reason: str, refund: Decimal = Decimal(0)) -> dict:` 函数里面定义的小函数(闭包),能直接用外面的 `invoice_id` 和 `amount`。每个分支都用它返回,保证 7 种结果的字段完全一致。
- `"refund_amount_cny": float(refund.quantize(Decimal("0.01"), ROUND_HALF_UP)),` `quantize(Decimal("0.01"))` 是保留到分。王芳那笔是 `950 × 7 / 12 × 0.9 = 498.75`,孙浩那笔是 `374 × 11 / 12 × 0.9 = 308.55`,算完再转 float 给 JSON。
- `if inv["status"] != "paid":` 第 1 关:没付的钱谈不上退。
- `pending = conn.execute("SELECT id, status FROM biz.refund_requests WHERE invoice_id = %s "` 第 2 关:这张账单已经有 pending/approved/executed 的申请,就不能再申请。rejected 的不算,被驳回后可以重新提。实测李娜建完申请后再查,返回 `{'eligible': False, 'rule': 'already_requested', 'reason': '这张账单已有退款申请 RF-T000001-INV-202609-0002(状态 pending),不要重复申请。'}`。
- `dup = conn.execute(` 第 3 关:同一订阅、同一 `period_start`、另一张也是 paid 的账单,就是重复扣款。`id <> %s` 排除自己。
- `return result(True, "duplicate_charge"` 实测 C0004 刘洋的 INV-202609-0004:找到同周期的 INV-202609-0003,返回 `eligible: True, rule: duplicate_charge, refund_amount_cny: 39.0`。注意他是月付,月付本来不退,所以这一关必须排在月付那关前面。
- `if inv["plan"] == "enterprise":` 第 4 关:企业版走合同。实测 C0008 黄强(7080 元企业版年付)返回 `enterprise_contract`,`eligible: False`,金额 0。
- `if inv["billing_cycle"] == "monthly":` 第 5 关:月付不退。实测 C0005 陈静的 39 元月付账单返回 `monthly_no_refund`。
- `days = (today - inv["paid_at"]).days` 两个 date 相减得到 timedelta,`.days` 取天数。李娜 9 月 24 日付款:`2026-10-01 - 2026-09-24 = 7` 天。
- `if inv["is_first_purchase"] and days <= 14:` 第 6 关:年付首购 14 天内全额退。实测 C0002 李娜第 7 天、950 元 → `annual_first_14_days`,退 950;C0011 徐丽 9 月 17 日付款,正好第 14 天,`<=` 包含边界,退 374。
- `if not inv["is_first_purchase"] and days <= 7:` 第 7 关:年付续费 7 天内全额退。实测 C0007 赵敏 9 月 27 日续费,第 4 天 → `annual_renewal_7_days`,退 374。
- `months = _months_left(today, inv["period_end"])` 剩下的都是「年付但过了全额期」。王芳 2026-05-20 买的,到期 2027-05-20,从 10-01 往后数:11-01、12-01……2027-05-01 都不超过,06-01 超过,`months = 7`。
- `refund = amount * months / 12 * Decimal("0.9")` 全程 Decimal 运算。`0.9` 必须写成 `Decimal("0.9")`,如果写 `Decimal(0.9)`(不带引号)会把浮点误差带进来,得到 `0.90000000000000002220446…`。
- `if months == 0:` 剩余不足一个整月,没得退。
- `return result(True, "annual_prorated",` 实测 C0003 王芳:`'年付已过退款全额期,剩余完整月份 7 个,退 950.00 × 7/12 × 90%。'`,金额 498.75;C0012 孙浩 9 月 16 日首购,到今天第 15 天,刚好错过 14 天全额期,剩 11 个月,退 308.55。这 7 个剧情客户的结果和 `test_refund_rules` 里的参数表一一对上。
- `def search_past_tickets(conn, customer_id: str, limit: int = 5) -> list[dict]:` 只查 resolved 的历史工单摘要。实测 C0004 在种子数据里没有已解决的工单,返回 `[]`,空列表也是合法答案,不报错。
- `def create_refund_request(conn, invoice_id: str, reason: str, ticket_id: str) -> dict:` 唯一的写工具。注意参数里**没有金额**,模型没地方传「给我退 9999」。
- `elig = check_refund_eligibility(conn, invoice_id)  # 不信任模型传来的金额,服务端重新算` 就算模型前一步刚调过资格检查,这里也再算一遍,防止中间有人改了数据,也防止模型跳过检查直接调用。
- `raise ToolError(f"这张账单不符合退款条件:{elig['reason']} 不要创建退款申请,按规则向客户解释。")` 实测对陈静的月付账单调用,得到 `这张账单不符合退款条件:月付订阅不支持退款,可以关闭自动续费,当期结束后停止。 不要创建退款申请,按规则向客户解释。`
- `req_id = f"RF-{ticket_id}-{invoice_id}"  # 幂等键` 实测工单 T000001、账单 INV-202609-0002 得到 `RF-T000001-INV-202609-0002`。同一张工单重复调用,ID 一样。
- `"VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING",` 主键冲突时什么也不做,不报错。这是第二道防重:第一道是上面资格检查里的 `already_requested`。
- `row = conn.execute("SELECT * FROM biz.refund_requests WHERE id = %s", (req_id,)).fetchone()` 写完再读一次,拿到数据库填的默认值(`status='pending'`、`created_at`)。
- `return {**_jsonable(row), "note": "已创建待审批的退款申请。` `{**a, "k": v}` 是复制字典再加字段。实测返回 `{'id': 'RF-T000001-INV-202609-0002', 'customer_id': 'C0002', 'amount_cny': 950.0, 'rule': 'annual_first_14_days', 'status': 'pending', 'decided_by': None, ..., 'note': '已创建待审批的退款申请。不要告诉客户退款已完成,只能说已提交审核。'}`。`note` 是写给模型的话,直接跟着工具结果进上下文。
- `def escalate_to_human(conn, ticket_id: str, reason: str) -> dict:` 把工单标成 escalated 并记审计。实测返回 `{'ticket_id': 'T000154', 'status': 'escalated'}`。它不注册给模型,由工作流的 handoff 节点调用。
- `def decide_refund(conn, request_id: str, approved: bool, approver: str, note: str = "") -> dict:` 只给人用。模型的工具列表里没有它。
- `with conn.transaction():` 连接是 autocommit 模式,要几条语句一起成功或一起失败,就显式开事务。块里任何一步抛异常都会回滚。
- `row = conn.execute("SELECT * FROM biz.refund_requests WHERE id = %s FOR UPDATE", (request_id,)).fetchone()` `FOR UPDATE` 给这一行加锁,直到事务结束。两个财务同时点「通过」,第二个会在这里等第一个提交。实测传不存在的 `RF-NOPE`,抛 `退款申请 RF-NOPE 不存在`。
- `if row["status"] != "pending":` 已经处理过就原样返回。实测 amy 批准后,bob 再点「驳回」,返回的 status 还是 `executed`,没有被改成 rejected。
- `status = "executed" if approved else "rejected"` 演示项目里批准就直接算「已执行」,真实系统会先 approved、调完支付网关成功再 executed。
- `conn.execute("UPDATE biz.invoices SET status = 'refunded' WHERE id = %s", (row["invoice_id"],))` 实测批准后 INV-202609-0002 的状态变成了 `refunded`。所以测试结尾要把它改回 `paid`,不然下一个测试跑资格检查会撞上 `not_paid`。
- `_audit(conn, f"human:{approver}", "decide_refund"` actor 写成 `human:amy`,审计里一眼能分出是 Agent 干的还是人干的。
- `return _jsonable(conn.execute("SELECT * FROM biz.refund_requests WHERE id = %s", (request_id,)).fetchone())` 实测返回 `{'status': 'executed', 'decided_by': 'amy', 'decided_at': '2026-10-22T07:49:27.558934+08:00', 'note': '核对无误', ...}`。
- `cust = conn.execute("SELECT id FROM biz.customers WHERE email = %s"` 发件邮箱查不到客户也照样建工单,`customer_id` 存 NULL。实测用 `stranger@x.com` 建的工单,`customer_id` 是 `None`。
- `for _ in range(5):` 最多试 5 次。`_` 表示循环变量用不到。正常情况第一次就成功。
- `"SELECT 'T' || lpad((coalesce(max(substring(id from 2)::int), 0) + 1)::text, 6, '0'), %s, %s, %s, %s "` 编号在 SQL 里算:`substring(id from 2)` 去掉开头的 T,`::int` 转成数字,取最大值加 1,`lpad(..., 6, '0')` 左边补零到 6 位,`||` 拼上 T。表是空的时 `max` 返回 NULL,`coalesce` 把它换成 0,第一张就是 T000001。种子数据最大是 T000152,实测新建的是 `T000153`。<br>为什么不用「工单数 + 1」:实测删掉 T000100 之后,工单数是 152 而最大编号是 T000153,旧公式算出 T000153,和已有的撞上。
- `"FROM biz.tickets ON CONFLICT (id) DO NOTHING RETURNING id",` 两个请求同时算出同一个号时,先提交的成功,后到的撞主键被跳过,`RETURNING` 什么也不返回。实测 20 个线程同时建工单,拿到 T000155 到 T000174 共 20 个不重复的号,0 报错;同样 20 个线程跑旧写法,20 次全部 `UniqueViolation`。
- `if row:` 拿到行说明插入成功,返回编号;拿不到就回到循环开头重新算一次最大值。
- `raise RuntimeError("工单编号连续冲突 5 次` 连续 5 次都撞,说明并发量远超这个写法能承受的范围,该换数据库序列了,直接报错比静默丢工单好。
- `def finish_ticket(conn, ticket_id: str, status: str, category: str | None, summary: str) -> None:` 工作流结束时写回工单状态和分类。
- `"resolved_at = CASE WHEN %s = 'resolved' THEN now() ELSE resolved_at END WHERE id = %s",` 只有状态是 resolved 时才填解决时间,其他状态保留原值。`status` 在参数里传了两次,因为 SQL 里用到两次 `%s`。实测 `finish_ticket(conn, "T000154", "resolved", "billing", "测试摘要")` 后,`resolved_at` 有了值。

</div>

挑几处讲。

**`list_invoices` 返回 total 和 returned。** 只返回列表的话,模型拿到 6 条就以为这是全部账单。告诉它"一共 14 条、这次给了 6 条",它才知道要不要翻页或者加过滤条件。limit 也被限制在 1 到 20 之间,防止模型一次要 1000 条把上下文撑爆。

**`check_refund_eligibility` 是全项目最重要的函数。** 它按顺序检查:账单是否已支付 → 是否已有退款申请 → 是否重复扣款 → 是否企业版 → 是否月付 → 年付首购是否 14 天内 → 年付续费是否 7 天内 → 否则按剩余完整月份比例退。顺序是有讲究的:重复扣款放在月付之前,因为月付虽然不退,但被重复扣的那笔要退;已有申请放在最前面,防止重复申请。每个分支返回的 `rule` 字段是一个固定的英文标识,审批人和评测脚本都靠它判断。

金额用 `Decimal` 而不是 `float`。浮点误差是碰运气的:`950 * 7 / 12 * 0.9` 在 Python 里恰好算出 498.75,可 `1.15 * 100` 算出来是 114.99999999999999,`round(2.675, 2)` 得到的是 2.67 而不是 2.68(2.675 在二进制里存成了 2.67499999…)。你没法提前知道哪个数会出事,所以钱的计算一律 Decimal,这是做过账务系统的人的肌肉记忆。

**`create_refund_request` 不信任模型传来的任何金额。** 它根本不接收金额参数,而是自己重新调一遍 `check_refund_eligibility`。模型就算被客户说服"给我退 9999",也没有地方能传这个数。不符合条件直接抛 `ToolError`,错误信息里告诉模型"不要创建退款申请,按规则向客户解释"。

申请 ID 是 `RF-工单号-账单号`,天然幂等:同一张工单对同一张账单重复调用,`ON CONFLICT DO NOTHING` 保证只有一条。模型重试、网络重放都不会产生重复申请。

**`decide_refund` 用 `SELECT ... FOR UPDATE` 锁住那一行。** 两个财务同时点"通过",第二个会等第一个提交,然后看到状态已经不是 pending,直接返回原结果。重复点击不会退两次钱。

**每个写操作都进 `audit_log`。** Agent 建了什么申请、谁批的、批的时候写了什么备注,全有记录。

**`create_ticket` 和 `finish_ticket`** 是给 API 和工作流用的,不注册给模型。工单编号我第一版写的是「现有工单数 + 1」,有两个毛病:删过工单后算出来的号会和已有的撞上;两个请求同时进来会算出同一个号。现在改成在一条 INSERT 里用「最大编号 + 1」,撞了主键就 `ON CONFLICT DO NOTHING`、`RETURNING` 拿不到行,再算一次。不用改表结构。

## 权限分级和注册表

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="工具权限三级">
<g font-family="var(--font-mono)" font-size="11">
<rect x="10" y="20" width="200" height="190" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="110" y="42" text-anchor="middle" font-size="12" fill="var(--ink)">READ 只读</text>
<text x="110" y="66" text-anchor="middle" fill="var(--ink-soft)">get_customer</text>
<text x="110" y="86" text-anchor="middle" fill="var(--ink-soft)">list_subscriptions</text>
<text x="110" y="106" text-anchor="middle" fill="var(--ink-soft)">list_invoices</text>
<text x="110" y="126" text-anchor="middle" fill="var(--ink-soft)">check_refund_eligibility</text>
<text x="110" y="146" text-anchor="middle" fill="var(--ink-soft)">search_past_tickets</text>
<text x="110" y="166" text-anchor="middle" fill="var(--ink-soft)">query_customer_data (SQL)</text>
<text x="110" y="196" text-anchor="middle" fill="var(--ink)">模型随便调</text>
<rect x="220" y="20" width="200" height="190" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="42" text-anchor="middle" font-size="12" fill="var(--ink)">PROPOSE 提议</text>
<text x="320" y="86" text-anchor="middle" fill="var(--ink-soft)">create_refund_request</text>
<text x="320" y="116" text-anchor="middle" fill="var(--ink-soft)">只产生 pending 申请</text>
<text x="320" y="136" text-anchor="middle" fill="var(--ink-soft)">金额服务端重算</text>
<text x="320" y="156" text-anchor="middle" fill="var(--ink-soft)">推送到财务群</text>
<text x="320" y="196" text-anchor="middle" fill="var(--ink)">模型能调,人来定</text>
<rect x="430" y="20" width="200" height="190" rx="6" fill="var(--paper-raised)" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="530" y="42" text-anchor="middle" font-size="12" fill="var(--ink)">不注册</text>
<text x="530" y="86" text-anchor="middle" fill="var(--ink-soft)">decide_refund</text>
<text x="530" y="106" text-anchor="middle" fill="var(--ink-soft)">escalate_to_human</text>
<text x="530" y="126" text-anchor="middle" fill="var(--ink-soft)">create / finish_ticket</text>
<text x="530" y="196" text-anchor="middle" fill="var(--ink)">模型看不到名字</text>
</g>
</svg>
<figcaption>三级权限。最右边一栏的函数只被工作流代码或人工界面调用,不出现在发给模型的工具列表里。</figcaption>
</figure>

```python
# supportpilot/src/supportpilot/tools/registry.py
"""把 business.py 的函数注册成模型能调用的工具。W2 手写过的那套注册表的产品版:
参数用 pydantic 校验、每个工具带权限级别、返回值截断、错误转成模型看得懂的话。"""

import json
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from . import business as biz
from .notify import send_refund_approval
from .sql_tool import SCHEMA_DOC, run_customer_sql


class Level(StrEnum):
    READ = "read"            # 只读,随便调
    PROPOSE = "propose"      # 产生待审批的东西,必须过人工
    # 直接动钱的(decide_refund)根本不注册,模型连名字都看不到


class CustomerEmail(BaseModel):
    email: str = Field(description="客户注册邮箱,通常就是工单里的发件邮箱")


class CustomerId(BaseModel):
    customer_id: str = Field(description="客户 ID,形如 C0001,先用 get_customer 查到")


class InvoiceQuery(BaseModel):
    customer_id: str = Field(description="客户 ID,形如 C0001")
    status: str | None = Field(None, description="按状态过滤:paid / open / failed / refunded / void,不填就是全部")
    limit: int = Field(6, description="最多返回几条,默认 6,最大 20,按开票日期倒序")


class InvoiceId(BaseModel):
    invoice_id: str = Field(description="账单号,形如 INV-202609-0001")


class RefundRequest(BaseModel):
    invoice_id: str = Field(description="要退款的账单号。先用 check_refund_eligibility 确认 eligible=true 再调用")
    reason: str = Field(description="一句话退款原因,写给审批人看,例如:年付首购第 7 天,客户不再需要")


class SqlQuery(BaseModel):
    sql: str = Field(description="一条 PostgreSQL SELECT 语句,只能用下面描述里的三张表,表名不加 schema 前缀")


@dataclass
class Tool:
    name: str
    description: str
    args: type[BaseModel]
    fn: Callable[..., Any]
    level: Level

    def schema(self) -> dict:
        params = self.args.model_json_schema()
        params.pop("title", None)
        return {"type": "function", "function": {"name": self.name, "description": self.description,
                                                 "parameters": params}}


TOOLS: dict[str, Tool] = {t.name: t for t in [
    Tool("get_customer", "按邮箱查客户档案(客户 ID、姓名、公司、是否 VIP)。处理任何账户相关问题的第一步。",
         CustomerEmail, biz.get_customer, Level.READ),
    Tool("list_subscriptions", "查客户的订阅:套餐、月付/年付、状态(active/past_due/canceled)、到期日、是否自动续费。",
         CustomerId, biz.list_subscriptions, Level.READ),
    Tool("list_invoices", "查客户的账单列表,按开票日期倒序。返回 total 表示一共多少条,returned 表示本次给了多少条。",
         InvoiceQuery, biz.list_invoices, Level.READ),
    Tool("check_refund_eligibility", "按退款政策判断一张账单能否退款、可退多少、依据哪条规则。客户提到退款时必须先调这个,"
         "不要自己计算退款金额。", InvoiceId, biz.check_refund_eligibility, Level.READ),
    Tool("search_past_tickets", "查客户最近已解决的历史工单摘要,用来了解客户之前遇到过什么问题。",
         CustomerId, biz.search_past_tickets, Level.READ),
    Tool("create_refund_request", "为符合条件的账单创建退款申请。申请会进入人工审批,不会立即退款。"
         "只有 check_refund_eligibility 返回 eligible=true 且客户明确要求退款时才调用。",
         RefundRequest, biz.create_refund_request, Level.PROPOSE),
    Tool("query_customer_data", "用 SQL 查当前客户的账单、订阅、工单做统计,比如今年一共付了多少钱、按月汇总、"
         "某段时间有几笔失败扣款。固定格式的查询优先用上面的专用工具,专用工具答不了的再用这个。\n" + SCHEMA_DOC,
         SqlQuery, run_customer_sql, Level.READ),
]}


def openai_tools(allowed: set[Level] | None = None) -> list[dict]:
    allowed = allowed or {Level.READ, Level.PROPOSE}
    return [t.schema() for t in TOOLS.values() if t.level in allowed]


def call_tool(conn, name: str, arguments: str | dict, *, ticket_id: str, customer_id: str | None = None,
              max_chars: int = 3000) -> tuple[str, bool]:
    """执行一次工具调用,返回 (给模型看的文本, 是否出错)。永远不抛异常:错误也是给模型的观察结果。"""
    tool = TOOLS.get(name)
    if tool is None:
        return f"没有叫 {name} 的工具。可用工具:{', '.join(TOOLS)}", True
    try:
        raw = json.loads(arguments) if isinstance(arguments, str) else arguments
        args = tool.args.model_validate(raw).model_dump()
    except (json.JSONDecodeError, ValidationError) as e:
        return f"参数不合法:{e}。请按工具的参数说明重新调用。", True
    if name == "create_refund_request":
        args["ticket_id"] = ticket_id  # 工单号由系统注入,不让模型自己填
    if name == "query_customer_data":
        if not customer_id:
            return "当前工单没有关联到客户,不能查询客户数据。", True
        args["customer_id"] = customer_id  # 查谁的数据由系统决定,模型改不了
    try:
        out = tool.fn(conn, **args)
    except biz.ToolError as e:
        return str(e), True
    if name == "create_refund_request":
        try:  # 推给财务群;放在工具层而不是审批节点,恢复执行时不会重复发
            send_refund_approval(out)
        except Exception as e:  # noqa: BLE001  申请已经写进库了,通知失败不能让这次调用变成失败
            out["notify_error"] = f"审批通知没发出去({type(e).__name__}),申请本身已创建,财务在工作台能看到"
    text = json.dumps(out, ensure_ascii=False, default=str)
    if len(text) > max_chars:
        text = text[:max_chars] + f"…(已截断,原始长度 {len(text)} 字符,请缩小查询范围)"
    return text, False
```

<div class="line-notes">

- `from collections.abc import Callable` `Callable` 是「可调用对象」的类型,下面 `Tool.fn` 用它标注:存的是一个函数。
- `from enum import StrEnum` `StrEnum`(3.11+)的成员同时是字符串,`Level.READ == "read"` 为 True,序列化成 JSON 也直接是 `"read"`。
- `from .notify import send_refund_approval` 一个点是同一个包:`tools/notify.py`。
- `class Level(StrEnum):` 工具权限级别。只有两级,第三级「直接动钱」根本不进这个文件。
- `class CustomerEmail(BaseModel):` 每个工具的参数用一个 pydantic 模型描述。模型调用时传来的 JSON 先过它校验,再交给业务函数。
- `email: str = Field(description="客户注册邮箱,通常就是工单里的发件邮箱")` `description` 会原样出现在发给模型的 JSON Schema 里,这句话就是模型看到的参数说明。
- `class InvoiceQuery(BaseModel):` 三个参数,只有 `customer_id` 必填。实测生成的 schema:`{"properties": {"customer_id": {"description": "客户 ID,形如 C0001", "type": "string"}, "status": {"anyOf": [{"type": "string"}, {"type": "null"}], "default": null, ...}, "limit": {"default": 6, "type": "integer", ...}}, "required": ["customer_id"]}`。
- `status: str | None = Field(None, description=` `Field` 第一个位置参数是默认值。`str | None` 在 schema 里变成 `anyOf: [string, null]`。
- `class RefundRequest(BaseModel):` 只有 `invoice_id` 和 `reason` 两个参数。`ticket_id` 故意不放进来,下面由系统注入。
- `description="要退款的账单号。先用 check_refund_eligibility 确认 eligible=true 再调用"` 前置条件写进参数说明,模型在决定调用时就能看到。
- `@dataclass` 自动生成 `__init__`,下面 `Tool("get_customer", "...", CustomerEmail, biz.get_customer, Level.READ)` 按字段顺序传参就行。
- `def schema(self) -> dict:` 把一个工具转成 OpenAI 的 tools 格式。
- `params = self.args.model_json_schema()` pydantic 自动生成 JSON Schema,字段类型、默认值、是否必填、description 全在里面。
- `params.pop("title", None)` 去掉 pydantic 自带的 `"title": "InvoiceQuery"`,这个类名对模型没用,还占 token。`pop` 的第二个参数是没有这个键时的默认值,避免 KeyError。字段级别的 `"title": "Customer Id"` 还在,实测输出里能看到。
- `return {"type": "function", "function": {"name": self.name, "description": self.description,` 实测 `TOOLS["list_invoices"].schema()` 得到 `{"type": "function", "function": {"name": "list_invoices", "description": "查客户的账单列表,按开票日期倒序。返回 total 表示一共多少条,returned 表示本次给了多少条。", "parameters": {...}}}`。
- `TOOLS: dict[str, Tool] = {t.name: t for t in [` 字典推导式:先写一个 Tool 列表,再按名字建索引。实测一共 7 个键,顺序就是列表里的顺序。
- `Tool("get_customer", "按邮箱查客户档案` 工具描述里写「处理任何账户相关问题的第一步」,是在给模型排调用顺序。
- `Tool("check_refund_eligibility", "按退款政策判断一张账单能否退款` 描述里明说「不要自己计算退款金额」。两段字符串相邻会自动拼接。
- `RefundRequest, biz.create_refund_request, Level.PROPOSE),` 七个工具里只有它是 PROPOSE。
- `"某段时间有几笔失败扣款。固定格式的查询优先用上面的专用工具,专用工具答不了的再用这个。\n" + SCHEMA_DOC,` 把三张表的结构说明拼进工具描述,模型写 SQL 时知道有哪些列、状态有哪些取值。
- `def openai_tools(allowed: set[Level] | None = None) -> list[dict]:` 按级别筛出要发给模型的工具。
- `allowed = allowed or {Level.READ, Level.PROPOSE}` 不传就是两级都给。实测默认返回 7 个工具名;传 `{Level.READ}` 返回 6 个,少了 `create_refund_request`。`decide_refund`、`escalate_to_human` 两种情况下都不在里面。
- `def call_tool(conn, name: str, arguments: str | dict, *, ticket_id: str, customer_id: str | None = None,` 参数列表里的 `*` 表示后面的参数只能用关键字传,调用时必须写 `ticket_id="T1"`,不会因为位置传错把工单号当成客户 ID。
- `"""执行一次工具调用,返回 (给模型看的文本, 是否出错)。` 返回一个二元组,第二个值是 `is_error`,Agent 循环据此决定要不要在日志里标红。
- `return f"没有叫 {name} 的工具。可用工具:{', '.join(TOOLS)}", True` 遍历字典得到的是键,所以 `', '.join(TOOLS)` 就是工具名列表。实测调 `refund_everything` 返回 `('没有叫 refund_everything 的工具。可用工具:get_customer, list_subscriptions, list_invoices, check_refund_eligibility, search_past_tickets, create_refund_request, query_customer_data', True)`。
- `raw = json.loads(arguments) if isinstance(arguments, str) else arguments` 模型返回的 arguments 是 JSON 字符串,测试和代码内部调用时可以直接传字典,两种都接。
- `args = tool.args.model_validate(raw).model_dump()` 校验并转回普通字典,顺便填上默认值。传 `{"customer_id": "C0004"}` 得到 `{"customer_id": "C0004", "status": None, "limit": 6}`。
- `except (json.JSONDecodeError, ValidationError) as e:` 两种错一起接。实测传 `'{"limit": "many"}'` 得到 `参数不合法:2 validation errors for InvoiceQuery\ncustomer_id\n  Field required ...\nlimit\n  Input should be a valid integer ...`;传残缺的 `'{"customer_id": "C0004",'` 得到 `参数不合法:Expecting property name enclosed in double quotes: line 1 column 25 (char 24)。` pydantic 的报错原文挺长,但模型能看懂缺了什么、哪个类型不对。
- `args["ticket_id"] = ticket_id  # 工单号由系统注入,不让模型自己填` 实测模型参数里硬塞 `"ticket_id": "HACK"`,先被 pydantic 丢掉(`RefundRequest` 没这个字段,默认忽略多余字段),再被这里设成真实工单号。建出来的申请 ID 是 `RF-T000009-INV-202609-0002`,不是 HACK。
- `if not customer_id:` 工单没关联到客户(陌生邮箱)时,SQL 工具直接拒绝。实测返回 `('当前工单没有关联到客户,不能查询客户数据。', True)`。
- `args["customer_id"] = customer_id  # 查谁的数据由系统决定,模型改不了` 实测参数里写 `"customer_id": "C9999"`,结果查的仍是系统传进来的 C0004:今年已付总额 `195.0`(5 张 39 元)。
- `out = tool.fn(conn, **args)` `**args` 把字典展开成关键字参数,等价于 `biz.list_invoices(conn, customer_id="C0004", status=None, limit=6)`。
- `except biz.ToolError as e:` 只接业务错误。实测 `check_refund_eligibility` 传 `INV-2026-001`,返回 `('账单 INV-2026-001 不存在。账单号格式是 INV-年月-四位序号,可以先调 list_invoices 查。', True)`。
- `try:  # 推给财务群;放在工具层而不是审批节点` 申请建好了才发通知,发通知包在 try 里。`notify.py` 自己只接网络错误,配置缺字段(比如 Settings 里漏了 `console_url`)会抛 AttributeError。我按文章重建项目时第一次就漏了上面那三行配置,撞上过这个错,当时申请已经写进库,工具调用却直接崩了。
- `except Exception as e:  # noqa: BLE001  申请已经写进库了` 这里接所有异常是故意的:通知失败不该让模型以为申请没建成、再去重试。实测把通知函数换成一个抛 AttributeError 的假函数,`call_tool` 返回 `is_error=False`,申请状态 `pending`,数据库里有这一条。
- `out["notify_error"] = f"审批通知没发出去` 结果里多一个字段说明情况,模型和工作台都能看到。实测内容是 `审批通知没发出去(AttributeError),申请本身已创建,财务在工作台能看到`。
- `text = json.dumps(out, ensure_ascii=False, default=str)` 结果统一转成 JSON 文本交给模型。实测 `list_invoices` C0004 limit=2 的结果是 `{"total": 5, "returned": 2, "invoices": [{"id": "INV-202609-0004", ...}, {"id": "INV-202609-0003", ...}]}`,`is_error` 为 False。
- `if len(text) > max_chars:` 超过上限就截断,并告诉模型原来有多长。实测用 `max_chars=200` 跑 `SELECT * FROM invoices`,结尾是 `…(已截断,原始长度 1353 字符,请缩小查询范围)`。

</div>

和 W2 手写的注册表比,多了这几样:

参数用 pydantic 模型定义,`model_json_schema()` 自动生成 JSON Schema,`Field(description=...)` 就是给模型看的参数说明。说明里写清楚格式("形如 C0001")和前置条件("先用 check_refund_eligibility 确认 eligible=true 再调用"),模型调错的概率会明显下降。

`call_tool` 永远不抛异常。工具不存在、参数不合法、业务规则不允许,全都变成一句话返回给模型,并标记 `is_error=True`。Agent 循环拿到错误后照常把它作为工具结果喂回去,模型下一轮自己改。如果这里抛异常,整个工单就崩了。

有些参数不让模型填。`ticket_id` 和 `customer_id` 由系统注入:模型调 `create_refund_request` 时不需要(也没办法)指定工单号,调 `query_customer_data` 时不需要(也没办法)指定查哪个客户。这是防止"越权查别人数据"最简单可靠的办法:不给它这个参数。

返回值超过 3000 字符截断,并告诉模型原始有多长、建议缩小查询范围。

## 对接企业系统(一):审批通知推到群里

老周说财务审批都在飞书群里。真实企业里,Agent 很少是一个孤立的系统,它要融进已有的协作流程。最轻量的对接方式是群机器人 webhook:在飞书、钉钉或企业微信的群里加一个自定义机器人,拿到一个 URL,往这个 URL POST 一段 JSON,群里就出现一条消息。

```python
# supportpilot/src/supportpilot/tools/notify.py
"""审批通知:退款申请创建后,推一条消息到财务群(飞书 / 钉钉 / 企业微信的群机器人 webhook)。
没配 APPROVAL_WEBHOOK_URL 时打印到终端,本地开发不用真建群。
审批动作本身还是在 SupportPilot 的工作台里点(Day 49),群消息里放工作台链接。
想在群里直接点"通过/驳回",要用飞书/钉钉的交互卡片 + 回调地址,回调必须验签,见文末练习。"""

import httpx

from ..config import get_settings


def _payload(platform: str, text: str) -> dict:
    if platform == "feishu":
        return {"msg_type": "text", "content": {"text": text}}
    # 钉钉和企业微信的文本消息格式一样
    return {"msgtype": "text", "text": {"content": text}}


def send_refund_approval(request: dict) -> None:
    s = get_settings()
    text = (f"【退款待审批】{request['id']}\n客户:{request['customer_id']}  金额:¥{request['amount_cny']}\n"
            f"规则:{request['rule']}  原因:{request['reason']}\n"
            + ("⚠️ 超过复核线,需财务复核\n" if request["amount_cny"] > s.refund_review_threshold else "")
            + f"去审批:{s.console_url}/?ticket={request.get('ticket_id', '')}")
    if not s.approval_webhook_url:
        print(f"[notify:dry-run]\n{text}")
        return
    try:
        httpx.post(s.approval_webhook_url, json=_payload(s.approval_webhook_platform, text), timeout=5)
    except httpx.HTTPError as e:  # 通知失败不能影响主流程,审批单已经在库里了
        print(f"[notify] 发送失败:{e}")
```

<div class="line-notes">

- `import httpx` 发 HTTP 请求的库,和 requests 用法差不多,还支持异步。
- `def _payload(platform: str, text: str) -> dict:` 三家群机器人的「纯文本消息」JSON 格式不一样,在这里统一。
- `return {"msg_type": "text", "content": {"text": text}}` 飞书的格式。实测 `_payload("feishu", "hi")` 得到 `{'msg_type': 'text', 'content': {'text': 'hi'}}`。
- `return {"msgtype": "text", "text": {"content": text}}` 钉钉和企业微信的格式,注意键名是 `msgtype` 没有下划线。实测 `_payload("dingtalk", "hi")` 得到 `{'msgtype': 'text', 'text': {'content': 'hi'}}`。
- `def send_refund_approval(request: dict) -> None:` 参数就是 `create_refund_request` 的返回值。
- `text = (f"【退款待审批】{request['id']}\n客户:{request['customer_id']}  金额:¥{request['amount_cny']}\n"` 几段 f-string 和普通字符串用 `+` 拼成一条消息。
- `+ ("⚠️ 超过复核线,需财务复核\n" if request["amount_cny"] > s.refund_review_threshold else "")` 超过 1000 元(配置里的 `refund_review_threshold`)才多一行提醒。实测李娜 950 元那条没有这一行;拿一条 7080 元的假申请试,多出了 `⚠️ 超过复核线,需财务复核`。
- `+ f"去审批:{s.console_url}/?ticket={request.get('ticket_id', '')}")` `.get('ticket_id', '')` 键不存在时给空串,不抛 KeyError。
- `if not s.approval_webhook_url:` 没配 webhook 就打印。实测打印出来是:<br>`[notify:dry-run]`<br>`【退款待审批】RF-T000009-INV-202609-0002`<br>`客户:C0002  金额:¥950.0`<br>`规则:annual_first_14_days  原因:测试`<br>`去审批:http://localhost:8501/?ticket=T000009`
- `httpx.post(s.approval_webhook_url, json=_payload(s.approval_webhook_platform, text), timeout=5)` `json=` 会自动序列化并带上 `Content-Type: application/json`。`timeout=5` 防止群机器人接口卡住拖慢整张工单。
- `except httpx.HTTPError as e:  # 通知失败不能影响主流程` 只接网络类错误(超时、连不上、DNS 失败)。审批单已经在数据库里了,群消息只是提醒。

</div>

配置里加三项(`config.py` 的 Settings 类和 `.env.example` 各加几行):

```python
    # Day 46:审批通知(飞书 feishu / 钉钉 dingtalk / 企业微信 wecom 的群机器人 webhook),留空 = 只打印
    approval_webhook_url: str = ""
    approval_webhook_platform: str = "feishu"
    console_url: str = "http://localhost:8501"
```

<div class="line-notes">

- `# Day 46:审批通知` 这三行加进 Day 44 的 `Settings` 类里,和别的字段一样会自动读同名环境变量 `APPROVAL_WEBHOOK_URL` 等。别漏加:我按文章重建项目时一开始没加,`notify.py` 里读 `s.console_url` 直接抛 `AttributeError: 'Settings' object has no attribute 'console_url'`。
- `approval_webhook_url: str = ""` 默认空串,表示只打印不发送。
- `approval_webhook_platform: str = "feishu"` 取值 feishu / dingtalk / wecom,决定 `_payload` 用哪种格式。
- `console_url: str = "http://localhost:8501"` 群消息里「去审批」链接的前缀,8501 是 Day 49 Streamlit 工作台的默认端口。

</div>

```bash
# Day 46 审批通知:飞书/钉钉/企业微信群机器人 webhook,留空只打印到终端
APPROVAL_WEBHOOK_URL=
APPROVAL_WEBHOOK_PLATFORM=feishu
CONSOLE_URL=http://localhost:8501
```

几个决定:

**通知在哪一层发?** 我放在 `registry.call_tool` 里,`create_refund_request` 成功之后立刻发。为什么不放在 Day 47 的审批节点里?因为 LangGraph 的 interrupt 有个特性:节点恢复执行时,`interrupt()` 之前的代码会重新跑一遍。如果通知写在审批节点里,财务点完"通过",群里会再收到一遍"待审批"。放在工具层,只在创建申请那一刻发一次。

**通知失败怎么办?** 吞掉异常打印日志,不影响主流程。申请已经在数据库里了,工作台能看到,群消息只是提醒。别让一个通知系统的抖动把整张工单搞崩。

**为什么审批按钮不放在群里?** 飞书和钉钉都支持交互式卡片,可以在群消息里放"通过/驳回"按钮。但按钮点击会回调你的服务器,你需要一个公网可达的回调地址,还要校验签名(否则任何人知道你的回调地址都能伪造审批)。这些 Day 53 部署后才好做,现在群消息里放一个工作台链接就够了。

群机器人一般有三种安全设置:自定义关键词、IP 白名单、签名校验。本地开发最简单的是关键词,把"退款"设成关键词,我们的消息里一定有。上线后建议换成签名校验,飞书和钉钉的签名算法都是"时间戳 + 密钥做 HMAC-SHA256",文档里有现成示例。

## 对接企业系统(二):受控的 text-to-SQL

专用工具覆盖了 80% 的问题,但总有客户问"我今年一共付了多少钱""这半年有几次扣款失败"。给每种统计都写一个工具不现实,让模型写 SQL 是自然的选择。很多公司内部的"数据问答 Agent"就是这么做的,JD 里"熟练 SQL"也是这个意思。

问题是让模型写 SQL 非常危险。它可能写出 `DELETE`,可能查别的客户的数据,可能写一个跑十分钟的笛卡尔积,可能被工单里的注入诱导去查 `pg_catalog`。所以我设计了三道闸,每一道都不依赖提示词:

```python
# supportpilot/src/supportpilot/tools/sql_tool.py
"""text-to-SQL 查询工具:模型写 SQL,我们校验后在只读事务里执行。
三道闸,哪一道都不靠提示词:
1. sqlglot 解析:只允许一条 SELECT,不许出现任何写操作、危险函数、带 schema 的表名;
2. 行级隔离:模型只能写裸表名 invoices / subscriptions / tickets,执行时我们在外面套一层同名 CTE,
   这三个名字指向的已经是"只含当前客户的数据",模型就算忘了写 WHERE customer_id 也查不到别人;
3. 只读事务 + 语句超时 + 行数上限。生产环境再加一层:用只有 SELECT 权限的数据库账号执行。"""

import sqlglot
from sqlglot import exp

from .business import ToolError, _jsonable

ALLOWED = {"invoices", "subscriptions", "tickets"}
BANNED_FUNCS = ("pg_", "dblink", "lo_", "current_setting", "set_config", "query_to_xml")
SCHEMA_DOC = """可查询的表(都已经只包含当前客户的数据,不需要再按 customer_id 过滤):
- invoices(id, subscription_id, amount_cny, status[paid/open/failed/refunded/void], issued_at, paid_at,
  period_start, period_end, is_first_purchase)
- subscriptions(id, plan[free/standard/pro/enterprise], billing_cycle[monthly/yearly],
  status[trialing/active/past_due/canceled], seats, price_cny, started_at, current_period_end, auto_renew)
- tickets(id, subject, category, status, created_at, resolved_at, resolution_summary)
只能写一条 PostgreSQL SELECT 语句,表名不要加 schema 前缀。"""


def validate_sql(sql: str) -> str:
    sql = sql.strip().rstrip(";")
    try:
        statements = sqlglot.parse(sql, dialect="postgres")
    except sqlglot.errors.ParseError as e:
        raise ToolError(f"SQL 语法错误:{str(e)[:200]}。请修正后重试。") from e
    if len(statements) != 1 or statements[0] is None:
        raise ToolError("只能提交一条 SQL 语句。")
    tree = statements[0]
    if not isinstance(tree, exp.Query):  # Select / Union 等都是 Query 的子类
        raise ToolError("只允许 SELECT 查询。")
    for node in tree.walk():
        if isinstance(node, (exp.Insert, exp.Update, exp.Delete, exp.Drop, exp.Create, exp.Alter,
                             exp.Command, exp.Into)):
            raise ToolError("只允许只读查询,不能包含写操作或 SELECT INTO。")
        if isinstance(node, exp.With) and node.args.get("recursive"):
            raise ToolError("不允许 WITH RECURSIVE。")
        if isinstance(node, exp.Func):
            name = (node.sql_name() or "").lower()
            if isinstance(node, exp.Anonymous):
                name = str(node.this).lower()
            if name.startswith(BANNED_FUNCS):
                raise ToolError(f"不允许调用函数 {name}。")
    cte_names = {c.alias_or_name for c in tree.find_all(exp.CTE)}
    for t in tree.find_all(exp.Table):
        if t.name in cte_names and not t.db:
            continue
        if t.db or t.catalog:
            raise ToolError(f"表名不要带 schema 前缀:{t.sql()}。可用表:{', '.join(sorted(ALLOWED))}")
        if t.name not in ALLOWED:
            raise ToolError(f"不能查询表 {t.name}。可用表:{', '.join(sorted(ALLOWED))}")
    return tree.sql(dialect="postgres")


def run_customer_sql(conn, sql: str, customer_id: str, max_rows: int = 50) -> dict:
    safe = validate_sql(sql)
    scoped = (
        "WITH invoices AS (SELECT * FROM biz.invoices WHERE customer_id = %(cid)s), "
        "subscriptions AS (SELECT * FROM biz.subscriptions WHERE customer_id = %(cid)s), "
        "tickets AS (SELECT id, subject, category, status, created_at, resolved_at, resolution_summary "
        "FROM biz.tickets WHERE customer_id = %(cid)s) "
        # 模型的 SQL 里可能有 LIKE '%xx%',psycopg 会把 % 当占位符,所以先转义
        f"SELECT * FROM ({safe.replace('%', '%%')}) AS q LIMIT {int(max_rows) + 1}"
    )
    with conn.transaction():
        conn.execute("SET TRANSACTION READ ONLY")
        conn.execute("SET LOCAL statement_timeout = '2s'")
        try:
            rows = conn.execute(scoped, {"cid": customer_id}).fetchall()
        except Exception as e:  # noqa: BLE001  数据库报错原样告诉模型,让它改 SQL
            raise ToolError(f"SQL 执行出错:{str(e).splitlines()[0][:200]}") from e
    truncated = len(rows) > max_rows
    return {"rows": [_jsonable(r) for r in rows[:max_rows]], "row_count": min(len(rows), max_rows),
            "truncated": truncated, "sql": safe}



if __name__ == "__main__":  # 手动试校验器:uv run python -m supportpilot.tools.sql_tool "SELECT ..."
    import sys

    try:
        print("通过:", validate_sql(sys.argv[1]))
    except ToolError as e:
        print("拒绝:", e)
```

<div class="line-notes">

- `import sqlglot` SQL 解析器,能把 SQL 字符串变成语法树,也能把树再转回 SQL。
- `from sqlglot import exp` `exp` 模块里是各种语法树节点的类型:`exp.Select`、`exp.Delete`、`exp.Table`、`exp.Func`……
- `from .business import ToolError, _jsonable` 复用业务层的错误类型和转换函数,`registry.call_tool` 能用同一个 except 接住。
- `ALLOWED = {"invoices", "subscriptions", "tickets"}` 表名白名单,用集合是因为只做 `in` 判断。
- `BANNED_FUNCS = ("pg_", "dblink", "lo_", "current_setting", "set_config", "query_to_xml")` 写成元组是为了下面直接传给 `str.startswith`,它接受元组,任意一个前缀匹配就返回 True。`pg_` 一条就挡住了 `pg_sleep`、`pg_read_file` 这一大类。
- `SCHEMA_DOC = """可查询的表` 给模型看的表结构说明,注册工具时拼进描述里。故意写「不需要再按 customer_id 过滤」,下面的 CTE 会保证这一点。
- `sql = sql.strip().rstrip(";")` 去掉首尾空白和末尾分号。实测 `"SELECT sum(amount_cny) FROM invoices WHERE status = 'paid';"` 校验通过,返回 `SELECT SUM(amount_cny) FROM invoices WHERE status = 'paid'`,分号没了、函数名被 sqlglot 规范成大写。
- `statements = sqlglot.parse(sql, dialect="postgres")` `parse` 返回语句列表(`parse_one` 只要一条)。实测 `"SELECT 1; DROP TABLE invoices"` 解析成 `[Select, Drop]` 两个节点。
- `raise ToolError(f"SQL 语法错误:{str(e)[:200]}。请修正后重试。") from e` `from e` 保留原始异常链,调试时能看到 sqlglot 的原始报错。实测 `"SELEC 1"` 得到 `SQL 语法错误:Invalid expression / Unexpected token. Line 1, Col: 7. ...`(sqlglot 的报错里带终端下划线控制符,截到 200 字符)。
- `if len(statements) != 1 or statements[0] is None:` 多条语句一律拒绝,`;` 拼接注入在这一步就挡住了。实测 `"SELECT * FROM invoices; DELETE FROM invoices"` 得到 `只能提交一条 SQL 语句。`。空字符串解析出来是 `[None]`,也在这里挡掉。
- `if not isinstance(tree, exp.Query):  # Select / Union 等都是 Query 的子类` 根节点必须是查询。实测 `sqlglot.parse_one("DELETE FROM invoices")` 的类型是 `Delete`,不是 Query;`SELECT 1 UNION SELECT 2` 是 Query。
- `for node in tree.walk():` `walk()` 遍历语法树里的每一个节点,包括子查询、CTE 里面的东西。只检查根节点不够,写操作可能藏在 CTE 里。
- `exp.Command, exp.Into)):` `exp.Into` 对应 `SELECT ... INTO 新表`,它根节点是 Select 但会建表。实测 `SELECT * INTO t2 FROM invoices` 被拦,报 `只允许只读查询,不能包含写操作或 SELECT INTO。`
- `if isinstance(node, exp.With) and node.args.get("recursive"):` 递归 CTE 可以写出无限循环。实测 `WITH RECURSIVE r AS (SELECT 1 n UNION ALL SELECT n+1 FROM r) SELECT * FROM r` 被拦。
- `name = (node.sql_name() or "").lower()` sqlglot 认识的函数(SUM、COUNT)会被解析成专门的节点类,`sql_name()` 返回 `"SUM"`。
- `if isinstance(node, exp.Anonymous):` 不认识的函数统一解析成 `Anonymous`,这时 `sql_name()` 返回的是 `'ANONYMOUS'`,真名在 `node.this` 里。实测 `pg_sleep(10)` 就是 Anonymous,`this` 是 `pg_sleep`。少了这两行,`pg_sleep` 会被当成名叫 anonymous 的函数放过去。
- `if name.startswith(BANNED_FUNCS):` 实测 `SELECT pg_sleep(10)` 得到 `不允许调用函数 pg_sleep。`,`SELECT current_setting('x')` 得到 `不允许调用函数 current_setting。`
- `cte_names = {c.alias_or_name for c in tree.find_all(exp.CTE)}` 模型自己写的 CTE 名字(比如 `WITH x AS (...)`)也算合法表名。实测 `WITH x AS (SELECT * FROM invoices) SELECT * FROM x` 通过。
- `if t.name in cte_names and not t.db:` 引用自己定义的 CTE,跳过白名单检查。
- `if t.db or t.catalog:` `t.db` 是 schema 部分。实测 `biz.customers` 的 db 是 `biz`,被拦:`表名不要带 schema 前缀:biz.customers。`;`pg_catalog.pg_tables` 也一样。藏在 JOIN 里也躲不过:`SELECT * FROM invoices i JOIN biz.customers c ON true` 报的是 `biz.customers AS c`。
- `if t.name not in ALLOWED:` 实测 `SELECT * FROM customers` 得到 `不能查询表 customers。可用表:invoices, subscriptions, tickets`。
- `return tree.sql(dialect="postgres")` 返回规范化后的 SQL,后面执行的是这一份而不是模型原文。
- `safe = validate_sql(sql)` 先过第一道闸,不合法直接抛 ToolError。
- `"WITH invoices AS (SELECT * FROM biz.invoices WHERE customer_id = %(cid)s), "` 第二道闸:定义一个和真表同名的 CTE。`%(cid)s` 是 psycopg 的命名占位符,值从后面的字典 `{"cid": customer_id}` 里取,三处用同一个值。
- `"tickets AS (SELECT id, subject, category, status, created_at, resolved_at, resolution_summary "` 工单只暴露这几列,`customer_email` 和 `body` 不给。
- `f"SELECT * FROM ({safe.replace('%', '%%')}) AS q LIMIT {int(max_rows) + 1}"` psycopg 把 `%` 当占位符开头,模型 SQL 里的 `LIKE '%2609%'` 要变成 `'%%2609%%'` 才能原样传到数据库。实测 `SELECT id FROM invoices WHERE id LIKE '%2609%'` 对 C0004 返回 `INV-202609-0003`、`INV-202609-0004` 两行。`int(max_rows) + 1` 多取一行用来判断是否被截断。
- `conn.execute("SET TRANSACTION READ ONLY")` 第三道闸:这个事务里任何写操作都会被数据库拒绝,哪怕前两道闸漏了。必须是事务里的第一条语句。
- `conn.execute("SET LOCAL statement_timeout = '2s'")` `SET LOCAL` 只在当前事务内生效,事务结束自动恢复,不会影响这条连接后面别的查询。
- `rows = conn.execute(scoped, {"cid": customer_id}).fetchall()` 实测对 C0004 跑 `SELECT count(DISTINCT subscription_id) AS n, sum(amount_cny) AS s FROM invoices`,得到 `[{'n': 1, 's': 195.0}]`;不写任何 WHERE 的 `SELECT count(*) AS n FROM invoices` 得到 5,而真表里一共有 459 张账单。CTE 遮蔽生效了。
- `raise ToolError(f"SQL 执行出错:{str(e).splitlines()[0][:200]}") from e` 数据库报错只取第一行。实测 `SELECT nope FROM invoices` 得到 `SQL 执行出错:column "nope" does not exist`,模型看了能自己改列名。
- `truncated = len(rows) > max_rows` 多取的那一行在不在。实测 `max_rows=3` 查 C0004 的 5 张账单,`row_count=3`、`truncated=True`。
- `"truncated": truncated, "sql": safe}` 把实际执行的(规范化后的)SQL 也返回,模型和人排查时都能看到到底跑了什么。
- `if __name__ == "__main__":  # 手动试校验器` 直接运行这个模块时只做校验,不连数据库。
- `print("通过:", validate_sql(sys.argv[1]))` `sys.argv[1]` 是命令行第一个参数,也就是引号里那条 SQL。

</div>

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="text-to-SQL 三道闸">
<g font-family="var(--font-mono)" font-size="11">
<rect x="10" y="70" width="100" height="56" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="60" y="94" text-anchor="middle" fill="var(--ink)">模型写的</text>
<text x="60" y="112" text-anchor="middle" fill="var(--ink)">SQL</text>
<rect x="140" y="60" width="140" height="76" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="210" y="82" text-anchor="middle" fill="var(--ink)">闸 1:sqlglot 解析</text>
<text x="210" y="100" text-anchor="middle" fill="var(--ink-soft)">只许一条 SELECT</text>
<text x="210" y="116" text-anchor="middle" fill="var(--ink-soft)">表名白名单 · 禁函数</text>
<rect x="300" y="60" width="150" height="76" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="375" y="82" text-anchor="middle" fill="var(--ink)">闸 2:同名 CTE 包裹</text>
<text x="375" y="100" text-anchor="middle" fill="var(--ink-soft)">invoices 只含</text>
<text x="375" y="116" text-anchor="middle" fill="var(--ink-soft)">当前客户的行</text>
<rect x="470" y="60" width="160" height="76" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="550" y="82" text-anchor="middle" fill="var(--ink)">闸 3:只读事务</text>
<text x="550" y="100" text-anchor="middle" fill="var(--ink-soft)">超时 2 秒</text>
<text x="550" y="116" text-anchor="middle" fill="var(--ink-soft)">最多 50 行</text>
<text x="210" y="170" text-anchor="middle" fill="var(--ink-faint)">DELETE / biz.customers → 拒绝</text>
<text x="375" y="170" text-anchor="middle" fill="var(--ink-faint)">忘写 WHERE 也查不到别人</text>
<text x="550" y="170" text-anchor="middle" fill="var(--ink-faint)">慢查询被掐断</text>
</g>
<g stroke="var(--ink-faint)" stroke-width="1.3">
<line x1="110" y1="98" x2="138" y2="98"/><line x1="280" y1="98" x2="298" y2="98"/><line x1="450" y1="98" x2="468" y2="98"/>
</g>
</svg>
<figcaption>三道闸各管一类风险,哪一道都不靠"请只写 SELECT"这种提示词。生产环境再加第四道:用只有 SELECT 权限的数据库账号执行。</figcaption>
</figure>

**第一道闸:解析而不是正则。** 用正则检查"有没有 DELETE"很容易被绕过:大小写、注释、字符串拼接、`SELECT ... INTO` 都能绕。sqlglot 把 SQL 解析成语法树,我们在树上检查节点类型:根节点必须是查询,树里不能有任何写操作节点,不能有 `WITH RECURSIVE`(可能无限递归),函数名不能以 `pg_`、`dblink` 等开头,表名必须是白名单里的裸名字。

我用 14 条语句测过这个校验器,下面是实际运行的结果(为了排版,我把输出格式和报错信息整理缩短了):

```text
通过  SELECT SUM(amount_cny) FROM invoices WHERE status = 'paid' AND issued_at >= '2026-01-01'
通过  SELECT DATE_TRUNC('MONTH', issued_at) AS m, COUNT(*) FROM invoices GROUP BY 1 ORDER BY 1
通过  WITH x AS (SELECT * FROM invoices) SELECT * FROM x
通过  SELECT * FROM invoices AS i JOIN subscriptions AS s ON s.id = i.subscription_id
通过  SELECT (SELECT COUNT(*) FROM tickets) AS n
拒绝  SELECT * FROM biz.customers           → 表名不要带 schema 前缀
拒绝  SELECT * FROM customers               → 不能查询表 customers
拒绝  DELETE FROM invoices                  → 只允许 SELECT 查询
拒绝  SELECT 1; DROP TABLE invoices         → 只能提交一条 SQL 语句
拒绝  SELECT pg_sleep(10)                   → 不允许调用函数 pg_sleep
拒绝  SELECT * INTO t2 FROM invoices        → 只允许只读查询,不能包含写操作或 SELECT INTO
拒绝  WITH RECURSIVE r AS (...) SELECT ...  → 不允许 WITH RECURSIVE
拒绝  SELECT current_setting('x')           → 不允许调用函数 current_setting
拒绝  SELECT * FROM pg_catalog.pg_tables    → 表名不要带 schema 前缀
```

**第二道闸:行级隔离靠 CTE 遮蔽。** 这是我觉得最巧的一处。模型只能写裸表名 `invoices`,执行时我们在外面套一层:

```sql
WITH invoices AS (SELECT * FROM biz.invoices WHERE customer_id = 'C0002'),
     subscriptions AS (...), tickets AS (...)
SELECT * FROM (模型写的 SQL) AS q LIMIT 51
```

Postgres 解析模型的 SQL 时,`invoices` 指向的是我们定义的 CTE,而不是真表。模型就算完全忘了写 `WHERE customer_id = ...`,也只能看到当前客户的数据。`customer_id` 由系统注入,模型改不了。行级隔离不能指望模型"记得加过滤条件",要让它想忘都没用。

工单表的 CTE 只暴露了部分列,`customer_email` 和 `body` 这种可能含敏感信息的列不给。

**第三道闸:数据库兜底。** `SET TRANSACTION READ ONLY` 让这个事务里任何写操作都会被数据库拒绝;`statement_timeout = 2s` 掐断慢查询;外层 `LIMIT 51` 防止一次返回几万行(多取一行用来判断是否被截断)。

生产环境应该还有第四道:专门建一个只有 SELECT 权限、只能访问一个只读视图的数据库账号,text-to-SQL 用这个账号连接。前三道是代码保证,第四道是权限系统保证,两者独立,一个出 bug 另一个还在。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1RNTtzMENj&autoplay=0&high_quality=1" title="从零编写MCP并发布上线,超简单!手把手教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>技术爬爬虾 · 从零编写 MCP 并发布上线,超简单!手把手教程 · 16 分钟,下一节写 MCP server 前看,注意视频里用的是 SDK 1.x 的 FastMCP,2.x 改名成了 MCPServer,写法几乎一样。</figcaption>
</figure>

## 包成 MCP server

```python
# supportpilot/src/supportpilot/tools/mcp_server.py
"""同一套业务工具的 MCP 出口:给 Claude Desktop / Cursor / Claude Code 或别的团队的 Agent 用。
SupportPilot 自己的工作流在进程内直接调 registry,不绕 MCP(省一跳、好测试),两边共用 business.py。

stdio 运行: uv run python -m supportpilot.tools.mcp_server
HTTP 运行:  uv run python -m supportpilot.tools.mcp_server --http      # 默认 http://127.0.0.1:8000/mcp
可视化调试: npx @modelcontextprotocol/inspector uv run python -m supportpilot.tools.mcp_server
"""

import json
import sys

from mcp.server import MCPServer

from supportpilot.db import connect
from supportpilot.tools import business as biz
from supportpilot.tools.sql_tool import SCHEMA_DOC, run_customer_sql

mcp = MCPServer("cloudledger-support", instructions="CloudLedger 客服后台工具。只读工具随便用;"
                "create_refund_request 只会创建待审批申请,不会直接退款。")
_conn = None


def conn():
    global _conn
    if _conn is None or _conn.closed:
        _conn = connect()
    return _conn


def _call(fn, *args) -> str:
    try:
        return json.dumps(fn(conn(), *args), ensure_ascii=False, default=str)
    except biz.ToolError as e:
        # 业务错误当普通结果返回给模型,让它自己纠正;真正的异常让 SDK 标成 is_error
        return f"ERROR: {e}"


@mcp.tool()
def get_customer(email: str) -> str:
    """按邮箱查客户档案(客户 ID、姓名、公司、是否 VIP)。"""
    return _call(biz.get_customer, email)


@mcp.tool()
def list_subscriptions(customer_id: str) -> str:
    """查客户的订阅:套餐、月付/年付、状态、到期日、是否自动续费。customer_id 形如 C0001。"""
    return _call(biz.list_subscriptions, customer_id)


@mcp.tool()
def list_invoices(customer_id: str, status: str | None = None, limit: int = 6) -> str:
    """查客户账单,按开票日期倒序。status 可选 paid/open/failed/refunded/void。"""
    return _call(biz.list_invoices, customer_id, status, limit)


@mcp.tool()
def check_refund_eligibility(invoice_id: str) -> str:
    """按退款政策判断账单能否退、退多少、依据哪条规则。"""
    return _call(biz.check_refund_eligibility, invoice_id)


@mcp.tool(description="用只读 SQL 查某个客户的账单/订阅/工单做统计。\n" + SCHEMA_DOC)
def query_customer_data(customer_id: str, sql: str) -> str:
    return _call(run_customer_sql, sql, customer_id)


@mcp.tool()
def create_refund_request(invoice_id: str, reason: str, ticket_id: str) -> str:
    """为符合条件的账单创建待审批退款申请。不会直接退款。"""
    return _call(biz.create_refund_request, invoice_id, reason, ticket_id)


if __name__ == "__main__":
    if "--http" in sys.argv:
        mcp.run(transport="streamable-http")
    else:
        mcp.run()
```

<div class="line-notes">

- `"""同一套业务工具的 MCP 出口` docstring 里写了三种运行方式,其中 `npx @modelcontextprotocol/inspector` 要本机有 Node。
- `from mcp.server import MCPServer` SDK 2.x 的写法,1.x 是 `from mcp.server.fastmcp import FastMCP`。
- `mcp = MCPServer("cloudledger-support", instructions=` `instructions` 在握手时发给客户端,很多客户端会放进系统提示词。
- `_conn = None` 模块级的全局连接,第一次用到时才建。
- `def conn():` 懒加载连接。`global _conn` 声明要改的是模块级变量,不写的话赋值会创建一个同名局部变量。
- `if _conn is None or _conn.closed:` 第一次调用或者连接断了,就新建一条。stdio 模式下一个 server 进程只服务一个客户端,一条连接够用。
- `def _call(fn, *args) -> str:` `*args` 收集剩下的位置参数,原样转给业务函数,所以下面每个工具都只要一行。
- `return f"ERROR: {e}"` 业务错误当成普通文本返回,不让 SDK 标成 `isError`。实测用内存客户端调 `check_refund_eligibility("INV-2026-001")`,拿到的文本是 `ERROR: 账单 INV-2026-001 不存在。...`,`is_error` 为 False。
- `@mcp.tool()` 函数名就是工具名,docstring 就是描述,参数的类型标注生成 inputSchema。
- `def list_invoices(customer_id: str, status: str | None = None, limit: int = 6) -> str:` 实测内存客户端调 `{"customer_id": "C0004", "limit": 2}`,返回的文本开头是 `{"total": 5, "returned": 2, "invoices": [{"id": "INV-202609-0004", ...`。
- `@mcp.tool(description="用只读 SQL 查某个客户的账单/订阅/工单做统计。\n" + SCHEMA_DOC)` 描述要拼接字符串,docstring 写不了表达式,所以改用 `description=` 参数。
- `def query_customer_data(customer_id: str, sql: str) -> str:` MCP 版要调用方自己传 customer_id,权限边界在「谁能连上这个 server」。
- `def create_refund_request(invoice_id: str, reason: str, ticket_id: str) -> str:` 实测 `list_tools()` 列出 6 个工具:`get_customer, list_subscriptions, list_invoices, check_refund_eligibility, query_customer_data, create_refund_request`。没有 `search_past_tickets`、`escalate_to_human`、`decide_refund`。
- `if "--http" in sys.argv:` 命令行带 `--http` 就用 Streamable HTTP 传输,默认地址是 `http://127.0.0.1:8000/mcp`。
- `mcp.run()` 不带参数是 stdio,Claude Desktop 和 Claude Code 按 stdio 拉起子进程。

</div>

注意第一行 import:MCP Python SDK 2.x 把 1.x 的 `from mcp.server.fastmcp import FastMCP` 改成了 `from mcp.server import MCPServer`,老写法在 2.x 下直接 `ModuleNotFoundError`。网上大部分教程和视频还是 1.x 的写法,照抄会报错。我们在 Day 44 锁定了 `mcp>=2.0`。

MCP 版本的工具没有暴露 `escalate_to_human` 和 `decide_refund`,和给模型的注册表保持一致。`query_customer_data` 在 MCP 版里需要调用方传 `customer_id`,因为 MCP 的使用者是内部员工或别的系统,不是面对某一个客户的工单流程,权限边界在"谁能连上这个 MCP server",Day 53 部署时会加鉴权。

为什么 SupportPilot 自己的工作流不走 MCP 调这些工具?Day 43 讲过:进程内调用少一跳网络、单测好写、错误好追。MCP 是给外部用的出口。面试被问"你的项目用了 MCP 吗",你可以说用了,并且能讲清楚用在了哪、为什么内部没用,这比"所有东西都走 MCP"显得更懂。

### 接到 Claude Desktop 和 Claude Code

先用 MCP Inspector 看一眼(需要本机有 Node.js):

```bash
npx @modelcontextprotocol/inspector uv run python -m supportpilot.tools.mcp_server
```

浏览器会打开一个页面,左边列出 6 个工具,点 `list_invoices` 填 `C0004`,应该能看到刘洋 9 月的两张同周期账单。

Claude Desktop:编辑配置文件(macOS 在 `~/Library/Application Support/Claude/claude_desktop_config.json`,Windows 在 `%APPDATA%\Claude\claude_desktop_config.json`),加上:

```json
{
  "mcpServers": {
    "cloudledger": {
      "command": "uv",
      "args": ["--directory", "/你的绝对路径/supportpilot", "run", "python", "-m", "supportpilot.tools.mcp_server"]
    }
  }
}
```

重启 Claude Desktop,问它"帮我查一下 liuyang@example.com 九月的账单,看看是不是重复扣款了"。正常情况下它会依次调 `get_customer`、`list_invoices`、`check_refund_eligibility`,告诉你 9 月 12 日有两笔 39 元,属于重复扣款,可以全额退一笔。`command` 如果报找不到 uv,把 `uv` 换成 `which uv` 输出的绝对路径。

Claude Code:

```bash
claude mcp add cloudledger -- uv --directory /你的绝对路径/supportpilot run python -m supportpilot.tools.mcp_server
```

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV19pEKziEUY&autoplay=0&high_quality=1" title="Python SDK开发Streamable HTTP MCP Server,抓包详解工作机制" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>五里墩茶社 · Python SDK 开发 Streamable HTTP MCP Server,抓包详解工作机制 · 11 分钟,想知道 `--http` 模式下网络上到底传了什么,看他抓包那段。</figcaption>
</figure>

## 退款审批的完整时序

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="退款审批时序">
<g font-family="var(--font-mono)" font-size="11">
<text x="70" y="24" text-anchor="middle" fill="var(--mem)">Agent(act)</text>
<text x="230" y="24" text-anchor="middle" fill="var(--compute)">工具层</text>
<text x="390" y="24" text-anchor="middle" fill="var(--compute)">财务群</text>
<text x="550" y="24" text-anchor="middle" fill="var(--ink)">财务(工作台)</text>
</g>
<g stroke="var(--rule)" stroke-dasharray="3 3"><line x1="70" y1="32" x2="70" y2="290"/><line x1="230" y1="32" x2="230" y2="290"/><line x1="390" y1="32" x2="390" y2="290"/><line x1="550" y1="32" x2="550" y2="290"/></g>
<g font-family="var(--font-mono)" font-size="10.5" fill="var(--ink-soft)">
<line x1="70" y1="55" x2="226" y2="55" stroke="var(--ink-faint)"/><text x="150" y="50" text-anchor="middle">check_refund_eligibility</text>
<line x1="230" y1="75" x2="74" y2="75" stroke="var(--ink-faint)" stroke-dasharray="4 2"/><text x="150" y="70" text-anchor="middle">eligible · 950 · rule</text>
<line x1="70" y1="105" x2="226" y2="105" stroke="var(--ink-faint)"/><text x="150" y="100" text-anchor="middle">create_refund_request</text>
<text x="230" y="125" text-anchor="middle">重算金额 · 写 pending</text>
<line x1="230" y1="145" x2="386" y2="145" stroke="var(--ink-faint)"/><text x="310" y="140" text-anchor="middle">webhook 通知</text>
<line x1="230" y1="165" x2="74" y2="165" stroke="var(--ink-faint)" stroke-dasharray="4 2"/><text x="150" y="160" text-anchor="middle">pending,不要说已退</text>
<line x1="390" y1="190" x2="546" y2="190" stroke="var(--ink-faint)"/><text x="470" y="185" text-anchor="middle">点链接打开工作台</text>
<line x1="550" y1="225" x2="234" y2="225" stroke="var(--ink-faint)"/><text x="390" y="220" text-anchor="middle">decide_refund(通过)· 行锁</text>
<text x="230" y="250" text-anchor="middle">executed · 账单标 refunded</text>
<text x="230" y="275" text-anchor="middle">写 audit_log</text>
</g>
</svg>
<figcaption>Agent 只走到"写 pending"为止。真正动钱的那一步只有人能触发,而且有行锁防重复点击。Day 47 的工作流会在 pending 之后停下来等审批,审批结果再补发给客户。</figcaption>
</figure>

## 动手练习

**步骤 1:把今天的文件放进仓库。** `tools/` 下五个文件:`business.py`、`registry.py`、`sql_tool.py`、`notify.py`、`mcp_server.py`,`config.py` 和 `.env.example` 加上通知配置。

**步骤 2:写测试。**

```python
# supportpilot/tests/test_tools.py
import json

import anyio
import pytest
from mcp import Client

from supportpilot.tools import business as biz
from supportpilot.tools.mcp_server import mcp
from supportpilot.tools.registry import TOOLS, Level, call_tool, openai_tools


def test_dangerous_tools_are_not_exposed():
    names = {t["function"]["name"] for t in openai_tools()}
    assert "decide_refund" not in names and "escalate_to_human" not in names
    assert TOOLS["create_refund_request"].level is Level.PROPOSE
    assert {t["function"]["name"] for t in openai_tools({Level.READ})} == names - {"create_refund_request"}


def test_bad_arguments_become_messages_not_exceptions():
    text, err = call_tool(None, "list_invoices", '{"limit": "many"}', ticket_id="T1")
    assert err and "参数不合法" in text
    text, err = call_tool(None, "refund_everything", "{}", ticket_id="T1")
    assert err and "可用工具" in text


def test_mcp_server_lists_tools_in_memory():
    async def go():
        async with Client(mcp) as c:
            return [t.name for t in (await c.list_tools()).tools]
    assert "check_refund_eligibility" in anyio.run(go)


# ---------- 下面这些要真数据库:docker compose up -d db && make data ----------

@pytest.fixture
def conn():
    from supportpilot.db import connect
    c = connect()
    c.execute("DELETE FROM biz.refund_requests")
    yield c
    c.execute("DELETE FROM biz.refund_requests")
    c.close()


def _first_invoice(conn, cid):
    return conn.execute("SELECT id FROM biz.invoices WHERE customer_id = %s ORDER BY issued_at DESC, id DESC LIMIT 1",
                        (cid,)).fetchone()["id"]


@pytest.mark.db
@pytest.mark.parametrize("cid,rule,amount", [
    ("C0002", "annual_first_14_days", 950.0),
    ("C0003", "annual_prorated", 498.75),
    ("C0005", "monthly_no_refund", 0.0),
    ("C0007", "annual_renewal_7_days", 374.0),
    ("C0008", "enterprise_contract", 0.0),
    ("C0011", "annual_first_14_days", 374.0),
    ("C0012", "annual_prorated", 308.55),
])
def test_refund_rules(conn, cid, rule, amount):
    r = biz.check_refund_eligibility(conn, _first_invoice(conn, cid))
    assert (r["rule"], r["refund_amount_cny"]) == (rule, amount)


@pytest.mark.db
def test_refund_request_is_idempotent_and_needs_human(conn):
    inv = _first_invoice(conn, "C0002")
    a = biz.create_refund_request(conn, inv, "测试", "T000001")
    assert a["status"] == "pending"
    with pytest.raises(biz.ToolError, match="已有退款申请"):   # 同一张账单不能申请第二次
        biz.create_refund_request(conn, inv, "再来一次", "T000002")
    done = biz.decide_refund(conn, a["id"], True, "amy")
    assert done["status"] == "executed"
    assert biz.decide_refund(conn, a["id"], False, "bob")["status"] == "executed"  # 重复点击不改结果
    conn.execute("UPDATE biz.invoices SET status = 'paid' WHERE id = %s", (inv,))


@pytest.mark.db
def test_tool_output_is_json_for_model(conn):
    text, err = call_tool(conn, "list_invoices", json.dumps({"customer_id": "C0004", "limit": 2}), ticket_id="T1")
    data = json.loads(text)
    assert not err and data["returned"] == 2 and data["total"] >= 4


def test_sql_validator_blocks_escape_hatches():
    from supportpilot.tools.sql_tool import validate_sql
    assert validate_sql("select sum(amount_cny) from invoices where status = 'paid'")
    for bad in ["SELECT * FROM biz.customers", "SELECT * FROM customers", "DELETE FROM invoices",
                "SELECT 1; DROP TABLE invoices", "SELECT pg_sleep(10)", "SELECT * INTO t2 FROM invoices"]:
        with pytest.raises(biz.ToolError):
            validate_sql(bad)


@pytest.mark.db
def test_sql_tool_only_sees_current_customer(conn):
    from supportpilot.tools.sql_tool import run_customer_sql
    r = run_customer_sql(conn, "SELECT count(DISTINCT subscription_id) AS n FROM invoices", "C0002")
    assert r["rows"] == [{"n": 1}]          # 没写 WHERE,也只看得到 C0002 自己的
```

<div class="line-notes">

- `import anyio` 运行异步代码的库。MCP 客户端是异步的,同步测试函数里用 `anyio.run(go)` 跑它。
- `from mcp import Client` SDK 2.x 的内存客户端,可以直接连一个 server 对象,不用起子进程。
- `def test_dangerous_tools_are_not_exposed():` 不连库、不花钱,`make test` 就会跑。
- `names = {t["function"]["name"] for t in openai_tools()}` 集合推导式,实测得到 7 个名字。
- `assert {t["function"]["name"] for t in openai_tools({Level.READ})} == names - {"create_refund_request"}` 集合相减:只给只读级时,正好少一个 `create_refund_request`。
- `text, err = call_tool(None, "list_invoices", '{"limit": "many"}', ticket_id="T1")` 连接传 `None` 也没关系,参数校验在执行之前就失败了,根本用不到连接。
- `def test_mcp_server_lists_tools_in_memory():` 用内存客户端连 server,验证 MCP 出口能列出工具。
- `async with Client(mcp) as c:` 异步上下文管理器,进入时完成握手,退出时关闭会话。
- `@pytest.fixture` fixture 是测试的前置准备,测试函数参数里写 `conn` 就会拿到这里 yield 出来的连接。
- `c.execute("DELETE FROM biz.refund_requests")` 前后各清一次退款申请,保证每个测试从干净状态开始、也不给下一个留垃圾。
- `def _first_invoice(conn, cid):` 取客户最新的一张账单。C0004 有两张同一天的,按 `id DESC` 拿到的是 INV-202609-0004。
- `@pytest.mark.db` 打上 db 标记,`make test` 用 `-m "not db and not llm"` 跳过它们,`pytest -m db` 才跑。
- `@pytest.mark.parametrize("cid,rule,amount", [` 参数化:同一个测试函数用 7 组数据各跑一次,报告里显示成 7 个测试。
- `("C0012", "annual_prorated", 308.55),` 7 组期望值和实测完全一致:李娜 950、王芳 498.75、陈静月付 0、赵敏 374、黄强企业版 0、徐丽 374、孙浩 308.55。
- `assert (r["rule"], r["refund_amount_cny"]) == (rule, amount)` 两个值打包成元组一起比,失败时 pytest 会把两边的元组都打出来。
- `with pytest.raises(biz.ToolError, match="已有退款申请"):` 期望块里抛出 ToolError,并且信息里能搜到这几个字。实测第二次申请的报错是 `这张账单不符合退款条件:这张账单已有退款申请 RF-T000001-INV-202609-0002(状态 pending),不要重复申请。…`。
- `assert biz.decide_refund(conn, a["id"], False, "bob")["status"] == "executed"  # 重复点击不改结果` amy 批了之后 bob 再点驳回,状态不变。
- `conn.execute("UPDATE biz.invoices SET status = 'paid' WHERE id = %s", (inv,))` 批准会把账单改成 refunded,这里改回去,不然 `test_refund_rules` 里李娜那条会变成 `not_paid`。
- `assert not err and data["returned"] == 2 and data["total"] >= 4` 实测 C0004 total 是 5,returned 是 2。
- `for bad in ["SELECT * FROM biz.customers", "SELECT * FROM customers", "DELETE FROM invoices",` 六条危险语句各自应该抛 ToolError,每条的实测报错见上面 `sql_tool.py` 的注释。
- `r = run_customer_sql(conn, "SELECT count(DISTINCT subscription_id) AS n FROM invoices", "C0002")` 没写 WHERE,全表有 200 个订阅,但 CTE 让它只看得到李娜自己的。
- `assert r["rows"] == [{"n": 1}]          # 没写 WHERE,也只看得到 C0002 自己的` 我在本机临时库里跑这个文件,14 个测试全部通过(含 db 标记的)。

</div>

前四个测试不需要数据库,`make test` 就会跑。标了 `@pytest.mark.db` 的需要数据库:

```bash
make up && make data
uv run pytest -m db -q
```

`test_refund_rules` 用参数化一次测 7 个剧情客户:李娜全额 950、王芳 498.75、陈静月付不退、赵敏续费全额 374、黄强企业版不适用、徐丽第 14 天全额 374、孙浩第 15 天 308.55。这 7 条全过,说明退款规则的代码和 Day 43 访谈里拆出来的规则是一致的。哪条不过,先别急着改代码,对一下 Day 44 的剧情客户表,搞清楚是代码错了还是数据错了。

**步骤 3:试 text-to-SQL 校验器。**

```bash
uv run python -m supportpilot.tools.sql_tool "SELECT sum(amount_cny) FROM invoices WHERE status = 'paid'"
uv run python -m supportpilot.tools.sql_tool "SELECT * FROM biz.customers"
uv run python -m supportpilot.tools.sql_tool "SELECT * FROM invoices; DELETE FROM invoices"
```

然后自己想办法绕过它。试试大小写混写、加注释 `/* */`、用 `UNION` 拼接别的表、用子查询访问 `biz.customers`。每找到一种绕过,先写一个失败的测试,再修校验器。找不到绕过也把你试过的写进测试,它们就是这个工具的安全回归集。

**步骤 4:配一个群机器人(选做,15 分钟)。** 在飞书(或钉钉、企业微信)建一个只有你自己的群,添加自定义机器人,安全设置选"自定义关键词"填"退款",把 webhook 地址填进 `.env`。然后:

```python
from supportpilot.db import connect
from supportpilot.tools.registry import call_tool
conn = connect()
inv = conn.execute("SELECT id FROM biz.invoices WHERE customer_id='C0002'").fetchone()["id"]
print(call_tool(conn, "create_refund_request", {"invoice_id": inv, "reason": "测试"}, ticket_id="T000001"))
conn.execute("DELETE FROM biz.refund_requests")   # 测完清掉
```

<div class="line-notes">

- `from supportpilot.db import connect` 在 `uv run python` 的交互环境里一行行敲。
- `inv = conn.execute("SELECT id FROM biz.invoices WHERE customer_id='C0002'").fetchone()["id"]` 李娜只有一张账单,实测是 `INV-202609-0002`。
- `print(call_tool(conn, "create_refund_request", {"invoice_id": inv, "reason": "测试"}, ticket_id="T000001"))` 没配 webhook 时,先打印 `[notify:dry-run]` 加整条审批消息,再打印 `('{"id": "RF-T000001-INV-202609-0002", ... "status": "pending", ...}', False)`。
- `conn.execute("DELETE FROM biz.refund_requests")   # 测完清掉` 不清的话,下次再跑这几行会得到「已有退款申请」。

</div>

群里应该收到一条"【退款待审批】"消息。没配 webhook 的话,终端会打印 `[notify:dry-run]` 加消息内容。

**步骤 5:接 Claude Desktop 或 Claude Code。** 按上面的配置接好,用自然语言问刘洋的重复扣款,截一张图留着,Day 54 写 README 用得上。

**验收标准:** `make test` 全绿;`pytest -m db` 里 7 条退款规则全部通过;text-to-SQL 校验器至少拦住了你自己试的 5 种绕过方式;在 Claude Desktop/Code 里能通过 MCP 查到账单。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 权限分级 | 按风险把工具分为只读、提议(需审批)、不暴露三类 |
| 幂等键 | 用业务字段拼出的唯一 ID,重复调用只产生一条记录 |
| 行锁 FOR UPDATE | 事务里锁住选中的行,防止并发修改 |
| Decimal | Python 的十进制精确小数,算钱必须用 |
| webhook | 一个可以 POST 消息的 URL,群机器人靠它收消息 |
| 交互式卡片 | 带按钮的群消息,按钮点击会回调你的服务器 |
| text-to-SQL | 模型根据自然语言问题生成 SQL 查询 |
| sqlglot | Python 写的 SQL 解析器,能把 SQL 变成语法树 |
| CTE 遮蔽 | 用同名 WITH 子句让表名指向过滤后的数据 |
| 只读事务 | `SET TRANSACTION READ ONLY`,事务内任何写操作都会失败 |
| MCP Inspector | 官方的 MCP 调试工具,浏览器里列出并调用工具 |

## 常见误区

**让模型传金额。** 只要工具签名里有 `amount` 参数,就会有客户在工单里写"给我退 9999"。金额、权限、归属这类字段由服务端计算或注入,不从模型参数里拿。

**用正则过滤危险 SQL。** `DELETE`、`delete`、`DeLeTe`、`/**/DELETE`、`SELECT ... INTO`,正则永远写不全。要解析成语法树再检查,再加数据库层面的只读和权限。

**行级隔离靠提示词。** "请只查询当前客户的数据"这种提示,模型十次里九次遵守。第十次可能就是被注入的那次。用 CTE 遮蔽或数据库的行级安全策略(RLS)从结构上保证。

**通知写在会被重放的地方。** LangGraph 节点从 interrupt 恢复时会重跑 interrupt 之前的代码,副作用放在那里就会重复执行。有副作用的操作要么放在只执行一次的地方,要么本身幂等。

**照抄 MCP 1.x 的教程。** 2.x 改了导入路径和部分 API,先看官方迁移文档,再看视频。

**工具出错抛异常。** 整个 Agent 循环会崩。工具错误是正常的观察结果,应该作为工具返回值喂回模型。

## 学习资料

### 文档与文章

- [Anthropic · Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents):今天四条规矩的大部分来源,重点看"返回有意义的上下文""优化 token 效率""工具描述的写法"几节,40 分钟。
- [MCP Python SDK 文档](https://py.sdk.modelcontextprotocol.io/):看 What's new in v2 和 Migration Guide,搞清楚 1.x 到 2.x 改了什么,30 分钟。
- [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector):调试 MCP server 的官方工具,10 分钟。
- [sqlglot 文档](https://sqlglot.com/sqlglot.html):看 AST 遍历(`walk`、`find_all`)和表达式类型,30 分钟。
- [PostgreSQL · SET TRANSACTION](https://www.postgresql.org/docs/current/sql-set-transaction.html):只读事务的语义,5 分钟。
- [飞书自定义机器人](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot)、[钉钉自定义机器人](https://open.dingtalk.com/document/robots/custom-robot-access)、[企业微信群机器人](https://developer.work.weixin.qq.com/document/path/91770):消息格式和签名校验,用哪个看哪个,15 分钟。
- [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/):看 Excessive Agency(过度授权)那一条,对应今天的权限分级,15 分钟。

### B 站视频

- 上面嵌的技术爬爬虾《从零编写 MCP 并发布上线》和五里墩茶社《Python SDK 开发 Streamable HTTP MCP Server,抓包详解工作机制》。
- 叫我星sir《MCP 入门实战|从原理到实现一个 MCP 客户端》(BV1NRQxYXEuc,87 分钟):想深入理解客户端那一侧(Day 23 自己写过 client,这个可以对照),挑客户端实现部分看。

### 其他经典视频

- Anthropic《Tips for building AI agents》(YouTube,LP5OCa20Zpg):Anthropic 几位工程师聊做 Agent 的经验,其中关于工具设计和"站在模型视角看工具"的部分和今天直接相关,下面嵌了。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LP5OCa20Zpg" title="Tips for building AI agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Anthropic · Tips for building AI agents · 圆桌形式,挑聊工具设计和失败处理的部分听。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》第 6 章 Agents 部分的"Tools"和"Agent Failure Modes":工具的分类(知识增强、能力扩展、写操作)和写操作的风险,和今天的权限分级对应,约 1 小时。

### 开源项目与代码

- [modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk):examples 目录里有完整的 server 示例。
- [tobymao/sqlglot](https://github.com/tobymao/sqlglot):除了解析,它还能做方言转换(比如 MySQL 转 Postgres),做多数据库的 text-to-SQL 时有用。
- [BIRD-bench](https://bird-bench.github.io/):text-to-SQL 的公开基准,看看真实企业数据库上模型写 SQL 的准确率有多高(远没有你想的高),理解为什么要加校验和兜底。

## 自测

**1. `create_refund_request` 为什么不接收金额参数?**

<details><summary>答案</summary>

防止模型(或被注入的模型)指定任意金额。金额由服务端调用 `check_refund_eligibility` 按规则重算。工具签名里没有 amount,客户在工单里写"退我 9999"就没有任何通道能影响实际金额。

</details>

**2. 刘洋 9 月有两张同周期的月付账单,他是月付用户,为什么还能退?在规则函数里这是怎么保证的?**

<details><summary>答案</summary>

月付不退款的规则不适用于重复扣款。`check_refund_eligibility` 的判断顺序里,重复扣款检查(同一订阅同一 `period_start` 有另一张已支付账单)排在月付检查之前,命中就返回 `duplicate_charge`、全额退那一笔。

</details>

**3. 模型写了 `SELECT sum(amount_cny) FROM invoices`,没有任何 WHERE 条件,为什么不会查出全公司的收入?**

<details><summary>答案</summary>

执行时外层用同名 CTE `WITH invoices AS (SELECT * FROM biz.invoices WHERE customer_id = %(cid)s)` 包裹,模型 SQL 里的 `invoices` 解析到这个 CTE 而不是真表,只包含当前客户的行。`customer_id` 由系统注入,模型无法修改;校验器又禁止了带 schema 前缀的表名,绕不到 `biz.invoices`。

</details>

**4. 为什么审批通知放在工具层,而不是审批节点里?**

<details><summary>答案</summary>

LangGraph 的节点从 interrupt 恢复时会从头重跑,interrupt 之前的代码会执行两次。通知如果写在审批节点的 interrupt 之前,财务点审批后群里会再收到一次"待审批"。放在工具层的 `create_refund_request` 成功之后,只在申请创建时发一次。

</details>

**5. 「面试题」你的 Agent 能执行退款吗?如果模型被提示词注入了,最坏会发生什么?**

<details><summary>答案</summary>

不能。模型能调用的写工具只有 `create_refund_request`,它只创建 pending 状态的申请,金额服务端重算,申请 ID 幂等;执行退款的 `decide_refund` 不注册给模型,只有财务在工作台点按钮才调用,还有行锁防重复。最坏情况是被注入后对一张符合条件的账单多创建一条待审批申请(同一张账单不能重复申请),会出现在财务的待审批列表里,人工驳回即可,所有操作有审计日志可查。

</details>

**6. 「面试题」你怎么做 text-to-SQL 的安全?只靠提示词说"只能写 SELECT"可以吗?**

<details><summary>答案</summary>

不可以。我用了三层,都不依赖提示词:第一层用 sqlglot 解析成语法树,只允许单条 SELECT,禁止写操作节点、递归 CTE、危险函数和非白名单表;第二层用同名 CTE 遮蔽做行级隔离,模型只能看到当前客户的数据;第三层在只读事务里执行,加语句超时和行数上限。生产环境再用只有 SELECT 权限的数据库账号执行。每找到一种绕过方式就加一个回归测试。

</details>

## 明天预告

Day 47 · 主工作流:LangGraph 编排分类、检索、执行、起草、自检。把 W1 的 LLMClient 搬进项目并加上成本账本和结构化输出重试;设计工作流状态;实现 load_customer、classify、retrieve、act、draft、check、approval、finalize、handoff 九个节点和条件路由;用假的 LLM 写单测覆盖退款审批、转人工、质检打回;最后在终端里端到端跑 10 张演示工单,遇到退款会停下来问你批不批。
