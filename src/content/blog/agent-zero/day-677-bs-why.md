---
title: 'Day 677 · BillSleuth 开题(一):为什么选计费争议,订阅计费十分钟入门'
description: '第二个作品换一个方向:做一个能查清「为什么多扣了钱」的计费争议调查 Agent。今天先说为什么挑这个题,再补两个计费基本功:计费周期(结束日不含当天、锚点日)和按天折算,用 Python 手算一张中途升级的账单,顺手把「分母写死 30 天」这个经典 bug 在 31 天和 28 天的月份各跑一遍。'
pubDate: 2026-10-22
regime: none
tags: ['billsleuth', 'billing', 'proration', 'python', 'agent-zero']
series: 'agent-zero'
day: 677
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 676](/blog/agent-zero/day-676-loupe-showcase/) 给作品一 Agent Loupe 收了尾:README 第一屏一句话加动图,三篇 ADR(其中一篇的数据来自部署彩排),发布前自查脚本抓出了测试里的假 key 和被提交的 `.env`,最后让模型面试官给两版 30 秒讲法打了分。

Loupe 证明的是「我会做给 Agent 用的工具」。作品二要证明另一件事:我能把 Agent 放进一个出错代价很高的业务里,并且拿数据说明它靠得住。今天开题,先不写 Agent,只补业务本身。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说出为什么选计费争议做第二个作品,三条理由各举一个具体的例子。
2. 用 Python 算出任意一个计费周期有几天,讲清楚「结束日不含当天」为什么重要,以及锚点日为什么限定 1 到 28。
3. 手算并用代码验证一次周期中途的升级:退多少、收多少、记在哪张发票上。
4. 跑出「折算分母写死 30 天」在 30 天、31 天、28 天三种周期里分别差多少钱。

预计用时 2 小时。前置:[Day 12](/blog/agent-zero/day-012-numbers/)(浮点误差 `0.1 + 0.2`)、[Day 28](/blog/agent-zero/day-028-functions-1/)(函数)、[Day 22](/blog/agent-zero/day-022-tuples-unpack/)(元组和解包)、[Day 10](/blog/agent-zero/day-010-uv-1/)(uv)。今天不调模型,不花钱。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `prorate` 函数和 6 月升级那张发票的三行默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 为什么第二个作品选计费争议

先说我挑题时的三个标准,你以后换题目也可以拿来用。

**第一,招聘方一眼能看懂它值钱。** 10 月 15 日我们抓过一批能远程的 FDE(Forward Deployed Engineer,驻场交付工程师,就是把公司的 Agent 产品接进客户系统、在客户数据上跑通的工程师)和相近岗位,一共 88 条。其中 FDE 那一组 60 条:80% 用严格规则匹配到了要直接面对客户,43% 提到出差,65% 要求部署和云,SQL 和数据系统占 37%。FDE 的日常不是造框架,是把 Agent 接进客户那套乱七八糟的业务系统,让它在真实数据上不出错。计费几乎每家 SaaS 公司都有,而且都头疼,面试官不需要你解释背景。

**第二,出错的代价高,所以可靠性有意义。** 客服 Agent 答错一个功能问题,客户再问一次就好。计费 Agent 把 77.42 说成 80.00,财务对账对不上,客户会觉得你们在糊弄他。这逼着我们做几件普通演示项目不会做的事:金额不用浮点数、Agent 不许心算、每个数字都要有出处、退钱必须人批。这些恰好是面试时最能拉开差距的话题。

**第三,能严格评测。** SupportPilot 的回复好不好,很多时候要靠 LLM 评委打分,分数有噪声。计费争议不一样:根因是不是「折算分母写死 30」,多收的是不是 2.58 美元,对就是对,错就是错。后面我们会造一批带标准答案的场景,用精确匹配算准确率。这样的评测报告放在作品页上,比一段演示视频有说服力。

还有一个私心:计费是很多工程师没系统学过的手艺。做完这个项目,你对订阅、折算、发票的理解会比大多数只调过支付 SDK 的人深,这本身就是 FDE 面试的加分项。

全部数据都是虚构的,公司沿用课程里的「云簿 CloudLedger」:它卖在线记账软件,按席位(seat,就是账号数)收费。规则是照着主流订阅计费系统的通行做法简化的,哪里简化了我会写出来。

## 先建仓库

BillSleuth 是独立仓库,和 Loupe 一样。今天只建一个最小的骨架,放几个练习脚本;包结构、依赖和数据表在 [Day 680](/blog/agent-zero/day-680-bs-engine-1/) 建。

```bash
mkdir billsleuth && cd billsleuth
uv init --bare --name billsleuth --python 3.12
uv python pin 3.12
mkdir scratch
```

<div class="line-notes">

- `uv init --bare --name billsleuth --python 3.12` `--bare` 只生成一个 `pyproject.toml`,不生成示例代码和 README。相当于 `npm init -y` 只建 `package.json`。
- `uv python pin 3.12` 写一个 `.python-version` 文件,把这个项目钉在 3.12。这一行是我跑完才补的:只写 `--python 3.12` 时,`pyproject.toml` 里是 `requires-python = ">=3.12"`,uv 第一次运行用了本机最新的 CPython 3.14.8。加了 pin 以后再跑,输出变成 `Using CPython 3.12.13`。
- `mkdir scratch` 今天的手算验证脚本都放这里,它们是草稿,后面正式代码不 import 它们。

</div>

## 概念一:计费周期

### 一个周期有几天

月付客户每个月一张发票,每张发票覆盖一段时间,叫**计费周期**(billing period),用 `period_start` 和 `period_end` 两个日期表示。例子:客户 6 月 5 日开通,第一个周期是 6 月 5 日到 7 月 5 日。

这里有个约定看着不起眼,后面所有的天数都靠它:**`period_end` 不含当天**。6 月 5 日到 7 月 5 日,包含 6 月 5 日,不包含 7 月 5 日,7 月 5 日属于下一个周期。数学上叫左闭右开区间,写成 `[6/5, 7/5)`。你在 JS 里其实天天用这个约定:`arr.slice(2, 5)` 拿到的是下标 2、3、4,不含 5;`for (let i = 0; i < n; i++)` 也是不含 n。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="两个相邻的计费周期 6/5 到 7/5 和 7/5 到 8/5,结束日不含当天,7/5 只属于第二个周期">
  <rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)" rx="6"/>
  <g font-family="var(--font-mono)" font-size="11">
    <line x1="40" y1="90" x2="600" y2="90" stroke="var(--rule)"/>
    <text x="40" y="80" fill="var(--ink-soft)">6/5</text>
    <text x="305" y="80" fill="var(--ink-soft)">7/5</text>
    <text x="580" y="80" fill="var(--ink-soft)">8/5</text>
    <rect x="40" y="100" width="270" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="175" y="120" text-anchor="middle" fill="var(--mem)">6 月周期 [6/5, 7/5) 30 天</text>
    <rect x="312" y="100" width="288" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="456" y="120" text-anchor="middle" fill="var(--compute)">7 月周期 [7/5, 8/5) 31 天</text>
    <circle cx="310" cy="90" r="4" fill="var(--paper-raised)" stroke="var(--mem)"/>
    <circle cx="312" cy="90" r="3" fill="var(--compute)"/>
    <text x="40" y="160" fill="var(--ink)">空心圈:6 月周期不含 7/5;实心点:7 月周期从 7/5 开始</text>
    <text x="40" y="180" fill="var(--ink-faint)">30 + 31 = 61 = 6/5 到 8/5 的总天数,一天不多一天不少</text>
  </g>
</svg>
<figcaption>左闭右开的两个周期首尾相接,中间不重叠也不留缝。如果结束日也算进去,7/5 会同时属于两个周期,被收两次钱。</figcaption>
</figure>

Python 的 `datetime` 模块里有 `date` 类型,表示一个没有时分秒的日期。两个 `date` 相减得到一个 `timedelta`(时间差),它的 `.days` 就是天数。对照 JS:`new Date(2026, 6, 5) - new Date(2026, 5, 5)` 得到的是毫秒数,还要除以 86,400,000,而且月份从 0 开始;Python 的 `date(2026, 7, 5)` 月份就是 7,相减直接是天数,不用管时区和夏令时。

```python
# billsleuth/scratch/period_days.py  一个计费周期有几天:period_end 不含当天
from datetime import date

periods = [
    (date(2026, 6, 5), date(2026, 7, 5)),
    (date(2026, 7, 5), date(2026, 8, 5)),
    (date(2027, 2, 5), date(2027, 3, 5)),
]
for start, end in periods:
    days = (end - start).days
    print(f"{start} ~ {end}(不含 {end}):{days} 天")

# 两个相邻周期加起来,应该正好等于 6/5 到 8/5 的总天数
total = (date(2026, 8, 5) - date(2026, 6, 5)).days
half_open = 30 + 31
inclusive = (30 + 1) + (31 + 1)  # 错误做法:把结束那天也算进去
print(f"总天数 {total};不含结束日相加 {half_open};含结束日相加 {inclusive},多出 {inclusive - total} 天")
```

<div class="line-notes">

- `from datetime import date` 从标准库 `datetime` 模块里只拿 `date` 这一个类,不用 `uv add`。
- `periods = [` 一个列表,每个元素是 `(开始, 结束)` 的元组。三个周期分别是 6 月、7 月和明年 2 月,长度不一样,专门用来对比。
- `(date(2026, 6, 5), date(2026, 7, 5)),` `date(年, 月, 日)`,月份从 1 开始,和 JS 的 `new Date` 不一样。
- `for start, end in periods:` 遍历的同时把元组解包成两个变量,[Day 22](/blog/agent-zero/day-022-tuples-unpack/) 讲过,相当于 JS 的 `for (const [start, end] of periods)`。
- `days = (end - start).days` 两个日期相减得到 `timedelta`,取 `.days`。第一次循环:7/5 减 6/5 是 30。
- `print(f"{start} ~ {end}` `date` 放进 f-string 会自动格式化成 `2026-06-05` 这种 ISO 格式。
- `total = (date(2026, 8, 5) - date(2026, 6, 5)).days` 6/5 到 8/5 的总天数,用来检验两个周期拼起来对不对。实跑是 61。
- `inclusive = (30 + 1) + (31 + 1)` 模拟有人把结束日也算进周期:每个周期多一天。

</div>

```bash
uv run python scratch/period_days.py
```

```text
2026-06-05 ~ 2026-07-05(不含 2026-07-05):30 天
2026-07-05 ~ 2026-08-05(不含 2026-08-05):31 天
2027-02-05 ~ 2027-03-05(不含 2027-03-05):28 天
总天数 61;不含结束日相加 61;含结束日相加 63,多出 2 天
```

三个周期分别是 30、31、28 天,**同样叫「一个月」,长度能差 3 天**,记住这三个数,后面折算全靠它们。最后一行说明左闭右开的周期拼起来正好等于总天数;如果每个周期都含结束日,两个月就多出 2 天,也就是 7/5 和 8/5 各被算了两次。在计费里,一天被算两次就是一天的钱被收两次。

### 锚点日:每个月从几号开始

每个周期从每月几号开始,由**计费锚点日**(billing anchor day)决定。客户 6 月 5 日开通,锚点日就是 5,之后每个月 5 号出账、开始新周期。

真实系统要处理一个麻烦:客户 1 月 31 日开通,2 月没有 31 号怎么办?先看 Python 会怎么反应:

```python
# billsleuth/scratch/anchor_error.py  锚点日 31 号,到了 2 月会怎样
from datetime import date

print(date(2027, 2, 31))
```

<div class="line-notes">

- `print(date(2027, 2, 31))` 故意造一个不存在的日期。

</div>

```text
  File ".../billsleuth/scratch/anchor_error.py", line 4, in <module>
    print(date(2027, 2, 31))
          ^^^^^^^^^^^^^^^^^
ValueError: day is out of range for month
```

Python 直接报错。这其实是好事。我在 Node 里试了同样的事:`new Date(2027, 1, 31)` 不报错,悄悄变成了 3 月 3 日(实跑输出 `2027 3 3`)。如果计费系统用 JS 的 Date 自己算下个周期,1 月 31 日开通的客户 2 月那张发票会从 3 月 3 日开始,中间几天凭空消失,而且没有任何报错。

各家计费系统对这种情况有自己的规则(比如落到当月最后一天)。BillSleuth 偷个懒:**锚点日只能是 1 到 28**,每个月都有这几天。这是一个明确写下来的简化,不是没想到。有了这个限制,排出接下来几个周期就很简单:

```python
# billsleuth/scratch/anchor.py  按锚点日排出接下来几个计费周期
from datetime import date


def add_month(d: date, anchor_day: int) -> date:
    """d 的下一个月、锚点日那一天。锚点日限定 1–28,所以每个月都有这一天。"""
    y, m = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
    return date(y, m, anchor_day)


def periods(start: date, anchor_day: int, n: int) -> list[tuple[date, date]]:
    out = []
    cur = start
    for _ in range(n):
        nxt = add_month(cur, anchor_day)
        out.append((cur, nxt))
        cur = nxt
    return out


for s, e in periods(date(2026, 11, 5), anchor_day=5, n=5):
    print(f"{s} ~ {e}  {(e - s).days} 天")
```

<div class="line-notes">

- `def add_month(d: date, anchor_day: int) -> date:` 类型标注写清楚进来的是日期和整数,出去的是日期。basedpyright 会据此检查调用的地方。
- `y, m = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)` 一行条件表达式加解包:12 月的下一个月是明年 1 月,其他月份年不变、月加 1。相当于 JS 的 `const [y, m] = d.month === 12 ? [...] : [...]`。第一次调用 d 是 2026-11-05,得到 `(2026, 12)`。
- `return date(y, m, anchor_day)` 锚点日不超过 28,这里永远不会触发上面那个 `ValueError`。
- `def periods(start: date, anchor_day: int, n: int) -> list[tuple[date, date]]:` 返回值是「日期二元组的列表」,和 `period_days.py` 里手写的那个列表同一个形状。
- `for _ in range(n):` 循环 n 次,用不到循环变量时惯例写 `_`。
- `out.append((cur, nxt))` 这个周期是 `[cur, nxt)`,下一个周期从 `nxt` 开始,首尾相接。
- `cur = nxt` 往前走一个月。
- `periods(date(2026, 11, 5), anchor_day=5, n=5)` 从 11 月 5 日开始排 5 个周期,跨年,也经过 2 月。

</div>

```text
2026-11-05 ~ 2026-12-05  30 天
2026-12-05 ~ 2027-01-05  31 天
2027-01-05 ~ 2027-02-05  31 天
2027-02-05 ~ 2027-03-05  28 天
2027-03-05 ~ 2027-04-05  31 天
```

跨年那一格(12 月到 1 月)对了,2 月那格是 28 天。每个周期的长度取决于它从哪个月开始:从 11 月 5 日开始的周期是 30 天,因为它覆盖的主要是 11 月;从 1 月 5 日开始的是 31 天。

## 在算钱之前:金额不用 float

[Day 12](/blog/agent-zero/day-012-numbers/) 见过 `0.1 + 0.2` 不等于 `0.3`。算钱的时候这个问题不能靠「最后 round 一下」糊过去,一张发票十几行累加,差一分钱就对不上账。Python 标准库有 `decimal` 模块,`Decimal` 是按十进制精确表示的小数。JS 里没有内置的对应物,前端算钱一般用 `decimal.js`、`big.js` 这类库,或者全部换算成「分」用整数存,是一个道理。

今天只用到它最基本的三件事,先跑一下看清楚:

```python
# billsleuth/scratch/money_basics.py  为什么金额不用 float:Decimal 最小用法
from decimal import ROUND_HALF_UP, Decimal

print("float  :", 0.1 + 0.2)
print("Decimal:", Decimal("0.1") + Decimal("0.2"))
print("从 float 造 Decimal:", Decimal(0.1))

CENT = Decimal("0.01")
x = Decimal("58.505")
print("quantize 四舍五入:", x.quantize(CENT, rounding=ROUND_HALF_UP))
print("Python round()   :", round(2.675, 2), round(Decimal("2.665"), 2))
```

<div class="line-notes">

- `from decimal import ROUND_HALF_UP, Decimal` `ROUND_HALF_UP` 是「四舍五入」这种舍入方式的名字,`Decimal` 是类型本身。都在标准库里。
- `print("float  :", 0.1 + 0.2)` 对照组,浮点数。
- `Decimal("0.1") + Decimal("0.2")` 用**字符串**造 Decimal,结果精确等于 0.3。
- `Decimal(0.1)` 用**浮点数**造 Decimal,这是最常见的坑:0.1 在变成 Decimal 之前已经是一个不精确的浮点数了,Decimal 只是把那个不精确的值原样展开给你看。
- `CENT = Decimal("0.01")` 「精确到分」的模板,`quantize` 按它的小数位数来舍入。
- `x.quantize(CENT, rounding=ROUND_HALF_UP)` 把 58.505 舍入到两位小数,逢五进一,得到 58.51。
- `round(2.675, 2), round(Decimal("2.665"), 2)` 对照 Python 内置的 `round`:对浮点数,2.675 实际存的是 2.67499…,所以得到 2.67;对 Decimal,`round` 默认用「银行家舍入」(逢五取偶),2.665 得到 2.66。两种都不是我们要的四舍五入。

</div>

```text
float  : 0.30000000000000004
Decimal: 0.3
从 float 造 Decimal: 0.1000000000000000055511151231257827021181583404541015625
quantize 四舍五入: 58.51
Python round()   : 2.67 2.66
```

记三条就够了:Decimal 一律从字符串造;舍入一律用 `quantize(CENT, rounding=ROUND_HALF_UP)`;别用 `round()`。为什么这样定、整个项目的金额规则怎么收进一个函数,Day 680 专门讲,今天先照着用。

## 概念二:按天折算

### 中途升级,钱怎么算

客户在周期中间改了套餐或席位数,这个月的钱怎么算?最常见的做法叫**按天折算**(proration):旧配置没用完的天数退给客户,新配置剩下的天数向客户收钱。

拿具体数字手算一遍。云簿的团队版每席位每月 39 美元,客户买了 3 个席位,一个月 117 美元。当前周期 6 月 5 日到 7 月 5 日,30 天。6 月 20 日他升级到商业版,每席位 89 美元,3 个席位一个月 267 美元。从 6 月 20 日到 7 月 5 日还剩 15 天(左闭右开,6/20 当天算新套餐):

- 退还旧套餐未用部分:117 × 15 / 30 = 58.50 美元
- 收取新套餐剩余部分:267 × 15 / 30 = 133.50 美元

这两行记在哪?6 月那张发票在 6 月 5 日就开出去了,不能改。所以它们记到**下一张**发票上,也就是 7 月 5 日出的那张。7 月那张于是有三行:-58.50、+133.50,再加上 7 月整月的商业版 267.00。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="6 月周期中途升级:旧套餐退还 15 天,新套餐收取 15 天,两行折算记在 7 月发票上,加上 7 月整月共 342.00">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="20" y="28" font-size="13" fill="var(--ink)">6 月周期 [6/5, 7/5) 30 天,6/20 升级</text>
    <line x1="40" y1="70" x2="600" y2="70" stroke="var(--rule)"/>
    <text x="40" y="60" fill="var(--ink-soft)">6/5</text>
    <text x="310" y="60" fill="var(--ink-soft)">6/20</text>
    <text x="580" y="60" fill="var(--ink-soft)">7/5</text>
    <rect x="40" y="80" width="280" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="180" y="100" text-anchor="middle" fill="var(--mem)">团队版 117/月 已用 15 天</text>
    <rect x="320" y="80" width="280" height="30" fill="none" stroke="var(--mem)" stroke-dasharray="4 3"/>
    <text x="460" y="100" text-anchor="middle" fill="var(--mem)">未用 15 天 → 退 58.50</text>
    <rect x="320" y="118" width="280" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="460" y="138" text-anchor="middle" fill="var(--compute)">商业版 267/月 剩 15 天 → 收 133.50</text>
    <text x="20" y="185" font-size="12" fill="var(--ink)">7 月 5 日的发票:</text>
    <text x="40" y="207" fill="var(--ink-soft)">折算 -58.50 | 折算 +133.50 | 7 月商业版 267.00 | 小计 342.00</text>
    <text x="40" y="232" fill="var(--ink-faint)">平时 117.00,这张一下子 342.00,客户第一反应常常是「多扣了」</text>
  </g>
</svg>
<figcaption>中途升级的钱记在下一张发票上。图里的数字和下面 prorate.py 的实跑输出一致。</figcaption>
</figure>

写成代码:

```python
# billsleuth/scratch/prorate.py  周期中途升级:退旧收新,按剩余天数折算
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")


def prorate(full: Decimal, days_left: int, period_days: int) -> Decimal:
    return (full * days_left / period_days).quantize(CENT, rounding=ROUND_HALF_UP)


period_start, period_end = date(2026, 6, 5), date(2026, 7, 5)
change = date(2026, 6, 20)
old_full = Decimal("39.00") * 3  # 团队版 39/席/月,3 席
new_full = Decimal("89.00") * 3  # 商业版 89/席/月,3 席

period_days = (period_end - period_start).days
days_left = (period_end - change).days
credit = -prorate(old_full, days_left, period_days)
charge = prorate(new_full, days_left, period_days)
print(f"周期 {period_days} 天,{change} 升级,剩 {days_left} 天")
print(f"退旧套餐未用部分 {credit},收新套餐剩余部分 {charge}")

lines = [("折算:退团队版 6/20–7/5", credit), ("折算:收商业版 6/20–7/5", charge), ("商业版 7/5–8/5", new_full)]
for desc, amt in lines:
    print(f"  {desc:<22} {amt:>8}")
print(f"  {'7 月发票小计':<22} {sum(a for _, a in lines):>8}")
```

<div class="line-notes">

- `def prorate(full: Decimal, days_left: int, period_days: int) -> Decimal:` 整个项目的核心公式:整月金额 × 剩余天数 / 周期天数,舍入到分。三个参数都显式传,不在函数里自己猜周期多长。
- `(full * days_left / period_days)` Decimal 乘除整数结果还是 Decimal。这里先乘后除:267 × 15 = 4005,再除以 30 得 133.5。后面的 `.quantize(CENT, rounding=ROUND_HALF_UP)` 把每一行折算单独舍入到分,发票上每一行都是两位小数。
- `period_start, period_end = date(2026, 6, 5), date(2026, 7, 5)` 多重赋值,左右两边各两个值。
- `old_full = Decimal("39.00") * 3` 单价乘席位数,117.00。席位数是整数,Decimal 乘整数没问题。
- `days_left = (period_end - change).days` 7/5 减 6/20 = 15。6/20 当天算新套餐,所以不用加减 1,这就是左闭右开的好处。
- `credit = -prorate(old_full, days_left, period_days)` 退款记成负数,-58.50。发票上负数行就是「抵扣」。
- `charge = prorate(new_full, days_left, period_days)` 133.50。
- `lines = [("折算:退团队版 6/20–7/5", credit)` 7 月发票的三行,每行一个 `(说明, 金额)` 元组。
- `print(f"  {desc:<22} {amt:>8}")` `:<22` 左对齐占 22 格,`:>8` 右对齐占 8 格,相当于 JS 的 `padEnd` 和 `padStart`。中文字符占两个显示宽度但只算一格,所以终端里看着有点歪,不影响数值。
- `sum(a for _, a in lines)` 生成器表达式,只取每行的金额求和。三行加起来 342.00。

</div>

```bash
uv run python scratch/prorate.py
```

```text
周期 30 天,2026-06-20 升级,剩 15 天
退旧套餐未用部分 -58.50,收新套餐剩余部分 133.50
  折算:退团队版 6/20–7/5         -58.50
  折算:收商业版 6/20–7/5         133.50
  商业版 7/5–8/5              267.00
  7 月发票小计                  342.00
```

和手算一致。客户平时每月 117,这个月突然 342,第一反应常常是「多扣了」。其实账是对的:多出来的 225 = 两行折算的净额 75 + 新旧套餐整月差价 150。这类「账没错、客户看不懂」的情况在计费客服里非常多,后面造评测集时会专门放一批,Agent 遇到这种情况应该解释清楚,而不是起草退款。

真实系统比这复杂一些。2026 年 10 月我查 [Stripe 的折算文档](https://docs.stripe.com/billing/subscriptions/prorations),它默认是**按秒**折算的,可以自定义成按天、小时、周或月;默认的 `proration_behavior=create_prorations` 会生成折算行,但不立刻收钱,等下一张发票一起收,要立刻开票得用 `always_invoice`。BillSleuth 简化成按天、记到下一张发票,这和 Stripe 默认的「记到下一张」是一个思路,只是粒度粗一些。

### 分母写死 30:一个经典 bug

折算公式里的分母是「这个周期有几天」。图省事的人会写死 30:「一个月嘛,按 30 天算。」6 月周期正好 30 天看不出问题。换成 7 月和 2 月试试:

```python
# billsleuth/scratch/denominator_bug.py  折算分母写死 30 天,不同长度的月份会差多少
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")
OLD, NEW = Decimal("117.00"), Decimal("267.00")  # 团队版 3 席 / 商业版 3 席


def prorate(full: Decimal, days_left: int, period_days: int) -> Decimal:
    return (full * days_left / period_days).quantize(CENT, rounding=ROUND_HALF_UP)


def net(days_left: int, period_days: int) -> Decimal:
    return prorate(NEW, days_left, period_days) - prorate(OLD, days_left, period_days)


cases = [
    (date(2026, 6, 5), date(2026, 7, 5), date(2026, 6, 20)),
    (date(2026, 7, 5), date(2026, 8, 5), date(2026, 7, 20)),
    (date(2027, 2, 5), date(2027, 3, 5), date(2027, 2, 20)),
]
for start, end, change in cases:
    days, left = (end - start).days, (end - change).days
    right, wrong = net(left, days), net(left, 30)
    print(f"{start}~{end} 共 {days} 天,剩 {left} 天:应收净额 {right},写死 30 时 {wrong},差 {wrong - right:+}")
```

<div class="line-notes">

- `OLD, NEW = Decimal("117.00"), Decimal("267.00")` 和上一个脚本同一个客户:团队版 3 席、商业版 3 席的整月价。
- `def net(days_left: int, period_days: int) -> Decimal:` 折算净额 = 收新 - 退旧。把两行合成一个数,方便比较对错两种算法。
- `cases = [` 三个场景都是「每月 20 号升级」,只是落在不同长度的周期里。
- `days, left = (end - start).days, (end - change).days` 周期天数和剩余天数。第二个场景:7/5 到 8/5 是 31 天,7/20 到 8/5 剩 16 天。
- `right, wrong = net(left, days), net(left, 30)` 正确的用实际天数做分母,错误的写死 30。
- `{wrong - right:+}` 格式说明 `+` 让正数也带上加号,一眼看出是多收还是少收。

</div>

```text
2026-06-05~2026-07-05 共 30 天,剩 15 天:应收净额 75.00,写死 30 时 75.00,差 +0.00
2026-07-05~2026-08-05 共 31 天,剩 16 天:应收净额 77.42,写死 30 时 80.00,差 +2.58
2027-02-05~2027-03-05 共 28 天,剩 13 天:应收净额 69.64,写死 30 时 65.00,差 -4.64
```

自己先手算第二行再对答案:267 × 16 / 31 = 137.806…,舍入到 137.81;117 × 16 / 31 = 60.387…,舍入到 60.39;净额 137.81 − 60.39 = 77.42。分母写死 30 时是 142.40 − 62.40 = 80.00,多收 2.58。

第三行更有意思:2 月只有 28 天,分母写死 30 反而**少收**了 4.64。所以这个 bug 不是「永远多收」,它在 31 天的月份多收、28 天的月份少收、30 天的月份完全看不出来。如果你的测试数据恰好都在 6 月、9 月这种 30 天的月份,测试永远是绿的。这就是为什么后面造故障场景时,同一类故障要放在不同长度的周期里。

还要注意一点:这个 bug 每次只差几美元,单看一张发票,客户和客服都可能觉得是自己算错了。这正是 Agent 能帮上忙的地方:它可以不嫌烦地把每一行都复算一遍。

## 今天的文件

| 零件 | 文件 | 后面哪天用到 |
| --- | --- | --- |
| 周期天数、左闭右开 | `scratch/period_days.py` | Day 680 的表结构里 `period_end` 的含义 |
| 锚点日排周期 | `scratch/anchor.py` | Day 681 参考引擎排周期 |
| Decimal 三条规矩 | `scratch/money_basics.py` | Day 680「金额只走一个函数」 |
| 折算公式 | `scratch/prorate.py` 里的 `prorate` | Day 681 参考引擎 |
| 分母 bug | `scratch/denominator_bug.py` | Day 682 故障注入 |

这些都是草稿,Day 680 起会把规则写成正式的 `money.py` 和 `engine.py`,并用单元测试钉死。今天所有脚本都不调模型,花费 0 元。

## 动手练习

**练习 1:手算再验证。** 同一个客户,周期 7 月 5 日到 8 月 5 日,7 月 20 日从团队版 3 席升级到商业版 3 席。这次升级记在哪张发票上?那张发票有哪三行,小计多少?先手算,再写脚本验证。

<details><summary>参考答案</summary>

手算:周期 31 天,7/20 到 8/5 剩 16 天。退团队版 117 × 16 / 31 = 60.387…,舍入 60.39;收商业版 267 × 16 / 31 = 137.806…,舍入 137.81。记在 8 月 5 日出的发票上,再加 8 月整月的商业版 267.00,小计 −60.39 + 137.81 + 267.00 = 344.42。

```python
# billsleuth/scratch/ex1_july_upgrade.py  练习 1:7/20 升级,8/5 那张发票的三行
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")


def prorate(full: Decimal, days_left: int, period_days: int) -> Decimal:
    return (full * days_left / period_days).quantize(CENT, rounding=ROUND_HALF_UP)


start, end, change = date(2026, 7, 5), date(2026, 8, 5), date(2026, 7, 20)
period_days, days_left = (end - start).days, (end - change).days
lines = [
    ("退团队版 7/20–8/5", -prorate(Decimal("117.00"), days_left, period_days)),
    ("收商业版 7/20–8/5", prorate(Decimal("267.00"), days_left, period_days)),
    ("商业版 8/5–9/5", Decimal("267.00")),
]
for desc, amt in lines:
    print(desc, amt)
print("小计", sum(a for _, a in lines))
```

<div class="line-notes">

- `start, end, change = date(2026, 7, 5), date(2026, 8, 5), date(2026, 7, 20)` 三个日期一行赋值。
- `period_days, days_left = (end - start).days, (end - change).days` 实跑是 31 和 16。
- `-prorate(Decimal("117.00"), days_left, period_days)` 退款行取负,−60.39。
- `("商业版 8/5–9/5", Decimal("267.00"))` 下一个整月,不折算。
- `sum(a for _, a in lines)` 三行求和。

</div>

```text
退团队版 7/20–8/5 -60.39
收商业版 7/20–8/5 137.81
商业版 8/5–9/5 267.00
小计 344.42
```

和手算一致。和 6 月那次比,同样是 20 号升级,这次贵了 2.42,因为 7 月周期长一天、剩余天数也多一天。

</details>

**练习 2:观察会发生什么。** 客户在上海,北京时间 6 月 20 日凌晨 0 点 30 分点了升级。系统要是按 UTC 取「升级日期」,折算会变成多少?用 `zoneinfo` 跑一下。

<details><summary>参考答案</summary>

`zoneinfo` 是 Python 3.9 起标准库里的时区模块,`ZoneInfo("Asia/Shanghai")` 相当于 JS 里 `Intl.DateTimeFormat` 用的那个 `timeZone: 'Asia/Shanghai'`。

```python
# billsleuth/scratch/ex2_timezone.py  练习 2:上海客户 6/20 凌晨 0:30 升级,按 UTC 取日期会怎样
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

CENT = Decimal("0.01")


def prorate(full: Decimal, days_left: int, period_days: int) -> Decimal:
    return (full * days_left / period_days).quantize(CENT, rounding=ROUND_HALF_UP)


clicked = datetime(2026, 6, 20, 0, 30, tzinfo=ZoneInfo("Asia/Shanghai"))
as_utc = clicked.astimezone(ZoneInfo("UTC"))
print("客户点击时间:", clicked.isoformat(), " 换成 UTC:", as_utc.isoformat())

period_start, period_end = date(2026, 6, 5), date(2026, 7, 5)
days = (period_end - period_start).days
for label, d in [("按客户本地日期", clicked.date()), ("按 UTC 日期", as_utc.date())]:
    left = (period_end - d).days
    net = prorate(Decimal("267.00"), left, days) - prorate(Decimal("117.00"), left, days)
    print(f"{label} {d}:剩 {left} 天,折算净额 {net}")
```

<div class="line-notes">

- `datetime(2026, 6, 20, 0, 30, tzinfo=ZoneInfo("Asia/Shanghai"))` 带时区的时间点:上海时间 6 月 20 日 0:30。
- `as_utc = clicked.astimezone(ZoneInfo("UTC"))` 同一个时刻换成 UTC 表示。上海是 UTC+8,所以是 6 月 19 日 16:30。
- `clicked.date()` 从带时区的时间里取日期,取的是它自己时区下的日期。同一个时刻,`clicked.date()` 是 6/20,`as_utc.date()` 是 6/19。
- `left = (period_end - d).days` 按两个不同的日期各算一次剩余天数。

</div>

```text
客户点击时间: 2026-06-20T00:30:00+08:00  换成 UTC: 2026-06-19T16:30:00+00:00
按客户本地日期 2026-06-20:剩 15 天,折算净额 75.00
按 UTC 日期 2026-06-19:剩 16 天,折算净额 80.00
```

同一次点击,按 UTC 取日期多算了一天新套餐,净额从 75.00 变成 80.00,多收 5.00。这个 bug 只在中国客户凌晨 0 点到 8 点之间操作时出现,白天测永远发现不了。BillSleuth 的规则是:**日期按客户所在地的本地日期算**。后面造故障时它是一类单独的根因。

</details>

**练习 3:加席位。** 客户还是团队版,7 月 30 日从 3 席加到 5 席(周期 7/5 到 8/5)。按「退 3 席、收 5 席」算净额,和「只按新增的 2 席折算」比,结果一样吗?

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex3_seats.py  练习 3:团队版 7/30 从 3 席加到 5 席
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")
SEAT = Decimal("39.00")


def prorate(full: Decimal, days_left: int, period_days: int) -> Decimal:
    return (full * days_left / period_days).quantize(CENT, rounding=ROUND_HALF_UP)


start, end, change = date(2026, 7, 5), date(2026, 8, 5), date(2026, 7, 30)
period_days, days_left = (end - start).days, (end - change).days
credit = -prorate(SEAT * 3, days_left, period_days)
charge = prorate(SEAT * 5, days_left, period_days)
print(f"退 3 席 {credit},收 5 席 {charge},净额 {credit + charge}")
print(f"只按新增的 2 席算:{prorate(SEAT * 2, days_left, period_days)}")
```

<div class="line-notes">

- `SEAT = Decimal("39.00")` 团队版每席位每月 39。
- `period_days, days_left` 周期 31 天,7/30 到 8/5 剩 6 天。
- `credit = -prorate(SEAT * 3, days_left, period_days)` 117 × 6 / 31 = 22.645…,舍入 22.65,取负。
- `charge = prorate(SEAT * 5, days_left, period_days)` 195 × 6 / 31 = 37.741…,舍入 37.74。
- `prorate(SEAT * 2, days_left, period_days)` 78 × 6 / 31 = 15.096…,舍入 15.10。

</div>

```text
退 3 席 -22.65,收 5 席 37.74,净额 15.09
只按新增的 2 席算:15.10
```

差一分钱。两种算法数学上等价,但每一行单独舍入以后,先舍入再相减和先相减再舍入结果不同。哪种对?没有绝对的对错,**规则要定死并且写进测试**。BillSleuth 选「退旧收新两行」,因为发票上每一行都能对应到一个具体配置,客户和 Agent 都好核对。这也提醒我们:Agent 复算时如果用了和系统不同的算法,一分钱的差异不能算成「多收」,Day 681 的参考引擎会把这条规则钉死。

</details>

**练习 4(开放题):把 7 月那张发票翻译成客户看得懂的话。** 客户来信:「我每个月 117,这个月怎么扣了 342?」用正文 `prorate.py` 的三行,写一段回复。要求回复里的每个数字都来自发票行,或者是发票行之间的加减,不许凭感觉写数字。

<details><summary>参考答案</summary>

先看一个不好的示范,我第一次随手写的:「您好,这是因为您升级了套餐,按天折算产生了一些费用,金额是正确的。」它没有一个数字,客户没法核对,只能再来问一次。

改成用代码从发票行生成,保证每个数字都出自发票:

```python
# billsleuth/scratch/ex4_explain.py  练习 4:把 7 月发票的三行翻译成客户看得懂的话
from decimal import Decimal

lines = [
    ("credit", "团队版 3 席", "6 月 20 日–7 月 5 日", Decimal("-58.50")),
    ("charge", "商业版 3 席", "6 月 20 日–7 月 5 日", Decimal("133.50")),
    ("recurring", "商业版 3 席", "7 月 5 日–8 月 5 日", Decimal("267.00")),
]
usual = Decimal("117.00")
total = sum(a for *_, a in lines)
parts = []
for kind, plan, span, amt in lines:
    if kind == "credit":
        parts.append(f"{plan}在 {span} 没用完的部分退回 {-amt} 美元")
    elif kind == "charge":
        parts.append(f"{plan}在 {span} 这段补收 {amt} 美元")
    else:
        parts.append(f"{plan} {span} 的整月费用 {amt} 美元")
print(f"这张发票 {total} 美元,比您平时的 {usual} 美元多 {total - usual} 美元。原因是 6 月 20 日升级到了商业版:"
      + ";".join(parts) + "。从 8 月起每月是 267.00 美元,不会再有折算行。")
```

<div class="line-notes">

- `("credit", "团队版 3 席", "6 月 20 日–7 月 5 日", Decimal("-58.50")),` 每行多了一个类型字段 `credit / charge / recurring`,生成文字时按类型选句式。这和 Day 680 发票行表里的 `kind` 字段是一个意思。
- `total = sum(a for *_, a in lines)` `*_` 把前面三个字段都吞掉,只取最后的金额。JS 的解构不支持把剩余元素放在前面,对应的写法是 `line.at(-1)`。
- `parts.append(f"{plan}在 {span} 没用完的部分退回 {-amt} 美元")` 退款行在发票上是负数,对客户说「退回 58.50」时取正。
- `";".join(parts)` 三句用分号连起来,相当于 JS 的 `parts.join(';')`。

</div>

```text
这张发票 342.00 美元,比您平时的 117.00 美元多 225.00 美元。原因是 6 月 20 日升级到了商业版:团队版 3 席在 6 月 20 日–7 月 5 日 没用完的部分退回 58.50 美元;商业版 3 席在 6 月 20 日–7 月 5 日 这段补收 133.50 美元;商业版 3 席 7 月 5 日–8 月 5 日 的整月费用 267.00 美元。从 8 月起每月是 267.00 美元,不会再有折算行。
```

前后对比:第一版零个数字,第二版每个数字(342.00、117.00、225.00、58.50、133.50、267.00)都来自发票行或者是它们的加减。225.00 是代码算出来的,不是谁心算的。这就是 BillSleuth 后面「每个数字都要能追溯到证据」的雏形:让模型写措辞,数字交给代码。

</details>

**验收标准:** 能不看文章说出 6 月、7 月、明年 2 月三个周期各几天,以及为什么 `period_end` 不含当天;`prorate.py` 跑出 −58.50、133.50、小计 342.00;能讲清楚分母写死 30 为什么在 7 月多收 2.58、在 2 月少收 4.64;练习 2 能解释为什么那个时区 bug 白天测不出来。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| FDE(Forward Deployed Engineer) | 驻场交付工程师,把公司的产品(现在常常是 Agent 平台)接进客户系统,在客户数据上跑通,大部分时间面对客户 |
| 计费周期(billing period) | 一张发票覆盖的时间段,`period_start` 含当天,`period_end` 不含 |
| 左闭右开 | 区间包含起点不包含终点,写作 `[a, b)`,和 JS 的 `slice(a, b)` 一样 |
| 计费锚点日(billing anchor day) | 每个周期从每月几号开始,BillSleuth 限定 1–28 |
| `timedelta` | Python 里两个日期或时间相减得到的时间差,`.days` 是天数 |
| `Decimal` | 按十进制精确表示的小数,算钱用它,从字符串构造 |
| `quantize` | Decimal 的舍入方法,`quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)` 是四舍五入到分 |
| 银行家舍入 | 逢五取偶的舍入方式,Python 的 `round()` 对 Decimal 默认用它,2.665 得到 2.66 |
| 按天折算(proration) | 周期中途改配置时,按剩余天数退旧收新 |
| 折算行 | 发票上因为折算产生的行,一般记在下一张发票上 |

## 常见误区

**以为 `period_end` 是周期的最后一天。** 它是下一个周期的第一天,不属于这个周期。把它算进来,相邻周期在这一天重叠,两个月多算 2 天。

**以为一个月就是 30 天。** 同样叫一个月的周期,实跑出来有 28、30、31 天。折算分母写死 30,7 月多收 2.58,2 月少收 4.64,6 月看不出来,所以测试要覆盖不同长度的周期。

**用 JS 的 Date 自己推下个月。** `new Date(2027, 1, 31)` 不报错,悄悄变成 3 月 3 日。Python 的 `date(2027, 2, 31)` 直接 `ValueError`。锚点日限定 1 到 28 就是为了不碰这个问题。

**`Decimal(0.1)`。** 从浮点数构造,不精确在构造之前就发生了,得到的是 0.1000000000000000055511151231257827021181583404541015625。一律从字符串构造。

**用 `round()` 舍入金额。** 对浮点数它受二进制表示影响(2.675 得 2.67),对 Decimal 它默认逢五取偶(2.665 得 2.66)。用 `quantize` 并写明 `ROUND_HALF_UP`。

**升级当天把剩余天数加一或减一。** 左闭右开的约定下,升级当天就算新套餐,剩余天数直接 `period_end - change`,不用调整。

**按 UTC 取客户的操作日期。** 上海客户凌晨 0:30 的操作,UTC 还是前一天,剩余天数多一天,多收 5.00。日期按客户本地算。

**把「先舍入再相减」和「先相减再舍入」当成一回事。** 加席位的例子差一分钱。规则定死、写进测试,复算时用同一套规则。

## 学习资料

### 文档与文章

- [Stripe · Subscriptions 概览](https://docs.stripe.com/billing/subscriptions/overview):订阅、周期、发票之间的关系,20 分钟扫一遍,建立整体概念。
- [Stripe · Prorations](https://docs.stripe.com/billing/subscriptions/prorations):折算的官方说明。重点看三处:默认按秒折算、`proration_behavior` 的三个取值、折算行默认不立刻收钱,15 分钟。
- [Stripe · Billing cycle](https://docs.stripe.com/billing/subscriptions/billing-cycle):计费锚点和周期重置,10 分钟。
- [Python 文档 · datetime](https://docs.python.org/zh-cn/3.12/library/datetime.html):看 `date` 和 `timedelta` 两节就够,中文,15 分钟。
- [Python 文档 · decimal](https://docs.python.org/zh-cn/3.12/library/decimal.html):看「快速入门教程」和舍入模式列表,中文,20 分钟。
- [Python 文档 · zoneinfo](https://docs.python.org/zh-cn/3.12/library/zoneinfo.html):练习 2 用到的时区模块,10 分钟。
- [a16z · Trading Margin for Moat: Why the Forward Deployed Engineer Is the Hottest Job in Startups](https://a16z.com/services-led-growth/):从投资人角度讲为什么 AI 公司都在招 FDE,读完更清楚作品二要证明什么,15 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1QH4y1m7re&autoplay=0&high_quality=1" title="什么是SaaS?四分钟带你了解SaaS的前世今生!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>云计算科普研究所 · 什么是SaaS?四分钟带你了解SaaS的前世今生! · 4 分钟,没接触过 SaaS 的先看这个,知道订阅制为什么需要一套计费系统。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ZY411f73U&autoplay=0&high_quality=1" title="彻底讲透SaaS部署模式、付费模式!产品经理必知的100个问题系列" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>黑马产品经理 · 彻底讲透SaaS部署模式、付费模式!产品经理必知的100个问题系列 · 34 分钟,从产品角度讲按席位、按用量、按功能分层的付费模式,看付费模式那一半就够。</figcaption>
</figure>

- David鲍曼《SaaS订阅服务:Paddle Billing配置完整指南》(BV1JGyDBpEt3,4 分钟):在一个真实的计费平台后台里配订阅产品,看看计费周期、价格这些概念在界面上长什么样。
- 人生海海聊AI《01-FDE 前线部署工程师》(BV1EJpc6ZEoi,51 分钟):中文里少见的专门讲 FDE 岗位的视频,播放量不高,当作补充。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/9aSxdGgkVgE" title="Why Did My Customer Pay $7.50? Stripe Proration Explained | Stripe Made Simple Ep 8" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Anthony Usoro · Why Did My Customer Pay $7.50? Stripe Proration Explained | Stripe Made Simple Ep 8 · 标题就是今天的问题:客户为什么付了一个奇怪的金额。看他怎么一步步把折算拆开。</figcaption>
</figure>

- Stripe Developers《Stripe Billing 101: APIs, Features, and Revenue Optimization》(YouTube `UaW7Tbmgon4`):Stripe 官方讲订阅计费的整体结构,想知道真实系统还有哪些概念时看。
- ZAUEY (Claire Zau)《The Rise of the Forward Deployed Engineer》(YouTube `EL2YIn5cLig`):FDE 这个岗位从 Palantir 到 AI 公司的演变。

### 书籍

- Tien Tzuo、Gabe Weisert《Subscribed》(Portfolio, 2018;中信出版社有中译本《订阅经济》):Zuora 创始人写的订阅商业模式。看第一部分,知道订阅公司在乎哪些指标,理解计费错误为什么伤客户关系。
- Martin Fowler《Patterns of Enterprise Application Architecture》(Addison-Wesley, 2002):第 18 章 Base Patterns 里的 Money 一节,讲金额为什么要做成值对象、分摊时除不尽的分怎么处理,和练习 3 那一分钱是同一个问题。Day 680 前读。

### 开源项目与代码

- [getlago/lago](https://github.com/getlago/lago):开源的订阅和用量计费系统,看它的数据模型里 subscriptions、invoices、credit_notes 怎么组织,和我们后面的表对照。
- [killbill/killbill](https://github.com/killbill/killbill):老牌开源计费平台,文档里对订阅变更和折算规则写得很细,遇到边界情况可以查。

## 自测

1. 6 月 5 日到 7 月 5 日这个周期有多少天?为什么说 `period_end` 不含当天很重要?

<details><summary>答案</summary>

30 天。如果把 `period_end` 当成包含当天,天数多算 1,折算的分母分子都会错,而且相邻两个周期会在 7 月 5 日重叠,同一天被收两次钱。实跑:6/5 到 8/5 两个周期,不含结束日相加 61 天等于总天数,含结束日相加 63 天。

</details>

2. 为什么 BillSleuth 把锚点日限定在 1 到 28?不限定会遇到什么?

<details><summary>答案</summary>

因为 1 到 28 每个月都有。锚点日是 29、30、31 时,2 月(以及 30 天的月份)没有这一天:Python 的 `date(2027, 2, 31)` 报 `ValueError: day is out of range for month`,JS 的 `new Date(2027, 1, 31)` 悄悄变成 3 月 3 日。真实系统要另定规则(比如落到月末),我们为了简单直接限定,这是写明的简化。

</details>

3. 周期 6/5 到 7/5,6/20 从团队版 3 席(117/月)升级到商业版 3 席(267/月)。会产生哪两行折算?记在哪张发票上?

<details><summary>答案</summary>

剩 15 天:退团队版 117 × 15 / 30 = −58.50,收商业版 267 × 15 / 30 = +133.50。6 月那张发票已经开出,不能改,两行记在 7 月 5 日的发票上,再加 7 月整月 267.00,小计 342.00。

</details>

4. 折算分母写死 30,为什么测试可能一直是绿的?

<details><summary>答案</summary>

30 天的周期里写死 30 和实际天数结果完全一样(实跑 6 月差 0.00)。只有 31 天的周期会多收(7 月多 2.58)、28 天的周期会少收(2 月少 4.64)。测试数据恰好都落在 30 天的月份,就永远发现不了。所以同一类故障要放在不同长度的周期里测。

</details>

5. `Decimal(0.1)` 和 `Decimal("0.1")` 有什么区别?金额舍入为什么不用 `round()`?

<details><summary>答案</summary>

`Decimal(0.1)` 先有一个不精确的浮点数 0.1,再把它原样转成 Decimal,得到 0.1000000000000000055511151231257827021181583404541015625;`Decimal("0.1")` 精确等于 0.1。`round()` 对浮点数受二进制表示影响(`round(2.675, 2)` 得 2.67),对 Decimal 默认逢五取偶(`round(Decimal("2.665"), 2)` 得 2.66),都不是四舍五入。用 `quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)`。

</details>

6. 面试题:面试官问「你为什么选计费争议做 Agent 作品,而不是再做一个 RAG 问答?」你怎么回答?

<details><summary>答案</summary>

讲三点,每点带一个具体例子。招聘方看得懂价值:我们抓的 60 条远程 FDE 岗位里 80% 要直接面对客户,计费是几乎每家 SaaS 都有、都头疼的系统,不用解释背景。出错代价高所以可靠性有意义:分母写死 30 这种 bug,7 月每次只多收 2.58,客户和客服都容易忽略,但积少成多、伤信任;这逼着系统做到金额不用浮点、每个数字有出处、退钱人批。能严格评测:根因和差额都有唯一的对错,可以用精确匹配算准确率,而不是靠 LLM 评委打分。最后补一句和 RAG 的区别:RAG 问答主要考检索和措辞,计费调查考的是多步取证和复算,更能体现 Agent 工程里「什么交给模型、什么必须交给代码」的判断。

</details>

## 明天预告

明天是 Day 678 · 第 97 周复习:作品(Day 672–677)。这一周跨了两个作品:Loupe 的评测用例、部署、发布包装,和 BillSleuth 的开题。复习日把这六天画成一张知识地图,整理这周的错题和坑(uvicorn 偷读代理头、被忽略的 `_redirects` 规则、`\s` 匹配换行、分母写死 30),再默写一段核心代码。今天的 `prorate` 是默写候选之一。
