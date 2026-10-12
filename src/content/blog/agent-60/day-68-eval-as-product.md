---
title: 'Day 68 · 评测是产品:评测体系的组织、流程和所有权'
description: '基础篇里评测是你一个人的事:自己写用例、自己跑、自己看分数。到了一个五六个人、两三条产品线的团队,评测会烂掉,原因几乎都不是技术。今天讲评测在团队里怎么分工、用例从哪来、谁来评审、能力集和回归集怎么流转、什么时候该退役,再写一个给用例上户口的小工具。'
pubDate: 2026-10-12
regime: none
tags: ['eval', 'process', 'ownership', 'senior', 'agent-60']
series: 'agent-60'
day: 68
lang: 'zh'
---

## 今天要解决的问题

W5 和毕业项目里,评测这件事是围着你一个人转的:你读 trace、你分类失败、你写用例、你跑 `make eval`、你看报告。一个人的时候这样完全没问题,甚至是最快的。

麻烦在团队变大以后。我见过最常见的走向是这样的:项目早期某个工程师很认真地搭了一套评测,一百多条用例,分数挂在 CI 里。半年后这个人调走了,用例没人加,新功能上线没有对应的用例,旧用例有一半已经和产品行为对不上,CI 里的分数每次都是 71% 上下晃,大家默认「它就是这个数」,没人再看。评测还在跑,但已经不起任何作用。

这不是技术问题。统计、judge、trace 都可以做得很好,组织上没人负责,照样会烂。资深工程师和中级工程师在评测上的差别,很大一部分就在这里:中级的人会写评测,资深的人能让一个团队持续地、自发地维护评测。

今天学完你应该能:

1. 说清评测资产在团队里的生命周期:用例从哪来、进哪个集合、什么时候毕业、什么时候退役。
2. 给一个五到二十人的 Agent 团队设计评测分工:平台组管什么、业务组管什么、领域专家管什么,用一张表写清楚。
3. 把评测绑定到需求评审和代码评审流程里,而不是靠某个人的自觉。
4. 写一个给评测用例「上户口」的检查工具,让缺负责人、缺需求编号的用例进不了仓库,并能指出哪些能力用例该毕业了。
5. 回答资深面试里的一个常见问题:「你们团队的评测是怎么维护的?」

预计用时 3 到 4 小时。前置:Day 29–35(评测基础)、Day 50–51(毕业项目评测和迭代)、Day 67(运行时设计文档)。

## 一个人的评测和一个团队的评测

先把两种状态放在一起对比,你会发现差别不在评测本身,而在评测周围那一圈东西。

| | 一个人 | 一个团队 |
| --- | --- | --- |
| 用例从哪来 | 自己读 trace、自己想 | 线上事故、客服工单、PRD、错误分析、红队,来源很多 |
| 谁知道「正确答案」 | 自己 | 往往是客服主管、财务、法务,不是写代码的人 |
| 用例过时了怎么办 | 自己记得改 | 没人知道它过时了 |
| 分数掉了谁去看 | 自己 | 如果没写清楚,就是没人 |
| 评测跑多久、花多少钱 | 无所谓 | 跑一次 40 分钟、几百块,会被嫌弃 |
| 判断标准变了 | 改一下 judge prompt | 要通知所有依赖这个分数的人 |

右边这一列里的每一项,都需要有人负责,有流程兜住。没有的话,评测就会慢慢退化成「某个仪表盘上的一个数」。

Anthropic 在 2026 年 1 月发的《Demystifying evals for AI agents》里讲团队分工时有一句话,我很认同:负责评测应该像维护单元测试一样平常。单元测试为什么能在大多数团队里活下来?因为它有几个硬约束:跟代码放在一起,改代码的人顺手改测试,CI 里不过就合不进去,代码评审时评审人会看测试。评测要活下来,也得有同样的硬约束。

## 评测资产的生命周期

把一条用例当成一个有生老病死的东西看,问题会清楚很多。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="评测用例的生命周期:来源、能力集、回归集、退役">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink-soft)">来源</text>
<rect x="20" y="40" width="130" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="58" fill="var(--ink)">线上事故 / 工单</text>
<rect x="20" y="76" width="130" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="94" fill="var(--ink)">PRD 新需求</text>
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
<rect x="540" y="146" width="84" height="50" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="552" y="166" fill="var(--ink)">退役</text>
<text x="552" y="184" fill="var(--ink-faint)">产品变了</text>
<text x="20" y="232" fill="var(--ink-soft)">能力集里连续多次通过率 ≥95% 的用例毕业进回归集;</text>
<text x="20" y="252" fill="var(--ink-soft)">回归集挂了 = 有东西坏了;能力集涨分 = 能力变强了。</text>
<text x="20" y="272" fill="var(--ink-soft)">产品行为改了,对应用例要么改期望,要么带着理由退役。</text>
</g>
</svg>
<figcaption>一条用例从进库到退役。两个集合的意义不同:回归集掉分是事故,能力集涨分是进步,混在一起看,两种信号都会被稀释。</figcaption>
</figure>

几个节点分开说。

**来源。** 好用例最主要的来源是真实失败:线上事故、客服转过来的投诉、错误分析里归出来的失败类别。Day 30 讲过,先看 100 条 trace 再写用例,不要坐在工位上凭空想。到了团队里,这条要变成流程:每次线上事故的复盘(Day 87 会讲)都要回答一个问题,「这次的问题,有没有一条用例能提前发现?没有的话,谁在什么时候补上?」这个问题写进复盘模板,评测集才会跟着事故一起长。

第二个来源是需求。PRD 里每写一条「Agent 要能做到 X」,就应该同时写下「怎么判断它做到了」,也就是至少一条用例。这就是 Anthropic 那篇文章里说的 eval-driven development:先把要的能力写成评测,再去实现。这样做的副作用是,PM 写需求时会被逼着把模糊的地方说清楚。「Agent 要能妥善处理退款」这种需求写不出用例,一写用例就得说清楚什么叫妥善。

第三个来源是合成和红队(Day 31、Day 72)。它们用来补覆盖面,但不应该是主体。如果一个评测集里七成是合成数据,它测的多半是「模型能不能处理另一个模型想象出来的问题」。

**评审入库。** 用例进库要像代码进库一样经过评审。评审看三件事:期望答案对不对(最好由懂业务的人确认)、判定方式会不会误判(Day 32 讲的 judge 对齐)、这条用例和已有用例是不是重复。还要给它填好「户口」:谁负责、对应哪条需求、哪个严重级别、从哪来。后面那个小工具就是检查户口的。

**能力集和回归集。** 这是 Anthropic 文章里区分得很清楚的两个概念,我在团队里实践下来觉得是最值得照搬的一条。能力集测的是「我们希望 Agent 做到但还没完全做到的事」,起点通过率应该偏低,它是给团队指方向的。回归集测的是「已经做到的事有没有被弄坏」,通过率应该接近 100%,任何一条挂了都要有人去看。

两个集合混在一起会出什么问题?假设总分从 82% 变成 82%,看起来没变化。但可能是能力集涨了 6 分、回归集掉了 4 分:新功能做好了,老功能被弄坏了。只看一个总数,这件事就被抹平了。

**毕业。** 能力集里的用例,连续好几个版本都稳定通过(比如每次跑 5 遍、连续三个版本都 ≥95%),就应该毕业进回归集。不毕业的话,能力集会慢慢饱和:大部分用例都过了,分数顶在 95% 附近,再有进步也看不出来。Anthropic 那篇文章举的例子是 SWE-bench Verified,前沿模型的分数已经超过 80%,接近饱和,所以榜单上的区分度越来越小。你自己的评测集也会遇到同样的事,只是规模小一点。

**退役。** 产品行为变了,对应的用例要么改期望答案,要么退役。退役一定要写理由,并且由用例的负责人或者需求方确认。最怕的是有人发现某条用例总是挂,嫌它烦,悄悄删掉。那条用例有可能恰好是唯一一条测到某个真实问题的。

## 分工:平台、业务、专家各管什么

一个十人左右的 Agent 团队,我建议把评测相关的责任拆成三类人。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="评测分工:平台组、业务团队、领域专家">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="24" width="190" height="170" rx="8" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="36" y="48" fill="var(--ink)">评测平台(1~2 人)</text>
<text x="36" y="76" fill="var(--ink-soft)">跑评测的基础设施</text>
<text x="36" y="98" fill="var(--ink-soft)">judge 的校准与版本</text>
<text x="36" y="120" fill="var(--ink-soft)">统计和报告格式</text>
<text x="36" y="142" fill="var(--ink-soft)">成本和耗时</text>
<text x="36" y="164" fill="var(--ink-soft)">CI 门禁规则</text>
<rect x="225" y="24" width="190" height="170" rx="8" fill="var(--paper)" stroke="var(--rule)"/>
<text x="241" y="48" fill="var(--ink)">各业务团队</text>
<text x="241" y="76" fill="var(--ink-soft)">本模块的用例</text>
<text x="241" y="98" fill="var(--ink-soft)">需求 → 用例</text>
<text x="241" y="120" fill="var(--ink-soft)">事故 → 用例</text>
<text x="241" y="142" fill="var(--ink-soft)">回归挂了谁修</text>
<text x="241" y="164" fill="var(--ink-soft)">用例毕业和退役</text>
<rect x="430" y="24" width="190" height="170" rx="8" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="446" y="48" fill="var(--ink)">领域专家</text>
<text x="446" y="76" fill="var(--ink-soft)">客服主管、财务、法务</text>
<text x="446" y="98" fill="var(--ink-soft)">确认期望答案</text>
<text x="446" y="120" fill="var(--ink-soft)">人工标注(校准集)</text>
<text x="446" y="142" fill="var(--ink-soft)">定义什么叫「好」</text>
<text x="446" y="164" fill="var(--ink-soft)">每周读 20 条 trace</text>
<text x="20" y="226" fill="var(--ink-soft)">平台组不写业务用例,业务组不自己发明 judge 标准,专家不需要会写代码。</text>
</g>
</svg>
<figcaption>三类人各管一块。最容易出问题的是中间那块:业务团队觉得评测是平台组的事,平台组觉得用例是业务组的事。</figcaption>
</figure>

评测平台组(一般一到两个人,也可以是某个工程师的一部分职责)负责「怎么评」:跑评测的基础设施、judge 的版本和校准、统计方法和报告格式(明天和后天的内容)、评测的耗时和成本、CI 门禁规则。平台组不负责写业务用例,也不应该替业务团队决定什么叫答对。

业务团队负责「评什么」:自己模块的用例、需求到用例的转化、事故到用例的转化、回归挂了谁修、用例毕业和退役。这里有一个原则:谁改了 Agent 的某个行为,谁负责它的用例。这和「谁改代码谁改测试」是同一回事。

领域专家负责「什么是对」:客服主管知道退款话术怎么说才合规,财务知道折算规则,法务知道哪些承诺不能做。他们不需要会写代码,但需要有一个顺手的界面去确认期望答案、给样本打标签。Hamel Husain 和 Shreya Shankar 在他们的评测 FAQ 里反复强调过一点:让一个真正懂业务的人做「仁慈的独裁者」,由他来定判断标准,比让一群工程师投票靠谱得多。我在做计费系统时的体会也一样,账算得对不对,最后拍板的永远是财务,不是写代码的人。

还有一件事经常被忽略:领域专家每周要读一些真实 trace。不用多,20 条就够。这是发现「评测集没覆盖到的新问题」的唯一可靠渠道。Anthropic 那篇文章里也专门强调要定期读 transcript,用来区分是 Agent 的问题还是评分器的问题。

下面这张表可以直接贴进你们团队的 wiki,按实际情况改。

| 事项 | 负责 | 参与 | 知会 |
| --- | --- | --- | --- |
| 新需求的用例 | 需求所在的业务团队 | PM、领域专家 | 平台组 |
| 事故复盘补用例 | 事故责任团队 | on-call | 全组 |
| 期望答案确认 | 领域专家 | 业务团队 | |
| judge 改动和重新校准 | 平台组 | 领域专家(出标注) | 所有业务团队 |
| CI 门禁阈值 | 平台组 | 技术负责人 | 全组 |
| 回归集挂了 | 改动提交人 | 用例负责人 | |
| 用例退役 | 用例负责人 | 需求方 | 平台组 |
| 评测成本超预算 | 平台组 | 技术负责人 | |

## 把评测钉进流程里

分工写在 wiki 上没有用,得钉进每天都会发生的流程里。我知道的、确实管用的有四个钉子。

**钉子一:需求评审时问「用例在哪」。** PRD 模板里加一节「验收评测」,列出这个需求对应的用例 id 或者用例草稿。评审会上没有这一节,需求就不算评审通过。这件事只要坚持两三个月,PM 就会自己先想好。

**钉子二:代码评审时看用例。** 改了 prompt、改了工具定义、改了路由逻辑的 MR,如果没有带用例改动,评审人要问一句「这个改动的效果你是怎么验证的」。Day 35 我们已经把评测接进了 CI,CI 报告会贴在 MR 里。评审人要看的不是总分,而是「哪几条用例新挂了、哪几条新修好了」,以及明天会讲的那个区间。

**钉子三:CODEOWNERS 管到评测目录。** 把 `evals/suites/billing/` 这样的目录分给对应团队,改别人的用例需要对方批准。这样能防止有人为了让 CI 变绿,去改另一个团队的期望答案。这种事在评测压力大的团队里真的会发生,而且做的人往往不是故意的,只是觉得「这条期望好像写错了」。

**钉子四:事故复盘模板加一栏。** 「本次问题对应的评测用例:已补 / 计划补(负责人、日期) / 无法用评测覆盖(原因)」。最后一种也是合法的,有些问题确实更适合用监控和告警去兜,但要写理由。

这四个钉子不需要任何新工具,只需要改模板和评审习惯。资深工程师在团队里能起的作用,很多时候就是推动这种看起来不起眼的流程改变,并且坚持到它变成习惯。

## 评测也有预算

评测跑得越来越慢、越来越贵,是另一个让评测被抛弃的常见原因。一个 500 条用例的评测集,每条跑 3 次,每次平均 6 轮工具调用,再加上 LLM judge,跑一次可能要几十分钟、花几十到上百块。如果每个 MR 都全量跑,大家很快就会开始想办法绕过它。

我的做法是分层跑:

- 每个 MR:只跑回归集里的 P0 用例和本次改动相关模块的用例,规则断言为主,少用 judge,控制在 5 分钟内。
- 每天夜里:全量跑一次,所有 judge 都开,每条跑 3 到 5 次,产出完整报告。
- 每次发版前:全量 + 红队回归(Day 72)+ 和上个版本的统计对比(明天的内容)。

评测平台组要对这三层的耗时和花费负责,像对待线上服务的 SLA 一样盯着。成本算法和 Day 38 一样:用例数 × 重复次数 × 每次的 token 数 × 单价,再加 judge 的部分。把这个数每周贴出来,团队就会自然地讨论「这 200 条合成用例是不是可以砍掉一半」。

## 给用例上户口:registry 检查工具

前面说的每一条用例都要有负责人、需求号、集合、严重级别、来源。光靠评审记得检查不现实,写个小工具挂在 CI 里。

用例文件还是 Day 35 那种 JSONL,只是每条多了几个元数据字段:

```json
{"id": "T042", "owner": "cs-li", "requirement": "PRD-3", "suite": "regression", "severity": "p0", "source": "incident", "input": "...", "expect": "..."}
```

工具做两件事。`lint` 检查字段齐不齐、取值合不合法、id 有没有重复,不合格就让 CI 失败。`health` 结合最近一次评测结果,报告回归集有没有没全过的、能力集里哪些该毕业了、负责人是不是过于集中在一个人身上。

```python
# agentops/evals/registry.py
"""评测资产的「户口本」:每条用例谁负责、对应哪条需求、属于能力集还是回归集。

用法:python -m agentops.evals.registry evals/suites/*.jsonl --results evals/reports/latest.json
"""
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict

REQUIRED = ("id", "owner", "requirement", "suite", "severity", "source")
SUITES = ("capability", "regression")
SEVERITIES = ("p0", "p1", "p2")
SOURCES = ("incident", "bug", "prd", "error_analysis", "synthetic", "redteam")


def lint(cases: list[dict]) -> list[str]:
    errs, seen = [], set()
    for c in cases:
        cid = c.get("id", "?")
        for k in REQUIRED:
            if not c.get(k):
                errs.append(f"{cid}: 缺字段 {k}")
        if c.get("suite") not in SUITES:
            errs.append(f"{cid}: suite 只能是 {SUITES}")
        if c.get("severity") not in SEVERITIES:
            errs.append(f"{cid}: severity 只能是 {SEVERITIES}")
        if c.get("source") not in SOURCES:
            errs.append(f"{cid}: source 只能是 {SOURCES}")
        if cid in seen:
            errs.append(f"{cid}: id 重复")
        seen.add(cid)
    return errs


def health(cases: list[dict], results: dict[str, list[int]]) -> list[str]:
    """看两件事:回归集是不是还接近 100%;能力集里哪些已经饱和,可以「毕业」进回归集。"""
    notes = []
    by_suite = defaultdict(list)
    for c in cases:
        r = results.get(c["id"])
        if r:
            by_suite[c.get("suite")].append((c, sum(r) / len(r)))
    reg = by_suite["regression"]
    if reg:
        rate = sum(p for _, p in reg) / len(reg)
        broken = [c["id"] for c, p in reg if p < 1]
        notes.append(f"回归集 {len(reg)} 条,平均通过率 {rate:.1%};没全过的:{broken or '无'}")
    grads = [c["id"] for c, p in by_suite["capability"] if p >= 0.95]
    if grads:
        notes.append(f"能力集里 {len(grads)} 条连续多次通过率 ≥95%,建议毕业进回归集:{grads}")
    owners = Counter(c.get("owner", "(没人)") for c in cases)
    top, n = owners.most_common(1)[0]
    if n / len(cases) > 0.6:
        notes.append(f"{top} 一个人负责了 {n}/{len(cases)} 条用例,评测成了单点")
    return notes


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--results")
    a = ap.parse_args()
    cases = [json.loads(line) for f in a.files for line in open(f) if line.strip()]
    errs = lint(cases)
    print("\n".join(errs) or f"lint 通过:{len(cases)} 条")
    if a.results:
        print("\n".join(health(cases, json.load(open(a.results)))))
    raise SystemExit(1 if errs else 0)
```

`--results` 读的是每条用例最近 N 次运行的 0/1 结果,格式是 `{"T001": [1, 1, 0, 1, 1], ...}`,Day 35 的评测脚本稍微改一下就能输出。

我用 40 条造出来的用例试了一下(故意把一条的 owner 删掉、一条的 suite 写成 smoke),输出是这样的:

```text
T003: 缺字段 owner
T030: suite 只能是 ('capability', 'regression')
回归集 25 条,平均通过率 96.8%;没全过的:['T007', 'T019']
能力集里 5 条连续多次通过率 ≥95%,建议毕业进回归集:['T026', 'T031', 'T034', 'T035', 'T038']
```

顺便说一个写这段代码时真实踩到的坑:第一版 `health` 里写的是 `c["owner"]`,结果正好碰上那条缺 owner 的用例,直接抛 `KeyError`,lint 的报错还没来得及打出来程序就崩了。检查数据质量的工具,自己不能假设数据是干净的。这句话在评测平台里会反复用到。

这个工具很小,但它把「每条用例都有负责人」从一句口号变成了 CI 里的一个红叉。流程靠工具兜底,才能在人员流动时不散架。

## 评测平台要提供什么

明天开始的几天会陆续搭 AgentOps 的评测平台(W11 复习时写成设计文档)。这里先从「评测是产品」的角度,列出平台对内部用户应该提供的东西,后面几天的内容都会往这张清单上落:

| 用户 | 需要什么 | 对应哪天 |
| --- | --- | --- |
| 业务工程师 | 一条命令跑自己模块的评测;MR 里看到「新挂了哪几条、区间多大」 | Day 69、Day 74 |
| 领域专家 | 不写代码就能确认期望答案、给样本打标签的界面 | Day 30 的标注工具升级版 |
| 平台组 | judge 的版本管理、校准和漂移监控 | Day 70 |
| PM、管理者 | 线上指标和实验结果,能回答「这次改版到底好不好」 | Day 71 |
| 安全负责人 | 红队结果和回归 | Day 72 |
| 所有人 | 一份公认可信的 benchmark | Day 73 |

从这张表也能看出来,评测平台的「客户」大部分不是写 Agent 的人。设计这类内部平台时,先列用户和他们的任务,再决定功能,和设计任何产品是一样的。

## 动手练习

1. 给 SupportPilot 的评测集(Day 50)补上元数据:每条加 `owner`、`requirement`、`suite`、`severity`、`source` 五个字段。没有真实团队的话,自己扮演三个角色:你自己负责技术类用例,「客服主管」负责话术类用例,「财务」负责退款金额类用例。
2. 把 `agentops/evals/registry.py` 放进仓库,在 CI 里加一步 `python -m agentops.evals.registry evals/suites/*.jsonl`,故意提交一条缺 owner 的用例,确认 CI 变红。
3. 把 Day 35 的评测脚本改成同时输出 `evals/reports/latest.json`(每条用例最近 5 次运行的 0/1),跑一次 `health`,把建议毕业的用例真的挪到回归集。
4. 写一页「SupportPilot 评测分工说明」:按上面那张表的格式,写清楚每类事项谁负责。再写一段 PRD 模板里的「验收评测」小节和事故复盘模板里的「评测用例」一栏。
5. 算一下你的评测三层(MR、夜间、发版)各自要跑多久、花多少钱,写在说明里。

**验收标准**:CI 能拦住缺元数据的用例;能力集和回归集分开出分;分工说明里每一项都有明确负责人;三层评测的耗时和成本有具体数字(或者带公式的估算)。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 能力集(capability suite) | 测「希望做到但还没稳定做到」的用例集合,起点通过率偏低,用来衡量进步 |
| 回归集(regression suite) | 测「已经做到的有没有被弄坏」的用例集合,应该接近 100%,挂了就是事故 |
| 毕业(graduation) | 能力用例稳定通过后移入回归集 |
| 饱和(saturation) | 评测集大部分用例都过了,分数再也拉不开差距 |
| eval-driven development | 先把要实现的能力写成评测,再去实现 |
| 领域专家 | 懂业务对错的人,比如客服主管、财务、法务,负责定判断标准 |
| CODEOWNERS | 代码托管平台的目录负责人机制,改某个目录需要对应负责人批准 |
| 评测预算 | 跑评测花的时间和钱,需要像线上服务一样被管理 |

## 常见误区

**评测是平台组的事。** 平台组能提供跑评测的工具,但不知道你的业务什么叫答对。用例必须由离业务最近的人负责。

**只看一个总分。** 能力集和回归集混在一起,新功能变好和老功能变坏会互相抵消。至少分开出两个分数,最好还有按模块、按严重级别的分数。

**用例越多越好。** 用例多了跑得慢、贵、难维护,大家就会绕开它。几百条精心维护的真实用例,比几千条合成用例有用。

**用例挂了就删。** 总挂的用例要么说明 Agent 有问题,要么说明用例本身有问题,两种都要查清楚再处理,退役要写理由。

**工程师自己定判断标准。** 退款话术合不合规、账算得对不对,应该由专家拍板。工程师觉得「看起来挺好」的回复,财务可能一眼就能看出问题。

**评测流程靠自觉。** 不钉进需求评审、代码评审、事故复盘这些固定流程里,几个月后就会没人维护。

## 学习资料

### 文档与文章

- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):2026 年 1 月发布,今天能力集/回归集、毕业、饱和、团队分工几个概念的出处。重点读「capability vs regression」和最后讲组织的部分,约 40 分钟。
- [Hamel Husain、Shreya Shankar · LLM Evals FAQ](https://hamel.dev/blog/posts/evals-faq/):两位作者把课上被问最多的问题整理成问答,其中「谁来定标准」「要不要专门的评测团队」几条和今天直接相关,挑着读,约 1 小时。
- [Hamel Husain · A Field Guide to Rapidly Improving AI Products](https://hamel.dev/blog/posts/field-guide/):讲为什么要做数据查看器、为什么让领域专家参与、为什么用二元判断,第二遍读的时候注意他怎么描述团队协作,约 40 分钟。
- [Eugene Yan · An LLM-as-Judge Won't Save The Product, Fixing Your Process Will](https://eugeneyan.com/writing/eval-process/):核心观点是评测首先是流程问题,工具只是辅助,和今天的主题一致,约 20 分钟。
- [Shankar 等 · Who Validates the Validators?](https://arxiv.org/abs/2404.12272):论文发现人在给输出打分的过程中会改变自己的判断标准(criteria drift),这是「判断标准要由专家持续维护」的实证依据,读摘要和第 1、5 节即可。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1AoNx6ZEYH&autoplay=0&high_quality=1" title="面试官问：如何设计一套完整的Agent评估体系？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Agent开发实战 · 面试官问:如何设计一套完整的Agent评估体系? · 6 分钟,面试视角的评估体系概览,看完对照今天的分工表,想想视频里缺了哪些「谁来负责」的部分。</figcaption>
</figure>

- 学掌门 ·【AI测评】EvalScope/Langfuse 大模型评估与性能基准测试框架(BV11vu96nERa):15 集的长合集,偏工具实操,适合想看国内团队怎么搭评测平台的同学挑几集看。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/XueTa4qrMpg" title="How Engineers and PMs should collaborate on Evals" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · How Engineers and PMs should collaborate on Evals · 34 分钟,讲工程师和产品经理在评测上怎么分工,和今天的分工表一起看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/BsWxPI9UM4c" title="Why AI evals are the hottest new skill for product builders | Hamel Husain &amp; Shreya Shankar" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Lenny's Podcast · Why AI evals are the hottest new skill for product builders(Hamel Husain、Shreya Shankar)· 1 小时 46 分,播客长谈,前 40 分钟讲团队里评测怎么做起来,通勤时听。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 4 章「Evaluate AI Systems」:讲怎么为应用定义评估标准、搭评估流水线,其中「设计评估流水线」一节和今天的生命周期互相补充,约 1.5 小时。
- Ron Kohavi、Diane Tang、Ya Xu《Trustworthy Online Controlled Experiments》(Cambridge University Press,2020;中文版书名《关键迭代:可信赖的线上对照实验》):第 4 章讲实验平台和实验文化在组织里怎么建立,虽然讲的是 A/B 测试,但「让数据驱动决策变成组织习惯」的经验对评测完全适用。Day 71 会精读其他章节。

### 开源项目与代码

- 今天的 `agentops/evals/registry.py`:放进 AgentOps 仓库,后面几天会继续往 `agentops/evals/` 里加统计、judge 监控和对比报告。
- [promptfoo](https://www.promptfoo.dev/docs/red-team/):虽然今天没用到,但可以看它的配置文件怎么组织测试用例和断言,很多团队直接拿它当评测的「用例格式」,Day 72 会用它做红队。

## 自测

1. 能力集和回归集分开的最大好处是什么?举一个混在一起会误判的例子。

<details><summary>答案</summary>

好处是两种信号不会互相抵消。能力集涨分说明 Agent 变强了,回归集掉分说明有东西被弄坏了。例子:新版本让「复杂退款」类的能力用例从 40% 涨到 60%,同时把「查发票」这个老功能弄坏了几条,总分可能几乎不变,只看总分会以为这次改动没效果,其实是一好一坏。

</details>

2. 什么情况下一条能力用例应该毕业?不毕业会怎样?

<details><summary>答案</summary>

连续多个版本、每次多次运行都稳定通过(比如 ≥95%)时毕业进回归集。不毕业的话,能力集会逐渐饱和,大部分用例都过了,分数顶在高位,新的进步看不出来;同时这些已经稳定的能力也没有被当成回归来保护。

</details>

3. 为什么用例的期望答案应该由领域专家确认,而不是工程师?

<details><summary>答案</summary>

工程师往往不知道业务上的「对」具体是什么,比如退款话术的合规要求、折算规则、哪些承诺不能做。工程师觉得流畅、礼貌的回复,专家可能一眼看出金额或政策错了。另外判断标准本身会随着看样本而变化(criteria drift),需要一个固定的人持续维护。

</details>

4. registry 工具里的 `lint` 和 `health` 分别解决什么问题?为什么 lint 失败要让 CI 失败,health 只是提示?

<details><summary>答案</summary>

lint 保证每条用例的元数据完整、合法,是硬约束,不满足就说明这条用例没人负责或者归属不清,应该拦住。health 是对评测集状态的建议,比如哪些该毕业、负责人是否过于集中,需要人判断后再处理,所以只提示不拦截。

</details>

5. 资深面试题:你们团队有 8 个工程师、3 条产品线,评测集有 600 条,CI 跑一次要 50 分钟,最近大家开始跳过评测直接合并。你会怎么处理?

<details><summary>答案</summary>

先诊断原因:慢和贵是表面,通常还伴随用例过时、没人负责、分数不可信。处理分几块。一,分层跑:MR 只跑相关模块的回归集 P0 和规则断言,控制在几分钟;全量放夜间;发版前跑全量加统计对比。二,清理评测集:给每条用例补负责人和需求号,让各产品线认领,过时的带理由退役,重复的合并,合成用例砍到够用为止。三,分开能力集和回归集,MR 门禁只看回归集和统计显著的下降,降低误报。四,把评测钉进流程:PRD 加验收评测、代码评审看用例改动、事故复盘补用例、CODEOWNERS 管评测目录。五,评测平台组负责耗时和成本,定期公布。最后用一两个月的数据证明:分层后 MR 等待时间降到多少、回归问题在合并前被拦住多少次。

</details>

6. 一个用例总是挂,同事想把它删掉。你会问哪些问题?

<details><summary>答案</summary>

这条用例测的是什么需求、谁负责?它挂是因为 Agent 真的做不到,还是期望答案过时了、判定方式有问题?如果是 Agent 做不到,它应该在能力集还是回归集?如果产品行为改了,有没有需求方确认?删掉之后这个场景还有没有其他用例覆盖?所有问题有答案之后,才决定是修 Agent、改期望,还是带理由退役。

</details>

## 明天预告

Day 69 讲评测里的统计学:样本量、置信区间、显著性。今天的 registry 能告诉你「哪条用例新挂了」,但没法告诉你「总分涨了 2 个点,到底算不算数」。明天用 SupportPilot 的评测数据,把聚类标准误、配对比较、McNemar 检验和功效分析全部跑一遍,你会看到一个看起来不错的提升是怎么在统计面前站不住的。
