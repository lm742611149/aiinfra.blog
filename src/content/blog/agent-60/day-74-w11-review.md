---
title: 'Day 74 · W11 复习:给 AgentOps 设计评测平台'
description: 'W11 的六天写了一堆零件:用例户口本、统计模块、评审监控、线上实验、红队流水线、benchmark 自检。今天把它们串成一份 AgentOps 评测平台的设计文档:目标和非目标、架构、数据模型、关键取舍、风险和上线计划;再写一个对比报告工具,让每个 MR 都能看到「变化有多大、区间多宽、这个评测集看不看得出来」。最后是这一周的资深面试题和坑清单。'
pubDate: 2026-10-12
regime: none
tags: ['eval', 'design-doc', 'platform', 'review', 'senior', 'agent-60']
series: 'agent-60'
day: 74
lang: 'zh'
---

## 今天要解决的问题

这一周的内容比基础篇抽象。基础篇每天都有一个能跑起来的东西;这一周很多时候是在回答「这个数字能不能信」「这件事谁负责」「这个结论怎么证明」。资深工程师的工作,相当一部分就是这类问题。

今天做三件事:

1. 用一页知识地图把六天的内容串起来,看清它们之间的关系。
2. 写一份 AgentOps 评测平台的设计文档。Day 67 你已经按模板写过运行时的设计文档,今天是第二份,重点练习「写取舍」。
3. 写一个对比报告工具 `agentops/evals/compare.py`,把 Day 69 的统计接进 CI,替代「分数涨了就合并」。

学完你应该能:

1. 说清楚离线评测、评审、线上实验、红队、benchmark 各自回答什么问题,在流程里放在哪。
2. 独立写出一份评测平台的设计文档,并能在评审会上为其中的取舍辩护。
3. 在 CI 里给每个改动输出一份带区间和最小可检测差异的对比报告。
4. 回答这一周的资深面试题。

预计用时 5 到 6 小时,设计文档是大头。前置:Day 67(设计文档模板)、Day 68–73。

## 一页知识地图

<figure>
<svg viewBox="0 0 640 380" role="img" aria-label="W11 知识地图:评测平台的各个部分和它们回答的问题">
<rect x="0" y="0" width="640" height="380" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="220" y="16" width="200" height="40" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="234" y="34" fill="var(--ink)">Day 68 组织与流程</text>
<text x="234" y="50" fill="var(--ink-faint)">谁负责、用例从哪来</text>
<line x1="320" y1="56" x2="320" y2="78" stroke="var(--rule)"/>
<rect x="16" y="78" width="608" height="2" fill="var(--rule)"/>
<rect x="16" y="96" width="190" height="78" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="28" y="116" fill="var(--ink)">离线评测</text>
<text x="28" y="136" fill="var(--ink-faint)">新版本在固定题上</text>
<text x="28" y="152" fill="var(--ink-faint)">做得对不对?</text>
<text x="28" y="168" fill="var(--ink-soft)">Day 69 统计</text>
<rect x="225" y="96" width="190" height="78" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="237" y="116" fill="var(--ink)">LLM 评审</text>
<text x="237" y="136" fill="var(--ink-faint)">规则判不了的</text>
<text x="237" y="152" fill="var(--ink-faint)">质量怎么判?</text>
<text x="237" y="168" fill="var(--ink-soft)">Day 70 校准监控</text>
<rect x="434" y="96" width="190" height="78" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="446" y="116" fill="var(--ink)">线上实验</text>
<text x="446" y="136" fill="var(--ink-faint)">对真实客户和业务</text>
<text x="446" y="152" fill="var(--ink-faint)">有没有用?</text>
<text x="446" y="168" fill="var(--ink-soft)">Day 71 A/B 灰度</text>
<rect x="16" y="196" width="296" height="70" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="28" y="216" fill="var(--ink)">红队</text>
<text x="28" y="236" fill="var(--ink-faint)">被攻击时会不会做出越权动作?</text>
<text x="28" y="254" fill="var(--ink-soft)">Day 72 组合生成 + 自适应</text>
<rect x="328" y="196" width="296" height="70" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="340" y="216" fill="var(--ink)">benchmark</text>
<text x="340" y="236" fill="var(--ink-faint)">别人能不能复现、信不信?</text>
<text x="340" y="254" fill="var(--ink-soft)">Day 73 自检 + 版本</text>
<text x="16" y="300" fill="var(--ink-soft)">贯穿始终的三条线:</text>
<text x="16" y="322" fill="var(--ink-soft)">1. 每个数字都带区间和样本量(Wilson、聚类、配对、bootstrap)</text>
<text x="16" y="342" fill="var(--ink-soft)">2. 判定看实际发生了什么(最终状态、工具调用),不看模型说了什么</text>
<text x="16" y="362" fill="var(--ink-soft)">3. 评测资产有主人、有版本、钉进流程</text>
</g>
</svg>
<figcaption>W11 的五个部分各回答一个问题,统计、基于行为的判定、组织流程是贯穿所有部分的三条线。</figcaption>
</figure>

几句串联的话:

- 离线评测是上线的门槛,线上实验是全量的依据。两者都要报区间,线上还要防偷看。
- LLM 评审是离线和线上共用的工具,它本身也是被评测的对象:要校准、要监控漂移、要算成本。
- 红队是一类特殊的离线评测,特殊在用例是对抗性生成的,判定是基于行为的,门槛按严重级别定。
- benchmark 是对外的评测,在内部评测的基础上加了可复现、自检和版本冻结。
- 这一切能长期运转,靠的是 Day 68 讲的组织和流程,不是靠某个人。

## AgentOps 评测平台设计文档

下面是我写的设计文档,按 Day 67 的模板组织。它是 AgentOps 项目里 `docs/design/eval-platform.md` 的内容,Day 100 实现评测平台时会照着它做。你可以直接拿来改成自己的版本,但建议先自己写一遍,再和我的对照。

### 背景

SupportPilot 上线后,评测分散在几个地方:评测集和门禁脚本在仓库里(Day 35、50),评审 prompt 在代码里没有版本,线上质量靠每周人工抽查,红队用例是一次性手写的。随着 AgentOps 平台化(Day 82 起),会有多个团队、多个 Agent 共用平台,现状有三个问题:

- 每个团队重复造评测轮子,口径不统一,结果没法比较。
- 评测结论不可信:分数没有区间,评审没有校准记录,两个版本的差异是不是噪声没人知道。
- 评测和流程脱节:用例没有负责人,改动没有对应用例,线上事故不会回流成用例。

### 目标

1. 任何接入平台的 Agent,一条命令完成离线评测,产出带区间的报告,MR 里自动出现对比结论。
2. LLM 评审作为平台服务提供,有版本、有校准记录、有漂移监控。
3. 线上实验(分流、指标、分析)作为平台能力提供,接入网关。
4. 红队用例生成、运行、回归作为平台能力提供,P0 类别可以阻止发版。
5. 用例和评测资产有统一的元数据规范,能追溯到负责人和需求。

### 非目标

- 不替业务团队写用例,不定义业务上的「正确」。
- 第一期不做通用的标注平台,标注沿用 Day 30 的简单工具,只做数据格式统一。
- 不做公开排行榜。CloudLedger-Bench 只在内部使用,对外发布另行评估。
- 不追求支持所有评测框架,只提供 promptfoo 和自研格式两种用例来源的适配。

### 架构

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="AgentOps 评测平台架构">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="20" width="608" height="56" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="28" y="42" fill="var(--ink)">入口:CLI(agentops eval ...) / CI(MR 报告) / 定时任务(夜间、发版前)</text>
<text x="28" y="62" fill="var(--ink-faint)">输入:Agent 版本、评测集版本、评审版本、运行参数(每题次数等)</text>
<rect x="16" y="94" width="190" height="96" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="28" y="114" fill="var(--ink)">用例注册表</text>
<text x="28" y="134" fill="var(--ink-faint)">元数据 lint</text>
<text x="28" y="152" fill="var(--ink-faint)">能力集 / 回归集</text>
<text x="28" y="170" fill="var(--ink-faint)">红队用例生成</text>
<rect x="225" y="94" width="190" height="96" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="237" y="114" fill="var(--ink)">运行器</text>
<text x="237" y="134" fill="var(--ink-faint)">环境快照恢复</text>
<text x="237" y="152" fill="var(--ink-faint)">并发、重试、K 次采样</text>
<text x="237" y="170" fill="var(--ink-faint)">结果写入结果库</text>
<rect x="434" y="94" width="190" height="96" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="446" y="114" fill="var(--ink)">评审服务</text>
<text x="446" y="134" fill="var(--ink-faint)">评审团、弃权</text>
<text x="446" y="152" fill="var(--ink-faint)">版本 + 校准记录</text>
<text x="446" y="170" fill="var(--ink-faint)">金丝雀漂移检查</text>
<rect x="16" y="208" width="296" height="70" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="28" y="230" fill="var(--ink)">统计与报告</text>
<text x="28" y="250" fill="var(--ink-faint)">聚类区间、配对比较、MDE</text>
<text x="28" y="268" fill="var(--ink-faint)">MR 评论、门禁判定</text>
<rect x="328" y="208" width="296" height="70" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="340" y="230" fill="var(--ink)">线上实验</text>
<text x="340" y="250" fill="var(--ink-faint)">网关分流、trace 打标</text>
<text x="340" y="268" fill="var(--ink-faint)">SRM、delta 方法、护栏</text>
<text x="16" y="306" fill="var(--ink-soft)">存储:结果库(Postgres,每条用例每次运行一行)+ Langfuse(trace)+ 对象存储(环境快照)</text>
</g>
</svg>
<figcaption>平台的六个组件。用例注册表、运行器、评审服务负责「跑」,统计与报告负责「判」,线上实验接在网关上。</figcaption>
</figure>

### 数据模型

最核心的一张表是运行结果,粒度是「一条用例的一次运行」:

| 字段 | 说明 |
| --- | --- |
| run_id | 一次评测运行的 id |
| agent_version | 被测 Agent 的版本(git sha + 配置哈希) |
| suite_version | 评测集版本 |
| judge_version | 评审版本(模型 + prompt + 参数) |
| case_id | 用例 id,关联用例注册表 |
| cluster | 聚类标签(场景 id) |
| trial | 第几次采样(0 到 K-1) |
| outcome | 规则判定结果 0/1 |
| judge_scores | 各评审的结果,JSON |
| cost, latency_ms | 成本和延迟 |
| trace_id | 关联 Langfuse |

为什么粒度到「一次运行」而不是「一条用例」?因为 Day 69 的配对比较、聚类区间、pass^k 都需要逐题逐次的原始数据。只存汇总分数,这些统计全都做不了。存储成本很低,几百条用例乘以几次采样,一次运行几千行。

### 关键取舍

设计文档里最有价值的部分是取舍。下面每一条我都写了选了什么、没选什么、为什么,以及什么情况下应该重新考虑。

**一、MR 门禁看统计结论,不看分数阈值。** 备选方案是「总分低于 X 就拦」。选统计结论的原因:分数阈值会因为评测本身的抖动(Day 69 测过,每题跑一次时总分标准差约 3 个点)频繁误报,大家会开始无视它。门禁规则改为:回归集 P0 用例有新挂的就拦;主指标配对差值的区间整体在 0 以下就拦;其余情况只出报告不拦。代价是小幅退化可能漏过,用夜间全量和发版前的更大评测弥补。重新考虑的条件:评测集扩大到 MDE 小于 2 个点以后,可以加更严格的规则。

**二、评审服务集中管理,而不是各团队自己调模型。** 集中的好处是版本、校准、漂移监控只做一次,口径一致。代价是平台组成为瓶颈,业务团队想加一个新维度的评审要走流程。折中:业务团队可以提交新的评审定义(prompt + 判断维度 + 校准数据),平台组负责校准和上线,约定一周内响应。

**三、每题采样次数默认 K = 3,P0 用例 K = 5。** K 越大越稳定,也越贵。Day 69 的模拟里,从 1 次到 3 次抖动从 3 个点降到 1.7 个点,从 3 次到 5 次只降到 1.3 个点,边际收益递减。夜间全量用 K = 3,MR 里只跑回归集 P0 用 K = 5,发版前全量 K = 5。

**四、线上实验先自研最小版本,不引入 GrowthBook。** 现阶段只有一两个实验同时在跑,自研的分流、SRM 和 delta 方法(Day 71)够用,而且和网关、Langfuse 集成更直接。重新考虑的条件:同时进行的实验超过 5 个、需要互斥分层或序贯检验时,引入 GrowthBook 自托管。

**五、红队用例走统一的用例注册表,不单独建库。** 红队用例也有负责人、严重级别、来源(`source: redteam`),跑在同一个运行器上,只是检测器不同。好处是一套流程;代价是红队用例里有越狱话术,要控制评测集的访问权限,不能随便导出。

### 风险

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 评审模型厂商更新导致评审变化 | 分数出现无法解释的跳变 | 固定模型快照;金丝雀集每周检查;报告里记录评审版本 |
| 评测成本失控 | 团队绕开评测 | 三层运行策略;平台组每周公布成本;超预算告警 |
| 用例集长期不维护 | 评测失去意义 | 注册表 lint 进 CI;health 报告每周发给各负责人;事故复盘模板强制补用例 |
| 统计报告太复杂没人看 | 门禁形同虚设 | MR 报告第一行就是一句话结论,细节折叠 |
| 红队用例泄露 | 被用于攻击 | 评测集访问权限控制,不进公开仓库 |

### 上线计划

- 第一阶段(两周):结果库、运行器、统计与报告上线;SupportPilot 接入;MR 报告只出结论不拦截,观察误报率。
- 第二阶段(两周):评审服务上线,迁移 SupportPilot 现有评审,建金丝雀集;回归集 P0 门禁开始拦截。
- 第三阶段(三周):线上实验接入网关;红队流水线接入夜间运行;第二个 Agent 接入。

### 评测计划

评测平台自己也要被评测:

- 统计模块有单元测试,覆盖已知结果(Day 69 的 7 个测试)。
- 用 A/A 运行(同一个 Agent 版本跑两次)检验门禁的误报率,目标低于 5%。
- 故意引入一个已知退化(比如删掉一条政策说明),检验门禁能不能拦住。
- 每月统计:门禁拦截次数、事后证明是误报的比例、上线后才发现的退化数量。

## 小项目:MR 对比报告

设计文档里第一条取舍落地的工具。它读入两个版本在同一评测集上的逐题结果,输出一份 Markdown 报告:

```python
# agentops/evals/compare.py
"""两个版本在同一评测集上的对比报告。CI 里用它代替「分数涨了就合并」。

用法:python -m agentops.evals.compare data/runs.json --base v1 --cand v2 --cluster scenario --mde-target 0.03
"""
from __future__ import annotations

import argparse
import json

import numpy as np

from agentops.evals import stats as S


def compare(rows: list[dict], base: str, cand: str, cluster: str, mde_target: float) -> tuple[str, str]:
    a = [r[base] for r in rows]
    b = [r[cand] for r in rows]
    cl = [r[cluster] for r in rows]
    n, k = len(rows), len(set(cl))
    lines = [f"# 评测对比:{cand} vs {base}", "", f"用例 {n} 条,{k} 个场景(按场景算聚类标准误)", ""]
    lines += ["| 版本 | 通过率 | 95% 区间(聚类) |", "| --- | --- | --- |"]
    for name, x in ((base, a), (cand, b)):
        m = float(np.mean(x))
        se = S.clustered_se(x, cl)
        lines.append(f"| {name} | {m:.1%} | {m - 1.96 * se:.1%} ~ {m + 1.96 * se:.1%} |")
    pd = S.paired_diff(a, b, cl)
    boot = S.cluster_bootstrap_diff(a, b, cl)
    mc = S.mcnemar(a, b)
    # 最小可检测差异 ≈ (z_0.975 + z_0.8) × 配对差值的(聚类)标准误
    mde = 2.802 * pd["se"]
    lines += [
        "",
        f"- 配对差值:{pd['diff']:+.1%},95% 区间 {pd['ci'][0]:+.1%} ~ {pd['ci'][1]:+.1%}(聚类 bootstrap:{boot[0]:+.1%} ~ {boot[1]:+.1%})",
        f"- 新挂的用例 {mc['a_only']} 条,新修好的 {mc['b_only']} 条,McNemar p = {mc['p_value']:.3f}",
        f"- 这个评测集大约能检测出 {mde:.1%} 以上的差异(α=0.05,功效 80%)",
    ]
    if pd["ci"][0] > 0:
        verdict = "显著提升"
    elif pd["ci"][1] < 0:
        verdict = "显著下降"
    elif mde > mde_target:
        verdict = f"没有结论:评测集太小,检测不出 {mde_target:.0%} 这么小的提升,要么扩集要么多次采样"
    else:
        verdict = "没有显著差异"
    lines += ["", f"**结论:{verdict}**"]
    return "\n".join(lines), verdict


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("runs")
    ap.add_argument("--base", default="v1")
    ap.add_argument("--cand", default="v2")
    ap.add_argument("--cluster", default="scenario")
    ap.add_argument("--mde-target", type=float, default=0.03)
    a = ap.parse_args()
    report, verdict = compare(json.load(open(a.runs)), a.base, a.cand, a.cluster, a.mde_target)
    print(report)
    raise SystemExit(1 if verdict == "显著下降" else 0)
```

用 Day 69 的数据跑一下:

```text
# 评测对比:v2 vs v1

用例 180 条,60 个场景(按场景算聚类标准误)

| 版本 | 通过率 | 95% 区间(聚类) |
| --- | --- | --- |
| v1 | 76.7% | 68.1% ~ 85.3% |
| v2 | 77.8% | 69.3% ~ 86.3% |

- 配对差值:+1.1%,95% 区间 -3.5% ~ +5.7%(聚类 bootstrap:-3.9% ~ +5.6%)
- 新挂的用例 6 条,新修好的 8 条,McNemar p = 0.791
- 这个评测集大约能检测出 6.6% 以上的差异(α=0.05,功效 80%)

**结论:没有结论:评测集太小,检测不出 3% 这么小的提升,要么扩集要么多次采样**
```

说一个写这个工具时犯的错。第一版里 MDE 是这样算的:把 ω² 乘以「用例数 / 场景数」再按场景数开方,想当然地以为这样就「考虑了聚类」。结果报出来 17.5%,比实际大了快三倍。后来改成直接用配对差值的聚类标准误乘以 2.802(也就是 z_0.975 + z_0.8),得到 6.6%,和 Day 69 手算的结果对得上。统计代码一定要拿已知结果对照,凭直觉改公式很容易错,而且错得很隐蔽,因为输出看起来依然像个合理的数。

接进 CI 的方式和 Day 35 一样。GitHub Actions 里加一步,把报告贴到 MR 评论里,退出码 1(显著下降)时让检查失败:

```yaml
# .github/workflows/eval.yml(片段)
      - name: Compare with main
        run: |
          python -m agentops.evals.compare evals/reports/paired.json \
            --base main --cand pr --cluster scenario > report.md
      - name: Comment on PR
        if: always()
        uses: marocchino/sticky-pull-request-comment@v2
        with:
          path: report.md
```

`paired.json` 由评测脚本生成:同一批用例,用 main 分支和 PR 分支的 Agent 各跑一遍,每条一行,带场景标签。如果每题跑 K 次,先对每题取平均再传进来(分数变成 0 到 1 之间的小数,统计函数同样适用)。

## W11 资深面试题

把这一周的面试题汇总在一起。每道题我写了答题要点,完整的回答方式在各天的自测里。

1. 你们团队的评测是怎么维护的?怎么保证它不过时?(Day 68:分工、四个钉子、能力集和回归集、用例户口)
2. 你的改动让成功率提升了 3 个点,怎么证明不是噪声?(Day 69:配对、聚类、重复采样、功效分析、McNemar)
3. 评测集要多大?(Day 69:用 ω² 和想检测的最小差异倒推,180 题只能看出 6 个点以上的变化)
4. 线上每天几千条对话要做质量评估,怎么设计?(Day 70:分层抽样、评审团、弃权、校正带区间、金丝雀漂移、人工成本)
5. 离线评测涨了,线上 A/B 没变化,怎么分析?(Day 71:SRM、功效、分布差异、指标对应、延迟成本)
6. 为什么不能每天看实验结果?(Day 71:偷看抬高假阳性率,A/A 模拟 21.9%)
7. 设计一个能发起退款的 Agent 的持续红队方案。(Day 72:分类表、基于行为的检测、组合生成、自适应攻击、分层运行、P0 门槛)
8. 怎么设计一个可信的内部 benchmark?(Day 73:环境快照、最终状态判分、参考解和空 Agent 自检、版本、污染、报告格式)
9. 设计一个评测平台。(今天:组件、数据模型粒度、门禁取舍、评审集中管理、风险、上线计划、平台自己的评测)

第 9 题是系统设计题,面试时间一般 45 分钟。我建议的回答顺序:先问清楚规模和用户(几个 Agent、几个团队、每天多少流量),再讲目标和非目标,然后画架构、讲数据模型,重点花时间在两三个取舍上,最后讲风险和怎么验证平台本身。面试官最想听的通常是取舍和「你怎么知道它有用」。

## 本周坑清单

| 坑 | 后果 | 正确做法 |
| --- | --- | --- |
| 用 p ± 1.96·SE 算回归集通过率 | 20/20 全过时区间宽度为零 | 用 Wilson 区间 |
| 场景 × 说法的用例当独立样本 | 区间偏窄,误判提升 | 聚类标准误,报告簇数 |
| 比较两个版本时各算各的区间 | 区间过宽或结论错误 | 逐题配对,算差值区间 |
| 区间跨零就说「没效果」 | 漏掉真实但小的提升 | 同时报告 MDE |
| 调低温度让评测稳定 | 评的不是线上那个 Agent | 重复采样 |
| 校准集按线上比例抽 | TNR 区间很宽,校正不准 | 差评过采样 |
| 评审投票就以为可靠 | 相关错误投不掉 | 评审多样化,不一致送人工 |
| 评审升级不做检查 | 评审悄悄变松,分数虚高 | 版本化 + 金丝雀集 |
| 按会话分析按客户分流的实验 | 标准误低估一半 | 按客户聚合,delta 方法 |
| 每天看实验结果,显著就停 | 假阳性率 5% 变成 22% | 固定时长或序贯检验 |
| 红队用 LLM 判断是否被攻击 | 漏掉「嘴上拒绝、工具已调用」 | 基于工具调用和输出的检测器 |
| 0 次攻击成功就说安全 | 12 条用例上限还有 24% | 带区间汇报,扩大用例 |
| 拒绝类任务只看最终状态 | 空 Agent 也能通过 | must_say + 空 Agent 自检 |
| benchmark 原地修改任务 | 新旧分数不可比 | 发新版本 |
| 检查工具假设数据干净 | 遇到脏数据直接崩 | 先防御再检查(registry 的 KeyError) |

## 动手练习

1. 写你自己的 AgentOps 评测平台设计文档,按今天的结构:背景、目标、非目标、架构、数据模型、至少三条关键取舍(每条写选了什么、没选什么、为什么、什么时候重新考虑)、风险、上线计划、评测计划。写完再和本文对照,找出至少两处你的设计和我不一样并说明理由。
2. 把 `agentops/evals/compare.py` 接进 SupportPilot 的 CI:评测脚本输出 `paired.json`(main 和 PR 两个版本、每题 K 次取平均、带场景标签),MR 里自动贴报告。
3. 用 A/A 运行检验门禁:同一个 Agent 版本跑两次,看对比报告的结论。重复 10 次(或者用模拟),统计误报次数。
4. 故意引入一个已知退化(比如删掉 system prompt 里关于「年付当月不退」的那一句),看门禁能不能拦住。拦不住的话,用 MDE 解释原因。
5. 准备第 9 题:找一个人(或者对着镜子)用 30 分钟讲一遍评测平台设计,录下来回看,记下讲得不清楚的地方。

**验收标准**:设计文档完整,取舍部分有理有据;CI 里能看到对比报告;A/A 的误报率和已知退化的检出结果有实际数据;系统设计能在 30 分钟内讲完。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 设计文档 | 实施前写的方案文档,包括目标、方案、取舍、风险,供评审 |
| 非目标 | 明确不做的事,防止范围蔓延 |
| 关键取舍 | 方案里有多个可行选项时,选了什么、为什么、代价是什么 |
| 门禁 | CI 里根据评测结果决定能否合并的规则 |
| A/A 运行 | 同一版本跑两次,用来检验评测或实验系统本身的误报率 |
| 运行粒度 | 结果存储到「每条用例每次运行」,统计分析才做得了 |
| 评审版本 | 模型、prompt、参数一起打的版本号 |

## 常见误区

**设计文档就是把要做的功能列出来。** 功能列表谁都会写,设计文档的价值在于非目标、取舍和风险。评审时被追问最多的也是这些。

**评测平台越全越好。** 第一期只解决最痛的问题(结论不可信、流程脱节),标注平台、公开排行榜这些先列为非目标。

**门禁越严越好。** 门禁误报多了,大家就会想办法绕开它。门禁要按统计结论判定,并且用 A/A 运行测出误报率。

**只存汇总分数。** 配对、聚类、pass^k 都要逐题逐次的原始结果。原始数据很便宜,丢了就补不回来。

**平台做好了,评测自然就有人维护。** 平台只解决「怎么评」,「评什么」和「什么是对」还是要靠 Day 68 的分工和流程。

**评测平台不需要被评测。** 它的误报率、漏报率、成本都要测量,否则你不知道它到底有没有用。

## 学习资料

### 文档与文章

- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):这一周的总参考,复习时完整重读一遍,对照知识地图,约 40 分钟。
- [Evan Miller · Adding Error Bars to Evals](https://arxiv.org/abs/2411.00640):统计部分的出处,把五条建议和你的设计文档里的门禁规则对照一遍。
- [Hamel Husain、Shreya Shankar · LLM Evals FAQ](https://hamel.dev/blog/posts/evals-faq/):里面关于「要不要买评测工具」「评测团队怎么组织」的几条,写设计文档的取舍时有参考价值。
- [OpenAI · Evaluation best practices](https://platform.openai.com/docs/guides/evaluation-best-practices):OpenAI 的评测最佳实践文档,和 Anthropic 那篇对照,看两家在评测流程上的共同点。
- [Langfuse · Evaluation 概览](https://langfuse.com/docs/evaluation/overview):AgentOps 用 Langfuse 存 trace,它的数据集、实验和评分功能可以作为评测平台的一部分,写设计文档时考虑「自研还是用它」。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1aZpw6DEMg&autoplay=0&high_quality=1" title="手把手教你构建大模型评测集：从维度设计到自动化落地" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>天涯3615 · 手把手教你构建大模型评测集:从维度设计到自动化落地 · 38 分钟,讲评测集从设计到自动化的完整过程,看完对照今天的平台架构,想想它对应哪几个组件。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV11vu96nERa&autoplay=0&high_quality=1" title="【AI测评】EvalScope/Langfuse（大模型评估与性能基准测试框架）可观测性平台/ai测评推荐/ai测评工程师/ai测评网站/大模型评测方法与原理" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>学掌门 ·【AI测评】EvalScope/Langfuse 大模型评估与性能基准测试框架 · 15 集长合集,看现成的评测框架和平台怎么用,作为「自研还是用现成」取舍的参考,挑讲 Langfuse 的几集看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/tqUDjc1HzO4" title="How to Automate AI Evals (Correctly)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · How to Automate AI Evals (Correctly) · 27 分钟,讲评测自动化的正确顺序,和今天的平台设计互相印证。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/mF4CaijvJos" title="How To Build AI Evals" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · How To Build AI Evals · 34 分钟,从头到尾讲一遍搭评测的流程,适合复习。</figcaption>
</figure>

### 书籍

- Shreya Shankar、Hamel Husain《Evals for AI Engineers》(O'Reilly,2026):全书的「分析、度量、生产与改进」三段式,正好对应这一周从流程到统计到线上的结构,复习时读第三、四部分。
- Ron Kohavi 等《Trustworthy Online Controlled Experiments》(Cambridge University Press,2020):第 4 章讲实验平台怎么建,和今天的评测平台设计有很多可以借鉴的地方。
- Chip Huyen《AI Engineering》(O'Reilly,2025)第 3、4 章:评测方法论和评估 AI 系统,作为这一周的总复习读物。

### 开源项目与代码

- 这一周写的 `agentops/evals/`(registry、stats、judge_monitor、compare)、`agentops/experiments/ab.py`、`agentops/redteam/`、`agentops/bench/core.py`,以及 `tests/` 下的 9 个测试。确认都在仓库里,`pytest` 全部通过。
- [promptfoo](https://www.promptfoo.dev/docs/red-team/) 和 [GrowthBook](https://docs.growthbook.io/statistics/overview):设计文档里「自研还是引入」两处取舍对应的现成工具。

## 自测

1. 离线评测、LLM 评审、线上实验、红队、benchmark 各自回答什么问题?

<details><summary>答案</summary>

离线评测:新版本在固定题目上做得对不对。LLM 评审:规则判不了的质量怎么判(它本身也要被评测)。线上实验:对真实客户和业务指标有没有影响。红队:在对抗输入下会不会做出越权动作。benchmark:结论能不能被别人复现和信任。

</details>

2. 为什么评测结果要存到「每条用例每次运行」的粒度?

<details><summary>答案</summary>

配对比较需要逐题对齐两个版本,聚类区间需要场景标签,pass^k 需要每题多次运行的结果,McNemar 需要逐题的一致性。只存汇总分数这些统计都做不了。原始数据存储成本很低。

</details>

3. MR 门禁为什么不用「总分低于阈值就拦」?你的门禁规则是什么?

<details><summary>答案</summary>

评测本身有抖动(每题一次时总分标准差约 3 个点),固定阈值会频繁误报,大家会无视或绕开。规则:回归集 P0 用例有新挂的就拦;主指标配对差值区间整体在 0 以下就拦;其余只出报告。用 A/A 运行测误报率,用已知退化测检出率。

</details>

4. 对比报告里为什么要写 MDE?

<details><summary>答案</summary>

区间跨零时,读者需要知道是「真的没差别」还是「评测集太小看不出来」。MDE 说明了这个评测集能检测的最小变化,比如 6.6 个点。如果关心的改动预期只有 3 个点,结论应该是「没有结论,需要扩集或多次采样」,而不是「没效果」。

</details>

5. 资深面试题:设计一个供多个团队使用的 Agent 评测平台。请讲目标、架构和两个最重要的取舍。

<details><summary>答案</summary>

先问规模:几个 Agent、几个团队、每天多少流量、现在的痛点。目标:一条命令出带区间的报告、MR 自动对比、评审集中管理有校准和漂移监控、线上实验和红队作为平台能力、用例有统一元数据。非目标:不替业务定义正确、第一期不做标注平台和公开榜单。架构:用例注册表、运行器(快照恢复、K 次采样)、评审服务、统计与报告、线上实验(接网关),结果存到每条用例每次运行的粒度。取舍一:门禁按统计结论而不是分数阈值,牺牲对小退化的敏感度换取低误报,用夜间和发版前的大评测补。取舍二:评审集中管理,换来口径一致和监控,代价是平台组成为瓶颈,用提交流程和响应时限折中。最后讲风险(评审漂移、成本、用例过时、报告没人看)和平台自身的评测(A/A 误报率、已知退化检出率、每月统计)。

</details>

6. 写对比工具时,MDE 第一版算出 17.5%,修正后是 6.6%。这件事给你什么教训?

<details><summary>答案</summary>

统计代码的错误往往不会报错,输出依然像一个合理的数字。必须拿已知结果对照(手算、论文里的例子、其他方法交叉验证),并且写成测试。凭直觉改公式很容易出错。

</details>

## 明天预告

Day 75 进入 W12 模型层,第一天讲选模型是工程决策:闭源、开源、大小模型怎么搭。这一周搭好的评测是做选型的前提:选模型时不看公开榜单,而是用自己的评测集和 CloudLedger-Bench 去比,把能力、工具调用可靠性、延迟、价格、合规放进同一张表,算出总拥有成本。
