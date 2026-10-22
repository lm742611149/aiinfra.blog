---
title: 'Day 681 · BillSleuth(二):参考引擎和用单测钉死规则,价目表和税率'
description: '把 Day 677 到 680 手算过的规则拼成 BillSleuth 的参考计费引擎:先用 dataclass 写下八种业务对象,再写四个小工具、折扣和税、一期一期开账,最后处理升级、改席位、取消和暂停。每条规则配一条期望值手算的 pytest 测试,故意把循环顺序换一下,四条测试当场变红。最后补上虚构的价目表和税率表。'
pubDate: 2026-10-22
regime: none
tags: ['billsleuth', 'dataclass', 'pytest', 'billing-engine', 'agent-zero']
series: 'agent-zero'
day: 681
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 680](/blog/agent-zero/day-680-bs-engine-1/) 打了两块地基。一块是 `money.py`:整个项目的金额只走 `money()`、`prorate()`、`fmt()` 三个函数,拒收 float,只在最后舍入一次,改一下舍入方式测试就红。另一块是 `billing.db` 的十张表:金额存 TEXT,事件时间统一存 UTC,订阅表只是快照,`subscription_events` 才是事实;我们还写了一个草稿版的 `state_at`,从第一条事件开始一条条叠,回放出任意时刻的订阅状态。

Day 680 的明天预告说过,这些都是零件。今天把它们拼成一台机器:**参考计费引擎**。给它一个客户、一份订阅和它的全部事件,它按云簿对外承诺的规则,把每一期「应该」开出的发票算出来。后面造数据、复算工具、评测打分,都靠它给出标准答案。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清楚参考引擎的输入和输出,用 dataclass 写出 `Customer`、`Plan`、`Coupon`、`TaxRate`、`Event`、`Subscription`、`Line`、`Invoice` 八个类,知道为什么发票的小计、折扣、税、合计不单独存,而是从行项目算出来。
2. 写出 `build_invoices`:按锚点日一期一期往前走,先开本期的账,再处理本期里发生的事件,把折算留给下一张发票;能解释为什么这个顺序不能反。
3. 用 pytest 给每条计费规则写一条测试,期望值全部来自手算,并亲眼看到改一个顺序时哪几条变红。
4. 写出虚构的价目表和税率表 `refdata.py`,用它跑出一个跨过「税率 7 月 1 日下调」的客户账单。

预计用时 3 小时。前置:[Day 680](/blog/agent-zero/day-680-bs-engine-1/)(`money.py`、事件回放)、[Day 679](/blog/agent-zero/day-679-bs-prd/)(先折扣后算税)、[Day 677](/blog/agent-zero/day-677-bs-why/)(锚点日、按天折算、时区)、[Day 50](/blog/agent-zero/day-050-dataclass/)(dataclass)、[Day 43](/blog/agent-zero/day-043-classes-3/)(`@property`)、[Day 73](/blog/agent-zero/day-073-pytest-3/)(parametrize 和 fixture)。今天不调模型,花费 0 元。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `build_invoices` 的循环骨架默写出来(先开账、再处理事件、最后往前走一期);做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 引擎到底在干什么

先用一句话说清楚它的位置。BillSleuth 里有两份账:一份是 `billing.db` 里「实际开出去」的发票,可能有错;另一份是引擎按规则「应该开出」的发票,一定是对的(只要规则写对了)。Agent 查账时做的事,本质上就是拿这两份账逐行对比,再解释为什么不一样。

所以引擎有两个用途,明天和后天你都会看到:

- **造数据时**,先用引擎算出正确的账,再往里注入 bug,注入前后的差额就是标准答案(Day 682)。
- **查账时**,复算工具 `recompute_invoice` 调用同一个引擎,把「应收」交给 Agent,Agent 自己不用算一分钱(Day 683)。

前端视角打个比方:引擎就像一个纯函数组件,`render(props)` 给同样的 props 永远渲染出同样的东西。这里的 props 是客户、订阅事件、价目表、税率表,渲染结果是一串发票。它不读数据库,不看订阅表的当前值,不碰网络,所以特别好测。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="参考引擎的结构:左边是客户、订阅事件、价目表、优惠券、税率五样输入;中间是一个按周期推进的循环,每期先开账再处理本期事件;右边输出应收发票列表">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="16" y="24" width="150" height="196" rx="4" fill="none" stroke="var(--ink-soft)"/>
    <text x="91" y="44" text-anchor="middle" font-size="12" fill="var(--ink)">输入(全是对象)</text>
    <text x="28" y="70" fill="var(--ink-soft)">Customer 国家/税区</text>
    <text x="28" y="94" fill="var(--ink-soft)">Subscription</text>
    <text x="40" y="110" fill="var(--ink-soft)">+ events 事件</text>
    <text x="28" y="134" fill="var(--ink-soft)">plans 价目表</text>
    <text x="28" y="158" fill="var(--ink-soft)">Coupon 优惠券</text>
    <text x="28" y="182" fill="var(--ink-soft)">rates 税率表</text>
    <text x="28" y="206" fill="var(--ink-faint)">until 算到哪天</text>
    <line x1="166" y1="122" x2="200" y2="122" stroke="var(--ink-soft)"/>
    <polygon points="200,118 208,122 200,126" fill="var(--ink-soft)"/>
    <rect x="210" y="24" width="250" height="230" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="335" y="44" text-anchor="middle" font-size="12" fill="var(--compute)">每个周期 [ps, pe) 循环一次</text>
    <text x="222" y="72" fill="var(--compute)">1 放进上期留下的折算行</text>
    <text x="222" y="94" fill="var(--compute)">2 订阅费 = 单价 × 席位</text>
    <text x="222" y="116" fill="var(--compute)">3 优惠券(还在有效月内)</text>
    <text x="222" y="138" fill="var(--compute)">4 税 = (小计 − 折扣) × 税率</text>
    <text x="222" y="166" fill="var(--compute)">5 处理本期内的事件</text>
    <text x="236" y="186" fill="var(--compute)">改套餐/席位 → 折算行留给下期</text>
    <text x="236" y="206" fill="var(--compute)">取消 → 本期结束后不再开</text>
    <text x="236" y="226" fill="var(--compute)">暂停/恢复 → 开不开订阅费</text>
    <text x="222" y="246" fill="var(--ink-faint)">6 ps = pe,往前走一期</text>
    <line x1="460" y1="122" x2="494" y2="122" stroke="var(--ink-soft)"/>
    <polygon points="494,118 502,122 494,126" fill="var(--ink-soft)"/>
    <rect x="504" y="70" width="120" height="104" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="564" y="94" text-anchor="middle" font-size="12" fill="var(--mem)">应收发票</text>
    <text x="564" y="116" text-anchor="middle" fill="var(--mem)">INV-0001-01</text>
    <text x="564" y="134" text-anchor="middle" fill="var(--mem)">INV-0001-02</text>
    <text x="564" y="152" text-anchor="middle" fill="var(--mem)">…</text>
    <text x="16" y="284" fill="var(--ink-faint)">第 5 步排在 1–4 之后:本期发生的改动,影响的是下一张发票。今天的测试专门钉住这个顺序。</text>
  </g>
</svg>
<figcaption>引擎是一个按周期推进的循环。输入全是内存里的对象,不读库;今天先让它跑对,Day 683 再写从库里读回这些对象的 repo.py。</figcaption>
</figure>

还有一句心里话。参考引擎**不追求「唯一正确」的计费规则**,它追求和公司对外承诺的规则完全一致。比如「中途升级的钱记在下一张发票上」,换成「立刻开一张补差价的发票」也完全合理,Stripe 就支持两种。但云簿帮助中心写的是前者,引擎就只能是前者。规则以外的情况(比如月付改年付),引擎直接报错,比默默算出一个数安全。

## 第一步:用 dataclass 写下八种东西

引擎吃的是对象,不是数据库里的行。[Day 50](/blog/agent-zero/day-050-dataclass/) 学过 dataclass:只写字段和类型,`__init__`、`__repr__`、`==` 都自动生成,相当于 TS 里一个 `interface` 加一个顺手的构造函数。

先故意踩一个坑。发票有一个「行项目列表」字段,最自然的写法是默认给个空列表:

```python
# billsleuth/scratch/mutable_default.py  dataclass 里列表字段不能直接写 = []
from dataclasses import dataclass


@dataclass
class Invoice:
    id: str
    lines: list = []
```

<div class="line-notes">

- `lines: list = []` 想让每张新发票默认没有行项目,直觉上这么写。

</div>

```bash
uv run python scratch/mutable_default.py
```

```text
  File "/Users/你/.local/share/uv/python/cpython-3.12.13-macos-x86_64-none/lib/python3.12/dataclasses.py", line 852, in _get_field
    raise ValueError(f'mutable default {type(f.default)} for field '
ValueError: mutable default <class 'list'> for field lines is not allowed: use default_factory
```

(前面几行调用栈省略了。)dataclass 直接拒绝。原因是默认值只在定义类的时候算一次:如果允许 `= []`,所有发票会**共用同一个列表对象**,往一张发票里加一行,别的发票也多一行。JS 里你也见过类似的坑,比如 React 组件 `function List({ items = [] })` 每次渲染都是新数组还好,但要是把 `const EMPTY = []` 提到模块顶层当默认值再去 push,所有组件就一起变了。报错里已经告诉你修法:`field(default_factory=list)`,意思是「每造一个对象,就调用一次 `list()` 生成一个新列表」。

正式的 `engine.py` 第一部分:

```python
# billsleuth/billsleuth/engine.py  参考计费引擎:按云簿的规则,算出每一期「应该」开出的发票
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal

from billsleuth.money import ZERO, money


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
    valid_to: date | None  # 含当天;None 表示至今有效


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
```

<div class="line-notes">

- `from dataclasses import dataclass, field` 多导入一个 `field`,就是上面报错里建议用的那个。
- `from billsleuth.money import ZERO, money` Day 680 的金额规则。引擎里所有「把一个数变成金额」的地方都过 `money()`。
- `class Customer:` 五个字段和 Day 680 `customers` 表一一对应,名字也一样。以后从库里读回来,一行变一个对象,不用改名。
- `unit_price: Decimal` 类型标注写 `Decimal`,不是 `str`。库里存的是字符串 `'39.00'`,进引擎之前要转成 Decimal,这件事 Day 683 的 repo.py 负责。
- `value: Decimal` 优惠券的值:百分比券存 `20` 表示 20%,定额券存 `10.00` 表示减 10 美元,和 Day 680 表注释的约定一样。
- `valid_to: date | None  # 含当天;None 表示至今有效` 税率的结束日**含当天**,和周期的「不含结束日」相反。Day 680 在表注释里提醒过,下面 `rate_on` 会照这个写。
- `effective_at: datetime  # 带时区` 事件时间是带时区的 `datetime`,不是字符串。库里存 UTC 字符串,读回来用 `datetime.fromisoformat` 变成对象。
- `payload: dict` 事件内容,和 Day 680 一样:开通带 `{"plan_id": "team", "quantity": 3}`,升级只带 `{"plan_id": "business"}`,改席位只带 `{"quantity": 5}`。
- `events: list[Event]` 订阅自己带着它的全部事件。注意这里没有 `plan_id` 和 `quantity`:引擎只认事件,不认订阅表那份快照,这是 Day 680 定下的规矩。
- `class Line:` 一行发票。字段和 `invoice_lines` 表一样,少了 `id` 和 `invoice_id`,这两个写库时再生成。
- `period_start: date | None = None` 有默认值的字段必须排在没默认值的后面,这是 dataclass 的规定,和函数参数一样。税行、折扣行不对应时间段,所以默认是空。
- `status: str = "paid"` 引擎算出来的是「应该」开出的发票,状态先统一写 paid。
- `lines: list[Line] = field(default_factory=list)` 修好的写法,每张发票有自己的列表。
- `def _sum(self, *kinds: str) -> Decimal:` `*kinds` 收任意多个参数,打包成元组,[Day 30](/blog/agent-zero/day-030-functions-3/) 讲过,相当于 JS 的 `...kinds`。名字前面的下划线表示「类内部用的,外面别调」,这是约定,Python 不强制。
- `return money(sum((ln.amount for ln in self.lines if ln.kind in kinds), ZERO))` 把指定类型的行加起来。`sum` 的第二个参数是起点,用 `ZERO`(`0.00`)而不是默认的整数 0,结果才保持两位小数,Day 680 讲过。
- `@property` [Day 43](/blog/agent-zero/day-043-classes-3/) 学过:`inv.subtotal` 像读字段一样用,背后是一次计算,相当于 JS 的 `get subtotal() {}`。
- `return self._sum("recurring", "proration", "adjustment")` 小计 = 订阅费 + 折算 + 调整。
- `return -self._sum("discount")  # 折扣行是负数,表头存正数` 折扣行在发票上是负数(减钱),但表头习惯写「折扣 68.40」,所以取个负号。
- `return money(sum((ln.amount for ln in self.lines), ZERO))` 合计 = 所有行加起来。

</div>

这里最值得停下来想的一点:**小计、折扣、税、合计四个数,一个都不存,全是从行项目算出来的**。好处是内存里的发票不可能出现「表头和明细对不上」:你往 `lines` 里加一行,四个数自动跟着变。写库的时候才把它们算好存进 `invoices` 表的四列,方便查询。一个习惯值得带走:能推导出来的值,就别给它和来源不一致的机会,和 React 里「能从 props 算出来的就别放进 state」是同一个道理。

手工拼一张 Day 677 那张 7 月发票试试:

```python
# billsleuth/scratch/try_invoice.py  手工拼一张 7 月发票,看表头四个数怎么从行项目算出来
from datetime import date
from decimal import Decimal as D

from billsleuth.engine import Invoice, Line

inv = Invoice("INV-0001-02", "C-0001", "SUB-0001", date(2026, 7, 5), date(2026, 8, 5), date(2026, 7, 5), "USD")
inv.lines += [
    Line("proration", "未使用时间退还:团队版 × 3", 3, D("-58.50"), D("-58.50")),
    Line("proration", "剩余时间:商业版 × 3", 3, D("133.50"), D("133.50")),
    Line("recurring", "商业版 × 3 席位", 3, D("89.00"), D("267.00")),
]
print("加税之前:", inv.subtotal, inv.discount, inv.tax, inv.total)
inv.lines.append(Line("tax", "税 CN-VAT6(6%)", 1, D("20.52"), D("20.52")))
print("加税之后:", inv.subtotal, inv.discount, inv.tax, inv.total)
print(inv.lines[2])
other = Invoice("INV-0002-01", "C-0002", "SUB-0002", date(2026, 7, 5), date(2026, 8, 5), date(2026, 7, 5), "USD")
print("另一张发票的行数:", len(other.lines))
```

<div class="line-notes">

- `from decimal import Decimal as D` 起个短名字,测试和草稿里要写很多金额,`D("58.50")` 比 `Decimal("58.50")` 好读。
- `inv = Invoice("INV-0001-02", "C-0001", "SUB-0001", date(2026, 7, 5)` 按字段顺序传参:发票号、客户、订阅、周期起止、开票日、币种。发票号的格式 `INV-客户序号-第几期` 是今天定的,下面引擎会自动生成。
- `inv.lines += [` 往列表末尾追加多个元素,相当于 JS 的 `inv.lines.push(...[...])`。
- `Line("proration", "未使用时间退还:团队版 × 3", 3, D("-58.50"), D("-58.50")),` 退还行是负数。数量 3、单价和金额都写 -58.50:折算行的「单价」没有意义,我们约定它和金额一样。
- `print("加税之前:", inv.subtotal, inv.discount, inv.tax, inv.total)` 读四个 property,每读一次就算一次。
- `inv.lines.append(Line("tax", "税 CN-VAT6(6%)", 1, D("20.52"), D("20.52")))` 手工补一行税。下面第三步会让代码自己算。
- `print(inv.lines[2])` dataclass 自动生成的 `__repr__`,字段名和值全打出来,调试很方便。
- `other = Invoice(` 再造一张发票,看它的行列表是不是独立的。

</div>

```bash
uv run python -m scratch.try_invoice
```

```text
加税之前: 342.00 0.00 0.00 342.00
加税之后: 342.00 0.00 20.52 362.52
Line(kind='recurring', description='商业版 × 3 席位', quantity=3, unit_amount=Decimal('89.00'), amount=Decimal('267.00'), period_start=None, period_end=None, tax_code=None)
另一张发票的行数: 0
```

小计 342.00 和 Day 677 手算的一样;加一行税,合计自动变成 362.52,小计不变。`other` 的行数是 0,`default_factory` 起作用了。草稿 import 了 `billsleuth`,所以照 Day 680 的规矩在仓库根目录用 `-m` 跑。

## 第二步:四个小工具

开账要用到四个小计算,先把它们单独写出来、单独试。在 `engine.py` 顶部的 import 里加一行 `from zoneinfo import ZoneInfo`,在 import 下面加一个时区表,然后在 `Invoice` 类后面追加四个函数:

```python
from zoneinfo import ZoneInfo

COUNTRY_TZ = {"CN": "Asia/Shanghai", "SG": "Asia/Singapore", "DE": "Europe/Berlin", "US": "America/Los_Angeles"}


def add_months(d: date, n: int, anchor: int) -> date:
    """d 往后 n 个月、锚点日那一天。锚点日限定 1–28,每个月都有这一天。"""
    y, m = divmod(d.month - 1 + n, 12)
    return date(d.year + y, m + 1, anchor)


def local_date(ts: datetime, country: str) -> date:
    """把带时区的时刻换成客户所在国家的本地日期。"""
    return ts.astimezone(ZoneInfo(COUNTRY_TZ[country])).date()


def months_between(a: date, b: date) -> int:
    """从 a 到 b 隔了几个自然月,只看年和月。"""
    return (b.year - a.year) * 12 + (b.month - a.month)


def rate_on(rates: list[TaxRate], region: str, on: date) -> TaxRate:
    """某地区某一天有效的税率。valid_to 含当天。"""
    for r in rates:
        if r.region == region and r.valid_from <= on and (r.valid_to is None or on <= r.valid_to):
            return r
    raise LookupError(f"{region} 在 {on} 没有有效税率")
```

<div class="line-notes">

- `from zoneinfo import ZoneInfo` 标准库的时区数据库,Day 677 练习 2 用过。
- `COUNTRY_TZ = {"CN": "Asia/Shanghai"` 国家到时区的映射。一个国家一个时区是简化(美国有好几个时区),真实系统里客户的时区应该是单独一个字段,写进 PRD 的非目标了。
- `def add_months(d: date, n: int, anchor: int) -> date:` Day 677 草稿里的 `add_month` 只能往后一个月,这里推广成 n 个月,年付就是 `n=12`。
- `y, m = divmod(d.month - 1 + n, 12)` `divmod(a, b)` 一次返回商和余数,相当于 JS 的 `[Math.floor(a / b), a % b]`。月份先减 1 变成 0 到 11,加上 n,再除以 12:商是要进几年,余数是新的月份(0 起)。以 12 月 5 日加 1 个月为例:`divmod(11 + 1, 12)` 得 `(1, 0)`,进一年,月份 0 也就是 1 月。
- `return date(d.year + y, m + 1, anchor)` 余数加回 1 变成 1 到 12。日期用锚点日,锚点日不超过 28,不会碰到 Day 677 那个 `day is out of range`。
- `return ts.astimezone(ZoneInfo(COUNTRY_TZ[country])).date()` 先换到客户的时区,再取日期部分。顺序不能反:先 `.date()` 再换时区,拿到的就是 UTC 那天的日期了。
- `return (b.year - a.year) * 12 + (b.month - a.month)` 只比较年和月,不管几号。用来判断「优惠券开始后第几个月」,6 月 5 日开通、9 月 5 日开票,就是第 3 个月。
- `if r.region == region and r.valid_from <= on and (r.valid_to is None or on <= r.valid_to):` 三个条件都满足才算有效:地区对、已经生效、还没过期(没有结束日就是一直有效)。`on <= r.valid_to` 用的是 `<=`,因为结束日含当天。
- `raise LookupError(f"{region} 在 {on} 没有有效税率")` 找不到就报错,不返回 0。返回 0 等于悄悄免了税,那比报错糟糕得多。`LookupError` 是 Python 内置的「查不到」异常,`KeyError` 就是它的子类。

</div>

```python
# billsleuth/scratch/try_helpers.py  引擎的四个小工具,各试几下
from datetime import date, datetime
from decimal import Decimal as D

from billsleuth.engine import TaxRate, add_months, local_date, months_between, rate_on

print("下个月:", add_months(date(2026, 11, 5), 1, 5), add_months(date(2026, 12, 5), 1, 5))
print("一年后:", add_months(date(2025, 10, 8), 12, 8))
print("本地日期:", local_date(datetime.fromisoformat("2026-06-19T16:30:00+00:00"), "CN"),
      local_date(datetime.fromisoformat("2026-06-19T16:30:00+00:00"), "US"))
print("隔几个月:", months_between(date(2026, 6, 5), date(2026, 9, 5)), months_between(date(2026, 6, 28), date(2026, 7, 1)))
rates = [TaxRate("SG-GST8", "SG", D("0.08"), date(2023, 1, 1), date(2023, 12, 31)),
         TaxRate("SG-GST9", "SG", D("0.09"), date(2024, 1, 1), None)]
print("税率:", rate_on(rates, "SG", date(2023, 12, 31)).code, rate_on(rates, "SG", date(2024, 1, 1)).code)
print(rate_on(rates, "DE", date(2026, 6, 5)))
```

<div class="line-notes">

- `add_months(date(2026, 11, 5), 1, 5), add_months(date(2026, 12, 5), 1, 5)` 普通的一个月,和跨年的一个月。
- `add_months(date(2025, 10, 8), 12, 8)` 年付:往后 12 个月。
- `local_date(datetime.fromisoformat("2026-06-19T16:30:00+00:00"), "CN")` Day 680 那次升级,UTC 6 月 19 日 16:30。换成上海时间是 6 月 20 日 00:30。
- `local_date(datetime.fromisoformat("2026-06-19T16:30:00+00:00"), "US")` 同一个时刻,洛杉矶还是 6 月 19 日上午。同一件事,不同客户的「哪一天」不一样。
- `months_between(date(2026, 6, 28), date(2026, 7, 1))` 只差 3 天,但跨了月份,也算 1。它只看年和月,所以只能拿来比较「两个都是锚点日的日期」,引擎里正好只这么用。
- `rate_on(rates, "SG", date(2023, 12, 31)).code` 结束日当天,应该还是旧税率。
- `print(rate_on(rates, "DE", date(2026, 6, 5)))` 表里没有 DE,故意看报错。

</div>

```bash
uv run python -m scratch.try_helpers
```

```text
Traceback (most recent call last):
  File "<frozen runpy>", line 198, in _run_module_as_main
  File "<frozen runpy>", line 88, in _run_code
  File ".../billsleuth/scratch/try_helpers.py", line 15, in <module>
    print(rate_on(rates, "DE", date(2026, 6, 5)))
          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File ".../billsleuth/billsleuth/engine.py", line 129, in rate_on
    raise LookupError(f"{region} 在 {on} 没有有效税率")
LookupError: DE 在 2026-06-05 没有有效税率
下个月: 2026-12-05 2027-01-05
一年后: 2026-10-08
本地日期: 2026-06-20 2026-06-19
隔几个月: 3 1
税率: SG-GST8 SG-GST9
```

报错又跑到了前面,Day 680 解释过,stderr 和 stdout 交错显示。逐行对一下:跨年那次得到 2027-01-05;同一个 UTC 时刻,上海是 20 日、洛杉矶是 19 日;2023 年 12 月 31 日当天还是 GST8,第二天才换成 GST9;查不到税率时报一个带地区和日期的错,一眼就知道是哪张表缺了数据。

## 第三步:折扣和税

[Day 679](/blog/agent-zero/day-679-bs-prd/) 定了顺序:**优惠券作用在小计上,税按折扣之后的金额算**。写成一个函数,给一张已经有订阅费和折算行的发票补上折扣行和税行:

```python
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
    pct = f"{(tax.rate * 100).normalize():f}"
    inv.lines.append(Line("tax", f"税 {tax.code}({pct}%)", 1, tax_amount, tax_amount, tax_code=tax.code))
```

<div class="line-notes">

- `def apply_discount_and_tax(inv: Invoice, coupon: Coupon | None, months_in: int, tax: TaxRate) -> None:` 返回 `None`,直接改传进来的发票。对象是按引用传的,和 JS 一样,函数里 append 的行调用方看得到。
- `base = inv.subtotal` 先把小计记下来。下面加了折扣行以后小计不变(折扣不算进小计),但先记下来读起来更清楚。
- `if coupon and months_in < coupon.duration_months and base > 0:` 三个条件:有券;还在有效月份里(`months_in` 从 0 开始数,3 个月的券在第 0、1、2 个月生效);小计大于 0。最后一条是防止对一张负数发票(比如大幅降级只剩退款)再打折,越打折客户反而越亏。
- `off = money(base * coupon.value / 100)` 百分比券:342.00 × 20 / 100 = 68.40,整个算完舍入一次。
- `off = min(money(coupon.value), base)` 定额券:减 10 美元,但不能减成负数。小计只有 8 块的时候最多减 8 块。
- `inv.lines.append(Line("discount", desc, 1, -off, -off))` 折扣行是负数。
- `taxable = inv.subtotal - inv.discount` 应税金额 = 小计 − 折扣。`inv.discount` 是 property,刚加的折扣行这里马上就算进去了。
- `tax_amount = money(taxable * tax.rate)` 273.60 × 0.06 = 16.416,舍入 16.42。
- `for ln in inv.lines:` 给发票上每一行标上税码,数据库里 `invoice_lines.tax_code` 就是这么来的。Day 682 造「用错税率」的故障时,Agent 要靠这一列看出用的是哪个税率。
- `pct = f"{(tax.rate * 100).normalize():f}"` 把 0.06 变成「6」给人看。`0.06 × 100` 得 `6.00`,`normalize()` 去掉末尾的 0 变成 `6`,`:f` 防止它写成科学计数法。我在 Python 里试过:0.06、0.19 这样写都没问题,但 10% 的税率 0.10 × 100 normalize 以后是 `1E+1`,加了 `:f` 才是 `10`。
- `inv.lines.append(Line("tax", f"税 {tax.code}({pct}%)"` 税也是一行,描述里带税码和税率。

</div>

```python
# billsleuth/scratch/try_discount_tax.py  给 7 月发票补折扣行和税行,对照 Day 679 的手算
from datetime import date
from decimal import Decimal as D

from billsleuth.engine import Coupon, Invoice, Line, TaxRate, apply_discount_and_tax


def july() -> Invoice:
    inv = Invoice("INV-0001-02", "C-0001", "SUB-0001", date(2026, 7, 5), date(2026, 8, 5), date(2026, 7, 5), "USD")
    inv.lines += [Line("proration", "未使用时间退还:团队版 × 3", 3, D("-58.50"), D("-58.50")),
                  Line("proration", "剩余时间:商业版 × 3", 3, D("133.50"), D("133.50")),
                  Line("recurring", "商业版 × 3 席位", 3, D("89.00"), D("267.00"))]
    return inv


cn = TaxRate("CN-VAT6", "CN", D("0.06"), date(2016, 5, 1), None)
welcome = Coupon("WELCOME20", "percent", D("20"), 3)

for label, coupon, months_in in [("有券,第 2 个月", welcome, 1), ("有券,第 4 个月", welcome, 3), ("没券", None, 1)]:
    inv = july()
    apply_discount_and_tax(inv, coupon, months_in, cn)
    print(f"{label}: 小计 {inv.subtotal} 折扣 {inv.discount} 税 {inv.tax} 合计 {inv.total}")
for ln in inv.lines:
    print(f"  {ln.kind:<10} {ln.amount:>8}  {ln.tax_code}  {ln.description}")
```

<div class="line-notes">

- `def july() -> Invoice:` 每次调用都造一张新的 7 月发票(还没有折扣和税),三种情况互不干扰。
- `welcome = Coupon("WELCOME20", "percent", D("20"), 3)` 「前 3 个月八折」,Day 679 练习 3 那张券。
- `("有券,第 2 个月", welcome, 1)` 一个列表放三种情况,每个元组是(标签, 券, 第几个月)。`months_in=1` 是开通后第 2 个账期,券有效;`months_in=3` 已经过了 3 个月,券失效。
- `for ln in inv.lines:` 循环结束后 `inv` 是最后一种情况(没券)的发票,打出它的每一行。

</div>

```bash
uv run python -m scratch.try_discount_tax
```

```text
有券,第 2 个月: 小计 342.00 折扣 68.40 税 16.42 合计 290.02
有券,第 4 个月: 小计 342.00 折扣 0.00 税 20.52 合计 362.52
没券: 小计 342.00 折扣 0.00 税 20.52 合计 362.52
  proration    -58.50  CN-VAT6  未使用时间退还:团队版 × 3
  proration    133.50  CN-VAT6  剩余时间:商业版 × 3
  recurring    267.00  CN-VAT6  商业版 × 3 席位
  tax           20.52  CN-VAT6  税 CN-VAT6(6%)
```

第一行就是 Day 679 `coupon_tax.py` 手算的结果:折扣 68.40、税 16.42、合计 290.02,一分不差。第二行券过期了,和没券一样。每一行都标上了 `CN-VAT6`。

## 第四步:一期一期开账(第一版)

有了零件,写主循环。先写一个最朴素的版本:只认开通事件,从开通日起按锚点日一期一期开订阅费。

```python
def build_invoices(customer: Customer, sub: Subscription, plans: dict[str, Plan], coupon: Coupon | None,
                   rates: list[TaxRate], until: date) -> list[Invoice]:
    """第一版:只按周期开订阅费,不管开通以外的事件。"""
    events = sorted(sub.events, key=lambda e: e.effective_at)
    create = next(e for e in events if e.type == "create")
    plan = plans[create.payload["plan_id"]]
    qty = int(create.payload["quantity"])
    step = 1 if plan.interval == "month" else 12

    invoices: list[Invoice] = []
    ps, k = sub.start_date, 0
    while ps <= until:
        pe = add_months(ps, step, sub.billing_anchor_day)
        inv = Invoice(id=f"{sub.id.replace('SUB', 'INV')}-{k + 1:02d}", customer_id=customer.id,
                      subscription_id=sub.id, period_start=ps, period_end=pe, issued_at=ps,
                      currency=customer.currency)
        inv.lines.append(Line("recurring", f"{plan.name} × {qty} 席位", qty, plan.unit_price,
                              money(plan.unit_price * qty), ps, pe))
        apply_discount_and_tax(inv, coupon, months_between(sub.start_date, ps),
                               rate_on(rates, customer.tax_region, ps))
        invoices.append(inv)
        ps, k = pe, k + 1
    return invoices
```

<div class="line-notes">

- `def build_invoices(customer: Customer, sub: Subscription, plans: dict[str, Plan], coupon: Coupon | None,` 六个参数:客户、订阅、价目表(套餐 id → Plan)、优惠券、税率表、算到哪天为止。全是普通对象,不碰数据库。
- `events = sorted(sub.events, key=lambda e: e.effective_at)` 按时间排序。`key=lambda e: ...` 告诉 sorted 拿什么比大小,相当于 JS 的 `[...events].sort((a, b) => a.t - b.t)`,而且不改原列表。带时区的 datetime 可以直接比较,不会出 Day 680 那个字符串比较的问题。
- `create = next(e for e in events if e.type == "create")` `next(生成器)` 取第一个满足条件的元素,相当于 JS 的 `events.find(e => e.type === "create")`。找不到会报 `StopIteration`,一份没有开通事件的订阅本来就是坏数据。
- `plan = plans[create.payload["plan_id"]]` 从开通事件里读套餐,而不是从订阅表的快照读。
- `qty = int(create.payload["quantity"])` 席位数。JSON 里读出来本来就是整数,`int()` 是保险。
- `step = 1 if plan.interval == "month" else 12` 月付每期一个月,年付每期 12 个月。
- `ps, k = sub.start_date, 0` `ps` 是本期开始日(period start),`k` 是第几期,从 0 数。
- `while ps <= until:` 开票日不晚于 until 就开。until 是「今天」,比如 2026-10-15,10 月 5 日那期开了,11 月 5 日那期还没到。
- `pe = add_months(ps, step, sub.billing_anchor_day)` 本期结束日(不含),也是下一期的开始日。
- `id=f"{sub.id.replace('SUB', 'INV')}-{k + 1:02d}"` 发票号:`SUB-0001` 换成 `INV-0001`,再接两位期数。`:02d` 补零到两位,第 1 期是 `01`,和 JS 的 `String(k + 1).padStart(2, "0")` 一样。
- `issued_at=ps` 开票日就是本期第一天,云簿是先收钱后服务。
- `money(plan.unit_price * qty), ps, pe))` 订阅费 = 单价 × 席位,39 × 3 = 117.00。
- `apply_discount_and_tax(inv, coupon, months_between(sub.start_date, ps),` 第几个月由开通日和本期开始日算出来。
- `rate_on(rates, customer.tax_region, ps))` 按开票日查税率,用客户的税务地区,不是国家。
- `ps, k = pe, k + 1` 往前走一期。

</div>

用 Day 680 那个客户试一下:6 月 5 日开通团队版 3 席,UTC 6 月 19 日 16:30(上海 6 月 20 日 00:30)升级到商业版。

```python
# billsleuth/scratch/try_build.py  让引擎从订阅开始一期一期开发票
from datetime import date, datetime
from decimal import Decimal as D

from billsleuth.engine import Customer, Event, Plan, Subscription, TaxRate, build_invoices

PLANS = {"team": Plan("team", "团队版", "month", D("39.00")), "business": Plan("business", "商业版", "month", D("89.00"))}
RATES = [TaxRate("CN-VAT6", "CN", D("0.06"), date(2016, 5, 1), None)]
cn = Customer("C-0001", "青禾记账工作室", "CN", "USD", "CN")
create = Event("E1", "create", datetime.fromisoformat("2026-06-05T10:00:00+08:00"), {"plan_id": "team", "quantity": 3})
upgrade = Event("E2", "upgrade", datetime.fromisoformat("2026-06-19T16:30:00+00:00"), {"plan_id": "business"})
sub = Subscription("SUB-0001", "C-0001", date(2026, 6, 5), 5, None, [create, upgrade])

for inv in build_invoices(cn, sub, PLANS, None, RATES, until=date(2026, 8, 5)):
    print(f"{inv.id}  {inv.period_start} ~ {inv.period_end}  小计 {inv.subtotal}  税 {inv.tax}  合计 {inv.total}")
    for ln in inv.lines:
        print(f"    {ln.kind:<10} {ln.amount:>8}  {ln.description}")
```

<div class="line-notes">

- `PLANS = {"team": Plan("team", "团队版", "month", D("39.00"))` 先手写两个套餐,正式的价目表放在本节最后的 `refdata.py`。
- `create = Event("E1", "create", datetime.fromisoformat("2026-06-05T10:00:00+08:00")` 开通事件。时间写成上海时间也行,带了时区,引擎会自己换算。
- `upgrade = Event("E2", "upgrade", datetime.fromisoformat("2026-06-19T16:30:00+00:00"), {"plan_id": "business"})` 升级事件,payload 只带新套餐,席位不变。
- `sub = Subscription("SUB-0001", "C-0001", date(2026, 6, 5), 5, None, [create, upgrade])` 锚点日 5,没有券。
- `build_invoices(cn, sub, PLANS, None, RATES, until=date(2026, 8, 5))` 算到 8 月 5 日,应该有三期。

</div>

```bash
uv run python -m scratch.try_build
```

```text
INV-0001-01  2026-06-05 ~ 2026-07-05  小计 117.00  税 7.02  合计 124.02
    recurring    117.00  团队版 × 3 席位
    tax            7.02  税 CN-VAT6(6%)
INV-0001-02  2026-07-05 ~ 2026-08-05  小计 117.00  税 7.02  合计 124.02
    recurring    117.00  团队版 × 3 席位
    tax            7.02  税 CN-VAT6(6%)
INV-0001-03  2026-08-05 ~ 2026-09-05  小计 117.00  税 7.02  合计 124.02
    recurring    117.00  团队版 × 3 席位
    tax            7.02  税 CN-VAT6(6%)
```

周期、发票号、税都对了。但客户 6 月就升级了,7 月和 8 月还在收团队版,这是第一版故意留的缺口:它完全没看升级事件。客户要是收到这样的账单,反而会很开心。

## 第五步:处理本期里的事件

把第一版补全。改动集中在三处:循环开始前多三个状态变量;开账时先放进上期留下的折算行、暂停期间不收订阅费;开完账以后,处理落在本期里的事件。完整的函数:

```python
def build_invoices(customer: Customer, sub: Subscription, plans: dict[str, Plan], coupon: Coupon | None,
                   rates: list[TaxRate], until: date) -> list[Invoice]:
    """生成从订阅开始到 until(含)为止,每个周期应该开出的发票。"""
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
                new_plan = plans[ev.payload.get("plan_id", plan.id)]
                new_qty = int(ev.payload.get("quantity", qty))
                if new_plan.interval != plan.interval:
                    raise ValueError("引擎不支持月付和年付互换,请先取消再新建订阅")
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
```

<div class="line-notes">

- `pending: list[Line] = []  # 上个周期里产生` 本期发生的升级,折算行要记到下一张发票上,先放在这里攒着。这是一个普通的局部变量,不是 dataclass 字段,`= []` 没问题。
- `cancel_end: date | None = None` 取消生效的日子。默认「到期取消」:本期照常,本期结束日之后不再开。
- `paused = False` 是不是处于暂停。
- `if cancel_end is not None and ps >= cancel_end:` 走到取消生效日或者之后,整个循环结束。`break` 和 JS 一样,跳出 while。
- `inv.lines.extend(pending)` 先放上期留下的折算行。`extend` 把另一个列表的元素逐个加进来,相当于 `push(...pending)`。
- `pending = []` 用过就清空,下一期不会重复记。
- `if not paused:` 暂停期间不收订阅费。暂停和恢复都不折算,这是云簿的简化规则:暂停从下一期开始生效,恢复也从下一期开始。
- `if inv.lines:` 一张发票一行都没有(暂停期间,又没有折算行)就不开。空列表是假值,[Day 21](/blog/agent-zero/day-021-lists/) 讲列表时见过。
- `days = (pe - ps).days` 本期总天数,折算的分母。两个 date 相减得到 `timedelta`,`.days` 取天数。
- `for ev in events:` 每一期都把全部事件扫一遍,挑出落在本期的。事件最多几条,扫一遍不费事。
- `d = local_date(ev.effective_at, customer.country)` 事件发生在客户本地的哪一天。升级那条:UTC 6 月 19 日 16:30,上海是 6 月 20 日。
- `if not (ps <= d < pe) or ev.type == "create":` 不在本期的跳过;开通事件已经在循环外面用过了,也跳过。`ps <= d < pe` 是 Python 的连写比较,等于 `ps <= d and d < pe`,左闭右开。
- `remaining = (pe - d).days` 7 月 5 日减 6 月 20 日 = 15 天。当天算新配置,所以不加减 1。
- `new_plan = plans[ev.payload.get("plan_id", plan.id)]` payload 里有新套餐就用新的,没有(改席位事件)就沿用当前的。`dict.get(键, 默认值)` 相当于 JS 的 `payload.plan_id ?? plan.id`。这和 Day 680 `state_at` 里 `state.update(payload)` 是同一个思路:后来的事件只覆盖它带的字段。
- `new_qty = int(ev.payload.get("quantity", qty))` 席位同理。
- `if new_plan.interval != plan.interval:` 月付改年付要退一整月、收一整年,规则复杂,云簿不支持。在引擎里直接报错,练习 3 会测这一条。
- `old_full = money(plan.unit_price * qty)` 旧配置的整期金额:39 × 3 = 117.00。
- `new_full = money(new_plan.unit_price * new_qty)` 新配置的整期金额:89 × 3 = 267.00。
- `credit = prorate(old_full, remaining, days)` Day 680 的 `prorate`:117 × 15 / 30 = 58.50。
- `charge = prorate(new_full, remaining, days)` 267 × 15 / 30 = 133.50。
- `pending.append(Line("proration", f"未使用时间退还:` 退还行,负数,描述里写清楚是哪段时间,Agent 和客户都要看这个。
- `pending.append(Line("proration", f"剩余时间:` 收取行,正数。两行成对出现,Day 682 的「漏了退还行」故障就是删掉前一行。
- `plan, qty = new_plan, new_qty` 更新当前配置,下一期的订阅费按新的收。
- `elif ev.type == "cancel":` `elif` 就是 JS 的 `else if`。
- `cancel_end = pe` 本期结束日就是取消生效日。

</div>

再跑一次 `try_build.py`,一个字都不用改:

```bash
uv run python -m scratch.try_build
```

```text
INV-0001-01  2026-06-05 ~ 2026-07-05  小计 117.00  税 7.02  合计 124.02
    recurring    117.00  团队版 × 3 席位
    tax            7.02  税 CN-VAT6(6%)
INV-0001-02  2026-07-05 ~ 2026-08-05  小计 342.00  税 20.52  合计 362.52
    proration    -58.50  未使用时间退还:团队版 × 3(2026-06-20 至 2026-07-05)
    proration    133.50  剩余时间:商业版 × 3(2026-06-20 至 2026-07-05)
    recurring    267.00  商业版 × 3 席位
    tax           20.52  税 CN-VAT6(6%)
INV-0001-03  2026-08-05 ~ 2026-09-05  小计 267.00  税 16.02  合计 283.02
    recurring    267.00  商业版 × 3 席位
    tax           16.02  税 CN-VAT6(6%)
```

6 月那张没变,它在升级之前就开出去了。7 月那张就是 Day 677 画过的那张:退 58.50、收 133.50、7 月整月 267.00,小计 342.00,加 6% 的税合计 362.52。折算区间写的是 6 月 20 日起,不是 UTC 的 19 日,时区换算起作用了。8 月恢复正常的商业版 283.02。

为什么「处理事件」放在「开账」后面?因为循环走到 6 月这一期时,6 月的发票在 6 月 5 日就开出去了,6 月 20 日的升级只能影响下一张。如果把事件处理挪到开账前面,6 月那张发票就会提前知道 15 天后的升级,这在时间上是不可能的。这个顺序待会儿用测试钉住。

## 第六步:某一期「应该」是什么样

Day 683 的复算工具会这样问引擎:「这张发票是 8 月 5 日那期的,那一期应该开成什么样?」再写一个小函数接住这个问题:

```python
def expected_for_period(customer: Customer, sub: Subscription, plans: dict[str, Plan], coupon: Coupon | None,
                        rates: list[TaxRate], period_start: date) -> Invoice | None:
    """某个周期「应该」开出的发票;这个周期本不该开票(比如已经取消)就返回 None。"""
    for inv in build_invoices(customer, sub, plans, coupon, rates, until=period_start):
        if inv.period_start == period_start:
            return inv
    return None
```

<div class="line-notes">

- `rates: list[TaxRate], period_start: date) -> Invoice | None:` 返回值可能是空:订阅已经取消、或者那一期在暂停,本来就不该有发票。
- `for inv in build_invoices(customer, sub, plans, coupon, rates, until=period_start):` 从头算到这一期为止。前面的周期也得算,因为上一期的升级会把折算行带到这一期。
- `if inv.period_start == period_start:` 按周期开始日找,不按发票号。Day 682 的「同一周期开了两张发票」故障里,多出来那张的号码引擎根本不认识,按周期找才能对上。

</div>

到这里 `engine.py` 就完整了。顶部的 import 最后要写成这样(多了 `ZoneInfo` 和 `prorate`):

```python
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from billsleuth.money import ZERO, money, prorate
```

<div class="line-notes">

- `from billsleuth.money import ZERO, money, prorate` 第五步开始用到 `prorate`。忘了加的话,跑 `try_build.py` 会报 `NameError: name 'prorate' is not defined`。

</div>

## 用单测把规则钉死

### 一条规则一条测试

引擎写完,不要急着造数据。云簿帮助中心写了多少条规则,就写多少条测试,而且**期望值全部来自前几天手算过的数**。[Day 678](/blog/agent-zero/day-678-week97-review/) 复习时强调过:拿被测代码的输出当期望值,等于让它自己给自己判卷。

```python
# billsleuth/tests/test_engine.py  一条计费规则一条测试,期望值都是手算的
from datetime import date, datetime
from decimal import Decimal as D

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

PLANS = {
    "team": Plan("team", "团队版", "month", D("39.00")),
    "business": Plan("business", "商业版", "month", D("89.00")),
}
RATES = [
    TaxRate("CN-VAT6", "CN", D("0.06"), date(2016, 5, 1), None),
    TaxRate("SG-GST8", "SG", D("0.08"), date(2023, 1, 1), date(2023, 12, 31)),
    TaxRate("SG-GST9", "SG", D("0.09"), date(2024, 1, 1), None),
]
CN = Customer("C-0001", "青禾记账工作室", "CN", "USD", "CN")


def ts(s: str) -> datetime:
    return datetime.fromisoformat(s)


def sub(*events: Event, coupon_id: str | None = None) -> Subscription:
    create = Event("E0", "create", ts("2026-06-05T10:00:00+08:00"), {"plan_id": "team", "quantity": 3})
    return Subscription("SUB-0001", "C-0001", date(2026, 6, 5), 5, coupon_id, [create, *events])


def test_plain_monthly_invoices():
    invs = build_invoices(CN, sub(), PLANS, None, RATES, until=date(2026, 8, 5))
    assert [i.period_start for i in invs] == [date(2026, 6, 5), date(2026, 7, 5), date(2026, 8, 5)]
    first = invs[0]
    assert (first.subtotal, first.tax, first.total) == (D("117.00"), D("7.02"), D("124.02"))
    assert first.id == "INV-0001-01"


def test_upgrade_prorates_on_next_invoice():
    up = Event("E1", "upgrade", ts("2026-06-20T10:00:00+08:00"), {"plan_id": "business"})
    june, july = build_invoices(CN, sub(up), PLANS, None, RATES, until=date(2026, 7, 5))
    assert june.total == D("124.02")  # 6 月那张已经开出,不受升级影响
    amounts = [(ln.kind, ln.amount) for ln in july.lines]
    assert ("proration", D("-58.50")) in amounts  # 团队版 117 × 15/30
    assert ("proration", D("133.50")) in amounts  # 商业版 267 × 15/30
    assert ("recurring", D("267.00")) in amounts
    assert (july.subtotal, july.tax, july.total) == (D("342.00"), D("20.52"), D("362.52"))


def test_event_date_uses_customer_timezone():
    # UTC 6 月 19 日 16:30 = 上海 6 月 20 日 00:30(Day 677 练习 2)
    assert local_date(ts("2026-06-19T16:30:00+00:00"), "CN") == date(2026, 6, 20)
    up = Event("E1", "upgrade", ts("2026-06-19T16:30:00+00:00"), {"plan_id": "business"})
    july = build_invoices(CN, sub(up), PLANS, None, RATES, until=date(2026, 7, 5))[1]
    assert july.lines[0].amount == D("-58.50")  # 按 15 天算,不是 16 天


def test_percent_coupon_only_within_duration():
    coupon = Coupon("WELCOME20", "percent", D("20"), 2)
    invs = build_invoices(CN, sub(coupon_id="WELCOME20"), PLANS, coupon, RATES, until=date(2026, 8, 5))
    assert [i.discount for i in invs] == [D("23.40"), D("23.40"), D("0.00")]
    assert invs[0].tax == D("5.62")  # (117 - 23.40) × 6% = 5.616
    assert invs[0].total == D("99.22")


def test_coupon_applies_to_proration_too():
    coupon = Coupon("WELCOME20", "percent", D("20"), 3)
    up = Event("E1", "upgrade", ts("2026-06-20T10:00:00+08:00"), {"plan_id": "business"})
    july = build_invoices(CN, sub(up, coupon_id="WELCOME20"), PLANS, coupon, RATES, until=date(2026, 7, 5))[1]
    assert (july.discount, july.tax, july.total) == (D("68.40"), D("16.42"), D("290.02"))  # Day 679 手算


def test_cancel_stops_after_period_end():
    cancel = Event("E1", "cancel", ts("2026-07-10T12:00:00+08:00"), {})
    invs = build_invoices(CN, sub(cancel), PLANS, None, RATES, until=date(2026, 9, 5))
    assert [i.period_start for i in invs] == [date(2026, 6, 5), date(2026, 7, 5)]
    assert expected_for_period(CN, sub(cancel), PLANS, None, RATES, date(2026, 8, 5)) is None


def test_tax_rate_follows_validity_window():
    sg = Customer("C-0002", "Bluefin Labs", "SG", "USD", "SG")
    inv = build_invoices(sg, sub(), PLANS, None, RATES, until=date(2026, 6, 5))[0]
    assert inv.lines[-1].tax_code == "SG-GST9"
    assert inv.tax == D("10.53")  # 117 × 9%


def test_quantity_change_with_amount_coupon():
    qty = Event("E1", "quantity_change", ts("2026-07-12T08:00:00+08:00"), {"quantity": 5})
    coupon = Coupon("LAUNCH10", "amount", D("10.00"), 3)
    aug = build_invoices(CN, sub(qty, coupon_id="LAUNCH10"), PLANS, coupon, RATES, until=date(2026, 8, 5))[2]
    # 7/12 到 8/5 剩 24 天,周期 31 天:退 117 × 24/31,收 195 × 24/31,再收 8 月整月 195
    assert [ln.amount for ln in aug.lines] == [D("-90.58"), D("150.97"), D("195.00"), D("-10.00"), D("14.72")]
    assert aug.total == D("260.11")
```

<div class="line-notes">

- `from billsleuth.engine import (` 导入的名字多,用括号分行写,每行一个。这是 Python 的格式习惯,和 JS 多行 import 一样。
- `PLANS = {` 测试自己带一份小价目表,不依赖 `refdata.py`。正式价目表哪天调价,这些测试也不会跟着变。
- `RATES = [` 三条税率,SG 那两条专门用来测有效期。
- `def ts(s: str) -> datetime:` 小工具,少写几遍 `datetime.fromisoformat`。
- `def sub(*events: Event, coupon_id: str | None = None) -> Subscription:` 造一份标准订阅:6 月 5 日开通团队版 3 席。`*events` 收任意多个额外事件;`coupon_id` 写在 `*events` 后面,调用时必须写成 `coupon_id="..."`,不会和事件混在一起。
- `return Subscription("SUB-0001", "C-0001", date(2026, 6, 5), 5, coupon_id, [create, *events])` `[create, *events]` 把开通事件和其他事件拼成一个列表,`*` 在这里是展开,相当于 JS 的 `[create, ...events]`。
- `assert [i.period_start for i in invs] == [date(2026, 6, 5), date(2026, 7, 5), date(2026, 8, 5)]` 规则一:按锚点日每月开一张,until 当天那期也开。
- `assert (first.subtotal, first.tax, first.total) == (D("117.00"), D("7.02"), D("124.02"))` 117 × 6% = 7.02。三个值打包成元组一起比,失败时一次看到三个数。
- `june, july = build_invoices(CN, sub(up), PLANS, None, RATES, until=date(2026, 7, 5))` 列表解包:正好两张,分别给两个变量。要是引擎开出了三张,这一行就会报 `ValueError: too many values to unpack`,也算一种检查。
- `assert june.total == D("124.02")  # 6 月那张已经开出,不受升级影响` 规则二的前半句:升级不改已经开出的发票。
- `assert ("proration", D("-58.50")) in amounts` `in` 判断列表里有没有这个元组,不关心顺序。
- `assert local_date(ts("2026-06-19T16:30:00+00:00"), "CN") == date(2026, 6, 20)` 规则三:事件日期按客户本地日期算。先测小工具本身。
- `assert july.lines[0].amount == D("-58.50")  # 按 15 天算,不是 16 天` 再测它在引擎里起作用。按 UTC 日期是 6 月 19 日,剩 16 天,会退 62.40。
- `coupon = Coupon("WELCOME20", "percent", D("20"), 2)` 规则四:优惠券只在有效月份里生效。这里故意用 2 个月的券,第三期就该没折扣了。
- `assert [i.discount for i in invs] == [D("23.40"), D("23.40"), D("0.00")]` 117 × 20% = 23.40,前两期有,第三期没有。
- `assert invs[0].tax == D("5.62")  # (117 - 23.40) × 6% = 5.616` 税按折扣后的金额算,5.616 舍入 5.62。
- `def test_coupon_applies_to_proration_too():` 规则五:百分比券作用在整个小计上,包括折算行。期望值是 Day 679 的手算结果。Day 682 的「券算错基数」故障就违反这一条。
- `cancel = Event("E1", "cancel", ts("2026-07-10T12:00:00+08:00"), {})` 规则六:7 月 10 日申请取消,7 月这期照常,8 月起不再开。
- `assert expected_for_period(CN, sub(cancel), PLANS, None, RATES, date(2026, 8, 5)) is None` 8 月那期本不该有发票。`is None` 是判断空值的标准写法。
- `sg = Customer("C-0002", "Bluefin Labs", "SG", "USD", "SG")` 规则七:税率按有效期取。2026 年的新加坡客户应该用 9%,不是 2023 年那条 8%。
- `assert inv.lines[-1].tax_code == "SG-GST9"` `[-1]` 取最后一个元素,也就是税行,相当于 JS 的 `.at(-1)`。
- `def test_quantity_change_with_amount_coupon():` 规则八:改席位也折算,而且和定额券叠加。这条的期望值是我写测试前用计算器算的,算式写在注释里。
- `assert [ln.amount for ln in aug.lines] == [D("-90.58"), D("150.97"), D("195.00"), D("-10.00"), D("14.72")]` 117 × 24 / 31 = 90.58;5 席 195 × 24 / 31 = 150.97;8 月整月 195;LAUNCH10 第 3 个月还有效,减 10;(−90.58 + 150.97 + 195 − 10) × 6% = 14.7234,舍入 14.72。这次直接比较整个列表,连行的顺序也钉住了。

</div>

```bash
uv run pytest tests/test_engine.py -v
```

```text
tests/test_engine.py::test_plain_monthly_invoices PASSED                 [ 12%]
tests/test_engine.py::test_upgrade_prorates_on_next_invoice PASSED       [ 25%]
tests/test_engine.py::test_event_date_uses_customer_timezone PASSED      [ 37%]
tests/test_engine.py::test_percent_coupon_only_within_duration PASSED    [ 50%]
tests/test_engine.py::test_coupon_applies_to_proration_too PASSED        [ 62%]
tests/test_engine.py::test_cancel_stops_after_period_end PASSED          [ 75%]
tests/test_engine.py::test_tax_rate_follows_validity_window PASSED       [ 87%]
tests/test_engine.py::test_quantity_change_with_amount_coupon PASSED     [100%]
============================== 8 passed in 0.03s ===============================
```

八条全绿。每个测试名就是一条规则,三个月后有人问「取消以后到底还收不收这个月」,翻测试名就有答案。测试在这里同时是文档。

### 故意换一个顺序

现在扮演一个「觉得事件应该先处理」的同事:把 `build_invoices` 循环里从 `days = (pe - ps).days` 开始的整段事件处理,剪切到 `inv = Invoice(...)` 那一行的前面,其他一个字不改。逻辑上好像也说得通:「先把这期发生了什么弄清楚,再开账嘛」。跑测试:

```text
>       assert june.total == D("124.02")  # 6 月那张已经开出,不受升级影响
E       AssertionError: assert Decimal('362.52') == Decimal('124.02')
>       assert july.lines[0].amount == D("-58.50")  # 按 15 天算,不是 16 天
E       AssertionError: assert Decimal('267.00') == Decimal('-58.50')
>       assert (july.discount, july.tax, july.total) == (D("68.40"), D("16.42"), D("290.02"))  # Day 679 手算
E       AssertionError: assert (Decimal('53....mal('226.42')) == (Decimal('68....mal('290.02'))
>       assert [ln.amount for ln in aug.lines] == [D("-90.58"), D("150.97"), D("195.00"), D("-10.00"), D("14.72")]
E       AssertionError: assert [Decimal('195...imal('11.10')] == [Decimal('-90...imal('14.72')]
FAILED tests/test_engine.py::test_upgrade_prorates_on_next_invoice - Assertio...
FAILED tests/test_engine.py::test_event_date_uses_customer_timezone - Asserti...
FAILED tests/test_engine.py::test_coupon_applies_to_proration_too - Assertion...
FAILED tests/test_engine.py::test_quantity_change_with_amount_coupon - Assert...
4 failed, 4 passed in 0.08s
```

(每条失败后面 pytest 还打了好几行对象详情,我只留了关键的。)四条红了,而且红得很有信息量:6 月那张发票变成了 362.52,也就是说 6 月 5 日开出的发票提前收了 6 月 20 日之后的商业版和折算;7 月那张第一行变成了订阅费,折算行跑到上一张去了。四条绿的测试(不涉及周期中途事件的)看不出任何变化。把代码改回去,八条全绿。

一个顺序问题,读代码很难一眼看出,测试一秒就抓到了。这就是「用单测把规则钉死」的意思:**规则写进测试以后,任何人改代码时违反了它,测试会第一个告诉他**,不用等客户打电话来。

## 价目表和税率

最后补上正式的参考数据。和测试里那份小价目表不同,这份是造数据和复算工具共用的:

```python
# billsleuth/billsleuth/refdata.py  云簿 CloudLedger 的价目表、优惠券和税率表,全部虚构,只用于练习
from datetime import date
from decimal import Decimal as D

from billsleuth.engine import Coupon, Plan, TaxRate

PLANS = {p.id: p for p in [
    Plan("starter", "入门版", "month", D("15.00")),
    Plan("team", "团队版", "month", D("39.00")),
    Plan("business", "商业版", "month", D("89.00")),
    Plan("team-y", "团队版(年付)", "year", D("390.00")),
    Plan("business-y", "商业版(年付)", "year", D("890.00")),
]}

COUPONS = {c.id: c for c in [
    Coupon("WELCOME20", "percent", D("20"), 3),
    Coupon("LAUNCH10", "amount", D("10.00"), 3),
    Coupon("SPRING15", "percent", D("15"), 6),
]}

# 地区和税率都是虚构的练习数据,不代表任何地方的真实税法。
# US-DST 故意设计成 2026-07-01 从 5% 降到 3%,给「用了过期税率」这类故障留位置。
TAX_RATES = [
    TaxRate("CN-VAT6", "CN", D("0.06"), date(2016, 5, 1), None),
    TaxRate("SG-GST8", "SG", D("0.08"), date(2023, 1, 1), date(2023, 12, 31)),
    TaxRate("SG-GST9", "SG", D("0.09"), date(2024, 1, 1), None),
    TaxRate("DE-VAT19", "DE", D("0.19"), date(2007, 1, 1), None),
    TaxRate("US-DST5", "US", D("0.05"), date(2024, 1, 1), date(2026, 6, 30)),
    TaxRate("US-DST3", "US", D("0.03"), date(2026, 7, 1), None),
]
```

<div class="line-notes">

- `PLANS = {p.id: p for p in [` 字典推导式,[Day 23](/blog/agent-zero/day-023-comprehensions/) 见过:把一个列表变成「id → 对象」的字典,相当于 JS 的 `Object.fromEntries(list.map(p => [p.id, p]))`。这样写 id 只出现一次,不会写成 `"team": Plan("tema", ...)` 这种对不上的笔误。
- `Plan("starter", "入门版", "month", D("15.00")),` 新加一个入门版,15 美元一席。套餐 id 和 Day 680 草稿里的 `team`、`business` 保持一致。
- `Plan("team-y", "团队版(年付)", "year", D("390.00")),` 年付是月付的 10 倍,相当于送两个月。年付和月付不能互换,引擎会报错。
- `Coupon("SPRING15", "percent", D("15"), 6),` 一张有效期长的百分比券,Day 682 造「券算错基数」时专门用它:升级发生在第 2 个月,券还在有效期内。
- `# 地区和税率都是虚构的练习数据` 这句注释必须有。CN、SG、DE 的数字取了常见税率的整数,方便手算,真实的税务规则复杂得多。
- `TaxRate("US-DST5", "US", D("0.05"), date(2024, 1, 1), date(2026, 6, 30)),` 虚构的「数字服务税」,6 月 30 日到期,当天还有效。
- `TaxRate("US-DST3", "US", D("0.03"), date(2026, 7, 1), None),` 7 月 1 日起降到 3%。为什么编一个降税的例子?因为「用了过期税率」只有在新税率更低时才会让客户多付钱,客户才会来投诉。

</div>

用它跑一个美国客户:5 月 12 日开通团队版 4 席,带一张 LAUNCH10,8 月 20 日申请取消。

```python
# billsleuth/scratch/try_refdata.py  用正式价目表和税率表开账,看税率在 7 月 1 日那一刀
from datetime import date, datetime

from billsleuth.engine import Customer, Event, Subscription, build_invoices, expected_for_period
from billsleuth.refdata import COUPONS, PLANS, TAX_RATES

us = Customer("C-0003", "Northwind Studio", "US", "USD", "US")
create = Event("E1", "create", datetime.fromisoformat("2026-05-12T10:00:00-07:00"), {"plan_id": "team", "quantity": 4})
cancel = Event("E2", "cancel", datetime.fromisoformat("2026-08-20T09:00:00-07:00"), {})
sub = Subscription("SUB-0003", "C-0003", date(2026, 5, 12), 12, "LAUNCH10", [create, cancel])
coupon = COUPONS["LAUNCH10"]

for inv in build_invoices(us, sub, PLANS, coupon, TAX_RATES, until=date(2026, 10, 15)):
    print(f"{inv.id}  {inv.period_start}  小计 {inv.subtotal}  折扣 {inv.discount}  税 {inv.tax} "
          f"({inv.lines[-1].tax_code})  合计 {inv.total}")
print("9 月 12 日那期应该开吗:", expected_for_period(us, sub, PLANS, coupon, TAX_RATES, date(2026, 9, 12)))
```

<div class="line-notes">

- `datetime.fromisoformat("2026-05-12T10:00:00-07:00")` 洛杉矶夏令时是 UTC−7,写成本地时间也带上偏移。
- `sub = Subscription("SUB-0003", "C-0003", date(2026, 5, 12), 12, "LAUNCH10", [create, cancel])` 锚点日 12,绑了 LAUNCH10。
- `coupon = COUPONS["LAUNCH10"]` 引擎要的是 Coupon 对象,不是 id,从字典里取出来。
- `f"({inv.lines[-1].tax_code})  合计 {inv.total}")` 两个 f-string 挨着写会自动拼成一个,跨行写长字符串的常用办法。
- `expected_for_period(us, sub, PLANS, coupon, TAX_RATES, date(2026, 9, 12))` 取消之后那一期,应该是 None。

</div>

```bash
uv run python -m scratch.try_refdata
```

```text
INV-0003-01  2026-05-12  小计 156.00  折扣 10.00  税 7.30 (US-DST5)  合计 153.30
INV-0003-02  2026-06-12  小计 156.00  折扣 10.00  税 7.30 (US-DST5)  合计 153.30
INV-0003-03  2026-07-12  小计 156.00  折扣 10.00  税 4.38 (US-DST3)  合计 150.38
INV-0003-04  2026-08-12  小计 156.00  折扣 0.00  税 4.68 (US-DST3)  合计 160.68
9 月 12 日那期应该开吗: None
```

四行里能读出三条规则:39 × 4 = 156;前三期减 10(5、6、7 月),第四期券到期;税在 7 月 12 日那期从 5% 换成 3%,(156 − 10) × 3% = 4.38;8 月申请取消,8 月这期照开,9 月起没有了。8 月那张反而比 7 月贵,因为券到期了。客户看到这张大概会来问「怎么涨价了」,而账其实没错,这正是 Day 682 要造的「没错的场景」之一。

## 今天的文件

| 零件 | 文件 | 新建还是修改 | 后面哪天用到 |
| --- | --- | --- | --- |
| 八个数据类 | `billsleuth/engine.py` 上半部分 | 新建 | Day 682 故障注入,Day 683 repo.py |
| 四个小工具 | `engine.py` 的 `add_months`、`local_date`、`months_between`、`rate_on` | 新建 | Day 682 造数,Day 683 时间线工具 |
| 折扣和税 | `engine.py` 的 `apply_discount_and_tax` | 新建 | Day 682 注入后重算 |
| 主循环 | `engine.py` 的 `build_invoices`(第四步第一版,第五步完整版) | 新建 | Day 682、683 全程 |
| 某一期应收 | `engine.py` 的 `expected_for_period` | 新建 | Day 683 `recompute_invoice` |
| 规则测试 | `tests/test_engine.py` | 新建 | 每次改引擎 |
| 价目表、优惠券、税率 | `billsleuth/refdata.py` | 新建 | Day 682 造数 |
| 草稿 | `scratch/mutable_default.py`、`try_invoice.py`、`try_helpers.py`、`try_discount_tax.py`、`try_build.py`、`try_refdata.py` | 新建 | |

`uv run pytest` 现在一共 21 条:Day 680 的 13 条加今天 8 条。做完练习 1 和 3 是 24 条。今天全部不调模型,花费 0 元。

## 动手练习

**练习 1:降级也要测。** 客户 6 月 5 日开通商业版 3 席,上海时间 7 月 20 日 15:00 降级到团队版。先手算 8 月 5 日那张发票的每一行和合计,再写成测试 `tests/test_engine_more.py::test_downgrade_in_31_day_period`,用 `refdata.py` 的价目表和税率。

<details><summary>参考答案</summary>

手算:7 月 5 日到 8 月 5 日是 31 天,7 月 20 日起剩 16 天。退商业版 267 × 16 / 31 = 137.806…,舍入 137.81;收团队版 117 × 16 / 31 = 60.387…,舍入 60.39;8 月整月团队版 117.00。小计 −137.81 + 60.39 + 117.00 = 39.58,税 39.58 × 6% = 2.3748,舍入 2.37,合计 41.95。

```python
# billsleuth/tests/test_engine_more.py  练习 1 和练习 3:降级、年付、月付年付互换
from datetime import date, datetime
from decimal import Decimal as D

import pytest

from billsleuth.engine import Customer, Event, Subscription, build_invoices
from billsleuth.refdata import PLANS, TAX_RATES

CN = Customer("C-0001", "青禾记账工作室", "CN", "USD", "CN")


def ts(s: str) -> datetime:
    return datetime.fromisoformat(s)


def test_downgrade_in_31_day_period():
    create = Event("E0", "create", ts("2026-06-05T10:00:00+08:00"), {"plan_id": "business", "quantity": 3})
    down = Event("E1", "downgrade", ts("2026-07-20T15:00:00+08:00"), {"plan_id": "team"})
    sub = Subscription("SUB-0001", "C-0001", date(2026, 6, 5), 5, None, [create, down])
    aug = build_invoices(CN, sub, PLANS, None, TAX_RATES, until=date(2026, 8, 5))[2]
    assert [ln.amount for ln in aug.lines] == [D("-137.81"), D("60.39"), D("117.00"), D("2.37")]
    assert aug.total == D("41.95")
```

<div class="line-notes">

- `import pytest` 练习 3 要用 `pytest.raises`,这个文件先导入。
- `from billsleuth.refdata import PLANS, TAX_RATES` 这次用正式价目表,和 `test_engine.py` 自带小价目表的做法不同。两种都可以:自带的更稳定,用正式的能顺便测到 refdata 本身。
- `down = Event("E1", "downgrade", ts("2026-07-20T15:00:00+08:00"), {"plan_id": "team"})` 降级事件和升级一样只带新套餐。引擎不区分升级降级,算法完全相同,只是退的比收的多。
- `aug = build_invoices(CN, sub, PLANS, None, TAX_RATES, until=date(2026, 8, 5))[2]` 第三张就是 8 月那张。
- `assert [ln.amount for ln in aug.lines] == [D("-137.81"), D("60.39"), D("117.00"), D("2.37")]` 期望值是上面手算的四行。

</div>

```bash
uv run pytest tests/test_engine_more.py -v
```

```text
tests/test_engine_more.py::test_downgrade_in_31_day_period PASSED        [ 33%]
```

(这是加完练习 3 之后的输出,所以显示 33%。)一次就过了。注意 8 月这张合计只有 41.95,比平时的 124.02 少很多,因为退了半个月的商业版差价。

</details>

**练习 2:观察会发生什么。** 把 `build_invoices` 里的 `d = local_date(ev.effective_at, customer.country)` 改成 `d = ev.effective_at.date()`(不换时区,直接取日期),跑 `tests/test_engine.py`。有几条会红?为什么只有这几条?

<details><summary>参考答案</summary>

```python
            d = ev.effective_at.date()  # 练习 2:故意不换时区
```

<div class="line-notes">

- `d = ev.effective_at.date()` 带时区的 datetime 直接 `.date()`,取的是它自己那个时区里的日期,不会换成客户的时区。

</div>

```bash
uv run pytest tests/test_engine.py -q
```

```text
>       assert july.lines[0].amount == D("-58.50")  # 按 15 天算,不是 16 天
E       AssertionError: assert Decimal('-62.40') == Decimal('-58.50')
FAILED tests/test_engine.py::test_event_date_uses_customer_timezone - Asserti...
1 failed, 7 passed in 0.12s
```

只红了一条。那条测试的事件写的是 UTC 时间 `16:30:00+00:00`,`.date()` 得到 6 月 19 日,剩 16 天,117 × 16 / 30 = 62.40。其他测试的事件都写成上海时间的白天(`10:00:00+08:00`),`.date()` 取的本来就是上海日期,改不改结果一样。

这说明两件事。第一,时区测试必须专门挑「跨日」的时刻,凌晨 0 点到 8 点之间的上海时间,UTC 日期才会差一天。第二,要是测试里所有事件都写成本地白天,这个 bug 会悄无声息地合进去,和 Day 680「测试数据要落在半分上」是同一类教训。看完改回 `local_date`。

</details>

**练习 3:年付和「不支持」也要测。** 在 `test_engine_more.py` 里再加两条:年付团队版 2 席 2025 年 10 月 8 日开通、2026 年 4 月 8 日加到 3 席,检查两张年度发票;月付团队版升级到年付团队版,检查引擎会报错。

<details><summary>参考答案</summary>

手算年付:第一年 390 × 2 = 780,税 46.80,合计 826.80。2026 年 4 月 8 日到 10 月 8 日剩 183 天,整期 365 天:退 780 × 183 / 365 = 391.068…,舍入 391.07;收 3 席 1170 × 183 / 365 = 586.602…,舍入 586.60。

```python
def test_yearly_plan_and_quantity_change():
    create = Event("E0", "create", ts("2025-10-08T10:00:00+08:00"), {"plan_id": "team-y", "quantity": 2})
    more = Event("E1", "quantity_change", ts("2026-04-08T10:00:00+08:00"), {"quantity": 3})
    sub = Subscription("SUB-0002", "C-0001", date(2025, 10, 8), 8, None, [create, more])
    first, second = build_invoices(CN, sub, PLANS, None, TAX_RATES, until=date(2026, 10, 15))
    assert (first.period_start, first.period_end, first.total) == (date(2025, 10, 8), date(2026, 10, 8), D("826.80"))
    # 2026-04-08 到 2026-10-08 剩 183 天,整期 365 天
    assert [ln.amount for ln in second.lines[:2]] == [D("-391.07"), D("586.60")]


def test_month_to_year_is_rejected():
    create = Event("E0", "create", ts("2026-06-05T10:00:00+08:00"), {"plan_id": "team", "quantity": 3})
    up = Event("E1", "upgrade", ts("2026-06-20T10:00:00+08:00"), {"plan_id": "team-y"})
    sub = Subscription("SUB-0003", "C-0001", date(2026, 6, 5), 5, None, [create, up])
    with pytest.raises(ValueError, match="月付和年付"):
        build_invoices(CN, sub, PLANS, None, TAX_RATES, until=date(2026, 7, 5))
```

<div class="line-notes">

- `create = Event("E0", "create", ts("2025-10-08T10:00:00+08:00"), {"plan_id": "team-y", "quantity": 2})` 年付套餐,`step` 会变成 12。
- `first, second = build_invoices(CN, sub, PLANS, None, TAX_RATES, until=date(2026, 10, 15))` 算到 2026 年 10 月 15 日,正好两期:2025-10-08 和 2026-10-08。
- `assert (first.period_start, first.period_end, first.total) == (date(2025, 10, 8), date(2026, 10, 8), D("826.80"))` 一期是一整年,`add_months(..., 12, 8)` 算出来的。
- `assert [ln.amount for ln in second.lines[:2]] == [D("-391.07"), D("586.60")]` `[:2]` 取前两个元素,就是两条折算行。2026 年 4 月 8 日加的席位,折算记在下一张年度发票上,也就是半年后。这条规则对年付客户其实不太友好,真实系统往往会立刻开一张补差价的发票,这里先照云簿的统一规则来,Day 690 讲贷记单时会再提一次「规则对客户友不友好」。
- `with pytest.raises(ValueError, match="月付和年付"):` 不光要求报 ValueError,还要求错误信息里有这几个字,Day 680 练习 2 讲过为什么要加 `match`。

</div>

```bash
uv run pytest tests/test_engine_more.py -v
```

```text
tests/test_engine_more.py::test_downgrade_in_31_day_period PASSED        [ 33%]
tests/test_engine_more.py::test_yearly_plan_and_quantity_change PASSED   [ 66%]
tests/test_engine_more.py::test_month_to_year_is_rejected PASSED         [100%]
============================== 3 passed in 0.03s ===============================
```

</details>

**练习 4:随机造很多订阅,检查不变量。** 写一个脚本,用固定随机种子造 500 个月付订阅(随机国家、锚点日、席位、优惠券,0 到 3 个随机事件),检查两条不管什么输入都必须成立的性质:同一订阅的周期不重叠;每张发票的合计等于小计 − 折扣 + 税。顺便数一数有没有合计为负数的发票。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex4_invariants.py  练习 4:随机造 500 个订阅,检查两条不变量
import random
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from billsleuth.engine import COUNTRY_TZ, Customer, Event, Subscription, build_invoices
from billsleuth.money import money
from billsleuth.refdata import COUPONS, PLANS, TAX_RATES

rng = random.Random(681)
MONTHLY = ["starter", "team", "business"]
checked = negative = 0
example = None
for i in range(500):
    country = rng.choice(list(COUNTRY_TZ))
    cust = Customer(f"C-{i:04d}", "随机客户", country, "USD", country)
    anchor = rng.randint(1, 28)
    start = date(2026, rng.choice([5, 6]), anchor)
    tz = ZoneInfo(COUNTRY_TZ[country])
    events = [Event("E0", "create", datetime(start.year, start.month, start.day, 10, tzinfo=tz),
                    {"plan_id": rng.choice(MONTHLY), "quantity": rng.randint(1, 12)})]
    for j in range(rng.randint(0, 3)):
        when = datetime.combine(start + timedelta(days=rng.randint(1, 120)), datetime.min.time(), tz)
        when += timedelta(hours=rng.randint(0, 23))
        kind = rng.choice(["upgrade", "quantity_change", "cancel", "pause", "resume"])
        payload = {"plan_id": rng.choice(MONTHLY)} if kind == "upgrade" else {"quantity": rng.randint(1, 12)}
        events.append(Event(f"E{j + 1}", kind, when, payload if kind in ("upgrade", "quantity_change") else {}))
    coupon_id = rng.choice([None, "WELCOME20", "LAUNCH10"])
    sub = Subscription(f"SUB-{i:04d}", cust.id, start, anchor, coupon_id, events)
    invs = build_invoices(cust, sub, PLANS, COUPONS.get(coupon_id or ""), TAX_RATES, until=date(2026, 10, 15))
    for a, b in zip(invs, invs[1:]):
        assert a.period_end <= b.period_start, (sub.id, a.id, b.id)  # 周期不重叠
    for inv in invs:
        assert inv.total == money(inv.subtotal - inv.discount + inv.tax), inv.id  # 合计对得上
        checked += 1
        if inv.total < 0:
            negative += 1
            example = inv
print(f"检查了 {checked} 张发票,两条不变量都成立;合计为负的发票 {negative} 张")
if example:
    print(example.id, [(ln.kind, str(ln.amount)) for ln in example.lines])
```

<div class="line-notes">

- `rng = random.Random(681)` 自己建一个随机数生成器并固定种子,每次跑出来的 500 个订阅一模一样。[Day 112](/blog/agent-zero/day-112-sampling-2/) 讲过种子和可复现。不用模块级的 `random.randint`,是为了不和别的代码共用同一个随机状态。
- `country = rng.choice(list(COUNTRY_TZ))` 从四个国家里随机挑一个。`list(字典)` 得到所有键。
- `events = [Event("E0", "create", datetime(start.year, start.month, start.day, 10, tzinfo=tz),` 开通时间是客户本地上午 10 点。
- `when = datetime.combine(start + timedelta(days=rng.randint(1, 120)), datetime.min.time(), tz)` 开通后 1 到 120 天之间随机挑一天的零点。`datetime.combine(日期, 时间, 时区)` 把三样拼成一个时刻。
- `when += timedelta(hours=rng.randint(0, 23))` 再随机加几个小时,凌晨的事件也会出现,时区跨日的情况能被覆盖到。
- `payload = {"plan_id": rng.choice(MONTHLY)} if kind == "upgrade" else {"quantity": rng.randint(1, 12)}` 升级带套餐,其他带席位;下一行再把取消、暂停、恢复的 payload 换成空字典。「升级」到更便宜的套餐也会出现,引擎不区分升降级。
- `COUPONS.get(coupon_id or "")` `coupon_id` 是 None 时 `or ""` 换成空字符串,`get` 查不到返回 None,正好表示没券。
- `for a, b in zip(invs, invs[1:]):` `zip` 把两个列表一一配对,`invs[1:]` 是去掉第一个的列表,所以每次拿到相邻的两张发票。
- `assert a.period_end <= b.period_start, (sub.id, a.id, b.id)  # 周期不重叠` assert 后面逗号接的东西会在失败时打出来,方便定位是哪个订阅。暂停会让中间空一期,所以是 `<=` 不是 `==`。
- `assert inv.total == money(inv.subtotal - inv.discount + inv.tax), inv.id` 第二条不变量。

</div>

```bash
uv run python -m scratch.ex4_invariants
```

```text
检查了 1932 张发票,两条不变量都成立;合计为负的发票 35 张
INV-0469-05 [('proration', '-258.39'), ('proration', '57.42'), ('recurring', '178.00'), ('tax', '-1.38')]
```

两条不变量在 1932 张发票上都成立。但随机测试顺手发现了一件我写引擎时没想到的事:有 35 张发票合计是负数,连税都是负的。看例子:客户从商业版大量席位降到很少的席位,退的 258.39 比新收的加起来还多。真实系统一般不会开一张负数发票,而是把多出来的钱记成客户的「账户余额」(Stripe 叫 customer credit balance),下个月自动抵扣。云簿的引擎没做余额,这是一个要写进 PRD 非目标的简化;Day 682 造数时只造升级和小幅减席位,不会碰到这种情况。

还要老实说一句:第二条不变量在今天的引擎里几乎不可能被违反,因为合计和小计、折扣、税都是从同一批行项目加出来的。它防的是以后有人给 `Line` 加了第六种 `kind` 却忘了算进小计。Day 682 会写一条更有用的不变量。这种「随机生成大量输入、检查性质」的测试叫基于性质的测试,Python 里有现成的库 Hypothesis,它还能在失败时自动把输入缩到最小,今天先用 `random` 手写体会一下思路。

</details>

**验收标准:** `uv run pytest` 24 条全绿;能不看文章画出 `build_invoices` 一期循环的六步,并说清楚为什么事件处理放在开账之后;能手算 Day 677 那张 7 月发票的 362.52 和带八折券的 290.02;能说出练习 2 为什么只有一条测试变红;`refdata.py` 里 US 税率为什么要设计成降税。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 参考引擎(reference engine) | 按公司对外承诺的计费规则算出「应收」的代码,是标准答案的来源,例子:`build_invoices` |
| `field(default_factory=list)` | dataclass 里给可变字段设默认值的写法,每造一个对象调用一次 `list()`,各自一个新列表 |
| 可变默认值(mutable default) | 默认值只在定义时算一次,列表、字典这类会被所有对象共用,dataclass 直接拒绝 |
| `divmod` | 一次返回商和余数,`divmod(12, 12)` 得 `(1, 0)` |
| `pending` 折算行 | 本期发生的改动产生的折算,先攒着,记到下一张发票上 |
| 到期取消 | 申请取消后本期照常,本期结束日之后不再开票 |
| `expected_for_period` | 某个周期「应该」开出的发票,本不该开就返回 None |
| 规则测试 | 一条计费规则一条测试,期望值来自手算,测试名就是规则 |
| 不变量(invariant) | 不管输入是什么都必须成立的性质,如周期不重叠 |
| 基于性质的测试(property-based testing) | 随机生成大量输入检查不变量,Python 里的代表库是 Hypothesis |
| 价目表 / 参考数据(reference data) | 套餐、优惠券、税率这类很少变、被很多地方共用的数据,放在 `refdata.py` |
| 账户余额(credit balance) | 客户多付的钱记在账上、下期抵扣,云簿的引擎没有实现,所以会出现负数发票 |

## 常见误区

**dataclass 里写 `lines: list = []`。** 实测直接报 `ValueError: mutable default <class 'list'> for field lines is not allowed: use default_factory`。改成 `field(default_factory=list)`。

**引擎从订阅表读当前套餐。** 订阅表是快照,只知道现在。引擎只读事件,6 月那期用 6 月的套餐,7 月那期用 7 月的。

**先处理事件再开账。** 6 月 5 日开出的发票会提前收 6 月 20 日之后的钱。实测四条测试变红,6 月那张从 124.02 变成 362.52。

**取事件日期时先 `.date()` 再换时区。** 拿到的是 UTC 那天,上海凌晨的升级会多折算一天。先 `astimezone` 再 `.date()`。

**时区测试的事件都写成本地白天。** 练习 2 里只有一条跨日的测试抓到了 bug。专门放凌晨的事件。

**查不到税率时返回 0。** 等于悄悄免了税,发票还能对得上合计,很难发现。直接抛 `LookupError`。

**测试的期望值是先跑一遍引擎抄下来的。** 那测的只是「代码和它自己一致」。期望值来自手算,算式写在注释里。

**`Decimal(...).normalize()` 直接拿来显示。** 0.10 × 100 会变成 `1E+1`。加 `:f` 格式化。

**用 `cp` 把改坏的文件换回去,结果却没变。** 我做「故意换顺序」那个实验时,用 `cp` 在两个版本之间来回换 `engine.py`,换回正确版本以后引擎还在按错的顺序算。原因是两个版本字节数一样,又在同一秒内被改写,Python 判断 `__pycache__` 里的缓存是否过期只看源文件的修改时间(精确到秒)和大小,于是一直用着旧的编译结果。用编辑器正常改文件不会遇到;遇到「代码改了结果不变」,先 `find . -name __pycache__ -not -path './.venv/*' -exec rm -rf {} +` 删掉缓存再跑。

**想把引擎写得「通用」。** 参考引擎的目标是和云簿的规则完全一致。规则以外的情况(月付改年付)直接报错。

## 学习资料

### 文档与文章

- [Python 文档 · dataclasses](https://docs.python.org/zh-cn/3.12/library/dataclasses.html):看「可变默认值」那一节,今天那个报错的来龙去脉,中文,15 分钟。
- [Python 文档 · zoneinfo](https://docs.python.org/zh-cn/3.12/library/zoneinfo.html):`ZoneInfo` 和 `astimezone` 的用法,中文,10 分钟。
- [pytest · How to parametrize](https://docs.pytest.org/en/stable/how-to/parametrize.html):想把 `test_engine.py` 里相似的几条合成一张表时看,15 分钟。
- [Stripe · Prorations](https://docs.stripe.com/billing/subscriptions/prorations):对照我们的规则,看 Stripe 在哪些操作上默认折算、可以怎么改成立刻开票,15 分钟。
- [Stripe · Tax rates](https://docs.stripe.com/billing/taxes/tax-rates):真实系统里税率对象有哪些字段,和我们的 `TaxRate` 对照,10 分钟。
- [Martin Fowler · Unit Test](https://martinfowler.com/bliki/UnitTest.html):「单元」到底多大、要不要隔离依赖,读完能讲清楚为什么引擎测试不连数据库,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV15zSVYtE13&autoplay=0&high_quality=1" title="【Py】dataclass:懂事的类会自己生成方法 | Python特性" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Hucci写代码 · 【Py】dataclass:懂事的类会自己生成方法 · 7 分钟,复习 dataclass 自动生成了哪些方法,和今天八个数据类对照着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1XPHUz8Ed2&autoplay=0&high_quality=1" title="【IT老齐810】TDD测试驱动开发,怎么用?有什么坑!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT老齐 · 【IT老齐810】TDD测试驱动开发,怎么用?有什么坑! · 11 分钟,讲先写测试再写实现的节奏和常见的坑。今天的练习 1 就是这个节奏:先手算、写测试,再看引擎过不过。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/B1j6k2j2eJg" title="Test-Driven Development In Python // The Power of Red-Green-Refactor" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>ArjanCodes · Test-Driven Development In Python // The Power of Red-Green-Refactor · 用 pytest 演示「红、绿、重构」三步,看他怎么先写一条失败的测试。</figcaption>
</figure>

- ArjanCodes《How to Write Great Unit Tests in Python》(YouTube `EIV_ixKGPmc`):讲一条好测试该测什么、不该测什么,和「期望值来自手算」那条对照。

### 书籍

- Kent Beck《Test-Driven Development: By Example》(Addison-Wesley, 2002;人民邮电出版社 2007 年出过中译本《测试驱动开发》):第一部分就是用一个多币种金额的例子一步步写测试,和今天的计费引擎很像。
- Martin Fowler《Patterns of Enterprise Application Architecture》(Addison-Wesley, 2002):第 18 章的 Money 和 Value Object,今天的 `Line`、`TaxRate` 就是值对象。

### 开源项目与代码

- [getlago/lago](https://github.com/getlago/lago):开源计费系统,找它处理折算和税的代码,看真实系统比我们多处理了哪些情况(余额、多币种、按用量计费)。
- [killbill/killbill](https://github.com/killbill/killbill):老牌开源计费,文档里有大量订阅变更的边界情况,明天写故障时可以找灵感。

## 自测

1. 为什么 `Invoice` 的小计、折扣、税、合计用 `@property` 算,不存成字段?

<details><summary>答案</summary>

存成字段就有机会和行项目不一致:加了一行忘了改合计,或者改了合计忘了加行。用 property 每次从行项目现算,内存里的发票不可能出现表头和明细对不上。写库时才把算好的值存进 `invoices` 表,方便查询。这和 React 里「能从 props 算出来的就不放 state」是一个道理。

</details>

2. 客户 6 月 5 日开通团队版 3 席(117/月),上海时间 6 月 20 日升级到商业版 3 席(267/月),税率 6%。7 月 5 日那张发票有哪几行,合计多少?

<details><summary>答案</summary>

退团队版未用部分 117 × 15 / 30 = −58.50;收商业版剩余部分 267 × 15 / 30 = 133.50;7 月整月商业版 267.00;小计 342.00;税 342 × 6% = 20.52;合计 362.52。折算记在 7 月这张上,因为 6 月那张在 6 月 5 日就开出去了。

</details>

3. `build_invoices` 的循环里,为什么「处理本期事件」排在「开本期的账」后面?换过来会怎样?

<details><summary>答案</summary>

本期的发票在本期第一天就开出去了,本期中间发生的改动只能影响下一张。换过来以后,开 6 月发票时就已经知道 6 月 20 日的升级,6 月那张会收升级后的钱和折算,时间上不可能。实测换顺序后四条测试变红,6 月那张从 124.02 变成 362.52。

</details>

4. 税率表里 `valid_to` 含当天,周期的 `period_end` 不含当天。`rate_on` 和 `build_invoices` 里分别是怎么体现的?

<details><summary>答案</summary>

`rate_on` 用 `on <= r.valid_to`,结束日当天还算有效,所以 2023-12-31 查到的是 SG-GST8。`build_invoices` 用 `ps <= d < pe`,结束日那天属于下一期。两种约定都来自习惯(税率通常写「有效期至 6 月 30 日」,周期用左闭右开最好算天数),关键是在注释里写清楚,代码照着写。

</details>

5. 测试的期望值为什么不能先跑一遍引擎再抄下来?

<details><summary>答案</summary>

那样测试只能证明「代码和它自己一致」,代码一开始就错了,测试照样全绿。期望值来自手算或者独立的来源(Day 677 到 679 的草稿、计算器),测试才是在检查规则。今天的测试里每个数都能在前几天的文章或者注释里的算式找到出处。

</details>

6. 面试题:面试官问「你的计费 Agent 怎么知道一张发票算没算错?靠模型自己算吗?」

<details><summary>答案</summary>

不靠模型算。我写了一个参考计费引擎,把公司对外承诺的规则(锚点日、按天折算记到下期、先折扣后算税、税率有效期、到期取消)实现成一个纯函数:输入客户、订阅事件、价目表和税率,输出每一期应收的发票。它不读库、不联网,每条规则都有一条期望值手算的单元测试,改代码时违反了规则测试会先红,比如我试过把事件处理和开账换个顺序,四条测试当场失败。Agent 通过复算工具调用这个引擎,拿应收和实收逐行对比,模型只负责解释差在哪、为什么。好处是金额结论确定、可测、不花 token;代价是引擎和真实计费系统的规则必须完全一致,规则以外的情况(比如月付改年付)我让引擎直接报错,不去猜。

</details>

## 明天预告

明天是 Day 682 · BillSleuth(三):故障注入、造数脚本和数据集自检。有了一个确定正确的引擎,就能造「确定错误」的账了:写 12 个模仿真实 bug 的注入函数(分母写死 30、漏了退还行、按 UTC 取日期、用了过期税率……),一次造出 100 个带标准答案的争议场景,再写一个不相信注入函数、自己拿引擎重算的自检测试,证明每个标准答案都分毫不差。
