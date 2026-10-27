---
title: 'Day 552 · 第 79 周复习:进阶(Day 546–551)'
description: '这一周讲的是评测里每个数字有多可信:先把评测的分工和预算钉进流程,再四天统计学(区间、不独立和配对、bootstrap 和重跑抖动、功效和多重比较),最后是裁判自己的误差。今天不加新概念:画一张「不确定性的六个来源」地图,默写 Wilson 区间和裁判校正两段核心代码并用测试验证,再拼一个周报小项目 report79.py,最后把三个最容易犯的错各写成错误版本跑一遍。'
pubDate: 2026-10-27
regime: none
tags: ['review', 'eval', 'statistics', 'llm-as-judge', 'python', 'agent-zero']
series: 'agent-zero'
day: 552
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 551](/blog/agent-zero/day-551-judge-scale-1/) 讲了裁判的误差:请模型当裁判,它会判错,而且偏向放过坏回复。用一小份人工标注的校准集估出 TPR 和 TNR,把裁判报的通过率校正回去,用 bootstrap 把线上样本和校准集两边的抖动一起算进区间。今天造的 480 条回复里,裁判 M 报 80.0%,真实是 69.8%;只有 100 条标注时,差评多抽比随机抽区间窄 5 个点;校准集里缺一类工单,校正会悄悄偏掉。

这一周六天看起来在讲六件事,其实是同一个问题的六个侧面:**评测报出来的一个数字,凭什么信它。**今天把它们拼在一起。

## 今天要解决的问题

复习日不学新东西。今天结束时你应该能:

1. 不看文章,画出这一周的地图,说出一个评测数字背后有哪六个不确定性来源,每个对应哪一天、哪个函数。
2. 默写两段核心代码并用测试证明它们是对的:Day 547 的 Wilson 区间,Day 551 的 `tpr_tnr` 和 `corrected`(裁判校正)。
3. 跑通本周小项目 `part10/report79.py`:一份周报,上半是 v1 对 v2 的比较(用例不独立、配对、MDE),下半是裁判判的线上通过率(校正和区间),最后一句话给出结论。
4. 能解释本周三个最常见的错误版本为什么错:全过时用 Wald 区间、把 180 条当独立样本、给裁判报的通过率套 Wilson 区间。

预计用时 3.5 小时(大头在默写和练习)。前置:[Day 546](/blog/agent-zero/day-546-eval-process/) 到 [Day 551](/blog/agent-zero/day-551-judge-scale-1/) 全部。

学法和平时一样:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 332" role="img" aria-label="本周知识地图:一个评测数字的六个不确定性来源。546 管谁来评和花多少钱;547 用例抽样,Wilson 区间;548 用例不独立和配对;549 Agent 自己重跑会抖,bootstrap;550 评测集太小测不出差别和看太多指标;551 裁判自己判错。六个汇到小项目 report79.py">
  <rect x="0" y="0" width="640" height="332" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="20" y="24" fill="var(--ink)">一个评测数字,凭什么信它</text>
    <rect x="20" y="36" width="190" height="72" rx="6" fill="var(--paper)" stroke="var(--ink-soft)"/>
    <text x="32" y="56" fill="var(--ink)">546 谁评、花多少</text>
    <text x="32" y="74" fill="var(--ink-soft)">四个钉子·分层预算</text>
    <text x="32" y="90" fill="var(--ink-soft)">registry 给用例上户口</text>
    <rect x="225" y="36" width="190" height="72" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="237" y="56" fill="var(--ink)">547 用例是抽样来的</text>
    <text x="237" y="74" fill="var(--ink-soft)">Wald 会越界</text>
    <text x="237" y="90" fill="var(--ink-soft)">Wilson 区间·包住率</text>
    <rect x="430" y="36" width="190" height="72" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="442" y="56" fill="var(--ink)">548 用例不独立</text>
    <text x="442" y="74" fill="var(--ink-soft)">聚类标准误·设计效应</text>
    <text x="442" y="90" fill="var(--ink-soft)">配对·McNemar</text>
    <rect x="20" y="126" width="190" height="72" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="32" y="146" fill="var(--ink)">549 Agent 自己在抖</text>
    <text x="32" y="164" fill="var(--ink-soft)">bootstrap 按场景重抽</text>
    <text x="32" y="180" fill="var(--ink-soft)">换题 vs 重跑·pass^k</text>
    <rect x="225" y="126" width="190" height="72" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="237" y="146" fill="var(--ink)">550 测不出·看太多</text>
    <text x="237" y="164" fill="var(--ink-soft)">MDE·样本量</text>
    <text x="237" y="180" fill="var(--ink-soft)">Holm·跟老板怎么说</text>
    <rect x="430" y="126" width="190" height="72" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="442" y="146" fill="var(--ink)">551 裁判自己判错</text>
    <text x="442" y="164" fill="var(--ink-soft)">TPR/TNR·校准集</text>
    <text x="442" y="180" fill="var(--ink-soft)">校正带区间</text>
    <rect x="170" y="268" width="300" height="48" rx="6" fill="var(--paper)" stroke="var(--ink-soft)"/>
    <text x="320" y="296" text-anchor="middle" fill="var(--ink)">552 小项目:report79.py 周报</text>
    <path d="M 115 108 C 115 190, 250 230, 270 268" fill="none" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
    <path d="M 320 108 L 320 126" fill="none" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
    <path d="M 320 198 L 320 268" fill="none" stroke="var(--mem)" stroke-dasharray="4 3"/>
    <path d="M 525 198 C 525 240, 430 250, 410 268" fill="none" stroke="var(--compute)" stroke-dasharray="4 3"/>
    <path d="M 525 108 L 525 126" fill="none" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
    <path d="M 115 198 C 115 240, 200 255, 220 268" fill="none" stroke="var(--mem)" stroke-dasharray="4 3"/>
  </g>
</svg>
<figcaption>蓝色是「用例和 Agent」这一侧的不确定性(Day 547 到 550),琥珀色是「裁判」这一侧(Day 551),灰色是流程。小项目把两侧拼在同一份周报里:上半讲 v1 对 v2,下半讲裁判判的线上通过率。</figcaption>
</figure>

这一周有一句话贯穿始终:**数字后面要带它的误差,而且要说清楚误差是哪几种。**Day 547 的包住率、Day 548 的设计效应、Day 549 的方差拆分、Day 550 的 MDE、Day 551 的校准集,都是在回答「还有哪一种误差没算进去」。

## 本周每天一句话

| Day | 一句话 | 记住的数字 |
| --- | --- | --- |
| [546](/blog/agent-zero/day-546-eval-process/) | 评测要有人管:分工写进需求评审、代码评审、CODEOWNERS、事故复盘四个动作;预算分层跑,MR 层只跑最要紧的回归用例 | 每个 MR 全量跑一天约 ¥1247,分三层后约 ¥144;LLM 裁判 40 条里和代码判题不一致 11 条 |
| [547](/blog/agent-zero/day-547-eval-stats-1/) | 通过率是抽样来的,区间用 Wilson,别用 p±1.96·SE | 真实 95%、20 条时,Wald 只有 63% 的次数包住真值;全过想下限不低于 95% 要 73 条 |
| [548](/blog/agent-zero/day-548-eval-stats-2/) | 180 条用例只来自 60 个场景,不是 180 个独立样本;比较两个版本要配对 | 设计效应 1.93;v2 比 v1 新挂 6 条、新修好 8 条,McNemar p = 0.79 |
| [549](/blog/agent-zero/day-549-eval-stats-3/) | 区间可以用 bootstrap 按场景重抽算出来;Agent 重跑本身也会抖 | 同一批工单重跑 15 遍,整套得分标准差 3 到 4 个点,temperature=0 管不了 |
| [550](/blog/agent-zero/day-550-eval-stats-4/) | 区间跨 0 要带上 MDE;同时看几个指标要校正 | 180 条的 MDE 是 6.6 个点,想测 3 个点要 869 条;6 个模块不校正至少一个「显著」的概率 27.5% |
| [551](/blog/agent-zero/day-551-judge-scale-1/) | 裁判会判错,用差评多抽的校准集校正,区间要把两边的误差都算进去 | 裁判 M 报 80.0%、真实 69.8%;校准集 100 条时差评多抽区间窄 5 个点 |

## 准备环境

在 `agent-zero-lab` 根目录。今天要用的东西都是前面几天建的,先确认一遍:

```bash
cd agent-zero-lab
uv run python -c "import part10.stats as s; print(sum(1 for n in dir(s) if callable(getattr(s, n)) and getattr(getattr(s, n), '__module__', '') == 'part10.stats'))"
ls part10/data
```

第一行应该输出 `22`(Day 550 末尾数过,`stats.py` 一共 22 个函数)。`ls` 要看到 `runs.json`(Day 547 的 `make_runs.py` 造的)、`judge_pool.json`(Day 551 的 `judge_data.py`)和 `judge_M.json`(Day 551 的 `judge_run.py M`,要花约 ¥0.22)。如果你没跑过 Day 551 的裁判调用,先补跑:`uv run python -m part10.judge_data`,再 `uv run python -m part10.judge_run M`。今天自己不调模型,花费 0 元。

## 默写一:Wilson 区间

合上文章,在 `part10/ex552_wilson.py` 里默写 Wilson 区间。要点:输入 `k`(通过条数)和 `n`(总条数);`n` 为 0 返回 `(0, 1)`;`centre` 不是 `p`,是被拉向 0.5 的一个点;结果裁到 0 和 1 之间。默写完再对。

```python
# agent-zero-lab/part10/ex552_wilson.py
"""默写一:Wilson 区间(Day 547)。"""
import math


def wilson(k: int, n: int, z: float = 1.959964) -> tuple[float, float]:
    if n == 0:
        return 0.0, 1.0
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)
```

<div class="line-notes">

- `def wilson(k: int, n: int, z: float = 1.959964) -> tuple[float, float]:` 默认 z 是 95% 区间用的 1.959964(Day 547 里的 `Z95`)。
- `if n == 0:` 一条用例都没有,什么都不知道。
- `return 0.0, 1.0` 「什么都不知道」写成 0 到 100%,比报错好用,也比除以零好看。
- `p = k / n` 观察到的通过率,`k = 19、n = 20` 时是 0.95。
- `denom = 1 + z * z / n` 公式里的分母,`n = 20` 时是 1 + 3.8415/20 = 1.1921。
- `centre = (p + z * z / (2 * n)) / denom` 区间的中心,不等于 `p`:(0.95 + 0.0960) / 1.1921 = 0.8775。通过率接近 100% 时,中心往 50% 那边靠一点。
- `half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom` 半宽,根号里比 Wald 多了第二项,所以全过时宽度也不是 0。
- `return max(0.0, centre - half), min(1.0, centre + half)` 裁剪到 0 到 1 之间。

</div>

## 默写二:裁判的 TPR、TNR 和校正

第二段默写 `part10/ex552_corrected.py`。要点:TPR 在「人判通过」的那批里算,TNR 在「人判不通过」的那批里算;校正公式是 `(observed + tnr − 1) / (tpr + tnr − 1)`,分母不大于 0 要报错,结果夹在 0 到 1 之间。

```python
# agent-zero-lab/part10/ex552_corrected.py
"""默写二:裁判的 TPR/TNR 和校正后的通过率(Day 551)。"""


def tpr_tnr(human: list[int], judge: list[int]) -> tuple[float, float]:
    pos = [j for h, j in zip(human, judge) if h == 1]   # 人判 pass 的,裁判怎么判
    neg = [j for h, j in zip(human, judge) if h == 0]   # 人判 fail 的,裁判怎么判
    return sum(pos) / len(pos), 1 - sum(neg) / len(neg)


def corrected(observed: float, tpr: float, tnr: float) -> float:
    denom = tpr + tnr - 1
    if denom <= 0:
        raise ValueError("裁判不比瞎猜强,没法校正")
    return min(1.0, max(0.0, (observed + tnr - 1) / denom))
```

<div class="line-notes">

- `def tpr_tnr(human: list[int], judge: list[int]) -> tuple[float, float]:` 输入人判和裁判判两列 0/1,返回(TPR, TNR)。
- `pos = [j for h, j in zip(human, judge) if h == 1]   # 人判 pass 的,裁判怎么判` 只留下人判通过的那些条,取出裁判对它们的判断。
- `neg = [j for h, j in zip(human, judge) if h == 0]   # 人判 fail 的,裁判怎么判` 同理,人判不通过的那些。
- `return sum(pos) / len(pos), 1 - sum(neg) / len(neg)` TPR = 裁判判通过的占比;`neg` 里 1 表示裁判放过了,所以 TNR = 1 − 放过的占比。
- `def corrected(observed: float, tpr: float, tnr: float) -> float:` 校正。
- `denom = tpr + tnr - 1` 裁判比瞎猜强多少。
- `raise ValueError("裁判不比瞎猜强,没法校正")` 分母不大于 0 就拒绝。
- `return min(1.0, max(0.0, (observed + tnr - 1) / denom))` 公式本身,外面用 `min`/`max` 夹到 0 到 1 之间。

</div>

用测试检查你默写的(也可以把测试当第一遍的参照):

```python
# agent-zero-lab/tests/test_ex552.py
import random

import pytest

from part10.ex552_corrected import corrected, tpr_tnr
from part10.ex552_wilson import wilson
from part10.stats import wilson_ci


def test_wilson_matches_day547():
    for k, n in [(0, 20), (19, 20), (20, 20), (138, 180), (1, 1)]:
        assert wilson(k, n) == pytest.approx(wilson_ci(k, n))


def test_wilson_all_pass_is_not_zero_width():
    lo, hi = wilson(20, 20)
    assert hi == 1.0 and lo == pytest.approx(0.839, abs=0.001)


def test_wilson_no_data_knows_nothing():
    assert wilson(0, 0) == (0.0, 1.0)


def test_corrected_undoes_a_known_judge():
    tpr, tnr, p = 0.95, 0.70, 0.60
    observed = p * tpr + (1 - p) * (1 - tnr)    # 裁判会报出来的通过率
    assert corrected(observed, tpr, tnr) == pytest.approx(p)


def test_corrected_refuses_a_coin_flip_judge():
    with pytest.raises(ValueError):
        corrected(0.8, 1.0, 0.0)


def test_tpr_tnr_counts():
    human = [1, 1, 1, 1, 0, 0, 0, 0]
    judge = [1, 1, 1, 0, 0, 1, 1, 1]
    assert tpr_tnr(human, judge) == (0.75, 0.25)


def test_corrected_on_simulated_judge():
    rng = random.Random(0)
    human = [int(rng.random() < 0.6) for _ in range(20000)]
    judge = [int(rng.random() < (0.95 if h else 0.30)) for h in human]
    tpr, tnr = tpr_tnr(human, judge)
    assert corrected(sum(judge) / len(judge), tpr, tnr) == pytest.approx(sum(human) / len(human), abs=0.01)
```

<div class="line-notes">

- `def test_wilson_matches_day547():` 你默写的 `wilson` 要和 Day 547 写的 `wilson_ci` 在五组 `(k, n)` 上一致。`pytest.approx` 比较小数,允许微小的浮点误差。
- `def test_wilson_all_pass_is_not_zero_width():` 20/20 的上限是 1.0、下限约 0.839,宽度不是 0。这是 Wald 做不到的。
- `def test_wilson_no_data_knows_nothing():` n 为 0 必须返回 `(0.0, 1.0)`。
- `observed = p * tpr + (1 - p) * (1 - tnr)    # 裁判会报出来的通过率` 正向算出裁判会报多少:真通过里报通过的占 `p * tpr`,真不通过里被放过的占 `(1 - p) * (1 - tnr)`,代入 0.95、0.70、0.60 得 0.6 × 0.95 + 0.4 × 0.30 = 0.69。
- `assert corrected(observed, tpr, tnr) == pytest.approx(p)` 再校正回去,必须回到 0.60。
- `with pytest.raises(ValueError):` TPR 1、TNR 0 的裁判要报错。
- `assert tpr_tnr(human, judge) == (0.75, 0.25)` 手工 8 条:人判通过 4 条,裁判判对 3 条,TPR 0.75;人判不通过 4 条,裁判判对 1 条,TNR 0.25。
- `human = [int(rng.random() < 0.6) for _ in range(20000)]` 最后一个测试造 2 万条模拟数据,真实通过率 60%,裁判 TPR 0.95、TNR 0.70,估出来再校正,要回到真实通过率 1 个点以内。

</div>

```bash
uv run pytest tests/test_ex552.py -q
```

```text
.......                                                                  [100%]
7 passed in 0.10s
```

## 本周小项目:一份评测周报

把本周的零件拼成一份周报。场景:SupportPilot 的 v2 做了改动,团队想知道两件事,v2 比 v1 好不好;线上每天回复的通过率现在是多少。前一件事靠代码判题的 `runs.json`(180 条用例、60 个场景),后一件事靠裁判 M 判的线上回复,要校正。

| 零件 | 来自 | 在周报里的位置 |
| --- | --- | --- |
| `fmt_rate`、`wilson_ci_cluster`、`design_effect` | Day 547、548 | 一、两个版本各自的通过率和聚类后的区间 |
| `mcnemar_exact`、`paired_diff` | Day 548 | 一、新挂几条、新修好几条;差值的区间 |
| `mde`、`report_line` | Day 550 | 一、差值区间跨 0 时带上 MDE 的那句话 |
| `draw`、`corrected_rate_ci` | Day 551 | 二、校准集差评多抽,校正线上通过率 |
| `verdict_text` | 今天新写 | 三、把前两节的数字合成一句结论 |

```python
# agent-zero-lab/part10/report79.py
"""第 79 周小项目:一份评测周报。上半是 v1 对 v2(代码判题,runs.json),下半是线上一批回复(裁判判题,要校正)。"""
import json
from pathlib import Path

from part10.judge_split import draw, human, verdict
from part10.judge_stats import corrected_rate_ci
from part10.stats import (
    fmt_rate, design_effect, mcnemar_exact, mde, paired_diff, report_line, wilson_ci_cluster,
)

HERE = Path(__file__).parent


def section_compare() -> tuple[float, float, float]:
    rows = json.loads((HERE / "data" / "runs.json").read_text())
    v1, v2 = [r["v1"] for r in rows], [r["v2"] for r in rows]
    clusters = [r["scenario"] for r in rows]
    print("== 一、v2 对比 v1(180 条用例,60 个场景)")
    for name, v in (("v1", v1), ("v2", v2)):
        lo, hi = wilson_ci_cluster(v, clusters)
        print(f"  {name}  {fmt_rate(sum(v), len(v))}(当独立样本)  聚类后 [{lo:.1%}, {hi:.1%}]")
    print(f"  v1 的设计效应 {design_effect(v1, clusters):.2f}")
    mc = mcnemar_exact(v1, v2)
    print(f"  新挂 {mc['a_only']} 条,新修好 {mc['b_only']} 条,McNemar p = {mc['p_value']:.2f}")
    res = paired_diff(v1, v2, clusters)
    m = mde(res["se"])
    print("  " + report_line("v2 对比 v1", res["diff"], res["lo"], res["hi"], m))
    return res["lo"], res["hi"], m


def section_judge() -> float:
    print("\n== 二、线上这批回复(裁判 M 判的,校准集 100 条、差评多抽)")
    cal, prod = draw(100, True, seed=3)
    hc, jc = [human[i] for i in cal], [verdict[i] for i in cal]
    jp = [verdict[i] for i in prod]
    point, (lo, hi) = corrected_rate_ci(jp, hc, jc)
    print(f"  裁判直接报:{fmt_rate(sum(jp), len(jp))}")
    print(f"  校正后:{point:.1%},95% 区间 [{lo:.1%}, {hi:.1%}],宽 {hi - lo:.1%}")
    return hi - lo


def verdict_text(lo: float, hi: float, m: float, judge_width: float) -> str:
    parts = []
    if lo < 0 < hi:
        parts.append(f"v2 有没有提升没有结论(评测集只能测出 ≥{m * 100:.1f} 个点的变化),不能凭这份报告说它更好")
    elif lo > 0:
        parts.append("v2 比 v1 好")
    else:
        parts.append("v2 比 v1 差")
    if judge_width > 0.10:
        parts.append(f"线上通过率区间宽 {judge_width * 100:.0f} 个点,只看周趋势,不比较日间的小波动")
    return ";".join(parts) + "。"


if __name__ == "__main__":
    lo, hi, m = section_compare()
    width = section_judge()
    print("\n== 三、一句话结论")
    print("  " + verdict_text(lo, hi, m, width))
```

<div class="line-notes">

- `from part10.judge_split import draw, human, verdict` Day 551 的切分模块,今天不再写新数据。
- `def section_compare() -> tuple[float, float, float]:` 第一节:比较 v1 和 v2,返回差值区间的下限、上限和 MDE,给最后的结论用。
- `v1, v2 = [r["v1"] for r in rows], [r["v2"] for r in rows]` 两个版本在同一批 180 条用例上的 0/1 结果。
- `clusters = [r["scenario"] for r in rows]` 每条用例属于哪个场景,聚类和配对都要用。
- `lo, hi = wilson_ci_cluster(v, clusters)` 聚类后的 Wilson 区间,v1 是 [67.1%, 84.1%],比当独立样本画的 [70.0%, 82.2%] 宽 5 个点。
- `print(f"  v1 的设计效应 {design_effect(v1, clusters):.2f}")` 1.93,约等于 180 条只有 93 条独立样本的信息量。
- `mc = mcnemar_exact(v1, v2)` 只数不一致的:6 条新挂、8 条新修好。
- `res = paired_diff(v1, v2, clusters)` 配对再聚类的差值,`diff` 是 +1.1 个点。
- `m = mde(res["se"])` 差值的标准误乘以 2.8,6.6 个点,是这批用例能测出的最小提升。
- `print("  " + report_line("v2 对比 v1", res["diff"], res["lo"], res["hi"], m))` Day 550 的三种模板之一:区间跨 0,带上 MDE。
- `cal, prod = draw(100, True, seed=3)` 第二节:校准集 100 条、差评多抽,线上 380 条。
- `point, (lo, hi) = corrected_rate_ci(jp, hc, jc)` 校正和区间,76.0% [67.8%, 82.1%]。
- `return hi - lo` 把区间宽度交给最后的结论函数。
- `def verdict_text(lo: float, hi: float, m: float, judge_width: float) -> str:` 第三节:把数字合成一句话。
- `if lo < 0 < hi:` 差值区间跨 0 就说「没有结论」,并带上 MDE。
- `if judge_width > 0.10:` 线上通过率的区间宽超过 10 个点,就提醒只看周趋势。10 是我定的门槛,按你们的业务调。
- `return ";".join(parts) + "。"` 几条结论用分号连起来。

</div>

```bash
uv run python -m part10.report79
```

```text
== 一、v2 对比 v1(180 条用例,60 个场景)
  v1  138/180 = 76.7% [70.0%, 82.2%](当独立样本)  聚类后 [67.1%, 84.1%]
  v2  140/180 = 77.8% [71.2%, 83.2%](当独立样本)  聚类后 [68.3%, 85.1%]
  v1 的设计效应 1.93
  新挂 6 条,新修好 8 条,McNemar p = 0.79
  v2 对比 v1:差值 +1.1 个点,95% 区间 [-3.5, +5.7]。区间跨过 0,没有结论。本评测集只能检测 ≥6.6 个点的变化,不是「没效果」,是「测不出来」。

== 二、线上这批回复(裁判 M 判的,校准集 100 条、差评多抽)
  裁判直接报:318/380 = 83.7% [79.6%, 87.1%]
  校正后:76.0%,95% 区间 [67.8%, 82.1%],宽 14.2%

== 三、一句话结论
  v2 有没有提升没有结论(评测集只能测出 ≥6.6 个点的变化),不能凭这份报告说它更好;线上通过率区间宽 14 个点,只看周趋势,不比较日间的小波动。
```

周报下半的数字值得停一下:裁判直接报 83.7%,校正后是 76.0%,区间 [67.8%, 82.1%],宽 14.2 个点。这一周的所有数字合起来,最后落到一句话:**v2 有没有提升没有结论,线上通过率要看周趋势,不要比较日间的小波动。**这句话没有一个字是拍脑袋的,每一半都能追到某一天的某个函数。

## 本周错题与坑清单

把这周最容易犯的三个错写成错误版本跑一遍。每一个都是我自己或别人真的写出来过的。

```python
# agent-zero-lab/part10/wrong79.py
"""本周三个最容易犯的错,各写一个错误版本,看它们怎么错。"""
import json
from pathlib import Path

from part10.judge_split import draw, human, verdict
from part10.stats import clustered_se, naive_se, wald_ci, wilson_ci

# 错一:全过就用老办法写区间(Day 547)
lo, hi = wald_ci(20, 20)
print(f"错一:20/20 的 Wald 区间 [{lo:.1%}, {hi:.1%}],宽度 {hi - lo:.1%};Wilson 是 [{wilson_ci(20, 20)[0]:.1%}, {wilson_ci(20, 20)[1]:.1%}]")

# 错二:180 条当 180 个独立样本(Day 548)
rows = json.loads((Path(__file__).parent / "data" / "runs.json").read_text())
v1, clusters = [float(r["v1"]) for r in rows], [r["scenario"] for r in rows]
print(f"错二:v1 的标准误,当独立样本 {naive_se(v1):.4f},按 60 个场景聚类 {clustered_se(v1, clusters):.4f}")

# 错三:裁判报的通过率配一个 Wilson 区间,当成真实通过率的区间(Day 551)
cal, prod = draw(100, True, seed=3)
jp = [verdict[i] for i in prod]
lo, hi = wilson_ci(sum(jp), len(jp))
true = sum(human[i] for i in prod) / len(prod)
print(f"错三:裁判报 {sum(jp) / len(jp):.1%},Wilson [{lo:.1%}, {hi:.1%}];真实 {true:.1%},{'在' if lo <= true <= hi else '不在'}区间里")
```

<div class="line-notes">

- `lo, hi = wald_ci(20, 20)` 错一:20 条全过,用 Day 354 的老办法 `p ± 1.96·SE`。`p = 1`,SE 是 0,区间退化成一个点。
- `print(f"错一:20/20 的 Wald 区间 [{lo:.1%}, {hi:.1%}],宽度 {hi - lo:.1%};Wilson 是 [{wilson_ci(20, 20)[0]:.1%}, {wilson_ci(20, 20)[1]:.1%}]")` 对比 Wilson 的 [83.9%, 100.0%]。
- `v1, clusters = [float(r["v1"]) for r in rows], [r["scenario"] for r in rows]` 错二:同一批 180 条用例。`naive_se` 要的是浮点数列表。
- `print(f"错二:v1 的标准误,当独立样本 {naive_se(v1):.4f},按 60 个场景聚类 {clustered_se(v1, clusters):.4f}")` 0.0316 对 0.0440:当独立样本,标准误小了近三成,区间就窄了近三成。
- `cal, prod = draw(100, True, seed=3)` 错三:裁判 M 判的线上 380 条。
- `lo, hi = wilson_ci(sum(jp), len(jp))` 把裁判报出的 318/380 直接套 Wilson。
- `print(f"错三:裁判报 {sum(jp) / len(jp):.1%},Wilson [{lo:.1%}, {hi:.1%}];真实 {true:.1%},{'在' if lo <= true <= hi else '不在'}区间里")` 真实 75.0% 不在 [79.6%, 87.1%] 里。

</div>

```text
错一:20/20 的 Wald 区间 [100.0%, 100.0%],宽度 0.0%;Wilson 是 [83.9%, 100.0%]
错二:v1 的标准误,当独立样本 0.0316,按 60 个场景聚类 0.0440
错三:裁判报 83.7%,Wilson [79.6%, 87.1%];真实 75.0%,不在区间里
```

| 错 | 现象 | 为什么错 | 哪一天 |
| --- | --- | --- | --- |
| 全过就写 100% 或用 Wald | 区间宽度为零,20/20 时 Wald 只有 63% 的次数包住真值 | 观察到的 p 当真值用,p = 1 时标准误是 0 | 547 |
| 把 180 条当 180 个独立样本 | 区间只有 84% 的次数包住真值 | 同一场景的三种说法七成一起对错,有效样本约 93 | 548 |
| 两个区间重叠就说没差别 | 配对的 McNemar 照样可以显著 | 配对逐条做差,把用例难度抵消了 | 548 |
| 按单条重抽 | 区间偏窄 | 拆开了同场景的用例,假设了独立 | 549 |
| 用一遍的结果下结论 | 同一配置三批通过率 67% 到 87% | Agent 自己在抖,temperature=0 管不了 | 549 |
| 「没有显著差异」不带 MDE | 读的人听成「没效果」 | 其实是「测不出来」,评测集只能测 ≥6.6 个点 | 550 |
| 看 8 个指标只报显著的那个 | 6 个模块至少一个「显著」的概率 27.5% | 看得越多越容易碰巧显著 | 550 |
| 裁判报的数直接套 Wilson | 真值在区间外 | Wilson 只管抽样,管不了裁判偏高 | 551 |
| 校准集随机抽 | 100 条里只有 34 条差评,TNR 区间宽 29 个点 | TNR 只在 fail 条上算 | 551 |
| 校准集缺一类工单 | 校正出 81.2%,真值 72.6%,不报错 | 裁判在没见过的类型上 TPR、TNR 不同 | 551 |

## 动手练习

1. **三种区间。**对 `runs.json` 里 v1 的 138/180,分别算 Wald、Wilson 和聚类 Wilson 的区间和宽度,按宽度排序,说明为什么聚类的最宽。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex552_a.py
"""练习 1:v1 的通过率,三种区间(Wald、Wilson、聚类 Wilson)的宽度。"""
import json
from pathlib import Path

from part10.stats import wald_ci, wilson_ci, wilson_ci_cluster

rows = json.loads((Path(__file__).parent / "data" / "runs.json").read_text())
v1 = [r["v1"] for r in rows]
clusters = [r["scenario"] for r in rows]
k, n = sum(v1), len(v1)
for name, (lo, hi) in (
    ("Wald(当独立)", wald_ci(k, n)),
    ("Wilson(当独立)", wilson_ci(k, n)),
    ("聚类 Wilson(60 个场景)", wilson_ci_cluster([float(x) for x in v1], clusters)),
):
    print(f"{name:<18} [{lo:.1%}, {hi:.1%}] 宽 {hi - lo:.1%}")
```

<div class="line-notes">

- `v1 = [r["v1"] for r in rows]` v1 的 0/1 结果,整数。
- `k, n = sum(v1), len(v1)` 138 和 180。
- `("Wald(当独立)", wald_ci(k, n)),` 三种区间放进同一个元组,循环里一起打印。
- `("聚类 Wilson(60 个场景)", wilson_ci_cluster([float(x) for x in v1], clusters)),` 聚类版要浮点数列表和每条的场景名。
- `print(f"{name:<18} [{lo:.1%}, {hi:.1%}] 宽 {hi - lo:.1%}")` `:<18` 左对齐占 18 格,让三行对齐。

</div>

```text
Wald(当独立)          [70.5%, 82.8%] 宽 12.4%
Wilson(当独立)        [70.0%, 82.2%] 宽 12.3%
聚类 Wilson(60 个场景)  [67.1%, 84.1%] 宽 17.0%
```

Wald 和 Wilson 在 138/180 这种居中的通过率上几乎一样(12.4% 对 12.3%),差别只在接近 0 或 100% 时才明显。聚类 Wilson 最宽,17.0%,因为它把 180 条缩成约 93 个有效样本再算,更接近真实的信息量。三者的排序是「当独立」低估、「按场景聚类」才靠谱。

</details>

2. **周报里线上通过率改用随机抽的校准集。**同样 100 条,随机抽和分层抽的校正区间各是多少?结论函数的那句话有没有变?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex552_b.py
"""练习 2:线上通过率换成「随机抽 100 条」当校准集,区间和分层抽样比,宽了多少。"""
from part10.judge_split import draw, human, verdict
from part10.judge_stats import corrected_rate_ci
from part10.report79 import verdict_text

for stratified in (True, False):
    cal, prod = draw(100, stratified, seed=3)
    hc, jc, jp = [human[i] for i in cal], [verdict[i] for i in cal], [verdict[i] for i in prod]
    point, (lo, hi) = corrected_rate_ci(jp, hc, jc)
    print("分层" if stratified else "随机", f"校正后 {point:.1%} [{lo:.1%}, {hi:.1%}] 宽 {hi - lo:.1%}")
    print("  ", verdict_text(-0.035, 0.057, 0.066, hi - lo))
```

<div class="line-notes">

- `from part10.report79 import verdict_text` 直接用小项目里的结论函数,不重写。
- `for stratified in (True, False):` 先分层、后随机。
- `cal, prod = draw(100, stratified, seed=3)` 同一个种子,两种抽法。
- `point, (lo, hi) = corrected_rate_ci(jp, hc, jc)` 校正和区间。
- `print("  ", verdict_text(-0.035, 0.057, 0.066, hi - lo))` 前三个数是 v2 对 v1 差值区间和 MDE(−3.5%、+5.7%、6.6%),第四个是这次线上区间的宽度。

</div>

```text
分层 校正后 76.0% [67.8%, 82.1%] 宽 14.2%
   v2 有没有提升没有结论(评测集只能测出 ≥6.6 个点的变化),不能凭这份报告说它更好;线上通过率区间宽 14 个点,只看周趋势,不比较日间的小波动。
随机 校正后 73.2% [62.9%, 80.0%] 宽 17.2%
   v2 有没有提升没有结论(评测集只能测出 ≥6.6 个点的变化),不能凭这份报告说它更好;线上通过率区间宽 17 个点,只看周趋势,不比较日间的小波动。
```

分层 100 条区间宽 14.2%,随机 100 条宽 17.2%,宽了 3 个点。结论函数的话只有一个数字变了:「区间宽 14 个点」变成「17 个点」,意思没变,都是只看周趋势。但换成别的门槛(比如要求宽度小于 15 个点才放心看日报),随机抽的那份就过不了关了。

</details>

3. **想检测 3 个点要多少场景?**用 `runs.json` 的数据算 Day 550 那个数字,并说明它对周报的意义。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex552_c.py
"""练习 3:想检测出 v2 比 v1 好 3 个点,要多少场景?再想想这笔账该不该和裁判的校准集一起算。"""
import json
import math
from pathlib import Path

from part10.stats import clustered_se, naive_se, required_n

rows = json.loads((Path(__file__).parent / "data" / "runs.json").read_text())
a, b = [r["v1"] for r in rows], [r["v2"] for r in rows]
clusters = [r["scenario"] for r in rows]
d = [float(y - x) for x, y in zip(a, b)]
omega2 = sum((x - sum(d) / len(d)) ** 2 for x in d) / (len(d) - 1)         # 逐条差值的方差
deff = (clustered_se(d, clusters) / naive_se(d)) ** 2                       # 差值的设计效应
n = required_n(0.03, omega2) * deff
print(f"omega2 {omega2:.4f},设计效应 {deff:.2f}")
print(f"检测 3 个点:约 {math.ceil(n)} 条用例,每个场景 3 种说法,约 {math.ceil(n / 3)} 个场景(现在 60 个)")
```

<div class="line-notes">

- `d = [float(y - x) for x, y in zip(a, b)]` 逐条差值,+1 是新修好,−1 是新挂,0 是没变。
- `omega2 = sum((x - sum(d) / len(d)) ** 2 for x in d) / (len(d) - 1)         # 逐条差值的方差` 样本方差,分母是 n−1。
- `deff = (clustered_se(d, clusters) / naive_se(d)) ** 2                       # 差值的设计效应` 差值也受聚类影响,放大 1.28 倍。
- `n = required_n(0.03, omega2) * deff` 想检测 0.03 的差值需要的条数,再乘设计效应补回聚类的影响。
- `math.ceil(n / 3)` 每个场景 3 条,条数除以 3 向上取整就是场景数。

</div>

```text
omega2 0.0781,设计效应 1.28
检测 3 个点:约 869 条用例,每个场景 3 种说法,约 290 个场景(现在 60 个)
```

要 869 条用例、约 290 个场景,现在只有 60 个。这对周报的意义:本周「没有结论」不是 v2 没用,是评测集的能力不够。如果团队真的在意 3 个点的提升,下一步的动作是补用例(而且是补场景,不是给老场景加说法),不是再讨论这份报告。

</details>

4. **(开放题)把「能不能合」写成函数。**输入差值区间、MDE、线上区间宽度、可选的容忍度,输出一句话。三种情形各试一次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex552_d.py
"""练习 4 的示范:把周报末尾的「能不能合」写成一个函数,三种情形各试一次。"""


def decide(lo: float, hi: float, mde_value: float, judge_width: float, margin: float | None = None) -> str:
    """lo、hi 是 v2 对 v1 差值的区间;margin 不为 None 表示这次只要「别变差超过 margin」。"""
    if margin is not None:
        verdict = "可以合" if lo > -margin else f"先别合:排除不了变差超过 {margin * 100:.0f} 个点,评测集只能测 ≥{mde_value * 100:.1f} 个点"
    elif lo > 0:
        verdict = "可以合:确实变好了"
    elif hi < 0:
        verdict = "不合:确实变差了"
    else:
        verdict = f"没有结论:评测集只能测 ≥{mde_value * 100:.1f} 个点,先补用例,不要靠这份报告拍板"
    note = ";线上通过率区间太宽,只看周趋势" if judge_width > 0.10 else ""
    return verdict + note


print(decide(-0.035, 0.057, 0.066, 0.142))                  # 本周的数据:想变好,区间跨 0
print(decide(-0.035, 0.057, 0.066, 0.142, margin=0.03))     # 同一份数据,目标是降成本,容忍 3 个点
print(decide(0.012, 0.051, 0.027, 0.08))                    # Day 550 里扩到 600 条之后的情形
```

<div class="line-notes">

- `def decide(lo: float, hi: float, mde_value: float, judge_width: float, margin: float | None = None) -> str:` 前三个参数是 v2 对 v1 的差值区间和 MDE,第四个是线上通过率区间的宽度,最后一个是容忍度,`None` 表示这次的目标是变好。
- `if margin is not None:` 目标是「别变差」的那种改动,比如降成本。
- `verdict = "可以合" if lo > -margin else f"先别合:排除不了变差超过 {margin * 100:.0f} 个点,评测集只能测 ≥{mde_value * 100:.1f} 个点"` 区间下限高于 −margin 才说可以合,否则说「排除不了」。
- `elif lo > 0:` 目标是变好:整个区间在 0 以上。
- `elif hi < 0:` 整个区间在 0 以下,变差了。
- `note = ";线上通过率区间太宽,只看周趋势" if judge_width > 0.10 else ""` 线上区间宽超过 10 个点,附一句提醒。
- `print(decide(-0.035, 0.057, 0.066, 0.142, margin=0.03))     # 同一份数据,目标是降成本,容忍 3 个点` 同一份数据换个目标,结论就变了:下限 −3.5% 低于 −3%,排除不了。

</div>

```text
没有结论:评测集只能测 ≥6.6 个点,先补用例,不要靠这份报告拍板;线上通过率区间太宽,只看周趋势
先别合:排除不了变差超过 3 个点,评测集只能测 ≥6.6 个点;线上通过率区间太宽,只看周趋势
可以合:确实变好了
```

前两行就是本周的数据,区别只在目标:想变好,没有结论;想降成本、容忍 3 个点,也先别合。第三行的数字是我假设的一组「扩到更大评测集之后」的数字,只用来展示第三个分支。容忍度要在看结果之前定(Day 550),函数把它做成参数,调用的人就没法事后改口径。

</details>

**验收标准**:默写的两段代码通过 `tests/test_ex552.py` 的 7 个测试;`report79.py` 能跑通并输出和文中一致的数字;能不看文章说出六个不确定性来源和各自对应的函数;三个错误版本能各讲出「为什么错」。

## 名词解释

本周没有新术语,下面是这一周里最容易混的几个:

| 名词 | 意思 |
| --- | --- |
| 包住率 | 用某种办法画区间,重复很多次,有多大比例的区间包住真值。区间好不好看的是它,不是宽窄(Day 547) |
| 设计效应 | 用例不独立时,标准误比「当独立」放大的平方倍数,1.93 的意思是 180 条只相当于 93 条独立样本(Day 548) |
| 配对 | 两个版本跑同一批用例,逐条做差,把用例难度抵消掉(Day 548) |
| MDE | 最小可检测差异,评测集能可靠测出的最小提升。区间跨 0 时要带上它(Day 550) |
| Holm | 看多个指标时的校正办法,比 Bonferroni 不容易漏掉真差异(Day 550) |
| 校准集 | 有人工标注、用来估裁判 TPR 和 TNR 的一小份样本,差评要多抽(Day 551) |
| 校正后的通过率 | 用 TPR、TNR 把裁判报的通过率反推成真实通过率的估计,要带区间(Day 551) |
| 条件概率 | 「在某个前提下」发生的概率。TPR 的前提是人判通过,TNR 的前提是人判不通过(Day 551) |

## 常见误区

**以为复习日就是把六篇文章再读一遍。**默写比重读有用得多。今天两段默写,能写出来才算会,看着对不算。

**默写时背代码。**Wilson 的公式不用背,背的是四件事:`centre` 被拉向 0.5、半宽的根号里有两项、n 为 0 返回 (0, 1)、结果要裁剪。其余推得出来。

**周报写成数字堆。**一份周报最后应该落在一句话上,今天的 `verdict_text` 就是为此写的。没有那一句,读的人要自己猜这些区间意味着什么。

**每一节都用最复杂的办法。**聚类、bootstrap、校正,每一个都是有前提才用:用例本来就独立就不用聚类,已经有公式就不必 bootstrap,评分是代码判的就不用校正。今天小项目里上半节用代码判题的数据、下半节用裁判的数据,正是因为两边的误差来源不同。

**把本周所有的区间加起来。**聚类区间和裁判校正区间是两份数据各自的误差,不能相加或相乘得出一个「总区间」,要各自报告。

## 学习资料

### 文档与文章

- [Miller · Adding Error Bars to Evals](https://arxiv.org/abs/2411.00640):本周四天统计学的共同出处,把评测当统计问题写区间,聚类、配对、功效都有。复习时重读摘要和第 3 节。
- [Lee 等 · How to Correctly Report LLM-as-a-Judge Evaluations](https://arxiv.org/abs/2511.21140):Day 551 的相关研究,校正裁判偏差并把校准集的不确定性算进区间。
- [Hamel Husain · Using LLM-as-a-Judge For Evaluation: A Complete Guide](https://hamel.dev/blog/posts/llm-judge/):从人工标注到可信裁判,串起第 51 周和今天。
- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):评测的整体做法,当本周的外部参照。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Pr4y1e7A5&autoplay=0&high_quality=1" title="[StatQuest] Statistics Fundamentals - 统计学基础" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>至冬川搬运 · [StatQuest] Statistics Fundamentals 合集 · 英文,分集很多。复习时挑第 13 集(功效)、第 24 集(Bootstrap)、第 28 集(有效样本数),分别对应 Day 550、549、548。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV14PtwziE6S&autoplay=0&high_quality=1" title="人话统计学概念:置信区间!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>DataCafe · 人话统计学概念:置信区间! · 5 分钟。想不起来区间到底在说什么,看这个。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/TqOeMYtOc1w" title="Confidence Intervals, Clearly Explained!!!" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>StatQuest with Josh Starmer · Confidence Intervals, Clearly Explained!!! · 英文,有字幕,节奏慢。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/HDCOUXE3HMM" title="p-hacking: What it is and how to avoid it!" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>StatQuest with Josh Starmer · p-hacking: What it is and how to avoid it! · 英文。看得多、报得少,是多重比较的根源(Day 550)。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):评估一章可以当本周的外部对照,英文原版。
- Peter Bruce、Andrew Bruce、Peter Gedeck《Practical Statistics for Data Scientists》(第 2 版,O'Reilly,2020):置信区间、bootstrap、功效的工具书,英文原版。

### 开源项目与代码

- [scipy.stats.bootstrap](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html):Day 549 对过答案的现成实现。
- [scikit-learn 的 cohen_kappa_score](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.cohen_kappa_score.html):明天讲标注员一致性时用来核对手写的 kappa。

## 自测

1. 一个评测数字背后至少有哪几种不确定性?各举一个本周的函数。

<details><summary>答案</summary>

用例是抽样来的(`wilson_ci`)、用例不独立(`clustered_se`、`wilson_ci_cluster`)、两个版本比较要配对(`paired_diff`、`mcnemar_exact`)、Agent 自己重跑会抖(`bootstrap_ci`、`variance_split`)、评测集太小测不出差别(`mde`、`required_n`)、看太多指标(`holm`)、裁判自己判错(`corrected_rate_ci`)。

</details>

2. 为什么周报上半部分用聚类 Wilson,下半部分用校正加 bootstrap,不是统一用一种办法?

<details><summary>答案</summary>

两半的数据来源不同,主要的误差也不同。上半是代码判题的 0/1,没有判断误差,但用例来自 60 个场景、不独立,所以要聚类。下半是裁判判的,裁判有偏,而且校准集只有 100 条,所以要校正,并把校准集的误差也算进区间。用例独立、评分又准确的情形,Wilson 就够了。

</details>

3. 默写 `corrected`:裁判报 0.80,TPR 1.0,TNR 0.66,校正后是多少?

<details><summary>答案</summary>

(0.80 + 0.66 − 1) / (1.0 + 0.66 − 1) = 0.46 / 0.66 = 0.697,约 69.7%。和 Day 551 里裁判 M 用 480 条全量标注算出来的 69.8% 一致(TNR 取三位小数 0.662 时刚好是 69.8%)。

</details>

4. 评测报告写「v2 比 v1 高 1.1 个点,没有显著差异」,有什么问题?怎么改?

<details><summary>答案</summary>

读的人会把它听成「v2 没有提升」。区间是 [−3.5%, +5.7%],跨过 0,但这批评测集只能检测 ≥6.6 个点的变化,不是「没效果」,是「测不出来」。改成带区间和 MDE 的版本,并说清楚要检测 3 个点需要约 869 条用例。

</details>

5. (面试题)你们的 Agent 每次改完都要跑评测,用 LLM 裁判判。你要怎么设计才能让评测结果值得信?

<details><summary>答案</summary>

分几层说。一,裁判:给它判断所需的材料(规则和数据),不要让它猜;用差评多抽的人工标注校准集估 TPR、TNR,用校正后的通过率并带区间,定期补新样本。二,用例:报告里同时写用例数和场景数,按场景聚类算区间;比较两个版本时同一批用例配对。三,Agent 的抖动:每题跑多遍,看 pass^k,拆方差判断多跑有没有用。四,评测集能力:报区间跨 0 时带上 MDE,不够就补场景。五,多个指标先定主指标,其余当护栏,一定要同时看就用 Holm。六,流程:用例有负责人、评测分层跑、MR 层只跑最要紧的回归集。

</details>

6. 本周最想改的一个习惯是什么?为什么?

<details><summary>答案</summary>

没有标准答案。常见的是:报通过率时从来不带区间。写一句你自己的:下一个评测报告里,每个数字后面加什么,在哪一步加。

</details>

## 明天预告

Day 553 · 大规模评审(二):投票、评审漂移、钱和人、多人标注。今天的周报用了一个裁判 M,它偏松。如果请三个裁判投票,能不能解决?如果有人悄悄改了裁判的 prompt,怎么发现?评审每天要花多少钱、多少专家时间?明天用同一批 480 条回复,再加两个裁判,把这几个问题一个个跑出来,并把投票、漂移报警、标注员一致性写进 `judge_monitor.py`。
