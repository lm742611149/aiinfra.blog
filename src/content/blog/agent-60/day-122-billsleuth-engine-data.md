---
title: 'Day 122 · BillSleuth(一):计费参考引擎与 12 类故障造数'
description: '把昨天手算的计费规则写成一个参考引擎:Decimal 金额、按天折算、计费锚点、优惠券和税率有效期,用单元测试一条条钉死;再写 12 个模仿真实 bug 的故障注入函数,一次生成 100 个带标准答案的争议场景,并用测试证明每个标准答案都是对的。'
pubDate: 2026-10-15
regime: none
tags: ['billing', 'decimal', 'test-data', 'fault-injection', 'agent-60']
series: 'agent-60'
day: 122
lang: 'zh'
---

## 今天要解决的问题

昨天定下的所有东西,今天开始落到代码上。Agent 要查账,得先有账;评测要打分,得先有标准答案。今天写的就是这两样:一个按规则算出「应收」的参考计费引擎,和一个用它造出 100 个争议场景的脚本。学完你应该能:

1. 说清楚金额为什么只能用 `Decimal`、为什么只在最后一步四舍五入,并写出一个拒收 float 的 `money()` 函数。
2. 实现参考引擎:给定订阅事件,按锚点日、按天折算、优惠券有效月份、税率有效期,算出每个周期应开的发票。
3. 用单元测试把每条计费规则钉死,测试里的数字和昨天手算的一致。
4. 写 12 个故障注入函数,每个模仿一种真实计费 bug,改坏一处账并返回标准答案。
5. 生成 100 个场景(80 个有错、20 个没错),并写一个测试证明:对每个场景,用引擎重算得到的差额,正好等于标准答案。

预计用时 5–6 小时,是作品二里代码量最大的一天。前置:Day 121 的仓库骨架和手算练习。

先说一句心态上的事。很多人做 Agent 项目,数据随手造几条就开始调提示词。我的经验是,**在计费这类场景里,数据和标准答案的质量决定了后面九天的上限**。标准答案本身错了,你会花一下午怀疑 Agent,最后发现是题目出错了。所以今天最后那个「数据集自检」测试,我认为比引擎本身还重要。

## 金额只走一个函数

整个项目的金额只允许通过 `money.py` 里的三个函数处理:

```python
# billsleuth/billsleuth/money.py
"""金额工具。整个项目的金额只走这里:Decimal、两位小数、四舍五入(ROUND_HALF_UP)。"""
from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")
ZERO = Decimal("0.00")


def money(x: Decimal | int | str) -> Decimal:
    """把金额规整成两位小数。故意不收 float:0.1 + 0.2 这种误差在账单里是事故。"""
    if isinstance(x, float):
        raise TypeError(f"金额不能用 float: {x!r},请传字符串或 Decimal")
    return Decimal(x).quantize(CENT, rounding=ROUND_HALF_UP)


def prorate(amount: Decimal, used_days: int, period_days: int) -> Decimal:
    """按天折算:amount × used_days / period_days,最后才四舍五入,中间不截断。"""
    if period_days <= 0:
        raise ValueError("period_days 必须大于 0")
    return money(amount * used_days / period_days)


def fmt(x: Decimal) -> str:
    """给人看的格式,统一两位小数,不带货币符号(货币单独显示)。"""
    return f"{money(x):.2f}"
```

`money()` 故意不收 float。你可能觉得这太严格,`money(0.1)` 转一下字符串不就好了?问题是 float 一旦出现,它就已经不精确了:`0.1` 在内存里是 0.1000000000000000055511151231257827……,你转成什么都是在掩盖问题。逼着调用方传字符串或 Decimal,错误就会在第一次写错的地方炸出来,而不是在三个月后的对账报表里。`money("2.675")` 得到 2.68,而 `round(2.675, 2)` 在 Python 里得到 2.67,这个对比可以拿来跟同事解释为什么要较真。

`prorate()` 的写法也有讲究:`amount * used_days / period_days` 先算完整个分数,最后只四舍五入一次。如果先算每天多少钱(117 / 30 = 3.9,还好;39 / 31 = 1.258064……就麻烦了),四舍五入成 1.26,再乘以 10 天得到 12.60,而正确答案是 39 × 10 / 31 = 12.58。差两分钱,但对账时就是一条对不上的记录。

舍入方式选 `ROUND_HALF_UP`,也就是我们小学学的四舍五入。Python 的 Decimal 默认是 `ROUND_HALF_EVEN`(银行家舍入,0.125 舍成 0.12),有些财务系统用它,有些不用。哪种都可以,关键是整个系统统一,并且写在规则里。

## 表结构:事件是事实,订阅表是快照

```sql
-- billsleuth/billsleuth/schema.sql
-- 金额一律存 TEXT(Decimal 的字符串形式),不用 REAL,避免浮点误差。日期存 ISO 字符串。
CREATE TABLE customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    country TEXT NOT NULL,          -- CN / SG / DE / US,同时决定时区
    currency TEXT NOT NULL,         -- 云簿国际版统一 USD
    tax_region TEXT NOT NULL        -- 用来查 tax_rates.region
);
CREATE TABLE plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    interval TEXT NOT NULL CHECK (interval IN ('month', 'year')),
    unit_price TEXT NOT NULL        -- 每席位每个周期的价格
);
CREATE TABLE coupons (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('percent', 'amount')),
    value TEXT NOT NULL,            -- percent: 20 表示 20%;amount: 10.00 表示减 10 美元
    duration_months INTEGER NOT NULL
);
CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    plan_id TEXT NOT NULL REFERENCES plans(id),   -- 当前套餐
    quantity INTEGER NOT NULL,                    -- 当前席位数
    status TEXT NOT NULL,                         -- active / canceled / paused
    start_date TEXT NOT NULL,
    current_period_start TEXT NOT NULL,
    current_period_end TEXT NOT NULL,
    billing_anchor_day INTEGER NOT NULL CHECK (billing_anchor_day BETWEEN 1 AND 28),
    coupon_id TEXT REFERENCES coupons(id)         -- 新增列:订阅绑定的优惠券,可为空
);
CREATE TABLE subscription_events (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
    type TEXT NOT NULL CHECK (type IN ('create', 'upgrade', 'downgrade', 'quantity_change', 'cancel', 'pause', 'resume')),
    effective_at TEXT NOT NULL,     -- 带时区的 ISO 时间,如 2026-07-15T00:30:00+08:00
    payload_json TEXT NOT NULL
);
CREATE TABLE invoices (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,       -- 不含当天
    issued_at TEXT NOT NULL,
    status TEXT NOT NULL,           -- paid / open / void
    subtotal TEXT NOT NULL,
    discount TEXT NOT NULL,
    tax TEXT NOT NULL,
    total TEXT NOT NULL,
    currency TEXT NOT NULL
);
CREATE TABLE invoice_lines (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    kind TEXT NOT NULL CHECK (kind IN ('recurring', 'proration', 'discount', 'tax', 'adjustment')),
    description TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_amount TEXT NOT NULL,
    amount TEXT NOT NULL,
    period_start TEXT,
    period_end TEXT,
    tax_code TEXT
);
CREATE TABLE payments (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    amount TEXT NOT NULL,
    status TEXT NOT NULL,           -- succeeded / failed / refunded
    attempted_at TEXT NOT NULL,
    gateway_ref TEXT NOT NULL
);
CREATE TABLE credit_notes (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    amount TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'issued'))
);
CREATE TABLE tax_rates (
    code TEXT PRIMARY KEY,
    region TEXT NOT NULL,
    rate TEXT NOT NULL,             -- 0.09 表示 9%
    valid_from TEXT NOT NULL,
    valid_to TEXT                   -- 含当天;NULL 表示至今有效
);
CREATE INDEX idx_inv_customer ON invoices(customer_id, period_start);
CREATE INDEX idx_lines_invoice ON invoice_lines(invoice_id);
CREATE INDEX idx_pay_invoice ON payments(invoice_id);
CREATE INDEX idx_events_sub ON subscription_events(subscription_id, effective_at);
```

```python
# billsleuth/billsleuth/db.py
"""SQLite 连接。库路径默认 billing.db,评测时用环境变量 BILLSLEUTH_DB 指到每个场景自己的副本。"""
import os
import sqlite3
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = Path(__file__).with_name("schema.sql")

sqlite3.register_adapter(Decimal, str)  # 写库时 Decimal 自动变成字符串


def db_path() -> Path:
    return Path(os.environ.get("BILLSLEUTH_DB", ROOT / "billing.db"))


def connect(path: Path | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(path or db_path())
    conn.row_factory = sqlite3.Row
    return conn


def init_db(path: Path) -> sqlite3.Connection:
    path.unlink(missing_ok=True)
    conn = connect(path)
    conn.executescript(SCHEMA.read_text())
    return conn
```

几个决定说一下。

**金额存 TEXT**。SQLite 的 REAL 就是 float,存进去就不精确了。存字符串,读出来用 `Decimal(row["amount"])` 还原。`db.py` 里注册了一个 adapter,写库时 Decimal 自动转字符串,不用每次手动 `str()`。

**`subscription_events` 才是真相,`subscriptions` 只是快照**。订阅表存的是「当前」套餐和席位,但要回答「7 月那张发票该收多少」,需要知道 7 月时的套餐和席位,这只能从事件按时间回放出来。所以开通也是一个事件(`create`,payload 里有初始套餐和席位),引擎只读事件,不读订阅表的当前值。这个设计和事件溯源(event sourcing)是一个思路,在计费里尤其重要,因为争议几乎都关于过去。

**事件时间存带时区的 UTC 时间**。`effective_at` 存成 `2026-07-14T16:35:00+00:00` 这样的字符串,计费规则按客户本地日期算,转换在引擎里做。昨天说的时区 bug 就藏在这里。

**新增了 `subscriptions.coupon_id`**。规划里的 coupons 表只有券本身,没说券绑在哪个订阅上,我加了这一列。规划之外的新增,我都会在注释里标出来,方便以后读代码的人知道这不是遗漏。

## 参考引擎

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="参考引擎的流程:回放订阅事件,逐个周期生成订阅费行、上周期的折算行、折扣行和税行">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
  <rect x="20" y="30" width="150" height="56" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="95" y="53" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">订阅事件</text>
  <text x="95" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">create/upgrade/…</text>
  <line x1="170" y1="58" x2="220" y2="58" stroke="var(--ink-soft)" marker-end="url(#a122)"/>
  <rect x="220" y="20" width="220" height="200" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="330" y="42" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">每个周期 ps..pe</text>
  <text x="235" y="68" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">1. 取上周期留下的折算行</text>
  <text x="235" y="90" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">2. 订阅费 = 单价 × 席位</text>
  <text x="235" y="112" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">3. 优惠券(有效月内)</text>
  <text x="235" y="134" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">4. 税 = (小计-折扣)×税率</text>
  <text x="235" y="156" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">5. 处理本周期内的事件:</text>
  <text x="250" y="176" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">改套餐 → 生成折算行留给下期</text>
  <text x="250" y="196" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">取消 → 本期结束后停止</text>
  <line x1="440" y1="120" x2="490" y2="120" stroke="var(--ink-soft)" marker-end="url(#a122)"/>
  <rect x="490" y="80" width="130" height="80" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="555" y="112" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">应收发票列表</text>
  <text x="555" y="132" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">行项目合计=总额</text>
  <text x="20" y="255" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">事件日期一律先转成客户本地日期,再判断落在哪个周期</text>
  <text x="20" y="278" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">同一个引擎:造数时算正确的账,Agent 查账时由 recompute_invoice 调用</text>
  <defs><marker id="a122" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>引擎是一个按周期推进的循环。注意第 5 步在第 1–4 步之后:本周期发生的改动,影响的是下一张发票。</figcaption>
</figure>

```python
# billsleuth/billsleuth/engine.py
"""参考计费引擎:给定客户、订阅事件、套餐、优惠券和税率,算出「应该」开出的每一张发票。

它是整个项目的「标准答案」:造数时先用它生成正确的账,再往里注入错误;
Agent 查账时通过 recompute_invoice 工具调用它,拿应收和实收逐行对比。
规则(全部是云簿 CloudLedger 的虚构规则,写在帮助中心里):
- 按计费锚点日开账,月付每月一张,年付每年一张;period_end 不含当天。
- 周期中途改套餐或席位:下一张发票里先退还旧配置未使用的天数,再收新配置剩余天数,按天折算。
- 事件日期按客户所在国家的本地日期算。
- 取消默认「到期取消」:当前周期照常,之后不再开票。
- 优惠券在订阅开始后的 duration_months 个月内生效,作用于小计(订阅费 + 折算)。
- 税 = (小计 − 折扣) × 开票日有效的税率,四舍五入到分。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from billsleuth.money import ZERO, money, prorate

COUNTRY_TZ = {"CN": "Asia/Shanghai", "SG": "Asia/Singapore", "DE": "Europe/Berlin", "US": "America/Los_Angeles"}


@dataclass
class Customer:
    id: str
    name: str
    country: str
    currency: str
    tax_region: str


@dataclass
class Plan:
    id: str
    name: str
    interval: str  # month | year
    unit_price: Decimal


@dataclass
class Coupon:
    id: str
    kind: str  # percent | amount
    value: Decimal
    duration_months: int


@dataclass
class TaxRate:
    code: str
    region: str
    rate: Decimal
    valid_from: date
    valid_to: date | None  # 含当天;None = 至今有效


@dataclass
class Event:
    id: str
    type: str
    effective_at: datetime  # 带时区
    payload: dict


@dataclass
class Subscription:
    id: str
    customer_id: str
    start_date: date
    billing_anchor_day: int
    coupon_id: str | None
    events: list[Event]


@dataclass
class Line:
    kind: str  # recurring | proration | discount | tax | adjustment
    description: str
    quantity: int
    unit_amount: Decimal
    amount: Decimal
    period_start: date | None = None
    period_end: date | None = None
    tax_code: str | None = None


@dataclass
class Invoice:
    id: str
    customer_id: str
    subscription_id: str
    period_start: date
    period_end: date
    issued_at: date
    currency: str
    status: str = "paid"
    lines: list[Line] = field(default_factory=list)

    def _sum(self, *kinds: str) -> Decimal:
        return money(sum((ln.amount for ln in self.lines if ln.kind in kinds), ZERO))

    @property
    def subtotal(self) -> Decimal:
        return self._sum("recurring", "proration", "adjustment")

    @property
    def discount(self) -> Decimal:
        return -self._sum("discount")  # 折扣行是负数,表头存正数

    @property
    def tax(self) -> Decimal:
        return self._sum("tax")

    @property
    def total(self) -> Decimal:
        return money(sum((ln.amount for ln in self.lines), ZERO))


def add_months(d: date, n: int, anchor: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    return date(d.year + y, m + 1, anchor)


def local_date(ts: datetime, country: str) -> date:
    return ts.astimezone(ZoneInfo(COUNTRY_TZ[country])).date()


def months_between(a: date, b: date) -> int:
    return (b.year - a.year) * 12 + (b.month - a.month)


def rate_on(rates: list[TaxRate], region: str, on: date) -> TaxRate:
    for r in rates:
        if r.region == region and r.valid_from <= on and (r.valid_to is None or on <= r.valid_to):
            return r
    raise LookupError(f"{region} 在 {on} 没有有效税率")


def apply_discount_and_tax(inv: Invoice, coupon: Coupon | None, months_in: int, tax: TaxRate) -> None:
    """给已有订阅费/折算行的发票补上折扣行和税行,并给所有行标上税码。"""
    base = inv.subtotal
    if coupon and months_in < coupon.duration_months and base > 0:
        if coupon.kind == "percent":
            off = money(base * coupon.value / 100)
            desc = f"优惠券 {coupon.id}(-{coupon.value}%)"
        else:
            off = min(money(coupon.value), base)
            desc = f"优惠券 {coupon.id}(-{money(coupon.value)})"
        inv.lines.append(Line("discount", desc, 1, -off, -off))
    taxable = inv.subtotal - inv.discount
    tax_amount = money(taxable * tax.rate)
    for ln in inv.lines:
        ln.tax_code = tax.code
    inv.lines.append(Line("tax", f"税 {tax.code}({(tax.rate * 100).normalize():f}%)", 1, tax_amount, tax_amount, tax_code=tax.code))


def build_invoices(customer: Customer, sub: Subscription, plans: dict[str, Plan], coupon: Coupon | None,
                   rates: list[TaxRate], until: date) -> list[Invoice]:
    """生成从订阅开始到 until(含)为止所有周期的应收发票。"""
    events = sorted(sub.events, key=lambda e: e.effective_at)
    create = next(e for e in events if e.type == "create")
    plan = plans[create.payload["plan_id"]]
    qty = int(create.payload["quantity"])
    step = 1 if plan.interval == "month" else 12

    invoices: list[Invoice] = []
    pending: list[Line] = []  # 上个周期里产生、要记到下一张发票上的折算行
    cancel_end: date | None = None
    paused = False
    ps, k = sub.start_date, 0
    while ps <= until:
        pe = add_months(ps, step, sub.billing_anchor_day)
        if cancel_end is not None and ps >= cancel_end:
            break
        inv = Invoice(id=f"{sub.id.replace('SUB', 'INV')}-{k + 1:02d}", customer_id=customer.id,
                      subscription_id=sub.id, period_start=ps, period_end=pe, issued_at=ps,
                      currency=customer.currency)
        inv.lines.extend(pending)
        pending = []
        if not paused:
            inv.lines.append(Line("recurring", f"{plan.name} × {qty} 席位", qty, plan.unit_price,
                                  money(plan.unit_price * qty), ps, pe))
        if inv.lines:
            apply_discount_and_tax(inv, coupon, months_between(sub.start_date, ps),
                                   rate_on(rates, customer.tax_region, ps))
            invoices.append(inv)

        days = (pe - ps).days
        for ev in events:
            d = local_date(ev.effective_at, customer.country)
            if not (ps <= d < pe) or ev.type == "create":
                continue
            remaining = (pe - d).days
            if ev.type in ("upgrade", "downgrade", "quantity_change"):
                new_plan = plans[ev.payload.get("to_plan", plan.id)]
                new_qty = int(ev.payload.get("to_quantity", qty))
                if new_plan.interval != plan.interval:
                    raise ValueError("引擎不支持月付和年付之间互换,请先取消再新建订阅")
                old_full = money(plan.unit_price * qty)
                new_full = money(new_plan.unit_price * new_qty)
                credit = prorate(old_full, remaining, days)
                charge = prorate(new_full, remaining, days)
                pending.append(Line("proration", f"未使用时间退还:{plan.name} × {qty}({d} 至 {pe})",
                                    qty, -credit, -credit, d, pe))
                pending.append(Line("proration", f"剩余时间:{new_plan.name} × {new_qty}({d} 至 {pe})",
                                    new_qty, charge, charge, d, pe))
                plan, qty = new_plan, new_qty
            elif ev.type == "cancel":
                cancel_end = pe
            elif ev.type == "pause":
                paused = True
            elif ev.type == "resume":
                paused = False
        ps, k = pe, k + 1
    return invoices


def expected_for_period(customer: Customer, sub: Subscription, plans: dict[str, Plan], coupon: Coupon | None,
                        rates: list[TaxRate], period_start: date) -> Invoice | None:
    """某个周期「应该」开出的发票;这个周期本不该开票(比如已取消)就返回 None。"""
    for inv in build_invoices(customer, sub, plans, coupon, rates, until=period_start):
        if inv.period_start == period_start:
            return inv
    return None
```

这段代码我想请你重点看三处。

第一处是 `Invoice` 的四个 property。表头的小计、折扣、税、总额都是从行项目算出来的,不单独存一份。这样「行项目加起来等于总额」在内存里永远成立,不可能出现表头和明细不一致的发票。写库的时候才把算好的表头存进 invoices 表,方便查询。这个习惯在真实系统里也很有用:能推导出来的值,就不要让它有机会和来源不一致。

第二处是 `build_invoices` 里的循环顺序。每个周期先把上一周期留下的折算行(`pending`)放进来,再加本期订阅费,算折扣和税,最后才处理本期内发生的事件,生成新的折算行留给下一期。这个顺序就是昨天说的「中途升级的钱记在下一张发票上」。如果你把第 5 步挪到前面,折算就会出现在当期发票上,也是一种合理的规则,但就和我们帮助中心写的不一样了。**引擎不追求「唯一正确」的计费规则,它追求和公司对外承诺的规则完全一致。**

第三处是 `local_date`。所有事件先按客户所在国家转成本地日期,再判断落在哪个周期、还剩多少天。时区表是硬编码的四个国家,真实系统里客户的时区应该是一个字段,而且要考虑客户换了时区怎么办,这些都在非目标里。

`expected_for_period` 是给明天的复算工具准备的:给定一个周期的开始日,返回这个周期「应该」开出的发票;如果这个周期本不该开票(比如订阅已经取消),返回 `None`。

## 用单元测试把规则钉死

引擎写完,不要急着造数据。先用测试把每条规则钉住,而且测试里用的数字就是昨天手算的那些:

```python
# billsleuth/tests/test_engine.py
from datetime import date, datetime
from decimal import Decimal as D

import pytest

from billsleuth.engine import (
    Coupon,
    Customer,
    Event,
    Plan,
    Subscription,
    TaxRate,
    build_invoices,
    expected_for_period,
    local_date,
)
from billsleuth.money import money, prorate

PLANS = {
    "team-m": Plan("team-m", "团队版(月付)", "month", D("39.00")),
    "business-m": Plan("business-m", "商业版(月付)", "month", D("89.00")),
}
RATES = [
    TaxRate("CN-VAT6", "CN", D("0.06"), date(2016, 5, 1), None),
    TaxRate("SG-GST8", "SG", D("0.08"), date(2023, 1, 1), date(2023, 12, 31)),
    TaxRate("SG-GST9", "SG", D("0.09"), date(2024, 1, 1), None),
]
CN = Customer("C-0001", "测试客户", "CN", "USD", "CN")


def ts(s: str) -> datetime:
    return datetime.fromisoformat(s)


def sub(*events: Event, coupon_id=None) -> Subscription:
    create = Event("E0", "create", ts("2026-06-05T09:00:00+08:00"), {"plan_id": "team-m", "quantity": 3})
    return Subscription("SUB-0001", "C-0001", date(2026, 6, 5), 5, coupon_id, [create, *events])


def test_money_rejects_float():
    with pytest.raises(TypeError):
        money(0.1)  # type: ignore[arg-type]
    assert money("2.675") == D("2.68")  # ROUND_HALF_UP,float 会得到 2.67


def test_prorate_rounds_once():
    assert prorate(D("117.00"), 15, 30) == D("58.50")
    assert prorate(D("39.00"), 10, 31) == D("12.58")  # 12.580645… → 12.58


def test_plain_monthly_invoices():
    invs = build_invoices(CN, sub(), PLANS, None, RATES, until=date(2026, 8, 5))
    assert [i.period_start for i in invs] == [date(2026, 6, 5), date(2026, 7, 5), date(2026, 8, 5)]
    first = invs[0]
    assert (first.subtotal, first.tax, first.total) == (D("117.00"), D("7.02"), D("124.02"))
    assert first.id == "INV-0001-01"


def test_upgrade_prorates_on_next_invoice():
    up = Event("E1", "upgrade", ts("2026-06-20T10:00:00+08:00"), {"to_plan": "business-m"})
    invs = build_invoices(CN, sub(up), PLANS, None, RATES, until=date(2026, 7, 5))
    second = invs[1]
    amounts = [(ln.kind, ln.amount) for ln in second.lines]
    assert ("proration", D("-58.50")) in amounts  # 旧套餐 117 × 15/30
    assert ("proration", D("133.50")) in amounts  # 新套餐 267 × 15/30
    assert ("recurring", D("267.00")) in amounts
    assert (second.subtotal, second.tax, second.total) == (D("342.00"), D("20.52"), D("362.52"))


def test_event_date_uses_customer_timezone():
    # UTC 6 月 19 日 17:30 = 上海 6 月 20 日 01:30
    assert local_date(ts("2026-06-19T17:30:00+00:00"), "CN") == date(2026, 6, 20)
    up = Event("E1", "upgrade", ts("2026-06-19T17:30:00+00:00"), {"to_plan": "business-m"})
    second = build_invoices(CN, sub(up), PLANS, None, RATES, until=date(2026, 7, 5))[1]
    assert second.lines[0].amount == D("-58.50")  # 还是按 15 天算,不是 16 天


def test_percent_coupon_only_within_duration():
    coupon = Coupon("WELCOME20", "percent", D("20"), 2)
    invs = build_invoices(CN, sub(coupon_id="WELCOME20"), PLANS, coupon, RATES, until=date(2026, 8, 5))
    assert [i.discount for i in invs] == [D("23.40"), D("23.40"), D("0.00")]
    assert invs[0].tax == D("5.62")  # (117 - 23.40) × 6% = 5.616
    assert invs[0].total == D("99.22")


def test_cancel_stops_after_period_end():
    cancel = Event("E1", "cancel", ts("2026-07-10T12:00:00+08:00"), {"at_period_end": True})
    invs = build_invoices(CN, sub(cancel), PLANS, None, RATES, until=date(2026, 9, 5))
    assert [i.period_start for i in invs] == [date(2026, 6, 5), date(2026, 7, 5)]
    assert expected_for_period(CN, sub(cancel), PLANS, None, RATES, date(2026, 8, 5)) is None


def test_tax_rate_follows_validity_window():
    sg = Customer("C-0002", "SG 客户", "SG", "USD", "SG")
    inv = build_invoices(sg, sub(), PLANS, None, RATES, until=date(2026, 6, 5))[0]
    assert inv.lines[-1].tax_code == "SG-GST9"
    assert inv.tax == D("10.53")  # 117 × 9%


def test_lines_always_sum_to_total():
    up = Event("E1", "quantity_change", ts("2026-07-12T08:00:00+08:00"), {"to_quantity": 5})
    coupon = Coupon("LAUNCH10", "amount", D("10.00"), 3)
    for inv in build_invoices(CN, sub(up, coupon_id="LAUNCH10"), PLANS, coupon, RATES, until=date(2026, 10, 5)):
        assert inv.total == money(inv.subtotal - inv.discount + inv.tax)
```

```bash
uv run pytest -q tests/test_engine.py
```

9 个测试应该全部通过。每个测试对应帮助中心里的一条规则,我在函数名上就写清楚了是哪条:按天折算记在下一张发票、事件日期按客户时区、优惠券只在有效月份内生效、取消后不再开票、税率按有效期取。最后一个 `test_lines_always_sum_to_total` 是一个不变量测试:不管什么组合,行项目加起来都必须等于总额。

如果你想更进一步,可以用 Hypothesis 做基于性质的测试:随机生成锚点日、席位、事件日期,断言「行项目合计等于总额」「折算净额的符号和升降级方向一致」「同一订阅的周期首尾相接、不重叠」。这类测试能找到你自己想不到的边界情况,链接在学习资料里。

## 价目表和税率

```python
# billsleuth/billsleuth/refdata.py
"""云簿 CloudLedger 的价目表、优惠券和税率表。全部虚构,只用于练习。

税率:CN/SG/DE 按 2026 年常见税率简化;US-DST 是虚构的「数字服务税」,
故意设计成 2026-07-01 从 5% 降到 3%,用来制造「用了过期税率」这类故障。
"""
from datetime import date
from decimal import Decimal as D

from billsleuth.engine import Coupon, Plan, TaxRate

PLANS = {p.id: p for p in [
    Plan("starter-m", "入门版(月付)", "month", D("15.00")),
    Plan("team-m", "团队版(月付)", "month", D("39.00")),
    Plan("business-m", "商业版(月付)", "month", D("89.00")),
    Plan("team-y", "团队版(年付)", "year", D("390.00")),
    Plan("business-y", "商业版(年付)", "year", D("890.00")),
]}

COUPONS = {c.id: c for c in [
    Coupon("WELCOME20", "percent", D("20"), 3),
    Coupon("LAUNCH10", "amount", D("10.00"), 3),
    Coupon("SPRING15", "percent", D("15"), 6),
]}

TAX_RATES = [
    TaxRate("CN-VAT6", "CN", D("0.06"), date(2016, 5, 1), None),
    TaxRate("SG-GST8", "SG", D("0.08"), date(2023, 1, 1), date(2023, 12, 31)),
    TaxRate("SG-GST9", "SG", D("0.09"), date(2024, 1, 1), None),
    TaxRate("DE-VAT19", "DE", D("0.19"), date(2007, 1, 1), None),
    TaxRate("US-DST5", "US", D("0.05"), date(2024, 1, 1), date(2026, 6, 30)),
    TaxRate("US-DST3", "US", D("0.03"), date(2026, 7, 1), None),
]
```

`US-DST5` 和 `US-DST3` 是虚构的,我在注释里写明了。为什么要编一个降税的例子?因为「用了过期税率」这类故障,只有在新税率比旧税率低的时候才会让客户多付钱,客户才会来投诉。现实中税率下调不常见,但「系统里的税率表没有及时更新」这种事情是真实存在的。

## 故障注入:模仿真实的 bug,而不是随便改个数

造错误数据有两种做法。偷懒的做法是随机挑一张发票,把总额加 10 块钱。这样造出来的账有一个致命问题:行项目加起来不等于总额,Agent 一眼就能看出「数据被改过」,而真实世界的 bug 从来不会这样。好的做法是**模仿真实计费系统里的 bug 是怎么产生错误的**:分母写死 30 天、漏了退还行、按 UTC 取日期,然后让错误「合理地」流过整张发票,折扣和税都跟着重算,总额和行项目依然自洽。这样 Agent 要找错,就必须像人一样去比对规则,而不是去找数据里的破绽。

```python
# billsleuth/billsleuth/faults.py
"""12 类故障注入。每个注入函数拿到一份「正确的账」,改坏其中一处,返回标准答案(ground truth)。

改坏的方式模仿真实计费系统里常见的 bug,而不是随便改个数字:
分母写死 30 天、漏了退还行、重复扣款、用了过期税率、时区按 UTC 算……
"""
from __future__ import annotations

import copy
import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from billsleuth.engine import (
    Coupon,
    Customer,
    Invoice,
    Line,
    Plan,
    Subscription,
    TaxRate,
    add_months,
    apply_discount_and_tax,
    local_date,
    months_between,
    rate_on,
)
from billsleuth.money import ZERO, money, prorate

ROOT_CAUSES = {
    "proration_wrong_days": "按天折算用错了天数(分母写死 30 天)",
    "proration_missing_credit": "升级时漏了旧套餐未使用部分的退还",
    "duplicate_charge": "同一张发票被扣款两次",
    "duplicate_invoice": "同一个计费周期开了两张发票",
    "expired_tax_rate": "用了已经过期的税率",
    "wrong_tax_region": "用了别的地区的税率",
    "coupon_not_applied": "优惠券在有效期内却没有抵扣",
    "coupon_wrong_base": "百分比优惠券只算了订阅费,漏了折算部分",
    "quantity_change_ignored": "减席位没有生效,仍按原席位收费",
    "cancel_not_respected": "已取消的订阅在到期后仍然开票扣款",
    "timezone_change_date": "改套餐日期按 UTC 算,折算多算了一天",
    "wrong_plan_price": "订阅费单价和价目表不一致",
    "no_error": "账单没有错,客户误解",
}


@dataclass
class Payment:
    id: str
    invoice_id: str
    amount: Decimal
    status: str
    attempted_at: str
    gateway_ref: str


@dataclass
class Ledger:
    """一个场景里的全部账:客户、订阅、发票、付款。注入函数直接改它。"""
    customer: Customer
    sub: Subscription
    plans: dict[str, Plan]
    coupon: Coupon | None
    rates: list[TaxRate]
    invoices: list[Invoice]
    payments: list[Payment] = field(default_factory=list)
    extra_payments: list[Payment] = field(default_factory=list)  # 注入函数造出来的「多扣的那一笔」

    def rate(self, inv: Invoice) -> TaxRate:
        return rate_on(self.rates, self.customer.tax_region, inv.period_start)

    def months_in(self, inv: Invoice) -> int:
        return months_between(self.sub.start_date, inv.period_start)

    def pay_all(self) -> None:
        """每张发票按(可能已被改坏的)总额扣款成功一次,再加上注入函数造的额外扣款。注入之后再调用。"""
        self.payments = [Payment(inv.id.replace("INV", "PAY"), inv.id, inv.total, "succeeded",
                                 f"{inv.issued_at.isoformat()}T02:00:00+00:00", f"gw_{inv.id[4:].replace('-', '')}")
                         for inv in self.invoices] + self.extra_payments


@dataclass
class Truth:
    root_cause: str
    invoice_ids: list[str]
    overcharge: Decimal          # 客户多付的钱(含税),没错就是 0
    expected_action: str         # credit_note | explain_only
    detail: str                  # 给人看的一句话


def refinalize(inv: Invoice, ledger: Ledger, coupon: Coupon | None | str = "keep",
               tax: TaxRate | None = None) -> None:
    """改了行项目以后,去掉旧的折扣行和税行,重新算一遍。"""
    inv.lines = [ln for ln in inv.lines if ln.kind not in ("discount", "tax")]
    c = ledger.coupon if coupon == "keep" else coupon
    apply_discount_and_tax(inv, c if isinstance(c, Coupon) else None, ledger.months_in(inv), tax or ledger.rate(inv))


def invoice_after_event(ledger: Ledger, event_type: str) -> Invoice:
    """事件所在周期的下一张发票:折算行就记在这张上。"""
    ev = next(e for e in ledger.sub.events if e.type == event_type)
    d = local_date(ev.effective_at, ledger.customer.country)
    for i, inv in enumerate(ledger.invoices):
        if inv.period_start <= d < inv.period_end:
            return ledger.invoices[i + 1]
    raise LookupError("事件之后没有发票")


def _overcharge(before: Decimal, inv: Invoice) -> Decimal:
    return money(inv.total - before)


# ---------- 12 个注入函数 ----------

def _change_config(ledger: Ledger, ev_type: str) -> tuple[Decimal, Decimal, date, date, Invoice]:
    """回放事件,拿到改套餐前后的「整期金额」、本地生效日、周期结束日和要记账的那张发票。"""
    events = sorted(ledger.sub.events, key=lambda e: e.effective_at)
    create = events[0]
    plan, qty = ledger.plans[create.payload["plan_id"]], int(create.payload["quantity"])
    for ev in events[1:]:
        new_plan = ledger.plans[ev.payload.get("to_plan", plan.id)]
        new_qty = int(ev.payload.get("to_quantity", qty))
        if ev.type == ev_type:
            d = local_date(ev.effective_at, ledger.customer.country)
            inv = invoice_after_event(ledger, ev_type)
            return money(plan.unit_price * qty), money(new_plan.unit_price * new_qty), d, inv.period_start, inv
        plan, qty = new_plan, new_qty
    raise LookupError(ev_type)


def _rewrite_proration(inv: Invoice, old_full: Decimal, new_full: Decimal, used: int, denom: int,
                       start: date) -> None:
    for ln in inv.lines:
        if ln.kind == "proration":
            amt = prorate(new_full if ln.amount > 0 else old_full, used, denom)
            ln.amount = ln.unit_amount = amt if ln.amount > 0 else -amt
            ln.description = re.sub(r"\(\d{4}-\d{2}-\d{2}", f"({start}", ln.description)
            ln.period_start = start


def proration_wrong_days(ledger: Ledger) -> Truth:
    old_full, new_full, d, pe, inv = _change_config(ledger, "upgrade")
    prev = ledger.invoices[ledger.invoices.index(inv) - 1]
    real_days = (prev.period_end - prev.period_start).days
    before = inv.total
    _rewrite_proration(inv, old_full, new_full, (pe - d).days, 30, d)  # 分母写死 30
    refinalize(inv, ledger)
    return Truth("proration_wrong_days", [inv.id], _overcharge(before, inv), "credit_note",
                 f"{prev.period_start} 开始的周期有 {real_days} 天,折算却按 30 天算")


def proration_missing_credit(ledger: Ledger) -> Truth:
    inv = invoice_after_event(ledger, "upgrade")
    before = inv.total
    inv.lines = [ln for ln in inv.lines if not (ln.kind == "proration" and ln.amount < 0)]
    refinalize(inv, ledger)
    return Truth("proration_missing_credit", [inv.id], _overcharge(before, inv), "credit_note",
                 "升级后的发票只收了新套餐剩余天数,没有退还旧套餐未使用的天数")


def duplicate_charge(ledger: Ledger) -> Truth:
    inv = ledger.invoices[-2]
    ledger.extra_payments.append(Payment(inv.id.replace("INV", "PAY") + "-R", inv.id, inv.total, "succeeded",
                                         f"{inv.issued_at.isoformat()}T02:03:00+00:00",
                                         f"gw_{inv.id[4:].replace('-', '')}r"))
    return Truth("duplicate_charge", [inv.id], inv.total, "credit_note",
                 f"{inv.id} 在同一天被成功扣款两次,相隔 3 分钟")


def duplicate_invoice(ledger: Ledger) -> Truth:
    inv = ledger.invoices[-2]
    dup = copy.deepcopy(inv)
    dup.id = inv.id + "D"
    ledger.invoices.insert(ledger.invoices.index(inv) + 1, dup)
    return Truth("duplicate_invoice", [dup.id], dup.total, "credit_note",
                 f"{inv.period_start} 开始的周期开了两张发票 {inv.id} 和 {dup.id},都扣了款")


def expired_tax_rate(ledger: Ledger) -> Truth:
    inv = ledger.invoices[-1]
    current = ledger.rate(inv)
    old = next(r for r in ledger.rates if r.region == current.region and r.valid_to is not None
               and r.valid_to < inv.period_start)
    before = inv.total
    refinalize(inv, ledger, tax=old)
    return Truth("expired_tax_rate", [inv.id], _overcharge(before, inv), "credit_note",
                 f"{inv.id} 用了 {old.valid_to} 就已失效的 {old.code},应该用 {current.code}")


def wrong_tax_region(ledger: Ledger) -> Truth:
    inv = ledger.invoices[-1]
    current = ledger.rate(inv)
    wrong = max((r for r in ledger.rates if r.region != current.region and r.valid_to is None), key=lambda r: r.rate)
    before = inv.total
    refinalize(inv, ledger, tax=wrong)
    return Truth("wrong_tax_region", [inv.id], _overcharge(before, inv), "credit_note",
                 f"客户税务地区是 {current.region},发票却用了 {wrong.code}")


def coupon_not_applied(ledger: Ledger) -> Truth:
    assert ledger.coupon is not None
    inv = next(i for i in ledger.invoices if 0 < ledger.months_in(i) < ledger.coupon.duration_months)
    before = inv.total
    refinalize(inv, ledger, coupon=None)
    return Truth("coupon_not_applied", [inv.id], _overcharge(before, inv), "credit_note",
                 f"{ledger.coupon.id} 还在有效期内,{inv.id} 却没有抵扣")


def coupon_wrong_base(ledger: Ledger) -> Truth:
    assert ledger.coupon is not None and ledger.coupon.kind == "percent"
    inv = invoice_after_event(ledger, "upgrade")
    before = inv.total
    inv.lines = [ln for ln in inv.lines if ln.kind not in ("discount", "tax")]
    recurring = money(sum((ln.amount for ln in inv.lines if ln.kind == "recurring"), ZERO))
    off = money(recurring * ledger.coupon.value / 100)
    inv.lines.append(Line("discount", f"优惠券 {ledger.coupon.id}(-{ledger.coupon.value}%)", 1, -off, -off))
    tax = ledger.rate(inv)
    t = money((inv.subtotal - inv.discount) * tax.rate)
    inv.lines.append(Line("tax", f"税 {tax.code}({(tax.rate * 100).normalize():f}%)", 1, t, t, tax_code=tax.code))
    return Truth("coupon_wrong_base", [inv.id], _overcharge(before, inv), "credit_note",
                 "百分比优惠券应该按小计(含折算)抵扣,系统只按订阅费那一行算")


def quantity_change_ignored(ledger: Ledger) -> Truth:
    inv = invoice_after_event(ledger, "quantity_change")
    ev = next(e for e in ledger.sub.events if e.type == "quantity_change")
    old_qty = next(int(e.payload["quantity"]) for e in ledger.sub.events if e.type == "create")
    before = inv.total
    inv.lines = [ln for ln in inv.lines if ln.kind != "proration"]
    for ln in inv.lines:
        if ln.kind == "recurring":
            ln.quantity = old_qty
            ln.amount = money(ln.unit_amount * old_qty)
            ln.description = ln.description.split(" × ")[0] + f" × {old_qty} 席位"
    refinalize(inv, ledger)
    return Truth("quantity_change_ignored", [inv.id], _overcharge(before, inv), "credit_note",
                 f"席位已从 {old_qty} 调到 {ev.payload['to_quantity']},{inv.id} 仍按 {old_qty} 席位收费且没有折算")


def cancel_not_respected(ledger: Ledger) -> Truth:
    last = ledger.invoices[-1]
    step = 1 if ledger.plans[_current_plan(ledger)].interval == "month" else 12
    extra = copy.deepcopy(last)
    extra.id = last.id[:-2] + f"{int(last.id[-2:]) + 1:02d}"
    extra.period_start = last.period_end
    extra.period_end = add_months(last.period_end, step, ledger.sub.billing_anchor_day)
    extra.issued_at = extra.period_start
    extra.lines = [ln for ln in extra.lines if ln.kind == "recurring"]
    for ln in extra.lines:
        ln.period_start, ln.period_end = extra.period_start, extra.period_end
    refinalize(extra, ledger)
    ledger.invoices.append(extra)
    return Truth("cancel_not_respected", [extra.id], extra.total, "credit_note",
                 f"订阅已在 {last.period_end} 到期取消,{extra.id} 不应该开出")


def _current_plan(ledger: Ledger) -> str:
    plan = next(e.payload["plan_id"] for e in ledger.sub.events if e.type == "create")
    for e in sorted(ledger.sub.events, key=lambda e: e.effective_at):
        plan = e.payload.get("to_plan", plan)
    return plan


def timezone_change_date(ledger: Ledger) -> Truth:
    old_full, new_full, d, pe, inv = _change_config(ledger, "upgrade")
    prev = ledger.invoices[ledger.invoices.index(inv) - 1]
    days = (prev.period_end - prev.period_start).days
    utc_day = date.fromordinal(d.toordinal() - 1)  # 系统按 UTC 日期算,早了一天
    before = inv.total
    _rewrite_proration(inv, old_full, new_full, (pe - utc_day).days, days, utc_day)
    refinalize(inv, ledger)
    return Truth("timezone_change_date", [inv.id], _overcharge(before, inv), "credit_note",
                 f"改套餐发生在本地时间 {d} 凌晨,系统按 UTC 日期算成 {utc_day},折算多算一天")


def wrong_plan_price(ledger: Ledger) -> Truth:
    inv = ledger.invoices[-1]
    before = inv.total
    for ln in inv.lines:
        if ln.kind == "recurring":
            ln.unit_amount = money(ln.unit_amount + Decimal("6.00"))
            ln.amount = money(ln.unit_amount * ln.quantity)
    refinalize(inv, ledger)
    return Truth("wrong_plan_price", [inv.id], _overcharge(before, inv), "credit_note",
                 "订阅费单价比价目表每席位多了 6.00")


def no_error(ledger: Ledger, invoice: Invoice, detail: str) -> Truth:
    return Truth("no_error", [invoice.id], ZERO, "explain_only", detail)


INJECTORS = {
    "proration_wrong_days": proration_wrong_days,
    "proration_missing_credit": proration_missing_credit,
    "duplicate_charge": duplicate_charge,
    "duplicate_invoice": duplicate_invoice,
    "expired_tax_rate": expired_tax_rate,
    "wrong_tax_region": wrong_tax_region,
    "coupon_not_applied": coupon_not_applied,
    "coupon_wrong_base": coupon_wrong_base,
    "quantity_change_ignored": quantity_change_ignored,
    "cancel_not_respected": cancel_not_respected,
    "timezone_change_date": timezone_change_date,
    "wrong_plan_price": wrong_plan_price,
}
```

每个注入函数都是同一个模式:找到要改坏的那张发票,记下改之前的总额,按某个 bug 的逻辑改行项目,`refinalize` 重算折扣和税,最后用「改之后 − 改之前」得到多收的金额,连同根因、发票号、期望动作一起返回。重复扣款和取消后仍开票这两类不改已有发票,而是多出一笔扣款或一张发票,多收金额就是那一整笔。

这里我踩过一个坑,讲出来你就不会再踩。最早的版本里,我先给所有发票生成扣款记录,再注入故障。测试一跑,100 个场景里 60 个失败:客户的扣款金额是**改坏之前**的正确总额,也就是说,发票上写着多收了,但客户实际付的钱是对的。这在现实里不可能发生,扣款一定是按发票金额扣的。修法是把 `pay_all()` 挪到注入之后,而重复扣款要额外造的那一笔,放进 `extra_payments` 里等 `pay_all()` 一起处理。这个 bug 如果没被测试抓住,Agent 在这 60 个场景里调用 `list_payments` 看到的扣款和发票对不上,会被引向完全错误的方向,而我会以为是 Agent 不行。

## 造数脚本

```python
# billsleuth/billsleuth/seed.py
"""造 100 个计费争议场景:先用参考引擎算出正确的账,再按场景注入一类故障,写进 billing.db,
标准答案写进 scenarios/S001.json … S100.json。

运行:uv run python -m billsleuth.seed
随机种子固定,每次生成的数据完全一样。
"""
from __future__ import annotations

import json
import random
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from billsleuth.db import ROOT, db_path, init_db
from billsleuth.engine import (
    COUNTRY_TZ,
    Customer,
    Event,
    Subscription,
    add_months,
    build_invoices,
)
from billsleuth.faults import INJECTORS, Ledger, Truth, no_error
from billsleuth.money import fmt
from billsleuth.refdata import COUPONS, PLANS, TAX_RATES

AS_OF = date(2026, 10, 15)
SCENARIO_DIR = ROOT / "scenarios"
NAMES = ["星河咨询", "Bluefin Labs", "青禾设计", "Northwind Studio", "鲸落科技", "Kestrel Analytics", "半山书局",
         "Helio Freight", "白桦会计", "Orchid Dental", "木棉旅行", "Quartz Legal", "知更教育", "Lumen Bakery"]

# 80 个有错 + 20 个没错。12 类故障轮流分配,前 8 类各 7 个,后 4 类各 6 个
FAULTY = [c for _ in range(7) for c in INJECTORS][:80]
BENIGN = ["upgrade_proration", "tax_line", "coupon_ended", "annual_renewal"] * 5
COUNTRIES_FOR = {
    "expired_tax_rate": ["US"],
    "wrong_tax_region": ["CN", "SG", "US"],
    "timezone_change_date": ["CN", "SG"],
}


@dataclass
class Setup:
    customer: Customer
    sub: Subscription
    coupon_id: str | None


def utc_iso(local: datetime) -> str:
    return local.astimezone(timezone.utc).isoformat()


def periods(start: date, anchor: int, step: int) -> list[tuple[date, date]]:
    out, ps = [], start
    while ps <= AS_OF:
        pe = add_months(ps, step, anchor)
        out.append((ps, pe))
        ps = pe
    return out


def event_at(rng: random.Random, period: tuple[date, date], country: str, early_morning: bool = False) -> datetime:
    ps, pe = period
    d = ps + timedelta(days=rng.randint(2, (pe - ps).days - 3))
    hour = rng.randint(0, 6) if early_morning else rng.randint(9, 18)
    return datetime(d.year, d.month, d.day, hour, rng.choice([5, 20, 35, 50]), tzinfo=ZoneInfo(COUNTRY_TZ[country]))


def build_setup(i: int, kind: str, rng: random.Random) -> Setup:
    cid, sid = f"C-{i:04d}", f"SUB-{i:04d}"
    country = rng.choice(COUNTRIES_FOR.get(kind, ["CN", "SG", "DE", "US"]))
    customer = Customer(cid, f"{rng.choice(NAMES)}-{i:03d}", country, "USD", country)
    anchor = rng.randint(1, 28)
    yearly = kind == "annual_renewal"
    if yearly:
        anchor = rng.randint(1, 14)  # 保证 2026 年 10 月的续费日在 AS_OF 之前
        start = date(2025, 10, anchor)
        plan_id = rng.choice(["team-y", "business-y"])
    else:
        start = date(2026, rng.choice([5, 6]), anchor)
        plan_id = rng.choice(["starter-m", "team-m"])
    qty = rng.randint(3, 12)
    created = datetime(start.year, start.month, start.day, 10, 0, tzinfo=ZoneInfo(COUNTRY_TZ[country]))
    events = [Event(f"EV-{i:04d}-1", "create", created, {"plan_id": plan_id, "quantity": qty})]
    ps_list = periods(start, anchor, 12 if yearly else 1)

    def add(etype: str, period_idx: int, payload: dict, early: bool = False) -> None:
        ts = event_at(rng, ps_list[period_idx], country, early)
        events.append(Event(f"EV-{i:04d}-{len(events) + 1}", etype, ts, payload))

    up_to = "business-m" if plan_id in ("starter-m", "team-m") else plan_id
    if kind in ("proration_wrong_days",):
        j = next(j for j in range(len(ps_list) - 1) if (ps_list[j][1] - ps_list[j][0]).days == 31)
        add("upgrade", j, {"to_plan": up_to})
    elif kind in ("proration_missing_credit", "coupon_wrong_base", "upgrade_proration"):
        add("upgrade", 1, {"to_plan": up_to})
    elif kind == "timezone_change_date":
        add("upgrade", 1, {"to_plan": up_to}, early=True)
    elif kind == "quantity_change_ignored":
        add("quantity_change", 1, {"to_quantity": rng.randint(1, qty - 1)})
    elif kind == "cancel_not_respected":
        add("cancel", len(ps_list) - 2, {"at_period_end": True})

    if kind == "coupon_wrong_base":
        coupon_id = "SPRING15"
    elif kind in ("coupon_not_applied", "coupon_ended"):
        coupon_id = rng.choice(["WELCOME20", "LAUNCH10"])
    elif not yearly and rng.random() < 0.25:
        coupon_id = "LAUNCH10"  # 干扰项:有些客户本来就有优惠券
    else:
        coupon_id = None
    sub = Subscription(sid, cid, start, anchor, coupon_id, events)
    return Setup(customer, sub, coupon_id)


def month_cn(d: date) -> str:
    return f"{d.month} 月"


def question(kind: str, truth: Truth, ledger: Ledger, rng: random.Random) -> str:
    inv = next(x for x in ledger.invoices if x.id == truth.invoice_ids[0])
    m, total = month_cn(inv.issued_at), fmt(inv.total)
    generic = [
        f"你好,我们 {m}的账单扣了 {total} 美元,比我预想的多,能帮忙看看是不是算错了吗?",
        f"{m}这张发票金额 {total},我们财务对不上账,麻烦查一下。",
        f"为什么 {m}收了我 {total}?感觉不对。",
    ]
    special = {
        "duplicate_charge": f"我的信用卡在 {inv.issued_at.month} 月 {inv.issued_at.day} 日有两笔 {total} 美元的扣款,是不是扣重了?",
        "duplicate_invoice": f"{m}我好像收到了两张一样的发票,钱也扣了两次,每次 {total}。",
        "cancel_not_respected": f"我们早就申请取消订阅了,怎么 {m}还扣了 {total} 美元?",
        "quantity_change_ignored": f"我们上个月把席位减了,{m}的账单 {total} 好像没变少。",
        "upgrade_proration": f"我们升级了套餐,{m}的账单里多了两行「未使用时间退还」和「剩余时间」,金额 {total},是不是多收了?",
        "tax_line": f"套餐价格明明是固定的,{m}的账单为什么是 {total}?多出来的是什么?",
        "coupon_ended": f"{m}的账单突然涨到 {total} 了,我们没改过套餐,怎么回事?",
        "annual_renewal": f"今天突然扣了我们 {total} 美元,金额这么大,是不是扣错了?",
    }
    if kind in special and (kind not in INJECTORS or rng.random() < 0.6):
        return special[kind]
    return rng.choice(generic)


def benign_truth(kind: str, ledger: Ledger) -> Truth:
    invs = ledger.invoices
    if kind == "upgrade_proration":
        inv = next(x for x in invs if any(ln.kind == "proration" for ln in x.lines))
        return no_error(ledger, inv, "升级后的折算是对的:先退旧套餐未使用天数,再收新套餐剩余天数")
    if kind == "coupon_ended":
        assert ledger.coupon
        inv = next(x for x in invs if ledger.months_in(x) == ledger.coupon.duration_months)
        return no_error(ledger, inv, f"{ledger.coupon.id} 只抵扣前 {ledger.coupon.duration_months} 个月,已按期结束")
    if kind == "annual_renewal":
        return no_error(ledger, invs[-1], "年付订阅到期自动续费,金额正确")
    return no_error(ledger, invs[-1], "多出来的是税,按客户所在地区的有效税率计算,正确")


def scenario_kinds() -> list[str]:
    kinds = FAULTY + BENIGN
    random.Random(7).shuffle(kinds)
    return kinds


def make_scenario(i: int, kind: str) -> tuple[random.Random, Ledger, Truth]:
    """第 i 个场景:正确的账 → 注入故障 → 标准答案。纯内存,不碰数据库,方便测试。"""
    rng = random.Random(1000 + i)
    s = build_setup(i, kind, rng)
    coupon = COUPONS.get(s.coupon_id or "")
    invoices = build_invoices(s.customer, s.sub, PLANS, coupon, TAX_RATES, until=AS_OF)
    ledger = Ledger(s.customer, s.sub, PLANS, coupon, TAX_RATES, invoices)
    truth = INJECTORS[kind](ledger) if kind in INJECTORS else benign_truth(kind, ledger)
    ledger.pay_all()  # 先改坏账,再按改坏后的金额扣款:客户真金白银付的就是错的数
    return rng, ledger, truth


def main() -> None:
    SCENARIO_DIR.mkdir(exist_ok=True)
    for f in SCENARIO_DIR.glob("S*.json"):
        f.unlink()
    conn = init_db(db_path())
    conn.executemany("INSERT INTO plans VALUES (?,?,?,?)",
                     [(p.id, p.name, p.interval, p.unit_price) for p in PLANS.values()])
    conn.executemany("INSERT INTO coupons VALUES (?,?,?,?)",
                     [(c.id, c.kind, c.value, c.duration_months) for c in COUPONS.values()])
    conn.executemany("INSERT INTO tax_rates VALUES (?,?,?,?,?)",
                     [(r.code, r.region, r.rate, r.valid_from.isoformat(), r.valid_to and r.valid_to.isoformat())
                      for r in TAX_RATES])

    for i, kind in enumerate(scenario_kinds(), start=1):
        rng, ledger, truth = make_scenario(i, kind)
        write_ledger(conn, ledger)
        scenario = {
            "id": f"S{i:03d}", "customer_id": ledger.customer.id, "as_of": AS_OF.isoformat(),
            "question": question(kind, truth, ledger, rng),
            "truth": {"root_cause": truth.root_cause, "variant": kind, "invoice_ids": truth.invoice_ids,
                      "overcharge": fmt(truth.overcharge), "expected_action": truth.expected_action,
                      "detail": truth.detail},
        }
        (SCENARIO_DIR / f"S{i:03d}.json").write_text(json.dumps(scenario, ensure_ascii=False, indent=2))
    conn.commit()
    print(f"写入 {len(scenario_kinds())} 个场景 → {db_path()},标准答案在 {SCENARIO_DIR}/")


def write_ledger(conn, ledger: Ledger) -> None:
    c, s = ledger.customer, ledger.sub
    conn.execute("INSERT INTO customers VALUES (?,?,?,?,?)", (c.id, c.name, c.country, c.currency, c.tax_region))
    # subscriptions 表存「当前」状态:回放全部事件得到当前套餐、席位和状态
    plan_id = s.events[0].payload["plan_id"]
    qty = int(s.events[0].payload["quantity"])
    status = "active"
    for e in sorted(s.events, key=lambda e: e.effective_at):
        plan_id = e.payload.get("to_plan", plan_id)
        qty = int(e.payload.get("to_quantity", qty))
        if e.type == "cancel":
            status = "canceled"
    last = max((i for i in ledger.invoices if not i.id.endswith("D")), key=lambda i: i.period_start)
    conn.execute("INSERT INTO subscriptions VALUES (?,?,?,?,?,?,?,?,?,?)",
                 (s.id, c.id, plan_id, qty, status, s.start_date.isoformat(), last.period_start.isoformat(),
                  last.period_end.isoformat(), s.billing_anchor_day, s.coupon_id))
    conn.executemany("INSERT INTO subscription_events VALUES (?,?,?,?,?)",
                     [(e.id, s.id, e.type, utc_iso(e.effective_at), json.dumps(e.payload)) for e in s.events])
    for inv in ledger.invoices:
        conn.execute("INSERT INTO invoices VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                     (inv.id, inv.customer_id, inv.subscription_id, inv.period_start.isoformat(),
                      inv.period_end.isoformat(), inv.issued_at.isoformat(), inv.status, inv.subtotal,
                      inv.discount, inv.tax, inv.total, inv.currency))
        conn.executemany("INSERT INTO invoice_lines VALUES (?,?,?,?,?,?,?,?,?,?)",
                         [(f"{inv.id}-L{n}", inv.id, ln.kind, ln.description, ln.quantity, ln.unit_amount,
                           ln.amount, ln.period_start and ln.period_start.isoformat(),
                           ln.period_end and ln.period_end.isoformat(), ln.tax_code)
                          for n, ln in enumerate(inv.lines, start=1)])
    conn.executemany("INSERT INTO payments VALUES (?,?,?,?,?,?)",
                     [(p.id, p.invoice_id, p.amount, p.status, p.attempted_at, p.gateway_ref)
                      for p in ledger.payments])


if __name__ == "__main__":
    main()
```

```bash
uv run python -m billsleuth.seed
```

```text
写入 100 个场景 → /…/billsleuth/billing.db,标准答案在 /…/billsleuth/scenarios/
```

生成的场景文件长这样(这是 S001,随机种子固定,你生成的应该一模一样):

```json
{
  "id": "S001",
  "customer_id": "C-0001",
  "as_of": "2026-10-15",
  "question": "我们早就申请取消订阅了,怎么 9 月还扣了 174.90 美元?",
  "truth": {
    "root_cause": "cancel_not_respected",
    "variant": "cancel_not_respected",
    "invoice_ids": ["INV-0001-05"],
    "overcharge": "174.90",
    "expected_action": "credit_note",
    "detail": "订阅已在 2026-09-25 到期取消,INV-0001-05 不应该开出"
  }
}
```

几个设计点:

**一个场景一个客户**。C-0001 到 C-0100,每个客户有自己的订阅和四五张发票,互不干扰。Agent 查 C-0007 的时候,看不到别的客户。

**客户的说法故意含糊**。`question()` 有 60% 的概率用和根因相关的说法(「卡上有两笔一样的扣款」),40% 用三句通用的抱怨(「这张发票金额 X,财务对不上账」)。通用说法不透露任何根因线索,Agent 只能自己去查。没错的场景也用同样的说法,所以 Agent 不能从措辞猜出「这单没错」。

**`truth` 里有 `root_cause` 也有 `variant`**。没错的场景 `root_cause` 都是 `no_error`,`variant` 记录是哪种「没错」(升级折算、税、优惠期结束、年费续费),错误分析时按 variant 分桶更有用。

**随机种子固定**。每个场景用 `Random(1000 + i)`,打乱顺序用 `Random(7)`。今天你生成的 S001 和我的一样,下周你改了 Agent 再跑评测,题目也一样。可复现是评测的前提。

**`scenarios/` 不能给 Agent 看**。标准答案和 Agent 的代码要严格隔离,Agent 唯一能接触的数据是 `billing.db`。Day 127 的评测框架会读标准答案,Agent 不会。

12 类故障的分布是前 8 类各 7 个、后 4 类各 6 个,加上 4 种「没错」各 5 个,一共 100 个:

```bash
uv run python -c "import json,glob,collections; print(collections.Counter(json.load(open(f))['truth']['variant'] for f in glob.glob('scenarios/*.json')))"
```

## 数据集自检

最后,也是今天最重要的测试。它对每一个场景做三件事:检查每张发票的行项目加起来等于总额;检查有错的场景多收金额大于 0、没错的场景等于 0;再用引擎从头重算一遍正确的账,和改坏的账对比,**差额必须分毫不差地等于标准答案**:

```python
# billsleuth/tests/test_faults.py
from decimal import Decimal

import pytest

from billsleuth.engine import build_invoices
from billsleuth.money import ZERO, money
from billsleuth.seed import AS_OF, make_scenario, scenario_kinds

CASES = list(enumerate(scenario_kinds(), start=1))


@pytest.mark.parametrize("i,kind", CASES, ids=[f"S{i:03d}-{k}" for i, k in CASES])
def test_every_scenario_is_consistent(i, kind):
    _, ledger, truth = make_scenario(i, kind)
    # 1. 不管改坏了什么,每张发票的行项目加起来必须等于总额(否则一眼就能看出是假数据)
    for inv in ledger.invoices:
        assert inv.total == money(inv.subtotal - inv.discount + inv.tax)
    # 2. 有错的场景,客户一定是多付了钱;没错的场景差额是 0
    if truth.root_cause == "no_error":
        assert truth.overcharge == ZERO and truth.expected_action == "explain_only"
    else:
        assert truth.overcharge > 0 and truth.expected_action == "credit_note"
    # 3. 用引擎重新算一遍正确的账,和改坏的账对比,差额必须正好等于标准答案
    correct = {inv.period_start: inv for inv in build_invoices(
        ledger.customer, ledger.sub, ledger.plans, ledger.coupon, ledger.rates, until=AS_OF)}
    target = next(inv for inv in ledger.invoices if inv.id == truth.invoice_ids[0])
    paid = sum((p.amount for p in ledger.payments if p.invoice_id == target.id), ZERO)
    is_extra = target.id.endswith("D") or target.period_start not in correct
    should_pay = ZERO if is_extra else correct[target.period_start].total
    assert money(paid - should_pay) == truth.overcharge


def test_seed_is_deterministic():
    a = [make_scenario(i, k)[2] for i, k in CASES[:10]]
    b = [make_scenario(i, k)[2] for i, k in CASES[:10]]
    assert [t.overcharge for t in a] == [t.overcharge for t in b]
    assert all(isinstance(t.overcharge, Decimal) for t in a)
```

```bash
uv run pytest -q
```

```text
……
110 passed
```

9 个引擎测试 + 100 个场景各一个 + 1 个可复现性测试,一共 110 个。注意这个测试的逻辑是独立于注入函数的:注入函数说「多收了 26.02」,测试不信它,自己拿引擎重算正确的总额,再拿客户实际付的钱去减,两边对上了才算数。这就是我前面说的,标准答案本身要经过验证。前面那个「先扣款后注入」的 bug,就是被这个测试抓到的。

## 这份数据集的局限

做评测的人要对自己的数据集诚实。这 100 个场景至少有三个和真实世界不一样的地方,我先写在这里,Day 127 的评测报告里也会写:

- **每个场景只有一个错误**。真实的账里可能同时有两个问题,或者一个问题引发连锁反应。
- **客户说法是模板生成的**。真实客户会说错月份、记错金额、把两件事混在一起说。Day 127 的模拟客户会补上这一块。
- **复算工具太强**。明天你会看到,`recompute_invoice` 几乎直接告诉 Agent 差了多少钱,这让很多场景变得简单。这是一个有意的选择,因为真实公司里也应该给 Agent 提供这样的工具,而不是让它自己算账;但评测分数会因此偏高,读分数的时候要记住这一点。

## 动手练习

1. 按文中顺序在你的 `billsleuth/` 仓库里建好这些文件:`money.py`、`schema.sql`、`db.py`、`engine.py`、`refdata.py`、`faults.py`、`seed.py`,以及 `tests/test_engine.py`、`tests/test_faults.py`。代码可以复制,但 `engine.py` 的 `build_invoices` 建议自己先敲一遍,敲的时候想清楚循环顺序。
2. 运行 `uv run pytest -q tests/test_engine.py`,全绿后再写注入和造数。
3. 运行 `uv run python -m billsleuth.seed`,然后用 `sqlite3 billing.db` 看一眼:`SELECT * FROM invoice_lines WHERE invoice_id = 'INV-0011-03';`,对照 `scenarios/S011.json` 的 detail,手算一遍为什么多了 26.02。
4. 运行 `uv run pytest -q`,确认 110 个测试全部通过。
5. **故意制造一次标准答案错误**:把 `seed.py` 里 `make_scenario` 中的 `ledger.pay_all()` 挪到注入函数之前,再跑测试,看自检测试抓到了多少个场景。看完改回来。
6. 选做:加第 13 类故障。比如「年付客户升级时折算按月付周期算」,或者「暂停期间仍然开票」。写注入函数、在 `seed.py` 里分配几个场景、让自检测试通过。

**验收标准**:110 个测试全绿;能讲清楚引擎循环里为什么事件处理放在最后;能手算出 S011 的 26.02 是怎么来的;第 5 步能看到自检测试大面积失败,并解释原因。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Decimal | Python 的十进制定点数,金额必须用它,不能用 float |
| ROUND_HALF_UP | 四舍五入;Decimal 默认是 ROUND_HALF_EVEN(银行家舍入) |
| 参考引擎 | 按公司对外承诺的计费规则算「应收」的代码,是标准答案的来源 |
| 事件回放 | 从开通事件起按时间顺序应用每个变更,得到任一时刻的订阅状态 |
| 不变量 invariant | 无论输入如何都必须成立的性质,比如行项目合计等于总额 |
| 故障注入 fault injection | 按真实 bug 的机制故意改坏数据,用来测试系统能否发现 |
| ground truth | 每个场景的标准答案:根因、发票、多收金额、期望动作 |
| 数据集自检 | 用独立于注入逻辑的方式验证标准答案本身正确 |
| 基于性质的测试 property-based testing | 随机生成大量输入,断言某个性质总成立,代表工具是 Hypothesis |

## 常见误区

**先四舍五入再相乘。** 每天单价先舍入到分,再乘天数,误差会被放大。整个算式算完,最后舍入一次。

**用订阅表的当前状态去算历史发票。** 当前是商业版不代表 7 月也是商业版。历史账单只能靠事件回放来算。

**故障注入只改总额。** 这样造出的账行项目对不上总额,Agent 找的是数据破绽而不是业务错误,评测分数毫无意义。

**标准答案不验证。** 注入函数自己算的差额也可能错。一定要有一个独立路径重算并对比,否则你会在错误的标准答案上调一周提示词。

**评测集随机生成,每次都不一样。** 种子不固定,今天和明天的分数不可比。所有随机都要固定种子。

**把引擎写得「通用」。** 参考引擎的目标是和你们公司的规则完全一致,不是覆盖所有计费系统的所有规则。规则以外的情况(比如月付改年付)直接报错,比默默算出一个数更安全。

## 学习资料

### 文档与文章

- [Python 文档 · decimal](https://docs.python.org/3/library/decimal.html):看 Quick-start 和 Rounding modes 两节,知道 `quantize` 和几种舍入方式,20 分钟。
- [Python 教程 · 浮点数算术:争议和限制](https://docs.python.org/3/tutorial/floatingpoint.html):为什么 0.1 + 0.2 不等于 0.3,10 分钟。
- [Python 文档 · zoneinfo](https://docs.python.org/3/library/zoneinfo.html):时区转换的标准做法,10 分钟。
- [Martin Fowler · Money](https://martinfowler.com/eaaCatalog/money.html):Money 模式的一页摘要,5 分钟。
- [Stripe · Prorations](https://docs.stripe.com/billing/subscriptions/prorations):对照我们的规则,看 Stripe 在哪些操作上默认折算,15 分钟。
- [Hypothesis 快速入门](https://hypothesis.readthedocs.io/en/latest/quickstart.html):想给引擎加性质测试的话从这里开始,30 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Le4y137gU&autoplay=0&high_quality=1" title="【计算机知识】定点数与浮点数(2)浮点数法表示方法!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>计算机知识星球 · 【计算机知识】定点数与浮点数(2)浮点数法表示方法! · 3 分钟,看懂浮点数在内存里怎么存,就明白为什么它表示不了 0.1。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1t7411a7bZ&autoplay=0&high_quality=1" title="Python中浮点数精度问题" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>时吉科技 · Python中浮点数精度问题 · 4 分钟,在 Python 里演示精度问题和 Decimal 的用法。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/0kzjD6jvfnk" title="Representing Monetary Values in Python" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>ArjanCodes · Representing Monetary Values in Python · 讲 float、int 分、Decimal 三种表示金额的方式各自的坑,和我们的选择一致。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/PZRI1IfStY0" title="Floating Point Numbers - Computerphile" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Computerphile · Floating Point Numbers - Computerphile · 经典科普,讲浮点数的设计取舍,适合想彻底弄懂的人。</figcaption>
</figure>

### 书籍

- Martin Fowler《Patterns of Enterprise Application Architecture》(Addison-Wesley, 2002):第 18 章 Base Patterns 的 Money 一节,重点看「分摊」(allocate)怎么处理除不尽的分,我们的引擎没做分摊,你可以想想多席位按比例分摊折扣时该怎么用。
- Eric Evans《Domain-Driven Design》(Addison-Wesley, 2003):第 5 章讲值对象(Value Object),`Line`、`TaxRate` 这类不可变的小对象就是值对象,读完能讲清楚为什么它们不该被到处修改。
- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly, 2017):第 11 章讲事件日志和由事件派生状态,对应我们「事件是事实、订阅表是快照」的设计。

### 开源项目与代码

- [py-moneyed/py-moneyed](https://github.com/py-moneyed/py-moneyed):Python 的 Money 类型实现,看它怎么把金额和币种绑在一起,15 分钟。
- [getlago/lago](https://github.com/getlago/lago):开源计费系统,找它处理按天折算的那部分代码,和我们的引擎对比一下规则差异。
- [killbill/killbill](https://github.com/killbill/killbill):老牌开源计费,文档里有大量订阅变更和账单的边界情况,写第 13 类故障时可以找灵感。

## 自测

1. `money(0.1)` 为什么要直接报错,而不是转成 `Decimal("0.1")`?

<details><summary>答案</summary>

因为 float 0.1 在传进来之前就已经不精确了,它的真实值是 0.1000000000000000055511151231257827……。悄悄转换会掩盖调用方的错误,让 float 在系统里继续流动。直接报错能让问题在第一次写错的地方暴露,调用方改成传字符串或 Decimal。

</details>

2. 39 美元的月费,31 天的周期,剩 10 天。先算日单价再乘天数,和一次算完再舍入,结果各是多少?

<details><summary>答案</summary>

先算日单价:39 / 31 = 1.258…,舍入成 1.26,乘 10 得 12.60。一次算完:39 × 10 / 31 = 12.580…,舍入得 12.58。差两分钱。正确做法是后者。

</details>

3. 引擎为什么从事件回放订阅状态,而不是直接读 subscriptions 表?

<details><summary>答案</summary>

subscriptions 表只存当前状态,而计费争议几乎都关于过去的发票。要知道 7 月那个周期的套餐和席位,只能从开通事件开始按时间应用每次变更。把开通也做成一个事件,引擎就只依赖事件这一个事实来源。

</details>

4. 为什么故障注入要「改行项目再重算折扣和税」,而不是直接改总额?

<details><summary>答案</summary>

直接改总额会让行项目合计和总额不一致,这在真实系统里不会出现,Agent 只要检查一下合计就能发现「被改过」,评测测的就不是业务理解了。按真实 bug 的机制改行项目,再让折扣和税跟着重算,错误和真实世界一样「自洽」,Agent 必须对照规则才能找出来。

</details>

5. 数据集自检测试为什么不直接相信注入函数返回的 overcharge?

<details><summary>答案</summary>

注入函数自己也可能有 bug,比如本文里「先扣款后注入」导致客户实付金额是正确金额。自检测试走一条独立的路径:用引擎从头重算正确的账,再用客户实际付款去减,结果必须等于标准答案。两条路径算出同一个数,标准答案才可信。

</details>

6. 资深面试题:你要给一个计费 Agent 做评测集,真实工单数据拿不到,只能合成。你怎么保证合成数据「有代表性」又「答案可靠」?

<details><summary>答案</summary>

答案可靠靠工程:用一个按公司规则写的参考引擎生成正确账目,按真实 bug 的机制注入错误,每个场景的标准答案用独立路径(引擎重算)验证,随机种子固定保证可复现。代表性靠和业务对齐:故障类别从真实工单的历史分类和事故复盘里来,按真实频率配比而不是平均分配;加入相当比例的「账没错」场景,并单独统计误冲正;客户说法要有含糊、错误和混杂的情况,可以用 LLM 模拟客户来产生。最后诚实写出局限(单一故障、说法模板化、工具强弱对难度的影响),并计划在上线后用真实工单的抽样标注来校准合成集的分数,看两者差多少。

</details>

## 明天预告

明天(Day 123)把今天的数据接到 Agent 能用的接口上:写 BillSleuth 的 MCP server,6 个只读查询工具、1 个调用参考引擎的复算工具 `recompute_invoice`、1 个只能生成草稿的 `draft_credit_note`,每次调用都写审计日志。最后用一个测试证明:对 100 个场景中的每一个,复算工具都能把标准答案里的多收金额算出来。
