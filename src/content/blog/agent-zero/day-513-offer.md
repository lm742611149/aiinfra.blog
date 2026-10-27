---
title: 'Day 513 · 求职(三):面试流程、谈薪、避坑和投递节奏'
description: '投出去以后的四件事。国内外 Agent 岗的面试一般怎么走、每轮考什么;拿到 offer 以后,用一个小脚本把月薪、几薪、公积金、期权、试用期拆成现金、账户里的钱和可能变钱的钱,算出两个 offer 到底差多少;用正则规则筛掉培训贷、先交钱、假远程这类坑,并看清规则会在哪里误伤;最后用一份投递记录算漏斗,看卡在哪一步就回去补哪一天。'
pubDate: 2026-10-27
regime: none
tags: ['job-search', 'salary', 'negotiation', 'dataclass', 'agent-zero']
series: 'agent-zero'
day: 513
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 512](/blog/agent-zero/day-512-remote-fde/) 用两次调研和一次自己动手调招聘接口的结果,把海外远程的预期调了下来:46 条远程岗里写明全球可做的只有 3 条,实拉的 104 个远程 FDE 岗里,没有把中国排除在外的只有 1 个。后半讲了 FDE 是什么、适合什么样的人。

渠道和行情到这里讲完了([Day 511](/blog/agent-zero/day-511-job-channels/) 讲国内渠道和薪资口径)。今天讲投出去以后的事:面试一般几轮,拿到 offer 怎么谈、怎么比,怎么躲开坑,每周怎么投、怎么用数据判断自己卡在哪。

## 今天要解决的问题

今天结束时你应该能:

1. 说出国内和海外 Agent 岗常见的面试流程,知道每一轮在考什么、对应你前面哪几天的准备,能在 HR 初筛时问出「一共几轮、每轮考什么」。
2. 用 `Offer` 和 `breakdown` 把一个 offer 拆成「现金、公积金、期权期望」三类钱,比较两个 offer 的第一年总包;知道试用期工资不得低于约定工资的 80% 这条底线。
3. 写一组正则规则筛掉培训贷、先交钱、钱的路子不对这类坑,并说出这类规则会在哪里误伤好岗位。
4. 用一份投递记录算出每一步的转化率,按漏斗哪一层掉得最多决定回去补哪一天;知道样本太少时不该下结论。

预计用时 3 小时。前置:[Day 511](/blog/agent-zero/day-511-job-channels/) 的口径(挂牌价不是成交价);[Day 50](/blog/agent-zero/day-050-dataclass/) 的 `dataclass` 和 `__post_init__` 校验;[Day 498](/blog/agent-zero/day-498-resume-1/) 用过的正则;Day 511 练习 3 写过的 CSV。今天不调模型,花费 ¥0。

今天塞了四块内容,每块都是一个小脚本。如果你觉得一天吃不下,可以把「谈薪」和「避坑」留到拿到第一个面试邀请之后再读,先做前面的面试流程和最后的漏斗。

学法提示:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `breakdown`;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 面试流程:先知道要过几关

这一节是经验,不是统计。我没有一份「每家公司面几轮」的数据,下面是国内和海外都很常见的形态,具体到每家会有出入。所以最有用的一个动作是:HR 或 recruiter 第一次联系你时,直接问「一共几轮,每轮大概考什么,整个流程多久」。正常的公司都会回答,回答不上来或含糊的,本身就是信息。

国内社招 Agent 岗常见的流程是这样:

| 环节 | 在考什么 | 对应你前面的准备 |
| --- | --- | --- |
| HR 或招聘方初筛 | 简历对不对口、期望薪资、什么时候能到岗 | [Day 498](/blog/agent-zero/day-498-resume-1/) 到 [501](/blog/agent-zero/day-501-resume-4/) 的简历 |
| 技术一面(约 1 小时) | 基础题和项目追问:模型、提示词、工具调用、RAG | [Day 502](/blog/agent-zero/day-502-interview-1/) 到 [506](/blog/agent-zero/day-506-interview-4/) 的八股题 |
| 技术二面 | 系统设计,或者把你的项目挖到底,有时加现场编码 | [Day 507](/blog/agent-zero/day-507-live-coding/) 手写循环,[Day 508](/blog/agent-zero/day-508-sysdesign-1/)、[509](/blog/agent-zero/day-509-sysdesign-2/) 系统设计 |
| 三面(部门负责人) | 综合能力和团队匹配,会问你为什么想做 Agent | [Day 499](/blog/agent-zero/day-499-resume-2/) 的项目讲法 |
| HR 面 | 动机、稳定性、薪资 | 今天的谈薪一节 |

大厂可能再加一轮交叉面,整个流程两到四周。

海外和外企的形态不太一样:

- **recruiter 电话**,二三十分钟,聊背景、期望薪资、签证或所在地能不能入职。
- **技术电话面,或者 take-home**。take-home 是带回家做的作业,比如「三天内做一个小 Agent 并写一页说明」。
- **onsite**。名字叫现场,现在大多是线上,一次排好几场:系统设计、项目深挖、编码、行为面试。
- 行为面试(behavioral)是通过问你过去的经历,看协作、沟通、处理冲突的能力。常用 STAR 结构回答:Situation(背景)、Task(任务)、Action(你做了什么)、Result(结果)。
- FDE 岗通常多一场客户场景模拟:面试官扮演客户,你要追问需求、讲方案。

英文面试如果是你的短板,提前把项目介绍和几个行为问题的英文回答写出来,出声练,一次比光看有效得多。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="国内和海外面试流程对照,每一环标注对应的课程天数">
  <rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)"/>
  <text x="14" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">国内</text>
  <rect x="14" y="34" width="100" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="64" y="55" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">HR 初筛</text>
  <rect x="136" y="34" width="100" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="186" y="55" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">技术一面</text>
  <rect x="258" y="34" width="100" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="308" y="55" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">技术二面</text>
  <rect x="380" y="34" width="100" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="430" y="55" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">负责人面</text>
  <rect x="502" y="34" width="100" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="552" y="55" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">HR 面 / 谈薪</text>
  <line x1="114" y1="51" x2="136" y2="51" stroke="var(--rule)"/>
  <line x1="236" y1="51" x2="258" y2="51" stroke="var(--rule)"/>
  <line x1="358" y1="51" x2="380" y2="51" stroke="var(--rule)"/>
  <line x1="480" y1="51" x2="502" y2="51" stroke="var(--rule)"/>
  <text x="64" y="84" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">498–501</text>
  <text x="186" y="84" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">502–506</text>
  <text x="308" y="84" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">507–509</text>
  <text x="430" y="84" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">499 项目讲法</text>
  <text x="552" y="84" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">今天</text>
  <text x="14" y="118" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">海外</text>
  <rect x="14" y="128" width="100" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="64" y="149" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">recruiter 电话</text>
  <rect x="136" y="128" width="100" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="186" y="149" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">技术面/作业</text>
  <rect x="258" y="128" width="222" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="369" y="149" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">onsite:设计 + 项目 + 编码 + 行为</text>
  <rect x="502" y="128" width="100" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="552" y="149" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">offer / 谈薪</text>
  <line x1="114" y1="145" x2="136" y2="145" stroke="var(--rule)"/>
  <line x1="236" y1="145" x2="258" y2="145" stroke="var(--rule)"/>
  <line x1="480" y1="145" x2="502" y2="145" stroke="var(--rule)"/>
  <text x="14" y="188" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">FDE 岗在 onsite 里多一场客户场景模拟;每一环下面的数字是你前面准备过的那几天</text>
</svg>
<figcaption>常见流程对照图,不是统计结果。每家的轮数不同,先问清楚。</figcaption>
</figure>

## 谈薪:拿到口头 offer 以后才开始

谈薪的原则不多,难的是第一次做,容易乱。

**先准备,后开口。** 开口之前要有三个数:底线(低于它就不去)、目标、依据。依据用 [Day 511](/blog/agent-zero/day-511-job-channels/) 讲的「找同一格」:你 3 年经验、投杭州一家几百人的公司,就看「3–5 年」「杭州」「100–499 人」这几格,别拿全国中位数去谈,更别拿脉脉的平均数去谈。还要记得那些都是挂牌价,不是成交价。

**让对方先报,或者报一个有依据的区间。** HR 问你期望薪资时,可以先问「这个岗位的预算范围是多少」。必须先说的话,报区间,区间的下沿是你的目标,不是你的底线,并且说出依据:同城同类岗位的样本、你现在的薪资结构、你的项目和这个岗位的匹配度。

**用事实谈,不用情绪谈。** 「我手上有另一个 offer 是 X,我更想来你们这儿,因为……,能不能在 Y 上调整一下」,比「我觉得太低了」有用得多。不要编一个不存在的 offer,圈子比你想象的小,HR 之间会互相核实,被发现就是直接失去信任。

**月薪谈不动,谈别的。** 签字费、更高的职级、提前转正、更多的远程天数、培训预算,都是可以谈的。

**一切以书面为准。** 书面 offer 拿到手、背景调查通过之前,不要从现在的公司离职。

这些原则里最容易做错的是第二条之前的那一步:你得先知道对方给的 offer 到底值多少钱。月薪 4 万 × 16 薪和月薪 4.5 万 × 12 薪,哪个多?加上公积金、期权、试用期打折以后呢?下面写一个脚本把它算清楚。

### 第一步:把 offer 变成一个数

用 [Day 50](/blog/agent-zero/day-050-dataclass/) 的 `dataclass` 装一个 offer,再写一个函数算第一年总包。第一版最直觉的写法,把所有能折成钱的都加起来:

```python
# agent-zero-lab/part09/jobs/offer.py  (第一版)
from dataclasses import dataclass


@dataclass
class Offer:
    name: str
    monthly: float        # 月薪,元
    months: int = 12      # 几薪
    bonus: float = 0.0    # 年终奖里你有把握拿到的部分,元
    hf_rate: float = 0.0  # 公司缴公积金的比例,0.12 就是 12%
    hf_base: float = 0.0  # 公积金缴纳基数,元;0 表示按月薪
    equity: float = 0.0   # 期权/股票折成每年的价值,元
    signing: float = 0.0  # 签字费,一次性,元


def total_year(o: Offer) -> float:
    base = o.hf_base or o.monthly
    return o.monthly * o.months + o.bonus + base * o.hf_rate * 12 + o.equity + o.signing


if __name__ == "__main__":
    a = Offer("A 大厂", monthly=40000, months=16, hf_rate=0.12, hf_base=30000)
    b = Offer("B 创业公司", monthly=45000, months=12, bonus=0, hf_rate=0.05, hf_base=45000)
    for o in (a, b):
        print(f"{o.name}: {total_year(o) / 10000:.1f} 万")
```

<div class="line-notes">

- `class Offer:` 一个 offer 就是一堆字段。`@dataclass` 让 Python 自动生成 `__init__`,所以下面可以直接写 `Offer("A 大厂", monthly=40000, ...)`。相当于 JS 里一个只有字段的 interface 加一个自动生成的构造函数。
- `months: int = 12` 「几薪」。写在 offer 上的总月数,16 薪就是 16。默认 12,没写默认值的字段(`name`、`monthly`)必须传。
- `hf_rate: float = 0.0` 公积金比例。`0.12` 代表 12%,不是 12。后面会看到写成 12 会发生什么。
- `base = o.hf_base or o.monthly` 公积金基数没填(是 0,在 Python 里 0 算「假」)就用月薪代替。A 填了 30000,所以 `base` 是 30000;B 填了 45000。
- `return o.monthly * o.months` 这一行把五项加起来。现金部分:A 是 40000 × 16 = 640000。公司缴的公积金一年多少:`base * o.hf_rate * 12`,A 是 30000 × 0.12 × 12 = 43200。两项相加,A 是 683200 元,打印出来 68.3 万。
- `{total_year(o) / 10000:.1f}` 除以一万换成「万」,`:.1f` 保留一位小数。

</div>

在 `agent-zero-lab/` 下运行:

```bash
uv run python -m part09.jobs.offer
```

```text
A 大厂: 68.3 万
B 创业公司: 56.7 万
```

A 比 B 多 11.6 万,看起来 A 稳赢。但这个数有三个问题:

1. **公积金不是现金。** 它存在你自己的账户里,买房、还房贷、租房提取才能用,而且 A 的那 4.3 万你一分钱也拿不到手上。跟月薪直接相加,会高估 A。
2. **期权根本没地方放。** B 如果有一笔期权,第一版的 `equity` 字段让你随便填一个「折成每年的价值」,这个数从哪来、有多大概率变成钱,全凭感觉。
3. **试用期没算。** 试用期只给 70% 的工资,这三个月的差额是真金白银。

所以第二版把钱分成三类:**现金**(月薪 × 几薪 + 年终奖 + 签字费 − 试用期少拿的)、**账户里的钱**(公积金)、**可能变成钱的钱**(期权,乘上你自己相信的概率)。最后的合计只是个参考,三类分开看才有意义。

```python
# agent-zero-lab/part09/jobs/offer.py
from dataclasses import dataclass


@dataclass
class Offer:
    name: str
    monthly: float                   # 月薪,元
    months: int = 12                 # 几薪(写在 offer 上的总月数)
    bonus: float = 0.0               # 另外还有的年终奖,里面你有把握拿到的部分,元
    signing: float = 0.0             # 签字费,一次性,元
    hf_rate: float = 0.0             # 公司缴公积金的比例,0.12 就是 12%
    hf_base: float = 0.0             # 公积金缴纳基数,元;0 表示按月薪
    equity_grant: float = 0.0        # 期权/股票按现在估值的总价值,元
    vest_years: int = 4              # 几年归属完
    equity_prob: float = 0.2         # 你相信它最后能变成钱的概率(保守填)
    probation_months: int = 0        # 试用期几个月
    probation_ratio: float = 1.0     # 试用期拿几成工资

    def __post_init__(self) -> None:
        if not 0 <= self.hf_rate <= 0.12:
            raise ValueError(f"{self.name}: hf_rate 应该是 0 到 0.12 的小数,拿到 {self.hf_rate}")
        if not 0 < self.probation_ratio <= 1:
            raise ValueError(f"{self.name}: probation_ratio 应该在 0 到 1 之间,拿到 {self.probation_ratio}")


def breakdown(o: Offer) -> dict[str, float]:
    """把一个 offer 拆成三类钱,单位:元/年(入职第一年)。"""
    probation_loss = o.monthly * (1 - o.probation_ratio) * o.probation_months
    cash = o.monthly * o.months + o.bonus + o.signing - probation_loss
    hf = (o.hf_base or o.monthly) * o.hf_rate * 12
    equity = o.equity_grant * o.equity_prob / o.vest_years
    return {"现金": cash, "公积金": hf, "期权期望": equity, "合计": cash + hf + equity}


def probation_warning(o: Offer) -> str | None:
    """试用期工资不得低于约定工资的 80%(《劳动合同法》第二十条)。"""
    if o.probation_months and o.probation_ratio < 0.8:
        return f"{o.name}: 试用期只给 {o.probation_ratio:.0%},低于法定的 80%"
    return None


def compare(*offers: Offer) -> None:
    keys = ["现金", "公积金", "期权期望", "合计"]
    print(f"{'':<8}" + "".join(f"{o.name:>12}" for o in offers))
    for k in keys:
        print(f"{k:<8}" + "".join(f"{breakdown(o)[k] / 10000:>10.1f} 万" for o in offers))
    for o in offers:
        w = probation_warning(o)
        if w:
            print("注意:", w)


if __name__ == "__main__":
    a = Offer("A 大厂", monthly=40000, months=16, hf_rate=0.12, hf_base=30000)
    b = Offer("B 创业公司", monthly=45000, months=12, equity_grant=1_000_000, probation_months=3, probation_ratio=0.7)
    compare(a, b)
```

<div class="line-notes">

- `equity_grant: float = 0.0` 期权总价值,按「公司现在的估值」算出来的一个数,比如 B 说「给你 100 万的期权」。这个数本身就是对方的说法,你要怀疑它。
- `equity_prob: float = 0.2` 你相信它最后变成钱的概率。默认 0.2 是我随手写的保守值,不是统计结果;你对公司了解越多,填得越有依据。创业公司的期权最后值零的情况很常见,所以默认别填高。
- `probation_ratio: float = 1.0` 试用期拿几成工资,1.0 就是不打折。B 的 offer 里写了「试用期 3 个月,工资 70%」,对应 `probation_months=3, probation_ratio=0.7`。
- `def __post_init__(self) -> None:` `dataclass` 在生成的 `__init__` 跑完之后调用它,这里做输入校验,[Day 50](/blog/agent-zero/day-050-dataclass/) 讲过。
- `if not 0 <= self.hf_rate <= 0.12:` 公积金比例只可能在 0 到 12% 之间(下面会讲出处)。如果你手滑写成 `12`,这里直接抛错,不会让一个离谱的数悄悄进到总包里。
- `probation_loss = o.monthly * (1 - o.probation_ratio) * o.probation_months` B 的算式是 45000 × 0.3 × 3 = 40500 元,也就是试用期这三个月少拿 4.05 万。
- `cash = o.monthly * o.months + o.bonus + o.signing - probation_loss` B 的现金:45000 × 12 = 540000,减 40500,等于 499500,打印出来约 50.0 万。
- `hf = (o.hf_base or o.monthly) * o.hf_rate * 12` 和第一版一样,但现在单独成一项,不再混进现金。
- `equity = o.equity_grant * o.equity_prob / o.vest_years` B 的期权期望:1,000,000 × 0.2 ÷ 4 = 50000,一年 5.0 万。这是「期望值」,实际要么是 0 要么是一大笔,别当成每年能拿到的钱。
- `return {"现金": cash` 返回字典而不是单个数字,三类钱可以分开打印。
- `if o.probation_months and o.probation_ratio < 0.8:` 试用期工资低于 80% 就提醒。`o.probation_months` 为 0(没有试用期)时整个条件为假,不会误报。
- `print(f"{'':<8}" + "".join(` `:<8` 左对齐占 8 格,`:>12` 右对齐占 12 格,这样三列能对齐。中文字符在终端里占两格宽,对不齐的话可以自己调数字。

</div>

```bash
uv run python -m part09.jobs.offer
```

```text
                A 大厂      B 创业公司
现金            64.0 万      50.0 万
公积金            4.3 万       0.0 万
期权期望           0.0 万       5.0 万
合计            68.3 万      55.0 万
注意: B 创业公司: 试用期只给 70%,低于法定的 80%
```

两个 offer 合计差 13.3 万,比第一版的 11.6 万还大一点,但意思不一样了。A 的 64 万是现金,B 的现金只有 50 万;B 的 5 万是期望值,不是你一定拿得到的;A 的 4.3 万公积金你只能在特定场景下取出来用。最后一行「注意」是脚本发现的:B 的试用期工资只给 70%,低于法律允许的下限。

先把「80%」的出处说清楚,免得你拿着一句传言去谈。《劳动合同法》第二十条写的是:「劳动者在试用期的工资不得低于本单位相同岗位最低档工资或者劳动合同约定工资的百分之八十,并不得低于用人单位所在地的最低工资标准。」同一部法的第十九条限制了试用期的长度:合同期限三个月以上不满一年,试用期不得超过一个月;一年以上不满三年,不得超过两个月;三年以上固定期限和无固定期限的合同,不得超过六个月。原文在[国家税务总局法规库](https://fgk.chinatax.gov.cn/zcfgk/c100009/c5193025/content.html)。所以「试用期 6 个月、拿 60%」这种写法,不用谈,本身就不合规。

公积金的 12% 是怎么来的:《住房公积金管理条例》第十八条规定,职工和单位的缴存比例都不得低于职工上一年度月平均工资的 5%;上限 12% 来自 2005 年原建设部、财政部和人民银行的指导意见,原则上单位和职工缴存比例不高于 12%。我没有核对国务院官网的原文,引用时以[中国政府网](https://www.gov.cn/)公布的文本为准,这里的转载在 [waizi.org.cn](https://www.waizi.org.cn/doc/62333.html)。另外,公积金的**基数**有上限,每个城市每年不同,很多公司会按低于你实发工资的基数缴,所以 offer 里一定要问「公积金基数是多少」,而不只是问比例。

再演示一次校验是怎么起作用的。故意把比例写成 `12`(想写 12% 却忘了换成小数):

```python
Offer("错", monthly=40000, months=16, hf_rate=12, hf_base=30000)
```

```text
Traceback (most recent call last):
  File "<string>", line 3, in <module>
  ...
  File "/Users/你/agent-zero-lab/part09/jobs/offer.py", line 22, in __post_init__
    raise ValueError(f"{self.name}: hf_rate 应该是 0 到 0.12 的小数,拿到 {self.hf_rate}")
ValueError: 错: hf_rate 应该是 0 到 0.12 的小数,拿到 12
```

没有这一道校验的话,第一版会算出一个 496 万的总包,而且不报错。这种「数字离谱但程序不崩」的错误最危险,因为你看到 A 的总包从 68 万变成 496 万,可能还以为自己赚了。

### 谈的时候怎么问

脚本是帮你想清楚,谈的时候还是要说人话。下面几句是我觉得好用的:

- 对方报了预算以后:「谢谢,这个范围我理解。我看了同城同类岗位,3 到 5 年经验的挂牌区间中点大概在这个位置,考虑到我做过评测和上线,期待能在区间的上半段。」这句话里有依据,没有情绪。
- 问结构:「请问是 16 薪的固定月数,还是 12 薪加年终奖?年终奖去年的实际发放是几个月?公积金按多少基数缴?试用期多长,工资怎么算?」把每一项都问到,`Offer` 里的每个字段就都有来源了。
- 问期权:「期权的行权价是多少?四年归属还是别的节奏?离职后行权窗口多久?最近一次融资的估值多少?」不愿回答这些的公司,期权的值你就按零算。
- 月薪谈不动时:「如果月薪这个档位确实到顶了,签字费或者提前转正评估能不能考虑?」

## 避坑:先用规则筛一遍

收到邀请之后,在花时间准备面试之前,先用几分钟判断它是不是坑。常见的有六类:

**名字叫 Agent,实际不是开发岗。** 「AI Agent 训练师」「Agent 运营」,实际工作是数据标注、对话审核。看职责里有没有写代码、做系统。

**外包和派遣。** 发布方是人力资源公司,有的会写「正编某某 AI 手机公司」,有的不写。投之前问清:劳动合同和谁签,社保谁交,工作地点在哪,项目结束后怎么办。外包不一定不能去,但要知道自己去的是什么。

**培训贷。** 「先培训后上岗」「培训期间免费,上岗后从工资里扣」「包就业」。这是红色信号。

**要你先付钱。** 押金、保证金、设备费、考证费。《劳动合同法》第九条写得很清楚:用人单位招用劳动者,不得要求劳动者提供担保或者以其他名义向劳动者收取财物。第八十四条规定了罚则:收取的要责令退还,并处每人五百元以上两千元以下的罚款。所以招聘环节要你交钱,不用纠结「这家是不是特殊」,直接停。

**花钱买「AI 证书」。** 培训机构卖的「智能体工程师」「大模型应用开发师」证书,常打着「人社部」「某某协会」的旗号。站长调研的 880 条 JD 里没有一条点名要这类证书,写了「证书优先」的十来条全是云厂商的官方认证(阿里云、AWS、Azure 一类)。

**远程岗骗局。** 要你先交押金或设备费、用加密货币发工资、让你用自己的银行卡帮公司「代收款」、没有任何技术面试就发 offer。遇到任何一条就停下。代收款这一条尤其危险,你的账户可能成为洗钱通道。

### 把它写成规则

这类信号大多是固定说法,适合用正则先筛一遍。我先把八段文字放在一个文件里。**这八段是我按常见套路自己写的示例,不是哪家公司的真实 JD**,真实招聘信息里的措辞会更含蓄,规则只能当第一道筛子:

```python
# agent-zero-lab/part09/jobs/flag_samples.py
# 以下 8 段文字是我按常见套路自己写的示例,不是哪家公司的真实 JD。
SAMPLES = [
    ("S1", "AI Agent 开发工程师。负责 RAG 与工具调用开发。公司提供每年 8000 元培训预算,无需押金,五险一金。"),
    ("S2", "智能体工程师(零基础可入职)。先培训后上岗,培训期间免费,上岗后从工资中分期扣除,包就业。"),
    ("S3", "远程 Agent 助理。入职需缴纳设备押金 2000 元,工资以 USDT 发放,可用你的银行卡帮公司代收款项。"),
    ("S4", "AI Agent 训练师。职责:整理对话数据、标注回复质量、审核模型输出,需熟悉 Excel。"),
    ("S5", "大模型应用开发(派遣至某手机厂商)。用人单位:某人力资源有限公司,工作地点驻场。需 Python、LangChain。"),
    ("S6", "诚招 Agent 工程师:持有人社部认可的大模型应用开发师证书者优先,考证费用 3980 元,入职后报销。"),
    ("S7", "Agent 后端工程师。Python、FastAPI、PostgreSQL,评测与上线经验优先,试用期 3 个月,薪资 80%。"),
    ("S8", "AI 工程师。微信聊天面试,通过当天发 offer,不需要技术面试。"),
]
```

先写一个最直觉的第一版:看到「培训」「押金」「设备」就报警,看到「人力资源」「外包」就报派遣:

```python
# agent-zero-lab/part09/jobs/red_flags.py  (第一版)
import re

from part09.jobs.flag_samples import SAMPLES

RULES = {
    "收费": r"培训|押金|保证金|设备|考证|证书",
    "派遣外包": r"人力资源|劳务派遣|外包|驻场",
}


def flags(text: str) -> list[str]:
    return [name for name, pat in RULES.items() if re.search(pat, text)]


if __name__ == "__main__":
    for sid, text in SAMPLES:
        print(sid, flags(text))
```

<div class="line-notes">

- `RULES = {` 规则名到正则的映射,和 [Day 498](/blog/agent-zero/day-498-resume-1/) 的关键词表是同一种写法。
- `"收费": r"培训|押金|保证金|设备|考证|证书",` 竖线是「或」,任何一个词出现就命中。这是第一版的问题所在,下面会看到。
- `return [name for name, pat in RULES.items() if re.search(pat, text)]` 列表推导式:遍历每条规则,命中的把规则名收进列表。`re.search` 在整段文字里找,找到就返回匹配对象(真),找不到返回 `None`(假)。
- `for sid, text in SAMPLES:` 每个样本是一个二元组,`sid` 是编号 S1 到 S8,直接在 `for` 里解包。

</div>

```bash
uv run python -m part09.jobs.red_flags
```

```text
S1 ['收费']
S2 ['收费']
S3 ['收费']
S4 []
S5 ['派遣外包']
S6 ['收费']
S7 []
S8 []
```

S1 是一个正常的岗位:「公司提供每年 8000 元培训预算,**无需押金**」,被标成了收费。原因是「培训」这个词是好事,「押金」前面有「无需」,是在说没有。S4 是「训练师」,该标的没标。S8「通过当天发 offer,不需要技术面试」是明显的红色信号,也没标出来。

这就是关键词匹配的老毛病:只看词在不在,不看上下文。第二版做三件事:

1. 规则改成「动作 + 对象」的短语,比如「缴纳……押金」,而不是单个词;
2. 先把「无需押金」这类否定句抹掉,再去匹配;
3. 加几类第一版漏掉的信号(没有技术面试、钱的路子不对),再单独加一条「标题像标注、正文又没有任何开发词」的判断。

```python
# agent-zero-lab/part09/jobs/red_flags.py
import re

from part09.jobs.flag_samples import SAMPLES

RULES = {
    "培训贷": r"先培训后(?:上岗|就业)|从工资[^,。;]{0,6}(?:扣|分期)|培训[^,。;]{0,6}贷款|包(?:就业|分配)",
    "要你先付钱": r"(?:缴纳|交|收取|支付)[^,。;]{0,6}(?:押金|保证金|设备费|服装费)|考证费用",
    "钱的路子不对": r"USDT|虚拟币|数字货币|代收|刷单|返佣",
    "没有技术面试": r"不需要技术面试|免面试|无需面试|聊天面试",
    "派遣外包": r"人力资源|劳务派遣|外包|驻场",
    "证书噱头": r"人社部[^,。;]{0,8}证书|大模型应用开发师",
}
NEGATION = re.compile(r"(?:无需|不收|不需要|免收)[^,。;]{0,4}(?:押金|保证金|设备费)")
NOT_CODE_TITLE = re.compile(r"训练师|标注|审核|运营")
CODE_WORDS = re.compile(r"Python|Java|TypeScript|FastAPI|LangChain|SQL")


def flags(text: str) -> list[str]:
    text = NEGATION.sub("", text)
    hits = [name for name, pat in RULES.items() if re.search(pat, text)]
    if NOT_CODE_TITLE.search(text) and not CODE_WORDS.search(text):
        hits.append("可能不是开发岗")
    return hits


if __name__ == "__main__":
    for sid, text in SAMPLES:
        print(sid, flags(text))
```

<div class="line-notes">

- `"培训贷": r"先培训后(?:上岗|就业)|` `(?:...)` 是不捕获的分组,只用来把「上岗|就业」括起来表示二选一,不产生额外的匹配结果。S2「先培训后上岗」命中这一条。同一行后面的 `从工资[^,。;]{0,6}(?:扣|分期)` 是另一个分支:`[^,。;]` 表示「除了逗号、句号、分号以外的任意一个字」,`{0,6}` 表示重复 0 到 6 次,S2 里「从工资中分期扣除」,「从工资」后面隔了「中」一个字,再接「分期」,也命中。
- `(?:缴纳|交|收取|支付)[^,。;]{0,6}(?:押金|保证金|设备费|服装费)` 动词在前、钱的名目在后,中间最多隔 6 个字、且不跨句。S3 里「缴纳设备押金」中间隔「设备」两字,命中;S1 的「无需押金」没有这个动词,不命中。
- `NEGATION = re.compile(r"(?:无需|不收|不需要|免收)` 先编译好否定句的模式。`re.compile` 把正则预先编译成对象,这里是为了下面能调用 `.sub`。
- `text = NEGATION.sub("", text)` 把所有「无需押金」「不收保证金」整句替换成空字符串。S1 变成「……公司提供每年 8000 元培训预算,,五险一金。」,这样即使以后有人加了一条只看「押金」的规则,也不会误报。
- `if NOT_CODE_TITLE.search(text) and not CODE_WORDS.search(text):` 文字里有「训练师/标注/审核/运营」,而且找不到任何一个开发词,才判「可能不是开发岗」。S4 命中;S7 虽然没有这些词但有 Python,不会触发。
- `hits.append("可能不是开发岗")` 这条不在 `RULES` 里,因为它要判断两个条件同时成立,一个正则表达不了。

</div>

```bash
uv run python -m part09.jobs.red_flags
```

```text
S1 []
S2 ['培训贷']
S3 ['要你先付钱', '钱的路子不对']
S4 ['可能不是开发岗']
S5 ['派遣外包']
S6 ['要你先付钱', '证书噱头']
S7 []
S8 ['没有技术面试']
```

S1 现在是空列表,不再误报;S2 到 S6、S8 分别命中了各自的信号;S4 被标成「可能不是开发岗」;S7 是个看起来正常的后端岗,试用期「3 个月,薪资 80%」刚好踩在法定下限上,规则没有标,这是对的。

这组规则只能当第一道筛子。它会误伤:一家正规公司真的写了「培训期间不收费」,可能被「培训」相关的规则碰到;它也会漏掉:真正的骗子不会写「先交押金」,他会说「设备需要您先垫付,后期报销」,规则里没有「垫付」。**所以命中规则不等于是坑,没命中也不等于安全。** 它的作用是把你的注意力拉到需要多问一句的地方,最后的判断还是靠你自己查公司主体、问清合同主体和流程。

## 投递节奏:用漏斗找到卡点

转方向找工作是一个数量游戏加一个迭代过程。我的建议是:第一周投 20 到 30 个岗位,包括一些你不那么想去的,先用它们练面试;每场面试后 30 分钟内写复盘(问了什么、哪里没答好、下次怎么答),把新题补进你的题库;每周至少找一次内推,脉脉、前同事、技术社群都可以。

比这些更重要的是:**记录,然后用数据判断自己卡在哪一步。** 面试挂了就怀疑「是不是我不行」,是最没用的反应。同样是没拿到 offer,卡在「简历没人回」和卡在「一面过不了」,要补的东西完全不同。

### 一份投递记录

这是一份 40 条的投递记录,按 [Day 511](/blog/agent-zero/day-511-job-channels/) 练习 3 的 `apply_list.csv` 的思路简化成四列:编号、渠道、投递日期、状态。**这是我编的演示数据**,渠道和回复情况是为了让漏斗有一个明显的卡点,不代表真实的回复率。状态只能是下面五个之一,记的是「这家走到的最远一步」:

`已投` → `已回复` → `一面` → `二面` → `offer`

保存为 `agent-zero-lab/part09/jobs/funnel_log.csv`:

```csv
编号,渠道,投递日期,状态
1,liepin,10-13,已投
2,boss,10-13,已投
3,boss,10-13,已回复
4,liepin,10-13,已投
5,boss,10-14,已投
6,boss,10-14,已投
7,liepin,10-14,已投
8,boss,10-14,已投
9,boss,10-15,已投
10,内推,10-15,一面
11,boss,10-15,已投
12,boss,10-15,已投
13,liepin,10-16,已投
14,boss,10-16,已投
15,boss,10-16,已投
16,内推,10-16,一面
17,boss,10-17,已投
18,boss,10-17,已投
19,liepin,10-17,已投
20,boss,10-17,已投
21,boss,10-18,已投
22,liepin,10-18,已投
23,boss,10-18,已投
24,内推,10-18,一面
25,liepin,10-19,已投
26,boss,10-19,已投
27,boss,10-19,已投
28,liepin,10-19,已投
29,boss,10-20,已投
30,boss,10-20,已投
31,liepin,10-20,已投
32,内推,10-20,二面
33,boss,10-21,已投
34,liepin,10-21,已投
35,boss,10-21,已投
36,boss,10-21,已投
37,liepin,10-22,已投
38,boss,10-22,已投
39,boss,10-22,已投
40,liepin,10-22,已投
```

### 算漏斗

```python
# agent-zero-lab/part09/jobs/funnel.py
import csv
import sys
from collections import Counter
from pathlib import Path

STAGES = ["已投", "已回复", "一面", "二面", "offer"]
# 每一步的转化率低于这个数就报警。这是我随手定的,不是行业标准,按你自己的情况改。
LIMITS = {"已回复": 0.15, "一面": 0.5, "二面": 0.5, "offer": 0.3}
ADVICE = {
    "已回复": "回复率低:简历关键词、渠道或岗位选得不对,回 Day 498 到 501 和 Day 511",
    "一面": "一面过不了:基础题没答稳,回 Day 502 到 506",
    "二面": "二面过不了:系统设计或项目深度不够,回 Day 508、509",
    "offer": "终面或谈薪卡住:看 Day 513 谈薪那一节,回头复盘最后一轮",
}
MIN_N = 5  # 分母小于它就不下结论


def load(path: Path) -> Counter[str]:
    """读投递记录,返回每个阶段「到过」的数量。"""
    reached: Counter[str] = Counter()
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            if row["状态"] not in STAGES:
                raise ValueError(f"第 {row['编号']} 行的状态 {row['状态']!r} 不在 {STAGES} 里")
            furthest = STAGES.index(row["状态"])
            for stage in STAGES[: furthest + 1]:
                reached[stage] += 1
    return reached


def report(reached: Counter[str]) -> None:
    for prev, cur in zip(STAGES, STAGES[1:]):
        n, k = reached[prev], reached[cur]
        rate = k / n if n else 0.0
        note = ""
        if n < MIN_N:
            note = f"  样本太少(n={n}),先不下结论"
        elif rate < LIMITS[cur]:
            note = f"  <-- {ADVICE[cur]}"
        print(f"{prev:>3} -> {cur:<3} {k:>2}/{n:<2} = {rate:>4.0%}{note}")


if __name__ == "__main__":
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "part09/jobs/funnel_log.csv")
    r = load(path)
    print({s: r[s] for s in STAGES})
    report(r)
```

<div class="line-notes">

- `STAGES = ["已投", "已回复", "一面", "二面", "offer"]` 五个阶段按先后排好,下标就是「走了多远」。
- `LIMITS = {"已回复": 0.15,` 每一步的报警线。键是「要进入的那一步」:回复率(已投 → 已回复)低于 15% 就报警。15% 和 50% 都是我随手定的数,没有行业统计支撑。
- `MIN_N = 5` 分母小于 5 的那一步不下结论。这是整个脚本里我最想让你记住的一条,后面解释。
- `reached: Counter[str] = Counter()` `Counter` 是计数用的字典,键不存在时自动从 0 开始(Day 511 用过)。
- `with path.open(encoding="utf-8-sig", newline="") as f:` `utf-8-sig` 能读带 BOM 的文件(Excel 存出来的 CSV 常常带),不带的也能读。`newline=""` 是 `csv` 模块文档要求的写法。
- `for row in csv.DictReader(f):` 每一行读成字典,键是第一行的列名。第 3 行是 `{"编号": "3", "渠道": "boss", "投递日期": "10-13", "状态": "已回复"}`。
- `if row["状态"] not in STAGES:` 状态写错的时候直接报错,并告诉你是第几行。没有这句时的报错见下面。
- `furthest = STAGES.index(row["状态"])` 状态是「一面」,下标是 2。
- `for stage in STAGES[: furthest + 1]:` 走到一面的这家,「已投、已回复、一面」三个阶段都算到过,所以切片取到下标 2 为止,三个阶段的计数各加 1。
- `for prev, cur in zip(STAGES, STAGES[1:]):` 把列表和「去掉第一个的自己」配对,得到 (已投, 已回复)、(已回复, 一面)……每相邻两步一对,正好是漏斗的每一级。
- `rate = k / n if n else 0.0` 分母为 0 时不除,避免 `ZeroDivisionError`。
- `if n < MIN_N:` 样本太少先拦住,再看 `elif rate < LIMITS[cur]` 才报警。顺序不能反。
- `{rate:>4.0%}` 把 0.125 格式化成 `12%`,`>4` 右对齐占 4 格。

</div>

```bash
uv run python -m part09.jobs.funnel
```

```text
{'已投': 40, '已回复': 5, '一面': 4, '二面': 1, 'offer': 0}
 已投 -> 已回复  5/40 =  12%  <-- 回复率低:简历关键词、渠道或岗位选得不对,回 Day 498 到 501 和 Day 511
已回复 -> 一面   4/5  =  80%
 一面 -> 二面   1/4  =  25%  样本太少(n=4),先不下结论
 二面 -> offer  0/1  =   0%  样本太少(n=1),先不下结论
```

漏斗说话了:40 家投出去,只有 5 家有回音,回复率 12%,低于 15% 的线,脚本指你回去看简历、渠道和选岗。回复之后到一面是 4/5,不低。后面两步的样本只有 4 条和 1 条,所以脚本没有下结论。

这一点要强调。二面那一步 1/4 = 25%,看上去很低,但你只面了 4 个一面,**一个人的运气就能让这个数从 25% 变成 50%**。样本这么小的时候,「我二面过不了」这个结论是站不住的,正确的做法是继续投、继续面,攒到分母够大再看。样本小的时候,百分比反而会误导你。

故意制造一次错误:在记录最后加一行 `41,boss,10-23,已拒绝`(很多人会这样记,因为被拒了确实是个状态)。不带上面那道检查的第一版,报错是这样的:

```text
Traceback (most recent call last):
  ...
  File "/Users/你/agent-zero-lab/part09/jobs/funnel.py", line 24, in load
    furthest = STAGES.index(row["状态"])
               ^^^^^^^^^^^^^^^^^^^^^^^^^^^
ValueError: '已拒绝' is not in list
```

`'已拒绝' is not in list` 的意思是 `STAGES.index` 在列表里找不到这个字符串。只看这一行你不知道是哪一行数据有问题,所以最终版加了那道 `if row["状态"] not in STAGES`,把报错改成「第 41 行的状态 '已拒绝' 不在 ['已投', '已回复', '一面', '二面', 'offer'] 里」。记录规则是:**状态记走到的最远一步,被拒不是新状态,写在另一列备注里。**

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="求职漏斗与回退路径">
  <rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)"/>
  <rect x="20" y="40" width="300" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="30" y="60" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">已投</text>
  <rect x="45" y="78" width="250" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="55" y="98" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">已回复</text>
  <rect x="70" y="116" width="200" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="80" y="136" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一面</text>
  <rect x="95" y="154" width="150" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="105" y="174" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">二面以后 / offer</text>
  <text x="350" y="98" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">卡在这 → Day 498–501 简历、Day 511 渠道</text>
  <text x="350" y="136" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">卡在这 → Day 502–506 基础题</text>
  <text x="350" y="174" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">卡在这 → Day 508–509 设计、项目深度</text>
  <text x="20" y="208" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">每周看一次漏斗,哪一层掉得最多就回去补哪一天;分母不到 5 先别下结论</text>
</svg>
<figcaption>求职漏斗。不凭感觉判断「是不是我不行」,看哪一层掉得最多,对症补。</figcaption>
</figure>

## 动手练习

### 练习 1:期权要有多大概率才追平

`Offer` 里 `equity_prob` 是你自己填的。反过来问:**B 的期权要有多大概率变成钱,B 的第一年合计才追平 A?** 写一个函数 `breakeven_prob(a, b)`,追不平(需要的概率超过 100% 或为负)返回 `None`。

<details><summary>参考答案</summary>

`breakdown(b)["合计"]` 里期权那一项是 `equity_grant * equity_prob / vest_years`,是概率的线性函数,所以可以直接解方程:先算出「概率为 0 时 B 的合计」,和 A 的合计差多少,再除以「概率每增加 1 多出来的钱」。

```python
# agent-zero-lab/part09/ex/ex513_breakeven.py
from dataclasses import replace

from part09.jobs.offer import Offer, breakdown


def breakeven_prob(a: Offer, b: Offer) -> float | None:
    """B 的期权要有多大概率变成钱,B 的第一年合计才追平 A。追不平返回 None。"""
    per_prob = b.equity_grant / b.vest_years       # 概率每加 1,B 多拿这么多钱
    if per_prob == 0:
        return None
    gap = breakdown(a)["合计"] - breakdown(replace(b, equity_prob=0))["合计"]
    p = gap / per_prob
    return p if 0 <= p <= 1 else None


if __name__ == "__main__":
    a = Offer("A 大厂", monthly=40000, months=16, hf_rate=0.12, hf_base=30000)
    b = Offer("B 创业公司", monthly=45000, months=12, equity_grant=1_000_000, probation_months=3, probation_ratio=0.8)
    p = breakeven_prob(a, b)
    print("B 的期权要有", "追不平" if p is None else f"{p:.0%}", "的把握变成钱,第一年才追平 A")
    if p is not None:
        b2 = replace(b, equity_prob=p)
        print(f"验算:B 合计 {breakdown(b2)['合计'] / 10000:.2f} 万,A 合计 {breakdown(a)['合计'] / 10000:.2f} 万")
```

<div class="line-notes">

- `from dataclasses import replace` `replace(对象, 字段=新值)` 返回一个改了某个字段的新副本,原对象不动,相当于 JS 里 `{...b, equity_prob: 0}`。
- `per_prob = b.equity_grant / b.vest_years` 100 万 ÷ 4 = 25 万:概率从 0 涨到 1,B 的第一年多拿 25 万。
- `if per_prob == 0:` B 根本没有期权时无解,返回 `None`。
- `gap = breakdown(a)["合计"] - breakdown(replace(b, equity_prob=0))["合计"]` 把 B 的期权概率设成 0,算出「B 只剩现金和公积金」的合计 51.3 万(这次我把试用期改成 80%,少拿 2.7 万)。A 是 68.32 万,差 17.02 万。
- `p = gap / per_prob` 17.02 ÷ 25 = 0.68。
- `return p if 0 <= p <= 1 else None` 概率超过 1(就算期权百分百变成钱也追不平)或者是负数(B 本来就比 A 高),都返回 `None`。
- `b2 = replace(b, equity_prob=p)` 用算出来的概率造一个 B 的副本,拿去验算。

</div>

```bash
uv run python -m part09.ex.ex513_breakeven
```

```text
B 的期权要有 68% 的把握变成钱,第一年才追平 A
验算:B 合计 68.32 万,A 合计 68.32 万
```

68% 的把握,对一个创业公司的期权来说,是个很高的要求。这个数不是用来精确决策的,是让你看到:**你得相信这家公司有近七成的概率成功,才值得为了期权放弃 A 的那 13 万现金差额。** 如果你对公司没那么有把握,这个 offer 的比较就不是看总包,而是看你想不想要创业公司的成长机会。

</details>

### 练习 2:再加一条规则,抓试用期

S7 里写着「试用期 3 个月,薪资 80%」,正好在法定下限上。给红线工具加一个函数,从文字里读出试用期月数和薪资比例,低于 80% 或者月数超过 6 个月就报问题,用 S7 和一段新写的文字测试。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex513_probation.py
import re

from part09.jobs.flag_samples import SAMPLES

PAT = re.compile(r"试用期\s*(\d+)\s*个月[^。]*?(\d{2,3})\s*%")


def probation_issue(text: str) -> str | None:
    m = PAT.search(text)
    if m is None:
        return None
    months, pct = int(m.group(1)), int(m.group(2))
    if pct < 80:
        return f"试用期 {months} 个月只给 {pct}%,低于 80%"
    if months > 6:
        return f"试用期 {months} 个月,超过法定上限 6 个月"
    return None


if __name__ == "__main__":
    extra = ("X1", "Agent 工程师。试用期 6 个月,试用期薪资 60%,转正后涨薪。")
    for sid, text in [*SAMPLES[6:7], extra]:
        print(sid, probation_issue(text))
```

<div class="line-notes">

- `PAT = re.compile(r"试用期\s*(\d+)\s*个月[^。]*?(\d{2,3})\s*%")` 两个括号是两个捕获组:第一个抓月数,第二个抓百分比。`\s*` 允许数字前后有空格;`[^。]*?` 是「非贪婪地跳过任意非句号的字」,把「试用期 3 个月,薪资」这一段跳过去,直到遇到两三位数字加 `%`。
- `m = PAT.search(text)` S7 是「试用期 3 个月,薪资 80%」,`m.group(1)` 是 `"3"`,`m.group(2)` 是 `"80"`。
- `months, pct = int(m.group(1)), int(m.group(2))` 字符串转整数。
- `if pct < 80:` 80 不小于 80,S7 不触发。
- `if months > 6:` 单独检查月数。注意第十九条的上限是按合同期限分档的(一年以内最多 1 到 2 个月),这里只用了最宽松的一档 6 个月,所以只能抓到「一定违规」的。
- `for sid, text in [*SAMPLES[6:7], extra]:` `SAMPLES[6:7]` 是只含 S7 的列表,`*` 把它展开,和 `extra` 拼成一个新列表。

</div>

```bash
uv run python -m part09.ex.ex513_probation
```

```text
S7 None
X1 试用期 6 个月只给 60%,低于 80%
```

S7 没问题,X1 抓到。这条规则的局限:文字里要是写「试用期六个月」(汉字数字)就读不出来,会返回 `None`,当成没问题。读不到不等于没问题,真实使用时遇到汉字数字要自己看。

</details>

### 练习 3:哪个渠道的回复率高

给 `funnel_log.csv` 的数据按渠道(`boss`、`liepin`、内推)分别算回复率,看看第一周该多花时间在哪里。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex513_channel.py
import csv
from collections import defaultdict
from pathlib import Path

rows = list(csv.DictReader(Path("part09/jobs/funnel_log.csv").open(encoding="utf-8-sig")))
by_channel: dict[str, list[str]] = defaultdict(list)
for r in rows:
    by_channel[r["渠道"]].append(r["状态"])

for ch, statuses in sorted(by_channel.items()):
    n = len(statuses)
    replied = sum(s != "已投" for s in statuses)
    print(f"{ch:<7} 投 {n:>2} 条,有回音 {replied} 条,{replied / n:.0%}")
```

<div class="line-notes">

- `rows = list(csv.DictReader(` 一次性读成列表,方便后面遍历。
- `by_channel: dict[str, list[str]] = defaultdict(list)` `defaultdict(list)` 在键不存在时自动造一个空列表,不用先判断。
- `by_channel[r["渠道"]].append(r["状态"])` 按渠道把状态分堆,`boss` 堆里有 24 个状态。
- `replied = sum(s != "已投" for s in statuses)` 布尔值能直接求和:`True` 当 1,`False` 当 0。状态不是「已投」就说明有过回音。
- `{replied / n:.0%}` 比率格式化成百分数。

</div>

```bash
uv run python -m part09.ex.ex513_channel
```

```text
boss    投 24 条,有回音 1 条,4%
liepin  投 12 条,有回音 0 条,0%
内推      投  4 条,有回音 4 条,100%
```

内推 4 投 4 中,boss 24 投只有 1 个回音。这份数据是我编的,数字夸张了,但方向和很多人的经验一致:**内推的回复率通常远高于海投**。内推只有 4 条,样本很小,不能说内推一定 100%,但足够说明第一周值得拿出一半精力去找内推,而不是继续在 boss 上海投。

</details>

**验收标准**

- `offer.py` 能算出两个 offer 的三类钱,`hf_rate=12` 会抛错而不是悄悄算出离谱的总包。
- `red_flags.py` 对 S1 不误报、对 S2 到 S6 和 S8 能报,你能说出一个它会误伤和一个它会漏掉的例子。
- `funnel.py` 在样本小于 5 的步骤上不下结论,你能解释为什么。
- 你自己建了一份真实的投递记录(只记状态规定的五个值),第一周投出了 20 个以上。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| take-home | 带回家完成的面试作业,通常几个小时到一两天的量,比如做一个小 Agent 并写说明 |
| onsite | 一次排好几场的集中面试,现在大多是线上进行 |
| behavioral 面试 | 行为面试,通过问你过去的经历评估协作、沟通、处理冲突的能力 |
| STAR | 回答行为面试的结构:Situation 背景、Task 任务、Action 你做的、Result 结果 |
| 薪资结构 | 月薪、几薪、年终奖、股票或期权、公积金、补贴、签字费等组成部分 |
| 签字费 | 签 offer 时一次性发的钱,常用来弥补你离开现公司时的损失 |
| 住房公积金 | 单位和个人每月按比例各缴一份存进你的个人账户,只能用于买房、租房、还贷等,基数和比例有上下限 |
| 试用期 | 入职后的考察期,法律限定了最长时间和最低工资 |
| 期权 | 以约定的价格在将来买公司股票的权利,公司上市或被收购后才可能变成钱,否则可能是零 |
| 归属(vest) | 期权分几年逐步变成你的,比如四年归属,每年拿四分之一 |
| 培训贷 | 先培训后上岗、培训费用以贷款形式转嫁给求职者的套路 |
| 求职漏斗 | 投递到 offer 各阶段的数量和转化率 |
| 转化率 | 进入下一阶段的数量除以进入当前阶段的数量,比如 40 投 5 回复,转化率 12.5% |

## 常见误区

**只比较月薪。** 几薪、年终、公积金基数、期权、试用期,加起来可能让月薪相同的两个 offer 一年差几十万。第一版 `total_year` 把所有东西混成一个数,比只看月薪好,但还是掩盖了「哪些是现金」。

**把期权按公司宣传的估值算满。** 对方说「100 万期权」,你要问行权价、归属节奏、最近一次融资估值。问不出来就按零算,有就当意外之喜。

**从现公司离职太早。** 口头 offer 不算数,书面 offer 拿到、背景调查通过之前,工作留着。

**拿网上的「平均薪资」当谈薪依据。** 先问口径:哪个平台、哪类岗位、平均还是中位数、算没算年终和股票([Day 511](/blog/agent-zero/day-511-job-channels/) 的主题)。

**只投最想去的几家。** 没有练手的面试,第一场就是最想去的公司,大概率浪费机会。第一周故意投一批不那么想去的,用来热身。

**用小样本下结论。** 面了 4 个一面,一个二面没过,就断言「我的系统设计不行」,是被一次偶然的运气带偏。看漏斗时先看分母。

**把关键词规则的结果当判决。** 命中不等于是坑,没命中不等于安全。规则只是帮你想起「这里要多问一句」。

**谈薪时编造 offer。** 行业小,HR 之间会核实,被发现就是直接失去信任,比谈不成还糟。

## 学习资料

### 文档与文章

- [《劳动合同法》全文(国家税务总局法规库)](https://fgk.chinatax.gov.cn/zcfgk/c100009/c5193025/content.html):今天用到的第九条(不得收取财物)、第十九条(试用期长度)、第二十条(试用期工资 80%)、第八十四条(罚则)都在里面,读原文只要十分钟。
- [《住房公积金管理条例》转载页](https://www.waizi.org.cn/doc/62333.html):第十八条规定缴存比例不得低于 5%。第三方转载,正式引用以中国政府网为准。
- [Levels.fyi](https://www.levels.fyi/):海外公司按职级的薪资数据,了解头部公司的薪资结构(底薪、奖金、股票三块)和谈判空间。
- [Deel](https://www.deel.com/) 和 [Remote](https://remote.com/):两家常见的名义雇主(EOR)平台,了解跨国远程雇佣是怎么运作的。Deel 的主页对脚本请求不稳定,需要浏览器打开。
- [OpenAI 招聘页示例:Forward Deployed Software Engineer](https://jobs.ashbyhq.com/openai/00207abc-49b7-465c-a219-f7c1140f8047) 和 [Anthropic 招聘页示例:Forward Deployed Engineer](https://job-boards.greenhouse.io/anthropic/jobs/5423029008):海外头部公司的 FDE 岗位,读职责和流程描述,对照今天的面试流程。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1N14y1r7tJ&autoplay=0&high_quality=1" title="HR常见压价话术+谈薪公式!12年HR总监的谈薪宝典" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>HR大婷讲求职 · HR常见压价话术+谈薪公式!12年HR总监的谈薪宝典 · 12 分钟,从 HR 的角度看谈薪,重点听常见的压价话术和怎么回应。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Pm4y1K7V7&autoplay=0&high_quality=1" title="(全英沉浸式) 让每个程序员都能英语面试!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>长沙二人卷 · (全英沉浸式) 让每个程序员都能英语面试! · 4 分钟,准备投新加坡、香港或外企之前,先感受一下英文技术面试的节奏。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/u9BoG1n1948" title="Tips for negotiating your salary (from an ex-FAANG recruiter)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>mayuko · Tips for negotiating your salary (from an ex-FAANG recruiter) · 前大厂招聘官讲谈薪,海外 offer 的结构和谈法讲得比较清楚。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/qZgErBZk0GY" title="Forward Deployed Engineer | Role & Interview Overview" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Aced (formerly Exponent) · Forward Deployed Engineer | Role &amp; Interview Overview · FDE 是做什么的、面试分几轮、各轮考什么,想投 FDE 岗之前看。</figcaption>
</figure>

### 书籍

- Chris Voss《Never Split the Difference》(HarperBusiness, 2016):前 FBI 谈判专家写的谈判书,有中文版《掌控谈话》(北京联合出版公司,我查到的信息,买之前核对一下)。读讲「校准式提问」和「锚定」的章节,用在谈薪上,2 小时。
- Gayle Laakmann McDowell《Cracking the Coding Interview》(CareerCup, 第 6 版, 2015):全书分三部分:面试流程、几家大公司的面试内幕、特殊情况。编码题部分偏算法,Agent 岗考得少,当作理解「面试官在每个环节看什么」来读。我没有核实它有没有专门讲谈薪的章节,谈薪以上面的 Voss 和视频为主。

### 开源项目与代码

今天这组不需要。想自己持续跟踪岗位,可以用 [Day 512](/blog/agent-zero/day-512-remote-fde/) 的方法:定期调公司官网公开的 Ashby、Greenhouse 职位接口,存下来,用关键词筛。只调公开接口,不要去绕需要登录或有人机验证的平台。

## 自测

1. HR 初筛时你最先该问的、能帮你判断流程是否靠谱的一个问题是什么?

<details><summary>答案</summary>

「一共几轮面试,每轮大概考什么,整个流程多久?」正常的公司都能回答。含糊其辞、说「到时候再看」或者「面试只要聊一聊」,本身就是信号,尤其是和「当天发 offer」「不需要技术面试」连在一起的时候。

</details>

2. 两个 offer:A 月薪 4 万、16 薪,公积金按 3 万基数缴 12%;B 月薪 4.5 万、12 薪,试用期 3 个月只给 70%,还有 100 万期权。为什么不能只看合计?

<details><summary>答案</summary>

合计把三种性质不同的钱加在了一起:A 的 64 万是现金,4.3 万公积金在你的账户里、只能在特定场景取出;B 的期权 5 万只是期望值(概率 0.2 时的年均),实际可能是零。另外 B 的试用期工资 70% 低于法定的 80%,是个应该谈的点,也是对这家公司合规程度的信号。所以要把现金、公积金、期权期望分开看,再决定你更看重哪一项。

</details>

3. 《劳动合同法》对试用期工资有什么规定?

<details><summary>答案</summary>

第二十条:试用期工资不得低于本单位相同岗位最低档工资或者劳动合同约定工资的 80%,并不得低于用人单位所在地的最低工资标准。第十九条还规定了试用期长度:三个月以上不满一年的合同最长一个月,一年以上不满三年最长两个月,三年以上固定期限或无固定期限最长六个月。

</details>

4. 投了 40 家,5 家回复,4 家进了一面,1 家进了二面。能不能说「我二面过不了」?

<details><summary>答案</summary>

不能。进一面的只有 4 家,进二面的 1 家,分母太小,一次偶然就能让比率差一倍。真正的卡点在前面:回复率 5/40 = 12.5%,低于 15% 的线,应该回去检查简历关键词、渠道、选岗。继续投、继续面,攒到每一步的分母都不小于 5 再对后面的步骤下结论。

</details>

5. 一个远程岗位,面试只有文字聊天,聊完当天发了 offer,要求你先寄回 2000 元「设备押金」,工资用 USDT 发。命中了哪几条红色信号?

<details><summary>答案</summary>

三条:没有技术面试就发 offer;要你先付钱(押金,而且《劳动合同法》第九条明确禁止招聘时收取财物);钱的路子不对(USDT)。任何一条都足以停止,三条叠在一起基本可以确定是骗局。

</details>

6. (面试题)HR 问你:「你的期望薪资是多少?」请给出一个回答思路。

<details><summary>答案</summary>

先尝试了解预算:「想先了解一下这个岗位的薪资范围和结构,可以吗?」必须先说时,报一个区间,下沿是你的目标而不是底线,并给出依据,比如同城同类岗位的挂牌样本、你现在的薪资结构、项目与岗位的匹配度。同时说明会综合看几薪、年终、公积金、期权的整体结构,不只看月薪。不要编造不存在的 offer。

</details>

## 明天预告

[Day 514](/blog/agent-zero/day-514-industry-1/) · 行业里的 Agent(一):JD 行业分布和换行业的五样东西。投出去的岗位不全是 SaaS 客服:银行要做投研助手,医院要做病历质控,电商要做商家客服。明天先用岗位正文数一数哪些行业在招 Agent 工程师,看这个统计粗糙在哪里;再讲换行业时,同一套 SupportPilot 骨架要换哪五样东西。面试官问的往往是「你这套东西搬到我们这儿要改什么」,明天开始准备这个回答。
