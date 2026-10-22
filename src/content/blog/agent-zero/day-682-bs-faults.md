---
title: 'Day 682 · BillSleuth(三):故障注入、造数脚本和数据集自检'
description: '有了确定正确的参考引擎,今天造「确定错误」的账:先看偷懒改一个数会留下什么破绽,再写 12 个模仿真实 bug 的注入函数,每个改坏一处、让折扣和税跟着重算、返回标准答案;用固定种子一次造出 100 个争议场景写进 billing.db;最后写一个不相信注入函数、自己拿引擎重算的自检测试,故意把扣款挪到注入之前,80 个场景当场全红。'
pubDate: 2026-10-22
regime: none
tags: ['billsleuth', 'fault-injection', 'test-data', 'pytest', 'agent-zero']
series: 'agent-zero'
day: 682
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 681](/blog/agent-zero/day-681-bs-engine-2/) 写完了参考计费引擎:八个 dataclass、四个小工具、`apply_discount_and_tax` 先折扣后算税、`build_invoices` 一期一期往前走(先开本期的账,再处理本期里的事件,把折算留给下一张),还有回答「某一期应该是什么样」的 `expected_for_period`。八条规则测试的期望值全是手算的,我们故意换了一下循环顺序,四条当场变红。最后补了虚构的价目表和税率表 `refdata.py`。

引擎给的是「应该收多少」。可 BillSleuth 要调查的是「收错了」的账,评测要打分还得有标准答案。今天就做这两样:按真实 bug 的样子把正确的账改坏,一次造出 100 个争议场景,每个都带一份答案;再写一个测试证明这 100 份答案本身是对的。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清楚为什么故障注入要「按 bug 的机制改行项目,再让折扣和税跟着重算」,而不是直接改合计;用一条「税和自己的小计、税码对得上」的检查当场分辨两种改法。
2. 读懂并写出 12 个注入函数,每个返回一份标准答案(根因、涉及发票、多收金额、期望动作),知道哪几类改的是发票、哪几类多出一笔扣款或一张发票。
3. 用 `seed.py` 以固定随机种子造出 80 个有错、20 个没错的场景,写进 `billing.db`,标准答案写进 `scenarios/`,并说出为什么标准答案不能让 Agent 看到。
4. 写出数据集自检测试:不信注入函数算的差额,自己用引擎重算再拿客户实付去减,100 个场景分毫不差;并亲眼看到「先扣款后注入」这个 bug 让 80 个场景全部失败。

预计用时 3 小时。前置:[Day 681](/blog/agent-zero/day-681-bs-engine-2/)(引擎和 `refdata.py`)、[Day 680](/blog/agent-zero/day-680-bs-engine-1/)(`db.py`、十张表)、[Day 679](/blog/agent-zero/day-679-bs-prd/)(13 类根因)、[Day 351](/blog/agent-zero/day-351-synthetic-data/)(合成数据)、[Day 350](/blog/agent-zero/day-350-judge-code/)(期望值从哪来)、[Day 112](/blog/agent-zero/day-112-sampling-2/)(种子和可复现)、[Day 73](/blog/agent-zero/day-073-pytest-3/)(parametrize)。今天不调模型,花费 0 元。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `Ledger`、`Truth` 两个类和 `test_every_scenario_is_consistent` 的三步检查默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 今天的流水线

先看全貌。每个场景走同一条路:引擎算出正确的账,注入函数改坏一处并写下答案,再按改坏后的金额扣款,最后写进库。右边那条虚线是自检:它不看注入函数写的答案是怎么算出来的,自己从头再算一遍,两边对上才算数。

<figure>
<svg viewBox="0 0 640 290" role="img" aria-label="造数流水线:参考引擎生成正确的账,注入函数改坏一处并返回标准答案,pay_all 按改坏后的金额扣款,写入 billing.db 和 scenarios;自检测试用引擎独立重算,和客户实付相减,必须等于标准答案">
  <rect x="0" y="0" width="640" height="290" fill="var(--paper-raised)" rx="6"/>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="16" y="30" width="120" height="54" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="76" y="52" text-anchor="middle" fill="var(--compute)">build_invoices</text>
    <text x="76" y="70" text-anchor="middle" fill="var(--compute)">正确的账</text>
    <line x1="136" y1="57" x2="164" y2="57" stroke="var(--ink-soft)"/>
    <polygon points="164,53 172,57 164,61" fill="var(--ink-soft)"/>
    <rect x="174" y="30" width="130" height="54" rx="4" fill="none" stroke="var(--ink-soft)"/>
    <text x="239" y="52" text-anchor="middle" fill="var(--ink)">注入函数</text>
    <text x="239" y="70" text-anchor="middle" fill="var(--ink-soft)">改坏一处 + Truth</text>
    <line x1="304" y1="57" x2="332" y2="57" stroke="var(--ink-soft)"/>
    <polygon points="332,53 340,57 332,61" fill="var(--ink-soft)"/>
    <rect x="342" y="30" width="120" height="54" rx="4" fill="none" stroke="var(--ink-soft)"/>
    <text x="402" y="52" text-anchor="middle" fill="var(--ink)">pay_all()</text>
    <text x="402" y="70" text-anchor="middle" fill="var(--ink-soft)">按改坏后的扣款</text>
    <line x1="462" y1="57" x2="490" y2="57" stroke="var(--ink-soft)"/>
    <polygon points="490,53 498,57 490,61" fill="var(--ink-soft)"/>
    <rect x="500" y="20" width="124" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="562" y="42" text-anchor="middle" fill="var(--mem)">billing.db</text>
    <rect x="500" y="62" width="124" height="34" rx="4" fill="none" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
    <text x="562" y="84" text-anchor="middle" fill="var(--ink)">scenarios/*.json</text>
    <text x="500" y="114" fill="var(--ink-faint)">Agent 只能读上面那个</text>
    <rect x="174" y="160" width="290" height="96" rx="4" fill="none" stroke="var(--compute)" stroke-dasharray="5 3"/>
    <text x="319" y="182" text-anchor="middle" fill="var(--compute)">自检(tests/test_faults.py)</text>
    <text x="188" y="204" fill="var(--ink-soft)">1 每张发票的税和自己的小计对得上</text>
    <text x="188" y="224" fill="var(--ink-soft)">2 有错的多收 &gt; 0,没错的等于 0</text>
    <text x="188" y="244" fill="var(--ink-soft)">3 实付 − 引擎重算的应收 == 答案</text>
    <line x1="76" y1="84" x2="76" y2="208" stroke="var(--compute)" stroke-dasharray="3 3"/>
    <line x1="76" y1="208" x2="174" y2="208" stroke="var(--compute)" stroke-dasharray="3 3"/>
    <text x="20" y="226" fill="var(--compute)">独立重算一遍</text>
    <line x1="402" y1="84" x2="402" y2="160" stroke="var(--ink-soft)" stroke-dasharray="3 3"/>
    <text x="408" y="130" fill="var(--ink-faint)">实付</text>
  </g>
</svg>
<figcaption>注入函数和自检走两条独立的路算同一个数。今天最重要的不是注入函数本身,而是最下面那个框:它证明 100 份标准答案都是对的。</figcaption>
</figure>

为什么要这么讲究?说一句我自己的经验:做 Agent 项目,很多人数据随手造几条就开始调提示词。在计费这类场景里,**数据和标准答案的质量决定了后面所有评测数字的上限**。答案本身错了,你会花一下午怀疑 Agent,最后发现是题目出错了。[Day 350](/blog/agent-zero/day-350-judge-code/) 讲判题器时说过「期望值从哪来」,今天就是给 BillSleuth 做这件事。

## 第一步:账本和标准答案的形状

注入函数要改的是「一个场景里的全部账」:客户、订阅、发票、扣款。先把这些装进一个 `Ledger`,再定义标准答案 `Truth`。新建 `billsleuth/faults.py`,第一部分:

```python
# billsleuth/billsleuth/faults.py  12 类故障注入:拿一份正确的账,按真实 bug 的方式改坏一处,返回标准答案
import copy
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
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
    """一个场景里的全部账:客户、订阅、发票、扣款。注入函数直接改它。"""
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
        """每张发票按(可能已被改坏的)合计扣款成功一次,再加上注入函数造的额外扣款。注入之后再调用。"""
        self.payments = [Payment(inv.id.replace("INV", "PAY"), inv.id, inv.total, "succeeded",
                                 f"{inv.issued_at.isoformat()}T02:00:00+00:00", f"gw_{inv.id[4:].replace('-', '')}")
                         for inv in self.invoices] + self.extra_payments


@dataclass
class Truth:
    root_cause: str
    invoice_ids: list[str]
    overcharge: Decimal  # 客户多付的钱(含税),没错就是 0
    expected_action: str  # credit_note | explain_only
    detail: str  # 给人看的一句话


def refinalize(inv: Invoice, ledger: Ledger, drop_coupon: bool = False, tax: TaxRate | None = None) -> None:
    """改了行项目以后,去掉旧的折扣行和税行,重新算一遍。"""
    inv.lines = [ln for ln in inv.lines if ln.kind not in ("discount", "tax")]
    coupon = None if drop_coupon else ledger.coupon
    apply_discount_and_tax(inv, coupon, ledger.months_in(inv), tax or ledger.rate(inv))


def invoice_after_event(ledger: Ledger, event_type: str) -> Invoice:
    """事件所在周期的下一张发票:折算行就记在这张上。"""
    ev = next(e for e in ledger.sub.events if e.type == event_type)
    d = local_date(ev.effective_at, ledger.customer.country)
    for i, inv in enumerate(ledger.invoices):
        if inv.period_start <= d < inv.period_end:
            return ledger.invoices[i + 1]
    raise LookupError("事件之后没有发票")


def overcharge(before: Decimal, inv: Invoice) -> Decimal:
    return money(inv.total - before)
```

<div class="line-notes">

- `import copy` 标准库,`copy.deepcopy` 能把一张发票连同它的行项目整个复制一份,复制品怎么改都不影响原件。相当于 JS 的 `structuredClone`。重复开票那类故障要用。
- `import re` 正则表达式,改折算行的描述文字时用。
- `from billsleuth.engine import (` 引擎的数据类和小工具全拿过来。注入函数不自己发明规则,改坏以后重算折扣和税也用引擎的 `apply_discount_and_tax`。
- `ROOT_CAUSES = {` Day 679 的 13 个根因,从 `scratch/guess_root_cause.py` 挪进正式代码,顺序一样,每个配一句中文说明。12 个是故障,最后一个 `no_error` 是「账没错,客户误解」。Agent 结论里的 `root_cause` 字段只能从这里取值。
- `class Payment:` 一笔扣款。字段和 Day 680 的 `payments` 表一样。引擎只管发票不管扣款,所以这个类放在这里。
- `class Ledger:` 一个场景的全部账。注入函数直接改它里面的发票和扣款。
- `extra_payments: list[Payment] = field(default_factory=list)` 注入函数造出来的「多扣的那一笔」先放这里,等 `pay_all` 一起处理。为什么不直接放进 `payments`,后面第四步会看到一个真实的坑。
- `def rate(self, inv: Invoice) -> TaxRate:` 这张发票「应该」用的税率。注入函数改坏税以后,自检要靠它知道正确的是哪条。
- `def months_in(self, inv: Invoice) -> int:` 这张发票是开通后第几个月,判断优惠券有没有过期用。
- `def pay_all(self) -> None:` 给每张发票扣一次款,金额是发票的合计,也就是**改坏之后**的合计。客户真金白银付出去的,就是那个错的数。
- `self.payments = [Payment(inv.id.replace("INV", "PAY"), inv.id, inv.total, "succeeded",` 扣款编号把 `INV` 换成 `PAY`,一张发票对应一笔。
- `f"{inv.issued_at.isoformat()}T02:00:00+00:00", f"gw_{inv.id[4:].replace('-', '')}")` 扣款时间统一是开票日 UTC 凌晨 2 点;网关流水号是 `gw_` 加发票号里的数字,`INV-0011-03` 变成 `gw_001103`。`inv.id[4:]` 是从第 5 个字符开始截取,相当于 JS 的 `.slice(4)`。
- `for inv in self.invoices] + self.extra_payments` 列表推导式生成的扣款,再拼上额外的那几笔。
- `class Truth:` 标准答案。五个字段:根因、涉及哪张发票、多收多少(含税)、期望 Agent 做什么、一句给人看的说明。
- `expected_action: str  # credit_note | explain_only` 有错的应该起草贷记单,没错的只需要解释清楚。Day 679 的验收指标「误冲正率」就是拿这一列判的。
- `def refinalize(inv: Invoice, ledger: Ledger, drop_coupon: bool = False, tax: TaxRate | None = None) -> None:` 改完行项目以后「重新结账」:删掉旧的折扣行和税行,再调一次引擎的 `apply_discount_and_tax`。两个可选参数是给另外两类故障留的口子:`drop_coupon=True` 表示这次不给折扣,`tax` 传一个错的税率。
- `inv.lines = [ln for ln in inv.lines if ln.kind not in ("discount", "tax")]` 留下订阅费、折算、调整这几类,其余去掉。
- `apply_discount_and_tax(inv, coupon, ledger.months_in(inv), tax or ledger.rate(inv))` `tax or ledger.rate(inv)` 没传错税率就用正确的,和 JS 的 `tax || ...` 一样。
- `def invoice_after_event(ledger: Ledger, event_type: str) -> Invoice:` 找到「某个事件之后的那张发票」。升级发生在 7 月那期,折算记在 8 月那张上,和折算有关的故障都要改那一张。
- `d = local_date(ev.effective_at, ledger.customer.country)` 和引擎一样先换成客户本地日期,不然会找错发票。
- `return ledger.invoices[i + 1]` 事件所在那一期的下一张。`enumerate` 同时给出下标和元素,相当于 JS 的 `entries()`。
- `def overcharge(before: Decimal, inv: Invoice) -> Decimal:` 多收 = 改之后的合计 − 改之前的合计。

</div>

### 偷懒的改法会留下破绽

造错账有两种做法。偷懒的做法是挑一张发票,把订阅费加 10 块钱,完事。先搭一份正确的账来试(Day 681 那个客户,不过这次升级发生在上海 7 月 20 日凌晨 0:30,落在 31 天的周期里,后面几个注入函数要用到这两个细节):

```python
# billsleuth/scratch/demo_ledger.py  一份手搭的正确账本:团队版 3 席,上海 7 月 20 日凌晨升级到商业版
from datetime import date, datetime

from billsleuth.engine import Customer, Event, Subscription, build_invoices
from billsleuth.faults import Ledger
from billsleuth.refdata import COUPONS, PLANS, TAX_RATES


def demo_ledger(coupon_id: str | None = None) -> Ledger:
    cn = Customer("C-0001", "青禾记账工作室", "CN", "USD", "CN")
    events = [Event("E1", "create", datetime.fromisoformat("2026-06-05T10:00:00+08:00"), {"plan_id": "team", "quantity": 3}),
              Event("E2", "upgrade", datetime.fromisoformat("2026-07-20T00:30:00+08:00"), {"plan_id": "business"})]
    sub = Subscription("SUB-0001", cn.id, date(2026, 6, 5), 5, coupon_id, events)
    coupon = COUPONS.get(coupon_id or "")
    invoices = build_invoices(cn, sub, PLANS, coupon, TAX_RATES, until=date(2026, 9, 5))
    return Ledger(cn, sub, PLANS, coupon, TAX_RATES, invoices)
```

<div class="line-notes">

- `def demo_ledger(coupon_id: str | None = None) -> Ledger:` 每调用一次返回一份全新的、正确的账,各个实验互不干扰。
- `Event("E2", "upgrade", datetime.fromisoformat("2026-07-20T00:30:00+08:00"), {"plan_id": "business"})` 上海 7 月 20 日 0:30 升级,换成 UTC 是 7 月 19 日 16:30,日期差了一天。
- `coupon = COUPONS.get(coupon_id or "")` 没传券就是 None。
- `invoices = build_invoices(cn, sub, PLANS, coupon, TAX_RATES, until=date(2026, 9, 5))` 四期:6 月、7 月、8 月、9 月。折算记在 8 月 5 日那张上。

</div>

```python
# billsleuth/scratch/lazy_fault.py  偷懒的改法和像样的改法,各留下什么痕迹
from billsleuth.engine import Invoice
from billsleuth.faults import refinalize
from billsleuth.money import money
from scratch.demo_ledger import demo_ledger


def looks_real(inv: Invoice, rates: dict) -> bool:
    """税和它自己的小计、折扣、税码对得上吗?"""
    tax_line = next(ln for ln in inv.lines if ln.kind == "tax")
    return inv.tax == money((inv.subtotal - inv.discount) * rates[tax_line.tax_code])


ledger = demo_ledger()
rates = {r.code: r.rate for r in ledger.rates}
inv = ledger.invoices[-1]
print("正确的账:", inv.id, inv.subtotal, inv.tax, inv.total, "像真的吗", looks_real(inv, rates))

rec = next(ln for ln in inv.lines if ln.kind == "recurring")
rec.amount += 10  # 偷懒:订阅费直接加 10,别的不管
print("偷懒改法:", inv.id, inv.subtotal, inv.tax, inv.total, "像真的吗", looks_real(inv, rates))

refinalize(inv, ledger)  # 按规则重算折扣和税
print("重算之后:", inv.id, inv.subtotal, inv.tax, inv.total, "像真的吗", looks_real(inv, rates))
```

<div class="line-notes">

- `from scratch.demo_ledger import demo_ledger` 草稿之间也能互相 import,前提是在仓库根目录用 `-m` 跑。
- `def looks_real(inv: Invoice, rates: dict) -> bool:` 一个很朴素的检查:按这张发票自己的税码查税率,用它自己的小计和折扣重算一遍税,和发票上的税比。真实系统开出来的发票,不管规则对不对,这一条一定成立,因为税总是按当时的小计算的。
- `tax_line = next(ln for ln in inv.lines if ln.kind == "tax")` 找到税行,读它的税码。
- `rates = {r.code: r.rate for r in ledger.rates}` 税码 → 税率的字典。
- `rec.amount += 10  # 偷懒:订阅费直接加 10,别的不管` Decimal 加整数没问题。改的是行项目,合计会跟着变,但税行没动。
- `refinalize(inv, ledger)  # 按规则重算折扣和税` 上面写的重新结账。

</div>

```bash
uv run python -m scratch.lazy_fault
```

```text
正确的账: INV-0001-04 267.00 16.02 283.02 像真的吗 True
偷懒改法: INV-0001-04 277.00 16.02 293.02 像真的吗 False
重算之后: INV-0001-04 277.00 16.62 293.62 像真的吗 True
```

偷懒改完,小计变成 277.00,税还是 16.02,而 277 × 6% 应该是 16.62。任何一个会算账的人(包括 Agent)只要顺手验一下税,就知道「这张发票被人动过」。它找到的是**数据里的破绽**,不是业务上的错误,评测分数就没有意义了。真实世界的 bug 从来不会这样:系统按错的单价开了订阅费,税一定是按错的小计算的,整张发票自洽。

重新结账以后税变成 16.62,`looks_real` 又成立了。好的注入方式就是这样:**模仿真实 bug 产生错误的机制,改行项目,再让折扣和税照常流过**。错误和真实世界一样自洽,Agent 必须对照规则才能找出来。

## 第二步:12 个注入函数

12 类故障按「改了哪里」分成五组。每个函数都是同一个套路:找到要改的那张发票,记下改之前的合计,按某个 bug 的逻辑改,`refinalize` 重新结账,用「改之后 − 改之前」得到多收的钱,连同根因、发票号、期望动作装进 `Truth` 返回。

### 折算类:分母、退还行、时区

```python
# ---------- 折算类:分母、退还行、时区 ----------

def _change_config(ledger: Ledger, ev_type: str) -> tuple[Decimal, Decimal, date, Invoice]:
    """回放事件,拿到改动前后的整期金额、本地生效日,和记折算的那张发票。"""
    events = sorted(ledger.sub.events, key=lambda e: e.effective_at)
    plan, qty = ledger.plans[events[0].payload["plan_id"]], int(events[0].payload["quantity"])
    for ev in events[1:]:
        new_plan = ledger.plans[ev.payload.get("plan_id", plan.id)]
        new_qty = int(ev.payload.get("quantity", qty))
        if ev.type == ev_type:
            d = local_date(ev.effective_at, ledger.customer.country)
            inv = invoice_after_event(ledger, ev_type)
            return money(plan.unit_price * qty), money(new_plan.unit_price * new_qty), d, inv
        plan, qty = new_plan, new_qty
    raise LookupError(ev_type)


def _rewrite_proration(inv: Invoice, old_full: Decimal, new_full: Decimal, days_left: int, denom: int,
                       start: date) -> None:
    """按给定的剩余天数和分母,重写这张发票上的两条折算行。"""
    for ln in inv.lines:
        if ln.kind == "proration":
            amt = prorate(new_full if ln.amount > 0 else old_full, days_left, denom)
            ln.amount = ln.unit_amount = amt if ln.amount > 0 else -amt
            ln.description = re.sub(r"\d{4}-\d{2}-\d{2} 至", f"{start} 至", ln.description)
            ln.period_start = start


def proration_wrong_days(ledger: Ledger) -> Truth:
    old_full, new_full, d, inv = _change_config(ledger, "upgrade")
    prev = ledger.invoices[ledger.invoices.index(inv) - 1]
    real_days = (prev.period_end - prev.period_start).days
    before = inv.total
    _rewrite_proration(inv, old_full, new_full, (prev.period_end - d).days, 30, d)  # 分母写死 30
    refinalize(inv, ledger)
    return Truth("proration_wrong_days", [inv.id], overcharge(before, inv), "credit_note",
                 f"{prev.period_start} 开始的周期有 {real_days} 天,折算却按 30 天算")


def proration_missing_credit(ledger: Ledger) -> Truth:
    inv = invoice_after_event(ledger, "upgrade")
    before = inv.total
    inv.lines = [ln for ln in inv.lines if not (ln.kind == "proration" and ln.amount < 0)]
    refinalize(inv, ledger)
    return Truth("proration_missing_credit", [inv.id], overcharge(before, inv), "credit_note",
                 "升级后的发票只收了新套餐剩余天数,没有退还旧套餐未使用的天数")


def timezone_change_date(ledger: Ledger) -> Truth:
    old_full, new_full, d, inv = _change_config(ledger, "upgrade")
    prev = ledger.invoices[ledger.invoices.index(inv) - 1]
    days = (prev.period_end - prev.period_start).days
    utc_day = d - timedelta(days=1)  # 系统按 UTC 日期算,早了一天
    before = inv.total
    _rewrite_proration(inv, old_full, new_full, (prev.period_end - utc_day).days, days, utc_day)
    refinalize(inv, ledger)
    return Truth("timezone_change_date", [inv.id], overcharge(before, inv), "credit_note",
                 f"改套餐发生在本地时间 {d} 凌晨,系统按 UTC 日期算成 {utc_day},折算多算一天")
```

<div class="line-notes">

- `def _change_config(ledger: Ledger, ev_type: str) -> tuple[Decimal, Decimal, date, Invoice]:` 折算类故障都要知道:改动前后的整期金额、事件的本地日期、折算记在哪张发票上。返回值是四个东西的元组,调用方用解包接。名字前的下划线表示内部用。
- `plan, qty = ledger.plans[events[0].payload["plan_id"]], int(events[0].payload["quantity"])` 排序后第一条是开通事件,从它取初始套餐和席位。
- `new_plan = ledger.plans[ev.payload.get("plan_id", plan.id)]` 和引擎一样用「只覆盖带了的字段」的方式回放。
- `if ev.type == ev_type:` 回放到要找的那条事件,返回它前后两个配置。
- `def _rewrite_proration(inv: Invoice, old_full: Decimal, new_full: Decimal, days_left: int, denom: int,` 按「错的」剩余天数和分母,把两条折算行重写一遍。
- `amt = prorate(new_full if ln.amount > 0 else old_full, days_left, denom)` 正数那行(收新套餐)用新的整期金额,负数那行(退旧套餐)用旧的。
- `ln.amount = ln.unit_amount = amt if ln.amount > 0 else -amt` 连续赋值,两个字段同一个值。注意右边的 `ln.amount > 0` 读的还是改之前的值,所以正负号能保持。
- `ln.description = re.sub(r"\d{4}-\d{2}-\d{2} 至", f"{start} 至", ln.description)` 描述里写着「(2026-07-20 至 2026-08-05)」,把起始日期换成错的那个。`\d{4}` 是四个数字。描述和金额必须一起改,不然 Agent 一看描述的天数和金额对不上,又是一个破绽。
- `_rewrite_proration(inv, old_full, new_full, (prev.period_end - d).days, 30, d)  # 分母写死 30` Day 677 那个经典 bug:剩余天数对,分母写死 30。
- `f"{prev.period_start} 开始的周期有 {real_days} 天,折算却按 30 天算")` detail 写给看评测报告的人,不给 Agent 看。
- `inv.lines = [ln for ln in inv.lines if not (ln.kind == "proration" and ln.amount < 0)]` 升级时漏了退还行:把负数的折算行删掉,只收新套餐剩余天数。
- `utc_day = d - timedelta(days=1)  # 系统按 UTC 日期算,早了一天` 时区 bug:系统直接取 UTC 日期。东八区凌晨的事件,UTC 还是前一天。这个注入函数只对凌晨发生的事件成立,所以造数时会专门把这类场景的升级时间放在凌晨。
- `_rewrite_proration(inv, old_full, new_full, (prev.period_end - utc_day).days, days, utc_day)` 分母是对的,剩余天数多了一天,起始日也写成了早一天。

</div>

### 扣款和开票类:多扣一笔、多开一张、取消后还开

这三类不改已有发票的金额,而是多出一样东西,所以多收的钱就是多出来那一整笔。

```python
# ---------- 扣款和开票类:多扣一笔、多开一张、取消后还开 ----------

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


def cancel_not_respected(ledger: Ledger) -> Truth:
    last = ledger.invoices[-1]
    step = 12 if ledger.plans[_current_plan(ledger)].interval == "year" else 1
    extra = copy.deepcopy(last)
    extra.id = last.id[:-2] + f"{int(last.id[-2:]) + 1:02d}"
    extra.period_start, extra.issued_at = last.period_end, last.period_end
    extra.period_end = add_months(last.period_end, step, ledger.sub.billing_anchor_day)
    extra.lines = [ln for ln in extra.lines if ln.kind == "recurring"]
    for ln in extra.lines:
        ln.period_start, ln.period_end = extra.period_start, extra.period_end
    refinalize(extra, ledger)
    ledger.invoices.append(extra)
    return Truth("cancel_not_respected", [extra.id], extra.total, "credit_note",
                 f"订阅已在 {last.period_end} 到期取消,{extra.id} 不应该开出")


def _current_plan(ledger: Ledger) -> str:
    plan = ""
    for e in sorted(ledger.sub.events, key=lambda e: e.effective_at):
        plan = e.payload.get("plan_id", plan)
    return plan
```

<div class="line-notes">

- `inv = ledger.invoices[-2]` 挑倒数第二张。不挑最后一张,是因为最后一张常常被别的规则用(比如税率变化),错开更像真的。
- `ledger.extra_payments.append(Payment(inv.id.replace("INV", "PAY") + "-R", inv.id, inv.total, "succeeded",` 同一张发票再成功扣一次,编号加 `-R`(retry,网关重试),3 分钟后,流水号不同。重复扣款在真实系统里最常见的来源就是超时重试没做幂等,[Day 390](/blog/agent-zero/day-390-idempotency/) 讲过。
- `return Truth("duplicate_charge", [inv.id], inv.total, "credit_note",` 发票本身没错,多收的就是一整张发票的钱。
- `dup = copy.deepcopy(inv)` 整张发票复制一份。只用 `copy.copy` 的话,两张发票会共用同一个 `lines` 列表,改一张另一张也变。
- `dup.id = inv.id + "D"` 多出来的发票号加个 D,`INV-0023-04D`。Day 683 工具参数的正则要允许这个结尾。
- `ledger.invoices.insert(ledger.invoices.index(inv) + 1, dup)` 插在原件后面,`insert(位置, 元素)` 相当于 JS 的 `splice(i, 0, x)`。
- `step = 12 if ledger.plans[_current_plan(ledger)].interval == "year" else 1` 取消后还开票:按当前套餐的周期长度,在最后一张后面再补一期。
- `extra.id = last.id[:-2] + f"{int(last.id[-2:]) + 1:02d}"` 发票号的最后两位加一,`INV-0001-04` 变成 `INV-0001-05`,看起来就是系统正常开的下一张。
- `extra.lines = [ln for ln in extra.lines if ln.kind == "recurring"]` 只留订阅费,折算行不该被复制过去。
- `refinalize(extra, ledger)` 按这一期的月份重新算券和税。
- `def _current_plan(ledger: Ledger) -> str:` 回放全部事件,得到最新的套餐 id。

</div>

### 税、优惠券、席位和单价

```python
# ---------- 税类:过期税率、别的地区 ----------

def expired_tax_rate(ledger: Ledger) -> Truth:
    inv = ledger.invoices[-1]
    current = ledger.rate(inv)
    old = next(r for r in ledger.rates if r.region == current.region and r.valid_to is not None
               and r.valid_to < inv.period_start)
    before = inv.total
    refinalize(inv, ledger, tax=old)
    return Truth("expired_tax_rate", [inv.id], overcharge(before, inv), "credit_note",
                 f"{inv.id} 用了 {old.valid_to} 就已失效的 {old.code},应该用 {current.code}")


def wrong_tax_region(ledger: Ledger) -> Truth:
    inv = ledger.invoices[-1]
    current = ledger.rate(inv)
    wrong = max((r for r in ledger.rates if r.region != current.region and r.valid_to is None), key=lambda r: r.rate)
    before = inv.total
    refinalize(inv, ledger, tax=wrong)
    return Truth("wrong_tax_region", [inv.id], overcharge(before, inv), "credit_note",
                 f"客户税务地区是 {current.region},发票却用了 {wrong.code}")


# ---------- 优惠券类:没抵扣、基数错 ----------

def coupon_not_applied(ledger: Ledger) -> Truth:
    assert ledger.coupon is not None
    inv = next(i for i in ledger.invoices if 0 < ledger.months_in(i) < ledger.coupon.duration_months)
    before = inv.total
    refinalize(inv, ledger, drop_coupon=True)
    return Truth("coupon_not_applied", [inv.id], overcharge(before, inv), "credit_note",
                 f"{ledger.coupon.id} 还在有效期内,{inv.id} 却没有抵扣")


def coupon_wrong_base(ledger: Ledger) -> Truth:
    coupon = ledger.coupon
    assert coupon is not None and coupon.kind == "percent"
    inv = invoice_after_event(ledger, "upgrade")
    before = inv.total
    inv.lines = [ln for ln in inv.lines if ln.kind not in ("discount", "tax")]
    recurring = money(sum((ln.amount for ln in inv.lines if ln.kind == "recurring"), ZERO))
    off = money(recurring * coupon.value / 100)  # bug:只按订阅费那一行算
    inv.lines.append(Line("discount", f"优惠券 {coupon.id}(-{coupon.value}%)", 1, -off, -off))
    tax = ledger.rate(inv)
    t = money((inv.subtotal - inv.discount) * tax.rate)
    inv.lines.append(Line("tax", f"税 {tax.code}({(tax.rate * 100).normalize():f}%)", 1, t, t, tax_code=tax.code))
    return Truth("coupon_wrong_base", [inv.id], overcharge(before, inv), "credit_note",
                 "百分比优惠券应该按小计(含折算)抵扣,系统只按订阅费那一行算")


# ---------- 席位和单价 ----------

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
    return Truth("quantity_change_ignored", [inv.id], overcharge(before, inv), "credit_note",
                 f"席位已从 {old_qty} 调到 {ev.payload['quantity']},{inv.id} 仍按 {old_qty} 席位收费且没有折算")


def wrong_plan_price(ledger: Ledger) -> Truth:
    inv = ledger.invoices[-1]
    before = inv.total
    for ln in inv.lines:
        if ln.kind == "recurring":
            ln.unit_amount = money(ln.unit_amount + Decimal("6.00"))
            ln.amount = money(ln.unit_amount * ln.quantity)
    refinalize(inv, ledger)
    return Truth("wrong_plan_price", [inv.id], overcharge(before, inv), "credit_note",
                 "订阅费单价比价目表每席位多了 6.00")


def no_error(invoice: Invoice, detail: str) -> Truth:
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

<div class="line-notes">

- `old = next(r for r in ledger.rates if r.region == current.region and r.valid_to is not None` 过期税率:同一地区、已经过期的那条。只有 US 有这种「降税」的历史,所以造数时这类场景只给美国客户。
- `refinalize(inv, ledger, tax=old)` 用旧税率重新结账,税码也跟着写成旧的。
- `wrong = max((r for r in ledger.rates if r.region != current.region and r.valid_to is None), key=lambda r: r.rate)` 别的地区里税率最高的那条(DE 19%),这样客户一定多付。`max(..., key=...)` 按税率比大小,相当于 JS 里用 `reduce` 找最大。
- `inv = next(i for i in ledger.invoices if 0 < ledger.months_in(i) < ledger.coupon.duration_months)` 券没抵扣:找一张还在有效期内、但不是第一个月的发票。第一个月一般不会出错,真实的 bug 多半出在续费那一刻。
- `refinalize(inv, ledger, drop_coupon=True)` 这次结账不给折扣。
- `assert coupon is not None and coupon.kind == "percent"` 这类故障只对百分比券有意义。`assert` 在这里是给自己的保险:造数时配错了券,立刻炸,不会造出一个答案是 0 的「故障」。
- `off = money(recurring * coupon.value / 100)  # bug:只按订阅费那一行算` Day 681 规则五说百分比券作用在整个小计上(包括折算),这个 bug 只按订阅费算,升级那个月折算是正数,折扣就少了。
- `inv.lines.append(Line("tax", f"税 {tax.code}({(tax.rate * 100).normalize():f}%)"` 这里没用 `refinalize`,因为折扣是故意算错的,只能手工补税行。税仍然按「小计 − 错的折扣」算,保持自洽。
- `old_qty = next(int(e.payload["quantity"]) for e in ledger.sub.events if e.type == "create")` 减席位没生效:按开通时的席位继续收。
- `inv.lines = [ln for ln in inv.lines if ln.kind != "proration"]` 席位改动没被系统看到,自然也没有折算行。
- `ln.description = ln.description.split(" × ")[0] + f" × {old_qty} 席位"` 描述里的席位数也改回旧的,「团队版 × 5 席位」变「团队版 × 8 席位」。
- `ln.unit_amount = money(ln.unit_amount + Decimal("6.00"))` 单价不对:每席位多收 6 美元,比如价目表没同步。
- `def no_error(invoice: Invoice, detail: str) -> Truth:` 没错的场景也要有答案:多收 0,期望动作是解释。
- `INJECTORS = {` 根因名 → 注入函数的字典。造数脚本按名字查,加一类新故障只要在这里登记。字典的顺序就是写入的顺序,造数时按这个顺序轮流分配。

</div>

在 `demo_ledger` 上逐个试一下(过期税率只对美国客户成立,这里跳过):

```python
# billsleuth/scratch/try_faults.py  在同一份正确的账上,逐个试注入函数
from billsleuth.faults import INJECTORS
from scratch.demo_ledger import demo_ledger

for name in ["wrong_plan_price", "proration_wrong_days", "proration_missing_credit", "timezone_change_date",
             "duplicate_charge", "duplicate_invoice", "wrong_tax_region"]:
    ledger = demo_ledger()
    before = {i.id: i.total for i in ledger.invoices}
    truth = INJECTORS[name](ledger)
    ledger.pay_all()
    inv = next(i for i in ledger.invoices if i.id == truth.invoice_ids[0])
    paid = sum(p.amount for p in ledger.payments if p.invoice_id == inv.id)
    print(f"{name:<25} {inv.id:<13} 原来 {before.get(inv.id, '无'):>7}  现在 {inv.total:>7}  "
          f"实付 {paid:>7}  多收 {truth.overcharge:>6}")
```

<div class="line-notes">

- `before = {i.id: i.total for i in ledger.invoices}` 改之前每张发票的合计,字典推导式。
- `truth = INJECTORS[name](ledger)` 按名字查到函数再调用,函数在 Python 里也是普通的值,和 JS 一样。
- `ledger.pay_all()` 注入之后再扣款。
- `paid = sum(p.amount for p in ledger.payments if p.invoice_id == inv.id)` 这张发票一共扣了多少。
- `{before.get(inv.id, '无'):>7}` 多出来的发票(重复开票那张)改之前不存在,显示「无」。

</div>

```bash
uv run python -m scratch.try_faults
```

```text
wrong_plan_price          INV-0001-04   原来  283.02  现在  302.10  实付  302.10  多收  19.08
proration_wrong_days      INV-0001-03   原来  365.09  现在  367.82  实付  367.82  多收   2.73
proration_missing_credit  INV-0001-03   原来  365.09  现在  429.10  实付  429.10  多收  64.01
timezone_change_date      INV-0001-03   原来  365.09  现在  370.22  实付  370.22  多收   5.13
duplicate_charge          INV-0001-03   原来  365.09  现在  365.09  实付  730.18  多收 365.09
duplicate_invoice         INV-0001-03D  原来       无  现在  365.09  实付  365.09  多收 365.09
wrong_tax_region          INV-0001-04   原来  283.02  现在  317.73  实付  317.73  多收  34.71
```

挑两行手算对一下。`proration_wrong_days`:正确的折算是退 117 × 16 / 31 = 60.39、收 267 × 16 / 31 = 137.81;分母写死 30 变成退 62.40、收 142.40,净额从 77.42 变成 80.00,多 2.58,税跟着多 0.15(347.00 × 6% = 20.82,原来 20.67),合计多收 2.73。`timezone_change_date`:按 UTC 日期是 7 月 19 日,剩 17 天,退 64.16、收 146.42,净额多 4.84,税多 0.29,合计 5.13。

再看最后几列:重复扣款那张发票本身还是 365.09,但实付变成了 730.18;重复开票那张是新多出来的发票,改之前「无」。这两类如果 Agent 只盯着发票金额看,是看不出问题的,得去查扣款和同期的其他发票。明天的工具设计会专门照顾这两种情况。

## 第三步:造数脚本

注入函数有了,接下来要决定:造多少个场景、每类多少个、每个场景的客户长什么样、客户怎么开口。新建 `billsleuth/seed.py`,分三段看。

### 每个场景的客户和订阅

```python
# billsleuth/billsleuth/seed.py  造 100 个计费争议场景:引擎算正确的账 → 注入一类故障 → 写库,标准答案写 scenarios/
import json
import random
import sqlite3
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from billsleuth.db import ROOT, db_path, init_db
from billsleuth.engine import COUNTRY_TZ, Customer, Event, Subscription, add_months, build_invoices
from billsleuth.faults import INJECTORS, Ledger, Truth, no_error
from billsleuth.money import fmt
from billsleuth.refdata import COUPONS, PLANS, TAX_RATES

AS_OF = date(2026, 10, 15)
SCENARIO_DIR = ROOT / "scenarios"
NAMES = ["星河咨询", "Bluefin Labs", "青禾设计", "Northwind Studio", "鲸落科技", "Kestrel Analytics", "半山书局",
         "Helio Freight", "白桦会计", "Orchid Dental", "木棉旅行", "Quartz Legal", "知更教育", "Lumen Bakery"]

# 80 个有错 + 20 个没错。12 类故障轮流分配:前 8 类各 7 个,后 4 类各 6 个
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


def periods(start: date, anchor: int, step: int) -> list[tuple[date, date]]:
    out, ps = [], start
    while ps <= AS_OF:
        pe = add_months(ps, step, anchor)
        out.append((ps, pe))
        ps = pe
    return out


def event_at(rng: random.Random, period: tuple[date, date], country: str, early_morning: bool = False) -> datetime:
    """在某个周期中间随机挑一个本地时刻;early_morning=True 时挑凌晨 0–6 点。"""
    ps, pe = period
    d = ps + timedelta(days=rng.randint(2, (pe - ps).days - 3))
    hour = rng.randint(0, 6) if early_morning else rng.randint(9, 18)
    return datetime(d.year, d.month, d.day, hour, rng.choice([5, 20, 35, 50]), tzinfo=ZoneInfo(COUNTRY_TZ[country]))


def build_setup(i: int, kind: str, rng: random.Random) -> Setup:
    cid, sid = f"C-{i:04d}", f"SUB-{i:04d}"
    country = rng.choice(COUNTRIES_FOR.get(kind, ["CN", "SG", "DE", "US"]))
    customer = Customer(cid, f"{rng.choice(NAMES)}-{i:03d}", country, "USD", country)
    yearly = kind == "annual_renewal"
    if yearly:
        anchor = rng.randint(1, 14)  # 保证 2026 年 10 月的续费日在 AS_OF 之前
        start = date(2025, 10, anchor)
        plan_id = rng.choice(["team-y", "business-y"])
    else:
        anchor = rng.randint(1, 28)
        start = date(2026, rng.choice([5, 6]), anchor)
        plan_id = rng.choice(["starter", "team"])
    qty = rng.randint(3, 12)
    created = datetime(start.year, start.month, start.day, 10, 0, tzinfo=ZoneInfo(COUNTRY_TZ[country]))
    events = [Event(f"EV-{i:04d}-1", "create", created, {"plan_id": plan_id, "quantity": qty})]
    ps_list = periods(start, anchor, 12 if yearly else 1)

    def add(etype: str, period_idx: int, payload: dict, early: bool = False) -> None:
        ts = event_at(rng, ps_list[period_idx], country, early)
        events.append(Event(f"EV-{i:04d}-{len(events) + 1}", etype, ts, payload))

    if kind == "proration_wrong_days":
        j = next(j for j in range(len(ps_list) - 1) if (ps_list[j][1] - ps_list[j][0]).days == 31)
        add("upgrade", j, {"plan_id": "business"})
    elif kind in ("proration_missing_credit", "coupon_wrong_base", "upgrade_proration"):
        add("upgrade", 1, {"plan_id": "business"})
    elif kind == "timezone_change_date":
        add("upgrade", 1, {"plan_id": "business"}, early=True)
    elif kind == "quantity_change_ignored":
        add("quantity_change", 1, {"quantity": rng.randint(1, qty - 1)})
    elif kind == "cancel_not_respected":
        add("cancel", len(ps_list) - 2, {})

    if kind == "coupon_wrong_base":
        coupon_id = "SPRING15"
    elif kind in ("coupon_not_applied", "coupon_ended"):
        coupon_id = rng.choice(["WELCOME20", "LAUNCH10"])
    elif not yearly and rng.random() < 0.25:
        coupon_id = "LAUNCH10"  # 干扰项:有些客户本来就有优惠券
    else:
        coupon_id = None
    return Setup(customer, Subscription(sid, cid, start, anchor, coupon_id, events))
```

<div class="line-notes">

- `AS_OF = date(2026, 10, 15)` 「今天」是 2026 年 10 月 15 日,所有账算到这天为止。固定一个日期,不用 `date.today()`,不然明天再跑,每个客户都多一张发票,答案全变。
- `SCENARIO_DIR = ROOT / "scenarios"` 标准答案放在仓库根目录的 `scenarios/`,和 `billing.db` 分开。Day 679 的仓库结构图里画过。
- `NAMES = ["星河咨询", "Bluefin Labs"` 虚构的客户名,中英混着,和云簿的国际版客户一致。全部虚构,不对应任何真实公司。
- `FAULTY = [c for _ in range(7) for c in INJECTORS][:80]` 双层推导式:外层重复 7 次,内层遍历 12 个根因名,得到 84 个,截前 80 个。结果是前 8 类各 7 个、后 4 类各 6 个。相当于 JS 的 `Array(7).fill(names).flat().slice(0, 80)`。
- `BENIGN = ["upgrade_proration", "tax_line", "coupon_ended", "annual_renewal"] * 5` 20 个没错的场景,四种「客户以为错了其实没错」各 5 个:升级折算看不懂、多出来一行税、优惠期结束涨价了、年付一次扣一大笔。列表乘整数是重复拼接,和 JS 不一样,JS 里数组乘数字得到 NaN。
- `COUNTRIES_FOR = {` 有些故障只在特定国家成立:过期税率只有美国有降税历史;用错地区税率不能给德国客户(他本来就是 19%,换不出更高的);时区故障要东八区(UTC 比本地晚,凌晨的事件 UTC 才是前一天)。
- `def periods(start: date, anchor: int, step: int) -> list[tuple[date, date]]:` 先排出这个订阅到 AS_OF 为止的全部周期,挑事件时间用。和 Day 677 草稿里的 `periods` 是同一个东西。
- `def event_at(rng: random.Random, period: tuple[date, date], country: str, early_morning: bool = False) -> datetime:` 在某个周期中间随机挑一个客户本地时刻。
- `d = ps + timedelta(days=rng.randint(2, (pe - ps).days - 3))` 避开周期的头两天和最后三天,事件不会贴着边界,折算天数不会是 0 或 1 这种看不出问题的数。`randint(a, b)` 两头都包含。
- `hour = rng.randint(0, 6) if early_morning else rng.randint(9, 18)` 普通事件在白天,时区故障的事件在凌晨。
- `return datetime(d.year, d.month, d.day, hour, rng.choice([5, 20, 35, 50]), tzinfo=ZoneInfo(COUNTRY_TZ[country]))` 带客户时区的时刻。写库时再统一换成 UTC。
- `def build_setup(i: int, kind: str, rng: random.Random) -> Setup:` 给第 i 个场景搭客户和订阅。`kind` 是这个场景要埋的故障(或者哪种「没错」)。
- `cid, sid = f"C-{i:04d}", f"SUB-{i:04d}"` 一个场景一个客户,`C-0001` 到 `C-0100`,互不干扰。
- `country = rng.choice(COUNTRIES_FOR.get(kind, ["CN", "SG", "DE", "US"]))` 有限制就从限制里挑,没限制四国随机。
- `anchor = rng.randint(1, 14)  # 保证 2026 年 10 月的续费日在 AS_OF 之前` 年付场景从 2025 年 10 月开通,锚点日不超过 14,第二年的续费发票才会在 10 月 15 日之前开出来。
- `plan_id = rng.choice(["starter", "team"])` 月付只从便宜的两档开始,后面升级到商业版,折算一定是正的。
- `def add(etype: str, period_idx: int, payload: dict, early: bool = False) -> None:` 函数里面再定义一个函数,叫嵌套函数,它能直接用外面的 `events`、`rng`、`ps_list`、`country`,相当于 JS 里的闭包。
- `events.append(Event(f"EV-{i:04d}-{len(events) + 1}", etype, ts, payload))` 事件编号 `EV-0011-2`,第几个事件就是几。
- `j = next(j for j in range(len(ps_list) - 1) if (ps_list[j][1] - ps_list[j][0]).days == 31)` 分母写死 30 的故障,必须放进 31 天的周期,30 天的周期里这个 bug 不产生任何差额。练习 4 会实测三种长度的周期。
- `add("upgrade", 1, {"plan_id": "business"})` 在第 2 期(下标 1)中间升级。
- `add("quantity_change", 1, {"quantity": rng.randint(1, qty - 1)})` 减席位,新席位数比原来少。
- `add("cancel", len(ps_list) - 2, {})` 在倒数第二期申请取消,这样「取消后还开的那一期」正好在 AS_OF 之前。
- `coupon_id = "SPRING15"` 券算错基数的场景用 6 个月的百分比券,升级那个月券还有效。
- `coupon_id = "LAUNCH10"  # 干扰项:有些客户本来就有优惠券` 25% 的普通客户也带一张券。不加这个,Agent 会学到「有券的场景一定是券的问题」。

</div>

### 客户怎么开口,没错的场景怎么写答案

```python
def question(kind: str, truth: Truth, ledger: Ledger, rng: random.Random) -> str:
    inv = next(x for x in ledger.invoices if x.id == truth.invoice_ids[0])
    m, total = f"{inv.issued_at.month} 月", fmt(inv.total)
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
        return no_error(inv, "升级后的折算是对的:先退旧套餐未使用天数,再收新套餐剩余天数")
    if kind == "coupon_ended":
        assert ledger.coupon is not None
        inv = next(x for x in invs if ledger.months_in(x) == ledger.coupon.duration_months)
        return no_error(inv, f"{ledger.coupon.id} 只抵扣前 {ledger.coupon.duration_months} 个月,已按期结束")
    if kind == "annual_renewal":
        return no_error(invs[-1], "年付订阅到期自动续费,金额正确")
    return no_error(invs[-1], "多出来的是税,按客户所在地区的有效税率计算,正确")


def scenario_kinds() -> list[str]:
    kinds = FAULTY + BENIGN
    random.Random(7).shuffle(kinds)
    return kinds


def make_scenario(i: int, kind: str) -> tuple[random.Random, Ledger, Truth]:
    """第 i 个场景:正确的账 → 注入故障 → 标准答案。纯内存,不碰数据库,方便测试。"""
    rng = random.Random(1000 + i)
    s = build_setup(i, kind, rng)
    coupon = COUPONS.get(s.sub.coupon_id or "")
    invoices = build_invoices(s.customer, s.sub, PLANS, coupon, TAX_RATES, until=AS_OF)
    ledger = Ledger(s.customer, s.sub, PLANS, coupon, TAX_RATES, invoices)
    truth = INJECTORS[kind](ledger) if kind in INJECTORS else benign_truth(kind, ledger)
    ledger.pay_all()  # 先改坏账,再按改坏后的金额扣款:客户真金白银付的就是错的数
    return rng, ledger, truth
```

<div class="line-notes">

- `def question(kind: str, truth: Truth, ledger: Ledger, rng: random.Random) -> str:` 生成客户的原话。只用账上能看到的信息(月份、金额),不透露根因。
- `m, total = f"{inv.issued_at.month} 月", fmt(inv.total)` 金额用 `fmt` 格式化成两位小数的字符串。
- `generic = [` 三句通用的抱怨,哪种根因都可能这么说。Day 679 的实验已经证明:同一句话背后可能是好几种根因,也可能没错。
- `special = {` 和根因相关的说法,比如「卡上有两笔一样的扣款」。客户真的会这么说,这算客户给的线索。
- `if kind in special and (kind not in INJECTORS or rng.random() < 0.6):` 有专门说法的故障,60% 用专门说法、40% 用通用说法;没错的场景总是用专门说法(它们本来就是客户「看不懂」才来问的)。`rng.random()` 返回 0 到 1 之间的小数。
- `def benign_truth(kind: str, ledger: Ledger) -> Truth:` 四种没错的场景,各自挑一张客户会来问的发票。
- `inv = next(x for x in invs if any(ln.kind == "proration" for ln in x.lines))` 升级折算:挑第一张带折算行的发票。`any(...)` 只要有一个为真就是真,相当于 JS 的 `.some()`。
- `inv = next(x for x in invs if ledger.months_in(x) == ledger.coupon.duration_months)` 优惠期结束:券过期后的第一张,也就是「突然涨价」那张。
- `def scenario_kinds() -> list[str]:` 100 个场景各自埋什么。
- `random.Random(7).shuffle(kinds)` 用固定种子打乱顺序,有错没错混在一起。`shuffle` 原地打乱,不返回新列表。
- `def make_scenario(i: int, kind: str) -> tuple[random.Random, Ledger, Truth]:` 第 i 个场景:搭订阅 → 引擎算正确的账 → 注入 → 扣款。**全在内存里,不碰数据库**,所以测试可以直接调它,一秒跑完 100 个。
- `rng = random.Random(1000 + i)` 每个场景自己一个随机数生成器,种子是 1000 + i。好处是改了第 50 个场景的造法,其他 99 个完全不受影响。
- `truth = INJECTORS[kind](ledger) if kind in INJECTORS else benign_truth(kind, ledger)` 有错就注入,没错就直接写答案。
- `ledger.pay_all()  # 先改坏账,再按改坏后的金额扣款` 这一行的位置是今天最重要的一个细节,第四步专门演示放错位置会怎样。

</div>

### 写进库

```python
def utc_iso(local: datetime) -> str:
    return local.astimezone(timezone.utc).isoformat()


def write_ledger(conn: sqlite3.Connection, ledger: Ledger) -> None:
    c, s = ledger.customer, ledger.sub
    conn.execute("INSERT INTO customers VALUES (?,?,?,?,?)", (c.id, c.name, c.country, c.currency, c.tax_region))
    # subscriptions 表存快照:回放全部事件得到当前套餐、席位和状态
    state: dict = {}
    status = "active"
    for e in sorted(s.events, key=lambda e: e.effective_at):
        state.update(e.payload)
        status = "canceled" if e.type == "cancel" else status
    last = max((i for i in ledger.invoices if not i.id.endswith("D")), key=lambda i: i.period_start)
    conn.execute("INSERT INTO subscriptions VALUES (?,?,?,?,?,?,?,?,?,?)",
                 (s.id, c.id, state["plan_id"], state["quantity"], status, s.start_date.isoformat(),
                  last.period_start.isoformat(), last.period_end.isoformat(), s.billing_anchor_day, s.coupon_id))
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
    kinds = scenario_kinds()
    for i, kind in enumerate(kinds, start=1):
        rng, ledger, truth = make_scenario(i, kind)
        write_ledger(conn, ledger)
        scenario = {
            "id": f"S{i:03d}", "customer_id": ledger.customer.id, "as_of": AS_OF.isoformat(),
            "question": question(kind, truth, ledger, rng),
            "truth": {"root_cause": truth.root_cause, "variant": kind, "invoice_ids": truth.invoice_ids,
                      "overcharge": fmt(truth.overcharge), "expected_action": truth.expected_action,
                      "detail": truth.detail},
        }
        (SCENARIO_DIR / f"S{i:03d}.json").write_text(json.dumps(scenario, ensure_ascii=False, indent=2) + "\n",
                                                    encoding="utf-8")
    conn.commit()
    print(f"写入 {len(kinds)} 个场景 → {db_path().name},标准答案在 {SCENARIO_DIR.name}/")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `return local.astimezone(timezone.utc).isoformat()` 事件时间换成 UTC 再存,Day 680 的规矩。
- `def write_ledger(conn: sqlite3.Connection, ledger: Ledger) -> None:` 一个场景的账写进十张表里的五张。
- `state: dict = {}` 订阅表存的是快照,要回放全部事件才知道「现在」是什么套餐、几个席位,和 Day 680 的 `state_at` 一模一样。
- `status = "canceled" if e.type == "cancel" else status` 有取消事件,状态就是 canceled。
- `last = max((i for i in ledger.invoices if not i.id.endswith("D")), key=lambda i: i.period_start)` 最新一张正常发票的周期,就是订阅表的「当前周期」。重复开票那张不算。
- `(e.id, s.id, e.type, utc_iso(e.effective_at), json.dumps(e.payload))` 事件存 UTC 字符串,payload 存 JSON 字符串。
- `inv.period_end.isoformat(), inv.issued_at.isoformat(), inv.status, inv.subtotal,` 日期转 ISO 字符串;金额直接传 Decimal,Day 680 的 `db.py` 注册了 adapter,会自动存成字符串。
- `[(f"{inv.id}-L{n}", inv.id, ln.kind, ln.description, ln.quantity, ln.unit_amount,` 行项目编号 `INV-0011-03-L1`,`enumerate(..., start=1)` 让 n 从 1 开始。
- `ln.amount, ln.period_start and ln.period_start.isoformat(),` `x and x.isoformat()` 是 Python 的短路写法:x 是 None 就得到 None,不是就得到字符串。相当于 JS 的 `x && x.toISOString()`,或者 `x?.toISOString()`。
- `for f in SCENARIO_DIR.glob("S*.json"):` 先删掉旧的标准答案,保证目录里只有这次生成的。
- `conn = init_db(db_path())` Day 680 的 `init_db` 会删库重建,所以造数脚本跑一次就是一份全新的库。
- `conn.executemany("INSERT INTO plans VALUES (?,?,?,?)",` 价目表、优惠券、税率也写进库。Day 683 的复算工具要从库里读它们。
- `r.valid_to and r.valid_to.isoformat())` 没有结束日就存 NULL。
- `"question": question(kind, truth, ledger, rng),` 场景文件里有客户原话,这是评测时喂给 Agent 的;`truth` 部分 Agent 看不到。
- `"truth": {"root_cause": truth.root_cause, "variant": kind,` 根因之外再存一个 `variant`。没错的场景根因都是 `no_error`,variant 记的是哪一种「没错」,Day 695 做错误分析时按它分桶更有用。
- `"overcharge": fmt(truth.overcharge),` 金额存字符串,JSON 里不出现浮点数。
- `json.dumps(scenario, ensure_ascii=False, indent=2) + "\n",` `ensure_ascii=False` 让中文原样写出,不变成 `你` 这种转义;`indent=2` 缩进,方便人看。[Day 39](/blog/agent-zero/day-039-json/) 讲过。
- `conn.commit()` 最后提交一次。一百个场景、一千多行插入放在一个事务里,快,而且要么全成功要么全没写。

</div>

```bash
uv run python -m billsleuth.seed
cat scenarios/S001.json
```

<div class="line-notes">

- `uv run python -m billsleuth.seed` `seed.py` 在包里,import 了兄弟模块,用 `-m` 按模块名跑。
- `cat scenarios/S001.json` 看第一份标准答案。

</div>

```text
写入 100 个场景 → billing.db,标准答案在 scenarios/
{
  "id": "S001",
  "customer_id": "C-0001",
  "as_of": "2026-10-15",
  "question": "我们早就申请取消订阅了,怎么 9 月还扣了 174.90 美元?",
  "truth": {
    "root_cause": "cancel_not_respected",
    "variant": "cancel_not_respected",
    "invoice_ids": [
      "INV-0001-05"
    ],
    "overcharge": "174.90",
    "expected_action": "credit_note",
    "detail": "订阅已在 2026-09-25 到期取消,INV-0001-05 不应该开出"
  }
}
```

S001 的客户说「早就申请取消了,怎么 9 月还扣了 174.90」。随机种子固定,你生成的 S001 应该和我的一字不差。看看每类各有几个、每张表写了多少行:

```bash
uv run python -c "import json,glob,collections; print(sorted(collections.Counter(json.load(open(f))['truth']['variant'] for f in glob.glob('scenarios/*.json')).items()))"
for t in customers subscription_events invoices invoice_lines payments; do echo "$t $(sqlite3 billing.db "SELECT COUNT(*) FROM $t")"; done
```

<div class="line-notes">

- `collections.Counter(` 数每个值出现了几次,相当于 JS 里用 `reduce` 攒一个计数对象。`glob.glob('scenarios/*.json')` 列出匹配的文件。
- `for t in customers subscription_events` shell 的 for 循环:`t` 依次取后面五个表名,`do` 和 `done` 之间的命令各跑一遍,相当于 JS 的 `for (const t of [...])`。`$(...)` 把命令的输出嵌进字符串。

</div>

```text
[('annual_renewal', 5), ('cancel_not_respected', 6), ('coupon_ended', 5), ('coupon_not_applied', 7), ('coupon_wrong_base', 7), ('duplicate_charge', 7), ('duplicate_invoice', 7), ('expired_tax_rate', 7), ('proration_missing_credit', 7), ('proration_wrong_days', 7), ('quantity_change_ignored', 6), ('tax_line', 5), ('timezone_change_date', 6), ('upgrade_proration', 5), ('wrong_plan_price', 6), ('wrong_tax_region', 7)]
customers 100
subscription_events 144
invoices 497
invoice_lines 1166
payments 504
```

前 8 类各 7 个、后 4 类各 6 个、四种「没错」各 5 个,一共 100。100 个客户、497 张发票、504 笔扣款,扣款比发票多 7 笔,正好是 7 个重复扣款场景。

几个设计点,写在这里,面试时都会被问到:

**标准答案不能给 Agent 看**。Agent 的工具只能读 `billing.db`,读不到 `scenarios/`。不然评测就成了开卷考试。

**客户的说法故意含糊**。40% 的故障场景用通用说法,没错的场景也有专门说法,Agent 不能从措辞猜出「这单没错」。

**随机种子固定**。每个场景 `Random(1000 + i)`,打乱用 `Random(7)`。今天的 S001 和下周的 S001 一样,改了 Agent 以后再跑评测,题目没变,分数才能比。

## 第四步:数据集自检

最后,也是今天最重要的测试。它对每个场景做三件事:

1. 每张发票的税,都要和它自己的小计、折扣、税码对得上。这就是第一步 `looks_real` 那条检查,防的是「偷懒改法」漏进数据集。
2. 有错的场景客户一定多付了钱,没错的场景差额是 0。
3. 用引擎**重新**算一遍正确的账,拿客户实际付的钱去减,必须正好等于标准答案。

第 3 条是关键:注入函数说「多收了 26.02」,测试不信它,走一条完全独立的路自己算。

```python
# billsleuth/tests/test_faults.py  数据集自检:不信注入函数,自己拿引擎重算,差额必须分毫不差
from decimal import Decimal

import pytest

from billsleuth.engine import build_invoices
from billsleuth.money import ZERO, money
from billsleuth.seed import AS_OF, make_scenario, scenario_kinds

CASES = list(enumerate(scenario_kinds(), start=1))


@pytest.mark.parametrize(("i", "kind"), CASES, ids=[f"S{i:03d}-{k}" for i, k in CASES])
def test_every_scenario_is_consistent(i, kind):
    _, ledger, truth = make_scenario(i, kind)
    # 1. 不管改坏了什么,每张发票的税都要和它自己的小计、折扣、税码对得上,否则一眼就能看出是假数据
    rates = {r.code: r.rate for r in ledger.rates}
    for inv in ledger.invoices:
        tax_line = next(ln for ln in inv.lines if ln.kind == "tax")
        assert tax_line.tax_code is not None
        assert inv.tax == money((inv.subtotal - inv.discount) * rates[tax_line.tax_code])
    # 2. 有错的场景客户一定多付了钱,没错的场景差额是 0
    if truth.root_cause == "no_error":
        assert truth.overcharge == ZERO and truth.expected_action == "explain_only"
    else:
        assert truth.overcharge > 0 and truth.expected_action == "credit_note"
    # 3. 用引擎重新算一遍正确的账,拿客户实际付的钱去减,必须正好等于标准答案
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

<div class="line-notes">

- `CASES = list(enumerate(scenario_kinds(), start=1))` `[(1, "cancel_not_respected"), (2, ...), ...]`,100 个(编号, 种类)。
- `@pytest.mark.parametrize(("i", "kind"), CASES, ids=[f"S{i:03d}-{k}" for i, k in CASES])` 一个测试函数展开成 100 条。`ids` 给每条起名,失败时直接看到 `S011-timezone_change_date`。
- `_, ledger, truth = make_scenario(i, kind)` 直接调内存版的造数函数,不读库。`_` 表示这个返回值用不到。
- `rates = {r.code: r.rate for r in ledger.rates}` 税码 → 税率。
- `assert tax_line.tax_code is not None` 告诉类型检查器这里一定有税码,下一行查字典才不会画红线。
- `assert inv.tax == money((inv.subtotal - inv.discount) * rates[tax_line.tax_code])` 检查一。注意用的是发票**自己**的税码,不是正确的税码:用错税率的发票,只要税是按那个错税率算的,就是「自洽」的,这正是我们想要的。
- `assert truth.overcharge > 0 and truth.expected_action == "credit_note"` 检查二。练习 4 会看到,要是把分母写死 30 的故障放进 30 天的周期,这一条就会失败。
- `correct = {inv.period_start: inv for inv in build_invoices(` 检查三的第一半:用引擎从头算正确的账,按周期开始日做成字典。这里用的是 `ledger.sub` 里没被改过的事件,注入函数只改发票和扣款,不改事件。
- `target = next(inv for inv in ledger.invoices if inv.id == truth.invoice_ids[0])` 答案说的那张发票。
- `paid = sum((p.amount for p in ledger.payments if p.invoice_id == target.id), ZERO)` 客户为这张发票实际付了多少,重复扣款的场景这里是两笔之和。
- `is_extra = target.id.endswith("D") or target.period_start not in correct` 这张发票本来就不该存在吗?重复开票那张(以 D 结尾)、取消后多开的那期(引擎算出来没有这一期),应付都是 0。
- `assert money(paid - should_pay) == truth.overcharge` 检查三:实付 − 应付 == 答案。
- `def test_seed_is_deterministic():` 同样的输入跑两次,答案一样,而且是 Decimal 不是 float。

</div>

```bash
uv run pytest tests/test_faults.py -v
```

```text
tests/test_faults.py::test_every_scenario_is_consistent[S001-cancel_not_respected] PASSED [  0%]
tests/test_faults.py::test_every_scenario_is_consistent[S002-proration_missing_credit] PASSED [  1%]
tests/test_faults.py::test_every_scenario_is_consistent[S003-annual_renewal] PASSED [  2%]
tests/test_faults.py::test_every_scenario_is_consistent[S004-upgrade_proration] PASSED [  3%]
tests/test_faults.py::test_every_scenario_is_consistent[S099-coupon_wrong_base] PASSED [ 98%]
tests/test_faults.py::test_every_scenario_is_consistent[S100-wrong_tax_region] PASSED [ 99%]
tests/test_faults.py::test_seed_is_deterministic PASSED                  [100%]
============================= 101 passed in 0.29s ==============================
```

(中间 94 行省略。)100 个场景加一条可复现性测试,101 条全绿,0.27 秒。现在 `uv run pytest` 一共 125 条:Day 680 的 13 条、Day 681 的 8 条和练习里的 3 条,加上今天 101 条。

顺便说一个我改过的地方。旧版本的检查一写的是「合计 = 小计 − 折扣 + 税」,Day 681 练习 4 讲过,这条在内存里永远成立,因为四个数都是从同一批行项目加出来的,它测不出任何东西。换成「税和自己的小计对得上」以后,第一步那种偷懒改法才会被抓到。写检查的时候要问自己一句:**这条检查有没有可能失败?** 不可能失败的检查只会给人虚假的安全感。

### 故意先扣款再注入

现在制造一次标准答案错误。把 `make_scenario` 里的 `ledger.pay_all()` 挪到注入那一行的上面:

```python
    ledger = Ledger(s.customer, s.sub, PLANS, coupon, TAX_RATES, invoices)
    ledger.pay_all()  # 故意挪到注入之前
    truth = INJECTORS[kind](ledger) if kind in INJECTORS else benign_truth(kind, ledger)
```

<div class="line-notes">

- `ledger.pay_all()  # 故意挪到注入之前` 看起来很合理:先把账「结清」,再去改。

</div>

```bash
uv run pytest -q tests/test_faults.py
```

```text
FAILED tests/test_faults.py::test_every_scenario_is_consistent[S099-coupon_wrong_base]
FAILED tests/test_faults.py::test_every_scenario_is_consistent[S100-wrong_tax_region]
80 failed, 21 passed in 0.58s
```

80 个有错的场景全部失败,20 个没错的场景加可复现性测试通过。看 S011 那条的报错:

```text
E       AssertionError: assert Decimal('0.00') == Decimal('26.02')
E        +  where Decimal('0.00') = money((Decimal('1412.42') - Decimal('1412.42')))
```

客户实付 1412.42,正好等于正确的应收。也就是说,扣款是按**改坏之前**的正确金额扣的:发票上写着多收了 26.02,客户实际一分没多付。这在现实里不可能发生,扣款一定按发票金额扣。重复扣款、重复开票、取消后还开这三类更惨:多扣的那一笔放在 `extra_payments` 里,`pay_all` 已经执行过了,根本没被加进去;多出来的发票也没人给它扣款。

如果没有这个自检,会发生什么?Agent 在这 80 个场景里调用扣款查询,看到的扣款和发票对不上,会被引向完全错误的方向,而我会以为是 Agent 不行,去改提示词。看完把 `pay_all()` 挪回注入之后,101 条全绿。

## 这份数据集的局限

做评测的人要对自己的数据集诚实。这 100 个场景至少有三处和真实世界不一样,先写在这里,Day 694 的评测报告里也会写:

- **每个场景只有一个错误**。真实的账里可能同时有两个问题,或者一个问题引发连锁反应(单价错了,税也跟着错)。
- **客户说法是模板生成的**。真实客户会说错月份、记错金额、把两件事混在一起说。Day 693 的模拟客户会补上这一块。
- **复算工具太强**。明天你会看到,`recompute_invoice` 几乎直接告诉 Agent 差了多少钱,这让很多场景变得简单。这是有意的选择,真实公司里也应该给 Agent 这样的工具,而不是让它自己算账;但评测分数会因此偏高,读分数时要记住。

还有一个工程上的限制:Day 681 练习 4 发现引擎会开出负数发票,造数时只造升级和小幅减席位,绕开了这种情况。

## 今天的文件

| 零件 | 文件 | 新建还是修改 | 后面哪天用到 |
| --- | --- | --- | --- |
| 13 个根因、账本、答案、重新结账 | `billsleuth/faults.py` 第一部分 | 新建 | Day 686 结论结构,Day 694 判分 |
| 12 个注入函数和 `INJECTORS` | `faults.py` 后面几段 | 新建 | 加新故障时 |
| 造数脚本 | `billsleuth/seed.py` | 新建 | Day 683 测试,Day 693 评测 |
| 100 份标准答案 | `scenarios/S001.json` … `S100.json` | 生成 | Day 683 可解性测试,Day 694 判分 |
| 计费库 | `billing.db` | 生成(`.gitignore` 里) | 全程 |
| 数据集自检 | `tests/test_faults.py` | 新建 | 每次改引擎或注入函数 |
| 草稿 | `scratch/demo_ledger.py`、`lazy_fault.py`、`try_faults.py` | 新建 | |

`scenarios/` 要不要提交进 git?要。它是造数脚本的输出,本来随时能重新生成,但评测报告引用的是具体的 S011、S023,提交进去以后,别人不跑脚本也能看懂报告。`billing.db` 不提交,它大,而且一条命令就能生成。今天不调模型,花费 0 元。

## 动手练习

**练习 1:手算 S011。** 用 `sqlite3` 查出 `INV-0011-03` 的四行和 `SUB-0011` 的两条事件,手算出标准答案里的 26.02 是怎么来的。

<details><summary>参考答案</summary>

```bash
sqlite3 billing.db "SELECT kind, amount, description FROM invoice_lines WHERE invoice_id = 'INV-0011-03'"
sqlite3 billing.db "SELECT type, effective_at, payload_json FROM subscription_events WHERE subscription_id = 'SUB-0011'"
sqlite3 billing.db "SELECT country, tax_region FROM customers WHERE id = 'C-0011'"
```

<div class="line-notes">

- `sqlite3 billing.db "SELECT kind, amount, description FROM invoice_lines` 命令行版的 sqlite3,[Day 85](/blog/agent-zero/day-085-sql-1/) 起一直在用。macOS 自带。

</div>

```text
proration|-87.10|未使用时间退还:入门版 × 10(2026-07-14 至 2026-08-01)
proration|516.77|剩余时间:商业版 × 10(2026-07-14 至 2026-08-01)
recurring|890.00|商业版 × 10 席位
tax|118.77|税 SG-GST9(9%)
create|2026-06-01T02:00:00+00:00|{"plan_id": "starter", "quantity": 10}
upgrade|2026-07-14T22:50:00+00:00|{"plan_id": "business"}
SG|SG
```

新加坡客户,入门版 10 席(150/月)升级到商业版 10 席(890/月)。升级时间 UTC 7 月 14 日 22:50,新加坡是 UTC+8,本地是 7 月 15 日 06:50。周期 7 月 1 日到 8 月 1 日,31 天。

正确的算法从 7 月 15 日起剩 17 天:退 150 × 17 / 31 = 82.258…,舍入 82.26;收 890 × 17 / 31 = 488.064…,舍入 488.06;折算净额 405.80。小计 405.80 + 890 = 1295.80,税 9% 是 116.622,舍入 116.62,合计 1412.42。

发票上的折算行写着从 7 月 14 日起,也就是按 UTC 日期算,剩 18 天:退 150 × 18 / 31 = 87.10,收 890 × 18 / 31 = 516.77,净额 429.67,比正确的多 23.87;税 1319.67 × 9% = 118.77,多 2.15;合计 1438.44,多收 26.02。破绽只有一处:折算行描述里的起始日(7 月 14 日)和事件的本地日期(7 月 15 日)差了一天。

</details>

**练习 2:从库里读回来再体检一遍。** 内存里的自检测的是 `make_scenario`;但 Agent 读的是 `billing.db`,写库那一步也可能出错。写 `scripts/check_dataset.py`:读库,检查每张发票表头的合计、折扣、税和行项目对得上;数一数扣了两次的发票、同一周期有两张发票的订阅;确认每份标准答案里的发票都在库里。然后复制一份库,用 SQL 偷偷改一张发票的表头合计,看它能不能抓到。

<details><summary>参考答案</summary>

```python
# billsleuth/scripts/check_dataset.py  练习 2:从 billing.db 读回来再体检一遍,和内存里的自检互相印证
import json
import sys
from collections import Counter
from decimal import Decimal
from pathlib import Path

from billsleuth.db import connect, db_path
from billsleuth.money import ZERO, money
from billsleuth.seed import SCENARIO_DIR


def dsum(values) -> Decimal:
    return money(sum((Decimal(v) for v in values), ZERO))


conn = connect(Path(sys.argv[1]) if len(sys.argv) > 1 else db_path())
problems: list[str] = []
for inv in conn.execute("SELECT * FROM invoices"):
    lines = conn.execute("SELECT kind, amount FROM invoice_lines WHERE invoice_id = ?", (inv["id"],)).fetchall()
    by = {k: dsum(r["amount"] for r in lines if r["kind"] == k) for k in ("discount", "tax")}
    if Decimal(inv["total"]) != dsum(r["amount"] for r in lines):
        problems.append(f"{inv['id']} 表头合计 {inv['total']} ≠ 行项目之和 {dsum(r['amount'] for r in lines)}")
    if Decimal(inv["discount"]) != -by["discount"] or Decimal(inv["tax"]) != by["tax"]:
        problems.append(f"{inv['id']} 表头折扣或税和行项目对不上")

double_paid = conn.execute("SELECT invoice_id FROM payments WHERE status = 'succeeded'"
                           " GROUP BY invoice_id HAVING COUNT(*) > 1").fetchall()
same_period = conn.execute("SELECT subscription_id, period_start FROM invoices"
                           " GROUP BY subscription_id, period_start HAVING COUNT(*) > 1").fetchall()
truths = [json.loads(p.read_text(encoding="utf-8"))["truth"] for p in sorted(SCENARIO_DIR.glob("S*.json"))]
missing = [t["invoice_ids"][0] for t in truths
           if not conn.execute("SELECT 1 FROM invoices WHERE id = ?", (t["invoice_ids"][0],)).fetchone()]

print(f"发票 {conn.execute('SELECT COUNT(*) FROM invoices').fetchone()[0]} 张,表头和行项目对不上的 {len(problems)} 张")
for p in problems[:5]:
    print("  ", p)
print(f"扣了两次的发票 {len(double_paid)} 张,同周期两张发票的订阅 {len(same_period)} 个")
print("标准答案里的动作:", dict(Counter(t["expected_action"] for t in truths)), " 找不到发票的答案:", missing or "无")
```

<div class="line-notes">

- `def dsum(values) -> Decimal:` 一组字符串金额转 Decimal 求和。Day 680 讲过不能用 SQL 的 SUM 算钱。
- `conn = connect(Path(sys.argv[1]) if len(sys.argv) > 1 else db_path())` 命令行给了路径就检查那个库,没给就检查默认的 `billing.db`。`sys.argv` 是命令行参数列表,[Day 44](/blog/agent-zero/day-044-notebook-project/) 用过。
- `if Decimal(inv["total"]) != dsum(r["amount"] for r in lines):` 表头合计和行项目之和比。内存里这一条永远成立,但写进库以后表头是单独一列,有人直接 UPDATE 这一列就会对不上。
- `if Decimal(inv["discount"]) != -by["discount"] or Decimal(inv["tax"]) != by["tax"]:` 折扣表头是正数、折扣行是负数,取个负号再比。
- `" GROUP BY invoice_id HAVING COUNT(*) > 1"` 按发票分组,只留成功扣款超过一笔的。[Day 88](/blog/agent-zero/day-088-sql-4/) 讲过 GROUP BY;`HAVING` 是对分组以后的结果再筛一遍,相当于分组版的 WHERE。这里只是数数,不算钱,用 SQL 没问题。
- `" GROUP BY subscription_id, period_start HAVING COUNT(*) > 1"` 同一订阅同一周期超过一张发票。
- `missing = [t["invoice_ids"][0] for t in truths` 答案里提到的发票在库里找不到,说明造数和写库对不上。
- `print("标准答案里的动作:", dict(Counter(t["expected_action"] for t in truths))` 有错 80、没错 20,和设计一致。

</div>

```bash
uv run python -m scripts.check_dataset
cp billing.db scratch/broken.db
sqlite3 scratch/broken.db "UPDATE invoices SET total = '134.90' WHERE id = 'INV-0001-04'"
uv run python -m scripts.check_dataset scratch/broken.db
```

<div class="line-notes">

- `uv run python -m scripts.check_dataset` `scripts/` 没有 `__init__.py` 也能用 `-m`,Day 680 讲过命名空间包。
- `sqlite3 scratch/broken.db "UPDATE invoices SET total = '134.90'` 在副本上偷偷把一张发票的合计改小 40,不动行项目。`*.db` 在 `.gitignore` 里,这个副本不会被提交。

</div>

```text
发票 497 张,表头和行项目对不上的 0 张
扣了两次的发票 7 张,同周期两张发票的订阅 7 个
标准答案里的动作: {'credit_note': 80, 'explain_only': 20}  找不到发票的答案: 无
发票 497 张,表头和行项目对不上的 1 张
   INV-0001-04 表头合计 134.90 ≠ 行项目之和 174.90
扣了两次的发票 7 张,同周期两张发票的订阅 7 个
标准答案里的动作: {'credit_note': 80, 'explain_only': 20}  找不到发票的答案: 无
```

正常的库:497 张全对上,扣了两次的 7 张(重复扣款场景)、同周期两张发票的 7 个(重复开票场景),和设计一致。改过的库立刻抓到那一张。两层自检互相印证:内存里那层证明「答案是对的」,库里这层证明「写进去的就是内存里那份」。

</details>

**练习 3:第 13 类故障。** 写一个「暂停期间仍然开票」的注入函数:订阅在某一期处于暂停,系统照样开了订阅费。先单独在一个手搭的订阅上验证,用和 `test_faults.py` 一样的方法自检。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex3_pause_fault.py  练习 3:第 13 类故障「暂停期间仍然开票」,先单独验证,不进 INJECTORS
import copy
from datetime import date, datetime

from billsleuth.engine import Customer, Event, Subscription, build_invoices
from billsleuth.faults import Ledger, Truth, refinalize
from billsleuth.money import ZERO, money
from billsleuth.refdata import PLANS, TAX_RATES


def pause_still_billed(ledger: Ledger, period_start: date) -> Truth:
    """暂停期间本不该开订阅费,系统照开:在这个周期补一张只有订阅费的发票。"""
    template = next(i for i in ledger.invoices if any(ln.kind == "recurring" for ln in i.lines))
    extra = copy.deepcopy(template)
    prev = max((i for i in ledger.invoices if i.period_start < period_start), key=lambda i: i.period_start)
    extra.id = prev.id[:-2] + f"{int(prev.id[-2:]) + 1:02d}"  # 正好是暂停时跳过的那个编号
    extra.period_start = extra.issued_at = period_start
    extra.period_end = next(i.period_start for i in ledger.invoices if i.period_start > period_start)
    extra.lines = [ln for ln in extra.lines if ln.kind == "recurring"]
    for ln in extra.lines:
        ln.period_start, ln.period_end = extra.period_start, extra.period_end
    refinalize(extra, ledger)
    ledger.invoices.append(extra)
    ledger.invoices.sort(key=lambda i: i.period_start)
    return Truth("pause_still_billed", [extra.id], extra.total, "credit_note",
                 f"订阅在 {period_start} 那个周期处于暂停,{extra.id} 不应该开出")


cn = Customer("C-0901", "白桦会计-901", "CN", "USD", "CN")
tz = "+08:00"
events = [Event("E1", "create", datetime.fromisoformat(f"2026-06-05T10:00:00{tz}"), {"plan_id": "team", "quantity": 3}),
          Event("E2", "pause", datetime.fromisoformat(f"2026-07-10T10:00:00{tz}"), {}),
          Event("E3", "resume", datetime.fromisoformat(f"2026-08-12T10:00:00{tz}"), {})]
sub = Subscription("SUB-0901", cn.id, date(2026, 6, 5), 5, None, events)
invs = build_invoices(cn, sub, PLANS, None, TAX_RATES, until=date(2026, 10, 15))
print("正确的账:", [(i.id, str(i.period_start), str(i.total)) for i in invs])

ledger = Ledger(cn, sub, PLANS, None, TAX_RATES, invs)
truth = pause_still_billed(ledger, date(2026, 8, 5))
ledger.pay_all()
print("改坏以后:", [(i.id, str(i.period_start), str(i.total)) for i in ledger.invoices])
print("标准答案:", truth.invoice_ids, truth.overcharge, truth.detail)

# 自检:和 test_faults.py 一样,拿引擎重算,不信注入函数
correct = {i.period_start: i for i in build_invoices(cn, sub, PLANS, None, TAX_RATES, until=date(2026, 10, 15))}
target = next(i for i in ledger.invoices if i.id == truth.invoice_ids[0])
paid = sum((p.amount for p in ledger.payments if p.invoice_id == target.id), ZERO)
should = correct[target.period_start].total if target.period_start in correct else ZERO
print("自检:", money(paid - should) == truth.overcharge)
```

<div class="line-notes">

- `def pause_still_billed(ledger: Ledger, period_start: date) -> Truth:` 多传一个参数,说明在哪一期补发票。正式版可以像 `cancel_not_respected` 那样自己找。
- `template = next(i for i in ledger.invoices if any(ln.kind == "recurring" for ln in i.lines))` 找一张有订阅费的发票当模板。
- `prev = max((i for i in ledger.invoices if i.period_start < period_start), key=lambda i: i.period_start)` 暂停那期之前的最后一张。这一行我第一次写成 `max(发票们)`,没给 `key`,报了 `TypeError: '>' not supported between instances of 'Invoice' and 'Invoice'`:dataclass 默认不支持比大小,`max` 必须知道按哪个字段比。
- `extra.id = prev.id[:-2] + f"{int(prev.id[-2:]) + 1:02d}"  # 正好是暂停时跳过的那个编号` 引擎在暂停那期没开票,但期数 k 照样加了 1,所以发票号会跳一个。补上的发票正好用那个空出来的号,看起来很自然。
- `extra.period_end = next(i.period_start for i in ledger.invoices if i.period_start > period_start)` 结束日是下一张发票的开始日。
- `ledger.invoices.sort(key=lambda i: i.period_start)` 补进去以后按周期重新排序。
- `Event("E2", "pause", datetime.fromisoformat(f"2026-07-10T10:00:00{tz}"), {}),` 7 月那期中间暂停,从 8 月那期起不收订阅费。
- `Event("E3", "resume", datetime.fromisoformat(f"2026-08-12T10:00:00{tz}"), {})]` 8 月那期中间恢复,从 9 月那期起恢复收费。
- `should = correct[target.period_start].total if target.period_start in correct else ZERO` 引擎认为 8 月 5 日那期不该有发票,应付 0。

</div>

```bash
uv run python -m scratch.ex3_pause_fault
```

```text
正确的账: [('INV-0901-01', '2026-06-05', '124.02'), ('INV-0901-02', '2026-07-05', '124.02'), ('INV-0901-04', '2026-09-05', '124.02'), ('INV-0901-05', '2026-10-05', '124.02')]
改坏以后: [('INV-0901-01', '2026-06-05', '124.02'), ('INV-0901-02', '2026-07-05', '124.02'), ('INV-0901-03', '2026-08-05', '124.02'), ('INV-0901-04', '2026-09-05', '124.02'), ('INV-0901-05', '2026-10-05', '124.02')]
标准答案: ['INV-0901-03'] 124.02 订阅在 2026-08-05 那个周期处于暂停,INV-0901-03 不应该开出
自检: True
```

引擎的正确账里没有 `INV-0901-03`,8 月那期在暂停。注入以后多了这一张,124.02 全额多收,自检通过。

为什么不直接加进 `INJECTORS`?因为 `FAULTY` 是按 `INJECTORS` 的顺序轮流分配的,多一类故障,100 个场景的种类和顺序会全部重排,S001 就不再是今天那个 S001 了。数据集一旦被评测报告引用,就要像接口一样小心改:要加新故障,应该发一个新版本的数据集(比如 `scenarios_v2/`),新旧两版的分数分开报。

</details>

**练习 4:为什么一定要放进 31 天的周期。** 把「分母写死 30」的注入函数分别用在 30 天、31 天、28 天的周期上,看标准答案是多少,解释 `seed.py` 里那行 `== 31` 的用意。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex4_thirty_days.py  练习 4:分母写死 30 的 bug 放进 30 天、31 天、28 天的周期里
from datetime import date, datetime

from billsleuth.engine import Customer, Event, Subscription, build_invoices
from billsleuth.faults import Ledger, proration_wrong_days
from billsleuth.refdata import PLANS, TAX_RATES

cn = Customer("C-0001", "青禾记账工作室", "CN", "USD", "CN")
for start, up_at in [(date(2026, 6, 5), "2026-06-20T10:00:00+08:00"),
                     (date(2026, 7, 5), "2026-07-20T10:00:00+08:00"),
                     (date(2027, 2, 5), "2027-02-20T10:00:00+08:00")]:
    events = [Event("E1", "create", datetime.fromisoformat(f"{start}T10:00:00+08:00"), {"plan_id": "team", "quantity": 3}),
              Event("E2", "upgrade", datetime.fromisoformat(up_at), {"plan_id": "business"})]
    sub = Subscription("SUB-0001", cn.id, start, 5, None, events)
    invs = build_invoices(cn, sub, PLANS, None, TAX_RATES, until=date(start.year, start.month + 1, 5))
    truth = proration_wrong_days(Ledger(cn, sub, PLANS, None, TAX_RATES, invs))
    print(f"{start} 起的周期:多收 {truth.overcharge:>6}  | {truth.detail}")
```

<div class="line-notes">

- `for start, up_at in [(date(2026, 6, 5), "2026-06-20T10:00:00+08:00"),` 三个周期:6 月 5 日起 30 天、7 月 5 日起 31 天、2027 年 2 月 5 日起 28 天,每个都在 20 号升级。
- `invs = build_invoices(cn, sub, PLANS, None, TAX_RATES, until=date(start.year, start.month + 1, 5))` 算两期,折算记在第二期上。`start.month + 1` 在 12 月会出错,这里三个月份都不是 12 月,草稿可以这么偷懒。
- `truth = proration_wrong_days(Ledger(cn, sub, PLANS, None, TAX_RATES, invs))` 直接造一个 Ledger 注入。

</div>

```bash
uv run python -m scratch.ex4_thirty_days
```

```text
2026-06-05 起的周期:多收   0.00  | 2026-06-05 开始的周期有 30 天,折算却按 30 天算
2026-07-05 起的周期:多收   2.73  | 2026-07-05 开始的周期有 31 天,折算却按 30 天算
2027-02-05 起的周期:多收  -4.92  | 2027-02-05 开始的周期有 28 天,折算却按 30 天算
```

30 天的周期里这个 bug 不产生任何差额,标准答案是「多收 0.00,但期望动作是起草贷记单」,自检的第二条会失败,而 detail 那句「有 30 天,折算却按 30 天算」本身就是一句废话。28 天的周期里客户反而少付了 4.92(Day 677 算过折算差 4.64,税再差 0.28),客户不会来投诉,这也不是一个「争议」。只有 31 天的周期才是客户会来问「怎么比我算的多一点」的那种场景。所以 `build_setup` 专门挑 31 天的周期放升级事件。

这个练习说明了一件更普遍的事:**同一个 bug,在不同的数据上有不同的表现**,注入故障时要让数据落在 bug 真正会伤到人的地方。

</details>

**验收标准:** `uv run pytest` 125 条全绿;`uv run python -m billsleuth.seed` 生成的 S001 和文中一字不差;能手算 S011 的 26.02;能说出 12 类故障里哪几类改的是发票金额、哪几类是多出一笔扣款或一张发票;把 `pay_all()` 挪到注入之前能看到 80 个失败,并说清楚原因;能解释为什么检查一从「合计 = 小计 − 折扣 + 税」换成了「税和自己的小计对得上」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 故障注入(fault injection) | 按真实 bug 的机制故意改坏数据或系统,看下游能不能发现,例子:分母写死 30 天 |
| 标准答案(ground truth) | 每个场景的正确结论:根因、涉及发票、多收金额、期望动作,存在 `scenarios/*.json` |
| `Ledger` | 一个场景的全部账:客户、订阅、发票、扣款,注入函数直接改它 |
| `Truth` | 一份标准答案的数据类 |
| 重新结账(`refinalize`) | 改了行项目以后删掉旧的折扣和税,按规则重算,让错误「自洽」 |
| `copy.deepcopy` | 连同里面的列表、对象一起复制,复制品和原件互不影响,相当于 `structuredClone` |
| variant | 场景的具体种类,没错的场景根因都是 `no_error`,variant 区分是哪种「没错」 |
| 干扰项 | 和根因无关、但看起来像线索的数据,比如 25% 的普通客户也带优惠券 |
| 数据集自检 | 用独立于注入逻辑的方式重算一遍,证明标准答案本身是对的 |
| 可复现(reproducible) | 固定随机种子,同样的代码每次造出一模一样的数据 |
| 嵌套函数 / 闭包 | 函数里定义的函数,能直接使用外层函数的变量,例子:`build_setup` 里的 `add` |

## 常见误区

**故障注入只改合计或者只改一行。** 偷懒改完税和小计对不上,实测 `looks_real` 当场判假。改行项目,再 `refinalize`。

**先扣款再注入。** 客户实付等于正确金额,发票却写着多收,实测 80 个场景全部失败。`pay_all()` 必须在注入之后。

**相信注入函数自己算的差额。** 注入函数也会有 bug。自检要走独立的路:引擎重算应收,拿实付去减。

**写一条永远不会失败的检查。** 「合计 = 小计 − 折扣 + 税」在内存里恒成立,测不出东西。写完检查先想想它有没有可能红。

**分母写死 30 的故障随便放进哪个月。** 30 天的周期差额是 0,28 天的周期客户少付。实测只有 31 天的周期才是争议。

**造数用 `date.today()` 或者不固定种子。** 明天再跑,每个客户多一张发票、答案全变,今天和明天的分数没法比。

**有券的场景都是券的问题。** 不加干扰项,Agent 会学到这种捷径。普通客户也随机带券。

**往 `INJECTORS` 里随手加一类故障。** 场景会整体重排,已经被引用的 S001 不再是原来那个。要加就发新版本数据集。

**`copy.copy` 复制发票。** 浅拷贝,两张发票共用一个 `lines` 列表。用 `copy.deepcopy`。

## 学习资料

### 文档与文章

- [Python 文档 · copy](https://docs.python.org/zh-cn/3.12/library/copy.html):浅拷贝和深拷贝的区别,今天重复开票那类故障靠它,中文,10 分钟。
- [Python 文档 · random](https://docs.python.org/zh-cn/3.12/library/random.html):看 `Random` 类、`seed`、`shuffle`,以及开头那段「不能用于安全用途」的提醒,中文,15 分钟。
- [Hamel Husain · LLM Evals FAQ](https://hamel.dev/blog/posts/evals-faq/):写过大量评测的人总结的问答,重点看合成数据和「先看数据再写评测」那几条,和今天的做法对照,30 分钟。
- [Principles of Chaos Engineering](https://principlesofchaos.org/):Netflix 提出的混沌工程原则,一页纸。它在生产系统里注入故障看系统扛不扛得住,我们在数据里注入故障看 Agent 查不查得出,思路相通,5 分钟。
- [Wikipedia · Mutation testing](https://en.wikipedia.org/wiki/Mutation_testing):变异测试,故意改坏代码看测试能不能发现。Day 681 换循环顺序、今天把 `pay_all` 挪位置,都是手工做的变异测试,10 分钟。
- [Stripe · Prorations](https://docs.stripe.com/billing/subscriptions/prorations):回头再看一遍,找找真实系统里还有哪些折算规则,可以变成第 13、14 类故障,15 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1o68izdEDu&autoplay=0&high_quality=1" title="合成数据!是什么?如何实现?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>慧研格真 · 合成数据!是什么?如何实现? · 14 分钟,讲合成数据的几种做法和它的局限,和今天「这份数据集的局限」一节对照着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1fK421h7Z7&autoplay=0&high_quality=1" title="混沌工程原则&amp;混沌工程试验方法论" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>无涯课堂 · 混沌工程原则&amp;混沌工程试验方法论 · 13 分钟,播放量不高,但把「先定义稳态、再注入故障、对比结果」讲得清楚,今天的自检就是这个套路。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/mF4CaijvJos" title="How To Build AI Evals" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · How To Build AI Evals · 讲评测集从哪来、怎么用合成数据补真实数据的不足,看他怎么强调「先读数据」。</figcaption>
</figure>

- XtremePython Conference《Kill All Mutants! (Intro to Mutation Testing) | Dave Aronson》(YouTube `9u5oUprNQYA`):变异测试入门,讲为什么「故意改坏代码」能衡量测试的质量。

### 书籍

- Casey Rosenthal、Nora Jones《Chaos Engineering: System Resiliency in Practice》(O'Reilly, 2020):混沌工程的系统介绍,前几章讲为什么要主动注入故障、怎么设计实验。我没有查到中译本。
- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 4 章讲评测数据怎么来、合成数据的风险,和今天的局限一节对照。

### 开源项目与代码

- [boxed/mutmut](https://github.com/boxed/mutmut):Python 的变异测试工具,自动把你的代码改坏成很多份,看测试能抓住几份。可以拿 `engine.py` 试一下。
- [Netflix/chaosmonkey](https://github.com/Netflix/chaosmonkey):混沌工程的鼻祖项目,随机关掉生产环境的实例。看 README 了解「故障注入」最早是怎么做的。
- [killbill/killbill](https://github.com/killbill/killbill):想加第 13 类故障时,去它的 issue 里找真实的计费 bug。

## 自测

1. 为什么故障注入要「改行项目再重算折扣和税」,不能直接把合计加 10 块?

<details><summary>答案</summary>

直接改会留下数据破绽:实测订阅费加 10 以后小计 277.00,税还是 16.02,而 277 × 6% 应该是 16.62。Agent 只要验一下税就知道发票被改过,找到的是破绽而不是业务错误,评测就没意义了。真实 bug 产生的错账总是自洽的,所以要模仿 bug 的机制改行项目,再让折扣和税按规则重算。

</details>

2. 12 类故障里,哪三类不改已有发票的金额?它们的多收金额怎么算?

<details><summary>答案</summary>

重复扣款(同一张发票多一笔成功扣款)、重复开票(同一周期多一张发票)、取消后仍开票(取消生效后多一期)。发票本身的金额都是对的,多收的就是多出来那一整笔扣款或那一整张发票的合计。只看发票金额的 Agent 发现不了这三类,要查扣款记录和同期的其他发票。

</details>

3. 自检测试的第三条为什么要自己拿引擎重算,而不是直接比较注入函数返回的 overcharge?

<details><summary>答案</summary>

注入函数自己也可能有 bug。自检走一条独立的路:用引擎从没改过的事件重算正确的应收,再用客户实际扣款去减,两条路算出同一个数,答案才可信。实测把 `pay_all()` 挪到注入之前,注入函数返回的 overcharge 一个没变,但客户实付变成了正确金额,80 个场景全部失败,就是被这一条抓到的。

</details>

4. 为什么每个场景用 `Random(1000 + i)` 而不是全局一个随机数生成器?

<details><summary>答案</summary>

每个场景自己的随机序列只取决于自己的编号。改了第 50 个场景的造法(多抽了一次随机数),其他 99 个场景完全不受影响;如果共用一个生成器,第 50 个多抽一次,后面 50 个全变了。再加上固定 `AS_OF` 和打乱用的 `Random(7)`,整个数据集每次生成都一模一样,今天和下周的评测分数才能比较。

</details>

5. 20 个「没错」的场景有什么用?为什么也要配和故障场景一样含糊的客户说法?

<details><summary>答案</summary>

一个只会找错的 Agent 看到抱怨就往有错的方向想,可能把正确的升级折算说成多收,起草一张不该有的贷记单,真的把钱退出去,这比漏掉一个错误更糟。没错的场景专门测这个,对应验收指标里的误冲正率。说法要一样含糊(甚至更像有错),Agent 才不能从措辞猜出「这单没错」,只能把账核对一遍。

</details>

6. 面试题:「你的评测集是合成的,怎么证明它的标准答案是对的?又怎么让它像真的?」

<details><summary>答案</summary>

答案可靠靠工程:先用按公司规则写的参考引擎生成正确的账,引擎本身每条规则都有手算的单元测试;再按真实 bug 的机制注入错误,改完让折扣和税按规则重算,错误和真实的一样自洽;每个场景的标准答案用独立路径验证(引擎重算应收,用客户实付去减),100 个场景必须分毫不差;随机种子固定,数据集可复现。我还在库那一层再查一遍表头和行项目、重复扣款的数量,证明写进库的就是内存里那份。我做这个自检时真抓到过一个 bug:先扣款后注入,导致 80 个场景客户实付等于正确金额。让它像真的靠和业务对齐:故障类别从真实工单和事故复盘里来;同一类故障要放在它真正会伤人的数据上(分母写死 30 只在 31 天的月份多收);加 20% 没错的场景和干扰项;客户说法要含糊。最后诚实写出局限:单一故障、说法模板化、复算工具让题目偏简单,上线后用真实工单抽样标注来校准。

</details>

## 明天预告

明天是 Day 683 · BillSleuth(四):MCP 工具层、复算工具、Inspector 和测试。今天有了账(`billing.db`)和答案(`scenarios/`),明天在两者之间搭一层 Agent 能用的接口:按查账的动作设计 6 个只读工具、1 个调用参考引擎的复算工具 `recompute_invoice`、1 个只能写草稿的 `draft_credit_note`,每次调用都记审计日志;再用 Inspector 和内存客户端测试证明,对 100 个场景中的每一个,工具都能给出足以算出标准答案的信息。
