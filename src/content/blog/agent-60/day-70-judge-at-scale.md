---
title: 'Day 70 · 大规模 LLM 评审:校准、一致性、成本'
description: 'SupportPilot 每天三千张工单,想每天看一次回复质量,只能靠 LLM 评审。规模上来以后,Day 32 那套校准不够用了:校准集里差评样本太少、校正后的通过率自己也有误差、三个评审投票照样会一起犯错、评审模型一升级就悄悄变宽松。今天用模拟数据把这些问题一个个跑出来,写一个带区间的校正、投票分流和漂移报警模块,再算清楚评审的钱和人工各花多少。'
pubDate: 2026-10-12
regime: none
tags: ['eval', 'llm-as-judge', 'calibration', 'monitoring', 'senior', 'agent-60']
series: 'agent-60'
day: 70
lang: 'zh'
---

## 今天要解决的问题

Day 32 我们给 SupportPilot 做过一个 LLM 评审:只判一件事,只给 pass 或 fail,用人工标注对齐,算了 TPR、TNR 和 kappa,还用这两个率修正了评审报出来的通过率。那是在评测集上,几百条样本,一次性的。

现在换一个场景。SupportPilot 上线了,每天三千张工单。产品负责人想要一个每天更新的数字:「今天的回复里,有多少是合格的?」人工不可能每天看三千条,只能靠评审。

一旦评审从「评测集上的一次性工具」变成「线上每天跑的监控」,会冒出一串新问题:

1. 校准集要多大?Day 32 用的一两百条够吗?
2. 评审报了 70%,校正后是 64%,这个 64% 有多可靠?
3. 一个评审不放心,用三个投票,能好多少?
4. 换了评审模型的版本,或者有人改了评审 prompt,怎么知道它没有悄悄变松?
5. 每天评审花多少钱?人工复核又要花多少人力?

今天把这五个问题都算清楚。学完你应该能:

1. 根据想要的精度,倒推校准集的大小和构成,知道为什么差评样本要多采。
2. 给校正后的通过率算出置信区间,把校准集本身的误差也算进去。
3. 设计多评审投票和分流:一致的直接采信,不一致的送人工,并理解为什么投票救不了相关的错误。
4. 把评审当成有版本的产物管理,用金丝雀集做漂移监控和报警。
5. 估算线上评审的模型成本和人工成本,设计抽样方案把两者控制住。

预计用时 4 小时。前置:Day 32(评审校准)、Day 69(Wilson 区间和 bootstrap)。

## 先回顾一下 Day 32 留下的东西

Day 32 结束时,我们手里有一个对齐过的评审,以及三个数:

- TPR:人判 pass 的样本里,评审也判 pass 的比例。
- TNR:人判 fail 的样本里,评审也判 fail 的比例。
- kappa:扣除随机一致之后的一致程度。

还有一个修正公式(Rogan–Gladen 校正):如果评审在线上报出的通过率是 p_obs,真实通过率大概是

p_true = (p_obs + TNR − 1) / (TPR + TNR − 1)

直觉是这样的:评审有一部分真失败会误判成通过(1 − TNR),也会把一部分真通过误判成失败(1 − TPR),这个公式把这两种误判的影响反解回去。

这套东西在评测集上够用。线上的问题在于,每一个数都只是估计,而且估计的误差在规模化之后会被放大。

## 问题一:校准集里,差评太少

为了让数字可复现,我用代码模拟了这样一个场景:300 条人工标注的校准集,真实通过率 70%;三个不同的评审(可以想成三个不同厂商的模型),各自有不同的 TPR 和 TNR;另外有 15% 的样本特别难判,评审在这些样本上都倾向于判 pass,这是 Day 32 讲过的宽松偏差。跑出来是这样:

```text
judge-A: TPR 0.953 [0.916,0.974]  TNR 0.747 [0.647,0.827]  kappa 0.730
judge-B: TPR 0.930 [0.887,0.957]  TNR 0.805 [0.709,0.874]  kappa 0.739
judge-C: TPR 0.962 [0.928,0.981]  TNR 0.701 [0.598,0.787]  kappa 0.707
```

每个率后面的方括号是 Day 69 的 Wilson 区间。注意看 TPR 和 TNR 区间宽度的差别:TPR 的区间大约 ±3 个点,TNR 的区间大约 ±9 个点。

原因很简单。300 条里只有大约 90 条是人判 fail 的,TNR 是在这 90 条上算的;TPR 是在 210 条上算的。样本少,区间就宽。而在线上监控里,我们最关心的恰恰是 TNR:评审能不能把不合格的回复抓出来。TNR 估不准,校正公式的分母就不准,校正后的通过率跟着不准。

所以校准集不能按线上的自然比例随机抽。**差评样本要多采**,让 pass 和 fail 两边的样本数接近。做法是分层抽样:先用评审或者简单规则把候选样本粗分成「可能 pass」和「可能 fail」两堆,从「可能 fail」那堆多抽一些,再交给专家标注。算 TPR、TNR 时各算各的,不受比例影响。

那每边要多少条?用 Wilson 区间倒推。如果希望 TNR 的 95% 区间半宽在 ±5 个点以内,TNR 在 0.8 附近时大约要 250 条 fail 样本(粗算:1.96 × √(0.8 × 0.2 / 250) ≈ 0.05)。考虑到 pass 那边也要类似的数量,校准集一般要 400 到 500 条,远多于 Day 32 那一两百条。这是专家好几天的工作量,所以要提前排进计划。

## 问题二:校正后的通过率,也要带区间

接着模拟线上:2000 条工单只有评审结果,没有人工标注。真实通过率是 62.8%(这个数线上是看不到的,模拟里我知道)。

```text
prod observed pass 0.701  (true 0.628)
corrected 0.639  95% CI [0.571, 0.697]
```

评审报的是 70.1%,比真实值高了 7 个点。这就是宽松偏差在线上的样子:如果直接把评审的数字报给产品负责人,你会系统性地高估质量。

用 judge-A 在校准集上的 TPR 和 TNR 校正之后是 63.9%,离真实值只差 1 个点。但更重要的是后面那个区间:57.1% 到 69.7%,宽达 12 个点。

这个区间是怎么来的?校正后的通过率有两个不确定性来源:

1. 线上样本本身的抽样误差(2000 条,比较小)。
2. 校准集上 TPR、TNR 的估计误差(TNR 只有 90 条,很大)。

第二个通常是大头。很多团队只报校正后的点估计,不报区间,等于假装校准集是完美的。我的做法是用 bootstrap 把两个来源都算进去:每一轮同时重抽线上样本和校准集,重新估计 TPR、TNR,再做校正,重复几千次取分位数。

```python
def corrected_rate_ci(judge_prod, human_cal, judge_cal, n_boot=4000, seed=0):
    rng = np.random.default_rng(seed)
    jp = np.asarray(judge_prod)
    hc, jc = np.asarray(human_cal), np.asarray(judge_cal)
    point = corrected_rate(jp.mean(), *_rates(hc, jc))
    out = []
    for _ in range(n_boot):
        p = jp[rng.integers(0, len(jp), len(jp))].mean()
        i = rng.integers(0, len(hc), len(hc))
        tpr, tnr = _rates(hc[i], jc[i])
        if tpr + tnr - 1 > 0.05:
            out.append(corrected_rate(p, tpr, tnr))
    lo, hi = np.percentile(out, [2.5, 97.5])
    return point, (float(lo), float(hi))
```

`tpr + tnr - 1 > 0.05` 那个判断是防御性的:如果某一轮重抽出来的评审「接近瞎猜」,校正公式分母接近零,结果会飞出去,直接丢掉这一轮。

12 个点宽的区间意味着什么?意味着你没法用这个数字去看「今天比昨天好了 2 个点」。日报上应该展示的是区间,或者至少是周趋势。想把区间压窄,最有效的办法是扩大校准集里的 fail 样本,而不是扩大线上采样量。这个结论用今天的代码换几个参数就能自己验证。

还有一个前提要记住:校正公式假设评审在校准集和线上的表现一样。如果线上来了一类校准集里没有的新工单(比如新上线了一个产品),评审在这类工单上的 TPR、TNR 可能完全不同,校正就失效了。所以校准集要定期从线上补新样本,这一点在后面的流程图里会出现。

## 问题三:三个评审投票,能好多少?

一个评审不够可靠,自然的想法是多找几个投票。Cohere 的研究人员 2024 年有篇论文《Replacing Judges with Juries》专门研究过:用几个不同家族的小模型组成评审团(他们叫 PoLL),效果可以比单个大模型评审更好,成本还更低。

在模拟数据上试一下多数投票:

```text
majority: TPR 0.986  TNR 0.816  kappa 0.839  split 57 (19%)
unanimous only (243): TPR 1.000  TNR 0.817  kappa 0.870
```

kappa 从单个评审的 0.71 到 0.74 提升到了 0.84,确实有用。但细看 TNR:单个评审最好的是 0.805,投票之后只有 0.816,几乎没变。

原因在于我模拟时设置的那 15% 难样本:三个评审在这些样本上都倾向于判 pass。错误是相关的,三个评审一起错,投票就投不掉。投票能消掉的只有各自独立的随机错误。

这件事在真实世界里很常见。三个评审如果用的是同一家的模型、同一个 prompt,它们的盲点几乎一样;即使换了厂商,很多模型在「回复写得礼貌、长、看起来专业」时都会倾向于给高分(冗长偏差)。要让投票真正有用,评审之间要尽量不同:不同厂商、不同 prompt 写法、甚至不同的判断角度(一个看政策是否正确,一个看有没有编造)。

投票更大的价值其实在另一个地方:**找出需要人看的样本**。三个评审意见不一致的那 19% 样本,恰恰是最难判的。把它们送给人工,三个评审一致的那 81% 直接采信。在一致的那部分上,kappa 达到了 0.87。

这就引出了线上评审的基本结构:

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="线上评审流水线:抽样、评审团、一致采信、不一致送人工、回流校准集">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="40" width="96" height="44" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="26" y="60" fill="var(--ink)">线上工单</text>
<text x="26" y="76" fill="var(--ink-faint)">3000/天</text>
<line x1="112" y1="62" x2="140" y2="62" stroke="var(--rule)"/>
<rect x="140" y="40" width="104" height="44" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="150" y="60" fill="var(--ink)">分层抽样</text>
<text x="150" y="76" fill="var(--ink-faint)">按类别/风险</text>
<line x1="244" y1="62" x2="272" y2="62" stroke="var(--rule)"/>
<rect x="272" y="30" width="120" height="64" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="284" y="52" fill="var(--ink)">评审团</text>
<text x="284" y="70" fill="var(--ink-faint)">3 个不同家族</text>
<text x="284" y="86" fill="var(--ink-faint)">可以弃权</text>
<line x1="392" y1="52" x2="430" y2="40" stroke="var(--mem)"/>
<line x1="392" y1="74" x2="430" y2="110" stroke="var(--compute)"/>
<rect x="430" y="18" width="190" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="442" y="38" fill="var(--ink)">一致 81%:直接采信</text>
<text x="442" y="54" fill="var(--ink-faint)">→ 校正 → 日报(带区间)</text>
<rect x="430" y="88" width="190" height="44" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="442" y="108" fill="var(--ink)">不一致 19%:送人工</text>
<text x="442" y="124" fill="var(--ink-faint)">专家标注</text>
<line x1="525" y1="132" x2="525" y2="180" stroke="var(--compute)"/>
<rect x="400" y="180" width="220" height="44" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="412" y="200" fill="var(--ink)">校准集(定期补新样本)</text>
<text x="412" y="216" fill="var(--ink-faint)">差评样本过采样</text>
<line x1="400" y1="202" x2="300" y2="202" stroke="var(--rule)"/>
<rect x="140" y="180" width="160" height="44" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="152" y="200" fill="var(--ink)">金丝雀集(冻结)</text>
<text x="152" y="216" fill="var(--ink-faint)">每周 / 每次升级重跑</text>
<line x1="220" y1="180" x2="300" y2="94" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="16" y="262" fill="var(--ink-soft)">实线是每天的数据流,虚线是漂移检查:评审团在金丝雀集上的 TPR/TNR</text>
<text x="16" y="282" fill="var(--ink-soft)">和基线比,显著下降就报警,停用新版本。</text>
</g>
</svg>
<figcaption>线上评审的整体结构。评审团一致的样本直接采信,不一致的送人工,人工标注又回流进校准集。金丝雀集是冻结的,专门用来发现评审自己变了。</figcaption>
</figure>

图里还有一个细节:评审可以弃权。Anthropic 在 2026 年 1 月的《Demystifying evals for AI agents》里建议给 LLM 评审一个「Unknown」选项,减少它在信息不足时硬编一个判断。弃权的样本和不一致的样本一样,送人工。实践中弃权率在 5% 左右比较正常;如果某一类工单弃权率突然变高,往往说明来了一种新问题,值得去看。

## 问题四:评审自己也会变

评审不是一个固定不变的东西。下面任何一件事都会改变它的行为:

- 评审模型的厂商发了新版本,或者你换了一个更便宜的模型。
- 有人「优化」了评审 prompt,比如加了几个例子。
- 你调用的是模型别名(比如不带日期的模型名),厂商把别名指向了新的快照。
- 评审的上下文变了,比如 Agent 的回复格式改了,评审看到的输入跟着变了。

所以评审要当成一个有版本的产物来管理:模型名、模型版本(如果厂商提供)、prompt、参数,一起打一个版本号,和评测结果一起存。任何一项变了,版本号就要变。

光有版本号还不够,你需要知道新版本是不是变差了。做法是维护一个**金丝雀集**:从校准集里拿出一部分(比如 300 条,pass 和 fail 各一半),人工标注之后冻结,永远不用来调评审 prompt。每周重跑一次,每次换评审版本前也跑一次,和基线比 TPR、TNR。

模拟一下:换了一个新版本的评审,它的 TNR 实际降到了 0.62(变得更宽松了):

```text
new judge TNR 0.621 [0.516,0.715]
drift alerts: ['tnr 从 0.75 掉到 0.62(95% 区间上限 0.72 也低于基线)']
```

报警规则有两个条件:下降超过 5 个点,而且新版本区间的上限也低于基线。只用第一个条件会误报很多,因为 90 条 fail 样本上的 TNR 本身就会抖动好几个点;加上第二个条件,报出来的基本都是真的变了。代价是小幅度的漂移可能抓不到,想抓更小的漂移,还是要扩大金丝雀集里的 fail 样本。

我第一次写这个模拟时,金丝雀集只用了 120 条,结果真的变差了也没报警,原因就是区间太宽。这个「失败」的版本反而是今天最有用的教训:监控有没有用,取决于它的统计功效,和 Day 69 讲的是同一件事。

除了金丝雀集,还有两个便宜的线上信号可以一起看:

- 评审在线上的通过率分布。如果评审版本没变、Agent 版本也没变,通过率却突然跳了几个点,要么是线上流量变了,要么是评审背后的模型被厂商动过。
- 人工复核的不一致率。每天送人工的那批样本,专家标注后可以反过来算评审在这批样本上的准确率。它们是最难的样本,准确率本来就低,但趋势有意义。

## 问题五:钱和人

最后算账。线上评审有两块成本:模型调用的钱,和人工复核的时间。很多团队只算第一块,第二块才是大头。

先算模型的钱。假设:

- 每天 3000 张工单,按类别和风险分层抽 20%,也就是 600 张。
- 评审团 3 个评审,每张工单 3 次调用,一共 1800 次。
- 每次评审的输入大约 2500 token(工单、对话、检索到的知识库片段、评审 prompt),输出大约 200 token(判断加简短理由)。
- 价格用 Day 38 查到的 DeepSeek 官方价格(2026 年 10 月,美元每百万 token):`deepseek-flash` 输入 0.30、输出 1.20;`deepseek-v4-pro` 输入 1.32、输出 3.96。

全用 `deepseek-flash`:每次 2500 × 0.30 + 200 × 1.20 = 990 每百万,也就是 $0.00099;1800 次是每天约 $1.8。全用 `deepseek-v4-pro`:每次 2500 × 1.32 + 200 × 3.96 = 4092 每百万,即 $0.0041;每天约 $7.4。实际评审团里会混用不同厂商的模型,价格在这两者之间浮动。一个月下来几十到两百美元,不算多。

再算人工。600 张里有 19% 评审意见不一致,再加 5% 弃权,大约 144 张要人看。一个熟练的客服主管看一张(读对话、查知识库、下判断)大概要 1 分钟,一天就是两个多小时。这比模型的钱贵得多,而且专家的时间很难买到。

所以降成本的重点在人工这一侧:

- 抽样比例按风险调。退款、投诉类工单风险高,抽 50%;查询类风险低,抽 5%。总量下来了,高风险的覆盖率反而上去了。
- 提高评审之间的一致率。不一致率从 19% 降到 10%,人工量直接减半。办法是让每个评审只判一件事(Day 32 的原则),把判断标准写得更具体,用不一致的样本反过来改评审 prompt。
- 人工复核的结果一定要回流成校准数据。这些都是最难的样本,对校准最有价值。不回流的话,专家的两个小时就只换来了当天的一个数字。

Day 79 会讲另一条路:用积累下来的人工标注,蒸馏出一个专门做评审的小模型,把评审本身的模型成本再降一个数量级。

### 人工这一侧也要校准:多人标注和工具

上面算的「一天两个多小时」默认只有一个客服主管在看。量再大一点,就得两三个人一起标,这时候出现一个 Day 32 只顺带提过的问题:人和人之间也不一致。评审 TPR、TNR 是拿人工标注当标准答案算出来的,如果两个标注员对同一批样本只有 0.5 的 kappa,那「标准答案」本身就晃,评审校准得再好也没有意义。

我的做法分三步。先从复核队列里抽 40 条,两个人**各自独立**标完再讨论,算两人之间的 kappa,直接用前面模块里那个 kappa 公式,把两个人的标签当成两列就行。低于 0.6 不急着开工,把分歧的样本拿出来逐条过,多半会发现是判断标准没写清楚,比如「退款金额说对了但没提审批时效,算不算 pass」。把结论写进标注指南,指南加版本号,再标一轮,直到两人 kappa 稳定在 0.7 以上。第二,日常分工时留 10% 的样本两个人都标,持续监控人和人的一致性,掉下去了说明有人对指南理解变了,或者新出现了指南没覆盖的情况。第三,分歧要有一个人拍板:Hamel 在 [evals FAQ](https://hamel.dev/blog/posts/evals-faq/) 里把这个角色叫 benevolent dictator,一般是最懂业务的那位,拍板时写一句理由,理由回流进指南。

工具上不用一开始就上平台。Day 30 那个几十行的 Streamlit 标注页,加一个「标注人」下拉框和一个「指南版本」字段,就够两三个人用。人多了、要分配任务和看进度,再换现成的:Day 34 接的 Langfuse 有 [Annotation Queues](https://langfuse.com/docs/evaluation/evaluation-methods/annotation-queues),可以把 trace 批量放进队列、指定评分维度和标注人,还能在 Score Analytics 里看人工分和 LLM 评审分的一致程度;LangSmith 有同名功能;通用的标注平台可以看 [Label Studio](https://labelstud.io/) 或 [Argilla](https://github.com/argilla-io/argilla)。不管用哪个,导出的标注里一定要带标注人和指南版本,不然半年后你没法解释为什么某个月的校准集 TNR 突然变了。

## 把它们放进一个模块

上面的东西整理成 `agentops/evals/judge_monitor.py`,依赖 Day 69 的 `stats.py`:

```python
# agentops/evals/judge_monitor.py
"""规模化使用 LLM 评审时的几件事:一致性、校正后的通过率(带区间)、多评审投票、漂移监控。"""
from __future__ import annotations

import numpy as np

from agentops.evals.stats import wilson_ci


def confusion(human: list[int], judge: list[int]) -> dict[str, int]:
    tp = sum(1 for h, j in zip(human, judge) if h == 1 and j == 1)
    tn = sum(1 for h, j in zip(human, judge) if h == 0 and j == 0)
    fp = sum(1 for h, j in zip(human, judge) if h == 0 and j == 1)
    fn = sum(1 for h, j in zip(human, judge) if h == 1 and j == 0)
    return {"tp": tp, "tn": tn, "fp": fp, "fn": fn}


def agreement(human: list[int], judge: list[int]) -> dict:
    """TPR、TNR(带 Wilson 区间)和 Cohen κ。"""
    c = confusion(human, judge)
    n = len(human)
    po = (c["tp"] + c["tn"]) / n
    p_h, p_j = sum(human) / n, sum(judge) / n
    pe = p_h * p_j + (1 - p_h) * (1 - p_j)
    kappa = (po - pe) / (1 - pe) if pe < 1 else 1.0
    pos, neg = c["tp"] + c["fn"], c["tn"] + c["fp"]
    return {
        "tpr": c["tp"] / pos, "tpr_ci": wilson_ci(c["tp"], pos),
        "tnr": c["tn"] / neg, "tnr_ci": wilson_ci(c["tn"], neg),
        "kappa": kappa, **c,
    }


def corrected_rate(observed: float, tpr: float, tnr: float) -> float:
    """Rogan–Gladen 校正:评审报 observed 的通过率,真实通过率大概是多少。"""
    denom = tpr + tnr - 1
    if denom <= 0:
        raise ValueError("评审比瞎猜还差,校正没意义")
    return float(np.clip((observed + tnr - 1) / denom, 0, 1))


def corrected_rate_ci(judge_prod, human_cal, judge_cal, n_boot: int = 4000, seed: int = 0):
    """校正后的通过率 + bootstrap 区间。线上样本和校准集的误差都算进去。"""
    rng = np.random.default_rng(seed)
    jp = np.asarray(judge_prod)
    hc, jc = np.asarray(human_cal), np.asarray(judge_cal)
    point = corrected_rate(jp.mean(), *_rates(hc, jc))
    out = []
    for _ in range(n_boot):
        p = jp[rng.integers(0, len(jp), len(jp))].mean()
        i = rng.integers(0, len(hc), len(hc))
        tpr, tnr = _rates(hc[i], jc[i])
        if tpr + tnr - 1 > 0.05:
            out.append(corrected_rate(p, tpr, tnr))
    lo, hi = np.percentile(out, [2.5, 97.5])
    return point, (float(lo), float(hi))


def _rates(h: np.ndarray, j: np.ndarray) -> tuple[float, float]:
    tpr = ((h == 1) & (j == 1)).sum() / max((h == 1).sum(), 1)
    tnr = ((h == 0) & (j == 0)).sum() / max((h == 0).sum(), 1)
    return float(tpr), float(tnr)


def panel_vote(votes: list[list[int]]) -> tuple[list[int], list[int]]:
    """多个评审投票。返回(多数票结果, 意见不一致的样本下标)。不一致的送人工。"""
    arr = np.asarray(votes)            # 形状:评审数 × 样本数
    major = (arr.mean(axis=0) > 0.5).astype(int)
    split = [i for i in range(arr.shape[1]) if 0 < arr[:, i].sum() < arr.shape[0]]
    return list(major), split


def drift_check(base: dict, now: dict, max_drop: float = 0.05) -> list[str]:
    """拿金丝雀集(冻结的人工标注)的本周结果和基线比,TPR/TNR 掉太多就报警。"""
    alerts = []
    for m in ("tpr", "tnr"):
        drop = base[m] - now[m]
        lo, hi = now[f"{m}_ci"]
        if drop > max_drop and hi < base[m]:
            alerts.append(f"{m} 从 {base[m]:.2f} 掉到 {now[m]:.2f}(95% 区间上限 {hi:.2f} 也低于基线)")
    return alerts
```

模拟数据的脚本也放进仓库(`data/judge_demo.py`),今天文中所有数字都是它跑出来的。真实使用时,`human` 来自专家标注,三个 `judge` 来自三次真实的评审调用,其余代码不变。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="单个评审与多数投票的 TPR、TNR 对比">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink-soft)">TPR(蓝)和 TNR(琥珀),300 条校准集</text>
<line x1="20" y1="190" x2="620" y2="190" stroke="var(--rule)"/>
<g>
<rect x="50" y="48" width="30" height="142" fill="var(--mem)"/><rect x="84" y="78" width="30" height="112" fill="var(--compute)"/>
<text x="54" y="208" fill="var(--ink)">评审 A</text>
<rect x="190" y="51" width="30" height="139" fill="var(--mem)"/><rect x="224" y="70" width="30" height="120" fill="var(--compute)"/>
<text x="194" y="208" fill="var(--ink)">评审 B</text>
<rect x="330" y="46" width="30" height="144" fill="var(--mem)"/><rect x="364" y="85" width="30" height="105" fill="var(--compute)"/>
<text x="334" y="208" fill="var(--ink)">评审 C</text>
<rect x="470" y="42" width="30" height="148" fill="var(--mem)"/><rect x="504" y="68" width="30" height="122" fill="var(--compute)"/>
<text x="470" y="208" fill="var(--ink)">多数投票</text>
<text x="504" y="62" fill="var(--ink)">0.82</text>
<text x="84" y="72" fill="var(--ink)">0.75</text>
<text x="224" y="64" fill="var(--ink)">0.81</text>
<text x="364" y="79" fill="var(--ink)">0.70</text>
</g>
</g>
</svg>
<figcaption>多数投票把 TPR 推到了 0.99,TNR 却只从最好的 0.81 涨到 0.82。三个评审在难样本上一起宽松,投票投不掉相关的错误。</figcaption>
</figure>

## 动手练习

1. 把 `judge_monitor.py` 和 `data/judge_demo.py` 放进 AgentOps 仓库,跑一遍,确认输出和文中一致。然后改两个参数各跑一次:把 15% 的难样本比例改成 0,看投票后的 TNR 变化;把校准集改成 pass、fail 各 250 条,看校正后通过率的区间变窄多少。
2. 给 SupportPilot 搭一个真实的三评审团:三个不同厂商或者不同 prompt 写法的评审,同一个判断问题(比如「回复里的退款政策描述是否正确」),允许输出 `unknown`。在 Day 32 的校准数据上算每个评审和多数投票的 TPR、TNR、kappa、不一致率、弃权率。
3. 从校准集里冻结 200 条以上(pass、fail 各半)作为金丝雀集。故意改坏评审 prompt(比如去掉判断标准里关于「不得承诺具体到账时间」的那一条),重跑金丝雀集,看 `drift_check` 能不能报警。
4. 写一份「SupportPilot 线上评审方案」,包括:分层抽样比例表、评审团构成、一致/不一致/弃权的处理、每日模型成本和人工工作量的估算(给出算式)、金丝雀集的维护规则。

**验收标准**:模拟实验的两个对照结论有数字支撑;真实评审团有完整的一致性表格;改坏的评审能被金丝雀集抓到(抓不到的话,说明原因并估算需要多大的金丝雀集);方案里成本估算有算式。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 校准集 | 有人工标注、用来估计评审 TPR/TNR 的样本集,会定期补新样本 |
| 金丝雀集 | 从校准集里冻结的一部分,不参与调评审,专门检测评审是否变化 |
| 过采样 | 故意多抽少数类(这里是差评)样本,让两类样本数接近 |
| Rogan–Gladen 校正 | 用评审的 TPR、TNR 把观察到的通过率反推回真实通过率的公式 |
| 评审团 | 多个评审对同一样本投票,也叫 jury 或 panel |
| 相关错误 | 多个评审在同一批样本上一起出错,投票无法消除 |
| 弃权 | 允许评审在信息不足时输出 unknown,送人工处理 |
| 评审漂移 | 评审因模型、prompt 或输入变化导致判断标准悄悄改变 |
| 标注员间一致性 | 两个或多个人工标注员独立标同一批样本的一致程度,常用 kappa 衡量 |
| 标注指南 | 写明每个判断标准和边界例子的文档,带版本号,分歧的结论要写回去 |

## 常见误区

**校准集按线上比例随机抽就行。** 线上差评少,按比例抽的话 TNR 只能在几十条样本上估计,区间非常宽。差评要过采样。

**校正后的通过率就是真相。** 校正后的数也有误差,而且主要来自校准集。报告要带区间,日报上不要比较一两个点的日间变化。

**多找几个评审投票就可靠了。** 投票只能消除独立的错误。同家族模型、同样的 prompt,盲点一样。评审要尽量多样,投票的主要价值是找出需要人看的样本。

**评审调好了就不用管了。** 模型升级、prompt 改动、输入格式变化都会改变评审。要有版本号和金丝雀集。

**线上评审的成本主要是模型调用。** 模型调用每天几美元,人工复核每天几小时。优化重点在降低不一致率和按风险抽样。

**人工标注就是标准答案,不用检查。** 两个标注员之间的 kappa 可能只有 0.5。人和人都对不齐的时候,先改标注指南,再谈评审校准。

**人工复核完就结束了。** 复核结果不回流进校准集,专家的时间就只换来了当天一个数。

## 学习资料

### 文档与文章

- [Zheng 等 · Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena](https://arxiv.org/abs/2306.05685):LLM 评审的奠基论文,系统讨论了位置偏差、冗长偏差、自我偏好,读第 3 节约 40 分钟。
- [Verga 等 · Replacing Judges with Juries](https://arxiv.org/abs/2404.18796):用多个不同家族小模型组成评审团(PoLL)的研究,今天评审团设计的出处,读摘要和实验部分。
- [Hamel Husain · LLM Evals FAQ](https://hamel.dev/blog/posts/evals-faq/):看「How many people should annotate my LLM outputs?」和「Should I outsource annotation」两条,讲单人拍板和多人标注时怎么用 kappa,15 分钟。
- [Langfuse Annotation Queues](https://langfuse.com/docs/evaluation/evaluation-methods/annotation-queues):把 trace 放进人工标注队列、看人工分和评审分的一致程度,10 分钟。
- [Thakur 等 · Judging the Judges](https://arxiv.org/abs/2406.12624):比较了很多评审模型和人工的一致程度,指出只看百分比一致率会误导,应该看 kappa 这类指标,读结论。
- [Eugene Yan · Evaluating the Effectiveness of LLM-Evaluators](https://eugeneyan.com/writing/llm-evaluators/):把几十篇关于 LLM 评审的论文整理成实用结论,长文,挑「How to use LLM-evaluators」读,约 40 分钟。
- [Hamel Husain · Using LLM-as-a-Judge For Evaluation: A Complete Guide](https://hamel.dev/blog/posts/llm-judge/):从实践角度讲怎么让领域专家参与、怎么迭代评审 prompt,约 30 分钟。
- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):讲到给评审「Unknown」选项和定期读 transcript,读评审(graders)相关部分。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1L14y127ye&autoplay=0&high_quality=1" title="【10分钟论文】使用LLM作为裁判 Judging LLM-as-a-judge with MT-Bench and Chatbot Arena" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>ranchlai ·【10分钟论文】使用LLM作为裁判 Judging LLM-as-a-judge with MT-Bench and Chatbot Arena · 11 分钟,中文讲解今天第一篇论文,先看视频再读原文。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1rAbp66Eyi&autoplay=0&high_quality=1" title="怎样设计LLM-as-Judge才能让评分可信" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>酌沧 · 怎样设计LLM-as-Judge才能让评分可信 · 7 分钟,讲评分设计和可信度,和今天的校准、投票两节对照着看。</figcaption>
</figure>

- 古希腊掌管代码的神 ·【MT-Bench 实测】LLM-as-Judge 的四大偏差:位置/冗长/自我偏好/风格(BV1f13R6JEfP):4 分钟,偏差的实测演示,复习 Day 32 用。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/X4dEHRzBLmc" title="Judge the Judge: Building LLM Evaluators That Actually Work with GEPA — Mahmoud Mabrouk, Agenta AI" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · Judge the Judge: Building LLM Evaluators That Actually Work with GEPA · 41 分钟,讲怎么用人工标注系统地优化评审 prompt,和今天「不一致样本回流」的思路一致。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/GL0XhAj5LPE" title="LLM Evals: Common Mistakes" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · LLM Evals: Common Mistakes · 28 分钟,很多错误和评审有关,比如用 1 到 5 分打分、不和人工对齐。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 3 章「AI as a Judge」一节:系统讲 AI 评审的原理、局限和成本,今天是它的规模化延伸,约 1 小时。
- Shreya Shankar、Hamel Husain《Evals for AI Engineers》(O'Reilly,2026 年 10 月):全书按「分析、度量、生产与改进」组织,第三部分讲自动评审,第四部分讲生产监控和成本,和今天最相关。出版时间很新,如果你看到的还是预览版,以最终版目录为准。

### 开源项目与代码

- 今天的 `agentops/evals/judge_monitor.py` 和 `data/judge_demo.py`。
- [Langfuse 评测文档](https://langfuse.com/docs/evaluation/overview):Day 34 接入过 Langfuse,它支持在线上 trace 上跑 LLM 评审并记录分数,可以把今天的评审团接上去,分数写回 trace。

## 自测

1. 校准集 300 条、真实通过率 70%,为什么 TNR 的区间比 TPR 宽得多?怎么改?

<details><summary>答案</summary>

TNR 只在人判 fail 的约 90 条上算,TPR 在约 210 条上算,样本少区间就宽。改法是分层抽样、差评过采样,让 pass 和 fail 两边样本数接近。想让 TNR 区间半宽在 ±5 个点左右,fail 样本大约要 250 条。

</details>

2. 评审报 70%,校正后是 64%,区间 57% 到 70%。产品负责人问「昨天 63%、今天 66%,是不是变好了?」你怎么答?

<details><summary>答案</summary>

不能这么比。每天的校正值区间宽达十几个点,而且主要误差来自校准集,两天之间 3 个点的差异完全在噪声范围内。应该看周趋势或更长时间的变化,或者把区间画出来。想看更细的变化,需要扩大校准集里的 fail 样本,而不是扩大线上采样。

</details>

3. 三个评审多数投票之后,kappa 提高了,TNR 却几乎没变。为什么?

<details><summary>答案</summary>

三个评审在一批难样本上有相关的错误(都倾向于判 pass),投票只能消除独立的错误,相关的错误投不掉,所以抓不合格回复的能力(TNR)没变。kappa 的提升主要来自独立错误被消除。要改善,评审之间要更多样(不同厂商、不同 prompt、不同判断角度)。

</details>

4. 什么是金丝雀集?它和校准集有什么区别?

<details><summary>答案</summary>

金丝雀集是从校准集里冻结的一部分人工标注样本,永远不用来调评审 prompt,专门用来检测评审本身有没有变化:每周、每次升级都重跑,和基线比 TPR/TNR。校准集会不断补新样本,用于估计当前评审的误差和做校正;金丝雀集要保持不变,才能做前后比较。

</details>

5. 资深面试题:公司要求每天对全部线上对话做质量评审,预算有限。你怎么设计?

<details><summary>答案</summary>

先澄清目标:是要一个质量趋势数字,还是要找出每一条有问题的对话?前者用抽样就够,后者才需要全量。设计上:按风险分层抽样(高风险类别高比例,低风险低比例);评审团由两三个不同家族的便宜模型组成,每个只判一件事,允许弃权;一致的直接采信,不一致和弃权的送人工;用分层过采样的校准集估计 TPR/TNR,做校正并报区间;金丝雀集做漂移监控;人工复核结果回流校准集。成本上算清楚模型调用和人工两块,人工通常是大头,通过降低不一致率和风险分层控制。长期用积累的标注蒸馏一个专用评审小模型。最后说明这套方案能检测的最小质量变化有多大。

</details>

6. 你把评审模型从一个版本升级到更新的版本,线上评审通过率从 68% 涨到 74%。Agent 没有改动。可能是什么原因?怎么确认?

<details><summary>答案</summary>

最可能是新版本评审变宽松了(TNR 下降),也可能是线上流量结构变化恰好同时发生。确认方法:在金丝雀集上同时跑新旧两个版本,比较 TPR、TNR 和区间;如果 TNR 显著下降,就是评审的问题,不能直接切换,要么调新版本的 prompt 重新校准,要么继续用旧版本。同时检查线上工单类别分布有没有变化。

</details>

7. 你有两个客服主管做人工复核,他们在同一批 40 条上 kappa 只有 0.52。接下来先做什么?

<details><summary>答案</summary>

先不动评审,先对齐人。把两人分歧的样本逐条过一遍,找出是哪条判断标准没写清楚,写进标注指南并升版本号,再各自独立标一轮,直到 kappa 稳定在 0.7 以上。日常留一小部分样本双人标注持续监控,分歧由最懂业务的人拍板并写理由。人工标签本身不稳,用它算出来的评审 TPR、TNR 也不可信。

</details>

## 明天预告

Day 71 讲线上评测:A/B 实验、灰度、隐式反馈。今天的评审能告诉你「回复质量大概是多少」,但离线分数再好看,也不能直接证明新版本在线上更好。明天会写一个按客户稳定分流的实验框架,检查分流有没有出错,用转人工率和成本做主指标和护栏,并用模拟数据演示「每天看一次结果」会把假阳性率从 5% 推高到 20% 以上。
