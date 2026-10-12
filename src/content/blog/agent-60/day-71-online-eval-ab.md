---
title: 'Day 71 · 线上评测:A/B 实验、灰度、隐式反馈'
description: '离线评测说新 prompt 更好,线上就一定更好吗?不一定。今天给 AgentOps 写一个最小可用的实验框架:按客户稳定分流、SRM 检查、用 delta 方法算按客户聚合的比率指标、一个主指标加护栏的决策规则。再用模拟数据跑出三个教训:转人工率降了 3 个点但成本涨了 16% 时该不该上线;按会话算方差会把标准误低估一半;每天偷看一次结果,假阳性率从 5% 变成 22%。'
pubDate: 2026-10-12
regime: none
tags: ['eval', 'ab-testing', 'experimentation', 'canary-release', 'senior', 'agent-60']
series: 'agent-60'
day: 71
lang: 'zh'
---

## 今天要解决的问题

前三天我们一直在离线评测上做功夫:评测集怎么维护、分数怎么算区间、评审怎么校准。但离线评测有个天花板:它回答的是「在我们准备好的这些题上,新版本表现如何」,而老板真正关心的是「换上新版本之后,线上的客户体验和成本变好了没有」。

这两个问题的答案经常不一致。我见过的几种情况:

- 离线评测集是去年的工单,今年产品加了新功能,客户问的问题已经变了。
- 新版本回复更详细,评审打分更高,但客户读得更累,反而更多人点了「转人工」。
- 新版本多调了一次检索工具,质量好了一点,P95 延迟从 4 秒涨到 7 秒,客户在等待中关掉了窗口。
- 评审只看单轮回复,线上是多轮对话,新版本在第二轮开始绕圈子。

所以资深工程师对任何重要改动的态度是:离线评测是上线的门票,线上实验才是结论。今天学完你应该能:

1. 说清楚 Agent 线上实验的五个设计要素:分流单位、主指标、护栏指标、样本量与时长、停止规则。
2. 实现一个按客户稳定分流的分配函数,知道为什么不能按会话或按请求分流。
3. 用 SRM 检查发现分流和埋点的 bug。
4. 用 delta 方法分析按客户聚合的比率指标,说出为什么按会话算方差会低估。
5. 写一个「主指标 + 护栏」的决策函数,并解释为什么每天偷看结果会制造假阳性。
6. 设计一个灰度发布的放量计划和自动回滚条件。

预计用时 4 到 5 小时。前置:Day 34(tracing)、Day 69(配对、功效分析)、Day 70(线上评审)。

## 离线和线上,各管什么

先把两者的分工说清楚,省得后面混。

| | 离线评测 | 线上实验 |
| --- | --- | --- |
| 回答的问题 | 新版本在固定题目上做得对不对 | 新版本对真实客户和业务指标有没有影响 |
| 样本 | 准备好的评测集,可重复 | 真实流量,不可重复 |
| 速度 | 几分钟到几小时 | 一到几周 |
| 风险 | 零,不碰客户 | 有,一部分客户用的是新版本 |
| 能发现的问题 | 能力退化、规则错误、安全问题 | 延迟、用户行为变化、多轮问题、分布漂移 |
| 定位 | 上线的门槛 | 是否全量的依据 |

离线评测没过的版本,不应该进线上实验。线上实验的流量是真实客户,拿来做「试试看」太贵了。反过来,离线评测过了的版本,也不应该直接全量,至少要灰度,重要的改动要做 A/B。

## 实验设计的五个要素

做过几次线上实验的人大多有同一个体会:结论靠不靠谱,主要取决于实验开始前的设计,而不是结束后的分析。Agent 实验也一样。开实验之前,先把下面五件事写进实验文档。

**分流单位。** 按什么把流量分成两组?Agent 场景下几乎总是按客户(或者按账号)。原因有两个:一是体验一致,同一个客户今天碰到新版本、明天碰到旧版本,会觉得这个客服人格分裂,而且多轮对话中途换版本可能直接出错;二是统计上更干净,同一客户的多次会话之间是相关的(Day 69 讲的聚类问题),按客户分流后,分析单位和分流单位一致,方差好算。

**主指标。** 事先定一个,只能一个。Kohavi 的书里把它叫做 OEC(overall evaluation criterion),综合评价指标。对 SupportPilot 这种客服 Agent,我会选「转人工率」或「工单一次解决率」。它要满足三个条件:和业务目标直接相关、实验周期内能观察到变化、能被这次改动影响。

**护栏指标。** 不打算改善、但绝对不能变差的指标。对 Agent 来说通常是:单工单成本、P95 延迟、投诉率、安全事件数。护栏显著变差,不管主指标多好看,都不上线(或者至少要有人明确签字接受这个代价)。

**样本量与时长。** 用 Day 69 的功效分析倒推:想检测多大的变化、需要多少客户、按现在的流量要跑几天。另外,时长至少覆盖一个完整的周周期,因为周一和周末的客户、问题类型都不一样。跑三天就下结论,是常见的错误。

**停止规则。** 什么时候结束实验、什么情况下提前叫停。提前叫停只能是因为护栏出了严重问题(比如投诉暴增、安全事件),不能是因为「主指标看起来已经显著了」。这一条后面会专门讲。

## Agent 能用哪些指标

传统互联网 A/B 用点击率、转化率,Agent 有自己的一套。我把 SupportPilot 能用的指标按来源分了一下:

| 指标 | 怎么算 | 适合当 |
| --- | --- | --- |
| 转人工率 | 转人工的会话 / 会话 | 主指标 |
| 一次解决率 | 72 小时内没有再开单的会话 / 会话 | 主指标(延迟反馈) |
| 重问率 | 同一会话里客户换种说法再问一次的比例 | 辅助 |
| 草稿采纳率 | 人工客服直接发送 Agent 草稿的比例(copilot 模式) | 主指标 |
| 满意度评分 | 客户主动打分的平均分 | 辅助,样本有偏 |
| 单工单成本 | 模型 + 工具调用的花费 | 护栏 |
| P95 延迟 | 首 token 或完整回复的 95 分位 | 护栏 |
| 投诉率、安全事件 | 投诉工单数、红队检测命中数 | 护栏 |
| 线上评审通过率 | Day 70 的校正后通过率 | 辅助 |

表里大部分是隐式反馈:不需要客户主动做什么,从行为里推出来。满意度评分这种显式反馈,问题是只有很少一部分客户会打分,而且主动打分的往往是特别满意或特别生气的人,样本有偏,只能当辅助。

所有这些指标都能从 Day 34 接入的 Langfuse trace 和业务库里算出来。实验框架需要做的,是给每条 trace 打上「哪个实验、哪一组」的标签。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="线上实验的数据流:分流、打标、指标、SRM 检查、分析、决策">
<rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="30" width="110" height="44" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="28" y="50" fill="var(--ink)">客户 C1234</text>
<text x="28" y="66" fill="var(--ink-faint)">开了一张工单</text>
<line x1="126" y1="52" x2="152" y2="52" stroke="var(--rule)"/>
<rect x="152" y="30" width="140" height="44" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="164" y="50" fill="var(--ink)">hash(实验:客户)</text>
<text x="164" y="66" fill="var(--ink-faint)">同一客户同一组</text>
<line x1="292" y1="44" x2="322" y2="30" stroke="var(--rule)"/>
<line x1="292" y1="60" x2="322" y2="76" stroke="var(--rule)"/>
<rect x="322" y="12" width="120" height="34" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="334" y="34" fill="var(--ink)">control: v2</text>
<rect x="322" y="62" width="120" height="34" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="334" y="84" fill="var(--ink)">treatment: v3</text>
<line x1="442" y1="54" x2="470" y2="54" stroke="var(--rule)"/>
<rect x="470" y="30" width="154" height="44" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="480" y="50" fill="var(--ink)">trace 打标签</text>
<text x="480" y="66" fill="var(--ink-faint)">experiment, arm</text>
<line x1="547" y1="74" x2="547" y2="120" stroke="var(--rule)"/>
<rect x="430" y="120" width="194" height="44" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="442" y="140" fill="var(--ink)">按客户聚合指标</text>
<text x="442" y="156" fill="var(--ink-faint)">转人工率、成本、延迟</text>
<line x1="430" y1="142" x2="396" y2="142" stroke="var(--rule)"/>
<rect x="246" y="120" width="150" height="44" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="258" y="140" fill="var(--ink)">SRM 检查</text>
<text x="258" y="156" fill="var(--ink-faint)">不过 = 先修 bug</text>
<line x1="246" y1="142" x2="210" y2="142" stroke="var(--rule)"/>
<rect x="16" y="120" width="194" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="28" y="140" fill="var(--ink)">delta 方法 + 决策</text>
<text x="28" y="156" fill="var(--ink-faint)">主指标 + 护栏</text>
<text x="16" y="208" fill="var(--ink-soft)">分流单位是客户,分析单位也必须是客户。中间任何一步按会话算,</text>
<text x="16" y="228" fill="var(--ink-soft)">都会把同一客户多次会话之间的相关性忽略掉,区间算窄。</text>
<text x="16" y="248" fill="var(--ink-soft)">SRM 不过,后面的分析结果一律不看。</text>
</g>
</svg>
<figcaption>一次线上实验的数据流。真正容易出错的地方不在最后的统计,而在中间:分流是否稳定、埋点是否完整、分析单位是否和分流单位一致。</figcaption>
</figure>

## 分流:同一个客户永远在同一组

分流函数要满足三个条件:同一客户在同一实验里结果稳定;不同实验之间互不相关(不能永远是同一批客户在当小白鼠);不需要存储,任何服务、任何时候算出来都一样。用哈希就够了:

```python
def assign(unit_id: str, experiment: str, treatment_share: float = 0.5) -> str:
    """同一个客户在同一个实验里永远分到同一组。实验名当盐,不同实验之间互不相关。"""
    h = hashlib.sha256(f"{experiment}:{unit_id}".encode()).hexdigest()
    bucket = int(h[:8], 16) / 0xFFFFFFFF
    return "treatment" if bucket < treatment_share else "control"
```

几个实践要点:

- 分流放在模型网关或者 Agent 入口,越早越好。Day 83 做 AgentOps 网关时,这段代码会搬进网关。
- 分流结果一定要写进 trace 的标签。Langfuse 的 prompt 管理功能本身也支持给不同 prompt 版本打标签做 A/B,学习资料里有链接,简单场景可以直接用。
- 放量时(比如从 10% 到 50%)只改 `treatment_share`,哈希不变,所以原来在实验组的客户还在实验组,不会被换来换去。
- 多个实验同时跑时,不同实验名会产生独立的分组。如果两个实验改的是同一个东西(比如都改了起草 prompt),就不能同时跑,要互斥。复杂的互斥和分层是实验平台的事,Kohavi 的书第 4 章讲得很细。

## SRM:分流有没有出 bug

实验跑起来之后,第一件事不是看主指标,而是看两组的客户数比例对不对。我设计的是 50/50,模拟结果是:

```text
customers control=3926 treatment=4074  SRM p=0.098  sessions=20077
```

这叫 SRM 检查(sample ratio mismatch,样本比例不匹配)。用卡方检验看实际比例和设计比例的差异是不是太大。p = 0.098 不算小,通过。一般的阈值是 p < 0.001 才判定为 SRM,因为这个检查每个实验都要做,阈值太松会经常误报。

SRM 不过意味着什么?意味着两组客户不是从同一个总体里随机分出来的,后面所有比较都没有意义。Microsoft 实验平台团队 2019 年在 KDD 上发过一篇专门讲 SRM 的论文,总结了一堆真实原因,放到 Agent 场景里,我能想到的就有:

- 新版本更慢,一部分请求超时了,没有写入 trace,实验组的会话数就少了。
- 新版本在某类工单上直接抛异常,日志没打上实验标签。
- 实验组的客户更容易被转人工,转人工之后的会话被记到了人工客服系统里,Agent 侧的数据就缺了一块。

这些情况下,如果你不查 SRM 直接看指标,会看到一个「实验组转人工率更低」的漂亮结果,而真相是转人工的那部分数据丢了。SRM 检查放在分析报告的第一行,不过就不往下看。

## 分析:按客户聚合,用 delta 方法

主指标「转人工率」是一个比率:转人工的会话数 / 会话数。分流单位是客户,一个客户可能有好几次会话。

直接按会话算两组的比例、用两比例 z 检验,是最常见的错误。它假设每次会话独立,但同一个客户的会话不独立:一个客户如果账户设置有问题,他的每张工单都可能转人工。

正确的做法是把数据按客户聚合,每个客户算出「转人工次数 y」和「会话次数 x」,比率 = Σy / Σx。这个比率的方差用 delta 方法估计:

Var(r) ≈ (Var(y) − 2r·Cov(y, x) + r²·Var(x)) / (n · x̄²)

其中 n 是客户数,x̄ 是每个客户的平均会话数。不用记推导,记住它是在「客户」这个层面算方差的就行。代码在后面的模块里。

模拟数据跑出来:

```text
escalated: 0.2743 -> 0.2421  diff -0.0322  CI [-0.0445,-0.0200]  p=0.0000
cost_cny: 0.0180 -> 0.0209  diff +0.0030  CI [+0.0028,+0.0031]  p=0.0000
```

转人工率从 27.4% 降到 24.2%,降了 3.2 个点,区间完全在零以下,显著。单工单成本从 0.018 元涨到 0.021 元,涨了 16%,同样显著。

按会话算会差多少?在这组数据里几乎没差别:按会话算的标准误是 0.0062,delta 方法是 0.0063。原因是我模拟的客户之间差异不大,同一客户的会话相关性很弱。但换一组更像真实情况的数据,让四分之一的客户「反复踩同一个坑」(他们的转人工概率是 80%,其他人是 5%):

```text
sessions 40140 naive SE 0.0043 delta SE 0.0084
```

按会话算的标准误只有正确值的一半。拿它去做检验,区间窄一半,你会把很多随机波动当成显著效果。真实的客服数据里,「少数客户贡献大量问题工单」几乎是必然的,所以这一步不能省。

## 决策:主指标好,护栏差,上不上?

回到刚才的结果:转人工率降了 3.2 个点,成本涨了 16%。上不上线?

```python
def decide(primary: MetricResult, guardrails: list[MetricResult], better: str = "lower") -> str:
    """一个主指标 + 若干护栏。护栏显著变差就不上线,不管主指标多好看。"""
    for g in guardrails:
        worse = g.diff > 0 if g.name in ("escalated", "cost_cny", "latency_s") else g.diff < 0
        if worse and g.p_value < 0.05:
            return f"不上线:护栏 {g.name} 显著变差({g.control:.3f} → {g.treatment:.3f})"
    good = primary.diff < 0 if better == "lower" else primary.diff > 0
    if primary.p_value < 0.05 and good:
        return "上线"
    if primary.p_value < 0.05:
        return "不上线:主指标显著变差"
    return "没有结论:差异不显著,继续跑到预定样本量或接受「没区别」"
```

```text
decision: 不上线:护栏 cost_cny 显著变差(0.018 → 0.021)
decision (cost guardrail ignored): 上线
```

代码给出的是「不上线」。但我想强调,这个函数只是一个默认规则,真实决策需要人来做,而且要算账。

转人工率降 3.2 个点,意味着每 100 张工单少 3.2 次人工处理。Day 38 按假设算过,人工处理一张工单大约 8.5 元,100 张工单省下约 27 元;Agent 每张工单多花 0.003 元,100 张多花 0.3 元。省下的人工成本是多花的模型钱的几十倍。这种情况下,护栏应该是「成本涨幅不超过 X」,而不是「成本不能涨」。

所以护栏的阈值要在实验开始前定好,而且要和业务一起定。「成本涨 16% 能不能接受」不是工程师能拍板的事,但工程师要把这笔账算清楚摆在桌上。这就是 Day 38 讲的 Agent 经济学在实验里的用法。

## 偷看:每天看一次结果有什么问题

实验跑了三天,有人去看了一眼报表,主指标 p = 0.03,显著了,于是宣布胜利、提前结束。这是线上实验里最常见、也最隐蔽的错误。

我用代码模拟了一个 A/A 实验:两组完全一样,没有任何真实差异。每天看一次结果,只要某一天 p < 0.05 就宣布「显著」并停止。跑 14 天,重复 1000 次:

```text
A/A peeking daily for 14 days: false positive rate 21.9% (nominal 5%)
```

名义上的假阳性率是 5%,实际是 21.9%,翻了四倍多。原因不难理解:p 值每天都在随机波动,看 14 次,总有一天它会碰巧掉到 0.05 以下。你每多看一次,就多给了随机波动一次「中奖」的机会。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="A/A 实验中每天偷看导致的假阳性率">
<rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink-soft)">两组完全一样的 A/A 实验,1000 次模拟</text>
<rect x="20" y="52" width="60" height="30" fill="var(--mem)"/>
<text x="90" y="72" fill="var(--ink)">只在第 14 天看一次:约 5%(设计值)</text>
<rect x="20" y="104" width="263" height="30" fill="var(--compute)"/>
<text x="293" y="124" fill="var(--ink)">每天看一次,显著就停:21.9%</text>
<line x1="20" y1="150" x2="620" y2="150" stroke="var(--rule)"/>
<text x="20" y="172" fill="var(--ink-faint)">0%</text>
<text x="252" y="172" fill="var(--ink-faint)">20%</text>
<text x="20" y="190" fill="var(--ink-soft)">条形长度按比例:每 1% ≈ 12 像素</text>
</g>
</svg>
<figcaption>没有任何真实差异的实验,每天看一次、一显著就停,有超过五分之一的概率得出「新版本更好」的结论。</figcaption>
</figure>

怎么办?三种做法,按推荐程度排:

1. 固定时长。 实验开始前用功效分析定好样本量和天数,中途不看主指标(护栏可以看),到时间再分析。最简单,也最不容易出错。
2. 序贯检验。 如果业务确实需要随时看,就用专门为「随时看」设计的方法,比如 Johari 等人 2015 年提出的 always-valid inference(mSPRT)。GrowthBook、Statsig 这些实验平台都内置了序贯检验,学习资料里有它们的文档。代价是同样的样本量下,检验更保守一些。
3. α 消耗。 事先规定只看几次(比如第 7 天和第 14 天),每次用更严格的阈值,把总的假阳性率控制在 5%。

不管用哪种,有一件事是不变的:提前结束只能因为护栏,不能因为主指标「已经显著」。

## 灰度和回滚

A/B 实验回答「新版本好不好」,灰度发布回答「新版本会不会出事」。两者经常一起用:先灰度到小比例确认没有事故,再开 A/B 正式比较,最后全量。

SupportPilot 的放量计划我会这样写:

| 阶段 | 实验组比例 | 持续 | 看什么 | 自动回滚条件 |
| --- | --- | --- | --- | --- |
| 内部 | 只有测试账号 | 1 天 | 冒烟用例、trace 抽查 | 任何报错 |
| 灰度 1 | 1% | 1 天 | 错误率、P95 延迟、成本 | 错误率 > 基线 2 倍 |
| 灰度 2 | 5% | 2 天 | 加上投诉、安全检测 | 任何安全事件;投诉率显著上升 |
| A/B | 50% | 14 天(按功效分析定) | 主指标 + 护栏 | 护栏严重恶化 |
| 全量 | 100% | 持续 | 线上评审、监控 | 同灰度 |

自动回滚要真的自动。做法是把实验配置(哪个版本、多少比例)放在配置中心或者网关里,监控指标越线时由告警直接把比例改回 0,而不是发消息等人来处理。Agent 出事往往是批量的(同一个错误回复发给了几百个客户),晚半小时回滚,影响可能大十倍。Day 87 讲事故复盘时还会回到这一点。

还有一个经验:Kohavi 在书里引用过一条叫 Twyman 定律的经验法则,大意是「任何看起来特别有意思或者特别好的数字,通常是错的」。实验结果好得出乎意料时(比如一个小 prompt 改动让转人工率降了 15 个点),先去查数据和埋点,而不是先去庆功。

## 把它们放进一个模块

```python
# agentops/experiments/ab.py
"""最小可用的 Agent A/B 实验:稳定分流、SRM 检查、按客户聚合的指标比较、护栏。"""
from __future__ import annotations

import hashlib
import math
from collections import defaultdict
from dataclasses import dataclass

import numpy as np
from scipy import stats


def assign(unit_id: str, experiment: str, treatment_share: float = 0.5) -> str:
    """同一个客户在同一个实验里永远分到同一组。实验名当盐,不同实验之间互不相关。"""
    h = hashlib.sha256(f"{experiment}:{unit_id}".encode()).hexdigest()
    bucket = int(h[:8], 16) / 0xFFFFFFFF
    return "treatment" if bucket < treatment_share else "control"


def srm_check(n_control: int, n_treatment: int, expected_share: float = 0.5) -> float:
    """样本比例不匹配检查。p 值很小(比如 < 0.001)说明分流或埋点有 bug,结果别看了。"""
    total = n_control + n_treatment
    exp = [total * (1 - expected_share), total * expected_share]
    return float(stats.chisquare([n_control, n_treatment], exp).pvalue)


@dataclass
class MetricResult:
    name: str
    control: float
    treatment: float
    diff: float
    ci: tuple[float, float]
    p_value: float


def ratio_metric(sessions: list[dict], metric: str, group_key: str = "customer") -> MetricResult:
    """按客户聚合的比率指标,方差用 delta 方法在客户层面算。"""
    per = {"control": defaultdict(lambda: [0.0, 0]), "treatment": defaultdict(lambda: [0.0, 0])}
    for s in sessions:
        cell = per[s["arm"]][s[group_key]]
        cell[0] += s[metric]
        cell[1] += 1
    est = {}
    for arm, by in per.items():
        y = np.array([v[0] for v in by.values()])
        x = np.array([v[1] for v in by.values()], dtype=float)
        n = len(y)
        r = y.sum() / x.sum()
        cov = np.cov(y, x, ddof=1)
        var = (cov[0, 0] - 2 * r * cov[0, 1] + r * r * cov[1, 1]) / (n * x.mean() ** 2)
        est[arm] = (r, var)
    (rc, vc), (rt, vt) = est["control"], est["treatment"]
    diff = rt - rc
    se = math.sqrt(vc + vt)
    p = 2 * (1 - stats.norm.cdf(abs(diff / se)))
    return MetricResult(metric, rc, rt, diff, (diff - 1.96 * se, diff + 1.96 * se), float(p))


def decide(primary: MetricResult, guardrails: list[MetricResult], better: str = "lower") -> str:
    """一个主指标 + 若干护栏。护栏显著变差就不上线,不管主指标多好看。"""
    for g in guardrails:
        worse = g.diff > 0 if g.name in ("escalated", "cost_cny", "latency_s") else g.diff < 0
        if worse and g.p_value < 0.05:
            return f"不上线:护栏 {g.name} 显著变差({g.control:.3f} → {g.treatment:.3f})"
    good = primary.diff < 0 if better == "lower" else primary.diff > 0
    if primary.p_value < 0.05 and good:
        return "上线"
    if primary.p_value < 0.05:
        return "不上线:主指标显著变差"
    return "没有结论:差异不显著,继续跑到预定样本量或接受「没区别」"
```

模拟脚本 `data/ab_demo.py` 一起放进仓库,包括 8000 个客户的实验和 A/A 偷看模拟。`sessions` 在真实场景里来自 Langfuse 导出的 trace(带 `experiment`、`arm` 标签)加上业务库里的转人工记录。

## 动手练习

1. 把 `agentops/experiments/ab.py` 和 `data/ab_demo.py` 放进仓库,跑一遍确认输出。再改两处各跑一次:把实验组的效果改成 0(A/A),看主指标是否不显著;故意在实验组丢掉 3% 的会话记录(模拟超时没写 trace),看 SRM 检查能不能抓到。
2. 在 SupportPilot 的入口加上 `assign`,把实验名和分组写进 Langfuse trace 的 tag 或 metadata。
3. 写一份实验文档,对象是「起草节点换用更强的模型」:写清分流单位、主指标、护栏和阈值(和「业务方」商量,没有的话自己扮演并写理由)、用 Day 69 的方法算出的样本量和时长、停止规则。
4. 写一份放量计划表和自动回滚条件,说明回滚靠什么机制触发(配置中心、网关开关还是别的)。
5. 用 A/A 模拟回答一个问题:如果只在第 7 天和第 14 天各看一次,每次用 p < 0.05,假阳性率是多少?改成每次用 p < 0.025 呢?

**验收标准**:SRM 能抓到故意制造的丢数据;实验文档里的样本量有算式;放量计划的每个阶段都有可执行的回滚条件;第 5 题有模拟出来的数字。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| A/B 实验 | 把流量随机分成两组,一组用新版本,比较指标差异 |
| 分流单位 | 按什么随机分组,Agent 场景一般是客户或账号 |
| OEC / 主指标 | 事先定好的唯一一个决定实验成败的指标 |
| 护栏指标 | 不打算改善但不能变差的指标,比如成本、延迟、投诉 |
| SRM | 两组样本比例和设计比例不一致,通常意味着分流或埋点有 bug |
| delta 方法 | 估计比率类指标方差的近似方法,这里用于按客户聚合 |
| 偷看(peeking) | 实验进行中反复检验主指标并在显著时停止,会抬高假阳性率 |
| 序贯检验 | 专门为随时查看设计的检验方法,如 mSPRT |
| 灰度发布 | 先给小比例流量用新版本,逐步放量 |
| Twyman 定律 | 看起来特别好的数字通常是错的,先查数据 |

## 常见误区

**离线评测过了就能全量。** 离线评测只证明在固定题目上没问题,延迟、用户行为、多轮对话的问题只有线上能暴露。

**按请求或会话分流。** 同一客户在两个版本之间来回切换,体验不一致,统计上也不独立。按客户分流,按客户分析。

**跳过 SRM 直接看主指标。** 两组比例不对,往往是数据丢了,丢的恰好是你最关心的那部分(超时、出错、转人工)。

**看到显著就提前结束。** 每天看一次、显著就停,假阳性率会翻几倍。固定时长或者用序贯检验。

**护栏一律不能变差。** 成本涨一点换来转人工率大降,往往很划算。护栏阈值要事先和业务一起定,并且算清楚账。

**结果特别好就赶紧上线。** 先查数据和埋点。好得出乎意料的结果,多数是 bug。

## 学习资料

### 文档与文章

- [Kohavi、Tang、Xu · Trustworthy Online Controlled Experiments 官网](https://experimentguide.com/):书的官方页面,有勘误和部分章节资源,今天的主要参考。
- [Fabijan 等 · Diagnosing Sample Ratio Mismatch in Online Controlled Experiments](https://exp-platform.com/Documents/2019_KDDFabijanGupchupFuptaOmhoverVermeerDmitriev.pdf):Microsoft 实验平台团队 KDD 2019 的论文,系统总结了 SRM 的成因和排查方法,读「taxonomy」部分约 40 分钟。
- [Johari 等 · Always Valid Inference: Bringing Sequential Analysis to A/B Testing](https://arxiv.org/abs/1512.04922):序贯检验在 A/B 测试中的经典论文,数学较多,读引言和结论理解为什么偷看会出问题即可。
- [GrowthBook · Sequential Testing](https://docs.growthbook.io/statistics/sequential) 和 [Statsig · SRM Checks](https://docs.statsig.com/stats-engine/methodologies/srm-checks):两个实验平台的文档,看工业界怎么落地今天的几个概念,各 15 分钟。
- [Langfuse · A/B Testing of Prompts](https://langfuse.com/docs/prompt-management/features/a-b-testing):用 Langfuse 的 prompt 版本做简单 A/B 的方法,适合小团队起步。
- [Exp-Platform](https://www.exp-platform.com/):Kohavi 等人整理的实验相关论文合集,遇到具体问题时来这里找。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1CTYkzWE3Q&autoplay=0&high_quality=1" title="8分钟弄懂AB实验｜AB Testing、空转、AA Testing、显著性检验、Z校验、正交实验" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小生凡一 · 8分钟弄懂AB实验:AB Testing、空转、AA Testing、显著性检验、Z校验、正交实验 · 9 分钟,快速过一遍基本概念,AA 实验和正交实验两段和今天直接相关。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1TmokB6EeA&autoplay=0&high_quality=1" title="【IT老齐899.40】灰度发布的策略、实现与挑战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT老齐 · 灰度发布的策略、实现与挑战 · 14 分钟,后端视角讲灰度发布的几种实现,对应今天「灰度和回滚」一节。</figcaption>
</figure>

- 一条单休的狗 · 强推!B站最值得收藏的AB测试教程!由浅入深讲解(BV1WoV4zKEkG):9 集约 1.5 小时,数据分析岗视角的系统教程,样本量计算和指标设计几集值得看。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/hEzpiDuYFoE" title="The ultimate guide to A/B testing | Ronny Kohavi (Airbnb, Microsoft, Amazon)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Lenny's Podcast · The ultimate guide to A/B testing(Ronny Kohavi)· 1 小时 23 分,书的作者亲自讲实验文化、OEC、SRM 和 Twyman 定律,通勤时听。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/HEGI5QN3fXE" title="Ronny Kohavi: A/B Testing Pitfalls: Getting Numbers You Can Trust is Hard - CXL LIVE 2016" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>CXL · Ronny Kohavi: A/B Testing Pitfalls · 27 分钟,集中讲实验里的各种坑,和今天的常见误区对照着看。</figcaption>
</figure>

### 书籍

- Ron Kohavi、Diane Tang、Ya Xu《Trustworthy Online Controlled Experiments: A Practical Guide to A/B Testing》(Cambridge University Press,2020;中文版书名《关键迭代:可信赖的线上对照实验》):今天读第 3 章(Twyman 定律与可信度)、第 7 章(指标与 OEC)、第 17 章(统计)、第 21 章(SRM 与护栏),约 5 小时。这本书是做线上实验的人的必读书。
- Peter Bruce 等《Practical Statistics for Data Scientists》(第 2 版,O'Reilly,2020)第 3 章:A/B 测试和多臂老虎机的入门讲解,统计部分比 Kohavi 的书更基础。

### 开源项目与代码

- 今天的 `agentops/experiments/ab.py` 和 `data/ab_demo.py`。
- [GrowthBook](https://docs.growthbook.io/statistics/overview):开源的实验平台,有完整的统计引擎(包括序贯检验和 CUPED 方差缩减),团队需要真正的实验平台时,自托管它比自己写省事得多。

## 自测

1. 为什么 Agent 实验要按客户分流,而不是按会话或请求?

<details><summary>答案</summary>

两个原因。体验上,同一客户在新旧版本之间来回切换会觉得不一致,多轮对话中途换版本可能出错。统计上,同一客户的多次会话是相关的,按客户分流、按客户分析,分析单位和分流单位一致,方差才算得对。

</details>

2. SRM 检查不过意味着什么?举一个 Agent 场景下的例子。

<details><summary>答案</summary>

意味着两组不是从同一总体随机分出来的,后面的比较都不可信,要先修 bug。例子:新版本更慢,部分请求超时没写入 trace,实验组记录的会话数变少,而丢掉的恰好是体验最差的那部分,看起来实验组指标更好。

</details>

3. 按会话直接做两比例检验,和按客户聚合用 delta 方法,结果为什么可能差很多?

<details><summary>答案</summary>

按会话检验假设每次会话独立,但同一客户的会话相关(比如少数客户反复遇到同一问题)。忽略这种相关会低估方差。模拟里四分之一客户反复踩坑时,按会话算的标准误 0.0043,只有 delta 方法 0.0084 的一半,区间窄一半,容易得出假显著的结论。

</details>

4. 实验跑到第 3 天,主指标 p = 0.02。要不要提前结束?

<details><summary>答案</summary>

不要。反复查看并在显著时停止会大幅抬高假阳性率,模拟里每天看一次、跑 14 天,假阳性率从 5% 变成 21.9%。另外 3 天也没覆盖完整的周周期。应该按事先定的时长跑完,或者使用序贯检验。提前结束只能因为护栏出了严重问题。

</details>

5. 资深面试题:新的 Agent 版本离线评测提升明显,线上 A/B 主指标没有显著变化。你怎么分析?

<details><summary>答案</summary>

先查实验本身:SRM 是否通过、埋点是否完整、实验组是否真的用了新版本、样本量和时长是否达到功效分析的要求(可能线上效果存在但实验功效不足)。再查离线和线上的差异:评测集是否代表当前线上流量分布(分类别对比);离线评测的指标和线上主指标是否对应(比如评审打分高但回复太长,用户体验没变好);延迟或成本是否抵消了质量提升;多轮对话是否有离线没覆盖的问题。可以按工单类别做分组分析(注意多重比较),看提升是否集中在某些类别而被其他类别稀释。最后根据结论决定:扩样继续跑、调整评测集,或者接受「线上没区别」并评估是否仍有其他理由(比如成本)上线。

</details>

6. 一个改动让转人工率下降 3 个点,单工单模型成本上升 16%。怎么决策?

<details><summary>答案</summary>

算账。少 3 次人工处理(每百张工单)节省的人工成本,和每张工单多花的模型费用比较。按 Day 38 的假设,人工一张约 8.5 元,模型每张多花 0.003 元,每百张工单省约 27 元、多花 0.3 元,通常值得。决策规则应该在实验前就和业务定好护栏阈值(比如成本涨幅上限),而不是一律「不能变差」。工程师的责任是把这笔账算清楚,由业务方拍板。

</details>

## 明天预告

Day 72 讲自动化红队:用 Agent 攻击 Agent。今天的实验能告诉你新版本在线上好不好,但有一类问题等不到线上才发现:提示词注入、越权查别人的数据、诱导超额退款。明天会写一个攻击用例生成器,组合种子攻击、变形策略和投放位置,配上只看「实际发生了什么」的检测器,对一个天真的和一个加固过的 Agent 分别跑出攻击成功率,再看 promptfoo、garak、PyRIT 这些现成工具怎么接进 CI。
