---
title: 'Day 95 · W14 复习:前沿技术选型报告'
description: '这一周看了 Coding Agent、Computer Use、语音、Deep Research、Agent 互联和产品交互,每样都诱人。资深工程师要回答的是「我们明年该不该做 X」。今天把一周内容串成一张图,给出技术选型报告的模板,用加权打分矩阵加敏感性分析完整写一份「要不要做语音客服 Agent」的报告,最后是本周资深面试题汇总和坑清单。'
pubDate: 2026-10-12
regime: none
tags: ['review', 'tech-strategy', 'decision-making', 'interview', 'agent-60']
series: 'agent-60'
day: 95
lang: 'zh'
---

## 今天要解决的问题

W14 讲的六样东西,每一样单独拿出来都能写一篇「我们也应该做」的提案。但团队的人手和预算是有限的。资深工程师在这个阶段的价值,不是知道得最多,而是能帮团队在这些选项里做出站得住的取舍,并且把理由写下来,让别人能审、能反驳、半年后能复盘。

学完今天你应该能:

1. 用一张图回顾 W14 六天的核心判断,每天能用两三句话讲清楚。
2. 写出一份结构完整的技术选型报告:背景、选项、标准、证据、建议、风险、复盘条件。
3. 用加权打分矩阵比较选项,并用敏感性分析判断结论稳不稳。
4. 回答本周的资深面试题,知道每道题的答题骨架。

预计用时 3 到 4 小时。前置:Day 89 到 94。

## 一页知识地图

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="W14 前沿形态知识地图">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <rect x="245" y="120" width="150" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="320" y="144" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">同一个 Agent 循环</text>
  <text x="320" y="162" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">换了环境和接口</text>
  <rect x="20" y="20" width="180" height="52" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="110" y="42" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">D89 Coding Agent</text>
  <text x="110" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">ACI、沙箱、SWE-bench</text>
  <rect x="230" y="20" width="180" height="52" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="320" y="42" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">D90 Computer Use</text>
  <text x="320" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">三条路线、截图成本</text>
  <rect x="440" y="20" width="180" height="52" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="530" y="42" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">D91 语音</text>
  <text x="530" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">延迟预算、打断</text>
  <rect x="20" y="228" width="180" height="52" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="110" y="250" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">D92 Deep Research</text>
  <text x="110" y="268" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">并行、压缩、引用核验</text>
  <rect x="230" y="228" width="180" height="52" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="320" y="250" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">D93 A2A 互联</text>
  <text x="320" y="268" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">不透明 Agent、信任</text>
  <rect x="440" y="228" width="180" height="52" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="530" y="250" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">D94 产品交互</text>
  <text x="530" y="268" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">自主分级、可撤销</text>
  <line x1="110" y1="72" x2="270" y2="120" stroke="var(--rule)"/>
  <line x1="320" y1="72" x2="320" y2="120" stroke="var(--rule)"/>
  <line x1="530" y1="72" x2="370" y2="120" stroke="var(--rule)"/>
  <line x1="110" y1="228" x2="270" y2="176" stroke="var(--rule)"/>
  <line x1="320" y1="228" x2="320" y2="176" stroke="var(--rule)"/>
  <line x1="530" y1="228" x2="370" y2="176" stroke="var(--rule)"/>
</svg>
<figcaption>上面三个是 Agent 去操作不同的「环境」:代码仓库、图形界面、声音。下面三个是 Agent 怎么组织长任务、怎么和别的 Agent 协作、怎么和人协作。中间那个循环从 Day 9 起就没变过。</figcaption>
</figure>

每天的核心判断,压缩成两三句话:

| 天 | 核心判断 |
| --- | --- |
| 89 Coding Agent | 工具接口的价值和模型能力强相关,换代后要用评测重新衡量;编辑写入前做校验;沙箱要系统隔离和命令审批两层。 |
| 90 Computer Use | 能用 API 别点界面,固定流程让 Agent 写脚本而不是每次都点;截图历史要裁剪,否则成本按平方涨;网页就是攻击面。 |
| 91 语音 | 主角是时间,首音频最大的一块常是静音等待;流程型业务用级联方便审计;打断后历史要截断到用户真正听到的地方。 |
| 92 Deep Research | 研究员上下文隔离、只交压缩笔记;按复杂度分配预算;引用要核验,有引用不等于可信。 |
| 93 A2A | MCP 连工具,A2A 连不透明的 Agent;协议的价值在跨边界,团队内部别为用协议而用;要处理代表谁调用的问题。 |
| 94 产品交互 | 自主程度是按动作设计的;把动作改造得可逆往往比换模型更有效;用采纳率等数据逐步放权。 |

## 技术选型报告怎么写

我见过的选型讨论,大多停留在「某某公司在做」「这个很火」「我试了一下挺好用」。一份能让管理层拍板、半年后能复盘的报告,至少要有这几部分:

1. **背景和要解决的问题**:业务上的痛点是什么,用数字说话。比如「客服电话每月 4 万通,其中 60% 是查订单和退款进度」。
2. **选项**:至少三个,其中一个必须是「不做或者晚点做」。没有这个选项的报告,结论通常是预设的。
3. **评估标准和权重**:先定标准再打分,权重要和相关方一起定,并写下为什么这么定。
4. **证据**:每个分数背后的依据,能实测的要实测(做个原型、跑个评测),不能实测的标明是估计。
5. **建议和理由**:选哪个,为什么,以及为什么不选其他的。
6. **风险和缓解**:最可能出错的三件事,出了怎么办。
7. **敏感性**:结论在多大程度上依赖某个假设。如果改一个权重结论就翻了,要老实写出来。
8. **复盘条件**:什么情况下要重新评估,比如「端到端实时模型的中文电话场景字错误率降到 X 以下」「竞品上线了同类功能」。

第 8 条最容易被忽略,但它决定了这份报告是不是一份活文档。Day 106 讲架构决策记录(ADR)时会再展开。

## 打分矩阵和敏感性分析

加权打分矩阵大家都会画,问题在于它算出来的那个数看起来很精确,其实非常依赖权重。所以我每次都会加两种敏感性分析:

- **单因素**:把每个权重单独上调、下调 50%,看第一名会不会换人。会换的那几个权重,就是讨论时要重点对齐的地方。
- **随机抖动**:把所有权重同时在原值的 0.5 到 1.5 倍之间随机抖几千次,统计每个方案拿第一的比例。比例很高,说明结论稳;接近一半,说明这其实是个难以区分的选择,要靠更多证据或者高层判断。

代码很短,放在下面的练习里。它的意义不在于算法有多复杂,而在于把「这个结论有多脆弱」变成了一个可以讨论的数字。

## 完整示例:明年要不要做语音客服 Agent

下面是一份按模板写的示例报告。**分数和数字都是示例**,目的是演示写法,你要用自己团队的数据重填。

**背景**:CloudLedger 客服电话每月约 4 万通(示例数字),文字渠道的 SupportPilot 已经上线,原样采纳率在主要工单类型上超过 90%。业务方希望把同样的能力扩展到电话。

**选项**:A 现在就做语音客服(级联架构,全量接入);B 继续优化文字渠道,语音只在一两类工单上做试点;C 明年不做,观望端到端模型的成熟度。

**标准和权重**:业务价值 30%、技术成熟度 20%、团队能力匹配 15%、风险与合规 20%、成本 15%。风险权重给得不低,因为电话场景的误操作和录音合规问题一旦出事,影响面比文字渠道大。

**打分**(1 到 5 分,风险和成本也按「越高越好」打,即风险越低、成本越低分越高):

| 选项 | 业务价值 | 技术成熟度 | 团队能力匹配 | 风险与合规 | 成本 | 加权得分 |
| --- | --- | --- | --- | --- | --- | --- |
| A 现在就做 | 5 | 4 | 4 | 2 | 2 | 3.60 |
| B 文字为主,语音试点 | 3 | 5 | 5 | 4 | 4 | 4.05 |
| C 观望 | 1 | 5 | 3 | 5 | 5 | 3.50 |

**敏感性**:单个权重上下浮动 50%,第一名都不变;所有权重随机抖动 5000 次,B 拿第一的比例约 97.7%,A 约 2.3%,C 为 0。这个结论在这组分数下是稳的。

**建议**:选 B。理由是它复用了 SupportPilot 已有的评测、工具和审批,风险可控;语音试点能拿到真实的延迟、字错误率、转人工率数据,为下一年的全量决策提供证据。不选 A,是因为风险和成本两项拉分太多,而且现在没有电话场景的自有评测数据,全量上线等于盲飞。不选 C,是因为完全不做就拿不到数据,一年后还是没法决策。

**风险**:试点工单类型选得太简单,数据不代表全量情况;ASR 在方言和噪声环境下表现差;录音告知和外呼规定的合规要求。缓解:试点选两类难度不同的工单;在自有录音上测字错误率;上线前法务评审。

**复盘条件**:试点三个月后,如果首音频 P95 小于 1.5 秒、转人工率不高于人工渠道、无合规问题,则在下一个预算周期评估全量方案 A。

你会发现,真正花时间的不是算分,而是每一格分数背后的依据。在评审会上,别人质疑的几乎都是分数,而不是权重的数学。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1SqAVzLEci&autoplay=0&high_quality=1" title="2026 AI Agent框架终极指南：从入门到生产部署的选型地图，10大框架五大范式，一期全讲透" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>唐国梁Tommy · 2026 AI Agent框架终极指南:从入门到生产部署的选型地图 · 17 分钟,看别人怎么组织一张选型地图,注意它的维度划分,可以借来做你自己报告的标准。</figcaption>
</figure>

## 本周资深面试题汇总

每道题给答题骨架,详细答案在各天的自测里。

1. **设计一个修 bug 的 Coding Agent,工具集怎么定、怎么证明有效?**(Day 89)骨架:约束(仓库规模、语言、构建成本)→ 五块设计(工具、上下文、执行环境、验证、停止)→ 对比实验(只给 bash 的基线 vs 你的工具集,多次运行,统计检验)→ 去掉没带来显著提升的工具。
2. **老系统没 API,让 Agent 每天自动处理 500 单,怎么评估和设计?**(Day 90)骨架:能否拿到底层数据 → 路线选择(DOM 优先、固定流程沉淀成脚本)→ 写操作分级审批 → 离线评测和灰度 → ROI。
3. **电话客服语音 Agent,首音频 P95 小于 1.5 秒,怎么设计和验证?**(Day 91)骨架:级联架构和理由 → 每一段的延迟优化 → 写操作的身份核验 → 打断处理 → 分段打点、P95、压测、灰度。
4. **给投资团队设计一个尽调研究 Agent。**(Day 92)骨架:主管加研究员、来源分级 → 压缩和引用 → 三层质量保障 → 分层模型和预算上限 → 持久化执行和发版。
5. **20 个团队各有 Agent,怎么设计互联?要不要上 A2A?**(Day 93)骨架:团队内外分开 → 跨团队用 A2A 的理由 → 目录、鉴权(代表用户)、网关、规范、版本治理 → 试点推广。
6. **客服负责人不放心用 Agent,怎么推动落地?**(Day 94)骨架:弄清担心什么 → 按动作定自主级别 → 协作者模式起步、展示依据 → 埋点和放权规则 → 用数据共同决策。
7. **今天的题:你的团队明年该做 Coding Agent、语音、还是 Deep Research?你怎么做这个决定?** 骨架:先问业务问题而不是技术问题 → 至少三个选项含「不做」→ 和相关方定标准和权重 → 能实测的做原型拿证据 → 打分加敏感性分析 → 写清建议、风险、复盘条件。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LP5OCa20Zpg" title="Tips for building AI agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Anthropic · Tips for building AI agents · 18 分钟,Anthropic 几位工程师讨论什么时候该做 Agent、什么时候不该,是选型讨论很好的参照。</figcaption>
</figure>

## 本周坑清单

- **Coding Agent**:工具越加越多从不删;编辑不校验导致越改越乱;拿 SWE-bench 分数直接比模型;沙箱只做一层。
- **Computer Use**:截图历史全留;Retina 屏不换算坐标;每天让 Agent 重复点同一个流程;把「没报错」当成完成;以为过滤隐藏文字就能防注入。
- **语音**:以为延迟都在 LLM;整段生成完才送 TTS;打断后整段回复写进历史;文本提示词直接拿来用;只看平均延迟。
- **Deep Research**:原文直接交给写作模型;有引用就以为可信;简单问题也派一堆子 Agent;只靠搜索排名选来源;预算到了悄悄截断。
- **A2A**:把 A2A 当成另一种 MCP;团队内部也上协议;忘带版本头;只按调用方身份授权;信任对方 Agent 的返回。
- **产品交互**:问「我们是第几级」;以为放权只能靠换模型;把完整推理当透明度;整个产品一起放权;错误提示只写「出错了」。
- **选型本身**:没有「不做」选项;先有结论再凑分数;只给一个精确的得分不做敏感性分析;报告里没有复盘条件。

## 动手练习

**目标**:实现打分矩阵和两种敏感性分析;为本周六个方向中的一个,给你自己的团队(或者 CloudLedger)写一份完整的技术选型报告。

**第 1 步:建目录。**

```bash
mkdir -p agentops/strategy && cd agentops/strategy
uv init --python 3.12 && uv add --dev pytest
```

**第 2 步:写打分矩阵。**

```python
# agentops/strategy/decision_matrix.py
"""技术选型的加权打分矩阵,外加两种敏感性分析:
1) 单个权重上下浮动时,排名会不会变;2) 随机抽权重很多次,每个方案赢的概率。
打分矩阵的价值不在算出一个数,而在逼大家把「为什么」摊开,并看清结论有多脆弱。"""
from __future__ import annotations

import random
from dataclasses import dataclass


@dataclass(frozen=True)
class Criterion:
    name: str
    weight: float
    note: str = ""


def weighted(scores: dict[str, dict[str, float]], criteria: list[Criterion]) -> dict[str, float]:
    total = sum(c.weight for c in criteria)
    return {
        opt: round(sum(s[c.name] * c.weight for c in criteria) / total, 3)
        for opt, s in scores.items()
    }


def ranking(scores, criteria) -> list[str]:
    w = weighted(scores, criteria)
    return sorted(w, key=lambda o: -w[o])


def one_at_a_time(scores, criteria, swing: float = 0.5) -> list[str]:
    """每个权重单独乘以 (1±swing),报告哪些会让第一名换人。"""
    base = ranking(scores, criteria)[0]
    flips = []
    for i, c in enumerate(criteria):
        for f in (1 - swing, 1 + swing):
            changed = criteria[:i] + [Criterion(c.name, c.weight * f)] + criteria[i + 1:]
            top = ranking(scores, changed)[0]
            if top != base:
                flips.append(f"{c.name} 权重 ×{f:g} 时,第一名从「{base}」变成「{top}」")
    return flips


def win_probability(scores, criteria, n: int = 5000, seed: int = 7) -> dict[str, float]:
    """权重在原值的 0.5 到 1.5 倍之间随机抖动,统计每个方案拿第一的比例。"""
    rng = random.Random(seed)
    wins = {o: 0 for o in scores}
    for _ in range(n):
        jittered = [Criterion(c.name, c.weight * rng.uniform(0.5, 1.5)) for c in criteria]
        wins[ranking(scores, jittered)[0]] += 1
    return {o: round(k / n, 3) for o, k in wins.items()}
```

**第 3 步:写语音客服的示例。**

```python
# agentops/strategy/voice_decision.py
"""示例:「明年要不要做语音客服 Agent」。分数是示例,不是结论,你要用自己团队的数据重填。"""
from decision_matrix import Criterion, one_at_a_time, weighted, win_probability

CRITERIA = [
    Criterion("业务价值", 0.30, "能接住多少电话量、省多少人力"),
    Criterion("技术成熟度", 0.20, "级联方案成熟;端到端实时模型中文电话场景还要验证"),
    Criterion("团队能力匹配", 0.15, "现有 SupportPilot 的评测、工具、审批能直接复用多少"),
    Criterion("风险与合规", 0.20, "录音告知、误操作、口音和噪声导致的错误"),
    Criterion("成本", 0.15, "ASR/TTS/实时模型费用和电话线路费用"),
]

SCORES = {   # 1 到 5 分,越高越好(风险和成本也是「越高越好」,即风险越低、成本越低分越高)
    "A 现在就做语音客服(级联)": {"业务价值": 5, "技术成熟度": 4, "团队能力匹配": 4, "风险与合规": 2, "成本": 2},
    "B 先做文字渠道,语音只做试点": {"业务价值": 3, "技术成熟度": 5, "团队能力匹配": 5, "风险与合规": 4, "成本": 4},
    "C 明年不做,观望": {"业务价值": 1, "技术成熟度": 5, "团队能力匹配": 3, "风险与合规": 5, "成本": 5},
}

if __name__ == "__main__":
    print(weighted(SCORES, CRITERIA))
    for line in one_at_a_time(SCORES, CRITERIA):
        print(" ", line)
    print(win_probability(SCORES, CRITERIA))
```

```bash
uv run python voice_decision.py
```

输出大致长这样:三个选项的加权得分(A 3.6、B 4.05、C 3.5),单因素分析没有输出任何翻盘的行,随机抖动下 B 拿第一的比例约 0.977。

**第 4 步:写测试。** 第二个测试用一个构造出来的「势均力敌」例子,验证敏感性分析能把脆弱的结论识别出来。

```python
# agentops/strategy/test_decision.py
from decision_matrix import Criterion, one_at_a_time, ranking, weighted, win_probability
from voice_decision import CRITERIA, SCORES


def test_weighted_math():
    c = [Criterion("x", 1), Criterion("y", 3)]
    s = {"A": {"x": 5, "y": 1}, "B": {"x": 1, "y": 3}}
    assert weighted(s, c) == {"A": 2.0, "B": 2.5}
    assert ranking(s, c) == ["B", "A"]


def test_voice_example_is_robust():
    w = weighted(SCORES, CRITERIA)
    top = max(w, key=w.get)
    assert top.startswith("B")
    probs = win_probability(SCORES, CRITERIA)
    assert abs(sum(probs.values()) - 1) < 1e-9
    assert probs[top] > 0.9                         # 权重随便抖,B 基本都赢
    assert one_at_a_time(SCORES, CRITERIA) == []    # 单个权重 ±50% 也翻不了盘


def test_close_call_detected():
    c = [Criterion("价值", 0.5), Criterion("风险", 0.5)]
    s = {"做": {"价值": 5, "风险": 2}, "不做": {"价值": 2, "风险": 4.8}}
    assert one_at_a_time(s, c)                      # 结论脆弱:改一个权重就翻盘
```

```bash
uv run pytest -q
```

输出大致长这样:`3 passed`。那个势均力敌的例子里,「做」只领先 0.1 分,价值权重减半或风险权重加 50% 都会翻盘,随机抖动下两个选项拿第一的比例大约是 57% 对 43%。这种结果写进报告时,结论应该是「两者难分高下,需要更多证据」,而不是「建议做」。

**第 5 步:写你自己的报告。** 从本周六个方向里选一个(Coding Agent 内部工具、Computer Use 自动化老系统、语音客服、Deep Research 内部工具、跨团队 A2A、Agent 自主程度改造),按模板的八个部分写完,打分矩阵用第 2 步的代码算,敏感性结果贴进报告。至少一个分数要有你实测的依据,比如用本周某一天的练习代码跑出来的数据。

**验收标准**:3 个测试通过;报告八个部分齐全;至少三个选项且包含「不做」;有敏感性分析结果;有至少一项实测证据;有明确的复盘条件。找一个同事或朋友读一遍,让他挑出最弱的一个分数,你能拿出依据或者承认它是估计。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 技术选型报告 | 比较多个技术方案、给出建议和理由的文档,用于决策和事后复盘 |
| 加权打分矩阵 | 按标准给每个选项打分,再按权重加权求和的比较方法 |
| 敏感性分析 | 改变输入假设(权重、分数),观察结论是否改变,用来判断结论的稳健程度 |
| 单因素分析 | 每次只改一个参数的敏感性分析 |
| 随机抖动 | 同时随机扰动所有权重很多次,统计每个结论出现的比例 |
| 复盘条件 | 触发重新评估这个决定的条件 |
| ADR(架构决策记录) | 记录一个架构决定的背景、选项、决定和后果的简短文档 |

## 常见误区

**选项里没有「不做」。** 没有这个对照,报告很容易变成为预设结论找理由。

**先有结论再凑分数。** 标准和权重要先定、和相关方一起定,打分前写下来。

**只报一个精确得分。** 3.6 和 4.05 看起来差很多,实际上可能改一个权重就翻。一定要做敏感性分析。

**所有分数都是拍脑袋。** 至少关键的几项要有实测证据,哪怕是一个两天做出来的原型。

**报告写完就扔。** 没有复盘条件的报告,半年后没人知道当初为什么这么选,也不知道什么时候该改。

## 学习资料

### 文档与文章

- [Anthropic:Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):选型时回答「这件事需不需要 Agent」的最好参照,20 分钟。
- [Cognition:Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents):和 Day 92 的 Anthropic 复盘放在一起读,练习在两种对立观点之间做判断,20 分钟。
- [Anthropic:Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents):本周每个方向都绕不开上下文管理,复习用,20 分钟。
- [Levels of Autonomy for AI Agents(arXiv 2506.12469)](https://arxiv.org/abs/2506.12469):选型时评估「需要多少人工参与」的框架,复习用。

### B 站视频

- 唐国梁Tommy《2026 AI Agent框架终极指南:从入门到生产部署的选型地图》:已嵌入正文。
- 葬送的模数师《【Sequoia 2026】从Vibe Coding到Agentic Engineering (Andrej Karpathy) [中英字幕]》:30 分钟,Karpathy 2026 年对 Agent 工程方向的判断,适合放在选型报告的「行业趋势」部分参考。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1D9dgBHEhq&autoplay=0&high_quality=1" title="【Sequoia 2026】从Vibe Coding到Agentic Engineering (Andrej Karpathy) [中英字幕]" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>葬送的模数师 · 【Sequoia 2026】从Vibe Coding到Agentic Engineering (Andrej Karpathy) [中英字幕] · 30 分钟,听他怎么判断哪些事情 Agent 现在能做、哪些还不能。</figcaption>
</figure>

### 其他经典视频

- Anthropic《Tips for building AI agents》:已嵌入正文。
- Sequoia Capital《Andrej Karpathy: From Vibe Coding to Agentic Engineering w/ Stephanie Zhan》:上面 B 站中字版的原版。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/96jN2OCOfLs" title="Andrej Karpathy: From Vibe Coding to Agentic Engineering w/ Stephanie Zhan" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Sequoia Capital · Andrej Karpathy: From Vibe Coding to Agentic Engineering · 30 分钟,英文原版。</figcaption>
</figure>

### 书籍

- Mark Richards、Neal Ford《Fundamentals of Software Architecture》(O'Reilly, 2020):第 19 章「Architecture Decisions」,讲怎么收集信息、论证、记录和沟通一个架构决定,以及几种常见的反模式,1 小时。英文原版。
- Will Larson《Staff Engineer: Leadership Beyond the Management Track》(2021):讲资深工程师怎么写技术策略和推动决策,挑「Write engineering strategy」相关的部分读,1 小时。英文原版。

### 开源项目与代码

- 本周六天的练习代码:`agentops/aci`、`agentops/browser`、`agentops/voice`、`agentops/research`、`agentops/a2a`、`agentops/ux`。写选型报告时,用它们跑出至少一项实测证据。
- [SWE-agent/mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent):如果你的报告是关于 Coding Agent 的,用它做基线最方便。

## 自测

**1. 一份技术选型报告为什么必须包含「不做」这个选项?**

<details><summary>答案</summary>

「不做」是对照组。没有它,报告比较的只是几种做法之间的差别,不会去问「做这件事本身值不值得」,很容易变成为预设结论找理由。而且「不做」的代价(错过的机会、拿不到的数据)也需要被明确写出来。

</details>

**2. 单因素敏感性分析和随机抖动分析分别回答什么问题?**

<details><summary>答案</summary>

单因素分析回答「哪个权重最关键」:哪个权重改动 50% 就能让结论翻盘,讨论时就重点对齐那个。随机抖动回答「整体上结论有多稳」:所有权重同时在一定范围内随机变化,某个方案拿第一的比例越高,结论越稳;接近一半说明难以区分,需要更多证据。

</details>

**3. 示例报告里 B 方案在随机抖动下有约 97.7% 的概率拿第一,这能说明 B 一定是对的吗?**

<details><summary>答案</summary>

不能。敏感性分析只检验了权重的不确定性,分数本身的不确定性没有被检验(示例里的分数是估计的)。而且标准本身可能漏了重要维度。要说明结论稳,还要对关键分数做同样的扰动,并且让相关方审一遍标准是否完整。

</details>

**4. 本周六个方向里,哪些问题的核心是「时间」,哪些的核心是「信任」?**

<details><summary>答案</summary>

时间:语音(首音频延迟、打断)、Computer Use 的长链路(步数越多可靠性越低)、Deep Research 的长任务(持久化、发版)。信任:A2A(对方 Agent 能不能信、代表谁调用)、产品交互(用户敢不敢用、怎么放权)、Computer Use 和 Deep Research 的外部内容(注入、来源质量)。Coding Agent 两者都有:长任务的停止条件是时间问题,沙箱和审批是信任问题。

</details>

**5. 资深面试题:你的团队明年该做 Coding Agent 内部工具、语音客服,还是 Deep Research 内部工具?你会怎么做这个决定?**

<details><summary>答案</summary>

先不急着比技术,先问业务问题:团队最贵、最痛的问题是什么,各自能影响多少人、省多少时间或带来多少收入。然后列出至少四个选项(三个方向加「都不做,继续打磨现有产品」),和相关方一起定评估标准和权重,常见的有业务价值、技术成熟度、团队能力匹配、风险合规、成本。能实测的做小原型拿证据,比如用 mini-swe-agent 在自己仓库的历史 bug 上跑基线,语音用模拟器加一两天的真实框架测延迟,Deep Research 用现成开源实现在内部资料上试。打分后做敏感性分析,结论稳就推进,不稳就补证据或交给决策层判断。最后写成报告,包括建议、不选其他选项的理由、风险和复盘条件,比如「试点三个月后某指标达到多少再扩大」。

</details>

## 明天预告

Day 96 是进阶毕业项目 AgentOps 的开题:设计文档、里程碑、验收指标。从明天开始的十天,我们把 SupportPilot 升级成一个多租户的 Agent 平台:模型网关、MCP 工具中心、持久化运行时、评测平台、微调小模型路由、全链路可观测。开题这一天不写代码,写一份完整的设计文档,定清楚从 SupportPilot 迁移什么、仓库怎么组织、每个里程碑怎么验收。
