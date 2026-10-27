---
title: 'Day 445 · 搭骨架(五):造业务库'
description: '往 Day 443 建好的 biz 表里造 200 个客户、200 条订阅、459 张账单、152 张历史工单。前 12 个是手工设计的「剧情客户」,每个对应一个退款场景,边界两个人只差一天;其余 188 个用固定种子随机生成。build() 只在内存里造,write() 用事务写库,价格和期限全部取自 Day 444 的事实源。测试 14 条不连库,另 2 条连库但最后回滚。'
pubDate: 2026-10-27
regime: none
tags: ['capstone', 'supportpilot', 'seed-data', 'postgres', 'testing', 'agent-zero']
series: 'agent-zero'
day: 445
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 444](/blog/agent-zero/day-444-kb-generate/) 造好了 `data/kb/` 里的 62 篇帮助中心文章。做法是一份事实源 `scripts/kb_facts.py`(每个价格、天数、手续费只写一次),加一个确定性的渲染器 `gen_kb.py`,再加一个 `check_kb.py` 抓断掉的交叉引用,第一次跑就抓到我自己写错的一处《E4001 支付失败》。到这一步,Agent 能「读」的东西有了。

今天造它能「查」的东西:客户、订阅、账单、历史工单,就是 [Day 443](/blog/agent-zero/day-443-database/) 建的那几张 `biz` 表里的内容。帮助中心说「年付首购 14 天内可以全额退」,业务库里就得有人恰好是第 7 天、第 14 天、第 15 天,否则后面 Day 452 写出来的退款规则、Day 476 的评测集,都没有东西可验。

## 今天要解决的问题

今天的新东西是两个:**剧情客户**(手工设计、每人对应一个评测场景的数据)和**确定性造数**(固定「今天」、固定随机种子,每次跑出来一模一样)。学完你应该能:

1. 说出 12 个剧情客户各自对应的退款场景,并解释为什么徐丽和孙浩要成对出现。
2. 写出 `scripts/seed_db.py`:`build()` 在内存里造出 200 个客户、200 条订阅、459 张账单、152 张历史工单,`write()` 在一个事务里清库再写入,`make seed` 能反复跑。
3. 解释为什么造数的「今天」必须是配置、随机数必须用独立的 `random.Random(42)`,并用实验证明换一天、换一种随机写法各会怎样。
4. 写 14 条不连库的测试,守住剧情客户的每个关键数字(李娜第 7 天、徐丽第 14 天、孙浩第 15 天、刘洋被扣两次……),并把造数脚本里的价格、天数和 Day 444 的事实源挂上钩。

今天不调模型,不花钱(¥0)。预计用时 3 小时。前置:[Day 443](/blog/agent-zero/day-443-database/) 的 `schema.sql` 和 `db.py`;[Day 444](/blog/agent-zero/day-444-kb-generate/) 的 `kb_facts.py`;[Day 442](/blog/agent-zero/day-442-config/) 的 `get_settings().sp_today`;[Day 40](/blog/agent-zero/day-040-classes-1/) 的类;[Day 23](/blog/agent-zero/day-023-comprehensions/) 的推导式;[Day 73](/blog/agent-zero/day-073-pytest-3/) 的 fixture 和 parametrize;[Day 91](/blog/agent-zero/day-091-sql-6/) 的事务和外键。

学法照旧:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `add_months()` 和 `Builder.invoice()` 默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先从前端看:这就是 fixtures

你给组件写过 Storybook 的故事、给接口写过 MSW 的假响应、或者在测试里放过一个 `fixtures/user.json`。今天的事和它们是同一件:**准备一批形状对、数字对、专门用来触发某种分支的数据**。

差别有两处。第一,前端的 fixture 一般是几个对象,今天是 200 个客户加他们的订阅、账单、工单,表和表之间有外键。第二,前端的 fixture 常常「随便写点」,今天不行:退款规则是按日期和金额算的,数据里的每个日期都会决定标准答案。「随便写点」的结果是后面所有分数都没有意义。

我把数据分成两部分。**剧情客户**是手工写的 12 个人,每个对应一种要测的情形,像 Storybook 里的 `Loading`、`Error`、`Empty` 三个故事。**随机客户**是 188 个机器生成的人,让数据看起来像一家真公司,也让检索和查询不至于太容易:如果库里只有 12 个客户,模型随便猜都能蒙对。

## 第一步:12 个剧情客户,先写成一张表

先不写代码,先把「谁、什么处境、该怎么处理」想清楚:

| 客户 | 剧情 | 正确处理 |
| --- | --- | --- |
| C0001 张伟 | 标准版月付,一切正常 | 用来问政策类问题 |
| C0002 李娜 | 专业版年付首购,9 月 24 日付款,到「今天」第 7 天 | 全额退 950 |
| C0003 王芳 | 专业版年付首购,5 月 20 日,早已超过 14 天 | 剩 7 个完整月,退 950 × 7 / 12 × 0.9 = 498.75 |
| C0004 刘洋 | 标准版月付,9 月 12 日被扣了两次 39 元 | 重复扣款,退一笔 39 |
| C0005 陈静 | 标准版月付,想退本月费用 | 月付不退,建议关闭自动续费 |
| C0006 杨磊 | 专业版月付,9 月 22 日扣款失败,已逾期 | 解释逾期规则,引导更换支付方式 |
| C0007 赵敏 | 标准版年付,9 月 27 日自动续费,第 4 天 | 续费 7 天内,全额退 374 |
| C0008 黄强 | 企业版 10 席,7,080 元,合同单 | 不适用自助退款,转客户成功经理 |
| C0009 周婷 | 免费版 | 问 API 之类的付费功能 |
| C0010 吴刚 | 专业版 VIP,银行同步 E3001 已经出过 3 次 | 客户画像(Day 466)要用到 |
| C0011 徐丽 | 标准版年付首购,9 月 17 日,正好第 14 天 | 边界:含第 14 天,全额退 374 |
| C0012 孙浩 | 标准版年付首购,9 月 16 日,第 15 天 | 边界:刚过线,退 374 × 11 / 12 × 0.9 = 308.55 |

这张表里的退款规则不是我现编的,来自 [Day 436](/blog/agent-zero/day-436-fde-requirements/) 访谈整理出的规则表,也就是 Day 444 渲染进《退款政策总览》里的那几条。它们在代码里的出处是 `kb_facts.py` 顶部的几个常量。先写一个小脚本,把「第几天、期限几天」这两个数从事实源取出来对一遍,确认表里的「第 7 天」「第 14 天」不是我心算的。

在仓库根目录新建 `scratch/s0.py`:

```python
# supportpilot/scratch/s0.py
from datetime import date

from kb_facts import FIRST_DAYS, RENEW_DAYS

TODAY = date(2026, 10, 1)
cases = [
    ("C0002 李娜", date(2026, 9, 24), "首购"),
    ("C0003 王芳", date(2026, 5, 20), "首购"),
    ("C0011 徐丽", date(2026, 9, 17), "首购"),
    ("C0012 孙浩", date(2026, 9, 16), "首购"),
    ("C0007 赵敏", date(2026, 9, 27), "续费"),
]
for who, paid, kind in cases:
    days = (TODAY - paid).days
    limit = FIRST_DAYS if kind == "首购" else RENEW_DAYS
    print(f"{who} {kind} 付款 {paid},第 {days} 天,期限 {limit} 天 → {'在期限内' if days <= limit else '已超过'}")
```

<div class="line-notes">

- `from datetime import date` 标准库的日期类型,和 [Day 442](/blog/agent-zero/day-442-config/) 里 `Settings.sp_today` 是同一种东西。`date(2026, 10, 1)` 构造一个日期,相当于 JS 里的 `new Date(2026, 9, 1)`,区别是 Python 的月份从 1 数起,不用减一。
- `from kb_facts import FIRST_DAYS, RENEW_DAYS` 从 Day 444 的事实源取两个常量:年付首购无理由退款 14 天,续费后 7 天。从这里取而不是自己写 14,今天以后「期限」只有一个出处。
- `TODAY = date(2026, 10, 1)` 先写死,第六步再换成配置。
- `cases = [` 五个要核对的人:名字、付款日、是首购还是续费。
- `days = (TODAY - paid).days` 两个日期相减得到一个时间差对象,`.days` 取整天数。代入李娜:`2026-10-01 - 2026-09-24`,7 天。
- `limit = FIRST_DAYS if kind == "首购" else RENEW_DAYS` 首购看 14 天,续费看 7 天,这一行就是退款规则的最小版本。
- `print(f"{who} {kind} 付款 {paid}` 一行打出一个人。`{paid}` 直接放进 f-string,日期会显示成 `2026-09-24`;末尾的判断 `days <= limit` 注意是 `<=`,因为是「14 天内(含第 14 天)」,写成 `<` 徐丽就会被判成超期。

</div>

```bash
cd ~/supportpilot
PYTHONPATH=scripts uv run python scratch/s0.py
```

`PYTHONPATH=scripts` 是在这一次运行里临时告诉 Python「也到 `scripts/` 里找模块」。不加的话,`from kb_facts import ...` 会报 `ModuleNotFoundError`:脚本放在 `scratch/` 里,Python 只会在脚本自己所在的目录(`scratch/`)里找同级文件,不会去隔壁的 `scripts/`。[Day 444](/blog/agent-zero/day-444-kb-generate/) 里 pytest 用 `pythonpath = ["scripts"]` 解决过同一个问题,这里是命令行的做法。

```text
C0002 李娜 首购 付款 2026-09-24,第 7 天,期限 14 天 → 在期限内
C0003 王芳 首购 付款 2026-05-20,第 134 天,期限 14 天 → 已超过
C0011 徐丽 首购 付款 2026-09-17,第 14 天,期限 14 天 → 在期限内
C0012 孙浩 首购 付款 2026-09-16,第 15 天,期限 14 天 → 已超过
C0007 赵敏 续费 付款 2026-09-27,第 4 天,期限 7 天 → 在期限内
```

<figure>
<svg viewBox="0 0 640 190" role="img" aria-label="距离付款日的天数轴:李娜第 7 天、徐丽第 14 天落在全额退区,孙浩第 15 天刚过线,王芳第 134 天远在右边">
  <g font-family="var(--font-mono)" font-size="12">
    <rect x="40" y="70" width="406" height="40" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <rect x="446" y="70" width="154" height="40" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="243" y="95" text-anchor="middle" fill="var(--ink)">全额退(含第 14 天)</text>
    <text x="523" y="95" text-anchor="middle" fill="var(--ink)">按月比例退</text>
    <line x1="40" y1="110" x2="600" y2="110" stroke="var(--ink-soft)"/>
    <g fill="var(--ink-faint)" font-size="11" text-anchor="middle">
      <text x="40" y="128">0</text>
      <text x="152" y="128">4</text>
      <text x="264" y="128">8</text>
      <text x="376" y="128">12</text>
      <text x="488" y="128">16</text>
      <text x="600" y="128">20</text>
    </g>
    <line x1="236" y1="110" x2="236" y2="64" stroke="var(--ink-soft)"/>
    <circle cx="236" cy="110" r="4" fill="var(--ink)"/>
    <text x="236" y="56" text-anchor="middle" fill="var(--ink)">李娜 7</text>
    <line x1="432" y1="110" x2="432" y2="64" stroke="var(--ink-soft)"/>
    <circle cx="432" cy="110" r="4" fill="var(--ink)"/>
    <text x="428" y="56" text-anchor="end" fill="var(--ink)">徐丽 14</text>
    <line x1="460" y1="110" x2="460" y2="64" stroke="var(--ink-soft)"/>
    <circle cx="460" cy="110" r="4" fill="var(--ink)"/>
    <text x="464" y="56" text-anchor="start" fill="var(--ink)">孙浩 15</text>
    <text x="600" y="162" text-anchor="end" fill="var(--ink-soft)">王芳 134 天 →(早就在右边,图画不下)</text>
    <text x="40" y="162" fill="var(--ink-faint)" font-size="11">今天 = 2026-10-01,横轴是「距首购付款日几天」</text>
  </g>
</svg>
<figcaption>三个人把「14 天」这条线夹在中间:徐丽在线内最后一格,孙浩在线外第一格。两人只差一天,结论相反,所以评测里缺一不可。</figcaption>
</figure>

徐丽和孙浩是专门测边界的一对。「14 天内」含不含第 14 天,模型很容易答错,代码里写错一个 `<` 和 `<=` 也会错。有这一对用例,两种错都能被抓到:模型答错,评测红;代码写错,Day 452 的单测红。两个人只差一天,结论相反,这是整张表里信息量最大的两行。

## 第二步:给日期加几个月

造数里到处要「加一个月」「加十二个月」:月付账单每月一张,年付的周期结束日是开始日加 12 个月。你可能想先试 `timedelta`,我第一次也是:

```python
# supportpilot/scratch/s1.py
from datetime import date, timedelta

d = date(2026, 1, 31)
print("加 30 天:", d + timedelta(days=30))
try:
    print(d + timedelta(months=1))  # type: ignore[call-arg]
except TypeError as e:
    print("timedelta 没有 months:", e)
```

<div class="line-notes">

- `from datetime import date, timedelta` `timedelta` 是「一段时间」,可以加到日期上。
- `d = date(2026, 1, 31)` 故意选 1 月 31 日,后面要用到它的尴尬处。
- `print("加 30 天:", d + timedelta(days=30))` 日期加 30 天。1 月 31 日加 30 天:2 月只有 28 天,所以落在 3 月 2 日。
- `print(d + timedelta(months=1))  # type: ignore[call-arg]` 想直接写 `months=1`。`# type: ignore[call-arg]` 是我加的,不加的话类型检查器会先报红,因为它一眼就知道这个参数不存在。
- `except TypeError as e:` 实际运行时报的是 `TypeError`,打出它的原文。

</div>

```text
加 30 天: 2026-03-02
timedelta 没有 months: 'months' is an invalid keyword argument for __new__()
```

`timedelta` 只认天、秒、周这些固定长度的单位,因为「一个月」不是固定长度,有的 28 天有的 31 天。标准库没有「加一个月」,要自己写。逻辑是:把「年和月」当成一个从 0 开始的整数,加上 n,再用整除和取余拆回年和月;最后日子超出当月天数时,取月底。新建 `scratch/s2.py`:

```python
# supportpilot/scratch/s2.py
import calendar
from datetime import date


def add_months(d: date, n: int) -> date:
    index = d.month - 1 + n  # 把月份换成从 0 开始数,方便取整除和余数
    year, month = d.year + index // 12, index % 12 + 1
    last_day = calendar.monthrange(year, month)[1]  # 这个月一共几天
    return date(year, month, min(d.day, last_day))


print(add_months(date(2026, 11, 15), 3))
print(add_months(date(2026, 1, 31), 1))
print(add_months(date(2024, 1, 31), 1))
print(add_months(date(2025, 9, 27), 12))
print(add_months(date(2026, 12, 5), 1))
```

<div class="line-notes">

- `import calendar` 标准库,里面的 `monthrange(年, 月)` 返回当月的天数,不用自己写闰年规则。
- `index = d.month - 1 + n` 先把月份换成从 0 开始数,取整除和余数才方便。代入 `d = 2026-11-15, n = 3`:`11 - 1 + 3 = 13`。
- `year, month = d.year + index // 12, index % 12 + 1` 接上例:`year = 2026 + 13 // 12 = 2027`,`month = 13 % 12 + 1 = 2`,得到 2027 年 2 月。`//` 是整除,相当于 JS 里的 `Math.floor(a / b)`。
- `last_day = calendar.monthrange(year, month)[1]  # 这个月一共几天` `monthrange` 返回一个二元组 `(这个月 1 号是星期几, 这个月的天数)`,取 `[1]`。2027 年 2 月返回 `(0, 28)`,所以 `last_day = 28`。
- `return date(year, month, min(d.day, last_day))` 日子超过当月天数就取月底。1 月 31 日加 1 个月:`min(31, 28) = 28`,得到 2 月 28 日。
- `print(add_months(date(2026, 11, 15), 3))` 第一个测试是跨年。
- `print(add_months(date(2026, 1, 31), 1))` 月底截断,平年 2 月。
- `print(add_months(date(2024, 1, 31), 1))` 2024 是闰年,2 月有 29 天。
- `print(add_months(date(2025, 9, 27), 12))` 加整年,赵敏去年续费的那一张用的就是这种。
- `print(add_months(date(2026, 12, 5), 1))` 12 月加 1:`index = 11 + 1 = 12`,`12 % 12 + 1 = 1`,年份是 `2026 + 1`。这个情形最容易写错,留给后面的复习日默写。

</div>

```text
2027-02-15
2026-02-28
2024-02-29
2026-09-27
2027-01-05
```

五个结果和心算一致。注意第二个:1 月 31 日加一个月是 2 月 28 日,而不是「2 月 31 日」(不存在)或「3 月 3 日」(`timedelta` 的做法)。账单周期这种事,月底截断才是人们的预期。

## 第三步:Builder 和账单号

造数据的方式有两种:直接写一大堆 `INSERT` 语句,或者在 Python 里先把数据攒成列表,最后一次写库。我选第二种,因为列表可以被测试直接检查,不需要数据库。攒数据的对象叫 `Builder`,它有三个方法:`customer()`、`sub()`(订阅)、`invoice()`(账单)。先写最小的版本,只带客户和账单,新建 `scratch/s3.py`:

```python
# supportpilot/scratch/s3.py
import calendar
from datetime import date
from pprint import pprint
from typing import Any

from kb_facts import PRO_YEAR, STD_MONTH

Row = dict[str, Any]
TODAY = date(2026, 10, 1)


def add_months(d: date, n: int) -> date:
    index = d.month - 1 + n
    year, month = d.year + index // 12, index % 12 + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


class Builder:
    def __init__(self) -> None:
        self.customers: list[Row] = []
        self.invoices: list[Row] = []
        self._invoice_seq: dict[str, int] = {}  # 键是 "202609" 这样的年月,值是这个月已经发了几张

    def customer(self, cid: str, name: str, email: str) -> str:
        self.customers.append({"id": cid, "name": name, "email": email})
        return cid

    def invoice(self, cid: str, amount: int, issued: date) -> str:
        ym = issued.strftime("%Y%m")
        self._invoice_seq[ym] = self._invoice_seq.get(ym, 0) + 1
        invoice_id = f"INV-{ym}-{self._invoice_seq[ym]:04d}"
        self.invoices.append({"id": invoice_id, "customer_id": cid, "amount_cny": amount, "issued_at": issued})
        return invoice_id


b = Builder()
b.customer("C0001", "张伟", "zhangwei@example.com")
b.invoice("C0001", STD_MONTH, date(2026, 9, 5))
b.customer("C0002", "李娜", "lina@example.com")
b.invoice("C0002", PRO_YEAR, date(2026, 9, 24))
b.invoice("C0001", STD_MONTH, date(2026, 10, 1))
pprint(b.invoices, sort_dicts=False)
print((TODAY - date(2026, 9, 24)).days, "天")
```

<div class="line-notes">

- `import calendar` 给下面的 `add_months` 用。
- `from pprint import pprint` 标准库的「好看地打印」,字典多的时候会自动换行。
- `from typing import Any` 一行数据是字典,值有字符串有日期有数字,所以值的类型写 `Any`([Day 46](/blog/agent-zero/day-046-type-hints-2/))。
- `from kb_facts import PRO_YEAR, STD_MONTH` 价格来自事实源:专业版年付 950,标准版月付 39。
- `Row = dict[str, Any]` 给「一行数据」起个短名字。
- `TODAY = date(2026, 10, 1)` 还是先写死。
- `def add_months(d: date, n: int) -> date:` 第二步的函数,原样搬过来。
- `class Builder:` 一个小工具类([Day 40](/blog/agent-zero/day-040-classes-1/)),把攒数据的列表和计数器放在一起。
- `self._invoice_seq: dict[str, int] = {}  # 键是` 账单号的计数器。键是 `"202609"` 这样的年月,值是这个月已经发出去几张。名字前的下划线是约定:外面别直接碰它。
- `def customer(self, cid: str, name: str, email: str) -> str:` 加一个客户,返回它的编号,方便写 `c = b.customer(...)` 再把 `c` 传给后面的调用。
- `self.customers.append({"id": cid, "name": name, "email": email})` 一行数据就是一个字典,键和表的列名一一对应,第七步写库时直接拿键当列名。
- `ym = issued.strftime("%Y%m")` `strftime` 把日期按格式变成字符串。`2026-09-24` 变成 `"202609"`。
- `self._invoice_seq[ym] = self._invoice_seq.get(ym, 0) + 1` `get(ym, 0)`:这个月还没发过时,键不存在,当成 0。再加 1,这个月第一张就是 1。
- `invoice_id = f"INV-{ym}-{self._invoice_seq[ym]:04d}"` `:04d` 是格式说明:整数,补零到 4 位。第 2 张是 `0002`。
- `b.invoice("C0001", STD_MONTH, date(2026, 9, 5))` 张伟 9 月 5 日一张 39 元。
- `b.invoice("C0002", PRO_YEAR, date(2026, 9, 24))` 李娜 9 月 24 日一张 950 元。
- `b.invoice("C0001", STD_MONTH, date(2026, 10, 1))` 张伟 10 月 1 日又一张,这是 10 月的第一张,所以编号重新从 `0001` 数起。
- `pprint(b.invoices, sort_dicts=False)` `sort_dicts=False` 让键保持写入的顺序,不按字母排。
- `print((TODAY - date(2026, 9, 24)).days, "天")` 李娜距离「今天」的天数。

</div>

```bash
uv run python scratch/s3.py
```

```text
ModuleNotFoundError: No module named 'kb_facts'
```

还是第一步那个原因,这次直接看一遍原文:`scratch/` 看不到 `scripts/`。加上 `PYTHONPATH=scripts`:

```bash
PYTHONPATH=scripts uv run python scratch/s3.py
```

```text
[{'id': 'INV-202609-0001',
  'customer_id': 'C0001',
  'amount_cny': 39,
  'issued_at': datetime.date(2026, 9, 5)},
 {'id': 'INV-202609-0002',
  'customer_id': 'C0002',
  'amount_cny': 950,
  'issued_at': datetime.date(2026, 9, 24)},
 {'id': 'INV-202610-0001',
  'customer_id': 'C0001',
  'amount_cny': 39,
  'issued_at': datetime.date(2026, 10, 1)}]
7 天
```

三张账单的编号是 `INV-202609-0001`、`INV-202609-0002`、`INV-202610-0001`:编号是**按发出顺序**数的,每个月单独从 1 开始。李娜 9 月 24 日的账单排在张伟 9 月 5 日之后,不是因为日期晚,而是因为我先调用了张伟那一次。后面 12 个剧情客户全造完,你会看到 `INV-202609-0003`(刘洋 9 月 12 日)排在 `0002`(李娜 9 月 24 日)后面,日期反而更早。我故意没修:真实系统里账单号也不保证和日期同序,Agent 判断先后应该看日期字段,不该读编号。这个差别在练习 4 会专门查一次。

另外,账单号的规则是 Day 438 之后好几天(Day 452 的单测、Day 463 的端到端、Day 470 的审批界面)都要引用的:李娜的 950 元年付是 `INV-202609-0002`,黄强的企业版是 `INV-202609-0008`,吴刚的首购是 `INV-202601-0001`。所以 `Builder` 里的发号规则和**造客户的顺序**一旦定下就不要动,换一下顺序,这些编号全都会变。

## 第四步:把 12 个人写完

`Builder` 补上订阅(`sub`)和工单(`ticket`),再加两个批量方法 `monthly_history`(月付客户从开始日起每月一张账单补到「今天」)和 `yearly_history`。然后是 12 个剧情客户,每人几行,注释里写着他是为了测什么。这部分代码今天最长,大头在第八步的完整文件里,这里先看一眼写完以后的样子。新建 `scratch/s4.py`,只调用完整文件里的 `add_story_customers`:

```python
# supportpilot/scratch/s4.py
from datetime import date

from seed_db import Builder, add_story_customers

b = Builder(date(2026, 10, 1))
add_story_customers(b)
print("客户", len(b.customers), "订阅", len(b.subs), "账单", len(b.invoices), "工单", len(b.tickets))
for c in b.customers:
    n = sum(1 for i in b.invoices if i["customer_id"] == c["id"])
    print(c["id"], c["name"], f"账单 {n} 张")
```

<div class="line-notes">

- `from seed_db import Builder, add_story_customers` 从 `scripts/seed_db.py` 导入(第八步会完整贴出来)。同样要 `PYTHONPATH=scripts`。
- `b = Builder(date(2026, 10, 1))` 今天起 `Builder` 的构造函数要传一个「今天」,第六步会解释为什么。
- `add_story_customers(b)` 只造 12 个剧情客户,不造随机的。
- `print("客户", len(b.customers)` 一行汇总四个列表的长度。
- `n = sum(1 for i in b.invoices if i["customer_id"] == c["id"])` 生成器表达式数这个人有几张账单,`sum(1 for ...)` 是「数个数」的常见写法。
- `print(c["id"], c["name"], f"账单 {n} 张")` 每个客户一行。

</div>

```bash
PYTHONPATH=scripts uv run python scratch/s4.py
```

```text
客户 12 订阅 12 账单 29 工单 3
C0001 张伟 账单 7 张
C0002 李娜 账单 1 张
C0003 王芳 账单 1 张
C0004 刘洋 账单 5 张
C0005 陈静 账单 3 张
C0006 杨磊 账单 6 张
C0007 赵敏 账单 2 张
C0008 黄强 账单 1 张
C0009 周婷 账单 0 张
C0010 吴刚 账单 1 张
C0011 徐丽 账单 1 张
C0012 孙浩 账单 1 张
```

12 个人,29 张账单,3 张工单(都是吴刚的)。几个数字可以对着剧情表核一下:张伟从 3 月 5 日起月付,3、4、5、6、7、8、9 月各一张,7 张;刘洋 6 月 12 日起月付,6、7、8、9 月各一张共 4 张,再加手工插的那张重复扣款,5 张;陈静 7 月 8 日起,7、8、9 月 3 张;杨磊 4 月到 8 月 5 张成功加 9 月那张失败的,6 张;周婷是免费版,没有账单,所以是 0。

## 第五步:188 个随机客户,和为什么要自己的随机数生成器

剧情客户只有 12 个。再造 188 个随机的,编号 C0013 到 C0200:随机抽姓和名拼成姓名,随机套餐(免费、标准、专业按 3:5:2),随机月付或年付,随机的开始日期,再随机给 0 到 2 张历史工单。随机数我用的是 `random.Random(42)`,而不是更常见的 `random.seed(42)`。差别用一个小实验看,新建 `scratch/s5.py`:

```python
# supportpilot/scratch/s5.py
import random

# 做法一:全局种子
random.seed(42)
a = [random.randint(1, 100) for _ in range(3)]
random.seed(42)
random.random()  # 假设别的库在这中间也用了一次全局随机数
b = [random.randint(1, 100) for _ in range(3)]
print("全局种子,同一个 42:", a, b)

# 做法二:自己的生成器
r1 = random.Random(42)
a = [r1.randint(1, 100) for _ in range(3)]
r2 = random.Random(42)
random.random()  # 别处动全局随机数,不影响 r2
b = [r2.randint(1, 100) for _ in range(3)]
print("独立生成器,同一个 42:", a, b)
```

<div class="line-notes">

- `import random` 标准库。
- `random.seed(42)` 做法一:给「全局」随机数生成器设种子。种子相同,之后抽出的数字序列就相同。
- `a = [random.randint(1, 100) for _ in range(3)]` 抽三个 1 到 100 的整数。`_` 表示循环变量用不上。
- `random.seed(42)` 第二次重新设一遍同样的种子,本来应该得到同样的三个数。
- `random.random()  # 假设别的库在这中间也用了一次全局随机数` 这一行模拟「别的代码」也用了全局随机数一次,抽走了序列里的一个值。
- `print("全局种子,同一个 42:", a, b)` 看两次是否一样。
- `r1 = random.Random(42)` 做法二:自己造一个独立的生成器对象,它有自己的内部状态,和全局的互不相干。
- `a = [r1.randint(1, 100) for _ in range(3)]` 用 `r1` 抽三个。
- `r2 = random.Random(42)` 再造一个同样种子的新生成器。
- `random.random()  # 别处动全局随机数,不影响 r2` 同样的「别处动了全局随机数」。
- `print("独立生成器,同一个 42:", a, b)` 两次是否一样。

</div>

```bash
uv run python scratch/s5.py
```

```text
全局种子,同一个 42: [82, 15, 4] [4, 95, 36]
独立生成器,同一个 42: [82, 15, 4] [82, 15, 4]
```

全局种子那行,两次明明都是 42,结果却是 `[82, 15, 4]` 和 `[4, 95, 36]`:中间有人多用了一次全局随机数,序列整体错位。造数脚本里谁会「中间用一次」?你以后引入的某个库(重试库、数据生成库)、某个别的模块都可能。独立生成器不受影响。所以造数一律写 `rng = random.Random(42)`,把 `rng` 传给要用它的函数,不碰全局的。

`add_random_customers` 的完整代码在第八步。先看它造出来的东西,新建 `scratch/s5b.py`:

```python
# supportpilot/scratch/s5b.py
import random
from collections import Counter
from datetime import date

from seed_db import SEED, Builder, add_random_customers, add_story_customers

b = Builder(date(2026, 10, 1))
add_story_customers(b)
add_random_customers(b, random.Random(SEED))
for c in b.customers[12:15]:
    s = next(s for s in b.subs if s["customer_id"] == c["id"])
    n = sum(1 for i in b.invoices if i["customer_id"] == c["id"])
    print(c["id"], c["name"], c["email"], c["company"], c["region"], s["plan"], s["billing_cycle"], s["started_at"], f"账单 {n} 张")
random_subs = [s for s in b.subs if s["customer_id"] > "C0012"]
print(Counter(s["plan"] for s in random_subs))
print(Counter((s["plan"], s["billing_cycle"]) for s in random_subs if s["plan"] != "free"))
tickets = Counter(t["customer_id"] for t in b.tickets if t["customer_id"] > "C0012")
print("有 1 张工单的人:", sum(1 for n in tickets.values() if n == 1), " 有 2 张的:", sum(1 for n in tickets.values() if n == 2))
print("随机部分账单", len(b.invoices) - 29, "张,工单", len(b.tickets) - 3, "张")
```

<div class="line-notes">

- `from collections import Counter` 标准库的计数器:给它一串东西,它数每种出现几次,返回像字典的对象。
- `from seed_db import SEED, Builder, add_random_customers, add_story_customers` `SEED` 就是那个 42,放在文件顶部做成常量,不在函数里写死。
- `add_story_customers(b)` 先造 12 个剧情客户。顺序不能反:随机客户的编号从 C0013 起。
- `add_random_customers(b, random.Random(SEED))` 再造随机的。生成器是在这里当场新建的,每次调用都从头开始。
- `for c in b.customers[12:15]:` 切片取下标 12、13、14,也就是 C0013 到 C0015,看前三个随机客户长什么样。
- `s = next(s for s in b.subs if s["customer_id"] == c["id"])` 找这个客户的订阅。`next(生成器)` 取第一个满足条件的。
- `random_subs = [s for s in b.subs if s["customer_id"] > "C0012"]` 字符串也能比大小,`"C0013" > "C0012"` 成立,用它筛出随机客户的订阅。
- `print(Counter(s["plan"] for s in random_subs))` 统计三种套餐各多少人。
- `tickets = Counter(t["customer_id"] for t in b.tickets if t["customer_id"] > "C0012")` 每个客户有几张工单。
- `sum(1 for n in tickets.values() if n == 1)` 恰好有 1 张工单的客户数,2 张的同理。

</div>

```bash
PYTHONPATH=scripts uv run python scratch/s5b.py
```

```text
C0013 刘静 user0013@example.com 刘静餐饮 上海 free monthly 2026-07-21 账单 0 张
C0014 张燕 user0014@example.com 张燕设计 杭州 free monthly 2026-06-02 账单 0 张
C0015 王军 user0015@example.com 王军电商 广州 free monthly 2026-03-23 账单 0 张
Counter({'standard': 93, 'free': 61, 'pro': 34})
Counter({('standard', 'yearly'): 58, ('standard', 'monthly'): 35, ('pro', 'monthly'): 17, ('pro', 'yearly'): 17})
有 1 张工单的人: 83  有 2 张的: 33
随机部分账单 430 张,工单 149 张
```

188 人里免费版 61、标准版 93、专业版 34,大致是 3:5:2 的比例(32%、49%、18%)。付费的 127 人里年付 75、月付 52。工单 83 × 1 + 33 × 2 = 149 张,加上吴刚的 3 张,是 152 张。账单 430 加上剧情客户的 29,是 459。这些数字后面会写进 README 和测试里,先记下。

有个细节:前三个随机客户碰巧全是免费版,所以账单是 0 张。免费版订阅只建订阅不建账单,不收钱当然没有账单。

## 第六步:固定「今天」

`Builder(today)` 里「今天」是一个参数,不是 `date.today()`。[Day 442](/blog/agent-zero/day-442-config/) 讲过为什么:退款规则按日期算,系统时钟每天在变。这里还有一层:**造数本身也依赖今天**。月付客户的账单要「补到今天」,订阅的当前周期要「包含今天」,历史工单的日期要「今天往前推」。换一天造,连账单有几张都不一样。看一下,新建 `scratch/s6.py`:

```python
# supportpilot/scratch/s6.py
from datetime import date

from seed_db import build

for today in (date(2026, 10, 1), date(2026, 10, 27), date(2027, 1, 1)):
    b = build(today)
    print(today, "账单", len(b.invoices), "张,客户", len(b.customers), "个")
```

<div class="line-notes">

- `from seed_db import build` `build(today)` 是完整文件里的总入口,传一个日期,返回装满数据的 `Builder`。
- `for today in (date(2026, 10, 1), date(2026, 10, 27), date(2027, 1, 1)):` 三个「今天」:约定的 10 月 1 日、我写这篇的当天、元旦。
- `b = build(today)` 同一份造数代码,只换了今天。
- `print(today, "账单", len(b.invoices)` 看账单张数。

</div>

```bash
PYTHONPATH=scripts uv run python scratch/s6.py
```

```text
2026-10-01 账单 459 张,客户 200 个
2026-10-27 账单 462 张,客户 200 个
2027-01-01 账单 468 张,客户 200 个
```

客户数不变,账单从 459 涨到 462、468:月付客户每过一个扣款日就多一张。所以评测里「刘洋应该有几张账单」这类问题,答案取决于哪天造的数据。「今天」固定成 `SP_TODAY=2026-10-01`,造出来的就永远是 459。`build()` 不传参数时读 `get_settings().sp_today`,传了就用传的,测试里全部显式传,不依赖 `.env`。

## 第七步:写进数据库

内存里的列表要进 Postgres。最直觉的写法是拼一条 SQL 字符串。新建 `scratch/s7.py`:

```python
# supportpilot/scratch/s7.py
from supportpilot.db import connect

table = "customers"
cols = ["id", "name", "email", "created_at"]
query = f"INSERT INTO biz.{table} ({', '.join(cols)}) VALUES (%s, %s, %s, %s)"
print(query)
with connect() as conn:
    conn.execute(query, ("CT001", "测试", "ct001@example.com", "2026-01-01"))
    conn.execute("DELETE FROM biz.customers WHERE id = 'CT001'")
```

<div class="line-notes">

- `from supportpilot.db import connect` Day 443 的连接函数,返回行是字典的连接。
- `table = "customers"` 表名放在变量里,因为要对四张表循环。
- `cols = ["id", "name", "email", "created_at"]` 列名也放在变量里,第七步最终版里它来自每行字典的键。
- `query = f"INSERT INTO biz.{table} ({', '.join(cols)}) VALUES (%s, %s, %s, %s)"` 用 f-string 把表名和列名拼进去。`', '.join(cols)` 把列表用逗号空格连起来。值的部分仍然用 `%s` 占位符,由 psycopg 安全填入。
- `conn.execute(query, ("CT001", "测试", "ct001@example.com", "2026-01-01"))` 插一个测试客户。
- `conn.execute("DELETE FROM biz.customers WHERE id = 'CT001'")` 再删掉,不留痕迹。

</div>

```bash
uv run python scratch/s7.py
```

```text
INSERT INTO biz.customers (id, name, email, created_at) VALUES (%s, %s, %s, %s)
```

运行没有问题。可是类型检查器不放过它:

```bash
uv run basedpyright scratch/s7.py
```

```text
  /Users/你/supportpilot/scratch/s7.py:9:18 - error: Argument of type "str" cannot be assigned to parameter "query" of type "QueryNoTemplate" in function "execute"
    Type "str" is not assignable to type "QueryNoTemplate"
      "str" is not assignable to "LiteralString"
      "str" is not assignable to "bytes"
      "str" is not assignable to "SQL"
      "str" is not assignable to "Composed" (reportArgumentType)
1 error, 0 warnings, 0 notes
```

psycopg 的类型标注只放行「写死在代码里的字符串」(`LiteralString`)和它自己的 `sql.SQL`、`sql.Composed` 对象当 SQL。f-string 拼出来的字符串在类型检查器眼里是任意字符串,会被拦下。这是在防 SQL 注入:如果表名来自用户输入,拼进去就是漏洞。我们的表名是自己写的常量,所以实际上安全,但对的做法是用 psycopg 给的拼装工具,表名、列名用 `sql.Identifier` 包起来,它会负责加引号和转义。新建 `scratch/s8.py`:

```python
# supportpilot/scratch/s8.py
from psycopg import sql

from supportpilot.db import connect

table = "customers"
cols = ["id", "name", "email", "created_at"]
insert = sql.SQL("INSERT INTO {} ({}) VALUES ({})").format(
    sql.Identifier("biz", table),
    sql.SQL(", ").join(sql.Identifier(c) for c in cols),
    sql.SQL(", ").join(sql.Placeholder(c) for c in cols),
)
print(repr(insert))

with connect() as conn:
    print(insert.as_string(conn))
    evil = sql.Identifier("biz", "customers; DROP TABLE biz.customers")
    print(evil.as_string(conn))
```

<div class="line-notes">

- `from psycopg import sql` psycopg 的 SQL 拼装模块。
- `sql.SQL("INSERT INTO {} ({}) VALUES ({})")` 一个 SQL 模板,`{}` 是空位,按顺序用 `.format()` 填。这里写的 SQL 必须是写死的字符串,这就是类型检查器放行它的原因。
- `sql.Identifier("biz", table)` 一个标识符(表名、列名)。传两个参数表示「模式.表」,渲染出来是 `"biz"."customers"`。
- `sql.SQL(", ").join(sql.Identifier(c) for c in cols)` 把每个列名包成标识符,再用逗号连起来。
- `sql.SQL(", ").join(sql.Placeholder(c) for c in cols)` 每个列生成一个命名占位符 `%(列名)s`。
- `print(repr(insert))` 打出这个对象的内部结构,看它是怎么拼的。
- `print(insert.as_string(conn))` 在连接上渲染成真正的 SQL 字符串,只用来观察,执行时直接把 `insert` 对象传给 `execute`。
- `evil = sql.Identifier("biz", "customers; DROP TABLE biz.customers")` 假装表名被人塞了一段恶意内容。
- `print(evil.as_string(conn))` 看它怎么被处理。

</div>

```bash
uv run python scratch/s8.py
```

```text
Composed([SQL('INSERT INTO '), Identifier('biz', 'customers'), SQL(' ('), Composed([Identifier('id'), SQL(', '), Identifier('name'), SQL(', '), Identifier('email'), SQL(', '), Identifier('created_at')]), SQL(') VALUES ('), Composed([Placeholder('id'), SQL(', '), Placeholder('name'), SQL(', '), Placeholder('email'), SQL(', '), Placeholder('created_at')]), SQL(')')])
INSERT INTO "biz"."customers" ("id", "name", "email", "created_at") VALUES (%(id)s, %(name)s, %(email)s, %(created_at)s)
"biz"."customers; DROP TABLE biz.customers"
```

第二行是真正会发给数据库的 SQL:表名和列名都带了双引号,值是 `%(id)s` 这种命名占位符,从每行字典里按键取值。第三行是恶意表名的下场:整段被当成一个表名放进双引号,数据库只会报「没有这张表」,不会执行里面的 `DROP TABLE`。

再来一个顺序问题。四张表有外键(订阅指向客户,账单指向客户和订阅,工单指向客户),所以必须先写被指向的。写反了会怎样,新建 `scratch/s9.py`,故意先写订阅、后写客户:

```python
# supportpilot/scratch/s9.py
from datetime import date

from psycopg import errors, sql
from seed_db import TABLES, Builder, add_story_customers

from supportpilot.db import connect

b = Builder(date(2026, 10, 1))
add_story_customers(b)
rows_by_table = {"customers": b.customers, "subscriptions": b.subs, "invoices": b.invoices, "tickets": b.tickets}


def insert_all(conn, order):
    for table in order:
        rows = rows_by_table[table]
        cols = list(rows[0])
        query = sql.SQL("INSERT INTO {} ({}) VALUES ({})").format(
            sql.Identifier("biz", table),
            sql.SQL(", ").join(sql.Identifier(c) for c in cols),
            sql.SQL(", ").join(sql.Placeholder(c) for c in cols),
        )
        with conn.cursor() as cur:
            cur.executemany(query, rows)
        print("写入", table, len(rows))


with connect() as conn:
    try:
        with conn.transaction(force_rollback=True):  # 不管成败最后都回滚,开发库里的数据不动
            conn.execute("TRUNCATE biz.audit_log, biz.tickets, biz.invoices, biz.subscriptions, biz.customers CASCADE")
            insert_all(conn, ["subscriptions", "customers"])  # 故意把顺序写反
    except errors.ForeignKeyViolation as e:
        lines = str(e).splitlines()
        print(type(e).__name__)
        print(lines[0])
        print(lines[1])
    print("正确的顺序:", TABLES)
```

<div class="line-notes">

- `from psycopg import errors, sql` `errors` 里有数据库各种错误对应的 Python 异常类。
- `from seed_db import TABLES, Builder, add_story_customers` `TABLES` 是完整文件里写好的正确顺序。
- `b = Builder(date(2026, 10, 1))` 只造 12 个剧情客户就够演示。
- `rows_by_table = {` 表名到行列表的对照,第八步完整文件里的 `write()` 里有同样一个。
- `def insert_all(conn, order):` 按给定的顺序一张张表写入,每张表打印写了几行。
- `query = sql.SQL("INSERT INTO {} ({}) VALUES ({})").format(` 和 `s8.py` 一样的拼装。
- `cur.executemany(query, rows)` 一条 SQL 配一列表参数,批量插入。
- `with conn.transaction(force_rollback=True):` 事务([Day 91](/blog/agent-zero/day-091-sql-6/))。`force_rollback=True` 让它不管成败最后都回滚,不会动你开发库里已有的数据,这是 Day 443 测试里学过的写法。
- `conn.execute("TRUNCATE biz.audit_log, biz.tickets, biz.invoices, biz.subscriptions, biz.customers CASCADE")` 先清空。`TRUNCATE` 比 `DELETE FROM` 快,而且 `CASCADE` 会把引用这些表的数据一起清,不用操心外键顺序。
- `insert_all(conn, ["subscriptions", "customers"])  # 故意把顺序写反` 订阅先于客户。
- `except errors.ForeignKeyViolation as e:` 外键违反对应的异常。
- `lines = str(e).splitlines()` 报错信息有多行,拆开取前两行。
- `print("正确的顺序:", TABLES)` 最后把正确顺序打出来对照。

</div>

```bash
PYTHONPATH=scripts uv run python scratch/s9.py
```

```text
ForeignKeyViolation
insert or update on table "subscriptions" violates foreign key constraint "subscriptions_customer_id_fkey"
DETAIL:  Key (customer_id)=(C0001) is not present in table "customers".
正确的顺序: ['customers', 'subscriptions', 'invoices', 'tickets']
```

报错原文很清楚:订阅表里的 `customer_id = C0001` 在客户表里还不存在。正确顺序是 `customers → subscriptions → invoices → tickets`,被指向的在前。清空时用 `CASCADE` 就不用管顺序,但写入必须管。因为用了 `force_rollback=True`,这次实验过后开发库里的数据一行没动。

## 第八步:拼成 `scripts/seed_db.py`

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="造数的数据流:事实源和配置进入 build,得到内存里的四个列表,再由 write 在事务里写进 biz 四张表;测试分两层,一层只测内存列表,一层连库但回滚">
  <g font-family="var(--font-mono)" font-size="12">
    <rect x="14" y="30" width="108" height="56" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="68" y="54" text-anchor="middle" fill="var(--ink)">kb_facts.py</text>
    <text x="68" y="72" text-anchor="middle" fill="var(--ink-soft)" font-size="11">价格 期限</text>
    <rect x="142" y="30" width="108" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="196" y="54" text-anchor="middle" fill="var(--ink)">build(today)</text>
    <text x="196" y="72" text-anchor="middle" fill="var(--ink-soft)" font-size="11">纯逻辑,不碰库</text>
    <rect x="270" y="30" width="108" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="324" y="54" text-anchor="middle" fill="var(--ink)">Builder</text>
    <text x="324" y="72" text-anchor="middle" fill="var(--ink-soft)" font-size="11">四个列表(内存)</text>
    <rect x="398" y="30" width="108" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="452" y="54" text-anchor="middle" fill="var(--ink)">write(conn)</text>
    <text x="452" y="72" text-anchor="middle" fill="var(--ink-soft)" font-size="11">一个事务</text>
    <rect x="526" y="30" width="100" height="56" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="576" y="54" text-anchor="middle" fill="var(--ink)">biz 四张表</text>
    <text x="576" y="72" text-anchor="middle" fill="var(--ink-soft)" font-size="11">Postgres</text>
    <line x1="122" y1="58" x2="140" y2="58" stroke="var(--ink-soft)"/>
    <line x1="250" y1="58" x2="268" y2="58" stroke="var(--ink-soft)"/>
    <line x1="378" y1="58" x2="396" y2="58" stroke="var(--ink-soft)"/>
    <line x1="506" y1="58" x2="524" y2="58" stroke="var(--ink-soft)"/>
    <text x="196" y="118" text-anchor="middle" fill="var(--ink-soft)" font-size="11">SP_TODAY + SEED=42</text>
    <line x1="196" y1="104" x2="196" y2="88" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
    <rect x="270" y="150" width="108" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="324" y="170" text-anchor="middle" fill="var(--ink)">test_seed.py</text>
    <text x="324" y="186" text-anchor="middle" fill="var(--ink-soft)" font-size="11">14 条,不连库</text>
    <line x1="324" y1="148" x2="324" y2="88" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
    <rect x="452" y="150" width="174" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="539" y="170" text-anchor="middle" fill="var(--ink)">test_seed_live.py</text>
    <text x="539" y="186" text-anchor="middle" fill="var(--ink-soft)" font-size="11">2 条,连库,最后回滚</text>
    <line x1="500" y1="148" x2="480" y2="88" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
  </g>
</svg>
<figcaption>造数分两段:左边是纯逻辑,右边才碰数据库。测试也跟着分两层,绝大多数只测左边,不需要起 Postgres。</figcaption>
</figure>

零件都有了,拼起来。下面是完整文件(第一行注释是路径,`scripts/` 不是包,所以它用 `from kb_facts import ...` 这种同目录导入,运行时要用 `uv run python scripts/seed_db.py`,Python 会把脚本所在目录放进搜索路径):

```python
# supportpilot/scripts/seed_db.py
"""造 CloudLedger 业务库。前 12 个客户是手工设计的「剧情客户」,评测集会用到;其余 188 个随机生成。
固定随机种子 + 固定「今天」,每次跑出来的数据一模一样。build() 只在内存里造,main() 才碰数据库。"""

import calendar
import random
from datetime import date, timedelta
from typing import Any

import psycopg
from kb_facts import PRO_MONTH, PRO_YEAR, SEAT_PRICE, STD_MONTH, STD_YEAR
from psycopg import sql
from psycopg.rows import DictRow

from supportpilot.config import get_settings
from supportpilot.db import connect

Row = dict[str, Any]

PRICE = {
    ("standard", "monthly"): STD_MONTH,
    ("standard", "yearly"): STD_YEAR,
    ("pro", "monthly"): PRO_MONTH,
    ("pro", "yearly"): PRO_YEAR,
    ("free", "monthly"): 0,
}
TABLES = ["customers", "subscriptions", "invoices", "tickets"]  # 写入顺序:被引用的表在前
SEED = 42


def add_months(d: date, n: int) -> date:
    index = d.month - 1 + n
    year, month = d.year + index // 12, index % 12 + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


class Builder:
    def __init__(self, today: date) -> None:
        self.today = today
        self.customers: list[Row] = []
        self.subs: list[Row] = []
        self.invoices: list[Row] = []
        self.tickets: list[Row] = []
        self._invoice_seq: dict[str, int] = {}

    def customer(
        self,
        cid: str,
        name: str,
        email: str,
        company: str,
        *,
        vip: bool = False,
        created: date = date(2025, 6, 1),
        region: str = "上海",
    ) -> str:
        self.customers.append(
            {
                "id": cid,
                "name": name,
                "email": email,
                "company": company,
                "region": region,
                "is_vip": vip,
                "created_at": created,
            }
        )
        return cid

    def sub(
        self,
        cid: str,
        plan: str,
        cycle: str,
        started: date,
        *,
        status: str = "active",
        seats: int = 1,
        price: float | None = None,
        period_end: date | None = None,
    ) -> str:
        sid = f"S{len(self.subs) + 1:04d}"
        if price is None:
            price = PRICE[(plan, cycle)]
        if period_end is None:  # 默认:当前计费周期包含「今天」
            step = 1 if cycle == "monthly" else 12
            period_end = started
            while period_end <= self.today:
                period_end = add_months(period_end, step)
        self.subs.append(
            {
                "id": sid,
                "customer_id": cid,
                "plan": plan,
                "billing_cycle": cycle,
                "status": status,
                "seats": seats,
                "price_cny": price,
                "started_at": started,
                "current_period_end": period_end,
                "auto_renew": True,
            }
        )
        return sid

    def invoice(
        self,
        cid: str,
        sid: str,
        amount: float,
        issued: date,
        period_start: date,
        period_end: date,
        *,
        status: str = "paid",
        first: bool = False,
    ) -> str:
        ym = issued.strftime("%Y%m")
        self._invoice_seq[ym] = self._invoice_seq.get(ym, 0) + 1
        iid = f"INV-{ym}-{self._invoice_seq[ym]:04d}"
        self.invoices.append(
            {
                "id": iid,
                "customer_id": cid,
                "subscription_id": sid,
                "amount_cny": amount,
                "status": status,
                "issued_at": issued,
                "paid_at": issued if status in ("paid", "refunded") else None,
                "period_start": period_start,
                "period_end": period_end,
                "is_first_purchase": first,
            }
        )
        return iid

    def monthly_history(self, cid: str, sid: str, plan: str, started: date) -> None:
        """月付客户:从开始那天起每月一张账单,一直补到「今天」。"""
        d, first = started, True
        while d <= self.today:
            self.invoice(cid, sid, PRICE[(plan, "monthly")], d, d, add_months(d, 1), first=first)
            d, first = add_months(d, 1), False

    def yearly_history(self, cid: str, sid: str, plan: str, started: date) -> None:
        d, first = started, True
        while d <= self.today:
            self.invoice(cid, sid, PRICE[(plan, "yearly")], d, d, add_months(d, 12), first=first)
            d, first = add_months(d, 12), False

    def ticket(self, cid: str, email: str, subject: str, body: str, category: str, created: date, summary: str) -> None:
        """只造历史工单:都已解决,带上客服当时的处理摘要。"""
        self.tickets.append(
            {
                "id": f"T{len(self.tickets) + 1:06d}",
                "customer_id": cid,
                "customer_email": email,
                "subject": subject,
                "body": body,
                "category": category,
                "status": "resolved",
                "created_at": created,
                "resolved_at": created,
                "resolution_summary": summary,
            }
        )


def add_story_customers(b: Builder) -> None:
    """C0001–C0012:每个人对应一个评测场景,注释里写着他是为了测什么。"""
    c = b.customer("C0001", "张伟", "zhangwei@example.com", "张伟工作室")  # 正常的标准版月付
    s = b.sub(c, "standard", "monthly", date(2026, 3, 5))
    b.monthly_history(c, s, "standard", date(2026, 3, 5))

    c = b.customer("C0002", "李娜", "lina@example.com", "娜美贸易")  # 年付首购第 7 天:全额退
    s = b.sub(c, "pro", "yearly", date(2026, 9, 24))
    b.invoice(c, s, PRO_YEAR, date(2026, 9, 24), date(2026, 9, 24), date(2027, 9, 24), first=True)

    c = b.customer("C0003", "王芳", "wangfang@example.com", "芳华咨询")  # 年付超过 14 天:按月比例退
    s = b.sub(c, "pro", "yearly", date(2026, 5, 20))
    b.invoice(c, s, PRO_YEAR, date(2026, 5, 20), date(2026, 5, 20), date(2027, 5, 20), first=True)

    c = b.customer("C0004", "刘洋", "liuyang@example.com", "洋帆科技")  # 9 月被扣了两次
    s = b.sub(c, "standard", "monthly", date(2026, 6, 12))
    b.monthly_history(c, s, "standard", date(2026, 6, 12))
    b.invoice(c, s, STD_MONTH, date(2026, 9, 12), date(2026, 9, 12), date(2026, 10, 12))  # 重复的那一笔

    c = b.customer("C0005", "陈静", "chenjing@example.com", "静心花艺")  # 月付想退款:不符合
    s = b.sub(c, "standard", "monthly", date(2026, 7, 8))
    b.monthly_history(c, s, "standard", date(2026, 7, 8))

    c = b.customer("C0006", "杨磊", "yanglei@example.com", "磊落物流")  # 扣款失败、已逾期
    s = b.sub(c, "pro", "monthly", date(2026, 4, 22), status="past_due", period_end=date(2026, 10, 22))
    for m in range(5):
        d = add_months(date(2026, 4, 22), m)
        b.invoice(c, s, PRO_MONTH, d, d, add_months(d, 1), first=(m == 0))
    b.invoice(c, s, PRO_MONTH, date(2026, 9, 22), date(2026, 9, 22), date(2026, 10, 22), status="failed")

    c = b.customer("C0007", "赵敏", "zhaomin@example.com", "敏思设计")  # 年付续费第 4 天:续费 7 天规则
    s = b.sub(c, "standard", "yearly", date(2025, 9, 27))
    b.invoice(c, s, STD_YEAR, date(2025, 9, 27), date(2025, 9, 27), date(2026, 9, 27), first=True)
    b.invoice(c, s, STD_YEAR, date(2026, 9, 27), date(2026, 9, 27), date(2027, 9, 27))

    c = b.customer("C0008", "黄强", "huangqiang@example.com", "强盛制造集团", vip=True)  # 企业版合同:不走自助退款
    s = b.sub(c, "enterprise", "yearly", date(2026, 9, 28), seats=10, price=SEAT_PRICE * 10 * 12)
    b.invoice(c, s, SEAT_PRICE * 10 * 12, date(2026, 9, 28), date(2026, 9, 28), date(2027, 9, 28), first=True)

    c = b.customer("C0009", "周婷", "zhouting@example.com", "")  # 免费版用户
    b.sub(c, "free", "monthly", date(2026, 8, 1))

    c = b.customer("C0010", "吴刚", "wugang@example.com", "刚正财税", vip=True)  # 老客户,反复遇到银行同步问题
    s = b.sub(c, "pro", "yearly", date(2026, 1, 10))
    b.invoice(c, s, PRO_YEAR, date(2026, 1, 10), date(2026, 1, 10), date(2027, 1, 10), first=True)
    for d in (date(2026, 4, 11), date(2026, 7, 13), date(2026, 9, 2)):
        b.ticket(
            c,
            "wugang@example.com",
            "银行流水又不同步了",
            "招商银行账户流水同步失败,提示 E3001。",
            "technical",
            d,
            "银行授权 90 天到期,指导客户重新授权后恢复。客户希望到期前能提醒。",
        )

    c = b.customer("C0011", "徐丽", "xuli@example.com", "丽人美业")  # 年付首购正好第 14 天:边界
    s = b.sub(c, "standard", "yearly", date(2026, 9, 17))
    b.invoice(c, s, STD_YEAR, date(2026, 9, 17), date(2026, 9, 17), date(2027, 9, 17), first=True)

    c = b.customer("C0012", "孙浩", "sunhao@example.com", "浩瀚电商")  # 年付首购第 15 天:刚过线
    s = b.sub(c, "standard", "yearly", date(2026, 9, 16))
    b.invoice(c, s, STD_YEAR, date(2026, 9, 16), date(2026, 9, 16), date(2027, 9, 16), first=True)


SURNAMES = "王李张刘陈杨黄赵吴周徐孙马朱胡郭何林罗高"
GIVEN = "静 磊 婷 强 敏 军 燕 杰 娟 涛 明 超 霞 平 刚 桂英 建华 晓东".split()
SHOPS = ["商贸", "科技", "咨询", "设计", "餐饮", "物流", "电商", "教育", "财税", "传媒"]
REGIONS = ["北京", "上海", "广州", "深圳", "杭州", "成都", "武汉"]
TOPICS = [
    ("怎么开专票", "invoice", "指导客户完成企业认证后申请增值税专用发票。"),
    ("导入提示 E2001", "technical", "客户上传了 .xls 文件,指导另存为 .xlsx 后导入成功。"),
    ("扣款失败", "billing", "客户信用卡过期,更换为支付宝后支付成功。"),
    ("想升级专业版", "plan_change", "说明升级立即生效并按剩余天数补差价,客户已自助升级。"),
    ("收不到验证码", "account", "验证码进了垃圾邮件箱,客户找到后登录成功。"),
]


def add_random_customers(b: Builder, rng: random.Random) -> None:
    """C0013–C0200:随机生成,让数据看起来像真的,检索和查询也不至于太容易。"""
    for i in range(13, 201):
        name = rng.choice(SURNAMES) + rng.choice(GIVEN)
        email = f"user{i:04d}@example.com"
        cid = b.customer(
            f"C{i:04d}",
            name,
            email,
            f"{name}{rng.choice(SHOPS)}",
            created=date(2025, 1, 1) + timedelta(days=rng.randint(0, 600)),
            region=rng.choice(REGIONS),
        )
        plan = rng.choices(["free", "standard", "pro"], weights=[3, 5, 2])[0]
        cycle = "monthly" if plan == "free" else rng.choice(["monthly", "yearly"])
        started = b.today - timedelta(days=rng.randint(20, 400))
        sid = b.sub(cid, plan, cycle, started)
        if plan != "free":
            if cycle == "monthly":
                b.monthly_history(cid, sid, plan, started)
            else:
                b.yearly_history(cid, sid, plan, started)
        for _ in range(rng.choice([0, 0, 1, 1, 2])):
            subject, category, summary = rng.choice(TOPICS)
            b.ticket(cid, email, subject, subject, category, b.today - timedelta(days=rng.randint(5, 300)), summary)


def build(today: date | None = None) -> Builder:
    """只在内存里造数据,不碰数据库。today 不传就用配置里的 SP_TODAY。"""
    b = Builder(today or get_settings().sp_today)
    add_story_customers(b)
    add_random_customers(b, random.Random(SEED))
    return b


def write(conn: psycopg.Connection[DictRow], b: Builder) -> dict[str, int]:
    """清空业务表再整批写入,放在一个事务里:要么全成功,要么全回滚。返回每张表写了几行。"""
    rows_by_table = {"customers": b.customers, "subscriptions": b.subs, "invoices": b.invoices, "tickets": b.tickets}
    counts: dict[str, int] = {}
    with conn.transaction():
        conn.execute(
            "TRUNCATE biz.audit_log, biz.customer_profiles, biz.refund_requests, biz.tickets, "
            "biz.invoices, biz.subscriptions, biz.customers CASCADE"
        )
        for table in TABLES:
            rows = rows_by_table[table]
            cols = list(rows[0])
            insert = sql.SQL("INSERT INTO {} ({}) VALUES ({})").format(
                sql.Identifier("biz", table),
                sql.SQL(", ").join(sql.Identifier(c) for c in cols),
                sql.SQL(", ").join(sql.Placeholder(c) for c in cols),
            )
            with conn.cursor() as cur:
                cur.executemany(insert, rows)
            counts[table] = len(rows)
    return counts


def main() -> None:
    b = build()
    with connect() as conn:
        for table, n in write(conn, b).items():
            print(f"{table}: {n}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `import calendar` 给 `add_months` 查当月天数。
- `import random` 只用它的 `random.Random` 类,不调用全局的 `random.xxx()`。
- `from datetime import date, timedelta` `timedelta` 在随机客户那里用:「今天往前推 N 天」。
- `from typing import Any` 给 `Row` 用。
- `import psycopg` `write()` 的参数类型要写 `psycopg.Connection`。
- `from kb_facts import PRO_MONTH, PRO_YEAR, SEAT_PRICE, STD_MONTH, STD_YEAR` 价格全部来自事实源。Day 444 改价格,造数跟着变,帮助中心和账单不会出现「文章说 39、账单收 40」。
- `from psycopg import sql` 第七步的 SQL 拼装工具。
- `from psycopg.rows import DictRow` 连接的行类型,`db.connect()` 返回的就是「行是字典」的连接。
- `from supportpilot.config import get_settings` `build()` 不传「今天」时从这里取 `sp_today`。
- `from supportpilot.db import connect` Day 443 的连接函数,`main()` 里用。
- `Row = dict[str, Any]` 一行数据的类型别名。
- `PRICE = {` 价格表:键是 `(套餐, 周期)` 的元组,元组不可变,可以当字典的键。实测 `PRICE[("standard", "yearly")]` 是 374,`("pro", "yearly")` 是 950。企业版不在表里,按席位算,造数时直接传 `price=`。
- `("free", "monthly"): 0,` 免费版也放进表,省得 `sub()` 里为它多写一个分支。
- `TABLES = [` 写入顺序:被引用的表在前。第七步的实验证明过,写反会报外键错误。
- `SEED = 42` 随机种子,常量放在文件顶部。
- `def add_months(d: date, n: int) -> date:` 第二步的函数。
- `class Builder:` 攒数据的工具,四个列表加一个发号用的计数器。
- `def __init__(self, today: date) -> None:` 「今天」从构造函数传进来,存在 `self.today`,里面所有「补到今天」「包含今天」都读它。
- `def customer(` 加一个客户,返回编号。
- `*,` 单独一个星号表示:后面的参数(`vip`、`created`、`region`)只能写成 `vip=True` 这种关键字形式,不能按位置传。读 `b.customer("C0008", ..., vip=True)` 时一眼就知道这个 `True` 是什么。
- `created: date = date(2025, 6, 1),` 剧情客户不关心注册日期,用默认值;随机客户在调用时传一个随机的。
- `def sub(` 加一条订阅,返回订阅编号。
- `sid = f"S{len(self.subs) + 1:04d}"` 第一条时 `len(self.subs)` 是 0,得到 `S0001`。每个客户恰好一条订阅,所以订阅编号的数字和客户编号一样。
- `if price is None:` 没传价格就查价格表。黄强是企业版,表里没有,所以他调用时传了 `price=`,否则这里会 `KeyError`。
- `if period_end is None:  # 默认:当前计费周期包含「今天」` 没指定本期结束日就自动算,只有杨磊是手动传的(他逾期了,周期停在 10 月 22 日)。
- `while period_end <= self.today:` 从开始日往后推一个周期,直到越过「今天」。代入张伟(2026-03-05 起,月付):04-05、05-05、……、09-05 都 `<=` 10-01,继续推,推到 10-05 才停,所以他的当前周期结束日是 `2026-10-05`。李娜(2026-09-24 起,年付)只推一次,`2027-09-24`。
- `def invoice(` 加一张账单,返回账单号。`status` 和 `first` 是关键字参数。
- `iid = f"INV-{ym}-{self._invoice_seq[ym]:04d}"` 第三步讲过的发号规则。
- `"paid_at": issued if status in ("paid", "refunded") else None,` 付了钱的账单才有付款日。杨磊 9 月那张 `failed`,`paid_at` 是 `None`,写进数据库就是 `NULL`(Day 443 里这一列没有 `NOT NULL`)。
- `def monthly_history(` 给月付客户补齐从开始到今天的每一张账单。
- `d, first = started, True` 同时给两个变量赋值([Day 22](/blog/agent-zero/day-022-tuples-unpack/) 的解包)。`first` 标记「这是不是第一张」,第一张是首购。
- `d, first = add_months(d, 1), False` 日期推一个月,之后的账单都不是首购。
- `def yearly_history(` 年付版本,步长是 12 个月。
- `def ticket(` 加一张历史工单,状态一律 `resolved`,并带上客服当时的处理摘要。
- `"id": f"T{len(self.tickets) + 1:06d}",` 工单号补零到 6 位:`T000001`。吴刚是第一个被造工单的人,他的三张是 `T000001` 到 `T000003`,Day 464 的记忆实验里会用到。
- `def add_story_customers(b: Builder) -> None:` 12 个剧情客户,每人几行。
- `c = b.customer("C0001"` 张伟:正常的月付,用来问政策类问题。
- `b.monthly_history(c, s, "standard", date(2026, 3, 5))` 3 月 5 日起每月一张,到 9 月 5 日共 7 张,编号 `INV-202603-0001` 到 `INV-202609-0001`。
- `c = b.customer("C0002"` 李娜:只有一张 950 元的首购账单,`INV-202609-0002`,第 7 天。
- `c = b.customer("C0003"` 王芳:5 月 20 日的首购,`INV-202605-0002`,第 134 天,早就过了 14 天。
- `c = b.customer("C0004"` 刘洋:月付历史里已经有 9 月 12 日那一张(`INV-202609-0003`)。
- `b.invoice(c, s, STD_MONTH, date(2026, 9, 12)` 再手工插一张周期完全一样的(`INV-202609-0004`),这就是「重复扣款」。
- `c = b.customer("C0006"` 杨磊:逾期客户,订阅状态手动设成 `past_due`。
- `for m in range(5):` 4 月到 8 月 5 张正常扣款,`first=(m == 0)` 只有第一张是首购。
- `status="failed")` 9 月 22 日那张扣款失败,`INV-202609-0006`。
- `c = b.customer("C0007"` 赵敏:去年 9 月 27 日首购(`INV-202509-0001`),今年 9 月 27 日自动续费(`INV-202609-0007`,`first` 不写就是 `False`)。到 10 月 1 日是续费第 4 天。
- `c = b.customer("C0008"` 黄强:企业版,`vip=True`。
- `seats=10, price=SEAT_PRICE * 10 * 12)` 10 席 × 每席每月 59 元 × 12 个月 = 7080。席位单价同样取自事实源,所以今天和 Day 444 的《企业版》文章说的是同一个数。
- `c = b.customer("C0009"` 周婷:免费版只建订阅、不建账单。当前周期结束日实测是 `2026-11-01`。
- `c = b.customer("C0010"` 吴刚:`INV-202601-0001` 是他 1 月的首购。
- `for d in (date(2026, 4, 11)` 三次银行同步失败,间隔大约三个月,正好对应「银行授权 90 天到期」。
- `c = b.customer("C0011"` 徐丽:9 月 17 日付款,到 10 月 1 日第 14 天。
- `c = b.customer("C0012"` 孙浩:9 月 16 日付款,第 15 天。两人只差一天,结论相反。
- `SURNAMES =` 姓氏,一个字符串,`rng.choice` 对字符串也能用,每次取一个字。
- `GIVEN =` 名字。字符串的 `.split()` 默认按空白拆成列表,比手写十八个带引号的元素好读;「桂英」「建华」「晓东」是两个字的名字。
- `TOPICS = [` 五类常见的历史工单:标题、分类、客服当时的处理摘要。
- `def add_random_customers(b: Builder, rng: random.Random) -> None:` 生成器作为参数传进来,函数自己不新建。
- `for i in range(13, 201):` 13 到 200 共 188 个。
- `email = f"user{i:04d}@example.com"` 邮箱按编号生成,保证唯一,和 `schema.sql` 里 `email UNIQUE` 对得上。
- `created=date(2025, 1, 1) + timedelta(days=rng.randint(0, 600)),` 注册日期在 2025 年 1 月 1 日之后的 0 到 600 天里随机。
- `plan = rng.choices(` `choices` 按权重抽,返回列表,所以取 `[0]`。
- `cycle = "monthly" if plan == "free"` 免费版记成 monthly(反正不扣钱),付费的随机月付或年付。
- `started = b.today - timedelta(days=rng.randint(20, 400))` 订阅开始于今天之前 20 到 400 天。
- `for _ in range(rng.choice([0, 0, 1, 1, 2])):` 每人 0、1、2 张历史工单,列表里 0 和 1 各出现两次,所以它们的概率更高(各 40%,2 张 20%)。
- `def build(today: date | None = None) -> Builder:` 唯一的入口:只在内存里造,不碰数据库,测试能直接调。`date | None` 表示可以传日期也可以不传([Day 46](/blog/agent-zero/day-046-type-hints-2/))。
- `b = Builder(today or get_settings().sp_today)` 传了就用传的,没传取配置。`or` 在 `today` 是 `None` 时取后面的值。
- `add_random_customers(b, random.Random(SEED))` 每次 `build()` 都新建一个种子为 42 的生成器,所以每次调用造出的随机部分完全一样。
- `def write(conn: psycopg.Connection[DictRow], b: Builder) -> dict[str, int]:` 写库。参数是连接和装满数据的 `Builder`,返回每张表写了几行。
- `with conn.transaction():` 整个清库加写入放在一个事务里:中途任何一步失败,整体回滚,不会留下一半数据。`db.connect()` 的连接是 `autocommit=True`,需要「几条一起成败」时就靠这个 `with`。
- `"TRUNCATE biz.audit_log` 先清空 7 张业务表。`CASCADE` 把引用它们的数据一起清。`TRUNCATE` 不会重置主键里的业务编号,编号是我们自己发的,所以每次造出来都从 `C0001`、`T000001` 重新编起。
- `for table in TABLES:` 按 `TABLES` 的顺序,先客户后订阅后账单后工单。
- `cols = list(rows[0])` 拿第一行字典的键当列名,所以每行字典的键必须一样。
- `insert = sql.SQL(` 第七步讲过的拼装:表名、列名用 `Identifier`,值用命名占位符。
- `cur.executemany(insert, rows)` 一条 SQL 配一列表参数,批量插入。几百行是一眨眼的事。
- `counts[table] = len(rows)` 记下这张表写了几行。
- `def main() -> None:` 唯一碰数据库的函数。
- `with connect() as conn:` 连接用完自动关闭。
- `if __name__ == "__main__":` 直接运行脚本时才执行 `main()`,被测试 `import` 时什么都不做([Day 32](/blog/agent-zero/day-032-modules/))。

</div>

跑两遍,看结果有没有翻倍:

```bash
uv run python scripts/seed_db.py
uv run python scripts/seed_db.py
```

```text
customers: 200
subscriptions: 200
invoices: 459
tickets: 152
customers: 200
subscriptions: 200
invoices: 459
tickets: 152
```

第二遍的数字和第一遍完全一样,因为每次都先 `TRUNCATE`。再用 `psql` 看几个具体的人。下面这条 SQL 取剧情客户的首购账单和 9 月的账单(`psql supportpilot` 里的库名换成你自己的,我实际用的是另一个临时库):

```bash
psql supportpilot -c "select c.id, c.name, i.id inv, i.amount_cny, i.issued_at, i.is_first_purchase, i.status from biz.customers c join biz.invoices i on i.customer_id = c.id where c.id <= 'C0012' and (i.is_first_purchase or i.issued_at >= '2026-09-01') order by c.id, i.issued_at"
```

```text
  id   | name |       inv       | amount_cny | issued_at  | is_first_purchase | status 
-------+------+-----------------+------------+------------+-------------------+--------
 C0001 | 张伟 | INV-202603-0001 |      39.00 | 2026-03-05 | t                 | paid
 C0001 | 张伟 | INV-202609-0001 |      39.00 | 2026-09-05 | f                 | paid
 C0002 | 李娜 | INV-202609-0002 |     950.00 | 2026-09-24 | t                 | paid
 C0003 | 王芳 | INV-202605-0002 |     950.00 | 2026-05-20 | t                 | paid
 C0004 | 刘洋 | INV-202606-0002 |      39.00 | 2026-06-12 | t                 | paid
 C0004 | 刘洋 | INV-202609-0003 |      39.00 | 2026-09-12 | f                 | paid
 C0004 | 刘洋 | INV-202609-0004 |      39.00 | 2026-09-12 | f                 | paid
 C0005 | 陈静 | INV-202607-0003 |      39.00 | 2026-07-08 | t                 | paid
 C0005 | 陈静 | INV-202609-0005 |      39.00 | 2026-09-08 | f                 | paid
 C0006 | 杨磊 | INV-202604-0002 |      99.00 | 2026-04-22 | t                 | paid
 C0006 | 杨磊 | INV-202609-0006 |      99.00 | 2026-09-22 | f                 | failed
 C0007 | 赵敏 | INV-202509-0001 |     374.00 | 2025-09-27 | t                 | paid
 C0007 | 赵敏 | INV-202609-0007 |     374.00 | 2026-09-27 | f                 | paid
 C0008 | 黄强 | INV-202609-0008 |    7080.00 | 2026-09-28 | t                 | paid
 C0010 | 吴刚 | INV-202601-0001 |     950.00 | 2026-01-10 | t                 | paid
 C0011 | 徐丽 | INV-202609-0009 |     374.00 | 2026-09-17 | t                 | paid
 C0012 | 孙浩 | INV-202609-0010 |     374.00 | 2026-09-16 | t                 | paid
(17 rows)
```

李娜是 `INV-202609-0002`、黄强是 `INV-202609-0008`、吴刚是 `INV-202601-0001`,和第三步说的一致。刘洋两张 9 月 12 日的账单金额、周期一模一样,编号相邻,这就是等着 Agent 去发现的「重复扣款」。

### 零件和大代码的对照

| 零件 | 哪一步 | 在 `seed_db.py` 的哪一段 |
| --- | --- | --- |
| `scratch/s0.py` 的天数核对 | 一 | 不在里面,换成了 `tests/test_seed.py` 里的断言 |
| `add_months` | 二 | 文件开头的 `add_months()` |
| `Builder.customer / invoice` 和账单号 | 三 | `class Builder` 前半 |
| `sub`、`ticket`、两个 `*_history`、12 个人 | 四 | `class Builder` 后半 + `add_story_customers()` |
| `random.Random(42)`、188 个随机客户 | 五 | `add_random_customers()`,`SURNAMES` 到 `TOPICS` 是它的素材 |
| `Builder(today)`、`build(today)` | 六 | `Builder.__init__` 和 `build()` |
| `sql.SQL`、`TABLES` 的顺序、事务 | 七 | `write()` |

## 第九步:测试

今天要守住两类东西:**造数的逻辑**(不连库就能测)和**写库**(要连库)。先是不连库的 `tests/test_seed.py`:

```python
# supportpilot/tests/test_seed.py
"""造数测试(不连数据库):只检查 build() 在内存里造出来的数据。"""

from datetime import date

import pytest
from kb_facts import FIRST_DAYS, RENEW_DAYS, SEAT_PRICE
from seed_db import Builder, add_months, build

TODAY = date(2026, 10, 1)  # 测试里写死,不读 .env,免得有人改了 SP_TODAY 测试就变


@pytest.fixture(scope="module")
def b() -> Builder:
    return build(TODAY)


def invoices_of(b: Builder, cid: str) -> list[dict]:
    return [i for i in b.invoices if i["customer_id"] == cid]


def test_counts(b: Builder):
    assert (len(b.customers), len(b.subs), len(b.invoices), len(b.tickets)) == (200, 200, 459, 152)


def test_same_seed_same_data(b: Builder):
    again = build(TODAY)
    assert again.customers == b.customers
    assert again.invoices == b.invoices
    assert again.tickets == b.tickets


def test_today_moves_the_data(b: Builder):
    """「今天」是造数的输入:换一天,月付客户的账单张数就变了,所以它必须是配置而不是 date.today()。"""
    later = build(date(2026, 10, 27))
    assert len(later.invoices) > len(b.invoices)


def test_ids_are_unique_and_references_resolve(b: Builder):
    for rows in (b.customers, b.subs, b.invoices, b.tickets):
        assert len({r["id"] for r in rows}) == len(rows)
    customer_ids = {c["id"] for c in b.customers}
    sub_owner = {s["id"]: s["customer_id"] for s in b.subs}
    assert {s["customer_id"] for s in b.subs} <= customer_ids
    assert {t["customer_id"] for t in b.tickets} <= customer_ids
    for i in b.invoices:
        assert sub_owner[i["subscription_id"]] == i["customer_id"]  # 账单挂的订阅得是同一个人的


def test_add_months_clamps_to_month_end():
    assert add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert add_months(date(2024, 1, 31), 1) == date(2024, 2, 29)
    assert add_months(date(2026, 12, 5), 1) == date(2027, 1, 5)


@pytest.mark.parametrize(
    ("cid", "days"),
    [("C0002", 7), ("C0011", FIRST_DAYS), ("C0012", FIRST_DAYS + 1)],
    ids=["lina-day7", "xuli-day14", "sunhao-day15"],
)
def test_first_purchase_days(b: Builder, cid: str, days: int):
    (first,) = [i for i in invoices_of(b, cid) if i["is_first_purchase"]]
    assert (TODAY - first["issued_at"]).days == days


def test_wangfang_is_past_the_window(b: Builder):
    (first,) = invoices_of(b, "C0003")
    assert (TODAY - first["issued_at"]).days > FIRST_DAYS
    assert first["amount_cny"] == 950


def test_zhaomin_renewed_inside_renew_window(b: Builder):
    renewal = [i for i in invoices_of(b, "C0007") if not i["is_first_purchase"]]
    assert len(renewal) == 1
    assert (TODAY - renewal[0]["issued_at"]).days <= RENEW_DAYS


def test_liuyang_was_charged_twice(b: Builder):
    same = [i for i in invoices_of(b, "C0004") if i["period_start"] == date(2026, 9, 12)]
    assert len(same) == 2


def test_yanglei_failed_payment(b: Builder):
    failed = [i for i in invoices_of(b, "C0006") if i["status"] == "failed"]
    assert len(failed) == 1 and failed[0]["paid_at"] is None
    sub = next(s for s in b.subs if s["customer_id"] == "C0006")
    assert sub["status"] == "past_due"


def test_enterprise_price_is_seats_times_seat_price(b: Builder):
    sub = next(s for s in b.subs if s["customer_id"] == "C0008")
    assert sub["price_cny"] == sub["seats"] * SEAT_PRICE * 12 == 7080


def test_wugang_has_three_bank_sync_tickets(b: Builder):
    mine = [t for t in b.tickets if t["customer_id"] == "C0010"]
    assert [t["id"] for t in mine] == ["T000001", "T000002", "T000003"]
    assert all("E3001" in t["body"] for t in mine)
```

<div class="line-notes">

- `from datetime import date` 测试里用日期。
- `import pytest` 要用 `fixture` 和 `parametrize`([Day 73](/blog/agent-zero/day-073-pytest-3/))。
- `from kb_facts import FIRST_DAYS, RENEW_DAYS, SEAT_PRICE` 期限和席位价格取自事实源:Day 444 以后政策变了,测试不用改数字。`pyproject.toml` 里的 `pythonpath = ["scripts"]` 让测试找得到它们。
- `from seed_db import Builder, add_months, build` 导入的是 `scripts/seed_db.py` 里的东西,这里只 import 不会连库。
- `TODAY = date(2026, 10, 1)  # 测试里写死` 测试不读 `.env`,免得有人改了 `SP_TODAY` 测试就变。
- `@pytest.fixture(scope="module")` 夹具的作用范围是整个文件:`build()` 造一次,所有测试共用,省时间。测试只读它,不修改它。
- `def invoices_of(b: Builder, cid: str) -> list[dict]:` 一个小辅助:取某个客户的全部账单。
- `assert (len(b.customers), len(b.subs), len(b.invoices), len(b.tickets)) == (200, 200, 459, 152)` 四个数字一起断言。以后谁改了造数,这条最先红。
- `again = build(TODAY)` 再造一遍,和第一遍逐行比较。
- `assert again.customers == b.customers` 两个列表的每个字典都相等才算相等。种子固定、今天固定,所以一定相等。
- `later = build(date(2026, 10, 27))` 换一个「今天」。
- `assert len(later.invoices) > len(b.invoices)` 账单变多了。这条测试是第六步实验的固化:它防的是有人把 `Builder` 里的 `self.today` 偷偷换回 `date.today()`,那样 `build(date(2026, 10, 27))` 和 `build(TODAY)` 会一样多。
- `assert len({r["id"] for r in rows}) == len(rows)` 集合去重后长度不变,说明编号没有重复。
- `sub_owner = {s["id"]: s["customer_id"] for s in b.subs}` 字典推导式:订阅编号到客户编号。
- `assert {s["customer_id"] for s in b.subs} <= customer_ids` `<=` 在集合上是「子集」:每个订阅的客户都存在。工单同理。
- `assert sub_owner[i["subscription_id"]] == i["customer_id"]  # 账单挂的订阅得是同一个人的` 外键只保证订阅存在,不保证它是同一个客户的订阅;这条是数据库管不到的一致性。
- `assert add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)` 月底截断。
- `[("C0002", 7), ("C0011", FIRST_DAYS), ("C0012", FIRST_DAYS + 1)],` 三个边界用例:李娜第 7 天,徐丽正好是期限,孙浩期限加一。参数里用 `FIRST_DAYS` 而不是 14,期限改了,测试要求的「边界」跟着移动。
- `ids=["lina-day7", "xuli-day14", "sunhao-day15"],` 给每组参数起个名字。我第一版写的中文名,失败时 pytest 把它们显示成 `徐丽-...` 的转义,看不懂,所以改成了英文。
- `(first,) = [i for i in invoices_of(b, cid) if i["is_first_purchase"]]` 解包,要求恰好一张首购账单:不是 0 张也不是 2 张,否则这行自己就报错。
- `assert (TODAY - first["issued_at"]).days == days` 距离「今天」的天数。
- `assert (TODAY - first["issued_at"]).days > FIRST_DAYS` 王芳超期。
- `assert (TODAY - renewal[0]["issued_at"]).days <= RENEW_DAYS` 赵敏续费在 7 天内。
- `same = [i for i in invoices_of(b, "C0004") if i["period_start"] == date(2026, 9, 12)]` 刘洋周期从 9 月 12 日开始的账单,应该有 2 张。
- `assert len(failed) == 1 and failed[0]["paid_at"] is None` 杨磊恰好一张失败账单,没有付款日。
- `assert sub["price_cny"] == sub["seats"] * SEAT_PRICE * 12 == 7080` 链式比较:三个值都相等才通过。黄强的订阅价是席位数 × 单价 × 12,而且就是 7080。
- `assert [t["id"] for t in mine] == ["T000001", "T000002", "T000003"]` 吴刚的三张工单编号。
- `assert all("E3001" in t["body"] for t in mine)` 三张都提到 E3001。

</div>

再是连库的 `tests/test_seed_live.py`。它有两个设计:连不上库就**跳过**(和 Day 443 一样),写入放在 `force_rollback=True` 的事务里,测完回滚,开发库里的数据不动:

```python
# supportpilot/tests/test_seed_live.py
"""连真数据库的造数测试。写入放在 force_rollback 事务里,测完回滚,不会动你开发库里已有的数据。"""

from datetime import date

import psycopg
import pytest
from psycopg.rows import DictRow
from seed_db import build, write

from supportpilot.db import connect


@pytest.fixture
def conn():
    try:
        c = connect()
    except (psycopg.OperationalError, psycopg.ProgrammingError) as e:
        pytest.skip(f"数据库没就绪:{str(e).splitlines()[0]}")
    with c:
        yield c


def test_write_fills_tables_and_rolls_back(conn: psycopg.Connection[DictRow]):
    before = conn.execute("SELECT count(*) AS n FROM biz.invoices").fetchone()
    with conn.transaction(force_rollback=True):
        counts = write(conn, build(date(2026, 10, 1)))
        row = conn.execute("SELECT count(*) AS n FROM biz.invoices").fetchone()
        assert row is not None and row["n"] == counts["invoices"] == 459
        # 剧情客户在库里:李娜的 950 元首购账单
        li = conn.execute("SELECT amount_cny, status FROM biz.invoices WHERE id = 'INV-202609-0002'").fetchone()
        assert li is not None and (li["amount_cny"], li["status"]) == (950, "paid")
    after = conn.execute("SELECT count(*) AS n FROM biz.invoices").fetchone()
    assert before == after  # 回滚后库和测试前一样


def test_write_twice_does_not_double(conn: psycopg.Connection[DictRow]):
    with conn.transaction(force_rollback=True):
        b = build(date(2026, 10, 1))
        write(conn, b)
        write(conn, b)
        row = conn.execute("SELECT count(*) AS n FROM biz.customers").fetchone()
        assert row is not None and row["n"] == 200
```

<div class="line-notes">

- `from psycopg.rows import DictRow` 连接行类型,给类型标注用。
- `from seed_db import build, write` 导入造数入口和写库函数。
- `@pytest.fixture` 和 Day 443 的 `test_db.py` 一样的夹具:连得上就给连接,连不上或者没建表就 `pytest.skip`。
- `c = connect()` 真的去连库。
- `pytest.skip(f"数据库没就绪:{str(e).splitlines()[0]}")` 跳过时把原因的第一行带上,一眼知道是没起库还是没建表。
- `before = conn.execute("SELECT count(*) AS n FROM biz.invoices").fetchone()` 先记下测试前账单表有几行,`AS n` 让结果是 `{"n": 459}`。
- `with conn.transaction(force_rollback=True):` 里面所有写入,不管成败,最后都撤销。
- `counts = write(conn, build(date(2026, 10, 1)))` 真的写一遍。`write()` 自己里面也有 `with conn.transaction()`,在外层事务里它变成嵌套事务(保存点),外层回滚时一起撤销。
- `assert row is not None and row["n"] == counts["invoices"] == 459` 库里的行数、`write()` 报告的行数、预期值三者一致。`row is not None` 是给类型检查器看的。
- `li = conn.execute("SELECT amount_cny, status FROM biz.invoices WHERE id = 'INV-202609-0002'").fetchone()` 李娜那张账单真的在库里。
- `assert li is not None and (li["amount_cny"], li["status"]) == (950, "paid")` `amount_cny` 从 `numeric` 列读出来是 `Decimal('950.00')`,和整数 950 比较是相等的。
- `assert before == after  # 回滚后库和测试前一样` 测试前后账单表的行数一样,证明回滚生效。
- `write(conn, b)` 同一份数据连写两遍,第二遍先 `TRUNCATE` 再写。
- `assert row is not None and row["n"] == 200` 客户还是 200,没有翻倍。

</div>

跑全部检查:

```bash
uv run ruff check . && uv run ruff format --check .
uv run basedpyright
uv run pytest -q
```

```text
All checks passed!
88 files already formatted
0 errors, 0 warnings, 0 notes
......................................................                   [100%]
54 passed in 0.80s
```

54 个测试:前四天的 38 个加今天的 16 个(`test_seed.py` 14 条,`test_seed_live.py` 2 条)。

### 体检脚本:12 个剧情客户一页看完

最后写一个很小的脚本,`scripts/story_report.py`,把 12 个剧情客户从**库里**读出来,每人一行:最近一张账单是多少钱、是不是首购、距离「今天」几天。它不是测试,是给人看的:数据到底进没进库、进得对不对,眼睛扫一遍最快。

```python
# supportpilot/scripts/story_report.py
"""把 12 个剧情客户从库里读出来,每人一行:最近一张账单是多少钱、距离「今天」几天。"""

from supportpilot.config import get_settings
from supportpilot.db import connect

QUERY = """
SELECT c.id, c.name, s.plan, s.billing_cycle AS cycle, s.status,
       i.id AS invoice, i.amount_cny AS amount, i.is_first_purchase AS first,
       %(today)s::date - i.issued_at AS days
FROM biz.customers c
JOIN biz.subscriptions s ON s.customer_id = c.id
LEFT JOIN biz.invoices i ON i.customer_id = c.id
     AND i.issued_at = (SELECT max(issued_at) FROM biz.invoices WHERE customer_id = c.id)
WHERE c.id <= 'C0012'
ORDER BY c.id, i.id
"""


def main() -> None:
    today = get_settings().sp_today
    print(f"今天 = {today}")
    with connect() as conn:
        for r in conn.execute(QUERY, {"today": today}):
            print(
                f"{r['id']} {r['name']} {r['plan']:<10} {r['cycle']:<8} {r['status']:<8} "
                f"{r['invoice'] or '-':<16} {r['amount'] if r['amount'] is not None else '-':>8} "
                f"首购={'是' if r['first'] else '否'}  {r['days'] if r['days'] is not None else '-'} 天"
            )


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from supportpilot.config import get_settings` 取 `sp_today`,「距今几天」要用它算。
- `QUERY = """` 一条多行 SQL,放在常量里。
- `%(today)s::date - i.issued_at AS days` `%(today)s` 是命名参数,`::date` 是 Postgres 的类型转换,把参数当日期。两个日期相减,Postgres 直接得到整数天数。
- `FROM biz.customers c` 给表起别名 `c`,后面少写字。
- `JOIN biz.subscriptions s ON s.customer_id = c.id` 每个客户一条订阅,用内连接。
- `LEFT JOIN biz.invoices i ON i.customer_id = c.id` 左连接:没有账单的客户(周婷)也要出现一行,账单那几列是 `NULL`。内连接会把她丢掉。
- `AND i.issued_at = (SELECT max(issued_at) FROM biz.invoices WHERE customer_id = c.id)` 只要这个客户「最近一天」的账单。子查询取该客户账单的最大日期。刘洋最近一天有两张,所以他会出现两行,这正是我们要看到的。
- `WHERE c.id <= 'C0012'` 字符串比较,取 C0001 到 C0012。
- `ORDER BY c.id, i.id` 先按客户,再按账单号。
- `today = get_settings().sp_today` 「今天」仍然取配置。
- `for r in conn.execute(QUERY, {"today": today}):` 参数用字典传,键对应 SQL 里的 `%(today)s`。遍历结果,每个 `r` 是一个字典。
- `f"{r['id']} {r['name']} {r['plan']:<10} {r['cycle']:<8} {r['status']:<8} "` `:<10` 是左对齐、宽度 10,让各列对齐。
- `f"{r['invoice'] or '-':<16} {r['amount'] if r['amount'] is not None else '-':>8} "` 没有账单的人 `invoice` 是 `None`,`or '-'` 换成一个短横线;金额右对齐。
- `f"首购={'是' if r['first'] else '否'}  {r['days'] if r['days'] is not None else '-'} 天"` 首购标记和距今天数。

</div>

```bash
uv run python scripts/story_report.py
```

```text
今天 = 2026-10-01
C0001 张伟 standard   monthly  active   INV-202609-0001     39.00 首购=否  26 天
C0002 李娜 pro        yearly   active   INV-202609-0002    950.00 首购=是  7 天
C0003 王芳 pro        yearly   active   INV-202605-0002    950.00 首购=是  134 天
C0004 刘洋 standard   monthly  active   INV-202609-0003     39.00 首购=否  19 天
C0004 刘洋 standard   monthly  active   INV-202609-0004     39.00 首购=否  19 天
C0005 陈静 standard   monthly  active   INV-202609-0005     39.00 首购=否  23 天
C0006 杨磊 pro        monthly  past_due INV-202609-0006     99.00 首购=否  9 天
C0007 赵敏 standard   yearly   active   INV-202609-0007    374.00 首购=否  4 天
C0008 黄强 enterprise yearly   active   INV-202609-0008   7080.00 首购=是  3 天
C0009 周婷 free       monthly  active   -                       - 首购=否  - 天
C0010 吴刚 pro        yearly   active   INV-202601-0001    950.00 首购=是  264 天
C0011 徐丽 standard   yearly   active   INV-202609-0009    374.00 首购=是  14 天
C0012 孙浩 standard   yearly   active   INV-202609-0010    374.00 首购=是  15 天
```

和第一步的核对一致:李娜 7 天、徐丽 14 天、孙浩 15 天、赵敏 4 天。刘洋两行是同一天的两张。周婷没有账单,所以是一行短横线。这一页以后每次 `make seed` 之后都可以看一眼,Day 452 写退款规则时也拿它当参考答案。

### 提交

```bash
git add -A
git status --short
git commit -m "feat: 造业务库 seed_db、剧情客户体检脚本和测试"
```

```text
A  scripts/seed_db.py
A  scripts/story_report.py
A  tests/test_seed.py
A  tests/test_seed_live.py
```

```text
trim trailing whitespace.................................................Passed
fix end of files.........................................................Passed
check yaml...........................................(no files to check)Skipped
check toml...........................................(no files to check)Skipped
check for added large files..............................................Passed
detect private key.......................................................Passed
ruff check...............................................................Passed
ruff format..............................................................Passed
```

今天没有新增方块:Day 438 的表里「事实源和造数」是 `scripts/` 这个目录,Day 444 就算「有文件」了,今天往里面加的是同一个目录里的新脚本。

## 动手练习

### 练习 1:换一个「今天」,看数据怎么变

用 `SP_TODAY=2026-10-27`(我写这篇的当天)重新造一次数,再看剧情客户体检。观察:账单总数变成多少?李娜还是第 7 天吗?刘洋那一行有什么不同?做完记得改回来重造,不然后面的天会拿到错的数据。

<details><summary>参考答案</summary>

`Settings` 会读环境变量,命令前面临时加一个变量就行,只对这一条命令生效:

```bash
SP_TODAY=2026-10-27 uv run python scripts/seed_db.py
SP_TODAY=2026-10-27 uv run python scripts/story_report.py | head -6
```

```text
customers: 200
subscriptions: 200
invoices: 462
tickets: 152
今天 = 2026-10-27
C0001 张伟 standard   monthly  active   INV-202610-0001     39.00 首购=否  22 天
C0002 李娜 pro        yearly   active   INV-202609-0002    950.00 首购=是  33 天
C0003 王芳 pro        yearly   active   INV-202605-0002    950.00 首购=是  160 天
C0004 刘洋 standard   monthly  active   INV-202610-0002     39.00 首购=否  15 天
C0005 陈静 standard   monthly  active   INV-202610-0003     39.00 首购=否  19 天
```

账单从 459 张变成 462 张(张伟、刘洋、陈静的 10 月扣款日都过了,各多一张)。李娜变成第 33 天,不再能全额退:同一份数据,「今天」一变标准答案就变,第六步和 Day 442 说的就是这个。刘洋从两行变成一行:他最近一天的账单现在是 10 月 12 日那张,9 月 12 日的重复扣款被挤到了历史里,体检脚本只显示「最近一天」。这也提醒一点:换「今天」会让剧情客户的场景整个失效,所以 `SP_TODAY` 不要在评测期间乱动。

改回来:

```bash
uv run python scripts/seed_db.py
uv run python scripts/story_report.py | head -3
```

```text
customers: 200
subscriptions: 200
invoices: 459
tickets: 152
今天 = 2026-10-01
C0001 张伟 standard   monthly  active   INV-202609-0001     39.00 首购=否  26 天
C0002 李娜 pro        yearly   active   INV-202609-0002    950.00 首购=是  7 天
```

不带环境变量时用的是 `.env` 里的 `SP_TODAY=2026-10-01`。

</details>

### 练习 2:改徐丽的日期,读测试的报错

把 `add_story_customers` 里徐丽的付款日从 9 月 17 日改成 9 月 18 日(订阅开始日、账单开具日、周期起止日一起改),跑 `uv run pytest -q tests/test_seed.py`。哪条测试红?报错说了什么?改回来。

<details><summary>参考答案</summary>

用 `sed` 一次改掉(改之前先备份 `cp scripts/seed_db.py scratch/seed_db.bak`):

```bash
sed -i '' 's/b.sub(c, "standard", "yearly", date(2026, 9, 17))/b.sub(c, "standard", "yearly", date(2026, 9, 18))/; s/STD_YEAR, date(2026, 9, 17), date(2026, 9, 17), date(2027, 9, 17)/STD_YEAR, date(2026, 9, 18), date(2026, 9, 18), date(2027, 9, 18)/' scripts/seed_db.py
uv run pytest -q tests/test_seed.py 2>&1 | tail -21
```

```text
......F.......                                                           [100%]
=================================== FAILURES ===================================
_____________________ test_first_purchase_days[xuli-day14] _____________________

b = <seed_db.Builder object at 0x10c3856d0>, cid = 'C0011', days = 14

    @pytest.mark.parametrize(
        ("cid", "days"),
        [("C0002", 7), ("C0011", FIRST_DAYS), ("C0012", FIRST_DAYS + 1)],
        ids=["lina-day7", "xuli-day14", "sunhao-day15"],
    )
    def test_first_purchase_days(b: Builder, cid: str, days: int):
        (first,) = [i for i in invoices_of(b, cid) if i["is_first_purchase"]]
>       assert (TODAY - first["issued_at"]).days == days
E       assert 13 == 14
E        +  where 13 = (datetime.date(2026, 10, 1) - datetime.date(2026, 9, 18)).days

tests/test_seed.py:63: AssertionError
=========================== short test summary info ============================
FAILED tests/test_seed.py::test_first_purchase_days[xuli-day14] - assert 13 =...
1 failed, 13 passed in 0.12s
```

只有这一条红,另外 13 条都过:改一个人的日期不会碰到别人。断言写成 `== days` 而不是 `<= FIRST_DAYS`,所以它抓的是「正好第 14 天」这个边界本身,而不是「在期限内」。改回 9 月 17 日,14 条全绿。

</details>

### 练习 3:加一条测试,每条在用的订阅都没过期

写一个测试:`active` 和 `past_due` 的订阅,`current_period_end` 都必须晚于「今天」。先确认现在是绿的,再把杨磊的 `period_end` 改成 9 月 22 日,看它红在哪个订阅上,最后改回来。测试文件放 `scratch/test_ex3.py`,用 `uv run pytest -q scratch/test_ex3.py` 跑。

<details><summary>参考答案</summary>

```python
# supportpilot/scratch/test_ex3.py
from datetime import date

from seed_db import build

TODAY = date(2026, 10, 1)


def test_open_subscriptions_end_after_today():
    b = build(TODAY)
    open_subs = [s for s in b.subs if s["status"] in ("active", "past_due")]
    assert len(open_subs) == 200
    late = [s["id"] for s in open_subs if s["current_period_end"] <= TODAY]
    assert late == []
```

<div class="line-notes">

- `from seed_db import build` `scratch/` 里的测试文件也能用 `pythonpath = ["scripts"]` 找到 `seed_db`,因为 pytest 读的是 `pyproject.toml`,和测试文件放在哪个目录无关。
- `open_subs = [s for s in b.subs if s["status"] in ("active", "past_due")]` 没取消的订阅,也就是「在用」的。这份数据里 200 条订阅全是这两种状态。
- `assert len(open_subs) == 200` 先断言有 200 条:如果筛选条件写错筛成空列表,下面的 `late == []` 会空转通过。这个习惯是 Day 443 的 `assert re.findall(kinds, SCHEMA)` 学来的。
- `late = [s["id"] for s in open_subs if s["current_period_end"] <= TODAY]` 本期结束日不晚于今天的订阅编号。
- `assert late == []` 一个也不该有。

</div>

```bash
uv run pytest -q scratch/test_ex3.py
```

```text
.                                                                        [100%]
1 passed in 0.24s
```

现在是绿的。把杨磊那一行 `period_end=date(2026, 10, 22)` 改成 `date(2026, 9, 22)` 再跑:

```text
E       AssertionError: assert ['S0006'] == []
E         
E         Left contains one more item: 'S0006'
E         Use -v to get more diff
1 failed in 0.28s
```

`S0006` 就是杨磊的订阅。逾期客户的订阅还没取消,周期结束日却在「今天」之前,那是矛盾的数据,会让 Day 452 的资格检查读到一个说不清的状态。改回 `date(2026, 10, 22)` 恢复绿色。这条测试其实也该进正式的 `tests/test_seed.py`,留给你自己决定。

</details>

### 练习 4:用 SQL 找出重复扣款

刘洋的重复扣款是我手工插进去的。假装你不知道,用一条 SQL 在库里把它找出来:同一个客户、同一个计费周期开始日、有两张以上账单。再回答一个问题:为什么 `INV-202609-0003` 和 `0004` 是相邻的,而李娜(9 月 24 日)的 `0002` 排在刘洋(9 月 12 日)前面?

<details><summary>参考答案</summary>

```bash
psql supportpilot -c "select customer_id, period_start, count(*) n, array_agg(id order by id) ids from biz.invoices group by customer_id, period_start having count(*) > 1"
```

```text
 customer_id | period_start | n |                ids                
-------------+--------------+---+-----------------------------------
 C0004       | 2026-09-12   | 2 | {INV-202609-0003,INV-202609-0004}
(1 row)
```

`GROUP BY customer_id, period_start` 把「同一个人同一个周期」的账单归成一组,`HAVING count(*) > 1` 只留下超过一张的组([Day 88](/blog/agent-zero/day-088-sql-4/))。全库 459 张账单里只有刘洋这一组,说明随机客户的数据里没有意外的重复,剧情客户之外干干净净。以后 Agent 的 SQL 工具(Day 455)被问到「有没有重复扣款」,答案应该就是这一行。

编号为什么不按日期排:

```bash
psql supportpilot -c "select id, issued_at from biz.invoices where id like 'INV-202609-000%' order by id"
```

```text
       id        | issued_at  | customer_id 
-----------------+------------+-------------
 INV-202609-0001 | 2026-09-05 | C0001
 INV-202609-0002 | 2026-09-24 | C0002
 INV-202609-0003 | 2026-09-12 | C0004
 INV-202609-0004 | 2026-09-12 | C0004
 INV-202609-0005 | 2026-09-08 | C0005
 INV-202609-0006 | 2026-09-22 | C0006
 INV-202609-0007 | 2026-09-27 | C0007
 INV-202609-0008 | 2026-09-28 | C0008
 INV-202609-0009 | 2026-09-17 | C0011
```

(这条查询我多选了 `customer_id` 一列,方便看是谁。)编号是 `Builder` 按**调用 `invoice()` 的先后**发的:代码先造张伟,再造李娜、刘洋……所以 0002 是李娜,不管她几号付款。刘洋的 9 月账单被 `monthly_history` 先发出一张(0003),我又手工插了一张(0004),所以相邻。按日期排序看就对了:`order by issued_at` 时 0003、0004 夹在 0005(9 月 8 日)和 0009(9 月 17 日)之间。教训:**别让 Agent 靠账单号判断先后**,要看 `issued_at`。

</details>

## 名词解释

| 名词 | 意思 |
| --- | --- |
| fixture(测试数据) | 为测试准备好的一批固定数据。前端的 `fixtures/user.json`、Storybook 的故事都是同类东西。注意和 pytest 的 `@pytest.fixture`(测试用的准备函数)是两回事,名字撞了 |
| 剧情客户 | 手工设计的、每人对应一个要测的场景的客户,比如「正好第 14 天」。和随机生成的客户相对 |
| 确定性造数 | 同样的输入永远造出同样的数据。靠两样:固定「今天」、固定随机种子 |
| 随机种子 seed | 给伪随机数生成器的初始值。种子一样,抽出的数字序列一样 |
| `random.Random(42)` | 一个独立的随机数生成器对象,有自己的状态,不受全局 `random.xxx()` 影响 |
| 边界用例 | 刚好卡在规则分界线上的数据,比如第 14 天和第 15 天。最容易写错的地方都在边界 |
| `timedelta` | 一段固定长度的时间(天、秒)。没有「月」这个单位,因为一个月不是固定长度 |
| `LiteralString` | 类型标注,表示「写死在代码里的字符串」。psycopg 只放行它当 SQL,用来拦 SQL 注入 |
| `sql.Identifier` | psycopg 里表示表名、列名的对象,渲染时自动加双引号并转义 |
| 命名占位符 `%(name)s` | SQL 里的参数位置,值从字典里按键取。比 `%s` 按位置取更不容易错位 |
| `TRUNCATE` | 清空整张表,比 `DELETE FROM` 快。`CASCADE` 把引用它的表一起清 |
| 外键顺序 | 有外键的表,写入时被指向的表要先写,不然报 `ForeignKeyViolation` |
| `force_rollback` | psycopg 的 `conn.transaction(force_rollback=True)`:块里不管成败最后都回滚,测试里用它保证不留痕迹 |
| 左连接 `LEFT JOIN` | 左边的表每一行都保留,右边对不上就填 `NULL`。周婷没有账单,靠它才不会从结果里消失 |

## 常见误区

**用 `date.today()` 造数据。** 造出来的数据每天都不一样,「正好第 14 天」的徐丽一天后就成了第 15 天,评测标准答案跟着变,你却没改一行代码。今天的 `build(today)` 把它做成参数,测试里还有一条专门抓这个回退。

**全局 `random.seed(42)` 就算固定了。** 第五步的实验里同样的种子得到两个不同的序列,因为中间别的代码也用了全局随机数。要固定就用自己的 `random.Random(42)` 对象。

**随机客户造得越多越好。** 188 个够了。造 10000 个只会让每次 `make seed` 变慢、让体检和调试时在海量数据里找不到人。数据量要服务于场景:检索和查询别太容易,但不用成为性能测试。

**剧情客户不写剧情注释。** 三个月后你看到 `b.customer("C0006", ...)` 完全不记得杨磊是干什么的。每个人后面那句 `# 扣款失败、已逾期` 是写给以后的自己和评测集作者看的。

**价格和期限自己再写一遍。** 如果 `seed_db.py` 里写 `39`、`14`,而帮助中心用的是 `kb_facts.STD_MONTH`,迟早有一边会改、另一边忘。事实源就是为了只写一次,造数脚本也要从它取。

**不分「内存里造」和「写库」。** 如果造数据和执行 SQL 混在一个函数里,测试就必须连库。`build()` 和 `write()` 分开后,14 条测试不用数据库,几分之一秒跑完,连库的只有 2 条。

**写库的测试直接清开发库。** 我第一版的想法是测试里调 `seed_db.main()`,一跑就把你手上调试用的数据清了。放进 `force_rollback` 的事务里,测完库和测前一模一样。

**换了「今天」以后还拿旧体检结果当标准。** 练习 1 证明过,同一个人的「第几天」会变。看体检结果之前先看第一行打印的「今天」。

## 学习资料

### 文档与文章

- [Python 文档 · random](https://docs.python.org/zh-cn/3.12/library/random.html):`random.Random` 类、`seed`、`choice`、`choices`、`randint` 都在这里,今天用到的全是。文档开头就提醒了这些是伪随机、不能用于安全场景。15 分钟。
- [Python 文档 · calendar.monthrange](https://docs.python.org/zh-cn/3.12/library/calendar.html):返回「这个月 1 号是星期几、这个月有几天」。看 `monthrange` 那一条就够。
- [Python 文档 · datetime](https://docs.python.org/zh-cn/3.12/library/datetime.html):`date`、`timedelta`、`strftime` 的格式代码表(`%Y%m` 是年月)。20 分钟。
- [psycopg 3 文档 · sql 模块](https://www.psycopg.org/psycopg3/docs/api/sql.html):`SQL`、`Identifier`、`Placeholder`、`Composed`,以及为什么不该用字符串拼 SQL。读开头那一段和 `Identifier` 的例子。20 分钟。
- [psycopg 3 文档 · 事务管理](https://www.psycopg.org/psycopg3/docs/basic/transactions.html):`conn.transaction()`、嵌套(保存点)和 `force_rollback`,今天的 `write()` 和测试都建立在它上面。
- [Martin Fowler · Object Mother](https://martinfowler.com/bliki/ObjectMother.html):测试里「造一批有名字的标准数据」这个做法的老名字。剧情客户就是它。英文,5 分钟。
- [PostgreSQL 17 文档 · TRUNCATE](https://www.postgresql.org/docs/17/sql-truncate.html):`CASCADE`、`RESTART IDENTITY` 的含义。我们的主键是业务编号,不是自增,所以用不到 `RESTART IDENTITY`,但 `audit_log` 的 `bigserial` 会用到,值得知道。
- [Faker 文档](https://faker.readthedocs.io/):Python 最常用的假数据库,能造姓名、地址、邮箱。我今天没用它,因为中文姓名要的是几十个字的字符串拼接,自己写更简单,而且 Faker 还要多一个依赖和一层随机状态。造得更多更真时再用它。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1tmyFB4Enm&autoplay=0&high_quality=1" title="Python 的6个随机数方法,解决 90% 随机场景需求" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>水哥澎湃 · Python 的6个随机数方法,解决 90% 随机场景需求 · 约 10 分钟,2025 年。把 `choice`、`choices`、`randint`、`shuffle`、`sample` 一遍过,今天 `add_random_customers` 里用了其中三个。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Dc411L7Fe&autoplay=0&high_quality=1" title="【Random库教程】03_随机数种子,random函数的伪随机" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>华算黄老师-华算科技 · 【Random库教程】03_随机数种子,random函数的伪随机 · 约 3 分钟。种子为什么能让「随机」可复现,看完再回头做第五步的实验。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/eirjjyP2qcQ" title="Python Tutorial: Datetime Module - How to work with Dates, Times, Timedeltas, and Timezones" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial: Datetime Module · 英文,可开自动字幕。`date`、`timedelta`、`strftime` 的演示。今天只用了最基础的三样,时区那一段先跳过。我没有逐分钟核对内容,按标题当补充看。</figcaption>
</figure>

### 书籍

今天这组不需要。

### 开源项目与代码

- [joke2k/faker](https://github.com/joke2k/faker):上面说的假数据库。读它的 `providers/` 目录,每种数据一个小文件,正好看出「造数据」这件事的通用结构:一组候选值加随机选择。
- [pytest-dev/pytest-factoryboy](https://github.com/pytest-dev/pytest-factoryboy):把「工厂」造数据的方式接进 pytest。我们的 `Builder` 是它的手工简化版,想系统学可以看它的 README。

## 自测

1. 剧情客户和随机客户各解决什么问题?只有其中一种行不行?

<details><summary>答案</summary>

剧情客户保证每个要测的场景都有对应的数据,而且数字精确(第 7 天、第 14 天、第 15 天),评测集的标准答案靠它们算出来。随机客户让库看起来像真的一家公司,让检索和查询有一定的噪声,避免模型靠「库里就这么几个人」蒙对。只有剧情客户,Agent 的检索和 SQL 工具太容易,分数虚高;只有随机客户,没有任何一个人精确对应某条规则,没法出有标准答案的题。

</details>

2. 徐丽(第 14 天)和孙浩(第 15 天)为什么要成对?

<details><summary>答案</summary>

「14 天内」含不含第 14 天是最容易出错的边界。模型可能答错,代码里 `<` 和 `<=` 写错也会错。一对只差一天、结论相反的数据,让两种错都被抓到:只有徐丽的话,把 `<=` 写成 `<` 会被发现,但把期限错写成 15 天发现不了;有了孙浩,期限写成 15 才会让他被误判成可全额退。成对用例把边界从两侧夹住。

</details>

3. 用 `random.seed(42)` 和 `random.Random(42)` 各有什么区别?造数时该用哪个?

<details><summary>答案</summary>

前者给全局生成器设种子,中间只要有别的代码也用了一次全局随机数,序列就错位,第五步的实验里同一个种子得到了 `[82, 15, 4]` 和 `[4, 95, 36]` 两个结果。后者是自己的独立对象,有自己的状态,别处怎么动全局随机数都不影响它。造数一律用 `random.Random(42)`,并把它作为参数传给要用的函数。

</details>

4. `build()` 为什么不直接连数据库,而是返回一个装满数据的对象,另有 `write()` 去写?

<details><summary>答案</summary>

内存里的数据可以直接被测试检查,不需要数据库,14 条测试不到半秒跑完,在没起 Postgres 的机器上也能跑。写库是 IO,放在 `write()` 里单独测,只有 2 条,而且放在 `force_rollback` 事务里。纯逻辑和 IO 分开,是这个项目贯穿始终的写法。

</details>

5. 往四张表里写数据,为什么顺序必须是客户、订阅、账单、工单?写反了会得到什么?

<details><summary>答案</summary>

后三张表都有外键指向客户,账单还指向订阅,工单也指向客户。外键要求被指向的行必须已经存在,所以被指向的表先写。写反了得到 `ForeignKeyViolation`,报错里写着 `Key (customer_id)=(C0001) is not present in table "customers"`。清空时用 `TRUNCATE ... CASCADE` 可以不管顺序,但写入不行。

</details>

6. **面试题**:「你的 Agent 评测数据是怎么来的?怎么保证每次跑出来一样?」

<details><summary>答案</summary>

我把数据分成两部分:12 个手工设计的剧情客户,每人对应一个业务规则里的分支,包括刚好卡在边界上的一对(第 14 天和第 15 天);再加 188 个固定种子随机生成的客户,让数据量和分布像真的。可复现靠两样:一是业务规则里的「今天」不读系统时钟,而是配置项 `SP_TODAY`,造数和规则都读它;二是随机数用独立的 `random.Random(42)`,不碰全局生成器。价格、期限这些数字不在造数脚本里重写,而是从帮助中心的事实源导入,保证文章、账单和评测标准答案是同一份。再加一组测试守住关键数字:李娜第 7 天、徐丽第 14 天……造数脚本被谁改了,测试第一个红。我还要补一点:这是虚构数据,真实项目里这一步换成脱敏样本,但「每个分支有数据对应、可复现」的要求不变。

</details>

## 明天预告

明天是 Day 446 · 搭骨架(六):Makefile、测试、README。到今天为止,仓库里有配置、数据库、帮助中心、业务数据,却要敲一串 `uv run python scripts/...` 才能把它们拼起来。明天把这些命令收进一个 Makefile(`make data`、`make test`),把测试分成「不连库」和「连库」两层,按 pytest 标记隔离,再写一份真能照着做的 README,并且在一个全新的克隆和全新的库上验证它。
