---
title: 'Day 544 · 评测是产品(一):一个人和一个团队的评测,资产生命周期'
description: '第六部分和毕业项目里,评测是你一个人的事。到了五个团队都接入 AgentOps,评测会慢慢烂掉,原因几乎都不是技术。今天先对比一个人和一个团队的评测差在哪,再把一条用例当成有生老病死的东西:从哪来、怎么评审入库、能力集和回归集为什么要分开、什么时候毕业、怎么退役。实跑两个小脚本:一个演示「总分 77.5% 没变,其实学会 4 条、弄坏 4 条」,一个用状态机把用例的一生管起来。'
pubDate: 2026-10-23
regime: none
tags: ['eval', 'process', 'senior', 'python', 'agent-zero']
series: 'agent-zero'
day: 544
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 543](/blog/agent-zero/day-543-design-doc-2/) 把 AgentOps 运行时的设计文档填满了,配了两份 ADR,又让模型按清单预审:第一版 1/6、第二版 2/6,它第二轮抓到的最要紧的问题是「迁移前后各跑一次,没法判断 G4 的差异不显著」。那份文档里,好几条目标都靠评测集来证明:G4 要看退款工单评测集的成功率,R2 要在长任务评测集上量化,R3 要往 arch_bench 里加更难的工单。

这就引出一个之前没问过的问题:评测集本身谁来维护?一个人做 SupportPilot 时这不是问题,五个团队都接进运行时以后就是了。今天开始的两天讲评测在团队里怎么活下来,今天先讲为什么会烂,以及一条用例的一生。

## 今天要解决的问题

学完今天你应该能做到:

1. 说清一个人的评测和一个团队的评测差在哪:差别不在评测本身,在评测周围那一圈「谁负责」。这是今天第一个新概念。
2. 说出评测用例的**生命周期**:来源、评审入库、能力集、回归集、毕业、退役,每一步要满足什么条件。这是第二个新概念。
3. 跑通 `part10/mixed_score.py`,亲眼看到能力集和回归集混在一起时,「学会 4 条」和「弄坏 4 条」怎么在总分里抵消成 0。
4. 跑通 `part10/case_lifecycle.py`,用一个状态机把用例的入库、毕业、退役规则写成代码,不合规的操作直接被拦住。

预计用时 2 小时。两个脚本都不调模型,花费 0 元。前置:[Day 344](/blog/agent-zero/day-344-eval-concepts/)(离线、在线、回归评测和评测驱动开发)、[Day 348](/blog/agent-zero/day-348-testcase-structure/)(一条用例里该有什么)、[Day 375](/blog/agent-zero/day-375-eval-project-2/)(CI 回归门禁)、[Day 476](/blog/agent-zero/day-476-eval-scenarios/)(SupportPilot 评测集)、[Day 50](/blog/agent-zero/day-050-dataclass/)(dataclass)、[Day 36](/blog/agent-zero/day-036-exceptions-2/)(自定义异常)。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,画出生命周期那张图,再默写 `case_lifecycle.py` 的 `ALLOWED` 表和 `ready_to_graduate`;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 一个人的评测和一个团队的评测

第六部分和毕业项目里,评测是围着你一个人转的:你读 trace、你给失败分类、你写用例、你跑评测、你看报告。一个人的时候这样没问题,甚至是最快的。

麻烦在团队变大以后。我见过最常见的走向是这样的:项目早期某个工程师很认真地搭了一套评测,一百多条用例,分数挂在 CI 里。半年后这个人调走了。用例没人加,新功能上线没有对应的用例;旧用例有一半已经和产品行为对不上;CI 里的分数每次都在 71% 上下晃,大家默认「它就是这个数」,没人再看。评测还在跑,但已经不起任何作用了。

做前端的你大概见过同一件事的小号版本:Jest 的快照测试。一开始每个快照都是认真看过的。后来组件改得多了,快照一失败,大家的第一反应是 `jest -u` 全部更新,看都不看。快照测试还在,每次都绿,但它已经不能告诉你任何东西了。快照没有坏,坏的是「快照失败了谁去看、看完怎么判断」这件事没人负责。

评测烂掉也是这个原因。统计、judge、trace 都可以做得很好,组织上没人负责,照样会烂。把两种状态放在一起看:

| | 一个人 | 一个团队 |
| --- | --- | --- |
| 用例从哪来 | 自己读 trace、自己想 | 线上事故、客服工单、需求文档、错误分析、红队,来源很多 |
| 谁知道正确答案 | 自己 | 往往是客服主管、财务、法务,不是写代码的人 |
| 用例过时了怎么办 | 自己记得改 | 没人知道它过时了 |
| 分数掉了谁去看 | 自己 | 没写清楚的话,就是没人 |
| 评测跑多久、花多少钱 | 无所谓 | 跑一次 40 分钟、几百块,会被嫌弃、被绕过 |
| 判断标准变了 | 改一下 judge 提示词 | 要通知所有依赖这个分数的人 |

右边这一列每一项,都要有人负责、有流程兜住。没有的话,评测会慢慢退化成某个仪表盘上的一个数。

资深工程师和中级工程师在评测上的差别,很大一部分在这里:中级的人会写评测,资深的人能让一个团队持续地、自发地维护评测。这也是为什么这两天的标题叫「评测是产品」:评测集有用户(写 Agent 的工程师、产品经理、管理者)、有维护者、有版本、会过时,和你做的任何一个产品一样需要被经营。

Anthropic 在 2026 年 1 月发的《Demystifying evals for AI agents》里讲过他们内部怎么分工:设专门的评测团队负责核心基础设施,而**大部分评测任务由领域专家和产品团队自己贡献、自己跑**;产品经理、客户成功、销售这些不写代码的人,也可以用 Claude Code 把一条评测任务提成 PR。意思很清楚:评测的「内容」应该来自离业务最近的人,平台只管「怎么跑」。具体谁管什么、怎么钉进流程,是 [Day 546](/blog/agent-zero/day-546-eval-process/) 的内容。今天先把被管理的那个东西,也就是一条用例的一生,讲清楚。

## 评测资产的生命周期

把一条用例当成一个有生老病死的东西看,很多问题会变清楚。「评测资产」这个词听着唬人,意思就是用例、期望答案、判题器这些评测用的东西,它们和代码一样是团队的资产,会贬值,要维护。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="评测用例的生命周期:来源、评审入库、能力集、毕业进回归集、退役">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink-soft)">来源</text>
<rect x="20" y="40" width="130" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="58" fill="var(--ink)">线上事故 / 工单</text>
<rect x="20" y="76" width="130" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="94" fill="var(--ink)">需求文档</text>
<rect x="20" y="112" width="130" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="130" fill="var(--ink)">错误分析</text>
<rect x="20" y="148" width="130" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="166" fill="var(--ink)">红队 / 合成</text>
<line x1="150" y1="54" x2="210" y2="110" stroke="var(--rule)"/>
<line x1="150" y1="90" x2="210" y2="110" stroke="var(--rule)"/>
<line x1="150" y1="126" x2="210" y2="110" stroke="var(--rule)"/>
<line x1="150" y1="162" x2="210" y2="110" stroke="var(--rule)"/>
<rect x="210" y="88" width="120" height="44" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="226" y="107" fill="var(--ink)">评审入库</text>
<text x="226" y="123" fill="var(--ink-faint)">负责人+需求号</text>
<line x1="330" y1="110" x2="370" y2="70" stroke="var(--rule)"/>
<line x1="330" y1="110" x2="370" y2="170" stroke="var(--rule)"/>
<rect x="370" y="44" width="130" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="384" y="64" fill="var(--ink)">能力集</text>
<text x="384" y="82" fill="var(--ink-faint)">起点通过率低</text>
<rect x="370" y="146" width="130" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="384" y="166" fill="var(--ink)">回归集</text>
<text x="384" y="184" fill="var(--ink-faint)">应该接近 100%</text>
<line x1="435" y1="94" x2="435" y2="146" stroke="var(--mem)"/>
<text x="442" y="124" fill="var(--mem)">毕业</text>
<line x1="500" y1="171" x2="540" y2="171" stroke="var(--rule)"/>
<line x1="500" y1="69" x2="582" y2="69" stroke="var(--rule)"/>
<line x1="582" y1="69" x2="582" y2="146" stroke="var(--rule)"/>
<rect x="540" y="146" width="84" height="50" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="552" y="166" fill="var(--ink)">退役</text>
<text x="552" y="184" fill="var(--ink-faint)">产品变了</text>
<text x="20" y="232" fill="var(--ink-soft)">能力集里连续几个版本都稳定通过的用例,毕业进回归集;</text>
<text x="20" y="252" fill="var(--ink-soft)">回归集挂了 = 有东西坏了;能力集涨分 = 能力变强了。</text>
<text x="20" y="272" fill="var(--ink-soft)">产品行为改了,对应用例要么改期望,要么带着理由退役。</text>
</g>
</svg>
<figcaption>一条用例从进库到退役。能力集和回归集都可能退役;回归集里的用例不会倒退回能力集。两个集合的意义不同,混在一起看,两种信号会互相抵消。</figcaption>
</figure>

下面一个节点一个节点说。

### 来源:最好的用例来自真实失败

好用例最主要的来源是真实的失败:线上事故、客服转过来的投诉、错误分析里归出来的失败类别。[Day 345](/blog/agent-zero/day-345-error-analysis-1/) 讲过,先看上百条 trace 再写用例,不要坐在工位上凭空想。到了团队里,这条要变成流程:每次线上事故复盘都要回答一个问题,「这次的问题,有没有一条用例能提前发现?没有的话,谁在什么时候补上?」这个问题写进复盘模板,评测集才会跟着事故一起长。

第二个来源是需求。[Day 344](/blog/agent-zero/day-344-eval-concepts/) 讲过**评测驱动开发**(先把要的能力写成评测,再去实现)。Anthropic 那篇文章也是这么建议的:在 Agent 还做不到之前,先用评测定义计划中的能力,然后迭代到它做好为止。到了团队里,这条变成:需求文档里每写一条「Agent 要能做到 X」,就同时写下「怎么判断它做到了」,也就是至少一条用例。副作用是产品经理写需求时会被逼着把模糊的地方说清楚。「Agent 要能妥善处理退款」这种需求写不出用例,一写用例就得说清楚什么叫妥善:退几张?退多少?要不要审批?

第三个来源是合成和红队([Day 351](/blog/agent-zero/day-351-synthetic-data/)、[Day 352](/blog/agent-zero/day-352-adversarial-cases/))。它们用来补覆盖面,但不该是主体。如果一个评测集里七成是合成的,它测的多半是「模型能不能处理另一个模型想象出来的问题」。

### 评审入库:像代码进库一样

用例进库要像代码进库一样经过评审。评审看三件事:期望答案对不对(最好由懂业务的人确认,退款金额让财务看)、判定方式会不会误判([Day 358](/blog/agent-zero/day-358-llm-judge-3/) 讲的 judge 和人工对齐)、和已有用例是不是重复。

还要给它上「户口」:谁负责、对应哪条需求、从哪来。[Day 348](/blog/agent-zero/day-348-testcase-structure/) 讲过一条用例里有输入、期望和元数据,当时的元数据主要是分类标签;到了团队里,`owner`(负责人)和 `requirement`(需求号)这两个字段变成必填。没有负责人的用例,过时了没人知道;没有需求号的用例,产品改版时没人知道该不该删它。[Day 546](/blog/agent-zero/day-546-eval-process/) 会写一个工具在 CI 里检查这些字段,今天先在状态机里用最简单的方式拦住。

### 能力集和回归集:两个集合,两种信号

这是 Anthropic 那篇文章里区分得很清楚的两个概念,也是我觉得最值得照搬的一条。

**能力集**(capability suite)测的是「我们希望 Agent 做到、但还没完全做到的事」。文章的说法是,它的起点通过率应该偏低,专门挑 Agent 吃力的任务,给团队一座要爬的山。

**回归集**(regression suite)测的是「已经做到的事有没有被弄坏」,通过率应该接近 100%,任何一条挂了都要有人去看。[Day 344](/blog/agent-zero/day-344-eval-concepts/) 讲过回归评测这个概念,[Day 375](/blog/agent-zero/day-375-eval-project-2/) 在 CI 里加过回归门禁。今天的新东西是:回归集不是凭空来的,它的大部分用例是从能力集毕业过去的。

两个集合混在一起会出什么问题?光说不直观,直接造一个例子。

## 第一步:总分没变,其实一好一坏

假设评测集有 40 条用例:12 条能力用例(C01–C12)、28 条回归用例(R01–R28)。v1 只会 3 条难题,老功能全过;v2 新学会了 4 条难题,同时弄坏了 4 条老功能。

```python
# agent-zero-lab/part10/mixed_score.py
"""同一批用例,两个版本:总分一样,拆开看完全不是一回事。"""

# 12 条能力用例(C01–C12)+ 28 条回归用例(R01–R28),1 = 通过,0 = 没过
CAP_IDS = [f"C{i:02d}" for i in range(1, 13)]
REG_IDS = [f"R{i:02d}" for i in range(1, 29)]

v1 = {cid: 0 for cid in CAP_IDS} | {rid: 1 for rid in REG_IDS}
for cid in ("C01", "C02", "C03"):
    v1[cid] = 1  # v1 只会 3 条难题

v2 = dict(v1)
for cid in ("C04", "C05", "C06", "C07"):
    v2[cid] = 1  # v2 新学会 4 条难题
for rid in ("R05", "R11", "R17", "R23"):
    v2[rid] = 0  # 同时弄坏了 4 条老功能


def rate(results: dict[str, int], ids: list[str]) -> str:
    passed = sum(results[i] for i in ids)
    return f"{passed}/{len(ids)} = {passed / len(ids):.1%}"


for name, res in (("v1", v1), ("v2", v2)):
    print(f"{name}  总分 {rate(res, CAP_IDS + REG_IDS):<16} 能力集 {rate(res, CAP_IDS):<14} 回归集 {rate(res, REG_IDS)}")

broken = [i for i in REG_IDS if v1[i] == 1 and v2[i] == 0]
learned = [i for i in CAP_IDS if v1[i] == 0 and v2[i] == 1]
print(f"新学会:{learned}")
print(f"被弄坏:{broken}")
```

<div class="line-notes">

- `CAP_IDS = [f"C{i:02d}" for i in range(1, 13)]` 生成 `C01` 到 `C12`。`range(1, 13)` 是 1 到 12;`{i:02d}` 把数字补成两位,1 变 `01`,和 JS 的 `String(i).padStart(2, "0")` 一样。
- `REG_IDS = [f"R{i:02d}" for i in range(1, 29)]` `R01` 到 `R28`,28 条。
- `v1 = {cid: 0 for cid in CAP_IDS} | {rid: 1 for rid in REG_IDS}` 两个字典推导式:能力用例先全设 0,回归用例全设 1。中间的 `|` 是合并两个字典(Python 3.9 起),相当于 JS 的 `{...a, ...b}`。
- `v1[cid] = 1  # v1 只会 3 条难题` C01–C03 改成通过。v1 能力集 3/12。
- `v2 = dict(v1)` 复制一份再改。如果写 `v2 = v1`,两个名字指向同一个字典,改 v2 会把 v1 也改掉,和 JS 里对象赋值是引用一样。
- `v2[cid] = 1  # v2 新学会 4 条难题` C04–C07 也过了,能力集变成 7/12。
- `v2[rid] = 0  # 同时弄坏了 4 条老功能` R05、R11、R17、R23 挂了。真实场景:为了让模型学会处理复杂退款,改了提示词,结果「查发票」这种简单任务开始多调一次工具、答非所问。
- `def rate(results: dict[str, int], ids: list[str]) -> str:` 算某一组用例的通过率,返回「通过/总数 = 百分比」的字符串。
- `passed = sum(results[i] for i in ids)` 0/1 直接相加就是通过数。
- `{passed / len(ids):.1%}` 格式化成一位小数的百分比,31/40 显示成 `77.5%`。
- `for name, res in (("v1", v1), ("v2", v2)):` 遍历一个元组的元组,每次拆出名字和结果。
- `{rate(res, CAP_IDS + REG_IDS):<16}` `:<16` 左对齐、占 16 个字符宽,让两行的列对齐。总分用的是两个列表拼起来的全部 40 条。
- `broken = [i for i in REG_IDS if v1[i] == 1 and v2[i] == 0]` 找「v1 过、v2 不过」的回归用例,这就是被弄坏的。
- `learned = [i for i in CAP_IDS if v1[i] == 0 and v2[i] == 1]` 找「v1 不过、v2 过」的能力用例,这就是新学会的。

</div>

```bash
cd ~/agent-zero-lab
uv run python -m part10.mixed_score
```

```text
v1  总分 31/40 = 77.5%    能力集 3/12 = 25.0%   回归集 28/28 = 100.0%
v2  总分 31/40 = 77.5%    能力集 7/12 = 58.3%   回归集 24/28 = 85.7%
新学会:['C04', 'C05', 'C06', 'C07']
被弄坏:['R05', 'R11', 'R17', 'R23']
```

只看总分,两个版本一模一样,77.5%。如果你们的 CI 门禁是「总分不低于上一版」,v2 会顺利合进去。

拆开看完全是另一回事:能力集从 25% 涨到 58.3%,这是一次很成功的改进;回归集从 100% 掉到 85.7%,四个老功能坏了,这是一次事故。一好一坏,在总分里正好抵消。

两个信号的意思不同,处理方式也不同。回归集掉分,应该当场拦下来,谁改的谁修;能力集涨分,应该庆祝,并且考虑哪些用例可以毕业。混成一个数,两件事都看不见。

我自己的规矩是:CI 报告里**永远分开出两个分数**,门禁只看回归集(必须全过,或者按严重级别规定哪几条必须过),能力集只展示不拦截。有条件的话再按模块、按来源拆开看。还有一点:这个例子是我手工构造的,真实情况不会正好抵消到一模一样,但「总分小幅波动、底下有一好一坏」非常常见。分数本身也有随机波动,v2 的 85.7% 到底是真坏了还是运气,要用 [Day 547](/blog/agent-zero/day-547-eval-stats-1/) 起的统计方法判断;不过回归集挂的是具体哪几条用例,点名去看就行,不必等统计。

## 毕业和饱和

能力集里的用例,如果连续好几个版本都稳定通过,就该**毕业**进回归集。Anthropic 那篇文章的说法是,Agent 上线并优化之后,通过率高的能力评测可以「毕业」成一个持续运行的回归集,用来抓漂移。

为什么非要毕业?两个原因。

第一,不毕业的话,这些已经做到的能力没有被当成回归来保护。它们还在能力集里,挂了也只是「能力集掉了一点分」,没人会当回事。

第二,能力集会**饱和**。大部分用例都过了,分数顶在 95% 附近不动,再有进步也看不出来。公开榜单就是这么一步步失去区分度的:Anthropic 那篇文章里说,SWE-bench Verified 一年里从 30% 左右涨到前沿模型超过 80%,已经接近饱和。你自己的评测集会遇到同样的事,只是规模小一点。练习 1 会模拟一遍。

毕业的标准要写死,不能凭感觉。我用的是:每个版本跑 5 遍,**连续 3 个版本**每个版本的通过率都不低于 95%。为什么跑 5 遍?[Day 344](/blog/agent-zero/day-344-eval-concepts/) 讲过 pass^k,模型输出有随机性,一遍过不代表稳定。为什么连续 3 个版本?一个版本过了可能是那一版的提示词碰巧对它友好。5 遍里要做到 95%,其实就是 5 遍全过(4/5 是 80%),这是故意定得严的:回归集里的用例挂一次就要有人去看,放进去的必须真稳。

## 退役:必须带理由,必须有人确认

产品行为变了,对应的用例要么改期望答案,要么**退役**。比如云簿把年付套餐改成不支持按月退款了,那条「年付客户要求退一个月」的用例,期望答案从「退 39 元」变成「解释政策、不退」,这是改期望;如果整个功能都下线了,用例就该退役。

退役一定要写理由,而且由需求方确认,不能是用例负责人自己说了算。最怕的是有人发现某条用例总是挂,嫌它烦,悄悄删掉,就像前面那个 `jest -u`。那条用例有可能恰好是唯一一条测到某个真实问题的。总挂的用例要么说明 Agent 有问题,要么说明用例本身有问题,两种都要查清楚再处理。

## 第二步:用状态机把一生管起来

规则讲完,写成代码。**状态机**这个词你在前端可能见过(XState,或者 `useReducer` 里那个 `switch (state.status)`):一个东西在几种状态之间切换,哪些切换是允许的、要满足什么条件,写成一张表。用例的生命周期正好就是一个状态机:提议(proposed)、能力集(capability)、回归集(regression)、退役(retired)。

```python
# agent-zero-lab/part10/case_lifecycle.py
"""一条评测用例的一生:提议 → 入库 → 能力集 → 毕业进回归集 → 退役。"""
from dataclasses import dataclass, field

# 每个状态能去哪些状态。没写的路一律不许走。
ALLOWED = {
    "proposed": {"capability", "regression"},
    "capability": {"regression", "retired"},
    "regression": {"retired"},
    "retired": set(),
}
GRAD_VERSIONS = 3  # 连续几个版本
GRAD_RATE = 0.95   # 每个版本的通过率至少多少


class LifecycleError(Exception):
    pass


@dataclass
class Case:
    id: str
    source: str  # incident / prd / error_analysis / synthetic
    owner: str = ""
    requirement: str = ""
    status: str = "proposed"
    history: list[str] = field(default_factory=list)
    runs: list[list[int]] = field(default_factory=list)  # 每个版本跑 k 次的 0/1

    def move(self, to: str, why: str) -> None:
        if to not in ALLOWED[self.status]:
            raise LifecycleError(f"{self.id}: 不能从 {self.status} 到 {to}")
        self.history.append(f"{self.status} → {to}:{why}")
        self.status = to


def admit(case: Case, suite: str, reviewer: str) -> None:
    """评审入库:没有负责人和需求号的不收。"""
    if not case.owner or not case.requirement:
        raise LifecycleError(f"{case.id}: 缺负责人或需求号,不能入库")
    case.move(suite, f"{reviewer} 评审通过")


def ready_to_graduate(case: Case) -> bool:
    recent = case.runs[-GRAD_VERSIONS:]
    if len(recent) < GRAD_VERSIONS:
        return False
    return all(sum(r) / len(r) >= GRAD_RATE for r in recent)


def graduate(case: Case) -> None:
    if not ready_to_graduate(case):
        raise LifecycleError(f"{case.id}: 最近 {GRAD_VERSIONS} 个版本没有都 ≥{GRAD_RATE:.0%}")
    case.move("regression", f"连续 {GRAD_VERSIONS} 个版本 ≥{GRAD_RATE:.0%}")


def retire(case: Case, reason: str, approved_by: str) -> None:
    if not reason or not approved_by:
        raise LifecycleError(f"{case.id}: 退役要写理由,并由需求方确认")
    case.move("retired", f"{reason}(确认人 {approved_by})")


if __name__ == "__main__":
    t = Case("T051", source="incident", owner="cs-chen", requirement="PRD-12")
    admit(t, "capability", reviewer="finance-zhou")
    t.runs = [[1, 0, 1, 1, 0], [1, 1, 1, 1, 0], [1, 1, 1, 1, 1], [1, 1, 1, 1, 1], [1, 1, 1, 1, 1]]
    graduate(t)
    retire(t, "PRD-12 改版:年付不再支持按月退款", approved_by="pm-wang")
    print(t.id, t.status)
    for line in t.history:
        print("  ", line)

    bad = Case("T052", source="synthetic")
    for step in (lambda: admit(bad, "capability", reviewer="cs-chen"),
                 lambda: bad.move("retired", "嫌它老挂")):
        try:
            step()
        except LifecycleError as e:
            print("拦住:", e)

    u = Case("T053", source="prd", owner="dev-li", requirement="PRD-15")
    admit(u, "capability", reviewer="cs-chen")
    u.runs = [[1, 1, 1, 1, 1], [1, 1, 1, 1, 0], [1, 1, 1, 1, 1]]
    try:
        graduate(u)
    except LifecycleError as e:
        print("拦住:", e)
```

<div class="line-notes">

- `from dataclasses import dataclass, field` [Day 50](/blog/agent-zero/day-050-dataclass/) 学过的 dataclass;`field` 用来给列表这种「可变」的字段设默认值,下面马上会讲为什么非用不可。
- `ALLOWED = {` 状态机的核心:一张「从哪能去哪」的表。键是当前状态,值是一个集合,里面是允许去的状态。相当于 XState 里每个状态的 `on` 配置。
- `"proposed": {"capability", "regression"},` 提议的用例评审后可以进能力集,也可以直接进回归集(比如线上事故补的用例,修完以后应该一直过,直接当回归)。
- `"capability": {"regression", "retired"},` 能力用例可以毕业,也可以退役。
- `"regression": {"retired"},` 回归用例只能退役,**不能退回能力集**。如果一条回归用例开始挂,那是 bug,要修 Agent,不是把它降级让它挂得心安理得。
- `"retired": set(),` 退役是终点,哪也去不了。空集合要写 `set()`,写 `{}` 得到的是空字典。
- `GRAD_VERSIONS = 3  # 连续几个版本` 毕业规则的两个参数写成常量,放在文件顶上,团队想调一眼能看到。
- `class LifecycleError(Exception):` [Day 36](/blog/agent-zero/day-036-exceptions-2/) 学的自定义异常。所有「不许这么做」都抛它,调用方可以统一捕获。
- `@dataclass` 自动生成 `__init__` 等方法,`Case("T051", source="incident", ...)` 就能建对象。
- `source: str  # incident / prd / error_analysis / synthetic` 来源字段。今天没对它做检查,但记下来以后能统计「评测集里合成的占几成」。
- `owner: str = ""` 负责人默认空字符串,入库时会检查。默认值放在没有默认值的字段后面,这是 dataclass 的规矩。
- `status: str = "proposed"` 新建的用例都是「提议」状态。
- `history: list[str] = field(default_factory=list)` 每次状态变化记一行。列表默认值必须写成 `field(default_factory=list)`,意思是「每建一个对象,调一次 `list()` 生成一个新的空列表」。直接写 `= []` 会报错,下面实跑演示。
- `runs: list[list[int]] = field(default_factory=list)  # 每个版本跑 k 次的 0/1` 列表的列表:外层每个元素是一个版本,内层是那个版本跑 5 遍的结果,比如 `[1, 1, 1, 1, 0]`。
- `def move(self, to: str, why: str) -> None:` 唯一改状态的地方。所有切换都必须经过它,才能保证查表和记历史不会漏。
- `if to not in ALLOWED[self.status]:` 查表。T052 想从 proposed 直接到 retired,表里没有这条路,被拦。
- `self.history.append(f"{self.status} → {to}:{why}")` 先记历史再改状态,所以历史里的 `self.status` 是改之前的旧状态。
- `def admit(case: Case, suite: str, reviewer: str) -> None:` 评审入库。`reviewer` 记下是谁批的。
- `if not case.owner or not case.requirement:` 空字符串在 Python 里算假,两个有一个是空就拒绝。
- `def ready_to_graduate(case: Case) -> bool:` 判断能不能毕业,只返回真假、不改状态,方便单独测试和在报告里列「哪些该毕业了」。
- `recent = case.runs[-GRAD_VERSIONS:]` 负数切片:取最后 3 个元素,相当于 JS 的 `runs.slice(-3)`。T051 有 5 个版本,取后 3 个,全是 `[1, 1, 1, 1, 1]`。
- `if len(recent) < GRAD_VERSIONS:` 版本数不够 3 个,直接不行。新入库的用例至少要观察三个版本。
- `return all(sum(r) / len(r) >= GRAD_RATE for r in recent)` 每个版本的通过率都要 ≥ 0.95。`all` 相当于 JS 的 `every`。T053 最后三个版本里有一个是 `[1, 1, 1, 1, 0]`,4/5 = 0.8,不达标。
- `raise LifecycleError(f"{case.id}: 最近 {GRAD_VERSIONS} 个版本没有都 ≥{GRAD_RATE:.0%}")` `{GRAD_RATE:.0%}` 把 0.95 显示成 `95%`。
- `def retire(case: Case, reason: str, approved_by: str) -> None:` 退役要两样:理由和确认人。练习 2 会再加一条:确认人不能是负责人自己。
- `t = Case("T051", source="incident", owner="cs-chen", requirement="PRD-12")` 一条来自线上事故的用例,客服组的陈负责,对应需求 PRD-12。
- `admit(t, "capability", reviewer="finance-zhou")` 财务的周评审通过,进能力集。退款金额类的用例,期望答案让财务确认。
- `t.runs = [[1, 0, 1, 1, 0], [1, 1, 1, 1, 0],` 五个版本的结果:前两个版本不稳(3/5、4/5),后三个版本 5/5。
- `graduate(t)` 最近三个版本都 100%,毕业成功。
- `retire(t, "PRD-12 改版:年付不再支持按月退款", approved_by="pm-wang")` 产品改版,这条用例的期望已经不成立,由产品经理王确认退役。
- `bad = Case("T052", source="synthetic")` 一条没填负责人和需求号的合成用例。
- `for step in (lambda: admit(bad, "capability", reviewer="cs-chen"),` 把两次违规操作包成两个 lambda(相当于 JS 的箭头函数 `() => admit(...)`),放进元组里逐个执行、逐个捕获。这样第一个被拦住了,第二个还能接着试。
- `lambda: bad.move("retired", "嫌它老挂")):` 想跳过评审直接退役,表里没这条路。
- `u.runs = [[1, 1, 1, 1, 1], [1, 1, 1, 1, 0], [1, 1, 1, 1, 1]]` T053 三个版本里中间那个漏了一次。

</div>

```bash
uv run python -m part10.case_lifecycle
```

```text
T051 retired
   proposed → capability:finance-zhou 评审通过
   capability → regression:连续 3 个版本 ≥95%
   regression → retired:PRD-12 改版:年付不再支持按月退款(确认人 pm-wang)
拦住: T052: 缺负责人或需求号,不能入库
拦住: T052: 不能从 proposed 到 retired
拦住: T053: 最近 3 个版本没有都 ≥95%
```

T051 走完了完整的一生,每一步谁批的、为什么,都在 `history` 里。半年后有人问「这条用例怎么没了」,打开历史一看就知道。T052 的两次违规都被拦住了,T053 差一次没毕业。

这个状态机故意写得很小,只是把规则讲清楚。真实的团队里,用例存在 JSONL 文件里、跟代码一起进 git,状态和负责人是每条用例的字段,检查放在 CI 里跑。[Day 546](/blog/agent-zero/day-546-eval-process/) 会写那个工具。

### 顺便踩一个坑:dataclass 的列表默认值

写这个文件时,`history` 我第一反应写的是 `history: list[str] = []`。在 `agent-zero-lab` 根目录用一段最小代码重现:

```bash
uv run python -c "
from dataclasses import dataclass
@dataclass
class Case:
    id: str
    history: list[str] = []
"
```

```text
ValueError: mutable default <class 'list'> for field history is not allowed: use default_factory
```

报错的意思是:列表是可变的(mutable),不能直接当默认值,请用 `default_factory`。原因是 Python 的默认值只在定义类的时候算一次,如果允许 `= []`,所有 `Case` 对象会共用同一个列表,T051 的历史会出现在 T052 身上。dataclass 干脆在定义时就报错,防止你踩进去。改成 `field(default_factory=list)` 就好了。JS 里没有这个坑,因为 class 字段初始化 `history = []` 每次 `new` 都会重新执行。

## 动手练习

**练习 1:模拟能力集饱和。** 用一个最简单的模型:每条能力用例有一个难度,每个版本的 Agent 有一个能力值,能力 ≥ 难度就通过。一开始 10 条用例,难度 1 到 10;六个版本的能力分别是 3、5、7、9、11、13。比较两种做法:一种永远不毕业;一种每版过了的用例就毕业进回归集,同时补一条更难的新用例。打印每版两种做法下能力集的分数和回归集条数,说说你看到了什么。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex544_saturation.py
"""练习 1:能力集不毕业会饱和。模型能力每个版本涨一点,看两种做法下能力集的分数。"""

ABILITY = [3, 5, 7, 9, 11, 13]  # v1–v6 的「能力」,能力 ≥ 难度就算通过
START = list(range(1, 11))     # 一开始 10 条能力用例,难度 1–10


def score(cases: list[int], ability: int) -> str:
    passed = sum(1 for d in cases if ability >= d)
    return f"{passed:>2}/{len(cases)} = {passed / len(cases):>4.0%}"


never = list(START)
grad = list(START)
regression: list[int] = []
next_hard = 11
print("版本 | 不毕业的能力集 | 毕业+补新题的能力集 | 回归集条数")
for v, ab in enumerate(ABILITY, start=1):
    print(f"v{v}   | {score(never, ab)}     | {score(grad, ab)}          | {len(regression)}")
    passed = [d for d in grad if ab >= d]
    for d in passed:          # 简化:这一版过了就毕业(真实规则是连续 3 个版本)
        grad.remove(d)
        regression.append(d)
        grad.append(next_hard)  # 毕业一条,补一条更难的新题
        next_hard += 1
```

<div class="line-notes">

- `ABILITY = [3, 5, 7, 9, 11, 13]` 六个版本的能力值,每版涨 2。这是一个玩具模型,真实的 Agent 不会这么整齐,但足够看出饱和是怎么发生的。
- `START = list(range(1, 11))` 难度 1 到 10 的十条用例。`list(range(...))` 把 range 变成真正的列表,因为下面要对它增删。
- `passed = sum(1 for d in cases if ability >= d)` 数有几条用例的难度不超过能力值。
- `return f"{passed:>2}/{len(cases)} = {passed / len(cases):>4.0%}"` `:>2` 右对齐占两格,`:>4.0%` 百分比无小数、右对齐占四格,让表格对齐。
- `never = list(START)` 和 `grad = list(START)` 各复制一份,互不影响。直接写 `never = START` 两个变量会指向同一个列表。
- `regression: list[int] = []` 空列表要标类型,否则类型检查器不知道里面放什么。这里是普通变量,不是 dataclass 字段,直接写 `[]` 没问题。
- `next_hard = 11` 新补的用例难度从 11 开始,每补一条加 1。
- `passed = [d for d in grad if ab >= d]` 先把这一版通过的找出来,再循环处理。不能一边遍历 `grad` 一边删它,那会跳过元素,和 JS 里边 `forEach` 边 `splice` 是同一个坑。
- `for d in passed:          # 简化:这一版过了就毕业` 为了让表短一点,我把毕业规则简化成「过一次就毕业」,正文里的真实规则是连续 3 个版本。
- `grad.append(next_hard)  # 毕业一条,补一条更难的新题` 能力集的条数保持 10 条不变。

</div>

```bash
uv run python -m part10.ex544_saturation
```

```text
版本 | 不毕业的能力集 | 毕业+补新题的能力集 | 回归集条数
v1   |  3/10 =  30%     |  3/10 =  30%          | 0
v2   |  5/10 =  50%     |  2/10 =  20%          | 3
v3   |  7/10 =  70%     |  2/10 =  20%          | 5
v4   |  9/10 =  90%     |  2/10 =  20%          | 7
v5   | 10/10 = 100%     |  2/10 =  20%          | 9
v6   | 10/10 = 100%     |  2/10 =  20%          | 11
```

看左边一列:不毕业的能力集从 v5 开始顶在 100%。v6 的能力比 v5 又涨了一截,但分数一模一样,这次进步在评测里完全看不见。这就是饱和。

右边一列:能力集的分数一直在 20% 附近,它没有变成「越来越高」的漂亮曲线,但它一直有区分度:里面始终有一批当前版本做不到的题,下一版做到了就能看出来。进步体现在回归集条数上,从 0 涨到 11,每一条都是一个被稳稳拿下、从此被保护起来的能力。

还有一个反直觉的地方:右边 v2 的能力集分数(20%)比 v1(30%)还低,但 v2 明明更强。因为过了的题毕业走了,换上来的都是新的难题。所以**能力集的分数不能跨版本直接比**,只要题目变了,分数就不是同一把尺子。跨版本比较要用回归集(固定的题)或者在同一批题上同时跑两个版本。这一点在 [Day 547](/blog/agent-zero/day-547-eval-stats-1/) 往后讲统计比较时还会用到。

</details>

**练习 2:退役不能自己批自己。** 正文的 `retire` 只要求有理由和确认人。加两条规则:确认人不能是用例的负责人;理由里必须出现一个需求号(`PRD-数字`)或事故号(`INC-数字`)。新建 `part10/ex544_retire.py` 实现 `retire_strict`,用一条回归用例试三次:负责人自己批、「老是挂,先删了」、带需求号的正当理由。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex544_retire.py
"""练习 2:退役不能自己批自己;退役理由要能对上一条需求变更。"""
import re

from part10.case_lifecycle import Case, LifecycleError, admit


def retire_strict(case: Case, reason: str, approved_by: str) -> None:
    if approved_by == case.owner:
        raise LifecycleError(f"{case.id}: 负责人 {case.owner} 不能自己批准退役")
    if not re.search(r"PRD-\d+|INC-\d+", reason):
        raise LifecycleError(f"{case.id}: 退役理由里要写需求号或事故号")
    case.move("retired", f"{reason}(确认人 {approved_by})")


if __name__ == "__main__":
    c = Case("T060", source="prd", owner="dev-li", requirement="PRD-15")
    admit(c, "regression", reviewer="cs-chen")
    tries = [
        ("老是挂,先删了", "dev-li"),
        ("老是挂,先删了", "pm-wang"),
        ("PRD-19 取消了发票合并功能", "pm-wang"),
    ]
    for reason, who in tries:
        try:
            retire_strict(c, reason, who)
            print("退役成功:", c.history[-1])
        except LifecycleError as e:
            print("拦住:", e)
```

<div class="line-notes">

- `from part10.case_lifecycle import Case, LifecycleError, admit` 复用正文的类和函数,只写一个更严的退役函数。
- `if approved_by == case.owner:` 第一条新规则。负责人最有动机删掉自己那条总挂的用例,所以不能自己批。
- `if not re.search(r"PRD-\d+|INC-\d+", reason):` 第二条新规则。`\d+` 是一个或多个数字,`|` 是「或」。理由里必须能追溯到一次需求变更或一次事故,「嫌它烦」不算理由。
- `case.move("retired", f"{reason}(确认人 {approved_by})")` 规则都过了才真正改状态,状态机本身的检查(只能从 capability 或 regression 退役)仍然生效。
- `admit(c, "regression", reviewer="cs-chen")` 直接进回归集,模拟一条已经稳定的老用例。
- `("老是挂,先删了", "dev-li"),` 负责人自己批,先被第一条规则拦。
- `("老是挂,先删了", "pm-wang"),` 换了确认人,理由仍然没有需求号,被第二条规则拦。
- `print("退役成功:", c.history[-1])` `history[-1]` 是最后一条历史,相当于 JS 的 `history.at(-1)`。

</div>

```bash
uv run python -m part10.ex544_retire
```

```text
拦住: T060: 负责人 dev-li 不能自己批准退役
拦住: T060: 退役理由里要写需求号或事故号
退役成功: regression → retired:PRD-19 取消了发票合并功能(确认人 pm-wang)
```

注意第二次:换了确认人,但理由还是「老是挂」,照样被拦。这条规则逼着人回答「这条用例为什么不该存在了」,而不是「它烦不烦」。规则也有绕过的办法(随便写个 PRD 号),所以它是兜底,不是替代评审;评审人看到「PRD-19」应该真的去点开 PRD-19 看一眼。

</details>

**练习 3:给六条用例分家。** 下面是 SupportPilot 评测集里的六条用例(简化描述)。对每条判断:进能力集还是回归集,或者应该退役;写一句理由。

1. 客户问「上个月的发票在哪下载」,期望回答下载路径。上线以来每个版本都 5/5 通过。
2. 客户一句话里同时要求退两张发票、改账单邮箱、开专票,期望三件事都处理。当前版本 1/5。
3. 上周线上事故:客户说「别退了」之后 Agent 仍然发起了退款。修复已合并,期望 Agent 取消退款流程。
4. 客户要求按月退年付的钱,期望「退 39 元」。上个月 PRD-12 改版,年付不再支持按月退款。
5. 用另一个模型批量生成的 200 条「客户骂人」用例,当前版本全部 5/5 通过,和真实工单里的骂人话差别很大。
6. 客户要求把退款打到另一个人的账户,期望 Agent 拒绝并转人工。当前版本 3/5。

<details><summary>参考答案</summary>

1. **回归集。** 已经稳定做到的基础功能,挂了就是事故。如果它现在还在能力集里,说明早该毕业了。
2. **能力集。** 典型的「希望做到但还没做到」,1/5 的起点通过率正是能力集该有的样子。负责人应该是做多意图处理的那位工程师。
3. **回归集,直接入。** 来自线上事故,修复已合并,修完以后它应该一直过。这就是生命周期图里「提议 → 回归集」那条直通的路。来源字段写 `incident`,需求号写事故号。
4. **改期望,不退役。** 产品行为变了,但「年付客户要求按月退款」这个场景还在,还会有客户这么问。期望答案改成「解释政策、不退款、给出转人工的选项」,由需求方(PRD-12 的产品经理)确认。只有整个场景不存在了才退役。
5. **砍掉大部分,留下几条。** 合成用例全过,说明它们测的多半是「模型能不能处理另一个模型想象的骂人」,不是真实情况。从真实工单里找 10 到 20 条真实的骂人话替换掉,原来的 200 条留几条做冒烟,其余带理由退役(理由写评审时的决定,比如「EVAL-REVIEW-3:合成用例与真实分布差异大」)。这也提醒你:来源字段要记,否则你根本不知道评测集里有多少是合成的。
6. **能力集,但要标高严重级别。** 3/5 说明还不稳,在能力集里给团队指方向;但它涉及资金安全,做到稳定之前,线上要有代码层面的兜底(收款账户和客户不一致就拒绝),不能只靠模型。这和 [Day 541](/blog/agent-zero/day-541-orch-2/) 的混合架构是一个思路:模型没做稳之前,规则明确的部分交给代码。

这道题没有标准答案,第 4、5 题在真实团队里都会有争论。判断的依据是今天的两张表:能力集测「还没做到」,回归集测「已经做到、不能坏」;产品变了先想改期望,场景没了才退役。

</details>

**验收标准**:`mixed_score.py` 和 `case_lifecycle.py` 的输出和正文一致;能解释 v1、v2 总分相同但不能合并的原因;能画出生命周期图并说出每条箭头的条件;练习 1 能说出「能力集分数不能跨版本直接比」的原因;练习 3 六条都有判断和理由。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 评测资产 | 用例、期望答案、判题器等评测用的东西,和代码一样是团队资产,会过时、要维护 |
| 能力集 capability suite | 测「希望做到但还没稳定做到」的用例,起点通过率偏低,用来衡量进步 |
| 回归集 regression suite | 测「已经做到的有没有被弄坏」的用例,通过率应接近 100%,挂了就是事故。回归的概念 [Day 344](/blog/agent-zero/day-344-eval-concepts/) 讲过 |
| 毕业 graduation | 能力用例连续几个版本都稳定通过后,移入回归集 |
| 饱和 saturation | 评测集大部分用例都过了,分数顶住不动,再有进步也看不出来 |
| 退役 retirement | 产品变了、场景不存在了,用例带着理由、经需求方确认后不再使用 |
| 生命周期 | 一条用例从提议、入库、能力集、毕业到退役的整个过程 |
| 状态机 | 一个东西在几种状态之间切换,哪些切换允许、要什么条件,写成一张表。前端的 XState 就是它 |
| 户口(用例元数据) | 用例的负责人、需求号、来源等字段,团队里是必填项 |
| 评测驱动开发 EDD | 先把要的能力写成评测,再去实现。[Day 344](/blog/agent-zero/day-344-eval-concepts/) 讲过 |
| default_factory | dataclass 里给列表、字典等可变字段设默认值的写法,每个对象各拿一份新的 |

## 常见误区

**只看一个总分。** 能力集和回归集混在一起,新功能变好和老功能变坏会互相抵消。今天实跑两个版本总分都是 77.5%,底下是学会 4 条、弄坏 4 条。至少分开出两个分数,门禁只看回归集。

**能力集的分数跨版本直接比。** 能力用例毕业走了,换上来的是新难题,分数会掉,但 Agent 其实更强了。题目变了,尺子就变了。跨版本比较用固定的回归集,或者在同一批题上同时跑两个版本。

**能力用例永远不毕业。** 能力集会饱和,分数顶在高位,进步看不出来;已经做到的能力也没被当成回归保护起来。

**回归用例挂了就降级回能力集。** 回归集挂了是 bug,要修 Agent。降级等于给它一个合法挂着的理由。

**用例挂了就删。** 总挂的用例要么说明 Agent 有问题,要么说明用例本身有问题,两种都要查清楚。退役要写理由,由需求方确认,不能负责人自己说了算。

**合成用例占大头。** 合成和红队用来补覆盖面。七成是合成的评测集,测的多半是模型想象出来的问题。来源字段要记,才知道比例。

**评测是一个人的事。** 一个人的时候最快;到了团队,用例的内容要来自离业务最近的人,期望答案让懂业务的人确认,否则人一走,评测就烂。

**dataclass 里写 `history: list = []`。** 实跑直接报 `ValueError: mutable default ... use default_factory`。改成 `field(default_factory=list)`。

## 学习资料

### 文档与文章

- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):2026 年 1 月发布,今天能力集和回归集、毕业、饱和、评测驱动开发、谁来贡献用例几个说法的出处。英文,重点读讲 capability 和 regression 的部分和最后讲组织的部分,约 40 分钟。
- [Hamel Husain、Shreya Shankar · LLM Evals FAQ](https://hamel.dev/blog/posts/evals-faq/):把课上被问最多的问题整理成问答,「谁来定标准」「要不要专门的评测团队」几条和今天直接相关,挑着读。
- [Eugene Yan · An LLM-as-Judge Won't Save The Product, Fixing Your Process Will](https://eugeneyan.com/writing/eval-process/):核心观点是评测首先是流程问题,工具只是辅助,和今天「评测烂掉原因不是技术」是一回事。约 20 分钟。
- [Shankar 等 · Who Validates the Validators?](https://arxiv.org/abs/2404.12272):论文发现人在给输出打分的过程中会改变自己的判断标准(criteria drift),这是「期望答案要由懂业务的人持续维护」的依据。读摘要和引言即可。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1BZY66hE8u&autoplay=0&high_quality=1" title="如何对 Agent 进行评估?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>西瓜讲大模型 · 如何对 Agent 进行评估? · 约 11 分钟,从头串一遍 Agent 评测的几层。看完想想:视频里讲的每一层,在团队里分别该由谁负责。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1aZpw6DEMg&autoplay=0&high_quality=1" title="手把手教你构建大模型评测集:从维度设计到自动化落地" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>天涯3615 · 手把手教你构建大模型评测集:从维度设计到自动化落地 · 38 分钟。讲评测集怎么建,今天只看讲数据来源和维护的部分,对照生命周期图的左半边。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1AoNx6ZEYH&autoplay=0&high_quality=1" title="面试官问:如何设计一套完整的Agent评估体系?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Agent开发实战 · 面试官问:如何设计一套完整的Agent评估体系? · 6 分钟,面试视角的评估体系概览。看完对照今天的内容,找找视频里缺了哪些「谁来负责」「用例怎么流转」的部分。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/XueTa4qrMpg" title="How Engineers and PMs should collaborate on Evals" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · How Engineers and PMs should collaborate on Evals · 34 分钟,讲工程师和产品经理在评测上怎么配合。英文,开字幕,和 Day 546 的分工表一起看效果更好。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 4 章「Evaluate AI Systems」:讲怎么为应用定义评估标准、搭评估流水线,其中设计评估流水线的部分和今天的生命周期互相补充。
- Ron Kohavi、Diane Tang、Ya Xu《Trustworthy Online Controlled Experiments》(Cambridge University Press,2020;中文版《关键迭代:可信赖的线上对照实验》):讲 A/B 测试,但「让数据驱动决策变成组织习惯」那几章的经验对评测完全适用。

### 开源项目与代码

- 你自己的 `part10/mixed_score.py` 和 `part10/case_lifecycle.py`:[Day 546](/blog/agent-zero/day-546-eval-process/) 会把状态和负责人变成 JSONL 里的字段,写一个在 CI 里检查它们的工具。
- [promptfoo](https://github.com/promptfoo/promptfoo):开源的评测工具,看它的配置文件怎么组织测试用例和断言,很多团队直接拿它当用例格式。

## 自测

1. 能力集和回归集分开的最大好处是什么?用今天实跑的数字说明。

<details><summary>答案</summary>

两种信号不会互相抵消。实跑里 v1、v2 总分都是 31/40 = 77.5%,拆开看 v2 的能力集从 25% 涨到 58.3%(学会 C04–C07),回归集从 100% 掉到 85.7%(弄坏 R05、R11、R17、R23)。只看总分会以为改动没效果,其实是一好一坏,回归那一半应该被 CI 拦下。

</details>

2. 什么情况下能力用例应该毕业?今天的规则为什么定得这么严?

<details><summary>答案</summary>

每个版本跑 5 遍,连续 3 个版本的通过率都不低于 95%(5 遍里就是全过)。严是因为回归集里挂一次就要有人去看,放进去的必须真稳:跑 5 遍防止一遍碰巧过,连续 3 个版本防止某一版的提示词碰巧对它友好。

</details>

3. 为什么状态机里不允许回归用例退回能力集?

<details><summary>答案</summary>

回归用例挂了说明一个已经做到的能力被弄坏了,这是 bug,要修 Agent。如果允许降级,它就有了一个合法挂着的理由,回归保护就失效了。

</details>

4. 练习 1 里,「毕业 + 补新题」那一列 v2 的能力集分数(20%)比 v1(30%)还低,能说明 v2 退步了吗?

<details><summary>答案</summary>

不能。v1 过了的 3 条已经毕业走了,换上来的是更难的新题,两个版本的能力集不是同一批题,分数不能直接比。v2 实际上更强,体现在回归集从 0 条涨到 3 条。跨版本比较要用固定的回归集,或在同一批题上同时跑两个版本。

</details>

5. 同事发现一条用例总是挂,想把它删掉。你会问哪些问题?

<details><summary>答案</summary>

它测的是哪条需求、谁负责?它挂是因为 Agent 真做不到,还是期望答案过时了、判题方式有问题?如果是 Agent 做不到,它应该在能力集还是回归集?如果产品行为改了,能不能改期望而不是退役,有没有需求方确认?删掉之后这个场景还有没有别的用例覆盖?都有答案之后,才决定修 Agent、改期望,还是带理由退役。

</details>

6. 面试题:「你们团队的评测是怎么维护的?」

<details><summary>答案</summary>

按生命周期讲,两分钟:用例主要来自线上事故复盘、需求评审(每条需求带至少一条用例)和错误分析,合成和红队只补覆盖面;进库前评审,期望答案让懂业务的人确认,必填负责人和需求号;分能力集和回归集两套分数,CI 门禁只看回归集;能力用例连续 3 个版本、每版 5 遍都稳定通过就毕业进回归集,防止饱和;产品改了先改期望,场景没了才退役,退役要写理由、由需求方确认。最后举一个具体例子,比如「总分没变但回归集掉了 4 条」被门禁拦下的那次。

</details>

## 明天预告

Day 545 · 第 78 周复习:进阶(Day 539–544)。这一周从四个持久化方案、编排取舍的三种立场和对比实验,走到设计文档、ADR 和今天的评测生命周期。明天把这六天串成一张知识地图,整理这周的错题和坑,再默写一段核心代码跑通。复习完的下一天([Day 546](/blog/agent-zero/day-546-eval-process/))接着今天讲评测在团队里怎么分工、怎么钉进流程。
